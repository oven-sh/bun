//! Finds long matches at any distance, ahead of the regular search.

use core::hint::{black_box, cold_path};

use bun_zstd_decoder::array::At;
use bun_zstd_decoder::{Result, XxHash64};

use super::gear_table::GEAR_TABLE;
use super::{MatchState, Search, WORD, prefetch};
use crate::bytes::common_suffix;
use crate::parameters::{LongDistance, Strategy};
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::vec;
use crate::window::{FIRST_INDEX, History, Input, Window};

const BATCH_LEN: usize = 64;

#[derive(Clone, Copy)]
struct Candidate {
    offset: u32,
    literal_len: u32,
    match_len: u32,
}

impl Candidate {
    fn len(self) -> u32 {
        self.literal_len + self.match_len
    }
}

#[derive(Clone, Copy, Default)]
struct Position {
    index: usize,
    /// How many bytes of that candidate were passed.
    passed: u32,
}

impl Position {
    fn advance(&mut self, list: &[Candidate], len: u32) {
        let mut passed = self.passed + len;
        while let Some(candidate) = list.get(self.index) {
            if passed < candidate.len() {
                self.passed = passed;
                return;
            }
            passed -= candidate.len();
            self.index += 1;
            if passed == 0 {
                break;
            }
        }
        self.passed = 0;
    }
}

/// Matches that do not overlap, in order.
#[derive(Default)]
pub(crate) struct Candidates {
    list: Vec<Candidate>,
    limit: usize,
    position: Position,
}

impl Candidates {
    /// Makes room for those of `len` bytes.
    pub(crate) fn clear_for(&mut self, len: usize, parameters: &LongDistance) -> Result<()> {
        self.limit = len / parameters.min_match as usize;
        self.position = Position::default();
        vec::clear_for(&mut self.list, self.limit)
    }

    pub(crate) fn clear(&mut self) {
        self.list.clear();
        self.position = Position::default();
    }

    pub(crate) fn are_used_up(&self) -> bool {
        self.position.index >= self.list.len()
    }

    /// The next one, as far as it is within `left` bytes. The parts of a match have to have `min_match` bytes.
    fn take(&mut self, left: u32, min_match: u32) -> Option<Candidate> {
        let (next, rest) = self
            .list
            .get_mut(self.position.index..)?
            .split_first_mut()?;
        let whole = *next;
        if left >= whole.len() {
            self.position.index += 1;
            return Some(whole);
        }
        next.literal_len = whole.literal_len.saturating_sub(left);
        let match_len = left.checked_sub(whole.literal_len).filter(|&len| len > 0)?;
        next.match_len -= match_len;
        if next.match_len < min_match {
            if let Some(after) = rest.first_mut() {
                after.literal_len += next.match_len;
            }
            self.position.index += 1;
        }
        (match_len >= min_match).then_some(Candidate { match_len, ..whole })
    }

    /// Like [`MatchState::search`], which gets to search between the candidates.
    pub(crate) fn search(
        &mut self,
        state: &mut MatchState,
        search: &Search<'_>,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
    ) -> u32 {
        let history = &search.history;
        let end = history.end();
        if state.tuning.strategy >= Strategy::Optimal {
            let long_matches = Some(&*self);
            let search = Search {
                long_matches,
                ..*search
            };
            let anchor = state.search(&search, sequences, repeats);
            self.position
                .advance(&self.list, history.block().len() as u32);
            return anchor;
        }

        let part = |start, end| Search {
            history: history.part(start, end),
            ..*search
        };
        let mut at = history.start;
        while at < end
            && let Some(candidate) = self.take(end - at, state.tuning.min_match)
        {
            state.index_up_to(history, at);
            let start = at + candidate.literal_len;
            let anchor = state.search(&part(at, start), sequences, repeats);
            let offset = OffsetValue::new(candidate.offset);
            *repeats = repeats.after(offset, true);
            sequences.push(start - anchor, offset, candidate.match_len);
            at = start + candidate.match_len;
        }
        state.index_up_to(history, at);
        state.search(&part(at, end), sequences, repeats)
    }
}

/// Offers the candidates for a block position by position.
pub(super) struct Cursor<'a> {
    list: &'a [Candidate],
    position: Position,
    start: u32,
    end: u32,
    offset: u32,
}

impl<'a> Cursor<'a> {
    pub(super) fn new(candidates: Option<&'a Candidates>, block_len: usize) -> Self {
        let mut cursor = Self {
            list: candidates.map(|it| &*it.list).unwrap_or_default(),
            position: candidates.map(|it| it.position).unwrap_or_default(),
            start: 0,
            end: 0,
            offset: 0,
        };
        cursor.load(0, block_len as u32);
        cursor
    }

    fn load(&mut self, at: u32, left: u32) {
        (self.start, self.end) = (u32::MAX, u32::MAX);
        let Some(candidate) = self.list.get(self.position.index) else {
            return;
        };
        let passed = self.position.passed;
        let literals_left = candidate.literal_len.saturating_sub(passed);
        let len = left.min(candidate.len() - passed);
        if literals_left < left {
            (self.start, self.end) = (at + literals_left, at + len);
            self.offset = candidate.offset;
        }
        self.position.advance(self.list, len);
    }

    /// The offset and the length of the match at `at` of the block, of which `left` bytes are left.
    #[inline(always)]
    pub(super) fn at(&mut self, at: u32, left: u32) -> Option<(u32, u32)> {
        if self.position.index >= self.list.len() {
            return None;
        }
        if at >= self.end {
            if at > self.end {
                self.position.advance(self.list, at - self.end);
            }
            self.load(at, left);
        }
        (self.start..self.end)
            .contains(&at)
            .then(|| (self.offset, self.end - at))
    }
}

#[derive(Clone, Copy, Default)]
struct Split {
    start: u32,
    bucket: usize,
    checksum: u32,
}

/// Picks the positions to index by their content.
#[derive(Clone, Copy)]
struct GearHash {
    state: u64,
    mask: u64,
}

impl GearHash {
    fn new(parameters: &LongDistance) -> Self {
        // The higher a bit, the more bytes it depends on.
        let shift = parameters
            .min_match
            .min(64)
            .saturating_sub(parameters.hash_rate_log);
        Self {
            state: u64::from(u32::MAX),
            mask: ((1u64 << parameters.hash_rate_log) - 1).unbounded_shl(shift),
        }
    }

    #[inline(always)]
    fn splits_after(&mut self, value: u64) -> bool {
        self.state = (self.state << 1).wrapping_add(value);
        self.state & self.mask == 0
    }

    /// After how many of `bytes` it splits first.
    #[inline(always)]
    fn next_split(&mut self, bytes: &[u8]) -> Option<usize> {
        // Keeps its address in a register.
        let table = black_box(&GEAR_TABLE);
        let value = |byte: u8| *table.at(usize::from(byte));
        let (groups, rest) = bytes.as_chunks::<4>();
        for (index, group) in groups.iter().enumerate() {
            let values = group.each_ref().map(|&byte| value(byte));
            // With the values in registers, shifting and adding is one instruction.
            black_box(());
            for (more, value) in values.into_iter().enumerate() {
                if self.splits_after(value) {
                    cold_path();
                    return Some(index * group.len() + more + 1);
                }
            }
        }
        let more = rest.iter().position(|&it| self.splits_after(value(it)))?;
        Some(bytes.len() - rest.len() + more + 1)
    }

    /// Returns how many bytes it took, and after how many of them it split, until `ends` was full.
    #[inline(never)]
    fn feed(&mut self, bytes: &[u8], ends: &mut [u32; BATCH_LEN]) -> (u32, usize) {
        let (mut hash, mut fed, mut count) = (*self, 0, 0);
        for end in ends {
            let Some(more) = hash.next_split(bytes.get(fed..).unwrap_or_default()) else {
                fed = bytes.len();
                break;
            };
            fed += more;
            *end = fed as u32;
            count += 1;
        }
        *self = hash;
        (fed as u32, count)
    }
}

pub(crate) struct Finder {
    parameters: LongDistance,
    window_log: u32,
    window: Window,
    /// Indices and checksums.
    entries: Vec<[u32; 2]>,
    /// For each bucket of entries, which one is replaced next.
    oldest: Vec<u8>,
}

impl Finder {
    pub(crate) fn new(parameters: LongDistance, window_log: u32) -> Result<Self> {
        Ok(Self {
            parameters,
            window_log,
            window: Window::starting_at(FIRST_INDEX),
            entries: vec::zeroed(1 << parameters.hash_log)?,
            oldest: vec::zeroed(1 << (parameters.hash_log - parameters.bucket_log))?,
        })
    }

    pub(crate) fn admit(&mut self, input: &Input<'_>) {
        self.window.admit(input);
    }

    fn make_room_for(&mut self, len: usize) {
        if self.window.would_overflow(len) {
            let by = self.window.lower_indices(0, self.window_log);
            for [index, _] in &mut self.entries {
                *index = index.saturating_sub(by);
            }
        }
    }

    pub(crate) fn skip(&mut self, len: usize) {
        self.make_room_for(len);
        self.window.next += len as u32;
    }

    /// For the `len` bytes at `start` of the segment, which are next, unless it `is_abandoned` on the way.
    pub(crate) fn find(
        &mut self,
        input: &Input<'_>,
        start: usize,
        len: usize,
        candidates: &mut Candidates,
        is_abandoned: impl Fn() -> bool,
    ) {
        const CHUNK_LEN: usize = 1 << 20;
        let mut unmatched = 0;
        let chunks = (start..start + len).step_by(CHUNK_LEN);
        for chunk_start in chunks.take_while(|_| !is_abandoned()) {
            let chunk_len = CHUNK_LEN.min(start + len - chunk_start);
            self.make_room_for(chunk_len);
            // An offset has to be valid up to the end of its match, which may be split.
            let chunk_end = self.window.next + chunk_len as u32;
            let lowest = chunk_end.saturating_sub(1 << self.window_log);
            self.window.raise_start(lowest.min(self.window.next));
            let lowest = lowest.max(self.window.older_start);

            let first = candidates.list.len();
            if first < candidates.limit {
                let history = self.window.history(input, chunk_start, chunk_len);
                let left = self.find_in(&history, lowest, candidates);
                match candidates.list.get_mut(first) {
                    Some(first) => {
                        first.literal_len += unmatched;
                        unmatched = left;
                    }
                    None => unmatched += left,
                }
            }
            self.window.next = chunk_end;
            self.window.raise_start(lowest);
        }
    }

    fn insert(&mut self, bucket: usize, entry: [u32; 2]) {
        let bucket_log = self.parameters.bucket_log;
        if let Some(oldest) = self.oldest.get_mut(bucket)
            && let Some(slot) = self
                .entries
                .get_mut((bucket << bucket_log) + usize::from(*oldest))
        {
            *slot = entry;
            *oldest = ((u32::from(*oldest) + 1) & ((1 << bucket_log) - 1)) as u8;
        }
    }

    /// The index of the longest match, and its lengths before and from `split`.
    fn best_match(
        &self,
        history: &History<'_>,
        lowest: u32,
        anchor: u32,
        split: Split,
    ) -> Option<(u32, u32, u32)> {
        let bucket_log = self.parameters.bucket_log;
        let bucket = split.bucket << bucket_log..(split.bucket + 1) << bucket_log;
        let mut best = None;
        let mut best_len = 0;
        for &[index, checksum] in self.entries.get(bucket)? {
            if checksum != split.checksum {
                continue;
            }
            cold_path();
            if index <= lowest {
                continue;
            }
            let after = history.match_len_at_index(split.start, index, 0);
            if after < self.parameters.min_match {
                continue;
            }
            let max = (split.start - anchor).min(index - lowest);
            let mut before = history.match_len_before_index(split.start, index, max);
            if index - before == history.prefix_index {
                let unmatched = anchor as usize..(split.start - before) as usize;
                before += common_suffix(history.prefix.get(unmatched)?, history.older) as u32;
            }
            if before + after > best_len {
                best_len = before + after;
                best = Some((index, before, after));
            }
        }
        best
    }

    /// Returns how many bytes follow the last match.
    fn find_in(&mut self, history: &History<'_>, lowest: u32, candidates: &mut Candidates) -> u32 {
        let min_match = self.parameters.min_match;
        let bucket_mask = self.oldest.len() - 1;
        let bytes = |start: u32, end: u32| history.prefix.get(start as usize..end as usize);
        let limit = history.end().saturating_sub(WORD);
        let mut hash = GearHash::new(&self.parameters);
        let (mut ends, mut splits) = ([0; BATCH_LEN], [Split::default(); BATCH_LEN]);
        let mut anchor = history.start;
        let mut at = anchor + min_match;

        while at < limit {
            let (fed, count) = hash.feed(bytes(at, limit).unwrap_or_default(), &mut ends);
            for (split, end) in splits.iter_mut().zip(ends).take(count) {
                let end = at + end;
                let hash = XxHash64::hash(bytes(end - min_match, end).unwrap_or_default());
                *split = Split {
                    start: end - min_match,
                    bucket: hash as usize & bucket_mask,
                    checksum: (hash >> 32) as u32,
                };
                prefetch(&self.entries, split.bucket << self.parameters.bucket_log);
            }
            at += fed;

            for &split in splits.iter().take(count) {
                let index = history.index(split.start);
                let found = (split.start >= anchor)
                    .then(|| self.best_match(history, lowest, anchor, split))
                    .flatten();
                self.insert(split.bucket, [index, split.checksum]);
                let Some((earlier, before, after)) = found else {
                    continue;
                };
                let candidate = Candidate {
                    offset: index - earlier,
                    literal_len: split.start - before - anchor,
                    match_len: before + after,
                };
                _ = candidates.list.push_within_capacity(candidate);
                anchor = split.start + after;
                // A pattern that repeats needs no more than one entry.
                if anchor > at {
                    at = anchor;
                    break;
                }
            }
        }
        history.end() - anchor
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::window::INDEX_MAX;

    #[test]
    fn lowering_indices_changes_nothing() -> Result<()> {
        const BLOCK_LEN: usize = 1024;
        let parameters = LongDistance {
            hash_log: 8,
            bucket_log: 2,
            min_match: 8,
            hash_rate_log: 2,
        };
        let words = (0..1000u64).map(|it| XxHash64::hash(&(it * it / 7 % 200).to_le_bytes()));
        let bytes: Vec<_> = words
            .flat_map(|it| [it, !it])
            .flat_map(u64::to_le_bytes)
            .collect();
        let found_from = |index| -> Result<_> {
            let mut finder = Finder::new(parameters, 11)?;
            finder.window = Window::starting_at(index);
            finder.admit(&Input::alone(&bytes, &[]));
            let (mut found, mut candidates) = (Vec::new(), Candidates::default());
            for start in (0..bytes.len() - BLOCK_LEN).step_by(BLOCK_LEN + 5) {
                candidates.clear_for(BLOCK_LEN, &parameters)?;
                finder.find(
                    &Input::alone(&bytes, &[]),
                    start,
                    BLOCK_LEN,
                    &mut candidates,
                    || false,
                );
                finder.skip(5);
                let list = candidates.list.iter();
                found.extend(list.map(|it| [it.offset, it.literal_len, it.match_len]));
            }
            assert!(finder.window.next < 1 << 16);
            Ok(found)
        };
        let expected = found_from(FIRST_INDEX)?;
        assert!(expected.len() > 100);
        // In the middle of a block, and of what is skipped
        for before in [5000, 4 * (BLOCK_LEN as u32 + 5) - 2] {
            assert_eq!(found_from(INDEX_MAX - before)?, expected);
        }
        Ok(())
    }

    #[test]
    fn a_checksum_is_no_proof_of_a_match() -> Result<()> {
        let parameters = LongDistance {
            hash_log: 6,
            bucket_log: 1,
            min_match: 8,
            hash_rate_log: 1,
        };
        let bytes = b"0123456-01234567-01234567+";
        let mut finder = Finder::new(parameters, 10)?;
        let history = (finder.window).history(&Input::alone(bytes, &[]), 0, bytes.len());
        let split = Split {
            start: 17,
            bucket: 3,
            checksum: 9,
        };
        finder.insert(3, [history.index(0), 9]);
        assert_eq!(finder.best_match(&history, 0, 17, split), None);
        finder.insert(3, [history.index(8), 9]);
        let found = finder.best_match(&history, 0, 17, split);
        assert_eq!(found, Some((history.index(8), 0, 8)));
        Ok(())
    }
}
