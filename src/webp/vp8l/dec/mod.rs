//! `vp8l_dec.c`: the lossless decoder.

mod bit_reader;
mod huffman;
mod lossless;
mod predictors;

use bit_reader::BitReader;
use huffman::{
    HTreeGroup, HUFFMAN_PACKED_BITS, HUFFMAN_PACKED_TABLE_SIZE, HUFFMAN_TABLE_BITS,
    HUFFMAN_TABLE_MASK, HuffmanCode, HuffmanCode32, LENGTHS_TABLE_MASK, MAX_CODE_LENGTHS_SIZE,
    append_huffman_table, build_lengths_table, is_valid_huffman_code,
};
use lossless::{COLOR_MAP_SIZE, Transform, convert_bgra_to_rgba, copy_pixels, green_of};
use predictors::{Pixel, add_pixel};

use crate::util::{Bug, Checked, SliceExt, try_vec, try_with_capacity};
use crate::vp8l::color_cache::ColorCache;
use crate::vp8l::common::{
    CODE_LENGTH_CODE_ORDER, CODE_LENGTH_CODES, CODE_LENGTH_EXTRA_BITS, CODE_LENGTH_LITERALS,
    CODE_LENGTH_REPEAT_CODE, CODE_LENGTH_REPEAT_OFFSETS, CODE_TO_PLANE, CODE_TO_PLANE_CODES,
    DEFAULT_CODE_LENGTH, FIRST_CACHE_CODE, HUFFMAN_CODES_PER_META_CODE, IMAGE_SIZE_BITS,
    MAGIC_BYTE, MAX_CACHE_BITS, MIN_HUFFMAN_BITS, MIN_TRANSFORM_BITS, NUM_DISTANCE_CODES,
    NUM_HUFFMAN_BITS, NUM_LITERAL_CODES, NUM_TRANSFORM_BITS, NUM_TRANSFORMS, TransformType,
    VERSION, VERSION_BITS, color_index_bits, sub_sample_size,
};
use crate::{Error, Info, Output, Result};

pub(crate) use crate::vp8l::common::FRAME_HEADER_SIZE;

const NUM_ARGB_CACHE_ROWS: usize = 16;

// The five codes of a meta code. Green also codes the length prefixes and the color cache indices.
const GREEN: usize = 0;
const RED: usize = 1;
const BLUE: usize = 2;
const ALPHA: usize = 3;
const DIST: usize = 4;

/// How many symbols each has, without the color cache indices.
const ALPHABET_SIZE: [usize; HUFFMAN_CODES_PER_META_CODE] = [
    FIRST_CACHE_CODE,
    NUM_LITERAL_CODES,
    NUM_LITERAL_CODES,
    NUM_LITERAL_CODES,
    NUM_DISTANCE_CODES,
];

/// Added to `HuffmanCode32::bits` if the green symbol is not a literal.
const BITS_SPECIAL_MARKER: u32 = 0x100;

/// `VP8LCheckSignature`
pub(crate) fn check_signature(data: &[u8]) -> bool {
    matches!(data.first_chunk::<FRAME_HEADER_SIZE>(), Some(&[MAGIC_BYTE, _, _, _, last])
        if u32::from(last) >> (u8::BITS - VERSION_BITS) == VERSION)
}

fn read_image_info(br: &mut BitReader<'_>) -> Option<Info> {
    if br.read_bits(8) != u32::from(MAGIC_BYTE) {
        return None;
    }
    let width = br.read_bits(IMAGE_SIZE_BITS) + 1;
    let height = br.read_bits(IMAGE_SIZE_BITS) + 1;
    let _has_alpha = br.read_bits(1);
    if br.read_bits(VERSION_BITS) != VERSION || br.eos {
        return None;
    }
    Some(Info { width, height })
}

/// `VP8LGetInfo`
pub(crate) fn get_info(data: &[u8]) -> Option<Info> {
    if !check_signature(data) {
        return None;
    }
    read_image_info(&mut BitReader::new(data))
}

/// `GetCopyDistance`, `GetCopyLength`: reads the extra bits that follow the prefix `symbol`. Returns the whole value.
#[inline]
fn prefix_decode(symbol: usize, br: &mut BitReader<'_>) -> usize {
    if symbol < 4 {
        return symbol + 1;
    }
    let extra_bits = (symbol - 2) >> 1;
    let offset = (2 + (symbol & 1)) << extra_bits;
    offset + br.read_bits(extra_bits as u32) as usize + 1
}

#[inline]
fn plane_code_to_distance(xsize: usize, plane_code: usize) -> Checked<usize> {
    if plane_code > CODE_TO_PLANE_CODES {
        return Ok(plane_code - CODE_TO_PLANE_CODES);
    }
    let dist_code = usize::from(CODE_TO_PLANE.at(plane_code.wrapping_sub(1))?);
    let yoffset = dist_code >> 4;
    // In a narrow image, the pixel may be one that comes later.
    Ok((yoffset * xsize + 8).saturating_sub(dist_code & 0xf).max(1))
}

/// The next symbol of the code whose table starts at `tables[table_start]`. It takes at most 15 bits.
#[inline(always)]
fn read_symbol(
    tables: &[HuffmanCode],
    table_start: usize,
    br: &mut BitReader<'_>,
) -> Checked<usize> {
    let mut index = table_start + (br.prefetch_bits() & HUFFMAN_TABLE_MASK) as usize;
    let mut code = tables.at(index)?;
    if code.bits() > HUFFMAN_TABLE_BITS {
        br.skip_bits(HUFFMAN_TABLE_BITS);
        let mask = (1 << (code.bits() - HUFFMAN_TABLE_BITS)) - 1;
        index += code.value() as usize + (br.prefetch_bits() & mask) as usize;
        code = tables.at(index)?;
    }
    br.skip_bits(code.bits());
    Ok(code.value() as usize)
}

fn build_packed_table(group: &mut HTreeGroup, tables: &[HuffmanCode]) -> Checked {
    let [green, red, blue, alpha, _] = group.htrees;
    for (next_bits, huff) in group.packed_table.iter_mut().enumerate() {
        let hcode = tables.at(green + next_bits)?;
        if hcode.value() as usize >= NUM_LITERAL_CODES {
            huff.bits = hcode.bits() + BITS_SPECIAL_MARKER;
            huff.value = hcode.value();
            continue;
        }
        *huff = HuffmanCode32::default();
        let mut bits = next_bits;
        for (table_start, shift) in [(green, 8), (red, 16), (blue, 0), (alpha, 24)] {
            let hcode = tables.at(table_start + bits)?;
            huff.bits += hcode.bits();
            huff.value |= hcode.value() << shift;
            bits >>= hcode.bits();
        }
    }
    Ok(())
}

fn read_huffman_code_lengths(
    br: &mut BitReader<'_>,
    code_length_code_lengths: &[u8; CODE_LENGTH_CODES],
    code_lengths: &mut [u8],
) -> Result<()> {
    let table = build_lengths_table(code_length_code_lengths)?.ok_or(Error::BitstreamError)?;
    let num_symbols = code_lengths.len();
    let mut max_symbol = num_symbols;
    if br.read_bits(1) != 0 {
        let length_nbits = 2 + 2 * br.read_bits(3);
        max_symbol = 2 + br.read_bits(length_nbits) as usize;
        if max_symbol > num_symbols {
            return Err(Error::BitstreamError);
        }
    }

    let mut prev_code_len = DEFAULT_CODE_LENGTH;
    let mut symbol = 0;
    while symbol < num_symbols && max_symbol != 0 {
        max_symbol -= 1;
        br.fill_bit_window();
        let code = table.at((br.prefetch_bits() & LENGTHS_TABLE_MASK) as usize)?;
        br.skip_bits(code.bits());
        let code_len = code.value();
        if code_len < CODE_LENGTH_LITERALS {
            code_lengths.put(symbol, code_len as u8)?;
            symbol += 1;
            if code_len != 0 {
                prev_code_len = code_len as u8;
            }
        } else {
            let slot = (code_len - CODE_LENGTH_LITERALS) as usize;
            let extra_bits = CODE_LENGTH_EXTRA_BITS.at(slot)?;
            let repeat_offset = CODE_LENGTH_REPEAT_OFFSETS.at(slot)?;
            let repeat = br.read_bits(extra_bits.into()) as usize + usize::from(repeat_offset);
            let Some(repeated) = code_lengths.get_mut(symbol..symbol + repeat) else {
                return Err(Error::BitstreamError);
            };
            if code_len == CODE_LENGTH_REPEAT_CODE {
                repeated.fill(prev_code_len);
            }
            symbol += repeat;
        }
    }
    Ok(())
}

/// `ReadHuffmanCode` without the table: reads the length of each symbol. `code_lengths` is as long as the alphabet.
fn read_huffman_code(br: &mut BitReader<'_>, code_lengths: &mut [u8]) -> Result<()> {
    code_lengths.fill(0);

    let simple_code = br.read_bits(1) != 0;
    if simple_code {
        let num_symbols = br.read_bits(1) + 1;
        let first_symbol_len_code = br.read_bits(1);
        let first_symbol = br.read_bits(if first_symbol_len_code == 0 { 1 } else { 8 });
        let second_symbol = (num_symbols == 2).then(|| br.read_bits(8));
        // A distance symbol may be out of range, and is then as good as absent.
        for symbol in [Some(first_symbol), second_symbol].into_iter().flatten() {
            if let Some(code_length) = code_lengths.get_mut(symbol as usize) {
                *code_length = 1;
            }
        }
    } else {
        let mut code_length_code_lengths = [0; CODE_LENGTH_CODES];
        let num_codes = br.read_bits(4) as usize + 4;
        for &symbol in CODE_LENGTH_CODE_ORDER.iter().take(num_codes) {
            code_length_code_lengths.put(symbol.into(), br.read_bits(3) as u8)?;
        }
        read_huffman_code_lengths(br, &code_length_code_lengths, code_lengths)?;
    }
    if br.eos {
        return Err(Error::BitstreamError);
    }
    Ok(())
}

/// `VP8LMetadata`: what it takes to decode the entropy-coded pixels of an image.
struct Metadata {
    /// 0 without a color cache.
    color_cache_bits: u32,
    /// The columns where these bits are 0 are where the meta code can change.
    huffman_mask: usize,
    huffman_subsample_bits: u32,
    huffman_xsize: usize,
    /// The index in `htree_groups` for each block of pixels, if `huffman_subsample_bits` is not 0.
    huffman_image: Vec<u32>,
    htree_groups: Vec<HTreeGroup>,
    huffman_tables: Vec<HuffmanCode>,
}

impl Metadata {
    #[inline(always)]
    fn get_htree_group_for_pos(&self, x: usize, y: usize) -> Checked<&HTreeGroup> {
        let bits = self.huffman_subsample_bits;
        let meta_index = match bits {
            0 => 0,
            _ => self
                .huffman_image
                .at(self.huffman_xsize * (y >> bits) + (x >> bits))?,
        };
        self.htree_groups.at_ref(meta_index as usize)
    }

    /// Whether only the green channel is entropy-coded, without a color cache.
    fn is_8b_optimizable(&self) -> Checked<bool> {
        if self.color_cache_bits != 0 {
            return Ok(false);
        }
        for group in &self.htree_groups {
            let [_, red, blue, alpha, _] = group.htrees;
            for table_start in [red, blue, alpha] {
                if self.huffman_tables.at(table_start)?.bits() > 0 {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}

/// `ReadHuffmanCodesHelper`. Meta code `i` goes to `mapping[i]` in the result, or is only validated if that is `None`.
fn read_htree_groups(
    br: &mut BitReader<'_>,
    color_cache_bits: u32,
    num_htree_groups: usize,
    mapping: Option<&[Option<u32>]>,
) -> Result<(Vec<HTreeGroup>, Vec<HuffmanCode>)> {
    let mut alphabet_sizes = ALPHABET_SIZE;
    if color_cache_bits > 0 {
        alphabet_sizes[GREEN] += 1 << color_cache_bits;
    }
    let mut code_lengths = [0; MAX_CODE_LENGTHS_SIZE];
    let mut sorted = [0; MAX_CODE_LENGTHS_SIZE];
    let mut htree_groups = try_vec(HTreeGroup::default(), num_htree_groups)?;
    let mut tables = Vec::new();

    for i in 0..mapping.map_or(num_htree_groups, <[_]>::len) {
        let index = match mapping {
            None => Some(i),
            Some(mapping) => mapping.at(i)?.map(|index| index as usize),
        };
        let Some(index) = index else {
            for alphabet_size in alphabet_sizes {
                let code_lengths = code_lengths.sub_mut(..alphabet_size)?;
                read_huffman_code(br, code_lengths)?;
                if !is_valid_huffman_code(code_lengths)? {
                    return Err(Error::BitstreamError);
                }
            }
            continue;
        };
        let group = htree_groups.at_mut(index)?;
        let mut first_codes = [HuffmanCode::default(); HUFFMAN_CODES_PER_META_CODE];
        let mut max_bits = 0;
        let codes = group.htrees.iter_mut().zip(&mut first_codes);
        for ((j, alphabet_size), (htree, first_code)) in (0..).zip(alphabet_sizes).zip(codes) {
            let code_lengths = code_lengths.sub_mut(..alphabet_size)?;
            read_huffman_code(br, code_lengths)?;
            *htree = append_huffman_table(&mut tables, code_lengths, &mut sorted)?;
            *first_code = tables.at(*htree)?;
            if j <= ALPHA {
                max_bits += u32::from(code_lengths.iter().copied().max().unwrap_or(0));
            }
        }
        let [green, red, blue, alpha, dist] = first_codes;
        group.is_trivial_literal = red.bits() == 0 && blue.bits() == 0 && alpha.bits() == 0;
        if group.is_trivial_literal {
            group.literal_arb = (alpha.value() << 24) | (red.value() << 16) | blue.value();
            if green.bits() == 0 && dist.bits() == 0 && (green.value() as usize) < NUM_LITERAL_CODES
            {
                group.is_trivial_code = true;
                group.literal_arb |= green.value() << 8;
            }
        }
        group.use_packed_table = !group.is_trivial_code && max_bits < HUFFMAN_PACKED_BITS;
        if group.use_packed_table {
            build_packed_table(group, &tables)?;
        }
    }
    Ok((htree_groups, tables))
}

/// `ReadHuffmanCodes`, and the color cache size before them. Only the main image can have several meta codes.
fn read_metadata(
    br: &mut BitReader<'_>,
    xsize: usize,
    ysize: usize,
    is_main_image: bool,
) -> Result<Metadata> {
    let mut color_cache_bits = 0;
    if br.read_bits(1) != 0 {
        color_cache_bits = br.read_bits(4);
        if !(1..=MAX_CACHE_BITS).contains(&color_cache_bits) {
            return Err(Error::BitstreamError);
        }
    }

    let mut huffman_image = Vec::new();
    let mut huffman_subsample_bits = 0;
    let mut num_htree_groups = 1;
    let mut mapping = None;
    if is_main_image && br.read_bits(1) != 0 {
        huffman_subsample_bits = MIN_HUFFMAN_BITS + br.read_bits(NUM_HUFFMAN_BITS);
        let huffman_xsize = sub_sample_size(xsize, huffman_subsample_bits);
        let huffman_ysize = sub_sample_size(ysize, huffman_subsample_bits);
        huffman_image = decode_image_stream(br, huffman_xsize, huffman_ysize)?;
        for pixel in &mut huffman_image {
            // The index is in the red and green channels.
            *pixel = (*pixel >> 8) & 0xffff;
            num_htree_groups = num_htree_groups.max(*pixel as usize + 1);
        }
        // So that a small file cannot ask for a lot of memory, only the meta codes in use are kept if there are many.
        if num_htree_groups > 1000 || num_htree_groups > xsize * ysize {
            let mut used = try_vec(None, num_htree_groups)?;
            let mut num_used = 0;
            for pixel in &mut huffman_image {
                *pixel = *used.at_mut(*pixel as usize)?.get_or_insert_with(|| {
                    num_used += 1;
                    num_used - 1
                });
            }
            num_htree_groups = num_used as usize;
            mapping = Some(used);
        }
    }
    if br.eos {
        return Err(Error::BitstreamError);
    }

    let (htree_groups, huffman_tables) =
        read_htree_groups(br, color_cache_bits, num_htree_groups, mapping.as_deref())?;
    Ok(Metadata {
        color_cache_bits,
        huffman_mask: match huffman_subsample_bits {
            0 => usize::MAX,
            _ => (1 << huffman_subsample_bits) - 1,
        },
        huffman_subsample_bits,
        huffman_xsize: sub_sample_size(xsize, huffman_subsample_bits),
        huffman_image,
        htree_groups,
        huffman_tables,
    })
}

/// Appends `length` elements to `data`, which has room for them, each a copy of the one `dist` elements before it.
#[inline]
fn copy_block<T: Copy>(data: &mut Vec<T>, dist: usize, length: usize) -> Checked {
    if dist == 0 {
        return Err(Bug);
    }
    let start = data.len().checked_sub(dist).ok_or(Bug)?;
    if dist == 1 {
        let last = data.at(start)?;
        data.resize(data.len() + length, last);
        return Ok(());
    }
    // If they overlap, what is appended is a pattern of `dist` elements, which each round makes longer.
    let mut remaining = length;
    while remaining > 0 {
        let count = remaining.min(data.len() - start);
        data.extend_from_within(start..start + count);
        remaining -= count;
    }
    Ok(())
}

/// Inserts the pixels from `last_cached` on, and moves it to the end.
#[inline]
fn cache_pixels(color_cache: &mut ColorCache, data: &[u32], last_cached: &mut usize) -> Checked {
    for &argb in data.sub(*last_cached..)? {
        color_cache.insert(argb)?;
    }
    *last_cached = data.len();
    Ok(())
}

/// Calls `process_rows` with the pixels so far and how many rows are complete, every `NUM_ARGB_CACHE_ROWS` rows and at the end.
fn decode_image_data(
    br: &mut BitReader<'_>,
    metadata: &Metadata,
    width: usize,
    height: usize,
    process_rows: &mut dyn FnMut(&[u32], usize) -> Checked,
) -> Result<Vec<u32>> {
    let num_pixels = width * height;
    let mut data = try_with_capacity(num_pixels)?;
    let mut color_cache = match metadata.color_cache_bits {
        0 => None,
        bits => Some(ColorCache::new(bits)?),
    };
    let tables = metadata.huffman_tables.as_slice();
    let mask = metadata.huffman_mask;
    let (mut row, mut col) = (0, 0);
    let mut last_cached = 0;
    let mut htree_group = metadata.get_htree_group_for_pos(col, row)?;

    'decode: while data.len() < num_pixels {
        if col & mask == 0 {
            htree_group = metadata.get_htree_group_for_pos(col, row)?;
        }
        let argb = 'literal: {
            if htree_group.is_trivial_code {
                break 'literal htree_group.literal_arb;
            }
            br.fill_bit_window();
            let symbol = if htree_group.use_packed_table {
                let index = br.prefetch_bits() as usize & (HUFFMAN_PACKED_TABLE_SIZE - 1);
                let packed = htree_group.packed_table.at(index)?;
                if packed.bits < BITS_SPECIAL_MARKER {
                    br.skip_bits(packed.bits);
                    if br.is_end_of_stream() {
                        break 'decode;
                    }
                    break 'literal packed.value;
                }
                br.skip_bits(packed.bits - BITS_SPECIAL_MARKER);
                packed.value as usize
            } else {
                read_symbol(tables, htree_group.htrees[GREEN], br)?
            };
            if br.is_end_of_stream() {
                break 'decode;
            }
            if symbol < NUM_LITERAL_CODES {
                let green = (symbol as u32) << 8;
                if htree_group.is_trivial_literal {
                    break 'literal htree_group.literal_arb | green;
                }
                let red = read_symbol(tables, htree_group.htrees[RED], br)? as u32;
                br.fill_bit_window();
                let blue = read_symbol(tables, htree_group.htrees[BLUE], br)? as u32;
                let alpha = read_symbol(tables, htree_group.htrees[ALPHA], br)? as u32;
                if br.is_end_of_stream() {
                    break 'decode;
                }
                break 'literal (alpha << 24) | (red << 16) | green | blue;
            }
            if symbol >= FIRST_CACHE_CODE {
                let color_cache = color_cache.as_mut().ok_or(Bug)?;
                cache_pixels(color_cache, &data, &mut last_cached)?;
                break 'literal color_cache.lookup((symbol - FIRST_CACHE_CODE) as u32)?;
            }

            let length = prefix_decode(symbol - NUM_LITERAL_CODES, br);
            let dist_symbol = read_symbol(tables, htree_group.htrees[DIST], br)?;
            br.fill_bit_window();
            let dist_code = prefix_decode(dist_symbol, br);
            let dist = plane_code_to_distance(width, dist_code)?;
            if br.is_end_of_stream() {
                break 'decode;
            }
            if data.len() < dist || num_pixels - data.len() < length {
                return Err(Error::BitstreamError);
            }
            copy_block(&mut data, dist, length)?;
            col += length;
            while col >= width {
                col -= width;
                row += 1;
                if row % NUM_ARGB_CACHE_ROWS == 0 {
                    process_rows(&data, row)?;
                }
            }
            if col & mask != 0 {
                htree_group = metadata.get_htree_group_for_pos(col, row)?;
            }
            if let Some(color_cache) = &mut color_cache {
                cache_pixels(color_cache, &data, &mut last_cached)?;
            }
            continue 'decode;
        };

        data.push(argb);
        col += 1;
        if col >= width {
            col = 0;
            row += 1;
            if row % NUM_ARGB_CACHE_ROWS == 0 {
                process_rows(&data, row)?;
            }
            if let Some(color_cache) = &mut color_cache {
                cache_pixels(color_cache, &data, &mut last_cached)?;
            }
        }
    }

    if br.is_end_of_stream() {
        return Err(Error::BitstreamError);
    }
    process_rows(&data, row)?;
    Ok(data)
}

/// `DecodeImageStream` of an image that is part of a header: it has no transforms and a single meta code.
fn decode_image_stream(br: &mut BitReader<'_>, xsize: usize, ysize: usize) -> Result<Vec<u32>> {
    let metadata = read_metadata(br, xsize, ysize, false)?;
    decode_image_data(br, &metadata, xsize, ysize, &mut |_, _| Ok(()))
}

/// The colors are stored as differences.
fn expand_color_map(colors: &[u32]) -> Result<Vec<u32>> {
    let mut color_map = try_vec(0, COLOR_MAP_SIZE)?;
    let mut previous = [0; 4];
    for (new, color) in color_map.iter_mut().zip(colors) {
        previous = add_pixel(color.to_le_bytes(), previous);
        *new = u32::from_le_bytes(previous);
    }
    Ok(color_map)
}

/// `xsize` is the width of the image to transform, and becomes that of the transformed image.
fn read_transform(
    br: &mut BitReader<'_>,
    xsize: &mut usize,
    ysize: usize,
    transforms: &mut Vec<Transform>,
) -> Result<()> {
    let kind = TransformType::from_bits(br.read_bits(2));
    if transforms.iter().any(|transform| transform.kind == kind) {
        return Err(Error::BitstreamError);
    }
    let mut transform = Transform {
        kind,
        bits: 0,
        xsize: *xsize,
        data: Vec::new(),
    };
    match kind {
        TransformType::Predictor | TransformType::CrossColor => {
            transform.bits = MIN_TRANSFORM_BITS + br.read_bits(NUM_TRANSFORM_BITS);
            transform.data = decode_image_stream(
                br,
                sub_sample_size(transform.xsize, transform.bits),
                sub_sample_size(ysize, transform.bits),
            )?;
        }
        TransformType::ColorIndexing => {
            let num_colors = br.read_bits(8) as usize + 1;
            transform.bits = color_index_bits(num_colors);
            *xsize = sub_sample_size(transform.xsize, transform.bits);
            transform.data = expand_color_map(&decode_image_stream(br, num_colors, 1)?)?;
        }
        TransformType::SubtractGreen => {}
    }
    transforms.push(transform);
    Ok(())
}

/// Undoes the transforms, a few rows at a time.
struct ArgbCache<'a> {
    transforms: &'a [Transform],
    /// The width of the rows that come in.
    in_width: usize,
    /// The width of the rows that go out.
    out_width: usize,
    /// `NUM_ARGB_CACHE_ROWS` rows, after one row for the predictor transform to keep the row above them in.
    pixels: Vec<Pixel>,
    rows_done: usize,
}

impl<'a> ArgbCache<'a> {
    fn new(transforms: &'a [Transform], in_width: usize, out_width: usize) -> Result<Self> {
        Ok(Self {
            transforms,
            in_width,
            out_width,
            pixels: try_vec([0; 4], out_width * (NUM_ARGB_CACHE_ROWS + 1))?,
            rows_done: 0,
        })
    }

    /// Transforms rows `rows_done..y_end` of `data`. Returns the number of the first one and their pixels.
    fn apply_inverse_transforms(
        &mut self,
        data: &[u32],
        y_end: usize,
    ) -> Checked<(usize, &[Pixel])> {
        let y_start = self.rows_done;
        self.rows_done = y_end;
        let top = self.out_width;
        let mut rows_in = Some(data.sub(self.in_width * y_start..self.in_width * y_end)?);
        if y_start < y_end {
            for transform in self.transforms.iter().rev() {
                transform.inverse(y_start, y_end, rows_in.take(), &mut self.pixels, top)?;
            }
        }
        if let Some(rows_in) = rows_in {
            copy_pixels(rows_in, self.pixels.sub_mut(top..)?);
        }
        let rows_out = self
            .pixels
            .sub(top..top + self.out_width * (y_end - y_start))?;
        Ok((y_start, rows_out))
    }
}

/// The main image, read up to its pixels.
struct Decoder<'a> {
    br: BitReader<'a>,
    /// The width of the entropy-coded image, which is less than that of the image if pixels are bundled.
    width: usize,
    metadata: Metadata,
    transforms: Vec<Transform>,
}

impl<'a> Decoder<'a> {
    /// `DecodeImageStream` of the main image, up to the pixels.
    fn new(mut br: BitReader<'a>, xsize: usize, ysize: usize) -> Result<Self> {
        let mut width = xsize;
        let mut transforms = try_with_capacity(NUM_TRANSFORMS)?;
        while br.read_bits(1) != 0 {
            read_transform(&mut br, &mut width, ysize, &mut transforms)?;
        }
        let metadata = read_metadata(&mut br, width, ysize, true)?;
        Ok(Self {
            br,
            width,
            metadata,
            transforms,
        })
    }
}

/// `VP8LDecodeHeader` and `VP8LDecodeImage`. `data` starts at the signature byte and goes on to the end of the file.
pub(crate) fn decode(data: &[u8], output: &mut Output<'_>) -> Result<()> {
    let mut br = BitReader::new(data);
    let info = read_image_info(&mut br).ok_or(Error::BitstreamError)?;
    let (width, height) = (info.width as usize, info.height as usize);
    let mut dec = Decoder::new(br, width, height)?;
    output.check(width, height)?;
    let mut argb_cache = ArgbCache::new(&dec.transforms, dec.width, width)?;
    let mut emit_rows = |data: &[u32], y_end| {
        let (y_start, rows) = argb_cache.apply_inverse_transforms(data, y_end)?;
        for (y, argb) in (y_start..).zip(rows.chunks_exact(width)) {
            convert_bgra_to_rgba(argb, output.row_mut(y, width)?);
        }
        Ok(())
    };
    decode_image_data(
        &mut dec.br,
        &dec.metadata,
        dec.width,
        height,
        &mut emit_rows,
    )?;
    Ok(())
}

/// `DecodeAlphaData`: `decode_image_data` for an image whose green channel alone is entropy-coded, and alone is returned.
fn decode_alpha_data(
    br: &mut BitReader<'_>,
    metadata: &Metadata,
    width: usize,
    height: usize,
) -> Result<Vec<u8>> {
    let num_pixels = width * height;
    let mut data = try_with_capacity(num_pixels)?;
    let tables = metadata.huffman_tables.as_slice();
    let mask = metadata.huffman_mask;
    let (mut row, mut col) = (0, 0);
    let mut htree_group = metadata.get_htree_group_for_pos(col, row)?;

    while !br.eos && data.len() < num_pixels {
        if col & mask == 0 {
            htree_group = metadata.get_htree_group_for_pos(col, row)?;
        }
        br.fill_bit_window();
        let symbol = read_symbol(tables, htree_group.htrees[GREEN], br)?;
        if symbol < NUM_LITERAL_CODES {
            data.push(symbol as u8);
            col += 1;
            if col >= width {
                col = 0;
                row += 1;
            }
        } else {
            if symbol >= FIRST_CACHE_CODE {
                return Err(Error::Bug);
            }
            let length = prefix_decode(symbol - NUM_LITERAL_CODES, br);
            let dist_symbol = read_symbol(tables, htree_group.htrees[DIST], br)?;
            br.fill_bit_window();
            let dist_code = prefix_decode(dist_symbol, br);
            let dist = plane_code_to_distance(width, dist_code)?;
            if data.len() < dist || num_pixels - data.len() < length {
                return Err(Error::BitstreamError);
            }
            copy_block(&mut data, dist, length)?;
            col += length;
            while col >= width {
                col -= width;
                row += 1;
            }
            if data.len() < num_pixels && col & mask != 0 {
                htree_group = metadata.get_htree_group_for_pos(col, row)?;
            }
        }
        br.eos = br.is_end_of_stream();
    }
    // Unlike `decode_image_data`, this lets the last symbol go past the end of the data.
    if data.len() < num_pixels {
        return Err(Error::BitstreamError);
    }
    Ok(data)
}

/// `VP8LDecodeAlphaHeader`, `VP8LDecodeAlphaImageStream`: `output` becomes the green channel of a headerless image.
pub(crate) fn decode_alpha(
    data: &[u8],
    width: usize,
    height: usize,
    output: &mut [u8],
) -> Result<()> {
    let mut dec = Decoder::new(BitReader::new(data), width, height)?;

    if let [transform] = dec.transforms.as_slice()
        && transform.kind == TransformType::ColorIndexing
        && dec.metadata.is_8b_optimizable()?
    {
        let pixels = decode_alpha_data(&mut dec.br, &dec.metadata, dec.width, height)?;
        transform.color_index_inverse_alpha(&pixels, output)?;
        return Ok(());
    }

    let mut argb_cache = ArgbCache::new(&dec.transforms, dec.width, width)?;
    let mut extract_alpha_rows = |data: &[u32], y_end| {
        let (y_start, rows) = argb_cache.apply_inverse_transforms(data, y_end)?;
        for (alpha, &pixel) in output.sub_mut(y_start * width..)?.iter_mut().zip(rows) {
            *alpha = green_of(pixel);
        }
        Ok(())
    };
    decode_image_data(
        &mut dec.br,
        &dec.metadata,
        dec.width,
        height,
        &mut extract_alpha_rows,
    )?;
    Ok(())
}
