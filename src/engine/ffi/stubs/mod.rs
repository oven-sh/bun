//! Machine code for a signature.

#![forbid(unsafe_code)]

mod call_entry;
mod callback;
mod invoker;

use bun_engine_asm::prelude::*;
use bun_engine_asm::{Code, Features, Options};

pub use call_entry::call_entry;
pub use callback::{Receiver, callback_body, callback_entry};
pub use invoker::{Invoker, invoker};

use crate::Representation;

/// Neither carries an argument or has to be kept, whatever the convention.
const VALUE: Gpr = abi::NON_ARGUMENT_GPRS[0];
const TEMPORARY: Gpr = abi::NON_ARGUMENT_GPRS[1];
const RESULT: Gpr = abi::RETURN_GPRS[0];

const SLOT_SIZE: i32 = size_of::<u64>() as i32;

fn assemble(emit: impl FnOnce(&mut MacroAssembler)) -> Code {
    let mut masm = MacroAssembler::new(Options {
        features: Features::host(),
        shorten_jumps: true,
        seed: 0,
    });
    emit(&mut masm);
    masm.finish().expect("a few instructions for each argument")
}

/// With `bytes`, a multiple of 16, below the frame pointer.
fn enter_frame(masm: &mut MacroAssembler, bytes: u32) {
    masm.enter_frame();
    if bytes != 0 {
        masm.sub64(abi::STACK_POINTER, abi::STACK_POINTER, bytes);
    }
}

/// From an integer whose upper bits are unspecified to a slot.
fn normalize(masm: &mut MacroAssembler, representation: Representation, dst: Gpr, src: Gpr) {
    match representation {
        Representation::Integer(Size::S64, _) => masm.move64(dst, src),
        Representation::Integer(size, sign) => masm.extend(size, sign, Width::W64, dst, src),
        Representation::Bool => masm.test32(TestCond::NonZero, dst, src, 0xff),
        Representation::Nothing | Representation::Float(_) => unreachable!(),
    }
}
