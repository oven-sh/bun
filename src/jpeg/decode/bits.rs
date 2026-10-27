//! Bits and Huffman codes out of an entropy-coded segment (jdhuff.h and the shared part of jdhuff.c).
//!
//! To every decoder here a segment is its bits up to the marker that ends it, and then zeros without end. The first zero
//! that is used sets `Input::insufficient_data`. How far ahead of the decoder the bytes are read cannot be seen from
//! outside, because reading never goes past a marker and whatever is between the last used bit and the marker is
//! dropped.

use super::input::{Input, Warning};
use crate::error::{Error, Result};
use crate::tables::HuffSpec;

const LOOKAHEAD: u32 = 8;

/// A refill goes on until there are this many bits, so that another byte would not fit.
const MIN_GET_BITS: u32 = 64 - 7;

pub(crate) struct DerivedTable {
    /// The largest code of length `k`, or -1 if there is none. `maxcode[17]` ends the search for a code that does not
    /// exist.
    maxcode: [i32; 18],
    /// `huffval[code + valoffset[k]]` is the symbol of a code of length `k`.
    valoffset: [i32; 18],
    huffval: [u8; 256],
    /// By the next 8 bits: the length of the code they begin with in the high byte and its symbol in the low byte. The
    /// length is 9 if the code is longer than 8 bits.
    lookup: [u16; 1 << LOOKAHEAD],
}

impl DerivedTable {
    pub(crate) fn new(spec: &HuffSpec, is_dc: bool, lossless: bool) -> Result<Box<Self>> {
        let mut table = Box::new(DerivedTable {
            maxcode: [-1; 18],
            valoffset: [0; 18],
            huffval: spec.huffval,
            lookup: [((LOOKAHEAD + 1) << LOOKAHEAD) as u16; 1 << LOOKAHEAD],
        });

        let mut code: u32 = 0;
        let mut p: usize = 0;
        let lengths = spec
            .bits
            .iter()
            .zip(table.maxcode.iter_mut().zip(table.valoffset.iter_mut()));
        for (l, (&count, (maxcode, valoffset))) in lengths.enumerate().skip(1) {
            let count = usize::from(count);
            if p + count > 256 {
                return Err(Error::BadHuffTable);
            }
            if count != 0 {
                *valoffset = p as i32 - code as i32;
                if l as u32 <= LOOKAHEAD {
                    // Every byte that begins with one of these codes.
                    let shift = LOOKAHEAD - l as u32;
                    let symbols = spec.huffval.iter().skip(p).take(count);
                    let entries = table.lookup.iter_mut().skip((code as usize) << shift);
                    for (entry, &symbol) in
                        entries.zip(symbols.flat_map(|s| core::iter::repeat_n(s, 1 << shift)))
                    {
                        *entry = ((l as u16) << LOOKAHEAD) | u16::from(symbol);
                    }
                }
                code += count as u32;
                p += count;
                *maxcode = code as i32 - 1;
            }
            // No code is all ones, so one more than the last code still fits in `l` bits.
            if code >= 1 << l {
                return Err(Error::BadHuffTable);
            }
            code <<= 1;
        }
        if let Some(sentinel) = table.maxcode.last_mut() {
            *sentinel = 0xfffff;
        }

        // A DC symbol is a number of bits to read.
        let max_symbol = if lossless { 16 } else { 15 };
        if is_dc
            && spec
                .huffval
                .iter()
                .take(p)
                .any(|&symbol| symbol > max_symbol)
        {
            return Err(Error::BadHuffTable);
        }
        Ok(table)
    }
}

/// `x` is `s` bits read after a symbol `s`: the upper half of their range stands for itself, the lower half for the
/// negative numbers.
#[inline(always)]
pub(crate) fn huff_extend(x: i32, s: u32) -> i32 {
    x + (((x - (1 << (s - 1))) >> 31) & ((-1i32 << s) + 1))
}

#[derive(Default, Clone, Copy)]
pub(crate) struct BitReader {
    /// The low `bits_left` bits have not been used yet.
    buf: u64,
    bits_left: u32,
}

impl BitReader {
    pub(crate) fn reset(&mut self) {
        self.buf = 0;
        self.bits_left = 0;
    }

    /// Drops what is left, at a restart marker.
    pub(crate) fn discard(&mut self, inp: &mut Input) {
        inp.discarded_bytes += (self.bits_left / 8) as usize;
        self.bits_left = 0;
    }

    /// Reads bytes until the buffer is full or a marker comes. Afterwards there are at least `nbits` bits, made up if
    /// need be.
    #[inline(never)]
    pub(crate) fn fill(&mut self, inp: &mut Input, nbits: u32) {
        if inp.unread_marker == 0 {
            while self.bits_left < MIN_GET_BITS {
                let mut c = inp.byte();
                if c == 0xff {
                    // Several FFs and a zero are taken for one FF of data, which the standard does not allow.
                    while c == 0xff {
                        c = inp.byte();
                    }
                    if c != 0 {
                        inp.unread_marker = c;
                        break;
                    }
                    c = 0xff;
                }
                self.buf = (self.buf << 8) | u64::from(c);
                self.bits_left += 8;
            }
        }
        if nbits > self.bits_left {
            if !inp.insufficient_data {
                inp.warn(Warning::HitMarker);
                inp.insufficient_data = true;
            }
            self.buf <<= MIN_GET_BITS - self.bits_left;
            self.bits_left = MIN_GET_BITS;
        }
    }

    /// Makes sure of `nbits` bits, at most 16.
    #[inline(always)]
    pub(crate) fn check(&mut self, inp: &mut Input, nbits: u32) {
        if self.bits_left < nbits {
            self.fill(inp, nbits);
        }
    }

    /// The caller has made sure that there are `nbits` bits, at most 16.
    #[inline(always)]
    pub(crate) fn get(&mut self, nbits: u32) -> i32 {
        self.bits_left -= nbits;
        ((self.buf >> self.bits_left) as i32) & ((1 << nbits) - 1)
    }

    #[inline(always)]
    fn lookup(&self, table: &DerivedTable) -> (u32, u8) {
        let look = (self.buf >> (self.bits_left - LOOKAHEAD)) as u8;
        let entry = table.lookup.get(usize::from(look)).copied().unwrap_or(0);
        (u32::from(entry >> LOOKAHEAD), entry as u8)
    }

    /// The next symbol.
    #[inline(always)]
    pub(crate) fn decode(&mut self, inp: &mut Input, table: &DerivedTable) -> u8 {
        if self.bits_left < LOOKAHEAD {
            self.fill(inp, 0);
            if self.bits_left < LOOKAHEAD {
                // The segment ends here. The code may still be whole.
                return self.decode_slow(inp, table, 1);
            }
        }
        let (nb, symbol) = self.lookup(table);
        if nb <= LOOKAHEAD {
            self.bits_left -= nb;
            symbol
        } else {
            self.decode_slow(inp, table, nb)
        }
    }

    /// The code is known to have at least `min_bits` bits.
    #[inline(never)]
    fn decode_slow(&mut self, inp: &mut Input, table: &DerivedTable, min_bits: u32) -> u8 {
        let mut l = min_bits as usize;
        self.check(inp, min_bits);
        let mut code = self.get(min_bits);
        while table.maxcode.get(l).is_some_and(|&max| code > max) {
            code <<= 1;
            self.check(inp, 1);
            code |= self.get(1);
            l += 1;
        }
        if l > 16 {
            inp.warn(Warning::BadHuffCode);
            return 0;
        }
        let offset = table.valoffset.get(l).copied().unwrap_or(0);
        table
            .huffval
            .get((code + offset) as usize)
            .copied()
            .unwrap_or(0)
    }
}

/// libjpeg-turbo's faster way to read bits, for where the data cannot run out. It stops at nothing: once it has seen an
/// FF that is not followed by 00 it supplies zeros.
pub(crate) struct FastBitReader<'a> {
    bits: BitReader,
    data: &'a [u8],
    at: usize,
    saw_marker: bool,
}

impl<'a> FastBitReader<'a> {
    #[inline(always)]
    pub(crate) fn new(bits: BitReader, data: &'a [u8]) -> Self {
        FastBitReader {
            bits,
            data,
            at: 0,
            saw_marker: false,
        }
    }

    /// The state to go on from and the number of bytes read, unless there was a marker.
    #[inline(always)]
    pub(crate) fn finish(self) -> Option<(BitReader, usize)> {
        (!self.saw_marker).then_some((self.bits, self.at))
    }

    /// Afterwards there are more than 16 bits.
    #[inline(always)]
    pub(crate) fn fill(&mut self) {
        if self.bits.bits_left <= 16 {
            self.fill_6_bytes();
        }
    }

    #[inline(always)]
    fn fill_6_bytes(&mut self) {
        if let Some(&chunk) = self
            .data
            .get(self.at..)
            .and_then(|data| data.first_chunk::<8>())
        {
            let w = u64::from_be_bytes(chunk) >> 16;
            // No byte of `w` is FF if no byte of `!w` is zero. The two bytes on top of `!w` are FF.
            if (!w).wrapping_sub(0x0101_0101_0101_0101) & w & 0x8080_8080_8080_8080 == 0 {
                self.bits.buf = (self.bits.buf << 48) | w;
                self.bits.bits_left += 48;
                self.at += 6;
                return;
            }
        }
        self.fill_bytewise();
    }

    #[inline(never)]
    fn fill_bytewise(&mut self) {
        for _ in 0..6 {
            let c0 = self.data.get(self.at).copied().unwrap_or(0);
            let c1 = self.data.get(self.at + 1).copied().unwrap_or(0);
            let mut byte = c0;
            if c0 != 0xff {
                self.at += 1;
            } else if c1 == 0 {
                self.at += 2;
            } else {
                self.saw_marker = true;
                byte = 0;
            }
            self.bits.buf = (self.bits.buf << 8) | u64::from(byte);
            self.bits.bits_left += 8;
        }
    }

    /// After `fill`, at most 16 bits.
    #[inline(always)]
    pub(crate) fn get(&mut self, nbits: u32) -> i32 {
        self.bits.get(nbits)
    }

    /// The next symbol.
    #[inline(always)]
    pub(crate) fn decode(&mut self, table: &DerivedTable) -> u8 {
        self.fill();
        let (nb, symbol) = self.bits.lookup(table);
        if nb <= LOOKAHEAD {
            self.bits.bits_left -= nb;
            return symbol;
        }
        let mut l = nb as usize;
        let mut code = self.bits.get(nb);
        while table.maxcode.get(l).is_some_and(|&max| code > max) {
            code = (code << 1) | self.bits.get(1);
            l += 1;
        }
        if l > 16 {
            return 0;
        }
        let offset = table.valoffset.get(l).copied().unwrap_or(0);
        table
            .huffval
            .get(((code + offset) & 0xff) as usize)
            .copied()
            .unwrap_or(0)
    }
}
