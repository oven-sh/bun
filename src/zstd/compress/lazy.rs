//! `zstd_lazy.c`: the `greedy`, `lazy`, `lazy2` and `btlazy2` strategies.

use core::hint::{Locality, prefetch_read};
use core::num::NonZeroU32;
use core::ops::Range;

use super::internal::{
    BlockSrc, CompressionParameters, DictMatchState, DictMode, Hash8, K_SEARCH_STRENGTH,
    MatchState, Near, Prefix, REPCODE1_TO_OFFBASE, RowTags, SecondTagStats, SeqSink, SeqStore,
    Strategy, ZSTD_DUBT_UNSORTED_MARK, ZSTD_ROW_HASH_CACHE_SIZE, count, count_2segments, hash_ptr,
    index_overlap_check, offbase_is_offset, offbase_to_offset, offset_to_offbase, table_get,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::Result;
use crate::util::{BUG, SliceExt, highbit32, read_le32, read_le64};

const K_LAZY_SKIPPING_STEP: u32 = 8;

// `ZSTD_dictMode_e`, as an argument of a const generic.
const NO_DICT: u8 = DictMode::NoDict as u8;
const EXT_DICT: u8 = DictMode::ExtDict as u8;
const DICT_MATCH_STATE: u8 = DictMode::DictMatchState as u8;

/// `PREFETCH_L1`: a hint that `slice[index]` is about to be read. `index` may be anything.
#[inline(always)]
fn prefetch_l1<T>(slice: &[T], index: usize) {
    prefetch_read(slice.as_ptr().wrapping_add(index), Locality::L1);
}

/// `dms->window.nextSrc - dms->window.base`: the index of the end of the dictionary, among its own indices.
#[inline(always)]
const fn dms_end_index(dms: &DictMatchState<'_>) -> u32 {
    dms.end.wrapping_sub(dms.base) as u32
}

// ── binary tree search ────────────────────────────────────────────────────

/// `ZSTD_updateDUBT`: adds the positions from `ms.next_to_update` up to `ip` to the trees, as unsorted chains.
#[inline(always)]
fn update_dubt(ms: &mut MatchState, prefix: Prefix<'_>, ip: usize, mls: u32) -> Result<()> {
    let hash_log = ms.c_params.hash_log;
    let bt_log = ms.c_params.chain_log - 1;
    let bt_mask = (1u32 << bt_log) - 1;
    let target = prefix.index_of(ip);
    let hash_table = ms.hash_table.as_mut_slice();
    let bt = ms.chain_table.as_mut_slice();

    for idx in ms.next_to_update..target {
        let h = hash_ptr(prefix.buf, prefix.pos_of(idx), hash_log, mls)?;
        let match_index = core::mem::replace(hash_table.at_mut(h)?, idx);
        *bt.array_at_mut(2 * (idx & bt_mask) as usize)? = [match_index, ZSTD_DUBT_UNSORTED_MARK];
    }
    ms.next_to_update = target;
    Ok(())
}

/// What [`insert_dubt1`] works out about the position it sorts.
struct Unsorted<'a> {
    bt_mask: u32,
    /// Where its two slots are in the table.
    slot: usize,
    /// The next sorted candidate, which is in the first slot. The other one has the previous unsorted candidate.
    next_sorted: u32,
    dict_limit: u32,
    dict_end: usize,
    prefix_start: usize,
    /// The buffer that the position is in, where it is in it, and where its segment ends.
    ip_buf: &'a [u8],
    ip: usize,
    iend: usize,
    window_low: u32,
}

impl<'a> Unsorted<'a> {
    fn new(ms: &MatchState, src: &BlockSrc<'a>, curr: u32, input_end: usize) -> Result<Self> {
        let bt_mask = (1u32 << (ms.c_params.chain_log - 1)) - 1;
        let slot = 2 * (curr & bt_mask) as usize;
        let dict_limit = ms.window.dict_limit;
        let dict_end = src.dict_pos_of(dict_limit);
        let (ip_buf, ip, iend) = if curr >= dict_limit {
            (src.buf, src.pos_of(curr), input_end)
        } else {
            (src.dict_buf, src.dict_pos_of(curr), dict_end)
        };
        let window_valid = ms.window.low_limit;
        let max_distance = 1u32 << ms.c_params.window_log;
        Ok(Self {
            bt_mask,
            slot,
            next_sorted: ms.chain_table.at(slot)?,
            dict_limit,
            dict_end,
            prefix_start: src.pos_of(dict_limit),
            ip_buf,
            ip,
            iend,
            window_low: if curr.wrapping_sub(window_valid) > max_distance {
                curr - max_distance
            } else {
                window_valid
            },
        })
    }
}

/// `ZSTD_insertDUBT1`: sorts the position `curr`, which is in a tree but unsorted. `curr` is at least `bt_low`.
fn insert_dubt1<const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    curr: u32,
    input_end: usize,
    mut nb_compares: u32,
    bt_low: u32,
) -> Result<()> {
    let at = Unsorted::new(ms, src, curr, input_end)?;
    let mut common_length_smaller = 0usize;
    let mut common_length_larger = 0usize;
    let bt = ms.chain_table.as_mut_slice();
    let mut smaller_ptr = at.slot;
    let mut larger_ptr = smaller_ptr + 1;
    let mut match_index = at.next_sorted;

    while nb_compares != 0 && match_index > at.window_low {
        let next_ptr = 2 * (match_index & at.bt_mask) as usize;
        let mut match_length = common_length_smaller.min(common_length_larger);
        let in_prefix =
            DICT_MODE != EXT_DICT || match_index as usize + match_length >= at.dict_limit as usize;
        // In `src.buf`, `match_pos` may be before the start: only its sum with `match_length` is a position.
        let (mut match_buf, mut match_pos) = if in_prefix {
            (src.buf, src.pos_of(match_index))
        } else {
            (src.dict_buf, src.dict_pos_of(match_index))
        };

        if in_prefix || curr < at.dict_limit {
            // Both are in the same segment.
            match_length += count(
                at.ip_buf,
                at.ip + match_length,
                match_buf,
                match_pos.wrapping_add(match_length),
                at.iend,
            )?;
        } else {
            match_length += count_2segments(
                at.ip_buf,
                at.ip + match_length,
                match_buf,
                match_pos + match_length,
                at.iend,
                at.dict_end,
                at.prefix_start,
            )?;
            if match_index as usize + match_length >= at.dict_limit as usize {
                (match_buf, match_pos) = (src.buf, src.pos_of(match_index));
            }
        }

        if at.ip + match_length == at.iend {
            // Equal: no way to know which is smaller. Dropped, to keep the tree consistent.
            break;
        }

        if match_buf.at(match_pos.wrapping_add(match_length))?
            < at.ip_buf.at(at.ip + match_length)?
        {
            bt.put(smaller_ptr, match_index)?;
            common_length_smaller = match_length;
            if match_index <= bt_low {
                // Beyond the tree. This slot keeps its value: only the other one is cleared.
                smaller_ptr = larger_ptr;
                break;
            }
            smaller_ptr = next_ptr + 1;
            match_index = bt.at(next_ptr + 1)?;
        } else {
            bt.put(larger_ptr, match_index)?;
            common_length_larger = match_length;
            if match_index <= bt_low {
                larger_ptr = smaller_ptr;
                break;
            }
            larger_ptr = next_ptr;
            match_index = bt.at(next_ptr)?;
        }
        nb_compares -= 1;
    }

    bt.put(smaller_ptr, 0)?;
    bt.put(larger_ptr, 0)
}

/// `ZSTD_DUBT_findBetterDictMatch`: goes on, in the tree of the dictionary, with a search that found `best_length`.
fn dubt_find_better_dict_match(
    ms: &MatchState,
    src: &BlockSrc<'_>,
    ip: usize,
    iend: usize,
    offset_ptr: &mut u32,
    mut best_length: usize,
    mut nb_compares: u32,
    mls: u32,
) -> Result<usize> {
    let dms = src.dms.ok_or(BUG)?;
    let h = hash_ptr(src.buf, ip, dms.ms.c_params.hash_log, mls)?;
    let mut dict_match_index = dms.ms.hash_table.at(h)?;

    let prefix_start = src.pos_of(ms.window.dict_limit);
    let curr = src.index_of(ip);
    let dict_high_limit = dms_end_index(&dms);
    let dict_low_limit = dms.ms.window.low_limit;
    let dict_index_delta = ms.window.low_limit.wrapping_sub(dict_high_limit);

    let dict_bt = dms.ms.chain_table.as_slice();
    let bt_log = dms.ms.c_params.chain_log - 1;
    let bt_mask = (1u32 << bt_log) - 1;
    let bt_low = if bt_mask >= dict_high_limit.wrapping_sub(dict_low_limit) {
        dict_low_limit
    } else {
        dict_high_limit - bt_mask
    };

    let mut common_length_smaller = 0usize;
    let mut common_length_larger = 0usize;

    while nb_compares != 0 && dict_match_index > dict_low_limit {
        let next_ptr = 2 * (dict_match_index & bt_mask) as usize;
        let mut match_length = common_length_smaller.min(common_length_larger);
        let match_index = dict_match_index.wrapping_add(dict_index_delta);
        match_length += count_2segments(
            src.buf,
            ip + match_length,
            dms.buf,
            dms.pos_of(dict_match_index) + match_length,
            iend,
            dms.end,
            prefix_start,
        )?;

        if match_length > best_length {
            if 4 * (match_length - best_length) as i32
                > highbit32(curr.wrapping_sub(match_index).wrapping_add(1)) as i32
                    - highbit32(offset_ptr.wrapping_add(1)) as i32
            {
                best_length = match_length;
                *offset_ptr = offset_to_offbase(curr.wrapping_sub(match_index));
            }
            if ip + match_length == iend {
                // No way to know which is smaller.
                break;
            }
        }

        if dict_match_index <= bt_low {
            // Beyond the tree.
            break;
        }
        let match_byte = if dict_match_index as usize + match_length >= dict_high_limit as usize {
            let match_pos = src.pos_of(match_index);
            src.buf.at(match_pos.wrapping_add(match_length))?
        } else {
            dms.buf.at(dms.pos_of(dict_match_index) + match_length)?
        };
        if match_byte < src.buf.at(ip + match_length)? {
            common_length_smaller = match_length;
            dict_match_index = dict_bt.at(next_ptr + 1)?;
        } else {
            common_length_larger = match_length;
            dict_match_index = dict_bt.at(next_ptr)?;
        }
        nb_compares -= 1;
    }

    Ok(best_length)
}

/// `ZSTD_DUBT_findBestMatch`
#[inline(always)]
fn dubt_find_best_match<const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    ip: usize,
    iend: usize,
    off_base_ptr: &mut u32,
    mls: u32,
) -> Result<usize> {
    let h = hash_ptr(src.buf, ip, ms.c_params.hash_log, mls)?;
    let mut match_index = ms.hash_table.at(h)?;

    let curr = src.index_of(ip);
    let window_low = ms.get_lowest_match_index(curr, ms.c_params.window_log);

    let bt_log = ms.c_params.chain_log - 1;
    let bt_mask = (1u32 << bt_log) - 1;
    let bt_low = curr.saturating_sub(bt_mask);
    let unsort_limit = bt_low.max(window_low);
    let mut nb_compares = 1u32 << ms.c_params.search_log;
    let mut nb_candidates = nb_compares;
    let mut previous_candidate = 0u32;

    // Reach the end of the list of unsorted candidates. The marks become a chain back to where it starts.
    let bt = ms.chain_table.as_mut_slice();
    let mut next_candidate = 2 * (match_index & bt_mask) as usize;
    while match_index > unsort_limit
        && bt.at(next_candidate + 1)? == ZSTD_DUBT_UNSORTED_MARK
        && nb_candidates > 1
    {
        bt.put(next_candidate + 1, previous_candidate)?;
        previous_candidate = match_index;
        match_index = bt.at(next_candidate)?;
        next_candidate = 2 * (match_index & bt_mask) as usize;
        nb_candidates -= 1;
    }

    // If the last candidate is still unsorted, cut the list there.
    if match_index > unsort_limit && bt.at(next_candidate + 1)? == ZSTD_DUBT_UNSORTED_MARK {
        *bt.array_at_mut(next_candidate)? = [0, 0];
    }

    // Sort the candidates, the oldest first.
    match_index = previous_candidate;
    while match_index != 0 {
        let next_candidate_idx = ms
            .chain_table
            .at(2 * (match_index & bt_mask) as usize + 1)?;
        insert_dubt1::<DICT_MODE>(ms, src, match_index, iend, nb_candidates, unsort_limit)?;
        match_index = next_candidate_idx;
        nb_candidates += 1;
    }

    // Find the longest match.
    let mut common_length_smaller = 0usize;
    let mut common_length_larger = 0usize;
    let dict_limit = ms.window.dict_limit;
    let dict_end = src.dict_pos_of(dict_limit);
    let prefix_start = src.pos_of(dict_limit);
    let bt = ms.chain_table.as_mut_slice();
    let mut smaller_ptr = 2 * (curr & bt_mask) as usize;
    let mut larger_ptr = smaller_ptr + 1;
    let mut match_end_idx = curr + 8 + 1;
    let mut best_length = 0usize;

    match_index = core::mem::replace(ms.hash_table.at_mut(h)?, curr);

    while nb_compares != 0 && match_index > window_low {
        let next_ptr = 2 * (match_index & bt_mask) as usize;
        let mut match_length = common_length_smaller.min(common_length_larger);
        // `match_pos` may be before the start of the buffer: only its sum with `match_length` is a position.
        let (mut match_buf, mut match_pos) = (src.buf, src.pos_of(match_index));

        if DICT_MODE != EXT_DICT || match_index as usize + match_length >= dict_limit as usize {
            match_length += count(
                src.buf,
                ip + match_length,
                match_buf,
                match_pos.wrapping_add(match_length),
                iend,
            )?;
        } else {
            let dict_match_pos = src.dict_pos_of(match_index);
            match_length += count_2segments(
                src.buf,
                ip + match_length,
                src.dict_buf,
                dict_match_pos + match_length,
                iend,
                dict_end,
                prefix_start,
            )?;
            if (match_index as usize + match_length) < dict_limit as usize {
                (match_buf, match_pos) = (src.dict_buf, dict_match_pos);
            }
        }

        if match_length > best_length {
            if match_length > match_end_idx.wrapping_sub(match_index) as usize {
                match_end_idx = match_index + match_length as u32;
            }
            if 4 * (match_length - best_length) as i32
                > highbit32(curr.wrapping_sub(match_index).wrapping_add(1)) as i32
                    - highbit32(*off_base_ptr) as i32
            {
                best_length = match_length;
                *off_base_ptr = offset_to_offbase(curr.wrapping_sub(match_index));
            }
            if ip + match_length == iend {
                // Equal: no way to know which is smaller.
                if DICT_MODE == DICT_MATCH_STATE {
                    // Nothing in the dictionary can be longer.
                    nb_compares = 0;
                }
                break;
            }
        }

        if match_buf.at(match_pos.wrapping_add(match_length))? < src.buf.at(ip + match_length)? {
            bt.put(smaller_ptr, match_index)?;
            common_length_smaller = match_length;
            if match_index <= bt_low {
                // Beyond the tree. This slot keeps its value: only the other one is cleared.
                smaller_ptr = larger_ptr;
                break;
            }
            smaller_ptr = next_ptr + 1;
            match_index = bt.at(next_ptr + 1)?;
        } else {
            bt.put(larger_ptr, match_index)?;
            common_length_larger = match_length;
            if match_index <= bt_low {
                larger_ptr = smaller_ptr;
                break;
            }
            larger_ptr = next_ptr;
            match_index = bt.at(next_ptr)?;
        }
        nb_compares -= 1;
    }

    bt.put(smaller_ptr, 0)?;
    bt.put(larger_ptr, 0)?;

    if DICT_MODE == DICT_MATCH_STATE && nb_compares != 0 {
        best_length = dubt_find_better_dict_match(
            ms,
            src,
            ip,
            iend,
            off_base_ptr,
            best_length,
            nb_compares,
            mls,
        )?;
    }

    // Skip repetitive patterns.
    ms.next_to_update = match_end_idx - 8;
    Ok(best_length)
}

/// `ZSTD_BtFindBestMatch`: updates the trees up to `ip` and returns the length of the best match there, or 0.
/// `off_base_ptr` is written to if there is one.
#[inline(never)]
fn bt_find_best_match<const MLS: u32, const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    ip: usize,
    i_limit: usize,
    off_base_ptr: &mut u32,
) -> Result<usize> {
    if ip < src.pos_of(ms.next_to_update) {
        // In an area that is skipped.
        return Ok(0);
    }
    update_dubt(ms, src.prefix(), ip, MLS)?;
    dubt_find_best_match::<DICT_MODE>(ms, src, ip, i_limit, off_base_ptr, MLS)
}

// ── what the match finders share ──────────────────────────────────────────

/// What an index below the current segment leads to: the older segment of the window, or the dictionary whose match
/// state is searched.
#[derive(Clone, Copy)]
struct DictSegment<'a> {
    /// All of it, and nothing else.
    bytes: &'a [u8],
    /// The index of its first byte.
    start_index: u32,
}

/// `ZSTD_getLowestMatchIndex`, with what it reads from the match state.
#[derive(Clone, Copy)]
struct Reach {
    lowest_valid: u32,
    /// More than any distance if there is a dictionary, which is valid as a whole until it is invalidated as a whole.
    max_distance: u32,
}

impl Reach {
    const fn new(ms: &MatchState) -> Self {
        Self {
            lowest_valid: ms.window.low_limit,
            max_distance: if ms.loaded_dict_end != 0 {
                u32::MAX
            } else {
                1 << ms.c_params.window_log
            },
        }
    }

    /// The lowest index a match for the position `curr` can be at.
    #[inline(always)]
    const fn low_limit(self, curr: u32) -> u32 {
        if curr.wrapping_sub(self.lowest_valid) > self.max_distance {
            curr - self.max_distance
        } else {
            self.lowest_valid
        }
    }
}

/// The block that a parser works on. Positions are counted from the start of the current segment of the window.
#[derive(Clone, Copy)]
struct LazyBlock<'a> {
    /// The current segment, up to the end of the block.
    near: Near<'a>,
    /// The index of the position 0.
    base_index: u32,
    /// Where the block starts.
    istart: u32,
    dict: DictSegment<'a>,
    reach: Reach,
}

impl<'a> LazyBlock<'a> {
    fn new(ms: &MatchState, src: &BlockSrc<'a>, dict_mode: DictMode) -> Result<Self> {
        let base_index = ms.window.dict_limit;
        let prefix_start = src.pos_of(base_index);
        let dict = match dict_mode {
            DictMode::NoDict => DictSegment {
                bytes: &[],
                start_index: base_index,
            },
            DictMode::ExtDict => {
                let start_index = ms.window.low_limit;
                let segment = src.dict_pos_of(start_index)..src.dict_pos_of(base_index);
                DictSegment {
                    bytes: src.dict_buf.sub(segment)?,
                    start_index,
                }
            }
            DictMode::DictMatchState => {
                let dms = src.dms.ok_or(BUG)?;
                let bytes = dms.buf.sub(dms.pos_of(dms.ms.window.dict_limit)..dms.end)?;
                DictSegment {
                    bytes,
                    start_index: base_index.wrapping_sub(bytes.len() as u32),
                }
            }
        };
        Ok(Self {
            near: Near::new(src.buf.sub(prefix_start..src.end)?)?,
            base_index,
            istart: (src.start - prefix_start) as u32,
            dict,
            reach: Reach::new(ms),
        })
    }

    /// `ZSTD_count_2segments`: how long a match is that starts at `match_pos` in the dictionary.
    #[inline(never)]
    fn count_from_dict(&self, ip: u32, match_pos: usize) -> Result<u32> {
        let bytes = self.near.bytes();
        let dict = self.dict.bytes;
        let len = count_2segments(
            bytes,
            ip as usize,
            dict,
            match_pos,
            bytes.len(),
            dict.len(),
            0,
        )?;
        Ok(len as u32)
    }
}

/// A match.
#[derive(Clone, Copy)]
struct Found {
    len: u32,
    off_base: NonZeroU32,
}

impl Found {
    /// With the first repeat offset.
    #[inline(always)]
    const fn repeat(len: u32) -> Self {
        Self {
            len,
            off_base: NonZeroU32::MIN,
        }
    }

    /// What the offset costs, in what the parsers compare matches by.
    #[inline(always)]
    const fn cost(self) -> i32 {
        highbit32(self.off_base.get()) as i32
    }

    /// What the parsers compare matches by.
    #[inline(always)]
    const fn gain(self) -> i32 {
        (self.len * 4) as i32 - self.cost()
    }
}

/// What a match has to be like for the parser to take it.
#[derive(Clone, Copy)]
struct Wanted {
    /// It is longer than this, which is at least 3.
    longer_than: u32,
    /// Its [`Found::gain`] is more than this.
    gain: i32,
}

impl Wanted {
    /// Less than the gain of any match.
    const ANY_GAIN: i32 = i32::MIN / 2;

    /// What a match has to be longer than, given that no candidate is at a higher index than `closest`. `BY_GAIN` is
    /// whether `gain` may be something else than [`Self::ANY_GAIN`].
    #[inline(always)]
    fn floor<const BY_GAIN: bool>(self, curr: u32, closest: u32) -> u32 {
        if !BY_GAIN {
            return self.longer_than;
        }
        let cost = highbit32(offset_to_offbase(curr.wrapping_sub(closest))) as i32;
        ((self.gain + cost) >> 2).max(self.longer_than as i32) as u32
    }
}

/// What became of a candidate.
#[derive(PartialEq, Eq)]
enum Offered {
    /// It is not in the segment.
    Outside,
    Considered,
    /// It goes up to the end of the block: there is nothing longer.
    Longest,
}

/// What a match has to be longer than, which is at least 3: the best one so far, if there is one.
#[derive(Clone, Copy)]
struct Best {
    len: u32,
    /// 0 if there is no match.
    off_base: u32,
}

impl Best {
    #[inline(always)]
    fn found(self) -> Option<Found> {
        Some(Found {
            len: self.len,
            off_base: NonZeroU32::new(self.off_base)?,
        })
    }
}

/// The longest match so far for a position, while candidates are compared with it.
struct Longest<'a> {
    /// The current segment, from the lowest index that a match can be at or from its start.
    segment: Near<'a>,
    /// The index of its first byte.
    start_index: u32,
    /// The position that matches are for, in `segment`.
    ip: u32,
    /// A match has to be more than 3 bytes longer than this.
    tail_start: u32,
    /// What such a match has in common with `ip`: the 4 bytes from `tail_start` on.
    tail: u32,
    /// 0 as long as there is no match.
    off_base: u32,
}

impl<'a> Longest<'a> {
    /// `None` if there is nothing after `best.len` bytes, up to the end of the block.
    #[inline(always)]
    fn new(segment: Near<'a>, start_index: u32, curr: u32, best: Best) -> Option<Self> {
        let ip = curr.wrapping_sub(start_index);
        let tail_start = best.len - 3;
        Some(Self {
            segment,
            start_index,
            ip,
            tail_start,
            tail: segment.read32(ip + tail_start)?,
            off_base: best.off_base,
        })
    }

    /// There is a match of `len` bytes.
    #[inline(always)]
    fn offer_match(&mut self, len: u32, off_base: u32) -> Offered {
        if len > self.tail_start + 3 {
            self.tail_start = len - 3;
            self.off_base = off_base;
            let Some(tail) = self.segment.read32(self.ip + self.tail_start) else {
                return Offered::Longest;
            };
            self.tail = tail;
        }
        Offered::Considered
    }

    /// There may be a match for the position `ip` of `block` at `match_pos` in its dictionary.
    #[inline(always)]
    fn offer_in_dict(
        &mut self,
        block: &LazyBlock<'_>,
        ip: u32,
        match_pos: usize,
    ) -> Result<Offered> {
        // Where the match would go on in the current segment, it takes more to tell.
        let tail_pos = match_pos + self.tail_start as usize;
        let tail = block.dict.bytes.get(tail_pos..tail_pos + 4);
        if let Some(tail) = tail.and_then(<[u8]>::first_chunk)
            && u32::from_le_bytes(*tail) != self.tail
        {
            return Ok(Offered::Considered);
        }
        let len = block.count_from_dict(ip, match_pos)?;
        let dict_len = block.base_index.wrapping_sub(block.dict.start_index);
        let offset = (ip + dict_len).wrapping_sub(match_pos as u32);
        Ok(self.offer_match(len, offset_to_offbase(offset)))
    }

    /// There may be a match at `match_index`.
    #[inline(always)]
    fn offer(&mut self, match_index: u32) -> Offered {
        let match_pos = match_index.wrapping_sub(self.start_index);
        let tail_pos = match_pos as usize + self.tail_start as usize;
        let Some(tail) = self.segment.read32_at(tail_pos) else {
            return Offered::Outside;
        };
        if tail != self.tail {
            return Offered::Considered;
        }
        let len = self.segment.count_short(self.ip, match_pos);
        self.offer_match(len, offset_to_offbase(self.ip.wrapping_sub(match_pos)))
    }

    #[inline(always)]
    const fn best(&self) -> Best {
        Best {
            len: self.tail_start + 3,
            off_base: self.off_base,
        }
    }
}

/// `ZSTD_searchMax`, with the state of the search in local variables for as long as a block lasts.
trait Finder<'a>: Sized {
    /// How far from the end of the block the last search is.
    const MARGIN: u32;

    /// `block` is at least `MARGIN` bytes.
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, block: LazyBlock<'a>) -> Result<Self>;

    /// The longest match for `ip`, the most recent one of that length, unless it is not as `wanted`. Then it may be
    /// `None` just as well. Positions are searched in increasing order. While `skipping`, those in between are not
    /// indexed.
    /// `BY_GAIN` is whether `wanted.gain` may be something else than [`Wanted::ANY_GAIN`].
    fn find<const BY_GAIN: bool>(
        &mut self,
        ip: u32,
        wanted: Wanted,
        skipping: bool,
    ) -> Result<Option<Found>>;

    /// Every position is indexed again from now on.
    fn stop_skipping(&mut self) -> Result<()>;

    /// The end of the block.
    fn finish(self) -> Result<()>;
}

// ── binary trees, for the parser ──────────────────────────────────────────

struct TreeFinder<'a, const DICT_MODE: u8> {
    ms: &'a mut MatchState,
    src: &'a BlockSrc<'a>,
    /// Where the position 0 is in `src.buf`.
    prefix_start: usize,
    mls: u32,
}

impl<'a, const DICT_MODE: u8> Finder<'a> for TreeFinder<'a, DICT_MODE> {
    const MARGIN: u32 = 8;

    #[inline(always)]
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, block: LazyBlock<'a>) -> Result<Self> {
        Ok(Self {
            mls: ms.c_params.min_match.clamp(4, 6),
            prefix_start: src.pos_of(block.base_index),
            ms,
            src,
        })
    }

    #[inline(always)]
    fn find<const BY_GAIN: bool>(
        &mut self,
        ip: u32,
        wanted: Wanted,
        _skipping: bool,
    ) -> Result<Option<Found>> {
        let ip = self.prefix_start + ip as usize;
        let iend = self.src.end;
        let mut off_base = 999_999_999u32;
        let len = match self.mls {
            4 => bt_find_best_match::<4, DICT_MODE>(self.ms, self.src, ip, iend, &mut off_base),
            5 => bt_find_best_match::<5, DICT_MODE>(self.ms, self.src, ip, iend, &mut off_base),
            _ => bt_find_best_match::<6, DICT_MODE>(self.ms, self.src, ip, iend, &mut off_base),
        }? as u32;
        if len <= wanted.longer_than {
            return Ok(None);
        }
        Ok(NonZeroU32::new(off_base).map(|off_base| Found { len, off_base }))
    }

    #[inline(always)]
    fn stop_skipping(&mut self) -> Result<()> {
        Ok(())
    }

    #[inline(always)]
    fn finish(self) -> Result<()> {
        Ok(())
    }
}

// ── hash chains ───────────────────────────────────────────────────────────

/// `ZSTD_insertAndFindFirstIndex`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the hash
/// chains.
pub(crate) fn insert_and_find_first_index(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    ip: usize,
) -> Result<()> {
    let hash_log = ms.c_params.hash_log;
    let mls = ms.c_params.min_match;
    let chain_mask = (1u32 << ms.c_params.chain_log) - 1;
    let target = prefix.index_of(ip);
    let hash_table = ms.hash_table.as_mut_slice();
    let chain_table = ms.chain_table.as_mut_slice();

    for idx in ms.next_to_update..target {
        let h = hash_ptr(prefix.buf, prefix.pos_of(idx), hash_log, mls)?;
        let next_in_chain = core::mem::replace(hash_table.at_mut(h)?, idx);
        chain_table.put((idx & chain_mask) as usize, next_in_chain)?;
    }

    ms.next_to_update = target;
    Ok(())
}

/// The hash chains of a dictionary.
#[derive(Clone, Copy)]
struct ChainDict<'a> {
    hash_table: &'a [u32],
    chain_table: &'a [u32],
    hasher: Hash8,
    /// The index, among its own, of its first byte.
    lowest_index: u32,
    /// Below this, an index is no longer in the chain table.
    min_chain: u32,
}

impl<'a> ChainDict<'a> {
    fn new(dms: &DictMatchState<'a>, mls: u32) -> Self {
        Self {
            hash_table: &dms.ms.hash_table,
            chain_table: &dms.ms.chain_table,
            hasher: Hash8::new(mls, dms.ms.c_params.hash_log, 0),
            lowest_index: dms.ms.window.dict_limit,
            min_chain: dms_end_index(dms).saturating_sub(1 << dms.ms.c_params.chain_log),
        }
    }
}

/// The hash table and the chain table.
struct Chains<'a> {
    hash_table: &'a mut [u32],
    chain_table: &'a mut [u32],
}

impl Chains<'_> {
    /// Adds the position that `bytes` is the 8 bytes of.
    #[inline(always)]
    fn insert(&mut self, hasher: Hash8, bytes: u64, index: u32) {
        let hash = hasher.of(bytes) as usize & self.hash_table.len().wrapping_sub(1);
        let in_chain = index as usize & self.chain_table.len().wrapping_sub(1);
        if let Some(first) = self.hash_table.get_mut(hash)
            && let Some(next) = self.chain_table.get_mut(in_chain)
        {
            *next = core::mem::replace(first, index);
        }
    }

    /// Adds every position that has 8 bytes in `positions`. The first one has the index `index`.
    #[inline(never)]
    fn insert_all(mut self, hasher: Hash8, positions: &[u8], mut index: u32) {
        for bytes in positions.array_windows() {
            self.insert(hasher, u64::from_le_bytes(*bytes), index);
            index = index.wrapping_add(1);
        }
    }
}

/// `ZSTD_HcFindBestMatch`
struct ChainFinder<'a, const DICT_MODE: u8> {
    block: LazyBlock<'a>,
    chains: Chains<'a>,
    hasher: Hash8,
    nb_attempts: u32,
    /// `ms.next_to_update`, as a position.
    next_to_update: u32,
    ms_next_to_update: &'a mut u32,
    dms: Option<ChainDict<'a>>,
}

impl<const DICT_MODE: u8> ChainFinder<'_, DICT_MODE> {
    /// `ZSTD_insertAndFindFirstIndex_internal`: returns the index of the first candidate for `ip`.
    #[inline(always)]
    fn insert_and_find_first_index(&mut self, ip: u32, skipping: bool) -> Result<u32> {
        let near = self.block.near;
        let first = self.next_to_update;
        let index = self.block.base_index.wrapping_add(first);
        // While skipping, not every position is inserted.
        if first.wrapping_add(1) == ip || (skipping && first < ip) {
            let bytes = near.read64(first).ok_or(BUG)?;
            self.chains.insert(self.hasher, bytes, index);
        } else if first < ip {
            let positions = near.bytes().sub(first as usize..ip as usize + 7)?;
            let chains = Chains {
                hash_table: self.chains.hash_table,
                chain_table: self.chains.chain_table,
            };
            chains.insert_all(self.hasher, positions, index);
        }
        self.next_to_update = ip;
        let hash = self.hasher.of(near.read64(ip).ok_or(BUG)?) as usize;
        Ok(table_get(self.chains.hash_table, hash))
    }
}

impl<'a, const DICT_MODE: u8> Finder<'a> for ChainFinder<'a, DICT_MODE> {
    const MARGIN: u32 = 8;

    #[inline(always)]
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, block: LazyBlock<'a>) -> Result<Self> {
        let mls = ms.c_params.min_match.clamp(4, 6);
        Ok(Self {
            block,
            chains: Chains {
                hash_table: &mut ms.hash_table,
                chain_table: &mut ms.chain_table,
            },
            hasher: Hash8::new(mls, ms.c_params.hash_log, 0),
            nb_attempts: 1 << ms.c_params.search_log,
            next_to_update: ms.next_to_update.wrapping_sub(block.base_index),
            ms_next_to_update: &mut ms.next_to_update,
            dms: src.dms.as_ref().map(|dms| ChainDict::new(dms, mls)),
        })
    }

    #[inline(always)]
    fn find<const BY_GAIN: bool>(
        &mut self,
        ip: u32,
        wanted: Wanted,
        skipping: bool,
    ) -> Result<Option<Found>> {
        let block = self.block;
        let curr = block.base_index.wrapping_add(ip);
        let low_limit = block.reach.low_limit(curr);
        let min_chain = curr.saturating_sub(self.chains.chain_table.len() as u32);
        let mut nb_attempts = self.nb_attempts;
        let mut match_index = self.insert_and_find_first_index(ip, skipping)?;
        if DICT_MODE == NO_DICT && match_index < low_limit {
            return Ok(None);
        }

        let closest = if DICT_MODE == DICT_MATCH_STATE {
            match_index.max(low_limit)
        } else {
            match_index
        };
        let start_index = if DICT_MODE == EXT_DICT {
            low_limit.max(block.base_index)
        } else {
            low_limit
        };
        let segment = block
            .near
            .tail(start_index.wrapping_sub(block.base_index))
            .ok_or(BUG)?;
        let best = Best {
            len: wanted.floor::<BY_GAIN>(curr, closest),
            off_base: 0,
        };
        let Some(mut longest) = Longest::new(segment, start_index, curr, best) else {
            return Ok(None);
        };
        while nb_attempts > 0 {
            let mut offered = longest.offer(match_index);
            if offered == Offered::Outside {
                if DICT_MODE != EXT_DICT || match_index < low_limit {
                    break;
                }
                let match_pos = (match_index - block.dict.start_index) as usize;
                offered = longest.offer_in_dict(&block, ip, match_pos)?;
            }
            if offered == Offered::Longest || match_index <= min_chain {
                break;
            }
            match_index = table_get(self.chains.chain_table, match_index as usize);
            nb_attempts -= 1;
        }

        if DICT_MODE == DICT_MATCH_STATE {
            let dms = self.dms.ok_or(BUG)?;
            let hash = dms.hasher.of(block.near.read64(ip).ok_or(BUG)?) as usize;
            match_index = dms.hash_table.at(hash)?;

            while match_index >= dms.lowest_index && nb_attempts > 0 {
                let match_pos = (match_index - dms.lowest_index) as usize;
                if longest.offer_in_dict(&block, ip, match_pos)? == Offered::Longest {
                    break;
                }
                if match_index <= dms.min_chain {
                    break;
                }
                match_index = table_get(dms.chain_table, match_index as usize);
                nb_attempts -= 1;
            }
        }

        Ok(longest.best().found())
    }

    #[inline(always)]
    fn stop_skipping(&mut self) -> Result<()> {
        Ok(())
    }

    #[inline(always)]
    fn finish(self) -> Result<()> {
        *self.ms_next_to_update = self.block.base_index.wrapping_add(self.next_to_update);
        Ok(())
    }
}

// ── row-based match finder ────────────────────────────────────────────────
//
// The hash table is made of rows of 16, 32 or 64 entries, and the tag table has one byte for each entry: 8 more bits
// of the hash of the position. A row is a circular buffer. Its entry 0 is not used, and the byte for it in the tag
// table is the "head": which entry was written last.
//
// Unlike that of the C code, the tag table may have a second byte for each entry, after the tags of the row: a hash of
// the bytes 4 to 7 of the position. An entry that has another one than the position that is searched for is a match of
// less than 8 bytes, which is often enough to know without reading what it leads to.

pub(crate) const ZSTD_ROW_HASH_TAG_BITS: u32 = 8;
const ZSTD_ROW_HASH_CACHE_MASK: u32 = ZSTD_ROW_HASH_CACHE_SIZE as u32 - 1;

/// How long a match is at least, if it has the same second tag for a reason.
const SECOND_TAG_LENGTH: u32 = 8;

/// How the tag table is laid out at the start of a frame of `src_size` bytes, if that is known.
pub(crate) const fn row_tags_at_start(
    c_params: &CompressionParameters,
    src_size: Option<u64>,
) -> RowTags {
    // In shorter rows the candidates are few, and the second tags cost more than they save. As does the memory for
    // them, for a short input.
    match src_size {
        Some(src_size) if c_params.search_log >= 6 && src_size >> c_params.hash_log != 0 => {
            RowTags::Second(SecondTagStats {
                nb_positions: 0,
                nb_ruled_out: 0,
            })
        }
        _ => RowTags::Flat,
    }
}

/// The size of the tag table that goes with a hash table of `h_size` entries.
pub(crate) const fn row_tag_table_size(tags: RowTags, h_size: usize) -> usize {
    match tags {
        RowTags::Flat => h_size,
        RowTags::Second(_) => 2 * h_size,
    }
}

/// Gives up the second tags, if there are: the tags of each row move to where they are when there are none.
fn row_flatten_tags(layout: &mut RowTags, tag_table: &mut [u8]) -> Result<()> {
    const ROW_ENTRIES: usize = 64;
    if core::mem::replace(layout, RowTags::Flat) == RowTags::Flat {
        return Ok(());
    }
    for row in 1..tag_table.len() / (2 * ROW_ENTRIES) {
        tag_table.move_within(2 * ROW_ENTRIES * row, ROW_ENTRIES * row, ROW_ENTRIES)?;
    }
    Ok(())
}

/// `ZSTD_row_nextIndex`, for every byte that a head can be.
const fn row_next_heads(row_entries: usize) -> [u8; 256] {
    let row_mask = row_entries - 1;
    let mut next_heads = [0; 256];
    let mut rest: &mut [u8] = &mut next_heads;
    let mut head = 0usize;
    while let Some((next_head, others)) = rest.split_first_mut() {
        let next = head.wrapping_sub(1) & row_mask;
        *next_head = if next == 0 { row_mask } else { next } as u8;
        rest = others;
        head += 1;
    }
    next_heads
}

/// What tells where a position goes in the tables.
#[derive(Clone, Copy)]
struct RowHash {
    /// The number of the row, and below it the tag.
    hash: u32,
    /// 0 if there are none.
    second_tag: u8,
}

/// What it takes to hash a position.
#[derive(Clone, Copy)]
struct RowHasher(Hash8);

impl RowHasher {
    /// The hash of the position that `bytes` is the 8 bytes of.
    #[inline(always)]
    const fn of<const SECOND_TAGS: bool>(self, bytes: u64) -> RowHash {
        RowHash {
            hash: self.0.of(bytes),
            // The tag depends on the first bytes already.
            second_tag: if SECOND_TAGS {
                (((bytes >> 32) as u32).wrapping_mul(2_654_435_761) >> 24) as u8
            } else {
                0
            },
        }
    }
}

/// A row of the tables.
struct Row<'a, const ROW_ENTRIES: usize> {
    indices: &'a mut [u32; ROW_ENTRIES],
    tags: &'a mut [u8; ROW_ENTRIES],
    /// If they are in use.
    second_tags: Option<&'a mut [u8; ROW_ENTRIES]>,
}

impl<const ROW_ENTRIES: usize> Row<'_, ROW_ENTRIES> {
    const NEXT_HEADS: [u8; 256] = row_next_heads(ROW_ENTRIES);

    /// Moves the head, and writes the entry that it is at.
    #[inline(always)]
    fn insert(&mut self, hash: RowHash, index: u32) {
        let Some(head) = self.tags.first_mut() else {
            return;
        };
        let next = Self::NEXT_HEADS.get(usize::from(*head)).copied();
        let next = next.unwrap_or(1);
        *head = next;
        let next = usize::from(next) & (ROW_ENTRIES - 1);
        if let Some(tag) = self.tags.get_mut(next) {
            *tag = hash.hash as u8;
        }
        if let Some(second_tags) = &mut self.second_tags
            && let Some(second_tag) = second_tags.get_mut(next)
        {
            *second_tag = hash.second_tag;
        }
        if let Some(entry) = self.indices.get_mut(next) {
            *entry = index;
        }
    }
}

/// Where the row for `hash` starts in the hash table.
#[inline(always)]
const fn rel_row<const ROW_ENTRIES: usize>(hash: u32) -> usize {
    ((hash >> ZSTD_ROW_HASH_TAG_BITS) as usize) << ROW_ENTRIES.trailing_zeros()
}

/// Where it starts in the tag table.
#[inline(always)]
const fn rel_tag_row<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(hash: u32) -> usize {
    if SECOND_TAGS {
        2 * rel_row::<ROW_ENTRIES>(hash)
    } else {
        rel_row::<ROW_ENTRIES>(hash)
    }
}

/// The hash table and the tag table.
struct Rows<'a> {
    indices: &'a mut [u32],
    tags: &'a mut [u8],
}

impl Rows<'_> {
    /// The row for `hash`.
    #[inline(always)]
    fn row<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(
        &mut self,
        hash: u32,
    ) -> Option<Row<'_, ROW_ENTRIES>> {
        let start = rel_row::<ROW_ENTRIES>(hash);
        let indices = self.indices.get_mut(start..start + ROW_ENTRIES)?;
        let start = rel_tag_row::<ROW_ENTRIES, SECOND_TAGS>(hash);
        let (tags, second_tags) = if SECOND_TAGS {
            let tags = self.tags.get_mut(start..start + 2 * ROW_ENTRIES)?;
            let (tags, second_tags) = tags.split_at_mut_checked(ROW_ENTRIES)?;
            (tags, Some(second_tags.first_chunk_mut()?))
        } else {
            (self.tags.get_mut(start..start + ROW_ENTRIES)?, None)
        };
        Some(Row {
            indices: indices.first_chunk_mut()?,
            tags: tags.first_chunk_mut()?,
            second_tags,
        })
    }

    /// `ZSTD_row_prefetch`: of the row for `hash`.
    #[inline(always)]
    fn prefetch<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(&self, hash: u32) {
        row_prefetch::<ROW_ENTRIES, SECOND_TAGS>(self.indices, self.tags, hash);
    }
}

/// `ZSTD_row_prefetch`: of the row for `hash`.
#[inline(always)]
fn row_prefetch<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(
    indices: &[u32],
    tags: &[u8],
    hash: u32,
) {
    if ROW_ENTRIES == 16 {
        // Somewhere in the row, which is no more than a cache line.
        let entry = (hash >> (ZSTD_ROW_HASH_TAG_BITS - 4)) as usize;
        prefetch_l1(indices, entry);
        prefetch_l1(tags, entry);
        return;
    }
    let start = rel_row::<ROW_ENTRIES>(hash);
    prefetch_l1(indices, start);
    prefetch_l1(indices, start + 16);
    let start = rel_tag_row::<ROW_ENTRIES, SECOND_TAGS>(hash);
    prefetch_l1(tags, start);
    if SECOND_TAGS {
        prefetch_l1(tags, start + ROW_ENTRIES);
    }
}

/// `ZSTD_row_update`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the rows of the
/// row-based match finder.
pub(crate) fn row_update(ms: &mut MatchState, prefix: Prefix<'_>, ip: usize) -> Result<()> {
    #[inline(always)]
    fn update<const ROW_ENTRIES: usize>(
        mut rows: Rows<'_>,
        hasher: RowHasher,
        prefix: Prefix<'_>,
        indices: Range<u32>,
    ) -> Result<()> {
        for idx in indices {
            let hash = hasher.of::<false>(read_le64(prefix.buf, prefix.pos_of(idx))?);
            rows.row::<ROW_ENTRIES, false>(hash.hash)
                .ok_or(BUG)?
                .insert(hash, idx);
        }
        Ok(())
    }

    row_flatten_tags(&mut ms.row_tags, &mut ms.tag_table)?;
    let mls = ms.c_params.min_match.min(6);
    let hash_bits = ms.row_hash_log + ZSTD_ROW_HASH_TAG_BITS;
    let hasher = RowHasher(Hash8::new(mls, hash_bits, ms.hash_salt));
    let rows = Rows {
        indices: &mut ms.hash_table,
        tags: &mut ms.tag_table,
    };
    let target = prefix.index_of(ip);
    let indices = ms.next_to_update..target;
    ms.next_to_update = target;
    match ms.c_params.search_log.clamp(4, 6) {
        4 => update::<16>(rows, hasher, prefix, indices),
        5 => update::<32>(rows, hasher, prefix, indices),
        _ => update::<64>(rows, hasher, prefix, indices),
    }
}

/// Bit `n` is set if the entry `n` has the tag `tag`. This becomes a comparison of vectors.
#[inline(always)]
fn tags_match_mask(tags: &[u8; 16], tag: u8) -> u32 {
    let mut matches = 0u16;
    for (n, &entry) in tags.iter().enumerate() {
        matches |= u16::from(entry == tag) << n;
    }
    u32::from(matches)
}

/// Bit `n` is set if the entry `n` has the tag `tag`.
#[inline(always)]
fn row_tags_match_mask<const ROW_ENTRIES: usize>(tags: &[u8; ROW_ENTRIES], tag: u8) -> u64 {
    match *tags.as_chunks::<16>().0 {
        [ref tags] => u64::from(tags_match_mask(tags, tag)),
        [ref low, ref high] => {
            u64::from(tags_match_mask(low, tag) | tags_match_mask(high, tag) << 16)
        }
        [ref tags_0, ref tags_1, ref tags_2, ref tags_3] => {
            let low = tags_match_mask(tags_0, tag) | tags_match_mask(tags_1, tag) << 16;
            let high = tags_match_mask(tags_2, tag) | tags_match_mask(tags_3, tag) << 16;
            u64::from(low) | u64::from(high) << 32
        }
        _ => 0,
    }
}

/// `ZSTD_row_getMatchMask`: bit `n` is set if the entry `(head + n) % ROW_ENTRIES` has the tag `tag`.
#[inline(always)]
fn row_get_match_mask<const ROW_ENTRIES: usize>(
    tags: &[u8; ROW_ENTRIES],
    tag: u8,
    head: u32,
) -> u64 {
    let matches = row_tags_match_mask(tags, tag);
    match ROW_ENTRIES {
        16 => u64::from((matches as u16).rotate_right(head)),
        32 => u64::from((matches as u32).rotate_right(head)),
        _ => matches.rotate_right(head),
    }
}

/// [`row_get_match_mask`]. On its own, it stays a comparison of vectors.
#[inline(never)]
fn row_get_second_match_mask<const ROW_ENTRIES: usize>(
    tags: &[u8; ROW_ENTRIES],
    tag: u8,
    head: u32,
) -> u64 {
    row_get_match_mask(tags, tag, head)
}

/// The bits of [`row_get_match_mask`], but for the one of the entry 0.
#[inline(always)]
const fn row_entries_mask<const ROW_ENTRIES: usize>(head: u32) -> u64 {
    !(1 << (head.wrapping_neg() & (ROW_ENTRIES as u32 - 1)))
}

/// The rows of a dictionary.
#[derive(Clone, Copy)]
struct RowDict<'a> {
    indices: &'a [u32],
    tags: &'a [u8],
    hasher: Hash8,
    /// The index, among its own, of its first byte.
    lowest_index: u32,
}

impl<'a> RowDict<'a> {
    fn new(dms: &DictMatchState<'a>, mls: u32) -> Self {
        Self {
            indices: &dms.ms.hash_table,
            tags: &dms.ms.tag_table,
            hasher: Hash8::new(mls, dms.ms.row_hash_log + ZSTD_ROW_HASH_TAG_BITS, 0),
            lowest_index: dms.ms.window.dict_limit,
        }
    }
}

/// The tables of the row-based match finder, and what it takes to add to them.
struct RowIndex<'a> {
    rows: Rows<'a>,
    /// The hashes of the 8 positions from `next_to_update` on, each at its index modulo 8.
    hash_cache: [u32; ZSTD_ROW_HASH_CACHE_SIZE],
    second_tag_cache: [u8; ZSTD_ROW_HASH_CACHE_SIZE],
    hasher: RowHasher,
    near: Near<'a>,
    base_index: u32,
    /// `ms.next_to_update`, as a position.
    next_to_update: u32,
}

impl RowIndex<'_> {
    /// `ZSTD_row_nextCachedHash`: the hash of `pos`, from the cache, where `new_hash` takes its place: the hash of the
    /// position 8 bytes further.
    #[inline(always)]
    fn next_cached_hash<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(
        &mut self,
        pos: u32,
        new_hash: RowHash,
    ) -> RowHash {
        self.rows
            .prefetch::<ROW_ENTRIES, SECOND_TAGS>(new_hash.hash);
        let cached = (self.base_index.wrapping_add(pos) & ZSTD_ROW_HASH_CACHE_MASK) as usize;
        let (Some(hash), Some(second_tag)) = (
            self.hash_cache.get_mut(cached),
            self.second_tag_cache.get_mut(cached),
        ) else {
            return new_hash;
        };
        RowHash {
            hash: core::mem::replace(hash, new_hash.hash),
            second_tag: if SECOND_TAGS {
                core::mem::replace(second_tag, new_hash.second_tag)
            } else {
                0
            },
        }
    }

    /// `ZSTD_row_fillHashCache`: the hashes of the 8 positions from `next_to_update` on, or fewer so as not to go past
    /// `limit`.
    #[inline(never)]
    fn fill_hash_cache<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(
        &mut self,
        limit: u32,
    ) -> Option<()> {
        let from = self.next_to_update;
        let max_elems = (limit + 1).saturating_sub(from);
        for pos in from..from + max_elems.min(ZSTD_ROW_HASH_CACHE_SIZE as u32) {
            let hash = self.hasher.of::<SECOND_TAGS>(self.near.read64(pos)?);
            self.next_cached_hash::<ROW_ENTRIES, SECOND_TAGS>(pos, hash);
        }
        Some(())
    }

    /// `ZSTD_row_update_internalImpl`: inserts the positions from `next_to_update` up to `end`.
    #[inline(always)]
    fn insert_up_to<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(
        &mut self,
        end: u32,
    ) -> Option<()> {
        let bytes = self.near.bytes();
        if end as usize + 2 * ZSTD_ROW_HASH_CACHE_SIZE > bytes.len() {
            return None;
        }
        for pos in self.next_to_update..end {
            let ahead = pos as usize + ZSTD_ROW_HASH_CACHE_SIZE;
            let ahead = bytes.get(ahead..ahead + 8)?.first_chunk()?;
            let new_hash = self.hasher.of::<SECOND_TAGS>(u64::from_le_bytes(*ahead));
            let hash = self.next_cached_hash::<ROW_ENTRIES, SECOND_TAGS>(pos, new_hash);
            let index = self.base_index.wrapping_add(pos);
            self.rows
                .row::<ROW_ENTRIES, SECOND_TAGS>(hash.hash)?
                .insert(hash, index);
        }
        self.next_to_update = end;
        Some(())
    }

    /// `ZSTD_row_update_internal`: inserts the positions from `next_to_update` up to `ip`, but not all of them if they
    /// are many.
    #[inline(always)]
    fn update<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(&mut self, ip: u32) -> Option<()> {
        const K_SKIP_THRESHOLD: u32 = 384;

        if ip.wrapping_sub(self.next_to_update) > K_SKIP_THRESHOLD {
            self.skip::<ROW_ENTRIES, SECOND_TAGS>(ip)?;
        }
        self.insert_up_to::<ROW_ENTRIES, SECOND_TAGS>(ip)
    }

    /// The part of `ZSTD_row_update_internal` for a long way up to `ip`.
    #[cold]
    #[inline(never)]
    fn skip<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(&mut self, ip: u32) -> Option<()> {
        const K_MAX_MATCH_START_POSITIONS_TO_UPDATE: u32 = 96;
        const K_MAX_MATCH_END_POSITIONS_TO_UPDATE: u32 = 32;

        let end = self.next_to_update + K_MAX_MATCH_START_POSITIONS_TO_UPDATE;
        self.insert_up_to::<ROW_ENTRIES, SECOND_TAGS>(end)?;
        self.next_to_update = ip - K_MAX_MATCH_END_POSITIONS_TO_UPDATE;
        self.fill_hash_cache::<ROW_ENTRIES, SECOND_TAGS>(ip + 1)
    }
}

/// The entries of a row that may be matches for a position.
#[derive(Clone, Copy)]
struct RowCandidates<'a, const ROW_ENTRIES: usize> {
    indices: &'a [u32; ROW_ENTRIES],
    head: u32,
    /// See [`row_get_match_mask`].
    matches: u64,
}

impl<const ROW_ENTRIES: usize> RowCandidates<'_, ROW_ENTRIES> {
    /// The most recent one. There is one.
    #[inline(always)]
    fn first(&self) -> u32 {
        let entry = (self.head + self.matches.trailing_zeros()) as usize & (ROW_ENTRIES - 1);
        self.indices.get(entry).copied().unwrap_or(0)
    }

    #[inline(always)]
    const fn remove_first(&mut self) {
        self.matches &= self.matches.wrapping_sub(1);
    }
}

/// What the row-based match finder looks for matches in.
struct RowSearch<'a> {
    block: LazyBlock<'a>,
    nb_attempts: u32,
    dms: Option<RowDict<'a>>,
    /// How many candidates the second tags ruled out.
    nb_ruled_out: u32,
}

impl RowSearch<'_> {
    /// The part of `ZSTD_RowFindBestMatch` that follows the update of the tables. `candidates` is the entries of the
    /// row that have the tag of `ip`, and `long_matches` those that have its second tag as well, if there are second
    /// tags. `dict_hash` is the hash of `ip` for the rows of the dictionary, if there are. See [`Finder::find`].
    #[inline(always)]
    fn longest_match<const ROW_ENTRIES: usize, const DICT_MODE: u8, const BY_GAIN: bool>(
        &mut self,
        mut candidates: RowCandidates<'_, ROW_ENTRIES>,
        long_matches: Option<u64>,
        dict_hash: u32,
        ip: u32,
        wanted: Wanted,
    ) -> Option<Found> {
        let block = &self.block;
        let matches = candidates.matches;
        let curr = block.base_index.wrapping_add(ip);
        let low_limit = block.reach.low_limit(curr);
        let closest = if DICT_MODE == DICT_MATCH_STATE {
            candidates.first().max(low_limit)
        } else {
            candidates.first()
        };
        let start_index = if DICT_MODE == EXT_DICT {
            low_limit.max(block.base_index)
        } else {
            low_limit
        };
        let segment = block
            .near
            .tail(start_index.wrapping_sub(block.base_index))?;
        let floor = Best {
            len: wanted.floor::<BY_GAIN>(curr, closest),
            off_base: 0,
        };

        // If there is a match that long, the others are of no interest.
        if let Some(long_matches) = long_matches
            && (long_matches != 0 || floor.len + 1 >= SECOND_TAG_LENGTH)
        {
            candidates.matches = long_matches;
            self.nb_ruled_out += (matches ^ long_matches).count_ones();
        }

        loop {
            let mut longest = Longest::new(segment, start_index, curr, floor)?;
            let mut nb_attempts = self.nb_attempts;
            let all = candidates.matches == matches;

            while candidates.matches != 0 && nb_attempts > 0 {
                let match_index = candidates.first();
                candidates.remove_first();
                let mut offered = longest.offer(match_index);
                if offered == Offered::Outside {
                    if DICT_MODE != EXT_DICT || match_index < low_limit {
                        break;
                    }
                    let match_pos = (match_index - block.dict.start_index) as usize;
                    offered = longest.offer_in_dict(block, ip, match_pos).ok()?;
                }
                if offered == Offered::Longest {
                    return longest.best().found();
                }
                nb_attempts -= 1;
            }

            if DICT_MODE == DICT_MATCH_STATE {
                self.longest_dict_match::<ROW_ENTRIES>(dict_hash, ip, nb_attempts, &mut longest)?;
            }
            let best = longest.best();
            if all || best.len >= SECOND_TAG_LENGTH || floor.len + 1 >= SECOND_TAG_LENGTH {
                return best.found();
            }
            // The second tags were the same for no reason.
            candidates.matches = matches;
        }
    }

    /// The part of `ZSTD_RowFindBestMatch` that searches the dictionary.
    #[inline(always)]
    fn longest_dict_match<const ROW_ENTRIES: usize>(
        &self,
        hash: u32,
        ip: u32,
        mut nb_attempts: u32,
        longest: &mut Longest<'_>,
    ) -> Option<()> {
        let block = &self.block;
        let dms = self.dms?;
        let start = rel_row::<ROW_ENTRIES>(hash);
        let tags = dms.tags.get(start..start + ROW_ENTRIES)?;
        let tags = tags.first_chunk::<ROW_ENTRIES>()?;
        let indices = dms.indices.get(start..start + ROW_ENTRIES)?;
        let head = u32::from(*tags.first()?) & (ROW_ENTRIES as u32 - 1);
        let matches = row_get_match_mask(tags, hash as u8, head);
        let mut candidates = RowCandidates {
            indices: indices.first_chunk::<ROW_ENTRIES>()?,
            head,
            matches: matches & row_entries_mask::<ROW_ENTRIES>(head),
        };

        while candidates.matches != 0 && nb_attempts > 0 {
            let match_index = candidates.first();
            candidates.remove_first();
            if match_index < dms.lowest_index {
                break;
            }
            nb_attempts -= 1;
            let match_pos = (match_index - dms.lowest_index) as usize;
            if longest.offer_in_dict(block, ip, match_pos).ok()? == Offered::Longest {
                break;
            }
        }
        Some(())
    }
}

/// What the row-based match finder leaves in the match state at the end of a block.
struct RowsSaved<'a> {
    next_to_update: &'a mut u32,
    hash_salt_entropy: &'a mut u32,
    tags: &'a mut RowTags,
}

/// The state of [`RowFinder`], which does not depend on the size of the rows.
struct RowState<'a> {
    index: RowIndex<'a>,
    search: RowSearch<'a>,
    hash_salt_entropy: u32,
    saved: RowsSaved<'a>,
}

impl<'a> RowState<'a> {
    fn new(ms: &'a mut MatchState, src: &BlockSrc<'a>, block: LazyBlock<'a>) -> Self {
        let mls = ms.c_params.min_match.clamp(4, 6);
        let hash_bits = ms.row_hash_log + ZSTD_ROW_HASH_TAG_BITS;
        Self {
            index: RowIndex {
                rows: Rows {
                    indices: &mut ms.hash_table,
                    tags: &mut ms.tag_table,
                },
                hash_cache: [0; ZSTD_ROW_HASH_CACHE_SIZE],
                second_tag_cache: [0; ZSTD_ROW_HASH_CACHE_SIZE],
                hasher: RowHasher(Hash8::new(mls, hash_bits, ms.hash_salt)),
                near: block.near,
                base_index: block.base_index,
                next_to_update: ms.next_to_update.wrapping_sub(block.base_index),
            },
            search: RowSearch {
                block,
                // There are no more searches than entries in a row.
                nb_attempts: 1 << ms.c_params.search_log.min(6),
                dms: src.dms.as_ref().map(|dms| RowDict::new(dms, mls)),
                nb_ruled_out: 0,
            },
            hash_salt_entropy: ms.hash_salt_entropy,
            saved: RowsSaved {
                next_to_update: &mut ms.next_to_update,
                hash_salt_entropy: &mut ms.hash_salt_entropy,
                tags: &mut ms.row_tags,
            },
        }
    }

    /// The end of a block.
    fn finish(self) -> Result<()> {
        let Self {
            index,
            search,
            hash_salt_entropy,
            saved,
        } = self;
        *saved.next_to_update = index.base_index.wrapping_add(index.next_to_update);
        *saved.hash_salt_entropy = hash_salt_entropy;
        if let RowTags::Second(stats) = saved.tags {
            stats.nb_positions += u64::from(search.block.near.len() - search.block.istart);
            stats.nb_ruled_out += u64::from(search.nb_ruled_out);
            // Below that, the second tags cost more than they save.
            if 2 * stats.nb_ruled_out < 5 * stats.nb_positions {
                row_flatten_tags(saved.tags, index.rows.tags)?;
            }
        }
        Ok(())
    }
}

/// `ZSTD_RowFindBestMatch`
struct RowFinder<'a, const ROW_ENTRIES: usize, const SECOND_TAGS: bool, const DICT_MODE: u8>(
    RowState<'a>,
);

impl<'a, const ROW_ENTRIES: usize, const SECOND_TAGS: bool, const DICT_MODE: u8> Finder<'a>
    for RowFinder<'a, ROW_ENTRIES, SECOND_TAGS, DICT_MODE>
{
    const MARGIN: u32 = 8 + ZSTD_ROW_HASH_CACHE_SIZE as u32;

    #[inline(always)]
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, block: LazyBlock<'a>) -> Result<Self> {
        let mut finder = Self(RowState::new(ms, src, block));
        finder.stop_skipping()?;
        Ok(finder)
    }

    #[inline(always)]
    fn find<const BY_GAIN: bool>(
        &mut self,
        ip: u32,
        wanted: Wanted,
        skipping: bool,
    ) -> Result<Option<Found>> {
        let RowState {
            index,
            search,
            hash_salt_entropy,
            ..
        } = &mut self.0;

        let mut dict_hash = 0;
        if DICT_MODE == DICT_MATCH_STATE {
            let dms = search.dms.ok_or(BUG)?;
            dict_hash = dms.hasher.of(index.near.read64(ip).ok_or(BUG)?);
            row_prefetch::<ROW_ENTRIES, false>(dms.indices, dms.tags, dict_hash);
        }

        // Update the tables up to, and not including, `ip`.
        let hash = if skipping {
            let bytes = index.near.read64(ip).ok_or(BUG)?;
            index.hasher.of::<SECOND_TAGS>(bytes)
        } else {
            if index.next_to_update != ip {
                index.update::<ROW_ENTRIES, SECOND_TAGS>(ip).ok_or(BUG)?;
            }
            let ahead = index.near.read64(ip + ZSTD_ROW_HASH_CACHE_SIZE as u32);
            let new_hash = index.hasher.of::<SECOND_TAGS>(ahead.ok_or(BUG)?);
            index.next_cached_hash::<ROW_ENTRIES, SECOND_TAGS>(ip, new_hash)
        };
        *hash_salt_entropy = hash_salt_entropy.wrapping_add(hash.hash);
        index.next_to_update = ip + 1;

        let mut row = index
            .rows
            .row::<ROW_ENTRIES, SECOND_TAGS>(hash.hash)
            .ok_or(BUG)?;
        let head = u32::from(*row.tags.first().ok_or(BUG)?) & (ROW_ENTRIES as u32 - 1);
        let matches = row_get_match_mask(row.tags, hash.hash as u8, head)
            & row_entries_mask::<ROW_ENTRIES>(head);
        let curr = index.base_index.wrapping_add(ip);
        if DICT_MODE != DICT_MATCH_STATE && matches == 0 {
            row.insert(hash, curr);
            return Ok(None);
        }
        let candidates = RowCandidates {
            indices: row.indices,
            head,
            matches,
        };
        let second_tags = row.second_tags.as_ref();
        let long_matches = second_tags
            .map(|tags| matches & row_get_second_match_mask(tags, hash.second_tag, head));
        let found = search.longest_match::<ROW_ENTRIES, DICT_MODE, BY_GAIN>(
            candidates,
            long_matches,
            dict_hash,
            ip,
            wanted,
        );
        row.insert(hash, curr);
        Ok(found)
    }

    #[inline(always)]
    fn stop_skipping(&mut self) -> Result<()> {
        let ilimit = self.0.index.near.len() - Self::MARGIN;
        self.0
            .index
            .fill_hash_cache::<ROW_ENTRIES, SECOND_TAGS>(ilimit)
            .ok_or(BUG)
    }

    #[inline(always)]
    fn finish(self) -> Result<()> {
        self.0.finish()
    }
}

// ── the parsers ───────────────────────────────────────────────────────────

/// How long a match the repeat offset `offset` gives at `ip`: at least 4, or 0 if it gives none.
#[inline(always)]
fn rep_length<const DICT_MODE: u8>(block: &LazyBlock<'_>, ip: u32, offset: u32) -> Result<u32> {
    let near = block.near;
    let ip_bytes = near.read32(ip).ok_or(BUG)?;
    if DICT_MODE == NO_DICT {
        let rep_match = ip.wrapping_sub(offset);
        if offset > 0 && near.read32(rep_match) == Some(ip_bytes) {
            return Ok(near.count(ip + 4, rep_match + 4) + 4);
        }
        return Ok(0);
    }

    let curr = block.base_index.wrapping_add(ip);
    let rep_index = curr.wrapping_sub(offset);
    if !index_overlap_check(block.base_index, rep_index) {
        return Ok(0);
    }
    // The offset may lead to what is no longer in the window.
    if DICT_MODE == EXT_DICT && offset > curr.wrapping_sub(block.reach.low_limit(curr)) {
        return Ok(0);
    }
    if rep_index < block.base_index {
        let rep_match = rep_index.wrapping_sub(block.dict.start_index) as usize;
        if read_le32(block.dict.bytes, rep_match)? != ip_bytes {
            return Ok(0);
        }
        return Ok(block.count_from_dict(ip + 4, rep_match + 4)? + 4);
    }
    let rep_match = rep_index - block.base_index;
    if near.read32(rep_match) != Some(ip_bytes) {
        return Ok(0);
    }
    Ok(near.count(ip + 4, rep_match + 4) + 4)
}

/// The repeat offsets at the start of a block.
struct Offsets {
    offset_1: u32,
    offset_2: u32,
    /// What they were, for those that are too far to be of use and are 0.
    saved_1: u32,
    saved_2: u32,
}

/// Where the parser starts in a block, and with what.
struct Start {
    ip: u32,
    offsets: Offsets,
}

impl Start {
    fn new(
        ms: &MatchState,
        block: &LazyBlock<'_>,
        rep: &[u32; ZSTD_REP_NUM],
        dict_mode: DictMode,
    ) -> Self {
        let [offset_1, offset_2, _] = *rep;
        let mut offsets = Offsets {
            offset_1,
            offset_2,
            saved_1: 0,
            saved_2: 0,
        };
        // As in the C code, what counts as nothing to refer to is not the same in all modes.
        let nothing_before =
            block.istart == 0 && (dict_mode == DictMode::ExtDict || block.dict.bytes.is_empty());
        let ip = block.istart + u32::from(nothing_before);
        if dict_mode == DictMode::NoDict {
            let curr = block.base_index.wrapping_add(ip);
            let window_low = ms.get_lowest_prefix_index(curr, ms.c_params.window_log);
            let max_rep = curr - window_low;
            if offset_2 > max_rep {
                offsets.saved_2 = offset_2;
                offsets.offset_2 = 0;
            }
            if offset_1 > max_rep {
                offsets.saved_1 = offset_1;
                offsets.offset_1 = 0;
            }
        }
        Self { ip, offsets }
    }
}

/// `ZSTD_compressBlock_lazy_generic` and `ZSTD_compressBlock_lazy_extDict_generic`. `DEPTH` is how many positions
/// further a better match is looked for, once there is one.
#[inline(never)]
fn compress_block_lazy_generic<'a, F: Finder<'a>, const DEPTH: u32, const DICT_MODE: u8>(
    args: LazyArgs<'a>,
) -> Result<usize> {
    let LazyArgs {
        ms,
        seq_store,
        rep,
        src,
        block,
        start,
    } = args;
    let block = &block;
    let near = block.near;
    let Some(ilimit) = near.len().checked_sub(F::MARGIN) else {
        // There is no position to search, nor to hash.
        return Ok((near.len() - block.istart) as usize);
    };
    let mut finder = F::new(ms, src, *block)?;
    let mut seq_store = SeqSink::new(seq_store);
    let mut ip = start.ip;
    let mut anchor = block.istart;
    let Offsets {
        mut offset_1,
        mut offset_2,
        saved_1,
        mut saved_2,
    } = start.offsets;
    let mut skipping = false;

    'parse: while ip < ilimit {
        // Check the repeat offset.
        let mut best = Found::repeat(rep_length::<DICT_MODE>(block, ip + 1, offset_1)?);
        let mut start = ip + 1;

        if DEPTH > 0 || best.len == 0 {
            // How many positions were searched since the last match that was taken, that one included.
            let mut since_best = 0;
            let mut wanted = Wanted {
                longer_than: best.len.max(3),
                gain: Wanted::ANY_GAIN,
            };

            loop {
                since_best += 1;
                let found = if DEPTH > 0 {
                    finder.find::<true>(ip, wanted, skipping)?
                } else {
                    finder.find::<false>(ip, wanted, skipping)?
                };
                if let Some(found) = found
                    && (DEPTH == 0 || found.gain() > wanted.gain)
                {
                    best = found;
                    start = ip;
                    since_best = 1;
                }

                if best.len < 4 {
                    // Jump faster over incompressible sections.
                    let step = (ip - anchor) >> K_SEARCH_STRENGTH;
                    ip += step + 1;
                    // Far into one, positions are no longer all inserted: it is faster, and keeps positions that are
                    // of no use out of the tables. As in the C code, it does not start at the same step in all modes.
                    skipping = if DICT_MODE == EXT_DICT {
                        step > K_LAZY_SKIPPING_STEP
                    } else {
                        step + 1 > K_LAZY_SKIPPING_STEP
                    };
                    continue 'parse;
                }

                // Look for something better at the next positions.
                if since_best > DEPTH || ip >= ilimit {
                    break;
                }
                ip += 1;
                let rep_len = rep_length::<DICT_MODE>(block, ip, offset_1)?;
                let weight = 2 + since_best;
                let gain2 = (rep_len * weight) as i32;
                let gain1 = (best.len * weight) as i32 - best.cost() + 1;
                if rep_len >= 4 && gain2 > gain1 {
                    best = Found::repeat(rep_len);
                    start = ip;
                }
                wanted = Wanted {
                    longer_than: 3,
                    gain: best.gain() + 1 + 3 * since_best as i32,
                };
            }

            // Catch up: the match may start earlier.
            if offbase_is_offset(best.off_base.get()) {
                let offset = offbase_to_offset(best.off_base.get());
                let match_index = block.base_index.wrapping_add(start).wrapping_sub(offset);
                let (segment, mut match_pos) =
                    if DICT_MODE != NO_DICT && match_index < block.base_index {
                        (block.dict.bytes, match_index - block.dict.start_index)
                    } else {
                        (near.bytes(), start - offset)
                    };
                while start > anchor
                    && match_pos > 0
                    && near.read8(start - 1) == segment.get(match_pos as usize - 1).copied()
                {
                    start -= 1;
                    match_pos -= 1;
                    best.len += 1;
                }
                offset_2 = offset_1;
                offset_1 = offset;
            }
        }

        // Store the sequence.
        seq_store.store_seq(start - anchor, near, anchor, best.off_base.get(), best.len)?;
        ip = start + best.len;
        anchor = ip;

        if skipping {
            // There was a match: every position is inserted again.
            finder.stop_skipping()?;
            skipping = false;
        }

        // Check the second repeat offset right away.
        while ip <= ilimit {
            let rep_len = rep_length::<DICT_MODE>(block, ip, offset_2)?;
            if rep_len == 0 {
                break;
            }
            (offset_1, offset_2) = (offset_2, offset_1);
            seq_store.store_seq(0, near, anchor, REPCODE1_TO_OFFBASE, rep_len)?;
            ip += rep_len;
            anchor = ip;
        }
    }
    finder.finish()?;

    // If `offset_1` was not valid at first and now is, what it was becomes the second repeat offset.
    if saved_1 != 0 && offset_1 != 0 {
        saved_2 = saved_1;
    }

    // Save the repeat offsets for the next block.
    let [rep_0, rep_1, _] = rep;
    *rep_0 = if offset_1 != 0 { offset_1 } else { saved_1 };
    *rep_1 = if offset_2 != 0 { offset_2 } else { saved_2 };

    // The size of the last literals.
    Ok((near.len() - anchor) as usize)
}

/// What [`compress_block_lazy_generic`] works on.
struct LazyArgs<'a> {
    ms: &'a mut MatchState,
    seq_store: &'a mut SeqStore,
    rep: &'a mut [u32; ZSTD_REP_NUM],
    src: &'a BlockSrc<'a>,
    block: LazyBlock<'a>,
    start: Start,
}

/// [`compress_block_lazy_generic`], with the hash chains or the rows.
#[inline(always)]
fn compress_block_lazy_hashed<const DEPTH: u32, const DICT_MODE: u8>(
    args: LazyArgs<'_>,
    use_row: bool,
) -> Result<usize> {
    if !use_row {
        return compress_block_lazy_generic::<ChainFinder<DICT_MODE>, DEPTH, DICT_MODE>(args);
    }
    // With a dictionary, the second tags are given up: how many candidates there are matters if it is searched next.
    if DICT_MODE != NO_DICT {
        row_flatten_tags(&mut args.ms.row_tags, &mut args.ms.tag_table)?;
    }
    match (args.ms.c_params.search_log.clamp(4, 6), args.ms.row_tags) {
        (4, _) => {
            compress_block_lazy_generic::<RowFinder<16, false, DICT_MODE>, DEPTH, DICT_MODE>(args)
        }
        (5, _) => {
            compress_block_lazy_generic::<RowFinder<32, false, DICT_MODE>, DEPTH, DICT_MODE>(args)
        }
        (_, RowTags::Flat) => {
            compress_block_lazy_generic::<RowFinder<64, false, DICT_MODE>, DEPTH, DICT_MODE>(args)
        }
        (_, RowTags::Second(_)) => {
            compress_block_lazy_generic::<RowFinder<64, true, NO_DICT>, DEPTH, NO_DICT>(args)
        }
    }
}

/// [`compress_block_lazy`], for a mode that is a constant.
#[inline(always)]
fn compress_block_lazy_any_strategy<const DICT_MODE: u8>(
    args: LazyArgs<'_>,
    strategy: Strategy,
    use_row: bool,
) -> Result<usize> {
    match strategy {
        Strategy::Greedy => compress_block_lazy_hashed::<0, DICT_MODE>(args, use_row),
        Strategy::Lazy => compress_block_lazy_hashed::<1, DICT_MODE>(args, use_row),
        Strategy::Lazy2 => compress_block_lazy_hashed::<2, DICT_MODE>(args, use_row),
        Strategy::BtLazy2 if !use_row => {
            compress_block_lazy_generic::<TreeFinder<DICT_MODE>, 2, DICT_MODE>(args)
        }
        _ => Err(BUG),
    }
}

/// `ZSTD_compressBlock_greedy`, `ZSTD_compressBlock_lazy2_dictMatchState_row` and all the others of the file:
/// `strategy` is one of the four, and `use_row` is false for `btlazy2`.
pub(crate) fn compress_block_lazy(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    strategy: Strategy,
    use_row: bool,
    dict_mode: DictMode,
) -> Result<usize> {
    let block = LazyBlock::new(ms, src, dict_mode)?;
    let args = LazyArgs {
        start: Start::new(ms, &block, rep, dict_mode),
        ms,
        seq_store,
        rep,
        src,
        block,
    };
    match dict_mode {
        DictMode::NoDict => compress_block_lazy_any_strategy::<NO_DICT>(args, strategy, use_row),
        DictMode::ExtDict => compress_block_lazy_any_strategy::<EXT_DICT>(args, strategy, use_row),
        DictMode::DictMatchState => {
            compress_block_lazy_any_strategy::<DICT_MATCH_STATE>(args, strategy, use_row)
        }
    }
}
