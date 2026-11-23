//! Counts of bits.

use crate::multiply::fns;
use crate::raw::Raw;
use crate::{B8, Int, Isa, Simd, Width};

impl<S: Isa, W: Width> Simd<u32, W, S> {
    /// As `f32`, whose exponent tells where the highest bit is.
    #[op]
    fn float_bits(self) -> Self {
        self.tag().repartition::<f32>().convert_to(self.cast_signed()).bitcast()
    }
}

impl<S: Isa, W: Width> Simd<u16, W, S> {
    #[on(X86 WASM)]
    #[op]
    fn exponents(self) -> Self {
        return_if!(
            2 * W::BYTES <= S::REGISTER,
            self.tag().demote_to((self.s.fixed::<u32, W::Twice>().promote_to(self).float_bits() >> 23).cast_signed())
        );
        let v = self.bitcast::<u32>();
        ((v >> 16).float_bits() >> 7).bitcast().odd_even(((v & 0xffff).float_bits() >> 23).bitcast())
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// The less of what the two halves of a byte say. `none` is for zero.
    #[on(X86)]
    #[op]
    fn zeros<const LEADING: bool>(self, none: u8) -> Self {
        // The number of the one bit that is left.
        return_if!(
            S::GFNI && !LEADING,
            (self & (0 - self)).galois_affine(0xaacc_f000_0000_0000 | 0xff << (56 - 8 * none.ilog2())) ^ none
        );
        let table = always!(|more: u8| {
            self.tag().from_fn(
                #[inline(always)]
                |i| match i as u8 % 16 {
                    0 => none,
                    i => more + if LEADING { i.leading_zeros() - 4 } else { i.trailing_zeros() } as u8,
                },
            )
        });
        choose! {
            LEADING => table(0).table_lookup_bytes(self >> 4).simd_min(table(4).table_lookup_bytes(self)),
            _ => table(4).table_lookup_bytes(self >> 4).simd_min(table(0).table_lookup_bytes(self & 15)),
        }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    const NIBBLES: bool = S::SSE41 && W::BYTES >= 16 && W::BYTES <= 64;
    const X86: bool = S::SSE2;
    /// LLVM would widen the lanes.
    const TINY: bool = S::NEON && W::BYTES < 8 && T::BITS < 32;
    const LZCNT: bool = S::AVX512CD;

    fns! {
        /// The absolute difference, which is unsigned as in `std`. For floating-point numbers it is `(a - b).abs()`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x2::from([10, 200]).abs_diff([20, 100]), [10, 100]);
        /// assert_eq!(i8x2::from([-128, 1]).abs_diff([127, 3]), [255u8, 2]);
        /// # } example()
        /// ```
        #[doc(alias("AbsDiff"))]
        fn abs_diff(self, other: impl crate::Operand<T, W, S>) -> Simd<T::Unsigned, W, S> { self.distance(other).cast_unsigned() }
        /// The number of bits that are set. `PopulationCount`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = u16x2::from([0b1011_0000, 0]);
        /// assert_eq!(v.count_ones(), [3, 0]);
        /// assert_eq!((v.leading_zeros().to_array(), v.trailing_zeros().to_array()), ([8, 16], [4, 16]));
        /// # } example()
        /// ```
        #[doc(alias("population_count", "PopulationCount", "popcnt", "popcount"))]
        fn count_ones(self) -> Self {
            choose! { |this: Self = self|
                Self::TINY => this.tag().resize_any(this.s.fixed::<T, B8>().resize_any(this).count_ones()),
                S::GFNI && S::AVX2 && !S::AVX512VL && Self::NIBBLES && T::BITS == 8 => {
                    let (v, table) = (this.bitcast::<u8>(), this.tag().repartition::<u8>().dup128([0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]));
                    (table.table_lookup_bytes(v & 15) + table.table_lookup_bytes(v >> 4)).bitcast()
                },
                S::GFNI && S::AVX2 && !S::AVX512VL && Self::NIBBLES && T::BITS == 64 => this.bitcast::<u8>().count_ones().sums_of_8().bitcast(),
                Self::X86 && T::BITS == 16 && !const { S::AVX512BITALG } => this.bitcast::<u8>().count_ones().sums_of_2().bitcast(),
                Self::X86 && T::BITS == 32 && !const { S::AVX512VPOPCNTDQ } =>
                    this.bitcast::<u16>().count_ones().cast_signed().sums_of_2().bitcast(),
                S::A64 && S::HAS_DOT && T::BITS == 32 => this.bitcast::<u8>().count_ones().sums_of_4().bitcast(),
                S::A64 && S::HAS_DOT && T::BITS == 64 && W::BYTES >= 16 => this.bitcast::<u8>().count_ones().sums_of_4().sums_of_2().bitcast(),
                _ => this.with(this.raw.count_ones()),
            }
        }
        /// The number of zeros above the highest bit that is set. Before `avx512`, x86 takes 5 to 20 instructions. `LeadingZeroCount`.
        #[doc(alias("leading_zero_count", "LeadingZeroCount"))]
        fn leading_zeros(self) -> Self {
            choose! { |this: Self = self|
                Self::TINY => this.tag().resize_any(this.s.fixed::<T, B8>().resize_any(this).leading_zeros()),
                crate::X86 && Self::NIBBLES && T::BITS == 8 && !S::AVX512BITALG => this.bitcast::<u8>().zeros::<true>(8).bitcast(),
                crate::X86 && Self::NIBBLES && T::BITS == 16 && !Self::LZCNT => {
                    let each = this.bitcast::<u8>().zeros::<true>(16);
                    (each.bitcast::<u16>() >> 8).bitcast::<u8>().simd_min(each + 8).bitcast()
                },
                Self::LZCNT && T::BITS == 16 && W::BYTES == 16 => (this.bitcast::<u16>().cast::<u32>().leading_zeros().cast::<u16>() - 16).resize::<W>().bitcast(),
                Self::LZCNT && T::BITS == 16 && W::BYTES <= 8 => {
                    let wide = this.s.fixed::<i32, W::Twice>().promote_to(this.bitcast::<u16>());
                    (this.tag().repartition::<i16>().demote_to(wide.leading_zeros()) - 16).bitcast()
                },
                S::AVX512BITALG && T::BITS == 16 => this.reverse_bits().trailing_zeros(),
                Self::LZCNT && T::BITS == 16 => {
                    let v = this.bitcast::<u32>();
                    ((v | 0x8000).leading_zeros() << 16 | (v << 16 | 0x8000).leading_zeros()).bitcast()
                },
                (Self::X86 || S::WASM) && T::BITS == 16 => (142 - this.bitcast::<u16>().exponents()).cast_signed().simd_min(16).bitcast(),
                (Self::X86 || S::WASM) && !Self::LZCNT && T::BITS == 32 => {
                    // With a zero among the highest bits, rounding doesn't carry into the exponent.
                    let v = this.bitcast::<u32>();
                    let exponent = (v >> 8).and_not(v).float_bits() >> 23;
                    v.tag().set(158).bitcast::<u16>().saturating_sub(exponent.bitcast()).cast_signed().simd_min(32).bitcast()
                },
                T::BITS == 64 && (Self::X86 && !Self::LZCNT || S::NEON && !S::SVE || S::WASM) => {
                    let halves = this.bitcast::<u32>().leading_zeros();
                    let lower = halves.bitcast::<u64>() & halves.simd_eq(32).to_vector().bitcast::<u64>() >> 32;
                    ((halves.bitcast::<u64>() >> 32) + lower).bitcast()
                },
                _ => this.with(this.raw.leading_zeros()),
            }
        }
        /// The number of zeros below the lowest bit that is set. `TrailingZeroCount`.
        #[doc(alias("trailing_zero_count", "TrailingZeroCount"))]
        fn trailing_zeros(self) -> Self {
            choose! { |this: Self = self|
                Self::TINY => this.tag().resize_any(this.s.fixed::<T, B8>().resize_any(this).trailing_zeros()),
                crate::X86 && Self::NIBBLES && T::BITS == 8 && !S::AVX512BITALG => this.bitcast::<u8>().zeros::<false>(8).bitcast(),
                crate::X86 && Self::NIBBLES && T::BITS == 16 && !S::AVX512BITALG => {
                    let each = this.bitcast::<u8>().zeros::<false>(16);
                    ((each + 8).bitcast::<u16>() >> 8).bitcast::<u8>().simd_min(each).bitcast()
                },
                Self::X86 && (!Self::LZCNT || W::BYTES <= 8) && T::BITS == 16 => {
                    let v = this.bitcast::<u16>();
                    ((v & (0 - v)).exponents() - 127).simd_min(16).bitcast()
                },
                Self::X86 && !Self::LZCNT && T::BITS >= 32 => {
                    // In the lowest byte, which doesn't have the sign.
                    let (v, of) = (this.bitcast::<u32>(), always!(|n: u64| this.tag().set(T::from_u64(n)).bitcast::<u8>()));
                    let each = ((v & (0 - v)).float_bits() >> 23).bitcast::<u8>() - of((127 - 32) << 32 | 127);
                    choose! { T::BITS == 32 => each, _ => each.simd_min((each.bitcast::<u64>() >> 32).bitcast()) }.simd_min(of(T::BITS as u64)).bitcast()
                },
                _ => this.with(this.raw.trailing_zeros()),
            }
        }
    }
}
