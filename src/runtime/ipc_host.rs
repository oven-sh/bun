//! Child-side IPC channel state and JS host entry points for `crate::ipc`.
//!
//! The VM records only a `PendingIpc { fd, advanced }` at env load; the
//! channel itself (one per JS thread) lives here.

use crate::ipc::{
    self as IPC, DecodedIPCMessage, Handle, IsInternal, SendQueue, SerializeAndSendResult,
};
use bun_core::String as BunString;
#[cfg(windows)]
use bun_jsc::bun_string_jsc;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass, JsResult, StringJsc as _};
use bun_ptr::RefPtr;

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
) -> JsResult<Option<Box<[u8]>>> {
    if peer_pid == 0 {
        return Ok(None);
    }
    let Some(hex) = IPC::windows_export_socket_hex(fd, peer_pid) else {
        log!("attachWindowsSocketPayload: WSADuplicateSocketW failed");
        return Ok(None);
    };
    let str_js = bun_string_jsc::create_utf8_for_js(global, &hex)?;
    message.put(global, IPC::WIN_SOCKET_INFO_KEY, str_js);
    Ok(Some(hex))
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

fn is_invalid_handle_type(global_object: &JSGlobalObject, ex: JSValue) -> JsResult<bool> {
    if !ex.is_object() {
        return Ok(false);
    }
    let Some(code) = ex.get(global_object, "code")? else {
        return Ok(false);
    };
    if !code.is_string() {
        return Ok(false);
    }
    Ok(code
        .to_bun_string(global_object)?
        .eq_ascii(b"ERR_INVALID_HANDLE_TYPE"))
}

fn do_send_err(
    global_object: &JSGlobalObject,
    callback: JSValue,
    ex: JSValue,
    from: FromEnum,
    swallow_errors: bool,
) -> JsResult<JSValue> {
    if callback.is_callable() {
        JSValue::call_next_tick_1(callback, global_object, ex)?;
        return Ok(JSValue::FALSE);
    }
    if swallow_errors {
        return Ok(JSValue::FALSE);
    }
    if from == FromEnum::Process {
        let target = bun_jsc::JSFunction::create(
            global_object,
            "",
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
    ipc: Option<&SendQueue>,
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    from: FromEnum,
    peer_pid: u32,
) -> JsResult<JSValue> {
    do_send_with(ipc, global_object, call_frame, from, peer_pid, false)
}

/// `legacy_options`: the internal `_send(message, handle, swallowErrors)`
/// form, where a boolean third argument means `{ swallowErrors }`.
/// <https://github.com/nodejs/node/blob/v26.3.0/lib/internal/child_process.js#L770-L793>
fn do_send_with(
    ipc: Option<&SendQueue>,
    global_object: &JSGlobalObject,
    call_frame: &CallFrame,
    from: FromEnum,
    peer_pid: u32,
    legacy_options: bool,
) -> JsResult<JSValue> {
    let [mut message, mut handle, mut options_, mut callback] =
        call_frame.arguments_as_array::<4>();
    #[cfg(not(windows))]
    let _ = peer_pid;

    let mut is_internal = IsInternal::External;
    let mut swallow_errors = false;
    if handle.is_callable() {
        callback = handle;
        handle = JSValue::UNDEFINED;
    } else if options_.is_callable() {
        callback = options_;
    } else if legacy_options && options_.is_boolean() {
        swallow_errors = options_.to_boolean();
        options_ = JSValue::UNDEFINED;
    } else if !options_.is_undefined() {
        global_object.validate_object("options", options_, Default::default())?;
        if options_
            .fast_get(global_object, bun_jsc::BuiltinName::internal)?
            .is_some_and(|v| v.to_boolean())
        {
            is_internal = IsInternal::Internal;
        }
        swallow_errors = options_
            .get(global_object, "swallowErrors")?
            .is_some_and(|v| v.to_boolean());
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
        return do_send_err(global_object, callback, ex, from, swallow_errors);
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

    if !handle.is_undefined_or_null() {
        let target = match from {
            FromEnum::Process => JSValue::NULL,
            _ => options_
                .get(global_object, "$target")?
                .unwrap_or(JSValue::UNDEFINED),
        };
        let serialized_array: JSValue =
            match IPC::ipc_serialize(global_object, message, handle, options_, target) {
                Ok(v) => v,
                Err(e) => {
                    if global_object.has_pending_termination_exception() {
                        return Err(e);
                    }
                    let ex = global_object.take_error(e);
                    if is_invalid_handle_type(global_object, ex)? {
                        return Err(global_object.throw_value(ex));
                    }
                    return do_send_err(global_object, callback, ex, from, swallow_errors);
                }
            };
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
        let keep_open = !options_.is_undefined_or_null()
            && options_
                .get(global_object, "keepOpen")?
                .is_some_and(|v| v.to_boolean());
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
        } else if let Some(udp) = handle.as_class_ref::<crate::socket::UDPSocket>() {
            if let Some(fd) = udp.native_fd() {
                log!("got udp socket fd");
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
        } else {
            let raw = bun_jsc::cpp::NodeHTTP__getServerSocketFd(handle);
            if raw >= 0 {
                log!("got node:http server socket fd");
                if !keep_open {
                    pause_target = handle;
                }
                #[cfg(not(windows))]
                match Handle::init_dup(bun_sys::Fd::from_native(raw as i32), handle, !keep_open) {
                    Ok(h) => zig_handle = Some(h),
                    Err(e) => dup_err = Some(e),
                }
                #[cfg(windows)]
                {
                    let fd = bun_sys::Fd::from_system(raw as usize as *mut core::ffi::c_void);
                    zig_handle = Some(if keep_open {
                        Handle::init(fd, handle)
                    } else {
                        Handle::init_close_on_complete(fd, handle)
                    });
                }
            }
        }
    }
    // serialize() already detached a non-keepOpen net.Socket; if it is not sent after all, close it
    // here (node: postSend on error). The handle's `close()`/`pause()` are calls of their own: what
    // one throws is reported (this host function is its landing frame), and the send goes on to
    // deliver its own result.
    let call_handle_method =
        |global_object: &JSGlobalObject, target: JSValue, name: &'static str| -> JsResult<()> {
            if target.is_object() {
                if let Some(f) = target.get(global_object, name)? {
                    if f.is_callable() {
                        crate::dispatch::fold(f.call(global_object, target, &[]).map(drop));
                    }
                }
            }
            Ok(())
        };
    let close_detached = |global_object: &JSGlobalObject, target: JSValue| {
        call_handle_method(global_object, target, "close")
    };

    #[cfg(not(windows))]
    if let Some(e) = dup_err {
        use bun_jsc::SysErrorJsc as _;
        close_detached(global_object, pause_target)?;
        return do_send_err(
            global_object,
            callback,
            e.to_js(global_object),
            from,
            swallow_errors,
        );
    }

    #[cfg(windows)]
    if let Some(h) = &mut zig_handle {
        match attach_windows_socket_payload(global_object, message, h.fd, peer_pid)? {
            Some(hex) => {
                h.win_export_hex = Some(hex);
                h.peer_pid = peer_pid;
            }
            None => zig_handle = None,
        }
    }
    if zig_handle.is_none() && !handle.is_undefined_or_null() {
        use bun_jsc::SysErrorJsc as _;
        close_detached(global_object, pause_target)?;
        let e = bun_sys::Error::new(bun_sys::E::EBADF, bun_sys::Tag::send);
        return do_send_err(
            global_object,
            callback,
            e.to_js(global_object),
            from,
            swallow_errors,
        );
    }

    let status =
        ipc_data.serialize_and_send(global_object, message, is_internal, callback, zig_handle);

    if status != SerializeAndSendResult::Failure && pause_target.is_object() {
        match pause_target.get(global_object, "pause")? {
            Some(f) if f.is_callable() => {
                crate::dispatch::fold(f.call(global_object, pause_target, &[]).map(drop));
            }
            _ => bun_jsc::cpp::NodeHTTP__pauseServerSocket(pause_target),
        }
    }

    if status == SerializeAndSendResult::Failure {
        close_detached(global_object, pause_target)?;
        let ex = global_object.create_type_error_instance(format_args!("process.send() failed"));
        ex.put(
            global_object,
            b"syscall",
            BunString::static_("write").to_js(global_object)?,
        );
        return do_send_err(global_object, callback, ex, from, swallow_errors);
    }

    // in the success or backoff case, serializeAndSend will handle calling the callback
    Ok(if status == SerializeAndSendResult::Success {
        JSValue::TRUE
    } else {
        JSValue::FALSE
    })
}

#[bun_jsc::host_fn]
pub(crate) fn emit_handle_ipc_message(
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
                    let cmd_str = cmd.to_bun_string(global_this)?;
                    if cmd_str.eq_ascii(b"NODE_CLUSTER") {
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
        let vm = global_this.bun_vm().as_mut();
        let Some(ipc) = get_ipc_instance(vm) else {
            // Channel already gone: a handle that finished adopting after EOF is still delivered, as in node.
            Process__emitMessageEvent(global_this, message, handle);
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: `get_ipc_instance` returns the live boxed IPCInstance.
        unsafe { (*ipc).handle_ipc_message(&DecodedIPCMessage::Data(message), handle) }?;
    } else {
        if !target.is_cell() {
            return Ok(JSValue::UNDEFINED);
        }
        let Some(subprocess) = Subprocess::from_js_direct(target) else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: `from_js_direct` returned a non-null `*mut Subprocess`; the JS
        // wrapper holds it alive for the call.
        unsafe { (*subprocess).handle_ipc_message(&DecodedIPCMessage::Data(message), handle) }?;
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
fn Bun__Process__send(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    process_send(global, frame, false)
}

/// `process._send`: the internal entry point node's cluster and socket_list
/// code calls with a boolean `swallowErrors` third argument.
#[bun_jsc::host_fn(export = "Bun__Process__internalSend")]
fn Bun__Process__internalSend(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_jsc::mark_binding!();
    process_send(global, frame, true)
}

fn process_send(
    global: &JSGlobalObject,
    frame: &CallFrame,
    legacy_options: bool,
) -> JsResult<JSValue> {
    let vm = global.bun_vm().as_mut();
    // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance` (or
    // `None`); the instance is heap-allocated, not embedded in `vm`.
    let ipc = get_ipc_instance(vm).map(|i| unsafe { (*i).data() });
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
    do_send_with(
        ipc,
        global,
        frame,
        FromEnum::Process,
        peer_pid,
        legacy_options,
    )
}

// `JSGlobalObject` is an opaque `UnsafeCell`-backed ZST handle, so
// `&JSGlobalObject` is ABI-identical to a non-null `JSGlobalObject*` and C++
// mutating VM/process state through it is interior mutation invisible to Rust.
unsafe extern "C" {
    safe fn Process__emitMessageEvent(global: &JSGlobalObject, value: JSValue, handle: JSValue);
    safe fn Process__emitDisconnectEvent(global: &JSGlobalObject);
}

/// Child-side IPC channel: the send queue for the inherited channel fd.
pub struct IPCInstance {
    pub data: RefPtr<SendQueue>,
}

/// One channel per JS thread (a VM is thread-bound; workers re-detect their
/// own inherited fd).
#[thread_local]
static CHANNEL: core::cell::Cell<Option<core::ptr::NonNull<IPCInstance>>> =
    core::cell::Cell::new(None);

impl IPCInstance {
    pub fn new(v: IPCInstance) -> *mut IPCInstance {
        bun_core::heap::into_raw(Box::new(v))
    }

    #[inline]
    pub fn data(&self) -> &SendQueue {
        &self.data
    }

    /// Only reached from the `get_ipc_instance` error path.
    ///
    /// # Safety
    /// `this` must have been produced by `IPCInstance::new` (heap::alloc) and
    /// not yet freed or aliased.
    pub(crate) unsafe fn deinit(this: *mut IPCInstance) {
        // SAFETY: caller contract — `this` is a live heap::alloc'd box; the
        // SendQueue ref is owned by it and released with it after detaching.
        unsafe {
            (*this).data.detach();
            drop(bun_core::heap::take(this));
        }
    }

    /// Dispatches a decoded IPC message (and optional handle) to the JS `process` listeners.
    pub fn handle_ipc_message(&self, message: &DecodedIPCMessage, handle: JSValue) -> JsResult<()> {
        // SAFETY: VM singleton + its event loop are process-lifetime.
        let vm = bun_jsc::virtual_machine::VirtualMachine::get().as_mut();
        let global_this = vm.global();
        let event_loop = vm.event_loop_mut();

        match *message {
            DecodedIPCMessage::Version(v) => {
                bun_core::scoped_log!(IPC, "Parent IPC version is {}", v);
            }
            DecodedIPCMessage::Data(data) => {
                bun_core::scoped_log!(IPC, "Received IPC message from parent");
                event_loop.enter();
                Process__emitMessageEvent(global_this, data, handle);
                event_loop.exit();
            }
            DecodedIPCMessage::Internal(data) => {
                bun_core::scoped_log!(IPC, "Received IPC internal message from parent");
                let _entered = vm.enter_event_loop_scope();
                crate::node::node_cluster_binding::handle_internal_message_child(
                    global_this,
                    data,
                    handle,
                )?;
            }
        }
        Ok(())
    }

    /// Tears down the IPC channel and emits the disconnect events on `process`.
    pub(crate) fn handle_ipc_close(&self) {
        bun_core::scoped_log!(IPC, "IPCInstance#handleIPCClose");
        // SAFETY: VM singleton is process-lifetime.
        let vm = bun_jsc::virtual_machine::VirtualMachine::get().as_mut();
        let event_loop = vm.event_loop_mut();
        crate::jsc_hooks::ipc_child_singleton_deinit();
        event_loop.enter();
        Process__emitDisconnectEvent(vm.global());
        event_loop.exit();
        // Group is embedded in RareData and shared with subprocess IPC; nothing
        // to free here.
        vm.channel_ref.disable();
    }
}

/// Returns the initialized IPC instance, lazily creating it from the VM's
/// recorded `PendingIpc`.
pub fn get_ipc_instance(
    vm: &mut bun_jsc::virtual_machine::VirtualMachine,
) -> Option<*mut IPCInstance> {
    if let Some(inst) = CHANNEL.get() {
        return Some(inst.as_ptr());
    }
    let pending = vm.pending_ipc.take()?;
    let fd = pending.fd;
    let mode = if pending.advanced {
        IPC::Mode::Advanced
    } else {
        IPC::Mode::Json
    };
    bun_core::scoped_log!(IPC, "getIPCInstance {:?}", fd);

    vm.event_loop_mut().ensure_waker();

    #[cfg(not(windows))]
    let instance: *mut IPCInstance = {
        let loop_ = vm.uws_loop();
        let group: *mut bun_uws::SocketGroup = vm.rare_data().spawn_ipc_group(loop_);

        let instance = IPCInstance::new(IPCInstance {
            data: SendQueue::new(mode, None, IPC::SocketUnion::Uninitialized),
        });
        // SAFETY: `instance` was just boxed; `send_queue` is its live SendQueue.
        let send_queue: *mut SendQueue = unsafe { (*instance).data.as_ptr() };
        // SAFETY: as above.
        unsafe {
            (*send_queue).set_owner(IPC::SendQueueOwner::Instance(
                core::ptr::NonNull::new_unchecked(instance),
            ))
        };
        // SAFETY: `instance` was just boxed above and is non-null.
        CHANNEL.set(Some(unsafe { core::ptr::NonNull::new_unchecked(instance) }));

        // SAFETY: `group` is the live per-VM SocketGroup; `send_queue` is
        // the freshly-allocated SendQueue (root raw pointer, stored in the
        // socket ext slot for the socket's lifetime).
        let socket = unsafe {
            IPC::Socket::from_fd::<SendQueue>(
                &mut *group,
                bun_uws::SocketKind::SpawnIpc,
                fd,
                send_queue,
                true,
            )
        };
        let Some(socket) = socket else {
            // SAFETY: `instance` was produced by `IPCInstance::new`
            // (heap::alloc) above and is not yet aliased.
            unsafe { IPCInstance::deinit(instance) };
            CHANNEL.set(None);
            bun_core::warn!("Unable to start IPC socket");
            return None;
        };
        socket.set_timeout(0);

        // SAFETY: `send_queue` is live (owned by `instance`).
        unsafe { (*send_queue).socket.set(IPC::SocketUnion::Open(socket)) };

        instance
    };

    #[cfg(windows)]
    let instance: *mut IPCInstance = {
        let instance = IPCInstance::new(IPCInstance {
            data: SendQueue::new(mode, None, IPC::SocketUnion::Uninitialized),
        });
        // SAFETY: `instance` was just boxed; `send_queue` is its live SendQueue.
        let send_queue: *mut SendQueue = unsafe { (*instance).data.as_ptr() };
        // SAFETY: as above.
        unsafe {
            (*send_queue).set_owner(IPC::SendQueueOwner::Instance(
                core::ptr::NonNull::new_unchecked(instance),
            ))
        };
        // SAFETY: `instance` was just boxed above and is non-null.
        CHANNEL.set(Some(unsafe { core::ptr::NonNull::new_unchecked(instance) }));

        // `windows_configure_client` STORES the `*mut SendQueue` in
        // `uv_handle_t.data` for the pipe's lifetime; `send_queue` is the
        // allocation's root raw pointer.
        // SAFETY: `send_queue` is the live SendQueue owned by `instance`.
        if let Err(_) = unsafe { SendQueue::windows_configure_client(send_queue, fd) } {
            // SAFETY: `instance` was produced by `IPCInstance::new`
            // (heap::alloc) above and is not yet aliased.
            unsafe { IPCInstance::deinit(instance) };
            CHANNEL.set(None);
            bun_core::output::warn(&format_args!("Unable to start IPC pipe '{:?}'", fd));
            return None;
        }

        instance
    };

    // SAFETY: `instance` is the live boxed IPCInstance.
    unsafe { (*instance).data().write_version_packet(vm.global()) };

    Some(instance)
}

// HOST_EXPORT(Bun__GlobalObject__connectedIPC, c)
pub fn global_object_connected_ipc(global: &JSGlobalObject) -> bool {
    if let Some(inst) = CHANNEL.get() {
        // SAFETY: `CHANNEL` holds the live boxed instance until deinit.
        return unsafe { inst.as_ref().data().is_connected() };
    }
    global.bun_vm().as_mut().pending_ipc.is_some()
}

// HOST_EXPORT(Bun__GlobalObject__hasIPC, c)
pub fn global_object_has_ipc(global: &JSGlobalObject) -> bool {
    // JSGlobalObject::bun_vm contract.
    CHANNEL.get().is_some() || global.bun_vm().as_mut().pending_ipc.is_some()
}

/// When IPC environment variables are passed, the socket is not immediately opened,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we open the socket. This is to avoid missing messages at the start of the program.
// HOST_EXPORT(Bun__ensureProcessIPCInitialized, c)
pub fn ensure_process_ipc_initialized(global: &JSGlobalObject) {
    let _ = get_ipc_instance(global.bun_vm().as_mut());
}
