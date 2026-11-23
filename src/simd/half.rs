//! Arithmetic on `f16` and `bf16`. Without instructions it goes through `f32`, which has so many more bits that rounding twice
//! gives what rounding once does for `+ - * /` and roots. What looks at the order works on the bits.

use crate::f16;
use crate::half_raw::Half;
use crate::lane::Kind;
use crate::{Isa, Lane, Mask, MaskOf, Simd, Tag, Width, bf16};
use core::mem::MaybeUninit;

type V<S, T, W> = Simd<T, W, S>;

/// An operation on each lane.
pub trait InF32 {
    /// Whether a NaN that comes out is one that went in, or the default one.
    const KEEPS_NAN: bool;
    fn on<S: Isa, X: Width>(a: V<S, f32, X>, b: V<S, f32, X>, c: V<S, f32, X>) -> V<S, f32, X>;
}

/// Returns from a method of `Simd<T, W, S>`: if the target can't compute with `T`, or for all lanes of 16 bits.
macro_rules! in_f32 {
    (soft $($rest:tt)*) => { crate::half::in_f32! { @ Self::SOFT, true, $($rest)* } };
    (half $($rest:tt)*) => { crate::half::in_f32! { @ Self::HALF, false, $($rest)* } };
    (@ $when:expr, $keeps:literal, $x:ident => |$a:ident| $f:expr) => { crate::half::in_f32! { @ $when, $keeps, $x, $x, $x => |$a, _b, _c| $f } };
    (@ $when:expr, $keeps:literal, $x:ident, $y:expr => |$a:ident, $b:ident| $f:expr) => { crate::half::in_f32! { @ $when, $keeps, $x, $y, $x => |$a, $b, _c| $f } };
    (@ $when:expr, $keeps:literal, $x:ident, $y:expr, $z:expr => |$a:ident, $b:ident, $c:ident| $f:expr) => {
        return_if!($when, {
            struct Op;
            impl crate::half::InF32 for Op {
                const KEEPS_NAN: bool = $keeps;
                #[op]
                fn on<S: crate::Isa, X: crate::Width>($a: crate::Simd<f32, X, S>, $b: crate::Simd<f32, X, S>, $c: crate::Simd<f32, X, S>) -> crate::Simd<f32, X, S> { $f }
            }
            T::in_f32::<Op, S, W>($x, $y, $z)
        });
    };
}
pub(crate) use in_f32;

/// For x86. Comparisons give lanes of 0 or -1.
#[derive(Copy, Clone)]
pub enum Op {
    Add,
    Sub,
    Mul,
    Div,
    Sqrt,
    Floor,
    Ceil,
    Trunc,
    Even,
    Neg,
    OfSigned,
    OfUnsigned,
    Eq,
    Ne,
    Lt,
    Le,
}
/// Returns from a method of `Simd<T, W, S>`.
macro_rules! native {
    ($op:ident, $a:ident, $b:expr) => {
        return_if!(
            S::AVX512FP16 && Self::HALF,
            $a.with_bytes($a.s.on_f16::<W>($a.bytes(), $b.bytes(), crate::half::Op::$op))
        );
    };
    (mask $op:ident, $a:ident, $b:expr) => {
        return_if!(
            S::AVX512FP16 && Self::HALF,
            crate::mask::Mask::from_full($a.with_bytes::<T>($a.s.on_f16::<W>(
                $a.bytes(),
                $b.bytes(),
                crate::half::Op::$op
            )))
        );
    };
}
pub(crate) use native;

pub const EQ: u8 = 0;
pub const LT: u8 = 1;
pub const LE: u8 = 2;

/// A part of `Lane`. As methods of a trait, these cost the other lanes no time to compile.
#[allow(unused_variables)]
pub trait Soft: Sized {
    fn in_f32<F: InF32, S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self, W>, c: V<S, Self, W>) -> V<S, Self, W>
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn fused<S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self, W>, c: V<S, Self, W>) -> V<S, Self, W>
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn compare<const OP: u8, S: Isa, W: Width>(a: V<S, Self, W>, b: V<S, Self, W>) -> MaskOf<Self, W, S>
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn extreme<const MAX: bool, const STRICT: bool, S: Isa, W: Width>(
        a: V<S, Self, W>,
        b: V<S, Self, W>,
    ) -> V<S, Self, W>
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn across<const MAX: bool, S: Isa, W: Width>(v: V<S, Self, W>) -> Self
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn cast_to<U: Lane, const RELAXED: bool, S: Isa, W: Width, X: Width>(v: V<S, Self, W>) -> V<S, U, X>
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn cast_from<U: Lane, S: Isa, W: Width, X: Width>(v: V<S, U, X>) -> V<S, Self, W>
    where
        Self: Lane,
    {
        unreachable!()
    }
    fn round_to<U: crate::Int, const RELAXED: bool, S: Isa, W: Width, X: Width>(v: V<S, Self, W>) -> V<S, U, X>
    where
        Self: Lane,
    {
        unreachable!()
    }
}
macro_rules! hard { ($($t:ident)*) => { $(impl Soft for $t {})* }; }
hard!(u8 u16 u32 u64 i8 i16 i32 i64 f32 f64);

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    pub(crate) const HALF: bool = T::IS_FLOAT && T::BITS == 16;
    /// Whether the target has no arithmetic for these lanes.
    pub(crate) const SOFT: bool =
        Self::HALF && (crate::MINGW || !(T::FRACTION == 10 && S::HAS_FP16 && Self::LANES <= 64));
    /// Neoverse takes four cycles to convert between `f16` and integers.
    pub(crate) const SLOW_CASTS: bool = S::A64 && !cfg!(target_vendor = "apple");
    /// From -512 to 510. The number is odd, or LLVM would write `or` for bytes, which is not done as they are widened.
    #[op]
    pub(crate) fn of_small(v: V<S, i16, W>) -> Self {
        choose! { S::A64 && Self::SLOW_CASTS => (v + 0x6601).bitcast::<T>() - T::from_f64(1537.0), _ => v.cast::<T>().same() }
    }
    /// Of the eight lanes of a block.
    #[on(A64)]
    #[op]
    pub(crate) fn extreme_in_all(self, max: bool) -> Self {
        let step = always!(|v| self.s.extreme_of_pairs_f16::<W>(v, max));
        self.with_bytes(step(step(step(self.bytes()))))
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// `as`, if one of the types has 16 bits and floats.
    #[op]
    #[track_caller]
    pub(crate) fn cast_half<U: Lane, X: Width>(self, v: V<S, U, X>) -> V<S, T, W> {
        require!(
            "there is no vector with as many lanes of that type, since the widths are 2 to 512 bytes: see `widen` and `split`",
            X::BYTES / size_of::<U>() == Self::LANES
        );
        if const { V::<S, U, X>::HALF } { U::cast_to::<T, false, S, X, W>(v) } else { T::cast_from(v) }
    }
}

impl<S: Isa, T: Half, W: Width> Simd<T, W, S> {
    const INFINITY: i16 = 0x7fff >> T::FRACTION << T::FRACTION;
    #[op]
    fn magnitude(self) -> V<S, i16, W> {
        self.cast_signed() & 0x7fff
    }
    /// Of up to 16 bits, with instructions. On x86, NaN and all that is out of range become 0x8000, or 0xffff without a sign.
    #[op]
    fn small_ints<U: Lane, X: Width, const NEAREST: bool, const RELAXED: bool>(self) -> V<S, U, X> {
        let words = always!(|v: Self| {
            let (s, signed) = (v.s, U::IS_SIGNED || U::BITS == 8);
            v.with_bytes::<i16>(choose! { NEAREST => s.nearest_f16::<W>(v.bytes(), signed), _ => s.truncate_f16::<W>(v.bytes(), signed) })
        });
        let k = always!(|bits: i16| self.tag().to_signed().set(bits).bitcast::<T>());
        let all = choose! {
            !crate::X86 || RELAXED && (U::BITS == 16 || !NEAREST) => words(self),
            U::BITS == 8 && (RELAXED || !U::IS_SIGNED) => words(k(0x5c00).lesser(self)),
            U::BITS == 8 => self.simd_eq(self).if_then_else_zero(words(k(0x5c00).lesser(self))),
            U::IS_SIGNED => self.simd_ge(k(0x7800)).if_then_else(i16::MAX, self.simd_eq(self).if_then_else_zero(words(self))),
            _ => words(self.greater(k(0))),
        };
        choose! { U::BITS == 16 => all.same(), _ => self.s.fixed::<U, X>().demote(all) }
    }
    /// The same for 32 bits.
    #[on(X86)]
    #[op]
    fn ints<U: Lane, X: Width, const NEAREST: bool, const RELAXED: bool>(self) -> V<S, U, X> {
        let v =
            self.s.fixed::<U, X>().resize_bitcast(choose! { RELAXED => self, _ => self.greater(self.tag().zero()) });
        v.with_bytes(v.s.f16_to_32::<X>(v.bytes(), (U::IS_SIGNED, NEAREST)))
    }
    /// In the order of the values. Both zeros are 0.
    #[op]
    fn ordered(self) -> V<S, i16, W> {
        self.magnitude().neg_if_negative_relaxed(self.cast_signed())
    }
    #[op]
    fn compare_bits<const OP: u8>(self, other: Self) -> Mask<i16, W, S> {
        let (a, b) = (self.ordered(), other.ordered());
        choose! {
            OP == EQ => a.simd_eq(b) & self.magnitude().simd_lt(Self::INFINITY + 1),
            OP == LT => a.simd_lt(b) & self.magnitude().simd_max(other.magnitude()).simd_lt(Self::INFINITY + 1),
            _ => !(a.simd_gt(b) | self.magnitude().simd_max(other.magnitude()).simd_gt(Self::INFINITY)),
        }
    }
    #[op]
    fn extreme_bits<const MAX: bool, const STRICT: bool>(self, other: Self) -> Self {
        let (mut a, mut b) = (self.cast_signed(), other.cast_signed());
        if STRICT {
            a = self.magnitude().simd_gt(Self::INFINITY).if_then_else(b, a);
            b = other.magnitude().simd_gt(Self::INFINITY).if_then_else(a, b);
        }
        // The order of the integers is right, but if both are negative.
        let (right, wrong) = if MAX { (a.simd_max(b), a.simd_min(b)) } else { (a.simd_min(b), a.simd_max(b)) };
        (a & b).is_negative().if_then_else(wrong, right).bitcast()
    }
}

impl<S: Isa, W: Width> Simd<f32, W, S> {
    /// LLVM would round to an integer in lanes of `f16`, and convert twice more for that.
    #[op]
    pub(crate) fn stays_wide(self) -> Self {
        choose! { S::A64 && crate::OPTIMIZED && W::BYTES >= 16 => self.tag().opaque(self.raw), _ => self }
    }
    /// `self * mul` has to be exact, and nothing overflows.
    #[op]
    fn mul_add_to_odd(self, mul: Self, add: Self) -> Self {
        let product = self * mul;
        let sum = product + add;
        let part = sum - product;
        let lost = (product - (sum - part)) + (add - part);
        let inexact = lost.abs().simd_gt(0.0).to_vector().cast_unsigned() >> 31;
        ((sum.cast_unsigned() - ((lost ^ sum).cast_unsigned() >> 31 & inexact)) | inexact).bitcast()
    }
}

impl<S: Isa, W: Width> Simd<f64, W, S> {
    /// After this, it doesn't matter that there is a second step.
    #[inline(always)]
    fn to_odd_f32<X: Width>(self) -> V<S, f32, X> {
        apart!(self.s, {
            let near = self.s.fixed::<f32, X>().cast(self);
            let back = self.tag().cast(near);
            let (d, above, other) =
                (near.tag().to_unsigned(), back.abs().simd_gt(self.abs()), back.simd_lt(self) | back.simd_gt(self));
            ((near.cast_unsigned() + d.cast(above.to_vector())) | (d.cast(other.to_vector()) >> 31)).bitcast()
        })
    }
}

macro_rules! in_halves { ($f:expr, $($v:ident),+) => {
    return_if!(W::BYTES >= 64, apart!([$($v.s),+][0], {
        let (lower, upper) = ($f($($v.lower_half()),+), $f($($v.upper_half()),+));
        Tag::new(lower.s).combine(upper, lower)
    }));
}; }

macro_rules! both { ($t:ident) => {
    #[inline(always)]
    fn compare<const OP: u8, S: Isa, W: Width>(a: V<S, $t, W>, b: V<S, $t, W>) -> MaskOf<$t, W, S> { apart!(a.s, {
        return_if!(S::A64 && W::BYTES == 16, {
            // LLVM would compare lanes of `f16` after all, one by one.
            let ([a, c], [b, d]) = (a.widen::<f32>(), b.widen::<f32>());
            let (a, c) = if <$t as crate::lane::Repr>::FRACTION == 10 { (a.barrier(), c.barrier()) } else { (a, c) };
            choose! { OP == EQ => a.simd_eq(b).narrow(c.simd_eq(d)), OP == LT => a.simd_lt(b).narrow(c.simd_lt(d)), _ => a.simd_le(b).narrow(c.simd_le(d)) }
        });
        return_if!(S::A64 && W::BYTES == 8, {
            let (a, b) = (a.to_f32().barrier(), b.to_f32());
            crate::raw::same(choose! { OP == EQ => a.simd_eq(b), OP == LT => a.simd_lt(b), _ => a.simd_le(b) }.rebind::<i16>())
        });
        return_if!(S::A64 && W::BYTES > 16, |a: V<S, $t, W> = a, b: V<S, $t, W> = b| {
            a.tag().combine_masks(Self::compare::<OP, S, W::Half>(a.upper_half(), b.upper_half()), Self::compare::<OP, S, W::Half>(a.lower_half(), b.lower_half()))
        });
        a.compare_bits::<OP>(b)
    })
}
    #[op]
    fn across<const MAX: bool, S: Isa, W: Width>(v: V<S, $t, W>) -> $t {
        // In the order of `total_cmp`, with NaN at the end that doesn't count.
        let nan = v.magnitude().simd_gt(V::<S, $t, W>::INFINITY);
        let bits = if MAX { v.cast_signed() | nan.to_vector() } else { nan.if_then_else(0x7fff, v.cast_signed()) };
        let keys = bits ^ bits >> 15 & 0x7fff;
        let key = if MAX { keys.reduce_max() } else { keys.reduce_min() };
        $t::from_bits((key ^ key >> 15 & 0x7fff) as u16)
    }
    #[op]
    fn extreme<const MAX: bool, const STRICT: bool, S: Isa, W: Width>(a: V<S, $t, W>, b: V<S, $t, W>) -> V<S, $t, W> {
        return_if!(V::<S, $t, W>::SOFT, a.extreme_bits::<MAX, STRICT>(b));
        a.with_bytes(if MAX { a.s.max_f16::<W>(a.bytes(), b.bytes()) } else { a.s.min_f16::<W>(a.bytes(), b.bytes()) })
    }
    #[op]
    fn cast_to<U: Lane, const RELAXED: bool, S: Isa, W: Width, X: Width>(v: V<S, $t, W>) -> V<S, U, X> {
        if const { U::IS_FLOAT && U::FRACTION == <$t as crate::lane::Repr>::FRACTION } {
            return v.same();
        }
        return_if!(!V::<S, $t, W>::SOFT && !U::IS_FLOAT && U::BITS <= 16, v.small_ints::<U, X, false, RELAXED>());
        in_halves!(Self::cast_to::<U, RELAXED, S, W::Half, X::Half>, v);
        return_if!(crate::X86 && !V::<S, $t, W>::SOFT && !U::IS_FLOAT && U::BITS == 32 && (RELAXED || !U::IS_SIGNED), v.ints::<U, X, false, RELAXED>());
        choose! { RELAXED => v.to_f32().cast_relaxed::<U>(), _ => v.to_f32().cast::<U>() }.same()
    }
    #[op]
    fn round_to<U: crate::Int, const RELAXED: bool, S: Isa, W: Width, X: Width>(v: V<S, $t, W>) -> V<S, U, X> {
        return_if!(!V::<S, $t, W>::SOFT && U::BITS <= 16, v.small_ints::<U, X, true, RELAXED>());
        in_halves!(Self::round_to::<U, RELAXED, S, W::Half, X::Half>, v);
        return_if!(crate::X86 && !V::<S, $t, W>::SOFT && U::BITS == 32 && (RELAXED || !U::IS_SIGNED), v.ints::<U, X, true, RELAXED>());
        if RELAXED { v.to_f32().round_cast_relaxed::<U>() } else { v.to_f32().round_cast::<U>() }.same()
    }
}; }

impl<S: Isa, W: Width> Simd<f16, W, S> {
    #[inline(always)]
    pub(crate) fn to_f32(self) -> V<S, f32, W::Twice> {
        apart!(self.s, self.cast_unsigned().promote_f16())
    }
}
impl<S: Isa, W: Width> Simd<bf16, W, S> {
    #[op]
    pub(crate) fn to_f32(self) -> V<S, f32, W::Twice> {
        return_if!(S::AVX512VBMI && W::BYTES == 32, {
            let d = self.s.fixed::<u16, W::Twice>();
            d.resize_bitcast(self).of_one(always!(|i: usize| if i % 2 == 0 { 16 } else { i / 2 })).bitcast()
        });
        (self.s.fixed::<u32, W::Twice>().promote(self.cast_unsigned()) << 16).bitcast()
    }
    #[op]
    pub(crate) fn even(self) -> V<S, f32, W> {
        self.tag().repartition().promote_even_bf16_to(self.cast_unsigned())
    }
    #[op]
    pub(crate) fn odd(self) -> V<S, f32, W> {
        self.tag().repartition().promote_odd_bf16_to(self.cast_unsigned())
    }
}

macro_rules! sums { ($($t:ident)*) => {$(
    impl<S: Isa, W: Width> Simd<$t, W, S> {
        #[op]
        pub(crate) fn sums_of_2(self) -> V<S, f32, W> { self.widen_even::<f32>() + self.widen_odd::<f32>() }
    }
)*}; }
sums!(f16 bf16);

impl Half for f16 {
    #[op]
    fn room(to: &mut [MaybeUninit<Self>]) -> &mut [MaybeUninit<u16>] {
        crate::plain::write_as(to)
    }
    const SMALL: [u16; 256] = {
        let (mut all, mut i) = ([0; 256], 0);
        while i < 256 {
            all[i] = f16::from_f64(i as f64).to_bits();
            i += 1;
        }
        all
    };
}
impl Soft for f16 {
    both!(f16);
    #[op]
    fn in_f32<F: InF32, S: Isa, W: Width>(a: V<S, f16, W>, b: V<S, f16, W>, c: V<S, f16, W>) -> V<S, f16, W> {
        in_halves!(Self::in_f32::<F, S, W::Half>, a, b, c);
        apart!(a.s, a.tag().to_unsigned().demote_to_f16(F::on(a.to_f32(), b.to_f32(), c.to_f32())).bitcast())
    }
    #[op]
    fn fused<S: Isa, W: Width>(a: V<S, f16, W>, b: V<S, f16, W>, c: V<S, f16, W>) -> V<S, f16, W> {
        in_halves!(Self::fused::<S, W::Half>, a, b, c);
        apart!(a.s, a.tag().to_unsigned().demote_to_f16(a.to_f32().mul_add_to_odd(b.to_f32(), c.to_f32())).bitcast())
    }
    #[op]
    fn cast_from<U: Lane, S: Isa, W: Width, X: Width>(v: V<S, U, X>) -> V<S, f16, W> {
        return_if!(S::AVX512FP16 && !V::<S, f16, W>::SOFT && !U::IS_FLOAT && U::BITS <= 16 && W::BYTES <= 64, {
            let (words, op) =
                (v.cast::<i16>().same::<f16, W>(), if U::IS_SIGNED { Op::OfSigned } else { Op::OfUnsigned });
            words.with_bytes(v.s.on_f16::<W>(words.bytes(), words.bytes(), op))
        });
        return_if!(
            S::A64 && V::<S, f16, W>::SLOW_CASTS && !V::<S, f16, W>::SOFT && U::BITS == 8,
            V::<S, f16, W>::of_small(v.cast::<i16>().same())
        );
        return_if!(S::A64 && !V::<S, f16, W>::SOFT && !U::IS_FLOAT && U::BITS <= 16 && W::BYTES <= 64, {
            let words = v.cast::<i16>().same::<f16, W>();
            let all = words.with_bytes(v.s.f16_of::<W>(words.bytes(), U::IS_SIGNED));
            choose! { U::BITS == 16 && !U::IS_SIGNED => all.black_box(), _ => all }
        });
        apart!(v.s, {
            in_halves!(Self::cast_from::<U, S, W::Half, X::Half>, v);
            let d = v.s.fixed::<u16, W>();
            choose! {
                U::IS_FLOAT && U::BITS == 64 => d.demote_to_f16(v.bitcast::<f64>()).bitcast(),
                // An integer that `f32` has to round is out of range.
                _ => d.demote_to_f16(v.cast::<f32>()).bitcast(),
            }
        })
    }
}

impl Half for bf16 {
    #[op]
    fn room(to: &mut [MaybeUninit<Self>]) -> &mut [MaybeUninit<u16>] {
        crate::plain::write_as(to)
    }
    const SMALL: [u16; 256] = {
        let (mut all, mut i) = ([0; 256], 0);
        while i < 256 {
            all[i] = bf16::from_f32(i as f32).to_bits();
            i += 1;
        }
        all
    };
}
impl Soft for bf16 {
    both!(bf16);
    #[inline(always)]
    fn in_f32<F: InF32, S: Isa, W: Width>(a: V<S, bf16, W>, b: V<S, bf16, W>, c: V<S, bf16, W>) -> V<S, bf16, W> {
        apart!(a.s, {
            return_if!(W::BYTES == 2, Self::cast_from(F::on(a.to_f32(), b.to_f32(), c.to_f32())));
            return_if!(
                S::A64 && S::HAS_BF16 && W::BYTES < 16,
                Self::cast_from(F::on(a.to_f32(), b.to_f32(), c.to_f32()))
            );
            return_if!(S::A64 && S::HAS_BF16, {
                let lower = always!(|v: V<S, bf16, W>| v.tag().zero().interleave_lower(v).bitcast());
                let upper = always!(|v: V<S, bf16, W>| v.tag().zero().interleave_upper(v).bitcast());
                a.with_bytes(a.s.narrow_bf16::<W>(
                    F::on(lower(a), lower(b), lower(c)).bytes(),
                    F::on(upper(a), upper(b), upper(c)).bytes(),
                ))
            });
            let (even, odd) = (F::on(a.even(), b.even(), c.even()), F::on(a.odd(), b.odd(), c.odd()));
            return_if!(
                F::KEEPS_NAN && !(S::HAS_BF16 && W::BYTES >= 16) && (crate::X86 || cfg!(target_arch = "aarch64")),
                {
                    // The lower half of a NaN is zero, so that it takes nothing from the rounding.
                    let round = always!(|v: V<S, f32, W>| crate::convert::to_even(v.cast_unsigned()).bitcast::<bf16>());
                    round(even).interleave_odd(round(odd))
                }
            );
            a.tag().to_unsigned().interleave_demote2_to_bf16(even, odd).bitcast()
        })
    }
    #[inline(always)]
    fn fused<S: Isa, W: Width>(a: V<S, bf16, W>, b: V<S, bf16, W>, c: V<S, bf16, W>) -> V<S, bf16, W> {
        apart!(a.s, {
            return_if!(4 * W::BYTES > S::REGISTER, {
                let lower = Self::fused(a.lower_half(), b.lower_half(), c.lower_half());
                a.tag().combine(Self::fused(a.upper_half(), b.upper_half(), c.upper_half()), lower)
            });
            Self::cast_from((a.cast::<f64>() * b.cast::<f64>()).add_to_odd(c.cast::<f64>()))
        })
    }
    #[inline(always)]
    fn cast_from<U: Lane, S: Isa, W: Width, X: Width>(v: V<S, U, X>) -> V<S, bf16, W> {
        apart!(v.s, {
            return_if!(
                S::AVX512BW && U::FRACTION == 23 && W::BYTES == 64,
                v.s.fixed::<u16, W>().demote_to_bf16(v.same()).bitcast()
            );
            in_halves!(Self::cast_from::<U, S, W::Half, X::Half>, v);
            let odd = always!(|exact: u32| {
                let (bits, one) = (v.cast_unsigned(), v.tag().to_unsigned().set(Lane::ONE));
                let small = if const { matches!(U::KIND, Kind::Signed) } {
                    live!(matches!(U::KIND, Kind::Signed), (bits + (one << exact)) >> (exact + 1))
                } else {
                    live!(!(matches!(U::KIND, Kind::Signed)), bits >> exact)
                }
                .simd_eq(U::Unsigned::ZERO);
                let lost = small.if_then_zero_else((one << (U::BITS - exact)) - one);
                lost.and_not(bits | ((bits & lost) + lost)).bitcast::<U>()
            });
            let v: V<S, f32, W::Twice> = choose! {
                U::IS_FLOAT && U::BITS == 64 => v.bitcast::<f64>().to_odd_f32(),
                U::IS_FLOAT || U::BITS < 32 => v.cast::<f32>().same(),
                U::BITS == 32 => odd(24).cast::<f32>().same(),
                _ => odd(53).cast::<f64>().to_odd_f32(),
            };
            v.s.fixed::<u16, W>().demote_to_bf16(v).bitcast()
        })
    }
}
