//! `zstd_double_fast.c`: the `dfast` strategy, which looks up a table of long hashes and a table of short ones.

use super::fast::{
    ExtDictBlock, FAST_HASH_FILL_STEP, MatchSink, NoDictBlock, Segments, TwoSegments,
    count_backwards, restore_rep,
};
use super::internal::{
    BlockSrc, DictTableLoadMethod, HASH_READ_SIZE, K_SEARCH_STRENGTH, MatchState, Prefix,
    REPCODE1_TO_OFFBASE, SeqStore, TableFillPurpose, ZSTD_SHORT_CACHE_TAG_BITS,
    compare_packed_tags, count, count_2segments, hash_of, hash_ptr, hash8, index_overlap_check,
    le64_at, offset_to_offbase, table_get, table_put, table_swap, write_tagged_index,
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

/// What `dfast` looks for matches with, when there is no dictionary and the window is one segment.
struct Finder {
    /// The index of the first position.
    base_index: u32,
    h_bits_l: u32,
    h_bits_s: u32,
    /// Where to start.
    first: u32,
    offset_1: u32,
    offset_2: u32,
}

impl Finder {
    /// `ZSTD_compressBlock_doubleFast_noDict_generic`
    ///
    /// The C code computes the long hash and reads its table one position ahead. Here that is left to the processor: a
    /// turn of the inner loop only takes the position and the 8 bytes there, `bytes0`, from the one before.
    #[inline(never)]
    fn find_matches<const MLS: u32>(
        &mut self,
        hash_long: &mut [u32],
        hash_small: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
    ) {
        const K_STEP_INCR: u32 = 1 << K_SEARCH_STRENGTH;
        let Self {
            base_index,
            h_bits_l,
            h_bits_s,
            first: mut ip,
            mut offset_1,
            mut offset_2,
        } = *self;
        let near = sink.near;
        if hash_long.is_empty() || hash_small.is_empty() {
            return;
        }
        let Some(mut bytes0) = near.read64(ip) else {
            return;
        };

        // One turn per match.
        'block: loop {
            let mut step = 1;
            let mut next_step = ip + K_STEP_INCR;
            let mut ip1 = ip + step;
            let mut curr;

            // One turn per position.
            let end = loop {
                let Some(bytes1) = near.read64(ip1) else {
                    break 'block;
                };
                curr = base_index.wrapping_add(ip);
                let idxl0 = table_swap(hash_long, hash8(bytes0, h_bits_l, 0), curr);
                let idxs0 = table_swap(hash_small, hash_of::<MLS>(bytes0, h_bits_s), curr);

                if sink.read32_before(ip + 1, offset_1) == Some((bytes0 >> 8) as u32)
                    && offset_1 > 0
                {
                    ip += 1;
                    let end = ip + 4 + sink.count_before(ip + 4, offset_1);
                    sink.store(ip, end, REPCODE1_TO_OFFBASE);
                    break end;
                }

                // An index that is too low leads past the end. Whether one is takes no branch to find out: what is
                // read instead is unlikely to be the same.
                let matchl0 = idxl0.wrapping_sub(base_index);
                let matchs0 = idxs0.wrapping_sub(base_index);
                let (match0, end) = if near.diff64(matchl0, bytes0) == 0 {
                    (matchl0, ip + 8 + near.count(ip + 8, matchl0 + 8))
                } else if near.diff64(matchs0, bytes0) as u32 == 0 {
                    // A short match: a longer one at the next position is preferred.
                    let end = ip + 4 + near.count(ip + 4, matchs0 + 4);
                    let idxl1 = table_get(hash_long, hash8(bytes1, h_bits_l, 0));
                    let matchl1 = idxl1.wrapping_sub(base_index);
                    if matchl1 > 0 && near.read64(matchl1) == Some(bytes1) {
                        let end1 = ip1 + 8 + near.count(ip1 + 8, matchl1 + 8);
                        if end1 - ip1 > end - ip {
                            ip = ip1;
                            (matchl1, end1)
                        } else {
                            (matchs0, end)
                        }
                    } else {
                        (matchs0, end)
                    }
                } else {
                    if ip1 >= next_step {
                        core::hint::cold_path();
                        step += 1;
                        next_step += K_STEP_INCR;
                    }
                    ip = ip1;
                    ip1 += step;
                    bytes0 = bytes1;
                    continue;
                };

                offset_2 = offset_1;
                offset_1 = ip - match0;
                // With a larger step, ip1 may be past the end of the match.
                if step < 4 {
                    table_put(
                        hash_long,
                        hash8(bytes1, h_bits_l, 0),
                        base_index.wrapping_add(ip1),
                    );
                }
                let back = near.count_backwards(ip, sink.anchor, match0, 0);
                sink.store(ip - back, end, offset_to_offbase(offset_1));
                break end;
            };
            ip = end;

            // `ip` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip - 2) else {
                break 'block;
            };
            let index_to_insert = curr + 2;
            if let Some(to_insert) = near.read64(index_to_insert.wrapping_sub(base_index)) {
                table_put(hash_long, hash8(to_insert, h_bits_l, 0), index_to_insert);
                table_put(
                    hash_small,
                    hash_of::<MLS>(to_insert, h_bits_s),
                    index_to_insert,
                );
            }
            table_put(
                hash_long,
                hash8(le64_at::<0, _>(around), h_bits_l, 0),
                base_index.wrapping_add(ip - 2),
            );
            table_put(
                hash_small,
                hash_of::<MLS>(le64_at::<1, _>(around), h_bits_s),
                base_index.wrapping_add(ip - 1),
            );
            bytes0 = le64_at::<2, _>(around);

            while offset_2 > 0 && sink.read32_before(ip, offset_2) == Some(bytes0 as u32) {
                let end = ip + 4 + sink.count_before(ip + 4, offset_2);
                core::mem::swap(&mut offset_1, &mut offset_2);
                let index = base_index.wrapping_add(ip);
                table_put(hash_small, hash_of::<MLS>(bytes0, h_bits_s), index);
                table_put(hash_long, hash8(bytes0, h_bits_l, 0), index);
                sink.store(ip, end, REPCODE1_TO_OFFBASE);
                ip = end;
                let Some(bytes) = near.read64(ip) else {
                    break 'block;
                };
                bytes0 = bytes;
            }
        }

        self.offset_1 = offset_1;
        self.offset_2 = offset_2;
    }
}

/// `ZSTD_compressBlock_doubleFast`
pub(crate) fn compress_block_double_fast(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let Some(block) = NoDictBlock::new(ms, rep, src)? else {
        return Ok(src.end - src.start);
    };
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let mut finder = Finder {
        base_index: block.prefix_lowest_index,
        h_bits_l,
        h_bits_s,
        first: block.first - block.prefix_lowest,
        offset_1: block.offset_1,
        offset_2: block.offset_2,
    };
    let mut sink = MatchSink::new(seq_store, &block);
    let hash_long = ms.hash_table.sub_mut(..1 << h_bits_l)?;
    let hash_small = ms.chain_table.sub_mut(..1 << h_bits_s)?;
    match ms.c_params.min_match {
        5 => finder.find_matches::<5>(hash_long, hash_small, &mut sink),
        6 => finder.find_matches::<6>(hash_long, hash_small, &mut sink),
        7 => finder.find_matches::<7>(hash_long, hash_small, &mut sink),
        _ => finder.find_matches::<4>(hash_long, hash_small, &mut sink),
    }
    let last_literals = sink.finish()?;
    restore_rep(
        rep,
        finder.offset_1,
        finder.offset_2,
        block.offset_saved1,
        block.offset_saved2,
    );
    Ok(last_literals)
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

impl Finder {
    /// `ZSTD_compressBlock_doubleFast_extDict_generic`
    #[inline(never)]
    fn find_matches_ext_dict<const MLS: u32>(
        &mut self,
        hash_long: &mut [u32],
        hash_small: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
        window: Segments<'_>,
    ) {
        let Self {
            base_index,
            h_bits_l,
            h_bits_s,
            first: mut ip,
            mut offset_1,
            mut offset_2,
        } = *self;
        let near = window.near;
        let older_len = window.older.len();
        // The index of the first place.
        let origin_index = base_index.wrapping_sub(older_len);
        if hash_long.is_empty() || hash_small.is_empty() {
            return;
        }

        // `ip` is before the last position that can be looked at.
        while let Some(here) = near.window::<{ HASH_READ_SIZE + 1 }>(ip) {
            let bytes0 = le64_at::<0, _>(here);
            let curr = base_index.wrapping_add(ip);
            let place_long =
                table_swap(hash_long, hash8(bytes0, h_bits_l, 0), curr).wrapping_sub(origin_index);
            let place_short = table_swap(hash_small, hash_of::<MLS>(bytes0, h_bits_s), curr)
                .wrapping_sub(origin_index);

            let rep_place = window.place_of(ip + 1).wrapping_sub(offset_1);
            if window.read32(rep_place) == Some((bytes0 >> 8) as u32)
                && index_overlap_check(older_len, rep_place)
                && offset_1 <= window.place_of(ip + 1)
            {
                ip += 1;
                let end = ip + 4 + window.count(ip + 4, rep_place + 4);
                sink.store(ip, end, REPCODE1_TO_OFFBASE);
                ip = end;
            } else {
                // The match, and how much of it is known. `ip` is moved to where it is for.
                let (place, known) = if window.read64(place_long) == Some(bytes0) && place_long > 0
                {
                    (place_long, 8)
                } else if window.read32(place_short) == Some(bytes0 as u32) && place_short > 0 {
                    // A short match: a long one at the next position is preferred.
                    let bytes1 = le64_at::<1, _>(here);
                    let place3 = table_swap(hash_long, hash8(bytes1, h_bits_l, 0), curr + 1)
                        .wrapping_sub(origin_index);
                    if window.read64(place3) == Some(bytes1) && place3 > 0 {
                        ip += 1;
                        (place3, 8)
                    } else {
                        (place_short, 4)
                    }
                } else {
                    ip += ((ip - sink.anchor) >> K_SEARCH_STRENGTH) + 1;
                    continue;
                };
                let end = ip + known + window.count(ip + known, place + known);
                let back = window.count_backwards(ip, sink.anchor, place);
                offset_2 = offset_1;
                offset_1 = window.place_of(ip) - place;
                sink.store(ip - back, end, offset_to_offbase(offset_1));
                ip = end;
            }

            // `ip` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip - 2) else {
                break;
            };
            let index_to_insert = curr + 2;
            if let Some(to_insert) = near.read64(index_to_insert.wrapping_sub(base_index)) {
                table_put(hash_long, hash8(to_insert, h_bits_l, 0), index_to_insert);
                table_put(
                    hash_small,
                    hash_of::<MLS>(to_insert, h_bits_s),
                    index_to_insert,
                );
            }
            table_put(
                hash_long,
                hash8(le64_at::<0, _>(around), h_bits_l, 0),
                base_index.wrapping_add(ip - 2),
            );
            table_put(
                hash_small,
                hash_of::<MLS>(le64_at::<1, _>(around), h_bits_s),
                base_index.wrapping_add(ip - 1),
            );

            while let Some(bytes) = near.read64(ip) {
                let rep_place = window.place_of(ip).wrapping_sub(offset_2);
                if !(window.read32(rep_place) == Some(bytes as u32)
                    && index_overlap_check(older_len, rep_place)
                    && offset_2 <= window.place_of(ip))
                {
                    break;
                }
                let end = ip + 4 + window.count(ip + 4, rep_place + 4);
                core::mem::swap(&mut offset_1, &mut offset_2);
                let index = base_index.wrapping_add(ip);
                table_put(hash_small, hash_of::<MLS>(bytes, h_bits_s), index);
                table_put(hash_long, hash8(bytes, h_bits_l, 0), index);
                sink.store(ip, end, REPCODE1_TO_OFFBASE);
                ip = end;
            }
        }

        self.offset_1 = offset_1;
        self.offset_2 = offset_2;
    }
}

/// `ZSTD_compressBlock_doubleFast_extDict`
pub(crate) fn compress_block_double_fast_ext_dict(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let Some(block) = ExtDictBlock::new(ms, rep, src)? else {
        // Nothing of the older segment is within reach.
        return compress_block_double_fast(ms, seq_store, rep, src);
    };
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let [offset_1, offset_2, _] = *rep;
    let mut finder = Finder {
        base_index: block.prefix_start_index,
        h_bits_l,
        h_bits_s,
        first: block.istart,
        offset_1,
        offset_2,
    };
    let mut sink = MatchSink::with_near(seq_store, block.window.near, block.istart);
    let hash_long = ms.hash_table.sub_mut(..1 << h_bits_l)?;
    let hash_small = ms.chain_table.sub_mut(..1 << h_bits_s)?;
    match ms.c_params.min_match {
        5 => finder.find_matches_ext_dict::<5>(hash_long, hash_small, &mut sink, block.window),
        6 => finder.find_matches_ext_dict::<6>(hash_long, hash_small, &mut sink, block.window),
        7 => finder.find_matches_ext_dict::<7>(hash_long, hash_small, &mut sink, block.window),
        _ => finder.find_matches_ext_dict::<4>(hash_long, hash_small, &mut sink, block.window),
    }
    let last_literals = sink.finish()?;
    let [rep0, rep1, _] = rep;
    *rep0 = finder.offset_1;
    *rep1 = finder.offset_2;
    Ok(last_literals)
}
