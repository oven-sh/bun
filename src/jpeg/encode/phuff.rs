//! Huffman coding of progressive scans (jcphuff.c).

use super::Block;
use super::huff::{BitWriter, Counts, EncodeTable, bit_length, value_bits};

/// The most correction bits that wait for the end of a run of blocks. How long such a run gets depends on it.
const MAX_CORR_BITS: usize = 1000;

/// Every scan is gone through twice: once to count the symbols, for the table, and once to write them.
pub(crate) enum Sink<'a, 'b> {
    Count(&'a mut [Counts; 2]),
    Write(&'a mut BitWriter<'b>, &'a [EncodeTable; 2]),
}

impl Sink<'_, '_> {
    #[inline(always)]
    fn symbol(&mut self, table: usize, symbol: u8) {
        match self {
            Sink::Count(counts) => {
                if let Some(count) = counts
                    .get_mut(table)
                    .and_then(|counts| counts.get_mut(usize::from(symbol)))
                {
                    *count += 1;
                }
            }
            Sink::Write(bits, tables) => {
                if let Some(table) = tables.get(table) {
                    let (code, size) = table.get(symbol);
                    bits.put(code, size);
                }
            }
        }
    }

    #[inline(always)]
    fn bits(&mut self, code: u32, size: u32) {
        if let Sink::Write(bits, _) = self {
            bits.put(code, size);
        }
    }

    fn buffered_bits(&mut self, buffered: &[u8]) {
        if let Sink::Write(bits, _) = self {
            for &bit in buffered {
                bits.put(u32::from(bit), 1);
            }
        }
    }
}

/// The first scan of a DC coefficient: all of its bits from `al` up. Returns the new prediction.
#[inline]
pub(crate) fn encode_dc_first(
    sink: &mut Sink,
    table: usize,
    block: &Block,
    al: u32,
    last_dc: i32,
) -> i32 {
    let [dc, ..] = block;
    let value = i32::from(*dc) >> al;
    let diff = value - last_dc;
    let nbits = bit_length(diff.unsigned_abs());
    sink.symbol(table, nbits as u8);
    sink.bits(value_bits(diff, nbits), nbits);
    value
}

/// A later scan of a DC coefficient: bit `al`.
#[inline]
pub(crate) fn encode_dc_refine(sink: &mut Sink, block: &Block, al: u32) {
    let [dc, ..] = block;
    sink.bits(((i32::from(*dc) >> al) & 1) as u32, 1);
}

/// The state of a scan of AC coefficients.
pub(crate) struct AcEncoder {
    table: usize,
    /// Blocks gone by that had nothing left to code when they ended.
    eob_run: u32,
    /// The correction bits of those blocks, one in a byte.
    bit_buffer: [u8; MAX_CORR_BITS],
    /// How many there are.
    be: usize,
}

impl AcEncoder {
    pub(crate) fn new(table: usize) -> Self {
        AcEncoder {
            table,
            eob_run: 0,
            bit_buffer: [0; MAX_CORR_BITS],
            be: 0,
        }
    }

    fn emit_eob_run(&mut self, sink: &mut Sink) {
        if self.eob_run > 0 {
            let nbits = bit_length(self.eob_run) - 1;
            sink.symbol(self.table, (nbits << 4) as u8);
            sink.bits(self.eob_run & ((1 << nbits) - 1), nbits);
            self.eob_run = 0;
            sink.buffered_bits(self.bit_buffer.get(..self.be).unwrap_or(&[]));
            self.be = 0;
        }
    }

    /// The first scan of a band of coefficients: all of their bits from `al` up. `band` is in zigzag order.
    #[inline]
    pub(crate) fn encode_first(&mut self, sink: &mut Sink, band: &[i16], al: u32) {
        let mut run = 0u32;
        for &coef in band {
            // Toward zero.
            let magnitude = u32::from(coef.unsigned_abs()) >> al;
            if magnitude == 0 {
                run += 1;
                continue;
            }
            self.emit_eob_run(sink);
            while run > 15 {
                sink.symbol(self.table, 0xf0);
                run -= 16;
            }
            let nbits = bit_length(magnitude);
            sink.symbol(self.table, ((run << 4) + nbits) as u8);
            let bits = if coef < 0 { !magnitude } else { magnitude };
            sink.bits(bits & ((1 << nbits) - 1), nbits);
            run = 0;
        }
        if run > 0 {
            self.eob_run += 1;
            if self.eob_run == 0x7fff {
                self.emit_eob_run(sink);
            }
        }
    }

    /// A later scan of a band of coefficients: bit `al`.
    #[inline]
    pub(crate) fn encode_refine(&mut self, sink: &mut Sink, band: &[i16], al: u32) {
        let magnitude = |coef: i16| u32::from(coef.unsigned_abs()) >> al;
        // The last coefficient that becomes nonzero in this scan. After it there are only correction bits.
        let eob = band.iter().rposition(|&coef| magnitude(coef) == 1);

        let mut run = 0u32;
        // This block's correction bits since the last symbol go after those of the blocks before it.
        let mut br_start = self.be;
        let mut br = 0usize;
        for (k, &coef) in band.iter().enumerate() {
            let magnitude = magnitude(coef);
            if magnitude == 0 {
                run += 1;
                continue;
            }

            // Runs of 16 zeros, unless the end of the block takes care of them.
            while run > 15 && eob.is_some_and(|eob| k <= eob) {
                self.emit_eob_run(sink);
                sink.symbol(self.table, 0xf0);
                run -= 16;
                sink.buffered_bits(self.bit_buffer.get(br_start..br_start + br).unwrap_or(&[]));
                br_start = 0;
                br = 0;
            }

            if magnitude > 1 {
                // It was nonzero before.
                if let Some(bit) = self.bit_buffer.get_mut(br_start + br) {
                    *bit = (magnitude & 1) as u8;
                }
                br += 1;
                continue;
            }

            self.emit_eob_run(sink);
            sink.symbol(self.table, ((run << 4) + 1) as u8);
            sink.bits(u32::from(coef >= 0), 1);
            sink.buffered_bits(self.bit_buffer.get(br_start..br_start + br).unwrap_or(&[]));
            br_start = 0;
            br = 0;
            run = 0;
        }

        if run > 0 || br > 0 {
            self.eob_run += 1;
            self.be += br;
            // Before either the counter or, in the next block, the buffer overflows.
            if self.eob_run == 0x7fff || self.be > MAX_CORR_BITS - 64 + 1 {
                self.emit_eob_run(sink);
            }
        }
    }

    pub(crate) fn finish(mut self, sink: &mut Sink) {
        self.emit_eob_run(sink);
    }
}
