//! The grammar of `@handlebars/parser` (`src/handlebars.yy`, `lib/helpers.js`).
//!
//! Statements go to a list of their own, for `super::tokenizer` to make the tree of. Expressions go to the tree as
//! `@glimmer/syntax` has them (`HandlebarsNodeVisitors`). What it refuses is only refused when it gets to see the
//! statement, which it does not in an HTML comment: `is_valid`.

use super::ast::{self, Call, Head, Kind, NOTHING, NodeId, Range, Text, Tree};
use super::lexer::{Token, TokenKind};
use super::{Error, MAX_DEPTH};
use crate::syntax_error::{Message, SyntaxError};
use bun_core::strings;
use smallvec::SmallVec;

#[derive(Copy, Clone)]
pub(crate) enum StatementKind {
    /// From `start` to `end` is its value.
    Content,
    Comment {
        value: Text,
    },
    Mustache {
        node: NodeId,
        is_valid: bool,
        /// The node is not all that the template says.
        is_damaged: bool,
    },
    /// The statements of what follows `{{#a}}` come next, up to `first_end`, then those of what follows `{{else}}`,
    /// up to `next`.
    Block {
        node: NodeId,
        first_end: u32,
        has_second: bool,
        /// `{{^a}}`
        is_inverted: bool,
        is_valid: bool,
        is_damaged: bool,
        block_params: Range,
    },
    /// Partials and decorators.
    Unsupported,
}

#[derive(Copy, Clone)]
pub(crate) struct Statement {
    pub(crate) kind: StatementKind,
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The statement behind it and all that is in it.
    pub(crate) next: u32,
}

/// `original` of a path or a literal.
#[derive(Copy, Clone)]
enum Original {
    Text(Text),
    Number(f64),
    Boolean(bool),
    Undefined,
    Null,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Class {
    Path,
    SubExpression,
    Literal,
    /// `(a=b)`
    HashLiteral,
}

#[derive(Copy, Clone)]
struct Expression {
    node: NodeId,
    class: Class,
    is_valid: bool,
    original: Original,
    /// `original === "...attributes"`
    is_splat: bool,
}

/// `strip` of what opens or closes something.
#[derive(Copy, Clone, Default)]
struct Strip {
    open: bool,
    close: bool,
}

impl Strip {
    fn flags(self, open: u8, close: u8) -> u8 {
        (if self.open { open } else { 0 }) | (if self.close { close } else { 0 })
    }
}

/// `helperName expr* hash? blockParams?` and what closes it.
struct Header {
    path: Expression,
    call: Call,
    is_valid: bool,
    is_damaged: bool,
    block_params: Range,
    strip: Strip,
}

/// `inverseChain` or `inverseAndProgram`.
struct Inverse {
    strip: Strip,
    /// `{{else if a}}`: the block that it is.
    chained: Option<NodeId>,
}

#[derive(Copy, Clone)]
enum Prefix {
    None,
    /// `@`
    Data(Token),
    /// `(a).`, which starts there.
    SubExpression(usize),
}

struct Segment {
    part: Text,
    is_literal: bool,
    separator: Option<Token>,
    token: Token,
}

/// What `.` in a regular expression does not match.
fn has_line_terminator(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\n\r").is_some()
        || strings::contains(text, "\u{2028}".as_bytes())
        || strings::contains(text, "\u{2029}".as_bytes())
}

/// `/^this(?:\..+)?$/u`
fn is_this_path(original: &[u8]) -> bool {
    match original.strip_prefix(b"this") {
        Some([]) => true,
        Some([b'.', rest @ ..]) => !rest.is_empty() && !has_line_terminator(rest),
        _ => false,
    }
}

struct Parser<'a> {
    source: &'a [u8],
    tokens: &'a [Token],
    at: usize,
    tree: &'a mut Tree,
    statements: &'a mut Vec<Statement>,
    /// The parameters and pairs of the calls that are being parsed.
    pending: Vec<NodeId>,
    depth: usize,
    /// Something of what has been parsed since this was last `false` is not in the tree.
    is_damaged: bool,
}

/// What is said where there is no token of `kind`.
#[cold]
fn expected(kind: TokenKind) -> Message {
    match kind {
        TokenKind::Close | TokenKind::CloseUnescaped | TokenKind::CloseRawBlock => {
            Message::ExpectedEndOfMustache
        }
        TokenKind::CloseSexpr => Message::ExpectedClosingParenthesis,
        TokenKind::Id => Message::ExpectedName,
        _ => Message::UnexpectedToken,
    }
}

impl Parser<'_> {
    fn peek(&self) -> Token {
        self.peek_at(0)
    }

    fn peek_at(&self, ahead: usize) -> Token {
        self.tokens.get(self.at + ahead).copied().unwrap_or(Token {
            kind: TokenKind::Eof,
            start: self.source.len() as u32,
            end: self.source.len() as u32,
        })
    }

    fn next(&mut self) -> Token {
        let token = self.peek();
        self.at += 1;
        token
    }

    /// `message`, where the token is that has been taken last.
    #[cold]
    fn error(&self, message: Message) -> Error {
        let token = self.tokens.get(self.at.saturating_sub(1));
        let (kind, start) = token.map_or((TokenKind::Eof, self.source.len() as u32), |it| {
            (it.kind, it.start)
        });
        Error::Syntax(SyntaxError(
            match kind {
                TokenKind::Eof => Message::UnexpectedEnd,
                _ => message,
            },
            start,
        ))
    }

    fn expect(&mut self, kind: TokenKind) -> Result<Token, Error> {
        let token = self.next();
        if token.kind == kind {
            Ok(token)
        } else {
            Err(self.error(expected(kind)))
        }
    }

    fn enter(&mut self) -> Result<(), Error> {
        self.depth += 1;
        if self.depth > MAX_DEPTH {
            Err(Error::NestedTooDeeply)
        } else {
            Ok(())
        }
    }

    fn slice(&self, token: Token) -> &[u8] {
        self.source
            .get(token.start as usize..token.end as usize)
            .unwrap_or_default()
    }

    fn text(&self, text: Text) -> &[u8] {
        self.tree.text(self.source, text)
    }

    /// `stripFlags`
    fn strip(&self, open: Token, close: Token) -> Strip {
        let close = self.slice(close);
        Strip {
            open: self.slice(open).get(2) == Some(&b'~'),
            close: close.len() >= 3 && close[close.len() - 3] == b'~',
        }
    }

    fn add_statement(&mut self, kind: StatementKind, start: u32, end: u32) -> usize {
        let next = self.statements.len() as u32 + 1;
        self.statements.push(Statement {
            kind,
            start,
            end,
            next,
        });
        self.statements.len() - 1
    }

    /// The statement `index` ends with the last token, and has all the statements in it that follow it.
    fn end_statement(&mut self, index: usize, kind: StatementKind) {
        let next = self.statements.len() as u32;
        let end = self
            .tokens
            .get(self.at.wrapping_sub(1))
            .map_or(0, |token| token.end);
        if let Some(statement) = self.statements.get_mut(index) {
            (statement.kind, statement.end, statement.next) = (kind, end, next);
        }
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `text.replace(from, to)`, where `from` is a backslash and one of `escaped`, and `to` the latter.
    fn unescape(&mut self, start: usize, end: usize, escaped: &[u8]) -> Text {
        let source = self.source;
        let text = source.get(start..end).unwrap_or_default();
        let is_escape = |at: usize| {
            text[at] == b'\\' && text.get(at + 1).is_some_and(|next| escaped.contains(next))
        };
        if !strings::contains_char(text, b'\\') || !(0..text.len()).any(is_escape) {
            return Text::source(start, end);
        }
        let owned = self.tree.start_text();
        let (mut at, mut copied) = (0, 0);
        while at < text.len() {
            if is_escape(at) {
                self.tree.write(&text[copied..at]);
                copied = at + 1;
                at += 2;
            } else {
                at += 1;
            }
        }
        self.tree.write(&text[copied..]);
        self.tree.end_text(owned)
    }

    /// `yytext` of an `ID`.
    fn id_text(&mut self, token: Token) -> Text {
        let (start, end) = (token.start as usize, token.end as usize);
        match self.source.get(start) {
            Some(b'[') => self.unescape(start, end, b"\\]"),
            _ => Text::source(start, end),
        }
    }

    /// `yy.id(token)`, and whether that is not the token.
    fn id(&mut self, token: Token) -> (Text, bool) {
        let text = self.id_text(token);
        match self.text(text) {
            [b'[', inner @ .., b']'] if !has_line_terminator(inner) => (text.without_ends(), true),
            _ => (text, false),
        }
    }

    fn can_start_expression(kind: TokenKind) -> bool {
        matches!(
            kind,
            TokenKind::OpenSexpr
                | TokenKind::Id
                | TokenKind::Data
                | TokenKind::String
                | TokenKind::Number
                | TokenKind::Boolean
                | TokenKind::Undefined
                | TokenKind::Null
        )
    }

    fn is_at_hash(&self) -> bool {
        self.peek().kind == TokenKind::Id && self.peek_at(1).kind == TokenKind::Equals
    }

    fn literal(&mut self, kind: Kind, original: Original, is_splat: bool) -> Expression {
        let token = self.next();
        Expression {
            node: self
                .tree
                .add(kind, token.start as usize, token.end as usize),
            class: Class::Literal,
            is_valid: true,
            original,
            is_splat,
        }
    }

    /// `expr`
    fn expression(&mut self) -> Result<Expression, Error> {
        let token = self.peek();
        match token.kind {
            TokenKind::OpenSexpr => {
                let expression = self.sub_expression()?;
                match self.peek().kind {
                    TokenKind::Sep | TokenKind::PrivateSep => {
                        self.next();
                        self.path(Prefix::SubExpression(token.start as usize))
                    }
                    _ => Ok(expression),
                }
            }
            TokenKind::Id => self.path(Prefix::None),
            TokenKind::Data => {
                self.next();
                self.path(Prefix::Data(token))
            }
            TokenKind::String => {
                let quote = self.slice(token).first().copied().unwrap_or(b'"');
                let value =
                    self.unescape(token.start as usize + 1, token.end as usize - 1, &[quote]);
                let is_splat = self.text(value) == b"...attributes";
                Ok(self.literal(Kind::String { value }, Original::Text(value), is_splat))
            }
            TokenKind::Number => {
                let value = std::str::from_utf8(self.slice(token))
                    .ok()
                    .and_then(|it| it.parse().ok())
                    .unwrap_or(f64::NAN);
                let token = Text::source(token.start as usize, token.end as usize);
                Ok(self.literal(Kind::Number { token }, Original::Number(value), false))
            }
            TokenKind::Boolean => {
                let value = self.slice(token) == b"true";
                Ok(self.literal(Kind::Boolean(value), Original::Boolean(value), false))
            }
            TokenKind::Undefined => Ok(self.literal(Kind::Undefined, Original::Undefined, false)),
            TokenKind::Null => Ok(self.literal(Kind::Null, Original::Null, false)),
            _ => Err(self.error(Message::UnexpectedToken)),
        }
    }

    /// `helperName`: an expression that is not all in parentheses.
    fn helper_name(&mut self) -> Result<Expression, Error> {
        let expression = self.expression()?;
        match expression.class {
            Class::SubExpression | Class::HashLiteral => Err(self.error(Message::UnexpectedToken)),
            Class::Path | Class::Literal => Ok(expression),
        }
    }

    /// `hashSegment+`, to `pending`. Returns whether all values are valid.
    fn hash(&mut self) -> Result<bool, Error> {
        let mut is_valid = true;
        while self.is_at_hash() {
            let token = self.next();
            let (key, _) = self.id(token);
            self.next();
            let value = self.expression()?;
            is_valid &= value.is_valid && value.class != Class::HashLiteral;
            let end = self.tokens.get(self.at - 1).map_or(0, |token| token.end);
            let pair = self.tree.add(
                Kind::HashPair {
                    key,
                    value: value.node,
                },
                token.start as usize,
                end as usize,
            );
            self.pending.push(pair);
        }
        Ok(is_valid)
    }

    /// `expr* hash?` behind `path`, and `acceptCallNodes` of `@glimmer/syntax`.
    fn call(&mut self, path: Expression) -> Result<(Call, bool), Error> {
        let base = self.pending.len();
        let mut is_valid = true;
        while Self::can_start_expression(self.peek().kind) && !self.is_at_hash() {
            let param = self.expression()?;
            is_valid &= param.is_valid && param.class != Class::HashLiteral;
            self.pending.push(param.node);
        }
        let params = self.tree.add_list(&self.pending[base..]);
        self.pending.truncate(base);
        is_valid &= self.hash()?;
        let pairs = self.tree.add_list(&self.pending[base..]);
        self.pending.truncate(base);
        let (node, is_path_valid) = match path.class {
            Class::Path | Class::SubExpression => (path.node, path.is_valid),
            Class::Literal => (path.node, false),
            // It is taken for `undefined`, which only matters where its position is asked for.
            Class::HashLiteral => (NOTHING, !params.is_empty()),
        };
        self.is_damaged |= path.class == Class::HashLiteral;
        Ok((
            Call {
                path: node,
                params,
                pairs,
            },
            is_valid && is_path_valid,
        ))
    }

    /// `sexpr`
    fn sub_expression(&mut self) -> Result<Expression, Error> {
        self.enter()?;
        let open = self.next();
        let expression = if self.is_at_hash() {
            let base = self.pending.len();
            self.hash()?;
            self.pending.truncate(base);
            self.expect(TokenKind::CloseSexpr)?;
            Expression {
                node: NOTHING,
                class: Class::HashLiteral,
                is_valid: false,
                original: Original::Undefined,
                is_splat: false,
            }
        } else {
            let path = self.expression()?;
            let (call, is_valid) = self.call(path)?;
            let close = self.expect(TokenKind::CloseSexpr)?;
            Expression {
                node: self.tree.add(
                    Kind::SubExpression { call },
                    open.start as usize,
                    close.end as usize,
                ),
                class: Class::SubExpression,
                is_valid,
                original: Original::Undefined,
                is_splat: false,
            }
        };
        self.depth -= 1;
        Ok(expression)
    }

    /// `pathSegments`, `preparePath`, and `PathExpression` of `@glimmer/syntax`.
    fn path(&mut self, prefix: Prefix) -> Result<Expression, Error> {
        let mut segments = SmallVec::<[Segment; 4]>::new();
        let mut token = self.expect(TokenKind::Id)?;
        let (start, is_data) = match prefix {
            Prefix::None => (token.start as usize, false),
            Prefix::Data(data) => (data.start as usize, true),
            Prefix::SubExpression(start) => (start, false),
        };
        // `original` is what the template has.
        let mut is_plain = match prefix {
            Prefix::None => true,
            Prefix::Data(data) => data.end == token.start,
            Prefix::SubExpression(_) => false,
        };
        let mut separator = None;
        loop {
            let (part, is_literal) = self.id(token);
            is_plain &= self.source.get(token.start as usize) != Some(&b'[');
            segments.push(Segment {
                part,
                is_literal,
                separator,
                token,
            });
            if !matches!(self.peek().kind, TokenKind::Sep | TokenKind::PrivateSep) {
                break;
            }
            let next_separator = self.next();
            let next = self.expect(TokenKind::Id)?;
            is_plain &= token.end == next_separator.start && next_separator.end == next.start;
            (separator, token) = (Some(next_separator), next);
        }
        let end = token.end as usize;

        let mut parts = SmallVec::<[Text; 4]>::new();
        let mut dropped = 0;
        for segment in &segments {
            if !segment.is_literal && matches!(self.text(segment.part), b".." | b"." | b"this") {
                if !parts.is_empty() {
                    return Err(self.error(Message::InvalidPath));
                }
                dropped += 1;
                continue;
            }
            parts.push(match segment.separator {
                Some(separator) if separator.kind == TokenKind::PrivateSep => {
                    self.is_damaged = true;
                    let owned = self.tree.start_text();
                    self.tree.write(b"#");
                    self.tree.write_text(self.source, segment.part);
                    self.tree.end_text(owned)
                }
                _ => segment.part,
            });
        }

        // `parts: head ? [head, ...tail] : tail`
        if parts.first().is_some_and(|head| head.is_empty()) {
            parts.remove(0);
            dropped += 2;
        }
        let has_dropped = dropped > 0;

        let original = if is_plain {
            Text::source(start, end)
        } else {
            let owned = self.tree.start_text();
            match prefix {
                Prefix::None => {}
                Prefix::Data(_) => self.tree.write(b"@"),
                Prefix::SubExpression(_) => self.tree.write(b"undefined."),
            }
            for segment in &segments {
                if let Some(separator) = segment.separator {
                    self.tree.write(
                        self.source
                            .get(separator.start as usize..separator.end as usize)
                            .unwrap_or_default(),
                    );
                }
                self.tree.write_text(self.source, segment.part);
            }
            self.tree.end_text(owned)
        };

        let text = self.text(original);
        let has_slash = strings::contains_char(text, b'/');
        let is_refused = match has_slash {
            true => {
                text.starts_with(b"./")
                    || text.starts_with(b"../")
                    || strings::contains_char(text, b'.')
            }
            false => text == b".",
        };
        let is_this = is_this_path(text);
        let is_splat = text == b"...attributes";
        // Only the `this` that a path starts with comes back.
        self.is_damaged |= dropped != usize::from(is_this);
        let invalid = Expression {
            node: NOTHING,
            class: Class::Path,
            is_valid: false,
            original: Original::Text(original),
            is_splat,
        };
        if is_refused || matches!(prefix, Prefix::SubExpression(_)) {
            return Ok(invalid);
        }

        let head = if is_this {
            Head::This
        } else if is_data {
            Head::At
        } else {
            Head::Var
        };
        let (name, tail) = if has_slash {
            // One part: `path.parts.join("/")`.
            let name = if has_dropped {
                let owned = self.tree.start_text();
                if is_data {
                    self.tree.write(b"@");
                }
                for (index, part) in parts.iter().enumerate() {
                    if index > 0 {
                        self.tree.write(b"/");
                    }
                    self.tree.write_text(self.source, *part);
                }
                self.tree.end_text(owned)
            } else {
                original
            };
            (name, &[][..])
        } else if is_this {
            (Text::EMPTY, &parts[..])
        } else {
            let Some((first, tail)) = parts.split_first() else {
                return Ok(invalid);
            };
            let name = match (is_data, segments.first()) {
                (false, _) => *first,
                (true, Some(segment)) if is_plain && !has_dropped => {
                    Text::source(start, segment.token.end as usize)
                }
                (true, _) => {
                    let owned = self.tree.start_text();
                    self.tree.write(b"@");
                    self.tree.write_text(self.source, *first);
                    self.tree.end_text(owned)
                }
            };
            (name, tail)
        };
        let tail = self.tree.add_names(tail);
        Ok(Expression {
            node: self.tree.add(Kind::Path { head, name, tail }, start, end),
            is_valid: true,
            ..invalid
        })
    }

    // ───────────────────────────── statements ─────────────────────────────

    /// `validateClose`
    fn closes(&self, open: Original, close: Original) -> bool {
        match (open, close) {
            (Original::Text(open), Original::Text(close)) => self.text(open) == self.text(close),
            (Original::Number(open), Original::Number(close)) => open == close,
            (Original::Boolean(open), Original::Boolean(close)) => open == close,
            (Original::Undefined, Original::Undefined) | (Original::Null, Original::Null) => true,
            _ => false,
        }
    }

    /// `blockParams`
    fn block_params(&mut self) -> Result<Range, Error> {
        self.next();
        let mut names = SmallVec::<[Text; 4]>::new();
        while self.peek().kind == TokenKind::Id {
            let token = self.next();
            names.push(self.id_text(token));
        }
        self.expect(TokenKind::CloseBlockParams)?;
        let (Some(first), Some(last)) = (names.first(), names.last()) else {
            return Err(self.error(Message::ExpectedName));
        };
        // `yy.id` is given the list. It takes it for a text, and if that is in brackets, fails.
        if self.text(*first).starts_with(b"[")
            && self.text(*last).ends_with(b"]")
            && !names
                .iter()
                .any(|name| has_line_terminator(self.text(*name)))
        {
            return Err(self.error(Message::UnexpectedToken));
        }
        self.is_damaged |= names.iter().any(|name| self.text(*name).starts_with(b"["));
        Ok(self.tree.add_names(&names))
    }

    /// What is behind `open`: `helperName expr* hash? blockParams?` and `close`.
    fn header(
        &mut self,
        open: Token,
        close: TokenKind,
        takes_block_params: bool,
    ) -> Result<Header, Error> {
        self.is_damaged = false;
        let path = self.helper_name()?;
        let (call, is_valid) = self.call(path)?;
        let block_params = match self.peek().kind {
            TokenKind::OpenBlockParams if takes_block_params => self.block_params()?,
            _ => Range::default(),
        };
        let close = self.expect(close)?;
        Ok(Header {
            path,
            call,
            is_valid,
            is_damaged: self.is_damaged,
            block_params,
            strip: self.strip(open, close),
        })
    }

    /// `closeBlock`
    fn close_block(&mut self, open: Original) -> Result<Strip, Error> {
        let first = self.expect(TokenKind::OpenEndBlock)?;
        let path = self.helper_name()?;
        let last = self.expect(TokenKind::Close)?;
        if !self.closes(open, path.original) {
            return Err(Error::Syntax(SyntaxError(
                Message::WrongNameAtEndOfBlock,
                first.start,
            )));
        }
        Ok(self.strip(first, last))
    }

    /// `inverseAndProgram`
    fn inverse_and_program(&mut self) -> Result<Inverse, Error> {
        let token = self.next();
        self.program()?;
        Ok(Inverse {
            strip: self.strip(token, token),
            chained: None,
        })
    }

    fn set_close_strip(&mut self, block: NodeId, close: Strip) {
        if let Some(Kind::BlockStatement { strip, .. }) = self.tree.kind_mut(block) {
            *strip = (*strip & !(ast::CLOSE_OPEN | ast::CLOSE_CLOSE))
                | close.flags(ast::CLOSE_OPEN, ast::CLOSE_CLOSE);
        }
    }

    /// `prepareBlock`, for the statement `index`, whose first program ends at `first_end`. `close`: `close.strip`.
    fn end_block(
        &mut self,
        index: usize,
        header: &Header,
        first_end: u32,
        inverse: Option<&Inverse>,
        close: Option<Strip>,
        is_inverted: bool,
    ) -> NodeId {
        if let Some(chained) = inverse.and_then(|inverse| inverse.chained) {
            self.set_close_strip(chained, close.unwrap_or_default());
        }
        let strip = header.strip.flags(ast::OPEN_OPEN, ast::OPEN_CLOSE)
            | inverse.map_or(0, |inverse| {
                inverse.strip.flags(ast::INVERSE_OPEN, ast::INVERSE_CLOSE)
            })
            | close
                .unwrap_or_default()
                .flags(ast::CLOSE_OPEN, ast::CLOSE_CLOSE);
        let kind = Kind::BlockStatement {
            call: header.call,
            program: NOTHING,
            inverse: NOTHING,
            strip,
        };
        let node = self.tree.add(kind, 0, 0);
        let kind = StatementKind::Block {
            node,
            first_end,
            has_second: inverse.is_some(),
            is_inverted,
            // Without what follows `{{else}}`, `{{^a}}` has no `program`.
            is_valid: header.is_valid && (!is_inverted || inverse.is_some()),
            is_damaged: header.is_damaged || is_inverted,
            block_params: header.block_params,
        };
        self.end_statement(index, kind);
        node
    }

    /// `inverseChain?`
    fn inverse_chain(&mut self) -> Result<Option<Inverse>, Error> {
        let open = self.peek();
        match open.kind {
            TokenKind::Inverse => self.inverse_and_program().map(Some),
            TokenKind::OpenInverseChain => {
                self.enter()?;
                self.next();
                let header = self.header(open, TokenKind::Close, true)?;
                let index = self.add_statement(StatementKind::Unsupported, open.start, open.end);
                self.program()?;
                let first_end = self.statements.len() as u32;
                let inverse = self.inverse_chain()?;
                let close = inverse.as_ref().map(|inverse| inverse.strip);
                let node =
                    self.end_block(index, &header, first_end, inverse.as_ref(), close, false);
                if let Some(Kind::BlockStatement { strip, .. }) = self.tree.kind_mut(node) {
                    *strip |= ast::CHAINED;
                }
                self.depth -= 1;
                Ok(Some(Inverse {
                    strip: header.strip,
                    chained: Some(node),
                }))
            }
            _ => Ok(None),
        }
    }

    /// `block`
    fn block(&mut self) -> Result<(), Error> {
        self.enter()?;
        let open = self.next();
        let is_inverted = open.kind == TokenKind::OpenInverse;
        let is_decorator = strings::contains_char(self.slice(open), b'*');
        let header = self.header(open, TokenKind::Close, true)?;
        let index = self.add_statement(StatementKind::Unsupported, open.start, open.end);
        self.program()?;
        let first_end = self.statements.len() as u32;
        let inverse = match is_inverted {
            true if self.peek().kind == TokenKind::Inverse => Some(self.inverse_and_program()?),
            true => None,
            false => self.inverse_chain()?,
        };
        if self.peek().kind == TokenKind::Eof {
            return Err(Error::Syntax(SyntaxError(
                Message::UnclosedBlock,
                open.start,
            )));
        }
        let close = self.close_block(header.path.original)?;
        if is_decorator {
            if inverse.is_some() {
                return Err(self.error(Message::UnexpectedToken));
            }
            self.end_statement(index, StatementKind::Unsupported);
        } else {
            self.end_block(
                index,
                &header,
                first_end,
                inverse.as_ref(),
                Some(close),
                is_inverted,
            );
        }
        self.depth -= 1;
        Ok(())
    }

    /// `rawBlock`
    fn raw_block(&mut self) -> Result<(), Error> {
        let open = self.next();
        // It becomes a block like any other.
        let header = Header {
            strip: Strip::default(),
            is_damaged: true,
            ..self.header(open, TokenKind::CloseRawBlock, false)?
        };
        let index = self.add_statement(StatementKind::Unsupported, open.start, open.end);
        while self.peek().kind == TokenKind::Content {
            let content = self.next();
            self.add_statement(StatementKind::Content, content.start, content.end);
        }
        let close = self.expect(TokenKind::EndRawBlock)?;
        let name = Text::source(close.start as usize + 5, close.end as usize - 4);
        if !self.closes(header.path.original, Original::Text(name)) {
            return Err(Error::Syntax(SyntaxError(
                Message::WrongNameAtEndOfBlock,
                close.start,
            )));
        }
        let first_end = self.statements.len() as u32;
        self.end_block(index, &header, first_end, None, None, false);
        Ok(())
    }

    /// `mustache`
    fn mustache(&mut self) -> Result<(), Error> {
        let open = self.next();
        let (close, is_trusting) = match open.kind {
            TokenKind::OpenUnescaped => (TokenKind::CloseUnescaped, true),
            _ => (TokenKind::Close, self.slice(open).ends_with(b"&")),
        };
        self.is_damaged = false;
        let no_arguments = (Range::default(), Range::default());
        let (path, mut call, mut is_valid) = if open.kind == TokenKind::Open && self.is_at_hash() {
            let base = self.pending.len();
            self.hash()?;
            self.pending.truncate(base);
            let (params, pairs) = no_arguments;
            (
                None,
                Call {
                    path: NOTHING,
                    params,
                    pairs,
                },
                false,
            )
        } else {
            let path = self.expression()?;
            let (call, is_valid) = self.call(path)?;
            (Some(path), call, is_valid)
        };
        let close = self.expect(close)?;
        if strings::contains_char(self.slice(open), b'*') {
            self.add_statement(StatementKind::Unsupported, open.start, close.end);
            return Ok(());
        }
        // What follows a literal is dropped unseen.
        if path.is_some_and(|path| path.class == Class::Literal) {
            self.is_damaged = !call.params.is_empty() || !call.pairs.is_empty();
            ((call.params, call.pairs), is_valid) = (no_arguments, true);
        }
        let kind = Kind::Mustache {
            call,
            is_trusting,
            strip: self
                .strip(open, close)
                .flags(ast::OPEN_OPEN, ast::OPEN_CLOSE),
        };
        let node = self.tree.add(kind, open.start as usize, close.end as usize);
        let is_valid = is_valid && !path.is_some_and(|path| path.is_splat);
        let is_damaged = self.is_damaged;
        self.add_statement(
            StatementKind::Mustache {
                node,
                is_valid,
                is_damaged,
            },
            open.start,
            close.end,
        );
        Ok(())
    }

    /// `partial`, or `openPartialBlock`. Returns `original` of the name.
    fn partial(&mut self) -> Result<Original, Error> {
        self.next();
        let path = self.expression()?;
        self.call(path)?;
        self.expect(TokenKind::Close)?;
        Ok(path.original)
    }

    /// `stripComment`
    fn comment_value(&self, token: Token) -> Text {
        let text = self.slice(token);
        let dashes = |text: &[u8]| {
            text.iter()
                .take(2)
                .take_while(|byte| **byte == b'-')
                .count()
        };
        let mut start = if text.get(2) == Some(&b'~') { 4 } else { 3 };
        start += dashes(text.get(start..).unwrap_or_default());
        let mut rest = text.get(start..).unwrap_or_default();
        rest = rest.strip_suffix(b"}}").unwrap_or(rest);
        rest = rest.strip_suffix(b"~").unwrap_or(rest);
        rest = rest.strip_suffix(b"-").unwrap_or(rest);
        rest = rest.strip_suffix(b"-").unwrap_or(rest);
        let start = token.start as usize + start;
        Text::source(start, start + rest.len())
    }

    /// `program`
    fn program(&mut self) -> Result<(), Error> {
        loop {
            let token = self.peek();
            match token.kind {
                TokenKind::Content => {
                    self.next();
                    self.add_statement(StatementKind::Content, token.start, token.end);
                }
                TokenKind::Comment => {
                    self.next();
                    let value = self.comment_value(token);
                    self.add_statement(StatementKind::Comment { value }, token.start, token.end);
                }
                TokenKind::Open | TokenKind::OpenUnescaped => self.mustache()?,
                TokenKind::OpenBlock | TokenKind::OpenInverse => self.block()?,
                TokenKind::OpenRawBlock => self.raw_block()?,
                TokenKind::OpenPartial => {
                    self.partial()?;
                    self.add_statement(StatementKind::Unsupported, token.start, token.end);
                }
                TokenKind::OpenPartialBlock => {
                    self.enter()?;
                    let open = self.partial()?;
                    let index =
                        self.add_statement(StatementKind::Unsupported, token.start, token.end);
                    self.program()?;
                    self.close_block(open)?;
                    self.end_statement(index, StatementKind::Unsupported);
                    self.depth -= 1;
                }
                _ => return Ok(()),
            }
        }
    }
}

/// Writes the statements that `tokens` are to `statements`, which is empty, and their expressions to `tree`.
pub(crate) fn parse(
    source: &[u8],
    tokens: &[Token],
    tree: &mut Tree,
    statements: &mut Vec<Statement>,
) -> Result<(), Error> {
    let mut parser = Parser {
        source,
        tokens,
        at: 0,
        tree,
        statements,
        pending: Vec::new(),
        depth: 0,
        is_damaged: false,
    };
    parser.program()?;
    parser.expect(TokenKind::Eof).map(drop)
}
