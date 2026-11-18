use core::cell::{Cell, OnceCell};
use core::mem::offset_of;

use bun_engine_exec_memory::{CodeHandle, OutOfExecutableMemory, Owner};
use bun_engine_macros::cell;
use bun_engine_text::names;
use bun_engine_vm::heap::stack::{StackBounds, stack_pointer};
use bun_engine_vm::{
    Attributes, Cx, Gc, GlobalObject, JsCell, JsDestructibleObject, JsObject, JsObjectInit,
    JsResult, Shape, ShapeSpec, TracedMap, TypeFlags, Value, ValueVec, Vm,
};

use crate::convert::{address_to_value, to_c_string};
use crate::signature::link_stub;
use crate::stubs::{Receiver, callback_entry};
use crate::threadsafe::{Dispatch, Mailbox};
use crate::{NativeType, Signature, check_can_generate_code, slot_to_value, value_to_slot};

/// Native code may have their addresses, so a realm keeps them until they are closed.
#[cell(flags = TypeFlags::SHAPE_IS_IMMORTAL)]
pub(crate) struct OpenCallbacks {
    base: JsCell,
    pub(self) by_address: TracedMap<usize, Gc<FfiCallback>>,
}

impl OpenCallbacks {
    pub(crate) fn create(cx: &Cx) -> Gc<JsCell> {
        let base = cx.shape_for::<OpenCallbacks>();
        (cx.allocate::<OpenCallbacks>(OpenCallbacksInit { base })).cell()
    }
}

enum Entry {
    Direct(CodeHandle),
    Threadsafe(&'static Mailbox),
}

/// A function of a script that native code can call.
#[cell(name = "FFICallback", export = "engine_class_FfiCallback")]
pub struct FfiCallback {
    base: JsDestructibleObject,
    /// Its address is the context of a direct entry.
    receiver: Receiver,
    stack: StackBounds,
    signature: &'static Signature,
    global: Gc<GlobalObject>,
    callable: Gc<JsObject>,
    entry: OnceCell<Entry>,
    is_closed: Cell<bool>,
    /// For the caller to read until the next call returns.
    returned_string: Cell<Vec<u8>>,
}

pub(crate) fn link_entry(
    signature: &Signature,
    context: usize,
) -> Result<CodeHandle, OutOfExecutableMemory> {
    let code = callback_entry(context, signature.callback_body()?);
    let name = || format!("FFI callback entry {signature}");
    link_stub(&code, Some(Owner::NATIVE), name)
}

impl FfiCallback {
    pub(crate) fn create_shape(cx: &Cx) -> Gc<Shape> {
        let (prototype, spec) = (cx.object_prototype(), ShapeSpec::of::<FfiCallback>());
        Shape::create(cx, Some(cx.global()), prototype.into(), spec)
    }

    /// With `dispatch` any thread may call it, and gets zero back. Without, only that of the `Vm`.
    ///
    /// # Safety
    /// Whoever gets the address calls it by that signature. Without `dispatch` it does so only until it is closed or its
    /// realm is gone, and only where scripts may run.
    pub unsafe fn create(
        cx: &Cx,
        signature: &'static Signature,
        callable: Gc<JsObject>,
        dispatch: Option<Dispatch>,
    ) -> JsResult<Gc<FfiCallback>> {
        check_can_generate_code(cx)?;
        if dispatch.is_some() && signature.arguments().contains(&NativeType::Value) {
            let message = "bun:ffi: a threadsafe JSCallback cannot take a JavaScript value";
            return Err(cx.throw_type_error(message));
        }
        let callback = cx.allocate::<FfiCallback>(FfiCallbackInit {
            base: JsObjectInit::new(cx, cx.ffi_callback_shape()),
            receiver: receive,
            stack: cx.stack_bounds(),
            signature,
            global: cx.global(),
            callable,
            entry: OnceCell::new(),
            is_closed: Cell::new(false),
            returned_string: Cell::default(),
        });
        let is_threadsafe = dispatch.is_some();
        let entry = match dispatch {
            Some(dispatch) => Mailbox::open(cx, callback, dispatch).map(Entry::Threadsafe),
            None => {
                let context = callback.address() + offset_of!(FfiCallback, receiver);
                link_entry(signature, context).map(Entry::Direct)
            }
        };
        let entry = entry.map_err(|_| cx.throw_out_of_memory())?;
        let _ = callback.entry.set(entry);
        let address = address_to_value(cx, callback.entry().unwrap_or_default() as u64);
        callback.put_direct(cx, names::ptr, address, Attributes::CONSTANT);
        let is_threadsafe = is_threadsafe.into();
        callback.put_direct(cx, names::threadsafe, is_threadsafe, Attributes::CONSTANT);
        let open = cx.open_ffi_callbacks().cast::<OpenCallbacks>();
        open.by_address().insert(callback.address(), callback);
        Ok(callback)
    }

    pub(crate) fn signature(&self) -> &'static Signature {
        self.signature
    }

    pub(crate) fn global(&self) -> Gc<GlobalObject> {
        self.global
    }

    /// The address to call, unless it is closed.
    pub fn entry(&self) -> Option<usize> {
        match self.entry.get().filter(|_| !self.is_closed.get())? {
            Entry::Direct(code) => Some(code.start()),
            Entry::Threadsafe(mailbox) => Some(mailbox.entry()),
        }
    }

    /// Calls that are on their way from other threads are still made.
    pub fn close(&self, vm: &Vm) {
        if self.is_closed.replace(true) {
            return;
        }
        if let Some(Entry::Threadsafe(mailbox)) = self.entry.get() {
            mailbox.close();
        }
        let open = self.global.open_ffi_callbacks(vm).cast::<OpenCallbacks>();
        open.by_address().remove(&self.address());
        self.put_direct(vm, names::ptr, Value::NULL, Attributes::CONSTANT);
    }

    pub(crate) fn call(&self, cx: &mut Cx, arguments: &[Value]) -> JsResult<Value> {
        cx.call(self.callable.into(), Value::UNDEFINED, arguments)
    }

    /// # Safety
    /// As for `slot_to_value`, with a slot for each argument.
    unsafe fn call_with_slots(&self, cx: &mut Cx, slots: &[u64]) -> JsResult<u64> {
        let mut arguments = ValueVec::new();
        for (&argument, &slot) in self.signature.arguments().iter().zip(slots) {
            // SAFETY: the caller's.
            arguments.push(unsafe { slot_to_value(cx, argument, slot) }?);
        }
        let result = self.call(cx, &arguments)?;
        match (self.signature.result(), result.as_string()) {
            (NativeType::CString, Some(string)) => {
                let mut bytes = cx.or_out_of_memory(to_c_string(string.view(cx)?.text()))?;
                let address = bytes.as_mut_ptr().expose_provenance();
                self.returned_string.set(bytes);
                Ok(address as u64)
            }
            (result_type, _) => value_to_slot(cx, result_type, result, None),
        }
    }
}

/// What is thrown waits for the script that has called the native code, if any.
unsafe extern "C" fn receive(context: usize, slots: *const u64) -> u64 {
    // SAFETY: the promise of the maker of the callback.
    unsafe {
        let callback = Gc::<FfiCallback>::from_address(context - offset_of!(FfiCallback, receiver));
        assert!(
            callback.stack.contains(stack_pointer()),
            "bun:ffi: a JSCallback that is not threadsafe was called from another thread"
        );
        let cx = Cx::from_global(callback.global);
        if cx.has_exception() {
            return 0;
        }
        let slots = core::slice::from_raw_parts(slots, callback.signature.arguments().len());
        let result = callback.call_with_slots(cx, slots);
        if result.is_err()
            && !cx.is_entered()
            && !cx.has_pending_termination_exception()
            && let Some(exception) = cx.clear_exception()
        {
            (callback.global.hooks().report_uncaught_exception)(cx, exception);
        }
        callback.keep_alive();
        result.unwrap_or(0)
    }
}
