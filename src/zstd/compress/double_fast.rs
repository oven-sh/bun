//! `zstd_double_fast.c`: the `dfast` strategy, which looks up a table of long hashes and a table of short ones.

use super::fast::{FAST_HASH_FILL_STEP, Located, count_backwards, restore_rep};
use super::internal::{
    BlockSrc, DictTableLoadMethod, HASH_READ_SIZE, K_SEARCH_STRENGTH, MatchState, Prefix,
    REPCODE1_TO_OFFBASE, SeqStore, TableFillPurpose, ZSTD_SHORT_CACHE_TAG_BITS,
    compare_packed_tags, count, count_2segments, hash_ptr, index_overlap_check, offset_to_offbase,
    write_tagged_index,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::Result;
use crate::util::{BUG, SliceExt, read_le32, read_le64};

/// `ZSTD_fillDoubleHashTableForCDict`
fn fill_double_hash_table_for_cdict(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
) -> Result<()> {
    let h_bits_l = ms.c_params.hash_log + ZSTD_SHORT_CACHE_TAG_BITS;
    let h_bits_s = ms.c_params.chain_log + ZSTD_SHORT_CACHE_TAG_BITS;
    let mls = ms.c_params.min_match;
    let hash_large = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();
    let buf = prefix.buf;
    let mut ip = prefix.pos_of(ms.next_to_update);
    let Some(iend) = end.checked_sub(HASH_READ_SIZE) else {
        return Ok(());
    };

    // The positions in between only go in the table of long hashes, where there is nothing yet.
    while ip + FAST_HASH_FILL_STEP as usize - 1 <= iend {
        let curr = prefix.index_of(ip);
        for i in 0..FAST_HASH_FILL_STEP {
            let sm_hash_and_tag = hash_ptr(buf, ip + i as usize, h_bits_s, mls)?;
            let lg_hash_and_tag = hash_ptr(buf, ip + i as usize, h_bits_l, 8)?;
            if i == 0 {
                write_tagged_index(hash_small, sm_hash_and_tag, curr + i)?;
            }
            if i == 0 || hash_large.at(lg_hash_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS)? == 0 {
                write_tagged_index(hash_large, lg_hash_and_tag, curr + i)?;
            }
            if dtlm == DictTableLoadMethod::Fast {
                break;
            }
        }
        ip += FAST_HASH_FILL_STEP as usize;
    }
    Ok(())
}

/// `ZSTD_fillDoubleHashTableForCCtx`
fn fill_double_hash_table_for_cctx(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
) -> Result<()> {
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let mls = ms.c_params.min_match;
    let hash_large = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();
    let buf = prefix.buf;
    let mut ip = prefix.pos_of(ms.next_to_update);
    let Some(iend) = end.checked_sub(HASH_READ_SIZE) else {
        return Ok(());
    };

    // The positions in between only go in the table of long hashes, where there is nothing yet.
    while ip + FAST_HASH_FILL_STEP as usize - 1 <= iend {
        let curr = prefix.index_of(ip);
        for i in 0..FAST_HASH_FILL_STEP {
            let sm_hash = hash_ptr(buf, ip + i as usize, h_bits_s, mls)?;
            let lg_hash = hash_ptr(buf, ip + i as usize, h_bits_l, 8)?;
            if i == 0 {
                hash_small.put(sm_hash, curr + i)?;
            }
            if i == 0 || hash_large.at(lg_hash)? == 0 {
                hash_large.put(lg_hash, curr + i)?;
            }
            if dtlm == DictTableLoadMethod::Fast {
                break;
            }
        }
        ip += FAST_HASH_FILL_STEP as usize;
    }
    Ok(())
}

/// `ZSTD_fillDoubleHashTable`: indexes the segment from `ms.next_to_update` up to the position `end`.
pub(crate) fn fill_double_hash_table(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
    tfp: TableFillPurpose,
) -> Result<()> {
    match tfp {
        TableFillPurpose::ForCDict => fill_double_hash_table_for_cdict(ms, prefix, end, dtlm),
        TableFillPurpose::ForCCtx => fill_double_hash_table_for_cctx(ms, prefix, end, dtlm),
    }
}

/// `ZSTD_compressBlock_doubleFast_noDict_generic`
fn compress_block_double_fast_no_dict_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    const K_STEP_INCR: usize = 1 << K_SEARCH_STRENGTH;

    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let window_log = ms.c_params.window_log;
    let buf = src.buf.sub(..src.end)?;
    let istart = src.start;
    let iend = src.end;
    let end_index = src.index_of(iend);
    let prefix_lowest_index = ms.get_lowest_prefix_index(end_index, window_log);
    let prefix_lowest = src.pos_of(prefix_lowest_index);
    // Nothing is looked for in a block this short.
    let Some(ilimit) = iend.checked_sub(HASH_READ_SIZE) else {
        return Ok(iend - istart);
    };

    let mut anchor = istart;
    let mut ip = istart + usize::from(istart == prefix_lowest);
    let [mut offset_1, mut offset_2, _] = *rep;
    let (mut offset_saved1, mut offset_saved2) = (0, 0);
    {
        let current = src.index_of(ip);
        let window_low = ms.get_lowest_prefix_index(current, window_log);
        let max_rep = current.wrapping_sub(window_low);
        if offset_2 > max_rep {
            offset_saved2 = offset_2;
            offset_2 = 0;
        }
        if offset_1 > max_rep {
            offset_saved1 = offset_1;
            offset_1 = 0;
        }
    }
    let hash_long = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();

    // One turn per match.
    'start: loop {
        let mut step = 1usize;
        let mut next_step = ip + K_STEP_INCR;
        let mut ip1 = ip + step;
        if ip1 > ilimit {
            break 'start;
        }

        let mut hl0 = hash_ptr(buf, ip, h_bits_l, 8)?;
        let mut idxl0 = hash_long.at(hl0)?;
        let mut curr;

        let m_length = 'match_stored: {
            // One turn per position. Ends with the offset and the length of a match, which `ip` is moved to the start
            // of.
            let (offset, m_length, hl1) = loop {
                let hs0 = hash_ptr(buf, ip, h_bits_s, MLS)?;
                let idxs0 = hash_small.at(hs0)?;
                curr = src.index_of(ip);
                hash_long.put(hl0, curr)?;
                hash_small.put(hs0, curr)?;

                if (offset_1 > 0)
                    & (read_le32(buf, (ip + 1).wrapping_sub(offset_1 as usize))?
                        == read_le32(buf, ip + 1)?)
                {
                    let m_length = count(
                        buf,
                        ip + 1 + 4,
                        buf,
                        (ip + 1 + 4).wrapping_sub(offset_1 as usize),
                        iend,
                    )? + 4;
                    ip += 1;
                    seq_store.store_seq(ip - anchor, buf, anchor, REPCODE1_TO_OFFBASE, m_length)?;
                    break 'match_stored m_length;
                }

                let hl1 = hash_ptr(buf, ip1, h_bits_l, 8)?;

                let matchl0 = src.pos_of(idxl0);
                if idxl0 >= prefix_lowest_index && read_le64(buf, matchl0)? == read_le64(buf, ip)? {
                    let m_length = count(buf, ip + 8, buf, matchl0 + 8, iend)? + 8;
                    let offset = ip.wrapping_sub(matchl0) as u32;
                    let back = count_backwards(buf, ip, anchor, buf, matchl0, prefix_lowest);
                    ip -= back;
                    break (offset, m_length + back, hl1);
                }

                let idxl1 = hash_long.at(hl1)?;

                let mut matchs0 = src.pos_of(idxs0);
                if idxs0 >= prefix_lowest_index && read_le32(buf, matchs0)? == read_le32(buf, ip)? {
                    // A short match: a longer one at the next position is preferred.
                    let mut m_length = count(buf, ip + 4, buf, matchs0 + 4, iend)? + 4;
                    let mut offset = ip.wrapping_sub(matchs0) as u32;
                    let matchl1 = src.pos_of(idxl1);
                    if idxl1 > prefix_lowest_index
                        && read_le64(buf, matchl1)? == read_le64(buf, ip1)?
                    {
                        let l1len = count(buf, ip1 + 8, buf, matchl1 + 8, iend)? + 8;
                        if l1len > m_length {
                            ip = ip1;
                            m_length = l1len;
                            offset = ip.wrapping_sub(matchl1) as u32;
                            matchs0 = matchl1;
                        }
                    }
                    let back = count_backwards(buf, ip, anchor, buf, matchs0, prefix_lowest);
                    ip -= back;
                    break (offset, m_length + back, hl1);
                }

                if ip1 >= next_step {
                    step += 1;
                    next_step += K_STEP_INCR;
                }
                ip = ip1;
                ip1 += step;

                hl0 = hl1;
                idxl0 = idxl1;
                if ip1 > ilimit {
                    break 'start;
                }
            };

            offset_2 = offset_1;
            offset_1 = offset;
            // With a larger step, ip1 may be past the end of the match.
            if step < 4 {
                hash_long.put(hl1, src.index_of(ip1))?;
            }
            seq_store.store_seq(
                ip - anchor,
                buf,
                anchor,
                offset_to_offbase(offset),
                m_length,
            )?;
            m_length
        };

        ip += m_length;
        anchor = ip;

        if ip <= ilimit {
            let index_to_insert = curr + 2;
            let to_insert = src.pos_of(index_to_insert);
            hash_long.put(hash_ptr(buf, to_insert, h_bits_l, 8)?, index_to_insert)?;
            hash_long.put(hash_ptr(buf, ip - 2, h_bits_l, 8)?, src.index_of(ip - 2))?;
            hash_small.put(hash_ptr(buf, to_insert, h_bits_s, MLS)?, index_to_insert)?;
            hash_small.put(hash_ptr(buf, ip - 1, h_bits_s, MLS)?, src.index_of(ip - 1))?;

            while ip <= ilimit
                && (offset_2 > 0)
                    & (read_le32(buf, ip)? == read_le32(buf, ip.wrapping_sub(offset_2 as usize))?)
            {
                let r_length = count(
                    buf,
                    ip + 4,
                    buf,
                    (ip + 4).wrapping_sub(offset_2 as usize),
                    iend,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                hash_small.put(hash_ptr(buf, ip, h_bits_s, MLS)?, src.index_of(ip))?;
                hash_long.put(hash_ptr(buf, ip, h_bits_l, 8)?, src.index_of(ip))?;
                seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, r_length)?;
                ip += r_length;
                anchor = ip;
            }
        }
    }

    restore_rep(rep, offset_1, offset_2, offset_saved1, offset_saved2);
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_doubleFast_dictMatchState_generic`
fn compress_block_double_fast_dict_match_state_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let buf = src.buf.sub(..src.end)?;
    let istart = src.start;
    let iend = src.end;
    let end_index = src.index_of(iend);
    let prefix_lowest_index = ms.get_lowest_prefix_index(end_index, ms.c_params.window_log);
    let prefix_lowest = src.pos_of(prefix_lowest_index);
    // Nothing is looked for in a block this short.
    let Some(ilimit) = iend.checked_sub(HASH_READ_SIZE) else {
        return Ok(iend - istart);
    };
    let [mut offset_1, mut offset_2, _] = *rep;

    let dms = src.dms.as_ref().ok_or(BUG)?;
    let dict_hash_long = dms.ms.hash_table.as_slice();
    let dict_hash_small = dms.ms.chain_table.as_slice();
    let dict_start_index = dms.ms.window.dict_limit;
    let dict_start = dms.pos_of(dict_start_index);
    let dict_end = dms.end;
    // What to subtract from an index below prefix_lowest_index to get the index in the dictionary.
    let dict_index_delta = prefix_lowest_index.wrapping_sub(dict_end.wrapping_sub(dms.base) as u32);
    let dict_h_bits_l = dms.ms.c_params.hash_log + ZSTD_SHORT_CACHE_TAG_BITS;
    let dict_h_bits_s = dms.ms.c_params.chain_log + ZSTD_SHORT_CACHE_TAG_BITS;
    let dict_and_prefix_length = istart
        .wrapping_sub(prefix_lowest)
        .wrapping_add(dict_end.wrapping_sub(dict_start)) as u32;

    let locate = |index: u32| {
        if index < prefix_lowest_index {
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
                start: prefix_lowest,
                end: iend,
            }
        }
    };
    let hash_long = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();

    let mut anchor = istart;
    let mut ip = istart + usize::from(dict_and_prefix_length == 0);

    'search: while ip < ilimit {
        let h2 = hash_ptr(buf, ip, h_bits_l, 8)?;
        let h = hash_ptr(buf, ip, h_bits_s, MLS)?;
        let dict_hash_and_tag_l = hash_ptr(buf, ip, dict_h_bits_l, 8)?;
        let dict_hash_and_tag_s = hash_ptr(buf, ip, dict_h_bits_s, MLS)?;
        let dict_match_index_and_tag_l =
            dict_hash_long.at(dict_hash_and_tag_l >> ZSTD_SHORT_CACHE_TAG_BITS)?;
        let dict_match_index_and_tag_s =
            dict_hash_small.at(dict_hash_and_tag_s >> ZSTD_SHORT_CACHE_TAG_BITS)?;
        let dict_tags_match_l =
            compare_packed_tags(dict_match_index_and_tag_l as usize, dict_hash_and_tag_l);
        let dict_tags_match_s =
            compare_packed_tags(dict_match_index_and_tag_s as usize, dict_hash_and_tag_s);
        let curr = src.index_of(ip);
        let match_index_l = hash_long.at(h2)?;
        let mut match_index_s = hash_small.at(h)?;
        let rep_index = curr.wrapping_add(1).wrapping_sub(offset_1);
        let rep_match = locate(rep_index);
        hash_long.put(h2, curr)?;
        hash_small.put(h, curr)?;

        let m_length = 'match_stored: {
            if index_overlap_check(prefix_lowest_index, rep_index)
                && read_le32(rep_match.buf, rep_match.pos)? == read_le32(buf, ip + 1)?
            {
                let m_length = count_2segments(
                    buf,
                    ip + 1 + 4,
                    rep_match.buf,
                    rep_match.pos + 4,
                    iend,
                    rep_match.end,
                    prefix_lowest,
                )? + 4;
                ip += 1;
                seq_store.store_seq(ip - anchor, buf, anchor, REPCODE1_TO_OFFBASE, m_length)?;
                break 'match_stored m_length;
            }

            // The offset and the length of a match, which `ip` is moved to the start of.
            let (offset, m_length) = 'match_found: {
                let match_long = src.pos_of(match_index_l);
                if match_index_l >= prefix_lowest_index
                    && read_le64(buf, match_long)? == read_le64(buf, ip)?
                {
                    let m_length = count(buf, ip + 8, buf, match_long + 8, iend)? + 8;
                    let offset = ip.wrapping_sub(match_long) as u32;
                    let back = count_backwards(buf, ip, anchor, buf, match_long, prefix_lowest);
                    ip -= back;
                    break 'match_found (offset, m_length + back);
                } else if dict_tags_match_l {
                    let dict_match_index_l =
                        dict_match_index_and_tag_l >> ZSTD_SHORT_CACHE_TAG_BITS;
                    let dict_match_l = dms.pos_of(dict_match_index_l);
                    if dict_match_index_l > dict_start_index
                        && read_le64(dms.buf, dict_match_l)? == read_le64(buf, ip)?
                    {
                        let m_length = count_2segments(
                            buf,
                            ip + 8,
                            dms.buf,
                            dict_match_l + 8,
                            iend,
                            dict_end,
                            prefix_lowest,
                        )? + 8;
                        let offset = curr
                            .wrapping_sub(dict_match_index_l)
                            .wrapping_sub(dict_index_delta);
                        let back =
                            count_backwards(buf, ip, anchor, dms.buf, dict_match_l, dict_start);
                        ip -= back;
                        break 'match_found (offset, m_length + back);
                    }
                }

                let short_found = if match_index_s > prefix_lowest_index {
                    read_le32(buf, src.pos_of(match_index_s))? == read_le32(buf, ip)?
                } else if dict_tags_match_s {
                    let dict_match_index_s =
                        dict_match_index_and_tag_s >> ZSTD_SHORT_CACHE_TAG_BITS;
                    match_index_s = dict_match_index_s.wrapping_add(dict_index_delta);
                    dict_match_index_s > dict_start_index
                        && read_le32(dms.buf, dms.pos_of(dict_match_index_s))?
                            == read_le32(buf, ip)?
                } else {
                    false
                };
                if !short_found {
                    ip += ((ip - anchor) >> K_SEARCH_STRENGTH) + 1;
                    continue 'search;
                }

                // A short match: a long one at the next position is preferred.
                let hl3 = hash_ptr(buf, ip + 1, h_bits_l, 8)?;
                let dict_hash_and_tag_l3 = hash_ptr(buf, ip + 1, dict_h_bits_l, 8)?;
                let match_index_l3 = hash_long.at(hl3)?;
                let dict_match_index_and_tag_l3 =
                    dict_hash_long.at(dict_hash_and_tag_l3 >> ZSTD_SHORT_CACHE_TAG_BITS)?;
                let dict_tags_match_l3 =
                    compare_packed_tags(dict_match_index_and_tag_l3 as usize, dict_hash_and_tag_l3);
                let match_l3 = src.pos_of(match_index_l3);
                hash_long.put(hl3, curr + 1)?;

                if match_index_l3 >= prefix_lowest_index
                    && read_le64(buf, match_l3)? == read_le64(buf, ip + 1)?
                {
                    let m_length = count(buf, ip + 9, buf, match_l3 + 8, iend)? + 8;
                    ip += 1;
                    let offset = ip.wrapping_sub(match_l3) as u32;
                    let back = count_backwards(buf, ip, anchor, buf, match_l3, prefix_lowest);
                    ip -= back;
                    break 'match_found (offset, m_length + back);
                } else if dict_tags_match_l3 {
                    let dict_match_index_l3 =
                        dict_match_index_and_tag_l3 >> ZSTD_SHORT_CACHE_TAG_BITS;
                    let dict_match_l3 = dms.pos_of(dict_match_index_l3);
                    if dict_match_index_l3 > dict_start_index
                        && read_le64(dms.buf, dict_match_l3)? == read_le64(buf, ip + 1)?
                    {
                        let m_length = count_2segments(
                            buf,
                            ip + 1 + 8,
                            dms.buf,
                            dict_match_l3 + 8,
                            iend,
                            dict_end,
                            prefix_lowest,
                        )? + 8;
                        ip += 1;
                        let offset = curr
                            .wrapping_add(1)
                            .wrapping_sub(dict_match_index_l3)
                            .wrapping_sub(dict_index_delta);
                        let back =
                            count_backwards(buf, ip, anchor, dms.buf, dict_match_l3, dict_start);
                        ip -= back;
                        break 'match_found (offset, m_length + back);
                    }
                }

                let match_s = locate(match_index_s);
                let m_length = count_2segments(
                    buf,
                    ip + 4,
                    match_s.buf,
                    match_s.pos + 4,
                    iend,
                    match_s.end,
                    prefix_lowest,
                )? + 4;
                let offset = curr.wrapping_sub(match_index_s);
                let back =
                    count_backwards(buf, ip, anchor, match_s.buf, match_s.pos, match_s.start);
                ip -= back;
                (offset, m_length + back)
            };

            offset_2 = offset_1;
            offset_1 = offset;
            seq_store.store_seq(
                ip - anchor,
                buf,
                anchor,
                offset_to_offbase(offset),
                m_length,
            )?;
            m_length
        };

        ip += m_length;
        anchor = ip;

        if ip <= ilimit {
            let index_to_insert = curr + 2;
            let to_insert = src.pos_of(index_to_insert);
            hash_long.put(hash_ptr(buf, to_insert, h_bits_l, 8)?, index_to_insert)?;
            hash_long.put(hash_ptr(buf, ip - 2, h_bits_l, 8)?, src.index_of(ip - 2))?;
            hash_small.put(hash_ptr(buf, to_insert, h_bits_s, MLS)?, index_to_insert)?;
            hash_small.put(hash_ptr(buf, ip - 1, h_bits_s, MLS)?, src.index_of(ip - 1))?;

            while ip <= ilimit {
                let current2 = src.index_of(ip);
                let rep_index2 = current2.wrapping_sub(offset_2);
                let rep_match2 = locate(rep_index2);
                if !(index_overlap_check(prefix_lowest_index, rep_index2)
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(buf, ip)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    buf,
                    ip + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    iend,
                    rep_match2.end,
                    prefix_lowest,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_small.put(hash_ptr(buf, ip, h_bits_s, MLS)?, current2)?;
                hash_long.put(hash_ptr(buf, ip, h_bits_l, 8)?, current2)?;
                ip += rep_length2;
                anchor = ip;
            }
        }
    }

    let [rep0, rep1, _] = rep;
    *rep0 = offset_1;
    *rep1 = offset_2;
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_doubleFast`
pub(crate) fn compress_block_double_fast(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    match ms.c_params.min_match {
        5 => compress_block_double_fast_no_dict_generic::<5>(ms, seq_store, rep, src),
        6 => compress_block_double_fast_no_dict_generic::<6>(ms, seq_store, rep, src),
        7 => compress_block_double_fast_no_dict_generic::<7>(ms, seq_store, rep, src),
        _ => compress_block_double_fast_no_dict_generic::<4>(ms, seq_store, rep, src),
    }
}

/// `ZSTD_compressBlock_doubleFast_dictMatchState`
pub(crate) fn compress_block_double_fast_dict_match_state(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    match ms.c_params.min_match {
        5 => compress_block_double_fast_dict_match_state_generic::<5>(ms, seq_store, rep, src),
        6 => compress_block_double_fast_dict_match_state_generic::<6>(ms, seq_store, rep, src),
        7 => compress_block_double_fast_dict_match_state_generic::<7>(ms, seq_store, rep, src),
        _ => compress_block_double_fast_dict_match_state_generic::<4>(ms, seq_store, rep, src),
    }
}

/// `ZSTD_compressBlock_doubleFast_extDict_generic`
fn compress_block_double_fast_ext_dict_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let buf = src.buf.sub(..src.end)?;
    let istart = src.start;
    let iend = src.end;
    let end_index = src.index_of(iend);
    let low_limit = ms.get_lowest_match_index(end_index, ms.c_params.window_log);
    let dict_start_index = low_limit;
    let dict_limit = ms.window.dict_limit;
    let prefix_start_index = dict_limit.max(low_limit);
    let prefix_start = src.pos_of(prefix_start_index);
    let dict_start = src.dict_pos_of(dict_start_index);
    let dict_end = src.dict_pos_of(prefix_start_index);
    let [mut offset_1, mut offset_2, _] = *rep;

    // Nothing of the older segment is within reach.
    if prefix_start_index == dict_start_index {
        return compress_block_double_fast(ms, seq_store, rep, src);
    }
    // Nothing is looked for in a block this short.
    let Some(ilimit) = iend.checked_sub(HASH_READ_SIZE) else {
        return Ok(iend - istart);
    };

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
    let hash_long = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();

    let mut anchor = istart;
    let mut ip = istart;

    while ip < ilimit {
        let h_small = hash_ptr(buf, ip, h_bits_s, MLS)?;
        let match_index = hash_small.at(h_small)?;
        let match_s = locate(match_index);

        let h_long = hash_ptr(buf, ip, h_bits_l, 8)?;
        let match_long_index = hash_long.at(h_long)?;
        let match_long = locate(match_long_index);

        let curr = src.index_of(ip);
        let rep_index = curr.wrapping_add(1).wrapping_sub(offset_1);
        let rep_match = locate(rep_index);
        hash_long.put(h_long, curr)?;
        hash_small.put(h_small, curr)?;

        let m_length;
        if (index_overlap_check(prefix_start_index, rep_index)
            & (offset_1 <= curr.wrapping_add(1).wrapping_sub(dict_start_index)))
            && read_le32(rep_match.buf, rep_match.pos)? == read_le32(buf, ip + 1)?
        {
            m_length = count_2segments(
                buf,
                ip + 1 + 4,
                rep_match.buf,
                rep_match.pos + 4,
                iend,
                rep_match.end,
                prefix_start,
            )? + 4;
            ip += 1;
            seq_store.store_seq(ip - anchor, buf, anchor, REPCODE1_TO_OFFBASE, m_length)?;
        } else {
            // The match, how much of it is known, and its offset. `ip` is moved to where it is for.
            let (found, known, offset) = if match_long_index > dict_start_index
                && read_le64(match_long.buf, match_long.pos)? == read_le64(buf, ip)?
            {
                (match_long, 8, curr.wrapping_sub(match_long_index))
            } else if match_index > dict_start_index
                && read_le32(match_s.buf, match_s.pos)? == read_le32(buf, ip)?
            {
                // A short match: a long one at the next position is preferred.
                let h3 = hash_ptr(buf, ip + 1, h_bits_l, 8)?;
                let match_index3 = hash_long.at(h3)?;
                let match3 = locate(match_index3);
                hash_long.put(h3, curr + 1)?;
                if match_index3 > dict_start_index
                    && read_le64(match3.buf, match3.pos)? == read_le64(buf, ip + 1)?
                {
                    ip += 1;
                    (match3, 8, curr.wrapping_add(1).wrapping_sub(match_index3))
                } else {
                    (match_s, 4, curr.wrapping_sub(match_index))
                }
            } else {
                ip += ((ip - anchor) >> K_SEARCH_STRENGTH) + 1;
                continue;
            };
            let forwards = count_2segments(
                buf,
                ip + known,
                found.buf,
                found.pos + known,
                iend,
                found.end,
                prefix_start,
            )? + known;
            let back = count_backwards(buf, ip, anchor, found.buf, found.pos, found.start);
            ip -= back;
            m_length = forwards + back;
            offset_2 = offset_1;
            offset_1 = offset;
            seq_store.store_seq(
                ip - anchor,
                buf,
                anchor,
                offset_to_offbase(offset),
                m_length,
            )?;
        }

        ip += m_length;
        anchor = ip;

        if ip <= ilimit {
            let index_to_insert = curr + 2;
            let to_insert = src.pos_of(index_to_insert);
            hash_long.put(hash_ptr(buf, to_insert, h_bits_l, 8)?, index_to_insert)?;
            hash_long.put(hash_ptr(buf, ip - 2, h_bits_l, 8)?, src.index_of(ip - 2))?;
            hash_small.put(hash_ptr(buf, to_insert, h_bits_s, MLS)?, index_to_insert)?;
            hash_small.put(hash_ptr(buf, ip - 1, h_bits_s, MLS)?, src.index_of(ip - 1))?;

            while ip <= ilimit {
                let current2 = src.index_of(ip);
                let rep_index2 = current2.wrapping_sub(offset_2);
                let rep_match2 = locate(rep_index2);
                if !((index_overlap_check(prefix_start_index, rep_index2)
                    & (offset_2 <= current2.wrapping_sub(dict_start_index)))
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(buf, ip)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    buf,
                    ip + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    iend,
                    rep_match2.end,
                    prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_small.put(hash_ptr(buf, ip, h_bits_s, MLS)?, current2)?;
                hash_long.put(hash_ptr(buf, ip, h_bits_l, 8)?, current2)?;
                ip += rep_length2;
                anchor = ip;
            }
        }
    }

    let [rep0, rep1, _] = rep;
    *rep0 = offset_1;
    *rep1 = offset_2;
    Ok(iend - anchor)
}

/// `ZSTD_compressBlock_doubleFast_extDict`
pub(crate) fn compress_block_double_fast_ext_dict(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    match ms.c_params.min_match {
        5 => compress_block_double_fast_ext_dict_generic::<5>(ms, seq_store, rep, src),
        6 => compress_block_double_fast_ext_dict_generic::<6>(ms, seq_store, rep, src),
        7 => compress_block_double_fast_ext_dict_generic::<7>(ms, seq_store, rep, src),
        _ => compress_block_double_fast_ext_dict_generic::<4>(ms, seq_store, rep, src),
    }
}
