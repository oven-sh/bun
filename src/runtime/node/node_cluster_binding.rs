// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use bun_collections::ArrayHashMap;
use bun_jsc::ipc::{IsInternal, SerializeAndSendResult};
use bun_jsc::{CallFrame, ErrorCode, JSGlobalObject, JSValue, JsError, JsResult, StringJsc, StrongOptional};
use bun_str::String as BunString;

use crate::api::bun::subprocess::Subprocess;

// ──────────────────────────────────────────────────────────────────────────
// Local shim — `throw_missing_arguments_value` lives in the gated
// `bun_jsc/JSGlobalObject.rs` impl, not on the `lib.rs` surface this crate
// links against. Re-implement the single-arg case (only shape used here)
// against the public `err()`/`throw()` API.
// TODO(port): drop once `bun_jsc::JSGlobalObject` un-gates this.
// ──────────────────────────────────────────────────────────────────────────
trait JSGlobalObjectClusterExt {
    fn throw_missing_arguments_value(&self, arg_names: &[&str]) -> JsError;
}

impl JSGlobalObjectClusterExt for JSGlobalObject {
    #[inline]
    fn throw_missing_arguments_value(&self, arg_names: &[&str]) -> JsError {
        debug_assert_eq!(arg_names.len(), 1);
        self.err(
            ErrorCode::MISSING_ARGS,
            format_args!("The \"{}\" argument must be specified", arg_names[0]),
        )
        .throw()
    }
}

bun_output::declare_scope!(IPC, visible);

// TODO(port): move to runtime_sys
unsafe extern "C" {
    pub fn Bun__Process__queueNextTick1(global: *mut JSGlobalObject, f: JSValue, arg: JSValue);
    pub fn Process__emitErrorEvent(global: *const JSGlobalObject, value: JSValue);
}

// TODO(port): `pub var` mutable global with !Sync fields (Strong). Only ever accessed on the
// JS thread. Phase B: wrap in a JS-thread-local cell or assert const-init of fields.
// PORT NOTE: ArrayHashMap::new() is not const, so the global is lazily seeded on first
// access via `child_singleton()`.
pub static mut CHILD_SINGLETON: Option<InternalMsgHolder> = None;

#[inline]
fn child_singleton() -> &'static mut InternalMsgHolder {
    // SAFETY: only called on the single JS thread; mirrors Zig `pub var` access.
    // TODO(port): static mut reference — replace with proper single-thread cell in Phase B.
    unsafe { (*core::ptr::addr_of_mut!(CHILD_SINGLETON)).get_or_insert_with(Default::default) }
}

/// JS-thread `EventLoopCtx` for `KeepAlive::ref_/unref`. Zig passed the
/// `*VirtualMachine` directly (anytype dispatch); the Rust split routes through
/// the aio hook registered by `crate::init()`.
#[inline]
fn vm_ctx() -> bun_aio::EventLoopCtx {
    bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
}

#[bun_jsc::host_fn]
pub fn send_helper_child(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperChild");

    let arguments = frame.arguments_old::<3>().ptr;
    let message = arguments[0];
    let handle = arguments[1];
    let callback = arguments[2];

    let vm = global.bun_vm();
    // SAFETY: `bun_vm()` never returns null for a Bun-owned global; sole &mut on JS thread.
    let vm = unsafe { &mut *vm };

    if vm.ipc.is_none() {
        return Ok(JSValue::FALSE);
    }
    if message.is_undefined() {
        return Err(global.throw_missing_arguments_value(&["message"]));
    }
    if !handle.is_null() {
        return Err(global.throw("passing 'handle' not implemented yet"));
    }
    if !message.is_object() {
        return Err(global.throw_invalid_argument_type_value("message", "object", message));
    }
    let singleton = child_singleton();
    if callback.is_function() {
        // TODO: remove this strong. This is expensive and would be an easy way to create a memory leak.
        // These sequence numbers shouldn't exist from JavaScript's perspective at all.
        let _ = singleton
            .callbacks
            .put(singleton.seq, StrongOptional::create(callback, global));
    }

    // sequence number for InternalMsgHolder
    message.put(global, b"seq", JSValue::js_number(singleton.seq as f64));
    singleton.seq = singleton.seq.wrapping_add(1);

    // similar code as Bun__Process__send
    #[cfg(debug_assertions)]
    {
        let mut formatter = bun_jsc::console_object::Formatter::new(global);
        bun_output::scoped_log!(
            IPC,
            "child: {}",
            bun_jsc::console_object::formatter::ZigFormatter::new(&mut formatter, message)
        );
    }

    let ipc_instance = vm.get_ipc_instance().unwrap();
    // SAFETY: `get_ipc_instance` returns a live owned IPCInstance pointer; sole &mut on JS thread.
    let ipc_instance = unsafe { &mut *ipc_instance };

    #[bun_jsc::host_fn]
    fn impl_(global_: &JSGlobalObject, frame_: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame_.arguments_old::<1>();
        let arguments_ = arguments_.slice();
        let ex = arguments_[0];
        // SAFETY: FFI call into C++; `global_` is a live JSGlobalObject* for the duration
        // of the call. Passed as `*const` — mutation happens behind the FFI boundary, so
        // no Rust `&mut` is ever materialized (matches ipc.rs / JSValue.rs convention).
        unsafe {
            Process__emitErrorEvent(global_, ex.to_error().unwrap_or(ex));
        }
        Ok(JSValue::UNDEFINED)
    }

    let good = ipc_instance
        .data
        .serialize_and_send(global, message, IsInternal::Internal, JSValue::NULL, None);

    if good == SerializeAndSendResult::Failure {
        let ex = global.create_type_error_instance("sendInternal() failed");
        ex.put(
            global,
            b"syscall",
            BunString::static_str("write").to_js(global)?,
        );
        let fnvalue =
            bun_jsc::JSFunction::create(global, "", __jsc_host_impl_, 1, Default::default());
        JSValue::call_next_tick_1(fnvalue, global, ex)?;
        return Ok(JSValue::FALSE);
    }

    Ok(if good == SerializeAndSendResult::Success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub fn on_internal_message_child(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "onInternalMessageChild");
    let arguments = frame.arguments_old::<2>().ptr;
    let singleton = child_singleton();
    // TODO: we should not create two jsc.Strong.Optional here. If absolutely necessary, a single Array. should be all we use.
    singleton.worker = StrongOptional::create(arguments[0], global);
    singleton.cb = StrongOptional::create(arguments[1], global);
    singleton.flush(global)?;
    Ok(JSValue::UNDEFINED)
}

pub fn handle_internal_message_child(global: &JSGlobalObject, message: JSValue) -> JsResult<()> {
    bun_output::scoped_log!(IPC, "handleInternalMessageChild");

    child_singleton().dispatch(message, global)
}

// TODO: rewrite this code.
/// Queue for messages sent between parent and child processes in an IPC environment. node:cluster sends json serialized messages
/// to describe different events it performs. It will send a message with an incrementing sequence number and then call a callback
/// when a message is received with an 'ack' property of the same sequence number.
pub struct InternalMsgHolder {
    pub seq: i32,

    // TODO: move this to an Array or a JS Object or something which doesn't
    // individually create a Strong for every single IPC message...
    pub callbacks: ArrayHashMap<i32, StrongOptional>,
    pub worker: StrongOptional,
    pub cb: StrongOptional,
    pub messages: Vec<StrongOptional>,
}

impl Default for InternalMsgHolder {
    fn default() -> Self {
        Self {
            seq: 0,
            callbacks: ArrayHashMap::default(),
            worker: StrongOptional::empty(),
            cb: StrongOptional::empty(),
            messages: Vec::new(),
        }
    }
}

impl InternalMsgHolder {
    pub fn is_ready(&self) -> bool {
        self.worker.has() && self.cb.has()
    }

    pub fn enqueue(&mut self, message: JSValue, global: &JSGlobalObject) {
        // TODO: .addOne is workaround for .append causing crash/ dependency loop in zig compiler
        // (Rust: just push; the workaround is Zig-specific.)
        self.messages.push(StrongOptional::create(message, global));
    }

    pub fn dispatch(&mut self, message: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        if !self.is_ready() {
            self.enqueue(message, global);
            return Ok(());
        }
        self.dispatch_unsafe(message, global)
    }

    fn dispatch_unsafe(&mut self, message: JSValue, global: &JSGlobalObject) -> JsResult<()> {
        let cb = self.cb.get().unwrap();
        let worker = self.worker.get().unwrap();

        // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
        let event_loop = unsafe { &mut *(*global.bun_vm()).event_loop() };

        if let Some(p) = message.get(global, "ack")? {
            if !p.is_undefined() {
                let ack = p.to_int32();
                // PORT NOTE: reshaped for borrowck — Zig copied the Strong out of the
                // entry, then conditionally deinit+swapRemove. Here we peek the JSValue
                // first (ending the immutable borrow), then swap_remove (which drops the
                // Strong == `defer cbstrong.deinit()`).
                let entry = self.callbacks.get(&ack).map(|s| s.get());
                if let Some(callback_opt) = entry {
                    if let Some(callback) = callback_opt {
                        self.callbacks.swap_remove(&ack);
                        event_loop.run_callback(
                            callback,
                            global,
                            self.worker.get().unwrap(),
                            &[
                                message,
                                JSValue::NULL, // handle
                            ],
                        );
                    }
                    return Ok(());
                }
            }
        }
        event_loop.run_callback(
            cb,
            global,
            worker,
            &[
                message,
                JSValue::NULL, // handle
            ],
        );
        Ok(())
    }

    pub fn flush(&mut self, global: &JSGlobalObject) -> JsResult<()> {
        debug_assert!(self.is_ready());
        let messages = core::mem::take(&mut self.messages);
        for strong in messages {
            if let Some(message) = strong.get() {
                self.dispatch_unsafe(message, global)?;
            }
            // strong drops here (== `strong.deinit()`)
        }
        // messages Vec drops here (== `messages.deinit(bun.default_allocator)`)
        Ok(())
    }

    // `deinit` body only freed owned fields (Strongs, map, Vec). All of those impl Drop in
    // Rust, so no explicit Drop body is needed. The global CHILD_SINGLETON is reset by
    // assigning `Default::default()` at the call site that previously called `.deinit()`.
    // TODO(port): verify call sites of `child_singleton.deinit()` and replace with reset.
}

#[bun_jsc::host_fn]
pub fn send_helper_primary(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperPrimary");

    let arguments = frame.arguments_old::<4>().ptr;
    let subprocess = arguments[0].as_::<Subprocess<'_>>().unwrap();
    // SAFETY: `as_` returns a live wrapped pointer; sole &mut on JS thread.
    let subprocess = unsafe { &mut *subprocess };
    let message = arguments[1];
    let handle = arguments[2];
    let callback = arguments[3];

    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(JSValue::FALSE);
    };

    if message.is_undefined() {
        return Err(global.throw_missing_arguments_value(&["message"]));
    }
    if !message.is_object() {
        return Err(global.throw_invalid_argument_type_value("message", "object", message));
    }
    if callback.is_function() {
        // TODO(port): blocked — `SendQueue.internal_msg_queue` is an opaque
        // `[usize; 6]` placeholder in `bun_jsc::ipc`; field access (callbacks/seq)
        // requires the real struct to land upstream.
        let _ = callback;
        todo!("blocked_on: bun_jsc::ipc::InternalMsgHolder fields");
    }

    // sequence number for InternalMsgHolder
    // TODO(port): blocked — see above (`internal_msg_queue.seq`).
    message.put(global, b"seq", JSValue::js_number(0.0));

    // similar code as bun.jsc.Subprocess.doSend
    #[cfg(debug_assertions)]
    {
        let mut formatter = bun_jsc::console_object::Formatter::new(global);
        bun_output::scoped_log!(
            IPC,
            "primary: {}",
            bun_jsc::console_object::formatter::ZigFormatter::new(&mut formatter, message)
        );
    }

    let _ = handle;
    let success = ipc_data.serialize_and_send(global, message, IsInternal::Internal, JSValue::NULL, None);
    Ok(if success == SerializeAndSendResult::Success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub fn on_internal_message_primary(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<3>().ptr;
    let subprocess = arguments[0].as_::<Subprocess<'_>>().unwrap();
    // SAFETY: `as_` returns a live wrapped pointer; sole &mut on JS thread.
    let subprocess = unsafe { &mut *subprocess };
    let Some(_ipc_data) = subprocess.ipc() else {
        return Ok(JSValue::UNDEFINED);
    };
    // TODO: remove these strongs.
    // TODO(port): blocked — `SendQueue.internal_msg_queue` is opaque in bun_jsc::ipc.
    let _ = (arguments[1], arguments[2], global);
    todo!("blocked_on: bun_jsc::ipc::InternalMsgHolder fields");
}

pub fn handle_internal_message_primary(
    global: &JSGlobalObject,
    subprocess: &mut Subprocess<'_>,
    message: JSValue,
) -> JsResult<()> {
    let Some(_ipc_data) = subprocess.ipc() else {
        return Ok(());
    };

    // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
    let _event_loop = unsafe { &mut *(*global.bun_vm()).event_loop() };

    // TODO: investigate if "ack" and "seq" are observable and if they're not, remove them entirely.
    // TODO(port): blocked — `SendQueue.internal_msg_queue` is opaque in bun_jsc::ipc;
    // callbacks/worker/cb field access requires the real struct upstream.
    let _ = message;
    todo!("blocked_on: bun_jsc::ipc::InternalMsgHolder fields");
}

//
//
//

#[bun_jsc::host_fn]
pub fn set_ref(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>().ptr;

    if arguments.len() == 0 {
        return Err(global.throw_missing_arguments_value(&["enabled"]));
    }
    if !arguments[0].is_boolean() {
        return Err(global.throw_invalid_argument_type_value("enabled", "boolean", arguments[0]));
    }

    let enabled = arguments[0].to_boolean();
    // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
    let vm = unsafe { &mut *global.bun_vm() };
    vm.channel_ref_overridden = true;
    if enabled {
        vm.channel_ref.ref_(vm_ctx());
    } else {
        vm.channel_ref.unref(vm_ctx());
    }
    Ok(JSValue::UNDEFINED)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__refChannelUnlessOverridden(global: *mut JSGlobalObject) {
    // SAFETY: caller (C++) passes a valid JSGlobalObject pointer.
    let global = unsafe { &*global };
    // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
    let vm = unsafe { &mut *global.bun_vm() };
    if !vm.channel_ref_overridden {
        vm.channel_ref.ref_(vm_ctx());
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__unrefChannelUnlessOverridden(global: *mut JSGlobalObject) {
    // SAFETY: caller (C++) passes a valid JSGlobalObject pointer.
    let global = unsafe { &*global };
    // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
    let vm = unsafe { &mut *global.bun_vm() };
    if !vm.channel_ref_overridden {
        vm.channel_ref.unref(vm_ctx());
    }
}

#[bun_jsc::host_fn]
pub fn channel_ignore_one_disconnect_event_listener(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
    let vm = unsafe { &mut *global.bun_vm() };
    vm.channel_ref_should_ignore_one_disconnect_event_listener = true;
    Ok(JSValue::FALSE)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__shouldIgnoreOneDisconnectEventListener(global: *mut JSGlobalObject) -> bool {
    // SAFETY: caller (C++) passes a valid JSGlobalObject pointer.
    let global = unsafe { &*global };
    // SAFETY: `bun_vm()` never returns null; sole &mut on JS thread.
    let vm = unsafe { &*global.bun_vm() };
    vm.channel_ref_should_ignore_one_disconnect_event_listener
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_cluster_binding.zig (304 lines)
//   confidence: medium
//   todos:      7
//   notes:      static mut CHILD_SINGLETON needs JS-thread cell
// ──────────────────────────────────────────────────────────────────────────
