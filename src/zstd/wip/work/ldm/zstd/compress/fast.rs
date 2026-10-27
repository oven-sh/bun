//! `zstd_fast.c`: the `fast` strategy, which looks up one hash table.

use super::internal::{
    BlockSrc, DictTableLoadMethod, HASH_READ_SIZE, K_SEARCH_STRENGTH, MatchState, Prefix,
    REPCODE1_TO_OFFBASE, SeqStore, TableFillPurpose, ZSTD_SHORT_CACHE_TAG_BITS,
    compare_packed_tags, count, count_2segments, hash_ptr, index_overlap_check, offset_to_offbase,
    write_tagged_index,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::Result;
use crate::util::{BUG, SliceExt, read_le32};

pub(super) const FAST_HASH_FILL_STEP: u32 = 3;

/// Where an index leads, when it can be in one of two segments.
#[derive(Clone, Copy)]
pub(super) struct Located<'a> {
    /// The buffer that the segment is in.
    pub(super) buf: &'a [u8],
    /// The position of the index in `buf`.
    pub(super) pos: usize,
    /// Where the segment starts in `buf`.
    pub(super) start: usize,
    /// Where it ends.
    pub(super) end: usize,
}

/// How many bytes before `ip`, down to `anchor`, are the same as those before `match_pos`, down to `match_low`.
#[inline(always)]
pub(super) fn count_backwards(
    buf: &[u8],
    ip: usize,
    anchor: usize,
    match_buf: &[u8],
    match_pos: usize,
    match_low: usize,
) -> usize {
    let before_ip = buf.get(anchor..ip).unwrap_or_default();
    let before_match = match_buf.get(match_low..match_pos).unwrap_or_default();
    before_ip
        .iter()
        .rev()
        .zip(before_match.iter().rev())
        .take_while(|(a, b)| a == b)
        .count()
}

/// The repeat offsets to leave at the end of a block, at the start of which those that reached too far were saved and
/// set to 0.
#[inline(always)]
pub(super) fn restore_rep(
    rep: &mut [u32; ZSTD_REP_NUM],
    offset_1: u32,
    offset_2: u32,
    offset_saved1: u32,
    offset_saved2: u32,
) {
    // If offset_1 started invalid and became valid, offset_saved1 is what rotates into the second place.
    let offset_saved2 = if offset_saved1 != 0 && offset_1 != 0 {
        offset_saved1
    } else {
        offset_saved2
    };
    let [rep0, rep1, _] = rep;
    *rep0 = if offset_1 != 0 {
        offset_1
    } else {
        offset_saved1
    };
    *rep1 = if offset_2 != 0 {
        offset_2
    } else {
        offset_saved2
    };
}

/// `ZSTD_fillHashTableForCDict`
fn fill_hash_table_for_cdict(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
) -> Result<()> {
    let h_bits = ms.c_params.hash_log + ZSTD_SHORT_CACHE_TAG_BITS;
    let mls = ms.c_params.min_match;
    let hash_table = ms.hash_table.as_mut_slice();
    let buf = prefix.buf;
    let mut ip = prefix.pos_of(ms.next_to_update);
    let Some(iend) = end.checked_sub(HASH_READ_SIZE) else {
        return Ok(());
    };

    while ip + (FAST_HASH_FILL_STEP as usize) < iend + 2 {
        let curr = prefix.index_of(ip);
        write_tagged_index(hash_table, hash_ptr(buf, ip, h_bits, mls)?, curr)?;
        if dtlm == DictTableLoadMethod::Full {
            // The positions in between only go where there is nothing yet.
            for p in 1..FAST_HASH_FILL_STEP {
                let hash_and_tag = hash_ptr(buf, ip + p as usize, h_bits, mls)?;
                if hash_table.at(hash_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS)? == 0 {
                    write_tagged_index(hash_table, hash_and_tag, curr + p)?;
                }
            }
        }
        ip += FAST_HASH_FILL_STEP as usize;
    }
    Ok(())
}

/// `ZSTD_fillHashTableForCCtx`
fn fill_hash_table_for_cctx(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
) -> Result<()> {
    let h_bits = ms.c_params.hash_log;
    let mls = ms.c_params.min_match;
    let hash_table = ms.hash_table.as_mut_slice();
    let buf = prefix.buf;
    let mut ip = prefix.pos_of(ms.next_to_update);
    let Some(iend) = end.checked_sub(HASH_READ_SIZE) else {
        return Ok(());
    };

    while ip + (FAST_HASH_FILL_STEP as usize) < iend + 2 {
        let curr = prefix.index_of(ip);
        hash_table.put(hash_ptr(buf, ip, h_bits, mls)?, curr)?;
        if dtlm == DictTableLoadMethod::Full {
            // The positions in between only go where there is nothing yet.
            for p in 1..FAST_HASH_FILL_STEP {
                let hash = hash_ptr(buf, ip + p as usize, h_bits, mls)?;
                if hash_table.at(hash)? == 0 {
                    hash_table.put(hash, curr + p)?;
                }
            }
        }
        ip += FAST_HASH_FILL_STEP as usize;
    }
    Ok(())
}

/// `ZSTD_fillHashTable`: indexes the segment from `ms.next_to_update` up to the position `end`.
pub(crate) fn fill_hash_table(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
    tfp: TableFillPurpose,
) -> Result<()> {
    match tfp {
        TableFillPurpose::ForCDict => fill_hash_table_for_cdict(ms, prefix, end, dtlm),
        TableFillPurpose::ForCCtx => fill_hash_table_for_cctx(ms, prefix, end, dtlm),
    }
}

/// `ZSTD_match4Found_branch`, and `ZSTD_match4Found_cmov`, which only differs in how it avoids reading at an index that
/// is not valid.
#[inline(always)]
fn match4_found(
    buf: &[u8],
    current: usize,
    match_pos: usize,
    match_idx: u32,
    idx_low_limit: u32,
) -> Result<bool> {
    Ok(match_idx >= idx_low_limit && read_le32(buf, current)? == read_le32(buf, match_pos)?)
}

/// `ZSTD_compressBlock_fast_noDict_generic`
///
/// Each turn of the inner loop looks at two positions, `ip0` and `ip1`, for a match, and at `ip2` for a repeat. The
/// hash of a position is computed, and the table is read, one position ahead of the comparison.
fn compress_block_fast_no_dict_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    const K_STEP_INCR: usize = 1 << (K_SEARCH_STRENGTH - 1);

    let hlog = ms.c_params.hash_log;
    let window_log = ms.c_params.window_log;
    let target_length = ms.c_params.target_length;
    // The least step is 2, as two positions are looked at per turn.
    let step_size = (target_length + u32::from(target_length == 0) + 1) as usize;
    let buf = src.buf;
    let istart = src.start;
    let iend = src.end;
    let end_index = src.index_of(iend);
    let prefix_start_index = ms.get_lowest_prefix_index(end_index, window_log);
    let prefix_start = src.pos_of(prefix_start_index);
    // Nothing is looked for in a block this short.
    let Some(ilimit) = iend.checked_sub(HASH_READ_SIZE) else {
        return Ok(iend - istart);
    };

    let mut anchor = istart;
    let mut ip0 = istart + usize::from(istart == prefix_start);
    let [mut rep_offset1, mut rep_offset2, _] = *rep;
    let (mut offset_saved1, mut offset_saved2) = (0, 0);
    {
        let curr = src.index_of(ip0);
        let window_low = ms.get_lowest_prefix_index(curr, window_log);
        let max_rep = curr.wrapping_sub(window_low);
        if rep_offset2 > max_rep {
            offset_saved2 = rep_offset2;
            rep_offset2 = 0;
        }
        if rep_offset1 > max_rep {
            offset_saved1 = rep_offset1;
            rep_offset1 = 0;
        }
    }
    let hash_table = ms.hash_table.as_mut_slice();

    'start: loop {
        let mut step = step_size;
        let mut next_step = ip0 + K_STEP_INCR;

        let mut ip1 = ip0 + 1;
        let mut ip2 = ip0 + step;
        let mut ip3 = ip2 + 1;
        if ip3 >= ilimit {
            break 'start;
        }

        let mut hash0 = hash_ptr(buf, ip0, hlog, MLS)?;
        let mut hash1 = hash_ptr(buf, ip1, hlog, MLS)?;
        let mut match_idx = hash_table.at(hash0)?;
        let mut current0;

        // Ends with the start and the length so far of a repeat match, or with `None` for a match at `match_idx`.
        let rep_match = loop {
            let rval = read_le32(buf, ip2.wrapping_sub(rep_offset1 as usize))?;

            current0 = src.index_of(ip0);
            hash_table.put(hash0, current0)?;

            if (read_le32(buf, ip2)? == rval) & (rep_offset1 > 0) {
                ip0 = ip2;
                let match0 = ip0.wrapping_sub(rep_offset1 as usize);
                let back = usize::from(buf.at(ip0 - 1)? == buf.at(match0.wrapping_sub(1))?);
                ip0 -= back;
                // The hash of ip1 is there, and ip1 is before the end of the match.
                hash_table.put(hash1, src.index_of(ip1))?;
                break Some((match0.wrapping_sub(back), 4 + back));
            }

            if match4_found(
                buf,
                ip0,
                src.pos_of(match_idx),
                match_idx,
                prefix_start_index,
            )? {
                hash_table.put(hash1, src.index_of(ip1))?;
                break None;
            }

            match_idx = hash_table.at(hash1)?;
            hash0 = hash1;
            hash1 = hash_ptr(buf, ip2, hlog, MLS)?;

            ip0 = ip1;
            ip1 = ip2;
            ip2 = ip3;

            current0 = src.index_of(ip0);
            hash_table.put(hash0, current0)?;

            if match4_found(
                buf,
                ip0,
                src.pos_of(match_idx),
                match_idx,
                prefix_start_index,
            )? {
                // ip1 is certain to be before the end of the match only if the step is small.
                if step <= 4 {
                    hash_table.put(hash1, src.index_of(ip1))?;
                }
                break None;
            }

            match_idx = hash_table.at(hash1)?;
            hash0 = hash1;
            hash1 = hash_ptr(buf, ip2, hlog, MLS)?;

            ip0 = ip1;
            ip1 = ip2;
            ip2 = ip0 + step;
            ip3 = ip1 + step;

            if ip2 >= next_step {
                step += 1;
                next_step += K_STEP_INCR;
            }
            if ip3 >= ilimit {
                break 'start;
            }
        };

        let (offcode, match0, mut m_length) = match rep_match {
            Some((match0, m_length)) => (REPCODE1_TO_OFFBASE, match0, m_length),
            None => {
                let match0 = src.pos_of(match_idx);
                rep_offset2 = rep_offset1;
                rep_offset1 = ip0.wrapping_sub(match0) as u32;
                let back = count_backwards(buf, ip0, anchor, buf, match0, prefix_start);
                ip0 -= back;
                (offset_to_offbase(rep_offset1), match0 - back, 4 + back)
            }
        };

        m_length += count(buf, ip0 + m_length, buf, match0 + m_length, iend)?;
        seq_store.store_seq(ip0 - anchor, buf, anchor, offcode, m_length)?;
        ip0 += m_length;
        anchor = ip0;

        if ip0 <= ilimit {
            hash_table.put(
                hash_ptr(buf, src.pos_of(current0 + 2), hlog, MLS)?,
                current0 + 2,
            )?;
            hash_table.put(hash_ptr(buf, ip0 - 2, hlog, MLS)?, src.index_of(ip0 - 2))?;

            if rep_offset2 > 0 {
                while ip0 <= ilimit
                    && read_le32(buf, ip0)?
                        == read_le32(buf, ip0.wrapping_sub(rep_offset2 as usize))?
                {
                    let r_length = count(
                        buf,
                        ip0 + 4,
                        buf,
                        (ip0 + 4).wrapping_sub(rep_offset2 as usize),
                        iend,
                    )? + 4;
                    core::mem::swap(&mut rep_offset1, &mut rep_offset2);
                    hash_table.put(hash_ptr(buf, ip0, hlog, MLS)?, src.index_of(ip0))?;
                    ip0 += r_length;
                    seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, r_length)?;
                    anchor = ip0;
                }
            }
        }
    }

    restore_rep(rep, rep_offset1, rep_offset2, offset_saved1, offset_saved2);
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_fast`
pub(crate) fn compress_block_fast(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    match ms.c_params.min_match {
        5 => compress_block_fast_no_dict_generic::<5>(ms, seq_store, rep, src),
        6 => compress_block_fast_no_dict_generic::<6>(ms, seq_store, rep, src),
        7 => compress_block_fast_no_dict_generic::<7>(ms, seq_store, rep, src),
        _ => compress_block_fast_no_dict_generic::<4>(ms, seq_store, rep, src),
    }
}

/// `ZSTD_compressBlock_fast_dictMatchState_generic`
fn compress_block_fast_dict_match_state_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    const K_STEP_INCR: usize = 1 << K_SEARCH_STRENGTH;

    let hlog = ms.c_params.hash_log;
    let target_length = ms.c_params.target_length;
    let step_size = (target_length + u32::from(target_length == 0)) as usize;
    let buf = src.buf;
    let istart = src.start;
    let iend = src.end;
    let prefix_start_index = ms.window.dict_limit;
    let prefix_start = src.pos_of(prefix_start_index);
    // Nothing is looked for in a block this short.
    let Some(ilimit) = iend.checked_sub(HASH_READ_SIZE) else {
        return Ok(iend - istart);
    };
    let [mut offset_1, mut offset_2, _] = *rep;

    let dms = src.dms.as_ref().ok_or(BUG)?;
    let dict_hash_table = dms.ms.hash_table.as_slice();
    let dict_start_index = dms.ms.window.dict_limit;
    let dict_start = dms.pos_of(dict_start_index);
    let dict_end = dms.end;
    // What to subtract from an index below prefix_start_index to get the index in the dictionary.
    let dict_index_delta = prefix_start_index.wrapping_sub(dict_end.wrapping_sub(dms.base) as u32);
    let dict_and_prefix_length = istart
        .wrapping_sub(prefix_start)
        .wrapping_add(dict_end)
        .wrapping_sub(dict_start) as u32;
    let dict_h_bits = dms.ms.c_params.hash_log + ZSTD_SHORT_CACHE_TAG_BITS;

    let locate = |index: u32| {
        if index < prefix_start_index {
            Located {
                buf: dms.buf,
                pos: dms.pos_of(index.wrapping_sub(dict_index_delta)),
                start: dict_start,
                end: dict_end,
            }
        } else {
            Located {
                buf,
                pos: src.pos_of(index),
                start: prefix_start,
                end: iend,
            }
        }
    };
    let hash_table = ms.hash_table.as_mut_slice();

    let mut anchor = istart;
    let mut ip0 = istart + usize::from(dict_and_prefix_length == 0);
    let mut ip1 = istart + step_size;

    'search: while ip1 <= ilimit {
        let mut hash0 = hash_ptr(buf, ip0, hlog, MLS)?;

        let dict_hash_and_tag0 = hash_ptr(buf, ip0, dict_h_bits, MLS)?;
        let mut dict_match_index_and_tag =
            dict_hash_table.at(dict_hash_and_tag0 >> ZSTD_SHORT_CACHE_TAG_BITS)?;
        let mut dict_tags_match =
            compare_packed_tags(dict_match_index_and_tag as usize, dict_hash_and_tag0);

        let mut match_index = hash_table.at(hash0)?;
        let mut curr = src.index_of(ip0);
        let mut step = step_size;
        let mut next_step = ip0 + K_STEP_INCR;

        let m_length = loop {
            let rep_index = curr.wrapping_add(1).wrapping_sub(offset_1);
            let rep_match = locate(rep_index);
            let hash1 = hash_ptr(buf, ip1, hlog, MLS)?;
            let dict_hash_and_tag1 = hash_ptr(buf, ip1, dict_h_bits, MLS)?;
            hash_table.put(hash0, curr)?;

            if index_overlap_check(prefix_start_index, rep_index)
                && read_le32(rep_match.buf, rep_match.pos)? == read_le32(buf, ip0 + 1)?
            {
                let m_length = count_2segments(
                    buf,
                    ip0 + 1 + 4,
                    rep_match.buf,
                    rep_match.pos + 4,
                    iend,
                    rep_match.end,
                    prefix_start,
                )? + 4;
                ip0 += 1;
                seq_store.store_seq(ip0 - anchor, buf, anchor, REPCODE1_TO_OFFBASE, m_length)?;
                break m_length;
            }

            if dict_tags_match {
                let dict_match_index = dict_match_index_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS;
                let dict_match = dms.pos_of(dict_match_index);
                // A match in the dictionary is only taken if there is no candidate in the prefix.
                if dict_match_index > dict_start_index
                    && read_le32(dms.buf, dict_match)? == read_le32(buf, ip0)?
                    && match_index <= prefix_start_index
                {
                    let offset = curr
                        .wrapping_sub(dict_match_index)
                        .wrapping_sub(dict_index_delta);
                    let mut m_length = count_2segments(
                        buf,
                        ip0 + 4,
                        dms.buf,
                        dict_match + 4,
                        iend,
                        dict_end,
                        prefix_start,
                    )? + 4;
                    let back = count_backwards(buf, ip0, anchor, dms.buf, dict_match, dict_start);
                    ip0 -= back;
                    m_length += back;
                    offset_2 = offset_1;
                    offset_1 = offset;
                    seq_store.store_seq(
                        ip0 - anchor,
                        buf,
                        anchor,
                        offset_to_offbase(offset),
                        m_length,
                    )?;
                    break m_length;
                }
            }

            let match_pos = src.pos_of(match_index);
            if match4_found(buf, ip0, match_pos, match_index, prefix_start_index)? {
                let offset = ip0.wrapping_sub(match_pos) as u32;
                let mut m_length = count(buf, ip0 + 4, buf, match_pos + 4, iend)? + 4;
                let back = count_backwards(buf, ip0, anchor, buf, match_pos, prefix_start);
                ip0 -= back;
                m_length += back;
                offset_2 = offset_1;
                offset_1 = offset;
                seq_store.store_seq(
                    ip0 - anchor,
                    buf,
                    anchor,
                    offset_to_offbase(offset),
                    m_length,
                )?;
                break m_length;
            }

            dict_match_index_and_tag =
                dict_hash_table.at(dict_hash_and_tag1 >> ZSTD_SHORT_CACHE_TAG_BITS)?;
            dict_tags_match =
                compare_packed_tags(dict_match_index_and_tag as usize, dict_hash_and_tag1);
            match_index = hash_table.at(hash1)?;

            if ip1 >= next_step {
                step += 1;
                next_step += K_STEP_INCR;
            }
            ip0 = ip1;
            ip1 += step;
            if ip1 > ilimit {
                break 'search;
            }

            curr = src.index_of(ip0);
            hash0 = hash1;
        };

        ip0 += m_length;
        anchor = ip0;

        if ip0 <= ilimit {
            hash_table.put(hash_ptr(buf, src.pos_of(curr + 2), hlog, MLS)?, curr + 2)?;
            hash_table.put(hash_ptr(buf, ip0 - 2, hlog, MLS)?, src.index_of(ip0 - 2))?;

            while ip0 <= ilimit {
                let current2 = src.index_of(ip0);
                let rep_index2 = current2.wrapping_sub(offset_2);
                let rep_match2 = locate(rep_index2);
                if !(index_overlap_check(prefix_start_index, rep_index2)
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(buf, ip0)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    buf,
                    ip0 + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    iend,
                    rep_match2.end,
                    prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_table.put(hash_ptr(buf, ip0, hlog, MLS)?, current2)?;
                ip0 += rep_length2;
                anchor = ip0;
            }
        }

        ip1 = ip0 + step_size;
    }

    let [rep0, rep1, _] = rep;
    *rep0 = offset_1;
    *rep1 = offset_2;
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_fast_dictMatchState`
pub(crate) fn compress_block_fast_dict_match_state(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    match ms.c_params.min_match {
        5 => compress_block_fast_dict_match_state_generic::<5>(ms, seq_store, rep, src),
        6 => compress_block_fast_dict_match_state_generic::<6>(ms, seq_store, rep, src),
        7 => compress_block_fast_dict_match_state_generic::<7>(ms, seq_store, rep, src),
        _ => compress_block_fast_dict_match_state_generic::<4>(ms, seq_store, rep, src),
    }
}

/// `ZSTD_compressBlock_fast_extDict_generic`
fn compress_block_fast_ext_dict_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    const K_STEP_INCR: usize = 1 << (K_SEARCH_STRENGTH - 1);

    let hlog = ms.c_params.hash_log;
    let target_length = ms.c_params.target_length;
    let step_size = (target_length + u32::from(target_length == 0) + 1) as usize;
    let buf = src.buf;
    let istart = src.start;
    let iend = src.end;
    let end_index = src.index_of(iend);
    let low_limit = ms.get_lowest_match_index(end_index, ms.c_params.window_log);
    let dict_start_index = low_limit;
    let dict_start = src.dict_pos_of(dict_start_index);
    let dict_limit = ms.window.dict_limit;
    let prefix_start_index = dict_limit.max(low_limit);
    let prefix_start = src.pos_of(prefix_start_index);
    let dict_end = src.dict_pos_of(prefix_start_index);

    // Nothing of the older segment is within reach.
    if prefix_start_index == dict_start_index {
        return compress_block_fast(ms, seq_store, rep, src);
    }
    // Nothing is looked for in a block this short.
    let Some(ilimit) = iend.checked_sub(HASH_READ_SIZE) else {
        return Ok(iend - istart);
    };

    let mut anchor = istart;
    let mut ip0 = istart;
    let [mut offset_1, mut offset_2, _] = *rep;
    let (mut offset_saved1, mut offset_saved2) = (0, 0);
    {
        let curr = src.index_of(ip0);
        let max_rep = curr.wrapping_sub(dict_start_index);
        if offset_2 >= max_rep {
            offset_saved2 = offset_2;
            offset_2 = 0;
        }
        if offset_1 >= max_rep {
            offset_saved1 = offset_1;
            offset_1 = 0;
        }
    }

    let locate = |index: u32| {
        if index < prefix_start_index {
            Located {
                buf: src.dict_buf,
                pos: src.dict_pos_of(index),
                start: dict_start,
                end: dict_end,
            }
        } else {
            Located {
                buf,
                pos: src.pos_of(index),
                start: prefix_start,
                end: iend,
            }
        }
    };
    // Whether there is a match for the position `ip` at `idx`, which is from the table.
    let match_found = |ip: usize, idx: u32| -> Result<bool> {
        let candidate = locate(idx);
        Ok(idx >= dict_start_index
            && read_le32(candidate.buf, candidate.pos)? == read_le32(buf, ip)?)
    };
    let hash_table = ms.hash_table.as_mut_slice();

    'start: loop {
        let mut step = step_size;
        let mut next_step = ip0 + K_STEP_INCR;

        let mut ip1 = ip0 + 1;
        let mut ip2 = ip0 + step;
        let mut ip3 = ip2 + 1;
        if ip3 >= ilimit {
            break 'start;
        }

        let mut hash0 = hash_ptr(buf, ip0, hlog, MLS)?;
        let mut hash1 = hash_ptr(buf, ip1, hlog, MLS)?;
        let mut idx = hash_table.at(hash0)?;
        let mut current0;

        // Ends with the start and the length so far of a repeat match, or with `None` for a match at `idx`.
        let rep_match = loop {
            let current2 = src.index_of(ip2);
            let rep_index = current2.wrapping_sub(offset_1);
            let mut rep_match = locate(rep_index);
            // The 4 bytes have to be in one segment, with a byte before them.
            let rep_found = ((prefix_start_index.wrapping_sub(rep_index) >= 4) & (offset_1 > 0))
                && read_le32(rep_match.buf, rep_match.pos)? == read_le32(buf, ip2)?;

            current0 = src.index_of(ip0);
            hash_table.put(hash0, current0)?;

            if rep_found {
                ip0 = ip2;
                let back = usize::from(
                    buf.at(ip0 - 1)? == rep_match.buf.at(rep_match.pos.wrapping_sub(1))?,
                );
                ip0 -= back;
                rep_match.pos = rep_match.pos.wrapping_sub(back);
                break Some((rep_match, 4 + back));
            }

            if match_found(ip0, idx)? {
                break None;
            }

            idx = hash_table.at(hash1)?;
            hash0 = hash1;
            hash1 = hash_ptr(buf, ip2, hlog, MLS)?;

            ip0 = ip1;
            ip1 = ip2;
            ip2 = ip3;

            current0 = src.index_of(ip0);
            hash_table.put(hash0, current0)?;

            if match_found(ip0, idx)? {
                break None;
            }

            idx = hash_table.at(hash1)?;
            hash0 = hash1;
            hash1 = hash_ptr(buf, ip2, hlog, MLS)?;

            ip0 = ip1;
            ip1 = ip2;
            ip2 = ip0 + step;
            ip3 = ip1 + step;

            if ip2 >= next_step {
                step += 1;
                next_step += K_STEP_INCR;
            }
            if ip3 >= ilimit {
                break 'start;
            }
        };

        let (offcode, match0, mut m_length) = match rep_match {
            Some((match0, m_length)) => (REPCODE1_TO_OFFBASE, match0, m_length),
            None => {
                let offset = current0.wrapping_sub(idx);
                let mut match0 = locate(idx);
                offset_2 = offset_1;
                offset_1 = offset;
                let back = count_backwards(buf, ip0, anchor, match0.buf, match0.pos, match0.start);
                ip0 -= back;
                match0.pos -= back;
                (offset_to_offbase(offset), match0, 4 + back)
            }
        };

        m_length += count_2segments(
            buf,
            ip0 + m_length,
            match0.buf,
            match0.pos + m_length,
            iend,
            match0.end,
            prefix_start,
        )?;
        seq_store.store_seq(ip0 - anchor, buf, anchor, offcode, m_length)?;
        ip0 += m_length;
        anchor = ip0;

        if ip1 < ip0 {
            hash_table.put(hash1, src.index_of(ip1))?;
        }

        if ip0 <= ilimit {
            hash_table.put(
                hash_ptr(buf, src.pos_of(current0 + 2), hlog, MLS)?,
                current0 + 2,
            )?;
            hash_table.put(hash_ptr(buf, ip0 - 2, hlog, MLS)?, src.index_of(ip0 - 2))?;

            while ip0 <= ilimit {
                let rep_index2 = src.index_of(ip0).wrapping_sub(offset_2);
                let rep_match2 = locate(rep_index2);
                if !((index_overlap_check(prefix_start_index, rep_index2) & (offset_2 > 0))
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(buf, ip0)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    buf,
                    ip0 + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    iend,
                    rep_match2.end,
                    prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_table.put(hash_ptr(buf, ip0, hlog, MLS)?, src.index_of(ip0))?;
                ip0 += rep_length2;
                anchor = ip0;
            }
        }
    }

    restore_rep(rep, offset_1, offset_2, offset_saved1, offset_saved2);
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_fast_extDict`
pub(crate) fn compress_block_fast_ext_dict(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    match ms.c_params.min_match {
        5 => compress_block_fast_ext_dict_generic::<5>(ms, seq_store, rep, src),
        6 => compress_block_fast_ext_dict_generic::<6>(ms, seq_store, rep, src),
        7 => compress_block_fast_ext_dict_generic::<7>(ms, seq_store, rep, src),
        _ => compress_block_fast_ext_dict_generic::<4>(ms, seq_store, rep, src),
    }
}
