//! For DEFLATE streams.
use crate::Aligned;
use bun_simd::{Appender, opaque};
use core::array::from_fn;
use core::cell::Cell;
use core::hint::{Locality, prefetch_write};

pub use simd::subtract_saturating;

const CHUNK: usize = 32;
const CHUNKS: usize = 10;
pub const MATCH_SPAN: usize = CHUNKS * CHUNK;
const MAX_LEN: usize = MATCH_SPAN - (CHUNK - 1);
/// From this chunk on, writing would wait for memory.
const FAR_CHUNK: usize = 3;

/// About where the one behind a long match is written.
pub const NEXT_MATCH_OFFSET: usize = 256;

/// A match is read from one and written to another, and they may overlap.
pub type Span = [Cell<u8>; MATCH_SPAN];

#[inline(always)]
fn prefetch(start: *const u8, offset: usize) {
    let first = start.cast_mut().wrapping_add(offset);
    for line in 0..4 {
        prefetch_write(first.wrapping_add(64 * line), Locality::L1);
    }
}

#[inline(always)]
fn get<const N: usize>(from: &[Cell<u8>; N]) -> [u8; N] {
    from_fn(|at| from[at].get())
}

#[inline(always)]
fn set<const N: usize>(to: &[Cell<u8>; N], bytes: [u8; N]) {
    for (at, to) in to.iter().enumerate() {
        to.set(bytes[at]);
    }
}

/// A chunk that repeats up to 31 bytes, and how much of it is whole periods.
#[inline(always)]
fn periods(
    len: usize,
    first: impl Fn() -> u8,
    load_before_end: impl Fn(usize) -> [u8; 16],
) -> ([u8; CHUNK], usize) {
    static STEPS: [u8; CHUNK] =
        from_fn(const |len| (CHUNK - CHUNK % (len | (len == 0) as usize)) as u8);
    match len {
        // A byte is sure to come from one store, and so without delay.
        ..2 => ([first(); CHUNK], CHUNK),
        _ => (
            simd::periods([load_before_end(len), load_before_end(len.min(16))], len),
            STEPS[len].into(),
        ),
    }
}

/// `from` starts `distance` bytes before `to`, or does not overlap it. May write up to 32 bytes too many.
#[inline(always)]
pub fn copy_match(from: &Span, to: &Span, distance: usize, len: usize, prefetch_at: Option<usize>) {
    let prefetch = || prefetch_at.map(|it| prefetch(to[0].as_ptr(), it));
    if distance < len.min(CHUNK) {
        if len > FAR_CHUNK * CHUNK {
            prefetch();
        }
        let load = |back: usize| from_fn(|at| from[distance - back + at].get());
        // If LLVM sees that `load` reads it too, it takes that load apart.
        let first = || from[opaque(0) as u8 as usize].get();
        let (chunk, step) = periods(distance, first, load);
        let mut at = 0;
        #[rustc_unroll(never)]
        while at < len.min(MAX_LEN) {
            if let Some(to) = to[at..].first_chunk() {
                set(to, chunk);
            }
            at += step;
        }
        return;
    }
    let copy = |i: usize| set(&to.as_chunks().0[i], get::<CHUNK>(&from.as_chunks().0[i]));
    copy(0);
    for at in (CHUNK..MATCH_SPAN).step_by(CHUNK) {
        if at >= len {
            break;
        }
        if at == FAR_CHUNK * CHUNK {
            prefetch();
        }
        copy(at / CHUNK);
    }
}

/// `false` if `distance` is out of range, or there is no room for a `Span`.
#[inline(always)]
pub fn push_match(to: &mut Appender<'_>, distance: usize, len: usize) -> bool {
    let len = len.min(MAX_LEN);
    if to.room() < MATCH_SPAN || distance.wrapping_sub(1) >= to.position() {
        return false;
    }
    let end = to.as_ptr();
    if distance >= len.min(CHUNK) {
        return to.push_again::<CHUNK, CHUNKS>(distance, len, |i| {
            if i == FAR_CHUNK {
                prefetch(end, NEXT_MATCH_OFFSET);
            }
        });
    }
    if len > FAR_CHUNK * CHUNK {
        prefetch(end, NEXT_MATCH_OFFSET);
    }
    let first = || to.peek::<1>(distance).unwrap()[0];
    let (chunk, step) = periods(distance, first, |back| to.peek(back).unwrap());
    to.push_every::<CHUNK, CHUNKS>(step, chunk, len)
}

#[bun_simd::foreach_target]
mod simd {
    use isa::{U16, x128, x256};

    /// From the 16 bytes at the start of a period, and those at its end if it is longer.
    #[export(baseline)]
    #[inline]
    pub fn periods(ends: [[u8; 16]; 2], len: usize) -> [u8; CHUNK] {
        static INDICES: Aligned<[[[u8; 16]; 2]; CHUNK]> = Aligned(from_fn(const |len| {
            from_fn(const |half| {
                from_fn(const |i| match len {
                    0 => 0,
                    1..=16 => ((16 * half + i) % len) as u8,
                    _ => ((half * (CHUNK - len) + i) % 16) as u8,
                })
            })
        }));
        let half =
            |i: usize| x128::U8::from_array(ends[i]).lookup(x128::U8::load(&INDICES.0[len][i]));
        x256::U8::from_halves([half(0), half(1)]).to_array()
    }

    #[export(up_to = avx2, up_to = neon)]
    pub fn subtract_saturating(values: &mut [[u16; 64]], amount: u16) {
        for group in values {
            for chunk in group.as_chunks_mut().0 {
                U16::load(chunk).saturating_sub(amount).store(chunk);
            }
        }
    }
}
