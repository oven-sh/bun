//! The named character references of XHTML, which JSX text and attribute strings may contain.

use bun_ast::lexer_tables::JSX_ENTITY;

/// typescript-estree's `unescapeStringLiteralText`: `text` with `&name;`, `&#10;` and `&#xA;`
/// replaced by what they stand for. What is not a known reference stays as it is.
pub(super) fn unescape(text: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings::index_of_char_usize;
    let Some(first) = index_of_char_usize(text, b'&') else {
        return text.into();
    };
    let mut out = Vec::with_capacity(text.len());
    out.extend_from_slice(&text[..first]);
    let mut rest = &text[first..];
    loop {
        // `rest` starts with `&`.
        let decoded =
            index_of_char_usize(rest, b';').and_then(|end| Some((code_point(&rest[1..end])?, end)));
        let taken = match decoded {
            Some((c, end)) => {
                push_code_point(&mut out, c);
                end + 1
            }
            None => {
                out.push(b'&');
                1
            }
        };
        rest = &rest[taken..];
        let Some(next) = index_of_char_usize(rest, b'&') else {
            out.extend_from_slice(rest);
            return out.into();
        };
        out.extend_from_slice(&rest[..next]);
        rest = &rest[next..];
    }
}

/// What `&item;` stands for.
fn code_point(item: &[u8]) -> Option<u32> {
    let digits = |digits: &[u8], radix: u32| {
        let is_digit = |b: &u8| (*b as char).is_digit(radix);
        if digits.is_empty() || !digits.iter().all(is_digit) {
            return None;
        }
        let mut value = 0u32;
        for digit in digits {
            value = value
                .saturating_mul(radix)
                .saturating_add((*digit as char).to_digit(radix)?);
        }
        (value <= 0x10FFFF).then_some(value)
    };
    match item {
        [b'#', b'x', hex @ ..] => digits(hex, 16),
        [b'#', decimal @ ..] => digits(decimal, 10),
        _ => JSX_ENTITY.get(item).map(|&c| c as u32),
    }
}

/// Appends `c` as UTF-8, a surrogate as the three bytes that WTF-8 has for it.
fn push_code_point(out: &mut Vec<u8>, c: u32) {
    match char::from_u32(c) {
        Some(c) => out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
        None => out.extend_from_slice(&[
            0xE0 | (c >> 12) as u8,
            0x80 | ((c >> 6) & 0x3F) as u8,
            0x80 | (c & 0x3F) as u8,
        ]),
    }
}
