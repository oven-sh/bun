//! Multiplication, division and sums that widen, for all types of lanes.

use crate::f16;
use crate::lane::Kind;
use crate::pattern as p;
use crate::raw::{Raw, RawMask};
use crate::{B16, Int, Isa, Lane, Operand, Simd, Tag, Width};
use core::ops::{Div, DivAssign, Rem, RemAssign};

macro_rules! fns { ($($(#[$m:meta])* $(pub($v:ident))? fn $name:ident ($($args:tt)*) -> $out:ty $body:block)*) => {$(
    $(#[$m])* #[op] pub $(($v))? fn $name ($($args)*) -> $out $body
)*}; }
pub(crate) use fns;
type Wide<T> = <T as Int>::Wide;

impl<S: Isa, T: Int, W: Width> Simd<T, W, S> {
    const SIZE: usize = size_of::<T>();
    const SIGNED: bool = matches!(T::KIND, Kind::Signed);
    const DOT_U16: bool = Self::SIZE == 2 && !Self::SIGNED && S::AVXVNNIINT16;

    /// The lower and the upper half of the products of 64-bit lanes.
    #[op]
    pub(crate) fn mul_128(self, other: Self) -> (Self, Self) {
        halves_if!(W::BYTES > 64, |this: Self = self, other: Self = other| {
            let ([a, b], [c, d]) = (this.parts::<W>(), other.parts::<W>());
            let (lower, upper) = (a.mul_128(c), b.mul_128(d));
            (this.tag().join(lower.0, upper.0), this.tag().join(lower.1, upper.1))
        });
        return_if!(S::SVE2 && W::BYTES >= 16, (self * other, self.mul_high(other)));
        return_if!(
            (S::REGISTER < 32 || W::BYTES < 32)
                && !((S::WASM || cfg!(target_arch = "x86") && S::SSE2) && W::BYTES >= 16),
            {
                let (mut low, mut high) = (self.to_array(), other.to_array());
                macro_rules! lane { ($($i:literal)*) => {$(
                when!($i < W::BYTES / 8, {
                    let (a, b) = (low.as_ref()[$i].to_u64(), high.as_ref()[$i].to_u64());
                    let product = if const { Self::SIGNED } { (a as i64 as i128 * b as i64 as i128) as u128 } else { a as u128 * b as u128 };
                    (low.as_mut()[$i], high.as_mut()[$i]) = (T::from_u64(product as u64), T::from_u64((product >> 64) as u64));
                });
            )*}; }
                lane!(0 1 2 3 4 5 6 7);
                (self.tag().from_array(low), self.tag().from_array(high))
            }
        );
        let (a, b) = (self.bitcast::<u32>(), other.bitcast::<u32>());
        let (a1, b1) = (a.swap_pairs(), b.swap_pairs());
        let lowest = a.widening_mul_even(b);
        let middle = a1.widening_mul_even(b) + (lowest >> 32);
        let both = a.widening_mul_even(b1) + (middle & 0xffff_ffff_u64);
        let mut high = (a1.widening_mul_even(b1) + (middle >> 32) + (both >> 32)).cast_signed();
        when!(Self::SIGNED, {
            let (a, b) = (self.bitcast::<i64>(), other.bitcast::<i64>());
            high -= a.is_negative().if_then_else_zero(b) + b.is_negative().if_then_else_zero(a);
        });
        (lowest.bitcast::<u32>().interleave_even(both.bitcast()).bitcast(), high.bitcast())
    }

    /// `sqdmulh`
    #[op]
    fn twice_high(self, factor: T) -> Self {
        let (a, b) = (self.bytes(), self.tag().set(factor).bytes());
        self.with_bytes(if const { Self::SIZE == 2 } {
            self.s.mul_high_doubled::<W>(a, b)
        } else {
            self.s.mul_high_doubled32::<W>(a, b)
        })
    }
    /// Whether that is shorter than `mul_high`.
    const DOUBLES: bool = S::A64 && !(S::SVE2 && W::BYTES >= 16) && matches!(Self::SIZE, 2 | 4);
    /// Both stay whole registers, as `smull2` takes them.
    #[op]
    pub(crate) fn as_factors(self, other: Self) -> (Self, Self) {
        return_if!(S::A64 && crate::OPTIMIZED && W::BYTES >= 16, {
            let same = other.raw.eq(Raw::splat(other.get_lane())).all();
            // LLVM finds the forms that take one lane, which bytes lack.
            if crate::arithmetic::known(same) && (Self::SIZE > 1 || is_known!(other.get_lane())) {
                return (self.tag().opaque(self.raw), other);
            }
            let hidden =
                always!(|v: Self| core::hint::select_unpredictable(crate::arithmetic::known(!same), v.black_box(), v));
            let (this, other) = (hidden(self), hidden(other));
            let zero = self.tag().opaque((this ^ other).raw) ^ (this ^ other);
            (this.shift_by_sign(zero), other.shift_by_sign(zero))
        });
        (self, other)
    }
    #[op]
    pub(crate) fn mul_high_16(self, other: Self) -> Self {
        return_if!(S::SCALAR, self.products::<_, _, 0, 1>(other, 16));
        let (a, b) = (self.bytes(), other.bytes());
        self.with_bytes(if const { Self::SIGNED } {
            self.s.mul_high_i16::<W>(a, b)
        } else {
            self.s.mul_high_u16::<W>(a, b)
        })
    }

    /// The products of the lower halves and of the upper halves.
    #[op]
    pub(crate) fn mul_halves(self, other: Self) -> (Simd<T::Wide, W, S>, Simd<T::Wide, W, S>) {
        return_if!(S::A64 && W::BYTES == 16 && Self::SIZE < 8, {
            let (a, b) = self.as_factors(other);
            let [lower, upper] = self.s.products(W::to16(a.bytes()), W::to16(b.bytes()), Self::SIZE, Self::SIGNED);
            (self.with_bytes(W::from16(lower)), self.with_bytes(W::from16(upper)))
        });
        let d = self.tag().repartition::<T::Wide>();
        (d.widen_mul(self.lower_half(), other.lower_half()), d.widen_mul(self.upper_half(), other.upper_half()))
    }

    /// For 8 bytes.
    #[op]
    fn all_products(self, other: Self) -> Simd<T::Wide, B16, S> {
        let (d, half) = (self.s.fixed::<T::Wide, B16>(), self.s.fixed::<T, crate::B8>());
        d.opaque(d.widen_mul(half.resize_bitcast(self), half.resize_bitcast(other)).raw)
    }

    #[op]
    fn in_block(self) -> Simd<T, B16, S> {
        self.s.fixed().resize_bitcast(self)
    }

    /// Where the divider was measured to be slower: not at 16 bytes, on any of Sapphire Rapids, Zen 3, N1, V1 and V2.
    const ESTIMATE: bool = S::AVX2 && (W::BYTES == 64 && S::REGISTER == 64 || W::BYTES >= 32 && Self::SIZE == 1);

    /// The quotients of numbers of 8 or 16 bits, which have to be unsigned if `ESTIMATE`.
    #[op]
    fn div_small(a: Simd<i32, W, S>, b: Simd<i32, W, S>) -> Simd<i32, W, S> {
        let d = a.tag().repartition::<f32>();
        let (x, y) = (d.convert_to(a), d.convert_to(b));
        return_if!(!Self::ESTIMATE, a.tag().convert_in_range_to(x / y));
        // `(x + 0.5) / y` is further from an integer than 2^-9 or 2^-17 of itself. The estimate is within 2^-11, and a
        // step squares that.
        let mut inverse = y.recip_relaxed();
        when!(Self::SIZE == 2, inverse *= y.neg_mul_add(inverse, 2.0));
        a.tag().convert_in_range_to((x + 0.5) * inverse)
    }
    #[op]
    fn div_halves(a: Simd<u16, W, S>, b: Simd<u16, W, S>) -> Simd<u16, W, S> {
        let (d, zero) = (a.tag(), a.tag().zero());
        let lower = Self::div_small(a.zip_lower(zero).bitcast(), b.zip_lower(zero).bitcast());
        d.reorder_demote2_to(lower, Self::div_small(a.zip_upper(zero).bitcast(), b.zip_upper(zero).bitcast()))
    }

    const DIV_64: bool = const { S::AVX2 } && W::BYTES >= 32 || const { S::AVX512DQ } && W::BYTES >= 16;

    /// Two estimates that are never too large. The first leaves a quotient of less than 2^15, and the second of 0 or 1.
    #[op]
    fn div_64(a: Simd<u64, W, S>, b: Simd<u64, W, S>) -> Simd<u64, W, S> {
        let d = a.tag().repartition::<f64>();
        let inverse = d.set(1.0 - 1.0 / (1u64 << 50) as f64) / d.convert_to(b);
        let first = a.tag().convert_in_range_to(d.convert_to(a) * inverse);
        let rest = a - first * b;
        let second = a.tag().convert_in_range_to(d.convert_to(rest) * inverse);
        let sum = first + second;
        (rest - second * b).simd_ge(b).if_then_else(sum + 1, sum)
    }

    #[op]
    fn strict_quotient(self, other: Self) -> Self {
        halves_if!(W::BYTES > 64, |this: Self = self, other: Self = other| {
            let ([a, b], [c, d]) = (this.parts::<W>(), other.parts::<W>());
            this.tag().join(a.strict_quotient(c), b.strict_quotient(d))
        });
        return_if!(S::SCALAR && Self::SIZE < 8, {
            let (a, b) = (self.to_array(), other.to_array());
            self.tag().from_fn(
                #[inline(always)]
                |i| {
                    let (x, y) = (a.as_ref()[i].to_u64() as u32, b.as_ref()[i].to_u64() as u32);
                    let quotient = if Self::SIGNED {
                        (x as i32).checked_div(y as i32).map(|it| it as u32)
                    } else {
                        x.checked_div(y)
                    };
                    T::from_u64(quotient.unwrap_or(x & y) as u64)
                },
            )
        });
        return_if!(
            S::SVE2 && Self::SIZE >= 4,
            self.with_bytes(self.s.quotient_or_zero::<W>(self.bytes(), other.bytes(), (Self::SIZE, Self::SIGNED)))
        );
        let quotient = self.quotient(other);
        if const { Self::SIZE == 8 && !Self::DIV_64 } {
            return quotient;
        }
        let quotient = other.simd_eq(T::ZERO).if_then_zero_else(quotient);
        return_if!(Self::SIGNED && Self::SIZE == 4 && !S::SSE41 && !S::A64, {
            // The conversion saturates.
            (self.simd_eq(T::MIN) & other.simd_eq(!T::ZERO)).if_then_else(self, quotient)
        });
        quotient
    }

    /// Unspecified for a divisor of zero.
    #[op]
    fn quotient(self, other: Self) -> Self {
        return_if!(S::A64 && Self::SIZE == 1 && S::HAS_FP16 && W::BYTES >= 8, |this: Self = self, other: Self = other| {
            // A quotient of bytes is further from the next integer than 2^-11 of itself.
            let divide = always!(|a: Simd<i16, W, S>, b: Simd<i16, W, S>| (a.cast::<f16>() / b.cast::<f16>()).cast::<i16>().resize::<W>().bitcast::<T>());
            let (a, b) = (this.bitcast::<i16>(), other.bitcast::<i16>());
            let (even, odd) = choose! {
                Self::SIGNED => (divide(a << 8 >> 8, b << 8 >> 8), divide(a >> 8, b >> 8)),
                _ => (divide(a & 255, b & 255), divide((a.cast_unsigned() >> 8).cast_signed(), (b.cast_unsigned() >> 8).cast_signed())),
            };
            even.interleave_even(odd)
        });
        macro_rules! at_once {
            ($w:ty) => {{
                let (d, wide) = (self.s.fixed::<f32, $w>(), self.s.fixed::<i32, $w>());
                let quotient =
                    wide.convert_in_range_to(d.convert_to(wide.promote(self)) / d.convert_to(wide.promote(other)));
                // The lowest value divided by -1 wraps.
                choose! { Self::SIGNED => self.tag().cast(quotient), _ => self.tag().demote(quotient) }
            }};
        }
        choose! {
            Self::SIZE == 1 && 4 * W::BYTES <= S::REGISTER && W::BYTES <= 8 => at_once!(<W::Twice as Width>::Twice),
            Self::SIZE == 2 && 2 * W::BYTES <= S::REGISTER && W::BYTES <= 16 => at_once!(W::Twice),
            Self::SIZE == 4 && 2 * W::BYTES <= S::REGISTER => {
                let d = self.s.fixed::<f64, W::Twice>();
                self.tag().demote_in_range_to(d.promote(self) / d.promote(other))
            },
            Self::SIGNED && Self::SIZE == 1 && S::REGISTER == 16 => {
                let (a, b) = (self.bitcast::<i16>(), other.bitcast::<i16>());
                (a << 8 >> 8).quotient(b << 8 >> 8).bitcast().interleave_even((a >> 8).quotient(b >> 8).bitcast())
            },
            Self::SIGNED && Self::SIZE == 2 && !Self::ESTIMATE => {
                let (a, b) = (self.bitcast::<i32>(), other.bitcast::<i32>());
                Self::div_small(a << 16 >> 16, b << 16 >> 16).bitcast().interleave_even(Self::div_small(a >> 16, b >> 16).bitcast())
            },
            Self::SIGNED && (Self::SIZE <= 2 || Self::SIZE == 8 && Self::DIV_64) => {
                let (a, b) = (self.cast_signed(), other.cast_signed());
                let quotient = a.abs().cast_unsigned().quotient(b.abs().cast_unsigned()).bitcast();
                (a ^ b | T::Signed::from_usize(1)).if_negative_then_neg_or_undef_if_zero(quotient).bitcast()
            },
            Self::SIZE == 1 && 2 * W::BYTES <= S::REGISTER => {
                let d = self.s.fixed::<u16, W::Twice>();
                self.tag().demote(Simd::<T, W::Twice, S>::div_halves(d.promote(self), d.promote(other)).cast_signed())
            },
            Self::SIZE == 2 && 2 * W::BYTES <= S::REGISTER => {
                let d = self.s.fixed::<i32, W::Twice>();
                self.tag().demote(Simd::<T, _, S>::div_small(d.promote(self), d.promote(other)))
            },
            Self::SIZE == 1 => {
                let (a, b, zero) = (self.bitcast::<u8>(), other.bitcast::<u8>(), self.tag().repartition::<u8>().zero());
                let lower = Self::div_halves(a.zip_lower(zero), b.zip_lower(zero)).cast_signed();
                a.tag().reorder_demote2_to(lower, Self::div_halves(a.zip_upper(zero), b.zip_upper(zero)).cast_signed()).bitcast()
            },
            Self::SIZE == 2 => Self::div_halves(self.bitcast(), other.bitcast()).bitcast(),
            Self::SIZE == 4 => {
                let d = self.tag().repartition::<f64>();
                let lower = d.promote_lower_to(self) / d.promote_lower_to(other);
                let upper = d.promote_upper_to(self) / d.promote_upper_to(other);
                return_if!(!Self::SIGNED && (S::A64 || S::AVX512DQ), {
                    let half = self.s.fixed::<u32, W::Half>();
                    let truncate = always!(|v| half.demote_in_range_to(self.s.fixed().resize_bitcast::<f64, W>(v)));
                    self.tag().repartition().combine(truncate(upper), truncate(lower)).bitcast()
                });
                let truncate = |v: Simd<f64, W, S>| self.with_bytes(self.s.truncate_f64_i32::<W>(v.bytes()));
                let quotient = self.tag().concat_lower_lower(truncate(upper), truncate(lower));
                // The only quotient that can be too large for `i32`.
                choose! { Self::SIGNED => quotient, _ => other.simd_eq(T::from_usize(1)).if_then_else(self, quotient) }
            },
            Self::DIV_64 => Self::div_64(self.bitcast(), other.bitcast()).bitcast(),
            _ => {
                let (mut a, b) = (self.to_array(), other.to_array());
                for i in 0..W::BYTES / 8 {
                    let (x, y) = (a.as_ref()[i].to_u64(), b.as_ref()[i].to_u64());
                    let quotient = choose! { Self::SIGNED => (x as i64).checked_div(y as i64).map(|it| it as u64), _ => x.checked_div(y) };
                    // The lowest value divided by -1 is itself.
                    a.as_mut()[i] = T::from_u64(quotient.unwrap_or(x & y));
                }
                self.tag().from_array(a)
            },
        }
    }

    fns! {
        /// The upper half of each product. `MulHigh`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u16x2::from([0x8000, 0xffff]).mul_high(10), [5, 9]);
        /// # } example()
        /// ```
        fn mul_high(self, other: impl Operand<T, W, S>) -> Self { apart!(self.s, {
            if const { Self::DOUBLES && Self::SIGNED && crate::OPTIMIZED } && let Some(n) = Operand::number(other) && crate::arithmetic::known(n != T::MIN) {
                return if crate::arithmetic::known(n.to_u64() % 2 == 0) { self.twice_high(n >> 1) } else { self.twice_high(n) >> 1 };
            }
            let other = self.like(other);
            choose! {
                (S::SVE2 || S::WASM) && if S::SVE2 { W::BYTES >= 16 } else { Self::SIZE < 8 } => self.with_bytes(self.s.mul_high::<W>(self.bytes(), other.bytes(), (Self::SIZE, Self::SIGNED))),
                Self::SIZE == 2 => self.mul_high_16(other),
                S::SCALAR && Self::SIZE < 8 => self.products::<_, _, 0, 1>(other, T::BITS),
                Self::SIZE == 8 => self.mul_128(other).1,
                S::BY_HAND && Self::SIZE == 4 && Self::SIGNED =>
                    self.bitcast::<u32>().mul_high(other.bitcast::<u32>()).bitcast() - ((self >> 31 & other) + (other >> 31 & self)),
                W::BYTES < 16 => self.tag().resize_bitcast(self.in_block().mul_high_in_blocks(other.in_block())),
                _ => self.mul_high_in_blocks(other),
            }
        }) }
        /// The products of the even lanes, twice as wide. For 64 bits, each takes two lanes. `MulEven`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// let v = u32x4::from([1, 2, u32::MAX, 4]);
        /// assert_eq!(v.widening_mul_even(2), [2, 2 * u32::MAX as u64]);
        /// assert_eq!(v.widening_mul_odd(2), [4, 8]);
        /// # } example()
        /// ```
        #[track_caller]
        #[doc(alias("mul_even", "MulEven", "pmuludq"))]
        fn widening_mul_even(self, other: impl Operand<T, W, S>) -> Simd<T::Wide, W, S> {
            require!("this takes two lanes or more", W::BYTES >= 2 * size_of::<T>());
            let (other, d) = (self.like(other), self.tag().repartition::<T::Wide>());
            choose! {
                S::SVE2 && W::BYTES >= 16 && Self::SIZE < 8 => self.with_bytes(self.s.mul_wide::<W>(self.bytes(), other.bytes(), (Self::SIZE, Self::SIGNED, false))),
                S::SCALAR && Self::SIZE < 8 => self.products::<_, _, 0, 1>(other, 0),
                Self::SIZE == 2 && !S::ARM && Self::SIGNED => self.widen_mul_pairwise_add((other.bitcast::<u32>() & 0xffff_u32).bitcast()),
                Self::SIZE == 2 && !S::ARM && !S::WASM => (self * other).interleave_even(self.mul_high_16(other)).bitcast(),
                S::A64 && W::BYTES == 8 && Self::SIZE < 8 => d.resize_bitcast({ let all = self.all_products(other); all.shuffle::<{ p::STRIDE }, 0>(all) }),
                S::ARM && Self::SIZE < 4 && W::BYTES >= 16 => {
                    // Or LLVM loads the lanes one by one.
                    let even = always!(|v: Self| {
                        let v = v.tag().opaque(v.raw);
                        v.with_bytes::<T>(v.s.opaque::<W>(v.shuffle::<{ p::STRIDE }, 0>(v).bytes())).lower_half()
                    });
                    d.widen_mul(even(self), even(other))
                },
                Self::SIZE == 4 && Self::SIGNED => self.with_bytes(self.s.mul_even_i32::<W>(self.bytes(), other.bytes())),
                Self::SIZE == 4 => self.with_bytes(self.s.mul_even_u32::<W>(self.bytes(), other.bytes())),
                Self::SIZE == 8 => {
                    let (low, high) = self.mul_128(other);
                    low.interleave_even(high).bitcast()
                },
                _ => {
                    let (a, b, half) = (d.bitcast(self), d.bitcast(other), T::BITS);
                    (a << half >> half) * (b << half >> half)
                },
            }
        }
        /// The products of the odd lanes, twice as wide. For 64 bits, each takes two lanes. `MulOdd`.
        #[track_caller]
        #[doc(alias("mul_odd", "MulOdd"))]
        fn widening_mul_odd(self, other: impl Operand<T, W, S>) -> Simd<T::Wide, W, S> {
            require!("this takes two lanes or more", W::BYTES >= 2 * size_of::<T>());
            let (other, d) = (self.like(other), self.tag().repartition::<T::Wide>());
            choose! {
                S::SVE2 && W::BYTES >= 16 && Self::SIZE < 8 => self.with_bytes(self.s.mul_wide::<W>(self.bytes(), other.bytes(), (Self::SIZE, Self::SIGNED, true))),
                S::SCALAR && Self::SIZE < 8 => self.products::<_, _, 1, 2>(other, 0),
                Self::SIZE == 2 && !S::ARM && Self::SIGNED => self.widen_mul_pairwise_add((other.bitcast::<u32>() & 0xffff_0000_u32).bitcast()),
                Self::SIZE == 2 && !S::ARM && !S::WASM => (self * other).interleave_odd(self.mul_high_16(other)).bitcast(),
                S::A64 && W::BYTES == 8 && Self::SIZE < 8 => d.resize_bitcast({ let all = self.all_products(other); all.shuffle::<{ p::STRIDE }, 1>(all) }),
                S::ARM && Self::SIZE < 8 && W::BYTES >= 8 => {
                    let half = self.tag().half();
                    d.widen_mul(half.truncate_to(d.bitcast(self) >> T::BITS), half.truncate_to(d.bitcast(other) >> T::BITS))
                },
                S::WASM && Self::SIZE == 4 => self.with_bytes(self.s.mul_wide::<W>(self.bytes(), other.bytes(), (4, Self::SIGNED, true))),
                Self::SIZE == 4 => self.dup_odd().widening_mul_even(other.dup_odd()),
                Self::SIZE == 8 => {
                    let (low, high) = self.mul_128(other);
                    low.interleave_odd(high).bitcast()
                },
                _ => (d.bitcast(self) >> T::BITS) * (d.bitcast(other) >> T::BITS),
            }
        }
        /// Whether the compiler knows that these bytes are `i8` from 0 on.
        pub(crate) fn known_positive(self) -> bool {
            crate::OPTIMIZED && are_known!(self.raw) && !self.bytes().top_bits().any()
        }
        /// Whether it knows that no `u8` times these `i8` saturate a sum of two products: 255 * 128 fits.
        pub(crate) fn known_small(self) -> bool {
            let fits = always!(|v: Simd<i8, W, S>| {
                let v = v.bitcast::<u16>().raw;
                v.and(Raw::splat(255)).add(v.shr_by(8)).le(Raw::splat(128)).all()
            });
            let (v, zero) = (self.bitcast::<i8>(), Raw::splat(0));
            crate::OPTIMIZED && are_known!(self.raw) && fits(v.with(v.raw.max(zero))) && fits(v.with(zero.sub(v.raw.min(zero))))
        }
        /// Whether these constants are powers of two, or zero.
        pub(crate) fn are_shifts(self) -> bool { (self & (self - T::ONE)).raw.eq(Raw::splat(T::ZERO)).all() }
        /// Whether it knows that two products with these bytes have room in 16 bits.
        pub(crate) fn known_pairs(self) -> bool {
            let v = self.bitcast::<u16>().raw;
            crate::OPTIMIZED && are_known!(self.raw) && if Self::SIGNED { !self.bytes().eq(Raw::splat(128)).any() } else { v.and(Raw::splat(255)).add(v.shr_by(8)).le(Raw::splat(257)).all() }
        }
        /// The sums of two products of bytes by `pmaddubsw`, if it is exact.
        pub(crate) fn exact_pairs(self, other: Self) -> Option<Simd<i16, W, S>> {
            return_if!(S::SSSE3 && Self::SIZE == 1, match other.known_positive() {
                true if Self::SIGNED => Some(other.bitcast::<u8>().saturating_dot_i8(self.bitcast::<i8>())),
                true if other.known_small() => Some(self.bitcast::<u8>().saturating_dot_i8(other.bitcast::<i8>())),
                _ => None,
            });
            None
        }
        /// The sums of two adjacent products, for lanes of up to 32 bits. `WidenMulPairwiseAdd`.
        #[track_caller]
        pub(crate) fn widen_mul_pairwise_add(self, other: impl Operand<T, W, S>) -> Simd<T::Wide, W, S> {
            require!("this takes two lanes or more, of less than 64 bits", size_of::<T>() < 8 && W::BYTES >= 2 * size_of::<T>());
            let other = self.like(other);
            return_if!(S::SSSE3 && Self::SIZE == 1 && Self::SIGNED, {
                // The sign is worth -128.
                let of = always!(|bits: u8| (self.bitcast::<u8>() & bits).saturating_dot_i8(other.bitcast::<i8>()));
                (of(0x7f) - of(0x80)).bitcast()
            });
            if const { S::SCALAR } {
                live!(S::SCALAR, self.products::<_, _, 0, 2>(other, 0))
            } else if const { S::SVE2 && W::BYTES >= 16 } {
                self.with_bytes(self.s.add_pairs::<W>(self.bytes(), other.bytes(), self.bytes(), (Self::SIZE, Self::SIGNED, false)))
            } else if const { size_of::<T>() == 2 && Self::SIGNED } {
                // Some are zero, after a mask.
                let masked = choose! {
                    S::A64 => {
                        let pair = other.bitcast::<u32>().get_lane();
                        is_known!(pair & 0xffff) != is_known!(pair >> 16)
                    },
                    _ => false,
                };
                let (a, b) = if masked { (self, other) } else { self.as_factors(other) };
                self.with_bytes(self.s.mul_add_i16::<W>(a.bytes(), b.bytes()))
            } else if const { Self::DOT_U16 } {
                self.widen_mul_pairwise_add_to(other, Tag::new(self.s).zero())
            } else if const { S::A64 && W::BYTES == 8 } {
                live!(S::A64 && W::BYTES == 8, {
                    let all = self.all_products(other);
                    self.tag().repartition().resize_bitcast(all.tag().opaque(all.pairwise_add128(all).raw))
                })
            } else if const { S::ARM && W::BYTES >= 16 } {
                live!(S::ARM && W::BYTES >= 16 && !S::SVE2 && !Self::DOT_U16 && !(size_of::<T>() == 2 && Self::SIGNED), {
                    let (lower, upper) = self.mul_halves(other);
                    lower.rearrange_to_odd_plus_even(upper)
                })
            } else if const { crate::X86 && size_of::<T>() == 2 } {
                live!(crate::X86 && size_of::<T>() == 2 && !Self::SIGNED && !Self::DOT_U16, {
                    let (low, high) = (self * other, self.mul_high_16(other));
                    high.odd_even(low).bitcast() + (low.shift_in_pairs(false) | high.shift_in_pairs(true)).bitcast::<T::Wide>()
                })
            } else {
                live!(!(S::ARM && W::BYTES >= 16 || S::A64 && W::BYTES == 8 || crate::X86 && size_of::<T>() == 2), self.widening_mul_even(other) + self.widening_mul_odd(other))
            }
        }
        /// The same, added to `sum`.
        #[track_caller]
        pub(crate) fn widen_mul_pairwise_add_to(self, other: Self, sum: Simd<T::Wide, W, S>) -> Simd<T::Wide, W, S> {
            if_here!(S::SVE2 && W::BYTES >= 16, {
                return self.with_bytes(self.s.add_pairs::<W>(self.bytes(), other.bytes(), sum.bytes(), (Self::SIZE, Self::SIGNED, true)));
            });
            if const { Self::DOT_U16 && W::BYTES >= 4 } {
                return self.with_bytes(self.s.dot_u16::<W>(self.bytes(), other.bytes(), sum.bytes()));
            }
            sum + self.widen_mul_pairwise_add(other)
        }
        /// Adds each product to some lane of `sum0` or `sum1`, which has to start from zero. See
        /// [`PairSums::total`](crate::PairSums::total). `ReorderWidenMulAccumulate`.
        pub(crate) fn reorder_widen_mul_accumulate(
            self,
            other: Self,
            sum0: Simd<T::Wide, W, S>,
            sum1: Simd<T::Wide, W, S>,
        ) -> (Simd<T::Wide, W, S>, Simd<T::Wide, W, S>) {
            choose! { S::ARM && W::BYTES > 2 => self.widen_mul_accumulate(other, sum0, sum1), _ => (self.widen_mul_pairwise_add_to(other, sum0), sum1) }
        }
        /// Lane `i` is the sum of the products of the lanes `2 * i` and `2 * i + 1`, if both sums started from zero.
        /// `RearrangeToOddPlusEven`.
        pub(crate) fn rearrange_to_odd_plus_even(self, sum1: Self) -> Self {
            return_if!(S::A64 && W::BYTES >= 16, self.tag().opaque(self.add_pairs(sum1).raw));
            choose! { S::ARM => self.tag().concat_even(sum1, self) + self.tag().concat_odd(sum1, self), _ => self }
        }
        /// Adds four adjacent products to each lane of `sum`, for lanes of 8 and 16 bits. `SumOfMulQuadAccumulate`.
        #[track_caller]
        pub(crate) fn sum_of_mul_quad_accumulate(
            self,
            other: impl Operand<T, W, S>,
            sum: impl Operand<Wide<T::Wide>, W, S>,
        ) -> Simd<Wide<T::Wide>, W, S> {
            require!("this takes four lanes or more, of 8 or 16 bits", size_of::<T>() <= 2 && W::BYTES >= 4 * size_of::<T>());
            let (other, sum) = (self.like(other), sum.vector(Tag::new(self.s)));
            if const { !S::HAS_DOT_U8_I8 && !S::HAS_DOT && W::BYTES >= 4 } && let Some(pairs) = self.exact_pairs(other) {
                return live!(S::SSSE3 && Self::SIZE == 1 && W::BYTES >= 4, sum + pairs.sums_of_2().bitcast());
            }
            if_here!(S::RELAXED && Self::SIZE == 1 && Self::SIGNED, if other.known_positive() {
                return self.with_bytes(self.s.dot_u7_i8::<W>(other.bytes(), self.bytes(), sum.bytes()));
            });
            if const { S::A64 && !S::HAS_DOT && Self::SIZE == 1 && W::BYTES >= 8 } && other.known_pairs() {
                return live!(S::A64 && !S::HAS_DOT && Self::SIZE == 1 && W::BYTES >= 8, sum + self.widen_mul_pairwise_add(other).sums_of_2());
            }
            let (this, other) = choose! { !S::HAS_DOT && Self::SIZE == 1 => self.as_factors(other), _ => (self, other) };
            choose! {
                S::SCALAR => sum + self.products::<_, _, 0, 4>(other, 0),
                // a * b = (a + 128) * b - 128 * b = a * (b - 128) - a * -128
                Self::SIZE == 1 && S::HAS_DOT_U8_I8 && !S::HAS_DOT => {
                    if other.known_positive() {
                        let (a, b) = if Self::SIGNED { (other, self) } else { (self, other) };
                        return a.bitcast::<u8>().sum_of_mul_quad_accumulate_i8(b.bitcast(), sum.bitcast()).bitcast();
                    }
                    let (d, zero) = (self.tag().repartition::<u8>(), sum.tag().repartition::<i32>().zero());
                    let (a, b, bias) = (self.bitcast::<u8>(), other.bitcast::<u8>(), d.set(0x80));
                    let (a, b, c, e) = if Self::SIGNED { (a ^ bias, b, bias, b) } else { (a, b ^ bias, a, bias) };
                    (a.sum_of_mul_quad_accumulate_i8(b.bitcast(), sum.bitcast()) - c.sum_of_mul_quad_accumulate_i8(e.bitcast(), zero)).bitcast()
                },
                Self::SIZE == 1 && !Self::SIGNED => self.with_bytes(self.s.dot_u8_u8::<W>(this.bytes(), other.bytes(), sum.bytes())),
                Self::SIZE == 1 && Self::SIGNED => self.with_bytes(self.s.dot_i8_i8::<W>(this.bytes(), other.bytes(), sum.bytes())),
                S::SVE2 && W::BYTES >= 16 => self.with_bytes(self.s.add_quads::<W>(self.bytes(), other.bytes(), sum.bytes(), Self::SIGNED)),
                S::ARM && W::BYTES >= 16 => {
                    let (lower, upper) = self.mul_halves(other);
                    let (lower, upper) = (lower.sums_of_2(), upper.sums_of_2());
                    sum + sum.tag().opaque(if const { W::BYTES == 16 } { lower.pairwise_add128(upper) } else {
                        sum.tag().concat_even(upper, lower) + sum.tag().concat_odd(upper, lower)
                    }.raw)
                },
                // As below, with the bias of `sums_of_2_i32` in the negation.
                crate::X86 && Self::SIGNED => {
                    let pairs = self.widen_mul_pairwise_add(other).bitcast::<u32>();
                    let biased = (pairs.tag().set(1 << 31) - pairs).bitcast::<u64>();
                    sum - ((biased | !0 << 32) + (biased >> 32)).bitcast()
                },
                // The sum of two products can be 2^31, which wraps. Its negative never does.
                Self::SIGNED => {
                    let pairs = self.widen_mul_pairwise_add(other);
                    sum - (pairs.tag().zero() - pairs).sums_of_2()
                },
                _ => sum + self.widening_mul_even(other).sums_of_2() + self.widening_mul_odd(other).sums_of_2(),
            }
        }
        /// The same, to any lanes.
        pub(crate) fn add_products(self, other: Self, sum: Simd<Wide<T::Wide>, W, S>) -> Simd<Wide<T::Wide>, W, S> {
            return_if!(S::NEON && W::BYTES == 16 && !S::HAS_DOT, {
                let (lower, upper) = self.mul_halves(other);
                sum + lower.sums_of_2() + upper.sums_of_2()
            });
            self.sum_of_mul_quad_accumulate(other, sum)
        }
        /// The sums of four adjacent lanes of 8 or 16 bits. `SumsOf4`.
        #[track_caller]
        pub(crate) fn sums_of_4(self) -> Simd<Wide<T::Wide>, W, S> {
            require!("this takes four lanes or more, of 8 or 16 bits", size_of::<T>() <= 2 && W::BYTES >= 4 * size_of::<T>());
            if_here!(crate::X86 && S::HAS_DOT_U8_I8 && size_of::<T>() == 1 && Self::SIGNED, {
                return self.with_bytes(self.s.dot_u8_i8::<W>(Raw::splat(1), self.bytes(), Raw::splat(0)));
            });
            if_here!(crate::X86 && S::HAS_DOT_U8_I8 && size_of::<T>() == 1, {
                return self.with_bytes(self.s.dot_u8_i8::<W>(self.bytes(), Raw::splat(1), Raw::splat(0)));
            });
            if const { size_of::<T>() == 1 && S::HAS_DOT } {
                return live!(size_of::<T>() == 1 && S::HAS_DOT, self.sum_of_mul_quad_accumulate(T::from_usize(1), self.tag().repartition().zero()));
            }
            let pairs = self.sums_of_2();
            if const { !S::ARM && !S::SCALAR && size_of::<T>() == 1 } { pairs.cast_signed().sums_of_2().bitcast() } else { pairs.sums_of_2() }
        }
        /// `(self + other + 1) >> 1` without overflow. `AverageRound`.
        ///
        /// ```
        /// # use bun_simd::prelude::*; #[kernel] fn example() {
        /// assert_eq!(u8x2::from([1, 255]).midpoint_up([2, 253]), [2, 254]);
        /// # } example()
        /// ```
        #[doc(alias("average_round", "AverageRound", "average", "avg", "pavgb", "pavgw", "urhadd"))]
        fn midpoint_up(self, other: impl Operand<T, W, S>) -> Self {
            let other = self.like(other);
            let (a, b) = (self.bytes(), other.bytes());
            choose! {
                matches!(Self::SIZE, 1 | 2) && !Self::SIGNED && (W::BYTES == 8 || W::BYTES < 16 && !S::ARM) && !S::SSE2 => self.with(self.raw.average_round(other.raw)),
                Self::SIZE == 1 && !Self::SIGNED => self.with_bytes(self.s.average_u8::<W>(a, b)),
                Self::SIZE == 2 && !Self::SIGNED => self.with_bytes(self.s.average_u16::<W>(a, b)),
                S::ARM && Self::SIZE == 4 && !Self::SIGNED => self.with(self.raw.average_round(other.raw)),
                Self::SIZE == 1 && Self::SIGNED => self.with_bytes(self.s.average_i8::<W>(a, b)),
                S::NEON && Self::SIZE == 2 && Self::SIGNED => self.with_bytes(self.s.average_i16::<W>(a, b)),
                S::NEON && Self::SIZE == 4 && Self::SIGNED => self.with_bytes(self.s.average_i32::<W>(a, b)),
                _ => (self | other) - ((self ^ other) >> 1),
            }
        }
    }

    #[op]
    pub(crate) fn rounding_shr_each(self, counts: Self) -> Self {
        return_if!(S::NEON, self.rounding_shift_left(self.tag().zero() - counts));
        return_if!(
            size_of::<T>() == 8 || size_of::<T>() == 4 && S::AVX2 || S::AVX512BW && size_of::<T>() == 2 && Self::SIGNED,
            (self >> counts) + (((self + self).cast_unsigned() >> counts.cast_unsigned()).bitcast() & T::from_usize(1))
        );
        return_if!(S::PSIGN && !S::AVX512BW && Self::SIZE == 2 && Self::SIGNED && W::BYTES >= 16, {
            // The factor for a count of 0 is -1.
            let by = self.factors(counts, [0, 0, 0, 0, 0, 0, 0, 0, 128, 64, 32, 16, 8, 4, 2, 1]).bytes();
            self.with_bytes(self.s.sign_i16::<W>(self.s.mul_fixed_point_15::<W>(self.bytes(), by), by))
        });
        let none = counts.simd_eq(T::default());
        let shifted = self >> none.if_then_zero_else(counts - T::from_usize(1));
        shifted.midpoint_up(none.if_then_else_zero(shifted))
    }

    #[op]
    fn mul_high_in_blocks(self, other: Self) -> Self {
        choose! {
            S::ARM => {
                let (lower, upper) = self.mul_halves(other);
                self.tag().concat_odd(upper.bitcast(), lower.bitcast())
            },
            Self::SIZE == 1 => {
                let (a, b, odd) = (self.bitcast::<T::Wide>(), other.bitcast::<T::Wide>(), Wide::<T>::from_usize(0xff00));
                let even = choose! { Self::SIGNED => ((a << 8).mul_high_16(b << 8).cast_unsigned() >> 8).unseen(), _ => (a << 8).mul_high_16(b & Wide::<T>::from_usize(0xff)).cast_unsigned().unseen() };
                (even.bitcast() | (a & odd).mul_high_16(b & odd) & odd).bitcast()
            },
            _ => self.widening_mul_even(other).bitcast().interleave_odd(self.widening_mul_odd(other).bitcast()),
        }
    }
}

impl<S: Isa, T: Lane, W: Width> Simd<T, W, S> {
    #[op]
    pub(crate) fn divide_by_lanes(self, other: Self) -> Self {
        crate::half::in_f32!(soft self, other => |a, b| a / b);
        crate::half::native!(Div, self, other);
        choose! {
            matches!(T::KIND, Kind::Float) => self.with(self.raw.div(other.raw)),
            matches!(T::KIND, Kind::Signed) => self.cast_signed().strict_quotient(other.cast_signed()).bitcast(),
            _ => self.cast_unsigned().strict_quotient(other.cast_unsigned()).bitcast(),
        }
    }
    #[inline(always)]
    pub(crate) fn divide_by_number(self, number: T) -> Self {
        apart_unoptimized!(self.s, {
            let other = self.tag().set(number);
            crate::half::in_f32!(soft self, other => |a, b| a / b);
            crate::half::native!(Div, self, other);
            let number = choose! {
                // For speed: with many lanes the factor stays in the loop, where LLVM finds `pmulhw` for it.
                S::AVX2 && (T::BITS == 8 || T::BITS == 16 && W::BYTES >= 64) => other.get_lane(),
                // Short loops are faster so.
                S::A64 && T::BITS < 64 => other.get_lane(),
                _ => number,
            };
            choose! {
                matches!(T::KIND, Kind::Float) => self.with(self.raw.div(other.raw)),
                matches!(T::KIND, Kind::Signed) => (self.cast_signed() / Divisor::not_zero(crate::raw::same::<_, T::Signed>(number))).bitcast(),
                _ => (self.cast_unsigned() / Divisor::not_zero(crate::raw::same::<_, T::Unsigned>(number))).bitcast(),
            }
        })
    }
}

/// Integers are truncated, and the lowest value divided by -1 wraps. A lane of the divisor that is zero, such as the padding of a
/// tail, gives zero. An integer is made into a [`Divisor`], which costs nothing for a constant, and panics for zero. `Div`.
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> Div<O> for Simd<T, W, S> {
    type Output = Self;
    #[inline(always)]
    fn div(self, other: O) -> Self {
        other.divide(self)
    }
}
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> DivAssign<O> for Simd<T, W, S> {
    #[inline(always)]
    fn div_assign(&mut self, other: O) {
        *self = *self / other
    }
}
/// For integers `self - self / other * other`, which is `self` where a lane of `other` is zero. `Mod`. For floating-point
/// numbers it is exact, has the sign of `self`, and takes longer where the quotient is very large. `fmod`.
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> Rem<O> for Simd<T, W, S> {
    type Output = Self;
    #[op]
    fn rem(self, other: O) -> Self {
        choose! { T::IS_FLOAT => self.float_rem(self.like(other)), _ => self - self / other * other }
    }
}
impl<S: Isa, T: Lane, W: Width, O: Operand<T, W, S>> RemAssign<O> for Simd<T, W, S> {
    #[inline(always)]
    fn rem_assign(&mut self, other: O) {
        *self = *self % other
    }
}

impl<S: Isa, W: Width> Simd<f32, W, S> {
    fns! {
        /// The sums of adjacent lanes. `SumsOf2`.
        pub(crate) fn sums_of_2(self) -> Simd<f64, W, S> {
            let d = self.tag().repartition::<f64>();
            d.promote_lower_to(self.shuffle::<{ p::STRIDE }, 0>(self)) + d.promote_lower_to(self.shuffle::<{ p::STRIDE }, 1>(self))
        }
    }
}

impl<S: Isa, W: Width> Simd<i16, W, S> {
    /// Adds two adjacent products to each lane of `sum`, with saturation. `U` is `i32`, and can be left out. `SatWidenMulPairwiseAccumulate`.
    ///
    /// ```
    /// # use bun_simd::prelude::*; #[kernel] fn example() {
    /// assert_eq!(i16x4::from([1, 2, 3, 4]).saturating_dot_add(10, [5, i32::MAX]), [35, i32::MAX]);
    /// # } example()
    /// ```
    #[doc(alias("sat_widen_mul_pairwise_accumulate", "SatWidenMulPairwiseAccumulate", "vpdpwssds"))]
    #[op]
    pub fn saturating_dot_add<U>(self, other: impl Operand<i16, W, S>, sum: impl Operand<i32, W, S>) -> Simd<i32, W, S>
    where
        i32: crate::lane::Is<U>,
    {
        let sum = sum.vector(self.tag().repartition());
        return_if!(
            S::AVX512VNNI || S::AVXVNNI,
            self.with_bytes(self.s.saturated_dot_i16::<W>(self.bytes(), self.like(other).bytes(), sum.bytes()))
        );
        // The sum of two products can be 2^31, which wraps. Its negative never does.
        sum.saturating_sub(-self.widen_mul_pairwise_add(other))
    }
}

impl<S: Isa, W: Width> Tag<S, i32, W> {
    fns! {
        /// `sum + 2 * a * b` with saturation. The product saturates first. `SatWidenMulAccumFixedPoint`.
        fn sat_widen_mul_accum_fixed_point(
            self,
            a: Simd<i16, W::Half, S>,
            b: Simd<i16, W::Half, S>,
            sum: Simd<i32, W, S>,
        ) -> Simd<i32, W, S> {
            return_if!(S::NEON && W::BYTES <= 16, {
                let bytes = self.repartition::<u8>();
                let (a, b) = (bytes.resize_bitcast(a).bytes(), bytes.resize_bitcast(b).bytes());
                sum.with_bytes(self.simd().saturated_mul_add_lower_i16::<W>(a, b, sum.bytes()))
            });
            halves_if!(S::A64 && W::BYTES > 16, |d: Self = self, a: Simd<i16, W::Half, S> = a, b: Simd<i16, W::Half, S> = b, sum: Simd<i32, W, S> = sum| {
                let (half, (a, b)) = (d.half(), choose! { W::BYTES == 32 => a.as_factors(b), _ => (a, b) });
                d.combine(half.sat_widen_mul_accum_fixed_point(a.upper_half(), b.upper_half(), sum.upper_half()), half.sat_widen_mul_accum_fixed_point(a.lower_half(), b.lower_half(), sum.lower_half()))
            });
            return_if!((S::AVX512VNNI || S::AVXVNNI) && W::BYTES >= 16, {
                // Each product twice. The instruction adds 2^31 for the lowest values, which is one too many unless the sum saturates.
                let twice = always!(|v: Simd<i16, W::Half, S>| self.repartition::<i16>().resize_bitcast(v).swizzle(#[inline(always)] |i| i / 2));
                let (a, b) = (twice(a), twice(b));
                let lowest = self.set(i32::MIN | 0x8000);
                let over = a.bitcast::<i32>().simd_eq(lowest) & b.bitcast::<i32>().simd_eq(lowest) & sum.simd_lt(0);
                let all = a.saturating_dot_add(b, sum);
                over.if_then_else(all - 1, all)
            });
            let product = self.widen_mul(a, b);
            let twice = product + product;
            sum.saturating_add(twice + twice.simd_eq(i32::MIN).into_vector())
        }
    }
}

/// Byte `2 * i + j` is the index `first(i) + j + FROM`.
const fn pairs<const FROM: u8>(step4: u8, mask: u8, step2: u8, offset: u8) -> [u8; 16] {
    let (mut indices, mut i) = ([0; 16], 0);
    while i < 16 {
        let lane = i / 2;
        indices[i as usize] = lane / 4 * step4 + (lane & mask) + lane / 2 * step2 + offset + i % 2 + FROM;
        i += 1;
    }
    indices
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    #[op]
    fn quad_abs_diff(self, other: Self, a: [[u8; 16]; 2], b: [[u8; 16]; 2]) -> Simd<u16, W, S> {
        let d = self.tag();
        let first = self.table_lookup_bytes(d.dup128(a[0])).abs_diff(other.table_lookup_bytes(d.dup128(b[0])));
        let second = self.table_lookup_bytes(d.dup128(a[1])).abs_diff(other.table_lookup_bytes(d.dup128(b[1])));
        first.sums_of_2() + second.sums_of_2()
    }
    fns! {
        /// The sums of eight adjacent lanes. `SumsOf8`.
        pub(crate) fn sums_of_8(self) -> Simd<u64, W, S> {
            self.sums_of_8_abs_diff(self.tag().zero())
        }
    }
    /// In each block: lane `i` is the sum of the absolute differences of the four bytes of `self` from `4 * A + i` on and
    /// those of `other` from `4 * B` on. `SumsOfAdjQuadAbsDiff`.
    #[op]
    #[track_caller]
    pub(crate) fn sums_of_adj_quad_abs_diff<const A: usize, const B: usize>(self, other: Self) -> Simd<u16, W, S> {
        require!("this takes vectors of 16 bytes or more, `A < 2` and `B < 4`", W::BYTES >= 16);
        if const { !S::SSE41 } {
            let (a, b) = (4 * A as u8, 4 * B as u8);
            return self.quad_abs_diff(
                other,
                [pairs::<0>(0, 7, 0, a), pairs::<2>(0, 7, 0, a)],
                [pairs::<0>(0, 0, 0, b), pairs::<2>(0, 0, 0, b)],
            );
        }
        if_here!(S::AVX512BW && W::BYTES >= 64, {
            let (a, b) = (self.bitcast::<u32>(), other.bitcast::<u32>().broadcast::<B>());
            let a = if A == 0 { a.shuffle4::<0b10_01_01_00>() } else { a.shuffle4::<0b11_10_10_01>() };
            return self.with_bytes(self.s.double_block_quads::<W>(a.bytes(), b.bytes()));
        });
        self.with_bytes(self.s.adjacent_quads::<W>(self.bytes(), other.bytes(), (4 * A + B) as u64))
    }
    /// In each block, after `shuffle4::<ORDER>` of the 32-bit lanes of `self`: lane `i` is the sum of the absolute
    /// differences of its four bytes from `i / 4 * 8 + i % 4` on and those of `other` from `i / 2 * 4` on.
    /// `SumsOfShuffledQuadAbsDiff`.
    #[op]
    pub(crate) fn sums_of_shuffled_quad_abs_diff<const ORDER: usize>(self, other: Self) -> Simd<u16, W, S> {
        let shuffled = self.bitcast::<u32>().shuffle4::<ORDER>().bitcast::<u8>();
        if_here!(S::AVX512BW, {
            return self.with_bytes(self.s.double_block_quads::<W>(shuffled.bytes(), other.bytes()));
        });
        const A: [[u8; 16]; 2] = [pairs::<0>(8, 3, 0, 0), pairs::<2>(8, 3, 0, 0)];
        shuffled.quad_abs_diff(other, A, const { [pairs::<0>(0, 0, 4, 0), pairs::<2>(0, 0, 4, 0)] })
    }
}

impl<S: Isa, W: Width> Simd<i8, W, S> {
    #[op]
    fn biased(self) -> Simd<u8, W, S> {
        self.cast_unsigned() ^ 0x80_u8
    }
    fns! {
        /// The sums of eight adjacent lanes. `SumsOf8`.
        pub(crate) fn sums_of_8(self) -> Simd<i64, W, S> {
            choose! { S::ARM => self.sums_of_4().sums_of_2(), _ => self.biased().sums_of_8().cast_signed() - 8 * 128 }
        }
        /// The sums of eight adjacent absolute differences. `SumsOf8AbsDiff`.
        pub(crate) fn sums_of_8_abs_diff(self, other: impl Operand<i8, W, S>) -> Simd<i64, W, S> {
            let other = self.like(other);
            if const { S::ARM } { live!(S::ARM, self.abs_diff(other).sums_of_8()) } else { live!(!S::ARM, self.biased().sums_of_8_abs_diff(other.biased())) }.cast_signed()
        }
    }
    /// As for `u8`. `SumsOfAdjQuadAbsDiff`.
    #[op]
    pub(crate) fn sums_of_adj_quad_abs_diff<const A: usize, const B: usize>(self, other: Self) -> Simd<i16, W, S> {
        self.biased().sums_of_adj_quad_abs_diff::<A, B>(other.biased()).cast_signed()
    }
    /// As for `u8`. `SumsOfShuffledQuadAbsDiff`.
    #[op]
    pub(crate) fn sums_of_shuffled_quad_abs_diff<const ORDER: usize>(self, other: Self) -> Simd<i16, W, S> {
        self.biased().sums_of_shuffled_quad_abs_diff::<ORDER>(other.biased()).cast_signed()
    }
}

/// A number to divide many vectors by, with a multiplication and shifts: `v / divisor` and `v % divisor`.
/// It follows Granlund and Montgomery, "Division by Invariant Integers using Multiplication".
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let by = Divisor::new(10u32).unwrap();
/// assert!(Divisor::new(0i8).is_none());
/// let v = u32x4::from([5, 10, 99, 12345]);
/// assert_eq!(((v / by).to_array(), (v % by).to_array()), ([0, 1, 9, 1234], [5, 0, 9, 5]));
/// # } example()
/// ```
#[doc(alias("div", "divide", "division", "libdivide"))]
#[derive(Copy, Clone, Debug)]
pub struct Divisor<T> {
    divisor: T,
    factor: T,
    shift: u32,
}

impl<T: Int> Divisor<T> {
    /// `None` for zero. The lowest value divided by -1 wraps.
    #[op]
    pub fn new(divisor: T) -> Option<Self> {
        if divisor == T::ZERO { None } else { Some(Self::of(divisor)) }
    }
    #[op]
    #[track_caller]
    fn not_zero(divisor: T) -> Self {
        assert!(T::BITS == 64 || divisor != T::ZERO, "attempt to divide by zero");
        let it = Self::of(divisor);
        // For speed: with 64 bits the test comes last. The factor of one is not zero, so zero panics.
        assert!((divisor != T::ZERO) | (it.factor == T::ZERO), "attempt to divide by zero");
        it
    }
    /// With 64 bits, zero gets the factor of one.
    #[op]
    fn of(divisor: T) -> Self {
        let signed = matches!(T::KIND, Kind::Signed);
        let magnitude = if signed { (divisor.to_u64() as i64).unsigned_abs() } else { divisor.to_u64() };
        let magnitude = if T::BITS == 64 { magnitude.max(1) } else { magnitude };
        if signed {
            let log = (64 - (magnitude - 1).leading_zeros()).max(1);
            let k = T::BITS + log - 1;
            let factor = if T::BITS == 64 { ((1 << k) / magnitude as u128) as u64 } else { (1 << k) / magnitude };
            return Self { divisor, factor: T::from_u64(factor + 1), shift: log - 1 };
        }
        // With `k = BITS + shift + 1`, `2^BITS + factor` is below `2^k / divisor` by 1 at most. A product with it is short by less than
        // `2^BITS`, which the rounding of the mean adds, and which is less than `2^k / divisor`, the step to the next dividend.
        let magnitude = magnitude as u128;
        let shift = magnitude.ilog2();
        let rest = (u128::MAX >> (127 - T::BITS - shift)) - if T::BITS == 64 { magnitude << 64 } else { 0 };
        Self { divisor, factor: T::from_u64((rest / magnitude) as u64), shift }
    }
}

/// A shift, a factor that fits a lane, and another shift, for a divisor that is no power of two. By theorems 4.2 and 5.1, `2^k / divisor + 1`
/// divides all numbers of `n` bits if it is too large by `2^(k - n) / divisor` at most.
#[op]
fn short_factor(divisor: u64, bits: u32, signed: bool, fewer: bool) -> Option<(u32, u64, u32)> {
    let n = bits - signed as u32;
    let factor = always!(|divisor: u64| {
        let k = n + divisor.ilog2();
        let factor = (1u128 << k) / divisor as u128 + 1;
        (factor as u64, factor * divisor as u128 - (1 << k), k - bits)
    });
    let (whole, excess, after) = factor(divisor);
    // With fewer bits in the dividend, it always does, as below.
    if fewer || excess <= 1 << divisor.ilog2() {
        return Some((0, whole, after));
    }
    let zeros = divisor.trailing_zeros();
    if signed || zeros == 0 {
        return None;
    }
    let (odd, _, after) = factor(divisor >> zeros);
    Some((zeros, odd, after))
}

impl<S: Isa, T: Int, W: Width> Operand<T, W, S> for Divisor<T> {
    #[inline(always)]
    fn vector(self, d: Tag<S, T, W>) -> Simd<T, W, S> {
        d.set(self.divisor)
    }
    #[op]
    fn divide(self, v: Simd<T, W, S>) -> Simd<T, W, S> {
        let number = self.divisor.to_u64();
        if crate::OPTIMIZED && is_known!(number) && self.divisor > T::default() {
            let signed = matches!(T::KIND, Kind::Signed);
            if number.is_power_of_two() {
                let log = number.trailing_zeros();
                // Negative numbers get `divisor - 1` first.
                let more = choose! { matches!(T::KIND, Kind::Signed) => v >> (T::BITS - 1) & T::from_u64(number - 1), _ => v.tag().zero() };
                return (v + more) >> log;
            }
            return_if!(S::SSE2 && T::BITS == 8 && W::BYTES >= 16, {
                // A factor of 16 bits is exact.
                let (pairs, factor) = (v.bitcast::<T::Wide>(), Wide::<T>::from_u64(65536 / number + 1));
                let of = always!(|n: usize| Wide::<T>::from_usize(n));
                let odd = (pairs & of(0xff00)).mul_high(factor) & of(0xff00);
                choose! {
                    T::IS_SIGNED => (((pairs << 8).mul_high(factor).cast_unsigned() >> 8).bitcast() | odd).bitcast::<T>() - (v >> 7),
                    _ => ((pairs & of(0xff)).mul_high(factor) | odd).bitcast(),
                }
            });
            if const { Simd::<T, W, S>::DOUBLES } {
                // Half of a number without a sign is one with a sign.
                let before = if signed { 0 } else { number.trailing_zeros() };
                if (signed || before > 0)
                    && let Some((_, factor, after)) = short_factor(number >> before, T::BITS, true, before > 1)
                {
                    let quotient = (v >> before).twice_high(T::from_u64(factor)) >> (after + 1);
                    return choose! { matches!(T::KIND, Kind::Signed) => quotient - (v >> (T::BITS - 1)), _ => quotient };
                }
            }
            if let Some((before, factor, after)) = short_factor(number, T::BITS, signed, false) {
                let high = (v >> before).mul_high(T::from_u64(factor));
                // LLVM would shift the whole products.
                let quotient = choose! { S::ARM => high.barrier(), _ => high } >> after;
                return choose! { matches!(T::KIND, Kind::Signed) => quotient - (v >> (T::BITS - 1)), _ => quotient };
            }
        }
        // The factor is not the lowest number.
        let high = choose! { Simd::<T, W, S>::DOUBLES && T::IS_SIGNED => v.twice_high(self.factor) >> 1, _ => v.mul_high(self.factor) };
        choose! {
            matches!(T::KIND, Kind::Signed) => {
                let sign = v.tag().set(self.divisor >> (T::BITS - 1));
                ((((v + high) >> self.shift) - (v >> (T::BITS - 1))) ^ sign) - sign
            },
            // Next to a known factor or shift, LLVM loses `pavg`.
            S::SSE2 && T::BITS <= 16 && W::BYTES >= 16 => v.midpoint_up(high.black_box()).black_box() >> self.shift,
            S::A64 && T::BITS <= 32 => v.midpoint_up(high) >> self.shift,
            S::A64 && W::BYTES >= 16 => (high + (v - high).rounding_shr(1)) >> self.shift,
            _ => (v - ((v - high) >> 1)) >> self.shift,
        }
    }
}
