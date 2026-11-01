//! `backward_references_enc.c`: turns pixels into literals, color cache hits and copies of earlier pixels.

use super::Quality;
use super::backward_references_cost::backward_references_trace_backwards;
use super::histogram::Histogram;
use super::lossless::{prefix_encode, vector_mismatch};
use crate::Result;
use crate::util::{Bug, ByteHistogram, Checked, SliceExt, increment, try_vec};
use crate::vp8l::color_cache::{ColorCache, hash_pix};
use crate::vp8l::common::{
    CODE_TO_PLANE, CODE_TO_PLANE_CODES, FIRST_CACHE_CODE, NUM_LENGTH_CODES, NUM_LITERAL_CODES,
};

/// The format allows 11.
pub(super) const MAX_COLOR_CACHE_BITS: u32 = 10;

const HASH_BITS: u32 = 18;
const HASH_SIZE: usize = 1 << HASH_BITS;

const MAX_LENGTH_BITS: u32 = 12;
const WINDOW_SIZE_BITS: u32 = 20;
/// The longest copy.
pub(super) const MAX_LENGTH: usize = (1 << MAX_LENGTH_BITS) - 1;
/// The longest distance: the codes of the nearest pixels take up part of the range.
const WINDOW_SIZE: usize = (1 << WINDOW_SIZE_BITS) - CODE_TO_PLANE_CODES;

/// From this length on a copy is cheaper than literals.
const MIN_LENGTH: usize = 4;

#[derive(Clone, Copy)]
pub(super) enum PixOrCopy {
    Literal(u32),
    CacheIdx(u32),
    Copy { distance: u32, len: u16 },
}

impl PixOrCopy {
    /// How many pixels it stands for.
    #[inline]
    pub(super) fn length(self) -> usize {
        match self {
            Self::Literal(_) | Self::CacheIdx(_) => 1,
            Self::Copy { len, .. } => len.into(),
        }
    }

    #[inline]
    fn copy(distance: usize, len: usize) -> Checked<Self> {
        debug_assert!(distance <= WINDOW_SIZE && len <= MAX_LENGTH);
        Ok(Self::Copy {
            distance: distance.try_into().map_err(|_| Bug)?,
            len: len.try_into().map_err(|_| Bug)?,
        })
    }
}

#[derive(Default)]
pub(super) struct BackwardRefs(Vec<PixOrCopy>);

impl BackwardRefs {
    #[inline]
    pub(super) fn push(&mut self, v: PixOrCopy) -> Result<()> {
        if self.0.len() == self.0.capacity() {
            self.0.try_reserve(1)?;
        }
        self.0.push(v);
        Ok(())
    }

    #[inline]
    pub(super) fn push_copy(&mut self, distance: usize, len: usize) -> Result<()> {
        self.push(PixOrCopy::copy(distance, len)?)
    }

    pub(super) fn clear(&mut self) {
        self.0.clear();
    }

    pub(super) fn iter(&self) -> core::slice::Iter<'_, PixOrCopy> {
        self.0.iter()
    }
}

/// The inverse of `CODE_TO_PLANE`. The places left at 255 are those of the pixel itself and of later ones.
static PLANE_TO_CODE_LUT: [u8; 128] = {
    let mut lut = [255; 128];
    let mut planes: &[u8] = &CODE_TO_PLANE;
    let mut code = 0;
    while let [plane, rest @ ..] = planes {
        if let Some((_, [entry, ..])) = lut.split_at_mut_checked(*plane as usize) {
            *entry = code;
        }
        code += 1;
        planes = rest;
    }
    lut
};

/// `VP8LDistanceToPlaneCode`: the distances to the pixels nearest in two dimensions get the lowest codes.
#[inline]
pub(super) fn distance_to_plane_code(width: usize, dist: u32) -> u32 {
    let width = width.max(1) as u32;
    let yoffset = dist / width;
    let xoffset = dist - yoffset * width;
    let index = if xoffset <= 8 && yoffset < 8 {
        yoffset * 16 + 8 - xoffset
    } else if xoffset + 8 > width && yoffset < 7 {
        (yoffset + 1) * 16 + 8 + (width - xoffset)
    } else {
        return dist + CODE_TO_PLANE_CODES as u32;
    };
    match PLANE_TO_CODE_LUT.get(index as usize) {
        Some(&code) => u32::from(code) + 1,
        None => dist + CODE_TO_PLANE_CODES as u32,
    }
}

/// The length of the match, up to `max_limit`, or 0 if it is quick to see that it is `best_len_match` or less.
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

/// `VP8LHashChain`: the best copy that can start at each pixel.
pub(super) struct HashChain {
    /// The distance in the upper 20 bits, the length in the lower 12.
    distance_length: Vec<u32>,
}

/// The end of a chain of positions with the same hash.
const NO_POSITION: u32 = u32::MAX;

/// `GetPixPairHash64`
#[inline]
const fn pix_pair_hash(argb0: u32, argb1: u32) -> usize {
    let key = argb1
        .wrapping_mul(0xc6a4_a793)
        .wrapping_add(argb0.wrapping_mul(0x5bd1_e996));
    (key >> (32 - HASH_BITS)) as usize
}

/// `GetMaxItersForQuality`: how many positions of a hash chain to look at.
const fn max_iters_for_quality(quality: Quality) -> i32 {
    let quality = quality as i32;
    8 + (quality * quality) / 128
}

/// `GetWindowSizeForHashChain`: how far back to look. Above a quality of 75 libwebp goes as far as `WINDOW_SIZE`.
fn window_size_for_hash_chain(quality: Quality, width: usize) -> usize {
    let max_window_size = match quality {
        Quality::Image => width << 8,
        Quality::AlphaPlane => width << 6,
        Quality::Palette => width << 4,
    };
    max_window_size.min(WINDOW_SIZE)
}

#[inline]
const fn pack(distance: usize, length: usize) -> u32 {
    ((distance as u32) << MAX_LENGTH_BITS) | length as u32
}

impl HashChain {
    /// For `size` pixels, none of which has a copy yet.
    fn zeroed(size: usize) -> Result<Self> {
        Ok(Self {
            distance_length: try_vec(0, size)?,
        })
    }

    /// `VP8LHashChainFindOffset`
    #[inline]
    pub(super) fn distance(&self, base_position: usize) -> Checked<usize> {
        Ok((self.distance_length.at(base_position)? >> MAX_LENGTH_BITS) as usize)
    }

    /// `VP8LHashChainFindLength`
    #[inline]
    pub(super) fn length(&self, base_position: usize) -> Checked<usize> {
        Ok((self.distance_length.at(base_position)? as usize) & MAX_LENGTH)
    }

    /// `VP8LHashChainFindCopy`: the distance and the length.
    #[inline]
    pub(super) fn copy_at(&self, base_position: usize) -> Checked<(usize, usize)> {
        let distance_length = self.distance_length.at(base_position)?;
        Ok((
            (distance_length >> MAX_LENGTH_BITS) as usize,
            distance_length as usize & MAX_LENGTH,
        ))
    }

    #[inline]
    fn set(&mut self, position: usize, distance: usize, length: usize) -> Checked {
        self.distance_length.put(position, pack(distance, length))
    }

    /// `VP8LHashChainFill`
    pub(super) fn new(quality: Quality, argb: &[u32], width: usize) -> Result<Self> {
        let size = argb.len();
        let iter_max = max_iters_for_quality(quality);
        let window_size = window_size_for_hash_chain(quality, width);
        let mut hash_chain = Self::zeroed(size)?;
        if size <= 2 {
            return Ok(hash_chain);
        }
        // At first `chain` links each position to the previous one with the same hash.
        let chain = hash_chain.distance_length.as_mut_slice();

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
                    // All pairs in a run of one color hash alike, so hash the color and what is left of the run.
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
                        link(chain, pos, pix_pair_hash(color, len as u32))?;
                        pos += 1;
                        len -= 1;
                    }
                    argb_comp = false;
                } else {
                    link(chain, pos, pix_pair_hash(argb.at(pos)?, argb.at(pos + 1)?))?;
                    pos += 1;
                    argb_comp = argb_comp_next;
                }
            }
            let hash_code = pix_pair_hash(argb.at(pos)?, argb.at(pos + 1)?);
            chain.put(pos, hash_to_first_index.at(hash_code)?)?;
        }

        // From the end, the links give way to each position's best match. The first and last pixels have none.
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
            if base_position >= width {
                let curr_length =
                    find_match_length(argb, base_position - width, base_position, 0, max_len)?;
                if curr_length > best_length {
                    best_length = curr_length;
                    best_distance = width;
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
                chain.put(base_position, pack(best_distance, best_length))?;
                base_position -= 1;
                if best_distance == 0 || base_position == 0 {
                    break;
                }
                if base_position < best_distance
                    || argb.at(base_position - best_distance)? != argb.at(base_position)?
                {
                    break;
                }
                // A match of the longest length may have a nearer one just as long, unless it is as near as can be.
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
        Ok(hash_chain)
    }
}

/// Copies from the pixel before and the pixel above only.
fn backward_references_rle(width: usize, argb: &[u32], refs: &mut BackwardRefs) -> Result<()> {
    let pix_count = argb.len();
    refs.clear();
    refs.push(PixOrCopy::Literal(argb.at(0)?))?;
    let mut i = 1;
    while i < pix_count {
        let max_len = (pix_count - i).min(MAX_LENGTH);
        let rle_len = find_match_length(argb, i, i - 1, 0, max_len)?;
        let prev_row_len = if i < width {
            0
        } else {
            find_match_length(argb, i, i - width, 0, max_len)?
        };
        if rle_len >= prev_row_len && rle_len >= MIN_LENGTH {
            refs.push_copy(1, rle_len)?;
            i += rle_len;
        } else if prev_row_len >= MIN_LENGTH {
            refs.push_copy(width, prev_row_len)?;
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
) -> Result<()> {
    let pix_count = argb.len();
    refs.clear();
    let mut i = 0;
    while i < pix_count {
        let (distance, mut len) = hash_chain.copy_at(i)?;
        if len >= MIN_LENGTH {
            let len_ini = len;
            let mut max_reach = 0;
            let j_max = (i + len_ini).min(pix_count - 1);
            // Rather than the longest copy from here, take the one after which the next copy gets furthest.
            for j in i + 1..=j_max {
                let len_j = hash_chain.length(j)?;
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
            refs.push_copy(distance, len)?;
        }
        i += len;
    }
    Ok(())
}

const WINDOW_DISTANCES_SIZE_MAX: usize = 32;

/// An LZ77 whose distances all are among the 32 cheapest. It fills `hash_chain` with the best copies at those.
fn backward_references_lz77_box(
    width: usize,
    argb: &[u32],
    hash_chain_best: &HashChain,
    hash_chain: &mut HashChain,
    refs: &mut BackwardRefs,
) -> Result<()> {
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
    let mut by_plane_code = [0usize; WINDOW_DISTANCES_SIZE_MAX];
    for y in 0..=6isize {
        for x in -6..=6isize {
            let distance = y * width as isize + x;
            if distance <= 0 {
                continue;
            }
            let plane_code = distance_to_plane_code(width, distance as u32) - 1;
            if let Some(slot) = by_plane_code.get_mut(plane_code as usize) {
                *slot = distance as usize;
            }
        }
    }
    let mut window_distances = [0usize; WINDOW_DISTANCES_SIZE_MAX];
    let mut window_distances_size = 0;
    for distance in by_plane_code.into_iter().filter(|&distance| distance != 0) {
        window_distances.put(window_distances_size, distance)?;
        window_distances_size += 1;
    }
    let window_distances = window_distances.sub(..window_distances_size)?;
    // Those that lead to a pixel which none of them leads to from the pixel before.
    let mut window_distances_new = [0usize; WINDOW_DISTANCES_SIZE_MAX];
    let mut window_distances_new_size = 0;
    for &distance in window_distances {
        if !window_distances.iter().any(|&other| distance == other + 1) {
            window_distances_new.put(window_distances_new_size, distance)?;
            window_distances_new_size += 1;
        }
    }
    let window_distances_new = window_distances_new.sub(..window_distances_new_size)?;

    hash_chain.set(0, 0, 0)?;
    let (mut best_distance_prev, mut best_length_prev) = (0, 0);
    for i in 1..pix_count {
        let (mut best_distance, mut best_length) = hash_chain_best.copy_at(i)?;
        // A match of the longest length within the window cannot be improved on.
        if best_length < MAX_LENGTH || !window_distances.contains(&best_distance) {
            // Start from the rest of the previous pixel's match: only pixels it could not reach are worth a look.
            let use_prev = best_length_prev > 1 && best_length_prev < MAX_LENGTH;
            let distances = if use_prev {
                best_length = best_length_prev - 1;
                best_distance = best_distance_prev;
                window_distances_new
            } else {
                best_length = 0;
                best_distance = 0;
                window_distances
            };
            for &distance in distances {
                let Some(mut source) = i.checked_sub(distance) else {
                    continue;
                };
                if argb.at(source)? != argb.at(i)? {
                    continue;
                }
                // Go from run to run of the same color.
                let mut curr_length = 0;
                let mut j = i;
                loop {
                    let counts_source = usize::from(counts.at(source)?);
                    let counts_j = usize::from(counts.at(j)?);
                    if counts_source != counts_j {
                        curr_length += counts_source.min(counts_j);
                        break;
                    }
                    curr_length += counts_source;
                    source += counts_source;
                    j += counts_source;
                    if curr_length > MAX_LENGTH
                        || j >= pix_count
                        || argb.at(source)? != argb.at(j)?
                    {
                        break;
                    }
                }
                if best_length < curr_length {
                    best_distance = distance;
                    if curr_length >= MAX_LENGTH {
                        best_length = MAX_LENGTH;
                        break;
                    }
                    best_length = curr_length;
                }
            }
        }

        if best_length <= MIN_LENGTH {
            (best_distance, best_length) = (0, 0);
        }
        hash_chain.set(i, best_distance, best_length)?;
        best_distance_prev = best_distance;
        best_length_prev = best_length;
    }

    backward_references_lz77(argb, hash_chain, refs)
}

/// `BackwardReferences2DLocality`: replaces the distances by their codes.
fn backward_references_2d_locality(width: usize, refs: &mut BackwardRefs) {
    for v in &mut refs.0 {
        if let PixOrCopy::Copy { distance, .. } = v {
            *distance = distance_to_plane_code(width, *distance);
        }
    }
}

/// How often each value of each channel occurs in some pixels.
#[derive(Clone)]
struct LiteralCounts {
    blue: ByteHistogram,
    green: ByteHistogram,
    red: ByteHistogram,
    alpha: ByteHistogram,
}

impl LiteralCounts {
    #[inline]
    fn add(&mut self, pix: u32) {
        let [b, g, r, a] = pix.to_le_bytes();
        increment(&mut self.blue, b);
        increment(&mut self.green, g);
        increment(&mut self.red, r);
        increment(&mut self.alpha, a);
    }
}

/// Key `key` of the cache of `bits` bits is at `(1 << bits) | key`, so half an index is the next smaller cache's.
type PerCacheKey = [u32; 2 << MAX_COLOR_CACHE_BITS];

/// The size of color cache, up to `cache_bits_max`, with which `refs` have the lowest entropy. 0 is none.
fn calculate_best_cache_size(
    argb: &[u32],
    quality: Quality,
    refs: &BackwardRefs,
    cache_bits_max: u32,
) -> Result<u32> {
    let cache_bits_max = match quality {
        Quality::Palette => 0,
        Quality::AlphaPlane | Quality::Image => cache_bits_max,
    };
    if cache_bits_max == 0 {
        return Ok(0);
    }
    if cache_bits_max > MAX_COLOR_CACHE_BITS {
        return Err(Bug.into());
    }
    const EMPTY: LiteralCounts = LiteralCounts {
        blue: [0; 256],
        green: [0; 256],
        red: [0; 256],
        alpha: [0; 256],
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
            histo.literal.write_at(FIRST_CACHE_CODE, hits)?;
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

/// `BackwardRefsWithLocalCache`: replaces the literals that a color cache holds.
fn backward_refs_with_local_cache(
    argb: &[u32],
    cache_bits: u32,
    refs: &mut BackwardRefs,
) -> Result<()> {
    let mut color_cache = ColorCache::new(cache_bits)?;
    let mut pixels = argb.iter();
    for v in &mut refs.0 {
        match *v {
            PixOrCopy::Literal(argb_literal) => {
                if let Some(idx) = color_cache.hit_or_insert(argb_literal)? {
                    *v = PixOrCopy::CacheIdx(idx);
                }
                pixels.next();
            }
            PixOrCopy::Copy { len, .. } => {
                for &pixel in pixels.by_ref().take(len.into()) {
                    color_cache.insert(pixel)?;
                }
            }
            PixOrCopy::CacheIdx(_) => return Err(Bug.into()),
        }
    }
    Ok(())
}

/// `VP8LLZ77Type`
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Lz77 {
    Standard,
    Rle,
    Box,
}

/// `VP8LGetBackwardReferences`: the cheapest of `lz77_types_to_try` goes to `refs_best`. Returns its color cache bits.
pub(super) fn best_backward_refs(
    width: usize,
    argb: &[u32],
    quality: Quality,
    lz77_types_to_try: &[Lz77],
    cache_bits_max: u32,
    hash_chain: &HashChain,
    refs_best: &mut BackwardRefs,
    refs_tmp: &mut BackwardRefs,
) -> Result<u32> {
    let mut lz77_type_best = None;
    let mut bit_cost_best = u64::MAX;
    let mut cache_bits_best = 0;
    let mut hash_chain_box = None;

    for &lz77_type in lz77_types_to_try {
        // The color cache comes afterwards: the best LZ77 with one would not be very different.
        match lz77_type {
            Lz77::Rle => backward_references_rle(width, argb, refs_tmp)?,
            Lz77::Standard => backward_references_lz77(argb, hash_chain, refs_tmp)?,
            Lz77::Box => backward_references_lz77_box(
                width,
                argb,
                hash_chain,
                hash_chain_box.insert(HashChain::zeroed(argb.len())?),
                refs_tmp,
            )?,
        }

        let cache_bits = calculate_best_cache_size(argb, quality, refs_tmp, cache_bits_max)?;
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
    let is_worth_tracing = match quality {
        Quality::Palette => false,
        Quality::AlphaPlane | Quality::Image => true,
    };
    if let Some(hash_chain) = hash_chain_best
        && is_worth_tracing
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
