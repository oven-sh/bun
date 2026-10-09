//! Prettier's `language-yaml`: `printer-yaml.js`, `print/*.js` and `utilities.js`.

use super::ast::{Chomping, Id, Kind, List, Node, Tree};
use super::compose::{ScalarType, scalar_source};
use crate::css::doc::{Alignment, Elements, Group, IndentCommand, Line};
use crate::options::ProseWrap;
use crate::text::{self, has_newline_backwards, is_previous_line_empty};
use bun_core::strings;
use std::borrow::Cow;

pub(crate) struct Printer<'t, 'a> {
    pub(crate) tree: &'t Tree<'a>,
    /// `options.originalText`
    pub(crate) text: &'a [u8],
    pub(crate) prose_wrap: ProseWrap,
    pub(crate) single_quote: bool,
    pub(crate) bracket_spacing: bool,
    /// `trailingComma` is not `"none"`.
    pub(crate) trailing_comma: bool,
    pub(crate) tab_width: u32,
    /// As oxfmt prints it, where that is not as Prettier does.
    pub(crate) is_oxfmt: bool,
    /// Of the document that is being printed.
    pub(crate) is_last_document: bool,
    /// Of the mapping or sequence whose first item is printed next.
    pub(crate) is_first_item_ignored: bool,
    /// `printedEmptyLineCache`: for each position, whether a node ends there whose next line has been looked at.
    pub(crate) printed_empty_lines: Vec<bool>,
    pub(crate) last_group_id: u32,
    /// The document.
    pub(crate) out: &'t mut Elements,
}

/// `isInlineNode`
fn is_inline_node(node: Option<&Node<'_>>) -> bool {
    node.is_none_or(|node| {
        matches!(
            node.kind,
            Kind::Plain
                | Kind::QuoteDouble
                | Kind::QuoteSingle
                | Kind::Alias
                | Kind::FlowMapping
                | Kind::FlowSequence
        )
    })
}

fn has_comments(node: &Node<'_>) -> bool {
    !node.leading_comments.is_empty()
        || !node.middle_comments.is_empty()
        || node.indicator_comment.is_some()
        || node.trailing_comment.is_some()
        || !node.end_comments.is_empty()
}

/// All that is printed of it is what `print_node` prints.
fn is_bare(node: &Node<'_>) -> bool {
    !has_comments(node) && node.tag.is_none() && node.anchor.is_none()
}

/// `isEmptyNode`
fn is_empty_node(node: &Node<'_>) -> bool {
    node.children.is_empty() && !has_comments(node)
}

/// `shouldPrintEndComments`
fn should_print_end_comments(node: &Node<'_>) -> bool {
    !node.end_comments.is_empty()
        && !matches!(
            node.kind,
            Kind::DocumentHead | Kind::DocumentBody | Kind::FlowMapping | Kind::FlowSequence
        )
}

/// `splitWithSingleSpace`: `" a   b c   d e   f "` is `[" a   b", "c   d", "e   f "]`.
fn split_with_single_space(text: &[u8]) -> Vec<&[u8]> {
    let mut words = Vec::new();
    if text.is_empty() {
        return words;
    }
    let mut start = 0;
    for i in 1..text.len().saturating_sub(1) {
        if text[i] == b' ' && text[i - 1] != b' ' && text[i + 1] != b' ' {
            words.push(&text[start..i]);
            start = i + 1;
        }
    }
    words.push(&text[start..]);
    words
}

/// A line of a scalar: its words, or all of it.
enum Words<'c> {
    None,
    One(&'c [u8]),
    Slices(Vec<&'c [u8]>),
    Joined(Vec<u8>),
}

impl<'c> Words<'c> {
    /// All of a line.
    fn line(line: &'c [u8]) -> Self {
        if line.is_empty() {
            Words::None
        } else {
            Words::One(line)
        }
    }

    fn is_empty(&self) -> bool {
        matches!(self, Words::None) || matches!(self, Words::Slices(words) if words.is_empty())
    }

    /// `fill(join(line, words))`
    fn write_fill(&self, out: &mut Elements) {
        let words = match self {
            Words::None => return,
            // Nothing is to be filled with one word.
            Words::One(word) => return out.text(word),
            Words::Slices(words) => &words[..],
            Words::Joined(text) => &[&text[..]],
        };
        out.start_fill();
        for (index, word) in words.iter().enumerate() {
            if index > 0 {
                out.start_item();
                out.line(Line::Space);
                out.end_item();
            }
            out.start_item();
            out.text(word);
            out.end_item();
        }
        out.end_fill();
    }
}

fn join_words(lines: Vec<Vec<&[u8]>>, is_never: bool) -> Vec<Words<'_>> {
    lines
        .into_iter()
        .map(|words| match is_never {
            true => Words::Joined(words.join(&b" "[..])),
            false => Words::Slices(words),
        })
        .collect()
}

impl<'t, 'a: 't> Printer<'t, 'a> {
    fn node(&self, id: Id) -> &'t Node<'a> {
        &self.tree[id]
    }

    /// `node.content`, `node.key`, `node.head`: the first child.
    fn first_child(&self, node: &Node<'a>) -> Option<&'t Node<'a>> {
        node.children.first().map(|id| self.node(id))
    }

    fn source(&self, node: &Node<'a>) -> &'a [u8] {
        self.text
            .get(node.position.start.offset as usize..node.position.end.offset as usize)
            .unwrap_or_default()
    }

    fn parent(&self, node: &Node<'a>) -> Option<&'t Node<'a>> {
        node.parent.map(|id| self.node(id))
    }

    /// `getLastDescendantNode`
    fn last_descendant(&self, mut node: &'t Node<'a>) -> &'t Node<'a> {
        while let Some(last) = node.children.last() {
            node = self.node(last);
        }
        node
    }

    fn start_align(&mut self, width: u32) {
        self.out
            .start_indent(IndentCommand::Align(Alignment::Spaces(width)));
    }

    /// After it, `printNextEmptyLine` is nothing.
    fn has_no_next_empty_line(&mut self, id: Id) {
        let end = self.node(id).position.end.offset as usize;
        if let Some(it) = self.printed_empty_lines.get_mut(end) {
            *it = true;
        }
    }

    /// oxfmt's one rule for empty lines, between the parts of a stream: a line break, and an empty line if there is one
    /// in front of `next` in the text.
    fn print_line_break_before(&mut self, next: u32) {
        self.out.hard_line();
        if is_previous_line_empty(self.text, next as usize) {
            self.out.hard_line();
        }
    }

    /// `join(hardline, path.map(print, ..))`, for comments.
    fn print_comments(&mut self, comments: List) {
        let tree = self.tree;
        for (index, comment) in tree.items(comments).enumerate() {
            if index > 0 {
                self.out.hard_line();
            }
            // Of a comment, nobody asks whether it is the last.
            self.print(comment, false);
        }
    }

    /// `join(hardline, path.map(print, "children"))`
    fn print_children(&mut self, node: &Node<'a>, is_last_descendant: bool) {
        let tree = self.tree;
        for (index, child) in tree.items(node.children).enumerate() {
            if index > 0 {
                self.out.hard_line();
            }
            self.print(
                child,
                is_last_descendant && node.children.last() == Some(child),
            );
        }
    }

    /// `isNextLineEmpty`
    fn is_next_line_empty(&self, node: &Node<'a>) -> bool {
        let from = (node.position.end.offset as usize).saturating_sub(1);
        let rest = self.text.get(from..).unwrap_or_default();
        // The rest of the line, whatever it is. Most of the time that is one character.
        let line_len = rest.iter().take_while(|byte| **byte != b'\n').count();
        let mut rest = rest.get(line_len + 1..).unwrap_or_default();
        loop {
            rest = &rest[rest.iter().take_while(|byte| **byte == b' ').count()..];
            match text::white_space_len(rest) {
                0 => return false,
                _ if rest[0] == b'\n' => return true,
                len => rest = &rest[len..],
            }
        }
    }

    /// `printNextEmptyLine`: whether it is a `softline`.
    fn has_next_empty_line(&mut self, node: &Node<'a>) -> bool {
        self.printed_empty_lines
            .get_mut(node.position.end.offset as usize)
            .is_some_and(|it| !std::mem::replace(it, true))
            && self.is_next_line_empty(node)
            && !self.parent(node).is_some_and(should_print_end_comments)
    }

    /// `hasPrettierIgnore`
    fn has_prettier_ignore(&self, node: &Node<'a>) -> bool {
        let comments = match node.kind {
            Kind::DocumentBody => match self
                .parent(node)
                .and_then(|document| self.first_child(document))
            {
                Some(head) => head.end_comments,
                None => return false,
            },
            _ => node.leading_comments,
        };
        comments.last().is_some_and(|comment| {
            matches!(
                text::trim(self.node(comment).value),
                b"prettier-ignore" | b"oxfmt-ignore"
            )
        })
    }

    /// What `print` does with most nodes: a scalar on one line or an alias, or the key or value that is nothing else.
    /// They are groups with a text in them. Of anything else nothing is written.
    fn prints_text(&mut self, node: &'t Node<'a>) -> bool {
        if !is_bare(node) {
            return false;
        }
        let scalar = match node.kind {
            Kind::MappingKey | Kind::MappingValue | Kind::FlowSequenceItem => {
                match self.first_child(node) {
                    Some(content) if is_bare(content) => content,
                    _ => return false,
                }
            }
            _ => node,
        };
        match scalar.kind {
            Kind::Alias => {}
            Kind::Plain | Kind::QuoteDouble | Kind::QuoteSingle
                if self.prose_wrap == ProseWrap::Preserve
                    && scalar.position.start.line == scalar.position.end.line => {}
            _ => return false,
        }
        self.out.text_group();
        self.print_node(scalar, false);
        true
    }

    /// `genericPrint`. `is_last_descendant`: `isLastDescendantNode(path)`, for what is not a comment, a tag
    /// or an anchor.
    pub(crate) fn print(&mut self, id: Id, is_last_descendant: bool) {
        let node = self.node(id);
        if self.prints_text(node) {
            return;
        }
        if node.kind != Kind::MappingValue && !node.leading_comments.is_empty() {
            self.print_comments(node.leading_comments);
            self.out.hard_line();
        }
        let mut properties = [node.tag, node.anchor];
        if self.is_oxfmt
            && let [Some(tag), Some(anchor)] = properties
            && self.node(anchor).position.start.offset < self.node(tag).position.start.offset
        {
            properties.swap(0, 1);
        }
        for (index, property) in properties.into_iter().flatten().enumerate() {
            if index > 0 {
                self.out.token(" ");
            }
            self.print(property, false);
        }

        let has_next_empty_line = matches!(
            node.kind,
            Kind::Mapping
                | Kind::Sequence
                | Kind::Comment
                | Kind::Directive
                | Kind::MappingItem
                | Kind::SequenceItem
        ) && !(is_last_descendant && node.kind != Kind::Comment)
            && self.has_next_empty_line(node);

        if node.tag.is_some() || node.anchor.is_some() {
            match matches!(node.kind, Kind::Sequence | Kind::Mapping)
                && node.middle_comments.is_empty()
            {
                true => self.out.hard_line(),
                false => self.out.token(" "),
            }
        }
        if !node.middle_comments.is_empty() {
            if node.middle_comments.len() != 1 {
                self.out.hard_line();
            }
            self.print_comments(node.middle_comments);
            self.out.hard_line();
        }

        let mut is_ignored = self.has_prettier_ignore(node);
        if self.is_oxfmt {
            // For oxfmt the comment is about one node: before a mapping or a sequence, about the first in it.
            match node.kind {
                Kind::Mapping | Kind::Sequence => {
                    self.is_first_item_ignored = std::mem::take(&mut is_ignored);
                }
                Kind::MappingItem | Kind::SequenceItem => {
                    is_ignored |= std::mem::take(&mut self.is_first_item_ignored);
                }
                _ => {}
            }
        }
        if is_ignored {
            // `replaceEndOfLine`
            for (index, line) in
                strings::split(text::trim_end(self.source(node)), b"\n").enumerate()
            {
                if index > 0 {
                    self.out.line(Line::Literal);
                    self.out.break_parent();
                }
                self.out.text(line);
            }
        } else {
            self.out.start_group(Group::default());
            self.print_node(node, is_last_descendant);
            self.out.end_group();
        }

        if let Some(comment) = node.trailing_comment
            && !matches!(node.kind, Kind::Document | Kind::DocumentHead)
        {
            let parent = self.parent(node);
            let is_key_of_mapping = parent.is_some_and(|parent| {
                parent.kind == Kind::MappingKey
                    && self
                        .parent(parent)
                        .and_then(|item| self.parent(item))
                        .is_some_and(|it| it.kind == Kind::Mapping || self.is_oxfmt)
            });
            self.out.start_line_suffix();
            if !(node.kind == Kind::MappingValue && node.children.is_empty()) {
                self.out.token(" ");
            }
            if !(is_key_of_mapping && is_inline_node(Some(node))) {
                self.out.break_parent();
            }
            if self.is_oxfmt {
                self.has_no_next_empty_line(comment);
            }
            self.print(comment, false);
            self.out.end_line_suffix();
        }

        if should_print_end_comments(node) {
            let is_aligned = node.kind == Kind::SequenceItem;
            if is_aligned {
                self.start_align(2);
            }
            let tree = self.tree;
            for comment in tree.items(node.end_comments) {
                self.out.hard_line();
                if is_previous_line_empty(
                    self.text,
                    self.node(comment).position.start.offset as usize,
                ) {
                    self.out.hard_line();
                }
                self.print(comment, false);
            }
            if is_aligned {
                self.out.end_indent();
            }
        }
        if has_next_empty_line {
            self.out.line(Line::Soft);
        }
    }

    fn print_node(&mut self, node: &'t Node<'a>, is_last_descendant: bool) {
        let tree = self.tree;
        match node.kind {
            Kind::Root => {
                let last = self.last_descendant(node);
                let source = self.source(last);
                let should_print_hardline = !(matches!(last.kind, Kind::BlockLiteral | Kind::BlockFolded)
                        && last.chomping == Chomping::Keep)
                        // For oxfmt a file ends with a line break, and here none has been kept.
                        || (self.is_oxfmt
                            && strings::index_of_char_usize(source, b'\n')
                                .is_none_or(|newline| newline + 1 == source.len()));
                let mut keeps_line_breaks = false;
                for (index, child) in tree.items(node.children).enumerate() {
                    let document = self.node(child);
                    if index > 0 {
                        match self.is_oxfmt && !keeps_line_breaks {
                            true => self.print_line_break_before(self.start_of_document(document)),
                            false => self.out.hard_line(),
                        }
                    }
                    self.is_last_document = document.next.is_none();
                    // For oxfmt, what is between two documents is not up to what is in them.
                    self.print(child, self.is_last_document || self.is_oxfmt);
                    let last = self.last_descendant(document);
                    keeps_line_breaks = matches!(last.kind, Kind::BlockLiteral | Kind::BlockFolded)
                        && last.chomping == Chomping::Keep;
                    if self.should_print_document_end_marker(
                        document,
                        document.next.map(|next| self.node(next)),
                    ) {
                        keeps_line_breaks = false;
                        if should_print_hardline && !(self.is_oxfmt && self.is_empty(document)) {
                            self.out.hard_line();
                        }
                        self.out.token("...");
                        if let Some(comment) = document.trailing_comment {
                            self.out.token(" ");
                            self.print(comment, false);
                        }
                    }
                }
                if should_print_hardline {
                    self.out.hard_line();
                }
            }
            Kind::Document => {
                let (Some(head_id), Some(body_id), 2) = (
                    node.children.first(),
                    node.children.last(),
                    node.children.len(),
                ) else {
                    return;
                };
                let (head, body) = (self.node(head_id), self.node(body_id));
                let mut has_head = false;
                // `shouldPrintDocumentHeadEndMarker`
                if node.directives_end_marker
                    || !head.children.is_empty()
                    || !head.end_comments.is_empty()
                    || head.trailing_comment.is_some()
                {
                    if !head.children.is_empty() || !head.end_comments.is_empty() {
                        self.print(head_id, is_last_descendant);
                        self.out.hard_line();
                    }
                    self.out.token("---");
                    if let Some(comment) = head.trailing_comment {
                        self.out.token(" ");
                        self.print(comment, false);
                    }
                    has_head = true;
                }
                if !body.children.is_empty() || !body.end_comments.is_empty() {
                    if has_head {
                        self.out.hard_line();
                    }
                    self.print(body_id, is_last_descendant);
                }
            }
            Kind::DocumentHead => {
                self.print_children(node, is_last_descendant);
                if !node.children.is_empty() && !node.end_comments.is_empty() {
                    self.out.hard_line();
                }
                self.print_comments(node.end_comments);
            }
            Kind::DocumentBody => {
                self.print_children(node, is_last_descendant);
                if let (Some(last_child), Some(first_comment)) =
                    (node.children.last(), node.end_comments.first())
                {
                    let last = self.last_descendant(node);
                    let start = self.node(first_comment).position.start.offset as usize;
                    let is_block = matches!(last.kind, Kind::BlockFolded | Kind::BlockLiteral);
                    let hard_lines = if self.is_oxfmt && !has_newline_backwards(self.text, start) {
                        // It stays on its line.
                        self.out.token(" ");
                        0
                    } else if self.is_oxfmt && !(is_block && last.chomping == Chomping::Keep) {
                        1 + usize::from(is_previous_line_empty(self.text, start))
                    } else if is_block {
                        // There is a line break at the end of a block scalar that keeps its line breaks.
                        if last.chomping == Chomping::Keep {
                            0
                        } else {
                            2
                        }
                    } else {
                        let keeps_empty_line = self.node(last_child).kind == Kind::Mapping
                            && is_previous_line_empty(self.text, start);
                        if keeps_empty_line { 2 } else { 1 }
                    };
                    for _ in 0..hard_lines {
                        self.out.hard_line();
                    }
                }
                if self.is_oxfmt
                    && let Some(last) = node.end_comments.last()
                {
                    self.has_no_next_empty_line(last);
                }
                self.print_comments(node.end_comments);
            }
            Kind::Directive => {
                // The name without the `%`, and the parameters.
                self.out.token("%");
                let parts = strings::split_any(text::trim(node.value), b" \t")
                    .filter(|part| !part.is_empty());
                for (index, part) in parts.enumerate() {
                    if index > 0 {
                        self.out.token(" ");
                    }
                    self.out.text(if index == 0 {
                        part.strip_prefix(b"%").unwrap_or(part)
                    } else {
                        part
                    });
                }
            }
            Kind::Comment => {
                self.out.token("#");
                self.out.text(node.value);
            }
            Kind::Alias => {
                self.out.token("*");
                self.out.text(node.value);
            }
            Kind::Tag => self.out.text(self.source(node)),
            Kind::Anchor => {
                self.out.token("&");
                self.out.text(node.value);
            }
            Kind::Plain => self.print_flow_scalar_content(node, self.source(node)),
            Kind::QuoteDouble | Kind::QuoteSingle => self.print_quoted(node),
            Kind::BlockFolded | Kind::BlockLiteral => self.print_block(node, is_last_descendant),
            Kind::Mapping | Kind::Sequence => self.print_children(node, is_last_descendant),
            Kind::SequenceItem => {
                self.out.token("- ");
                self.start_align(2);
                if let Some(content) = node.children.first() {
                    self.print(content, is_last_descendant);
                }
                self.out.end_indent();
            }
            Kind::MappingKey | Kind::MappingValue | Kind::FlowSequenceItem => {
                if let Some(content) = node.children.first() {
                    self.print(content, is_last_descendant);
                }
            }
            Kind::MappingItem | Kind::FlowMappingItem => {
                self.print_mapping_item(node, is_last_descendant)
            }
            Kind::FlowMapping | Kind::FlowSequence => {
                self.print_flow_mapping(node, is_last_descendant)
            }
        }
    }

    /// `shouldPrintDocumentEndMarker`
    /// Where the first of what is printed of a document is in the text.
    fn start_of_document(&self, document: &Node<'a>) -> u32 {
        let start = document.position.start.offset;
        let Some(head) = self.first_child(document) else {
            return start;
        };
        [head.children.first(), head.end_comments.first()]
            .into_iter()
            .flatten()
            .map(|id| self.node(id).position.start.offset)
            .fold(start, u32::min)
    }

    /// Nothing is printed of it but its end.
    fn is_empty(&self, document: &Node<'a>) -> bool {
        !document.directives_end_marker
            && self.tree.items(document.children).all(|id| {
                let part = self.node(id);
                part.children.is_empty()
                    && part.end_comments.is_empty()
                    && part.trailing_comment.is_none()
            })
    }

    fn should_print_document_end_marker(
        &self,
        document: &Node<'a>,
        next: Option<&'t Node<'a>>,
    ) -> bool {
        if document.document_end_marker || document.trailing_comment.is_some() {
            return true;
        }
        // For oxfmt, comments between two documents are no reason for a `...` that is not there.
        next.and_then(|next| self.first_child(next))
            .is_some_and(|head| {
                !head.children.is_empty() || (!self.is_oxfmt && !head.end_comments.is_empty())
            })
    }

    fn print_quoted(&mut self, node: &Node<'a>) {
        let source = self.source(node);
        let raw = source
            .get(1..source.len().saturating_sub(1))
            .unwrap_or_default();
        let is_double = node.kind == Kind::QuoteDouble;
        // `/\\[^"]/`
        let has_escape = |raw: &[u8]| (1..raw.len()).any(|i| raw[i - 1] == b'\\' && raw[i] != b'"');
        let (quote, content): (&[u8], Cow<'_, [u8]>) =
            if (!is_double && strings::contains_char(raw, b'\\')) || (is_double && has_escape(raw))
            {
                // Only in double quotes are there escapes, and in single quotes a backslash needs none.
                (if is_double { b"\"" } else { b"'" }, Cow::Borrowed(raw))
            } else if strings::contains_char(raw, b'"') {
                let content = match is_double {
                    false => Cow::Borrowed(raw),
                    true => {
                        // `.replaceAll('\\"', '"').replaceAll("'", "''")`
                        let mut content = Vec::with_capacity(raw.len());
                        let mut i = 0;
                        while let Some(&byte) = raw.get(i) {
                            match byte {
                                b'\\' if raw.get(i + 1) == Some(&b'"') => {
                                    content.push(b'"');
                                    i += 1;
                                }
                                b'\'' => content.extend_from_slice(b"''"),
                                _ => content.push(byte),
                            }
                            i += 1;
                        }
                        Cow::Owned(content)
                    }
                };
                (b"'", content)
            } else if strings::contains_char(raw, b'\'') {
                let content = match is_double {
                    true => Cow::Borrowed(raw),
                    false => {
                        // `.replaceAll("''", "'")`
                        let mut content = Vec::with_capacity(raw.len());
                        let mut i = 0;
                        while let Some(&byte) = raw.get(i) {
                            content.push(byte);
                            i += if byte == b'\'' && raw.get(i + 1) == Some(&b'\'') {
                                2
                            } else {
                                1
                            };
                        }
                        Cow::Owned(content)
                    }
                };
                (b"\"", content)
            } else {
                (
                    if self.single_quote { b"'" } else { b"\"" },
                    Cow::Borrowed(raw),
                )
            };
        self.out.text(quote);
        self.print_flow_scalar_content(node, &content);
        self.out.text(quote);
    }

    /// `printFlowScalarContent`
    fn print_flow_scalar_content(&mut self, node: &Node<'a>, content: &[u8]) {
        // Most are one line that stays as it is.
        if self.prose_wrap == ProseWrap::Preserve
            && node.position.start.line == node.position.end.line
        {
            return Words::line(content).write_fill(self.out);
        }
        for (index, words) in self
            .flow_scalar_line_contents(node.kind, content)
            .iter()
            .enumerate()
        {
            if index > 0 {
                self.out.hard_line();
            }
            words.write_fill(self.out);
        }
    }

    /// `getFlowScalarLineContents`
    fn flow_scalar_line_contents<'c>(&self, kind: Kind, content: &'c [u8]) -> Vec<Words<'c>> {
        let mut raw_lines: Vec<&'c [u8]> = strings::split(content, b"\n").collect();
        let count = raw_lines.len();
        for (index, line) in raw_lines.iter_mut().enumerate() {
            *line = match (index == 0, index + 1 == count) {
                (true, true) => line,
                (false, false) => text::trim(line),
                (true, false) => text::trim_end(line),
                (false, true) => text::trim_start(line),
            };
        }
        if self.prose_wrap == ProseWrap::Preserve {
            return raw_lines.into_iter().map(Words::line).collect();
        }
        let mut lines: Vec<Vec<&'c [u8]>> = Vec::new();
        for (index, line) in raw_lines.iter().enumerate() {
            let words = split_with_single_space(line);
            match lines.last_mut() {
                Some(last)
                    if index > 0
                        && !raw_lines[index - 1].is_empty()
                        && !words.is_empty()
                        // A backslash at the end of a line in double quotes stays there.
                        && !(kind == Kind::QuoteDouble && last.last().is_some_and(|word| word.ends_with(b"\\"))) =>
                {
                    last.extend(words);
                }
                _ => lines.push(words),
            }
        }
        join_words(lines, self.prose_wrap == ProseWrap::Never)
    }

    /// `getBlockValueLineContents`
    fn block_value_line_contents(
        &self,
        node: &Node<'a>,
        parent_indent: usize,
        is_last_descendant: bool,
    ) -> Vec<Words<'a>> {
        if node.position.start.line == node.position.end.line {
            return Vec::new();
        }
        // Without the line of the `>` or `|`.
        let source = self.source(node);
        let content = match strings::index_of_char_usize(source, b'\n') {
            Some(newline) => &source[newline + 1..],
            None => return Vec::new(),
        };
        if content.is_empty() {
            return Vec::new();
        }
        let leading_space_count = match node.indent {
            // `/^(?<leadingSpace> *)[^\n\r ]/m`
            None => strings::split(content, b"\n")
                .find_map(|line| {
                    let spaces = line.iter().take_while(|&&b| b == b' ').count();
                    (spaces < line.len()).then_some(spaces)
                })
                .unwrap_or(usize::MAX),
            Some(indent) => (indent as usize + parent_indent).saturating_sub(1),
        };
        let raw_lines: Vec<&'a [u8]> = strings::split(content, b"\n")
            .map(|line| line.get(leading_space_count..).unwrap_or_default())
            .collect();

        let lines: Vec<Words<'a>> =
            if self.prose_wrap == ProseWrap::Preserve || node.kind == Kind::BlockLiteral {
                raw_lines.iter().map(|&line| Words::line(line)).collect()
            } else {
                let mut lines: Vec<Vec<&'a [u8]>> = Vec::new();
                for (index, line) in raw_lines.iter().enumerate() {
                    let words = match self.is_oxfmt && text::starts_with_white_space(line) {
                        // A line that is indented more is not folded, so oxfmt leaves it as it is.
                        true => vec![*line],
                        false => split_with_single_space(line),
                    };
                    // The test is made with the words joined by commas.
                    let is_blank_at = |word: Option<&&[u8]>, at_start: bool| {
                        word.is_some_and(|word| match at_start {
                            true => text::starts_with_white_space(word),
                            false => text::trim_end(word).len() < word.len(),
                        })
                    };
                    match lines.last_mut() {
                        Some(last)
                            if index > 0
                                && !words.is_empty()
                                && !raw_lines[index - 1].is_empty()
                                && !is_blank_at(words.first(), true)
                                && !is_blank_at(last.first(), true)
                                && !is_blank_at(last.last(), false) =>
                        {
                            last.extend(words);
                        }
                        _ => lines.push(words),
                    }
                }
                // No white space at the end of a line: a word that ends with some takes the next one along.
                let mut merged: Vec<Words<'a>> = Vec::with_capacity(lines.len());
                for words in lines {
                    let needs_merging = words
                        .iter()
                        .rev()
                        .skip(1)
                        .any(|word| text::trim_end(word).len() < word.len());
                    if !needs_merging && self.prose_wrap != ProseWrap::Never {
                        merged.push(Words::Slices(words));
                        continue;
                    }
                    if self.prose_wrap == ProseWrap::Never {
                        merged.push(Words::Joined(words.join(&b" "[..])));
                        continue;
                    }
                    // The words are next to each other in the text, with one space in between.
                    let mut slices: Vec<&'a [u8]> = Vec::with_capacity(words.len());
                    for word in words {
                        match slices.last_mut() {
                            Some(last) if text::trim_end(last).len() < last.len() => {
                                let start = last.as_ptr().addr() - self.text.as_ptr().addr();
                                *last = &self.text[start..start + last.len() + 1 + word.len()];
                            }
                            _ => slices.push(word),
                        }
                    }
                    merged.push(Words::Slices(slices));
                }
                merged
            };

        // `removeUnnecessaryTrailingNewlines`
        let mut lines = lines;
        if node.chomping == Chomping::Keep {
            if (content.ends_with(b"\n") || self.is_oxfmt)
                && lines.last().is_some_and(Words::is_empty)
            {
                lines.pop();
            }
            return lines;
        }
        let is_blank = |words: &Words<'a>| {
            // For oxfmt, blanks that are left of a line are a part of the value.
            let is_blank = |word: &[u8]| match self.is_oxfmt {
                true => word.is_empty(),
                false => word.iter().all(|b| matches!(b, b' ' | b'\t')),
            };
            match words {
                Words::None => true,
                Words::One(word) => is_blank(word),
                Words::Slices(words) => words.iter().all(|word| is_blank(word)),
                Words::Joined(text) => is_blank(text),
            }
        };
        let trailing_newline_count = lines
            .iter()
            .rev()
            .take_while(|words| is_blank(words))
            .count();
        let removed = match trailing_newline_count {
            0 => 0,
            // The next empty line.
            count if count >= 2 && !is_last_descendant => count - 1,
            count => count,
        };
        lines.truncate(lines.len() - removed);
        lines
    }

    /// `printBlock`
    fn print_block(&mut self, node: &'t Node<'a>, is_last_descendant: bool) {
        let mut parent_indent = 0;
        let mut ancestor = self.parent(node);
        while let Some(it) = ancestor {
            parent_indent += usize::from(matches!(it.kind, Kind::Sequence | Kind::Mapping));
            ancestor = self.parent(it);
        }
        self.out.text(if node.kind == Kind::BlockFolded {
            b">"
        } else {
            b"|"
        });
        if let Some(indent) = node.indent {
            self.out.text(indent.to_string().as_bytes());
        }
        match node.chomping {
            Chomping::Clip => {}
            Chomping::Keep => self.out.token("+"),
            Chomping::Strip => self.out.token("-"),
        }
        if let Some(comment) = node.indicator_comment {
            // oxfmt does not count it when it asks whether the `|` fits behind the key.
            if self.is_oxfmt {
                self.out.start_line_suffix();
            }
            self.out.token(" ");
            self.print(comment, false);
            if self.is_oxfmt {
                self.out.end_line_suffix();
            }
        }
        let lines = self.block_value_line_contents(node, parent_indent, is_last_descendant);
        match node.indent {
            None => {
                self.out.start_indent(IndentCommand::Dedent);
                self.start_align(self.tab_width);
            }
            Some(indent) => {
                self.out.start_indent(IndentCommand::DedentToRoot);
                self.start_align((indent + parent_indent as u32).saturating_sub(1));
            }
        }
        let out = &mut *self.out;
        let literal_line = |out: &mut Elements| {
            out.line(Line::Literal);
            out.break_parent();
        };
        for (index, words) in lines.iter().enumerate() {
            if index == 0 {
                out.hard_line();
            }
            words.write_fill(out);
            if self.is_oxfmt && !words.is_empty() {
                out.keep_blanks();
            }
            if index + 1 != lines.len() {
                match words.is_empty() {
                    true => out.hard_line(),
                    false => {
                        out.start_indent(IndentCommand::MarkAsRoot);
                        literal_line(out);
                        out.end_indent();
                    }
                }
            } else if node.chomping == Chomping::Keep && is_last_descendant && self.is_last_document
            {
                out.start_indent(IndentCommand::DedentToRoot);
                match words.is_empty() {
                    true => out.hard_line(),
                    false => literal_line(out),
                }
                out.end_indent();
            }
        }
        out.end_indent();
        out.end_indent();
    }

    /// `printFlowMapping` and `printFlowSequence`
    fn print_flow_mapping(&mut self, node: &'t Node<'a>, is_last_descendant: bool) {
        let is_mapping = node.kind == Kind::FlowMapping;
        let bracket_spacing = match is_mapping && !node.children.is_empty() && self.bracket_spacing
        {
            true => Line::Space,
            false => Line::Soft,
        };
        let tree = self.tree;
        let is_last_item_empty_mapping_item = node.children.last().is_some_and(|last| {
            let last = self.node(last);
            last.kind == Kind::FlowMappingItem
                && tree
                    .items(last.children)
                    .all(|child| is_empty_node(self.node(child)))
        });
        self.out.text(if is_mapping { b"{" } else { b"[" });
        self.start_align(self.tab_width);
        self.out.line(bracket_spacing);
        for id in tree.items(node.children) {
            let child = self.node(id);
            self.print(id, is_last_descendant && child.next.is_none());
            // For oxfmt, what is between the brackets is on one line or each on its own.
            if self.is_oxfmt
                && child.kind == Kind::FlowMappingItem
                && self
                    .first_child(child)
                    .and_then(|key| self.first_child(key))
                    .is_some_and(|key| {
                        key.trailing_comment.is_some()
                            || (matches!(
                                key.kind,
                                Kind::Plain | Kind::QuoteDouble | Kind::QuoteSingle
                            ) && key.position.start.line != key.position.end.line)
                    })
            {
                self.out.break_parent();
            }
            let Some(next) = child.next else {
                break;
            };
            self.out.token(",");
            self.out.line(Line::Space);
            if child.position.start.line != self.node(next).position.start.line
                && self.has_next_empty_line(child)
            {
                self.out.line(Line::Soft);
            }
        }
        if self.trailing_comma {
            self.out.start_if_break(0);
            self.out.token(",");
            self.out.otherwise();
            self.out.end_if_break();
        }
        if !node.end_comments.is_empty() {
            self.out.hard_line();
            self.print_comments(node.end_comments);
        }
        self.out.end_indent();
        if !is_last_item_empty_mapping_item {
            self.out.line(bracket_spacing);
        }
        self.out.text(if is_mapping { b"}" } else { b"]" });
    }

    /// `isAbsolutelyPrintedAsSingleLineNode`
    fn is_absolutely_printed_as_single_line(&self, node: Option<&Node<'a>>) -> bool {
        let Some(node) = node else {
            return true;
        };
        let kind = match node.kind {
            Kind::Plain => ScalarType::Plain,
            Kind::QuoteSingle => ScalarType::QuoteSingle,
            Kind::QuoteDouble => ScalarType::QuoteDouble,
            Kind::Alias => return true,
            _ => return false,
        };
        if self.prose_wrap == ProseWrap::Preserve {
            return node.position.start.line == node.position.end.line;
        }
        // A backslash at the end of a line: `/\\$/m`
        let source = self.source(node);
        if source.ends_with(b"\\") || text::includes(source, b"\\\n") {
            return false;
        }
        let value = scalar_source(kind, source);
        match self.prose_wrap {
            ProseWrap::Never => !strings::contains_char(&value, b'\n'),
            _ => strings::index_of_any(&value, b"\n ").is_none(),
        }
    }

    /// `printMappingItem`
    fn print_mapping_item(&mut self, node: &'t Node<'a>, is_last_descendant: bool) {
        let (Some(key_id), Some(value_id), 2) = (
            node.children.first(),
            node.children.last(),
            node.children.len(),
        ) else {
            return;
        };
        let (key, value) = (self.node(key_id), self.node(value_id));
        let parent = self.parent(node);
        let (is_empty_key, is_empty_value) = (is_empty_node(key), is_empty_node(value));
        if is_empty_key && is_empty_value {
            return self.out.token(": ");
        }
        let (key_content, value_content) = (self.first_child(key), self.first_child(value));
        // `needsSpaceInFrontOfMappingValue`
        let space_before_colon: &[u8] = if key_content.is_some_and(|it| it.kind == Kind::Alias) {
            b" "
        } else {
            b""
        };

        if is_empty_value {
            if node.kind == Kind::FlowMappingItem
                && parent.is_some_and(|it| it.kind == Kind::FlowMapping)
            {
                return self.print(key_id, is_last_descendant);
            }
            let is_in_set = parent
                .and_then(|it| it.tag)
                .is_some_and(|tag| self.node(tag).is_set_tag);
            if node.kind == Kind::MappingItem
                && self.is_absolutely_printed_as_single_line(key_content)
                && key_content.is_none_or(|it| it.trailing_comment.is_none())
                && !is_in_set
            {
                self.print(key_id, is_last_descendant);
                self.out.text(space_before_colon);
                return self.out.token(":");
            }
            self.out.token("? ");
            self.start_align(2);
            self.print(key_id, is_last_descendant);
            return self.out.end_indent();
        }

        if is_empty_key {
            self.out.token(": ");
            self.start_align(2);
            self.print(value_id, is_last_descendant);
            return self.out.end_indent();
        }

        // An explicit key.
        if !value.leading_comments.is_empty() || !is_inline_node(key_content) {
            self.out.token("? ");
            self.start_align(2);
            self.print(key_id, is_last_descendant);
            self.out.end_indent();
            self.out.hard_line();
            let tree = self.tree;
            for comment in tree.items(value.leading_comments) {
                self.print(comment, false);
                self.out.hard_line();
            }
            self.out.token(": ");
            self.start_align(2);
            self.print(value_id, is_last_descendant);
            return self.out.end_indent();
        }

        let has_no_comments_before_or_in = |content: Option<&Node<'a>>| {
            content.is_none_or(|it| it.leading_comments.is_empty() && it.middle_comments.is_empty())
        };
        let key_has_no_comments = has_no_comments_before_or_in(key_content)
            && key_content.is_none_or(|it| it.trailing_comment.is_none())
            && key.end_comments.is_empty();
        // `isSingleLineNode`
        let is_single_line_key = key_content.is_none_or(|it| match it.kind {
            Kind::Plain | Kind::QuoteDouble | Kind::QuoteSingle => {
                it.position.start.line == it.position.end.line
            }
            Kind::Alias => true,
            _ => false,
        });

        // On one line.
        if is_single_line_key
            && key_has_no_comments
            && has_no_comments_before_or_in(value_content)
            && value.end_comments.is_empty()
            && self.is_absolutely_printed_as_single_line(value_content)
            && self.is_absolutely_printed_as_single_line(key_content)
        {
            self.print(key_id, is_last_descendant);
            self.out.text(space_before_colon);
            self.out.token(": ");
            return self.print(value_id, is_last_descendant);
        }

        // Everything from the colon on is taken for the value: what is between the colon and the value.
        let is_block_collection = |it: &Node<'a>| matches!(it.kind, Kind::Mapping | Kind::Sequence);
        let has_end_comments = !value.end_comments.is_empty();
        let is_oxfmt = self.is_oxfmt;
        let write_colon = |out: &mut Elements| {
            out.text(space_before_colon);
            out.token(":");
            if has_end_comments
                && value_content.is_some_and(|it| {
                    matches!(it.kind, Kind::FlowMapping | Kind::FlowSequence)
                        && it.children.is_empty()
                })
            {
                out.token(" ");
            } else if value_content.is_some_and(|it| !it.leading_comments.is_empty())
                || (has_end_comments
                    && !is_oxfmt
                    && value_content.is_some_and(|it| !is_block_collection(it)))
                || (parent.is_some_and(|it| it.kind == Kind::Mapping || is_oxfmt)
                    && key_content.is_some_and(|it| it.trailing_comment.is_some())
                    && is_inline_node(value_content))
                || value_content.is_some_and(|it| {
                    is_block_collection(it) && it.tag.is_none() && it.anchor.is_none()
                })
            {
                out.hard_line();
            } else if value_content.is_some() {
                out.line(Line::Space);
            } else if value.trailing_comment.is_some() {
                out.token(" ");
            }
        };

        // `conditionalGroup`
        self.out.start_group(Group {
            is_conditional: true,
            ..Group::default()
        });
        // A key that is on one line for sure is implicit, however long it is.
        if self.is_absolutely_printed_as_single_line(key_content) && key_has_no_comments {
            self.print(key_id, is_last_descendant);
            self.start_align(self.tab_width);
            write_colon(self.out);
            self.print(value_id, is_last_descendant);
            self.out.end_indent();
            return self.out.end_group();
        }

        // Explicit if the key breaks, implicit otherwise.
        self.last_group_id += 1;
        let group_id = self.last_group_id;
        self.out.start_group(Group::default());
        self.out.start_if_break(0);
        self.out.token("? ");
        self.out.otherwise();
        self.out.end_if_break();
        self.out.start_group(Group {
            id: group_id,
            ..Group::default()
        });
        self.start_align(2);
        self.print(key_id, is_last_descendant);
        self.out.end_indent();
        self.out.end_group();
        self.out.end_group();

        self.out.start_if_break(group_id);
        self.out.hard_line();
        self.out.token(": ");
        self.start_align(2);
        let value_start = self.out.position();
        self.print(value_id, is_last_descendant);
        let value_end = self.out.position();
        self.out.end_indent();
        self.out.otherwise();
        self.start_align(self.tab_width);
        write_colon(self.out);
        self.out.duplicate(value_start, value_end);
        self.out.end_indent();
        self.out.end_if_break();
        self.out.end_group();
    }
}
