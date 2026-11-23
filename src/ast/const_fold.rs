//! Constant folding that needs no parser state.

use crate::OpCode;

/// JavaScript's `ToInt32`.
pub fn to_int32(f: f64) -> i32 {
    if !f.is_finite() {
        return 0;
    }
    // The `%` keeps the value in [0, u32::MAX], so the `as u32` cast is exact.
    let uint = (f.abs() % (u32::MAX as f64 + 1.0)) as u32;
    let int = uint as i32;
    if f < 0.0 { 0i32.wrapping_sub(int) } else { int }
}

/// An arithmetic, shift or bitwise operator on two numbers, as the engine computes it.
pub fn numeric_binary(op: OpCode, left: f64, right: f64) -> Option<f64> {
    let shift = (to_int32(right) as u32) % 32;
    Some(match op {
        OpCode::BinAdd => left + right,
        OpCode::BinSub => left - right,
        OpCode::BinMul => left * right,
        OpCode::BinDiv => left / right,
        // Rust's `%` on `f64` is C's `fmod`, which is what JavaScriptCore calls.
        OpCode::BinRem => left % right,
        OpCode::BinPow => crate::math::pow(left, right),
        OpCode::BinShl => f64::from(to_int32(left).wrapping_shl(shift)),
        OpCode::BinShr => f64::from(to_int32(left).wrapping_shr(shift)),
        OpCode::BinUShr => f64::from((to_int32(left) as u32).wrapping_shr(shift)),
        OpCode::BinBitwiseAnd => f64::from(to_int32(left) & to_int32(right)),
        OpCode::BinBitwiseOr => f64::from(to_int32(left) | to_int32(right)),
        OpCode::BinBitwiseXor => f64::from(to_int32(left) ^ to_int32(right)),
        _ => return None,
    })
}
