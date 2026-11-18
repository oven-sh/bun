//! Finds where tokens end and checks them. What a literal stands for is left to whoever asks.

mod comment;
mod name;
mod number;
mod operator;
mod quoted;

use bun_highway::{ScannerStops, ScannerWindow, Stops};

use crate::chars;
use crate::error::LexicalError;
use crate::names::{Chunk, Key, LONGEST_SHORT, Name, Names};
use crate::source::Source;
use crate::token::{Detail, Token, TokenKind};

use operator::SCANNERS;
pub(crate) use quoted::TEMPLATE_IS_TAIL;

#[repr(C)]
pub(crate) struct Lexer<'a> {
    pub(crate) token: Token,
    pub(crate) previous_end: u32,
    is_strict: bool,
    window_start: usize,
    /// Those of `source`, up to the end of what is parsed.
    bytes: &'a [u8],
    pub(crate) source: Source<'a>,
    pub(crate) names: Names,
    first_offset: u32,
    is_module: bool,
    is_builtin: bool,
    /// Outlasts the token it is about, and is reported in place of what the parser has to say.
    pub(crate) error: Option<LexicalError>,
    pub(crate) source_url: Option<(u32, u32)>,
    pub(crate) source_mapping_url: Option<(u32, u32)>,
    pub(crate) scratch: Vec<u16>,
    window: ScannerWindow,
}

/// The longest that `Stops::run` is sure of.
const EXACT_RUN: u32 = 56;

/// What is wrong with a literal.
#[derive(Clone, Copy)]
struct Flaw {
    kind: TokenKind,
    end: usize,
    message: &'static str,
}

impl<'a> Lexer<'a> {
    /// There is no token until [`Lexer::next`].
    #[inline(always)]
    pub(crate) fn new(
        source: Source<'a>,
        (start, end): (u32, u32),
        names: Names,
        scratch: Vec<u16>,
        is_module: bool,
        is_builtin: bool,
    ) -> Lexer<'a> {
        Lexer {
            token: Token::new(
                TokenKind::Semicolon,
                start as usize,
                start as usize,
                Detail::NONE,
            ),
            previous_end: start,
            is_strict: false,
            window_start: usize::MAX / 2,
            bytes: &source.bytes[..end as usize],
            source,
            names,
            first_offset: start,
            is_module,
            is_builtin,
            error: None,
            source_url: None,
            source_mapping_url: None,
            scratch,
            window: ScannerWindow::default(),
        }
    }

    /// Before the first token.
    pub(crate) fn skip_hashbang(&mut self) {
        if self.first_offset == 0 && self.bytes.starts_with(b"#!") {
            let end = self.skip_line(2);
            self.set(TokenKind::Semicolon, 0, end, Detail::NONE);
        }
    }

    #[inline(always)]
    pub(crate) fn set_strict(&mut self, is_strict: bool) {
        self.is_strict = is_strict;
    }

    /// Of what is parsed.
    pub(crate) fn first_offset(&self) -> u32 {
        self.first_offset
    }

    /// Of what is parsed.
    #[inline(always)]
    pub(crate) fn end(&self) -> u32 {
        self.bytes.len() as u32
    }

    /// Zero past the end.
    #[inline(always)]
    pub(crate) fn byte(&self, offset: usize) -> u8 {
        self.bytes.get(offset).copied().unwrap_or(0)
    }

    #[inline(always)]
    pub(crate) fn bytes_of(&self, token: Token) -> &'a [u8] {
        &self.bytes[token.start() as usize..token.end() as usize]
    }

    #[inline(never)]
    pub(crate) fn next(&mut self) {
        self.advance(Detail::NONE);
    }

    /// For where any name will do. With `NEEDS_VALUE` it may still be a keyword.
    #[inline(always)]
    pub(crate) fn next_key<const NEEDS_VALUE: bool>(&mut self) {
        if NEEDS_VALUE {
            self.next();
        } else {
            self.next_unnamed();
        }
    }

    #[inline(never)]
    fn next_unnamed(&mut self) {
        self.advance(Detail::UNNAMED);
    }

    /// No name is a keyword.
    #[inline(always)]
    pub(crate) fn next_ignoring_keywords<const NEEDS_VALUE: bool>(&mut self) {
        self.next_key::<NEEDS_VALUE>();
        if self.token.kind().is_identifier_name() {
            self.token = self.token.with_kind(TokenKind::Identifier);
        }
    }

    /// What [`Lexer::next`] would have made of a token of [`Lexer::next_key`].
    pub(crate) fn looked_up(&mut self, token: Token) -> Token {
        if token.kind() != TokenKind::Identifier || token.value() != 0 {
            return token;
        }
        let (start, end) = (token.start() as usize, token.end() as usize);
        let name = self.names.intern_source(self.source, start, end);
        self.word(name, start, end, token.lead())
    }

    /// Goes back to a token that has been seen before.
    #[inline(always)]
    pub(crate) fn restore(&mut self, token: Token, previous_end: u32) {
        self.token = token;
        self.previous_end = previous_end;
        self.error = None;
    }

    /// Reads the token that starts at `offset`, as if the one before had ended there.
    pub(crate) fn jump(&mut self, offset: u32) {
        let offset = offset as usize;
        self.set(TokenKind::Semicolon, offset, offset, Detail::NONE);
        self.error = None;
        self.next();
    }

    /// Reads the token once more, by the rules that hold now.
    pub(crate) fn read_again(&mut self) {
        self.error = None;
        let (start, lead) = (self.token.start() as usize, self.token.lead());
        self.scan(start, lead);
    }

    #[inline(always)]
    fn set(&mut self, kind: TokenKind, start: usize, end: usize, detail: Detail) {
        self.token = Token::new(kind, start, end, detail);
    }

    #[cold]
    #[inline(never)]
    fn fail(&mut self, start: usize, lead: Detail, flaw: Flaw) {
        self.error = Some(LexicalError::Verbatim(flaw.message));
        self.set(flaw.kind, start, flaw.end, lead);
    }

    /// Of a literal that is well formed up to `end`.
    fn flaw(&self, end: usize, message: &'static str) -> Flaw {
        let kind = if end >= self.bytes.len() {
            TokenKind::Unterminated
        } else {
            TokenKind::Invalid
        };
        Flaw { kind, end, message }
    }

    #[inline(never)]
    fn move_window(&mut self, offset: usize) {
        self.window
            .fill(self.bytes.get(offset..).unwrap_or_default());
        self.window_start = offset;
    }

    /// The first stop from `offset` on.
    #[inline(always)]
    fn stop(
        &mut self,
        mut offset: usize,
        plane: impl for<'w> Fn(ScannerStops<'w>) -> Stops<'w>,
    ) -> usize {
        loop {
            let mut position = offset.wrapping_sub(self.window_start);
            if position >= ScannerWindow::REACH {
                self.move_window(offset);
                position = 0;
            }
            let run = plane(self.window.stops()).run(position) as usize;
            if run <= EXACT_RUN as usize {
                return offset + run;
            }
            offset += EXACT_RUN as usize;
        }
    }

    /// Where the ASCII letters, digits, `_` and `$` end.
    #[inline(always)]
    pub(crate) fn skip_name(&mut self, offset: usize) -> usize {
        self.stop(offset, |stops| stops.after_name)
    }

    #[inline(always)]
    fn advance(&mut self, lead: Detail) {
        self.previous_end = self.token.end();
        self.scan(self.token.end() as usize, lead);
    }

    #[inline(always)]
    fn scan(&mut self, offset: usize, lead: Detail) {
        match self.bytes.get(offset) {
            Some(&byte) => SCANNERS[usize::from(byte)](self, offset, lead, byte),
            None => self.set(TokenKind::End, self.bytes.len(), self.bytes.len(), lead),
        }
    }

    #[inline(always)]
    fn name(&mut self, start: usize, lead: Detail) {
        let position = start.wrapping_sub(self.window_start);
        if position >= ScannerWindow::REACH {
            return self.any_name(start, lead);
        }
        let length = self.window.stops().after_name.run(position) as usize;
        let chunk = self.source.bytes.get(start..start + size_of::<Chunk>());
        let chunk = match chunk.and_then(|chunk| <&Chunk>::try_from(chunk).ok()) {
            Some(chunk) if length <= LONGEST_SHORT && !chars::continues_name(chunk[length]) => {
                chunk
            }
            _ => return self.any_name(start, lead),
        };
        if lead.contains(Detail::UNNAMED) {
            return self.set(TokenKind::Identifier, start, start + length, lead);
        }
        let key = Key::short(chunk, length);
        match self.names.find_at_once(key) {
            Some((name, kind)) if kind != TokenKind::ReservedInStrictCode => {
                self.set(kind, start, start + length, lead | Detail::value(name));
            }
            _ => self.short_name(key, start, start + length, lead),
        }
    }

    #[inline(always)]
    fn word(&self, name: Name, start: usize, end: usize, detail: Detail) -> Token {
        let kind = match TokenKind::of_name(name) {
            TokenKind::ReservedInStrictCode if !self.is_strict => TokenKind::Identifier,
            kind => kind,
        };
        Token::new(
            kind,
            start,
            end,
            detail | Detail::value(name.index() as u32),
        )
    }
}
