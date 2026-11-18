//! What operations on scalars give. Values are bits, extended with zeros. `None` stands where any result is allowed.

use bun_engine_asm::{Cond, FloatCond, Rounding, Sign, Size};

use super::op::{Binary, Checked, Type, Unary};

const QUIET_F32: u32 = 1 << 22;
const QUIET_F64: u64 = 1 << 51;
pub const CANONICAL_NAN: u64 = 0x7ff8_0000_0000_0000;

fn from_i32(value: i32) -> u64 {
    (value as u32).into()
}

fn from_f32(value: f32) -> u64 {
    (value.to_bits() | if value.is_nan() { QUIET_F32 } else { 0 }).into()
}

fn from_f64(value: f64) -> u64 {
    value.to_bits() | if value.is_nan() { QUIET_F64 } else { 0 }
}

/// Exact for both widths.
fn to_f64(ty: Type, bits: u64) -> f64 {
    if ty == Type::F32 {
        f32::from_bits(bits as u32).into()
    } else {
        f64::from_bits(bits)
    }
}

/// For results that are exact in the type, or rounded once.
fn from_f64_as(ty: Type, value: f64) -> u64 {
    if ty == Type::F32 {
        from_f32(value as f32)
    } else {
        from_f64(value)
    }
}

fn sign_bit(ty: Type) -> u64 {
    1 << (ty.width().bits() - 1)
}

fn mask(ty: Type) -> u64 {
    u64::MAX >> (64 - ty.width().bits())
}

fn signed(ty: Type, bits: u64) -> i64 {
    if ty == Type::I32 {
        (bits as i32).into()
    } else {
        bits as i64
    }
}

fn saturating(sign: Sign, to: Type, value: f64) -> u64 {
    match (sign, to) {
        (Sign::Signed, Type::I32) => from_i32(value as i32),
        (Sign::Unsigned, Type::I32) => (value as u32).into(),
        (Sign::Signed, _) => value as i64 as u64,
        (Sign::Unsigned, _) => value as u64,
    }
}

fn fits(sign: Sign, to: Type, value: f64) -> bool {
    let range = (sign_bit(to) as f64) * 2.0;
    let truncated = value.trunc();
    match sign {
        Sign::Signed => truncated >= -range / 2.0 && truncated < range / 2.0,
        Sign::Unsigned => truncated >= 0.0 && truncated < range,
    }
}

fn to_int32_modular(value: f64) -> u64 {
    if value.is_finite() {
        (value.trunc() % 4_294_967_296.0) as i64 as u32 as u64
    } else {
        0
    }
}

fn half_to_f64(bits: u16) -> f64 {
    let (exponent, fraction) = (i32::from(bits >> 10 & 31), f64::from(bits & 1023));
    let magnitude = match exponent {
        0 => fraction * 2f64.powi(-24),
        31 if fraction == 0.0 => f64::INFINITY,
        31 => f64::NAN,
        _ => (1024.0 + fraction) * 2f64.powi(exponent - 25),
    };
    magnitude.copysign(if bits >> 15 == 0 { 1.0 } else { -1.0 })
}

fn f64_to_half(value: f64) -> u16 {
    const INFINITY: u16 = 0x7c00;
    let sign = (value.to_bits() >> 48) as u16 & 0x8000;
    let magnitude = value.abs();
    if value.is_nan() {
        return sign | INFINITY | 0x200;
    }
    if magnitude >= 65520.0 {
        return sign | INFINITY;
    }
    let exponent = ((magnitude.to_bits() >> 52) as i32 - 1023).max(-14);
    let units = (magnitude * 2f64.powi(10 - exponent)).round_ties_even() as u16;
    // The leading bit of a normal number carries into the exponent.
    sign | (units + (((exponent + 14) as u16) << 10))
}

pub fn unary(op: Unary, from: Type, to: Type, bits: u64) -> Option<u64> {
    let float = || to_f64(from, bits);
    Some(match op {
        Unary::Neg if from.is_int() => bits.wrapping_neg() & mask(from),
        Unary::Neg => bits ^ sign_bit(from),
        Unary::CountLeadingZeros => {
            (bits.leading_zeros() - (64 - u32::from(from.width().bits()))).into()
        }
        Unary::CountTrailingZeros => bits.trailing_zeros().min(from.width().bits().into()).into(),
        Unary::CountOnes => bits.count_ones().into(),
        Unary::SwapBytes(size) => bits.swap_bytes() >> (64 - size.bits()),
        Unary::SignExtend(Size::S8) => bits as i8 as u64 & mask(from),
        Unary::SignExtend(_) => bits as i16 as u64 & mask(from),
        Unary::Widen(Sign::Signed) => bits as i32 as u64,
        Unary::Widen(Sign::Unsigned) | Unary::Bitcast | Unary::Opaque => bits,
        Unary::FitsIn(count) => (bits >> count == 0).then_some(bits)?,
        Unary::Wrap => bits & mask(to),
        Unary::Abs => bits & !sign_bit(from),
        Unary::Sqrt => from_f64_as(from, float().sqrt()),
        Unary::Round(rounding) => from_f64_as(
            from,
            match rounding {
                Rounding::Down => float().floor(),
                Rounding::Up => float().ceil(),
                Rounding::TowardZero => float().trunc(),
                Rounding::Nearest => float().round_ties_even(),
            },
        ),
        Unary::Promote | Unary::Demote => from_f64_as(to, float()),
        Unary::IntToFloat(sign) => match (sign, to) {
            (Sign::Signed, Type::F32) => from_f32(signed(from, bits) as f32),
            (Sign::Unsigned, Type::F32) => from_f32(bits as f32),
            (Sign::Signed, _) => from_f64(signed(from, bits) as f64),
            (Sign::Unsigned, _) => from_f64(bits as f64),
        },
        Unary::FloatToInt(sign) if !fits(sign, to, float()) => return None,
        Unary::FloatToInt(sign) | Unary::FloatToIntSaturating(sign) => {
            saturating(sign, to, float())
        }
        Unary::FloatToInt32Modular => to_int32_modular(float()),
        Unary::HalfBitsToFloat => from_f64(half_to_f64(bits as u16)),
        Unary::FloatToHalfBits => f64_to_half(float()).into(),
        Unary::CanonicalizeNan => {
            if float().is_nan() {
                CANONICAL_NAN
            } else {
                bits
            }
        }
    })
}

pub fn binary(op: Binary, ty: Type, lhs: u64, rhs: u64) -> Option<u64> {
    match op {
        Binary::And => Some(lhs & rhs),
        Binary::Or => Some(lhs | rhs),
        Binary::Xor => Some(lhs ^ rhs),
        _ if ty.is_int() => int_binary(op, ty, lhs, rhs),
        _ => Some(float_binary(op, ty, lhs, rhs)),
    }
}

fn int_binary(op: Binary, ty: Type, lhs: u64, rhs: u64) -> Option<u64> {
    let width = u32::from(ty.width().bits());
    let (a, b) = (signed(ty, lhs), signed(ty, rhs));
    let amount = rhs as u32 % width;
    let quotient_overflows = lhs == sign_bit(ty) && b == -1;
    let result = match op {
        Binary::Add => lhs.wrapping_add(rhs),
        Binary::Sub => lhs.wrapping_sub(rhs),
        Binary::Mul => lhs.wrapping_mul(rhs),
        Binary::Div | Binary::Rem if quotient_overflows => return None,
        Binary::Div => a.checked_div(b)? as u64,
        Binary::Rem => a.checked_rem(b)? as u64,
        Binary::UnsignedDiv => lhs.checked_div(rhs)?,
        Binary::UnsignedRem => lhs.checked_rem(rhs)?,
        Binary::TotalDiv | Binary::TotalRem if b == 0 => 0,
        Binary::TotalDiv => a.wrapping_div(b) as u64,
        Binary::TotalRem => a.wrapping_rem(b) as u64,
        Binary::MulHigh(Sign::Signed) => ((i128::from(a) * i128::from(b)) >> width) as u64,
        Binary::MulHigh(Sign::Unsigned) => ((u128::from(lhs) * u128::from(rhs)) >> width) as u64,
        Binary::Shl => lhs << amount,
        Binary::Shr => lhs >> amount,
        Binary::Sar => (a >> amount) as u64,
        Binary::RotateLeft => lhs << amount | lhs >> ((width - amount) % width),
        Binary::RotateRight => lhs >> amount | lhs << ((width - amount) % width),
        _ => unreachable!("not of integers"),
    };
    Some(result & mask(ty))
}

/// 64 bits are more than twice 24 plus 2, so rounding to them first does not change the sum, difference, product,
/// quotient or root in 32 bits.
fn float_binary(op: Binary, ty: Type, lhs: u64, rhs: u64) -> u64 {
    let (a, b) = (to_f64(ty, lhs), to_f64(ty, rhs));
    match op {
        Binary::Add => from_f64_as(ty, a + b),
        Binary::Sub => from_f64_as(ty, a - b),
        Binary::Mul => from_f64_as(ty, a * b),
        Binary::Div => from_f64_as(ty, a / b),
        Binary::Min | Binary::Max if a.is_nan() || b.is_nan() => from_f64_as(ty, a + b),
        Binary::Min if a == b => lhs | rhs,
        Binary::Max if a == b => lhs & rhs,
        Binary::Min | Binary::Max => {
            if (a < b) == (op == Binary::Min) {
                lhs
            } else {
                rhs
            }
        }
        Binary::CopySign => lhs & !sign_bit(ty) | rhs & sign_bit(ty),
        _ => unreachable!("not of floats"),
    }
}

pub fn compare(cond: Cond, ty: Type, lhs: u64, rhs: u64) -> bool {
    if ty == Type::I32 {
        cond.holds32(lhs as i32, rhs as i32)
    } else {
        cond.holds64(lhs as i64, rhs as i64)
    }
}

pub fn float_compare(cond: FloatCond, ty: Type, lhs: u64, rhs: u64) -> bool {
    cond.holds(to_f64(ty, lhs), to_f64(ty, rhs))
}

/// `None` if the result does not fit.
pub fn checked(op: Checked, ty: Type, lhs: u64, rhs: u64) -> Option<u64> {
    let (a, b) = (signed(ty, lhs), signed(ty, rhs));
    let result = match op {
        Checked::Add => a.checked_add(b),
        Checked::Sub => a.checked_sub(b),
        Checked::Mul => a.checked_mul(b),
    }?;
    let bits = result as u64 & mask(ty);
    (signed(ty, bits) == result).then_some(bits)
}
