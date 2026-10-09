//! The lexer of `@handlebars/parser` (`src/handlebars.l`): in each state the first rule that matches wins.

use super::Error;
use super::positions::Positions;
use crate::syntax_error::{Message, Refusal};
use bun_core::strings;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum TokenKind {
    /// From `start` to `end` is its value: without the backslash that escapes what follows.
    Content,
    Comment,
    OpenSexpr,
    CloseSexpr,
    OpenRawBlock,
    CloseRawBlock,
    EndRawBlock,
    OpenPartial,
    OpenPartialBlock,
    OpenBlock,
    OpenEndBlock,
    Inverse,
    OpenInverse,
    OpenInverseChain,
    OpenUnescaped,
    Open,
    Equals,
    Id,
    Sep,
    PrivateSep,
    CloseUnescaped,
    Close,
    String,
    Data,
    Boolean,
    Undefined,
    Null,
    Number,
    OpenBlockParams,
    CloseBlockParams,
    Eof,
}

#[derive(Copy, Clone)]
pub(crate) struct Token {
    pub(crate) kind: TokenKind,
    pub(crate) start: u32,
    pub(crate) end: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum State {
    Initial,
    Mu,
    Emu,
    Com,
    Raw,
}

/// Which bytes are ASCII that `[^\s!"#%-,\.\/;->@\[-\^`\{-~]` matches.
const IS_ASCII_OF_ID: [bool; 256] = {
    let mut table = [false; 256];
    let mut byte = 0;
    while byte < 0x80 {
        table[byte] = !matches!(
            byte as u8,
            b'\t' | b'\n' | 0x0B | 0x0C | b'\r' | b' ' | b'!' | b'"' | b'#' | b'%'..=b',' | b'.' | b'/' | b';'..=b'>' | b'@' | b'['..=b'^' | b'`' | b'{'..=b'~'
        );
        byte += 1;
    }
    table
};

/// How many bytes at the start of `text` can be in an `ID`.
pub(crate) fn id_len(text: &[u8]) -> usize {
    let mut at = 0;
    loop {
        at += text[at..]
            .iter()
            .take_while(|byte| IS_ASCII_OF_ID[**byte as usize])
            .count();
        match text.get(at) {
            Some(0x80..) if strings::js_whitespace_len(&text[at..]) == 0 => at += 1,
            _ => return at,
        }
    }
}

fn white_space_run(text: &[u8]) -> usize {
    let mut at = 0;
    loop {
        match strings::js_whitespace_len(&text[at..]) {
            0 => return at,
            len => at += len,
        }
    }
}

/// `LOOKAHEAD`: `[=~}\s\/.)\]|]`
fn is_lookahead(rest: &[u8]) -> bool {
    matches!(
        rest.first(),
        Some(b'=' | b'~' | b'}' | b'/' | b'.' | b')' | b']' | b'|')
    ) || strings::js_whitespace_len(rest) > 0
}

/// `LITERAL_LOOKAHEAD`: `[~}\s)\]]`
fn is_literal_lookahead(rest: &[u8]) -> bool {
    matches!(rest.first(), Some(b'~' | b'}' | b')' | b']')) || strings::js_whitespace_len(rest) > 0
}

/// `open(\\close|[^close])*close`, where `text` starts with the opening character: how long the match is. It ends
/// at the first `close` without a backslash before it. If there is none, at the last one with a backslash.
fn delimited_len(text: &[u8], close: u8) -> Option<usize> {
    let mut at = 1;
    let mut last_escaped = None;
    while let Some(found) = text
        .get(at..)
        .and_then(|rest| strings::index_of_char_usize(rest, close))
    {
        at += found + 1;
        if text[at - 2] != b'\\' {
            return Some(at);
        }
        last_escaped = Some(at);
    }
    last_escaped
}

struct Lexer<'a> {
    text: &'a [u8],
    refusal: &'a Refusal,
    at: usize,
    states: Vec<State>,
    tokens: &'a mut Vec<Token>,
    /// Where the next `\0` at or behind `at` is, if that is known.
    next_nul: Option<usize>,
}

impl Lexer<'_> {
    fn push(&mut self, kind: TokenKind, start: usize, end: usize) {
        self.tokens.push(Token {
            kind,
            start: start as u32,
            end: end as u32,
        });
    }

    /// A token of `len` bytes.
    fn token(&mut self, kind: TokenKind, len: usize) {
        self.push(kind, self.at, self.at + len);
        self.at += len;
    }

    fn pop_state(&mut self) {
        if self.states.len() > 1 {
            self.states.pop();
        }
    }

    /// `[^\x00]` matches all of `text[at..end]`.
    fn is_without_nul(&mut self, end: usize) -> bool {
        let next = match self.next_nul {
            Some(next) if next >= self.at => next,
            _ => strings::index_of_char_usize(&self.text[self.at..], 0)
                .map_or(self.text.len(), |found| self.at + found),
        };
        self.next_nul = Some(next);
        next >= end
    }

    fn find(&self, needle: &[u8], from: usize) -> Option<usize> {
        Some(from + strings::index_of(self.text.get(from..)?, needle)?)
    }

    /// `message`, where the lexer is.
    #[cold]
    fn error(&self, message: Message) -> Error {
        Error::Syntax(self.refusal.note(message, self.at as u32))
    }

    fn initial(&mut self) -> Result<(), Error> {
        let at = self.at;
        let Some(mustache) = self.find(b"{{", at) else {
            if !self.is_without_nul(self.text.len()) {
                return Err(self.error(Message::UnexpectedCharacter));
            }
            self.token(TokenKind::Content, self.text.len() - at);
            return Ok(());
        };
        if !self.is_without_nul(mustache) {
            return Err(self.error(Message::UnexpectedCharacter));
        }
        let content = &self.text[at..mustache];
        let (end, state) = if content.ends_with(b"\\\\") {
            (mustache - 1, State::Mu)
        } else if content.ends_with(b"\\") {
            (mustache - 1, State::Emu)
        } else {
            (mustache, State::Mu)
        };
        self.states.push(state);
        if end > at {
            self.push(TokenKind::Content, at, end);
        }
        self.at = mustache;
        Ok(())
    }

    /// `[^\x00]{2,}?/("{{"|"\\{{"|"\\\\{{"|<<EOF>>)`
    fn escaped_mustache(&mut self) -> Result<(), Error> {
        let first = self.at + 2;
        let end = match self.find(b"{{", first) {
            None => self.text.len(),
            Some(mustache) => {
                let backslashes = self.text[first..mustache]
                    .iter()
                    .rev()
                    .take(2)
                    .take_while(|byte| **byte == b'\\')
                    .count();
                mustache - backslashes
            }
        };
        if !self.is_without_nul(end) {
            return Err(self.error(Message::UnexpectedCharacter));
        }
        self.pop_state();
        self.token(TokenKind::Content, end - self.at);
        Ok(())
    }

    /// `[\s\S]*?"--"{RIGHT_STRIP}?"}}"`
    fn comment(&mut self) -> Result<(), Error> {
        let mut from = self.at;
        loop {
            let dashes = self
                .find(b"--", from)
                .ok_or_else(|| self.error(Message::UnclosedComment))?;
            let rest = &self.text[dashes + 2..];
            let rest_len = rest.len();
            if let Some(rest) = rest.strip_prefix(b"~").unwrap_or(rest).strip_prefix(b"}}") {
                self.pop_state();
                self.token(
                    TokenKind::Comment,
                    dashes + 2 + (rest_len - rest.len()) - self.at,
                );
                return Ok(());
            }
            from = dashes + 1;
        }
    }

    fn raw(&mut self) -> Result<(), Error> {
        let rest = &self.text[self.at..];
        if let Some(after) = rest.strip_prefix(b"{{{{") {
            match after {
                [] => {}
                [b'/', name @ ..] => {
                    let len = id_len(name);
                    if len > 0 && name[len..].starts_with(b"}}}}") {
                        self.pop_state();
                        let is_nested = self.states.last() == Some(&State::Raw);
                        self.token(
                            if is_nested {
                                TokenKind::Content
                            } else {
                                TokenKind::EndRawBlock
                            },
                            5 + len + 4,
                        );
                        return Ok(());
                    }
                }
                _ => {
                    self.states.push(State::Raw);
                    self.token(TokenKind::Content, 4);
                    return Ok(());
                }
            }
        }
        let end = self
            .find(b"{{{{", self.at + 1)
            .ok_or_else(|| self.error(Message::UnclosedBlock))?;
        if !self.is_without_nul(end) {
            return Err(self.error(Message::UnexpectedCharacter));
        }
        self.token(TokenKind::Content, end - self.at);
        Ok(())
    }

    /// What starts with `{{`.
    fn open(&mut self) -> Result<(), Error> {
        let rest = &self.text[self.at..];
        if rest.starts_with(b"{{{{") {
            self.token(TokenKind::OpenRawBlock, 4);
            return Ok(());
        }
        let at = if rest.get(2) == Some(&b'~') { 3 } else { 2 };
        // `\s*{RIGHT_STRIP}?"}}"`
        let close_len = |from: usize| {
            let from = from + white_space_run(&rest[from..]);
            let from = if rest.get(from) == Some(&b'~') {
                from + 1
            } else {
                from
            };
            rest[from..].starts_with(b"}}").then_some(from + 2)
        };
        match rest.get(at) {
            Some(b'>') => self.token(TokenKind::OpenPartial, at + 1),
            Some(b'#') => match rest.get(at + 1) {
                Some(b'>') => self.token(TokenKind::OpenPartialBlock, at + 2),
                Some(b'*') => self.token(TokenKind::OpenBlock, at + 2),
                _ => self.token(TokenKind::OpenBlock, at + 1),
            },
            Some(b'/') => self.token(TokenKind::OpenEndBlock, at + 1),
            Some(b'^') => match close_len(at + 1) {
                Some(len) => {
                    self.pop_state();
                    self.token(TokenKind::Inverse, len);
                }
                None => self.token(TokenKind::OpenInverse, at + 1),
            },
            Some(b'{') => self.token(TokenKind::OpenUnescaped, at + 1),
            Some(b'&') => self.token(TokenKind::Open, at + 1),
            Some(b'!') if rest[at..].starts_with(b"!--") => {
                self.pop_state();
                self.states.push(State::Com);
            }
            Some(b'!') => {
                let end = strings::index_of(&rest[at + 1..], b"}}")
                    .ok_or_else(|| self.error(Message::UnclosedComment))?;
                self.pop_state();
                self.token(TokenKind::Comment, at + 1 + end + 2);
            }
            Some(b'*') => self.token(TokenKind::Open, at + 1),
            _ => {
                let keyword = at + white_space_run(&rest[at..]);
                let after = keyword + 4;
                if !rest[keyword..].starts_with(b"else") {
                    self.token(TokenKind::Open, at);
                } else if let Some(len) = close_len(after) {
                    self.pop_state();
                    self.token(TokenKind::Inverse, len);
                } else if rest
                    .get(after)
                    .is_some_and(|byte| byte.is_ascii_alphanumeric() || *byte == b'_')
                {
                    self.token(TokenKind::Open, at);
                } else {
                    self.token(TokenKind::OpenInverseChain, after);
                }
            }
        }
        Ok(())
    }

    fn mustache(&mut self) -> Result<(), Error> {
        let rest = &self.text[self.at..];
        let followed_by = |word: &[u8]| rest.strip_prefix(word).is_some_and(is_literal_lookahead);
        match *rest
            .first()
            .ok_or_else(|| self.error(Message::UnexpectedEnd))?
        {
            b'(' => self.token(TokenKind::OpenSexpr, 1),
            b')' => self.token(TokenKind::CloseSexpr, 1),
            b'[' => {
                let len = delimited_len(rest, b']')
                    .ok_or_else(|| self.error(Message::UnclosedBracket))?;
                self.token(TokenKind::Id, len);
            }
            b'{' if rest.starts_with(b"{{") => return self.open(),
            b'}' if rest.starts_with(b"}}}}") => {
                self.pop_state();
                self.states.push(State::Raw);
                self.token(TokenKind::CloseRawBlock, 4);
            }
            b'}' if rest.starts_with(b"}}}") || rest.starts_with(b"}~}}") => {
                self.pop_state();
                self.token(
                    TokenKind::CloseUnescaped,
                    if rest[1] == b'~' { 4 } else { 3 },
                );
            }
            b'}' if rest.starts_with(b"}}") => {
                self.pop_state();
                self.token(TokenKind::Close, 2);
            }
            b'~' if rest.starts_with(b"~}}") => {
                self.pop_state();
                self.token(TokenKind::Close, 3);
            }
            b'=' => self.token(TokenKind::Equals, 1),
            b'.' if rest.starts_with(b"..") => self.token(TokenKind::Id, 2),
            b'.' if is_lookahead(&rest[1..]) => self.token(TokenKind::Id, 1),
            b'.' if rest.starts_with(b".#") => self.token(TokenKind::PrivateSep, 2),
            b'.' | b'/' => self.token(TokenKind::Sep, 1),
            quote @ (b'"' | b'\'') => {
                let len = delimited_len(rest, quote)
                    .ok_or_else(|| self.error(Message::UnclosedString))?;
                self.token(TokenKind::String, len);
            }
            b'@' => self.token(TokenKind::Data, 1),
            b'|' => self.token(TokenKind::CloseBlockParams, 1),
            _ if strings::js_whitespace_len(rest) > 0 => self.at += white_space_run(rest),
            _ if followed_by(b"true") => self.token(TokenKind::Boolean, 4),
            _ if followed_by(b"false") => self.token(TokenKind::Boolean, 5),
            _ if followed_by(b"undefined") => self.token(TokenKind::Undefined, 9),
            _ if followed_by(b"null") => self.token(TokenKind::Null, 4),
            _ => {
                if let Some(len) = number_len(rest) {
                    self.token(TokenKind::Number, len);
                    return Ok(());
                }
                if let Some(after) = rest.strip_prefix(b"as") {
                    let blanks = white_space_run(after);
                    if blanks > 0 && after.get(blanks) == Some(&b'|') {
                        self.token(TokenKind::OpenBlockParams, 2 + blanks + 1);
                        return Ok(());
                    }
                }
                let len = id_len(rest);
                if len == 0 || !is_lookahead(&rest[len..]) {
                    let message = match len == rest.len() {
                        true => Message::UnexpectedEnd,
                        false => Message::UnexpectedCharacter,
                    };
                    return Err(Error::Syntax(
                        self.refusal.note(message, (self.at + len) as u32),
                    ));
                }
                self.token(TokenKind::Id, len);
            }
        }
        Ok(())
    }
}

/// `\-?[0-9]+(?:\.[0-9]+)?/{LITERAL_LOOKAHEAD}`
fn number_len(text: &[u8]) -> Option<usize> {
    let digits = |from: usize| {
        text[from..]
            .iter()
            .take_while(|byte| byte.is_ascii_digit())
            .count()
    };
    let sign = usize::from(text.first() == Some(&b'-'));
    let whole = digits(sign);
    if whole == 0 {
        return None;
    }
    let mut len = sign + whole;
    if text.get(len) == Some(&b'.') {
        match digits(len + 1) {
            0 => return None,
            fraction => len += 1 + fraction,
        }
    }
    is_literal_lookahead(&text[len..]).then_some(len)
}

/// Writes the tokens of `text` to `tokens`, which is empty, and where the parser takes them to be to `positions`. The
/// last is `Eof`.
pub(crate) fn lex(
    text: &[u8],
    tokens: &mut Vec<Token>,
    positions: &mut Positions,
    refusal: &Refusal,
) -> Result<(), Error> {
    let counts_wrongly = Positions::can_be_wrong(text);
    let mut lexer = Lexer {
        text,
        refusal,
        at: 0,
        states: vec![State::Initial],
        tokens,
        next_nul: None,
    };
    loop {
        let state = lexer.states.last().copied().unwrap_or(State::Initial);
        if lexer.at >= text.len() {
            // Only there is the end of the text something that the grammar can go on with.
            if state != State::Initial {
                return Err(lexer.error(Message::UnexpectedEnd));
            }
            lexer.token(TokenKind::Eof, 0);
            positions.finish(text);
            return Ok(());
        }
        let start = lexer.at;
        match state {
            State::Initial => lexer.initial()?,
            State::Mu => lexer.mustache()?,
            State::Emu => lexer.escaped_mustache()?,
            State::Com => lexer.comment()?,
            State::Raw => lexer.raw()?,
        }
        if counts_wrongly {
            positions.add_match(text, start, lexer.at);
        }
    }
}
