//! Short-range byte scans.
//!
//! `bun_core::strings::index_of_any` is a highway kernel: unbeatable over
//! distance, but every call pays for dispatch, broadcasting the set into
//! vector registers and a first 64-byte load — roughly fifty cycles before
//! it has looked at anything. The converter issues one such scan per text
//! node several times over (entity check, whitespace collapse, Markdown
//! escaping — tens of thousands per MB of markup), and on real pages most
//! of them end, or run out of input, within sixteen bytes. At that range the
//! fixed cost *is* the cost.
//!
//! So these helpers test the first sixteen bytes inline — eight at a time
//! with the classic SWAR zero-byte trick on plain `u64`s, no per-byte
//! branches and no vector code of our own — and hand only the scans that
//! get past that to the highway kernel.

use bun_core::strings;

/// How far to look before calling the SIMD kernel.
const PROBE: usize = 16;

/// Below this the kernel's own scalar prologue would end up doing the work,
/// a byte at a time; such haystacks are finished here instead.
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

const LO: u64 = 0x0101_0101_0101_0101;
const HI: u64 = 0x8080_8080_8080_8080;

/// A word with the high bit of byte *i* set iff byte *i* of `w` is `c` —
/// exactly for the lowest such byte, which is all `trailing_zeros` needs
/// (higher bytes may report false positives after a borrow, the usual
/// caveat of this formulation, and are never consulted).
#[inline(always)]
fn eq_mask(w: u64, c: u8) -> u64 {
    let x = w ^ LO.wrapping_mul(u64::from(c));
    x.wrapping_sub(LO) & !x & HI
}

#[inline(always)]
fn load(hay: &[u8], at: usize) -> u64 {
    let mut b = [0u8; 8];
    b.copy_from_slice(&hay[at..at + 8]);
    u64::from_le_bytes(b)
}

/// The last few (< 8) bytes of a probe as one word.
struct Tail {
    word: u64,
    /// Result bits that belong to the bytes not yet examined.
    valid: u64,
    /// Index in `hay` of the word's byte 0.
    base: usize,
}

/// The final `n - i < 8` bytes as one word. With eight bytes available the
/// word is an overlapping load ending at `n` (its low bytes were already
/// examined and are masked off); otherwise the few bytes there are get
/// assembled.
#[inline(always)]
fn load_tail(hay: &[u8], i: usize, n: usize) -> Tail {
    debug_assert!(i < n && n - i < 8 && n <= hay.len());
    if n >= 8 {
        let fresh = n - i; // 1..=7 new bytes at the top of the word
        Tail {
            word: load(hay, n - 8),
            valid: !((1u64 << (8 * (8 - fresh))) - 1),
            base: n - 8,
        }
    } else {
        let mut word = 0u64;
        for (k, &b) in hay[i..n].iter().enumerate() {
            word |= u64::from(b) << (8 * k);
        }
        Tail {
            word,
            valid: (1u64 << (8 * (n - i))) - 1,
            base: i,
        }
    }
}

/// Index of the first byte of `hay` that is in `set`.
#[inline(always)]
pub(crate) fn find_any<const N: usize>(hay: &[u8], set: &[u8; N]) -> Option<usize> {
    let n = inline_len(hay.len());
    let mut i = 0;
    while i + 8 <= n {
        let w = load(hay, i);
        let mut m = 0u64;
        for &c in set {
            m |= eq_mask(w, c);
        }
        if m != 0 {
            return Some(i + (m.trailing_zeros() / 8) as usize);
        }
        i += 8;
    }
    if i < n {
        let t = load_tail(hay, i, n);
        let mut m = 0u64;
        for &c in set {
            m |= eq_mask(t.word, c);
        }
        m &= t.valid;
        if m != 0 {
            return Some(t.base + (m.trailing_zeros() / 8) as usize);
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
    let n = inline_len(hay.len());
    let mut i = 0;
    while i + 8 <= n {
        let m = eq_mask(load(hay, i), c);
        if m != 0 {
            return Some(i + (m.trailing_zeros() / 8) as usize);
        }
        i += 8;
    }
    if i < n {
        let t = load_tail(hay, i, n);
        let m = eq_mask(t.word, c) & t.valid;
        if m != 0 {
            return Some(t.base + (m.trailing_zeros() / 8) as usize);
        }
    }
    if n == hay.len() {
        return None;
    }
    strings::index_of_char_usize(&hay[n..], c).map(|p| p + n)
}

/// A word with the high bit of byte *i* set iff byte *i* of `w` is `c`,
/// exactly, for every byte (no false positives; a few more operations than
/// [`eq_mask`]).
#[inline(always)]
fn eq_mask_exact(w: u64, c: u8) -> u64 {
    const LO7: u64 = 0x7f7f_7f7f_7f7f_7f7f;
    let x = w ^ LO.wrapping_mul(u64::from(c));
    !((x & LO7).wrapping_add(LO7) | x) & HI
}

/// The first byte of `text` that whitespace collapsing has to rewrite: a
/// tab, CR or LF (they become spaces), or the second space of a run (it is
/// dropped). `None` means the text is already collapsed.
#[inline]
pub(crate) fn first_uncollapsed(text: &[u8]) -> Option<usize> {
    let n = inline_len(text.len());
    let mut i = 0;
    // High bit of the previous word's last byte, if that byte was a space,
    // moved to where byte 0 of this word looks for its left neighbour.
    let mut carry = 0u64;
    while i + 8 <= n {
        let w = load(text, i);
        let spaces = eq_mask_exact(w, b' ');
        let second_space = spaces & ((spaces << 8) | carry);
        let m = eq_mask(w, b'\t') | eq_mask(w, b'\n') | eq_mask(w, b'\r') | second_space;
        if m != 0 {
            return Some(i + (m.trailing_zeros() / 8) as usize);
        }
        carry = spaces >> 56;
        i += 8;
    }
    if i < n {
        let t = load_tail(text, i, n);
        let spaces = eq_mask_exact(t.word, b' ');
        // For an overlapping word the left neighbours are inside the word
        // itself; only a word assembled at `i` needs the carried bit.
        let carry = if t.base == i { carry } else { 0 };
        let second_space = spaces & ((spaces << 8) | carry);
        let m = (eq_mask(t.word, b'\t')
            | eq_mask(t.word, b'\n')
            | eq_mask(t.word, b'\r')
            | second_space)
            & t.valid;
        if m != 0 {
            return Some(t.base + (m.trailing_zeros() / 8) as usize);
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
        // A pair straddling the end of the inline probe is the kernel's find.
        let mut t = vec![b'a'; 96];
        t[PROBE - 1] = b' ';
        t[PROBE] = b' ';
        assert_eq!(first_uncollapsed(&t), Some(PROBE));
        t[PROBE] = b'a';
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
