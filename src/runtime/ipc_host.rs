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
use bun_sys::Fd;
use bun_sys_jsc::ErrorJsc as _;

use crate::api::bun::subprocess::Subprocess;
use crate::socket::listener::ListenerType;
use crate::socket::{Listener, TCPSocket, TLSSocket};

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

/// The live fd behind a native socket handle that `Ipc.ts`'s `serialize()`
/// returns: a `Listener` (from a `net.Server`) or a `TCPSocket`/`TLSSocket`
/// (from a `net.Socket`). `None` when the handle's socket is already
/// closed/detached or the type carries no fd (named pipes).
fn native_handle_fd(handle: JSValue) -> Option<Fd> {
    let fd = if let Some(listener) = Listener::from_js(handle) {
        // SAFETY: `from_js` returned a non-null `*mut Listener`; the JS
        // wrapper holds it alive for the call.
        match unsafe { (*listener).listener.get() } {
            // SAFETY: `socket_uws` is a live non-null `*mut ListenSocket`
            // owned by uSockets; `get_socket` only reinterpret-casts to
            // `&mut us_socket_t` and `get_fd` is a read-only FFI call.
            ListenerType::Uws(socket_uws) => unsafe { &mut *socket_uws }.get_socket().get_fd(),
            ListenerType::NamedPipe(_) | ListenerType::None => return None,
        }
    } else if let Some(tcp) = handle.as_::<TCPSocket>() {
        // SAFETY: `as_` returned a non-null `*mut TCPSocket`; the JS wrapper
        // holds it alive for the call.
        unsafe { (*tcp).socket.get() }.fd()
    } else {
        let tls = handle.as_::<TLSSocket>()?;
        // SAFETY: see above.
        unsafe { (*tls).socket.get() }.fd()
    };
    fd.is_valid().then_some(fd)
}

pub(crate) fn do_send(
    ipc: Option<&mut SendQueue>,
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    from: FromEnum,
) -> JsResult<JSValue> {
    let [mut message, mut handle, mut options_, mut callback] =
        call_frame.arguments_as_array::<4>();

    if handle.is_callable() {
        callback = handle;
        handle = JSValue::UNDEFINED;
        options_ = JSValue::UNDEFINED;
    } else if options_.is_callable() {
        callback = options_;
        options_ = JSValue::UNDEFINED;
    } else if !options_.is_undefined() {
        global_object.validate_object("options", options_, Default::default())?;
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

    // Package the message with a handle. `ipc_serialize` (the `Ipc.ts`
    // `serialize()` builtin) maps a JS handle (net.Server / net.Socket) to
    // `[nativeHandle, wrappedMessage]`; null means "send the message plain"
    // (the handle's socket is already gone — node falls back the same way).
    // The wrapped `{cmd: "NODE_HANDLE", ...}` message is adopted ONLY once an
    // fd is secured: writing a NODE_HANDLE message with no ancillary fd makes
    // the receiver NACK until the retry limit and the message is lost.
    let mut zig_handle: Option<Handle> = None;
    if !handle.is_undefined_or_null() {
        let serialized_array: JSValue =
            IPC::ipc_serialize(global_object, message, handle, options_)?;
        if !serialized_array.is_undefined_or_null() {
            let native_handle = serialized_array.get_index(global_object, 0)?;
            let wrapped_message = serialized_array.get_index(global_object, 1)?;
            if let Some(fd) = native_handle_fd(native_handle) {
                // Dup so the in-flight transfer owns its own fd: the sender's
                // copy is closed right after this call for a net.Socket (node
                // semantics), and a net.Server can be closed by the user
                // before the queued sendmsg runs. `Handle` closes it on drop.
                match bun_sys::dup(fd) {
                    Ok(owned) => {
                        log!("sending handle fd {} (dup of {})", owned.uv(), fd.uv());
                        zig_handle = Some(Handle::init(owned));
                        message = wrapped_message;
                    }
                    Err(err) => {
                        let ex = err.to_js(global_object)?;
                        return do_send_err(global_object, callback, ex, from);
                    }
                }
            } else {
                // serialize() returned a handle but it carries no transferable
                // fd (e.g. a net.Socket that isn't connected yet, or a listener
                // that isn't listening). Don't silently send the message with no
                // handle — serialize() may have already detached the sender's
                // socket, so report the failure instead.
                let ex = global_object.create_type_error_instance(format_args!(
                    "The handle could not be sent over IPC: it has no transferable file descriptor"
                ));
                return do_send_err(global_object, callback, ex, from);
            }
        }
    }

    let status = ipc_data.serialize_and_send(
        global_object,
        message,
        IsInternal::External,
        callback,
        zig_handle,
    );

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
    do_send(ipc, global, frame, FromEnum::Process)
}
