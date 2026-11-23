//! Searches and copies that tell ASCII or Latin-1 from the rest.

use super::near::first_near;
use bun_simd::prelude::*;
use core::mem::MaybeUninit;

/// ESC, the C1 introducers, and C1 ST.
#[simd]
fn is_escape<T: Unsigned, W: Width>(v: Simd<T, W, S>) -> MaskOf<T, W, S> {
    // 0x1b and 0x9b differ in one bit, and so do 0x90 and 0x98.
    (v & !T::of::<0x80>()).simd_eq(T::of::<0x1b>())
        | (v & !T::of::<8>()).simd_eq(T::of::<0x90>())
        | (v >> 2).simd_eq(T::of::<{ 0x9c >> 2 }>())
}

/// 0x10 to 0x1f and 0x90 to 0x9f.
#[simd]
fn is_suspect<T: Unsigned, W: Width>(v: Simd<T, W, S>) -> MaskOf<T, W, S> {
    (v & !T::of::<0x8f>()).simd_eq(T::of::<0x10>())
}

/// The first suspect, which is nearly always ESC.
#[kernel]
fn broad<T: Unsigned>(text: &[T], escapes_only: bool) -> usize {
    let at = first_near(text, |v| is_suspect(v));
    match text.get(at).map(|c| c.to_u64()) {
        Some(c) if c & 0x7f != 0x1b && !matches!(c, 0x90 | 0x98 | 0x9c..) && escapes_only => {
            among_others(text, at)
        }
        _ => at,
    }
}

#[kernel]
fn exact<T: Unsigned>(text: &[T]) -> Option<usize> {
    let (vectors, rest) = Simd::<T, B64, S>::over(text).exact();
    for (i, v) in vectors.enumerate() {
        if is_suspect(v).any()
            && let Some(at) = is_escape(v).first_set()
        {
            return Some(i * Simd::<T, B64, S>::LANES + at);
        }
    }
    Some(text.len() - rest.len() + over(rest).position(|v| is_escape(v))?)
}

/// Where there is one of the others, there can be many.
#[cold]
#[inline(never)]
fn among_others<T: Unsigned>(text: &[T], mut seen: usize) -> usize {
    while seen < text.len() {
        let end = text.len().min(seen + 4096);
        if let Some(at) = exact(&text[seen..end]) {
            return seen + at;
        }
        seen = end + broad(&text[end..], false);
    }
    seen
}

/// The length if there is none.
#[inline(always)]
pub(crate) fn index_of_escape_char<T: Unsigned>(text: &[T]) -> usize {
    broad(text, true)
}

/// The length if there is none.
#[kernel]
pub(crate) fn first_non_ascii<T: Unsigned>(text: &[T]) -> usize {
    // Wider registers slow some CPUs down after a pause.
    if Native::<S>::BYTES > 16 && size_of_val(text) <= 16 {
        let other = Simd::<T, B16, S>::load_or_default(text).simd_gt(T::of::<0x7f>());
        return other.first_set().unwrap_or(text.len());
    }
    first_near(text, |v| v.simd_gt(T::of::<0x7f>()))
}

#[simd]
fn is_upper<T: Unsigned>(v: SimdN<T, S>) -> MaskN<T, S> {
    v.within(T::of::<0x41>()..=T::of::<0x5a>())
}

#[kernel]
fn first_upper<T: Unsigned>(text: &[T]) -> usize {
    over(text).position(|v| is_upper(v)).unwrap_or(text.len())
}

#[kernel]
fn lower<T: Unsigned>(from: &[T], to: &mut [MaybeUninit<T>]) {
    over(from).map_into(to, |v| v | is_upper(v).select(T::of::<0x20>(), T::ZERO))
}

/// The names of headers are done sooner than a dispatch. Arm has none.
const X86: bool = cfg!(target_arch = "x86_64");

/// The length if there is none.
#[inline(always)]
pub(crate) fn index_of_first_ascii_upper<T: Unsigned>(text: &[T]) -> usize {
    if X86 && size_of_val(text) > 64 {
        first_upper(text)
    } else {
        first_upper::baseline(text)
    }
}

#[inline(always)]
pub(crate) fn lower_ascii<T: Unsigned>(from: &[T], to: &mut [MaybeUninit<T>]) {
    if X86 && from.len() > 64 {
        lower(from, to)
    } else {
        lower::baseline(from, to)
    }
}

#[kernel]
pub(crate) fn count_printable_ascii16(text: &[u16]) -> usize {
    over(text).count(|v| v.within(0x20..=0x7e))
}

/// What is not in Latin-1 becomes `?`.
#[kernel]
pub(crate) fn narrow_to_latin1(from: &[u16], to: &mut [MaybeUninit<u8>]) {
    over(from).map_into(to, |v| {
        v.simd_gt(0xff).select(u16::from(b'?'), v).cast::<u8>()
    })
}

#[kernel]
fn copy_ascii(from: &[u8], to: &mut [u8]) -> usize {
    let len = from.len().min(to.len());
    let (from, to) = (&from[..len], &mut to[..len]);
    if len < u8xN::LANES {
        let v = u8xN::load_or_default(from);
        let n = len.min(v.cast_signed().is_negative().count_before_first());
        v.store_partial(&mut to[..n]);
        return n;
    }
    // Where there is one, the next is near.
    let v = u8xN::load(from);
    if let Some(n) = v.cast_signed().is_negative().first_set() {
        v.store_partial(&mut to[..n]);
        return n;
    }
    v.store(to);
    let n = u8xN::LANES;
    let (mut rest, mut room) = (&from[n..], &mut to[n..]);
    while rest.len() >= 2 * n && room.len() >= 2 * n {
        let (a, b) = (u8xN::load(rest), u8xN::load(&rest[n..]));
        if (a | b).cast_signed().is_negative().any() {
            break;
        }
        a.store(room);
        b.store(&mut room[n..]);
        (rest, room) = (&rest[2 * n..], &mut room[2 * n..]);
    }
    if rest.len() > n && u8xN::load(rest).cast_signed().is_negative().none() {
        u8xN::load(rest).store(room);
        rest = &rest[n..];
    }
    let start = from.len() - rest.len().max(n);
    let v = u8xN::load(&from[start..]);
    let Some(n) = v.cast_signed().is_negative().first_set() else {
        v.store_last(to);
        return from.len();
    };
    // The first vector is ASCII.
    u8xN::load_last(&from[..start + n]).store_last(&mut to[..start + n]);
    start + n
}

#[kernel]
fn truncate(input: &[u16], output: &mut [u8]) {
    let output = &mut output[..input.len()];
    let n = u8xN::LANES;
    if input.len() < n / 2 {
        return u16xN::load_short(input).cast::<u8>().store_short(output);
    }
    if input.len() < n {
        let ends = u16xN::load(input).wrapping_narrow::<u8>(u16xN::load_last(input));
        let [first, last] = ends.split();
        first.store(output);
        return last.store_last(output);
    }
    let pack = |from: &[u16]| u16xN::load(from).wrapping_narrow::<u8>(u16xN::load(&from[n / 2..]));
    for (from, to) in input.chunks_exact(n).zip(output.chunks_exact_mut(n)) {
        pack(from).store(to);
    }
    pack(&input[input.len() - n..]).store_last(output);
}

/// Copies up to the first byte that is not ASCII, and returns its index. The rest of `to` is not changed.
pub fn copy_ascii_prefix(from: &[u8], to: &mut [u8]) -> usize {
    copy_ascii(from, to)
}

/// The lower byte of each unit. Panics if `to` is too short.
pub fn copy_u16_to_u8(from: &[u16], to: &mut [u8]) {
    if !from.is_empty() {
        truncate(from, to)
    }
}
