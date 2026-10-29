//! Huffman coding of progressive scans (jcphuff.c).

use super::huff::{BitWriter, Code, Counts, EncodeTable, ZRL, value_bits};
use super::{Block, DCTSIZE, PerTable, Scan, Table};
use crate::alloc::try_vec_with_capacity;
use crate::error::Result;

/// The most correction bits that wait for the end of a run of blocks. How long such a run gets depends on it.
const MAX_CORR_BITS: usize = 1000;

/// The longest run of blocks that an end-of-block symbol can stand for.
const MAX_EOB_RUN: u32 = 0x7fff;

/// Every scan is gone through twice: once to count the symbols, for the table, and once to write them.
pub(crate) enum Sink<'a, 'b> {
    Count(&'a mut PerTable<Counts>),
    Write(&'a mut BitWriter<'b>, &'a PerTable<EncodeTable>),
}

/// Up to 63 correction bits, the first one on top.
#[derive(Clone, Copy, Default)]
struct CorrectionBits {
    bits: u64,
    len: u32,
}

impl CorrectionBits {
    #[inline(always)]
    fn push(&mut self, bit: u32) {
        self.bits = (self.bits << 1) | u64::from(bit);
        self.len += 1;
    }
}

impl Sink<'_, '_> {
    pub(crate) fn check(&self) -> Result<()> {
        match self {
            Sink::Count(_) => Ok(()),
            Sink::Write(bits, _) => bits.check(),
        }
    }

    #[inline(always)]
    fn symbol(&mut self, table: Table, symbol: u8) {
        match self {
            Sink::Count(counts) => {
                if let Some(count) = counts.get_mut(table).get_mut(usize::from(symbol)) {
                    *count += 1;
                }
            }
            Sink::Write(bits, tables) => {
                let Code { code, size } = tables.get(table).get(symbol);
                bits.put(code, size);
            }
        }
    }

    #[inline(always)]
    fn bits(&mut self, code: u32, size: u32) {
        if let Sink::Write(bits, _) = self {
            bits.put(code, size);
        }
    }

    /// Leaves `correction` empty.
    #[inline(always)]
    fn correction_bits(&mut self, correction: &mut CorrectionBits) {
        let CorrectionBits { bits, len } = core::mem::take(correction);
        self.bits((bits >> 32) as u32, len.saturating_sub(32));
        self.bits(bits as u32, len.min(32));
    }
}

/// The first scan of a DC coefficient: all of its bits from `al` up. Returns the new prediction.
#[inline]
pub(crate) fn encode_dc_first(
    sink: &mut Sink,
    table: Table,
    block: &Block,
    al: u32,
    last_dc: i32,
) -> i32 {
    let value = i32::from(block.dc()) >> al;
    let diff = value - last_dc;
    let nbits = diff.unsigned_abs().bit_width();
    sink.symbol(table, nbits as u8);
    sink.bits(value_bits(diff, nbits), nbits);
    value
}

/// A later scan of a DC coefficient: bit `al`.
#[inline]
pub(crate) fn encode_dc_refine(sink: &mut Sink, block: &Block, al: u32) {
    sink.bits(((i32::from(block.dc()) >> al) & 1) as u32, 1);
}

/// The state of a scan of AC coefficients.
pub(crate) struct AcEncoder {
    table: Table,
    /// The first and the last coefficient of the scan, in zigzag order.
    ss: u32,
    se: u32,
    /// The bit position that the scan stops at.
    al: u32,
    /// Blocks gone by that had nothing left to code when they ended.
    eob_run: u32,
    /// The correction bits of those of them that have any.
    waiting: Vec<CorrectionBits>,
    /// How many bits that is.
    waiting_bits: usize,
}

impl AcEncoder {
    pub(crate) fn new(table: Table, scan: &Scan) -> Result<Self> {
        Ok(AcEncoder {
            table,
            ss: u32::from(scan.ss),
            se: u32::from(scan.se),
            al: u32::from(scan.al),
            eob_run: 0,
            // Only a later scan has correction bits.
            waiting: try_vec_with_capacity(if scan.ah != 0 { MAX_CORR_BITS } else { 0 })?,
            waiting_bits: 0,
        })
    }

    fn emit_eob_run(&mut self, sink: &mut Sink) {
        if self.eob_run > 0 {
            let nbits = self.eob_run.ilog2();
            sink.symbol(self.table, (nbits << 4) as u8);
            sink.bits(self.eob_run & ((1 << nbits) - 1), nbits);
            self.eob_run = 0;
            for mut correction in self.waiting.drain(..) {
                sink.correction_bits(&mut correction);
            }
            self.waiting_bits = 0;
        }
    }

    /// The first scan of a band of coefficients: all of their bits from `al` up.
    #[inline]
    pub(crate) fn encode_first(&mut self, sink: &mut Sink, block: &Block) {
        let mut left = block.nonzero_between(self.ss, self.se);
        // One more than the place of the last coefficient that was coded.
        let mut next = self.ss;
        while left != 0 {
            let k = left.trailing_zeros();
            left &= left - 1;
            let coef = block.coef_at(k);
            // Toward zero.
            let magnitude = u32::from(coef.unsigned_abs()) >> self.al;
            if magnitude == 0 {
                continue;
            }
            let mut run = k - next;
            next = k + 1;
            self.emit_eob_run(sink);
            while run > 15 {
                sink.symbol(self.table, ZRL);
                run -= 16;
            }
            let nbits = magnitude.bit_width();
            sink.symbol(self.table, ((run << 4) + nbits) as u8);
            let bits = if coef < 0 { !magnitude } else { magnitude };
            sink.bits(bits & ((1 << nbits) - 1), nbits);
        }
        if next <= self.se {
            self.eob_run += 1;
            if self.eob_run == MAX_EOB_RUN {
                self.emit_eob_run(sink);
            }
        }
    }

    /// A later scan of a band of coefficients: bit `al`.
    #[inline]
    pub(crate) fn encode_refine(&mut self, sink: &mut Sink, block: &Block) {
        let al = self.al;
        let magnitude_at = |k: u32| u32::from(block.coef_at(k).unsigned_abs()) >> al;
        let nonzero = block.nonzero_between(self.ss, self.se);

        // The last coefficient that becomes nonzero in this scan. After it there are only correction bits.
        let mut eob = None;
        let mut left = nonzero;
        while left != 0 && eob.is_none() {
            let k = left.ilog2();
            left &= !(1 << k);
            if magnitude_at(k) == 1 {
                eob = Some(k);
            }
        }

        // Zeros since the last symbol.
        let mut run = 0u32;
        let mut next = self.ss;
        // This block's correction bits since the last symbol.
        let mut correction = CorrectionBits::default();
        let mut left = nonzero;
        while left != 0 {
            let k = left.trailing_zeros();
            left &= left - 1;
            let magnitude = magnitude_at(k);
            if magnitude == 0 {
                continue;
            }
            run += k - next;
            next = k + 1;

            // Runs of 16 zeros, unless the end of the block takes care of them.
            while run > 15 && eob.is_some_and(|eob| k <= eob) {
                self.emit_eob_run(sink);
                sink.symbol(self.table, ZRL);
                run -= 16;
                sink.correction_bits(&mut correction);
            }

            if magnitude > 1 {
                // It was nonzero before.
                correction.push(magnitude & 1);
                continue;
            }

            self.emit_eob_run(sink);
            sink.symbol(self.table, ((run << 4) + 1) as u8);
            sink.bits(u32::from(block.coef_at(k) >= 0), 1);
            sink.correction_bits(&mut correction);
            run = 0;
        }
        run += self.se + 1 - next;

        if run > 0 || correction.len > 0 {
            self.eob_run += 1;
            if correction.len > 0 {
                self.waiting.push(correction);
                self.waiting_bits += correction.len as usize;
            }
            // Before the counter overflows, or the bits of another block could go over the limit.
            if self.eob_run == MAX_EOB_RUN
                || self.waiting_bits > MAX_CORR_BITS - DCTSIZE * DCTSIZE + 1
            {
                self.emit_eob_run(sink);
            }
        }
    }

    pub(crate) fn finish(mut self, sink: &mut Sink) {
        self.emit_eob_run(sink);
    }
}
