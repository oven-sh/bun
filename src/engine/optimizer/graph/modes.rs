//! Sets of indexing modes.

use bun_engine_vm::{ElementKind, ExitKind, IndexingMode};

/// A bit for each mode.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct ModeSet(u64);

impl ModeSet {
    pub(crate) const BITS_OF_MODE: u8 = 0x3f;
    pub(crate) const NONE: Self = Self(0);
    pub(crate) const ANY: Self = Self::of_kind(ElementKind::None)
        .or(Self::DENSE)
        .or(Self::of_kind(ElementKind::Sparse));
    pub(crate) const DENSE: Self = Self::of_kind(ElementKind::Undecided)
        .or(Self::VALUES)
        .or(Self::of_kind(ElementKind::Double));
    pub(crate) const EMPTY: Self =
        Self::of_kind(ElementKind::None).or(Self::of_kind(ElementKind::Undecided));
    pub(crate) const UNDECIDED: Self = Self::of_kind(ElementKind::Undecided);
    /// The elements are tagged.
    pub(crate) const VALUES: Self =
        Self::of_kind(ElementKind::Int32).or(Self::of_kind(ElementKind::Contiguous));
    pub(crate) const ARRAY: Self = Self::matching(IndexingMode::IS_ARRAY, IndexingMode::IS_ARRAY);
    pub(crate) const NON_ARRAY: Self = Self::matching(IndexingMode::IS_ARRAY, 0);
    pub(crate) const SHARED: Self =
        Self::matching(IndexingMode::COPY_ON_WRITE, IndexingMode::COPY_ON_WRITE);
    pub(crate) const RESTRICTED: Self =
        Self::matching(IndexingMode::SLOW_PUT, IndexingMode::SLOW_PUT);
    pub(crate) const WRITABLE: Self =
        Self::matching(IndexingMode::COPY_ON_WRITE | IndexingMode::SLOW_PUT, 0);

    const fn matching(mask: u8, expected: u8) -> Self {
        let (mut bits, mut mode) = (0, 0);
        while mode <= Self::BITS_OF_MODE {
            bits |= ((mode & mask == expected) as u64) << mode;
            mode += 1;
        }
        Self(bits)
    }

    pub(crate) const fn of_kind(kind: ElementKind) -> Self {
        Self::matching(IndexingMode::KIND_MASK, kind as u8)
    }

    pub(crate) const fn single(mode: IndexingMode) -> Self {
        Self(1 << mode.bits())
    }

    pub(crate) const fn or(self, other: Self) -> Self {
        Self(self.0 | other.0)
    }

    pub(crate) const fn and(self, other: Self) -> Self {
        Self(self.0 & other.0)
    }

    pub(crate) const fn without(self, other: Self) -> Self {
        Self(self.0 & !other.0)
    }

    pub(crate) const fn contains(self, other: Self) -> bool {
        other.0 & !self.0 == 0
    }

    pub(crate) const fn intersects(self, other: Self) -> bool {
        self.0 & other.0 != 0
    }

    /// If they are all of one.
    pub(crate) fn only_kind(self) -> Option<ElementKind> {
        let kind = IndexingMode::from_bits(self.iter().next()?).kind();
        Self::of_kind(kind).contains(self).then_some(kind)
    }

    pub(crate) const fn bits(self) -> u64 {
        self.0
    }

    fn iter(self) -> impl Iterator<Item = u8> + Clone {
        (0..=Self::BITS_OF_MODE).filter(move |&mode| self.0 >> mode & 1 != 0)
    }

    /// What to subtract from a mode, and the bits of the difference that are all clear for the members and for none of
    /// `others`.
    pub(crate) fn test_against(self, others: Self) -> Option<(u8, u8)> {
        let least = self.iter().next()?;
        [0, least].into_iter().find_map(|base| {
            let set = (self.iter()).fold(0, |set, mode| set | mode.wrapping_sub(base));
            let mask = !set & Self::BITS_OF_MODE;
            let mut differences = others.iter().map(|mode| mode.wrapping_sub(base));
            differences.all(|it| it & mask != 0).then_some((base, mask))
        })
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) struct ModeCheck {
    pub(crate) wanted: ModeSet,
    /// What need not be looked for is not in here.
    pub(crate) known: ModeSet,
    pub(crate) failure: ExitKind,
}
