//! The static table (Appendix A).

pub(crate) const LEN: u32 = 61;

const ENTRIES: [(&[u8], &[u8]); LEN as usize] = [
    (b":authority", b""),
    (b":method", b"GET"),
    (b":method", b"POST"),
    (b":path", b"/"),
    (b":path", b"/index.html"),
    (b":scheme", b"http"),
    (b":scheme", b"https"),
    (b":status", b"200"),
    (b":status", b"204"),
    (b":status", b"206"),
    (b":status", b"304"),
    (b":status", b"400"),
    (b":status", b"404"),
    (b":status", b"500"),
    (b"accept-charset", b""),
    (b"accept-encoding", b"gzip, deflate"),
    (b"accept-language", b""),
    (b"accept-ranges", b""),
    (b"accept", b""),
    (b"access-control-allow-origin", b""),
    (b"age", b""),
    (b"allow", b""),
    (b"authorization", b""),
    (b"cache-control", b""),
    (b"content-disposition", b""),
    (b"content-encoding", b""),
    (b"content-language", b""),
    (b"content-length", b""),
    (b"content-location", b""),
    (b"content-range", b""),
    (b"content-type", b""),
    (b"cookie", b""),
    (b"date", b""),
    (b"etag", b""),
    (b"expect", b""),
    (b"expires", b""),
    (b"from", b""),
    (b"host", b""),
    (b"if-match", b""),
    (b"if-modified-since", b""),
    (b"if-none-match", b""),
    (b"if-range", b""),
    (b"if-unmodified-since", b""),
    (b"last-modified", b""),
    (b"link", b""),
    (b"location", b""),
    (b"max-forwards", b""),
    (b"proxy-authenticate", b""),
    (b"proxy-authorization", b""),
    (b"range", b""),
    (b"referer", b""),
    (b"refresh", b""),
    (b"retry-after", b""),
    (b"server", b""),
    (b"set-cookie", b""),
    (b"strict-transport-security", b""),
    (b"transfer-encoding", b""),
    (b"user-agent", b""),
    (b"vary", b""),
    (b"via", b""),
    (b"www-authenticate", b""),
];

/// `index` counts from 1, as on the wire.
pub(crate) fn get(index: u32) -> Option<(&'static [u8], &'static [u8])> {
    ENTRIES.get((index as usize).checked_sub(1)?).copied()
}

bun_core::comptime_string_map! {
    /// The index of the first entry with a name. The others with that name follow it.
    static FIRST_INDEX_OF_NAME: u32 = {
        b":authority" => 1,
        b":method" => 2,
        b":path" => 4,
        b":scheme" => 6,
        b":status" => 8,
        b"accept-charset" => 15,
        b"accept-encoding" => 16,
        b"accept-language" => 17,
        b"accept-ranges" => 18,
        b"accept" => 19,
        b"access-control-allow-origin" => 20,
        b"age" => 21,
        b"allow" => 22,
        b"authorization" => 23,
        b"cache-control" => 24,
        b"content-disposition" => 25,
        b"content-encoding" => 26,
        b"content-language" => 27,
        b"content-length" => 28,
        b"content-location" => 29,
        b"content-range" => 30,
        b"content-type" => 31,
        b"cookie" => 32,
        b"date" => 33,
        b"etag" => 34,
        b"expect" => 35,
        b"expires" => 36,
        b"from" => 37,
        b"host" => 38,
        b"if-match" => 39,
        b"if-modified-since" => 40,
        b"if-none-match" => 41,
        b"if-range" => 42,
        b"if-unmodified-since" => 43,
        b"last-modified" => 44,
        b"link" => 45,
        b"location" => 46,
        b"max-forwards" => 47,
        b"proxy-authenticate" => 48,
        b"proxy-authorization" => 49,
        b"range" => 50,
        b"referer" => 51,
        b"refresh" => 52,
        b"retry-after" => 53,
        b"server" => 54,
        b"set-cookie" => 55,
        b"strict-transport-security" => 56,
        b"transfer-encoding" => 57,
        b"user-agent" => 58,
        b"vary" => 59,
        b"via" => 60,
        b"www-authenticate" => 61,
    };
}

pub(crate) fn find_name(name: &[u8]) -> Option<u32> {
    FIRST_INDEX_OF_NAME.get(name).copied()
}

/// `name_index` is what [`find_name`] gave for `name`.
pub(crate) fn find(name_index: u32, name: &[u8], value: &[u8]) -> Option<u32> {
    (name_index..=LEN)
        .map_while(|index| Some((index, get(index).filter(|entry| entry.0 == name)?.1)))
        .find_map(|(index, entry_value)| (entry_value == value).then_some(index))
}
