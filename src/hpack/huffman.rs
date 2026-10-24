//! The Huffman code for string literals (§5.2, Appendix B).

use crate::{Error, Result};

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

pub(crate) fn encode(src: &[u8], out: &mut Vec<u8>) {
    // The low `pending` bits are not written yet: under 32 here, and a code has at most 30.
    let mut bits: u64 = 0;
    let mut pending: u32 = 0;
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

/// The code has 257 leaves, so its tree has 256 inner nodes and a node fits a `u8`.
const NODES: usize = 256;
/// In [`CHILDREN`], values from here on are leaves: `LEAF + symbol`.
const LEAF: u16 = NODES as u16;

/// The code tree: where a 0 and a 1 lead from each inner node. Node 0 is the root.
static CHILDREN: [[u16; 2]; NODES] = build_children();

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
    /// One or two whole symbols. If not even one fits, `symbols[0]` is the node the bits lead to.
    symbols: [u8; 2],
    /// The length of each symbol's code, 0 for none.
    bits: [u8; 2],
}

static PREFIXES: [Prefix; 1 << PREFIX_BITS] = build_prefixes();

#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
const fn build_prefixes() -> [Prefix; 1 << PREFIX_BITS] {
    let children = build_children();
    let mut prefixes = [Prefix {
        symbols: [0; 2],
        bits: [0; 2],
    }; 1 << PREFIX_BITS];
    let mut input = 0;
    while input < prefixes.len() {
        let mut prefix = Prefix {
            symbols: [0; 2],
            bits: [0; 2],
        };
        let mut found = 0;
        let mut node = 0;
        let mut since_symbol = 0;
        let mut bit = PREFIX_BITS;
        while bit > 0 && found < 2 {
            bit -= 1;
            since_symbol += 1;
            let child = children[node][(input >> bit) & 1];
            if child < LEAF {
                node = child as usize;
            } else {
                // Not EOS, which is longer than `PREFIX_BITS`.
                prefix.symbols[found] = (child - LEAF) as u8;
                prefix.bits[found] = since_symbol;
                found += 1;
                node = 0;
                since_symbol = 0;
            }
        }
        if found == 0 {
            prefix.symbols[0] = node as u8;
        }
        prefixes[input] = prefix;
        input += 1;
    }
    prefixes
}

struct Decoder<'a> {
    /// The low `pending` bits are input that is not decoded yet.
    bits: u64,
    pending: u32,
    /// Two bytes longer than what may come out, so that a step can always write two.
    out: &'a mut [u8],
    written: usize,
}

impl Decoder<'_> {
    /// `Ok(false)` if no whole symbol is pending. `whole_prefix`: the longest code (30 bits) fits.
    #[inline(always)]
    fn step(&mut self, whole_prefix: bool) -> Result<bool> {
        let next = if whole_prefix || self.pending >= PREFIX_BITS {
            self.bits >> (self.pending - PREFIX_BITS)
        } else {
            // Filled up with ones, like the input itself.
            let missing = PREFIX_BITS - self.pending;
            (self.bits << missing) | ((1 << missing) - 1)
        };
        let Some(&prefix) = PREFIXES.get(next as usize & (PREFIXES.len() - 1)) else {
            return Err(Error::Invalid);
        };
        let [first, second] = prefix.bits.map(u32::from);
        if first == 0 {
            return self.long_symbol(prefix.symbols[0]);
        }
        let (count, used) = if whole_prefix || first + second <= self.pending {
            (1 + usize::from(second != 0), first + second)
        } else {
            return Ok(false);
        };
        self.out
            .get_mut(self.written..self.written + 2)
            .ok_or(Error::TooLarge)?
            .copy_from_slice(&prefix.symbols);
        self.written += count;
        self.pending -= used;
        Ok(true)
    }

    /// A symbol whose code is longer than [`PREFIX_BITS`], the first of which lead to `node`.
    #[cold]
    fn long_symbol(&mut self, node: u8) -> Result<bool> {
        let mut node = u16::from(node);
        let Some(mut left) = self.pending.checked_sub(PREFIX_BITS) else {
            return Ok(false);
        };
        while left > 0 {
            left -= 1;
            let side = usize::from(self.bits >> left & 1 != 0);
            node = CHILDREN
                .get(usize::from(node))
                .and_then(|children| children.get(side))
                .copied()
                .ok_or(Error::Invalid)?;
            if node >= LEAF {
                // EOS does not fit a `u8`. It is a decoding error to find it in the input.
                let symbol = u8::try_from(node - LEAF).map_err(|_| Error::Invalid)?;
                *self.out.get_mut(self.written).ok_or(Error::TooLarge)? = symbol;
                self.written += 1;
                self.pending = left;
                return Ok(true);
            }
        }
        Ok(false)
    }
}

/// Appends what `src` decodes to, at most `max_len` bytes.
pub(crate) fn decode(src: &[u8], out: &mut Vec<u8>, max_len: usize) -> Result<()> {
    let start = out.len();
    // The shortest code has 5 bits.
    let most = (src.len().saturating_mul(8) / 5).min(max_len.saturating_add(1));
    out.resize(start + most + 2, 0);
    let mut decoder = Decoder {
        bits: 0,
        pending: 0,
        out: out.get_mut(start..).unwrap_or_default(),
        written: 0,
    };

    let mut rest = src;
    while let Some((chunk, tail)) = rest.split_first_chunk::<4>() {
        // At most 32 bits are pending here.
        decoder.bits = (decoder.bits << 32) | u64::from(u32::from_be_bytes(*chunk));
        decoder.pending += 32;
        rest = tail;
        while decoder.pending > 32 {
            if !decoder.step(true)? {
                return Err(Error::Invalid);
            }
        }
    }
    for &byte in rest {
        decoder.bits = (decoder.bits << 8) | u64::from(byte);
        decoder.pending += 8;
    }
    while decoder.step(false)? {}

    // What is left is padding: under 8 bits, all ones (the start of EOS).
    let (bits, pending, written) = (decoder.bits, decoder.pending, decoder.written);
    if pending > 7 || bits & ((1 << pending) - 1) != (1 << pending) - 1 {
        return Err(Error::Invalid);
    }
    if written > max_len {
        return Err(Error::TooLarge);
    }
    out.truncate(start + written);
    Ok(())
}
