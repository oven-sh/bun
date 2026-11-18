use super::FloatAssembly;
use crate::label::Label;
use crate::operand::{Cond, FloatCond, RegOrMem, TestCond};
use crate::register::{Fpr, Gpr};

const NULL: i32 = 0x02;
const FALSE: i32 = 0x06;
const TRUE: i32 = 0x07;
const UNDEFINED: i32 = 0x0a;
const CANONICAL_NAN: f64 = f64::from_bits(0x7ff8_0000_0000_0000);

/// Operations on JavaScript values, for code in which the tag registers hold the tags.
pub trait ValueAssembly: FloatAssembly {
    #[inline]
    fn branch_if_int32(&mut self, value: Gpr, target: Label) {
        self.branch64(Cond::AboveEq, value, Self::NUMBER_TAG, target);
    }

    #[inline]
    fn branch_if_not_int32(&mut self, value: Gpr, target: Label) {
        self.branch64(Cond::Below, value, Self::NUMBER_TAG, target);
    }

    #[inline]
    fn branch_if_number(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test64(TestCond::NonZero, value, Self::NUMBER_TAG, target);
    }

    #[inline]
    fn branch_if_not_number(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test64(TestCond::Zero, value, Self::NUMBER_TAG, target);
    }

    /// The empty value counts as a cell.
    #[inline]
    fn branch_if_cell(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test64(TestCond::Zero, value, Self::NOT_CELL_MASK, target);
    }

    #[inline]
    fn branch_if_not_cell(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_test64(TestCond::NonZero, value, Self::NOT_CELL_MASK, target);
    }

    #[inline]
    fn branch_if_empty(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_if_zero64(value, target);
    }

    #[inline]
    fn branch_if_not_empty(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch_if_not_zero64(value, target);
    }

    #[inline]
    fn branch_if_undefined(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch64(Cond::Eq, value, UNDEFINED, target);
    }

    #[inline]
    fn branch_if_not_undefined(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch64(Cond::Ne, value, UNDEFINED, target);
    }

    #[inline]
    fn branch_if_null(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch64(Cond::Eq, value, NULL, target);
    }

    #[inline]
    fn branch_if_not_null(&mut self, value: impl Into<RegOrMem>, target: Label) {
        self.branch64(Cond::Ne, value, NULL, target);
    }

    /// `temp` may be `value`.
    fn branch_if_boolean(&mut self, value: Gpr, temp: Gpr, target: Label) {
        self.xor64(temp, value, FALSE);
        self.branch_test64(TestCond::Zero, temp, !(TRUE ^ FALSE), target);
    }

    /// `temp` may be `value`. It is left with 0 or 1 for a boolean.
    fn branch_if_not_boolean(&mut self, value: Gpr, temp: Gpr, target: Label) {
        self.xor64(temp, value, FALSE);
        self.branch_test64(TestCond::NonZero, temp, !(TRUE ^ FALSE), target);
    }

    /// `temp` may be `value`.
    fn branch_if_null_or_undefined(&mut self, value: Gpr, temp: Gpr, target: Label) {
        self.and64(temp, value, !(NULL ^ UNDEFINED));
        self.branch64(Cond::Eq, temp, NULL, target);
    }

    /// `temp` may be `value`.
    fn branch_if_not_null_or_undefined(&mut self, value: Gpr, temp: Gpr, target: Label) {
        self.and64(temp, value, !(NULL ^ UNDEFINED));
        self.branch64(Cond::Ne, temp, NULL, target);
    }

    /// The upper half of `src` is clear.
    #[inline]
    fn box_int32(&mut self, dst: Gpr, src: Gpr) {
        self.or64(dst, src, Self::NUMBER_TAG);
    }

    /// `src` is 0 or 1.
    #[inline]
    fn box_boolean(&mut self, dst: Gpr, src: Gpr) {
        self.or32(dst, src, FALSE);
    }

    /// `src` is no NaN other than the canonical one.
    #[inline]
    fn box_double(&mut self, dst: Gpr, src: Fpr) {
        self.move_f64_to_bits(dst, src);
        self.sub64(dst, dst, Self::NUMBER_TAG);
    }

    /// `temp` may be `src`.
    #[inline]
    fn unbox_double(&mut self, dst: Fpr, src: Gpr, temp: Gpr) {
        self.add64(temp, src, Self::NUMBER_TAG);
        self.move_bits_to_f64(dst, temp);
    }

    fn canonicalize_nan(&mut self, value: Fpr) {
        let done = self.new_label();
        self.branch_f64(FloatCond::Ordered, value, value, done);
        self.move_f64_constant(value, CANONICAL_NAN);
        self.bind(done);
    }

    /// Puts the tags in the tag registers.
    fn load_tags(&mut self) {
        const NUMBER_TAG: u64 = 0xfffe_0000_0000_0000;
        self.move64(Self::NUMBER_TAG, NUMBER_TAG);
        self.add64(Self::NOT_CELL_MASK, Self::NUMBER_TAG, NULL);
    }
}

impl<M: FloatAssembly> ValueAssembly for M {}
