//! The vocabulary that documents are written in.
//!
//! | Prettier | here |
//! | --- | --- |
//! | `"text"` | `"text"`, [`token`], [`text`], [`source_text`] |
//! | `line` | [`soft_line_break_or_space`] |
//! | `softline` | [`soft_line_break`] |
//! | `hardline` | [`hard_line_break`] |
//! | `[hardline, hardline]` | [`empty_line`] |
//! | `" "` | [`space`] |
//! | `group(x)`, `group(x, { shouldBreak, id })` | [`group`], `.should_expand(..)`, `.with_group_id(..)` |
//! | `conditionalGroup([a, b])` | `best_fitting!(a, b)` |
//! | `indent(x)` | [`indent`] |
//! | `[indent([softline, x]), softline]` | [`soft_block_indent`] |
//! | `[indent([line, x]), line]` | [`soft_space_or_block_indent`] |
//! | `[indent([hardline, x]), hardline]` | [`block_indent`] |
//! | `indent([line, x])` | [`soft_line_indent_or_space`] |
//! | `align(n, x)` | [`align`] |
//! | `dedent(x)`, `dedentToRoot(x)` | [`dedent`], [`dedent_to_root`] |
//! | `ifBreak(a, b, { groupId })` | [`if_group_breaks`] and [`if_group_fits_on_line`], `.with_group_id(..)` |
//! | `indentIfBreak(x, { groupId })` | [`indent_if_group_breaks`] |
//! | `fill([..])` | `f.fill()` |
//! | `join(sep, [..])` | `f.join_with(sep)` |
//! | `lineSuffix(x)` | [`line_suffix`] |
//! | `lineSuffixBoundary` | [`line_suffix_boundary`] |
//! | `breakParent` | [`expand_parent`] |
//! | `label(l, x)` | [`labelled`] |

use super::element::{
    self, Condition, DedentMode, FormatElement, GroupId, GroupMode, LabelId, LineMode, PrintMode,
    Tag, TextWidth,
};
use super::formatter::{Format, Formatter};
use bun_lint::span::Span;
use std::cell::Cell;

/// Nothing if the enclosing group fits on a line, otherwise a line break.
#[inline]
pub(crate) const fn soft_line_break() -> Line {
    Line(LineMode::Soft)
}

/// Nothing if the enclosing group fits on a line, otherwise a line break and an empty line: what
/// Prettier prints for a `softline` right behind a line break of another group.
#[inline]
pub(crate) const fn soft_empty_line() -> Line {
    Line(LineMode::SoftEmpty)
}

/// A line break, which also makes the enclosing groups break.
#[inline]
pub(crate) const fn hard_line_break() -> Line {
    Line(LineMode::Hard)
}

/// A line break and an empty line.
#[inline]
pub(crate) const fn empty_line() -> Line {
    Line(LineMode::Empty)
}

/// A space if the enclosing group fits on a line, otherwise a line break.
#[inline]
pub(crate) const fn soft_line_break_or_space() -> Line {
    Line(LineMode::SoftOrSpace)
}

/// A space if the enclosing group fits on a line, otherwise a line break and an empty line.
/// Prettier's `[line, softline]`.
#[inline]
pub(crate) const fn soft_empty_line_or_space() -> Line {
    Line(LineMode::SoftOrSpaceEmpty)
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct Line(LineMode);

impl<'a> Format<'a> for Line {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::Line(self.0));
    }
}

/// Content that is written by a closure, which can be called more than once.
#[inline]
pub(crate) const fn format_with<'a, T>(formatter: T) -> FormatWith<T>
where
    T: Fn(&mut Formatter<'a>),
{
    FormatWith(formatter)
}

#[derive(Copy, Clone)]
pub(crate) struct FormatWith<T>(T);

impl<'a, T: Fn(&mut Formatter<'a>)> Format<'a> for FormatWith<T> {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        (self.0)(f);
    }
}

/// Content that is written by a closure that can only be called once. Writing it a second time
/// writes nothing.
#[inline]
pub(crate) const fn format_once<'a, T>(formatter: T) -> FormatOnce<T>
where
    T: FnOnce(&mut Formatter<'a>),
{
    FormatOnce(Cell::new(Some(formatter)))
}

pub(crate) struct FormatOnce<T>(Cell<Option<T>>);

impl<'a, T: FnOnce(&mut Formatter<'a>)> Format<'a> for FormatOnce<T> {
    #[inline(always)]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let formatter = self.0.take();
        debug_assert!(formatter.is_some(), "a `format_once` is written twice");
        if let Some(formatter) = formatter {
            formatter(f);
        }
    }
}

/// A keyword or a punctuator: ASCII, without line breaks or tabs. A string literal does the same.
#[inline(always)]
pub(crate) fn token(text: &'static str) -> &'static str {
    debug_assert!(text.bytes().all(|c| c.is_ascii() && !matches!(c, b'\r' | b'\n' | b'\t')));
    text
}

/// Any text without `\r`. It is copied unless it is part of the source text.
#[inline]
pub(crate) fn text(text: &[u8]) -> Text<'_> {
    Text { text, width: None }
}

/// Text that has no whitespace in it.
#[inline]
pub(crate) fn text_without_whitespace(text: &[u8]) -> Text<'_> {
    Text {
        text,
        width: Some(TextWidth::single(super::width::string_width(text))),
    }
}

#[derive(Copy, Clone)]
pub(crate) struct Text<'t> {
    text: &'t [u8],
    width: Option<TextWidth>,
}

impl<'a> Format<'a> for Text<'_> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_text(self.text, self.width);
    }
}

/// The source text of `span`, which is a single token without a line break or a tab: an
/// identifier, a number, a regular expression. This is the cheapest way to write text.
#[inline]
pub(crate) const fn source_text(span: Span) -> SourceToken {
    SourceToken(span)
}

#[derive(Copy, Clone)]
pub(crate) struct SourceToken(Span);

impl<'a> Format<'a> for SourceToken {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_source_token(self.0);
    }
}

#[inline]
pub(crate) const fn space() -> Space {
    Space
}

#[inline]
pub(crate) fn maybe_space(should_insert: bool) -> Option<Space> {
    should_insert.then_some(Space)
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) struct Space;

impl<'a> Format<'a> for Space {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::Space);
    }
}

/// Declares a builder that writes its content between two tags.
macro_rules! tagged {
    ($(#[$doc:meta])* $function:ident, $name:ident, $start:expr, $end:expr) => {
        $(#[$doc])*
        #[inline]
        pub(crate) fn $function<Content: ?Sized>(content: &Content) -> $name<'_, Content> {
            $name { content }
        }

        pub(crate) struct $name<'fmt, Content: ?Sized> {
            content: &'fmt Content,
        }

        impl<Content: ?Sized> Copy for $name<'_, Content> {}
        impl<Content: ?Sized> Clone for $name<'_, Content> {
            fn clone(&self) -> Self {
                *self
            }
        }

        impl<'a, Content: Format<'a> + ?Sized> Format<'a> for $name<'_, Content> {
            #[inline]
            fn fmt(&self, f: &mut Formatter<'a>) {
                f.write_element(FormatElement::Tag($start));
                self.content.fmt(f);
                f.write_element(FormatElement::Tag($end));
            }
        }
    };
}

tagged! {
    /// Content that is printed at the end of the line, before the next line break: a comment.
    line_suffix, LineSuffix, Tag::StartLineSuffix, Tag::EndLineSuffix
}
tagged! {
    /// Line breaks in the content are followed by one more level of indentation.
    indent, Indent, Tag::StartIndent, Tag::EndIndent
}
tagged! {
    /// Undoes one level of indentation.
    dedent, Dedent, Tag::StartDedent(DedentMode::Level), Tag::EndDedent(DedentMode::Level)
}
tagged! {
    /// Line breaks in the content are followed by no indentation at all.
    dedent_to_root, DedentToRoot, Tag::StartDedent(DedentMode::Root), Tag::EndDedent(DedentMode::Root)
}

/// Pending line suffixes are printed here at the latest, followed by a line break.
#[inline]
pub(crate) const fn line_suffix_boundary() -> LineSuffixBoundary {
    LineSuffixBoundary
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) struct LineSuffixBoundary;

impl<'a> Format<'a> for LineSuffixBoundary {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::LineSuffixBoundary);
    }
}

/// Marks the content, for whoever writes the parent: `elements.has_label(..)`.
#[inline]
pub(crate) fn labelled<Content: ?Sized>(
    label_id: LabelId,
    content: &Content,
) -> FormatLabelled<'_, Content> {
    FormatLabelled { label_id, content }
}

pub(crate) struct FormatLabelled<'fmt, Content: ?Sized> {
    label_id: LabelId,
    content: &'fmt Content,
}

impl<'a, Content: Format<'a> + ?Sized> Format<'a> for FormatLabelled<'_, Content> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::Tag(Tag::StartLabelled(self.label_id)));
        self.content.fmt(f);
        f.write_element(FormatElement::Tag(Tag::EndLabelled));
    }
}

/// Line breaks in the content are followed by `count` more spaces. Nothing special happens if
/// `count` is 0.
#[inline]
pub(crate) fn align<Content: ?Sized>(count: u8, content: &Content) -> Align<'_, Content> {
    Align { count, content }
}

pub(crate) struct Align<'fmt, Content: ?Sized> {
    count: u8,
    content: &'fmt Content,
}

impl<'a, Content: Format<'a> + ?Sized> Format<'a> for Align<'_, Content> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if self.count == 0 {
            return self.content.fmt(f);
        }
        f.write_element(FormatElement::Tag(Tag::StartAlign(element::Align(self.count))));
        self.content.fmt(f);
        f.write_element(FormatElement::Tag(Tag::EndAlign));
    }
}

/// The content on lines of its own, indented.
#[inline]
pub(crate) fn block_indent<Content: ?Sized>(content: &Content) -> BlockIndent<'_, Content> {
    BlockIndent {
        content,
        mode: IndentMode::Block,
    }
}

/// If the enclosing group breaks, the content on lines of its own, indented.
#[inline]
pub(crate) fn soft_block_indent<Content: ?Sized>(content: &Content) -> BlockIndent<'_, Content> {
    BlockIndent {
        content,
        mode: IndentMode::Soft,
    }
}

/// [`soft_space_or_block_indent`] or [`soft_block_indent`].
#[inline]
pub(crate) fn soft_block_indent_with_maybe_space<Content: ?Sized>(
    content: &Content,
    should_add_space: bool,
) -> BlockIndent<'_, Content> {
    match should_add_space {
        true => soft_space_or_block_indent(content),
        false => soft_block_indent(content),
    }
}

/// If the enclosing group breaks, the content on the next line, indented. Otherwise a space and
/// the content.
#[inline]
pub(crate) fn soft_line_indent_or_space<Content: ?Sized>(
    content: &Content,
) -> BlockIndent<'_, Content> {
    BlockIndent {
        content,
        mode: IndentMode::SoftLineOrSpace,
    }
}

/// If the enclosing group breaks, the content on lines of its own, indented. Otherwise the
/// content between spaces.
#[inline]
pub(crate) fn soft_space_or_block_indent<Content: ?Sized>(
    content: &Content,
) -> BlockIndent<'_, Content> {
    BlockIndent {
        content,
        mode: IndentMode::SoftSpace,
    }
}

pub(crate) struct BlockIndent<'fmt, Content: ?Sized> {
    content: &'fmt Content,
    mode: IndentMode,
}

impl<Content: ?Sized> Copy for BlockIndent<'_, Content> {}
impl<Content: ?Sized> Clone for BlockIndent<'_, Content> {
    fn clone(&self) -> Self {
        *self
    }
}

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
enum IndentMode {
    Soft,
    Block,
    SoftSpace,
    SoftLineOrSpace,
}

impl<'a, Content: Format<'a> + ?Sized> Format<'a> for BlockIndent<'_, Content> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let (before, after) = match self.mode {
            IndentMode::Soft => (LineMode::Soft, Some(LineMode::Soft)),
            IndentMode::Block => (LineMode::Hard, Some(LineMode::Hard)),
            IndentMode::SoftSpace => (LineMode::SoftOrSpace, Some(LineMode::SoftOrSpace)),
            IndentMode::SoftLineOrSpace => (LineMode::SoftOrSpace, None),
        };
        f.write_element(FormatElement::Tag(Tag::StartIndent));
        f.write_element(FormatElement::Line(before));
        self.content.fmt(f);
        f.write_element(FormatElement::Tag(Tag::EndIndent));
        if let Some(after) = after {
            f.write_element(FormatElement::Line(after));
        }
    }
}

/// Content that is written on one line if it fits, and otherwise with all the line breaks that
/// are directly in it.
#[inline]
pub(crate) fn group<Content: ?Sized>(content: &Content) -> Group<'_, Content> {
    Group {
        content,
        group_id: None,
        should_expand: false,
    }
}

pub(crate) struct Group<'fmt, Content: ?Sized> {
    content: &'fmt Content,
    group_id: Option<GroupId>,
    should_expand: bool,
}

impl<Content: ?Sized> Copy for Group<'_, Content> {}
impl<Content: ?Sized> Clone for Group<'_, Content> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<Content: ?Sized> Group<'_, Content> {
    #[must_use]
    pub(crate) fn with_group_id(mut self, group_id: Option<GroupId>) -> Self {
        self.group_id = group_id;
        self
    }

    /// Whether it breaks even if it fits.
    #[must_use]
    pub(crate) fn should_expand(mut self, should_expand: bool) -> Self {
        self.should_expand = should_expand;
        self
    }
}

impl<'a, Content: Format<'a> + ?Sized> Format<'a> for Group<'_, Content> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mode = match self.should_expand {
            true => GroupMode::Expand,
            false => GroupMode::Flat,
        };
        let group = element::Group::new().with_id(self.group_id).with_mode(mode);
        f.write_element(FormatElement::Tag(Tag::StartGroup(group)));
        self.content.fmt(f);
        f.write_element(FormatElement::Tag(Tag::EndGroup));
    }
}

/// Makes the enclosing groups break.
#[inline]
pub(crate) const fn expand_parent() -> ExpandParent {
    ExpandParent
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) struct ExpandParent;

impl<'a> Format<'a> for ExpandParent {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::ExpandParent);
    }
}

/// Content that is only written if the enclosing group breaks, or the one that
/// [`IfGroupBreaks::with_group_id`] names.
#[inline]
pub(crate) fn if_group_breaks<Content: ?Sized>(content: &Content) -> IfGroupBreaks<'_, Content> {
    IfGroupBreaks {
        content,
        group_id: None,
        mode: PrintMode::Expanded,
    }
}

/// Content that is only written if the group fits on a line.
#[inline]
pub(crate) fn if_group_fits_on_line<Content: ?Sized>(
    content: &Content,
) -> IfGroupBreaks<'_, Content> {
    IfGroupBreaks {
        content,
        group_id: None,
        mode: PrintMode::Flat,
    }
}

pub(crate) struct IfGroupBreaks<'fmt, Content: ?Sized> {
    content: &'fmt Content,
    group_id: Option<GroupId>,
    mode: PrintMode,
}

impl<Content: ?Sized> IfGroupBreaks<'_, Content> {
    /// The group has to come before this in the document.
    #[must_use]
    pub(crate) fn with_group_id(mut self, group_id: Option<GroupId>) -> Self {
        self.group_id = group_id;
        self
    }
}

impl<'a, Content: Format<'a> + ?Sized> Format<'a> for IfGroupBreaks<'_, Content> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let condition = Condition::new(self.mode).with_group_id(self.group_id);
        f.write_element(FormatElement::Tag(Tag::StartConditionalContent(condition)));
        self.content.fmt(f);
        f.write_element(FormatElement::Tag(Tag::EndConditionalContent));
    }
}

/// Indents the content if the group `group_id` breaks, which has to come before this in the
/// document.
#[inline]
pub(crate) fn indent_if_group_breaks<Content: ?Sized>(
    content: &Content,
    group_id: GroupId,
) -> IndentIfGroupBreaks<'_, Content> {
    IndentIfGroupBreaks { content, group_id }
}

pub(crate) struct IndentIfGroupBreaks<'fmt, Content: ?Sized> {
    content: &'fmt Content,
    group_id: GroupId,
}

impl<'a, Content: Format<'a> + ?Sized> Format<'a> for IndentIfGroupBreaks<'_, Content> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.write_element(FormatElement::Tag(Tag::StartIndentIfGroupBreaks(self.group_id)));
        self.content.fmt(f);
        f.write_element(FormatElement::Tag(Tag::EndIndentIfGroupBreaks(self.group_id)));
    }
}

/// What `best_fitting!` makes.
pub(crate) struct BestFitting<'fmt, 'a> {
    variants: &'fmt [&'fmt dyn Format<'a>],
}

impl<'fmt, 'a> BestFitting<'fmt, 'a> {
    /// From the flattest to the most expanded. At least two.
    pub(crate) fn new(variants: &'fmt [&'fmt dyn Format<'a>]) -> Self {
        debug_assert!(variants.len() >= 2);
        BestFitting { variants }
    }
}

impl<'a> Format<'a> for BestFitting<'_, 'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let mut formatted = smallvec::SmallVec::<[element::Interned; 4]>::new();
        for variant in self.variants {
            formatted.push(f.capture(&format_with(|f| {
                f.write_element(FormatElement::Tag(Tag::StartEntry));
                variant.fmt(f);
                f.write_element(FormatElement::Tag(Tag::EndEntry));
            })));
        }
        let element = f.best_fitting_of(&formatted);
        f.write_element(element);
    }
}

/// Writes entries with a separator between them.
#[must_use = "must eventually call `finish()` on Format builders"]
pub(crate) struct JoinBuilder<'fmt, 'a, Separator> {
    pub(crate) fmt: &'fmt mut Formatter<'a>,
    with: Option<Separator>,
    has_elements: bool,
}

impl<'a, Separator: Format<'a>> JoinBuilder<'_, 'a, Separator> {
    pub(crate) fn entry(&mut self, entry: &(impl Format<'a> + ?Sized)) -> &mut Self {
        if let Some(with) = &self.with
            && self.has_elements
        {
            with.fmt(self.fmt);
        }
        self.has_elements = true;
        entry.fmt(self.fmt);
        self
    }

    pub(crate) fn entries<F: Format<'a>>(
        &mut self,
        entries: impl IntoIterator<Item = F>,
    ) -> &mut Self {
        for entry in entries {
            self.entry(&entry);
        }
        self
    }
}

/// Writes items with separators between them, as many on each line as fit.
#[must_use = "must eventually call `finish()` on Format builders"]
pub(crate) struct FillBuilder<'fmt, 'a> {
    fmt: &'fmt mut Formatter<'a>,
    empty: bool,
}

impl<'a> FillBuilder<'_, 'a> {
    /// `separator` is written before `entry`, unless it is the first.
    pub(crate) fn entry(
        &mut self,
        separator: &(impl Format<'a> + ?Sized),
        entry: &(impl Format<'a> + ?Sized),
    ) -> &mut Self {
        if self.empty {
            self.empty = false;
        } else {
            self.fmt.write_element(FormatElement::Tag(Tag::StartEntry));
            separator.fmt(self.fmt);
            self.fmt.write_element(FormatElement::Tag(Tag::EndEntry));
        }
        self.fmt.write_element(FormatElement::Tag(Tag::StartEntry));
        entry.fmt(self.fmt);
        self.fmt.write_element(FormatElement::Tag(Tag::EndEntry));
        self
    }

    pub(crate) fn finish(&mut self) {
        self.fmt.write_element(FormatElement::Tag(Tag::EndFill));
    }
}

impl<'a> Formatter<'a> {
    pub(crate) fn join<'fmt>(&'fmt mut self) -> JoinBuilder<'fmt, 'a, ()> {
        JoinBuilder {
            fmt: self,
            with: None,
            has_elements: false,
        }
    }

    pub(crate) fn join_with<'fmt, Joiner: Format<'a>>(
        &'fmt mut self,
        joiner: Joiner,
    ) -> JoinBuilder<'fmt, 'a, Joiner> {
        JoinBuilder {
            fmt: self,
            with: Some(joiner),
            has_elements: false,
        }
    }

    pub(crate) fn fill<'fmt>(&'fmt mut self) -> FillBuilder<'fmt, 'a> {
        self.write_element(FormatElement::Tag(Tag::StartFill));
        FillBuilder {
            fmt: self,
            empty: true,
        }
    }
}
