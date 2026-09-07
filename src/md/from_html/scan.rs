//! Short-range byte scans.
//!
//! `bun_core::strings::index_of_any` is a highway kernel: unbeatable over
//! distance, but every call pays for dynamic dispatch, broadcasting the set
//! into vector registers and a first wide load — some fifty cycles before it
//! has looked at anything. The HTML tokenizer issues one such scan per tag,
//! per attribute value and per text run (60–90k per MB of markup), and on
//! real pages most of them end within a few dozen bytes: the closing quote,
//! the `<` of the next tag. At that range the fixed cost *is* the cost, and
//! it was the single largest line in the conversion's profile.
//!
//! So these helpers examine the first [`PROBE`] bytes inline, sixteen at a
//! time with portable SIMD (baseline SSE2 / NEON, no dispatch), and hand only
//! the scans that get past that to the kernel.

use core::simd::cmp::SimdPartialEq;
use core::simd::u8x16;

use bun_core::strings;

const LANES: usize = 16;

/// How far to look before calling the SIMD kernel.
const PROBE: usize = 64;

/// Below this the kernel's own scalar prologue would end up doing the work a
/// byte at a time; such leftovers are finished here instead.
const KERNEL_MIN: usize = 16;

/// How many leading bytes to examine inline: the probe, or everything if
/// what would be left for the kernel is too little to be worth the call.
#[inline(always)]
fn inline_len(len: usize) -> usize {
    if len >= PROBE + KERNEL_MIN {
        PROBE
    } else {
        len
    }
}

/// Bit *i* set iff lane *i* of `v` is one of `set`.
#[inline(always)]
fn any_of<const N: usize>(v: u8x16, set: &[u8; N]) -> u64 {
    let mut m = v.simd_eq(u8x16::splat(set[0]));
    for &c in &set[1..] {
        m |= v.simd_eq(u8x16::splat(c));
    }
    m.to_bitmask()
}

/// The `< LANES` bytes at `hay[at..end]` as a vector padded with zeros, and
/// the mask of lanes that are real.
#[inline(always)]
fn tail(hay: &[u8], at: usize, end: usize) -> (u8x16, u64) {
    debug_assert!(end - at < LANES);
    (
        u8x16::load_or_default(&hay[at..end]),
        (1u64 << (end - at)) - 1,
    )
}

/// Index of the first byte of `hay` that is in `set`.
#[inline(always)]
pub(crate) fn find_any<const N: usize>(hay: &[u8], set: &[u8; N]) -> Option<usize> {
    let n = inline_len(hay.len());
    let mut i = 0;
    while i + LANES <= n {
        let bits = any_of(u8x16::from_slice(&hay[i..i + LANES]), set);
        if bits != 0 {
            return Some(i + bits.trailing_zeros() as usize);
        }
        i += LANES;
    }
    if i < n {
        let (v, live) = tail(hay, i, n);
        let bits = any_of(v, set) & live;
        if bits != 0 {
            return Some(i + bits.trailing_zeros() as usize);
        }
    }
    if n == hay.len() {
        return None;
    }
    strings::index_of_any(&hay[n..], set).map(|p| p + n)
}

/// Index of the first `c` in `hay`.
#[inline(always)]
pub(crate) fn find_byte(hay: &[u8], c: u8) -> Option<usize> {
    find_any(hay, &[c])
}

/// The first byte of `text` that whitespace collapsing has to rewrite: a
/// tab, CR or LF (they become spaces), or the second space of a run (it is
/// dropped). `None` means the text is already collapsed.
#[inline]
pub(crate) fn first_uncollapsed(text: &[u8]) -> Option<usize> {
    let n = inline_len(text.len());
    let mut i = 0;
    // Bit 0 set iff the byte before this chunk was a space.
    let mut carry = 0u64;
    let step = |v: u8x16, carry: u64| -> (u64, u64) {
        let spaces = v.simd_eq(u8x16::splat(b' ')).to_bitmask();
        let second_space = spaces & ((spaces << 1) | carry);
        let hits = any_of(v, b"\t\n\r") | second_space;
        (hits, (spaces >> (LANES - 1)) & 1)
    };
    while i + LANES <= n {
        let (hits, c) = step(u8x16::from_slice(&text[i..i + LANES]), carry);
        if hits != 0 {
            return Some(i + hits.trailing_zeros() as usize);
        }
        carry = c;
        i += LANES;
    }
    if i < n {
        let (v, live) = tail(text, i, n);
        let (hits, _) = step(v, carry);
        let hits = hits & live;
        if hits != 0 {
            return Some(i + hits.trailing_zeros() as usize);
        }
    }
    if n == text.len() {
        return None;
    }
    // Long text: the kernels take it from here. A space pair may straddle
    // the boundary, so the pair search starts one byte early.
    let special = strings::index_of_any(&text[n..], b"\t\n\r").map(|p| p + n);
    let pair = strings::index_of(&text[n - 1..], b"  ").map(|p| p + n);
    match (special, pair) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    }
}

#[cfg(all(test, miri))]
mod tests {
    use super::*;

    fn reference_any(hay: &[u8], set: &[u8]) -> Option<usize> {
        hay.iter().position(|b| set.contains(b))
    }

    fn reference_uncollapsed(t: &[u8]) -> Option<usize> {
        (0..t.len()).find(|&i| {
            matches!(t[i], b'\t' | b'\n' | b'\r') || (t[i] == b' ' && i > 0 && t[i - 1] == b' ')
        })
    }

    #[test]
    fn space_pair_across_the_probe_boundary() {
        // The inline probe ends at 64; a pair at 63–64 is the kernel's find.
        let mut t = vec![b'a'; 96];
        t[63] = b' ';
        t[64] = b' ';
        assert_eq!(first_uncollapsed(&t), Some(64));
        t[64] = b'a';
        t[70] = b'\n';
        assert_eq!(first_uncollapsed(&t), Some(70));
        assert_eq!(find_any(&t, b"\n\t"), Some(70));
        assert_eq!(find_byte(&t[..70], b'\n'), None);
    }

    #[test]
    fn matches_scalar_definitions() {
        let alphabet = b" \t\n\rab<&\0\x01\x7f\x80\x81\xfe\xff\"'";
        let mut seed: u64 = 0x243F_6A88_85A3_08D3;
        let mut next = move || {
            seed ^= seed << 13;
            seed ^= seed >> 7;
            seed ^= seed << 17;
            seed
        };
        let mut buf = Vec::new();
        for _ in 0..2000 {
            buf.clear();
            let len = (next() % 100) as usize;
            // Mostly spaces and letters so pairs and long clean runs occur.
            for _ in 0..len {
                let r = next();
                buf.push(if r % 3 == 0 {
                    alphabet[(r / 3 % alphabet.len() as u64) as usize]
                } else {
                    b"  etaoin"[(r / 3 % 8) as usize]
                });
            }
            assert_eq!(
                find_any(&buf, b"<&\r\0"),
                reference_any(&buf, b"<&\r\0"),
                "{buf:?}"
            );
            assert_eq!(
                find_any(&buf, b"\t\n\x0C \r>&\0"),
                reference_any(&buf, b"\t\n\x0C \r>&\0")
            );
            assert_eq!(find_byte(&buf, b'<'), reference_any(&buf, b"<"), "{buf:?}");
            assert_eq!(
                find_byte(&buf, 0x80),
                reference_any(&buf, b"\x80"),
                "{buf:?}"
            );
            assert_eq!(
                first_uncollapsed(&buf),
                reference_uncollapsed(&buf),
                "{buf:?}"
            );
        }
    }
}
