//! `backward_references_enc.c`: turns pixels into literals, colour cache hits and copies of earlier pixels.

use super::backward_references_cost::backward_references_trace_backwards;
use super::histogram::Histogram;
use super::lossless::{prefix_encode, vector_mismatch};
use crate::EncodeError;
use crate::util::{Bug, Checked, OutOfMemory, SliceExt, try_vec};
use crate::vp8l::color_cache::{ColorCache, hash_pix};
use crate::vp8l::format_constants::{NUM_LENGTH_CODES, NUM_LITERAL_CODES};

/// The format allows 11.
pub(crate) const MAX_COLOR_CACHE_BITS: u32 = 10;

const HASH_BITS: u32 = 18;
const HASH_SIZE: usize = 1 << HASH_BITS;

const MAX_LENGTH_BITS: u32 = 12;
const WINDOW_SIZE_BITS: u32 = 20;
/// The longest copy.
pub(crate) const MAX_LENGTH: usize = (1 << MAX_LENGTH_BITS) - 1;
/// The longest distance: 120 codes are taken by the short distances.
const WINDOW_SIZE: usize = (1 << WINDOW_SIZE_BITS) - 120;

/// From this length on a copy is cheaper than literals.
const MIN_LENGTH: usize = 4;

#[derive(Clone, Copy)]
pub(crate) enum PixOrCopy {
    Literal(u32),
    CacheIdx(u32),
    Copy { distance: u32, len: u16 },
}

impl PixOrCopy {
    /// How many pixels it stands for.
    #[inline]
    pub(crate) fn length(self) -> usize {
        match self {
            Self::Literal(_) | Self::CacheIdx(_) => 1,
            Self::Copy { len, .. } => len.into(),
        }
    }

    #[inline]
    fn copy(distance: usize, len: usize) -> Self {
        debug_assert!(distance <= WINDOW_SIZE && len <= MAX_LENGTH);
        Self::Copy {
            distance: distance as u32,
            len: len as u16,
        }
    }
}

/// `VP8LBackwardRefs`
#[derive(Default)]
pub(crate) struct BackwardRefs(Vec<PixOrCopy>);

impl BackwardRefs {
    #[inline]
    pub(crate) fn push(&mut self, v: PixOrCopy) -> Result<(), OutOfMemory> {
        if self.0.len() == self.0.capacity() {
            self.0.try_reserve(1).map_err(|_| OutOfMemory)?;
        }
        self.0.push(v);
        Ok(())
    }

    #[inline]
    pub(crate) fn push_copy(&mut self, distance: usize, len: usize) -> Result<(), OutOfMemory> {
        self.push(PixOrCopy::copy(distance, len))
    }

    pub(crate) fn clear(&mut self) {
        self.0.clear();
    }

    pub(crate) fn iter(&self) -> core::slice::Iter<'_, PixOrCopy> {
        self.0.iter()
    }
}

#[rustfmt::skip]
static PLANE_TO_CODE_LUT: [u8; 128] = [
    96,   73,  55,  39,  23,  13,   5,  1,  255, 255, 255, 255, 255, 255, 255, 255,
    101,  78,  58,  42,  26,  16,   8,  2,    0,   3,  9,   17,  27,  43,  59,  79,
    102,  86,  62,  46,  32,  20,  10,  6,    4,   7,  11,  21,  33,  47,  63,  87,
    105,  90,  70,  52,  37,  28,  18,  14,  12,  15,  19,  29,  38,  53,  71,  91,
    110,  99,  82,  66,  48,  35,  30,  24,  22,  25,  31,  36,  49,  67,  83, 100,
    115, 108,  94,  76,  64,  50,  44,  40,  34,  41,  45,  51,  65,  77,  95, 109,
    118, 113, 103,  92,  80,  68,  60,  56,  54,  57,  61,  69,  81,  93, 104, 114,
    119, 116, 111, 106,  97,  88,  84,  74,  72,  75,  85,  89,  98, 107, 112, 117,
];

/// `VP8LDistanceToPlaneCode`: the distances to the pixels nearest in two dimensions get the 120 lowest codes.
#[inline]
pub(crate) fn distance_to_plane_code(xsize: usize, dist: u32) -> u32 {
    let xsize = xsize.max(1) as u32;
    let yoffset = dist / xsize;
    let xoffset = dist - yoffset * xsize;
    let index = if xoffset <= 8 && yoffset < 8 {
        yoffset * 16 + 8 - xoffset
    } else if xoffset + 8 > xsize && yoffset < 7 {
        (yoffset + 1) * 16 + 8 + (xsize - xoffset)
    } else {
        return dist + 120;
    };
    match PLANE_TO_CODE_LUT.get(index as usize) {
        Some(&code) => u32::from(code) + 1,
        None => dist + 120,
    }
}

/// How far `argb[pos1..]` and `argb[pos2..]` are the same, up to `max_limit`. Returns 0 instead if that is
/// `best_len_match` or less and it is quick to see.
#[inline]
fn find_match_length(
    argb: &[u32],
    pos1: usize,
    pos2: usize,
    best_len_match: usize,
    max_limit: usize,
) -> Checked<usize> {
    if argb.at(pos1 + best_len_match)? != argb.at(pos2 + best_len_match)? {
        return Ok(0);
    }
    match_length(argb, pos1, pos2, max_limit)
}

#[inline]
fn match_length(argb: &[u32], pos1: usize, pos2: usize, max_limit: usize) -> Checked<usize> {
    Ok(vector_mismatch(
        argb.sub(pos1..)?.sub(..max_limit)?,
        argb.sub(pos2..)?.sub(..max_limit)?,
    ))
}

// -----------------------------------------------------------------------------
// Hash chains

/// `VP8LHashChain`: the best copy that can start at each pixel.
pub(crate) struct HashChain {
    /// The distance in the upper 20 bits, the length in the lower 12.
    offset_length: Vec<u32>,
}

/// The end of a chain of positions with the same hash.
const NO_POSITION: u32 = u32::MAX;

#[inline]
const fn get_pix_pair_hash64(argb0: u32, argb1: u32) -> usize {
    let key = argb1
        .wrapping_mul(0xc6a4_a793)
        .wrapping_add(argb0.wrapping_mul(0x5bd1_e996));
    (key >> (32 - HASH_BITS)) as usize
}

/// How many positions of a hash chain to look at: 8 to 86.
const fn get_max_iters_for_quality(quality: i32) -> i32 {
    8 + (quality * quality) / 128
}

fn get_window_size_for_hash_chain(quality: i32, xsize: usize) -> usize {
    let max_window_size = if quality > 50 {
        xsize << 8
    } else if quality > 25 {
        xsize << 6
    } else {
        xsize << 4
    };
    max_window_size.min(WINDOW_SIZE)
}

impl HashChain {
    /// For images of up to `size` pixels.
    pub(crate) fn new(size: usize) -> Result<Self, OutOfMemory> {
        Ok(Self {
            offset_length: try_vec(0, size)?,
        })
    }

    #[inline]
    pub(crate) fn find_offset(&self, base_position: usize) -> Checked<usize> {
        Ok((self.offset_length.at(base_position)? >> MAX_LENGTH_BITS) as usize)
    }

    #[inline]
    pub(crate) fn find_length(&self, base_position: usize) -> Checked<usize> {
        Ok((self.offset_length.at(base_position)? as usize) & MAX_LENGTH)
    }

    /// The distance and the length.
    #[inline]
    pub(crate) fn find_copy(&self, base_position: usize) -> Checked<(usize, usize)> {
        let offset_length = self.offset_length.at(base_position)?;
        Ok((
            (offset_length >> MAX_LENGTH_BITS) as usize,
            offset_length as usize & MAX_LENGTH,
        ))
    }

    #[inline]
    fn set(&mut self, position: usize, offset: usize, length: usize) -> Checked {
        self.offset_length.put(
            position,
            ((offset as u32) << MAX_LENGTH_BITS) | length as u32,
        )
    }

    /// `VP8LHashChainFill`
    pub(crate) fn fill(
        &mut self,
        quality: i32,
        argb: &[u32],
        xsize: usize,
    ) -> Result<(), EncodeError> {
        let size = argb.len();
        let iter_max = get_max_iters_for_quality(quality);
        let window_size = get_window_size_for_hash_chain(quality, xsize);
        // First it links each position to the previous one with the same hash.
        let chain = self.offset_length.sub_mut(..size)?;

        if size <= 2 {
            chain.fill(0);
            return Ok(());
        }

        {
            let mut hash_to_first_index = try_vec(NO_POSITION, HASH_SIZE)?;
            let mut link = |chain: &mut [u32], pos: usize, hash_code: usize| -> Checked {
                let first = hash_to_first_index.at_mut(hash_code)?;
                chain.put(pos, core::mem::replace(first, pos as u32))
            };
            let mut argb_comp = argb.at(0)? == argb.at(1)?;
            let mut pos = 0;
            while pos < size - 2 {
                let argb_comp_next = argb.at(pos + 1)? == argb.at(pos + 2)?;
                if argb_comp && argb_comp_next {
                    // All the pairs of pixels in a run of one colour have the same hash. The colour and the length
                    // of what is left of the run tell them apart.
                    let color = argb.at(pos)?;
                    let mut len = 1 + argb
                        .sub(pos + 3..)?
                        .iter()
                        .take_while(|&&pixel| pixel == color)
                        .count();
                    if len > MAX_LENGTH {
                        // These match at distance 1 for the longest length, which is tried in any case.
                        chain
                            .sub_mut(pos..pos + (len - MAX_LENGTH))?
                            .fill(NO_POSITION);
                        pos += len - MAX_LENGTH;
                        len = MAX_LENGTH;
                    }
                    while len > 0 {
                        link(chain, pos, get_pix_pair_hash64(color, len as u32))?;
                        pos += 1;
                        len -= 1;
                    }
                    argb_comp = false;
                } else {
                    link(
                        chain,
                        pos,
                        get_pix_pair_hash64(argb.at(pos)?, argb.at(pos + 1)?),
                    )?;
                    pos += 1;
                    argb_comp = argb_comp_next;
                }
            }
            let hash_code = get_pix_pair_hash64(argb.at(pos)?, argb.at(pos + 1)?);
            chain.put(pos, hash_to_first_index.at(hash_code)?)?;
        }

        // Then, from the end, the links give way to the best match of each position. The last pixel has nothing
        // after it to match and the first nothing before it.
        chain.put(0, 0)?;
        chain.put(size - 1, 0)?;
        let mut base_position = size - 2;
        while base_position > 0 {
            let max_len = (size - 1 - base_position).min(MAX_LENGTH);
            let mut iter = iter_max;
            let mut best_length = 0;
            let mut best_distance = 0;
            let min_pos = base_position.saturating_sub(window_size);
            let length_max = max_len.min(256);

            let mut pos = chain.at(base_position)?;
            // The pixel above and the one before are good guesses.
            if base_position >= xsize {
                let curr_length =
                    find_match_length(argb, base_position - xsize, base_position, 0, max_len)?;
                if curr_length > best_length {
                    best_length = curr_length;
                    best_distance = xsize;
                }
                iter -= 1;
            }
            let curr_length =
                find_match_length(argb, base_position - 1, base_position, best_length, max_len)?;
            if curr_length > best_length {
                best_length = curr_length;
                best_distance = 1;
            }
            iter -= 1;
            if best_length == MAX_LENGTH {
                pos = NO_POSITION;
            }
            let mut best_argb = argb.at(base_position + best_length)?;

            while pos != NO_POSITION && pos as usize >= min_pos {
                iter -= 1;
                if iter == 0 {
                    break;
                }
                let candidate = pos as usize;
                pos = chain.at(candidate)?;
                if argb.at(candidate + best_length)? != best_argb {
                    continue;
                }
                let curr_length = match_length(argb, candidate, base_position, max_len)?;
                if best_length < curr_length {
                    best_length = curr_length;
                    best_distance = base_position - candidate;
                    best_argb = argb.at(base_position + best_length)?;
                    if best_length >= length_max {
                        break;
                    }
                }
            }

            // If the pixels before the two intervals are the same too, this also is the best match for them.
            let mut max_base_position = base_position;
            loop {
                chain.put(
                    base_position,
                    ((best_distance as u32) << MAX_LENGTH_BITS) | best_length as u32,
                )?;
                base_position -= 1;
                if best_distance == 0 || base_position == 0 {
                    break;
                }
                if base_position < best_distance
                    || argb.at(base_position - best_distance)? != argb.at(base_position)?
                {
                    break;
                }
                // A match of the longest length may have a nearer one of the same length, unless it is as near as can
                // be.
                if best_length == MAX_LENGTH
                    && best_distance != 1
                    && base_position + MAX_LENGTH < max_base_position
                {
                    break;
                }
                if best_length < MAX_LENGTH {
                    best_length += 1;
                    max_base_position = base_position;
                }
            }
        }
        Ok(())
    }
}

// -----------------------------------------------------------------------------

/// Copies from the pixel before and the pixel above only.
fn backward_references_rle(
    xsize: usize,
    argb: &[u32],
    refs: &mut BackwardRefs,
) -> Result<(), EncodeError> {
    let pix_count = argb.len();
    refs.clear();
    refs.push(PixOrCopy::Literal(argb.at(0)?))?;
    let mut i = 1;
    while i < pix_count {
        let max_len = (pix_count - i).min(MAX_LENGTH);
        let rle_len = find_match_length(argb, i, i - 1, 0, max_len)?;
        let prev_row_len = if i < xsize {
            0
        } else {
            find_match_length(argb, i, i - xsize, 0, max_len)?
        };
        if rle_len >= prev_row_len && rle_len >= MIN_LENGTH {
            refs.push_copy(1, rle_len)?;
            i += rle_len;
        } else if prev_row_len >= MIN_LENGTH {
            refs.push_copy(xsize, prev_row_len)?;
            i += prev_row_len;
        } else {
            refs.push(PixOrCopy::Literal(argb.at(i)?))?;
            i += 1;
        }
    }
    Ok(())
}

fn backward_references_lz77(
    argb: &[u32],
    hash_chain: &HashChain,
    refs: &mut BackwardRefs,
) -> Result<(), EncodeError> {
    let pix_count = argb.len();
    refs.clear();
    let mut i = 0;
    while i < pix_count {
        let (offset, mut len) = hash_chain.find_copy(i)?;
        if len >= MIN_LENGTH {
            let len_ini = len;
            let mut max_reach = 0;
            let j_max = (i + len_ini).min(pix_count - 1);
            // Rather than the longest copy from here, take the one after which the next copy gets furthest.
            for j in i + 1..=j_max {
                let len_j = hash_chain.find_length(j)?;
                let reach = j + if len_j >= MIN_LENGTH { len_j } else { 1 };
                if reach > max_reach {
                    len = j - i;
                    max_reach = reach;
                    if max_reach >= pix_count {
                        break;
                    }
                }
            }
        } else {
            len = 1;
        }
        if len == 1 {
            refs.push(PixOrCopy::Literal(argb.at(i)?))?;
        } else {
            refs.push_copy(offset, len)?;
        }
        i += len;
    }
    Ok(())
}

const WINDOW_OFFSETS_SIZE_MAX: usize = 32;

/// An LZ77 whose distances all are among the 32 cheapest. It fills `hash_chain` with the best copies at those.
fn backward_references_lz77_box(
    xsize: usize,
    argb: &[u32],
    hash_chain_best: &HashChain,
    hash_chain: &mut HashChain,
    refs: &mut BackwardRefs,
) -> Result<(), EncodeError> {
    let pix_count = argb.len();

    // How many times the pixel at each position is repeated from there on, up to MAX_LENGTH.
    let mut counts = try_vec(1u16, pix_count)?;
    let mut count = 1;
    for ((pixel, next), out) in argb.iter().zip(argb.iter().skip(1)).zip(&mut counts).rev() {
        count = if pixel == next {
            count + u16::from(count != MAX_LENGTH as u16)
        } else {
            1
        };
        *out = count;
    }

    // The distances by their code. In a narrow image some codes are not used.
    let mut by_plane_code = [0usize; WINDOW_OFFSETS_SIZE_MAX];
    for y in 0..=6isize {
        for x in -6..=6isize {
            let offset = y * xsize as isize + x;
            if offset <= 0 {
                continue;
            }
            let plane_code = distance_to_plane_code(xsize, offset as u32) - 1;
            if let Some(slot) = by_plane_code.get_mut(plane_code as usize) {
                *slot = offset as usize;
            }
        }
    }
    let mut window_offsets = [0usize; WINDOW_OFFSETS_SIZE_MAX];
    let mut window_offsets_size = 0;
    for offset in by_plane_code.into_iter().filter(|&offset| offset != 0) {
        window_offsets.put(window_offsets_size, offset)?;
        window_offsets_size += 1;
    }
    let window_offsets = window_offsets.sub(..window_offsets_size)?;
    // Those that lead to a pixel which none of them leads to from the pixel before.
    let mut window_offsets_new = [0usize; WINDOW_OFFSETS_SIZE_MAX];
    let mut window_offsets_new_size = 0;
    for &offset in window_offsets {
        if !window_offsets.iter().any(|&other| offset == other + 1) {
            window_offsets_new.put(window_offsets_new_size, offset)?;
            window_offsets_new_size += 1;
        }
    }
    let window_offsets_new = window_offsets_new.sub(..window_offsets_new_size)?;

    hash_chain.set(0, 0, 0)?;
    let (mut best_offset_prev, mut best_length_prev) = (0, 0);
    for i in 1..pix_count {
        let (mut best_offset, mut best_length) = hash_chain_best.find_copy(i)?;
        // A match of the longest length within the window cannot be improved on.
        if best_length < MAX_LENGTH || !window_offsets.contains(&best_offset) {
            // What is left of the match of the pixel before is a start, and then only the pixels that it could not
            // reach are worth a look.
            let use_prev = best_length_prev > 1 && best_length_prev < MAX_LENGTH;
            let offsets = if use_prev {
                best_length = best_length_prev - 1;
                best_offset = best_offset_prev;
                window_offsets_new
            } else {
                best_length = 0;
                best_offset = 0;
                window_offsets
            };
            for &offset in offsets {
                let Some(mut j_offset) = i.checked_sub(offset) else {
                    continue;
                };
                if argb.at(j_offset)? != argb.at(i)? {
                    continue;
                }
                // Go from run to run of the same colour.
                let mut curr_length = 0;
                let mut j = i;
                loop {
                    let counts_j_offset = usize::from(counts.at(j_offset)?);
                    let counts_j = usize::from(counts.at(j)?);
                    if counts_j_offset != counts_j {
                        curr_length += counts_j_offset.min(counts_j);
                        break;
                    }
                    curr_length += counts_j_offset;
                    j_offset += counts_j_offset;
                    j += counts_j_offset;
                    if curr_length > MAX_LENGTH
                        || j >= pix_count
                        || argb.at(j_offset)? != argb.at(j)?
                    {
                        break;
                    }
                }
                if best_length < curr_length {
                    best_offset = offset;
                    if curr_length >= MAX_LENGTH {
                        best_length = MAX_LENGTH;
                        break;
                    }
                    best_length = curr_length;
                }
            }
        }

        if best_length <= MIN_LENGTH {
            (best_offset, best_length) = (0, 0);
        }
        hash_chain.set(i, best_offset, best_length)?;
        best_offset_prev = best_offset;
        best_length_prev = best_length;
    }

    backward_references_lz77(argb, hash_chain, refs)
}

// -----------------------------------------------------------------------------

/// `BackwardReferences2DLocality`: replaces the distances by their codes.
fn backward_references_2d_locality(xsize: usize, refs: &mut BackwardRefs) {
    for v in &mut refs.0 {
        if let PixOrCopy::Copy { distance, .. } = v {
            *distance = distance_to_plane_code(xsize, *distance);
        }
    }
}

/// How often each value of each channel occurs in some pixels.
#[derive(Clone)]
struct LiteralCounts {
    blue: [u32; NUM_LITERAL_CODES],
    green: [u32; NUM_LITERAL_CODES],
    red: [u32; NUM_LITERAL_CODES],
    alpha: [u32; NUM_LITERAL_CODES],
}

impl LiteralCounts {
    #[inline]
    fn add(&mut self, pix: u32) {
        let [b, g, r, a] = pix.to_le_bytes();
        for (counts, value) in [
            (&mut self.blue, b),
            (&mut self.green, g),
            (&mut self.red, r),
            (&mut self.alpha, a),
        ] {
            if let Some(count) = counts.get_mut(usize::from(value)) {
                *count += 1;
            }
        }
    }
}

/// One element for each key of each size of colour cache: that of key `key` of the cache of `bits` bits is at
/// `(1 << bits) | key`. The key of the next smaller cache lacks the last bit, so that half the index is its element.
type PerCacheKey = [u32; 2 << MAX_COLOR_CACHE_BITS];

/// The size of colour cache, up to `cache_bits_max`, with which `refs` have the lowest entropy. 0 is none.
fn calculate_best_cache_size(
    argb: &[u32],
    refs: &BackwardRefs,
    cache_bits_max: u32,
) -> Result<u32, EncodeError> {
    if cache_bits_max == 0 {
        return Ok(0);
    }
    if cache_bits_max > MAX_COLOR_CACHE_BITS {
        return Err(Bug.into());
    }
    const EMPTY: LiteralCounts = LiteralCounts {
        blue: [0; NUM_LITERAL_CODES],
        green: [0; NUM_LITERAL_CODES],
        red: [0; NUM_LITERAL_CODES],
        alpha: [0; NUM_LITERAL_CODES],
    };
    let mut literals = EMPTY;
    // Those of the literals that each cache holds, from the largest cache to the smallest.
    let mut cached = try_vec(EMPTY, cache_bits_max as usize)?;
    let mut colors: PerCacheKey = [0; _];
    let mut hits: PerCacheKey = [0; _];
    // The distances cost the same whatever the cache, and so do the extra bits of the lengths.
    let mut lengths = [0u32; NUM_LENGTH_CODES];
    let largest_index =
        |pix: u32| (1 << cache_bits_max) | hash_pix(pix, 32 - cache_bits_max) as usize;

    let mut rest = argb;
    for &v in refs.iter() {
        let (pixels, after) = rest.split_at_checked(v.length()).ok_or(Bug)?;
        rest = after;
        if let PixOrCopy::Copy { len, .. } = v {
            *lengths.at_mut(prefix_encode(len.into()).code)? += 1;
            let mut argb_prev = None;
            for &pix in pixels {
                if argb_prev != Some(pix) {
                    argb_prev = Some(pix);
                    let mut index = largest_index(pix);
                    while index > 1 {
                        colors.put(index, pix)?;
                        index >>= 1;
                    }
                }
            }
        } else {
            let pix = pixels.at(0)?;
            literals.add(pix);
            let mut index = largest_index(pix);
            for cached in &mut cached {
                if core::mem::replace(colors.at_mut(index)?, pix) == pix {
                    *hits.at_mut(index)? += 1;
                    cached.add(pix);
                }
                index >>= 1;
            }
        }
    }

    let mut best_cache_bits = 0;
    let mut entropy_min = u64::MAX;
    let by_size = core::iter::once(&EMPTY).chain(cached.iter().rev());
    for (cached, bits) in by_size.zip(0..) {
        let mut histo = Histogram::new(bits)?;
        histo.literal.write_at(0, &literals.green)?;
        histo.literal.write_at(NUM_LITERAL_CODES, &lengths)?;
        if bits > 0 {
            let hits = hits.sub(1 << bits..2 << bits)?;
            histo
                .literal
                .write_at(NUM_LITERAL_CODES + NUM_LENGTH_CODES, hits)?;
        }
        histo.red = literals.red;
        histo.blue = literals.blue;
        histo.alpha = literals.alpha;
        for (left, cached) in [
            (histo.literal.as_mut_slice(), &cached.green),
            (&mut histo.red, &cached.red),
            (&mut histo.blue, &cached.blue),
            (&mut histo.alpha, &cached.alpha),
        ] {
            for (left, cached) in left.iter_mut().zip(cached) {
                *left -= cached;
            }
        }
        let entropy = histo.estimate_bits()?;
        if bits == 0 || entropy < entropy_min {
            entropy_min = entropy;
            best_cache_bits = bits;
        }
    }
    Ok(best_cache_bits)
}

/// `BackwardRefsWithLocalCache`: replaces the literals that a colour cache holds.
fn backward_refs_with_local_cache(
    argb: &[u32],
    cache_bits: u32,
    refs: &mut BackwardRefs,
) -> Result<(), EncodeError> {
    let mut hashers = ColorCache::new(cache_bits)?;
    let mut pixels = argb.iter();
    for v in &mut refs.0 {
        match *v {
            PixOrCopy::Literal(argb_literal) => {
                match hashers.contains(argb_literal)? {
                    Some(ix) => *v = PixOrCopy::CacheIdx(ix),
                    None => hashers.insert(argb_literal)?,
                }
                pixels.next();
            }
            PixOrCopy::Copy { len, .. } => {
                for &pixel in pixels.by_ref().take(len.into()) {
                    hashers.insert(pixel)?;
                }
            }
            PixOrCopy::CacheIdx(_) => return Err(Bug.into()),
        }
    }
    Ok(())
}

/// `VP8LLZ77Type`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Lz77 {
    Standard,
    Rle,
    Box,
}

/// `VP8LGetBackwardReferences`: leaves in `refs_best` the cheapest of what the `lz77_types_to_try` make of `argb`, and
/// returns the size of the colour cache that goes with it, at most `cache_bits_max`. `refs_tmp` is working memory.
pub(crate) fn get_backward_references(
    width: usize,
    argb: &[u32],
    quality: i32,
    lz77_types_to_try: &[Lz77],
    cache_bits_max: u32,
    hash_chain: &HashChain,
    refs_best: &mut BackwardRefs,
    refs_tmp: &mut BackwardRefs,
) -> Result<u32, EncodeError> {
    let mut lz77_type_best = None;
    let mut bit_cost_best = u64::MAX;
    let mut cache_bits_best = 0;
    let mut hash_chain_box = None;

    for &lz77_type in lz77_types_to_try {
        // The colour cache comes afterwards: the best LZ77 with one would not be very different.
        match lz77_type {
            Lz77::Rle => backward_references_rle(width, argb, refs_tmp)?,
            Lz77::Standard => backward_references_lz77(argb, hash_chain, refs_tmp)?,
            Lz77::Box => backward_references_lz77_box(
                width,
                argb,
                hash_chain,
                hash_chain_box.insert(HashChain::new(argb.len())?),
                refs_tmp,
            )?,
        }

        let cache_bits = calculate_best_cache_size(argb, refs_tmp, cache_bits_max)?;
        if cache_bits > 0 {
            backward_refs_with_local_cache(argb, cache_bits, refs_tmp)?;
        }
        let bit_cost = Histogram::from_refs(refs_tmp, cache_bits)?.estimate_bits()?;
        if bit_cost < bit_cost_best {
            core::mem::swap(refs_tmp, refs_best);
            bit_cost_best = bit_cost;
            lz77_type_best = Some(lz77_type);
            cache_bits_best = cache_bits;
        }
    }

    let hash_chain_best = match lz77_type_best {
        Some(Lz77::Standard) => Some(hash_chain),
        Some(Lz77::Box) => hash_chain_box.as_ref(),
        _ => None,
    };
    if let Some(hash_chain) = hash_chain_best
        && quality >= 25
    {
        backward_references_trace_backwards(
            width,
            argb,
            cache_bits_best,
            hash_chain,
            refs_best,
            refs_tmp,
        )?;
        let bit_cost_trace = Histogram::from_refs(refs_tmp, cache_bits_best)?.estimate_bits()?;
        if bit_cost_trace < bit_cost_best {
            core::mem::swap(refs_tmp, refs_best);
        }
    }

    backward_references_2d_locality(width, refs_best);
    Ok(cache_bits_best)
}
