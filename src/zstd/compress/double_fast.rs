//! `zstd_double_fast.c`: the `dfast` strategy, which looks up a table of long hashes and a table of short ones.

use super::fast::{FAST_HASH_FILL_STEP, NoDictBlock, TwoSegments, count_backwards, restore_rep};
use super::internal::{
    BlockSrc, DictTableLoadMethod, HASH_READ_SIZE, K_SEARCH_STRENGTH, MatchState, Prefix,
    REPCODE1_TO_OFFBASE, SeqSink, SeqStore, TableFillPurpose, ZSTD_SHORT_CACHE_TAG_BITS,
    compare_packed_tags, count, count_2segments, hash_of, hash_ptr, hash8, index_overlap_check,
    offset_to_offbase, table_get, table_put, write_tagged_index,
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
    let h_bits_l = ms.tagged_hash_log();
    let h_bits_s = ms.tagged_chain_log();
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
    const K_STEP_INCR: u32 = 1 << K_SEARCH_STRENGTH;

    let Some(block) = NoDictBlock::new(ms, rep, src)? else {
        return Ok(src.end - src.start);
    };
    let NoDictBlock {
        near,
        base_index,
        candidates,
        prefix_lowest_index,
        prefix_lowest,
        ilimit,
        mut offset_1,
        mut offset_2,
        ..
    } = block;
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let mut anchor = block.istart;
    let mut ip = block.first;
    let mut seq_store = SeqSink::new(seq_store);
    let hash_long = ms.hash_table.sub_mut(..1 << h_bits_l)?;
    let hash_small = ms.chain_table.sub_mut(..1 << h_bits_s)?;

    // One turn per match.
    'start: loop {
        let mut step = 1;
        let mut next_step = ip + K_STEP_INCR;
        let mut ip1 = ip + step;
        if ip1 as usize > ilimit {
            break 'start;
        }

        // The 8 bytes at `ip`.
        let mut bytes0 = near.read64(ip).ok_or(BUG)?;
        let mut hl0 = hash8(bytes0, h_bits_l, 0);
        let mut idxl0 = table_get(hash_long, hl0);
        let mut curr;

        let m_length = 'match_stored: {
            // One turn per position. Ends with the offset and the length of a match, which `ip` is moved to the start
            // of.
            let (offset, m_length, hl1) = loop {
                let hs0 = hash_of::<MLS>(bytes0, h_bits_s);
                let idxs0 = table_get(hash_small, hs0);
                curr = base_index.wrapping_add(ip);
                table_put(hash_long, hl0, curr);
                table_put(hash_small, hs0, curr);

                if offset_1 > 0
                    && near.read32((ip + 1).wrapping_sub(offset_1)) == Some((bytes0 >> 8) as u32)
                {
                    ip += 1;
                    let m_length = near.count(ip + 4, (ip + 4).wrapping_sub(offset_1)) + 4;
                    seq_store.store_seq(
                        ip - anchor,
                        near,
                        anchor,
                        REPCODE1_TO_OFFBASE,
                        m_length,
                    )?;
                    break 'match_stored m_length;
                }

                let bytes1 = near.read64(ip1).ok_or(BUG)?;
                let hl1 = hash8(bytes1, h_bits_l, 0);

                if candidates.read64(idxl0.wrapping_sub(prefix_lowest_index)) == Some(bytes0) {
                    let matchl0 = idxl0 - base_index;
                    let m_length = near.count(ip + 8, matchl0 + 8) + 8;
                    let offset = ip - matchl0;
                    let back = near.count_backwards(ip, anchor, matchl0, prefix_lowest);
                    ip -= back;
                    break (offset, m_length + back, hl1);
                }

                let idxl1 = table_get(hash_long, hl1);

                if candidates.read32(idxs0.wrapping_sub(prefix_lowest_index)) == Some(bytes0 as u32)
                {
                    // A short match: a longer one at the next position is preferred.
                    let mut matchs0 = idxs0 - base_index;
                    let mut m_length = near.count(ip + 4, matchs0 + 4) + 4;
                    let mut offset = ip - matchs0;
                    let matchl1 = idxl1.wrapping_sub(base_index);
                    if idxl1 > prefix_lowest_index && near.read64(matchl1) == Some(bytes1) {
                        let l1len = near.count(ip1 + 8, matchl1 + 8) + 8;
                        if l1len > m_length {
                            ip = ip1;
                            m_length = l1len;
                            offset = ip - matchl1;
                            matchs0 = matchl1;
                        }
                    }
                    let back = near.count_backwards(ip, anchor, matchs0, prefix_lowest);
                    ip -= back;
                    break (offset, m_length + back, hl1);
                }

                if ip1 >= next_step {
                    step += 1;
                    next_step += K_STEP_INCR;
                }
                ip = ip1;
                ip1 += step;

                bytes0 = bytes1;
                hl0 = hl1;
                idxl0 = idxl1;
                if ip1 as usize > ilimit {
                    break 'start;
                }
            };

            offset_2 = offset_1;
            offset_1 = offset;
            // With a larger step, ip1 may be past the end of the match.
            if step < 4 {
                table_put(hash_long, hl1, base_index.wrapping_add(ip1));
            }
            seq_store.store_seq(
                ip - anchor,
                near,
                anchor,
                offset_to_offbase(offset),
                m_length,
            )?;
            m_length
        };

        ip += m_length;
        anchor = ip;

        if ip as usize <= ilimit {
            let index_to_insert = curr + 2;
            let to_insert = near.read64(index_to_insert - base_index).ok_or(BUG)?;
            let before2 = near.read64(ip - 2).ok_or(BUG)?;
            let before1 = near.read64(ip - 1).ok_or(BUG)?;
            table_put(hash_long, hash8(to_insert, h_bits_l, 0), index_to_insert);
            table_put(
                hash_long,
                hash8(before2, h_bits_l, 0),
                base_index.wrapping_add(ip - 2),
            );
            table_put(
                hash_small,
                hash_of::<MLS>(to_insert, h_bits_s),
                index_to_insert,
            );
            table_put(
                hash_small,
                hash_of::<MLS>(before1, h_bits_s),
                base_index.wrapping_add(ip - 1),
            );

            while ip as usize <= ilimit && offset_2 > 0 {
                let bytes = near.read64(ip).ok_or(BUG)?;
                if near.read32(ip.wrapping_sub(offset_2)) != Some(bytes as u32) {
                    break;
                }
                let r_length = near.count(ip + 4, (ip + 4).wrapping_sub(offset_2)) + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                let index = base_index.wrapping_add(ip);
                table_put(hash_small, hash_of::<MLS>(bytes, h_bits_s), index);
                table_put(hash_long, hash8(bytes, h_bits_l, 0), index);
                seq_store.store_seq(0, near, anchor, REPCODE1_TO_OFFBASE, r_length)?;
                ip += r_length;
                anchor = ip;
            }
        }
    }

    restore_rep(
        rep,
        offset_1,
        offset_2,
        block.offset_saved1,
        block.offset_saved2,
    );
    Ok((near.len() - anchor) as usize)
}

/// `ZSTD_compressBlock_doubleFast_dictMatchState_generic`
fn compress_block_double_fast_dict_match_state_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    seg: &TwoSegments<'_>,
) -> Result<usize> {
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let [mut offset_1, mut offset_2, _] = *rep;
    let hash_long = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();
    let dms = src.dms.as_ref().ok_or(BUG)?;
    let dict_hash_long = dms.ms.hash_table.as_slice();
    let dict_hash_small = dms.ms.chain_table.as_slice();
    let dict_h_bits_l = dms.ms.tagged_hash_log();
    let dict_h_bits_s = dms.ms.tagged_chain_log();

    let mut anchor = seg.istart;
    let mut ip = seg.first();

    'search: while ip < seg.ilimit {
        let h2 = hash_ptr(seg.buf, ip, h_bits_l, 8)?;
        let h = hash_ptr(seg.buf, ip, h_bits_s, MLS)?;
        let dict_hash_and_tag_l = hash_ptr(seg.buf, ip, dict_h_bits_l, 8)?;
        let dict_hash_and_tag_s = hash_ptr(seg.buf, ip, dict_h_bits_s, MLS)?;
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
        let rep_match = seg.locate(rep_index);
        hash_long.put(h2, curr)?;
        hash_small.put(h, curr)?;

        let m_length = 'match_stored: {
            if index_overlap_check(seg.prefix_start_index, rep_index)
                && read_le32(rep_match.buf, rep_match.pos)? == read_le32(seg.buf, ip + 1)?
            {
                let m_length = count_2segments(
                    seg.buf,
                    ip + 1 + 4,
                    rep_match.buf,
                    rep_match.pos + 4,
                    seg.iend,
                    rep_match.end,
                    seg.prefix_start,
                )? + 4;
                ip += 1;
                seq_store.store_seq(ip - anchor, seg.buf, anchor, REPCODE1_TO_OFFBASE, m_length)?;
                break 'match_stored m_length;
            }

            // The offset and the length of a match, which `ip` is moved to the start of.
            let (offset, m_length) = 'match_found: {
                let match_long = src.pos_of(match_index_l);
                if match_index_l >= seg.prefix_start_index
                    && read_le64(seg.buf, match_long)? == read_le64(seg.buf, ip)?
                {
                    let m_length = count(seg.buf, ip + 8, seg.buf, match_long + 8, seg.iend)? + 8;
                    let offset = ip.wrapping_sub(match_long) as u32;
                    let back =
                        count_backwards(seg.buf, ip, anchor, seg.buf, match_long, seg.prefix_start);
                    ip -= back;
                    break 'match_found (offset, m_length + back);
                } else if dict_tags_match_l {
                    let dict_match_index_l =
                        dict_match_index_and_tag_l >> ZSTD_SHORT_CACHE_TAG_BITS;
                    let dict_match_l = seg.dict_pos_of(dict_match_index_l);
                    if dict_match_index_l > seg.dict_start_index
                        && read_le64(seg.dict_buf, dict_match_l)? == read_le64(seg.buf, ip)?
                    {
                        let m_length = count_2segments(
                            seg.buf,
                            ip + 8,
                            seg.dict_buf,
                            dict_match_l + 8,
                            seg.iend,
                            seg.dict_end,
                            seg.prefix_start,
                        )? + 8;
                        let offset = curr
                            .wrapping_sub(dict_match_index_l)
                            .wrapping_sub(seg.dict_index_delta);
                        let back = count_backwards(
                            seg.buf,
                            ip,
                            anchor,
                            seg.dict_buf,
                            dict_match_l,
                            seg.dict_start,
                        );
                        ip -= back;
                        break 'match_found (offset, m_length + back);
                    }
                }

                let short_found = if match_index_s > seg.prefix_start_index {
                    read_le32(seg.buf, src.pos_of(match_index_s))? == read_le32(seg.buf, ip)?
                } else if dict_tags_match_s {
                    let dict_match_index_s =
                        dict_match_index_and_tag_s >> ZSTD_SHORT_CACHE_TAG_BITS;
                    match_index_s = dict_match_index_s.wrapping_add(seg.dict_index_delta);
                    dict_match_index_s > seg.dict_start_index
                        && read_le32(seg.dict_buf, seg.dict_pos_of(dict_match_index_s))?
                            == read_le32(seg.buf, ip)?
                } else {
                    false
                };
                if !short_found {
                    ip += ((ip - anchor) >> K_SEARCH_STRENGTH) + 1;
                    continue 'search;
                }

                // A short match: a long one at the next position is preferred.
                let hl3 = hash_ptr(seg.buf, ip + 1, h_bits_l, 8)?;
                let dict_hash_and_tag_l3 = hash_ptr(seg.buf, ip + 1, dict_h_bits_l, 8)?;
                let match_index_l3 = hash_long.at(hl3)?;
                let dict_match_index_and_tag_l3 =
                    dict_hash_long.at(dict_hash_and_tag_l3 >> ZSTD_SHORT_CACHE_TAG_BITS)?;
                let dict_tags_match_l3 =
                    compare_packed_tags(dict_match_index_and_tag_l3 as usize, dict_hash_and_tag_l3);
                let match_l3 = src.pos_of(match_index_l3);
                hash_long.put(hl3, curr + 1)?;

                if match_index_l3 >= seg.prefix_start_index
                    && read_le64(seg.buf, match_l3)? == read_le64(seg.buf, ip + 1)?
                {
                    let m_length = count(seg.buf, ip + 9, seg.buf, match_l3 + 8, seg.iend)? + 8;
                    ip += 1;
                    let offset = ip.wrapping_sub(match_l3) as u32;
                    let back =
                        count_backwards(seg.buf, ip, anchor, seg.buf, match_l3, seg.prefix_start);
                    ip -= back;
                    break 'match_found (offset, m_length + back);
                } else if dict_tags_match_l3 {
                    let dict_match_index_l3 =
                        dict_match_index_and_tag_l3 >> ZSTD_SHORT_CACHE_TAG_BITS;
                    let dict_match_l3 = seg.dict_pos_of(dict_match_index_l3);
                    if dict_match_index_l3 > seg.dict_start_index
                        && read_le64(seg.dict_buf, dict_match_l3)? == read_le64(seg.buf, ip + 1)?
                    {
                        let m_length = count_2segments(
                            seg.buf,
                            ip + 1 + 8,
                            seg.dict_buf,
                            dict_match_l3 + 8,
                            seg.iend,
                            seg.dict_end,
                            seg.prefix_start,
                        )? + 8;
                        ip += 1;
                        let offset = curr
                            .wrapping_add(1)
                            .wrapping_sub(dict_match_index_l3)
                            .wrapping_sub(seg.dict_index_delta);
                        let back = count_backwards(
                            seg.buf,
                            ip,
                            anchor,
                            seg.dict_buf,
                            dict_match_l3,
                            seg.dict_start,
                        );
                        ip -= back;
                        break 'match_found (offset, m_length + back);
                    }
                }

                let match_s = seg.locate(match_index_s);
                let m_length = count_2segments(
                    seg.buf,
                    ip + 4,
                    match_s.buf,
                    match_s.pos + 4,
                    seg.iend,
                    match_s.end,
                    seg.prefix_start,
                )? + 4;
                let offset = curr.wrapping_sub(match_index_s);
                let back =
                    count_backwards(seg.buf, ip, anchor, match_s.buf, match_s.pos, match_s.start);
                ip -= back;
                (offset, m_length + back)
            };

            offset_2 = offset_1;
            offset_1 = offset;
            seq_store.store_seq(
                ip - anchor,
                seg.buf,
                anchor,
                offset_to_offbase(offset),
                m_length,
            )?;
            m_length
        };

        ip += m_length;
        anchor = ip;

        if ip <= seg.ilimit {
            let index_to_insert = curr + 2;
            let to_insert = src.pos_of(index_to_insert);
            hash_long.put(hash_ptr(seg.buf, to_insert, h_bits_l, 8)?, index_to_insert)?;
            hash_long.put(
                hash_ptr(seg.buf, ip - 2, h_bits_l, 8)?,
                src.index_of(ip - 2),
            )?;
            hash_small.put(
                hash_ptr(seg.buf, to_insert, h_bits_s, MLS)?,
                index_to_insert,
            )?;
            hash_small.put(
                hash_ptr(seg.buf, ip - 1, h_bits_s, MLS)?,
                src.index_of(ip - 1),
            )?;

            while ip <= seg.ilimit {
                let current2 = src.index_of(ip);
                let rep_index2 = current2.wrapping_sub(offset_2);
                let rep_match2 = seg.locate(rep_index2);
                if !(index_overlap_check(seg.prefix_start_index, rep_index2)
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(seg.buf, ip)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    seg.buf,
                    ip + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    seg.iend,
                    rep_match2.end,
                    seg.prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, seg.buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_small.put(hash_ptr(seg.buf, ip, h_bits_s, MLS)?, current2)?;
                hash_long.put(hash_ptr(seg.buf, ip, h_bits_l, 8)?, current2)?;
                ip += rep_length2;
                anchor = ip;
            }
        }
    }

    let [rep0, rep1, _] = rep;
    *rep0 = offset_1;
    *rep1 = offset_2;
    Ok(seg.iend - anchor)
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
    let prefix_lowest_index =
        ms.get_lowest_prefix_index(src.index_of(src.end), ms.c_params.window_log);
    let Some(seg) = &TwoSegments::with_dict_match_state(src, prefix_lowest_index)? else {
        return Ok(src.end - src.start);
    };
    match ms.c_params.min_match {
        5 => compress_block_double_fast_dict_match_state_generic::<5>(ms, seq_store, rep, src, seg),
        6 => compress_block_double_fast_dict_match_state_generic::<6>(ms, seq_store, rep, src, seg),
        7 => compress_block_double_fast_dict_match_state_generic::<7>(ms, seq_store, rep, src, seg),
        _ => compress_block_double_fast_dict_match_state_generic::<4>(ms, seq_store, rep, src, seg),
    }
}

/// `ZSTD_compressBlock_doubleFast_extDict_generic`
fn compress_block_double_fast_ext_dict_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    seg: &TwoSegments<'_>,
) -> Result<usize> {
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let [mut offset_1, mut offset_2, _] = *rep;
    let hash_long = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();

    let mut anchor = seg.istart;
    let mut ip = seg.istart;

    while ip < seg.ilimit {
        let h_small = hash_ptr(seg.buf, ip, h_bits_s, MLS)?;
        let match_index = hash_small.at(h_small)?;
        let match_s = seg.locate(match_index);

        let h_long = hash_ptr(seg.buf, ip, h_bits_l, 8)?;
        let match_long_index = hash_long.at(h_long)?;
        let match_long = seg.locate(match_long_index);

        let curr = src.index_of(ip);
        let rep_index = curr.wrapping_add(1).wrapping_sub(offset_1);
        let rep_match = seg.locate(rep_index);
        hash_long.put(h_long, curr)?;
        hash_small.put(h_small, curr)?;

        let m_length;
        if (index_overlap_check(seg.prefix_start_index, rep_index)
            & (offset_1 <= curr.wrapping_add(1).wrapping_sub(seg.dict_start_index)))
            && read_le32(rep_match.buf, rep_match.pos)? == read_le32(seg.buf, ip + 1)?
        {
            m_length = count_2segments(
                seg.buf,
                ip + 1 + 4,
                rep_match.buf,
                rep_match.pos + 4,
                seg.iend,
                rep_match.end,
                seg.prefix_start,
            )? + 4;
            ip += 1;
            seq_store.store_seq(ip - anchor, seg.buf, anchor, REPCODE1_TO_OFFBASE, m_length)?;
        } else {
            // The match, how much of it is known, and its offset. `ip` is moved to where it is for.
            let (found, known, offset) = if match_long_index > seg.dict_start_index
                && read_le64(match_long.buf, match_long.pos)? == read_le64(seg.buf, ip)?
            {
                (match_long, 8, curr.wrapping_sub(match_long_index))
            } else if match_index > seg.dict_start_index
                && read_le32(match_s.buf, match_s.pos)? == read_le32(seg.buf, ip)?
            {
                // A short match: a long one at the next position is preferred.
                let h3 = hash_ptr(seg.buf, ip + 1, h_bits_l, 8)?;
                let match_index3 = hash_long.at(h3)?;
                let match3 = seg.locate(match_index3);
                hash_long.put(h3, curr + 1)?;
                if match_index3 > seg.dict_start_index
                    && read_le64(match3.buf, match3.pos)? == read_le64(seg.buf, ip + 1)?
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
                seg.buf,
                ip + known,
                found.buf,
                found.pos + known,
                seg.iend,
                found.end,
                seg.prefix_start,
            )? + known;
            let back = count_backwards(seg.buf, ip, anchor, found.buf, found.pos, found.start);
            ip -= back;
            m_length = forwards + back;
            offset_2 = offset_1;
            offset_1 = offset;
            seq_store.store_seq(
                ip - anchor,
                seg.buf,
                anchor,
                offset_to_offbase(offset),
                m_length,
            )?;
        }

        ip += m_length;
        anchor = ip;

        if ip <= seg.ilimit {
            let index_to_insert = curr + 2;
            let to_insert = src.pos_of(index_to_insert);
            hash_long.put(hash_ptr(seg.buf, to_insert, h_bits_l, 8)?, index_to_insert)?;
            hash_long.put(
                hash_ptr(seg.buf, ip - 2, h_bits_l, 8)?,
                src.index_of(ip - 2),
            )?;
            hash_small.put(
                hash_ptr(seg.buf, to_insert, h_bits_s, MLS)?,
                index_to_insert,
            )?;
            hash_small.put(
                hash_ptr(seg.buf, ip - 1, h_bits_s, MLS)?,
                src.index_of(ip - 1),
            )?;

            while ip <= seg.ilimit {
                let current2 = src.index_of(ip);
                let rep_index2 = current2.wrapping_sub(offset_2);
                let rep_match2 = seg.locate(rep_index2);
                if !((index_overlap_check(seg.prefix_start_index, rep_index2)
                    & (offset_2 <= current2.wrapping_sub(seg.dict_start_index)))
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(seg.buf, ip)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    seg.buf,
                    ip + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    seg.iend,
                    rep_match2.end,
                    seg.prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, seg.buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_small.put(hash_ptr(seg.buf, ip, h_bits_s, MLS)?, current2)?;
                hash_long.put(hash_ptr(seg.buf, ip, h_bits_l, 8)?, current2)?;
                ip += rep_length2;
                anchor = ip;
            }
        }
    }

    let [rep0, rep1, _] = rep;
    *rep0 = offset_1;
    *rep1 = offset_2;
    Ok(seg.iend - anchor)
}

/// `ZSTD_compressBlock_doubleFast_extDict`
pub(crate) fn compress_block_double_fast_ext_dict(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let Some(seg) = &TwoSegments::with_ext_dict(ms, src)? else {
        return Ok(src.end - src.start);
    };
    // Nothing of the older segment is within reach.
    if seg.prefix_start_index == seg.dict_start_index {
        return compress_block_double_fast(ms, seq_store, rep, src);
    }
    match ms.c_params.min_match {
        5 => compress_block_double_fast_ext_dict_generic::<5>(ms, seq_store, rep, src, seg),
        6 => compress_block_double_fast_ext_dict_generic::<6>(ms, seq_store, rep, src, seg),
        7 => compress_block_double_fast_ext_dict_generic::<7>(ms, seq_store, rep, src, seg),
        _ => compress_block_double_fast_ext_dict_generic::<4>(ms, seq_store, rep, src, seg),
    }
}
