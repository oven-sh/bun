//! A part of a pattern without extglobs and POSIX classes, matched directly: `a*`, `*.test.*`,
//! `*.[jt]s`, `?x`. It matches what the regular expression that `minimatch` makes of it matches.

use crate::linter::space::char_len;
use smallvec::SmallVec;

enum Token {
    /// A UTF-16 code unit.
    Unit(u16),
    /// `?`
    Any,
    /// `*`
    Star,
    /// `[a-z]`, `[!a-z]`: whether it is negated, and ranges of code units.
    Class(bool, Vec<(u16, u16)>),
}

pub(super) struct GlobPart {
    tokens: Vec<Token>,
    /// It does not match `.` and `..`.
    rejects_dots: bool,
}

/// What a part is.
pub(super) enum Parsed {
    /// It has no magic: what it is without its escapes.
    Literal(Vec<u8>),
    Glob(GlobPart),
    /// A class in it can match nothing.
    Never,
    /// It needs a regular expression.
    Unsupported,
}

fn push_units(tokens: &mut Vec<Token>, character: &[u8]) {
    let (c, _) = bun_core::lexer::char_and_size(character, 0);
    let c = char::from_u32(c as u32).unwrap_or(char::REPLACEMENT_CHARACTER);
    tokens.extend(c.encode_utf16(&mut [0; 2]).iter().map(|unit| Token::Unit(*unit)));
}

/// The code unit that `character` is. `None` if it is two.
fn unit_of(character: &[u8]) -> Option<u16> {
    u16::try_from(bun_core::lexer::char_and_size(character, 0).0).ok()
}

enum Class {
    /// How long it is, and the token.
    Token(usize, Token),
    NotAClass,
    Never,
    Unsupported,
}

/// `parseClass(glob, 0)`: `glob` starts with `[`.
fn parse_class(glob: &[u8]) -> Class {
    let mut ranges: Vec<(u16, u16)> = Vec::new();
    let (mut saw_start, mut escaping, mut negate) = (false, false, false);
    let mut range_start: Option<u16> = None;
    let (mut i, mut end) = (1, 0);
    while i < glob.len() {
        let c = &glob[i..i + char_len(&glob[i..])];
        if matches!(c, b"!" | b"^") && i == 1 {
            negate = true;
            i += 1;
            continue;
        }
        if c == b"]" && saw_start && !escaping {
            end = i + 1;
            break;
        }
        saw_start = true;
        if c == b"\\" && !escaping {
            escaping = true;
            i += 1;
            continue;
        }
        if c == b"[" && !escaping && glob[i..].starts_with(b"[:") {
            return Class::Unsupported;
        }
        escaping = false;
        let Some(unit) = unit_of(c) else {
            return Class::Unsupported;
        };
        i += c.len();
        if let Some(start) = range_start.take() {
            if unit >= start {
                ranges.push((start, unit));
            }
        } else if glob[i..].starts_with(b"-]") {
            ranges.push((unit, unit));
            ranges.push((u16::from(b'-'), u16::from(b'-')));
            i += 1;
        } else if glob[i..].starts_with(b"-") {
            range_start = Some(unit);
            i += 1;
        } else {
            ranges.push((unit, unit));
        }
    }
    if end < i {
        return Class::NotAClass;
    }
    match &ranges[..] {
        [] => Class::Never,
        // A class of one character is that character, and no magic. A line terminator is not taken
        // for one.
        [(a, b)] if a == b && !negate && !matches!(a, 0x0A | 0x0D | 0x2028 | 0x2029) => Class::Token(end, Token::Unit(*a)),
        _ => Class::Token(end, Token::Class(negate, ranges)),
    }
}

/// `#parseGlob`, for a part that is the whole name of a file or a directory.
pub(super) fn parse(glob: &[u8]) -> Parsed {
    let mut tokens = Vec::with_capacity(glob.len());
    let (mut escaping, mut has_magic) = (false, false);
    let mut i = 0;
    while i < glob.len() {
        let c = &glob[i..i + char_len(&glob[i..])];
        i += c.len();
        if escaping {
            escaping = false;
            push_units(&mut tokens, c);
            continue;
        }
        match c {
            b"*" => {
                if !matches!(tokens.last(), Some(Token::Star)) {
                    tokens.push(Token::Star);
                }
                has_magic = true;
            }
            b"\\" if i == glob.len() => tokens.push(Token::Unit(u16::from(b'\\'))),
            b"\\" => escaping = true,
            b"?" => {
                tokens.push(Token::Any);
                has_magic = true;
            }
            b"[" => match parse_class(&glob[i - 1..]) {
                Class::Token(len, token) => {
                    has_magic |= matches!(token, Token::Class(..));
                    tokens.push(token);
                    i += len - 1;
                }
                Class::NotAClass => tokens.push(Token::Unit(u16::from(b'['))),
                Class::Never => return Parsed::Never,
                Class::Unsupported => return Parsed::Unsupported,
            },
            c => push_units(&mut tokens, c),
        }
    }
    if !has_magic {
        let units = tokens.iter().filter_map(|it| match it {
            Token::Unit(unit) => Some(*unit),
            _ => None,
        });
        let mut literal = Vec::with_capacity(glob.len());
        for c in char::decode_utf16(units) {
            literal.extend_from_slice(c.unwrap_or(char::REPLACEMENT_CHARACTER).encode_utf8(&mut [0; 4]).as_bytes());
        }
        return Parsed::Literal(literal);
    }
    let is_magic = |at: usize| matches!(tokens.get(at), Some(Token::Any | Token::Star | Token::Class(..)));
    let is_dot = |at: usize| matches!(tokens.get(at), Some(Token::Unit(0x2E)));
    let rejects_dots = is_magic(0) || is_dot(0) && is_magic(1) || is_dot(0) && is_dot(1) && is_magic(2);
    Parsed::Glob(GlobPart { tokens, rejects_dots })
}

impl GlobPart {
    pub(super) fn test(&self, name: &[u8]) -> bool {
        if self.rejects_dots && matches!(name, b"." | b"..") {
            return false;
        }
        let mut units: SmallVec<[u16; 64]> = SmallVec::new();
        if name.is_ascii() {
            units.extend(name.iter().map(|b| u16::from(*b)));
        } else {
            for chunk in name.utf8_chunks() {
                units.extend(chunk.valid().encode_utf16());
                units.extend(chunk.invalid().iter().map(|_| 0xFFFD));
            }
        }
        // Where to go on if the tokens after the last star do not match: that star takes one more.
        let (mut token, mut unit) = (0, 0);
        let mut retry: Option<(usize, usize)> = None;
        loop {
            let is_match = match (self.tokens.get(token), units.get(unit)) {
                (None, None) => return true,
                (Some(Token::Star), _) => {
                    retry = Some((token + 1, unit));
                    token += 1;
                    continue;
                }
                (Some(Token::Unit(expected)), Some(actual)) => expected == actual,
                (Some(Token::Any), Some(_)) => true,
                (Some(Token::Class(negate, ranges)), Some(actual)) => ranges.iter().any(|it| it.0 <= *actual && *actual <= it.1) != *negate,
                _ => false,
            };
            if is_match {
                token += 1;
                unit += 1;
                continue;
            }
            match retry {
                Some((after_star, taken)) if taken < units.len() => {
                    retry = Some((after_star, taken + 1));
                    (token, unit) = (after_star, taken + 1);
                }
                _ => return false,
            }
        }
    }
}
