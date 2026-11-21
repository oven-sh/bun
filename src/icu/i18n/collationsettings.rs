//! The collator attributes that the API can change. ICU4C: collationsettings.cpp

use crate::common::memory::{TryClone, try_to_vec};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::utypes::*;
use crate::i18n::collation;
use crate::i18n::collationdata::CollationData;
use crate::i18n::collationfastlatin;
use crate::i18n::unicode::ucol::*;

// The bits of `options`.
const CHECK_FCD: i32 = 1;
pub(crate) const NUMERIC: i32 = 2;
const SHIFTED: i32 = 4;
pub(crate) const ALTERNATE_MASK: i32 = 0xc;
const MAX_VARIABLE_SHIFT: i32 = 4;
const MAX_VARIABLE_MASK: i32 = 0x70;
pub(crate) const UPPER_FIRST: i32 = 0x100;
pub(crate) const CASE_FIRST: i32 = 0x200;
const CASE_FIRST_AND_UPPER_MASK: i32 = CASE_FIRST | UPPER_FIRST;
pub(crate) const CASE_LEVEL: i32 = 0x400;
pub(crate) const BACKWARD_SECONDARY: i32 = 0x800;
const STRENGTH_SHIFT: i32 = 12;
const STRENGTH_MASK: i32 = 0xf000;

pub(crate) struct CollationSettings {
    /// The attribute bits. Only the low 16 bits are used.
    pub(crate) options: i32,
    pub(crate) variable_top: u32,
    /// Maps each primary lead byte to its reordered value, or to 0 if a range limit splits the lead byte.
    reorder_table: Option<[u8; 256]>,
    /// The limit of the last entry of `reorder_ranges`, or 0 if there is none.
    min_high_no_reorder: u32,
    /// Pairs of a primary limit (upper 16 bits) and a lead byte offset, starting at the first split lead byte.
    reorder_ranges: Vec<u32>,
    pub(crate) reorder_code_count: usize,
    /// The options for fast Latin comparison, or a negative value if it is disabled.
    pub(crate) fast_latin_options: i32,
    pub(crate) fast_latin_primaries: [u16; collationfastlatin::LATIN_LIMIT],
}

impl TryClone for CollationSettings {
    fn try_clone(&self) -> Result<Self, UErrorCode> {
        Ok(Self {
            reorder_ranges: try_to_vec(&self.reorder_ranges)?,
            ..*self
        })
    }
}

fn splits_lead_byte(range: u32) -> bool {
    range & 0xff_0000 != 0
}

impl CollationSettings {
    /// The caller sets the options, the variable top and the fast Latin fields.
    pub(crate) fn new() -> Self {
        Self {
            options: 0,
            variable_top: 0,
            reorder_table: None,
            min_high_no_reorder: 0,
            reorder_ranges: Vec::new(),
            reorder_code_count: 0,
            fast_latin_options: -1,
            fast_latin_primaries: [0; collationfastlatin::LATIN_LIMIT],
        }
    }

    pub(crate) fn set_reordering(
        &mut self,
        data: &CollationData,
        codes: &[i32],
    ) -> Result<(), UErrorCode> {
        let ranges = data.make_reorder_ranges(codes)?;
        if ranges.is_empty() {
            (self.reorder_table, self.reorder_code_count) = (None, 0);
            return Ok(());
        }
        let mut table = [0; 256];
        let mut b = 0;
        for &pair in &ranges {
            let limit1 = (pair >> 24) as usize;
            while b < limit1 {
                table.set(b, (b as u8).wrapping_add(pair as u8));
                b += 1;
            }
            if splits_lead_byte(pair) {
                table.set(limit1, 0);
                b = limit1 + 1;
            }
        }
        for b in b..table.len() {
            table.set(b, b as u8);
        }
        self.set_reorder_arrays(codes.len(), ranges, &table);
        Ok(())
    }

    pub(crate) fn set_reorder_arrays(
        &mut self,
        code_count: usize,
        mut ranges: Vec<u32>,
        table: &[u8; 256],
    ) {
        let unsplit = ranges.iter().take_while(|&&range| !splits_lead_byte(range));
        ranges.drain(..unsplit.count());
        self.min_high_no_reorder = ranges.last().map_or(0, |last| last & 0xffff_0000);
        (self.reorder_table, self.reorder_ranges) = (Some(*table), ranges);
        self.reorder_code_count = code_count;
    }

    pub(crate) fn has_reordering(&self) -> bool {
        self.reorder_table.is_some()
    }

    /// Returns the reordered primary weight, or `p` if there is no reordering.
    #[inline]
    pub(crate) fn reorder(&self, p: u32) -> u32 {
        let Some(table) = &self.reorder_table else {
            return p;
        };
        let b = table.at((p >> 24) as usize);
        if b != 0 || p <= collation::NO_CE_PRIMARY {
            (u32::from(b) << 24) | (p & 0xff_ffff)
        } else {
            self.reorder_ex(p)
        }
    }

    fn reorder_ex(&self, p: u32) -> u32 {
        if p >= self.min_high_no_reorder {
            return p;
        }
        let q = p | 0xffff;
        p.wrapping_add(
            self.reorder_ranges
                .iter()
                .copied()
                .find(|&range| q < range)
                .soft_unwrap()
                << 24,
        )
    }

    pub(crate) fn attribute(&self, attr: UColAttribute) -> Result<UColAttributeValue, UErrorCode> {
        let options = self.options;
        Ok(match attr {
            UCOL_STRENGTH => strength(options),
            UCOL_ALTERNATE_HANDLING if options & ALTERNATE_MASK == 0 => UCOL_NON_IGNORABLE,
            UCOL_ALTERNATE_HANDLING => UCOL_SHIFTED,
            UCOL_CASE_FIRST => match options & CASE_FIRST_AND_UPPER_MASK {
                0 => UCOL_OFF,
                CASE_FIRST => UCOL_LOWER_FIRST,
                _ => UCOL_UPPER_FIRST,
            },
            _ if options & flag_of(attr)? == 0 => UCOL_OFF,
            _ => UCOL_ON,
        })
    }

    pub(crate) fn set_attribute(
        &mut self,
        attr: UColAttribute,
        value: UColAttributeValue,
    ) -> Result<(), UErrorCode> {
        let (mask, bits) = match (attr, value) {
            (UCOL_STRENGTH, UCOL_PRIMARY..=UCOL_QUATERNARY | UCOL_IDENTICAL) => {
                (STRENGTH_MASK, value << STRENGTH_SHIFT)
            }
            (UCOL_ALTERNATE_HANDLING, UCOL_NON_IGNORABLE) => (ALTERNATE_MASK, 0),
            (UCOL_ALTERNATE_HANDLING, UCOL_SHIFTED) => (ALTERNATE_MASK, SHIFTED),
            (UCOL_CASE_FIRST, UCOL_OFF) => (CASE_FIRST_AND_UPPER_MASK, 0),
            (UCOL_CASE_FIRST, UCOL_LOWER_FIRST) => (CASE_FIRST_AND_UPPER_MASK, CASE_FIRST),
            (UCOL_CASE_FIRST, UCOL_UPPER_FIRST) => (CASE_FIRST_AND_UPPER_MASK, !0),
            (UCOL_STRENGTH | UCOL_ALTERNATE_HANDLING | UCOL_CASE_FIRST, _) => {
                return Err(U_ILLEGAL_ARGUMENT_ERROR);
            }
            (_, UCOL_OFF) => (flag_of(attr)?, 0),
            (_, UCOL_ON) => (flag_of(attr)?, !0),
            _ => return Err(U_ILLEGAL_ARGUMENT_ERROR),
        };
        self.options = (self.options & !mask) | (bits & mask);
        Ok(())
    }

    /// Requires `value` in `0..8`.
    pub(crate) fn set_max_variable(&mut self, value: i32) {
        self.options = (self.options & !MAX_VARIABLE_MASK) | value << MAX_VARIABLE_SHIFT;
    }

    pub(crate) fn max_variable(&self) -> i32 {
        (self.options & MAX_VARIABLE_MASK) >> MAX_VARIABLE_SHIFT
    }

    pub(crate) fn is_numeric(&self) -> bool {
        self.options & NUMERIC != 0
    }

    /// The strength is at most tertiary, and only primary strength has a case level. Comparison always normalizes.
    pub(crate) fn can_compare(&self) -> bool {
        let max_strength = if self.options & CASE_LEVEL == 0 {
            UCOL_TERTIARY
        } else {
            UCOL_PRIMARY
        };
        strength(self.options) <= max_strength
    }
}

pub(crate) fn strength(options: i32) -> UColAttributeValue {
    options >> STRENGTH_SHIFT
}

/// Returns the options bit of an on/off attribute.
fn flag_of(attr: UColAttribute) -> Result<i32, UErrorCode> {
    match attr {
        UCOL_FRENCH_COLLATION => Ok(BACKWARD_SECONDARY),
        UCOL_CASE_LEVEL => Ok(CASE_LEVEL),
        UCOL_NORMALIZATION_MODE => Ok(CHECK_FCD),
        UCOL_NUMERIC_COLLATION => Ok(NUMERIC),
        _ => Err(U_UNSUPPORTED_ERROR),
    }
}
