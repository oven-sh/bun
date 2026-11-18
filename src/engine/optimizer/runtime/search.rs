//! Properties that are not in the first place where the code looks.

use core::ptr::NonNull;

use bun_engine_macros::native_abi;
use bun_engine_text::{PropertyName, StringImpl};
use bun_engine_vm::caches::{get_quietly, put_quietly};
use bun_engine_vm::{CallFrame, Cx, Gc, JsObject, PutContext, Value, Vm};

#[repr(C, align(16))]
pub(crate) struct Searched {
    pub(crate) object: Gc<JsObject>,
    pub(crate) name: NonNull<StringImpl>,
    /// These are only for a store.
    pub(crate) value: u64,
    pub(crate) is_fixed: u32,
}

impl Searched {
    fn name(&self) -> PropertyName<'_> {
        // SAFETY: the code keeps it alive.
        unsafe { PropertyName::from_raw(self.name) }
    }
}

#[native_abi]
pub(super) fn load(vm: &Vm, searched: &Searched) -> Option<Value> {
    get_quietly(vm, &searched.object, searched.name())
}

/// The address of the slot.
#[native_abi]
pub(super) unsafe fn store(_: &Vm, searched: &Searched, frame: &CallFrame) -> usize {
    let code_block = frame.code_block().expect("a frame of optimized code");
    // SAFETY: generated code runs inside a call that has the `Cx`, and it has put a value there.
    let (cx, value) = unsafe {
        let cx = Cx::from_global(code_block.global());
        (cx, Value::from_bits(searched.value))
    };
    let context = match searched.is_fixed {
        0 => PutContext::Unknown,
        _ => PutContext::PutById,
    };
    put_quietly(cx, searched.object, searched.name(), value, context).unwrap_or(0)
}
