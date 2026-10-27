//! `vp8l_enc.c`: the lossless encoder, at `method` 4.

mod backward_references;
mod backward_references_cost;
mod bit_writer;
mod histogram;
mod huffman;
mod lossless;
mod palette;
mod predictor;

use backward_references::{
    BackwardRefs, HashChain, Lz77, MAX_COLOR_CACHE_BITS, PixOrCopy, best_backward_refs,
};
pub(crate) use bit_writer::BitWriter;
use histogram::{Histogram, add_costs, bits_entropy, histo_image_symbols};
use huffman::{Scratch, Symbol, Token, create_compressed_huffman_tree, create_huffman_tree};
use lossless::{
    LOG_2_PRECISION_BITS, bits_log2_floor, bundle_color_map, fast_log2, prefix_encode, sub_pixels,
    subtract_green_from_blue_and_red,
};
use palette::{Palette, color_palette, is_packed, sort_minimize_deltas};
use predictor::{color_space_transform, optimize_sampling, residual_image};

use crate::container::Bitstream;
use crate::util::{Bug, ByteHistogram, Checked, SliceExt, increment, try_vec, try_with_capacity};
use crate::vp8l::common::{
    CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, CODE_LENGTH_EXTRA_BITS, CODE_LENGTH_LITERALS,
    FIRST_CACHE_CODE, HUFFMAN_CODES_PER_META_CODE, IMAGE_SIZE_BITS, MAGIC_BYTE,
    MAX_ALLOWED_CODE_LENGTH, MAX_CODE_LENGTH_CODE_LENGTH, MAX_HUFFMAN_BITS, MAX_PALETTE_SIZE,
    MAX_TRANSFORM_BITS, MIN_HUFFMAN_BITS, MIN_TRANSFORM_BITS, NUM_DISTANCE_CODES, NUM_HUFFMAN_BITS,
    NUM_LITERAL_CODES, NUM_TRANSFORM_BITS, TransformType, VERSION, VERSION_BITS, color_index_bits,
    sub_sample_size,
};
use crate::{Input, Result};

/// The most tiles that can each have Huffman codes of their own.
const MAX_HUFF_IMAGE_SIZE: usize = 2600;
/// With more tiles than this it takes too long to find the best predictors.
const MAX_PREDICTOR_IMAGE_SIZE: usize = 1 << 14;
/// The largest tiles, at `method` 4, that the search for the predictors and the color transforms starts from.
const MAX_SEARCH_TRANSFORM_BITS: u32 = 5;

/// `WebPConfig::quality`, limited to the values in use: each `match` on it leaves out what libwebp does at others.
#[derive(Clone, Copy)]
enum Quality {
    /// The palette, whatever the quality of the image.
    Palette = 20,
    /// 8 times the `method`.
    AlphaPlane = 32,
    Image = 70,
}

/// What is encoded, for what of `WebPConfig` depends on it.
#[derive(Clone, Copy)]
pub(crate) enum Config {
    /// `WebPEncodeLosslessRGBA`
    Image,
    /// `EncodeLossless` of `alpha_enc.c`
    AlphaPlane,
}

impl Config {
    const fn quality(self) -> Quality {
        match self {
            Self::Image => Quality::Image,
            Self::AlphaPlane => Quality::AlphaPlane,
        }
    }

    /// Whether to keep the color of transparent pixels. Every pixel of an alpha plane has an alpha of 0, and its green is the data.
    const fn exact(self) -> bool {
        match self {
            Self::Image => false,
            Self::AlphaPlane => true,
        }
    }
}

// Analysis

/// `EntropyIx`: the sets of transforms that are considered.
#[derive(Clone, Copy, PartialEq, Eq)]
enum EntropyIdx {
    Direct,
    Spatial,
    SubGreen,
    SpatialSubGreen,
    Palette,
}

/// Histograms of each channel, of its difference from the pixel before (`pred`), and of both less green (`sub_green`).
struct Histograms {
    alpha: ByteHistogram,
    alpha_pred: ByteHistogram,
    green: ByteHistogram,
    green_pred: ByteHistogram,
    red: ByteHistogram,
    red_pred: ByteHistogram,
    blue: ByteHistogram,
    blue_pred: ByteHistogram,
    red_sub_green: ByteHistogram,
    red_pred_sub_green: ByteHistogram,
    blue_sub_green: ByteHistogram,
    blue_pred_sub_green: ByteHistogram,
    palette: ByteHistogram,
}

/// `HashPix`: stands in for the palette index of a color.
const fn palette_proxy_hash(pix: u32) -> u8 {
    (((pix as u64 + (pix >> 19) as u64).wrapping_mul(0x39c5_fba7) & 0xffff_ffff) >> 24) as u8
}

/// Estimates which transforms suit the image best. Also returns whether red and blue are always 0 after them.
fn analyze_entropy(
    argb: &[u32],
    width: usize,
    height: usize,
    palette_size: Option<usize>,
    transform_bits: u32,
) -> Checked<(EntropyIdx, bool)> {
    // The indices of a small palette are packed several to a pixel, which in practice nothing beats.
    if palette_size.is_some_and(is_packed) {
        return Ok((EntropyIdx::Palette, true));
    }

    const EMPTY: ByteHistogram = [0; 256];
    let mut histo = Histograms {
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
    };
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
            increment(&mut histo.palette, palette_proxy_hash(pix));
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
    // The transforms' own cost matters for small images: log2(14) or log2(24) bits per tile, some 8 bits per color.
    let num_tiles =
        (sub_sample_size(width, transform_bits) * sub_sample_size(height, transform_bits)) as u64;
    let modes = [
        (
            EntropyIdx::Direct,
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
            EntropyIdx::Spatial,
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
            EntropyIdx::SubGreen,
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
            EntropyIdx::SpatialSubGreen,
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
            EntropyIdx::Palette,
            add_costs([
                bits_entropy(&histo.palette),
                (palette_size.unwrap_or(0) as u64 * 8) << LOG_2_PRECISION_BITS,
            ]),
            &histo.red,
            &histo.blue,
        ),
    ];
    let num_modes = modes.len() - usize::from(palette_size.is_none());
    let best = modes.into_iter().take(num_modes).min_by_key(|mode| mode.1);
    let (min_entropy_idx, _, red_histo, blue_histo) = best.ok_or(Bug)?;
    let red_and_blue_always_zero = red_histo
        .iter()
        .zip(blue_histo)
        .skip(1)
        .all(|(&red, &blue)| red | blue == 0);
    Ok((min_entropy_idx, red_and_blue_always_zero))
}

/// `bits` within its range, raised until there are at most `image_size_max` tiles, lowered while one tile is enough.
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

/// `GetHistoBits`
fn histo_bits_for(use_palette: bool, width: usize, height: usize) -> u32 {
    clamp_bits(
        width,
        height,
        // 9 or 7, less the `method`.
        if use_palette { 5 } else { 3 },
        MIN_HUFFMAN_BITS,
        MAX_HUFFMAN_BITS,
        MAX_HUFF_IMAGE_SIZE,
    )
}

// Huffman codes

/// Five Huffman codes per histogram: green with lengths and cache indices, red, blue, alpha, distances.
struct HuffmanCodes {
    symbols: Vec<Symbol>,
    /// How many symbols the five codes of a histogram have in all.
    group_size: usize,
}

/// The five Huffman codes of one histogram.
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
    fn new(histogram_image: &mut [Histogram], cache_bits: u32) -> Result<Self> {
        let num_literal_symbols = Histogram::num_codes(cache_bits);
        let group_size = num_literal_symbols + GROUP_SIZE_WITHOUT_LITERAL;
        let mut symbols = try_vec(Symbol::default(), group_size * histogram_image.len())?;
        let mut scratch = Scratch::new(num_literal_symbols)?;
        for (histo, group) in histogram_image
            .iter_mut()
            .zip(symbols.chunks_exact_mut(group_size))
        {
            for (population, code) in histo.populations_mut().into_iter().zip(split_group(group)?) {
                create_huffman_tree(
                    population,
                    MAX_ALLOWED_CODE_LENGTH as u8,
                    &mut scratch,
                    code,
                )?;
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

    /// Writes the codes of the first `num_groups` histograms, then clears those of a single symbol, which takes no bits.
    fn store(&mut self, bw: &mut BitWriter, num_groups: usize) -> Result<()> {
        let mut scratch = Scratch::new(CODE_LENGTH_CODES)?;
        let mut tokens = try_with_capacity(self.group_size - GROUP_SIZE_WITHOUT_LITERAL)?;
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

fn split_group(group: &mut [Symbol]) -> Checked<[&mut [Symbol]; HUFFMAN_CODES_PER_META_CODE]> {
    let num_literal_symbols = group
        .len()
        .checked_sub(GROUP_SIZE_WITHOUT_LITERAL)
        .ok_or(Bug)?;
    let (literal, rest) = group.split_at_mid(num_literal_symbols)?;
    let (red, rest) = rest.split_at_mid(NUM_LITERAL_CODES)?;
    let (blue, rest) = rest.split_at_mid(NUM_LITERAL_CODES)?;
    let (alpha, distance) = rest.split_at_mid(NUM_LITERAL_CODES)?;
    Ok([literal, red, blue, alpha, distance])
}

/// `StoreHuffmanTreeOfHuffmanTreeToBitMask`
fn store_code_length_code(
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

fn clear_huffman_tree_if_only_one_symbol(code: &mut [Symbol]) {
    if code.iter().filter(|symbol| symbol.length != 0).count() <= 1 {
        code.fill(Symbol::default());
    }
}

/// `StoreHuffmanTreeToBitMask`
fn store_code_length_tokens(
    bw: &mut BitWriter,
    tokens: &[Token],
    code_length_code: &[Symbol; CODE_LENGTH_CODES],
) -> Checked {
    for token in tokens {
        write_symbol(bw, code_length_code.at(token.code.into())?);
        if let Some(slot) = u32::from(token.code).checked_sub(CODE_LENGTH_LITERALS) {
            let n_bits = CODE_LENGTH_EXTRA_BITS.at(slot as usize)?;
            bw.put_bits(token.extra_bits_value.into(), n_bits.into());
        }
    }
    Ok(())
}

fn store_full_huffman_code(
    bw: &mut BitWriter,
    scratch: &mut Scratch,
    tokens: &mut Vec<Token>,
    code: &[Symbol],
) -> Checked {
    bw.put_bits(0, 1);
    create_compressed_huffman_tree(code, tokens);
    let mut histogram = [0u32; CODE_LENGTH_CODES];
    for token in tokens.iter() {
        *histogram.at_mut(token.code.into())? += 1;
    }
    let mut code_length_code = [Symbol::default(); CODE_LENGTH_CODES];
    create_huffman_tree(
        &mut histogram,
        MAX_CODE_LENGTH_CODE_LENGTH as u8,
        scratch,
        &mut code_length_code,
    )?;
    store_code_length_code(bw, &code_length_code)?;
    clear_huffman_tree_if_only_one_symbol(&mut code_length_code);

    // The zeros at the end can be left out, at the price of saying how many tokens there are.
    let mut trailing_zero_bits = 0;
    let mut trimmed_length = tokens.len();
    let [_, short_run_bits, long_run_bits] = CODE_LENGTH_EXTRA_BITS;
    for token in tokens.iter().rev() {
        let extra_bits = match token.code {
            0 => 0,
            17 => short_run_bits.into(),
            18 => long_run_bits.into(),
            _ => break,
        };
        trimmed_length -= 1;
        trailing_zero_bits +=
            u32::from(code_length_code.at(token.code.into())?.length) + extra_bits;
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
    store_code_length_tokens(bw, tokens.sub(..length)?, &code_length_code)
}

fn store_huffman_code(
    bw: &mut BitWriter,
    scratch: &mut Scratch,
    tokens: &mut Vec<Token>,
    code: &[Symbol],
) -> Checked {
    let mut used = code
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
        _ => store_full_huffman_code(bw, scratch, tokens, code)?,
    }
    Ok(())
}

/// `WriteHuffmanCode`
#[inline]
fn write_symbol(bw: &mut BitWriter, symbol: Symbol) {
    bw.put_bits(symbol.bits.into(), symbol.length.into());
}

/// `WriteHuffmanCodeWithExtraBits`
#[inline]
fn write_symbol_with_extra_bits(bw: &mut BitWriter, symbol: Symbol, bits: u32, n_bits: u32) {
    let depth = u32::from(symbol.length);
    bw.put_bits((bits << depth) | u32::from(symbol.bits), depth + n_bits);
}

/// `StoreImageToBitMask`. Bits 8 to 23 of `histogram_symbols` say which codes a tile uses. `histo_bits` 0: one tile.
fn store_image(
    bw: &mut BitWriter,
    width: usize,
    histo_bits: u32,
    refs: &BackwardRefs,
    histogram_symbols: &[u32],
    huffman_codes: &HuffmanCodes,
) -> Checked {
    let tiles_per_row = sub_sample_size(width, histo_bits);
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
            codes = codes_at((y >> histo_bits) * tiles_per_row + (x >> histo_bits))?;
        }
        match v {
            PixOrCopy::Literal(argb) => {
                let [b, g, r, a] = argb.to_le_bytes().map(usize::from);
                write_symbol(bw, codes.literal.at(g)?);
                write_symbol(bw, codes.red.at(r)?);
                write_symbol(bw, codes.blue.at(b)?);
                write_symbol(bw, codes.alpha.at(a)?);
            }
            PixOrCopy::CacheIdx(idx) => {
                let literal_idx = FIRST_CACHE_CODE + idx as usize;
                write_symbol(bw, codes.literal.at(literal_idx)?);
            }
            PixOrCopy::Copy { distance, len } => {
                let prefix = prefix_encode(len.into());
                write_symbol_with_extra_bits(
                    bw,
                    codes.literal.at(NUM_LITERAL_CODES + prefix.code)?,
                    prefix.extra_bits_value,
                    prefix.extra_bits,
                );
                // 15 bits of code and 18 extra bits are too many to write at once.
                let prefix = prefix_encode(distance);
                write_symbol(bw, codes.distance.at(prefix.code)?);
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

const STANDARD_AND_RLE: &[Lz77] = &[Lz77::Standard, Lz77::Rle];

/// `EncodeImageNoHuffman`: writes a transform's data or the histogram image. No color cache, the same codes everywhere.
fn encode_sub_image(
    bw: &mut BitWriter,
    argb: &[u32],
    width: usize,
    quality: Quality,
) -> Result<()> {
    let hash_chain = HashChain::new(quality, argb, width)?;
    let mut refs = BackwardRefs::default();
    best_backward_refs(
        width,
        argb,
        quality,
        STANDARD_AND_RLE,
        0,
        &hash_chain,
        &mut refs,
        &mut BackwardRefs::default(),
    )?;
    let mut histogram = Histogram::from_refs(&refs, 0)?;
    let mut huffman_codes = HuffmanCodes::new(core::slice::from_mut(&mut histogram), 0)?;

    // No color cache.
    bw.put_bits(0, 1);
    huffman_codes.store(bw, 1)?;
    Ok(store_image(bw, width, 0, &refs, &[0], &huffman_codes)?)
}

/// `EncodeImageInternal`: writes the transformed image in the smallest way among `sub_configs`.
fn encode_main_image(
    bw: &mut BitWriter,
    argb: &[u32],
    width: usize,
    height: usize,
    quality: Quality,
    sub_configs: &[&[Lz77]],
    cache_bits_max: u32,
    histogram_bits_in: u32,
) -> Result<()> {
    let histogram_image_xysize =
        sub_sample_size(width, histogram_bits_in) * sub_sample_size(height, histogram_bits_in);
    let mut histogram_argb = try_vec(0u32, histogram_image_xysize)?;
    let hash_chain = HashChain::new(quality, argb, width)?;
    let mut refs = BackwardRefs::default();
    let mut refs_tmp = BackwardRefs::default();

    let bw_init = bw.position();
    let mut bw_size_best = usize::MAX;
    // To alternate, both need what has been written so far. A single configuration only ever writes to `bw`.
    let mut bw_best = if sub_configs.len() > 1 {
        bw.try_clone()?
    } else {
        BitWriter::new()
    };

    for lz77_types_to_try in sub_configs {
        let cache_bits = best_backward_refs(
            width,
            argb,
            quality,
            lz77_types_to_try,
            cache_bits_max,
            &hash_chain,
            &mut refs,
            &mut refs_tmp,
        )?;
        bw.reset(bw_init);

        let mut histogram_image = histo_image_symbols(
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
            bw.put_bits(histogram_bits - MIN_HUFFMAN_BITS, NUM_HUFFMAN_BITS);
            let histo_width = sub_sample_size(width, histogram_bits);
            let histo_height = sub_sample_size(height, histogram_bits);
            encode_sub_image(
                bw,
                histogram_argb.sub(..histo_width * histo_height)?,
                histo_width,
                quality,
            )?;
        }

        huffman_codes.store(bw, histogram_image_size)?;
        store_image(
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

/// Writes a transform that has one element of `tiles` for each tile of `1 << bits` pixels squared.
fn store_tiled_transform(
    bw: &mut BitWriter,
    transform: TransformType,
    tiles: &[u32],
    width: usize,
    bits: u32,
    quality: Quality,
) -> Result<()> {
    put_transform(bw, transform);
    bw.put_bits(bits - MIN_TRANSFORM_BITS, NUM_TRANSFORM_BITS);
    encode_sub_image(bw, tiles, sub_sample_size(width, bits), quality)
}

fn apply_predict_filter(
    argb: &mut [u32],
    width: usize,
    height: usize,
    quality: Quality,
    exact: bool,
    transform_bits: u32,
    bw: &mut BitWriter,
) -> Result<()> {
    let bits = clamp_bits(
        width,
        height,
        transform_bits,
        MIN_TRANSFORM_BITS,
        MAX_TRANSFORM_BITS,
        MAX_PREDICTOR_IMAGE_SIZE,
    );
    let (transform_data, best_bits) = residual_image(width, height, bits, argb, exact)?;
    store_tiled_transform(
        bw,
        TransformType::Predictor,
        &transform_data,
        width,
        best_bits,
        quality,
    )
}

fn apply_cross_color_filter(
    argb: &mut [u32],
    width: usize,
    height: usize,
    quality: Quality,
    transform_bits: u32,
    bw: &mut BitWriter,
) -> Result<()> {
    let (transform_data, best_bits) =
        color_space_transform(width, height, transform_bits, quality, argb)?;
    store_tiled_transform(
        bw,
        TransformType::CrossColor,
        &transform_data,
        width,
        best_bits,
        quality,
    )
}

// Palette

const PALETTE_INV_SIZE_BITS: u32 = 11;
const PALETTE_INV_SIZE: usize = 1 << PALETTE_INV_SIZE_BITS;

/// The green channel, which is enough for the palette of an alpha plane or a gray image.
const fn apply_palette_hash0(color: u32) -> usize {
    ((color >> 8) & 0xff) as usize
}

const fn apply_palette_hash1(color: u32) -> usize {
    ((color & 0x00ff_ffff).wrapping_mul(4_222_244_071) >> (32 - PALETTE_INV_SIZE_BITS)) as usize
}

const fn apply_palette_hash2(color: u32) -> usize {
    ((color & 0x00ff_ffff).wrapping_mul((1 << 31) - 1) >> (32 - PALETTE_INV_SIZE_BITS)) as usize
}

/// A table from the `hash` of each color of the palette to its index, if no two have the same.
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
) -> Result<()> {
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

/// `ApplyPalette`: `argb` holds nothing but colors of `palette`.
fn apply_palette(
    argb: &mut [u32],
    palette: &[u32],
    width: usize,
    height: usize,
    xbits: u32,
) -> Result<()> {
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

/// Replaces the pixels by palette indices. Returns the new width: up to 16 colors, several indices fit in a pixel.
fn map_image_from_palette(
    argb: &mut Vec<u32>,
    palette: &[u32],
    width: usize,
    height: usize,
) -> Result<usize> {
    let xbits = color_index_bits(palette.len());
    apply_palette(argb, palette, width, height, xbits)?;
    let current_width = sub_sample_size(width, xbits);
    argb.truncate(current_width * height);
    Ok(current_width)
}

fn encode_palette(bw: &mut BitWriter, palette: &[u32]) -> Result<()> {
    // A decoder fills its palette up with transparent black. Leaving it out must not make the decoder unpack indices.
    let encoded_palette = match palette {
        [rest @ .., 0] if !is_packed(rest.len()) => rest,
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
    encode_sub_image(
        bw,
        tmp_palette.sub(..encoded_palette.len())?,
        encoded_palette.len(),
        Quality::Palette,
    )
}

/// `VP8LEncodeStream`: writes the `width * height` pixels of `argb`, without the header.
pub(crate) fn encode_stream(
    config: Config,
    mut argb: Vec<u32>,
    width: usize,
    height: usize,
    bw: &mut BitWriter,
) -> Result<()> {
    if width == 0 || argb.len() != width * height || argb.is_empty() {
        return Err(Bug.into());
    }

    // `EncoderAnalyze`
    let palette_sorted: Option<Palette> = color_palette(&argb)?;
    let palette_size = palette_sorted
        .as_ref()
        .map(|palette| palette.colors().len());
    let histo_bits = histo_bits_for(palette_sorted.is_some(), width, height);
    let transform_bits = histo_bits.min(MAX_SEARCH_TRANSFORM_BITS);
    let (entropy_idx, red_and_blue_always_zero) =
        analyze_entropy(&argb, width, height, palette_size, transform_bits)?;
    // Images with few colors are worth a second kind of LZ77.
    let sub_configs: &[&[Lz77]] = if palette_size.is_some_and(is_packed) {
        &[STANDARD_AND_RLE, &[Lz77::Box]]
    } else {
        &[STANDARD_AND_RLE]
    };

    // `EncodeStreamHook`
    let use_subtract_green = matches!(
        entropy_idx,
        EntropyIdx::SubGreen | EntropyIdx::SpatialSubGreen
    );
    let use_predict = matches!(
        entropy_idx,
        EntropyIdx::Spatial | EntropyIdx::SpatialSubGreen
    );
    let use_cross_color = use_predict && !red_and_blue_always_zero;
    let mut cache_bits_max = MAX_COLOR_CACHE_BITS;
    let mut current_width = width;

    if entropy_idx == EntropyIdx::Palette {
        let palette = sort_minimize_deltas(palette_sorted.as_ref().ok_or(Bug)?)?;
        let palette = palette.colors();
        encode_palette(bw, palette)?;
        current_width = map_image_from_palette(&mut argb, palette, width, height)?;
        // A color cache larger than the palette is of no use.
        cache_bits_max = bits_log2_floor(palette.len() as u32) + 1;
    }
    if use_subtract_green {
        put_transform(bw, TransformType::SubtractGreen);
        subtract_green_from_blue_and_red(&mut argb);
    }
    if use_predict {
        apply_predict_filter(
            &mut argb,
            current_width,
            height,
            config.quality(),
            config.exact(),
            transform_bits,
            bw,
        )?;
    }
    if use_cross_color {
        apply_cross_color_filter(
            &mut argb,
            current_width,
            height,
            config.quality(),
            transform_bits,
            bw,
        )?;
    }
    // No more transforms.
    bw.put_bits(0, 1);

    encode_main_image(
        bw,
        &argb,
        current_width,
        height,
        config.quality(),
        sub_configs,
        cache_bits_max,
        histo_bits,
    )
}

/// `WebPEncodeLosslessRGBA`, without the container.
pub(crate) fn encode(input: &Input<'_>) -> Result<Bitstream> {
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
    encode_stream(Config::Image, argb, width, height, &mut bw)?;

    Ok(Bitstream::Lossless {
        data: bw.finish()?,
        has_alpha,
    })
}
