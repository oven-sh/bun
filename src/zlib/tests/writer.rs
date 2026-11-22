//! Streams that no compressor would write.

use crate::plain::{CODE_LENGTH_ORDER, DISTANCES, LENGTHS, fixed_lengths};

#[derive(Default, Clone)]
pub(crate) struct Writer {
    bytes: Vec<u8>,
    bits: usize,
    /// Of the block: literals and lengths, and distances.
    codes: [Vec<(usize, u32)>; 2],
}

fn canonical_codes(lengths: &[u8]) -> Vec<(usize, u32)> {
    let mut codes = vec![(0, 0); lengths.len()];
    let mut next = 0u16;
    for bits in 1..16 {
        for symbol in (0..lengths.len()).filter(|&it| u32::from(lengths[it]) == bits) {
            codes[symbol] = (usize::from(next.reverse_bits() >> (16 - bits)), bits);
            next = next.wrapping_add(1);
        }
        next <<= 1;
    }
    codes
}

impl Writer {
    pub(crate) fn put(&mut self, value: usize, count: u32) -> &mut Self {
        for shift in 0..count {
            self.bytes.resize(self.bits / 8 + 1, 0);
            self.bytes[self.bits / 8] |= ((value >> shift & 1) << (self.bits % 8)) as u8;
            self.bits += 1;
        }
        self
    }

    pub(crate) fn stored(&mut self, is_last: bool, bytes: &[u8]) -> &mut Self {
        self.put(is_last.into(), 3);
        self.bits = 8 * self.bytes.len();
        self.put(bytes.len(), 16).put(!bytes.len(), 16);
        self.bytes.extend(bytes);
        self.bits = 8 * self.bytes.len();
        self
    }

    pub(crate) fn fixed(&mut self, is_last: bool) -> &mut Self {
        let (literals, distances) = fixed_lengths();
        self.codes = [canonical_codes(&literals), canonical_codes(&distances)];
        self.put(usize::from(is_last) | 1 << 1, 3)
    }

    /// Each length takes 4 bits.
    pub(crate) fn dynamic(
        &mut self,
        is_last: bool,
        literals: &[u8],
        distances: &[u8],
    ) -> &mut Self {
        self.codes = [canonical_codes(literals), canonical_codes(distances)];
        self.put(usize::from(is_last) | 2 << 1, 3);
        self.put(literals.len() - 257, 5)
            .put(distances.len() - 1, 5)
            .put(19 - 4, 4);
        for symbol in CODE_LENGTH_ORDER {
            self.put(if symbol < 16 { 4 } else { 0 }, 3);
        }
        for &length in literals.iter().chain(distances) {
            self.put(usize::from(length.reverse_bits() >> 4), 4);
        }
        self
    }

    pub(crate) fn symbol(&mut self, symbol: usize) -> &mut Self {
        let (code, bits) = self.codes[0][symbol];
        self.put(code, bits)
    }

    pub(crate) fn literals(&mut self, bytes: &[u8]) -> &mut Self {
        bytes.iter().fold(self, |it, &byte| it.symbol(byte.into()))
    }

    pub(crate) fn copy(&mut self, len: usize, distance: usize) -> &mut Self {
        let symbol = LENGTHS.partition_point(|it| it.0 <= len) - 1;
        self.copy_with(symbol, len, distance)
    }

    /// `symbol` counts from 257.
    pub(crate) fn copy_with(&mut self, symbol: usize, len: usize, distance: usize) -> &mut Self {
        let (base, extra) = LENGTHS[symbol];
        self.symbol(257 + symbol).put(len - base, extra);
        let symbol = DISTANCES.partition_point(|it| it.0 <= distance) - 1;
        let ((code, bits), (base, extra)) = (self.codes[1][symbol], DISTANCES[symbol]);
        self.put(code, bits).put(distance - base, extra)
    }

    pub(crate) fn end_block(&mut self) -> &mut Self {
        self.symbol(256)
    }

    pub(crate) fn finish(&mut self) -> Vec<u8> {
        std::mem::take(self).bytes
    }
}
