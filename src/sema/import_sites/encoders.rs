//! `encodeURIComponent(text)` and `btoa(text)` of a text that the build knows.

use bun_core::fmt::hex_byte_lower;
use bun_core::strings::is_valid_utf8;

/// `None`: the function throws.
pub type Encoder = fn(&[u8]) -> Option<Vec<u8>>;

pub const ENCODERS: [(&[u8], Encoder); 2] = [
    (b"encodeURIComponent", encode_uri_component),
    (b"btoa", encode_base64),
];

fn encode_uri_component(text: &[u8]) -> Option<Vec<u8>> {
    if !is_valid_utf8(text) {
        return None;
    }
    let mut encoded = Vec::with_capacity(text.len());
    for &byte in text {
        let is_mark = matches!(
            byte,
            b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
        );
        if byte.is_ascii_alphanumeric() || is_mark {
            encoded.push(byte);
        } else {
            encoded.push(b'%');
            encoded.extend(hex_byte_lower(byte).map(|digit| digit.to_ascii_uppercase()));
        }
    }
    Some(encoded)
}

fn encode_base64(text: &[u8]) -> Option<Vec<u8>> {
    const DIGITS: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let characters = core::str::from_utf8(text).ok()?.chars();
    let bytes: Option<Vec<u8>> = characters.map(|it| u8::try_from(it).ok()).collect();
    let bytes = bytes?;
    let mut encoded = Vec::with_capacity(bytes.len().div_ceil(3) * 4);
    for group in bytes.chunks(3) {
        let joined = group
            .iter()
            .fold(0, |word, &byte| word << 8 | u32::from(byte));
        let word = joined << (8 * (3 - group.len()));
        for place in 0..4 {
            encoded.push(match place <= group.len() {
                true => DIGITS[(word >> (18 - 6 * place) & 63) as usize],
                false => b'=',
            });
        }
    }
    Some(encoded)
}

#[cfg(test)]
mod tests {
    use super::{encode_base64, encode_uri_component};

    #[test]
    fn texts_are_encoded_as_the_functions_encode_them() {
        let encoded = encode_uri_component("a b;/?:@&=+$,#-_.!~*'()\u{e9}\u{20ac}".as_bytes());
        let expected = b"a%20b%3B%2F%3F%3A%40%26%3D%2B%24%2C%23-_.!~*'()%C3%A9%E2%82%AC";
        assert_eq!(encoded.as_deref(), Some(&expected[..]));
        assert_eq!(encode_uri_component(b"\xed\xa0\x80"), None);
        for (text, expected) in [
            ("", ""),
            ("a", "YQ=="),
            ("ab", "YWI="),
            ("abc", "YWJj"),
            ("abcd", "YWJjZA=="),
            ("\u{e9}", "6Q=="),
            ("\u{fb}\u{ff}\u{fe}", "+//+"),
        ] {
            let encoded = encode_base64(text.as_bytes());
            assert_eq!(encoded.as_deref(), Some(expected.as_bytes()));
        }
        assert_eq!(encode_base64("\u{20ac}".as_bytes()), None);
    }
}
