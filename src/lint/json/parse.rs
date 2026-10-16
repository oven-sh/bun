//! Momoa's `parse`: tokens to tree. It does not call itself, so nesting is only limited by memory.

use crate::momoa::{self, Failure, Token, Type};
use crate::tree::{Entry, NodeKind, Tree};
use crate::{Mode, Options};
use bun_alloc::Arena;
use bun_core::strings;
use bun_lint::languages::{Comment, LineBreaks, SyntaxError};
use bun_lint::span::Span;
use bun_parsers::json5::{SourceToken, SourceTokenKind, SourceTokens};

/// Momoa's `Tokenizer`
struct Reader<'a> {
    text: &'a [u8],
    mode: Mode,
    tokens: SourceTokens<'a>,
    memory: &'a Arena,
    /// `tokenizer.token`: the last token or comment. At the end of the text it stays.
    last: Option<Token<'a>>,
    comments: Vec<Comment>,
}

/// `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`
fn is_number_of_json(text: &[u8]) -> bool {
    let digits = |text: &[u8]| text.iter().take_while(|it| it.is_ascii_digit()).count();
    let rest = text.strip_prefix(b"-").unwrap_or(text);
    let rest = match (rest, digits(rest)) {
        (_, 0) => return false,
        ([b'0', rest @ ..], _) => rest,
        (rest, count) => &rest[count..],
    };
    let rest = match rest {
        [b'.', fraction @ ..] => match digits(fraction) {
            0 => return false,
            count => &fraction[count..],
        },
        rest => rest,
    };
    match rest {
        [] => true,
        [b'e' | b'E', b'+' | b'-', exponent @ ..] | [b'e' | b'E', exponent @ ..] => {
            !exponent.is_empty() && digits(exponent) == exponent.len()
        }
        _ => false,
    }
}

/// Whether JSON has every escape sequence in `string`, all of which JSON5 has.
fn has_only_escapes_of_json(string: &[u8]) -> bool {
    let mut rest = string;
    while let Some(at) = strings::index_of_char_usize(rest, b'\\') {
        let Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' | b'u') = rest.get(at + 1)
        else {
            return false;
        };
        rest = &rest[at + 2..];
    }
    true
}

impl<'a> Reader<'a> {
    /// What Momoa makes of `token`, which follows what ended at `from`, if that is plain to see. Everything else is left to
    /// [`momoa::next`].
    #[inline]
    fn plain(&self, from: usize, token: &SourceToken<'a>) -> Option<Token<'a>> {
        let is_space = |it: &u8| matches!(it, b' ' | b'\t' | b'\n' | b'\r');
        let (gap, written) = (
            self.text.get(from..token.start)?,
            self.text.get(token.start..token.end)?,
        );
        if !gap.iter().all(is_space) {
            return None;
        }
        let is_json5 = self.mode == Mode::Json5;
        let kind = match token.kind {
            SourceTokenKind::LeftBrace => Type::LBrace,
            SourceTokenKind::RightBrace => Type::RBrace,
            SourceTokenKind::LeftBracket => Type::LBracket,
            SourceTokenKind::RightBracket => Type::RBracket,
            SourceTokenKind::Colon => Type::Colon,
            SourceTokenKind::Comma => Type::Comma,
            SourceTokenKind::Boolean => Type::Boolean,
            SourceTokenKind::Null => Type::Null,
            SourceTokenKind::Number if is_number_of_json(written) => Type::Number,
            SourceTokenKind::String
                if is_json5
                    || written.starts_with(b"\"")
                        && (token.value.len() + 2 == written.len()
                            || has_only_escapes_of_json(written)) =>
            {
                Type::String
            }
            SourceTokenKind::Identifier
                if is_json5 && written.is_ascii() && token.value.len() == written.len() =>
            {
                match written {
                    b"NaN" | b"Infinity" => Type::Number,
                    _ => Type::Identifier,
                }
            }
            // For Bun U+2028 and U+2029 end the line too.
            SourceTokenKind::LineComment
                if self.mode != Mode::Json
                    && matches!(self.text.get(token.end), None | Some(b'\n' | b'\r')) =>
            {
                Type::LineComment
            }
            SourceTokenKind::BlockComment if self.mode != Mode::Json => Type::BlockComment,
            _ => return None,
        };
        Some(Token {
            kind,
            start: token.start,
            end: token.end,
            value: token.value,
        })
    }

    /// `tokenizer.next()`
    fn read(&mut self) -> Result<Option<Token<'a>>, Failure> {
        let from = self.tokens.position();
        let plain = match self.tokens.next() {
            Ok(Some(token)) => self.plain(from, &token).map(Some),
            Ok(None) => (self.text.get(from..))
                .filter(|rest| rest.trim_ascii().is_empty() && !strings::contains_char(rest, 0x0C))
                .map(|_| None),
            Err(_) => None,
        };
        let token = match plain {
            Some(token) => token,
            None => {
                let token = momoa::next(self.text, from, self.mode, self.memory)?;
                self.tokens.seek(token.map_or(self.text.len(), |it| it.end));
                token
            }
        };
        self.last = token.or(self.last);
        Ok(token)
    }

    /// `next()` of `parse`, which passes over the comments.
    fn next(&mut self) -> Result<Option<Token<'a>>, Failure> {
        loop {
            let token = self.read()?;
            let delimiters = match token.map(|it| it.kind) {
                Some(Type::LineComment) => (2, 0),
                Some(Type::BlockComment) => (2, 2),
                _ => return Ok(token),
            };
            if let Some(token) = token {
                let span = Span::new(token.start as u32, token.end as u32);
                let value = span.shrink(delimiters.0, delimiters.1);
                self.comments.push(Comment { span, value });
            }
        }
    }

    /// `new UnexpectedToken(tokenizer.token)`
    fn unexpected_token(&self) -> Failure {
        match self.last {
            Some(token) => Failure {
                message: format!("Unexpected token {} found.", token.kind.name()).into(),
                at: token.start,
                columns: 0,
            },
            // There is always one when Momoa asks.
            None => Failure::end_of_input(0, 0),
        }
    }
}

/// What is read next.
enum State<'a> {
    /// `parseValue(token)`
    Value(Option<Token<'a>>),
    /// `parseProperty(token)`
    Property(Option<Token<'a>>),
    /// The value that ends at this place is complete.
    AfterValue(usize),
}

fn run(reader: &mut Reader, tree: &mut Tree, options: Options) -> Result<(), Failure> {
    let is_json5 = options.mode == Mode::Json5;
    // The objects and arrays whose end has not been seen.
    let mut open: Vec<u32> = Vec::new();
    let mut state = State::Value(reader.next()?);
    loop {
        state = match state {
            State::Value(None) => return Err(Failure::end_of_input(0, 0)),
            State::Value(Some(token)) => {
                let written = reader.text.get(token.start..token.end).unwrap_or_default();
                let kind = match token.kind {
                    Type::String => NodeKind::String,
                    Type::Boolean => NodeKind::Boolean,
                    Type::Null => NodeKind::Null,
                    Type::Number => match written {
                        _ if !is_json5 => NodeKind::Number,
                        [b'+' | b'-', b'N', b'a', b'N'] | b"NaN" => NodeKind::NaN,
                        [b'+' | b'-', rest @ ..] if rest == b"Infinity" => NodeKind::Infinity,
                        b"Infinity" => NodeKind::Infinity,
                        _ => NodeKind::Number,
                    },
                    Type::LBrace => NodeKind::Object,
                    Type::LBracket => NodeKind::Array,
                    _ => return Err(reader.unexpected_token()),
                };
                let index = tree.nodes.len() as u32;
                tree.nodes.push(Entry {
                    start: token.start as u32,
                    end: token.end as u32,
                    next: index + 1,
                    kind,
                });
                let end = match kind {
                    NodeKind::Object => Type::RBrace,
                    NodeKind::Array => Type::RBracket,
                    _ => {
                        state = State::AfterValue(token.end);
                        continue;
                    }
                };
                open.push(index);
                match reader.next()? {
                    Some(token) if token.kind == end => close(tree, &mut open, token),
                    token if kind == NodeKind::Object => State::Property(token),
                    token => State::Value(token),
                }
            }
            State::Property(token) => {
                let name = token.filter(|it| match it.kind {
                    Type::String => true,
                    Type::Identifier => is_json5,
                    // `NaN` and `Infinity`, and what else starts like neither a sign nor a digit.
                    Type::Number => {
                        let first = reader.text.get(it.start);
                        is_json5 && !matches!(first, Some(b'+' | b'-' | b'0'..=b'9'))
                    }
                    _ => false,
                });
                let Some(name) = name else {
                    return Err(reader.unexpected_token());
                };
                let index = tree.nodes.len() as u32;
                tree.nodes.push(Entry {
                    start: name.start as u32,
                    end: name.end as u32,
                    next: index + 1,
                    kind: match name.kind {
                        Type::String => NodeKind::String,
                        _ => NodeKind::Identifier,
                    },
                });
                let written = reader.text.get(name.start..name.end).unwrap_or_default();
                let stands_for: &[u8] = match name.kind {
                    Type::Number if strings::contains(written, b"NaN") => b"NaN",
                    Type::Number => b"Infinity",
                    _ => name.value,
                };
                let quotes = if name.kind == Type::String { 2 } else { 0 };
                if stands_for.len() + quotes != written.len() {
                    let start = tree.texts.len() as u32;
                    tree.texts.extend_from_slice(stands_for);
                    let span = Span::new(start, tree.texts.len() as u32);
                    tree.unescaped.push((index, span));
                }
                if reader.next()?.map(|it| it.kind) != Some(Type::Colon) {
                    return Err(reader.unexpected_token());
                }
                State::Value(reader.next()?)
            }
            State::AfterValue(end) => {
                let Some(&container) = open.last() else {
                    return match reader.next()? {
                        Some(_) => Err(reader.unexpected_token()),
                        None => Ok(()),
                    };
                };
                let is_object = (tree.nodes.get(container as usize))
                    .is_some_and(|it| it.kind == NodeKind::Object);
                let closing = if is_object {
                    Type::RBrace
                } else {
                    Type::RBracket
                };
                match reader.next()? {
                    None if is_object => return Err(Failure::end_of_input(end, 0)),
                    Some(token) if token.kind == Type::Comma => match reader.next()? {
                        Some(token) if options.allows_trailing_commas && token.kind == closing => {
                            close(tree, &mut open, token)
                        }
                        None => return Err(reader.unexpected_token()),
                        token if is_object => State::Property(token),
                        token => State::Value(token),
                    },
                    Some(token) if token.kind == closing => close(tree, &mut open, token),
                    _ => return Err(reader.unexpected_token()),
                }
            }
        };
    }
}

/// `token` ends the innermost object or array.
fn close<'a>(tree: &mut Tree, open: &mut Vec<u32>, token: Token<'a>) -> State<'a> {
    let next = tree.nodes.len() as u32;
    if let Some(node) = open.pop().and_then(|it| tree.nodes.get_mut(it as usize)) {
        node.end = token.end as u32;
        node.next = next;
    }
    State::AfterValue(token.end)
}

pub(crate) fn parse(text: &[u8], options: Options) -> Result<(Tree, Vec<Comment>), SyntaxError> {
    let memory = Arena::new();
    let Some(tokens) = SourceTokens::new(text, &memory) else {
        return Err(SyntaxError {
            message: b"The file is too large.".to_vec(),
            line: 1,
            column: 1,
        });
    };
    let mut reader = Reader {
        text,
        mode: options.mode,
        tokens,
        memory: &memory,
        last: None,
        comments: Vec::new(),
    };
    let mut tree = Tree::default();
    // A node for every six bytes is what minified JSON has.
    tree.nodes.reserve(text.len() / 6);
    match run(&mut reader, &mut tree, options) {
        Ok(()) => Ok((tree, reader.comments)),
        Err(failure) => {
            let at = LineBreaks::Newlines.position(text, failure.at);
            Err(SyntaxError {
                message: failure.message,
                line: at.line,
                column: (at.column + 1).saturating_add_signed(failure.columns),
            })
        }
    }
}
