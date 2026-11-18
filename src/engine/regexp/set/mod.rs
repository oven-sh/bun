//! Sets of characters.

mod builder;
mod latin1;
mod ranges;
mod shared;
mod table;

use bun_engine_text::AllocError;
use bun_engine_unicode::MAX_CODE_POINT;

pub use builder::SetBuilder;
pub use latin1::Latin1Set;
pub use shared::SharedSet;
pub use table::LookupTable;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct CharRange {
    pub first: u32,
    pub last: u32,
}

impl CharRange {
    #[inline]
    pub const fn new(first: u32, last: u32) -> CharRange {
        debug_assert!(first <= last);
        CharRange { first, last }
    }

    #[inline]
    pub const fn single(c: u32) -> CharRange {
        CharRange { first: c, last: c }
    }
}

/// A set of code points, complements included. What reads Latin-1 or code units sees the part up to `0xff` or `0xffff`.
pub struct Set {
    latin1: Latin1Set,
    above: Above,
}

/// The members above U+00FF: ascending ranges with a gap between any two.
enum Above {
    Inline(u8, [CharRange; 2]),
    Owned(Box<[CharRange]>),
    Shared(&'static SharedSet),
}

impl Above {
    const NONE: Above = Above::Inline(0, [CharRange::single(0); 2]);
    const ALL: Above = Above::Inline(1, [CharRange::new(0x100, MAX_CODE_POINT); 2]);

    fn inline(ranges: &[CharRange]) -> Option<Above> {
        match *ranges {
            [] => Some(Above::NONE),
            [only] => Some(Above::Inline(1, [only; 2])),
            [first, second] => Some(Above::Inline(2, [first, second])),
            _ => None,
        }
    }

    fn from_slice(ranges: &[CharRange]) -> Result<Above, AllocError> {
        if let Some(inline) = Above::inline(ranges) {
            return Ok(inline);
        }
        let mut owned = Vec::new();
        owned
            .try_reserve_exact(ranges.len())
            .map_err(|_| AllocError)?;
        owned.extend_from_slice(ranges);
        Ok(Above::Owned(owned.into_boxed_slice()))
    }

    fn from_shared(shared: &'static SharedSet) -> Above {
        Above::inline(shared.above()).unwrap_or(Above::Shared(shared))
    }

    fn try_clone(&self) -> Result<Above, AllocError> {
        match *self {
            Above::Inline(length, ranges) => Ok(Above::Inline(length, ranges)),
            Above::Owned(ref ranges) => Above::from_slice(ranges),
            Above::Shared(shared) => Ok(Above::Shared(shared)),
        }
    }
}

const fn latin1_ranges(ranges: &[(u8, u8)]) -> Latin1Set {
    let (mut set, mut index) = (Latin1Set::EMPTY, 0);
    while index < ranges.len() {
        set.insert_range(ranges[index].0, ranges[index].1);
        index += 1;
    }
    set
}

const DIGIT: Latin1Set = latin1_ranges(&[(b'0', b'9')]);
const WORD: Latin1Set = latin1_ranges(&[(b'0', b'9'), (b'A', b'Z'), (b'_', b'_'), (b'a', b'z')]);
const LINE_TERMINATOR: Latin1Set = Latin1Set::of(b"\n\r");

impl Set {
    pub const EMPTY: Set = Set::from_latin1(Latin1Set::EMPTY);
    pub const ALL: Set = Set {
        latin1: Latin1Set::ALL,
        above: Above::ALL,
    };
    pub const DIGIT: Set = Set::from_latin1(DIGIT);
    pub(crate) const NOT_DIGIT: Set = Set {
        latin1: DIGIT.complement(),
        above: Above::ALL,
    };
    pub const WORD: Set = Set::from_latin1(WORD);
    pub(crate) const NOT_WORD: Set = Set {
        latin1: WORD.complement(),
        above: Above::ALL,
    };
    /// WordCharacters of ECMA-262 where case is ignored among code points.
    pub const WORD_IGNORING_CASE: Set = Set {
        latin1: WORD,
        above: Above::Inline(2, [CharRange::single(0x17f), CharRange::single(0x212a)]),
    };
    pub const LINE_TERMINATOR: Set = Set {
        latin1: LINE_TERMINATOR,
        above: Above::Inline(1, [CharRange::new(0x2028, 0x2029); 2]),
    };
    pub const NOT_LINE_TERMINATOR: Set = Set {
        latin1: LINE_TERMINATOR.complement(),
        above: Above::Inline(
            2,
            [
                CharRange::new(0x100, 0x2027),
                CharRange::new(0x202a, MAX_CODE_POINT),
            ],
        ),
    };

    pub fn space() -> Set {
        SharedSet::space().to_set()
    }

    #[inline]
    pub const fn from_latin1(latin1: Latin1Set) -> Set {
        Set {
            latin1,
            above: Above::NONE,
        }
    }

    #[inline]
    fn with_shared(latin1: Latin1Set, shared: &'static SharedSet) -> Set {
        Set {
            latin1,
            above: Above::from_shared(shared),
        }
    }

    /// With the same members above U+00FF.
    pub(crate) fn with_latin1(&self, latin1: Latin1Set) -> Result<Set, AllocError> {
        Ok(Set {
            latin1,
            above: self.above.try_clone()?,
        })
    }

    pub fn try_clone(&self) -> Result<Set, AllocError> {
        Ok(Set {
            latin1: self.latin1,
            above: self.above.try_clone()?,
        })
    }

    #[inline]
    pub fn latin1(&self) -> &Latin1Set {
        &self.latin1
    }

    /// The members above U+00FF: ascending ranges with a gap between any two.
    #[inline]
    pub fn above(&self) -> &[CharRange] {
        match &self.above {
            Above::Inline(length, ranges) => &ranges[..usize::from(*length)],
            Above::Owned(ranges) => ranges,
            Above::Shared(shared) => shared.above(),
        }
    }

    /// One with the same members above U+00FF.
    #[inline]
    pub fn shared(&self) -> Option<&'static SharedSet> {
        match self.above {
            Above::Shared(shared) => Some(shared),
            _ => None,
        }
    }

    /// All members: ascending ranges with a gap between any two.
    pub fn ranges(&self) -> impl Iterator<Item = CharRange> {
        let mut above = self.above();
        let mut joined = None;
        if self.latin1.contains(0xff) && above.first().is_some_and(|range| range.first == 0x100) {
            joined = above.split_off_first();
        }
        let latin1 = self.latin1.ranges().map(move |range| match joined {
            Some(joined) if range.last == 0xff => CharRange::new(range.first, joined.last),
            _ => range,
        });
        latin1.chain(above.iter().copied())
    }

    #[inline]
    pub fn contains(&self, c: u32) -> bool {
        match u8::try_from(c) {
            Ok(c) => self.latin1.contains(c),
            Err(_) => ranges::contains(self.above(), c),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.latin1.is_empty() && self.above().is_empty()
    }

    /// The only member.
    #[inline]
    pub fn single(&self) -> Option<u32> {
        match (self.latin1.len(), self.above()) {
            (1, []) => self.latin1.iter().next().map(u32::from),
            (0, [range]) if range.first == range.last => Some(range.first),
            _ => None,
        }
    }

    pub fn intersects_range(&self, range: CharRange) -> bool {
        latin1_part(range).intersects(&self.latin1) || ranges::intersects(&[range], self.above())
    }

    pub fn contains_range(&self, range: CharRange) -> bool {
        latin1_part(range).is_subset_of(&self.latin1)
            && (range.last <= 0xff
                || ranges::is_subset(
                    &[CharRange::new(range.first.max(0x100), range.last)],
                    self.above(),
                ))
    }

    pub fn intersects(&self, other: &Set) -> bool {
        self.latin1.intersects(&other.latin1) || ranges::intersects(self.above(), other.above())
    }

    pub fn is_subset_of(&self, other: &Set) -> bool {
        self.latin1.is_subset_of(&other.latin1)
            && (self.shares_above_with(other) || ranges::is_subset(self.above(), other.above()))
    }

    pub fn union(&self, other: &Set) -> Result<Set, AllocError> {
        let above = if self.shares_above_with(other) || other.above().is_empty() {
            self.above.try_clone()?
        } else if self.above().is_empty() {
            other.above.try_clone()?
        } else {
            Above::from_slice(&ranges::union(self.above(), other.above())?)?
        };
        Ok(Set {
            latin1: self.latin1 | other.latin1,
            above,
        })
    }

    pub fn intersection(&self, other: &Set) -> Result<Set, AllocError> {
        let above = if self.shares_above_with(other) || other.has_all_above() {
            self.above.try_clone()?
        } else if self.has_all_above() {
            other.above.try_clone()?
        } else {
            Above::from_slice(&ranges::intersection(self.above(), other.above())?)?
        };
        Ok(Set {
            latin1: self.latin1 & other.latin1,
            above,
        })
    }

    pub fn difference(&self, other: &Set) -> Result<Set, AllocError> {
        let above = if other.above().is_empty() {
            self.above.try_clone()?
        } else {
            Above::from_slice(&ranges::difference(self.above(), other.above())?)?
        };
        Ok(Set {
            latin1: self.latin1 - other.latin1,
            above,
        })
    }

    #[inline]
    pub fn complement(&self) -> Result<Set, AllocError> {
        let above = match self.above {
            Above::Inline(0, _) => Above::ALL,
            _ => self.complement_above()?,
        };
        Ok(Set {
            latin1: !self.latin1,
            above,
        })
    }

    fn complement_above(&self) -> Result<Above, AllocError> {
        match self.above {
            Above::Shared(shared) => Ok(Above::from_shared(shared.complement())),
            _ => Above::from_slice(&ranges::complement(self.above())?),
        }
    }

    /// A table of its own, for the characters up to `max`. That of [`Set::shared`] costs nothing.
    pub fn build_table(&self, max: u32) -> Result<LookupTable, AllocError> {
        LookupTable::new(&self.latin1, self.above(), max)
    }

    /// Looks at a fixed number of ranges.
    pub(crate) fn hash(&self) -> u64 {
        let above = self.above();
        let sample = |index: usize| {
            above.get(index).map_or(0, |range| {
                u64::from(range.first) << 32 | u64::from(range.last)
            })
        };
        let [a, b, c, d] = *self.latin1.words();
        let length = above.len();
        let last = length.wrapping_sub(1);
        [a, b, c, d, sample(0), sample(length / 2), sample(last)]
            .into_iter()
            .fold(length as u64, |hash, word| {
                (hash.rotate_left(23) ^ word).wrapping_mul(0x9e37_79b9_7f4a_7c15)
            })
    }

    /// The number of ranges in memory of its own.
    pub(crate) fn owned_ranges(&self) -> usize {
        match &self.above {
            Above::Owned(ranges) => ranges.len(),
            _ => 0,
        }
    }

    fn has_all_above(&self) -> bool {
        self.above() == [CharRange::new(0x100, MAX_CODE_POINT)]
    }

    fn shares_above_with(&self, other: &Set) -> bool {
        matches!(
            (&self.above, &other.above),
            (Above::Shared(a), Above::Shared(b)) if core::ptr::eq(*a, *b)
        )
    }
}

fn latin1_part(range: CharRange) -> Latin1Set {
    let mut part = Latin1Set::EMPTY;
    if let Ok(first) = u8::try_from(range.first) {
        part.insert_range(first, range.last.min(0xff) as u8);
    }
    part
}

impl PartialEq for Set {
    #[inline]
    fn eq(&self, other: &Set) -> bool {
        self.latin1 == other.latin1
            && (self.shares_above_with(other) || self.above() == other.above())
    }
}

impl Eq for Set {}

impl core::fmt::Debug for Set {
    fn fmt(&self, formatter: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        let ranges = self.ranges().map(|range| range.first..=range.last);
        formatter.debug_set().entries(ranges).finish()
    }
}
