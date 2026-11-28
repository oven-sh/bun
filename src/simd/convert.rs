//! Conversions of floating-point numbers. Those of 16 bits are their bits here, in lanes of `u16`.

use crate::lane::Kind;
use crate::raw::Bits;
use crate::raw::same;
use crate::{Float, Isa, Lane, MaskOf, Simd, Tag, Width};

type V<S, T, W> = Simd<T, W, S>;

/// Whether the instructions of x86 convert to integers of this size.
const fn x86<S: Isa>(bits: u32) -> bool {
    S::SSE2 && (bits == 32 || cfg!(target_arch = "x86_64") || S::SSE41)
}
const fn avx512<S: Isa>() -> bool {
    crate::X86 && S::COMPRESS[2] == 64
}
/// Whether `f64` is converted with shifts, which give zero for what is out of range.
const fn shifts<S: Isa, T: Lane, W: Width>() -> bool {
    S::SSE41
        && !avx512::<S>()
        && T::BITS == 64
        && (W::BYTES >= 32 && S::REGISTER >= 32 || matches!(T::KIND, Kind::Unsigned) || cfg!(target_arch = "x86"))
}
const fn has_f16<S: Isa>() -> bool {
    cfg!(any(all(target_arch = "aarch64", target_feature = "neon"), target_feature = "zvfhmin")) || const { S::F16C }
}
/// 2 to the power of `n`.
#[op]
fn power<S: Isa, T: Lane, W: Width>(d: Tag<S, T, W>, n: u32) -> V<S, T, W> {
    d.set(T::from_u64(1 << (n - 1))) + d.set(T::from_u64(1 << (n - 1)))
}

const fn two_to(n: u64) -> f64 {
    f64::from_bits((1023 + n) << 52)
}
/// The nearest integer modulo 2^64, below 2^80. The first addition rounds to a multiple of 2^32, and the second rounds the rest.
#[on(X86)]
#[op]
fn integer_bits<S: Isa, W: Width>(v: V<S, f64, W>) -> V<S, u64, W> {
    const LOWER: f64 = 1.5 * two_to(52);
    // Its lowest bits cancel the highest of LOWER.
    const UPPER: f64 = f64::from_bits((1.5 * two_to(52 + 32)).to_bits() - (LOWER.to_bits() >> 32));
    let upper = v + UPPER;
    (upper.bitcast::<u64>() << 32) + (v - (upper - UPPER) + LOWER).bitcast::<u64>()
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// The smallest integer for all that is out of range, on x86.
    #[op]
    fn truncate_signed<U: Lane>(self, v: V<S, U, W>) -> V<S, T::Signed, W> {
        let s = self.simd();
        return_if!(avx512::<S>() && T::BITS == 64 && W::BYTES < 32, {
            let wide = s.fixed::<U, crate::B32>().resize_bitcast(v);
            self.to_signed().resize_bitcast(s.fixed::<T, crate::B32>().truncate_signed(wide))
        });
        v.with_bytes(if const { T::BITS == 32 } {
            s.truncate_f32_i32::<W>(v.bytes())
        } else {
            s.truncate_f64_i64::<W>(v.bytes())
        })
    }
    #[op]
    fn truncate<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        assert!(T::BITS == U::BITS);
        let s = self.simd();
        choose! {
            shifts::<S, T, W>() => {
                if const { matches!(T::KIND, Kind::Unsigned) } {
                    return v.with_bytes(s.truncate_f64_u64::<W>(v.bytes()));
                }
                let (magnitude, sign) = (v.with_bytes::<i64>(s.truncate_f64_u64::<W>((v.bitcast::<u64>() & u64::MAX >> 1).bytes())), v.bitcast::<i64>().broadcast_sign_bit());
                ((magnitude ^ sign) - sign).bitcast()
            },
            S::WASM && T::BITS == 32 && T::IS_SIGNED => v.with_bytes(s.truncate_f32_i32::<W>(v.bytes())),
            !x86::<S>(T::BITS) => self.cast(v),
            matches!(T::KIND, Kind::Signed) => self.truncate_signed(v).bitcast(),
            avx512::<S>() => v.with_bytes(if const { T::BITS == 32 } { s.truncate_f32_u32::<W>(v.bytes()) } else { s.truncate_f64_u64::<W>(v.bytes()) }),
            _ => self.truncate_unsigned(v, v),
        }
    }
    /// `same` is `v` from half of the range on. There, the lower bits are those of the mantissa, and the exponent is even.
    #[op]
    fn truncate_unsigned<U: Lane>(self, v: V<S, U, W>, same: V<S, U, W>) -> V<S, T, W> {
        let (small, big) = (self.truncate_signed(v), same.bitcast::<T::Signed>() << if T::BITS == 32 { 8 } else { 11 });
        (small | big & small.broadcast_sign_bit()).bitcast()
    }
    /// Between integers and floating-point numbers of the same size, like `as`. `ConvertTo`.
    #[op]
    #[track_caller]
    pub(crate) fn convert_to<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        require!("the lanes of the argument have to be as wide as those of the result: see `cast` and `saturating_cast`", true, at any width size_of::<U>() == size_of::<T>());
        self.convert(v)
    }
    /// For branches that are dead for some types of lanes.
    #[op]
    pub(crate) fn convert<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        return_if!(
            x86::<S>(T::BITS) && T::BITS == U::BITS && T::BITS > 16 && matches!(U::KIND, Kind::Float) != matches!(T::KIND, Kind::Float),
            |this: Self = self, v: V<S, U, W> = v| this.convert_on_x86(v)
        );
        self.cast(v)
    }
    #[on(X86)]
    #[inline(always)]
    fn convert_on_x86<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        apart!(v.s, {
            if_here!(x86::<S>(T::BITS) && T::BITS == U::BITS, {
                match (U::KIND, T::KIND) {
                    (Kind::Float, Kind::Signed) if const { shifts::<S, T, W>() } => {
                        let (abs, limit) =
                            (v.bitcast::<f64>().abs(), v.bitcast::<i64>().broadcast_sign_bit() ^ i64::MAX);
                        return abs
                            .simd_ge(power(abs.tag(), 63))
                            .retype::<i64>()
                            .if_then_else(limit, self.truncate(v).bitcast())
                            .bitcast();
                    }
                    (Kind::Float, Kind::Unsigned) if const { shifts::<S, T, W>() } => {
                        return self.truncate(v) | v.simd_ge(power(v.tag(), 64)).to_vector().bitcast();
                    }
                    (Kind::Float, Kind::Signed) if const { avx512::<S>() } => {
                        return live!(
                            avx512::<S>() && U::IS_FLOAT && T::IS_SIGNED,
                            v.with_bytes(v.s.saturated_int::<W>(v.bytes(), (T::BITS == 64, false)))
                        );
                    }
                    (Kind::Float, Kind::Signed) => {
                        let too_big = v.simd_ge(power(v.tag(), T::BITS - 1)).to_vector().bitcast();
                        return v.simd_eq(v).if_then_else_zero::<U>((self.truncate(v) ^ too_big).bitcast()).bitcast();
                    }
                    (Kind::Float, Kind::Unsigned) => {
                        let positive = v.if_greater(v.tag().zero());
                        return choose! {
                            avx512::<S>() => self.truncate(positive),
                            _ => self.truncate_unsigned(positive, v) | v.simd_ge(power(v.tag(), T::BITS)).to_vector().bitcast(),
                        };
                    }
                    (Kind::Unsigned, Kind::Float) if const { T::BITS == 32 && S::SSE41 && !avx512::<S>() } => {
                        // As below.
                        let (v, of) = (v.bitcast::<u32>(), |n: u32| f32::from_bits((127 + n) << 23));
                        let lower =
                            v.tag().set(of(23).to_bits()).bitcast::<u16>().odd_even(v.bitcast()).bitcast::<f32>();
                        return ((v >> 16 | of(39).to_bits()).bitcast::<f32>() - (of(39) + of(23)) + lower).bitcast();
                    }
                    (_, Kind::Float) if const { T::BITS == 64 && !avx512::<S>() } => {
                        // v + 2^63 is upper * 2^32 + lower. The lowest bit of 2^(52 + n) is worth 2^n. Only the last step rounds.
                        let (v, d) = (v.bitcast::<u64>(), self.repartition::<u64>());
                        let above = two_to(52 + 32) + if U::IS_SIGNED { two_to(63) } else { 0.0 };
                        let upper = (v >> 32 ^ above.to_bits()).bitcast::<f64>();
                        let lower = d.set(two_to(52).to_bits()).bitcast::<u32>().odd_even(v.bitcast()).bitcast::<f64>();
                        return (upper - (above + two_to(52)) + lower).bitcast();
                    }
                    _ => {}
                }
            });
            self.cast(v)
        })
    }
    #[op]
    #[track_caller]
    fn promote_alternate<U: Lane, const ODD: bool>(self, v: V<S, U, W>) -> V<S, T, W> {
        require!("the lanes of the argument have to be half as wide as those of the result", T::BITS == 2 * U::BITS);
        if const { U::FRACTION == 7 && T::FRACTION == 23 } {
            let d = self.repartition::<f32>();
            return if ODD { d.promote_odd_bf16_to(v.bitcast()) } else { d.promote_even_bf16_to(v.bitcast()) }
                .bitcast();
        }
        match (U::KIND, T::KIND) {
            _ if const { U::IS_FLOAT || T::IS_FLOAT } => {
                self.promote_lower_to(if ODD { v.tag().concat_odd(v, v) } else { v.tag().concat_even(v, v) })
            }
            // In the order of the CPU, the even lane is the upper half.
            _ if cfg!(target_endian = "big") => {
                let pairs = V::<S, T::Unsigned, W>::new(v.s, Bits::from_native(v.raw.to_native()));
                let pairs = if ODD { pairs << U::BITS } else { pairs };
                if U::KIND == Kind::Signed {
                    (pairs.cast_signed() >> U::BITS).bitcast()
                } else {
                    (pairs >> U::BITS).bitcast()
                }
            }
            (Kind::Signed, _) if const { S::SSE41 && !S::AVX2 && U::BITS == 32 && W::BYTES == 16 && !ODD } => {
                self.promote_lower_to(v.tag().concat_even(v, v))
            }
            (Kind::Signed, _) if ODD => (v.bitcast::<T::Signed>() >> U::BITS).bitcast(),
            (Kind::Signed, _) => (v.bitcast::<T::Signed>() << U::BITS >> U::BITS).bitcast(),
            _ if ODD => (v.bitcast::<T::Unsigned>() >> U::BITS).bitcast(),
            _ => (v.bitcast::<T::Unsigned>() << U::BITS >> U::BITS).bitcast(),
        }
    }
    /// The even lanes, to a type of twice the size. `PromoteEvenTo` and `PromoteInRangeEvenTo`.
    #[op]
    #[track_caller]
    pub(crate) fn promote_even_to<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        self.promote_alternate::<U, false>(v)
    }
    /// The odd lanes, to a type of twice the size. `PromoteOddTo` and `PromoteInRangeOddTo`.
    #[op]
    #[track_caller]
    pub(crate) fn promote_odd_to<U: Lane>(self, v: V<S, U, W>) -> V<S, T, W> {
        self.promote_alternate::<U, true>(v)
    }
    /// `f32` to 64-bit integers and `f64` to 32-bit integers, which LLVM does lane by lane on x86.
    #[op]
    pub(crate) fn float_to_other_size<U: Lane, X: Width>(self, v: V<S, U, X>) -> Option<V<S, T, W>> {
        choose! { |this: Self = self, v: V<S, U, X> = v|
            S::A64 && matches!(U::KIND, Kind::Float) && !matches!(T::KIND, Kind::Float) && U::BITS == 64 && T::BITS == 32 => {
                Some(choose! {
                    matches!(T::KIND, Kind::Signed) => this.demote(v.tag().repartition::<i64>().cast(v)),
                    _ => this.demote(v.tag().repartition::<u64>().cast(v)),
                })
            },
            (S::SSE2 || cfg!(target_feature = "lsx")) && !avx512::<S>() && matches!(T::KIND, Kind::Float) && T::BITS == 32 && U::BITS == 64
                && (matches!(U::KIND, Kind::Unsigned) || matches!(U::KIND, Kind::Signed) && X::BYTES >= 32 && S::REGISTER >= 32) => {
                // By way of `f64`. What that can't hold is rounded to odd, after which it doesn't matter that there are two steps.
                let bits = v.bitcast::<u64>();
                let small = if const { matches!(U::KIND, Kind::Signed) } { live!(matches!(U::KIND, Kind::Signed), (bits + (1u64 << 53)) >> 54) } else { live!(!(matches!(U::KIND, Kind::Signed)), bits >> 53) }.simd_eq(0u64);
                let lost = small.if_then_zero_else(0x7ffu64);
                Some(this.cast(v.tag().repartition::<f64>().convert(lost.and_not(bits | ((bits & lost) + lost)).bitcast::<U>())))
            },
            !x86::<S>(T::BITS) || !matches!(U::KIND, Kind::Float) || matches!(T::KIND, Kind::Float) => None,
            avx512::<S>() && U::BITS == 32 && T::BITS == 64 && (W::BYTES == 32 || W::BYTES == 64) => {
                let all = always!(|v: V<S, U, X>| {
                    let v = this.resize_bitcast(v);
                    v.with_bytes::<T>(v.s.truncate_f32_64::<W>(v.bytes(), T::IS_SIGNED))
                });
                return_if!(!T::IS_SIGNED, Some(all(v.if_greater(v.tag().zero()))));
                let (number, above): (MaskOf<T, W, S>, MaskOf<T, W, S>) = (same(v.simd_eq(v).rebind::<T::Signed>()), same(v.simd_ge(power(v.tag(), 63)).rebind::<T::Signed>()));
                Some(above.if_then_else(this.set(T::MAX), number.if_then_else_zero(all(v))))
            },
            U::BITS == 32 && T::BITS == 64 => Some(this.convert(this.repartition::<f64>().cast(v))),
            U::BITS == 64 && T::BITS == 32 => {
                assert!(v.tag().lanes() == this.lanes());
                let (v, signed) = (v.bitcast::<f64>(), T::KIND == Kind::Signed);
                return_if!(avx512::<S>() && matches!(T::KIND, Kind::Unsigned), Some(this.resize_bitcast(v.with_bytes::<u8>(this.simd().truncate_f64_u32::<X>(v.if_greater(v.tag().zero()).bytes())))));
                return_if!(S::SSE2 && (!S::AVX2 || X::BYTES <= 16) && !T::IS_SIGNED, {
                    let v = v.if_greater(v.tag().zero()).simd_min_relaxed(4294967295.0);
                    let near = choose! { S::ONLY_SSE2 => v, _ => v.trunc() } + two_to(52);
                    let above = choose! { S::ONLY_SSE2 => (near - two_to(52)).simd_gt(v).to_simd::<f64>(), _ => v.tag().zero() };
                    Some(this.cast(near.bitcast::<u64>() + above.bitcast::<u64>()))
                });
                let v = if signed {
                    v.simd_eq(v).if_then_else_zero(v.simd_min_relaxed(2147483647.0))
                } else {
                    v.if_greater(v.tag().zero()).simd_min_relaxed(4294967295.0).trunc() - 2147483648.0
                };
                let lower = v.with_bytes::<u8>(this.simd().truncate_f64_i32::<X>(v.bytes()));
                let lanes = this.repartition::<u32>().resize_bitcast(lower);
                Some(if signed { lanes } else { lanes ^ 0x8000_0000u32 }.bitcast())
            },
            _ => None,
        }
    }
}

impl<S: Isa, T: Lane, W: Width> Tag<S, T, W> {
    /// Rounds toward zero. The result is unspecified for what is out of range. `ConvertInRangeTo`.
    #[inline(always)]
    pub(crate) fn convert_in_range_to<U: Float>(self, v: V<S, U, W>) -> V<S, T, W> {
        self.truncate(v)
    }
    /// To 64 bits. Rounds toward zero. The result is unspecified for what is out of range. `PromoteInRangeTo`.
    #[op]
    pub(crate) fn promote_in_range_to(self, v: V<S, f32, W::Half>) -> V<S, T, W> {
        self.truncate(self.repartition::<f64>().promote_to(v))
    }
    /// To 32 bits. Rounds toward zero. The result is unspecified for what is out of range. `DemoteInRangeTo`.
    #[op]
    #[track_caller]
    pub(crate) fn demote_in_range_to(self, v: V<S, f64, W::Twice>) -> V<S, T, W> {
        require!("this makes lanes of 32 bits, in less than 512 bytes", W::BYTES < 512 && T::BITS == 32);
        halves_if!(W::BYTES >= 64, |this: Self = self, v: V<S, f64, W::Twice> = v| {
            let half = this.part::<W::Twice>();
            this.join(half.demote_in_range_to(same(v.lower_half())), half.demote_in_range_to(same(v.upper_half())))
        });
        if_here!(avx512::<S>() && matches!(T::KIND, Kind::Unsigned), {
            return self.resize_bitcast(v.with_bytes::<u8>(self.simd().truncate_f64_u32::<W::Twice>(v.bytes())));
        });
        if T::KIND == Kind::Unsigned {
            return self.demote_to(v);
        }
        self.resize_bitcast(v.with_bytes::<u8>(self.simd().truncate_f64_i32::<W::Twice>(v.bytes())))
    }
    /// To 32 bits. Ties go to the even number. With `IN_RANGE`, it is unspecified on x86 for what is not. `DemoteToNearestInt`.
    #[op]
    pub(crate) fn demote_to_nearest_int<const IN_RANGE: bool>(self, v: V<S, f64, W::Twice>) -> V<S, T, W> {
        halves_if!(W::BYTES >= 64, |this: Self = self, v: V<S, f64, W::Twice> = v| {
            let half = this.part::<W::Twice>();
            this.join(half.demote_to_nearest_int::<IN_RANGE>(same(v.lower_half())), half.demote_to_nearest_int::<IN_RANGE>(same(v.upper_half())))
        });
        return_if!(x86::<S>(32) && matches!(T::KIND, Kind::Signed) && T::BITS == 32, {
            let v = choose! { IN_RANGE => v, _ => v.simd_eq(v).if_then_else_zero(v.simd_min_relaxed(2147483647.0)) };
            self.resize_bitcast(v.with_bytes::<u8>(self.simd().nearest_f64_i32::<W::Twice>(v.bytes())))
        });
        // The sum rounds, and has the integer in its lowest bits.
        return_if!(S::SSE2 && !avx512::<S>() && T::BITS == 32 && !T::IS_SIGNED, {
            let v = choose! { IN_RANGE => v, _ => v.if_greater(v.tag().zero()).simd_min_relaxed(4294967295.0) };
            self.cast((v + 1.5 * two_to(52)).bitcast::<u64>())
        });
        // What is too large gives all ones.
        return_if!(avx512::<S>() && T::BITS == 32 && !T::IS_SIGNED, {
            let v = choose! { IN_RANGE => v, _ => v.if_greater(v.tag().zero()) };
            self.resize_bitcast(v.with_bytes::<u8>(self.simd().nearest_f64_u32::<W::Twice>(v.bytes())))
        });
        return_if!(S::A64, self.demote(v.nearest_int()));
        self.demote_to(v.round_ties_even())
    }
}

impl<S: Isa, W: Width> Simd<f64, W, S> {
    /// Ties go to the even number. The result is unspecified for what is out of range. `NearestInt`.
    #[op]
    pub(crate) fn nearest_int(self) -> V<S, i64, W> {
        return_if!(cfg!(target_feature = "sse2") && !avx512::<S>(), integer_bits(self).bitcast());
        if_here!(S::A64 || S::AVX512F, {
            return self.with_bytes(self.s.nearest_f64_i64::<W>(self.bytes()));
        });
        self.tag().to_signed().convert_in_range_to(self.round_ties_even())
    }
}

impl<S: Isa, X: Width> Simd<u16, X, S> {
    /// From the bits of `f16`, for up to 32 bytes. `PromoteTo`.
    #[op]
    pub(crate) fn promote_f16(self) -> V<S, f32, X::Twice> {
        let (v, d) = (self, self.s.fixed::<u32, X::Twice>());
        choose! {
            // Or it is inserted into any register, and waits for that.
            S::F16C && X::BYTES == 2 => {
                let all = self.s.fixed::<u16, crate::B16>().set(v.get_lane()).black_box();
                d.resize_any(all.with_bytes::<u32>(self.s.f16_to_f32::<crate::B16>(all.bytes()))).bitcast()
            },
            has_f16::<S>() => {
                let lower = d.resize_bitcast(v);
                lower.with_bytes(self.s.f16_to_f32::<X::Twice>(lower.bytes()))
            },
            S::SSE2 && X::BYTES >= 16 => {
                // As below, with what can be done in 16 bits.
                let (abs, zero) = (v & 0x7fff, v.tag().zero());
                let more = abs.cast_signed().simd_ge(0x7c00).to_vector().cast_unsigned() & 0x7f80 | v ^ abs;
                let wide = always!(|low: Self, high: Self| {
                    let [a, b] = low.interleave(high);
                    a.concat(b).bitcast::<u32>()
                });
                let normal = wide(v << 13, (abs >> 3) + (112 << 7));
                let subnormal = (normal + (1 << 23)).bitcast::<f32>() - f32::from_bits(113 << 23);
                (normal.bitcast::<f32>().lesser(subnormal).bitcast::<u32>() | wide(zero, more)).bitcast()
            },
            _ => {
                let bits = d.promote_to(v);
                let abs = (bits & 0x7fff) << 13;
                // The value as if it were normal and as if it were not: the lesser is right. A subnormal operand would be slow.
                let subnormal = (abs + (113 << 23)).bitcast::<f32>() - f32::from_bits(113 << 23);
                let scaled = (abs + (112 << 23)).bitcast::<f32>().lesser(subnormal).bitcast::<u32>();
                let special = abs.cast_signed().simd_ge(0x7c00 << 13).to_vector().bitcast::<u32>() & 0x7f80_0000;
                (scaled | special | (bits & 0x8000) << 16).bitcast()
            },
        }
    }
}

impl<S: Isa, W: Width> Tag<S, f32, W> {
    /// `PromoteEvenTo`.
    #[op]
    pub(crate) fn promote_even_bf16_to(self, v: V<S, u16, W>) -> V<S, f32, W> {
        (v.bitcast::<u32>() << 16).bitcast()
    }
    /// `PromoteOddTo`.
    #[op]
    pub(crate) fn promote_odd_bf16_to(self, v: V<S, u16, W>) -> V<S, f32, W> {
        (v.bitcast::<u32>() & 0xffff_0000u32).bitcast()
    }
}

/// In the upper half of each lane.
#[op]
fn round_to_bf16<S: Isa, W: Width>(v: V<S, f32, W>) -> V<S, u32, W> {
    let number = to_even(v.bitcast());
    return_if!(S::AVX512F, v.with_bytes(v.s.or_quiet_nan::<W>(number.bytes(), v.bytes())));
    v.simd_eq(v).if_then_else(number, v.bitcast::<u32>() | 0x0040_0000)
}
/// The same for numbers.
#[op]
pub(crate) fn to_even<S: Isa, W: Width>(bits: V<S, u32, W>) -> V<S, u32, W> {
    return_if!(S::A64, bits - bits.any_bits(0x1_0000).to_simd::<u32>() + 0x7fff);
    return_if!(S::AVX512F && W::BYTES >= 64, bits.any_bits(1 << 16).if_then_else(bits + 0x8000, bits + 0x7fff));
    bits + 0x7fff + (bits >> 16 & 1)
}

impl<S: Isa, W: Width> Tag<S, u16, W> {
    /// To the bits of `f16`. Ties go to the even number. It doesn't build if the numbers of lanes differ. `DemoteTo`.
    #[op]
    pub(crate) fn demote_to_f16<U: Float, X: Width>(self, v: V<S, U, X>) -> V<S, u16, W> {
        halves_if!(X::BYTES > 64, |this: Self = self, v: V<S, U, X> = v| {
            let (half, [lower, upper]) = (this.part::<X>(), v.parts::<X>());
            this.join(half.demote_to_f16(lower), half.demote_to_f16(upper))
        });
        assert!(v.tag().lanes() == self.lanes());
        let d = self.simd().fixed::<f32, W::Twice>();
        let v = choose! {
            U::BITS == 32 => d.resize_bitcast(v),
            S::A64 => d.resize_bitcast(v.with_bytes::<u8>(self.simd().odd_f64_f32::<X>(v.bytes()))),
            _ => {
                // Rounds to odd, after which it doesn't matter that there are two steps.
                let bits = v.bitcast::<u64>();
                let lost = (1u64 << 29) - 1;
                d.demote_to(((bits | ((bits & lost) + lost)) & !lost).bitcast::<f64>())
            },
        };
        return_if!(
            has_f16::<S>(),
            self.resize_bitcast(v.with_bytes::<u8>(self.simd().f32_to_f16::<W::Twice>(v.bytes())))
        );
        // The lowest bit of the power of two is worth as much as that of the result, so that the addition rounds. It leaves up
        // to 2048 in the lowest bits, of which 1024 and 2048 carry into the exponent.
        let bits = v.bitcast::<i32>();
        let abs = bits & i32::MAX;
        let within = choose! {
            S::SSE2 && S::ONLY_SSE2 => abs.bitcast::<f32>().lesser(d.set(65536.0)).bitcast::<i32>(),
            _ => abs.simd_min((127 + 16) << 23),
        };
        let exponent = (within & 0x7f80_0000)
            .bitcast::<u16>()
            .saturating_sub(bits.tag().set((127 - 14) << 23).bitcast::<u16>())
            .bitcast::<i32>();
        let power = exponent + ((127 - 14 + 13) << 23);
        let rounded = (within.bitcast::<f32>() + power.bitcast::<f32>()).bitcast::<i32>() - power + (exponent >> 13);
        let quiet = abs.simd_gt(0x7f80_0000).if_then_else_zero(bits.tag().set(0x200));
        let narrow = self.to_signed();
        (narrow.demote_to(rounded | quiet) | narrow.demote_to(bits) & i16::MIN).bitcast()
    }
    /// To the bits of `bf16`. Ties go to the even number. `DemoteTo`.
    #[inline(always)]
    pub(crate) fn demote_to_bf16(self, v: V<S, f32, W::Twice>) -> V<S, u16, W> {
        apart!(v.s, {
            return_if!(
                S::HAS_BF16 && W::BYTES >= 16,
                self.ordered_demote2_to_bf16(v.lower_half().same(), v.upper_half().same())
            );
            return_if!(S::HAS_BF16, {
                let (d, v) =
                    (self.simd().fixed::<u16, crate::B16>(), self.simd().fixed::<f32, crate::B16>().resize_bitcast(v));
                self.resize_any(d.ordered_demote2_to_bf16(v, v))
            });
            self.upper_halves(round_to_bf16(v))
        })
    }
    #[op]
    fn upper_halves(self, v: V<S, u32, W::Twice>) -> V<S, u16, W> {
        return_if!(S::A64, self.cast(v >> 16));
        return_if!(
            S::AVX512VBMI && W::BYTES == 32,
            v.bitcast::<u16>().of_one(always!(|i: usize| (2 * i + 1) % 32)).lower_half().same()
        );
        return_if!(S::AVX512BW && W::BYTES == 64, self.concat_odd(v.upper_half().same(), v.lower_half().same()));
        self.demote_to((v >> 16).cast_signed())
    }
    /// The same, but for NaN, which gives anything, and for subnormal numbers, which can give zero.
    #[op]
    pub(crate) fn demote_numbers_to_bf16(self, v: V<S, f32, W::Twice>) -> V<S, u16, W> {
        halves_if!(W::BYTES > S::REGISTER && W::BYTES > 16, |this: Self = self, v: V<S, f32, W::Twice> = v| {
            let d = this.half();
            this.combine(d.demote_numbers_to_bf16(v.upper_half().same()), d.demote_numbers_to_bf16(v.lower_half().same()))
        });
        return_if!(S::HAS_BF16 && W::BYTES >= 16, {
            let (a, b) = (v.lower_half().same::<f32, W>(), v.upper_half().same::<f32, W>());
            a.with_bytes(a.s.narrow_bf16::<W>(a.bytes(), b.bytes()))
        });
        return_if!(S::HAS_BF16, {
            let (d, v) =
                (self.simd().fixed::<u16, crate::B16>(), self.simd().fixed::<f32, crate::B32>().resize_bitcast(v));
            self.resize_any(d.demote_numbers_to_bf16(v))
        });
        self.upper_halves(to_even(v.bitcast()))
    }
    /// The lanes of `a` and then those of `b`. `OrderedDemote2To`.
    #[op]
    pub(crate) fn ordered_demote2_to_bf16(self, a: V<S, f32, W>, b: V<S, f32, W>) -> V<S, u16, W> {
        halves_if!(S::HAS_BF16 && W::BYTES > S::REGISTER, |this: Self = self, a: V<S, f32, W> = a, b: V<S, f32, W> = b| {
            let d = this.half();
            this.combine(d.ordered_demote2_to_bf16(b.lower_half(), b.upper_half()), d.ordered_demote2_to_bf16(a.lower_half(), a.upper_half()))
        });
        if const { S::HAS_BF16 && W::BYTES >= 16 } && !(crate::X86 && a.s.any_subnormal_f32::<W>(a.bytes(), b.bytes()))
        {
            return a.with_bytes(a.s.narrow_bf16::<W>(a.bytes(), b.bytes()));
        }
        self.concat_odd(round_to_bf16(b).bitcast(), round_to_bf16(a).bitcast())
    }
    /// The lanes of `even` and `odd` in turns: the reverse of `promote_even_bf16_to` and `promote_odd_bf16_to`.
    /// `ReorderDemote2To`.
    #[op]
    pub(crate) fn interleave_demote2_to_bf16(self, even: V<S, f32, W>, odd: V<S, f32, W>) -> V<S, u16, W> {
        if const { S::HAS_BF16 && W::BYTES >= 16 && (W::BYTES <= 64 || !crate::X86) }
            && !(crate::X86 && even.s.any_subnormal_f32::<W>(even.bytes(), odd.bytes()))
        {
            return live!(S::HAS_BF16 && W::BYTES >= 16 && (W::BYTES <= 64 || !crate::X86), {
                let both = even.with_bytes::<u16>(even.s.narrow_bf16::<W>(even.bytes(), odd.bytes()));
                if crate::X86 {
                    both.of_one(always!(|i: usize| i / 2 + i % 2 * Self::LANES / 2))
                } else {
                    both.interleave_lower(both.bitcast::<u64>().swap_pairs().bitcast())
                }
            });
        }
        round_to_bf16(even).bitcast().interleave_odd(round_to_bf16(odd).bitcast())
    }
}
