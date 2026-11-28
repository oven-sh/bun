//! Products and sums in wider lanes.

use crate::f16;
use crate::{InBlocks, Int, Isa, Lane, Operand, Simd, Tag, Width, X86};
use core::ops::{Add, AddAssign};

type V<S, T, W> = Simd<T, W, S>;
use crate::bf16;

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// The sums of two adjacent products, with saturation. `U` is `i16`, and can be left out.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from([1, 2, 255, 255]).saturating_dot(i8x4::from([10, -1, 127, 127])), [8, i16::MAX]);
    /// assert_eq!(u8x4::splat(3).saturating_dot::<i16>(2), 12);
    /// # } example()
    /// ```
    #[doc(alias("sat_widen_mul_pairwise_add", "SatWidenMulPairwiseAdd", "pmaddubsw", "maddubs"))]
    #[op]
    #[track_caller]
    pub fn saturating_dot<U>(self, other: impl Operand<i8, W, S>) -> V<S, i16, W>
    where
        i16: crate::lane::Is<U>,
    {
        let other = other.vector(Tag::new(self.s));
        if const { S::A64 && W::BYTES >= 8 } && other.known_positive() && other.known_small() && !other.are_shifts() {
            return live!(S::A64 && W::BYTES >= 8, self.widen_mul_pairwise_add(other.cast_unsigned()).cast_signed());
        }
        self.saturating_dot_i8(other)
    }
    /// `dot_add` of `i8`, which is shorter for some constants.
    #[op]
    #[track_caller]
    fn dot_by_signed(self, other: V<S, i8, W>, sum: impl Operand<i32, W, S>) -> V<S, i32, W> {
        let sum = sum.vector(Tag::new(self.s));
        if const { (S::SSSE3 || S::ARM && !S::HAS_DOT) && !S::HAS_DOT_U8_I8 && W::BYTES >= 4 } && other.known_small() {
            return live!((S::SSSE3 || S::ARM) && W::BYTES >= 4, sum + self.saturating_dot(other).sums_of_2());
        }
        if const { S::ARM && !S::HAS_DOT_U8_I8 && W::BYTES >= 4 } && other.known_positive() {
            return live!(
                S::ARM && !S::HAS_DOT_U8_I8 && W::BYTES >= 4,
                self.sum_of_mul_quad_accumulate(other.cast_unsigned(), sum.cast_unsigned()).cast_signed()
            );
        }
        self.sum_of_mul_quad_accumulate_i8(other, sum)
    }
}

/// The products that can be summed into lanes of `U`: see [`dot`](Simd::dot).
#[diagnostic::on_unimplemented(
    message = "products of `{Self}` can't be summed into `{U}`",
    note = "the sums are twice or four times as wide, up to 64 bits, with the same sign. `u8` times `i8` goes into `i32`, or by `saturating_dot` into `i16`"
)]
pub trait Dot<U: Lane>: Lane {
    /// The type of the second factor.
    type Other: Lane;
    #[doc(hidden)]
    fn products<S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self::Other, W>) -> V<S, U, W>;
    #[doc(hidden)]
    fn products_to<S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self::Other, W>, sum: V<S, U, W>) -> V<S, U, W>;
}
/// The second factor of [`dot`](Simd::dot): an [`Operand`] of the lanes [`Dot::Other`].
#[diagnostic::on_unimplemented(
    message = "`{Self}` can't be the factor of `{T}` for sums of `{U}`",
    note = "rustc takes a bare number for `i32`. Name the type of the sums, as in `dot::<i32>(..)` or `dot::<u32>(..)`",
    note = "a factor is a `{T}`, an array of as many lanes, or a vector of the same type. For `u8` into `i32`, it is of `i8`, and in generic code of `T::Other`",
    note = "other lanes: `bitcast` or `cast`. Another width: `resize`, `split` or `concat`. A shorter array: `repeat(&array)`. A mask: `to_simd`"
)]
pub trait Factor<T: Dot<U>, U: Lane, W: Width, S: Isa>: Operand<T::Other, W, S> {}
#[diagnostic::do_not_recommend]
impl<T: Dot<U>, U: Lane, W: Width, S: Isa, X: Operand<T::Other, W, S>> Factor<T, U, W, S> for X {}
macro_rules! dots { ($($t:ident $other:ident $u:ident, |$a:ident, $b:ident, $sum:ident| $dot:expr, $add:expr;)*) => {$(
    impl Dot<$u> for $t {
        type Other = $other;
        #[op]
        #[track_caller]
        fn products<S: Isa, W: Width>($a: V<S, $t, W>, $b: V<S, $other, W>) -> V<S, $u, W> { $dot }
        #[op]
        #[track_caller]
        fn products_to<S: Isa, W: Width>($a: V<S, $t, W>, $b: V<S, $other, W>, $sum: V<S, $u, W>) -> V<S, $u, W> { $add }
    }
)*}; }
macro_rules! pairs { ($($t:ident $u:ident)*) => { dots! {$(
    $t $t $u, |a, b, sum| match a.exact_pairs(b) { Some(pairs) => pairs.bitcast(), None => a.widen_mul_pairwise_add(b) },
        match a.exact_pairs(b) { Some(pairs) => sum + pairs.bitcast::<$u>(), None => a.widen_mul_pairwise_add_to(b, sum) };
)*} }; }
macro_rules! quads { ($($t:ident $other:ident $u:ident $f:ident)*) => { dots! {$(
    $t $other $u, |a, b, sum| a.$f(b, 0 as $u), a.$f(b, sum);
)*} }; }
pairs!(u8 u16 i8 i16 u16 u32 i16 i32 u32 u64 i32 i64);
// A product of two `f16` is exact in `f32`.
dots! {
    f16 f16 f32, |a, b, sum| Dot::products_to(a, b, a.tag().repartition().sign_bit()),
        if const { S::FHM && W::BYTES >= 16 } {
            let (x, y) = (a.swizzle_groups([0, 2, 4, 6, 1, 3, 5, 7]).bytes(), b.swizzle_groups([0, 2, 4, 6, 1, 3, 5, 7]).bytes());
            a.with_bytes(a.s.wide_mul_add_f16::<W>(x, y, a.s.wide_mul_add_f16::<W>(x, y, sum.bytes(), true), false))
        } else {
            let ([a, c], [b, d]) = (a.widen::<f32>(), b.widen::<f32>()); let [even, odd] = (a * b).deinterleave(c * d); sum + odd + even
        };
    bf16 bf16 f32, |a, b, sum| Dot::products_to(a, b, a.tag().repartition().sign_bit()), a.fused_dot(b, sum);
}
quads! {
    u8 u8 u32 sum_of_mul_quad_accumulate i8 i8 i32 sum_of_mul_quad_accumulate u8 i8 i32 dot_by_signed
    u16 u16 u64 sum_of_mul_quad_accumulate i16 i16 i64 sum_of_mul_quad_accumulate
}

/// The bytes whose matrices can be multiplied into lanes of `U`: see [`mat_mul_add`](Simd::mat_mul_add).
#[diagnostic::on_unimplemented(
    message = "matrices of `{Self}` can't be multiplied into `{U}`",
    note = "this is for `i8` into `i32`, and `u8` into `u32` or, times `i8`, `i32`"
)]
pub trait MatMul<U: Lane>: Dot<U> {
    #[doc(hidden)]
    fn mat_mul_add<S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self::Other, W>, sum: V<S, U, W>) -> V<S, U, W>;
}
macro_rules! mat_muls { ($($t:ident $u:ident $f:ident)*) => {$(
    impl MatMul<$u> for $t {
        #[op]
        #[track_caller]
        fn mat_mul_add<S: Isa, W: Width>(a: V<S, $t, W>, b: V<S, Self::Other, W>, sum: V<S, $u, W>) -> V<S, $u, W> { a.$f(b, sum) }
    }
)*}; }
mat_muls!(i8 i32 mat_mul_accumulate u8 u32 mat_mul_accumulate u8 i32 mat_mul_accumulate_i8);

/// The lanes that can be summed into lanes of `U`: see [`sum_groups`](Simd::sum_groups).
#[diagnostic::on_unimplemented(
    message = "lanes of `{Self}` can't be summed into `{U}`",
    note = "the sums are wider, and of the same kind: unsigned, signed or floating-point"
)]
pub trait SumGroups<U: Lane>: Lane {
    #[doc(hidden)]
    fn sum_groups<S: Isa, W: Width>(v: V<S, Self, W>) -> V<S, U, W>;
    #[doc(hidden)]
    fn abs_diff_sum<S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self, W>) -> V<S, U, W>;
}
macro_rules! sums { ($($f:ident: $($t:ident $u:ident),+ |$a:ident, $b:ident| $differences:expr;)*) => {$($(
    impl SumGroups<$u> for $t {
        #[op]
        #[track_caller]
        fn sum_groups<S: Isa, W: Width>(v: V<S, $t, W>) -> V<S, $u, W> { v.$f() }
        #[op]
        #[track_caller]
        fn abs_diff_sum<S: Isa, W: Width>($a: V<S, $t, W>, $b: V<S, $t, W>) -> V<S, $u, W> { $differences }
    }
)+)*}; }
sums! {
    same: u64 u64, i64 i64 |a, b| a.abs_diff(b).bitcast();
    same: f64 f64 |a, b| a.distance(b);
    sums_of_2: u8 u16, i8 i16, u16 u32, i16 i32, u32 u64, i32 i64 |a, b| a.abs_diff(b).sums_of_2().bitcast();
    sums_of_2: f32 f64 |a, b| a.distance(b).sums_of_2();
    sums_of_2: f16 f32, bf16 f32 |a, b| a.distance(b).sums_of_2();
    sums_of_4: u8 u32, i8 i32, u16 u64, i16 i64 |a, b| a.abs_diff(b).sums_of_4().bitcast();
    sums_of_8: u8 u64, i8 i64 |a, b| a.sums_of_8_abs_diff(b);
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// Multiplies the lanes, and sums as many adjacent products as a lane of `U` is wide: two of integers up to 32 bits, `f16` and `bf16`, or four of 8 and 16 bits. The sums wrap.
    /// The second factor is of the same type, but for `u8` into `i32`, where it is `i8`.
    ///
    /// On x86, `i16` into `i32` is one instruction, and into `i64`, which can't overflow, six. `u8` into `i32` is one if `has!(vnni)`, and `u8` by `u8` goes into `u32`.
    /// Bytes take one or two if the second factor is a small constant.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = i16x4::from([1, 2, 3, 4]);
    /// assert_eq!(v.dot::<i32>([10, 1, 10, 1]).to_array(), [12, 34]);
    /// assert_eq!(v.dot::<i64>(2).to_array(), [20]);
    /// # } example()
    /// ```
    #[doc(alias("WidenMulPairwiseAdd", "widen_mul_pairwise_add", "madd", "pmaddwd", "dot2", "dot4"))]
    #[op]
    #[track_caller]
    pub fn dot<U: Lane>(self, other: impl Factor<T, U, W, S>) -> V<S, U, W>
    where
        T: Dot<U>,
    {
        T::products(self, Tag::new(self.s).factor(other))
    }
    /// `sum + self.dot(other)`. Of `f16` or `bf16` into `f32`, the product of the odd lanes is added first, and each step rounds once.
    /// Of `i16` into `i32` it is two instructions on x86, and [`dot_add_relaxed`](Simd::dot_add_relaxed) one if `has!(vnni)`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (pixels, weights) = (u8x8::from([1, 2, 3, 4, 200, 200, 200, 200]), i8x8::splat(-2));
    /// assert_eq!(pixels.dot_add::<i32>(weights, [100, 0]), [80, -1600]);
    /// # } example()
    /// ```
    #[doc(alias(
        "SumOfMulQuadAccumulate",
        "sum_of_mul_quad_accumulate",
        "vpdpbusd",
        "sdot",
        "udot",
        "usdot",
        "dot2_add",
        "dot4_add"
    ))]
    #[op]
    #[track_caller]
    pub fn dot_add<U: Lane>(self, other: impl Factor<T, U, W, S>, sum: impl Operand<U, W, S>) -> V<S, U, W>
    where
        T: Dot<U>,
    {
        T::products_to(self, Tag::new(self.s).factor(other), sum.vector(Tag::new(self.s)))
    }
    /// In each block: `self` has two rows of eight bytes, `other` two columns of eight, and their product is added to the
    /// two rows of two in `sum`. Where it is one instruction, that does twice the work of [`dot_add`](Self::dot_add).
    /// Elsewhere that is faster.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let (rows, columns) = (i8x8::splat(1).concat(i8x8::splat(2)), i8x8::splat(10).concat(i8x8::iota(0)));
    /// assert_eq!(rows.mat_mul_add::<i32>(columns, 0), [80, 28, 160, 56]);
    /// # } example()
    /// ```
    #[doc(alias("mat_mul_accumulate", "smmla", "ummla", "usmmla"))]
    #[op]
    #[track_caller]
    pub fn mat_mul_add<U: Lane>(self, other: impl Factor<T, U, W, S>, sum: impl Operand<U, W, S>) -> V<S, U, W>
    where
        T: MatMul<U>,
    {
        T::mat_mul_add(self, other.vector(Tag::new(self.s)), sum.vector(Tag::new(self.s)))
    }
    /// The sums of as many adjacent lanes as a lane of `U` is wide. For generic code, lanes of 64 bits go into themselves.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u8x8::splat(200);
    /// assert_eq!((v.sum_groups::<u16>().to_array(), v.sum_groups::<u64>().to_array()), ([400; 4], [1600]));
    /// # } example()
    /// ```
    #[doc(alias("SumsOf2", "SumsOf4", "SumsOf8", "sums_of_2", "sums_of_4", "sums_of_8", "uaddlp", "saddlp"))]
    #[inline(always)]
    #[track_caller]
    pub fn sum_groups<U: Lane>(self) -> V<S, U, W>
    where
        T: SumGroups<U>,
    {
        T::sum_groups(self)
    }
    /// [`sum_groups`](Self::sum_groups) of the absolute differences.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x8::iota(0).abs_diff_sum::<u64>(4), [16]);
    /// # } example()
    /// ```
    #[doc(alias("SumsOf8AbsDiff", "sums_of_8_abs_diff", "sad", "sad8", "psadbw"))]
    #[op]
    #[track_caller]
    pub fn abs_diff_sum<U: Lane>(self, other: impl Operand<T, W, S>) -> V<S, U, W>
    where
        T: SumGroups<U>,
    {
        T::abs_diff_sum(self, self.like(other))
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// The products, twice as wide: those of the lower halves, and those of the upper halves.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [lo, hi] = u8x4::from([1, 2, 100, 255]).widening_mul(255);
    /// assert_eq!((lo.to_array(), hi.to_array()), ([255, 510], [25500, 65025]));
    /// # } example()
    /// ```
    #[doc(alias("smull", "umull", "smull2"))]
    #[op]
    #[track_caller]
    pub fn widening_mul<U>(self, other: impl Operand<T, W, S>) -> [V<S, T::Wide, W>; 2]
    where
        T::Wide: crate::lane::Is<U>,
    {
        let other = self.tag().factor(other);
        if const { S::SSE2 && S::REGISTER < 64 && T::BITS == 16 && W::BYTES >= S::REGISTER && !(T::IS_SIGNED && S::AVX2) }
            && !are_known!(other.raw)
        {
            let [lower, upper] = (self * other).interleave(self.mul_high_16(other));
            return [lower.bitcast(), upper.bitcast()];
        }
        self.mul_halves(other).into()
    }
    /// Adds [`widening_mul`](Self::widening_mul) to `sums`.
    #[doc(alias("WidenMulAccumulate", "widen_mul_accumulate", "smlal", "umlal"))]
    #[op]
    #[track_caller]
    pub fn widening_mul_add<U>(self, other: impl Operand<T, W, S>, sums: [V<S, T::Wide, W>; 2]) -> [V<S, T::Wide, W>; 2]
    where
        T::Wide: crate::lane::Is<U>,
    {
        let other = self.tag().factor(other);
        self.widen_mul_accumulate(other, sums[0], sums[1]).into()
    }
    /// `self.cast::<U>() * other.cast::<U>()` for a `U` that is twice as wide, in the form in which LLVM finds `smull`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u8x4::from([1, 2, 100, 255]).cast_mul::<u16>(255), [255, 510, 25500, 65025]);
    /// # } example()
    /// ```
    #[doc(alias("widen_mul"))]
    #[op]
    #[track_caller]
    pub fn cast_mul<U: Int>(self, other: impl Operand<T, W, S>) -> V<S, U, W::Twice> {
        require!("there is no vector of more than 512 bytes", W::BYTES < 512);
        const { crate::make::Fits::<0, (T, U)>::TWICE };
        let half = self.s.fixed::<T, <W::Twice as Width>::Half>();
        self.s.fixed().widen_mul(half.resize_bitcast(self), half.resize_bitcast(self.tag().factor(other)))
    }
}

impl<S: Isa, W: Width> Simd<i16, W, S> {
    /// `sum + 2 * self * other` with saturation: the product of two Q15 numbers is added to a Q31 number. The product
    /// saturates first.
    #[doc(alias("SatWidenMulAccumFixedPoint", "sat_widen_mul_accum_fixed_point", "sqdmlal"))]
    #[op]
    #[track_caller]
    pub fn cast_mul_q15_add(
        self,
        other: impl Operand<i16, W, S>,
        sum: impl Operand<i32, W::Twice, S>,
    ) -> V<S, i32, W::Twice> {
        require!("there is no vector of more than 512 bytes", W::BYTES < 512);
        let (d, half) = (self.s.fixed(), self.s.fixed::<i16, <W::Twice as Width>::Half>());
        d.sat_widen_mul_accum_fixed_point(
            half.resize_bitcast(self),
            half.resize_bitcast(self.tag().factor(other)),
            sum.vector(d),
        )
    }
}

impl<S: Isa, W: Width> InBlocks<i16, W, S> {
    /// Adds `self * j + other * k` to `sums`, which are in the order of [`widen`](Self::widen), so that
    /// [`saturating_narrow`](Self::saturating_narrow) leads back. The sums wrap.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [lo, hi] = i16x16::iota(0).in_blocks().weighted_add(1000, [300, -2], [i32x8::splat(2000); 2]);
    /// assert_eq!((lo / 300).in_blocks().saturating_narrow::<i16>(hi / 300), i16x16::iota(0));
    /// # } example()
    /// ```
    #[doc(alias("butterfly", "blend", "convolve"))]
    #[op]
    pub fn weighted_add(
        self,
        other: impl Operand<i16, W, S>,
        [j, k]: [impl Operand<i16, W, S>; 2],
        sums: [V<S, i32, W>; 2],
    ) -> [V<S, i32, W>; 2] {
        let (a, d) = (self.0, self.0.tag());
        if let (Some(j), Some(k)) = (Operand::number(j), Operand::number(k)) {
            return_if!(S::SSE2 || S::WASM, weigh_pairs(self.interleave(other), [d.load_dup(&[j, k]); 2], sums));
            return weigh([a, a.like(other)], each(d, j, k), sums);
        }
        weigh([a, a.like(other)], [d.factor(j), d.factor(k)], sums)
    }
}

impl<S: Isa, W: Width> InBlocks<u8, W, S> {
    /// The same for bytes, in the order of widening twice.
    #[op]
    pub fn weighted_add(
        self,
        other: impl Operand<u8, W, S>,
        [j, k]: [i16; 2],
        [p, q, r, s]: [V<S, i32, W>; 4],
    ) -> [V<S, i32, W>; 4] {
        let other = self.0.like(other);
        let ([p, q], [r, s]) = choose! {
            S::SSE2 || S::WASM => {
                let ([lower, upper], by) = (self.interleave(other), [self.0.tag().repartition().load_dup(&[j, k]); 2]);
                (weigh_pairs(lower.in_blocks().widen(), by, [p, q]), weigh_pairs(upper.in_blocks().widen(), by, [r, s]))
            },
            _ => {
                let ([a, b], [c, d]) = (self.widen::<i16>(), other.in_blocks().widen::<i16>());
                let by = each(a.tag(), j, k);
                (weigh([a, c], by, [p, q]), weigh([b, d], by, [r, s]))
            },
        };
        [p, q, r, s]
    }
}

#[op]
fn weigh_pairs<W: Width, S: Isa>(
    pairs: [V<S, i16, W>; 2],
    by: [V<S, i16, W>; 2],
    sums: [V<S, i32, W>; 2],
) -> [V<S, i32, W>; 2] {
    [pairs[0].dot_add(by[0], sums[0]), pairs[1].dot_add(by[1], sums[1])]
}
/// On Arm from one register, for products by a lane.
#[op]
fn each<W: Width, S: Isa>(d: Tag<S, i16, W>, j: i16, k: i16) -> [V<S, i16, W>; 2] {
    return_if!(S::A64 && crate::OPTIMIZED, {
        let both = d.simd().fixed::<i16, crate::B16>().load_dup(&[j, k]).hidden_unless_known();
        [d.set(both[0]), d.set(both[1])]
    });
    [d.set(j), d.set(k)]
}
#[op]
fn weigh<W: Width, S: Isa>(
    [a, b]: [V<S, i16, W>; 2],
    [j, k]: [V<S, i16, W>; 2],
    sums: [V<S, i32, W>; 2],
) -> [V<S, i32, W>; 2] {
    return_if!(S::SSE2 || S::WASM, weigh_pairs(a.in_blocks().interleave(b), j.in_blocks().interleave(k), sums));
    halves_if!(W::BYTES > 16, |a: V<S, i16, W> = a, rest: [V<S, i16, W>; 3] = ([b, j, k]), sums: [V<S, i32, W>; 2] = sums| {
        let [b, j, k] = rest;
        let [p, q] = weigh([a.lower_half(), b.lower_half()], [j.lower_half(), k.lower_half()], [sums[0].lower_half(), sums[1].lower_half()]);
        let [r, s] = weigh([a.upper_half(), b.upper_half()], [j.upper_half(), k.upper_half()], [sums[0].upper_half(), sums[1].upper_half()]);
        [sums[0].tag().combine(r, p), sums[0].tag().combine(s, q)]
    });
    let (lower, upper) = a.widen_mul_accumulate(j, sums[0], sums[1]);
    b.widen_mul_accumulate(k, lower, upper).into()
}

macro_rules! sliding { ($($t:ident $u:ident)*) => {$(
    impl<S: Isa, W: Width> InBlocks<$t, W, S> {
        /// Lane `i` is the sum of the absolute differences of the four bytes of `self` from `4 * A + i` on and those of
        /// `other` from `4 * B` on.
        #[doc(alias("SumsOfAdjQuadAbsDiff", "sums_of_adj_quad_abs_diff", "mpsadbw", "sad4_adjacent"))]
        #[op]
        #[track_caller]
        pub fn sliding_abs_diff_sum<const A: usize, const B: usize>(self, other: impl Operand<$t, W, S>) -> V<S, $u, W> {
            const { assert!(A < 2 && B < 4, "this takes `A < 2` and `B < 4`") };
            self.0.sums_of_adj_quad_abs_diff::<A, B>(self.0.like(other))
        }
        /// Puts the groups of four bytes of `self` in the order that each two bits of `ORDER` give. Then lane `i` is the sum of
        /// the absolute differences of its four bytes from `i / 4 * 8 + i % 4` on and those of `other` from `i / 2 * 4` on.
        #[doc(alias("SumsOfShuffledQuadAbsDiff", "sums_of_shuffled_quad_abs_diff", "dbpsadbw", "sad4_shuffled"))]
        #[op]
        pub fn shuffled_abs_diff_sum<const ORDER: usize>(self, other: impl Operand<$t, W, S>) -> V<S, $u, W> {
            self.0.sums_of_shuffled_quad_abs_diff::<ORDER>(self.0.like(other))
        }
    }
)*}; }
sliding!(u8 u16 i8 i16);

/// Sums of [`dot`](Simd::dot) into lanes that are twice as wide, in the form that the target adds fastest.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut sums = PairSums::new();
/// sums.mul_add(i16x4::from([1, 2, 3, 4]), [10, 1, 10, 1]);
/// sums.mul_add(i16x4::splat(1), 100);
/// assert_eq!(sums.total().to_array(), [212, 234]);
/// # } example()
/// ```
#[doc(alias("ReorderWidenMulAccumulate", "reorder_widen_mul_accumulate", "RearrangeToOddPlusEven", "DotSum"))]
pub struct PairSums<T: Int, W: Width, S: Isa>([V<S, T::Wide, W>; 2]);

impl<T: Int, W: Width, S: Isa> PairSums<T, W, S> {
    #[op]
    #[track_caller]
    pub(crate) fn on(s: S) -> Self {
        Self([s.fixed().zero(); 2])
    }
    /// The sums start at `total`.
    #[op]
    pub fn starting_at(total: V<S, T::Wide, W>) -> Self {
        let zero = total.tag().zero();
        Self(choose! {
            !S::ARM || V::<S, T::Wide, W>::LANES == 1 => [total, zero],
            _ => [total.interleave_whole_lower(zero), total.interleave_whole_upper(zero)],
        })
    }
    /// Adds `a.dot(b)`. The sums wrap.
    #[op]
    #[track_caller]
    pub fn mul_add(&mut self, a: V<S, T, W>, b: impl Operand<T, W, S>) {
        self.0 = a.reorder_widen_mul_accumulate(a.tag().factor(b), self.0[0], self.0[1]).into();
    }
    /// Lane `i` has the products of the lanes `2 * i` and `2 * i + 1`.
    #[op]
    pub fn total(self) -> V<S, T::Wide, W> {
        choose! { V::<S, T::Wide, W>::LANES == 1 => self.0[0] + self.0[1], _ => self.0[0].rearrange_to_odd_plus_even(self.0[1]) }
    }
    /// `total().reduce_sum()`.
    #[op]
    pub fn reduce_sum(self) -> T::Wide {
        (self.0[0] + self.0[1]).reduce_sum()
    }
}
impl<T: Int, W: Width, S: Isa> Add for PairSums<T, W, S> {
    type Output = Self;
    #[op]
    fn add(self, other: Self) -> Self {
        Self([self.0[0] + other.0[0], self.0[1] + other.0[1]])
    }
}

/// Sums of absolute differences of bytes, in the form that the target adds fastest: `psadbw` and an addition, or `uabd` and
/// `uadalp`. It holds those of 32 pairs of vectors. With more, the results are unspecified.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let mut sums = AbsDiffSums::new();
/// sums.add_abs_diff(u8x16::splat(10), 13);
/// sums.add_abs_diff(u8x16::splat(10), 9);
/// assert_eq!((sums.total().to_array(), sums.reduce_sum()), ([32, 32], 64));
/// # } example()
/// ```
#[doc(alias("reorder_abs_diff_accumulate"))]
pub struct AbsDiffSums<W: Width, S: Isa>(V<S, u16, W>);

impl<W: Width, S: Isa> AbsDiffSums<W, S> {
    #[inline(always)]
    pub(crate) fn on(s: S) -> Self {
        Self(s.fixed().zero())
    }
    /// Adds the differences of `a` and `b`.
    #[op]
    pub fn add_abs_diff(&mut self, a: V<S, u8, W>, b: impl Operand<u8, W, S>) {
        self.0 = a.reorder_abs_diff_accumulate(a.like(b), self.0);
    }
    /// Lane `i` has the differences of the eight lanes from `8 * i` on. It doesn't build if the width is less than 8 bytes.
    #[op]
    #[track_caller]
    pub fn total(self) -> V<S, u64, W> {
        require!("this takes vectors of 8 bytes or more: see `reduce_sum`", W::BYTES >= 8);
        if X86 { self.0.bitcast() } else { self.0.sums_of_4() }
    }
    /// The sum of all differences.
    #[op]
    pub fn reduce_sum(self) -> u32 {
        if const { W::BYTES == 2 || X86 && W::BYTES < 16 } {
            self.0.get_lane() as u32
        } else if X86 {
            self.0.bitcast::<u64>().reduce_sum() as u32
        } else {
            self.0.sums_of_2().reduce_sum()
        }
    }
}
impl<W: Width, S: Isa> Add for AbsDiffSums<W, S> {
    type Output = Self;
    #[inline(always)]
    fn add(self, other: Self) -> Self {
        Self(self.0 + other.0)
    }
}

macro_rules! both { ($([$($g:tt)*] $t:ty;)*) => {$(
    impl<$($g)* W: Width, S: Isa> Copy for $t {}
    impl<$($g)* W: Width, S: Isa> Clone for $t {
        #[inline(always)]
        fn clone(&self) -> Self { *self }
    }
    impl<$($g)* W: Width, S: Isa> AddAssign for $t {
        #[inline(always)]
        fn add_assign(&mut self, other: Self) { *self = *self + other }
    }
)*}; }
both! { [T: Int,] PairSums<T, W, S>; [] AbsDiffSums<W, S>; }
