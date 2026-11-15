//! Writes the bytes that `tj3Compress8()` does with 4:2:0 subsampling.

use crate::bit_writer::{BitBuffer, PendingBits};
use crate::block::{self, Block, NATURAL_ORDER, Zigzag};
use crate::header::MAX_DIMENSION;
use crate::huffman::{STANDARD_AC, STANDARD_DC, Spec};
use crate::marker::*;
use crate::{Error, Result, filled, progressive_encoder, wrapped};
use bun_highway::JPEG_PIXEL_GROUP;
use core::hint::cold_path;

/// For luma, then chroma, row by row (ITU-T T.81, K.1).
#[rustfmt::skip]
static STANDARD_QUANT: [[u8; 64]; 2] = [
    [
        16, 11, 10, 16,  24,  40,  51,  61,
        12, 12, 14, 19,  26,  58,  60,  55,
        14, 13, 16, 24,  40,  57,  69,  56,
        14, 17, 22, 29,  51,  87,  80,  62,
        18, 22, 37, 56,  68, 109, 103,  77,
        24, 35, 55, 64,  81, 104, 113,  92,
        49, 64, 78, 87, 103, 121, 120, 101,
        72, 92, 95, 98, 112, 100, 103,  99,
    ],
    [
        17, 18, 24, 47, 99, 99, 99, 99,
        18, 21, 26, 66, 99, 99, 99, 99,
        24, 26, 56, 99, 99, 99, 99, 99,
        47, 66, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
        99, 99, 99, 99, 99, 99, 99, 99,
    ],
];

const ICC_SEGMENT_LEN: usize = 65519;
const MCU_SIZE: usize = 16;
/// So many MCUs wait to be coded at most. They fit in the L1 cache.
const BATCH_LEN: usize = 16;

/// How many bits a number takes, and those bits.
#[inline(always)]
pub(crate) const fn magnitude(value: i32) -> (u32, u32) {
    let size = 32 - value.unsigned_abs().leading_zeros();
    (size, (value + (value >> 31)) as u32 & ((1 << size) - 1))
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static AC_MAGNITUDES: [(u8, u16); 2048] = {
    let mut magnitudes = [(0, 0); 2048];
    let mut value = -1024;
    while value < 1024 {
        let (size, bits) = magnitude(value);
        magnitudes[value as usize % 2048] = (size as u8, bits as u16);
        value += 1;
    }
    magnitudes
};

/// [`magnitude`] of an AC coefficient, which is at most 8 times a sample.
#[inline(always)]
pub(crate) fn ac_magnitude(value: i16) -> (u32, u32) {
    let (size, bits) = *wrapped(&AC_MAGNITUDES, value as usize);
    (size.into(), bits.into())
}

/// In zigzag order.
fn quant_table(standard: &[u8; 64], quality: u8) -> [u8; 64] {
    let quality = u32::from(quality.clamp(1, 100));
    let scale = if quality < 50 {
        5000 / quality
    } else {
        200 - 2 * quality
    };
    NATURAL_ORDER.map(|at| {
        let step = u32::from(*wrapped(standard, at.into()));
        ((step * scale + 50) / 100).clamp(1, 255) as u8
    })
}

/// What makes the kernel divide by 8 times the steps, and round. It is exact for up to 15 bits.
fn divisors(quant: &[u8; 64]) -> [Block; 3] {
    let [mut rounding, mut reciprocals, mut scales] = [block::ZERO; 3];
    for (k, &step) in quant.iter().enumerate() {
        let divisor = 8 * u32::from(step);
        let shift = 16 + (divisor - 1).ilog2();
        *rounding.at_mut(k) = (divisor / 2) as i16;
        *reciprocals.at_mut(k) = (1u32 << shift).div_ceil(divisor) as i16;
        *scales.at_mut(k) = (1 << (32 - shift)) as i16;
    }
    [rounding, reciprocals, scales]
}

fn write_segment(out: &mut Vec<u8>, marker: u8, parts: &[&[u8]]) -> Result<()> {
    let len = 2 + parts.iter().map(|part| part.len()).sum::<usize>();
    out.try_reserve(2 + len)?;
    out.extend_from_slice(&[0xFF, marker]);
    out.extend_from_slice(&(len as u16).to_be_bytes());
    parts.iter().for_each(|part| out.extend_from_slice(part));
    Ok(())
}

/// To be added to the number of a table for AC coefficients.
pub(crate) const AC_CLASS: u8 = 0x10;

pub(crate) fn write_huffman_table(out: &mut Vec<u8>, number: u8, spec: &Spec) -> Result<()> {
    let symbols = spec.symbols.get(..spec.len()).ok_or(Error::Internal)?;
    write_segment(out, DHT, &[&[number], &spec.counts, symbols])
}

/// `components` have an id and the numbers of their tables.
pub(crate) fn write_scan_header(
    out: &mut Vec<u8>,
    components: &[[u8; 2]],
    band_and_shifts: [u8; 3],
) -> Result<()> {
    let count = [components.len() as u8];
    let parts = [&count, components.as_flattened(), &band_and_shifts];
    write_segment(out, SOS, &parts)
}

/// The Y, Cb and Cr of one row of MCUs at a time.
pub(crate) struct Strips<'a> {
    pixels: &'a [[u8; 4]],
    width: usize,
    height: usize,
    chroma_stride: usize,
    planes: [Vec<u8>; 3],
    divisors: [[Block; 3]; 2],
}

impl Strips<'_> {
    pub(crate) fn size_in_mcus(&self) -> (usize, usize) {
        (
            self.width.div_ceil(MCU_SIZE),
            self.height.div_ceil(MCU_SIZE),
        )
    }

    /// An MCU has 2 by 2, whether they are in the image or not.
    pub(crate) fn size_in_luma_blocks(&self) -> (usize, usize) {
        (self.width.div_ceil(8), self.height.div_ceil(8))
    }

    /// The last pixel of a row goes on to the end of the MCU, and so does the last row of samples.
    pub(crate) fn convert(&mut self, mcu_row: usize) {
        let (width, stride) = (self.width, self.chroma_stride);
        let top = mcu_row * MCU_SIZE;
        let rows = MCU_SIZE.min(self.height - top);
        let pixels = self.pixels.get(top * width..).unwrap_or_default();
        let mut convert = |pixels, pixel_stride, count, pairs, x: usize, first_pair: usize| {
            let at = first_pair * stride;
            let [y, cb, cr] = &mut self.planes;
            let planes = [(y, 4 * at + x), (cb, at + x / 2), (cr, at + x / 2)]
                .map(|(plane, at)| plane.get_mut(at..).unwrap_or_default());
            bun_highway::jpeg_rgba_to_ycc420(pixels, pixel_stride, count, pairs, planes, stride);
        };

        let whole = width - width % JPEG_PIXEL_GROUP;
        convert(pixels, width, whole, rows / 2, 0, 0);
        let last_row = pixels.get((rows - 1) * width..).unwrap_or_default();
        if rows % 2 == 1 {
            convert(last_row, 0, whole, 1, 0, rows / 2);
        }
        let mut edge = [[[0; 4]; JPEG_PIXEL_GROUP]; MCU_SIZE];
        if whole != width {
            let pixel_rows = pixels.chunks(width).chain([last_row]);
            for (to, row) in edge.iter_mut().zip(pixel_rows) {
                let rest = row.get(whole..width).unwrap_or_default();
                let (start, end) = to.split_at_mut(rest.len());
                start.copy_from_slice(rest);
                end.fill(rest.last().copied().unwrap_or_default());
            }
            let (edge, len) = (edge.as_flattened(), JPEG_PIXEL_GROUP);
            convert(edge, len, len, rows.div_ceil(2), whole, 0);
        }

        for (plane, scale) in self.planes.iter_mut().zip([2, 1, 1]) {
            let (stride, filled) = (scale * stride, scale * rows.div_ceil(2));
            for row in filled..8 * scale {
                plane.copy_within((filled - 1) * stride..filled * stride, row * stride);
            }
        }
    }

    /// Fills `blocks` with those of `component` from `x` on, in row `y` of the strip.
    pub(crate) fn transform<const MASKS: usize>(
        &self,
        component: usize,
        (x, y): (usize, usize),
        blocks: &mut [Block],
        masks: &mut [[u64; MASKS]],
    ) {
        let is_chroma = usize::from(component != 0);
        let stride = self.chroma_stride * (2 - is_chroma);
        let plane = self.planes.get(component);
        let samples = plane.and_then(|plane| plane.get(8 * (y * stride + x)..));
        let divisors = wrapped(&self.divisors, is_chroma);
        bun_highway::jpeg_forward_transform(
            samples.unwrap_or_default(),
            stride,
            divisors,
            blocks,
            masks,
        );
    }
}

/// For each symbol: its code with room for the bits that follow, and the length of both.
struct SpacedCodes<const N: usize>([(u32, u32); N]);

impl<const N: usize> SpacedCodes<N> {
    #[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
    const fn new(spec: &Spec) -> Self {
        let mut codes = [(0, 0); N];
        let (mut code, mut at, mut length) = (0, 0, 1);
        while length <= 16 {
            let end = at + spec.counts[length as usize - 1] as usize;
            while at < end {
                let size = spec.symbols[at] as u32 & 15;
                codes[spec.symbols[at] as usize] = (code << size, length + size);
                (code, at) = (code + 1, at + 1);
            }
            (code, length) = (code << 1, length + 1);
        }
        Self(codes)
    }

    #[inline(always)]
    fn add(&self, bits: &mut PendingBits, run: usize, (size, extra): (u32, u32)) {
        let (code, length) = *wrapped(&self.0, 16 * run + size as usize);
        bits.add((code | extra).into(), length);
    }
}

/// The compiler knows no more of the size of an AC coefficient than that it is a byte. So this has room for any.
type BlockCodes = (SpacedCodes<16>, SpacedCodes<512>);

static LUMA_CODES: BlockCodes = (
    SpacedCodes::new(&STANDARD_DC[0]),
    SpacedCodes::new(&STANDARD_AC[0]),
);
static CHROMA_CODES: BlockCodes = (
    SpacedCodes::new(&STANDARD_DC[1]),
    SpacedCodes::new(&STANDARD_AC[1]),
);

/// Between stores fit two codes of 26 bits with what follows them, or a last one, the end and the next block's first.
#[inline(always)]
fn write_block(
    (block, &[nonzero]): (&Block, &[u64; 1]),
    prediction: &mut i16,
    (dc, ac): &BlockCodes,
    bits: &mut PendingBits,
    buffer: &mut BitBuffer<'_>,
) -> Result<()> {
    dc.add(bits, 0, magnitude((block.0[0] - *prediction).into()));
    *prediction = block.0[0];
    bits.store(buffer);
    bits.make_room(buffer)?;

    let (mut left, mut next) = (nonzero & !1, 1);
    let mut add_next = |left: &mut u64, bits: &mut PendingBits, buffer: &mut BitBuffer<'_>| {
        let k = left.trailing_zeros() as usize;
        let mut run = k - next;
        while run > 15 {
            cold_path();
            ac.add(bits, 15, (0, 0));
            bits.store(buffer);
            run -= 16;
        }
        ac.add(bits, run, ac_magnitude(block.at(k)));
        next = k + 1;
        *left &= *left - 1;
    };
    while left != 0 {
        add_next(&mut left, bits, buffer);
        if left == 0 {
            break;
        }
        add_next(&mut left, bits, buffer);
        bits.store(buffer);
    }
    if next != 64 {
        ac.add(bits, 0, (0, 0));
    }
    Ok(())
}

fn write_baseline(out: &mut Vec<u8>, strips: &mut Strips<'_>) -> Result<()> {
    for ((number, dc), ac) in (0..).zip(&STANDARD_DC).zip(&STANDARD_AC) {
        write_huffman_table(out, number, dc)?;
        write_huffman_table(out, AC_CLASS + number, ac)?;
    }
    write_scan_header(out, &[[1, 0x00], [2, 0x11], [3, 0x11]], [0, 63, 0])?;

    let (mcus_wide, mcus_high) = strips.size_in_mcus();
    let (blocks_wide, blocks_high) = strips.size_in_luma_blocks();

    let mut luma_blocks = [[[block::ZERO; 2]; BATCH_LEN]; 2];
    let mut luma_masks = [[[[0; 1]; 2]; BATCH_LEN]; 2];
    let mut chroma_blocks = [[block::ZERO; BATCH_LEN]; 2];
    let mut chroma_masks = [[[0; 1]; BATCH_LEN]; 2];
    let [mut y, mut cb, mut cr] = [0; 3];
    let (mut buffer, mut bits) = (BitBuffer::new(out), PendingBits::NONE);
    for mcu_row in 0..mcus_high {
        strips.convert(mcu_row);
        for first in (0..mcus_wide).step_by(BATCH_LEN) {
            let count = BATCH_LEN.min(mcus_wide - first);
            for (row, (blocks, masks)) in luma_blocks.iter_mut().zip(&mut luma_masks).enumerate() {
                let blocks = blocks.split_at_mut(count).0.as_flattened_mut();
                let masks = masks.split_at_mut(count).0.as_flattened_mut();
                strips.transform(0, (2 * first, row), blocks, masks);
            }
            let chroma_rows = chroma_blocks.iter_mut().zip(&mut chroma_masks);
            for (component, (blocks, masks)) in (1..).zip(chroma_rows) {
                let (blocks, masks) = (blocks.split_at_mut(count).0, masks.split_at_mut(count).0);
                strips.transform(component, (first, 0), blocks, masks);
            }

            for mcu in 0..count {
                for (row, (blocks, masks)) in luma_blocks.iter().zip(&luma_masks).enumerate() {
                    let pair = wrapped(blocks, mcu).iter().zip(wrapped(masks, mcu));
                    for (column, block) in pair.enumerate() {
                        if 2 * (first + mcu) + column < blocks_wide
                            && 2 * mcu_row + row < blocks_high
                        {
                            write_block(block, &mut y, &LUMA_CODES, &mut bits, &mut buffer)?;
                        } else {
                            let filler = (&block::ZERO, &[0]);
                            write_block(filler, &mut 0, &LUMA_CODES, &mut bits, &mut buffer)?;
                        }
                    }
                }
                let chroma_rows = chroma_blocks.iter().zip(&chroma_masks);
                for ((blocks, masks), prediction) in chroma_rows.zip([&mut cb, &mut cr]) {
                    let block = (wrapped(blocks, mcu), wrapped(masks, mcu));
                    write_block(block, prediction, &CHROMA_CODES, &mut bits, &mut buffer)?;
                }
            }
        }
    }
    bits.finish(&mut buffer)
}

/// `quality` is from 1 to 100. Alpha is ignored, and so is a profile that is too long for the format.
pub fn encode(
    rgba: &[u8],
    width: u32,
    height: u32,
    quality: u8,
    progressive: bool,
    icc_profile: Option<&[u8]>,
) -> Result<Vec<u8>> {
    if ![width, height]
        .iter()
        .all(|size| (1..=MAX_DIMENSION).contains(size))
    {
        return Err(Error::InvalidSize);
    }
    let pixels = rgba.as_chunks().0;
    if pixels.len() as u64 != u64::from(width) * u64::from(height) {
        return Err(Error::InvalidBufferSize);
    }

    let mut out = Vec::new();
    // A photo of good quality has about 2 bits for each pixel.
    out.try_reserve(1024 + pixels.len() / 4)?;
    out.extend_from_slice(&[0xFF, SOI]);
    // Version 1.1, square pixels, no thumbnail.
    write_segment(&mut out, APP0, &[&JFIF, &[1, 1, 0, 0, 1, 0, 1, 0, 0]])?;
    let icc_segments = icc_profile.unwrap_or_default().chunks(ICC_SEGMENT_LEN);
    if let Ok(count) = u8::try_from(icc_segments.len()) {
        for (number, data) in (1..=count).zip(icc_segments) {
            write_segment(&mut out, APP2, &[&ICC_PROFILE, &[number, count], data])?;
        }
    }
    let quant = STANDARD_QUANT
        .each_ref()
        .map(|standard| quant_table(standard, quality));
    for (number, table) in (0..).zip(&quant) {
        write_segment(&mut out, DQT, &[&[number], table])?;
    }
    let size = [height as u16, width as u16].map(u16::to_be_bytes);
    write_segment(
        &mut out,
        if progressive { SOF2 } else { SOF0 },
        &[
            &[8],
            size.as_flattened(),
            &[3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1],
        ],
    )?;

    let (width, height) = (width as usize, height as usize);
    let chroma_stride = width.next_multiple_of(JPEG_PIXEL_GROUP) / 2;
    let mut strips = Strips {
        pixels,
        width,
        height,
        chroma_stride,
        planes: [
            filled(32 * chroma_stride, 0)?,
            filled(8 * chroma_stride, 0)?,
            filled(8 * chroma_stride, 0)?,
        ],
        divisors: quant.each_ref().map(divisors),
    };
    if progressive {
        progressive_encoder::write_scans(&mut out, &mut strips)?;
    } else {
        write_baseline(&mut out, &mut strips)?;
    }
    out.try_reserve(2)?;
    out.extend_from_slice(&[0xFF, EOI]);
    let _ = out.try_shrink_to_fit();
    Ok(out)
}
