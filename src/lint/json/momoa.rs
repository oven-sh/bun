//! Momoa's `Tokenizer`, for what is rare: a token that only JSON5 has, and what is no token. It says where such a token ends, or
//! in Momoa's words what is wrong. The tokens of ordinary JSON do not come here: see `Reader::plain` in `parse.rs`.
//!
//! Momoa reads UTF-16 code units. A character outside the Basic Multilingual Plane is two of them, neither of which is part
//! of a name.

use crate::Mode;
use bun_alloc::{Arena, ArenaVec, ArenaVecExt as _};
use bun_core::lexer::{is_identifier_part, is_identifier_start};
use bun_core::strings;

/// The `type` of a token.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Type {
    Number,
    String,
    Boolean,
    Null,
    Identifier,
    Colon,
    LBrace,
    RBrace,
    LBracket,
    RBracket,
    Comma,
    LineComment,
    BlockComment,
}

impl Type {
    pub(crate) fn name(self) -> &'static str {
        match self {
            Type::Number => "Number",
            Type::String => "String",
            Type::Boolean => "Boolean",
            Type::Null => "Null",
            Type::Identifier => "Identifier",
            Type::Colon => "Colon",
            Type::LBrace => "LBrace",
            Type::RBrace => "RBrace",
            Type::LBracket => "LBracket",
            Type::RBracket => "RBracket",
            Type::Comma => "Comma",
            Type::LineComment => "LineComment",
            Type::BlockComment => "BlockComment",
        }
    }
}

#[derive(Copy, Clone, Debug)]
pub(crate) struct Token<'a> {
    pub(crate) kind: Type,
    pub(crate) start: usize,
    pub(crate) end: usize,
    /// What a string or an identifier stands for.
    pub(crate) value: &'a [u8],
}

/// An `ErrorWithLocation`
#[derive(Debug)]
pub(crate) struct Failure {
    pub(crate) message: Vec<u8>,
    /// It is in the line of the character here,
    pub(crate) at: usize,
    /// this many columns after it.
    pub(crate) columns: i32,
}

impl Failure {
    /// `UnexpectedEOF`
    pub(crate) fn end_of_input(at: usize, columns: i32) -> Failure {
        Failure {
            message: b"Unexpected end of input found.".to_vec(),
            at,
            columns,
        }
    }
}

/// What `String.fromCharCode(-1)` is: Momoa names the end of the text so where it expects a character.
const END: u32 = 0xFFFF;

/// Momoa's `CharCodeReader`
struct Chars<'t> {
    text: &'t [u8],
    /// Where the character starts that was read last.
    at: usize,
    /// Where the next one starts.
    next: usize,
    /// The end of the text has been read.
    has_ended: bool,
}

impl Chars<'_> {
    fn peek(&self) -> Option<u32> {
        (self.next < self.text.len()).then(|| strings::wtf8_codepoint_at(self.text, self.next).0)
    }

    /// `\r\n` is read as one `\r`.
    fn next(&mut self) -> Option<u32> {
        if self.next >= self.text.len() {
            self.has_ended = true;
            return None;
        }
        let (c, len) = strings::wtf8_codepoint_at(self.text, self.next);
        self.at = self.next;
        self.next += len.max(1);
        if c == u32::from(b'\r') && self.text.get(self.next) == Some(&b'\n') {
            self.next += 1;
        }
        Some(c)
    }

    /// `locate()`: see [`Failure`].
    fn locate(&self) -> (usize, i32) {
        (self.at, i32::from(self.has_ended && !self.text.is_empty()))
    }

    /// `#unexpected(c)`
    fn unexpected(&self, c: Option<u32>) -> Failure {
        self.unexpected_before(c, 0)
    }

    /// The same, `columns` before where the reader is.
    fn unexpected_before(&self, c: Option<u32>, columns: i32) -> Failure {
        let mut message = b"Unexpected character '".to_vec();
        strings::push_codepoint_wtf8(
            &mut message,
            match c.unwrap_or(END) {
                c @ ..=0xFFFF => c,
                // The first of its two code units.
                c => 0xD800 + ((c - 0x1_0000) >> 10),
            },
        );
        message.extend_from_slice(b"' found.");
        let (at, after) = self.locate();
        Failure {
            message,
            at,
            columns: after - columns,
        }
    }

    /// `#unexpectedEOF()`
    fn unexpected_end(&self) -> Failure {
        let (at, columns) = self.locate();
        Failure::end_of_input(at, columns)
    }

    /// `#readHexDigits(count)`. Returns their value.
    fn hex_digits(&mut self, count: usize) -> Result<u32, Failure> {
        let mut value = 0;
        for _ in 0..count {
            let c = self.peek();
            let Some(digit) = c.and_then(char::from_u32).and_then(|it| it.to_digit(16)) else {
                return Err(self.unexpected(c));
            };
            self.next();
            value = value * 16 + digit;
        }
        Ok(value)
    }

    /// Reads digits. Returns how many, and the character after them.
    fn digits(&mut self, is_digit: fn(Option<u32>) -> bool) -> (usize, Option<u32>) {
        let mut count = 0;
        while is_digit(self.peek()) {
            self.next();
            count += 1;
        }
        (count, self.peek())
    }
}

fn is(c: Option<u32>, byte: u8) -> bool {
    c == Some(u32::from(byte))
}

fn is_digit(c: Option<u32>) -> bool {
    matches!(c, Some(0x30..=0x39))
}

fn is_hex_digit(c: Option<u32>) -> bool {
    matches!(c, Some(0x30..=0x39 | 0x41..=0x46 | 0x61..=0x66))
}

fn is_whitespace(c: u32, mode: Mode) -> bool {
    matches!(c, 0x20 | 0x09 | 0x0A | 0x0D)
        || mode == Mode::Json5
            && matches!(
                c,
                0x0B | 0x0C | 0xA0 | 0x2028 | 0x2029 | 0xFEFF | 0x2000
                    ..=0x200A | 0x202F | 0x205F | 0x3000
            )
}

/// `isJSON5IdentifierStart`
fn is_name_start(c: u32) -> bool {
    matches!(c, 0x24 | 0x5F | 0x5C | 0x200C | 0x200D) || c <= 0xFFFF && is_identifier_start(c)
}

/// `isJSON5IdentifierPart`
fn is_name_part(c: u32) -> bool {
    is_name_start(c) || c <= 0xFFFF && is_identifier_part(c)
}

impl Chars<'_> {
    /// `#readIdentifier(c)`. `c` has been read.
    fn identifier(&mut self, mut c: u32) -> Result<(), Failure> {
        let mut is_first = true;
        loop {
            if c == u32::from(b'\\') {
                let escaped = self.next();
                if !is(escaped, b'u') {
                    return Err(self.unexpected(escaped));
                }
                let code = self.hex_digits(4)?;
                if is_first && !is_name_start(code) {
                    return Err(self.unexpected_before(Some(u32::from(b'\\')), 5));
                }
                if !is_name_part(code) {
                    return Err(self.unexpected_before(Some(code), 5));
                }
            }
            is_first = false;
            match self.peek().filter(|it| is_name_part(*it)) {
                Some(part) => c = part,
                None => return Ok(()),
            }
            self.next();
        }
    }

    /// `#readString(c)`. `delimiter` has been read.
    fn string(&mut self, delimiter: u32, mode: Mode) -> Result<(), Failure> {
        let is_json5 = mode == Mode::Json5;
        loop {
            let c = self.next();
            if c == Some(delimiter) {
                return Ok(());
            }
            if c.is_none() {
                return Err(self.unexpected_end());
            }
            if !is(c, b'\\') {
                continue;
            }
            let escaped = self.peek();
            let is_simple = matches!(
                escaped.and_then(|it| u8::try_from(it).ok()),
                Some(b'"' | b'\\' | b'/' | b'b' | b'n' | b'f' | b'r' | b't')
            );
            if is(escaped, b'u') {
                self.next();
                self.hex_digits(4)?;
            } else if is_json5 && is(escaped, b'x') {
                self.next();
                self.hex_digits(2)?;
            } else if is_simple || is_json5 {
                self.next();
            } else {
                return Err(self.unexpected(escaped));
            }
        }
    }

    /// `#readNumber(c)`. `c` has been read.
    fn number(&mut self, mut c: Option<u32>, mode: Mode) -> Result<(), Failure> {
        let is_json5 = mode == Mode::Json5;
        if is(c, b'-') || is_json5 && is(c, b'+') {
            c = self.peek();
            if is_json5 && (is(c, b'I') || is(c, b'N')) {
                self.next();
                let start = self.at;
                self.identifier(c.unwrap_or(END))?;
                return match self.text.get(start..self.next) {
                    Some(b"Infinity" | b"NaN") => Ok(()),
                    _ => Err(self.unexpected(c)),
                };
            }
            if !is_digit(c) {
                return Err(self.unexpected(c));
            }
            self.next();
        }
        if is(c, b'0') {
            c = self.peek();
            if is_json5 && (is(c, b'x') || is(c, b'X')) {
                self.next();
                if !is_hex_digit(self.peek()) {
                    c = self.next();
                    return Err(self.unexpected(c));
                }
                c = self.digits(is_hex_digit).1;
            } else if is_digit(c) {
                return Err(self.unexpected(c));
            }
        } else if !is_json5 || !is(c, b'.') {
            if !is_digit(c) {
                return Err(self.unexpected(c));
            }
            c = self.digits(is_digit).1;
        }
        if is(c, b'.') {
            // Of a number that starts with the point, this reads whatever follows it.
            self.next();
            let (count, after) = self.digits(is_digit);
            c = after;
            if !is_json5 && count == 0 {
                self.next();
                return Err(self.unexpected(c));
            }
        }
        if is(c, b'e') || is(c, b'E') {
            self.next();
            c = self.peek();
            if is(c, b'+') || is(c, b'-') {
                self.next();
                c = self.peek();
            }
            if !is_digit(c) {
                self.next();
                return Err(match c {
                    Some(_) => self.unexpected(c),
                    None => self.unexpected_end(),
                });
            }
            self.digits(is_digit);
        }
        Ok(())
    }

    /// `#readComment(c)`. The `/` has been read.
    fn comment(&mut self) -> Result<Type, Failure> {
        let c = self.peek();
        if is(c, b'/') {
            while !matches!(self.peek(), None | Some(0x0A | 0x0D)) {
                self.next();
            }
            return Ok(Type::LineComment);
        }
        if !is(c, b'*') {
            self.next();
            return Err(self.unexpected(c));
        }
        self.next();
        loop {
            let c = self.next();
            if c.is_none() {
                return Err(self.unexpected_end());
            }
            if is(c, b'*') && is(self.peek(), b'/') {
                self.next();
                return Ok(Type::BlockComment);
            }
        }
    }
}

/// `getStringValue`, and `normalizeIdentifier`. `written`: without the quotes. Its escape sequences are valid.
fn unescaped<'a>(written: &[u8], memory: &'a Arena) -> &'a [u8] {
    let (mut value, mut rest) = (Vec::with_capacity(written.len()), written);
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        strings::push_wtf8(&mut value, &rest[..at]);
        let hex = |count: usize| {
            let digits = rest.get(at + 2..at + 2 + count).unwrap_or_default();
            bun_core::fmt::parse_hex_prefix(digits, count).0
        };
        let (c, len) = match rest.get(at + 1..).unwrap_or_default() {
            [b'b', ..] => (Some(0x08), 2),
            [b'n', ..] => (Some(0x0A), 2),
            [b'f', ..] => (Some(0x0C), 2),
            [b'r', ..] => (Some(0x0D), 2),
            [b't', ..] => (Some(0x09), 2),
            [b'v', ..] => (Some(0x0B), 2),
            [b'0', ..] => (Some(0), 2),
            [b'u', ..] => (Some(hex(4)), 6),
            [b'x', ..] => (Some(hex(2)), 4),
            [b'\r', b'\n', ..] => (None, 3),
            [b'\r' | b'\n', ..] => (None, 2),
            [0xE2, 0x80, 0xA8 | 0xA9, ..] => (None, 4),
            [] => (None, 1),
            _ => {
                let (c, len) = strings::wtf8_codepoint_at(rest, at + 1);
                (Some(c), 1 + len)
            }
        };
        if let Some(c) = c {
            strings::push_codepoint_wtf8_joined(&mut value, c);
        }
        rest = rest.get(at + len..).unwrap_or_default();
    }
    strings::push_wtf8(&mut value, rest);
    let mut kept: ArenaVec<'a, u8> = ArenaVec::new_in(memory);
    kept.extend_from_slice(&value);
    kept.into_bump_slice()
}

/// `tokenizer.next()`, from `from` on. `Ok(None)`: the text ends.
#[cold]
pub(crate) fn next<'a>(
    text: &[u8],
    from: usize,
    mode: Mode,
    memory: &'a Arena,
) -> Result<Option<Token<'a>>, Failure> {
    let mut chars = Chars {
        text,
        at: from.saturating_sub(1),
        next: from,
        has_ended: false,
    };
    let mut c = chars.next();
    while c.is_some_and(|it| is_whitespace(it, mode)) {
        c = chars.next();
    }
    let Some(first) = c else {
        return Ok(None);
    };
    let (start, is_json5) = (chars.at, mode == Mode::Json5);
    let kind = match u8::try_from(first).unwrap_or(0) {
        b'[' => Type::LBracket,
        b']' => Type::RBracket,
        b'{' => Type::LBrace,
        b'}' => Type::RBrace,
        b':' => Type::Colon,
        b',' => Type::Comma,
        _ if is_json5 && is_name_start(first) => {
            chars.identifier(first)?;
            match text.get(start..chars.next) {
                Some(b"true" | b"false") => Type::Boolean,
                Some(b"null") => Type::Null,
                Some(b"NaN" | b"Infinity") => Type::Number,
                _ => Type::Identifier,
            }
        }
        b't' | b'f' | b'n' if !is_json5 => {
            chars.identifier(first)?;
            match text.get(start..chars.next).unwrap_or_default() {
                b"true" | b"false" => Type::Boolean,
                b"null" => Type::Null,
                name => {
                    return Err(Failure {
                        message: [b"Unexpected identifier '", name, b"' found."].concat(),
                        at: start,
                        columns: 0,
                    });
                }
            }
        }
        b'0'..=b'9' | b'.' | b'-' => {
            chars.number(c, mode)?;
            Type::Number
        }
        b'+' if is_json5 => {
            chars.number(c, mode)?;
            Type::Number
        }
        b'"' => {
            chars.string(first, mode)?;
            Type::String
        }
        b'\'' if is_json5 => {
            chars.string(first, mode)?;
            Type::String
        }
        b'/' if mode != Mode::Json => chars.comment()?,
        _ => return Err(chars.unexpected(c)),
    };
    let written = text.get(start..chars.next).unwrap_or_default();
    Ok(Some(Token {
        kind,
        start,
        end: chars.next,
        value: match (kind, written) {
            (Type::String, [_, inner @ .., _]) => unescaped(inner, memory),
            (Type::Identifier, written) => unescaped(written, memory),
            _ => b"",
        },
    }))
}
