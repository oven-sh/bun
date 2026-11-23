//! Floating-point numbers of up to 8 bits.

use crate::f16;
use crate::{Float, Isa, Lane, MaskOf, Scaled, Simd, Unsigned, Width, bf16};

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
enum Special {
    /// The highest exponent is for infinity and NaN.
    Ieee,
    /// All bits but the sign are set in a NaN.
    Highest,
    /// What would be -0 is NaN.
    NegativeZero,
    None,
}

/// A format of floating-point numbers with up to 8 bits, for [`to_minifloat`](Simd::to_minifloat) and [`from_minifloat`](Simd::from_minifloat).
/// A number is in the lowest bits of a byte. The names are those of MLIR and PyTorch: `E4M3` has 4 bits for the exponent and 3 below it.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let v = f32x4::from([1.0, -0.3, 1000.0, f32::NAN]);
/// assert_eq!(v.to_minifloat(Minifloat::E4M3FN), [0x38, 0xaa, 0x7f, 0x7f]);
/// let codes = v.to_minifloat(Minifloat::E4M3FN.saturating());
/// assert_eq!(codes, [0x38, 0xaa, 0x7e, 0x7f]);
/// assert_eq!(codes.from_minifloat::<f32>(Minifloat::E4M3FN).to_array()[..3], [1.0, -0.3125, 448.0]);
/// # } example()
/// ```
#[doc(alias(
    "fp8", "f8", "float8", "e4m3", "e5m2", "bf8", "hf8", "fp6", "fp4", "mxfp4", "mxfp8", "nvfp4", "microscaling"
))]
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub struct Minifloat {
    exponent: u8,
    fraction: u8,
    bias: u8,
    special: Special,
    saturates: bool,
    /// The lower and upper bytes of the first codes as `bf16`.
    first: [[u8; 32]; 2],
}

impl Minifloat {
    /// E4M3 of the Open Compute Project, up to 448. It has no infinity, and NaN is `0x7f` or `0xff`.
    pub const E4M3FN: Self = Self::new(4, 3, 7, Special::Highest);
    /// The upper half of an `f16`, up to 57344.
    pub const E5M2: Self = Self::ieee::<5, 2>();
    /// Up to 240. It has no infinity and no -0, and NaN is `0x80`.
    pub const E4M3FNUZ: Self = Self::new(4, 3, 8, Special::NegativeZero);
    /// The same, up to 57344.
    pub const E5M2FNUZ: Self = Self::new(5, 2, 16, Special::NegativeZero);
    /// 6 bits, up to 28. It has neither infinity nor NaN, so it always saturates, and NaN becomes 0.
    pub const E3M2FN: Self = Self::new(3, 2, 3, Special::None);
    /// The same, up to 7.5.
    pub const E2M3FN: Self = Self::new(2, 3, 1, Special::None);
    /// The same with 4 bits: 0, 0.5, 1, 1.5, 2, 3, 4 and 6.
    pub const E2M1FN: Self = Self::new(2, 1, 1, Special::None);

    /// By the rules of `f32`, with so many bits. It doesn't build unless the exponent has 2 or more, the fraction 1 or more, and both together 7 or less.
    #[inline(always)]
    pub const fn ieee<const EXPONENT: u8, const FRACTION: u8>() -> Self {
        const {
            assert!(
                EXPONENT >= 2 && FRACTION >= 1 && EXPONENT <= 6 && FRACTION <= 7 - EXPONENT,
                "the exponent has 2 bits or more, the fraction 1 or more, and both together 7 or less"
            );
            Self::new(EXPONENT, FRACTION, (1 << (EXPONENT - 1)) - 1, Special::Ieee)
        }
    }
    const fn new(exponent: u8, fraction: u8, bias: u8, special: Special) -> Self {
        let saturates = matches!(special, Special::None);
        let (mut format, mut code) = (Self { exponent, fraction, bias, special, saturates, first: [[0; 32]; 2] }, 0);
        while code < 32 {
            let magnitude = code & (format.sign() - 1);
            let (high, low) = (magnitude >> fraction, magnitude & !(!0 << fraction));
            let step = f32::from_bits((127 + high as u32 + (high == 0) as u32 - bias as u32 - fraction as u32) << 23);
            let value = (low | ((high != 0) as u8) << fraction) as f32 * step;
            let bits = value.to_bits() | ((magnitude >= format.beyond()) as u32 * 0x7f80_0000);
            format.first[0][code as usize] = (bits >> 16) as u8;
            format.first[1][code as usize] = (bits >> 24) as u8 | ((code & format.sign() != 0) as u8) << 7;
            code += 1;
        }
        format
    }
    /// The same format, but what is too large, also infinity, becomes the largest finite number of its sign. Otherwise it becomes infinity, or NaN if there is none.
    #[doc(alias("satfinite"))]
    pub const fn saturating(self) -> Self {
        Self { saturates: true, ..self }
    }
    #[inline(always)]
    const fn sign(self) -> u8 {
        1 << (self.exponent + self.fraction)
    }
    /// The code after that of the largest finite number.
    #[inline(always)]
    const fn beyond(self) -> u8 {
        match self.special {
            Special::Ieee => self.sign() - (1 << self.fraction),
            Special::Highest => self.sign() - 1,
            _ => self.sign(),
        }
    }
}

impl<S: Isa, T: Float, W: Width> Simd<T, W, S> {
    /// To the nearest number of `format`, and the even one of two. NaN has the sign of `self` if it can, and all other bits set.
    #[doc(alias("to_fp8", "to_f8", "quantize", "vcvtph2hf8", "vcvtph2bf8"))]
    #[op]
    #[track_caller]
    pub fn to_minifloat(self, format: Minifloat) -> Simd<u8, Scaled<T, u8, W>, S> {
        require!(
            "there is no vector with as many lanes of that type, since the widths are 2 to 512 bytes: see `widen` and `split`",
            Self::LANES >= 2
        );
        self.encoded(format)
    }
    #[inline(always)]
    fn encoded(self, format: Minifloat) -> Simd<u8, Scaled<T, u8, W>, S> {
        apart_unoptimized!(self.s, {
            halves_if!(Self::HALF && W::BYTES == 512, |this: Self = self, format: Minifloat = format| {
                let [lower, upper] = this.split();
                lower.encoded(format).concat(upper.encoded(format)).same()
            });
            let upper = T::FRACTION == 10 && format.bias == 15;
            if const { Self::HALF }
                && !upper
                && (Self::SOFT
                    || format.exponent > 4
                    || format.beyond() >> format.fraction > format.bias + format.fraction + 5)
            {
                return live!(Self::HALF, {
                    let mut single = self.cast::<f32>();
                    // There, NaN loses its sign.
                    if const { cfg!(miri) || cfg!(target_feature = "zvfhmin") && T::FRACTION == 10 } {
                        single = (single.abs().to_bits() | self.to_bits().cast::<u32>() >> 15 << 31).bitcast();
                    }
                    single.encoded(format).same()
                });
            }
            let number = always!(|n: u64| T::Unsigned::from_u64(n));
            let (fraction, bias) =
                (format.fraction as u32, (1 << (T::BITS - T::FRACTION - 2)) - 1 - format.bias as u64);
            let (dropped, infinity) = (T::FRACTION - fraction, !0 >> (65 - T::BITS) >> T::FRACTION << T::FRACTION);
            let (bits, magnitude) = (self.to_bits(), self.abs().to_bits().cast_signed());
            let limit = (((format.beyond() - format.saturates as u8) as u64) << dropped) + (bias << T::FRACTION);
            let clamped = magnitude.simd_min(T::Signed::from_u64(limit));
            let code = if upper {
                (clamped.cast_unsigned() + number((1 << (dropped - 1)) - 1) + (bits >> dropped & number(1))) >> dropped
            } else {
                let power =
                    clamped.simd_max(T::Signed::from_u64((bias + 1) << T::FRACTION)).cast_unsigned() & number(infinity);
                // In a sum with a larger power of two, the lowest bits are the rounded ones. Its own lowest byte, which is even, takes the bias away.
                let unbias = ((bias + 1) << fraction).wrapping_neg() & 255;
                let large = power + number(((dropped as u64) << T::FRACTION) + unbias);
                (clamped.bitcast::<T>() + large.bitcast::<T>()).to_bits() + (power >> dropped)
            };
            let (above, nan) =
                ((7 - format.exponent - format.fraction) as u32, magnitude.simd_gt(T::Signed::from_u64(infinity)));
            // There, masks cost nothing to narrow, and vectors do.
            return_if!(S::AVX512F, format.finish(code, bits >> (T::BITS - 8 + above), nan).cast::<u8>().same());
            let top = choose! {
                crate::X86 => bits.cast_signed().saturating_cast::<i8>().cast_unsigned().same(),
                _ => (bits >> (T::BITS - 8)).cast::<u8>(),
            };
            format.finish(code.cast::<u8>(), top >> above, nan.rebind::<i8>()).same()
        })
    }
}

impl Minifloat {
    /// Only the lowest byte of each lane counts.
    #[op]
    fn finish<T: Unsigned, W: Width, S: Isa>(
        self,
        code: Simd<T, W, S>,
        top: Simd<T, W, S>,
        nan: MaskOf<T, W, S>,
    ) -> Simd<T, W, S> {
        let sign = T::from(self.sign());
        match self.special {
            Special::Highest if !self.saturates => code | top & sign,
            Special::Ieee | Special::Highest => nan.select(sign - T::ONE, code) | top & sign,
            Special::NegativeZero => {
                let code = if self.saturates { nan.select(sign, code) } else { code };
                code.any_bits(T::from(255)).select(code | top & sign, code)
            }
            Special::None => nan.select(T::ZERO, code | top & sign),
        }
    }
}

impl<S: Isa, W: Width> Simd<u8, W, S> {
    /// The value of each code of `format`. It is exact, but for exponents of 6 bits in `f16`. The bits above those of the format don't count.
    #[doc(alias("from_fp8", "from_f8", "dequantize", "vcvthf82ph"))]
    #[op]
    #[track_caller]
    pub fn from_minifloat<U: Float>(self, format: Minifloat) -> Simd<U, Scaled<u8, U, W>, S> {
        require!(
            "there is no vector with as many lanes of that type, since the widths are 2 to 512 bytes: see `widen` and `split`",
            W::BYTES * size_of::<U>() <= 512
        );
        self.decoded(format)
    }
    #[inline(always)]
    fn decoded<U: Float>(self, format: Minifloat) -> Simd<U, Scaled<u8, U, W>, S> {
        apart!(self.s, {
            halves_if!(W::BYTES == 256, |this: Self = self, format: Minifloat = format| {
                let [lower, upper] = this.split();
                lower.decoded::<U>(format).concat(upper.decoded::<U>(format)).same()
            });
            let (exponent, fraction, sign) = (format.exponent as u32, format.fraction as u32, format.sign());
            let magnitude = self & (sign - 1);
            let special = match format.special {
                Special::NegativeZero => self.simd_eq(sign),
                _ => magnitude.cast_signed().simd_gt((format.beyond() - 1) as i8),
            };
            let quiet = matches!(format.special, Special::NegativeZero) as u8;
            // The conversion of `f16` takes subnormal numbers at full speed.
            let (converts, native) =
                (U::FRACTION != 7 && (S::F16C || S::A64), U::FRACTION == 10 && !Simd::<U, W, S>::SOFT);
            let upper = format.bias == 15 && (converts || U::FRACTION == 10);
            if upper || exponent < 5 && (native || converts && sign > 8) {
                let half = match sign {
                    128 => self.cast_signed().cast::<i16>().same() << (10 - fraction),
                    _ => (self.cast::<i16>() << (15 - exponent - fraction)) >> (5 - exponent),
                };
                let mut half = half & (i16::MIN | (sign as i16 - 1) << (10 - fraction));
                if upper {
                    return half.bitcast::<f16>().cast::<U>().same();
                }
                if format.special != Special::None {
                    half |= special.rebind::<i16>().select(0x7c00 | (quiet as i16) << 9, 0);
                }
                let (half, more) = (half.bitcast::<f16>(), 15 - format.bias);
                return_if!(
                    U::FRACTION == 10 && !Simd::<U, W, S>::SOFT,
                    (half * f16::from_bits((15 + more as u16) << 10)).bitcast::<U>().same()
                );
                return (half.cast::<f32>() * f32::from_bits((127 + more as u32) << 23)).cast::<U>().same();
            }
            if const { S::AVX512F && U::BITS == 32 } && sign == 8 {
                return live!(S::AVX512F && U::BITS == 32, {
                    let d = self.s.fixed::<u8, crate::B16>();
                    let [lower, upper] = d.load(&format.first[0]).interleave(d.load(&format.first[1]));
                    let all = lower.concat(upper).bitcast::<bf16>().cast::<f32>().same::<f32, crate::B64>().to_array();
                    self.lookup(&all).bitcast::<U>().same()
                });
            }
            // The two bytes of a `bf16`, which has all values.
            let table = always!(|at: Self, byte: usize| match fraction {
                5 => at.lookup_relaxed(&format.first[byte]),
                _ => at.lookup_relaxed(format.first[byte].first_chunk::<16>().unwrap()),
            });
            let [low, high] = if sign == 8 {
                [table(self & 15, 0), table(self & 15, 1)]
            } else {
                let more = 127 - format.bias;
                let (bits, small) =
                    (magnitude + ((more & 1) << fraction), magnitude.cast_signed().simd_lt(1 << fraction));
                let mut low = small.select(table(magnitude, 0), bits << (7 - fraction));
                let mut high = small.select(table(magnitude, 1), (bits >> (fraction + 1)) + (more >> 1));
                if format.special != Special::None {
                    low |= special.select(0x80 | quiet << 6, 0);
                    high |= special.select(0x7f, 0);
                }
                [low, high | self << (7 - exponent - fraction) & 0x80]
            };
            let [lower, upper] = low.interleave(high);
            lower.concat(upper).bitcast::<bf16>().cast::<U>().same()
        })
    }
}
