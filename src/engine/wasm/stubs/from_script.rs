//! The entry of an Exported Function.

#![forbid(unsafe_code)]

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Code};
use bun_engine_vm::{CallFrame, Value, Vm, call};
use bun_engine_wasm_compiler::abi::{
    Callable, ENTRY_CALLEE, FunctionSlot, INSTANCE, Place, SLOT, Signature, UNCHECKED_FRAME_SIZE,
    frame,
};
use bun_engine_wasm_runtime::{Engine, EntryFrame};

use super::helpers;
use super::kind::{Key, Kind, Referent};
use super::writer::{FLOAT, FP, RESULT, SP, TEMP, VALUE, WORD, Writer, field};

const FUNCTION: Gpr = abi::NON_ARGUMENT_GPRS[1];

fn argument(index: i32) -> Address {
    field(FP, CallFrame::OFFSET_OF_ARGUMENTS).plus(index * WORD)
}

fn takes_call(kind: Kind) -> bool {
    matches!(kind, Kind::Reference { to, .. } if to == Referent::Other)
}

impl Writer<'_> {
    fn pad_arguments(&mut self, count: u32, slow: Label) {
        let (too_few, done) = self.detour(move |masm, _| {
            masm.sub64(TEMP, SP, count * WORD as u32);
            let limit = field(abi::VM, Vm::OFFSET_OF_REAL_STACK_LIMIT);
            masm.branch64(Cond::Below, TEMP, limit, slow);
            masm.move32(abi::ARGUMENT_GPRS[0], count + 1);
            masm.call_address(call::pad_arguments());
        });
        let given = field(FP, CallFrame::OFFSET_OF_ARGUMENT_COUNT);
        self.branch32(Cond::BelowEq, given, count, too_few);
        self.bind(done);
    }

    /// Leaves the reference in the place of the argument.
    fn convert_by_call(&mut self, index: i32, slow: Label) {
        self.move_arguments(&[FP.into(), index.into()]);
        self.call_address(helpers::argument_to_reference as *const () as usize);
        self.branch_if_zero64(RESULT, slow);
        self.store64(argument(index), RESULT);
    }

    fn pass_argument(&mut self, kind: Kind, src: Address, place: Place, slow: Label) {
        let outgoing = |offset| Address::new(SP, frame::CALLEE_FRAME_FROM_STACK_POINTER + offset);
        match (place, kind) {
            (Place::Register(reg), _) if reg.bank() == Bank::Gpr => {
                self.load64(reg.gpr(), src);
                if !takes_call(kind) {
                    self.unbox(kind, reg.gpr(), slow);
                }
            }
            (Place::Register(reg), _) => {
                self.load64(VALUE, src);
                self.unbox_float(kind, reg.fpr(), VALUE, slow);
            }
            (Place::Stack(offset), Kind::F32 | Kind::F64) => {
                self.load64(VALUE, src);
                self.unbox_float(kind, FLOAT, VALUE, slow);
                self.store_f64(outgoing(offset), FLOAT);
            }
            (Place::Stack(offset), _) => {
                self.load64(VALUE, src);
                if !takes_call(kind) {
                    self.unbox(kind, VALUE, slow);
                }
                self.store64(outgoing(offset), VALUE);
            }
        }
    }

    fn box_result(&mut self, kind: Option<Kind>) {
        match kind {
            None => self.move64(RESULT, Value::UNDEFINED.to_bits()),
            Some(Kind::I32) => self.box_int32(RESULT, RESULT),
            Some(Kind::I64) => {
                self.compute_address(SP, Address::new(FP, 0));
                self.move64(VALUE, RESULT);
                self.box_i64();
            }
            Some(kind @ (Kind::F32 | Kind::F64)) => self.box_float(kind, RESULT, abi::RETURN_FPR),
            Some(Kind::Reference { .. }) => {}
        }
    }
}

/// What it cannot do without running a script it leaves to the stub for all types, before that can tell.
pub(super) fn generate(engine: &Engine, key: &Key, signature: &Signature) -> Code {
    let has_many_results = key.results.len() > 1;
    let mut size = signature.stack_bytes + (frame::ARGUMENTS - frame::INSTANCE) as u32;
    if has_many_results {
        size += EntryFrame::SIZE;
    }
    let callable = Address::new(FUNCTION, engine.layout().function_callable);
    let mut writer = Writer::new(engine.layout(), (callable.plus(Callable::INSTANCE), SLOT));
    let slow = writer.new_label();

    writer.enter_frame();
    if !key.params.is_empty() {
        writer.pad_arguments(key.params.len() as u32, slow);
    }
    if size > UNCHECKED_FRAME_SIZE {
        writer.sub64(TEMP, SP, size);
        let limit = field(abi::VM, Vm::OFFSET_OF_REAL_STACK_LIMIT);
        writer.branch64(Cond::Below, TEMP, limit, slow);
    }
    writer.sub64(SP, SP, size);
    for (index, &kind) in (0..).zip(&key.params) {
        if takes_call(kind) {
            writer.convert_by_call(index, slow);
        }
    }
    writer.load64(FUNCTION, field(FP, CallFrame::OFFSET_OF_CALLEE));
    for ((index, &kind), &place) in (0..).zip(&key.params).zip(&signature.params) {
        writer.pass_argument(kind, argument(index), place, slow);
    }
    const _: () = assert!(Callable::SLOT + WORD == Callable::INSTANCE);
    writer.load_pair64(SLOT, INSTANCE, callable.plus(Callable::SLOT));
    writer.fill_in_header(ENTRY_CALLEE);
    if has_many_results {
        writer.store64(Address::new(FP, EntryFrame::FUNCTION), FUNCTION);
    }
    writer.load_memory_base();
    writer.call_indirect(Address::new(SLOT, FunctionSlot::ENTRY));
    if has_many_results {
        writer.jump_address(engine.end_of_enter_stub());
    } else {
        writer.pin_for_scripts();
        writer.box_result(key.results.first().copied());
        writer.leave_frame();
        writer.ret();
    }

    writer.bind(slow);
    writer.leave_frame();
    writer.jump_address(engine.enter_stub());
    writer.finish()
}
