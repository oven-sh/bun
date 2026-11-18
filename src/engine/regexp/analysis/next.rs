use core::ops::{BitAnd, BitOr};

use crate::set::{CharRange, Latin1Set};

/// What can come next in the subject, and possibly more: code units, and the edge of the subject.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) struct Next {
    latin1: Latin1Set,
    /// The high bytes of the other units. Zero stands for the edge.
    pages: Latin1Set,
}

const EDGE: Latin1Set = Latin1Set::of(&[0]);

/// A set that has just been written word by word is slow to read as a whole.
static SINGLE: [Latin1Set; 256] = {
    let (mut sets, mut c) = ([Latin1Set::EMPTY; 256], 0);
    while c < sets.len() {
        sets[c].insert(c as u8);
        c += 1;
    }
    sets
};

impl Next {
    pub(crate) const NOTHING: Next = Next::from_latin1(Latin1Set::EMPTY);
    pub(crate) const EDGE: Next = Next {
        latin1: Latin1Set::EMPTY,
        pages: EDGE,
    };
    pub(crate) const ANY_UNIT: Next = Next {
        latin1: Latin1Set::ALL,
        pages: EDGE.complement(),
    };
    pub(crate) const ANYTHING: Next = Next {
        latin1: Latin1Set::ALL,
        pages: Latin1Set::ALL,
    };

    pub(crate) const fn from_latin1(latin1: Latin1Set) -> Next {
        Next {
            latin1,
            pages: Latin1Set::EMPTY,
        }
    }

    #[inline]
    pub(crate) fn latin1(&self) -> &Latin1Set {
        &self.latin1
    }

    #[inline]
    pub(crate) fn has_wide(&self) -> bool {
        !self.pages.is_subset_of(&EDGE)
    }

    #[inline]
    pub(crate) fn of_unit(unit: u16) -> Next {
        match unit.to_be_bytes() {
            [0, low] => Next::from_latin1(SINGLE[usize::from(low)]),
            [high, _] => Next {
                latin1: Latin1Set::EMPTY,
                pages: SINGLE[usize::from(high)],
            },
        }
    }

    /// The part of `range` that is above Latin-1 and fits in a unit.
    pub(crate) fn insert_wide(&mut self, range: CharRange) {
        if range.first <= 0xffff && range.last > 0xff {
            let (first, last) = (range.first.max(0x100), range.last.min(0xffff));
            self.pages
                .insert_range((first >> 8) as u8, (last >> 8) as u8);
        }
    }

    #[inline]
    pub(crate) fn intersects(&self, other: &Next) -> bool {
        self.latin1.intersects(&other.latin1) || self.pages.intersects(&other.pages)
    }

    pub(crate) fn intersects_wide(&self, range: CharRange) -> bool {
        let mut other = Next::NOTHING;
        other.insert_wide(range);
        self.intersects(&other)
    }

    /// The units, ascending.
    pub(crate) fn ranges(&self) -> impl Iterator<Item = CharRange> {
        self.latin1.ranges().chain(self.wide_ranges())
    }

    /// The units above Latin-1, ascending.
    pub(crate) fn wide_ranges(&self) -> impl Iterator<Item = CharRange> {
        let pages = (self.pages - EDGE).ranges();
        pages.map(|pages| CharRange::new(pages.first << 8, pages.last << 8 | 0xff))
    }
}

impl BitOr for Next {
    type Output = Next;

    #[inline]
    fn bitor(self, other: Next) -> Next {
        Next {
            latin1: self.latin1 | other.latin1,
            pages: self.pages | other.pages,
        }
    }
}

impl BitAnd for Next {
    type Output = Next;

    #[inline]
    fn bitand(self, other: Next) -> Next {
        Next {
            latin1: self.latin1 & other.latin1,
            pages: self.pages & other.pages,
        }
    }
}
