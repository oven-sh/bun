use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, host};
use bun_engine_vm::{
    CallFrame, CellType, JsArrayBufferView, JsBigInt, JsCell, JsFunction, NativeFunction, Value,
    ViewMode, Vm, call,
};

use super::{RESULT, SLOT_SIZE, TEMPORARY, VALUE, assemble, enter_frame, normalize};
use crate::convert::box_result;
use crate::{Convention, FfiFunction, NativeType, Place, Representation, function};

/// Carries no argument.
#[cfg(target_arch = "x86_64")]
const FLOAT: Fpr = host::XMM8;
#[cfg(target_arch = "aarch64")]
const FLOAT: Fpr = host::V16;

#[cfg(target_arch = "x86_64")]
const EXECUTABLE: Gpr = host::RCX;
#[cfg(target_arch = "aarch64")]
const EXECUTABLE: Gpr = host::X9;

fn field(base: Gpr, offset: usize) -> Address {
    Address::new(base, offset as i32)
}

fn type_of(cell: Gpr) -> Address {
    field(cell, JsCell::OFFSET_OF_TYPE)
}

/// Code that comes after the usual path, and goes back to it.
type Detour = Box<dyn FnOnce(&mut MacroAssembler)>;

struct Generator<'a> {
    masm: &'a mut MacroAssembler,
    /// Starts over with the general conversions.
    slow: Label,
    throw: Label,
    detours: Vec<Detour>,
}

impl Generator<'_> {
    /// Returns where it starts and where it goes back to, which the caller binds.
    fn detour(
        &mut self,
        emit: impl FnOnce(&mut MacroAssembler, Label) + 'static,
    ) -> (Label, Label) {
        let (start, back) = (self.masm.new_label(), self.masm.new_label());
        self.detours.push(Box::new(move |masm| {
            masm.bind(start);
            emit(masm, back);
            masm.jump(back);
        }));
        (start, back)
    }

    fn small_integer(&mut self, value: Gpr, representation: Representation) {
        let slow = self.slow;
        let (other, truncated) = self.detour(move |masm, _| {
            masm.branch_if_not_number(value, slow);
            masm.unbox_double(FLOAT, value, value);
            masm.truncate_f64_to_int32_modular(value, FLOAT, slow);
        });
        self.masm.branch_if_not_int32(value, other);
        self.masm.bind(truncated);
        normalize(self.masm, representation, value, value);
    }

    fn boolean(&mut self, value: Gpr) {
        let slow = self.slow;
        let (other, done) = self.detour(move |masm, _| {
            masm.branch_if_not_int32(value, slow);
            masm.test32(TestCond::NonZero, value, value, -1);
        });
        self.masm.branch_if_not_boolean(value, TEMPORARY, other);
        self.masm.move32(value, TEMPORARY);
        self.masm.bind(done);
    }

    fn large_integer(&mut self, value: Gpr) {
        let slow = self.slow;
        let (other, done) = self.detour(move |masm, done| {
            let (not_number, zero) = (masm.new_label(), masm.new_label());
            masm.branch_if_not_number(value, not_number);
            truncate_double(masm, value, slow);
            masm.jump(done);
            masm.bind(not_number);
            masm.branch_if_not_cell(value, slow);
            masm.branch8(Cond::Ne, type_of(value), CellType::BigInt.0.into(), slow);
            masm.branch_if_zero32(field(value, JsBigInt::OFFSET_OF_LENGTH), zero);
            masm.load8(TEMPORARY, field(value, JsBigInt::OFFSET_OF_SIGN));
            masm.load64(value, field(value, JsBigInt::OFFSET_OF_DIGITS));
            masm.branch_if_zero32(TEMPORARY, done);
            masm.neg64(value, value);
            masm.jump(done);
            masm.bind(zero);
            masm.move32(value, 0);
        });
        self.masm.branch_if_not_int32(value, other);
        self.masm.sign_extend32_to_64(value, value);
        self.masm.bind(done);
    }

    fn vector_of_view(&mut self, value: Gpr, not_cell: Label) {
        let (first, last) = (
            CellType::BUFFER_VIEWS.first.0,
            CellType::BUFFER_VIEWS.last.0,
        );
        self.masm.branch_if_not_cell(value, not_cell);
        self.masm.load8(TEMPORARY, type_of(value));
        self.masm.sub32(TEMPORARY, TEMPORARY, u32::from(first));
        (self.masm).branch32(Cond::Above, TEMPORARY, u32::from(last - first), self.slow);
        (self.masm).load64(value, field(value, JsArrayBufferView::OFFSET_OF_VECTOR));
    }

    fn pointer(&mut self, value: Gpr, may_be_null: bool) {
        let slow = self.slow;
        let (other, done) = self.detour(move |masm, done| {
            let (integer, not_number) = (masm.new_label(), masm.new_label());
            masm.branch_if_int32(value, integer);
            masm.branch_if_not_number(value, if may_be_null { not_number } else { slow });
            truncate_double(masm, value, slow);
            masm.jump(done);
            if may_be_null {
                masm.bind(not_number);
                masm.branch_if_not_null_or_undefined(value, value, slow);
                masm.move32(value, 0);
                masm.jump(done);
            }
            masm.bind(integer);
            masm.sign_extend32_to_64(value, value);
        });
        self.vector_of_view(value, other);
        self.masm.bind(done);
    }

    fn length_of_bytes(&mut self, value: Gpr) {
        let (slow, can_change) = (self.slow, ViewMode::RESIZABLE_OR_GROWABLE.bits());
        let mode = field(value, JsArrayBufferView::OFFSET_OF_MODE);
        self.masm.branch_if_not_cell(value, slow);
        (self.masm).branch8(
            Cond::Ne,
            type_of(value),
            CellType::Uint8Array.0.into(),
            slow,
        );
        (self.masm).branch_test8(TestCond::NonZero, mode, can_change.into(), slow);
        (self.masm).load64(value, field(value, JsArrayBufferView::OFFSET_OF_LENGTH));
    }

    fn float(&mut self, dst: Fpr, value: Gpr, width: FloatWidth) {
        let (integer, done) = self.detour(move |masm, _| masm.convert_i32_to_f64(dst, value));
        self.masm.branch_if_int32(value, integer);
        self.masm.branch_if_not_number(value, self.slow);
        self.masm.unbox_double(dst, value, value);
        self.masm.bind(done);
        if width == FloatWidth::F32 {
            self.masm.convert_f64_to_f32(dst, dst);
        }
    }

    /// In place.
    fn integer(&mut self, argument: NativeType, value: Gpr) {
        match argument {
            NativeType::Value => {}
            NativeType::Bool => self.boolean(value),
            NativeType::Int64
            | NativeType::Uint64
            | NativeType::Int64Fast
            | NativeType::Uint64Fast => {
                self.large_integer(value);
            }
            NativeType::Pointer | NativeType::CString => self.pointer(value, true),
            NativeType::Function => self.pointer(value, false),
            NativeType::Buffer => self.vector_of_view(value, self.slow),
            NativeType::BufferLength => self.length_of_bytes(value),
            small => self.small_integer(value, small.representation()),
        }
    }

    fn argument(&mut self, argument: NativeType, source: Address, place: Place) {
        let on_stack = |offset: u32| Address::new(abi::STACK_POINTER, offset as i32);
        match (place, argument.representation()) {
            (Place::Gpr(register), _) => {
                self.masm.load64(register, source);
                self.integer(argument, register);
            }
            (Place::Fpr(register), Representation::Float(width)) => {
                self.masm.load64(VALUE, source);
                self.float(register, VALUE, width);
            }
            (Place::Stack(offset), Representation::Float(width)) => {
                self.masm.load64(VALUE, source);
                self.float(FLOAT, VALUE, width);
                self.masm.store_float(width, on_stack(offset), FLOAT);
            }
            (Place::Stack(offset), representation) => {
                self.masm.load64(VALUE, source);
                self.integer(argument, VALUE);
                let size = representation.size().expect("an argument");
                self.masm.store(size, on_stack(offset), VALUE);
            }
            (Place::Fpr(_), _) => unreachable!(),
        }
    }

    /// An int32 if it fits. `otherwise` makes a value of the rest.
    fn box_integer(&mut self, otherwise: impl FnOnce(&mut MacroAssembler, Label) + 'static) {
        let (other, done) = self.detour(otherwise);
        self.masm.sign_extend32_to_64(TEMPORARY, RESULT);
        self.masm.branch64(Cond::Ne, TEMPORARY, RESULT, other);
        self.masm.zero_extend32(RESULT, RESULT);
        self.masm.box_int32(RESULT, RESULT);
        self.masm.bind(done);
    }

    fn box_if_exact(&mut self, result: NativeType) {
        let (throw, exact) = (self.throw, result.exact_range());
        let (inexact, done) = self.detour(move |masm, _| call_box_result(masm, result, throw));
        self.masm.sub64(TEMPORARY, RESULT, *exact.start());
        let span = exact.end() - exact.start();
        self.masm.branch64(Cond::Above, TEMPORARY, span, inexact);
        self.box_integer(|masm, _| box_as_double(masm));
        self.masm.bind(done);
    }

    fn result(&mut self, result: NativeType) {
        match (result, result.representation()) {
            (_, Representation::Nothing) => self.masm.move64(RESULT, Value::UNDEFINED.to_bits()),
            (_, Representation::Float(width)) => {
                if width == FloatWidth::F32 {
                    (self.masm).convert_f32_to_f64(abi::RETURN_FPR, abi::RETURN_FPR);
                }
                self.masm.canonicalize_nan(abi::RETURN_FPR);
                self.masm.box_double(RESULT, abi::RETURN_FPR);
            }
            (_, Representation::Bool) => {
                normalize(self.masm, Representation::Bool, RESULT, RESULT);
                self.masm.box_boolean(RESULT, RESULT);
            }
            (NativeType::Uint32, _) => {
                self.masm.zero_extend32(RESULT, RESULT);
                self.box_integer(|masm, _| box_as_double(masm));
            }
            (NativeType::Int32, _) => {
                self.masm.zero_extend32(RESULT, RESULT);
                self.masm.box_int32(RESULT, RESULT);
            }
            (_, Representation::Integer(size @ (Size::S8 | Size::S16), sign)) => {
                self.masm.extend(size, sign, Width::W32, RESULT, RESULT);
                self.masm.box_int32(RESULT, RESULT);
            }
            (NativeType::Value, _) => self.replace_zero(Value::UNDEFINED, |_| {}),
            (NativeType::Pointer | NativeType::Function, _) => {
                self.replace_zero(Value::NULL, |generator| generator.box_if_exact(result));
            }
            (NativeType::Int64Fast | NativeType::Uint64Fast, _) => self.box_if_exact(result),
            _ => call_box_result(self.masm, result, self.throw),
        }
    }

    fn replace_zero(&mut self, replacement: Value, otherwise: impl FnOnce(&mut Self)) {
        let bits = replacement.to_bits();
        let (zero, done) = self.detour(move |masm, _| masm.move64(RESULT, bits));
        self.masm.branch_if_zero64(RESULT, zero);
        otherwise(self);
        self.masm.bind(done);
    }
}

fn truncate_double(masm: &mut MacroAssembler, value: Gpr, failure: Label) {
    masm.unbox_double(FLOAT, value, value);
    let (from, to) = (FloatWidth::F64, Width::W64);
    masm.truncate_float_or_branch(from, Sign::Signed, to, value, FLOAT, failure);
}

fn box_as_double(masm: &mut MacroAssembler) {
    masm.convert_i64_to_f64(FLOAT, RESULT);
    masm.box_double(RESULT, FLOAT);
}

fn load_callee(masm: &mut MacroAssembler, dst: Gpr) {
    masm.load64(dst, field(abi::FRAME_POINTER, CallFrame::OFFSET_OF_CALLEE));
}

fn call_box_result(masm: &mut MacroAssembler, result: NativeType, throw: Label) {
    load_callee(masm, TEMPORARY);
    let realm = Argument::Load64(field(TEMPORARY, JsFunction::OFFSET_OF_SCOPE));
    masm.move_arguments(&[realm, u32::from(result as u8).into(), RESULT.into()]);
    masm.call_address(box_result as *const () as usize);
    masm.branch_if_zero64(RESULT, throw);
}

/// What an `FfiFunction` is called through. It does the conversions that call nothing.
pub fn call_entry(convention: &Convention, arguments: &[NativeType], result: NativeType) -> Code {
    let layout = convention.layout(arguments);
    let in_frame = |offset| field(abi::FRAME_POINTER, offset);
    assemble(|masm| {
        let (slow, throw) = (masm.new_label(), masm.new_label());
        enter_frame(masm, layout.stack_bytes);
        let top_call_frame = field(abi::VM, Vm::OFFSET_OF_TOP_CALL_FRAME);
        masm.store64(top_call_frame, abi::FRAME_POINTER);
        if !arguments.is_empty() {
            let count = in_frame(CallFrame::OFFSET_OF_ARGUMENT_COUNT);
            masm.branch32(Cond::BelowEq, count, arguments.len() as u32, slow);
        }
        let mut generator = Generator {
            masm,
            slow,
            throw,
            detours: Vec::new(),
        };
        for ((index, &argument), &place) in (0..).zip(arguments).zip(&layout.places) {
            let source = in_frame(CallFrame::OFFSET_OF_ARGUMENTS).plus(index * SLOT_SIZE);
            generator.argument(argument, source, place);
        }
        load_callee(generator.masm, TEMPORARY);
        if let Some((register, count)) = layout.float_count {
            generator.masm.move32(register, count);
        }
        (generator.masm).call_indirect(field(TEMPORARY, FfiFunction::OFFSET_OF_TARGET));
        (generator.masm).branch_if_not_zero64(field(abi::VM, Vm::OFFSET_OF_EXCEPTION), throw);
        generator.result(result);

        let Generator { masm, detours, .. } = generator;
        masm.leave_frame();
        masm.ret();
        detours.into_iter().for_each(|detour| detour(masm));
        masm.bind(slow);
        masm.leave_frame();
        masm.move64(EXECUTABLE, function::call as NativeFunction as usize);
        masm.jump_address(call::call_data_entry());
        masm.bind(throw);
        masm.jump_address(call::throw_from_frame());
    })
}
