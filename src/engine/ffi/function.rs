use core::mem::offset_of;

use bun_engine_bytecode::{Specialization, Visibility};
use bun_engine_macros::{cell, native_abi};
use bun_engine_text::{StringRef, names};
use bun_engine_vm::call::native_not_a_constructor;
use bun_engine_vm::{
    Attributes, CallFrame, Cx, Gc, Intrinsic, JsFunction, JsObject, JsResult, NativeExecutable,
    Shape, ShapeSpec, Value, options,
};

use crate::convert::{address_to_value, buffer_to_slot};
use crate::stubs::Invoker;
use crate::{
    CStrings, Signature, check_can_generate_code, slot_to_value, throw_no_room_for_code,
    value_to_slot,
};

/// Calls native code. Neither the signature nor the target changes.
#[cell(name = "Function")]
pub struct FfiFunction {
    base: JsFunction,
    target: usize,
    signature: &'static Signature,
    /// What keeps the code in memory.
    owner: Option<Gc<JsObject>>,
}

impl FfiFunction {
    pub const OFFSET_OF_TARGET: usize = offset_of!(FfiFunction, target);

    pub(crate) fn create_shape(cx: &Cx) -> Gc<Shape> {
        let (prototype, spec) = (cx.function_prototype(), ShapeSpec::of::<FfiFunction>());
        Shape::create(cx, Some(cx.global()), prototype.into(), spec)
    }

    /// # Safety
    /// For as long as `owner` lives, `target` is the address of a C function of that signature, to which scripts are
    /// trusted to pass what it expects.
    pub unsafe fn create(
        cx: &Cx,
        signature: &'static Signature,
        target: usize,
        name: StringRef,
        owner: Option<Gc<JsObject>>,
    ) -> JsResult<Gc<FfiFunction>> {
        check_can_generate_code(cx)?;
        let executable = NativeExecutable::create(
            cx,
            signature.arguments().len() as u32,
            name,
            call,
            native_not_a_constructor,
            Intrinsic::FfiFunction,
            Visibility::Public,
        );
        if options().use_ffi_call_entries
            && let Ok(entry) = signature.call_entry()
        {
            // SAFETY: only the function below has the executable.
            unsafe { executable.install(Specialization::Call, entry, None) };
        }
        let function = cx.allocate::<FfiFunction>(FfiFunctionInit {
            base: JsFunction::native_init(cx, cx.ffi_function_shape(), executable),
            target,
            signature,
            owner,
        });
        let address = address_to_value(cx, target as u64);
        function.put_direct(cx, names::ptr, address, Attributes::CONSTANT);
        function.put_direct(cx, names::native, function.into(), Attributes::CONSTANT);
        Ok(function)
    }

    pub fn signature(&self) -> &'static Signature {
        self.signature
    }

    pub fn target(&self) -> usize {
        self.target
    }
}

#[native_abi]
pub(crate) fn call(cx: &mut Cx, frame: &CallFrame) -> JsResult<Value> {
    const ROOM_FOR_STRINGS: usize = 256;
    let function = frame.callee().cast::<FfiFunction>();
    let signature = function.signature;
    let (mut slots, mut room) = ([0; Signature::MAX_ARGUMENTS], [0; ROOM_FOR_STRINGS]);
    let mut strings = CStrings::new(&mut room);
    let arguments = || signature.arguments().iter().copied().enumerate();
    for (index, argument) in arguments() {
        slots[index] = value_to_slot(cx, argument, frame.argument(index), Some(&mut strings))?;
    }
    // The last script has run.
    for (index, argument) in arguments() {
        if let Some(slot) = buffer_to_slot(argument, frame.argument(index)) {
            slots[index] = slot;
        }
    }
    let invoker = (signature.invoker()).map_err(|_| throw_no_room_for_code(cx))?;
    // SAFETY: made for the signature, and the promise of the maker of the function.
    unsafe {
        let invoke = core::mem::transmute::<usize, Invoker>(invoker);
        let result = invoke(function.target, slots.as_ptr());
        cx.check_exception()?;
        slot_to_value(cx, signature.result(), result)
    }
}
