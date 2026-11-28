use super::near::first_near;
use bun_simd::prelude::*;
use core::sync::atomic::AtomicU8;

const DIGITS: [u8; 16] = *b"0123456789abcdef";

/// Needs at least one vector.
#[simd]
fn encode<W: Width>(from: &[impl Readable<u8>], to: &mut [u8]) {
    let table = Simd::<u8, W, S>::repeat(&DIGITS).in_blocks();
    let one = |v: Simd<u8, W, S>, to: &mut [u8]| {
        let digits = [
            table.lookup_bytes_relaxed(v >> 4),
            table.lookup_bytes_relaxed(v & 15),
        ];
        Simd::store_interleaved(digits, to)
    };
    let (vectors, rest) = Simd::<u8, W, S>::over(from).exact();
    for (v, to) in vectors.zip(to.chunks_exact_mut(2 * W::BYTES)) {
        one(v, to);
    }
    if !rest.is_empty() {
        one(
            Simd::load_last(from),
            &mut to[2 * (from.len() - W::BYTES)..],
        );
    }
}

#[simd]
fn encode_all(from: &[impl Readable<u8>], to: &mut [u8]) {
    let to = &mut to[..2 * from.len()];
    if from.len() >= Native::<S>::BYTES {
        return encode::<Native<S>, S>(from, to);
    }
    if from.len() >= 16 {
        return encode::<B16, S>(from, to);
    }
    for (byte, to) in from.iter().zip(to.as_chunks_mut().0) {
        let byte = byte.value();
        *to = [DIGITS[(byte >> 4) as usize], DIGITS[(byte & 15) as usize]];
    }
}

#[kernel]
fn encode_plain(from: &[u8], to: &mut [u8]) {
    encode_all(from, to)
}

#[kernel]
pub(crate) fn encode_shared(from: &[AtomicU8], to: &mut [u8]) {
    encode_all(from, to)
}

/// From `0` on. Digits have the highest bit.
static NIBBLES: [u8; 64] = {
    let (mut all, mut i) = ([0; 64], 0);
    while i < 16 {
        all[(DIGITS[i] - b'0') as usize] = 0x80 | i as u8;
        all[(DIGITS[i].to_ascii_uppercase() - b'0') as usize] = 0x80 | i as u8;
        i += 1;
    }
    all
};

/// The bytes of two vectors of digits, if all are digits.
#[simd]
fn decode<W: Width>(a: Simd<u8, W, S>, b: Simd<u8, W, S>) -> Option<Simd<u8, W, S>> {
    if cfg!(target_arch = "aarch64") {
        let (a, b) = (
            (a - b'0').lookup_or(&NIBBLES, 0),
            (b - b'0').lookup_or(&NIBBLES, 0),
        );
        if !(a & b).cast_signed().is_negative().all() {
            return None;
        }
        let [high, low] = a.deinterleave(b);
        return Some(high << 4 | low & 15);
    }
    // What is not a digit gives more than 15.
    let nibbles = |v: Simd<u8, W, S>| {
        let digit = (v + (0xff - b'9')).saturating_sub(6) - 0xf0;
        digit.simd_min(((v & 0xdf) - b'A').saturating_add(10))
    };
    let (a, b) = (nibbles(a), nibbles(b));
    if (a | b).simd_gt(15).any() {
        return None;
    }
    // After a pause, some CPUs take a microsecond for the first multiplication of this width.
    if W::BYTES == 64 {
        let byte = |v: Simd<u8, W, S>| (v.bitcast::<u16>() << 4 | v.bitcast::<u16>() >> 8) & 0xff;
        return Some(byte(a).saturating_narrow::<u8>(byte(b)));
    }
    let weights = Simd::repeat(&[0x10, 1]);
    Some(
        a.saturating_dot(weights)
            .saturating_narrow::<u8>(b.saturating_dot(weights)),
    )
}

/// Characters of one or two bytes, of which the lower one counts.
#[simd]
fn load<T: Unsigned, W: Width>(from: &[T]) -> Simd<u8, W, S> {
    let from = &from[..W::BYTES];
    if size_of::<T>() == 1 {
        return Simd::<T, W, S>::load(from).bitcast();
    }
    Simd::<T, W, S>::load(from)
        .bitcast::<u16>()
        .wrapping_narrow::<u8>(Simd::<T, W, S>::load_last(from).bitcast())
}

/// Needs at least one vector. Stops before the first one with something else than digits.
#[simd]
fn decode_vectors<T: Unsigned, W: Width>(from: &[T], to: &mut [u8]) -> usize {
    let n = W::BYTES;
    let one = |from: &[T]| decode(load::<_, W, S>(from), load::<_, W, S>(&from[n..]));
    for (i, (from, to)) in from
        .chunks_exact(2 * n)
        .zip(to.chunks_exact_mut(n))
        .enumerate()
    {
        match one(from) {
            Some(bytes) => bytes.store(to),
            None => return i * n,
        }
    }
    let rest = to.len() % n;
    if rest > 0 {
        match one(&from[from.len() - 2 * n..]) {
            Some(bytes) => bytes.store_last(to),
            None => return to.len() - rest,
        }
    }
    to.len()
}

/// Fewer than 16 pairs: all or nothing.
#[simd]
fn decode_short<T: Unsigned>(from: &[T], to: &mut [u8]) -> usize {
    let zero = T::from(b'0');
    let [a, b] = if size_of::<T>() == 1 {
        Simd::<T, B32, S>::load_or(from, zero)
            .bitcast::<u8>()
            .split()
    } else if from.len() <= 16 {
        let digits = Simd::<T, B32, S>::load_or(from, zero).bitcast::<u16>();
        [digits.cast::<u8>(), u8x16::splat(b'0')]
    } else {
        let digits = Simd::<T, B64, S>::load_or(from, zero).bitcast::<u16>();
        digits.cast::<u8>().split()
    };
    decode(a, b).map_or(0, |bytes| {
        bytes.store_partial(to);
        to.len()
    })
}

/// The pairs before the first character that is not a digit, which is near.
#[kernel]
#[inline(never)]
fn decode_rest<T: Unsigned>(from: &[T], to: &mut [u8], done: usize) -> usize {
    let other = first_near(&from[2 * done..], |v| {
        let digit = ((v & T::of::<0xff>()) - T::from(b'0')).simd_lt(T::of::<10>());
        !(digit | ((v & T::of::<0xdf>()) - T::from(b'A')).simd_lt(T::of::<6>()))
    });
    let end = done + other / 2;
    if end == done {
        return end;
    }
    let start = done.min(end.saturating_sub(16));
    let (from, to) = (&from[2 * start..2 * end], &mut to[start..end]);
    if end < 16 {
        return decode_short(from, to);
    }
    start + decode_vectors::<_, B16, S>(from, to)
}

#[simd]
fn decode_pairs<T: Unsigned>(from: &[T], to: &mut [u8]) -> usize {
    let pairs = to.len().min(from.len() / 2);
    let (from, to) = (&from[..2 * pairs], &mut to[..pairs]);
    let done = if pairs >= Native::<S>::BYTES {
        decode_vectors::<_, Native<S>, S>(from, to)
    } else if Native::<S>::BYTES > 16 && pairs >= 16 {
        decode_vectors::<_, B16, S>(from, to)
    } else {
        decode_short(from, to)
    };
    if done == pairs {
        done
    } else {
        decode_rest::here::<T, S>(from, to, done)
    }
}

#[kernel]
fn decode8(from: &[u8], to: &mut [u8]) -> usize {
    decode_pairs(from, to)
}

#[kernel]
fn decode16(from: &[u16], to: &mut [u8]) -> usize {
    decode_pairs(from, to)
}

/// Writes two digits for each byte. Panics if `to` is too short.
pub fn encode_hex_lower(from: &[u8], to: &mut [u8]) {
    encode_plain(from, to)
}

/// Stops at the first pair that is not hexadecimal, or when `to` is full, and returns the number of bytes.
pub fn decode_hex(from: &[u8], to: &mut [u8]) -> usize {
    decode8(from, to)
}

/// Of each unit the lower byte counts, as in Node's `Buffer`: U+FF41 is `A`.
pub fn decode_hex_u16(from: &[u16], to: &mut [u8]) -> usize {
    decode16(from, to)
}
