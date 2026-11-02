//! The intermediate representation: formatting turns the syntax tree into it, and the printer turns it into text.
//!
//! A document is a flat sequence of [`FormatElement`]s. Nesting is expressed by pairs of start and end [`Tag`]s. An
//! element is 16 bytes and `Copy`, so it never owns anything. Text is a range of the source or of the formatter's own
//! text buffer, and a sub-document that's written in more than one place is a range of the formatter's pool.

use crate::options::Flavor;
use std::num::NonZeroU32;

const _: () = assert!(size_of::<FormatElement>() == 16);

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum FormatElement {
    /// A no-op left in the slot reserved for a start tag that turned out not to be needed. See
    /// `Formatter::reserve_tag`.
    Nop,
    /// The next `len` elements aren't part of the enclosing content, so readers skip them. They're captured content
    /// that an [`Interned`] points to, left where it was written. See `Formatter::capture`.
    Skip(Skip),
    /// A space, unless it would end up at the start or at the end of a line.
    Space,
    Line(LineMode),
    /// Shorthand for a group with this id that contains an indent that contains a [`LineMode::SoftOrSpace`]. It breaks,
    /// and indents the next line one more level, if what follows doesn't fit on the line.
    IndentedLineGroup(GroupId),
    /// Forces the enclosing groups to break.
    ExpandParent,
    /// A keyword or punctuator: ASCII, no line breaks or tabs.
    Token(Token),
    /// A token that's only printed if the enclosing group breaks. Shorthand for a [`FormatElement::Token`] in a
    /// [`Tag::StartConditionalContent`] for [`PrintMode::Expanded`] without a group id.
    TokenIfBreaks(Token),
    /// A range of the source text.
    SourceText(Text),
    /// A range of the formatter's text buffer.
    OwnedText(Text),
    /// Line suffixes can't move past this. Any pending ones are printed here, followed by a line break.
    LineSuffixBoundary,
    /// Content that's stored once and can be written any number of times.
    Interned(Interned),
    /// Several ways to write the same thing. The printer picks the first that fits.
    BestFitting(BestFitting),
    /// Prettier's `cursor`. The printer records its offset in the output. It has no width and doesn't affect layout.
    Cursor(CursorMark),
    Tag(Tag),
}

/// One end of the text region that contains the cursor. See `cursor.rs`.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum CursorMark {
    /// If several are printed, the last one wins.
    RegionStart,
    /// If several are printed, the first one wins.
    RegionEnd,
}

/// See [`FormatElement::Skip`].
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) struct Skip {
    /// Number of elements to skip.
    pub(crate) len: u32,
    /// Their flat (one-line) measurements.
    pub(crate) flat: Flat,
    /// The cached result of `Storage::will_break` for them.
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

/// Measurements of a group's content, or of interned content, computed by `document::Tracker`. They're all the printer
/// needs to decide whether the content fits on the rest of a line.
///
/// A space is pending until text follows it, and two in a row collapse into one. So the spaces before the first text
/// and after the last aren't part of the width.
#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub(crate) struct Flat {
    /// Columns from the start of the first text to the end of the last. 0 means there's no text, because content that
    /// has a zero-width text isn't measured.
    pub(crate) width: u16,
    pub(crate) flags: FlatFlags,
}

#[derive(Copy, Clone, Eq, PartialEq, Debug, Default)]
pub(crate) struct FlatFlags(u8);

impl FlatFlags {
    /// The other fields are valid, and printing the content flat just means writing its texts. Not set if the result
    /// depends on earlier printer state, which is the case when the content refers to a group by id, has a line suffix,
    /// or has a forced line break in a variant.
    pub(crate) const MEASURED: FlatFlags = FlatFlags(1);
    /// A [`FormatElement::Space`] comes after the last text.
    pub(crate) const ENDS_WITH_SPACE_ELEMENT: FlatFlags = FlatFlags(1 << 1);
    /// A line break that prints as a space when flat comes before the first text.
    pub(crate) const STARTS_WITH_LINE: FlatFlags = FlatFlags(1 << 2);
    /// A [`FormatElement::Space`] comes before the first text. It counts unless the line is empty.
    pub(crate) const STARTS_WITH_SPACE: FlatFlags = FlatFlags(1 << 3);
    /// A space is pending after the last text, from either a line break or a [`FormatElement::Space`].
    pub(crate) const ENDS_WITH_SPACE: FlatFlags = FlatFlags(1 << 4);
    pub(crate) const HAS_LINE_SUFFIX_BOUNDARY: FlatFlags = FlatFlags(1 << 5);
    /// Contains a group with an id.
    pub(crate) const HAS_GROUP_IDS: FlatFlags = FlatFlags(1 << 6);
    /// Contains a forced line break. Only set for interned content, since a group records this in its mode.
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

    /// Returns all [`Token::MAX`] bytes, including the zero padding after the text.
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

/// A range of the source text or of the formatter's text buffer, plus its width.
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

/// A text's width in columns up to its first line break, plus whether it has one.
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

    /// `width` is measured up to the first line break. Prettier sees the lines as strings joined by `literalline`.
    #[inline]
    pub(crate) const fn multiline(width: u32) -> Self {
        Self(width & !Self::FLAGS | Self::MULTILINE)
    }

    /// `width` is the total of all lines. Prettier sees one string in which a line break is just another zero-width
    /// character, so the fit check covers the whole string and what follows it.
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

    /// `text` may contain tabs, `\n` and anything else. A tab has zero width like any control character, as in
    /// Prettier's `getStringWidth`.
    pub(crate) fn from_text(text: &[u8], _indent_width: u32) -> TextWidth {
        Self::from_text_as(text, Flavor::Prettier)
    }

    /// Same, with `flavor`'s width rules.
    pub(crate) fn from_text_as(text: &[u8], flavor: Flavor) -> TextWidth {
        Self::from_text_with_tabs(text, flavor, 0)
    }

    /// Same, for JavaScript, where oxfmt counts a tab as one indentation level wide.
    pub(crate) fn from_javascript(text: &[u8], flavor: Flavor, indent_width: u32) -> TextWidth {
        let tab_width = if flavor.is_oxfmt() { indent_width } else { 0 };
        Self::from_text_with_tabs(text, flavor, tab_width)
    }

    fn from_text_with_tabs(text: &[u8], flavor: Flavor, tab_width: u32) -> TextWidth {
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
            width += tab_width;
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
    pub(crate) fallback: Fallback,
}

/// The printer's choice when no variant before the last one fits.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum Fallback {
    MostExpanded,
    /// The flattest variant, printed expanded, unless a [`GroupMode::StaysExpanded`] group breaks in it. In that case
    /// it's the most expanded variant, with that group broken. Use it for two variants where the writer picks the
    /// second outright if `will_break()` is true, because that's what `will_break()` returns when the output is
    /// formatted again.
    ///
    /// When expanded, the flattest variant has a line break before the first such group.
    FlattestIfStable,
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
    /// In declaration order, so `mode as usize` is its index.
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
    /// Every soft line break is printed as a line break.
    Expanded,
}

impl PrintMode {
    pub(crate) const fn is_flat(self) -> bool {
        matches!(self, PrintMode::Flat)
    }
}

/// Marks the start or end of content that gets special treatment.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum Tag {
    StartIndent,
    EndIndent,
    /// Shorthand for a [`Tag::StartIndent`] followed by a [`FormatElement::Line`].
    StartIndentWithLine(LineMode),
    /// Shorthand for a [`Tag::EndIndent`] followed by a [`FormatElement::Line`].
    EndIndentWithLine(LineMode),
    /// Indents by a number of spaces.
    StartAlign(Align),
    EndAlign,
    StartDedent(DedentMode),
    EndDedent(DedentMode),
    /// Content that's printed on one line if it fits, and otherwise with all of its direct line breaks broken.
    StartGroup(Group),
    EndGroup,
    /// Content that's only printed if a group breaks, or only if it doesn't.
    StartConditionalContent(Condition),
    EndConditionalContent,
    StartIndentIfGroupBreaks(GroupId),
    EndIndentIfGroupBreaks(GroupId),
    /// Alternating items and separators, each a [`Tag::StartEntry`] .. [`Tag::EndEntry`]. Each line gets as many as
    /// fit.
    StartFill,
    EndFill,
    StartEntry,
    EndEntry,
    /// Content that's printed at the end of the line.
    StartLineSuffix,
    EndLineSuffix,
    /// Has no effect on the printer. It lets the code that writes the parent tell what the content is.
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
}

#[derive(Debug, Copy, Default, Clone, Eq, PartialEq)]
pub(crate) enum GroupMode {
    #[default]
    Flat,
    /// Like `Flat`, but the writer uses [`GroupMode::Expand`] instead when the group is broken in the source. So if
    /// this group breaks because it doesn't fit, it'll be `Expand` when the output is formatted again.
    StaysExpanded,
    /// The writer forces it to break.
    Expand,
    /// It breaks because something inside it forces a break.
    Propagated,
}

impl GroupMode {
    pub(crate) const fn is_flat(self) -> bool {
        matches!(self, GroupMode::Flat | GroupMode::StaysExpanded)
    }
}

/// The `u32`s are stored as `u16` halves so the struct is 2-byte aligned, which keeps [`FormatElement`] at 16 bytes.
#[derive(Debug, Copy, Clone, Eq, PartialEq, Default)]
pub(crate) struct Group {
    /// 0 means no id.
    id: [u16; 2],
    /// The end tag's index in the pool. Only valid once `flat` is measured.
    end: [u16; 2],
    /// `width` and `flags` are the fields of a [`Flat`].
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
        if self.mode.is_flat() {
            self.mode = GroupMode::Propagated;
        }
    }

    #[inline]
    pub(crate) fn id(&self) -> Option<GroupId> {
        NonZeroU32::new(u32::from(self.id[0]) | u32::from(self.id[1]) << 16).map(GroupId)
    }

    /// Returns the content's flat measurements.
    #[inline]
    pub(crate) fn flat(&self) -> Flat {
        Flat {
            width: self.width,
            flags: self.flags,
        }
    }

    /// Returns the end tag's index. Only valid if [`Group::flat`] is measured.
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
    /// The content is printed only if the group is printed in this mode.
    pub(crate) mode: PrintMode,
    /// The group, which must come before the content in the document. `None` means the enclosing group.
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
pub(crate) struct Align(pub(crate) u32);

impl Align {
    pub(crate) fn count(self) -> u32 {
        self.0
    }
}

/// Identifies a group, so content elsewhere can depend on whether it breaks.
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

/// The label that [`Tag::StartLabelled`] attaches to its content.
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
