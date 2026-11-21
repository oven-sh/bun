//! A set of code points and strings. A change for which an allocation fails has no effect. ICU4C: uniset.cpp

use crate::common::bmpset::BMPSet;
use crate::common::memory::{Appendable, defer_oom, try_box, try_splice, try_to_vec};
use crate::common::slice_ext::SliceExt;
use crate::common::sorting::sort_in_place;
use crate::common::utypes::UErrorCode;
use std::ops::RangeInclusive;

const MAX_VALUE: u32 = 0x10_ffff;

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

    pub(crate) fn contains(&self, c: u32) -> bool {
        match &self.bmp_set {
            Some(bmp_set) => bmp_set.contains(&self.list, c),
            None => find_code_point(&self.list, c) & 1 != 0,
        }
    }

    pub(crate) fn contains_some_range(&self, start: u32, end: u32) -> bool {
        let i = find_code_point(&self.list, start);
        i & 1 != 0 || self.list.get(i).is_some_and(|&next| next <= end)
    }

    pub(crate) fn ranges(&self) -> impl ExactSizeIterator<Item = RangeInclusive<u32>> {
        let pairs = self.list.as_chunks().0;
        pairs.iter().map(|&[start, limit]| start..=limit - 1)
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

    /// Each string has several code points.
    pub(crate) fn add_strings(&mut self, strings: Vec<Vec<u16>>) {
        self.strings.add_each(strings);
        sort_in_place(&mut self.strings);
        self.strings.dedup();
    }

    /// Returns `None` if `units` is too short or a range is not valid. ICU4C: uset.cpp, uset_getSerializedSet
    pub(crate) fn add_serialized(
        &mut self,
        units: impl ExactSizeIterator<Item = u16>,
    ) -> Option<()> {
        let mut units = units.map(u32::from);
        let first = units.next()?;
        let length = first & 0x7fff;
        let bmp_length = if first & 0x8000 != 0 {
            units.next()?
        } else {
            length
        };
        let mut start = None;
        // The boundaries above U+FFFF have two units each.
        for i in 0..bmp_length + length.checked_sub(bmp_length)? / 2 {
            let mut boundary = units.next()?;
            if i >= bmp_length {
                boundary = boundary << 16 | units.next()?;
            }
            match start.take() {
                None => start = Some(boundary).filter(|&start| start <= MAX_VALUE),
                Some(start) if start < boundary && boundary <= MAX_VALUE + 1 => {
                    self.add_range(start, boundary - 1);
                }
                Some(_) => return None,
            }
        }
        if let Some(start) = start {
            self.add_range(start, MAX_VALUE);
        }
        Some(())
    }

    /// Builds the tables that speed up `contains`. The set must not change afterwards.
    pub(crate) fn freeze(&mut self) -> Result<(), UErrorCode> {
        self.list = try_to_vec(&self.list)?;
        self.bmp_set = Some(try_box(BMPSet::new(&self.list))?);
        Ok(())
    }
}
