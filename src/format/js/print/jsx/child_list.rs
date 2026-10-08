//! The children of an element. Prettier's `printJsxChildren` and what `printJsxElementInternal`
//! does with the result.

use super::FormatJsxChild;
use crate::ir::element::{Group as GroupTag, GroupMode};
use crate::js::utils::jsx::{
    JsxRawSpace, JsxSpace, has_line_break, is_jsx_whitespace, is_meaningful_jsx_text, is_whitespace_jsx_expression,
};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::write;
use smallvec::SmallVec;

/// What can be between two children.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum Separator {
    /// A space. At the end of a line it has to be written as `{" "}`.
    JsxWhitespace,
    Line,
    SoftLine,
    HardLine,
}

impl<'a> Format<'a> for Separator {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self {
            Separator::JsxWhitespace => JsxSpace.fmt(f),
            Separator::Line => soft_line_break_or_space().fmt(f),
            Separator::SoftLine => soft_line_break().fmt(f),
            Separator::HardLine => hard_line_break().fmt(f),
        }
    }
}

#[derive(Copy, Clone)]
enum Item<'a> {
    /// A word of a text.
    Word(&'a [u8]),
    /// An element, or something in braces.
    Node(Expr<'a>),
}

/// An entry of Prettier's `children`. As in a fill, contents and separators take turns.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum Part {
    /// `items[start..end]`. Empty, it is Prettier's `""`.
    Content { start: u32, end: u32 },
    Separator(Separator),
}

impl Part {
    fn is_empty_content(self) -> bool {
        matches!(self, Part::Content { start, end } if start == end)
    }

    /// Prettier's `isEmptyStringOrAnyLine`.
    fn is_empty_content_or_any_line(self) -> bool {
        match self {
            Part::Content { start, end } => start == end,
            Part::Separator(separator) => separator != Separator::JsxWhitespace,
        }
    }
}

/// A child as it is in ESTree, after `{" "}` has been made a text.
#[derive(Copy, Clone)]
enum Child<'a> {
    Text(&'a [u8]),
    Node(Expr<'a>),
}

impl Child<'_> {
    /// `<a />`
    fn is_self_closing_element(self) -> bool {
        matches!(self, Child::Node(e) if e.jsx_container_span().is_none()
            && matches!(e.kind(), ExprKind::Jsx(jsx) if jsx.is_self_closing()))
    }
}

/// `word.length === 1`
fn is_single_code_unit(word: &[u8]) -> bool {
    let mut chars = bstr::ByteSlice::chars(word);
    chars.next().is_some_and(|c| c.len_utf16() == 1) && chars.next().is_none()
}

fn split_leading_whitespace(text: &[u8]) -> (&[u8], &[u8]) {
    text.split_at(text.iter().take_while(|b| is_jsx_whitespace(**b)).count())
}

fn split_first_word(text: &[u8]) -> (&[u8], &[u8]) {
    text.split_at(text.iter().take_while(|b| !is_jsx_whitespace(**b)).count())
}

/// The number of line breaks in `whitespace`.
fn count_line_breaks(whitespace: &[u8]) -> usize {
    let mut bytes = whitespace.iter().peekable();
    let mut count = 0;
    while let Some(byte) = bytes.next() {
        match byte {
            b'\r' => {
                bytes.next_if_eq(&&b'\n');
                count += 1;
            }
            b'\n' => count += 1,
            _ => {}
        }
    }
    count
}

#[derive(Copy, Clone, Default)]
struct ChildrenMeta {
    /// There is an element or a fragment.
    contains_tag: bool,
    /// There is more than one `{e}`.
    contains_multiple_expressions: bool,
    /// There is text that is not only white space with a line break, or `{" "}`.
    contains_text: bool,
}

/// Prettier's `printJsxChildren`, before anything is formatted.
struct Children<'a> {
    items: SmallVec<[Item<'a>; 16]>,
    parts: SmallVec<[Part; 32]>,
    /// `<fbt>`: Facebook's translation tag, in which white space is kept as it is.
    is_facebook_translation_tag: bool,
    meta: ChildrenMeta,
}

impl<'a> Children<'a> {
    fn push(&mut self, item: Item<'a>) {
        self.items.push(item);
        if let Some(Part::Content { end, .. }) = self.parts.last_mut() {
            *end = self.items.len() as u32;
        }
    }

    fn push_line(&mut self, separator: Separator) {
        let at = self.items.len() as u32;
        self.parts.push(Part::Separator(separator));
        self.parts.push(Part::Content { start: at, end: at });
    }

    /// Prettier's `separatorNoWhitespace`. `word`: the word next to the place.
    fn push_separator_no_whitespace(&mut self, word: &[u8], is_next_to_self_closing_element: bool) {
        if self.is_facebook_translation_tag {
            return;
        }
        self.push_line(match is_next_to_self_closing_element && !is_single_code_unit(word) {
            true => Separator::HardLine,
            false => Separator::SoftLine,
        });
    }

    /// Prettier's `separatorWithWhitespace`. `word`: the word next to the place.
    fn push_separator_with_whitespace(&mut self, word: &[u8], is_next_to_self_closing_element: bool) {
        let is_soft =
            !self.is_facebook_translation_tag && is_single_code_unit(word) && !is_next_to_self_closing_element;
        self.push_line(if is_soft { Separator::SoftLine } else { Separator::HardLine });
    }

    fn push_text(&mut self, text: &'a [u8], next: Option<Child<'a>>) {
        if !is_meaningful_jsx_text(text) {
            // Up to one empty line between two children is kept.
            if count_line_breaks(text) > 1 {
                self.push_line(Separator::HardLine);
            }
            return;
        }
        self.meta.contains_text = true;
        let is_before_self_closing_element = next.is_some_and(Child::is_self_closing_element);

        let (leading_whitespace, mut rest) = split_leading_whitespace(text);
        if !leading_whitespace.is_empty() {
            match has_line_break(leading_whitespace) {
                true => self.push_separator_with_whitespace(split_first_word(rest).0, is_before_self_closing_element),
                false => self.push_line(Separator::JsxWhitespace),
            }
        }

        let mut last_word: &[u8] = &[];
        while !rest.is_empty() {
            let (word, after_word) = split_first_word(rest);
            let (whitespace, after_whitespace) = split_leading_whitespace(after_word);
            self.push(Item::Word(word));
            last_word = word;
            rest = after_whitespace;
            if !rest.is_empty() {
                self.push_line(Separator::Line);
            } else if whitespace.is_empty() {
                self.push_separator_no_whitespace(last_word, is_before_self_closing_element);
            } else if has_line_break(whitespace) {
                self.push_separator_with_whitespace(last_word, is_before_self_closing_element);
            } else {
                self.push_line(Separator::JsxWhitespace);
            }
        }
    }

    fn push_node(&mut self, node: Expr<'a>, next: Option<Child<'a>>) {
        if node.jsx_container_span().is_none() {
            self.meta.contains_tag = true;
        }
        self.push(Item::Node(node));
        match next {
            Some(Child::Text(text)) if is_meaningful_jsx_text(text) => {
                let first_word = split_first_word(split_leading_whitespace(text).1).0;
                self.push_separator_no_whitespace(first_word, Child::Node(node).is_self_closing_element());
            }
            _ => self.push_line(Separator::HardLine),
        }
    }

    fn new(jsx: Jsx<'a>, f: &Formatter<'a>) -> Self {
        let mut children = Children {
            items: SmallVec::new(),
            parts: SmallVec::new(),
            is_facebook_translation_tag: jsx.tag().is_some_and(|tag| tag.text() == b"fbt"),
            meta: ChildrenMeta::default(),
        };
        children.parts.push(Part::Content { start: 0, end: 0 });

        let (comments, source) = (f.comments(), f.source_text());
        let mut expression_count = 0;
        let mut iter = jsx
            .children_with_whitespace()
            .map(|child| match child {
                JsxChild::Whitespace(span) => Child::Text(source.text_for(&span)),
                JsxChild::Expr(e) if e.is_jsx_text() => Child::Text(e.text()),
                JsxChild::Expr(e) if is_whitespace_jsx_expression(e, comments) => Child::Text(b" "),
                JsxChild::Expr(e) => Child::Node(e),
            })
            .peekable();
        while let Some(child) = iter.next() {
            let next = iter.peek().copied();
            match child {
                Child::Text(text) => children.push_text(text, next),
                Child::Node(node) => {
                    let is_expression_container =
                        node.jsx_container_span().is_some() && !matches!(node.kind(), ExprKind::Spread(_));
                    expression_count += usize::from(is_expression_container);
                    children.push_node(node, next);
                }
            }
        }
        children.meta.contains_multiple_expressions = expression_count > 1;
        children.remove_redundant_separators();
        children
    }

    /// Several separators in a row, with nothing between them, are made one. Those at the start and
    /// at the end are removed.
    ///
    /// Prettier goes from the end to the start and splices. Here what is kept is put on a stack,
    /// whose top is the part after the one that is looked at.
    fn remove_redundant_separators(&mut self) {
        use Separator::{HardLine, JsxWhitespace, SoftLine};
        let contains_text = self.meta.contains_text;
        let mut kept: SmallVec<[Part; 32]> = SmallVec::with_capacity(self.parts.len());

        for &part in self.parts.iter().rev() {
            let (next, after_next) = match kept[..] {
                [.., after_next, next] => (Some(next), Some(after_next)),
                [next] => (Some(next), None),
                [] => (None, None),
            };
            let (Part::Separator(separator), Some(next), Some(Part::Separator(after_next))) = (part, next, after_next)
            else {
                kept.push(part);
                continue;
            };
            if !next.is_empty_content() {
                kept.push(part);
                continue;
            }
            match (separator, after_next) {
                (HardLine, HardLine) if !contains_text => kept.push(part),
                (HardLine, HardLine)
                | (SoftLine | HardLine, JsxWhitespace)
                | (JsxWhitespace, JsxWhitespace)
                | (SoftLine, HardLine)
                | (HardLine, SoftLine) => {
                    kept.pop();
                }
                (JsxWhitespace, SoftLine | HardLine) => {
                    kept.pop();
                    kept.pop();
                    kept.push(part);
                }
                _ => kept.push(part),
            }
        }
        kept.reverse();

        let mut parts = &kept[..];
        while let [rest @ .., last] = parts
            && last.is_empty_content_or_any_line()
        {
            parts = rest;
        }
        while let [first, second, rest @ ..] = parts
            && first.is_empty_content_or_any_line()
            && second.is_empty_content_or_any_line()
        {
            parts = rest;
        }
        self.parts = SmallVec::from_slice(parts);
    }

    fn items_of(&self, part: Part) -> &[Item<'a>] {
        match part {
            Part::Content { start, end } => self.items.get(start as usize..end as usize).unwrap_or_default(),
            Part::Separator(_) => &[],
        }
    }
}

/// Formats the children of `jsx`. `forced_break`: it is known that they are on lines of their own.
pub(super) fn format_children<'a>(jsx: Jsx<'a>, forced_break: bool, f: &mut Formatter<'a>) -> FormatChildrenResult<'a> {
    let children = Children::new(jsx, f);
    let meta = children.meta;
    let mut forced_break = forced_break || meta.contains_tag || meta.contains_multiple_expressions;

    if let [part] = children.parts[..]
        && let [item] = *children.items_of(part)
    {
        return FormatChildrenResult::SingleChild(FormatSingleChild { item, forced_break });
    }

    let mut flat = FlatBuilder {
        result: f.take_vec(),
        disabled: forced_break,
    };
    let mut multiline = MultilineBuilder::new(meta.contains_text, f);
    // The last child that is not white space with a line break is `{/* prettier-ignore */}`.
    let mut is_after_ignore_comment = false;

    let parts = &children.parts[..];
    for (index, &part) in parts.iter().enumerate() {
        let separator = match part {
            Part::Separator(separator) => separator,
            Part::Content { .. } => {
                for item in children.items_of(part) {
                    let node = match *item {
                        Item::Word(word) => {
                            is_after_ignore_comment = false;
                            let word = text_without_whitespace(word);
                            flat.write(&word, f);
                            multiline.write_content(&word, f);
                            continue;
                        }
                        Item::Node(node) => FormatJsxChild(node),
                    };
                    let is_suppressed = is_after_ignore_comment && matches!(node.0.kind(), ExprKind::Jsx(_));
                    is_after_ignore_comment =
                        matches!(node.0.kind(), ExprKind::Missing) && f.comments().is_suppressed(node.span().end);
                    let format_node = format_with(|f| match is_suppressed {
                        true => FormatSuppressedNode(node.span()).fmt(f),
                        false => node.fmt(f),
                    });

                    if forced_break {
                        multiline.write_content(&format_node, f);
                    } else if let Some(element) = f.intern(&format_node) {
                        forced_break = element.will_break(f);
                        let element = format_with(|f| f.write_element(element));
                        flat.disabled = forced_break;
                        flat.write(&element, f);
                        multiline.write_content(&element, f);
                    }
                }
                continue;
            }
        };

        flat.write(&separator, f);
        let previous = |n: usize| index.checked_sub(n).and_then(|at| parts.get(at)).copied();
        let is_after_line_break = previous(1).is_some_and(Part::is_empty_content)
            && previous(2) == Some(Part::Separator(Separator::HardLine));
        if separator == Separator::JsxWhitespace {
            is_after_ignore_comment = false;
            if index == 1 && previous(1).is_some_and(Part::is_empty_content) {
                match parts.len() {
                    // There is nothing else.
                    2 => multiline.write_content(&JsxRawSpace, f),
                    _ => multiline.write_separator(&format_with(|f| write!(f, [JsxRawSpace, hard_line_break()])), f),
                }
                continue;
            }
            let is_last = index + 1 == parts.len();
            if is_last || is_after_line_break {
                multiline.write_content(&JsxRawSpace, f);
                continue;
            }
        }
        if separator == Separator::HardLine {
            forced_break = true;
            flat.disabled = true;
        }
        match separator == Separator::HardLine && is_after_line_break {
            // The printer makes one line break of two in a row.
            true => multiline.write_separator(&empty_line(), f),
            false => multiline.write_separator(&separator, f),
        }
    }

    let flat_children = flat.finish(f);
    let expanded_children = multiline.finish(f);
    match forced_break {
        true => FormatChildrenResult::ForceMultiline(expanded_children),
        false => FormatChildrenResult::BestFitting {
            flat_children,
            expanded_children,
        },
    }
}

pub(super) enum FormatChildrenResult<'a> {
    /// The children are on lines of their own.
    ForceMultiline(FormatMultilineChildren),
    /// They are on the line of the tags if that fits.
    BestFitting {
        flat_children: FormatFlatChildren,
        expanded_children: FormatMultilineChildren,
    },
    /// There is one child and nothing else. It is not formatted yet.
    SingleChild(FormatSingleChild<'a>),
}

/// The children, for when they are on lines of their own: Prettier's `multilineChildren`.
struct MultilineBuilder {
    /// There is text: as many children are on each line as fit. Otherwise each is on its own line.
    is_fill: bool,
    result: Vec<FormatElement>,
}

impl MultilineBuilder {
    fn new(is_fill: bool, f: &mut Formatter<'_>) -> Self {
        let mut result = f.take_vec();
        if is_fill {
            result.push(FormatElement::Tag(Tag::StartEntry));
        }
        Self { is_fill, result }
    }

    /// Appends to the content after the last separator.
    fn write_content<'a>(&mut self, content: &dyn Format<'a>, f: &mut Formatter<'a>) {
        f.write_into(&mut self.result, content);
    }

    fn write_separator<'a>(&mut self, separator: &dyn Format<'a>, f: &mut Formatter<'a>) {
        if self.is_fill {
            self.result.extend([FormatElement::Tag(Tag::EndEntry), FormatElement::Tag(Tag::StartEntry)]);
        }
        f.write_into(&mut self.result, separator);
        if self.is_fill {
            self.result.extend([FormatElement::Tag(Tag::EndEntry), FormatElement::Tag(Tag::StartEntry)]);
        }
    }

    fn finish(mut self, f: &mut Formatter<'_>) -> FormatMultilineChildren {
        if self.is_fill {
            self.result.push(FormatElement::Tag(Tag::EndEntry));
        }
        let elements = f.intern_slice(&self.result);
        f.recycle_vec(self.result);
        FormatMultilineChildren {
            is_fill: self.is_fill,
            elements,
        }
    }
}

pub(super) struct FormatMultilineChildren {
    is_fill: bool,
    elements: Option<FormatElement>,
}

impl<'a> Format<'a> for FormatMultilineChildren {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let format_inner = format_with(|f| {
            let (start, end) = match self.is_fill {
                true => (Tag::StartFill, Tag::EndFill),
                false => (Tag::StartGroup(GroupTag::new().with_mode(GroupMode::Expand)), Tag::EndGroup),
            };
            f.write_element(FormatElement::Tag(start));
            if let Some(elements) = self.elements {
                f.write_element(elements);
            }
            f.write_element(FormatElement::Tag(end));
        });
        write!(f, block_indent(&format_inner));
    }
}

/// The children, for when they are on the line of the tags.
struct FlatBuilder {
    result: Vec<FormatElement>,
    /// It is known that they are not going to be.
    disabled: bool,
}

impl FlatBuilder {
    fn write<'a>(&mut self, content: &dyn Format<'a>, f: &mut Formatter<'a>) {
        if !self.disabled {
            f.write_into(&mut self.result, content);
        }
    }

    fn finish(self, f: &mut Formatter<'_>) -> FormatFlatChildren {
        let elements = if self.disabled { None } else { f.intern_slice(&self.result) };
        f.recycle_vec(self.result);
        FormatFlatChildren { elements }
    }
}

pub(super) struct FormatFlatChildren {
    elements: Option<FormatElement>,
}

impl<'a> Format<'a> for FormatFlatChildren {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if let Some(elements) = self.elements {
            f.write_element(elements);
        }
    }
}

/// With only one child, a group whose line breaks are around the child does what Prettier's choice
/// between the two layouts does.
pub(super) struct FormatSingleChild<'a> {
    item: Item<'a>,
    forced_break: bool,
}

impl<'a> Format<'a> for FormatSingleChild<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let format_inner = format_with(|f| match self.item {
            Item::Word(word) => text_without_whitespace(word).fmt(f),
            Item::Node(node) => FormatJsxChild(node).fmt(f),
        });
        match self.forced_break {
            true => write!(f, block_indent(&format_inner)),
            false => write!(f, soft_block_indent(&format_inner)),
        }
    }
}
