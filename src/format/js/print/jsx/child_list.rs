//! The children of an element. Prettier's `printJsxChildren` and what `printJsxElementInternal`
//! does with the result.

use super::FormatJsxChild;
use crate::core::element::{Group as GroupTag, GroupMode};
use crate::js::utils::jsx::{
    JsxChild, JsxRawSpace, JsxSpace, is_meaningful_jsx_text, is_self_closing_element, is_whitespace_jsx_expression,
    jsx_split_children,
};
use crate::js::utils::suppressed::FormatSuppressedNode;
use crate::prelude::*;
use crate::{format_args, write};

pub(super) struct FormatJsxChildList {
    pub(super) layout: JsxChildListLayout,
}

impl FormatJsxChildList {
    pub(super) fn fmt_children<'a>(&self, jsx: Jsx<'a>, f: &mut Formatter<'a>) -> FormatChildrenResult<'a> {
        let children_meta = Self::children_meta(jsx, f.comments());
        let layout = self.layout(children_meta);
        let multiline_layout = match children_meta.meaningful_text {
            true => MultilineLayout::Fill,
            false => MultilineLayout::NoFill,
        };

        let mut force_multiline = layout.is_multiline();
        let mut flat = FlatBuilder {
            result: f.take_vec(),
            disabled: force_multiline,
        };
        let mut multiline = MultilineBuilder {
            layout: multiline_layout,
            result: f.take_vec(),
        };

        let mut children = jsx_split_children(jsx, f.comments(), f.source_text());

        // A line break before the closing tag means nothing.
        if let Some(JsxChild::EmptyLine | JsxChild::Newline) = children.last() {
            children.pop();
        }
        if let [child] = children[..] {
            f.recycle_vec(flat.result);
            f.recycle_vec(multiline.result);
            return FormatChildrenResult::SingleChild(FormatSingleChild {
                child,
                force_multiline,
            });
        }
        // Neither does one after the opening tag.
        let children = match children.first() {
            Some(JsxChild::Newline | JsxChild::EmptyLine) => children.get(1..).unwrap_or_default(),
            _ => &children[..],
        };

        let is_self_closing = |child: Option<&JsxChild<'a>>| matches!(child, Some(JsxChild::NonText(it)) if is_self_closing_element(*it));
        let mut is_next_child_suppressed = false;
        let mut last: Option<&JsxChild<'a>> = None;

        for (index, child) in children.iter().enumerate() {
            let next = children.get(index + 1);
            let mut child_breaks = false;

            match child {
                JsxChild::Word(word) => {
                    let separator = match next {
                        Some(JsxChild::Word(_)) => Some(WordSeparator::BetweenWords),
                        // `a<b />` is split after the text, unless that is a single character.
                        Some(JsxChild::NonText(_)) => Some(WordSeparator::EndOfText {
                            is_soft_line_break: !is_self_closing(next) || word.is_single_character(),
                        }),
                        Some(JsxChild::Newline | JsxChild::Whitespace | JsxChild::EmptyLine) | None => None,
                    };
                    child_breaks = separator.is_some_and(WordSeparator::will_break);

                    flat.write(&format_args!(word, separator), f);
                    match separator {
                        Some(separator) => multiline.write_with_separator(word, &separator, f),
                        None => multiline.write_content(word, f),
                    }
                }

                JsxChild::Whitespace => {
                    flat.write(&JsxSpace, f);
                    if next.is_none() {
                        // `<a>b{" "}</a>`
                        multiline.write_separator_in_last_entry(&JsxRawSpace, f);
                    } else if last.is_none() {
                        // `<a>{" "}b</a>`
                        multiline.write_with_separator(&JsxRawSpace, &hard_line_break(), f);
                    } else {
                        multiline.write_separator(&JsxSpace, f);
                    }
                }

                JsxChild::Newline => {
                    // A single character, like a `,` or a `.`, stays with what it is next to.
                    let is_soft_break = if let Some(JsxChild::Word(word)) = last {
                        !is_self_closing(next) && word.is_single_character()
                    } else if let Some(JsxChild::Word(next_word)) = next {
                        let next_next = children.get(index + 2);
                        let has_new_line_and_self_closing =
                            matches!(next_next, Some(JsxChild::Newline)) && is_self_closing(children.get(index + 3));
                        !has_new_line_and_self_closing
                            && !is_self_closing(next_next)
                            && next_word.is_single_character()
                            && (!next_word.is_single_alphabetic_character() || !matches!(next_next, Some(JsxChild::Word(_))))
                    } else {
                        false
                    };

                    if is_soft_break {
                        multiline.write_separator(&soft_line_break(), f);
                    } else {
                        child_breaks = true;
                        multiline.write_separator(&hard_line_break(), f);
                    }
                }

                JsxChild::EmptyLine => {
                    child_breaks = true;
                    // Next to text, empty lines are not kept.
                    match children_meta.meaningful_text {
                        true => multiline.write_separator(&hard_line_break(), f),
                        false => multiline.write_separator(&empty_line(), f),
                    }
                }

                JsxChild::NonText(non_text) => {
                    let non_text = FormatJsxChild(*non_text);
                    let line_mode = match next {
                        Some(JsxChild::Word(word)) => {
                            match is_self_closing_element(non_text.0) && !word.is_single_character() {
                                true => Some(LineMode::Hard),
                                false => Some(LineMode::Soft),
                            }
                        }
                        Some(JsxChild::NonText(_)) => Some(LineMode::Hard),
                        Some(JsxChild::Newline | JsxChild::Whitespace | JsxChild::EmptyLine) | None => None,
                    };
                    child_breaks = line_mode.is_some_and(LineMode::is_hard);

                    let child_should_be_suppressed = is_next_child_suppressed;
                    let format_child = format_with(|f| match child_should_be_suppressed {
                        true => FormatSuppressedNode(non_text.span()).fmt(f),
                        false => non_text.fmt(f),
                    });

                    // `{/* prettier-ignore */}` is about the next child.
                    is_next_child_suppressed = child_breaks
                        && matches!(next, Some(JsxChild::NonText(_)))
                        && matches!(non_text.0.kind(), ExprKind::Missing)
                        && f.comments().is_suppressed(non_text.span().end);

                    let format_separator =
                        line_mode.map(|mode| format_with(move |f: &mut Formatter<'a>| f.write_element(FormatElement::Line(mode))));

                    if force_multiline {
                        match &format_separator {
                            Some(format_separator) => multiline.write_with_separator(&format_child, format_separator, f),
                            None => multiline.write_content(&format_child, f),
                        }
                    } else {
                        let memoized = non_text.memoized();
                        child_breaks = memoized.inspect(f).will_break();
                        if !child_breaks {
                            flat.write(&format_args!(memoized, format_separator), f);
                        }
                        match &format_separator {
                            Some(format_separator) => multiline.write_with_separator(&memoized, format_separator, f),
                            None => multiline.write_content(&memoized, f),
                        }
                    }
                }
            }

            if child_breaks {
                flat.disabled = true;
                force_multiline = true;
            }
            last = Some(child);
        }

        let flat_children = flat.finish(f);
        let expanded_children = multiline.finish(f);
        match force_multiline {
            true => FormatChildrenResult::ForceMultiline(expanded_children),
            false => FormatChildrenResult::BestFitting {
                flat_children,
                expanded_children,
            },
        }
    }

    fn children_meta<'a>(jsx: Jsx<'a>, comments: &Comments<'a>) -> ChildrenMeta {
        let mut meta = ChildrenMeta::default();
        let mut has_expression = false;
        for child in jsx.children() {
            if child.is_jsx_text() {
                meta.meaningful_text = meta.meaningful_text || is_meaningful_jsx_text(child.text());
            } else if child.jsx_container_span().is_none() {
                meta.any_tag = true;
            } else if matches!(child.kind(), ExprKind::Spread(_)) {
            } else if is_whitespace_jsx_expression(child, comments) {
                meta.meaningful_text = true;
            } else {
                meta.multiple_expressions = has_expression;
                has_expression = true;
            }
        }
        meta
    }

    fn layout(&self, meta: ChildrenMeta) -> JsxChildListLayout {
        match self.layout {
            JsxChildListLayout::BestFitting if !meta.any_tag && !meta.multiple_expressions => {
                JsxChildListLayout::BestFitting
            }
            _ => JsxChildListLayout::Multiline,
        }
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
    SingleChild(FormatSingleChild<'a>),
}

#[derive(Debug, Default, Copy, Clone)]
pub(super) enum JsxChildListLayout {
    #[default]
    BestFitting,
    Multiline,
}

impl JsxChildListLayout {
    const fn is_multiline(self) -> bool {
        matches!(self, Self::Multiline)
    }
}

#[derive(Copy, Clone, Debug, Default)]
struct ChildrenMeta {
    /// There is an element or a fragment.
    any_tag: bool,
    /// There is more than one `{e}`.
    multiple_expressions: bool,
    /// There is text that is not only white space with a line break, or `{" "}`.
    meaningful_text: bool,
}

#[derive(Copy, Clone, Debug)]
enum WordSeparator {
    /// `a b`
    BetweenWords,
    /// `a<b />`, `a{b}`
    EndOfText { is_soft_line_break: bool },
}

impl WordSeparator {
    fn will_break(self) -> bool {
        matches!(
            self,
            Self::EndOfText {
                is_soft_line_break: false
            }
        )
    }
}

impl<'a> Format<'a> for WordSeparator {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self {
            Self::BetweenWords => soft_line_break_or_space().fmt(f),
            Self::EndOfText {
                is_soft_line_break: true,
            } => soft_line_break().fmt(f),
            Self::EndOfText {
                is_soft_line_break: false,
            } => hard_line_break().fmt(f),
        }
    }
}

#[derive(Copy, Clone, Debug)]
enum MultilineLayout {
    /// As many on each line as fit: there is text.
    Fill,
    /// Each on its own line.
    NoFill,
}

/// The children, for when they are on lines of their own. In a fill, contents and separators take
/// turns.
struct MultilineBuilder {
    layout: MultilineLayout,
    result: Vec<FormatElement>,
}

impl MultilineBuilder {
    fn write_content<'a>(&mut self, content: &dyn Format<'a>, f: &mut Formatter<'a>) {
        self.write(content, None, f);
    }

    fn write_separator<'a>(&mut self, separator: &dyn Format<'a>, f: &mut Formatter<'a>) {
        self.write(separator, None, f);
    }

    fn write_with_separator<'a>(&mut self, content: &dyn Format<'a>, separator: &dyn Format<'a>, f: &mut Formatter<'a>) {
        self.write(content, Some(separator), f);
    }

    fn write<'a>(&mut self, content: &dyn Format<'a>, separator: Option<&dyn Format<'a>>, f: &mut Formatter<'a>) {
        match self.layout {
            MultilineLayout::Fill => {
                for entry in [Some(content), separator].into_iter().flatten() {
                    self.result.push(FormatElement::Tag(Tag::StartEntry));
                    f.write_into(&mut self.result, entry);
                    self.result.push(FormatElement::Tag(Tag::EndEntry));
                }
            }
            MultilineLayout::NoFill => {
                f.write_into(&mut self.result, content);
                if let Some(separator) = separator {
                    f.write_into(&mut self.result, separator);
                }
            }
        }
    }

    /// At the end of the last entry, so that it does not count as a separator.
    fn write_separator_in_last_entry<'a>(&mut self, separator: &dyn Format<'a>, f: &mut Formatter<'a>) {
        if matches!(self.result.last(), Some(FormatElement::Tag(Tag::EndEntry))) {
            self.result.pop();
            f.write_into(&mut self.result, separator);
            self.result.push(FormatElement::Tag(Tag::EndEntry));
        } else {
            self.write_content(separator, f);
        }
    }

    fn finish(self, f: &mut Formatter<'_>) -> FormatMultilineChildren {
        let elements = f.intern_slice(&self.result);
        f.recycle_vec(self.result);
        FormatMultilineChildren {
            layout: self.layout,
            elements,
        }
    }
}

pub(super) struct FormatMultilineChildren {
    layout: MultilineLayout,
    elements: Option<FormatElement>,
}

impl<'a> Format<'a> for FormatMultilineChildren {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let format_inner = format_with(|f| {
            let Some(elements) = self.elements else {
                return;
            };
            let (start, end) = match self.layout {
                MultilineLayout::Fill => (Tag::StartFill, Tag::EndFill),
                MultilineLayout::NoFill => (Tag::StartGroup(GroupTag::new().with_mode(GroupMode::Expand)), Tag::EndGroup),
            };
            f.write_elements([FormatElement::Tag(start), elements, FormatElement::Tag(end)]);
        });
        write!(f, group(&block_indent(&format_inner)));
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

pub(super) struct FormatSingleChild<'a> {
    child: JsxChild<'a>,
    force_multiline: bool,
}

impl<'a> Format<'a> for FormatSingleChild<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let format_inner = format_with(|f| match self.child {
            JsxChild::Word(word) => word.fmt(f),
            JsxChild::Whitespace => JsxSpace.fmt(f),
            JsxChild::NonText(non_text) => FormatJsxChild(non_text).fmt(f),
            JsxChild::Newline | JsxChild::EmptyLine => {}
        });
        match self.force_multiline {
            true => write!(f, block_indent(&format_inner)),
            false => write!(f, soft_block_indent(&format_inner)),
        }
    }
}
