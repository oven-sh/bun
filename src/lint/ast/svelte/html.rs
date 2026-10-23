//! Svelte's `decode_character_references` (`src/compiler/phases/1-parse/utils/html.js`, MIT License: see LICENSE.md):
//! how its parser computes the `data` of a text and of a part of an attribute value.
//!
//! Svelte's named reference table (`entities.js`) is HTML's: each name with a `;` maps to the first code point HTML has
//! for it, which is what `bun_md` looks up, and the legacy names below also work without one. Its pattern tries longer
//! names first.

use std::borrow::Cow;

/// The names in Svelte's entity table without a `;`.
const ENTITIES_WITHOUT_SEMICOLON: &[&[u8]] = &[
    b"Aacute", b"Agrave", b"Atilde", b"Ccedil", b"Eacute", b"Egrave", b"Iacute", b"Igrave",
    b"Ntilde", b"Oacute", b"Ograve", b"Oslash", b"Otilde", b"Uacute", b"Ugrave", b"Yacute",
    b"aacute", b"agrave", b"atilde", b"brvbar", b"ccedil", b"curren", b"divide", b"eacute",
    b"egrave", b"frac12", b"frac14", b"frac34", b"iacute", b"igrave", b"iquest", b"middot",
    b"ntilde", b"oacute", b"ograve", b"oslash", b"otilde", b"plusmn", b"uacute", b"ugrave",
    b"yacute", b"AElig", b"Acirc", b"Aring", b"Ecirc", b"Icirc", b"Ocirc", b"THORN", b"Ucirc",
    b"acirc", b"acute", b"aelig", b"aring", b"cedil", b"ecirc", b"icirc", b"iexcl", b"laquo",
    b"micro", b"ocirc", b"pound", b"raquo", b"szlig", b"thorn", b"times", b"ucirc", b"Auml",
    b"COPY", b"Euml", b"Iuml", b"Ouml", b"QUOT", b"Uuml", b"auml", b"cent", b"copy", b"euml",
    b"iuml", b"macr", b"nbsp", b"ordf", b"ordm", b"ouml", b"para", b"quot", b"sect", b"sup1",
    b"sup2", b"sup3", b"uuml", b"yuml", b"AMP", b"ETH", b"REG", b"amp", b"deg", b"eth", b"not",
    b"reg", b"shy", b"uml", b"yen", b"GT", b"LT", b"gt", b"lt",
];

/// Svelte's `windows_1252`: what code points 128 to 159 in a reference stand for.
const WINDOWS_1252: [u32; 32] = [
    8364, 129, 8218, 402, 8222, 8230, 8224, 8225, 710, 8240, 352, 8249, 338, 141, 381, 143, 144,
    8216, 8217, 8220, 8221, 8226, 8211, 8212, 732, 8482, 353, 8250, 339, 157, 382, 376,
];

/// `raw` with its character references decoded, as in a `Text`'s `data` in an attribute value (`is_attribute_value`) or
/// in the markup.
pub fn decode_character_references(raw: &[u8], is_attribute_value: bool) -> Cow<'_, [u8]> {
    if !bun_core::strings::contains_char(raw, b'&') {
        return Cow::Borrowed(raw);
    }
    let mut out = Vec::with_capacity(raw.len());
    let mut at = 0;
    while let Some(found) = bun_core::strings::index_of_char_usize(&raw[at..], b'&') {
        let start = at + found;
        out.extend_from_slice(&raw[at..start]);
        let rest = &raw[start + 1..];
        match reference_at(rest, is_attribute_value) {
            Some((code, length)) if code != 0 => {
                let code = validate_code(code, is_attribute_value);
                let c = char::from_u32(code).unwrap_or('\0');
                out.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
                at = start + 1 + length;
            }
            Some((_, length)) => {
                out.extend_from_slice(&raw[start..start + 1 + length]);
                at = start + 1 + length;
            }
            None => {
                out.push(b'&');
                at = start + 1;
            }
        }
    }
    out.extend_from_slice(&raw[at..]);
    Cow::Owned(out)
}

/// The code point and length of the reference at the start of `rest`, after an `&`, as Svelte's pattern finds it.
fn reference_at(rest: &[u8], is_attribute_value: bool) -> Option<(u32, usize)> {
    if let Some(number) = rest.strip_prefix(b"#") {
        let (radix, digits) = match number {
            [b'x' | b'X', digits @ ..] => (16, digits),
            _ => (10, number),
        };
        let count = digits
            .iter()
            .take_while(|it| (**it as char).is_digit(radix))
            .count();
        if count == 0 {
            return None;
        }
        let code = digits[..count].iter().fold(0u32, |code, digit| {
            let digit = (*digit as char).to_digit(radix).unwrap_or(0);
            code.saturating_mul(radix).saturating_add(digit)
        });
        let semicolon = usize::from(digits.get(count) == Some(&b';'));
        return Some((code, rest.len() - digits.len() + count + semicolon));
    }
    let word = rest
        .iter()
        .take_while(|it| it.is_ascii_alphanumeric() || **it == b'_')
        .count();
    let name = &rest[..word];
    if rest.get(word) == Some(&b';')
        && let Some(code) = first_code_point(name)
    {
        return Some((code, word + 1));
    }
    let without_semicolon = ENTITIES_WITHOUT_SEMICOLON.contains(&name)
        && (!is_attribute_value || rest.get(word) != Some(&b'='));
    if without_semicolon {
        return Some((first_code_point(name)?, word));
    }
    if is_attribute_value {
        return None;
    }
    // In the markup, a name without a `;` is decoded even where a longer word starts with it.
    let longest = ENTITIES_WITHOUT_SEMICOLON
        .iter()
        .filter(|it| name.starts_with(it))
        .max_by_key(|it| it.len())?;
    Some((first_code_point(longest)?, longest.len()))
}

/// The first code point of the named reference `&name;`.
fn first_code_point(name: &[u8]) -> Option<u32> {
    // The longest name, `CounterClockwiseContourIntegral`, has 31 letters.
    let mut reference = [0; 33];
    let written = reference.get_mut(..name.len() + 2)?;
    written[0] = b'&';
    written[1..=name.len()].copy_from_slice(name);
    written[name.len() + 1] = b';';
    let mut out = [0; 8];
    let decoded = bun_md::helpers::decode_entity_to_utf8(written, &mut out)?;
    std::str::from_utf8(decoded)
        .ok()?
        .chars()
        .next()
        .map(u32::from)
}

/// Svelte's `validate_code`.
fn validate_code(code: u32, is_attribute_value: bool) -> u32 {
    match code {
        10 if !is_attribute_value => 32,
        0..128 => code,
        128..160 => WINDOWS_1252[(code - 128) as usize],
        160..0xD800 => code,
        0xD800..0xE000 => 0,
        0xE000..0x30000 => code,
        0xE0000..0xE0080 | 0xE0100..0xE01F0 => code,
        _ => 0,
    }
}
