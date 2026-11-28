//! Each phase of the searches and of `over_mut(x).map`: all lengths up to 14 vectors, with matches everywhere.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::{target::*, *};

#[kernel]
fn check<T: Int, W: Width>(all: &mut [T], _width: W) {
    let s: S = bun_simd::prelude::isa();
    let (n, one) = (W::BYTES / size_of::<T>(), T::of::<1>());
    for len in (0..=14 * n + 70).filter(|len| *len < 40 || len % n < 2 || len % n == n - 1 || len % 7 == 0) {
        let start = len * 5 % 67;
        let x = &mut all[start..start + len];
        assert_eq!(
            (s.over(&*x).by::<W>().position(|v| v.simd_eq(one)), s.over(&*x).by::<W>().rposition(|v| v.simd_eq(one))),
            (None, None)
        );
        let mut to = vec![one; len];
        assert_eq!(s.over(&*x).by::<W>().map_until(&mut to, |v| v.simd_eq(one), |v| v), len);
        assert!(
            to == x && !s.over(&*x).by::<W>().any(|v| v.simd_eq(one)) && s.over(&*x).by::<W>().all(|v| v.simd_ne(one))
        );
        let (zeros, is) = (vec![T::default(); len + len % 3], |want: bool| [want, !want]);
        let pairs = |x: &[T]| {
            let it = s.over(x).by::<W>().zip(&zeros[..]);
            [it.all(|(a, b)| a.simd_eq(b)), it.any(|(a, b)| a.simd_ne(b))]
        };
        assert_eq!(pairs(x), is(true));
        for at in 0..len {
            x[at] = one;
            assert_eq!((pairs(x), s.over(&*x).by::<W>().position_max()), (is(false), Some(at)), "{len} {at}");
            let other = at + (len - at) * (at % 5) / 5;
            (x[at], x[other]) = (one, one);
            let over = s.over(&*x).by::<W>();
            assert_eq!(
                (over.position(|v| v.simd_eq(one)), over.rposition(|v| v.simd_eq(one))),
                (Some(at), Some(other)),
                "{len} {at}"
            );
            assert!(over.any(|v| v.simd_eq(one)) && !over.all(|v| v.simd_ne(one)));
            assert!(
                over.positions(|v| v.simd_eq(one)).eq([at, other].into_iter().take(1 + (other > at) as usize)),
                "{len} {at}"
            );
            assert_eq!(over.positions(|v| v.simd_ne(one)).count(), len - 1 - (other > at) as usize);
            let mut to = vec![one; len];
            assert_eq!(over.map_until(&mut to, |v| v.simd_eq(one), |v| v + one + one), at);
            assert!(to[..at].iter().all(|&it| it == T::of::<2>()));
            (x[at], x[other]) = (T::default(), T::default());
        }
    }
    for len in (0..=40 * n).filter(|len| *len < 5 * n || len % 11 == 0) {
        let start = len * 3 % 67;
        s.over_mut(&mut all[start..start + len]).by::<W>().map(|v| v + one);
        assert!(
            all.iter()
                .enumerate()
                .all(|(i, &it)| it == if (start..start + len).contains(&i) { one } else { T::default() }),
            "{len}"
        );
        all.fill(T::default());
    }
}

#[test]
fn all_phases() {
    for &target in Targets::DEFAULT.0.iter().chain([&Target::Portable]) {
        if !set_cpu(target) {
            continue;
        }
        macro_rules! each { ($($t:ident: $($w:ident)*;)*) => {$($( check(&mut vec![0 as $t; 3000], $w); )*)*}; }
        each! { u8: B4 B8 B16 B32 B64; i16: B8 B16 B32 B64; u32: B16 B32 B64; u64: B16 B32 B64; }
    }
}
