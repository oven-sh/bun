// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use bun_collections::ArrayHashMap;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, Strong, Subprocess};
use bun_str::{String as BunString, ZigString};

bun_output::declare_scope!(IPC, visible);

// TODO(port): move to runtime_sys
unsafe extern "C" {
    pub fn Bun__Process__queueNextTick1(global: *mut JSGlobalObject, f: JSValue, arg: JSValue);
    pub fn Process__emitErrorEvent(global: *mut JSGlobalObject, value: JSValue);
}

// TODO(port): `pub var` mutable global with !Sync fields (Strong). Only ever accessed on the
// JS thread. Phase B: wrap in a JS-thread-local cell or assert const-init of fields.
pub static mut CHILD_SINGLETON: InternalMsgHolder = InternalMsgHolder {
    seq: 0,
    callbacks: ArrayHashMap::new(),
    worker: Strong::EMPTY,
    cb: Strong::EMPTY,
    messages: Vec::new(),
};

#[inline]
fn child_singleton() -> &'static mut InternalMsgHolder {
    // SAFETY: only called on the single JS thread; mirrors Zig `pub var` access.
    // TODO(port): static mut reference — replace with proper single-thread cell in Phase B.
    unsafe { &mut *core::ptr::addr_of_mut!(CHILD_SINGLETON) }
}

#[bun_jsc::host_fn]
pub fn send_helper_child(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperChild");

    let arguments = frame.arguments_old(3).ptr;
    let message = arguments[0];
    let handle = arguments[1];
    let callback = arguments[2];

    let vm = global.bun_vm();

    if vm.ipc.is_none() {
        return Ok(JSValue::FALSE);
    }
    if message.is_undefined() {
        return global.throw_missing_arguments_value(&["message"]);
    }
    if !handle.is_null() {
        return global.throw("passing 'handle' not implemented yet", format_args!(""));
    }
    if !message.is_object() {
        return global.throw_invalid_argument_type_value("message", "object", message);
    }
    let singleton = child_singleton();
    if callback.is_function() {
        // TODO: remove this strong. This is expensive and would be an easy way to create a memory leak.
        // These sequence numbers shouldn't exist from JavaScript's perspective at all.
        singleton
            .callbacks
            .put(singleton.seq, Strong::create(callback, global));
    }

    // sequence number for InternalMsgHolder
    message.put(
        global,
        ZigString::static_str("seq"),
        JSValue::js_number(singleton.seq),
    );
    singleton.seq = singleton.seq.wrapping_add(1);

    // similar code as Bun__Process__send
    let formatter = bun_jsc::ConsoleObject::Formatter { global_this: global };
    if cfg!(debug_assertions) {
        bun_output::scoped_log!(IPC, "child: {}", message.to_fmt(&formatter));
    }

    let ipc_instance = vm.get_ipc_instance().unwrap();

    #[bun_jsc::host_fn]
    fn impl_(global_: &JSGlobalObject, frame_: &CallFrame) -> JsResult<JSValue> {
        let arguments_ = frame_.arguments_old(1).slice();
        let ex = arguments_[0];
        // SAFETY: FFI call into C++; global pointer is valid for the call.
        unsafe {
            Process__emitErrorEvent(
                global_ as *const _ as *mut JSGlobalObject,
                ex.to_error().unwrap_or(ex),
            );
        }
        Ok(JSValue::UNDEFINED)
    }

    let good = ipc_instance
        .data
        .serialize_and_send(global, message, .internal, JSValue::NULL, None);
    // TODO(port): `.internal` is an enum-literal arg to serialize_and_send — replace with the
    // concrete IPC message-kind enum once ported.

    if good == .failure {
        // TODO(port): `.failure` / `.success` are enum-literal results of serialize_and_send.
        let ex = global.create_type_error_instance("sendInternal() failed", format_args!(""));
        ex.put(
            global,
            ZigString::static_str("syscall"),
            BunString::static_str("write").to_js(global)?,
        );
        let fnvalue = bun_jsc::JSFunction::create(global, "", impl_, 1, ());
        fnvalue.call_next_tick(global, &[ex])?;
        return Ok(JSValue::FALSE);
    }

    Ok(if good == .success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub fn on_internal_message_child(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "onInternalMessageChild");
    let arguments = frame.arguments_old(2).ptr;
    let singleton = child_singleton();
    // TODO: we should not create two jsc.Strong.Optional here. If absolutely necessary, a single Array. should be all we use.
    singleton.worker = Strong::create(arguments[0], global);
    singleton.cb = Strong::create(arguments[1], global);
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
    pub callbacks: ArrayHashMap<i32, Strong>,
    pub worker: Strong,
    pub cb: Strong,
    pub messages: Vec<Strong>,
}

impl Default for InternalMsgHolder {
    fn default() -> Self {
        Self {
            seq: 0,
            callbacks: ArrayHashMap::default(),
            worker: Strong::EMPTY,
            cb: Strong::EMPTY,
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
        self.messages.push(Strong::create(message, global));
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

        let event_loop = global.bun_vm().event_loop();

        if let Some(p) = message.get(global, "ack")? {
            if !p.is_undefined() {
                let ack = p.to_int32();
                // PORT NOTE: reshaped for borrowck — Zig copied the Strong out of the entry,
                // then conditionally deinit+swapRemove. Here we peek then swap_remove.
                if let Some(cbstrong_ref) = self.callbacks.get(&ack) {
                    if let Some(callback) = cbstrong_ref.get() {
                        let _cbstrong = self.callbacks.swap_remove(&ack);
                        // _cbstrong drops at end of scope (== `defer cbstrong.deinit()`)
                        event_loop.run_callback(
                            callback,
                            global,
                            self.worker.get().unwrap(),
                            &[
                                message,
                                JSValue::NULL, // handle
                            ],
                        );
                        return Ok(());
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

    let arguments = frame.arguments_old(4).ptr;
    let subprocess = arguments[0].as_::<Subprocess>().unwrap();
    let message = arguments[1];
    let handle = arguments[2];
    let callback = arguments[3];

    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(JSValue::FALSE);
    };

    if message.is_undefined() {
        return global.throw_missing_arguments_value(&["message"]);
    }
    if !message.is_object() {
        return global.throw_invalid_argument_type_value("message", "object", message);
    }
    if callback.is_function() {
        ipc_data.internal_msg_queue.callbacks.put(
            ipc_data.internal_msg_queue.seq,
            Strong::create(callback, global),
        );
    }

    // sequence number for InternalMsgHolder
    message.put(
        global,
        ZigString::static_str("seq"),
        JSValue::js_number(ipc_data.internal_msg_queue.seq),
    );
    ipc_data.internal_msg_queue.seq = ipc_data.internal_msg_queue.seq.wrapping_add(1);

    // similar code as bun.jsc.Subprocess.doSend
    let formatter = bun_jsc::ConsoleObject::Formatter { global_this: global };
    if cfg!(debug_assertions) {
        bun_output::scoped_log!(IPC, "primary: {}", message.to_fmt(&formatter));
    }

    let _ = handle;
    let success = ipc_data.serialize_and_send(global, message, .internal, JSValue::NULL, None);
    // TODO(port): `.internal` / `.success` enum literals — see note in send_helper_child.
    Ok(if success == .success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub fn on_internal_message_primary(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(3).ptr;
    let subprocess = arguments[0].as_::<Subprocess>().unwrap();
    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(JSValue::UNDEFINED);
    };
    // TODO: remove these strongs.
    ipc_data.internal_msg_queue.worker = Strong::create(arguments[1], global);
    ipc_data.internal_msg_queue.cb = Strong::create(arguments[2], global);
    Ok(JSValue::UNDEFINED)
}

pub fn handle_internal_message_primary(
    global: &JSGlobalObject,
    subprocess: &mut Subprocess,
    message: JSValue,
) -> JsResult<()> {
    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(());
    };

    let event_loop = global.bun_vm().event_loop();

    // TODO: investigate if "ack" and "seq" are observable and if they're not, remove them entirely.
    if let Some(p) = message.get(global, "ack")? {
        if !p.is_undefined() {
            let ack = p.to_int32();
            // PORT NOTE: reshaped for borrowck — swap_remove returns the owned Strong.
            if let Some(cbstrong) = ipc_data.internal_msg_queue.callbacks.swap_remove(&ack) {
                let cb = cbstrong.get().unwrap();
                event_loop.run_callback(
                    cb,
                    global,
                    ipc_data.internal_msg_queue.worker.get().unwrap(),
                    &[
                        message,
                        JSValue::NULL, // handle
                    ],
                );
                // cbstrong drops here (== `defer cbstrong.deinit()`)
                return Ok(());
            }
        }
    }
    let cb = ipc_data.internal_msg_queue.cb.get().unwrap();
    event_loop.run_callback(
        cb,
        global,
        ipc_data.internal_msg_queue.worker.get().unwrap(),
        &[
            message,
            JSValue::NULL, // handle
        ],
    );
    Ok(())
}

//
//
//

#[bun_jsc::host_fn]
pub fn set_ref(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old(1).ptr;

    if arguments.len() == 0 {
        return global.throw_missing_arguments_value(&["enabled"]);
    }
    if !arguments[0].is_boolean() {
        return global.throw_invalid_argument_type_value("enabled", "boolean", arguments[0]);
    }

    let enabled = arguments[0].to_boolean();
    let vm = global.bun_vm();
    vm.channel_ref_overridden = true;
    if enabled {
        vm.channel_ref.ref_(vm);
    } else {
        vm.channel_ref.unref(vm);
    }
    Ok(JSValue::UNDEFINED)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__refChannelUnlessOverridden(global: *mut JSGlobalObject) {
    // SAFETY: caller (C++) passes a valid JSGlobalObject pointer.
    let global = unsafe { &*global };
    let vm = global.bun_vm();
    if !vm.channel_ref_overridden {
        vm.channel_ref.ref_(vm);
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__unrefChannelUnlessOverridden(global: *mut JSGlobalObject) {
    // SAFETY: caller (C++) passes a valid JSGlobalObject pointer.
    let global = unsafe { &*global };
    let vm = global.bun_vm();
    if !vm.channel_ref_overridden {
        vm.channel_ref.unref(vm);
    }
}

#[bun_jsc::host_fn]
pub fn channel_ignore_one_disconnect_event_listener(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global.bun_vm();
    vm.channel_ref_should_ignore_one_disconnect_event_listener = true;
    Ok(JSValue::FALSE)
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__shouldIgnoreOneDisconnectEventListener(global: *mut JSGlobalObject) -> bool {
    // SAFETY: caller (C++) passes a valid JSGlobalObject pointer.
    let global = unsafe { &*global };
    let vm = global.bun_vm();
    vm.channel_ref_should_ignore_one_disconnect_event_listener
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/node/node_cluster_binding.zig (304 lines)
//   confidence: medium
//   todos:      7
//   notes:      static mut CHILD_SINGLETON needs JS-thread cell; serialize_and_send result/kind enum literals (.internal/.success/.failure) need concrete types from IPC port
// ──────────────────────────────────────────────────────────────────────────
