//! Calls of native functions.

use core::mem::offset_of;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{FloatWidth, NegativeZero, Rounding};
use bun_engine_bytecode::{CodeFlags, Register, Specialization};
use bun_engine_text::StringImpl;
use bun_engine_vm::code::metadata::Call;
use bun_engine_vm::ic::CallProfile;
use bun_engine_vm::{
    CallFrame, CellType, Executable, Intrinsic, JsFunction, JsString, NativeExecutable,
    SmallStrings, Vm, call,
};

use super::call::{FixedCall, new_frame};
use super::{Compiler, metadata, slot};
use crate::emit::{Emit, FALSE, TRUE, UNDEFINED, WORD, at};
use crate::profiles::Likely;
use crate::registers::*;

const THIS: Gpr = T1;
const FIRST: Gpr = T2;
const SECOND: Gpr = T3;

/// Whether it looks at `this`, and at how many arguments, if there is code for its usual cases.
fn operands(intrinsic: Intrinsic) -> Option<(bool, u32)> {
    use Intrinsic::*;
    Some(match intrinsic {
        ArrayPop => (true, 0),
        ArrayPush | CharAt | CharCodeAt | StringPrototypeAt | StringPrototypeCodePointAt => {
            (true, 1)
        }
        Abs | ArrayIsArray | Ceil | Clz32 | Floor | FRound | FromCharCode | FromCodePoint
        | GlobalIsNaN | NumberConstructor | NumberIsNaN | Round | Sqrt | StringConstructor
        | ToIntegerOrInfinity | ToLength | Trunc => (false, 1),
        IMul | Max | Min => (false, 2),
        _ => return Option::None,
    })
}

impl Compiler<'_> {
    /// What the site has called so far, if that is one native function and nobody has to be told of the call.
    pub(super) fn only_native_callee(&self, call: &FixedCall) -> Option<Intrinsic> {
        let is_plain = call.specialization == Specialization::Call
            && !self.body.flags().contains(CodeFlags::HAS_DEBUG_HOOKS);
        is_plain.then(|| self.profiles.native_callee(call.metadata))?
    }

    /// Does what the function does, if it is the one, and jumps to the label with the result in `T0`.
    pub(super) fn try_intrinsic(
        &mut self,
        call: &FixedCall,
        intrinsic: Intrinsic,
    ) -> Option<Label> {
        let (reads_this, count) = operands(intrinsic).filter(|it| it.1 + 1 == call.count)?;
        let [other, done] = core::array::from_fn(|_| self.m.new_label());
        for (index, register) in (0..count).zip([FIRST, SECOND]) {
            self.load(register, call.argument(index));
        }
        if reads_this {
            self.load(THIS, call.this);
        }
        self.load(T0, call.callee);
        self.incoming = None;
        self.branch_unless_callee_is(call, intrinsic, other);
        let is_int32 = (0..count).all(|it| self.likely(call.argument(it)) == Likely::Int32);
        self.intrinsic(intrinsic, is_int32, other, done);
        self.m.jump(done);
        self.m.bind(other);
        Some(done)
    }

    /// With the callee in `T0`.
    fn branch_unless_callee_is(&mut self, call: &FixedCall, intrinsic: Intrinsic, other: Label) {
        let profile = |field| metadata(call.metadata, offset_of!(Call, profile) + field);
        (self.m).branch64(Cond::Ne, T0, profile(CallProfile::OFFSET_OF_CALLEE), other);
        let (seen, mark) = (
            profile(CallProfile::OFFSET_OF_EXECUTABLE),
            CallProfile::FIRST_NATIVE + intrinsic as usize,
        );
        self.m.branch64(Cond::Ne, seen, mark, other);
    }

    /// Falls through or jumps to `done`.
    fn intrinsic(&mut self, intrinsic: Intrinsic, is_int32: bool, other: Label, done: Label) {
        let m = &mut self.m;
        match intrinsic {
            Intrinsic::ArrayPush | Intrinsic::ArrayPop => {
                m.call_address(match intrinsic {
                    Intrinsic::ArrayPush => self.thunks.push,
                    _ => self.thunks.pop,
                });
                m.branch_if_zero64(T0, other);
            }
            Intrinsic::ArrayIsArray => {
                m.move64(T0, FALSE);
                m.branch_if_not_cell(FIRST, done);
                m.branch_if_type(FIRST, CellType::Proxy, other);
                m.branch_unless_type_in(FIRST, CellType::ARRAYS, T1, done);
                m.move64(T0, TRUE);
            }
            Intrinsic::CharCodeAt => {
                load_unit(m, other);
                m.box_int32(T0, T0);
            }
            Intrinsic::StringPrototypeCodePointAt => {
                load_unit(m, other);
                m.branch32(Cond::AboveEq, T0, 0xd800, other);
                m.box_int32(T0, T0);
            }
            Intrinsic::CharAt | Intrinsic::StringPrototypeAt => {
                load_unit(m, other);
                load_string_of_unit(m, T0, other);
            }
            Intrinsic::FromCharCode | Intrinsic::FromCodePoint => {
                m.branch_if_not_int32(FIRST, other);
                m.move32(FIRST, FIRST);
                load_string_of_unit(m, FIRST, other);
            }
            Intrinsic::StringConstructor => {
                m.branch_if_not_cell(FIRST, other);
                m.branch_if_not_type(FIRST, CellType::String, other);
                m.move64(T0, FIRST);
            }
            Intrinsic::NumberConstructor => {
                m.branch_if_not_number(FIRST, other);
                m.move64(T0, FIRST);
            }
            Intrinsic::ToIntegerOrInfinity => {
                m.branch_if_not_int32(FIRST, other);
                m.move64(T0, FIRST);
            }
            Intrinsic::ToLength => {
                m.branch_if_not_int32(FIRST, other);
                m.branch_test32(TestCond::Negative, FIRST, -1, other);
                m.move64(T0, FIRST);
            }
            Intrinsic::GlobalIsNaN | Intrinsic::NumberIsNaN => {
                m.move64(T0, FALSE);
                m.branch_if_int32(FIRST, done);
                m.branch_if_not_number(FIRST, other);
                m.unbox_double(F0, FIRST, T1);
                m.compare_f64(FloatCond::Unordered, T0, F0, F0);
                m.box_boolean(T0, T0);
            }
            Intrinsic::Clz32 => {
                m.branch_if_not_int32(FIRST, other);
                m.count_leading_zeros(Width::W32, T0, FIRST);
                m.box_int32(T0, T0);
            }
            Intrinsic::IMul => {
                m.truncate_number(FIRST, T1, other);
                m.truncate_number(SECOND, T1, other);
                m.mul32(T0, FIRST, SECOND);
                m.box_int32(T0, T0);
            }
            Intrinsic::Abs => {
                let double = m.new_label();
                m.branch_if_not_int32(FIRST, double);
                m.move64(T0, FIRST);
                m.branch_test32(TestCond::NonNegative, FIRST, -1, done);
                m.branch_neg(Width::W32, ResultCond::Overflow, T0, FIRST, double);
                m.box_int32(T0, T0);
                m.jump(done);
                m.bind(double);
                m.number_to_double(F0, FIRST, T1, other);
                m.abs_f64(F0, F0);
                box_number(m, done);
            }
            Intrinsic::Sqrt => {
                m.number_to_double(F0, FIRST, T1, other);
                m.sqrt_f64(F0, F0);
                m.branch_f64(FloatCond::Unordered, F0, F0, other);
                m.box_double(T0, F0);
            }
            Intrinsic::FRound => {
                m.number_to_double(F0, FIRST, T1, other);
                m.convert_f64_to_f32(F0, F0);
                m.convert_f32_to_f64(F0, F0);
                m.box_double(T0, F0);
            }
            Intrinsic::Ceil | Intrinsic::Floor | Intrinsic::Round | Intrinsic::Trunc => {
                m.move64(T0, FIRST);
                m.branch_if_int32(FIRST, done);
                m.branch_if_not_number(FIRST, other);
                m.unbox_double(F0, FIRST, T1);
                round(m, intrinsic);
                box_number(m, done);
            }
            _ => {
                let doubles = if is_int32 { other } else { m.new_label() };
                let is_max = intrinsic == Intrinsic::Max;
                m.branch_unless_both_int32(FIRST, SECOND, T1, doubles);
                let cond = if is_max { Cond::Gt } else { Cond::Lt };
                m.select(Width::W32, cond, T0, FIRST, SECOND, FIRST, SECOND);
                if !is_int32 {
                    m.jump(done);
                    m.bind(doubles);
                    m.number_to_double(F0, FIRST, T1, other);
                    m.number_to_double(F1, SECOND, T1, other);
                    m.branch_f64(FloatCond::EqOrUnordered, F0, F1, other);
                    let cond = if is_max { FloatCond::Gt } else { FloatCond::Lt };
                    m.select_float_on_float(FloatWidth::F64, cond, F0, F0, F1, F0, F1);
                    box_number(m, done);
                }
            }
        }
    }

    /// The same as below, for that function and for numbers.
    pub(super) fn try_on_numbers(&mut self, call: &FixedCall, intrinsic: Intrinsic) -> Label {
        let other = self.m.new_label();
        self.branch_unless_callee_is(call, intrinsic, other);
        for index in 0..call.count - 1 {
            let argument = Register::outgoing_argument(call.frame, index);
            self.m.load64(T2, slot(argument));
            self.m.branch_if_not_number(T2, other);
        }
        let done = self.try_native_call(call);
        self.m.bind(other);
        done
    }

    /// With the callee in `T0`, the executable in its register, `this` in `T1` and the arguments in place. Calls the
    /// function, if it is a native one, and jumps to the label with the result in `T0`.
    pub(super) fn try_native_call(&mut self, call: &FixedCall) -> Label {
        let [other, returned, done] = core::array::from_fn(|_| self.m.new_label());
        let entry = at(
            EXECUTABLE,
            Executable::offset_of_entry(Specialization::Call),
        );
        (self.m).branch64(Cond::Ne, entry, call::native_call_entry(), other);
        let field = |offset| new_frame(call.frame, offset);
        self.m.store64(field(CallFrame::OFFSET_OF_THIS), T1);
        (self.m).store64(field(CallFrame::OFFSET_OF_ARGUMENT_COUNT), call.count);
        self.m.store64(field(CallFrame::OFFSET_OF_CALLEE), T0);
        self.m.store64(field(CallFrame::OFFSET_OF_CODE_BLOCK), 0);
        self.m.move_label_address(T2, returned);
        self.m.store_pair64(field(0), FP, T2);
        self.store_call_site();
        (self.m).load64(T4, at(EXECUTABLE, NativeExecutable::OFFSET_OF_FUNCTION));
        (self.m).load64(ARGUMENTS[0], at(T0, JsFunction::OFFSET_OF_SCOPE));
        self.m.compute_address(FP, field(0));
        self.m.store64(at(VM, Vm::OFFSET_OF_TOP_CALL_FRAME), FP);
        self.m.move64(ARGUMENTS[1], FP);
        self.m.move64(SP, FP);
        self.m.call_indirect(T4);
        self.m.bind(returned);
        self.m.add64(FP, FP, call.frame as i32 * WORD);
        self.restore_stack_pointer();
        let throw = self.m.external_address(call::throw_from_frame());
        (self.m).branch64(Cond::Ne, at(VM, Vm::OFFSET_OF_EXCEPTION), 0, throw);
        self.m.branch_if_not_zero64(T0, done);
        self.m.move64(T0, UNDEFINED);
        self.m.jump(done);
        self.m.bind(other);
        done
    }
}

/// Into `T0`.
fn load_unit(m: &mut MacroAssembler, other: Label) {
    m.branch_if_not_cell(THIS, other);
    m.branch_if_not_type(THIS, CellType::String, other);
    m.load64(THIS, at(THIS, JsString::OFFSET_OF_FIBER));
    m.branch_test32(TestCond::NonZero, THIS, JsString::IS_ROPE, other);
    m.sub64(FIRST, FIRST, NUMBER_TAG);
    m.load32(T0, at(THIS, StringImpl::OFFSET_OF_LENGTH));
    m.branch64(Cond::AboveEq, FIRST, T0, other);
    m.load_code_unit(T0, THIS, FIRST, T0);
}

/// Into `T0`. The upper half of `unit` is clear.
fn load_string_of_unit(m: &mut MacroAssembler, unit: Gpr, other: Label) {
    m.branch32(Cond::Above, unit, i32::from(u8::MAX), other);
    let strings = Vm::OFFSET_OF_SMALL_STRINGS + SmallStrings::OFFSET_OF_SINGLE_CHARACTERS;
    m.load64(T0, Address::indexed(VM, unit, Scale::Eight, strings as i32));
    m.branch_if_zero64(T0, other);
}

/// In `F0`.
fn round(m: &mut MacroAssembler, intrinsic: Intrinsic) {
    match intrinsic {
        Intrinsic::Floor => m.round_float(Rounding::Down, FloatWidth::F64, F0, F0),
        Intrinsic::Ceil => m.round_float(Rounding::Up, FloatWidth::F64, F0, F0),
        Intrinsic::Trunc => m.round_float(Rounding::TowardZero, FloatWidth::F64, F0, F0),
        _ => {
            let done = m.new_label();
            m.move_float(F1, F0);
            m.round_float(Rounding::Up, FloatWidth::F64, F0, F0);
            m.move_f64_constant(F2, 0.5);
            m.sub_f64(F2, F0, F2);
            m.branch_f64(FloatCond::LeOrUnordered, F2, F1, done);
            m.move_f64_constant(F2, 1.0);
            m.sub_f64(F0, F0, F2);
            m.bind(done);
        }
    }
}

/// `F0` into `T0`, as an int32 if it is one.
fn box_number(m: &mut MacroAssembler, done: Label) {
    let double = m.new_label();
    m.convert_f64_to_i32_exact(T0, F0, NegativeZero::Reject, double);
    m.box_int32(T0, T0);
    m.jump(done);
    m.bind(double);
    m.box_double(T0, F0);
}
