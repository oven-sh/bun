use std::rc::Rc;

use bun_core::strings::{index_of, index_of_char_usize};

use super::values::{CharacterPattern, Matcher, Pattern, Value};

pub(super) fn parse_pattern(source: &[u8], flags: &[u8]) -> Option<Pattern> {
    let is_global = match flags {
        b"" => false,
        b"g" => true,
        _ => return None,
    };
    let mut literal = Vec::with_capacity(source.len());
    let mut bytes = source.iter();
    while let Some(&byte) = bytes.next() {
        match byte {
            b'\\' => match bytes.next()? {
                &escaped if escaped.is_ascii_punctuation() => literal.push(escaped),
                _ => return None,
            },
            b'^' | b'$' | b'.' | b'*' | b'+' | b'?' | b'(' | b')' | b'[' | b'{' | b'|' => {
                return None;
            }
            byte => literal.push(byte),
        }
    }
    let literal = (!literal.is_empty()).then_some(literal)?;
    Some(Pattern {
        literal: literal.into(),
        is_global,
    })
}

fn parse_character_pattern(source: &[u8], flags: &[u8]) -> Option<CharacterPattern> {
    let is_global = match flags {
        b"" => false,
        b"g" => true,
        _ => return None,
    };
    let delimited = |open: &[u8], close: &[u8]| source.strip_prefix(open)?.strip_suffix(close);
    let set = delimited(b"[", b"]").filter(|it| !it.starts_with(b"^"));
    let group = delimited(b"(", b")").filter(|it| !it.starts_with(b"?"));
    let mut rest = set.or(group).unwrap_or(source);
    let mut characters = Vec::new();
    loop {
        let (character, length) = match *rest {
            [b'\\', escaped, ..] if escaped.is_ascii_punctuation() => (escaped, 2),
            [b'\\' | b'[' | b']' | b'(' | b')' | b'|' | b'-', ..] => return None,
            [b'^' | b'$' | b'.' | b'*' | b'+' | b'?' | b'{' | b'}', ..] if set.is_none() => {
                return None;
            }
            [character, ..] if character.is_ascii_graphic() || character == b' ' => (character, 1),
            _ => return None,
        };
        characters.push(character);
        rest = &rest[length..];
        if rest.is_empty() {
            break;
        }
        if set.is_none() {
            rest = rest.strip_prefix(b"|")?;
        }
    }
    Some(CharacterPattern {
        characters: characters.into(),
        is_captured: group.is_some(),
        is_global,
    })
}

pub(super) fn replace_characters(
    text: &[u8],
    pattern: &CharacterPattern,
    replacement: &[u8],
) -> Option<Vec<u8>> {
    let mut replaced = Vec::with_capacity(text.len());
    let mut is_done = false;
    for byte in text {
        if is_done || !pattern.characters.contains(byte) {
            replaced.push(*byte);
            continue;
        }
        let matched = std::slice::from_ref(byte);
        let mut rest = replacement;
        if pattern.is_captured {
            while let Some(at) = index_of(rest, b"$1") {
                let is_other = rest[..at].ends_with(b"$");
                if is_other || rest.get(at + 2).is_some_and(u8::is_ascii_digit) {
                    return None;
                }
                replaced.extend(expand_replacement(&rest[..at], matched)?);
                replaced.push(*byte);
                rest = &rest[at + 2..];
            }
        }
        replaced.extend(expand_replacement(rest, matched)?);
        is_done = !pattern.is_global;
    }
    Some(replaced)
}

pub(super) fn parse_matcher(source: &[u8], flags: &[u8]) -> Option<Matcher> {
    if let Some(pattern) = parse_character_pattern(source, flags) {
        return Some(Matcher::Characters(pattern));
    }
    if !flags.is_empty() {
        return None;
    }
    if source == b"\\s+" {
        return Some(Matcher::Blanks);
    }
    let literal = |source: &[u8]| parse_pattern(source, b"").map(|it| it.literal);
    if let Some(rest) = source.strip_prefix(b"^") {
        return literal(rest).map(Matcher::Start);
    }
    literal(source.strip_suffix(b"$")?).map(Matcher::End)
}

pub(super) fn is_match(text: &[u8], matcher: &Matcher) -> Option<bool> {
    match matcher {
        Matcher::Start(literal) => Some(text.starts_with(literal)),
        Matcher::End(literal) => Some(text.ends_with(literal)),
        Matcher::Blanks => text.is_ascii().then(|| text.iter().any(|&it| is_blank(it))),
        Matcher::Characters(pattern) if pattern.is_global => None,
        Matcher::Characters(it) => Some(text.iter().any(|byte| it.characters.contains(byte))),
    }
}

pub(super) fn split_at_blanks(text: &[u8]) -> Option<Vec<Value>> {
    if text.is_empty() || !text.is_ascii() {
        return None;
    }
    let mut parts = Vec::new();
    let mut rest = text;
    while let Some(at) = rest.iter().position(|&it| is_blank(it)) {
        parts.push(Value::string(&rest[..at]));
        rest = trim_start(&rest[at..]);
    }
    parts.push(Value::string(rest));
    Some(parts)
}

pub(super) fn find_matches(text: &[u8], literal: &[u8], is_global: bool) -> Vec<usize> {
    let mut found = Vec::new();
    let mut from = 0;
    while !literal.is_empty()
        && let Some(at) = index_of(&text[from..], literal)
    {
        found.push(from + at);
        from += at + literal.len();
        if !is_global {
            break;
        }
    }
    found
}

pub(super) fn expand_replacement(replacement: &[u8], matched: &[u8]) -> Option<Vec<u8>> {
    let mut expanded = Vec::with_capacity(replacement.len());
    let mut rest = replacement;
    while let Some(at) = index_of_char_usize(rest, b'$') {
        expanded.extend_from_slice(&rest[..at]);
        match rest.get(at + 1) {
            Some(b'$') => expanded.push(b'$'),
            Some(b'&') => expanded.extend_from_slice(matched),
            Some(b'`' | b'\'' | b'<' | b'0'..=b'9') => return None,
            _ => {
                expanded.push(b'$');
                rest = &rest[at + 1..];
                continue;
            }
        }
        rest = &rest[at + 2..];
    }
    expanded.extend_from_slice(rest);
    Some(expanded)
}

pub(super) fn split(text: &[u8], separator: &[u8]) -> Option<Vec<Value>> {
    if separator.is_empty() {
        let units = text.is_ascii().then(|| text.chunks(1))?;
        return Some(units.map(Value::string).collect());
    }
    let mut parts = Vec::new();
    let mut from = 0;
    for at in find_matches(text, separator, true) {
        parts.push(Value::string(&text[from..at]));
        from = at + separator.len();
    }
    parts.push(Value::string(&text[from..]));
    Some(parts)
}

fn clamp(
    index: Option<&Value>,
    length: usize,
    default: usize,
    counts_from_end: bool,
) -> Option<usize> {
    let number = match index {
        None | Some(Value::Undefined) => return Some(default),
        Some(value) => value.as_number()?,
    };
    let number = match number.is_nan() {
        true => 0.0,
        false => number.trunc(),
    };
    let number = match number < 0.0 && counts_from_end {
        true => number + length as f64,
        false => number,
    };
    Some(number.clamp(0.0, length as f64) as usize)
}

pub(super) fn call_method(text: &Rc<[u8]>, name: &[u8], args: &[Value]) -> Option<Value> {
    let is_ascii = text.is_ascii();
    let first = args.first();
    let text_of_first = || first.and_then(Value::as_string);
    let given = match name {
        b"toString" | b"valueOf" => Rc::clone(text),
        b"concat" => {
            let mut joined = text.to_vec();
            for arg in args {
                joined.extend_from_slice(&arg.to_text()?);
            }
            joined.is_ascii().then_some(joined)?.into()
        }
        b"toUpperCase" if is_ascii => text.to_ascii_uppercase().into(),
        b"toLowerCase" if is_ascii => text.to_ascii_lowercase().into(),
        b"trim" if is_ascii => trim_start(trim_end(text)).into(),
        b"trimStart" | b"trimLeft" if is_ascii => trim_start(text).into(),
        b"trimEnd" | b"trimRight" if is_ascii => trim_end(text).into(),
        b"slice" if is_ascii => {
            let start = clamp(first, text.len(), 0, true)?;
            let end = clamp(args.get(1), text.len(), text.len(), true)?;
            text[start..end.max(start)].into()
        }
        b"substring" if is_ascii => {
            let start = clamp(first, text.len(), 0, false)?;
            let end = clamp(args.get(1), text.len(), text.len(), false)?;
            text[start.min(end)..start.max(end)].into()
        }
        b"substr" if is_ascii => {
            let start = clamp(first, text.len(), 0, true)?;
            let length = clamp(args.get(1), text.len() - start, text.len() - start, false)?;
            text[start..start + length].into()
        }
        b"charAt" if is_ascii => {
            let index = first.map_or(Some(0.0), Value::as_number)?;
            let byte = (index >= 0.0 && index.fract() == 0.0).then(|| text.get(index as usize))?;
            byte.map_or(&[][..], std::slice::from_ref).into()
        }
        b"repeat" if is_ascii => {
            let count = first?.as_number()?;
            let is_count = count >= 0.0 && count.fract() == 0.0 && count < 1024.0;
            is_count.then(|| text.repeat(count as usize))?.into()
        }
        b"indexOf" if is_ascii && args.len() == 1 => {
            let at = find(text, text_of_first()?);
            return Some(Value::Number(at.map_or(-1.0, |at| at as f64)));
        }
        b"includes" if is_ascii && args.len() == 1 => {
            return Some(Value::Boolean(find(text, text_of_first()?).is_some()));
        }
        b"startsWith" if is_ascii && args.len() == 1 => {
            return Some(Value::Boolean(text.starts_with(text_of_first()?)));
        }
        b"endsWith" if is_ascii && args.len() == 1 => {
            return Some(Value::Boolean(text.ends_with(text_of_first()?)));
        }
        _ => return None,
    };
    Some(Value::String(given))
}

fn find(text: &[u8], searched: &[u8]) -> Option<usize> {
    match searched.is_empty() {
        true => Some(0),
        false => index_of(text, searched),
    }
}

fn is_blank(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C)
}

fn trim_start(text: &[u8]) -> &[u8] {
    let start = text.iter().position(|&byte| !is_blank(byte));
    &text[start.unwrap_or(text.len())..]
}

fn trim_end(text: &[u8]) -> &[u8] {
    let last = text.iter().rposition(|&byte| !is_blank(byte));
    &text[..last.map_or(0, |last| last + 1)]
}
