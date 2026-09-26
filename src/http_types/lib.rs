#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod ETag;
pub mod Encoding;
pub mod FetchCacheMode;
pub mod FetchRedirect;
pub mod FetchRequestMode;
pub mod Method;
pub mod URLPath;
pub mod h2;
pub mod mime_type_list_enum;
mod mime_type_list_sorted;
pub use ETag::wtf;

// `mime_type_list_enum::MimeTypeList` is a hand-generated `&'static str`
// newtype (PERF: stand-in for a packed-u14 table), so
// `Table`/`Compact`/`EXTENSIONS`/`sniff`/`from_table` all compile.
pub mod MimeType;

/// RFC 9110 Content-Length is
/// `1*DIGIT`, so any parse failure (empty / non-digit / overflow) maps to 0.
/// This wrapper gives ONE call shape across
/// bun_http / bun_runtime::server / s3.
#[inline]
pub fn parse_content_length(value: &[u8]) -> usize {
    bun_core::parse_int::<usize>(value, 10).unwrap_or(0)
}

/// RFC 9110 §8.6 `1*DIGIT`, strictly: `None` for anything else, or a value that overflows `u64`.
pub fn parse_content_length_strict(value: &[u8]) -> Option<u64> {
    if value.is_empty() {
        return None;
    }
    let mut n: u64 = 0;
    for &c in value {
        if !c.is_ascii_digit() {
            return None;
        }
        n = n.checked_mul(10)?.checked_add(u64::from(c - b'0'))?;
    }
    Some(n)
}

/// A response `:status` as nghttp2 and nghttp3 take it: three digits, 100 to 999, never 101 (RFC 9113 §8.6, RFC 9114 §4.5).
pub fn parse_status_pseudo_header(value: &[u8]) -> Option<u16> {
    let &[a @ b'1'..=b'9', b @ b'0'..=b'9', c @ b'0'..=b'9'] = value else {
        return None;
    };
    let status = u16::from(a - b'0') * 100 + u16::from(b - b'0') * 10 + u16::from(c - b'0');
    (status != 101).then_some(status)
}

#[cfg(test)]
mod tests {
    use super::parse_status_pseudo_header;

    #[test]
    fn status_pseudo_header() {
        for n in 0..=999u16 {
            let text = format!("{n:03}");
            let expected = (n >= 100 && n != 101).then_some(n);
            assert_eq!(
                parse_status_pseudo_header(text.as_bytes()),
                expected,
                "{text}"
            );
        }
        let not_three_digits: [&[u8]; 10] = [
            b"",
            b"20",
            b"1000",
            b"0200",
            b"+20",
            b"2_0",
            b"2e2",
            b" 20",
            b"20 ",
            b"\xb2\xb0\xb0",
        ];
        for value in not_three_digits {
            assert_eq!(parse_status_pseudo_header(value), None, "{value:?}");
        }
    }
}
