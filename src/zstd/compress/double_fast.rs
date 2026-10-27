//! `zstd_double_fast.c`: the `dfast` strategy, which looks up a table of long hashes and a table of short ones.

use super::fast::{
    DictBlock, ExtDictBlock, MatchSink, NoDictBlock, Segments, TaggedTable, ThirdPositions,
    put_tagged, put_tagged_in_between, restore_rep,
};
use super::internal::{
    BlockSrc, DictTableLoadMethod, HASH_READ_SIZE, Hasher, K_SEARCH_STRENGTH, MatchState, Near,
    Prefix, REPCODE1_TO_OFFBASE, SeqStore, TableFillPurpose, hashed_get, hashed_put, hashed_swap,
    le64_at, offset_to_offbase, table_get, table_of_size, table_prefetch, table_put,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::Result;
use crate::util::{BUG, SliceExt};

/// `ZSTD_fillDoubleHashTableForCDict`: the tables are empty.
fn fill_double_hash_table_for_cdict(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    dtlm: DictTableLoadMethod,
) -> Result<()> {
    let long = Hasher::new(ms.tagged_hash_log(), 8);
    let small = Hasher::new(ms.tagged_chain_log(), ms.c_params.min_match);
    let positions = ThirdPositions::new(prefix, ms.next_to_update, end)?;
    let hash_large = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();
    if dtlm == DictTableLoadMethod::Full {
        put_tagged_in_between(hash_large, long, positions.clone());
    }
    for at in positions {
        let bytes = le64_at::<0, _>(at.bytes);
        put_tagged(hash_small, small.hash(bytes), at.index);
        put_tagged(hash_large, long.hash(bytes), at.index);
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
    let long = Hasher::new(ms.c_params.hash_log, 8);
    let small = Hasher::new(ms.c_params.chain_log, ms.c_params.min_match);
    let positions = ThirdPositions::new(prefix, ms.next_to_update, end)?;
    let hash_large = ms.hash_table.as_mut_slice();
    let hash_small = ms.chain_table.as_mut_slice();
    for at in positions {
        let bytes = le64_at::<0, _>(at.bytes);
        table_put(hash_small, small.hash(bytes), at.index);
        table_put(hash_large, long.hash(bytes), at.index);
        // The positions in between only go in the table of long hashes, where there is nothing yet.
        if dtlm == DictTableLoadMethod::Full {
            for (bytes, index) in [
                (le64_at::<1, _>(at.bytes), at.index + 1),
                (le64_at::<2, _>(at.bytes), at.index + 2),
            ] {
                let hash = long.hash(bytes);
                if table_get(hash_large, hash) == 0 {
                    table_put(hash_large, hash, index);
                }
            }
        }
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

/// Has what a search from `pos` on looks at first in the tables on its way. `pos` is the end of a match that was just
/// found: there is enough to do about that one in the meantime.
#[inline(always)]
fn look_ahead(
    near: Near<'_>,
    pos: u32,
    hash_long: &[u32],
    long: Hasher,
    hash_small: &[u32],
    small: Hasher,
) {
    if let Some(bytes) = near.read64(pos) {
        table_prefetch(hash_long, long.hash(bytes));
        table_prefetch(hash_small, small.hash(bytes));
    }
}

/// What `dfast` looks for matches with, when there is no dictionary and the window is one segment.
struct Finder {
    /// The index of the first position.
    base_index: u32,
    long: Hasher,
    small: Hasher,
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
    ///
    /// `MLS`, `LONG` and `SMALL` are what `small` and `long` are made with, or all 0 for any: see [`table_of_size`].
    #[inline(never)]
    fn find_matches<const MLS: u32, const LONG: u32, const SMALL: u32>(
        &mut self,
        hash_long: &mut [u32],
        hash_small: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
    ) {
        const K_STEP_INCR: u32 = 1 << K_SEARCH_STRENGTH;
        let Self {
            base_index,
            long,
            small,
            first: mut ip,
            mut offset_1,
            mut offset_2,
        } = *self;
        let near = sink.near;
        let long = if LONG > 0 { Hasher::new(LONG, 8) } else { long };
        let small = if SMALL > 0 {
            Hasher::new(SMALL, MLS)
        } else {
            small
        };
        let Some(hash_long) = table_of_size::<LONG>(hash_long) else {
            return;
        };
        let Some(hash_small) = table_of_size::<SMALL>(hash_small) else {
            return;
        };
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
                let idxl0 = hashed_swap(hash_long, long.hash(bytes0), curr);
                let idxs0 = hashed_swap(hash_small, small.hash(bytes0), curr);

                if sink.read32_before(ip + 1, offset_1) == Some((bytes0 >> 8) as u32)
                    && offset_1 > 0
                {
                    ip += 1;
                    let end = ip + 4 + sink.count_before(ip + 4, offset_1);
                    if LONG == 0 || LONG >= 17 {
                        look_ahead(near, end, hash_long, long, hash_small, small);
                    }
                    sink.store::<16>(ip, end, REPCODE1_TO_OFFBASE);
                    break end;
                }

                // An index that is too low leads past the end.
                let matchl0 = idxl0.wrapping_sub(base_index);
                let matchs0 = idxs0.wrapping_sub(base_index);
                let (match0, end) = if near.has::<{ u64::MAX }>(matchl0, bytes0) {
                    (matchl0, ip + 8 + near.count(ip + 8, matchl0 + 8))
                } else if near.has::<0xFFFF_FFFF>(matchs0, bytes0) {
                    // A short match: a longer one at the next position is preferred.
                    let end = ip + 4 + near.count(ip + 4, matchs0 + 4);
                    let idxl1 = hashed_get(hash_long, long.hash(bytes1));
                    let matchl1 = idxl1.wrapping_sub(base_index);
                    if near.has::<{ u64::MAX }>(matchl1, bytes1) && matchl1 > 0 {
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

                if LONG == 0 || LONG >= 17 {
                    look_ahead(near, end, hash_long, long, hash_small, small);
                }
                offset_2 = offset_1;
                offset_1 = ip - match0;
                // With a larger step, ip1 may be past the end of the match.
                if step < 4 {
                    hashed_put(hash_long, long.hash(bytes1), base_index.wrapping_add(ip1));
                }
                let back = near.count_backwards(ip, sink.anchor, match0, 0);
                sink.store::<16>(ip - back, end, offset_to_offbase(offset_1));
                break end;
            };
            ip = end;

            // `ip` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip - 2) else {
                break 'block;
            };
            bytes0 = le64_at::<2, _>(around);
            let index_to_insert = curr + 2;
            if let Some(to_insert) = near.read64(index_to_insert.wrapping_sub(base_index)) {
                hashed_put(hash_long, long.hash(to_insert), index_to_insert);
                hashed_put(hash_small, small.hash(to_insert), index_to_insert);
            }
            hashed_put(
                hash_long,
                long.hash(le64_at::<0, _>(around)),
                base_index.wrapping_add(ip - 2),
            );
            hashed_put(
                hash_small,
                small.hash(le64_at::<1, _>(around)),
                base_index.wrapping_add(ip - 1),
            );

            while offset_2 > 0 && sink.read32_before(ip, offset_2) == Some(bytes0 as u32) {
                let end = ip + 4 + sink.count_before(ip + 4, offset_2);
                core::mem::swap(&mut offset_1, &mut offset_2);
                let index = base_index.wrapping_add(ip);
                hashed_put(hash_small, small.hash(bytes0), index);
                hashed_put(hash_long, long.hash(bytes0), index);
                sink.store_repeat(end);
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
    let block = NoDictBlock::new(ms, rep, src)?;
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let mut finder = Finder {
        base_index: block.prefix_lowest_index,
        long: Hasher::new(h_bits_l, 8),
        small: Hasher::new(h_bits_s, ms.c_params.min_match),
        first: block.first,
        offset_1: block.rep.offset_1,
        offset_2: block.rep.offset_2,
    };
    let mut sink = MatchSink::new(seq_store, &block);
    let hash_long = ms.hash_table.sub_mut(..1 << h_bits_l)?;
    let hash_small = ms.chain_table.sub_mut(..1 << h_bits_s)?;
    // First, what levels 3 and 4 come with if the input is not known to be small, and level 3 if it is.
    match (ms.c_params.min_match, h_bits_l, h_bits_s) {
        (5, 18, 18) => finder.find_matches::<5, 18, 18>(hash_long, hash_small, &mut sink),
        (5, 17, 16) => finder.find_matches::<5, 17, 16>(hash_long, hash_small, &mut sink),
        (5, 16, 15) => finder.find_matches::<5, 16, 15>(hash_long, hash_small, &mut sink),
        (5, 14, 14) => finder.find_matches::<5, 14, 14>(hash_long, hash_small, &mut sink),
        (4, 17, 17) => finder.find_matches::<4, 17, 17>(hash_long, hash_small, &mut sink),
        (4, 17, 16) => finder.find_matches::<4, 17, 16>(hash_long, hash_small, &mut sink),
        (4, 16, 16) => finder.find_matches::<4, 16, 16>(hash_long, hash_small, &mut sink),
        (4, 16, 15) => finder.find_matches::<4, 16, 15>(hash_long, hash_small, &mut sink),
        (4, 15, 14) => finder.find_matches::<4, 15, 14>(hash_long, hash_small, &mut sink),
        (4, 14, 13) => finder.find_matches::<4, 14, 13>(hash_long, hash_small, &mut sink),
        (4, 13, 12) => finder.find_matches::<4, 13, 12>(hash_long, hash_small, &mut sink),
        (4, 12, 11) => finder.find_matches::<4, 12, 11>(hash_long, hash_small, &mut sink),
        (4, 11, 10) => finder.find_matches::<4, 11, 10>(hash_long, hash_small, &mut sink),
        _ => finder.find_matches::<0, 0, 0>(hash_long, hash_small, &mut sink),
    }
    let last_literals = sink.last_literals()?;
    restore_rep(
        rep,
        finder.offset_1,
        finder.offset_2,
        block.rep.offset_saved1,
        block.rep.offset_saved2,
    );
    Ok(last_literals)
}

impl Finder {
    /// `ZSTD_compressBlock_doubleFast_dictMatchState_generic`
    #[inline(never)]
    fn find_matches_dict<const MLS: u32>(
        &mut self,
        hash_long: &mut [u32],
        hash_small: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
        window: Segments<'_>,
        dict_tables: &DictTables<'_>,
    ) {
        let Self {
            base_index,
            long,
            small,
            first: mut ip,
            mut offset_1,
            mut offset_2,
        } = *self;
        let near = window.near;
        let long = long.with_mls(8);
        let small = small.with_mls(MLS);
        if hash_long.is_empty() || hash_small.is_empty() {
            return;
        }

        // `ip` is before the last position that can be looked at.
        'search: while let Some(here) = near.window::<{ HASH_READ_SIZE + 1 }>(ip) {
            let bytes0 = le64_at::<0, _>(here);
            let curr = base_index.wrapping_add(ip);
            let match_long =
                hashed_swap(hash_long, long.hash(bytes0), curr).wrapping_sub(base_index);
            let match_index_s = hashed_swap(hash_small, small.hash(bytes0), curr);

            if window.read32_before(ip + 1, offset_1) == Some((bytes0 >> 8) as u32) {
                ip += 1;
                let rep_place = window.place_of(ip).wrapping_sub(offset_1);
                let end = ip + 4 + window.count(ip + 4, rep_place + 4);
                sink.store::<16>(ip, end, REPCODE1_TO_OFFBASE);
                ip = end;
            } else {
                // The place of the match, and how much of it is known. `ip` is moved to where it is for.
                let (place, known) = 'found: {
                    if near.has::<{ u64::MAX }>(match_long, bytes0) {
                        break 'found (window.place_of(match_long), 8);
                    }
                    if let Some(place) = dict_tables.long.get::<8>(bytes0)
                        && window.older.read64(place) == Some(bytes0)
                    {
                        break 'found (place, 8);
                    }

                    // The dictionary is only looked up if there is no candidate in the prefix.
                    let short = if match_index_s > base_index {
                        Some(window.place_of(match_index_s - base_index))
                    } else {
                        dict_tables.short.get::<MLS>(bytes0)
                    };
                    let Some(place_short) =
                        short.filter(|&place| window.read32(place) == Some(bytes0 as u32))
                    else {
                        ip += ((ip - sink.anchor) >> K_SEARCH_STRENGTH) + 1;
                        continue 'search;
                    };

                    // A short match: a long one at the next position is preferred.
                    let bytes1 = le64_at::<1, _>(here);
                    let match_long1 = hashed_swap(hash_long, long.hash(bytes1), curr + 1)
                        .wrapping_sub(base_index);
                    if near.has::<{ u64::MAX }>(match_long1, bytes1) {
                        ip += 1;
                        break 'found (window.place_of(match_long1), 8);
                    }
                    if let Some(place) = dict_tables.long.get::<8>(bytes1)
                        && window.older.read64(place) == Some(bytes1)
                    {
                        ip += 1;
                        break 'found (place, 8);
                    }
                    (place_short, 4)
                };
                let end = ip + known + window.count(ip + known, place + known);
                let back = window.count_backwards(ip, sink.anchor, place);
                offset_2 = offset_1;
                offset_1 = window.place_of(ip) - place;
                sink.store::<16>(ip - back, end, offset_to_offbase(offset_1));
                ip = end;
            }

            // `ip` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip - 2) else {
                break;
            };
            let index_to_insert = curr + 2;
            if let Some(to_insert) = near.read64(index_to_insert.wrapping_sub(base_index)) {
                hashed_put(hash_long, long.hash(to_insert), index_to_insert);
                hashed_put(hash_small, small.hash(to_insert), index_to_insert);
            }
            hashed_put(
                hash_long,
                long.hash(le64_at::<0, _>(around)),
                base_index.wrapping_add(ip - 2),
            );
            hashed_put(
                hash_small,
                small.hash(le64_at::<1, _>(around)),
                base_index.wrapping_add(ip - 1),
            );

            while let Some(bytes) = near.read64(ip)
                && window.read32_before(ip, offset_2) == Some(bytes as u32)
            {
                let rep_place = window.place_of(ip).wrapping_sub(offset_2);
                let end = ip + 4 + window.count(ip + 4, rep_place + 4);
                core::mem::swap(&mut offset_1, &mut offset_2);
                let index = base_index.wrapping_add(ip);
                hashed_put(hash_small, small.hash(bytes), index);
                hashed_put(hash_long, long.hash(bytes), index);
                sink.store::<16>(ip, end, REPCODE1_TO_OFFBASE);
                ip = end;
            }
        }

        self.offset_1 = offset_1;
        self.offset_2 = offset_2;
    }
}

/// The tables of a dictionary.
struct DictTables<'a> {
    long: TaggedTable<'a>,
    short: TaggedTable<'a>,
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
    let block = DictBlock::new(src, prefix_lowest_index)?;
    let dms = src.dms.as_ref().ok_or(BUG)?;
    let tables = &DictTables {
        long: TaggedTable::new(
            &dms.ms.hash_table,
            dms.ms.tagged_hash_log(),
            8,
            block.dict_start_index,
        )?,
        short: TaggedTable::new(
            &dms.ms.chain_table,
            dms.ms.tagged_chain_log(),
            ms.c_params.min_match,
            block.dict_start_index,
        )?,
    };
    let h_bits_l = ms.c_params.hash_log;
    let h_bits_s = ms.c_params.chain_log;
    let [offset_1, offset_2, _] = *rep;
    let mut finder = Finder {
        base_index: block.prefix_start_index,
        long: Hasher::new(h_bits_l, 8),
        small: Hasher::new(h_bits_s, ms.c_params.min_match),
        first: block.first(),
        offset_1,
        offset_2,
    };
    let sink = &mut MatchSink::with_near(seq_store, block.window.near, block.istart);
    let long = ms.hash_table.sub_mut(..1 << h_bits_l)?;
    let small = ms.chain_table.sub_mut(..1 << h_bits_s)?;
    match ms.c_params.min_match {
        5 => finder.find_matches_dict::<5>(long, small, sink, block.window, tables),
        6 => finder.find_matches_dict::<6>(long, small, sink, block.window, tables),
        7 => finder.find_matches_dict::<7>(long, small, sink, block.window, tables),
        _ => finder.find_matches_dict::<4>(long, small, sink, block.window, tables),
    }
    let last_literals = sink.last_literals()?;
    let [rep0, rep1, _] = rep;
    *rep0 = finder.offset_1;
    *rep1 = finder.offset_2;
    Ok(last_literals)
}

impl Finder {
    /// `ZSTD_compressBlock_doubleFast_extDict_generic`. `MLS`, `LONG` and `SMALL` are as for [`Self::find_matches`].
    #[inline(never)]
    fn find_matches_ext_dict<const MLS: u32, const LONG: u32, const SMALL: u32>(
        &mut self,
        hash_long: &mut [u32],
        hash_small: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
        window: Segments<'_>,
    ) {
        let Self {
            base_index,
            long,
            small,
            first: mut ip,
            mut offset_1,
            mut offset_2,
        } = *self;
        let near = window.near;
        let older_len = window.older.len();
        // The index of the first place.
        let origin_index = base_index.wrapping_sub(older_len);
        let long = if LONG > 0 { Hasher::new(LONG, 8) } else { long };
        let small = if SMALL > 0 {
            Hasher::new(SMALL, MLS)
        } else {
            small
        };
        let Some(hash_long) = table_of_size::<LONG>(hash_long) else {
            return;
        };
        let Some(hash_small) = table_of_size::<SMALL>(hash_small) else {
            return;
        };

        // `ip` is before the last position that can be looked at.
        while let Some(here) = near.window::<{ HASH_READ_SIZE + 1 }>(ip) {
            let bytes0 = le64_at::<0, _>(here);
            let curr = base_index.wrapping_add(ip);
            let place_long =
                hashed_swap(hash_long, long.hash(bytes0), curr).wrapping_sub(origin_index);
            let place_short =
                hashed_swap(hash_small, small.hash(bytes0), curr).wrapping_sub(origin_index);

            if window.read32_before(ip + 1, offset_1) == Some((bytes0 >> 8) as u32)
                && offset_1 <= window.place_of(ip + 1)
            {
                ip += 1;
                let rep_place = window.place_of(ip) - offset_1;
                let end = ip + 4 + window.count(ip + 4, rep_place + 4);
                look_ahead(near, end, hash_long, long, hash_small, small);
                sink.store::<16>(ip, end, REPCODE1_TO_OFFBASE);
                ip = end;
            } else {
                // The match, and how much of it is known. `ip` is moved to where it is for.
                let (place, known) =
                    if window.has::<{ u64::MAX }>(place_long, bytes0) && place_long > 0 {
                        (place_long, 8)
                    } else if window.has::<0xFFFF_FFFF>(place_short, bytes0) && place_short > 0 {
                        // A short match: a long one at the next position is preferred.
                        let bytes1 = le64_at::<1, _>(here);
                        let place3 = hashed_swap(hash_long, long.hash(bytes1), curr + 1)
                            .wrapping_sub(origin_index);
                        if window.has::<{ u64::MAX }>(place3, bytes1) && place3 > 0 {
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
                look_ahead(near, end, hash_long, long, hash_small, small);
                let back = window.count_backwards(ip, sink.anchor, place);
                offset_2 = offset_1;
                offset_1 = window.place_of(ip) - place;
                sink.store::<16>(ip - back, end, offset_to_offbase(offset_1));
                ip = end;
            }

            // `ip` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip - 2) else {
                break;
            };
            let index_to_insert = curr + 2;
            if let Some(to_insert) = near.read64(index_to_insert.wrapping_sub(base_index)) {
                hashed_put(hash_long, long.hash(to_insert), index_to_insert);
                hashed_put(hash_small, small.hash(to_insert), index_to_insert);
            }
            hashed_put(
                hash_long,
                long.hash(le64_at::<0, _>(around)),
                base_index.wrapping_add(ip - 2),
            );
            hashed_put(
                hash_small,
                small.hash(le64_at::<1, _>(around)),
                base_index.wrapping_add(ip - 1),
            );

            while let Some(bytes) = near.read64(ip) {
                if !(window.read32_before(ip, offset_2) == Some(bytes as u32)
                    && offset_2 <= window.place_of(ip))
                {
                    break;
                }
                let rep_place = window.place_of(ip) - offset_2;
                let end = ip + 4 + window.count(ip + 4, rep_place + 4);
                core::mem::swap(&mut offset_1, &mut offset_2);
                let index = base_index.wrapping_add(ip);
                hashed_put(hash_small, small.hash(bytes), index);
                hashed_put(hash_long, long.hash(bytes), index);
                sink.store_repeat(end);
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
        long: Hasher::new(h_bits_l, 8),
        small: Hasher::new(h_bits_s, ms.c_params.min_match),
        first: block.istart,
        offset_1,
        offset_2,
    };
    let mut sink = MatchSink::with_near(seq_store, block.window.near, block.istart);
    let hash_long = ms.hash_table.sub_mut(..1 << h_bits_l)?;
    let hash_small = ms.chain_table.sub_mut(..1 << h_bits_s)?;
    let (long, small, sink) = (hash_long, hash_small, &mut sink);
    match (ms.c_params.min_match, h_bits_l, h_bits_s) {
        (5, 18, 18) => finder.find_matches_ext_dict::<5, 18, 18>(long, small, sink, block.window),
        (5, 17, 16) => finder.find_matches_ext_dict::<5, 17, 16>(long, small, sink, block.window),
        _ => finder.find_matches_ext_dict::<0, 0, 0>(long, small, sink, block.window),
    }
    let last_literals = sink.last_literals()?;
    let [rep0, rep1, _] = rep;
    *rep0 = finder.offset_1;
    *rep1 = finder.offset_2;
    Ok(last_literals)
}
