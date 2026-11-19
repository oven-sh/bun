//! `us_quic_header_t`, and the names in the static table of QPACK (RFC 9204 Appendix A). Passing the index lets the
//! encoder skip its lookup; the canonical lowercase name string is the map key, so a hit also avoids lowercasing on
//! the caller side.

use core::ffi::{c_int, c_uint};

use bun_core::ffi::slice;
use bun_quic::http3::{self, Indexing};

#[repr(C)]
pub(crate) struct Header {
    pub(crate) name: *const u8,
    pub(crate) name_len: c_uint,
    pub(crate) value: *const u8,
    pub(crate) value_len: c_uint,
    pub(crate) qpack_index: c_int, // default -1
}

bun_core::assert_ffi_layout!(Header, 32, 8; name_len @ 8, value @ 16, value_len @ 24, qpack_index @ 28);

impl Header {
    /// # Safety
    /// The name and the value are valid for their lengths.
    #[inline]
    pub(super) unsafe fn to_field(&self) -> http3::Header<'_> {
        // SAFETY: the caller's.
        let (name, value) = unsafe {
            (
                slice(self.name, self.name_len as usize),
                slice(self.value, self.value_len as usize),
            )
        };
        http3::Header {
            static_index: u8::try_from(self.qpack_index).ok(),
            ..field(name, value, None)
        }
    }

    pub(crate) fn init(name: &[u8], value: &[u8]) -> Header {
        Header {
            name: name.as_ptr(),
            name_len: c_uint::try_from(name.len()).expect("int cast"),
            value: value.as_ptr(),
            value_len: c_uint::try_from(value.len()).expect("int cast"),
            qpack_index: -1,
        }
    }
}

#[inline]
pub fn field<'a>(name: &'a [u8], value: &'a [u8], index: Option<Qpack>) -> http3::Header<'a> {
    http3::Header {
        name,
        value,
        static_index: index.map(|it| it as u8),
        // RFC 9204 §7.1.3.
        indexing: match name {
            b"authorization" | b"cookie" | b"proxy-authorization" | b"set-cookie" => {
                Indexing::Never
            }
            _ => Indexing::Allowed,
        },
    }
}

/// Only the entries that a request encoder emits are named.
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

bun_core::comptime_string_map! {
    /// Header-name → encoding disposition. Keys are the canonical lowercase
    /// names; `build_request` produces mixed-case names ("Transfer-Encoding",
    /// "Host", …), so lookups go through `get_ascii_case_insensitive`.
    static CLASS_MAP: Class = {
        b"host" => Class::Host,
        b"date" => Class::idx(b"date", Qpack::Date),
        b"etag" => Class::idx(b"etag", Qpack::Etag),
        b"link" => Class::idx(b"link", Qpack::Link),
        b"vary" => Class::idx(b"vary", Qpack::Vary),
        b"range" => Class::idx(b"range", Qpack::Range),
        b"accept" => Class::idx(b"accept", Qpack::Accept),
        b"cookie" => Class::idx(b"cookie", Qpack::Cookie),
        b"origin" => Class::idx(b"origin", Qpack::Origin),
        b"server" => Class::idx(b"server", Qpack::Server),
        b"referer" => Class::idx(b"referer", Qpack::Referer),
        b"upgrade" => Class::Forbidden,
        b"if-range" => Class::idx(b"if-range", Qpack::IfRange),
        b"location" => Class::idx(b"location", Qpack::Location),
        b"forwarded" => Class::idx(b"forwarded", Qpack::Forwarded),
        b"connection" => Class::Forbidden,
        b"keep-alive" => Class::Forbidden,
        b"set-cookie" => Class::idx(b"set-cookie", Qpack::SetCookie),
        b"user-agent" => Class::idx(b"user-agent", Qpack::UserAgent),
        b"content-type" => Class::idx(b"content-type", Qpack::ContentType),
        b"accept-ranges" => Class::idx(b"accept-ranges", Qpack::AcceptRanges),
        b"authorization" => Class::idx(b"authorization", Qpack::Authorization),
        b"cache-control" => Class::idx(b"cache-control", Qpack::CacheControl),
        b"if-none-match" => Class::idx(b"if-none-match", Qpack::IfNoneMatch),
        b"last-modified" => Class::idx(b"last-modified", Qpack::LastModified),
        b"content-length" => Class::idx(b"content-length", Qpack::ContentLength),
        b"accept-encoding" => Class::idx(b"accept-encoding", Qpack::AcceptEncoding),
        b"accept-language" => Class::idx(b"accept-language", Qpack::AcceptLanguage),
        b"x-forwarded-for" => Class::idx(b"x-forwarded-for", Qpack::XForwardedFor),
        b"content-encoding" => Class::idx(b"content-encoding", Qpack::ContentEncoding),
        b"proxy-connection" => Class::Forbidden,
        b"if-modified-since" => Class::idx(b"if-modified-since", Qpack::IfModifiedSince),
        b"transfer-encoding" => Class::Forbidden,
        b"content-disposition" => Class::idx(b"content-disposition", Qpack::ContentDisposition),
    };
}

impl Qpack {
    /// Case-insensitive header-name → encoding disposition. None means the
    /// name is neither forbidden nor in the static table; lowercase it and
    /// send with no index hint.
    pub fn classify(name: &[u8]) -> Option<Class> {
        CLASS_MAP.get_ascii_case_insensitive(name).copied()
    }
}

#[cfg(test)]
mod classify_tests {
    use super::{Class, Qpack};

    // Exhaustive check of the (key → Class) mapping against an independent
    // expected table, including case-folding.
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
