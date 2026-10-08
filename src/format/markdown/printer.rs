//! The document of a Markdown text: Prettier's `src/language-markdown/print/*.js`.

use super::ast::{Align, Kind, NONE, Node, NodeId, ReferenceType, Str, Tree};
use super::preprocess::{self, Token, TokenKind, is_indented_code, is_punctuation, is_punctuation_unit, ordered_item_info};
use super::strings::{first_char, is_in, last_char};
use super::unicode_tables::SPACE_SEPARATOR;
use crate::FormatOptions;
use crate::css::doc::{self, Alignment, Doc, Line, align_with_spaces, docs, fill, group, hardline, indent};
use crate::options::ProseWrap;
use std::borrow::Cow;

/// Code in another language, to be formatted.
pub(crate) struct Embedded<'x> {
    /// What is behind the fence.
    pub(crate) language: &'x [u8],
    pub(crate) code: &'x [u8],
    /// How many columns are left of the line.
    pub(crate) width: usize,
}

pub(crate) struct Printer<'a, 'e> {
    pub(crate) text: &'a [u8],
    /// The same with the front matter in any case: see `block::blank_front_matter`.
    pub(crate) original: &'a [u8],
    pub(crate) tree: &'a Tree,
    pub(crate) options: &'a FormatOptions,
    /// Formats code in another language. `None`: it stays as it is.
    pub(crate) embed: &'e mut dyn FnMut(&Embedded<'_>) -> Option<Vec<u8>>,
    /// The document is for a template in JavaScript: no backticks.
    pub(crate) is_in_template: bool,
    pub(crate) is_mdx: bool,
    /// How many columns what is being written is indented by.
    pub(crate) indentation: usize,
    /// What is being written is in a reference whose label is its text, which has to stay as it is.
    pub(crate) is_in_label: bool,
    pub(crate) stack_check: bun_core::StackCheck,
    pub(crate) is_nested_too_deeply: bool,
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
/// line: see `FormatOptions::is_in_markdown`.
fn lines_of<'a>(formatted: &[u8]) -> Doc<'a> {
    let mut parts = Vec::new();
    let mut is_after_literal_line_break = false;
    for (index, line) in bun_core::strings::split(formatted, b"\n").enumerate() {
        if index > 0 {
            parts.push(if is_after_literal_line_break { literalline() } else { hardline() });
        }
        is_after_literal_line_break = line.ends_with(b"\r");
        parts.push(Doc::from(line.strip_suffix(b"\r").unwrap_or(line).to_vec()));
    }
    Doc::Array(parts)
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
    present.sort_unstable();
    present.dedup();
    (1..).zip(present.iter()).find(|(count, len)| count != *len).map_or(present.len() + 1, |(count, _)| count)
}

/// `[\p{Space_Separator}\t\n\f\r]`
fn is_commonmark_whitespace(c: char) -> bool {
    matches!(c, ' ' | '\t' | '\n' | '\u{C}' | '\r') || is_in(SPACE_SEPARATOR, c as u32)
}

/// Collects the parts of a `fill`: content and separators take turns.
///
/// Where lines are not wrapped, every separator is a forced line break, and a `fill` writes the same as its parts
/// one after the other. So that is what is made then, which is less work for everybody.
struct FillParts<'a> {
    is_fill: bool,
    parts: Vec<Doc<'a>>,
    /// The content that is being put together, of a `fill`.
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
    fn flatten(&mut self, doc: Doc<'a>) {
        match doc {
            Doc::Array(mut docs) if !self.is_fill => match self.parts.is_empty() {
                true => self.parts = docs,
                false => self.parts.append(&mut docs),
            },
            Doc::Array(docs) => docs.into_iter().for_each(|doc| self.flatten(doc)),
            Doc::Fill(parts) => {
                for (index, part) in parts.into_iter().enumerate() {
                    match index % 2 {
                        0 => self.content(part),
                        _ => self.separator(part),
                    }
                }
            }
            doc => self.content(doc),
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

/// What white space is written as.
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
        self.original.get(node.start as usize..node.end as usize).unwrap_or_default()
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
        self.tree.tokens.get(first..first + sentence.number as usize).unwrap_or_default()
    }

    /// The lines of `text`, with `hardline` between them, or with `markAsRoot(literalline)`.
    ///
    /// Where lines are not indented and nothing is to be taken away at their ends, the text is written as it is.
    fn lines(&self, text: &'a [u8], is_literal: bool) -> Doc<'a> {
        let is_as_it_is = self.indentation == 0
            && !self.is_in_template
            && !self.options.is_in_markdown
            && (is_literal || !(bun_core::strings::contains(text, b" \n") || bun_core::strings::contains(text, b"\t\n")));
        match (is_as_it_is, is_literal) {
            (true, _) => Doc::from(text),
            (false, false) => replace_end_of_line(text, hardline),
            (false, true) => replace_end_of_line(text, || mark_as_root(literalline())),
        }
    }

    /// `contents`, written with `width` more columns of indentation around it.
    fn indented<T>(&mut self, width: usize, contents: impl FnOnce(&mut Self) -> T) -> T {
        self.indentation += width;
        let result = contents(self);
        self.indentation -= width;
        result
    }

    // ───────────────────────────── what is asked of nodes ─────────────────────────────

    fn is_setext_heading(&self, node: &Node) -> bool {
        self.start_line(node) != self.end_line(node)
    }

    /// Prettier's `isPrettierIgnore`
    fn prettier_ignore(&self, id: NodeId) -> Option<Ignore> {
        let node = self.node(id)?;
        let comment = match node.kind {
            Kind::Html => {
                let comment = self.str(node.value).strip_prefix(b"<!--")?.strip_suffix(b"-->")?;
                crate::range::trim_end(crate::range::trim_start(comment))
            }
            Kind::EsComment => self.str(node.value),
            Kind::Paragraph if self.is_mdx && node.first_child == node.last_child => {
                self.str(self.node(node.first_child).filter(|child| child.kind == Kind::EsComment)?.value)
            }
            _ => return None,
        };
        match comment {
            b"prettier-ignore" => Some(Ignore::Next),
            b"prettier-ignore-start" => Some(Ignore::Start),
            b"prettier-ignore-end" => Some(Ignore::End),
            _ => None,
        }
    }

    /// Prettier's `isAutolink`
    fn is_autolink(&self, id: NodeId) -> bool {
        let Some(node) = self.node(id).filter(|node| node.kind == Kind::Link) else {
            return false;
        };
        node.first_child == node.last_child
            && self.node(node.first_child).is_some_and(|child| child.start == node.start && child.end == node.end)
    }

    /// Prettier's `getNthListSiblingIndex`: how many lists of the same kind are right before `list`.
    fn nth_list_sibling_index(&self, list: NodeId) -> usize {
        let Some(node) = self.node(list) else {
            return 0;
        };
        let mut count = 0;
        let mut previous = node.previous;
        while let Some(sibling) = self.node(previous).filter(|it| it.kind == Kind::List && it.ordered == node.ordered) {
            count += 1;
            previous = sibling.previous;
        }
        count
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
                && self
                    .node(node.next)
                    .is_some_and(|next| next.kind == Kind::ListItem && self.end_line(node) + 1 < self.start_line(next)))
    }

    /// Prettier's `isLooseListItemLegacy`, with what remark-parse 8 says about an item: it is spread out if there
    /// is an empty line in it that something follows, and it ends behind the empty lines before the next item.
    fn is_loose_list_item_legacy(&self, item: &Node) -> bool {
        let source = self.source(item);
        let mut from = 0;
        while let Some(at) = bun_core::strings::index_of(&source[from..], b"\n\n") {
            from += at + 2;
            if !crate::range::trim_start(&source[from..]).is_empty() {
                return true;
            }
        }
        self.node(item.next).is_some_and(|next| self.end_line(item) + 1 < self.start_line(next))
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

    fn is_inline_wrapper(kind: Kind) -> bool {
        Self::is_inline(kind) || matches!(kind, Kind::TableCell | Kind::Paragraph | Kind::Heading)
    }

    fn should_pre_print_hardline(&self, node: &Node) -> bool {
        let is_in_wrapper = self.kind(node.parent).is_some_and(Self::is_inline_wrapper);
        let is_inline_node = Self::is_inline(node.kind) && !(node.kind == Kind::LiquidNode && !is_in_wrapper);
        let is_inline_html = node.kind == Kind::Html && is_in_wrapper;
        !is_inline_node && !is_inline_html
    }

    fn should_pre_print_double_hardline(&self, node: &Node) -> bool {
        let (Some(previous), Some(parent)) = (self.node(node.previous), self.node(node.parent)) else {
            return false;
        };
        if !self.is_mdx && self.is_setext_heading(node) && self.start_line(node) < self.end_line(previous) {
            return false;
        }
        let follows_directly = self.end_line(previous) + 1 == self.start_line(node);
        if self.is_loose_list_item(node.previous)
            || (node.kind == Kind::List
                && parent.kind == Kind::ListItem
                && matches!(previous.kind, Kind::Code | Kind::Paragraph)
                && self.end_line(previous) + 1 < self.start_line(node))
        {
            return true;
        }
        let is_sibling_node = previous.kind == node.kind && matches!(node.kind, Kind::ListItem | Kind::Definition);
        let is_in_tight_list_item =
            parent.kind == Kind::ListItem && (node.kind == Kind::List || !self.is_loose_list_item(node.parent));
        let is_previous_ignore = self.prettier_ignore(node.previous) == Some(Ignore::Next);
        let is_html_after_html_or_paragraph = node.kind == Kind::Html
            && follows_directly
            && match previous.kind {
                Kind::Html => true,
                Kind::Paragraph => !self.is_mdx || parent.kind == Kind::ListItem,
                _ => false,
            };
        let is_liquid_without_blank_line =
            (node.kind == Kind::LiquidNode || previous.kind == Kind::LiquidNode) && follows_directly;
        !(is_sibling_node
            || is_in_tight_list_item
            || is_previous_ignore
            || is_html_after_html_or_paragraph
            || is_liquid_without_blank_line)
    }

    // ───────────────────────────── children ─────────────────────────────

    /// Prettier's `printChildren`. `processor` writes a child, or says that it is left out.
    fn print_children_with(
        &mut self,
        parent: NodeId,
        mut processor: impl FnMut(&mut Self, NodeId) -> Option<Doc<'a>>,
    ) -> Doc<'a> {
        let mut parts = Vec::new();
        let mut child = self.node(parent).map_or(NONE, |node| node.first_child);
        while let Some(node) = self.node(child) {
            if let Some(result) = processor(self, child) {
                if !parts.is_empty() && self.should_pre_print_hardline(node) {
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

    /// A node: as it is in the text if it is ignored, or as the language in it, or as Markdown.
    pub(crate) fn print(&mut self, id: NodeId) -> Doc<'a> {
        if !self.stack_check.is_safe_to_recurse() {
            self.is_nested_too_deeply = true;
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
            && self.options.prose_wrap != ProseWrap::Always
            && self.has_ancestor(id, |it| it.kind == Kind::Blockquote)
        {
            // `/\n>\s*$/`
            let trimmed = crate::range::trim_end(source);
            if let Some(without) = trimmed.strip_suffix(b"\n>") {
                source = without;
            }
        }
        Doc::from(source)
    }

    // ───────────────────────────── text ─────────────────────────────

    /// Whether white space in `id` cannot be a line break: it is in something that is on one line.
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
        let (Some(previous), Some(next)) = (index.checked_sub(1).and_then(|it| tokens.get(it)), tokens.get(index + 1)) else {
            return true;
        };
        let is_non_cjk_or_korean = |kind: TokenKind| matches!(kind, TokenKind::NonCjk | TokenKind::KLetter);
        match (previous.kind, next.kind) {
            (a, b) if is_non_cjk_or_korean(a) && is_non_cjk_or_korean(b) => return true,
            (TokenKind::KLetter, TokenKind::CjLetter) | (TokenKind::CjLetter, TokenKind::KLetter) => return true,
            (TokenKind::CjkPunctuation, _) | (_, TokenKind::CjkPunctuation) | (TokenKind::CjLetter, TokenKind::CjLetter) => {
                return false;
            }
            _ => {}
        }
        // Between Chinese or Japanese and something else.
        if self.str(next.value).first().is_some_and(u8::is_ascii_punctuation)
            || self.str(previous.value).last().is_some_and(u8::is_ascii_punctuation)
        {
            return true;
        }
        if previous.has_trailing_punctuation || next.has_leading_punctuation {
            return false;
        }
        Self::uses_cj_spaces(tokens)
    }

    /// Prettier's `isBreakable`, but for what does not depend on the white space.
    fn is_breakable(tokens: &[Token], index: usize) -> bool {
        let (Some(previous), Some(next)) = (index.checked_sub(1).and_then(|it| tokens.get(it)), tokens.get(index + 1)) else {
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

    /// Prettier's `printWhitespace`. `can_break`: lines are wrapped, and this is not on a single line.
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
            || (kind == TokenKind::Newline && (is_link || self.line_break_can_be_space(tokens, index)));
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

    /// Whether a line that starts with `word` could be taken for something else: a quote, a list, a heading.
    fn may_start_block(word: &[u8]) -> bool {
        match word {
            [b'>', ..] | [b'*' | b'+' | b'-'] => true,
            [b'#', ..] => word.len() <= 6 && word.iter().all(|&byte| byte == b'#'),
            [digits @ .., b')' | b'.'] => !digits.is_empty() && digits.iter().all(u8::is_ascii_digit),
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

    /// The same for a sentence that has not been split into words: it is ASCII, and lines are not wrapped. What is
    /// written as it is in the text is one text here.
    fn print_plain_sentence(&self, node: &Node) -> Doc<'a> {
        let text = self.str(node.value);
        let is_white = |byte: u8| matches!(byte, b'\t' | b'\n' | b' ');
        let is_preserved = self.options.prose_wrap == ProseWrap::Preserve;
        let mut parts = FillParts::new(false);
        // Where what has not been written yet starts.
        let mut start = 0;
        let mut index = 0;
        // Where the next line break or tab is, and the next two spaces, if not before `index`.
        let mut next_break = bun_core::strings::index_of_any(text, b"\n\t").unwrap_or(text.len());
        let mut next_spaces = bun_core::strings::index_of(text, b"  ").unwrap_or(text.len());
        while index < text.len() {
            // The next white space that is not a single space.
            if next_break < index {
                next_break = bun_core::strings::index_of_any(&text[index..], b"\n\t").map_or(text.len(), |at| index + at);
            }
            if next_spaces < index {
                next_spaces = bun_core::strings::index_of(&text[index..], b"  ").map_or(text.len(), |at| index + at);
            }
            let rest = &text[index..];
            let line_len = next_break - index;
            let len = line_len.min(next_spaces - index);
            // A space before a line break or a tab belongs to the same white space.
            index += len - usize::from(len == line_len && len > 0 && rest[len - 1] == b' ');
            let blanks = text[index..].iter().take_while(|&&byte| is_white(byte)).count();
            if blanks == 0 {
                break;
            }
            let (white_start, white_end) = (index, index + blanks);
            index = white_end;
            if blanks == 1 && text[white_start] == b' ' {
                continue;
            }
            if start < white_start {
                parts.content(Doc::from(&text[start..white_start]));
            }
            start = white_end;
            let has_newline = bun_core::strings::contains_char(&text[white_start..white_end], b'\n');
            if !has_newline || !is_preserved {
                parts.content(Doc::from(" "));
                continue;
            }
            // The word at the start of the next line, and whether it is all of that line.
            let word = &text[white_end..];
            let word = &word[..word.iter().take_while(|&&byte| !is_white(byte)).count()];
            let after = &text[white_end + word.len()..];
            let after = &after[..after.iter().take_while(|&&byte| is_white(byte)).count()];
            let is_whole_line = white_end + word.len() == text.len() || bun_core::strings::contains_char(after, b'\n');
            if Self::may_start_block(word) && !(word == b"-" && is_whole_line) {
                parts.content(Doc::from(" "));
                continue;
            }
            parts.hardline();
            // What looks like the line under a heading is escaped.
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

    /// Prettier's `printSentence`
    fn print_sentence(&mut self, id: NodeId, node: &Node) -> Doc<'a> {
        if node.number == preprocess::PLAIN {
            return self.print_plain_sentence(node);
        }
        let tokens = self.tokens(node);
        let can_break = self.options.prose_wrap == ProseWrap::Always && !self.is_on_single_line(id);
        let emphasis = self.find_ancestor(id, |it| matches!(it.kind, Kind::Emphasis | Kind::Strong));
        let is_newline = |token: Option<&Token>| token.is_some_and(|it| it.kind == TokenKind::Newline);
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
            let joins = next.is_some_and(|it| Self::may_start_block(self.str(it.value)))
                && !after_next.is_some_and(|it| it.kind == TokenKind::NoSpace)
                && !(self.options.prose_wrap == ProseWrap::Preserve && is_next_fake_setext_line);
            let prose_wrap = if joins { ProseWrap::Never } else { self.options.prose_wrap };
            Self::add_whitespace(&mut parts, &self.print_whitespace(tokens, index, prose_wrap, false, can_break));
        }
        parts.finish()
    }

    /// Prettier's `printWord`. `emphasis`: the emphasis or strong emphasis that it is in.
    fn print_word(&self, sentence: &Node, tokens: &[Token], index: usize, emphasis: Option<NodeId>) -> Doc<'a> {
        let text = self.str(tokens[index].value);
        if self.is_mdx {
            return self.print_word_legacy(sentence, text);
        }
        let is_newline = |token: Option<&Token>| token.is_some_and(|it| it.kind == TokenKind::Newline);
        let previous = index.checked_sub(1).and_then(|it| tokens.get(it));
        let next = tokens.get(index + 1);
        let Some(emphasis) = emphasis else {
            // What looks like the line under a heading is escaped: `Previous line↵␣␣␣␣===`.
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

        let mut units: Vec<u16> = bstr::ByteSlice::chars(text).flat_map(|c| c.encode_utf16(&mut [0; 2]).to_vec()).collect();
        // At the very start of the emphasis.
        if index == 0 && matches!(text[0], b'*' | b'_') && sentence.previous == NONE && sentence.parent == emphasis {
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
                    let c = if is_last { last_char(value)?.0 } else { first_char(value)?.0 };
                    let mut buffer = [0; 2];
                    let encoded = c.encode_utf16(&mut buffer);
                    if is_last { encoded.last().copied() } else { encoded.first().copied() }
                }
            }
        };
        let escaped = escape_delimiter_runs(&units, unit_of(previous, true), unit_of(next, false));
        Doc::from(String::from_utf16_lossy(&escaped).into_bytes())
    }

    /// Prettier's `printWordLegacy`: every `*` is escaped, and `_` at the ends of a word and next to punctuation.
    fn print_word_legacy(&self, sentence: &Node, text: &'a [u8]) -> Doc<'a> {
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
        let run_at = |from: usize| chars[from.min(chars.len())..].iter().take_while(|&&c| c == '_').count();
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
                _ => chars[index..index + len].iter().for_each(|&c| push_escaped(&mut escaped, c)),
            }
            index += len.max(1);
        }

        // Behind an autolink, a backslash would become a part of it.
        let index_of = |node: &Node| {
            let mut index = 0usize;
            let mut previous = node.previous;
            while let Some(sibling) = self.node(previous) {
                index += 1;
                previous = sibling.previous;
            }
            index
        };
        let follows_autolink = |node: Option<&Node>| {
            node.is_some_and(|node| {
                let mut children = std::iter::successors(Some(node.first_child), |&child| self.node(child).map(|it| it.next));
                index_of(node).checked_sub(1).and_then(|at| children.nth(at)).is_some_and(|child| self.is_autolink(child))
            })
        };
        let parent = self.node(sentence.parent);
        if sentence.previous == NONE
            && (follows_autolink(parent)
                || parent.is_some_and(|parent| {
                    parent.kind == Kind::Emphasis && parent.previous == NONE && follows_autolink(self.node(parent.parent))
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

    /// What is in a reference whose label is its text: as it is, but for where its lines break.
    fn print_same_content(&mut self, id: NodeId, node: &Node) -> Doc<'a> {
        let source = self.source(node);
        let mut tokens = Vec::new();
        let start = node.start;
        preprocess::split_text(source, |from, to| Str::source(start + from as u32, start + to as u32), &mut tokens);
        let can_break = self.options.prose_wrap == ProseWrap::Always && !self.is_on_single_line(id);
        let mut parts = FillParts::new(self.options.prose_wrap == ProseWrap::Always);
        for (index, token) in tokens.iter().enumerate() {
            match token.is_word() {
                true => parts.content(Doc::from(self.str(token.value))),
                false => Self::add_whitespace(
                    &mut parts,
                    &self.print_whitespace(&tokens, index, self.options.prose_wrap, true, can_break),
                ),
            }
        }
        parts.finish()
    }

    /// Prettier's `prevOrNextWord`: whether a word is right before or behind `node`.
    fn has_word_next_to(&self, node: &Node) -> bool {
        // Whether the word at that end of the sentence `sibling` has punctuation there, and the character.
        let word = |sibling: NodeId, is_last: bool| -> Option<(bool, char)> {
            let sentence = self.node(sibling).filter(|it| it.kind == Kind::Sentence)?;
            if sentence.number == preprocess::PLAIN {
                let text = self.str(sentence.value);
                let byte = *if is_last { text.last() } else { text.first() }?;
                return (!matches!(byte, b'\t' | b'\n' | b' ')).then_some((byte.is_ascii_punctuation(), byte as char));
            }
            let tokens = self.tokens(sentence);
            let word = if is_last { tokens.last() } else { tokens.first() }.filter(|token| token.is_word())?;
            let value = self.str(word.value);
            match is_last {
                true => Some((word.has_trailing_punctuation, last_char(value)?.0)),
                false => Some((word.has_leading_punctuation, first_char(value)?.0)),
            }
        };
        let is_word = |it: (bool, char)| !it.0 && !is_commonmark_whitespace(it.1);
        word(node.previous, true).is_some_and(is_word) || word(node.next, false).is_some_and(is_word)
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// Prettier's `printUrl`. `is_in_parentheses`: a `)` cannot be in it as it is.
    fn print_url(&self, url: &'a [u8], is_in_parentheses: bool) -> Doc<'a> {
        if url.is_empty() && !self.is_mdx {
            return Doc::from("<>");
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
        let title = self.str(title);
        if title.is_empty() {
            return Doc::EMPTY;
        }
        let has = |byte: u8| bun_core::strings::contains_char(title, byte);
        let mut printed = Vec::with_capacity(title.len() + 3);
        if has_space {
            printed.push(b' ');
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
        let quote = if count(preferred) > count(alternate) { alternate } else { preferred };
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
        // The package collapse-white-space: every run of white space is a space.
        let mut rest = label;
        while !rest.is_empty() {
            let trimmed = crate::range::trim_start(rest);
            if trimmed.len() < rest.len() {
                printed.push(b' ');
                rest = trimmed;
                continue;
            }
            let len = first_char(rest).map_or(1, |it| it.1);
            if matches!(rest[0], b'\\' | b'[' | b']') && !self.is_mdx {
                printed.push(b'\\');
            }
            printed.extend_from_slice(&rest[..len]);
            rest = &rest[len..];
        }
        printed.push(b']');
        Doc::from(printed)
    }

    /// Prettier's `getBracketContent`: what is between the first `[` of `node` and the `]` that closes it.
    fn bracket_content(&self, node: &Node) -> Option<&'a [u8]> {
        let source = self.source(node);
        let first = bun_core::strings::index_of_char_usize(source, b'[')?;
        let (mut depth, mut index) = (1, first + 1);
        while let Some(&byte) = source.get(index) {
            match byte {
                b'\\' => {
                    // The character behind it, however many bytes it is.
                    index += 1 + first_char(&source[(index + 1).min(source.len())..]).map_or(1, |it| it.1);
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
        match self.bracket_content(node).filter(|it| !it.is_empty() && !self.is_mdx) {
            Some(alt) => Doc::from(alt),
            None => Doc::from(self.str(node.third)),
        }
    }

    // ───────────────────────────── nodes ─────────────────────────────

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
                parts.finish()
            }
            Kind::Sentence => self.print_sentence(id, node),
            Kind::Emphasis => {
                let style: &'a [u8] = if self.is_autolink(node.first_child) {
                    self.source(node).get(..1).unwrap_or(b"_")
                } else {
                    let is_in_strong_next_to_word =
                        self.node(node.parent).is_some_and(|parent| parent.kind == Kind::Strong && self.has_word_next_to(parent));
                    let needs_asterisk = self.has_word_next_to(node)
                        || is_in_strong_next_to_word
                        || self.has_ancestor(id, |it| it.kind == Kind::Emphasis);
                    if needs_asterisk { b"*" } else { b"_" }
                };
                docs![style, self.print_children(id), style]
            }
            Kind::Strong => docs!["**", self.print_children(id), "**"],
            Kind::Delete => docs!["~~", self.print_children(id), "~~"],
            Kind::InlineCode => self.print_inline_code(id, node),
            Kind::WikiLink => {
                let value = self.str(node.value);
                let has_blanks = bun_core::strings::index_of_any(value, b"\t\n").is_some();
                if self.options.prose_wrap == ProseWrap::Preserve || !has_blanks {
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
                contents.iter_mut().filter(|byte| **byte == 0).for_each(|byte| *byte = b' ');
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
                docs!["> ", Doc::Align(Alignment::Text("> "), Box::new(children))]
            }
            Kind::Heading => {
                if !self.is_mdx && self.is_setext_heading(node) {
                    let last_line = &self.original[self.tree.line_start(node.end.saturating_sub(1)) as usize..node.end as usize];
                    let find = |marker: u8| bun_core::strings::index_of_char_usize(last_line, marker);
                    let underline = &last_line[find(b'=').max(find(b'-')).unwrap_or_else(|| last_line.len().saturating_sub(1))..];
                    return docs![self.print_children(id), hardline(), underline];
                }
                docs![[&b"######"[..node.number.min(6) as usize], b" "].concat(), self.print_children(id)]
            }
            Kind::Code => self.print_code(id, node, None),
            Kind::Html => {
                let mut value = self.str(node.value);
                if self.kind(node.parent) == Some(Kind::Root) && node.next == NONE {
                    value = crate::range::trim_end(value);
                }
                let is_comment = value.len() >= 7 && value.starts_with(b"<!--") && value.ends_with(b"-->");
                // In a line, what follows it is measured from its last line break on.
                match (self.kind(node.parent).is_some_and(Self::is_inline_wrapper), is_comment) {
                    (false, _) => self.lines(value, !is_comment),
                    (true, true) => replace_end_of_line(value, hardline),
                    (true, false) => replace_end_of_line(value, || mark_as_root(literalline())),
                }
            }
            Kind::List => self.print_list(id, node),
            Kind::ListItem | Kind::TableRow => Doc::EMPTY,
            Kind::Import | Kind::Export | Kind::Jsx => Doc::from(crate::range::trim_end(self.str(node.value))),
            Kind::EsComment => docs!["{/* ", self.str(node.value), " */}"],
            Kind::ThematicBreak => match self.find_ancestor(id, |it| it.kind == Kind::List) {
                Some(list) if self.nth_list_sibling_index(list).is_multiple_of(2) => Doc::from("***"),
                _ => Doc::from("---"),
            },
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
                ReferenceType::Full => docs!["![", self.print_image_alt(node), "]", self.print_label(node.value)],
                ReferenceType::Collapsed if self.is_mdx => docs!["![", self.print_image_alt(node), "][]"],
                ReferenceType::Shortcut if self.is_mdx => docs!["![", self.print_image_alt(node), "]"],
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
                    indent(docs![line_or_space(), self.print_url(self.str(node.value), false), title])
                ])
            }
            Kind::FootnoteReference => docs!["[^", self.str(node.value), "]"],
            Kind::FootnoteDefinition => {
                let only_paragraph = self
                    .node(node.first_child)
                    .filter(|child| child.kind == Kind::Paragraph && node.first_child == node.last_child);
                let is_inline = only_paragraph.is_some_and(|paragraph| match self.options.prose_wrap {
                    ProseWrap::Never => true,
                    ProseWrap::Preserve => self.start_line(paragraph) == self.end_line(paragraph),
                    ProseWrap::Always => false,
                });
                let children = match is_inline {
                    true => self.print_children(id),
                    false => {
                        let first = node.first_child;
                        let children = self.indented(4, |printer| {
                            printer.print_children_with(id, |printer, child| {
                                let doc = printer.print(child);
                                Some(if child == first { group(docs![Doc::SOFTLINE, doc]) } else { doc })
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
        if self.options.prose_wrap != ProseWrap::Preserve && bun_core::strings::contains_char(value, b'\n') {
            code = Cow::Owned(value.iter().map(|&byte| if byte == b'\n' { b' ' } else { byte }).collect());
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
        let is_blank = |byte: &u8| matches!(byte, b'\n' | b' ');
        let needs_padding = code.first() == Some(&b'`')
            || code.last() == Some(&b'`')
            || (code.first().is_some_and(is_blank) && code.last().is_some_and(is_blank) && !code.iter().all(is_blank));
        let padding = if needs_padding { " " } else { "" };
        docs![backticks.clone(), padding, code, padding, backticks]
    }

    /// `formatted`: the code, if it has been formatted.
    fn print_code(&self, id: NodeId, node: &Node, formatted: Option<Doc<'a>>) -> Doc<'a> {
        let value = self.str(node.value);
        if formatted.is_none() && is_indented_code(self.original, self.tree, id) {
            return align_with_spaces(4, docs!["    ", replace_end_of_line(value, hardline)]);
        }
        let style_unit = if self.is_in_template { b'~' } else { b'`' };
        let style = vec![style_unit; (max_continuous_count(value, style_unit) + 1).max(3)];
        let meta = self.str(node.third);
        docs![
            style.clone(),
            self.str(node.second),
            if meta.is_empty() { Doc::EMPTY } else { docs![" ", meta] },
            hardline(),
            formatted.unwrap_or_else(|| self.lines(value, false)),
            hardline(),
            style
        ]
    }

    /// Prettier's `embed`
    fn print_embedded(&mut self, id: NodeId, node: &Node) -> Option<Doc<'a>> {
        if matches!(node.kind, Kind::Import | Kind::Export | Kind::Jsx) {
            let code = self.str(node.value);
            let formatted = (self.embed)(&Embedded {
                language: if node.kind == Kind::Jsx { super::MDX_JSX } else { super::MDX_ES_SYNTAX },
                code,
                width: (self.options.line_width.value() as usize).saturating_sub(self.indentation),
            })?;
            return Some(lines_of(crate::range::trim_end(&formatted)));
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
        let formatted = (self.embed)(&Embedded {
            language,
            code,
            width,
        })?;
        let formatted = crate::range::trim_end(&formatted);
        let is_as_it_is = self.indentation == 0
            && !self.is_in_template
            && !self.options.is_in_markdown
            && !bun_core::strings::contains_char(formatted, b'\r');
        let formatted = if is_as_it_is { Doc::from(formatted.to_vec()) } else { lines_of(formatted) };
        Some(mark_as_root(self.print_code(id, node, Some(formatted))))
    }

    /// Prettier's `printEmbedFrontMatter`
    fn print_front_matter(&mut self, node: &Node) -> Doc<'a> {
        let raw = &self.original[..node.end as usize];
        let Some(front_matter) = super::front_matter::parse(self.original) else {
            return Doc::from(raw);
        };
        let language = &self.original[front_matter.explicit_language.0..front_matter.explicit_language.1];
        let is_toml = language == b"toml" || (language.is_empty() && raw.starts_with(b"+++"));
        let is_yaml = language == b"yaml" || (language.is_empty() && !is_toml);
        let value = &self.original[front_matter.value.0..front_matter.value.1];
        let value = crate::range::trim_end(crate::range::trim_start(value));
        let formatted = match value {
            b"" if is_yaml || is_toml => (self.embed)(&Embedded {
                language: b"",
                code: b"",
                width: 0,
            }),
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
        let formatted = crate::range::trim_end(&formatted);
        mark_as_root(docs![
            &raw[..3],
            language,
            hardline(),
            match formatted.is_empty() {
                true => Doc::EMPTY,
                false => docs![lines_of(formatted), hardline()],
            },
            &raw[raw.len() - 3..]
        ])
    }

    /// Prettier's `printRoot`: what is between `<!-- prettier-ignore-start -->` and `<!-- prettier-ignore-end -->`
    /// stays as it is.
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
        let Some(second) = self.node(first).map(|it| it.next).filter(|&it| it != NONE && list.ordered) else {
            return false;
        };
        if number(second) != 1 {
            return false;
        }
        if number(first) != 0 {
            return true;
        }
        self.node(second).map(|it| it.next).is_some_and(|third| third != NONE && number(third) == 1)
    }

    /// Prettier's `printList`
    fn print_list(&mut self, id: NodeId, list: &'a Node) -> Doc<'a> {
        let nth_sibling_index = self.nth_list_sibling_index(id);
        let is_git_diff_friendly = self.is_git_diff_friendly(list);
        // Before indented code, the content has to be indented deeper than that is.
        let min_indent = match self.node(list.next).filter(|_| is_indented_code(self.original, self.tree, list.next)) {
            Some(code) => {
                let blanks = self.str(code.value).iter().take_while(|byte| matches!(byte, b' ' | b'\t'));
                4 + blanks.map(|&byte| if byte == b'\t' { 4 } else { 1 }).sum::<usize>() + 1
            }
            None => 0,
        };
        let tab_width = usize::from(self.options.indent_width.value()).max(1);
        let mut index = 0u64;
        self.print_children_with(id, |printer, item| {
            let mut prefix: Vec<u8> = match list.ordered {
                true => {
                    let number = match index {
                        0 => u64::from(list.number),
                        _ if is_git_diff_friendly => 1,
                        _ => (u64::from(list.number) + index).min(999_999_999),
                    };
                    let mut prefix = number.to_string().into_bytes();
                    prefix.extend_from_slice(if nth_sibling_index.is_multiple_of(2) { b". " } else { b") " });
                    prefix
                }
                false => (if nth_sibling_index.is_multiple_of(2) { b"- " } else { b"* " }).to_vec(),
            };
            index += 1;
            if (list.is_aligned || (printer.is_mdx && list.checked != 0)) && list.ordered {
                // Prettier's `alignListPrefix`. Four or more would make it indented code.
                let additional = (tab_width - prefix.len() % tab_width) % tab_width;
                prefix.resize(prefix.len() + if additional >= 4 { 0 } else { additional }, b' ');
            }
            if prefix.len() < min_indent && !printer.is_mdx {
                prefix.truncate(prefix.trim_ascii_end().len());
                let trailing = (min_indent - prefix.len()).min(4);
                prefix.resize(prefix.len() + trailing, b' ');
                let leading = (min_indent - prefix.len()).min(3);
                prefix.splice(0..0, std::iter::repeat_n(b' ', leading));
            }

            let node = printer.node(item)?;
            let (first, second) = (printer.node(node.first_child), printer.node(node.last_child));
            let is_html_out_of_line = matches!((first, second), (Some(first), Some(second))
                if first.next == node.last_child
                    && second.kind == Kind::Html
                    && printer.column(first.start) != printer.column(second.start));
            let len = prefix.len();
            if is_html_out_of_line {
                return Some(docs![prefix, printer.print_list_item(item, node, len)]);
            }
            let contents = printer.indented(len, |printer| printer.print_list_item(item, node, len));
            Some(docs![prefix, align_with_spaces(len as u32, contents)])
        })
    }

    /// Prettier's `printListItem`
    fn print_list_item(&mut self, id: NodeId, item: &Node, list_prefix_len: usize) -> Doc<'a> {
        let prefix = match item.checked {
            0 => "",
            1 => "[ ] ",
            _ => "[x] ",
        };
        let first = item.first_child;
        let tab_width = usize::from(self.options.indent_width.value());
        let children = self.print_children_with(id, |printer, child| {
            let kind = printer.kind(child)?;
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
            Some(docs![spaces(alignment), align_with_spaces(alignment as u32, doc)])
        });
        docs![prefix, children]
    }

    // ───────────────────────────── tables ─────────────────────────────

    /// Prettier's `printTable`
    fn print_table(&mut self, id: NodeId, table: &Node) -> Doc<'a> {
        let first_align = table.first_align as usize;
        let aligns = self.tree.aligns.get(first_align..first_align + table.number as usize).unwrap_or_default();
        let align_of = |column: usize| aligns.get(column).copied().unwrap_or(Align::None);
        let mut widths: Vec<usize> = Vec::new();
        let mut rows: Vec<Vec<(Vec<u8>, usize)>> = Vec::new();
        for row in self.tree.children(id) {
            let mut cells = Vec::new();
            for (column, cell) in self.tree.children(row).enumerate() {
                let mut text = Vec::new();
                let doc = self.print(cell);
                doc::print(doc, self.options, b"\n", &mut text);
                let width = crate::ir::width::string_width(&text) as usize;
                if widths.len() <= column {
                    // `---`, `:--`, `:-:`, `--:`
                    widths.push(3);
                }
                widths[column] = widths[column].max(width);
                cells.push((text, width));
            }
            rows.push(cells);
        }
        let head_len = if self.is_mdx { usize::MAX } else { rows.first().map_or(0, Vec::len) };

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
                        let blanks = widths[column] - width;
                        let before = match align_of(column) {
                            Align::Right => blanks,
                            Align::Center => blanks / 2,
                            _ => 0,
                        };
                        let mut cell = vec![b' '; before];
                        cell.extend_from_slice(text);
                        cell.resize(cell.len() + blanks - before, b' ');
                        cell
                    })
                    .collect()
            };
            for (index, row) in rows.iter().enumerate() {
                push_line(&mut print_row(row).into_iter());
                if index == 0 {
                    // The row under the head has as many cells as the head.
                    push_line(&mut widths.iter().take(head_len).enumerate().map(|(column, &width)| {
                        let align = align_of(column);
                        let mut cell = vec![if matches!(align, Align::Center | Align::Left) { b':' } else { b'-' }];
                        cell.resize(if is_compact { 2 } else { width - 1 }, b'-');
                        cell.push(if matches!(align, Align::Center | Align::Right) { b':' } else { b'-' });
                        cell
                    }));
                }
            }
            Doc::Array(lines)
        };

        let aligned = print_contents(false);
        if self.options.prose_wrap != ProseWrap::Never {
            return docs![Doc::BreakParent, aligned];
        }
        // Without the padding if it does not fit.
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

/// What `printWord` does with `/(\\+|^|.)(\*+|_+)($|.)/g`: a run of `*` or `_` in a word in emphasis that could
/// open or close emphasis is escaped. `before` and `after`: what is next to the word.
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
            let backslashes = units[start..].iter().take_while(|&&unit| unit == BACKSLASH).count();
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
                let run_len = units[run_start..].iter().take_while(|&&unit| unit == marker).count();
                let run_end = run_start + run_len;
                let following_len = usize::from(run_end < units.len());
                let preceding = &units[start..run_start];
                out.extend_from_slice(&units[from..start]);
                let is_escaped = preceding.iter().all(|&unit| unit == BACKSLASH) && preceding.len() % 2 == 1;
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
                // An empty match is not possible: a run has at least one character.
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
    let (followed_by_whitespace, preceded_by_whitespace) = (is_whitespace(following), is_whitespace(preceding));
    let (followed_by_punctuation, preceded_by_punctuation) = (is_punctuation(following), is_punctuation(preceding));
    let is_left_flanking =
        !followed_by_whitespace && (!followed_by_punctuation || preceded_by_whitespace || preceded_by_punctuation);
    let is_right_flanking =
        !preceded_by_whitespace && (!preceded_by_punctuation || followed_by_whitespace || followed_by_punctuation);
    if marker == u16::from(b'*') {
        return is_left_flanking || is_right_flanking;
    }
    if is_left_flanking {
        return !is_right_flanking || preceded_by_punctuation;
    }
    is_right_flanking
}
