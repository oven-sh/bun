//! The loops that store around the caches.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#[macro_use]
mod framework;
use bun_simd::{mem::*, *};
use core::mem::MaybeUninit;
use framework::*;

fn range(io: &Io, len: usize) -> core::ops::Range<usize> {
    let end = io.up_to(len);
    (io.n >> 20) as usize % 9 % (end + 1)..end
}
fn long<T: Test>(io: &Io) -> Vec<T> {
    io.slice::<T>().repeat(9)
}

cases! {
    stream_into [i8 i32 f64] 8..=64, |d, _, _, _, io| {
        let from = long::<T>(io);
        let (r, at) = (range(io, from.len()), (io.n >> 40) as usize % 70);
        let (mut plain, mut streamed, mut zipped) = (vec![T::ONE; from.len() + 80], vec![T::ONE; from.len() + 80], vec![T::ONE; from.len() + 80]);
        let (x, n) = (&from[r.clone()], r.len());
        d.over(x).map_into(&mut plain[at..], #[inline(always)] |v| !v);
        d.over(x).stream_into(&mut streamed[at..], #[inline(always)] |v| !v);
        d.over(x).zip(&plain[at..][..n]).stream_into(&mut zipped[at..][..n], #[inline(always)] |(a, b)| a & b ^ b);
        let mut uninit = vec![MaybeUninit::<T>::uninit(); n + at];
        d.over(x).stream_into(&mut uninit[at..], #[inline(always)] |v| v);
        let bits = |it: &[T]| it.iter().map(|it| it.to_bits()).collect::<Vec<_>>();
        let mut bytes = vec![1; (n + 80) * size_of::<T>()];
        d.over(x).stream_into(bytes[at..].as_chunks_mut::<{ size_of::<T>() }>().0, #[inline(always)] |v| !v);
        let as_bytes = cfg!(target_endian = "big") || bytes[at..][..size_of_val(x)] == *as_bytes(&plain[at..][..n]) && bytes[..at].iter().chain(&bytes[at + size_of_val(x)..]).all(|&it| it == 1);
        [bits(&plain) == bits(&streamed), bits(&plain) == bits(&zipped), as_bytes]
    } => |_m| vec![1; 3];
    // The place of the output in its page is up to four vectors after that of the input.
    just_ahead [i8 u32] 8..=64, |d, _, _, _, io| {
        let from = long::<T>(io);
        let x = &from[range(io, from.len())];
        let y: Vec<T> = x.iter().rev().copied().collect();
        macro_rules! same { (|$to:ident| $plain:expr, $streamed:expr) => {{
            let (mut plain, mut streamed) = (vec![T::ONE; x.len() + 4200], vec![T::ONE; x.len() + 4200]);
            let at = (x.as_ptr().addr() + (io.n.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 40) as usize % (4 * d.lanes() * size_of::<T>())).wrapping_sub(streamed.as_ptr().addr()) % 4096 / size_of::<T>();
            { let $to = &mut plain[at..]; $plain };
            { let $to = &mut streamed[at..]; $streamed };
            plain == streamed
        }}; }
        macro_rules! both { ($over:expr, $f:expr) => {
            same!(|to| $over.map_into(to, #[inline(always)] $f), $over.stream_into(to, #[inline(always)] $f))
                && same!(|to| $over.map_into(to, #[inline(always)] $f), streaming(#[inline(always)] |s| $over.map_into(&mut s.lend(to), #[inline(always)] $f)))
        }; }
        macro_rules! scan { ($to:expr) => {{ let mut sum = d.zero(); d.over(x).scan_into($to, #[inline(always)] |v| { sum += v; sum }) }}; }
        [
            both!(d.over(x), |v| !v),
            both!(d.over(&y).zip(x), |(a, b)| a - b),
            both!(d.over(x).windows::<2>(), |[a, b]| a - b),
            same!(|to| scan!(to), streaming(#[inline(always)] |s| scan!(&mut s.lend(to)))),
            cfg!(target_endian = "big") || same!(|to| d.over(x).map_into(to, #[inline(always)] |v| v), d.over(x).stream_into(as_bytes_mut(to).as_chunks_mut::<{ size_of::<T>() }>().0, #[inline(always)] |v| v)),
            same!(|to| d.over(x).map_into(as_bytes_mut(to), #[inline(always)] |v| v.bitcast::<u8>()), streaming(#[inline(always)] |s| d.over(x).map_into(&mut s.lend(as_bytes_mut(to)), #[inline(always)] |v| v.bitcast::<u8>()))),
        ]
    } => |_m| vec![1; 6];
    stream_to_other_lanes [u16] 2..=64, |d, _, _, _, io| {
        let from = long::<T>(io);
        let (x, at) = (&from[range(io, from.len())], (io.n >> 40) as usize % 70);
        let (mut wide, mut narrow) = (vec![1u32; x.len() + 80], vec![1u8; x.len() + 80]);
        d.over(x).stream_into(&mut wide[at..], #[inline(always)] |v| v.cast::<u32>());
        if const { W::BYTES > 2 } { d.over(x).stream_into(&mut narrow[at..], #[inline(always)] |v| v.cast::<u8>()); }
        let around = |n: usize| (0..n).map(|i| if (at..at + x.len()).contains(&i) { x[i - at] } else { 1 });
        [wide.iter().copied().eq(around(wide.len()).map(u32::from)), d.lanes() == 1 || narrow.iter().copied().eq(around(narrow.len()).map(|it| it as u8))]
    } => |_m| vec![1; 2];
    stream_fill_with [u8 u64] 0..=64, |d, a, _, _, io| {
        let (mut x, mut y, first) = (long::<T>(io), long::<T>(io), a[0]);
        let r = range(io, x.len());
        d.over_mut(&mut x[r.clone()]).stream_fill_with(#[inline(always)] |i| i * 3 + first);
        d.over_mut(&mut y[r]).fill_with(#[inline(always)] |i| i * 3 + first);
        x == y
    } => |_m| vec![1];
    lent_other_lanes [u16] 2..=64, |d, _, _, _, io| {
        let from = long::<T>(io);
        let (x, at) = (&from[range(io, from.len())], (io.n >> 40) as usize % 70);
        macro_rules! same { ($t:ty, |$to:ident| $run:expr) => {{
            let (mut plain, mut lent) = (vec![1 as $t; 2 * x.len() + 80], vec![1 as $t; 2 * x.len() + 80]);
            { let mut $to = &mut plain[at..]; $run };
            streaming(#[inline(always)] |s| { let mut $to = s.lend(&mut lent[at..]); $run });
            plain == lent
        }}; }
        [
            same!(u32, |to| d.over(x).map_into(&mut to, #[inline(always)] |v| v.cast::<u32>())),
            same!(u8, |to| d.over(x).map_into(&mut to, #[inline(always)] |v| v.bitcast::<u8>())),
            same!(u8, |to| d.over(x).scan_into(&mut to, #[inline(always)] |v| v.bitcast::<u8>())),
            const { W::BYTES < 8 } || same!(u64, |to| d.over(x).map_into(&mut to, #[inline(always)] |v| v.bitcast::<u64>())),
            const { W::BYTES < 8 } || same!(u64, |to| d.over(x).scan_into(&mut to, #[inline(always)] |v| v.bitcast::<u64>())),
        ]
    } => |_m| vec![1; 5];
    // The last store to a place counts, whichever way each went.
    lent_twice [u8 u32] 0..=64, |d, a, b, c, io| {
        let (mut plain, mut lent) = (Aligned([T::ONE; 2048]), Aligned([T::ONE; 2048]));
        let places = [0, 1, d.lanes(), d.lanes() - 1, 0, (io.n >> 8) as usize % 70, (io.n >> 16) as usize % 4 * d.lanes(), (io.n >> 24) as usize % 70, 0, d.lanes()];
        macro_rules! run { ($to:expr) => {{
            let mut to = $to;
            for (i, at) in places.into_iter().enumerate() {
                let v = [a, b, c][(io.n >> (2 * i + 32)) as usize % 3];
                if io.n >> i & 3 == 0 { v.store_partial_at(&mut to.part(..at + d.lanes() / 2), at) } else { v.store_at(&mut to, at) }
            }
        }}; }
        run!(&mut plain[..]);
        streaming(#[inline(always)] |s| run!(s.lend(&mut lent.0)));
        plain == lent
    } => |_m| vec![1];
}

/// What was written before a panic is there, also for another thread.
#[test]
#[cfg_attr(not(panic = "unwind"), ignore = "needs unwinding")]
fn streaming_panics() {
    use bun_simd::generic::*;
    #[bun_simd::kernel(targets = bun_simd::target::Targets::ALL)]
    fn case((from, to): (&[u32], &mut [u32])) {
        let s: S = bun_simd::prelude::isa();
        s.over(from).stream_into(
            to,
            #[inline(always)]
            |v| {
                assert!(v.simd_ne(5000).all() || v.simd_eq(0).any());
                v + 1
            },
        )
    }
    let from: Vec<u32> = (1..10000).collect();
    for target in targets() {
        let mut to = vec![0; from.len()];
        assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| case::to(target, (&from, &mut to)))).is_err());
        std::thread::scope(|scope| {
            scope.spawn(|| {
                assert!(to[..4000].iter().zip(2..).all(|(&a, b)| a == b) && to[5100..].iter().all(|&it| it == 0))
            });
        });
    }
    let mut short = [0u8; 299];
    assert!(std::panic::catch_unwind(move || baseline().over(&[1u8; 300]).stream_into(&mut short, |v| v)).is_err());
}
