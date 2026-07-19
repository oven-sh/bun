// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use bun_core::String as BunString;
use bun_jsc::ipc::{Handle, IsInternal, SerializeAndSendResult};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};

use crate::api::bun::subprocess::{Subprocess, js as subprocess_js};

// Struct moved to `bun_jsc::ipc` (cycle-break per docs/PORTING.md) —
// `SendQueue` stores one inline so it must live at that tier. Re-exported here so
// existing `bun_runtime` paths (`node_cluster_binding::InternalMsgHolder`) keep working.
pub use bun_jsc::ipc::InternalMsgHolder;

bun_output::declare_scope!(IPC, visible);

// `JSGlobalObject` is `#[repr(C)]` with `UnsafeCell<[u8; 0]>` — `&JSGlobalObject`
// is ABI-identical to a non-null pointer with no `readonly`/`noalias`. Both
// shims take only the global plus by-value `JSValue`s, so the validity proof
// lives in the type signature.
unsafe extern "C" {
    pub safe fn Bun__Process__queueNextTick1(global: &JSGlobalObject, f: JSValue, arg: JSValue);
    pub(crate) safe fn Process__emitErrorEvent(global: &JSGlobalObject, value: JSValue);
}

// ArrayHashMap::new() is not const, so the global is lazily seeded on first
// access via `child_singleton()`.
// PORTING.md §Global mutable state: JS-thread-only singleton with `!Sync`
// fields (`Strong`). RacyCell — single-thread access is the contract.
pub(crate) static CHILD_SINGLETON: bun_core::RacyCell<Option<InternalMsgHolder>> =
    bun_core::RacyCell::new(None);

/// `&mut` to the (lazily-initialized) JS-thread singleton.
///
/// Centralises the `RacyCell<Option<_>> → &mut InternalMsgHolder` deref so the
/// three host-fn callers stay safe at the call site (PORTING.md §Global mutable
/// state — same shape as `cron::vm_mut`). Callers must be on the JS thread and
/// must not hold the borrow across a re-entrant `child_singleton()` call.
#[inline]
fn child_singleton<'a>() -> &'a mut InternalMsgHolder {
    // SAFETY: only called on the single JS thread.
    // `RacyCell::get` returns `*mut Option<_>`; the `Option` lives in
    // `'static` storage so the returned `&mut` is valid for any caller-chosen
    // `'a`. Aliasing: each of the three callers borrows for a single
    // statement/block with no nested call to this fn.
    unsafe { (*CHILD_SINGLETON.get()).get_or_insert_with(Default::default) }
}

#[bun_jsc::host_fn]
pub(crate) fn send_helper_child(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperChild");

    let arguments = frame.arguments_old::<3>().ptr;
    let message = arguments[0];
    let handle = arguments[1];
    let callback = arguments[2];

    let vm = global.bun_vm().as_mut();
    // SAFETY: `bun_vm()` never returns null for a Bun-owned global; sole &mut on JS thread.

    if vm.ipc.is_none() {
        return Ok(JSValue::FALSE);
    }
    if message.is_undefined() {
        return Err(global.throw_missing_arguments_value(&["message"]));
    }
    if !handle.is_null() {
        return Err(global.throw(format_args!("passing 'handle' not implemented yet")));
    }
    if !message.is_object() {
        return Err(global.throw_invalid_argument_type_value("message", "object", message));
    }
    let singleton = child_singleton();
    let seq = singleton.seq;
    if callback.is_function() {
        let map = match singleton.callbacks.get() {
            Some(m) => m,
            None => {
                let m = bun_jsc::JSMap::create(global);
                singleton.callbacks.set(global, m);
                m
            }
        };
        InternalMsgHolder::put_callback(map, global, seq, callback)?;
    }

    // sequence number for InternalMsgHolder
    message.put(global, b"seq", JSValue::js_number(seq as f64));
    singleton.seq = seq.wrapping_add(1);

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
        Process__emitErrorEvent(global_, ex.to_error().unwrap_or(ex));
        Ok(JSValue::UNDEFINED)
    }

    let good = ipc_instance.data.serialize_and_send(
        global,
        message,
        IsInternal::Internal,
        JSValue::NULL,
        None,
    );

    if good == SerializeAndSendResult::Failure {
        let ex = global.create_type_error_instance(format_args!("sendInternal() failed"));
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
pub(crate) fn on_internal_message_child(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "onInternalMessageChild");
    let arguments = frame.arguments_old::<2>().ptr;
    let singleton = child_singleton();
    singleton.worker.set(global, arguments[0]);
    singleton.cb.set(global, arguments[1]);
    singleton.flush(global)?;
    Ok(JSValue::UNDEFINED)
}

pub(crate) fn handle_internal_message_child(
    global: &JSGlobalObject,
    message: JSValue,
    handle: JSValue,
) -> JsResult<()> {
    bun_output::scoped_log!(IPC, "handleInternalMessageChild");

    child_singleton().dispatch(message, handle, global)
}

#[bun_jsc::host_fn]
pub(crate) fn send_helper_primary(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperPrimary");

    let arguments = frame.arguments_old::<4>().ptr;
    // `as_class_ref` is the safe shared-borrow downcast (centralised deref
    // proof in `JSValue`); `Subprocess::ipc(&self)` projects the `JsCell`.
    // `cluster.Worker({ process })` accepts any object, so `process[kHandle]`
    // is `undefined` unless `cluster.fork()` created the process; Node's
    // `sendHelper` returns false for a worker with no IPC channel.
    let Some(subprocess) = arguments[0].as_class_ref::<Subprocess<'_>>() else {
        return Ok(JSValue::FALSE);
    };
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
    // Only NODE_HANDLE envelopes (built by cluster/primary.ts's send()) carry
    // a descriptor: the non-reading UDP wrap of a cluster-shared dgram socket.
    // Any other handle argument (e.g. round-robin newconn) keeps the internal,
    // handle-less form the worker's decoder expects. Converted before the ack
    // callback is registered so a failure here cannot strand a never-acked
    // entry in the callback table.
    let carries_descriptor = if handle.is_undefined_or_null() {
        false
    } else if let Some(cmd) = message.get(global, "cmd")? {
        cmd.is_string()
            && bun_core::OwnedString::new(cmd.to_bun_string(global)?).eql_comptime(b"NODE_HANDLE")
    } else {
        false
    };
    let (zig_handle, is_internal): (Option<Handle>, IsInternal) = if !carries_descriptor {
        (None, IsInternal::Internal)
    } else {
        #[cfg(windows)]
        {
            // Sending descriptors over IPC is not implemented on Windows;
            // Node reports the same for cluster-shared dgram handles.
            return Err(global.throw(format_args!(
                "passing a dgram handle over IPC is not supported on Windows"
            )));
        }
        #[cfg(not(windows))]
        {
            let fd = match handle.get(global, "fd")? {
                Some(value) => value.coerce_to_i32(global)?,
                None => -1,
            };
            if fd < 0 {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected handle to have a valid fd")));
            }
            (
                Some(Handle::init(bun_sys::Fd::from_native(fd), handle)),
                IsInternal::External,
            )
        }
    };

    let seq = ipc_data.internal_msg_queue.seq;
    if callback.is_function() {
        // Ack callbacks live in a JS Map held by the Subprocess wrapper's
        // WriteBarrier slot: one GC edge regardless of how many are in flight,
        // and not a GC root, so the Subprocess stays collectable.
        let map = match subprocess_js::ipc_ack_callbacks_get_cached(arguments[0]) {
            Some(m) => m,
            None => {
                let m = bun_jsc::JSMap::create(global);
                subprocess_js::ipc_ack_callbacks_set_cached(arguments[0], global, m);
                m
            }
        };
        InternalMsgHolder::put_callback(map, global, seq, callback)?;
    }

    // sequence number for InternalMsgHolder
    message.put(global, b"seq", JSValue::js_number(seq as f64));
    ipc_data.internal_msg_queue.seq = seq.wrapping_add(1);

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

    let success =
        ipc_data.serialize_and_send(global, message, is_internal, JSValue::NULL, zig_handle);
    Ok(if success == SerializeAndSendResult::Success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub(crate) fn on_internal_message_primary(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<3>().ptr;
    // `as_class_ref` is the safe shared-borrow downcast; `ipc()` takes `&self`.
    // Same guard as `send_helper_primary`: nothing to subscribe to when the
    // worker's process has no native child handle.
    let Some(subprocess) = arguments[0].as_class_ref::<Subprocess<'_>>() else {
        return Ok(JSValue::UNDEFINED);
    };
    if subprocess.ipc().is_none() {
        return Ok(JSValue::UNDEFINED);
    }
    // Stored in the Subprocess wrapper's WriteBarrier slots: visited by GC but
    // not a root, so a finished worker's whole object graph is collectable once
    // user code releases it.
    subprocess_js::ipc_worker_set_cached(arguments[0], global, arguments[1]);
    subprocess_js::ipc_internal_callback_set_cached(arguments[0], global, arguments[2]);
    Ok(JSValue::UNDEFINED)
}

pub(crate) fn handle_internal_message_primary(
    global: &JSGlobalObject,
    subprocess: &Subprocess<'_>,
    message: JSValue,
) -> JsResult<()> {
    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(());
    };
    let this_jsvalue = ipc_data.owner_this_jsvalue();
    let _keep = bun_jsc::EnsureStillAlive(this_jsvalue);
    if this_jsvalue.is_empty() {
        return Ok(());
    }

    let (Some(worker), Some(cb)) = (
        subprocess_js::ipc_worker_get_cached(this_jsvalue),
        subprocess_js::ipc_internal_callback_get_cached(this_jsvalue),
    ) else {
        return Ok(());
    };

    let event_loop = global.bun_vm().event_loop_mut();

    // TODO: investigate if "ack" and "seq" are observable and if they're not, remove them entirely.
    if let Some(p) = message.get(global, "ack")? {
        if !p.is_undefined() {
            let ack = p.to_int32();
            if let Some(map) = subprocess_js::ipc_ack_callbacks_get_cached(this_jsvalue) {
                if let Some(callback) = InternalMsgHolder::take_callback(map, global, ack)? {
                    event_loop.run_callback(callback, global, worker, &[message, JSValue::NULL]);
                    return Ok(());
                }
            }
        }
    }
    event_loop.run_callback(cb, global, worker, &[message, JSValue::NULL]);
    Ok(())
}

//
//
//

#[bun_jsc::host_fn]
pub(crate) fn set_ref(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let arguments = frame.arguments_old::<1>().ptr;

    if arguments.len() == 0 {
        return Err(global.throw_missing_arguments_value(&["enabled"]));
    }
    if !arguments[0].is_boolean() {
        return Err(global.throw_invalid_argument_type_value("enabled", "boolean", arguments[0]));
    }

    let enabled = arguments[0].to_boolean();
    let vm = global.bun_vm().as_mut();
    vm.channel_ref_overridden = true;
    if enabled {
        vm.channel_ref.ref_(bun_io::js_vm_ctx());
    } else {
        vm.channel_ref.unref(bun_io::js_vm_ctx());
    }
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__refChannelUnlessOverridden, c)
pub fn ref_channel_unless_overridden(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if !vm.channel_ref_overridden {
        vm.channel_ref.ref_(bun_io::js_vm_ctx());
    }
}

// HOST_EXPORT(Bun__unrefChannelUnlessOverridden, c)
pub fn unref_channel_unless_overridden(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if !vm.channel_ref_overridden {
        vm.channel_ref.unref(bun_io::js_vm_ctx());
    }
}

#[bun_jsc::host_fn]
pub(crate) fn channel_ignore_one_disconnect_event_listener(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global.bun_vm().as_mut();
    vm.channel_ref_should_ignore_one_disconnect_event_listener = true;
    Ok(JSValue::FALSE)
}

// HOST_EXPORT(Bun__shouldIgnoreOneDisconnectEventListener, c)
pub fn should_ignore_one_disconnect_event_listener(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    vm.channel_ref_should_ignore_one_disconnect_event_listener
}
