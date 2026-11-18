//! How a function gives its place on the stack to the function that it calls last.

use bun_engine_asm::prelude::*;

use crate::abi::{Place, Signature, frame};

const CALLER_FRAME: Gpr = abi::SAVED_GPRS[0];
#[cfg(target_arch = "x86_64")]
const RETURN_ADDRESS: Gpr = abi::SAVED_GPRS[1];
#[cfg(target_arch = "aarch64")]
const RETURN_ADDRESS: Gpr = bun_engine_asm::arm64::LR;
const COUNTER: Gpr = abi::NON_ARGUMENT_GPRS[1];
const CHUNK: Fpr = abi::SCRATCH_FPRS[0];
const CHUNK_SIZE: i32 = 16;
const MOST_CHUNKS_IN_LINE: i32 = 8;

/// Leaves all as if the caller of `own` were about to enter `callee`, to which a jump follows.
///
/// The arguments are where they are for a call, at the bottom of the frame. Of the registers that carry none, the
/// pinned ones and [`crate::abi::SLOT`] are kept.
pub fn leave_frame(masm: &mut MacroAssembler, own: &Signature, callee: &Signature) {
    let shift = own.stack_bytes as i32 - callee.stack_bytes as i32;
    let has_arguments_on_stack =
        (callee.params.iter()).any(|place| matches!(place, Place::Stack(_)));
    if shift == 0 && !has_arguments_on_stack {
        return masm.leave_frame();
    }
    let frame_pointer = abi::FRAME_POINTER;
    masm.load_pair64(CALLER_FRAME, RETURN_ADDRESS, Address::new(frame_pointer, 0));
    if has_arguments_on_stack {
        let src = frame::CALLEE_FRAME_FROM_STACK_POINTER + frame::ARGUMENTS;
        move_up(
            masm,
            Address::new(frame_pointer, shift + frame::ARGUMENTS),
            Address::new(abi::STACK_POINTER, src),
            callee.stack_bytes as i32,
        );
    }
    let mut stack_pointer = shift - frame::CALLEE_FRAME_FROM_STACK_POINTER;
    if cfg!(target_arch = "x86_64") {
        stack_pointer -= 8;
        masm.store64(Address::new(frame_pointer, stack_pointer), RETURN_ADDRESS);
    }
    masm.compute_address(
        abi::STACK_POINTER,
        Address::new(frame_pointer, stack_pointer),
    );
    masm.move64(frame_pointer, CALLER_FRAME);
}

/// From the top down, as the two may overlap.
fn move_up(masm: &mut MacroAssembler, dst: Address, src: Address, size: i32) {
    if size <= MOST_CHUNKS_IN_LINE * CHUNK_SIZE {
        for offset in (0..size).step_by(CHUNK_SIZE as usize).rev() {
            masm.load_vector(CHUNK, src.plus(offset));
            masm.store_vector(dst.plus(offset), CHUNK);
        }
        return;
    }
    let chunk_below_counter = |address: Address| {
        let offset = address.offset() - CHUNK_SIZE;
        Address::indexed(address.base(), COUNTER, Scale::One, offset)
    };
    masm.move32(COUNTER, size);
    let again = masm.here();
    masm.load_vector(CHUNK, chunk_below_counter(src));
    masm.store_vector(chunk_below_counter(dst), CHUNK);
    masm.branch_sub32(ResultCond::NonZero, COUNTER, COUNTER, CHUNK_SIZE, again);
}
