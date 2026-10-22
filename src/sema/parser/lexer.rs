//! The scanner. It works on bytes and dispatches once on a token's first byte. A highway kernel makes one pass over the
//! text up front and finds where names, indentation and the plain parts of strings end ([`ScannerStops`]). Anything
//! that isn't ASCII takes a slow path.
//!
//! It rejects text it can't scan ([`Lexer::reject`]). From then on every token is the end of the file, so the parser
//! unwinds without having to check for failure. With `Options::recovers` it reports an error and continues like
//! TypeScript's scanner ([`Lexer::error`]), where that's implemented.

use crate::Rejection;
use crate::names::{Names, Text};
use crate::token::T;
use bun_core::lexer::{
    is_identifier_part, is_identifier_start, is_white_space_like, is_white_space_single_line,
};
use bun_core::strings::{self, is_js_line_terminator, push_codepoint_wtf8_joined};
use bun_highway::ScannerStops;
use bun_sema::atom::{Atom, Intern};
use bun_sema::hir::{
    Comment, CommentDirective, CommentDirectiveKind, Diagnostic, DiagnosticKind, NodeOrName,
};

pub(crate) struct Lexer<'a> {
    pub(crate) src: &'a [u8],
    /// Computed for the whole text, even while `src` is cut short.
    stops: ScannerStops<'a>,
    pub(crate) token: T,
    /// A line break precedes the token.
    pub(crate) newline_before: bool,
    /// The name or keyword has a Unicode escape, or the template piece has an invalid escape.
    pub(crate) has_escape: bool,
    /// The start of the token.
    pub(crate) start: u32,
    /// The end of the token.
    pub(crate) end: u32,
    /// The end of the previous token: `node.Pos()` of a node that starts with the token.
    pub(crate) full_start: u32,
    /// The text of a name, keyword or bigint, or the value of a string or template piece.
    pub(crate) atom: Atom,
    pub(crate) number: f64,
    /// The start of the last string whose contents are only printable ASCII, with no backslash.
    plain_string: u32,
    pub(crate) rejection: Option<Rejection>,
    /// Where the text was rejected, and by which line of this crate.
    pub(crate) rejected_at: (u32, &'static core::panic::Location<'static>),
    /// `full_start` at that point.
    pub(crate) rejected_after: u32,
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
    /// `Dialect::oxc`
    pub(crate) is_oxc: bool,
    /// Records `<!--` positions in `html_opens`. The caller may reparse a text that has one as a script.
    pub(crate) records_html_opens: bool,
    /// Only filled in if `records_html_opens` is set.
    pub(crate) html_opens: HtmlOpens,
    /// Every scanned private name that wasn't declared by a class that has ended since, for
    /// `hir::rare::ODD_PRIVATE_NAME`. `Atom::NONE` marks one after `super.`.
    pub(crate) private_names: Vec<Atom>,
    pub(crate) atoms: &'a dyn Intern,
    pub(crate) names: &'a mut Names,
    /// `hir::File::comment_directives`
    pub(crate) comment_directives: Vec<CommentDirective>,
    /// The comments before the first token.
    pub(crate) leading_comments: Vec<(u32, u32)>,
    /// `hir::File::comments`
    pub(crate) comments: Vec<Comment>,
    /// While scanning the comments between two tokens: true if a line break was seen since the last comment, or since
    /// the previous token if there was no comment yet.
    newline_since_comment: bool,
    /// `Options::attach_comments`
    pub(crate) attach_comments: bool,
    /// See `Parser::finish_node`. A node that starts after this offset can't affect any pending comment.
    pub(crate) max_relevant_node_start: u32,
    /// Errors that TypeScript's scanner reports about syntax ECMAScript allows outside strict mode: the message code,
    /// start and end. Only filled in with `is_ecmascript`. Otherwise the text is rejected.
    pub(crate) flagged: Vec<(u32, u32, u32)>,
    /// `Options::recovers`
    pub(crate) recovers: bool,
    /// The errors that [`Lexer::error`] reported and the parser hasn't taken yet (`Parser::take_scanner_errors`), in
    /// the order they were reported.
    pub(crate) errors: Vec<Diagnostic>,
    /// `skipJSDocLeadingAsterisks`: the lexer is inside a type in a JSDoc comment.
    pub(crate) skips_jsdoc_asterisks: bool,
    /// `hir::File::jsdoc_asterisks`, in scan order: unsorted, and possibly with duplicates.
    pub(crate) jsdoc_asterisks: Vec<u32>,
    /// For each of `errors`, where the scan that reported it began. See [`Lexer::error`].
    origins: Vec<u32>,
    /// Scratch space for decoding values that have escapes.
    buffer: Vec<u8>,
    pub(crate) stack_check: bun_core::StackCheck,
}

/// Outside a script: the position of the first `<!--` that was scanned as `<`, and of the first one preceded only by
/// whitespace and comments on its line. For oxc, the former starts a comment unless the file's name makes it a module,
/// and the latter is an error in such a module.
#[derive(Copy, Clone, Default)]
pub(crate) struct HtmlOpens {
    pub(crate) first: Option<u32>,
    pub(crate) first_on_its_line: Option<u32>,
}

/// The state a lookahead restores.
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

#[derive(Copy, Clone, PartialEq, Eq)]
enum CommentForm {
    /// `// comment`, `<!-- comment` or `--> comment`
    Line,
    /// `/* comment */` on one line
    Block,
    MultilineBlock,
}

/// The class of a token's first byte, or of a byte between tokens.
#[derive(Copy, Clone)]
enum First {
    Blank,
    LineFeed,
    CarriageReturn,
    Name,
    OpenParen,
    CloseParen,
    OpenBrace,
    CloseBrace,
    OpenBracket,
    CloseBracket,
    Semicolon,
    Comma,
    Colon,
    Tilde,
    At,
    Dot,
    Equals,
    Quote,
    Slash,
    Digit,
    Exclamation,
    Question,
    LessThan,
    GreaterThan,
    Plus,
    Minus,
    Asterisk,
    Percent,
    Ampersand,
    Bar,
    Caret,
    Backtick,
    Hash,
    Backslash,
    NotAscii,
    Invalid,
}

/// Indexed by byte.
static FIRST: [First; 256] = {
    let mut table = [First::Invalid; 256];
    let mut byte = 0u8;
    loop {
        table[byte as usize] = match byte {
            b' ' | b'\t' | 0x0B | 0x0C => First::Blank,
            b'\n' => First::LineFeed,
            b'\r' => First::CarriageReturn,
            b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' => First::Name,
            b'(' => First::OpenParen,
            b')' => First::CloseParen,
            b'{' => First::OpenBrace,
            b'}' => First::CloseBrace,
            b'[' => First::OpenBracket,
            b']' => First::CloseBracket,
            b';' => First::Semicolon,
            b',' => First::Comma,
            b':' => First::Colon,
            b'~' => First::Tilde,
            b'@' => First::At,
            b'.' => First::Dot,
            b'=' => First::Equals,
            b'\'' | b'"' => First::Quote,
            b'/' => First::Slash,
            b'0'..=b'9' => First::Digit,
            b'!' => First::Exclamation,
            b'?' => First::Question,
            b'<' => First::LessThan,
            b'>' => First::GreaterThan,
            b'+' => First::Plus,
            b'-' => First::Minus,
            b'*' => First::Asterisk,
            b'%' => First::Percent,
            b'&' => First::Ampersand,
            b'|' => First::Bar,
            b'^' => First::Caret,
            b'`' => First::Backtick,
            b'#' => First::Hash,
            b'\\' => First::Backslash,
            0x80.. => First::NotAscii,
            _ => First::Invalid,
        };
        if byte == u8::MAX {
            break table;
        }
        byte += 1;
    }
};

#[inline(always)]
const fn is_name_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'$'
}

/// Returns the code point at the start of `text` and its length in bytes, or `None` if it isn't valid UTF-8.
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

/// `DecodeLastRuneInString`: returns the code point at the end of `text` and its length in bytes.
fn decode_last(text: &[u8]) -> Option<(u32, usize)> {
    (1..=4).find_map(|len| {
        let last = text.get(text.len().checked_sub(len)?..)?;
        decode(last).filter(|decoded| decoded.1 == len)
    })
}

/// Validates a text that can be long.
fn is_utf8(text: &[u8]) -> bool {
    let is_valid = bun_core::strings::is_valid_utf8(text);
    debug_assert_eq!(is_valid, core::str::from_utf8(text).is_ok());
    is_valid
}

impl<'a> Lexer<'a> {
    pub(crate) fn new(
        src: &'a [u8],
        stops: ScannerStops<'a>,
        atoms: &'a dyn Intern,
        names: &'a mut Names,
    ) -> Self {
        Lexer {
            src,
            stops,
            token: T::Eof,
            newline_before: false,
            has_escape: false,
            start: 0,
            end: 0,
            full_start: 0,
            atom: Atom::NONE,
            number: 0.0,
            plain_string: u32::MAX,
            rejection: None,
            rejected_at: (0, core::panic::Location::caller()),
            rejected_after: 0,
            is_jsx: false,
            is_ecmascript: false,
            is_script: false,
            is_typescript_5: false,
            is_babel: false,
            is_oxc: false,
            records_html_opens: false,
            html_opens: HtmlOpens::default(),
            private_names: Vec::new(),
            atoms,
            names,
            comment_directives: Vec::new(),
            leading_comments: Vec::new(),
            comments: Vec::new(),
            newline_since_comment: false,
            attach_comments: false,
            max_relevant_node_start: 0,
            flagged: Vec::new(),
            recovers: false,
            errors: Vec::new(),
            skips_jsdoc_asterisks: false,
            jsdoc_asterisks: Vec::new(),
            origins: Vec::new(),
            buffer: Vec::new(),
            // Use at most the stack size of a thread in Bun's pool. On a larger stack, the rest is left for the code
            // that walks the tree.
            stack_check: bun_core::StackCheck::init()
                .with_at_most(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize),
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
        if self
            .comments
            .last()
            .is_some_and(|last| last.pos >= mark.end)
        {
            self.discard_comments_from(mark.end);
        }
        if self.flagged.last().is_some_and(|last| last.1 >= mark.end) {
            self.discard_flagged_from(mark.end);
        }
        if !self.errors.is_empty() {
            self.discard_errors_from(mark.start.saturating_add(1));
        }
    }

    /// Drops the errors from scans that began at `pos` or later, because those scans will run again.
    #[cold]
    #[inline(never)]
    fn discard_errors_from(&mut self, pos: u32) {
        let keep_len = self.origins.partition_point(|&origin| origin < pos);
        self.errors.truncate(keep_len);
        self.origins.truncate(keep_len);
    }

    /// `s.errorAt(message, pos, length)`: reports message `code` with `args`, from `start` to `end`. Returns true if
    /// the scanner continues. Without recovery it rejects the text for `why` and returns false, and the caller has to
    /// return.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn error(
        &mut self,
        why: Rejection,
        code: u32,
        (start, end): (usize, usize),
        args: &[&[u8]],
    ) -> bool {
        if !self.recovers {
            self.reject(why);
            return false;
        }
        let at = match start == end {
            true => (start as u32, Diagnostic::NO_LENGTH),
            false => (start as u32, end as u32),
        };
        // A scan begins at the end of the previous token. A rescan of the current token begins just after its start.
        let origin = match self.full_start == self.end {
            true => self.full_start,
            false => self.start.saturating_add(1),
        };
        // The parser has already taken the other errors.
        self.origins.truncate(self.errors.len());
        self.origins.push(origin);
        self.errors
            .push(Diagnostic::new(DiagnosticKind::Parse, at, code, args));
        true
    }

    /// Takes the reported errors. "Keywords cannot contain escape characters." about the current token stays behind,
    /// because `nextToken` only reports it when it moves past the token.
    #[cold]
    #[inline(never)]
    pub(crate) fn take_errors(&mut self) -> Vec<Diagnostic> {
        let mut drained = std::mem::take(&mut self.errors);
        let is_pending =
            (drained.last()).is_some_and(|it| it.code == 1260 && it.start == self.start);
        if is_pending && let Some(pending) = drained.pop() {
            let origin = self
                .origins
                .get(drained.len())
                .copied()
                .unwrap_or(self.full_start);
            self.origins.clear();
            self.origins.push(origin);
            self.errors.push(pending);
        }
        drained
    }

    /// `nextTokenWithoutCheck`: the token is used as a name, so that error about it is dropped. Returns true if the
    /// error was still here.
    #[cold]
    #[inline(never)]
    pub(crate) fn discard_escaped_keyword_error(&mut self) -> bool {
        let is_pending =
            (self.errors.last()).is_some_and(|it| it.code == 1260 && it.start == self.start);
        if is_pending {
            self.errors.pop();
        }
        is_pending
    }

    /// [`Lexer::error`], for code that only runs with recovery.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn report(&mut self, code: u32, at: (usize, usize), args: &[&[u8]]) {
        self.error(Rejection::Unsupported, code, at, args);
    }

    #[cold]
    #[inline(never)]
    fn discard_flagged_from(&mut self, pos: u32) {
        let keep_len = self.flagged.partition_point(|it| it.1 < pos);
        self.flagged.truncate(keep_len);
    }

    /// Adds an entry to `flagged`. Returns false if the caller has to reject the text instead.
    #[cold]
    fn flag(&mut self, code: u32, start: usize, end: usize) -> bool {
        if self.is_ecmascript {
            self.flagged.push((code, start as u32, end as u32));
        }
        self.is_ecmascript
    }

    /// Drops the comments from `pos` on. That text is scanned again, possibly as something else.
    #[cold]
    #[inline(never)]
    fn discard_comments_from(&mut self, pos: u32) {
        let keep_len = self.comments.partition_point(|comment| comment.pos < pos);
        self.comments.truncate(keep_len);
    }

    /// Returns the text of `atom`, which came from a token of this file. Empty for `Atom::NONE`.
    pub(crate) fn text_of(&self, atom: Atom) -> &[u8] {
        match self.names.is_own() {
            true => self.names.bytes(atom, self.src),
            false if atom.is_none() => b"",
            false => self.atoms.bytes(atom),
        }
    }

    /// Gives up on the file, or on the speculative parse in progress.
    #[cold]
    #[inline(never)]
    #[track_caller]
    pub(crate) fn reject(&mut self, why: Rejection) {
        if self.rejection.is_none() {
            self.rejection = Some(why);
            self.rejected_at = (self.start, core::panic::Location::caller());
            self.rejected_after = self.full_start;
        }
        self.token = T::Eof;
        self.start = self.src.len() as u32;
        self.end = self.start;
    }

    /// Stops reading the text.
    pub(crate) fn stop(&mut self) {
        self.token = T::Eof;
    }

    /// Makes the scan for the first token start at `pos`.
    pub(crate) fn start_at(&mut self, pos: u32) {
        self.end = pos;
    }

    /// From now on the text ends where `src` ends: before a comment's `*/`, or at the end of the file.
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

    /// Returns the first byte of the next token if it follows the current token directly or after one space. Returns 0
    /// if more than that separates them, or if the byte doesn't determine the token.
    #[inline]
    pub(crate) fn first_byte_of_next(&self) -> u8 {
        let rest = self.src.get(self.end as usize..).unwrap_or_default();
        match *rest {
            // `<!--` starts a comment.
            _ if self.is_script => 0,
            [b' ', b'/' | b'\\', ..] | [b'/' | b'\\', ..] => 0,
            [b' ', first @ b'!'..=b'~', ..] | [first @ b'!'..=b'~', ..] => first,
            _ => 0,
        }
    }

    /// At a `const`: true if the next bytes rule out a following `enum` without a scan. False means one may follow.
    #[inline]
    pub(crate) fn is_const_before_binding(&self) -> bool {
        let Some([b' ', first, ..]) = self.src.get(self.end as usize..) else {
            return false;
        };
        matches!(first, b'a'..=b'd' | b'f'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'{' | b'[')
    }

    #[inline(always)]
    fn set(&mut self, token: T, start: usize, end: usize) {
        self.token = token;
        self.start = start as u32;
        self.end = end as u32;
    }

    #[inline(always)]
    fn at(&self, pos: usize) -> u8 {
        // No token contains a zero byte outside a string or a comment, so 0 can represent the end.
        self.src.get(pos).copied().unwrap_or(0)
    }

    /// Scans the next token.
    #[inline(always)]
    pub(crate) fn next(&mut self) {
        self.full_start = self.end;
        self.newline_before = false;
        self.scan(self.end as usize);
    }

    /// Scans the token at `pos`, or after the whitespace and comments there. Every call it makes is a tail call, so it
    /// doesn't have to save any registers.
    fn scan(&mut self, mut pos: usize) {
        let src = self.src;
        let at = |pos: usize| src.get(pos).copied().unwrap_or(0);
        loop {
            let Some(&byte) = src.get(pos) else {
                return self.set(T::Eof, src.len(), src.len());
            };
            let next = pos + 1;
            match FIRST[usize::from(byte)] {
                First::Blank => {
                    pos = next;
                    continue;
                }
                First::LineFeed => return self.scan_after_line_feed(next),
                First::CarriageReturn => {
                    self.newline_before = true;
                    pos = next;
                    continue;
                }
                First::Name => return self.name(pos),
                First::OpenParen => self.set(T::OpenParen, pos, next),
                First::CloseParen => self.set(T::CloseParen, pos, next),
                First::OpenBrace => self.set(T::OpenBrace, pos, next),
                First::CloseBrace => self.set(T::CloseBrace, pos, next),
                First::OpenBracket => self.set(T::OpenBracket, pos, next),
                First::CloseBracket => self.set(T::CloseBracket, pos, next),
                First::Semicolon => self.set(T::Semicolon, pos, next),
                First::Comma => self.set(T::Comma, pos, next),
                First::Colon => self.set(T::Colon, pos, next),
                First::Tilde => self.set(T::Tilde, pos, next),
                First::At => self.set(T::At, pos, next),
                First::Dot => match at(next) {
                    b'0'..=b'9' => return self.number(pos),
                    b'.' if at(next + 1) == b'.' => self.set(T::DotDotDot, pos, pos + 3),
                    _ => self.set(T::Dot, pos, next),
                },
                First::Equals => match at(next) {
                    b'=' if at(next + 1) != b'=' => self.set(T::EqualsEquals, pos, pos + 2),
                    b'=' if at(pos + 3) == b'=' => {
                        return self.scan_at_possible_conflict_marker(pos);
                    }
                    b'=' => self.set(T::EqualsEqualsEquals, pos, pos + 3),
                    b'>' => self.set(T::EqualsGreaterThan, pos, pos + 2),
                    _ => self.set(T::Equals, pos, next),
                },
                First::Quote => return self.string(pos, byte),
                First::Slash => match at(next) {
                    b'/' | b'*' => return self.scan_after_comments(pos),
                    b'=' => self.set(T::SlashEquals, pos, pos + 2),
                    _ => self.set(T::Slash, pos, next),
                },
                First::Digit => return self.number(pos),
                First::Exclamation => match (at(next), at(next + 1)) {
                    (b'=', b'=') => self.set(T::ExclamationEqualsEquals, pos, pos + 3),
                    (b'=', _) => self.set(T::ExclamationEquals, pos, pos + 2),
                    _ => self.set(T::Exclamation, pos, next),
                },
                First::Question => match (at(next), at(next + 1)) {
                    (b'.', after) if !after.is_ascii_digit() => {
                        self.set(T::QuestionDot, pos, pos + 2);
                    }
                    (b'?', b'=') => self.set(T::QuestionQuestionEquals, pos, pos + 3),
                    (b'?', _) => self.set(T::QuestionQuestion, pos, pos + 2),
                    _ => self.set(T::Question, pos, next),
                },
                First::LessThan => match (at(next), at(next + 1)) {
                    (b'<', b'<') if at(pos + 3) == b'<' => {
                        return self.scan_at_possible_conflict_marker(pos);
                    }
                    (b'<', b'=') => self.set(T::LessThanLessThanEquals, pos, pos + 3),
                    (b'<', _) => self.set(T::LessThanLessThan, pos, pos + 2),
                    (b'=', _) => self.set(T::LessThanEquals, pos, pos + 2),
                    (b'/', after) if self.is_jsx && !self.is_ecmascript && after != b'*' => {
                        self.set(T::LessThanSlash, pos, pos + 2);
                    }
                    (b'!', b'-')
                        if (self.is_script || self.records_html_opens) && at(pos + 3) == b'-' =>
                    {
                        return self.scan_at_html_open(pos);
                    }
                    _ => self.set(T::LessThan, pos, next),
                },
                // The parser rescans for `>=`, `>>` and so on where they're allowed.
                First::GreaterThan => {
                    if at(next) == b'>' && src.get(pos..pos + 4) == Some(b">>>>") {
                        return self.scan_at_possible_conflict_marker(pos);
                    }
                    self.set(T::GreaterThan, pos, next);
                }
                First::Plus => match at(next) {
                    b'+' => self.set(T::PlusPlus, pos, pos + 2),
                    b'=' => self.set(T::PlusEquals, pos, pos + 2),
                    _ => self.set(T::Plus, pos, next),
                },
                First::Minus => match (at(next), at(next + 1)) {
                    // Only whitespace and comments precede it on its line.
                    (b'-', b'>')
                        if self.is_script && (self.newline_before || self.full_start == 0) =>
                    {
                        return self.scan_after_comments(pos);
                    }
                    (b'-', _) => self.set(T::MinusMinus, pos, pos + 2),
                    (b'=', _) => self.set(T::MinusEquals, pos, pos + 2),
                    _ => self.set(T::Minus, pos, next),
                },
                First::Asterisk => match (at(next), at(next + 1)) {
                    (b'*', b'=') => self.set(T::AsteriskAsteriskEquals, pos, pos + 3),
                    (b'*', _) => self.set(T::AsteriskAsterisk, pos, pos + 2),
                    (b'=', _) => self.set(T::AsteriskEquals, pos, pos + 2),
                    _ if self.newline_before && self.skips_jsdoc_asterisks => {
                        return self.scan_at_jsdoc_asterisk(pos);
                    }
                    _ => self.set(T::Asterisk, pos, next),
                },
                First::Percent => match at(next) {
                    b'=' => self.set(T::PercentEquals, pos, pos + 2),
                    _ => self.set(T::Percent, pos, next),
                },
                First::Ampersand => match (at(next), at(next + 1)) {
                    (b'&', b'=') => self.set(T::AmpersandAmpersandEquals, pos, pos + 3),
                    (b'&', _) => self.set(T::AmpersandAmpersand, pos, pos + 2),
                    (b'=', _) => self.set(T::AmpersandEquals, pos, pos + 2),
                    _ => self.set(T::Ampersand, pos, next),
                },
                First::Bar => match (at(next), at(next + 1)) {
                    (b'|', b'|') if at(pos + 3) == b'|' => {
                        return self.scan_at_possible_conflict_marker(pos);
                    }
                    (b'|', b'=') => self.set(T::BarBarEquals, pos, pos + 3),
                    (b'|', _) => self.set(T::BarBar, pos, pos + 2),
                    (b'=', _) => self.set(T::BarEquals, pos, pos + 2),
                    _ => self.set(T::Bar, pos, next),
                },
                First::Caret => match at(next) {
                    b'=' => self.set(T::CaretEquals, pos, pos + 2),
                    _ => self.set(T::Caret, pos, next),
                },
                First::Backtick => return self.template(pos, true),
                First::Hash => return self.hash(pos),
                First::Backslash => return self.name_slow(pos, pos),
                First::NotAscii => return self.scan_after_comments(pos),
                First::Invalid => {
                    return self.invalid_character(Rejection::UnexpectedCharacter, pos);
                }
            }
            return;
        }
    }

    /// Scans the token after the line feed that precedes `pos`, skipping indentation and empty lines. How far a line is
    /// indented is hard to predict, so the indentation isn't skipped byte by byte.
    #[inline(never)]
    fn scan_after_line_feed(&mut self, mut pos: usize) {
        self.newline_before = true;
        loop {
            pos = self.stops.after_blanks.next(pos);
            match FIRST[usize::from(self.at(pos))] {
                // Most lines start with one of these.
                First::Name => return self.name(pos),
                First::CloseBrace => return self.set(T::CloseBrace, pos, pos + 1),
                First::LineFeed | First::CarriageReturn | First::Blank => pos += 1,
                _ => return self.scan_after_comments(pos),
            }
        }
    }

    /// See `Parser::is_too_deep`.
    #[inline(always)]
    fn is_too_deep(&mut self) -> bool {
        if self.stack_check.is_safe_to_recurse() {
            return false;
        }
        self.reject(Rejection::TooDeep);
        true
    }

    /// The `default:` case of `Scan`, at a character that can't start a token. Go decodes invalid UTF-8 as U+FFFD.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn invalid_character(&mut self, why: Rejection, pos: usize) {
        if !self.recovers {
            return self.reject(why);
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

    /// At a comment or a non-ASCII character: scans the token after it and after any whitespace and comments that
    /// follow.
    #[inline(never)]
    fn scan_after_comments(&mut self, pos: usize) {
        let first = self.comments.len();
        // The start of the file counts as a line break.
        self.newline_since_comment = self.newline_before || self.full_start == 0;
        self.skip_comments_and_scan(pos);
        let next_token_start = self.start;
        let comments = self.comments.get_mut(first..).unwrap_or_default();
        for comment in comments.iter_mut() {
            comment.next_token_start = next_token_start;
        }
        if let Some(last) = comments.last_mut() {
            last.has_newline_after = self.newline_since_comment || !last.is_block;
        }
    }

    /// Skips the comments in a loop instead of recursing, because not every build turns a tail call into a jump and a
    /// file can start with thousands of comments.
    fn skip_comments_and_scan(&mut self, mut pos: usize) {
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
                    self.newline_since_comment = true;
                    Some(self.stops.after_blanks.next(pos + 1))
                }
                b'\r' => {
                    self.newline_before = true;
                    self.newline_since_comment = true;
                    Some(pos + 1)
                }
                b' ' | b'\t' | 0x0B | 0x0C => Some(pos + 1),
                b'<' | b'-' | b'#' => match self.end_of_html_or_hashbang_comment(pos) {
                    Some(end) => {
                        // A formatter has to print `<!-- comment` and `--> comment` too.
                        if self.attach_comments && self.at(pos) != b'#' {
                            self.note_comment(pos, end, CommentForm::Line);
                        }
                        Some(end)
                    }
                    None => return self.scan(pos),
                },
                0x80.. => self.not_ascii(pos),
                _ => return self.scan(pos),
            };
            // `None` means the token is already set.
            match end {
                Some(end) => pos = end,
                None => return,
            }
        }
    }

    /// Scans at a `<!--`, in a script or with `records_html_opens` set. In a script it starts a comment. Otherwise its
    /// position is recorded and it's scanned as `<`.
    #[cold]
    #[inline(never)]
    fn scan_at_html_open(&mut self, pos: usize) {
        if self.is_script {
            return self.scan_after_comments(pos);
        }
        self.html_opens.first.get_or_insert(pos as u32);
        if self.newline_before || self.full_start == 0 {
            self.html_opens.first_on_its_line.get_or_insert(pos as u32);
        }
        self.set(T::LessThan, pos, pos + 1);
    }

    /// `Scan`, at a `*` after a line break, with `skipJSDocLeadingAsterisks`: the first one in a token's trivia is
    /// trivia too (`TokenFlagsPrecedingJSDocLeadingAsterisks`).
    #[cold]
    #[inline(never)]
    fn scan_at_jsdoc_asterisk(&mut self, pos: usize) {
        if self.is_too_deep() {
            return;
        }
        let (at, full_start) = (pos as u32, self.full_start);
        // Trivia can be scanned twice. The second time, the last recorded asterisk is this one or a later one.
        let is_in_trivia = |&last: &u32| full_start <= last && last < at;
        if self.jsdoc_asterisks.last().is_some_and(is_in_trivia) {
            return self.set(T::Asterisk, pos, pos + 1);
        }
        self.jsdoc_asterisks.push(at);
        self.scan(pos + 1)
    }

    /// At a non-ASCII character: returns its end if it's whitespace or a line break. Otherwise scans the name it
    /// starts, or rejects the text, and returns `None`.
    #[cold]
    #[inline(never)]
    fn not_ascii(&mut self, pos: usize) -> Option<usize> {
        let Some((c, len)) = decode(&self.src[pos..]) else {
            self.invalid_character(Rejection::NotUtf8, pos);
            return None;
        };
        if c == 0x2028 || c == 0x2029 {
            self.newline_before = true;
            self.newline_since_comment = true;
        } else if !is_white_space_single_line(c as i32) {
            self.name_slow(pos, pos);
            return None;
        }
        Some(pos + len)
    }

    /// Returns the end of the line at `pos` if a `<!--`, `-->` or `#!` there makes the rest of the line a comment.
    #[cold]
    #[inline(never)]
    fn end_of_html_or_hashbang_comment(&self, pos: usize) -> Option<usize> {
        let rest = &self.src[pos..];
        let is_comment = match self.is_script {
            true if rest.starts_with(b"<!--") => true,
            // Only whitespace and comments precede it on its line.
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

    /// `isConflictMarkerTrivia` also treats the third byte of a line as its start.
    fn is_third_in_line(&self, pos: usize) -> bool {
        let before = pos.checked_sub(2).and_then(|end| self.src.get(..end));
        decode_last(before.unwrap_or_default())
            .is_some_and(|(c, _)| matches!(c, 0x0A | 0x0D | 0x2028 | 0x2029))
    }

    /// `scanConflictMarkerTrivia`, at `pos`. Returns the end of the skipped text.
    fn conflict_marker(&mut self, pos: usize) -> usize {
        self.report(1185, (pos, pos + 7), &[]);
        let marker = self.at(pos);
        if matches!(marker, b'<' | b'>') {
            return self.end_of_line(pos);
        }
        // Skip to the next `=======` or `>>>>>>>`.
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
    fn scan_at_possible_conflict_marker(&mut self, pos: usize) {
        if self.is_conflict_marker(pos) {
            if !self.recovers {
                return self.reject(Rejection::ConflictMarker);
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

    /// Scans a name or keyword that starts at `start` with an ASCII letter, `_` or `$`. It's inlined into `scan` and
    /// `scan_after_line_feed`, and like them doesn't save any registers.
    #[inline(always)]
    fn name(&mut self, start: usize) {
        self.has_escape = false;
        let Some(chunk) = self
            .src
            .get(start..)
            .and_then(|rest| rest.first_chunk::<16>())
        else {
            return self.name_of_any_length(start);
        };
        let len = self.stops.after_name.run(start);
        if len >= 16 {
            return self.long_name(start);
        }
        let after = chunk[(len & 15) as usize];
        if after >= 0x80 || after == b'\\' {
            return self.name_slow(start, start + len as usize);
        }
        let words = crate::names::short_words(chunk, len);
        match self.names.find_short(words) {
            Some((atom, kind)) => {
                self.atom = atom;
                self.set(kind, start, start + len as usize);
            }
            None => self.new_short_name(start, len),
        }
    }

    /// The slow path of `name`, for a name of `len` bytes that isn't in its first slot of the table.
    #[cold]
    #[inline(never)]
    fn new_short_name(&mut self, start: usize, len: u32) {
        let src = self.src;
        let Some(chunk) = src.get(start..).and_then(|rest| rest.first_chunk::<16>()) else {
            return self.name_of_any_length(start);
        };
        let words = crate::names::short_words(chunk, len);
        let (atom, kind) = (self.names).short_name_slow(words, src, (start, len), self.atoms);
        self.atom = atom;
        self.set(kind, start, start + len as usize);
    }

    /// `name` for a name of 16 bytes or more.
    #[inline(never)]
    fn long_name(&mut self, start: usize) {
        let src = self.src;
        let Some(chunk) = (src.get(start + 16..)).and_then(|rest| rest.first_chunk::<16>()) else {
            return self.name_of_any_length(start);
        };
        let len = self.stops.after_name.run(start) as usize;
        if len >= 32 {
            return self.name_of_any_length(start);
        }
        let after = chunk[len & 15];
        if after >= 0x80 || after == b'\\' {
            return self.name_slow(start, start + len);
        }
        let text = Text::from_source(src, start, start + len);
        self.atom = self.names.long(text, self.atoms);
        // No keyword is that long.
        self.set(T::Identifier, start, start + len);
    }

    /// `name` for a name of 32 bytes or more, or one near the end of the text.
    #[cold]
    #[inline(never)]
    fn name_of_any_length(&mut self, start: usize) {
        let src = self.src;
        let end = self.stops.after_name.next(start).min(src.len());
        if matches!(src.get(end), Some(b'\\' | 0x80..)) {
            return self.name_slow(start, end);
        }
        let text = src.get(start..end).unwrap_or_default();
        self.atom = (self.names).atom(Text::from_source(src, start, end), self.atoms);
        self.set(crate::token::keyword(text), start, end);
    }

    /// Scans a name that starts at `start` and has a non-ASCII character or an escape at `from` or later.
    #[cold]
    #[inline(never)]
    fn name_slow(&mut self, start: usize, from: usize) {
        let src = self.src;
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        text.extend_from_slice(&src[start..from]);
        let mut pos = from;
        self.has_escape = false;
        // A private name's text includes the `#`.
        let is_private = src.get(start) == Some(&b'#');
        loop {
            // `scanIdentifierParts`: with `recovers`, the name ends before the first character that can't be part of
            // it.
            let (c, len) = match src.get(pos) {
                Some(b'\\') => match self.unicode_escape(pos + 1) {
                    Some((c, end)) => (c, end - pos),
                    None if self.recovers => break,
                    None => {
                        self.buffer = text;
                        return self.reject(Rejection::InvalidEscape);
                    }
                },
                Some(_) => match decode(&src[pos..]) {
                    Some(decoded) => decoded,
                    None if self.recovers => break,
                    None => {
                        self.buffer = text;
                        return self.reject(Rejection::NotUtf8);
                    }
                },
                None => break,
            };
            let is_name_char = match text.len() == usize::from(is_private) {
                true => {
                    is_identifier_start(c)
                        || self.is_ecmascript
                            && bun_core::lexer::is_recent_identifier_start(c as i32)
                }
                false => {
                    is_identifier_part(c)
                        || bun_core::lexer::is_type_script_identifier_part(c as i32)
                        || self.is_ecmascript
                            && bun_core::lexer::is_recent_identifier_part(c as i32)
                }
            };
            let is_escape = src[pos] == b'\\';
            if !is_name_char {
                if is_escape && !self.recovers {
                    self.buffer = text;
                    return self.reject(Rejection::InvalidEscape);
                }
                break;
            }
            let Some(c) = char::from_u32(c) else {
                self.buffer = text;
                return self.reject(Rejection::InvalidEscape);
            };
            self.has_escape |= is_escape;
            text.extend_from_slice(c.encode_utf8(&mut [0; 4]).as_bytes());
            pos += len;
        }
        if text.len() == usize::from(is_private) {
            self.buffer = text;
            return match is_private {
                true => self.hash_without_name(start),
                false => self.invalid_character(Rejection::UnexpectedCharacter, start),
            };
        }
        self.atom = (self.names).atom(Text::not_in_source(src, &text), self.atoms);
        let mut kind = crate::token::keyword(&text);
        self.buffer = text;
        if is_private {
            self.note_private_name(start);
            return self.set(T::PrivateIdentifier, start, pos);
        }
        if self.has_escape && kind != T::Identifier {
            // `GetIdentifierToken`. See `take_errors`.
            if self.recovers {
                self.report(1260, (start, pos), &[]);
                return self.set(kind, start, pos);
            }
            if matches!(kind, T::Await | T::Yield | T::Async) {
                return self.reject(Rejection::EscapedKeyword);
            }
            // It's an error wherever it's parsed as the keyword. TypeScript parses a contextual keyword as the keyword
            // wherever it can.
            kind = match kind.is_reserved_word() {
                true => T::EscapedReservedWord,
                false if self.is_ecmascript => T::Identifier,
                false => return self.reject(Rejection::EscapedKeyword),
            };
        }
        self.set(kind, start, pos);
    }

    /// Parses `u1234` or `u{1234}` at `pos`. Returns the code point and the end.
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

    /// At a `#`.
    #[inline(never)]
    fn hash(&mut self, pos: usize) {
        let is_first = pos == 0 || pos == 3 && self.src.starts_with(b"\xEF\xBB\xBF");
        if is_first && self.at(pos + 1) == b'!' {
            return self.scan_after_comments(pos);
        }
        self.private_name(pos)
    }

    /// Scans `#name` at `start`. Its text includes the `#`.
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
            return self.name_slow(start, end);
        }
        self.has_escape = false;
        self.atom = (self.names).atom(Text::from_source(src, start, end), self.atoms);
        self.note_private_name(start);
        self.set(T::PrivateIdentifier, start, end);
    }

    /// Records the private name at `start`, whose atom is `self.atom`.
    fn note_private_name(&mut self, start: usize) {
        self.private_names.push(self.atom);
        let before = self.src.get(..start).unwrap_or_default().trim_ascii_end();
        if let Some(object) = before.strip_suffix(b".")
            && object.trim_ascii_end().ends_with(b"super")
        {
            self.private_names.push(Atom::NONE);
        }
    }

    /// The `#` case of `Scan`, for a `#` at `start` that isn't followed by a name.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn hash_without_name(&mut self, start: usize) {
        if !self.recovers {
            return self.reject(Rejection::UnexpectedCharacter);
        }
        // "'#!' can only be used at the start of a file."
        if self.at(start + 1) == b'!' {
            self.report(18026, (start, start + 2), &[]);
            return self.set(T::Invalid, start, start + 1);
        }
        self.report(1127, (start, start + 1), &[]);
        self.has_escape = false;
        let text = Text::from_source(self.src, start, start + 1);
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::PrivateIdentifier, start, start + 1);
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// Returns the position of the line break that ends the line at `pos`, or the end of the text.
    #[inline]
    fn end_of_line(&self, mut pos: usize) -> usize {
        let src = self.src;
        loop {
            pos = self.stops.in_string.next(pos);
            match src.get(pos) {
                None => return src.len(),
                Some(b'\n' | b'\r') => return pos,
                Some(0x80..) => return self.end_of_non_ascii_line(pos),
                Some(_) => pos += 1,
            }
        }
    }

    /// `end_of_line` for a line with non-ASCII text, where every byte is a stop in `ScannerStops::in_string`.
    #[cold]
    #[inline(never)]
    fn end_of_non_ascii_line(&self, mut pos: usize) -> usize {
        let src = self.src;
        while let Some(len) = strings::index_of_any(src.get(pos..).unwrap_or_default(), b"\n\r\xE2")
        {
            pos += len;
            if src[pos] != 0xE2 || matches!(src.get(pos..pos + 3), Some([_, 0x80, 0xA8 | 0xA9])) {
                return pos;
            }
            pos += 1;
        }
        src.len()
    }

    /// Records a comment. `Lexer::scan_after_comments` fills in `next_token_start`, and `has_newline_after` for the
    /// last comment before a token.
    #[inline(always)]
    fn note_comment(&mut self, start: usize, end: usize, form: CommentForm) {
        let has_newline_before = std::mem::take(&mut self.newline_since_comment);
        if let Some(previous) = self.comments.last_mut()
            && previous.prev_token_end == self.full_start
            && previous.pos >= self.full_start
        {
            previous.has_newline_after = has_newline_before;
        }
        self.comments.push(Comment {
            pos: start as u32,
            end: end as u32,
            prev_token_end: self.full_start,
            next_token_start: end as u32,
            is_block: form != CommentForm::Line,
            is_multiline: form == CommentForm::MultilineBlock,
            has_newline_before,
            has_newline_after: false,
            enclosing_node: NodeOrName::None,
            preceding_node: NodeOrName::None,
            following_node: NodeOrName::None,
        });
        // Until the parser has looked at the new comment, any node could be next to it.
        if self.attach_comments {
            self.max_relevant_node_start = u32::MAX;
        }
    }

    /// Records the `//` comment at `start`. Returns its end.
    #[inline(never)]
    fn line_comment(&mut self, start: usize) -> usize {
        let end = self.end_of_line(start + 2);
        if self.full_start == 0 {
            self.leading_comments.push((start as u32, end as u32));
        }
        self.note_comment(start, end, CommentForm::Line);
        // `processCommentDirective`: "Skip opening //", "Skip another / if present"
        let src = self.src;
        let mut pos = start + 2;
        while pos < end && src[pos] == b'/' {
            pos += 1;
        }
        self.comment_directive(start, pos, end);
        end
    }

    /// Records the `/*` comment at `start`. Returns its end, or `None` if it's unterminated and the text is rejected.
    #[inline(never)]
    fn block_comment(&mut self, start: usize) -> Option<usize> {
        let src = self.src;
        let rest = src.get(start + 2..).unwrap_or_default();
        let len = strings::index_of(rest, b"*/");
        let body = &rest[..len.unwrap_or(rest.len())];
        // The start of its last line.
        let mut last_line = start;
        let mut before = body.len();
        while let Some(at) = strings::last_index_of_any(&body[..before], b"\n\r\xE2") {
            let line_break = match body[at..] {
                [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
                [0xE2, ..] => {
                    before = at;
                    continue;
                }
                _ => 1,
            };
            self.newline_before = true;
            last_line = start + 2 + at + line_break;
            break;
        }
        let end = match len {
            Some(len) => start + 2 + len + 2,
            // "'*/' expected.", at the end of the text. The comment ends there.
            None if self.error(Rejection::Unterminated, 1010, (src.len(), src.len()), &[]) => {
                src.len()
            }
            None => return None,
        };
        if self.full_start == 0 {
            self.leading_comments.push((start as u32, end as u32));
        }
        let form = match last_line != start {
            true => CommentForm::MultilineBlock,
            false => CommentForm::Block,
        };
        self.note_comment(start, end, form);
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

    /// `processCommentDirective`, starting at the whitespace before the `@`.
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
        // After a lookahead, the same comment is scanned again.
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

    /// Scans the string at `start`, quoted with `quote`.
    #[inline(never)]
    fn string(&mut self, start: usize, quote: u8) {
        let src = self.src;
        let mut end = start + 1;
        loop {
            end = self.stops.in_string.next(end);
            match src.get(end) {
                Some(&c) if c == quote => break,
                Some(b'"' | b'\'' | b'`' | b'$') => end += 1,
                // A backslash, a control character, or anything non-ASCII.
                _ => return self.string_slow(start, quote),
            }
        }
        self.atom = self.atom_of_source(start + 1, end);
        self.plain_string = start as u32;
        self.set(T::String, start, end + 1);
    }

    /// Returns the position of the first byte from `pos` on that's in `ends`, or the end of the text. Every byte in
    /// `ends` must be a stop in `ScannerStops::in_string`.
    #[inline]
    fn end_of_run_before(&self, mut pos: usize, ends: [u8; 4]) -> usize {
        let src = self.src;
        loop {
            pos = self.stops.in_string.next(pos);
            match src.get(pos) {
                None => return src.len(),
                Some(c) if ends.contains(c) => return pos,
                // Every byte of non-ASCII text is a stop.
                Some(0x80..) => break,
                Some(_) => pos += 1,
            }
        }
        let rest = &src[pos..];
        pos + strings::index_of_any(rest, &ends).unwrap_or(rest.len())
    }

    /// Returns the atom of the text from `start` to `end`, which contains no zero byte.
    #[inline]
    fn atom_of_source(&mut self, start: usize, end: usize) -> Atom {
        let text = Text::from_source(self.src, start, end);
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
            None => self.names.short_slow(words, text, self.atoms).0,
        }
    }

    /// Decodes `\1` to `\377`, `\8` or `\9` at `pos` in a string. Returns its end.
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
        push_codepoint_wtf8_joined(text, c);
        Some(end)
    }

    /// `scanEscapeSequence`: returns the end of the invalid escape at `pos`.
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

    /// Decodes the escape whose backslash is at `pos` and appends its value to `text`. Returns its end, or `None` if
    /// TypeScript reports an error for it.
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
                push_codepoint_wtf8_joined(text, c);
                return Some(pos + 4);
            }
            b'u' => {
                let (c, end) = self.unicode_escape(pos + 1)?;
                push_codepoint_wtf8_joined(text, c);
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

    /// `scanEscapeSequence`, at a backslash before a byte that isn't valid UTF-8. Go decodes it as U+FFFD.
    #[cold]
    #[inline(never)]
    fn escaped_byte(&self, pos: usize, text: &mut Vec<u8>) -> Option<usize> {
        if !self.recovers {
            return None;
        }
        push_codepoint_wtf8_joined(text, 0xFFFD);
        Some(pos + 2)
    }

    #[cold]
    #[inline(never)]
    fn string_slow(&mut self, start: usize, quote: u8) {
        let src = self.src;
        let mut text = std::mem::take(&mut self.buffer);
        text.clear();
        let mut pos = start + 1;
        let mut is_ascii = true;
        let has_end = loop {
            match src.get(pos) {
                None | Some(b'\n' | b'\r') => {
                    // "Unterminated string literal." The string ends there.
                    if !self.error(Rejection::Unterminated, 1002, (pos, pos), &[]) {
                        self.buffer = text;
                        return;
                    }
                    break false;
                }
                Some(&c) if c == quote => break true,
                // The most common escapes whose value is the character after the backslash.
                Some(b'\\') if let Some(&c @ (b'"' | b'\'' | b'\\')) = src.get(pos + 1) => {
                    text.push(c);
                    pos += 2;
                }
                Some(b'\\') => match self.escape(pos, &mut text) {
                    Some(end) => pos = end,
                    None => match self.legacy_escape(pos, &mut text) {
                        Some(end) => pos = end,
                        None if self.recovers => pos = self.invalid_escape(pos, &mut text, true),
                        None => {
                            self.buffer = text;
                            return self.reject(Rejection::InvalidEscape);
                        }
                    },
                },
                Some(_) => {
                    let end = self.end_of_run_before(pos + 1, [quote, b'\\', b'\n', b'\r']);
                    let raw = src.get(pos..end).unwrap_or_default();
                    is_ascii &= raw.is_ascii();
                    text.extend_from_slice(raw);
                    pos = end;
                }
            }
        };
        // TypeScript's scanner accepts the bytes as they are.
        if !is_ascii && !self.recovers && !is_utf8(&src[start + 1..pos]) {
            self.buffer = text;
            return self.reject(Rejection::NotUtf8);
        }
        self.atom = (self.names).atom(Text::not_in_source(src, &text), self.atoms);
        self.buffer = text;
        self.set(T::String, start, pos + usize::from(has_end));
    }

    /// `scanEscapeSequence`, for escapes that `escape` doesn't decode. `reports` is `ReportErrors`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn invalid_escape(&mut self, pos: usize, text: &mut Vec<u8>, reports: bool) -> usize {
        let src = self.src;
        let end = self.end_of_invalid_escape(pos);
        let raw = src.get(pos..end).unwrap_or_default();
        let Some(&c) = src.get(pos + 1) else {
            // "Unexpected end of text." The escape has no value.
            self.error(Rejection::Unterminated, 1126, (end, end), &[]);
            return end;
        };
        if !reports {
            text.extend_from_slice(raw);
            return end;
        }
        match c {
            b'0'..=b'7' => {
                let digits = raw.iter().skip(1);
                let code = digits.fold(0, |code, &digit| code * 8 + u32::from(digit - b'0'));
                let syntax = format!("\\x{code:02x}");
                self.report(1487, (pos, end), &[syntax.as_bytes()]);
                push_codepoint_wtf8_joined(text, code);
            }
            b'8' | b'9' => {
                self.report(1488, (pos, end), &[raw]);
                text.push(c);
            }
            // "Hexadecimal digit expected."
            b'x' => {
                self.report(1125, (end, end), &[]);
                text.extend_from_slice(raw);
            }
            b'u' => {
                self.report_invalid_unicode_escape(pos, end);
                text.extend_from_slice(raw);
            }
            // `escape` decodes the others.
            _ => return pos + 1,
        }
        end
    }

    /// `scanUnicodeEscape(true)`, for the invalid `\u` escape from `pos` to `end`.
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

    /// Scans a template piece that starts at `start` with a `` ` `` (`is_head`) or a `}`.
    #[inline(never)]
    fn template(&mut self, start: usize, is_head: bool) {
        self.template_piece(start, is_head, false);
    }

    /// `scanTemplateAndSetTokenValue`. `reports` is `shouldEmitInvalidEscapeError`.
    #[inline(always)]
    #[track_caller]
    fn template_piece(&mut self, start: usize, is_head: bool, reports: bool) {
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
                    if !self.error(Rejection::Unterminated, 1160, (pos, pos), &[]) {
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
                    // An invalid escape is an error unless the template is tagged.
                    None => {
                        self.has_escape |= pos + 1 < src.len();
                        is_ascii = false;
                        pos = self.invalid_escape(pos, &mut text, reports);
                    }
                },
                // Every line break is normalized to a line feed.
                Some(b'\r') => {
                    text.push(b'\n');
                    pos += if src.get(pos + 1) == Some(&b'\n') {
                        2
                    } else {
                        1
                    };
                }
                Some(_) => {
                    let end = self.end_of_run_before(pos + 1, *b"`$\\\r");
                    let raw = src.get(pos..end).unwrap_or_default();
                    is_ascii &= raw.is_ascii();
                    text.extend_from_slice(raw);
                    pos = end;
                }
            }
        };
        if !is_ascii && !self.recovers && !is_utf8(&src[start + 1..pos]) {
            self.buffer = text;
            return self.reject(Rejection::NotUtf8);
        }
        self.atom = (self.names).atom(Text::not_in_source(src, &text), self.atoms);
        self.buffer = text;
        self.set(token, start, end);
    }

    /// `ReScanTemplateToken`: the token is the `}` that ends a substitution.
    pub(crate) fn rescan_template_continuation(&mut self) {
        debug_assert_eq!(self.token, T::CloseBrace);
        self.template(self.start as usize, false);
    }

    /// `ReScanTemplateToken(false)`, at a template piece that has an invalid escape.
    #[cold]
    #[inline(never)]
    pub(crate) fn rescan_template_without_tag(&mut self) {
        if !self.recovers {
            return self.reject(Rejection::Reported);
        }
        // TypeScript only scans the text after a `}` once.
        self.discard_errors_from(self.start.saturating_add(1));
        let start = self.start as usize;
        self.template_piece(start, self.at(start) == b'`', true);
    }

    // ───────────────────────────── numbers ─────────────────────────────

    /// Scans base-`radix` digits from `pos` on, with optional separators between them. Returns their end.
    fn digits(&self, mut pos: usize, radix: u32) -> Option<usize> {
        let src = self.src;
        let first = pos;
        loop {
            match src.get(pos) {
                Some(&c) if char::from(c).is_digit(radix) => pos += 1,
                // A separator is only valid between two digits.
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
        self.number_slow(start)
    }

    /// The slow path of `number`, for anything but a few plain digits.
    #[inline(never)]
    fn number_slow(&mut self, start: usize) {
        match self.unusual_number(start) {
            Some((token, end)) => self.set(token, start, end),
            None => self.invalid_number(start),
        }
    }

    /// True if the character at `pos` can't directly follow a number.
    fn is_at_start_of_name(&self, pos: usize) -> bool {
        match self.src.get(pos) {
            Some(&c @ ..0x80) => is_name_byte(c) || c == b'\\',
            Some(_) => decode(&self.src[pos..]).is_none_or(|(c, _)| is_identifier_part(c)),
            None => false,
        }
    }

    /// Scans `010`, which is 8, or `08` and `08.5`, which are decimal.
    fn number_with_leading_zero(&mut self, start: usize) -> Option<(T, usize)> {
        let src = self.src;
        let mut end = start;
        while src.get(end).is_some_and(u8::is_ascii_digit) {
            end += 1;
        }
        let is_octal = src[start..end].iter().all(|c| matches!(c, b'0'..=b'7'));
        if is_octal {
            // The error covers all of `-010`.
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
            self.atom = (self.names).atom(Text::not_in_source(self.src, &decimal), self.atoms);
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

    /// `scanIdentifierParts`: returns the end of the identifier characters that start at `pos`.
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

    /// `scanNumber`, and the `0x`, `0b` and `0o` cases of `Scan`, for numbers that `unusual_number` rejects.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn invalid_number(&mut self, start: usize) {
        if !self.recovers {
            return self.reject(Rejection::UnusualNumber);
        }
        let mut digits = std::mem::take(&mut self.buffer);
        digits.clear();
        let (token, end) = self.number_with_errors(start, &mut digits);
        self.buffer = digits;
        self.set(token, start, end);
    }

    /// Returns the token and its end. `digits` is an empty scratch buffer.
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
                self.atom = (self.names).atom(Text::not_in_source(src, &decimal), self.atoms);
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
                // After a `-`, the error starts one byte earlier, no matter what's between the two.
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
            // Neither an `n` suffix nor whatever follows is checked.
            self.report(1489, (start, end), &[]);
            return (T::Number, end);
        }
        let mut token = T::Number;
        if end_of_fixed_part == end && self.at(end) == b'n' {
            // `scanBigIntSuffix`, `ParsePseudoBigInt`
            let zeros = digits.iter().take_while(|&&c| c == b'0').count();
            let zeros = zeros.min(digits.len().saturating_sub(1));
            let decimal = digits.get(zeros..).unwrap_or_default();
            self.atom = (self.names).atom(Text::not_in_source(src, decimal), self.atoms);
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

    // ───────────────────────────── rescans for the parser ─────────────────────────────

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
                    // Skip the escaped character only if it's one byte. A longer one is handled like an unescaped
                    // character.
                    if src.get(pos + 1).is_some_and(u8::is_ascii) {
                        pos += 1;
                    }
                }
                // TypeScript 7's scanner reads bytes here, so only "\n" and "\r" end a line.
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
        // The flags: any characters that can be part of a name.
        loop {
            match src.get(pos) {
                Some(&c) if is_name_byte(c) => pos += 1,
                Some(0x80..) => match decode(&src[pos..]) {
                    Some((c, len)) if is_identifier_part(c) => pos += len,
                    Some(_) => break,
                    None if self.recovers => break,
                    None => return self.reject(Rejection::NotUtf8),
                },
                _ => break,
            }
        }
        if core::str::from_utf8(&src[start..pos]).is_err() && !self.recovers {
            return self.reject(Rejection::NotUtf8);
        }
        self.set(T::Regex, start, pos);
    }

    /// `ReScanSlashToken`, for a regular expression whose line ends at `end_of_line`.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn unterminated_regex(&mut self, end_of_line: usize) {
        if !self.recovers {
            return self.reject(Rejection::Unterminated);
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
                Some((c, len)) if is_white_space_like(c as i32) || c == u32::from(b';') => {
                    end -= len
                }
                _ => break,
            }
        }
        self.report(1161, (start, end), &[]);
        self.set(T::Regex, start, end);
    }
}

// ───────────────────────────── JSX ─────────────────────────────

impl Lexer<'_> {
    /// `ScanJsxIdentifier`: the token is a name or keyword, which is extended across any `-`.
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
                return self.reject(Rejection::Unsupported);
            }
            let text = Text::from_source(src, self.start as usize, end);
            self.atom = self.names.atom(text, self.atoms);
            self.end = end as u32;
        }
        self.token = T::Identifier;
    }

    /// `ScanJsxAttributeValue`: scans the token after an attribute's `=`. A string has no escapes, and its value is the
    /// text between the quotes.
    pub(crate) fn scan_jsx_attribute_value(&mut self) {
        let before = self.end as usize;
        // `next` scans a JavaScript string, so it rejects one that contains a line break.
        let saved_rejection = self.rejection;
        let first_comment = self.comments.len();
        self.next();
        let src = self.src;
        let start = match self.rejection == saved_rejection {
            true if self.token != T::String => return,
            // The string reads the same in JSX as in JavaScript.
            true if self.plain_string == self.start
                && self.flagged.is_empty()
                && self.errors.is_empty() =>
            {
                return;
            }
            true => self.start as usize,
            false if self.recovers => return,
            // Rescan it from the quote.
            false => {
                self.rejection = saved_rejection;
                let mut pos = before;
                loop {
                    match (src.get(pos), src.get(pos + 1)) {
                        (Some(b' ' | b'\t' | b'\n' | b'\r'), _) => pos += 1,
                        (Some(b'/'), Some(b'/')) if self.skips_comments_before_jsx_strings() => {
                            pos = self.end_of_line(pos);
                        }
                        (Some(b'/'), Some(b'*')) if self.skips_comments_before_jsx_strings() => {
                            let rest = src.get(pos + 2..).unwrap_or_default();
                            let Some(len) = bun_core::strings::index_of(rest, b"*/") else {
                                break;
                            };
                            pos += len + 4;
                        }
                        _ => break,
                    }
                }
                if !matches!(src.get(pos), Some(b'"' | b'\'')) {
                    return self.reject(Rejection::Unsupported);
                }
                // TypeScript 5 scans a JavaScript string there, and rejects it as one.
                if pos > before && self.scans_jsx_strings_as_typescript_5() {
                    return self.reject(Rejection::Unterminated);
                }
                // The rejected string wasn't a token. The next token is the string at `pos`.
                for comment in self.comments.iter_mut().skip(first_comment) {
                    comment.next_token_start = pos as u32;
                }
                pos
            }
        };
        // What looked like an escape isn't one in JSX.
        self.discard_flagged_from(start as u32);
        if !self.errors.is_empty() && self.is_javascript_string(before, start) {
            return;
        }
        let quote = src[start];
        let Some(len) = bun_core::strings::index_of_char_usize(&src[start + 1..], quote) else {
            return self.unterminated_jsx_string(before, start);
        };
        let text = &src[start + 1..start + 1 + len];
        if core::str::from_utf8(text).is_err() && !self.recovers {
            return self.reject(Rejection::NotUtf8);
        }
        if start != before
            && bun_core::strings::contains_char(text, b'\\')
            && self.is_string_with_escapes(before, start)
        {
            return;
        }
        let text = Text::from_source(src, start + 1, start + 1 + len);
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::String, start, start + len + 2);
    }

    /// True if the string at `start`, which has a backslash, stays the way `next` scanned it.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn is_string_with_escapes(&mut self, before: usize, start: usize) -> bool {
        if !self.recovers {
            self.reject(Rejection::Unsupported);
            return true;
        }
        self.is_javascript_string(before, start)
    }

    /// In TypeScript 5 and 6, which typescript-estree runs on, whitespace before the quote is enough for
    /// `scanJsxAttributeValue` to leave the string to `scan`. Babel, acorn-jsx and oxc scan it like TypeScript 7.
    fn scans_jsx_strings_as_typescript_5(&self) -> bool {
        self.is_typescript_5 && !self.is_ecmascript && !self.is_babel && !self.is_oxc
    }

    /// acorn, Babel and oxc skip a comment between the `=` and the quote, like anywhere else. TypeScript scans a
    /// JavaScript string after one.
    fn skips_comments_before_jsx_strings(&self) -> bool {
        self.is_ecmascript || self.is_oxc
    }

    /// `ScanJsxAttributeValue`: true if the string at `start` is left to `Scan`, which happens after a comment.
    #[cold]
    #[inline(never)]
    fn is_javascript_string(&mut self, before: usize, start: usize) -> bool {
        let mut pos = before;
        while let Some((c, len)) = decode(self.src.get(pos..start).unwrap_or_default())
            && is_white_space_like(c as i32)
        {
            pos += len;
        }
        if pos < start && !self.skips_comments_before_jsx_strings()
            || before < start && self.scans_jsx_strings_as_typescript_5()
        {
            return true;
        }
        self.discard_errors_from(before as u32);
        false
    }

    /// `scanString(true)`, for a string at `start` that runs to the end of the text.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn unterminated_jsx_string(&mut self, before: usize, start: usize) {
        let src = self.src;
        let end = src.len();
        if !self.error(Rejection::Unterminated, 1002, (end, end), &[]) {
            return;
        }
        // The error belongs to the scan that began at `before`, so resetting to a mark at the string must keep it.
        if let Some(origin) = self.origins.last_mut() {
            *origin = before as u32;
        }
        let text = Text::from_source(src, start + 1, end);
        self.atom = self.names.atom(text, self.atoms);
        self.set(T::String, start, end);
    }

    /// `ScanJsxToken`: scans an element's child, starting at the end of the current token. Whitespace-only text that
    /// contains a line break isn't a child.
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
                Some(b'<')
                    if src.get(start + 1) == Some(&b'/') && !self.is_ecmascript && !self.is_oxc =>
                {
                    self.newline_before = newline_before;
                    return self.set(T::LessThanSlash, start, start + 2);
                }
                Some(b'<') => {
                    self.newline_before = newline_before;
                    return self.set(T::LessThan, start, start + 1);
                }
                Some(_) => {}
            }
            // Usually only a line break and indentation separate two elements.
            let (mut end, mut has_line_break) = (start, false);
            while let Some(c @ (b' ' | b'\t' | b'\n' | b'\r')) = src.get(end) {
                has_line_break |= matches!(c, b'\n' | b'\r');
                end += 1;
            }
            let is_only_whitespace = match src.get(end) {
                None | Some(b'{') => true,
                // `<<` may start a conflict marker.
                Some(b'<') => src.get(end + 1) != Some(&b'<'),
                Some(_) => false,
            };
            if is_only_whitespace && has_line_break {
                debug_assert!(
                    core::str::from_utf8(&src[start..end])
                        .is_ok_and(|it| fix_whitespace_and_decode_jsx_entities(it).is_empty())
                );
                newline_before = true;
                start = end;
                continue;
            }
            let rest = &src[start..];
            let len = bun_core::strings::index_of_any(rest, b"{<").unwrap_or(rest.len());
            let text = &rest[..len];
            // Each `>` or `}` is an error but stays part of the text.
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
                return self.jsx_text_with_invalid_utf8(start, text);
            };
            let needs_fixing = text
                .iter()
                .any(|&c| matches!(c, b'&' | b'\n' | b'\r' | 0x80..));
            if !needs_fixing {
                let text = Text::from_source(src, start, start + len);
                self.atom = self.names.atom(text, self.atoms);
                return self.set(T::JsxText, start, start + len);
            }
            let fixed = fix_whitespace_and_decode_jsx_entities(valid);
            if fixed.is_empty() {
                newline_before = true;
                start += len;
                continue;
            }
            self.atom = (self.names).atom(Text::not_in_source(src, &fixed), self.atoms);
            return self.set(T::JsxText, start, start + len);
        }
    }

    /// `ScanJsxTokenEx`: reports each `>` and `}` in `text`. Returns true if the scanner continues.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn closers_in_jsx_text(&mut self, start: usize, text: &[u8]) -> bool {
        if !self.recovers {
            self.reject(Rejection::Reported);
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

    /// `ScanJsxTokenEx`: true if a conflict marker ends the JSX text at `pos`. The text and the marker become one
    /// token.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn conflict_marker_in_jsx(&mut self, pos: usize) -> bool {
        if !self.is_conflict_marker(pos) {
            return false;
        }
        if !self.recovers {
            self.reject(Rejection::ConflictMarker);
            return true;
        }
        let end = self.conflict_marker(pos);
        // `newline_before` keeps the previous token's value, like `tokenFlags`.
        self.set(T::ConflictMarker, self.full_start as usize, end);
        true
    }

    /// Scans the JSX text `text` at `start`, which isn't valid UTF-8.
    #[cold]
    #[inline(never)]
    #[track_caller]
    fn jsx_text_with_invalid_utf8(&mut self, start: usize, text: &[u8]) {
        if !self.recovers {
            return self.reject(Rejection::NotUtf8);
        }
        let read = with_replacement_characters(text);
        let fixed = fix_whitespace_and_decode_jsx_entities(&read);
        self.atom = (self.names).atom(Text::not_in_source(self.src, &fixed), self.atoms);
        self.set(T::JsxText, start, start + text.len());
    }
}

/// Decodes `text` the way Go does. Each byte that isn't valid UTF-8 becomes U+FFFD.
fn with_replacement_characters(mut text: &[u8]) -> String {
    let mut read = String::new();
    while !text.is_empty() {
        let (c, len) = decode(text).unwrap_or((0xFFFD, 1));
        read.push(char::from_u32(c).unwrap_or(char::REPLACEMENT_CHARACTER));
        text = text.get(len..).unwrap_or_default();
    }
    read
}

/// Returns the value of the JSX text `text`: lines are trimmed and joined with a space, whitespace-only lines are
/// dropped, and entities are decoded.
fn fix_whitespace_and_decode_jsx_entities(text: &str) -> Vec<u8> {
    let mut decoded = Vec::new();
    let mut after_last_non_whitespace = None;
    // Leading whitespace on the first line is kept.
    let mut first_non_whitespace = Some(0);
    for (at, c) in text.char_indices() {
        let (is_line_break, is_whitespace) = match c {
            '!'..='~' => (false, false),
            ' ' | '\t' => (false, true),
            c => (
                is_js_line_terminator(u32::from(c)),
                bun_core::lexer::is_white_space_single_line(c as i32),
            ),
        };
        if is_line_break {
            if let (Some(start), Some(end)) = (first_non_whitespace, after_last_non_whitespace) {
                if !decoded.is_empty() {
                    decoded.push(b' ');
                }
                decode_jsx_entities(&text[start..end], &mut decoded);
            }
            first_non_whitespace = None;
        } else if !is_whitespace {
            after_last_non_whitespace = Some(at + c.len_utf8());
            first_non_whitespace.get_or_insert(at);
        }
    }
    // So is trailing whitespace on the last line.
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
                push_codepoint_wtf8_joined(decoded, c);
                text = &text[entity.len() + 1..];
            }
            _ => decoded.push(b'&'),
        }
    }
    decoded.extend_from_slice(text.as_bytes());
}

/// Returns the code point for the digits of `&#..;`.
fn parse_entity_number(digits: &str, radix: u8) -> Option<u32> {
    let number = bun_core::parse_int::<i32>(digits.as_bytes(), radix).ok()?;
    u32::try_from(number).ok().filter(|&c| c <= 0x10_FFFF)
}

/// `ParsePseudoBigInt`: converts the base-`radix` digits `digits` to base 10.
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

/// Returns the value of the base-`radix` digits `digits`, rounded once. `radix` is a power of two.
fn number_from_digits(digits: &[u8], radix: u32) -> f64 {
    let mut integer = bun_core::fmt::RadixInteger::default();
    for digit in digits.iter().filter_map(|&c| char::from(c).to_digit(radix)) {
        integer.push_digit(radix.trailing_zeros(), digit);
    }
    integer.to_f64()
}
