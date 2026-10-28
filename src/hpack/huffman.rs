//! The Huffman code for string literals (§5.2, Appendix B).

use crate::{Error, Result};

#[cfg(not(test))]
use bun_highway::{has_hpack_huffman_kernel, hpack_huffman_decode_short};
#[cfg(test)]
use test_kernel::{has_hpack_huffman_kernel, hpack_huffman_decode_short};

/// `(code, length in bits)` of each byte.
#[rustfmt::skip]
const CODES: [(u32, u8); 256] = [
    (0x1ff8, 13), (0x7fffd8, 23), (0xfffffe2, 28), (0xfffffe3, 28),
    (0xfffffe4, 28), (0xfffffe5, 28), (0xfffffe6, 28), (0xfffffe7, 28),
    (0xfffffe8, 28), (0xffffea, 24), (0x3ffffffc, 30), (0xfffffe9, 28),
    (0xfffffea, 28), (0x3ffffffd, 30), (0xfffffeb, 28), (0xfffffec, 28),
    (0xfffffed, 28), (0xfffffee, 28), (0xfffffef, 28), (0xffffff0, 28),
    (0xffffff1, 28), (0xffffff2, 28), (0x3ffffffe, 30), (0xffffff3, 28),
    (0xffffff4, 28), (0xffffff5, 28), (0xffffff6, 28), (0xffffff7, 28),
    (0xffffff8, 28), (0xffffff9, 28), (0xffffffa, 28), (0xffffffb, 28),
    (0x14, 6), (0x3f8, 10), (0x3f9, 10), (0xffa, 12),
    (0x1ff9, 13), (0x15, 6), (0xf8, 8), (0x7fa, 11),
    (0x3fa, 10), (0x3fb, 10), (0xf9, 8), (0x7fb, 11),
    (0xfa, 8), (0x16, 6), (0x17, 6), (0x18, 6),
    (0x0, 5), (0x1, 5), (0x2, 5), (0x19, 6),
    (0x1a, 6), (0x1b, 6), (0x1c, 6), (0x1d, 6),
    (0x1e, 6), (0x1f, 6), (0x5c, 7), (0xfb, 8),
    (0x7ffc, 15), (0x20, 6), (0xffb, 12), (0x3fc, 10),
    (0x1ffa, 13), (0x21, 6), (0x5d, 7), (0x5e, 7),
    (0x5f, 7), (0x60, 7), (0x61, 7), (0x62, 7),
    (0x63, 7), (0x64, 7), (0x65, 7), (0x66, 7),
    (0x67, 7), (0x68, 7), (0x69, 7), (0x6a, 7),
    (0x6b, 7), (0x6c, 7), (0x6d, 7), (0x6e, 7),
    (0x6f, 7), (0x70, 7), (0x71, 7), (0x72, 7),
    (0xfc, 8), (0x73, 7), (0xfd, 8), (0x1ffb, 13),
    (0x7fff0, 19), (0x1ffc, 13), (0x3ffc, 14), (0x22, 6),
    (0x7ffd, 15), (0x3, 5), (0x23, 6), (0x4, 5),
    (0x24, 6), (0x5, 5), (0x25, 6), (0x26, 6),
    (0x27, 6), (0x6, 5), (0x74, 7), (0x75, 7),
    (0x28, 6), (0x29, 6), (0x2a, 6), (0x7, 5),
    (0x2b, 6), (0x76, 7), (0x2c, 6), (0x8, 5),
    (0x9, 5), (0x2d, 6), (0x77, 7), (0x78, 7),
    (0x79, 7), (0x7a, 7), (0x7b, 7), (0x7ffe, 15),
    (0x7fc, 11), (0x3ffd, 14), (0x1ffd, 13), (0xffffffc, 28),
    (0xfffe6, 20), (0x3fffd2, 22), (0xfffe7, 20), (0xfffe8, 20),
    (0x3fffd3, 22), (0x3fffd4, 22), (0x3fffd5, 22), (0x7fffd9, 23),
    (0x3fffd6, 22), (0x7fffda, 23), (0x7fffdb, 23), (0x7fffdc, 23),
    (0x7fffdd, 23), (0x7fffde, 23), (0xffffeb, 24), (0x7fffdf, 23),
    (0xffffec, 24), (0xffffed, 24), (0x3fffd7, 22), (0x7fffe0, 23),
    (0xffffee, 24), (0x7fffe1, 23), (0x7fffe2, 23), (0x7fffe3, 23),
    (0x7fffe4, 23), (0x1fffdc, 21), (0x3fffd8, 22), (0x7fffe5, 23),
    (0x3fffd9, 22), (0x7fffe6, 23), (0x7fffe7, 23), (0xffffef, 24),
    (0x3fffda, 22), (0x1fffdd, 21), (0xfffe9, 20), (0x3fffdb, 22),
    (0x3fffdc, 22), (0x7fffe8, 23), (0x7fffe9, 23), (0x1fffde, 21),
    (0x7fffea, 23), (0x3fffdd, 22), (0x3fffde, 22), (0xfffff0, 24),
    (0x1fffdf, 21), (0x3fffdf, 22), (0x7fffeb, 23), (0x7fffec, 23),
    (0x1fffe0, 21), (0x1fffe1, 21), (0x3fffe0, 22), (0x1fffe2, 21),
    (0x7fffed, 23), (0x3fffe1, 22), (0x7fffee, 23), (0x7fffef, 23),
    (0xfffea, 20), (0x3fffe2, 22), (0x3fffe3, 22), (0x3fffe4, 22),
    (0x7ffff0, 23), (0x3fffe5, 22), (0x3fffe6, 22), (0x7ffff1, 23),
    (0x3ffffe0, 26), (0x3ffffe1, 26), (0xfffeb, 20), (0x7fff1, 19),
    (0x3fffe7, 22), (0x7ffff2, 23), (0x3fffe8, 22), (0x1ffffec, 25),
    (0x3ffffe2, 26), (0x3ffffe3, 26), (0x3ffffe4, 26), (0x7ffffde, 27),
    (0x7ffffdf, 27), (0x3ffffe5, 26), (0xfffff1, 24), (0x1ffffed, 25),
    (0x7fff2, 19), (0x1fffe3, 21), (0x3ffffe6, 26), (0x7ffffe0, 27),
    (0x7ffffe1, 27), (0x3ffffe7, 26), (0x7ffffe2, 27), (0xfffff2, 24),
    (0x1fffe4, 21), (0x1fffe5, 21), (0x3ffffe8, 26), (0x3ffffe9, 26),
    (0xffffffd, 28), (0x7ffffe3, 27), (0x7ffffe4, 27), (0x7ffffe5, 27),
    (0xfffec, 20), (0xfffff3, 24), (0xfffed, 20), (0x1fffe6, 21),
    (0x3fffe9, 22), (0x1fffe7, 21), (0x1fffe8, 21), (0x7ffff3, 23),
    (0x3fffea, 22), (0x3fffeb, 22), (0x1ffffee, 25), (0x1ffffef, 25),
    (0xfffff4, 24), (0xfffff5, 24), (0x3ffffea, 26), (0x7ffff4, 23),
    (0x3ffffeb, 26), (0x7ffffe6, 27), (0x3ffffec, 26), (0x3ffffed, 26),
    (0x7ffffe7, 27), (0x7ffffe8, 27), (0x7ffffe9, 27), (0x7ffffea, 27),
    (0x7ffffeb, 27), (0xffffffe, 28), (0x7ffffec, 27), (0x7ffffed, 27),
    (0x7ffffee, 27), (0x7ffffef, 27), (0x7fffff0, 27), (0x3ffffee, 26),
];

/// The length of the longest codes. EOS is that many ones.
const MAX_CODE_BITS: u32 = 30;

fn code(byte: u8) -> (u32, u8) {
    CODES.get(usize::from(byte)).copied().unwrap_or_default()
}

pub(crate) fn encoded_len(src: &[u8]) -> usize {
    let bits: usize = src.iter().map(|&byte| usize::from(code(byte).1)).sum();
    bits.div_ceil(8)
}

/// `1 << len` of each byte: multiplying by it makes room for the code of that byte.
static SHIFTS: [u32; 256] = build_shifts();

#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_shifts() -> [u32; 256] {
    let mut shifts = [0; 256];
    let mut byte = 0;
    while byte < CODES.len() {
        shifts[byte] = 1 << CODES[byte].1;
        byte += 1;
    }
    shifts
}

/// How many bytes are coded at once. That many codes of 8 bits, the longest in plain text, fit [`GROUP_MAX_BITS`].
const GROUP_LEN: usize = 7;

/// How many bits fit 64 beside the 7 that may be pending.
const GROUP_MAX_BITS: u32 = 57;

/// Under this many bytes, groups do not pay: huffman_simd.md.
const GROUPS_MIN_LEN: usize = 64;

/// The low `count` bits of `bits` are not written yet: under 8 between calls.
#[derive(Clone, Copy)]
struct Pending {
    bits: u64,
    count: u32,
}

impl Pending {
    /// Adds `len` bits, 1 to [`GROUP_MAX_BITS`], and writes the whole bytes. No branch depends on `len`.
    #[inline(always)]
    fn put(&mut self, codes: u64, len: u32, out: &mut Vec<u8>) {
        self.bits = self.bits << len | codes;
        self.count += len;
        out.extend_from_slice(&(self.bits << (64 - self.count)).to_be_bytes());
        out.truncate(out.len() - 8 + self.count as usize / 8);
        self.count %= 8;
    }

    #[cold]
    #[inline(never)]
    fn put_each(mut self, group: [u8; GROUP_LEN], out: &mut Vec<u8>) -> Self {
        for byte in group {
            let (code, len) = code(byte);
            self.put(code.into(), len.into(), out);
        }
        self
    }
}

/// The whole groups of `src`. Returns what is pending and the rest of `src`.
#[inline(never)]
fn encode_groups<'a>(src: &'a [u8], out: &mut Vec<u8>) -> (Pending, &'a [u8]) {
    let len = |byte| code(byte).1;
    let first = |byte| u64::from(code(byte).0);
    // Wraps if the codes do not fit 64 bits. Then they are not used.
    let join = |codes: u64, byte: u8| {
        let shift = SHIFTS.get(usize::from(byte)).copied().unwrap_or_default();
        codes.wrapping_mul(shift.into()).wrapping_add(first(byte))
    };
    let (mut pending, mut rest) = (Pending { bits: 0, count: 0 }, src);
    while let Some((group, after)) = rest.split_first_chunk() {
        rest = after;
        let [a, b, c, d, e, f, g] = *group;
        let cd_len = len(c) + len(d);
        let abcd = join(first(a), b) << cd_len | join(first(c), d);
        let abcd_len = u32::from(len(a) + len(b) + cd_len);
        let efg = join(join(first(e), f), g);
        let efg_len = u32::from(len(e) + len(f) + len(g));
        if abcd_len + efg_len <= GROUP_MAX_BITS {
            pending.put(abcd << efg_len | efg, abcd_len + efg_len, out);
        } else if abcd_len.max(efg_len) <= GROUP_MAX_BITS {
            pending.put(abcd, abcd_len, out);
            pending.put(efg, efg_len, out);
        } else {
            pending = pending.put_each(*group, out);
        }
    }
    (pending, rest)
}

pub(crate) fn encode(mut src: &[u8], out: &mut Vec<u8>) {
    // The low `pending` bits are not written yet: under 32 here, and a code has at most 30.
    let mut bits: u64 = 0;
    let mut pending: u32 = 0;
    if src.len() >= GROUPS_MIN_LEN {
        let groups;
        (groups, src) = encode_groups(src, out);
        (bits, pending) = (groups.bits, groups.count);
    }
    for &byte in src {
        let (code, len) = code(byte);
        bits = (bits << len) | u64::from(code);
        pending += u32::from(len);
        if pending >= 32 {
            pending -= 32;
            out.extend_from_slice(&((bits >> pending) as u32).to_be_bytes());
        }
    }
    // The last byte is filled up with the start of EOS, which is all ones.
    let padding = pending.wrapping_neg() & 7;
    bits = (bits << padding) | ((1 << padding) - 1);
    pending += padding;
    while pending > 0 {
        pending -= 8;
        out.push((bits >> pending) as u8);
    }
}

/// Most header text has codes of 5 to 7 bits, so this is two symbols per lookup.
const PREFIX_BITS: u32 = 14;

/// What the next [`PREFIX_BITS`] bits of the input start with: one or two whole symbols, if that many fit.
#[derive(Clone, Copy)]
struct Prefix {
    /// The last symbol, which is ASCII. The top bit says that there is one before it: [`PrefixTables::first_symbols`].
    symbol: u8,
    /// The length of their codes together.
    bits: u8,
}

/// One static, so that one register holds its address.
struct PrefixTables {
    prefixes: [Prefix; 1 << PREFIX_BITS],
    /// The symbol whose code the next 8 bits of the input start with, if that many hold one.
    first_symbols: [u8; 256],
}

static PREFIXES: PrefixTables = build_prefixes();

#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_prefixes() -> PrefixTables {
    let mut tables = PrefixTables {
        prefixes: [Prefix { symbol: 0, bits: 0 }; 1 << PREFIX_BITS],
        first_symbols: [0; 256],
    };
    let mut first = 0;
    while first < CODES.len() {
        let (code, bits) = CODES[first];
        assert!(first < 0x80 || bits as u32 > PREFIX_BITS);
        let symbol = first as u8;
        fill_prefixes(&mut tables.prefixes, code, Prefix { symbol, bits });
        let mut second = 0;
        while second < CODES.len() {
            let (second_code, second_bits) = CODES[second];
            // `first_symbols` goes by 8 bits.
            assert!(bits <= 8 || (bits + second_bits) as u32 > PREFIX_BITS);
            let prefix = Prefix {
                symbol: second as u8 | 0x80,
                bits: bits + second_bits,
            };
            fill_prefixes(
                &mut tables.prefixes,
                code << second_bits | second_code,
                prefix,
            );
            second += 1;
        }
        let mut input = (code as usize) << 8 >> bits;
        while bits <= 8 && input < (code as usize + 1) << 8 >> bits {
            tables.first_symbols[input] = symbol;
            input += 1;
        }
        first += 1;
    }
    tables
}

/// Sets the entry of every input that starts with `code`, which has `prefix.bits` bits, if that many fit.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn fill_prefixes(prefixes: &mut [Prefix; 1 << PREFIX_BITS], code: u32, prefix: Prefix) {
    if prefix.bits as u32 > PREFIX_BITS {
        return;
    }
    let free_bits = PREFIX_BITS - prefix.bits as u32;
    let mut input = (code << free_bits) as usize;
    while input < ((code + 1) << free_bits) as usize {
        prefixes[input] = prefix;
        input += 1;
    }
}

/// How many bits 8 bytes hold from any bit of the first byte on.
const WINDOW_BITS: u32 = 57;

/// What [`Decoder::out`] has beyond what may come out, so that symbols can be written in groups.
const SPARE_OUT: usize = bun_highway::HPACK_HUFFMAN_SPARE_OUT;

/// Under this many bits of input, the SIMD kernel is no faster.
const KERNEL_MIN_BITS: usize = 40;

/// A call of the SIMD kernel pays off from this many symbols on.
const KERNEL_MIN_SYMBOLS: isize = 12;

struct Decoder<'a> {
    src: &'a [u8],
    /// How many bits of `src` are decoded.
    bit_pos: usize,
    out: &'a mut [u8],
    written: usize,
    /// How many symbols the SIMD kernel is ahead of paying off. Negative if there is none.
    kernel_credit: isize,
}

impl Decoder<'_> {
    /// Lets the SIMD kernel go on from `window`, the bits that come next. Returns whether it got anywhere.
    #[inline(always)]
    fn run_kernel(&mut self, window: u64) -> bool {
        // It stops at a code of more than 8 bits. All of those start with 7 ones.
        if self.kernel_credit < 0 || window >> (64 - 7) == 0x7f {
            return false;
        }
        let out = self.out.get_mut(self.written..).unwrap_or_default();
        let (bit_pos, written) = hpack_huffman_decode_short(self.src, self.bit_pos, out);
        self.bit_pos = bit_pos;
        self.written += written;
        self.kernel_credit += written as isize - KERNEL_MIN_SYMBOLS;
        written > 0
    }

    #[inline(always)]
    fn prefix(window: u64) -> Prefix {
        let index = (window >> (64 - PREFIX_BITS)) as usize;
        let prefix = PREFIXES.prefixes.get(index).copied();
        prefix.unwrap_or(Prefix { symbol: 0, bits: 0 })
    }

    #[inline(always)]
    fn first_symbol(window: u64) -> u8 {
        let first = PREFIXES.first_symbols.get((window >> 56) as usize).copied();
        first.unwrap_or_default()
    }

    /// `prefix` is what `window` starts with.
    #[inline(always)]
    fn write(&mut self, window: u64, prefix: Prefix) -> Result<()> {
        let two = usize::from(prefix.symbol >> 7);
        let out = self
            .out
            .get_mut(self.written..self.written + 2)
            .ok_or(Error::TooLarge)?;
        // No branch on how many there are: an only symbol goes over the first.
        if let Some(first) = out.first_mut() {
            *first = Self::first_symbol(window);
        }
        if let Some(last) = out.get_mut(two) {
            *last = prefix.symbol & 0x7f;
        }
        self.written += 1 + two;
        self.bit_pos += usize::from(prefix.bits);
        Ok(())
    }

    #[inline(always)]
    fn write_one(&mut self, symbol: u8, bits: u8) -> Result<()> {
        *self.out.get_mut(self.written).ok_or(Error::TooLarge)? = symbol;
        self.written += 1;
        self.bit_pos += usize::from(bits);
        Ok(())
    }

    /// All but the last 7 bytes or less of `src`, if not all.
    #[inline(always)]
    fn decode_full_windows(&mut self) -> Result<()> {
        while let Some(bytes) = self
            .src
            .get(self.bit_pos / 8..)
            .and_then(<[u8]>::first_chunk)
        {
            // 57 bits or more, from the top.
            let mut window = u64::from_be_bytes(*bytes) << (self.bit_pos % 8);
            if self.run_kernel(window) {
                continue;
            }
            let start = self.bit_pos;
            for steps_left in (0..WINDOW_BITS / PREFIX_BITS).rev() {
                let prefix = Self::prefix(window);
                if prefix.bits != 0 {
                    self.write(window, prefix)?;
                    window <<= prefix.bits;
                    continue;
                }
                let (bits, symbol) = long_symbol(window)?;
                let left = WINDOW_BITS - (self.bit_pos - start) as u32;
                // The window ends inside the code, and the zeros after it made it look like this one.
                if u32::from(bits) > left {
                    break;
                }
                self.write_one(symbol, bits)?;
                // It took the bits of a lookup that is still to come.
                if left - u32::from(bits) < steps_left * PREFIX_BITS {
                    break;
                }
                window <<= bits;
            }
        }
        Ok(())
    }

    /// The last 7 bytes or less of `src`.
    #[inline(always)]
    fn decode_tail(&mut self) -> Result<()> {
        let end = self.src.len() * 8;
        let last = match self.src.last_chunk() {
            Some(bytes) => u64::from_be_bytes(*bytes),
            None => self
                .src
                .iter()
                .fold(0, |last, &byte| last << 8 | u64::from(byte)),
        };
        let left = end - self.bit_pos;
        if left >= KERNEL_MIN_BITS {
            self.run_kernel(last << (64 - left));
        }
        // All that is left, from the top, then ones, like the padding.
        let mut window = (!last)
            .checked_shl((64 - (end - self.bit_pos)) as u32)
            .map_or(u64::MAX, |rest| !rest);
        // What is left at the end is padding: under 8 bits, all ones (the start of EOS).
        while window != u64::MAX {
            let prefix = Self::prefix(window);
            if prefix.bits != 0 && self.bit_pos + usize::from(prefix.bits) <= end {
                self.write(window, prefix)?;
                window = !(!window << prefix.bits);
                continue;
            }
            // The first of two may still be whole, and counts towards the length.
            let (bits, symbol) = match prefix {
                Prefix { bits: 0, .. } => long_symbol(window)?,
                Prefix { symbol: 0x80.., .. } => {
                    let first = Self::first_symbol(window);
                    (code(first).1, first)
                }
                _ => return Err(Error::Invalid),
            };
            if self.bit_pos + usize::from(bits) > end {
                return Err(Error::Invalid);
            }
            self.write_one(symbol, bits)?;
            window = !(!window << bits);
        }
        if end - self.bit_pos > 7 {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

/// The codes of one length. The code is canonical: they count up, and go on in the next length.
#[derive(Clone, Copy)]
struct CodeRange {
    /// The first of them and what follows the last, both from the top of 32 bits.
    first: u32,
    end: u32,
    /// Where in [`LongCodes::symbols`] theirs start.
    symbols: u8,
}

/// The codes that are longer than [`PREFIX_BITS`].
struct LongCodes {
    /// One for each length, shortest first.
    ranges: [CodeRange; (MAX_CODE_BITS - PREFIX_BITS) as usize],
    /// In the order of the codes.
    symbols: [u8; CODES.len()],
}

static LONG_CODES: LongCodes = build_long_codes();

#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_long_codes() -> LongCodes {
    let mut range = CodeRange {
        first: 0,
        end: 0,
        symbols: 0,
    };
    let mut codes = LongCodes {
        ranges: [range; (MAX_CODE_BITS - PREFIX_BITS) as usize],
        symbols: [0; CODES.len()],
    };
    let mut i = 0;
    while i < codes.ranges.len() {
        let bits = PREFIX_BITS + 1 + i as u32;
        range.first = range.end;
        let mut symbol = 0;
        let mut count = 0;
        while symbol < CODES.len() {
            let (code, len) = CODES[symbol];
            if len as u32 == bits {
                if count == 0 {
                    range.first = code << (32 - bits);
                }
                codes.symbols[range.symbols as usize + count] = symbol as u8;
                count += 1;
                range.end = (code + 1) << (32 - bits);
            }
            symbol += 1;
        }
        codes.ranges[i] = range;
        range.symbols += count as u8;
        i += 1;
    }
    codes
}

/// The length of a code that is longer than [`PREFIX_BITS`], and its symbol.
#[inline(always)]
fn long_symbol(window: u64) -> Result<(u8, u8)> {
    match find_long_code(window) {
        (0, _) => Err(Error::Invalid),
        long => Ok(long),
    }
}

/// The length of the code and its symbol, apart, so that the next code does not wait for the symbol. No length: EOS.
#[inline(never)]
fn find_long_code(window: u64) -> (u8, u8) {
    let code = (window >> 32) as u32;
    for (range, bits) in LONG_CODES.ranges.iter().zip(PREFIX_BITS as u8 + 1..) {
        if code < range.end {
            let nth = code.wrapping_sub(range.first) >> (32 - bits);
            let symbol = LONG_CODES
                .symbols
                .get(usize::from(range.symbols) + nth as usize);
            return (bits, symbol.copied().unwrap_or_default());
        }
    }
    (0, 0)
}

/// Appends what `src` decodes to, at most `max_len` bytes.
pub(crate) fn decode(src: &[u8], out: &mut Vec<u8>, max_len: usize) -> Result<()> {
    let start = out.len();
    // The shortest code has 5 bits.
    let max_symbols = (src.len().saturating_mul(8) / 5).min(max_len.saturating_add(1));
    out.resize(start + max_symbols + SPARE_OUT, 0);
    let mut decoder = Decoder {
        src,
        bit_pos: 0,
        out: out.get_mut(start..).unwrap_or_default(),
        written: 0,
        kernel_credit: if has_hpack_huffman_kernel() { 0 } else { -1 },
    };
    let result = decoder
        .decode_full_windows()
        .and_then(|()| decoder.decode_tail());
    let written = decoder.written;
    // Whatever comes after that many symbols.
    if written > max_len {
        return Err(Error::TooLarge);
    }
    result?;
    out.truncate(start + written);
    Ok(())
}

/// The SIMD kernel is C++, which this crate's own tests are not linked with. This one does what that one may do.
#[cfg(test)]
#[allow(clippy::indexing_slicing)]
pub(crate) mod test_kernel {
    use super::{Decoder, SPARE_OUT, code};

    thread_local! {
        pub(crate) static ENABLED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    }

    pub(super) fn has_hpack_huffman_kernel() -> bool {
        ENABLED.get()
    }

    pub(super) fn hpack_huffman_decode_short(
        src: &[u8],
        mut bit_pos: usize,
        out: &mut [u8],
    ) -> (usize, usize) {
        let bit = |i: usize| {
            src.get(i / 8)
                .map_or(1, |byte| u64::from(byte >> (7 - i % 8) & 1))
        };
        let mut written = 0;
        // It may stop anywhere, also where it started.
        for _ in 0..(bit_pos * 7 + src.len()) % 29 {
            let window = (0..16).fold(0, |window, i| window << 1 | bit(bit_pos + i)) << 48;
            let symbol = Decoder::first_symbol(window);
            let len = usize::from(code(symbol).1);
            if window >> (64 - 7) == 0x7f || bit_pos + len > src.len() * 8 {
                break;
            }
            let Some(block) = out.get_mut(written..written + SPARE_OUT) else {
                break;
            };
            block.fill(0xaa);
            block[0] = symbol;
            written += 1;
            bit_pos += len;
        }
        (bit_pos, written)
    }
}
