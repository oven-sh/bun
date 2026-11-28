//! Each number of arguments has its own entries.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
#![allow(clippy::too_many_arguments)]
use bun_simd::{prelude::*, target::Target};

macro_rules! arities { ($($name:ident($($a:ident)*))*) => {
    $(mod $name {
        use super::*;
        targets!(icelake, avx2, sse4, neon82, neon);
        fn mixed(all: &[u32]) -> u32 {
            all.iter().fold(1, |sum, it| sum.wrapping_mul(31) + it)
        }
        #[simd]
        fn inlined($($a: u32),*) -> (u32, Target) {
            ((u32xN::splat(mixed(&[$($a),*])) + 1).reduce_max(), S::TARGET)
        }
        #[simd]
        #[inline(never)]
        fn apart($($a: u32),*) -> (u32, Target) {
            ((u32xN::splat(mixed(&[$($a),*])) + 1).reduce_max(), S::TARGET)
        }
        #[simd]
        #[cold]
        fn cold($($a: u32),*) -> (u32, Target) {
            ((u32xN::splat(mixed(&[$($a),*])) + 1).reduce_max(), S::TARGET)
        }
        #[simd]
        #[inline(never)]
        fn wide_apart($($a: u32,)* v: u32x16<S>) -> (u32, Target) {
            ((v + mixed(&[$($a),*])).reduce_min(), S::TARGET)
        }
        #[simd]
        #[cold]
        fn wide_cold($($a: u32,)* v: u32x16<S>) -> (u32, Target) {
            ((v + mixed(&[$($a),*])).reduce_min(), S::TARGET)
        }
        #[kernel]
        fn wide($($a: u32),*) -> [(u32, Target); 3] {
            let (v, closure): (_, &dyn Fn($(arities!(@u32 $a),)* u32x16<S>) -> _) =
                (u32x16::splat(1), &|$($a: u32,)* v| ((v + mixed(&[$($a),*])).reduce_min(), S::TARGET));
            [wide_apart($($a,)* v), wide_cold($($a,)* v), std::hint::black_box(closure)($($a,)* v)]
        }
        #[kernel]
        fn inner($($a: u32),*) -> (u32, Target) {
            ((u32xN::splat(mixed(&[$($a),*])) + 1).reduce_max(), S::TARGET)
        }
        #[kernel]
        fn all($($a: u32),*) -> [(u32, Target); 5] {
            let pointer: fn($(arities!(@u32 $a)),*) -> _ = inlined::<S>;
            [inlined($($a),*), apart($($a),*), cold($($a),*), inner::here($($a),*), std::hint::black_box(pointer)($($a),*)]
        }
        #[test]
        fn in_order() {
            #[allow(unused_mut, unused_variables)]
            let mut next = 2..;
            $(let $a = next.next().unwrap();)*
            let want = mixed(&[$($a),*]) + 1;
            assert_eq!((inner($($a),*).0, inner::baseline($($a),*).0), (want, want));
            assert_eq!(all($($a),*).map(|it| it.0), [want; 5]);
            let mut ran = 0;
            for target in all::targets() {
                if let Some(got) = all::to(target, $($a),*) {
                    assert_eq!(got, [(want, target); 5]);
                    assert_eq!(wide::to(target, $($a),*), Some([(want, target); 3]));
                    ran += 1;
                }
            }
            assert!(ran > 0);
        }
    })*
}; (@u32 $a:ident) => { u32 }; }
arities! {
    none() one(a) two(a b) three(a b c) four(a b c d) five(a b c d e) six(a b c d e f) seven(a b c d e f g) eight(a b c d e f g h)
    nine(a b c d e f g h i) ten(a b c d e f g h i j) eleven(a b c d e f g h i j k) twelve(a b c d e f g h i j k l) thirteen(a b c d e f g h i j k l m)
}
