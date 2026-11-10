//! Builds a Markdown text's document: Prettier's `src/language-markdown/print/*.js`.

use super::ast::{Align, Kind, NONE, Node, NodeId, ReferenceType, Str, Tree};
use super::parse::{Syntax, leaves_paragraph};
use super::preprocess::{
    self, Token, TokenKind, is_indented_code, is_punctuation, is_punctuation_unit,
    ordered_item_info,
};
use super::strings::character_reference;
use crate::css::doc::{
    self, Alignment, Doc, Line, align_with_spaces, docs, fill, group, hardline, indent,
};
use crate::options::ProseWrap;
use crate::stack::Stack;
use crate::text::{first_char, last_char};
use crate::{FormatError, FormatOptions};
use std::borrow::Cow;

/// Code in another language, to be formatted.
pub(crate) struct Embedded<'x> {
    /// The language given after the fence.
    pub(crate) language: &'x [u8],
    pub(crate) code: &'x [u8],
    /// How many columns of the line are left.
    pub(crate) width: usize,
}

pub(crate) struct Printer<'a, 'e> {
    pub(crate) text: &'a [u8],
    /// The same text, but always with the front matter: see `parse::blank_front_matter`.
    pub(crate) original: &'a [u8],
    pub(crate) tree: &'a Tree,
    pub(crate) options: &'a FormatOptions,
    /// Formats code in another language. If it returns `None`, the code is left as is.
    pub(crate) embed: &'e mut dyn FnMut(&Embedded<'_>) -> Option<Vec<u8>>,
    /// The document is for a JavaScript template, so no backticks.
    pub(crate) is_in_template: bool,
    pub(crate) is_mdx: bool,
    /// How many columns the current node is indented by.
    pub(crate) indentation: usize,
    /// The current node is in a reference whose label is its text, which has to stay unchanged.
    pub(crate) is_in_label: bool,
    /// For oxfmt: `first_list_of_run`'s cache, indexed by list.
    pub(crate) first_of_run: Vec<NodeId>,
    pub(crate) stack: Stack,
    /// Why a table cell couldn't be printed.
    pub(crate) failure: Option<FormatError>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Ignore {
    Next,
    Start,
    End,
}

fn literalline<'a>() -> Doc<'a> {
    Doc::Array(vec![Doc::Line(Line::Literal), Doc::BreakParent])
}

fn mark_as_root(contents: Doc<'_>) -> Doc<'_> {
    Doc::MarkAsRoot(Box::new(contents))
}

/// oxfmt's `Atom::VerbatimLine`: a line break inside inline content that's printed verbatim. The next line starts at
/// the column of the container's content, which is all the indentation a parser strips.
fn verbatim_line<'a>() -> Doc<'a> {
    Doc::DedentToRoot(Box::new(hardline()))
}

/// True if `doc` prints on more than one line at any line width.
fn has_line_break(doc: &Doc<'_>) -> bool {
    let mut rest = vec![doc];
    while let Some(doc) = rest.pop() {
        match doc {
            Doc::Line(Line::Hard | Line::Literal) => return true,
            Doc::Text(text) if bun_core::strings::contains_char(text, b'\n') => return true,
            Doc::Array(parts) | Doc::Fill(parts) => rest.extend(parts),
            Doc::Indent(contents)
            | Doc::Align(_, contents)
            | Doc::Dedent(contents)
            | Doc::DedentToRoot(contents)
            | Doc::MarkAsRoot(contents)
            | Doc::Group { contents, .. }
            | Doc::LineSuffix(contents) => rest.push(contents),
            Doc::IfBreak {
                break_contents,
                flat_contents,
                ..
            } => rest.extend([&**break_contents, &**flat_contents]),
            _ => {}
        }
    }
    false
}

/// Returns the line break to print after `line`, which is printed verbatim. A `hardline` would trim trailing spaces and
/// tabs, so a line that ends with one gets a literal line break.
fn line_break_after<'a>(line: &[u8]) -> Doc<'a> {
    match line.last() {
        Some(b' ' | b'\t') => mark_as_root(literalline()),
        _ => hardline(),
    }
}

fn spaces<'a>(count: usize) -> Doc<'a> {
    Doc::Text(Cow::Owned(vec![b' '; count]))
}

/// Prettier's `replaceEndOfLine(text, separator)`
fn replace_end_of_line<'a>(text: &'a [u8], separator: impl Fn() -> Doc<'a>) -> Doc<'a> {
    if !bun_core::strings::contains_char(text, b'\n') {
        return Doc::from(text);
    }
    let mut parts = Vec::new();
    for (index, line) in bun_core::strings::split(text, b"\n").enumerate() {
        if index > 0 {
            parts.push(separator());
        }
        parts.push(Doc::from(line));
    }
    Doc::Array(parts)
}

/// Code that has been formatted, line by line. A line break in a text, which is marked by a `\r`, is a literal
/// line: see `FormatOptions::is_in_markdown`. So is a line break after a space or a tab, because a formatter only
/// prints trailing whitespace that must be kept.
fn lines_of<'a>(formatted: &[u8]) -> Doc<'a> {
    let mut parts = Vec::new();
    let mut is_after_literal_line_break = false;
    for (index, line) in bun_core::strings::split(formatted, b"\n").enumerate() {
        if index > 0 {
            parts.push(if is_after_literal_line_break {
                literalline()
            } else {
                hardline()
            });
        }
        is_after_literal_line_break = matches!(line.last(), Some(b'\r' | b' ' | b'\t'));
        parts.push(Doc::from(line.strip_suffix(b"\r").unwrap_or(line).to_vec()));
    }
    Doc::Array(parts)
}

/// oxfmt's `print_url`, which matches Prettier after 3.9: a backslash that would escape something is doubled, an `&`
/// that would start a character reference is escaped, and between `<` and `>` those two characters are escaped.
fn oxfmt_url(url: &[u8], is_in_parentheses: bool) -> Vec<u8> {
    let is_balanced = || {
        let mut depth = 0i32;
        for &byte in url {
            match byte {
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ => {}
            }
            if !(0..=3).contains(&depth) {
                return false;
            }
        }
        depth == 0
    };
    let needs_brackets = url
        .iter()
        .any(|byte| byte.is_ascii_control() || *byte == b' ')
        || url.starts_with(b"<")
        || match is_in_parentheses {
            true => bun_core::strings::index_of_any(url, b"()").is_some(),
            false => !is_balanced(),
        };
    let mut printed = Vec::with_capacity(url.len() + 2);
    if needs_brackets {
        printed.push(b'<');
    }
    for (index, &byte) in url.iter().enumerate() {
        let is_escaped = match byte {
            b'\\' => url.get(index + 1).is_none_or(u8::is_ascii_punctuation),
            b'&' => character_reference(&url[index..], None).is_some(),
            b'<' | b'>' => needs_brackets,
            _ => false,
        };
        if is_escaped {
            printed.push(b'\\');
        }
        printed.push(byte);
    }
    if needs_brackets {
        printed.push(b'>');
    }
    printed
}

/// oxfmt's `has_line_ranges`: true if the text after a code block's language refers to lines by number: `{1,3-5}`.
fn has_line_ranges(meta: &[u8]) -> bool {
    bun_core::strings::split(meta, b"{").skip(1).any(|rest| {
        bun_core::strings::split_once_char(rest, b'}').is_some_and(|(ranges, _)| {
            ranges.iter().any(u8::is_ascii_digit)
                && ranges
                    .iter()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b',' | b'-' | b' '))
        })
    })
}

/// The lengths of the runs of `marker` in `text`.
fn runs_of(text: &[u8], marker: u8) -> impl Iterator<Item = usize> {
    let mut rest = text;
    std::iter::from_fn(move || {
        rest = &rest[bun_core::strings::index_of_char_usize(rest, marker)?..];
        let len = rest.iter().take_while(|&&byte| byte == marker).count();
        rest = &rest[len..];
        Some(len)
    })
}

/// The longest run of `marker` in `text`.
fn max_continuous_count(text: &[u8], marker: u8) -> usize {
    runs_of(text, marker).max().unwrap_or(0)
}

/// Prettier's `getMinNotPresentContinuousCount`
fn min_not_present_continuous_count(text: &[u8], marker: u8) -> usize {
    let mut present: smallvec::SmallVec<[usize; 8]> = runs_of(text, marker).collect();
    crate::sort::sort(&mut present[..]);
    present.dedup();
    (1..)
        .zip(present.iter())
        .find(|(count, len)| count != *len)
        .map_or(present.len() + 1, |(count, _)| count)
}

/// `[\p{Space_Separator}\t\n\f\r]`
fn is_commonmark_whitespace(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{C}' | '\r')
        || bun_core::strings::is_unicode_space_separator(c as u32)
}

/// Collects the parts of a `fill`, where content and separators alternate.
///
/// If lines aren't wrapped, every separator is a forced line break, and a `fill` prints the same as its parts
/// concatenated. So a plain array is built instead, which is cheaper.
struct FillParts<'a> {
    is_fill: bool,
    parts: Vec<Doc<'a>>,
    /// The content being assembled, for a `fill`.
    content: Vec<Doc<'a>>,
}

impl<'a> FillParts<'a> {
    fn new(is_fill: bool) -> Self {
        FillParts {
            is_fill,
            parts: Vec::new(),
            content: Vec::new(),
        }
    }

    fn content(&mut self, doc: Doc<'a>) {
        match self.is_fill {
            true => self.content.push(doc),
            false => self.parts.push(doc),
        }
    }

    fn end_content(&mut self) {
        let mut content = std::mem::take(&mut self.content);
        self.parts.push(match content.len() {
            0 => Doc::EMPTY,
            1 => content.pop().unwrap_or(Doc::EMPTY),
            _ => Doc::Array(content),
        });
    }

    fn separator(&mut self, separator: Doc<'a>) {
        if self.is_fill {
            self.end_content();
        }
        self.parts.push(separator);
    }

    fn hardline(&mut self) {
        match self.is_fill {
            true => self.separator(hardline()),
            false => self.parts.extend([Doc::Line(Line::Hard), Doc::BreakParent]),
        }
    }

    /// Prettier's `flattenFill`: the parts of a `fill` in `doc` become parts of this one.
    fn flatten(&mut self, mut doc: Doc<'a>) {
        // What follows `doc` in the arrays that contain it.
        let mut outer: Vec<std::vec::IntoIter<Doc<'a>>> = Vec::new();
        loop {
            if let Doc::Array(docs) = &mut doc {
                let mut docs = std::mem::take(docs);
                match (self.is_fill, self.parts.is_empty()) {
                    (true, _) => outer.push(docs.into_iter()),
                    (false, true) => self.parts = docs,
                    (false, false) => self.parts.append(&mut docs),
                }
            } else if let Doc::Fill(parts) = &mut doc {
                for (index, part) in std::mem::take(parts).into_iter().enumerate() {
                    match index % 2 {
                        0 => self.content(part),
                        _ => self.separator(part),
                    }
                }
            } else {
                self.content(doc);
            }
            doc = loop {
                match outer.last_mut().map(Iterator::next) {
                    Some(Some(next)) => break next,
                    Some(None) => outer.truncate(outer.len() - 1),
                    None => return,
                }
            };
        }
    }

    fn finish(mut self) -> Doc<'a> {
        if !self.is_fill {
            return Doc::Array(self.parts);
        }
        self.end_content();
        fill(self.parts)
    }
}

/// How whitespace is printed.
enum Whitespace {
    Text(&'static str),
    Line,
    Softline,
    Hardline,
}

impl<'a> Printer<'a, '_> {
    fn node(&self, id: NodeId) -> Option<&'a Node> {
        self.tree.get(id)
    }

    fn kind(&self, id: NodeId) -> Option<Kind> {
        self.tree.kind(id)
    }

    fn str(&self, string: Str) -> &'a [u8] {
        self.tree.str(self.text, string)
    }

    fn source(&self, node: &Node) -> &'a [u8] {
        self.original
            .get(node.start as usize..node.end as usize)
            .unwrap_or_default()
    }

    fn start_line(&self, node: &Node) -> u32 {
        self.tree.line(node.start)
    }

    fn end_line(&self, node: &Node) -> u32 {
        self.tree.line(node.end)
    }

    fn column(&self, offset: u32) -> u32 {
        offset - self.tree.line_start(offset)
    }

    fn has_ancestor(&self, id: NodeId, is_wanted: impl Fn(&Node) -> bool) -> bool {
        self.find_ancestor(id, is_wanted).is_some()
    }

    fn find_ancestor(&self, id: NodeId, is_wanted: impl Fn(&Node) -> bool) -> Option<NodeId> {
        let mut ancestor = self.node(id)?.parent;
        while let Some(node) = self.node(ancestor) {
            if is_wanted(node) {
                return Some(ancestor);
            }
            ancestor = node.parent;
        }
        None
    }

    fn tokens(&self, sentence: &Node) -> &'a [Token] {
        let first = sentence.first_align as usize;
        self.tree
            .tokens
            .get(first..first + sentence.number as usize)
            .unwrap_or_default()
    }

    /// The lines of `text`, with `hardline` between them, or with `markAsRoot(literalline)`.
    ///
    /// If lines aren't indented and nothing has to be trimmed at their ends, the text is printed as is.
    fn lines(&self, text: &'a [u8], is_literal: bool) -> Doc<'a> {
        let is_verbatim = self.indentation == 0
            && !self.is_in_template
            && !self.options.is_in_markdown
            && (is_literal
                || !(bun_core::strings::contains(text, b" \n")
                    || bun_core::strings::contains(text, b"\t\n")));
        match (is_verbatim, is_literal) {
            (true, _) => Doc::from(text),
            (false, false) => replace_end_of_line(text, hardline),
            (false, true) => replace_end_of_line(text, || mark_as_root(literalline())),
        }
    }

    /// Runs `contents` with `width` more columns of indentation.
    fn indented<T>(&mut self, width: usize, contents: impl FnOnce(&mut Self) -> T) -> T {
        self.indentation += width;
        let result = contents(self);
        self.indentation -= width;
        result
    }

    // ───────────────────────────── node queries ─────────────────────────────

    fn is_setext_heading(&self, node: &Node) -> bool {
        self.start_line(node) != self.end_line(node)
    }

    /// Prettier's `isPrettierIgnore`
    fn prettier_ignore(&self, id: NodeId) -> Option<Ignore> {
        let node = self.node(id)?;
        let comment = match node.kind {
            Kind::Html => {
                let comment = self
                    .str(node.value)
                    .strip_prefix(b"<!--")?
                    .strip_suffix(b"-->")?;
                bun_core::strings::trim_js_whitespace_end(
                    bun_core::strings::trim_js_whitespace_start(comment),
                )
            }
            Kind::EsComment => self.str(node.value),
            Kind::Paragraph if self.is_mdx && node.first_child == node.last_child => self.str(
                self.node(node.first_child)
                    .filter(|child| child.kind == Kind::EsComment)?
                    .value,
            ),
            _ => return None,
        };
        let flavor = self.options.flavor;
        let is_ignore = |suffix: &[u8]| {
            comment
                .strip_suffix(suffix)
                .is_some_and(|it| flavor.is_ignore_comment(it))
        };
        if is_ignore(b"") {
            Some(Ignore::Next)
        } else if is_ignore(b"-start") {
            Some(Ignore::Start)
        } else if is_ignore(b"-end") {
            Some(Ignore::End)
        } else {
            None
        }
    }

    /// Prettier's `isAutolink`
    fn is_autolink(&self, id: NodeId) -> bool {
        let Some(node) = self.node(id).filter(|node| node.kind == Kind::Link) else {
            return false;
        };
        node.first_child == node.last_child
            && self
                .node(node.first_child)
                .is_some_and(|child| child.start == node.start && child.end == node.end)
    }

    /// Prettier's `getNthListSiblingIndex`: how many lists of the same kind are right before `list`.
    fn nth_list_sibling_index(&self, list: NodeId) -> usize {
        self.node(list).map_or(0, |it| it.first_align as usize)
    }

    /// The first list in the run of same-kind lists that `list` is in, or `list` itself.
    fn first_list_of_run(&mut self, list: NodeId) -> NodeId {
        if self.first_of_run.is_empty() {
            self.first_of_run = vec![NONE; self.tree.nodes.len()];
        }
        let mut at = list;
        let first = loop {
            match (self.first_of_run.get(at as usize), self.node(at)) {
                (Some(&known), _) if known != NONE => break known,
                (_, Some(node)) if node.first_align > 0 => at = node.previous,
                _ => break at,
            }
        };
        if let Some(slot) = self.first_of_run.get_mut(list as usize) {
            *slot = first;
        }
        first
    }

    /// True if `list` uses `*` or `)`: consecutive lists of the same kind alternate.
    fn uses_alternate_marker(&mut self, list: NodeId) -> bool {
        let index = self.nth_list_sibling_index(list);
        let mut is_first_alternate = false;
        // oxfmt: a list that's left verbatim keeps its own marker.
        if self.options.flavor.is_oxfmt() && index > 0 {
            let first = self.first_list_of_run(list);
            if let Some(first) = self.node(first)
                && self.prettier_ignore(first.previous) == Some(Ignore::Next)
            {
                let marker = self.source(first);
                let digits = marker.iter().take_while(|it| it.is_ascii_digit()).count();
                is_first_alternate = matches!(marker.get(digits), Some(b'*' | b')'));
            }
        }
        is_first_alternate ^ !index.is_multiple_of(2)
    }

    /// True if there's a hard line break in `id`.
    fn has_hard_break(&self, id: NodeId) -> bool {
        let mut next = self.node(id).map_or(NONE, |it| it.first_child);
        while let Some(node) = self.node(next) {
            if node.kind == Kind::Break {
                return true;
            }
            next = node.first_child;
            let mut at = node;
            while next == NONE && at.parent != NONE {
                next = at.next;
                if at.parent == id && next == NONE {
                    return false;
                }
                let Some(parent) = self.node(at.parent) else {
                    return false;
                };
                at = parent;
            }
        }
        false
    }

    /// Prettier's `isLooseListItem`
    fn is_loose_list_item(&self, id: NodeId) -> bool {
        let Some(node) = self.node(id).filter(|node| node.kind == Kind::ListItem) else {
            return false;
        };
        if self.is_mdx {
            return self.is_loose_list_item_legacy(node);
        }
        node.spread
            || (self.kind(node.parent) == Some(Kind::List)
                && self.node(node.next).is_some_and(|next| {
                    next.kind == Kind::ListItem && self.end_line(node) + 1 < self.start_line(next)
                }))
    }

    /// Prettier's `isLooseListItemLegacy`, with remark-parse 8's view of an item: it's spread if it contains an empty
    /// line followed by something, and it ends after the empty lines before the next item.
    fn is_loose_list_item_legacy(&self, item: &Node) -> bool {
        let source = bun_core::strings::trim_js_whitespace_end(self.source(item));
        // The item's indentation is stripped from its lines first, even from a line with nothing else on it.
        let indent = self
            .node(item.first_child)
            .map_or(0, |first| self.column(first.start)) as usize;
        let mut from = 0;
        while let Some(at) = bun_core::strings::index_of_char_usize(&source[from..], b'\n') {
            from += at + 1;
            let whitespace_len = source[from..]
                .iter()
                .take_while(|it| matches!(it, b' ' | b'\t'))
                .count();
            if whitespace_len <= indent && source.get(from + whitespace_len) == Some(&b'\n') {
                return true;
            }
        }
        self.node(item.next)
            .is_some_and(|next| self.end_line(item) + 1 < self.start_line(next))
    }

    fn is_inline(kind: Kind) -> bool {
        matches!(
            kind,
            Kind::LiquidNode
                | Kind::InlineCode
                | Kind::Emphasis
                | Kind::EsComment
                | Kind::Strong
                | Kind::Delete
                | Kind::WikiLink
                | Kind::Link
                | Kind::LinkReference
                | Kind::Image
                | Kind::ImageReference
                | Kind::FootnoteReference
                | Kind::Sentence
                | Kind::Break
                | Kind::InlineMath
        )
    }

    pub(crate) fn is_inline_wrapper(kind: Kind) -> bool {
        Self::is_inline(kind) || matches!(kind, Kind::TableCell | Kind::Paragraph | Kind::Heading)
    }

    fn should_pre_print_hardline(&self, node: &Node) -> bool {
        let is_in_wrapper = self.kind(node.parent).is_some_and(Self::is_inline_wrapper);
        let is_inline_node =
            Self::is_inline(node.kind) && !(node.kind == Kind::LiquidNode && !is_in_wrapper);
        let is_inline_html = node.kind == Kind::Html && is_in_wrapper;
        // Prettier treats text that it hasn't split into words as a block.
        let is_text = node.kind == Kind::Text && self.options.flavor.is_oxfmt();
        !is_inline_node && !is_inline_html && !is_text
    }

    fn should_pre_print_double_hardline(&self, node: &Node) -> bool {
        let (Some(previous), Some(parent)) = (self.node(node.previous), self.node(node.parent))
        else {
            return false;
        };
        if !self.is_mdx
            && self.is_setext_heading(node)
            && self.start_line(node) < self.end_line(previous)
        {
            return false;
        }
        let follows_directly = self.end_line(previous) + 1 == self.start_line(node);
        if self.is_loose_list_item(node.previous)
            || (node.kind == Kind::List
                && parent.kind == Kind::ListItem
                && (matches!(previous.kind, Kind::Code | Kind::Paragraph)
                    || (previous.kind == Kind::Html
                        && previous.number == 0
                        && self.options.flavor.is_oxfmt()))
                && self.end_line(previous) + 1 < self.start_line(node))
        {
            return true;
        }
        let is_sibling_node =
            previous.kind == node.kind && matches!(node.kind, Kind::ListItem | Kind::Definition);
        let is_in_tight_list_item = parent.kind == Kind::ListItem
            && (node.kind == Kind::List || !self.is_loose_list_item(node.parent));
        let is_previous_ignore = self.prettier_ignore(node.previous) == Some(Ignore::Next);
        let is_html_after_html_or_paragraph = node.kind == Kind::Html
            && follows_directly
            && match previous.kind {
                Kind::Html => true,
                Kind::Paragraph => {
                    (!self.is_mdx || parent.kind == Kind::ListItem) && !self.is_lazy_html(node)
                }
                _ => false,
            };
        let is_liquid_without_blank_line = (node.kind == Kind::LiquidNode
            || previous.kind == Kind::LiquidNode)
            && follows_directly;
        !(is_sibling_node
            || is_in_tight_list_item
            || is_previous_ignore
            || is_html_after_html_or_paragraph
            || is_liquid_without_blank_line)
    }

    /// oxfmt's `front_matter_risk`: the document's first paragraph starts with `---` or `+++`, and what follows would
    /// close front matter when the output is parsed again.
    fn would_be_front_matter(&self, paragraph: &Node) -> bool {
        if !self.options.flavor.is_oxfmt()
            || self
                .kind(paragraph.previous)
                .is_some_and(|it| it != Kind::FrontMatter)
            || self.kind(paragraph.parent) != Some(Kind::Root)
        {
            return false;
        }
        let head = self
            .original
            .get(paragraph.start as usize..)
            .unwrap_or_default();
        if !head.starts_with(b"---") && !head.starts_with(b"+++") {
            return false;
        }
        if super::front_matter::parse(head).is_some() {
            return true;
        }
        let mut sibling = paragraph.next;
        while let Some(node) = self.node(sibling) {
            if node.kind == Kind::ThematicBreak && head.starts_with(b"---") {
                return true;
            }
            sibling = node.next;
        }
        false
    }

    /// oxfmt: HTML right after a paragraph in a list item, on a line that isn't indented like the item, is in the item
    /// only as long as that line stays unindented. See `bun_md`'s `compat::complete_tag_ends_lazy_paragraph`.
    fn is_lazy_html_in_tight_item(&self, node: &Node) -> bool {
        self.is_lazy_html(node)
            && self.kind(node.parent) == Some(Kind::ListItem)
            && !self.is_loose_list_item(node.parent)
    }

    /// oxfmt: HTML right after a paragraph in a container, on a line without the container's line prefix. With the
    /// prefix before it, only an empty line keeps it from being a line of the paragraph.
    fn is_lazy_html(&self, node: &Node) -> bool {
        if !self.options.flavor.is_oxfmt() || node.kind != Kind::Html {
            return false;
        }
        let (Some(previous), Some(parent)) = (self.node(node.previous), self.node(node.parent))
        else {
            return false;
        };
        previous.kind == Kind::Paragraph
            && self.end_line(previous) + 1 == self.start_line(node)
            && match parent.kind {
                Kind::ListItem => self
                    .node(parent.first_child)
                    .is_some_and(|first| self.column(node.start) < self.column(first.start)),
                Kind::Blockquote => self.column(node.start) <= self.column(parent.start),
                _ => false,
            }
    }

    // ───────────────────────────── children ─────────────────────────────

    /// Prettier's `printChildren`. `processor` prints a child, or returns `None` to skip it.
    fn print_children_with(
        &mut self,
        parent: NodeId,
        mut processor: impl FnMut(&mut Self, NodeId) -> Option<Doc<'a>>,
    ) -> Doc<'a> {
        let mut parts = Vec::new();
        let mut child = self.node(parent).map_or(NONE, |node| node.first_child);
        while let Some(node) = self.node(child) {
            if let Some(result) = processor(self, child) {
                if !parts.is_empty() && self.is_lazy_html_in_tight_item(node) {
                    parts.push(Doc::Dedent(Box::new(hardline())));
                } else if !parts.is_empty() && self.should_pre_print_hardline(node) {
                    parts.extend([Doc::Line(Line::Hard), Doc::BreakParent]);
                    if self.should_pre_print_double_hardline(node) {
                        parts.extend([Doc::Line(Line::Hard), Doc::BreakParent]);
                    }
                }
                parts.push(result);
            }
            child = node.next;
        }
        Doc::Array(parts)
    }

    fn print_children(&mut self, parent: NodeId) -> Doc<'a> {
        self.print_children_with(parent, |printer, child| Some(printer.print(child)))
    }

    /// Prints a node: verbatim if it's ignored, as its embedded language, or as Markdown.
    pub(crate) fn print(&mut self, id: NodeId) -> Doc<'a> {
        if !self.stack.has_room() {
            return Doc::EMPTY;
        }
        let Some(node) = self.node(id) else {
            return Doc::EMPTY;
        };
        if self.prettier_ignore(node.previous) == Some(Ignore::Next) {
            return self.print_ignored(id, node);
        }
        if let Some(embedded) = self.print_embedded(id, node) {
            return embedded;
        }
        self.print_mdast(id, node)
    }

    /// Prettier's `printPrettierIgnored`
    fn print_ignored(&self, id: NodeId, node: &Node) -> Doc<'a> {
        let mut source = self.source(node);
        if node.kind == Kind::List
            && !self.is_mdx
            && (self.options.prose_wrap != ProseWrap::Always || self.options.flavor.is_oxfmt())
            && self.has_ancestor(id, |it| it.kind == Kind::Blockquote)
        {
            // `/\n>\s*$/`
            let trimmed = bun_core::strings::trim_js_whitespace_end(source);
            if let Some(without) = trimmed.strip_suffix(b"\n>") {
                source = without;
            }
        }
        Doc::from(source)
    }

    // ───────────────────────────── text ─────────────────────────────

    /// True if whitespace in `id` can't become a line break, because it's in something that stays on one line.
    fn is_on_single_line(&self, id: NodeId) -> bool {
        self.has_ancestor(id, |node| {
            matches!(node.kind, Kind::TableCell | Kind::Link | Kind::WikiLink)
                || (node.kind == Kind::Heading && (self.is_mdx || !self.is_setext_heading(node)))
        })
    }

    /// Prettier's `isInSentenceWithCJSpaces`
    fn uses_cj_spaces(tokens: &[Token]) -> bool {
        let (mut with_space, mut without) = (0, 0);
        for (index, token) in tokens.iter().enumerate().skip(1) {
            let Some(next) = tokens.get(index + 1) else {
                break;
            };
            let is_between = matches!(
                (tokens[index - 1].kind, next.kind),
                (TokenKind::CjLetter, TokenKind::NonCjk) | (TokenKind::NonCjk, TokenKind::CjLetter)
            );
            match token.kind {
                TokenKind::Space if is_between => with_space += 1,
                TokenKind::NoSpace if is_between => without += 1,
                _ => {}
            }
        }
        with_space > without
    }

    /// Prettier's `lineBreakCanBeConvertedToSpace`
    fn line_break_can_be_space(&self, tokens: &[Token], index: usize) -> bool {
        let (Some(previous), Some(next)) = (
            index.checked_sub(1).and_then(|it| tokens.get(it)),
            tokens.get(index + 1),
        ) else {
            return true;
        };
        let is_non_cjk_or_korean =
            |kind: TokenKind| matches!(kind, TokenKind::NonCjk | TokenKind::KLetter);
        match (previous.kind, next.kind) {
            (a, b) if is_non_cjk_or_korean(a) && is_non_cjk_or_korean(b) => return true,
            (TokenKind::KLetter, TokenKind::CjLetter)
            | (TokenKind::CjLetter, TokenKind::KLetter) => return true,
            (TokenKind::CjkPunctuation, _)
            | (_, TokenKind::CjkPunctuation)
            | (TokenKind::CjLetter, TokenKind::CjLetter) => {
                return false;
            }
            _ => {}
        }
        // Between Chinese or Japanese and something else.
        if self
            .str(next.value)
            .first()
            .is_some_and(u8::is_ascii_punctuation)
            || self
                .str(previous.value)
                .last()
                .is_some_and(u8::is_ascii_punctuation)
        {
            return true;
        }
        if previous.has_trailing_punctuation || next.has_leading_punctuation {
            return false;
        }
        Self::uses_cj_spaces(tokens)
    }

    /// Prettier's `isBreakable`, except for the part that doesn't depend on the whitespace.
    fn is_breakable(tokens: &[Token], index: usize) -> bool {
        let (Some(previous), Some(next)) = (
            index.checked_sub(1).and_then(|it| tokens.get(it)),
            tokens.get(index + 1),
        ) else {
            return true;
        };
        if tokens[index].kind == TokenKind::NoSpace {
            return false;
        }
        if matches!(
            (previous.kind, next.kind),
            (TokenKind::KLetter, TokenKind::CjLetter) | (TokenKind::CjLetter, TokenKind::KLetter)
        ) {
            return true;
        }
        !previous.is_cj() && !next.is_cj()
    }

    /// Prettier's `printWhitespace`. `can_break` means lines are wrapped and this isn't on a single line.
    fn print_whitespace(
        &self,
        tokens: &[Token],
        index: usize,
        prose_wrap: ProseWrap,
        is_link: bool,
        can_break: bool,
    ) -> Whitespace {
        let kind = tokens[index].kind;
        if prose_wrap == ProseWrap::Preserve && kind == TokenKind::Newline {
            return Whitespace::Hardline;
        }
        let can_be_space = kind == TokenKind::Space
            || (kind == TokenKind::Newline
                && (is_link || self.line_break_can_be_space(tokens, index)));
        let is_breakable = prose_wrap == ProseWrap::Always
            && can_break
            && match is_link {
                true => kind != TokenKind::NoSpace,
                false => Self::is_breakable(tokens, index),
            };
        match (is_breakable, can_be_space) {
            (true, true) => Whitespace::Line,
            (true, false) => Whitespace::Softline,
            (false, true) => Whitespace::Text(" "),
            (false, false) => Whitespace::Text(""),
        }
    }

    /// True if a line that starts with `word` could be parsed as something else: a quote, a list, a heading.
    pub(crate) fn may_start_block(word: &[u8]) -> bool {
        match word {
            [b'>', ..] | [b'*' | b'+' | b'-'] => true,
            [b'#', ..] => word.len() <= 6 && word.iter().all(|&byte| byte == b'#'),
            [digits @ .., b')' | b'.'] => {
                !digits.is_empty() && digits.iter().all(u8::is_ascii_digit)
            }
            _ => false,
        }
    }

    fn add_whitespace(parts: &mut FillParts<'a>, whitespace: &Whitespace) {
        match *whitespace {
            Whitespace::Text(text) => parts.content(Doc::from(text)),
            Whitespace::Line => parts.separator(Doc::LINE),
            Whitespace::Softline => parts.separator(Doc::SOFTLINE),
            Whitespace::Hardline => parts.hardline(),
        }
    }

    /// The same for a sentence that hasn't been split into words: it's ASCII, and lines aren't wrapped. Each stretch
    /// that's printed unchanged is a single text here.
    fn print_plain_sentence(&self, node: &Node) -> Doc<'a> {
        let text = self.str(node.value);
        let is_white = |byte: u8| matches!(byte, b'\t' | b'\n' | b' ');
        let is_preserved = self.options.prose_wrap == ProseWrap::Preserve;
        let mut parts = FillParts::new(false);
        // The start of the text that hasn't been printed yet.
        let mut start = 0;
        let mut index = 0;
        // The next line break or tab, and the next two spaces, unless they're before `index`.
        let mut next_break = bun_core::strings::index_of_any(text, b"\n\t").unwrap_or(text.len());
        let mut next_spaces = bun_core::strings::index_of(text, b"  ").unwrap_or(text.len());
        while index < text.len() {
            // The next whitespace that isn't a single space.
            if next_break < index {
                next_break = bun_core::strings::index_of_any(&text[index..], b"\n\t")
                    .map_or(text.len(), |at| index + at);
            }
            if next_spaces < index {
                next_spaces = bun_core::strings::index_of(&text[index..], b"  ")
                    .map_or(text.len(), |at| index + at);
            }
            let rest = &text[index..];
            let line_len = next_break - index;
            let len = line_len.min(next_spaces - index);
            // A space before a line break or a tab belongs to the same whitespace.
            index += len - usize::from(len == line_len && len > 0 && rest[len - 1] == b' ');
            let whitespace_len = text[index..]
                .iter()
                .take_while(|&&byte| is_white(byte))
                .count();
            if whitespace_len == 0 {
                break;
            }
            let (white_start, white_end) = (index, index + whitespace_len);
            index = white_end;
            if whitespace_len == 1 && text[white_start] == b' ' {
                continue;
            }
            if start < white_start {
                parts.content(Doc::from(&text[start..white_start]));
            }
            start = white_end;
            let has_newline =
                bun_core::strings::contains_char(&text[white_start..white_end], b'\n');
            if !has_newline || !is_preserved {
                parts.content(Doc::from(" "));
                continue;
            }
            // The word at the start of the next line, and whether it's that whole line.
            let word = &text[white_end..];
            let word = &word[..word.iter().take_while(|&&byte| !is_white(byte)).count()];
            let after = &text[white_end + word.len()..];
            let after = &after[..after.iter().take_while(|&&byte| is_white(byte)).count()];
            let is_whole_line = white_end + word.len() == text.len()
                || bun_core::strings::contains_char(after, b'\n');
            if Self::may_start_block(word) && !(word == b"-" && is_whole_line) {
                parts.content(Doc::from(" "));
                continue;
            }
            parts.hardline();
            // A line that looks like a setext underline is escaped.
            let is_fake_setext_line = !word.is_empty()
                && is_whole_line
                && (word.iter().all(|&byte| byte == b'=') || word.iter().all(|&byte| byte == b'-'))
                && !node.is_aligned
                && !self.is_mdx;
            if is_fake_setext_line {
                parts.content(Doc::from("\\"));
            }
        }
        if start < text.len() {
            parts.content(Doc::from(&text[start..]));
        }
        parts.finish()
    }

    /// True if `tokens[index]`, or the HTML after `sentence` when `index` is past the end, would stop being part of the
    /// paragraph if wrapping put it at the start of a line. Prettier breaks the line there anyway. A `=` before a long
    /// URL then ends up alone on its line, which turns the lines above it into a heading. A fence turns everything
    /// after it into code.
    fn must_not_start_line(&self, sentence: &Node, tokens: &[Token], index: usize) -> bool {
        let word = match (tokens.get(index), self.node(sentence.next)) {
            (Some(word), _) => self.str(word.value),
            (None, Some(html)) if html.kind == Kind::Html => self.str(html.value),
            _ => return false,
        };
        let word =
            &word[..bun_core::strings::index_of_char_usize(word, b'\n').unwrap_or(word.len())];
        let is_candidate = match word {
            [b'<', ..] | [b'`', b'`', b'`', ..] | [b'~', b'~', b'~', ..] | [b'$', b'$', ..] => true,
            [first @ (b'=' | b'-' | b'_' | b'*'), rest @ ..] => rest.iter().all(|it| it == first),
            _ => false,
        };
        let syntax = match (self.is_mdx, self.options.flavor.is_oxfmt()) {
            (true, _) => Syntax::Mdx,
            (false, true) => Syntax::TwoLines,
            (false, false) => Syntax::MarkdownTwoLines,
        };
        if !is_candidate || !leaves_paragraph(None, word, syntax) {
            return false;
        }
        if leaves_paragraph(None, &[word, b" a"].concat(), syntax) {
            return true;
        }
        // `word` only ends the paragraph if it's alone on its line, which happens if the next word doesn't fit.
        let mut width = self.indentation + word.len();
        let mut at = index + 1;
        while let (Some(_), Some(next)) = (tokens.get(at), tokens.get(at + 1)) {
            let next = self.str(next.value);
            width += 1 + crate::ir::width::string_width_as(next, self.options.flavor) as usize;
            if width > self.options.line_width.value() as usize {
                return true;
            }
            // Keep measuring if the word after `next` can't be wrapped onto a new line.
            let keeps_measuring = match (tokens.get(at + 2), tokens.get(at + 3)) {
                (Some(_), Some(then)) => Self::may_start_block(self.str(then.value)),
                (Some(_), None) => false,
                (None, _) => sentence.next != NONE,
            };
            if !keeps_measuring {
                return false;
            }
            at += 2;
        }
        true
    }

    /// Prettier's `printSentence`
    fn print_sentence(&mut self, id: NodeId, node: &Node) -> Doc<'a> {
        if node.number == preprocess::PLAIN {
            return self.print_plain_sentence(node);
        }
        let tokens = self.tokens(node);
        let can_break = self.options.prose_wrap == ProseWrap::Always && !self.is_on_single_line(id);
        let emphasis =
            self.find_ancestor(id, |it| matches!(it.kind, Kind::Emphasis | Kind::Strong));
        let is_newline =
            |token: Option<&Token>| token.is_some_and(|it| it.kind == TokenKind::Newline);
        let mut parts = FillParts::new(self.options.prose_wrap == ProseWrap::Always);
        for (index, token) in tokens.iter().enumerate() {
            if token.is_word() {
                parts.content(self.print_word(node, tokens, index, emphasis));
                continue;
            }
            let next = tokens.get(index + 1);
            let after_next = tokens.get(index + 2);
            let is_next_fake_setext_line = token.kind == TokenKind::Newline
                && next.is_some_and(|it| self.str(it.value) == b"-")
                && (after_next.is_none() || is_newline(after_next));
            let joins = (next.is_some_and(|it| Self::may_start_block(self.str(it.value)))
                && !after_next.is_some_and(|it| it.kind == TokenKind::NoSpace)
                && !(self.options.prose_wrap == ProseWrap::Preserve && is_next_fake_setext_line))
                || (can_break && self.must_not_start_line(node, tokens, index + 1));
            let prose_wrap = if joins {
                ProseWrap::Never
            } else {
                self.options.prose_wrap
            };
            Self::add_whitespace(
                &mut parts,
                &self.print_whitespace(tokens, index, prose_wrap, false, can_break),
            );
        }
        parts.finish()
    }

    /// Prettier's `printWord`. `emphasis` is the emphasis or strong emphasis that contains it.
    fn print_word(
        &self,
        sentence: &Node,
        tokens: &[Token],
        index: usize,
        emphasis: Option<NodeId>,
    ) -> Doc<'a> {
        let text = self.str(tokens[index].value);
        if self.is_mdx {
            return self.print_word_legacy(sentence, text, index == 0);
        }
        let is_newline =
            |token: Option<&Token>| token.is_some_and(|it| it.kind == TokenKind::Newline);
        let previous = index.checked_sub(1).and_then(|it| tokens.get(it));
        let next = tokens.get(index + 1);
        let Some(emphasis) = emphasis else {
            // A line that looks like a setext underline is escaped: `Previous line↵␣␣␣␣===`.
            let is_fake_setext_line = self.options.prose_wrap == ProseWrap::Preserve
                && (text.iter().all(|&byte| byte == b'=') || text.iter().all(|&byte| byte == b'-'))
                && is_newline(previous)
                && (next.is_none() || is_newline(next));
            return match is_fake_setext_line {
                true => Doc::from([b"\\", text].concat()),
                false => Doc::from(text),
            };
        };
        if bun_core::strings::index_of_any(text, b"*_").is_none() {
            return Doc::from(text);
        }

        let mut units: Vec<u16> = bstr::ByteSlice::chars(text)
            .flat_map(|c| c.encode_utf16(&mut [0; 2]).to_vec())
            .collect();
        // At the very start of the emphasis.
        if index == 0
            && matches!(text[0], b'*' | b'_')
            && sentence.previous == NONE
            && sentence.parent == emphasis
        {
            units.insert(0, u16::from(b'\\'));
        }
        let unit_of = |token: Option<&Token>, is_last: bool| -> Option<u16> {
            let token = token?;
            match token.kind {
                TokenKind::NoSpace => None,
                TokenKind::Space => Some(u16::from(b' ')),
                TokenKind::Newline => Some(u16::from(b'\n')),
                _ => {
                    let value = self.str(token.value);
                    let c = if is_last {
                        last_char(value)?.0
                    } else {
                        first_char(value)?.0
                    };
                    let mut buffer = [0; 2];
                    let encoded = c.encode_utf16(&mut buffer);
                    if is_last {
                        encoded.last().copied()
                    } else {
                        encoded.first().copied()
                    }
                }
            }
        };
        let escaped = escape_delimiter_runs(&units, unit_of(previous, true), unit_of(next, false));
        Doc::from(String::from_utf16_lossy(&escaped).into_bytes())
    }

    /// Prettier's `printWordLegacy`: every `*` is escaped, and `_` at the ends of a word and next to punctuation.
    fn print_word_legacy(&self, sentence: &Node, text: &'a [u8], is_first: bool) -> Doc<'a> {
        if bun_core::strings::index_of_any(text, b"*_").is_none() {
            return Doc::from(text);
        }
        let mut chars: Vec<char> = Vec::with_capacity(text.len() + 4);
        for c in bstr::ByteSlice::chars(text) {
            if c == '*' {
                chars.push('\\');
            }
            chars.push(c);
        }
        // `(^|punctuation)(_+)|(_+)(punctuation|$)`
        let mut escaped = String::with_capacity(chars.len() + 4);
        let run_at = |from: usize| {
            chars[from.min(chars.len())..]
                .iter()
                .take_while(|&&c| c == '_')
                .count()
        };
        let push_escaped = |escaped: &mut String, c: char| {
            if c == '_' {
                escaped.push('\\');
            }
            escaped.push(c);
        };
        let mut index = 0;
        while let Some(&c) = chars.get(index) {
            let len = if index == 0 && c == '_' {
                run_at(0)
            } else if is_punctuation(c) && run_at(index + 1) > 0 {
                1 + run_at(index + 1)
            } else if c == '_' {
                let run = run_at(index);
                match chars.get(index + run) {
                    None => run,
                    Some(&next) if is_punctuation(next) => run + 1,
                    // The last of them is punctuation itself.
                    Some(_) if run > 1 => run,
                    Some(_) => 0,
                }
            } else {
                0
            };
            match len {
                0 => escaped.push(c),
                _ => chars[index..index + len]
                    .iter()
                    .for_each(|&c| push_escaped(&mut escaped, c)),
            }
            index += len.max(1);
        }

        // After an autolink, a backslash would become part of it.
        let parent = self.node(sentence.parent);
        if is_first
            && (self.is_autolink(sentence.previous)
                || parent.is_some_and(|parent| {
                    parent.kind == Kind::Emphasis
                        && sentence.previous == NONE
                        && self.is_autolink(parent.previous)
                }))
        {
            let bytes = escaped.as_bytes();
            let mut prefix = 0;
            loop {
                let marker = prefix + usize::from(bytes.get(prefix) == Some(&b'\\'));
                if !matches!(bytes.get(marker), Some(b'*' | b'_')) {
                    break;
                }
                prefix = marker + 1;
            }
            let rest = escaped.split_off(prefix);
            escaped.retain(|c| c != '\\');
            escaped.push_str(&rest);
        }
        Doc::from(escaped.into_bytes())
    }

    /// The content of a reference whose label is its text: unchanged, except for where its lines break.
    fn print_same_content(&mut self, id: NodeId, node: &Node) -> Doc<'a> {
        let source = self.source(node);
        let mut tokens = Vec::new();
        let start = node.start;
        preprocess::split_text(
            source,
            |from, to| Str::source(start + from as u32, start + to as u32),
            &mut tokens,
        );
        let can_break = self.options.prose_wrap == ProseWrap::Always && !self.is_on_single_line(id);
        let mut parts = FillParts::new(self.options.prose_wrap == ProseWrap::Always);
        for (index, token) in tokens.iter().enumerate() {
            match token.is_word() {
                true => parts.content(Doc::from(self.str(token.value))),
                false => Self::add_whitespace(
                    &mut parts,
                    &self.print_whitespace(
                        &tokens,
                        index,
                        self.options.prose_wrap,
                        true,
                        can_break,
                    ),
                ),
            }
        }
        parts.finish()
    }

    /// Prettier's `prevOrNextWord`: true if a word is right before or after `node`.
    fn has_word_next_to(&self, node: &Node) -> bool {
        // For the word at that end of the sentence `sibling`: whether it has punctuation there, and the character.
        let word = |sibling: NodeId, is_last: bool| -> Option<(bool, char)> {
            let sentence = self.node(sibling).filter(|it| it.kind == Kind::Sentence)?;
            if sentence.number == preprocess::PLAIN {
                let text = self.str(sentence.value);
                let byte = *if is_last { text.last() } else { text.first() }?;
                return (!matches!(byte, b'\t' | b'\n' | b' '))
                    .then_some((byte.is_ascii_punctuation(), byte as char));
            }
            let tokens = self.tokens(sentence);
            let word = if is_last {
                tokens.last()
            } else {
                tokens.first()
            }
            .filter(|token| token.is_word())?;
            let value = self.str(word.value);
            match is_last {
                true => Some((word.has_trailing_punctuation, last_char(value)?.0)),
                false => Some((word.has_leading_punctuation, first_char(value)?.0)),
            }
        };
        let is_word = |it: (bool, char)| {
            let is_punctuation = match self.options.flavor.is_oxfmt() {
                // oxfmt asks its parser, which counts symbols as punctuation.
                true => bun_md::helpers::is_unicode_punctuation(it.1 as u32),
                false => it.0,
            };
            !is_punctuation && !is_commonmark_whitespace(it.1)
        };
        word(node.previous, true).is_some_and(is_word)
            || word(node.next, false).is_some_and(is_word)
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// Prettier's `printUrl`. `is_in_parentheses` means it can't contain an unescaped `)`.
    fn print_url(&self, url: &'a [u8], is_in_parentheses: bool) -> Doc<'a> {
        if url.is_empty() && !self.is_mdx {
            return Doc::from("<>");
        }
        if self.options.flavor.is_oxfmt() {
            return Doc::from(oxfmt_url(url, is_in_parentheses));
        }
        let is_dangerous = bun_core::strings::contains_char(url, b' ')
            || (is_in_parentheses && bun_core::strings::contains_char(url, b')'));
        if !is_dangerous {
            return Doc::from(url);
        }
        let mut encoded = Vec::with_capacity(url.len() + 2);
        encoded.push(b'<');
        for &byte in url {
            match byte {
                b'<' => encoded.extend_from_slice(b"%3C"),
                b'>' => encoded.extend_from_slice(b"%3E"),
                _ => encoded.push(byte),
            }
        }
        encoded.push(b'>');
        Doc::from(encoded)
    }

    /// Prettier's `printTitle`
    fn print_title(&self, title: Str, has_space: bool) -> Doc<'a> {
        let mut title = Cow::Borrowed(self.str(title));
        if title.is_empty() {
            return Doc::EMPTY;
        }
        // `title.replaceAll(/\\(?=["')])/g, "")`
        if self.is_mdx && bun_core::strings::contains_char(&title, b'\\') {
            let is_kept = |it: &(usize, &u8)| {
                *it.1 != b'\\' || !matches!(title.get(it.0 + 1), Some(b'"' | b'\'' | b')'))
            };
            title = Cow::Owned(
                title
                    .iter()
                    .enumerate()
                    .filter(is_kept)
                    .map(|it| *it.1)
                    .collect(),
            );
        }
        let title = &title[..];
        let has = |byte: u8| bun_core::strings::contains_char(title, byte);
        let mut printed = Vec::with_capacity(title.len() + 3);
        if has_space {
            printed.push(b' ');
        }
        if self.options.flavor.is_oxfmt() {
            let is_in_parentheses = has(b'"') && has(b'\'') && !has(b'(') && !has(b')');
            let (preferred, alternate) = match self.options.quote_style.is_double() {
                true => (b'"', b'\''),
                false => (b'\'', b'"'),
            };
            let count = |quote: u8| bun_core::strings::count_char(title, quote);
            let (open, close) = match count(preferred) > count(alternate) {
                _ if is_in_parentheses => (b'(', b')'),
                true => (alternate, alternate),
                false => (preferred, preferred),
            };
            printed.push(open);
            for (index, &byte) in title.iter().enumerate() {
                let is_escaped = match byte {
                    b'\\' => true,
                    b'&' => character_reference(&title[index..], None).is_some(),
                    _ => byte == open && !is_in_parentheses,
                };
                if is_escaped {
                    printed.push(b'\\');
                }
                printed.push(byte);
            }
            printed.push(close);
            // In a definition a title's lines are printed as is.
            if !has_space || !has(b'\n') {
                return Doc::from(printed);
            }
            let mut lines = Vec::new();
            for (index, line) in bun_core::strings::split(&printed, b"\n").enumerate() {
                if index > 0 {
                    lines.push(verbatim_line());
                }
                lines.push(Doc::from(line.to_vec()));
            }
            return Doc::Array(lines);
        }
        if has(b'"') && has(b'\'') && !has(b')') {
            printed.push(b'(');
            printed.extend_from_slice(title);
            printed.push(b')');
            return Doc::from(printed);
        }
        let (preferred, alternate) = match self.options.quote_style.is_double() {
            true => (b'"', b'\''),
            false => (b'\'', b'"'),
        };
        let count = |quote: u8| bun_core::strings::count_char(title, quote);
        let quote = if count(preferred) > count(alternate) {
            alternate
        } else {
            preferred
        };
        printed.push(quote);
        for &byte in title {
            if byte == b'\\' || byte == quote {
                printed.push(b'\\');
            }
            printed.push(byte);
        }
        printed.push(quote);
        Doc::from(printed)
    }

    /// Prettier's `printLinkReference`: `[label]`
    fn print_label(&self, label: Str) -> Doc<'a> {
        let label = self.str(label);
        let mut printed = Vec::with_capacity(label.len() + 2);
        printed.push(b'[');
        // The collapse-white-space package: every run of whitespace becomes a space.
        let mut rest = label;
        while !rest.is_empty() {
            let trimmed = bun_core::strings::trim_js_whitespace_start(rest);
            if trimmed.len() < rest.len() {
                printed.push(b' ');
                rest = trimmed;
                continue;
            }
            let len = first_char(rest).map_or(1, |it| it.1);
            if matches!(rest[0], b'\\' | b'[' | b']') {
                printed.push(b'\\');
            }
            printed.extend_from_slice(&rest[..len]);
            rest = &rest[len..];
        }
        printed.push(b']');
        Doc::from(printed)
    }

    /// Prettier's `getBracketContent`: the text between `node`'s first `[` and the `]` that closes it.
    fn bracket_content(&self, node: &Node) -> Option<&'a [u8]> {
        let source = self.source(node);
        let first = bun_core::strings::index_of_char_usize(source, b'[')?;
        let (mut depth, mut index) = (1, first + 1);
        while let Some(&byte) = source.get(index) {
            match byte {
                b'\\' => {
                    // The character after it, however many bytes it takes.
                    index += 1 + first_char(&source[(index + 1).min(source.len())..])
                        .map_or(1, |it| it.1);
                    continue;
                }
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(&source[first + 1..index]);
                    }
                }
                _ => {}
            }
            index += 1;
        }
        None
    }

    fn print_image_alt(&self, node: &Node) -> Doc<'a> {
        if self.options.flavor.is_oxfmt() {
            return replace_end_of_line(self.str(node.third), verbatim_line);
        }
        match self
            .bracket_content(node)
            .filter(|it| !it.is_empty() && !self.is_mdx)
        {
            Some(alt) => Doc::from(alt),
            None => Doc::from(self.str(node.third)),
        }
    }

    // ───────────────────────────── nodes ─────────────────────────────

    /// True if `node`, an emphasis or a strong emphasis, has another of its kind right before or after it, or is at an
    /// end of one that does. Prettier gives both the same marker: `*a*_b_` becomes `_a__b_`, which is one emphasis, and
    /// `**a**__b__` becomes `**a****b**`.
    fn keeps_marker(&self, mut node: &'a Node) -> bool {
        loop {
            let is_same_kind =
                |id: NodeId| self.node(id).is_some_and(|other| other.kind == node.kind);
            if is_same_kind(node.previous) || is_same_kind(node.next) {
                return true;
            }
            match self.node(node.parent) {
                Some(parent)
                    if parent.kind == node.kind && (node.previous == NONE || node.next == NONE) =>
                {
                    node = parent;
                }
                _ => return false,
            }
        }
    }

    /// True if a `*` delimiter of `node`, an emphasis, touches a literal `*`, and the text around `node` has another
    /// `*` run that the literal one could pair with. In `**a*(*)` the first and last `*` are literal because the run of
    /// two and the run of one add up to three. Printed as `*_a_(*)`, they would pair up.
    fn is_cut_from_longer_run(&self, node: &Node) -> bool {
        let byte_at = |at: usize| self.original.get(at).copied();
        let is_text = |id: NodeId| matches!(self.kind(id), Some(Kind::Sentence | Kind::Text));
        let (start, end) = (node.start as usize, node.end as usize);
        let is_in_run = (start > 0 && byte_at(start - 1) == Some(b'*') && is_text(node.previous))
            || (byte_at(end) == Some(b'*') && is_text(node.next));
        if self.is_mdx || byte_at(start) != Some(b'*') || !is_in_run {
            return false;
        }
        let is_star = |byte: &&u8| **byte == b'*';
        let (before, after) = self.original.split_at_checked(start).unwrap_or_default();
        let run_start = start - before.iter().rev().take_while(is_star).count();
        let after = after.get(end - start..).unwrap_or_default();
        let run_end = end + after.iter().take_while(is_star).count();
        let is_whitespace_or_edge =
            |byte: Option<u8>| matches!(byte, None | Some(b' ' | b'\t' | b'\n'));
        self.tree
            .children(node.parent)
            .filter(|&id| is_text(id))
            .any(|sibling| {
                let Some(sibling) = self.node(sibling) else {
                    return false;
                };
                let mut is_escaped = false;
                (sibling.start as usize..sibling.end as usize).any(|at| {
                    let is_other_star = byte_at(at) == Some(b'*')
                        && !is_escaped
                        && !(run_start..run_end).contains(&at)
                        && !(is_whitespace_or_edge(at.checked_sub(1).and_then(byte_at))
                            && is_whitespace_or_edge(byte_at(at + 1)));
                    is_escaped = byte_at(at) == Some(b'\\') && !is_escaped;
                    is_other_star
                })
            })
    }

    /// Prettier's `printMdast`
    fn print_mdast(&mut self, id: NodeId, node: &'a Node) -> Doc<'a> {
        if self.is_in_label {
            return self.print_same_content(id, node);
        }
        match node.kind {
            Kind::Root => match node.first_child {
                NONE => Doc::EMPTY,
                _ => docs![self.print_root(id), hardline()],
            },
            Kind::FrontMatter => self.print_front_matter(node),
            Kind::Paragraph => {
                let mut parts = FillParts::new(self.options.prose_wrap == ProseWrap::Always);
                let mut child = node.first_child;
                while let Some(next) = self.node(child).map(|it| it.next) {
                    let doc = self.print(child);
                    parts.flatten(doc);
                    child = next;
                }
                match self.would_be_front_matter(node) {
                    true => docs!["\\", parts.finish()],
                    false => parts.finish(),
                }
            }
            Kind::Sentence => self.print_sentence(id, node),
            Kind::Emphasis => {
                let style: &'a [u8] = if self.is_autolink(node.first_child)
                    || self.keeps_marker(node)
                    || self.is_cut_from_longer_run(node)
                {
                    self.source(node).get(..1).unwrap_or(b"_")
                } else {
                    let is_in_strong_next_to_word = self.node(node.parent).is_some_and(|parent| {
                        parent.kind == Kind::Strong && self.has_word_next_to(parent)
                    });
                    let needs_asterisk = self.has_word_next_to(node)
                        || is_in_strong_next_to_word
                        || self.has_ancestor(id, |it| it.kind == Kind::Emphasis);
                    if needs_asterisk { b"*" } else { b"_" }
                };
                docs![style, self.print_children(id), style]
            }
            Kind::Strong => {
                let style: &'a [u8] = match self.keeps_marker(node) {
                    true => self.source(node).get(..2).unwrap_or(b"**"),
                    false => b"**",
                };
                docs![style, self.print_children(id), style]
            }
            Kind::Delete => docs!["~~", self.print_children(id), "~~"],
            Kind::InlineCode => self.print_inline_code(id, node),
            Kind::WikiLink => {
                let value = self.str(node.value);
                let has_tab_or_line_break =
                    bun_core::strings::index_of_any(value, b"\t\n").is_some();
                if self.options.prose_wrap == ProseWrap::Preserve || !has_tab_or_line_break {
                    return docs!["[[", value, "]]"];
                }
                let mut contents = Vec::with_capacity(value.len());
                for &byte in value {
                    match byte {
                        b'\t' | b'\n' if contents.last() == Some(&0) => {}
                        b'\t' | b'\n' => contents.push(0),
                        _ => contents.push(byte),
                    }
                }
                contents
                    .iter_mut()
                    .filter(|byte| **byte == 0)
                    .for_each(|byte| *byte = b' ');
                docs!["[[", contents, "]]"]
            }
            Kind::Link => match self.source(node).first() {
                Some(b'<') => {
                    let url = self.str(node.value);
                    // `<hello@example.com>` has the URL `mailto:hello@example.com`.
                    let url = match url.strip_prefix(b"mailto:") {
                        Some(address) if !self.source(node)[1..].starts_with(b"mailto:") => address,
                        _ => url,
                    };
                    docs!["<", url, ">"]
                }
                Some(b'[') => docs![
                    "[",
                    self.print_children(id),
                    "](",
                    self.print_url(self.str(node.value), true),
                    self.print_title(node.second, true),
                    ")"
                ],
                _ => Doc::from(self.source(node)),
            },
            Kind::Image => docs![
                "![",
                self.print_image_alt(node),
                "](",
                self.print_url(self.str(node.value), true),
                self.print_title(node.second, true),
                ")"
            ],
            Kind::Blockquote => {
                let children = self.indented(2, |printer| printer.print_children(id));
                let children = self.content_of_container(children);
                docs!["> ", Doc::Align(Alignment::Text("> "), Box::new(children))]
            }
            Kind::Heading => {
                let children = self.print_children(id);
                // In MDX a setext heading is printed as `## text`. That form ends at the first line break, so a heading
                // that still has one keeps its underline. Prettier never gets here: remark-parse 8 reads two lines of
                // text above `---` as a paragraph and a thematic break.
                if self.is_setext_heading(node) && (!self.is_mdx || has_line_break(&children)) {
                    let last_line = &self.original[self.tree.line_start(node.end.saturating_sub(1))
                        as usize
                        ..node.end as usize];
                    let find =
                        |marker: u8| bun_core::strings::index_of_char_usize(last_line, marker);
                    let underline = &last_line[find(b'=')
                        .max(find(b'-'))
                        .unwrap_or_else(|| last_line.len().saturating_sub(1))..];
                    return docs![children, hardline(), underline];
                }
                docs![
                    [&b"######"[..node.number.min(6) as usize], b" "].concat(),
                    children
                ]
            }
            Kind::Code => self.print_code(id, node, None),
            Kind::Html => {
                let mut value = self.str(node.value);
                if self.kind(node.parent) == Some(Kind::Root) && node.next == NONE {
                    value = bun_core::strings::trim_js_whitespace_end(value);
                }
                if self.options.flavor.is_oxfmt() {
                    value = value.strip_suffix(b"\n").unwrap_or(value);
                }
                let is_comment =
                    value.len() >= 7 && value.starts_with(b"<!--") && value.ends_with(b"-->");
                // In inline content, what follows it is measured from its last line break on.
                match (
                    self.kind(node.parent).is_some_and(Self::is_inline_wrapper),
                    is_comment,
                ) {
                    (false, _) => self.lines(value, !is_comment),
                    (true, _) if self.options.flavor.is_oxfmt() => {
                        replace_end_of_line(value, verbatim_line)
                    }
                    (true, true) => replace_end_of_line(value, hardline),
                    (true, false) => replace_end_of_line(value, || mark_as_root(literalline())),
                }
            }
            Kind::List => self.print_list(id, node),
            Kind::ListItem | Kind::TableRow => Doc::EMPTY,
            Kind::Import | Kind::Export | Kind::Jsx => Doc::from(
                bun_core::strings::trim_js_whitespace_end(self.str(node.value)),
            ),
            Kind::EsComment => docs!["{/* ", self.str(node.value), " */}"],
            Kind::ThematicBreak => {
                let uses_asterisks = match self.find_ancestor(id, |it| it.kind == Kind::List) {
                    Some(list) => !self.uses_alternate_marker(list),
                    // oxfmt: at the start of a document `---` would start front matter.
                    None => {
                        self.options.flavor.is_oxfmt()
                            && self.kind(node.parent) == Some(Kind::Root)
                            && self
                                .kind(node.previous)
                                .is_none_or(|it| it == Kind::FrontMatter)
                    }
                };
                Doc::from(if uses_asterisks { "***" } else { "---" })
            }
            Kind::LinkReference => {
                let is_in_label = node.reference_type != ReferenceType::Full;
                let was_in_label = std::mem::replace(&mut self.is_in_label, is_in_label);
                let children = self.print_children(id);
                self.is_in_label = was_in_label;
                docs![
                    "[",
                    children,
                    "]",
                    match node.reference_type {
                        ReferenceType::Full => self.print_label(node.value),
                        ReferenceType::Collapsed => Doc::from("[]"),
                        ReferenceType::Shortcut => Doc::EMPTY,
                    }
                ]
            }
            Kind::ImageReference => match node.reference_type {
                ReferenceType::Full => docs![
                    "![",
                    self.print_image_alt(node),
                    "]",
                    self.print_label(node.value)
                ],
                ReferenceType::Collapsed if self.is_mdx => {
                    docs!["![", self.print_image_alt(node), "][]"]
                }
                ReferenceType::Shortcut if self.is_mdx => {
                    docs!["![", self.print_image_alt(node), "]"]
                }
                ReferenceType::Collapsed => docs!["!", self.print_label(node.value), "[]"],
                ReferenceType::Shortcut => docs!["!", self.print_label(node.value)],
            },
            Kind::Definition => {
                let line_or_space = || match self.options.prose_wrap {
                    ProseWrap::Always => Doc::LINE,
                    _ => Doc::from(" "),
                };
                let title = match node.second.is_null() {
                    true => Doc::EMPTY,
                    false => docs![line_or_space(), self.print_title(node.second, false)],
                };
                group(docs![
                    self.print_label(node.third),
                    ":",
                    indent(docs![
                        line_or_space(),
                        self.print_url(self.str(node.value), false),
                        title
                    ])
                ])
            }
            Kind::FootnoteReference => docs!["[^", self.str(node.value), "]"],
            // oxfmt's `Block::ContainerDirective`: the two lines are printed verbatim. An empty line after the first
            // and before the second is kept.
            Kind::Directive => {
                let gap = |is_empty_line: bool| match is_empty_line {
                    true => docs![hardline(), hardline()],
                    false => hardline(),
                };
                let opening_line = self.start_line(node);
                let opening = self.str(node.value);
                let mut parts = vec![Doc::from(opening)];
                let mut last_line = opening_line;
                if let (Some(first), Some(last)) =
                    (self.node(node.first_child), self.node(node.last_child))
                {
                    let is_empty_line = self.start_line(first) > opening_line + 1;
                    // Its trailing whitespace stays.
                    match opening.ends_with(b" ") || opening.ends_with(b"\t") {
                        true if is_empty_line => {
                            parts.push(docs![mark_as_root(literalline()), hardline()]);
                        }
                        true => parts.push(mark_as_root(literalline())),
                        false => parts.push(gap(is_empty_line)),
                    }
                    last_line = self.end_line(last);
                    parts.push(self.print_children(id));
                }
                if !node.second.is_null() {
                    parts.push(gap(self.end_line(node) > last_line + 1));
                    parts.push(Doc::from(self.str(node.second)));
                }
                Doc::Array(parts)
            }
            Kind::FootnoteDefinition => {
                let only_paragraph = self.node(node.first_child).filter(|child| {
                    child.kind == Kind::Paragraph && node.first_child == node.last_child
                });
                let is_inline =
                    only_paragraph.is_some_and(|paragraph| match self.options.prose_wrap {
                        ProseWrap::Never if self.options.flavor.is_oxfmt() => {
                            !self.has_hard_break(node.first_child)
                        }
                        ProseWrap::Never => true,
                        ProseWrap::Preserve => {
                            self.start_line(paragraph) == self.end_line(paragraph)
                        }
                        ProseWrap::Always => false,
                    });
                let children = match is_inline {
                    true => self.print_children(id),
                    false => {
                        let first = node.first_child;
                        let children = self.indented(4, |printer| {
                            printer.print_children_with(id, |printer, child| {
                                let doc = printer.print(child);
                                Some(if child == first {
                                    group(docs![Doc::SOFTLINE, doc])
                                } else {
                                    doc
                                })
                            })
                        });
                        group(align_with_spaces(4, children))
                    }
                };
                docs!["[^", self.str(node.value), "]: ", children]
            }
            Kind::Table => self.print_table(id, node),
            Kind::TableCell => self.print_children(id),
            Kind::Break => match self.source(node).first() {
                Some(b'\\') => docs!["\\", hardline()],
                _ => docs!["  ", mark_as_root(literalline())],
            },
            Kind::LiquidNode | Kind::Text => replace_end_of_line(self.str(node.value), hardline),
            Kind::Math => {
                let value = self.str(node.value);
                docs![
                    "$$",
                    match node.third.is_null() || self.str(node.third).is_empty() {
                        true => Doc::EMPTY,
                        false => docs![" ", self.str(node.third)],
                    },
                    hardline(),
                    match value.is_empty() {
                        true => Doc::EMPTY,
                        false => docs![replace_end_of_line(value, hardline), hardline()],
                    },
                    "$$"
                ]
            }
            Kind::InlineMath => Doc::from(self.source(node)),
        }
    }

    fn print_inline_code(&self, id: NodeId, node: &Node) -> Doc<'a> {
        let value = self.str(node.value);
        let mut code = Cow::Borrowed(value);
        if self.options.prose_wrap != ProseWrap::Preserve
            && bun_core::strings::contains_char(value, b'\n')
        {
            code = Cow::Owned(
                value
                    .iter()
                    .map(|&byte| if byte == b'\n' { b' ' } else { byte })
                    .collect(),
            );
        }
        if !self.is_mdx
            && bun_core::strings::contains_char(&code, b'|')
            && self.has_ancestor(id, |it| it.kind == Kind::TableCell)
        {
            let mut escaped = Vec::with_capacity(code.len() + 4);
            for &byte in code.iter() {
                if byte == b'|' {
                    escaped.push(b'\\');
                }
                escaped.push(byte);
            }
            code = Cow::Owned(escaped);
        }
        let backticks = vec![b'`'; min_not_present_continuous_count(&code, b'`')];
        let is_space_or_line_break = |byte: &u8| matches!(byte, b'\n' | b' ');
        let needs_padding = code.first() == Some(&b'`')
            || code.last() == Some(&b'`')
            || (code.first().is_some_and(is_space_or_line_break)
                && code.last().is_some_and(is_space_or_line_break)
                && !code.iter().all(is_space_or_line_break));
        let padding = if needs_padding { " " } else { "" };
        if self.options.flavor.is_oxfmt() && bun_core::strings::contains_char(&code, b'\n') {
            let mut lines = Vec::new();
            for (index, line) in bun_core::strings::split(&code, b"\n").enumerate() {
                if index > 0 {
                    lines.push(verbatim_line());
                }
                lines.push(Doc::from(line.to_vec()));
            }
            return docs![
                backticks.clone(),
                padding,
                Doc::Array(lines),
                padding,
                backticks
            ];
        }
        docs![backticks.clone(), padding, code, padding, backticks]
    }

    /// The text after the opening fence of the code block `node`.
    fn print_info(&self, node: &Node) -> Doc<'a> {
        let part = |text: Str| -> Doc<'a> {
            let text = self.str(text);
            if !self.options.flavor.is_oxfmt() || !bun_core::strings::contains_char(text, b'\\') {
                return Doc::from(text);
            }
            // oxfmt: otherwise it would escape what follows it when the output is parsed again.
            let mut escaped = Vec::with_capacity(text.len() + 2);
            for &byte in text {
                if byte == b'\\' {
                    escaped.push(b'\\');
                }
                escaped.push(byte);
            }
            Doc::from(escaped)
        };
        docs![
            part(node.second),
            if self.str(node.third).is_empty() {
                Doc::EMPTY
            } else {
                docs![" ", part(node.third)]
            }
        ]
    }

    /// The fence character of the code block `node`.
    fn fence_unit(&self, node: &Node) -> u8 {
        // A backtick fence can't have a backtick in its info string. Prettier prints one anyway and breaks the fence.
        let has_backtick = |text: Str| bun_core::strings::contains_char(self.str(text), b'`');
        let is_backtick_in_info = has_backtick(node.second) || has_backtick(node.third);
        if self.is_in_template || is_backtick_in_info {
            b'~'
        } else {
            b'`'
        }
    }

    /// Prints `code` verbatim. Trailing spaces and tabs are part of the code. Prettier and oxfmt put a `hardline` after
    /// every line, which trims them.
    fn verbatim_code(&self, code: &'a [u8], is_indented: bool) -> Doc<'a> {
        if !is_indented
            && self.indentation == 0
            && !self.is_in_template
            && !self.options.is_in_markdown
        {
            return Doc::from(code);
        }
        let mut parts = Vec::new();
        let mut previous: &[u8] = b"";
        for (index, line) in bun_core::strings::split(code, b"\n").enumerate() {
            if index > 0 {
                parts.push(line_break_after(previous));
            }
            parts.push(Doc::from(line));
            previous = line;
        }
        Doc::Array(parts)
    }

    /// `formatted` is set if the code was formatted. It's the code, including the line break after it, and the length
    /// of the longest run of the fence character in it.
    fn print_code(&self, id: NodeId, node: &Node, formatted: Option<(Doc<'a>, usize)>) -> Doc<'a> {
        let value = self.str(node.value);
        if formatted.is_none() && is_indented_code(self.original, self.tree, id) {
            // Whatever is printed next starts with a `hardline`, which would trim the last line. A last line that is
            // only whitespace isn't part of the code, so trimming it is fine.
            let end = match &value[value.trim_ascii_end().len()..] {
                b"" => Doc::EMPTY,
                trailing_whitespace
                    if bun_core::strings::contains_char(trailing_whitespace, b'\n') =>
                {
                    Doc::EMPTY
                }
                _ => Doc::KeepTrailingWhitespace,
            };
            let code = docs!["    ", self.verbatim_code(value, true), end];
            return align_with_spaces(4, code);
        }
        let style_unit = self.fence_unit(node);
        let (code, run) = match formatted {
            Some(formatted) => formatted,
            None => (
                docs![self.verbatim_code(value, false), line_break_after(value)],
                max_continuous_count(value, style_unit),
            ),
        };
        let style = vec![style_unit; (run + 1).max(3)];
        docs![
            style.clone(),
            self.print_info(node),
            hardline(),
            code,
            style
        ]
    }

    /// Prettier's `embed`
    fn print_embedded(&mut self, id: NodeId, node: &Node) -> Option<Doc<'a>> {
        if matches!(node.kind, Kind::Import | Kind::Export | Kind::Jsx) {
            let code = self.str(node.value);
            let formatted = (self.embed)(&Embedded {
                language: if node.kind == Kind::Jsx {
                    super::MDX_JSX
                } else {
                    super::MDX_ES_SYNTAX
                },
                code,
                width: (self.options.line_width.value() as usize).saturating_sub(self.indentation),
            })?;
            return Some(lines_of(bun_core::strings::trim_js_whitespace_end(
                &formatted,
            )));
        }
        if node.kind != Kind::Code || node.second.is_null() {
            return None;
        }
        let language = self.str(node.second);
        if language.is_empty() {
            return None;
        }
        let width = (self.options.line_width.value() as usize).saturating_sub(self.indentation);
        let code = self.str(node.value);
        let is_oxfmt = self.options.flavor.is_oxfmt();
        if is_oxfmt {
            // Formatting would move the lines that the numbers refer to.
            if has_line_ranges(self.str(node.third)) {
                return None;
            }
            // Only whitespace, in a language that gets formatted: print an empty line.
            if bun_core::strings::trim_js_whitespace_end(code).is_empty()
                && super::oxfmt_parser_for(language).is_some()
            {
                let style = vec![self.fence_unit(node); 3];
                return Some(docs![
                    style.clone(),
                    self.print_info(node),
                    hardline(),
                    hardline(),
                    style
                ]);
            }
        }
        let formatted = (self.embed)(&Embedded {
            language,
            code,
            width,
        })?;
        let formatted = super::front_matter::trim_end_to_last_line(&formatted);
        let end = line_break_after(formatted);
        // Prettier only measures the original code. Embedded Markdown that had `~~~` fences has backtick fences now.
        let unit = self.fence_unit(node);
        let run = match is_oxfmt {
            true => max_continuous_count(formatted, unit),
            false => max_continuous_count(formatted, unit).max(max_continuous_count(code, unit)),
        };
        let is_verbatim = self.indentation == 0
            && !self.is_in_template
            && !self.options.is_in_markdown
            && !bun_core::strings::contains_char(formatted, b'\r');
        let formatted = if is_verbatim {
            Doc::from(formatted.to_vec())
        } else {
            lines_of(formatted)
        };
        Some(mark_as_root(self.print_code(
            id,
            node,
            Some((docs![formatted, end], run)),
        )))
    }

    /// Prettier's `printEmbedFrontMatter`
    fn print_front_matter(&mut self, node: &Node) -> Doc<'a> {
        let raw = &self.original[..node.end as usize];
        let Some(front_matter) = super::front_matter::parse(self.original) else {
            return Doc::from(raw);
        };
        let language =
            &self.original[front_matter.explicit_language.0..front_matter.explicit_language.1];
        let is_toml = language == b"toml" || (language.is_empty() && raw.starts_with(b"+++"));
        let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
        let value = &self.original[front_matter.value.0..front_matter.value.1];
        let value = super::front_matter::trim_end_to_last_line(
            bun_core::strings::trim_js_whitespace_start(value),
        );
        let formatted = match value {
            b"" if is_yaml || is_toml => (self.embed)(&Embedded {
                language: b"",
                code: b"",
                width: 0,
            }),
            _ if super::front_matter::has_indented_delimiter(raw) => None,
            _ if is_yaml => (self.embed)(&Embedded {
                language: b"yaml",
                code: value,
                width: self.options.line_width.value() as usize,
            }),
            _ => None,
        };
        let Some(formatted) = formatted else {
            return Doc::from(raw);
        };
        let formatted = super::front_matter::trim_end_to_last_line(&formatted);
        mark_as_root(docs![
            &raw[..3],
            language,
            hardline(),
            match formatted.is_empty() {
                true => Doc::EMPTY,
                false => docs![lines_of(formatted), line_break_after(formatted)],
            },
            &raw[raw.len() - 3..]
        ])
    }

    /// Prettier's `printRoot`: everything between `<!-- prettier-ignore-start -->` and `<!-- prettier-ignore-end -->`
    /// is left as is.
    fn print_root(&mut self, root: NodeId) -> Doc<'a> {
        let mut ranges: Vec<(NodeId, NodeId)> = Vec::new();
        let mut start = None;
        for child in self.tree.children(root) {
            match self.prettier_ignore(child) {
                Some(Ignore::Start) if start.is_none() => start = Some(child),
                Some(Ignore::End) => ranges.extend(start.take().map(|start| (start, child))),
                _ => {}
            }
        }
        let mut ranges = ranges.into_iter().peekable();
        let mut is_in_range = false;
        self.print_children_with(root, |printer, child| {
            if let Some(&(start, end)) = ranges.peek() {
                if child == start {
                    is_in_range = true;
                    let (start, end) = (printer.node(start)?, printer.node(end)?);
                    // Prettier's `printIgnoreComment`
                    let comment = |node: &Node| match printer.node(node.first_child) {
                        Some(comment) => docs!["{/* ", printer.str(comment.value), " */}"],
                        None => Doc::from(printer.str(node.value)),
                    };
                    return Some(docs![
                        comment(start),
                        &printer.original[start.end as usize..end.start as usize],
                        comment(end)
                    ]);
                }
                if child == end {
                    is_in_range = false;
                    ranges.next();
                    return None;
                }
                if is_in_range {
                    return None;
                }
            }
            Some(printer.print(child))
        })
    }

    // ───────────────────────────── lists ─────────────────────────────

    /// Prettier's `hasGitDiffFriendlyOrderedList`: `1. 1. 1.` or `0. 0. 0.`
    fn is_git_diff_friendly(&self, list: &Node) -> bool {
        let number = |item: NodeId| ordered_item_info(self.original, self.tree, item).0;
        let first = list.first_child;
        let Some(second) = self
            .node(first)
            .map(|it| it.next)
            .filter(|&it| it != NONE && list.ordered)
        else {
            return false;
        };
        if number(second) != 1 {
            return false;
        }
        if number(first) != 0 {
            return true;
        }
        self.node(second)
            .map(|it| it.next)
            .is_some_and(|third| third != NONE && number(third) == 1)
    }

    /// Prettier's `printList`
    fn print_list(&mut self, id: NodeId, list: &'a Node) -> Doc<'a> {
        let uses_alternate_marker = self.uses_alternate_marker(id);
        let is_git_diff_friendly = self.is_git_diff_friendly(list);
        // Before indented code, the content has to be indented deeper than the code.
        let min_indent = match self
            .node(list.next)
            .filter(|_| is_indented_code(self.original, self.tree, list.next))
        {
            Some(code) => {
                let leading_whitespace = self
                    .str(code.value)
                    .iter()
                    .take_while(|byte| matches!(byte, b' ' | b'\t'));
                4 + leading_whitespace
                    .map(|&byte| if byte == b'\t' { 4 } else { 1 })
                    .sum::<usize>()
                    + 1
            }
            None => 0,
        };
        let tab_width = (self.options.indent_width.value() as usize).max(1);
        let mut index = 0u64;
        self.print_children_with(id, |printer, item| {
            let mut prefix: Vec<u8> = match list.ordered {
                true => {
                    let number = match index {
                        0 => u64::from(list.number),
                        _ if is_git_diff_friendly => 1,
                        _ if printer.is_mdx => u64::from(list.number) + index,
                        _ => (u64::from(list.number) + index).min(999_999_999),
                    };
                    let mut prefix = number.to_string().into_bytes();
                    prefix.extend_from_slice(if uses_alternate_marker { b") " } else { b". " });
                    prefix
                }
                false => (if uses_alternate_marker { b"* " } else { b"- " }).to_vec(),
            };
            index += 1;
            if (list.is_aligned || (printer.is_mdx && list.checked != 0)) && list.ordered {
                // Prettier's `alignListPrefix`. Four or more would make it indented code.
                let additional = (tab_width - prefix.len() % tab_width) % tab_width;
                prefix.resize(
                    prefix.len() + if additional >= 4 { 0 } else { additional },
                    b' ',
                );
            }
            if prefix.len() < min_indent && !printer.is_mdx {
                prefix.truncate(prefix.trim_ascii_end().len());
                let trailing = (min_indent - prefix.len()).min(4);
                prefix.resize(prefix.len() + trailing, b' ');
                let leading = (min_indent - prefix.len()).min(3);
                prefix.splice(0..0, std::iter::repeat_n(b' ', leading));
            }

            let node = printer.node(item)?;
            let (first, second) = (
                printer.node(node.first_child),
                printer.node(node.last_child),
            );
            let is_html_out_of_line = !printer.options.flavor.is_oxfmt()
                && matches!((first, second), (Some(first), Some(second))
                if first.next == node.last_child
                    && second.kind == Kind::Html
                    && printer.column(first.start) != printer.column(second.start));
            let len = prefix.len();
            if is_html_out_of_line {
                return Some(docs![prefix, printer.print_list_item(item, node, len)]);
            }
            let contents =
                printer.indented(len, |printer| printer.print_list_item(item, node, len));
            let contents = printer.content_of_container(contents);
            Some(docs![prefix, align_with_spaces(len as u32, contents)])
        })
    }

    /// oxfmt: see `verbatim_line`.
    fn content_of_container(&self, contents: Doc<'a>) -> Doc<'a> {
        match self.options.flavor.is_oxfmt() {
            true => mark_as_root(contents),
            false => contents,
        }
    }

    /// Prettier's `printListItem`
    fn print_list_item(&mut self, id: NodeId, item: &Node, list_prefix_len: usize) -> Doc<'a> {
        let prefix = match item.checked {
            0 => "",
            1 => "[ ] ",
            _ => "[x] ",
        };
        let first = item.first_child;
        let tab_width = self.options.indent_width.value() as usize;
        let children = self.print_children_with(id, |printer, child| {
            let kind = printer.kind(child)?;
            // oxfmt: HTML goes in the column of the item's content, like indented code.
            if kind == Kind::Html && child != first && printer.options.flavor.is_oxfmt() {
                return Some(printer.print(child));
            }
            if (child == first && kind != Kind::List) || (kind == Kind::Html && !printer.is_mdx) {
                let doc = printer.indented(prefix.len(), |printer| printer.print(child));
                return Some(align_with_spaces(prefix.len() as u32, doc));
            }
            if is_indented_code(printer.original, printer.tree, child) {
                return Some(printer.print(child));
            }
            // Four or more would make it indented code.
            let alignment = tab_width.saturating_sub(list_prefix_len).min(3);
            let doc = printer.indented(alignment, |printer| printer.print(child));
            Some(docs![
                spaces(alignment),
                align_with_spaces(alignment as u32, doc)
            ])
        });
        docs![prefix, children]
    }

    // ───────────────────────────── tables ─────────────────────────────

    /// Prettier's `printTable`
    fn print_table(&mut self, id: NodeId, table: &Node) -> Doc<'a> {
        let first_align = table.first_align as usize;
        let aligns = self
            .tree
            .aligns
            .get(first_align..first_align + table.number as usize)
            .unwrap_or_default();
        let align_of = |column: usize| aligns.get(column).copied().unwrap_or(Align::None);
        let mut widths: Vec<usize> = Vec::new();
        let mut rows: Vec<Vec<(Vec<u8>, usize)>> = Vec::new();
        for row in self.tree.children(id) {
            let mut cells = Vec::new();
            for (column, cell) in self.tree.children(row).enumerate() {
                let mut text = Vec::new();
                let doc = self.print(cell);
                if let Err(failure) = doc::print(doc, self.options, b"\n", &mut text) {
                    self.failure = Some(failure);
                }
                let width = crate::ir::width::string_width_as(&text, self.options.flavor) as usize;
                if widths.len() <= column {
                    // `---`, `:--`, `:-:`, `--:`
                    widths.push(3);
                }
                widths[column] = widths[column].max(width);
                cells.push((text, width));
            }
            rows.push(cells);
        }
        let head_len = if self.is_mdx {
            usize::MAX
        } else {
            rows.first().map_or(0, Vec::len)
        };

        let print_contents = |is_compact: bool| -> Doc<'a> {
            let mut lines = Vec::new();
            let mut push_line = |columns: &mut dyn Iterator<Item = Vec<u8>>| {
                let mut line = b"| ".to_vec();
                for (index, column) in columns.enumerate() {
                    if index > 0 {
                        line.extend_from_slice(b" | ");
                    }
                    line.extend_from_slice(&column);
                }
                line.extend_from_slice(b" |");
                if !lines.is_empty() {
                    lines.push(Doc::Line(Line::Hard));
                }
                lines.push(Doc::from(line));
            };
            let print_row = |row: &[(Vec<u8>, usize)]| -> Vec<Vec<u8>> {
                row.iter()
                    .enumerate()
                    .map(|(column, (text, width))| {
                        if is_compact {
                            return text.clone();
                        }
                        let cell_padding = widths[column] - width;
                        let before = match align_of(column) {
                            Align::Right => cell_padding,
                            Align::Center => cell_padding / 2,
                            _ => 0,
                        };
                        let mut cell = vec![b' '; before];
                        cell.extend_from_slice(text);
                        cell.resize(cell.len() + cell_padding - before, b' ');
                        cell
                    })
                    .collect()
            };
            for (index, row) in rows.iter().enumerate() {
                push_line(&mut print_row(row).into_iter());
                if index == 0 {
                    // The delimiter row has as many cells as the header.
                    push_line(&mut widths.iter().take(head_len).enumerate().map(
                        |(column, &width)| {
                            let align = align_of(column);
                            let mut cell = vec![if matches!(align, Align::Center | Align::Left) {
                                b':'
                            } else {
                                b'-'
                            }];
                            cell.resize(if is_compact { 2 } else { width - 1 }, b'-');
                            cell.push(if matches!(align, Align::Center | Align::Right) {
                                b':'
                            } else {
                                b'-'
                            });
                            cell
                        },
                    ));
                }
            }
            Doc::Array(lines)
        };

        let aligned = print_contents(false);
        if self.options.prose_wrap != ProseWrap::Never {
            return docs![Doc::BreakParent, aligned];
        }
        // Without the padding if it doesn't fit.
        let compact = print_contents(true);
        docs![
            Doc::BreakParent,
            group(Doc::IfBreak {
                break_contents: Box::new(compact),
                flat_contents: Box::new(aligned),
                group_id: 0,
            })
        ]
    }
}

/// `printWord`'s handling of `/(\\+|^|.)(\*+|_+)($|.)/g`: escapes a run of `*` or `_` in a word in emphasis that could
/// open or close emphasis. `before` and `after` are the characters next to the word.
fn escape_delimiter_runs(units: &[u16], before: Option<u16>, after: Option<u16>) -> Vec<u16> {
    const BACKSLASH: u16 = b'\\' as u16;
    let is_marker = |unit: u16| unit == u16::from(b'*') || unit == u16::from(b'_');
    let mut out = Vec::with_capacity(units.len() + 4);
    let mut index = 0;
    'search: while index <= units.len() {
        // The leftmost match from `index` on.
        let from = index;
        for start in from..=units.len() {
            // `\\+`, `^` or `.`
            let backslashes = units[start..]
                .iter()
                .take_while(|&&unit| unit == BACKSLASH)
                .count();
            let candidates = [
                (backslashes > 0).then_some(backslashes),
                (start == 0).then_some(0),
                (start < units.len()).then_some(1),
            ];
            for preceding_len in candidates.into_iter().flatten() {
                let run_start = start + preceding_len;
                let Some(&marker) = units.get(run_start).filter(|&&unit| is_marker(unit)) else {
                    continue;
                };
                let run_len = units[run_start..]
                    .iter()
                    .take_while(|&&unit| unit == marker)
                    .count();
                let run_end = run_start + run_len;
                let following_len = usize::from(run_end < units.len());
                let preceding = &units[start..run_start];
                out.extend_from_slice(&units[from..start]);
                let is_escaped =
                    preceding.iter().all(|&unit| unit == BACKSLASH) && preceding.len() % 2 == 1;
                let can_open_or_close = !is_escaped
                    && can_open_or_close_emphasis(
                        preceding.last().copied().or(before),
                        marker,
                        units.get(run_end).copied().or(after),
                    );
                out.extend_from_slice(preceding);
                if can_open_or_close {
                    out.push(BACKSLASH);
                }
                out.extend_from_slice(&units[run_start..run_end + following_len]);
                index = run_end + following_len;
                // An empty match isn't possible: a run has at least one character.
                continue 'search;
            }
        }
        break;
    }
    out.extend_from_slice(&units[index.min(units.len())..]);
    out
}

/// Prettier's `canOpenOrCloseStrongOrEmphasis`
fn can_open_or_close_emphasis(preceding: Option<u16>, marker: u16, following: Option<u16>) -> bool {
    let (Some(preceding), Some(following)) = (preceding, following) else {
        return false;
    };
    let to_char = |unit: u16| char::from_u32(u32::from(unit));
    let is_whitespace = |unit: u16| to_char(unit).is_some_and(is_commonmark_whitespace);
    let is_punctuation = |unit: u16| is_punctuation_unit(to_char(unit));
    let (followed_by_whitespace, preceded_by_whitespace) =
        (is_whitespace(following), is_whitespace(preceding));
    let (followed_by_punctuation, preceded_by_punctuation) =
        (is_punctuation(following), is_punctuation(preceding));
    let is_left_flanking = !followed_by_whitespace
        && (!followed_by_punctuation || preceded_by_whitespace || preceded_by_punctuation);
    let is_right_flanking = !preceded_by_whitespace
        && (!preceded_by_punctuation || followed_by_whitespace || followed_by_punctuation);
    if marker == u16::from(b'*') {
        return is_left_flanking || is_right_flanking;
    }
    if is_left_flanking {
        return !is_right_flanking || preceded_by_punctuation;
    }
    is_right_flanking
}
