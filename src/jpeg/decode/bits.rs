//! Bits and Huffman codes out of an entropy-coded segment (jdhuff.h and the shared part of jdhuff.c).
//!
//! To every decoder here a segment is its bits up to the marker that ends it, and then zeros without end. The first zero
//! that is used sets `Input::insufficient_data`. How far ahead of the decoder the bytes are read cannot be seen from
//! outside, because reading never goes past a marker and whatever is between the last used bit and the marker is
//! dropped.

use super::NUM_HUFF_TABLES;
use super::input::Input;
use crate::alloc::try_box;
use crate::error::{Error, Result};
use crate::tables::HuffSpec;

const LOOKAHEAD: u32 = 8;

/// The most bits of a `ShortCoefficient`.
const SHORT_BITS: u32 = 11;

/// A refill goes on until there are this many bits, so that another byte would not fit.
const MIN_GET_BITS: u32 = 64 - 7;

pub(crate) struct DerivedTable {
    /// The largest code of length `k`, or -1 if there is none.
    maxcode: [i32; 17],
    /// `huffval[code + valoffset[k]]` is the symbol of a code of length `k`.
    valoffset: [i32; 17],
    huffval: [u8; 256],
    /// By the next 8 bits: the length of the code they begin with in the high byte and its symbol in the low byte. The
    /// length is 9 if the code is longer than 8 bits.
    lookup: [u16; 1 << LOOKAHEAD],
    /// For each length from 9 to 16: the least 16 bits that begin with no code of up to that length.
    long_limits: [u16; 8],
    /// Of an AC table, by the next `SHORT_BITS` bits.
    short: [ShortCoefficient; 1 << SHORT_BITS],
}

/// An AC coefficient whose code and value are few bits together.
#[derive(Clone, Copy, Default)]
pub(crate) struct ShortCoefficient {
    pub(crate) value: i16,
    /// Zeros before it.
    pub(crate) run: u8,
    /// Of the code and the value in bits, or 0 if the bits do not begin with such a coefficient.
    length: u8,
}

/// What the symbols of a table stand for.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TableKind {
    Dc,
    Ac,
    /// The differences of a lossless stream.
    Lossless,
}

impl DerivedTable {
    pub(crate) fn new(spec: &HuffSpec, kind: TableKind) -> Result<Box<Self>> {
        let mut table = try_box(DerivedTable {
            maxcode: [-1; 17],
            valoffset: [0; 17],
            huffval: spec.huffval,
            lookup: [((LOOKAHEAD + 1) << LOOKAHEAD) as u16; 1 << LOOKAHEAD],
            long_limits: [0; 8],
            short: [ShortCoefficient::default(); 1 << SHORT_BITS],
        })?;

        let mut code: u32 = 0;
        let mut first: usize = 0;
        let lengths = spec
            .bits
            .iter()
            .zip(table.maxcode.iter_mut().zip(table.valoffset.iter_mut()));
        for (length, (&count, (maxcode, valoffset))) in lengths.enumerate().skip(1) {
            let count = usize::from(count);
            if count != 0 {
                *valoffset = first as i32 - code as i32;
                if length as u32 <= LOOKAHEAD {
                    // Every byte that begins with one of these codes.
                    let shift = LOOKAHEAD - length as u32;
                    let symbols = spec.huffval.iter().skip(first).take(count);
                    let entries = table.lookup.get_mut((code as usize) << shift..);
                    let entries = entries.ok_or(Error::Internal)?.chunks_mut(1 << shift);
                    for (entries, &symbol) in entries.zip(symbols) {
                        entries.fill(((length as u16) << LOOKAHEAD) | u16::from(symbol));
                    }
                }
                if kind == TableKind::Ac {
                    let symbols = spec.huffval.iter().skip(first).take(count);
                    for (code, &symbol) in (code..).zip(symbols) {
                        add_short_coefficients(&mut table.short, code, length as u32, symbol);
                    }
                }
                code += count as u32;
                first += count;
                *maxcode = code as i32 - 1;
            }
            // No code is all ones, so one more than the last code still fits in `length` bits.
            if code >= 1 << length {
                return Err(Error::BadHuffTable);
            }
            if let Some(limit) = (length.checked_sub(LOOKAHEAD as usize + 1))
                .and_then(|i| table.long_limits.get_mut(i))
            {
                *limit = (code << (16 - length)) as u16;
            }
            code <<= 1;
        }

        // The symbol of a difference is a number of bits to read.
        let max_symbol = match kind {
            TableKind::Dc => 15,
            TableKind::Ac => 255,
            TableKind::Lossless => 16,
        };
        if spec
            .huffval
            .iter()
            .take(first)
            .any(|&symbol| symbol > max_symbol)
        {
            return Err(Error::BadHuffTable);
        }
        Ok(table)
    }
}

/// The coefficients that `symbol` announces, if they are short.
fn add_short_coefficients(
    short: &mut [ShortCoefficient; 1 << SHORT_BITS],
    code: u32,
    code_length: u32,
    symbol: u8,
) {
    let size = u32::from(symbol & 15);
    let length = code_length + size;
    if size == 0 || length > SHORT_BITS {
        return;
    }
    let unused = SHORT_BITS - length;
    let Some(entries) = short.get_mut((code << (size + unused)) as usize..) else {
        return;
    };
    for (bits, entries) in (0..1 << size).zip(entries.chunks_mut(1 << unused)) {
        entries.fill(ShortCoefficient {
            value: huff_extend(bits, size) as i16,
            run: symbol >> 4,
            length: length as u8,
        });
    }
}

pub(crate) type DerivedTables = [Option<Box<DerivedTable>>; NUM_HUFF_TABLES];

/// Derives the table that `selector` picks among `specs`, for `table` to find in `tables`.
pub(crate) fn derive(
    specs: &[Option<Box<HuffSpec>>; NUM_HUFF_TABLES],
    selector: u8,
    kind: TableKind,
    tables: &mut DerivedTables,
) -> Result<()> {
    let spec = specs.get(usize::from(selector)).and_then(Option::as_deref);
    let table = DerivedTable::new(spec.ok_or(Error::NoHuffTable(selector))?, kind)?;
    *tables
        .get_mut(usize::from(selector))
        .ok_or(Error::Internal)? = Some(table);
    Ok(())
}

#[inline(always)]
pub(crate) fn table(tables: &DerivedTables, selector: u8) -> Result<&DerivedTable> {
    tables
        .get(usize::from(selector))
        .and_then(Option::as_deref)
        .ok_or(Error::Internal)
}

/// `x` is `s` bits read after a symbol `s`: the upper half of their range stands for itself, the lower half for the
/// negative numbers.
#[inline(always)]
pub(crate) fn huff_extend(x: i32, s: u32) -> i32 {
    let range = 1 << s;
    x + (((x - (range >> 1)) >> 31) & (1 - range))
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

    /// Reads bytes until the buffer is full or a marker comes. Afterwards there are at least `nbits` bits, made up if
    /// need be.
    ///
    /// By value, here and in `decode_slow`, so that a reader that is a local variable can stay in registers.
    #[inline(never)]
    fn filled(mut self, input: &mut Input, nbits: u32) -> Self {
        if input.unread_marker == 0 {
            while self.bits_left < MIN_GET_BITS {
                let mut c = input.byte();
                if c == 0xff {
                    // Several FFs and a zero are taken for one FF of data, which the standard does not allow.
                    while c == 0xff {
                        c = input.byte();
                    }
                    if c != 0 {
                        input.unread_marker = c;
                        break;
                    }
                    c = 0xff;
                }
                self.buf = (self.buf << 8) | u64::from(c);
                self.bits_left += 8;
            }
        }
        if nbits > self.bits_left {
            input.insufficient_data = true;
            self.buf <<= MIN_GET_BITS - self.bits_left;
            self.bits_left = MIN_GET_BITS;
        }
        self
    }

    /// Makes sure of `nbits` bits, at most 16.
    #[inline(always)]
    pub(crate) fn ensure(&mut self, input: &mut Input, nbits: u32) {
        if self.bits_left < nbits {
            *self = self.filled(input, nbits);
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
    pub(crate) fn decode(&mut self, input: &mut Input, table: &DerivedTable) -> u8 {
        let mut min_bits = 1;
        if self.bits_left < LOOKAHEAD {
            *self = self.filled(input, 0);
        }
        // Otherwise the segment ends here. The code may still be whole.
        if self.bits_left >= LOOKAHEAD {
            let (length, symbol) = self.lookup(table);
            if length <= LOOKAHEAD {
                self.bits_left -= length;
                return symbol;
            }
            min_bits = length;
        }
        let symbol;
        (*self, symbol) = self.decode_slow(input, table, min_bits);
        symbol
    }

    /// The code is known to have at least `min_bits` bits.
    #[inline(never)]
    fn decode_slow(mut self, input: &mut Input, table: &DerivedTable, min_bits: u32) -> (Self, u8) {
        let mut length = min_bits as usize;
        self.ensure(input, min_bits);
        let mut code = self.get(min_bits);
        while table.maxcode.get(length).is_some_and(|&max| code > max) {
            code <<= 1;
            self.ensure(input, 1);
            code |= self.get(1);
            length += 1;
        }
        if length > 16 {
            return (self, 0);
        }
        let offset = table.valoffset.get(length).copied().unwrap_or(0);
        let symbol = table.huffval.get((code + offset) as usize);
        (self, symbol.copied().unwrap_or(0))
    }
}

/// Where a sequential scan gets the bits of an MCU from.
pub(crate) trait Bits {
    /// The next symbol.
    fn symbol(&mut self, table: &DerivedTable) -> u8;
    /// The next `n` bits, from 1 to 15.
    fn bits(&mut self, n: u32) -> i32;
    /// The next AC coefficient, if there is a shortcut to it.
    #[inline(always)]
    fn short_coefficient(&mut self, _table: &DerivedTable) -> Option<ShortCoefficient> {
        None
    }
    /// After the last coefficient of a block came from `short_coefficient`.
    #[inline(always)]
    fn catch_up(&mut self, _last: ShortCoefficient) {}
}

pub(crate) struct SlowBits<'a, 'b> {
    pub(crate) bits: BitReader,
    pub(crate) input: &'a mut Input<'b>,
}

impl Bits for SlowBits<'_, '_> {
    #[inline(always)]
    fn symbol(&mut self, table: &DerivedTable) -> u8 {
        self.bits.decode(self.input, table)
    }

    #[inline(always)]
    fn bits(&mut self, n: u32) -> i32 {
        self.bits.ensure(self.input, n);
        self.bits.get(n)
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
    fn fill(&mut self) {
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
        // By value, so that the reader can stay in registers.
        let filled = fill_bytewise(self.data, self.at, self.bits.buf);
        self.bits.buf = filled.buf;
        self.bits.bits_left += 48;
        self.at = filled.at;
        self.saw_marker |= filled.saw_marker;
    }
}

impl Bits for FastBitReader<'_> {
    #[inline(always)]
    fn bits(&mut self, n: u32) -> i32 {
        self.fill();
        self.bits.get(n)
    }

    /// libjpeg-turbo looks whether to fill once more, between the code and the value. The next look makes up for that,
    /// and `catch_up` does where there may be none.
    #[inline(always)]
    fn short_coefficient(&mut self, table: &DerivedTable) -> Option<ShortCoefficient> {
        self.fill();
        let next = (self.bits.buf >> (self.bits.bits_left - SHORT_BITS)) as usize;
        let short = *table.short.get(next % (1 << SHORT_BITS))?;
        self.bits.bits_left -= u32::from(short.length);
        (short.length != 0).then_some(short)
    }

    #[inline(always)]
    fn catch_up(&mut self, last: ShortCoefficient) {
        let size = u16::BITS - last.value.unsigned_abs().leading_zeros();
        if self.bits.bits_left + size <= 16 {
            self.fill_6_bytes();
        }
    }

    #[inline(always)]
    fn symbol(&mut self, table: &DerivedTable) -> u8 {
        self.fill();
        let (length, symbol) = self.bits.lookup(table);
        if length <= LOOKAHEAD {
            self.bits.bits_left -= length;
            return symbol;
        }
        // Instead of going from length to length, which the branch predictor cannot follow.
        let next = (self.bits.buf >> (self.bits.bits_left - 16)) as u16;
        let too_short = table.long_limits.iter().filter(|&&limit| next >= limit);
        let length = length + too_short.count() as u32;
        self.bits.bits_left -= length;
        if length > 16 {
            return 0;
        }
        let code = i32::from(next >> (16 - length));
        let offset = table.valoffset.get(length as usize).copied().unwrap_or(0);
        table
            .huffval
            .get(((code + offset) & 0xff) as usize)
            .copied()
            .unwrap_or(0)
    }
}

struct Filled {
    buf: u64,
    at: usize,
    saw_marker: bool,
}

/// Six more bytes for `buf`, from `data[at..]`.
#[inline(never)]
fn fill_bytewise(data: &[u8], mut at: usize, mut buf: u64) -> Filled {
    // Most often what is in the way is a single FF 00.
    if let Some(&chunk) = data.get(at..).and_then(|data| data.first_chunk::<8>()) {
        let w = u64::from_be_bytes(chunk);
        // The top bit of every byte that is FF.
        let ff = ((w & 0x7f7f_7f7f_7f7f_7f7f) + 0x0101_0101_0101_0101) & w & 0x8080_8080_8080_8080;
        let before = ff.leading_zeros();
        // The caller saw an FF in the first six bytes, but JavaScript can have written to them since.
        if before <= 40 {
            let after = u64::MAX >> (before + 8);
            let only_ff = (ff ^ (1 << 63 >> before)) >> 8 == 0;
            if only_ff && (w & after) >> (48 - before) == 0 {
                let without_zero = (w & !after) | ((w << 8) & after);
                return Filled {
                    buf: (buf << 48) | (without_zero >> 16),
                    at: at + 7,
                    saw_marker: false,
                };
            }
        }
    }
    let mut saw_marker = false;
    for _ in 0..6 {
        let c0 = data.get(at).copied().unwrap_or(0);
        let c1 = data.get(at + 1).copied().unwrap_or(0);
        let mut byte = c0;
        if c0 != 0xff {
            at += 1;
        } else if c1 == 0 {
            at += 2;
        } else {
            saw_marker = true;
            byte = 0;
        }
        buf = (buf << 8) | u64::from(byte);
    }
    Filled {
        buf,
        at,
        saw_marker,
    }
}
