use std::rc::Rc;

use bun_core::strings::{index_of, index_of_char_usize};

use super::values::{Pattern, Value};

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
            joined.into()
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
        b"repeat" => {
            let count = first?.as_number()?;
            let is_count = count >= 0.0 && count.fract() == 0.0 && count < 1024.0;
            is_count.then(|| text.repeat(count as usize))?.into()
        }
        b"indexOf" if is_ascii && args.len() == 1 => {
            let at = index_of(text, text_of_first()?);
            return Some(Value::Number(at.map_or(-1.0, |at| at as f64)));
        }
        b"includes" if args.len() == 1 => {
            return Some(Value::Boolean(index_of(text, text_of_first()?).is_some()));
        }
        b"startsWith" if args.len() == 1 => {
            return Some(Value::Boolean(text.starts_with(text_of_first()?)));
        }
        b"endsWith" if args.len() == 1 => {
            return Some(Value::Boolean(text.ends_with(text_of_first()?)));
        }
        _ => return None,
    };
    Some(Value::String(given))
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
