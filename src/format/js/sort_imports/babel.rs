//! The imports of a file the way Babel sees them.
//!
//! The plugins of Prettier parse a file with `@babel/parser`, move the import declarations and the
//! comments that Babel has attached to them around, and print them with `@babel/generator`
//! (`generator.rs`). What comes of it depends on which nodes Babel attaches a comment to, and on
//! the lines that nodes and comments are on. This is as much of Babel's tree as that takes: the
//! `#!` line, the directives and the import declarations that are not in a `declare module`.

use bun_lint::ast::{File, Ident, Import, KeyKind, Prop, Stmt, StmtKind, StmtTag};
use bun_lint::span::Span;
use bun_lint::tokens::TokenKind;

/// An index into [`Model::comments`].
pub(super) type CommentId = u32;

#[derive(Copy, Clone, Debug)]
pub(super) struct Comment {
    /// With its delimiters.
    pub(super) span: Span,
    pub(super) is_block: bool,
    /// Whether it has a `loc`, which the next three fields are. The plugins change and delete it.
    pub(super) has_loc: bool,
    pub(super) start_line: i32,
    pub(super) end_line: i32,
    /// In UTF-16 code units.
    pub(super) start_column: u32,
}

/// `leadingComments`, `innerComments` or `trailingComments`: a range of [`Model::lists`].
#[derive(Copy, Clone, Default, Debug)]
pub(super) struct List {
    start: u32,
    len: u32,
}

impl List {
    #[inline]
    pub(super) fn is_empty(self) -> bool {
        self.len == 0
    }
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Which {
    Leading,
    Inner,
    Trailing,
}

/// `loc.start.line` and `loc.end.line`
#[derive(Copy, Clone, Default, Debug, PartialEq, Eq)]
pub(super) struct Lines {
    pub(super) start: i32,
    pub(super) end: i32,
}

#[derive(Copy, Clone, Default, Debug)]
pub(super) struct Attached {
    pub(super) leading: List,
    pub(super) inner: List,
    pub(super) trailing: List,
}

impl Attached {
    pub(super) fn get(&self, which: Which) -> List {
        match which {
            Which::Leading => self.leading,
            Which::Inner => self.inner,
            Which::Trailing => self.trailing,
        }
    }

    pub(super) fn get_mut(&mut self, which: Which) -> &mut List {
        match which {
            Which::Leading => &mut self.leading,
            Which::Inner => &mut self.inner,
            Which::Trailing => &mut self.trailing,
        }
    }
}

/// An `ImportDeclaration`.
#[derive(Copy, Clone, Debug)]
pub(super) struct Declaration<'a> {
    pub(super) import: Import<'a>,
    /// `start` and `end`. `None` for a node that a plugin has made.
    pub(super) span: Option<Span>,
    pub(super) lines: Option<Lines>,
    /// `importKind === "type"`
    pub(super) is_type: bool,
    /// `specifiers`: a range of [`Model::orders`].
    pub(super) specifiers: (u32, u32),
    /// The module specifier, with its quotes.
    pub(super) source: Span,
    /// A node that a plugin has made has no attributes.
    pub(super) has_attributes: bool,
    pub(super) comments: Attached,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum SpecifierKind {
    Default,
    Namespace,
    Named,
}

/// An `ImportDefaultSpecifier`, an `ImportNamespaceSpecifier` or an `ImportSpecifier`.
#[derive(Copy, Clone, Debug)]
pub(super) struct Specifier<'a> {
    pub(super) kind: SpecifierKind,
    /// `importKind === "type"`
    pub(super) is_type: bool,
    /// The same as `local` unless there is an `as`.
    pub(super) imported: Ident<'a>,
    pub(super) local: Ident<'a>,
    pub(super) span: Span,
    pub(super) comments: Attached,
}

impl Specifier<'_> {
    pub(super) fn is_renamed(&self) -> bool {
        self.imported.span() != self.local.span()
    }
}

/// `"use strict";`
#[derive(Copy, Clone, Debug)]
pub(super) struct Directive {
    pub(super) span: Span,
    /// The string.
    pub(super) literal: Span,
    pub(super) comments: Attached,
}

/// A node that can have comments.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum Node {
    /// `#!/usr/bin/env node`
    Interpreter,
    /// An index into [`Model::directives`].
    Directive(u32),
    DirectiveLiteral(u32),
    /// An index into [`Model::declarations`].
    Import(u32),
    /// An index into [`Model::specifiers`].
    Specifier(u32),
    Imported(u32),
    Local(u32),
    /// By where it starts, like the next three. Two declarations can share a `source`.
    Source(u32),
    Attribute(u32),
    AttributeKey(u32),
    AttributeValue(u32),
    /// The `EmptyStatement` that a plugin puts first, for comments.
    Empty,
    /// The statement that becomes an empty line, and the string in it.
    NewLine,
    NewLineLiteral,
}

pub(super) struct Model<'a> {
    pub(super) file: &'a File<'a>,
    pub(super) text: &'a [u8],
    /// Those up to [`Model::rest_start`].
    pub(super) comments: Vec<Comment>,
    lists: Vec<CommentId>,
    pub(super) interpreter: Option<(Span, Attached)>,
    pub(super) directives: Vec<Directive>,
    pub(super) declarations: Vec<Declaration<'a>>,
    pub(super) specifiers: Vec<Specifier<'a>>,
    /// Indices into `specifiers`.
    pub(super) orders: Vec<u32>,
    /// The comments of the nodes in specifiers, of sources, of attributes and of the strings of
    /// directives. The plugins leave them alone.
    deep: Vec<(Node, Which, List)>,
    /// Whether there is a comment in an import.
    pub(super) has_comments_in_imports: bool,
    /// The comments of [`Node::Empty`].
    pub(super) empty: Attached,
    /// `program.body[0]`: where it starts, and its `leadingComments`.
    pub(super) first_statement: Option<(u32, List)>,
    /// Whether the imports are the first statements after the directives, with nothing between
    /// them.
    pub(super) is_contiguous: bool,
    /// Where the first token after the last import starts, or the file ends.
    pub(super) rest_start: u32,
    /// Where lines start, up to `rest_start`. Empty if there are no comments.
    line_starts: Vec<u32>,
}

pub(super) fn skip_whitespace(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(at..).unwrap_or_default() {
            [b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C, ..] => at += 1,
            [0xC2, 0xA0, ..] => at += 2,
            [0xE2, 0x80, 0xA8 | 0xA9, ..] | [0xEF, 0xBB, 0xBF, ..] => at += 3,
            _ => return at,
        }
    }
}

fn skip_whitespace_back(text: &[u8], mut at: usize) -> usize {
    loop {
        match text.get(..at).unwrap_or_default() {
            [.., b' ' | b'\t' | b'\n' | b'\r' | 0x0B | 0x0C] => at -= 1,
            [.., 0xC2, 0xA0] => at -= 2,
            [.., 0xE2, 0x80, 0xA8 | 0xA9] | [.., 0xEF, 0xBB, 0xBF] => at -= 3,
            _ => return at,
        }
    }
}

/// Babel's `CommentWhitespace`: the comments between two tokens.
#[derive(Copy, Clone)]
struct Group {
    /// Where the token before ends.
    start: u32,
    /// Where the token after starts.
    end: u32,
    /// A range of [`Model::comments`].
    first: u32,
    after: u32,
}

impl<'a> Model<'a> {
    /// `None`: the file has no imports.
    pub(super) fn new(file: &'a File<'a>) -> Option<Model<'a>> {
        let last_import = file
            .body()
            .iter()
            .rev()
            .find(|it| it.tag() == StmtTag::Import)?;
        let mut model = Model {
            file,
            text: file.text(),
            comments: Vec::new(),
            lists: Vec::new(),
            interpreter: None,
            directives: Vec::new(),
            declarations: Vec::with_capacity(32),
            specifiers: Vec::with_capacity(64),
            orders: Vec::with_capacity(64),
            deep: Vec::new(),
            has_comments_in_imports: false,
            empty: Attached::default(),
            first_statement: None,
            is_contiguous: true,
            rest_start: 0,
            line_starts: Vec::new(),
        };
        model.collect_comments(last_import.span().end);
        model.collect_statements();
        Some(model)
    }

    /// Where the text starts: after a byte order mark.
    pub(super) fn text_start(&self) -> u32 {
        if self.file.has_bom() { 3 } else { 0 }
    }

    /// The comments up to the first token after `end`, where the last import ends.
    fn collect_comments(&mut self, end: u32) {
        let mut rest_start = skip_whitespace(self.text, end as usize) as u32;
        for token in self.file.comments() {
            let span = token.span();
            if span.start > rest_start {
                break;
            }
            if span.start == rest_start {
                rest_start = skip_whitespace(self.text, span.end as usize) as u32;
            }
            match token.kind() {
                TokenKind::Shebang => self.interpreter = Some((span, Attached::default())),
                kind => self.comments.push(Comment {
                    span,
                    is_block: kind == TokenKind::Block,
                    has_loc: true,
                    start_line: 0,
                    end_line: 0,
                    start_column: 0,
                }),
            }
        }
        self.rest_start = rest_start;
        if self.comments.is_empty() {
            return;
        }

        self.line_starts.push(0);
        let region = &self.text[..(rest_start as usize).min(self.text.len())];
        let mut at = 0;
        while let Some(found) = bun_core::strings::index_of_any(&region[at..], b"\n\r\xE2") {
            at += found;
            at += match &region[at..] {
                [b'\r', b'\n', ..] => 2,
                [b'\n' | b'\r', ..] => 1,
                [0xE2, 0x80, 0xA8 | 0xA9, ..] => 3,
                _ => {
                    at += 1;
                    continue;
                }
            };
            self.line_starts.push(at as u32);
        }
        for index in 0..self.comments.len() {
            let span = self.comments[index].span;
            let lines = self.lines_of(span);
            let line_start = self.line_starts[lines.start as usize - 1].max(self.text_start());
            let start_column = bun_core::strings::wtf8_len_utf16(
                &self.text[line_start as usize..span.start as usize],
            );
            let comment = &mut self.comments[index];
            (comment.start_line, comment.end_line, comment.start_column) =
                (lines.start, lines.end, start_column);
        }
    }

    /// The line that `offset` is on, counted from 1. 0 if there are no comments: nothing asks.
    fn line_of(&self, offset: u32) -> i32 {
        self.line_starts.partition_point(|start| *start <= offset) as i32
    }

    fn lines_of(&self, span: Span) -> Lines {
        Lines {
            start: self.line_of(span.start),
            end: self.line_of(span.end),
        }
    }

    #[inline]
    pub(super) fn list(&self, list: List) -> &[CommentId] {
        self.lists
            .get(list.start as usize..(list.start + list.len) as usize)
            .unwrap_or_default()
    }

    pub(super) fn new_list(&mut self, comments: impl IntoIterator<Item = CommentId>) -> List {
        let start = self.lists.len() as u32;
        self.lists.extend(comments);
        List {
            start,
            len: self.lists.len() as u32 - start,
        }
    }

    /// `[...a, ...b]`
    pub(super) fn concat(&mut self, a: List, b: List) -> List {
        if a.is_empty() || b.is_empty() {
            return if a.is_empty() { b } else { a };
        }
        let start = self.lists.len() as u32;
        self.lists
            .extend_from_within(a.start as usize..(a.start + a.len) as usize);
        self.lists
            .extend_from_within(b.start as usize..(b.start + b.len) as usize);
        List {
            start,
            len: a.len + b.len,
        }
    }

    /// Without the delimiters.
    pub(super) fn comment_value(&self, comment: CommentId) -> &'a [u8] {
        let comment = self.comments[comment as usize];
        self.file
            .slice(comment.span.shrink(2, if comment.is_block { 2 } else { 0 }))
    }

    /// `declaration.specifiers`
    pub(super) fn specifiers_of(&self, declaration: &Declaration) -> &[u32] {
        let (start, len) = declaration.specifiers;
        self.orders
            .get(start as usize..(start + len) as usize)
            .unwrap_or_default()
    }

    pub(super) fn new_specifiers(
        &mut self,
        specifiers: impl IntoIterator<Item = u32>,
    ) -> (u32, u32) {
        let start = self.orders.len() as u32;
        self.orders.extend(specifiers);
        (start, self.orders.len() as u32 - start)
    }

    /// `declaration.source.value`
    pub(super) fn source_of(&self, declaration: &Declaration<'a>) -> &'a [u8] {
        declaration.import.spec().bytes()
    }

    /// The module specifier, with its quotes.
    pub(super) fn source_span(&self, declaration: &Declaration<'a>) -> Span {
        declaration.source
    }

    /// Where the module specifier of `import`, the statement at `span`, is.
    fn find_source(&self, import: Import<'a>, span: Span) -> Span {
        // Nearly always it is the last thing before the `;`, and has no escapes.
        let text = self.file.slice(span);
        let text = text.strip_suffix(b";").unwrap_or(text).trim_ascii_end();
        if let Some((quote @ (b'"' | b'\''), before)) = text.split_last()
            && let Some(value) = before
                .len()
                .checked_sub(import.spec().bytes().len())
                .map(|at| before.split_at(at))
            && value.1 == import.spec().bytes()
            && value.0.last() == Some(quote)
        {
            return Span::new(
                span.start + value.0.len() as u32 - 1,
                span.start + text.len() as u32,
            );
        }
        import.spec_span().unwrap_or_default()
    }

    fn attached_mut(&mut self, node: Node) -> Option<&mut Attached> {
        match node {
            Node::Interpreter => self.interpreter.as_mut().map(|it| &mut it.1),
            Node::Directive(index) => self
                .directives
                .get_mut(index as usize)
                .map(|it| &mut it.comments),
            Node::Import(index) => self
                .declarations
                .get_mut(index as usize)
                .map(|it| &mut it.comments),
            Node::Specifier(index) => self
                .specifiers
                .get_mut(index as usize)
                .map(|it| &mut it.comments),
            Node::Empty => Some(&mut self.empty),
            _ => None,
        }
    }

    pub(super) fn comments_of(&self, node: Node, which: Which) -> List {
        match node {
            Node::Interpreter => self
                .interpreter
                .map_or_else(List::default, |it| it.1.get(which)),
            Node::Directive(index) => self.directives[index as usize].comments.get(which),
            Node::Import(index) => self.declarations[index as usize].comments.get(which),
            Node::Specifier(index) => self.specifiers[index as usize].comments.get(which),
            Node::Empty => self.empty.get(which),
            Node::NewLine | Node::NewLineLiteral => List::default(),
            _ => self
                .deep
                .iter()
                .find(|it| it.0 == node && it.1 == which)
                .map_or_else(List::default, |it| it.2),
        }
    }

    /// Adds `list` at the end of the comments of `node`.
    pub(super) fn attach(&mut self, node: Node, which: Which, list: List) {
        if list.is_empty() {
            return;
        }
        let all = self.concat(self.comments_of(node, which), list);
        if let Some(attached) = self.attached_mut(node) {
            *attached.get_mut(which) = all;
            return;
        }
        match self
            .deep
            .iter_mut()
            .find(|it| it.0 == node && it.1 == which)
        {
            Some(entry) => entry.2 = all,
            None => self.deep.push((node, which, all)),
        }
    }

    fn group(&self, first: u32, after: u32) -> Option<Group> {
        (first < after).then(|| Group {
            start: skip_whitespace_back(
                self.text,
                self.comments[first as usize].span.start as usize,
            ) as u32,
            end: skip_whitespace(
                self.text,
                self.comments[after as usize - 1].span.end as usize,
            ) as u32,
            first,
            after,
        })
    }

    /// The next group of comments that starts before `end`: comments with only whitespace between
    /// them.
    fn next_group_before(&self, cursor: &mut u32, end: u32) -> Option<Group> {
        let first = *cursor;
        let mut group_end = self
            .comments
            .get(first as usize)
            .filter(|comment| comment.span.start < end)?
            .span
            .end;
        *cursor += 1;
        while let Some(next) = self.comments.get(*cursor as usize)
            && next.span.start < end
            && skip_whitespace(self.text, group_end as usize) as u32 == next.span.start
        {
            group_end = next.span.end;
            *cursor += 1;
        }
        self.group(first, *cursor)
    }

    fn collect_statements(&mut self) {
        let mut cursor = 0;
        // What the comments after it trail.
        let mut previous: Option<Node> = self.interpreter.map(|_| Node::Interpreter);
        let mut previous_end = self
            .interpreter
            .map_or_else(|| self.text_start(), |it| it.0.end);
        let (mut is_in_prologue, mut has_seen_other) = (true, false);
        for statement in self.file.body().iter() {
            let span = statement.span();
            let group = self.next_group_before(&mut cursor, span.start);
            let start = group.map_or_else(
                || skip_whitespace(self.text, previous_end as usize) as u32,
                |group| group.end,
            );
            let between = group
                .map(|group| self.new_list(group.first..group.after))
                .unwrap_or_default();
            if let Some(previous) = previous.take() {
                self.attach(previous, Which::Trailing, between);
            }
            is_in_prologue = is_in_prologue && statement.directive().is_some();
            if !is_in_prologue && self.first_statement.is_none() {
                self.first_statement = Some((start, between));
            }
            if start >= self.rest_start {
                return;
            }
            previous_end = span.end;
            match statement.kind() {
                StmtKind::Expr(expression) if is_in_prologue => {
                    let index = self.directives.len() as u32;
                    self.directives.push(Directive {
                        span,
                        literal: expression.span(),
                        comments: Attached::default(),
                    });
                    self.attach(Node::Directive(index), Which::Leading, between);
                    while let Some(group) = self.next_group_before(&mut cursor, span.end) {
                        let list = self.new_list(group.first..group.after);
                        self.attach(Node::DirectiveLiteral(index), Which::Trailing, list);
                    }
                    previous = Some(Node::Directive(index));
                }
                StmtKind::Import(import) => {
                    self.is_contiguous &= !has_seen_other;
                    let index = self.add_declaration(statement, import, &mut cursor);
                    self.attach(Node::Import(index), Which::Leading, between);
                    previous = Some(Node::Import(index));
                }
                _ => {
                    has_seen_other = true;
                    while self
                        .comments
                        .get(cursor as usize)
                        .is_some_and(|comment| comment.span.start < span.end)
                    {
                        cursor += 1;
                    }
                }
            }
        }
        // At the end of the file.
        if let Some(previous) = previous {
            let list = self.new_list(cursor..self.comments.len() as u32);
            self.attach(previous, Which::Trailing, list);
        }
    }

    fn add_specifier(
        &mut self,
        kind: SpecifierKind,
        is_type: bool,
        imported: Ident<'a>,
        local: Ident<'a>,
        span: Span,
    ) {
        self.orders.push(self.specifiers.len() as u32);
        self.specifiers.push(Specifier {
            kind,
            is_type,
            imported,
            local,
            span,
            comments: Attached::default(),
        });
    }

    fn add_declaration(
        &mut self,
        statement: Stmt<'a>,
        import: Import<'a>,
        cursor: &mut u32,
    ) -> u32 {
        let span = statement.span();
        let index = self.declarations.len() as u32;
        let first = self.orders.len() as u32;
        if let Some(default) = import.default() {
            self.add_specifier(
                SpecifierKind::Default,
                false,
                default,
                default,
                default.span(),
            );
        }
        if let (Some(namespace), Some(span)) = (import.namespace(), import.namespace_span()) {
            self.add_specifier(SpecifierKind::Namespace, false, namespace, namespace, span);
        }
        for named in import.named().iter() {
            self.add_specifier(
                SpecifierKind::Named,
                named.is_type_only(),
                named.imported(),
                named.local(),
                named.span(),
            );
        }
        self.declarations.push(Declaration {
            import,
            span: Some(span),
            lines: Some(self.lines_of(span)),
            is_type: import.is_type_only(),
            specifiers: (first, self.orders.len() as u32 - first),
            source: self.find_source(import, span),
            has_attributes: import
                .attributes()
                .is_some_and(|it| !it.entries().is_empty()),
            comments: Attached::default(),
        });
        while let Some(group) = self.next_group_before(cursor, span.end) {
            self.attach_in_declaration(index, group);
        }
        index
    }

    /// If `group` is right after or right before the node at `span`, it is attached to it.
    fn attach_if_adjacent(&mut self, node: Node, span: Span, group: Group, list: List) -> bool {
        if span.end == group.start {
            self.attach(node, Which::Trailing, list);
        }
        if span.start == group.end {
            self.attach(node, Which::Leading, list);
        }
        span.end == group.start || span.start == group.end
    }

    /// Babel's `processComment` and `finalizeComment` for comments inside of an import.
    fn attach_in_declaration(&mut self, index: u32, group: Group) {
        self.has_comments_in_imports = true;
        let declaration = self.declarations[index as usize];
        let list = self.new_list(group.first..group.after);
        let is_in = |span: Span| span.start < group.start && group.end < span.end;
        let mut is_attached = false;

        // At first, specifiers are in the order of the source.
        let (first, count) = (
            self.orders[declaration.specifiers.0 as usize..]
                .first()
                .copied()
                .unwrap_or(0),
            declaration.specifiers.1,
        );
        for at in first..first + count {
            let specifier = self.specifiers[at as usize];
            if !is_in(specifier.span) {
                is_attached |=
                    self.attach_if_adjacent(Node::Specifier(at), specifier.span, group, list);
                continue;
            }
            is_attached = match specifier.kind == SpecifierKind::Named {
                true => {
                    self.attach_if_adjacent(
                        Node::Imported(at),
                        specifier.imported.span(),
                        group,
                        list,
                    ) | (specifier.is_renamed()
                        && self.attach_if_adjacent(
                            Node::Local(at),
                            specifier.local.span(),
                            group,
                            list,
                        ))
                }
                false => {
                    self.attach_if_adjacent(Node::Local(at), specifier.local.span(), group, list)
                }
            };
            if !is_attached {
                self.attach(Node::Specifier(at), Which::Inner, list);
            }
            return;
        }
        let source = self.source_span(&declaration);
        is_attached |= self.attach_if_adjacent(Node::Source(source.start), source, group, list);
        for attribute in declaration
            .import
            .attributes()
            .map(|it| it.entries())
            .into_iter()
            .flatten()
        {
            let span = attribute.span();
            if !is_in(span) {
                is_attached |=
                    self.attach_if_adjacent(Node::Attribute(span.start), span, group, list);
                continue;
            }
            let key = attribute_key_span(self.file, attribute);
            let value = attribute.value().map(|it| it.span());
            is_attached = key.is_some_and(|key| {
                self.attach_if_adjacent(Node::AttributeKey(span.start), key, group, list)
            }) | value.is_some_and(|value| {
                self.attach_if_adjacent(Node::AttributeValue(span.start), value, group, list)
            });
            if !is_attached {
                self.attach(Node::Attribute(span.start), Which::Inner, list);
            }
            return;
        }
        if is_attached {
            return;
        }
        // `adjustInnerComments`
        let is_after_comma = self.text.get((group.start as usize).wrapping_sub(1)) == Some(&b',');
        match (count > 0).then(|| first + count - 1) {
            Some(last)
                if is_after_comma && self.specifiers[last as usize].span.start <= group.start =>
            {
                self.attach(Node::Specifier(last), Which::Trailing, list);
            }
            _ => self.attach(Node::Import(index), Which::Inner, list),
        }
    }

    /// `node.start` and `node.end`
    pub(super) fn span(&self, node: Node) -> Option<Span> {
        Some(match node {
            Node::Interpreter => self.interpreter?.0,
            Node::Directive(index) => self.directives[index as usize].span,
            Node::DirectiveLiteral(index) => self.directives[index as usize].literal,
            Node::Import(index) => self.declarations[index as usize].span?,
            Node::Specifier(index) => self.specifiers[index as usize].span,
            Node::Imported(index) => self.specifiers[index as usize].imported.span(),
            Node::Local(index) => self.specifiers[index as usize].local.span(),
            Node::Source(start) => {
                let len = bun_lint::tokens::token_len(
                    self.text.get(start as usize..).unwrap_or_default(),
                );
                Span::new(start, start + len as u32)
            }
            Node::Attribute(start) => self.attribute_at(start)?.span(),
            Node::AttributeKey(start) => attribute_key_span(self.file, self.attribute_at(start)?)?,
            Node::AttributeValue(start) => self.attribute_at(start)?.value()?.span(),
            Node::Empty | Node::NewLine | Node::NewLineLiteral => return None,
        })
    }

    /// `node.loc`
    pub(super) fn lines(&self, node: Node) -> Option<Lines> {
        match node {
            Node::Import(index) => self.declarations[index as usize].lines,
            Node::Empty => Some(Lines::default()),
            _ => self.span(node).map(|span| self.lines_of(span)),
        }
    }

    fn attribute_at(&self, start: u32) -> Option<Prop<'a>> {
        let declaration = self
            .declarations
            .iter()
            .find(|it| it.span.is_some_and(|span| span.contains_offset(start)))?;
        declaration
            .import
            .attributes()?
            .entries()
            .iter()
            .find(|it| it.span().start == start)
    }
}

pub(super) fn attribute_key_span<'a>(file: &'a File<'a>, attribute: Prop<'a>) -> Option<Span> {
    let key = attribute.key()?;
    matches!(key.kind(), KeyKind::String(_) | KeyKind::Ident(_)).then(|| key.span(file))
}
