//! Huffman coding: writing bits, the tables, and sequential scans (jchuff.c).

use super::Block;
use super::marker::Output;
use crate::error::{Error, Result};
use crate::tables::HuffSpec;

/// Writes the bits of an entropy-coded segment, where a zero byte follows every FF to tell it from a marker.
pub(crate) struct BitWriter<'a> {
    out: &'a mut Output,
    /// The low `64 - free_bits` bits have not been written yet.
    buffer: u64,
    free_bits: u32,
}

impl<'a> BitWriter<'a> {
    pub(crate) fn new(out: &'a mut Output) -> Self {
        BitWriter {
            out,
            buffer: 0,
            free_bits: 64,
        }
    }

    /// `size` is at most 32 and `code` has no bits beyond it.
    #[inline(always)]
    pub(crate) fn put(&mut self, code: u32, size: u32) {
        let code = u64::from(code);
        if size <= self.free_bits {
            // A full buffer is left for the next call, which then shifts by 0 below and not by 64 here.
            self.buffer = (self.buffer << (size & 63)) | code;
            self.free_bits -= size;
        } else {
            let rest = size - self.free_bits;
            self.buffer = (self.buffer << (self.free_bits & 63)) | (code >> rest);
            self.write_buffer();
            self.buffer = code;
            self.free_bits = 64 - rest;
        }
    }

    #[inline(never)]
    fn write_buffer(&mut self) {
        let buffer = self.buffer;
        if buffer & 0x8080_8080_8080_8080 & !buffer.wrapping_add(0x0101_0101_0101_0101) == 0 {
            self.out.extend(&buffer.to_be_bytes());
        } else {
            self.write_stuffed(&buffer.to_be_bytes());
        }
    }

    #[inline(never)]
    fn write_stuffed(&mut self, bytes: &[u8]) {
        for &byte in bytes {
            if byte == 0xff {
                self.out.extend(&[0xff, 0]);
            } else {
                self.out.extend(&[byte]);
            }
        }
    }

    pub(crate) fn check(&self) -> Result<()> {
        self.out.check()
    }

    /// Fills up the last byte with ones.
    pub(crate) fn finish(mut self) -> Result<()> {
        let padding = self.free_bits % 8;
        self.put((1 << padding) - 1, padding);
        let bytes = (self.buffer << (self.free_bits & 63)).to_be_bytes();
        let used = (64 - self.free_bits as usize) / 8;
        self.write_stuffed(bytes.get(..used).unwrap_or(&[]));
        self.check()
    }
}

pub(crate) struct Code {
    pub(crate) code: u32,
    /// In bits.
    pub(crate) size: u32,
}

/// The code of every symbol.
pub(crate) struct EncodeTable {
    /// The size in the low byte, 0 if the symbol has no code, and the code above it.
    entries: [u32; 256],
}

impl EncodeTable {
    pub(crate) fn empty() -> Self {
        EncodeTable { entries: [0; 256] }
    }

    pub(crate) fn new(spec: &HuffSpec) -> Self {
        let mut table = Self::empty();
        let mut symbols = spec.huffval.iter();
        let mut code: u32 = 0;
        for (length, &count) in spec.bits.iter().enumerate().skip(1) {
            for &symbol in symbols.by_ref().take(usize::from(count)) {
                if let Some(entry) = table.entries.get_mut(usize::from(symbol)) {
                    *entry = code << 8 | length as u32;
                }
                code += 1;
            }
            code <<= 1;
        }
        table
    }

    #[inline(always)]
    pub(crate) fn get(&self, symbol: u8) -> Code {
        let entry = self.entries.get(usize::from(symbol)).copied().unwrap_or(0);
        Code {
            code: entry >> 8,
            size: entry & 255,
        }
    }
}

/// The symbol for 16 zeros.
pub(crate) const ZRL: u8 = 0xf0;

/// The number of bits it takes to write `magnitude`.
#[inline(always)]
pub(crate) fn bit_length(magnitude: u32) -> u32 {
    32 - magnitude.leading_zeros()
}

/// The low `nbits` bits of a value as they follow its symbol: itself if positive, one less if negative.
#[inline(always)]
pub(crate) fn value_bits(value: i32, nbits: u32) -> u32 {
    ((value + (value >> 31)) as u32) & ((1 << nbits) - 1)
}

/// For a sequential scan, where the low four bits of a symbol say how many bits of a value follow its code: all that it
/// takes to put the two together, without a shift.
pub(crate) struct SequentialTable {
    entries: [SequentialEntry; 256],
}

#[derive(Clone, Copy, Default)]
struct SequentialEntry {
    /// The code with room for the value below it.
    code: u32,
    /// Ones where the value goes.
    value_mask: u16,
    /// Of the code and the value, in bits.
    size: u16,
}

impl SequentialTable {
    pub(crate) fn new(spec: &HuffSpec) -> Self {
        let table = EncodeTable::new(spec);
        let mut entries = [SequentialEntry::default(); 256];
        for (symbol, entry) in (0..=255u8).zip(&mut entries) {
            let Code { code, size } = table.get(symbol);
            let nbits = u32::from(symbol & 15);
            *entry = SequentialEntry {
                code: code << nbits,
                value_mask: ((1u32 << nbits) - 1) as u16,
                size: (size + nbits) as u16,
            };
        }
        SequentialTable { entries }
    }

    /// Writes `symbol` and the value that it announces: itself if positive, one less if negative.
    #[inline(always)]
    fn put(&self, bits: &mut BitWriter, symbol: u32, value: i32) {
        let entry = self
            .entries
            .get((symbol & 255) as usize)
            .copied()
            .unwrap_or_default();
        let value = (value + (value >> 31)) as u32 & u32::from(entry.value_mask);
        bits.put(entry.code | value, u32::from(entry.size));
    }
}

/// Writes a block of a sequential scan.
#[inline]
pub(crate) fn encode_block(
    bits: &mut BitWriter,
    block: &Block,
    last_dc: i16,
    dc_table: &SequentialTable,
    ac_table: &SequentialTable,
) {
    let diff = i32::from(block.dc()) - i32::from(last_dc);
    dc_table.put(bits, bit_length(diff.unsigned_abs()), diff);

    let mut left = block.nonzero_between(1, 63);
    let mut last = 0;
    while left != 0 {
        let k = left.trailing_zeros();
        left &= left - 1;
        let mut run = k - last - 1;
        last = k;
        while run > 15 {
            ac_table.put(bits, u32::from(ZRL), 0);
            run -= 16;
        }
        let coef = i32::from(block.zigzag(k));
        ac_table.put(bits, (run << 4) + bit_length(coef.unsigned_abs()), coef);
    }
    if last != 63 {
        ac_table.put(bits, 0, 0);
    }
}

/// How often each symbol occurs.
pub(crate) type Counts = [i64; 256];

/// The table that takes the fewest bits for symbols that occur this often (section K.2 of the standard). Ties are
/// resolved as libjpeg-turbo does.
pub(crate) fn optimal_table(counts: &Counts) -> Result<HuffSpec> {
    const MAX_CODE_LENGTH: usize = 32;
    /// The search below does not see what occurs more often, as in libjpeg.
    const MAX_FREQ: i64 = 1_000_000_000;
    const MERGED: i64 = MAX_FREQ + 1;

    #[derive(Clone, Copy, Default)]
    struct Node {
        symbol: u16,
        freq: i64,
        code_size: usize,
        /// The next node in this branch of the tree.
        other: Option<usize>,
    }

    /// Makes the codes of a whole branch one bit longer and returns its last node.
    fn lengthen(nodes: &mut [Node], mut at: usize) -> Result<usize> {
        loop {
            let node = nodes.get_mut(at).ok_or(Error::Internal)?;
            node.code_size += 1;
            match node.other {
                Some(next) => at = next,
                None => return Ok(at),
            }
        }
    }

    let mut nodes = [Node::default(); 257];
    let mut len = 0;
    // Symbol 256 gets the code that is all ones, being the last of the longest, so that no real symbol does.
    let reserved = core::iter::once(&1);
    for ((symbol, &freq), node) in counts
        .iter()
        .chain(reserved)
        .enumerate()
        .filter(|&(_, &freq)| freq != 0)
        .zip(nodes.iter_mut())
    {
        node.symbol = symbol as u16;
        node.freq = freq;
        len += 1;
    }
    let nodes = nodes.get_mut(..len).ok_or(Error::Internal)?;

    // Each time, two trees become one.
    for _ in 1..nodes.len() {
        // The two least frequent, the later one in case of a tie.
        let (mut c1, mut c2) = (None, None);
        let (mut v1, mut v2) = (MAX_FREQ, MAX_FREQ);
        for (i, node) in nodes.iter().enumerate() {
            if node.freq <= v2 {
                if node.freq <= v1 {
                    (c2, v2) = (c1, v1);
                    (c1, v1) = (Some(i), node.freq);
                } else {
                    (c2, v2) = (Some(i), node.freq);
                }
            }
        }
        let (Some(c1), Some(c2)) = (c1, c2) else {
            // libjpeg stops here and fails later, over a code that is missing or one that does not fit.
            return Err(Error::BadHuffTable);
        };

        nodes.get_mut(c1).ok_or(Error::Internal)?.freq = v1 + v2;
        nodes.get_mut(c2).ok_or(Error::Internal)?.freq = MERGED;
        let end = lengthen(nodes, c1)?;
        nodes.get_mut(end).ok_or(Error::Internal)?.other = Some(c2);
        lengthen(nodes, c2)?;
    }

    // `bits[k]` is the number of symbols with codes of length `k`.
    let mut bits = [0u8; MAX_CODE_LENGTH + 1];
    for node in nodes.iter() {
        let count = bits
            .get_mut(node.code_size)
            .ok_or(Error::HuffCodeLengthOverflow)?;
        *count = count.wrapping_add(1);
    }

    // Where the symbols of each length begin in the list of symbols.
    let mut position = [0usize; MAX_CODE_LENGTH + 1];
    let mut p = 0;
    for (position, &count) in position.iter_mut().zip(&bits).skip(1) {
        *position = p;
        p += usize::from(count);
    }

    // No code may be longer than 16 bits. Symbols leave a longer length in pairs: one takes over their common prefix, and
    // the other goes beside a symbol of the longest shorter length, whose code becomes the prefix of the two.
    for i in (17..=MAX_CODE_LENGTH).rev() {
        while bits.get(i).is_some_and(|&count| count > 0) {
            let mut j = i - 2;
            while bits.get(j).is_some_and(|&count| count == 0) {
                j = j.checked_sub(1).ok_or(Error::Internal)?;
            }
            for (length, change) in [(i, -2i8), (i - 1, 1), (j + 1, 2), (j, -1)] {
                let count = bits.get_mut(length).ok_or(Error::Internal)?;
                *count = count.wrapping_add_signed(change);
            }
        }
    }

    let (bits, _) = bits.split_first_chunk_mut::<17>().ok_or(Error::Internal)?;
    *bits
        .iter_mut()
        .rfind(|count| **count != 0)
        .ok_or(Error::Internal)? -= 1;

    // By length as it was before the adjustment, which the standard takes to be good enough.
    let mut huffval = [0u8; 256];
    let (_, real) = nodes.split_last().ok_or(Error::Internal)?;
    for node in real {
        let position = position.get_mut(node.code_size).ok_or(Error::Internal)?;
        *huffval.get_mut(*position).ok_or(Error::Internal)? = node.symbol as u8;
        *position += 1;
    }

    Ok(HuffSpec {
        bits: *bits,
        huffval,
    })
}
