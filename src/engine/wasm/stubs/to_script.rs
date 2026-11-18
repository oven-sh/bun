//! What an instance calls for an import that is a function of a script or of the library.

#![forbid(unsafe_code)]

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Bank, Code};
use bun_engine_bytecode::Specialization::Call;
use bun_engine_vm::{CallFrame, Executable, JsFunction, Value, Vm};
use bun_engine_wasm_compiler::abi::{
    INSTANCE, Import, InstanceLayout, Place, SLOT, STUB_CALLEE, Signature, UNCHECKED_FRAME_SIZE,
    frame,
};
use bun_engine_wasm_runtime::{Engine, ExitFrame};

use super::kind::{Key, Kind};
use super::writer::{FLOAT, FP, RESULT, SP, TEMP, VALUE, WORD, Writer, field};

#[cfg(target_arch = "x86_64")]
const EXECUTABLE: Gpr = bun_engine_asm::host::RCX;
#[cfg(target_arch = "aarch64")]
const EXECUTABLE: Gpr = bun_engine_asm::host::X9;
const FUNCTION: Gpr = abi::NON_ARGUMENT_GPRS[1];

fn in_new_frame(offset: usize) -> Address {
    field(SP, offset - CallFrame::LINKAGE_SIZE)
}

fn argument(index: i32) -> Address {
    in_new_frame(CallFrame::OFFSET_OF_ARGUMENTS).plus(index * WORD)
}

impl Writer<'_> {
    /// An `i64` is left as it is.
    fn box_argument(&mut self, kind: Kind, place: Place, dst: Address) {
        let value = match (place, kind) {
            (Place::Register(reg), _) if reg.bank() == Bank::Fpr => {
                self.box_float(kind, VALUE, reg.fpr());
                VALUE
            }
            (Place::Register(reg), _) => reg.gpr(),
            (Place::Stack(offset), Kind::F32 | Kind::F64) => {
                self.load_f64(FLOAT, Address::new(FP, offset));
                self.box_float(kind, VALUE, FLOAT);
                VALUE
            }
            (Place::Stack(offset), Kind::I32) => {
                self.load32(VALUE, Address::new(FP, offset));
                VALUE
            }
            (Place::Stack(offset), _) => {
                self.load64(VALUE, Address::new(FP, offset));
                VALUE
            }
        };
        if kind == Kind::I32 {
            self.box_int32(value, value);
        }
        self.store64(dst, value);
    }
}

/// What it cannot make of the returned value without a call it leaves to the stub for all types.
pub(super) fn generate(engine: &Engine, key: &Key, signature: &Signature) -> Code {
    let header_size = CallFrame::OFFSET_OF_ARGUMENTS - CallFrame::LINKAGE_SIZE;
    let callee_size = header_size as u32 + key.params.len() as u32 * WORD as u32;
    let size = ExitFrame::SIZE + callee_size.next_multiple_of(16);
    let instance = Address::new(FP, frame::INSTANCE);
    let mut writer = Writer::new(engine.layout(), (instance, FUNCTION));
    let [slow, no_room] = [(); 2].map(|()| writer.new_label());

    writer.enter_frame();
    if size > UNCHECKED_FRAME_SIZE {
        writer.sub64(TEMP, SP, size);
        let limit = Address::new(INSTANCE, InstanceLayout::stack_limit(writer.host));
        writer.branch64(Cond::Below, TEMP, limit, no_room);
    }
    writer.fill_in_header(STUB_CALLEE);
    writer.sub64(SP, SP, size);
    writer.store64(Address::new(FP, ExitFrame::SLOT), SLOT);
    let function = Address::new(SLOT, Import::HOST_FUNCTION - Import::STUB);
    writer.load64(FUNCTION, function);
    writer.pin_for_scripts();
    writer.store64(in_new_frame(CallFrame::OFFSET_OF_CALLEE), FUNCTION);
    for ((index, &kind), &place) in (0..).zip(&key.params).zip(&signature.params) {
        writer.box_argument(kind, place, argument(index));
    }
    if key.params.contains(&Kind::I64) {
        for (index, _) in (0..).zip(&key.params).filter(|it| *it.1 == Kind::I64) {
            writer.load64(VALUE, argument(index));
            writer.box_i64();
            writer.store64(argument(index), RESULT);
        }
        writer.load64(FUNCTION, in_new_frame(CallFrame::OFFSET_OF_CALLEE));
    }
    let count = key.params.len() as u32 + 1;
    writer.load64(
        EXECUTABLE,
        field(FUNCTION, JsFunction::OFFSET_OF_EXECUTABLE),
    );
    writer.store64(in_new_frame(CallFrame::OFFSET_OF_ARGUMENT_COUNT), count);
    let this = in_new_frame(CallFrame::OFFSET_OF_THIS);
    writer.store64(this, Value::UNDEFINED.to_bits());
    writer.load64(
        TEMP,
        field(EXECUTABLE, Executable::offset_of_code_block(Call)),
    );
    writer.store64(in_new_frame(CallFrame::OFFSET_OF_CODE_BLOCK), TEMP);
    writer.call_indirect(field(EXECUTABLE, Executable::offset_of_entry(Call)));

    // A function of the library may not have looked at the traps.
    let limit = field(abi::VM, Vm::OFFSET_OF_STACK_LIMIT);
    writer.branch64(Cond::Below, FP, limit, slow);
    match *key.results {
        [] => {}
        [kind @ (Kind::F32 | Kind::F64)] => writer.unbox_float(kind, abi::RETURN_FPR, RESULT, slow),
        [kind] => writer.unbox(kind, RESULT, slow),
        _ => writer.jump(slow),
    }
    writer.load64(INSTANCE, instance);
    writer.load_memory_base();
    writer.leave_frame();
    writer.ret();

    writer.bind(slow);
    writer.jump_address(engine.end_of_host_call_stub());
    writer.bind(no_room);
    writer.leave_frame();
    writer.jump_address(engine.host_call_stub());
    writer.finish()
}
