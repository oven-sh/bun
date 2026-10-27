//! Huffman coding: writing bits, the tables, and sequential scans (jchuff.c).

use super::Block;
use crate::error::{Error, Result};
use crate::tables::HuffSpec;

/// The file so far. Running out of memory is remembered instead of returned, to keep it out of the inner loops.
#[derive(Default)]
pub(crate) struct Output {
    bytes: Vec<u8>,
    out_of_memory: bool,
}

impl Output {
    #[inline(always)]
    pub(crate) fn extend(&mut self, bytes: &[u8]) {
        if self.bytes.try_reserve(bytes.len()).is_err() {
            self.out_of_memory = true;
            return;
        }
        self.bytes.extend_from_slice(bytes);
    }

    pub(crate) fn finish(self) -> Result<Vec<u8>> {
        if self.out_of_memory {
            return Err(Error::OutOfMemory);
        }
        Ok(self.bytes)
    }
}

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

    #[inline(always)]
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

    /// Fills up the last byte with ones.
    pub(crate) fn finish(mut self) {
        let padding = self.free_bits % 8;
        self.put((1 << padding) - 1, padding);
        let bytes = (self.buffer << (self.free_bits & 63)).to_be_bytes();
        let used = (64 - self.free_bits as usize) / 8;
        self.write_stuffed(bytes.get(..used).unwrap_or(&[]));
    }
}

pub(crate) struct Code {
    pub(crate) code: u32,
    /// In bits.
    pub(crate) size: u32,
}

/// The code of every symbol.
pub(crate) struct EncodeTable {
    code: [u16; 256],
    /// 0 if the symbol has no code.
    size: [u8; 256],
}

impl EncodeTable {
    pub(crate) fn empty() -> Self {
        EncodeTable {
            code: [0; 256],
            size: [0; 256],
        }
    }

    pub(crate) fn new(spec: &HuffSpec) -> Result<Self> {
        let mut table = Self::empty();
        let mut symbols = spec.huffval.iter();
        let mut code: u32 = 0;
        for (length, &count) in spec.bits.iter().enumerate().skip(1) {
            for _ in 0..count {
                let symbol = usize::from(*symbols.next().ok_or(Error::BadHuffTable)?);
                let (Some(c), Some(s)) = (table.code.get_mut(symbol), table.size.get_mut(symbol))
                else {
                    return Err(Error::Internal);
                };
                if *s != 0 {
                    return Err(Error::BadHuffTable);
                }
                *c = code as u16;
                *s = length as u8;
                code += 1;
            }
            // No code is all ones, so one more than the last code still fits in `length` bits.
            if code >= 1 << length {
                return Err(Error::BadHuffTable);
            }
            code <<= 1;
        }
        Ok(table)
    }

    #[inline(always)]
    pub(crate) fn get(&self, symbol: u8) -> Code {
        let symbol = usize::from(symbol);
        Code {
            code: u32::from(self.code.get(symbol).copied().unwrap_or(0)),
            size: u32::from(self.size.get(symbol).copied().unwrap_or(0)),
        }
    }
}

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

/// Writes a block of a sequential scan. `block` is in zigzag order.
#[inline]
pub(crate) fn encode_block(
    bits: &mut BitWriter,
    block: &Block,
    last_dc: i16,
    dc_table: &EncodeTable,
    ac_table: &EncodeTable,
) {
    let [dc, ac @ ..] = block;
    let diff = i32::from(*dc) - i32::from(last_dc);
    let nbits = bit_length(diff.unsigned_abs());
    let Code { code, size } = dc_table.get(nbits as u8);
    bits.put((code << nbits) | value_bits(diff, nbits), size + nbits);

    let mut run = 0u32;
    for &coef in ac {
        if coef == 0 {
            run += 1;
            continue;
        }
        while run > 15 {
            let Code { code, size } = ac_table.get(0xf0);
            bits.put(code, size);
            run -= 16;
        }
        let coef = i32::from(coef);
        let nbits = bit_length(coef.unsigned_abs());
        let Code { code, size } = ac_table.get(((run << 4) + nbits) as u8);
        bits.put((code << nbits) | value_bits(coef, nbits), size + nbits);
        run = 0;
    }
    if run > 0 {
        let Code { code, size } = ac_table.get(0);
        bits.put(code, size);
    }
}

/// How often each symbol occurs. The last entry is for a symbol that does not exist.
pub(crate) type Counts = [i64; 257];

/// The table that takes the fewest bits for symbols that occur this often (section K.2 of the standard). Ties are
/// resolved as libjpeg-turbo does.
pub(crate) fn optimal_table(counts: &Counts) -> Result<HuffSpec> {
    const MAX_CODE_LENGTH: usize = 32;
    const MERGED: i64 = 1_000_000_001;

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
        .take(256)
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

    loop {
        // The two least frequent, the later one in case of a tie.
        let (mut c1, mut c2) = (None, None);
        let (mut v1, mut v2) = (1_000_000_000i64, 1_000_000_000i64);
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
            break;
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
