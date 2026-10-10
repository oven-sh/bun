//! The named character references of XHTML, which JSX text and attribute strings may contain.

use bun_ast::lexer_tables::JSX_ENTITY;

/// typescript-estree's `unescapeStringLiteralText`: `text` with `&name;`, `&#10;` and `&#xA;`
/// replaced by what they stand for. What is not a known reference stays as it is. `is_espree`:
/// acorn-jsx's `jsx_readEntity`: ten characters after the `&` at most, and `String.fromCharCode`.
pub(super) fn unescape(text: &[u8], is_espree: bool) -> std::borrow::Cow<'_, [u8]> {
    use bun_core::strings::{index_of_char_usize, push_codepoint_wtf8_joined};
    let Some(first) = index_of_char_usize(text, b'&') else {
        return text.into();
    };
    let (before, mut rest) = text.split_at(first);
    let mut out = Vec::with_capacity(text.len());
    out.extend_from_slice(before);
    // `rest` starts with `&`.
    while let [_, after @ ..] = rest {
        let is_in_item = |b: &&u8| b.is_ascii_alphanumeric() || **b == b'#';
        let (item, tail) = after.split_at(after.iter().take_while(is_in_item).count());
        let decoded = match tail {
            [b';', tail @ ..] if !is_espree || item.len() < 10 => {
                code_point(item, is_espree).map(|c| (c, tail))
            }
            _ => None,
        };
        rest = match decoded {
            // Two halves make a pair, as in a string of JavaScript.
            Some((c, tail)) => {
                push_codepoint_wtf8_joined(&mut out, c);
                tail
            }
            None => {
                out.push(b'&');
                after
            }
        };
        let (plain, next) = rest.split_at(index_of_char_usize(rest, b'&').unwrap_or(rest.len()));
        out.extend_from_slice(plain);
        rest = next;
    }
    out.into()
}

/// What `&item;` stands for.
fn code_point(item: &[u8], is_espree: bool) -> Option<u32> {
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
        match is_espree {
            true => Some(value & 0xFFFF),
            false => (value <= 0x10FFFF).then_some(value),
        }
    };
    match item {
        [b'#', b'x', hex @ ..] => digits(hex, 16),
        [b'#', decimal @ ..] => digits(decimal, 10),
        _ => JSX_ENTITY.get(item).map(|&c| c as u32),
    }
}
