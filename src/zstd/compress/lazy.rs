//! `zstd_lazy.c`: the `greedy`, `lazy`, `lazy2` and `btlazy2` strategies.

use core::hint::{Locality, prefetch_read};

use super::internal::{
    BlockSrc, DictMatchState, DictMode, K_SEARCH_STRENGTH, MatchState, Prefix, REPCODE1_TO_OFFBASE,
    SeqStore, Strategy, ZSTD_DUBT_UNSORTED_MARK, ZSTD_ROW_HASH_CACHE_SIZE, count, count_2segments,
    hash_ptr, hash_ptr_salted, index_overlap_check, offbase_is_offset, offbase_to_offset,
    offset_to_offbase,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::Result;
use crate::util::{BUG, SliceExt, highbit32, read_le32};

const K_LAZY_SKIPPING_STEP: usize = 8;

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

/// `ZSTD_insertDUBT1`: sorts the position `curr`, which is in a tree but unsorted. `curr` is at least `bt_low`.
fn insert_dubt1<const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    curr: u32,
    input_end: usize,
    mut nb_compares: u32,
    bt_low: u32,
) -> Result<()> {
    let bt_log = ms.c_params.chain_log - 1;
    let bt_mask = (1u32 << bt_log) - 1;
    let mut common_length_smaller = 0usize;
    let mut common_length_larger = 0usize;
    let dict_limit = ms.window.dict_limit;
    let dict_end = src.dict_pos_of(dict_limit);
    let prefix_start = src.pos_of(dict_limit);
    let (ip_buf, ip, iend) = if curr >= dict_limit {
        (src.buf, src.pos_of(curr), input_end)
    } else {
        (src.dict_buf, src.dict_pos_of(curr), dict_end)
    };
    let window_valid = ms.window.low_limit;
    let max_distance = 1u32 << ms.c_params.window_log;
    let window_low = if curr.wrapping_sub(window_valid) > max_distance {
        curr - max_distance
    } else {
        window_valid
    };
    let bt = ms.chain_table.as_mut_slice();
    let mut smaller_ptr = 2 * (curr & bt_mask) as usize;
    let mut larger_ptr = smaller_ptr + 1;
    // The next sorted candidate. The other slot has the previous unsorted one.
    let mut match_index = bt.at(smaller_ptr)?;

    while nb_compares != 0 && match_index > window_low {
        let next_ptr = 2 * (match_index & bt_mask) as usize;
        let mut match_length = common_length_smaller.min(common_length_larger);
        let in_prefix =
            DICT_MODE != EXT_DICT || match_index as usize + match_length >= dict_limit as usize;
        // In `src.buf`, `match_pos` may be before the start: only its sum with `match_length` is a position.
        let (mut match_buf, mut match_pos) = if in_prefix {
            (src.buf, src.pos_of(match_index))
        } else {
            (src.dict_buf, src.dict_pos_of(match_index))
        };

        if in_prefix || curr < dict_limit {
            // Both are in the same segment.
            match_length += count(
                ip_buf,
                ip + match_length,
                match_buf,
                match_pos.wrapping_add(match_length),
                iend,
            )?;
        } else {
            match_length += count_2segments(
                ip_buf,
                ip + match_length,
                match_buf,
                match_pos + match_length,
                iend,
                dict_end,
                prefix_start,
            )?;
            if match_index as usize + match_length >= dict_limit as usize {
                (match_buf, match_pos) = (src.buf, src.pos_of(match_index));
            }
        }

        if ip + match_length == iend {
            // Equal: no way to know which is smaller. Dropped, to keep the tree consistent.
            break;
        }

        if match_buf.at(match_pos.wrapping_add(match_length))? < ip_buf.at(ip + match_length)? {
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

// ── hash chains ───────────────────────────────────────────────────────────

/// `ZSTD_insertAndFindFirstIndex_internal`
#[inline(always)]
fn insert_and_find_first_index_internal(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    ip: usize,
    mls: u32,
    lazy_skipping: bool,
) -> Result<u32> {
    let hash_log = ms.c_params.hash_log;
    let chain_mask = (1u32 << ms.c_params.chain_log) - 1;
    let target = prefix.index_of(ip);
    let hash_table = ms.hash_table.as_mut_slice();
    let chain_table = ms.chain_table.as_mut_slice();

    for idx in ms.next_to_update..target {
        let h = hash_ptr(prefix.buf, prefix.pos_of(idx), hash_log, mls)?;
        let next_in_chain = core::mem::replace(hash_table.at_mut(h)?, idx);
        chain_table.put((idx & chain_mask) as usize, next_in_chain)?;
        // While skipping, not every position is inserted.
        if lazy_skipping {
            break;
        }
    }

    ms.next_to_update = target;
    hash_table.at(hash_ptr(prefix.buf, ip, hash_log, mls)?)
}

/// `ZSTD_insertAndFindFirstIndex`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the hash
/// chains. Returns the index of the first candidate for `ip`.
pub(crate) fn insert_and_find_first_index(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    ip: usize,
) -> Result<u32> {
    insert_and_find_first_index_internal(ms, prefix, ip, ms.c_params.min_match, false)
}

/// `ZSTD_HcFindBestMatch`: returns the length of the best match for `ip`, or 3. `offset_ptr` is written to if there
/// is one.
#[inline(never)]
fn hc_find_best_match<const MLS: u32, const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    ip: usize,
    i_limit: usize,
    offset_ptr: &mut u32,
) -> Result<usize> {
    let buf = src.buf;
    let chain_size = 1u32 << ms.c_params.chain_log;
    let chain_mask = chain_size - 1;
    let dict_limit = ms.window.dict_limit;
    let prefix_start = src.pos_of(dict_limit);
    let dict_end = src.dict_pos_of(dict_limit);
    let curr = src.index_of(ip);
    let low_limit = ms.get_lowest_match_index(curr, ms.c_params.window_log);
    let min_chain = curr.saturating_sub(chain_size);
    let mut nb_attempts = 1u32 << ms.c_params.search_log;
    let mut ml = 4 - 1;

    let mut match_index =
        insert_and_find_first_index_internal(ms, src.prefix(), ip, MLS, ms.lazy_skipping)?;
    let chain_table = ms.chain_table.as_slice();

    while match_index >= low_limit && nb_attempts > 0 {
        let mut current_ml = 0;
        if DICT_MODE != EXT_DICT || match_index >= dict_limit {
            let match_pos = src.pos_of(match_index);
            // Whether it can be longer.
            if read_le32(buf, match_pos + ml - 3)? == read_le32(buf, ip + ml - 3)? {
                current_ml = count(buf, ip, buf, match_pos, i_limit)?;
            }
        } else {
            let match_pos = src.dict_pos_of(match_index);
            if read_le32(src.dict_buf, match_pos)? == read_le32(buf, ip)? {
                current_ml = count_2segments(
                    buf,
                    ip + 4,
                    src.dict_buf,
                    match_pos + 4,
                    i_limit,
                    dict_end,
                    prefix_start,
                )? + 4;
            }
        }

        if current_ml > ml {
            ml = current_ml;
            *offset_ptr = offset_to_offbase(curr.wrapping_sub(match_index));
            if ip + current_ml == i_limit {
                // The best there can be. The next attempt would read too far.
                break;
            }
        }

        if match_index <= min_chain {
            break;
        }
        match_index = chain_table.at((match_index & chain_mask) as usize)?;
        nb_attempts -= 1;
    }

    if DICT_MODE == DICT_MATCH_STATE {
        let dms = src.dms.ok_or(BUG)?;
        let dms_chain_table = dms.ms.chain_table.as_slice();
        let dms_chain_size = 1u32 << dms.ms.c_params.chain_log;
        let dms_chain_mask = dms_chain_size - 1;
        let dms_lowest_index = dms.ms.window.dict_limit;
        let dms_size = dms_end_index(&dms);
        let dms_index_delta = dict_limit.wrapping_sub(dms_size);
        let dms_min_chain = dms_size.saturating_sub(dms_chain_size);

        let h = hash_ptr(buf, ip, dms.ms.c_params.hash_log, MLS)?;
        match_index = dms.ms.hash_table.at(h)?;

        while match_index >= dms_lowest_index && nb_attempts > 0 {
            let mut current_ml = 0;
            let match_pos = dms.pos_of(match_index);
            if read_le32(dms.buf, match_pos)? == read_le32(buf, ip)? {
                current_ml = count_2segments(
                    buf,
                    ip + 4,
                    dms.buf,
                    match_pos + 4,
                    i_limit,
                    dms.end,
                    prefix_start,
                )? + 4;
            }

            if current_ml > ml {
                ml = current_ml;
                let offset = curr.wrapping_sub(match_index.wrapping_add(dms_index_delta));
                *offset_ptr = offset_to_offbase(offset);
                if ip + current_ml == i_limit {
                    break;
                }
            }

            if match_index <= dms_min_chain {
                break;
            }
            match_index = dms_chain_table.at((match_index & dms_chain_mask) as usize)?;
            nb_attempts -= 1;
        }
    }

    Ok(ml)
}

// ── row-based match finder ────────────────────────────────────────────────
//
// The hash table is made of rows of 16, 32 or 64 entries, and the tag table has one byte for each entry: 8 more bits
// of the hash of the position. A row is a circular buffer. Its entry 0 is not used, and the byte for it in the tag
// table is the "head": which entry was written last.

pub(crate) const ZSTD_ROW_HASH_TAG_BITS: u32 = 8;
const ZSTD_ROW_HASH_TAG_MASK: u32 = (1 << ZSTD_ROW_HASH_TAG_BITS) - 1;
const ZSTD_ROW_HASH_CACHE_MASK: u32 = ZSTD_ROW_HASH_CACHE_SIZE as u32 - 1;

/// `ZSTD_row_nextIndex`: moves the head of a row, and returns it: the entry to write to.
#[inline(always)]
fn row_next_index(head: &mut u8, row_mask: u32) -> u32 {
    let mut next = u32::from(*head).wrapping_sub(1) & row_mask;
    if next == 0 {
        next = row_mask;
    }
    *head = next as u8;
    next
}

/// `ZSTD_row_prefetch`: of the row that starts at `rel_row`.
#[inline(always)]
fn row_prefetch(hash_table: &[u32], tag_table: &[u8], rel_row: usize, row_log: u32) {
    prefetch_l1(hash_table, rel_row);
    if row_log >= 5 {
        prefetch_l1(hash_table, rel_row + 16);
    }
    prefetch_l1(tag_table, rel_row);
    if row_log == 6 {
        prefetch_l1(tag_table, rel_row + 32);
    }
}

/// `ZSTD_row_fillHashCache`: the hashes of the 8 positions from `idx` on, or fewer so as not to go past `i_limit`.
#[inline(always)]
fn row_fill_hash_cache(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    row_log: u32,
    mls: u32,
    idx: u32,
    i_limit: usize,
) -> Result<()> {
    let hash_log = ms.row_hash_log;
    let max_elems = (i_limit + 1).saturating_sub(prefix.pos_of(idx));
    let lim = idx + max_elems.min(ZSTD_ROW_HASH_CACHE_SIZE) as u32;

    for idx in idx..lim {
        let hash = hash_ptr_salted(
            prefix.buf,
            prefix.pos_of(idx),
            hash_log + ZSTD_ROW_HASH_TAG_BITS,
            mls,
            ms.hash_salt,
        )? as u32;
        let row = ((hash >> ZSTD_ROW_HASH_TAG_BITS) << row_log) as usize;
        row_prefetch(&ms.hash_table, &ms.tag_table, row, row_log);
        let cached = (idx & ZSTD_ROW_HASH_CACHE_MASK) as usize;
        ms.hash_cache.put(cached, hash)?;
    }
    Ok(())
}

/// `ZSTD_row_nextCachedHash`: the hash of the position `idx`, from the cache, where the hash of the position 8 bytes
/// further takes its place.
#[inline(always)]
fn row_next_cached_hash(
    cache: &mut [u32; ZSTD_ROW_HASH_CACHE_SIZE],
    hash_table: &[u32],
    tag_table: &[u8],
    prefix: Prefix<'_>,
    idx: u32,
    hash_log: u32,
    row_log: u32,
    mls: u32,
    hash_salt: u64,
) -> Result<u32> {
    let new_hash = hash_ptr_salted(
        prefix.buf,
        prefix.pos_of(idx) + ZSTD_ROW_HASH_CACHE_SIZE,
        hash_log + ZSTD_ROW_HASH_TAG_BITS,
        mls,
        hash_salt,
    )? as u32;
    let row = ((new_hash >> ZSTD_ROW_HASH_TAG_BITS) << row_log) as usize;
    row_prefetch(hash_table, tag_table, row, row_log);
    let cached = cache.at_mut((idx & ZSTD_ROW_HASH_CACHE_MASK) as usize)?;
    Ok(core::mem::replace(cached, new_hash))
}

/// `ZSTD_row_update_internalImpl`: inserts the positions from `update_start_idx` up to `update_end_idx`.
#[inline(always)]
fn row_update_internal_impl(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    update_start_idx: u32,
    update_end_idx: u32,
    mls: u32,
    row_log: u32,
    row_mask: u32,
    use_cache: bool,
) -> Result<()> {
    let hash_log = ms.row_hash_log;
    let hash_salt = ms.hash_salt;
    let hash_table = ms.hash_table.as_mut_slice();
    let tag_table = ms.tag_table.as_mut_slice();

    for idx in update_start_idx..update_end_idx {
        let hash = if use_cache {
            row_next_cached_hash(
                &mut ms.hash_cache,
                hash_table,
                tag_table,
                prefix,
                idx,
                hash_log,
                row_log,
                mls,
                hash_salt,
            )?
        } else {
            hash_ptr_salted(
                prefix.buf,
                prefix.pos_of(idx),
                hash_log + ZSTD_ROW_HASH_TAG_BITS,
                mls,
                hash_salt,
            )? as u32
        };
        let rel_row = ((hash >> ZSTD_ROW_HASH_TAG_BITS) << row_log) as usize;
        let pos = row_next_index(tag_table.at_mut(rel_row)?, row_mask) as usize;
        tag_table.put(rel_row + pos, (hash & ZSTD_ROW_HASH_TAG_MASK) as u8)?;
        hash_table.put(rel_row + pos, idx)?;
    }
    Ok(())
}

/// `ZSTD_row_update_internal`: inserts the positions from `ms.next_to_update` up to `ip`. With the cache, which is
/// when compressing, not all of them if they are many.
#[inline(always)]
fn row_update_internal(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    ip: usize,
    mls: u32,
    row_log: u32,
    row_mask: u32,
    use_cache: bool,
) -> Result<()> {
    const K_SKIP_THRESHOLD: u32 = 384;
    const K_MAX_MATCH_START_POSITIONS_TO_UPDATE: u32 = 96;
    const K_MAX_MATCH_END_POSITIONS_TO_UPDATE: u32 = 32;

    let mut idx = ms.next_to_update;
    let target = prefix.index_of(ip);

    if use_cache && target.wrapping_sub(idx) > K_SKIP_THRESHOLD {
        let bound = idx + K_MAX_MATCH_START_POSITIONS_TO_UPDATE;
        row_update_internal_impl(ms, prefix, idx, bound, mls, row_log, row_mask, use_cache)?;
        idx = target - K_MAX_MATCH_END_POSITIONS_TO_UPDATE;
        row_fill_hash_cache(ms, prefix, row_log, mls, idx, ip + 1)?;
    }
    row_update_internal_impl(ms, prefix, idx, target, mls, row_log, row_mask, use_cache)?;
    ms.next_to_update = target;
    Ok(())
}

/// `ZSTD_row_update`: indexes the segment from `ms.next_to_update` up to the position `ip`, in the rows of the
/// row-based match finder.
pub(crate) fn row_update(ms: &mut MatchState, prefix: Prefix<'_>, ip: usize) -> Result<()> {
    let row_log = ms.c_params.search_log.clamp(4, 6);
    let row_mask = (1u32 << row_log) - 1;
    let mls = ms.c_params.min_match.min(6);
    row_update_internal(ms, prefix, ip, mls, row_log, row_mask, false)
}

/// `ZSTD_row_getMatchMask`: bit `n` is set if the entry `(head + n) % ROW_ENTRIES` of the row has the tag `tag`.
#[inline(always)]
fn row_get_match_mask<const ROW_ENTRIES: usize>(
    tag_row: &[u8; ROW_ENTRIES],
    tag: u8,
    head: u32,
) -> u64 {
    let mut matches = 0u64;
    let (chunks, _) = tag_row.as_chunks::<16>();
    for (n, chunk) in chunks.iter().enumerate() {
        let mut chunk_matches = 0u16;
        for (i, &entry) in chunk.iter().enumerate() {
            chunk_matches |= u16::from(entry == tag) << i;
        }
        matches |= u64::from(chunk_matches) << (16 * n);
    }
    match ROW_ENTRIES {
        16 => u64::from((matches as u16).rotate_right(head)),
        32 => u64::from((matches as u32).rotate_right(head)),
        _ => matches.rotate_right(head),
    }
}

/// The first loop of `ZSTD_RowFindBestMatch`: copies the entries of a row that have the tag `tag` to `match_buffer`,
/// the most recent first. It stops after `nb_attempts` of them, which it decreases, or at the first that is less than
/// `low_limit`. `prefetch` is called with each. Returns how many there are.
#[inline(always)]
fn row_collect_matches<const ROW_ENTRIES: usize>(
    row: &[u32; ROW_ENTRIES],
    tag_row: &[u8; ROW_ENTRIES],
    tag: u8,
    low_limit: u32,
    nb_attempts: &mut u32,
    match_buffer: &mut [u32; ROW_ENTRIES],
    prefetch: impl Fn(u32),
) -> Result<usize> {
    let row_mask = ROW_ENTRIES as u32 - 1;
    let head = u32::from(tag_row.at(0)?) & row_mask;
    let mut num_matches = 0usize;
    let mut matches = row_get_match_mask(tag_row, tag, head);

    while matches > 0 && *nb_attempts > 0 {
        let match_pos = (head + matches.trailing_zeros()) & row_mask;
        matches &= matches - 1;
        if match_pos == 0 {
            // The head, which happens to be the same as the tag.
            continue;
        }
        let match_index = row.at(match_pos as usize)?;
        if match_index < low_limit {
            break;
        }
        prefetch(match_index);
        match_buffer.put(num_matches, match_index)?;
        num_matches += 1;
        *nb_attempts -= 1;
    }
    Ok(num_matches)
}

/// `ZSTD_RowFindBestMatch`: returns the length of the best match for `ip`, or 3. `offset_ptr` is written to if there
/// is one.
#[inline(never)]
fn row_find_best_match<const MLS: u32, const ROW_ENTRIES: usize, const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    ip: usize,
    i_limit: usize,
    offset_ptr: &mut u32,
) -> Result<usize> {
    let buf = src.buf;
    let hash_log = ms.row_hash_log;
    let dict_limit = ms.window.dict_limit;
    let prefix_start = src.pos_of(dict_limit);
    let dict_end = src.dict_pos_of(dict_limit);
    let curr = src.index_of(ip);
    let low_limit = ms.get_lowest_match_index(curr, ms.c_params.window_log);
    let row_log = ROW_ENTRIES.trailing_zeros();
    let row_mask = ROW_ENTRIES as u32 - 1;
    // There are no more searches than entries in a row.
    let capped_search_log = ms.c_params.search_log.min(row_log);
    let hash_salt = ms.hash_salt;
    let mut nb_attempts = 1u32 << capped_search_log;
    let mut ml = 4 - 1;
    let mut match_buffer = [0u32; ROW_ENTRIES];

    let mut dms_hash = 0u32;
    let mut dms_rel_row = 0usize;
    if DICT_MODE == DICT_MATCH_STATE {
        let dms = src.dms.ok_or(BUG)?;
        let dms_hash_log = dms.ms.row_hash_log + ZSTD_ROW_HASH_TAG_BITS;
        dms_hash = hash_ptr(buf, ip, dms_hash_log, MLS)? as u32;
        dms_rel_row = ((dms_hash >> ZSTD_ROW_HASH_TAG_BITS) << row_log) as usize;
        row_prefetch(&dms.ms.hash_table, &dms.ms.tag_table, dms_rel_row, row_log);
    }

    // Update the tables up to, and not including, `ip`.
    let hash = if ms.lazy_skipping {
        // While skipping, not every position is inserted.
        ms.next_to_update = curr;
        hash_ptr_salted(buf, ip, hash_log + ZSTD_ROW_HASH_TAG_BITS, MLS, hash_salt)? as u32
    } else {
        let prefix = src.prefix();
        row_update_internal(ms, prefix, ip, MLS, row_log, row_mask, true)?;
        row_next_cached_hash(
            &mut ms.hash_cache,
            &ms.hash_table,
            &ms.tag_table,
            prefix,
            curr,
            hash_log,
            row_log,
            MLS,
            hash_salt,
        )?
    };
    ms.hash_salt_entropy = ms.hash_salt_entropy.wrapping_add(hash);

    {
        let rel_row = ((hash >> ZSTD_ROW_HASH_TAG_BITS) << row_log) as usize;
        let tag = (hash & ZSTD_ROW_HASH_TAG_MASK) as u8;
        let row = ms.hash_table.array_at_mut::<ROW_ENTRIES>(rel_row)?;
        let tag_row = ms.tag_table.array_at_mut::<ROW_ENTRIES>(rel_row)?;
        let num_matches = row_collect_matches(
            row,
            tag_row,
            tag,
            low_limit,
            &mut nb_attempts,
            &mut match_buffer,
            |match_index| {
                if DICT_MODE != EXT_DICT || match_index >= dict_limit {
                    prefetch_l1(buf, src.pos_of(match_index));
                } else {
                    prefetch_l1(src.dict_buf, src.dict_pos_of(match_index));
                }
            },
        )?;

        // Insert `ip`.
        let pos = row_next_index(tag_row.at_mut(0)?, row_mask) as usize;
        tag_row.put(pos, tag)?;
        row.put(pos, ms.next_to_update)?;
        ms.next_to_update += 1;

        for &match_index in match_buffer.sub(..num_matches)? {
            let mut current_ml = 0;
            if DICT_MODE != EXT_DICT || match_index >= dict_limit {
                let match_pos = src.pos_of(match_index);
                // Whether it can be longer.
                if read_le32(buf, match_pos + ml - 3)? == read_le32(buf, ip + ml - 3)? {
                    current_ml = count(buf, ip, buf, match_pos, i_limit)?;
                }
            } else {
                let match_pos = src.dict_pos_of(match_index);
                if read_le32(src.dict_buf, match_pos)? == read_le32(buf, ip)? {
                    current_ml = count_2segments(
                        buf,
                        ip + 4,
                        src.dict_buf,
                        match_pos + 4,
                        i_limit,
                        dict_end,
                        prefix_start,
                    )? + 4;
                }
            }

            if current_ml > ml {
                ml = current_ml;
                *offset_ptr = offset_to_offbase(curr.wrapping_sub(match_index));
                if ip + current_ml == i_limit {
                    // The best there can be. The next attempt would read too far.
                    break;
                }
            }
        }
    }

    if DICT_MODE == DICT_MATCH_STATE {
        let dms = src.dms.ok_or(BUG)?;
        let dms_lowest_index = dms.ms.window.dict_limit;
        let dms_index_delta = dict_limit.wrapping_sub(dms_end_index(&dms));

        let num_matches = row_collect_matches(
            dms.ms.hash_table.array_at::<ROW_ENTRIES>(dms_rel_row)?,
            dms.ms.tag_table.array_at::<ROW_ENTRIES>(dms_rel_row)?,
            (dms_hash & ZSTD_ROW_HASH_TAG_MASK) as u8,
            dms_lowest_index,
            &mut nb_attempts,
            &mut match_buffer,
            |match_index| prefetch_l1(dms.buf, dms.pos_of(match_index)),
        )?;

        for &match_index in match_buffer.sub(..num_matches)? {
            let mut current_ml = 0;
            let match_pos = dms.pos_of(match_index);
            if read_le32(dms.buf, match_pos)? == read_le32(buf, ip)? {
                current_ml = count_2segments(
                    buf,
                    ip + 4,
                    dms.buf,
                    match_pos + 4,
                    i_limit,
                    dms.end,
                    prefix_start,
                )? + 4;
            }

            if current_ml > ml {
                ml = current_ml;
                let offset = curr.wrapping_sub(match_index.wrapping_add(dms_index_delta));
                *offset_ptr = offset_to_offbase(offset);
                if ip + current_ml == i_limit {
                    break;
                }
            }
        }
    }

    Ok(ml)
}

// ── the parsers ───────────────────────────────────────────────────────────

// `searchMethod_e`, as an argument of a const generic.
const SEARCH_HASH_CHAIN: u8 = 0;
const SEARCH_BINARY_TREE: u8 = 1;
const SEARCH_ROW_HASH: u8 = 2;

/// `ZSTD_searchMax`: the best match for `ip`. `mls` and `row_log` are from 4 to 6.
#[inline(always)]
fn search_max<const SEARCH_METHOD: u8, const DICT_MODE: u8>(
    ms: &mut MatchState,
    src: &BlockSrc<'_>,
    ip: usize,
    iend: usize,
    offset_ptr: &mut u32,
    mls: u32,
    row_log: u32,
) -> Result<usize> {
    match SEARCH_METHOD {
        SEARCH_HASH_CHAIN => match mls {
            4 => hc_find_best_match::<4, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            5 => hc_find_best_match::<5, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            _ => hc_find_best_match::<6, DICT_MODE>(ms, src, ip, iend, offset_ptr),
        },
        SEARCH_BINARY_TREE => match mls {
            4 => bt_find_best_match::<4, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            5 => bt_find_best_match::<5, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            _ => bt_find_best_match::<6, DICT_MODE>(ms, src, ip, iend, offset_ptr),
        },
        _ => match (mls, row_log) {
            (4, 4) => row_find_best_match::<4, 16, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (4, 5) => row_find_best_match::<4, 32, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (4, _) => row_find_best_match::<4, 64, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (5, 4) => row_find_best_match::<5, 16, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (5, 5) => row_find_best_match::<5, 32, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (5, _) => row_find_best_match::<5, 64, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (_, 4) => row_find_best_match::<6, 16, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (_, 5) => row_find_best_match::<6, 32, DICT_MODE>(ms, src, ip, iend, offset_ptr),
            (_, _) => row_find_best_match::<6, 64, DICT_MODE>(ms, src, ip, iend, offset_ptr),
        },
    }
}

/// What an index below the current segment leads to: the older segment of the window, or the dictionary whose match
/// state is searched.
#[derive(Clone, Copy)]
struct DictSegment<'a> {
    buf: &'a [u8],
    /// Its sum with an index of the window is a position in `buf`. It wraps around.
    base: usize,
    /// Where the segment starts in `buf`.
    start: usize,
    /// Where it ends.
    end: usize,
}

/// How long a match the repeat offset `offset` gives at `ip`: at least 4, or 0 if it gives none.
#[inline(always)]
fn rep_length<const DICT_MODE: u8>(
    ms: &MatchState,
    src: &BlockSrc<'_>,
    dict: &DictSegment<'_>,
    ip: usize,
    offset: u32,
) -> Result<usize> {
    let buf = src.buf;
    let iend = src.end;
    if DICT_MODE == NO_DICT {
        let rep_match = ip.wrapping_sub(offset as usize);
        if offset > 0 && read_le32(buf, rep_match)? == read_le32(buf, ip)? {
            return Ok(count(buf, ip + 4, buf, rep_match + 4, iend)? + 4);
        }
        return Ok(0);
    }

    let dict_limit = ms.window.dict_limit;
    let curr = src.index_of(ip);
    let rep_index = curr.wrapping_sub(offset);
    if !index_overlap_check(dict_limit, rep_index) {
        return Ok(0);
    }
    if DICT_MODE == EXT_DICT {
        // The offset may lead to what is no longer in the window.
        let window_low = ms.get_lowest_match_index(curr, ms.c_params.window_log);
        if offset > curr.wrapping_sub(window_low) {
            return Ok(0);
        }
    }
    let (rep_buf, rep_match, rep_end) = if rep_index < dict_limit {
        let rep_match = dict.base.wrapping_add(rep_index as usize);
        (dict.buf, rep_match, dict.end)
    } else {
        (buf, src.pos_of(rep_index), iend)
    };
    if read_le32(rep_buf, rep_match)? != read_le32(buf, ip)? {
        return Ok(0);
    }
    let prefix_start = src.pos_of(dict_limit);
    Ok(count_2segments(
        buf,
        ip + 4,
        rep_buf,
        rep_match + 4,
        iend,
        rep_end,
        prefix_start,
    )? + 4)
}

/// `ZSTD_compressBlock_lazy_generic` and `ZSTD_compressBlock_lazy_extDict_generic`. `DEPTH` is how many positions
/// further a better match is looked for, once there is one.
#[inline(never)]
fn compress_block_lazy_generic<const SEARCH_METHOD: u8, const DEPTH: u32, const DICT_MODE: u8>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let buf = src.buf;
    let istart = src.start;
    let mut ip = istart;
    let mut anchor = istart;
    let iend = src.end;
    let prefix_lowest_index = ms.window.dict_limit;
    let prefix_lowest = src.pos_of(prefix_lowest_index);
    let mls = ms.c_params.min_match.clamp(4, 6);
    let row_log = ms.c_params.search_log.clamp(4, 6);

    let [rep_0, rep_1, _] = rep;
    let mut offset_1 = *rep_0;
    let mut offset_2 = *rep_1;
    let mut offset_saved_1 = 0u32;
    let mut offset_saved_2 = 0u32;

    ms.lazy_skipping = false;

    let margin = if SEARCH_METHOD == SEARCH_ROW_HASH {
        8 + ZSTD_ROW_HASH_CACHE_SIZE
    } else {
        8
    };
    let Some(ilimit) = iend.checked_sub(margin) else {
        // There is no position to search, nor to hash.
        return Ok(iend - istart);
    };

    let dict = match DICT_MODE {
        NO_DICT => DictSegment {
            buf: &[],
            base: 0,
            start: 0,
            end: 0,
        },
        EXT_DICT => DictSegment {
            buf: src.dict_buf,
            base: src.dict_base,
            start: src.dict_pos_of(ms.window.low_limit),
            end: src.dict_pos_of(prefix_lowest_index),
        },
        _ => {
            let dms = src.dms.ok_or(BUG)?;
            let dict_index_delta = prefix_lowest_index.wrapping_sub(dms_end_index(&dms));
            DictSegment {
                buf: dms.buf,
                base: dms.base.wrapping_sub(dict_index_delta as usize),
                start: dms.pos_of(dms.ms.window.dict_limit),
                end: dms.end,
            }
        }
    };

    if DICT_MODE == EXT_DICT {
        ip += usize::from(ip == prefix_lowest);
    } else {
        let dict_and_prefix_length = (ip - prefix_lowest) + (dict.end - dict.start);
        ip += usize::from(dict_and_prefix_length == 0);
    }
    if DICT_MODE == NO_DICT {
        let curr = src.index_of(ip);
        let window_low = ms.get_lowest_prefix_index(curr, ms.c_params.window_log);
        let max_rep = curr - window_low;
        if offset_2 > max_rep {
            offset_saved_2 = offset_2;
            offset_2 = 0;
        }
        if offset_1 > max_rep {
            offset_saved_1 = offset_1;
            offset_1 = 0;
        }
    }

    if SEARCH_METHOD == SEARCH_ROW_HASH {
        row_fill_hash_cache(ms, src.prefix(), row_log, mls, ms.next_to_update, ilimit)?;
    }

    'parse: while ip < ilimit {
        let mut match_length;
        let mut off_base = REPCODE1_TO_OFFBASE;
        let mut start = ip + 1;

        'found: {
            // Check the repeat offset.
            match_length = rep_length::<DICT_MODE>(ms, src, &dict, ip + 1, offset_1)?;
            if DEPTH == 0 && match_length != 0 {
                break 'found;
            }

            // First search.
            {
                let mut off_base_found = 999_999_999u32;
                let ml2 = search_max::<SEARCH_METHOD, DICT_MODE>(
                    ms,
                    src,
                    ip,
                    iend,
                    &mut off_base_found,
                    mls,
                    row_log,
                )?;
                if ml2 > match_length {
                    match_length = ml2;
                    start = ip;
                    off_base = off_base_found;
                }
            }

            if match_length < 4 {
                // Jump faster over incompressible sections.
                let step = (ip - anchor) >> K_SEARCH_STRENGTH;
                ip += step + 1;
                // Far into one, positions are no longer all inserted: it is faster, and keeps positions that are of
                // no use out of the tables. As in the C code, it does not start at the same step in all modes.
                ms.lazy_skipping = if DICT_MODE == EXT_DICT {
                    step > K_LAZY_SKIPPING_STEP
                } else {
                    step + 1 > K_LAZY_SKIPPING_STEP
                };
                continue 'parse;
            }

            // Look for something better at the next positions.
            if DEPTH >= 1 {
                while ip < ilimit {
                    ip += 1;
                    if off_base != 0 {
                        let ml_rep = rep_length::<DICT_MODE>(ms, src, &dict, ip, offset_1)?;
                        let gain2 = (ml_rep * 3) as i32;
                        let gain1 = (match_length * 3) as i32 - highbit32(off_base) as i32 + 1;
                        if ml_rep >= 4 && gain2 > gain1 {
                            match_length = ml_rep;
                            off_base = REPCODE1_TO_OFFBASE;
                            start = ip;
                        }
                    }
                    {
                        let mut ofb_candidate = 999_999_999u32;
                        let ml2 = search_max::<SEARCH_METHOD, DICT_MODE>(
                            ms,
                            src,
                            ip,
                            iend,
                            &mut ofb_candidate,
                            mls,
                            row_log,
                        )?;
                        let gain2 = (ml2 * 4) as i32 - highbit32(ofb_candidate) as i32;
                        let gain1 = (match_length * 4) as i32 - highbit32(off_base) as i32 + 4;
                        if ml2 >= 4 && gain2 > gain1 {
                            match_length = ml2;
                            off_base = ofb_candidate;
                            start = ip;
                            continue;
                        }
                    }

                    // Nothing better: try one position further.
                    if DEPTH == 2 && ip < ilimit {
                        ip += 1;
                        if off_base != 0 {
                            let ml_rep = rep_length::<DICT_MODE>(ms, src, &dict, ip, offset_1)?;
                            let gain2 = (ml_rep * 4) as i32;
                            let gain1 = (match_length * 4) as i32 - highbit32(off_base) as i32 + 1;
                            if ml_rep >= 4 && gain2 > gain1 {
                                match_length = ml_rep;
                                off_base = REPCODE1_TO_OFFBASE;
                                start = ip;
                            }
                        }
                        {
                            let mut ofb_candidate = 999_999_999u32;
                            let ml2 = search_max::<SEARCH_METHOD, DICT_MODE>(
                                ms,
                                src,
                                ip,
                                iend,
                                &mut ofb_candidate,
                                mls,
                                row_log,
                            )?;
                            let gain2 = (ml2 * 4) as i32 - highbit32(ofb_candidate) as i32;
                            let gain1 = (match_length * 4) as i32 - highbit32(off_base) as i32 + 7;
                            if ml2 >= 4 && gain2 > gain1 {
                                match_length = ml2;
                                off_base = ofb_candidate;
                                start = ip;
                                continue;
                            }
                        }
                    }
                    break;
                }
            }

            // Catch up: the match may start earlier.
            if offbase_is_offset(off_base) {
                let offset = offbase_to_offset(off_base);
                let match_index = src.index_of(start).wrapping_sub(offset);
                let (match_buf, mut match_pos, m_start) =
                    if DICT_MODE != NO_DICT && match_index < prefix_lowest_index {
                        let match_pos = dict.base.wrapping_add(match_index as usize);
                        (dict.buf, match_pos, dict.start)
                    } else {
                        (buf, src.pos_of(match_index), prefix_lowest)
                    };
                while start > anchor
                    && match_pos > m_start
                    && buf.at(start - 1)? == match_buf.at(match_pos - 1)?
                {
                    start -= 1;
                    match_pos -= 1;
                    match_length += 1;
                }
                offset_2 = offset_1;
                offset_1 = offset;
            }
        }

        // Store the sequence.
        seq_store.store_seq(start - anchor, buf, anchor, off_base, match_length)?;
        ip = start + match_length;
        anchor = ip;

        if ms.lazy_skipping {
            // There was a match: every position is inserted again.
            if SEARCH_METHOD == SEARCH_ROW_HASH {
                row_fill_hash_cache(ms, src.prefix(), row_log, mls, ms.next_to_update, ilimit)?;
            }
            ms.lazy_skipping = false;
        }

        // Check the second repeat offset right away.
        while ip <= ilimit {
            match_length = rep_length::<DICT_MODE>(ms, src, &dict, ip, offset_2)?;
            if match_length == 0 {
                break;
            }
            (offset_1, offset_2) = (offset_2, offset_1);
            seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, match_length)?;
            ip += match_length;
            anchor = ip;
        }
    }

    // If `offset_1` was not valid at first and now is, what it was becomes the second repeat offset.
    if offset_saved_1 != 0 && offset_1 != 0 {
        offset_saved_2 = offset_saved_1;
    }

    // Save the repeat offsets for the next block.
    *rep_0 = if offset_1 != 0 {
        offset_1
    } else {
        offset_saved_1
    };
    *rep_1 = if offset_2 != 0 {
        offset_2
    } else {
        offset_saved_2
    };

    // The size of the last literals.
    Ok(iend - anchor)
}

/// [`compress_block_lazy_generic`], for a `dict_mode` that is not a constant.
#[inline(always)]
fn compress_block_lazy_any_dict<const SEARCH_METHOD: u8, const DEPTH: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    dict_mode: DictMode,
) -> Result<usize> {
    match dict_mode {
        DictMode::NoDict => {
            compress_block_lazy_generic::<SEARCH_METHOD, DEPTH, NO_DICT>(ms, seq_store, rep, src)
        }
        DictMode::ExtDict => {
            compress_block_lazy_generic::<SEARCH_METHOD, DEPTH, EXT_DICT>(ms, seq_store, rep, src)
        }
        DictMode::DictMatchState => {
            compress_block_lazy_generic::<SEARCH_METHOD, DEPTH, DICT_MATCH_STATE>(
                ms, seq_store, rep, src,
            )
        }
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
    match (strategy, use_row) {
        (Strategy::Greedy, false) => {
            compress_block_lazy_any_dict::<SEARCH_HASH_CHAIN, 0>(ms, seq_store, rep, src, dict_mode)
        }
        (Strategy::Greedy, true) => {
            compress_block_lazy_any_dict::<SEARCH_ROW_HASH, 0>(ms, seq_store, rep, src, dict_mode)
        }
        (Strategy::Lazy, false) => {
            compress_block_lazy_any_dict::<SEARCH_HASH_CHAIN, 1>(ms, seq_store, rep, src, dict_mode)
        }
        (Strategy::Lazy, true) => {
            compress_block_lazy_any_dict::<SEARCH_ROW_HASH, 1>(ms, seq_store, rep, src, dict_mode)
        }
        (Strategy::Lazy2, false) => {
            compress_block_lazy_any_dict::<SEARCH_HASH_CHAIN, 2>(ms, seq_store, rep, src, dict_mode)
        }
        (Strategy::Lazy2, true) => {
            compress_block_lazy_any_dict::<SEARCH_ROW_HASH, 2>(ms, seq_store, rep, src, dict_mode)
        }
        (Strategy::BtLazy2, false) => compress_block_lazy_any_dict::<SEARCH_BINARY_TREE, 2>(
            ms, seq_store, rep, src, dict_mode,
        ),
        _ => Err(BUG),
    }
}
