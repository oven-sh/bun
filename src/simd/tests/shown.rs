//! `Debug` of masks, for all lanes, widths and targets.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;
use bun_simd::target::Target;

macro_rules! all {
    ($($name:ident $t:ty: $($w:ident)*;)*) => {$(
        #[kernel]
        fn $name(n: usize) -> Vec<(usize, String, String)> {
            vec![$({
                let mask = MaskOf::<$t, $w, S>::first_n(n);
                let other: &dyn core::fmt::Debug = &!mask;
                (Simd::<$t, $w, S>::LANES, format!("{mask:?}"), format!("{other:?}"))
            }),*]
        }
    )*
        #[test]
        fn as_bits() {
            for &target in Target::ALL {
                for n in 0..=65 {
                    for (lanes, mask, other) in [$($name::to(target, n)),*].into_iter().flatten().flatten() {
                        let first = |n: usize| u64::MAX.unbounded_shr(64 - n.min(lanes) as u32);
                        assert_eq!(mask, format!("{:#b}", first(n)), "{target:?} {lanes}");
                        assert_eq!(other, format!("{:#b}", first(64) ^ first(n)), "{target:?} {lanes}");
                    }
                }
            }
        }
    };
}
all! {
    bytes u8: B8 B16 B32 B64;
    halves u16: B8 B16 B32 B64 B128;
    words f32: B8 B16 B32 B64 B128 B256;
    doubles u64: B8 B16 B32 B64 B128 B256 B512;
}
