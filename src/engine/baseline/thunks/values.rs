//! Arithmetic, conversions and comparisons.

use bun_engine_asm::prelude::*;
use bun_engine_text::StringImpl;
use bun_engine_vm::{Arithmetic, CellType, JsCell, JsString, TypeFlags, Value, Vm, operators};

use super::{Emitter, UNKNOWN};
use crate::emit::*;
use crate::registers::*;

impl Emitter {
    pub(super) fn to_doubles(&mut self) {
        let other = self.m.new_label();
        self.m.number_to_double(F0, T0, T2, other);
        self.m.number_to_double(F1, T1, T2, other);
        self.m.move32(T2, 1);
        self.m.ret();
        self.m.bind(other);
        self.m.move32(T2, 0);
        self.m.ret();
    }

    /// Adds what it is to what is in `T3`.
    pub(super) fn classify(
        &mut self,
        dst: Fpr,
        value: Gpr,
        kinds: [Arithmetic; 2],
        otherwise: Label,
    ) {
        let (int32, done) = (self.m.new_label(), self.m.new_label());
        self.m.branch_if_int32(value, int32);
        self.m.branch_if_not_number(value, otherwise);
        self.m.unbox_double(dst, value, T2);
        self.m.or32(T3, T3, kinds[1].low_half());
        self.m.jump(done);
        self.m.bind(int32);
        self.m.convert_i32_to_f64(dst, value);
        self.m.or32(T3, T3, kinds[0].low_half());
        self.m.bind(done);
    }

    /// Two int32 get here if the result is none, which is for the slow path to record the first time.
    pub(super) fn arithmetic(&mut self, operate: fn(&mut MacroAssembler)) {
        let (other, mixed) = (self.m.new_label(), self.m.new_label());
        self.count_surprise(1, other);
        self.m.branch_unless_both_int32(T0, T1, T2, mixed);
        let overflowed = Arithmetic::RESULT_OVERFLOWED_INT32.low_half();
        (self.m).branch_test16(TestCond::Zero, at(T4, 0), overflowed, other);
        self.m.bind(mixed);
        (self.m).move32(T3, Arithmetic::RESULT_DOUBLE.low_half());
        self.classify(
            F0,
            T0,
            [Arithmetic::LHS_INT32, Arithmetic::LHS_DOUBLE],
            other,
        );
        self.classify(
            F1,
            T1,
            [Arithmetic::RHS_INT32, Arithmetic::RHS_DOUBLE],
            other,
        );
        operate(&mut self.m);
        self.m.box_double(T0, F0);
        let (usual, negative_zero) = (self.m.new_label(), Value::double(-0.0).to_bits());
        self.m.branch64(Cond::Ne, T0, negative_zero, usual);
        let flags = Arithmetic::RESULT_DOUBLE | Arithmetic::RESULT_NEGATIVE_ZERO;
        self.m.xor32(T3, T3, flags.low_half());
        self.m.bind(usual);
        self.m.or_to_memory(Size::S16, at(T4, 0), T3);
        self.m.ret();
        self.answer(other, 0);
    }

    pub(super) fn add(&mut self) {
        self.arithmetic(|m| m.add_f64(F0, F0, F1));
    }

    pub(super) fn subtract(&mut self) {
        self.arithmetic(|m| m.sub_f64(F0, F0, F1));
    }

    pub(super) fn multiply(&mut self) {
        self.arithmetic(|m| m.mul_f64(F0, F0, F1));
    }

    pub(super) fn to_boolean(&mut self) {
        let m = &mut self.m;
        let [yes, no, unknown, cell, number, double, primitive] =
            core::array::from_fn(|_| m.new_label());
        m.branch_if_cell(T0, cell);
        m.branch_if_number(T0, number);
        m.compare64(Cond::Eq, T0, T0, TRUE);
        m.ret();
        m.bind(number);
        m.branch_if_not_int32(T0, double);
        m.test32(TestCond::NonZero, T0, T0, -1);
        m.ret();
        m.bind(double);
        m.unbox_double(F0, T0, T0);
        m.branch_f64_with_zero(FloatCond::Ne, F0, yes);
        m.jump(no);
        m.bind(cell);
        m.branch_if_cell_is_no_object(T0, primitive);
        m.branch_if_flag(T0, TypeFlags::MASQUERADES_AS_UNDEFINED, unknown);
        m.jump(yes);
        m.bind(primitive);
        m.branch_if_not_type(T0, CellType::String, unknown);
        m.load_string_length(T1, T0);
        m.test32(TestCond::NonZero, T0, T1, -1);
        m.ret();
        self.answer(yes, 1);
        self.answer(no, 0);
        self.answer(unknown, UNKNOWN);
    }

    /// Of two different strings. Goes to `by_content` unless it is plain to see.
    pub(super) fn compare_strings(&mut self, no: Label, by_content: Label) {
        let m = &mut self.m;
        m.load8(T2, at(T0, JsCell::OFFSET_OF_FLAGS));
        m.load8(T3, at(T1, JsCell::OFFSET_OF_FLAGS));
        m.load64(T4, at(T0, JsString::OFFSET_OF_FIBER));
        m.load64(T5, at(T1, JsString::OFFSET_OF_FIBER));
        m.and32(T2, T2, T3);
        let not_atoms = m.new_label();
        m.branch_test32(
            TestCond::Zero,
            T2,
            TypeFlags::PER_CELL_BIT.bits(),
            not_atoms,
        );
        m.compare64(Cond::Eq, T0, T4, T5);
        m.ret();
        m.bind(not_atoms);
        m.or64(T2, T4, T5);
        m.branch_test32(TestCond::NonZero, T2, JsString::IS_ROPE, by_content);
        m.load32(T2, at(T4, StringImpl::OFFSET_OF_LENGTH));
        m.branch32(Cond::Ne, T2, at(T5, StringImpl::OFFSET_OF_LENGTH), no);
        m.bind(by_content);
        m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        m.move64(ARGUMENTS[0], T0);
        m.move64(ARGUMENTS[1], T1);
        m.jump_address(operators::are_equal as *const () as usize);
    }

    pub(super) fn compare_numbers(&mut self, otherwise: Label) {
        self.m.number_to_double(F0, T0, T2, otherwise);
        self.m.number_to_double(F1, T1, T2, otherwise);
        self.m.compare_f64(FloatCond::Eq, T0, F0, F1);
        self.m.ret();
    }

    pub(super) fn strict_equal(&mut self) {
        let [yes, no, by_content, cells, by_bits] = core::array::from_fn(|_| self.m.new_label());
        self.m.or64(T2, T0, T1);
        self.m.branch_if_cell(T2, cells);
        self.compare_numbers(by_bits);
        self.m.bind(by_bits);
        self.m.compare64(Cond::Eq, T0, T0, T1);
        self.m.ret();
        self.m.bind(cells);
        self.m.branch64(Cond::Eq, T0, T1, yes);
        self.m.load8(T2, cell_type(T0));
        (self.m).branch32(Cond::Above, T2, i32::from(CellType::BigInt.0), no);
        self.m.load8(T3, cell_type(T1));
        self.m.branch32(Cond::Ne, T2, T3, no);
        (self.m).branch32(Cond::Ne, T2, i32::from(CellType::String.0), by_content);
        self.compare_strings(no, by_content);
        self.answer(yes, 1);
        self.answer(no, 0);
    }

    pub(super) fn loose_equal(&mut self) {
        let [yes, no, unknown, cells, no_numbers, primitive] =
            core::array::from_fn(|_| self.m.new_label());
        self.m.or64(T2, T0, T1);
        self.m.branch_if_cell(T2, cells);
        self.compare_numbers(no_numbers);
        self.m.bind(no_numbers);
        self.m.branch64(Cond::Eq, T0, T1, yes);
        self.m.jump(unknown);
        self.m.bind(cells);
        self.m.branch64(Cond::Eq, T0, T1, yes);
        self.m.branch_if_cell_is_no_object(T0, primitive);
        self.m.branch_if_cell_is_object(T1, no);
        self.m.jump(unknown);
        self.m.bind(primitive);
        self.m.branch_if_not_type(T0, CellType::String, unknown);
        self.m.branch_if_not_type(T1, CellType::String, unknown);
        let by_content = self.m.new_label();
        self.compare_strings(no, by_content);
        self.answer(yes, 1);
        self.answer(no, 0);
        self.answer(unknown, UNKNOWN);
    }
}

const _: () = assert!(Value::TRUE.to_bits() == Value::FALSE.to_bits() + 1);
