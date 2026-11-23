//! Searches and counts.
//!
//! With one target only there is no dispatch, and a kernel could be inlined into thousands of callers.

use bun_simd::prelude::*;

/// From this length on a text is more likely the rest of a file than a name, a path or a line.
const LONG: usize = 160;

/// In the first 96 bytes, among which a cache line starts after the first 32.
#[simd]
fn position_up_to_line(
    text: &[u8],
    matches: &impl Fn(u8xN<S>) -> MaskN<u8, S>,
    in_half: &impl Fn(u8x32<S>) -> u64,
) -> Option<usize> {
    // Half a vector is less likely to be in two cache lines.
    let found = in_half(u8x32::load(text)) as u32;
    if found != 0 {
        return Some(found.trailing_zeros() as usize);
    }
    Some(32 + matches(u8xN::load(&text[32..])).first_set()?)
}

/// A bit for each byte of two vectors of 32, if any is set.
#[simd]
fn bits_of_two(two: &[u8], matches: &impl Fn(u8xN<S>) -> MaskN<u8, S>) -> Option<u64> {
    let (a, b) = (u8xN::load(two), u8xN::load(&two[32..]));
    if (matches(a) | matches(b)).none() {
        return None;
    }
    Some(matches(a).to_bitmask() | matches(b).to_bitmask() << 32)
}

/// One vector at a time, for a match that is rarely far away. It takes less than half the code of [`position`].
#[simd]
fn near_position(
    text: &[u8],
    matches: impl Fn(u8xN<S>) -> MaskN<u8, S>,
    in_half: impl Fn(u8x32<S>) -> u64,
) -> Option<usize> {
    if text.len() < u8xN::LANES {
        return over(text).position(matches);
    }
    let (mut at, last) = (0, text.len() - u8xN::LANES);
    if u8xN::LANES == 64 && text.len() >= LONG {
        if let Some(at) = position_up_to_line(text, &matches, &in_half) {
            return Some(at);
        }
        at = 96 - (text.as_ptr().addr() + 32) % 64;
    }
    // A branch of its own is predicted better.
    if u8xN::LANES < 64 && !S::IS_RARE {
        if let Some(lane) = matches(u8xN::load(text)).first_set() {
            return Some(lane);
        }
        at = u8xN::LANES;
    }
    while at < last {
        if let Some(lane) = matches(u8xN::load_at(text, at)).first_set() {
            return Some(at + lane);
        }
        at += u8xN::LANES;
    }
    Some(last + matches(u8xN::load_last(text)).first_set()?)
}

/// On AVX2, a loop that tests the mask by itself is faster, unless a match is likely.
#[simd]
fn last_set(found: MaskN<u8, S>) -> Option<usize> {
    if u8xN::LANES != 32 {
        found.last_set()
    } else if found.any() {
        Some(found.last_set_relaxed())
    } else {
        None
    }
}

#[simd]
fn near_rposition(text: &[u8], matches: impl Fn(u8xN<S>) -> MaskN<u8, S>) -> Option<usize> {
    if text.len() < u8xN::LANES {
        return over(text).rposition(matches);
    }
    let mut rest = text;
    while rest.len() > u8xN::LANES {
        if let Some(lane) = last_set(matches(u8xN::load_last(rest))) {
            return Some(rest.len() - u8xN::LANES + lane);
        }
        rest = &rest[..rest.len() - u8xN::LANES];
    }
    matches(u8xN::load(text)).last_set()
}

/// Few CPUs run the code for SSE4, so it is small.
#[simd]
const IS_RARE: bool = cfg!(target_arch = "x86_64") && u8xN::LANES == 16;

/// In a long text most matches are in the same line. `over` soon tests several vectors at once, which finds those later.
/// Lengths are hard to predict, so the first vector comes before the test for `LONG`.
#[simd]
fn position(text: &[u8], matches: impl Fn(u8xN<S>) -> MaskN<u8, S>) -> Option<usize> {
    if u8xN::LANES == 64 || text.len() < u8xN::LANES {
        return over(text).position(matches);
    }
    if let Some(lane) = matches(u8xN::load(text)).first_set() {
        return Some(lane);
    }
    if text.len() < LONG {
        return over(text).position(matches);
    }
    unroll!(for i in 1..6 {
        if i * u8xN::LANES < 96
            && let Some(lane) = matches(u8xN::load(&text[i * u8xN::LANES..])).first_set()
        {
            return Some(i * u8xN::LANES + lane);
        }
    });
    let (mut seen, mut rest) = (96, &text[96..]);
    if u8xN::LANES == 32 && text.len() >= 2 * LONG {
        unroll!(for i in 0..3 {
            if let Some(bits) = bits_of_two(&text[96 + 64 * i..], &matches) {
                return Some(96 + 64 * i + bits.trailing_zeros() as usize);
            }
        });
        (seen, rest) = (288, &text[288..]);
    }
    assert!(rest.len() >= u8xN::LANES);
    Some(seen + over(rest).position(matches)?)
}

#[simd]
fn rposition(text: &[u8], matches: impl Fn(u8xN<S>) -> MaskN<u8, S>) -> Option<usize> {
    if u8xN::LANES == 64 || text.len() < u8xN::LANES {
        return over(text).rposition(matches);
    }
    if let Some(lane) = matches(u8xN::load_last(text)).last_set() {
        return Some(text.len() - u8xN::LANES + lane);
    }
    let mut rest = text;
    if text.len() >= LONG {
        rest = &text[..text.len() - u8xN::LANES];
        unroll!(for i in 1..6 {
            if i * u8xN::LANES < 96 {
                if let Some(lane) = last_set(matches(u8xN::load_last(rest))) {
                    return Some(rest.len() - u8xN::LANES + lane);
                }
                rest = &rest[..rest.len() - u8xN::LANES];
            }
        });
        if u8xN::LANES == 32 && text.len() >= 2 * LONG {
            unroll!(for _i in 0..3 {
                let at = rest.len() - 64;
                if let Some(bits) = bits_of_two(&rest[at..], &matches) {
                    return Some((at + 63).wrapping_sub(bits.leading_zeros() as usize));
                }
                rest = &rest[..at];
            });
        }
    }
    over(rest).rposition(matches)
}

/// Looks for a byte `v` for which the expression is true. `near_position` gets it for 32 bytes too, which Zen 4 does in half the time of 64.
#[simd]
macro_rules! find {
    (near_position($text:ident, |$v:ident| $matches:expr)) => {
        near_position(
            $text,
            |$v: u8xN<S>| $matches,
            |$v: u8x32<S>| $matches.to_bitmask(),
        )
    };
    ($find:ident($text:ident, |$v:ident| $matches:expr)) => {
        $find($text, |$v: u8xN<S>| $matches)
    };
}

/// Kernels that look for a byte `v` of `text` for which the expression is true.
#[simd]
macro_rules! searches {
    ($($name:ident($($arg:ident),*) = $find:ident |$v:ident| $matches:expr;)*) => {$(
        #[kernel]
        #[inline(never)]
        pub(crate) fn $name(text: &[u8] $(, $arg: u8)*) -> Option<usize> {
            find!($find(text, |$v| $matches))
        }
    )*};
}

const IN_LINE_COMMENT: ByteSet = ByteSet::new(&[
    b'\n'..=b'\n',
    b'\r'..=b'\r',
    b'#'..=b'#',
    b'@'..=b'@',
    0xe2..=0xe2,
]);

searches! {
    index_of_char(needle) = position |v| v.simd_eq(needle);
    last_index_of_char(needle) = rposition |v| v.simd_eq(needle);
    index_of_not_char(value) = near_position |v| v.simd_ne(value);
    index_of_either(a, b) = position |v| v.simd_eq(a) | v.simd_eq(b);
    last_index_of_either(a, b) = near_rposition |v| v.simd_eq(a) | v.simd_eq(b);
    index_of_one_of_four(a, b, c, d) = near_position |v|
        v.simd_eq(a) | v.simd_eq(b) | (v.simd_eq(c) | v.simd_eq(d));
    last_index_of_one_of_four(a, b, c, d) = near_rposition |v|
        v.simd_eq(a) | v.simd_eq(b) | (v.simd_eq(c) | v.simd_eq(d));
    index_of_interesting_character_in_string_literal(quote) = near_position |v|
        v.simd_eq(quote) | v.simd_eq(b'\\') | !v.within(0x20..=0x7e);
    index_of_interesting_character_in_multiline_comment() = near_position |v|
        (v | b'*' ^ b'\n').simd_eq(b'*') | v.simd_eq(b'\r') | v.simd_eq(0xe2);
    index_of_interesting_character_in_line_comment() = near_position |v| IN_LINE_COMMENT.contains(v);
    index_of_newline_or_non_ascii() = position |v| !v.within(0x20..=0x7f);
    index_of_space_or_newline_or_non_ascii() = near_position |v| !v.within(0x21..=0x7f);
    index_of_newline_or_non_ascii_or_quote() = near_position |v|
        v.simd_eq(b'"') | !v.within(0x20..=0x7f);
    index_of_needs_escape_in_template() = near_position |v|
        v.simd_eq(b'`') | v.simd_eq(b'$') | v.simd_eq(b'\\') | !v.within(0x20..=0x7e);
}

/// Byte `b` is in the set if it is ASCII and `set` has bit `8 * (b & 15) + (b >> 4)`.
#[kernel]
#[inline(never)]
pub(crate) fn index_of_any_ascii(text: &[u8], set: u128) -> Option<usize> {
    if text.len() < u8xN::LANES {
        // Bytes that are not ASCII shift all bits out.
        let first = *text.first()?;
        if u32::from((set >> (8 * (first & 15))) as u8) >> (first >> 4) & 1 != 0 {
            return Some(0);
        }
    }
    let set = ByteClasses {
        high: [1, 2, 4, 8, 16, 32, 64, 128, 0, 0, 0, 0, 0, 0, 0, 0],
        low: set.to_le_bytes(),
    };
    find!(position(text, |v| set.contains(v)))
}

#[kernel]
#[inline(never)]
pub(crate) fn index_of_many(text: &[u8], chars: &[u8]) -> Option<usize> {
    text.first()?;
    // A near match is found sooner than the set is built.
    let (first, mut found) = (u8xN::load_or_default(text), mask8xN::splat(false));
    for &char in chars {
        found |= first.simd_eq(char);
    }
    if let Some(lane) = found.first_set() {
        return (lane < text.len()).then_some(lane);
    }
    let (rest, set) = (text.get(u8xN::LANES..)?, ByteSet::of(chars));
    Some(u8xN::LANES + find!(near_position(rest, |v| set.contains(v)))?)
}

#[kernel]
#[inline(never)]
pub(crate) fn last_index_of_many(text: &[u8], chars: &[u8]) -> Option<usize> {
    let (far, near) = text.split_at(text.len().saturating_sub(128));
    let found = near_rposition(near, |v| {
        let mut found = mask8xN::splat(false);
        for &char in chars {
            found |= v.simd_eq(char);
        }
        found
    });
    if found.is_some() || far.is_empty() {
        return Some(far.len() + found?);
    }
    let set = ByteSet::of(chars);
    near_rposition(far, |v| set.contains(v))
}

#[kernel]
#[inline(never)]
pub(crate) fn count_char(text: &[u8], needle: u8) -> usize {
    over(text).count(|v| v.simd_eq(needle))
}
