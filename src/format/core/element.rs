//! The intermediate representation: what the syntax is turned into, and what the printer turns
//! into text.
//!
//! A document is a flat sequence of [`FormatElement`]s. Nesting is expressed by pairs of start and
//! end [`Tag`]s. An element is 16 bytes and `Copy`: it never owns anything. Text is a range of the
//! source or of the formatter's own text buffer, and a sub-document that is written in more than
//! one place is a range of the formatter's pool.

use std::num::NonZeroU32;

const _: () = assert!(size_of::<FormatElement>() == 16);

#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum FormatElement {
    /// Nothing: the place of a start tag that turned out not to be needed. See
    /// `Formatter::reserve_tag`.
    Nop,
    /// A space, unless it would end up at the start or at the end of a line.
    Space,
    Line(LineMode),
    /// Forces the enclosing groups to break.
    ExpandParent,
    /// A keyword or a punctuator: ASCII, without line breaks or tabs.
    Token(Token),
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
    Tag(Tag),
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
        bytes.get_mut(..text.len())?.copy_from_slice(text.as_bytes());
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

    #[inline]
    pub(crate) const fn single(width: u32) -> Self {
        Self(width & !Self::MULTILINE)
    }

    #[inline]
    pub(crate) const fn multiline(width: u32) -> Self {
        Self(width | Self::MULTILINE)
    }

    #[inline]
    pub(crate) const fn value(self) -> u32 {
        self.0 & !Self::MULTILINE
    }

    #[inline]
    pub(crate) const fn is_multiline(self) -> bool {
        self.0 & Self::MULTILINE != 0
    }

    /// `text` can have tabs, `\n` and anything else. A tab counts as nothing, like any control
    /// character: that is what Prettier's `getStringWidth` does.
    pub(crate) fn from_text(text: &[u8], _indent_width: u8) -> TextWidth {
        let mut width = 0;
        let mut rest = text;
        loop {
            let Some(at) = bun_core::strings::index_of_any(rest, b"\t\n") else {
                return Self::single(width + super::width::string_width(rest));
            };
            width += super::width::string_width(&rest[..at]);
            if rest[at] == b'\n' {
                return Self::multiline(width);
            }
            rest = &rest[at + 1..];
        }
    }
}

impl std::fmt::Debug for TextWidth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}{}", self.value(), if self.is_multiline() { "+" } else { "" })
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
}

impl LineMode {
    pub(crate) const fn is_hard(self) -> bool {
        matches!(self, LineMode::Hard)
    }

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

    pub(crate) const fn is_expanded(self) -> bool {
        matches!(self, PrintMode::Expanded)
    }
}

/// Marks the start or the end of content that is treated in a special way.
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub(crate) enum Tag {
    StartIndent,
    EndIndent,
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

    pub(crate) const fn kind(&self) -> TagKind {
        match self {
            Tag::StartIndent | Tag::EndIndent => TagKind::Indent,
            Tag::StartAlign(_) | Tag::EndAlign => TagKind::Align,
            Tag::StartDedent(_) | Tag::EndDedent(_) => TagKind::Dedent,
            Tag::StartGroup(_) | Tag::EndGroup => TagKind::Group,
            Tag::StartConditionalContent(_) | Tag::EndConditionalContent => {
                TagKind::ConditionalContent
            }
            Tag::StartIndentIfGroupBreaks(_) | Tag::EndIndentIfGroupBreaks(_) => {
                TagKind::IndentIfGroupBreaks
            }
            Tag::StartFill | Tag::EndFill => TagKind::Fill,
            Tag::StartEntry | Tag::EndEntry => TagKind::Entry,
            Tag::StartLineSuffix | Tag::EndLineSuffix => TagKind::LineSuffix,
            Tag::StartLabelled(_) | Tag::EndLabelled => TagKind::Labelled,
        }
    }
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub(crate) enum TagKind {
    Indent,
    Align,
    Dedent,
    Group,
    ConditionalContent,
    IndentIfGroupBreaks,
    Fill,
    Entry,
    LineSuffix,
    Labelled,
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

#[derive(Debug, Copy, Clone, Eq, PartialEq, Default)]
pub(crate) struct Group {
    id: Option<GroupId>,
    mode: GroupMode,
}

impl Group {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    #[must_use]
    pub(crate) fn with_id(mut self, id: Option<GroupId>) -> Self {
        self.id = id;
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
        self.id
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
    pub(crate) const fn is_tag(&self) -> bool {
        matches!(self, FormatElement::Tag(_))
    }

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

    pub(crate) const fn is_text(&self) -> bool {
        matches!(
            self,
            FormatElement::SourceText(_) | FormatElement::OwnedText(_) | FormatElement::Token(_)
        )
    }

    pub(crate) const fn is_space(&self) -> bool {
        matches!(self, FormatElement::Space)
    }

    pub(crate) const fn is_line(&self) -> bool {
        matches!(self, FormatElement::Line(_))
    }
}
