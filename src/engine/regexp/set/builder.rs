use bun_engine_text::AllocError;
use bun_engine_unicode::IgnoreCase;
use smallvec::SmallVec;

use super::ranges::{self, RangeList};
use super::{Above, CharRange, Latin1Set, Set, SharedSet};

/// Collects the members of a set in any order. `finish` leaves it empty for the next set.
#[derive(Default)]
pub struct SetBuilder {
    latin1: Latin1Set,
    /// Not yet closed over case.
    open: RangeList,
    closed: RangeList,
    /// The union of the long lists, which are not worth sorting again.
    merged: RangeList,
    /// By address.
    shared: SmallVec<[&'static SharedSet; 2]>,
    has_all_above: bool,
    steps: usize,
}

const LONGEST_SHORT_LIST: usize = 8;

/// One of each group of equal characters that has members on both sides of U+00FF.
const fn equal_to_wide_characters(ignore_case: IgnoreCase) -> Latin1Set {
    match ignore_case {
        IgnoreCase::CodeUnits => const { Latin1Set::of(b"\xb5\xff") },
        IgnoreCase::CodePoints => const { Latin1Set::of(b"ks\xb5\xdf\xe5\xff") },
    }
}

impl SetBuilder {
    #[inline]
    pub fn add(&mut self, c: u32) -> Result<(), AllocError> {
        match u8::try_from(c) {
            Ok(c) => {
                self.latin1.insert(c);
                Ok(())
            }
            Err(_) => self.open.push(CharRange::single(c)),
        }
    }

    #[inline]
    pub fn add_range(&mut self, first: u32, last: u32) -> Result<(), AllocError> {
        add_range(&mut self.latin1, &mut self.open, first, last)
    }

    /// If the result is to be closed over case, `set` is so already.
    #[inline]
    pub fn add_set(&mut self, set: &Set) -> Result<(), AllocError> {
        self.latin1 |= set.latin1;
        match set.above {
            Above::Inline(0, _) => Ok(()),
            _ => self.add_above(set),
        }
    }

    fn add_above(&mut self, set: &Set) -> Result<(), AllocError> {
        let above = set.above();
        if let Some(shared) = set.shared() {
            let address = |&shared: &&SharedSet| core::ptr::from_ref(shared);
            if let Err(index) = self.shared.binary_search_by_key(&address(&shared), address) {
                self.shared.insert(index, shared);
            }
        } else if set.has_all_above() {
            self.has_all_above = true;
        } else if above.len() <= LONGEST_SHORT_LIST.max(self.merged.len() / 4) {
            above
                .iter()
                .try_for_each(|&range| self.closed.push(range))?;
        } else {
            self.merge(above)?;
        }
        Ok(())
    }

    fn merge(&mut self, ranges: &[CharRange]) -> Result<(), AllocError> {
        self.steps += self.merged.len() + ranges.len();
        self.merged = ranges::union(&self.merged, ranges)?;
        Ok(())
    }

    /// The number of ranges gone through since the last call.
    #[inline]
    pub(crate) fn take_steps(&mut self) -> usize {
        core::mem::take(&mut self.steps)
    }

    #[inline]
    pub fn finish(&mut self, ignore_case: Option<IgnoreCase>) -> Result<Set, AllocError> {
        if let Some(ignore_case) = ignore_case {
            self.close_over_case(ignore_case)?;
        }
        let pending = self.open.len() + self.closed.len() + self.merged.len() + self.shared.len();
        let above = match (pending, self.has_all_above) {
            (0, false) => Above::NONE,
            _ => self.finish_above()?,
        };
        let latin1 = core::mem::take(&mut self.latin1);
        Ok(Set { latin1, above })
    }

    fn finish_above(&mut self) -> Result<Above, AllocError> {
        let shared = core::mem::take(&mut self.shared);
        let above = match shared[..] {
            _ if self.has_all_above => Above::ALL,
            [a, b] if a.is_complement_of(b) => Above::ALL,
            _ => self.join_above(&shared)?,
        };
        self.open.clear();
        self.closed.clear();
        self.merged.clear();
        self.has_all_above = false;
        Ok(above)
    }

    fn join_above(&mut self, shared: &[&'static SharedSet]) -> Result<Above, AllocError> {
        self.closed.iter().try_for_each(|&it| self.open.push(it))?;
        self.steps += self.open.len();
        self.open.normalize();
        match *shared {
            [] if self.merged.is_empty() => return Above::from_slice(&self.open),
            [only] if self.merged.is_empty() && ranges::is_subset(&self.open, only.above()) => {
                return Ok(Above::from_shared(only));
            }
            _ => {}
        }
        shared.iter().try_for_each(|it| self.merge(it.above()))?;
        let open = core::mem::take(&mut self.open);
        self.merge(&open)?;
        Above::from_slice(&self.merged)
    }

    #[inline]
    fn close_over_case(&mut self, ignore_case: IgnoreCase) -> Result<(), AllocError> {
        if !self.open.is_empty() {
            self.close_above_over_case(ignore_case)?;
        }
        self.latin1 = self.latin1.with_both_cases();
        let with_wide_equals = self.latin1 & equal_to_wide_characters(ignore_case);
        match with_wide_equals.is_empty() {
            true => Ok(()),
            false => self.add_wide_equals(with_wide_equals, ignore_case),
        }
    }

    fn close_above_over_case(&mut self, ignore_case: IgnoreCase) -> Result<(), AllocError> {
        let mut result = Ok(());
        self.open.normalize();
        for range in self.open.iter() {
            ignore_case.close_over(range.first..=range.last, |equal| {
                let (first, last) = equal.into_inner();
                result = result
                    .and_then(|()| add_range(&mut self.latin1, &mut self.closed, first, last));
            });
        }
        self.steps += self.closed.len();
        result
    }

    fn add_wide_equals(
        &mut self,
        characters: Latin1Set,
        ignore_case: IgnoreCase,
    ) -> Result<(), AllocError> {
        for c in characters.iter() {
            for equal in ignore_case.equivalents(c.into()).filter(|&it| it > 0xff) {
                self.closed.push(CharRange::single(equal))?;
            }
        }
        Ok(())
    }
}

#[inline]
fn add_range(
    latin1: &mut Latin1Set,
    above: &mut RangeList,
    first: u32,
    last: u32,
) -> Result<(), AllocError> {
    if let Ok(first) = u8::try_from(first) {
        latin1.insert_range(first, last.min(0xff) as u8);
    }
    if last > 0xff {
        above.push(CharRange::new(first.max(0x100), last))?;
    }
    Ok(())
}
