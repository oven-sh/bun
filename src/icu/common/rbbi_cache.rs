//! The caches of the rule-based break iterator. Results depend on their contents. ICU4C: rbbi_cache.cpp

use crate::common::brkeng;
use crate::common::memory::{
    Appendable as _, best_effort, defer_oom, is_oom, try_box_uninit, try_insert, try_push,
};
use crate::common::rbbi::Segment;
use crate::common::rbbidata::RBBIData;
use crate::common::slice_ext::{SliceExt, to_index};
use crate::common::utf16;
use crate::common::utypes::UErrorCode;
use std::hint::select_unpredictable;

/// A position and its rule status index.
type Boundary = (i32, u8);

/// The boundaries that the engines found in one rule-based segment. `BreakCache` fetches them one at a time.
#[derive(Default)]
pub(crate) struct DictionaryCache {
    /// Empty, or increasing from the start to the end of the segment.
    breaks: Vec<i32>,
    /// Index in `breaks` of the boundary that was returned last.
    position_in_cache: Option<usize>,
    first_rule_status_index: u8,
    other_rule_status_index: u8,
}

impl DictionaryCache {
    pub(crate) fn reset(&mut self) {
        self.breaks.clear();
    }

    /// Returns the index of `from_pos` in `breaks` if it is the boundary that was returned last.
    fn sequential_index(&self, from_pos: i32) -> Option<usize> {
        self.position_in_cache
            .filter(|&position| self.breaks.get(position) == Some(&from_pos))
    }

    /// Returns `None` unless `start <= from_pos < limit`.
    fn following(&mut self, from_pos: i32) -> Option<Boundary> {
        let sequential = self.sequential_index(from_pos);
        self.position_in_cache = None;
        let [start, .., limit] = *self.breaks else {
            return None;
        };
        if from_pos >= limit || from_pos < start {
            return None;
        }
        let position = match sequential {
            Some(position) => position + 1,
            None => self.breaks.partition_point(|&r| r <= from_pos),
        };
        self.position_in_cache = Some(position);
        Some((self.breaks.at(position), self.other_rule_status_index))
    }

    /// Returns `None` unless `start < from_pos <= limit`.
    fn preceding(&mut self, from_pos: i32) -> Option<Boundary> {
        let (sequential, was_at_start) = (
            self.sequential_index(from_pos),
            self.position_in_cache == Some(0),
        );
        self.position_in_cache = None;
        let [start, .., limit] = *self.breaks else {
            return None;
        };
        if from_pos <= start || from_pos > limit {
            return None;
        }
        let position = match sequential {
            _ if from_pos == limit => self.breaks.len() - 2,
            // Fails once at the start of the cache.
            _ if was_at_start => return None,
            Some(position) => position - 1,
            None => self.breaks.partition_point(|&r| r < from_pos) - 1,
        };
        self.position_in_cache = Some(position);
        let status_index = if position == 0 {
            self.first_rule_status_index
        } else {
            self.other_rule_status_index
        };
        Some((self.breaks.at(position), status_index))
    }
}

/// What `BreakCache` calls to find boundaries.
pub(crate) struct Segmenter {
    pub(crate) data: RBBIData,
    pub(crate) dictionary_cache: DictionaryCache,
    /// `BreakCache` takes the flag and discards its contents.
    alloc_failed_in_segment: bool,
}

impl Segmenter {
    pub(crate) fn new(data: &RBBIData) -> Self {
        Self {
            data: *data,
            dictionary_cache: DictionaryCache::default(),
            alloc_failed_in_segment: false,
        }
    }

    /// Leaves the segment undivided if any allocation has failed in this call.
    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // The flag stays set.
    fn populate_dictionary(&mut self, text: &[u16], (start, status): Boundary, segment: Segment) {
        if segment.end - start <= 1 {
            return;
        }
        let cache = &mut self.dictionary_cache;
        cache.reset();
        cache.first_rule_status_index = status;
        cache.other_rule_status_index = segment.rule_status_index;

        let (mut current, end) = (to_index(start), to_index(segment.end));
        while current < end {
            let mut next = current;
            let category = self.data.trie.get(utf16::next(text, &mut next));
            if u32::from(category) >= self.data.forward_table.dict_categories_start {
                match brkeng::find_breaks(text, current..end, &mut cache.breaks) {
                    Ok(run_end) => next = run_end,
                    Err(_) => break,
                }
            }
            current = next;
        }
        if !cache.breaks.is_empty() {
            let _ = defer_oom(try_insert(&mut cache.breaks, 0, start));
            cache.breaks.add(segment.end);
            cache.position_in_cache = Some(0);
        }
        if is_oom() {
            cache.reset();
            self.alloc_failed_in_segment = true;
        }
    }
}

const CACHE_SIZE: usize = 128;

#[inline(always)]
fn mod_chunk_size(index: usize) -> usize {
    index & (CACHE_SIZE - 1)
}

/// A ring buffer of the boundaries around the iterator position.
pub(crate) struct BreakCache {
    start_buf_idx: usize,
    /// Index of the last boundary (inclusive).
    end_buf_idx: usize,
    /// The iterator position, a boundary.
    text_idx: i32,
    /// Index of `text_idx` in the ring.
    buf_idx: usize,
    boundaries: [i32; CACHE_SIZE],
    statuses: [u8; CACHE_SIZE],
    checkpoints: Checkpoints,
}

/// Where `populate_preceding` resumes a forward run from `start` through text without a safe point (a run of flags).
#[derive(Default)]
struct Checkpoints {
    start: Boundary,
    /// At least `CACHE_SIZE` boundaries apart, and before any dictionary character.
    points: Vec<Boundary>,
}

impl Checkpoints {
    /// Returns a checkpoint with at least `CACHE_SIZE` boundaries between it and `limit`, otherwise `start`.
    fn resume_point(&mut self, start: Boundary, limit: i32) -> Boundary {
        if start != self.start {
            self.start = start;
            self.points.clear();
        }
        let before = self.points.partition_point(|point| point.0 < limit);
        before
            .checked_sub(2)
            .and_then(|index| self.points.get(index))
            .copied()
            .unwrap_or(start)
    }

    #[cfg_attr(mordant, allow(error_collapsed_to_bool))] // A missing checkpoint only costs time.
    fn add(&mut self, point: Boundary) {
        if self.points.last().is_none_or(|last| last.0 < point.0) {
            let _ = best_effort(|| try_push(&mut self.points, point));
        }
    }
}

/// The last `CACHE_SIZE` boundaries of a forward run.
struct SideBuffer {
    positions: [i32; CACHE_SIZE],
    statuses: [u8; CACHE_SIZE],
    pushed: usize,
}

impl SideBuffer {
    fn new() -> Self {
        Self {
            positions: [0; CACHE_SIZE],
            statuses: [0; CACHE_SIZE],
            pushed: 0,
        }
    }

    fn push(&mut self, position: i32, rule_status_idx: u8) {
        let index = mod_chunk_size(self.pushed);
        self.positions.set(index, position);
        self.statuses.set(index, rule_status_idx);
        self.pushed += 1;
    }

    fn last_to_first(&self) -> impl Iterator<Item = Boundary> {
        (self.pushed.saturating_sub(CACHE_SIZE)..self.pushed)
            .rev()
            .map(mod_chunk_size)
            .map(|index| (self.positions.at(index), self.statuses.at(index)))
    }
}

impl BreakCache {
    pub(crate) fn new() -> Self {
        Self {
            start_buf_idx: 0,
            end_buf_idx: 0,
            text_idx: 0,
            buf_idx: 0,
            boundaries: [0; CACHE_SIZE],
            statuses: [0; CACHE_SIZE],
            checkpoints: Checkpoints::default(),
        }
    }

    pub(crate) fn set_text(&mut self) {
        self.reset(0, 0);
        self.checkpoints = Checkpoints::default();
    }

    /// Returns a cache that holds only the current boundary.
    pub(crate) fn clone_at_position(&self) -> Result<Box<Self>, UErrorCode> {
        let mut clone = Box::write(try_box_uninit()?, Self::new());
        clone.reset(self.text_idx, self.rule_status_index());
        Ok(clone)
    }

    #[inline(always)]
    fn boundary(&self, index: usize) -> i32 {
        self.boundaries.at(mod_chunk_size(index))
    }

    #[inline(always)]
    fn status(&self, index: usize) -> u8 {
        self.statuses.at(mod_chunk_size(index))
    }

    #[inline(always)]
    fn set(&mut self, index: usize, position: i32, rule_status_idx: u8) {
        self.boundaries.set(mod_chunk_size(index), position);
        self.statuses.set(mod_chunk_size(index), rule_status_idx);
    }

    /// Makes the boundary at `index` the iterator position, and returns it.
    #[inline]
    fn move_to(&mut self, index: usize) -> i32 {
        self.buf_idx = mod_chunk_size(index);
        self.text_idx = self.boundary(index);
        self.text_idx
    }

    fn reset(&mut self, pos: i32, rule_status: u8) {
        self.start_buf_idx = 0;
        self.end_buf_idx = 0;
        self.text_idx = pos;
        self.buf_idx = 0;
        self.set(0, pos, rule_status);
    }

    /// Moves to `pos` or to the preceding boundary. Returns false if `pos` is outside the cached range.
    fn seek(&mut self, pos: i32) -> bool {
        if pos < self.first_boundary() || pos > self.last_boundary() {
            return false;
        }
        if pos == self.first_boundary() {
            (self.buf_idx, self.text_idx) = (self.start_buf_idx, pos);
            return true;
        }
        if pos == self.last_boundary() {
            (self.buf_idx, self.text_idx) = (self.end_buf_idx, pos);
            return true;
        }

        // A branch would be mispredicted for random positions.
        let mut min = self.start_buf_idx;
        let mut max = min + mod_chunk_size(self.end_buf_idx.wrapping_sub(min));
        while min != max {
            let probe = (min + max) / 2;
            (min, max) =
                select_unpredictable(self.boundary(probe) > pos, (min, probe), (probe + 1, max));
        }
        self.move_to(max.wrapping_sub(1));
        true
    }

    fn add_following(&mut self, position: i32, rule_status_idx: u8) {
        let next_idx = mod_chunk_size(self.end_buf_idx + 1);
        if next_idx == self.start_buf_idx {
            self.start_buf_idx = mod_chunk_size(self.start_buf_idx + 6);
        }
        self.set(next_idx, position, rule_status_idx);
        self.end_buf_idx = next_idx;
    }

    fn add_preceding(&mut self, position: i32, rule_status_idx: u8) {
        let next_idx = mod_chunk_size(self.start_buf_idx.wrapping_sub(1));
        if next_idx == self.end_buf_idx {
            self.end_buf_idx = mod_chunk_size(self.end_buf_idx.wrapping_sub(1));
        }
        self.set(next_idx, position, rule_status_idx);
        self.start_buf_idx = next_idx;
    }

    pub(crate) fn position(&self) -> i32 {
        self.text_idx
    }

    pub(crate) fn rule_status_index(&self) -> u8 {
        self.status(self.buf_idx)
    }

    /// Returns the new position, or `None` at the end of the text.
    #[inline(always)]
    pub(crate) fn next(&mut self, segmenter: &mut Segmenter, text: &[u16]) -> Option<i32> {
        if self.buf_idx == self.end_buf_idx {
            return self.next_ol(segmenter, text);
        }
        Some(self.move_to(self.buf_idx + 1))
    }

    pub(crate) fn following(
        &mut self,
        segmenter: &mut Segmenter,
        text: &[u16],
        start_pos: i32,
    ) -> Option<i32> {
        if start_pos != self.text_idx {
            self.seek_or_populate(segmenter, text, start_pos);
        }
        self.next(segmenter, text)
    }

    #[inline(never)]
    fn next_ol(&mut self, segmenter: &mut Segmenter, text: &[u16]) -> Option<i32> {
        let has_moved = self.populate_following(segmenter, text);
        self.discard_after_alloc_failure(segmenter);
        has_moved.then_some(self.text_idx)
    }

    /// Returns the new position, or `None` at the start of the text.
    #[inline]
    pub(crate) fn previous(&mut self, segmenter: &mut Segmenter, text: &[u16]) -> Option<i32> {
        if self.buf_idx == self.start_buf_idx {
            return self.previous_ol(segmenter, text);
        }
        Some(self.move_to(self.buf_idx.wrapping_sub(1)))
    }

    #[inline(never)]
    fn previous_ol(&mut self, segmenter: &mut Segmenter, text: &[u16]) -> Option<i32> {
        let has_moved = self.populate_preceding(segmenter, text);
        self.discard_after_alloc_failure(segmenter);
        has_moved.then_some(self.text_idx)
    }

    fn first_boundary(&self) -> i32 {
        self.boundary(self.start_buf_idx)
    }

    fn last_boundary(&self) -> i32 {
        self.boundary(self.end_buf_idx)
    }

    /// Drops all boundaries except the current one if the ring holds a segment left undivided by an allocation failure.
    fn discard_after_alloc_failure(&mut self, segmenter: &mut Segmenter) {
        if std::mem::take(&mut segmenter.alloc_failed_in_segment) {
            self.reset(self.text_idx, self.rule_status_index());
        }
    }

    /// Moves to `position`, which is not negative, or to the preceding boundary.
    #[inline]
    pub(crate) fn seek_or_populate(
        &mut self,
        segmenter: &mut Segmenter,
        text: &[u16],
        position: i32,
    ) {
        if !self.seek(position) {
            self.populate_near(segmenter, text, position);
        }
    }

    #[inline(never)]
    fn populate_near(&mut self, segmenter: &mut Segmenter, text: &[u16], position: i32) {
        if let Some((start, rule_status)) =
            self.find_reset_boundary(&segmenter.data, text, position)
        {
            self.reset(start, rule_status);
        }
        self.extend_to(segmenter, text, position);
        self.discard_after_alloc_failure(segmenter);
    }

    /// Returns the boundary near `position` to which the cache is reset, or `None` to keep the cache.
    fn find_reset_boundary(
        &self,
        data: &RBBIData,
        text: &[u16],
        position: i32,
    ) -> Option<Boundary> {
        const CACHE_NEAR: i32 = 15;
        let (first, last) = (self.first_boundary(), self.last_boundary());
        if position > first - CACHE_NEAR && position < last.wrapping_add(CACHE_NEAR) {
            return None;
        }
        if position <= CACHE_NEAR {
            return Some((0, 0));
        }
        let backup_pos = data.handle_safe_previous(text, position);
        if last < position && last >= backup_pos - CACHE_NEAR {
            return None;
        }
        if backup_pos < CACHE_NEAR {
            return (first > position.wrapping_add(CACHE_NEAR)).then_some((0, 0));
        }
        let segment = data.handle_next_from_safe_point(text, backup_pos, None);
        Some(segment.map_or((text.len() as i32, 0), |(_, it)| {
            (it.end, it.rule_status_index)
        }))
    }

    fn extend_to(&mut self, segmenter: &mut Segmenter, text: &[u16], position: i32) {
        if self.last_boundary() < position {
            while self.last_boundary() < position && self.populate_following(segmenter, text) {}
            self.move_to(self.end_buf_idx);
            while self.text_idx > position {
                self.previous(segmenter, text);
            }
        } else if self.first_boundary() > position {
            while self.first_boundary() > position {
                self.populate_preceding(segmenter, text);
            }
            self.move_to(self.start_buf_idx);
            while self.text_idx < position && self.next(segmenter, text).is_some() {}
            if self.text_idx > position {
                self.previous(segmenter, text);
            }
        }
    }

    /// Adds boundaries after the last one and moves to the first new one. Returns false at the end of the text.
    fn populate_following(&mut self, segmenter: &mut Segmenter, text: &[u16]) -> bool {
        let from_position = self.last_boundary();
        if let Some((pos, rule_status_idx)) = segmenter.dictionary_cache.following(from_position) {
            self.add_following(pos, rule_status_idx);
            self.move_to(self.end_buf_idx);
            return true;
        }

        let Some(segment) = segmenter.data.handle_next(text, from_position) else {
            return false;
        };
        if segment.has_dictionary_characters {
            let from = (from_position, self.status(self.end_buf_idx));
            segmenter.populate_dictionary(text, from, segment);
            if let Some((pos, rule_status_idx)) =
                segmenter.dictionary_cache.following(from_position)
            {
                self.add_following(pos, rule_status_idx);
                self.move_to(self.end_buf_idx);
                return true;
            }
        }
        self.add_following(segment.end, segment.rule_status_index);
        self.move_to(self.end_buf_idx);

        // More boundaries, for the fast path of `next`.
        for _ in 0..6 {
            match segmenter.data.handle_next(text, self.last_boundary()) {
                Some(segment) if !segment.has_dictionary_characters => {
                    self.add_following(segment.end, segment.rule_status_index);
                }
                _ => break,
            }
        }
        true
    }

    /// Adds boundaries before the first one and moves to the last new one. Returns false at the start of the text.
    fn populate_preceding(&mut self, segmenter: &mut Segmenter, text: &[u16]) -> bool {
        let from_position = self.first_boundary();
        if from_position <= 0 {
            return false;
        }
        if let Some((position, position_status_idx)) =
            segmenter.dictionary_cache.preceding(from_position)
        {
            self.add_preceding(position, position_status_idx);
            self.move_to(self.start_buf_idx);
            return true;
        }

        let start = boundary_before(&segmenter.data, text, from_position);
        let (mut position, mut position_status_idx) =
            self.checkpoints.resume_point(start, from_position);
        // Up to the first segment that has dictionary characters, `pushed` counts the segments.
        let mut is_plain = true;
        let mut side_buffer = SideBuffer::new();
        side_buffer.push(position, position_status_idx);
        while position < from_position {
            let (mut prev_position, prev_status_idx) = (position, position_status_idx);
            let Some(segment) = segmenter.data.handle_next(text, position) else {
                break;
            };
            (position, position_status_idx) = (segment.end, segment.rule_status_index);
            is_plain &= !segment.has_dictionary_characters;
            if is_plain && side_buffer.pushed.is_multiple_of(CACHE_SIZE) {
                self.checkpoints.add((position, position_status_idx));
            }

            let mut segment_handled_by_dictionary = false;
            if segment.has_dictionary_characters {
                segmenter.populate_dictionary(text, (prev_position, prev_status_idx), segment);
                while let Some(following) = segmenter.dictionary_cache.following(prev_position) {
                    (position, position_status_idx) = following;
                    segment_handled_by_dictionary = true;
                    if position >= from_position {
                        break;
                    }
                    side_buffer.push(position, position_status_idx);
                    prev_position = position;
                }
            }
            if !segment_handled_by_dictionary && position < from_position {
                side_buffer.push(position, position_status_idx);
            }
        }

        let last_new_idx = self.start_buf_idx.wrapping_sub(1);
        for (position, position_status_idx) in side_buffer.last_to_first() {
            self.add_preceding(position, position_status_idx);
        }
        self.move_to(last_new_idx);
        true
    }
}

// ICU4C: rbbi_cache.cpp, BreakCache::populatePreceding
fn boundary_before(data: &RBBIData, text: &[u16], limit: i32) -> Boundary {
    let (mut backup_position, mut rounds, mut later) = (limit, 0, None);
    while backup_position > 30 {
        backup_position = data.handle_safe_previous(text, backup_position - 30);
        if backup_position == 0 {
            break;
        }
        let Some((start, segment)) = data.handle_next_from_safe_point(text, backup_position, later)
        else {
            break;
        };
        if segment.end < limit {
            return (segment.end, segment.rule_status_index);
        }
        // In a long segment a match stops as soon as it is in the state of the match of the previous round.
        rounds += 1;
        later = (rounds >= 32).then_some((start, segment));
    }
    (0, 0)
}
