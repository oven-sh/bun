//! `us_quic_header_t` plus the QPACK static-table index (`enum lsqpack_tnv`,
//! RFC 9204 Appendix A). Passing the index lets the lsqpack encoder skip its
//! XXH32 name lookup; the canonical lowercase name string is the map key, so
//! a hit also avoids lowercasing on the caller side.

use core::ffi::{c_int, c_uint};

#[repr(C)]
pub struct Header {
    pub name: *const u8,
    pub name_len: c_uint,
    pub value: *const u8,
    pub value_len: c_uint,
    pub qpack_index: c_int, // default -1
}

impl Header {
    /// Safe view of the header name bytes.
    #[inline]
    pub fn name_bytes(&self) -> &[u8] {
        // SAFETY: lsquic populates `name` with `name_len` bytes valid for the
        // duration of the header callback (or `Header::init` borrowed them
        // from a caller-owned slice). The returned borrow is tied to `&self`.
        // `(null, 0)` is tolerated for empty headers.
        if self.name.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(self.name, self.name_len as usize) }
        }
    }
    /// Safe view of the header value bytes.
    #[inline]
    pub fn value_bytes(&self) -> &[u8] {
        // SAFETY: same invariant as `name_bytes` — `value` points to
        // `value_len` bytes valid for the borrow of `&self`.
        if self.value.is_null() {
            &[]
        } else {
            unsafe { core::slice::from_raw_parts(self.value, self.value_len as usize) }
        }
    }

    pub fn init(name_: &[u8], value_: &[u8], idx: Option<Qpack>) -> Header {
        Header {
            name: name_.as_ptr(),
            name_len: c_uint::try_from(name_.len()).expect("int cast"),
            value: value_.as_ptr(),
            value_len: c_uint::try_from(value_.len()).expect("int cast"),
            qpack_index: if let Some(i) = idx { i as c_int } else { -1 },
        }
    }
}

/// `enum lsqpack_tnv`. Only the entries a request encoder actually emits are
/// named; the rest are still reachable via `Qpack::from_raw`.
// TODO(port): Zig `enum(u8) { ... _ }` is non-exhaustive — unnamed u8 values
// are valid. If callers ever construct unnamed indices, switch to
// `#[repr(transparent)] pub struct Qpack(u8)` with associated consts.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Qpack {
    Authority = 0,
    Path = 1,
    ContentDisposition = 3,
    ContentLength = 4,
    Cookie = 5,
    Date = 6,
    Etag = 7,
    IfModifiedSince = 8,
    IfNoneMatch = 9,
    LastModified = 10,
    Link = 11,
    Location = 12,
    Referer = 13,
    SetCookie = 14,
    MethodGet = 17,
    SchemeHttps = 23,
    Accept = 29,
    AcceptEncoding = 31,
    AcceptRanges = 32,
    CacheControl = 36,
    ContentEncoding = 43,
    ContentType = 44,
    Range = 55,
    Vary = 59,
    AcceptLanguage = 72,
    Authorization = 84,
    Forwarded = 88,
    IfRange = 89,
    Origin = 90,
    Server = 92,
    UserAgent = 95,
    XForwardedFor = 96,
}

#[derive(Copy, Clone)]
pub enum Class {
    /// RFC 9114 §4.2 connection-specific field — MUST NOT be sent.
    Forbidden,
    /// Host header — drop and use the value as `:authority`.
    Host,
    /// In the QPACK static table; `name` is the canonical lowercase form.
    Indexed { name: &'static [u8], index: Qpack },
}

impl Class {
    const fn idx(name: &'static [u8], i: Qpack) -> Class {
        Class::Indexed { name, index: i }
    }
}

impl Qpack {
    /// Case-insensitive header-name → encoding disposition. None means the
    /// name is neither forbidden nor in the static table; lowercase it and
    /// send with no index hint.
    pub fn classify(name: &[u8]) -> Option<Class> {
        // `build_request` produces mixed-case names ("Transfer-Encoding",
        // "Host", …). Lowercase into a small stack buffer first — every known
        // key is ≤ 19 bytes, so anything longer is a guaranteed miss.
        let (buf, len) = bun_core::strings::ascii_lowercase_buf::<19>(name)?;
        let lower = &buf[..len];
        // PERF(port): length-gated match instead of phf::Map. 34 keys spread
        // over 14 distinct lengths (max 5 per bucket, first bytes mostly
        // unique within a bucket), so the outer length dispatch rejects most
        // misses on a single usize compare and the inner byte-slice match
        // compiles to a handful of word compares — cheaper than phf's hash +
        // displacement-table probe + verify on every header.
        Some(match name.len() {
            4 => match &*lower {
                b"host" => Class::Host,
                b"date" => Class::idx(b"date", Qpack::Date),
                b"etag" => Class::idx(b"etag", Qpack::Etag),
                b"link" => Class::idx(b"link", Qpack::Link),
                b"vary" => Class::idx(b"vary", Qpack::Vary),
                _ => return None,
            },
            5 => match &*lower {
                b"range" => Class::idx(b"range", Qpack::Range),
                _ => return None,
            },
            6 => match &*lower {
                b"accept" => Class::idx(b"accept", Qpack::Accept),
                b"cookie" => Class::idx(b"cookie", Qpack::Cookie),
                b"origin" => Class::idx(b"origin", Qpack::Origin),
                b"server" => Class::idx(b"server", Qpack::Server),
                _ => return None,
            },
            7 => match &*lower {
                b"referer" => Class::idx(b"referer", Qpack::Referer),
                b"upgrade" => Class::Forbidden,
                _ => return None,
            },
            8 => match &*lower {
                b"if-range" => Class::idx(b"if-range", Qpack::IfRange),
                b"location" => Class::idx(b"location", Qpack::Location),
                _ => return None,
            },
            9 => match &*lower {
                b"forwarded" => Class::idx(b"forwarded", Qpack::Forwarded),
                _ => return None,
            },
            10 => match &*lower {
                b"connection" => Class::Forbidden,
                b"keep-alive" => Class::Forbidden,
                b"set-cookie" => Class::idx(b"set-cookie", Qpack::SetCookie),
                b"user-agent" => Class::idx(b"user-agent", Qpack::UserAgent),
                _ => return None,
            },
            12 => match &*lower {
                b"content-type" => Class::idx(b"content-type", Qpack::ContentType),
                _ => return None,
            },
            13 => match &*lower {
                b"accept-ranges" => Class::idx(b"accept-ranges", Qpack::AcceptRanges),
                b"authorization" => Class::idx(b"authorization", Qpack::Authorization),
                b"cache-control" => Class::idx(b"cache-control", Qpack::CacheControl),
                b"if-none-match" => Class::idx(b"if-none-match", Qpack::IfNoneMatch),
                b"last-modified" => Class::idx(b"last-modified", Qpack::LastModified),
                _ => return None,
            },
            14 => match &*lower {
                b"content-length" => Class::idx(b"content-length", Qpack::ContentLength),
                _ => return None,
            },
            15 => match &*lower {
                b"accept-encoding" => Class::idx(b"accept-encoding", Qpack::AcceptEncoding),
                b"accept-language" => Class::idx(b"accept-language", Qpack::AcceptLanguage),
                b"x-forwarded-for" => Class::idx(b"x-forwarded-for", Qpack::XForwardedFor),
                _ => return None,
            },
            16 => match &*lower {
                b"content-encoding" => Class::idx(b"content-encoding", Qpack::ContentEncoding),
                b"proxy-connection" => Class::Forbidden,
                _ => return None,
            },
            17 => match &*lower {
                b"if-modified-since" => Class::idx(b"if-modified-since", Qpack::IfModifiedSince),
                b"transfer-encoding" => Class::Forbidden,
                _ => return None,
            },
            19 => match &*lower {
                b"content-disposition" => {
                    Class::idx(b"content-disposition", Qpack::ContentDisposition)
                }
                _ => return None,
            },
            _ => return None,
        })
    }
}

#[cfg(test)]
mod classify_tests {
    use super::{Class, Qpack};

    // Exhaustive check that the length-gated match preserves the exact
    // (key → Class) mapping the phf::Map encoded, including case-folding.
    const ENTRIES: &[(&[u8], Class)] = &[
        (b"connection", Class::Forbidden),
        (b"host", Class::Host),
        (b"keep-alive", Class::Forbidden),
        (b"proxy-connection", Class::Forbidden),
        (b"transfer-encoding", Class::Forbidden),
        (b"upgrade", Class::Forbidden),
        (b"accept", Class::idx(b"accept", Qpack::Accept)),
        (
            b"accept-encoding",
            Class::idx(b"accept-encoding", Qpack::AcceptEncoding),
        ),
        (
            b"accept-language",
            Class::idx(b"accept-language", Qpack::AcceptLanguage),
        ),
        (
            b"accept-ranges",
            Class::idx(b"accept-ranges", Qpack::AcceptRanges),
        ),
        (
            b"authorization",
            Class::idx(b"authorization", Qpack::Authorization),
        ),
        (
            b"cache-control",
            Class::idx(b"cache-control", Qpack::CacheControl),
        ),
        (
            b"content-disposition",
            Class::idx(b"content-disposition", Qpack::ContentDisposition),
        ),
        (
            b"content-encoding",
            Class::idx(b"content-encoding", Qpack::ContentEncoding),
        ),
        (
            b"content-length",
            Class::idx(b"content-length", Qpack::ContentLength),
        ),
        (
            b"content-type",
            Class::idx(b"content-type", Qpack::ContentType),
        ),
        (b"cookie", Class::idx(b"cookie", Qpack::Cookie)),
        (b"date", Class::idx(b"date", Qpack::Date)),
        (b"etag", Class::idx(b"etag", Qpack::Etag)),
        (b"forwarded", Class::idx(b"forwarded", Qpack::Forwarded)),
        (
            b"if-modified-since",
            Class::idx(b"if-modified-since", Qpack::IfModifiedSince),
        ),
        (
            b"if-none-match",
            Class::idx(b"if-none-match", Qpack::IfNoneMatch),
        ),
        (b"if-range", Class::idx(b"if-range", Qpack::IfRange)),
        (
            b"last-modified",
            Class::idx(b"last-modified", Qpack::LastModified),
        ),
        (b"link", Class::idx(b"link", Qpack::Link)),
        (b"location", Class::idx(b"location", Qpack::Location)),
        (b"origin", Class::idx(b"origin", Qpack::Origin)),
        (b"range", Class::idx(b"range", Qpack::Range)),
        (b"referer", Class::idx(b"referer", Qpack::Referer)),
        (b"server", Class::idx(b"server", Qpack::Server)),
        (b"set-cookie", Class::idx(b"set-cookie", Qpack::SetCookie)),
        (b"user-agent", Class::idx(b"user-agent", Qpack::UserAgent)),
        (b"vary", Class::idx(b"vary", Qpack::Vary)),
        (
            b"x-forwarded-for",
            Class::idx(b"x-forwarded-for", Qpack::XForwardedFor),
        ),
    ];

    fn eq(a: Class, b: Class) -> bool {
        match (a, b) {
            (Class::Forbidden, Class::Forbidden) | (Class::Host, Class::Host) => true,
            (
                Class::Indexed {
                    name: an,
                    index: ai,
                },
                Class::Indexed {
                    name: bn,
                    index: bi,
                },
            ) => an == bn && ai == bi,
            _ => false,
        }
    }

    #[test]
    fn all_entries_hit() {
        for &(k, v) in ENTRIES {
            let got = Qpack::classify(k).expect("known key must hit");
            assert!(eq(got, v), "mismatch for {:?}", bstr::BStr::new(k));
            // Mixed-case must fold.
            let upper: Vec<u8> = k.iter().map(u8::to_ascii_uppercase).collect();
            let got = Qpack::classify(&upper).expect("uppercase must hit");
            assert!(
                eq(got, v),
                "case-fold mismatch for {:?}",
                bstr::BStr::new(k)
            );
        }
    }

    #[test]
    fn misses() {
        for k in [
            b"" as &[u8],
            b"hos",
            b"hosts",
            b"content-typ",
            b"content-types",
            b"x-custom-header",
            b"a-very-long-header-name-that-exceeds-nineteen",
        ] {
            assert!(Qpack::classify(k).is_none(), "expected miss for {:?}", k);
        }
    }
}

// ported from: src/uws_sys/quic/Header.zig
