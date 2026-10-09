//! The syntax of GraphQL: the lexer and the parser of graphql-js 17, which is what Prettier parses
//! with, with `experimentalFragmentArguments`.
//!
//! The tree is flat. A node has its kind, where it is in the text, and its children in source order,
//! which are all the nodes that graphql-js has in it. What a child is to its parent is told from its
//! kind and its place among the others.

use crate::syntax_error::{Message, Refusal, Refused, SyntaxError};
use bun_lint::span::Span;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Kind {
    Name,
    Document,
    OperationDefinition,
    VariableDefinition,
    Variable,
    SelectionSet,
    Field,
    Argument,
    FragmentArgument,
    FragmentSpread,
    InlineFragment,
    FragmentDefinition,
    IntValue,
    FloatValue,
    StringValue,
    BooleanValue,
    NullValue,
    EnumValue,
    ListValue,
    ObjectValue,
    ObjectField,
    Directive,
    NamedType,
    ListType,
    NonNullType,
    SchemaDefinition,
    OperationTypeDefinition,
    ScalarTypeDefinition,
    ObjectTypeDefinition,
    FieldDefinition,
    InputValueDefinition,
    InterfaceTypeDefinition,
    UnionTypeDefinition,
    EnumTypeDefinition,
    EnumValueDefinition,
    InputObjectTypeDefinition,
    DirectiveDefinition,
    SchemaExtension,
    DirectiveExtension,
    ScalarTypeExtension,
    ObjectTypeExtension,
    InterfaceTypeExtension,
    UnionTypeExtension,
    EnumTypeExtension,
    InputObjectTypeExtension,
}

impl Kind {
    pub(crate) fn is_type(self) -> bool {
        matches!(self, Kind::NamedType | Kind::ListType | Kind::NonNullType)
    }

    pub(crate) fn is_value(self) -> bool {
        matches!(
            self,
            Kind::Variable
                | Kind::IntValue
                | Kind::FloatValue
                | Kind::StringValue
                | Kind::BooleanValue
                | Kind::NullValue
                | Kind::EnumValue
                | Kind::ListValue
                | Kind::ObjectValue
        )
    }
}

pub(crate) type NodeId = u32;

#[derive(Copy, Clone, Debug)]
pub(crate) struct Node {
    pub(crate) kind: Kind,
    pub(crate) flags: u8,
    pub(crate) span: Span,
    first_child: u32,
    child_count: u32,
}

/// Of a `Field`: its first child is the alias.
pub(crate) const HAS_ALIAS: u8 = 1;
/// Of a `StringValue`: `""" .. """`
pub(crate) const IS_BLOCK: u8 = 1;
/// Of a `DirectiveDefinition`
pub(crate) const IS_REPEATABLE: u8 = 1;
/// Of an `OperationDefinition` and an `OperationTypeDefinition`
pub(crate) const QUERY: u8 = 0;
pub(crate) const MUTATION: u8 = 1;
pub(crate) const SUBSCRIPTION: u8 = 2;
/// Of an `OperationDefinition`: it is only a selection set.
pub(crate) const IS_SHORTHAND: u8 = 3;

#[derive(Default)]
pub(crate) struct Tree {
    pub(crate) nodes: Vec<Node>,
    children: Vec<NodeId>,
    /// From the `#` to the end of the line.
    pub(crate) comments: Vec<Span>,
    /// The nodes that wait for their parent.
    pending: Vec<NodeId>,
}

impl Tree {
    /// The `Document`.
    pub(crate) fn root(&self) -> NodeId {
        (self.nodes.len() as u32).saturating_sub(1)
    }

    pub(crate) fn node(&self, id: NodeId) -> Option<&Node> {
        self.nodes.get(id as usize)
    }

    pub(crate) fn children(&self, id: NodeId) -> &[NodeId] {
        let Some(node) = self.node(id) else {
            return &[];
        };
        let start = node.first_child as usize;
        self.children
            .get(start..start + node.child_count as usize)
            .unwrap_or_default()
    }

    pub(crate) fn kind(&self, id: NodeId) -> Kind {
        self.node(id).map_or(Kind::Name, |node| node.kind)
    }

    pub(crate) fn span(&self, id: NodeId) -> Span {
        self.node(id).map_or_else(Span::default, |node| node.span)
    }
}

type Result<T> = std::result::Result<T, Refused>;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
enum TokenKind {
    StartOfFile,
    EndOfFile,
    Bang,
    Dollar,
    Amp,
    ParenL,
    ParenR,
    Spread,
    Colon,
    Equals,
    At,
    BracketL,
    BracketR,
    BraceL,
    Pipe,
    BraceR,
    Name,
    Int,
    Float,
    String,
    BlockString,
}

#[derive(Copy, Clone, Debug)]
struct Token {
    kind: TokenKind,
    start: u32,
    end: u32,
}

const fn is_name_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || byte == b'_'
}

const fn is_name_continue(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'_'
}

fn hex_digit(byte: Option<&u8>) -> Option<u32> {
    (*byte? as char).to_digit(16)
}

fn hex_code(text: &[u8]) -> Option<u32> {
    (0..4).try_fold(0, |code, index| {
        Some(code << 4 | hex_digit(text.get(index))?)
    })
}

/// The escape sequence that `text` starts with: the character that it stands for, and its length.
pub(crate) fn read_escape(text: &[u8]) -> Option<(char, usize)> {
    let simple = |c: char| Some((c, 2));
    match *text.get(1)? {
        b'"' => simple('"'),
        b'\\' => simple('\\'),
        b'/' => simple('/'),
        b'b' => simple('\u{8}'),
        b'f' => simple('\u{c}'),
        b'n' => simple('\n'),
        b'r' => simple('\r'),
        b't' => simple('\t'),
        // `\u{1F600}`
        b'u' if text.get(2) == Some(&b'{') => {
            let mut code: u32 = 0;
            for size in 3..12 {
                if text.get(size) == Some(&b'}') {
                    return (size >= 4)
                        .then(|| char::from_u32(code))
                        .flatten()
                        .map(|c| (c, size + 1));
                }
                code = code.checked_shl(4)? | hex_digit(text.get(size))?;
            }
            None
        }
        b'u' => {
            let code = hex_code(text.get(2..)?)?;
            if let Some(c) = char::from_u32(code) {
                return Some((c, 6));
            }
            // Two halves of a character.
            if !(0xD800..=0xDBFF).contains(&code) || text.get(6..8) != Some(b"\\u") {
                return None;
            }
            let trailing = hex_code(text.get(8..)?).filter(|it| (0xDC00..=0xDFFF).contains(it))?;
            char::from_u32(0x10000 + ((code - 0xD800) << 10) + (trailing - 0xDC00)).map(|c| (c, 12))
        }
        _ => None,
    }
}

struct Parser<'t> {
    text: &'t [u8],
    tree: &'t mut Tree,
    refusal: Refusal,
    token: Token,
    /// The token after `token`, if it has been looked at.
    next: Option<Token>,
    /// Where the token before `token` ends.
    last_end: u32,
    stack_check: bun_core::StackCheck,
}

/// Fills `tree` with the syntax of `text`.
pub(crate) fn parse(text: &[u8], tree: &mut Tree) -> std::result::Result<(), SyntaxError> {
    tree.nodes.clear();
    tree.children.clear();
    tree.comments.clear();
    tree.pending.clear();
    if u32::try_from(text.len()).is_err() {
        return Err(SyntaxError(Message::TooLarge, 0));
    }
    let mut parser = Parser {
        text,
        tree,
        refusal: Refusal::default(),
        token: Token {
            kind: TokenKind::StartOfFile,
            start: 0,
            end: 0,
        },
        next: None,
        last_end: 0,
        stack_check: bun_core::StackCheck::init(),
    };
    parser.parse_document().map_err(|_| parser.refusal.reason())
}

/// What is said where there is no token of `kind`.
#[cold]
fn expected(kind: TokenKind) -> Message {
    match kind {
        TokenKind::Name => Message::ExpectedName,
        TokenKind::Colon => Message::ExpectedColon,
        TokenKind::BraceL => Message::ExpectedOpeningBrace,
        TokenKind::BracketR => Message::ExpectedClosingBracket,
        _ => Message::UnexpectedToken,
    }
}

impl Parser<'_> {
    // ───────────────────────────── the lexer ─────────────────────────────

    fn byte(&self, position: usize) -> Option<u8> {
        self.text.get(position).copied()
    }

    /// The token at or after `start`. Comments on the way are noted.
    fn read_token(&mut self, start: u32) -> Result<Token> {
        let mut position = start as usize;
        let token = |kind, start: usize, end: usize| {
            Ok(Token {
                kind,
                start: start as u32,
                end: end as u32,
            })
        };
        loop {
            let Some(byte) = self.byte(position) else {
                return token(TokenKind::EndOfFile, self.text.len(), self.text.len());
            };
            let punctuator = match byte {
                b'\t' | b' ' | b',' | b'\n' | b'\r' => {
                    position += 1;
                    continue;
                }
                0xEF if self.text[position..].starts_with(b"\xEF\xBB\xBF") => {
                    position += 3;
                    continue;
                }
                b'#' => {
                    let rest = &self.text[position..];
                    let len = bun_core::strings::index_of_any(rest, b"\n\r").unwrap_or(rest.len());
                    self.tree
                        .comments
                        .push(Span::new(position as u32, (position + len) as u32));
                    position += len;
                    continue;
                }
                b'!' => TokenKind::Bang,
                b'$' => TokenKind::Dollar,
                b'&' => TokenKind::Amp,
                b'(' => TokenKind::ParenL,
                b')' => TokenKind::ParenR,
                b':' => TokenKind::Colon,
                b'=' => TokenKind::Equals,
                b'@' => TokenKind::At,
                b'[' => TokenKind::BracketL,
                b']' => TokenKind::BracketR,
                b'{' => TokenKind::BraceL,
                b'|' => TokenKind::Pipe,
                b'}' => TokenKind::BraceR,
                b'.' if self.text[position..].starts_with(b"...") => {
                    return token(TokenKind::Spread, position, position + 3);
                }
                b'"' if self.text[position..].starts_with(b"\"\"\"") => {
                    return token(
                        TokenKind::BlockString,
                        position,
                        self.read_block_string(position)?,
                    );
                }
                b'"' => return token(TokenKind::String, position, self.read_string(position)?),
                b'0'..=b'9' | b'-' => {
                    let (kind, end) = self.read_number(position)?;
                    return token(kind, position, end);
                }
                _ if is_name_start(byte) => {
                    let rest = &self.text[position..];
                    let len = rest
                        .iter()
                        .take_while(|&&byte| is_name_continue(byte))
                        .count();
                    return token(TokenKind::Name, position, position + len);
                }
                _ => {
                    return Err(self
                        .refusal
                        .note(Message::UnexpectedCharacter, position as u32));
                }
            };
            return token(punctuator, position, position + 1);
        }
    }

    /// Where the digits at `position` end. There has to be one.
    fn read_digits(&self, position: usize) -> Result<usize> {
        let rest = self.text.get(position..).unwrap_or_default();
        match rest.iter().take_while(|byte| byte.is_ascii_digit()).count() {
            0 => Err(self.refusal.note(Message::ExpectedDigit, position as u32)),
            count => Ok(position + count),
        }
    }

    fn read_number(&self, start: usize) -> Result<(TokenKind, usize)> {
        let mut position = start;
        let mut kind = TokenKind::Int;
        if self.byte(position) == Some(b'-') {
            position += 1;
        }
        if self.byte(position) == Some(b'0') {
            position += 1;
            if self
                .byte(position)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                return Err(self.refusal.note(Message::InvalidNumber, start as u32));
            }
        } else {
            position = self.read_digits(position)?;
        }
        if self.byte(position) == Some(b'.') {
            kind = TokenKind::Float;
            position = self.read_digits(position + 1)?;
        }
        if matches!(self.byte(position), Some(b'E' | b'e')) {
            kind = TokenKind::Float;
            position += 1;
            if matches!(self.byte(position), Some(b'+' | b'-')) {
                position += 1;
            }
            position = self.read_digits(position)?;
        }
        match self.byte(position) {
            Some(byte) if byte == b'.' || is_name_start(byte) => {
                Err(self.refusal.note(Message::InvalidNumber, start as u32))
            }
            _ => Ok((kind, position)),
        }
    }

    /// Where the string that starts at `start` ends.
    fn read_string(&self, start: usize) -> Result<usize> {
        let mut position = start + 1;
        loop {
            let rest = self.text.get(position..).unwrap_or_default();
            position += bun_core::strings::index_of_any(rest, b"\"\\\n\r")
                .ok_or_else(|| self.refusal.note(Message::UnclosedString, start as u32))?;
            match self.byte(position) {
                Some(b'"') => return Ok(position + 1),
                Some(b'\\') => {
                    position += read_escape(&self.text[position..])
                        .ok_or_else(|| {
                            self.refusal
                                .note(Message::InvalidEscapeSequence, position as u32)
                        })?
                        .1
                }
                _ => return Err(self.refusal.note(Message::UnclosedString, start as u32)),
            }
        }
    }

    fn read_block_string(&self, start: usize) -> Result<usize> {
        let mut position = start + 3;
        loop {
            let rest = self.text.get(position..).unwrap_or_default();
            position += bun_core::strings::index_of(rest, b"\"\"\"")
                .ok_or_else(|| self.refusal.note(Message::UnclosedString, start as u32))?;
            // `\"""` is not the end.
            if position > start + 3 && self.byte(position - 1) == Some(b'\\') {
                position += 3;
            } else {
                return Ok(position + 3);
            }
        }
    }

    fn advance(&mut self) -> Result<()> {
        self.last_end = self.token.end;
        self.token = self.lookahead()?;
        self.next = None;
        Ok(())
    }

    /// The token after the current one.
    fn lookahead(&mut self) -> Result<Token> {
        if self.token.kind == TokenKind::EndOfFile {
            return Ok(self.token);
        }
        match self.next {
            Some(next) => Ok(next),
            None => {
                let next = self.read_token(self.token.end)?;
                self.next = Some(next);
                Ok(next)
            }
        }
    }

    fn text_of(&self, token: Token) -> &[u8] {
        self.text
            .get(token.start as usize..token.end as usize)
            .unwrap_or_default()
    }

    fn peek(&self, kind: TokenKind) -> bool {
        self.token.kind == kind
    }

    fn is_keyword(&self, token: Token, keyword: &[u8]) -> bool {
        token.kind == TokenKind::Name && self.text_of(token) == keyword
    }

    /// `message`, where the current token is.
    #[cold]
    fn unexpected(&self, message: Message) -> Refused {
        let message = match self.token.kind {
            TokenKind::EndOfFile => Message::UnexpectedEnd,
            _ => message,
        };
        self.refusal.note(message, self.token.start)
    }

    fn expect(&mut self, kind: TokenKind) -> Result<Token> {
        let token = self.token;
        if token.kind != kind {
            return Err(self.unexpected(expected(kind)));
        }
        self.advance()?;
        Ok(token)
    }

    fn eat(&mut self, kind: TokenKind) -> Result<bool> {
        let is_there = self.peek(kind);
        if is_there {
            self.advance()?;
        }
        Ok(is_there)
    }

    fn expect_keyword(&mut self, keyword: &[u8]) -> Result<()> {
        match self.eat_keyword(keyword)? {
            true => Ok(()),
            false => Err(self.unexpected(Message::UnexpectedToken)),
        }
    }

    fn eat_keyword(&mut self, keyword: &[u8]) -> Result<bool> {
        let is_there = self.is_keyword(self.token, keyword);
        if is_there {
            self.advance()?;
        }
        Ok(is_there)
    }

    // ───────────────────────────── nodes ─────────────────────────────

    /// What [`Parser::finish`] needs to know of where a node starts.
    fn begin(&self) -> (u32, usize) {
        (self.token.start, self.tree.pending.len())
    }

    /// The node that started at `begin` ends before the current token. What has been finished since
    /// then are its children.
    fn finish(&mut self, kind: Kind, flags: u8, (start, first_pending): (u32, usize)) {
        let tree = &mut *self.tree;
        let first_child = tree.children.len() as u32;
        tree.children
            .extend(tree.pending.drain(first_pending.min(tree.pending.len())..));
        tree.pending.push(tree.nodes.len() as NodeId);
        tree.nodes.push(Node {
            kind,
            flags,
            span: Span::new(start, self.last_end.max(start)),
            first_child,
            child_count: tree.children.len() as u32 - first_child,
        });
    }

    /// The current token is all of a node.
    fn token_as(&mut self, kind: Kind, flags: u8) -> Result<()> {
        let begin = self.begin();
        self.advance()?;
        self.finish(kind, flags, begin);
        Ok(())
    }

    fn check_depth(&self) -> Result<()> {
        match self.stack_check.is_safe_to_recurse() {
            true => Ok(()),
            false => Err(self
                .refusal
                .note(Message::NestedTooDeeply, self.token.start)),
        }
    }

    /// `open item+ close`
    fn many(
        &mut self,
        open: TokenKind,
        item: fn(&mut Self) -> Result<()>,
        close: TokenKind,
    ) -> Result<()> {
        self.expect(open)?;
        loop {
            item(self)?;
            if self.eat(close)? {
                return Ok(());
            }
        }
    }

    /// The same, if it is there. Returns whether it is.
    fn optional_many(
        &mut self,
        open: TokenKind,
        item: fn(&mut Self) -> Result<()>,
        close: TokenKind,
    ) -> Result<bool> {
        let is_there = self.peek(open);
        if is_there {
            self.many(open, item, close)?;
        }
        Ok(is_there)
    }

    /// `open item* close`
    fn any(
        &mut self,
        open: TokenKind,
        item: fn(&mut Self) -> Result<()>,
        close: TokenKind,
    ) -> Result<()> {
        self.expect(open)?;
        while !self.eat(close)? {
            item(self)?;
        }
        Ok(())
    }

    /// `delimiter? item (delimiter item)*`
    fn delimited_many(
        &mut self,
        delimiter: TokenKind,
        item: fn(&mut Self) -> Result<()>,
    ) -> Result<()> {
        self.eat(delimiter)?;
        loop {
            item(self)?;
            if !self.eat(delimiter)? {
                return Ok(());
            }
        }
    }

    // ───────────────────────────── the grammar ─────────────────────────────

    fn parse_name(&mut self) -> Result<()> {
        match self.peek(TokenKind::Name) {
            true => self.token_as(Kind::Name, 0),
            false => Err(self.unexpected(Message::ExpectedName)),
        }
    }

    fn parse_document(&mut self) -> Result<()> {
        let begin = self.begin();
        self.many(
            TokenKind::StartOfFile,
            Self::parse_definition,
            TokenKind::EndOfFile,
        )?;
        self.finish(Kind::Document, 0, begin);
        Ok(())
    }

    fn parse_definition(&mut self) -> Result<()> {
        if self.peek(TokenKind::BraceL) {
            return self.parse_operation_definition();
        }
        let has_description = self.peek_description();
        let keyword = if has_description {
            self.lookahead()?
        } else {
            self.token
        };
        if keyword.kind != TokenKind::Name {
            return Err(self.unexpected(Message::ExpectedDefinition));
        }
        match self.text_of(keyword) {
            b"schema" => self.parse_schema_definition(),
            b"scalar" => self.parse_scalar_type_definition(),
            b"type" => self.parse_object_like_definition(b"type", Kind::ObjectTypeDefinition),
            b"interface" => {
                self.parse_object_like_definition(b"interface", Kind::InterfaceTypeDefinition)
            }
            b"union" => self.parse_union_type_definition(),
            b"enum" => self.parse_enum_type_definition(),
            b"input" => self.parse_input_object_type_definition(),
            b"directive" => self.parse_directive_definition(),
            b"query" | b"mutation" | b"subscription" => self.parse_operation_definition(),
            b"fragment" => self.parse_fragment_definition(),
            b"extend" if !has_description => self.parse_type_system_extension(),
            _ => Err(self.unexpected(Message::ExpectedDefinition)),
        }
    }

    fn parse_operation_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        let mut flags = IS_SHORTHAND;
        if !self.peek(TokenKind::BraceL) {
            self.parse_description()?;
            flags = self.parse_operation_type()?;
            if self.peek(TokenKind::Name) {
                self.parse_name()?;
            }
            self.parse_variable_definitions()?;
            self.parse_directives()?;
        }
        self.parse_selection_set()?;
        self.finish(Kind::OperationDefinition, flags, begin);
        Ok(())
    }

    /// `query`, `mutation` or `subscription`, which is not a node but a flag of the node it is in.
    fn parse_operation_type(&mut self) -> Result<u8> {
        let token = self.expect(TokenKind::Name)?;
        match self.text_of(token) {
            b"query" => Ok(QUERY),
            b"mutation" => Ok(MUTATION),
            b"subscription" => Ok(SUBSCRIPTION),
            _ => Err(self.refusal.note(Message::ExpectedDefinition, token.start)),
        }
    }

    fn parse_variable_definitions(&mut self) -> Result<bool> {
        self.optional_many(
            TokenKind::ParenL,
            Self::parse_variable_definition,
            TokenKind::ParenR,
        )
    }

    fn parse_variable_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.parse_variable()?;
        self.expect(TokenKind::Colon)?;
        self.parse_type_reference()?;
        if self.eat(TokenKind::Equals)? {
            self.parse_const_value()?;
        }
        self.parse_const_directives()?;
        self.finish(Kind::VariableDefinition, 0, begin);
        Ok(())
    }

    fn parse_variable(&mut self) -> Result<()> {
        let begin = self.begin();
        self.expect(TokenKind::Dollar)?;
        self.parse_name()?;
        self.finish(Kind::Variable, 0, begin);
        Ok(())
    }

    fn parse_selection_set(&mut self) -> Result<()> {
        self.check_depth()?;
        let begin = self.begin();
        self.many(TokenKind::BraceL, Self::parse_selection, TokenKind::BraceR)?;
        self.finish(Kind::SelectionSet, 0, begin);
        Ok(())
    }

    fn parse_selection(&mut self) -> Result<()> {
        match self.peek(TokenKind::Spread) {
            true => self.parse_fragment(),
            false => self.parse_field(),
        }
    }

    fn parse_field(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_name()?;
        let has_alias = self.eat(TokenKind::Colon)?;
        if has_alias {
            self.parse_name()?;
        }
        self.optional_many(TokenKind::ParenL, Self::parse_argument, TokenKind::ParenR)?;
        self.parse_directives()?;
        if self.peek(TokenKind::BraceL) {
            self.parse_selection_set()?;
        }
        self.finish(Kind::Field, if has_alias { HAS_ALIAS } else { 0 }, begin);
        Ok(())
    }

    /// `name: value`
    fn parse_named_value(&mut self, kind: Kind, value: fn(&mut Self) -> Result<()>) -> Result<()> {
        let begin = self.begin();
        self.parse_name()?;
        self.expect(TokenKind::Colon)?;
        value(self)?;
        self.finish(kind, 0, begin);
        Ok(())
    }

    fn parse_argument(&mut self) -> Result<()> {
        self.parse_named_value(Kind::Argument, Self::parse_value)
    }

    fn parse_const_argument(&mut self) -> Result<()> {
        self.parse_named_value(Kind::Argument, Self::parse_const_value)
    }

    fn parse_fragment_argument(&mut self) -> Result<()> {
        self.parse_named_value(Kind::FragmentArgument, Self::parse_value)
    }

    fn parse_fragment(&mut self) -> Result<()> {
        let begin = self.begin();
        self.expect(TokenKind::Spread)?;
        let has_type_condition = self.eat_keyword(b"on")?;
        if !has_type_condition && self.peek(TokenKind::Name) {
            self.parse_fragment_name()?;
            self.optional_many(
                TokenKind::ParenL,
                Self::parse_fragment_argument,
                TokenKind::ParenR,
            )?;
            self.parse_directives()?;
            self.finish(Kind::FragmentSpread, 0, begin);
            return Ok(());
        }
        if has_type_condition {
            self.parse_named_type()?;
        }
        self.parse_directives()?;
        self.parse_selection_set()?;
        self.finish(Kind::InlineFragment, 0, begin);
        Ok(())
    }

    fn parse_fragment_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"fragment")?;
        self.parse_fragment_name()?;
        self.parse_variable_definitions()?;
        self.expect_keyword(b"on")?;
        self.parse_named_type()?;
        self.parse_directives()?;
        self.parse_selection_set()?;
        self.finish(Kind::FragmentDefinition, 0, begin);
        Ok(())
    }

    fn parse_fragment_name(&mut self) -> Result<()> {
        match self.is_keyword(self.token, b"on") {
            true => Err(self.unexpected(Message::ExpectedName)),
            false => self.parse_name(),
        }
    }

    fn parse_value(&mut self) -> Result<()> {
        self.parse_value_literal(false)
    }

    fn parse_const_value(&mut self) -> Result<()> {
        self.parse_value_literal(true)
    }

    fn parse_value_literal(&mut self, is_const: bool) -> Result<()> {
        let value = if is_const {
            Self::parse_const_value
        } else {
            Self::parse_value
        };
        match self.token.kind {
            TokenKind::BracketL => {
                self.check_depth()?;
                let begin = self.begin();
                self.any(TokenKind::BracketL, value, TokenKind::BracketR)?;
                self.finish(Kind::ListValue, 0, begin);
                Ok(())
            }
            TokenKind::BraceL => {
                self.check_depth()?;
                let begin = self.begin();
                let field = if is_const {
                    Self::parse_const_object_field
                } else {
                    Self::parse_object_field
                };
                self.any(TokenKind::BraceL, field, TokenKind::BraceR)?;
                self.finish(Kind::ObjectValue, 0, begin);
                Ok(())
            }
            TokenKind::Int => self.token_as(Kind::IntValue, 0),
            TokenKind::Float => self.token_as(Kind::FloatValue, 0),
            TokenKind::String => self.token_as(Kind::StringValue, 0),
            TokenKind::BlockString => self.token_as(Kind::StringValue, IS_BLOCK),
            TokenKind::Name => {
                let kind = match self.text_of(self.token) {
                    b"true" | b"false" => Kind::BooleanValue,
                    b"null" => Kind::NullValue,
                    _ => Kind::EnumValue,
                };
                self.token_as(kind, 0)
            }
            TokenKind::Dollar if !is_const => self.parse_variable(),
            _ => Err(self.unexpected(Message::ExpectedValue)),
        }
    }

    fn parse_object_field(&mut self) -> Result<()> {
        self.parse_named_value(Kind::ObjectField, Self::parse_value)
    }

    fn parse_const_object_field(&mut self) -> Result<()> {
        self.parse_named_value(Kind::ObjectField, Self::parse_const_value)
    }

    /// Returns whether there is one.
    fn parse_directives_of(&mut self, argument: fn(&mut Self) -> Result<()>) -> Result<bool> {
        let is_there = self.peek(TokenKind::At);
        while self.peek(TokenKind::At) {
            let begin = self.begin();
            self.advance()?;
            self.parse_name()?;
            self.optional_many(TokenKind::ParenL, argument, TokenKind::ParenR)?;
            self.finish(Kind::Directive, 0, begin);
        }
        Ok(is_there)
    }

    fn parse_directives(&mut self) -> Result<bool> {
        self.parse_directives_of(Self::parse_argument)
    }

    fn parse_const_directives(&mut self) -> Result<bool> {
        self.parse_directives_of(Self::parse_const_argument)
    }

    fn parse_type_reference(&mut self) -> Result<()> {
        self.check_depth()?;
        let begin = self.begin();
        if self.eat(TokenKind::BracketL)? {
            self.parse_type_reference()?;
            self.expect(TokenKind::BracketR)?;
            self.finish(Kind::ListType, 0, begin);
        } else {
            self.parse_named_type()?;
        }
        if self.eat(TokenKind::Bang)? {
            self.finish(Kind::NonNullType, 0, begin);
        }
        Ok(())
    }

    fn parse_named_type(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_name()?;
        self.finish(Kind::NamedType, 0, begin);
        Ok(())
    }

    fn peek_description(&self) -> bool {
        self.peek(TokenKind::String) || self.peek(TokenKind::BlockString)
    }

    fn parse_description(&mut self) -> Result<()> {
        match self.token.kind {
            TokenKind::String => self.token_as(Kind::StringValue, 0),
            TokenKind::BlockString => self.token_as(Kind::StringValue, IS_BLOCK),
            _ => Ok(()),
        }
    }

    fn parse_schema_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"schema")?;
        self.parse_const_directives()?;
        self.many(
            TokenKind::BraceL,
            Self::parse_operation_type_definition,
            TokenKind::BraceR,
        )?;
        self.finish(Kind::SchemaDefinition, 0, begin);
        Ok(())
    }

    fn parse_operation_type_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        let operation = self.parse_operation_type()?;
        self.expect(TokenKind::Colon)?;
        self.parse_named_type()?;
        self.finish(Kind::OperationTypeDefinition, operation, begin);
        Ok(())
    }

    fn parse_scalar_type_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"scalar")?;
        self.parse_name()?;
        self.parse_const_directives()?;
        self.finish(Kind::ScalarTypeDefinition, 0, begin);
        Ok(())
    }

    /// `type A implements B @c { .. }`, `interface A ..`
    fn parse_object_like_definition(&mut self, keyword: &[u8], kind: Kind) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(keyword)?;
        self.parse_name()?;
        self.parse_implements_interfaces()?;
        self.parse_const_directives()?;
        self.parse_fields_definition()?;
        self.finish(kind, 0, begin);
        Ok(())
    }

    fn parse_implements_interfaces(&mut self) -> Result<bool> {
        let is_there = self.eat_keyword(b"implements")?;
        if is_there {
            self.delimited_many(TokenKind::Amp, Self::parse_named_type)?;
        }
        Ok(is_there)
    }

    fn parse_fields_definition(&mut self) -> Result<bool> {
        self.optional_many(
            TokenKind::BraceL,
            Self::parse_field_definition,
            TokenKind::BraceR,
        )
    }

    fn parse_field_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.parse_name()?;
        self.parse_argument_definitions()?;
        self.expect(TokenKind::Colon)?;
        self.parse_type_reference()?;
        self.parse_const_directives()?;
        self.finish(Kind::FieldDefinition, 0, begin);
        Ok(())
    }

    fn parse_argument_definitions(&mut self) -> Result<bool> {
        self.optional_many(
            TokenKind::ParenL,
            Self::parse_input_value_definition,
            TokenKind::ParenR,
        )
    }

    fn parse_input_value_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.parse_name()?;
        self.expect(TokenKind::Colon)?;
        self.parse_type_reference()?;
        if self.eat(TokenKind::Equals)? {
            self.parse_const_value()?;
        }
        self.parse_const_directives()?;
        self.finish(Kind::InputValueDefinition, 0, begin);
        Ok(())
    }

    fn parse_union_type_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"union")?;
        self.parse_name()?;
        self.parse_const_directives()?;
        self.parse_union_member_types()?;
        self.finish(Kind::UnionTypeDefinition, 0, begin);
        Ok(())
    }

    fn parse_union_member_types(&mut self) -> Result<bool> {
        let is_there = self.eat(TokenKind::Equals)?;
        if is_there {
            self.delimited_many(TokenKind::Pipe, Self::parse_named_type)?;
        }
        Ok(is_there)
    }

    fn parse_enum_type_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"enum")?;
        self.parse_name()?;
        self.parse_const_directives()?;
        self.parse_enum_values_definition()?;
        self.finish(Kind::EnumTypeDefinition, 0, begin);
        Ok(())
    }

    fn parse_enum_values_definition(&mut self) -> Result<bool> {
        self.optional_many(
            TokenKind::BraceL,
            Self::parse_enum_value_definition,
            TokenKind::BraceR,
        )
    }

    fn parse_enum_value_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        if matches!(self.text_of(self.token), b"true" | b"false" | b"null") {
            return Err(self.unexpected(Message::ExpectedName));
        }
        self.parse_name()?;
        self.parse_const_directives()?;
        self.finish(Kind::EnumValueDefinition, 0, begin);
        Ok(())
    }

    fn parse_input_object_type_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"input")?;
        self.parse_name()?;
        self.parse_const_directives()?;
        self.parse_input_fields_definition()?;
        self.finish(Kind::InputObjectTypeDefinition, 0, begin);
        Ok(())
    }

    fn parse_input_fields_definition(&mut self) -> Result<bool> {
        self.optional_many(
            TokenKind::BraceL,
            Self::parse_input_value_definition,
            TokenKind::BraceR,
        )
    }

    /// `extend ..`. An extension has to add something.
    fn parse_type_system_extension(&mut self) -> Result<()> {
        let begin = self.begin();
        self.expect_keyword(b"extend")?;
        let keyword = self.expect(TokenKind::Name)?;
        let (kind, adds_something) = match self.text_of(keyword) {
            b"schema" => {
                let has_directives = self.parse_const_directives()?;
                let has_types = self.optional_many(
                    TokenKind::BraceL,
                    Self::parse_operation_type_definition,
                    TokenKind::BraceR,
                )?;
                (Kind::SchemaExtension, has_directives || has_types)
            }
            b"scalar" => {
                self.parse_name()?;
                (Kind::ScalarTypeExtension, self.parse_const_directives()?)
            }
            keyword @ (b"type" | b"interface") => {
                let kind = if keyword == b"type" {
                    Kind::ObjectTypeExtension
                } else {
                    Kind::InterfaceTypeExtension
                };
                self.parse_name()?;
                let has_interfaces = self.parse_implements_interfaces()?;
                let has_directives = self.parse_const_directives()?;
                let has_fields = self.parse_fields_definition()?;
                (kind, has_interfaces || has_directives || has_fields)
            }
            b"union" => {
                self.parse_name()?;
                let has_directives = self.parse_const_directives()?;
                let has_types = self.parse_union_member_types()?;
                (Kind::UnionTypeExtension, has_directives || has_types)
            }
            b"enum" => {
                self.parse_name()?;
                let has_directives = self.parse_const_directives()?;
                let has_values = self.parse_enum_values_definition()?;
                (Kind::EnumTypeExtension, has_directives || has_values)
            }
            b"input" => {
                self.parse_name()?;
                let has_directives = self.parse_const_directives()?;
                let has_fields = self.parse_input_fields_definition()?;
                (Kind::InputObjectTypeExtension, has_directives || has_fields)
            }
            b"directive" => {
                self.expect(TokenKind::At)?;
                self.parse_name()?;
                (Kind::DirectiveExtension, self.parse_const_directives()?)
            }
            _ => return Err(self.unexpected(Message::ExpectedDefinition)),
        };
        if !adds_something {
            return Err(self.refusal.note(Message::EmptyExtension, self.last_end));
        }
        self.finish(kind, 0, begin);
        Ok(())
    }

    fn parse_directive_definition(&mut self) -> Result<()> {
        let begin = self.begin();
        self.parse_description()?;
        self.expect_keyword(b"directive")?;
        self.expect(TokenKind::At)?;
        self.parse_name()?;
        self.parse_argument_definitions()?;
        self.parse_const_directives()?;
        let is_repeatable = self.eat_keyword(b"repeatable")?;
        self.expect_keyword(b"on")?;
        self.delimited_many(TokenKind::Pipe, Self::parse_directive_location)?;
        self.finish(
            Kind::DirectiveDefinition,
            if is_repeatable { IS_REPEATABLE } else { 0 },
            begin,
        );
        Ok(())
    }

    fn parse_directive_location(&mut self) -> Result<()> {
        const LOCATIONS: [&[u8]; 21] = [
            b"QUERY",
            b"MUTATION",
            b"SUBSCRIPTION",
            b"FIELD",
            b"FRAGMENT_DEFINITION",
            b"FRAGMENT_SPREAD",
            b"INLINE_FRAGMENT",
            b"VARIABLE_DEFINITION",
            b"FRAGMENT_VARIABLE_DEFINITION",
            b"SCHEMA",
            b"SCALAR",
            b"OBJECT",
            b"FIELD_DEFINITION",
            b"ARGUMENT_DEFINITION",
            b"INTERFACE",
            b"UNION",
            b"ENUM",
            b"ENUM_VALUE",
            b"INPUT_OBJECT",
            b"INPUT_FIELD_DEFINITION",
            b"DIRECTIVE_DEFINITION",
        ];
        match LOCATIONS.contains(&self.text_of(self.token)) {
            true => self.parse_name(),
            false => Err(self.unexpected(Message::ExpectedDirectiveLocation)),
        }
    }
}
