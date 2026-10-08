//! `angular-html-parser` 10.12: `ml_parser/parser.ts`.

use super::ast::{Attribute, Id, Kind, Node, Span, StartTagComment, Tree};
use super::data::{self, TagDefinition};
use super::lexer::{self, ContentType, GetTagContentType, LexedAttribute, Parts, Token, TokenType};
use std::borrow::Cow;

/// How many elements, blocks and cases can be in each other.
pub(crate) const MAX_DEPTH: usize = 400;

#[derive(Copy, Clone)]
pub(crate) struct Options<'f> {
    pub(crate) lexer: lexer::Options,
    pub(crate) is_tag_name_case_sensitive: bool,
    /// Prettier's `shouldParseAsRawText(tagName, prefix, hasParent, attrs)`
    pub(crate) should_parse_as_raw_text:
        Option<&'f dyn Fn(&[u8], bool, &[LexedAttribute<'_>]) -> bool>,
}

pub(crate) struct ParseResult {
    /// Its children are the `rootNodes`.
    pub(crate) root: Id,
    /// Where the spans of the errors start.
    pub(crate) errors: Vec<u32>,
    pub(crate) is_nested_too_deeply: bool,
}

struct TreeBuilder<'a, 't, 'k> {
    text: &'a [u8],
    tree: &'t mut Tree<'a>,
    tokens: &'k [Token],
    index: usize,
    /// Where the tokens end that this is about, and what comes in the place of the token there.
    end: usize,
    eof: Token,
    container_stack: Vec<Id>,
    /// What is in no container goes here.
    root: Id,
    errors: Vec<u32>,
    can_self_close: bool,
    allow_htm_component_closing_tags: bool,
    is_tag_name_case_sensitive: bool,
    is_nested_too_deeply: bool,
    /// How many elements, blocks and cases are around what is built.
    base_depth: usize,
}

/// A name with its namespace: `:namespace:name`.
#[derive(Copy, Clone, PartialEq, Eq)]
struct FullName<'a> {
    prefix: &'a [u8],
    name: &'a [u8],
}

pub(crate) fn definition_of(name: &[u8], is_case_sensitive: bool) -> &'static TagDefinition {
    match is_case_sensitive || !name.iter().any(u8::is_ascii_uppercase) {
        true => data::tag_definition(name),
        false => data::tag_definition(&name.to_ascii_lowercase()),
    }
}

impl<'a> TreeBuilder<'a, '_, '_> {
    fn peek(&self) -> Token {
        match self.index < self.end {
            true => self.tokens.get(self.index).copied().unwrap_or(self.eof),
            false => self.eof,
        }
    }

    fn advance(&mut self) -> Token {
        let token = self.peek();
        if self.index < self.end {
            self.index += 1;
        }
        token
    }

    fn advance_if(&mut self, kind: TokenType) -> Option<Token> {
        (self.peek().kind == kind).then(|| self.advance())
    }

    /// The definition of what has the full name `:prefix:name`: there is none with a colon in the name.
    fn definition(&self, name: FullName<'_>) -> &'static TagDefinition {
        match name.prefix {
            b"" => definition_of(name.name, self.is_tag_name_case_sensitive),
            _ => &data::DEFAULT_TAG_DEFINITION,
        }
    }

    /// `_getTagDefinition(node)`
    fn definition_of_node(&self, id: Id) -> Option<&'static TagDefinition> {
        (self.tree[id].kind == Kind::Element).then(|| self.definition(self.full_name_of(id)))
    }

    /// While the tree is built, the name of an element is a part of the text, and so is its namespace.
    fn full_name_of(&self, id: Id) -> FullName<'a> {
        let node = &self.tree[id];
        FullName {
            prefix: node.namespace,
            name: match &node.name {
                Cow::Borrowed(name) => name,
                Cow::Owned(_) => b"",
            },
        }
    }

    fn build(&mut self) {
        use TokenType::*;
        while self.peek().kind != Eof && !self.is_nested_too_deeply {
            let kind = self.peek().kind;
            if matches!(
                kind,
                TagClose
                    | CdataStart
                    | CommentStart
                    | Text
                    | RawText
                    | EscapableRawText
                    | BlockOpenStart
                    | BlockClose
                    | IncompleteBlockOpen
                    | LetStart
                    | IncompleteLet
            ) {
                self.close_void_element();
            }
            let token = self.advance();
            match kind {
                TagOpenStart | IncompleteTagOpen => self.consume_element_start_tag(token),
                TagClose => self.consume_element_end_tag(token),
                CdataStart => self.consume_cdata(token),
                CommentStart => self.consume_comment(token),
                Text | RawText | EscapableRawText => self.consume_text(token),
                ExpansionFormStart => self.consume_expansion(token),
                BlockOpenStart => self.consume_block_open(token),
                BlockClose => self.consume_block_close(token),
                IncompleteBlockOpen => self.consume_incomplete_block(token),
                LetStart => self.consume_let(token),
                DocTypeStart => self.consume_doc_type(token),
                IncompleteLet => self.errors.push(token.span.start),
                _ => {}
            }
        }
        for &container in &self.container_stack {
            let container = &self.tree[container];
            if container.kind == Kind::AngularControlFlowBlock {
                self.errors.push(container.span.start);
            }
        }
    }

    fn container(&self) -> Option<Id> {
        self.container_stack.last().copied()
    }

    fn closest_element_like_parent(&self) -> Option<Id> {
        self.container_stack
            .iter()
            .rev()
            .copied()
            .find(|&id| self.tree[id].kind == Kind::Element)
    }

    fn add_to_parent(&mut self, node: Node<'a>) -> Id {
        let id = self.tree.add(node);
        self.tree
            .append_child(self.container().unwrap_or(self.root), id);
        id
    }

    /// Whether a line feed at the start of a text in `parent` does not count.
    fn ignores_first_lf(&self, parent: Option<Id>) -> bool {
        parent.is_some_and(|parent| {
            !self.tree.has_children(parent)
                && self
                    .definition_of_node(parent)
                    .is_some_and(|it| it.ignore_first_lf)
        })
    }

    fn consume_cdata(&mut self, start_token: Token) {
        let text = self.advance();
        let mut value = text.span.of(self.text);
        if value.first() == Some(&b'\n')
            && self.ignores_first_lf(self.closest_element_like_parent())
        {
            value = &value[1..];
        }
        let end_token = self.advance_if(TokenType::CdataEnd);
        let mut node = Node::new(
            Kind::Cdata,
            Span::new(start_token.span.start, end_token.unwrap_or(text).span.end),
        );
        node.value = Cow::Borrowed(value);
        self.add_to_parent(node);
    }

    fn consume_comment(&mut self, token: Token) {
        self.advance_if(TokenType::RawText);
        let end_token = self.advance_if(TokenType::CommentEnd);
        let span = Span::new(token.span.start, end_token.unwrap_or(token).span.end);
        self.add_to_parent(Node::new(Kind::Comment, span));
    }

    fn consume_doc_type(&mut self, start_token: Token) {
        let text = self.advance_if(TokenType::RawText);
        let end_token = self.advance_if(TokenType::DocTypeEnd);
        let end = end_token.or(text).unwrap_or(start_token).span.end;
        let mut node = Node::new(Kind::DocType, Span::new(start_token.span.start, end));
        node.value = Cow::Borrowed(text.map_or(&b""[..], |text| {
            crate::css::text::trim(text.span.of(self.text))
        }));
        self.add_to_parent(node);
    }

    fn value_of(&self, token: Token) -> &'a [u8] {
        match token.parts {
            Parts::Value(span) => span.of(self.text),
            Parts::ElseIf => b"else if",
            Parts::DefaultNever => b"default never",
            _ => token.span.of(self.text),
        }
    }

    fn consume_expansion(&mut self, token: Token) {
        let switch_value = self.advance();
        let kind = self.advance();
        let expansion = self
            .tree
            .add(Node::new(Kind::AngularIcuExpression, token.span));
        while self.peek().kind == TokenType::ExpansionCaseValue {
            match self.parse_expansion_case() {
                Some(case) => self.tree.append_child(expansion, case),
                None => return,
            }
        }
        if self.peek().kind != TokenType::ExpansionFormEnd {
            self.errors.push(self.peek().span.start);
            return;
        }
        let end = self.advance().span.end;
        let node = &mut self.tree[expansion];
        node.span.end = end;
        node.value = Cow::Borrowed(switch_value.span.of(self.text));
        node.name = Cow::Borrowed(kind.span.of(self.text));
        self.tree
            .append_child(self.container().unwrap_or(self.root), expansion);
    }

    fn parse_expansion_case(&mut self) -> Option<Id> {
        let value = self.advance();
        if self.peek().kind != TokenType::ExpansionCaseExpStart {
            self.errors.push(self.peek().span.start);
            return None;
        }
        let start = self.advance();
        let first = self.index;
        self.skip_expansion_exp_tokens(start)?;
        let last = self.index;
        let end = self.advance();
        let base_depth = self.base_depth + self.container_stack.len() + 1;
        if base_depth > MAX_DEPTH {
            self.is_nested_too_deeply = true;
            return None;
        }
        let mut node = Node::new(
            Kind::AngularIcuCase,
            Span::new(value.span.start, end.span.end),
        );
        node.value = Cow::Borrowed(self.value_of(value));
        let case = self.tree.add(node);
        let mut builder = TreeBuilder {
            text: self.text,
            tree: &mut *self.tree,
            tokens: self.tokens,
            index: first,
            end: last,
            eof: Token {
                kind: TokenType::Eof,
                span: end.span,
                parts: Parts::None,
            },
            container_stack: Vec::new(),
            root: case,
            errors: Vec::new(),
            can_self_close: self.can_self_close,
            allow_htm_component_closing_tags: self.allow_htm_component_closing_tags,
            is_tag_name_case_sensitive: self.is_tag_name_case_sensitive,
            is_nested_too_deeply: false,
            base_depth,
        };
        builder.build();
        let (errors, is_nested_too_deeply) = (builder.errors, builder.is_nested_too_deeply);
        self.is_nested_too_deeply |= is_nested_too_deeply;
        if !errors.is_empty() {
            self.errors.extend(errors);
            return None;
        }
        Some(case)
    }

    /// `_collectExpansionExpTokens`: goes on to the token that ends the case.
    fn skip_expansion_exp_tokens(&mut self, start: Token) -> Option<()> {
        use TokenType::{
            Eof, ExpansionCaseExpEnd, ExpansionCaseExpStart, ExpansionFormEnd, ExpansionFormStart,
        };
        let mut stack = vec![ExpansionCaseExpStart];
        loop {
            let kind = self.peek().kind;
            if matches!(kind, ExpansionFormStart | ExpansionCaseExpStart) {
                stack.push(kind);
            }
            if kind == ExpansionCaseExpEnd {
                if stack.last() != Some(&ExpansionCaseExpStart) {
                    self.errors.push(start.span.start);
                    return None;
                }
                stack.pop();
                if stack.is_empty() {
                    return Some(());
                }
            }
            if kind == ExpansionFormEnd {
                if stack.last() != Some(&ExpansionFormStart) {
                    self.errors.push(start.span.start);
                    return None;
                }
                stack.pop();
            }
            if kind == Eof {
                self.errors.push(start.span.start);
                return None;
            }
            self.advance();
        }
    }

    fn consume_text(&mut self, token: Token) {
        let start = token.span.start;
        let mut end = token.span.end;
        let mut len = token.span.len();
        if token.span.of(self.text).first() == Some(&b'\n')
            && self.ignores_first_lf(self.container())
        {
            len -= 1;
        }
        while matches!(
            self.peek().kind,
            TokenType::Interpolation | TokenType::Text | TokenType::EncodedEntity
        ) {
            let token = self.advance();
            len += token.span.len();
            end = token.span.end;
        }
        if len > 0 {
            self.add_to_parent(Node::new(Kind::Text, Span::new(start, end)));
        }
    }

    fn close_void_element(&mut self) {
        if self
            .container()
            .and_then(|it| self.definition_of_node(it))
            .is_some_and(|it| it.is_void)
        {
            self.container_stack.pop();
        }
    }

    /// `_getElementFullName`
    fn full_name(&self, token: Token, parent: Option<Id>) -> FullName<'a> {
        let Parts::Name(prefix, name) = token.parts else {
            return FullName {
                prefix: b"",
                name: b"",
            };
        };
        let name = name.of(self.text);
        let mut prefix = prefix.of(self.text);
        if prefix.is_empty() {
            prefix = definition_of(name, self.is_tag_name_case_sensitive)
                .implicit_namespace_prefix
                .unwrap_or_default();
        }
        if prefix.is_empty()
            && let Some(parent) = parent
        {
            let parent = self.full_name_of(parent);
            if !definition_of(parent.name, self.is_tag_name_case_sensitive)
                .prevent_namespace_inheritance
            {
                prefix = parent.prefix;
            }
        }
        FullName { prefix, name }
    }

    fn consume_element_start_tag(&mut self, start_tag_token: Token) {
        let first_attr = self.tree.attrs.len() as u32;
        let first_comment = self.tree.start_tag_comments.len() as u32;
        loop {
            match self.peek().kind {
                TokenType::AttrName => {
                    let name = self.advance();
                    let attr = self.consume_attr(name);
                    self.tree.attrs.push(attr);
                }
                TokenType::InElementComment => {
                    let token = self.advance();
                    if let Parts::Comment(content, is_single_line) = token.parts {
                        self.tree.start_tag_comments.push(StartTagComment {
                            span: token.span,
                            value: content.of(self.text),
                            is_single_line,
                        });
                    }
                }
                _ => break,
            }
        }
        let full_name = self.full_name(start_tag_token, self.closest_element_like_parent());
        let definition = self.definition(full_name);
        let mut is_self_closing = false;
        if self.peek().kind == TokenType::TagOpenEndVoid {
            self.advance();
            is_self_closing = true;
            if !(self.can_self_close
                || definition.can_self_close
                || !full_name.prefix.is_empty()
                || definition.is_void)
            {
                self.errors.push(start_tag_token.span.start);
            }
        } else if self.peek().kind == TokenType::TagOpenEnd {
            self.advance();
        }
        let span = Span::new(start_tag_token.span.start, self.peek().span.start);
        let mut node = Node::new(Kind::Element, span);
        node.set_start_span(span);
        node.name_span = Span::new(start_tag_token.span.start + 1, start_tag_token.span.end);
        node.name = Cow::Borrowed(full_name.name);
        node.namespace = full_name.prefix;
        node.attrs = (first_attr, self.tree.attrs.len() as u32);
        node.start_tag_comments = (first_comment, self.tree.start_tag_comments.len() as u32);
        let is_closed_by_child = self
            .container()
            .and_then(|it| self.definition_of_node(it))
            .is_some_and(|it| {
                // The full name of the child is asked for: with a namespace, no list has it.
                it.is_void || (full_name.prefix.is_empty() && it.is_closed_by_child(full_name.name))
            });
        self.push_container(node, is_closed_by_child);
        if is_self_closing {
            self.pop_container(Some(full_name), Kind::Element, Some(span));
        } else if start_tag_token.kind == TokenType::IncompleteTagOpen {
            self.pop_container(Some(full_name), Kind::Element, None);
            self.errors.push(span.start);
        }
    }

    fn push_container(&mut self, node: Node<'a>, is_closed_by_child: bool) {
        if is_closed_by_child {
            self.container_stack.pop();
        }
        let id = self.add_to_parent(node);
        self.container_stack.push(id);
        if self.base_depth + self.container_stack.len() > MAX_DEPTH {
            self.is_nested_too_deeply = true;
        }
    }

    fn consume_element_end_tag(&mut self, end_tag_token: Token) {
        let full_name =
            match self.allow_htm_component_closing_tags && end_tag_token.parts == Parts::None {
                true => None,
                false => Some(self.full_name(end_tag_token, self.closest_element_like_parent())),
            };
        if full_name.is_some_and(|it| self.definition(it).is_void)
            || !self.pop_container(full_name, Kind::Element, Some(end_tag_token.span))
        {
            self.errors.push(end_tag_token.span.start);
        }
    }

    /// `_popContainer`
    fn pop_container(
        &mut self,
        expected_name: Option<FullName<'a>>,
        expected_kind: Kind,
        end_span: Option<Span>,
    ) -> bool {
        let mut unexpected_close_tag_detected = false;
        for stack_index in (0..self.container_stack.len()).rev() {
            let id = self.container_stack[stack_index];
            let kind = self.tree[id].kind;
            // The name of a block has no namespace, and is never asked for.
            let name = self.full_name_of(id);
            let is_expected = match kind == Kind::Element && !name.prefix.is_empty() {
                true => Some(name) == expected_name,
                false => {
                    expected_name.is_none_or(|expected| kind == Kind::Element && expected == name)
                        && kind == expected_kind
                }
            };
            if is_expected {
                let node = &mut self.tree[id];
                node.set_end_span(end_span);
                if let Some(end_span) = end_span {
                    node.span.end = end_span.end;
                }
                self.container_stack.truncate(stack_index);
                return !unexpected_close_tag_detected;
            }
            if kind == Kind::AngularControlFlowBlock
                || !self
                    .definition_of_node(id)
                    .is_some_and(|it| it.closed_by_parent)
            {
                unexpected_close_tag_detected = true;
            }
        }
        false
    }

    fn consume_attr(&mut self, attr_name: Token) -> Attribute<'a> {
        let mut attr_end = attr_name.span.end;
        let start_quote = self.advance_if(TokenType::AttrQuote);
        let mut value_start = None;
        let mut value_end = None;
        if self.peek().kind == TokenType::AttrValueText {
            value_start = Some(self.peek().span.start);
            value_end = Some(self.peek().span.end);
            while matches!(
                self.peek().kind,
                TokenType::AttrValueText
                    | TokenType::AttrValueInterpolation
                    | TokenType::EncodedEntity
            ) {
                attr_end = self.advance().span.end;
                value_end = Some(attr_end);
            }
        }
        if let Some(quote) = self.advance_if(TokenType::AttrQuote) {
            attr_end = quote.span.end;
            value_end = Some(attr_end);
        }
        let (prefix, name) = match attr_name.parts {
            Parts::Name(prefix, name) => (prefix.of(self.text), name.of(self.text)),
            _ => (&b""[..], &b""[..]),
        };
        Attribute {
            span: Span::new(attr_name.span.start, attr_end),
            name_span: attr_name.span,
            value_span: value_start
                .zip(value_end)
                .map(|(start, end)| Span::new(start_quote.map_or(start, |it| it.span.start), end)),
            name: Cow::Borrowed(name),
            namespace: prefix,
            has_explicit_namespace: false,
            value: None,
        }
    }

    /// A block whose start ends where the next token starts, with its parameters.
    fn block(&mut self, token: Token, has_end: bool) -> (Node<'a>, Option<Id>) {
        // Prettier's `normalizeAngularControlFlowBlock`.
        let mut parameters = None;
        while let Some(token) = self.advance_if(TokenType::BlockParameter) {
            let mut node = Node::new(Kind::AngularControlFlowBlockParameter, token.span);
            node.value = Cow::Borrowed(token.span.of(self.text));
            let parameter = self.tree.add(node);
            let list = *parameters.get_or_insert_with(|| {
                self.tree.add(Node::new(
                    Kind::AngularControlFlowBlockParameters,
                    token.span,
                ))
            });
            self.tree[list].span.end = token.span.end;
            self.tree.append_child(list, parameter);
        }
        if has_end {
            self.advance_if(TokenType::BlockOpenEnd);
        }
        let span = Span::new(token.span.start, self.peek().span.start);
        let mut node = Node::new(Kind::AngularControlFlowBlock, span);
        node.set_start_span(span);
        node.name_span = token.span;
        node.name = Cow::Borrowed(self.value_of(token));
        (node, parameters)
    }

    fn push_block(&mut self, (block, parameters): (Node<'a>, Option<Id>)) {
        self.push_container(block, false);
        if let (Some(block), Some(parameters)) = (self.container(), parameters) {
            self.tree.set_parameters(block, parameters);
        }
    }

    fn consume_block_open(&mut self, token: Token) {
        let block = self.block(token, true);
        self.push_block(block);
    }

    fn consume_block_close(&mut self, token: Token) {
        if !self.pop_container(None, Kind::AngularControlFlowBlock, Some(token.span)) {
            self.errors.push(token.span.start);
        }
    }

    fn consume_incomplete_block(&mut self, token: Token) {
        let block = self.block(token, false);
        let start = block.0.span.start;
        self.push_block(block);
        self.pop_container(None, Kind::AngularControlFlowBlock, None);
        self.errors.push(start);
    }

    fn consume_let(&mut self, start_token: Token) {
        let Some(value_token) = self.advance_if(TokenType::LetValue) else {
            self.errors.push(start_token.span.start);
            return;
        };
        let Some(end_token) = self.advance_if(TokenType::LetEnd) else {
            self.errors.push(start_token.span.start);
            return;
        };
        // Prettier's `normalizeAngularLetDeclaration`.
        let mut node = Node::new(
            Kind::AngularLetDeclaration,
            Span::new(start_token.span.start, end_token.span.end),
        );
        node.name = Cow::Borrowed(self.value_of(start_token));
        node.name_span = value_token.span;
        node.value = Cow::Borrowed(value_token.span.of(self.text));
        self.add_to_parent(node);
    }
}

/// `new HtmlParser().parse(..)`, of the part of `text` from `start` on.
pub(crate) fn parse<'a>(
    tree: &mut Tree<'a>,
    text: &'a [u8],
    start: usize,
    options: Options<'_>,
) -> ParseResult {
    let is_case_sensitive = options.is_tag_name_case_sensitive;
    let get_tag_content_type = |name: &[u8], has_parent: bool, attrs: &[LexedAttribute<'_>]| {
        let is_raw =
            options
                .should_parse_as_raw_text
                .is_some_and(|should| match is_case_sensitive {
                    true => should(name, has_parent, attrs),
                    false => should(&name.to_ascii_lowercase(), has_parent, attrs),
                });
        if is_raw {
            ContentType::RawText
        } else {
            definition_of(name, is_case_sensitive).content_type
        }
    };
    let get_tag_content_type: GetTagContentType<'_> = &get_tag_content_type;
    let (tokens, mut errors) = lexer::tokenize(text, start, get_tag_content_type, options.lexer);
    let root = tree.add(Node::new(Kind::Root, Span::new(0, text.len() as u32)));
    let end = tokens.len().saturating_sub(1);
    let mut builder = TreeBuilder {
        text,
        tree,
        tokens: &tokens,
        index: 0,
        end,
        eof: tokens.last().copied().unwrap_or_else(|| Token {
            kind: TokenType::Eof,
            span: Span::new(text.len() as u32, text.len() as u32),
            parts: Parts::None,
        }),
        container_stack: Vec::new(),
        root,
        errors: Vec::new(),
        can_self_close: options.lexer.can_self_close,
        allow_htm_component_closing_tags: options.lexer.allow_htm_component_closing_tags,
        is_tag_name_case_sensitive: is_case_sensitive,
        is_nested_too_deeply: false,
        base_depth: 0,
    };
    builder.build();
    errors.append(&mut builder.errors);
    ParseResult {
        root,
        errors,
        is_nested_too_deeply: builder.is_nested_too_deeply,
    }
}
