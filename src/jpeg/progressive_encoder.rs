//! The scans of `jpeg_simple_progression()` (jcphuff.c). One pass lists the symbols of all, to fit their tables to.

use crate::bit_writer::{BitBuffer, PendingBits, ROOM};
use crate::block::{self, Block, Zigzag};
use crate::encoder::{
    AC_CLASS, Strips, ac_magnitude, magnitude, write_huffman_table, write_scan_header,
};
use crate::header::MAX_COMPONENTS;
use crate::huffman::{EncodeTable, Spec};
use crate::{Result, filled, wrapped_mut};

const BATCH_LEN: usize = 64;
/// 63 coefficients, with codes for runs of zeros and corrections between them, and the end.
const MAX_TOKENS_IN_BLOCK: usize = 80;

const ZEROS: u32 = 0xF0;
/// It has no code.
const NO_SYMBOL: u32 = 0xFF;
const MAX_TOKEN_BITS: u32 = 19;
const MAX_END_RUN: u32 = 0x7FFF;
/// What libjpeg has room for, less what the next block can add.
const MAX_END_RUN_BITS: u32 = 1000 - 63;

/// 8 bits with a symbol, 5 with the number of bits that follow its code, then those.
const fn token(symbol: u32, count: u32, bits: u32) -> u32 {
    symbol | count << 8 | bits << 13
}

/// A list does not grow past this. Another follows it, which takes no copy and leaves little room unused.
const MAX_LIST_LEN: usize = 1 << 16;

struct Tokens {
    full_lists: Vec<Vec<u32>>,
    tokens: Vec<u32>,
    frequencies: [u64; 256],
    /// How many blocks in a row have nothing more to say, and where in which list the token that says so goes.
    end_run: u32,
    end_run_at: (usize, usize),
    /// How many bits come after that token.
    end_run_bits: u32,
}

impl Tokens {
    const NONE: Self = Self {
        full_lists: Vec::new(),
        tokens: Vec::new(),
        frequencies: [0; 256],
        end_run: 0,
        end_run_at: (0, 0),
        end_run_bits: 0,
    };

    fn make_room(&mut self, count: usize) -> Result<()> {
        if self.tokens.spare_capacity_mut().len() < count {
            let mut next = Vec::new();
            next.try_reserve_exact((2 * self.tokens.capacity()).min(MAX_LIST_LEN).max(count))?;
            self.full_lists.try_reserve(1)?;
            let full = core::mem::replace(&mut self.tokens, next);
            self.full_lists.push(full);
        }
        Ok(())
    }

    #[inline(always)]
    fn push(&mut self, symbol: u32, count: u32, bits: u32) {
        *wrapped_mut(&mut self.frequencies, symbol as usize) += 1;
        self.tokens.push(token(symbol, count, bits));
    }

    /// `symbol`, followed by the `count` highest of `bits`.
    #[inline(always)]
    fn push_long(&mut self, mut symbol: u32, mut count: u32, mut bits: u64) {
        while count > MAX_TOKEN_BITS {
            self.push(
                symbol,
                MAX_TOKEN_BITS,
                (bits >> (64 - MAX_TOKEN_BITS)) as u32,
            );
            (symbol, count) = (NO_SYMBOL, count - MAX_TOKEN_BITS);
            bits <<= MAX_TOKEN_BITS;
        }
        self.push(symbol, count, (bits >> 1 >> (63 - count)) as u32);
    }

    #[inline(always)]
    fn extend_end_run(&mut self, count: u32, bits: u64) {
        if self.end_run == 0 {
            self.end_run_at = (self.full_lists.len(), self.tokens.len());
            self.tokens.push(NO_SYMBOL);
        }
        self.end_run += 1;
        if count != 0 {
            self.push_long(NO_SYMBOL, count, bits);
            self.end_run_bits += count;
        }
        if self.end_run == MAX_END_RUN || self.end_run_bits > MAX_END_RUN_BITS {
            self.close_end_run();
        }
    }

    #[inline(always)]
    fn close_end_run(&mut self) {
        let Some(count) = self.end_run.checked_ilog2() else {
            return;
        };
        *wrapped_mut(&mut self.frequencies, (count as usize) << 4) += 1;
        let (list, at) = self.end_run_at;
        let list = self.full_lists.get_mut(list).unwrap_or(&mut self.tokens);
        if let Some(to) = list.get_mut(at) {
            *to = token(count << 4, count, self.end_run ^ 1 << count);
        }
        (self.end_run, self.end_run_bits) = (0, 0);
    }

    /// The coefficients `FIRST` to `LAST` without their `SHIFT` low bits. `nonzero` has those of which something is left.
    #[inline(always)]
    fn add_first<const FIRST: usize, const LAST: usize, const SHIFT: u32>(
        &mut self,
        block: &Block,
        nonzero: u64,
    ) {
        let mut left = nonzero & u64::MAX << FIRST & u64::MAX >> (63 - LAST);
        let mut previous = FIRST - 1;
        if left != 0 {
            self.close_end_run();
        }
        while left != 0 {
            let k = left.trailing_zeros() as usize;
            let mut run = (k - previous - 1) as u32;
            while run > 15 {
                self.push(ZEROS, 0, 0);
                run -= 16;
            }
            let (size, bits) = ac_magnitude(block.at(k) / (1 << SHIFT));
            self.push(run << 4 | size, size, bits);
            previous = k;
            left &= left - 1;
        }
        if previous != LAST {
            self.extend_end_run(0, 0);
        }
    }

    /// One more bit, `bit`, of all AC coefficients. `known` has those with higher bits.
    #[inline(always)]
    fn add_refinement(&mut self, known: u64, bit: u64, negative: u64) {
        let mut ahead = !1;
        let known = known & ahead;
        let mut new = bit & !known & ahead;

        // The bits of the known ones, the first at the top.
        let (mut corrections, mut left) = (0u64, known);
        while left != 0 {
            corrections = corrections << 1 | bit >> left.trailing_zeros() & 1;
            left &= left - 1;
        }
        corrections = corrections.unbounded_shl(64 - known.count_ones());

        if new != 0 {
            self.close_end_run();
        }
        while new != 0 {
            let through = new ^ (new - 1);
            let mut run = (ahead & through & !known).count_ones() - 1;
            while run > 15 {
                let mut zeros = ahead & !known;
                for _ in 0..15 {
                    zeros &= zeros - 1;
                }
                let through = zeros ^ (zeros - 1);
                let count = (ahead & through & known).count_ones();
                self.push_long(ZEROS, count, corrections);
                corrections <<= count;
                ahead &= !through;
                run -= 16;
            }
            let count = (ahead & through & known).count_ones();
            let is_positive = u64::from(negative & new & through == 0);
            self.push_long(
                run << 4 | 1,
                1 + count,
                is_positive << 63 | corrections >> 1,
            );
            corrections <<= count;
            ahead &= !through;
            new &= !through;
        }
        if ahead != 0 {
            self.extend_end_run((ahead & known).count_ones(), corrections);
        }
    }

    fn write(&self, out: &mut Vec<u8>, table: &EncodeTable) -> Result<()> {
        let (mut buffer, mut bits) = (BitBuffer::new(out), PendingBits::NONE);
        let lists = self.full_lists.iter().chain([&self.tokens]);
        for tokens in lists.flat_map(|list| list.chunks(ROOM / 5)) {
            bits.make_room(&mut buffer)?;
            for &token in tokens {
                let (code, length) = table.code(token as usize);
                let count = token >> 8 & 31;
                let both = u64::from(code) << count | u64::from(token >> 13);
                bits.add(both, length + count);
                bits.store(&mut buffer);
            }
        }
        bits.finish(&mut buffer)
    }

    fn write_ac_scan(mut self, out: &mut Vec<u8>, id: u8, band_and_shifts: [u8; 3]) -> Result<()> {
        self.close_end_run();
        *wrapped_mut(&mut self.frequencies, NO_SYMBOL as usize) = 0;
        let (spec, number) = (Spec::optimal(&self.frequencies), u8::from(id != 1));
        write_huffman_table(out, AC_CLASS + number, &spec)?;
        write_scan_header(out, &[[id, number]], band_and_shifts)?;
        self.write(out, &EncodeTable::new(&spec))
    }

    /// The symbols for chroma are 16 more than those in the file.
    fn write_first_dc_scan(self, out: &mut Vec<u8>) -> Result<()> {
        let [luma, chroma] = [0, 16].map(|first| {
            let mut frequencies = [0; 256];
            let used = self.frequencies.iter().skip(first).take(16);
            frequencies
                .iter_mut()
                .zip(used)
                .for_each(|(to, &n)| *to = n);
            Spec::optimal(&frequencies)
        });
        write_huffman_table(out, 0, &luma)?;
        write_huffman_table(out, 1, &chroma)?;
        write_scan_header(out, &[[1, 0x00], [2, 0x10], [3, 0x10]], [0, 0, 0x01])?;
        let mut table = EncodeTable::new(&luma);
        table.add(&chroma, 16);
        self.write(out, &table)
    }
}

pub(crate) fn write_scans(out: &mut Vec<u8>, strips: &mut Strips<'_>) -> Result<()> {
    let [mut dc_first, mut dc_last] = [Tokens::NONE; 2];
    let [mut y_low, mut y_high, mut y_second, mut y_last] = [Tokens::NONE; 4];
    let [mut cb, mut cr] = [const { [Tokens::NONE; 2] }; 2];

    let (mcus, luma) = (strips.size_in_mcus(), strips.size_in_luma_blocks());
    let mut blocks = [block::ZERO; BATCH_LEN];
    let mut masks = [[0; 4]; BATCH_LEN];
    // For each MCU in the row.
    let mut dc = filled(mcus.wide, [0i16; 8])?;
    let mut predictions = [0; MAX_COMPONENTS];
    for mcu_row in 0..mcus.high {
        strips.convert(mcu_row);
        let rows = (luma.high - 2 * mcu_row).min(2);
        for row in 0..rows {
            for x in (0..luma.wide).step_by(BATCH_LEN) {
                let count = BATCH_LEN.min(luma.wide - x);
                let (blocks, masks) = (blocks.split_at_mut(count).0, masks.split_at_mut(count).0);
                strips.transform(0, (x, row), blocks, masks);
                for scan in [&mut y_low, &mut y_high, &mut y_second, &mut y_last] {
                    scan.make_room(count * MAX_TOKENS_IN_BLOCK)?;
                }
                for (block, &[bit0, bit1, higher, negative]) in blocks.iter().zip(&*masks) {
                    y_low.add_first::<1, 5, 2>(block, higher);
                    y_high.add_first::<6, 63, 2>(block, higher);
                    y_second.add_refinement(higher, bit1, negative);
                    y_last.add_refinement(higher | bit1, bit0, negative);
                }
                for (dc, pair) in dc.iter_mut().skip(x / 2).zip(blocks.chunks(2)) {
                    // What is right of the image is like the block before it.
                    let of = |block: Option<&Block>| block.map_or(0, |block| block.0[0]);
                    *wrapped_mut(dc, 2 * row) = of(pair.first());
                    *wrapped_mut(dc, 2 * row + 1) = of(pair.last());
                }
            }
        }
        for (component, [first, last]) in [(1, &mut cb), (2, &mut cr)] {
            for x in (0..mcus.wide).step_by(BATCH_LEN) {
                let count = BATCH_LEN.min(mcus.wide - x);
                let (blocks, masks) = (blocks.split_at_mut(count).0, masks.split_at_mut(count).0);
                strips.transform(component, (x, 0), blocks, masks);
                first.make_room(count * MAX_TOKENS_IN_BLOCK)?;
                last.make_room(count * MAX_TOKENS_IN_BLOCK)?;
                for (block, &[bit0, bit1, higher, negative]) in blocks.iter().zip(&*masks) {
                    first.add_first::<1, 63, 1>(block, higher | bit1);
                    last.add_refinement(higher | bit1, bit0, negative);
                }
                for (dc, block) in dc.iter_mut().skip(x).zip(&*blocks) {
                    *wrapped_mut(dc, 3 + component) = block.0[0];
                }
            }
        }

        dc_first.make_room(6 * mcus.wide)?;
        dc_last.make_room(mcus.wide)?;
        for dc in &mut dc {
            if rows == 1 {
                // So is what is below it.
                (dc[2], dc[3]) = (dc[1], dc[1]);
            }
            let mut low_bits = 0;
            for (&value, component) in dc.iter().zip([0, 0, 0, 0, 1, 2]) {
                let prediction = wrapped_mut(&mut predictions, component);
                let (size, bits) = magnitude(((value >> 1) - *prediction).into());
                dc_first.push(size | u32::from(component != 0) << 4, size, bits);
                *prediction = value >> 1;
                low_bits = low_bits << 1 | (value & 1) as u32;
            }
            dc_last.tokens.push(token(NO_SYMBOL, 6, low_bits));
        }
    }

    let ([cb_first, cb_last], [cr_first, cr_last]) = (cb, cr);
    dc_first.write_first_dc_scan(out)?;
    y_low.write_ac_scan(out, 1, [1, 5, 0x02])?;
    cr_first.write_ac_scan(out, 3, [1, 63, 0x01])?;
    cb_first.write_ac_scan(out, 2, [1, 63, 0x01])?;
    y_high.write_ac_scan(out, 1, [6, 63, 0x02])?;
    y_second.write_ac_scan(out, 1, [1, 63, 0x21])?;
    write_scan_header(out, &[[1, 0], [2, 0], [3, 0]], [0, 0, 0x10])?;
    dc_last.write(out, &EncodeTable::EMPTY)?;
    cr_last.write_ac_scan(out, 3, [1, 63, 0x10])?;
    cb_last.write_ac_scan(out, 2, [1, 63, 0x10])?;
    y_last.write_ac_scan(out, 1, [1, 63, 0x10])
}
