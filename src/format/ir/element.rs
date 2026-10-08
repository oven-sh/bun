//! The intermediate representation: what the syntax is turned into, and what the printer turns
//! into text.
//!
//! A document is a flat sequence of [`FormatElement`]s. Nesting is expressed by pairs of start and
//! end [`Tag`]s. An element is 16 bytes and `Copy`: it never owns anything. Text is a range of the
//! source or of the formatter's own text buffer, and a sub-document that is written in more than
//! one place is a range of the formatter's pool.

use crate::options::Flavor;
use std::num::NonZeroU32;

const _: () = assert!(size_of::<FormatElement>() == 16);

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum FormatElement {
    /// Nothing: the place of a start tag that turned out not to be needed. See
    /// `Formatter::reserve_tag`.
    Nop,
    /// The next so many elements are not part of what this is in. They are what an [`Interned`]
    /// is a range of, left where they were written. See `Formatter::capture`.
    Skip(Skip),
    /// A space, unless it would end up at the start or at the end of a line.
    Space,
    Line(LineMode),
    /// The same as a group with this id, and in it an indent, and in that a
    /// [`LineMode::SoftOrSpace`]: a line break that is taken, with one more level of indentation
    /// after it, if what follows it does not fit on the line.
    IndentedLineGroup(GroupId),
    /// Forces the enclosing groups to break.
    ExpandParent,
    /// A keyword or a punctuator: ASCII, without line breaks or tabs.
    Token(Token),
    /// One that is only written if the enclosing group breaks: the same as a [`FormatElement::Token`]
    /// in a [`Tag::StartConditionalContent`] for [`PrintMode::Expanded`] without a group id.
    TokenIfBreaks(Token),
    /// A range of the source text.
    SourceText(Text),
    /// A range of the formatter's text buffer.
    OwnedText(Text),
    /// Line suffixes do not move past this. If there are any pending, they are printed, and a
    /// line break after them.
    LineSuffixBoundary,
    /// Content that is stored once and can be written any number of times.
    Interned(Interned),
    /// Several ways to write the same thing. The printer picks the first that fits.
    BestFitting(BestFitting),
    /// Prettier's `cursor`: the printer notes where in the text this is. It has no width and no
    /// effect on anything.
    Cursor(CursorMark),
    Tag(Tag),
}

/// An end of the part of the text that the cursor is in. See `cursor.rs`.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum CursorMark {
    /// Of several that are printed, the last counts.
    RegionStart,
    /// Of several that are printed, the first counts.
    RegionEnd,
}

/// See [`FormatElement::Skip`].
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct Skip {
    /// The number of elements.
    pub(crate) len: u32,
    /// What they are on one line.
    pub(crate) flat: Flat,
    /// What `Storage::will_break` says about them.
    pub(crate) will_break: bool,
}

impl Skip {
    #[inline]
    pub(crate) fn new(len: u32) -> Self {
        Skip {
            len,
            flat: Flat::default(),
            will_break: false,
        }
    }
}

/// What `document::propagate_expand` finds out about the content of a group, or about interned
/// content: all that the printer has to know to tell whether it fits on the rest of a line.
///
/// A space is pending until a text follows it, and two in a row are one. So the spaces before
/// the first text and after the last are not part of the width.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub(crate) struct Flat {
    /// The number of columns from the start of the first text to the end of the last. 0 if there
    /// is no text: content with a text that has no width is not measured.
    pub(crate) width: u16,
    pub(crate) flags: FlatFlags,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub(crate) struct FlatFlags(u8);

impl FlatFlags {
    /// The rest is known, and printing the content flat is only a matter of writing its texts.
    /// It is not set if that depends on what the printer has done before: the content has
    /// something that depends on a group by its id, a line suffix, a forced line break in a
    /// variant.
    pub(crate) const MEASURED: FlatFlags = FlatFlags(1);
    /// A [`FormatElement::Space`] comes after the last text.
    pub(crate) const ENDS_WITH_SPACE_ELEMENT: FlatFlags = FlatFlags(1 << 1);
    /// A line break that is a space on one line comes before the first text.
    pub(crate) const STARTS_WITH_LINE: FlatFlags = FlatFlags(1 << 2);
    /// A [`FormatElement::Space`] comes before the first text. It counts unless the line is empty.
    pub(crate) const STARTS_WITH_SPACE: FlatFlags = FlatFlags(1 << 3);
    /// A space is pending after the last text, be it for a line break or a [`FormatElement::Space`].
    pub(crate) const ENDS_WITH_SPACE: FlatFlags = FlatFlags(1 << 4);
    pub(crate) const HAS_LINE_SUFFIX_BOUNDARY: FlatFlags = FlatFlags(1 << 5);
    /// There is a group with an id in it.
    pub(crate) const HAS_GROUP_IDS: FlatFlags = FlatFlags(1 << 6);
    /// There is a forced line break in it. Of interned content only: a group has its mode.
    pub(crate) const EXPANDS: FlatFlags = FlatFlags(1 << 7);

    #[inline]
    pub(crate) const fn has(self, flag: FlatFlags) -> bool {
        self.0 & flag.0 != 0
    }

    #[inline]
    pub(crate) const fn with(self, flag: FlatFlags, is_set: bool) -> FlatFlags {
        FlatFlags(self.0 | if is_set { flag.0 } else { 0 })
    }
}

/// At most [`Token::MAX`] bytes, stored inline.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) struct Token {
    len: u8,
    bytes: [u8; Token::MAX],
}

impl Token {
    pub(crate) const MAX: usize = 14;

    /// `None` if `text` is too long.
    #[inline(always)]
    pub(crate) fn new(text: &str) -> Option<Token> {
        let mut bytes = [0; Token::MAX];
        bytes
            .get_mut(..text.len())?
            .copy_from_slice(text.as_bytes());
        Some(Token {
            len: text.len() as u8,
            bytes,
        })
    }

    #[inline(always)]
    pub(crate) fn as_bytes(&self) -> &[u8] {
        self.bytes.get(..self.len as usize).unwrap_or_default()
    }

    #[inline(always)]
    pub(crate) fn len(&self) -> usize {
        self.len as usize
    }

    /// With what is behind the text.
    #[inline(always)]
    pub(crate) fn padded(&self) -> &[u8; Token::MAX] {
        &self.bytes
    }
}

impl std::fmt::Debug for Token {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(bstr::BStr::new(self.as_bytes()), f)
    }
}

/// A range of the source text or of the formatter's text buffer, and how wide it is.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct Text {
    pub(crate) start: u32,
    pub(crate) len: u32,
    pub(crate) width: TextWidth,
}

impl Text {
    #[inline]
    pub(crate) fn range(self) -> std::ops::Range<usize> {
        self.start as usize..self.start as usize + self.len as usize
    }
}

/// The number of columns that a text takes up to its first line break, and whether it has one.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) struct TextWidth(u32);

impl TextWidth {
    const MULTILINE: u32 = 1 << 31;
    const ONE_STRING: u32 = 1 << 30;
    const FLAGS: u32 = Self::MULTILINE | Self::ONE_STRING;

    #[inline]
    pub(crate) const fn single(width: u32) -> Self {
        Self(width & !Self::FLAGS)
    }

    /// `width`: up to the first line break. To Prettier the lines are strings with a `literalline`
    /// between them.
    #[inline]
    pub(crate) const fn multiline(width: u32) -> Self {
        Self(width & !Self::FLAGS | Self::MULTILINE)
    }

    /// `width`: of all the lines together. To Prettier it is one string, in which a line break is a
    /// character without width like another: whether it fits is asked of all of it and of what
    /// follows it.
    #[inline]
    pub(crate) const fn multiline_string(width: u32) -> Self {
        Self(width & !Self::FLAGS | Self::FLAGS)
    }

    #[inline]
    pub(crate) const fn value(self) -> u32 {
        self.0 & !Self::FLAGS
    }

    /// See [`TextWidth::multiline_string`].
    #[inline]
    pub(crate) const fn is_one_string(self) -> bool {
        self.0 & Self::ONE_STRING != 0
    }

    #[inline]
    pub(crate) const fn is_multiline(self) -> bool {
        self.0 & Self::MULTILINE != 0
    }

    /// `text` can have tabs, `\n` and anything else. A tab counts as nothing, like any control
    /// character: that is what Prettier's `getStringWidth` does.
    pub(crate) fn from_text(text: &[u8], _indent_width: u8) -> TextWidth {
        Self::from_text_as(text, Flavor::Prettier)
    }

    /// The same as `flavor` counts.
    pub(crate) fn from_text_as(text: &[u8], flavor: Flavor) -> TextWidth {
        if super::width::is_all_printable(text) {
            return Self::single(text.len() as u32);
        }
        let mut width = 0;
        let mut rest = text;
        loop {
            let Some(at) = bun_core::strings::index_of_any(rest, b"\t\n") else {
                return Self::single(width + super::width::string_width_as(rest, flavor));
            };
            width += super::width::string_width_as(&rest[..at], flavor);
            if rest[at] == b'\n' {
                return Self::multiline(width);
            }
            rest = &rest[at + 1..];
        }
    }
}

impl std::fmt::Debug for TextWidth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}{}",
            self.value(),
            if self.is_multiline() { "+" } else { "" }
        )
    }
}

/// A range of the formatter's pool.
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub(crate) struct Interned {
    pub(crate) start: u32,
    pub(crate) len: u32,
}

impl Interned {
    #[inline]
    pub(crate) fn range(self) -> std::ops::Range<usize> {
        self.start as usize..self.start as usize + self.len as usize
    }
}

/// A range of the formatter's table of variants, from the flattest to the most expanded. There
/// are at least two. Each is a [`Tag::StartEntry`], the content and a [`Tag::EndEntry`].
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct BestFitting {
    pub(crate) first: u32,
    pub(crate) count: u32,
}

impl BestFitting {
    #[inline]
    pub(crate) fn range(self) -> std::ops::Range<usize> {
        self.first as usize..self.first as usize + self.count as usize
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum LineMode {
    /// A space if the enclosing group fits on a line, otherwise a line break.
    SoftOrSpace,
    /// Nothing if the enclosing group fits on a line, otherwise a line break.
    Soft,
    /// A line break.
    Hard,
    /// A line break and an empty line.
    Empty,
    /// A space if the enclosing group fits on a line, otherwise a line break and an empty line.
    SoftOrSpaceEmpty,
    /// Nothing if the enclosing group fits on a line, otherwise a line break and an empty line.
    SoftEmpty,
}

impl LineMode {
    /// In the order they are declared.
    pub(crate) const ALL: [LineMode; 6] = [
        LineMode::SoftOrSpace,
        LineMode::Soft,
        LineMode::Hard,
        LineMode::Empty,
        LineMode::SoftOrSpaceEmpty,
        LineMode::SoftEmpty,
    ];

    pub(crate) const fn will_break(self) -> bool {
        matches!(self, LineMode::Hard | LineMode::Empty)
    }
}

#[derive(Debug, Clone, Copy, Eq, PartialEq)]
pub(crate) enum PrintMode {
    /// On one line.
    Flat,
    /// Every soft line break is a line break.
    Expanded,
}

impl PrintMode {
    pub(crate) const fn is_flat(self) -> bool {
        matches!(self, PrintMode::Flat)
    }
}

/// Marks the start or the end of content that is treated in a special way.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum Tag {
    StartIndent,
    EndIndent,
    /// The same as a [`Tag::StartIndent`] and a [`FormatElement::Line`] after it.
    StartIndentWithLine(LineMode),
    /// The same as a [`Tag::EndIndent`] and a [`FormatElement::Line`] after it.
    EndIndentWithLine(LineMode),
    /// Indents by a number of spaces.
    StartAlign(Align),
    EndAlign,
    StartDedent(DedentMode),
    EndDedent(DedentMode),
    /// Content that is written on one line if it fits, and otherwise with all of its own line
    /// breaks.
    StartGroup(Group),
    EndGroup,
    /// Content that is only written if a group breaks, or only if it does not.
    StartConditionalContent(Condition),
    EndConditionalContent,
    StartIndentIfGroupBreaks(GroupId),
    EndIndentIfGroupBreaks(GroupId),
    /// Alternating items and separators, each a [`Tag::StartEntry`] .. [`Tag::EndEntry`]. As many
    /// as fit are written on each line.
    StartFill,
    EndFill,
    StartEntry,
    EndEntry,
    /// Content that is written at the end of the line.
    StartLineSuffix,
    EndLineSuffix,
    /// Has no effect on the printer. It lets the code that writes the parent tell what the
    /// content is.
    StartLabelled(LabelId),
    EndLabelled,
}

impl Tag {
    pub(crate) const fn is_start(&self) -> bool {
        matches!(
            self,
            Tag::StartIndent
                | Tag::StartIndentWithLine(_)
                | Tag::StartAlign(_)
                | Tag::StartDedent(_)
                | Tag::StartGroup(_)
                | Tag::StartConditionalContent(_)
                | Tag::StartIndentIfGroupBreaks(_)
                | Tag::StartFill
                | Tag::StartEntry
                | Tag::StartLineSuffix
                | Tag::StartLabelled(_)
        )
    }

    pub(crate) const fn is_end(&self) -> bool {
        !self.is_start()
    }
}

#[derive(Debug, Copy, Default, Clone, Eq, PartialEq)]
pub(crate) enum GroupMode {
    #[default]
    Flat,
    /// It is written to break.
    Expand,
    /// It breaks because something in it does.
    Propagated,
}

impl GroupMode {
    pub(crate) const fn is_flat(self) -> bool {
        matches!(self, GroupMode::Flat)
    }
}

/// The halves of the numbers are apart so that it is aligned to two bytes, and the element is 16 bytes.
#[derive(Debug, Copy, Clone, Eq, PartialEq, Default)]
pub(crate) struct Group {
    /// 0 is none.
    id: [u16; 2],
    /// Where the end tag is in the pool, once `flat` is measured.
    end: [u16; 2],
    /// Those of a [`Flat`].
    width: u16,
    flags: FlatFlags,
    mode: GroupMode,
}

impl Group {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub(crate) fn with_id(mut self, id: Option<GroupId>) -> Self {
        let id = id.map_or(0, |id| id.0.get());
        self.id = [id as u16, (id >> 16) as u16];
        self
    }

    #[must_use]
    pub(crate) fn with_mode(mut self, mode: GroupMode) -> Self {
        self.mode = mode;
        self
    }

    #[inline]
    pub(crate) fn mode(&self) -> GroupMode {
        self.mode
    }

    #[inline]
    pub(crate) fn propagate_expand(&mut self) {
        if self.mode == GroupMode::Flat {
            self.mode = GroupMode::Propagated;
        }
    }

    #[inline]
    pub(crate) fn id(&self) -> Option<GroupId> {
        NonZeroU32::new(u32::from(self.id[0]) | u32::from(self.id[1]) << 16).map(GroupId)
    }

    /// What the content is on one line.
    #[inline]
    pub(crate) fn flat(&self) -> Flat {
        Flat {
            width: self.width,
            flags: self.flags,
        }
    }

    /// The index of the end tag. Only if [`Group::flat`] is measured.
    #[inline]
    pub(crate) fn end(&self) -> u32 {
        u32::from(self.end[0]) | u32::from(self.end[1]) << 16
    }

    #[inline]
    pub(crate) fn set_flat(&mut self, flat: Flat, end: u32) {
        (self.width, self.flags) = (flat.width, flat.flags);
        self.end = [end as u16, (end >> 16) as u16];
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) enum DedentMode {
    /// By one level.
    Level,
    /// To the first column.
    Root,
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) struct Condition {
    /// The mode of the group in which the content is written.
    pub(crate) mode: PrintMode,
    /// The group, which comes before the content in the document. `None` is the enclosing one.
    pub(crate) group_id: Option<GroupId>,
}

impl Condition {
    pub(crate) fn new(mode: PrintMode) -> Self {
        Self {
            mode,
            group_id: None,
        }
    }

    #[must_use]
    pub(crate) fn with_group_id(mut self, id: Option<GroupId>) -> Self {
        self.group_id = id;
        self
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) struct Align(pub(crate) u8);

impl Align {
    pub(crate) fn count(self) -> u8 {
        self.0
    }
}

/// Names a group, for content elsewhere that depends on whether the group breaks.
#[derive(Clone, Copy, Eq, PartialEq, Hash)]
pub(crate) struct GroupId(NonZeroU32);

impl GroupId {
    #[inline]
    pub(crate) fn new(value: NonZeroU32) -> Self {
        GroupId(value)
    }

    #[inline]
    pub(crate) fn index(self) -> usize {
        self.0.get() as usize
    }
}

impl std::fmt::Debug for GroupId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "#{}", self.0)
    }
}

/// What [`Tag::StartLabelled`] says about the content.
#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) struct LabelId(JsLabels);

impl LabelId {
    #[inline]
    pub(crate) const fn of(label: JsLabels) -> Self {
        LabelId(label)
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) enum JsLabels {
    /// A chain of calls and member accesses.
    MemberChain,
}

impl FormatElement {
    pub(crate) const fn is_start_tag(&self) -> bool {
        match self {
            FormatElement::Tag(tag) => tag.is_start(),
            _ => false,
        }
    }

    pub(crate) const fn is_end_tag(&self) -> bool {
        match self {
            FormatElement::Tag(tag) => tag.is_end(),
            _ => false,
        }
    }
}
