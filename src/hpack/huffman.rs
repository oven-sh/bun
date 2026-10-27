//! The Huffman code for string literals (§5.2, Appendix B).

use crate::{Error, Result};

#[cfg(not(test))]
use bun_highway::{has_hpack_huffman_kernel, hpack_huffman_decode_short};

/// The SIMD kernel is C++, which this crate's own tests are not linked with.
#[cfg(test)]
fn has_hpack_huffman_kernel() -> bool {
    false
}

#[cfg(test)]
fn hpack_huffman_decode_short(_: &[u8], bit_pos: usize, _: &mut [u8]) -> (usize, usize) {
    (bit_pos, 0)
}

const EOS: usize = 256;

/// `(code, length in bits)` of each byte, then of EOS.
#[rustfmt::skip]
const CODES: [(u32, u8); 257] = [
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
    (0x3fffffff, 30),
];

fn code(byte: u8) -> (u32, u8) {
    CODES.get(usize::from(byte)).copied().unwrap_or_default()
}

pub(crate) fn encoded_len(src: &[u8]) -> usize {
    let bits: usize = src.iter().map(|&byte| usize::from(code(byte).1)).sum();
    bits.div_ceil(8)
}

struct Writer<'a> {
    /// The low `pending` bits are not written yet: under 8 between calls.
    bits: u64,
    pending: u32,
    out: &'a mut Vec<u8>,
}

impl Writer<'_> {
    /// `len` is at most 56.
    #[inline(always)]
    fn put(&mut self, (code, len): (u64, u32)) {
        self.bits = (self.bits << len) | code;
        self.pending += len;
        // All of them are written. Those that do not fill a byte yet are written again next time.
        let whole = self.out.len() + (self.pending / 8) as usize;
        let bytes = (self.bits << (64 - self.pending)).to_be_bytes();
        self.out.extend_from_slice(&bytes);
        self.out.truncate(whole);
        self.pending %= 8;
    }
}

/// Appends the code of `src`. With `give_up`, not if at some point it is longer than what it stands for.
pub(crate) fn encode(src: &[u8], out: &mut Vec<u8>, give_up: bool) -> bool {
    let start = out.len();
    let mut writer = Writer {
        bits: 0,
        pending: 0,
        out,
    };
    let code = |byte| {
        let (code, len) = code(byte);
        (u64::from(code), u32::from(len))
    };
    let (groups, rest) = src.as_chunks::<4>();
    for (i, group) in groups.iter().enumerate() {
        let [a, b, c, d] = group.map(code);
        let len = a.1 + b.1 + c.1 + d.1;
        if len <= 56 {
            // Put together as two pairs, neither of which waits for the other.
            let (ab, cd) = ((a.0 << b.1) | b.0, (c.0 << d.1) | d.0);
            writer.put(((ab << (c.1 + d.1)) | cd, len));
        } else {
            for code in [a, b, c, d] {
                writer.put(code);
            }
        }
        if give_up && writer.out.len() - start > (i + 1) * 4 {
            writer.out.truncate(start);
            return false;
        }
    }
    for &byte in rest {
        writer.put(code(byte));
    }
    if writer.pending > 0 {
        // The last byte is filled up with the start of EOS, which is all ones.
        let padding = 8 - writer.pending;
        writer.put(((1 << padding) - 1, padding));
    }
    if give_up && out.len() - start > src.len() {
        out.truncate(start);
        return false;
    }
    true
}

/// The code has 257 leaves, so its tree has 256 inner nodes and a node fits a `u8`.
const NODES: usize = 256;
/// Among the children of a node, values from here on are leaves: `LEAF + symbol`.
const LEAF: u16 = NODES as u16;

/// The code tree: where a 0 and a 1 lead from each inner node. Node 0 is the root.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_children() -> [[u16; 2]; NODES] {
    // No node has the root as a child, so 0 also means "none yet".
    let mut children = [[0u16; 2]; NODES];
    let mut nodes = 1;
    let mut symbol = 0;
    while symbol <= EOS {
        let (code, len) = CODES[symbol];
        let mut node = 0;
        let mut bit = len;
        while bit > 0 {
            bit -= 1;
            let side = ((code >> bit) & 1) as usize;
            if bit == 0 {
                children[node][side] = LEAF + symbol as u16;
            } else {
                if children[node][side] == 0 {
                    children[node][side] = nodes;
                    nodes += 1;
                }
                node = children[node][side] as usize;
            }
        }
        symbol += 1;
    }
    children
}

/// Most header text has codes of 5 to 7 bits, so this is two symbols per lookup.
const PREFIX_BITS: u32 = 13;

/// What the next [`PREFIX_BITS`] bits of the input start with.
#[derive(Clone, Copy)]
struct Prefix {
    /// One or two whole symbols, if that many fit.
    symbols: [u8; 2],
    /// How many symbols.
    count: u8,
    /// The length of their codes together.
    bits: u8,
}

impl Prefix {
    const NONE: Self = Self {
        symbols: [0; 2],
        count: 0,
        bits: 0,
    };
}

static PREFIXES: [Prefix; 1 << PREFIX_BITS] = build_prefixes();

#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_prefixes() -> [Prefix; 1 << PREFIX_BITS] {
    let children = build_children();
    let mut prefixes = [Prefix::NONE; 1 << PREFIX_BITS];
    let mut input = 0;
    while input < prefixes.len() {
        let mut prefix = Prefix::NONE;
        let mut node = 0;
        let mut bit = PREFIX_BITS;
        while bit > 0 && prefix.count < 2 {
            bit -= 1;
            let child = children[node][(input >> bit) & 1];
            if child < LEAF {
                node = child as usize;
            } else {
                // Not EOS, which is longer than `PREFIX_BITS`.
                prefix.symbols[prefix.count as usize] = (child - LEAF) as u8;
                prefix.count += 1;
                prefix.bits = (PREFIX_BITS - bit) as u8;
                node = 0;
            }
        }
        prefixes[input] = prefix;
        input += 1;
    }
    prefixes
}

/// How many lookups the 57 bits of a window are good for.
const STEPS: u32 = 57 / PREFIX_BITS;

/// After how many of them the window still has the 30 bits of the longest code.
const STEPS_BEFORE_LONG_SYMBOL: u32 = (57 - 30) / PREFIX_BITS;

/// What [`Decoder::out`] has beyond what may come out, so that symbols can be written in groups.
const SPARE_OUT: usize = bun_highway::HPACK_HUFFMAN_SPARE_OUT;

/// Under this many bits of input, the SIMD kernel is no faster.
const KERNEL_MIN_BITS: usize = 40;

/// A call of the SIMD kernel pays off from this many symbols on.
const KERNEL_MIN_SYMBOLS: isize = 12;

struct Decoder<'a> {
    src: &'a [u8],
    /// How many bits of `src` are decoded.
    pos: usize,
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
        if self.kernel_credit < 0 || window >> 57 == 0x7f {
            return false;
        }
        let out = self.out.get_mut(self.written..).unwrap_or_default();
        let (pos, written) = hpack_huffman_decode_short(self.src, self.pos, out);
        self.pos = pos;
        self.written += written;
        self.kernel_credit += written as isize - KERNEL_MIN_SYMBOLS;
        written > 0
    }

    #[inline(always)]
    fn prefix(window: u64) -> Prefix {
        let index = (window >> (64 - PREFIX_BITS)) as usize;
        PREFIXES.get(index).copied().unwrap_or(Prefix::NONE)
    }

    #[inline(always)]
    fn write(&mut self, prefix: Prefix) -> Result<()> {
        self.out
            .get_mut(self.written..self.written + 2)
            .ok_or(Error::TooLarge)?
            .copy_from_slice(&prefix.symbols);
        self.written += usize::from(prefix.count);
        self.pos += usize::from(prefix.bits);
        Ok(())
    }

    /// All but the last 7 bytes or less of `src`, if not all.
    #[inline(always)]
    fn decode_most(&mut self) -> Result<()> {
        while let Some(bytes) = self.src.get(self.pos / 8..).and_then(<[u8]>::first_chunk) {
            // 57 bits or more, from the top.
            let mut window = u64::from_be_bytes(*bytes) << (self.pos % 8);
            if self.run_kernel(window) {
                continue;
            }
            for step in 0..STEPS {
                let prefix = Self::prefix(window);
                if prefix.count == 0 {
                    if step <= STEPS_BEFORE_LONG_SYMBOL {
                        self.write(long_symbol(window)?)?;
                    }
                    break;
                }
                self.write(prefix)?;
                window <<= prefix.bits;
            }
        }
        Ok(())
    }

    /// The last 7 bytes or less of `src`.
    #[inline(always)]
    fn decode_rest(&mut self) -> Result<()> {
        let end = self.src.len() * 8;
        let last = match self.src.last_chunk() {
            Some(bytes) => u64::from_be_bytes(*bytes),
            None => self
                .src
                .iter()
                .fold(0, |last, &byte| last << 8 | u64::from(byte)),
        };
        let left = end - self.pos;
        if left >= KERNEL_MIN_BITS {
            self.run_kernel(last << (64 - left));
        }
        // All that is left, from the top, then ones, like the padding.
        let mut window = (!last)
            .checked_shl((64 - (end - self.pos)) as u32)
            .map_or(u64::MAX, |rest| !rest);
        // What is left at the end is padding: under 8 bits, all ones (the start of EOS).
        while window != u64::MAX {
            let mut prefix = Self::prefix(window);
            if prefix.count == 0 {
                prefix = long_symbol(window)?;
            }
            if self.pos + usize::from(prefix.bits) > end {
                // The first of two may still be whole, and counts towards the length.
                prefix.count = 1;
                prefix.bits = code(prefix.symbols[0]).1;
                if self.pos + usize::from(prefix.bits) > end {
                    return Err(Error::Invalid);
                }
            }
            self.write(prefix)?;
            window = !(!window << prefix.bits);
        }
        if end - self.pos > 7 {
            return Err(Error::Invalid);
        }
        Ok(())
    }
}

/// The codes of one length. The code is canonical: they count up, and go on in the next length.
#[derive(Clone, Copy)]
struct Length {
    /// The first of them and what follows the last, both from the top of 32 bits.
    first: u32,
    end: u32,
    /// Where in [`LongCodes::symbols`] theirs start.
    symbols: u8,
}

/// The codes that are longer than [`PREFIX_BITS`], but for EOS.
struct LongCodes {
    lengths: [Length; (30 - PREFIX_BITS) as usize],
    /// In the order of the codes.
    symbols: [u8; EOS],
}

static LONG_CODES: LongCodes = build_long_codes();

#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_long_codes() -> LongCodes {
    let mut length = Length {
        first: 0,
        end: 0,
        symbols: 0,
    };
    let mut codes = LongCodes {
        lengths: [length; (30 - PREFIX_BITS) as usize],
        symbols: [0; EOS],
    };
    let mut i = 0;
    while i < codes.lengths.len() {
        let bits = PREFIX_BITS + 1 + i as u32;
        length.first = length.end;
        let mut symbol = 0;
        let mut count = 0;
        while symbol < EOS {
            let (code, len) = CODES[symbol];
            if len as u32 == bits {
                if count == 0 {
                    length.first = code << (32 - bits);
                }
                codes.symbols[length.symbols as usize + count] = symbol as u8;
                count += 1;
                length.end = (code + 1) << (32 - bits);
            }
            symbol += 1;
        }
        codes.lengths[i] = length;
        length.symbols += count as u8;
        i += 1;
    }
    codes
}

/// A symbol whose code is longer than [`PREFIX_BITS`].
#[cold]
fn long_symbol(window: u64) -> Result<Prefix> {
    let code = (window >> 32) as u32;
    for (length, bits) in LONG_CODES.lengths.iter().zip(PREFIX_BITS as u8 + 1..) {
        if code < length.end {
            let nth = code.checked_sub(length.first).ok_or(Error::Invalid)? >> (32 - bits);
            let symbol = LONG_CODES
                .symbols
                .get(usize::from(length.symbols) + nth as usize);
            return Ok(Prefix {
                symbols: [*symbol.ok_or(Error::Invalid)?, 0],
                count: 1,
                bits,
            });
        }
    }
    // It is a decoding error to find EOS in the input.
    Err(Error::Invalid)
}

/// Appends what `src` decodes to, at most `max_len` bytes.
pub(crate) fn decode(src: &[u8], out: &mut Vec<u8>, max_len: usize) -> Result<()> {
    let start = out.len();
    // The shortest code has 5 bits.
    let most = (src.len().saturating_mul(8) / 5).min(max_len.saturating_add(1));
    out.resize(start + most + SPARE_OUT, 0);
    let mut decoder = Decoder {
        src,
        pos: 0,
        out: out.get_mut(start..).unwrap_or_default(),
        written: 0,
        kernel_credit: if has_hpack_huffman_kernel() { 0 } else { -1 },
    };
    let result = decoder.decode_most().and_then(|()| decoder.decode_rest());
    let written = decoder.written;
    // Whatever comes after that many symbols.
    if written > max_len {
        return Err(Error::TooLarge);
    }
    result?;
    out.truncate(start + written);
    Ok(())
}
