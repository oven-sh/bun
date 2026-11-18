use bun_engine_text::{AllocError, CodeUnit, StringBuilder, StringRef, Text, with_text};
use bun_engine_unicode::{is_line_terminator, is_str_white_space};

use crate::surrogate;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Encoding {
    Itself,
    AfterBackslash(u8),
    Hexadecimal,
}

static LATIN1_ENCODINGS: [Encoding; 256] = {
    let mut encodings = [Encoding::Itself; 256];
    let mut rest: &[u8] = b"^$\\.*+?()[]{}|/";
    while let [c, tail @ ..] = rest {
        encodings[*c as usize] = Encoding::AfterBackslash(*c);
        rest = tail;
    }
    rest = b",-=<>#&!%:;@~'`\" \xa0";
    while let [c, tail @ ..] = rest {
        encodings[*c as usize] = Encoding::Hexadecimal;
        rest = tail;
    }
    encodings[0x09] = Encoding::AfterBackslash(b't');
    encodings[0x0a] = Encoding::AfterBackslash(b'n');
    encodings[0x0b] = Encoding::AfterBackslash(b'v');
    encodings[0x0c] = Encoding::AfterBackslash(b'f');
    encodings[0x0d] = Encoding::AfterBackslash(b'r');
    encodings
};

/// RegExp.escape
pub fn escape(text: Text<'_>) -> Result<StringRef, AllocError> {
    let mut escaped = StringBuilder::with_capacity(text.len() + 8);
    with_text!(text, |units| push_escaped(&mut escaped, units));
    escaped.finish()
}

fn push_escaped<C: CodeUnit>(escaped: &mut StringBuilder, units: &[C]) {
    let (mut at, mut written) = (0, 0);
    while let Some(&unit) = units.get(at) {
        let encoding = match LATIN1_ENCODINGS.get(usize::from(unit.to_u16())) {
            _ if at == 0 && (unit.is_ascii_digit() || unit.is_ascii_alphabetic()) => {
                Encoding::Hexadecimal
            }
            Some(&encoding) => encoding,
            None if surrogate::is_surrogate(unit.to_u16()) => {
                let next = units.get(at + 1);
                if next.is_some_and(|it| surrogate::join(unit.to_u16(), it.to_u16()).is_some()) {
                    at += 2;
                    continue;
                }
                Encoding::Hexadecimal
            }
            None if is_str_white_space(unit.to_u32()) => Encoding::Hexadecimal,
            None => Encoding::Itself,
        };
        if encoding != Encoding::Itself {
            escaped.push_units(&units[written..at]);
            written = at + 1;
        }
        match encoding {
            Encoding::Itself => {}
            Encoding::AfterBackslash(letter) => escaped.push_latin1_slice(&[b'\\', letter]),
            Encoding::Hexadecimal => push_hexadecimal(escaped, unit.to_u16()),
        }
        at += 1;
    }
    escaped.push_units(&units[written..]);
}

fn push_hexadecimal(escaped: &mut StringBuilder, unit: u16) {
    let digit = |shift: u16| b"0123456789abcdef"[usize::from(unit >> shift & 15)];
    if unit.is_latin1() {
        escaped.push_latin1_slice(&[b'\\', b'x', digit(4), digit(0)]);
    } else {
        escaped.push_latin1_slice(&[b'\\', b'u', digit(12), digit(8), digit(4), digit(0)]);
    }
}

/// EscapeRegExpPattern of ECMA-262. Nothing if `source` can stand between solidi as it is.
pub fn escape_pattern(source: Text<'_>) -> Result<Option<StringRef>, AllocError> {
    if source.is_empty() {
        return Ok(Some(StringRef::from_literal("(?:)")));
    }
    with_text!(source, |units| escape_pattern_units(units))
}

fn escape_pattern_units<C: CodeUnit>(units: &[C]) -> Result<Option<StringRef>, AllocError> {
    let is_candidate = |unit: &C| unit.is(b'/') | is_line_terminator(unit.to_u32());
    if !units.iter().fold(false, |any, it| any | is_candidate(it)) {
        return Ok(None);
    }
    let mut escaped = StringBuilder::new();
    let (mut written, mut is_in_class, mut is_escaped) = (0, false, false);
    for (at, &unit) in units.iter().enumerate() {
        let replacement = match unit.to_u16() {
            0x0a => "\\n",
            0x0d => "\\r",
            0x2028 => "\\u2028",
            0x2029 => "\\u2029",
            0x2f if !is_escaped && !is_in_class => "\\/",
            _ => "",
        };
        if !replacement.is_empty() {
            if written == 0 {
                escaped.reserve(units.len() + 8);
            }
            escaped.push_units(&units[written..at - usize::from(is_escaped)]);
            escaped.push_ascii(replacement);
            written = at + 1;
        } else if !is_escaped {
            is_in_class = if is_in_class {
                !unit.is(b']')
            } else {
                unit.is(b'[')
            };
        }
        is_escaped = !is_escaped && unit.is(b'\\');
    }
    if written == 0 {
        return Ok(None);
    }
    escaped.push_units(&units[written..]);
    escaped.finish().map(Some)
}
