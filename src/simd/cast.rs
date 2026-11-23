//! Conversions.

use crate::f16;
use crate::lane::Kind;
use crate::pattern as p;
use crate::raw::Raw;
use crate::{
    B2, B4, B8, B16, B32, B64, B128, B256, B512, Float, InBlocks, Int, IntoSimd, Isa, Lane, Scaled, Simd, Tag, Width,
    bf16,
};

macro_rules! makers { ($then:ident $target:ident $S:ty) => { crate::make::$then! { $target;
    /// The reverse of [`split`](crate::Simd::split). It is [`concat`](crate::Simd::concat) for code that is generic over the width of the result.
    from_halves[](halves: [crate::Simd<T, W::Half, $S>; 2]) -> crate::Simd<T, W, $S> = |d| on_x86!(d.combine(halves[1], halves[0]), assembled());
    /// `part(0)`, `part(1)` and so on, as many as fit: for example short rows of an image. It doesn't build if a part is wider than the vector.
    /// For records, take whole steps by `as_chunks`, which need no checks, and clamp the index in the last step only.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let image: Vec<u8> = (0..40).collect();
    /// let rows = Rows::new(&image, 10, 4, 4);
    /// let block = u8x16::from_parts(|y| u8x4::load(rows.row(y)));
    /// assert_eq!(block, [0, 1, 2, 3, 10, 11, 12, 13, 20, 21, 22, 23, 30, 31, 32, 33]);
    /// # } example()
    /// ```
    #[doc(alias("load_rows", "load_strided", "load_blocks"))]
    from_parts[X: crate::Width](part: impl FnMut(usize) -> crate::Simd<T, X, $S>) -> crate::Simd<T, W, $S> = |d| { let mut part = part; on_x86!(d.from_parts(0, &mut part), assembled()) };
} }; }
pub(crate) use makers;

type V<S, T, W> = Simd<T, W, S>;

/// `U` is twice as wide as this lane.
///
/// `T::Wide` and `T::Narrow` always fit. Where they are `T` itself, at 64 and at 8 bits, the operations don't build.
#[diagnostic::on_unimplemented(
    message = "`{U}` is not known to be twice as wide as `{Self}`",
    note = "`cast` and `saturating_cast` convert between all types of lanes"
)]
pub trait Widens<U>: crate::seals::Widens<U> {}
macro_rules! widens { ($($from:ident: $($to:ident)*;)*) => { $($(#[sealed] impl Widens<$to> for $from {})*)* }; }
widens! {
    u8: u8 u16 i16 f16 bf16; i8: i8 u16 i16 f16 bf16; u16: u32 i32 f32; i16: u32 i32 f32; u32: u64 i64 f64; i32: u64 i64 f64; f32: u64 i64 f64;
    f16: u32 i32 f32; bf16: u32 i32 f32;
    u64: u64; i64: i64;
}

const fn float<T: Lane>() -> bool {
    matches!(T::KIND, Kind::Float)
}
const fn signed<T: Lane>() -> bool {
    matches!(T::KIND, Kind::Signed)
}
/// On Neoverse, a conversion to `f32` takes as long as four additions.
const fn by_sum<T: Lane, U: Lane>() -> bool {
    !float::<T>() && float::<U>() && T::BITS < 32 && U::BITS == 32 && crate::OPTIMIZED && !cfg!(target_vendor = "apple")
}
/// Whether what is out of range becomes the smallest integer.
const fn x86<S: Isa>() -> bool {
    S::SSE2
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[op]
    #[track_caller]
    fn scaled<U: Lane>(self) -> Tag<S, U, Scaled<T, U, W>> {
        require!(
            "there is no vector with as many lanes of that type: the widths are 2 to 512 bytes",
            Scaled::<T, U, W>::BYTES / size_of::<U>() == Self::LANES
        );
        Tag::new(self.s)
    }
    /// For types that are the same, but not to the type checker.
    #[op]
    pub(crate) fn same<U: Lane, X: Width>(self) -> V<S, U, X> {
        Tag::new(self.s).resize_bitcast(self)
    }
    /// `as` for each lane: integers wrap, floating-point numbers are rounded toward zero and saturate, and NaN is zero.
    /// The result can take several registers. It doesn't build if that is narrower than 2 bytes, or has more than 64 lanes in more than 512.
    ///
    /// On x86, saturation and NaN take two to four instructions, which [`cast_relaxed`](Self::cast_relaxed) saves. Before `avx512`, floats convert faster to and from `i32` than `u32` and 64 bits.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(i32x4::from([1, -1, 256, 300]).cast::<u8>(), [1, 255, 0, 44]);
    /// assert_eq!(f32x4::from([1.9, -1.0, 1e9, f32::NAN]).cast::<u8>(), [1, 0, 255, 0]);
    /// assert_eq!(u8x16::splat(3).cast::<f32>(), [3.0; 16]);
    /// # } example()
    /// ```
    #[doc(alias(
        "as", "PromoteTo", "ConvertTo", "TruncateTo", "promote_to", "convert_to", "truncate_to", "to_float", "to_int",
        "extend"
    ))]
    #[op]
    #[track_caller]
    pub fn cast<U: Lane>(self) -> V<S, U, Scaled<T, U, W>> {
        let d = self.scaled::<U>();
        let cast = always!(|| {
            choose! { |this: Self = self, d: Tag<S, U, Scaled<T, U, W>> = d|
                Self::HALF || V::<S, U, W>::HALF => d.cast_half(this),
                S::AVX512F && float::<T>() && Self::by_u32::<U>() => d.demote(this.cast::<u32>()),
                x86::<S>() && float::<T>() && !float::<U>() && T::BITS == 32 && U::BITS < 32 => d.demote(this.bitcast::<f32>().packable::<U>().cast_relaxed::<i32>()),
                x86::<S>() && float::<T>() && !float::<U>() && !signed::<U>() && U::BITS < 32 => {
                    let v = this.bitcast::<f64>();
                    d.demote(v.tag().set(65536.0).lesser(v).cast_relaxed::<i32>())
                },
                float::<T>() && !float::<U>() && U::BITS < 32 => d.demote(this.cast::<i32>()),
                S::A64 && by_sum::<T, U>() && Self::LANES >= 4 && (T::BITS > 8 || W::BYTES < 8) => d.of_small(this),
                // From bytes, LLVM widens each quarter on its own, but in the first block of a loop.
                S::A64 && cfg!(target_endian = "little") && float::<U>() && U::BITS == 32 && T::BITS == 8 && W::BYTES >= 8 => d.of_bytes(this),
                S::A64 && float::<U>() && T::BITS == 8 && W::BYTES >= 8 => {
                    let wide = this.cast::<i16>();
                    d.promote_or_convert(wide.tag().opaque(wide.raw).cast::<i32>())
                },
                // In one step, the parts come from memory.
                x86::<S>() && S::SSE41 && S::REGISTER <= 32 && !float::<T>() && float::<U>() && T::BITS < 32 && U::BITS == 32 => d.promote(this),
                !float::<T>() && float::<U>() && T::BITS < 32 => d.promote_or_convert(this.cast::<i32>()),
                T::BITS < U::BITS => d.promote(this),
                T::BITS == U::BITS => d.convert(this.same::<T, _>()),
                float::<T>() || float::<U>() => d.demote(this),
                // One step puts the lanes in order.
                x86::<S>() && S::REGISTER >= 32 && !S::AVX512VBMI && T::BITS == 32 && U::BITS == 8 && W::BYTES > 64 => d.repartition::<u8>().demote(this.bitcast::<i32>() & 0xff).bitcast(),
                // One shuffle for two registers.
                S::AVX512VBMI && T::BITS == 32 && U::BITS == 8 && W::BYTES == 256 => {
                    let half = always!(|v: V<S, T, W::Half>| {
                        let v = v.bitcast::<U>();
                        v.lower_half().of_two(v.upper_half(), always!(|i: usize| i % (Self::LANES / 2) * 4))
                    });
                    half(this.lower_half()).blend_words(half(this.upper_half()), 0xf0).same()
                },
                W::BYTES > 64 => {
                    let [lower, upper] = this.cast_unsigned().parts::<W>();
                    lower.tag().repartition::<W::NarrowIfWide<T::Unsigned>>().truncate2(lower, upper).cast::<U>().same()
                },
                _ => d.cast(this),
            }
        });
        // Apart, narrow results take more on NEON.
        choose! { crate::X86 => apart!(self.s, cast()), _ => apart_unoptimized!(self.s, { cast() }) }
    }
    /// Whether floats go to `U` by the instructions of AVX-512 that narrow one register. Packs take two.
    const fn by_u32<U: Lane>() -> bool {
        matches!(U::KIND, crate::lane::Kind::Unsigned)
            && U::BITS < 32
            && W::BYTES <= 64
            && (W::BYTES >= 32 || T::BITS == 64)
    }
    /// Like [`cast`](Self::cast), but an integer that `U` can't hold becomes the nearest one that it can.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(i32x4::from([1, -1, 256, 300]).saturating_cast::<u8>(), [1, 0, 255, 255]);
    /// # } example()
    /// ```
    #[doc(alias("DemoteTo", "demote_to", "pack", "clamp_to"))]
    #[op]
    #[track_caller]
    pub fn saturating_cast<U: Lane>(self) -> V<S, U, Scaled<T, U, W>> {
        if const { float::<T>() || float::<U>() } {
            self.cast()
        } else if const { T::BITS > U::BITS } {
            self.scaled().demote(self)
        } else if const { signed::<T>() && !signed::<U>() } {
            self.simd_max_relaxed(T::default()).cast()
        } else if const { !signed::<T>() && signed::<U>() && T::BITS == U::BITS } {
            self.simd_min_relaxed(T::from_u64(!0 >> (65 - T::BITS))).cast()
        } else {
            self.cast()
        }
    }
    /// The halves, in lanes of twice the size. Each lane is converted like `as`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [lo, hi] = u8x4::from([1, 2, 3, 4]).widen::<u16>();
    /// assert_eq!((lo.to_array(), hi.to_array()), ([1, 2], [3, 4]));
    /// # } example()
    /// ```
    #[doc(alias("PromoteLowerTo", "PromoteUpperTo", "promote_lower_to", "promote_upper_to", "unpack", "extend"))]
    #[op]
    #[track_caller]
    pub fn widen<U: Lane>(self) -> [V<S, U, W>; 2]
    where
        T: Widens<U>, // Name the lanes: v.widen::<u16>()
    {
        return_if!(S::SSE2 && !S::F16C && T::FRACTION == 10 && W::BYTES == 16, {
            let [lower, upper] = self.cast::<U>().split();
            [lower.same(), upper.same()]
        });
        let d = self.tag().repartition();
        return_if!(
            S::A64 && by_sum::<T, U>() && Self::LANES >= 8,
            [d.of_small(self.lower_half()), d.of_small(self.upper_half())]
        );
        [d.promote_lower_to(self), d.promote_upper_to(self)]
    }
    /// The even lanes, in lanes of twice the size.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = i8x4::from([-1, 2, -3, 4]);
    /// assert_eq!((v.widen_even::<i16>().to_array(), v.widen_odd::<i16>().to_array()), ([-1, -3], [2, 4]));
    /// # } example()
    /// ```
    #[doc(alias("PromoteEvenTo", "promote_even_to"))]
    #[op]
    #[track_caller]
    pub fn widen_even<U: Lane>(self) -> V<S, U, W>
    where
        T: Widens<U>,
    {
        self.tag().repartition().promote_even_to(self)
    }
    /// The odd lanes, in lanes of twice the size.
    #[doc(alias("PromoteOddTo", "promote_odd_to"))]
    #[op]
    #[track_caller]
    pub fn widen_odd<U: Lane>(self) -> V<S, U, W>
    where
        T: Widens<U>,
    {
        self.tag().repartition().promote_odd_to(self)
    }
    /// Cuts the vector, or extends it with zeros.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = u8x4::from([1, 2, 3, 4]);
    /// assert_eq!(v.resize::<B2>(), [1, 2]);
    /// assert_eq!(v.resize::<B8>(), [1, 2, 3, 4, 0, 0, 0, 0]);
    /// # } example()
    /// ```
    #[doc(alias("ResizeBitCast", "ZeroExtendVector", "resize_bitcast", "zero_extend", "truncate"))]
    #[op]
    #[track_caller]
    pub fn resize<X: Width>(self) -> V<S, T, X> {
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), not(miri)))]
        return_if!(W::BYTES < 64, |v: Self = self| v.same::<T, X>().assembled().part_of::<W>());
        // By way of 16 bytes, a load that zeroes the rest needs no move.
        return_if!(S::A64 && W::BYTES == 4 && X::BYTES == 8, self.same::<T, crate::B16>().same());
        on_x86!(self.same(), part_of::<W>())
    }
    /// The first half of the lanes, and the second one.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [lo, hi] = u8x4::from([1, 2, 3, 4]).split();
    /// assert_eq!((lo.to_array(), hi.to_array()), ([1, 2], [3, 4]));
    /// assert_eq!(lo.concat(hi), [1, 2, 3, 4]);
    /// # } example()
    /// ```
    #[doc(alias("LowerHalf", "UpperHalf", "lower_half", "upper_half", "low", "high", "halves"))]
    #[op]
    #[track_caller]
    pub fn split(self) -> [V<S, T, W::Half>; 2] {
        [on_x86!(self.lower_half(), part_of::<W>()), on_x86!(self.upper_half(), part_of::<W>())]
    }
    /// The reverse of [`from_parts`](crate::Simd::from_parts): calls `f` with the index of each part and the part, in order.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let mut image = [0; 8];
    /// let mut rows = RowsMut::new(&mut image, 4, 2, 2);
    /// u8x4::iota(1).for_each_part(|y, part: u8x2<S>| part.store(rows.row(y)));
    /// assert_eq!(image, [1, 2, 0, 0, 3, 4, 0, 0]);
    /// # } example()
    /// ```
    #[doc(alias("store_rows", "store_strided", "chunks", "channels", "reduce_parts"))]
    #[op]
    #[track_caller]
    pub fn for_each_part<X: Width>(self, mut f: impl FnMut(usize, V<S, T, X>)) {
        self.each_part::<X, _, false>(0, &mut f)
    }
    /// The same for a closure of this crate. Where the caller has no features, LLVM would see a call, and refuse to unroll the loop around it.
    #[op]
    pub(crate) fn each_own_part<X: Width>(self, mut f: impl FnMut(usize, V<S, T, X>)) {
        self.each_part::<X, _, true>(0, &mut f)
    }
    #[op]
    #[track_caller]
    fn each_part<X: Width, F: FnMut(usize, V<S, T, X>), const OWN: bool>(self, first: usize, f: &mut F) {
        require!("a part is wider than the vector", X::BYTES <= W::BYTES);
        if const { X::BYTES == W::BYTES } {
            return f(first, crate::raw::same(self));
        }
        again!(Simd::each_part::<X, F, OWN>, self.lower_half(), first, &mut *f);
        again!(Simd::each_part::<X, F, OWN>, self.upper_half(), first + W::BYTES / X::BYTES / 2, f)
    }
    /// These lanes, and then those of `upper`. It doesn't build if the result is wider than 512 bytes.
    #[doc(alias("Combine", "combine", "join"))]
    #[op]
    #[track_caller]
    pub fn concat(self, upper: impl crate::Operand<T, W, S>) -> V<S, T, W::Twice> {
        let upper = crate::Operand::vector(upper, crate::Tag::new(self.s));
        require!("there is no vector of more than 512 bytes", W::BYTES < 512);
        on_x86!(Simd::new(self.s, self.raw.shuffle::<_, { p::PART }, 0>(upper.raw)), assembled())
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    #[op]
    #[track_caller]
    pub(crate) fn from_parts<X: Width, F: FnMut(usize) -> V<S, T, X>>(self, first: usize, part: &mut F) -> V<S, T, W> {
        require!("a part is wider than the vector", X::BYTES <= W::BYTES);
        if const { X::BYTES == W::BYTES } {
            return crate::raw::same(part(first));
        }
        let lower = again!(Tag::from_parts, self.half(), first, &mut *part);
        self.combine(again!(Tag::from_parts, self.half(), first + W::BYTES / X::BYTES / 2, part), lower)
    }
    /// See `each_own_part`.
    #[op]
    pub(crate) fn of_own_parts<X: Width>(self, first: usize, part: &impl Fn(usize) -> V<S, T, X>) -> V<S, T, W> {
        if const { X::BYTES >= W::BYTES } {
            return crate::raw::same(part(first));
        }
        let lower = again!(Tag::of_own_parts, self.half(), first, part);
        self.combine(again!(Tag::of_own_parts, self.half(), first + W::BYTES / X::BYTES / 2, part), lower)
    }
    /// `f32` from integers of up to 16 bits, by the bits of a number whose last place counts one. Of a sum, LLVM would make `or`.
    #[on(A64)]
    #[op]
    fn of_small<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        let large = self.set(T::from_u64(3 << 22));
        large - (large.cast_signed() - v.cast::<T::Signed>().same()).bitcast()
    }
    /// `f32` from `u8` or `i8`, with a lookup for each four.
    #[op]
    fn of_bytes<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        halves_if!(X::BYTES > 16, |d: Self = self, v: V<S, U, X> = v| d.combine(d.half().of_bytes(v.upper_half()), d.half().of_bytes(v.lower_half())));
        let d = self.simd().fixed::<u8, B16>();
        let bytes = d.resize_bitcast(v);
        return_if!(S::A64 && by_sum::<U, T>() && !signed::<U>(), {
            let large = d.repartition::<f32>().set(8388608.0);
            self.from_parts(
                0,
                &mut passed!(|i| {
                    let lanes = bytes.concat_swizzle(
                        large.bitcast(),
                        #[inline(always)]
                        |j| if j % 4 == 0 { 4 * i + j / 4 } else { 16 + j },
                    );
                    (lanes.bitcast() - large).same::<T, B16>()
                }),
            )
        });
        let place = if const { signed::<U>() } { 3 } else { 0 };
        self.from_parts(
            0,
            &mut passed!(|i| {
                let lanes = bytes.table_lookup_bytes(d.from_fn(
                    #[inline(always)]
                    |j| if j % 4 == place { (4 * i + j / 4) as u8 } else { 255 },
                ));
                let floats = lanes.bitcast::<i32>().cast::<f32>();
                (if const { signed::<U>() } { floats * (1.0 / 16777216.0) } else { floats }).same::<T, B16>()
            }),
        )
    }
    #[op]
    fn promote_or_convert<X: Width>(self, v: V<S, i32, X>) -> V<S, T, W> {
        choose! { |this: Self = self, v: V<S, i32, X> = v| T::BITS == 32 => this.convert(v.same::<i32, W>()), _ => this.promote(v) }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    /// These lanes and then those of `upper`, in lanes of half the size, with saturation.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(i16x2::from([-5, 7]).saturating_narrow::<u8>(i16x2::from([300, 9])), [0, 7, 255, 9]);
    /// # } example()
    /// ```
    #[doc(alias("OrderedDemote2To", "ordered_demote2_to", "packus", "packs"))]
    #[op]
    #[track_caller]
    pub fn saturating_narrow<U: Int + Widens<T>>(self, upper: impl crate::Operand<T, W, S>) -> V<S, U, W> {
        let upper = crate::Operand::vector(upper, crate::Tag::new(self.s));
        self.tag().repartition().ordered_demote2_to(self, upper)
    }
    /// The lower halves of these lanes, and then of those of `upper`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(u16x2::from([0x1234, 0x56]).wrapping_narrow::<u8>(u16x2::from([0xff00, 9])), [0x34, 0x56, 0, 9]);
    /// # } example()
    /// ```
    #[doc(alias("OrderedTruncate2To", "ordered_truncate2_to", "narrow"))]
    #[op]
    #[track_caller]
    pub fn wrapping_narrow<U: Int + Widens<T>>(self, upper: impl crate::Operand<T, W, S>) -> V<S, U, W> {
        let upper = crate::Operand::vector(upper, crate::Tag::new(self.s));
        self.tag().repartition().ordered_truncate2_to(self, upper)
    }
}

impl<T: Int, W: Width, S: Isa> InBlocks<T, W, S> {
    /// The first halves of all blocks, and the second ones, in lanes of twice the size.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let [lo, hi] = u32x8::iota(0).in_blocks().widen::<u64>();
    /// assert_eq!((lo.to_array(), hi.to_array()), ([0, 1, 4, 5], [2, 3, 6, 7]));
    /// # } example()
    /// ```
    #[doc(alias("ZipLower", "ZipUpper", "punpck"))]
    #[op]
    #[track_caller]
    pub fn widen<U: Int>(self) -> [V<S, U, W>; 2]
    where
        T: Widens<U>,
    {
        require!("the lanes of the result have to be twice as wide", size_of::<U>() == 2 * size_of::<T>());
        let v = self.0;
        if const { W::BYTES <= 16 } {
            return v.widen();
        }
        // LLVM knows the sign of an extension when it selects `smlal`, and not that of `zip1`.
        halves_if!(S::A64, |v: V<S, T, W> = v| {
            let (d, lower, upper) =
                (v.tag().repartition::<U>(), v.lower_half().in_blocks().widen::<U>(), v.upper_half().in_blocks().widen::<U>());
            [d.combine(upper[0], lower[0]), d.combine(upper[1], lower[1])]
        });
        let upper =
            if const { signed::<T>() } { v.simd_lt(T::default()).into_vector().bitcast::<T>() } else { v.tag().zero() };
        [v.interleave_lower(upper).bitcast(), v.interleave_upper(upper).bitcast()]
    }
    /// The lanes of a block, and then those of that block of `upper`, in lanes of half the size, with saturation.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let narrow = i64x4::from([0, 1, 4, 5]).in_blocks().saturating_narrow::<i32>(i64x4::from([2, 3, 6, i64::MAX]));
    /// assert_eq!(narrow, [0, 1, 2, 3, 4, 5, 6, i32::MAX]);
    /// # } example()
    /// ```
    #[doc(alias("ReorderDemote2To", "reorder_demote2_to", "packus", "packs"))]
    #[op]
    #[track_caller]
    pub fn saturating_narrow<U: Int + Widens<T>>(self, upper: impl crate::Operand<T, W, S>) -> V<S, U, W> {
        let upper = crate::Operand::vector(upper, crate::Tag::new(self.0.s));
        self.0.tag().repartition().reorder_demote2_to(self.0, upper)
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    /// Like [`cast`](Self::cast), but the result is unspecified for NaN, and for what is out of the range of an integer. From `f32` to `bf16`, a subnormal number can become zero.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f32x2::from([1.9, -7.5]).cast_relaxed::<i32>(), [1, -7]);
    /// assert_eq!(f32x2::from([1.001, -7.5]).cast_relaxed::<bf16>().cast::<f32>(), [1.0, -7.5]);
    /// # } example()
    /// ```
    #[doc(alias(
        "narrow_relaxed", "vcvtneps2bf16", "bfcvtn", "ConvertInRangeTo", "PromoteInRangeTo", "DemoteInRangeTo",
        "to_int_unchecked", "CeilInt", "FloorInt"
    ))]
    #[op]
    #[track_caller]
    pub fn cast_relaxed<U: Lane>(self) -> V<S, U, Scaled<T, U, W>> {
        let d = self.scaled::<U>();
        choose! { |this: Self = self, d: Tag<S, U, Scaled<T, U, W>> = d|
            T::BITS == 32 && float::<U>() && U::FRACTION == 7 && W::BYTES >= 4 => d.repartition::<u16>().demote_numbers_to_bf16(this.same()).bitcast(),
            float::<U>() => this.cast(),
            Self::HALF => T::cast_to::<U, true, S, W, _>(this),
            U::BITS < 32 => d.demote(this.cast_relaxed::<i32>()),
            T::BITS == U::BITS => d.convert_in_range_to(this.same::<T, _>()),
            T::BITS < U::BITS => d.promote_in_range_to(this.same()),
            _ => d.demote_in_range_to(this.same()),
        }
    }
    /// The nearest integer that `U` can hold. Ties go to the even one, and NaN is zero. On x86, a clamp and [`round_cast_relaxed`](Self::round_cast_relaxed) are faster.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f32x4::from([0.5, 1.5, -3.0, 1e9]).round_cast::<u8>(), [0, 2, 0, 255]);
    /// # } example()
    /// ```
    #[doc(alias("NearestInt", "DemoteToNearestInt", "lrint", "round_int", "fcvtns", "fcvtnu"))]
    #[op]
    #[track_caller]
    pub fn round_cast<U: Int>(self) -> V<S, U, Scaled<T, U, W>> {
        let d = self.scaled::<U>();
        choose! { |this: Self = self, d: Tag<S, U, Scaled<T, U, W>> = d|
            Self::HALF => T::round_to::<U, false, S, W, _>(this),
            S::A64 && (signed::<U>() && T::BITS >= U::BITS || U::BITS < 32) => this.round_cast_relaxed(),
            S::A64 && T::BITS <= U::BITS => this.round_cast_relaxed(),
            S::WASM && T::BITS == 32 && U::BITS < 32 && !signed::<U>() => {
                let v = this.bitcast::<f32>();
                d.demote((v.greater(v.tag().zero()) + 8388608.0).bitcast::<i32>() - 0x4b00_0000)
            },
            S::AVX512F && T::BITS == U::BITS && signed::<U>() => this.with_bytes::<U>(this.s.saturated_int::<W>(this.bytes(), (T::BITS == 64, true))).same(),
            // What is too large gives all ones.
            S::AVX512F && T::BITS == U::BITS => this.if_greater(this.tag().zero()).round_cast_relaxed(),
            S::AVX512F && T::BITS == 32 && Self::by_u32::<U>() => d.demote(this.round_cast::<u32>()),
            x86::<S>() && T::BITS == 32 && U::BITS < 32 => d.demote(this.bitcast::<f32>().packable::<U>().nearest_int()),
            x86::<S>() && T::BITS == 32 && U::BITS == 32 && signed::<U>() => {
                let v = this.bitcast::<f32>();
                let all = v.nearest_int() ^ v.simd_ge(2147483648.0).to_vector().bitcast();
                v.simd_eq(v).if_then_else_zero(all.bitcast::<f32>()).same()
            },
            T::BITS == 64 && U::BITS < 32 => d.demote(this.round_cast::<i32>()),
            T::BITS == 64 && U::BITS == 32 => d.demote_to_nearest_int::<false>(this.same()),
            S::AVX512DQ && !signed::<U>() => this.if_greater(this.tag().zero()).round_cast_relaxed(),
            S::AVX512DQ && W::BYTES > 32 => d.combine(this.upper_half().round_cast::<U>().same(), this.lower_half().round_cast::<U>().same()),
            S::AVX512DQ && (W::BYTES == 16 || W::BYTES == 32) => {
                let v = this.bitcast::<f32>();
                let mask = always!(|it: crate::MaskOf<f32, W, S>| -> crate::MaskOf<U, Scaled<T, U, W>, S> { crate::raw::same(it.rebind::<i64>()) });
                mask(v.simd_ge(9223372036854775808.0)).if_then_else(U::MAX, mask(v.simd_eq(v)).if_then_else_zero(this.round_cast_relaxed::<U>()))
            },
            _ => this.round_ties_even().cast(),
        }
    }
    /// Like [`round_cast`](Self::round_cast), but the result is unspecified for NaN. If `U` has 32 bits or more, or is as wide as
    /// the lane, it also is for what is out of range.
    #[doc(alias("nearest_int", "round_demote_to", "cvtps2dq", "cvtpd2dq"))]
    #[op]
    #[track_caller]
    pub fn round_cast_relaxed<U: Int>(self) -> V<S, U, Scaled<T, U, W>> {
        let d = self.scaled::<U>();
        choose! { |this: Self = self, d: Tag<S, U, Scaled<T, U, W>> = d|
            Self::HALF => T::round_to::<U, true, S, W, _>(this),
            // The sum rounds, and its bits are in order.
            S::WASM && T::BITS == 32 && U::BITS < 32 => d.demote((this.bitcast::<f32>() + 12582912.0).bitcast::<i32>().simd_max(0) - 0x4b40_0000),
            S::AVX512F && T::BITS == 32 && Self::by_u32::<U>() => d.demote(this.round_cast::<u32>()),
            T::BITS == 32 && U::BITS < 32 => {
                let v = this.bitcast::<f32>();
                // On x86, all that is out of range becomes `i32::MIN`. NEON saturates.
                d.demote(if const { S::NEON } { v } else { v.lesser(v.like(65536.0)) }.nearest_int())
            },
            x86::<S>() && T::BITS == 64 && U::BITS < 32 => d.demote(this.lesser(this.like(T::from_i64(65536))).round_cast_relaxed::<i32>()),
            T::BITS == 64 && U::BITS < 32 => d.demote(this.round_cast::<i32>()),
            T::BITS == 64 && U::BITS == 32 => d.demote_to_nearest_int::<true>(this.same()),
            T::BITS == 32 && U::BITS == 32 && signed::<U>() => this.bitcast::<f32>().nearest_int().same(),
            T::BITS == 64 && signed::<U>() => this.bitcast::<f64>().nearest_int().same(),
            (S::A64 || S::AVX512F) && T::BITS == 32 && U::BITS == 32 => this.with_bytes::<u32>(this.s.nearest_f32_u32::<W>(this.bytes())).same(),
            (S::A64 || S::AVX512F) && T::BITS == 64 => this.with_bytes::<u64>(this.s.nearest_f64_u64::<W>(this.bytes())).same(),
            S::AVX512DQ && W::BYTES <= 32 => {
                let v = d.resize_bitcast(this);
                v.with_bytes(v.s.nearest_f32_64::<Scaled<T, U, W>>(v.bytes(), signed::<U>()))
            },
            S::AVX512DQ => d.combine(this.upper_half().round_cast_relaxed::<U>().same(), this.lower_half().round_cast_relaxed::<U>().same()),
            S::A64 => this.cast::<f64>().round_cast_relaxed::<U>().same(),
            _ => this.round_ties_even().cast_relaxed(),
        }
    }
    /// These lanes and then those of `upper`, rounded to lanes of half the size: the reverse of [`widen`](Self::widen).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f64x2::from([0.5, 1.5]).narrow::<f32>(f64x2::from([2.5, 3.5])), [0.5, 1.5, 2.5, 3.5]);
    /// # } example()
    /// ```
    #[doc(alias("OrderedDemote2To", "cvtne2ps2bf16", "fcvtn2"))]
    #[op]
    #[track_caller]
    pub fn narrow<U: Float + Widens<T>>(self, upper: impl crate::Operand<T, W, S>) -> V<S, U, W> {
        let upper = crate::Operand::vector(upper, crate::Tag::new(self.s));
        let d = self.tag().repartition::<U>();
        if const { U::FRACTION == 7 } {
            return d.repartition::<u16>().ordered_demote2_to_bf16(self.bitcast(), upper.bitcast()).bitcast();
        }
        d.combine(d.half().demote(upper), d.half().demote(self))
    }
    /// The same with these lanes and those of `odd` in turns: the reverse of [`widen_even`](Self::widen_even) and
    /// [`widen_odd`](Self::widen_odd). For `bf16`, these three need no shuffle unless `has!(bf16)`.
    /// For integers, see [`bitcast`](Self::bitcast) and [`transpose_pairs`](Self::transpose_pairs).
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f64x2::from([0.5, 1.5]).narrow_even_odd::<f32>(f64x2::from([2.5, 3.5])), [0.5, 2.5, 1.5, 3.5]);
    /// # } example()
    /// ```
    #[doc(alias("ReorderDemote2To"))]
    #[op]
    #[track_caller]
    pub fn narrow_even_odd<U: Float + Widens<T>>(self, odd: impl crate::Operand<T, W, S>) -> V<S, U, W> {
        let odd = crate::Operand::vector(odd, crate::Tag::new(self.s));
        let d = self.tag().repartition::<U>();
        if const { U::FRACTION == 7 } {
            return d.repartition::<u16>().interleave_demote2_to_bf16(self.bitcast(), odd.bitcast()).bitcast();
        }
        let [even, odd] = [d.half().demote(self), d.half().demote(odd)];
        Simd::new(self.s, even.raw.shuffle::<_, { p::INTERLEAVE_WHOLE_LOWER }, 0>(odd.raw))
    }
}

impl<S: Isa, W: Width> Simd<f32, W, S> {
    /// On x86, all that is out of range becomes `i32::MIN`, and so does NaN, which `minps` keeps as its second operand.
    #[on(X86)]
    #[op]
    fn packable<U: Lane>(self) -> Self {
        let most = self.tag().set(65536.0);
        choose! {
            signed::<U>() && crate::MaskOf::<f32, W, S>::IS_BITS => self.simd_eq(self).if_then_else_zero(most.lesser(self)),
            signed::<U>() => most.lesser(self.simd_eq(self).if_then_else_zero(self)),
            _ => most.lesser(self),
        }
    }
}

impl<S: Isa, T: Lane, W: Width> IntoSimd<T, W, S> for V<S, T, W> {
    #[inline(always)]
    fn into_simd(self, _: S) -> Self {
        self
    }
}
/// Widths with as many lanes of the sizes of `T` and `U`, up to 64.
trait AsMany<T, U> {}
macro_rules! as_many { ($($from:ident $to:ident [$($w:ident $x:ident),*];)*) => {
    $($(impl AsMany<$from, $to> for ($w, $x) where Scaled<$from, $to, $w>: crate::lane::Is<$x> {})*)*
}; }
as_many! {
    i8 i16 [B2 B4, B4 B8, B8 B16, B16 B32, B32 B64, B64 B128];
    i8 i32 [B2 B8, B4 B16, B8 B32, B16 B64, B32 B128, B64 B256];
    i8 i64 [B2 B16, B4 B32, B8 B64, B16 B128, B32 B256, B64 B512];
    i16 i32 [B2 B4, B4 B8, B8 B16, B16 B32, B32 B64, B64 B128, B128 B256];
    i16 i64 [B2 B8, B4 B16, B8 B32, B16 B64, B32 B128, B64 B256, B128 B512];
    i32 i64 [B4 B8, B8 B16, B16 B32, B32 B64, B64 B128, B128 B256, B256 B512];
}
/// The pairs of `From` for numbers.
macro_rules! lossless { ($($from:ident [$($to:ident)*] $small:ident $large:ident;)*) => {$($(
    #[doc(hidden)]
    #[diagnostic::do_not_recommend]
    impl<S: Isa, W: Width, X: Width> From<V<S, $from, W>> for V<S, $to, X> where (W, X): AsMany<$small, $large> {
        #[op]
        fn from(v: V<S, $from, W>) -> Self { crate::raw::same(v.cast::<$to>()) }
    }
    #[doc(hidden)]
    #[diagnostic::do_not_recommend]
    impl<S: Isa, W: Width, X: Width> IntoSimd<$to, X, S> for V<S, $from, W> where (W, X): AsMany<$small, $large> {
        #[op]
        fn into_simd(self, _: S) -> V<S, $to, X> { crate::raw::same(self.cast::<$to>()) }
    }
)*)*}; }
lossless! {
    u8 [u16 i16] i8 i16;
    u8 [u32 i32 f32] i8 i32;
    u8 [u64 i64 f64] i8 i64;
    i8 [i16] i8 i16;
    i8 [i32 f32] i8 i32;
    i8 [i64 f64] i8 i64;
    u16 [u32 i32 f32] i16 i32;
    u16 [u64 i64 f64] i16 i64;
    i16 [i32 f32] i16 i32;
    i16 [i64 f64] i16 i64;
    u32 [u64 i64 f64] i32 i64;
    i32 [i64 f64] i32 i64;
    f32 [f64] i32 i64;
    u8 [f16 bf16] i8 i16;
    i8 [f16 bf16] i8 i16;
    f16 [f32] i16 i32;
    f16 [f64] i16 i64;
    bf16 [f32] i16 i32;
    bf16 [f64] i16 i64;
}
