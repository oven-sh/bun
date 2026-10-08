//! The scanner. It works on bytes: one dispatch on the first byte of a token, 16 bytes at a time
//! through names, strings and comments. Everything that is not ASCII takes a slow path.
//!
//! It never reports an error. What it cannot scan it refuses ([`Lexer::refuse`]): from then on every
//! token is the end of the file, so the parser unwinds without testing anything.

use crate::Refusal;
use crate::names::Names;
use crate::token::T;
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::{CommentDirective, CommentDirectiveKind};
use std::simd::cmp::{SimdPartialEq, SimdPartialOrd};
use std::simd::u8x16;

pub(crate) struct Lexer<'a> {
    pub(crate) src: &'a [u8],
    pub(crate) token: T,
    /// A line break precedes the token.
    pub(crate) newline_before: bool,
    /// The name or keyword has a Unicode escape.
    pub(crate) has_escape: bool,
    /// The start of the token.
    pub(crate) start: u32,
    /// The end of the token.
    pub(crate) end: u32,
    /// The end of the previous token: `node.Pos()` of a node that starts with the token.
    pub(crate) full_start: u32,
    /// The text of a name, a keyword or a bigint, the value of a string or of a piece of a
    /// template.
    pub(crate) atom: Atom,
    pub(crate) number: f64,
    pub(crate) refusal: Option<Refusal>,
    /// Where the text was refused, and by which line of this crate.
    pub(crate) refused_at: (u32, &'static core::panic::Location<'static>),
    /// `</` is one token.
    pub(crate) is_jsx: bool,
    pub(crate) atoms: &'a dyn Intern,
    pub(crate) names: &'a mut Names,
    /// `hir::File::comment_directives`
    pub(crate) comment_directives: Vec<CommentDirective>,
    /// The comments before the first token.
    pub(crate) leading_comments: Vec<(u32, u32)>,
    is_before_first_token: bool,
    /// Where values with escapes are decoded.
    buffer: Vec<u8>,
}

/// What a lookahead restores.
#[derive(Copy, Clone)]
pub(crate) struct Mark {
    token: T,
    newline_before: bool,
    has_escape: bool,
    start: u32,
    end: u32,
    full_start: u32,
    atom: Atom,
    number: f64,
}

/// The number of leading bytes of `bytes` that are ASCII letters, digits, `_` or `$`.
#[inline(always)]
fn name_run(bytes: u8x16) -> u32 {
    let letters = ((bytes | u8x16::splat(0x20)) - u8x16::splat(b'a')).simd_lt(u8x16::splat(26));
    let digits = (bytes - u8x16::splat(b'0')).simd_lt(u8x16::splat(10));
    let others = bytes.simd_eq(u8x16::splat(b'_')) | bytes.simd_eq(u8x16::splat(b'$'));
    let mask = (letters | digits | others).to_bitmask() as u32;
    (!mask).trailing_zeros()
}

#[inline(always)]
fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// The code point at the start of `text`, and its length in bytes. `None`: it is not UTF-8.
pub(crate) fn decode(text: &[u8]) -> Option<(u32, usize)> {
    let first = *text.first()?;
    let len = match first {
        0..=0x7F => return Some((u32::from(first), 1)),
        0xC2..=0xDF => 2,
        0xE0..=0xEF => 3,
        0xF0..=0xF4 => 4,
        _ => return None,
    };
    let valid = core::str::from_utf8(text.get(..len)?).ok()?;
    Some((u32::from(valid.chars().next()?), len))
}

/// `IsWhiteSpaceSingleLine` for a code point that is not ASCII.
fn is_unicode_blank(c: u32) -> bool {
    matches!(
        c,
        0x85 | 0xA0 | 0x1680 | 0x2000..=0x200B | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

fn is_identifier_start(c: u32) -> bool {
    bun_core::lexer::is_identifier_start(c)
}

fn is_identifier_part(c: u32) -> bool {
    bun_core::lexer::is_identifier_part(c)
}

impl<'a> Lexer<'a> {
    pub(crate) fn new(src: &'a [u8], atoms: &'a dyn Intern, names: &'a mut Names) -> Self {
        Lexer {
            src,
            token: T::Eof,
            newline_before: false,
            has_escape: false,
            start: 0,
            end: 0,
            full_start: 0,
            atom: Atom::NONE,
            number: 0.0,
            refusal: None,
            refused_at: (0, core::panic::Location::caller()),
            is_jsx: false,
            atoms,
            names,
            comment_directives: Vec::new(),
            leading_comments: Vec::new(),
            is_before_first_token: true,
            buffer: Vec::new(),
        }
    }

    #[inline(always)]
    pub(crate) fn mark(&self) -> Mark {
        Mark {
            token: self.token,
            newline_before: self.newline_before,
            has_escape: self.has_escape,
            start: self.start,
            end: self.end,
            full_start: self.full_start,
            atom: self.atom,
            number: self.number,
        }
    }

    #[inline(always)]
    pub(crate) fn reset(&mut self, mark: Mark) {
        self.token = mark.token;
        self.newline_before = mark.newline_before;
        self.has_escape = mark.has_escape;
        self.start = mark.start;
        self.end = mark.end;
        self.full_start = mark.full_start;
        self.atom = mark.atom;
        self.number = mark.number;
    }

    /// Gives up on the file, or on the speculative parse that is going on.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn refuse(&mut self, why: Refusal) {
        if self.refusal.is_none() {
            self.refusal = Some(why);
            self.refused_at = (self.start, core::panic::Location::caller());
        }
        self.token = T::Eof;
        self.start = self.src.len() as u32;
        self.end = self.start;
    }

    /// The text of the token.
    #[inline]
    pub(crate) fn text(&self) -> &'a [u8] {
        self.src
            .get(self.start as usize..self.end as usize)
            .unwrap_or_default()
    }

    #[inline(always)]
    fn set(&mut self, token: T, start: usize, end: usize) {
        self.token = token;
        self.start = start as u32;
        self.end = end as u32;
    }

    #[inline(always)]
    fn at(&self, pos: usize) -> u8 {
        // No token contains a zero byte outside a string or a comment, so it stands for the end.
        self.src.get(pos).copied().unwrap_or(0)
    }

    /// Scans the next token.
    pub(crate) fn next(&mut self) {
        let src = self.src;
        let mut pos = self.end as usize;
        self.full_start = self.end;
        self.newline_before = false;
        loop {
            let Some(&byte) = src.get(pos) else {
                self.is_before_first_token = false;
                return self.set(T::Eof, src.len(), src.len());
            };
            let next = pos + 1;
            match byte {
                b' ' | b'\t' => {
                    pos = next;
                    while matches!(src.get(pos), Some(b' ' | b'\t')) {
                        pos += 1;
                    }
                    continue;
                }
                b'\n' => {
                    self.newline_before = true;
                    pos = next;
                    while matches!(src.get(pos), Some(b'\t' | b' ')) {
                        pos += 1;
                    }
                    continue;
                }
                b'\r' => {
                    self.newline_before = true;
                    pos = next;
                    continue;
                }
                0x0B | 0x0C => {
                    pos = next;
                    continue;
                }
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => return self.name(pos),
                b'(' => self.set(T::OpenParen, pos, next),
                b')' => self.set(T::CloseParen, pos, next),
                b'{' => self.set(T::OpenBrace, pos, next),
                b'}' => self.set(T::CloseBrace, pos, next),
                b'[' => self.set(T::OpenBracket, pos, next),
                b']' => self.set(T::CloseBracket, pos, next),
                b';' => self.set(T::Semicolon, pos, next),
                b',' => self.set(T::Comma, pos, next),
                b':' => self.set(T::Colon, pos, next),
                b'~' => self.set(T::Tilde, pos, next),
                b'@' => self.set(T::At, pos, next),
                b'.' => match (self.at(next), self.at(next + 1)) {
                    (b'0'..=b'9', _) => self.number(pos),
                    (b'.', b'.') => self.set(T::DotDotDot, pos, pos + 3),
                    _ => self.set(T::Dot, pos, next),
                },
                b'=' => match (self.at(next), self.at(next + 1)) {
                    (b'=', b'=') if self.at(pos + 3) == b'=' => self.refuse(Refusal::ConflictMarker),
                    (b'=', b'=') => self.set(T::EqualsEqualsEquals, pos, pos + 3),
                    (b'=', _) => self.set(T::EqualsEquals, pos, pos + 2),
                    (b'>', _) => self.set(T::EqualsGreaterThan, pos, pos + 2),
                    _ => self.set(T::Equals, pos, next),
                },
                b'\'' | b'"' => self.string(pos, byte),
                b'/' => match self.at(next) {
                    b'/' => {
                        pos = self.line_comment(pos);
                        continue;
                    }
                    b'*' => {
                        let Some(end) = self.block_comment(pos) else {
                            return self.refuse(Refusal::Unterminated);
                        };
                        pos = end;
                        continue;
                    }
                    b'=' => self.set(T::SlashEquals, pos, pos + 2),
                    _ => self.set(T::Slash, pos, next),
                },
                b'0'..=b'9' => self.number(pos),
                b'!' => match (self.at(next), self.at(next + 1)) {
                    (b'=', b'=') => self.set(T::ExclamationEqualsEquals, pos, pos + 3),
                    (b'=', _) => self.set(T::ExclamationEquals, pos, pos + 2),
                    _ => self.set(T::Exclamation, pos, next),
                },
                b'?' => match (self.at(next), self.at(next + 1)) {
                    (b'.', after) if !after.is_ascii_digit() => {
                        self.set(T::QuestionDot, pos, pos + 2);
                    }
                    (b'?', b'=') => self.set(T::QuestionQuestionEquals, pos, pos + 3),
                    (b'?', _) => self.set(T::QuestionQuestion, pos, pos + 2),
                    _ => self.set(T::Question, pos, next),
                },
                b'<' => match (self.at(next), self.at(next + 1)) {
                    (b'<', b'<') => self.refuse(Refusal::ConflictMarker),
                    (b'<', b'=') => self.set(T::LessThanLessThanEquals, pos, pos + 3),
                    (b'<', _) => self.set(T::LessThanLessThan, pos, pos + 2),
                    (b'=', _) => self.set(T::LessThanEquals, pos, pos + 2),
                    (b'/', after) if self.is_jsx && after != b'*' => {
                        self.set(T::LessThanSlash, pos, pos + 2);
                    }
                    (b'!', b'-') if self.at(pos + 3) == b'-' => self.refuse(Refusal::HtmlComment),
                    _ => self.set(T::LessThan, pos, next),
                },
                // The parser asks for `>=`, `>>` and so on where they can be.
                b'>' => {
                    if src.get(pos..pos + 7) == Some(b">>>>>>>") {
                        return self.refuse(Refusal::ConflictMarker);
                    }
                    self.set(T::GreaterThan, pos, next);
                }
                b'+' => match self.at(next) {
                    b'+' => self.set(T::PlusPlus, pos, pos + 2),
                    b'=' => self.set(T::PlusEquals, pos, pos + 2),
                    _ => self.set(T::Plus, pos, next),
                },
                b'-' => match (self.at(next), self.at(next + 1)) {
                    (b'-', b'>') => self.refuse(Refusal::HtmlComment),
                    (b'-', _) => self.set(T::MinusMinus, pos, pos + 2),
                    (b'=', _) => self.set(T::MinusEquals, pos, pos + 2),
                    _ => self.set(T::Minus, pos, next),
                },
                b'*' => match (self.at(next), self.at(next + 1)) {
                    (b'*', b'=') => self.set(T::AsteriskAsteriskEquals, pos, pos + 3),
                    (b'*', _) => self.set(T::AsteriskAsterisk, pos, pos + 2),
                    (b'=', _) => self.set(T::AsteriskEquals, pos, pos + 2),
                    _ => self.set(T::Asterisk, pos, next),
                },
                b'%' => match self.at(next) {
                    b'=' => self.set(T::PercentEquals, pos, pos + 2),
                    _ => self.set(T::Percent, pos, next),
                },
                b'&' => match (self.at(next), self.at(next + 1)) {
                    (b'&', b'=') => self.set(T::AmpersandAmpersandEquals, pos, pos + 3),
                    (b'&', _) => self.set(T::AmpersandAmpersand, pos, pos + 2),
                    (b'=', _) => self.set(T::AmpersandEquals, pos, pos + 2),
                    _ => self.set(T::Ampersand, pos, next),
                },
                b'|' => match (self.at(next), self.at(next + 1)) {
                    (b'|', b'|') => self.refuse(Refusal::ConflictMarker),
                    (b'|', b'=') => self.set(T::BarBarEquals, pos, pos + 3),
                    (b'|', _) => self.set(T::BarBar, pos, pos + 2),
                    (b'=', _) => self.set(T::BarEquals, pos, pos + 2),
                    _ => self.set(T::Bar, pos, next),
                },
                b'^' => match self.at(next) {
                    b'=' => self.set(T::CaretEquals, pos, pos + 2),
                    _ => self.set(T::Caret, pos, next),
                },
                b'`' => self.template(pos, true),
                b'#' => {
                    if pos == 0 && self.at(next) == b'!' {
                        pos = self.end_of_line(pos);
                        continue;
                    }
                    self.private_name(pos);
                }
                b'\\' => self.name_slowly(pos, pos),
                0x80.. => {
                    let Some((c, len)) = decode(&src[pos..]) else {
                        return self.refuse(Refusal::NotUtf8);
                    };
                    if c == 0x2028 || c == 0x2029 {
                        self.newline_before = true;
                    } else if !is_unicode_blank(c) {
                        self.is_before_first_token = false;
                        return self.name_slowly(pos, pos);
                    }
                    pos += len;
                    continue;
                }
                _ => self.refuse(Refusal::UnexpectedCharacter),
            }
            self.is_before_first_token = false;
            return;
        }
    }

    // ───────────────────────────── names ─────────────────────────────

    /// A name or a keyword that starts at `start` with an ASCII letter, `_` or `$`.
    #[inline(always)]
    fn name(&mut self, start: usize) {
        self.is_before_first_token = false;
        self.has_escape = false;
        let src = self.src;
        if let Some(chunk) = src.get(start..).and_then(|rest| rest.first_chunk::<16>()) {
            let len = name_run(u8x16::from_array(*chunk));
            if let Some(&after) = chunk.get(len as usize) {
                if after < 0x80 && after != b'\\' {
                    let end = start + len as usize;
                    let text = src.get(start..end).unwrap_or_default();
                    let (atom, kind) = self.names.short(chunk, len, text, self.atoms);
                    self.atom = atom;
                    return self.set(kind, start, end);
                }
                return self.name_slowly(start, start + len as usize);
            }
        }
        self.long_name(start);
    }

    /// The same for a name of 16 bytes or more, or near the end of the text.
    #[inline(never)]
    fn long_name(&mut self, start: usize) {
        let src = self.src;
        let mut end = start;
        while let Some(chunk) = src.get(end..).and_then(|rest| rest.first_chunk::<16>()) {
            let len = name_run(u8x16::from_array(*chunk)) as usize;
            end += len;
            if len < 16 {
                break;
            }
        }
        while src.get(end).is_some_and(|&byte| is_name_byte(byte)) {
            end += 1;
        }
        if matches!(src.get(end), Some(b'\\' | 0x80..)) {
            return self.name_slowly(start, end);
        }
        let text = src.get(start..end).unwrap_or_default();
        self.atom = self.names.atom(text, self.atoms);
        let kind = match text.len() {
            // No keyword is longer than `constructor`.
            0..=11 => crate::token::keyword(text),
            _ => T::Identifier,
        };
        self.set(kind, start, end);
    }

    /// A name that starts at `start` and has a character that is not ASCII, or an escape, at
    /// `from` or later.
    #[cold]
    #[inline(never)]
    fn name_slowly(&mut self, start: usize, from: usize) {
        let src = self.src;
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        text.extend_from_slice(&src[start..from]);
        let mut pos = from;
        self.has_escape = false;
        loop {
            let (c, len) = match src.get(pos) {
                Some(b'\\') => {
                    self.has_escape = true;
                    match self.unicode_escape(pos + 1) {
                        Some((c, end)) => (c, end - pos),
                        None => {
                            self.buffer = text;
                            return self.refuse(Refusal::InvalidEscape);
                        }
                    }
                }
                Some(_) => match decode(&src[pos..]) {
                    Some(decoded) => decoded,
                    None => {
                        self.buffer = text;
                        return self.refuse(Refusal::NotUtf8);
                    }
                },
                None => break,
            };
            let belongs = match text.is_empty() {
                true => is_identifier_start(c),
                false => is_identifier_part(c),
            };
            if !belongs {
                if src[pos] == b'\\' {
                    self.buffer = text;
                    return self.refuse(Refusal::InvalidEscape);
                }
                break;
            }
            let Some(c) = char::from_u32(c) else {
                self.buffer = text;
                return self.refuse(Refusal::InvalidEscape);
            };
            text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            pos += len;
        }
        if text.is_empty() {
            self.buffer = text;
            return self.refuse(Refusal::UnexpectedCharacter);
        }
        self.atom = self.names.atom(&text, self.atoms);
        let kind = crate::token::keyword(&text);
        self.buffer = text;
        self.set(kind, start, pos);
    }

    /// `u1234` or `u{1234}` at `pos`: the code point, and the end.
    fn unicode_escape(&self, pos: usize) -> Option<(u32, usize)> {
        let src = self.src;
        if src.get(pos) != Some(&b'u') {
            return None;
        }
        if src.get(pos + 1) == Some(&b'{') {
            let digits = &src[pos + 2..];
            let len = digits.iter().take_while(|c| c.is_ascii_hexdigit()).count();
            if len == 0 || len > 8 || digits.get(len) != Some(&b'}') {
                return None;
            }
            let c = u32::from_str_radix(core::str::from_utf8(&digits[..len]).ok()?, 16).ok()?;
            return (c <= 0x10_FFFF).then_some((c, pos + 2 + len + 1));
        }
        let digits = src.get(pos + 1..pos + 5)?;
        if !digits.iter().all(u8::is_ascii_hexdigit) {
            return None;
        }
        let c = u32::from_str_radix(core::str::from_utf8(digits).ok()?, 16).ok()?;
        Some((c, pos + 5))
    }

    /// `#name` at `start`. Its text has the `#`.
    #[inline(never)]
    fn private_name(&mut self, start: usize) {
        let src = self.src;
        let mut end = start + 1;
        if !src
            .get(end)
            .is_some_and(|&byte| is_name_byte(byte) && !byte.is_ascii_digit())
        {
            return self.refuse(Refusal::UnusualPrivateName);
        }
        while src.get(end).is_some_and(|&byte| is_name_byte(byte)) {
            end += 1;
        }
        if matches!(src.get(end), Some(b'\\' | 0x80..)) {
            return self.refuse(Refusal::UnusualPrivateName);
        }
        self.has_escape = false;
        self.atom = self.names.atom(&src[start..end], self.atoms);
        self.set(T::PrivateIdentifier, start, end);
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// The position of the line break that ends the line of `pos`, or the end of the text.
    fn end_of_line(&self, mut pos: usize) -> usize {
        let src = self.src;
        loop {
            let Some(chunk) = src.get(pos..).and_then(|rest| rest.first_chunk::<16>()) else {
                break;
            };
            let bytes = u8x16::from_array(*chunk);
            let found = bytes.simd_eq(u8x16::splat(b'\n'))
                | bytes.simd_eq(u8x16::splat(b'\r'))
                | bytes.simd_eq(u8x16::splat(0xE2));
            let mask = found.to_bitmask();
            if mask == 0 {
                pos += 16;
                continue;
            }
            pos += mask.trailing_zeros() as usize;
            if src[pos] != 0xE2 || matches!(src.get(pos..pos + 3), Some([_, 0x80, 0xA8 | 0xA9])) {
                return pos;
            }
            pos += 1;
        }
        while let Some(&byte) = src.get(pos) {
            if byte == b'\n'
                || byte == b'\r'
                || matches!(src.get(pos..pos + 3), Some([0xE2, 0x80, 0xA8 | 0xA9]))
            {
                return pos;
            }
            pos += 1;
        }
        src.len()
    }

    /// The `//` comment at `start`. Returns its end.
    #[inline(never)]
    fn line_comment(&mut self, start: usize) -> usize {
        let end = self.end_of_line(start + 2);
        if self.is_before_first_token {
            self.leading_comments.push((start as u32, end as u32));
        }
        // `processCommentDirective`: "Skip opening //", "Skip another / if present"
        let src = self.src;
        let mut pos = start + 2;
        while pos < end && src[pos] == b'/' {
            pos += 1;
        }
        self.comment_directive(start, pos, end);
        end
    }

    /// The `/*` comment at `start`. Returns its end.
    #[inline(never)]
    fn block_comment(&mut self, start: usize) -> Option<usize> {
        let src = self.src;
        let mut pos = start + 2;
        // The start of its last line.
        let mut last_line = start;
        let end = loop {
            if let Some(chunk) = src.get(pos..).and_then(|rest| rest.first_chunk::<16>()) {
                let bytes = u8x16::from_array(*chunk);
                let found = bytes.simd_eq(u8x16::splat(b'*'))
                    | bytes.simd_eq(u8x16::splat(b'\n'))
                    | bytes.simd_eq(u8x16::splat(b'\r'))
                    | bytes.simd_eq(u8x16::splat(0xE2));
                let mask = found.to_bitmask();
                if mask == 0 {
                    pos += 16;
                    continue;
                }
                pos += mask.trailing_zeros() as usize;
            }
            match *src.get(pos)? {
                b'*' if src.get(pos + 1) == Some(&b'/') => break pos + 2,
                b'\n' | b'\r' => {
                    self.newline_before = true;
                    last_line = pos + 1;
                }
                0xE2 if matches!(src.get(pos..pos + 3), Some([_, 0x80, 0xA8 | 0xA9])) => {
                    self.newline_before = true;
                    last_line = pos + 3;
                }
                _ => {}
            }
            pos += 1;
        };
        if self.is_before_first_token {
            self.leading_comments.push((start as u32, end as u32));
        }
        // `processCommentDirective`: "Skip whitespace", "Skip combinations of / and *"
        let mut pos = last_line;
        while pos < end && matches!(src[pos], b' ' | b'\t') {
            pos += 1;
        }
        while pos < end && matches!(src[pos], b'/' | b'*') {
            pos += 1;
        }
        self.comment_directive(last_line, pos, end);
        Some(end)
    }

    /// `processCommentDirective`, from the blanks before the `@` on.
    #[inline]
    fn comment_directive(&mut self, start: usize, mut pos: usize, end: usize) {
        let src = self.src;
        while pos < end && matches!(src[pos], b' ' | b'\t') {
            pos += 1;
        }
        if pos < end && src[pos] == b'@' {
            self.comment_directive_at(start, pos + 1, end);
        }
    }

    #[cold]
    #[inline(never)]
    fn comment_directive_at(&mut self, start: usize, name: usize, end: usize) {
        let kind = if self.src[name..].starts_with(b"ts-expect-error") {
            CommentDirectiveKind::ExpectError
        } else if self.src[name..].starts_with(b"ts-ignore") {
            CommentDirectiveKind::Ignore
        } else {
            return;
        };
        // A lookahead scans a comment again.
        let is_new = (self.comment_directives.last()).is_none_or(|last| last.end < end as u32);
        if is_new {
            self.comment_directives.push(CommentDirective {
                start: start as u32,
                end: end as u32,
                kind,
            });
        }
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// The string at `start`, in the quotes `quote`.
    #[inline(always)]
    fn string(&mut self, start: usize, quote: u8) {
        let src = self.src;
        let mut pos = start + 1;
        while let Some(chunk) = src.get(pos..).and_then(|rest| rest.first_chunk::<16>()) {
            let bytes = u8x16::from_array(*chunk);
            // The quote, a backslash, a control character, or anything that is not ASCII.
            let found = bytes.simd_eq(u8x16::splat(quote))
                | bytes.simd_eq(u8x16::splat(b'\\'))
                | bytes.simd_lt(u8x16::splat(0x20))
                | bytes.simd_ge(u8x16::splat(0x80));
            let mask = found.to_bitmask();
            if mask == 0 {
                pos += 16;
                continue;
            }
            pos += mask.trailing_zeros() as usize;
            if src.get(pos) == Some(&quote) {
                let text = src.get(start + 1..pos).unwrap_or_default();
                self.atom = self.names.atom(text, self.atoms);
                return self.set(T::String, start, pos + 1);
            }
            break;
        }
        self.string_slowly(start, quote);
    }

    /// Appends the UTF-16 code unit or the code point `c` to `text`, which is WTF-8: the second half
    /// of a surrogate pair joins the first.
    pub(crate) fn push_code_point(text: &mut Vec<u8>, c: u32) {
        if (0xDC00..=0xDFFF).contains(&c)
            && let [.., 0xED, second @ 0xA0..=0xAF, third] = text[..]
        {
            let high = 0xD000 | u32::from(second & 0x3F) << 6 | u32::from(third & 0x3F);
            let joined = 0x1_0000 + ((high - 0xD800) << 10) + (c - 0xDC00);
            text.truncate(text.len() - 3);
            return Self::push_code_point(text, joined);
        }
        match char::from_u32(c) {
            Some(c) => text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes()),
            // Half of a surrogate pair.
            None => text.extend_from_slice(&[
                0xE0 | (c >> 12) as u8,
                0x80 | (c >> 6 & 0x3F) as u8,
                0x80 | (c & 0x3F) as u8,
            ]),
        }
    }

    /// Decodes the escape whose backslash is at `pos` and appends what it stands for to `text`.
    /// Returns its end. `None`: TypeScript reports an error for it.
    fn escape(&self, pos: usize, text: &mut Vec<u8>) -> Option<usize> {
        let src = self.src;
        let c = *src.get(pos + 1)?;
        let simple = match c {
            b'n' => b'\n',
            b't' => b'\t',
            b'r' => b'\r',
            b'b' => 0x08,
            b'f' => 0x0C,
            b'v' => 0x0B,
            b'0' if !src.get(pos + 2).is_some_and(u8::is_ascii_digit) => 0,
            b'0'..=b'9' => return None,
            b'x' => {
                let digits = src.get(pos + 2..pos + 4)?;
                if !digits.iter().all(u8::is_ascii_hexdigit) {
                    return None;
                }
                let c = u32::from_str_radix(core::str::from_utf8(digits).ok()?, 16).ok()?;
                Self::push_code_point(text, c);
                return Some(pos + 4);
            }
            b'u' => {
                let (c, end) = self.unicode_escape(pos + 1)?;
                Self::push_code_point(text, c);
                return Some(end);
            }
            // A line continuation.
            b'\r' if src.get(pos + 2) == Some(&b'\n') => return Some(pos + 3),
            b'\r' | b'\n' => return Some(pos + 2),
            0x80.. => {
                let (c, len) = decode(&src[pos + 1..])?;
                if c != 0x2028 && c != 0x2029 {
                    text.extend_from_slice(&src[pos + 1..pos + 1 + len]);
                }
                return Some(pos + 1 + len);
            }
            other => other,
        };
        text.push(simple);
        Some(pos + 2)
    }

    #[cold]
    #[inline(never)]
    fn string_slowly(&mut self, start: usize, quote: u8) {
        let src = self.src;
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        let mut pos = start + 1;
        let mut is_ascii = true;
        let refusal = loop {
            match src.get(pos) {
                None | Some(b'\n' | b'\r') => break Some(Refusal::Unterminated),
                Some(&c) if c == quote => break None,
                Some(b'\\') => match self.escape(pos, &mut text) {
                    Some(end) => pos = end,
                    None => break Some(Refusal::InvalidEscape),
                },
                Some(&c) => {
                    is_ascii &= c < 0x80;
                    text.push(c);
                    pos += 1;
                }
            }
        };
        let refusal = refusal.or_else(|| {
            let is_valid = is_ascii || core::str::from_utf8(&src[start + 1..pos]).is_ok();
            (!is_valid).then_some(Refusal::NotUtf8)
        });
        if refusal.is_none() {
            self.atom = self.names.atom(&text, self.atoms);
        }
        self.buffer = text;
        match refusal {
            Some(why) => self.refuse(why),
            None => self.set(T::String, start, pos + 1),
        }
    }

    // ───────────────────────────── templates ─────────────────────────────

    /// A piece of a template, from the `` ` `` (`is_head`) or the `}` at `start`.
    #[inline(never)]
    fn template(&mut self, start: usize, is_head: bool) {
        let src = self.src;
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        let mut pos = start + 1;
        let mut is_ascii = true;
        let found = loop {
            match src.get(pos) {
                None => break Err(Refusal::Unterminated),
                Some(b'`') => {
                    break Ok(match is_head {
                        true => (T::NoSubstitutionTemplate, pos + 1),
                        false => (T::TemplateTail, pos + 1),
                    });
                }
                Some(b'$') if src.get(pos + 1) == Some(&b'{') => {
                    break Ok(match is_head {
                        true => (T::TemplateHead, pos + 2),
                        false => (T::TemplateMiddle, pos + 2),
                    });
                }
                Some(b'\\') => match self.escape(pos, &mut text) {
                    Some(end) => pos = end,
                    None => break Err(Refusal::InvalidEscape),
                },
                // A line break is a line feed, however it is written.
                Some(b'\r') => {
                    text.push(b'\n');
                    pos += if src.get(pos + 1) == Some(&b'\n') { 2 } else { 1 };
                }
                Some(&c) => {
                    is_ascii &= c < 0x80;
                    text.push(c);
                    pos += 1;
                }
            }
        };
        let found = found.and_then(|found| {
            match is_ascii || core::str::from_utf8(&src[start + 1..pos]).is_ok() {
                true => Ok(found),
                false => Err(Refusal::NotUtf8),
            }
        });
        if found.is_ok() {
            self.atom = self.names.atom(&text, self.atoms);
        }
        self.buffer = text;
        match found {
            Ok((token, end)) => self.set(token, start, end),
            Err(why) => self.refuse(why),
        }
    }

    /// `ReScanTemplateToken`: the token is the `}` that ends a substitution.
    pub(crate) fn rescan_template_continuation(&mut self) {
        debug_assert_eq!(self.token, T::CloseBrace);
        self.template(self.start as usize, false);
    }

    // ───────────────────────────── numbers ─────────────────────────────

    /// The digits of base `radix` from `pos` on, with separators between them. Returns their end.
    fn digits(&self, mut pos: usize, radix: u32) -> Option<usize> {
        let src = self.src;
        let first = pos;
        loop {
            match src.get(pos) {
                Some(&c) if char::from(c).is_digit(radix) => pos += 1,
                // Only between two digits.
                Some(b'_')
                    if pos > first
                        && src[pos - 1] != b'_'
                        && src
                            .get(pos + 1)
                            .is_some_and(|&c| char::from(c).is_digit(radix)) =>
                {
                    pos += 1;
                }
                Some(b'_') => return None,
                _ => break,
            }
        }
        (pos > first).then_some(pos)
    }

    #[inline(never)]
    fn number(&mut self, start: usize) {
        let src = self.src;
        // The common case: a few digits.
        let mut pos = start;
        let mut value: u64 = 0;
        while let Some(&c @ b'0'..=b'9') = src.get(pos) {
            value = value.wrapping_mul(10).wrapping_add(u64::from(c - b'0'));
            pos += 1;
        }
        let is_plain = !matches!(
            src.get(pos),
            Some(b'.' | b'_' | b'$' | b'\\' | b'a'..=b'z' | b'A'..=b'Z' | 0x80..)
        );
        if is_plain && pos - start <= 15 && (src[start] != b'0' || pos - start == 1) {
            self.number = value as f64;
            return self.set(T::Number, start, pos);
        }
        match self.unusual_number(start) {
            Some((token, end)) => self.set(token, start, end),
            None => self.refuse(Refusal::UnusualNumber),
        }
    }

    fn unusual_number(&mut self, start: usize) -> Option<(T, usize)> {
        let src = self.src;
        let radix = match (src[start], src.get(start + 1)) {
            (b'0', Some(b'x' | b'X')) => 16,
            (b'0', Some(b'o' | b'O')) => 8,
            (b'0', Some(b'b' | b'B')) => 2,
            // A legacy octal number, or a decimal number with a leading zero.
            (b'0', Some(b'0'..=b'9' | b'_')) => return None,
            _ => 10,
        };
        let mut is_integer = true;
        let mut end;
        if radix != 10 {
            end = self.digits(start + 2, radix)?;
        } else {
            end = start;
            if src[start] != b'.' {
                end = self.digits(start, 10)?;
            }
            if src.get(end) == Some(&b'.') {
                is_integer = false;
                end += 1;
                if src.get(end).is_some_and(u8::is_ascii_digit) {
                    end = self.digits(end, 10)?;
                } else if src.get(end) == Some(&b'_') {
                    return None;
                }
            }
            if let Some(b'e' | b'E') = src.get(end) {
                is_integer = false;
                end += 1;
                if let Some(b'+' | b'-') = src.get(end) {
                    end += 1;
                }
                end = self.digits(end, 10)?;
            }
        }
        let is_bigint = is_integer && src.get(end) == Some(&b'n');
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        text.extend(src[start..end].iter().filter(|&&c| c != b'_'));
        let token = if is_bigint {
            end += 1;
            let decimal = match radix {
                10 => text.clone(),
                _ => decimal_digits(&text[2..], radix),
            };
            self.atom = self.names.atom(&decimal, self.atoms);
            T::BigInt
        } else {
            self.number = match radix {
                10 => core::str::from_utf8(&text)
                    .ok()
                    .and_then(|text| text.parse().ok())
                    .unwrap_or(f64::NAN),
                _ => number_from_digits(&text[2..], radix),
            };
            T::Number
        };
        self.buffer = text;
        // A name cannot follow a number directly.
        if matches!(src.get(end), Some(&c) if is_name_byte(c) || c == b'\\' || c >= 0x80) {
            return None;
        }
        Some((token, end))
    }

    // ───────────────────────────── what the parser asks for ─────────────────────────────

    /// `ReScanGreaterThanToken`: the token is a `>`.
    #[inline]
    pub(crate) fn rescan_greater_than(&mut self) {
        debug_assert_eq!(self.token, T::GreaterThan);
        let pos = self.start as usize;
        let (token, len) = match (self.at(pos + 1), self.at(pos + 2), self.at(pos + 3)) {
            (b'>', b'>', b'=') => (T::GreaterThanGreaterThanGreaterThanEquals, 4),
            (b'>', b'>', _) => (T::GreaterThanGreaterThanGreaterThan, 3),
            (b'>', b'=', _) => (T::GreaterThanGreaterThanEquals, 3),
            (b'>', ..) => (T::GreaterThanGreaterThan, 2),
            (b'=', ..) => (T::GreaterThanEquals, 2),
            _ => return,
        };
        self.token = token;
        self.end = (pos + len) as u32;
    }

    /// `ReScanSlashToken`: the token is a `/` or a `/=` where an expression starts.
    pub(crate) fn rescan_slash(&mut self) {
        let src = self.src;
        let start = self.start as usize;
        let mut pos = start + 1;
        let mut is_in_class = false;
        loop {
            match src.get(pos) {
                None | Some(b'\n' | b'\r') => return self.refuse(Refusal::Unterminated),
                Some(b'/') if !is_in_class => break,
                Some(b'[') => is_in_class = true,
                Some(b']') => is_in_class = false,
                Some(b'\\') => {
                    if matches!(src.get(pos + 1), None | Some(b'\n' | b'\r')) {
                        return self.refuse(Refusal::Unterminated);
                    }
                    pos += 1;
                }
                Some(0xE2) if matches!(src.get(pos..pos + 3), Some([_, 0x80, 0xA8 | 0xA9])) => {
                    return self.refuse(Refusal::Unterminated);
                }
                _ => {}
            }
            pos += 1;
        }
        pos += 1;
        while src.get(pos).is_some_and(|&c| is_name_byte(c)) {
            pos += 1;
        }
        if matches!(src.get(pos), Some(b'\\' | 0x80..)) {
            return self.refuse(Refusal::UnusualRegex);
        }
        self.set(T::Regex, start, pos);
    }
}

// ───────────────────────────── JSX ─────────────────────────────

impl Lexer<'_> {
    /// `ScanJsxIdentifier`: the token is a name or a keyword, which goes on through `-`.
    pub(crate) fn scan_jsx_identifier(&mut self) {
        if !self.token.is_identifier_or_keyword() || self.token == T::PrivateIdentifier {
            return;
        }
        let src = self.src;
        let mut end = self.end as usize;
        if src.get(end) == Some(&b'-') {
            while src.get(end).is_some_and(|&c| is_name_byte(c) || c == b'-') {
                end += 1;
            }
            if matches!(src.get(end), Some(b'\\' | 0x80..)) {
                return self.refuse(Refusal::Unsupported);
            }
            self.atom = self.names.atom(&src[self.start as usize..end], self.atoms);
            self.end = end as u32;
        }
        self.token = T::Identifier;
    }

    /// `ScanJsxAttributeValue`: scans the token after the `=` of an attribute. A string has no
    /// escapes, and its value is the text between the quotes.
    pub(crate) fn scan_jsx_attribute_value(&mut self) {
        let before = self.end as usize;
        // A string with a line break in it is refused as a string of JavaScript.
        let had_refused = self.refusal;
        self.next();
        let src = self.src;
        let start = match self.refusal == had_refused {
            true if self.token != T::String => return,
            true => self.start as usize,
            // It is scanned again from the quote.
            false => {
                self.refusal = had_refused;
                let mut pos = before;
                while matches!(src.get(pos), Some(b' ' | b'\t' | b'\n' | b'\r')) {
                    pos += 1;
                }
                if !matches!(src.get(pos), Some(b'"' | b'\'')) {
                    return self.refuse(Refusal::Unsupported);
                }
                pos
            }
        };
        let quote = src[start];
        let Some(len) = bun_core::strings::index_of_char_usize(&src[start + 1..], quote) else {
            return self.refuse(Refusal::Unterminated);
        };
        let text = &src[start + 1..start + 1 + len];
        if core::str::from_utf8(text).is_err() {
            return self.refuse(Refusal::NotUtf8);
        }
        // TypeScript reads a string that blanks precede as one of JavaScript.
        if start != before && bun_core::strings::contains_char(text, b'\\') {
            return self.refuse(Refusal::Unsupported);
        }
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::String, start, start + len + 2);
    }

    /// `ScanJsxToken`: scans a child of an element, from the end of the token. Text that is nothing
    /// but blanks and has a line break is no child.
    pub(crate) fn next_jsx_child(&mut self) {
        let src = self.src;
        self.full_start = self.end;
        self.newline_before = false;
        let mut start = self.end as usize;
        loop {
            match src.get(start) {
                None => return self.set(T::Eof, src.len(), src.len()),
                Some(b'{') => return self.set(T::OpenBrace, start, start + 1),
                Some(b'<') if src.get(start + 1) == Some(&b'/') => {
                    return self.set(T::LessThanSlash, start, start + 2);
                }
                Some(b'<') => return self.set(T::LessThan, start, start + 1),
                Some(_) => {}
            }
            let rest = &src[start..];
            let len = bun_core::strings::index_of_any(rest, b"{<").unwrap_or(rest.len());
            let text = &rest[..len];
            // Each is an error, and stays text.
            if bun_core::strings::index_of_any(text, b">}").is_some() {
                return self.refuse(Refusal::Reported);
            }
            let Ok(valid) = core::str::from_utf8(text) else {
                return self.refuse(Refusal::NotUtf8);
            };
            let needs_fixing = text
                .iter()
                .any(|&c| matches!(c, b'&' | b'\n' | b'\r' | 0x80..));
            if !needs_fixing {
                self.atom = self.names.atom(text, self.atoms);
                return self.set(T::JsxText, start, start + len);
            }
            let fixed = fix_whitespace_and_decode_jsx_entities(valid);
            if fixed.is_empty() {
                self.newline_before = true;
                start += len;
                continue;
            }
            self.atom = self.names.atom(&fixed, self.atoms);
            return self.set(T::JsxText, start, start + len);
        }
    }
}

fn is_line_break(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// The value of the JSX text `text`: lines are trimmed and joined by a blank, lines of blanks are
/// dropped, and entities are decoded.
fn fix_whitespace_and_decode_jsx_entities(text: &str) -> Vec<u8> {
    let mut decoded = Vec::new();
    let mut after_last_non_whitespace = None;
    // The blanks at the start of the first line stay.
    let mut first_non_whitespace = Some(0);
    for (at, c) in text.char_indices() {
        if is_line_break(c) {
            if let (Some(start), Some(end)) = (first_non_whitespace, after_last_non_whitespace) {
                if !decoded.is_empty() {
                    decoded.push(b' ');
                }
                decode_jsx_entities(&text[start..end], &mut decoded);
            }
            first_non_whitespace = None;
        } else if !bun_core::lexer::is_whitespace(c as i32) {
            after_last_non_whitespace = Some(at + c.len_utf8());
            first_non_whitespace.get_or_insert(at);
        }
    }
    // So do those at the end of the last line.
    if let Some(start) = first_non_whitespace {
        if !decoded.is_empty() {
            decoded.push(b' ');
        }
        decode_jsx_entities(&text[start..], &mut decoded);
    }
    decoded
}

fn decode_jsx_entities(mut text: &str, decoded: &mut Vec<u8>) {
    while let Some(at) = bun_core::strings::index_of_char_usize(text.as_bytes(), b'&') {
        decoded.extend_from_slice(&text.as_bytes()[..at]);
        text = &text[at + 1..];
        let entity = bun_core::strings::index_of_char_usize(text.as_bytes(), b';')
            .map(|len| &text[..len])
            .filter(|entity| !entity.is_empty());
        let c = entity.and_then(|entity| match entity.strip_prefix('#') {
            Some(number) => {
                let parsed = match number.strip_prefix('x').filter(|_| number.len() > 1) {
                    Some(hex) => parse_entity_number(hex, 16),
                    None => parse_entity_number(number, 10),
                };
                Some(parsed.unwrap_or(0xFFFD))
            }
            None => bun_ast::lexer_tables::JSX_ENTITY
                .get(entity.as_bytes())
                .map(|&c| c as u32),
        });
        match (c, entity) {
            (Some(c), Some(entity)) => {
                Lexer::push_code_point(decoded, c);
                text = &text[entity.len() + 1..];
            }
            _ => decoded.push(b'&'),
        }
    }
    decoded.extend_from_slice(text.as_bytes());
}

/// The code point that the digits of `&#..;` stand for.
fn parse_entity_number(digits: &str, radix: u32) -> Option<u32> {
    // A sign and separators are what `parse_int` of the other parser takes too.
    if !digits.bytes().all(|c| char::from(c).is_digit(radix)) {
        return None;
    }
    u32::from_str_radix(digits, radix)
        .ok()
        .filter(|&c| c <= 0x10_FFFF)
}

/// `ParsePseudoBigInt`: the digits `digits` of base `radix` in base 10.
fn decimal_digits(digits: &[u8], radix: u32) -> Vec<u8> {
    // Base 1e9, least significant first.
    let mut limbs: Vec<u32> = vec![0];
    for &digit in digits {
        let mut carry = u64::from(char::from(digit).to_digit(radix).unwrap_or(0));
        for limb in &mut limbs {
            let value = u64::from(*limb) * u64::from(radix) + carry;
            *limb = (value % 1_000_000_000) as u32;
            carry = value / 1_000_000_000;
        }
        if carry > 0 {
            limbs.push(carry as u32);
        }
    }
    let mut limbs = limbs.iter().rev();
    let mut decimal = limbs.next().map_or_else(String::new, u32::to_string);
    for limb in limbs {
        decimal.push_str(&format!("{limb:09}"));
    }
    decimal.into_bytes()
}

/// The value of the digits `digits` of base `radix`, a power of two, rounded once.
fn number_from_digits(digits: &[u8], radix: u32) -> f64 {
    let bits = radix.trailing_zeros();
    // As many of the leading digits as fit. The others only give a power of two, and decide a tie.
    let (mut leading, mut exponent, mut is_inexact) = (0u64, 0i32, false);
    for digit in digits.iter().filter_map(|&c| char::from(c).to_digit(radix)) {
        if leading >> (64 - bits) == 0 {
            leading = leading << bits | u64::from(digit);
        } else {
            exponent = exponent.saturating_add(bits as i32);
            is_inexact |= digit != 0;
        }
    }
    (leading | u64::from(is_inexact)) as f64 * 2f64.powi(exponent)
}
