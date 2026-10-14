//! The lexer of `@handlebars/parser` (`src/handlebars.l`): in each state the first rule that matches wins.

use super::Error;
use crate::syntax_error::{Message, Refusal};
use bun_collections::ByteSet;
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

/// The ASCII bytes that `[^\s!"#%-,\.\/;->@\[-\^`\{-~]` matches.
const ASCII_OF_ID: ByteSet = ByteSet::of(b"$-:?_\x7F")
    .with_range(0x00, 0x08)
    .with_range(0x0E, 0x1F)
    .with_range(b'0', b'9')
    .with_range(b'A', b'Z')
    .with_range(b'a', b'z');

/// How many bytes at the start of `text` can be in an `ID`.
pub(crate) fn id_len(text: &[u8]) -> usize {
    let mut at = 0;
    loop {
        at += text[at..]
            .iter()
            .take_while(|byte| ASCII_OF_ID.has(**byte))
            .count();
        match text.get(at) {
            Some(0x80..) if strings::js_whitespace_len(&text[at..]) == 0 => at += 1,
            _ => return at,
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
    /// For the highlighter: nothing is an error.
    is_tolerant: bool,
    /// For the highlighter: from `at` on no `"`, `'` or `]` closes anything.
    has_no_closing: [bool; 3],
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
        if self.is_tolerant {
            return true;
        }
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

    /// What starts here isn't closed. For the highlighter it runs to the end of the text.
    #[cold]
    fn unclosed(&self, message: Message) -> Result<usize, Error> {
        match self.is_tolerant {
            true => Ok(self.text.len() - self.at),
            false => Err(self.error(message)),
        }
    }

    /// How long the string or the `[a]` is that starts here and ends with `close`.
    fn delimited(&mut self, close: u8, message: Message) -> Result<usize, Error> {
        let rest = &self.text[self.at..];
        if !self.is_tolerant {
            return delimited_len(rest, close).ok_or_else(|| self.error(message));
        }
        let has_no_closing = &mut self.has_no_closing[match close {
            b'"' => 0,
            b'\'' => 1,
            _ => 2,
        }];
        // Not one that ends with `\"` for want of another quote: the rest of it may be on its way.
        let closed = (!*has_no_closing)
            .then(|| delimited_len(rest, close))
            .flatten()
            .filter(|len| rest[len - 2] != b'\\');
        *has_no_closing = closed.is_none();
        // What isn't closed ends before the `}}` on its line, or else with the line.
        Ok(closed.unwrap_or_else(|| {
            let line = &rest[..strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())];
            strings::index_of(line, b"}}").unwrap_or(line.len())
        }))
    }

    /// For the highlighter: goes on behind `len` bytes that can be in a name, with something behind them that cannot follow
    /// one.
    #[cold]
    fn pass_unexpected(&mut self, len: usize) {
        let rest = &self.text[self.at..];
        match (&rest[..len], rest) {
            (b"true" | b"false", _) => self.token(TokenKind::Boolean, len),
            (b"undefined", _) => self.token(TokenKind::Undefined, len),
            (b"null", _) => self.token(TokenKind::Null, len),
            ([b'0'..=b'9', digits @ ..], _) if digits.iter().all(u8::is_ascii_digit) => {
                self.token(TokenKind::Number, len);
            }
            ([_, ..], _) => self.token(TokenKind::Id, len),
            // The mustache isn't closed: `{{a <p>`.
            (_, [b'<', b'a'..=b'z' | b'A'..=b'Z' | b'/' | b'!', ..]) => self.pop_state(),
            _ => self.at += 1,
        }
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
            let Some(dashes) = self.find(b"--", from) else {
                let len = self.unclosed(Message::UnclosedComment)?;
                self.pop_state();
                self.token(TokenKind::Comment, len);
                return Ok(());
            };
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
        let end = match self.find(b"{{{{", self.at + 1) {
            Some(end) => end,
            None => self.at + self.unclosed(Message::UnclosedBlock)?,
        };
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
            let from = from + crate::text::leading_white_space_len(&rest[from..]);
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
                let len = match strings::index_of(&rest[at + 1..], b"}}") {
                    Some(end) => at + 1 + end + 2,
                    None => self.unclosed(Message::UnclosedComment)?,
                };
                self.pop_state();
                self.token(TokenKind::Comment, len);
            }
            Some(b'*') => self.token(TokenKind::Open, at + 1),
            _ => {
                let keyword = at + crate::text::leading_white_space_len(&rest[at..]);
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
                let len = self.delimited(b']', Message::UnclosedBracket)?;
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
                let len = self.delimited(quote, Message::UnclosedString)?;
                self.token(TokenKind::String, len);
            }
            b'@' => self.token(TokenKind::Data, 1),
            b'|' => self.token(TokenKind::CloseBlockParams, 1),
            _ if strings::js_whitespace_len(rest) > 0 => {
                self.at += crate::text::leading_white_space_len(rest)
            }
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
                    let blanks = crate::text::leading_white_space_len(after);
                    if blanks > 0 && after.get(blanks) == Some(&b'|') {
                        self.token(TokenKind::OpenBlockParams, 2 + blanks + 1);
                        return Ok(());
                    }
                }
                let len = id_len(rest);
                if len == 0 || !is_lookahead(&rest[len..]) {
                    if self.is_tolerant {
                        self.pass_unexpected(len);
                        return Ok(());
                    }
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

/// Writes the tokens of `text` to `tokens`, which is empty. The last is `Eof`.
pub(crate) fn lex(text: &[u8], tokens: &mut Vec<Token>, refusal: &Refusal) -> Result<(), Error> {
    lex_from(text, 0, tokens, refusal, false)
}

/// The same for the highlighter, from `start` on. What is wrong is passed over, and what isn't closed ends somewhere.
pub(crate) fn lex_tolerantly(text: &[u8], start: usize, tokens: &mut Vec<Token>) {
    _ = lex_from(text, start, tokens, &Refusal::default(), true);
}

fn lex_from(
    text: &[u8],
    start: usize,
    tokens: &mut Vec<Token>,
    refusal: &Refusal,
    is_tolerant: bool,
) -> Result<(), Error> {
    let mut lexer = Lexer {
        text,
        refusal,
        at: start,
        states: vec![State::Initial],
        tokens,
        next_nul: None,
        is_tolerant,
        has_no_closing: [false; 3],
    };
    loop {
        let state = lexer.states.last().copied().unwrap_or(State::Initial);
        if lexer.at >= text.len() {
            // Only there is the end of the text something that the grammar can go on with.
            if state != State::Initial && !is_tolerant {
                return Err(lexer.error(Message::UnexpectedEnd));
            }
            lexer.token(TokenKind::Eof, 0);
            return Ok(());
        }
        match state {
            State::Initial => lexer.initial()?,
            State::Mu => lexer.mustache()?,
            State::Emu => lexer.escaped_mustache()?,
            State::Com => lexer.comment()?,
            State::Raw => lexer.raw()?,
        }
    }
}
