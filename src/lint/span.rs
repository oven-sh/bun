//! Positions in the source text.

/// A range of the source text, in bytes.
#[derive(Copy, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Debug, Default)]
pub struct Span {
    pub start: u32,
    pub end: u32,
}

impl Span {
    #[inline]
    pub const fn new(start: u32, end: u32) -> Span {
        Span { start, end }
    }

    /// The empty range at `at`.
    #[inline]
    pub const fn empty(at: u32) -> Span {
        Span { start: at, end: at }
    }

    #[inline]
    pub const fn len(self) -> u32 {
        self.end.saturating_sub(self.start)
    }

    #[inline]
    pub const fn is_empty(self) -> bool {
        self.end <= self.start
    }

    /// From the start of `self` to the end of `other`.
    #[inline]
    pub const fn to(self, other: Span) -> Span {
        Span {
            start: self.start,
            end: other.end,
        }
    }

    /// What is between the end of `self` and the start of `other`.
    #[inline]
    pub const fn between(self, other: Span) -> Span {
        Span {
            start: self.end,
            end: other.start,
        }
    }

    #[inline]
    pub const fn contains(self, other: Span) -> bool {
        self.start <= other.start && other.end <= self.end
    }

    #[inline]
    pub const fn contains_offset(self, offset: u32) -> bool {
        self.start <= offset && offset < self.end
    }

    #[inline]
    pub const fn overlaps(self, other: Span) -> bool {
        self.start < other.end && other.start < self.end
    }

    /// The range without its first `start` and its last `end` bytes.
    #[inline]
    pub const fn shrink(self, start: u32, end: u32) -> Span {
        Span {
            start: self.start + start,
            end: self.end.saturating_sub(end),
        }
    }

    #[inline]
    pub fn range(self) -> std::ops::Range<usize> {
        self.start as usize..(self.end.max(self.start)) as usize
    }
}

/// Everything that has a place in the source text: a node, a token, a comment, a [`Span`].
pub trait Spanned {
    fn span(&self) -> Span;
}

impl Spanned for Span {
    #[inline]
    fn span(&self) -> Span {
        *self
    }
}

impl<T: Spanned> Spanned for &T {
    #[inline]
    fn span(&self) -> Span {
        (**self).span()
    }
}

/// A line and a column, as ESLint counts them: lines from 1, columns from 0 in UTF-16 code units.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}
