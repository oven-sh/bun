//! Maps text to collation elements (CEs). ICU4C: collationiterator.cpp

use crate::common::memory::{
    Appendable, check_oom, set_oom, try_box, try_heap_push, try_insert, try_push,
};
use crate::common::normalizer2impl::{get_fcd16, hangul};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::ucharstrie::UCharsTrie;
use crate::common::ustringtrie::UStringTrieResult::NoMatch;
use crate::common::utf16;
use crate::common::utypes::*;
use crate::i18n::collation;
use crate::i18n::collationdata::CollationData;
use crate::i18n::collationfcd;
use std::cmp::Reverse;
use std::collections::BinaryHeap;
use std::ops::{Deref, DerefMut};

/// Keeps a failure, be it that of a segment that is too long, in the OOM flag, which `next_ce_from_ce32` checks.
fn or_set_oom(c: Result<Option<u32>, UErrorCode>) -> Option<u32> {
    c.map_err(set_oom).ok().flatten()
}

/// A text that is normalized while it is read, forward or backward. It fails if a segment cannot be normalized.
pub(crate) trait Text {
    fn next(&mut self) -> Result<Option<u32>, UErrorCode>;

    fn previous(&mut self) -> Result<Option<u32>, UErrorCode>;

    /// Returns the next code point (or lead surrogate of UTF-16 text) and its CE32 in `data`, without fallback.
    fn next_ce32(&mut self, data: &CollationData) -> Result<Option<(u32, u32)>, UErrorCode>;

    /// Moves forward over at most `n` code points that have been read before.
    fn forward(&mut self, n: usize) {
        let mut left = n;
        while left > 0 && or_set_oom(self.next()).is_some() {
            left -= 1;
        }
    }

    /// Moves backward over at most `n` code points that have been read before.
    fn backward(&mut self, n: usize) {
        let mut left = n;
        while left > 0 && or_set_oom(self.previous()).is_some() {
            left -= 1;
        }
    }

    /// Consumes a trail surrogate after `next_ce32` has returned a lead surrogate.
    fn next_trail_surrogate(&mut self) -> Option<u32>;

    /// True only if `may_have_lccc` is false for the next code point, and reading it and moving back changes nothing.
    fn is_before_lccc_zero(&self) -> bool {
        false
    }

    /// Returns the current buffer and the index in it. Equal results denote the same position in the same code units.
    fn position(&self) -> (BufferId, usize);
}

/// Identifies a buffer: `INPUT_BUFFER`, or the normalized form of the input between two offsets.
pub(crate) type BufferId = (usize, usize);
pub(crate) const INPUT_BUFFER: BufferId = (0, 0);

/// The inline buffer of a `MaybeStack`. Only `FEW` of the `N` items are initialized until more are needed.
enum Slots<T, const N: usize, const FEW: usize> {
    Few([T; FEW]),
    All([T; N]),
}

impl<T, const N: usize, const FEW: usize> Slots<T, N, FEW> {
    #[inline]
    fn initialized(&self) -> &[T] {
        match self {
            Self::Few(slots) => slots,
            Self::All(slots) => slots,
        }
    }

    #[inline]
    fn initialized_mut(&mut self) -> &mut [T] {
        match self {
            Self::Few(slots) => slots,
            Self::All(slots) => slots,
        }
    }
}

/// A list that does not allocate up to `N` items.
struct MaybeStack<T, const N: usize, const FEW: usize = N> {
    length: usize,
    stack: Slots<T, N, FEW>,
    /// Holds all items if there are more than `N`.
    heap: Vec<T>,
}

impl<T: Copy + Default, const N: usize, const FEW: usize> MaybeStack<T, N, FEW> {
    #[inline(always)]
    fn new() -> Self {
        Self {
            length: 0,
            stack: Slots::Few([T::default(); FEW]),
            heap: Vec::new(),
        }
    }

    #[inline(always)]
    fn push(&mut self, item: T) -> Result<(), UErrorCode> {
        // Both variants have the first `FEW` slots, so the usual case does not read the discriminant.
        if let Some(slot) = self
            .stack
            .initialized_mut()
            .slice_mut(..FEW)
            .get_mut(self.length)
        {
            *slot = item;
        } else if self.length > N && self.heap.len() != self.heap.capacity() {
            self.heap.add(item);
        } else if let Slots::All(slots) = &mut self.stack
            && let Some(slot) = slots.get_mut(self.length)
        {
            *slot = item;
        } else {
            return self.grow_and_push(item);
        }
        self.length += 1;
        Ok(())
    }

    #[cold]
    #[inline(never)]
    fn grow_and_push(&mut self, item: T) -> Result<(), UErrorCode> {
        if let Slots::Few(few) = self.stack
            && self.length < N
        {
            self.stack = Slots::All([T::default(); N]);
            let slots = self.stack.initialized_mut();
            slots.copy_at(0, &few);
            slots.set(FEW, item);
        } else {
            if self.length == N {
                self.heap.reserve_append(4 * N)?;
                self.heap.add_all(self.stack.initialized());
            }
            try_push(&mut self.heap, item)?;
        }
        self.length += 1;
        Ok(())
    }

    /// Returns the item that was pushed at `index`. It may return the old value of an item that was modified.
    #[inline(always)]
    fn pushed(&self, index: usize) -> T {
        debug_assert!(index < self.length);
        let slots = self.stack.initialized();
        let slot = slots.slice(..FEW).get(index).or_else(|| slots.get(index));
        slot.copied().unwrap_or_else(|| self.heap.at(index))
    }

    /// The OOM flag keeps a failure.
    fn add(&mut self, item: T) {
        _ = self.push(item);
    }

    #[inline(always)]
    fn len(&self) -> usize {
        self.length
    }
}

impl<T, const N: usize, const FEW: usize> Deref for MaybeStack<T, N, FEW> {
    type Target = [T];

    #[inline(always)]
    fn deref(&self) -> &[T] {
        self.stack
            .initialized()
            .get(..self.length)
            .unwrap_or(&self.heap)
    }
}

impl<T, const N: usize, const FEW: usize> DerefMut for MaybeStack<T, N, FEW> {
    fn deref_mut(&mut self) -> &mut [T] {
        self.stack
            .initialized_mut()
            .get_mut(..self.length)
            .unwrap_or(&mut self.heap)
    }
}

/// The CEs that an iterator has fetched.
#[derive(Clone, Copy)]
pub(crate) struct Fetched<'i>(&'i [u64]);

impl Fetched<'_> {
    /// Returns `NO_CE` past the end.
    #[inline(always)]
    pub(crate) fn ce(self, i: usize) -> u64 {
        self.0.get(i).copied().unwrap_or(collation::NO_CE)
    }
}

/// A node of the linked list of combining marks read by discontiguous contraction matching.
#[derive(Clone, Copy, Default)]
struct Mark {
    /// `NO_CODE_POINT` after the mark has matched and was unlinked.
    c: u32,
    previous: u32,
    next: u32,
    /// `Text::position` after the mark.
    end: u32,
}

/// If fewer marks remain in the list, a search reads them one by one.
const MIN_MARKS_FOR_LOOKUP: usize = 16;

/// A run of marks from which matches are unlinked. A lookup tests only the first unblocked mark of each code point.
#[derive(Default)]
struct SkippedMarks {
    /// In text order.
    marks: Vec<Mark>,
    /// `first..ahead` are the pending skipped marks; `ahead..` are cached marks after the text position.
    first: usize,
    ahead: usize,
    /// Index of the next mark to read. `pos - ahead` code points have been read from the text if `pos > ahead`.
    pos: usize,
    /// Index of the last linked mark.
    last: u32,
    /// The buffer that `Mark::end` indexes for `ahead..`. `None` invalidates these marks.
    buffer: Option<BufferId>,
    /// True if the run ends after the last cached mark.
    is_complete: bool,
    /// Sorted by code point: min-heaps of the unblocked marks before `indexed`. Stale entries are dropped lazily.
    unblocked: Vec<(u32, BinaryHeap<Reverse<u32>>)>,
    indexed: usize,
    /// Marks that `first_match` has tested one by one since the last lookup in `unblocked`.
    tested: usize,
}

impl SkippedMarks {
    fn is_empty(&self) -> bool {
        self.first == self.ahead
    }

    fn clear(&mut self) {
        (self.first, self.pos) = (self.ahead, self.ahead);
    }

    #[inline]
    fn next(&mut self) -> Option<u32> {
        let mark = self.marks.slice(..self.ahead).get(self.pos)?;
        self.pos = mark.next as usize;
        Some(mark.c)
    }

    /// Returns the predecessor of the mark at `index`, which may be `marks.len()`.
    fn predecessor(&self, index: usize) -> usize {
        self.marks
            .get(index)
            .map_or(self.last, |mark| mark.previous) as usize
    }

    /// Returns how many of the `n` code points came from the text.
    fn backward(&mut self, n: usize) -> usize {
        let beyond = n.min(self.pos.saturating_sub(self.ahead));
        self.pos -= beyond;
        for _ in beyond..n {
            self.pos = self.predecessor(self.pos).max(self.first);
        }
        beyond
    }

    /// Appends `c`, which was read from the text, with `Text::position` after it.
    fn push(&mut self, c: u32, (buffer, end): (BufferId, usize)) -> Result<(), UErrorCode> {
        let index = self.marks.len() as u32;
        try_push(
            &mut self.marks,
            Mark {
                c,
                previous: self.last,
                next: index.wrapping_add(1),
                end: end as u32,
            },
        )?;
        (self.last, self.buffer) = (index, self.buffer.filter(|&own| own == buffer));
        Ok(())
    }

    /// Starts a search that has read `first_two`. Afterwards they are the two marks before `pos`.
    fn start_search(
        &mut self,
        first_two: [u32; 2],
        (buffer, offset): (BufferId, usize),
    ) -> Result<(), UErrorCode> {
        let from_text = if self.is_empty() {
            2
        } else {
            self.pos.saturating_sub(self.ahead).min(2)
        };
        // The mark that ends at the text position. Without pending marks the text may have advanced since.
        let mut read = self.ahead + from_text - 1;
        while from_text == 2
            && self
                .marks
                .get(read)
                .is_some_and(|mark| (mark.end as usize) < offset)
        {
            read += 1;
        }
        let is_cached = self.buffer == Some(buffer)
            && self
                .marks
                .get(read)
                .is_some_and(|mark| mark.end as usize == offset)
            && self.marks.len() > self.ahead;
        if from_text == 2 {
            self.ahead = if is_cached { read - 1 } else { 0 };
            if !is_cached {
                self.unblocked.clear();
            }
            (self.first, self.pos) = (self.ahead, self.ahead + 2);
        }
        if !is_cached {
            self.last = self.predecessor(self.ahead) as u32;
            self.marks.truncate(self.ahead);
            if let Some(mark) = self.marks.last_mut() {
                mark.end = offset as u32;
            }
            (self.buffer, self.is_complete) = (Some(buffer), false);
            self.indexed = self.indexed.min(self.ahead);
            first_two
                .slice(2 - from_text..)
                .iter()
                .try_for_each(|&c| self.push(c, (buffer, offset)))?;
        }
        Ok(())
    }

    fn is_unblocked(&self, mark: &Mark) -> bool {
        (get_fcd16(self.marks.at(mark.previous as usize).c) & 0xff) < get_fcd16(mark.c) >> 8
    }

    fn index_mark(&mut self, index: usize) -> Result<(), UErrorCode> {
        let mark = self.marks.at(index);
        if !self.is_unblocked(&mark) {
            return Ok(());
        }
        let found = self.unblocked.binary_search_by_key(&mark.c, |&(c, _)| c);
        if let Err(entry) = found {
            try_insert(&mut self.unblocked, entry, (mark.c, BinaryHeap::new()))?;
        }
        let (Ok(entry) | Err(entry)) = found;
        self.unblocked
            .soft_get_mut(entry)
            .map_or(Ok(()), |(_, heap)| {
                try_heap_push(heap, Reverse(index as u32))
            })
    }

    /// Unlinks the mark before `pos`, which has matched. Its successor may become unblocked, but not blocked.
    fn remove_last_read(&mut self) -> Result<(), UErrorCode> {
        let index = self.predecessor(self.pos);
        let removed = self.marks.at(index);
        self.marks.set(
            index,
            Mark {
                c: NO_CODE_POINT,
                ..removed
            },
        );
        if let Some(mark) = self.marks.soft_get_mut(removed.previous as usize) {
            mark.next = removed.next;
        }
        match self.marks.get_mut(self.pos) {
            Some(successor) => successor.previous = removed.previous,
            None => self.last = removed.previous,
        }
        self.ahead = self.ahead.max(self.pos);
        if self.pos < self.indexed {
            self.index_mark(self.pos)
        } else {
            Ok(())
        }
    }

    /// Returns the first unblocked mark after `after` that matches, or `marks.len()`. `after` never decreases.
    fn first_match(&mut self, after: usize, suffixes: &UCharsTrie) -> Result<usize, UErrorCode> {
        let matches = |c| { *suffixes }.next_for_code_point(c).has_value();
        let (mut unindexed, mut index) = (self.indexed.max(after)..self.marks.len(), after);
        // Lookups take no more steps than the tests between them.
        while self.tested < unindexed.len() + self.unblocked.len() {
            (index, self.tested) = (self.marks.at(index).next as usize, self.tested + 1);
            let Some(mark) = self.marks.get(index) else {
                return Ok(self.marks.len());
            };
            if self.is_unblocked(mark) && matches(mark.c) {
                return Ok(index);
            }
        }
        unindexed.try_for_each(|index| self.index_mark(index))?;
        (self.indexed, self.tested) = (self.marks.len(), 0);
        let (mut unblocked, mut found) = (std::mem::take(&mut self.unblocked), self.marks.len());
        unblocked.retain_mut(|&mut (c, ref mut heap)| {
            while let Some(&Reverse(index)) = heap.peek() {
                let index = index as usize;
                if index > after && self.marks.get(index).is_some_and(|mark| mark.c == c) {
                    if index < found && matches(c) {
                        found = index;
                    }
                    return true;
                }
                heap.pop();
            }
            false
        });
        self.unblocked = unblocked;
        Ok(found)
    }
}

/// Recursion limit: in damaged data a Jamo may skip a mark that has the Hangul tag.
const MAX_JAMO_DEPTH: u8 = 100;

/// Stands for the Jamo of a syllable and the result of a discontiguous contraction.
const NO_CODE_POINT: u32 = u32::MAX;

/// Returns the indexes of the L, V and T CE32s. In damaged data `c` need not be a syllable.
fn jamo_indexes(c: u32) -> Option<[usize; 3]> {
    let syllable = c.wrapping_sub(hangul::HANGUL_BASE);
    let (lv, t) = (
        syllable / hangul::JAMO_T_COUNT,
        syllable % hangul::JAMO_T_COUNT,
    );
    let (l, v) = (lv / hangul::JAMO_V_COUNT, lv % hangul::JAMO_V_COUNT);
    (l < hangul::JAMO_L_COUNT).then_some([l as usize, 19 + v as usize, T_INDEX_BASE + t as usize])
}

/// The index for a syllable without T. The T Jamo are counted from 1 and follow 19 L and 21 V.
const T_INDEX_BASE: usize = 19 + 21 - 1;

/// The result of contraction matching.
struct Contraction {
    ce32: u32,
    /// True if marks were skipped and none were pending before. Their CEs follow those of `ce32`.
    is_first_to_skip: bool,
}

impl Contraction {
    fn new(ce32: u32) -> Self {
        Self {
            ce32,
            is_first_to_skip: false,
        }
    }
}

/// Appends the CEs of one code point. State that few CE32s use is in fields, so that it is not saved for each CE32.
struct Appender<'a, 't> {
    iter: &'a mut CollationIterator<dyn Text + 't>,
    data: &'a CollationData,
    jamo_depth: u8,
    /// The number of special CE32s since text was consumed.
    steps: u32,
    /// The CE32 when `steps` was last a power of two.
    seen: u32,
}

/// Every call must pass the same data. An invalid CE32 is `U_INTERNAL_PROGRAM_ERROR`.
pub(crate) struct CollationIterator<T: Text + ?Sized> {
    ces: MaybeStack<u64, 40, 8>,
    /// Index of the CE that `next_ce` returns next.
    ces_index: usize,
    skipped: Option<Box<SkippedMarks>>,
    is_numeric: bool,
    /// Last, to allow the unsizing coercion to `dyn Text`.
    text: T,
}

impl<T: Text> CollationIterator<T> {
    #[inline(always)]
    pub(crate) fn new(is_numeric: bool, text: T) -> Self {
        let ces = MaybeStack::new();
        Self {
            text,
            ces,
            ces_index: 0,
            skipped: None,
            is_numeric,
        }
    }

    /// Returns `NO_CE` at the end of the text, and appends it.
    #[inline(always)]
    pub(crate) fn next_ce(&mut self, data: &CollationData) -> Result<u64, UErrorCode> {
        if self.ces_index < self.ces.len() {
            return Ok(self.next_fetched());
        }
        let ce = match self.text.next_ce32(data)? {
            None => collation::NO_CE,
            Some((_, ce32)) if (ce32 as u8) < collation::SPECIAL_CE32_LOW_BYTE => {
                collation::ce_from_simple_ce32(ce32)
            }
            Some((c, ce32)) => {
                let is_fallback = ce32 as u8 == collation::SPECIAL_CE32_LOW_BYTE;
                let (d, ce32) = if is_fallback {
                    data.fall_back(c)
                } else {
                    (data, ce32)
                };
                match ce32 as u8 {
                    low_byte if low_byte < collation::SPECIAL_CE32_LOW_BYTE => {
                        collation::ce_from_simple_ce32(ce32)
                    }
                    collation::LONG_PRIMARY_CE32_LOW_BYTE => {
                        collation::ce_from_long_primary_ce32(ce32)
                    }
                    _ => return self.as_dyn().next_ce_from_ce32(d, c, ce32, data),
                }
            }
        };
        self.ces.push(ce)?;
        self.ces_index += 1;
        Ok(ce)
    }

    /// The slow paths are compiled once, for `dyn Text`.
    #[inline(always)]
    fn as_dyn(&mut self) -> &mut CollationIterator<dyn Text + '_> {
        self
    }

    /// Makes the CE that `next_ce` has last returned ignorable.
    pub(crate) fn clear_current_ce(&mut self) {
        self.ces.set(self.ces_index.wrapping_sub(1), 0);
    }

    #[inline(always)]
    pub(crate) fn all_fetched(&self) -> Fetched<'_> {
        Fetched(&self.ces)
    }
}

impl<T: Text + ?Sized> CollationIterator<T> {
    #[inline(always)]
    fn next_fetched(&mut self) -> u64 {
        self.ces_index += 1;
        self.ces.pushed(self.ces_index - 1)
    }
}

impl CollationIterator<dyn Text + '_> {
    fn next_ce_from_ce32(
        &mut self,
        d: &CollationData,
        c: u32,
        mut ce32: u32,
        data: &CollationData,
    ) -> Result<u64, UErrorCode> {
        // Only damaged data give a lead surrogate a tag that reads text.
        let context_tags = collation::PREFIX_TAG..=collation::HANGUL_TAG;
        if utf16::is_lead(c) && context_tags.contains(&collation::tag_from_ce32(ce32)) {
            ce32 = collation::FALLBACK_CE32;
        }
        Appender::new(self, data, 0).append_ces_from_ce32(d, c, ce32)?;
        check_oom()?;
        Ok(self.next_fetched())
    }
}

impl<'a, 't> Appender<'a, 't> {
    fn new(
        iter: &'a mut CollationIterator<dyn Text + 't>,
        data: &'a CollationData,
        jamo_depth: u8,
    ) -> Self {
        Self {
            iter,
            data,
            jamo_depth,
            steps: 1,
            seen: 0,
        }
    }

    /// Appends the CEs of `ce32` and of the marks skipped by a top-level discontiguous contraction.
    fn append_ces_from_ce32(
        &mut self,
        mut d: &'a CollationData,
        mut c: u32,
        mut ce32: u32,
    ) -> Result<(), UErrorCode> {
        let mut has_pending_marks = false;
        loop {
            if let Some(contraction) = self.append_up_to_skipped_marks(d, c, ce32)? {
                ((d, ce32), c, has_pending_marks) = (contraction, NO_CODE_POINT, true);
            } else if has_pending_marks && let Some(mark) = self.iter.next_pending_mark() {
                (c, (d, ce32)) = (mark, self.data.look_up(mark));
            } else {
                return Ok(());
            }
            self.steps = 1;
        }
    }

    /// Brent's algorithm, for damaged data. Out of line, so that the fields are not loaded before the caller's loop.
    #[inline(never)]
    fn is_cycle(&mut self, ce32: u32) -> bool {
        self.steps += 1;
        if self.steps.is_power_of_two() {
            self.seen = ce32;
            return false;
        }
        ce32 == self.seen
    }

    /// Returns the CE32 of a top-level discontiguous contraction without appending its CEs.
    fn append_up_to_skipped_marks(
        &mut self,
        mut d: &'a CollationData,
        mut c: u32,
        mut ce32: u32,
    ) -> Result<Option<(&'a CollationData, u32)>, UErrorCode> {
        let mut is_first = true;
        let ce = loop {
            if !collation::is_special_ce32(ce32) {
                break collation::ce_from_simple_ce32(ce32);
            }
            if !std::mem::take(&mut is_first) && self.is_cycle(ce32) {
                return Err(U_INTERNAL_PROGRAM_ERROR);
            }
            let index = collation::index_from_ce32(ce32);
            // An expansion has at least one CE.
            let expansion = || index..index + collation::length_from_ce32(ce32).max(1);
            match collation::tag_from_ce32(ce32) {
                collation::LONG_PRIMARY_TAG => break collation::ce_from_long_primary_ce32(ce32),
                collation::LONG_SECONDARY_TAG => {
                    break collation::ce_from_long_secondary_ce32(ce32);
                }
                collation::LATIN_EXPANSION_TAG => {
                    self.iter.ces.add(collation::latin_ce0_from_ce32(ce32));
                    break collation::latin_ce1_from_ce32(ce32);
                }
                collation::EXPANSION32_TAG => {
                    expansion()
                        .for_each(|i| self.iter.ces.add(collation::ce_from_ce32(d.ce32s.at(i))));
                    return Ok(None);
                }
                collation::EXPANSION_TAG => {
                    expansion().for_each(|i| self.iter.ces.add(d.ces.at(i)));
                    return Ok(None);
                }
                collation::PREFIX_TAG => ce32 = self.iter.ce32_from_prefix(d, index)?,
                collation::CONTRACTION_TAG => {
                    let default = d.default_ce32(index);
                    // If true, all suffixes start with a combining mark.
                    let needs_mark = ce32 & collation::CONTRACT_NEXT_CCC != 0;
                    let may_match = !(needs_mark
                        && self.iter.skipped.is_none()
                        && self.iter.text.is_before_lccc_zero());
                    let next = if may_match {
                        self.iter.next_skipped_code_point()?
                    } else {
                        None
                    };
                    let Some(next) = next else {
                        ce32 = default;
                        continue;
                    };
                    if needs_mark && !collationfcd::may_have_lccc(next) {
                        self.iter.backward_num_skipped(1);
                        ce32 = default;
                        continue;
                    }
                    let contraction =
                        self.ce32_from_contraction(d.context_trie(index), ce32, default, next)?;
                    ce32 = contraction.ce32;
                    if contraction.is_first_to_skip {
                        return Ok(Some((d, ce32)));
                    }
                }
                collation::DIGIT_TAG if self.iter.is_numeric => {
                    return self.iter.append_numeric_ces(self.data, ce32).map(|()| None);
                }
                collation::DIGIT_TAG => ce32 = d.ce32s.at(index),
                collation::U0000_TAG => ce32 = d.ce32s.at(0),
                collation::HANGUL_TAG => {
                    let Some([l, v, t]) = jamo_indexes(c) else {
                        return Err(U_INTERNAL_PROGRAM_ERROR);
                    };
                    let [l_ce32, v_ce32, t_ce32] = [l, v, t].map(|i| d.jamo_ce32s.at(i));
                    if ce32 & collation::HANGUL_NO_SPECIAL_JAMO != 0 {
                        self.iter.ces.add(collation::ce_from_ce32(l_ce32));
                        if t == T_INDEX_BASE {
                            break collation::ce_from_ce32(v_ce32);
                        }
                        self.iter.ces.add(collation::ce_from_ce32(v_ce32));
                        break collation::ce_from_ce32(t_ce32);
                    }
                    if self.jamo_depth == MAX_JAMO_DEPTH {
                        return Err(U_INTERNAL_PROGRAM_ERROR);
                    }
                    for jamo_ce32 in [l_ce32, v_ce32] {
                        Appender::new(self.iter, self.data, self.jamo_depth + 1)
                            .append_ces_from_ce32(d, NO_CODE_POINT, jamo_ce32)?;
                    }
                    if t == T_INDEX_BASE {
                        return Ok(None);
                    }
                    // The other Jamo may have read text. This is not repeated, because `c` is no syllable now.
                    (c, ce32, self.steps) = (NO_CODE_POINT, t_ce32, 0);
                }
                collation::LEAD_SURROGATE_TAG => {
                    let trail = if utf16::is_lead(c) {
                        self.iter.text.next_trail_surrogate()
                    } else {
                        None
                    };
                    let Some(trail) = trail else {
                        ce32 = collation::UNASSIGNED_CE32;
                        continue;
                    };
                    self.steps = 0;
                    c = utf16::get_supplementary(c, trail);
                    ce32 = match ce32 & collation::LEAD_TYPE_MASK {
                        collation::LEAD_ALL_UNASSIGNED => collation::UNASSIGNED_CE32,
                        collation::LEAD_ALL_FALLBACK => collation::FALLBACK_CE32,
                        _ => d.ce32_from_supplementary(c),
                    };
                    if ce32 == collation::FALLBACK_CE32 {
                        (d, ce32) = d.fall_back(c);
                    }
                }
                collation::OFFSET_TAG => break d.ce_from_offset_ce32(c, ce32),
                collation::IMPLICIT_TAG => break collation::unassigned_ce_from_code_point(c),
                _ => return Err(U_INTERNAL_PROGRAM_ERROR),
            }
        };
        self.iter.ces.add(ce);
        Ok(None)
    }

    /// `ce32` is the default, `c` the first code point to match.
    #[inline(never)]
    fn ce32_from_contraction(
        &mut self,
        mut suffixes: UCharsTrie<'_>,
        contraction_ce32: u32,
        mut ce32: u32,
        mut c: u32,
    ) -> Result<Contraction, UErrorCode> {
        // Code points read in total, and since the last match.
        let (mut look_ahead, mut since_match) = (1, 1);
        let mut at_match = suffixes;
        loop {
            let result = suffixes.next_for_code_point(c);
            if result.has_value() {
                (ce32, self.steps) = (suffixes.get_value() as u32, 0);
            }
            match if result.has_next() {
                self.iter.next_skipped_code_point()?
            } else {
                None
            } {
                Some(next) => c = next,
                None if result.has_value() => return Ok(Contraction::new(ce32)),
                None => break,
            }
            if result.has_value() {
                (at_match, since_match) = (suffixes, 0);
            }
            since_match += 1;
            look_ahead += 1;
        }
        // UCA S2.1.1: marks are skipped only after a match in the table.
        if contraction_ce32 & collation::CONTRACT_TRAILING_CCC != 0
            && (contraction_ce32 & collation::CONTRACT_SINGLE_CP_NO_MATCH == 0
                || since_match < look_ahead)
        {
            if since_match > 1 {
                self.iter.backward_num_skipped(since_match);
                c = or_set_oom(self.iter.next_skipped_code_point()).unwrap_or(NO_CODE_POINT);
                since_match = 1;
            }
            if get_fcd16(c) > 0xff {
                return self.ce32_from_discontiguous_contraction(at_match, ce32, c);
            }
        }
        self.iter.backward_num_skipped(since_match);
        Ok(Contraction::new(ce32))
    }

    /// UCA S2.1.1 to S2.1.3. `c` is a mark that has not matched. Out of line because of its large frame.
    #[inline(never)]
    fn ce32_from_discontiguous_contraction(
        &mut self,
        mut at_match: UCharsTrie<'_>,
        mut ce32: u32,
        c: u32,
    ) -> Result<Contraction, UErrorCode> {
        let next = self.iter.next_skipped_code_point()?;
        let Some(next) = next.filter(|&next| get_fcd16(next) > 0xff) else {
            self.iter
                .backward_num_skipped(1 + usize::from(next.is_some()));
            return Ok(Contraction::new(ce32));
        };
        let is_top = self.iter.active_skipped().is_none();
        let mut skipped = self
            .iter
            .skipped
            .take()
            .map_or_else(|| try_box(SkippedMarks::default()), Ok)?;
        skipped.start_search([c, next], self.iter.text.position())?;
        let first_skipped = skipped.predecessor(skipped.predecessor(skipped.pos));
        let (mut next, mut prev_cc) = (Some(next), get_fcd16(c) & 0xff);
        if skipped.marks.len() - skipped.pos >= MIN_MARKS_FOR_LOOKUP {
            let to = skipped.first_match(first_skipped, &at_match)?;
            if to == skipped.marks.len() && skipped.is_complete {
                next = None;
            } else if to >= skipped.pos {
                let distance = to.saturating_sub(skipped.pos.max(skipped.ahead));
                skipped.pos = to;
                prev_cc = get_fcd16(skipped.marks.at(skipped.predecessor(skipped.pos)).c) & 0xff;
                self.iter.text.forward(distance);
                next = self.iter.next_mark(&mut skipped)?;
            }
        }
        while let Some(c) = next {
            let (mut suffixes, fcd16) = (at_match, get_fcd16(c));
            let result = if prev_cc < fcd16 >> 8 {
                suffixes.next_for_code_point(c)
            } else {
                NoMatch
            };
            if result.has_value() {
                (ce32, self.steps) = (suffixes.get_value() as u32, 0);
                skipped.remove_last_read()?;
                if !result.has_next() {
                    break;
                }
                at_match = suffixes;
            } else {
                prev_cc = fcd16 & 0xff;
            }
            next = self.iter.next_mark(&mut skipped)?;
        }
        let since_match = skipped.pos.saturating_sub(skipped.ahead);
        self.iter.text.backward(since_match);
        // Moving back may have normalized another segment. A search that skips this round trip would miss that.
        skipped.buffer = skipped
            .buffer
            .filter(|&buffer| buffer == self.iter.text.position().0);
        (skipped.first, skipped.pos) = (first_skipped, first_skipped);
        let is_first_to_skip = is_top && !skipped.is_empty();
        self.iter.skipped = Some(skipped);
        Ok(Contraction {
            ce32,
            is_first_to_skip,
        })
    }
}

impl CollationIterator<dyn Text + '_> {
    /// Out of line, as are the two other long arms of the caller: 2% fewer instructions to compare expansions.
    #[inline(never)]
    fn ce32_from_prefix(&mut self, d: &CollationData, index: usize) -> Result<u32, UErrorCode> {
        let (mut ce32, mut prefixes) = (d.default_ce32(index), d.context_trie(index));
        self.text.backward(1);
        let mut look_behind = 1;
        while let Some(c) = self.text.previous()? {
            look_behind += 1;
            let result = prefixes.next_for_code_point(c);
            if result.has_value() {
                ce32 = prefixes.get_value() as u32;
            }
            if !result.has_next() {
                break;
            }
        }
        self.text.forward(look_behind);
        Ok(ce32)
    }

    fn active_skipped(&mut self) -> Option<&mut SkippedMarks> {
        self.skipped
            .as_deref_mut()
            .filter(|skipped| !skipped.is_empty())
    }

    /// Returns `None` and clears the pending marks after the last mark.
    fn next_pending_mark(&mut self) -> Option<u32> {
        let skipped = self.skipped.as_deref_mut().soft_some()?;
        let mark = skipped.next();
        if mark.is_none() {
            skipped.clear();
        }
        mark
    }

    /// Reads from the pending marks, then from the text.
    fn next_skipped_code_point(&mut self) -> Result<Option<u32>, UErrorCode> {
        if let Some(c) = self.skipped.as_deref_mut().and_then(SkippedMarks::next) {
            return Ok(Some(c));
        }
        let c = self.text.next()?;
        if c.is_some()
            && let Some(skipped) = self.active_skipped()
        {
            skipped.pos += 1;
        }
        Ok(c)
    }

    fn backward_num_skipped(&mut self, mut n: usize) {
        if let Some(skipped) = self.active_skipped() {
            n = skipped.backward(n);
        }
        self.text.backward(n);
    }

    /// Returns `None` at the end of the run.
    fn next_mark(&mut self, skipped: &mut SkippedMarks) -> Result<Option<u32>, UErrorCode> {
        if let Some(c) = skipped.next() {
            return Ok(Some(c));
        }
        let c = self.text.next()?;
        skipped.pos += usize::from(c.is_some());
        let mark = c.filter(|&c| get_fcd16(c) > 0xff);
        match mark {
            Some(c) if skipped.pos > skipped.marks.len() => {
                skipped.push(c, self.text.position())?
            }
            Some(_) => {}
            None => skipped.is_complete = true,
        }
        Ok(mark)
    }

    /// Appends the CEs of the digit sequence that starts with the digit of `ce32`.
    #[inline(never)]
    fn append_numeric_ces(&mut self, data: &CollationData, ce32: u32) -> Result<(), UErrorCode> {
        let mut digits = MaybeStack::<u8, 40>::new();
        digits.push(collation::digit_from_ce32(ce32))?;
        while let Some(c) = self.text.next()? {
            let ce32 = data.look_up(c).1;
            if !collation::has_ce32_tag(ce32, collation::DIGIT_TAG) {
                self.text.backward(1);
                break;
            }
            digits.push(collation::digit_from_ce32(ce32))?;
        }
        let mut rest: &[u8] = &digits;
        while let [leading @ .., _] = rest {
            let zeros = leading.iter().take_while(|&&digit| digit == 0).count();
            let segment;
            rest = rest.slice(zeros..);
            (segment, rest) = rest.split_at(rest.len().min(254));
            self.append_numeric_segment_ces(segment, data.numeric_primary);
        }
        Ok(())
    }

    /// Takes 1 to 254 digits. The second byte of the weight is 132..255 for 4..127 digit pairs, and less for small numbers.
    fn append_numeric_segment_ces(&mut self, digits: &[u8], numeric_primary: u32) {
        let value_of = |digits: &[u8]| {
            digits
                .iter()
                .fold(0, |value, &digit| value * 10 + u32::from(digit))
        };
        if digits.len() <= 7 {
            let mut value = value_of(digits);
            if value < 74 {
                return self
                    .ces
                    .add(collation::make_ce(numeric_primary | (2 + value) << 16));
            }
            value -= 74;
            if value < 40 * 254 {
                let bytes = (76 + value / 254) << 16 | (2 + value % 254) << 8;
                return self.ces.add(collation::make_ce(numeric_primary | bytes));
            }
            value -= 40 * 254;
            if value < 16 * 254 * 254 {
                let bytes = (116 + value / 254 / 254) << 16
                    | (2 + value / 254 % 254) << 8
                    | (2 + value % 254);
                return self.ces.add(collation::make_ce(numeric_primary | bytes));
            }
        }
        let mut primary = numeric_primary | (132 - 4 + digits.len().div_ceil(2) as u32) << 16;
        let mut digits = digits;
        while let [before @ .., 0, 0] = digits {
            digits = before;
        }
        // The first pair may be a single digit. The byte of the last pair is decremented.
        let mut pairs = digits
            .rchunks(2)
            .rev()
            .map(|pair| 11 + 2 * value_of(pair))
            .peekable();
        let mut shift = 8;
        while let Some(pair) = pairs.next() {
            let is_last = pairs.peek().is_none();
            primary |= (pair - u32::from(is_last)) << shift;
            if shift == 0 || is_last {
                self.ces.add(collation::make_ce(primary));
                (primary, shift) = (numeric_primary, 24);
            }
            shift -= 8;
        }
    }
}
