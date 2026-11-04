//! Prettier's tree transforms before printing: `print/preprocess.js`.
//!
//! Splits texts into words and whitespace, and records on each list if its content is aligned to the tab width. The
//! other things that file records on nodes are computed on demand here.

use super::ast::{Kind, NodeId, Str, Tree};
use super::strings::is_in;
use super::unicode_tables::{CJK, HANGUL, PUNCTUATION, VARIATION_SELECTORS};
use crate::text::{first_char, last_char};

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum TokenKind {
    /// `""`, between two words with nothing between them in the text.
    NoSpace,
    Space,
    Newline,
    NonCjk,
    CjLetter,
    KLetter,
    CjkPunctuation,
}

/// A word, or the whitespace between two words.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Token {
    pub(crate) kind: TokenKind,
    pub(crate) value: Str,
    pub(crate) has_leading_punctuation: bool,
    pub(crate) has_trailing_punctuation: bool,
}

impl Token {
    fn whitespace(kind: TokenKind) -> Token {
        Token {
            kind,
            value: Str::EMPTY,
            has_leading_punctuation: false,
            has_trailing_punctuation: false,
        }
    }

    pub(crate) fn is_word(&self) -> bool {
        !self.is_whitespace()
    }

    pub(crate) fn is_whitespace(&self) -> bool {
        matches!(
            self.kind,
            TokenKind::NoSpace | TokenKind::Space | TokenKind::Newline
        )
    }

    pub(crate) fn is_cj(&self) -> bool {
        matches!(self.kind, TokenKind::CjLetter | TokenKind::CjkPunctuation)
    }
}

/// Prettier's `PUNCTUATION_REGEXP`
pub(crate) fn is_punctuation(c: char) -> bool {
    match c.is_ascii() {
        true => c.is_ascii_punctuation(),
        false => is_in(PUNCTUATION, c as u32),
    }
}

/// The same for one UTF-16 code unit: half of a surrogate pair isn't punctuation.
pub(crate) fn is_punctuation_unit(c: Option<char>) -> bool {
    c.is_some_and(|c| c as u32 <= 0xFFFF && is_punctuation(c))
}

struct Splitter<'x, F> {
    text: &'x [u8],
    /// Builds the string for a part of `text`.
    at: F,
    tokens: &'x mut Vec<Token>,
    /// The last token, if it's a word: its kind, and true if it has a full-width space.
    last_word: Option<(TokenKind, bool)>,
}

impl<F: Fn(usize, usize) -> Str> Splitter<'_, F> {
    /// Prettier's `appendNode`
    fn word(&mut self, kind: TokenKind, start: usize, end: usize, has_punctuation: (bool, bool)) {
        let has_wide_space =
            bun_core::strings::contains(&self.text[start..end], "\u{3000}".as_bytes());
        // Two adjacent words get an empty separator between them, except for Chinese or Japanese punctuation next to
        // other text, and next to a full-width space.
        if let Some((last_kind, last_has_wide_space)) = self.last_word {
            let is_between = matches!(
                (last_kind, kind),
                (TokenKind::NonCjk, TokenKind::CjkPunctuation)
                    | (TokenKind::CjkPunctuation, TokenKind::NonCjk)
            );
            if !is_between && !has_wide_space && !last_has_wide_space {
                self.tokens.push(Token::whitespace(TokenKind::NoSpace));
            }
        }
        self.tokens.push(Token {
            kind,
            value: (self.at)(start, end),
            has_leading_punctuation: has_punctuation.0,
            has_trailing_punctuation: has_punctuation.1,
        });
        self.last_word = Some((kind, has_wide_space));
    }

    fn other_word(&mut self, start: usize, end: usize) {
        if start < end {
            let word = &self.text[start..end];
            let has_punctuation = (
                is_punctuation_unit(first_char(word).map(|it| it.0)),
                is_punctuation_unit(last_char(word).map(|it| it.0)),
            );
            self.word(TokenKind::NonCjk, start, end, has_punctuation);
        }
    }
}

/// Prettier's `splitText`. `at` builds the string for a part of `text`, given its offsets.
pub(crate) fn split_text(text: &[u8], at: impl Fn(usize, usize) -> Str, tokens: &mut Vec<Token>) {
    let is_white = |byte: u8| matches!(byte, b'\t' | b'\n' | b' ');
    let mut splitter = Splitter {
        text,
        at,
        tokens,
        last_word: None,
    };
    let mut index = 0;
    while index < text.len() {
        if is_white(text[index]) {
            let len = text[index..]
                .iter()
                .take_while(|&&byte| is_white(byte))
                .count();
            let has_newline = bun_core::strings::contains_char(&text[index..index + len], b'\n');
            splitter.tokens.push(Token::whitespace(if has_newline {
                TokenKind::Newline
            } else {
                TokenKind::Space
            }));
            splitter.last_word = None;
            index += len;
            continue;
        }
        let word_end = index
            + text[index..]
                .iter()
                .take_while(|&&byte| !is_white(byte))
                .count();
        if text[index..word_end].is_ascii() {
            splitter.other_word(index, word_end);
            index = word_end;
            continue;
        }
        // Every Chinese, Japanese or Korean character is its own word.
        let mut run_start = index;
        while index < word_end {
            let Some((c, len)) = first_char(&text[index..word_end]) else {
                break;
            };
            if !is_in(CJK, c as u32) {
                index += len;
                continue;
            }
            splitter.other_word(run_start, index);
            let selector = first_char(&text[index + len..word_end])
                .filter(|it| is_in(VARIATION_SELECTORS, it.0 as u32));
            let end = index + len + selector.map_or(0, |it| it.1);
            let kind = if is_punctuation(c) {
                TokenKind::CjkPunctuation
            } else if is_in(HANGUL, c as u32) {
                TokenKind::KLetter
            } else {
                TokenKind::CjLetter
            };
            let is_punctuation = kind == TokenKind::CjkPunctuation;
            splitter.word(kind, index, end, (is_punctuation, is_punctuation));
            (index, run_start) = (end, end);
        }
        splitter.other_word(run_start, word_end);
        index = word_end;
    }
}

/// The length of a `>` at the start of `line`, however it's written, with the spaces and tabs around it.
fn blockquote_marker_len(line: &[u8]) -> Option<usize> {
    let is_space_or_tab = |byte: &&u8| matches!(byte, b' ' | b'\t');
    let leading_whitespace = line.iter().take_while(is_space_or_tab).count();
    let rest = &line[leading_whitespace..];
    let reference = |rest: &[u8]| -> Option<usize> {
        let number = rest.strip_prefix(b"&#")?;
        let (digits, wanted, prefix): (&[u8], &[u8], usize) = match number.first()? {
            b'x' | b'X' => (&number[1..], b"3e", 3),
            _ => (number, b"62", 2),
        };
        let zeros = digits.iter().take_while(|&&byte| byte == b'0').count();
        let value = digits.get(zeros..zeros + 2)?;
        (value.eq_ignore_ascii_case(wanted) && digits.get(zeros + 2) == Some(&b';'))
            .then_some(prefix + zeros + 3)
    };
    let len = if rest.starts_with(b">") {
        1
    } else if rest.starts_with(b"\\>") {
        2
    } else if rest.starts_with(b"&gt;") || rest.starts_with(b"&GT;") {
        4
    } else {
        reference(rest)?
    };
    Some(leading_whitespace + len + rest[len..].iter().take_while(is_space_or_tab).count())
}

/// How many unescaped references to a line break are in `line`: `&NewLine;`, `&#10;`, `&#xA;`.
fn count_newline_references(line: &[u8]) -> usize {
    let mut count = 0;
    let mut index = 0;
    while let Some(at) = bun_core::strings::index_of_char_usize(&line[index..], b'&') {
        let start = index + at;
        index = start + 1;
        let backslashes = line[..start]
            .iter()
            .rev()
            .take_while(|&&byte| byte == b'\\')
            .count();
        if backslashes % 2 == 1 {
            continue;
        }
        let rest = &line[start + 1..];
        let is_newline = rest.starts_with(b"NewLine;")
            || rest.strip_prefix(b"#").is_some_and(|number| {
                let (digits, wanted): (&[u8], &[u8]) = match number.first() {
                    Some(b'x' | b'X') => (&number[1..], b"a;"),
                    _ => (number, b"10;"),
                };
                let zeros = digits.iter().take_while(|&&byte| byte == b'0').count();
                digits
                    .get(zeros..zeros + wanted.len())
                    .is_some_and(|it| it.eq_ignore_ascii_case(wanted))
            });
        count += usize::from(is_newline);
    }
    count
}

/// Prettier's `getBlockquoteRawText`: `raw` without the block quote markers at the start of its lines. `value` is the
/// decoded text, which shows how many `>` belong to the text itself.
fn blockquote_raw_text(raw: &[u8], value: &[u8], out: &mut Vec<u8>) {
    let mut value_lines = bun_core::strings::split(value, b"\n");
    for (index, raw_line) in bun_core::strings::split(raw, b"\n").enumerate() {
        let value_line = value_lines.next().unwrap_or_default();
        for _ in 0..count_newline_references(raw_line) {
            value_lines.next();
        }
        if index == 0 {
            out.extend_from_slice(raw_line);
            continue;
        }
        out.push(b'\n');
        let mut to_keep = 0;
        for &byte in value_line {
            match byte {
                b'>' => to_keep += 1,
                b' ' | b'\t' => {}
                _ => break,
            }
        }
        // The start of each marker, and the end of the last one.
        let mut starts: smallvec::SmallVec<[usize; 8]> = smallvec::SmallVec::new();
        let mut position = 0;
        while let Some(len) = blockquote_marker_len(&raw_line[position..]) {
            starts.push(position);
            position += len;
        }
        let from = match to_keep {
            0 => position,
            _ => starts
                .len()
                .checked_sub(to_keep)
                .and_then(|at| starts.get(at))
                .copied()
                .unwrap_or(0),
        };
        out.extend_from_slice(&raw_line[from..]);
    }
}

/// `{ numberText, leadingSpaces }` of Prettier's `getOrderedListItemInfo`: an ordered list item's number, and how much
/// whitespace follows its marker.
pub(crate) fn ordered_item_info(text: &[u8], tree: &Tree, item: NodeId) -> (u64, usize) {
    let Some(node) = tree.get(item) else {
        return (0, 0);
    };
    let end = tree
        .get(node.first_child)
        .map_or(node.end, |child| child.start);
    let head = text
        .get(node.start as usize..end as usize)
        .unwrap_or_default();
    let head = bun_core::strings::trim_js_whitespace_start(head);
    let digits = head.iter().take_while(|byte| byte.is_ascii_digit()).count();
    let number = head[..digits]
        .iter()
        .fold(0u64, |number, digit| number * 10 + u64::from(digit - b'0'));
    let after = head.get(digits + 1..).unwrap_or_default();
    (
        number,
        after.len() - bun_core::strings::trim_js_whitespace_start(after).len(),
    )
}

/// True if `code` looks like indented code.
pub(crate) fn is_indented_code(text: &[u8], tree: &Tree, code: NodeId) -> bool {
    let Some(node) = tree.get(code).filter(|node| node.kind == Kind::Code) else {
        return false;
    };
    // For oxfmt the parser has recorded it.
    if node.number == 1 {
        return true;
    }
    let source = text
        .get(node.start as usize..node.end as usize)
        .unwrap_or_default();
    let source = source.strip_prefix(b"\n").unwrap_or(source);
    source.starts_with(b"    ") || source.starts_with(b"\t")
}

/// `Node::number` of a sentence that hasn't been split into words. Its text is its `value`. `is_aligned` means it's in
/// emphasis.
pub(crate) const PLAIN: u32 = u32::MAX;

pub(crate) struct Preprocessor<'x> {
    pub(crate) text: &'x [u8],
    /// See `Printer::original`.
    pub(crate) original: &'x [u8],
    /// Lines are wrapped: `proseWrap: "always"`.
    pub(crate) wraps_lines: bool,
    pub(crate) is_mdx: bool,
    pub(crate) is_for_oxfmt: bool,
    pub(crate) tree: &'x mut Tree,
    pub(crate) tab_width: usize,
    pub(crate) stack_check: bun_core::StackCheck,
    pub(crate) is_nested_too_deeply: bool,
}

/// Facts about a node derived from its ancestors.
#[derive(Copy, Clone)]
struct Ancestry {
    /// All the lists around it are aligned.
    is_in_aligned_lists: bool,
    /// The paragraph or heading that contains it, and true if that's in a block quote.
    paragraph: Option<(NodeId, bool)>,
    is_in_blockquote: bool,
    is_in_emphasis: bool,
}

impl Preprocessor<'_> {
    pub(crate) fn run(&mut self, root: NodeId) {
        if !self.is_mdx {
            self.mark_risky_paragraphs(root);
        }
        let ancestry = Ancestry {
            is_in_aligned_lists: true,
            paragraph: None,
            is_in_blockquote: false,
            is_in_emphasis: false,
        };
        self.visit(root, ancestry);
    }

    /// A paragraph where wrapping could turn `[[` and `]]` into a wiki link keeps its texts as is. Such a paragraph has
    /// `spread` set.
    fn mark_risky_paragraphs(&mut self, root: NodeId) {
        if !bun_core::strings::contains(self.text, b"[[") {
            return;
        }
        // In source order. The paragraphs around the current node are on `open`, each with a flag for whether `[[` has
        // been seen in it.
        let mut open: Vec<(NodeId, bool)> = Vec::new();
        let mut stack = vec![(root, false)];
        while let Some((id, is_exit)) = stack.pop() {
            let Some(&node) = self.tree.get(id) else {
                continue;
            };
            if is_exit {
                open.pop();
                continue;
            }
            let mark = |tree: &mut Tree, open: &[(NodeId, bool)]| {
                for &(paragraph, can_open) in open {
                    if can_open && let Some(paragraph) = tree.get_mut(paragraph) {
                        paragraph.spread = true;
                    }
                }
            };
            match node.kind {
                Kind::WikiLink => mark(self.tree, &open),
                Kind::Text => {
                    let raw = &self.original[node.start as usize..node.end as usize];
                    if bun_core::strings::contains(raw, b"[[") {
                        open.iter_mut().for_each(|it| it.1 = true);
                    }
                    if bun_core::strings::contains(raw, b"]]") {
                        mark(self.tree, &open);
                    }
                }
                Kind::Paragraph => {
                    open.push((id, false));
                    stack.push((id, true));
                }
                _ => {}
            }
            let first = stack.len();
            stack.extend(self.tree.children(id).map(|child| (child, false)));
            stack[first..].reverse();
        }
    }

    fn visit(&mut self, id: NodeId, mut ancestry: Ancestry) {
        if !self.stack_check.is_safe_to_recurse() {
            self.is_nested_too_deeply = true;
            return;
        }
        let Some(&node) = self.tree.get(id) else {
            return;
        };
        match node.kind {
            Kind::Text => return self.split_into_sentence(id, ancestry),
            Kind::List if node.first_child != super::ast::NONE => {
                let is_aligned = ancestry.is_in_aligned_lists
                    && (self.is_mdx || !is_indented_code(self.original, self.tree, node.next))
                    && self.is_aligned(id);
                ancestry.is_in_aligned_lists = is_aligned;
                // Prettier's `getNthListSiblingIndex`
                let nth = match self.tree.get(node.previous) {
                    Some(previous)
                        if previous.kind == Kind::List && previous.ordered == node.ordered =>
                    {
                        previous.first_align + 1
                    }
                    _ => 0,
                };
                if let Some(node) = self.tree.get_mut(id) {
                    (node.is_aligned, node.first_align) = (is_aligned, nth);
                }
            }
            Kind::Paragraph | Kind::Heading if ancestry.paragraph.is_none() => {
                ancestry.paragraph = Some((id, ancestry.is_in_blockquote));
            }
            Kind::Blockquote => ancestry.is_in_blockquote = true,
            Kind::Emphasis | Kind::Strong => ancestry.is_in_emphasis = true,
            // Prettier's `htmlToJsx`
            Kind::Html
                if self.is_mdx
                    && !self
                        .tree
                        .kind(node.parent)
                        .is_some_and(super::printer::Printer::is_inline_wrapper)
                    && !super::spans::has_html_comment(self.tree.str(self.text, node.value)) =>
            {
                if let Some(node) = self.tree.get_mut(id) {
                    node.kind = Kind::Jsx;
                }
            }
            // Prettier's `transformIndentedCodeblockAndMarkItsParentList`: `hasIndentedCodeblock` is `checked` here.
            Kind::Code if self.is_mdx && is_indented_code(self.original, self.tree, id) => {
                let mut parent = node.parent;
                while let Some(ancestor) = self.tree.get_mut(parent) {
                    if ancestor.kind == Kind::List {
                        if ancestor.checked != 0 {
                            break;
                        }
                        ancestor.checked = 1;
                    }
                    parent = ancestor.parent;
                }
            }
            _ => {}
        }
        let mut child = node.first_child;
        while let Some(next) = self.tree.get(child).map(|child| child.next) {
            self.visit(child, ancestry);
            child = next;
        }
    }

    /// Prettier's `isAligned`
    fn is_aligned(&self, list: NodeId) -> bool {
        let Some(node) = self.tree.get(list) else {
            return false;
        };
        if !node.ordered {
            return true;
        }
        let first = node.first_child;
        let second = self
            .tree
            .get(first)
            .map_or(super::ast::NONE, |item| item.next);
        // oxfmt: extra spaces after the marker of an item that starts with indented code would become part of the code.
        if self.is_for_oxfmt {
            let mut item = first;
            while let Some(node) = self.tree.get(item) {
                if is_indented_code(self.original, self.tree, node.first_child) {
                    return false;
                }
                item = node.next;
            }
        }
        if ordered_item_info(self.original, self.tree, first).1 > 1 {
            return true;
        }
        // The column where an item's content starts.
        let item_start = |item: NodeId| {
            let item = self.tree.get(item)?;
            let child = self.tree.get(item.first_child)?;
            // mdast-util-gfm-task-list-item skips the character after `[x]` by adding one to the column, even if it's a
            // line break.
            let start = match child.start.checked_sub(1) {
                Some(before)
                    if item.checked != 0
                        && !self.is_for_oxfmt
                        && self.original.get(before as usize) == Some(&b'\n') =>
                {
                    return Some((before - self.tree.line_start(before)) as usize + 1);
                }
                _ => child.start,
            };
            Some((start - self.tree.line_start(start)) as usize)
        };
        let Some(first_start) = item_start(first) else {
            return false;
        };
        let tab_width = self.tab_width.max(1);
        if self.tree.get(second).is_none() {
            return first_start % tab_width == 0;
        }
        if Some(first_start) != item_start(second) {
            return false;
        }
        first_start % tab_width == 0 || ordered_item_info(self.original, self.tree, second).1 > 1
    }

    /// Prettier's `splitTextIntoSentences`, for one text.
    fn split_into_sentence(&mut self, id: NodeId, ancestry: Ancestry) {
        let Some(&node) = self.tree.get(id) else {
            return;
        };
        let raw = &self.original[node.start as usize..node.end as usize];
        let mut without_markers = Vec::new();
        let mut text = raw;
        if let Some((_, true)) = ancestry.paragraph
            && bun_core::strings::contains_char(raw, b'\n')
        {
            blockquote_raw_text(
                raw,
                self.tree.str(self.text, node.value),
                &mut without_markers,
            );
            text = &without_markers;
        }
        if ancestry.paragraph.is_some() && self.tree.kind(node.parent) == Some(Kind::Paragraph) {
            if node.previous == super::ast::NONE {
                text = text.trim_ascii_start();
            }
            if node.next == super::ast::NONE {
                text = text.trim_ascii_end();
            }
        }

        // remark-parse 8 returns the decoded characters, and Prettier's `restoreUnescapedCharacter` restores their
        // source form, except for `*` and `_`, which are escaped again when they're printed.
        let mut unescaped = Vec::new();
        if self.is_mdx
            && (bun_core::strings::contains(text, b"\\*")
                || bun_core::strings::contains(text, b"\\_"))
        {
            let mut index = 0;
            while let Some(&byte) = text.get(index) {
                match (byte, text.get(index + 1)) {
                    (b'\\', Some(&next @ (b'*' | b'_'))) => {
                        unescaped.push(next);
                        index += 2;
                    }
                    (b'\\', Some(next)) if next.is_ascii_punctuation() => {
                        unescaped.extend_from_slice(&[byte, *next]);
                        index += 2;
                    }
                    _ => {
                        unescaped.push(byte);
                        index += 1;
                    }
                }
            }
            text = &unescaped;
        }

        // The strings are slices of the file, or of a copy if something was removed.
        let is_copy = !without_markers.is_empty() || !unescaped.is_empty();
        let base = match is_copy {
            true => self.tree.owned(|out| out.extend_from_slice(text)),
            false => {
                let start = node.start + (text.as_ptr().addr() - raw.as_ptr().addr()) as u32;
                Str::source(start, start + text.len() as u32)
            }
        };
        let is_risky = ancestry.paragraph.is_some_and(|(paragraph, _)| {
            self.tree
                .get(paragraph)
                .is_some_and(|it| it.kind == Kind::Paragraph && it.spread)
        });
        if is_risky {
            if let Some(node) = self.tree.get_mut(id) {
                node.value = base;
            }
            return;
        }
        // Without wrapping, words only matter if they aren't plain ASCII, or if they may need escapes.
        if !self.wraps_lines
            && text.is_ascii()
            && !((ancestry.is_in_emphasis || self.is_mdx)
                && bun_core::strings::index_of_any(text, b"*_").is_some())
        {
            if let Some(node) = self.tree.get_mut(id) {
                (node.kind, node.value, node.number, node.is_aligned) =
                    (Kind::Sentence, base, PLAIN, ancestry.is_in_emphasis);
            }
            return;
        }
        let first_token = self.tree.tokens.len();
        let mut tokens = std::mem::take(&mut self.tree.tokens);
        split_text(text, |start, end| base.slice(start, end), &mut tokens);
        self.tree.tokens = tokens;
        let count = self.tree.tokens.len() - first_token;
        if let Some(node) = self.tree.get_mut(id) {
            (node.kind, node.first_align, node.number) =
                (Kind::Sentence, first_token as u32, count as u32);
        }
    }
}
