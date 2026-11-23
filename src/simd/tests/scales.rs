//! The widths that a target names, `Either!`, `not_unrolled`, and `S` outside of marked code.
#![allow(dead_code, unreachable_pub)]
#![forbid(unsafe_code)]
use bun_simd::prelude::*;

#[simd]
mod k {
    use bun_simd::prelude::*;

    #[kernel(targets = bun_simd::target::Targets::ALL)]
    pub fn widths() -> [usize; 8] {
        [
            S::Eighth::BYTES,
            S::Quarter::BYTES,
            S::Half::BYTES,
            S::Native::BYTES,
            S::Twice::BYTES,
            S::Four::BYTES,
            S::Eight::BYTES,
            S::Upto32::BYTES,
        ]
    }

    /// Each is known to be the half or the double of the next.
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    pub fn up_and_down(x: u8) -> (u32, u8) {
        let small = Simd::<u8, S::Quarter, S>::splat(x);
        let wide: Simd<u32, S::Native, S> = small.cast();
        let four: Simd<u32, S::Four, S> = u8xN::splat(x).cast();
        let half: Simd<u8, S::Eighth, S> = small.split()[0];
        let eight: Simd<u64, S::Eight, S> = u8xN::splat(x).cast();
        let capped = Simd::<u8, S::Upto32, S>::splat(x);
        (wide[0] + four[0] + eight[0] as u32, half[0] + capped.split()[0][0])
    }

    type Either = Either![S: B16 => u8, B32 => [u8; 2], _ => (u16, u16)];
    #[kernel(targets = bun_simd::target::Targets::ALL)]
    pub fn either() -> (usize, usize) {
        (S::Native::BYTES, size_of::<Either<S>>())
    }

    #[kernel(targets = bun_simd::target::Targets::ALL)]
    pub fn sum(values: &[u32]) -> u32 {
        let mut sum = u32xN::zero();
        for chunk in values.chunks(u32xN::<S>::LANES) {
            not_unrolled();
            sum += u32xN::load_or_default(chunk);
        }
        sum.reduce_sum()
    }
}

#[test]
fn on_each_target() {
    let values: Vec<u32> = (0..200).collect();
    for target in Target::ALL {
        let Some(got) = k::widths::to(*target) else { continue };
        let n = got[3];
        assert_eq!(got, [n / 8, n / 4, n / 2, n, n * 2, n * 4, n * 8, n.min(32)], "{target:?}");
        assert_eq!(k::up_and_down::to(*target, 7), Some((21, 14)), "{target:?}");
        assert_eq!(k::either::to(*target), Some((n, n / 16)), "{target:?}");
        for len in 0..values.len() {
            assert_eq!(k::sum::to(*target, &values[..len]), Some(values[..len].iter().sum()), "{target:?}");
        }
    }
}

#[test]
fn outside() {
    let same = |it: Option<S>| -> Option<bun_simd::Outside> { it };
    assert!(same(None).is_none());
    assert_eq!(size_of::<Option<S>>(), 0);
}
