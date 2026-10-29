//! The static table (Appendix A).

pub(crate) const LEN: u32 = 61;

/// Each name with the index of its first entry and the values of its entries, which follow each other.
macro_rules! static_table {
    ($($first_index:tt: $name:tt => [$($value:tt),+],)*) => {
        const ENTRIES: [(&[u8], &[u8]); LEN as usize] = [$($(($name, $value),)+)*];

        bun_core::comptime_string_map! {
            static FIRST_INDEX_OF_NAME: u32 = { $($name => $first_index,)* };
        }
    };
}

static_table! {
    1: b":authority" => [b""],
    2: b":method" => [b"GET", b"POST"],
    4: b":path" => [b"/", b"/index.html"],
    6: b":scheme" => [b"http", b"https"],
    8: b":status" => [b"200", b"204", b"206", b"304", b"400", b"404", b"500"],
    15: b"accept-charset" => [b""],
    16: b"accept-encoding" => [b"gzip, deflate"],
    17: b"accept-language" => [b""],
    18: b"accept-ranges" => [b""],
    19: b"accept" => [b""],
    20: b"access-control-allow-origin" => [b""],
    21: b"age" => [b""],
    22: b"allow" => [b""],
    23: b"authorization" => [b""],
    24: b"cache-control" => [b""],
    25: b"content-disposition" => [b""],
    26: b"content-encoding" => [b""],
    27: b"content-language" => [b""],
    28: b"content-length" => [b""],
    29: b"content-location" => [b""],
    30: b"content-range" => [b""],
    31: b"content-type" => [b""],
    32: b"cookie" => [b""],
    33: b"date" => [b""],
    34: b"etag" => [b""],
    35: b"expect" => [b""],
    36: b"expires" => [b""],
    37: b"from" => [b""],
    38: b"host" => [b""],
    39: b"if-match" => [b""],
    40: b"if-modified-since" => [b""],
    41: b"if-none-match" => [b""],
    42: b"if-range" => [b""],
    43: b"if-unmodified-since" => [b""],
    44: b"last-modified" => [b""],
    45: b"link" => [b""],
    46: b"location" => [b""],
    47: b"max-forwards" => [b""],
    48: b"proxy-authenticate" => [b""],
    49: b"proxy-authorization" => [b""],
    50: b"range" => [b""],
    51: b"referer" => [b""],
    52: b"refresh" => [b""],
    53: b"retry-after" => [b""],
    54: b"server" => [b""],
    55: b"set-cookie" => [b""],
    56: b"strict-transport-security" => [b""],
    57: b"transfer-encoding" => [b""],
    58: b"user-agent" => [b""],
    59: b"vary" => [b""],
    60: b"via" => [b""],
    61: b"www-authenticate" => [b""],
}

/// `index` counts from 1, as on the wire.
pub(crate) fn get(index: u32) -> Option<(&'static [u8], &'static [u8])> {
    ENTRIES.get((index as usize).checked_sub(1)?).copied()
}

pub(crate) fn find_name(name: &[u8]) -> Option<u32> {
    FIRST_INDEX_OF_NAME.get(name).copied()
}

/// `name_index` is what [`find_name`] gave for `name`.
pub(crate) fn find(name_index: u32, name: &[u8], value: &[u8]) -> Option<u32> {
    for index in name_index..=LEN {
        let (entry_name, entry_value) = get(index)?;
        if entry_name != name {
            break;
        }
        if entry_value == value {
            return Some(index);
        }
    }
    None
}
