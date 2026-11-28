//! Polynomials.

use crate::{B16, Float, Isa, Simd, Width};

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    /// `c[0] + c[1] * self + c[2] * self * self + ..`, for one coefficient or more. The order of the steps, and how often they round, depend on the target.
    /// It may take the square and the cube of `self`, and add in groups. Where a step overflows or underflows, or `self` is infinite, the result can be
    /// infinite, NaN or inexact, and the sign of a zero can differ. `f16` and `bf16` round to 16 bits at each step.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f32x4::iota(0.0).polynomial_relaxed([1.0, 2.0, 0.0, 1.0]), [1.0, 4.0, 13.0, 34.0]);
    /// # } example()
    /// ```
    #[doc(alias("horner", "estrin", "poly", "polyval", "series"))]
    #[op]
    pub fn polynomial_relaxed<const N: usize>(self, c: [T; N]) -> Self {
        const { assert!(N > 0, "a polynomial needs a coefficient") };
        choose! {
            S::A64 && T::BITS >= 32 && N >= 9 => self.in_groups::<N, 3>(c),
            // On x86, the chain is shorter.
            T::BITS >= 32 && N >= if S::A64 { 3 } else if S::AVX2 && S::REGISTER < 64 { 6 } else if S::AVX2 && T::BITS == 64 { 8 } else { usize::MAX } => self.in_groups::<N, 2>(c),
            _ => self.in_groups::<N, 1>(c),
        }
    }
    /// Horner's scheme in the `G`th power. `fmla` overwrites what it adds, which takes a copy for each group, and it can take a
    /// factor from a lane, so that factors share registers.
    #[op]
    fn in_groups<const N: usize, const G: usize>(self, c: [T; N]) -> Self {
        let d = self.tag();
        let square = self * self;
        let power = [self, square, square * self];
        let hides = const { S::A64 && T::BITS >= 32 && W::BYTES >= 16 && (G > 1 || N == 2) };
        // The last one is a factor too.
        let factor = always!(|i: usize| {
            if !hides {
                return d.set(c[i]);
            }
            let (lanes, at) = (Simd::<T, B16, S>::LANES, i - i.div_ceil(G));
            let all = self.s.fixed::<T, B16>().from_fn(
                #[inline(always)]
                |lane| {
                    let at = at / lanes * lanes + lane;
                    c[(at + at / (G - 1).max(1) + 1).min(N - 1)]
                },
            );
            d.set(all.black_box().to_array().as_ref()[at % lanes])
        });
        let last = N > 1 && (N - 1).is_multiple_of(G);
        let (groups, mut above) = ((N - 1) / G + 1 - last as usize, last.then(|| factor(N - 1)));
        unrolled!(
            16,
            for back in 0..groups {
                let group = groups - 1 - back;
                let first = d.set(c[group * G]);
                // It would make it of integers again at each use.
                let mut sum = if hides { first.black_box() } else { first };
                unrolled!(
                    4,
                    for i in 1..G {
                        if group * G + i < N {
                            sum = power[i - 1].mul_add_relaxed(factor(group * G + i), sum);
                        }
                    }
                );
                above = Some(match above {
                    Some(above) => above.mul_add_relaxed(power[G - 1], sum),
                    None => sum,
                });
            }
        );
        above.unwrap()
    }
}
