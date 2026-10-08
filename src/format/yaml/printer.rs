//! Prettier's `language-yaml`: `printer-yaml.js`, `print/*.js` and `utilities.js`.

use super::ast::{Chomping, Id, Kind, Node, Tree};
use crate::css::doc::{Doc, Line, align_with_spaces, dedent, docs, fill, group, hardline, if_break, join, line_suffix};
use crate::css::text;
use crate::options::ProseWrap;
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
    /// `printedEmptyLineCache`: where the nodes end whose next line has been looked at.
    pub(crate) printed_empty_lines: rustc_hash::FxHashSet<u32>,
    pub(crate) last_group_id: u32,
}

/// `isInlineNode`
fn is_inline_node(node: Option<&Node<'_>>) -> bool {
    node.is_none_or(|node| {
        matches!(
            node.kind,
            Kind::Plain | Kind::QuoteDouble | Kind::QuoteSingle | Kind::Alias | Kind::FlowMapping | Kind::FlowSequence
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

/// `isEmptyNode`
fn is_empty_node(node: &Node<'_>) -> bool {
    node.children.is_empty() && !has_comments(node)
}

/// `shouldPrintEndComments`
fn should_print_end_comments(node: &Node<'_>) -> bool {
    !node.end_comments.is_empty()
        && !matches!(node.kind, Kind::DocumentHead | Kind::DocumentBody | Kind::FlowMapping | Kind::FlowSequence)
}

/// Prettier's `isPreviousLineEmpty`.
fn is_previous_line_empty(text: &[u8], start: usize) -> bool {
    let skip_spaces = |text: &[u8]| text.iter().rposition(|b| !matches!(b, b' ' | b'\t')).map_or(0, |at| at + 1);
    // `skipNewline`
    let newline_len = |text: &[u8]| match text {
        [.., b'\n'] => 1,
        [.., 0xE2, 0x80, 0xA8 | 0xA9] => 3,
        _ => 0,
    };
    let before = &text[..start.min(text.len())];
    let before = &before[..skip_spaces(before)];
    let before = &before[..before.len() - newline_len(before)];
    let before = &before[..skip_spaces(before)];
    newline_len(before) > 0
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
    Slices(Vec<&'c [u8]>),
    Joined(Vec<u8>),
}

impl<'c> Words<'c> {
    fn is_empty(&self) -> bool {
        matches!(self, Words::Slices(words) if words.is_empty())
    }

    /// `fill(join(line, words))`. `is_source`: the slices are parts of the text that is formatted.
    fn into_fill<'a>(self, to_doc: impl Fn(&'c [u8]) -> Doc<'a>) -> Doc<'a> {
        match self {
            Words::Slices(words) => fill(join(&Doc::LINE, words.into_iter().map(to_doc).collect())),
            Words::Joined(text) => fill(vec![Doc::from(text)]),
        }
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
        node.children.first().map(|&id| self.node(id))
    }

    fn source(&self, node: &Node<'a>) -> &'a [u8] {
        self.text.get(node.position.start.offset as usize..node.position.end.offset as usize).unwrap_or_default()
    }

    fn parent(&self, node: &Node<'a>) -> Option<&'t Node<'a>> {
        node.parent.map(|id| self.node(id))
    }

    /// `getLastDescendantNode`
    fn last_descendant(&self, mut node: &'t Node<'a>) -> &'t Node<'a> {
        while let Some(&last) = node.children.last() {
            node = self.node(last);
        }
        node
    }

    fn print_all(&mut self, ids: &[Id]) -> Vec<Doc<'a>> {
        // Of a comment, nobody asks whether it is the last.
        ids.iter().map(|&id| self.print(id, false)).collect()
    }

    /// `path.map(print, "children")`
    fn print_children(&mut self, node: &Node<'a>, is_last_descendant: bool) -> Vec<Doc<'a>> {
        let count = node.children.len();
        (0..count).map(|index| self.print(node.children[index], is_last_descendant && index + 1 == count)).collect()
    }

    /// `isNextLineEmpty`
    fn is_next_line_empty(&self, node: &Node<'a>) -> bool {
        let mut newline_count = 0;
        let from = (node.position.end.offset as usize).saturating_sub(1);
        let rest = self.text.get(from..).unwrap_or_default();
        let mut i = 0;
        while let Some(&byte) = rest.get(i) {
            if byte == b'\n' {
                newline_count += 1;
            }
            let white_space_len = text::white_space_len_at_start(&rest[i..]);
            if newline_count == 1 && white_space_len.is_none() {
                return false;
            }
            if newline_count == 2 {
                return true;
            }
            i += white_space_len.unwrap_or(1);
        }
        false
    }

    /// `printNextEmptyLine`
    fn print_next_empty_line(&mut self, node: &Node<'a>) -> Doc<'a> {
        let end = node.position.end.offset;
        if self.printed_empty_lines.insert(end) {
            if self.is_next_line_empty(node) && !self.parent(node).is_some_and(should_print_end_comments) {
                return Doc::SOFTLINE;
            }
        }
        Doc::EMPTY
    }

    /// `hasPrettierIgnore`
    fn has_prettier_ignore(&self, node: &Node<'a>) -> bool {
        let comments = match node.kind {
            Kind::DocumentBody => match self.parent(node).and_then(|document| self.first_child(document)) {
                Some(head) => &head.end_comments,
                None => return false,
            },
            _ => &node.leading_comments,
        };
        comments.last().is_some_and(|&comment| text::trim(&self.node(comment).value) == b"prettier-ignore")
    }

    /// `genericPrint`. `is_last_descendant`: `isLastDescendantNode(path)`, for what is not a comment, a tag
    /// or an anchor.
    pub(crate) fn print(&mut self, id: Id, is_last_descendant: bool) -> Doc<'a> {
        let node = self.node(id);
        let mut parts: Vec<Doc<'a>> = Vec::new();
        if node.kind != Kind::MappingValue && !node.leading_comments.is_empty() {
            parts.push(docs![join(&hardline(), self.print_all(&node.leading_comments)), hardline()]);
        }
        if let Some(tag) = node.tag {
            parts.push(self.print(tag, false));
        }
        if node.tag.is_some() && node.anchor.is_some() {
            parts.push(Doc::from(" "));
        }
        if let Some(anchor) = node.anchor {
            parts.push(self.print(anchor, false));
        }

        let mut next_empty_line = Doc::EMPTY;
        if matches!(
            node.kind,
            Kind::Mapping | Kind::Sequence | Kind::Comment | Kind::Directive | Kind::MappingItem | Kind::SequenceItem
        ) && !(is_last_descendant && node.kind != Kind::Comment)
        {
            next_empty_line = self.print_next_empty_line(node);
        }

        if node.tag.is_some() || node.anchor.is_some() {
            match matches!(node.kind, Kind::Sequence | Kind::Mapping) && node.middle_comments.is_empty() {
                true => parts.push(hardline()),
                false => parts.push(Doc::from(" ")),
            }
        }
        if !node.middle_comments.is_empty() {
            parts.push(docs![
                if node.middle_comments.len() == 1 { Doc::EMPTY } else { hardline() },
                join(&hardline(), self.print_all(&node.middle_comments)),
                hardline(),
            ]);
        }

        if self.has_prettier_ignore(node) {
            // `replaceEndOfLine`
            let lines = strings::split(text::trim_end(self.source(node)), b"\n").map(Doc::from).collect();
            parts.push(Doc::Array(join(&docs![Doc::Line(Line::Literal), Doc::BreakParent], lines)));
        } else {
            parts.push(group(self.print_node(node, is_last_descendant)));
        }

        if let Some(comment) = node.trailing_comment
            && !matches!(node.kind, Kind::Document | Kind::DocumentHead)
        {
            let parent = self.parent(node);
            let is_key_of_mapping = parent.is_some_and(|parent| {
                parent.kind == Kind::MappingKey
                    && self.parent(parent).and_then(|item| self.parent(item)).is_some_and(|it| it.kind == Kind::Mapping)
            });
            parts.push(line_suffix(docs![
                if node.kind == Kind::MappingValue && node.children.is_empty() { "" } else { " " },
                if is_key_of_mapping && is_inline_node(Some(node)) { Doc::EMPTY } else { Doc::BreakParent },
                self.print(comment, false),
            ]));
        }

        if should_print_end_comments(node) {
            let mut comments = Vec::with_capacity(node.end_comments.len());
            for &comment in &node.end_comments {
                let start = self.node(comment).position.start.offset as usize;
                comments.push(docs![
                    if is_previous_line_empty(self.text, start) { hardline() } else { Doc::EMPTY },
                    self.print(comment, false),
                ]);
            }
            let width = if node.kind == Kind::SequenceItem { 2 } else { 0 };
            parts.push(align_with_spaces(width, docs![hardline(), join(&hardline(), comments)]));
        }
        parts.push(next_empty_line);
        Doc::Array(parts)
    }

    fn print_node(&mut self, node: &'t Node<'a>, is_last_descendant: bool) -> Doc<'a> {
        match node.kind {
            Kind::Root => {
                let last = self.last_descendant(node);
                let should_print_hardline =
                    !(matches!(last.kind, Kind::BlockLiteral | Kind::BlockFolded) && last.chomping == Chomping::Keep);
                let mut parts = Vec::new();
                let count = node.children.len();
                for (index, &child) in node.children.iter().enumerate() {
                    if index > 0 {
                        parts.push(hardline());
                    }
                    parts.push(self.print(child, index + 1 == count));
                    let document = self.node(child);
                    let next = node.children.get(index + 1).map(|&next| self.node(next));
                    if self.should_print_document_end_marker(document, next) {
                        if should_print_hardline {
                            parts.push(hardline());
                        }
                        parts.push(Doc::from("..."));
                        if let Some(comment) = document.trailing_comment {
                            parts.push(Doc::from(" "));
                            parts.push(self.print(comment, false));
                        }
                    }
                }
                if should_print_hardline {
                    parts.push(hardline());
                }
                Doc::Array(parts)
            }
            Kind::Document => {
                let [head_id, body_id] = node.children[..] else {
                    return Doc::EMPTY;
                };
                let (head, body) = (self.node(head_id), self.node(body_id));
                let mut parts = Vec::new();
                // `shouldPrintDocumentHeadEndMarker`
                if node.directives_end_marker
                    || !head.children.is_empty()
                    || !head.end_comments.is_empty()
                    || head.trailing_comment.is_some()
                {
                    if !head.children.is_empty() || !head.end_comments.is_empty() {
                        parts.push(self.print(head_id, is_last_descendant));
                    }
                    parts.push(match head.trailing_comment {
                        Some(comment) => docs!["---", " ", self.print(comment, false)],
                        None => Doc::from("---"),
                    });
                }
                if !body.children.is_empty() || !body.end_comments.is_empty() {
                    parts.push(self.print(body_id, is_last_descendant));
                }
                Doc::Array(join(&hardline(), parts))
            }
            Kind::DocumentHead => {
                let mut parts = self.print_children(node, is_last_descendant);
                parts.extend(self.print_all(&node.end_comments));
                Doc::Array(join(&hardline(), parts))
            }
            Kind::DocumentBody => {
                let mut separator = Doc::EMPTY;
                if let (Some(&last_child), Some(&first_comment)) = (node.children.last(), node.end_comments.first()) {
                    let last = self.last_descendant(node);
                    if matches!(last.kind, Kind::BlockFolded | Kind::BlockLiteral) {
                        // There is a line break at the end of a block scalar that keeps its line breaks.
                        if last.chomping != Chomping::Keep {
                            separator = docs![hardline(), hardline()];
                        }
                    } else {
                        let start = self.node(first_comment).position.start.offset as usize;
                        let keeps_empty_line =
                            self.node(last_child).kind == Kind::Mapping && is_previous_line_empty(self.text, start);
                        separator = if keeps_empty_line { docs![hardline(), hardline()] } else { hardline() };
                    }
                }
                docs![
                    join(&hardline(), self.print_children(node, is_last_descendant)),
                    separator,
                    join(&hardline(), self.print_all(&node.end_comments)),
                ]
            }
            Kind::Directive => {
                // The name without the `%`, and the parameters.
                let source: &'a [u8] = match &node.value {
                    Cow::Borrowed(source) => source,
                    Cow::Owned(_) => b"",
                };
                let parts: Vec<Doc<'a>> = strings::split_any(text::trim(source), b" \t")
                    .filter(|part| !part.is_empty())
                    .enumerate()
                    .map(|(index, part)| Doc::from(if index == 0 { part.strip_prefix(b"%").unwrap_or(part) } else { part }))
                    .collect();
                docs!["%", join(&Doc::from(" "), parts)]
            }
            Kind::Comment => docs!["#", node.value.clone()],
            Kind::Alias => docs!["*", node.value.clone()],
            Kind::Tag => Doc::from(self.source(node)),
            Kind::Anchor => docs!["&", node.value.clone()],
            Kind::Plain => self.print_flow_scalar_content(node.kind, Cow::Borrowed(self.source(node))),
            Kind::QuoteDouble | Kind::QuoteSingle => self.print_quoted(node),
            Kind::BlockFolded | Kind::BlockLiteral => self.print_block(node, is_last_descendant),
            Kind::Mapping | Kind::Sequence => Doc::Array(join(&hardline(), self.print_children(node, is_last_descendant))),
            Kind::SequenceItem => {
                let content = match node.children.first() {
                    Some(&content) => self.print(content, is_last_descendant),
                    None => Doc::EMPTY,
                };
                docs!["- ", align_with_spaces(2, content)]
            }
            Kind::MappingKey | Kind::MappingValue | Kind::FlowSequenceItem => match node.children.first() {
                Some(&content) => self.print(content, is_last_descendant),
                None => Doc::EMPTY,
            },
            Kind::MappingItem | Kind::FlowMappingItem => self.print_mapping_item(node, is_last_descendant),
            Kind::FlowMapping | Kind::FlowSequence => self.print_flow_mapping(node, is_last_descendant),
        }
    }

    /// `shouldPrintDocumentEndMarker`
    fn should_print_document_end_marker(&self, document: &Node<'a>, next: Option<&'t Node<'a>>) -> bool {
        if document.document_end_marker || document.trailing_comment.is_some() {
            return true;
        }
        next.and_then(|next| self.first_child(next)).is_some_and(|head| !head.children.is_empty() || !head.end_comments.is_empty())
    }

    fn print_quoted(&mut self, node: &Node<'a>) -> Doc<'a> {
        let source = self.source(node);
        let raw = source.get(1..source.len().saturating_sub(1)).unwrap_or_default();
        let is_double = node.kind == Kind::QuoteDouble;
        // `/\\[^"]/`
        let has_escape = |raw: &[u8]| (1..raw.len()).any(|i| raw[i - 1] == b'\\' && raw[i] != b'"');
        if (!is_double && strings::contains_char(raw, b'\\')) || (is_double && has_escape(raw)) {
            // Only in double quotes are there escapes, and in single quotes a backslash needs none.
            let quote = if is_double { "\"" } else { "'" };
            return docs![quote, self.print_flow_scalar_content(node.kind, Cow::Borrowed(raw)), quote];
        }
        if strings::contains_char(raw, b'"') {
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
            return docs!["'", self.print_flow_scalar_content(node.kind, content), "'"];
        }
        if strings::contains_char(raw, b'\'') {
            let content = match is_double {
                true => Cow::Borrowed(raw),
                false => {
                    // `.replaceAll("''", "'")`
                    let mut content = Vec::with_capacity(raw.len());
                    let mut i = 0;
                    while let Some(&byte) = raw.get(i) {
                        content.push(byte);
                        i += if byte == b'\'' && raw.get(i + 1) == Some(&b'\'') { 2 } else { 1 };
                    }
                    Cow::Owned(content)
                }
            };
            return docs!["\"", self.print_flow_scalar_content(node.kind, content), "\""];
        }
        let quote = if self.single_quote { "'" } else { "\"" };
        docs![quote, self.print_flow_scalar_content(node.kind, Cow::Borrowed(raw)), quote]
    }

    /// `printFlowScalarContent`
    fn print_flow_scalar_content(&self, kind: Kind, content: Cow<'a, [u8]>) -> Doc<'a> {
        match content {
            Cow::Borrowed(content) => {
                let lines = self.flow_scalar_line_contents(kind, content);
                Doc::Array(join(&hardline(), lines.into_iter().map(|words| words.into_fill(Doc::from)).collect()))
            }
            Cow::Owned(content) => {
                let lines = self.flow_scalar_line_contents(kind, &content);
                let lines = lines.into_iter().map(|words| words.into_fill(|word| Doc::from(word.to_vec()))).collect();
                Doc::Array(join(&hardline(), lines))
            }
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
            return raw_lines.into_iter().map(|line| Words::Slices(if line.is_empty() { Vec::new() } else { vec![line] })).collect();
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
    fn block_value_line_contents(&self, node: &Node<'a>, parent_indent: usize, is_last_descendant: bool) -> Vec<Words<'a>> {
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
        let raw_lines: Vec<&'a [u8]> =
            strings::split(content, b"\n").map(|line| line.get(leading_space_count..).unwrap_or_default()).collect();

        let lines: Vec<Words<'a>> = if self.prose_wrap == ProseWrap::Preserve || node.kind == Kind::BlockLiteral {
            raw_lines.iter().map(|&line| Words::Slices(if line.is_empty() { Vec::new() } else { vec![line] })).collect()
        } else {
            let mut lines: Vec<Vec<&'a [u8]>> = Vec::new();
            for (index, line) in raw_lines.iter().enumerate() {
                let words = split_with_single_space(line);
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
                let needs_merging = words.iter().rev().skip(1).any(|word| text::trim_end(word).len() < word.len());
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
            if content.ends_with(b"\n") && lines.last().is_some_and(Words::is_empty) {
                lines.pop();
            }
            return lines;
        }
        let is_blank = |words: &Words<'a>| {
            let is_blank = |word: &[u8]| word.iter().all(|b| matches!(b, b' ' | b'\t'));
            match words {
                Words::Slices(words) => words.iter().all(|word| is_blank(word)),
                Words::Joined(text) => is_blank(text),
            }
        };
        let trailing_newline_count = lines.iter().rev().take_while(|words| is_blank(words)).count();
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
    fn print_block(&mut self, node: &'t Node<'a>, is_last_descendant: bool) -> Doc<'a> {
        let mut parent_indent = 0;
        let mut ancestor = self.parent(node);
        while let Some(it) = ancestor {
            parent_indent += usize::from(matches!(it.kind, Kind::Sequence | Kind::Mapping));
            ancestor = self.parent(it);
        }
        let mut parts: Vec<Doc<'a>> = vec![Doc::from(if node.kind == Kind::BlockFolded { ">" } else { "|" })];
        if let Some(indent) = node.indent {
            parts.push(Doc::from(indent.to_string().into_bytes()));
        }
        match node.chomping {
            Chomping::Clip => {}
            Chomping::Keep => parts.push(Doc::from("+")),
            Chomping::Strip => parts.push(Doc::from("-")),
        }
        if let Some(comment) = node.indicator_comment {
            parts.push(Doc::from(" "));
            parts.push(self.print(comment, false));
        }
        let lines = self.block_value_line_contents(node, parent_indent, is_last_descendant);
        let count = lines.len();
        let mut contents: Vec<Doc<'a>> = Vec::with_capacity(count * 2 + 1);
        let literalline = || docs![Doc::Line(Line::Literal), Doc::BreakParent];
        for (index, words) in lines.into_iter().enumerate() {
            if index == 0 {
                contents.push(hardline());
            }
            let is_empty = words.is_empty();
            contents.push(words.into_fill(Doc::from));
            if index + 1 != count {
                contents.push(if is_empty { hardline() } else { Doc::MarkAsRoot(Box::new(literalline())) });
            } else if node.chomping == Chomping::Keep && is_last_descendant {
                contents.push(Doc::DedentToRoot(Box::new(if is_empty { hardline() } else { literalline() })));
            }
        }
        parts.push(match node.indent {
            None => dedent(align_with_spaces(self.tab_width, contents)),
            Some(indent) => Doc::DedentToRoot(Box::new(align_with_spaces(
                (indent + parent_indent as u32).saturating_sub(1),
                contents,
            ))),
        });
        Doc::Array(parts)
    }

    /// `printFlowMapping` and `printFlowSequence`
    fn print_flow_mapping(&mut self, node: &'t Node<'a>, is_last_descendant: bool) -> Doc<'a> {
        let is_mapping = node.kind == Kind::FlowMapping;
        let bracket_spacing = match is_mapping && !node.children.is_empty() && self.bracket_spacing {
            true => Doc::LINE,
            false => Doc::SOFTLINE,
        };
        let is_last_item_empty_mapping_item = node.children.last().is_some_and(|&last| {
            let last = self.node(last);
            last.kind == Kind::FlowMappingItem && last.children.iter().all(|&child| is_empty_node(self.node(child)))
        });
        let count = node.children.len();
        let mut children = Vec::with_capacity(count);
        for (index, &child) in node.children.iter().enumerate() {
            let printed = self.print(child, is_last_descendant && index + 1 == count);
            let Some(&next) = node.children.get(index + 1) else {
                children.push(printed);
                break;
            };
            let child = self.node(child);
            let empty_line = match child.position.start.line != self.node(next).position.start.line {
                true => self.print_next_empty_line(child),
                false => Doc::EMPTY,
            };
            children.push(docs![printed, ",", Doc::LINE, empty_line]);
        }
        docs![
            if is_mapping { "{" } else { "[" },
            align_with_spaces(
                self.tab_width,
                docs![
                    bracket_spacing.clone(),
                    children,
                    if self.trailing_comma { if_break(",") } else { Doc::EMPTY },
                    match node.end_comments.is_empty() {
                        true => Doc::EMPTY,
                        false => docs![hardline(), join(&hardline(), self.print_all(&node.end_comments))],
                    },
                ],
            ),
            if is_last_item_empty_mapping_item { Doc::EMPTY } else { bracket_spacing },
            if is_mapping { "}" } else { "]" },
        ]
    }

    /// `isAbsolutelyPrintedAsSingleLineNode`
    fn is_absolutely_printed_as_single_line(&self, node: Option<&Node<'a>>) -> bool {
        let Some(node) = node else {
            return true;
        };
        match node.kind {
            Kind::Plain | Kind::QuoteSingle | Kind::QuoteDouble => {}
            Kind::Alias => return true,
            _ => return false,
        }
        if self.prose_wrap == ProseWrap::Preserve {
            return node.position.start.line == node.position.end.line;
        }
        // A backslash at the end of a line: `/\\$/m`
        let source = self.source(node);
        if source.ends_with(b"\\") || text::includes(source, b"\\\n") {
            return false;
        }
        match self.prose_wrap {
            ProseWrap::Never => !strings::contains_char(&node.value, b'\n'),
            _ => strings::index_of_any(&node.value, b"\n ").is_none(),
        }
    }

    /// `printMappingItem`
    fn print_mapping_item(&mut self, node: &'t Node<'a>, is_last_descendant: bool) -> Doc<'a> {
        let [key_id, value_id] = node.children[..] else {
            return Doc::EMPTY;
        };
        let (key, value) = (self.node(key_id), self.node(value_id));
        let parent = self.parent(node);
        let (is_empty_key, is_empty_value) = (is_empty_node(key), is_empty_node(value));
        if is_empty_key && is_empty_value {
            return Doc::from(": ");
        }
        let (key_content, value_content) = (self.first_child(key), self.first_child(value));
        let printed_key = self.print(key_id, is_last_descendant);
        // `needsSpaceInFrontOfMappingValue`
        let space_before_colon = if key_content.is_some_and(|it| it.kind == Kind::Alias) { " " } else { "" };

        if is_empty_value {
            if node.kind == Kind::FlowMappingItem && parent.is_some_and(|it| it.kind == Kind::FlowMapping) {
                return printed_key;
            }
            let is_in_set = parent.and_then(|it| it.tag).is_some_and(|tag| self.node(tag).is_set_tag);
            if node.kind == Kind::MappingItem
                && self.is_absolutely_printed_as_single_line(key_content)
                && key_content.is_none_or(|it| it.trailing_comment.is_none())
                && !is_in_set
            {
                return docs![printed_key, space_before_colon, ":"];
            }
            return docs!["? ", align_with_spaces(2, printed_key)];
        }

        let printed_value = self.print(value_id, is_last_descendant);
        if is_empty_key {
            return docs![": ", align_with_spaces(2, printed_value)];
        }

        // An explicit key.
        if !value.leading_comments.is_empty() || !is_inline_node(key_content) {
            let mut comments = Vec::new();
            for &comment in &value.leading_comments {
                comments.push(self.print(comment, false));
                comments.push(hardline());
            }
            return docs![
                "? ",
                align_with_spaces(2, printed_key),
                hardline(),
                comments,
                ": ",
                align_with_spaces(2, printed_value),
            ];
        }

        let has_no_comments_before_or_in =
            |content: Option<&Node<'a>>| content.is_none_or(|it| it.leading_comments.is_empty() && it.middle_comments.is_empty());
        let key_has_no_comments = has_no_comments_before_or_in(key_content)
            && key_content.is_none_or(|it| it.trailing_comment.is_none())
            && key.end_comments.is_empty();
        // `isSingleLineNode`
        let is_single_line_key = key_content.is_none_or(|it| match it.kind {
            Kind::Plain | Kind::QuoteDouble | Kind::QuoteSingle => it.position.start.line == it.position.end.line,
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
            return docs![printed_key, space_before_colon, ": ", printed_value];
        }

        // Everything from the colon on is taken for the value.
        let mut implicit_value: Vec<Doc<'a>> = vec![Doc::from(space_before_colon), Doc::from(":")];
        let is_block_collection = |it: &Node<'a>| matches!(it.kind, Kind::Mapping | Kind::Sequence);
        let has_end_comments = !value.end_comments.is_empty();
        if has_end_comments
            && value_content.is_some_and(|it| matches!(it.kind, Kind::FlowMapping | Kind::FlowSequence) && it.children.is_empty())
        {
            implicit_value.push(Doc::from(" "));
        } else if value_content.is_some_and(|it| !it.leading_comments.is_empty())
            || (has_end_comments && value_content.is_some_and(|it| !is_block_collection(it)))
            || (parent.is_some_and(|it| it.kind == Kind::Mapping)
                && key_content.is_some_and(|it| it.trailing_comment.is_some())
                && is_inline_node(value_content))
            || value_content.is_some_and(|it| is_block_collection(it) && it.tag.is_none() && it.anchor.is_none())
        {
            implicit_value.push(hardline());
        } else if value_content.is_some() {
            implicit_value.push(Doc::LINE);
        } else if value.trailing_comment.is_some() {
            implicit_value.push(Doc::from(" "));
        }
        let conditional_group = |contents: Doc<'a>| Doc::Group {
            contents: Box::new(contents),
            should_break: false,
            id: 0,
            is_conditional: true,
        };

        // A key that is on one line for sure is implicit, however long it is.
        if self.is_absolutely_printed_as_single_line(key_content) && key_has_no_comments {
            implicit_value.push(printed_value);
            return conditional_group(docs![printed_key, align_with_spaces(self.tab_width, implicit_value)]);
        }

        // Explicit if the key breaks, implicit otherwise.
        implicit_value.push(printed_value.clone());
        self.last_group_id += 1;
        let group_id = self.last_group_id;
        let grouped_key = group(docs![
            if_break("? "),
            Doc::Group {
                contents: Box::new(align_with_spaces(2, printed_key)),
                should_break: false,
                id: group_id,
                is_conditional: false,
            },
        ]);
        conditional_group(docs![
            grouped_key,
            Doc::IfBreak {
                break_contents: Box::new(docs![hardline(), ": ", align_with_spaces(2, printed_value)]),
                flat_contents: Box::new(align_with_spaces(self.tab_width, implicit_value)),
                group_id,
            },
        ])
    }
}
