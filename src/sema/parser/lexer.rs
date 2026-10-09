//! The scanner. It works on bytes: one dispatch on the first byte of a token, 16 bytes at a time
//! through names, strings and comments. Everything that is not ASCII takes a slow path.
//!
//! What it cannot scan it refuses ([`Lexer::refuse`]): from then on every token is the end of the
//! file, so the parser unwinds without testing anything. With `Options::recovers` it reports an error
//! and goes on as TypeScript's scanner does ([`Lexer::error`]), where that is written.

use crate::Refusal;
use crate::names::{Names, Text};
use crate::token::T;
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::{CommentDirective, CommentDirectiveKind, Diagnostic, DiagnosticKind};
use std::simd::cmp::{SimdPartialEq, SimdPartialOrd};
use std::simd::u8x16;

pub(crate) struct Lexer<'a> {
    pub(crate) src: &'a [u8],
    pub(crate) token: T,
    /// A line break precedes the token.
    pub(crate) newline_before: bool,
    /// The name or keyword has a Unicode escape, or the piece of a template an invalid escape.
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
    /// `full_start`, then.
    pub(crate) refused_after: u32,
    /// `</` is one token.
    pub(crate) is_jsx: bool,
    /// `Dialect::ecmascript`, in a JavaScript file.
    pub(crate) is_ecmascript: bool,
    /// The goal symbol is Script.
    pub(crate) is_script: bool,
    /// `Dialect::typescript_5`
    pub(crate) is_typescript_5: bool,
    /// `Dialect::babel`
    pub(crate) is_babel: bool,
    pub(crate) atoms: &'a dyn Intern,
    pub(crate) names: &'a mut Names,
    /// `hir::File::comment_directives`
    pub(crate) comment_directives: Vec<CommentDirective>,
    /// The comments before the first token.
    pub(crate) leading_comments: Vec<(u32, u32)>,
    /// `hir::File::comments`
    pub(crate) comments: Vec<(u32, u32)>,
    /// What TypeScript's scanner reports and ECMAScript allows outside strict code: the code of the
    /// message, and from where to where. Only with `is_ecmascript`: otherwise the text is refused.
    pub(crate) flagged: Vec<(u32, u32, u32)>,
    /// `Options::recovers`
    pub(crate) recovers: bool,
    /// What [`Lexer::error`] has reported and the parser has not taken yet
    /// (`Parser::take_errors_of_scanner`), in the order of events.
    pub(crate) errors: Vec<Diagnostic>,
    /// `skipJSDocLeadingAsterisks`: the lexer is in a type of a JSDoc comment.
    pub(crate) skips_jsdoc_asterisks: bool,
    /// `hir::File::jsdoc_asterisks`, in the order of events: not sorted, and one more than once.
    pub(crate) jsdoc_asterisks: Vec<u32>,
    /// For each of `errors`, where the scan that reported it began. See [`Lexer::error`].
    origins: Vec<u32>,
    /// Where values with escapes are decoded.
    buffer: Vec<u8>,
    pub(crate) stack_check: bun_core::StackCheck,
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

/// The number of leading bytes of `bytes` that are tabs or spaces.
#[inline(always)]
fn blank_run(bytes: u8x16) -> u32 {
    let blanks = bytes.simd_eq(u8x16::splat(b'\t')) | bytes.simd_eq(u8x16::splat(b' '));
    (!blanks.to_bitmask() as u32 | 1 << 16).trailing_zeros()
}

/// The end of the tabs and spaces at `pos`. How far a line is indented is hard to guess, so it is not
/// asked byte by byte.
#[inline(always)]
fn end_of_indentation(src: &[u8], mut pos: usize) -> usize {
    while let Some(chunk) = src.get(pos..).and_then(|rest| rest.first_chunk::<16>()) {
        let len = blank_run(u8x16::from_array(*chunk)) as usize;
        pos += len;
        if len < 16 {
            break;
        }
    }
    while matches!(src.get(pos), Some(b'\t' | b' ')) {
        pos += 1;
    }
    pos
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

/// `DecodeLastRuneInString`: the code point at the end of `text`, and its length in bytes.
fn decode_last(text: &[u8]) -> Option<(u32, usize)> {
    (1..=4).find_map(|len| {
        let last = text.get(text.len().checked_sub(len)?..)?;
        decode(last).filter(|decoded| decoded.1 == len)
    })
}

/// Where the first of `ends` is from `pos` on, or the end of `src`.
#[inline]
fn end_of_run_before(src: &[u8], mut pos: usize, ends: [u8; 4]) -> usize {
    while let Some(chunk) = src.get(pos..).and_then(|rest| rest.first_chunk::<16>()) {
        let bytes = u8x16::from_array(*chunk);
        let [a, b, c, d] = ends.map(|end| bytes.simd_eq(u8x16::splat(end)));
        let mask = (a | b | c | d).to_bitmask();
        if mask != 0 {
            return pos + mask.trailing_zeros() as usize;
        }
        pos += 16;
    }
    while src.get(pos).is_some_and(|c| !ends.contains(c)) {
        pos += 1;
    }
    pos
}

/// `IsWhiteSpaceSingleLine` for a code point that is not ASCII.
fn is_unicode_blank(c: u32) -> bool {
    matches!(
        c,
        0x85 | 0xA0 | 0x1680 | 0x2000..=0x200B | 0x202F | 0x205F | 0x3000 | 0xFEFF
    )
}

/// `IsWhiteSpaceLike`
fn is_white_space_like(c: u32) -> bool {
    matches!(c, 0x09..=0x0D | 0x20 | 0x2028 | 0x2029) || is_unicode_blank(c)
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
            refused_after: 0,
            is_jsx: false,
            is_ecmascript: false,
            is_script: false,
            is_typescript_5: false,
            is_babel: false,
            atoms,
            names,
            comment_directives: Vec::new(),
            leading_comments: Vec::new(),
            comments: Vec::new(),
            flagged: Vec::new(),
            recovers: false,
            errors: Vec::new(),
            skips_jsdoc_asterisks: false,
            jsdoc_asterisks: Vec::new(),
            origins: Vec::new(),
            buffer: Vec::new(),
            stack_check: bun_core::StackCheck::init(),
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
        if self.comments.last().is_some_and(|last| last.0 >= mark.end) {
            self.forget_comments_from(mark.end);
        }
        if self.flagged.last().is_some_and(|last| last.1 >= mark.end) {
            self.forget_flagged_from(mark.end);
        }
        if !self.errors.is_empty() {
            self.forget_errors_from(mark.start.saturating_add(1));
        }
    }

    /// Forgets the errors of the scans that began at `pos` or later: they are made again.
    #[cold]
    #[inline(never)]
    fn forget_errors_from(&mut self, pos: u32) {
        let kept = self.origins.partition_point(|&origin| origin < pos);
        self.errors.truncate(kept);
        self.origins.truncate(kept);
    }

    /// `s.errorAt(message, pos, length)`: the message `code` with `args`, from `start` to `end`.
    /// Returns whether the scanner goes on. Without recovery it does not: the text is refused for
    /// `why`, and the caller returns.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn error(
        &mut self,
        why: Refusal,
        code: u32,
        (start, end): (usize, usize),
        args: &[&[u8]],
    ) -> bool {
        if !self.recovers {
            self.refuse(why);
            return false;
        }
        let at = match start == end {
            true => (start as u32, Diagnostic::NO_LENGTH),
            false => (start as u32, end as u32),
        };
        // A scan begins where the token before ends, a second scan of the token behind its start.
        let origin = match self.full_start == self.end {
            true => self.full_start,
            false => self.start.saturating_add(1),
        };
        // The parser has taken the others.
        self.origins.truncate(self.errors.len());
        self.origins.push(origin);
        self.errors
            .push(Diagnostic::new(DiagnosticKind::Parse, at, code, args));
        true
    }

    /// What has been reported. "Keywords cannot contain escape characters." about the token itself
    /// stays: `nextToken` reports it when it leaves the token.
    #[cold]
    #[inline(never)]
    pub(crate) fn take_errors(&mut self) -> Vec<Diagnostic> {
        let mut taken = std::mem::take(&mut self.errors);
        let is_waiting = (taken.last()).is_some_and(|it| it.code == 1260 && it.start == self.start);
        if is_waiting && let Some(waiting) = taken.pop() {
            let origin = self
                .origins
                .get(taken.len())
                .copied()
                .unwrap_or(self.full_start);
            self.origins.clear();
            self.origins.push(origin);
            self.errors.push(waiting);
        }
        taken
    }

    /// `nextTokenWithoutCheck`: the token is taken as a name. Returns whether that error about it
    /// was still here.
    #[cold]
    #[inline(never)]
    pub(crate) fn forget_escaped_keyword(&mut self) -> bool {
        let is_waiting =
            (self.errors.last()).is_some_and(|it| it.code == 1260 && it.start == self.start);
        if is_waiting {
            self.errors.pop();
        }
        is_waiting
    }

    /// [`Lexer::error`], where only recovery gets.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn report(&mut self, code: u32, at: (usize, usize), args: &[&[u8]]) {
        self.error(Refusal::Unsupported, code, at, args);
    }

    #[cold]
    #[inline(never)]
    fn forget_flagged_from(&mut self, pos: u32) {
        let kept = self.flagged.partition_point(|it| it.1 < pos);
        self.flagged.truncate(kept);
    }

    /// Notes what is in `flagged`, or refuses the text.
    #[cold]
    fn flag(&mut self, code: u32, start: usize, end: usize) -> bool {
        if self.is_ecmascript {
            self.flagged.push((code, start as u32, end as u32));
        }
        self.is_ecmascript
    }

    /// What follows `pos` is scanned again, maybe as something else.
    #[cold]
    #[inline(never)]
    fn forget_comments_from(&mut self, pos: u32) {
        let kept = self.comments.partition_point(|comment| comment.0 < pos);
        self.comments.truncate(kept);
    }

    /// The text of `atom`, which is one of a token of the file. Nothing for no atom.
    pub(crate) fn text_of(&self, atom: Atom) -> &[u8] {
        match self.names.is_own() {
            true => self.names.bytes(atom, self.src),
            false if atom.is_none() => b"",
            false => self.atoms.bytes(atom),
        }
    }

    /// Gives up on the file, or on the speculative parse that is going on.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn refuse(&mut self, why: Refusal) {
        if self.refusal.is_none() {
            self.refusal = Some(why);
            self.refused_at = (self.start, core::panic::Location::caller());
            self.refused_after = self.full_start;
        }
        self.token = T::Eof;
        self.start = self.src.len() as u32;
        self.end = self.start;
    }

    /// Nothing more of the text is read.
    pub(crate) fn stop(&mut self) {
        self.token = T::Eof;
    }

    /// From here on the text ends where `src` ends: before the `*/` of a comment, or with the file.
    pub(crate) fn set_src(&mut self, src: &'a [u8]) {
        self.src = src;
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
    #[inline(always)]
    pub(crate) fn next(&mut self) {
        self.full_start = self.end;
        self.newline_before = false;
        self.scan(self.end as usize);
    }

    /// Scans the token at `pos`, or after the blanks and comments there. Every call in it is the
    /// last thing it does, so it saves no register.
    fn scan(&mut self, mut pos: usize) {
        let src = self.src;
        let at = |pos: usize| src.get(pos).copied().unwrap_or(0);
        loop {
            let Some(&byte) = src.get(pos) else {
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
                    pos = end_of_indentation(src, next);
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
                b'.' => match (at(next), at(next + 1)) {
                    (b'0'..=b'9', _) => return self.number(pos),
                    (b'.', b'.') => self.set(T::DotDotDot, pos, pos + 3),
                    _ => self.set(T::Dot, pos, next),
                },
                b'=' => match (at(next), at(next + 1)) {
                    (b'=', b'=') if at(pos + 3) == b'=' => return self.same_four_times(pos),
                    (b'=', b'=') => self.set(T::EqualsEqualsEquals, pos, pos + 3),
                    (b'=', _) => self.set(T::EqualsEquals, pos, pos + 2),
                    (b'>', _) => self.set(T::EqualsGreaterThan, pos, pos + 2),
                    _ => self.set(T::Equals, pos, next),
                },
                b'\'' | b'"' => return self.string(pos, byte),
                b'/' => match at(next) {
                    b'/' | b'*' => return self.scan_after_comments(pos),
                    b'=' => self.set(T::SlashEquals, pos, pos + 2),
                    _ => self.set(T::Slash, pos, next),
                },
                b'0'..=b'9' => return self.number(pos),
                b'!' => match (at(next), at(next + 1)) {
                    (b'=', b'=') => self.set(T::ExclamationEqualsEquals, pos, pos + 3),
                    (b'=', _) => self.set(T::ExclamationEquals, pos, pos + 2),
                    _ => self.set(T::Exclamation, pos, next),
                },
                b'?' => match (at(next), at(next + 1)) {
                    (b'.', after) if !after.is_ascii_digit() => {
                        self.set(T::QuestionDot, pos, pos + 2);
                    }
                    (b'?', b'=') => self.set(T::QuestionQuestionEquals, pos, pos + 3),
                    (b'?', _) => self.set(T::QuestionQuestion, pos, pos + 2),
                    _ => self.set(T::Question, pos, next),
                },
                b'<' => match (at(next), at(next + 1)) {
                    (b'<', b'<') if at(pos + 3) == b'<' => return self.same_four_times(pos),
                    (b'<', b'=') => self.set(T::LessThanLessThanEquals, pos, pos + 3),
                    (b'<', _) => self.set(T::LessThanLessThan, pos, pos + 2),
                    (b'=', _) => self.set(T::LessThanEquals, pos, pos + 2),
                    (b'/', after) if self.is_jsx && !self.is_ecmascript && after != b'*' => {
                        self.set(T::LessThanSlash, pos, pos + 2);
                    }
                    (b'!', b'-') if self.is_script && at(pos + 3) == b'-' => {
                        return self.scan_after_comments(pos);
                    }
                    _ => self.set(T::LessThan, pos, next),
                },
                // The parser asks for `>=`, `>>` and so on where they can be.
                b'>' => {
                    if at(next) == b'>' && src.get(pos..pos + 4) == Some(b">>>>") {
                        return self.same_four_times(pos);
                    }
                    self.set(T::GreaterThan, pos, next);
                }
                b'+' => match at(next) {
                    b'+' => self.set(T::PlusPlus, pos, pos + 2),
                    b'=' => self.set(T::PlusEquals, pos, pos + 2),
                    _ => self.set(T::Plus, pos, next),
                },
                b'-' => match (at(next), at(next + 1)) {
                    // Only blanks and comments are before it on its line.
                    (b'-', b'>')
                        if self.is_script && (self.newline_before || self.full_start == 0) =>
                    {
                        return self.scan_after_comments(pos);
                    }
                    (b'-', _) => self.set(T::MinusMinus, pos, pos + 2),
                    (b'=', _) => self.set(T::MinusEquals, pos, pos + 2),
                    _ => self.set(T::Minus, pos, next),
                },
                b'*' => match (at(next), at(next + 1)) {
                    (b'*', b'=') => self.set(T::AsteriskAsteriskEquals, pos, pos + 3),
                    (b'*', _) => self.set(T::AsteriskAsterisk, pos, pos + 2),
                    (b'=', _) => self.set(T::AsteriskEquals, pos, pos + 2),
                    _ if self.newline_before && self.skips_jsdoc_asterisks => {
                        return self.scan_at_jsdoc_asterisk(pos);
                    }
                    _ => self.set(T::Asterisk, pos, next),
                },
                b'%' => match at(next) {
                    b'=' => self.set(T::PercentEquals, pos, pos + 2),
                    _ => self.set(T::Percent, pos, next),
                },
                b'&' => match (at(next), at(next + 1)) {
                    (b'&', b'=') => self.set(T::AmpersandAmpersandEquals, pos, pos + 3),
                    (b'&', _) => self.set(T::AmpersandAmpersand, pos, pos + 2),
                    (b'=', _) => self.set(T::AmpersandEquals, pos, pos + 2),
                    _ => self.set(T::Ampersand, pos, next),
                },
                b'|' => match (at(next), at(next + 1)) {
                    (b'|', b'|') if at(pos + 3) == b'|' => return self.same_four_times(pos),
                    (b'|', b'=') => self.set(T::BarBarEquals, pos, pos + 3),
                    (b'|', _) => self.set(T::BarBar, pos, pos + 2),
                    (b'=', _) => self.set(T::BarEquals, pos, pos + 2),
                    _ => self.set(T::Bar, pos, next),
                },
                b'^' => match at(next) {
                    b'=' => self.set(T::CaretEquals, pos, pos + 2),
                    _ => self.set(T::Caret, pos, next),
                },
                b'`' => return self.template(pos, true),
                b'#' => {
                    let is_first = pos == 0 || pos == 3 && src.starts_with(b"\xEF\xBB\xBF");
                    if is_first && at(next) == b'!' {
                        return self.scan_after_comments(pos);
                    }
                    return self.private_name(pos);
                }
                b'\\' => return self.name_slowly(pos, pos),
                0x80.. => return self.scan_after_comments(pos),
                _ => return self.invalid_character(Refusal::UnexpectedCharacter, pos),
            }
            return;
        }
    }

    /// See `Parser::is_too_deep`.
    #[inline(always)]
    fn is_too_deep(&mut self) -> bool {
        if self.stack_check.is_safe_to_recurse() {
            return false;
        }
        self.refuse(Refusal::TooDeep);
        true
    }

    /// The `default:` of `Scan`, at what starts no token. Go reads invalid UTF-8 as U+FFFD.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn invalid_character(&mut self, why: Refusal, pos: usize) {
        if !self.recovers {
            return self.refuse(why);
        }
        let src = self.src;
        match decode(src.get(pos..).unwrap_or_default()) {
            Some((c, len)) if c != 0xFFFD => {
                self.report(1127, (pos, pos + len), &[]);
                self.set(T::Invalid, pos, pos + len);
            }
            // "File appears to be binary."
            _ => {
                self.report(1490, (0, 0), &[]);
                self.set(T::NotText, pos, src.len());
            }
        }
    }

    /// At a comment, or at a character that is not ASCII: scans the token after it and after the
    /// blanks and comments that follow it. They are passed over in a loop: not every build turns
    /// the last call of a function into a jump, and a file can start with thousands of comments.
    #[inline(never)]
    fn scan_after_comments(&mut self, mut pos: usize) {
        if self.is_too_deep() {
            return;
        }
        loop {
            let end = match self.at(pos) {
                b'/' => match self.at(pos + 1) {
                    b'/' => Some(self.line_comment(pos)),
                    b'*' => self.block_comment(pos),
                    _ => return self.scan(pos),
                },
                b'\n' => {
                    self.newline_before = true;
                    Some(end_of_indentation(self.src, pos + 1))
                }
                b'\r' => {
                    self.newline_before = true;
                    Some(pos + 1)
                }
                b' ' | b'\t' | 0x0B | 0x0C => Some(pos + 1),
                b'<' | b'-' | b'#' => match self.end_of_unusual_comment(pos) {
                    Some(end) => Some(end),
                    None => return self.scan(pos),
                },
                0x80.. => self.not_ascii(pos),
                _ => return self.scan(pos),
            };
            // Otherwise the token is set.
            match end {
                Some(end) => pos = end,
                None => return,
            }
        }
    }

    /// `Scan`, at a `*` behind a line break, with `skipJSDocLeadingAsterisks`: the first one in the
    /// trivia of a token is trivia too (`TokenFlagsPrecedingJSDocLeadingAsterisks`).
    #[cold]
    #[inline(never)]
    fn scan_at_jsdoc_asterisk(&mut self, pos: usize) {
        if self.is_too_deep() {
            return;
        }
        let (at, full_start) = (pos as u32, self.full_start);
        // A trivia can be scanned again: then the last one is this one, or one behind it.
        let is_in_trivia = |&last: &u32| full_start <= last && last < at;
        if self.jsdoc_asterisks.last().is_some_and(is_in_trivia) {
            return self.set(T::Asterisk, pos, pos + 1);
        }
        self.jsdoc_asterisks.push(at);
        self.scan(pos + 1)
    }

    /// At a character that is not ASCII: its end, if it is a blank or a line break. Otherwise it
    /// starts a name, which is scanned, or the text is refused.
    #[cold]
    #[inline(never)]
    fn not_ascii(&mut self, pos: usize) -> Option<usize> {
        let Some((c, len)) = decode(&self.src[pos..]) else {
            self.invalid_character(Refusal::NotUtf8, pos);
            return None;
        };
        if c == 0x2028 || c == 0x2029 {
            self.newline_before = true;
        } else if !is_unicode_blank(c) {
            self.name_slowly(pos, pos);
            return None;
        }
        Some(pos + len)
    }

    /// The end of the line of `pos`, if a `<!--`, a `-->` or a `#!` there makes the rest of it a
    /// comment.
    #[cold]
    #[inline(never)]
    fn end_of_unusual_comment(&self, pos: usize) -> Option<usize> {
        let rest = &self.src[pos..];
        let is_comment = match self.is_script {
            true if rest.starts_with(b"<!--") => true,
            // Only blanks and comments are before it on its line.
            true if rest.starts_with(b"-->") => self.newline_before || self.full_start == 0,
            _ => {
                rest.starts_with(b"#!")
                    && (pos == 0 || pos == 3 && self.src.starts_with(b"\xEF\xBB\xBF"))
            }
        };
        is_comment.then(|| self.end_of_line(pos))
    }

    /// `isConflictMarkerTrivia`
    fn is_conflict_marker(&self, pos: usize) -> bool {
        let src = self.src;
        let is_first_in_line = pos == 0 || matches!(src.get(pos - 1), Some(b'\n' | b'\r'));
        let Some([marker @ .., after]) = src.get(pos..pos + 8) else {
            return false;
        };
        marker.iter().all(|&c| c == marker[0])
            && (marker[0] == b'=' || *after == b' ')
            && (is_first_in_line || self.recovers && self.is_third_in_line(pos))
    }

    /// `isConflictMarkerTrivia` takes that for the start of a line too.
    fn is_third_in_line(&self, pos: usize) -> bool {
        let before = pos.checked_sub(2).and_then(|end| self.src.get(..end));
        decode_last(before.unwrap_or_default())
            .is_some_and(|(c, _)| matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029))
    }

    /// `scanConflictMarkerTrivia`, at `pos`. Returns the end of what is passed over.
    fn conflict_marker(&mut self, pos: usize) -> usize {
        self.report(1185, (pos, pos + 7), &[]);
        let marker = self.at(pos);
        if matches!(marker, b'<' | b'>') {
            return self.end_of_line(pos);
        }
        // To the next `=======` or `>>>>>>>`.
        let mut end = pos;
        while let Some(&c) = self.src.get(end) {
            if matches!(c, b'=' | b'>') && c != marker && self.is_conflict_marker(end) {
                break;
            }
            end += 1;
        }
        end
    }

    /// At `====`, `<<<<`, `>>>>` or `||||`.
    #[cold]
    #[inline(never)]
    fn same_four_times(&mut self, pos: usize) {
        if self.is_conflict_marker(pos) {
            if !self.recovers {
                return self.refuse(Refusal::ConflictMarker);
            }
            let end = self.conflict_marker(pos);
            return self.scan_after_comments(end);
        }
        match self.at(pos) {
            b'=' => self.set(T::EqualsEqualsEquals, pos, pos + 3),
            b'<' => self.set(T::LessThanLessThan, pos, pos + 2),
            b'|' => self.set(T::BarBar, pos, pos + 2),
            _ => self.set(T::GreaterThan, pos, pos + 1),
        }
    }

    // ───────────────────────────── names ─────────────────────────────

    /// A name or a keyword that starts at `start` with an ASCII letter, `_` or `$`.
    #[inline(never)]
    fn name(&mut self, start: usize) {
        self.has_escape = false;
        let Some(chunk) = self
            .src
            .get(start..)
            .and_then(|rest| rest.first_chunk::<16>())
        else {
            return self.name_of_any_length(start);
        };
        let len = name_run(u8x16::from_array(*chunk));
        if len == 16 {
            return self.long_name(start);
        }
        let after = chunk[(len & 15) as usize];
        if after >= 0x80 || after == b'\\' {
            return self.name_slowly(start, start + len as usize);
        }
        let words = crate::names::short_words(chunk, len);
        match self.names.find_short(words) {
            Some((atom, kind)) => {
                self.atom = atom;
                self.set(kind, start, start + len as usize);
            }
            None => self.new_short_name(start, len as usize, words),
        }
    }

    #[cold]
    #[inline(never)]
    fn new_short_name(&mut self, start: usize, len: usize, words: [u64; 2]) {
        let text = Text::of_source(self.src, start, start + len);
        let (atom, kind) = self.names.short_elsewhere(words, text, self.atoms);
        self.atom = atom;
        self.set(kind, start, start + len);
    }

    /// The same for a name of 16 bytes or more.
    #[inline(never)]
    fn long_name(&mut self, start: usize) {
        let src = self.src;
        let Some(chunk) = (src.get(start + 16..)).and_then(|rest| rest.first_chunk::<16>()) else {
            return self.name_of_any_length(start);
        };
        let len = 16 + name_run(u8x16::from_array(*chunk)) as usize;
        if len == 32 {
            return self.name_of_any_length(start);
        }
        let after = chunk[len & 15];
        if after >= 0x80 || after == b'\\' {
            return self.name_slowly(start, start + len);
        }
        let text = Text::of_source(src, start, start + len);
        self.atom = self.names.long(text, self.atoms);
        // No keyword is that long.
        self.set(T::Identifier, start, start + len);
    }

    /// The same for a name of 32 bytes or more, or near the end of the text.
    #[cold]
    #[inline(never)]
    fn name_of_any_length(&mut self, start: usize) {
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
        self.atom = (self.names).atom(Text::of_source(src, start, end), self.atoms);
        self.set(crate::token::keyword(text), start, end);
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
        // The text of a private name has the `#`.
        let is_private = src.get(start) == Some(&b'#');
        loop {
            // `scanIdentifierParts`: with `recovers` the name ends before what is no part of it.
            let (c, len) = match src.get(pos) {
                Some(b'\\') => match self.unicode_escape(pos + 1) {
                    Some((c, end)) => (c, end - pos),
                    None if self.recovers => break,
                    None => {
                        self.buffer = text;
                        return self.refuse(Refusal::InvalidEscape);
                    }
                },
                Some(_) => match decode(&src[pos..]) {
                    Some(decoded) => decoded,
                    None if self.recovers => break,
                    None => {
                        self.buffer = text;
                        return self.refuse(Refusal::NotUtf8);
                    }
                },
                None => break,
            };
            let belongs = match text.len() == usize::from(is_private) {
                true => {
                    is_identifier_start(c)
                        || self.is_ecmascript
                            && bun_core::lexer::is_recent_identifier_start(c as i32)
                }
                false => {
                    is_identifier_part(c)
                        || self.is_ecmascript
                            && bun_core::lexer::is_recent_identifier_part(c as i32)
                }
            };
            let is_escape = src[pos] == b'\\';
            if !belongs {
                if is_escape && !self.recovers {
                    self.buffer = text;
                    return self.refuse(Refusal::InvalidEscape);
                }
                break;
            }
            let Some(c) = char::from_u32(c) else {
                self.buffer = text;
                return self.refuse(Refusal::InvalidEscape);
            };
            self.has_escape |= is_escape;
            text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            pos += len;
        }
        if text.len() == usize::from(is_private) {
            self.buffer = text;
            return match is_private {
                true => self.hash_without_name(start),
                false => self.invalid_character(Refusal::UnexpectedCharacter, start),
            };
        }
        self.atom = (self.names).atom(Text::elsewhere(src, &text), self.atoms);
        let mut kind = crate::token::keyword(&text);
        self.buffer = text;
        if is_private {
            return self.set(T::PrivateIdentifier, start, pos);
        }
        if self.has_escape && kind != T::Identifier {
            // `GetIdentifierToken`. See `take_errors`.
            if self.recovers {
                self.report(1260, (start, pos), &[]);
                return self.set(kind, start, pos);
            }
            if matches!(kind, T::Await | T::Yield | T::Async) {
                return self.refuse(Refusal::EscapedKeyword);
            }
            // It is an error where it is read as the keyword. TypeScript reads a word that is only
            // reserved in some places as the keyword where it can.
            kind = match kind.is_reserved_word() {
                true => T::EscapedReservedWord,
                false if self.is_ecmascript => T::Identifier,
                false => return self.refuse(Refusal::EscapedKeyword),
            };
        }
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
            if len == 0 || digits.get(len) != Some(&b'}') {
                return None;
            }
            let zeros = digits.iter().take_while(|&&c| c == b'0').count();
            let significant = &digits[zeros..len];
            if significant.len() > 6 {
                return None;
            }
            let significant = core::str::from_utf8(significant).ok()?;
            let c = match significant.is_empty() {
                true => 0,
                false => u32::from_str_radix(significant, 16).ok()?,
            };
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
        if src.get(end).is_some_and(u8::is_ascii_digit) {
            return self.hash_without_name(start);
        }
        while src.get(end).is_some_and(|&byte| is_name_byte(byte)) {
            end += 1;
        }
        if end == start + 1 || matches!(src.get(end), Some(b'\\' | 0x80..)) {
            return self.name_slowly(start, end);
        }
        self.has_escape = false;
        self.atom = (self.names).atom(Text::of_source(src, start, end), self.atoms);
        self.set(T::PrivateIdentifier, start, end);
    }

    /// The `#` of `Scan`, at `start`, that no name follows.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn hash_without_name(&mut self, start: usize) {
        if !self.recovers {
            return self.refuse(Refusal::UnexpectedCharacter);
        }
        // "'#!' can only be used at the start of a file."
        if self.at(start + 1) == b'!' {
            self.report(18026, (start, start + 2), &[]);
            return self.set(T::Invalid, start, start + 1);
        }
        self.report(1127, (start, start + 1), &[]);
        self.has_escape = false;
        let text = Text::of_source(self.src, start, start + 1);
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::PrivateIdentifier, start, start + 1);
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

    /// Notes the `//` comment at `start`. Returns its end.
    #[inline(never)]
    fn line_comment(&mut self, start: usize) -> usize {
        let end = self.end_of_line(start + 2);
        if self.full_start == 0 {
            self.leading_comments.push((start as u32, end as u32));
        }
        self.comments.push((start as u32, end as u32));
        // `processCommentDirective`: "Skip opening //", "Skip another / if present"
        let src = self.src;
        let mut pos = start + 2;
        while pos < end && src[pos] == b'/' {
            pos += 1;
        }
        self.comment_directive(start, pos, end);
        end
    }

    /// Notes the `/*` comment at `start`. Returns its end. `None`: it has none, and the text is
    /// refused.
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
            let Some(&byte) = src.get(pos) else {
                // "'*/' expected.", at the end of the text. The comment ends there.
                if !self.error(Refusal::Unterminated, 1010, (pos, pos), &[]) {
                    return None;
                }
                break pos;
            };
            match byte {
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
        if self.full_start == 0 {
            self.leading_comments.push((start as u32, end as u32));
        }
        self.comments.push((start as u32, end as u32));
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
    #[inline(never)]
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
                self.atom = self.atom_of_source(start + 1, pos);
                return self.set(T::String, start, pos + 1);
            }
            break;
        }
        self.string_slowly(start, quote);
    }

    /// The atom of the text from `start` to `end`, which has no zero byte and after which 16 more
    /// bytes of the source follow.
    #[inline]
    fn atom_of_source(&mut self, start: usize, end: usize) -> Atom {
        let text = Text::of_source(self.src, start, end);
        let len = end.saturating_sub(start);
        if len >= 16 {
            return match len {
                16..=32 => self.names.long(text, self.atoms),
                _ => self.names.other(text, self.atoms),
            };
        }
        let Some(chunk) = self
            .src
            .get(start..)
            .and_then(|rest| rest.first_chunk::<16>())
        else {
            return self.names.atom(text, self.atoms);
        };
        if len == 0 {
            return self.names.atom(text, self.atoms);
        }
        let words = crate::names::short_words(chunk, len as u32);
        match self.names.find_short(words) {
            Some((atom, _)) => atom,
            None => self.names.short_elsewhere(words, text, self.atoms).0,
        }
    }

    /// Appends the UTF-16 code unit or the code point `c` to `text`, which is WTF-8: the second half
    /// of a surrogate pair joins the first.
    pub(crate) fn push_code_point(text: &mut Vec<u8>, mut c: u32) {
        if (0xDC00..=0xDFFF).contains(&c)
            && let [.., 0xED, second @ 0xA0..=0xAF, third] = text[..]
        {
            let high = 0xD000 | u32::from(second & 0x3F) << 6 | u32::from(third & 0x3F);
            c = 0x1_0000 + ((high - 0xD800) << 10) + (c - 0xDC00);
            text.truncate(text.len() - 3);
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
    /// `\1` to `\377`, `\8` or `\9` at `pos` in a string. Returns its end.
    fn legacy_escape(&mut self, pos: usize, text: &mut Vec<u8>) -> Option<usize> {
        let end = self.end_of_invalid_escape(pos);
        let digits = self.src.get(pos + 1..end)?;
        let (code, c) = match digits.first()? {
            b'0'..=b'7' => (
                1487,
                u32::from_str_radix(core::str::from_utf8(digits).ok()?, 8).ok()?,
            ),
            &c @ (b'8' | b'9') => (1488, u32::from(c)),
            _ => return None,
        };
        if !self.flag(code, pos, end) {
            return None;
        }
        Self::push_code_point(text, c);
        Some(end)
    }

    /// `scanEscapeSequence`: how far the invalid escape at `pos` goes.
    fn end_of_invalid_escape(&self, pos: usize) -> usize {
        let is_octal = |at: usize| matches!(self.at(at), b'0'..=b'7');
        let is_hex = |at: usize| self.src.get(at).is_some_and(u8::is_ascii_hexdigit);
        let mut end = pos + 2;
        match self.at(pos + 1) {
            b'0'..=b'3' => {
                end += usize::from(is_octal(end));
                end += usize::from(is_octal(end));
            }
            b'4'..=b'7' => end += usize::from(is_octal(end)),
            b'x' => {
                while end < pos + 4 && is_hex(end) {
                    end += 1;
                }
            }
            b'u' if self.at(end) == b'{' => {
                end += 1;
                while is_hex(end) {
                    end += 1;
                }
                end += usize::from(self.at(end) == b'}');
            }
            b'u' => {
                while end < pos + 6 && is_hex(end) {
                    end += 1;
                }
            }
            _ => {}
        }
        end.min(self.src.len())
    }

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
                let Some((c, len)) = decode(&src[pos + 1..]) else {
                    return self.escaped_byte(pos, text);
                };
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

    /// `scanEscapeSequence`, at a backslash before a byte that is not UTF-8: Go reads U+FFFD.
    #[cold]
    #[inline(never)]
    fn escaped_byte(&self, pos: usize, text: &mut Vec<u8>) -> Option<usize> {
        if !self.recovers {
            return None;
        }
        Self::push_code_point(text, 0xFFFD);
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
        let has_end = loop {
            match src.get(pos) {
                None | Some(b'\n' | b'\r') => {
                    // "Unterminated string literal." The string ends there.
                    if !self.error(Refusal::Unterminated, 1002, (pos, pos), &[]) {
                        self.buffer = text;
                        return;
                    }
                    break false;
                }
                Some(&c) if c == quote => break true,
                Some(b'\\') => match self.escape(pos, &mut text) {
                    Some(end) => pos = end,
                    None => match self.legacy_escape(pos, &mut text) {
                        Some(end) => pos = end,
                        None if self.recovers => pos = self.invalid_escape(pos, &mut text, true),
                        None => {
                            self.buffer = text;
                            return self.refuse(Refusal::InvalidEscape);
                        }
                    },
                },
                Some(_) => {
                    let end = end_of_run_before(src, pos + 1, [quote, b'\\', b'\n', b'\r']);
                    let written = src.get(pos..end).unwrap_or_default();
                    is_ascii &= written.is_ascii();
                    text.extend_from_slice(written);
                    pos = end;
                }
            }
        };
        // TypeScript's scanner takes the bytes as they are.
        if !is_ascii && core::str::from_utf8(&src[start + 1..pos]).is_err() && !self.recovers {
            self.buffer = text;
            return self.refuse(Refusal::NotUtf8);
        }
        self.atom = (self.names).atom(Text::elsewhere(src, &text), self.atoms);
        self.buffer = text;
        self.set(T::String, start, pos + usize::from(has_end));
    }

    /// `scanEscapeSequence`, for what `escape` does not decode. `reports`: `ReportErrors`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn invalid_escape(&mut self, pos: usize, text: &mut Vec<u8>, reports: bool) -> usize {
        let src = self.src;
        let end = self.end_of_invalid_escape(pos);
        let written = src.get(pos..end).unwrap_or_default();
        let Some(&c) = src.get(pos + 1) else {
            // "Unexpected end of text." It stands for nothing.
            self.error(Refusal::Unterminated, 1126, (end, end), &[]);
            return end;
        };
        if !reports {
            text.extend_from_slice(written);
            return end;
        }
        match c {
            b'0'..=b'7' => {
                let digits = written.iter().skip(1);
                let code = digits.fold(0, |code, &digit| code * 8 + u32::from(digit - b'0'));
                let syntax = format!("\\x{code:02x}");
                self.report(1487, (pos, end), &[syntax.as_bytes()]);
                Self::push_code_point(text, code);
            }
            b'8' | b'9' => {
                self.report(1488, (pos, end), &[written]);
                text.push(c);
            }
            // "Hexadecimal digit expected."
            b'x' => {
                self.report(1125, (end, end), &[]);
                text.extend_from_slice(written);
            }
            b'u' => {
                self.report_invalid_unicode_escape(pos, end);
                text.extend_from_slice(written);
            }
            // `escape` decodes the others.
            _ => return pos + 1,
        }
        end
    }

    /// `scanUnicodeEscape(true)`, for the `\u` from `pos` to `end` that is not valid.
    fn report_invalid_unicode_escape(&mut self, pos: usize, end: usize) {
        let src = self.src;
        if src.get(pos + 2) != Some(&b'{') {
            return self.report(1125, (end, end), &[]);
        }
        let first = pos + 3;
        let digits = src.get(first..).unwrap_or_default();
        let digits = digits.iter().take_while(|c| c.is_ascii_hexdigit());
        let (mut after, mut value) = (first, 0u32);
        for &digit in digits {
            let digit = char::from(digit).to_digit(16).unwrap_or(0);
            value = value.saturating_mul(16).saturating_add(digit);
            after += 1;
        }
        if after == first {
            return self.report(1125, (after, after), &[]);
        }
        if value > 0x10_FFFF {
            self.report(1198, (first, after), &[]);
        }
        match src.get(after) {
            None => self.report(1126, (after, after), &[]),
            Some(b'}') => {}
            Some(_) => self.report(1199, (after, after), &[]),
        }
    }

    // ───────────────────────────── templates ─────────────────────────────

    /// A piece of a template, from the `` ` `` (`is_head`) or the `}` at `start`.
    #[inline(never)]
    fn template(&mut self, start: usize, is_head: bool) {
        self.piece_of_template(start, is_head, false);
    }

    /// `scanTemplateAndSetTokenValue`. `reports`: `shouldEmitInvalidEscapeError`.
    #[inline(always)]
    #[track_caller]
    fn piece_of_template(&mut self, start: usize, is_head: bool, reports: bool) {
        let src = self.src;
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        let mut pos = start + 1;
        let mut is_ascii = true;
        self.has_escape = false;
        let last = match is_head {
            true => T::NoSubstitutionTemplate,
            false => T::TemplateTail,
        };
        let (token, end) = loop {
            match src.get(pos) {
                None => {
                    // "Unterminated template literal." The template ends there.
                    if !self.error(Refusal::Unterminated, 1160, (pos, pos), &[]) {
                        self.buffer = text;
                        return;
                    }
                    break (last, pos);
                }
                Some(b'`') => break (last, pos + 1),
                Some(b'$') if src.get(pos + 1) == Some(&b'{') => {
                    break match is_head {
                        true => (T::TemplateHead, pos + 2),
                        false => (T::TemplateMiddle, pos + 2),
                    };
                }
                Some(b'\\') => match self.escape(pos, &mut text) {
                    Some(end) => pos = end,
                    // That is an error unless the template has a tag.
                    None => {
                        self.has_escape |= pos + 1 < src.len();
                        is_ascii = false;
                        pos = self.invalid_escape(pos, &mut text, reports);
                    }
                },
                // A line break is a line feed, however it is written.
                Some(b'\r') => {
                    text.push(b'\n');
                    pos += if src.get(pos + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                }
                Some(_) => {
                    let end = end_of_run_before(src, pos + 1, [b'`', b'$', b'\\', b'\r']);
                    let written = src.get(pos..end).unwrap_or_default();
                    is_ascii &= written.is_ascii();
                    text.extend_from_slice(written);
                    pos = end;
                }
            }
        };
        if !is_ascii && core::str::from_utf8(&src[start + 1..pos]).is_err() && !self.recovers {
            self.buffer = text;
            return self.refuse(Refusal::NotUtf8);
        }
        self.atom = (self.names).atom(Text::elsewhere(src, &text), self.atoms);
        self.buffer = text;
        self.set(token, start, end);
    }

    /// `ReScanTemplateToken`: the token is the `}` that ends a substitution.
    pub(crate) fn rescan_template_continuation(&mut self) {
        debug_assert_eq!(self.token, T::CloseBrace);
        self.template(self.start as usize, false);
    }

    /// `ReScanTemplateToken(false)`, at a piece of a template that has an invalid escape.
    #[cold]
    #[inline(never)]
    pub(crate) fn rescan_template_without_tag(&mut self) {
        if !self.recovers {
            return self.refuse(Refusal::Reported);
        }
        // TypeScript scans what follows a `}` once.
        self.forget_errors_from(self.start.saturating_add(1));
        let start = self.start as usize;
        self.piece_of_template(start, self.at(start) == b'`', true);
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
            None => self.invalid_number(start),
        }
    }

    /// Whether what cannot follow a number directly is at `pos`.
    fn is_at_start_of_name(&self, pos: usize) -> bool {
        match self.src.get(pos) {
            Some(&c @ ..0x80) => is_name_byte(c) || c == b'\\',
            Some(_) => decode(&self.src[pos..]).is_none_or(|(c, _)| is_identifier_part(c)),
            None => false,
        }
    }

    /// `010`, which is 8, or `08` and `08.5`, which are decimal.
    fn number_with_leading_zero(&mut self, start: usize) -> Option<(T, usize)> {
        let src = self.src;
        let mut end = start;
        while src.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        let is_octal = src[start..end].iter().all(|c| matches!(c, b'0'..=b'7'));
        if is_octal {
            // The message is about `-010` as a whole.
            let from = start - usize::from(self.token == T::Minus && self.end as usize == start);
            if !self.flag(1121, from, end) {
                return None;
            }
            self.number = number_from_digits(&src[start..end], 8);
        } else {
            if src.get(end) == Some(&b'.') {
                end += 1;
                if src.get(end).is_some_and(u8::is_ascii_digit) {
                    end = self.digits(end, 10)?;
                } else if src.get(end) == Some(&b'_') {
                    return None;
                }
            }
            if let Some(b'e' | b'E') = src.get(end) {
                end += 1;
                if let Some(b'+' | b'-') = src.get(end) {
                    end += 1;
                }
                end = self.digits(end, 10)?;
            }
            if !self.flag(1489, start, end) {
                return None;
            }
            let text: Vec<u8> = src[start..end]
                .iter()
                .copied()
                .filter(|&c| c != b'_')
                .collect();
            self.number = core::str::from_utf8(&text).ok()?.parse().ok()?;
        }
        if self.is_at_start_of_name(end) {
            return None;
        }
        Some((T::Number, end))
    }

    fn unusual_number(&mut self, start: usize) -> Option<(T, usize)> {
        let src = self.src;
        let radix = match (src[start], src.get(start + 1)) {
            (b'0', Some(b'x' | b'X')) => 16,
            (b'0', Some(b'o' | b'O')) => 8,
            (b'0', Some(b'b' | b'B')) => 2,
            (b'0', Some(b'_')) => return None,
            (b'0', Some(b'0'..=b'9')) => return self.number_with_leading_zero(start),
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
            self.atom = (self.names).atom(Text::elsewhere(self.src, &decimal), self.atoms);
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
        if self.is_at_start_of_name(end) {
            return None;
        }
        Some((token, end))
    }

    /// `scanNumberFragment`, `scanHexDigits`, `scanBinaryOrOctalDigits`. Returns the end.
    fn digits_and_separators(&mut self, mut pos: usize, radix: u32, digits: &mut Vec<u8>) -> usize {
        let (mut allows_separator, mut is_after_separator) = (false, false);
        while let Some(&c) = self.src.get(pos) {
            if char::from(c).is_digit(radix) {
                digits.push(c);
                allows_separator = true;
                is_after_separator = false;
            } else if c != b'_' {
                break;
            } else if allows_separator {
                allows_separator = false;
                is_after_separator = true;
            } else if is_after_separator {
                self.report(6189, (pos, pos + 1), &[]);
            } else {
                self.report(6188, (pos, pos + 1), &[]);
            }
            pos += 1;
        }
        if is_after_separator {
            self.report(6188, (pos - 1, pos), &[]);
        }
        pos
    }

    /// `scanIdentifierParts`: the end of what goes on a name at `pos`.
    fn end_of_identifier_parts(&self, mut pos: usize) -> usize {
        loop {
            let part = match self.src.get(pos) {
                Some(b'\\') => self.unicode_escape(pos + 1).map(|(c, end)| (c, end - pos)),
                _ => decode(self.src.get(pos..).unwrap_or_default()),
            };
            match part {
                Some((c, len)) if is_identifier_part(c) => pos += len,
                _ => return pos,
            }
        }
    }

    /// `scanNumber`, and the `0x`, `0b` and `0o` of `Scan`, for what `unusual_number` refuses.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn invalid_number(&mut self, start: usize) {
        if !self.recovers {
            return self.refuse(Refusal::UnusualNumber);
        }
        let mut digits = std::mem::take(&mut self.buffer);
        digits.clear();
        let (token, end) = self.number_with_errors(start, &mut digits);
        self.buffer = digits;
        self.set(token, start, end);
    }

    /// The token and its end. `digits`: empty, to work in.
    fn number_with_errors(&mut self, start: usize, digits: &mut Vec<u8>) -> (T, usize) {
        let src = self.src;
        let radix = match (self.at(start), self.at(start + 1)) {
            (b'0', b'x' | b'X') => 16,
            (b'0', b'b' | b'B') => 2,
            (b'0', b'o' | b'O') => 8,
            _ => 10,
        };
        if radix != 10 {
            let end = self.digits_and_separators(start + 2, radix, digits);
            if digits.is_empty() {
                let code = match radix {
                    16 => 1125,
                    2 => 1177,
                    _ => 1178,
                };
                self.report(code, (end, end), &[]);
                digits.push(b'0');
            }
            // `scanBigIntSuffix`. Whatever follows is the next token.
            if self.at(end) == b'n' {
                let decimal = decimal_digits(digits, radix);
                self.atom = (self.names).atom(Text::elsewhere(src, &decimal), self.atoms);
                return (T::BigInt, end + 1);
            }
            self.number = number_from_digits(digits, radix);
            return (T::Number, end);
        }
        let mut end;
        let mut has_leading_zero = false;
        if self.at(start) == b'0' && self.at(start + 1) == b'_' {
            self.report(6188, (start + 1, start + 2), &[]);
            end = self.digits_and_separators(start, 10, digits);
        } else if self.at(start) == b'0' && self.at(start + 1).is_ascii_digit() {
            // `scanDigits`
            end = start + 1;
            while self.at(end).is_ascii_digit() {
                end += 1;
            }
            let rest = src.get(start + 1..end).unwrap_or_default();
            if rest.iter().all(|c| matches!(c, b'0'..=b'7')) {
                // `strconv.ParseInt(digits, 8, 64)`
                let value = rest.iter().fold(0i64, |value, &c| {
                    value.saturating_mul(8).saturating_add(i64::from(c - b'0'))
                });
                self.number = value as f64;
                // After a `-`, whatever is between them, the error starts one byte earlier.
                let (sign, from) = match self.token == T::Minus {
                    true => ("-", start.saturating_sub(1)),
                    false => ("", start),
                };
                let syntax = format!("{sign}0o{value:o}");
                self.report(1121, (from, end), &[syntax.as_bytes()]);
                return (T::Number, end);
            }
            has_leading_zero = true;
            digits.extend_from_slice(rest);
        } else {
            end = self.digits_and_separators(start, 10, digits);
        }
        let end_of_fixed_part = end;
        if self.at(end) == b'.' {
            digits.push(b'.');
            end = self.digits_and_separators(end + 1, 10, digits);
        }
        let is_scientific = matches!(self.at(end), b'e' | b'E');
        if is_scientific {
            let mantissa = digits.len();
            digits.push(b'e');
            end += 1;
            if let sign @ (b'+' | b'-') = self.at(end) {
                digits.push(sign);
                end += 1;
            }
            let preamble = digits.len();
            end = self.digits_and_separators(end, 10, digits);
            if digits.len() == preamble {
                // "Digit expected."
                self.report(1124, (end, end), &[]);
                digits.truncate(mantissa);
            }
        }
        self.number = core::str::from_utf8(digits)
            .ok()
            .and_then(|text| text.parse().ok())
            .unwrap_or(f64::NAN);
        if has_leading_zero {
            // Neither an `n` nor what follows is looked at.
            self.report(1489, (start, end), &[]);
            return (T::Number, end);
        }
        let mut token = T::Number;
        if end_of_fixed_part == end && self.at(end) == b'n' {
            // `scanBigIntSuffix`, `ParsePseudoBigInt`
            let zeros = digits.iter().take_while(|&&c| c == b'0').count();
            let zeros = zeros.min(digits.len().saturating_sub(1));
            let decimal = digits.get(zeros..).unwrap_or_default();
            self.atom = (self.names).atom(Text::elsewhere(src, decimal), self.atoms);
            token = T::BigInt;
            end += 1;
        }
        let follows = decode(src.get(end..).unwrap_or_default());
        let is_before_name = follows.is_some_and(|(c, _)| is_identifier_start(c));
        if !is_before_name {
            return (token, end);
        }
        let end_of_name = self.end_of_identifier_parts(end);
        if token != T::BigInt && src.get(end..end_of_name) == Some(&b"n"[..]) {
            // The `n` is part of the token.
            if is_scientific {
                self.report(1352, (start, end_of_name), &[]);
                return (token, end_of_name);
            }
            if end_of_fixed_part < end {
                self.report(1353, (start, end_of_name), &[]);
                return (token, end_of_name);
            }
        }
        // The name is the next token.
        self.report(1351, (end, end_of_name), &[]);
        (token, end)
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
                None | Some(b'\n' | b'\r') => return self.unterminated_regex(pos),
                Some(b'/') if !is_in_class => break,
                Some(b'[') => is_in_class = true,
                Some(b']') => is_in_class = false,
                Some(b'\\') => {
                    if matches!(src.get(pos + 1), None | Some(b'\n' | b'\r')) {
                        return self.unterminated_regex(pos + 1);
                    }
                    // What follows is looked at as if it stood alone, unless it is one byte.
                    if src.get(pos + 1).is_some_and(u8::is_ascii) {
                        pos += 1;
                    }
                }
                // The scanner of TypeScript 7 reads bytes here: only "\n" and "\r" end a line.
                Some(0xE2)
                    if self.is_typescript_5
                        && matches!(src.get(pos..pos + 3), Some([_, 0x80, 0xA8 | 0xA9])) =>
                {
                    return self.unterminated_regex(pos);
                }
                _ => {}
            }
            pos += 1;
        }
        pos += 1;
        // The flags: whatever can be part of a name.
        loop {
            match src.get(pos) {
                Some(&c) if is_name_byte(c) => pos += 1,
                Some(0x80..) => match decode(&src[pos..]) {
                    Some((c, len)) if is_identifier_part(c) => pos += len,
                    Some(_) => break,
                    None if self.recovers => break,
                    None => return self.refuse(Refusal::NotUtf8),
                },
                _ => break,
            }
        }
        if core::str::from_utf8(&src[start..pos]).is_err() && !self.recovers {
            return self.refuse(Refusal::NotUtf8);
        }
        self.set(T::Regex, start, pos);
    }

    /// `ReScanSlashToken`, for a regular expression whose line ends at `end_of_line`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn unterminated_regex(&mut self, end_of_line: usize) {
        if !self.recovers {
            return self.refuse(Refusal::Unterminated);
        }
        let src = self.src;
        let start = self.start as usize;
        // "Search for the nearest unbalanced bracket for better recovery."
        let (mut is_in_escape, mut is_in_quantifier) = (false, false);
        let (mut classes, mut groups) = (0usize, 0usize);
        let mut end = start + 1;
        for &c in src.get(end..end_of_line).unwrap_or_default() {
            match c {
                _ if is_in_escape => is_in_escape = false,
                b'\\' => is_in_escape = true,
                b'[' => classes += 1,
                b']' if classes != 0 => classes -= 1,
                _ if classes != 0 => {}
                b'{' => is_in_quantifier = true,
                b'}' if is_in_quantifier => is_in_quantifier = false,
                _ if is_in_quantifier => {}
                b'(' => groups += 1,
                b')' if groups != 0 => groups -= 1,
                b')' | b']' | b'}' => break,
                _ => {}
            }
            end += 1;
        }
        // "Whitespaces and semicolons at the end are not likely to be part of the regex"
        while end > start + 1 {
            match decode_last(src.get(..end).unwrap_or_default()) {
                Some((c, len)) if is_white_space_like(c) || c == u32::from(b';') => end -= len,
                _ => break,
            }
        }
        self.report(1161, (start, end), &[]);
        self.set(T::Regex, start, end);
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
            let text = Text::of_source(src, self.start as usize, end);
            self.atom = self.names.atom(text, self.atoms);
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
            false if self.recovers => return,
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
                // There it is a string of JavaScript, and refused as one.
                if pos > before && self.scans_jsx_strings_as_typescript_5() {
                    return self.refuse(Refusal::Unterminated);
                }
                pos
            }
        };
        // What looked like an escape is none.
        self.forget_flagged_from(start as u32);
        if !self.errors.is_empty() && self.is_string_of_javascript(before, start) {
            return;
        }
        let quote = src[start];
        let Some(len) = bun_core::strings::index_of_char_usize(&src[start + 1..], quote) else {
            return self.unterminated_jsx_string(before, start);
        };
        let text = &src[start + 1..start + 1 + len];
        if core::str::from_utf8(text).is_err() && !self.recovers {
            return self.refuse(Refusal::NotUtf8);
        }
        if start != before
            && bun_core::strings::contains_char(text, b'\\')
            && self.is_string_with_escapes(before, start)
        {
            return;
        }
        let text = Text::of_source(src, start + 1, start + 1 + len);
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::String, start, start + len + 2);
    }

    /// Whether the string at `start`, which has a backslash, stays as `next` has scanned it.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn is_string_with_escapes(&mut self, before: usize, start: usize) -> bool {
        if !self.recovers {
            self.refuse(Refusal::Unsupported);
            return true;
        }
        self.is_string_of_javascript(before, start)
    }

    /// For `scanJsxAttributeValue` of TypeScript 5 and 6, on which typescript-estree runs, blanks before the quote are
    /// enough to leave the string to `scan`. Babel and acorn-jsx read it as TypeScript 7 does.
    fn scans_jsx_strings_as_typescript_5(&self) -> bool {
        self.is_typescript_5 && !self.is_ecmascript && !self.is_babel
    }

    /// `ScanJsxAttributeValue`: whether `Scan` scans the string at `start`, after a comment.
    #[cold]
    #[inline(never)]
    fn is_string_of_javascript(&mut self, before: usize, start: usize) -> bool {
        let mut pos = before;
        while let Some((c, len)) = decode(self.src.get(pos..start).unwrap_or_default())
            && is_white_space_like(c)
        {
            pos += len;
        }
        if pos < start || before < start && self.scans_jsx_strings_as_typescript_5() {
            return true;
        }
        self.forget_errors_from(before as u32);
        false
    }

    /// `scanString(true)`, for the string at `start` that goes to the end of the text.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn unterminated_jsx_string(&mut self, before: usize, start: usize) {
        let src = self.src;
        let end = src.len();
        if !self.error(Refusal::Unterminated, 1002, (end, end), &[]) {
            return;
        }
        // It is of the scan that began at `before`, and a mark at the string is after that.
        if let Some(origin) = self.origins.last_mut() {
            *origin = before as u32;
        }
        let text = Text::of_source(src, start + 1, end);
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::String, start, end);
    }

    /// `ScanJsxToken`: scans a child of an element, from the end of the token. Text that is nothing
    /// but blanks and has a line break is no child.
    pub(crate) fn next_jsx_child(&mut self) {
        let src = self.src;
        self.full_start = self.end;
        let mut newline_before = false;
        let mut start = self.end as usize;
        loop {
            match src.get(start) {
                None => {
                    self.newline_before = newline_before;
                    return self.set(T::Eof, src.len(), src.len());
                }
                Some(b'{') => {
                    self.newline_before = newline_before;
                    return self.set(T::OpenBrace, start, start + 1);
                }
                Some(b'<') if src.get(start + 1) == Some(&b'/') && !self.is_ecmascript => {
                    self.newline_before = newline_before;
                    return self.set(T::LessThanSlash, start, start + 2);
                }
                Some(b'<') => {
                    self.newline_before = newline_before;
                    return self.set(T::LessThan, start, start + 1);
                }
                Some(_) => {}
            }
            let rest = &src[start..];
            let len = bun_core::strings::index_of_any(rest, b"{<").unwrap_or(rest.len());
            let text = &rest[..len];
            // Each is an error, and stays text.
            if bun_core::strings::index_of_any(text, b">}").is_some()
                && !self.closers_in_jsx_text(start, text)
            {
                return;
            }
            if rest.get(len..len + 2) == Some(b"<<") && self.conflict_marker_in_jsx(start + len) {
                return;
            }
            self.newline_before = newline_before;
            let Ok(valid) = core::str::from_utf8(text) else {
                return self.jsx_text_of_bytes(start, text);
            };
            let needs_fixing = text
                .iter()
                .any(|&c| matches!(c, b'&' | b'\n' | b'\r' | 0x80..));
            if !needs_fixing {
                let text = Text::of_source(src, start, start + len);
                self.atom = self.names.atom(text, self.atoms);
                return self.set(T::JsxText, start, start + len);
            }
            let fixed = fix_whitespace_and_decode_jsx_entities(valid);
            if fixed.is_empty() {
                newline_before = true;
                start += len;
                continue;
            }
            self.atom = (self.names).atom(Text::elsewhere(src, &fixed), self.atoms);
            return self.set(T::JsxText, start, start + len);
        }
    }

    /// `ScanJsxTokenEx`: reports each `>` and `}` of `text`. Returns whether the scanner goes on.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn closers_in_jsx_text(&mut self, start: usize, text: &[u8]) -> bool {
        if !self.recovers {
            self.refuse(Refusal::Reported);
            return false;
        }
        for (at, &c) in text.iter().enumerate() {
            let code = match c {
                b'>' => 1382,
                b'}' => 1381,
                _ => continue,
            };
            self.report(code, (start + at, start + at + 1), &[]);
        }
        true
    }

    /// `ScanJsxTokenEx`: whether a conflict marker ends JSX text at `pos`. They are one token.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn conflict_marker_in_jsx(&mut self, pos: usize) -> bool {
        if !self.is_conflict_marker(pos) {
            return false;
        }
        if !self.recovers {
            self.refuse(Refusal::ConflictMarker);
            return true;
        }
        let end = self.conflict_marker(pos);
        // `newline_before` stays that of the token before, as `tokenFlags` does.
        self.set(T::ConflictMarker, self.full_start as usize, end);
        true
    }

    /// The JSX text `text` at `start`, which is not UTF-8.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn jsx_text_of_bytes(&mut self, start: usize, text: &[u8]) {
        if !self.recovers {
            return self.refuse(Refusal::NotUtf8);
        }
        let read = with_replacement_characters(text);
        let fixed = fix_whitespace_and_decode_jsx_entities(&read);
        self.atom = (self.names).atom(Text::elsewhere(self.src, &fixed), self.atoms);
        self.set(T::JsxText, start, start + text.len());
    }
}

/// `text` as Go reads it: each byte that is not UTF-8 is U+FFFD.
fn with_replacement_characters(mut text: &[u8]) -> String {
    let mut read = String::new();
    while !text.is_empty() {
        let (c, len) = decode(text).unwrap_or((0xFFFD, 1));
        read.push(char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER));
        text = text.get(len..).unwrap_or_default();
    }
    read
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
fn parse_entity_number(digits: &str, radix: u8) -> Option<u32> {
    let number = bun_core::parse_int::<i32>(digits.as_bytes(), radix).ok()?;
    u32::try_from(number).ok().filter(|&c| c <= 0x10_FFFF)
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
