//! How a dynamic block tells its codes.

use bun_deflate::format::{FIRST_LENGTH_SYMBOL, MAX_PRECODE_LEN, PRECODE_ORDER, PRECODE_SYMBOLS};

use super::encoding::LITERAL_LENGTH_ROOM;
use super::huffman::{Code, cost};
use super::pending::{Bits, Writer};
use crate::array::At;
use crate::format::{REPEAT_FEW_ZEROS, REPEAT_MANY_ZEROS, REPEAT_PREVIOUS, Repeat};

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static EXTRA_BITS: [u8; 32] = {
    let mut table = [0; _];
    table[REPEAT_PREVIOUS.symbol as usize] = REPEAT_PREVIOUS.extra_bits as u8;
    table[REPEAT_FEW_ZEROS.symbol as usize] = REPEAT_FEW_ZEROS.extra_bits as u8;
    table[REPEAT_MANY_ZEROS.symbol as usize] = REPEAT_MANY_ZEROS.extra_bits as u8;
    table
};

/// The lengths of the two codes, in symbols of a third.
struct CodeLengths {
    /// Each with the value of its extra bits.
    symbols: [[u8; 2]; 512],
    len: usize,
    frequencies: [u16; 32],
}

impl CodeLengths {
    fn push(&mut self, symbol: u8, extra: u8) {
        *self.symbols.at_mut(self.len) = [symbol, extra];
        self.len += 1;
        *self.frequencies.at_mut(symbol.into()) += 1;
    }

    fn push_repeat(&mut self, repeat: &Repeat, count: u32) {
        self.push(repeat.symbol, (count - repeat.min) as u8);
    }

    // https://github.com/zlib-ng/zlib-ng/blob/12731092979c6d07f42da27da673a9f6c7b13586/trees.c#L414
    fn extend(&mut self, lengths: &[u8]) {
        for run in lengths.chunk_by(|a, b| a == b) {
            let (&[length, ..], mut left) = (run, run.len() as u32) else {
                continue;
            };
            if length == 0 {
                while left > REPEAT_FEW_ZEROS.max() {
                    let count = left.min(REPEAT_MANY_ZEROS.max());
                    self.push_repeat(&REPEAT_MANY_ZEROS, count);
                    left -= count;
                }
                if left >= REPEAT_FEW_ZEROS.min {
                    self.push_repeat(&REPEAT_FEW_ZEROS, core::mem::take(&mut left));
                }
            } else {
                self.push(length, 0);
                left -= 1;
                while left >= REPEAT_PREVIOUS.min {
                    let count = left.min(REPEAT_PREVIOUS.max());
                    self.push_repeat(&REPEAT_PREVIOUS, count);
                    left -= count;
                }
            }
            for _ in 0..left {
                self.push(length, 0);
            }
        }
    }
}

pub(super) struct DynamicHeader {
    literal_lengths: usize,
    distances: usize,
    code_lengths: CodeLengths,
    code: Code<32>,
    /// The lengths of `code`, of which so many are written.
    ordered: [u8; PRECODE_SYMBOLS],
    ordered_len: usize,
}

impl DynamicHeader {
    #[inline(always)]
    pub(super) fn new(literal_lengths: &Code<LITERAL_LENGTH_ROOM>, distances: &Code<32>) -> Self {
        let mut code_lengths = CodeLengths {
            symbols: [[0; _]; _],
            len: 0,
            frequencies: [0; _],
        };
        code_lengths.extend(literal_lengths.used_lengths());
        code_lengths.extend(distances.used_lengths());
        let code = Code::new::<32>(&code_lengths.frequencies, MAX_PRECODE_LEN as u8);
        let ordered = PRECODE_ORDER.map(|symbol| *code.lengths.at(symbol.into()));
        let last_used = ordered.iter().enumerate().rfind(|&(_, &bits)| bits != 0);
        Self {
            literal_lengths: literal_lengths.used,
            distances: distances.used,
            code_lengths,
            code,
            ordered,
            ordered_len: last_used.map_or(0, |(rank, _)| rank).max(3) + 1,
        }
    }

    pub(super) fn bits(&self) -> u32 {
        let frequencies = &self.code_lengths.frequencies;
        (5 + 5 + 4 + 3 * self.ordered_len as u32)
            + cost(frequencies, &self.code.lengths)
            + cost(frequencies, &EXTRA_BITS)
    }

    #[inline(always)]
    pub(super) fn write(&self, writer: &mut Writer<'_>) {
        writer.put(Bits((self.literal_lengths - FIRST_LENGTH_SYMBOL) as u64, 5));
        writer.put(Bits(self.distances as u64 - 1, 5));
        writer.put(Bits(self.ordered_len as u64 - 4, 4));
        for &bits in self.ordered.iter().take(self.ordered_len) {
            writer.put(Bits(bits.into(), 3));
        }
        let codes = self.code.codes();
        for &[symbol, extra] in self.code_lengths.symbols.iter().take(self.code_lengths.len) {
            let code = codes.at(symbol.into());
            writer.put(Bits(
                u64::from(code.bits | u32::from(extra) << code.len),
                code.len + u32::from(*EXTRA_BITS.at(symbol.into())),
            ));
        }
    }
}
