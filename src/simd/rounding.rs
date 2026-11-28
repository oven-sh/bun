//! Arithmetic that rounds in a direction. AVX-512 has it in the instruction. Elsewhere the nearest number is computed, and
//! what it lost decides a step to its neighbor.

use crate::f16;
use crate::{Float, Isa, Lane, MaskOf, Operand, Scaled, Simd, Width};
use core::ops::{Add, Div, Mul, Sub};

/// Where a result goes that is between two numbers. See [`rounding`](Simd::rounding).
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash)]
#[doc(alias("RoundingMode", "fesetround", "_MM_FROUND"))]
pub enum Round {
    /// To the nearest, or else the even one, as the operators do.
    TiesEven,
    /// Toward negative infinity.
    Down,
    /// Toward infinity.
    Up,
    /// Toward zero.
    TowardZero,
}
use Round::*;

/// A vector whose next operation rounds in a direction, as IEEE 754 has it: `+ - * /` and the methods. What is too large becomes the
/// greatest number unless the direction leads to infinity, and `x - x` is `-0.0` for [`Down`](Round::Down).
///
/// With registers of 64 bytes most are one instruction.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (a, b) = (f32x2::from([1.0, -1.0]), f32x2::splat(3.0));
/// let (lower, upper) = (a.rounding(Round::Down) / b, a.rounding(Round::Up) / b);
/// assert_eq!(lower.next_up(), upper);
/// assert_eq!(a.rounding(Round::TowardZero) + 1e-9, [1.0, -0.99999994]);
/// # } example()
/// ```
pub struct Rounding<T: Lane, W: Width, S: Isa>(Simd<T, W, S>, Round);
impl<T: Lane, W: Width, S: Isa> Copy for Rounding<T, W, S> {}
impl<T: Lane, W: Width, S: Isa> Clone for Rounding<T, W, S> {
    #[inline(always)]
    fn clone(&self) -> Self {
        *self
    }
}

pub(crate) const ADD: u8 = 0;
pub(crate) const MUL: u8 = 1;
pub(crate) const DIV: u8 = 2;
pub(crate) const SQRT: u8 = 3;
pub(crate) const MUL_ADD: u8 = 4;

const fn zmm<S: Isa>() -> bool {
    S::AVX512DQ && S::REGISTER == 64 && !cfg!(miri)
}
/// The bits of the mantissa, or of an integer.
const fn digits<T: Lane>() -> u32 {
    if T::IS_FLOAT { T::FRACTION + 1 } else { T::BITS - T::IS_SIGNED as u32 }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    /// A view whose operations round in the direction of `mode`, for bounds of intervals, and to do what other hardware does. It changes no state of the CPU.
    /// Without registers of 64 bytes an operation takes about 10 instructions, `mul_add` 50 to 60, and more without FMA. For a bound that need not be the closest, there are `next_up` and `next_down`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// let v = f64x2::from([0.1, -0.1]);
    /// assert_eq!(v.rounding(Round::Down).cast::<f32>(), [0.099999994, -0.1]);
    /// assert_eq!(v.rounding(Round::Up).mul_add(10.0, 0.0), [1.0000000000000002, -1.0]);
    /// # } example()
    /// ```
    #[doc(alias(
        "rounding_mode", "directed_rounding", "embedded_rounding", "interval", "add_round", "round_down", "round_up",
        "mxcsr"
    ))]
    #[inline(always)]
    pub fn rounding(self, mode: Round) -> Rounding<T, W, S> {
        Rounding(self, mode)
    }

    /// The next number in the direction, where `beyond` is true. There a zero has the sign of the direction.
    #[op]
    fn step(self, beyond: MaskOf<T, W, S>, mode: Round) -> Self {
        let (bits, one) = (self.cast_signed(), T::Signed::ONE);
        let up = bits.is_negative().to_vector() | one;
        match mode {
            TowardZero if const { !S::HAS_MASKED_MEMORY } => bits + beyond.to_vector(),
            TowardZero => beyond.if_then_else(bits - one, bits),
            Up if const { !S::HAS_MASKED_MEMORY } => bits + beyond.if_then_else_zero(up),
            Up => beyond.if_then_else(bits + up, bits),
            _ if const { !S::HAS_MASKED_MEMORY } => bits - beyond.if_then_else_zero(up),
            _ => beyond.if_then_else(bits - up, bits),
        }
        .bitcast()
    }
    /// With the sign that makes the direction from `near` up.
    #[op]
    fn turned(self, near: Self, mode: Round) -> Self {
        let sign = self.tag().sign_bit();
        match mode {
            Down => self ^ sign,
            TowardZero => self ^ near.and_not(sign),
            _ => self,
        }
    }
    /// Whether `self * other + add` is negative before it is rounded. A zero factor and a zero `add` have to give terms of opposite signs.
    #[op]
    fn negative(self, other: Self, add: Self) -> MaskOf<T, W, S> {
        return_if!(!S::HAS_FMA && T::BITS == 32, {
            halves_if!(W::BYTES > 8 && 2 * W::BYTES > S::REGISTER, |a: Self = self, b: Self = other, c: Self = add| {
                let upper = a.upper_half().negative(b.upper_half(), c.upper_half()).to_vector();
                a.tag().to_signed().combine(upper, a.lower_half().negative(b.lower_half(), c.lower_half()).to_vector()).to_mask()
            });
            crate::raw::same(
                (self.cast::<f64>() * other.cast::<f64>()).simd_lt(-add.cast::<f64>()).rebind::<T::Signed>(),
            )
        });
        // What underflows keeps its sign. NaN is above negative infinity.
        let infinity = self.tag().set(T::from_f64(f64::NEG_INFINITY)).cast_signed();
        self.mul_add(other, add).cast_signed().simd_lt(infinity + T::Signed::ONE)
    }
    #[op]
    fn sum(
        self, // Take reduce_sum.
        other: Self,
        mode: Round,
    ) -> Self {
        let sign = self.tag().sign_bit();
        let near = if mode == Down { ((self ^ sign) - other) ^ sign } else { self + other };
        // One of the differences is exact, and the other is not on the wrong side.
        let (a, b, sum) = if mode == TowardZero {
            (self ^ (near & sign), other ^ (near & sign), sign.and_not(near))
        } else {
            (self, other, near)
        };
        let (c, d) = (sum - b, sum - a);
        near.step(if mode == Up { a.simd_gt(c) | b.simd_gt(d) } else { a.simd_lt(c) | b.simd_lt(d) }, mode)
    }
    #[op]
    fn root(self) -> Self {
        choose! { T::BITS == 32 => self.bitcast::<f32>().sqrt().bitcast(), _ => self.bitcast::<f64>().sqrt().bitcast() }
    }
    #[op]
    fn rounded<const OP: u8>(self, b: Self, c: Self, mode: Round) -> Self {
        halves_if!(W::BYTES > 64 || Self::HALF && !(zmm::<S>() && Self::X86_HALF) && W::BYTES > 8 && 2 * W::BYTES > S::REGISTER, |a: Self = self, b: Self = b, c: Self = c, mode: Round = mode| {
            let upper = a.upper_half().rounded::<OP>(b.upper_half(), c.upper_half(), mode);
            a.tag().combine(upper, a.lower_half().rounded::<OP>(b.lower_half(), c.lower_half(), mode))
        });
        return_if!(Self::X86_HALF && zmm::<S>(), |a: Self = self, b: Self = b, c: Self = c, mode: Round = mode| {
            let wide = always!(|v: Self| v.resize::<crate::B64>().bytes());
            let all = a.s.rounded_f16(wide(a), wide(b), wide(c), (OP, mode));
            a.resize::<crate::B64>().with_bytes::<T>(all).resize()
        });
        // Twice in one direction is as good as once.
        return_if!(Self::HALF, |a: Self = self, b: Self = b, c: Self = c, mode: Round = mode| {
            a.cast::<f32>().rounded::<OP>(b.cast(), c.cast(), mode).converted::<T, W>(mode)
        });
        // A division of fewer lanes is so much faster that it pays for the rest.
        return_if!(zmm::<S>() && (W::BYTES == 64 || OP != DIV && OP != SQRT), |a: Self = self, b: Self = b, c: Self = c, mode: Round = mode| {
            let wide = always!(|v: Self| v.resize::<crate::B64>().bytes());
            let all = a.s.rounded(wide(a), wide(b), wide(c), (OP, T::BITS == 64, mode));
            a.resize::<crate::B64>().with_bytes::<T>(all).resize()
        });
        apart!(self.s, {
            let sign = self.tag().sign_bit();
            choose! {
                OP == ADD => self.sum(b, mode),
                OP == MUL => {
                    let near = self * b;
                    near.step((self.turned(near, mode) ^ sign).negative(b, near.turned(near, mode)), mode)
                },
                OP == DIV => {
                    let near = self / b;
                    let a = self ^ (b & sign) ^ sign;
                    near.step(near.turned(near, mode).negative(sign.and_not(b), a.turned(near, mode)), mode)
                },
                OP == SQRT => {
                    let (near, a) = (self.root(), sign.and_not(self));
                    near.step(if mode == Up { near.negative(near, a ^ sign) } else { (near ^ sign).negative(near, a) }, mode)
                },
                T::BITS == 32 => {
                    halves_if!(W::BYTES > 8 && 2 * W::BYTES > S::REGISTER, |a: Self = self, b: Self = b, c: Self = c, mode: Round = mode| {
                        let upper = a.upper_half().rounded::<OP>(b.upper_half(), c.upper_half(), mode);
                        a.tag().combine(upper, a.lower_half().rounded::<OP>(b.lower_half(), c.lower_half(), mode))
                    });
                    (self.cast::<f64>() * b.cast::<f64>()).sum(c.cast(), mode).converted::<T, W>(mode)
                },
                _ => self.bitcast::<f64>().fused_toward(b.bitcast(), c.bitcast(), mode).bitcast(),
            }
        })
    }
    /// To as many lanes of `U`, which is a float that can't hold all values.
    #[op]
    fn converted<U: Lane, X: Width>(self, mode: Round) -> Simd<U, X, S> {
        let d = self.s.fixed::<U, X>();
        halves_if!(W::BYTES > 64 || X::BYTES > 64, |v: Self = self, mode: Round = mode| {
            let d = v.s.fixed::<U, X>();
            d.combine(v.upper_half().converted::<U, X::Half>(mode), v.lower_half().converted::<U, X::Half>(mode))
        });
        return_if!(U::BITS == 16 && !(T::IS_FLOAT && T::BITS == 32), {
            halves_if!(X::BYTES > 32, |v: Self = self, mode: Round = mode| {
                let d = v.s.fixed::<U, X>();
                d.combine(v.upper_half().converted::<U, X::Half>(mode), v.lower_half().converted::<U, X::Half>(mode))
            });
            let single =
                choose! { T::BITS <= 16 => self.cast::<f32>().same(), _ => self.converted::<f32, X::Twice>(mode) };
            single.converted::<U, X>(mode)
        });
        return_if!(zmm::<S>() && (U::BITS >= 32 || U::FRACTION == 10 && W::BYTES == 64), {
            let wide = self.resize::<crate::B64>();
            let how = (if T::IS_FLOAT { 0 } else { 1 + T::IS_SIGNED as u8 }, T::BITS == 64, U::BITS == 64, mode);
            wide.with_bytes::<U>(self.s.converted(wide.bytes(), how)).resize()
        });
        return_if!(S::F16C && U::BITS == 16 && U::FRACTION == 10, {
            halves_if!(W::BYTES > 32, |v: Self = self, mode: Round = mode| {
                let d = v.s.fixed::<U, X>();
                d.combine(v.upper_half().converted::<U, X::Half>(mode), v.lower_half().converted::<U, X::Half>(mode))
            });
            let wide = self.resize::<crate::B32>();
            d.resize_bitcast(wide.resize::<crate::B16>().with_bytes::<u8>(self.s.f16_toward(wide.bytes(), mode)))
        });
        return_if!(U::BITS == 16 && U::FRACTION == 7, {
            let (v, bits) = (self.bitcast::<f32>(), self.bitcast::<u32>());
            let away = match mode {
                Up => (!bits.cast_signed() >> 31).cast_unsigned() >> 16,
                Down => (bits.cast_signed() >> 31).cast_unsigned() >> 16,
                _ => bits.tag().zero(),
            };
            (v.simd_eq(v).if_then_else(bits + away, bits | 1 << 22) >> 16).cast::<u16>().bitcast::<U>().same()
        });
        let near: Simd<U, X, S> = self.cast::<U>().same();
        let back: Self = near.cast::<T>().same();
        let narrow = always!(|m: MaskOf<T, W, S>| -> MaskOf<U, X, S> { crate::raw::same(m.rebind::<U::Signed>()) });
        return_if!(T::IS_FLOAT, near.step(narrow(self.turned(self, mode).simd_gt(back.turned(self, mode))), mode));
        // What was rounded up to the power of two above all integers comes back as the greatest.
        let above = narrow(back.simd_gt(self)) | near.simd_ge(U::from_f64((1u128 << digits::<T>()) as f64));
        let beyond = match mode {
            Up => narrow(back.simd_lt(self)),
            TowardZero if T::IS_SIGNED => {
                let negative = near.cast_signed().is_negative();
                negative & narrow(back.simd_lt(self)) | negative.and_not(above)
            }
            _ => above,
        };
        near.step(beyond, mode)
    }
}

impl<S: Isa, W: Width> Simd<f64, W, S> {
    /// As `fused_in_parts`, whose last sum can round in any direction.
    #[op]
    fn fused_toward(self, mul: Self, add: Self, mode: Round) -> Self {
        // So that what cancels has the right sign.
        let (a, c, mode, down) = if mode == Down { (-self, -add, Up, true) } else { (self, add, mode, false) };
        let (product, low) = a.exact_product(mul);
        let (high, low) = c.exact_sum(low);
        let (sum, lost) = product.exact_sum(high);
        let tiny = product.abs().simd_lt(1e-270);
        let mut result = tiny.if_then_else(product, sum).sum(tiny.if_then_else(c, low.add_to_odd(lost)), mode);
        if !((!tiny | a.simd_eq(0.0) | mul.simd_eq(0.0)) & result.abs().simd_lt(f64::MAX)).all() {
            let mut lanes = a.to_array();
            crate::arithmetic::fused_one_by_one(lanes.as_mut(), mul.to_array().as_ref(), c.to_array().as_ref(), mode);
            result = a.tag().from_array(lanes);
        }
        if down { -result } else { result }
    }
}

macro_rules! operators { ($($name:ident $f:ident $op:ident, |$v:ident, $b:ident| $plain:expr, $other:expr;)*) => {$(
    impl<T: Float, W: Width, S: Isa, O: Operand<T, W, S>> $name<O> for Rounding<T, W, S> {
        type Output = Simd<T, W, S>;
        #[op]
        fn $f(self, other: O) -> Simd<T, W, S> {
            let ($v, $b) = (self.0, self.0.like(other));
            if self.1 == TiesEven { $plain } else { $v.rounded::<$op>($other, $v, self.1) }
        }
    }
)*}; }
operators! {
    Add add ADD, |a, b| a + b, b;
    Sub sub ADD, |a, b| a - b, -b;
    Mul mul MUL, |a, b| a * b, b;
    Div div DIV, |a, b| a / b, b;
}

impl<T: Float, W: Width, S: Isa> Rounding<T, W, S> {
    /// `self * mul + add`, rounded once.
    #[doc(alias("fmadd_round"))]
    #[op]
    pub fn mul_add(self, mul: impl Operand<T, W, S>, add: impl Operand<T, W, S>) -> Simd<T, W, S> {
        let (v, mul, add) = (self.0, self.0.like(mul), self.0.like(add));
        if self.1 == TiesEven { v.mul_add(mul, add) } else { v.rounded::<MUL_ADD>(mul, add, self.1) }
    }
    /// The square root.
    #[op]
    pub fn sqrt(self) -> Simd<T, W, S> {
        if self.1 == TiesEven { self.0.sqrt() } else { self.0.rounded::<SQRT>(self.0, self.0, self.1) }
    }
}

impl<T: Lane, W: Width, S: Isa> Rounding<T, W, S> {
    /// Like [`cast`](Simd::cast). From floats to integers it rounds too, and then saturates.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(f32x4::from([0.5, -0.5, 1.5, 300.0]).rounding(Round::Up).cast::<i8>(), [1, 0, 2, 127]);
    /// assert_eq!(u32x2::from([u32::MAX, 1]).rounding(Round::Down).cast::<f32>(), [4294967040.0, 1.0]);
    /// # } example()
    /// ```
    #[doc(alias("cvt_round"))]
    #[op]
    #[track_caller]
    pub fn cast<U: Lane>(self) -> Simd<U, Scaled<T, U, W>, S> {
        let (v, mode) = (self.0, self.1);
        if const { T::IS_FLOAT && !U::IS_FLOAT } {
            v.to_integers(mode)
        } else if const {
            !U::IS_FLOAT
                || digits::<T>() <= digits::<U>() && (U::BITS > T::BITS || T::FRACTION == U::FRACTION || !T::IS_FLOAT)
        } || mode == TiesEven
        {
            v.cast()
        } else {
            v.lossy(mode)
        }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[op]
    #[track_caller]
    fn to_integers<U: Lane>(self, mode: Round) -> Simd<U, Scaled<T, U, W>, S> {
        if_here!(
            S::AVX512DQ
                && zmm::<S>()
                && W::BYTES == 64
                && T::IS_FLOAT
                && !U::IS_FLOAT
                && U::IS_SIGNED
                && T::BITS == U::BITS
                && T::BITS >= 32,
            {
                // All that doesn't fit becomes the least.
                let wide = self.resize::<crate::B64>();
                let all = wide.with_bytes::<U>(self.s.converted(wide.bytes(), (3, T::BITS == 64, true, mode)));
                let (number, large) = (wide.simd_eq(wide), wide.simd_ge(T::from_f64((1u64 << (T::BITS - 1)) as f64)));
                let cast = always!(|m: MaskOf<T, crate::B64, S>| -> MaskOf<U, crate::B64, S> { crate::raw::same(m) });
                return cast(large).if_then_else(U::MAX, cast(number).if_then_else_zero(all)).same();
            }
        );
        self.whole(mode).cast()
    }
    #[op]
    fn whole(self, mode: Round) -> Self {
        macro_rules! of {
            ($t:ty) => {{
                let v = self.bitcast::<$t>();
                match mode {
                    TiesEven => v.round_ties_even(),
                    Down => v.floor(),
                    Up => v.ceil(),
                    TowardZero => v,
                }
                .bitcast()
            }};
        }
        choose! { !T::IS_FLOAT => self, T::BITS == 64 => of!(f64), T::BITS == 32 => of!(f32), T::FRACTION == 10 => of!(f16), _ => of!(crate::bf16) }
    }
    #[op]
    fn lossy<U: Lane, X: Width>(self, mode: Round) -> Simd<U, X, S> {
        live!(
            U::IS_FLOAT
                && !(digits::<T>() <= digits::<U>()
                    && (U::BITS > T::BITS || T::FRACTION == U::FRACTION || !T::IS_FLOAT)),
            apart!(self.s, self.converted(mode))
        )
    }
}
