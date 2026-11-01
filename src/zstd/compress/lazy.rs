//! `zstd_lazy.c`: the `greedy`, `lazy`, `lazy2` and `btlazy2` strategies.

use core::hint::{Locality, cold_path, prefetch_read};
use core::num::NonZeroU32;
use core::ops::Range;

use super::internal::{
    BlockSrc, CompressionParameters, Descent, DictMatchState, DictMode, DictTree, First, Hash8,
    Hasher, Hints, K_SEARCH_STRENGTH, MatchState, Near, Nodes, Older, Prefix, REPCODE1_TO_OFFBASE,
    RowTags, SecondTagStats, SeqSink, SeqStore, Strategy, TreeInput, ZSTD_DUBT_UNSORTED_MARK,
    ZSTD_ROW_HASH_CACHE_SIZE, bt_children, bt_look_ahead, bt_low, bt_nodes, bt_set_children,
    bt_walk, count_2segments, hash_ptr, hashed_swap, index_overlap_check, offbase_is_offset,
    offbase_to_offset, offset_to_offbase, table_get, table_put,
};
use crate::common::{ZSTD_BLOCKSIZE_MAX, ZSTD_REP_NUM};
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

/// What the searches in the binary trees work on for the time of a block: the tables of a [`MatchState`], and what does
/// not change of it.
struct Dubt<'a> {
    hash_table: &'a mut [u32],
    bt: &'a mut Nodes,
    input: TreeInput<'a>,
    /// The dictionary, if searches go on in it.
    dms: Option<&'a DictMatchState<'a>>,
    hasher: Hasher,
    /// `window.lowLimit`
    low_limit: u32,
    max_distance: u32,
    /// How far a match can be, if that is not down to `low_limit`.
    reach: u32,
    nb_compares: u32,
    next_to_update: &'a mut u32,
}

impl<'a> Dubt<'a> {
    #[inline(always)]
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, search_dms: bool) -> Result<Self> {
        let MatchState {
            hash_table,
            chain_table,
            next_to_update,
            window,
            c_params,
            loaded_dict_end,
            ..
        } = ms;
        if hash_table.len() != 1usize.wrapping_shl(c_params.hash_log)
            || chain_table.len() != 1usize.wrapping_shl(c_params.chain_log)
        {
            return Err(BUG);
        }
        let dict = Prefix {
            buf: src.dict_buf,
            base: src.dict_base,
        };
        let max_distance = 1u32.wrapping_shl(c_params.window_log);
        Ok(Self {
            hash_table: hash_table.as_mut_slice(),
            bt: bt_nodes(chain_table),
            input: TreeInput::new(src.prefix(), dict, window.dict_limit, src.end)?,
            dms: src.dms.as_ref().filter(|_| search_dms),
            hasher: Hasher::new(c_params.hash_log, c_params.min_match.clamp(4, 6)),
            low_limit: window.low_limit,
            max_distance,
            // A dictionary is valid as a whole until it is invalidated as a whole.
            reach: if *loaded_dict_end != 0 {
                u32::MAX
            } else {
                max_distance
            },
            nb_compares: 1u32.wrapping_shl(c_params.search_log),
            next_to_update,
        })
    }

    /// `ZSTD_updateDUBT`: adds the positions from `next_to_update` up to `curr` to the trees, as unsorted chains.
    #[inline(always)]
    fn update(&mut self, curr: u32) -> Result<()> {
        let near = self.input.near;
        let next_to_update = *self.next_to_update;
        let long_update = if self.input.far {
            LONG_UPDATE_FAR
        } else {
            LONG_UPDATE
        };
        if curr.saturating_sub(next_to_update) >= long_update {
            let first = next_to_update..curr;
            let dict_limit = self.input.dict_limit;
            return update_many(
                self.hash_table,
                self.bt,
                near,
                self.hasher,
                first,
                dict_limit,
            );
        }
        for idx in next_to_update..curr {
            let bytes = near.read64(idx.wrapping_sub(self.input.dict_limit));
            let h = self.hasher.hash(bytes.ok_or(BUG)?);
            let match_index = table_get(self.hash_table, h);
            table_put(self.hash_table, h, idx);
            bt_set_children(self.bt, idx, [match_index, ZSTD_DUBT_UNSORTED_MARK]);
            let ahead = idx.wrapping_sub(self.input.dict_limit).wrapping_add(8);
            if self.input.far
                && let Some(bytes) = near.read64(ahead)
            {
                prefetch_l1(self.hash_table, self.hasher.hash(bytes));
            }
        }
        Ok(())
    }

    /// `ZSTD_insertDUBT1`: sorts the position `curr`, which is in a tree but unsorted. `curr` is at least `bt_low`.
    #[inline(always)]
    fn insert_dubt1(&mut self, curr: u32, nb_compares: u32, bt_low: u32) -> Result<()> {
        let window_low = if curr.wrapping_sub(self.low_limit) > self.max_distance {
            curr.wrapping_sub(self.max_distance)
        } else {
            self.low_limit
        };
        if curr < self.input.dict_limit {
            return sort_dubt1_in_dict(
                self.bt,
                self.input,
                self.low_limit,
                curr,
                nb_compares,
                bt_low,
                window_low,
            );
        }
        sort_dubt1(self.bt, &self.input, curr, nb_compares, bt_low, window_low)
    }

    /// `ZSTD_DUBT_findBestMatch` for the position `ip` of `input.near`, but for the dictionary. Returns the length of the
    /// best match, or 0, and how many more positions could have been compared if the dictionary is to be searched.
    #[inline(always)]
    fn find_best_match(&mut self, ip: u32, off_base_ptr: &mut u32) -> Result<DubtFound> {
        let curr = ip.wrapping_add(self.input.dict_limit);
        // `ZSTD_getLowestMatchIndex`
        let window_low = if curr.wrapping_sub(self.low_limit) > self.reach {
            curr.wrapping_sub(self.reach)
        } else {
            self.low_limit
        };
        let h = self.hasher.hash(self.input.near.read64(ip).ok_or(BUG)?);
        let mut match_index = table_get(self.hash_table, h);
        bt_look_ahead::<2, 1>(self.hash_table, self.bt, &self.input, self.hasher, ip);

        let low = window_low.saturating_add(1);
        if match_index < low {
            // There is no candidate: the position is the whole of its tree.
            table_put(self.hash_table, h, curr);
            bt_set_children(self.bt, curr, [0, 0]);
            *self.next_to_update = curr.wrapping_add(1);
            return Ok(DubtFound {
                best_length: 0,
                nb_compares: self.nb_compares,
            });
        }

        let unsort_limit = bt_low(self.bt, curr).max(window_low);
        let mut nb_candidates = self.nb_compares;
        let mut previous_candidate = 0u32;

        // Reach the end of the list of unsorted candidates. The marks become a chain back to where it starts.
        let mut slots = bt_children(self.bt, match_index);
        while let [next_candidate, ZSTD_DUBT_UNSORTED_MARK] = slots
            && match_index > unsort_limit
        {
            if nb_candidates <= 1 {
                // The last candidate is still unsorted: cut the list there.
                bt_set_children(self.bt, match_index, [0, 0]);
                break;
            }
            bt_set_children(self.bt, match_index, [next_candidate, previous_candidate]);
            previous_candidate = match_index;
            match_index = next_candidate;
            slots = bt_children(self.bt, match_index);
            nb_candidates -= 1;
        }

        // Sort the candidates, the oldest first.
        match_index = previous_candidate;
        while match_index != 0 {
            let [_, next_candidate_idx] = bt_children(self.bt, match_index);
            self.insert_dubt1(match_index, nb_candidates, unsort_limit)?;
            match_index = next_candidate_idx;
            nb_candidates += 1;
        }

        // Find the longest match.
        let mut match_end_idx = curr.wrapping_add(8 + 1);
        let mut best_length = 0u32;
        let mut search_dict = true;
        match_index = table_get(self.hash_table, h);
        table_put(self.hash_table, h, curr);
        let nb_compares = bt_walk::<{ First::Alike }, { Hints::All }>(
            self.bt,
            &self.input,
            ip,
            match_index,
            low,
            self.nb_compares,
            Descent::new(self.bt, curr),
            Older::Called,
            |match_index, common| {
                if common.len > best_length {
                    if common.len > match_end_idx.wrapping_sub(match_index) {
                        match_end_idx = match_index.wrapping_add(common.len);
                    }
                    if 4 * (common.len - best_length) as i32
                        > highbit32(curr.wrapping_sub(match_index).wrapping_add(1)) as i32
                            - highbit32(*off_base_ptr) as i32
                    {
                        best_length = common.len;
                        *off_base_ptr = offset_to_offbase(curr.wrapping_sub(match_index));
                    }
                    if common.match_is_smaller.is_none() {
                        // Equal: no way to know which is smaller. Nothing in the dictionary can be longer.
                        search_dict = false;
                        return Ok(false);
                    }
                }
                Ok(true)
            },
        )?;

        // Skip repetitive patterns.
        *self.next_to_update = match_end_idx.wrapping_sub(8);
        Ok(DubtFound {
            best_length,
            nb_compares: if search_dict { nb_compares } else { 0 },
        })
    }
}

impl Dubt<'_> {
    /// `ZSTD_BtFindBestMatch`: updates the trees up to the position `ip` of `input.near` and returns the best match there.
    /// Its length is 0 if there is none.
    #[inline(always)]
    fn search(&mut self, ip: u32) -> Result<Found> {
        let mut off_base = 999_999_999u32;
        let curr = ip.wrapping_add(self.input.dict_limit);
        let len = if curr < *self.next_to_update {
            // In an area that is skipped.
            0
        } else {
            let dict_root = match self.dms {
                Some(dms) => self.dict_root(dms, ip)?,
                None => 0,
            };
            self.update(curr)?;
            let found = self.find_best_match(ip, &mut off_base)?;
            match self.dms {
                Some(dms) if dict_root != 0 && found.nb_compares != 0 => find_better_dict_match(
                    dms,
                    self.input,
                    self.low_limit,
                    ip,
                    dict_root,
                    found,
                    &mut off_base,
                )?,
                _ => found.best_length,
            }
        };
        Ok(Found {
            len,
            off_base: NonZeroU32::new(off_base).ok_or(BUG)?,
        })
    }

    /// [`Self::search`], where the time goes to waiting for memory.
    #[inline(never)]
    fn search_far(&mut self, ip: u32) -> Result<Found> {
        self.search(ip)
    }

    /// [`DictTree::root`] for the position `ip` of `input.near`.
    #[inline(always)]
    fn dict_root(&self, dms: &DictMatchState<'_>, ip: u32) -> Result<u32> {
        let bytes = self.input.near.read64(ip).ok_or(BUG)?;
        let hasher = self.hasher.with_log(dms.ms.c_params.hash_log);
        DictTree::root(*dms, hasher.hash(bytes))
    }
}

/// From that many positions on, [`Dubt::update`] leaves them to [`update_many`], whose loop is tighter.
const LONG_UPDATE: u32 = 8;
/// The same where `update` gives hints at what is about to be read, which `update_many` does not.
const LONG_UPDATE_FAR: u32 = 32;

/// `ZSTD_updateDUBT` of the indices `indices`, which are in `near`, whose first index is `dict_limit`. The sizes of the
/// tables are powers of 2, and that of `hash_table` is what `hasher` is for.
#[cold]
#[inline(never)]
fn update_many(
    hash_table: &mut [u32],
    bt: &mut Nodes,
    near: Near<'_>,
    hasher: Hasher,
    indices: Range<u32>,
    dict_limit: u32,
) -> Result<()> {
    let bytes = near
        .tail(indices.start.wrapping_sub(dict_limit))
        .ok_or(BUG)?;
    match hasher.of_4_bytes() {
        Some(hasher) => update_many_with(hash_table, bt, bytes, indices, |bytes| {
            hasher.hash(u32::from_le_bytes(bytes))
        }),
        None => update_many_with(hash_table, bt, bytes, indices, |bytes| {
            hasher.hash(u64::from_le_bytes(bytes))
        }),
    }
}

/// [`update_many`] of `indices`, the first of which is at the start of `bytes`. `hash` gives the hash of a position from
/// its first `N` bytes.
#[inline(always)]
fn update_many_with<const N: usize>(
    hash_table: &mut [u32],
    bt: &mut Nodes,
    bytes: Near<'_>,
    mut indices: Range<u32>,
    hash: impl Fn([u8; N]) -> usize,
) -> Result<()> {
    if bt.is_empty() {
        return Err(BUG);
    }
    let mut bytes = bytes.bytes().sub(..indices.len() + 7)?;
    while !indices.is_empty() {
        // The nodes of indices that follow each other do so too, up to the end of the table.
        let nodes = bt.sub_mut(indices.start as usize & (bt.len() - 1)..)?;
        let nb_nodes = nodes.len().min(indices.len());
        for ((idx, node), bytes) in indices.clone().zip(nodes).zip(bytes.array_windows()) {
            let match_index = hashed_swap(hash_table, hash(*bytes), idx);
            *node = [match_index, ZSTD_DUBT_UNSORTED_MARK];
        }
        indices.start += nb_nodes as u32;
        bytes = bytes.sub(nb_nodes..)?;
    }
    Ok(())
}

/// `ZSTD_DUBT_findBetterDictMatch`: goes on, in the tree of the dictionary whose root is `root`, with a search for the
/// position `ip` of `input.near` that found `found`. `low_limit` is `window.lowLimit`. Returns the length of the best
/// match.
#[inline(never)]
fn find_better_dict_match(
    dms: &DictMatchState<'_>,
    input: TreeInput<'_>,
    low_limit: u32,
    ip: u32,
    root: u32,
    found: DubtFound,
    offset_ptr: &mut u32,
) -> Result<u32> {
    let tree = DictTree::new(*dms, low_limit)?;
    let curr = ip.wrapping_add(input.dict_limit);
    let mut best_length = found.best_length;
    tree.walk(
        &input,
        ip,
        root,
        found.nb_compares,
        |dict_match_index, common| {
            if common.len > best_length {
                let match_index = dict_match_index.wrapping_add(tree.index_delta);
                if 4 * (common.len - best_length) as i32
                    > highbit32(curr.wrapping_sub(match_index).wrapping_add(1)) as i32
                        - highbit32(offset_ptr.wrapping_add(1)) as i32
                {
                    best_length = common.len;
                    *offset_ptr = offset_to_offbase(curr.wrapping_sub(match_index));
                }
                // At the end, there is no way to know which is smaller.
                return Ok(common.match_is_smaller.is_some());
            }
            Ok(true)
        },
    )?;
    Ok(best_length)
}

/// [`sort_dubt1`] of a position of the older segment of `input`, which starts at the index `low_limit`. All that is
/// before the position is in that segment too.
#[cold]
#[inline(never)]
fn sort_dubt1_in_dict(
    bt: &mut Nodes,
    input: TreeInput<'_>,
    low_limit: u32,
    curr: u32,
    nb_compares: u32,
    bt_low: u32,
    window_low: u32,
) -> Result<()> {
    let older = input.dict();
    let nothing = Prefix { buf: &[], base: 0 };
    let older = TreeInput::new(older, nothing, low_limit, older.pos_of(input.dict_limit))?;
    sort_dubt1(bt, &older, curr, nb_compares, bt_low, window_low)
}

/// The body of `ZSTD_insertDUBT1`, for a position of `input.near`.
#[inline(always)]
fn sort_dubt1(
    bt: &mut Nodes,
    input: &TreeInput<'_>,
    curr: u32,
    nb_compares: u32,
    bt_low: u32,
    window_low: u32,
) -> Result<()> {
    // The next sorted candidate is in the first slot. The other one has the previous unsorted candidate.
    let [next_sorted, _] = bt_children(bt, curr);
    bt_walk::<{ First::Alike }, { Hints::All }>(
        bt,
        input,
        curr.wrapping_sub(input.dict_limit),
        next_sorted,
        window_low.saturating_add(1),
        nb_compares,
        Descent::down_to(curr, bt_low),
        Older::Called,
        // If they are equal, there is no way to know which is smaller. Dropped, to keep the tree consistent.
        |_, common| Ok(common.match_is_smaller.is_some()),
    )?;
    Ok(())
}

/// What [`Dubt::find_best_match`] returns.
#[derive(Clone, Copy)]
struct DubtFound {
    best_length: u32,
    nb_compares: u32,
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

/// What a match has to be like to be better than what the parser has.
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

/// What [`Near::count_short`] compares at first. From there on, it took more than a glance to find out that a candidate
/// is not long enough.
const LONG_WAY: u32 = 16;

/// The longest match so far for a position, while candidates are compared with it.
struct Longest<'a> {
    /// The current segment, from the lowest index that a match can be at or from its start.
    segment: Near<'a>,
    /// The index of its first byte.
    start_index: u32,
    /// The position that matches are for, in `segment`.
    ip: u32,
    /// A match has to be more than 3 bytes longer than this, unless it is the first and [`LONG_WAY`] bytes.
    tail_start: u32,
    /// `segment` from `tail_start` on.
    tails: Near<'a>,
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
            tails: segment.tail(tail_start)?,
            tail: segment.read32(ip + tail_start)?,
            off_base: best.off_base,
        })
    }

    /// There is a match of `len` bytes.
    #[inline(always)]
    fn offer_match(&mut self, len: u32, off_base: u32) -> Offered {
        if len > self.tail_start + 3 {
            return self.take(len, off_base);
        }
        // Records that differ in one field are the same again after it. If that is where the tail is, it tells none of
        // them from a longer match. Where this one ends does, as in the C code: it is taken, short as it is.
        if len >= LONG_WAY && self.off_base == 0 {
            cold_path();
            return self.take(len, off_base);
        }
        Offered::Considered
    }

    /// From now on, a match has to be longer than `len`.
    #[inline(always)]
    fn take(&mut self, len: u32, off_base: u32) -> Offered {
        self.tail_start = len - 3;
        self.off_base = off_base;
        let (Some(tails), Some(tail)) = (
            self.segment.tail(self.tail_start),
            self.segment.read32(self.ip + self.tail_start),
        ) else {
            return Offered::Longest;
        };
        self.tails = tails;
        self.tail = tail;
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

    /// There may be a match at `match_index`. `IN_TAILS` is which of two ways its tail is read: the one that takes fewer
    /// instructions, or the one that has less to wait for after a match.
    #[inline(always)]
    fn offer<const IN_TAILS: bool>(&mut self, match_index: u32) -> Offered {
        let match_pos = match_index.wrapping_sub(self.start_index);
        let tail = if IN_TAILS {
            self.tails.read32(match_pos)
        } else {
            self.segment
                .read32_at(match_pos as usize + self.tail_start as usize)
        };
        let Some(tail) = tail else {
            return Offered::Outside;
        };
        if tail != self.tail {
            return Offered::Considered;
        }
        let len = self.segment.count_short(self.ip, match_pos);
        self.offer_match(len, offset_to_offbase(self.ip.wrapping_sub(match_pos)))
    }

    /// It may be shorter than what [`Self::new`] was given.
    #[inline(always)]
    const fn best(&self) -> Best {
        Best {
            len: self.tail_start + 3,
            off_base: self.off_base,
        }
    }
}

/// Where the parser is, when it has no match.
#[derive(Clone, Copy)]
struct LiteralRun {
    ip: u32,
    /// Where the literals start.
    anchor: u32,
    /// Positions are searched up to this one, which is not.
    ilimit: u32,
    offset_1: u32,
}

/// Where the parser goes on after [`Finder::skip_literals`].
struct Skipped {
    ip: u32,
    /// The repeat offset is known to give no match at the next position.
    no_repeat: bool,
}

/// `ZSTD_searchMax`, with the state of the search in local variables for as long as a block lasts.
trait Finder<'a>: Sized {
    /// How far from the end of the block the last search is.
    const MARGIN: u32;
    /// After how many bytes the parser stops, for another finder to go on if that is better.
    const TRIAL: Option<u32> = None;

    /// `block` is at least `MARGIN` bytes.
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, block: LazyBlock<'a>) -> Result<Self>;

    /// The longest match for `ip`, the most recent one of that length, if it is as `wanted`. If it is not, `None` or any
    /// match of at least 4 bytes that is not either. Positions are searched in increasing order. While `skipping`, those
    /// in between are not indexed.
    /// `BY_GAIN` is whether `wanted.gain` may be something else than [`Wanted::ANY_GAIN`].
    fn find<const BY_GAIN: bool>(
        &mut self,
        ip: u32,
        wanted: Wanted,
        skipping: bool,
    ) -> Result<Option<Found>>;

    /// Goes past positions where the parser would find nothing, neither with [`Self::find`] nor with the repeat offset
    /// at the next position: goes on from `run.ip`, or from a later position that the parser would come to.
    #[inline(always)]
    fn skip_literals(&mut self, run: LiteralRun) -> Result<Skipped> {
        Ok(Skipped {
            ip: run.ip,
            no_repeat: false,
        })
    }

    /// Every position is indexed again from now on.
    fn stop_skipping(&mut self) -> Result<()>;

    /// The end of the block, or of the trial.
    fn finish(self) -> Result<()>;
}

// ── binary trees, for the parser ──────────────────────────────────────────

/// `FAR` is [`TreeInput::far`].
struct TreeFinder<'a, const DICT_MODE: u8, const FAR: bool>(Dubt<'a>);

impl<'a, const DICT_MODE: u8, const FAR: bool> Finder<'a> for TreeFinder<'a, DICT_MODE, FAR> {
    const MARGIN: u32 = 8;

    #[inline(always)]
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, _block: LazyBlock<'a>) -> Result<Self> {
        let mut dubt = Dubt::new(ms, src, DICT_MODE == DICT_MATCH_STATE)?;
        dubt.input.far = FAR;
        Ok(Self(dubt))
    }

    #[inline(always)]
    fn find<const BY_GAIN: bool>(
        &mut self,
        ip: u32,
        wanted: Wanted,
        _skipping: bool,
    ) -> Result<Option<Found>> {
        let found = if FAR {
            self.0.search_far(ip)?
        } else {
            self.0.search(ip)?
        };
        Ok(Some(found).filter(|found| found.len > wanted.longer_than))
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
    hasher: Hasher,
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
            hasher: Hasher::new(dms.ms.c_params.hash_log, mls),
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
    fn insert(&mut self, hasher: Hasher, bytes: u64, index: u32) {
        let hash = hasher.hash(bytes) & self.hash_table.len().wrapping_sub(1);
        let in_chain = index as usize & self.chain_table.len().wrapping_sub(1);
        if let Some(first) = self.hash_table.get_mut(hash)
            && let Some(next) = self.chain_table.get_mut(in_chain)
        {
            *next = core::mem::replace(first, index);
        }
    }

    /// Adds every position that has 8 bytes in `positions`. The first one has the index `index`.
    #[inline(never)]
    fn insert_all(self, hasher: Hasher, positions: &[u8], index: u32) {
        let (Some(hash_mask), Some(chain_mask)) = (
            self.hash_table.len().checked_sub(1),
            self.chain_table.len().checked_sub(1),
        ) else {
            return;
        };
        for (n, bytes) in positions.array_windows().enumerate() {
            let index = index as usize + n;
            let hash = hasher.hash(u64::from_le_bytes(*bytes));
            if let Some(head) = self.hash_table.get_mut(hash & hash_mask)
                && let Some(next) = self.chain_table.get_mut(index & chain_mask)
            {
                *next = core::mem::replace(head, index as u32);
            }
        }
    }
}

/// Where the search of a position is at.
#[derive(Clone, Copy)]
struct Candidate {
    /// The first candidate that is a match.
    match_index: u32,
    /// How many there may be, with that one.
    nb_attempts: u32,
}

/// `ZSTD_HcFindBestMatch`. `SIMPLE` tells that all along the block, every index from that of the position 0 on is within
/// reach and in the chain table, and none below it is valid.
struct ChainFinder<'a, const DICT_MODE: u8, const SIMPLE: bool> {
    block: LazyBlock<'a>,
    chains: Chains<'a>,
    hasher: Hasher,
    mls: u32,
    nb_attempts: u32,
    /// `ms.next_to_update`, as a position.
    next_to_update: u32,
    /// The hash of `next_to_update`, if it was searched. Else it is out of the hash table.
    next_hash: usize,
    /// What the hash table had for it, and still has.
    next_head: u32,
    /// The index from which every position is in the chains, up to `next_to_update`.
    dense_from: u32,
    /// Where the search of `next_to_update` is at, if [`Finder::skip_literals`] started it.
    started: Option<Candidate>,
    ms_next_to_update: &'a mut u32,
    dms: Option<ChainDict<'a>>,
}

/// Whether [`ChainFinder`] can be `SIMPLE`.
fn chains_are_simple(ms: &MatchState, block: &LazyBlock<'_>) -> bool {
    let reach = block.reach.max_distance.min(ms.chain_table.len() as u32);
    block.reach.lowest_valid == block.base_index && block.near.len() <= reach
}

impl<const DICT_MODE: u8, const SIMPLE: bool> ChainFinder<'_, DICT_MODE, SIMPLE> {
    /// `ZSTD_insertAndFindFirstIndex_internal`: returns the index of the first candidate for `ip`.
    #[inline(always)]
    fn insert_and_find_first_index(&mut self, ip: u32, skipping: bool) -> Result<u32> {
        let near = self.block.near;
        let first = self.next_to_update;
        if first < ip {
            let index = self.block.base_index.wrapping_add(first);
            if let Some(head) = self.chains.hash_table.get_mut(self.next_hash) {
                *head = index;
                table_put(self.chains.chain_table, index as usize, self.next_head);
            } else {
                let bytes = near.read64(first).ok_or(BUG)?;
                self.chains.insert(self.hasher, bytes, index);
            }
            if skipping {
                // Not every position is inserted.
                self.dense_from = self.block.base_index.wrapping_add(ip);
            } else if first + 1 < ip {
                let positions = near.bytes().sub(first as usize + 1..ip as usize + 7)?;
                let chains = Chains {
                    hash_table: self.chains.hash_table,
                    chain_table: self.chains.chain_table,
                };
                chains.insert_all(self.hasher, positions, index.wrapping_add(1));
            }
        }
        self.next_to_update = ip;
        let hash = self.hasher.hash(near.read64(ip).ok_or(BUG)?);
        let hash = hash & self.chains.hash_table.len().wrapping_sub(1);
        let head = self.chains.hash_table.get(hash).copied().unwrap_or(0);
        self.next_hash = hash;
        self.next_head = head;
        Ok(head)
    }
}

impl<'a, const DICT_MODE: u8, const SIMPLE: bool> Finder<'a>
    for ChainFinder<'a, DICT_MODE, SIMPLE>
{
    const MARGIN: u32 = 8;

    #[inline(always)]
    fn new(ms: &'a mut MatchState, src: &'a BlockSrc<'a>, block: LazyBlock<'a>) -> Result<Self> {
        let mls = ms.c_params.min_match.clamp(4, 6);
        Ok(Self {
            started: None,
            block,
            chains: Chains {
                hash_table: &mut ms.hash_table,
                chain_table: &mut ms.chain_table,
            },
            hasher: Hasher::new(ms.c_params.hash_log, mls),
            mls,
            nb_attempts: 1 << ms.c_params.search_log,
            next_to_update: ms.next_to_update.wrapping_sub(block.base_index),
            next_hash: usize::MAX,
            next_head: 0,
            dense_from: ms.next_to_update,
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
        let low_limit = if SIMPLE {
            block.base_index
        } else {
            block.reach.low_limit(curr)
        };
        let min_chain = curr.saturating_sub(self.chains.chain_table.len() as u32);
        let mut nb_attempts = self.nb_attempts;
        let mut match_index;
        if let Some(started) = self.started.take() {
            match_index = started.match_index;
            nb_attempts = started.nb_attempts;
        } else {
            match_index = self.insert_and_find_first_index(ip, skipping)?;
            if DICT_MODE == NO_DICT && match_index < low_limit {
                return Ok(None);
            }
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
        // A match that long has a position in the chains for each of its bytes, but the last ones.
        if BY_GAIN
            && DICT_MODE == NO_DICT
            && best.len > 3
            && low_limit >= self.dense_from
            && let Some(end) = (best.len + 1).checked_sub(self.mls)
            && let Some(bytes) = block.near.read64(ip + end)
            && table_get(self.chains.hash_table, self.hasher.hash(bytes)) < low_limit
        {
            return Ok(None);
        }
        let Some(mut longest) = Longest::new(segment, start_index, curr, best) else {
            return Ok(None);
        };
        while nb_attempts > 0 {
            let mut offered = longest.offer::<true>(match_index);
            if offered == Offered::Outside {
                if DICT_MODE != EXT_DICT || match_index < low_limit {
                    break;
                }
                let match_pos = (match_index - block.dict.start_index) as usize;
                offered = longest.offer_in_dict(&block, ip, match_pos)?;
            }
            if offered == Offered::Longest || (!SIMPLE && match_index <= min_chain) {
                break;
            }
            match_index = table_get(self.chains.chain_table, match_index as usize);
            nb_attempts -= 1;
        }

        if DICT_MODE == DICT_MATCH_STATE {
            let dms = self.dms.ok_or(BUG)?;
            let hash = dms.hasher.hash(block.near.read64(ip).ok_or(BUG)?);
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
    fn skip_literals(&mut self, run: LiteralRun) -> Result<Skipped> {
        let near = self.block.near;
        let mut ip = run.ip;
        let no_repeat = false;
        if !SIMPLE {
            return Ok(Skipped { ip, no_repeat });
        }
        while ip < run.ilimit {
            let step = (ip - run.anchor) >> K_SEARCH_STRENGTH;
            let bytes = near.read64(ip).ok_or(BUG)?;
            if step + 1 > K_LAZY_SKIPPING_STEP
                || (run.offset_1 > 0
                    && near.read32((ip + 1).wrapping_sub(run.offset_1))
                        == Some((bytes >> 8) as u32))
            {
                break;
            }

            let mut match_index = self.insert_and_find_first_index(ip, false)?;
            let mut nb_attempts = self.nb_attempts;
            while let Some(match_bytes) =
                near.read32(match_index.wrapping_sub(self.block.base_index))
            {
                if match_bytes == bytes as u32 {
                    self.started = Some(Candidate {
                        match_index,
                        nb_attempts,
                    });
                    return Ok(Skipped {
                        ip,
                        no_repeat: true,
                    });
                }
                nb_attempts -= 1;
                if nb_attempts == 0 {
                    break;
                }
                match_index = table_get(self.chains.chain_table, match_index as usize);
            }
            ip += step + 1;
        }
        Ok(Skipped { ip, no_repeat })
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
/// After how many bytes the parser stops for [`SecondTagStats::record_trial`].
const SECOND_TAG_TRIAL: u32 = 1 << 13;

/// How the tag table is laid out at the start of a frame of `src_size` bytes, if that is known.
pub(crate) const fn row_tags_at_start(
    c_params: &CompressionParameters,
    src_size: Option<u64>,
) -> RowTags {
    // In shorter rows the candidates are few, and the second tags cost more than they save. As does the memory for
    // them, for a short input.
    match src_size {
        Some(src_size) if c_params.search_log >= 6 && src_size >> c_params.hash_log != 0 => {
            RowTags::Second(SecondTagStats::AT_START)
        }
        _ => RowTags::Flat,
    }
}

impl SecondTagStats {
    const AT_START: Self = Self {
        nb_new_positions: 0,
        nb_positions: 0,
        nb_ruled_out: 0,
    };

    /// The second tags have ruled out `nb_ruled_out` more candidates while `nb_positions` more were inserted. Returns
    /// whether to keep them.
    fn record_trial(&mut self, nb_positions: u32, nb_ruled_out: u32) -> bool {
        self.nb_new_positions += nb_positions;
        self.nb_positions += u64::from(nb_positions);
        self.nb_ruled_out += u64::from(nb_ruled_out);
        // Where few positions are inserted, they cost little, and it takes some to tell.
        if self.nb_new_positions < SECOND_TAG_TRIAL / 2 {
            return true;
        }
        self.nb_new_positions = 0;
        // Below that, they cost more than they save. There is no way back, and less to rule out while the rows fill up:
        // at first they are only given up where there is next to nothing.
        if self.nb_positions < ZSTD_BLOCKSIZE_MAX as u64 {
            2 * self.nb_ruled_out >= self.nb_positions
        } else {
            2 * self.nb_ruled_out >= 5 * self.nb_positions
        }
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
    if ROW_ENTRIES == 64 {
        // The C code leaves this half out.
        prefetch_l1(indices, start + 32);
        prefetch_l1(indices, start + 48);
    }
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
fn tags_match_mask(tags: &[u8; 16], tag: u8) -> u16 {
    let mut matches = 0;
    for (n, &entry) in tags.iter().enumerate() {
        matches |= u16::from(entry == tag) << n;
    }
    matches
}

/// Bit `n` is set if the entry `n` has the tag `tag`. As `a | b << 16 | ..`, LTO makes 10 times the instructions of it.
#[inline(always)]
fn row_tags_match_mask<const ROW_ENTRIES: usize>(tags: &[u8; ROW_ENTRIES], tag: u8) -> u64 {
    const { assert!(matches!(ROW_ENTRIES, 16 | 32 | 64)) }
    let (chunks, _) = tags.as_chunks::<16>();
    chunks.iter().rev().fold(0, |matches, tags| {
        matches << 16 | u64::from(tags_match_mask(tags, tag))
    })
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

/// [`row_get_match_mask`]. Inlined, levels 11 and 12 take a tenth longer for text.
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

    /// The entries of the row for `hash` that have its tag.
    #[inline(always)]
    fn candidates<const ROW_ENTRIES: usize>(
        &self,
        hash: u32,
    ) -> Option<RowCandidates<'a, ROW_ENTRIES>> {
        let start = rel_row::<ROW_ENTRIES>(hash);
        let tags = self.tags.get(start..start + ROW_ENTRIES)?;
        let tags = tags.first_chunk::<ROW_ENTRIES>()?;
        let indices = self.indices.get(start..start + ROW_ENTRIES)?;
        RowCandidates::new(indices.first_chunk()?, tags, hash as u8)
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
    /// How many positions were inserted, if there are second tags.
    nb_inserted: u32,
}

/// The hash of the position at `index`, from the caches of [`RowIndex`], where `new_hash` takes its place: the hash of the
/// position 8 bytes further.
#[inline(always)]
fn replace_cached_hash<const SECOND_TAGS: bool>(
    hash_cache: &mut [u32; ZSTD_ROW_HASH_CACHE_SIZE],
    second_tag_cache: &mut [u8; ZSTD_ROW_HASH_CACHE_SIZE],
    index: u32,
    new_hash: RowHash,
) -> RowHash {
    let cached = (index & ZSTD_ROW_HASH_CACHE_MASK) as usize;
    let (Some(hash), Some(second_tag)) =
        (hash_cache.get_mut(cached), second_tag_cache.get_mut(cached))
    else {
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

impl RowIndex<'_> {
    /// `ZSTD_row_nextCachedHash`: [`replace_cached_hash`] for `pos`, and a prefetch of the row for `new_hash`.
    #[inline(always)]
    fn next_cached_hash<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(
        &mut self,
        pos: u32,
        new_hash: RowHash,
    ) -> RowHash {
        self.rows
            .prefetch::<ROW_ENTRIES, SECOND_TAGS>(new_hash.hash);
        replace_cached_hash::<SECOND_TAGS>(
            &mut self.hash_cache,
            &mut self.second_tag_cache,
            self.base_index.wrapping_add(pos),
            new_hash,
        )
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

    /// `ZSTD_row_update_internalImpl`: inserts the positions from `next_to_update` up to `end`. `COPIES` is for the
    /// largest functions, where the loop would read the fields again after every write to the tables. In the others it
    /// does not, and with copies, 4 MB of base64 take 3% longer at level 11.
    #[inline(always)]
    fn insert_up_to<const ROW_ENTRIES: usize, const SECOND_TAGS: bool, const COPIES: bool>(
        &mut self,
        end: u32,
    ) -> Option<()> {
        let bytes = self.near.bytes();
        if end as usize + 2 * ZSTD_ROW_HASH_CACHE_SIZE > bytes.len() {
            return None;
        }
        if COPIES {
            let (hasher, base_index) = (self.hasher, self.base_index);
            let mut rows = Rows {
                indices: &mut *self.rows.indices,
                tags: &mut *self.rows.tags,
            };
            for pos in self.next_to_update..end {
                let ahead = pos as usize + ZSTD_ROW_HASH_CACHE_SIZE;
                let ahead = bytes.get(ahead..ahead + 8)?.first_chunk()?;
                let new_hash = hasher.of::<SECOND_TAGS>(u64::from_le_bytes(*ahead));
                rows.prefetch::<ROW_ENTRIES, SECOND_TAGS>(new_hash.hash);
                let index = base_index.wrapping_add(pos);
                let hash = replace_cached_hash::<SECOND_TAGS>(
                    &mut self.hash_cache,
                    &mut self.second_tag_cache,
                    index,
                    new_hash,
                );
                rows.row::<ROW_ENTRIES, SECOND_TAGS>(hash.hash)?
                    .insert(hash, index);
            }
        } else {
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
        }
        if SECOND_TAGS {
            self.nb_inserted += end.saturating_sub(self.next_to_update);
        }
        self.next_to_update = end;
        Some(())
    }

    /// `ZSTD_row_update_internal`: inserts the positions from `next_to_update` up to `ip`, but not all of them if they
    /// are many. See [`Self::insert_up_to`] for `COPIES`.
    #[inline(always)]
    fn update<const ROW_ENTRIES: usize, const SECOND_TAGS: bool, const COPIES: bool>(
        &mut self,
        ip: u32,
    ) -> Option<()> {
        const K_SKIP_THRESHOLD: u32 = 384;

        if ip.wrapping_sub(self.next_to_update) > K_SKIP_THRESHOLD {
            self.skip::<ROW_ENTRIES, SECOND_TAGS>(ip)?;
        }
        self.insert_up_to::<ROW_ENTRIES, SECOND_TAGS, COPIES>(ip)
    }

    /// The part of `ZSTD_row_update_internal` for a long way up to `ip`.
    #[cold]
    #[inline(never)]
    fn skip<const ROW_ENTRIES: usize, const SECOND_TAGS: bool>(&mut self, ip: u32) -> Option<()> {
        const K_MAX_MATCH_START_POSITIONS_TO_UPDATE: u32 = 96;
        const K_MAX_MATCH_END_POSITIONS_TO_UPDATE: u32 = 32;

        let end = self.next_to_update + K_MAX_MATCH_START_POSITIONS_TO_UPDATE;
        self.insert_up_to::<ROW_ENTRIES, SECOND_TAGS, false>(end)?;
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

impl<'a, const ROW_ENTRIES: usize> RowCandidates<'a, ROW_ENTRIES> {
    /// The entries of a row that have the tag `tag`.
    #[inline(always)]
    fn new(indices: &'a [u32; ROW_ENTRIES], tags: &[u8; ROW_ENTRIES], tag: u8) -> Option<Self> {
        let head = u32::from(*tags.first()?) & (ROW_ENTRIES as u32 - 1);
        let matches = row_get_match_mask(tags, tag, head);
        Some(Self {
            indices,
            head,
            matches: matches & row_entries_mask::<ROW_ENTRIES>(head),
        })
    }

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
                let mut offered = longest.offer::<BY_GAIN>(match_index);
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
                let in_dict = self.dms?.candidates::<ROW_ENTRIES>(dict_hash)?;
                self.longest_dict_match(in_dict, ip, nb_attempts, &mut longest)?;
            }
            let best = longest.best();
            if all || best.len >= SECOND_TAG_LENGTH || floor.len + 1 >= SECOND_TAG_LENGTH {
                return best.found();
            }
            // The second tags were the same for no reason.
            candidates.matches = matches;
        }
    }

    /// [`Self::longest_match`] where the row has no candidate, and that of the dictionary has `in_dict`.
    #[inline(always)]
    fn longest_match_in_dict_alone<const ROW_ENTRIES: usize, const BY_GAIN: bool>(
        &self,
        in_dict: RowCandidates<'_, ROW_ENTRIES>,
        ip: u32,
        wanted: Wanted,
    ) -> Option<Found> {
        let block = &self.block;
        let curr = block.base_index.wrapping_add(ip);
        let low_limit = block.reach.low_limit(curr);
        let segment = block.near.tail(low_limit.wrapping_sub(block.base_index))?;
        let floor = Best {
            len: wanted.floor::<BY_GAIN>(curr, low_limit),
            off_base: 0,
        };
        let mut longest = Longest::new(segment, low_limit, curr, floor)?;
        self.longest_dict_match(in_dict, ip, self.nb_attempts, &mut longest)?;
        longest.best().found()
    }

    /// The part of `ZSTD_RowFindBestMatch` that searches the dictionary.
    #[inline(always)]
    fn longest_dict_match<const ROW_ENTRIES: usize>(
        &self,
        mut candidates: RowCandidates<'_, ROW_ENTRIES>,
        ip: u32,
        mut nb_attempts: u32,
        longest: &mut Longest<'_>,
    ) -> Option<()> {
        let block = &self.block;
        let dms = self.dms?;
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
                nb_inserted: 0,
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

    /// The end of a block, or of a trial of the second tags.
    fn finish(self) -> Result<()> {
        let Self {
            index,
            search,
            hash_salt_entropy,
            saved,
        } = self;
        *saved.next_to_update = index.base_index.wrapping_add(index.next_to_update);
        *saved.hash_salt_entropy = hash_salt_entropy;
        if let RowTags::Second(stats) = saved.tags
            && !stats.record_trial(index.nb_inserted, search.nb_ruled_out)
        {
            row_flatten_tags(saved.tags, index.rows.tags)?;
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
    const TRIAL: Option<u32> = if SECOND_TAGS {
        Some(SECOND_TAG_TRIAL)
    } else {
        None
    };

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
                if DICT_MODE == DICT_MATCH_STATE {
                    index
                        .update::<ROW_ENTRIES, SECOND_TAGS, true>(ip)
                        .ok_or(BUG)?;
                } else {
                    index
                        .update::<ROW_ENTRIES, SECOND_TAGS, false>(ip)
                        .ok_or(BUG)?;
                }
            }
            let ahead = index.near.read64(ip + ZSTD_ROW_HASH_CACHE_SIZE as u32);
            let new_hash = index.hasher.of::<SECOND_TAGS>(ahead.ok_or(BUG)?);
            index.next_cached_hash::<ROW_ENTRIES, SECOND_TAGS>(ip, new_hash)
        };
        *hash_salt_entropy = hash_salt_entropy.wrapping_add(hash.hash);
        index.next_to_update = ip + 1;
        if SECOND_TAGS {
            index.nb_inserted += 1;
        }

        let mut row = index
            .rows
            .row::<ROW_ENTRIES, SECOND_TAGS>(hash.hash)
            .ok_or(BUG)?;
        let candidates = RowCandidates::new(row.indices, row.tags, hash.hash as u8).ok_or(BUG)?;
        let RowCandidates { head, matches, .. } = candidates;
        let curr = index.base_index.wrapping_add(ip);
        if matches == 0 {
            if DICT_MODE == DICT_MATCH_STATE {
                let dms = search.dms.ok_or(BUG)?;
                let in_dict = dms.candidates::<ROW_ENTRIES>(dict_hash).ok_or(BUG)?;
                if in_dict.matches != 0 {
                    let found = search
                        .longest_match_in_dict_alone::<ROW_ENTRIES, BY_GAIN>(in_dict, ip, wanted);
                    row.insert(hash, curr);
                    return Ok(found);
                }
            }
            row.insert(hash, curr);
            return Ok(None);
        }
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
#[derive(Clone, Copy)]
struct Offsets {
    offset_1: u32,
    offset_2: u32,
    /// What they were, for those that are too far to be of use and are 0.
    saved_1: u32,
    saved_2: u32,
}

/// Where the parser starts in a block, or goes on, and with what.
#[derive(Clone, Copy)]
struct Start {
    ip: u32,
    anchor: u32,
    skipping: bool,
    offsets: Offsets,
}

/// How far the parser got.
enum Parsed {
    /// To the end of the block, the last literals of which are this many.
    Block(usize),
    /// To the end of [`Finder::TRIAL`].
    Trial(Start),
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
        Self {
            ip,
            anchor: block.istart,
            skipping: false,
            offsets,
        }
    }
}

/// `ZSTD_compressBlock_lazy_generic` and `ZSTD_compressBlock_lazy_extDict_generic`. `depth` is how many positions
/// further a better match is looked for, once there is one, and `LAZY` whether that is any. From `args.start` up to the end
/// of the block, or of [`Finder::TRIAL`].
#[inline(never)]
fn compress_block_lazy_part<'a, F: Finder<'a>, const LAZY: bool, const DICT_MODE: u8>(
    args: LazyArgs<'a>,
    depth: u32,
) -> Result<Parsed> {
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
        return Ok(Parsed::Block((near.len() - start.anchor) as usize));
    };
    let mut finder = F::new(ms, src, *block)?;
    let mut seq_store = SeqSink::<16, true>::new(seq_store);
    let mut ip = start.ip;
    let mut anchor = start.anchor;
    let stop = match F::TRIAL {
        Some(trial) => ilimit.min(ip + trial),
        None => ilimit,
    };
    let Offsets {
        mut offset_1,
        mut offset_2,
        saved_1,
        mut saved_2,
    } = start.offsets;
    let mut skipping = start.skipping;

    'parse: while ip < stop {
        let mut no_repeat = false;
        if !skipping {
            let skipped = finder.skip_literals(LiteralRun {
                ip,
                anchor,
                ilimit,
                offset_1,
            })?;
            ip = skipped.ip;
            no_repeat = skipped.no_repeat;
            if ip >= ilimit {
                break;
            }
        }

        // Check the repeat offset.
        let mut best = Found::repeat(if !LAZY && no_repeat {
            0
        } else {
            rep_length::<DICT_MODE>(block, ip + 1, offset_1)?
        });
        let mut start = ip + 1;

        if LAZY || best.len == 0 {
            // How many positions were searched since the last match that was taken, that one included.
            let mut since_best = 0;
            let mut wanted = Wanted {
                longer_than: best.len.max(3),
                gain: Wanted::ANY_GAIN,
            };

            loop {
                since_best += 1;
                let found = if LAZY {
                    finder.find::<true>(ip, wanted, skipping)?
                } else {
                    finder.find::<false>(ip, wanted, skipping)?
                };
                // At first any gain will do, that of a match that is not wanted too: one that is no longer than the repeat
                // at the next position. It loses to that repeat at the next step.
                if let Some(found) = found
                    && (!LAZY || found.gain() > wanted.gain)
                {
                    debug_assert!(
                        found.len > wanted.longer_than || (LAZY && depth > 0 && ip < ilimit)
                    );
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
                if !LAZY || since_best > depth || ip >= ilimit {
                    break;
                }
                ip += 1;
                let rep_len = rep_length::<DICT_MODE>(block, ip, offset_1)?;
                if rep_len >= 4 {
                    let weight = 2 + since_best;
                    let gain2 = (rep_len * weight) as i32;
                    let gain1 = (best.len * weight) as i32 - best.cost() + 1;
                    if gain2 > gain1 {
                        best = Found::repeat(rep_len);
                        start = ip;
                    }
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
    if F::TRIAL.is_some() && ip < ilimit {
        return Ok(Parsed::Trial(Start {
            ip,
            anchor,
            skipping,
            offsets: Offsets {
                offset_1,
                offset_2,
                saved_1,
                saved_2,
            },
        }));
    }

    // If `offset_1` was not valid at first and now is, what it was becomes the second repeat offset.
    if saved_1 != 0 && offset_1 != 0 {
        saved_2 = saved_1;
    }

    // Save the repeat offsets for the next block.
    let [rep_0, rep_1, _] = rep;
    *rep_0 = if offset_1 != 0 { offset_1 } else { saved_1 };
    *rep_1 = if offset_2 != 0 { offset_2 } else { saved_2 };

    Ok(Parsed::Block((near.len() - anchor) as usize))
}

/// [`compress_block_lazy_part`] with a finder that is not on trial. Returns the size of the last literals.
#[inline(always)]
fn compress_block_lazy_generic<'a, F: Finder<'a>, const LAZY: bool, const DICT_MODE: u8>(
    args: LazyArgs<'a>,
    depth: u32,
) -> Result<usize> {
    const { assert!(F::TRIAL.is_none()) };
    match compress_block_lazy_part::<F, LAZY, DICT_MODE>(args, depth)? {
        Parsed::Block(last_literals) => Ok(last_literals),
        Parsed::Trial(_) => Err(BUG),
    }
}

/// What [`compress_block_lazy_part`] works on.
struct LazyArgs<'a> {
    ms: &'a mut MatchState,
    seq_store: &'a mut SeqStore,
    rep: &'a mut [u32; ZSTD_REP_NUM],
    src: &'a BlockSrc<'a>,
    block: LazyBlock<'a>,
    start: Start,
}

impl LazyArgs<'_> {
    fn reborrow(&mut self) -> LazyArgs<'_> {
        LazyArgs {
            ms: self.ms,
            seq_store: self.seq_store,
            rep: self.rep,
            src: self.src,
            block: self.block,
            start: self.start,
        }
    }
}

/// [`compress_block_lazy_generic`], with the hash chains or the rows.
#[inline(always)]
fn compress_block_lazy_hashed<const LAZY: bool, const DICT_MODE: u8>(
    mut args: LazyArgs<'_>,
    depth: u32,
    use_row: bool,
) -> Result<usize> {
    if !use_row {
        if DICT_MODE == NO_DICT && chains_are_simple(args.ms, &args.block) {
            return compress_block_lazy_generic::<ChainFinder<NO_DICT, true>, LAZY, NO_DICT>(
                args, depth,
            );
        }
        return compress_block_lazy_generic::<ChainFinder<DICT_MODE, false>, LAZY, DICT_MODE>(
            args, depth,
        );
    }
    // With a dictionary, the second tags are given up: how many candidates there are matters if it is searched next.
    if DICT_MODE != NO_DICT {
        row_flatten_tags(&mut args.ms.row_tags, &mut args.ms.tag_table)?;
    }
    match args.ms.c_params.search_log.clamp(4, 6) {
        4 => compress_block_lazy_generic::<RowFinder<16, false, DICT_MODE>, LAZY, DICT_MODE>(
            args, depth,
        ),
        5 => compress_block_lazy_generic::<RowFinder<32, false, DICT_MODE>, LAZY, DICT_MODE>(
            args, depth,
        ),
        _ => {
            while DICT_MODE == NO_DICT && args.ms.row_tags != RowTags::Flat {
                let part = args.reborrow();
                match compress_block_lazy_part::<RowFinder<64, true, NO_DICT>, LAZY, NO_DICT>(
                    part, depth,
                )? {
                    Parsed::Block(last_literals) => return Ok(last_literals),
                    Parsed::Trial(start) => args.start = start,
                }
            }
            compress_block_lazy_generic::<RowFinder<64, false, DICT_MODE>, LAZY, DICT_MODE>(
                args, depth,
            )
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
        Strategy::Greedy => compress_block_lazy_hashed::<false, DICT_MODE>(args, 0, use_row),
        Strategy::Lazy => compress_block_lazy_hashed::<true, DICT_MODE>(args, 1, use_row),
        Strategy::Lazy2 => compress_block_lazy_hashed::<true, DICT_MODE>(args, 2, use_row),
        // In the first block, the hints take more time than they save.
        Strategy::BtLazy2 if !use_row && args.block.near.len() > ZSTD_BLOCKSIZE_MAX as u32 => {
            compress_block_lazy_generic::<TreeFinder<DICT_MODE, true>, true, DICT_MODE>(args, 2)
        }
        Strategy::BtLazy2 if !use_row => {
            compress_block_lazy_generic::<TreeFinder<DICT_MODE, false>, true, DICT_MODE>(args, 2)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_tags_are_kept_for_as_long_as_they_rule_out_enough() {
        const TRIAL: u32 = SECOND_TAG_TRIAL;
        const TRIALS_IN_A_BLOCK: usize = ZSTD_BLOCKSIZE_MAX / TRIAL as usize;
        // How many of `trials`, of so many positions and candidates that were ruled out, they get through.
        let nb_kept = |trials: &[(u32, u32)]| {
            let mut stats = SecondTagStats::AT_START;
            trials
                .iter()
                .take_while(|&&(nb_positions, nb_ruled_out)| {
                    stats.record_trial(nb_positions, nb_ruled_out)
                })
                .count()
        };
        let (none, little, some, a_lot) = (
            (TRIAL, 0),
            (TRIAL, TRIAL / 2),
            (TRIAL, TRIAL),
            (TRIAL, 4 * TRIAL),
        );

        assert_eq!(nb_kept(&[none]), 0);
        assert_eq!(nb_kept(&[(TRIAL, TRIAL / 2 - 1)]), 0);
        assert_eq!(nb_kept(&[little, none]), 1);
        // What came before makes up for a stretch with little.
        assert_eq!(nb_kept(&[some, none, a_lot, none, none, none, none]), 7);
        assert_eq!(nb_kept(&[some, none, none]), 2);
        // More is asked for once the rows had the time to fill up.
        assert_eq!(
            nb_kept(&[some; 2 * TRIALS_IN_A_BLOCK]),
            TRIALS_IN_A_BLOCK - 1
        );
        assert_eq!(
            nb_kept(&[a_lot; 2 * TRIALS_IN_A_BLOCK]),
            2 * TRIALS_IN_A_BLOCK
        );
        // It takes some positions to tell.
        let few = (TRIAL / 4, 0);
        assert_eq!(nb_kept(&[few, few]), 1);
        assert_eq!(nb_kept(&[few, (TRIAL / 4, TRIAL), few]), 3);
    }

    #[test]
    fn positions_are_inserted_in_the_rows_the_same_with_copies_of_the_fields() -> Result<()> {
        type Inserted = (Vec<u32>, Vec<u8>, [u32; 8], [u8; 8], u32, u32);
        fn inserted<const ROW_ENTRIES: usize, const SECOND_TAGS: bool, const COPIES: bool>(
            bytes: &[u8],
        ) -> Result<Inserted> {
            const ROW_HASH_LOG: u32 = 4;
            let mut indices = vec![0; ROW_ENTRIES << ROW_HASH_LOG];
            let mut tags = vec![0; 2 * indices.len()];
            let hash_bits = ROW_HASH_LOG + ZSTD_ROW_HASH_TAG_BITS;
            let mut index = RowIndex {
                rows: Rows {
                    indices: &mut indices,
                    tags: &mut tags,
                },
                hash_cache: [0; ZSTD_ROW_HASH_CACHE_SIZE],
                second_tag_cache: [0; ZSTD_ROW_HASH_CACHE_SIZE],
                hasher: RowHasher(Hash8::new(4, hash_bits, 7)),
                near: Near::new(bytes)?,
                base_index: 1_003,
                next_to_update: 2,
                nb_inserted: 0,
            };
            index
                .fill_hash_cache::<ROW_ENTRIES, SECOND_TAGS>(400)
                .ok_or(BUG)?;
            for end in [3, 60, 60, 400] {
                index
                    .insert_up_to::<ROW_ENTRIES, SECOND_TAGS, COPIES>(end)
                    .ok_or(BUG)?;
            }
            let (hashes, second_tags) = (index.hash_cache, index.second_tag_cache);
            let (next, nb_inserted) = (index.next_to_update, index.nb_inserted);
            Ok((indices, tags, hashes, second_tags, next, nb_inserted))
        }

        let mut x = 9_u32;
        let bytes: Vec<u8> = core::iter::repeat_with(|| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x >> 30) as u8
        })
        .take(500)
        .collect();
        let with_copies = inserted::<16, false, true>(&bytes)?;
        assert_eq!(with_copies.4, 400);
        assert!(with_copies.0.contains(&(1_003 + 399)));
        assert_eq!(with_copies, inserted::<16, false, false>(&bytes)?);
        assert_eq!(
            inserted::<32, false, true>(&bytes)?,
            inserted::<32, false, false>(&bytes)?
        );
        assert_eq!(
            inserted::<64, false, true>(&bytes)?,
            inserted::<64, false, false>(&bytes)?
        );
        assert_eq!(
            inserted::<64, true, true>(&bytes)?,
            inserted::<64, true, false>(&bytes)?
        );
        Ok(())
    }

    #[test]
    fn many_positions_are_added_to_the_trees_as_one_by_one() -> Result<()> {
        const DICT_LIMIT: u32 = 2;
        const HASH_LOG: u32 = 6;
        let bytes: Vec<u8> = (0..300u32).map(|n| (n * n % 7) as u8).collect();
        let near = Near::new(&bytes)?;
        for min_match in [4, 5] {
            let hasher = Hasher::new(HASH_LOG, min_match);
            // They go around the table more than once, or stop at its end, or short of it.
            for indices in [5..280, 40..64, 70..90] {
                let (mut hash_table, mut chain_table) = ([1; 1 << HASH_LOG], [9; 64]);
                let (mut expected_hash_table, mut expected_chain_table) = (hash_table, chain_table);
                for idx in indices.clone() {
                    let h = hasher.hash(near.read64(idx - DICT_LIMIT).ok_or(BUG)?);
                    let children = [table_get(&expected_hash_table, h), ZSTD_DUBT_UNSORTED_MARK];
                    bt_set_children(bt_nodes(&mut expected_chain_table), idx, children);
                    table_put(&mut expected_hash_table, h, idx);
                }

                let bt = bt_nodes(&mut chain_table);
                update_many(&mut hash_table, bt, near, hasher, indices, DICT_LIMIT)?;
                assert_eq!(hash_table, expected_hash_table);
                assert_eq!(chain_table, expected_chain_table);
            }
        }
        Ok(())
    }

    #[test]
    fn a_long_candidate_that_falls_short_is_what_the_next_ones_have_to_beat() -> Result<()> {
        const RECORD: u32 = 200;
        let best = |longest: &Longest<'_>| (longest.best().len, longest.best().off_base);

        for field in [LONG_WAY - 1, LONG_WAY, 100] {
            let mut bytes: Vec<u8> = (0..5 * RECORD).map(|n| (n % RECORD) as u8).collect();
            for (record, value) in (0..).zip([250, 251, 252, 250, 253]) {
                *bytes.at_mut((record * RECORD + field) as usize)? = value;
            }
            // The tail is after the field, where all records are the same.
            let floor = Best {
                len: field + 50,
                off_base: 0,
            };
            let mut longest = Longest::new(Near::new(&bytes)?, 0, 3 * RECORD, floor).ok_or(BUG)?;
            let up_to_the_field = if field >= LONG_WAY {
                (field, offset_to_offbase(RECORD))
            } else {
                (floor.len, 0)
            };
            for record in [2, 1] {
                assert!(longest.offer::<true>(record * RECORD) == Offered::Considered);
                assert_eq!(best(&longest), up_to_the_field);
            }
            if field > LONG_WAY {
                assert!(longest.offer_match(field - 1, 1) == Offered::Considered);
                assert_eq!(best(&longest), up_to_the_field);
            }

            let past_the_field = (RECORD + field, offset_to_offbase(3 * RECORD));
            assert!(longest.offer::<true>(0) == Offered::Considered);
            assert_eq!(best(&longest), past_the_field);
            assert!(longest.offer_match(RECORD, 1) == Offered::Considered);
            assert_eq!(best(&longest), past_the_field);
        }
        Ok(())
    }
}
