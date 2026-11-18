use bun_engine_asm::Code;
use bun_engine_asm::prelude::*;

use super::{RESULT, SLOT_SIZE, TEMPORARY, VALUE, assemble, enter_frame, normalize};
use crate::{Convention, NativeType, Place, Representation};

/// Calls the function with a slot for each argument, and returns a slot.
pub type Invoker = unsafe extern "C" fn(target: usize, slots: *const u64) -> u64;

/// It is called by the same convention as it calls.
pub fn invoker(convention: &Convention, arguments: &[NativeType], result: NativeType) -> Code {
    const LOCALS: u32 = 16;
    let layout = convention.layout(arguments);
    let [target, slots] = convention.first_two_gprs();
    let saved_target = Address::new(abi::FRAME_POINTER, -SLOT_SIZE);
    assemble(|masm| {
        enter_frame(masm, LOCALS + layout.stack_bytes);
        masm.store64(saved_target, target);
        masm.move64(TEMPORARY, slots);
        for ((index, argument), &place) in (0..).zip(arguments).zip(&layout.places) {
            let slot = Address::new(TEMPORARY, index * SLOT_SIZE);
            match (place, argument.representation()) {
                (Place::Gpr(register), _) => masm.load64(register, slot),
                (Place::Fpr(register), _) => masm.load_f64(register, slot),
                (Place::Stack(offset), representation) => {
                    let size = representation.size().expect("an argument");
                    masm.load64(VALUE, slot);
                    masm.store(size, Address::new(abi::STACK_POINTER, offset as i32), VALUE);
                }
            }
        }
        if let Some((register, count)) = layout.float_count {
            masm.move32(register, count);
        }
        masm.call_indirect(saved_target);
        match result.representation() {
            Representation::Nothing => masm.move32(RESULT, 0),
            Representation::Float(width) => masm.move_float_to_bits(width, RESULT, abi::RETURN_FPR),
            integer => normalize(masm, integer, RESULT, RESULT),
        }
        masm.leave_frame();
        masm.ret();
    })
}
