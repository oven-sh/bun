//! The Huffman code of string literals (RFC 7541 §5.2).

use crate::{Error, Result, wrapped};

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

static SYMBOLS: [u8; EOS] = CANONICAL.symbols;
static GROUPS: [Group; 32] = CANONICAL.groups;

const LENGTH_BITS: u32 = 5;

/// With their lengths in the lowest [`LENGTH_BITS`] bits.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static CODES: [u64; EOS] = {
    let (mut codes, mut symbol) = (CANONICAL.codes, 0);
    while symbol < EOS {
        codes[symbol] |= LENGTHS[symbol] as u64;
        symbol += 1;
    }
    codes
};

/// Bits on their way to `out`.
struct Writer<'a> {
    out: &'a mut [u8],
    bits: u64,
    count: u8,
}

impl Writer<'_> {
    /// The bits are of no use if there are too many.
    #[inline(always)]
    fn with(&self, symbols: &[u8]) -> (u64, u8) {
        let (mut bits, mut count) = (self.bits, u64::from(self.count));
        for &symbol in symbols {
            let code = *wrapped(&CODES, symbol.into());
            bits |= code.wrapping_shr(count as u32);
            count = count.wrapping_add(code);
        }
        (bits >> LENGTH_BITS << LENGTH_BITS, count as u8)
    }

    #[inline(always)]
    fn store(&mut self, (bits, count): (u64, u8)) -> Option<()> {
        *self.out.first_chunk_mut()? = bits.to_be_bytes();
        let whole_bytes = count / 8 % 8;
        let _ = self.out.split_off_mut(..whole_bytes.into());
        self.bits = bits << (8 * whole_bytes);
        self.count = count % 8;
        Some(())
    }
}

/// Returns the length of the result, or `None` if that is longer than `out` without its [`SLACK`].
#[inline(always)]
pub(crate) fn encode(mut text: &[u8], out: &mut [u8]) -> Option<usize> {
    const GROUP_LEN: usize = 5;
    let out_len = out.len();
    let mut writer = Writer {
        out,
        bits: 0,
        count: 0,
    };
    while !text.is_empty() {
        while let Some((group, rest)) = text.split_first_chunk::<GROUP_LEN>()
            && let (bits, count) = writer.with(group)
            && u32::from(count) <= u64::BITS - LENGTH_BITS
        {
            writer.store((bits, count))?;
            text = rest;
        }
        let mut symbols = text.iter();
        for symbol in symbols.by_ref().take(GROUP_LEN) {
            writer.store(writer.with(core::slice::from_ref(symbol)))?;
        }
        text = symbols.as_slice();
    }
    let padded = writer.bits | u64::MAX >> writer.count;
    writer.store((padded, writer.count.next_multiple_of(8)))?;
    let left = writer.out.len();
    (left >= SLACK).then_some(out_len - left)
}

/// The most that `len` bytes decode to.
#[inline(always)]
pub(crate) const fn max_decoded_len(len: usize) -> usize {
    len * 8 / SHORTEST
}

const LOOKUP_BITS: usize = 12;
const LOOKUPS_PER_STEP: usize = 4;

const _: () = assert!(LOOKUP_BITS * (LOOKUPS_PER_STEP + 1) <= 64 && 2 * LOOKUPS_PER_STEP <= SLACK);

/// From the lowest byte: the bits that the codes take, the bits that their symbols take, and up to two symbols.
const fn entry(symbols: usize, count: usize, length: usize) -> u32 {
    (symbols << 16 | (8 * count) << 8 | length) as u32
}

/// An [`entry`] for what the next [`LOOKUP_BITS`] bits of a [`Reader`] start with, or 0.
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
                    lookup[!index % (1 << LOOKUP_BITS)] = entry(symbols, count, length);
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
    /// The next bit is the highest. All are inverted, which makes padding of the zeros that shifts bring in.
    bits: u64,
    /// How many of `bits` are from bytes that the caller has moved past.
    count: u32,
}

impl Reader<'_> {
    /// Makes all of `bits` valid. `next` is what follows those that are counted.
    #[inline(always)]
    fn fill(&mut self, next: u64) {
        self.bits |= next >> self.count;
    }

    #[inline(always)]
    fn look_up(&self) -> u32 {
        *wrapped(&LOOKUP, (self.bits >> (64 - LOOKUP_BITS)) as usize)
    }

    /// Returns how many bytes of `next` are counted now.
    #[inline(always)]
    fn step(&mut self, next: u64) -> Result<u32> {
        // The last fill has left enough for one lookup, which thus does not wait for this one.
        let mut sum = self.look_up();
        self.fill(next);
        let taken = (63 - self.count) / 8;
        let lookups_left = if sum == 0 {
            sum = long_code(!self.bits).ok_or(Error::Malformed)?;
            0
        } else {
            LOOKUPS_PER_STEP - 1
        };
        let mut symbols = u64::from(sum >> 16);
        self.bits = self.bits.wrapping_shl(sum);
        for _ in 0..lookups_left {
            let entry = self.look_up();
            symbols |= u64::from(entry >> 16).wrapping_shl(sum >> 8);
            self.bits = self.bits.wrapping_shl(entry);
            sum = sum.wrapping_add(entry);
        }
        let out = self.out.get_mut(self.written..).unwrap_or_default();
        *out.first_chunk_mut().ok_or(Error::FieldTooLong)? = symbols.to_le_bytes();
        self.written += usize::from((sum >> 8) as u8 / 8);
        self.count = (self.count | 56) - u32::from(sum as u8);
        Ok(taken)
    }
}

/// What would be in [`LOOKUP`] for the code that `bits` starts with, unless that is EOS.
#[inline(never)]
fn long_code(bits: u64) -> Option<u32> {
    let mut lengths = LOOKUP_BITS + 1..=LONGEST;
    let length = lengths.find(|&length| bits <= wrapped(&GROUPS, length).last_code)?;
    let group = wrapped(&GROUPS, length);
    let before_last = (group.last_code - bits) >> (64 - length);
    let position = usize::from(group.last_position) - before_last as usize;
    Some(entry((*wrapped(&SYMBOLS, position)).into(), 1, length))
}

/// `context` ends with `encoded`. Returns the length of the result, which may reach into the [`SLACK`] of `out`.
#[inline(never)]
pub(crate) fn decode(mut encoded: &[u8], context: &[u8], out: &mut [u8]) -> Result<usize> {
    let mut reader = Reader {
        out,
        written: 0,
        bits: 0,
        count: 0,
    };
    if let Some(&next) = encoded.first_chunk() {
        reader.fill(!u64::from_be_bytes(next));
    }
    while let Some(&next) = encoded.first_chunk() {
        let taken = reader.step(!u64::from_be_bytes(next))?;
        encoded = encoded.get(taken as usize..).unwrap_or_default();
    }

    let last = match context.last_chunk() {
        Some(&last) => u64::from_be_bytes(last),
        None => context
            .iter()
            .fold(0, |last, &byte| last << 8 | u64::from(byte)),
    };
    let mut next = !last << 8 << (56 - 8 * encoded.len());
    let mut left = i64::from(reader.count) + 8 * encoded.len() as i64;
    reader.fill(next);
    while reader.bits | next != 0 {
        let before = reader.count | 56;
        next <<= 8 * reader.step(next)?;
        left -= i64::from(before - reader.count);
    }
    match left {
        0..8 => Ok(reader.written),
        _ => Err(Error::Malformed),
    }
}
