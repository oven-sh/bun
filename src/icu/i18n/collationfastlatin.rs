//! Compares common Latin text by 16-bit "mini CEs". ICU4C: collationfastlatin.h

use crate::common::bytes::U16s;
use crate::common::slice_ext::SliceExt;
use crate::common::unicode::uscript::USCRIPT_LATIN;
use crate::i18n::collationdata::{self, CollationData};
use crate::i18n::collationsettings::{
    ALTERNATE_MASK, BACKWARD_SECONDARY, CASE_FIRST, CASE_LEVEL, CollationSettings, NUMERIC,
    UPPER_FIRST, strength,
};
use crate::i18n::rulebasedcollator::{Unit, compare_identical};
use crate::i18n::unicode::ucol::*;
use std::cmp::Ordering;
use std::convert::Infallible;
use std::slice::Iter;

pub(crate) const VERSION: u16 = 2;

/// A bit of `fast_latin_options` that no option has: a case level after the secondary level, or levels after the tertiary.
const HAS_RARE_LEVELS: i32 = 0x80;

pub(crate) const LATIN_MAX: u32 = 0x17f;
pub(crate) const LATIN_LIMIT: usize = LATIN_MAX as usize + 1;
pub(crate) const LATIN_MAX_UTF8_LEAD: u32 = 0xc5;
const PUNCT_START: u32 = 0x2000;
const PUNCT_LIMIT: u32 = 0x2040;
pub(crate) const NUM_FAST_CHARS: usize = LATIN_LIMIT + (PUNCT_LIMIT - PUNCT_START) as usize;

const SHORT_PRIMARY_MASK: u32 = 0xfc00;
const INDEX_MASK: u32 = 0x3ff;
const SECONDARY_MASK: u32 = 0x3e0;
const CASE_MASK: u32 = 0x18;
const LONG_PRIMARY_MASK: u32 = 0xfff8;
const TERTIARY_MASK: u32 = 7;

/// Marks the index of a contraction list: the default mapping, then one entry per suffix character in ascending order.
const CONTRACTION: u32 = 0x400;
/// Marks the index of two mini CEs.
const EXPANSION: u32 = 0x800;
/// The lowest CE with a long primary. Every primary that can be variable is long.
const MIN_LONG: u32 = 0xc00;
/// The lowest CE with a short primary. A high secondary weight stands for an additional secondary CE.
const MIN_SHORT: u32 = 0x1000;
/// The primary of U+FFFF.
const MAX_SHORT: u32 = SHORT_PRIMARY_MASK;

const SEC_INC: u32 = 0x20;
const COMMON_SEC: u32 = 5 * SEC_INC;
const MIN_SEC_HIGH: u32 = 12 * SEC_INC;

const LOWER_CASE: u32 = 8;
const COMMON_TER: u32 = 0;

// Offsets that make the weights greater than the special values and the case bits.
const SEC_OFFSET: u32 = SEC_INC;
const TER_OFFSET: u32 = SEC_OFFSET;

const MERGE_WEIGHT: u32 = 3;
const EOS: u32 = 2;
const BAIL_OUT: u32 = 1;

/// The character index in the first unit of a contraction entry. All bits are set in the default and the end entry.
const CONTR_CHAR_MASK: u32 = 0x1ff;
/// The shift of the length in the first unit of a contraction entry: 1 is `BAIL_OUT`, 2 is one mini CE, 3 is two.
const CONTR_LENGTH_SHIFT: u32 = 9;

/// Repeats `bits` for both mini CEs of a pair.
const fn both_halves(bits: u32) -> u32 {
    (bits << 16) | bits
}

#[inline(always)]
fn unit_at(table: U16s<'_>, index: usize) -> u32 {
    table.at(index).into()
}

fn header_length(table: U16s<'_>) -> usize {
    usize::from(table.at(0) & 0xff)
}

/// Returns whether reordering keeps the order of the groups up to Latin.
fn keeps_order_up_to_latin(data: &CollationData, settings: &CollationSettings) -> bool {
    let start_of = |group| settings.reorder(data.first_primary_for_group(group));
    let mut min_start = 0;
    for group in UCOL_REORDER_CODE_FIRST
        ..UCOL_REORDER_CODE_FIRST + collationdata::MAX_NUM_SPECIAL_REORDER_CODES
    {
        let start = start_of(group);
        if group == UCOL_REORDER_CODE_DIGIT {
            if start <= min_start {
                return false;
            }
            // Bit 0 of `start` is 0. Setting it requires the next group to start strictly after the digits.
            min_start = start | 1;
        } else if start != 0 {
            if start < min_start {
                return false;
            }
            min_start = start;
        }
    }
    start_of(USCRIPT_LATIN) >= min_start
}

/// The mini variable top in the upper half and the options in the lower. A negative value disables the fast path.
fn options_for(data: &CollationData, settings: &CollationSettings) -> i32 {
    let table = data.fast_latin_table;
    if table.is_empty() {
        return -1;
    }
    let mut variable_top = MIN_LONG - 1;
    if settings.options & ALTERNATE_MASK != 0 {
        let index = 1 + settings.max_variable() as usize;
        // The entry is 0 if the table has no character up to the group, or none after it.
        if index >= header_length(table) || unit_at(table, index) < MIN_LONG {
            return -1;
        }
        variable_top = unit_at(table, index) | TERTIARY_MASK;
    }
    if settings.has_reordering() && !keeps_order_up_to_latin(data, settings) {
        return -1;
    }
    let has_rare_levels = strength(settings.options) > UCOL_TERTIARY
        || (strength(settings.options) > UCOL_PRIMARY && settings.options & CASE_LEVEL != 0);
    (variable_top << 16) as i32 | settings.options | (i32::from(has_rare_levels) * HAS_RARE_LEVELS)
}

fn write_primaries(data: &CollationData, options: i32, primaries: &mut [u16; LATIN_LIMIT]) {
    let table = data.fast_latin_table;
    let variable_top = options as u32 >> 16;
    for (primary, ce) in primaries
        .iter_mut()
        .zip(table.slice(header_length(table)..).iter().map(u32::from))
    {
        *primary = if ce >= MIN_SHORT {
            ce & SHORT_PRIMARY_MASK
        } else if ce > variable_top {
            ce & LONG_PRIMARY_MASK
        } else {
            0
        } as u16;
    }
    if options & NUMERIC != 0 {
        primaries.slice_mut(0x30..0x3a).fill(0);
    }
}

// ICU4C: collationfastlatin.cpp, CollationFastLatin::getOptions
pub(crate) fn set_options(data: &CollationData, settings: &mut CollationSettings) {
    settings.fast_latin_options = options_for(data, settings);
    if settings.fast_latin_options >= 0 {
        write_primaries(
            data,
            settings.fast_latin_options,
            &mut settings.fast_latin_primaries,
        );
    }
}

/// `set_options` for settings whose fast Latin fields were current for `data` before the change.
pub(crate) fn update_options(data: &CollationData, settings: &mut CollationSettings) {
    let options = options_for(data, settings);
    let changed = options ^ std::mem::replace(&mut settings.fast_latin_options, options);
    // The primaries depend only on the upper half, which includes the sign, and on one option.
    if options >= 0 && changed & (!0xffff | NUMERIC) != 0 {
        write_primaries(data, options, &mut settings.fast_latin_primaries);
    }
    debug_assert!(options_are_current(data, settings));
}

/// Returns whether `set_options` would change nothing.
pub(crate) fn options_are_current(data: &CollationData, settings: &CollationSettings) -> bool {
    let options = options_for(data, settings);
    options == settings.fast_latin_options
        && (options < 0 || {
            let mut primaries = [0; LATIN_LIMIT];
            write_primaries(data, options, &mut primaries);
            primaries == settings.fast_latin_primaries
        })
}

/// The error for text or settings that the table does not support. The regular comparison must be used.
pub(crate) struct BailOut;

#[derive(Clone, Copy)]
pub(crate) enum FastChar {
    /// The index of the mini CE in the table.
    Index(usize),
    /// The mini CE of a character outside the table.
    Other(u32),
}

const FFFE: FastChar = FastChar::Other(MERGE_WEIGHT);
const FFFF: FastChar = FastChar::Other(MAX_SHORT | COMMON_SEC | LOWER_CASE | COMMON_TER);

/// A code unit of UTF-16 or UTF-8.
pub(crate) trait CodeUnit: Copy + Default + PartialEq + Into<u32> {
    /// The highest code unit that is both a whole character and the index of its mini CE.
    const MAX_INDEX: u32;

    /// Removes the first character from `text`.
    fn next_fast_char(text: &mut Iter<'_, Self>) -> Option<FastChar>;

    /// For the levels after the primary level, which has found that the table supports `text`.
    #[inline(always)]
    fn next_validated_char(text: &mut Iter<'_, Self>) -> Option<FastChar> {
        Self::next_fast_char(text)
    }
}

impl CodeUnit for u16 {
    const MAX_INDEX: u32 = LATIN_MAX;

    #[inline(always)]
    fn next_fast_char(text: &mut Iter<'_, u16>) -> Option<FastChar> {
        Some(match u32::from(*text.next()?) {
            c @ 0..=LATIN_MAX => FastChar::Index(c as usize),
            c @ PUNCT_START..PUNCT_LIMIT => {
                FastChar::Index((c - PUNCT_START) as usize + LATIN_LIMIT)
            }
            0xfffe => FFFE,
            0xffff => FFFF,
            _ => FastChar::Other(BAIL_OUT),
        })
    }
}

impl CodeUnit for u8 {
    const MAX_INDEX: u32 = 0x7f;

    #[inline(always)]
    fn next_fast_char(text: &mut Iter<'_, u8>) -> Option<FastChar> {
        let lead = *text.next()?;
        let (c, rest) = match (lead, text.as_slice()) {
            (0..=0x7f, _) => return Some(FastChar::Index(lead.into())),
            (0xc2..=0xc5, [t @ 0x80..=0xbf, rest @ ..]) => (
                FastChar::Index((usize::from(lead - 0xc2) << 6) + usize::from(*t)),
                rest,
            ),
            (0xe2, [0x80, t @ 0x80..=0xbf, rest @ ..]) => {
                (FastChar::Index(LATIN_LIMIT - 0x80 + usize::from(*t)), rest)
            }
            (0xef, [0xbf, 0xbe, rest @ ..]) => (FFFE, rest),
            (0xef, [0xbf, 0xbf, rest @ ..]) => (FFFF, rest),
            (_, rest) => (FastChar::Other(BAIL_OUT), rest),
        };
        *text = rest.iter();
        Some(c)
    }

    // ICU4C: collationfastlatin.cpp, CollationFastLatin::lookupUTF8Unsafe
    #[inline(always)]
    fn next_validated_char(text: &mut Iter<'_, u8>) -> Option<FastChar> {
        let lead = *text.next()?;
        let (c, rest) = match (lead, text.as_slice()) {
            (0..=0x7f, _) => return Some(FastChar::Index(lead.into())),
            (..=0xc5, [t, rest @ ..]) => (
                FastChar::Index(
                    ((usize::from(lead) << 6) + usize::from(*t)).wrapping_sub(0xc2 << 6),
                ),
                rest,
            ),
            (0xe2, [_, t, rest @ ..]) => {
                (FastChar::Index(LATIN_LIMIT - 0x80 + usize::from(*t)), rest)
            }
            (_, [_, 0xbe, rest @ ..]) => (FFFE, rest),
            (_, [_, _, rest @ ..]) => (FFFF, rest),
            // A damaged table can end the primary level early.
            _ => return None,
        };
        *text = rest.iter();
        Some(c)
    }
}

/// The tables and options that one comparison uses.
#[derive(Clone, Copy)]
struct Tables<'a> {
    /// The table without its header.
    table: U16s<'a>,
    primaries: &'a [u16; LATIN_LIMIT],
    variable_top: u32,
    options: i32,
}

impl<'a> Tables<'a> {
    #[inline(always)]
    fn new(data: &'a CollationData, settings: &'a CollationSettings) -> Self {
        let table = data.fast_latin_table;
        Self {
            table: table.slice(header_length(table)..),
            primaries: &settings.fast_latin_primaries,
            variable_top: settings.fast_latin_options as u32 >> 16,
            options: settings.fast_latin_options & 0xffff,
        }
    }

    /// Returns one or two mini CEs for `c`, the first in the lower half. A contraction consumes a character of `rest`.
    #[inline(always)]
    fn pair<U: CodeUnit>(&self, c: FastChar, rest: &mut Iter<'_, U>) -> u32 {
        let ce = match c {
            FastChar::Index(index) => unit_at(self.table, index),
            FastChar::Other(ce) => ce,
        };
        if !(CONTRACTION..MIN_LONG).contains(&ce) {
            return ce;
        }
        let pair;
        (pair, *rest) = expansion_or_contraction(self.table, ce, rest.clone());
        pair
    }

    /// Returns the next one or two non-ignorable primary weights, or `EOS`.
    #[inline(always)]
    fn next_primaries<U: CodeUnit>(&self, text: &mut Iter<'_, U>) -> Result<u32, BailOut> {
        while let Some(c) = U::next_fast_char(text) {
            if let FastChar::Index(index) = c
                && let Some(&primary) = self.primaries.get(index)
            {
                if primary != 0 {
                    return Ok(primary.into());
                }
                if (0x30..=0x39).contains(&index) && self.options & NUMERIC != 0 {
                    return Err(BailOut);
                }
            }
            let pair = self.pair(c, text);
            if pair == BAIL_OUT {
                return Err(BailOut);
            }
            let primaries = primary_weights(self.variable_top, pair);
            if primaries != 0 {
                return Ok(primaries);
            }
        }
        Ok(EOS)
    }

    #[inline(always)]
    fn primary_difference<U: CodeUnit>(
        &self,
        texts: [&mut Iter<'_, U>; 2],
    ) -> Result<Option<(u32, u32)>, BailOut> {
        first_difference(
            texts,
            |index| self.primaries.at(index) != 0,
            #[inline(always)]
            |text| self.next_primaries(text),
        )
    }

    /// Returns the first weights that differ on a level after the primary level.
    #[inline(always)]
    fn level_difference<U: CodeUnit>(
        &self,
        [left, right]: [&[U]; 2],
        weights_of: impl Fn(u32) -> u32,
    ) -> Option<(u32, u32)> {
        let next = |text: &mut Iter<'_, U>| {
            while let Some(c) = U::next_validated_char(text) {
                let weights = weights_of(self.pair(c, text));
                if weights != 0 {
                    return Ok(weights);
                }
            }
            Ok(EOS)
        };
        let has_primary = |index| unit_at(self.table, index) >= MIN_LONG;
        let Ok(difference) = first_difference::<_, Infallible>(
            [&mut left.iter(), &mut right.iter()],
            has_primary,
            next,
        );
        difference
    }
}

/// Returns the mini CEs, and `rest` without the character that a contraction consumes.
#[cfg_attr(mordant, allow(generic_body_not_generic))] // A few lines, for two types.
fn expansion_or_contraction<'t, U: CodeUnit>(
    table: U16s<'_>,
    ce: u32,
    mut rest: Iter<'t, U>,
) -> (u32, Iter<'t, U>) {
    let mut entry = NUM_FAST_CHARS + (ce & INDEX_MASK) as usize;
    if ce >= EXPANSION {
        return (
            (unit_at(table, entry + 1) << 16) | unit_at(table, entry),
            rest,
        );
    }
    let mut after_next = rest.clone();
    match U::next_fast_char(&mut after_next) {
        Some(FastChar::Index(next)) => {
            let mut i = entry;
            loop {
                let length = (unit_at(table, i) >> CONTR_LENGTH_SHIFT) as usize;
                i += length;
                let x = (unit_at(table, i) & CONTR_CHAR_MASK) as usize;
                if x == next {
                    (entry, rest) = (i, after_next.clone());
                }
                // An unterminated list ends at the 0 that is read past the table.
                if x >= next || length == 0 {
                    break;
                }
            }
        }
        Some(FastChar::Other(BAIL_OUT)) => return (BAIL_OUT, rest),
        _ => {}
    }
    let pair = match unit_at(table, entry) >> CONTR_LENGTH_SHIFT {
        1 => BAIL_OUT,
        2 => unit_at(table, entry + 1),
        _ => (unit_at(table, entry + 2) << 16) | unit_at(table, entry + 1),
    };
    (pair, rest)
}

/// `next` yields `EOS` or up to two weights, the first in the lower half. Characters that `has_primary` have no context.
#[inline(always)]
fn first_difference<U: CodeUnit, E>(
    [left, right]: [&mut Iter<'_, U>; 2],
    has_primary: impl Fn(usize) -> bool,
    next: impl Fn(&mut Iter<'_, U>) -> Result<u32, E>,
) -> Result<Option<(u32, u32)>, E> {
    let (mut left_pair, mut right_pair) = (0, 0);
    loop {
        if left_pair == 0 {
            left_pair = next(left)?;
        }
        if right_pair == 0 {
            right_pair = next(right)?;
        }
        if left_pair == right_pair {
            if left_pair == EOS {
                return Ok(None);
            }
            (left_pair, right_pair) = (0, 0);
            while let ([unit, ..], [other, ..]) = (left.as_slice(), right.as_slice())
                && (*unit).into() <= U::MAX_INDEX
                && has_primary((*unit).into() as usize)
                && unit == other
            {
                left.next();
                right.next();
            }
            continue;
        }
        let (left_weight, right_weight) = (left_pair & 0xffff, right_pair & 0xffff);
        if left_weight != right_weight {
            return Ok(Some((left_weight, right_weight)));
        }
        left_pair >>= 16;
        right_pair >>= 16;
    }
}

/// Returns the order if the characters at index `from` have different weights in `fast_latin_primaries`.
#[inline(always)]
pub(crate) fn compare_first<U: CodeUnit>(
    settings: &CollationSettings,
    left: &[U],
    right: &[U],
    from: usize,
) -> Option<Ordering> {
    if settings.fast_latin_options < 0 {
        return None;
    }
    let primary = |text: &[U]| match U::next_fast_char(&mut text.slice(from..).iter())? {
        FastChar::Index(index) => settings
            .fast_latin_primaries
            .get(index)
            .filter(|&&primary| primary != 0),
        FastChar::Other(_) => None,
    };
    Some(primary(left)?.cmp(primary(right)?)).filter(|order| order.is_ne())
}

/// Fetches the mini CEs again for each level. Requires `settings.fast_latin_options >= 0`.
pub(crate) fn compare<U: Unit>(
    data: &CollationData,
    settings: &CollationSettings,
    left: &[U],
    right: &[U],
) -> Result<Ordering, BailOut> {
    match Tables::new(data, settings).primary_difference([&mut left.iter(), &mut right.iter()])? {
        Some((left, right)) => Ok(left.cmp(&right)),
        None => compare_after_primary::<U, false>(data, settings, left, right),
    }
}

/// Perf: out of line, so that the caller of `compare` is inlined. Only the `RARE` copy has the levels that few collators use.
#[inline(never)]
#[cfg_attr(mordant, allow(generic_body_not_generic))] // A few lines, for two types.
fn compare_after_primary<U: Unit, const RARE: bool>(
    data: &CollationData,
    settings: &CollationSettings,
    left: &[U],
    right: &[U],
) -> Result<Ordering, BailOut> {
    if !RARE && settings.fast_latin_options & HAS_RARE_LEVELS != 0 {
        return compare_after_primary::<U, true>(data, settings, left, right);
    }
    let tables = Tables::new(data, settings);
    let Tables {
        variable_top,
        options,
        ..
    } = tables;
    let texts = [left, right];
    let compare_cases = |strength_is_primary| match tables.level_difference(texts, |pair| {
        case_weights(variable_top, strength_is_primary, pair)
    }) {
        None => Ordering::Equal,
        Some((left, right)) if options & UPPER_FIRST == 0 => left.cmp(&right),
        Some((left, right)) => right.cmp(&left),
    };
    let has_case_level = options & CASE_LEVEL != 0;
    if strength(options) == UCOL_PRIMARY {
        return Ok(if has_case_level {
            compare_cases(true)
        } else {
            Ordering::Equal
        });
    }

    if let Some((left, right)) =
        tables.level_difference(texts, |pair| secondary_weights(variable_top, pair))
    {
        return if options & BACKWARD_SECONDARY == 0 {
            Ok(left.cmp(&right))
        } else {
            Err(BailOut)
        };
    }
    // After a case level, the tertiary level ignores the case bits.
    let mut case_first = options;
    if RARE && has_case_level {
        let order = compare_cases(false);
        if order.is_ne() {
            return Ok(order);
        }
        case_first = 0;
    }
    if strength(options) == UCOL_SECONDARY {
        return Ok(Ordering::Equal);
    }

    let with_case_bits = case_first & CASE_FIRST != 0;
    let difference = tables.level_difference(texts, |pair| {
        tertiary_weights(variable_top, with_case_bits, pair)
    });
    // Neither weight is `EOS` or `MERGE_WEIGHT`, which would have made a secondary difference.
    let order = match difference {
        None => Ordering::Equal,
        Some((left, right)) if case_first & UPPER_FIRST == 0 => left.cmp(&right),
        Some((left, right)) => (left ^ CASE_MASK).cmp(&(right ^ CASE_MASK)),
    };
    if !RARE || order.is_ne() || strength(options) == UCOL_TERTIARY {
        return Ok(order);
    }

    match tables.level_difference(texts, |pair| quaternary_weights(variable_top, pair)) {
        Some((left, right)) => Ok(left.cmp(&right)),
        None if strength(options) < UCOL_IDENTICAL => Ok(Ordering::Equal),
        None => compare_identical(left, right).or(Err(BailOut)),
    }
}

// The weights of one level of a pair, whose mini CEs are in the same group. Special values stay.

#[inline(always)]
fn primary_weights(variable_top: u32, pair: u32) -> u32 {
    let ce = pair & 0xffff;
    if ce >= MIN_SHORT {
        pair & both_halves(SHORT_PRIMARY_MASK)
    } else if ce > variable_top {
        pair & both_halves(LONG_PRIMARY_MASK)
    } else if ce >= MIN_LONG {
        0
    } else {
        pair
    }
}

/// Returns `weight` in the upper half if the short mini CE `ce` implies a secondary CE, else 0.
fn implied_secondary(ce: u32, weight: u32) -> u32 {
    if (ce & SECONDARY_MASK) >= MIN_SEC_HIGH {
        weight << 16
    } else {
        0
    }
}

#[inline(always)]
fn secondary_weights(variable_top: u32, pair: u32) -> u32 {
    const COMMON: u32 = COMMON_SEC + SEC_OFFSET;
    let ce = pair & 0xffff;
    if ce >= MIN_SHORT {
        let secondary = ce & SECONDARY_MASK;
        if pair > 0xffff {
            (pair & both_halves(SECONDARY_MASK)) + both_halves(SEC_OFFSET)
        } else if secondary < MIN_SEC_HIGH {
            secondary + SEC_OFFSET
        } else {
            ((secondary + SEC_OFFSET) << 16) | COMMON
        }
    } else if ce > variable_top {
        if pair > 0xffff {
            both_halves(COMMON)
        } else {
            COMMON
        }
    } else if pair >= MIN_LONG {
        0
    } else {
        pair
    }
}

/// Ignores the case of primary ignorables if the strength is primary.
#[inline(always)]
fn case_weights(variable_top: u32, strength_is_primary: bool, pair: u32) -> u32 {
    let ce = pair & 0xffff;
    if ce >= MIN_SHORT {
        if strength_is_primary && (pair & (SHORT_PRIMARY_MASK << 16)) == 0 {
            pair & CASE_MASK
        } else if pair > 0xffff {
            pair & both_halves(CASE_MASK)
        } else {
            (pair & CASE_MASK) | implied_secondary(ce, LOWER_CASE)
        }
    } else if ce > variable_top {
        if pair > 0xffff {
            both_halves(LOWER_CASE)
        } else {
            LOWER_CASE
        }
    } else if pair >= MIN_LONG {
        0
    } else {
        pair
    }
}

#[inline(always)]
fn tertiary_weights(variable_top: u32, with_case_bits: bool, pair: u32) -> u32 {
    let ce = pair & 0xffff;
    let (case_mask, lower_case) = if with_case_bits {
        (CASE_MASK, LOWER_CASE)
    } else {
        (0, 0)
    };
    if ce >= MIN_SHORT {
        let bits = pair & both_halves(case_mask | TERTIARY_MASK);
        if pair > 0xffff {
            bits + both_halves(TER_OFFSET)
        } else if (ce & SECONDARY_MASK) < MIN_SEC_HIGH {
            bits + TER_OFFSET
        } else {
            (bits + TER_OFFSET) | (lower_case | (COMMON_TER + TER_OFFSET)) << 16
        }
    } else if ce > variable_top {
        let added = TER_OFFSET | lower_case;
        (pair & both_halves(TERTIARY_MASK))
            | if pair > 0xffff {
                both_halves(added)
            } else {
                added
            }
    } else if pair >= MIN_LONG {
        0
    } else {
        pair
    }
}

/// Returns the primary weight of a variable CE, else the highest primary weight.
fn quaternary_weights(variable_top: u32, pair: u32) -> u32 {
    if pair > 0xffff {
        if (pair & 0xffff) > variable_top {
            both_halves(SHORT_PRIMARY_MASK)
        } else {
            pair & both_halves(LONG_PRIMARY_MASK)
        }
    } else if pair >= MIN_SHORT {
        SHORT_PRIMARY_MASK | implied_secondary(pair, SHORT_PRIMARY_MASK)
    } else if pair > variable_top {
        SHORT_PRIMARY_MASK
    } else if pair >= MIN_LONG {
        pair & LONG_PRIMARY_MASK
    } else {
        pair
    }
}
