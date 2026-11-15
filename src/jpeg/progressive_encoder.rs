//! The scans of `jpeg_simple_progression()` (jcphuff.c). One pass collects the symbols of all scans, for optimal tables.

use crate::bit_writer::{BitBuffer, PendingBits, ROOM};
use crate::block::{self, Block, Zigzag, band, without_lowest};
use crate::huffman::{EncodeTable, Spec, categorize, categorize_ac};
use crate::segment_writer::{AC_CLASS, write_huffman_table, write_scan_header};
use crate::strips::Strips;
use crate::{Error, MAX_COMPONENTS, Result, batches, filled, wrapped_mut};
use core::mem::take;

const BATCH_LEN: usize = 64;
/// 63 coefficients, ZRLs, corrections that overflow a token, and EOB.
const MAX_TOKENS_IN_BLOCK: usize = 80;

const ZRL: u32 = 0xF0;
/// For tokens that are only bits.
const NO_SYMBOL: u32 = 0xFF;
/// Added to the symbols for chroma in the first DC scan, which has two tables.
const CHROMA_DC: u32 = 16;
const MAX_TOKEN_BITS: u32 = 19;
const TOKENS_IN_ROOM: usize = ROOM / (16 + MAX_TOKEN_BITS as usize).div_ceil(8);
const MAX_EOB_RUN: u32 = 0x7FFF;
/// libjpeg's `MAX_CORR_BITS`, less what the next block can add.
const MAX_EOB_RUN_BITS: u32 = 1000 - 63;

/// From the low bits up: 8 for the symbol, 5 for `count`, then the extra bits.
const fn token(symbol: u32, count: u32, bits: u32) -> u32 {
    symbol | count << 8 | bits << 13
}

/// A full list is followed by a new one, which takes no copy and leaves little capacity unused.
const MAX_LIST_LEN: usize = 1 << 16;

struct Tokens {
    full_lists: Vec<Vec<u32>>,
    tokens: Vec<u32>,
    frequencies: [u64; 256],
    /// The pending EOB run, and the list and index of the token that is reserved for it.
    eob_run: u32,
    eob_run_at: (usize, usize),
    /// The correction bits after that token.
    eob_run_bits: u32,
}

impl Tokens {
    const NONE: Self = Self {
        full_lists: Vec::new(),
        tokens: Vec::new(),
        frequencies: [0; 256],
        eob_run: 0,
        eob_run_at: (0, 0),
        eob_run_bits: 0,
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
    fn extend_eob_run(&mut self, count: u32, bits: u64) {
        if self.eob_run == 0 {
            self.eob_run_at = (self.full_lists.len(), self.tokens.len());
            self.tokens.push(NO_SYMBOL);
        }
        self.eob_run += 1;
        if count != 0 {
            self.push_long(NO_SYMBOL, count, bits);
            self.eob_run_bits += count;
        }
        if self.eob_run == MAX_EOB_RUN || self.eob_run_bits > MAX_EOB_RUN_BITS {
            self.close_eob_run();
        }
    }

    #[inline(always)]
    fn close_eob_run(&mut self) {
        let Some(count) = self.eob_run.checked_ilog2() else {
            return;
        };
        *wrapped_mut(&mut self.frequencies, (count as usize) << 4) += 1;
        let (list, at) = self.eob_run_at;
        let list = self.full_lists.get_mut(list).unwrap_or(&mut self.tokens);
        if let Some(to) = list.get_mut(at) {
            *to = token(count << 4, count, self.eob_run ^ 1 << count);
        }
        (self.eob_run, self.eob_run_bits) = (0, 0);
    }

    /// A first scan of `FIRST..=LAST` with `Al = SHIFT`. `nonzero` marks what is nonzero after the shift.
    #[inline(always)]
    fn add_first<const FIRST: usize, const LAST: usize, const SHIFT: u32>(
        &mut self,
        block: &Block,
        nonzero: u64,
    ) {
        let mut left = nonzero & band(FIRST as u32, LAST as u32);
        let mut previous = FIRST - 1;
        if left != 0 {
            self.close_eob_run();
        }
        while left != 0 {
            let k = left.trailing_zeros() as usize;
            let mut run = (k - previous - 1) as u32;
            while run > 15 {
                self.push(ZRL, 0, 0);
                run -= 16;
            }
            let (size, bits) = categorize_ac(block.at(k) / (1 << SHIFT));
            self.push(run << 4 | size, size, bits);
            previous = k;
            left &= left - 1;
        }
        if previous != LAST {
            self.extend_eob_run(0, 0);
        }
    }

    /// Refines all AC coefficients by the bit plane `bit`. `known` marks those that have higher bits.
    #[inline(always)]
    fn add_refinement(&mut self, known: u64, bit: u64, negative: u64) {
        let mut ahead = !1;
        let known = known & ahead;
        let mut new = bit & !known & ahead;

        // The correction bits of `known`, the first at the top.
        let (mut corrections, mut left) = (0u64, known);
        while left != 0 {
            corrections = corrections << 1 | bit >> left.trailing_zeros() & 1;
            left &= left - 1;
        }
        corrections = corrections.unbounded_shl(64 - known.count_ones());

        if new != 0 {
            self.close_eob_run();
        }
        while new != 0 {
            let through = new ^ (new - 1);
            let mut run = (ahead & through & !known).count_ones() - 1;
            while run > 15 {
                let zeros = without_lowest(ahead & !known, 15);
                let through = zeros ^ (zeros - 1);
                let count = (ahead & through & known).count_ones();
                self.push_long(ZRL, count, corrections);
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
            self.extend_eob_run((ahead & known).count_ones(), corrections);
        }
    }

    /// Writes the tokens, and frees them.
    fn write(&mut self, out: &mut Vec<u8>, table: &EncodeTable) -> Result<()> {
        let (mut buffer, mut bits) = (BitBuffer::new(out), PendingBits::NONE);
        let (full_lists, last) = (take(&mut self.full_lists), take(&mut self.tokens));
        let lists = full_lists.iter().chain([&last]);
        for tokens in lists.flat_map(|list| list.chunks(TOKENS_IN_ROOM)) {
            bits.make_room(&mut buffer)?;
            for &token in tokens {
                let (code, length) = table.code((token & 0xFF) as usize);
                let count = token >> 8 & 31;
                let both = u64::from(code) << count | u64::from(token >> 13);
                bits.add(both, length + count);
                bits.store(&mut buffer);
            }
        }
        bits.finish(&mut buffer)
    }

    fn write_ac_scan(&mut self, out: &mut Vec<u8>, id: u8, ss_se_ah_al: [u8; 3]) -> Result<()> {
        self.close_eob_run();
        let [symbols @ .., _no_symbol] = &self.frequencies;
        let (spec, number) = (Spec::optimal(symbols), u8::from(id != 1));
        write_huffman_table(out, AC_CLASS + number, &spec)?;
        write_scan_header(out, &[[id, number]], ss_se_ah_al)?;
        self.write(out, &EncodeTable::new(&spec))
    }

    fn write_first_dc_scan(&mut self, out: &mut Vec<u8>) -> Result<()> {
        let (luma, chroma) = self.frequencies.split_at(CHROMA_DC as usize);
        let [luma, chroma] = [luma, chroma].map(Spec::optimal);
        write_huffman_table(out, 0, &luma)?;
        write_huffman_table(out, 1, &chroma)?;
        write_scan_header(out, &[[1, 0x00], [2, 0x10], [3, 0x10]], [0, 0, 0x01])?;
        let mut table = EncodeTable::new(&luma);
        table.add(&chroma, CHROMA_DC as usize);
        self.write(out, &table)
    }
}

pub(crate) fn write_scans(out: &mut Vec<u8>, strips: &mut Strips<'_>) -> Result<()> {
    let mut scans = Vec::new();
    scans.try_reserve_exact(10)?;
    scans.resize_with(10, || Tokens::NONE);
    let [
        dc_first,
        dc_refine,
        y_low,
        y_high,
        y_second,
        y_refine,
        cb_first,
        cb_refine,
        cr_first,
        cr_refine,
    ] = scans.first_chunk_mut().ok_or(Error::Internal)?;

    let (mcus, luma) = (strips.size_in_mcus(), strips.size_in_luma_blocks());
    let mut blocks = [block::ZERO; BATCH_LEN];
    let mut masks = [[0; 4]; BATCH_LEN];
    // The 6 DC coefficients of each MCU in the row, in 8 places for `wrapped_mut()`.
    let mut dc = filled(mcus.wide, [0i16; 8])?;
    let mut predictions = [0; MAX_COMPONENTS];
    for mcu_row in 0..mcus.high {
        strips.convert(mcu_row)?;
        let rows = (luma.high - 2 * mcu_row).min(2);
        for row in 0..rows {
            for [x, count] in batches(luma.wide, BATCH_LEN) {
                let (blocks, masks) = (blocks.split_at_mut(count).0, masks.split_at_mut(count).0);
                strips.transform(0, (x, row), blocks, masks)?;
                for scan in [&mut *y_low, y_high, y_second, y_refine] {
                    scan.make_room(count * MAX_TOKENS_IN_BLOCK)?;
                }
                for (block, &[bit0, bit1, higher, negative]) in blocks.iter().zip(&*masks) {
                    y_low.add_first::<1, 5, 2>(block, higher);
                    y_high.add_first::<6, 63, 2>(block, higher);
                    y_second.add_refinement(higher, bit1, negative);
                    y_refine.add_refinement(higher | bit1, bit0, negative);
                }
                for (dc, pair) in dc.iter_mut().skip(x / 2).zip(blocks.chunks(2)) {
                    // A padding block repeats the DC of the block before it.
                    let of = |block: Option<&Block>| block.map_or(0, Block::dc);
                    *wrapped_mut(dc, 2 * row) = of(pair.first());
                    *wrapped_mut(dc, 2 * row + 1) = of(pair.last());
                }
            }
        }
        for (component, first, refine) in [
            (1, &mut *cb_first, &mut *cb_refine),
            (2, cr_first, cr_refine),
        ] {
            for [x, count] in batches(mcus.wide, BATCH_LEN) {
                let (blocks, masks) = (blocks.split_at_mut(count).0, masks.split_at_mut(count).0);
                strips.transform(component, (x, 0), blocks, masks)?;
                first.make_room(count * MAX_TOKENS_IN_BLOCK)?;
                refine.make_room(count * MAX_TOKENS_IN_BLOCK)?;
                for (block, &[bit0, bit1, higher, negative]) in blocks.iter().zip(&*masks) {
                    first.add_first::<1, 63, 1>(block, higher | bit1);
                    refine.add_refinement(higher | bit1, bit0, negative);
                }
                for (dc, block) in dc.iter_mut().skip(x).zip(&*blocks) {
                    *wrapped_mut(dc, 3 + component) = block.dc();
                }
            }
        }

        dc_first.make_room(6 * mcus.wide)?;
        dc_refine.make_room(mcus.wide)?;
        for dc in &mut dc {
            if rows == 1 {
                // The same for padding below the image.
                (dc[2], dc[3]) = (dc[1], dc[1]);
            }
            let mut low_bits = 0;
            for (&value, component) in dc.iter().zip([0, 0, 0, 0, 1, 2]) {
                let prediction = wrapped_mut(&mut predictions, component);
                let (size, bits) = categorize(((value >> 1) - *prediction).into());
                dc_first.push(size + CHROMA_DC * u32::from(component != 0), size, bits);
                *prediction = value >> 1;
                low_bits = low_bits << 1 | (value & 1) as u32;
            }
            dc_refine.tokens.push(token(NO_SYMBOL, 6, low_bits));
        }
    }

    dc_first.write_first_dc_scan(out)?;
    y_low.write_ac_scan(out, 1, [1, 5, 0x02])?;
    cr_first.write_ac_scan(out, 3, [1, 63, 0x01])?;
    cb_first.write_ac_scan(out, 2, [1, 63, 0x01])?;
    y_high.write_ac_scan(out, 1, [6, 63, 0x02])?;
    y_second.write_ac_scan(out, 1, [1, 63, 0x21])?;
    write_scan_header(out, &[[1, 0], [2, 0], [3, 0]], [0, 0, 0x10])?;
    dc_refine.write(out, &EncodeTable::EMPTY)?;
    cr_refine.write_ac_scan(out, 3, [1, 63, 0x10])?;
    cb_refine.write_ac_scan(out, 2, [1, 63, 0x10])?;
    y_refine.write_ac_scan(out, 1, [1, 63, 0x10])
}
