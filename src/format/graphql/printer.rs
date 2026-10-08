//! The document of a GraphQL text: Prettier's `src/language-graphql/printer-graphql.js`, and what
//! `src/main/comments/print.js` does with the comments.

use super::comments::{Attached, Placement, has_newline_after, has_newline_before};
use super::parser::{
    HAS_ALIAS, IS_BLOCK, IS_REPEATABLE, IS_SHORTHAND, Kind, MUTATION, NodeId, SUBSCRIPTION, Tree,
    read_escape,
};
use crate::ir::element::{Condition, FormatElement, Group, LineMode, PrintMode, Tag, TextWidth};
use crate::ir::formatter::Formatter;
use crate::js::print::program::is_next_line_empty;
use crate::js::source_text::SourceText;
use bun_lint::span::Span;

/// Writes the elements of a document.
pub(crate) struct Builder<'t, 'f, 'a> {
    pub(crate) text: &'t [u8],
    pub(crate) tree: &'t Tree,
    pub(crate) attached: &'t [Attached],
    pub(crate) f: &'f mut Formatter<'a>,
    /// The document is for a template literal of JavaScript, in which `\`, `` ` `` and `${` have to
    /// be escaped.
    pub(crate) is_in_template: bool,
}

/// The children of a node that have not been written yet.
struct Children<'t> {
    tree: &'t Tree,
    rest: &'t [NodeId],
}

impl<'t> Children<'t> {
    /// The next one, if it is what `is_wanted` says.
    fn next_if(&mut self, is_wanted: impl Fn(Kind) -> bool) -> Option<NodeId> {
        let (&first, rest) = self.rest.split_first()?;
        if !is_wanted(self.tree.kind(first)) {
            return None;
        }
        self.rest = rest;
        Some(first)
    }

    fn next_of(&mut self, kind: Kind) -> Option<NodeId> {
        self.next_if(|it| it == kind)
    }

    /// The next ones of `kind`.
    fn all_of(&mut self, kind: Kind) -> &'t [NodeId] {
        let count = self
            .rest
            .iter()
            .take_while(|&&id| self.tree.kind(id) == kind)
            .count();
        let (all, rest) = self.rest.split_at(count);
        self.rest = rest;
        all
    }
}

impl<'t> Builder<'t, '_, '_> {
    // ───────────────────────────── elements ─────────────────────────────

    #[inline]
    fn push(&mut self, element: FormatElement) {
        self.f.write_element(element);
    }

    fn tag(&mut self, tag: Tag) {
        self.push(FormatElement::Tag(tag));
    }

    fn token(&mut self, text: &'static str) {
        self.f.write_token(text);
    }

    fn line(&mut self, mode: LineMode) {
        self.push(FormatElement::Line(mode));
    }

    fn hardline(&mut self) {
        self.line(LineMode::Hard);
    }

    fn group(&mut self, content: impl FnOnce(&mut Self)) {
        self.tag(Tag::StartGroup(Group::new()));
        content(self);
        self.tag(Tag::EndGroup);
    }

    fn indent(&mut self, content: impl FnOnce(&mut Self)) {
        self.tag(Tag::StartIndent);
        content(self);
        self.tag(Tag::EndIndent);
    }

    /// `text`, if the enclosing group is written in `mode`.
    fn token_if(&mut self, mode: PrintMode, text: &'static str) {
        self.tag(Tag::StartConditionalContent(Condition::new(mode)));
        self.token(text);
        self.tag(Tag::EndConditionalContent);
    }

    fn needs_escapes(&self, text: &[u8]) -> bool {
        self.is_in_template
            && (bun_core::strings::index_of_any(text, b"\\`").is_some()
                || bun_core::strings::contains(text, b"${"))
    }

    /// Prettier's `uncookTemplateElementValue`
    fn escape_for_template(text: &[u8], out: &mut Vec<u8>) {
        for (index, &byte) in text.iter().enumerate() {
            if matches!(byte, b'\\' | b'`') || (byte == b'$' && text.get(index + 1) == Some(&b'{'))
            {
                out.push(b'\\');
            }
            out.push(byte);
        }
    }

    /// `text`, which is on one line. It is not copied if it is a part of the source text.
    fn text(&mut self, text: &[u8]) {
        if self.needs_escapes(text) {
            let mut escaped = Vec::with_capacity(text.len() + 8);
            Self::escape_for_template(text, &mut escaped);
            let width = TextWidth::single(self.f.string_width(&escaped));
            return self.f.write_text(&escaped, Some(width));
        }
        let width = TextWidth::single(self.f.string_width(text));
        self.f.write_text(text, Some(width));
    }

    fn slice(&self, span: Span) -> &'t [u8] {
        self.text
            .get(span.start as usize..span.end as usize)
            .unwrap_or_default()
    }

    /// The part of the text at `span`, which is on one line.
    fn source(&mut self, span: Span) {
        self.text(self.slice(span));
    }

    // ───────────────────────────── comments ─────────────────────────────

    fn comments_of(&self, id: NodeId) -> &'t [Attached] {
        if self.attached.is_empty() {
            return &[];
        }
        let start = self.attached.partition_point(|it| it.node < id);
        let count = self.attached[start..]
            .iter()
            .take_while(|it| it.node == id)
            .count();
        &self.attached[start..start + count]
    }

    fn comment_span(&self, attached: &Attached) -> Span {
        self.tree
            .comments
            .get(attached.comment as usize)
            .copied()
            .unwrap_or_default()
    }

    /// Prettier's `printComment`
    fn comment(&mut self, span: Span) {
        let len = self.slice(span).trim_ascii_end().len() as u32;
        self.source(Span::new(span.start, span.start + len));
    }

    /// Whether the line before the one that `position` is on is empty.
    fn is_previous_line_empty(&self, position: u32) -> bool {
        fn strip_line_break(text: &[u8]) -> Option<&[u8]> {
            match text {
                [rest @ .., b'\r', b'\n'] | [rest @ .., b'\n' | b'\r'] => Some(rest),
                _ => None,
            }
        }
        fn trim_blanks(text: &[u8]) -> &[u8] {
            let blanks = text
                .iter()
                .rev()
                .take_while(|byte| matches!(byte, b' ' | b'\t'))
                .count();
            &text[..text.len() - blanks]
        }
        let before = trim_blanks(self.text.get(..position as usize).unwrap_or_default());
        let before = trim_blanks(strip_line_break(before).unwrap_or(before));
        strip_line_break(before).is_some()
    }

    /// Prettier's `printLeadingComment`
    fn leading_comment(&mut self, span: Span) {
        self.comment(span);
        // An empty line after it is kept.
        let after = self.text.get(span.end as usize..).unwrap_or_default();
        let blanks = after
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
        let line_break = match after.get(blanks..) {
            Some([b'\r', b'\n', ..]) => 2,
            Some([b'\n' | b'\r', ..]) => 1,
            _ => 0,
        };
        match has_newline_after(self.text, span.end + (blanks + line_break) as u32) {
            true => self.line(LineMode::Empty),
            false => self.hardline(),
        }
    }

    /// Prettier's `printTrailingComments`
    fn trailing_comments(&mut self, comments: &[Attached]) {
        let mut is_after_line_suffix = false;
        for attached in comments
            .iter()
            .filter(|it| it.placement == Placement::Trailing)
        {
            let span = self.comment_span(attached);
            self.tag(Tag::StartLineSuffix);
            let is_on_own_line = is_after_line_suffix || has_newline_before(self.text, span.start);
            match is_on_own_line {
                true if self.is_previous_line_empty(span.start) => self.line(LineMode::Empty),
                true => self.hardline(),
                false => self.push(FormatElement::Space),
            }
            self.comment(span);
            self.tag(Tag::EndLineSuffix);
            if !is_on_own_line {
                self.push(FormatElement::ExpandParent);
            }
            is_after_line_suffix = true;
        }
    }

    /// Prettier's `printDanglingComments` with `indent: true`
    fn dangling_comments(&mut self, id: NodeId) {
        let comments = self.comments_of(id);
        if !comments
            .iter()
            .any(|it| it.placement == Placement::Dangling)
        {
            return;
        }
        self.indent(|b| {
            for attached in comments
                .iter()
                .filter(|it| it.placement == Placement::Dangling)
            {
                b.hardline();
                b.comment(b.comment_span(attached));
            }
        });
    }

    /// What has a `prettier-ignore` comment, as it is in the text. For Prettier that is a string like
    /// any other: its line breaks do not break the groups around it, and all of it counts as being
    /// on the line.
    fn ignored(&mut self, span: Span) {
        let text = self.slice(span);
        let width = Some(TextWidth::single(self.f.string_width(text)));
        let line_ending = self
            .f
            .options()
            .line_ending
            .resolve(self.f.source_text().as_bytes())
            .as_bytes();
        let needs_escapes = self.needs_escapes(text);
        if !needs_escapes && line_ending == b"\n" && !bun_core::strings::contains_char(text, b'\r')
        {
            return self.f.write_text(text, width);
        }
        let mut written = Vec::with_capacity(text.len() + 16);
        for (index, line) in bun_core::strings::split(text, b"\n").enumerate() {
            if index > 0 {
                written.extend_from_slice(line_ending);
            }
            let line = line.strip_suffix(b"\r").unwrap_or(line);
            match needs_escapes {
                true => Self::escape_for_template(line, &mut written),
                false => written.extend_from_slice(line),
            }
        }
        self.f.write_text(&written, width);
    }

    // ───────────────────────────── nodes ─────────────────────────────

    /// A node with its comments.
    pub(crate) fn print(&mut self, id: NodeId) {
        if !self.f.context_mut().has_stack_left() {
            return;
        }
        let comments = self.comments_of(id);
        if comments.is_empty() {
            return self.print_node(id);
        }
        for attached in comments
            .iter()
            .filter(|it| it.placement == Placement::Leading)
        {
            self.leading_comment(self.comment_span(attached));
        }
        let is_ignored = comments.iter().any(|it| {
            let comment = self.slice(self.comment_span(it));
            matches!(
                comment.get(1..).unwrap_or_default().trim_ascii(),
                b"prettier-ignore" | b"oxfmt-ignore"
            )
        });
        match is_ignored {
            true => self.ignored(self.tree.span(id)),
            false => self.print_node(id),
        }
        self.trailing_comments(comments);
    }

    /// The document without the line break at its end: what Prettier's `textToDoc` returns.
    pub(crate) fn print_definitions(&mut self) {
        self.sequence(self.tree.children(self.tree.root()));
    }

    /// Prettier's `printGraphqlComments`: the text is nothing but comments and white space.
    pub(crate) fn print_comment_lines(&mut self) {
        let (mut has_comment, mut is_after_blank_line, mut start) = (false, false, 0);
        for line in bun_core::strings::split(self.text, b"\n") {
            let comment = super::trim(line);
            if !comment.is_empty() {
                match (has_comment, is_after_blank_line) {
                    (false, _) => {}
                    (true, true) => self.line(LineMode::Empty),
                    (true, false) => self.hardline(),
                }
                has_comment = true;
                let comment_start =
                    start + (line.len() - crate::range::trim_start(line).len()) as u32;
                self.source(Span::new(
                    comment_start,
                    comment_start + comment.len() as u32,
                ));
            }
            is_after_blank_line = comment.is_empty();
            start += line.len() as u32 + 1;
        }
    }

    fn print_optional(&mut self, id: Option<NodeId>) {
        if let Some(id) = id {
            self.print(id);
        }
    }

    fn children(&self, id: NodeId) -> Children<'t> {
        Children {
            tree: self.tree,
            rest: self.tree.children(id),
        }
    }

    /// Prettier's `printSequence`, joined by line breaks: an empty line after a node is kept.
    fn sequence(&mut self, nodes: &[NodeId]) {
        for (index, &id) in nodes.iter().enumerate() {
            self.print(id);
            if index + 1 < nodes.len() {
                match is_next_line_empty(SourceText::new(self.text), self.tree.span(id).end) {
                    true => self.line(LineMode::Empty),
                    false => self.hardline(),
                }
            }
        }
    }

    /// ` {`, `nodes` on lines of their own, `}`
    fn block(&mut self, nodes: &[NodeId]) {
        self.token("{");
        self.indent(|b| {
            b.hardline();
            b.sequence(nodes);
        });
        self.hardline();
        self.token("}");
    }

    /// `(a, b)`, or each on its own line without the commas. `keeps_empty_lines`: Prettier's
    /// `printSequence`.
    fn parenthesized(&mut self, nodes: &[NodeId], keeps_empty_lines: bool) {
        if nodes.is_empty() {
            return;
        }
        self.group(|b| {
            b.token("(");
            b.indent(|b| {
                b.line(LineMode::Soft);
                b.list(nodes, keeps_empty_lines);
            });
            b.line(LineMode::Soft);
            b.token(")");
        });
    }

    /// `a, b`, or each on its own line.
    fn list(&mut self, nodes: &[NodeId], keeps_empty_lines: bool) {
        for (index, &id) in nodes.iter().enumerate() {
            self.print(id);
            if index + 1 == nodes.len() {
                break;
            }
            // That empty line is a forced line break.
            if keeps_empty_lines
                && is_next_line_empty(SourceText::new(self.text), self.tree.span(id).end)
            {
                self.line(LineMode::Empty);
            } else {
                self.token_if(PrintMode::Flat, ", ");
                self.line(LineMode::Soft);
            }
        }
    }

    /// Prettier's `printDescription`
    fn description(&mut self, children: &mut Children<'t>, owner: Kind) {
        let Some(description) = children.next_of(Kind::StringValue) else {
            return;
        };
        self.print(description);
        let is_block = self
            .tree
            .node(description)
            .is_some_and(|node| node.flags & IS_BLOCK != 0);
        match owner == Kind::InputValueDefinition && !is_block {
            true => self.line(LineMode::SoftOrSpace),
            false => self.hardline(),
        }
    }

    /// Prettier's `printDirectives`
    fn directives(&mut self, children: &mut Children<'t>, owner: Kind) {
        let directives = children.all_of(Kind::Directive);
        if directives.is_empty() {
            return;
        }
        let join = |b: &mut Self| {
            for (index, &directive) in directives.iter().enumerate() {
                if index > 0 {
                    b.line(LineMode::SoftOrSpace);
                }
                b.print(directive);
            }
        };
        if matches!(owner, Kind::FragmentDefinition | Kind::OperationDefinition) {
            return self.group(|b| {
                b.line(LineMode::SoftOrSpace);
                join(b);
            });
        }
        self.token(" ");
        self.group(|b| {
            b.indent(|b| {
                b.line(LineMode::Soft);
                join(b);
            });
        });
    }

    fn operation(&mut self, flags: u8) {
        self.token(match flags {
            MUTATION => "mutation",
            SUBSCRIPTION => "subscription",
            _ => "query",
        });
    }

    fn string_value(&mut self, span: Span, is_block: bool) {
        let raw = self.slice(span);
        if is_block {
            return self.block_string(raw.get(3..raw.len().saturating_sub(3)).unwrap_or_default());
        }
        // Without escapes, it is written as it is.
        if !bun_core::strings::contains_char(raw, b'\\') {
            return self.source(span);
        }
        // Of the characters that the escapes stand for, only three are escaped again.
        let mut value = Vec::with_capacity(raw.len());
        value.push(b'"');
        let mut rest = raw.get(1..raw.len().saturating_sub(1)).unwrap_or_default();
        while let Some(at) = bun_core::strings::index_of_char_usize(rest, b'\\') {
            value.extend_from_slice(&rest[..at]);
            let (character, len) = read_escape(&rest[at..]).unwrap_or(('\\', 1));
            match character {
                '"' => value.extend_from_slice(b"\\\""),
                '\\' => value.extend_from_slice(b"\\\\"),
                '\n' => value.extend_from_slice(b"\\n"),
                _ => value.extend_from_slice(character.encode_utf8(&mut [0; 4]).as_bytes()),
            }
            rest = rest.get(at + len..).unwrap_or_default();
        }
        value.extend_from_slice(rest);
        value.push(b'"');
        self.text(&value);
    }

    /// `content`: what is between the `"""`.
    fn block_string(&mut self, content: &'t [u8]) {
        fn leading_blanks(line: &[u8]) -> usize {
            line.iter()
                .take_while(|byte| matches!(byte, b' ' | b'\t'))
                .count()
        }
        fn lines(content: &[u8]) -> impl Iterator<Item = &[u8]> + Clone {
            // `\r\n`, `\n` and `\r` end a line.
            let mut rest = Some(content);
            std::iter::from_fn(move || {
                let text = rest?;
                let Some(at) = bun_core::strings::index_of_any(text, b"\n\r") else {
                    rest = None;
                    return Some(text);
                };
                let len = if text[at..].starts_with(b"\r\n") {
                    2
                } else {
                    1
                };
                rest = Some(&text[at + len..]);
                Some(&text[..at])
            })
        }

        // graphql-js's `dedentBlockStringLines`
        let is_blank = |line: &[u8]| leading_blanks(line) == line.len();
        let common_indent = lines(content)
            .skip(1)
            .filter(|line| !is_blank(line))
            .map(leading_blanks)
            .min()
            .unwrap_or(usize::MAX);
        let first = lines(content).position(|line| !is_blank(line)).unwrap_or(0);
        let count = lines(content)
            .enumerate()
            .filter(|(_, line)| !is_blank(line))
            .last()
            .map_or(0, |(last, _)| last + 1 - first);
        let dedented = lines(content)
            .enumerate()
            .skip(first)
            .take(count)
            .map(|(index, line)| match index {
                0 => line,
                _ => line
                    .get(common_indent.min(line.len())..)
                    .unwrap_or_default(),
            });

        self.token("\"\"\"");
        let mut empty_lines = 0;
        for line in dedented {
            // The printer of Prettier leaves out the blanks at the end of a line.
            let mut line = &line[..line.len()
                - line
                    .iter()
                    .rev()
                    .take_while(|byte| matches!(byte, b' ' | b'\t'))
                    .count()];
            if count == 1 {
                line = line.trim_ascii();
            }
            if line.is_empty() {
                empty_lines += 1;
                continue;
            }
            self.line_breaks(empty_lines);
            empty_lines = 0;
            self.text(line);
        }
        self.hardline();
        self.token("\"\"\"");
    }

    /// A line break after so many empty lines.
    fn line_breaks(&mut self, empty_lines: usize) {
        match empty_lines {
            0 => {}
            1 => return self.line(LineMode::Empty),
            // The printer writes no more than one empty line for line breaks.
            _ => self
                .f
                .write_text(&vec![b'\n'; empty_lines + 1], Some(TextWidth::multiline(0))),
        }
        self.hardline();
    }

    /// A node without its comments: Prettier's `genericPrint`.
    fn print_node(&mut self, id: NodeId) {
        let Some(&node) = self.tree.node(id) else {
            return;
        };
        let kind = node.kind;
        let mut children = self.children(id);
        match kind {
            Kind::Document => {
                self.sequence(children.rest);
                self.hardline();
            }
            Kind::OperationDefinition => {
                self.description(&mut children, kind);
                let has_operation = node.flags != IS_SHORTHAND;
                let name = children.next_of(Kind::Name);
                let variables = children.all_of(Kind::VariableDefinition);
                if has_operation {
                    self.operation(node.flags);
                    if name.is_some() || !variables.is_empty() {
                        self.token(" ");
                    }
                    self.print_optional(name);
                }
                self.parenthesized(variables, false);
                self.directives(&mut children, kind);
                if has_operation {
                    self.token(" ");
                }
                self.print_optional(children.next_of(Kind::SelectionSet));
            }
            Kind::FragmentDefinition => {
                self.description(&mut children, kind);
                self.token("fragment ");
                self.print_optional(children.next_of(Kind::Name));
                self.parenthesized(children.all_of(Kind::VariableDefinition), false);
                self.token(" on ");
                self.print_optional(children.next_of(Kind::NamedType));
                self.directives(&mut children, kind);
                self.token(" ");
                self.print_optional(children.next_of(Kind::SelectionSet));
            }
            Kind::SelectionSet => self.block(children.rest),
            Kind::Field => self.group(|b| {
                if node.flags & HAS_ALIAS != 0 {
                    b.print_optional(children.next_of(Kind::Name));
                    b.token(": ");
                }
                b.print_optional(children.next_of(Kind::Name));
                b.parenthesized(children.all_of(Kind::Argument), true);
                b.directives(&mut children, kind);
                if let Some(selection_set) = children.next_of(Kind::SelectionSet) {
                    b.token(" ");
                    b.print(selection_set);
                }
            }),
            Kind::Name
            | Kind::IntValue
            | Kind::FloatValue
            | Kind::EnumValue
            | Kind::BooleanValue
            | Kind::NullValue => {
                self.source(node.span);
            }
            Kind::StringValue => self.string_value(node.span, node.flags & IS_BLOCK != 0),
            Kind::Variable => {
                self.token("$");
                self.print_optional(children.next_of(Kind::Name));
            }
            Kind::ListValue => self.group(|b| {
                b.token("[");
                b.dangling_comments(id);
                if !children.rest.is_empty() {
                    b.indent(|b| {
                        b.line(LineMode::Soft);
                        b.list(children.rest, false);
                    });
                }
                b.line(LineMode::Soft);
                b.token("]");
            }),
            Kind::ObjectValue => self.group(|b| {
                let has_space = b.f.options().bracket_spacing.value() && !children.rest.is_empty();
                b.token(if has_space { "{ " } else { "{" });
                b.dangling_comments(id);
                if !children.rest.is_empty() {
                    b.indent(|b| {
                        b.line(LineMode::Soft);
                        b.list(children.rest, false);
                    });
                }
                b.line(LineMode::Soft);
                if has_space {
                    b.token_if(PrintMode::Flat, " ");
                }
                b.token("}");
            }),
            Kind::ObjectField | Kind::Argument | Kind::FragmentArgument => {
                self.print_optional(children.next_of(Kind::Name));
                self.token(": ");
                self.print_optional(children.next_if(Kind::is_value));
            }
            Kind::Directive => {
                self.token("@");
                self.print_optional(children.next_of(Kind::Name));
                self.parenthesized(children.all_of(Kind::Argument), true);
            }
            Kind::NamedType => self.print_optional(children.next_of(Kind::Name)),
            Kind::VariableDefinition | Kind::InputValueDefinition => {
                self.description(&mut children, kind);
                self.print_optional(
                    children.next_if(|it| matches!(it, Kind::Variable | Kind::Name)),
                );
                self.token(": ");
                self.print_optional(children.next_if(Kind::is_type));
                if let Some(default_value) = children.next_if(Kind::is_value) {
                    self.token(" = ");
                    self.print(default_value);
                }
                self.directives(&mut children, kind);
            }
            Kind::ObjectTypeExtension
            | Kind::ObjectTypeDefinition
            | Kind::InputObjectTypeExtension
            | Kind::InputObjectTypeDefinition
            | Kind::InterfaceTypeExtension
            | Kind::InterfaceTypeDefinition => {
                match kind {
                    Kind::ObjectTypeDefinition
                    | Kind::InputObjectTypeDefinition
                    | Kind::InterfaceTypeDefinition => {
                        self.description(&mut children, kind);
                    }
                    _ => self.token("extend "),
                }
                self.token(match kind {
                    Kind::ObjectTypeDefinition | Kind::ObjectTypeExtension => "type ",
                    Kind::InputObjectTypeDefinition | Kind::InputObjectTypeExtension => "input ",
                    _ => "interface ",
                });
                self.print_optional(children.next_of(Kind::Name));
                let interfaces = children.all_of(Kind::NamedType);
                if !interfaces.is_empty() {
                    self.token(" implements ");
                    self.indent(|b| {
                        b.group(|b| {
                            for (index, &interface) in interfaces.iter().enumerate() {
                                if index > 0 {
                                    b.token(" &");
                                    b.line(LineMode::SoftOrSpace);
                                }
                                b.print(interface);
                            }
                        });
                    });
                }
                self.directives(&mut children, kind);
                if !children.rest.is_empty() {
                    self.token(" ");
                    self.block(children.rest);
                }
            }
            Kind::FieldDefinition => {
                self.description(&mut children, kind);
                self.print_optional(children.next_of(Kind::Name));
                self.parenthesized(children.all_of(Kind::InputValueDefinition), true);
                self.token(": ");
                self.print_optional(children.next_if(Kind::is_type));
                self.directives(&mut children, kind);
            }
            Kind::DirectiveDefinition => {
                self.description(&mut children, kind);
                self.token("directive @");
                self.print_optional(children.next_of(Kind::Name));
                self.parenthesized(children.all_of(Kind::InputValueDefinition), true);
                self.directives(&mut children, kind);
                if node.flags & IS_REPEATABLE != 0 {
                    self.token(" repeatable");
                }
                self.token(" on ");
                for (index, &location) in children.rest.iter().enumerate() {
                    if index > 0 {
                        self.token(" | ");
                    }
                    self.print(location);
                }
            }
            Kind::DirectiveExtension => {
                self.token("extend ");
                self.token("directive @");
                self.print_optional(children.next_of(Kind::Name));
                self.directives(&mut children, kind);
            }
            Kind::EnumTypeExtension | Kind::EnumTypeDefinition => {
                self.description(&mut children, kind);
                if kind == Kind::EnumTypeExtension {
                    self.token("extend ");
                }
                self.token("enum ");
                self.print_optional(children.next_of(Kind::Name));
                self.directives(&mut children, kind);
                if !children.rest.is_empty() {
                    self.token(" ");
                    self.block(children.rest);
                }
            }
            Kind::EnumValueDefinition => {
                self.description(&mut children, kind);
                self.print_optional(children.next_of(Kind::Name));
                self.directives(&mut children, kind);
            }
            Kind::SchemaExtension | Kind::SchemaDefinition => {
                self.description(&mut children, kind);
                self.token(if kind == Kind::SchemaExtension {
                    "extend schema"
                } else {
                    "schema"
                });
                self.directives(&mut children, kind);
                if !children.rest.is_empty() {
                    self.token(" ");
                    self.block(children.rest);
                }
            }
            Kind::OperationTypeDefinition => {
                self.operation(node.flags);
                self.token(": ");
                self.print_optional(children.next_of(Kind::NamedType));
            }
            Kind::FragmentSpread => {
                self.token("...");
                self.print_optional(children.next_of(Kind::Name));
                self.parenthesized(children.all_of(Kind::FragmentArgument), true);
                self.directives(&mut children, kind);
            }
            Kind::InlineFragment => {
                self.token("...");
                if let Some(type_condition) = children.next_of(Kind::NamedType) {
                    self.token(" on ");
                    self.print(type_condition);
                }
                self.directives(&mut children, kind);
                self.token(" ");
                self.print_optional(children.next_of(Kind::SelectionSet));
            }
            Kind::UnionTypeExtension | Kind::UnionTypeDefinition => self.group(|b| {
                b.description(&mut children, kind);
                b.group(|b| {
                    if kind == Kind::UnionTypeExtension {
                        b.token("extend ");
                    }
                    b.token("union ");
                    b.print_optional(children.next_of(Kind::Name));
                    b.directives(&mut children, kind);
                    if children.rest.is_empty() {
                        return;
                    }
                    b.token(" =");
                    b.token_if(PrintMode::Flat, " ");
                    b.indent(|b| {
                        b.tag(Tag::StartConditionalContent(Condition::new(
                            PrintMode::Expanded,
                        )));
                        b.line(LineMode::SoftOrSpace);
                        b.token("| ");
                        b.tag(Tag::EndConditionalContent);
                        for (index, &member) in children.rest.iter().enumerate() {
                            if index > 0 {
                                b.line(LineMode::SoftOrSpace);
                                b.token("| ");
                            }
                            b.print(member);
                        }
                    });
                });
            }),
            Kind::ScalarTypeExtension | Kind::ScalarTypeDefinition => {
                self.description(&mut children, kind);
                if kind == Kind::ScalarTypeExtension {
                    self.token("extend ");
                }
                self.token("scalar ");
                self.print_optional(children.next_of(Kind::Name));
                self.directives(&mut children, kind);
            }
            Kind::NonNullType => {
                self.print_optional(children.next_if(Kind::is_type));
                self.token("!");
            }
            Kind::ListType => {
                self.token("[");
                self.print_optional(children.next_if(Kind::is_type));
                self.token("]");
            }
        }
    }
}
