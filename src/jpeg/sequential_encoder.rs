//! One sequential scan with the standard Huffman tables (jchuff.c).

use crate::bit_writer::{BitBuffer, PendingBits};
use crate::block::{self, Block, Zigzag};
use crate::huffman::{STANDARD_AC, STANDARD_DC, Spec, categorize, categorize_ac};
use crate::segment_writer::{AC_CLASS, write_huffman_table, write_scan_header};
use crate::strips::Strips;
use crate::{Result, batches, wrapped};
use core::hint::cold_path;

/// The most MCUs that are transformed before they are coded. They fit in the L1 cache.
const MCUS_IN_BATCH: usize = 16;

/// For each symbol: its code, shifted to make room for the extra bits, and the length of both.
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

/// DC and AC. 512, because the compiler only knows that a size fits in a byte.
type BlockCodes = (SpacedCodes<16>, SpacedCodes<512>);

static LUMA_CODES: BlockCodes = (
    SpacedCodes::new(&STANDARD_DC[0]),
    SpacedCodes::new(&STANDARD_AC[0]),
);
static CHROMA_CODES: BlockCodes = (
    SpacedCodes::new(&STANDARD_DC[1]),
    SpacedCodes::new(&STANDARD_AC[1]),
);

/// Stores at least every 56 bits: two AC codes of up to 26, or one with EOB and the next DC code.
#[inline(always)]
fn write_block(
    (block, &[nonzero]): (&Block, &[u64; 1]),
    prediction: &mut i16,
    (dc, ac): &BlockCodes,
    bits: &mut PendingBits,
    buffer: &mut BitBuffer<'_>,
) -> Result<()> {
    dc.add(bits, 0, categorize((block.dc() - *prediction).into()));
    *prediction = block.dc();
    bits.store(buffer);
    bits.make_room(buffer)?;

    let (mut left, mut next) = (nonzero & !1, 1);
    let mut add_next = |left: &mut u64, bits: &mut PendingBits, buffer: &mut BitBuffer<'_>| {
        let k = left.trailing_zeros() as usize;
        let mut run = k - next;
        while run > 15 {
            cold_path();
            // ZRL
            ac.add(bits, 15, (0, 0));
            bits.store(buffer);
            run -= 16;
        }
        ac.add(bits, run, categorize_ac(block.at(k)));
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
        // EOB
        ac.add(bits, 0, (0, 0));
    }
    Ok(())
}

pub(crate) fn write_scan(out: &mut Vec<u8>, strips: &mut Strips<'_>) -> Result<()> {
    for ((number, dc), ac) in (0..).zip(&STANDARD_DC).zip(&STANDARD_AC) {
        write_huffman_table(out, number, dc)?;
        write_huffman_table(out, AC_CLASS + number, ac)?;
    }
    write_scan_header(out, &[[1, 0x00], [2, 0x11], [3, 0x11]], [0, 63, 0])?;

    let (mcus, luma) = (strips.size_in_mcus(), strips.size_in_luma_blocks());

    let mut luma_blocks = [[[block::ZERO; 2]; MCUS_IN_BATCH]; 2];
    let mut luma_masks = [[[[0; 1]; 2]; MCUS_IN_BATCH]; 2];
    let mut chroma_blocks = [[block::ZERO; MCUS_IN_BATCH]; 2];
    let mut chroma_masks = [[[0; 1]; MCUS_IN_BATCH]; 2];
    let [mut y, mut cb, mut cr] = [0; 3];
    let (mut buffer, mut bits) = (BitBuffer::new(out), PendingBits::NONE);
    for mcu_row in 0..mcus.high {
        strips.convert(mcu_row)?;
        for [first, count] in batches(mcus.wide, MCUS_IN_BATCH) {
            for (row, (blocks, masks)) in luma_blocks.iter_mut().zip(&mut luma_masks).enumerate() {
                let blocks = blocks.split_at_mut(count).0.as_flattened_mut();
                let masks = masks.split_at_mut(count).0.as_flattened_mut();
                strips.transform(0, (2 * first, row), blocks, masks)?;
            }
            let chroma_rows = chroma_blocks.iter_mut().zip(&mut chroma_masks);
            for (component, (blocks, masks)) in (1..).zip(chroma_rows) {
                let (blocks, masks) = (blocks.split_at_mut(count).0, masks.split_at_mut(count).0);
                strips.transform(component, (first, 0), blocks, masks)?;
            }

            for mcu in 0..count {
                for (row, (blocks, masks)) in luma_blocks.iter().zip(&luma_masks).enumerate() {
                    let pair = wrapped(blocks, mcu).iter().zip(wrapped(masks, mcu));
                    for (column, block) in pair.enumerate() {
                        if 2 * (first + mcu) + column < luma.wide && 2 * mcu_row + row < luma.high {
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
