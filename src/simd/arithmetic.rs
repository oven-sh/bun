//! Integer and floating-point arithmetic that has one result on all CPUs.

use crate::lane::Kind;
use crate::multiply::fns;
use crate::{B8, Float, HasSign, Int, Isa, Lane, Operand, Signed, Simd, Width, X86};

/// Whether the compiler finds that this holds. If it doesn't, the condition is not computed.
#[inline(always)]
pub(crate) fn known(condition: bool) -> bool {
    is_known!(condition) && condition
}

/// By how many bits: any integer for all lanes, or a vector or an array with a count for each.
#[diagnostic::on_unimplemented(
    message = "`{Self}` can't be a count of bits here",
    label = "expected an integer, an array of as many lanes, or a vector of `{T}` of the width `{W}`"
)]
pub trait Count<T: Int, W: Width, S: Isa>: Copy + crate::seals::Count<T, W, S> {
    #[doc(hidden)]
    fn left(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S>;
    #[doc(hidden)]
    fn right(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S>;
    #[doc(hidden)]
    fn rotate(this: Self, v: Simd<T, W, S>, left: bool) -> Simd<T, W, S>;
    #[doc(hidden)]
    fn round(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S>;
    #[doc(hidden)]
    fn unbounded(this: Self, v: Simd<T, W, S>, left: bool) -> Simd<T, W, S>;
    #[doc(hidden)]
    fn funnel(this: Self, high: Simd<T, W, S>, low: Simd<T, W, S>, left: bool) -> Simd<T, W, S>;
}
/// Not nameable outside of this crate.
pub trait Integer: Copy {
    /// The same modulo the number of bits of any lane.
    fn wrapped(this: Self) -> u32;
    /// As an unsigned number.
    fn saturated(this: Self) -> u32;
}
macro_rules! integers { ($($t:ident $u:ident)*) => {$(
    impl Integer for $t {
        #[inline(always)]
        fn wrapped(this: Self) -> u32 { this as u32 }
        #[op]
        fn saturated(this: Self) -> u32 { if $u::BITS > 32 { (this as $u).min(u32::MAX as $u) as u32 } else { this as $u as u32 } }
    }
)*}; }
integers! { u8 u8 u16 u16 u32 u32 u64 u64 u128 u128 usize usize i8 u8 i16 u16 i32 u32 i64 u64 i128 u128 isize usize }
#[diagnostic::do_not_recommend]
#[sealed]
impl<T: Int, W: Width, S: Isa, C: Integer> Count<T, W, S> for C {
    #[op]
    fn left(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.shl_same(C::wrapped(this))
    }
    #[op]
    fn right(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.shr_same(C::wrapped(this))
    }
    #[op]
    fn rotate(this: Self, v: Simd<T, W, S>, left: bool) -> Simd<T, W, S> {
        v.rotate_right_same(if left { C::wrapped(this).wrapping_neg() } else { C::wrapped(this) })
    }
    #[op]
    fn round(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.rounding_shift_right(C::wrapped(this) % T::BITS)
    }
    #[op]
    fn unbounded(this: Self, v: Simd<T, W, S>, left: bool) -> Simd<T, W, S> {
        let count = C::saturated(this);
        if T::IS_SIGNED && !left {
            return v >> count.min(T::BITS - 1);
        }
        if_here!(
            S::SSE2 && T::BITS > 8,
            if !is_known!(count) {
                return v.with_bytes(v.s.shift_all::<W>(v.bytes(), (T::BITS, left, count)));
            }
        );
        if_here!(
            S::NEON,
            if !is_known!(count) {
                return live!(S::NEON, {
                    let by = T::from_usize(count.min(T::BITS) as usize);
                    v.shift_by_sign(v.like(if left { by } else { T::from_i64(-(by.to_u64() as i64)) }))
                });
            }
        );
        (if left { v << count } else { v >> count }) & T::from_i64(-((count < T::BITS) as i64))
    }
    #[op]
    fn funnel(this: Self, high: Simd<T, W, S>, low: Simd<T, W, S>, left: bool) -> Simd<T, W, S> {
        // Shorter builds: with a known count, the other branch is one call to drop.
        macro_rules! long {
            ($it:expr) => {
                choose! { crate::OPTIMIZED && (S::A64 && W::BYTES == 128 || S::AVX2 && W::BYTES > 64) => apart!($it), _ => $it }
            };
        }
        let count = C::wrapped(this);
        if !is_known!(count) {
            return_if!(
                S::AVX512VBMI2 && T::BITS > 8,
                Count::funnel(high.like(T::from_usize(count as usize)), high, low, left)
            );
            let by = count % T::BITS;
            return if left {
                long!(high << by | low.unbounded_shr(T::BITS - by))
            } else {
                long!(high.unbounded_shl(T::BITS - by) | low >> by)
            };
        }
        if left { high << count | low >> 1 >> !count } else { high << 1 << !count | low >> count }
    }
}
#[sealed]
impl<T: Int, W: Width, S: Isa, const N: usize> Count<T, W, S> for [T; N]
where
    Self: Operand<T, W, S>,
{
    #[inline(always)]
    fn left(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.shl_each(v.like(this))
    }
    #[inline(always)]
    fn right(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        v.shr_each(v.like(this))
    }
    #[op]
    fn rotate(this: Self, v: Simd<T, W, S>, left: bool) -> Simd<T, W, S> {
        Count::rotate(v.like(this), v, left)
    }
    #[op]
    fn round(this: Self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        Count::round(v.like(this), v)
    }
    #[op]
    fn unbounded(this: Self, v: Simd<T, W, S>, left: bool) -> Simd<T, W, S> {
        Count::unbounded(v.like(this), v, left)
    }
    #[op]
    fn funnel(this: Self, high: Simd<T, W, S>, low: Simd<T, W, S>, left: bool) -> Simd<T, W, S> {
        Count::funnel(high.like(this), high, low, left)
    }
}
#[sealed]
impl<T: Int, W: Width, S: Isa> Count<T, W, S> for Simd<T, W, S> {
    #[inline(always)]
    fn left(this: Self, v: Self) -> Self {
        v.shl_each(this)
    }
    #[inline(always)]
    fn right(this: Self, v: Self) -> Self {
        v.shr_each(this)
    }
    #[op]
    fn rotate(this: Self, v: Self, left: bool) -> Self {
        if left { v.rol(this) } else { v.ror(this) }
    }
    #[op]
    fn round(this: Self, v: Self) -> Self {
        v.rounding_shr_each(this & T::from_usize(T::BITS as usize - 1))
    }
    #[op]
    fn unbounded(this: Self, v: Self, left: bool) -> Self {
        if_here!(
            S::SVE2 && T::BITS == 64,
            if (left || !T::IS_SIGNED) && !are_known!(this.raw) {
                return v.with_bytes(v.s.unbounded_shift64::<W>(v.bytes(), this.bytes(), left));
            }
        );
        let (count, bits) = (this.cast_unsigned(), T::Unsigned::from(T::BITS as u8));
        if const { S::AVX2 && !S::AVX512BW && T::BITS == 16 && W::BYTES >= 4 } && !left {
            return live!(S::AVX2 && !S::AVX512BW && T::BITS == 16 && W::BYTES >= 4, v.shr_in_pairs(this));
        }
        if const { S::AVX2 && !S::AVX512VL && T::BITS == 64 && T::IS_SIGNED } && !left {
            let sign = v.to_mask().to_simd::<T>();
            return v.with_bytes::<T>(v.s.shift_each::<W>((v ^ sign).bytes(), this.bytes(), (64, false))) ^ sign;
        }
        if T::IS_SIGNED && !left {
            return v >> count.simd_min(bits - Lane::ONE).bitcast::<T>();
        }
        if_here!(S::AVX2 && T::BITS >= 32, {
            return v.with_bytes(v.s.shift_each::<W>(v.bytes(), this.bytes(), (T::BITS, left)));
        });
        if_here!(S::AVX512BW && T::BITS == 16, {
            return v.with_bytes(v.s.shift_each16::<W>(v.bytes(), this.bytes(), (T::BITS, left)));
        });
        return_if!(S::NEON && T::BITS < 64, {
            let by = count.simd_min(bits).bitcast::<T>();
            v.shift_by_sign(if left { by } else { v.tag().zero() - by })
        });
        count.simd_lt(bits).select(if left { v << this } else { v >> this }, T::ZERO)
    }
    #[op]
    fn funnel(this: Self, high: Self, low: Self, left: bool) -> Self {
        if_here!(S::AVX512VBMI2 && T::BITS > 8, {
            return high.with_bytes(high.s.funnel::<W>(high.bytes(), low.bytes(), this.bytes(), (T::BITS, left)));
        });
        let (by, bits) = (this & T::from_usize(T::BITS as usize - 1), this.like(T::from_usize(T::BITS as usize)));
        return_if!(
            S::NEON,
            if left {
                high.shift_by_sign(by) | low.shift_by_sign(by - bits)
            } else {
                high.shift_by_sign(bits - by) | low.shift_by_sign(this.tag().zero() - by)
            }
        );
        return_if!(S::AVX2 && T::BITS >= 32 || S::AVX512BW && T::BITS == 16, {
            // LLVM would test for the one count that is too large.
            let rest = (bits - by).barrier();
            if left { high << by | low.unbounded_shr(rest) } else { high.unbounded_shl(rest) | low >> by }
        });
        if const { S::SSE2 && T::BITS == 16 || S::WASM && T::BITS < 64 } && left {
            let power = this.like(T::ONE) << this;
            return (high * power) | low.cast_unsigned().mul_high(power.cast_unsigned()).bitcast();
        }
        if left { high << this | low >> 1 >> !this } else { high << 1 << !this | low >> this }
    }
}

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    fns! {
        /// The bits of each lane, by `count` modulo their number.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = u8x2::from([0b1000_0001, 0b0100_0000]);
        /// assert_eq!(v.rotate_left(1), [0b0000_0011, 0b1000_0000]);
        /// assert_eq!(v.rotate_left(u8x2::from([0, 2])), [0b1000_0001, 0b0000_0001]);
        /// # } example()
        /// ```
        #[doc(alias("RotateLeft", "RotateLeftSame", "Rol", "rol"))]
        fn rotate_left(self, count: impl Count<T, W, S>) -> Self { Count::rotate(count, self, true) }
        /// The bits of each lane, by `count` modulo their number.
        #[doc(alias("RotateRight", "RotateRightSame", "Ror", "ror"))]
        fn rotate_right(self, count: impl Count<T, W, S>) -> Self { Count::rotate(count, self, false) }
        /// `(self + (1 << (count - 1))) >> count` without overflow, or `self` for 0. The count is modulo the number of bits.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x4::from([1, 2, 6, 255]).rounding_shr(2), [0, 1, 2, 64]);
        /// # } example()
        /// ```
        #[doc(alias("RoundingShiftRight", "RoundingShr", "RoundingShiftRightSame", "rounding_shift_right", "urshr", "srshr", "sqrshrn", "sqrshrun"))]
        fn rounding_shr(self, count: impl Count<T, W, S>) -> Self { Count::round(count, self) }
        /// The same, but the result is unspecified if the sum overflows. With one count on x86, that saves an instruction from 32 bits on,
        /// and `i16` takes an addition and a shift in the place of a multiplication.
        fn rounding_shr_relaxed(self, count: impl Count<T, W, S>) -> Self {
            return_if!(S::NEON || T::BITS == 8 || T::BITS == 16 && !T::IS_SIGNED, Count::round(count, self));
            let half = Count::left(count, self.like(T::ONE)).cast_unsigned() >> 1;
            Count::right(count, self + half.bitcast())
        }
    }
}

macro_rules! tree {
    ($v:ident, $reduce:ident, |$a:ident, $b:ident| $op:expr) => {
        choose! { |v: Self = $v|
            Self::LANES == 1 => v.get_lane(),
            W::BYTES > 16 => { let ($a, $b) = (v.lower_half(), v.upper_half()); ($op).$reduce() },
            _ => {
                let mut v = v;
                when!(Self::LANES > 8, { let ($a, $b) = (v, v.slide_down::<8>()); v = $op; });
                when!(Self::LANES > 4, { let ($a, $b) = (v, v.slide_down::<4>()); v = $op; });
                when!(Self::LANES > 2, { let ($a, $b) = (v, v.slide_down::<2>()); v = $op; });
                let ($a, $b) = (v, v.swap_pairs());
                ($op).get_lane()
            },
        }
    };
}
pub(crate) use tree;
/// From eight bytes on, in a general register.
macro_rules! bits { ($v:ident, $reduce:ident, $op:tt) => {{
    return_if!(W::BYTES > 8, ($v.lower_half() $op $v.upper_half()).$reduce());
    let mut x = if cfg!(target_endian = "big") {
        $v.s.fixed::<T, B8>().resize_any($v).reinterpret::<u64>().get_lane() >> (64 - 8 * W::BYTES.min(8))
    } else {
        $v.s.fixed::<u64, B8>().resize_any($v).get_lane()
    };
    if const { W::BYTES > 4 && T::BITS < 64 } { x = x $op x >> 32; }
    if const { W::BYTES > 2 && T::BITS < 32 } { x = x $op x >> 16; }
    if const { T::BITS < 16 } { x = x $op x >> 8; }
    T::from_u64(x)
}}; }

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    fns! {
        /// The bits that are set in all lanes.
        fn reduce_and(self) -> T { bits!(self, reduce_and, &) }
        /// The bits that are set in any lane.
        fn reduce_or(self) -> T { bits!(self, reduce_or, |) }
        /// The bits that are set in an odd number of lanes.
        fn reduce_xor(self) -> T { bits!(self, reduce_xor, ^) }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    const OF_FLOATS: bool = matches!(T::KIND, Kind::Float);
    /// `fminnm` and `fmaxnm` have the strict meaning.
    const STRICT_MIN: bool = !Self::OF_FLOATS || S::A64 && !Self::SOFT;
    const FMA: bool =
        S::HAS_FMA || cfg!(any(all(target_arch = "aarch64", target_feature = "neon"), target_feature = "fma"));

    /// `fmax` or `fmin`.
    #[on(A64 WASM)]
    #[op]
    pub(crate) fn fmax<const MAX: bool>(self, other: Self) -> Self {
        let (s, a, b) = (self.s, self.bytes(), other.bytes());
        self.with_bytes(choose! {
            T::BITS == 16 => s.or_nan_f16::<W>(a, b, MAX),
            T::BITS == 32 && MAX => s.max_or_nan_f32::<W>(a, b),
            T::BITS == 32 => s.min_or_nan_f32::<W>(a, b),
            MAX => s.max_or_nan_f64::<W>(a, b),
            _ => s.min_or_nan_f64::<W>(a, b),
        })
    }
    #[on(X86)]
    #[op]
    fn range(self, other: Self, max: bool) -> Self {
        let (a, b) = (self.bytes(), other.bytes());
        self.with_bytes(if const { T::BITS == 32 } {
            self.s.range_f32::<W>(a, b, max)
        } else {
            self.s.range_f64::<W>(a, b, max)
        })
    }
    /// Neither zero nor NaN, by integers, which LLVM compares if they are constants.
    #[op]
    fn each_ordinary(self) -> crate::MaskOf<T::Unsigned, W, S> {
        let infinity = (!0 >> (65 - T::BITS)) >> T::FRACTION << T::FRACTION;
        ((self.cast_unsigned() << 1u32) - T::Unsigned::ONE).simd_lt(T::Unsigned::from_u64(infinity << 1))
    }
    /// `other` if one is NaN or both are zero, but on NEON.
    #[op]
    pub(crate) fn lesser(self, other: Self) -> Self {
        choose! { Self::SOFT || (S::RELAXED || cfg!(all(target_feature = "vector-enhancements-1", not(miri)))) && T::IS_FLOAT => self.simd_lt(other).if_then_else(self, other), _ => self.simd_min_relaxed(other) }
    }
    #[op]
    pub(crate) fn greater(self, other: Self) -> Self {
        choose! { Self::SOFT || (S::RELAXED || cfg!(all(target_feature = "vector-enhancements-1", not(miri)))) && T::IS_FLOAT => self.simd_gt(other).if_then_else(self, other), _ => self.simd_max_relaxed(other) }
    }
    /// The same on all targets.
    #[op]
    pub(crate) fn if_less(self, other: Self) -> Self {
        choose! { crate::X86 || S::WASM => self.lesser(other), _ => self.simd_lt(other).if_then_else(self, other) }
    }
    #[op]
    pub(crate) fn if_greater(self, other: Self) -> Self {
        choose! { crate::X86 || S::WASM => self.greater(other), _ => self.simd_gt(other).if_then_else(self, other) }
    }
    const SIGNS: bool = matches!(T::KIND, Kind::Signed) && W::BYTES >= 16 && S::SSE41 && T::BITS <= 16;
    /// Of a minimum with 1 and a maximum with -1, LLVM would make two comparisons and a subtraction, or moves from masks.
    /// The test changes the code around limits that vary, so it is left to narrow lanes.
    #[on(X86)]
    #[op]
    fn before_limit(self, other: impl Operand<T, W, S>, limit: i64) -> Self {
        match Operand::number(other) {
            Some(number) => {
                core::hint::select_unpredictable(known(number == T::from_i64(limit)), self.barriers(), self)
            }
            None => self,
        }
    }
    #[on(X86)]
    #[op]
    pub(crate) fn barriers(self) -> Self {
        halves_if!(W::BYTES > S::REGISTER, |v: Self = self| v.tag().combine(v.upper_half().barriers(), v.lower_half().barriers()));
        self.barrier()
    }
    #[op]
    fn fused(self, mul: Self, add: Self) -> Self {
        if_here!(S::RELAXED && Self::OF_FLOATS && T::BITS >= 32, {
            // An engine makes one choice for the whole run. The product is 2^FRACTION squared less 1.
            let (d, n) = (self.s.fixed::<T, crate::B16>(), 1 << T::FRACTION);
            let [a, b, c] =
                [d.set(T::from_i64(n + 1)), d.set(T::from_i64(n - 1)), d.set(T::from_i64(n)) * d.set(T::from_i64(-n))];
            if !a.with_bytes::<T>(self.s.fma_relaxed::<crate::B16>(a.bytes(), b.bytes(), c.bytes(), T::BITS)).is_zero()
            {
                return self.with_bytes(self.s.fma_relaxed::<W>(self.bytes(), mul.bytes(), add.bytes(), T::BITS));
            }
            core::hint::cold_path();
        });
        choose! {
            Self::SOFT => T::fused(self, mul, add),
            !Self::OF_FLOATS || S::HAS_FMA => self.mul_add_relaxed(mul, add),
            Self::FMA => self.with(crate::raw::Raw::fma(self.raw, mul.raw, add.raw)),
            T::BITS == 32 => self.bitcast::<f32>().fused_by_f64(mul.bitcast(), add.bitcast()).bitcast(),
            _ => self.bitcast::<f64>().fused_in_parts(mul.bitcast(), add.bitcast()).bitcast(),
        }
    }

    fns! {
        /// The lesser. If one is NaN, the other, and `-0.0` is less than `0.0`: `minimumNumber` of IEEE 754. But a signaling
        /// NaN can give NaN, so that a chain of these loses the other one: `over(x).min()` doesn't. For floats on x86, [`simd_min_relaxed`](Self::simd_min_relaxed) is one instruction, and this up to eight.
        /// For integers in 64 bytes, see [slow operations](crate::guide::speed#slow-operations).
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([1.0, f32::NAN]).simd_min([2.0, 3.0]), [1.0, 3.0]);
        /// # } example()
        /// ```
        #[doc(alias("min", "MinNumber", "min_number"))]
        fn simd_min(self, other: impl Operand<T, W, S>) -> Self {
            return_if!(Self::CHAINS, self.simd_min_relaxed(other));
            return_if!(crate::X86 && Self::SIGNS, self.before_limit(other, 1).lesser(self.like(other)));
            let other = self.like(other);
            return_if!(Self::SOFT, T::extreme::<false, true, S, W>(self, other));
            return_if!(Self::STRICT_MIN, self.lesser(other));
            live!(!Self::SOFT && !Self::STRICT_MIN, apart!(self.s, {
            if crate::OPTIMIZED && known(other.each_ordinary().all()) {
                return self.lesser(other);
            }
            return_if!(S::AVX512DQ && !Self::HALF, self.range(other, false));
            // The selection comes last, so that the comparisons don't wait for each other.
            other.simd_eq(other).if_then_else(self.lesser(other) | self.simd_eq(other).if_then_else_zero(self), self)
        })) }
        /// The greater. If one is NaN, the other, and `0.0` is greater than `-0.0`: `maximumNumber` of IEEE 754. But a
        /// signaling NaN can give NaN, as in [`simd_min`](Self::simd_min). For floats on x86, [`simd_max_relaxed`](Self::simd_max_relaxed) is one instruction, and this up to eight.
        #[doc(alias("max", "MaxNumber", "max_number"))]
        fn simd_max(self, other: impl Operand<T, W, S>) -> Self {
            return_if!(Self::CHAINS, self.simd_max_relaxed(other));
            return_if!(crate::X86 && Self::SIGNS, self.before_limit(other, -1).greater(self.like(other)));
            let other = self.like(other);
            return_if!(Self::SOFT, T::extreme::<true, true, S, W>(self, other));
            return_if!(Self::STRICT_MIN, self.greater(other));
            live!(!Self::SOFT && !Self::STRICT_MIN, apart!(self.s, {
            if crate::OPTIMIZED && known((other.cast_unsigned().simd_eq(T::Unsigned::ZERO) | other.each_ordinary()).all()) {
                return self.greater(other);
            }
            return_if!(S::AVX512DQ && !Self::HALF, self.range(other, true));
            other.simd_eq(other).if_then_else(self.greater(other) & (self.simd_ne(other).to_simd::<T>() | self), self)
        })) }
        /// `min` where `self < min`, `max` where what results is greater than `max`, and `self` elsewhere, as for NaN, which can become quiet.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i16x4::from([-9, 0, 100, 300]).simd_clamp(0, 255), [0, 0, 100, 255]);
        /// # } example()
        /// ```
        #[doc(alias("clamp"))]
        fn simd_clamp(self, min: impl Operand<T, W, S>, max: impl Operand<T, W, S>) -> Self {
            return_if!(Self::CHAINS || crate::X86 && Self::SIGNS, self.simd_max(min).simd_min(max));
            return_if!(S::A64 && Self::OF_FLOATS && !Self::SOFT && crate::OPTIMIZED, {
                // These order zeros by their sign.
                let plain = always!(|n: Option<T>| matches!(n, Some(n) if known(n > T::ZERO) || known(n < T::ZERO)));
                let (low, high, min, max) = (plain(Operand::number(min)), plain(Operand::number(max)), self.like(min), self.like(max));
                let v = if low { self.fmax::<true>(min) } else { self.simd_lt(min).if_then_else(min, self) };
                if high { v.fmax::<false>(max) } else { v.simd_gt(max).if_then_else(max, v) }
            });
            let (min, max) = (self.like(min), self.like(max));
            choose! {
                !Self::OF_FLOATS => self.simd_clamp_relaxed(min, max),
                const { S::A64 } => {
                    let v = self.simd_lt(min).if_then_else(min, self);
                    v.simd_gt(max).if_then_else(max, v)
                },
                _ => max.lesser(min.greater(self)),
            }
        }
        /// The least lane, by [`simd_min`](Self::simd_min). A signaling NaN can hide other lanes.
        #[doc(alias("horizontal_min"))]
        fn reduce_min(self) -> T {
            return_if!(Self::HALF && !Self::STRICT_MIN, T::across::<false, S, W>(self));
            return_if!(Self::BY_KEYS, self.splat_min().get_lane());
            choose! { Self::STRICT_MIN => self.reduce_min_relaxed(), _ => tree!(self, reduce_min, |a, b| a.simd_min(b)) }
        }
        /// The greatest lane, by [`simd_max`](Self::simd_max). A signaling NaN can hide other lanes.
        #[doc(alias("horizontal_max"))]
        fn reduce_max(self) -> T {
            return_if!(Self::HALF && !Self::STRICT_MIN, T::across::<true, S, W>(self));
            return_if!(Self::BY_KEYS, self.splat_max().get_lane());
            choose! { Self::STRICT_MIN => self.reduce_max_relaxed(), _ => tree!(self, reduce_max, |a, b| a.simd_max(b)) }
        }
        /// Floating-point numbers are multiplied as a tree: the upper half with the lower half, and so on.
        fn reduce_product(self) -> T { tree!(self, reduce_product, |a, b| a * b) }
        /// `self * mul + add`, rounded once. Without the instruction this takes 30 to 60 others, and up to 250 for 16 bits: see
        /// [`mul_add_relaxed`](Self::mul_add_relaxed). To negate a factor costs nothing, nor `add` on x86.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([2.0, 3.0]).mul_add(10.0, [1.0, 2.0]), [21.0, 32.0]);
        /// # } example()
        /// ```
        #[doc(alias("fma", "NegMulAdd", "MulSub", "NegMulSub", "neg_mul_add", "mul_sub", "neg_mul_sub"))]
        fn mul_add(self, mul: impl Operand<T, W, S>, add: impl Operand<T, W, S>) -> Self {
            self.fused(self.like(mul), self.like(add))
        }
        /// `self * mul - other` in even lanes and `self * mul + other` in odd lanes, rounded once.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([2.0, 3.0]).mul_add_sub(10.0, 1.0), [19.0, 31.0]);
        /// # } example()
        /// ```
        fn mul_add_sub(self, mul: impl Operand<T, W, S>, other: impl Operand<T, W, S>) -> Self {
            return_if!(!Self::OF_FLOATS || S::HAS_FMA && !Self::SOFT, self.mul_add_sub_relaxed(mul, other));
            self.fused(self.like(mul), self.like(other).neg_alternating::<false>())
        }
        /// `self * mul + other` in even lanes and `self * mul - other` in odd lanes, rounded once.
        fn mul_sub_add(self, mul: impl Operand<T, W, S>, other: impl Operand<T, W, S>) -> Self {
            return_if!(!Self::OF_FLOATS || S::HAS_FMA && !Self::SOFT, self.mul_sub_add_relaxed(mul, other));
            self.fused(self.like(mul), self.like(other).neg_alternating::<true>())
        }
    }
}

impl<S: Isa, W: Width> Simd<f32, W, S> {
    /// The product is exact in `f64`. After a sum that is rounded to odd, it doesn't matter that there are two steps.
    #[inline(always)]
    fn fused_by_f64(self, mul: Self, add: Self) -> Self {
        apart!(self.s, {
            // Two roundings differ from one only if the first ends in the middle of two values of `f32`. Subnormal ones are further apart.
            if_here!(S::SSE2 && crate::OPTIMIZED && W::BYTES == 16 && S::REGISTER == 16, {
                let d = self.s.fixed::<f64, W::Twice>();
                let sum = d.cast(self) * d.cast(mul) + d.cast(add);
                let [a, b] = sum.bitcast::<u32>().split();
                let [low, high] = a.deinterleave(b);
                let hard = (low & 0x1fff_ffff).simd_eq(0x1000_0000) | (high + high - 1).simd_lt(0x381 << 21);
                if hard.to_vector().is_negative().none() {
                    return self.tag().cast(sum);
                }
                core::hint::cold_path();
            });
            return_if!(W::BYTES > 8 && 2 * W::BYTES > S::REGISTER, {
                let lower = self.lower_half().fused_by_f64(mul.lower_half(), add.lower_half());
                self.tag().combine(self.upper_half().fused_by_f64(mul.upper_half(), add.upper_half()), lower)
            });
            let d = self.s.fixed::<f64, W::Twice>();
            self.tag().cast((d.cast(self) * d.cast(mul)).add_to_odd(d.cast(add)))
        })
    }
}

impl<S: Isa, W: Width> Simd<f64, W, S> {
    /// The sum, and what it lost.
    #[op]
    pub(crate) fn exact_sum(self, other: Self) -> (Self, Self) {
        let sum = self + other;
        let part = sum - self;
        (sum, (self - (sum - part)) + (other - part))
    }
    #[inline(always)]
    pub(crate) fn add_to_odd(self, other: Self) -> Self {
        apart!(self.s, {
            let (sum, lost) = self.exact_sum(other);
            let inexact = lost.abs().simd_gt(0.0).to_vector().cast_unsigned() >> 63;
            let too_large = (lost ^ sum).cast_unsigned() >> 63 & inexact;
            ((sum.cast_unsigned() - too_large) | inexact).bitcast()
        })
    }
    /// The product, and what it lost unless it is tiny.
    #[inline(always)]
    pub(crate) fn exact_product(self, mul: Self) -> (Self, Self) {
        apart_unoptimized!(self.s, {
            return_if!(S::HAS_FMA, (self * mul, self.mul_sub(mul, self * mul)));
            // Ties go down, or the subnormal number with only bit 26 would be doubled.
            let upper = always!(|v: Self| ((v.cast_unsigned() + ((1u64 << 26) - 1)) & (!0u64 << 27)).bitcast::<f64>());
            let (a, b, product) = (upper(self), upper(mul), self * mul);
            let (c, d) = (self - a, mul - b);
            (product, a * b - product + a * d + c * b + c * d)
        })
    }
    /// Boldo and Melquiond, "Emulation of FMA and correctly rounded sums". An overflow on the way ends in NaN.
    #[inline(always)]
    fn fused_in_parts(self, mul: Self, add: Self) -> Self {
        apart_unoptimized!(self.s, {
            let (product, low) = self.exact_product(mul);
            let (high, low) = add.exact_sum(low);
            let (sum, lost) = product.exact_sum(high);
            let tiny = product.abs().simd_lt(1e-270);
            let result = tiny.if_then_else(product + add, sum + low.add_to_odd(lost));
            let fine = (!tiny | self.simd_eq(0.0) | mul.simd_eq(0.0)) & result.abs().simd_le(f64::MAX);
            if fine.all() {
                return result;
            }
            let mut lanes = self.to_array();
            fused_one_by_one(lanes.as_mut(), mul.to_array().as_ref(), add.to_array().as_ref(), crate::Round::TiesEven);
            self.tag().from_array(lanes)
        })
    }
}

/// In integers, without the C library. What cancels is `0.0`, which is wrong for `Down`.
#[cold]
#[inline(never)]
pub(crate) fn fused_one_by_one(lanes: &mut [f64], mul: &[f64], add: &[f64], mode: crate::Round) {
    let split = |v: f64| {
        let (e, m) = ((v.to_bits() >> 52 & 0x7ff) as i32, (v.to_bits() & !(!0 << 52)) as u128);
        if e == 0 { (m, -1074) } else { (m | 1 << 52, e - 1075) }
    };
    let normal = |(m, e): (u128, i32)| {
        let by = m.leading_zeros() as i32 - 3;
        (m << by, e - by)
    };
    // The lowest bit is set if any of those that drop out is.
    let shift = |m: u128, by: i32| if by >= 127 { (m != 0) as u128 } else { m >> by | (m & !(!0 << by) != 0) as u128 };
    for ((lane, &y), &z) in lanes.iter_mut().zip(mul).zip(add) {
        let x = *lane;
        if !(x.is_finite() && y.is_finite()) || x == 0.0 || y == 0.0 {
            *lane = x * y + z;
            continue;
        }
        if !z.is_finite() {
            *lane = z;
            continue;
        }
        let ((mx, ex), (my, ey)) = (split(x), split(y));
        let ((mut m, mut e), mut negative) = (normal((mx * my, ex + ey)), (x < 0.0) != (y < 0.0));
        if z != 0.0 {
            let (mz, ez) = normal(split(z));
            let signed = |m: u128, negative: bool| if negative { -(m as i128) } else { m as i128 };
            let sum = signed(shift(m, e.max(ez) - e), negative) + signed(shift(mz, e.max(ez) - ez), z < 0.0);
            (m, e, negative) = (sum.unsigned_abs(), e.max(ez), sum < 0);
        }
        if m == 0 {
            *lane = 0.0;
            continue;
        }
        // To 53 bits, or fewer for a subnormal number. A carry goes into the exponent.
        let drop = (75 - m.leading_zeros() as i32).max(-1074 - e);
        let wide = if drop >= 2 { shift(m, drop - 2) } else { m << (2 - drop) };
        let (near, away) =
            (mode == crate::Round::TiesEven, mode == if negative { crate::Round::Down } else { crate::Round::Up });
        let more = if near { wide & 3 == 3 || wide & 7 == 6 } else { away && wide & 3 != 0 };
        let rounded = ((wide >> 2) + more as u128) as u64;
        let large = (0x7ff << 52) - !(near || away) as u64;
        let bits = if e + drop > 971 { large } else { (((e + drop + 1074) as u64) << 52) + rounded };
        *lane = f64::from_bits(bits | (negative as u64) << 63);
    }
}

impl<S: Isa, T: HasSign, W: Width> Simd<T, W, S> {
    fns! {
        /// `-self` where the sign bit of `sign` is set, and `self` elsewhere.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i8x4::from([1, 2, -3, 4]).neg_if_negative([-1, 0, -7, 7]), [-1, 2, 3, 4]);
        /// # } example()
        /// ```
        #[doc(alias("IfNegativeThenNegOrUndefIfZero", "if_negative_then_neg"))]
        fn neg_if_negative(self, sign: impl Operand<T, W, S>) -> Self { self.like(sign).if_negative_then_neg(self) }
    }
}

impl<S: Isa, T: Signed, W: Width> Simd<T, W, S> {
    fns! {
        /// [`neg_if_negative`](Self::neg_if_negative), but either `self` or zero where `sign` is zero. On `sse4` and `avx2` it is zero, except
        /// in `i64`: one instruction for `self * sign.signum()`, which took up to 3 times as long there. This was the fastest on each target:
        ///
        /// ```
        /// # #[bun_simd::simd] mod simd {
        /// # use bun_simd::prelude::*;
        /// fn times_sign(v: i8xN<S>, sign: i8xN<S>) -> i8xN<S> {
        ///     pick! {
        ///         avx512 => sign.simd_ne(0).select(v.neg_if_negative_relaxed(sign), 0),
        ///         sse4 => v.neg_if_negative_relaxed(sign),
        ///         _ => v * sign.signum(),
        ///     }
        /// }
        /// # #[kernel]
        /// # pub fn all(v: &mut [i8], signs: &[i8]) { over_mut(v).zip(signs).map(|(v, sign)| times_sign(v, sign)) }
        /// # }
        /// # fn main() {
        /// # let mut v = [5; 3];
        /// # simd::all(&mut v, &[-9, 0, 9]);
        /// # assert_eq!(v, [-5, 0, 5]);
        /// # }
        /// ```
        #[doc(alias("psign", "psignb", "psignw", "psignd", "mul_sign", "ternary", "if_negative_then_neg_or_undef_if_zero"))]
        fn neg_if_negative_relaxed(self, sign: impl Operand<T, W, S>) -> Self { self.like(sign).if_negative_then_neg_or_undef_if_zero(self) }
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    fns! {
        /// The bits of each lane.
        fn to_bits(self) -> Simd<T::Unsigned, W, S> { self.bitcast() }
        /// `1 / self`.
        fn recip(self) -> Self { self.tag().set(T::from_f64(1.0)) / self }
        /// `1 / self.sqrt()`.
        fn recip_sqrt(self) -> Self { self.sqrt().recip() }
        /// `floor(log2(|self|))`. It is negative infinity for zero, infinity for infinity, and NaN for NaN.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x4::from([1.0, 1000.0, -0.3, 0.0]).exponent(), [0.0, 9.0, -2.0, f32::NEG_INFINITY]);
        /// # } example()
        /// ```
        #[doc(alias("logb", "frexp", "mantissa", "getmant", "getexp"))]
        fn exponent(self) -> Self {
            return_if!(Self::X86_HALF, self.exponent_relaxed());
            crate::half::in_f32!(@ Self::SOFT, false, self => |x| x.exponent());
            return_if!(S::AVX512VL, self.exponent_relaxed());
            return_if!(S::SVE2 && T::BITS == 32, self.with_bytes(self.s.exponent_f32::<W>(self.bytes())));
            return_if!(S::SVE2 && T::BITS == 64, self.with_bytes(self.s.exponent_f64::<W>(self.bytes())));
            let (by, times) = if const { Self::HALF } { (10.0, 1024.0) } else { (64.0, 18446744073709551616.0) };
            let (v, by) = (self.abs(), T::from_f64(by));
            let small = v.simd_lt(Self::least_normal());
            let normal = small.if_then_else(v * T::from_f64(times), v).exponent_relaxed() - small.if_then_else_zero(by);
            v.simd_le(T::MAX).if_then_else(v.simd_eq(T::default()).if_then_else(T::from_f64(f64::NEG_INFINITY), normal), v)
        }
        /// `self * 2^floor(exponent)`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f32x2::from([1.5, 8.0]).ldexp_floor([2.9, -0.5]), [6.0, 4.0]);
        /// # } example()
        /// ```
        #[doc(alias("MulByFloorPow2", "mul_by_floor_pow2", "scalef"))]
        fn ldexp_floor(self, exponent: impl Operand<T, W, S>) -> Self {
            return_if!(Self::X86_HALF, self.simd_eq(self).if_then_else(self.mul_by_floor_pow2(exponent), self));
            crate::half::in_f32!(half self, self.like(exponent) => |x, by| x.ldexp_floor(by));
            let scaled = self.mul_by_floor_pow2(exponent);
            choose! { S::AVX512VL => self.simd_eq(self).if_then_else(scaled, self), _ => scaled }
        }
        /// The same, but unspecified unless the power of two is a normal number. It is one instruction with AVX-512, and four elsewhere.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(f64x2::from([1.5, 8.0]).ldexp_floor_relaxed([2.9, -0.5]), [6.0, 4.0]);
        /// # } example()
        /// ```
        fn ldexp_floor_relaxed(self, exponent: impl Operand<T, W, S>) -> Self {
            let exponent = self.like(exponent);
            return_if!(Self::X86_HALF, self.mul_by_floor_pow2(exponent));
            crate::half::in_f32!(@ Self::SOFT, false, self, exponent => |x, by| x.ldexp_floor_relaxed(by));
            return_if!(S::AVX512VL, self.mul_by_floor_pow2(exponent));
            return_if!(S::SVE2 && !Self::HALF, self.ldexp(self.tag().to_signed().convert_in_range_to(exponent.floor())));
            // The sum has the biased exponent in its lowest bits.
            let bias = (1u64 << T::FRACTION) + (1 << (T::BITS - T::FRACTION - 2)) - 1;
            self * ((exponent.floor() + T::from_f64(bias as f64)).cast_unsigned() << T::FRACTION).bitcast::<T>()
        }
    }
}

macro_rules! fixed_point { ($($t:ident $bits:literal $mul:ident $relaxed:ident $add:ident $add_relaxed:ident;)*) => {$(
    impl<S: Isa, W: Width> Simd<$t, W, S> { fns! {
        #[doc = concat!("`(self * other + (1 << ", $bits, " - 1)) >> ", $bits, "` with saturation, which matters only if both are the lowest value.")]
        /// With a constant that is not the lowest value, it is as fast as the relaxed form.
        fn $mul(self, other: impl Operand<$t, W, S>) -> Self {
            let other = self.like(other);
            let product = self.$relaxed(other);
            if const { S::NEON } || crate::OPTIMIZED && known(other.simd_ne($t::MIN).all()) {
                return product;
            }
            return_if!(S::HAS_MASKED_MEMORY, product.simd_eq($t::MIN).select($t::MAX, product));
            product ^ product.simd_eq($t::MIN).to_vector()
        }
        /// `add` plus that product. Only the sum saturates.
        fn $add(self, mul: impl Operand<$t, W, S>, add: impl Operand<$t, W, S>) -> Self {
            let mul = self.like(mul);
            if const { S::RDM } || crate::OPTIMIZED && known(mul.simd_ne($t::MIN).all()) {
                return self.$add_relaxed(mul, add);
            }
            return_if!(X86 || !S::NEON && !cfg!(target_arch = "wasm32"), {
                // The product wraps.
                self.like(add).saturating_sub(-self.$relaxed(mul))
            });
            let both = (self.simd_eq($t::MIN) & mul.simd_eq($t::MIN)).to_vector();
            self.like(add).saturating_add(self.$mul(mul)).saturating_sub(both)
        }
    } }
)*}; }
fixed_point! {
    i16 15 mul_q15 mul_q15_relaxed mul_q15_add mul_q15_add_relaxed;
    i32 31 mul_q31 mul_q31_relaxed mul_q31_add mul_q31_add_relaxed;
}

impl<S: Isa, W: Width> Simd<i16, W, S> {
    fns! {
        /// `(self * factor) >> 15` with saturation. If the factor is a constant in `-0x4000..0x4000`, this is one
        /// instruction on all targets, which [`mul_high`](Self::mul_high) isn't on NEON. Above that it is two on x86.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(i16x2::from([1000, -1000]).mul_high_doubled(0x2000), [250, -250]);
        /// # } example()
        /// ```
        fn mul_high_doubled(self, factor: impl Operand<i16, W, S>) -> Self {
            let factor = self.like(factor);
            if const { S::NEON } || crate::OPTIMIZED && known((factor.simd_ge(-0x4000) & factor.simd_lt(0x4000)).all()) {
                return self.mul_high_doubled_relaxed(factor);
            }
            // Twice the factor is 65536 more than its lower half.
            if crate::OPTIMIZED && known(factor.simd_ge(0x4000).all()) {
                return self + self.mul_high(factor + factor);
            }
            let high = self.mul_high(factor);
            high.saturating_add(high) | ((self * factor).cast_unsigned() >> 15).cast_signed()
        }
    }
}

impl<S: Isa, W: Width> Simd<i32, W, S> {
    fns! {
        /// `(self * factor) >> 31` with saturation. It is one instruction on NEON only.
        fn mul_high_doubled(self, factor: impl Operand<i32, W, S>) -> Self {
            let factor = self.like(factor);
            if const { S::NEON } || crate::OPTIMIZED && known((factor.simd_ge(-0x4000_0000) & factor.simd_lt(0x4000_0000)).all()) {
                return self.mul_high_doubled_relaxed(factor);
            }
            let product = choose! {
                S::SSE41 && W::BYTES >= 16 => {
                    let (even, odd) = (self.widening_mul_even(factor).cast_unsigned(), self.widening_mul_odd(factor));
                    (odd + odd).bitcast::<i32>().odd_even((even >> 31).bitcast())
                },
                _ => {
                    let high = self.mul_high(factor);
                    (high + high) | ((self * factor).cast_unsigned() >> 31).cast_signed()
                },
            };
            product ^ product.simd_eq(i32::MIN).into_vector()
        }
    }
}
