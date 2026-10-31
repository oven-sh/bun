//! Positions in the source text.

/// A byte range in the source text.
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

    /// An empty span at `at`.
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

    /// A sort key that puts nested spans in tree-walk order: by start, then the longer span first, then by `rank`, then
    /// by `index` (the low 32 bits). Lists of these keys are plain `u128`s, so they all share one sort instantiation.
    #[inline]
    pub fn sort_key(self, rank: u16, index: usize) -> u128 {
        let range = (u128::from(self.start) << 32) | u128::from(u32::MAX - self.end);
        (range << 64) | (u128::from(rank) << 32) | index as u128
    }

    /// From the start of `self` to the end of `other`.
    #[inline]
    pub const fn to(self, other: Span) -> Span {
        Span {
            start: self.start,
            end: other.end,
        }
    }

    /// The gap between the end of `self` and the start of `other`.
    #[inline]
    pub const fn between(self, other: Span) -> Span {
        Span {
            start: self.end,
            end: other.start,
        }
    }

    /// From the end of `previous` to `end`.
    #[inline]
    pub const fn after(previous: Span, end: u32) -> Span {
        Span {
            start: previous.end,
            end,
        }
    }

    /// From `start` to the start of `next`.
    #[inline]
    pub const fn before(start: u32, next: Span) -> Span {
        Span {
            start,
            end: next.start,
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

    /// Drops the first `start` and the last `end` bytes.
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

/// Anything with a source location: a node, a token, a comment or a [`Span`].
pub trait Spanned {
    fn span(&self) -> Span;

    /// Returns the node if this is one.
    #[inline]
    fn packed_node(&self) -> Option<crate::ast::Packed> {
        None
    }
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

    #[inline]
    fn packed_node(&self) -> Option<crate::ast::Packed> {
        (**self).packed_node()
    }
}

/// A line and column as ESLint counts them: 1-based lines, 0-based columns in UTF-16 code units.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub struct Position {
    pub line: u32,
    pub column: u32,
}
