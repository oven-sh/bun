//! `count` where all values match, so that a sum in a lane would wrap first, and at all lengths and offsets.
#![allow(dead_code, unreachable_pub)]
use bun_simd::{target::*, *};

#[kernel(targets = Targets::ALL)]
fn count<T: Int>(values: &[T], of: T) -> usize {
    let s: S = bun_simd::prelude::isa();
    s.over(values).count(|v| v.simd_eq(of))
}

macro_rules! each { ($($t:ident $long:expr)*) => {$(
    #[test]
    fn $t() {
        let (same, mixed): (Vec<$t>, Vec<$t>) = (vec![1; $long + 700], (0..700u32).map(|i| (i * i / 7 % 3) as $t).collect());
        for target in count::targets() {
            for at in 0..if cfg!(miri) { 1 } else { 33 } {
                for len in (0..600).step_by(if cfg!(miri) { 97 } else { 1 }) {
                    let part = &mixed[at..][..len];
                    assert_eq!(count::to(target, part, 1), Some(part.iter().filter(|&&it| it == 1).count()), "{target:?} {at} {len}");
                }
                for len in [$long / 2 - 1, $long / 2, $long / 2 + 65, $long - 129, $long, $long + 1, $long + 64, $long + 128, $long + 129, $long + 600] {
                    if !cfg!(miri) { assert_eq!(count::to(target, &same[at..][..len], 1), Some(len), "{target:?} {at} {len}") }
                }
            }
        }
    }
)*}; }
each!(u8 (248 * 32) u16 (65528 * 16) u32 5000 u64 5000);
