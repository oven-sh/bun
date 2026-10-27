//! `zstd_fast.c`: the `fast` strategy, which looks up one hash table.

use super::internal::{
    BlockSrc, CompressionParameters, DictTableLoadMethod, HASH_READ_SIZE, K_SEARCH_STRENGTH,
    MatchState, Near, Prefix, REPCODE1_TO_OFFBASE, SeqSink, SeqStore, TableFillPurpose,
    ZSTD_SHORT_CACHE_TAG_BITS, compare_packed_tags, count, count_2segments, hash_of, hash_ptr,
    index_overlap_check, le32_at, le64_at, offset_to_offbase, table_put, table_swap,
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

/// What `fast` and `dfast` work out before they look for matches in a block, when indices lead to two segments: the
/// current one, and below `prefix_start_index` either the older one of the window or the dictionary's.
pub(super) struct TwoSegments<'a> {
    /// The buffer of the current segment, up to the end of the block.
    pub(super) buf: &'a [u8],
    base: usize,
    pub(super) istart: usize,
    pub(super) iend: usize,
    /// The last position that [`HASH_READ_SIZE`] bytes can be read at.
    pub(super) ilimit: usize,
    pub(super) prefix_start_index: u32,
    pub(super) prefix_start: usize,
    pub(super) dict_buf: &'a [u8],
    dict_base: usize,
    /// What to subtract from an index below `prefix_start_index` to get an index of the other segment.
    pub(super) dict_index_delta: u32,
    pub(super) dict_start_index: u32,
    pub(super) dict_start: usize,
    pub(super) dict_end: usize,
}

impl<'a> TwoSegments<'a> {
    /// The other segment is the dictionary's, which has its own match state. `None` if the block is too short to look
    /// for anything.
    pub(super) fn with_dict_match_state(
        src: &BlockSrc<'a>,
        prefix_start_index: u32,
    ) -> Result<Option<Self>> {
        let dms = src.dms.as_ref().ok_or(BUG)?;
        let dict_start_index = dms.ms.window.dict_limit;
        let Some(ilimit) = src.end.checked_sub(HASH_READ_SIZE) else {
            return Ok(None);
        };
        Ok(Some(Self {
            buf: src.buf.sub(..src.end)?,
            base: src.base,
            istart: src.start,
            iend: src.end,
            ilimit,
            prefix_start_index,
            prefix_start: src.pos_of(prefix_start_index),
            dict_buf: dms.buf,
            dict_base: dms.base,
            dict_index_delta: prefix_start_index
                .wrapping_sub(dms.end.wrapping_sub(dms.base) as u32),
            dict_start_index,
            dict_start: dms.pos_of(dict_start_index),
            dict_end: dms.end,
        }))
    }

    /// The other segment is the older one of the window, as far as it is within reach. `None` if the block is too short
    /// to look for anything.
    pub(super) fn with_ext_dict(ms: &MatchState, src: &BlockSrc<'a>) -> Result<Option<Self>> {
        let low_limit = ms.get_lowest_match_index(src.index_of(src.end), ms.c_params.window_log);
        let prefix_start_index = ms.window.dict_limit.max(low_limit);
        let Some(ilimit) = src.end.checked_sub(HASH_READ_SIZE) else {
            return Ok(None);
        };
        Ok(Some(Self {
            buf: src.buf.sub(..src.end)?,
            base: src.base,
            istart: src.start,
            iend: src.end,
            ilimit,
            prefix_start_index,
            prefix_start: src.pos_of(prefix_start_index),
            dict_buf: src.dict_buf,
            dict_base: src.dict_base,
            dict_index_delta: 0,
            dict_start_index: low_limit,
            dict_start: src.dict_pos_of(low_limit),
            dict_end: src.dict_pos_of(prefix_start_index),
        }))
    }

    /// The first position to look at, with a dictionary: not `istart` if there is nothing before it to match.
    pub(super) const fn first(&self) -> usize {
        let dict_and_prefix_length = self
            .istart
            .wrapping_sub(self.prefix_start)
            .wrapping_add(self.dict_end)
            .wrapping_sub(self.dict_start) as u32;
        self.istart + (dict_and_prefix_length == 0) as usize
    }

    /// The position in `dict_buf` of an index of the other segment.
    #[inline(always)]
    pub(super) const fn dict_pos_of(&self, index: u32) -> usize {
        self.dict_base.wrapping_add(index as usize)
    }

    #[inline(always)]
    pub(super) const fn locate(&self, index: u32) -> Located<'a> {
        if index < self.prefix_start_index {
            Located {
                buf: self.dict_buf,
                pos: self.dict_pos_of(index.wrapping_sub(self.dict_index_delta)),
                start: self.dict_start,
                end: self.dict_end,
            }
        } else {
            Located {
                buf: self.buf,
                pos: self.base.wrapping_add(index as usize),
                start: self.prefix_start,
                end: self.iend,
            }
        }
    }
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

/// The repeat offsets at the start of a block. Those that reach further than `max_rep` are 0, and saved.
pub(super) struct SavedRep {
    pub(super) offset_1: u32,
    pub(super) offset_2: u32,
    pub(super) offset_saved1: u32,
    pub(super) offset_saved2: u32,
}

impl SavedRep {
    pub(super) const fn new(rep: &[u32; ZSTD_REP_NUM], max_rep: u32) -> Self {
        let [mut offset_1, mut offset_2, _] = *rep;
        let (mut offset_saved1, mut offset_saved2) = (0, 0);
        if offset_2 > max_rep {
            offset_saved2 = offset_2;
            offset_2 = 0;
        }
        if offset_1 > max_rep {
            offset_saved1 = offset_1;
            offset_1 = 0;
        }
        Self {
            offset_1,
            offset_2,
            offset_saved1,
            offset_saved2,
        }
    }

    fn with_ext_dict(rep: &[u32; ZSTD_REP_NUM], src: &BlockSrc<'_>, seg: &TwoSegments<'_>) -> Self {
        let max_rep = src.index_of(seg.istart).wrapping_sub(seg.dict_start_index);
        // As far as `max_rep` is too far too.
        Self::new(rep, max_rep.saturating_sub(1))
    }
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
    let h_bits = ms.tagged_hash_log();
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

/// `ZSTD_fillHashTableForCCtx`, which is only for `ZSTD_dtlm_fast`.
fn fill_hash_table_for_cctx(ms: &mut MatchState, prefix: Prefix<'_>, end: usize) -> Result<()> {
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
        TableFillPurpose::ForCCtx => fill_hash_table_for_cctx(ms, prefix, end),
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

/// `targetLength + !targetLength`: how far `fast` goes from one position to the next, before it speeds up.
const fn least_step(c_params: &CompressionParameters) -> u32 {
    c_params.target_length + (c_params.target_length == 0) as u32
}

/// What `fast` and `dfast` work out before they look for matches in a block, when there is no dictionary and the window
/// is one segment.
pub(super) struct NoDictBlock<'a> {
    /// The input from `base_index`, the lowest index that is read, up to the end of the block. Positions are in this.
    pub(super) near: Near<'a>,
    pub(super) base_index: u32,
    /// The part of it where matches can be, which starts at `prefix_lowest_index`. A lower index, less that one, wraps
    /// around to a position past the end.
    pub(super) candidates: Near<'a>,
    pub(super) prefix_lowest_index: u32,
    pub(super) prefix_lowest: u32,
    pub(super) istart: u32,
    /// The first position to look at.
    pub(super) first: u32,
    /// The last position that [`HASH_READ_SIZE`] bytes can be read at.
    pub(super) ilimit: usize,
    pub(super) offset_1: u32,
    pub(super) offset_2: u32,
    /// The repeat offsets that reach too far, which are 0 above.
    pub(super) offset_saved1: u32,
    pub(super) offset_saved2: u32,
}

impl<'a> NoDictBlock<'a> {
    /// `None` if the block is too short to look for anything.
    pub(super) fn new(
        ms: &MatchState,
        rep: &[u32; ZSTD_REP_NUM],
        src: &BlockSrc<'a>,
    ) -> Result<Option<Self>> {
        let window_log = ms.c_params.window_log;
        let start_index = src.index_of(src.start);
        let prefix_lowest_index = ms.get_lowest_prefix_index(src.index_of(src.end), window_log);
        let first_index = start_index + u32::from(start_index == prefix_lowest_index);
        let window_low = ms.get_lowest_prefix_index(first_index, window_log);

        // A repeat offset reaches as far as the window did at the start of the block.
        let base_index = window_low.min(prefix_lowest_index);
        let near = Near::new(src.buf.sub(src.pos_of(base_index)..src.end)?)?;
        let prefix_lowest = prefix_lowest_index - base_index;
        let Some(ilimit) = near.bytes().len().checked_sub(HASH_READ_SIZE) else {
            return Ok(None);
        };

        let SavedRep {
            offset_1,
            offset_2,
            offset_saved1,
            offset_saved2,
        } = SavedRep::new(rep, first_index.wrapping_sub(window_low));
        Ok(Some(Self {
            near,
            base_index,
            candidates: Near::new(near.bytes().sub(prefix_lowest as usize..)?)?,
            prefix_lowest_index,
            prefix_lowest,
            istart: start_index - base_index,
            first: first_index - base_index,
            ilimit,
            offset_1,
            offset_2,
            offset_saved1,
            offset_saved2,
        }))
    }
}

/// Where `fast` and `dfast` put the matches they find in a block, when there is no dictionary and the window is one
/// segment. All of it is read and written once per match, so that the search for the next one has the registers.
pub(super) struct MatchSink<'a, 'b> {
    seq_store: SeqSink<'b>,
    /// The input from the lowest index a match can be at. Positions are in this.
    near: Near<'a>,
    /// The same with what is before it, as far as a repeat offset can reach.
    older: Near<'a>,
    /// How much that is.
    older_len: u32,
    /// The end of the last match.
    anchor: u32,
    failed: bool,
}

impl MatchSink<'_, '_> {
    /// The 4 bytes that are `offset` before `pos`.
    #[inline(always)]
    fn read32_before(&self, pos: u32, offset: u32) -> Option<u32> {
        match self.near.read32(pos.wrapping_sub(offset)) {
            Some(bytes) => Some(bytes),
            None => {
                core::hint::cold_path();
                self.older
                    .read32((pos + self.older_len).wrapping_sub(offset))
            }
        }
    }

    /// How long what is at `pos` is the same as what is `offset` before.
    #[inline(always)]
    fn count_before(&self, pos: u32, offset: u32) -> u32 {
        if offset <= pos {
            self.near.count(pos, pos - offset)
        } else {
            core::hint::cold_path();
            let pos = pos + self.older_len;
            self.older.count(pos, pos.wrapping_sub(offset))
        }
    }

    /// Stores the match from `ip` to `end`, with the literals before it.
    #[inline(always)]
    fn store(&mut self, ip: u32, end: u32, off_base: u32) {
        let anchor = self.anchor;
        self.anchor = end;
        if (self.seq_store)
            .store_seq(ip - anchor, self.near, anchor, off_base, end - ip)
            .is_err()
        {
            core::hint::cold_path();
            self.failed = true;
        }
    }

    /// Whether the bytes before `ip` and before what is `offset` before it are the same.
    #[inline(always)]
    fn same_byte_before(&self, ip: u32, offset: u32) -> bool {
        let ip = ip + self.older_len;
        self.older.read8(ip - 1) == self.older.read8((ip - 1).wrapping_sub(offset))
    }
}

/// What `fast` looks for matches with, when there is no dictionary and the window is one segment.
struct Finder {
    /// The index of the first position.
    base_index: u32,
    step_size: u32,
    hlog: u32,
    /// Where to start.
    first: u32,
    rep_offset1: u32,
    rep_offset2: u32,
}

impl Finder {
    /// `ZSTD_compressBlock_fast_noDict_generic`
    ///
    /// Each turn of the inner loop looks at two positions, that of index `current0` and the next one, for a match, and
    /// at `ip2` for a repeat. The C code computes hashes and reads the table one position ahead. Here that is left to
    /// the processor: a turn only takes the position and the 8 bytes there, `bytes0`, from the one before.
    #[inline(never)]
    fn find_matches<const MLS: u32>(
        &mut self,
        hash_table: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
    ) {
        const K_STEP_INCR: u32 = 1 << (K_SEARCH_STRENGTH - 1);
        let Self {
            base_index,
            step_size,
            hlog,
            first: mut ip0,
            mut rep_offset1,
            mut rep_offset2,
        } = *self;
        let near = sink.near;
        if hash_table.is_empty() {
            return;
        }
        let Some(mut bytes0) = near.read64(ip0) else {
            return;
        };

        'block: loop {
            let mut step = step_size;
            let mut next_step = ip0 + K_STEP_INCR;
            let mut ip2 = ip0 + step;
            let mut current0 = base_index.wrapping_add(ip0);

            // Ends with where 4 bytes are the same as earlier.
            let (ip, back, off_base) = loop {
                // There is a position after `ip2` to look at, and that one is before the last that can be.
                let Some(ahead) = near.window::<{ HASH_READ_SIZE + 2 }>(ip2) else {
                    break 'block;
                };
                let idx0 = table_swap(hash_table, hash_of::<MLS>(bytes0, hlog), current0);

                if sink.read32_before(ip2, rep_offset1) == Some(le32_at::<0, _>(ahead))
                    && rep_offset1 > 0
                {
                    table_put(hash_table, hash_of::<MLS>(bytes0 >> 8, hlog), current0 + 1);
                    let back = u32::from(sink.same_byte_before(ip2, rep_offset1));
                    break (ip2, back, REPCODE1_TO_OFFBASE);
                }
                let mut match0 = idx0.wrapping_sub(base_index);
                if near.read32(match0) == Some(bytes0 as u32) {
                    table_put(hash_table, hash_of::<MLS>(bytes0 >> 8, hlog), current0 + 1);
                } else {
                    // As far as they are hashed or compared.
                    let bytes1 = bytes0 >> 8;
                    current0 += 1;
                    let idx1 = table_swap(hash_table, hash_of::<MLS>(bytes1, hlog), current0);
                    match0 = idx1.wrapping_sub(base_index);
                    if near.read32(match0) != Some(bytes1 as u32) {
                        current0 = base_index.wrapping_add(ip2);
                        bytes0 = le64_at::<0, _>(ahead);
                        ip2 += step;
                        if ip2 >= next_step {
                            core::hint::cold_path();
                            step += 1;
                            next_step += K_STEP_INCR;
                        }
                        continue;
                    }
                    // `ip2` is certain to be before the end of the match only if the step is small.
                    if step <= 4 {
                        table_put(
                            hash_table,
                            hash_of::<MLS>(le64_at::<0, _>(ahead), hlog),
                            base_index.wrapping_add(ip2),
                        );
                    }
                }
                let ip = current0.wrapping_sub(base_index);
                rep_offset2 = rep_offset1;
                rep_offset1 = ip - match0;
                let back = near.count_backwards(ip, sink.anchor, match0, 0);
                break (ip, back, offset_to_offbase(rep_offset1));
            };

            ip0 = ip + 4 + sink.count_before(ip + 4, rep_offset1);
            sink.store(ip - back, ip0, off_base);

            // `ip0` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip0 - 2) else {
                break 'block;
            };
            if let Some(to_insert) = near.read64((current0 + 2).wrapping_sub(base_index)) {
                table_put(hash_table, hash_of::<MLS>(to_insert, hlog), current0 + 2);
            }
            table_put(
                hash_table,
                hash_of::<MLS>(le64_at::<0, _>(around), hlog),
                base_index.wrapping_add(ip0 - 2),
            );
            bytes0 = le64_at::<2, _>(around);

            while rep_offset2 > 0 && sink.read32_before(ip0, rep_offset2) == Some(bytes0 as u32) {
                let end = ip0 + 4 + sink.count_before(ip0 + 4, rep_offset2);
                core::mem::swap(&mut rep_offset1, &mut rep_offset2);
                table_put(
                    hash_table,
                    hash_of::<MLS>(bytes0, hlog),
                    base_index.wrapping_add(ip0),
                );
                sink.store(ip0, end, REPCODE1_TO_OFFBASE);
                ip0 = end;
                let Some(bytes) = near.read64(ip0) else {
                    break 'block;
                };
                bytes0 = bytes;
            }
        }

        self.rep_offset1 = rep_offset1;
        self.rep_offset2 = rep_offset2;
    }
}

/// `ZSTD_compressBlock_fast`
pub(crate) fn compress_block_fast(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let Some(block) = NoDictBlock::new(ms, rep, src)? else {
        return Ok(src.end - src.start);
    };
    let hlog = ms.c_params.hash_log;
    let mut finder = Finder {
        base_index: block.prefix_lowest_index,
        // The least step is 2, as two positions are looked at per turn.
        step_size: least_step(&ms.c_params) + 1,
        hlog,
        first: block.first - block.prefix_lowest,
        rep_offset1: block.offset_1,
        rep_offset2: block.offset_2,
    };
    let mut sink = MatchSink {
        seq_store: SeqSink::new(seq_store),
        near: block.candidates,
        older: block.near,
        older_len: block.prefix_lowest,
        anchor: block.istart - block.prefix_lowest,
        failed: false,
    };
    let hash_table = ms.hash_table.sub_mut(..1 << hlog)?;
    match ms.c_params.min_match {
        5 => finder.find_matches::<5>(hash_table, &mut sink),
        6 => finder.find_matches::<6>(hash_table, &mut sink),
        7 => finder.find_matches::<7>(hash_table, &mut sink),
        _ => finder.find_matches::<4>(hash_table, &mut sink),
    }
    if sink.failed {
        return Err(BUG);
    }

    restore_rep(
        rep,
        finder.rep_offset1,
        finder.rep_offset2,
        block.offset_saved1,
        block.offset_saved2,
    );
    Ok((sink.near.len() - sink.anchor) as usize)
}

/// `ZSTD_compressBlock_fast_dictMatchState_generic`
fn compress_block_fast_dict_match_state_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    seg: &TwoSegments<'_>,
) -> Result<usize> {
    const K_STEP_INCR: usize = 1 << K_SEARCH_STRENGTH;

    let hlog = ms.c_params.hash_log;
    let step_size = least_step(&ms.c_params) as usize;
    let [mut offset_1, mut offset_2, _] = *rep;
    let hash_table = ms.hash_table.as_mut_slice();
    let dms = src.dms.as_ref().ok_or(BUG)?;
    let dict_hash_table = dms.ms.hash_table.as_slice();
    let dict_h_bits = dms.ms.tagged_hash_log();

    let mut anchor = seg.istart;
    let mut ip0 = seg.first();
    let mut ip1 = seg.istart + step_size;

    'search: while ip1 <= seg.ilimit {
        let mut hash0 = hash_ptr(seg.buf, ip0, hlog, MLS)?;

        let dict_hash_and_tag0 = hash_ptr(seg.buf, ip0, dict_h_bits, MLS)?;
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
            let rep_match = seg.locate(rep_index);
            let hash1 = hash_ptr(seg.buf, ip1, hlog, MLS)?;
            let dict_hash_and_tag1 = hash_ptr(seg.buf, ip1, dict_h_bits, MLS)?;
            hash_table.put(hash0, curr)?;

            if index_overlap_check(seg.prefix_start_index, rep_index)
                && read_le32(rep_match.buf, rep_match.pos)? == read_le32(seg.buf, ip0 + 1)?
            {
                let m_length = count_2segments(
                    seg.buf,
                    ip0 + 1 + 4,
                    rep_match.buf,
                    rep_match.pos + 4,
                    seg.iend,
                    rep_match.end,
                    seg.prefix_start,
                )? + 4;
                ip0 += 1;
                seq_store.store_seq(
                    ip0 - anchor,
                    seg.buf,
                    anchor,
                    REPCODE1_TO_OFFBASE,
                    m_length,
                )?;
                break m_length;
            }

            if dict_tags_match {
                let dict_match_index = dict_match_index_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS;
                let dict_match = seg.dict_pos_of(dict_match_index);
                // A match in the dictionary is only taken if there is no candidate in the prefix.
                if dict_match_index > seg.dict_start_index
                    && read_le32(seg.dict_buf, dict_match)? == read_le32(seg.buf, ip0)?
                    && match_index <= seg.prefix_start_index
                {
                    let offset = curr
                        .wrapping_sub(dict_match_index)
                        .wrapping_sub(seg.dict_index_delta);
                    let mut m_length = count_2segments(
                        seg.buf,
                        ip0 + 4,
                        seg.dict_buf,
                        dict_match + 4,
                        seg.iend,
                        seg.dict_end,
                        seg.prefix_start,
                    )? + 4;
                    let back = count_backwards(
                        seg.buf,
                        ip0,
                        anchor,
                        seg.dict_buf,
                        dict_match,
                        seg.dict_start,
                    );
                    ip0 -= back;
                    m_length += back;
                    offset_2 = offset_1;
                    offset_1 = offset;
                    seq_store.store_seq(
                        ip0 - anchor,
                        seg.buf,
                        anchor,
                        offset_to_offbase(offset),
                        m_length,
                    )?;
                    break m_length;
                }
            }

            let match_pos = src.pos_of(match_index);
            if match4_found(seg.buf, ip0, match_pos, match_index, seg.prefix_start_index)? {
                let offset = ip0.wrapping_sub(match_pos) as u32;
                let mut m_length = count(seg.buf, ip0 + 4, seg.buf, match_pos + 4, seg.iend)? + 4;
                let back =
                    count_backwards(seg.buf, ip0, anchor, seg.buf, match_pos, seg.prefix_start);
                ip0 -= back;
                m_length += back;
                offset_2 = offset_1;
                offset_1 = offset;
                seq_store.store_seq(
                    ip0 - anchor,
                    seg.buf,
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
            if ip1 > seg.ilimit {
                break 'search;
            }

            curr = src.index_of(ip0);
            hash0 = hash1;
        };

        ip0 += m_length;
        anchor = ip0;

        if ip0 <= seg.ilimit {
            hash_table.put(
                hash_ptr(seg.buf, src.pos_of(curr + 2), hlog, MLS)?,
                curr + 2,
            )?;
            hash_table.put(
                hash_ptr(seg.buf, ip0 - 2, hlog, MLS)?,
                src.index_of(ip0 - 2),
            )?;

            while ip0 <= seg.ilimit {
                let current2 = src.index_of(ip0);
                let rep_index2 = current2.wrapping_sub(offset_2);
                let rep_match2 = seg.locate(rep_index2);
                if !(index_overlap_check(seg.prefix_start_index, rep_index2)
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(seg.buf, ip0)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    seg.buf,
                    ip0 + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    seg.iend,
                    rep_match2.end,
                    seg.prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, seg.buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_table.put(hash_ptr(seg.buf, ip0, hlog, MLS)?, current2)?;
                ip0 += rep_length2;
                anchor = ip0;
            }
        }

        ip1 = ip0 + step_size;
    }

    let [rep0, rep1, _] = rep;
    *rep0 = offset_1;
    *rep1 = offset_2;
    Ok(seg.iend - anchor)
}

/// `ZSTD_compressBlock_fast_dictMatchState`
pub(crate) fn compress_block_fast_dict_match_state(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let Some(seg) = &TwoSegments::with_dict_match_state(src, ms.window.dict_limit)? else {
        return Ok(src.end - src.start);
    };
    match ms.c_params.min_match {
        5 => compress_block_fast_dict_match_state_generic::<5>(ms, seq_store, rep, src, seg),
        6 => compress_block_fast_dict_match_state_generic::<6>(ms, seq_store, rep, src, seg),
        7 => compress_block_fast_dict_match_state_generic::<7>(ms, seq_store, rep, src, seg),
        _ => compress_block_fast_dict_match_state_generic::<4>(ms, seq_store, rep, src, seg),
    }
}

/// `ZSTD_compressBlock_fast_extDict_generic`
fn compress_block_fast_ext_dict_generic<const MLS: u32>(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
    seg: &TwoSegments<'_>,
) -> Result<usize> {
    const K_STEP_INCR: usize = 1 << (K_SEARCH_STRENGTH - 1);

    let hlog = ms.c_params.hash_log;
    let step_size = least_step(&ms.c_params) as usize + 1;
    let mut anchor = seg.istart;
    let mut ip0 = seg.istart;
    let SavedRep {
        mut offset_1,
        mut offset_2,
        offset_saved1,
        offset_saved2,
    } = SavedRep::with_ext_dict(rep, src, seg);

    // Whether there is a match for the position `ip` at `idx`, which is from the table.
    let match_found = |ip: usize, idx: u32| -> Result<bool> {
        let candidate = seg.locate(idx);
        Ok(idx >= seg.dict_start_index
            && read_le32(candidate.buf, candidate.pos)? == read_le32(seg.buf, ip)?)
    };
    let hash_table = ms.hash_table.as_mut_slice();

    'start: loop {
        let mut step = step_size;
        let mut next_step = ip0 + K_STEP_INCR;

        let mut ip1 = ip0 + 1;
        let mut ip2 = ip0 + step;
        let mut ip3 = ip2 + 1;
        if ip3 >= seg.ilimit {
            break 'start;
        }

        let mut hash0 = hash_ptr(seg.buf, ip0, hlog, MLS)?;
        let mut hash1 = hash_ptr(seg.buf, ip1, hlog, MLS)?;
        let mut idx = hash_table.at(hash0)?;
        let mut current0;

        // Ends with the start and the length so far of a repeat match, or with `None` for a match at `idx`.
        let rep_match = loop {
            let current2 = src.index_of(ip2);
            let rep_index = current2.wrapping_sub(offset_1);
            let mut rep_match = seg.locate(rep_index);
            // The 4 bytes have to be in one segment, with a byte before them.
            let rep_found = ((seg.prefix_start_index.wrapping_sub(rep_index) >= 4)
                & (offset_1 > 0))
                && read_le32(rep_match.buf, rep_match.pos)? == read_le32(seg.buf, ip2)?;

            current0 = src.index_of(ip0);
            hash_table.put(hash0, current0)?;

            if rep_found {
                ip0 = ip2;
                let back = usize::from(
                    seg.buf.at(ip0 - 1)? == rep_match.buf.at(rep_match.pos.wrapping_sub(1))?,
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
            hash1 = hash_ptr(seg.buf, ip2, hlog, MLS)?;

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
            hash1 = hash_ptr(seg.buf, ip2, hlog, MLS)?;

            ip0 = ip1;
            ip1 = ip2;
            ip2 = ip0 + step;
            ip3 = ip1 + step;

            if ip2 >= next_step {
                step += 1;
                next_step += K_STEP_INCR;
            }
            if ip3 >= seg.ilimit {
                break 'start;
            }
        };

        let (offcode, match0, mut m_length) = match rep_match {
            Some((match0, m_length)) => (REPCODE1_TO_OFFBASE, match0, m_length),
            None => {
                let offset = current0.wrapping_sub(idx);
                let mut match0 = seg.locate(idx);
                offset_2 = offset_1;
                offset_1 = offset;
                let back =
                    count_backwards(seg.buf, ip0, anchor, match0.buf, match0.pos, match0.start);
                ip0 -= back;
                match0.pos -= back;
                (offset_to_offbase(offset), match0, 4 + back)
            }
        };

        m_length += count_2segments(
            seg.buf,
            ip0 + m_length,
            match0.buf,
            match0.pos + m_length,
            seg.iend,
            match0.end,
            seg.prefix_start,
        )?;
        seq_store.store_seq(ip0 - anchor, seg.buf, anchor, offcode, m_length)?;
        ip0 += m_length;
        anchor = ip0;

        if ip1 < ip0 {
            hash_table.put(hash1, src.index_of(ip1))?;
        }

        if ip0 <= seg.ilimit {
            hash_table.put(
                hash_ptr(seg.buf, src.pos_of(current0 + 2), hlog, MLS)?,
                current0 + 2,
            )?;
            hash_table.put(
                hash_ptr(seg.buf, ip0 - 2, hlog, MLS)?,
                src.index_of(ip0 - 2),
            )?;

            while ip0 <= seg.ilimit {
                let rep_index2 = src.index_of(ip0).wrapping_sub(offset_2);
                let rep_match2 = seg.locate(rep_index2);
                if !((index_overlap_check(seg.prefix_start_index, rep_index2) & (offset_2 > 0))
                    && read_le32(rep_match2.buf, rep_match2.pos)? == read_le32(seg.buf, ip0)?)
                {
                    break;
                }
                let rep_length2 = count_2segments(
                    seg.buf,
                    ip0 + 4,
                    rep_match2.buf,
                    rep_match2.pos + 4,
                    seg.iend,
                    rep_match2.end,
                    seg.prefix_start,
                )? + 4;
                core::mem::swap(&mut offset_1, &mut offset_2);
                seq_store.store_seq(0, seg.buf, anchor, REPCODE1_TO_OFFBASE, rep_length2)?;
                hash_table.put(hash_ptr(seg.buf, ip0, hlog, MLS)?, src.index_of(ip0))?;
                ip0 += rep_length2;
                anchor = ip0;
            }
        }
    }

    restore_rep(rep, offset_1, offset_2, offset_saved1, offset_saved2);
    Ok(seg.iend - anchor)
}

/// `ZSTD_compressBlock_fast_extDict`
pub(crate) fn compress_block_fast_ext_dict(
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
        return compress_block_fast(ms, seq_store, rep, src);
    }
    match ms.c_params.min_match {
        5 => compress_block_fast_ext_dict_generic::<5>(ms, seq_store, rep, src, seg),
        6 => compress_block_fast_ext_dict_generic::<6>(ms, seq_store, rep, src, seg),
        7 => compress_block_fast_ext_dict_generic::<7>(ms, seq_store, rep, src, seg),
        _ => compress_block_fast_ext_dict_generic::<4>(ms, seq_store, rep, src, seg),
    }
}
