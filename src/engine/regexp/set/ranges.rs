//! Operations on lists of ranges that ascend with a gap between any two.

use core::ops::Deref;

use bun_engine_text::AllocError;
use bun_engine_unicode::MAX_CODE_POINT;
use smallvec::SmallVec;

use super::CharRange;

#[derive(Default)]
pub(super) struct RangeList(SmallVec<[CharRange; 4]>);

impl Deref for RangeList {
    type Target = [CharRange];

    #[inline]
    fn deref(&self) -> &[CharRange] {
        &self.0
    }
}

impl RangeList {
    fn with_capacity(capacity: usize) -> Result<RangeList, AllocError> {
        let mut list = RangeList::default();
        list.0.try_reserve(capacity).map_err(|_| AllocError)?;
        Ok(list)
    }

    #[inline]
    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    #[inline]
    pub(super) fn push(&mut self, range: CharRange) -> Result<(), AllocError> {
        if self.0.len() == self.0.capacity() {
            self.0.try_reserve(1).map_err(|_| AllocError)?;
        }
        self.0.push(range);
        Ok(())
    }

    /// Brings ranges that overlap or come in any order into the form that the operations take.
    pub(super) fn normalize(&mut self) {
        if !self.0.is_sorted_by_key(|range| range.first) {
            self.0.sort_unstable_by_key(|range| range.first);
        }
        self.0.dedup_by(|range, kept| {
            let touches = range.first <= kept.last + 1;
            if touches {
                kept.last = kept.last.max(range.last);
            }
            touches
        });
    }
}

pub(super) fn contains(ranges: &[CharRange], c: u32) -> bool {
    let candidate = ranges.partition_point(|range| range.last < c);
    ranges.get(candidate).is_some_and(|range| range.first <= c)
}

pub(super) fn intersects(a: &[CharRange], b: &[CharRange]) -> bool {
    let (few, mut many) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    few.iter().any(|range| {
        many = &many[many.partition_point(|other| other.last < range.first)..];
        many.first().is_some_and(|other| other.first <= range.last)
    })
}

pub(super) fn is_subset(part: &[CharRange], mut whole: &[CharRange]) -> bool {
    part.iter().all(|range| {
        whole = &whole[whole.partition_point(|other| other.last < range.first)..];
        whole
            .first()
            .is_some_and(|other| other.first <= range.first && range.last <= other.last)
    })
}

pub(super) fn union<'a>(
    mut a: &'a [CharRange],
    mut b: &'a [CharRange],
) -> Result<RangeList, AllocError> {
    let mut result = RangeList::with_capacity(a.len().max(b.len()))?;
    let mut next = || match (a.first(), b.first()) {
        (Some(x), Some(y)) if x.first <= y.first => a.split_off_first(),
        (Some(_), None) => a.split_off_first(),
        _ => b.split_off_first(),
    };
    let Some(mut joined) = next().copied() else {
        return Ok(result);
    };
    while let Some(&range) = next() {
        if range.first <= joined.last + 1 {
            joined.last = joined.last.max(range.last);
        } else {
            result.push(core::mem::replace(&mut joined, range))?;
        }
    }
    result.push(joined)?;
    Ok(result)
}

pub(super) fn intersection(
    mut a: &[CharRange],
    mut b: &[CharRange],
) -> Result<RangeList, AllocError> {
    let mut result = RangeList::default();
    while let (Some(x), Some(y)) = (a.first(), b.first()) {
        let (first, last) = (x.first.max(y.first), x.last.min(y.last));
        if first <= last {
            result.push(CharRange::new(first, last))?;
        }
        if x.last < y.last {
            a = &a[1..];
        } else {
            b = &b[1..];
        }
    }
    Ok(result)
}

pub(super) fn difference(a: &[CharRange], mut b: &[CharRange]) -> Result<RangeList, AllocError> {
    let mut result = RangeList::default();
    for range in a {
        let mut next = range.first;
        while let Some(hole) = b.first().filter(|hole| hole.first <= range.last) {
            if hole.first > next {
                result.push(CharRange::new(next, hole.first - 1))?;
            }
            next = next.max(hole.last + 1);
            if hole.last > range.last {
                break;
            }
            b = &b[1..];
        }
        if next <= range.last {
            result.push(CharRange::new(next, range.last))?;
        }
    }
    Ok(result)
}

/// Among the characters above U+00FF.
pub(super) fn complement(ranges: &[CharRange]) -> Result<RangeList, AllocError> {
    difference(&[CharRange::new(0x100, MAX_CODE_POINT)], ranges)
}
