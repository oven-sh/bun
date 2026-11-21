//! The normalization algorithms and their data. ICU4C: normalizer2impl.cpp

use crate::common::bytes::{U16s, U32s};
use crate::common::memory::{Appendable, reserve_append_exact};
use crate::common::normalizer2::UNormalization2Mode::{self, Compose, Decompose};
use crate::common::sink::{BufferAccess, MAX_STRING_CAPACITY, WritableAlias};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::ucptrie::FastTrie16;
use crate::common::udata::{self, compiled_in, compiled_in_index};
use crate::common::utf16;
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use std::mem::{swap, take};

/// The arithmetic wraps, because damaged data can mark any code point as a syllable or a Jamo.
pub(crate) mod hangul {
    pub(super) const JAMO_L_BASE: u32 = 0x1100;
    pub(super) const JAMO_V_BASE: u32 = 0x1161;
    pub(super) const JAMO_T_BASE: u32 = 0x11a7;
    pub(crate) const HANGUL_BASE: u32 = 0xac00;
    pub(crate) const JAMO_L_COUNT: u32 = 19;
    pub(crate) const JAMO_V_COUNT: u32 = 21;
    pub(crate) const JAMO_T_COUNT: u32 = 28;
    const HANGUL_COUNT: u32 = JAMO_L_COUNT * JAMO_V_COUNT * JAMO_T_COUNT;

    pub(super) fn is_hangul_lv(c: u32) -> bool {
        let c = c.wrapping_sub(HANGUL_BASE);
        c < HANGUL_COUNT && c.is_multiple_of(JAMO_T_COUNT)
    }

    /// Returns the Jamos of the syllable `c` and their number, 2 or 3.
    pub(super) fn decompose(c: u32) -> ([u16; 3], usize) {
        let c = c.wrapping_sub(HANGUL_BASE);
        let (lv, t) = (c / JAMO_T_COUNT, c % JAMO_T_COUNT);
        let jamos = [
            (JAMO_L_BASE + lv / JAMO_V_COUNT) as u16,
            (JAMO_V_BASE + lv % JAMO_V_COUNT) as u16,
            (JAMO_T_BASE + t) as u16,
        ];
        (jamos, 2 + usize::from(t != 0))
    }

    /// Returns the LV syllable for the index `l` of a Jamo L and the Jamo V code point `v`.
    pub(super) fn compose_lv(l: u32, v: u32) -> u32 {
        let lv = l
            .wrapping_mul(JAMO_V_COUNT)
            .wrapping_add(v.wrapping_sub(JAMO_V_BASE));
        HANGUL_BASE.wrapping_add(lv.wrapping_mul(JAMO_T_COUNT))
    }
}

const MIN_YES_YES_WITH_CC: u16 = 0xfe02;
const JAMO_VT: u16 = 0xfe00;
const MIN_NORMAL_MAYBE_YES: u16 = 0xfc00;
const JAMO_L: u16 = 2;
const INERT: u16 = 1;
const HAS_COMP_BOUNDARY_AFTER: u16 = 1;
const OFFSET_SHIFT: u16 = 1;
const DELTA_TCCC_1: u16 = 2;
const DELTA_TCCC_MASK: u16 = 6;
const DELTA_SHIFT: u16 = 3;
const MAX_DELTA: u16 = 0x40;

const IX_NORM_TRIE_OFFSET: usize = 0;
const IX_EXTRA_DATA_OFFSET: usize = 1;
const IX_SMALL_FCD_OFFSET: usize = 2;
const IX_MIN_DECOMP_NO_CP: usize = 8;
const IX_MIN_COMP_NO_MAYBE_CP: usize = 9;
const IX_MIN_YES_NO: usize = 10;
const IX_MIN_NO_NO: usize = 11;
const IX_LIMIT_NO_NO: usize = 12;
const IX_MIN_MAYBE_YES: usize = 13;
const IX_MIN_YES_NO_MAPPINGS_ONLY: usize = 14;
const IX_MIN_NO_NO_COMP_BOUNDARY_BEFORE: usize = 15;
const IX_MIN_NO_NO_COMP_NO_MAYBE_CC: usize = 16;
const IX_MIN_NO_NO_EMPTY: usize = 17;
const IX_MIN_MAYBE_NO: usize = 20;
const IX_COUNT: usize = 21;

const MAPPING_HAS_CCC_LCCC_WORD: u16 = 0x80;
const MAPPING_LENGTH_MASK: u16 = 0x1f;

const COMP_1_LAST_TUPLE: u16 = 0x8000;
const COMP_1_TRIPLE: u16 = 1;
const COMP_1_TRAIL_LIMIT: u32 = 0x3400;
const COMP_1_TRAIL_MASK: u16 = 0x7ffe;
const COMP_1_TRAIL_SHIFT: u32 = 9;
const COMP_2_TRAIL_SHIFT: u32 = 6;
const COMP_2_TRAIL_MASK: u16 = 0xffc0;

const DECOMPOSITION_CAPACITY: usize = MAPPING_LENGTH_MASK as usize;
type DecompositionBuffer = [u16; DECOMPOSITION_CAPACITY];

/// Number of units that an insertion must pass over to trigger `bulk_insert_marks`.
const BULK_INSERT_THRESHOLD: usize = 32;
/// Number of units after which `span_yes` calls `span_below` again.
const SKIP_RETRY_INTERVAL: usize = 32;

/// A text that keeps its combining marks in canonical order. A failure to grow drops it, which `with_buffer` reports.
pub(crate) struct ReorderingBuffer<'a> {
    impl_: &'a Normalizer2Impl,
    /// The destination's buffer. Empty once the text is on the heap.
    borrowed: &'a mut [u16],
    /// The text if it is on the heap, else empty.
    heap: Vec<u16>,
    len: usize,
    /// 0 after a failure to grow.
    max_len: usize,
    reorder_start: usize,
    last_cc: u8,
    /// An insertion has reached `BULK_INSERT_THRESHOLD` since the last call of `bulk_insert_marks`.
    prefers_bulk_insert: bool,
}

impl ReorderingBuffer<'_> {
    fn text(&self) -> &[u16] {
        if self.heap.is_empty() {
            self.borrowed.slice(..self.len)
        } else {
            &self.heap
        }
    }

    fn text_mut(&mut self) -> &mut [u16] {
        if self.heap.is_empty() {
            self.borrowed.slice_mut(..self.len)
        } else {
            &mut self.heap
        }
    }

    /// Moves the text to the heap if necessary, and reserves `count` more units. Returns false on failure.
    #[inline]
    fn reserve_on_heap(&mut self, count: usize) -> bool {
        count <= self.heap.capacity() - self.heap.len() || self.resize(count)
    }

    #[cold]
    fn resize(&mut self, count: usize) -> bool {
        let (borrowed, needed) = (take(&mut self.borrowed), self.len + count);
        let min_capacity = if self.heap.capacity() == 0 { 256 } else { 0 };
        let doubled = borrowed
            .len()
            .max(self.heap.capacity())
            .saturating_mul(2)
            .max(min_capacity)
            .min(self.max_len);
        let additional = needed.max(doubled) - self.heap.len();
        if needed > self.max_len || reserve_append_exact(&mut self.heap, additional).is_err() {
            (self.heap, self.len, self.max_len) = (Vec::new(), 0, 0);
            return false;
        }
        self.heap
            .add_all(borrowed.slice(..self.len - self.heap.len()));
        true
    }

    #[inline(always)]
    fn add(&mut self, unit: u16) {
        if let Some(slot) = self.borrowed.get_mut(self.len) {
            *slot = unit;
            self.len += 1;
        } else {
            self.add_on_heap(unit);
        }
    }

    #[inline(never)]
    fn add_on_heap(&mut self, unit: u16) {
        if self.reserve_on_heap(1) {
            self.heap.add(unit);
            self.len += 1;
        }
    }

    #[inline(never)]
    fn add_all(&mut self, units: &[u16]) {
        let end = self.len + units.len();
        if let Some(spare) = self.borrowed.get_mut(self.len..end) {
            self.len = end;
            spare.copy_from_slice(units);
        } else {
            self.add_all_on_heap(units);
        }
    }

    #[inline(never)]
    fn add_all_on_heap(&mut self, units: &[u16]) {
        if self.reserve_on_heap(units.len()) {
            self.len += units.len();
            self.heap.add_all(units);
        }
    }

    #[inline(always)]
    fn add_each(&mut self, units: impl ExactSizeIterator<Item = u16>) {
        let end = self.len + units.len();
        if let Some(spare) = self.borrowed.get_mut(self.len..end) {
            spare
                .iter_mut()
                .zip(units)
                .for_each(|(slot, unit)| *slot = unit);
        } else if self.reserve_on_heap(units.len()) {
            self.heap.add_each(units);
        } else {
            return;
        }
        self.len = end;
    }

    #[inline(always)]
    fn add_code_point(&mut self, c: u32) {
        if c <= 0xffff {
            self.add(c as u16)
        } else {
            self.add_supplementary(c)
        }
    }

    fn add_supplementary(&mut self, c: u32) {
        self.add_all(&[utf16::lead(c), utf16::trail(c)]);
    }

    fn truncate(&mut self, len: usize) {
        self.heap.truncate(len);
        (self.len, self.reorder_start, self.last_cc) = (len, len, 0);
    }

    #[inline(always)]
    fn append(&mut self, c: u32, cc: u8) {
        if self.last_cc <= cc || cc == 0 {
            self.add_code_point(c);
            self.last_cc = cc;
            if cc <= 1 {
                self.reorder_start = self.len;
            }
        } else {
            self.insert(c, cc);
        }
    }

    #[inline(always)]
    fn append_zero_cc_str(&mut self, s: &[u16]) {
        if !s.is_empty() {
            (self.reorder_start, self.last_cc) = (self.len + s.len(), 0);
            self.add_all(s);
        }
    }

    #[inline(never)]
    fn append_decomposed_hangul(&mut self, c: u32) {
        let (jamos, length) = hangul::decompose(c);
        self.append_zero_cc_str(jamos.slice(..length));
    }

    /// Returns false and does nothing if `s` needs reordering.
    #[inline(always)]
    fn append_in_order(
        &mut self,
        s: impl ExactSizeIterator<Item = u16>,
        lead_cc: u8,
        trail_cc: u8,
    ) -> bool {
        if s.len() == 0 {
            return true;
        } else if self.last_cc > lead_cc && lead_cc != 0 {
            return false;
        }
        if trail_cc <= 1 {
            self.reorder_start = self.len + s.len();
        } else if lead_cc <= 1 {
            self.reorder_start = self.len + 1; // May split a surrogate pair.
        }
        self.add_each(s);
        self.last_cc = trail_cc;
        true
    }

    /// Moves `*p` back by one code point and returns its combining class, or returns 0 if `*p <= reorder_start`.
    fn previous_cc(&self, p: &mut usize) -> u8 {
        if *p <= self.reorder_start {
            return 0;
        }
        self.impl_
            .get_cc_from_yes_or_maybe_yes_cp(utf16::prev(self.text(), p))
    }

    /// Returns the index after the last character before `p` for which `previous_cc` returns a class up to `cc`.
    fn insertion_index(&self, cc: u8, mut p: usize) -> usize {
        let text = self.text();
        while p > self.reorder_start {
            let limit = p;
            if self
                .impl_
                .get_cc_from_yes_or_maybe_yes_cp(utf16::prev(text, &mut p))
                <= cc
            {
                return limit;
            }
        }
        p
    }

    /// Inserts `c` before the last character. Requires `0 < cc < last_cc`.
    fn insert(&mut self, c: u32, cc: u8) {
        let end = self.len;
        self.add_code_point(c);
        if self.len <= end {
            return;
        }
        let (mut p, length) = (end, self.len - end);
        utf16::back_1(self.text(), &mut p);
        let index = self.insertion_index(cc, p);
        self.prefers_bulk_insert |= p - index >= BULK_INSERT_THRESHOLD;
        let tail = self.text_mut().slice_mut(index..);
        for _ in 0..length {
            // `rotate_right(1)`, which costs more for the usual short tail.
            let mut carried = tail.at(tail.len().wrapping_sub(1));
            for unit in &mut *tail {
                swap(unit, &mut carried);
            }
        }
        if cc <= 1 {
            self.reorder_start = index + length;
        }
    }
}

pub(crate) struct Normalizer2Impl {
    min_decomp_no_cp: u16,
    min_comp_no_maybe_cp: u16,
    min_yes_no: u16,
    min_yes_no_mappings_only: u16,
    min_no_no: u16,
    min_no_no_comp_boundary_before: u16,
    min_no_no_comp_no_maybe_cc: u16,
    min_no_no_empty: u16,
    limit_no_no: u16,
    center_no_no_delta: u16,
    min_maybe_no: u16,
    min_maybe_yes: u16,
    norm_trie: FastTrie16<'static>,
    /// Reaches to the end of the item.
    extra_data: U16s<'static>,
}

const NFC_BYTES: &[u8] = compiled_in!("nfc.nrm", b"Nrm2", 5).1;

#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
pub(crate) static NFC: Normalizer2Impl = {
    let (mut indexes, mut i) = ([0; IX_COUNT], 0);
    while i < IX_COUNT {
        indexes[i] = u32::from_ne_bytes(NFC_BYTES.as_chunks().0[i]);
        i += 1;
    }
    let (trie, extra_data) = NFC_BYTES.split_at(indexes[IX_EXTRA_DATA_OFFSET] as usize);
    let trie = trie.split_at(indexes[IX_NORM_TRIE_OFFSET] as usize).1;
    Normalizer2Impl::init(&indexes, FastTrie16::open(trie).unwrap(), extra_data)
};

/// Returns the canonical lccc in bits 15..8 and tccc in bits 7..0.
pub(crate) fn get_fcd16(c: u32) -> u16 {
    /// One bit for each 32 BMP code points. It is clear if all their values are 0.
    const SMALL_FCD: &[u8; 0x100] = NFC_BYTES
        .split_at(compiled_in_index!(NFC_BYTES, IX_SMALL_FCD_OFFSET))
        .1
        .first_chunk()
        .unwrap();
    if c < u32::from(NFC.min_decomp_no_cp)
        || (c <= 0xffff && (SMALL_FCD.at(usize::from((c >> 8) as u8)) >> ((c >> 5) & 7)) & 1 == 0)
    {
        return 0;
    }
    NFC.get_fcd16_from_norm_data(c)
}

/// Returns the number of leading units below `limit`, rounded down to a multiple of 4.
#[inline(always)]
fn span_below(s: &[u16], limit: u16) -> usize {
    let mut rest = s;
    while let [a, b, c, d, tail @ ..] = rest
        && (*a < limit && *b < limit && *c < limit && *d < limit)
    {
        rest = tail;
    }
    s.len() - rest.len()
}

fn get_cc_from_normal_yes_or_maybe(norm16: u16) -> u8 {
    (norm16 >> OFFSET_SHIFT) as u8
}

fn get_cc_from_yes_or_maybe_yes(norm16: u16) -> u8 {
    if norm16 >= MIN_NORMAL_MAYBE_YES {
        get_cc_from_normal_yes_or_maybe(norm16)
    } else {
        0
    }
}

fn get_data_for_yes_or_no(norm16: u16) -> usize {
    usize::from(norm16 >> OFFSET_SHIFT)
}

/// The kind of text that `decompose` appends for a code point.
enum DecompositionKind {
    /// A code point and its combining class.
    Single(u32, u8),
    Hangul(u32),
    /// Index of the mapping's first unit in `extra_data`.
    Mapping(usize),
}

impl Normalizer2Impl {
    pub(crate) fn load(name: &[u8]) -> Result<Self, UErrorCode> {
        let data = udata::open_choice(None, b"nrm", name, |info| {
            &info.data_format == b"Nrm2" && info.format_version[0] == 5
        })?;
        let (in_bytes, mut indexes) = (data.memory, [0; IX_COUNT]);
        indexes
            .iter_mut()
            .zip(U32s::of(in_bytes).iter())
            .for_each(|(index, value)| *index = value);
        let (offset, next_offset) = (
            indexes[IX_NORM_TRIE_OFFSET] as usize,
            indexes[IX_EXTRA_DATA_OFFSET] as usize,
        );
        let (trie, extra_data) = in_bytes
            .split_at_checked(next_offset)
            .filter(|_| offset / 4 > IX_MIN_MAYBE_NO)
            .ok_or(U_INVALID_FORMAT_ERROR)?;
        let trie = trie.get(offset..).and_then(FastTrie16::open);
        Ok(Self::init(
            &indexes,
            trie.ok_or(U_INVALID_FORMAT_ERROR)?,
            extra_data,
        ))
    }

    const fn init(
        indexes: &[u32; IX_COUNT],
        norm_trie: FastTrie16<'static>,
        extra_data: &'static [u8],
    ) -> Self {
        let min_maybe_no = indexes[IX_MIN_MAYBE_NO] as u16;
        Self {
            min_decomp_no_cp: indexes[IX_MIN_DECOMP_NO_CP] as u16,
            min_comp_no_maybe_cp: indexes[IX_MIN_COMP_NO_MAYBE_CP] as u16,
            min_yes_no: indexes[IX_MIN_YES_NO] as u16,
            min_yes_no_mappings_only: indexes[IX_MIN_YES_NO_MAPPINGS_ONLY] as u16,
            min_no_no: indexes[IX_MIN_NO_NO] as u16,
            min_no_no_comp_boundary_before: indexes[IX_MIN_NO_NO_COMP_BOUNDARY_BEFORE] as u16,
            min_no_no_comp_no_maybe_cc: indexes[IX_MIN_NO_NO_COMP_NO_MAYBE_CC] as u16,
            min_no_no_empty: indexes[IX_MIN_NO_NO_EMPTY] as u16,
            limit_no_no: indexes[IX_LIMIT_NO_NO] as u16,
            center_no_no_delta: (min_maybe_no >> DELTA_SHIFT).wrapping_sub(MAX_DELTA + 1),
            min_maybe_no,
            min_maybe_yes: indexes[IX_MIN_MAYBE_YES] as u16,
            norm_trie,
            extra_data: U16s::of(extra_data),
        }
    }

    /// Calls `f` with a buffer that appends to `dest`, about `estimate` units.
    pub(crate) fn with_buffer<T>(
        &self,
        dest: &mut impl BufferAccess,
        estimate: usize,
        f: impl FnOnce(&mut ReorderingBuffer) -> T,
    ) -> Result<T, UErrorCode> {
        let len = dest.len();
        let (borrowed, heap) = dest.get_buffer(estimate)?;
        let mut buffer = ReorderingBuffer {
            impl_: self,
            borrowed,
            heap,
            len,
            max_len: MAX_STRING_CAPACITY,
            reorder_start: len,
            last_cc: 0,
            prefers_bulk_insert: false,
        };
        let result = f(&mut buffer);
        let ReorderingBuffer {
            heap, len, max_len, ..
        } = buffer;
        // `len` can exceed `max_len` if `dest` had a larger capacity.
        let is_valid = len.max(1) <= max_len;
        dest.release_buffer(is_valid.then_some((len, heap)));
        if is_valid {
            Ok(result)
        } else {
            Err(U_MEMORY_ALLOCATION_ERROR)
        }
    }

    /// The trie stores values for lead surrogate code units. Surrogate code points are inert.
    #[inline(always)]
    fn get_norm16(&self, c: u32) -> u16 {
        if utf16::is_lead(c) {
            INERT
        } else {
            self.norm_trie.get(c)
        }
    }

    fn is_algorithmic_no_no(&self, norm16: u16) -> bool {
        self.limit_no_no <= norm16 && norm16 < self.min_maybe_no
    }

    fn is_comp_no(&self, norm16: u16) -> bool {
        self.min_no_no <= norm16 && norm16 < self.min_maybe_no
    }

    fn is_decomp_yes(&self, norm16: u16) -> bool {
        norm16 < self.min_yes_no || self.min_maybe_yes <= norm16
    }

    #[inline(always)]
    pub(crate) fn get_cc_from_yes_or_maybe_yes_cp(&self, c: u32) -> u8 {
        if c < u32::from(self.min_comp_no_maybe_cp) {
            0
        } else {
            get_cc_from_yes_or_maybe_yes(self.get_norm16(c))
        }
    }

    fn is_maybe(&self, norm16: u16) -> bool {
        self.min_maybe_no <= norm16 && norm16 <= JAMO_VT
    }

    fn is_maybe_yes_or_non_zero_cc(&self, norm16: u16) -> bool {
        norm16 >= self.min_maybe_yes
    }

    fn is_hangul_lv(&self, norm16: u16) -> bool {
        norm16 == self.min_yes_no
    }

    fn is_hangul_lvt(&self, norm16: u16) -> bool {
        norm16 == (self.min_yes_no_mappings_only | HAS_COMP_BOUNDARY_AFTER)
    }

    fn is_comp_yes_and_zero_cc(&self, norm16: u16) -> bool {
        norm16 < self.min_no_no
    }

    fn is_most_decomp_yes_and_zero_cc(&self, norm16: u16) -> bool {
        norm16 < self.min_yes_no || norm16 == MIN_NORMAL_MAYBE_YES || norm16 == JAMO_VT
    }

    fn map_algorithmic(&self, c: u32, norm16: u16) -> u32 {
        c.wrapping_add(u32::from(norm16 >> DELTA_SHIFT))
            .wrapping_sub(u32::from(self.center_no_no_delta))
    }

    fn get_data_for_maybe(&self, norm16: u16) -> usize {
        get_data_for_yes_or_no(
            norm16
                .wrapping_sub(self.min_maybe_no)
                .wrapping_add(self.limit_no_no),
        )
    }

    fn get_data(&self, norm16: u16) -> usize {
        if norm16 >= self.min_maybe_no {
            self.get_data_for_maybe(norm16)
        } else {
            get_data_for_yes_or_no(norm16)
        }
    }

    /// Returns the units of the mapping whose first unit, with the length, is at index `data`.
    fn mapping(&self, data: usize) -> impl ExactSizeIterator<Item = u16> {
        self.extra_data_units(data + 1, self.extra_data.at(data) & MAPPING_LENGTH_MASK)
    }

    fn extra_data_units(&self, start: usize, length: u16) -> impl ExactSizeIterator<Item = u16> {
        let extra_data = self.extra_data;
        (0..usize::from(length)).map(move |i| extra_data.at(start.wrapping_add(i)))
    }

    fn lead_and_trail_cc(&self, data: usize) -> (u8, u8) {
        (
            (self.ccc_lccc_word(data) >> 8) as u8,
            (self.extra_data.at(data) >> 8) as u8,
        )
    }

    /// Returns the optional word before the mapping at index `data`, or 0.
    fn ccc_lccc_word(&self, data: usize) -> u16 {
        let has_word = self.extra_data.at(data) & MAPPING_HAS_CCC_LCCC_WORD != 0;
        if has_word {
            self.extra_data.at(data.wrapping_sub(1))
        } else {
            0
        }
    }

    fn get_compositions_list_for_decomp_yes(&self, norm16: u16) -> Option<usize> {
        (JAMO_L..MIN_NORMAL_MAYBE_YES)
            .contains(&norm16)
            .then(|| self.get_data(norm16))
    }

    /// Returns a value that ends the list if `index` is outside of the item.
    fn compositions_list_unit(&self, index: usize) -> u16 {
        self.extra_data.get(index).unwrap_or(COMP_1_LAST_TUPLE)
    }

    fn compositions_list_after_mapping(&self, data: usize) -> usize {
        data + 1 + usize::from(self.compositions_list_unit(data) & MAPPING_LENGTH_MASK)
    }

    fn norm16_has_comp_boundary_before(&self, norm16: u16) -> bool {
        norm16 < self.min_no_no_comp_no_maybe_cc || self.is_algorithmic_no_no(norm16)
    }

    #[inline(always)]
    fn norm16_has_comp_boundary_after(&self, norm16: u16) -> bool {
        norm16 & HAS_COMP_BOUNDARY_AFTER != 0
    }

    /// Skips what is below `min_cp` or passes `is_yes`. Returns the character at the new `*src` and its norm16 value.
    #[inline(always)]
    fn skip_quick_check_yes(
        &self,
        s: &[u16],
        src: &mut usize,
        min_cp: u16,
        is_yes: impl Fn(u16) -> bool,
    ) -> Option<(u32, u16)> {
        let mut next = *src;
        while let Some(&unit) = s.get(next) {
            next += 1;
            if unit < min_cp {
                continue;
            }
            let (mut c, mut norm16) = (u32::from(unit), self.norm_trie.bmp_get(unit));
            if is_yes(norm16) {
                continue;
            }
            *src = next - 1;
            if utf16::is_lead(c) {
                let Some(&trail) = s.get(next).filter(|&&trail| utf16::is_trail(trail.into()))
                else {
                    continue;
                };
                next += 1;
                c = utf16::get_supplementary(c, trail.into());
                norm16 = self.norm_trie.supp_get(c);
                if is_yes(norm16) {
                    continue;
                }
            }
            return Some((c, norm16));
        }
        *src = next;
        None
    }

    /// Returns the length of a prefix that the loop of `mode` does not change. The loop may start at this index.
    #[inline]
    pub(crate) fn span_unchanged(&self, s: &[u16], mode: UNormalization2Mode) -> usize {
        match mode {
            Decompose => self.span_yes(s, self.min_decomp_no_cp, self.min_yes_no, mode),
            Compose => self.span_yes(s, self.min_comp_no_maybe_cp, self.min_no_no, mode),
        }
    }

    /// Skips units that are below `min_cp` or have a norm16 value below `limit`, without a call before the first other unit.
    #[inline(never)]
    fn span_yes(&self, s: &[u16], min_cp: u16, limit: u16, mode: UNormalization2Mode) -> usize {
        let mut i = 0;
        while i < s.len() {
            i += span_below(s.slice(i..), min_cp);
            let window = s.slice(..s.len().min(i + SKIP_RETRY_INTERVAL));
            while let Some(&unit) = window.get(i) {
                if unit >= min_cp {
                    let Some(norm16) = self.norm_trie.try_bmp_get(unit) else {
                        return i;
                    };
                    if norm16 >= limit {
                        return self.span_yes_from(s, i, norm16, mode);
                    }
                }
                i += 1;
            }
        }
        i
    }

    /// Goes on from index `i`, at which `span_yes` has found `norm16`, if the character may be unchanged too.
    #[inline(never)]
    fn span_yes_from(&self, s: &[u16], i: usize, norm16: u16, mode: UNormalization2Mode) -> usize {
        let is_lead = utf16::is_lead(s.at(i).into());
        match mode {
            Compose if is_lead || norm16 > JAMO_VT => self.span_composed_from(s, i),
            Decompose if is_lead || norm16 >= MIN_NORMAL_MAYBE_YES => self.span_decomposed(s, i),
            _ => i,
        }
    }

    /// The paths of `compose` that leave `prev_boundary` alone.
    #[inline(never)]
    fn span_composed_from(&self, s: &[u16], mut i: usize) -> usize {
        let is_yes = |norm16| self.is_comp_yes_and_zero_cc(norm16);
        while let Some((c, norm16)) =
            self.skip_quick_check_yes(s, &mut i, self.min_comp_no_maybe_cp, is_yes)
            && norm16 > JAMO_VT
        {
            let (next, norm16) = self.skip_marks_in_order(s, &mut (i + utf16::length(c)), norm16);
            if !is_yes(norm16) {
                break;
            }
            i = next;
        }
        i
    }

    /// Advances `*src` over yes-marks in order after `norm16`. Returns the limit and value (`INERT` at the end) of what follows.
    #[inline(always)]
    fn skip_marks_in_order(&self, s: &[u16], src: &mut usize, mut norm16: u16) -> (usize, u16) {
        while *src < s.len() {
            let (prev_cc, mut next) = (get_cc_from_normal_yes_or_maybe(norm16), *src);
            (_, norm16) = self.norm_trie.u16_next(s, &mut next);
            if norm16 < MIN_YES_YES_WITH_CC || prev_cc > get_cc_from_normal_yes_or_maybe(norm16) {
                return (next, norm16);
            }
            *src = next;
        }
        (*src, INERT)
    }

    /// Appends the decomposed `s`, whose first `src` units are unchanged.
    pub(crate) fn decompose(&self, s: &[u16], mut src: usize, buffer: &mut ReorderingBuffer) {
        let mut prev_src = 0;
        loop {
            let found = self.skip_quick_check_yes(s, &mut src, self.min_decomp_no_cp, |norm16| {
                self.is_most_decomp_yes_and_zero_cc(norm16)
            });
            buffer.append_zero_cc_str(s.slice(prev_src..src));
            let Some((c, norm16)) = found else { return };
            src += utf16::length(c);
            self.decompose_code_point(c, norm16, buffer);
            if buffer.prefers_bulk_insert {
                src = self.bulk_insert_marks(s, src, buffer);
            }
            prev_src = src;
        }
    }

    /// Returns the length of the prefix that is decomposed and ends at a boundary. `s[..start]` has passed the fast path.
    #[inline(never)]
    pub(crate) fn span_decomposed(&self, s: &[u16], start: usize) -> usize {
        let mut src = start + span_below(s.slice(start..), self.min_decomp_no_cp);
        let (mut prev_boundary, mut prev_cc) = (src, 0);
        loop {
            let prev_src = src;
            let found = self.skip_quick_check_yes(s, &mut src, self.min_decomp_no_cp, |norm16| {
                self.is_most_decomp_yes_and_zero_cc(norm16)
            });
            let Some((c, norm16)) = found else { return src };
            if src != prev_src {
                (prev_boundary, prev_cc) = (src, 0);
            }
            let cc = get_cc_from_yes_or_maybe_yes(norm16);
            if !self.is_decomp_yes(norm16) || (prev_cc > cc && cc != 0) {
                return prev_boundary;
            }
            src += utf16::length(c);
            prev_cc = cc;
            if cc <= 1 {
                prev_boundary = src;
            }
        }
    }

    /// Decomposes `s` from `index` to its end or the first composition boundary from `min_limit` on, which it returns.
    fn decompose_short(
        &self,
        s: &[u16],
        mut index: usize,
        min_limit: usize,
        buffer: &mut ReorderingBuffer,
    ) -> usize {
        while let Some(&unit) = s.get(index) {
            let stop_at_comp_boundary = index >= min_limit;
            if stop_at_comp_boundary && unit < self.min_comp_no_maybe_cp {
                break;
            }
            let previous = index;
            let (c, norm16) = self.norm_trie.u16_next(s, &mut index);
            if stop_at_comp_boundary && self.norm16_has_comp_boundary_before(norm16) {
                return previous;
            }
            self.decompose_code_point(c, norm16, buffer);
            if buffer.prefers_bulk_insert {
                index = self.bulk_insert_marks(s, index, buffer);
            }
        }
        index
    }

    #[inline(always)]
    fn decomposition_kind(&self, mut c: u32, mut norm16: u16) -> DecompositionKind {
        if norm16 >= self.limit_no_no {
            if self.is_maybe_yes_or_non_zero_cc(norm16) {
                return DecompositionKind::Single(c, get_cc_from_yes_or_maybe_yes(norm16));
            } else if norm16 < self.min_maybe_no {
                c = self.map_algorithmic(c, norm16);
                norm16 = self.norm_trie.get(c);
            }
        }
        if norm16 < self.min_yes_no {
            DecompositionKind::Single(c, 0)
        } else if self.is_hangul_lv(norm16) || self.is_hangul_lvt(norm16) {
            DecompositionKind::Hangul(c)
        } else {
            DecompositionKind::Mapping(self.get_data(norm16))
        }
    }

    #[inline(always)]
    fn decompose_code_point(&self, c: u32, norm16: u16, buffer: &mut ReorderingBuffer) {
        match self.decomposition_kind(c, norm16) {
            DecompositionKind::Single(c, cc) => buffer.append(c, cc),
            DecompositionKind::Hangul(c) => buffer.append_decomposed_hangul(c),
            DecompositionKind::Mapping(data) => self.append_mapping(data, buffer),
        }
    }

    #[inline(never)]
    fn append_mapping(&self, data: usize, buffer: &mut ReorderingBuffer) {
        let (lead_cc, trail_cc) = self.lead_and_trail_cc(data);
        if !buffer.append_in_order(self.mapping(data), lead_cc, trail_cc) {
            self.append_mapping_out_of_order(data, buffer);
        }
    }

    #[cold]
    fn append_mapping_out_of_order(&self, data: usize, buffer: &mut ReorderingBuffer) {
        let mut storage = [0; DECOMPOSITION_CAPACITY];
        let length = copy_mapping(self.mapping(data), &mut storage);
        for c in utf16::code_points(storage.slice(..length)) {
            buffer.append(c, self.get_cc_from_yes_or_maybe_yes_cp(c));
        }
    }

    /// The marks that the next character adds to a run. `None` if a loop may skip or stop at it, or it has other text.
    fn next_marks<'s>(
        &self,
        s: &'s [u16],
        src: &mut usize,
        storage: &'s mut DecompositionBuffer,
    ) -> Option<&'s [u16]> {
        let (start, unit) = (*src, *s.get(*src)?);
        let (c, norm16) = self.norm_trie.u16_next(s, src);
        if unit < self.min_decomp_no_cp.max(self.min_comp_no_maybe_cp)
            || utf16::is_surrogate(c)
            || self.is_most_decomp_yes_and_zero_cc(self.norm_trie.bmp_get(unit))
            || self.is_most_decomp_yes_and_zero_cc(norm16)
            || self.norm16_has_comp_boundary_before(norm16)
        {
            return None;
        }
        let data = match self.decomposition_kind(c, norm16) {
            DecompositionKind::Single(_, 1..) => return Some(s.slice(start..*src)),
            DecompositionKind::Mapping(data) => data,
            _ => return None,
        };
        let length = copy_mapping(self.mapping(data), storage);
        let classes = utf16::code_points(storage.slice(..length))
            .map(|c| self.get_cc_from_yes_or_maybe_yes_cp(c));
        (classes.clone().next() != Some(0) && classes.is_sorted())
            .then_some(storage.slice(..length))
    }

    /// Has the effect of one `append` per mark from `s[src]` on, by a counting sort. Returns the index at which it stopped.
    #[cold]
    fn bulk_insert_marks(&self, s: &[u16], src: usize, buffer: &mut ReorderingBuffer) -> usize {
        buffer.prefers_bulk_insert = false;
        let mut scratch = [0; DECOMPOSITION_CAPACITY];
        if self.next_marks(s, &mut { src }, &mut scratch).is_none() {
            return src;
        }
        let class = |c| usize::from(self.get_cc_from_yes_or_maybe_yes_cp(c));
        // For each class, the index at which `insert` puts a mark. `insert` skips the last character without a lookup.
        let (end, mut last_cc) = (buffer.len, usize::from(buffer.last_cc));
        let (mut indexes_by_cc, mut p) = ([end; 0x100], end);
        utf16::back_1(buffer.text(), &mut p);
        let mut min_known_cc = last_cc;
        while min_known_cc > 1 {
            let limit = p;
            let cc = min_known_cc.min(buffer.previous_cc(&mut p).into());
            indexes_by_cc.slice_mut(cc..min_known_cc).fill(limit);
            min_known_cc = cc;
        }

        // Counts the units of each class. The sums stay below 2^32.
        let mut units_by_cc = [0; 0x100];
        let (mut stop, mut next, mut total) = (src, src, 0);
        while total <= buffer.max_len
            && let Some(marks) = self.next_marks(s, &mut next, &mut scratch)
        {
            let trail_cc = utf16::code_points(marks).next_back().map_or(0, class);
            for c in utf16::code_points(marks) {
                let units = units_by_cc.at(class(c)) + utf16::length(c);
                units_by_cc.set(class(c), units);
            }
            (stop, total, last_cc) = (next, total + marks.len(), last_cc.max(trail_cc));
        }
        buffer.add_each(std::iter::repeat_n(0, total));
        if buffer.len <= end {
            return stop;
        }

        // Opens a gap for each class: the text between two indexes moves up by the length of all gaps before it.
        let (text, mut shift, mut limit) = (buffer.text_mut(), total, end);
        for (index, units) in indexes_by_cc.iter_mut().zip(&units_by_cc).skip(1).rev() {
            text.move_within(*index..limit, *index + shift);
            limit = *index;
            shift -= units;
            *index += shift;
        }
        let mut next = src;
        while next < stop {
            let marks = self.next_marks(s, &mut next, &mut scratch).soft_unwrap();
            let mut i = 0;
            while i < marks.len() {
                let start = i;
                let cc = class(utf16::next(marks, &mut i));
                let index = indexes_by_cc.at(cc);
                text.copy_at(index, marks.slice(start..i));
                indexes_by_cc.set(cc, index + i - start);
            }
        }
        // `reorder_start` stays: `previous_cc` returns 1 for the new marks of class 1, which ends a scan too.
        buffer.last_cc = last_cc as u8;
        stop
    }

    pub(crate) fn has_comp_boundary_before_cp(&self, c: u32) -> bool {
        c < u32::from(self.min_comp_no_maybe_cp)
            || self.norm16_has_comp_boundary_before(self.get_norm16(c))
    }

    /// Returns the composite in bits 21..1, with bit 0 set if it combines forward.
    fn combine(&self, mut list: usize, trail: u32) -> Option<i32> {
        if trail < COMP_1_TRAIL_LIMIT {
            let key1 = (trail << 1) as u16;
            let mut first_unit = self.compositions_list_unit(list);
            while key1 > first_unit {
                list += 2 + usize::from(first_unit & COMP_1_TRIPLE);
                first_unit = self.compositions_list_unit(list);
            }
            if key1 != first_unit & COMP_1_TRAIL_MASK {
                return None;
            }
            let second_unit = i32::from(self.compositions_list_unit(list + 1));
            return Some(if first_unit & COMP_1_TRIPLE != 0 {
                (second_unit << 16) | i32::from(self.compositions_list_unit(list + 2))
            } else {
                second_unit
            });
        }
        let key1 = (COMP_1_TRAIL_LIMIT
            + ((trail >> COMP_1_TRAIL_SHIFT) & !u32::from(COMP_1_TRIPLE)))
            as u16;
        let key2 = (trail << COMP_2_TRAIL_SHIFT) as u16;
        loop {
            let first_unit = self.compositions_list_unit(list);
            if key1 > first_unit {
                list += 2 + usize::from(first_unit & COMP_1_TRIPLE);
                continue;
            } else if key1 != first_unit & COMP_1_TRAIL_MASK {
                return None;
            }
            let second_unit = self.compositions_list_unit(list + 1);
            if key2 > second_unit {
                if first_unit & COMP_1_LAST_TUPLE != 0 {
                    return None;
                }
                list += 3;
            } else if key2 == second_unit & COMP_2_TRAIL_MASK {
                let third_unit = self.compositions_list_unit(list + 2);
                return Some(
                    (i32::from(second_unit & !COMP_2_TRAIL_MASK) << 16) | i32::from(third_unit),
                );
            } else {
                return None;
            }
        }
    }

    /// Recomposes the text from `start_index` on, which is in NFD. The text does not get longer.
    fn recompose(&self, buffer: &mut ReorderingBuffer, start_index: usize) {
        let Some(text @ [_, ..]) = buffer.text_mut().get_mut(start_index..) else {
            return;
        };
        let mut compositions_list = None;
        let (mut starter, mut starter_is_supplementary) = (0, false);
        let (mut p, mut prev_cc) = (0, 0);
        // The output ends `gap` units before the read position `p`, so that each character moves once.
        let mut gap = 0;
        while p < text.len() {
            let start = p;
            let (c, norm16) = self.norm_trie.u16_next(text, &mut p);
            if gap != 0 {
                text.set(start - gap, text.at(start));
                text.set(p - 1 - gap, text.at(p - 1));
            }
            let cc = get_cc_from_yes_or_maybe_yes(norm16);
            let mut p_remove = None;
            if let Some(list) = compositions_list
                && self.is_maybe(norm16)
                && (prev_cc < cc || prev_cc == 0)
            {
                if norm16 == JAMO_VT {
                    // NFD text has no LV syllable that a Jamo T could combine with.
                    compositions_list = None;
                    let l = u32::from(text.at(starter).wrapping_sub(hangul::JAMO_L_BASE as u16));
                    if c >= hangul::JAMO_T_BASE || l >= hangul::JAMO_L_COUNT {
                        continue;
                    }
                    let t = text
                        .get(p)
                        .map(|&unit| unit.wrapping_sub(hangul::JAMO_T_BASE as u16));
                    let t = t
                        .filter(|&t| u32::from(t) < hangul::JAMO_T_COUNT)
                        .unwrap_or(0);
                    p += usize::from(t != 0);
                    text.set(starter, (hangul::compose_lv(l, c) as u16).wrapping_add(t));
                    p_remove = Some(start - gap);
                } else if let Some(composite_and_fwd @ 0..) = self.combine(list, c) {
                    let (composite, mut mark_start) =
                        ((composite_and_fwd >> 1) as u32, start - gap);
                    if !(0x1_0000..=0x10_ffff).contains(&composite) {
                        text.set(starter, composite as u16);
                        if take(&mut starter_is_supplementary) {
                            text.move_within(starter + 2..mark_start, starter + 1);
                            mark_start -= 1;
                        }
                    } else {
                        if !starter_is_supplementary {
                            starter_is_supplementary = true;
                            text.move_within(starter + 1..mark_start, starter + 2);
                            mark_start += 1;
                        }
                        text.copy_at(starter, &[utf16::lead(composite), utf16::trail(composite)]);
                    }
                    p_remove = Some(mark_start);
                    compositions_list = (composite_and_fwd & 1 != 0).then(|| {
                        self.compositions_list_after_mapping(
                            self.get_data(self.norm_trie.get(composite)),
                        )
                    });
                }
            }
            if let Some(p_remove) = p_remove {
                gap = p - p_remove;
                continue;
            }
            prev_cc = cc;
            if cc == 0 {
                compositions_list = self.get_compositions_list_for_decomp_yes(norm16);
                (starter, starter_is_supplementary) = (start - gap, c > 0xffff);
            }
        }
        let limit = start_index + text.len() - gap;
        buffer.truncate(limit);
    }

    pub(crate) fn is_composed(&self, s: &[u16]) -> Result<bool, UErrorCode> {
        let start = self.span_yes(s, self.min_comp_no_maybe_cp, self.min_no_no, Compose);
        match s.get(start) {
            None => Ok(true),
            // The first step of `compose`.
            Some(&unit)
                if !utf16::is_lead(unit.into())
                    && self.is_comp_no(self.norm_trie.bmp_get(unit)) =>
            {
                Ok(false)
            }
            _ => self.is_composed_from(s, start),
        }
    }

    #[inline(never)]
    fn is_composed_from(&self, s: &[u16], start: usize) -> Result<bool, UErrorCode> {
        let mut storage = [0; 32];
        self.with_buffer(&mut WritableAlias::new(&mut storage, 0), 0, |buffer| {
            self.compose(s, start, false, buffer)
        })
    }

    /// Appends the composed `s`. If `do_compose` is false, returns whether `s` is normalized, using an empty `buffer`.
    pub(crate) fn compose(
        &self,
        s: &[u16],
        mut src: usize,
        do_compose: bool,
        buffer: &mut ReorderingBuffer,
    ) -> bool {
        let mut prev_boundary = 0;
        loop {
            let found =
                self.skip_quick_check_yes(s, &mut src, self.min_comp_no_maybe_cp, |norm16| {
                    self.is_comp_yes_and_zero_cc(norm16)
                });
            let Some((c, norm16)) = found else { break };
            let mut prev_src = src;
            src += utf16::length(c);

            // Medium-fast path: cases that need no full decomposition and recomposition.
            if norm16 < self.min_maybe_no {
                if !do_compose {
                    return false;
                }
                let is_algorithmic = self.is_algorithmic_no_no(norm16);
                if is_algorithmic || norm16 < self.min_no_no_comp_boundary_before {
                    if self.norm16_has_comp_boundary_after(norm16)
                        || self.has_comp_boundary_before(s, src)
                    {
                        buffer.append_zero_cc_str(s.slice(prev_boundary..prev_src));
                        if is_algorithmic {
                            buffer.append(self.map_algorithmic(c, norm16), 0);
                        } else {
                            buffer.append_in_order(
                                self.mapping(get_data_for_yes_or_no(norm16)),
                                0,
                                0,
                            );
                        }
                        prev_boundary = src;
                        continue;
                    }
                } else if norm16 >= self.min_no_no_empty
                    && (self.has_comp_boundary_before(s, src)
                        || self.has_comp_boundary_after(s, prev_boundary, prev_src))
                {
                    buffer.append_zero_cc_str(s.slice(prev_boundary..prev_src));
                    prev_boundary = src;
                    continue;
                }
            } else if norm16 == JAMO_VT && prev_boundary != prev_src {
                let prev = s.at(prev_src - 1);
                let l = u32::from(prev.wrapping_sub(hangul::JAMO_L_BASE as u16));
                let is_vowel = c < hangul::JAMO_T_BASE;
                if if is_vowel {
                    l < hangul::JAMO_L_COUNT
                } else {
                    hangul::is_hangul_lv(prev.into())
                } {
                    if !do_compose {
                        return false;
                    }
                    let syllable = if is_vowel {
                        let t = s
                            .get(src)
                            .map(|&unit| u32::from(unit).wrapping_sub(hangul::JAMO_T_BASE));
                        let t = t.filter(|t| (1..hangul::JAMO_T_COUNT).contains(t));
                        src += usize::from(t.is_some());
                        // Without a boundary the next character may decompose to a Jamo T.
                        let t = t.or_else(|| self.has_comp_boundary_before(s, src).then_some(0));
                        t.map(|t| hangul::compose_lv(l, c).wrapping_add(t))
                    } else {
                        Some(u32::from(prev) + c - hangul::JAMO_T_BASE)
                    };
                    if let Some(syllable) = syllable {
                        buffer.append_zero_cc_str(s.slice(prev_boundary..prev_src - 1));
                        buffer.append(u32::from(syllable as u16), 0);
                        prev_boundary = src;
                        continue;
                    }
                }
            } else if norm16 > JAMO_VT {
                // Marks that do not combine backward are unchanged if they are in order and a boundary follows.
                let (next_src, n16) = self.skip_marks_in_order(s, &mut src, norm16);
                if n16 >= MIN_YES_YES_WITH_CC && !do_compose {
                    return false;
                }
                if src >= s.len() {
                    break;
                }
                if self.norm16_has_comp_boundary_before(n16) {
                    if self.is_comp_yes_and_zero_cc(n16) {
                        src = next_src;
                    }
                    continue;
                }
            }

            // Slow path: decompose and recompose between the nearest boundaries.
            if prev_boundary != prev_src && !self.norm16_has_comp_boundary_before(norm16) {
                let mut p = prev_src;
                let (_, norm16) = self.norm_trie.u16_prev(s, prev_boundary, &mut p);
                if !self.norm16_has_comp_boundary_after(norm16) {
                    prev_src = p;
                }
            }
            if do_compose {
                buffer.append_zero_cc_str(s.slice(prev_boundary..prev_src));
            }
            let recompose_start_index = buffer.len;
            src = self.decompose_short(s, prev_src, src, buffer);
            self.recompose(buffer, recompose_start_index);
            if !do_compose {
                if buffer.text() != s.slice(prev_src..src) {
                    return false;
                }
                buffer.truncate(0);
            }
            prev_boundary = src;
        }
        if do_compose {
            buffer.append_zero_cc_str(s.slice(prev_boundary..));
        }
        true
    }

    fn has_comp_boundary_before(&self, s: &[u16], mut src: usize) -> bool {
        s.get(src)
            .is_none_or(|&unit| unit < self.min_comp_no_maybe_cp)
            || self.norm16_has_comp_boundary_before(self.norm_trie.u16_next(s, &mut src).1)
    }

    fn has_comp_boundary_after(&self, s: &[u16], start: usize, mut p: usize) -> bool {
        start == p
            || self.norm16_has_comp_boundary_after(self.norm_trie.u16_prev(s, start, &mut p).1)
    }

    fn get_fcd16_from_norm_data(&self, c: u32) -> u16 {
        let mut norm16 = self.get_norm16(c);
        if norm16 >= self.limit_no_no {
            if norm16 >= MIN_NORMAL_MAYBE_YES {
                return u16::from(get_cc_from_normal_yes_or_maybe(norm16)) * 0x101;
            } else if norm16 >= self.min_maybe_yes {
                return 0;
            } else if norm16 < self.min_maybe_no {
                let delta_trail_cc = norm16 & DELTA_TCCC_MASK;
                if delta_trail_cc <= DELTA_TCCC_1 {
                    return delta_trail_cc >> OFFSET_SHIFT;
                }
                norm16 = self.norm_trie.get(self.map_algorithmic(c, norm16));
            }
        }
        if norm16 <= self.min_yes_no || self.is_hangul_lvt(norm16) {
            return 0;
        }
        let data = self.get_data(norm16);
        (self.extra_data.at(data) >> 8) | (self.ccc_lccc_word(data) & 0xff00)
    }
}

/// Copies `mapping` to the start of `buffer` and returns its length.
fn copy_mapping(
    mapping: impl ExactSizeIterator<Item = u16>,
    buffer: &mut DecompositionBuffer,
) -> usize {
    let length = mapping.len();
    buffer
        .iter_mut()
        .zip(mapping)
        .for_each(|(slot, unit)| *slot = unit);
    length
}
