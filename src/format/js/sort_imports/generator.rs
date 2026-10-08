//! `@babel/generator` 7.29 for the nodes of `babel.rs`: `printer.js`, `buffer.js`, and of
//! `generators/` what prints a program of directives and imports.
//!
//! Functions have the names that they have there. What depends on options that the plugins do not
//! set (`retainLines`, `compact`, `concise`, source maps, ..) is left out.

use super::babel::{CommentId, Model, Node, SpecifierKind, Which, attribute_key_span};
use crate::text::{utf16_len, white_space_len};
use bun_core::strings;

/// What `_buf._last` is after a string has been appended.
const LAST_IS_TEXT: i32 = -1;
/// After a word.
const LAST_IS_WORD: i32 = -3;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) enum PieceKind {
    Interpreter,
    Directive(u32),
    Import(u32),
    Comment(CommentId),
}

/// Where a statement, or a comment between statements, is in the code.
#[derive(Copy, Clone, Debug)]
pub(super) struct Piece {
    pub(super) kind: PieceKind,
    pub(super) start: u32,
    pub(super) end: u32,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum SkipNewLines {
    /// `COMMENT_SKIP_NEWLINE.DEFAULT`
    Default,
    All,
    Leading,
    Trailing,
}

/// Whether the interpreter line and the directives of the file are part of the program.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Prologue {
    Included,
    Omitted,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Join {
    /// `printSequence`: statements.
    Sequence,
    /// `printList`: commas are between them.
    List,
}

pub(super) struct Printer<'m, 'a> {
    model: &'m Model<'a>,
    /// `importAttributesKeyword`
    attributes_keyword: &'static [u8],
    /// What a line ends with.
    end_of_line: &'static [u8],

    // `Buffer`
    out: Vec<u8>,
    last: i32,
    queued: u8,
    /// The `;` that is queued belongs to a statement that is an empty line already.
    is_queued_hidden: bool,
    /// The end of the last empty line: what is before is not trimmed.
    kept_len: usize,

    current: Option<Node>,
    indent: u32,
    no_line_terminator: bool,
    printed_comments: Vec<bool>,
    last_comment_line: i32,
    inner_comments_state: u8,

    pub(super) pieces: Vec<Piece>,
    /// A comment is not printed as it is written, or not between statements.
    pub(super) has_changed_comment: bool,
    /// What Babel prints cannot be parsed.
    pub(super) has_failed: bool,
}

impl<'m, 'a> Printer<'m, 'a> {
    pub(super) fn new(
        model: &'m Model<'a>,
        attributes_keyword: &'static [u8],
        end_of_line: &'static [u8],
    ) -> Self {
        Printer {
            model,
            attributes_keyword,
            end_of_line,
            out: Vec::with_capacity(1024),
            last: 0,
            queued: 0,
            is_queued_hidden: false,
            kept_len: 0,
            current: None,
            indent: 0,
            no_line_terminator: false,
            printed_comments: vec![false; model.comments.len()],
            last_comment_line: 0,
            inner_comments_state: 0,
            pieces: Vec::new(),
            has_changed_comment: false,
            has_failed: false,
        }
    }

    /// `generate(file(program(body, directives, "module", interpreter))).code`, with the statements
    /// that stand for empty lines replaced.
    pub(super) fn generate(mut self, prologue: Prologue, body: &[Node]) -> Self {
        if prologue == Prologue::Included && self.model.interpreter.is_some() {
            self.print(Node::Interpreter, false, 0);
        }
        // `Program`
        let directives = match prologue {
            Prologue::Included => self.model.directives.len() as u32,
            Prologue::Omitted => 0,
        };
        if directives > 0 {
            let newline = if body.is_empty() { 1 } else { 2 };
            let nodes: Vec<Node> = (0..directives).map(Node::Directive).collect();
            self.print_sequence(&nodes, newline);
            if self
                .model
                .comments_of(Node::Directive(directives - 1), Which::Trailing)
                .is_empty()
            {
                self.newline(newline);
            }
        }
        self.print_sequence(body, 0);
        self.last_comment_line = 0;

        // `Buffer.get`
        let last = self.last;
        if self.queued != b' ' {
            self.flush();
        }
        if last == i32::from(b'\n') {
            let trimmed = self.out.trim_ascii_end().len();
            self.out.truncate(trimmed.max(self.kept_len));
        }
        self
    }

    pub(super) fn code(&self) -> &[u8] {
        &self.out
    }

    // ───────────────────────────── buffer.js ─────────────────────────────

    fn flush(&mut self) {
        if self.queued != 0 {
            if !self.is_queued_hidden {
                self.out.push(self.queued);
            }
            self.last = i32::from(self.queued);
            (self.queued, self.is_queued_hidden) = (0, false);
        }
    }

    fn buffer_append(&mut self, text: &[u8]) {
        self.flush();
        self.out.extend_from_slice(text);
        self.last = LAST_IS_TEXT;
    }

    fn buffer_append_char(&mut self, char: u8) {
        self.flush();
        match char {
            b'\n' => self.out.extend_from_slice(self.end_of_line),
            _ => self.out.push(char),
        }
        self.last = i32::from(char);
    }

    fn get_last_char(&self, checks_queue: bool) -> i32 {
        if checks_queue && self.queued != 0 {
            i32::from(self.queued)
        } else {
            self.last
        }
    }

    fn get_newline_count(&self) -> i32 {
        i32::from(self.queued == 0 && self.last == i32::from(b'\n'))
    }

    fn has_content(&self) -> bool {
        self.last != 0
    }

    fn get_current_column(&self) -> u32 {
        let line = strings::last_index_of_char(&self.out, b'\n')
            .map_or(&self.out[..], |at| &self.out[at + 1..]);
        utf16_len(line) + u32::from(self.queued != 0)
    }

    // ───────────────────────────── printer.js ─────────────────────────────

    fn semicolon(&mut self, is_forced: bool) {
        match is_forced {
            true => self.append_char(b';', false),
            false => self.queue(b';'),
        }
        self.no_line_terminator = false;
    }

    fn space(&mut self) {
        let last = self.get_last_char(true);
        if last != 0 && last != i32::from(b' ') && last != i32::from(b'\n') {
            self.queue(b' ');
        }
    }

    fn word(&mut self, text: &[u8]) {
        self.maybe_print_inner_comments();
        let last = self.get_last_char(false);
        if last == LAST_IS_WORD || (last == i32::from(b'/') && text.first() == Some(&b'/')) {
            self.queue(b' ');
        }
        self.append(text);
        self.last = LAST_IS_WORD;
        self.no_line_terminator = false;
    }

    fn token(&mut self, text: &[u8]) {
        self.maybe_print_inner_comments();
        self.append(text);
        self.no_line_terminator = false;
    }

    fn token_char(&mut self, char: u8) {
        self.maybe_print_inner_comments();
        self.append_char(char, false);
        self.no_line_terminator = false;
    }

    fn newline(&mut self, count: i32) {
        for _ in 0..count.min(2) - self.get_newline_count() {
            self.newline_char();
        }
    }

    /// `_newline`
    fn newline_char(&mut self) {
        if self.queued == b' ' {
            self.queued = 0;
        }
        self.append_char(b'\n', true);
    }

    fn append(&mut self, text: &[u8]) {
        self.maybe_indent();
        self.buffer_append(text);
    }

    fn append_char(&mut self, char: u8, is_without_indent: bool) {
        if !is_without_indent {
            self.maybe_indent();
        }
        self.buffer_append_char(char);
    }

    fn queue(&mut self, char: u8) {
        self.flush();
        self.queued = char;
        self.last = LAST_IS_TEXT;
    }

    fn should_indent(&self) -> u32 {
        if self.get_last_char(true) == i32::from(b'\n') {
            self.indent
        } else {
            0
        }
    }

    fn maybe_indent(&mut self) {
        let indent = self.should_indent();
        if indent > 0 {
            self.out.resize(self.out.len() + indent as usize, b' ');
            self.last = LAST_IS_TEXT;
        }
    }

    fn print(
        &mut self,
        node: Node,
        no_line_terminator_after: bool,
        trailing_comments_line_offset: i32,
    ) {
        self.inner_comments_state = 0;
        let parent = self.current.replace(node);

        self.print_comments(Which::Leading, node, 0);
        let start = self.out.len() + usize::from(self.queued != 0 && !self.is_queued_hidden);
        self.print_node(node);
        let kind = match node {
            Node::Interpreter => Some(PieceKind::Interpreter),
            Node::Directive(index) => Some(PieceKind::Directive(index)),
            Node::Import(index) => Some(PieceKind::Import(index)),
            _ => None,
        };
        if let Some(kind) = kind {
            self.pieces.push(Piece {
                kind,
                start: start as u32,
                end: match node {
                    Node::Interpreter => {
                        start + self.model.span(node).map_or(0, |span| span.len() as usize)
                    }
                    _ => self.out.len() + usize::from(self.queued == b';'),
                } as u32,
            });
        }
        if no_line_terminator_after && !self.no_line_terminator {
            // Babel puts the node in parentheses, which is not valid for the source of an import.
            let trailing = self
                .model
                .list(self.model.comments_of(node, Which::Trailing));
            self.has_failed |= trailing.iter().any(|it| {
                !self.model.comments[*it as usize].is_block
                    || has_newline(self.model.comment_value(*it))
            });
            self.no_line_terminator = true;
            self.print_trailing_comments(node, 0);
        } else {
            self.print_trailing_comments(node, trailing_comments_line_offset);
        }

        self.current = parent;
        self.inner_comments_state = 0;
    }

    fn print_join(&mut self, nodes: &[Node], join: Join, trailing_comments_line_offset: i32) {
        for (index, &node) in nodes.iter().enumerate() {
            if join == Join::Sequence && index == 0 && self.has_content() {
                self.newline(1);
            }
            self.print(node, false, trailing_comments_line_offset);
            if join == Join::List {
                if index + 1 < nodes.len() {
                    self.token_char(b',');
                    self.space();
                }
                continue;
            }
            let next_line = nodes
                .get(index + 1)
                .map(|next| self.model.lines(*next).map_or(0, |lines| lines.start));
            match next_line {
                Some(next_line)
                    if self.last_comment_line > 0 && next_line >= self.last_comment_line =>
                {
                    self.newline((next_line - self.last_comment_line).max(1));
                }
                _ => self.newline(1),
            }
        }
    }

    fn print_sequence(&mut self, nodes: &[Node], trailing_comments_line_offset: i32) {
        self.print_join(nodes, Join::Sequence, trailing_comments_line_offset);
    }

    fn print_list(&mut self, nodes: &[Node]) {
        self.print_join(nodes, Join::List, 0);
    }

    fn print_trailing_comments(&mut self, node: Node, line_offset: i32) {
        self.print_comments(Which::Inner, node, line_offset);
        if self.model.comments_of(node, Which::Trailing).is_empty() {
            self.last_comment_line = 0;
        } else {
            self.print_comments(Which::Trailing, node, line_offset);
        }
    }

    fn maybe_print_inner_comments(&mut self) {
        let state = self.inner_comments_state;
        match state & 3 {
            0 => self.inner_comments_state = 1 | 4,
            1 => self.print_inner_comments(state & 4 != 0),
            _ => {}
        }
    }

    fn print_inner_comments(&mut self, is_indented: bool) {
        let Some(node) = self
            .current
            .filter(|node| !self.model.comments_of(*node, Which::Inner).is_empty())
        else {
            self.inner_comments_state = 2;
            return;
        };
        let has_space = self.get_last_char(true) == i32::from(b' ');
        if is_indented {
            self.indent += 2;
        }
        let printed = self.print_comments_as(1, Which::Inner, node, 0);
        if printed == 2 {
            self.inner_comments_state = 2;
        }
        if printed != 0 && has_space {
            self.space();
        }
        if is_indented {
            self.indent -= 2;
        }
    }

    fn no_indent_inner_comments_here(&mut self) {
        self.inner_comments_state &= !4;
    }

    /// 0: no, 1: yes, 2: later.
    fn should_print_comment(&mut self, comment: CommentId) -> u8 {
        if self.printed_comments[comment as usize] {
            return 0;
        }
        let value = self.model.comment_value(comment);
        if self.no_line_terminator && (has_newline(value) || strings::contains(value, b"*/")) {
            return 2;
        }
        self.printed_comments[comment as usize] = true;
        1
    }

    fn print_comment(&mut self, id: CommentId, skip_new_lines: SkipNewLines) {
        let comment = self.model.comments[id as usize];
        let no_line_terminator = self.no_line_terminator;
        let prints_new_lines =
            comment.is_block && skip_new_lines != SkipNewLines::All && !no_line_terminator;
        if prints_new_lines && self.has_content() && skip_new_lines != SkipNewLines::Leading {
            self.newline(1);
        }
        match u8::try_from(self.get_last_char(true)) {
            Ok(b'/') => self.queue(b' '),
            Ok(b'[' | b'{' | b'(') => {}
            _ => self.space(),
        }

        let written = self.model.file.slice(comment.span);
        let is_between_statements = matches!(
            self.current,
            Some(Node::Interpreter | Node::Directive(_) | Node::Import(_) | Node::Empty)
        );
        let adjusted = match comment.is_block && has_newline(written) {
            true => {
                let mut indent_size = self.get_current_column();
                if self.should_indent() > 0 {
                    indent_size += self.indent;
                }
                Some(adjust_multiline_comment(
                    written,
                    if comment.has_loc {
                        comment.start_column
                    } else {
                        0
                    },
                    indent_size,
                ))
            }
            false if !comment.is_block && no_line_terminator => {
                Some([b"/*", self.model.comment_value(id), b"*/"].concat())
            }
            false => None,
        };
        let value = adjusted.as_deref().unwrap_or(written);
        self.has_changed_comment |= !is_between_statements || value != written;
        self.maybe_indent();
        self.flush();
        let start = self.out.len() as u32;
        self.buffer_append(value);
        self.pieces.push(Piece {
            kind: PieceKind::Comment(id),
            start,
            end: self.out.len() as u32,
        });

        if !comment.is_block && !no_line_terminator {
            self.newline_char();
        }
        if prints_new_lines && skip_new_lines != SkipNewLines::Trailing {
            self.newline(1);
        }
    }

    fn print_comments(&mut self, which: Which, node: Node, line_offset: i32) {
        let kind = if which == Which::Leading { 0 } else { 2 };
        self.print_comments_as(kind, which, node, line_offset);
    }

    /// `_printComments`. `kind`: `COMMENT_TYPE`, 0 for leading, 1 for inner, 2 for trailing.
    fn print_comments_as(&mut self, kind: u8, which: Which, node: Node, line_offset: i32) -> u8 {
        let model = self.model;
        let comments = model.list(model.comments_of(node, which));
        if comments.is_empty() {
            return 2;
        }
        let node_lines = model.lines(node);
        let mut has_loc = node_lines.is_some();
        let node_lines = node_lines.unwrap_or_default();
        let (mut last_line, mut leading_comment_newline) = (0, 0);
        let no_line_terminator = self.no_line_terminator;
        let len = comments.len();

        for (index, &id) in comments.iter().enumerate() {
            let comment = model.comments[id as usize];
            let should_print = self.should_print_comment(id);
            if should_print == 2 {
                return u8::from(index != 0);
            }
            if has_loc && comment.has_loc && should_print == 1 {
                let offset = match kind {
                    0 if index > 0 => comment.start_line - last_line,
                    0 => {
                        if self.has_content()
                            && (!comment.is_block || comment.start_line != comment.end_line)
                        {
                            leading_comment_newline = 1;
                        }
                        leading_comment_newline
                    }
                    1 => {
                        comment.start_line
                            - if index == 0 {
                                node_lines.start
                            } else {
                                last_line
                            }
                    }
                    _ => {
                        comment.start_line
                            - if index == 0 {
                                node_lines.end - line_offset
                            } else {
                                last_line
                            }
                    }
                };
                last_line = comment.end_line;
                if offset > 0 && !no_line_terminator {
                    self.newline(offset);
                }
                self.print_comment(id, SkipNewLines::All);
                if index + 1 == len && kind != 2 {
                    let count = match kind {
                        0 => (node_lines.start - last_line).max(leading_comment_newline),
                        _ => (node_lines.end - last_line).min(1),
                    };
                    if count > 0 && !no_line_terminator {
                        self.newline(count);
                    }
                    last_line = if kind == 0 {
                        node_lines.start
                    } else {
                        node_lines.end
                    };
                }
                continue;
            }
            has_loc = false;
            if should_print != 1 {
                continue;
            }
            let skip = if len == 1 {
                let is_single_line = match comment.has_loc {
                    true => comment.start_line == comment.end_line,
                    false => !has_newline(model.comment_value(id)),
                };
                let is_statement = matches!(node, Node::Import(_) | Node::Empty | Node::NewLine);
                match is_single_line && !is_statement && kind != 1 {
                    true => SkipNewLines::All,
                    false => SkipNewLines::Default,
                }
            } else if kind == 1 {
                match index {
                    0 => SkipNewLines::Leading,
                    _ if index == len - 1 => SkipNewLines::Trailing,
                    _ => SkipNewLines::Default,
                }
            } else {
                SkipNewLines::Default
            };
            self.print_comment(id, skip);
        }
        if kind == 2 && has_loc && last_line != 0 {
            self.last_comment_line = last_line;
        }
        2
    }

    // ───────────────────────────── generators/ ─────────────────────────────

    fn print_node(&mut self, node: Node) {
        let model = self.model;
        match node {
            Node::Interpreter => {
                let span = model.interpreter.map(|it| it.0).unwrap_or_default();
                self.token(model.file.slice(span));
                self.newline_char();
            }
            Node::Directive(index) => {
                self.print(Node::DirectiveLiteral(index), false, 0);
                self.semicolon(false);
            }
            Node::DirectiveLiteral(index) => {
                self.token(model.file.slice(model.directives[index as usize].literal))
            }
            Node::Import(index) => self.import_declaration(index),
            Node::Specifier(index) => self.import_specifier(index),
            Node::Imported(index) => {
                self.module_export_name(model.specifiers[index as usize].imported)
            }
            Node::Local(index) => self.module_export_name(model.specifiers[index as usize].local),
            Node::Source(_) | Node::AttributeKey(_) | Node::AttributeValue(_) => {
                let text = model.file.slice(model.span(node).unwrap_or_default());
                match matches!(text.first(), Some(b'"' | b'\'')) {
                    true => self.token(text),
                    false => self.word(text),
                }
            }
            Node::Attribute(start) => {
                self.print(Node::AttributeKey(start), false, 0);
                self.token_char(b':');
                self.space();
                self.print(Node::AttributeValue(start), false, 0);
            }
            Node::Empty => self.semicolon(true),
            Node::NewLine => {
                self.print(Node::NewLineLiteral, false, 0);
                self.semicolon(false);
                self.is_queued_hidden = true;
            }
            Node::NewLineLiteral => {
                self.maybe_print_inner_comments();
                self.flush();
                self.out.extend_from_slice(self.end_of_line);
                self.out.extend_from_slice(self.end_of_line);
                self.kept_len = self.out.len();
                self.last = LAST_IS_TEXT;
                self.no_line_terminator = false;
            }
        }
    }

    /// An `Identifier`, or a `StringLiteral`.
    fn module_export_name(&mut self, name: bun_lint::ast::Ident<'a>) {
        match name.is_string() {
            true => self.token(self.model.file.slice(name.span())),
            false => self.word(name.bytes()),
        }
    }

    fn import_specifier(&mut self, index: u32) {
        let specifier = self.model.specifiers[index as usize];
        match specifier.kind {
            SpecifierKind::Default => self.print(Node::Local(index), false, 0),
            SpecifierKind::Namespace => {
                self.token_char(b'*');
                self.space();
                self.word(b"as");
                self.space();
                self.print(Node::Local(index), false, 0);
            }
            SpecifierKind::Named => {
                if specifier.is_type {
                    self.word(b"type");
                    self.space();
                }
                self.print(Node::Imported(index), false, 0);
                // `imported.name` of a string is undefined.
                if specifier.imported.is_string()
                    || specifier.local.bytes() != specifier.imported.bytes()
                {
                    self.space();
                    self.word(b"as");
                    self.space();
                    self.print(Node::Local(index), false, 0);
                }
            }
        }
    }

    /// The same as `import_declaration` where no import has a comment in it.
    fn import_declaration_without_comments(&mut self, index: u32) {
        let model = self.model;
        let declaration = model.declarations[index as usize];
        self.flush();
        let out = &mut self.out;
        out.extend_from_slice(b"import ");
        if declaration.is_type {
            out.extend_from_slice(b"type ");
        } else if declaration.import.is_deferred() && declaration.span.is_some() {
            out.extend_from_slice(b"defer ");
        }
        let specifiers = model.specifiers_of(&declaration);
        let mut is_in_braces = false;
        for (at, &specifier) in specifiers.iter().enumerate() {
            let specifier = &model.specifiers[specifier as usize];
            if at > 0 {
                out.extend_from_slice(b", ");
            }
            match specifier.kind {
                SpecifierKind::Default => {}
                SpecifierKind::Namespace => out.extend_from_slice(b"* as "),
                SpecifierKind::Named => {
                    if !std::mem::replace(&mut is_in_braces, true) {
                        out.extend_from_slice(b"{ ");
                    }
                    if specifier.is_type {
                        out.extend_from_slice(b"type ");
                    }
                    let is_string = specifier.imported.is_string();
                    if is_string || specifier.local.bytes() != specifier.imported.bytes() {
                        out.extend_from_slice(if is_string {
                            model.file.slice(specifier.imported.span())
                        } else {
                            specifier.imported.bytes()
                        });
                        out.extend_from_slice(b" as ");
                    }
                }
            }
            out.extend_from_slice(specifier.local.bytes());
        }
        if is_in_braces {
            out.extend_from_slice(b" }");
        } else if declaration.is_type && specifiers.is_empty() {
            out.extend_from_slice(b"{}");
        }
        if !specifiers.is_empty() || declaration.is_type {
            out.extend_from_slice(b" from ");
        }
        out.extend_from_slice(model.file.slice(model.source_span(&declaration)));
        if let Some(attributes) = declaration
            .import
            .attributes()
            .filter(|_| declaration.has_attributes)
        {
            let is_legacy = self.attributes_keyword.ends_with(b"-legacy");
            out.push(b' ');
            out.extend_from_slice(
                self.attributes_keyword
                    .strip_suffix(b"-legacy")
                    .unwrap_or(self.attributes_keyword),
            );
            out.extend_from_slice(if is_legacy { b" " } else { b" { " });
            let mut is_first = true;
            for attribute in attributes.entries().iter() {
                let (Some(key), Some(value)) =
                    (attribute_key_span(model.file, attribute), attribute.value())
                else {
                    continue;
                };
                if !std::mem::replace(&mut is_first, false) {
                    out.extend_from_slice(b", ");
                }
                out.extend_from_slice(model.file.slice(key));
                out.extend_from_slice(b": ");
                out.extend_from_slice(model.file.slice(value.span()));
            }
            if !is_legacy {
                out.extend_from_slice(b" }");
            }
        }
        self.last = LAST_IS_TEXT;
        self.semicolon(false);
    }

    fn import_declaration(&mut self, index: u32) {
        let model = self.model;
        if !model.has_comments_in_imports {
            return self.import_declaration_without_comments(index);
        }
        let declaration = model.declarations[index as usize];
        self.word(b"import");
        self.space();
        if declaration.is_type {
            self.no_indent_inner_comments_here();
            self.word(b"type");
            self.space();
        } else if declaration.import.is_deferred() && declaration.span.is_some() {
            self.no_indent_inner_comments_here();
            self.word(b"defer");
            self.space();
        }

        let specifiers = model.specifiers_of(&declaration);
        let has_specifiers = !specifiers.is_empty();
        let special = specifiers
            .iter()
            .take_while(|it| model.specifiers[**it as usize].kind != SpecifierKind::Named)
            .count();
        for (at, &specifier) in specifiers[..special].iter().enumerate() {
            self.print(Node::Specifier(specifier), false, 0);
            if at + 1 < specifiers.len() {
                self.token_char(b',');
                self.space();
            }
        }
        if special < specifiers.len() {
            self.token_char(b'{');
            self.space();
            let nodes: Vec<Node> = specifiers[special..]
                .iter()
                .map(|it| Node::Specifier(*it))
                .collect();
            self.print_list(&nodes);
            self.space();
            self.token_char(b'}');
        } else if declaration.is_type && !has_specifiers {
            self.token_char(b'{');
            self.token_char(b'}');
        }
        if has_specifiers || declaration.is_type {
            self.space();
            self.word(b"from");
            self.space();
        }

        let source = Node::Source(model.source_span(&declaration).start);
        let attributes = declaration
            .import
            .attributes()
            .filter(|_| declaration.has_attributes);
        match attributes {
            Some(attributes) => {
                self.print(source, true, 0);
                self.space();
                // `_printAttributes`
                self.word(
                    self.attributes_keyword
                        .strip_suffix(b"-legacy")
                        .unwrap_or(self.attributes_keyword),
                );
                self.space();
                let nodes: Vec<Node> = (attributes.entries().iter())
                    .filter(|it| attribute_key_span(model.file, *it).is_some())
                    .map(|it| Node::Attribute(it.span().start))
                    .collect();
                if self.attributes_keyword.ends_with(b"-legacy") {
                    self.print_list(&nodes);
                } else {
                    self.token(b"{");
                    self.space();
                    self.print_list(&nodes);
                    self.space();
                    self.token(b"}");
                }
            }
            None => self.print(source, false, 0),
        }
        self.semicolon(false);
    }
}

/// `/[\n\r  ]/.test(text)`
fn has_newline(text: &[u8]) -> bool {
    strings::index_of_any(text, b"\n\r").is_some()
        || strings::contains(text, b"\xE2\x80\xA8")
        || strings::contains(text, b"\xE2\x80\xA9")
}

/// `adjustMultilineComment`: takes up to `offset` characters of whitespace off the start of every
/// line of `comment` but the first, and puts `indent_size` spaces there.
fn adjust_multiline_comment(comment: &[u8], offset: u32, indent_size: u32) -> Vec<u8> {
    let mut out = Vec::with_capacity(comment.len());
    let mut rest = comment;
    while let Some(at) = strings::index_of_char_usize(rest, b'\n') {
        out.extend_from_slice(&rest[..=at]);
        out.resize(out.len() + indent_size as usize, b' ');
        rest = &rest[at + 1..];
        // `\n\s{1,offset}`, which can take line breaks too.
        for _ in 0..offset {
            match white_space_len(rest) {
                0 => break,
                len => rest = &rest[len..],
            }
        }
    }
    out.extend_from_slice(rest);
    out
}
