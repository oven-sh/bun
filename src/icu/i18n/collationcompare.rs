//! Compares two texts by their collation elements, level by level. ICU4C: collationcompare.cpp

use crate::common::utypes::*;
use crate::i18n::collation;
use crate::i18n::collationdata::CollationData;
use crate::i18n::collationiterator::{CollationIterator, Fetched, Text};
use crate::i18n::collationsettings::{
    ALTERNATE_MASK, BACKWARD_SECONDARY, CASE_FIRST, CASE_LEVEL, CollationSettings, UPPER_FIRST,
    strength,
};
use crate::i18n::unicode::ucol::*;
use std::cmp::Ordering;

fn primary(ce: u64) -> u32 {
    (ce >> 32) as u32
}

fn lower32(ce: u64) -> u32 {
    ce as u32
}

/// Orders two weights that differed before they were mapped. Returns `Greater` if they are equal now.
fn less_or_greater(left: u32, right: u32) -> Ordering {
    if left < right {
        Ordering::Less
    } else {
        Ordering::Greater
    }
}

/// A cursor over the CEs fetched for the primary level. It yields `NO_CE`, which ends every level, past the end.
struct CeCursor<'i> {
    iter: Fetched<'i>,
    index: usize,
}

impl<'i> CeCursor<'i> {
    fn new(iter: Fetched<'i>) -> Self {
        Self { iter, index: 0 }
    }

    /// Returns the next weight, skipping the CEs for which `weight` returns `None`.
    #[inline(always)]
    fn next_weight<W>(&mut self, weight: impl Fn(u64) -> Option<W>) -> W {
        loop {
            self.index += 1;
            if let Some(weight) = weight(self.iter.ce(self.index - 1)) {
                return weight;
            }
        }
    }
}

/// The next primary weight that is neither 0 nor variable. Sets variable CEs and the primary ignorables after them to 0.
#[inline(always)]
fn next_primary<T: Text>(
    iter: &mut CollationIterator<T>,
    data: &CollationData,
    variable_limit: u32,
) -> Result<u32, UErrorCode> {
    let mut is_shifted = false;
    loop {
        let p = primary(iter.next_ce(data)?);
        if p < variable_limit && p > collation::MERGE_SEPARATOR_PRIMARY {
            is_shifted = true;
        } else if p != 0 {
            return Ok(p);
        }
        if is_shifted {
            iter.clear_current_ce();
        }
    }
}

/// Compares the levels that the strength includes.
pub(crate) fn compare_up_to_tertiary<T: Text>(
    left: &mut CollationIterator<T>,
    right: &mut CollationIterator<T>,
    data: &CollationData,
    settings: &CollationSettings,
) -> Result<Ordering, UErrorCode> {
    let variable_limit = if settings.options & ALTERNATE_MASK != 0 {
        settings.variable_top.wrapping_add(1)
    } else {
        0
    };
    loop {
        let left_primary = next_primary(left, data, variable_limit)?;
        let right_primary = next_primary(right, data, variable_limit)?;
        if left_primary != right_primary {
            return Ok(less_or_greater(
                settings.reorder(left_primary),
                settings.reorder(right_primary),
            ));
        }
        if left_primary == collation::NO_CE_PRIMARY {
            let (left, right) = (left.all_fetched(), right.all_fetched());
            return Ok(compare_after_primary(left, right, settings.options));
        }
    }
}

fn compare_after_primary(left: Fetched, right: Fetched, options: i32) -> Ordering {
    if strength(options) == UCOL_PRIMARY {
        return if options & CASE_LEVEL == 0 {
            Ordering::Equal
        } else if options & UPPER_FIRST == 0 {
            compare_cases(left, right)
        } else {
            compare_cases(left, right).reverse()
        };
    }
    let order = if options & BACKWARD_SECONDARY == 0 {
        compare_secondaries(left, right)
    } else {
        compare_secondaries_backward(left, right)
    };
    if order.is_ne() || strength(options) == UCOL_SECONDARY {
        return order;
    }
    compare_tertiaries(left, right, options)
}

fn secondary(ce: u64) -> u32 {
    lower32(ce) >> 16
}

fn compare_secondaries(left: Fetched, right: Fetched) -> Ordering {
    let (mut left, mut right) = (CeCursor::new(left), CeCursor::new(right));
    let not_ignorable = |ce| Some(secondary(ce)).filter(|&secondary| secondary != 0);
    loop {
        let (left_secondary, right_secondary) = (
            left.next_weight(not_ignorable),
            right.next_weight(not_ignorable),
        );
        if left_secondary != right_secondary || left_secondary == collation::NO_CE_WEIGHT16 {
            return left_secondary.cmp(&right_secondary);
        }
    }
}

/// Compares backwards within the segments between merge separators (U+FFFE).
fn compare_secondaries_backward(left: Fetched, right: Fetched) -> Ordering {
    /// Returns the index of the merge separator or `NO_CE` that ends the segment.
    fn segment_limit(iter: Fetched, start: usize) -> usize {
        let mut limit = start;
        while primary(iter.ce(limit)) == 0
            || primary(iter.ce(limit)) > collation::MERGE_SEPARATOR_PRIMARY
        {
            limit += 1;
        }
        limit
    }
    /// Returns the last non-zero secondary weight in `start..index`, or 0.
    fn previous_secondary(iter: Fetched, start: usize, index: &mut usize) -> u32 {
        while *index > start {
            *index -= 1;
            if secondary(iter.ce(*index)) != 0 {
                return secondary(iter.ce(*index));
            }
        }
        0
    }

    let (mut left_start, mut right_start) = (0, 0);
    loop {
        let (left_limit, right_limit) = (
            segment_limit(left, left_start),
            segment_limit(right, right_start),
        );
        let (mut left_index, mut right_index) = (left_limit, right_limit);
        loop {
            let left_secondary = previous_secondary(left, left_start, &mut left_index);
            let right_secondary = previous_secondary(right, right_start, &mut right_index);
            if left_secondary != right_secondary {
                return left_secondary.cmp(&right_secondary);
            }
            if left_secondary == 0 {
                break;
            }
        }

        // Both texts have the same number of separators, or the primary level would have differed.
        if primary(right.ce(right_limit)) == collation::NO_CE_PRIMARY {
            return Ordering::Equal;
        }
        (left_start, right_start) = (left_limit + 1, right_limit + 1);
    }
}

/// Compares the case bits of the primary CEs, lower case first.
fn compare_cases(left: Fetched, right: Fetched) -> Ordering {
    let (mut left, mut right) = (CeCursor::new(left), CeCursor::new(right));
    let has_case = |ce: u64| (primary(ce) != 0 && lower32(ce) != 0).then_some(lower32(ce));
    loop {
        let (left_lower32, right_lower32) =
            (left.next_weight(has_case), right.next_weight(has_case));
        let (left_case, right_case) = (left_lower32 & 0xc000, right_lower32 & 0xc000);
        if left_case != right_case || (left_lower32 >> 16) == collation::NO_CE_WEIGHT16 {
            return left_case.cmp(&right_case);
        }
    }
}

fn compare_tertiaries(left: Fetched, right: Fetched, options: i32) -> Ordering {
    let (mut left, mut right) = (CeCursor::new(left), CeCursor::new(right));
    let tertiary_mask = if options & CASE_FIRST != 0 {
        collation::CASE_AND_TERTIARY_MASK
    } else {
        collation::ONLY_TERTIARY_MASK
    };
    let not_ignorable = |ce: u64| {
        Some((lower32(ce), lower32(ce) & tertiary_mask)).filter(|&(_, tertiary)| tertiary != 0)
    };
    let upper_case_first = |lower32: u32, tertiary: u32| {
        // A tertiary CE must stay greater than primary and secondary CEs.
        if tertiary <= collation::NO_CE_WEIGHT16 {
            tertiary
        } else if lower32 > 0xffff {
            tertiary ^ 0xc000
        } else {
            tertiary + 0x4000
        }
    };
    loop {
        let (left_lower32, left_tertiary) = left.next_weight(not_ignorable);
        let (right_lower32, right_tertiary) = right.next_weight(not_ignorable);
        if left_tertiary != right_tertiary {
            return if options & UPPER_FIRST != 0 {
                less_or_greater(
                    upper_case_first(left_lower32, left_tertiary),
                    upper_case_first(right_lower32, right_tertiary),
                )
            } else {
                left_tertiary.cmp(&right_tertiary)
            };
        }
        if left_tertiary == collation::NO_CE_WEIGHT16 {
            return Ordering::Equal;
        }
    }
}
