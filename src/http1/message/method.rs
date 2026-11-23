pub(super) const GET: u8 = 1;
pub(super) const POST: u8 = 3;
pub(super) const CONNECT: u8 = 5;
pub(super) const OPTIONS: u8 = 6;
pub(super) const SOURCE: u8 = 33;
pub(super) const PRI: u8 = 34;
pub(super) const DESCRIBE: u8 = 35;
pub(super) const FLUSH: u8 = 45;

// Keep in sync with `binding(m: "http_parser")` in packages/bun-types/overrides.d.ts.
bun_core::comptime_string_map! {
    pub(super) static METHODS: u8 = {
        "DELETE" => 0,
        "GET" => GET,
        "HEAD" => 2,
        "POST" => POST,
        "PUT" => 4,
        "CONNECT" => CONNECT,
        "OPTIONS" => OPTIONS,
        "TRACE" => 7,
        "COPY" => 8,
        "LOCK" => 9,
        "MKCOL" => 10,
        "MOVE" => 11,
        "PROPFIND" => 12,
        "PROPPATCH" => 13,
        "SEARCH" => 14,
        "UNLOCK" => 15,
        "BIND" => 16,
        "REBIND" => 17,
        "UNBIND" => 18,
        "ACL" => 19,
        "REPORT" => 20,
        "MKACTIVITY" => 21,
        "CHECKOUT" => 22,
        "MERGE" => 23,
        "M-SEARCH" => 24,
        "NOTIFY" => 25,
        "SUBSCRIBE" => 26,
        "UNSUBSCRIBE" => 27,
        "PATCH" => 28,
        "PURGE" => 29,
        "MKCALENDAR" => 30,
        "LINK" => 31,
        "UNLINK" => 32,
        "SOURCE" => SOURCE,
        "PRI" => PRI,
        "DESCRIBE" => DESCRIBE,
        "ANNOUNCE" => 36,
        "SETUP" => 37,
        "PLAY" => 38,
        "PAUSE" => 39,
        "TEARDOWN" => 40,
        "GET_PARAMETER" => 41,
        "SET_PARAMETER" => 42,
        "REDIRECT" => 43,
        "RECORD" => 44,
        "FLUSH" => FLUSH,
        "QUERY" => 46,
    };
}

/// What a request line can start with. A method is the position of its name.
pub fn method_names() -> impl Iterator<Item = &'static [u8]> {
    METHODS.keys()
}

/// Whether an HTTP/1 message can have the method.
pub fn is_http1_method(method: u8) -> bool {
    !(PRI..=FLUSH).contains(&method)
}

/// The start of a name that is `prefix` and then `byte`.
pub(super) fn extend_prefix(prefix: &[u8], byte: u8) -> Option<&'static [u8]> {
    method_names()
        .find(|name| matches!(name.strip_prefix(prefix), Some([next, ..]) if *next == byte))?
        .get(..=prefix.len())
}
