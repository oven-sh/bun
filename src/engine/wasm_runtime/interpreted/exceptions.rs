//! Throwing and catching.

use core::cell::Cell;
use core::{ptr, slice};

use bun_engine_wasm_compiler::abi::Trap;
use bun_engine_wasm_format::TagIndex;

use super::Context;
use crate::outcome::{Decoded, Failure};
use crate::tag::Tag;
use crate::value::{HostCell, Reference};

impl Context<'_> {
    pub fn payload_slots(&self, tag: TagIndex) -> usize {
        self.instance.tag(tag).payload_size() as usize / size_of::<u64>()
    }

    /// For [`Context::throw`].
    pub fn new_exception(&self, tag: TagIndex, payload: &[Cell<u64>]) -> Failure {
        assert!(payload.len() == self.payload_slots(tag));
        let (first, size) = (payload.as_ptr().cast(), size_of_val(payload));
        // SAFETY: a payload is laid out like slots.
        let exception = unsafe {
            let fill = |place| ptr::copy_nonoverlapping(first, place, size);
            self.instance.new_exception(tag, fill)
        };
        exception.map_or(
            const { Failure::trap(Trap::OutOfMemory) },
            Failure::exception,
        )
    }

    /// The same, for an `exnref`.
    pub fn existing_exception(&self, exception: u64) -> Failure {
        let exception = Reference(exception).cell();
        exception.map_or(
            const { Failure::trap(Trap::NullExnref) },
            Failure::exception,
        )
    }

    /// Where the failure arises, in a frame for no function. The result is an exception if a frame catches it.
    /// Otherwise the host has it.
    pub fn throw(&self, failure: Failure, is_caught: impl Fn(&Tag) -> bool) -> Failure {
        let (instance, host) = (self.instance, self.instance.engine().host());
        // SAFETY: inside the call of an entry, with an `exnref`.
        unsafe {
            match failure.decode() {
                Decoded::Exception(exception) if is_caught(self.tag_of(exception)) => {
                    let goes_on = host.will_catch(instance, exception);
                    goes_on.map_or(Failure::THROWN, |()| failure)
                }
                Decoded::Exception(exception) => {
                    host.throw(instance, exception);
                    Failure::THROWN
                }
                Decoded::Pending => (host.take_exception(instance, &is_caught))
                    .map_or(Failure::THROWN, Failure::exception),
                _ => failure,
            }
        }
    }

    pub fn tag_of(&self, exception: HostCell) -> &Tag {
        // SAFETY: from a failure.
        unsafe { self.instance.engine().tag_of(exception) }
    }

    pub fn is_tag(&self, index: TagIndex, tag: &Tag) -> bool {
        self.instance.tag(index).identity() == tag.identity()
    }

    pub fn payload(&self, exception: u64) -> &[u64] {
        let exception = Reference(exception).cell().expect("what is caught");
        let first = exception.field(self.instance.engine().layout().exception_payload);
        let count = self.tag_of(exception).payload_size() as usize / size_of::<u64>();
        // SAFETY: it does not change.
        unsafe { slice::from_raw_parts(first, count) }
    }
}
