//! The mappings of the root collator or of a tailoring. ICU4C: collationdata.cpp

use crate::common::bytes::{U16s, U32s, U64s};
use crate::common::memory::{try_box, try_push};
use crate::common::slice_ext::SliceExt;
use crate::common::ucharstrie::UCharsTrie;
use crate::common::unicode::uscript::{USCRIPT_LATIN, USCRIPT_UNKNOWN};
use crate::common::uniset::UnicodeSet;
use crate::common::utrie2::UTrie2;
use crate::common::utypes::*;
use crate::i18n::collation;
use crate::i18n::unicode::ucol::UCOL_REORDER_CODE_FIRST;
use std::ops::Deref;

/// The characters before which a comparison cannot start.
pub(crate) enum UnsafeSet {
    Own(Box<UnicodeSet>),
    Other(&'static UnicodeSet),
}

impl UnsafeSet {
    /// Adds the lead surrogates of the supplementary code points, and freezes the set.
    pub(crate) fn new(mut set: UnicodeSet) -> Result<Self, UErrorCode> {
        for (lead, c) in (0xd800..0xdc00).zip((0x10000..).step_by(0x400)) {
            if set.contains_some_range(c, c + 0x3ff) {
                set.add(lead);
            }
        }
        set.freeze()?;
        try_box(set).map(Self::Own)
    }
}

impl Deref for UnsafeSet {
    type Target = UnicodeSet;

    fn deref(&self) -> &UnicodeSet {
        match self {
            Self::Own(set) => set,
            Self::Other(set) => set,
        }
    }
}

const REORDER_RESERVED_BEFORE_LATIN: i32 = 14;
const REORDER_RESERVED_AFTER_LATIN: i32 = 15;
pub(crate) const MAX_NUM_SPECIAL_REORDER_CODES: i32 = 8;
pub(crate) const MAX_NUM_SCRIPT_RANGES: usize = 256;
/// Number of L, V and T Jamo.
pub(crate) const JAMO_CE32S_LENGTH: usize = 19 + 21 + 27;

pub(crate) struct CollationData {
    pub(crate) trie: UTrie2<'static>,
    /// Index 0 has the CE32 of U+0000.
    pub(crate) ce32s: U32s<'static>,
    pub(crate) ces: U64s<'static>,
    /// Prefix and suffix tables: the default CE32 in two units, then a trie.
    pub(crate) contexts: U16s<'static>,
    /// The root data. `None` in the root data itself.
    pub(crate) base: Option<&'static CollationData>,
    pub(crate) jamo_ce32s: U32s<'static>,
    pub(crate) numeric_primary: u32,
    pub(crate) unsafe_backward_set: UnsafeSet,
    pub(crate) fast_latin_table: U16s<'static>,
    pub(crate) num_scripts: i32,
    /// Maps each script, then 16 special reorder codes, to an index in `script_starts`, or 0.
    pub(crate) scripts_index: U16s<'static>,
    /// The upper 16 bits of the first primary weight of each group. The first and last ranges are never reordered.
    pub(crate) script_starts: U16s<'static>,
}

impl CollationData {
    pub(crate) fn empty() -> Self {
        const NOTHING: &UnicodeSet = &UnicodeSet::new();
        Self {
            trie: UTrie2::default(),
            ce32s: U32s::EMPTY,
            ces: U64s::EMPTY,
            contexts: U16s::EMPTY,
            base: None,
            jamo_ce32s: U32s::EMPTY,
            numeric_primary: 0,
            unsafe_backward_set: UnsafeSet::Other(NOTHING),
            fast_latin_table: U16s::EMPTY,
            num_scripts: 0,
            scripts_index: U16s::EMPTY,
            script_starts: U16s::EMPTY,
        }
    }

    /// Inherits the defaults of a tailoring from `base`, except the fast Latin table.
    pub(crate) fn for_tailoring(base: &'static CollationData) -> Self {
        Self {
            base: Some(base),
            jamo_ce32s: base.jamo_ce32s,
            numeric_primary: base.numeric_primary,
            unsafe_backward_set: UnsafeSet::Other(&base.unsafe_backward_set),
            num_scripts: base.num_scripts,
            scripts_index: base.scripts_index,
            script_starts: base.script_starts,
            ..Self::empty()
        }
    }

    #[inline(always)]
    pub(crate) fn ce32(&self, c: u32) -> u32 {
        self.trie.get32(c)
    }

    #[inline(always)]
    pub(crate) fn ce32_from_supplementary(&self, c: u32) -> u32 {
        self.trie.get32_from_supp(c)
    }

    /// Looks `c` up in the base data. Without base data the result is an invalid CE32.
    #[inline(always)]
    pub(crate) fn fall_back(&self, c: u32) -> (&Self, u32) {
        self.base.map_or((self, collation::FALLBACK_CE32), |base| {
            (base, base.ce32(c))
        })
    }

    /// Returns the CE32 of `c` and the data that contain it.
    pub(crate) fn look_up(&self, c: u32) -> (&Self, u32) {
        match self.ce32(c) {
            collation::FALLBACK_CE32 => self.fall_back(c),
            ce32 => (self, ce32),
        }
    }

    /// Resolves the tags that stand for another CE32 of the same code point.
    pub(crate) fn final_ce32(&self, ce32: u32) -> u32 {
        if collation::has_ce32_tag(ce32, collation::DIGIT_TAG) {
            self.ce32s.at(collation::index_from_ce32(ce32))
        } else if collation::has_ce32_tag(ce32, collation::U0000_TAG) {
            self.ce32s.at(0)
        } else {
            ce32
        }
    }

    pub(crate) fn is_digit(&self, c: u32) -> bool {
        collation::has_ce32_tag(self.look_up(c).1, collation::DIGIT_TAG)
    }

    /// From U+0660 on, the digits of the base do not count.
    fn is_own_digit(&self, c: u32) -> bool {
        if c < 0x660 {
            (0x30..=0x39).contains(&c)
        } else {
            collation::has_ce32_tag(self.ce32(c), collation::DIGIT_TAG)
        }
    }

    /// `c` is a code point or a UTF-16 code unit.
    pub(crate) fn is_unsafe_backward(&self, c: u32, numeric: bool) -> bool {
        (numeric && self.is_own_digit(c)) || self.unsafe_backward_set.contains(c)
    }

    /// The CE32 that applies if no prefix or suffix of the context table at `index` matches.
    #[inline(always)]
    pub(crate) fn default_ce32(&self, index: usize) -> u32 {
        (u32::from(self.contexts.at(index)) << 16) | u32::from(self.contexts.at(index + 1))
    }

    pub(crate) fn context_trie(&self, index: usize) -> UCharsTrie<'static> {
        UCharsTrie::with_root(self.contexts, index + 2)
    }

    #[inline]
    pub(crate) fn ce_from_offset_ce32(&self, c: u32, ce32: u32) -> u64 {
        let data_ce = self.ces.at(collation::index_from_ce32(ce32));
        collation::make_ce(collation::three_byte_primary_for_offset_data(c, data_ce))
    }

    /// Returns the lowest primary weight of the group, or 0 if `script` is unknown: the first start is 0.
    pub(crate) fn first_primary_for_group(&self, script: i32) -> u32 {
        u32::from(self.script_starts.at(self.script_index(script))) << 16
    }

    /// Returns the highest primary weight of the group, or 0 if `script` is unknown.
    pub(crate) fn last_primary_for_group(&self, script: i32) -> u32 {
        match self.script_index(script) {
            0 => 0,
            index => (u32::from(self.script_starts.at(index + 1)) << 16).wrapping_sub(1),
        }
    }

    fn script_index(&self, script: i32) -> usize {
        let special = script.wrapping_sub(UCOL_REORDER_CODE_FIRST);
        if (0..self.num_scripts).contains(&script) {
            self.scripts_index.at(script as usize).into()
        } else if (0..MAX_NUM_SPECIAL_REORDER_CODES).contains(&special) {
            self.special_index(special)
        } else {
            0
        }
    }

    fn special_index(&self, special: i32) -> usize {
        self.scripts_index
            .get((self.num_scripts + special) as usize)
            .map_or(0, usize::from)
    }

    /// Returns (limit, lead byte offset) pairs in the upper and lower 16 bits, or nothing if the order is unchanged.
    pub(crate) fn make_reorder_ranges(&self, reorder: &[i32]) -> Result<Vec<u32>, UErrorCode> {
        let mut ranges = Vec::new();
        if *reorder == [USCRIPT_UNKNOWN] {
            return Ok(ranges);
        }
        let lead_bytes = self.reordered_lead_bytes(reorder, false)?;
        let last = self.script_starts.len() - 1;
        let mut offset = 0;
        for (i, start) in self.script_starts.iter().map(i32::from).enumerate().skip(1) {
            let next_offset = match lead_bytes.at(i) {
                _ if i == last => 0,
                ANY_LEAD_BYTE => offset,
                lead_byte => i32::from(lead_byte) - (start >> 8),
            };
            if next_offset != offset {
                try_push(&mut ranges, ((start << 16) | (offset & 0xffff)) as u32)?;
                offset = next_offset;
            }
        }
        Ok(ranges)
    }

    fn reordered_lead_bytes(
        &self,
        reorder: &[i32],
        latin_must_move: bool,
    ) -> Result<LeadBytes, UErrorCode> {
        let script_start = |index: usize| i32::from(self.script_starts.at(index));
        let last = self.script_starts.len() - 1;
        // An index of 0 is harmless: `table[0]` is never read.
        let mut table = [0; MAX_NUM_SCRIPT_RANGES];
        table.set(
            self.special_index(REORDER_RESERVED_BEFORE_LATIN),
            ANY_LEAD_BYTE,
        );
        table.set(
            self.special_index(REORDER_RESERVED_AFTER_LATIN),
            ANY_LEAD_BYTE,
        );
        let (mut low_start, mut high_limit) = (script_start(1), script_start(last));

        // Special groups that are not in `reorder` come first.
        let mut has_special = false;
        for special in 0..MAX_NUM_SPECIAL_REORDER_CODES {
            let index = self.special_index(special);
            if reorder.contains(&(UCOL_REORDER_CODE_FIRST + special)) {
                has_special = true;
            } else if index != 0 {
                low_start = self.add_low_script_range(&mut table, index, low_start);
            }
        }

        // Avoid moving Latin if it is the first script.
        let mut skipped_reserved = 0;
        if !has_special && reorder.first() == Some(&USCRIPT_LATIN) && !latin_must_move {
            let start = script_start(self.script_index(USCRIPT_LATIN));
            skipped_reserved = start - low_start;
            low_start = start;
        }

        // Scripts after "others" are placed from the top down, in reverse order.
        let others = reorder.iter().position(|&script| script == USCRIPT_UNKNOWN);
        let (low, high) = reorder.split_at(others.unwrap_or(reorder.len()));
        let (low, high) = (
            low.iter().map(|&script| (script, true)),
            high.iter().skip(1).map(|&script| (script, false)),
        );
        for (script, is_low) in low.chain(high.rev()) {
            if script == USCRIPT_UNKNOWN {
                return Err(U_ILLEGAL_ARGUMENT_ERROR);
            }
            match self.script_index(script) {
                0 => {}
                // Duplicate or equivalent script.
                index if table.at(index) != 0 => return Err(U_ILLEGAL_ARGUMENT_ERROR),
                index if is_low => {
                    low_start = self.add_low_script_range(&mut table, index, low_start)
                }
                index => high_limit = self.add_high_script_range(&mut table, index, high_limit),
            }
        }

        // The remaining scripts go into the middle.
        for index in 1..last {
            if table.at(index) == 0 {
                if others.is_none() {
                    low_start = low_start.max(script_start(index));
                }
                low_start = self.add_low_script_range(&mut table, index, low_start);
            }
        }
        if low_start <= high_limit {
            Ok(table)
        } else if low_start.wrapping_sub(skipped_reserved & 0xff00) <= high_limit {
            // Recurses once: `skipped_reserved` is then 0.
            self.reordered_lead_bytes(reorder, true)
        } else {
            Err(U_ILLEGAL_ARGUMENT_ERROR)
        }
    }

    /// The result is above 0xffff if the lead bytes are used up. With damaged data it can wrap.
    fn add_low_script_range(&self, table: &mut LeadBytes, index: usize, mut low_start: i32) -> i32 {
        let (start, limit) = (
            i32::from(self.script_starts.at(index)),
            i32::from(self.script_starts.at(index + 1)),
        );
        if (start & 0xff) < (low_start & 0xff) {
            low_start = low_start.wrapping_add(0x100);
        }
        table.set(index, (low_start >> 8) as u8);
        (low_start & !0xff).wrapping_add((limit & 0xff00) - (start & 0xff00)) | (limit & 0xff)
    }

    /// The result is negative if the lead bytes are used up. With damaged data it can wrap.
    fn add_high_script_range(
        &self,
        table: &mut LeadBytes,
        index: usize,
        mut high_limit: i32,
    ) -> i32 {
        let (start, limit) = (
            i32::from(self.script_starts.at(index)),
            i32::from(self.script_starts.at(index + 1)),
        );
        if (limit & 0xff) > (high_limit & 0xff) {
            high_limit = high_limit.wrapping_sub(0x100);
        }
        high_limit =
            (high_limit & !0xff).wrapping_sub((limit & 0xff00) - (start & 0xff00)) | (start & 0xff);
        table.set(index, (high_limit >> 8) as u8);
        high_limit
    }
}

/// The new lead byte of each range of `script_starts`, or 0 if unassigned.
type LeadBytes = [u8; MAX_NUM_SCRIPT_RANGES];

const ANY_LEAD_BYTE: u8 = 0xff;
