//! Hash tables of the input seen so far, in which backward references are looked up.

mod bucket_table;
mod composite;
mod forgetful_chain;
mod longest_match;
mod longest_match_quickly;
mod longest_match_tagged;
mod rolling;
mod to_binary_tree;

use self::composite::HashComposite;
use self::forgetful_chain::HashForgetfulChain;
use self::longest_match::HashLongestMatch;
use self::longest_match_quickly::HashLongestMatchQuickly;
use self::longest_match_tagged::{DenseBuckets, HashLongestMatchTagged, SparseBuckets};
use self::rolling::HashRolling;
use self::to_binary_tree::HashToBinaryTree;
use super::compound_dictionary::{
    CompoundDictionary, EMPTY_BUCKET, LAST_ITEM_FLAG, PreparedDictionary, bucket_index,
};
use super::dictionary_hash::DictionaryHash;
use super::fast_log::log2_floor_nonzero;
use super::find_match_length::find_match_length_with_limit;
use super::params::{EncoderParams, HasherType};
use super::{EncoderError, Fallible};
use crate::common::dictionary::{DATA, OFFSETS_BY_LENGTH, SIZE_BITS_BY_LENGTH};
use crate::common::transform::CUT_OFF_TRANSFORMS;
use crate::util::{Bug, Checked, SliceExt, load_u32_le, load_u64_le};
use bun_core::AllocError;

/// Odd, so that the highest bit is not lost, without long runs of ones or zeros, and tuned against benchmarks.
pub(crate) const HASH_MUL_32: u32 = 0x1E35_A7BD;
const HASH_MUL_64: u64 = 0x1FE3_5A7B_D357_9BD3;

/// A hash of `bits` bits. The high bits of a product are the best mixed, so those are what every hash here takes.
#[inline(always)]
pub(crate) fn hash_u32(bytes: u32, bits: u32) -> usize {
    (bytes.wrapping_mul(HASH_MUL_32) >> (32 - bits)) as usize
}

/// A hash of `bits` bits of the low `len` bytes of `bytes`.
#[inline(always)]
fn hash_low_bytes(bytes: u64, len: u32, bits: u32) -> usize {
    (bytes.wrapping_mul(HASH_MUL_64 << (64 - 8 * len)) >> (64 - bits)) as usize
}

#[derive(Clone, Copy)]
pub(crate) struct HasherSearchResult {
    pub(crate) len: usize,
    pub(crate) distance: usize,
    pub(crate) score: usize,
    /// The length that is encoded less `len`.
    pub(crate) len_code_delta: i32,
}

/// Fills in the distances near the last one (from index 4 on) and near the one before it (from index 10 on).
#[inline(always)]
fn prepare_distance_cache(distance_cache: &mut [i32; 16], num_distances: usize) {
    if num_distances > 4 {
        let last_distance = distance_cache[0];
        distance_cache[4] = last_distance.wrapping_sub(1);
        distance_cache[5] = last_distance.wrapping_add(1);
        distance_cache[6] = last_distance.wrapping_sub(2);
        distance_cache[7] = last_distance.wrapping_add(2);
        distance_cache[8] = last_distance.wrapping_sub(3);
        distance_cache[9] = last_distance.wrapping_add(3);
        if num_distances > 10 {
            let next_last_distance = distance_cache[1];
            distance_cache[10] = next_last_distance.wrapping_sub(1);
            distance_cache[11] = next_last_distance.wrapping_add(1);
            distance_cache[12] = next_last_distance.wrapping_sub(2);
            distance_cache[13] = next_last_distance.wrapping_add(2);
            distance_cache[14] = next_last_distance.wrapping_sub(3);
            distance_cache[15] = next_last_distance.wrapping_add(3);
        }
    }
}

const LITERAL_BYTE_SCORE: usize = 135;
const DISTANCE_BIT_PENALTY: usize = 30;
/// Keeps a score positive after the largest penalty.
pub(crate) const SCORE_BASE: usize = DISTANCE_BIT_PENALTY * 8 * size_of::<u64>();

/// The longest match is not always the best one: a distance takes about `log2` of it bits, which can be more than
/// what the extra literals would take.
#[inline(always)]
fn backward_reference_score(copy_length: usize, backward_reference_offset: usize) -> usize {
    debug_assert!(backward_reference_offset != 0);
    (SCORE_BASE + LITERAL_BYTE_SCORE.wrapping_mul(copy_length))
        .wrapping_sub(DISTANCE_BIT_PENALTY * log2_floor_nonzero(backward_reference_offset) as usize)
}

#[inline(always)]
fn backward_reference_score_using_last_distance(copy_length: usize) -> usize {
    LITERAL_BYTE_SCORE.wrapping_mul(copy_length) + SCORE_BASE + 15
}

#[inline(always)]
fn backward_reference_penalty_using_last_distance(distance_short_code: usize) -> usize {
    39 + ((0x1CA10 >> (distance_short_code & 0xE)) & 0xE)
}

#[derive(Default)]
pub(crate) struct DictionaryStats {
    num_lookups: usize,
    num_matches: usize,
}

/// The static dictionary, and how well looking things up in it went so far.
pub(crate) struct StaticDictionarySearch<'a> {
    stats: &'a mut DictionaryStats,
    hash: &'static DictionaryHash,
}

impl<'a> StaticDictionarySearch<'a> {
    pub(crate) fn new(stats: &'a mut DictionaryStats, hash: &'static DictionaryHash) -> Self {
        Self { stats, hash }
    }
}

/// Which of the two words that the static dictionary has for a hash are tried.
#[derive(Clone, Copy)]
enum DictionaryCandidates {
    First = 1,
    Both = 2,
}

/// Whether the word `word_idx` of `len` bytes, or all but its last few bytes, is a better match for the start of `data`
/// than `out`.
#[inline(always)]
fn test_static_dictionary_item(
    len: usize,
    word_idx: usize,
    data: &[u8],
    max_length: usize,
    max_backward: usize,
    max_distance: usize,
    out: &mut HasherSearchResult,
) -> Checked<bool> {
    let offset = OFFSETS_BY_LENGTH.at(len)? as usize + len * word_idx;
    if len > max_length {
        return Ok(false);
    }

    // Most words differ from the data in their first few bytes.
    let word = DATA.sub(offset..offset + len)?;
    let matchlen = word.iter().zip(data).take_while(|(a, b)| a == b).count();
    if matchlen == 0 {
        return Ok(false);
    }
    let Some(&transform_id) = CUT_OFF_TRANSFORMS.get(len - matchlen) else {
        return Ok(false);
    };
    let transform_id = usize::from(transform_id);
    let backward = max_backward + 1 + word_idx + (transform_id << SIZE_BITS_BY_LENGTH.at(len)?);
    if backward > max_distance {
        return Ok(false);
    }
    let score = backward_reference_score(matchlen, backward);
    if score < out.score {
        return Ok(false);
    }
    out.len = matchlen;
    out.len_code_delta = len as i32 - matchlen as i32;
    out.distance = backward;
    out.score = score;
    Ok(true)
}

/// Looks the start of `data` up in the static dictionary, unless fewer than 1 in 128 lookups found something so far.
#[inline(always)]
fn search_in_static_dictionary(
    dictionary: &mut StaticDictionarySearch<'_>,
    data: &[u8],
    max_length: usize,
    max_backward: usize,
    max_distance: usize,
    out: &mut HasherSearchResult,
    candidates: DictionaryCandidates,
) -> Checked {
    let stats = &*dictionary.stats;
    if stats.num_matches < (stats.num_lookups >> 7) {
        return Ok(());
    }
    // A copy, so that `out` itself can stay in registers.
    let mut result = *out;
    look_up_in_static_dictionary(
        dictionary,
        data,
        max_length,
        max_backward,
        max_distance,
        &mut result,
        candidates,
    )?;
    *out = result;
    Ok(())
}

/// Kept out of the loops that look for matches, which are faster without it.
#[inline(never)]
fn look_up_in_static_dictionary(
    dictionary: &mut StaticDictionarySearch<'_>,
    data: &[u8],
    max_length: usize,
    max_backward: usize,
    max_distance: usize,
    out: &mut HasherSearchResult,
    candidates: DictionaryCandidates,
) -> Checked {
    let stats = &mut *dictionary.stats;
    let key = DictionaryHash::first_bucket(load_u32_le(data, 0)?);
    for key in key..key + candidates as usize {
        stats.num_lookups += 1;
        let len = dictionary.hash.lengths.at(key)?;
        if len != 0 {
            let item_matches = test_static_dictionary_item(
                usize::from(len),
                usize::from(dictionary.hash.words.at(key)?),
                data,
                max_length,
                max_backward,
                max_distance,
                out,
            )?;
            if item_matches {
                stats.num_matches += 1;
            }
        }
    }
    Ok(())
}

/// The part of the ring buffer that a match has to end in to be looked at, as in the reference encoder: the positions up
/// to `mask`. All of `data` while the ring buffer is shorter than that.
#[inline(always)]
fn window(data: &[u8], mask: usize) -> &[u8] {
    data.get(..=mask).unwrap_or(data)
}

/// Tries the first `num_last_distances_to_check` distances of the cache. `best_len` is the length to beat.
#[inline(always)]
fn find_longest_match_at_last_distances(
    data: &[u8],
    mask: usize,
    distance_cache: &[i32; 16],
    num_last_distances_to_check: usize,
    cur_ix: usize,
    max_length: usize,
    max_backward: usize,
    best_len: &mut usize,
    out: &mut HasherSearchResult,
) -> Checked {
    let cur_ix_masked = cur_ix & mask;
    let window = window(data, mask);
    let mut best_score = out.score;
    for (i, &distance) in distance_cache
        .iter()
        .enumerate()
        .take(num_last_distances_to_check)
    {
        let backward = distance as usize;
        let mut prev_ix = cur_ix.wrapping_sub(backward);
        if prev_ix >= cur_ix {
            continue;
        }
        if backward > max_backward {
            continue;
        }
        prev_ix &= mask;

        // The byte that a longer match has to include. It has to be inside the window.
        let Some(wanted) = window.get(cur_ix_masked + *best_len) else {
            break;
        };
        if window.get(prev_ix + *best_len) != Some(wanted) {
            continue;
        }
        let len = find_match_length_with_limit(
            data.sub(prev_ix..)?,
            data.sub(cur_ix_masked..)?,
            max_length,
        );
        if len >= 3 || (len == 2 && i < 2) {
            let mut score = backward_reference_score_using_last_distance(len);
            if best_score < score {
                if i != 0 {
                    score -= backward_reference_penalty_using_last_distance(i);
                }
                if best_score < score {
                    best_score = score;
                    *best_len = len;
                    out.len = len;
                    out.distance = backward;
                    out.score = best_score;
                }
            }
        }
    }
    Ok(())
}

/// A match found by [`H10`].
#[derive(Clone, Copy, Default)]
pub(crate) struct BackwardMatch {
    pub(crate) distance: u32,
    /// The length in the high 27 bits. In the low 5, the length that is encoded if it is another one, else 0.
    pub(crate) length_and_code: u32,
}

impl BackwardMatch {
    #[inline(always)]
    pub(crate) fn new(dist: usize, len: usize) -> Self {
        Self {
            distance: dist as u32,
            length_and_code: (len << 5) as u32,
        }
    }

    /// A word of the static dictionary, of `len_code` bytes before its transform.
    #[inline(always)]
    pub(crate) fn new_dictionary(dist: usize, len: usize, len_code: usize) -> Self {
        Self {
            distance: dist as u32,
            length_and_code: ((len << 5) | if len == len_code { 0 } else { len_code }) as u32,
        }
    }

    #[inline(always)]
    pub(crate) fn length(self) -> usize {
        (self.length_and_code >> 5) as usize
    }

    #[inline(always)]
    pub(crate) fn length_code(self) -> usize {
        let code = (self.length_and_code & 31) as usize;
        if code != 0 { code } else { self.length() }
    }
}

/// Calls `f` with each position from `ix_start` up to `ix_end` and the `N` bytes of the ring buffer `data` there.
#[inline(always)]
fn for_each_position<const N: usize>(
    data: &[u8],
    mask: usize,
    ix_start: usize,
    ix_end: usize,
    mut f: impl FnMut(usize, &[u8; N]) -> Checked,
) -> Checked {
    let mut ix = ix_start;
    while ix < ix_end {
        // Up to the end of the ring buffer. After it there is a copy of its start.
        let masked = ix & mask;
        let count = (ix_end - ix).min(mask + 1 - masked);
        let bytes = data.sub(masked..)?.sub(..count + N - 1)?;
        for (ix, bytes) in (ix..).zip(bytes.array_windows()) {
            f(ix, bytes)?;
        }
        ix += count;
    }
    Ok(())
}

/// A table of the positions of the input, by a hash of the bytes there. `data` is the ring buffer, and `mask` its size
/// less 1.
pub(crate) trait HasherImpl {
    /// How many bytes a lookup reads. A lookup is only made with more than this many left.
    const HASH_TYPE_LENGTH: usize;
    /// How many bytes [`Self::store`] looks at.
    const STORE_LOOKAHEAD: usize;

    /// Empties the table. If `one_shot`, the first `input_size` bytes of `data` are all the input there will be.
    fn prepare(&mut self, one_shot: bool, input_size: usize, data: &[u8]) -> Checked;

    /// Makes room for the positions below `input_end`. No other will be added before the next call.
    fn reserve(&mut self, _input_end: usize) -> Result<(), AllocError> {
        Ok(())
    }

    /// Adds the position `ix`.
    fn store(&mut self, data: &[u8], mask: usize, ix: usize) -> Checked;

    #[inline(always)]
    fn store_range(&mut self, data: &[u8], mask: usize, ix_start: usize, ix_end: usize) -> Checked {
        for i in ix_start..ix_end {
            self.store(data, mask, i)?;
        }
        Ok(())
    }

    /// Adds the last three positions of the previous block, which could not be hashed without the `num_bytes` that were
    /// written at `position` since.
    #[inline(always)]
    fn stitch_to_previous_block(
        &mut self,
        num_bytes: usize,
        position: usize,
        data: &[u8],
        mask: usize,
    ) -> Checked {
        if num_bytes >= Self::HASH_TYPE_LENGTH - 1 && position >= 3 {
            self.store(data, mask, position - 3)?;
            self.store(data, mask, position - 2)?;
            self.store(data, mask, position - 1)?;
        }
        Ok(())
    }
}

/// A hasher that finds the best match for a position.
pub(crate) trait LongestMatchHasher: HasherImpl {
    /// To be called whenever one of the first 4 distances changed, before the next lookup.
    fn prepare_distance_cache(&self, distance_cache: &mut [i32; 16]);

    /// Looks for a match for the bytes at `cur_ix`, no longer than `max_length` and no further back than
    /// `max_backward`, that scores better than `out`, and adds the position `cur_ix`. Words of the static dictionary
    /// are at distances over `dictionary_distance`.
    fn find_longest_match(
        &mut self,
        dictionary: &mut StaticDictionarySearch<'_>,
        data: &[u8],
        mask: usize,
        distance_cache: &[i32; 16],
        cur_ix: usize,
        max_length: usize,
        max_backward: usize,
        dictionary_distance: usize,
        max_distance: usize,
        out: &mut HasherSearchResult,
    ) -> Checked;
}

// With a sweep of 1, looking things up in the dictionary makes compression of small text a little faster and denser.
type H2 = HashLongestMatchQuickly<{ 1 << 16 }, 1, 5, true>;
type H3 = HashLongestMatchQuickly<{ 1 << 16 }, 2, 5, false>;
type H4 = HashLongestMatchQuickly<{ 1 << 17 }, 4, 5, true>;
type H5 = HashLongestMatch<false>;
type H6 = HashLongestMatch<true>;
pub(crate) type H10 = HashToBinaryTree;
type H40 = HashForgetfulChain<15, 1, 16, 4>;
type H41 = HashForgetfulChain<15, 1, 16, 10>;
type H42 = HashForgetfulChain<15, 512, 9, 16>;
type H54 = HashLongestMatchQuickly<{ 1 << 20 }, 4, 7, false>;
type H58<const N: usize> = HashLongestMatchTagged<false, N, DenseBuckets<N>>;
type H58Sparse<const N: usize> = HashLongestMatchTagged<false, N, SparseBuckets<N>>;
type H68<const N: usize> = HashLongestMatchTagged<true, N, DenseBuckets<N>>;
// For large windows.
type H35 = HashComposite<H3, HashRolling<4>>;
type H55 = HashComposite<H54, HashRolling<4>>;
type H65 = HashComposite<H6, HashRolling<1>>;

/// The hasher that [`EncoderParams::choose_hasher`] chose. Some come in two forms that find the same matches.
pub(crate) enum HasherKind {
    /// Nothing was allocated yet.
    NotSetUp,
    H2(H2),
    H3(H3),
    H4(H4),
    H5(H5),
    H6(H6),
    H10(H10),
    H35(H35),
    H40(H40),
    H41(H41),
    H42(H42),
    H54(H54),
    H55(H55),
    H58x16(H58<16>),
    H58x32(H58<32>),
    H58x16Sparse(H58Sparse<16>),
    H58x32Sparse(H58Sparse<32>),
    H65(H65),
    H68x16(H68<16>),
    H68x32(H68<32>),
}

pub(crate) struct Hasher {
    pub(crate) dictionary_stats: DictionaryStats,
    pub(crate) kind: HasherKind,
    /// Whether the tables are ready for the input in the ring buffer. Not so at first and after [`Self::reset`].
    is_prepared: bool,
}

/// Evaluates `$body` with `$hasher` bound to the hasher in use.
macro_rules! with_hasher {
    ($kind:expr, $hasher:ident => $body:expr) => {
        match $kind {
            HasherKind::NotSetUp => Err(Bug.into()),
            HasherKind::H2($hasher) => $body,
            HasherKind::H3($hasher) => $body,
            HasherKind::H4($hasher) => $body,
            HasherKind::H5($hasher) => $body,
            HasherKind::H6($hasher) => $body,
            HasherKind::H10($hasher) => $body,
            HasherKind::H35($hasher) => $body,
            HasherKind::H40($hasher) => $body,
            HasherKind::H41($hasher) => $body,
            HasherKind::H42($hasher) => $body,
            HasherKind::H54($hasher) => $body,
            HasherKind::H55($hasher) => $body,
            HasherKind::H58x16($hasher) => $body,
            HasherKind::H58x32($hasher) => $body,
            HasherKind::H58x16Sparse($hasher) => $body,
            HasherKind::H58x32Sparse($hasher) => $body,
            HasherKind::H65($hasher) => $body,
            HasherKind::H68x16($hasher) => $body,
            HasherKind::H68x32($hasher) => $body,
        }
    };
}

impl Hasher {
    pub(crate) fn new() -> Self {
        Self {
            dictionary_stats: DictionaryStats::default(),
            kind: HasherKind::NotSetUp,
            is_prepared: false,
        }
    }

    /// The tables are emptied before the next use. They keep their size.
    pub(crate) fn reset(&mut self) {
        self.is_prepared = false;
    }

    /// On first use, chooses a hasher and allocates it. Later, replaces one that is made for less input than there is now.
    fn setup(
        &mut self,
        params: &EncoderParams,
        data: &[u8],
        position: usize,
        input_size: usize,
        is_last: bool,
    ) -> Fallible {
        let one_shot = position == 0 && is_last;
        let input_end = position + input_size;
        if matches!(self.kind, HasherKind::NotSetUp) {
            self.kind = match params.choose_hasher() {
                HasherType::H2 => HasherKind::H2(H2::new()?),
                HasherType::H3 => HasherKind::H3(H3::new()?),
                HasherType::H4 => HasherKind::H4(H4::new()?),
                HasherType::H5(hasher_params) => HasherKind::H5(H5::new(hasher_params)?),
                HasherType::H6(hasher_params) => HasherKind::H6(H6::new(hasher_params)?),
                HasherType::H10 => HasherKind::H10(H10::new(params, one_shot, input_size)?),
                HasherType::H35 => HasherKind::H35(H35::new(H3::new()?, HashRolling::new()?)),
                HasherType::H40 => HasherKind::H40(H40::new(params)?),
                HasherType::H41 => HasherKind::H41(H41::new(params)?),
                HasherType::H42 => HasherKind::H42(H42::new(params)?),
                HasherType::H54 => HasherKind::H54(H54::new()?),
                HasherType::H55 => HasherKind::H55(H55::new(H54::new()?, HashRolling::new()?)),
                HasherType::H58x16 if input_end > H58Sparse::<16>::MAX_INPUT => {
                    HasherKind::H58x16(H58::new()?)
                }
                HasherType::H58x16 => HasherKind::H58x16Sparse(H58Sparse::new()?),
                HasherType::H58x32 if input_end > H58Sparse::<32>::MAX_INPUT => {
                    HasherKind::H58x32(H58::new()?)
                }
                HasherType::H58x32 => HasherKind::H58x32Sparse(H58Sparse::new()?),
                HasherType::H65(hasher_params) => {
                    HasherKind::H65(H65::new(H6::new(hasher_params)?, HashRolling::new()?))
                }
                HasherType::H68x16 => HasherKind::H68x16(H68::new()?),
                HasherType::H68x32 => HasherKind::H68x32(H68::new()?),
            };
        }
        match &self.kind {
            HasherKind::H58x16Sparse(h) if input_end > H58Sparse::<16>::MAX_INPUT => {
                self.kind = HasherKind::H58x16(h.to_dense()?);
            }
            HasherKind::H58x32Sparse(h) if input_end > H58Sparse::<32>::MAX_INPUT => {
                self.kind = HasherKind::H58x32(h.to_dense()?);
            }
            _ => {}
        }

        with_hasher!(&mut self.kind, hasher => hasher.reserve(input_end).map_err(EncoderError::from))?;

        if !self.is_prepared {
            with_hasher!(&mut self.kind, hasher => hasher.prepare(one_shot, input_size, data))?;
            self.is_prepared = true;
        }
        Ok(())
    }

    /// To be called for each block of `input_size` bytes written at `position`, before looking for matches in it.
    pub(crate) fn init_or_stitch_to_previous_block(
        &mut self,
        data: &[u8],
        mask: usize,
        params: &EncoderParams,
        position: usize,
        input_size: usize,
        is_last: bool,
    ) -> Fallible {
        self.setup(params, data, position, input_size, is_last)?;
        with_hasher!(&mut self.kind, hasher => hasher.stitch_to_previous_block(input_size, position, data, mask))?;
        Ok(())
    }

    pub(crate) fn h10_mut(&mut self) -> Checked<&mut H10> {
        match &mut self.kind {
            HasherKind::H10(hasher) => Ok(hasher),
            _ => Err(Bug),
        }
    }
}

/// Where the chain of the positions in `dictionary` that may match the 8 bytes at `cur_ix_masked` starts in its items,
/// if there are any.
#[inline(always)]
fn compound_dictionary_chain(
    dictionary: &PreparedDictionary,
    data: &[u8],
    cur_ix_masked: usize,
) -> Checked<Option<usize>> {
    let key = bucket_index(load_u64_le(data, cur_ix_masked)?, dictionary.bucket_bits);
    let slot = key & ((1 << dictionary.slot_bits) - 1);
    let head = dictionary.heads.at(key)?;
    if head == EMPTY_BUCKET {
        return Ok(None);
    }
    Ok(Some(
        (dictionary.slot_offsets.at(slot)? + u32::from(head)) as usize,
    ))
}

/// Looks for a match in `dictionary` that scores better than `out`. Its first byte is at the distance
/// `distance_offset`.
#[inline(always)]
fn find_compound_dictionary_match(
    dictionary: &PreparedDictionary,
    data: &[u8],
    mask: usize,
    distance_cache: &[i32; 16],
    cur_ix: usize,
    max_length: usize,
    distance_offset: usize,
    max_distance: usize,
    out: &mut HasherSearchResult,
) -> Checked {
    let source = &*dictionary.source;
    let source_size = source.len();
    let boundary = distance_offset.wrapping_sub(source_size);
    let cur_ix_masked = cur_ix & mask;
    let mut best_score = out.score;
    let mut best_len = out.len;
    let chain = compound_dictionary_chain(dictionary, data, cur_ix_masked)?;

    for (i, &distance) in distance_cache.iter().enumerate().take(4) {
        let distance = distance as usize;
        if distance <= boundary || distance > distance_offset {
            continue;
        }
        let offset = distance_offset - distance;
        let limit = source_size.wrapping_sub(offset).min(max_length);
        let len =
            find_match_length_with_limit(source.sub(offset..)?, data.sub(cur_ix_masked..)?, limit);
        if len >= 2 {
            let mut score = backward_reference_score_using_last_distance(len);
            if best_score < score {
                if i != 0 {
                    score -= backward_reference_penalty_using_last_distance(i);
                }
                if best_score < score {
                    best_score = score;
                    if len > best_len {
                        best_len = len;
                    }
                    out.len = len;
                    out.len_code_delta = 0;
                    out.distance = distance;
                    out.score = best_score;
                }
            }
        }
    }
    // Only matches of 4 bytes and more count from here on, so 4 bytes can be compared each time.
    if best_len < 3 {
        best_len = 3;
    }
    let Some(chain) = chain else {
        return Ok(());
    };
    for &item in dictionary.items.sub(chain..)? {
        let offset = (item & !LAST_ITEM_FLAG) as usize;
        let is_last = item & LAST_ITEM_FLAG != 0;
        let distance = distance_offset.wrapping_sub(offset);
        let limit = source_size.wrapping_sub(offset).min(max_length);
        if distance <= max_distance
            && cur_ix_masked + best_len <= mask
            && best_len < limit
            && load_u32_le(data, cur_ix_masked + best_len - 3)?
                == load_u32_le(source, offset + best_len - 3)?
        {
            let len = find_match_length_with_limit(
                source.sub(offset..)?,
                data.sub(cur_ix_masked..)?,
                limit,
            );
            if len >= 4 {
                let score = backward_reference_score(len, distance);
                if best_score < score {
                    best_score = score;
                    best_len = len;
                    out.len = best_len;
                    out.len_code_delta = 0;
                    out.distance = distance;
                    out.score = best_score;
                }
            }
        }
        if is_last {
            break;
        }
    }
    Ok(())
}

/// Finds matches in `dictionary`, each longer than the one before and than `min_length`, until `matches` is full.
/// Returns how many.
#[inline(always)]
fn find_all_compound_dictionary_matches(
    dictionary: &PreparedDictionary,
    data: &[u8],
    mask: usize,
    cur_ix: usize,
    min_length: usize,
    max_length: usize,
    distance_offset: usize,
    max_distance: usize,
    matches: &mut [BackwardMatch],
) -> Checked<usize> {
    let source = &*dictionary.source;
    let source_size = source.len();
    let cur_ix_masked = cur_ix & mask;
    let mut best_len = min_length;
    let mut found = 0usize;

    let Some(chain) = compound_dictionary_chain(dictionary, data, cur_ix_masked)? else {
        return Ok(0);
    };
    for &item in dictionary.items.sub(chain..)? {
        let offset = (item & !LAST_ITEM_FLAG) as usize;
        let is_last = item & LAST_ITEM_FLAG != 0;
        let distance = distance_offset.wrapping_sub(offset);
        let limit = source_size.wrapping_sub(offset).min(max_length);
        if distance <= max_distance
            && cur_ix_masked + best_len <= mask
            && best_len < limit
            && data.at(cur_ix_masked + best_len)? == source.at(offset + best_len)?
        {
            let len = find_match_length_with_limit(
                source.sub(offset..)?,
                data.sub(cur_ix_masked..)?,
                limit,
            );
            if len > best_len {
                best_len = len;
                matches.put(found, BackwardMatch::new(distance, len))?;
                found += 1;
                if found == matches.len() {
                    break;
                }
            }
        }
        if is_last {
            break;
        }
    }
    Ok(found)
}

/// Looks for a match in the compound dictionary that scores better than `out`. The dictionary ends at the distance
/// `max_ring_buffer_distance + 1`.
#[inline(always)]
pub(crate) fn lookup_compound_dictionary_match(
    dictionary: &CompoundDictionary,
    data: &[u8],
    mask: usize,
    distance_cache: &[i32; 16],
    cur_ix: usize,
    max_length: usize,
    max_ring_buffer_distance: usize,
    max_distance: usize,
    out: &mut HasherSearchResult,
) -> Checked {
    let base_offset = max_ring_buffer_distance + 1 + dictionary.total_size - 1;
    for (chunk, &chunk_offset) in dictionary.chunks.iter().zip(&dictionary.chunk_offsets) {
        find_compound_dictionary_match(
            chunk,
            data,
            mask,
            distance_cache,
            cur_ix,
            max_length,
            base_offset - chunk_offset,
            max_distance,
            out,
        )?;
    }
    Ok(())
}

/// Finds matches in the compound dictionary, each longer than the one before and than `min_length`, until `matches` is
/// full. Returns how many.
#[inline(always)]
pub(crate) fn lookup_all_compound_dictionary_matches(
    dictionary: &CompoundDictionary,
    data: &[u8],
    mask: usize,
    cur_ix: usize,
    mut min_length: usize,
    max_length: usize,
    max_ring_buffer_distance: usize,
    max_distance: usize,
    matches: &mut [BackwardMatch],
) -> Checked<usize> {
    let base_offset = max_ring_buffer_distance + 1 + dictionary.total_size - 1;
    let mut total_found = 0usize;
    for (chunk, &chunk_offset) in dictionary.chunks.iter().zip(&dictionary.chunk_offsets) {
        total_found += find_all_compound_dictionary_matches(
            chunk,
            data,
            mask,
            cur_ix,
            min_length,
            max_length,
            base_offset - chunk_offset,
            max_distance,
            matches.sub_mut(total_found..)?,
        )?;
        if total_found == matches.len() {
            break;
        }
        if total_found > 0 {
            min_length = matches.at(total_found - 1)?.length();
        }
    }
    Ok(total_found)
}
