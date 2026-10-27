//! `vp8l_enc.c`: the lossless encoder, at `method` 4.

mod backward_references;
mod backward_references_cost;
mod bit_writer;
mod histogram;
mod huffman;
mod lossless;
mod palette;
mod predictor;
mod predictors;

use self::backward_references::{
    BackwardRefs, HashChain, Lz77, MAX_COLOR_CACHE_BITS, PixOrCopy, get_backward_references,
};
pub(crate) use self::bit_writer::BitWriter;
use self::histogram::{
    Histogram, add_costs, bits_entropy, get_histo_image_symbols, histogram_num_codes,
};
use self::huffman::{Scratch, Symbol, Token, create_compressed_huffman_tree, create_huffman_tree};
use self::lossless::{
    LOG_2_PRECISION_BITS, bits_log2_floor, bundle_color_map, fast_log2, prefix_encode,
    subtract_green_from_blue_and_red,
};
use self::palette::{Palette, get_color_palette, palette_sort_minimize_deltas};
use self::predictor::{color_space_transform, optimize_sampling, residual_image};
use super::format_constants::{
    CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, IMAGE_SIZE_BITS, MAGIC_BYTE, MAX_HUFFMAN_BITS,
    MAX_PALETTE_SIZE, MAX_TRANSFORM_BITS, MIN_HUFFMAN_BITS, MIN_TRANSFORM_BITS, NUM_DISTANCE_CODES,
    NUM_LENGTH_CODES, NUM_LITERAL_CODES, NUM_TRANSFORM_BITS, TransformType, VERSION, VERSION_BITS,
    sub_sample_size,
};
use crate::container::Image;
use crate::util::{Bug, Checked, SliceExt, try_vec};
use crate::{Error, Input};
use bun_alloc::AllocError;
use predictors::sub_pixels;

/// The most tiles that can each have prefix codes of their own.
const MAX_HUFF_IMAGE_SIZE: usize = 2600;
/// With more tiles than this it takes too long to find the best predictors.
const MAX_PREDICTOR_IMAGE_SIZE: usize = 1 << 14;

/// What of `WebPConfig` differs between an image and an alpha plane.
#[derive(Clone, Copy)]
pub(crate) struct Config {
    pub(crate) quality: i32,
    /// Keep the colour of transparent pixels.
    pub(crate) exact: bool,
}

// Palette

/// The sets of transforms that are considered.
#[derive(Clone, Copy, PartialEq, Eq)]
enum EntropyIx {
    Direct,
    Spatial,
    SubGreen,
    SpatialSubGreen,
    Palette,
}

type HistogramBuckets = [u32; 256];

/// The values of each channel as they are, less the pixel before (`pred`), and less green.
struct Histograms {
    alpha: HistogramBuckets,
    alpha_pred: HistogramBuckets,
    green: HistogramBuckets,
    green_pred: HistogramBuckets,
    red: HistogramBuckets,
    red_pred: HistogramBuckets,
    blue: HistogramBuckets,
    blue_pred: HistogramBuckets,
    red_sub_green: HistogramBuckets,
    red_pred_sub_green: HistogramBuckets,
    blue_sub_green: HistogramBuckets,
    blue_pred_sub_green: HistogramBuckets,
    palette: HistogramBuckets,
}

#[inline]
fn increment(buckets: &mut HistogramBuckets, value: u8) {
    if let Some(count) = buckets.get_mut(usize::from(value)) {
        *count += 1;
    }
}

const fn hash_pix(pix: u32) -> u8 {
    (((pix as u64 + (pix >> 19) as u64).wrapping_mul(0x39c5_fba7) & 0xffff_ffff) >> 24) as u8
}

/// Estimates which transforms suit the image best. Also returns whether red and blue are always 0 after them.
fn analyze_entropy(
    argb: &[u32],
    width: usize,
    height: usize,
    palette_size: Option<usize>,
    transform_bits: u32,
) -> Checked<(EntropyIx, bool)> {
    // The indices of a small palette are packed several to a pixel, which in practice nothing beats.
    if palette_size.is_some_and(|size| size <= 16) {
        return Ok((EntropyIx::Palette, true));
    }

    const EMPTY: HistogramBuckets = [0; 256];
    let mut histo = Box::new(Histograms {
        alpha: EMPTY,
        alpha_pred: EMPTY,
        green: EMPTY,
        green_pred: EMPTY,
        red: EMPTY,
        red_pred: EMPTY,
        blue: EMPTY,
        blue_pred: EMPTY,
        red_sub_green: EMPTY,
        red_pred_sub_green: EMPTY,
        blue_sub_green: EMPTY,
        blue_pred_sub_green: EMPTY,
        palette: EMPTY,
    });
    let mut pix_prev = argb.at(0)?;
    let mut prev_row: &[u32] = &[];
    for curr_row in argb.chunks_exact(width.max(1)) {
        for (x, &pix) in curr_row.iter().enumerate() {
            let pix_diff = sub_pixels(pix, pix_prev);
            pix_prev = pix;
            // A backward reference is likely to take care of it.
            if pix_diff == 0 || prev_row.get(x) == Some(&pix) {
                continue;
            }
            let [b, g, r, a] = pix.to_le_bytes();
            increment(&mut histo.alpha, a);
            increment(&mut histo.red, r);
            increment(&mut histo.green, g);
            increment(&mut histo.blue, b);
            increment(&mut histo.red_sub_green, r.wrapping_sub(g));
            increment(&mut histo.blue_sub_green, b.wrapping_sub(g));
            let [b, g, r, a] = pix_diff.to_le_bytes();
            increment(&mut histo.alpha_pred, a);
            increment(&mut histo.red_pred, r);
            increment(&mut histo.green_pred, g);
            increment(&mut histo.blue_pred, b);
            increment(&mut histo.red_pred_sub_green, r.wrapping_sub(g));
            increment(&mut histo.blue_pred_sub_green, b.wrapping_sub(g));
            // The entropy of a hash stands for that of the palette index.
            increment(&mut histo.palette, hash_pix(pix));
        }
        prev_row = curr_row;
    }

    // All the differences of 0 were skipped, but some are likely to remain.
    increment(&mut histo.red_pred_sub_green, 0);
    increment(&mut histo.blue_pred_sub_green, 0);
    increment(&mut histo.red_pred, 0);
    increment(&mut histo.green_pred, 0);
    increment(&mut histo.blue_pred, 0);
    increment(&mut histo.alpha_pred, 0);

    let alpha = bits_entropy(&histo.alpha);
    let green = bits_entropy(&histo.green);
    let alpha_pred = bits_entropy(&histo.alpha_pred);
    let green_pred = bits_entropy(&histo.green_pred);
    // The transforms' own cost matters for small images: a predictor or 24 bits per tile, some 8 bits per colour.
    let num_tiles =
        (sub_sample_size(width, transform_bits) * sub_sample_size(height, transform_bits)) as u64;
    let modes = [
        (
            EntropyIx::Direct,
            add_costs([
                alpha,
                bits_entropy(&histo.red),
                green,
                bits_entropy(&histo.blue),
            ]),
            &histo.red,
            &histo.blue,
        ),
        (
            EntropyIx::Spatial,
            add_costs([
                alpha_pred,
                bits_entropy(&histo.red_pred),
                green_pred,
                bits_entropy(&histo.blue_pred),
                num_tiles * u64::from(fast_log2(14)),
            ]),
            &histo.red_pred,
            &histo.blue_pred,
        ),
        (
            EntropyIx::SubGreen,
            add_costs([
                alpha,
                bits_entropy(&histo.red_sub_green),
                green,
                bits_entropy(&histo.blue_sub_green),
            ]),
            &histo.red_sub_green,
            &histo.blue_sub_green,
        ),
        (
            EntropyIx::SpatialSubGreen,
            add_costs([
                alpha_pred,
                bits_entropy(&histo.red_pred_sub_green),
                green_pred,
                bits_entropy(&histo.blue_pred_sub_green),
                num_tiles * u64::from(fast_log2(24)),
            ]),
            &histo.red_pred_sub_green,
            &histo.blue_pred_sub_green,
        ),
        (
            EntropyIx::Palette,
            add_costs([
                bits_entropy(&histo.palette),
                (palette_size.unwrap_or(0) as u64 * 8) << LOG_2_PRECISION_BITS,
            ]),
            &histo.red,
            &histo.blue,
        ),
    ];
    let num_modes = modes.len() - usize::from(palette_size.is_none());
    let [mut best, rest @ ..] = modes;
    for mode in rest.into_iter().take(num_modes - 1) {
        if best.1 > mode.1 {
            best = mode;
        }
    }
    let (min_entropy_ix, _, red_histo, blue_histo) = best;
    let red_and_blue_always_zero = red_histo
        .iter()
        .zip(blue_histo)
        .skip(1)
        .all(|(&red, &blue)| red | blue == 0);
    Ok((min_entropy_ix, red_and_blue_always_zero))
}

/// Clamps the tile size to its range, to at most `image_size_max` tiles, and to no more than a single tile takes.
fn clamp_bits(
    width: usize,
    height: usize,
    bits: u32,
    min_bits: u32,
    max_bits: u32,
    image_size_max: usize,
) -> u32 {
    let image_size = |bits| sub_sample_size(width, bits) * sub_sample_size(height, bits);
    let mut bits = bits.clamp(min_bits, max_bits);
    while bits < max_bits && image_size(bits) > image_size_max {
        bits += 1;
    }
    while bits > min_bits && image_size(bits - 1) == 1 {
        bits -= 1;
    }
    bits
}

fn get_histo_bits(use_palette: bool, width: usize, height: usize) -> u32 {
    // 9 or 7, less the `method`.
    let histo_bits = if use_palette { 5 } else { 3 };
    clamp_bits(
        width,
        height,
        histo_bits,
        MIN_HUFFMAN_BITS,
        MAX_HUFFMAN_BITS,
        MAX_HUFF_IMAGE_SIZE,
    )
}

fn get_transform_bits(histo_bits: u32) -> u32 {
    histo_bits.min(5)
}

// Prefix codes

/// Five prefix codes per histogram: green with lengths and cache indices, red, blue, alpha, distances.
struct HuffmanCodes {
    symbols: Vec<Symbol>,
    /// How many symbols the five codes of a histogram have in all.
    group_size: usize,
}

/// The five prefix codes of one histogram.
#[derive(Clone, Copy)]
struct CodeGroup<'a> {
    literal: &'a [Symbol],
    red: &'a [Symbol; NUM_LITERAL_CODES],
    blue: &'a [Symbol; NUM_LITERAL_CODES],
    alpha: &'a [Symbol; NUM_LITERAL_CODES],
    distance: &'a [Symbol; NUM_DISTANCE_CODES],
}

const GROUP_SIZE_WITHOUT_LITERAL: usize = 3 * NUM_LITERAL_CODES + NUM_DISTANCE_CODES;

impl HuffmanCodes {
    /// `GetHuffBitLengthsAndCodes`
    fn new(histogram_image: &mut [Histogram], cache_bits: u32) -> Result<Self, Error> {
        let num_literal_symbols = histogram_num_codes(cache_bits);
        let group_size = num_literal_symbols + GROUP_SIZE_WITHOUT_LITERAL;
        let mut symbols = try_vec(Symbol::default(), group_size * histogram_image.len())?;
        let mut scratch = Scratch::new(num_literal_symbols)?;
        for (histo, group) in histogram_image
            .iter_mut()
            .zip(symbols.chunks_exact_mut(group_size))
        {
            for (population, code) in histo.populations_mut().into_iter().zip(split_group(group)?) {
                create_huffman_tree(population, 15, &mut scratch, code)?;
            }
        }
        Ok(Self {
            symbols,
            group_size,
        })
    }

    fn group(&self, index: usize) -> Checked<CodeGroup<'_>> {
        let group = self.symbols.sub(index * self.group_size..)?;
        let num_literal_symbols = self.group_size - GROUP_SIZE_WITHOUT_LITERAL;
        Ok(CodeGroup {
            literal: group.sub(..num_literal_symbols)?,
            red: group.array_at(num_literal_symbols)?,
            blue: group.array_at(num_literal_symbols + NUM_LITERAL_CODES)?,
            alpha: group.array_at(num_literal_symbols + 2 * NUM_LITERAL_CODES)?,
            distance: group.array_at(num_literal_symbols + 3 * NUM_LITERAL_CODES)?,
        })
    }

    /// Writes the codes of the first `num_groups` histograms. After that a code with a single symbol takes no bits.
    fn store(&mut self, bw: &mut BitWriter, num_groups: usize) -> Result<(), Error> {
        let mut scratch = Scratch::new(CODE_LENGTH_CODES)?;
        let mut tokens = Vec::new();
        tokens
            .try_reserve_exact(self.group_size - GROUP_SIZE_WITHOUT_LITERAL)
            .map_err(|_| AllocError)?;
        for group in self
            .symbols
            .chunks_exact_mut(self.group_size)
            .take(num_groups)
        {
            for code in split_group(group)? {
                store_huffman_code(bw, &mut scratch, &mut tokens, code)?;
                clear_huffman_tree_if_only_one_symbol(code);
            }
        }
        Ok(())
    }
}

fn split_group(group: &mut [Symbol]) -> Checked<[&mut [Symbol]; 5]> {
    let num_literal_symbols = group
        .len()
        .checked_sub(GROUP_SIZE_WITHOUT_LITERAL)
        .ok_or(Bug)?;
    let (literal, rest) = group.halves_mut(num_literal_symbols)?;
    let (red, rest) = rest.halves_mut(NUM_LITERAL_CODES)?;
    let (blue, rest) = rest.halves_mut(NUM_LITERAL_CODES)?;
    let (alpha, distance) = rest.halves_mut(NUM_LITERAL_CODES)?;
    Ok([literal, red, blue, alpha, distance])
}

fn store_huffman_tree_of_huffman_tree_to_bit_mask(
    bw: &mut BitWriter,
    code_length_code: &[Symbol; CODE_LENGTH_CODES],
) -> Checked {
    let mut lengths = [0; CODE_LENGTH_CODES];
    for (length, index) in lengths.iter_mut().zip(CODE_LENGTH_CODE_ORDER) {
        *length = code_length_code.at(index.into())?.length;
    }
    let codes_to_store = lengths
        .iter()
        .rposition(|&length| length != 0)
        .map_or(4, |last| (last + 1).max(4));
    bw.put_bits(codes_to_store as u32 - 4, 4);
    for &length in lengths.iter().take(codes_to_store) {
        bw.put_bits(length.into(), 3);
    }
    Ok(())
}

fn clear_huffman_tree_if_only_one_symbol(huffman_code: &mut [Symbol]) {
    if huffman_code
        .iter()
        .filter(|symbol| symbol.length != 0)
        .count()
        <= 1
    {
        huffman_code.fill(Symbol::default());
    }
}

fn store_huffman_tree_to_bit_mask(
    bw: &mut BitWriter,
    tokens: &[Token],
    huffman_code: &[Symbol; CODE_LENGTH_CODES],
) -> Checked {
    for token in tokens {
        write_huffman_code(bw, huffman_code.at(token.code.into())?);
        match token.code {
            16 => bw.put_bits(token.extra_bits.into(), 2),
            17 => bw.put_bits(token.extra_bits.into(), 3),
            18 => bw.put_bits(token.extra_bits.into(), 7),
            _ => {}
        }
    }
    Ok(())
}

fn store_full_huffman_code(
    bw: &mut BitWriter,
    scratch: &mut Scratch,
    tokens: &mut Vec<Token>,
    tree: &[Symbol],
) -> Checked {
    bw.put_bits(0, 1);
    create_compressed_huffman_tree(tree, tokens);
    let mut histogram = [0u32; CODE_LENGTH_CODES];
    for token in tokens.iter() {
        *histogram.at_mut(token.code.into())? += 1;
    }
    let mut huffman_code = [Symbol::default(); CODE_LENGTH_CODES];
    create_huffman_tree(&mut histogram, 7, scratch, &mut huffman_code)?;
    store_huffman_tree_of_huffman_tree_to_bit_mask(bw, &huffman_code)?;
    clear_huffman_tree_if_only_one_symbol(&mut huffman_code);

    // The zeros at the end can be left out, at the price of saying how many tokens there are.
    let mut trailing_zero_bits = 0;
    let mut trimmed_length = tokens.len();
    for token in tokens.iter().rev() {
        let extra_bits = match token.code {
            0 => 0,
            17 => 3,
            18 => 7,
            _ => break,
        };
        trimmed_length -= 1;
        trailing_zero_bits += u32::from(huffman_code.at(token.code.into())?.length) + extra_bits;
    }
    let write_trimmed_length = trimmed_length > 1 && trailing_zero_bits > 12;
    bw.put_bits(write_trimmed_length.into(), 1);
    let length = if write_trimmed_length {
        let value = trimmed_length as u32 - 2;
        let nbitpairs = if value == 0 {
            1
        } else {
            bits_log2_floor(value) / 2 + 1
        };
        bw.put_bits(nbitpairs - 1, 3);
        bw.put_bits(value, nbitpairs * 2);
        trimmed_length
    } else {
        tokens.len()
    };
    store_huffman_tree_to_bit_mask(bw, tokens.sub(..length)?, &huffman_code)
}

fn store_huffman_code(
    bw: &mut BitWriter,
    scratch: &mut Scratch,
    tokens: &mut Vec<Token>,
    huffman_code: &[Symbol],
) -> Checked {
    let mut used = huffman_code
        .iter()
        .zip(0u32..)
        .filter(|(symbol, _)| symbol.length != 0)
        .map(|(_, index)| index);
    // One or two symbols below 256 are written as they are.
    match (used.next(), used.next(), used.next()) {
        (None, ..) => bw.put_bits(0x01, 4),
        (Some(first), second, None) if first < 256 && second.is_none_or(|second| second < 256) => {
            bw.put_bits(1, 1);
            bw.put_bits(second.is_some().into(), 1);
            if first <= 1 {
                bw.put_bits(0, 1);
                bw.put_bits(first, 1);
            } else {
                bw.put_bits(1, 1);
                bw.put_bits(first, 8);
            }
            if let Some(second) = second {
                bw.put_bits(second, 8);
            }
        }
        _ => store_full_huffman_code(bw, scratch, tokens, huffman_code)?,
    }
    Ok(())
}

#[inline]
fn write_huffman_code(bw: &mut BitWriter, symbol: Symbol) {
    bw.put_bits(symbol.code.into(), symbol.length.into());
}

#[inline]
fn write_huffman_code_with_extra_bits(bw: &mut BitWriter, symbol: Symbol, bits: u32, n_bits: u32) {
    let depth = u32::from(symbol.length);
    bw.put_bits((bits << depth) | u32::from(symbol.code), depth + n_bits);
}

/// Writes the pixels. Bits 8 to 23 of `histogram_symbols` say which codes a tile uses. `histo_bits` 0: a single tile.
fn store_image_to_bit_mask(
    bw: &mut BitWriter,
    width: usize,
    histo_bits: u32,
    refs: &BackwardRefs,
    histogram_symbols: &[u32],
    huffman_codes: &HuffmanCodes,
) -> Checked {
    let histo_xsize = sub_sample_size(width, histo_bits);
    let tile_mask = if histo_bits == 0 {
        0
    } else {
        usize::MAX << histo_bits
    };
    let codes_at = |index: usize| -> Checked<CodeGroup<'_>> {
        huffman_codes.group(((histogram_symbols.at(index)? >> 8) & 0xffff) as usize)
    };
    let (mut x, mut y) = (0, 0);
    let (mut tile_x, mut tile_y) = (0, 0);
    let mut codes = codes_at(0)?;
    for &v in refs.iter() {
        if tile_x != x & tile_mask || tile_y != y & tile_mask {
            tile_x = x & tile_mask;
            tile_y = y & tile_mask;
            codes = codes_at((y >> histo_bits) * histo_xsize + (x >> histo_bits))?;
        }
        match v {
            PixOrCopy::Literal(argb) => {
                let [b, g, r, a] = argb.to_le_bytes().map(usize::from);
                write_huffman_code(bw, codes.literal.at(g)?);
                write_huffman_code(bw, codes.red.at(r)?);
                write_huffman_code(bw, codes.blue.at(b)?);
                write_huffman_code(bw, codes.alpha.at(a)?);
            }
            PixOrCopy::CacheIdx(idx) => {
                let literal_ix = NUM_LITERAL_CODES + NUM_LENGTH_CODES + idx as usize;
                write_huffman_code(bw, codes.literal.at(literal_ix)?);
            }
            PixOrCopy::Copy { distance, len } => {
                let prefix = prefix_encode(len.into());
                write_huffman_code_with_extra_bits(
                    bw,
                    codes.literal.at(NUM_LITERAL_CODES + prefix.code)?,
                    prefix.extra_bits_value,
                    prefix.extra_bits,
                );
                // 15 bits of code and 18 extra bits are too many to write at once.
                let prefix = prefix_encode(distance);
                write_huffman_code(bw, codes.distance.at(prefix.code)?);
                bw.put_bits(prefix.extra_bits_value, prefix.extra_bits);
            }
        }
        x += v.length();
        while x >= width {
            x -= width;
            y += 1;
        }
    }
    Ok(())
}

/// Writes an image that goes with a transform: no colour cache, the same codes everywhere.
fn encode_image_no_huffman(
    bw: &mut BitWriter,
    argb: &[u32],
    width: usize,
    quality: i32,
) -> Result<(), Error> {
    let mut hash_chain = HashChain::new(argb.len())?;
    let mut refs = BackwardRefs::default();
    hash_chain.fill(quality, argb, width)?;
    get_backward_references(
        width,
        argb,
        quality,
        &[Lz77::Standard, Lz77::Rle],
        0,
        &hash_chain,
        &mut refs,
        &mut BackwardRefs::default(),
    )?;
    let mut histogram = Histogram::from_refs(&refs, 0)?;
    let mut huffman_codes = HuffmanCodes::new(core::slice::from_mut(&mut histogram), 0)?;

    // No colour cache.
    bw.put_bits(0, 1);
    huffman_codes.store(bw, 1)?;
    Ok(store_image_to_bit_mask(
        bw,
        width,
        0,
        &refs,
        &[0],
        &huffman_codes,
    )?)
}

/// Writes the transformed image in the smallest way among `sub_configs`. `cache_bits` caps the colour cache; 0: no cap.
fn encode_image_internal(
    bw: &mut BitWriter,
    argb: &[u32],
    width: usize,
    height: usize,
    quality: i32,
    sub_configs: &[&[Lz77]],
    cache_bits: u32,
    histogram_bits_in: u32,
) -> Result<(), Error> {
    let histogram_image_xysize =
        sub_sample_size(width, histogram_bits_in) * sub_sample_size(height, histogram_bits_in);
    let mut histogram_argb = try_vec(0u32, histogram_image_xysize)?;
    let mut hash_chain = HashChain::new(argb.len())?;
    let mut refs = BackwardRefs::default();
    let mut refs_tmp = BackwardRefs::default();
    hash_chain.fill(quality, argb, width)?;

    let cache_bits_init = if cache_bits == 0 {
        MAX_COLOR_CACHE_BITS
    } else {
        cache_bits
    };
    let bw_init = bw.position();
    let mut bw_size_best = usize::MAX;
    // Both start with what has been written so far.
    let mut bw_best = if sub_configs.len() > 1 {
        bw.try_clone()?
    } else {
        BitWriter::new()
    };

    for lz77_types_to_try in sub_configs {
        let cache_bits = get_backward_references(
            width,
            argb,
            quality,
            lz77_types_to_try,
            cache_bits_init,
            &hash_chain,
            &mut refs,
            &mut refs_tmp,
        )?;
        bw.reset(bw_init);

        let mut histogram_image = get_histo_image_symbols(
            width,
            &refs,
            quality,
            histogram_bits_in,
            cache_bits,
            &mut histogram_argb,
        )?;
        let mut huffman_codes = HuffmanCodes::new(&mut histogram_image, cache_bits)?;
        drop(histogram_image);

        if cache_bits > 0 {
            bw.put_bits(1, 1);
            bw.put_bits(cache_bits, 4);
        } else {
            bw.put_bits(0, 1);
        }

        let mut histogram_image_size = 0;
        for symbol in &mut histogram_argb {
            histogram_image_size = histogram_image_size.max(*symbol as usize + 1);
            *symbol <<= 8;
        }
        let write_histogram_image = histogram_image_size > 1;
        bw.put_bits(write_histogram_image.into(), 1);
        let mut histogram_bits = histogram_bits_in;
        if write_histogram_image {
            histogram_bits = optimize_sampling(
                &mut histogram_argb,
                width,
                height,
                histogram_bits_in,
                MAX_HUFFMAN_BITS,
            )?;
            bw.put_bits(histogram_bits - 2, 3);
            let histo_width = sub_sample_size(width, histogram_bits);
            let histo_height = sub_sample_size(height, histogram_bits);
            encode_image_no_huffman(
                bw,
                histogram_argb.sub(..histo_width * histo_height)?,
                histo_width,
                quality,
            )?;
        }

        huffman_codes.store(bw, histogram_image_size)?;
        store_image_to_bit_mask(
            bw,
            width,
            histogram_bits,
            &refs,
            &histogram_argb,
            &huffman_codes,
        )?;
        if bw.num_bytes() < bw_size_best {
            bw_size_best = bw.num_bytes();
            core::mem::swap(bw, &mut bw_best);
        }
    }
    core::mem::swap(bw, &mut bw_best);
    Ok(())
}

// Transforms

fn put_transform(bw: &mut BitWriter, transform: TransformType) {
    bw.put_bits(1, 1);
    bw.put_bits(transform as u32, 2);
}

fn apply_subtract_green(argb: &mut [u32], bw: &mut BitWriter) {
    put_transform(bw, TransformType::SubtractGreen);
    subtract_green_from_blue_and_red(argb);
}

fn apply_predict_filter(
    argb: &mut [u32],
    width: usize,
    height: usize,
    config: Config,
    transform_bits: u32,
    bw: &mut BitWriter,
) -> Result<(), Error> {
    let bits = clamp_bits(
        width,
        height,
        transform_bits,
        MIN_TRANSFORM_BITS,
        MAX_TRANSFORM_BITS,
        MAX_PREDICTOR_IMAGE_SIZE,
    );
    let (transform_data, best_bits) = residual_image(width, height, bits, argb, config.exact)?;
    put_transform(bw, TransformType::Predictor);
    bw.put_bits(best_bits - MIN_TRANSFORM_BITS, NUM_TRANSFORM_BITS);
    encode_image_no_huffman(
        bw,
        &transform_data,
        sub_sample_size(width, best_bits),
        config.quality,
    )
}

fn apply_cross_color_filter(
    argb: &mut [u32],
    width: usize,
    height: usize,
    quality: i32,
    transform_bits: u32,
    bw: &mut BitWriter,
) -> Result<(), Error> {
    let (transform_data, best_bits) = color_space_transform(width, height, transform_bits, argb)?;
    put_transform(bw, TransformType::CrossColor);
    bw.put_bits(best_bits - MIN_TRANSFORM_BITS, NUM_TRANSFORM_BITS);
    encode_image_no_huffman(
        bw,
        &transform_data,
        sub_sample_size(width, best_bits),
        quality,
    )
}

// -----------------------------------------------------------------------------

const PALETTE_INV_SIZE_BITS: u32 = 11;
const PALETTE_INV_SIZE: usize = 1 << PALETTE_INV_SIZE_BITS;

/// Green.
const fn apply_palette_hash0(color: u32) -> usize {
    ((color >> 8) & 0xff) as usize
}

const fn apply_palette_hash1(color: u32) -> usize {
    ((color & 0x00ff_ffff).wrapping_mul(4_222_244_071) >> (32 - PALETTE_INV_SIZE_BITS)) as usize
}

const fn apply_palette_hash2(color: u32) -> usize {
    ((color & 0x00ff_ffff).wrapping_mul((1 << 31) - 1) >> (32 - PALETTE_INV_SIZE_BITS)) as usize
}

/// A table from the `hash` of each colour of the palette to its index, if no two have the same.
fn perfect_hash_table(
    palette: &[u32],
    hash: impl Fn(u32) -> usize,
) -> Option<[u8; PALETTE_INV_SIZE]> {
    let mut is_used = [false; PALETTE_INV_SIZE];
    let mut table = [0; PALETTE_INV_SIZE];
    for (&color, index) in palette.iter().zip(0..=u8::MAX) {
        let key = hash(color);
        if core::mem::replace(is_used.get_mut(key)?, true) {
            return None;
        }
        *table.get_mut(key)? = index;
    }
    Some(table)
}

/// `APPLY_PALETTE_FOR`: packs each row's `color_index` values into `sub_sample_size(width, xbits)` pixels.
fn apply_palette_for(
    argb: &mut [u32],
    width: usize,
    height: usize,
    xbits: u32,
    first_color: u32,
    color_index: impl Fn(u32) -> u8,
) -> Result<(), Error> {
    let mut tmp_row = try_vec(0u8, width)?;
    let dst_stride = sub_sample_size(width, xbits);
    let mut prev_pix = first_color;
    let mut prev_idx = 0;
    for y in 0..height {
        for (idx, &pix) in tmp_row.iter_mut().zip(argb.sub(y * width..)?) {
            if pix != prev_pix {
                prev_idx = color_index(pix);
                prev_pix = pix;
            }
            *idx = prev_idx;
        }
        bundle_color_map(&tmp_row, xbits, argb.sub_mut(y * dst_stride..)?);
    }
    Ok(())
}

/// All the pixels are colours of the palette.
fn apply_palette(
    argb: &mut [u32],
    palette: &[u32],
    width: usize,
    height: usize,
    xbits: u32,
) -> Result<(), Error> {
    let first_color = palette.at(0)?;
    macro_rules! with_table {
        ($hash:expr) => {
            if let Some(table) = perfect_hash_table(palette, $hash) {
                return apply_palette_for(argb, width, height, xbits, first_color, |pix| {
                    table.get($hash(pix)).copied().unwrap_or(0)
                });
            }
        };
    }
    with_table!(apply_palette_hash0);
    with_table!(apply_palette_hash1);
    with_table!(apply_palette_hash2);

    let mut sorted = [(0u32, 0u8); MAX_PALETTE_SIZE];
    for ((entry, &color), index) in sorted.iter_mut().zip(palette).zip(0..=u8::MAX) {
        *entry = (color, index);
    }
    let sorted = sorted.sub_mut(..palette.len())?;
    sorted.sort_unstable();
    apply_palette_for(argb, width, height, xbits, first_color, |pix| {
        let found = sorted.binary_search_by_key(&pix, |&(color, _)| color);
        found
            .ok()
            .and_then(|position| sorted.get(position))
            .map_or(0, |&(_, index)| index)
    })
}

/// Replaces the pixels by palette indices. Returns the new width: up to 16 colours, several indices fit in a pixel.
fn map_image_from_palette(
    argb: &mut Vec<u32>,
    palette: &[u32],
    width: usize,
    height: usize,
) -> Result<usize, Error> {
    let xbits = match palette.len() {
        ..=2 => 3,
        3..=4 => 2,
        5..=16 => 1,
        _ => 0,
    };
    apply_palette(argb, palette, width, height, xbits)?;
    let current_width = sub_sample_size(width, xbits);
    argb.truncate(current_width * height);
    Ok(current_width)
}

fn encode_palette(bw: &mut BitWriter, palette: &[u32]) -> Result<(), Error> {
    // A decoder fills its palette up with transparent black, which only helps where the indices are not packed.
    let encoded_palette = match palette {
        [rest @ .., 0] if palette.len() > 17 => rest,
        _ => palette,
    };
    put_transform(bw, TransformType::ColorIndexing);
    bw.put_bits(encoded_palette.len() as u32 - 1, 8);
    let mut tmp_palette = [0; MAX_PALETTE_SIZE];
    let mut previous = 0;
    for (diff, &color) in tmp_palette.iter_mut().zip(encoded_palette) {
        *diff = sub_pixels(color, previous);
        previous = color;
    }
    encode_image_no_huffman(
        bw,
        tmp_palette.sub(..encoded_palette.len())?,
        encoded_palette.len(),
        20,
    )
}

// Main call

/// `VP8LEncodeStream`: writes the `width * height` pixels of `argb`, without the header.
pub(crate) fn encode_stream(
    config: Config,
    mut argb: Vec<u32>,
    width: usize,
    height: usize,
    bw: &mut BitWriter,
) -> Result<(), Error> {
    if width == 0 || argb.len() != width * height || argb.is_empty() {
        return Err(Bug.into());
    }

    // `EncoderAnalyze`
    let palette_sorted: Option<Palette> = get_color_palette(&argb)?;
    let palette_size = palette_sorted
        .as_ref()
        .map(|palette| palette.colors().len());
    let histo_bits = get_histo_bits(palette_sorted.is_some(), width, height);
    let transform_bits = get_transform_bits(histo_bits);
    let (entropy_idx, red_and_blue_always_zero) =
        analyze_entropy(&argb, width, height, palette_size, transform_bits)?;
    // Images with few colours are worth a second kind of LZ77.
    let sub_configs: &[&[Lz77]] = if palette_size.is_some_and(|size| size <= 16) {
        &[&[Lz77::Standard, Lz77::Rle], &[Lz77::Box]]
    } else {
        &[&[Lz77::Standard, Lz77::Rle]]
    };

    // `EncodeStreamHook`
    let use_subtract_green = matches!(
        entropy_idx,
        EntropyIx::SubGreen | EntropyIx::SpatialSubGreen
    );
    let use_predict = matches!(entropy_idx, EntropyIx::Spatial | EntropyIx::SpatialSubGreen);
    let use_cross_color = use_predict && !red_and_blue_always_zero;
    let mut cache_bits = 0;
    let mut current_width = width;

    if entropy_idx == EntropyIx::Palette {
        let palette = palette_sort_minimize_deltas(palette_sorted.as_ref().ok_or(Bug)?)?;
        let palette = palette.colors();
        encode_palette(bw, palette)?;
        current_width = map_image_from_palette(&mut argb, palette, width, height)?;
        // A colour cache larger than the palette is of no use.
        cache_bits = bits_log2_floor(palette.len() as u32) + 1;
    }
    if use_subtract_green {
        apply_subtract_green(&mut argb, bw);
    }
    if use_predict {
        apply_predict_filter(&mut argb, current_width, height, config, transform_bits, bw)?;
    }
    if use_cross_color {
        apply_cross_color_filter(
            &mut argb,
            current_width,
            height,
            config.quality,
            transform_bits,
            bw,
        )?;
    }
    // No more transforms.
    bw.put_bits(0, 1);

    encode_image_internal(
        bw,
        &argb,
        current_width,
        height,
        config.quality,
        sub_configs,
        cache_bits,
        histo_bits,
    )
}

/// `WebPEncodeLosslessRGBA`, without the container.
pub(crate) fn encode(input: &Input<'_>) -> Result<Image, Error> {
    let (width, height) = (input.width, input.height);
    let mut argb = try_vec(0u32, width * height)?;
    let mut has_alpha = false;
    for (y, out) in argb.chunks_exact_mut(width).enumerate() {
        for (out, &[r, g, b, a]) in out.iter_mut().zip(input.row(y)?.as_chunks().0) {
            has_alpha |= a != 0xff;
            // `WebPReplaceTransparentPixels`: what cannot be seen need not be kept.
            *out = if a == 0 {
                0
            } else {
                u32::from_be_bytes([a, r, g, b])
            };
        }
    }

    let mut bw = BitWriter::new();
    bw.put_bits(MAGIC_BYTE.into(), 8);
    bw.put_bits(width as u32 - 1, IMAGE_SIZE_BITS);
    bw.put_bits(height as u32 - 1, IMAGE_SIZE_BITS);
    bw.put_bits(has_alpha.into(), 1);
    bw.put_bits(VERSION, VERSION_BITS);
    let config = Config {
        quality: 70,
        exact: false,
    };
    encode_stream(config, argb, width, height, &mut bw)?;

    Ok(Image {
        width,
        height,
        bitstream: vec![bw.finish()?],
        is_lossless: true,
        alpha: None,
        lossless_has_alpha: has_alpha,
    })
}
