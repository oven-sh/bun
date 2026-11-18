//! What the operations give. Where any NaN is allowed it is the positive canonical one.

use core::ops::{Add, Div, Mul, Sub};

use super::lanes::Half::{High, Low};
use super::lanes::{
    Half, Lane, build, compare, map, narrow, pairwise, shuffle, splat, widen, zip, zip3,
};
use super::{Relaxed, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary};
use crate::operand::Size;

const SIGNS32: u128 = splat(Size::S32, 1 << 31);
const SIGNS64: u128 = splat(Size::S64, 1 << 63);

trait Float: Lane + PartialOrd + Add<Output = Self> + Mul<Output = Self> {
    fn fused_mul_add(self, factor: Self, addend: Self) -> Self;
}

impl Float for f32 {
    fn fused_mul_add(self, factor: Self, addend: Self) -> Self {
        self.mul_add(factor, addend)
    }
}

impl Float for f64 {
    fn fused_mul_add(self, factor: Self, addend: Self) -> Self {
        self.mul_add(factor, addend)
    }
}

fn bitselect(a: u128, b: u128, mask: u128) -> u128 {
    a & mask | b & !mask
}

fn is_negative<T: Lane + PartialOrd>(a: u128) -> u128 {
    compare(a, 0, T::lt)
}

/// `if_equal` settles between zeros of different signs.
fn min_or_max<F: Float>(a: u128, b: u128, first: fn(&F, &F) -> bool, if_equal: u128) -> u128 {
    let different = zip(a, b, |x: F, y| match (first(&x, &y), first(&y, &x)) {
        (true, _) => x,
        (_, true) => y,
        _ => x + y,
    });
    bitselect(if_equal, different, compare(a, b, F::eq))
}

fn min<F: Float>(a: u128, b: u128) -> u128 {
    min_or_max(a, b, F::lt, a | b)
}

fn max<F: Float>(a: u128, b: u128) -> u128 {
    min_or_max(a, b, F::gt, a & b)
}

fn pmin<F: Float>(a: u128, b: u128) -> u128 {
    bitselect(b, a, compare(b, a, F::lt))
}

fn pmax<F: Float>(a: u128, b: u128) -> u128 {
    bitselect(b, a, compare(a, b, F::lt))
}

fn mul_add<F: Float>(relaxed: Relaxed, a: u128, b: u128, c: u128) -> u128 {
    if relaxed.contains(Relaxed::FUSED_MADD) {
        zip3(a, b, c, F::fused_mul_add)
    } else {
        zip3(a, b, c, |x: F, y, z| x * y + z)
    }
}

fn add_pairs<T: Lane, U: Lane + From<T> + Add<Output = U>>(a: u128) -> u128 {
    pairwise(|i| U::from(T::get(a, i)), U::add)
}

fn extended_mul<T: Lane, U: Lane + From<T> + Mul<Output = U>>(
    a: u128,
    b: u128,
    half: Half,
) -> u128 {
    zip(widen::<T, U>(a, half), widen::<T, U>(b, half), U::mul)
}

fn q15_mul(x: i16, y: i16) -> i32 {
    (i32::from(x) * i32::from(y) + 0x4000) >> 15
}

fn byte_product(relaxed: Relaxed, a: u128, b: u128, index: usize) -> i16 {
    i16::from(i8::get(a, index))
        * if relaxed.contains(Relaxed::UNSIGNED_DOT) {
            i16::from(u8::get(b, index))
        } else {
            i16::from(i8::get(b, index))
        }
}

fn dot_of_bytes(relaxed: Relaxed, a: u128, b: u128) -> u128 {
    let product = |index| byte_product(relaxed, a, b, index);
    if relaxed.contains(Relaxed::UNSIGNED_DOT) {
        pairwise(product, i16::saturating_add)
    } else {
        pairwise(product, i16::wrapping_add)
    }
}

fn truncate_or_least(value: f64) -> i32 {
    if value < 2_147_483_648.0 {
        value as i32
    } else {
        i32::MIN
    }
}

/// From 2^31 up to 2^32 the fraction holds the integer.
fn unsaturated_f32_to_u32(bits: u32) -> i32 {
    truncate_or_least(f32::from_bits(bits).into()).max((bits << 8) as i32 | i32::MIN)
}

/// Added to 2^52, the integer is in the low bits of the fraction.
fn unsaturated_f64_to_u32(bits: u64) -> u32 {
    let value = f64::from_bits(bits);
    if value.is_nan() {
        bits as u32
    } else {
        (value.trunc() + 4_503_599_627_370_496.0).to_bits() as u32
    }
}

impl VectorUnary {
    /// In the deterministic profile.
    #[inline]
    pub fn evaluate(self, a: u128) -> u128 {
        self.evaluate_with(Relaxed::empty(), a)
    }

    pub fn evaluate_with(self, relaxed: Relaxed, a: u128) -> u128 {
        let saturates = !relaxed.contains(Relaxed::UNSATURATED_TRUNC);
        match self {
            Self::Not => !a,
            Self::I8x16Abs => map(a, i8::wrapping_abs),
            Self::I8x16Neg => map(a, i8::wrapping_neg),
            Self::I8x16Popcnt => map(a, |x: u8| x.count_ones() as u8),
            Self::I16x8Abs => map(a, i16::wrapping_abs),
            Self::I16x8Neg => map(a, i16::wrapping_neg),
            Self::I32x4Abs => map(a, i32::wrapping_abs),
            Self::I32x4Neg => map(a, i32::wrapping_neg),
            Self::I64x2Abs => map(a, i64::wrapping_abs),
            Self::I64x2Neg => map(a, i64::wrapping_neg),
            Self::F32x4Abs => a & !SIGNS32,
            Self::F32x4Neg => a ^ SIGNS32,
            Self::F32x4Sqrt => map(a, f32::sqrt),
            Self::F32x4Ceil => map(a, f32::ceil),
            Self::F32x4Floor => map(a, f32::floor),
            Self::F32x4Trunc => map(a, f32::trunc),
            Self::F32x4Nearest => map(a, f32::round_ties_even),
            Self::F64x2Abs => a & !SIGNS64,
            Self::F64x2Neg => a ^ SIGNS64,
            Self::F64x2Sqrt => map(a, f64::sqrt),
            Self::F64x2Ceil => map(a, f64::ceil),
            Self::F64x2Floor => map(a, f64::floor),
            Self::F64x2Trunc => map(a, f64::trunc),
            Self::F64x2Nearest => map(a, f64::round_ties_even),
            Self::I16x8ExtendLowI8x16S => widen::<i8, i16>(a, Low),
            Self::I16x8ExtendHighI8x16S => widen::<i8, i16>(a, High),
            Self::I16x8ExtendLowI8x16U => widen::<u8, u16>(a, Low),
            Self::I16x8ExtendHighI8x16U => widen::<u8, u16>(a, High),
            Self::I32x4ExtendLowI16x8S => widen::<i16, i32>(a, Low),
            Self::I32x4ExtendHighI16x8S => widen::<i16, i32>(a, High),
            Self::I32x4ExtendLowI16x8U => widen::<u16, u32>(a, Low),
            Self::I32x4ExtendHighI16x8U => widen::<u16, u32>(a, High),
            Self::I64x2ExtendLowI32x4S => widen::<i32, i64>(a, Low),
            Self::I64x2ExtendHighI32x4S => widen::<i32, i64>(a, High),
            Self::I64x2ExtendLowI32x4U => widen::<u32, u64>(a, Low),
            Self::I64x2ExtendHighI32x4U => widen::<u32, u64>(a, High),
            Self::I16x8ExtAddPairwiseI8x16S => add_pairs::<i8, i16>(a),
            Self::I16x8ExtAddPairwiseI8x16U => add_pairs::<u8, u16>(a),
            Self::I32x4ExtAddPairwiseI16x8S => add_pairs::<i16, i32>(a),
            Self::I32x4ExtAddPairwiseI16x8U => add_pairs::<u16, u32>(a),
            Self::I32x4RelaxedTruncF32x4S if !saturates => {
                map(a, |x: f32| truncate_or_least(x.into()))
            }
            Self::I32x4RelaxedTruncF32x4U if !saturates => map(a, unsaturated_f32_to_u32),
            Self::I32x4RelaxedTruncF64x2SZero if !saturates => map(a, truncate_or_least),
            Self::I32x4RelaxedTruncF64x2UZero if !saturates => map(a, unsaturated_f64_to_u32),
            Self::I32x4TruncSatF32x4S | Self::I32x4RelaxedTruncF32x4S => map(a, |x: f32| x as i32),
            Self::I32x4TruncSatF32x4U | Self::I32x4RelaxedTruncF32x4U => map(a, |x: f32| x as u32),
            Self::I32x4TruncSatF64x2SZero | Self::I32x4RelaxedTruncF64x2SZero => {
                map(a, |x: f64| x as i32)
            }
            Self::I32x4TruncSatF64x2UZero | Self::I32x4RelaxedTruncF64x2UZero => {
                map(a, |x: f64| x as u32)
            }
            Self::F32x4ConvertI32x4S => map(a, |x: i32| x as f32),
            Self::F32x4ConvertI32x4U => map(a, |x: u32| x as f32),
            Self::F64x2ConvertLowI32x4S => widen::<i32, f64>(a, Low),
            Self::F64x2ConvertLowI32x4U => widen::<u32, f64>(a, Low),
            Self::F32x4DemoteF64x2Zero => map(a, |x: f64| x as f32),
            Self::F64x2PromoteLowF32x4 => widen::<f32, f64>(a, Low),
        }
    }
}

impl VectorBinary {
    /// In the deterministic profile.
    #[inline]
    pub fn evaluate(self, a: u128, b: u128) -> u128 {
        self.evaluate_with(Relaxed::empty(), a, b)
    }

    pub fn evaluate_with(self, relaxed: Relaxed, a: u128, b: u128) -> u128 {
        let second_wins = relaxed.contains(Relaxed::SECOND_OPERAND_MIN_MAX);
        match self {
            Self::And => a & b,
            Self::AndNot => a & !b,
            Self::Or => a | b,
            Self::Xor => a ^ b,
            Self::I8x16RelaxedSwizzle if relaxed.contains(Relaxed::WRAPPING_SWIZZLE) => {
                shuffle(a, 0, (b & splat(Size::S8, 0x8f)).to_le_bytes())
            }
            Self::I8x16Swizzle | Self::I8x16RelaxedSwizzle => shuffle(a, 0, b.to_le_bytes()),
            Self::I8x16Eq => compare(a, b, u8::eq),
            Self::I8x16Ne => compare(a, b, u8::ne),
            Self::I8x16LtS => compare(a, b, i8::lt),
            Self::I8x16LtU => compare(a, b, u8::lt),
            Self::I8x16GtS => compare(a, b, i8::gt),
            Self::I8x16GtU => compare(a, b, u8::gt),
            Self::I8x16LeS => compare(a, b, i8::le),
            Self::I8x16LeU => compare(a, b, u8::le),
            Self::I8x16GeS => compare(a, b, i8::ge),
            Self::I8x16GeU => compare(a, b, u8::ge),
            Self::I16x8Eq => compare(a, b, u16::eq),
            Self::I16x8Ne => compare(a, b, u16::ne),
            Self::I16x8LtS => compare(a, b, i16::lt),
            Self::I16x8LtU => compare(a, b, u16::lt),
            Self::I16x8GtS => compare(a, b, i16::gt),
            Self::I16x8GtU => compare(a, b, u16::gt),
            Self::I16x8LeS => compare(a, b, i16::le),
            Self::I16x8LeU => compare(a, b, u16::le),
            Self::I16x8GeS => compare(a, b, i16::ge),
            Self::I16x8GeU => compare(a, b, u16::ge),
            Self::I32x4Eq => compare(a, b, u32::eq),
            Self::I32x4Ne => compare(a, b, u32::ne),
            Self::I32x4LtS => compare(a, b, i32::lt),
            Self::I32x4LtU => compare(a, b, u32::lt),
            Self::I32x4GtS => compare(a, b, i32::gt),
            Self::I32x4GtU => compare(a, b, u32::gt),
            Self::I32x4LeS => compare(a, b, i32::le),
            Self::I32x4LeU => compare(a, b, u32::le),
            Self::I32x4GeS => compare(a, b, i32::ge),
            Self::I32x4GeU => compare(a, b, u32::ge),
            Self::I64x2Eq => compare(a, b, u64::eq),
            Self::I64x2Ne => compare(a, b, u64::ne),
            Self::I64x2LtS => compare(a, b, i64::lt),
            Self::I64x2GtS => compare(a, b, i64::gt),
            Self::I64x2LeS => compare(a, b, i64::le),
            Self::I64x2GeS => compare(a, b, i64::ge),
            Self::F32x4Eq => compare(a, b, f32::eq),
            Self::F32x4Ne => compare(a, b, f32::ne),
            Self::F32x4Lt => compare(a, b, f32::lt),
            Self::F32x4Gt => compare(a, b, f32::gt),
            Self::F32x4Le => compare(a, b, f32::le),
            Self::F32x4Ge => compare(a, b, f32::ge),
            Self::F64x2Eq => compare(a, b, f64::eq),
            Self::F64x2Ne => compare(a, b, f64::ne),
            Self::F64x2Lt => compare(a, b, f64::lt),
            Self::F64x2Gt => compare(a, b, f64::gt),
            Self::F64x2Le => compare(a, b, f64::le),
            Self::F64x2Ge => compare(a, b, f64::ge),
            Self::I8x16NarrowI16x8S => narrow(a, b, |x: i16| x.clamp(-0x80, 0x7f) as i8),
            Self::I8x16NarrowI16x8U => narrow(a, b, |x: i16| x.clamp(0, 0xff) as u8),
            Self::I8x16Add => zip(a, b, u8::wrapping_add),
            Self::I8x16AddSatS => zip(a, b, i8::saturating_add),
            Self::I8x16AddSatU => zip(a, b, u8::saturating_add),
            Self::I8x16Sub => zip(a, b, u8::wrapping_sub),
            Self::I8x16SubSatS => zip(a, b, i8::saturating_sub),
            Self::I8x16SubSatU => zip(a, b, u8::saturating_sub),
            Self::I8x16MinS => zip(a, b, i8::min),
            Self::I8x16MinU => zip(a, b, u8::min),
            Self::I8x16MaxS => zip(a, b, i8::max),
            Self::I8x16MaxU => zip(a, b, u8::max),
            Self::I8x16AvgrU => zip(a, b, |x: u8, y| (x | y) - ((x ^ y) >> 1)),
            Self::I16x8NarrowI32x4S => narrow(a, b, |x: i32| x.clamp(-0x8000, 0x7fff) as i16),
            Self::I16x8NarrowI32x4U => narrow(a, b, |x: i32| x.clamp(0, 0xffff) as u16),
            Self::I16x8Add => zip(a, b, u16::wrapping_add),
            Self::I16x8AddSatS => zip(a, b, i16::saturating_add),
            Self::I16x8AddSatU => zip(a, b, u16::saturating_add),
            Self::I16x8Sub => zip(a, b, u16::wrapping_sub),
            Self::I16x8SubSatS => zip(a, b, i16::saturating_sub),
            Self::I16x8SubSatU => zip(a, b, u16::saturating_sub),
            Self::I16x8Mul => zip(a, b, u16::wrapping_mul),
            Self::I16x8MinS => zip(a, b, i16::min),
            Self::I16x8MinU => zip(a, b, u16::min),
            Self::I16x8MaxS => zip(a, b, i16::max),
            Self::I16x8MaxU => zip(a, b, u16::max),
            Self::I16x8AvgrU => zip(a, b, |x: u16, y| (x | y) - ((x ^ y) >> 1)),
            Self::I16x8RelaxedQ15MulrS if relaxed.contains(Relaxed::WRAPPING_Q15) => {
                zip(a, b, |x, y| q15_mul(x, y) as i16)
            }
            Self::I16x8Q15MulrSatS | Self::I16x8RelaxedQ15MulrS => {
                zip(a, b, |x, y| q15_mul(x, y).min(0x7fff) as i16)
            }
            Self::I16x8ExtMulLowI8x16S => extended_mul::<i8, i16>(a, b, Low),
            Self::I16x8ExtMulHighI8x16S => extended_mul::<i8, i16>(a, b, High),
            Self::I16x8ExtMulLowI8x16U => extended_mul::<u8, u16>(a, b, Low),
            Self::I16x8ExtMulHighI8x16U => extended_mul::<u8, u16>(a, b, High),
            Self::I32x4Add => zip(a, b, u32::wrapping_add),
            Self::I32x4Sub => zip(a, b, u32::wrapping_sub),
            Self::I32x4Mul => zip(a, b, u32::wrapping_mul),
            Self::I32x4MinS => zip(a, b, i32::min),
            Self::I32x4MinU => zip(a, b, u32::min),
            Self::I32x4MaxS => zip(a, b, i32::max),
            Self::I32x4MaxU => zip(a, b, u32::max),
            Self::I32x4DotI16x8S => pairwise(
                |i| i32::from(i16::get(a, i)) * i32::from(i16::get(b, i)),
                i32::wrapping_add,
            ),
            Self::I32x4ExtMulLowI16x8S => extended_mul::<i16, i32>(a, b, Low),
            Self::I32x4ExtMulHighI16x8S => extended_mul::<i16, i32>(a, b, High),
            Self::I32x4ExtMulLowI16x8U => extended_mul::<u16, u32>(a, b, Low),
            Self::I32x4ExtMulHighI16x8U => extended_mul::<u16, u32>(a, b, High),
            Self::I64x2Add => zip(a, b, u64::wrapping_add),
            Self::I64x2Sub => zip(a, b, u64::wrapping_sub),
            Self::I64x2Mul => zip(a, b, u64::wrapping_mul),
            Self::I64x2ExtMulLowI32x4S => extended_mul::<i32, i64>(a, b, Low),
            Self::I64x2ExtMulHighI32x4S => extended_mul::<i32, i64>(a, b, High),
            Self::I64x2ExtMulLowI32x4U => extended_mul::<u32, u64>(a, b, Low),
            Self::I64x2ExtMulHighI32x4U => extended_mul::<u32, u64>(a, b, High),
            Self::F32x4Add => zip(a, b, f32::add),
            Self::F32x4Sub => zip(a, b, f32::sub),
            Self::F32x4Mul => zip(a, b, f32::mul),
            Self::F32x4Div => zip(a, b, f32::div),
            Self::F32x4RelaxedMin if second_wins => pmin::<f32>(b, a),
            Self::F32x4RelaxedMax if second_wins => pmax::<f32>(b, a),
            Self::F32x4Min | Self::F32x4RelaxedMin => min::<f32>(a, b),
            Self::F32x4Max | Self::F32x4RelaxedMax => max::<f32>(a, b),
            Self::F32x4Pmin => pmin::<f32>(a, b),
            Self::F32x4Pmax => pmax::<f32>(a, b),
            Self::F64x2Add => zip(a, b, f64::add),
            Self::F64x2Sub => zip(a, b, f64::sub),
            Self::F64x2Mul => zip(a, b, f64::mul),
            Self::F64x2Div => zip(a, b, f64::div),
            Self::F64x2RelaxedMin if second_wins => pmin::<f64>(b, a),
            Self::F64x2RelaxedMax if second_wins => pmax::<f64>(b, a),
            Self::F64x2Min | Self::F64x2RelaxedMin => min::<f64>(a, b),
            Self::F64x2Max | Self::F64x2RelaxedMax => max::<f64>(a, b),
            Self::F64x2Pmin => pmin::<f64>(a, b),
            Self::F64x2Pmax => pmax::<f64>(a, b),
            Self::I16x8RelaxedDotI8x16I7x16S => dot_of_bytes(relaxed, a, b),
        }
    }
}

impl VectorTernary {
    /// In the deterministic profile.
    #[inline]
    pub fn evaluate(self, a: u128, b: u128, c: u128) -> u128 {
        self.evaluate_with(Relaxed::empty(), a, b, c)
    }

    pub fn evaluate_with(self, relaxed: Relaxed, a: u128, b: u128, c: u128) -> u128 {
        let by_top_bit = relaxed.contains(Relaxed::TOP_BIT_LANESELECT);
        match self {
            Self::F32x4RelaxedMadd => mul_add::<f32>(relaxed, a, b, c),
            Self::F32x4RelaxedNmadd => mul_add::<f32>(relaxed, a ^ SIGNS32, b, c),
            Self::F64x2RelaxedMadd => mul_add::<f64>(relaxed, a, b, c),
            Self::F64x2RelaxedNmadd => mul_add::<f64>(relaxed, a ^ SIGNS64, b, c),
            Self::I8x16RelaxedLaneselect if by_top_bit => bitselect(a, b, is_negative::<i8>(c)),
            Self::I16x8RelaxedLaneselect if by_top_bit => bitselect(a, b, is_negative::<i16>(c)),
            Self::I32x4RelaxedLaneselect if by_top_bit => bitselect(a, b, is_negative::<i32>(c)),
            Self::I64x2RelaxedLaneselect if by_top_bit => bitselect(a, b, is_negative::<i64>(c)),
            Self::Bitselect
            | Self::I8x16RelaxedLaneselect
            | Self::I16x8RelaxedLaneselect
            | Self::I32x4RelaxedLaneselect
            | Self::I64x2RelaxedLaneselect => bitselect(a, b, c),
            Self::I32x4RelaxedDotI8x16I7x16AddS => {
                let dot = if relaxed.contains(Relaxed::WIDE_DOT_ADD) {
                    let product = |index| i32::from(byte_product(relaxed, a, b, index));
                    build(|i| (4 * i..4 * i + 4).map(product).sum::<i32>())
                } else {
                    add_pairs::<i16, i32>(dot_of_bytes(relaxed, a, b))
                };
                zip(dot, c, i32::wrapping_add)
            }
        }
    }
}

impl VectorShift {
    /// `amount` counts modulo the size of a lane.
    pub fn evaluate(self, a: u128, amount: u32) -> u128 {
        match self {
            Self::I8x16Shl => map(a, |x: u8| x.wrapping_shl(amount)),
            Self::I8x16ShrS => map(a, |x: i8| x.wrapping_shr(amount)),
            Self::I8x16ShrU => map(a, |x: u8| x.wrapping_shr(amount)),
            Self::I16x8Shl => map(a, |x: u16| x.wrapping_shl(amount)),
            Self::I16x8ShrS => map(a, |x: i16| x.wrapping_shr(amount)),
            Self::I16x8ShrU => map(a, |x: u16| x.wrapping_shr(amount)),
            Self::I32x4Shl => map(a, |x: u32| x.wrapping_shl(amount)),
            Self::I32x4ShrS => map(a, |x: i32| x.wrapping_shr(amount)),
            Self::I32x4ShrU => map(a, |x: u32| x.wrapping_shr(amount)),
            Self::I64x2Shl => map(a, |x: u64| x.wrapping_shl(amount)),
            Self::I64x2ShrS => map(a, |x: i64| x.wrapping_shr(amount)),
            Self::I64x2ShrU => map(a, |x: u64| x.wrapping_shr(amount)),
        }
    }
}

fn all_true<T: Lane + PartialEq>(a: u128) -> u32 {
    (compare(a, 0, T::eq) == 0).into()
}

fn bitmask<T: Lane + PartialOrd>(a: u128) -> u32 {
    let zero = T::get(0, 0);
    (0..T::COUNT).fold(0, |mask, i| mask | u32::from(T::get(a, i) < zero) << i)
}

impl VectorReduce {
    pub fn evaluate(self, a: u128) -> u32 {
        match self {
            Self::AnyTrue => (a != 0).into(),
            Self::I8x16AllTrue => all_true::<u8>(a),
            Self::I16x8AllTrue => all_true::<u16>(a),
            Self::I32x4AllTrue => all_true::<u32>(a),
            Self::I64x2AllTrue => all_true::<u64>(a),
            Self::I8x16Bitmask => bitmask::<i8>(a),
            Self::I16x8Bitmask => bitmask::<i16>(a),
            Self::I32x4Bitmask => bitmask::<i32>(a),
            Self::I64x2Bitmask => bitmask::<i64>(a),
        }
    }
}
