//! Parses an HTTP `Range: bytes=...` request header against a known total
//! size. Only single-range `bytes=start-end` / `bytes=start-` / `bytes=-suffix`
//! forms are supported; multi-range and non-`bytes` units fall back to `.none`
//! (serve full body) rather than 416, matching common static-server behavior.

use bun_str::strings;
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
    Bounded { start: u64, end: Option<u64> },
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
                Result::Satisfiable { start: total.saturating_sub(n), end: total - 1 }
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
    if rest.len() < 5 || !strings::eql_case_insensitive_ascii(&rest[0..5], b"bytes", false) {
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
        let Some(n) = parse_u64(end_s) else {
            return Raw::None;
        };
        return Raw::Suffix(n);
    }

    let Some(start) = parse_u64(start_s) else {
        return Raw::None;
    };
    let end: Option<u64> = if end_s.is_empty() {
        None
    } else {
        match parse_u64(end_s) {
            Some(v) => Some(v),
            None => return Raw::None,
        }
    };
    Raw::Bounded { start, end }
}

pub fn parse(header: &[u8], total: u64) -> Result {
    parse_raw(header).resolve(total)
}

pub fn from_request(req: AnyRequest, total: u64) -> Result {
    let Some(h) = req.header(b"range") else {
        return Result::None;
    };
    parse(h, total)
}

pub fn raw_from_request(req: AnyRequest) -> Raw {
    let Some(h) = req.header(b"range") else {
        return Raw::None;
    };
    parse_raw(h)
}

// std.fmt.parseUnsigned(u64, s, 10) — input is trimmed ASCII from an HTTP
// header; invalid bytes (non-UTF-8 or non-digit) map to None, matching Zig's
// `catch return .none`.
#[inline]
fn parse_u64(s: &[u8]) -> Option<u64> {
    core::str::from_utf8(s).ok()?.parse::<u64>().ok()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/RangeRequest.zig (86 lines)
//   confidence: high
//   todos:      0
//   notes:      AnyRequest passed by value to match Zig; Phase B may want &AnyRequest depending on bun_uws shape.
// ──────────────────────────────────────────────────────────────────────────
