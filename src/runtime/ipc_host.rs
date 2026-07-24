//! JS host entry points for the IPC module that need to name `bun_runtime`
//! types (`Subprocess`, `Listener`).
//!
//! LAYERING: `bun_jsc::ipc` defines the protocol/queue (mode-agnostic) and the
//! `SendQueueOwner` trait. The host fns here close over the concrete
//! `Subprocess` / `Listener` / `IPCInstance` types so `bun_jsc` keeps zero
//! upward references into `bun_runtime`. The C-ABI exports (`Bun__Process__send`,
//! `emit_handle_ipc_message` for JS2Native) are link-time symbols, so which
//! crate defines them is irrelevant to the C++ side.

use bun_core::String as BunString;
use bun_jsc::ipc::{
    self as IPC, DecodedIPCMessage, Handle, IsInternal, SendQueue, SerializeAndSendResult,
};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass, JsResult};

use crate::api::bun::subprocess::Subprocess;
use crate::socket::Listener;

bun_core::define_scoped_log!(log, IPC, visible);

// `jsc.VirtualMachine.Process__emitErrorEvent` — implemented in C++
// (`BunProcess.cpp`); declared here per the same convention as
// `node_cluster_binding.rs`.
unsafe extern "C" {
    safe fn Process__emitErrorEvent(global: &JSGlobalObject, value: JSValue);
}

#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum FromEnum {
    SubprocessExited,
    Subprocess,
    Process,
}

#[cfg(windows)]
pub(crate) fn attach_windows_socket_payload(
    global: &JSGlobalObject,
    message: JSValue,
    fd: bun_sys::Fd,
    peer_pid: u32,
) -> Option<Box<[u8]>> {
    if peer_pid == 0 {
        return None;
    }
    let Some(hex) = bun_jsc::ipc::windows_export_socket_hex(fd, peer_pid) else {
        log!("attachWindowsSocketPayload: WSADuplicateSocketW failed");
        return None;
    };
    let Ok(str_js) = bun_jsc::bun_string_jsc::create_utf8_for_js(global, &hex) else {
        global.clear_exception();
        return None;
    };
    message.put(global, bun_jsc::ipc::WIN_SOCKET_INFO_KEY, str_js);
    Some(hex)
}

#[bun_jsc::host_fn]
fn emit_process_error_event(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [ex] = callframe.arguments_as_array::<1>();
    Process__emitErrorEvent(global_this, ex);
    Ok(JSValue::UNDEFINED)
}

fn do_send_err(
    global_object: &JSGlobalObject,
    callback: JSValue,
    ex: JSValue,
    from: FromEnum,
) -> JsResult<JSValue> {
    if callback.is_callable() {
        JSValue::call_next_tick_1(callback, global_object, ex)?;
        return Ok(JSValue::FALSE);
    }
    if from == FromEnum::Process {
        let target = bun_jsc::JSFunction::create(
            global_object,
            BunString::empty(),
            // `#[bun_jsc::host_fn]` emits the C-ABI shim under this name; the
            // safe `emit_process_error_event` is `JSHostFnZig`, not `JSHostFn`.
            __jsc_host_emit_process_error_event,
            1,
            Default::default(),
        );
        JSValue::call_next_tick_1(target, global_object, ex)?;
        return Ok(JSValue::FALSE);
    }
    // Bun.spawn().send() should throw an error (unless callback is passed)
    Err(global_object.throw_value(ex))
}

pub(crate) fn do_send(
    ipc: Option<&mut SendQueue>,
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    from: FromEnum,
    peer_pid: u32,
) -> JsResult<JSValue> {
    let [mut message, mut handle, options_, mut callback] = call_frame.arguments_as_array::<4>();
    #[cfg(not(windows))]
    let _ = peer_pid;

    let mut is_internal = IsInternal::External;
    if handle.is_callable() {
        callback = handle;
        handle = JSValue::UNDEFINED;
    } else if options_.is_callable() {
        callback = options_;
    } else if !options_.is_undefined() {
        global_object.validate_object("options", options_, Default::default())?;
        if options_
            .get(global_object, "$internal")?
            .is_some_and(|v| v.to_boolean())
        {
            is_internal = IsInternal::Internal;
        }
    }

    let connected = ipc.as_ref().is_some_and(|i| i.is_connected());
    if !connected {
        let msg = match from {
            FromEnum::Process => "process.send() can only be used if the IPC channel is open.",
            FromEnum::Subprocess => "Subprocess.send() can only be used if an IPC channel is open.",
            FromEnum::SubprocessExited => {
                "Subprocess.send() cannot be used after the process has exited."
            }
        };
        let ex = global_object
            .err(
                bun_jsc::ErrorCode::IPC_CHANNEL_CLOSED,
                format_args!("{}", msg),
            )
            .to_js();
        return do_send_err(global_object, callback, ex, from);
    }

    let ipc_data = ipc.unwrap();

    if message.is_undefined() {
        return Err(global_object.throw_missing_arguments_value(&["message"]));
    }
    if !message.is_string()
        && !message.is_object()
        && !message.is_number()
        && !message.is_boolean()
        && !message.is_null()
    {
        return Err(global_object.throw_invalid_argument_type_value_one_of(
            b"message",
            b"string, object, number, or boolean",
            message,
        ));
    }

    let original_message = message;
    if !handle.is_undefined_or_null() {
        let serialized_array: JSValue = IPC::ipc_serialize(global_object, message, handle)?;
        if serialized_array.is_undefined_or_null() {
            handle = JSValue::UNDEFINED;
        } else {
            let serialized_handle = serialized_array.get_index(global_object, 0)?;
            let serialized_message = serialized_array.get_index(global_object, 1)?;
            handle = serialized_handle;
            message = serialized_message;
        }
    }

    let mut zig_handle: Option<Handle> = None;
    let mut pause_target = JSValue::UNDEFINED;
    #[cfg_attr(windows, allow(unused_mut, unused_variables))]
    let mut dup_err: Option<bun_sys::Error> = None;
    if !handle.is_undefined_or_null() {
        if let Some(listener) = Listener::from_js(handle) {
            log!("got listener");
            // SAFETY: from_js returned a non-null `*mut Listener`; the JS
            // wrapper holds it alive for the call.
            match unsafe { (*listener).listener.get() } {
                crate::socket::listener::ListenerType::Uws(socket_uws) => {
                    // may need to handle ssl case
                    // SAFETY: `socket_uws` is a live non-null `*mut ListenSocket`
                    // owned by uSockets; `get_socket` only reinterpret-casts to
                    // `&mut us_socket_t` and `get_fd` is a read-only FFI call.
                    let fd = unsafe { &mut *socket_uws }.get_socket().get_fd();
                    #[cfg(not(windows))]
                    match Handle::init_dup(fd, handle, false) {
                        Ok(h) => zig_handle = Some(h),
                        Err(e) => dup_err = Some(e),
                    }
                    #[cfg(windows)]
                    {
                        zig_handle = Some(Handle::init(fd, handle));
                    }
                }
                crate::socket::listener::ListenerType::NamedPipe(_named_pipe) => {}
                crate::socket::listener::ListenerType::None => {}
            }
        } else if let Some(socket) = crate::socket::TCPSocket::from_js(handle) {
            // SAFETY: from_js returned a non-null pointer; the JS wrapper
            let fd = unsafe { (*socket).socket.get().fd() };
            if fd != bun_sys::Fd::INVALID {
                log!("got tcp socket fd");
                let keep_open = !options_.is_undefined_or_null()
                    && options_
                        .get(global_object, "keepOpen")?
                        .is_some_and(|v| v.to_boolean());
                if !keep_open {
                    pause_target = handle;
                }
                #[cfg(not(windows))]
                match Handle::init_dup(fd, handle, !keep_open) {
                    Ok(h) => zig_handle = Some(h),
                    Err(e) => dup_err = Some(e),
                }
                #[cfg(windows)]
                {
                    zig_handle = Some(if keep_open {
                        Handle::init(fd, handle)
                    } else {
                        Handle::init_close_on_complete(fd, handle)
                    });
                }
            }
        }
    }
    #[cfg(not(windows))]
    if let Some(e) = dup_err {
        use bun_jsc::SysErrorJsc as _;
        return do_send_err(global_object, callback, e.to_js(global_object), from);
    }

    #[cfg(windows)]
    if let Some(h) = &mut zig_handle {
        match attach_windows_socket_payload(global_object, message, h.fd, peer_pid) {
            Some(hex) => {
                h.win_export_hex = Some(hex);
                h.peer_pid = peer_pid;
            }
            None => zig_handle = None,
        }
    }
    if zig_handle.is_none() {
        message = original_message;
        pause_target = JSValue::UNDEFINED;
    }

    let status =
        ipc_data.serialize_and_send(global_object, message, is_internal, callback, zig_handle);

    if status != SerializeAndSendResult::Failure
        && !pause_target.is_undefined()
        && pause_target.is_object()
    {
        match pause_target.get(global_object, "pause") {
            Ok(Some(f)) if f.is_callable() => {
                if let Err(e) = f.call(global_object, pause_target, &[]) {
                    global_object.report_active_exception_as_unhandled(e);
                }
            }
            Ok(_) => {}
            Err(e) => global_object.report_active_exception_as_unhandled(e),
        }
    }

    if status == SerializeAndSendResult::Failure {
        let ex = global_object.create_type_error_instance(format_args!("process.send() failed"));
        ex.put(
            global_object,
            b"syscall",
            bun_jsc::bun_string_jsc::to_js(&BunString::static_(b"write"), global_object)?,
        );
        return do_send_err(global_object, callback, ex, from);
    }

    // in the success or backoff case, serializeAndSend will handle calling the callback
    Ok(if status == SerializeAndSendResult::Success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub fn emit_handle_ipc_message(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let [target, message, handle] = callframe.arguments_as_array::<3>();
    if target.is_null() {
        // Cluster-internal replies that carried a descriptor (shared dgram
        // sockets) are marked with cmd: "NODE_CLUSTER"; hand them straight to
        // the cluster's internal-message dispatcher instead of emitting a
        // process 'message' event, mirroring Node's NODE_-prefix routing.
        if message.is_object() {
            if let Some(cmd) = message.get(global_this, "cmd")? {
                if cmd.is_string() {
                    let cmd_str = bun_core::OwnedString::new(cmd.to_bun_string(global_this)?);
                    if cmd_str.eql_comptime(b"NODE_CLUSTER") {
                        crate::node::node_cluster_binding::handle_internal_message_child(
                            global_this,
                            message,
                            handle,
                        )?;
                        return Ok(JSValue::UNDEFINED);
                    }
                }
            }
        }
        // mutable); `get_ipc_instance` writes `self.ipc` on first call.
        let vm = global_this.bun_vm().as_mut();
        let Some(ipc) = vm.get_ipc_instance() else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: `get_ipc_instance` returns the live boxed IPCInstance.
        unsafe { (*ipc).handle_ipc_message(&DecodedIPCMessage::Data(message), handle) };
    } else {
        if !target.is_cell() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(subprocess) = Subprocess::from_js_direct(target) else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: `from_js_direct` returned a non-null `*mut Subprocess`; the JS
        // wrapper holds it alive for the call.
        unsafe { (*subprocess).handle_ipc_message(&DecodedIPCMessage::Data(message), handle) };
    }
    Ok(JSValue::UNDEFINED)
}

// The #[bun_jsc::host_fn] attribute emits the jsc-callconv shim and the
// `Bun__Process__send` export.
//
// LAYERING: lives here (not in `bun_jsc::virtual_machine_exports`) because the
// body — via `do_send` — names `Listener` (`bun_runtime`). The export is a
// link-time `#[no_mangle]` symbol, so the defining crate does not matter to
// the C++ caller.
#[bun_jsc::host_fn(export = "Bun__Process__send")]
pub(crate) fn Bun__Process__send(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    // mutable); `get_ipc_instance` writes `self.ipc` on first call.
    let vm = global.bun_vm().as_mut();
    // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance` (or
    // `None`); the `&mut SendQueue` borrow is scoped to this call and does not
    // alias `vm` (the instance is heap-allocated, not embedded in `vm`).
    let ipc = vm.get_ipc_instance().map(|i| unsafe { &mut (*i).data });
    #[cfg(windows)]
    let peer_pid = {
        let from_pipe = ipc.as_ref().map(|i| i.ipc_peer_pid()).unwrap_or(0);
        if from_pipe != 0 {
            from_pipe
        } else {
            // SAFETY: trivial libuv accessor, no preconditions.
            unsafe { bun_libuv_sys::uv_os_getppid() as u32 }
        }
    };
    #[cfg(not(windows))]
    let peer_pid = 0;
    do_send(ipc, global, frame, FromEnum::Process, peer_pid)
}
