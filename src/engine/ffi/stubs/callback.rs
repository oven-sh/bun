use bun_engine_asm::Code;
use bun_engine_asm::prelude::*;
use bun_engine_vm::CallFrame;

use super::{RESULT, SLOT_SIZE, TEMPORARY, VALUE, assemble, enter_frame, normalize};
use crate::{Convention, NativeType, Place, Representation};

/// Gets a slot for each argument, and returns a slot. It is the first word of what `context` points to.
pub type Receiver = unsafe extern "C" fn(context: usize, slots: *const u64) -> u64;

/// What native code calls. `body` is the address of a `callback_body`.
pub fn callback_entry(context: usize, body: usize) -> Code {
    assemble(|masm| {
        masm.move64(TEMPORARY, context);
        masm.jump_address(body);
    })
}

/// It calls the receiver by the same convention as it is called.
pub fn callback_body(
    convention: &Convention,
    arguments: &[NativeType],
    result: NativeType,
) -> Code {
    let layout = convention.layout(arguments);
    let slot_bytes = (arguments.len() as u32 * SLOT_SIZE as u32).next_multiple_of(16);
    let slots = Address::new(abi::FRAME_POINTER, -(slot_bytes as i32));
    let incoming = Address::new(abi::FRAME_POINTER, CallFrame::LINKAGE_SIZE as i32);
    assemble(|masm| {
        enter_frame(masm, slot_bytes + convention.shadow_bytes());
        for ((index, argument), &place) in (0..).zip(arguments).zip(&layout.places) {
            match (place, argument.representation()) {
                (Place::Fpr(register), Representation::Float(width)) => {
                    masm.move_float_to_bits(width, VALUE, register);
                }
                (Place::Gpr(register), integer) => normalize(masm, integer, VALUE, register),
                (Place::Stack(offset), representation) => {
                    let size = representation.size().expect("an argument");
                    masm.load(size, VALUE, incoming.plus(offset as i32));
                    if !matches!(representation, Representation::Float(_)) {
                        normalize(masm, representation, VALUE, VALUE);
                    }
                }
                (Place::Fpr(_), _) => unreachable!(),
            }
            masm.store64(slots.plus(index * SLOT_SIZE), VALUE);
        }
        let [context, first_slot] = convention.first_two_gprs();
        masm.move64(context, TEMPORARY);
        masm.compute_address(first_slot, slots);
        masm.call_indirect(Address::new(context, 0));
        if let Representation::Float(width) = result.representation() {
            masm.move_bits_to_float(width, abi::RETURN_FPR, RESULT);
        }
        masm.leave_frame();
        masm.ret();
    })
}
