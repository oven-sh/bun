//! Builds the tree from tokens. The tokens come from Bun's JSON5 scanner, and each one is checked for JSON5-only
//! syntax, which JSON and JSONC reject. Nothing here is recursive, so nesting depth is only limited by memory.

use crate::tree::{Entry, NodeKind, Tree};
use crate::{Mode, Options};
use bun_alloc::Arena;
use bun_core::strings;
use bun_lint::languages::{Comment, LineBreaks, SyntaxError};
use bun_lint::span::Span;
use bun_parsers::json5::{Error, SourceToken as Token, SourceTokenKind as Kind, SourceTokens};

/// A syntax error: its offset and its message. `JSON5` in the message is a placeholder for the name of the language.
type ParseError = (usize, &'static [u8]);

/// Uses the message of Bun's JSON5 parser.
fn parse_error(error: Error) -> ParseError {
    error.describe().unwrap_or((0, b"Out of memory"))
}

struct Reader<'a> {
    text: &'a [u8],
    mode: Mode,
    tokens: SourceTokens<'a>,
    comments: Vec<Comment>,
}

/// Returns true if `text`, which is a valid JSON5 number, matches `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`.
fn is_json_number(text: &[u8]) -> bool {
    let unsigned = text.strip_prefix(b"-").unwrap_or(text);
    let after_point = strings::index_of_char_usize(unsigned, b'.').map(|at| unsigned.get(at + 1));
    matches!(
        unsigned,
        [b'0'..=b'9'] | [b'0'..=b'9', b'0'..=b'9' | b'.' | b'e' | b'E', ..]
    ) && after_point.is_none_or(|it| it.is_some_and(u8::is_ascii_digit))
}

/// The offset of the first escape sequence in `string` that's valid in JSON5 but not in JSON.
fn first_json5_only_escape(string: &[u8]) -> Option<usize> {
    let mut from = 0;
    while let Some(found) = strings::index_of_char_usize(string.get(from..)?, b'\\') {
        let at = from + found;
        let Some(b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' | b'u') =
            string.get(at + 1)
        else {
            return Some(at);
        };
        from = at + 2;
    }
    None
}

impl<'a> Reader<'a> {
    /// The error that JSON and JSONC give for `token`, or for the text before it.
    fn json5_only_error(&self, token: Option<&Token>) -> Option<ParseError> {
        if let Some(at) = self.tokens.not_in_json() {
            return Some(match token.is_some_and(|it| it.start < at) {
                true => (at, b"Control characters in strings must be escaped"),
                false => parse_error(Error::UnexpectedCharacter { pos: at }),
            });
        }
        let token = token?;
        let source_text = self.text.get(token.start..token.end)?;
        let has_escapes = token.value.len() + 2 != source_text.len();
        match token.kind {
            Kind::LineComment | Kind::BlockComment if self.mode == Mode::Json => {
                Some((token.start, b"Comments are not allowed in JSON5"))
            }
            Kind::String if source_text.starts_with(b"'") => {
                Some((token.start, b"Strings must be in double quotes"))
            }
            Kind::String if has_escapes => first_json5_only_escape(source_text)
                .map(|at| (token.start + at, &b"Invalid escape sequence"[..])),
            Kind::Number if !is_json_number(source_text) => {
                Some(parse_error(Error::InvalidNumber { pos: token.start }))
            }
            _ => None,
        }
    }

    /// The next token that isn't a comment.
    fn next(&mut self) -> Result<Option<Token<'a>>, ParseError> {
        loop {
            let token = self.tokens.next().map_err(parse_error)?;
            if self.mode != Mode::Json5
                && let Some(parse_error) = self.json5_only_error(token.as_ref())
            {
                return Err(parse_error);
            }
            let delimiters = match token.map(|it| it.kind) {
                Some(Kind::LineComment) => (2, 0),
                Some(Kind::BlockComment) => (2, 2),
                _ => return Ok(token),
            };
            if let Some(token) = token {
                let span = Span::new(token.start as u32, token.end as u32);
                let value = span.shrink(delimiters.0, delimiters.1);
                self.comments.push(Comment { span, value });
            }
        }
    }
}

/// The construct that the parser expects next, with its first token.
enum State<'a> {
    Value(Option<Token<'a>>),
    Member(Option<Token<'a>>),
    AfterValue,
}

fn run(reader: &mut Reader, tree: &mut Tree, options: Options) -> Result<(), ParseError> {
    let (is_json5, end) = (options.mode == Mode::Json5, reader.text.len());
    // The objects and arrays that aren't closed yet.
    let mut open: Vec<u32> = Vec::new();
    let mut state = State::Value(reader.next()?);
    loop {
        state = match state {
            State::Value(None) | State::Member(None) => {
                return Err(parse_error(Error::UnexpectedEof { pos: end }));
            }
            State::Value(Some(token)) => {
                let source_text = reader.text.get(token.start..token.end).unwrap_or_default();
                let kind = match (token.kind, source_text) {
                    (Kind::String, _) => NodeKind::String,
                    (Kind::Boolean, _) => NodeKind::Boolean,
                    (Kind::Null, _) => NodeKind::Null,
                    (Kind::Number, [.., b'N']) | (Kind::Identifier, b"NaN") if is_json5 => {
                        NodeKind::NaN
                    }
                    (Kind::Number, [.., b'y']) | (Kind::Identifier, b"Infinity") if is_json5 => {
                        NodeKind::Infinity
                    }
                    (Kind::Number, _) => NodeKind::Number,
                    (Kind::LeftBrace, _) => NodeKind::Object,
                    (Kind::LeftBracket, _) => NodeKind::Array,
                    _ => return Err(parse_error(Error::UnexpectedToken { pos: token.start })),
                };
                let index = tree.push(&token, kind);
                // The only rule that reads string values looks for lone surrogates, and only an escape can produce one.
                if kind == NodeKind::String
                    && token.value.len() + 2 != source_text.len()
                    && strings::wtf8_has_surrogate(token.value)
                {
                    tree.store_unescaped(index, token.value);
                }
                let closing = match kind {
                    NodeKind::Object => Kind::RightBrace,
                    NodeKind::Array => Kind::RightBracket,
                    _ => {
                        state = State::AfterValue;
                        continue;
                    }
                };
                open.push(index);
                match reader.next()? {
                    Some(token) if token.kind == closing => tree.close(&mut open, &token),
                    token if kind == NodeKind::Object => State::Member(token),
                    token => State::Value(token),
                }
            }
            State::Member(Some(name)) => {
                let kind = match name.kind {
                    Kind::String => NodeKind::String,
                    // Keywords are valid keys too.
                    Kind::Identifier | Kind::Boolean | Kind::Null if is_json5 => {
                        NodeKind::Identifier
                    }
                    _ if is_json5 => {
                        return Err(parse_error(Error::InvalidIdentifier { pos: name.start }));
                    }
                    _ => return Err((name.start, b"Keys must be strings in double quotes")),
                };
                let index = tree.push(&name, kind);
                let quotes = if kind == NodeKind::String { 2 } else { 0 };
                let is_word = matches!(name.kind, Kind::Boolean | Kind::Null);
                if !is_word && name.value.len() + quotes != name.end - name.start {
                    tree.store_unescaped(index, name.value);
                }
                match reader.next()? {
                    Some(token) if token.kind == Kind::Colon => State::Value(reader.next()?),
                    token => {
                        let pos = token.map_or(end, |it| it.start);
                        return Err(parse_error(Error::ExpectedColon { pos }));
                    }
                }
            }
            State::AfterValue => {
                let Some(&container) = open.last() else {
                    return match reader.next()? {
                        Some(token) => Err(parse_error(Error::TrailingData { pos: token.start })),
                        None => Ok(()),
                    };
                };
                let is_object = tree.is_object(container);
                let closing = if is_object {
                    Kind::RightBrace
                } else {
                    Kind::RightBracket
                };
                match reader.next()? {
                    Some(token) if token.kind == closing => tree.close(&mut open, &token),
                    Some(comma) if comma.kind == Kind::Comma => match reader.next()? {
                        Some(token) if token.kind == closing => {
                            if !options.allows_trailing_commas {
                                return Err((
                                    comma.start,
                                    b"Trailing commas are not allowed in JSON5",
                                ));
                            }
                            tree.close(&mut open, &token)
                        }
                        token if is_object => State::Member(token),
                        token => State::Value(token),
                    },
                    None if is_object => {
                        return Err(parse_error(Error::UnterminatedObject { pos: end }));
                    }
                    None => return Err(parse_error(Error::UnterminatedArray { pos: end })),
                    Some(Token {
                        kind, start: pos, ..
                    }) => {
                        let starts_value =
                            !matches!(kind, Kind::Colon | Kind::RightBrace | Kind::RightBracket);
                        return Err(parse_error(match (starts_value, is_object) {
                            (true, _) => Error::ExpectedComma { pos },
                            (false, true) => Error::ExpectedClosingBrace { pos },
                            (false, false) => Error::ExpectedClosingBracket { pos },
                        }));
                    }
                }
            }
        };
    }
}

impl Tree {
    fn push(&mut self, token: &Token, kind: NodeKind) -> u32 {
        let index = self.nodes.len() as u32;
        self.nodes.push(Entry {
            start: token.start as u32,
            end: token.end as u32,
            next: index + 1,
            kind,
        });
        index
    }

    fn store_unescaped(&mut self, index: u32, value: &[u8]) {
        let start = self.texts.len() as u32;
        self.texts.extend_from_slice(value);
        let span = Span::new(start, self.texts.len() as u32);
        self.unescaped.push((index, span));
    }

    fn is_object(&self, index: u32) -> bool {
        (self.nodes.get(index as usize)).is_some_and(|it| it.kind == NodeKind::Object)
    }

    /// Closes the innermost object or array, which ends with `token`.
    fn close<'a>(&mut self, open: &mut Vec<u32>, token: &Token) -> State<'a> {
        let next = self.nodes.len() as u32;
        if let Some(node) = open.pop().and_then(|it| self.nodes.get_mut(it as usize)) {
            node.end = token.end as u32;
            node.next = next;
        }
        State::AfterValue
    }
}

pub(crate) fn parse(text: &[u8], options: Options) -> Result<(Tree, Vec<Comment>), SyntaxError> {
    let memory = Arena::new();
    let mut tree = Tree::default();
    let result = match SourceTokens::new(text, &memory, options.mode == Mode::Jsonc) {
        Some(tokens) => {
            let mut reader = Reader {
                text,
                mode: options.mode,
                tokens,
                comments: Vec::new(),
            };
            // Minified JSON has about one node per six bytes.
            tree.nodes.reserve(text.len() / 6);
            run(&mut reader, &mut tree, options).map(|()| reader.comments)
        }
        None => Err((0, &b"The file is too large"[..])),
    };
    match result {
        Ok(comments) => {
            tree.comments = comments.iter().map(|it| it.span).collect();
            Ok((tree, comments))
        }
        Err((at, message)) => {
            let at = LineBreaks::Newlines.position(text, at);
            let language: &[u8] = match options.mode {
                Mode::Json => b"JSON",
                Mode::Jsonc => b"JSONC",
                Mode::Json5 => b"JSON5",
            };
            Err(SyntaxError {
                message: strings::replace_owned(message, b"JSON5", language),
                line: at.line,
                column: at.column + 1,
            })
        }
    }
}
