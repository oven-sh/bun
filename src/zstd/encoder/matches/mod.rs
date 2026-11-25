//! The search for matches.

mod double_fast;
mod fast;
mod gear_table;
mod hash;
mod ladder;
pub(crate) mod long_distance;
mod near;
pub(crate) mod staged;

use core::cell::Cell;
use core::marker::ConstParamTy;
use core::ops::Range;

use bun_pod::Pod;
use bun_zstd_decoder::Result;

use crate::entropy::Entropy;
use crate::parameters::{Strategy, TAG_BITS, Tuning};
use crate::sequences::{OffsetValue, Repeats, Sequences};
use crate::vec;
use crate::window::{FIRST_INDEX, History, INDEX_MAX, Input, WORD_LEN, Window};
use long_distance::Candidates;

/// The more bytes in a row do not match, the more are skipped.
const SKIP_LOG: u32 = 8;
const WORD: u32 = WORD_LEN as u32;

/// What there is to search besides the prefix.
#[derive(ConstParamTy, Clone, Copy, PartialEq, Eq)]
enum Reach {
    Prefix,
    /// An older run of bytes, which the same tables index.
    Older,
    /// A dictionary with tables of its own.
    Attached,
}

#[derive(Clone, Copy)]
#[repr(C, align(64))]
struct CacheLine([u8; 64]);

bun_pod::impl_pod!(CacheLine);

#[derive(Default)]
struct Memory(Vec<CacheLine>);

impl Memory {
    fn lines_for<T>(len: usize) -> usize {
        (len * size_of::<T>()).div_ceil(size_of::<CacheLine>())
    }

    /// Starts from 0 if it is too small.
    fn make_room<T>(&mut self, len: usize) -> Result<()> {
        if self.0.len() < Self::lines_for::<T>(len) {
            self.0 = Vec::new();
            self.0 = vec::zeroed(Self::lines_for::<T>(len))?;
        }
        Ok(())
    }

    fn get<T: Pod>(&self) -> &[T] {
        bun_pod::try_cast_slice(&self.0).unwrap_or_default()
    }

    fn get_mut<T: Pod>(&mut self) -> &mut [T] {
        bun_pod::try_cast_slice_mut(&mut self.0).unwrap_or_default()
    }
}

#[derive(Default)]
struct Tables {
    /// All are below the next index of the window, those that no table takes up as well.
    indices: Memory,
    hash_len: usize,
    chain_len: usize,
}

struct TablesMut<'a> {
    hash: &'a mut [u32],
    chain: &'a mut [u32],
}

impl Tables {
    fn indices_len(&self) -> usize {
        self.hash_len + self.chain_len
    }

    /// For when indices start lower again.
    fn drop_unused(&mut self) {
        let used = Memory::lines_for::<u32>(self.indices_len());
        self.indices.0.truncate(used);
    }

    fn split_mut(&mut self) -> TablesMut<'_> {
        let mut indices = self.indices.get_mut();
        let [hash, chain] = [self.hash_len, self.chain_len]
            .map(|len| indices.split_off_mut(..len).unwrap_or_default());
        TablesMut { hash, chain }
    }
}

/// Lets a search hold on to entries that may be the same.
#[inline(always)]
fn cells(table: &mut [u32]) -> &[Cell<u32>] {
    Cell::from_mut(table).as_slice_of_cells()
}

/// For hash tables with no more entries, prefetching does not pay.
const CACHED_UP_TO: usize = 1 << 16;

#[inline(always)]
fn prefetch<T>(items: &[T], at: usize) {
    let item = items.as_ptr().wrapping_add(at);
    core::hint::prefetch_read(item, core::hint::Locality::L1);
}

/// How far back a match can start.
#[derive(Clone, Copy)]
struct Bounds {
    prefix_start: u32,
    older_start: u32,
    /// Unlimited as long as a dictionary is within reach.
    max_distance: u32,
}

impl Bounds {
    #[inline(always)]
    fn lowest(&self, current: u32) -> u32 {
        self.older_start
            .max(current.saturating_sub(self.max_distance))
    }

    #[inline(always)]
    fn lowest_in_prefix(&self, current: u32) -> u32 {
        self.prefix_start
            .max(current.saturating_sub(self.max_distance))
    }
}

/// The tables of a dictionary, whose content is the older run of a [`History`].
#[derive(Clone, Copy)]
struct Attached<'a> {
    hash: &'a [u32],
    chain: &'a [u32],
    tuning: Tuning,
    /// Added to an index of these tables, makes it one of the history.
    delta: u32,
}

impl Attached<'_> {
    /// Stands in where there is none.
    fn empty(tuning: Tuning) -> Self {
        Self {
            hash: &[],
            chain: &[],
            tuning,
            delta: 0,
        }
    }

    /// Where an index of these tables is in the older run.
    #[inline(always)]
    fn position(index: u32) -> u32 {
        index.wrapping_sub(FIRST_INDEX)
    }
}

/// Where a search that knows two recent offsets has got to.
struct Progress<'a> {
    sequences: &'a mut Sequences,
    /// The first byte that no sequence covers.
    anchor: u32,
    /// 0 stands for one that is out of reach.
    recent: u32,
    second: u32,
}

impl<'a> Progress<'a> {
    fn new(sequences: &'a mut Sequences, anchor: u32, repeats: Repeats, max_offset: u32) -> Self {
        let [recent, second, _] = repeats
            .0
            .map(|offset| if offset > max_offset { 0 } else { offset });
        Self {
            sequences,
            anchor,
            recent,
            second,
        }
    }

    #[inline(always)]
    fn store(&mut self, offset: OffsetValue, matched: Range<u32>) {
        let literal_len = matched.start.wrapping_sub(self.anchor);
        self.sequences
            .push(literal_len, offset, matched.end.wrapping_sub(matched.start));
        self.anchor = matched.end;
    }

    #[inline(always)]
    fn note_offset(&mut self, offset: u32) {
        (self.recent, self.second) = (offset, self.recent);
    }

    #[inline(always)]
    fn swap_offsets(&mut self) {
        (self.recent, self.second) = (self.second, self.recent);
    }

    /// `repeats` and `max_offset` are those that it started with. Returns the anchor.
    fn finish(self, repeats: &mut Repeats, max_offset: u32) -> u32 {
        let [recent, second, _] = &mut repeats.0;
        if self.second != 0 {
            *second = self.second;
        } else if self.recent != 0 && *recent > max_offset {
            *second = *recent;
        } else if *second <= max_offset {
            *second = 0;
        }
        if self.recent != 0 || *recent <= max_offset {
            *recent = self.recent;
        }
        self.anchor
    }
}

/// What a search is given besides the state.
pub(crate) struct Search<'a> {
    pub(crate) history: History<'a>,
    /// Its content has to be the older run of the history.
    pub(crate) attached: Option<&'a MatchState>,
    /// Of the block before.
    pub(crate) entropy: &'a Entropy,
    pub(crate) long_matches: Option<&'a Candidates>,
}

#[derive(ConstParamTy, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Owner {
    Frame,
    Dictionary,
}

pub(crate) struct MatchState {
    pub(crate) tuning: Tuning,
    pub(crate) window: Window,
    /// Of the byte after a dictionary that is within reach, or 0.
    pub(crate) dictionary_end: u32,
    /// From which on the tables are not up to date.
    pub(crate) next_to_index: u32,
    tables: Tables,
    /// For the strategies that do without `tables`.
    ladder: Option<Box<ladder::State>>,
}

impl MatchState {
    /// Without tables, until it is [`reset`](Self::reset).
    pub(crate) fn new(tuning: Tuning) -> Self {
        Self {
            tuning,
            window: Window::starting_at(FIRST_INDEX),
            dictionary_end: 0,
            next_to_index: FIRST_INDEX,
            tables: Tables::default(),
            ladder: None,
        }
    }

    /// What the tables hold stays, out of reach.
    fn forget(&mut self, tuning: Tuning, loaded_len: usize) {
        // Clearing the tables is faster than lowering their indices.
        if self.window.would_overflow(loaded_len + (16 << 20)) {
            self.tables.indices.0.clear();
            self.window.next = FIRST_INDEX;
        }
        self.tuning = tuning;
        self.window = Window::starting_at(self.window.next.max(FIRST_INDEX));
        self.dictionary_end = 0;
        self.next_to_index = self.window.next;
    }

    /// `loaded_len` bytes are going to be [`load`](Self::load)ed.
    pub(crate) fn reset(&mut self, tuning: Tuning, loaded_len: usize) -> Result<()> {
        self.forget(tuning, loaded_len);
        self.reset_tables()
    }

    /// Takes over from another search, and indexes the last of what precedes the start of `history`.
    pub(crate) fn resume(&mut self, history: &History<'_>) -> Result<()> {
        let start = history.start.saturating_sub(32 << 10);
        self.next_to_index = history.index(start);
        self.free_tables();
        self.reset_tables()?;
        self.fill::<{ Owner::Frame }>(&history.part(start, history.start), || false)
    }

    fn reset_tables(&mut self) -> Result<()> {
        let tuning = self.tuning;
        if tuning.strategy > Strategy::DoubleFast {
            self.tables = Tables::default();
            let ladder = match &mut self.ladder {
                Some(ladder) => ladder,
                None => self.ladder.insert(ladder::State::new()?),
            };
            ladder.reset(&tuning, tuning.window_log, self.next_to_index);
            return Ok(());
        }
        self.ladder = None;
        let tables = &mut self.tables;
        tables.hash_len = 1 << tuning.hash_log;
        tables.chain_len = usize::from(tuning.strategy != Strategy::Fast) << tuning.chain_log;
        tables.indices.make_room::<u32>(tables.indices_len())
    }

    /// For when only the window is needed, which starts with `loaded_len` bytes.
    pub(crate) fn reset_window(&mut self, tuning: Tuning, loaded_len: usize) {
        self.forget(tuning, loaded_len);
        (self.ladder, self.tables.hash_len, self.tables.chain_len) = (None, 0, 0);
        self.window.next += loaded_len as u32;
    }

    pub(crate) fn free_tables(&mut self) {
        (self.tables, self.ladder) = (Tables::default(), None);
    }

    /// For when only searches index. The fast ones leave out the first byte, so 0 can still stand for nothing.
    pub(crate) fn start_at_0(&mut self, input_len: Option<u64>) {
        if self.tuning.strategy > Strategy::DoubleFast {
            return;
        }
        if self.window.next != FIRST_INDEX {
            let indices = self.tables.indices.get_mut::<u32>();
            let is_worth_clearing = |len| (256..=len).contains(&(indices.len() as u64 / 8));
            if !input_len.is_some_and(is_worth_clearing) {
                return;
            }
            indices.fill(0);
        }
        (self.window, self.next_to_index) = (Window::starting_at(0), 0);
    }

    /// How many bytes the tables take, and how many of them are needed.
    pub(crate) fn tables_len(&self) -> [usize; 2] {
        match &self.ladder {
            Some(ladder) => ladder.tables_len(&self.tuning),
            None => [
                self.tables.indices.0.capacity() * size_of::<CacheLine>(),
                self.tables.indices_len() * size_of::<u32>(),
            ],
        }
    }

    /// Makes room for searching `len` bytes.
    pub(crate) fn reserve(&mut self, len: usize, has_long_matches: bool) -> Result<()> {
        let Some(ladder) = &mut self.ladder else {
            return Ok(());
        };
        if has_long_matches {
            ladder.reserve_hints()?;
        }
        ladder.reserve(&self.tuning, len)
    }

    /// For a history whose prefix starts at `prefix_index`.
    fn as_attached(&self, prefix_index: u32) -> Attached<'_> {
        let (tables, end) = (&self.tables, self.window.next);
        let indices = tables.indices.get().split_at_checked(tables.hash_len);
        let (hash, chain) = indices.unwrap_or_default();
        Attached {
            hash,
            chain,
            tuning: self.tuning,
            delta: prefix_index.wrapping_sub(end),
        }
    }

    /// Goes on from where the tables of a dictionary, which have the same sizes, are.
    pub(crate) fn copy_from(&mut self, dictionary: &Self) -> Result<()> {
        if let (Some(to), Some(from)) = (&mut self.ladder, &dictionary.ladder) {
            to.copy_from(from)?;
        }
        let Attached { hash, chain, .. } = dictionary.as_attached(0);
        self.tables.drop_unused();
        let to = self.tables.split_mut();
        for (to, from) in [(to.hash, hash), (to.chain, chain)] {
            for (to, from) in to.iter_mut().zip(from) {
                *to = from >> TAG_BITS;
            }
        }
        self.window = dictionary.window;
        self.next_to_index = dictionary.next_to_index;
        self.dictionary_end = dictionary.dictionary_end;
        Ok(())
    }

    /// Leaves room below the input for the indices of a dictionary.
    pub(crate) fn attach(&mut self, dictionary: &Self) {
        self.window = Window::starting_at(dictionary.window.next.max(self.window.next));
        self.dictionary_end = self.window.next;
        if let Some(ladder) = &mut self.ladder {
            ladder.reset(
                &self.tuning,
                self.tuning.window_log.max(23),
                self.window.next,
            );
        }
    }

    /// The end of `content` that the tables of a dictionary can tell apart.
    pub(crate) fn loadable<'a>(&self, content: &'a [u8]) -> &'a [u8] {
        let end_max = if self.tuning.strategy <= Strategy::DoubleFast {
            1 << (32 - TAG_BITS)
        } else {
            INDEX_MAX
        };
        let excess = content
            .len()
            .saturating_sub((end_max - FIRST_INDEX) as usize);
        content.get(excess..).unwrap_or_default()
    }

    /// Indexes `content`, which nothing precedes.
    pub(crate) fn load<const OWNER: Owner>(
        &mut self,
        content: &[u8],
        is_abandoned: impl Fn() -> bool,
    ) -> Result<()> {
        let tuning = self.tuning;
        if let (Owner::Dictionary, Some(ladder)) = (OWNER, &mut self.ladder) {
            // The frames that copy the tables can have larger windows.
            ladder.reset(&tuning, tuning.window_log.max(23), self.window.next);
        }
        let worth_log = (tuning.hash_log + 3).max(tuning.chain_log + 1).min(31);
        let start = content.len().saturating_sub(1 << worth_log);
        let history = self
            .window
            .history(&Input::alone(content, &[]), 0, content.len());
        let end = history.index(history.end());
        self.window.next = end;
        self.next_to_index = history.index(start as u32);
        if OWNER == Owner::Dictionary {
            self.dictionary_end = end;
        }
        self.fill::<OWNER>(&history.part(start as u32, history.end()), is_abandoned)
    }

    fn fill<const OWNER: Owner>(
        &mut self,
        history: &History<'_>,
        is_abandoned: impl Fn() -> bool,
    ) -> Result<()> {
        let (tuning, len) = (self.tuning, history.block().len());
        if len <= WORD_LEN {
            return Ok(());
        }
        match &mut self.ladder {
            Some(ladder) => {
                ladder.reserve(&tuning, len)?;
                ladder.fill(history, is_abandoned);
                if OWNER == Owner::Dictionary {
                    ladder.drop_work();
                }
            }
            None if tuning.strategy == Strategy::Fast => fast::fill::<OWNER>(self, history),
            None => double_fast::fill::<OWNER>(self, history),
        }
        self.next_to_index = history.index(history.end());
        Ok(())
    }

    pub(crate) fn admit(&mut self, input: &Input<'_>) {
        self.window.admit(input);
        if !input.follows_last {
            self.next_to_index = self.window.prefix_start;
        }
    }

    /// Drops what is out of reach for the next `len` bytes.
    pub(crate) fn prepare_for(&mut self, len: usize) {
        if self.window.would_overflow(len) {
            self.lower_indices();
        }
        let max_distance = 1u64 << self.tuning.window_log;
        let reach_end = u64::from(self.dictionary_end) + max_distance;
        let block_end = u64::from(self.window.next) + len as u64;
        if block_end > reach_end || self.dictionary_end != self.window.prefix_start {
            self.dictionary_end = 0;
        }
        if self.dictionary_end == 0 {
            let lowest = self.window.next.saturating_sub(max_distance as u32);
            self.window.raise_start(lowest);
        }
        self.next_to_index = self.next_to_index.max(self.window.older_start);
    }

    #[cold]
    fn lower_indices(&mut self) {
        let by = self
            .window
            .lower_indices(self.tuning.cycle_log(), self.tuning.window_log);
        let lower = |index: u32| {
            if index < by + FIRST_INDEX {
                0
            } else {
                index - by
            }
        };
        self.tables.drop_unused();
        for index in self.tables.indices.get_mut() {
            *index = lower(*index);
        }
        if let Some(ladder) = &mut self.ladder {
            ladder.bias = ladder.bias.wrapping_add(by);
        }
        self.next_to_index = self.next_to_index.saturating_sub(by);
    }

    /// After a long match, leaves most of it out of the tables.
    pub(crate) fn skip_indexing(&mut self, current: u32, tolerated: u32) {
        if let Some(excess) = current.checked_sub(self.next_to_index + tolerated)
            && excess > 0
        {
            self.next_to_index = current - excess.min(tolerated / 2);
        }
    }

    fn bounds(&self) -> Bounds {
        Bounds {
            prefix_start: self.window.prefix_start,
            older_start: self.window.older_start,
            max_distance: if self.dictionary_end != 0 {
                u32::MAX
            } else {
                1 << self.tuning.window_log
            },
        }
    }

    /// Where a long match was taken without a search, for the strategies that do not catch up by themselves.
    fn index_up_to(&mut self, history: &History<'_>, end: u32) {
        self.skip_indexing(history.index(end), 1024);
        let history = history.part(end, end);
        match self.tuning.strategy {
            Strategy::Fast => fast::fill::<{ Owner::Frame }>(self, &history),
            Strategy::DoubleFast => double_fast::fill::<{ Owner::Frame }>(self, &history),
            _ => {}
        }
    }

    /// Returns where the literals start that follow the last match.
    pub(crate) fn search(
        &mut self,
        search: &Search<'_>,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
    ) -> u32 {
        let max_distance = self.bounds().max_distance;
        if let Some(ladder) = &mut self.ladder {
            return ladder.search(&self.tuning, max_distance, search, sequences, repeats);
        }
        match search.attached {
            _ if self.window.has_older() => {
                let none = Attached::empty(self.tuning);
                self.search_in::<{ Reach::Older }>(search, &none, sequences, repeats)
            }
            Some(dictionary) => {
                let attached = dictionary.as_attached(search.history.prefix_index);
                self.search_in::<{ Reach::Attached }>(search, &attached, sequences, repeats)
            }
            None => {
                let none = Attached::empty(self.tuning);
                self.search_in::<{ Reach::Prefix }>(search, &none, sequences, repeats)
            }
        }
    }

    fn search_in<const REACH: Reach>(
        &mut self,
        search: &Search<'_>,
        attached: &Attached<'_>,
        sequences: &mut Sequences,
        repeats: &mut Repeats,
    ) -> u32 {
        let history = &search.history;
        match self.tuning.strategy {
            Strategy::Fast => fast::search::<REACH>(self, history, attached, sequences, repeats),
            _ => double_fast::search::<REACH>(self, history, attached, sequences, repeats),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parameters::{Purpose, Request};

    fn state(strategy: i32) -> Result<MatchState> {
        let mut request = Request::new(1);
        for (key, value) in [(101, 12), (102, 6), (103, 10), (105, 3), (107, strategy)] {
            request.set(key, value)?;
        }
        let tuning = request.tuning(None, Purpose::Frame { dictionary_len: 0 });
        let mut state = MatchState::new(tuning);
        state.reset(tuning, 0)?;
        Ok(state)
    }

    #[test]
    fn tables_are_lowered_with_the_window() -> Result<()> {
        const BY: u32 = INDEX_MAX - 4096 - 1024;
        let mut state = state(2)?;
        state.window = Window::starting_at(INDEX_MAX);
        state.next_to_index = INDEX_MAX - 1;
        let tables = state.tables.split_mut();
        for table in [tables.hash, tables.chain] {
            let before = [1, BY + 1, BY + 2, INDEX_MAX - 1];
            (table.iter_mut().zip(before)).for_each(|(to, from)| *to = from);
        }
        // Left by a frame with larger tables
        state.tables.indices.0.push(CacheLine([0xFF; _]));

        state.prepare_for(1);
        assert_eq!(state.next_to_index, 4096 + 1024);
        let used = state.tables.indices_len();
        assert_eq!(state.tables.indices.get::<u32>().len(), used);
        let tables = state.tables.split_mut();
        assert!(tables.hash.starts_with(&[0, 0, 2, 5119]));
        assert!(tables.chain.starts_with(&[0, 0, 2, 5119]));
        Ok(())
    }

    #[test]
    fn a_ladder_finds_what_was_loaded() -> Result<()> {
        let bytes = b"What was loaded?".repeat(2);
        for (is_abandoned, is_lowered) in [(false, false), (false, true), (true, false)] {
            let mut state = state(7)?;
            state.window.next = 1 << 20;
            state.reset(state.tuning, 16)?;
            state.load::<{ Owner::Frame }>(b"What was loaded?", || is_abandoned)?;
            if is_lowered {
                state.lower_indices();
            }
            let search = Search {
                history: (state.window).history(&Input::alone(&bytes, &[]), 16, 16),
                attached: None,
                entropy: &Entropy::EMPTY,
                long_matches: None,
            };
            let end = state.search(&search, &mut Sequences::new(), &mut Repeats::default());
            assert_eq!(end, if is_abandoned { 16 } else { 32 }, "{is_lowered}");
        }
        Ok(())
    }

    #[test]
    fn indices_with_tags_tell_16_mb_apart() -> Result<()> {
        let content = vec![0; 1 << 24];
        assert_eq!(state(2)?.loadable(&content).len(), (1 << 24) - 2);
        assert_eq!(state(3)?.loadable(&content).len(), 1 << 24);
        Ok(())
    }
}
