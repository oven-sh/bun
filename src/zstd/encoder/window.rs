//! Which bytes matches can refer to. Tables know them by an index that counts up through the input.

use core::hint::select_unpredictable;

use bun_zstd_decoder::array::At;

use crate::bytes::{
    AtLeast, chunk_at, common_suffix, compare, first_difference, likely, u32_at, u64_at,
};

/// Lower ones have a meaning of their own in most tables.
pub(crate) const FIRST_INDEX: u32 = 2;
/// Leaves room for a block before `u32::MAX`.
pub(crate) const INDEX_MAX: u32 = 3500 << 20;
/// Hashing reads as much.
pub(crate) const WORD_LEN: usize = 8;

/// New input, and what came before it.
#[derive(Clone, Copy)]
pub(crate) struct Input<'a> {
    /// Ends with the new input. What precedes that is earlier input, if `follows_last`.
    pub(crate) segment: &'a [u8],
    pub(crate) len: usize,
    pub(crate) follows_last: bool,
    /// The end of the segment before this one.
    pub(crate) older: &'a [u8],
}

impl<'a> Input<'a> {
    pub(crate) fn alone(bytes: &'a [u8], older: &'a [u8]) -> Self {
        Self {
            segment: bytes,
            len: bytes.len(),
            follows_last: false,
            older,
        }
    }

    pub(crate) fn start(&self) -> usize {
        self.segment.len() - self.len
    }

    pub(crate) fn new_bytes(&self) -> &'a [u8] {
        self.segment.get(self.start()..).unwrap_or_default()
    }
}

/// Up to two runs of bytes: the prefix, which is adjacent to what is being compressed, and an older one.
#[derive(Clone, Copy)]
pub(crate) struct Window {
    /// Of the next byte to compress.
    pub(crate) next: u32,
    pub(crate) prefix_start: u32,
    pub(crate) older_start: u32,
}

impl Window {
    pub(crate) const fn starting_at(index: u32) -> Self {
        Self {
            next: index,
            prefix_start: index,
            older_start: index,
        }
    }

    pub(crate) fn has_older(&self) -> bool {
        self.older_start < self.prefix_start
    }

    pub(crate) fn admit(&mut self, input: &Input<'_>) {
        if !input.follows_last {
            self.older_start = self.prefix_start;
            self.prefix_start = self.next;
            if ((self.prefix_start - self.older_start) as usize) < WORD_LEN {
                self.older_start = self.prefix_start;
            }
        }
        let older_len = (self.prefix_start - self.older_start) as usize;
        self.older_start += older_len.saturating_sub(input.older.len()) as u32;
    }

    pub(crate) fn raise_start(&mut self, index: u32) {
        self.older_start = self.older_start.max(index);
        self.prefix_start = self.prefix_start.max(self.older_start);
    }

    pub(crate) fn would_overflow(&self, len: usize) -> bool {
        self.next as usize + len > INDEX_MAX as usize
    }

    /// Returns by how much. Indices keep their lowest `cycle_log` bits.
    pub(crate) fn lower_indices(&mut self, cycle_log: u32, window_log: u32) -> u32 {
        let cycle_len = 1u32 << cycle_log;
        let in_cycle = self.next & (cycle_len - 1);
        let margin = if in_cycle < FIRST_INDEX {
            cycle_len.max(FIRST_INDEX)
        } else {
            0
        };
        let lowered = in_cycle + margin + cycle_len.max(1 << window_log);
        let by = self.next - lowered;
        self.next = lowered;
        self.prefix_start = self.prefix_start.saturating_sub(by).max(FIRST_INDEX);
        self.older_start = self.older_start.saturating_sub(by).max(FIRST_INDEX);
        by
    }

    /// For the `len` bytes at `start` of the segment, which are next.
    pub(crate) fn history<'a>(&self, input: &Input<'a>, start: usize, len: usize) -> History<'a> {
        let prefix_len = (self.next - self.prefix_start) as usize;
        let older_len = (self.prefix_start - self.older_start) as usize;
        let prefix = start.checked_sub(prefix_len);
        let older = input.older.len().checked_sub(older_len);
        debug_assert!(prefix.is_some() && older.is_some());
        History {
            prefix: prefix
                .and_then(|from| input.segment.get(from..start + len))
                .unwrap_or_default(),
            prefix_index: self.prefix_start,
            older: older
                .and_then(|from| input.older.get(from..))
                .unwrap_or_default(),
            start: prefix_len as u32,
        }
    }
}

/// The bytes of a window. Positions are those in `prefix`.
#[derive(Clone, Copy)]
pub(crate) struct History<'a> {
    /// Ends with what is being compressed.
    pub(crate) prefix: &'a [u8],
    /// Of the first byte of `prefix`.
    pub(crate) prefix_index: u32,
    /// In terms of indices, `prefix` follows it.
    pub(crate) older: &'a [u8],
    /// Of what is being compressed.
    pub(crate) start: u32,
}

impl<'a> History<'a> {
    pub(crate) fn part(&self, start: u32, end: u32) -> Self {
        Self {
            prefix: self.prefix.get(..end as usize).unwrap_or(self.prefix),
            start,
            ..*self
        }
    }

    /// Without what precedes `index`, which is in the older run.
    pub(crate) fn from_older(self, index: u32) -> Self {
        let older = self.older.get(self.older_position(index) as usize..);
        Self {
            older: older.unwrap_or_default(),
            ..self
        }
    }

    /// See [`AtLeast`].
    #[inline(always)]
    pub(crate) fn with_prefix_of<const N: usize>(self) -> Option<Self> {
        let prefix = AtLeast::<N>::new(self.prefix)?.bytes;
        Some(Self { prefix, ..self })
    }

    pub(crate) fn block(&self) -> &'a [u8] {
        self.prefix.get(self.start as usize..).unwrap_or_default()
    }

    #[inline(always)]
    pub(crate) fn end(&self) -> u32 {
        self.prefix.len() as u32
    }

    #[inline(always)]
    pub(crate) fn index(&self, position: u32) -> u32 {
        self.prefix_index.wrapping_add(position)
    }

    /// Out of range for an index before the prefix.
    #[inline(always)]
    pub(crate) fn position(&self, index: u32) -> u32 {
        index.wrapping_sub(self.prefix_index)
    }

    #[inline(always)]
    pub(crate) fn older_index(&self) -> u32 {
        self.prefix_index.wrapping_sub(self.older.len() as u32)
    }

    #[inline(always)]
    pub(crate) fn older_position(&self, index: u32) -> u32 {
        index.wrapping_sub(self.older_index())
    }

    /// The run that `index` would be in, and where.
    #[inline(always)]
    pub(crate) fn locate(&self, index: u32) -> (&'a [u8], u32) {
        select_unpredictable(
            index < self.prefix_index,
            (self.older, self.older_position(index)),
            (self.prefix, self.position(index)),
        )
    }

    /// `None` unless the bytes are in one run. For when it is hard to predict which.
    #[inline(always)]
    pub(crate) fn u32_at_index(&self, index: u32) -> Option<u32> {
        let (run, at) = self.locate(index);
        likely(u32_at(run, at))
    }

    #[inline(always)]
    pub(crate) fn u64_at_index(&self, index: u32) -> Option<u64> {
        let (run, at) = self.locate(index);
        likely(u64_at(run, at))
    }

    /// Positions wrap around for what is in the older run.
    #[inline(always)]
    pub(crate) fn has_at(&self, position: u32, value: u32) -> bool {
        match u32_at(self.prefix, position) {
            Some(found) => found == value,
            None => {
                u32_at(self.older, position.wrapping_add(self.older.len() as u32)) == Some(value)
            }
        }
    }

    /// For the ends of runs. After the older one, the prefix follows.
    #[cold]
    #[inline(never)]
    fn compare_bytes(prefix: &[u8], position: u32, run: &[u8], at: u32) -> (u32, bool) {
        let bytes = prefix.get(position as usize..).unwrap_or_default();
        let beyond = (at as usize).saturating_sub(run.len());
        let run = run.get(at as usize..).unwrap_or_default();
        let (len, is_below) = compare(bytes, run);
        if len != run.len() {
            return (len as u32, is_below);
        }
        let from = |start: usize| prefix.get(start..).unwrap_or_default();
        let (more, is_below) = compare(from(position as usize + len), from(beyond));
        ((len + more) as u32, is_below)
    }

    /// Where the bytes from `position` on start to differ from those `distance` further in `run`, and if these are lower.
    #[inline(always)]
    fn compare_in(&self, position: u32, run: &[u8], distance: u32) -> (u32, bool) {
        let mut end = position;
        if let Some(a) = likely(u64_at(self.prefix, position))
            && let Some(b) = likely(u64_at(run, position.wrapping_add(distance)))
        {
            if a != b {
                let len = (a ^ b).trailing_zeros() / 8;
                return (position + len, b.swap_bytes() < a.swap_bytes());
            }
            end += WORD_LEN as u32;
        }
        while let Some(a) = likely(chunk_at(self.prefix, end))
            && let Some(b) = likely(chunk_at(run, end.wrapping_add(distance)))
        {
            if let Some(index) = first_difference(a, b) {
                return (end + index, b.at(index as usize) < a.at(index as usize));
            }
            end += a.len() as u32;
        }
        let at = end.wrapping_add(distance);
        let (more, is_below) = Self::compare_bytes(self.prefix, end, run, at);
        (end + more, is_below)
    }

    #[inline(always)]
    pub(crate) fn compare(&self, position: u32, distance: u32) -> (u32, bool) {
        self.compare_in(position, self.prefix, distance)
    }

    #[inline(always)]
    pub(crate) fn compare_older(&self, position: u32, distance: u32) -> (u32, bool) {
        self.compare_in(position, self.older, distance)
    }

    #[inline(always)]
    pub(crate) fn compare_index(&self, position: u32, index: u32) -> (u32, bool) {
        let (run, at) = self.locate(index);
        self.compare_in(position, run, at.wrapping_sub(position))
    }

    /// How many bytes from `position` on equal those from `at` of `run` on.
    #[inline(always)]
    fn match_len_in(&self, position: u32, run: &[u8], at: u32) -> u32 {
        let distance = at.wrapping_sub(position);
        let mut end = position;
        while let Some(a) = chunk_at(self.prefix, end)
            && let Some(b) = chunk_at(run, end.wrapping_add(distance))
        {
            if let Some(index) = first_difference(a, b) {
                return end + index - position;
            }
            end += a.len() as u32;
        }
        let at = end.wrapping_add(distance);
        end - position + Self::compare_bytes(self.prefix, end, run, at).0
    }

    #[inline(always)]
    pub(crate) fn match_len(&self, position: u32, earlier: u32) -> u32 {
        self.match_len_in(position, self.prefix, earlier)
    }

    #[inline(always)]
    pub(crate) fn older_match_len(&self, position: u32, earlier: u32) -> u32 {
        self.match_len_in(position, self.older, earlier)
    }

    /// `known` bytes need no comparing.
    #[inline(always)]
    pub(crate) fn match_len_at_index(&self, position: u32, index: u32, known: u32) -> u32 {
        let (run, at) = self.locate(index);
        known + self.match_len_in(position + known, run, at + known)
    }

    #[cold]
    #[inline(never)]
    fn compare_bytes_before(bytes: &[u8], position: u32, run: &[u8], at: u32, max: u32) -> u32 {
        let before = |end: u32| end.saturating_sub(max) as usize..end as usize;
        match (bytes.get(before(position)), run.get(before(at))) {
            (Some(a), Some(b)) => common_suffix(a, b) as u32,
            _ => 0,
        }
    }

    /// How many bytes before `position` equal those before `at` of `run`, up to `max`.
    #[inline(always)]
    fn match_len_before_in(&self, position: u32, run: &[u8], at: u32, max: u32) -> u32 {
        let word_before = |run, end: u32| u64_at(run, end.wrapping_sub(WORD_LEN as u32));
        if let Some(a) = likely(word_before(self.prefix, position))
            && let Some(b) = likely(word_before(run, at))
            && (a != b || max <= WORD_LEN as u32)
        {
            return max.min((a ^ b).leading_zeros() / 8);
        }
        Self::compare_bytes_before(self.prefix, position, run, at, max)
    }

    #[inline(always)]
    pub(crate) fn match_len_before(&self, position: u32, earlier: u32, max: u32) -> u32 {
        self.match_len_before_in(position, self.prefix, earlier, max)
    }

    /// Within the run of `index`.
    #[inline(always)]
    pub(crate) fn match_len_before_index(&self, position: u32, index: u32, max: u32) -> u32 {
        let (run, at) = self.locate(index);
        self.match_len_before_in(position, run, at, max)
    }
}

/// The results are those of `ZSTD_window_correctOverflow()`.
#[test]
fn indices_are_lowered_like_zstd_does() {
    for (next, older_start, logs, expected) in [
        (INDEX_MAX, INDEX_MAX - 4000, (10, 12), [5120, 2120, 1120]),
        (
            INDEX_MAX + 1,
            INDEX_MAX - 3999,
            (10, 12),
            [5121, 2121, 1121],
        ),
        (INDEX_MAX + 2, INDEX_MAX - 3998, (10, 12), [4098, 1098, 98]),
        (
            3_670_000_123,
            3_669_996_123,
            (0, 20),
            [1_048_578, 1_045_578, 1_044_578],
        ),
        (
            3_670_000_123,
            3_669_996_123,
            (22, 17),
            [8_372_731, 8_369_731, 8_368_731],
        ),
        (3_670_000_123, 5, (8, 31), [2_147_483_899, 2_147_480_899, 2]),
    ] {
        let mut window = Window {
            next,
            prefix_start: next - 3000,
            older_start,
        };
        let by = window.lower_indices(logs.0, logs.1);
        let actual = [window.next, window.prefix_start, window.older_start];
        assert_eq!((actual, window.next + by), (expected, next));
    }

    let overflows = [0, 1].map(|len| Window::starting_at(3_670_016_000).would_overflow(len));
    assert_eq!(overflows, [false, true]);

    let mut window = Window {
        next: INDEX_MAX,
        ..Window::starting_at(5)
    };
    window.lower_indices(10, 12);
    assert_eq!(window.prefix_start, FIRST_INDEX);
}
