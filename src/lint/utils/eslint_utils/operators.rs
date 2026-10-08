//! The unary and binary operators on static values.

use super::calls::pow;
use super::js_number::{to_int32, to_uint32};
use super::js_string;
use super::static_value::{Eval, MAX_LEN, StaticValue, Stop};
use crate::ast::{BinOp, UnOp};
use std::cmp::Ordering;

/// `ToNumeric`
enum Numeric {
    Number(f64),
    BigInt(i128),
}

fn to_numeric(value: &StaticValue<'_>) -> Eval<Numeric> {
    match value.to_primitive()? {
        StaticValue::BigInt(n) => Ok(Numeric::BigInt(n)),
        primitive => Ok(Numeric::Number(primitive.to_number()?)),
    }
}

/// `op operand`, for the operators that ESTree calls a `UnaryExpression`, but for `delete` and
/// `void`.
pub(super) fn unary<'a>(op: UnOp, operand: &StaticValue<'a>) -> Eval<StaticValue<'a>> {
    Ok(match op {
        UnOp::Minus => match to_numeric(operand)? {
            Numeric::Number(n) => StaticValue::Number(-n),
            Numeric::BigInt(n) => StaticValue::BigInt(n.checked_neg().ok_or(Stop::Abort)?),
        },
        UnOp::Plus => StaticValue::Number(operand.to_number()?),
        UnOp::Not => StaticValue::Bool(!operand.is_truthy()),
        UnOp::BitNot => match to_numeric(operand)? {
            Numeric::Number(n) => StaticValue::Number(f64::from(!to_int32(n))),
            Numeric::BigInt(n) => StaticValue::BigInt(!n),
        },
        UnOp::Typeof => StaticValue::string(operand.type_of().as_bytes()),
        _ => return Err(Stop::NotStatic),
    })
}

fn number_operation(op: BinOp, a: f64, b: f64) -> Eval<f64> {
    let shift = to_uint32(b) & 31;
    Ok(match op {
        BinOp::Add => a + b,
        BinOp::Sub => a - b,
        BinOp::Mul => a * b,
        BinOp::Div => a / b,
        BinOp::Rem => a % b,
        BinOp::Pow => pow(a, b),
        BinOp::Shl => f64::from(to_int32(a).wrapping_shl(shift)),
        BinOp::Shr => f64::from(to_int32(a) >> shift),
        BinOp::UShr => f64::from(to_uint32(a) >> shift),
        BinOp::BitAnd => f64::from(to_int32(a) & to_int32(b)),
        BinOp::BitOr => f64::from(to_int32(a) | to_int32(b)),
        BinOp::BitXor => f64::from(to_int32(a) ^ to_int32(b)),
        _ => return Err(Stop::NotStatic),
    })
}

/// `None` if it throws, or if the result does not fit.
fn bigint_operation(op: BinOp, a: i128, b: i128) -> Option<i128> {
    // `a << b` for `b >= 0`
    let shift_left = |a: i128, b: i128| {
        let shifted = a.checked_shl(u32::try_from(b).ok()?)?;
        ((shifted >> b) == a).then_some(shifted)
    };
    let shift_right = |a: i128, b: i128| Some(a >> b.min(127));
    match op {
        BinOp::Add => a.checked_add(b),
        BinOp::Sub => a.checked_sub(b),
        BinOp::Mul => a.checked_mul(b),
        BinOp::Div => a.checked_div(b),
        BinOp::Rem => a.checked_rem(b),
        BinOp::Pow => a.checked_pow(u32::try_from(b).ok()?),
        BinOp::Shl if b >= 0 => shift_left(a, b),
        BinOp::Shl => shift_right(a, b.checked_neg()?),
        BinOp::Shr if b >= 0 => shift_right(a, b),
        BinOp::Shr => shift_left(a, b.checked_neg()?),
        BinOp::BitAnd => Some(a & b),
        BinOp::BitOr => Some(a | b),
        BinOp::BitXor => Some(a ^ b),
        _ => None,
    }
}

/// `left op right`, for the operators that ESTree calls a `BinaryExpression`, but for `in` and
/// `instanceof`.
pub(super) fn binary<'a>(
    op: BinOp,
    left: &StaticValue<'a>,
    right: &StaticValue<'a>,
) -> Eval<StaticValue<'a>> {
    let is = |accepts: fn(Ordering) -> bool| -> Eval<StaticValue<'a>> {
        Ok(StaticValue::Bool(left.compare(right)?.is_some_and(accepts)))
    };
    match op {
        BinOp::EqEq => return Ok(StaticValue::Bool(left.loose_equals(right)?)),
        BinOp::NotEq => return Ok(StaticValue::Bool(!left.loose_equals(right)?)),
        BinOp::EqEqEq => return Ok(StaticValue::Bool(left.strict_equals(right)?)),
        BinOp::NotEqEq => return Ok(StaticValue::Bool(!left.strict_equals(right)?)),
        BinOp::Lt => return is(Ordering::is_lt),
        BinOp::Le => return is(Ordering::is_le),
        BinOp::Gt => return is(Ordering::is_gt),
        BinOp::Ge => return is(Ordering::is_ge),
        BinOp::Add => {
            let (left, right) = (left.to_primitive()?, right.to_primitive()?);
            if matches!(left, StaticValue::String(_)) || matches!(right, StaticValue::String(_)) {
                let text = js_string::concat(left.to_string()?, right.to_string()?);
                return if text.len() > MAX_LEN {
                    Err(Stop::Abort)
                } else {
                    Ok(StaticValue::String(text))
                };
            }
        }
        _ => {}
    }
    match (to_numeric(left)?, to_numeric(right)?) {
        (Numeric::Number(a), Numeric::Number(b)) => {
            Ok(StaticValue::Number(number_operation(op, a, b)?))
        }
        (Numeric::BigInt(a), Numeric::BigInt(b)) => Ok(StaticValue::BigInt(
            bigint_operation(op, a, b).ok_or(Stop::Abort)?,
        )),
        _ => Err(Stop::Abort),
    }
}
