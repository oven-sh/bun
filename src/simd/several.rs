//! Reductions of several vectors at once.

use crate::{Isa, Lane, Simd, Width, X86, array::own as array};

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Reduces each of up to 16 vectors to a number, which is mostly faster than one after the other. `join` gets lanes of several of them
    /// side by side. It has to treat all lanes alike, and for integers the order must not matter. Floating-point numbers are joined as a tree:
    /// the lower half with the upper half down to 16 bytes, and then neighbors. `from` makes a vector of the results. If much work follows, store them, and do it in a second loop at the full width.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let rows = [f32x8::iota(0.0), f32x8::splat(1.0), f32x8::iota(-3.0)];
    /// assert_eq!(f32x8::reduce_each(rows, |a, b| a + b), [28.0, 8.0, 4.0]);
    /// assert_eq!(f32x8::reduce_each(rows, |a, b| a.simd_max(b)), [7.0, 1.0, 4.0]);
    /// # } example()
    /// ```
    #[doc(alias("reduce_sums", "hsum", "horizontal_sums", "transposed_sum", "max_pairs", "min_pairs"))]
    #[op]
    pub fn reduce_each<const K: usize>(vectors: [Self; K], join: impl Fn(Self, Self) -> Self) -> [T; K] {
        const { assert!(1 <= K && K <= 16, "this is for 1 to 16 vectors") };
        crate::closures::inlined_here!(vectors[0].s, join(a, b));
        let (blocks, all) = (W::BYTES.div_ceil(16), K.next_power_of_two());
        let lanes = Self::LANES / blocks;
        // To interleave takes one instruction, and leaves the results in the order of the reversed bits.
        let halves = const { X86 && !T::IS_FLOAT && size_of::<T>() <= 2 };
        // How many vectors end up in a block, and in how many blocks of a vector.
        let (each, used) = ((all / blocks).clamp(1, lanes), all.min(blocks));
        let reversed =
            always!(|j: usize| if halves { j.reverse_bits() >> 1 >> (usize::BITS - 1 - each.ilog2()) } else { j });
        let mut v: [Self; 16] = array::from_fn(
            #[inline(always)]
            |i| {
                let (block, j, group) = (i % used, i / used % each, i / used / each);
                vectors[((group * used + block) * each + reversed(j)).min(K - 1)]
            },
        );
        let mut left = all;
        unrolled!(8, for round in 0..const (W::BYTES.div_ceil(16).ilog2() as usize) {
            let size = blocks >> round;
            unrolled!(8, for i in 0..const (K.next_power_of_two().div_ceil(2)) {
                if i >= left.div_ceil(2) {
                    return;
                }
                let [lower, upper] = v[2 * i].halves_of_groups(v[(2 * i + 1).min(left - 1)], 16 * size);
                v[i] = join(lower, upper);
            });
            left = left.div_ceil(2);
        });
        let size = lanes / each;
        unrolled!(
            4,
            for _ in 0..(each.ilog2() as usize) {
                unrolled!(8, for i in 0..const (K.next_power_of_two() / 2) {
                    if i >= left / 2 {
                        return;
                    }
                    let [a, b] = choose! {
                        X86 && !T::IS_FLOAT && size_of::<T>() <= 2 => v[2 * i].in_blocks().interleave(v[2 * i + 1]),
                        _ => v[2 * i].in_blocks().deinterleave(v[2 * i + 1]),
                    };
                    v[i] = join(a, b);
                });
                left /= 2;
            }
        );
        let (stride, mut step) = (if X86 && !halves { size } else { 1 }, 1);
        unrolled!(
            4,
            for _ in 0..(size.ilog2() as usize) {
                let [a, b] = choose! {
                    X86 => [v[0], v[0].swapped_by(if halves { lanes / 2 / step } else { step })],
                    _ => v[0].in_blocks().deinterleave(v[0]),
                };
                (v[0], step) = (join(a, b), 2 * step);
            }
        );
        let place = always!(|i: usize| i / each % used * lanes + i % each * stride);
        return_if!(
            W::BYTES > 64,
            array::from_fn(
                #[inline(always)]
                |k| v[k / Self::LANES].to_array().as_ref()[place(k % Self::LANES)]
            )
        );
        if each < lanes && (blocks > 1 || stride > 1) {
            // LLVM would do the last rounds for each result.
            v[0] = choose! { X86 && W::BYTES > 16 && K > 1 && (K == 2 || size_of::<T>() == 1) => v[0].black_box(), _ => v[0] }.swizzle(place);
        }
        return_if!(
            X86 && K <= Self::LANES && K * size_of::<T>() <= 8,
            *v[0].to_array().as_ref().first_chunk().unwrap()
        );
        array::from_fn(
            #[inline(always)]
            |k| v[k / Self::LANES].to_array().as_ref()[k % Self::LANES],
        )
    }
    /// The lower halves of all groups of so many bytes, first those of `self`, and the upper halves.
    #[op]
    fn halves_of_groups(self, other: Self, bytes: usize) -> [Self; 2] {
        let d = self.tag();
        // One `vshuff64x2` each.
        if const { S::AVX512F && W::BYTES == 64 } && bytes == 32 {
            return live!(S::AVX512F && W::BYTES == 64, {
                let of = always!(|k: usize| {
                    self.as_u128s()
                        .concat_swizzle(
                            other,
                            #[inline(always)]
                            |block| 2 * block + k,
                        )
                        .settled()
                });
                [of(0), of(1)]
            });
        }
        if const { W::BYTES > 32 } && bytes < W::BYTES {
            return live!(W::BYTES > 32, {
                let ([a, b], [c, e]) = (
                    self.lower_half().halves_of_groups(self.upper_half(), bytes),
                    other.lower_half().halves_of_groups(other.upper_half(), bytes),
                );
                [d.combine(c, a), d.combine(e, b)]
            });
        }
        choose! { W::BYTES > 16 => [d.concat_lower_lower(other, self), d.concat_upper_upper(other, self)], _ => unreachable!() }
    }
    /// Within blocks.
    #[on(X86)]
    #[op]
    fn swapped_by(self, step: usize) -> Self {
        return_if!(
            W::BYTES > S::REGISTER && W::BYTES > 16,
            self.tag().combine(self.upper_half().swapped_by(step), self.lower_half().swapped_by(step))
        );
        self.swizzle(
            #[inline(always)]
            |i| i ^ step,
        )
    }
}
