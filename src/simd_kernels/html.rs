//! What `Bun.escapeHTML` replaces: `" & ' < >`.

use super::near::first_near;
use bun_simd::prelude::*;
use core::mem::MaybeUninit;

/// The entries of `table` for the lowest four bits of each unit.
#[simd]
fn by_low_nibble<T: Unsigned, W: Width>(table: &[u8; 16], v: Simd<T, W, S>) -> Simd<T, W, S> {
    let zero_above = if const { size_of::<T>() > 1 } {
        T::of::<0x8000>()
    } else {
        T::ZERO
    };
    let at = (v & T::of::<15>() | zero_above).bitcast::<u8>();
    Simd::<u8, W, S>::repeat(table)
        .in_blocks()
        .lookup_bytes_relaxed(at)
        .bitcast::<T>()
}

/// No two of them have the same lowest four bits.
const ESCAPED: [u8; 16] = *b"\x01\0\"\0\0\0&'\0\0\0\0<\0>\0";

#[simd]
fn is_escaped<T: Unsigned, W: Width>(v: Simd<T, W, S>) -> MaskOf<T, W, S> {
    v.simd_eq(by_low_nibble(&ESCAPED, v))
}

/// The length if there is none.
#[kernel]
pub(crate) fn index_of_escaped<T: Unsigned>(text: &[T]) -> usize {
    first_near(text, |v| is_escaped(v))
}

/// By the lowest four bits.
const EXTRA: [u8; 16] = [0, 0, 5, 0, 0, 0, 4, 5, 0, 0, 0, 0, 3, 0, 3, 0];
/// What is written for each byte. The upper three bits of the last byte are the length.
static WRITTEN: [[u8; 8]; 256] = {
    let (mut all, mut i) = ([*b".......\x20"; 256], 0);
    while i < 256 {
        all[i][0] = i as u8;
        i += 1;
    }
    all[b'"' as usize] = *b"&quot;.\xc0";
    all[b'&' as usize] = *b"&amp;..\xa0";
    all[b'\'' as usize] = *b"&#x27;.\xc0";
    all[b'<' as usize] = *b"&lt;...\x80";
    all[b'>' as usize] = *b"&gt;...\x80";
    all
};

#[kernel]
fn extra_len_of_many<T: Unsigned>(text: &[T]) -> usize {
    let n = SimdN::<T, S>::LANES;
    let extra = |v: SimdN<T, S>| is_escaped(v).select(by_low_nibble(&EXTRA, v), T::ZERO);
    // The upper byte of a wider lane stays zero.
    let total = |sums: SimdN<T, S>| sums.bitcast::<u8>().sum_groups::<u64>();
    let (whole, rest) = text.split_at(text.len() - text.len() % n);
    let mut sum = total(if whole.is_empty() {
        extra(Simd::load_or_default(rest))
    } else {
        MaskN::<T, S>::first_n(n - rest.len()).select(T::ZERO, extra(Simd::load_last(text)))
    });
    for group in whole.chunks(255 / 5 * n) {
        sum += total(
            over(group)
                .exact()
                .0
                .fold(Simd::zero(), |sums, v| sums + extra(v)),
        );
    }
    sum.reduce_sum() as usize
}

/// By how much the text gets longer.
#[inline(always)]
pub(crate) fn extra_len<T: Unsigned>(text: &[T]) -> usize {
    if text.len() >= 8 {
        return extra_len_of_many(text);
    }
    let escaped = text
        .iter()
        .map(|c| c.to_u64())
        .filter(|&c| c == ESCAPED[c as usize & 15].into());
    escaped.map(|c| usize::from(EXTRA[c as usize & 15])).sum()
}

/// What is written for a unit under 256, and how many bytes of that count.
#[simd]
fn entity<T: Unsigned>(c: T) -> (&'static [u8; 8], usize) {
    let entity = &WRITTEN[c.to_u64() as usize & 255];
    (entity, usize::from(entity[7] >> 5))
}

/// It needs no room to spare.
#[simd]
fn push_entity<T: Unsigned>(c: T, out: &mut Output<'_, T>) {
    let ((entity, len), start) = (entity(c), out.len());
    out.push(u8x4::load(entity).cast::<T>());
    out.push_at(u8x4::load_at(entity, len % 4).cast::<T>(), start + len % 4);
}

/// `push(v.first_n(n))`, where the end is often near.
#[simd]
fn push_few<T: Unsigned>(v: Simd<T, B16, S>, n: usize, out: &mut Output<'_, T>) {
    let lanes = Simd::<T, B16, S>::LANES;
    let n = n.min(lanes);
    assert!(n <= out.room());
    if out.room() >= lanes {
        return out.push_with_slack(v.first_n(n));
    }
    let mut rest = out.limit(out.room());
    v.store_partial_at(&mut rest, 0);
    rest.truncate(n);
}

/// For any unit, without a branch. It needs room for 8.
#[simd]
fn push_any<T: Unsigned>(c: T, out: &mut Output<'_, T>) {
    let above = (c.to_u64() as u32).saturating_sub(255);
    let (written, len) = entity(c.to_u64() as u32 - above);
    let units = u8x8::load(written).cast::<u16>() + u32x4::from_array([above, 0, 0, 0]).bitcast();
    out.push_with_slack(units.cast::<T>().first_n(len));
}

/// Adds the first vector of `two`. If it has few entities, what follows each is written again, as a whole vector.
#[simd]
fn escape_first<T: Unsigned, W: Width>(two: &[T], out: &mut Output<'_, T>) {
    let (v, n, mut start) = (
        Simd::<T, W, S>::load(two),
        Simd::<T, W, S>::LANES,
        out.len(),
    );
    let escaped = is_escaped(v);
    if escaped.none() {
        return out.push(v);
    }
    if escaped.count() >= if size_of::<T>() == 1 { n / 4 } else { n / 2 } {
        if size_of::<T>() == 2 {
            return two[..n].iter().for_each(|&c| push_any(c, out));
        }
        // One check of the room for four, each of which adds less than 8.
        for four in two[..n].as_chunks::<4>().0 {
            let mut out = out.limit(3 * 7 + 8);
            four.iter().for_each(|&c| push_any(c, &mut out));
        }
        return;
    }
    out.push(v);
    for at in escaped.iter() {
        let (entity, len) = entity(two[at]);
        // It makes a branch of the minimum in `truncate`, for which the next round would wait.
        assert!(start + at <= out.len());
        out.truncate(start + at);
        let mut out = out.limit(8 + n);
        out.push_with_slack(u8x8::load(entity).cast::<T>().first_n(len));
        out.push(Simd::<T, W, S>::load_at(two, at + 1));
        start = start + len - 1;
    }
    out.truncate(start + n);
}

#[kernel]
fn escape_many<T: Unsigned>(mut from: &[T], to: &mut [MaybeUninit<T>]) {
    let (out, n) = (&mut Output::new(to), Simd::<T, B32, S>::LANES);
    // At an entity of 4 in the last lane, there is room for 8 and a vector.
    while let Some(two) = from.get(..2 * n + 4) {
        escape_first::<T, B32, S>(two, out);
        from = &from[n..];
    }
    while let Some(two) = from.get(..n + 4).filter(|_| size_of::<T>() == 2) {
        escape_first::<T, B16, S>(two, out);
        from = &from[n / 2..];
    }
    // The end has no room to spare. How much it grows tells whether it has many entities.
    if out.room() >= from.len() + from.len() / 2 {
        return escape_each(from, out);
    }
    for part in from.chunks(n / 2) {
        let (v, mut done) = (Simd::<T, B16, S>::load_or_default(part), 0);
        for at in is_escaped(v).iter() {
            push_few(v.shift_elements_left_dyn(done, T::ZERO), at - done, out);
            push_entity(part[at], out);
            done = at + 1;
        }
        push_few(
            v.shift_elements_left_dyn(done, T::ZERO),
            part.len() - done,
            out,
        );
    }
    assert!(out.room() == 0);
}

#[simd]
fn escape_each<T: Unsigned>(from: &[T], out: &mut Output<'_, T>) {
    let (most, last) = from.split_at(from.len().saturating_sub(7));
    most.iter().for_each(|&c| push_any(c, out));
    for &c in last {
        if c.to_u64() != ESCAPED[c.to_u64() as usize & 15].into() {
            out.push_one(c);
        } else {
            push_entity(c, out);
        }
    }
    assert!(out.room() == 0);
}

#[kernel]
fn escape_few<T: Unsigned>(from: &[T], to: &mut [MaybeUninit<T>]) {
    escape_each(from, &mut Output::new(to))
}

/// Panics unless that fills `to`.
#[inline(always)]
pub(crate) fn escape<T: Unsigned>(from: &[T], to: &mut [MaybeUninit<T>]) {
    if from.len() < 16 {
        escape_few::baseline(from, to)
    } else {
        // Wider registers gain little here, and slow some CPUs down after a pause.
        escape_many::baseline(from, to)
    }
}

#[cfg(all(test, not(miri)))]
mod tests {
    use super::*;

    #[test]
    fn the_room_has_to_be_filled() {
        for len in [3, 20, 100] {
            for room in [len - 1, len + 1, 3 * len] {
                let escape = || escape(&vec![b'a'; len], &mut vec![MaybeUninit::uninit(); room]);
                assert!(std::panic::catch_unwind(escape).is_err(), "{len} {room}");
            }
        }
    }
}
