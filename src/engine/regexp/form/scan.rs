use std::sync::OnceLock;

use bun_engine_text::CodeUnit;
use bun_highway::text::{ByteTable, MINIMUM_LENGTH, count_unit, find_in_tables, find_unit};

use crate::set::{Latin1Set, Set};

/// Searches for each width.
pub(super) trait Unit: CodeUnit + bun_highway::text::Unit {
    fn select<'a>(latin1: Option<&'a [u8]>, utf16: &'a [u16]) -> Option<&'a [Self]>;
    fn find_unit(units: &[Self], unit: u16) -> Option<usize>;
    fn find_units(units: &[Self], needle: &[Self]) -> Option<usize>;
    fn count(units: &[Self], unit: u16) -> usize;
}

impl Unit for u8 {
    #[inline(always)]
    fn select<'a>(latin1: Option<&'a [u8]>, _: &'a [u16]) -> Option<&'a [u8]> {
        latin1
    }

    #[inline(always)]
    fn find_unit(units: &[u8], unit: u16) -> Option<usize> {
        find_unit(units, u8::try_from(unit).ok()?)
    }

    #[inline(always)]
    fn find_units(units: &[u8], needle: &[u8]) -> Option<usize> {
        bun_highway::memmem(units, needle)
    }

    fn count(units: &[u8], unit: u16) -> usize {
        u8::try_from(unit).map_or(0, |unit| count_unit(units, unit))
    }
}

impl Unit for u16 {
    #[inline(always)]
    fn select<'a>(_: Option<&'a [u8]>, utf16: &'a [u16]) -> Option<&'a [u16]> {
        Some(utf16)
    }

    #[inline(always)]
    fn find_unit(units: &[u16], unit: u16) -> Option<usize> {
        find_unit(units, unit)
    }

    #[inline(always)]
    fn find_units(units: &[u16], needle: &[u16]) -> Option<usize> {
        bun_highway::memmem16(units, needle)
    }

    fn count(units: &[u16], unit: u16) -> usize {
        count_unit(units, unit)
    }
}

/// Looking at so many units one by one takes about as long as starting to look at many at once.
const NEAR: usize = 24;

/// A set of code units.
pub(super) struct Members {
    set: Set,
    latin1: Box<[bool; 256]>,
    only: Option<u16>,
    /// For the members, and possibly more.
    tables: OnceLock<[ByteTable; 3]>,
    are_common: bool,
}

impl Members {
    pub(super) fn new(set: Set) -> Members {
        const COMMON: Latin1Set = Latin1Set::of(b" etaoinsr");
        let mut latin1 = Box::new([false; 256]);
        for range in set.latin1().ranges() {
            latin1[range.first as usize..=range.last as usize].fill(true);
        }
        Members {
            latin1,
            only: set.single().and_then(|it| it.try_into().ok()),
            tables: OnceLock::new(),
            are_common: set.latin1().intersects(&COMMON),
            set,
        }
    }

    /// In usual text.
    #[inline(always)]
    pub(super) fn are_several_and_common(&self) -> bool {
        self.are_common && self.only.is_none()
    }

    #[inline(always)]
    fn contains<C: Unit>(&self, unit: C) -> bool {
        match self.latin1.get(usize::from(unit.to_u16())) {
            Some(&is_member) => is_member,
            None => self.set.contains(unit.to_u32()),
        }
    }

    #[inline(always)]
    pub(super) fn find<C: Unit>(&self, units: &[C]) -> Option<usize> {
        match self.only {
            Some(only) => C::find_unit(units, only),
            None if self.are_common => self.find_nearby(units),
            None => self.find_far_away(units, 0),
        }
    }

    #[inline(always)]
    fn find_nearby<C: Unit>(&self, units: &[C]) -> Option<usize> {
        let near = &units[..units.len().min(NEAR)];
        let found = near.iter().position(|&unit| self.contains(unit));
        found.or_else(|| self.find_far_away(units, near.len()))
    }

    #[inline(never)]
    fn find_far_away<C: Unit>(&self, units: &[C], mut start: usize) -> Option<usize> {
        loop {
            let mut end = units.len();
            if end - start >= MINIMUM_LENGTH {
                let tables = self.tables.get_or_init(|| self.make_tables());
                let skipped = find_in_tables(&units[start..], tables)?;
                start += skipped;
                end = end.min(start + if skipped < NEAR / 2 { NEAR } else { 1 });
            }
            if let Some(found) = units[start..end].iter().position(|&it| self.contains(it)) {
                return Some(start + found);
            }
            if end == units.len() {
                return None;
            }
            start = end;
        }
    }

    #[cold]
    fn make_tables(&self) -> [ByteTable; 3] {
        let (mut high, mut low) = (Latin1Set::EMPTY, Latin1Set::EMPTY);
        for range in self.set.above().iter().take_while(|it| it.first <= 0xffff) {
            let [first_high, first_low] = (range.first as u16).to_be_bytes();
            let [last_high, last_low] = (range.last.min(0xffff) as u16).to_be_bytes();
            high.insert_range(first_high, last_high);
            match last_high - first_high {
                0 => low.insert_range(first_low, last_low),
                1 => {
                    low.insert_range(first_low, u8::MAX);
                    low.insert_range(0, last_low);
                }
                _ => low = Latin1Set::ALL,
            }
        }
        [self.set.latin1(), &high, &low].map(|it| ByteTable::new(it.words()))
    }

    #[inline(always)]
    pub(super) fn leading<C: Unit>(&self, units: &[C]) -> usize {
        units.iter().take_while(|&&it| self.contains(it)).count()
    }

    #[inline(always)]
    pub(super) fn trailing<C: Unit>(&self, units: &[C]) -> usize {
        let backwards = units.iter().rev();
        backwards.take_while(|&&it| self.contains(it)).count()
    }
}
