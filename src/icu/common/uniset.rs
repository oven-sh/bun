//! A set of code points and strings. A change for which an allocation fails has no effect. ICU4C: uniset.cpp

use crate::common::bmpset::BMPSet;
use crate::common::bytes::U16s;
use crate::common::memory::{Appendable, defer_oom, is_oom, try_box, try_splice, try_to_vec};
use crate::common::slice_ext::SliceExt;
use crate::common::sorting::sort_in_place;
use crate::common::utypes::UErrorCode;
use std::ops::RangeInclusive;

pub(crate) const MAX_VALUE: u32 = 0x10_ffff;

/// Returns the number of elements of the ascending `list` up to `c`.
#[inline(always)]
pub(crate) fn find_code_point(list: &[u32], c: u32) -> usize {
    match *list {
        [.., last] if last <= c => list.len(),
        [first, ..] if first <= c => list.partition_point(|&element| element <= c),
        _ => 0,
    }
}

pub(crate) struct UnicodeSet {
    /// The starts and limits of the ranges, strictly ascending: `[a-cx]` is `[0x61, 0x64, 0x78, 0x79]`.
    list: Vec<u32>,
    /// `Some` if the set is frozen.
    bmp_set: Option<Box<BMPSet>>,
    /// Sorted in code unit order, without duplicates.
    strings: Vec<Vec<u16>>,
}

impl UnicodeSet {
    pub(crate) const fn new() -> Self {
        Self {
            list: Vec::new(),
            bmp_set: None,
            strings: Vec::new(),
        }
    }

    /// Copies the code points.
    pub(crate) fn clone_as_thawed(&self) -> Self {
        Self {
            list: defer_oom(try_to_vec(&self.list)).unwrap_or_default(),
            ..Self::new()
        }
    }

    #[inline(always)]
    pub(crate) fn contains(&self, c: u32) -> bool {
        match &self.bmp_set {
            Some(bmp_set) => bmp_set.contains(&self.list, c),
            None => find_code_point(&self.list, c) & 1 != 0,
        }
    }

    /// Returns the first code point from `c` on.
    pub(crate) fn first_from(&self, c: u32) -> Option<u32> {
        match find_code_point(&self.list, c) {
            i if i & 1 != 0 => Some(c),
            i => self.list.get(i).copied(),
        }
    }

    pub(crate) fn ranges(&self) -> impl ExactSizeIterator<Item = RangeInclusive<u32>> {
        let pairs = self.list.as_chunks().0;
        pairs.iter().map(|&[start, limit]| start..=limit - 1)
    }

    pub(crate) fn code_points(&self) -> impl Iterator<Item = u32> {
        self.ranges().flatten()
    }

    pub(crate) fn strings(&self) -> &[Vec<u16>] {
        &self.strings
    }

    pub(crate) fn clear(&mut self) {
        *self = Self::new();
    }

    pub(crate) fn add(&mut self, c: u32) {
        self.add_range(c, c);
    }

    /// Requires `start <= end <= 0x10ffff`.
    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // The flag stays set.
    pub(crate) fn add_range(&mut self, start: u32, end: u32) {
        debug_assert!(self.bmp_set.is_none() && start <= end && end <= MAX_VALUE);
        let limit = end + 1;
        if self.list.last().is_none_or(|&last| last < start) {
            return self.list.add_all(&[start, limit]);
        }
        let from = start
            .checked_sub(1)
            .map_or(0, |before| find_code_point(&self.list, before));
        let touched = self
            .list
            .slice(from..)
            .iter()
            .take_while(|&&element| element <= limit);
        let to = from + touched.count();
        // At an odd index the new range joins an existing one.
        let boundaries: &[u32] = match (from & 1, to & 1) {
            (0, 0) => &[start, limit],
            (0, _) => &[start],
            (_, 0) => &[limit],
            _ => &[],
        };
        let _ = defer_oom(try_splice(&mut self.list, from, to, boundaries));
    }

    /// Keeps the code points for which `keeps(is in self, is in other)` holds.
    fn combine(&mut self, other: &Self, keeps: fn(bool, bool) -> bool) {
        let (mut i, mut j, mut merged) = (0, 0, Vec::new());
        let mut boundary = Some(0);
        while let Some(c) = boundary.filter(|&c| c <= MAX_VALUE) {
            i += usize::from(self.list.get(i) == Some(&c));
            j += usize::from(other.list.get(j) == Some(&c));
            if keeps(i & 1 != 0, j & 1 != 0) != (merged.len() & 1 != 0) {
                merged.add(c);
            }
            boundary = self
                .list
                .get(i)
                .into_iter()
                .chain(other.list.get(j))
                .min()
                .copied();
        }
        if merged.len() & 1 != 0 {
            merged.add(MAX_VALUE + 1);
        }
        if !is_oom() {
            self.list = merged;
        }
    }

    pub(crate) fn complement(&mut self) {
        self.combine(&Self::new(), |a, _| !a);
    }

    /// Like `add_range` for each range, but each element moves once.
    pub(crate) fn add_all(&mut self, other: &Self) {
        let (mut merged, mut rest) = (Vec::new(), &*self.list);
        _ = merged.reserve_append(rest.len() + other.list.len());
        for &[start, limit] in other.list.as_chunks().0 {
            while let [first, more @ ..] = rest
                && *first < start
            {
                merged.add(*first);
                rest = more;
            }
            // An odd number is left inside a range.
            if rest.len() & 1 == 0 {
                merged.add(start);
            }
            rest = rest.slice(rest.iter().take_while(|&&it| it <= limit).count()..);
            if rest.len() & 1 == 0 {
                merged.add(limit);
            }
        }
        merged.add_all(rest);
        if !is_oom() {
            self.list = merged;
        }
    }

    pub(crate) fn retain_all(&mut self, other: &Self) {
        self.combine(other, |a, b| a && b);
    }

    pub(crate) fn remove_all(&mut self, other: &Self) {
        self.combine(other, |a, b| a && !b);
    }

    /// Each string has several code points.
    pub(crate) fn add_strings(&mut self, strings: Vec<Vec<u16>>) {
        self.strings.add_each(strings);
        sort_in_place(&mut self.strings);
        self.strings.dedup();
    }

    /// Returns `None` if `units` is too short or a range is not valid. ICU4C: uset.cpp, uset_getSerializedSet
    pub(crate) fn from_serialized(units: U16s) -> Option<Self> {
        let first = usize::from(units.get(0)?);
        let length = first & 0x7fff;
        let (header, bmp_length) = match first & 0x8000 {
            0 => (1, length),
            _ => (2, units.get(1)?.into()),
        };
        let (bmp, rest) = (units.as_bytes().get(2 * header..2 * (header + length))?)
            .split_at_checked(2 * bmp_length)?;
        let mut list = Vec::new();
        _ = list.reserve_append(length + 1);
        list.add_each(U16s::of(bmp).iter().map(u32::from));
        // The boundaries above U+FFFF have two units each.
        list.add_each(rest.as_chunks().0.iter().map(|&[a, b, c, d]| {
            u32::from(u16::from_ne_bytes([a, b])) << 16 | u32::from(u16::from_ne_bytes([c, d]))
        }));
        if list.len() & 1 != 0 && list.pop_if(|last| *last > MAX_VALUE).is_none() {
            list.add(MAX_VALUE + 1);
        }
        let mut set = Self::new();
        if list.is_sorted_by(|a, b| a < b) && list.last() <= Some(&(MAX_VALUE + 1)) {
            set.list = list;
            return Some(set);
        }
        for &[start, limit] in list.as_chunks().0 {
            (start < limit && limit <= MAX_VALUE + 1).then(|| set.add_range(start, limit - 1))?;
        }
        Some(set)
    }

    /// Builds the tables that speed up `contains`. The set must not change afterwards.
    pub(crate) fn freeze(&mut self) -> Result<(), UErrorCode> {
        self.list = try_to_vec(&self.list)?;
        self.bmp_set = Some(try_box(BMPSet::new(&self.list))?);
        Ok(())
    }
}
