//! The Huffman code of string literals (RFC 7541 §5.2).

use crate::{Error, Result, wrapped, wrapped_mut};

/// How far both directions may write past their result.
pub(crate) const SLACK: usize = 8;

const SHORTEST: usize = 5;
const LONGEST: usize = 30;
const EOS: usize = 256;

/// Appendix B. The code is canonical, so the rest follows from these.
#[rustfmt::skip]
const LENGTHS: [u8; EOS + 1] = [
    13, 23, 28, 28, 28, 28, 28, 28, 28, 24, 30, 28, 28, 30, 28, 28,
    28, 28, 28, 28, 28, 28, 30, 28, 28, 28, 28, 28, 28, 28, 28, 28,
     6, 10, 10, 12, 13,  6,  8, 11, 10, 10,  8, 11,  8,  6,  6,  6,
     5,  5,  5,  6,  6,  6,  6,  6,  6,  6,  7,  8, 15,  6, 12, 10,
    13,  6,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,
     7,  7,  7,  7,  7,  7,  7,  7,  8,  7,  8, 13, 19, 13, 14,  6,
    15,  5,  6,  5,  6,  5,  6,  6,  6,  5,  7,  7,  6,  6,  6,  5,
     6,  7,  6,  5,  5,  6,  7,  7,  7,  7,  7, 15, 11, 14, 13, 28,
    20, 22, 20, 20, 22, 22, 22, 23, 22, 23, 23, 23, 23, 23, 24, 23,
    24, 24, 22, 23, 24, 23, 23, 23, 23, 21, 22, 23, 22, 23, 23, 24,
    22, 21, 20, 22, 22, 23, 23, 21, 23, 22, 22, 24, 21, 22, 23, 23,
    21, 21, 22, 21, 23, 22, 23, 23, 20, 22, 22, 22, 23, 22, 22, 23,
    26, 26, 20, 19, 22, 23, 22, 25, 26, 26, 26, 27, 27, 26, 24, 25,
    19, 21, 26, 27, 27, 26, 27, 24, 21, 21, 26, 26, 28, 27, 27, 27,
    20, 24, 20, 21, 22, 21, 21, 23, 22, 22, 25, 25, 24, 24, 26, 23,
    26, 27, 26, 26, 27, 27, 27, 27, 27, 28, 27, 27, 27, 27, 27, 26,
    30,
];

/// The codes of one length. They are in the highest bits, like all codes here.
#[derive(Clone, Copy)]
struct Group {
    last_code: u64,
    /// In [`Canonical::symbols`].
    last_position: u8,
}

struct Canonical {
    codes: [u64; EOS],
    /// In the order of their codes. EOS would follow.
    symbols: [u8; EOS],
    /// By length.
    groups: [Group; 32],
}

#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
const CANONICAL: Canonical = {
    let empty = Group {
        last_code: 0,
        last_position: 0,
    };
    let mut canonical = Canonical {
        codes: [0; EOS],
        symbols: [0; EOS],
        groups: [empty; 32],
    };
    let (mut code, mut position, mut length) = (0u64, 0, SHORTEST);
    while length <= LONGEST {
        let mut symbol = 0;
        while symbol < EOS {
            if LENGTHS[symbol] as usize == length {
                canonical.codes[symbol] = code;
                canonical.symbols[position] = symbol as u8;
                code += 1 << (64 - length);
                position += 1;
            }
            symbol += 1;
        }
        canonical.groups[length] = Group {
            last_code: code - 1,
            last_position: (position - 1) as u8,
        };
        length += 1;
    }
    canonical
};

static CODES: [u64; EOS] = CANONICAL.codes;
static CODE_LENGTHS: &[u8; EOS] = LENGTHS.first_chunk().unwrap();
static SYMBOLS: [u8; EOS] = CANONICAL.symbols;
static GROUPS: [Group; 32] = CANONICAL.groups;

/// Bits on their way to `out`.
struct Writer<'a> {
    out: &'a mut [u8],
    written: usize,
    bits: u64,
    count: u32,
}

impl Writer<'_> {
    /// The bits are of no use if there are too many.
    #[inline(always)]
    fn with(&self, symbols: &[u8]) -> (u64, u32) {
        let (mut bits, mut count) = (self.bits, self.count);
        for &symbol in symbols {
            bits |= wrapped(&CODES, symbol.into()).wrapping_shr(count);
            count += u32::from(*wrapped(CODE_LENGTHS, symbol.into()));
        }
        (bits, count)
    }

    #[inline(always)]
    fn store(&mut self, (bits, count): (u64, u32)) -> Option<()> {
        let out = self.out.get_mut(self.written..).unwrap_or_default();
        *out.first_chunk_mut()? = bits.to_be_bytes();
        self.written += count as usize / 8;
        self.bits = bits << (count / 8 * 8);
        self.count = count % 8;
        Some(())
    }

    #[inline(always)]
    fn write(&mut self, symbols: &[u8]) -> Option<()> {
        if let bits @ (_, ..u64::BITS) = self.with(symbols) {
            return self.store(bits);
        }
        core::hint::cold_path();
        for symbol in symbols {
            self.store(self.with(core::slice::from_ref(symbol)))?;
        }
        Some(())
    }
}

/// Returns the length of the result, or `None` if that is longer than `out` without its [`SLACK`].
#[inline(always)]
pub(crate) fn encode(text: &[u8], out: &mut [u8]) -> Option<usize> {
    const GROUP_LEN: usize = 4;
    let mut writer = Writer {
        out,
        written: 0,
        bits: 0,
        count: 0,
    };
    let (groups, rest) = text.as_chunks::<GROUP_LEN>();
    for group in groups {
        writer.write(group)?;
    }
    writer.write(rest)?;
    let padded = writer.bits | u64::MAX >> writer.count;
    writer.store((padded, writer.count.next_multiple_of(8)))?;
    (writer.written + SLACK <= writer.out.len()).then_some(writer.written)
}

/// The most that `len` bytes decode to.
#[inline(always)]
pub(crate) const fn max_decoded_len(len: usize) -> usize {
    len * 8 / SHORTEST
}

const LOOKUP_BITS: usize = 12;
const LOOKUPS_PER_REFILL: usize = 4;

/// What the next [`LOOKUP_BITS`] bits start with. From the lowest byte: a number of bits, a number of symbols, and up to two symbols.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static LOOKUP: [u32; 1 << LOOKUP_BITS] = {
    let mut lookup = [0; 1 << LOOKUP_BITS];
    let mut count = 1;
    while count <= 2 {
        let mut symbols = 0;
        while symbols < 1 << (8 * count) {
            let (first, second) = (symbols % EOS, symbols / EOS);
            let (mut code, mut length) = (CANONICAL.codes[first], LENGTHS[first] as usize);
            if count == 2 {
                code |= CANONICAL.codes[second] >> length;
                length += LENGTHS[second] as usize;
            }
            if length <= LOOKUP_BITS {
                let mut index = (code >> (64 - LOOKUP_BITS)) as usize;
                let end = index + (1 << (LOOKUP_BITS - length));
                while index < end {
                    lookup[index] = (symbols << 16 | count << 8 | length) as u32;
                    index += 1;
                }
            }
            symbols += 1;
        }
        count += 1;
    }
    lookup
};

struct Reader<'a> {
    out: &'a mut [u8],
    written: usize,
    /// The next bit is the highest.
    bits: u64,
    count: u32,
}

impl Reader<'_> {
    /// `next` is what follows the bits counted so far. Returns how many of its bytes are counted now.
    #[inline(always)]
    fn refill(&mut self, next: u64) -> usize {
        self.bits |= next >> self.count;
        let taken = (63 - self.count) / 8;
        self.count |= 56;
        taken as usize
    }

    /// Returns false if a code longer than [`LOOKUP_BITS`] is in the way.
    #[inline(always)]
    fn read_short_codes(&mut self) -> Result<bool> {
        let out = self.out.get_mut(self.written..).unwrap_or_default();
        let out: &mut [u8; 2 * LOOKUPS_PER_REFILL] =
            out.first_chunk_mut().ok_or(Error::FieldTooLong)?;
        let (mut sum, mut last) = (0u32, 0);
        for _ in 0..LOOKUPS_PER_REFILL {
            last = *wrapped(&LOOKUP, (self.bits >> (64 - LOOKUP_BITS)) as usize);
            let at = usize::from((sum >> 8) as u8);
            *wrapped_mut(out, at) = (last >> 16) as u8;
            *wrapped_mut(out, at + 1) = (last >> 24) as u8;
            self.bits = self.bits.wrapping_shl(last);
            sum = sum.wrapping_add(last);
        }
        self.count -= u32::from(sum as u8);
        self.written += usize::from((sum >> 8) as u8);
        Ok(last != 0)
    }

    /// Needs a refill before it.
    #[inline(always)]
    fn read_long_code(&mut self) -> Result<()> {
        let (symbol, length) = long_code(self.bits).ok_or(Error::Malformed)?;
        // What came before the code has not filled the part that `read_short_codes` asked for.
        self.out
            .split_at_mut(self.written)
            .1
            .iter_mut()
            .take(1)
            .for_each(|to| *to = symbol);
        self.written += 1;
        self.bits <<= length;
        self.count -= length;
        Ok(())
    }
}

/// The symbol and length of the code that `bits` starts with, unless that is EOS.
#[inline(never)]
fn long_code(bits: u64) -> Option<(u8, u32)> {
    let mut lengths = LOOKUP_BITS + 1..=LONGEST;
    let length = lengths.find(|&length| bits <= wrapped(&GROUPS, length).last_code)?;
    let group = wrapped(&GROUPS, length);
    let before_last = (group.last_code - bits) >> (64 - length);
    let position = usize::from(group.last_position) - before_last as usize;
    Some((*wrapped(&SYMBOLS, position), length as u32))
}

/// Up to 7 bytes in the highest bits, and ones after them.
#[inline(always)]
fn padded(bytes: &[u8]) -> u64 {
    let after = 64 - 8 * bytes.len() as u32;
    let bits = match (bytes.first_chunk(), bytes.last_chunk(), bytes) {
        (Some(&first), Some(&last), _) => {
            u64::from(u32::from_be_bytes(first)) << 32
                | u64::from(u32::from_be_bytes(last)) << after
        }
        (_, _, &[first, second, last]) => {
            u64::from(u32::from_be_bytes([first, second, last, 0])) << 32
        }
        (_, _, &[first, last]) => u64::from(u16::from_be_bytes([first, last])) << 48,
        (_, _, &[first, ..]) => u64::from(first) << 56,
        (_, _, []) => return u64::MAX,
    };
    bits | u64::MAX >> (64 - after)
}

/// Returns the length of the result, which may reach into the [`SLACK`] of `out`.
#[inline(always)]
pub(crate) fn decode(mut encoded: &[u8], out: &mut [u8]) -> Result<usize> {
    let mut reader = Reader {
        out,
        written: 0,
        bits: 0,
        count: 0,
    };
    let mut is_at_long_code = false;
    while let Some(&next) = encoded.first_chunk() {
        let taken = reader.refill(u64::from_be_bytes(next));
        encoded = encoded.get(taken..).unwrap_or_default();
        if is_at_long_code {
            reader.read_long_code()?;
            is_at_long_code = false;
        } else {
            is_at_long_code = !reader.read_short_codes()?;
        }
    }

    let mut next = padded(encoded);
    let mut left = i64::from(reader.count) + 8 * encoded.len() as i64;
    loop {
        let taken = reader.refill(next);
        next = !(!next << (8 * taken));
        let before = reader.count;
        if is_at_long_code {
            reader.read_long_code()?;
            is_at_long_code = false;
        } else {
            is_at_long_code = !reader.read_short_codes()?;
        }
        left -= i64::from(before - reader.count);
        match left {
            ..0 => return Err(Error::Malformed),
            // A long code starts with more ones than that.
            0..8 if is_at_long_code => return Ok(reader.written),
            _ => {}
        }
    }
}
