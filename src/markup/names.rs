//! <https://www.w3.org/TR/xml/#sec-common-syn>

use bun_collections::hashbrown::HashSet;

use crate::{Chars, Text};

/// Without the colon.
pub fn is_name_start(code: u32) -> bool {
    matches!(code, 0x41..=0x5a | 0x5f | 0x61..=0x7a | 0xc0..=0xd6 | 0xd8..=0xf6 | 0xf8..=0x2ff | 0x370..=0x37d
        | 0x37f..=0x1fff | 0x200c | 0x200d | 0x2070..=0x218f | 0x2c00..=0x2fef | 0x3001..=0xd7ff | 0xf900..=0xfdcf
        | 0xfdf0..=0xfffd | 0x10000..=0xeffff)
}

pub fn is_name_part(code: u32) -> bool {
    is_name_start(code)
        || matches!(code, 0x2d | 0x2e | 0x30..=0x39 | 0xb7 | 0x300..=0x36f | 0x203f | 0x2040)
}

/// How many code units of `text` are an `NCName`.
pub fn ncname_len(text: Chars<'_>) -> usize {
    let mut len = 0;
    for code in text.code_points() {
        if !(if len == 0 {
            is_name_start(code)
        } else {
            is_name_part(code)
        }) {
            break;
        }
        len += if code > 0xffff { 2 } else { 1 };
    }
    len
}

pub fn is_ncname(text: Chars<'_>) -> bool {
    !text.is_empty() && ncname_len(text) == text.len()
}

/// The prefix and the local name of a `QName`.
pub fn split_qname(text: Chars<'_>) -> Option<(Option<Chars<'_>>, Chars<'_>)> {
    let (prefix, local) = match text.find(0, b':') {
        Some(colon) => (Some(text.slice(0..colon)), text.skip(colon + 1)),
        None => (None, text),
    };
    (prefix.is_none_or(is_ncname) && is_ncname(local)).then_some((prefix, local))
}

pub fn has_only_xml_characters(text: Chars<'_>) -> bool {
    text.code_points()
        .all(|it| matches!(it, 9 | 10 | 13 | 0x20..=0xd7ff | 0xe000..=0xfffd | 0x10000..))
}

fn push_reference(reference: Chars<'_>, out: &mut Text) -> Option<()> {
    let number = |digits: Chars<'_>, radix: u32| {
        let digit = |unit: u16| char::from_u32(unit.into())?.to_digit(radix);
        let code = digits.units().try_fold(0u32, |code, it| {
            code.checked_mul(radix)?.checked_add(digit(it)?)
        });
        code.filter(|it| *it <= 0x10_ffff && !digits.is_empty())
    };
    let predefined = [
        ("amp", b'&'),
        ("lt", b'<'),
        ("gt", b'>'),
        ("quot", b'"'),
        ("apos", b'\''),
    ];
    out.push_code_point(
        match predefined.iter().find(|it| reference.is(it.0.as_bytes())) {
            Some(found) => found.1.into(),
            None if reference.starts_with(b"#x") => number(reference.skip(2), 16)?,
            None if reference.starts_with(b"#") => number(reference.skip(1), 10)?,
            None => return None,
        },
    );
    Some(())
}

fn without_references(mut value: Chars<'_>) -> Text {
    let mut out = Text::with_capacity(value.len());
    while let Some(amp) = value.find(0, b'&') {
        out.push(value.slice(0..amp));
        value = value.skip(amp + 1);
        match value
            .find(0, b';')
            .filter(|end| push_reference(value.slice(0..*end), &mut out).is_some())
        {
            Some(end) => value = value.skip(end + 1),
            None => out.push_byte(b'&'),
        }
    }
    out.push(value);
    out
}

/// The names and values. <https://www.w3.org/TR/xml-stylesheet/#dt-parsing>
pub fn pseudo_attributes(data: Chars<'_>) -> Vec<(Chars<'_>, Text)> {
    let mut found: Vec<(Chars<'_>, Text)> = Vec::new();
    let mut names = HashSet::with_hasher(std::hash::RandomState::new());
    let mut rest = data.skip(data.leading_spaces());
    let mut next = || {
        let ends_name = |it: u16| matches!(it, 0 | 9 | 10 | 12 | 13 | 0x20 | 0x2f | 0x3d | 0x3e);
        let name = rest.slice(0..rest.units().position(ends_name).filter(|it| *it > 0)?);
        rest = rest.skip(name.len());
        rest = Some(rest.skip(rest.leading_spaces()))
            .filter(|it| it.starts_with(b"="))?
            .skip(1);
        rest = rest.skip(rest.leading_spaces());
        let quote = rest.get(0).filter(|it| matches!(it, 0x22 | 0x27))?;
        let value =
            Some(rest.slice(1..rest.find(1, quote as u8)?)).filter(|it| !it.contains(b'<'))?;
        rest = rest.skip(value.len() + 2);
        let spaces = rest.leading_spaces();
        rest = Some(rest.skip(spaces)).filter(|it| spaces > 0 || it.is_empty())?;
        names
            .insert(name)
            .then(|| found.push((name, without_references(value))))?;
        Some(!rest.is_empty())
    };
    loop {
        match next() {
            Some(true) => {}
            Some(false) => return found,
            None => return Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pseudo_attributes_are_all_or_nothing() {
        let parse = |data: &str| {
            let text = |it: Chars<'_>| {
                it.units()
                    .map(|it| char::from(it as u8))
                    .collect::<String>()
            };
            pseudo_attributes(data.into())
                .iter()
                .map(|it| text(it.0) + "=" + &text(it.1.chars()))
                .collect::<Vec<_>>()
        };
        assert_eq!(parse(" a = \"1&lt;&#x41;&x;&\" b='' "), ["a=1<A&x;&", "b="]);
        for wrong in [
            "",
            "a",
            "a=1",
            "a='1'b='2'",
            "a='1' a='2'",
            "a='<'",
            "a='1' ?",
        ] {
            assert!(parse(wrong).is_empty(), "{wrong}");
        }
    }
}
