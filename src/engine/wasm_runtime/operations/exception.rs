use core::ptr;

use bun_engine_macros::native_abi;
use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::TagIndex;

use crate::instance::Instance;
use crate::outcome::{Failure, Outcome};
use crate::value::Reference;

#[native_abi]
pub(super) unsafe fn throw(instance: &Instance, tag: TagIndex, payload: *const u8) -> Outcome {
    let size = instance.tag(tag).payload_size() as usize;
    // SAFETY: compiled code laid out the payload for the tag, for which there is room.
    let exception = unsafe {
        instance.new_exception(tag, |place| ptr::copy_nonoverlapping(payload, place, size))
    };
    Outcome::failure(exception.map_or(
        const { Failure::trap(Trap::OutOfMemory) },
        Failure::exception,
    ))
}

#[native_abi]
pub(super) unsafe fn throw_ref(_: &Instance, exception: Reference) -> Outcome {
    Outcome::failure((exception.cell()).map_or(
        const { Failure::trap(Trap::NullExnref) },
        Failure::exception,
    ))
}
