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
    pub fn init(name_: &[u8], value_: &[u8], idx: Option<Qpack>) -> Header {
        Header {
            name: name_.as_ptr(),
            name_len: c_uint::try_from(name_.len()).unwrap(),
            value: value_.as_ptr(),
            value_len: c_uint::try_from(value_.len()).unwrap(),
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
        // TODO(port): Zig used `ComptimeStringMap.getAnyCase` (ASCII
        // case-insensitive). phf::Map is case-sensitive — needs a custom
        // hasher or pre-lowercased lookup in Phase B.
        MAP.get(name).copied()
    }
}

static MAP: phf::Map<&'static [u8], Class> = phf::phf_map! {
    b"connection" => Class::Forbidden,
    b"host" => Class::Host,
    b"keep-alive" => Class::Forbidden,
    b"proxy-connection" => Class::Forbidden,
    b"transfer-encoding" => Class::Forbidden,
    b"upgrade" => Class::Forbidden,

    b"accept" => Class::idx(b"accept", Qpack::Accept),
    b"accept-encoding" => Class::idx(b"accept-encoding", Qpack::AcceptEncoding),
    b"accept-language" => Class::idx(b"accept-language", Qpack::AcceptLanguage),
    b"accept-ranges" => Class::idx(b"accept-ranges", Qpack::AcceptRanges),
    b"authorization" => Class::idx(b"authorization", Qpack::Authorization),
    b"cache-control" => Class::idx(b"cache-control", Qpack::CacheControl),
    b"content-disposition" => Class::idx(b"content-disposition", Qpack::ContentDisposition),
    b"content-encoding" => Class::idx(b"content-encoding", Qpack::ContentEncoding),
    b"content-length" => Class::idx(b"content-length", Qpack::ContentLength),
    b"content-type" => Class::idx(b"content-type", Qpack::ContentType),
    b"cookie" => Class::idx(b"cookie", Qpack::Cookie),
    b"date" => Class::idx(b"date", Qpack::Date),
    b"etag" => Class::idx(b"etag", Qpack::Etag),
    b"forwarded" => Class::idx(b"forwarded", Qpack::Forwarded),
    b"if-modified-since" => Class::idx(b"if-modified-since", Qpack::IfModifiedSince),
    b"if-none-match" => Class::idx(b"if-none-match", Qpack::IfNoneMatch),
    b"if-range" => Class::idx(b"if-range", Qpack::IfRange),
    b"last-modified" => Class::idx(b"last-modified", Qpack::LastModified),
    b"link" => Class::idx(b"link", Qpack::Link),
    b"location" => Class::idx(b"location", Qpack::Location),
    b"origin" => Class::idx(b"origin", Qpack::Origin),
    b"range" => Class::idx(b"range", Qpack::Range),
    b"referer" => Class::idx(b"referer", Qpack::Referer),
    b"server" => Class::idx(b"server", Qpack::Server),
    b"set-cookie" => Class::idx(b"set-cookie", Qpack::SetCookie),
    b"user-agent" => Class::idx(b"user-agent", Qpack::UserAgent),
    b"vary" => Class::idx(b"vary", Qpack::Vary),
    b"x-forwarded-for" => Class::idx(b"x-forwarded-for", Qpack::XForwardedFor),
};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/quic/Header.zig (120 lines)
//   confidence: medium
//   todos:      2
//   notes:      Zig enum is non-exhaustive (`_`); map lookup was case-insensitive (getAnyCase) — phf needs custom hasher or pre-lowercase in Phase B
// ──────────────────────────────────────────────────────────────────────────
