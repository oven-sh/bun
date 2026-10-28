//! `zstd_fast.c`: the `fast` strategy, which looks up one hash table.

use core::sync::atomic::{Ordering, compiler_fence};

use super::internal::{
    BlockSrc, CompressionParameters, HASH_READ_SIZE, Hasher, K_SEARCH_STRENGTH, MatchState, Near,
    Prefix, REPCODE1_TO_OFFBASE, SeqSink, SeqStore, TableFillPurpose, ZSTD_SHORT_CACHE_TAG_BITS,
    compare_packed_tags, hashed_get, hashed_put, hashed_swap, le32_at, le64_at, offset_to_offbase,
    table_of_size, table_put,
};
use crate::common::ZSTD_REP_NUM;
use crate::error::Result;
use crate::util::{BUG, SliceExt};

const FAST_HASH_FILL_STEP: u32 = 3;

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

/// What `fast` and `dfast` index a dictionary by: every third position, with the 10 bytes there, which the 8 bytes at
/// it and at the two positions in between are among.
/// `array_windows().step_by(3)` gives the same, and indexing a dictionary then takes 1.4 to 1.6 times as long.
#[derive(Clone)]
pub(super) struct ThirdPositions<'a> {
    /// From the first position that is left up to the end of the 10 bytes at the last one.
    bytes: &'a [u8],
    /// The index of the first position that is left.
    index: u32,
}

/// One of [`ThirdPositions`].
pub(super) struct ThirdPosition<'a> {
    pub(super) index: u32,
    pub(super) bytes: &'a [u8; THIRD_POSITION_SIZE],
}

const THIRD_POSITION_SIZE: usize = FAST_HASH_FILL_STEP as usize - 1 + HASH_READ_SIZE;

impl<'a> ThirdPositions<'a> {
    /// From `first_index` up to the position `end` of the segment: none if that is before.
    pub(super) fn new(prefix: Prefix<'a>, first_index: u32, end: usize) -> Self {
        let bytes = prefix.buf.get(prefix.pos_of(first_index)..end);
        let bytes = bytes.unwrap_or_default();
        let len = match bytes.len().checked_sub(THIRD_POSITION_SIZE) {
            Some(more) => bytes.len() - more % FAST_HASH_FILL_STEP as usize,
            None => 0,
        };
        Self {
            bytes: bytes.get(..len).unwrap_or_default(),
            index: first_index,
        }
    }
}

impl<'a> Iterator for ThirdPositions<'a> {
    type Item = ThirdPosition<'a>;

    #[inline(always)]
    fn next(&mut self) -> Option<Self::Item> {
        let item = ThirdPosition {
            index: self.index,
            bytes: self.bytes.first_chunk()?,
        };
        self.bytes = self.bytes.get(FAST_HASH_FILL_STEP as usize..)?;
        self.index += FAST_HASH_FILL_STEP;
        Some(item)
    }
}

impl DoubleEndedIterator for ThirdPositions<'_> {
    #[inline(always)]
    fn next_back(&mut self) -> Option<Self::Item> {
        let (before, bytes) = self.bytes.split_last_chunk()?;
        let item = ThirdPosition {
            index: self.index + before.len() as u32,
            bytes,
        };
        let len = self.bytes.len() - FAST_HASH_FILL_STEP as usize;
        self.bytes = self.bytes.get(..len)?;
        Some(item)
    }
}

/// `ZSTD_writeTaggedIndex`: the tables of a dictionary keep 8 more bits of the hash beside each index. The size of
/// `table` is a power of 2 that the hash is less than.
#[inline(always)]
pub(super) fn put_tagged(table: &mut [u32], hash_and_tag: usize, index: u32) {
    let hash = hash_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS;
    if let Some(cell) = table.get_mut(hash & table.len().wrapping_sub(1)) {
        *cell = (index << ZSTD_SHORT_CACHE_TAG_BITS) | u32::from(hash_and_tag as u8);
    }
}

/// Indexes the positions between `positions`, for which the C code only has the cells that are empty when it gets to
/// them, on its way from the first position to the last. As `table` is empty, it comes to the same to go from the last
/// to the first, and to index `positions` afterwards. Whether a cell is empty, which is as good as random, is then of
/// no concern.
#[inline(always)]
pub(super) fn put_tagged_in_between(
    table: &mut [u32],
    hasher: Hasher,
    positions: ThirdPositions<'_>,
) {
    debug_assert!(table.iter().all(|&cell| cell == 0));
    for at in positions.rev() {
        put_tagged(table, hasher.hash(le64_at::<2, _>(at.bytes)), at.index + 2);
        put_tagged(table, hasher.hash(le64_at::<1, _>(at.bytes)), at.index + 1);
    }
}

/// `ZSTD_fillHashTableForCDict`: the table is empty.
fn fill_hash_table_for_cdict(ms: &mut MatchState, prefix: Prefix<'_>, end: usize) {
    let hasher = Hasher::new(ms.tagged_hash_log(), ms.c_params.min_match);
    let positions = ThirdPositions::new(prefix, ms.next_to_update, end);
    let hash_table = ms.hash_table.as_mut_slice();
    put_tagged_in_between(hash_table, hasher, positions.clone());
    for at in positions {
        put_tagged(hash_table, hasher.hash(le64_at::<0, _>(at.bytes)), at.index);
    }
}

/// `ZSTD_fillHashTableForCCtx`
fn fill_hash_table_for_cctx(ms: &mut MatchState, prefix: Prefix<'_>, end: usize) {
    let hasher = Hasher::new(ms.c_params.hash_log, ms.c_params.min_match);
    let positions = ThirdPositions::new(prefix, ms.next_to_update, end);
    let hash_table = ms.hash_table.as_mut_slice();
    for at in positions {
        table_put(hash_table, hasher.hash(le64_at::<0, _>(at.bytes)), at.index);
    }
}

/// `ZSTD_fillHashTable`: indexes the segment from `ms.next_to_update` up to the position `end`.
pub(crate) fn fill_hash_table(
    ms: &mut MatchState,
    prefix: Prefix<'_>,
    end: usize,
    tfp: TableFillPurpose,
) {
    match tfp {
        TableFillPurpose::ForCDict => fill_hash_table_for_cdict(ms, prefix, end),
        TableFillPurpose::ForCCtx => fill_hash_table_for_cctx(ms, prefix, end),
    }
}

/// `targetLength + !targetLength`: how far `fast` goes from one position to the next, before it speeds up.
const fn least_step(c_params: &CompressionParameters) -> u32 {
    c_params.target_length + (c_params.target_length == 0) as u32
}

/// What `fast` and `dfast` work out before they look for matches in a block, when there is no dictionary and the window
/// is one segment.
pub(super) struct NoDictBlock<'a> {
    /// The input from `prefix_lowest_index`, the lowest index a match can be at, up to the end of the block. Positions
    /// are in this: a lower index, less that one, wraps around to a position past the end.
    near: Near<'a>,
    pub(super) prefix_lowest_index: u32,
    /// The same with what is before it, as far as a repeat offset reaches: where the window started at the start of the
    /// block.
    older: Near<'a>,
    /// How much that is.
    older_len: u32,
    istart: u32,
    /// The first position to look at.
    pub(super) first: u32,
    pub(super) rep: SavedRep,
}

impl<'a> NoDictBlock<'a> {
    pub(super) fn new(
        ms: &MatchState,
        rep: &[u32; ZSTD_REP_NUM],
        src: &BlockSrc<'a>,
    ) -> Result<Self> {
        let window_log = ms.c_params.window_log;
        let start_index = src.index_of(src.start);
        let prefix_lowest_index = ms.get_lowest_prefix_index(src.index_of(src.end), window_log);
        let first_index = start_index + u32::from(start_index == prefix_lowest_index);
        let window_low = ms.get_lowest_prefix_index(first_index, window_log);

        let older_index = window_low.min(prefix_lowest_index);
        let older = src.buf.sub(src.pos_of(older_index)..src.end)?;
        let older_len = prefix_lowest_index - older_index;
        Ok(Self {
            near: Near::new(older.sub(older_len as usize..)?)?,
            prefix_lowest_index,
            older: Near::new(older)?,
            older_len,
            istart: start_index - prefix_lowest_index,
            first: first_index - prefix_lowest_index,
            rep: SavedRep::new(rep, first_index.wrapping_sub(window_low)),
        })
    }
}

/// What `fast` and `dfast` work out before they look for matches in a block, when the window is two segments.
pub(super) struct ExtDictBlock<'a> {
    pub(super) window: Segments<'a>,
    /// The index of the first position of the current segment.
    pub(super) prefix_start_index: u32,
    /// Where the block starts in it.
    pub(super) istart: u32,
    pub(super) rep: SavedRep,
}

impl<'a> ExtDictBlock<'a> {
    /// `None` if nothing of the older segment is within reach.
    pub(super) fn new(
        ms: &MatchState,
        rep: &[u32; ZSTD_REP_NUM],
        src: &BlockSrc<'a>,
    ) -> Result<Option<Self>> {
        let dict_start_index =
            ms.get_lowest_match_index(src.index_of(src.end), ms.c_params.window_log);
        let prefix_start_index = ms.window.dict_limit.max(dict_start_index);
        if prefix_start_index == dict_start_index {
            return Ok(None);
        }
        let start_index = src.index_of(src.start);
        let older = (src.dict_buf)
            .sub(src.dict_pos_of(dict_start_index)..src.dict_pos_of(prefix_start_index))?;
        // As far as the start of the older segment is too far too.
        let max_rep = start_index.wrapping_sub(dict_start_index);
        Ok(Some(Self {
            window: Segments {
                near: Near::new(src.buf.sub(src.pos_of(prefix_start_index)..src.end)?)?,
                older: Near::new(older)?,
            },
            prefix_start_index,
            istart: start_index - prefix_start_index,
            rep: SavedRep::new(rep, max_rep.saturating_sub(1)),
        }))
    }
}

/// Where `fast` and `dfast` put the matches they find in a block, when there is no dictionary and the window is one
/// segment. All of it is read and written once per match, so that the search for the next one has the registers.
pub(super) struct MatchSink<'a, 'b> {
    seq_store: SeqSink<'b>,
    /// The input from the lowest index a match can be at. Positions are in this.
    pub(super) near: Near<'a>,
    /// The same with what is before it, as far as a repeat offset can reach.
    older: Near<'a>,
    /// How much that is.
    older_len: u32,
    /// The end of the last match.
    pub(super) anchor: u32,
    failed: bool,
}

impl<'a, 'b> MatchSink<'a, 'b> {
    pub(super) fn new(seq_store: &'b mut SeqStore, block: &NoDictBlock<'a>) -> Self {
        Self {
            seq_store: SeqSink::new(seq_store),
            near: block.near,
            older: block.older,
            older_len: block.older_len,
            anchor: block.istart,
            failed: false,
        }
    }

    /// For a block that starts at the position `anchor` of `near`, which nothing is read before.
    pub(super) fn with_near(seq_store: &'b mut SeqStore, near: Near<'a>, anchor: u32) -> Self {
        Self {
            seq_store: SeqSink::new(seq_store),
            near,
            older: near,
            older_len: 0,
            anchor,
            failed: false,
        }
    }

    /// How many bytes there are after the last match.
    pub(super) fn last_literals(&self) -> Result<usize> {
        if self.failed {
            return Err(BUG);
        }
        Ok((self.near.len() - self.anchor) as usize)
    }

    /// The 4 bytes that are `offset` before `pos`.
    #[inline(always)]
    pub(super) fn read32_before(&self, pos: u32, offset: u32) -> Option<u32> {
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
    pub(super) fn count_before(&self, pos: u32, offset: u32) -> u32 {
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
    pub(super) fn store<const SHORT: usize>(&mut self, ip: u32, end: u32, off_base: u32) {
        let anchor = self.anchor;
        self.anchor = end;
        if (self.seq_store)
            .store_seq::<SHORT>(ip - anchor, self.near, anchor, off_base, end - ip)
            .is_err()
        {
            core::hint::cold_path();
            self.failed = true;
        }
    }

    /// Stores the match with the last offset that goes on from the one before up to `end`.
    #[inline(always)]
    pub(super) fn store_repeat(&mut self, end: u32) {
        let ip = self.anchor;
        self.anchor = end;
        if (self.seq_store)
            .store_seq_only(0, REPCODE1_TO_OFFBASE, end - ip)
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

/// What can be matched when that is two segments: the current one, and before it either the older one of the window or
/// the content of a dictionary. A place is a position in the two put end to end.
#[derive(Clone, Copy)]
pub(super) struct Segments<'a> {
    /// The current segment, up to the end of the block.
    pub(super) near: Near<'a>,
    /// The other one, as far as it is within reach.
    pub(super) older: Near<'a>,
}

/// Where a place is.
#[derive(Clone, Copy)]
struct Spot<'a> {
    segment: Near<'a>,
    pos: u32,
}

impl<'a> Segments<'a> {
    #[inline(always)]
    fn spot(self, place: u32) -> Spot<'a> {
        let older_len = self.older.len();
        if place < older_len {
            Spot {
                segment: self.older,
                pos: place,
            }
        } else {
            Spot {
                segment: self.near,
                pos: place - older_len,
            }
        }
    }

    /// The place of a position of the current segment.
    #[inline(always)]
    pub(super) const fn place_of(self, pos: u32) -> u32 {
        pos.wrapping_add(self.older.len())
    }

    #[inline(always)]
    pub(super) fn read8(self, place: u32) -> Option<u8> {
        let spot = self.spot(place);
        spot.segment.read8(spot.pos)
    }

    /// Whether the bits of `MASK` are the same in `bytes` and in the 8 bytes at `place`, which are in one segment, as they
    /// are wherever a table leads to.
    #[inline(always)]
    pub(super) fn has<const MASK: u64>(self, place: u32, bytes: u64) -> bool {
        let spot = self.spot(place);
        spot.segment.has::<MASK>(spot.pos, bytes)
    }

    /// The 4 bytes that are `offset` before the position `pos`, if they are in one segment. Which one that is does not
    /// change much from one time to the next.
    #[inline(always)]
    pub(super) fn read32_before(self, pos: u32, offset: u32) -> Option<u32> {
        let at = pos.wrapping_sub(offset);
        match self.near.read32(at) {
            Some(bytes) => Some(bytes),
            None => self.older.read32(self.place_of(at)),
        }
    }

    /// `ZSTD_count_2segments`: how long what is at the position `ip` is the same as what is at `place`.
    #[inline(always)]
    pub(super) fn count(self, ip: u32, place: u32) -> u32 {
        let spot = self.spot(place);
        let len = self.near.count_in(ip, spot.segment, spot.pos);
        if place.wrapping_add(len) != self.older.len() {
            return len;
        }
        len + self.near.count(ip + len, 0)
    }

    /// [`Self::count`] for a place of the older segment.
    #[inline(always)]
    fn count_in_older(self, ip: u32, place: u32) -> u32 {
        let len = self.near.count_in(ip, self.older, place);
        if place + len != self.older.len() {
            return len;
        }
        len + self.near.count(ip + len, 0)
    }

    /// Where the match of the position `ip` with what is `offset` before it ends, if there is one: `bytes` are the 4
    /// bytes at `ip`, and those before have to be in one segment.
    #[inline(always)]
    pub(super) fn repeat_end(self, ip: u32, offset: u32, bytes: u32) -> Option<u32> {
        let at = ip.wrapping_sub(offset);
        let len = match self.near.read32(at) {
            Some(there) if there == bytes => self.near.count(ip + 4, at + 4),
            Some(_) => return None,
            None => {
                let place = self.place_of(at);
                if self.older.read32(place) != Some(bytes) {
                    return None;
                }
                self.count_in_older(ip + 4, place + 4)
            }
        };
        Some(ip + 4 + len)
    }

    /// The match at the position `ip` with what is at `pos` of the current segment, of which `known` bytes are known.
    #[inline(always)]
    pub(super) fn found_near(self, ip: u32, anchor: u32, pos: u32, known: u32) -> Found {
        Found {
            end: ip + known + self.near.count(ip + known, pos + known),
            back: self.near.count_backwards(ip, anchor, pos, 0),
            offset: ip - pos,
        }
    }

    /// The same with what is at `place`, which is in the older segment.
    #[inline(always)]
    pub(super) fn found_older(self, ip: u32, anchor: u32, place: u32, known: u32) -> Found {
        let len = known + self.count_in_older(ip + known, place + known);
        let back = if ip == anchor {
            0
        } else {
            (self.near).count_backwards_in(ip, self.older, place, (ip - anchor).min(place))
        };
        Found {
            end: ip + len,
            back,
            offset: self.place_of(ip) - place,
        }
    }

    /// [`Self::count_backwards`], with a branch on whether `ip` is `anchor`: whoever got there without a step is likely
    /// to do so again.
    #[inline(always)]
    pub(super) fn count_backwards_if_any(self, ip: u32, anchor: u32, place: u32) -> u32 {
        if ip == anchor {
            return 0;
        }
        self.count_backwards(ip, anchor, place)
    }

    /// How many bytes before the position `ip`, down to `anchor`, are the same as those before `place` in its segment.
    #[inline(always)]
    pub(super) fn count_backwards(self, ip: u32, anchor: u32, place: u32) -> u32 {
        let spot = self.spot(place);
        (self.near).count_backwards_in(ip, spot.segment, spot.pos, (ip - anchor).min(spot.pos))
    }
}

/// A match at a position.
pub(super) struct Found {
    pub(super) end: u32,
    /// How many bytes before the position belong to it as well.
    pub(super) back: u32,
    pub(super) offset: u32,
}

/// `condition`, which the compiler then does not look at before what is on its left.
#[inline(always)]
pub(super) fn after(condition: bool) -> bool {
    compiler_fence(Ordering::SeqCst);
    condition
}

/// What `fast` looks for matches with, when there is no dictionary and the window is one segment.
struct Finder {
    /// The index of the first position.
    base_index: u32,
    step_size: u32,
    hasher: Hasher,
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
    ///
    /// `MLS` and `HLOG` are what `hasher` is made with, or both 0 for any: see [`table_of_size`].
    #[inline(never)]
    fn find_matches<const MLS: u32, const HLOG: u32>(
        &mut self,
        hash_table: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
    ) {
        const K_STEP_INCR: u32 = 1 << (K_SEARCH_STRENGTH - 1);
        let Self {
            base_index,
            step_size,
            hasher,
            first: mut ip0,
            mut rep_offset1,
            mut rep_offset2,
        } = *self;
        let near = sink.near;
        let hasher = if HLOG > 0 {
            Hasher::new(HLOG, MLS)
        } else {
            hasher
        };
        let Some(hash_table) = table_of_size::<HLOG>(hash_table) else {
            return;
        };
        let Some(mut bytes0) = near.read64(ip0) else {
            return;
        };

        'block: loop {
            let mut step = step_size;
            let mut next_step = ip0 + K_STEP_INCR;
            let mut ip2 = ip0 + step;
            let mut current0 = base_index.wrapping_add(ip0);

            // Ends with where a match starts and ends.
            let (start, end, off_base) = loop {
                // There is a position after `ip2` to look at, and that one is before the last that can be.
                let Some(ahead) = near.window::<{ HASH_READ_SIZE + 2 }>(ip2) else {
                    break 'block;
                };
                let idx0 = hashed_swap(hash_table, hasher.hash(bytes0), current0);

                if sink.read32_before(ip2, rep_offset1) == Some(le32_at::<0, _>(ahead))
                    && after(rep_offset1 > 0)
                {
                    hashed_put(hash_table, hasher.hash(bytes0 >> 8), current0 + 1);
                    let back = u32::from(sink.same_byte_before(ip2, rep_offset1));
                    let end = ip2 + 4 + sink.count_before(ip2 + 4, rep_offset1);
                    break (ip2 - back, end, REPCODE1_TO_OFFBASE);
                }
                let mut match0 = idx0.wrapping_sub(base_index);
                if near.has::<0xFFFF_FFFF>(match0, bytes0) {
                    hashed_put(hash_table, hasher.hash(bytes0 >> 8), current0 + 1);
                } else {
                    // As far as they are hashed or compared.
                    let bytes1 = bytes0 >> 8;
                    current0 += 1;
                    let idx1 = hashed_swap(hash_table, hasher.hash(bytes1), current0);
                    match0 = idx1.wrapping_sub(base_index);
                    if !near.has::<0xFFFF_FFFF>(match0, bytes1) {
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
                        hashed_put(
                            hash_table,
                            hasher.hash(le64_at::<0, _>(ahead)),
                            base_index.wrapping_add(ip2),
                        );
                    }
                }
                let ip = current0.wrapping_sub(base_index);
                rep_offset2 = rep_offset1;
                rep_offset1 = ip - match0;
                let end = ip + 4 + near.count(ip + 4, match0 + 4);
                let back = near.count_backwards(ip, sink.anchor, match0, 0);
                break (ip - back, end, offset_to_offbase(rep_offset1));
            };

            ip0 = end;
            sink.store::<32>(start, end, off_base);

            // `ip0` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip0 - 2) else {
                break 'block;
            };
            bytes0 = le64_at::<2, _>(around);
            if let Some(to_insert) = near.read64((current0 + 2).wrapping_sub(base_index)) {
                hashed_put(hash_table, hasher.hash(to_insert), current0 + 2);
            }
            hashed_put(
                hash_table,
                hasher.hash(le64_at::<0, _>(around)),
                base_index.wrapping_add(ip0 - 2),
            );

            while rep_offset2 > 0 && sink.read32_before(ip0, rep_offset2) == Some(bytes0 as u32) {
                let end = ip0 + 4 + sink.count_before(ip0 + 4, rep_offset2);
                core::mem::swap(&mut rep_offset1, &mut rep_offset2);
                hashed_put(
                    hash_table,
                    hasher.hash(bytes0),
                    base_index.wrapping_add(ip0),
                );
                sink.store_repeat(end);
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

impl Finder {
    /// `ZSTD_compressBlock_fast_extDict_generic`, which goes about it as [`Self::find_matches`] does.
    #[inline(never)]
    fn find_matches_ext_dict<const MLS: u32, const HLOG: u32>(
        &mut self,
        hash_table: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
        window: Segments<'_>,
    ) {
        const K_STEP_INCR: u32 = 1 << (K_SEARCH_STRENGTH - 1);
        let Self {
            base_index,
            step_size,
            hasher,
            first: mut ip0,
            mut rep_offset1,
            mut rep_offset2,
        } = *self;
        let near = window.near;
        let older_len = window.older.len();
        // The index of the first place.
        let origin_index = base_index.wrapping_sub(older_len);
        let hasher = if HLOG > 0 {
            Hasher::new(HLOG, MLS)
        } else {
            hasher
        };
        let Some(hash_table) = table_of_size::<HLOG>(hash_table) else {
            return;
        };
        let Some(mut bytes0) = near.read64(ip0) else {
            return;
        };

        'block: loop {
            let mut step = step_size;
            let mut next_step = ip0 + K_STEP_INCR;
            let mut ip2 = ip0 + step;
            let mut current0 = base_index.wrapping_add(ip0);

            // Ends with where 4 bytes are the same as earlier, and with the next position if it is still to be indexed.
            let (ip, place, back, off_base, next) = loop {
                let Some(ahead) = near.window::<{ HASH_READ_SIZE + 2 }>(ip2) else {
                    break 'block;
                };
                let idx0 = hashed_swap(hash_table, hasher.hash(bytes0), current0);

                // The 4 bytes have to be in one segment, with a byte before them.
                let rep_place = window.place_of(ip2).wrapping_sub(rep_offset1);
                if window.read32_before(ip2, rep_offset1) == Some(le32_at::<0, _>(ahead))
                    && rep_place != older_len
                    && rep_offset1 > 0
                {
                    hashed_put(hash_table, hasher.hash(bytes0 >> 8), current0 + 1);
                    let back =
                        u32::from(near.read8(ip2 - 1) == window.read8(rep_place.wrapping_sub(1)));
                    break (ip2, rep_place, back, REPCODE1_TO_OFFBASE, u32::MAX);
                }
                let mut place = idx0.wrapping_sub(origin_index);
                let mut next = u32::MAX;
                if window.has::<0xFFFF_FFFF>(place, bytes0) {
                    hashed_put(hash_table, hasher.hash(bytes0 >> 8), current0 + 1);
                } else {
                    let bytes1 = bytes0 >> 8;
                    current0 += 1;
                    let idx1 = hashed_swap(hash_table, hasher.hash(bytes1), current0);
                    place = idx1.wrapping_sub(origin_index);
                    if !window.has::<0xFFFF_FFFF>(place, bytes1) {
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
                    next = ip2;
                }
                let ip = current0.wrapping_sub(base_index);
                rep_offset2 = rep_offset1;
                rep_offset1 = window.place_of(ip) - place;
                let back = window.count_backwards_if_any(ip, sink.anchor, place);
                break (ip, place, back, offset_to_offbase(rep_offset1), next);
            };

            ip0 = ip + 4 + window.count(ip + 4, place + 4);
            sink.store::<32>(ip - back, ip0, off_base);

            if next < ip0
                && let Some(bytes) = near.read64(next)
            {
                hashed_put(
                    hash_table,
                    hasher.hash(bytes),
                    base_index.wrapping_add(next),
                );
            }

            // `ip0` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip0 - 2) else {
                break 'block;
            };
            bytes0 = le64_at::<2, _>(around);
            if let Some(to_insert) = near.read64((current0 + 2).wrapping_sub(base_index)) {
                hashed_put(hash_table, hasher.hash(to_insert), current0 + 2);
            }
            hashed_put(
                hash_table,
                hasher.hash(le64_at::<0, _>(around)),
                base_index.wrapping_add(ip0 - 2),
            );

            while window.read32_before(ip0, rep_offset2) == Some(bytes0 as u32) && rep_offset2 > 0 {
                let rep_place = window.place_of(ip0).wrapping_sub(rep_offset2);
                let end = ip0 + 4 + window.count(ip0 + 4, rep_place + 4);
                core::mem::swap(&mut rep_offset1, &mut rep_offset2);
                hashed_put(
                    hash_table,
                    hasher.hash(bytes0),
                    base_index.wrapping_add(ip0),
                );
                sink.store_repeat(end);
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
    let block = NoDictBlock::new(ms, rep, src)?;
    let hlog = ms.c_params.hash_log;
    let mut finder = Finder {
        base_index: block.prefix_lowest_index,
        // The least step is 2, as two positions are looked at per turn.
        step_size: least_step(&ms.c_params) + 1,
        hasher: Hasher::new(hlog, ms.c_params.min_match),
        first: block.first,
        rep_offset1: block.rep.offset_1,
        rep_offset2: block.rep.offset_2,
    };
    let mut sink = MatchSink::new(seq_store, &block);
    let hash_table = ms.hash_table.sub_mut(..1 << hlog)?;
    // What the levels come with, for an input of any size.
    match (ms.c_params.min_match, hlog) {
        (7, 14) => finder.find_matches::<7, 14>(hash_table, &mut sink),
        (6, 16) => finder.find_matches::<6, 16>(hash_table, &mut sink),
        (6, 14) => finder.find_matches::<6, 14>(hash_table, &mut sink),
        (6, 13) => finder.find_matches::<6, 13>(hash_table, &mut sink),
        (5, 15) => finder.find_matches::<5, 15>(hash_table, &mut sink),
        (5, 14) => finder.find_matches::<5, 14>(hash_table, &mut sink),
        (5, 13) => finder.find_matches::<5, 13>(hash_table, &mut sink),
        (5, 12) => finder.find_matches::<5, 12>(hash_table, &mut sink),
        (5, 11) => finder.find_matches::<5, 11>(hash_table, &mut sink),
        (4, 15) => finder.find_matches::<4, 15>(hash_table, &mut sink),
        (4, 14) => finder.find_matches::<4, 14>(hash_table, &mut sink),
        (4, 13) => finder.find_matches::<4, 13>(hash_table, &mut sink),
        (4, 12) => finder.find_matches::<4, 12>(hash_table, &mut sink),
        (4, 11) => finder.find_matches::<4, 11>(hash_table, &mut sink),
        _ => finder.find_matches::<0, 0>(hash_table, &mut sink),
    }
    let last_literals = sink.last_literals()?;
    restore_rep(
        rep,
        finder.rep_offset1,
        finder.rep_offset2,
        block.rep.offset_saved1,
        block.rep.offset_saved2,
    );
    Ok(last_literals)
}

/// What `fast` and `dfast` work out before they look for matches in a block, when a dictionary has its own match state.
pub(super) struct DictBlock<'a> {
    /// The current segment, and the content of the dictionary.
    pub(super) window: Segments<'a>,
    /// The index of the first position of the current segment.
    pub(super) prefix_start_index: u32,
    /// The index that the start of the content has in the dictionary's tables.
    pub(super) dict_start_index: u32,
    /// Where the block starts in the current segment.
    pub(super) istart: u32,
}

impl<'a> DictBlock<'a> {
    pub(super) fn new(src: &BlockSrc<'a>, prefix_start_index: u32) -> Result<Self> {
        let dms = src.dms.as_ref().ok_or(BUG)?;
        let dict_start_index = dms.ms.window.dict_limit;
        Ok(Self {
            window: Segments {
                near: Near::new(src.buf.sub(src.pos_of(prefix_start_index)..src.end)?)?,
                older: Near::new(dms.buf.sub(dms.pos_of(dict_start_index)..dms.end)?)?,
            },
            prefix_start_index,
            dict_start_index,
            istart: src.index_of(src.start).wrapping_sub(prefix_start_index),
        })
    }

    /// The first position to look at: not `istart` if there is nothing before it to match.
    pub(super) const fn first(&self) -> u32 {
        self.istart + (self.window.place_of(self.istart) == 0) as u32
    }
}

/// A table of a dictionary, where entries have tags.
#[derive(Clone, Copy)]
pub(super) struct TaggedTable<'a> {
    table: &'a [u32],
    /// How many bits a hash and a tag have.
    h_bits: u32,
    /// The index that the first place has in the table.
    start_index: u32,
}

impl<'a> TaggedTable<'a> {
    pub(super) fn new(table: &'a [u32], h_bits: u32, start_index: u32) -> Result<Self> {
        Ok(Self {
            table: table.sub(..1 << (h_bits - ZSTD_SHORT_CACHE_TAG_BITS))?,
            h_bits,
            start_index,
        })
    }

    /// The place that the table has for the `MLS` first bytes of `bytes`, as many as it was made for. `None` if the tag
    /// tells that it is for something else, or if it is the first place, which stands for none.
    #[inline(always)]
    pub(super) fn get<const MLS: u32>(self, bytes: u64) -> Option<u32> {
        let hash_and_tag = Hasher::new(self.h_bits, MLS).hash(bytes);
        let index_and_tag = hashed_get(self.table, hash_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS);
        if !compare_packed_tags(index_and_tag as usize, hash_and_tag) {
            return None;
        }
        // Costs nothing, and keeps the compiler from asking both questions before it goes on, as it mostly does here.
        compiler_fence(Ordering::SeqCst);
        let index = index_and_tag >> ZSTD_SHORT_CACHE_TAG_BITS;
        (index > self.start_index).then(|| index - self.start_index)
    }
}

impl Finder {
    /// `ZSTD_compressBlock_fast_dictMatchState_generic`
    #[inline(never)]
    fn find_matches_dict<const MLS: u32>(
        &mut self,
        hash_table: &mut [u32],
        sink: &mut MatchSink<'_, '_>,
        window: Segments<'_>,
        dict_table: TaggedTable<'_>,
    ) {
        const K_STEP_INCR: u32 = 1 << K_SEARCH_STRENGTH;
        let Self {
            base_index,
            step_size,
            hasher,
            first: mut ip0,
            mut rep_offset1,
            mut rep_offset2,
        } = *self;
        let near = window.near;
        let hasher = hasher.with_mls(MLS);
        if hash_table.is_empty() || dict_table.table.is_empty() {
            return;
        }
        let Some(mut bytes0) = near.read64(ip0) else {
            return;
        };
        let mut ip1 = sink.anchor + step_size;

        'block: loop {
            let mut step = step_size;
            let mut next_step = ip0 + K_STEP_INCR;
            let mut curr;

            // One turn per position. Ends with a match, or with `None` once a repeat is stored.
            let found = loop {
                let Some(bytes1) = near.read64(ip1) else {
                    break 'block;
                };
                curr = base_index.wrapping_add(ip0);
                let match_index = hashed_swap(hash_table, hasher.hash(bytes0), curr);

                if let Some(end) = window.repeat_end(ip0 + 1, rep_offset1, (bytes0 >> 8) as u32) {
                    sink.store::<32>(ip0 + 1, end, REPCODE1_TO_OFFBASE);
                    ip0 = end;
                    break None;
                }

                // A match in the dictionary is only taken if there is no candidate in the prefix.
                if let Some(place) = dict_table.get::<MLS>(bytes0)
                    && window.older.read32(place) == Some(bytes0 as u32)
                    && match_index <= base_index
                {
                    break Some(window.found_older(ip0, sink.anchor, place, 4));
                }
                let match_pos = match_index.wrapping_sub(base_index);
                if near.has::<0xFFFF_FFFF>(match_pos, bytes0) {
                    break Some(window.found_near(ip0, sink.anchor, match_pos, 4));
                }

                if ip1 >= next_step {
                    core::hint::cold_path();
                    step += 1;
                    next_step += K_STEP_INCR;
                }
                ip0 = ip1;
                ip1 += step;
                bytes0 = bytes1;
            };

            if let Some(found) = found {
                rep_offset2 = rep_offset1;
                rep_offset1 = found.offset;
                sink.store::<32>(ip0 - found.back, found.end, offset_to_offbase(rep_offset1));
                ip0 = found.end;
            }

            // `ip0` is not past the last position that can be looked at.
            let Some(around) = near.window::<{ 2 + HASH_READ_SIZE }>(ip0 - 2) else {
                break 'block;
            };
            bytes0 = le64_at::<2, _>(around);
            if let Some(to_insert) = near.read64((curr + 2).wrapping_sub(base_index)) {
                hashed_put(hash_table, hasher.hash(to_insert), curr + 2);
            }
            hashed_put(
                hash_table,
                hasher.hash(le64_at::<0, _>(around)),
                base_index.wrapping_add(ip0 - 2),
            );

            while let Some(end) = window.repeat_end(ip0, rep_offset2, bytes0 as u32) {
                core::mem::swap(&mut rep_offset1, &mut rep_offset2);
                hashed_put(
                    hash_table,
                    hasher.hash(bytes0),
                    base_index.wrapping_add(ip0),
                );
                sink.store_repeat(end);
                ip0 = end;
                let Some(bytes) = near.read64(ip0) else {
                    break 'block;
                };
                bytes0 = bytes;
            }
            ip1 = ip0 + step_size;
        }

        self.rep_offset1 = rep_offset1;
        self.rep_offset2 = rep_offset2;
    }
}

/// `ZSTD_compressBlock_fast_dictMatchState`
pub(crate) fn compress_block_fast_dict_match_state(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let block = DictBlock::new(src, ms.window.dict_limit)?;
    let dms = src.dms.as_ref().ok_or(BUG)?;
    let dict_table = TaggedTable::new(
        &dms.ms.hash_table,
        dms.ms.tagged_hash_log(),
        block.dict_start_index,
    )?;
    let hlog = ms.c_params.hash_log;
    let [rep_offset1, rep_offset2, _] = *rep;
    let mut finder = Finder {
        base_index: block.prefix_start_index,
        step_size: least_step(&ms.c_params),
        hasher: Hasher::new(hlog, ms.c_params.min_match),
        first: block.first(),
        rep_offset1,
        rep_offset2,
    };
    let mut sink = MatchSink::with_near(seq_store, block.window.near, block.istart);
    let hash_table = ms.hash_table.sub_mut(..1 << hlog)?;
    match ms.c_params.min_match {
        5 => finder.find_matches_dict::<5>(hash_table, &mut sink, block.window, dict_table),
        6 => finder.find_matches_dict::<6>(hash_table, &mut sink, block.window, dict_table),
        7 => finder.find_matches_dict::<7>(hash_table, &mut sink, block.window, dict_table),
        _ => finder.find_matches_dict::<4>(hash_table, &mut sink, block.window, dict_table),
    }
    let last_literals = sink.last_literals()?;
    let [rep0, rep1, _] = rep;
    *rep0 = finder.rep_offset1;
    *rep1 = finder.rep_offset2;
    Ok(last_literals)
}

/// `ZSTD_compressBlock_fast_extDict`
pub(crate) fn compress_block_fast_ext_dict(
    ms: &mut MatchState,
    seq_store: &mut SeqStore,
    rep: &mut [u32; ZSTD_REP_NUM],
    src: &BlockSrc<'_>,
) -> Result<usize> {
    let Some(block) = ExtDictBlock::new(ms, rep, src)? else {
        // Nothing of the older segment is within reach.
        return compress_block_fast(ms, seq_store, rep, src);
    };
    let hlog = ms.c_params.hash_log;
    let mut finder = Finder {
        base_index: block.prefix_start_index,
        step_size: least_step(&ms.c_params) + 1,
        hasher: Hasher::new(hlog, ms.c_params.min_match),
        first: block.istart,
        rep_offset1: block.rep.offset_1,
        rep_offset2: block.rep.offset_2,
    };
    let mut sink = MatchSink::with_near(seq_store, block.window.near, block.istart);
    let hash_table = ms.hash_table.sub_mut(..1 << hlog)?;
    // What the levels come with, for an input that is large enough to get here.
    match (ms.c_params.min_match, hlog) {
        (7, 14) => finder.find_matches_ext_dict::<7, 14>(hash_table, &mut sink, block.window),
        (6, 16) => finder.find_matches_ext_dict::<6, 16>(hash_table, &mut sink, block.window),
        (6, 13) => finder.find_matches_ext_dict::<6, 13>(hash_table, &mut sink, block.window),
        _ => finder.find_matches_ext_dict::<0, 0>(hash_table, &mut sink, block.window),
    }
    let last_literals = sink.last_literals()?;
    restore_rep(
        rep,
        finder.rep_offset1,
        finder.rep_offset2,
        block.rep.offset_saved1,
        block.rep.offset_saved2,
    );
    Ok(last_literals)
}
