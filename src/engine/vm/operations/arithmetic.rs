//! The operators on values of any type.

use bun_engine_number::{math, to_int32};

use crate::{Cx, Gc, JsBigInt, JsResult, JsString, Numeric, PreferredType, Value};

#[inline(always)]
fn binary(
    cx: &mut Cx,
    lhs: Value,
    rhs: Value,
    on_numbers: impl FnOnce(f64, f64) -> Value,
    on_bigints: impl FnOnce(&Cx, &JsBigInt, &JsBigInt) -> JsResult<Gc<JsBigInt>>,
    mixed: &'static str,
) -> JsResult<Value> {
    match (lhs.to_numeric(cx)?, rhs.to_numeric(cx)?) {
        (Numeric::Number(a), Numeric::Number(b)) => Ok(on_numbers(a, b)),
        (Numeric::BigInt(a), Numeric::BigInt(b)) => on_bigints(cx, &a, &b).map(Into::into),
        _ => Err(cx.throw_type_error(mixed)),
    }
}

macro_rules! binary_operators {
    ($($name:ident, $what:literal, |$a:ident, $b:ident| $on_numbers:expr, $on_bigints:ident;)*) => {$(
        #[inline]
        pub fn $name(cx: &mut Cx, lhs: Value, rhs: Value) -> JsResult<Value> {
            binary(
                cx,
                lhs,
                rhs,
                |$a, $b| Value::from($on_numbers),
                JsBigInt::$on_bigints,
                concat!("Invalid mix of BigInt and other type in ", $what, "."),
            )
        }
    )*};
}

binary_operators! {
    add_numeric, "addition", |a, b| a + b, add;
    subtract, "subtraction", |a, b| a - b, subtract;
    multiply, "multiplication", |a, b| a * b, multiply;
    divide, "division", |a, b| a / b, divide;
    remainder, "remainder", |a, b| math::remainder(a, b), remainder;
    exponentiate, "exponentiation", |a, b| math::pow(a, b), exponentiate;
    bit_and, "bitwise 'and' operation", |a, b| to_int32(a) & to_int32(b), bitwise_and;
    bit_or, "bitwise 'or' operation", |a, b| to_int32(a) | to_int32(b), bitwise_or;
    bit_xor, "bitwise 'xor' operation", |a, b| to_int32(a) ^ to_int32(b), bitwise_xor;
    shift_left, "left shift operation", |a, b| to_int32(a).wrapping_shl(to_int32(b) as u32), left_shift;
    shift_right, "signed right shift operation", |a, b| to_int32(a).wrapping_shr(to_int32(b) as u32), signed_right_shift;
}

pub fn shift_right_unsigned(cx: &mut Cx, lhs: Value, rhs: Value) -> JsResult<u32> {
    match (lhs.to_numeric(cx)?, rhs.to_numeric(cx)?) {
        (Numeric::Number(a), Numeric::Number(b)) => {
            Ok((to_int32(a) as u32).wrapping_shr(to_int32(b) as u32))
        }
        _ => Err(cx.throw_type_error("BigInt does not support >>> operator")),
    }
}

#[inline]
pub fn add(cx: &mut Cx, lhs: Value, rhs: Value) -> JsResult<Value> {
    if let (Some(a), Some(b)) = (lhs.as_string(), rhs.as_string()) {
        return JsString::concat(cx, a, b).map(Into::into);
    }
    if let (Some(a), Some(b)) = (lhs.as_bigint(), rhs.as_bigint()) {
        return JsBigInt::add(cx, &a, &b).map(Into::into);
    }
    let a = lhs.to_primitive(cx, PreferredType::None)?;
    let b = rhs.to_primitive(cx, PreferredType::None)?;
    if a.is_string() || b.is_string() {
        return JsString::add(cx, a, b).map(Into::into);
    }
    add_numeric(cx, a, b)
}

macro_rules! unary_operators {
    ($($name:ident, |$a:ident| $on_number:expr, $on_bigint:ident;)*) => {$(
        pub fn $name(cx: &mut Cx, value: Value) -> JsResult<Value> {
            match value.to_numeric(cx)? {
                Numeric::Number($a) => Ok(Value::from($on_number)),
                Numeric::BigInt(a) => JsBigInt::$on_bigint(cx, &a).map(Into::into),
            }
        }
    )*};
}

unary_operators! {
    negate, |a| -a, unary_minus;
    bit_not, |a| !to_int32(a), bitwise_not;
    increment, |a| a + 1.0, increment;
    decrement, |a| a - 1.0, decrement;
}
