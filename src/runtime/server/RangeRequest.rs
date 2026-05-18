//! Parses an HTTP `Range: bytes=...` request header against a known total
//! size. Only single-range `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
//! forms are supported; multi-range and non-`bytes` units fall back to `.none`
//! (serve full body) rather than 416, matching common static-server behavior.

use bun_core::strings;
use bun_uws::AnyRequest;

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Result {
    /// No Range header (or unsupported form) — serve 200 with the full body.
    None,
    /// Serve 206 with `Content-Range: bytes start-end/total`. `end` is inclusive.
    Satisfiable { start: u64, end: u64 },
    /// Serve 416 with `Content-Range: bytes */total`.
    Unsatisfiable,
}

/// Parsed Range header before the total size is known. Safe to store on a
/// request context: it owns no slices into the uWS request buffer.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum Raw {
    None,
    /// bytes=-N
    Suffix(u64),
    /// bytes=N-[M]
    Bounded {
        start: u64,
        end: Option<u64>,
    },
}

impl Raw {
    pub fn resolve(self, total: u64) -> Result {
        match self {
            Raw::None => Result::None,
            Raw::Suffix(n) => {
                if n == 0 {
                    return Result::Unsatisfiable;
                }
                // RFC 9110 §14.1.3: a positive suffix-length is satisfiable;
                // for an empty representation we serve the whole (0-byte) body.
                if total == 0 {
                    return Result::None;
                }
                Result::Satisfiable {
                    start: total.saturating_sub(n),
                    end: total - 1,
                }
            }
            Raw::Bounded { start, end } => {
                if start >= total {
                    return Result::Unsatisfiable;
                }
                let mut end = end.unwrap_or(total - 1);
                if end < start {
                    return Result::None;
                }
                if end >= total {
                    end = total - 1;
                }
                Result::Satisfiable { start, end }
            }
        }
    }
}

/// Match WebKit's parseRange (HTTPParsers.cpp): case-insensitive "bytes",
/// optional whitespace before "=". https://fetch.spec.whatwg.org/#simple-range-header-value
pub fn parse_raw(header: &[u8]) -> Raw {
    let mut rest = header;
    if !strings::starts_with_case_insensitive_ascii(rest, b"bytes") {
        return Raw::None;
    }
    rest = strings::trim(&rest[5..], b" \t");
    if rest.is_empty() || rest[0] != b'=' {
        return Raw::None;
    }
    rest = &rest[1..];

    // Multi-range — not supported, fall through to full body.
    if strings::index_of_char(rest, b',').is_some() {
        return Raw::None;
    }

    let Some(dash) = strings::index_of_char(rest, b'-') else {
        return Raw::None;
    };
    let dash = dash as usize;
    let start_s = strings::trim(&rest[0..dash], b" \t");
    let end_s = strings::trim(&rest[dash + 1..], b" \t");

    if start_s.is_empty() {
        let Some(n) = bun_core::fmt::parse_decimal::<u64>(end_s) else {
            return Raw::None;
        };
        return Raw::Suffix(n);
    }

    let Some(start) = bun_core::fmt::parse_decimal::<u64>(start_s) else {
        return Raw::None;
    };
    let end: Option<u64> = if end_s.is_empty() {
        None
    } else {
        match bun_core::fmt::parse_decimal::<u64>(end_s) {
            Some(v) => Some(v),
            None => return Raw::None,
        }
    };
    Raw::Bounded { start, end }
}

pub fn parse(header: &[u8], total: u64) -> Result {
    parse_raw(header).resolve(total)
}

// PORT NOTE: Zig passed `req` by value; `bun_uws::AnyRequest::header` borrows
// `&self` and returns `&[u8]` tied to it, so take `&AnyRequest` here.
pub fn from_request(req: &AnyRequest, total: u64) -> Result {
    let Some(h) = req.header(b"range") else {
        return Result::None;
    };
    parse(h, total)
}

pub fn raw_from_request(req: &AnyRequest) -> Raw {
    let Some(h) = req.header(b"range") else {
        return Raw::None;
    };
    parse_raw(h)
}

/// Max bytes a `Content-Range: bytes ...` value can occupy: `"bytes "` (6) +
/// three `u64::MAX` (20 each) + `'-'` + `'/'` = 68. 96 leaves slack.
pub const CONTENT_RANGE_BUF: usize = 96;

/// Render a `Content-Range` header value into `buf` per RFC 9110 §14.4.
///
/// | `range`             | `total`   | output                |
/// |---------------------|-----------|-----------------------|
/// | `Satisfiable{s,e}`  | `Some(t)` | `bytes {s}-{e}/{t}`   |
/// | `Satisfiable{s,e}`  | `None`    | `bytes {s}-{e}/*`     |
/// | `Unsatisfiable`     | `Some(t)` | `bytes */{t}`         |
/// | `Unsatisfiable`     | `None`    | `bytes */*`           |
/// | `None`              | _         | empty (caller skips)  |
///
/// `buf_print` into a [`CONTENT_RANGE_BUF`]-sized buffer cannot overflow with
/// `u64` operands, so this is infallible for correctly-sized `buf`.
pub fn format_content_range(buf: &mut [u8], range: Result, total: Option<u64>) -> &[u8] {
    use bun_core::fmt::buf_print_infallible as bp;
    match range {
        Result::None => &buf[..0],
        Result::Satisfiable { start, end } => match total {
            Some(t) => bp(buf, format_args!("bytes {}-{}/{}", start, end, t)),
            None => bp(buf, format_args!("bytes {}-{}/*", start, end)),
        },
        Result::Unsatisfiable => match total {
            Some(t) => bp(buf, format_args!("bytes */{}", t)),
            None => b"bytes */*",
        },
    }
}

// ported from: src/runtime/server/RangeRequest.zig
