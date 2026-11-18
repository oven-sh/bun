use super::MacroAssembly;
use crate::label::Label;
use crate::operand::{
    Address, FloatCond, FloatWidth, Memory, NegativeZero, RegOrImm, Rounding, Sign, TestCond, Width,
};
use crate::register::{Fpr, Gpr};

/// What is above the float in a register that is written is unspecified, and so is the destination of a conversion
/// that branches. Arithmetic gives any quiet NaN. What moves, selects or changes only the sign keeps the other bits.
pub trait FloatAssembly: MacroAssembly {
    fn move_float(&mut self, dst: Fpr, src: Fpr);
    fn move_vector(&mut self, dst: Fpr, src: Fpr);
    fn load_vector(&mut self, dst: Fpr, src: impl Into<Memory>);
    fn store_vector(&mut self, dst: impl Into<Memory>, src: Fpr);
    /// A float of 32 bits is in the low half of `bits`.
    fn move_float_constant(&mut self, width: FloatWidth, dst: Fpr, bits: u64);
    fn move_bits_to_float(&mut self, width: FloatWidth, dst: Fpr, src: Gpr);
    fn move_float_to_bits(&mut self, width: FloatWidth, dst: Gpr, src: Fpr);
    /// Clears the rest of the vector.
    fn load_float(&mut self, width: FloatWidth, dst: Fpr, src: impl Into<Memory>);
    fn store_float(&mut self, width: FloatWidth, dst: impl Into<Memory>, src: Fpr);
    /// `low` from `src`, `high` from the bytes after it. The two differ.
    fn load_pair_f64(&mut self, low: Fpr, high: Fpr, src: Address);
    fn store_pair_f64(&mut self, dst: Address, low: Fpr, high: Fpr);
    /// `low` from `src`, `high` from the bytes after it. The two differ.
    fn load_pair_vector(&mut self, low: Fpr, high: Fpr, src: Address);
    fn store_pair_vector(&mut self, dst: Address, low: Fpr, high: Fpr);
    fn add_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr);
    fn sub_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr);
    fn mul_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr);
    fn div_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr);
    /// NaN if either is, and −0 is less than 0.
    fn min_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr);
    /// NaN if either is, and −0 is less than 0.
    fn max_float(&mut self, width: FloatWidth, dst: Fpr, lhs: Fpr, rhs: Fpr);
    fn copysign_float(&mut self, width: FloatWidth, dst: Fpr, magnitude: Fpr, sign: Fpr);
    fn abs_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr);
    fn neg_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr);
    fn sqrt_float(&mut self, width: FloatWidth, dst: Fpr, src: Fpr);
    fn round_float(&mut self, rounding: Rounding, width: FloatWidth, dst: Fpr, src: Fpr);
    fn convert_f32_to_f64(&mut self, dst: Fpr, src: Fpr);
    fn convert_f64_to_f32(&mut self, dst: Fpr, src: Fpr);
    fn supports_f16(&self) -> bool;
    /// From the low 16 bits of `src`.
    fn convert_f16_bits_to_f64(&mut self, dst: Fpr, src: Gpr);
    /// Rounds once. Clears the rest of `dst`.
    fn convert_f64_to_f16_bits(&mut self, dst: Gpr, src: Fpr);
    fn convert_int_to_float(&mut self, sign: Sign, from: Width, to: FloatWidth, dst: Fpr, src: Gpr);
    /// Rounds toward zero. What does not fit gives any integer of that width.
    fn truncate_float(&mut self, from: FloatWidth, sign: Sign, to: Width, dst: Gpr, src: Fpr);
    /// Rounds toward zero, to the nearest integer that fits. NaN gives 0.
    fn truncate_float_saturating(
        &mut self,
        from: FloatWidth,
        sign: Sign,
        to: Width,
        dst: Gpr,
        src: Fpr,
    );
    /// Rounds toward zero, or goes to `failure` with NaN and what does not fit.
    fn truncate_float_or_branch(
        &mut self,
        from: FloatWidth,
        sign: Sign,
        to: Width,
        dst: Gpr,
        src: Fpr,
        failure: Label,
    );
    /// ToInt32 (ECMA-262 7.1.6). May go to `slow` when the magnitude is 2^63 or more, or for NaN.
    fn truncate_f64_to_int32_modular(&mut self, dst: Gpr, src: Fpr, slow: Label);
    /// Goes to `failure` unless `src` is exactly an integer of that width.
    fn convert_f64_to_int_exact(
        &mut self,
        width: Width,
        dst: Gpr,
        src: Fpr,
        zero: NegativeZero,
        failure: Label,
    );
    fn branch_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        rhs: Fpr,
        target: Label,
    );
    fn branch_float_with_zero(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        lhs: Fpr,
        target: Label,
    );
    /// `dst` becomes 0 or 1.
    fn compare_float(&mut self, width: FloatWidth, cond: FloatCond, dst: Gpr, lhs: Fpr, rhs: Fpr);
    /// Moves all 64 bits.
    fn select_on_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        dst: Gpr,
        lhs: Fpr,
        rhs: Fpr,
        then: Gpr,
        or: Gpr,
    );
    /// Moves a float of either width. `width` is that of the comparison.
    fn select_float_on_float(
        &mut self,
        width: FloatWidth,
        cond: FloatCond,
        dst: Fpr,
        lhs: Fpr,
        rhs: Fpr,
        then: Fpr,
        or: Fpr,
    );
    /// Moves a float of either width. `width` is that of the test.
    fn select_float_test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Fpr,
        value: Gpr,
        mask: impl Into<RegOrImm>,
        then: Fpr,
        or: Fpr,
    );
    /// Moves all 128 bits.
    fn select_vector_test(
        &mut self,
        width: Width,
        cond: TestCond,
        dst: Fpr,
        value: Gpr,
        mask: impl Into<RegOrImm>,
        then: Fpr,
        or: Fpr,
    );

    for_both! { FloatWidth::F32, FloatWidth::F64;
        move_bits_to_float as move_bits_to_f32, move_bits_to_f64(dst: Fpr, src: Gpr);
        move_float_to_bits as move_f32_to_bits, move_f64_to_bits(dst: Gpr, src: Fpr);
        load_float as load_f32, load_f64(dst: Fpr, src: impl Into<Memory>);
        store_float as store_f32, store_f64(dst: impl Into<Memory>, src: Fpr);
        add_float as add_f32, add_f64(dst: Fpr, lhs: Fpr, rhs: Fpr);
        sub_float as sub_f32, sub_f64(dst: Fpr, lhs: Fpr, rhs: Fpr);
        mul_float as mul_f32, mul_f64(dst: Fpr, lhs: Fpr, rhs: Fpr);
        div_float as div_f32, div_f64(dst: Fpr, lhs: Fpr, rhs: Fpr);
        min_float as min_f32, min_f64(dst: Fpr, lhs: Fpr, rhs: Fpr);
        max_float as max_f32, max_f64(dst: Fpr, lhs: Fpr, rhs: Fpr);
        abs_float as abs_f32, abs_f64(dst: Fpr, src: Fpr);
        neg_float as neg_f32, neg_f64(dst: Fpr, src: Fpr);
        sqrt_float as sqrt_f32, sqrt_f64(dst: Fpr, src: Fpr);
        branch_float as branch_f32, branch_f64(cond: FloatCond, lhs: Fpr, rhs: Fpr, target: Label);
        branch_float_with_zero as branch_f32_with_zero, branch_f64_with_zero(cond: FloatCond, lhs: Fpr, target: Label);
        compare_float as compare_f32, compare_f64(cond: FloatCond, dst: Gpr, lhs: Fpr, rhs: Fpr);
    }

    aliases! {
        convert_int_to_float(Sign::Signed, Width::W32, FloatWidth::F64) as convert_i32_to_f64(dst: Fpr, src: Gpr);
        convert_int_to_float(Sign::Unsigned, Width::W32, FloatWidth::F64) as convert_u32_to_f64(dst: Fpr, src: Gpr);
        convert_int_to_float(Sign::Signed, Width::W64, FloatWidth::F64) as convert_i64_to_f64(dst: Fpr, src: Gpr);
        convert_f64_to_int_exact(Width::W32) as convert_f64_to_i32_exact(
            dst: Gpr, src: Fpr, zero: NegativeZero, failure: Label
        );
    }

    #[inline]
    fn move_f64_constant(&mut self, dst: Fpr, value: f64) {
        self.move_float_constant(FloatWidth::F64, dst, value.to_bits());
    }
}
