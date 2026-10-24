//! Child-side IPC channel state and JS host entry points for `crate::ipc`.
//!
//! The VM records only a `PendingIpc { fd, advanced }` at env load; the
//! channel itself (one per JS thread) lives here.
//!
//! Nothing reads the channel before the script uses it, so a message that
//! arrives first waits in the socket for the first listener. When the entry
//! point starts to evaluate, the channel is put under watch for the parent's
//! close ([`watch_inherited_channel`]), which a script that never uses the
//! channel still has to learn of.

use crate::ipc::{
    self as IPC, DecodedIPCMessage, Handle, IsInternal, SendQueue, SerializeAndSendResult,
};
use bun_jsc::bindgen::{JsLocal, JsScope};
#[cfg(windows)]
use bun_jsc::bun_string_jsc;
use bun_jsc::{JSGlobalObject, JSValue, JsClass, JsResult};
use bun_ptr::RefPtr;

use crate::generated_bindgen::ipc_host::{MessageTarget, ReceivedMessage};
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

pub(crate) fn emit_process_error_event<'a>(cx: &mut JsScope<'a>, error: JsLocal<'a>) {
    Process__emitErrorEvent(cx.global(), error.to_js());
}

fn do_send_err(
    global_object: &JSGlobalObject,
    callback: JSValue,
    ex: JSValue,
    from: FromEnum,
) -> JsResult<bool> {
    if callback.is_callable() {
        JSValue::call_next_tick_1(callback, global_object, ex)?;
        return Ok(false);
    }
    if from == FromEnum::Process {
        let target = bun_jsc::JSFunction::create(
            global_object,
            "",
            crate::generated_bindgen::ipc_host::Bun__IPC__emitProcessErrorEvent,
            1,
            Default::default(),
        );
        JSValue::call_next_tick_1(target, global_object, ex)?;
        return Ok(false);
    }
    // Bun.spawn().send() should throw an error (unless callback is passed)
    Err(global_object.throw_value(ex))
}

pub(crate) fn do_send(
    ipc: Option<&SendQueue>,
    global_object: &JSGlobalObject,
    [mut message, mut handle, options_, mut callback]: [JSValue; 4],
    from: FromEnum,
    peer_pid: u32,
) -> JsResult<bool> {
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
            .fast_get(global_object, bun_jsc::BuiltinName::internal)?
            .is_some_and(|v| v.to_boolean())
        {
            is_internal = IsInternal::Internal;
        }
    }

    let connected = ipc.as_ref().is_some_and(|i| i.is_connected());
    if !connected {
        let msg = match from {
            FromEnum::Process => "Channel closed",
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
        let serialized_array: JSValue =
            IPC::ipc_serialize(global_object, message, handle, options_)?;
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
                #[cfg(windows)]
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
        return do_send_err(global_object, callback, e.to_js(global_object), from);
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
    if zig_handle.is_none() {
        message = original_message;
        close_detached(global_object, pause_target)?;
        pause_target = JSValue::UNDEFINED;
    }

    let status =
        ipc_data.serialize_and_send(global_object, message, is_internal, callback, zig_handle);

    if status != SerializeAndSendResult::Failure {
        call_handle_method(global_object, pause_target, "pause")?;
    }

    if status == SerializeAndSendResult::Failure {
        close_detached(global_object, pause_target)?;
        // The serializer rejected the message (cyclic JSON, uncloneable value): that is the error.
        if global_object.has_exception() {
            return Err(bun_jsc::JsError::Thrown);
        }
        let ex = global_object.create_type_error_instance(format_args!("process.send() failed"));
        ex.put(
            global_object,
            b"syscall",
            global_object.common_strings().write(),
        );
        return do_send_err(global_object, callback, ex, from);
    }

    // in the success or backoff case, serializeAndSend will handle calling the callback
    Ok(status == SerializeAndSendResult::Success)
}

pub(crate) fn emit_handle_ipc_message<'a>(
    cx: &mut JsScope<'a>,
    target: MessageTarget<'a>,
    message: ReceivedMessage<'a>,
    handle: JsLocal<'a>,
) -> JsResult<()> {
    let global_this = cx.global();
    let handle = handle.to_js();
    let (message, is_object) = match message {
        ReceivedMessage::Object(object) => (object.to_js(), true),
        ReceivedMessage::Primitive(primitive) => (primitive.to_js(), false),
    };
    match target {
        MessageTarget::Subprocess(subprocess) => {
            subprocess.handle_ipc_message(&DecodedIPCMessage::Data(message), handle)?;
        }
        MessageTarget::Missing | MessageTarget::Ignored(_) => {}
        MessageTarget::ThisProcess => {
            // Cluster-internal replies that carried a descriptor (shared dgram
            // sockets) are marked with cmd: "NODE_CLUSTER"; hand them straight to
            // the cluster's internal-message dispatcher instead of emitting a
            // process 'message' event, mirroring Node's NODE_-prefix routing.
            if is_object {
                if let Some(cmd) = message.get(global_this, "cmd")? {
                    if cmd.is_string() {
                        let cmd_str = cmd.to_bun_string(global_this)?;
                        if cmd_str.eq_ascii(b"NODE_CLUSTER") {
                            crate::node::node_cluster_binding::handle_internal_message_child(
                                global_this,
                                message,
                                handle,
                            )?;
                            return Ok(());
                        }
                    }
                }
            }
            let vm = global_this.bun_vm().as_mut();
            let Some(ipc) = get_ipc_instance(vm) else {
                // Channel already gone: a handle that finished adopting after EOF is still delivered, as in node.
                Process__emitMessageEvent(global_this, message, handle);
                return Ok(());
            };
            // SAFETY: `get_ipc_instance` returns the live boxed IPCInstance.
            unsafe { (*ipc).handle_ipc_message(&DecodedIPCMessage::Data(message), handle) }?;
        }
    }
    Ok(())
}

pub(crate) fn send<'a>(
    cx: &mut JsScope<'a>,
    message: JsLocal<'a>,
    handle: JsLocal<'a>,
    options: JsLocal<'a>,
    callback: JsLocal<'a>,
) -> JsResult<bool> {
    bun_jsc::mark_binding!();
    let global = cx.global();
    let vm = global.bun_vm().as_mut();
    let ipc = if parent_left_watched_channel() {
        // The channel is closed, and what the parent sent stays for a first listener.
        None
    } else {
        // SAFETY: `get_ipc_instance` returns the live boxed `IPCInstance` (or
        // `None`); the instance is heap-allocated, not embedded in `vm`.
        get_ipc_instance(vm).map(|i| unsafe { (*i).data() })
    };
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
    do_send(
        ipc,
        global,
        [
            message.to_js(),
            handle.to_js(),
            options.to_js(),
            callback.to_js(),
        ],
        FromEnum::Process,
        peer_pid,
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
pub(crate) struct IPCInstance {
    pub data: RefPtr<SendQueue>,
    state: core::cell::Cell<ChannelState>,
}

#[derive(Copy, Clone, Eq, PartialEq)]
enum ChannelState {
    /// The script has not used the channel. The socket polls for nothing
    /// (`LIBUS_SOCKET_WATCH_ONLY`): the fd is as the parent made it, and other
    /// processes that share it lose nothing. Not on Windows, where a pipe
    /// reports its close only to a read.
    #[cfg_attr(windows, allow(dead_code))]
    Watched,
    /// The parent closed the channel while it was watched. The socket stays open
    /// with what the parent sent, for a first listener. `restore_ref`:
    /// `vm.channel_ref` was taken back for the close and is wanted again then.
    ParentLeft { restore_ref: bool },
    /// In use: the socket reads and writes.
    Started,
}

/// One channel per JS thread (a VM is thread-bound; workers re-detect their
/// own inherited fd).
#[thread_local]
static CHANNEL: core::cell::Cell<Option<core::ptr::NonNull<IPCInstance>>> =
    core::cell::Cell::new(None);

impl IPCInstance {
    pub(crate) fn new(v: IPCInstance) -> *mut IPCInstance {
        bun_core::heap::into_raw(Box::new(v))
    }

    #[inline]
    pub(crate) fn data(&self) -> &SendQueue {
        &self.data
    }

    /// The parent closed the channel before the script used it.
    #[inline]
    fn parent_left(&self) -> bool {
        matches!(self.state.get(), ChannelState::ParentLeft { .. })
    }

    /// First use of a watched channel: read it from here on. After the parent's
    /// close this reads what the parent sent, and then the end of the channel.
    #[cfg(not(windows))]
    fn start(&self, vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
        let restore_ref = match self.state.replace(ChannelState::Started) {
            ChannelState::Started => return,
            ChannelState::Watched => false,
            ChannelState::ParentLeft { restore_ref } => restore_ref,
        };
        if restore_ref {
            vm.channel_ref.ref_(bun_io::js_vm_ctx());
        }
        if let IPC::SocketUnion::Open(socket) = *self.data().socket.get() {
            socket.watch_only_start();
        }
        self.data().write_version_packet(vm.global());
    }

    /// Only reached from the error paths of `open_channel` and `get_ipc_instance`.
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
    pub(crate) fn handle_ipc_message(
        &self,
        message: &DecodedIPCMessage,
        handle: JSValue,
    ) -> JsResult<()> {
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

/// Makes the instance for `pending` and its socket. `None` leaves no trace of
/// the attempt.
#[cfg(not(windows))]
fn open_channel(
    vm: &mut bun_jsc::virtual_machine::VirtualMachine,
    pending: bun_jsc::virtual_machine::PendingIpc,
    state: ChannelState,
) -> Option<*mut IPCInstance> {
    let mode = if pending.advanced {
        IPC::Mode::Advanced
    } else {
        IPC::Mode::Json
    };
    vm.event_loop_mut().ensure_waker();
    let loop_ = vm.uws_loop();
    let group: *mut bun_uws::SocketGroup = vm.rare_data().spawn_ipc_group(loop_);

    let instance = IPCInstance::new(IPCInstance {
        data: SendQueue::new(mode, None, IPC::SocketUnion::Uninitialized),
        state: core::cell::Cell::new(state),
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

    let options = if state == ChannelState::Watched {
        bun_uws::LIBUS_SOCKET_WATCH_ONLY
    } else {
        0
    };
    // SAFETY: `group` is the live per-VM SocketGroup; `send_queue` is
    // the freshly-allocated SendQueue (root raw pointer, stored in the
    // socket ext slot for the socket's lifetime).
    let socket = unsafe {
        IPC::Socket::from_fd_with_options::<SendQueue>(
            &mut *group,
            bun_uws::SocketKind::SpawnIpc,
            pending.fd,
            send_queue,
            true,
            options,
        )
    };
    let Some(socket) = socket else {
        // SAFETY: `instance` was produced by `IPCInstance::new`
        // (heap::alloc) above and is not yet aliased.
        unsafe { IPCInstance::deinit(instance) };
        CHANNEL.set(None);
        return None;
    };
    socket.set_timeout(0);

    // SAFETY: `send_queue` is live (owned by `instance`).
    unsafe { (*send_queue).socket.set(IPC::SocketUnion::Open(socket)) };

    Some(instance)
}

/// `RuntimeHooks::watch_inherited_ipc`: the entry point starts to evaluate, and
/// its script may never use the channel. A failure here leaves the channel to
/// its first use, which reports it.
pub(crate) fn watch_inherited_channel(vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
    #[cfg(not(windows))]
    {
        if CHANNEL.get().is_some() {
            return;
        }
        let Some(pending) = vm.pending_ipc else {
            return;
        };
        // `NODE_CHANNEL_FD` can be left over from a process further up, and name
        // an fd that the script polls for itself.
        if !bun_sys::fstat(pending.fd).is_ok_and(|stat| bun_sys::S::ISSOCK(stat.st_mode as _)) {
            return;
        }
        bun_core::scoped_log!(IPC, "watchInheritedChannel {:?}", pending.fd);
        if open_channel(vm, pending, ChannelState::Watched).is_some() {
            vm.pending_ipc = None;
        }
    }
    #[cfg(windows)]
    let _ = vm;
}

/// `on_end` of a socket that may be the watched channel of this process: the
/// parent closed it, or the socket failed. Nothing is read or closed. `false`
/// for the end of a channel that is in use.
pub(crate) fn parent_closed_watched_channel(send_queue: &SendQueue) -> bool {
    let Some(IPC::SendQueueOwner::Instance(instance)) = send_queue.owner.get() else {
        return false;
    };
    // SAFETY: an attached owner is live (it holds a ref on the SendQueue).
    let instance = unsafe { instance.as_ref() };
    match instance.state.get() {
        ChannelState::Started => false,
        ChannelState::ParentLeft { .. } => true,
        ChannelState::Watched => {
            bun_core::scoped_log!(IPC, "the parent closed the watched channel");
            let vm = bun_jsc::virtual_machine::VirtualMachine::get().as_mut();
            let restore_ref = vm.channel_ref.is_active();
            // Not `disable()`: a first listener refs the channel again, to read
            // what the parent sent.
            vm.channel_ref.unref(bun_io::js_vm_ctx());
            instance.state.set(ChannelState::ParentLeft { restore_ref });
            true
        }
    }
}

/// The parent closed the channel of this process before the script used it.
fn parent_left_watched_channel() -> bool {
    // SAFETY: `CHANNEL` holds the live boxed instance until deinit.
    CHANNEL
        .get()
        .is_some_and(|inst| unsafe { inst.as_ref() }.parent_left())
}

/// `process.channel.ref()` / `unref()` after the parent closed a channel that
/// the script has not used: nothing is left to wait for, so the call only
/// decides whether a first listener gets the ref. `false` in any other state.
pub(crate) fn set_ref_after_parent_left(enabled: bool) -> bool {
    let Some(inst) = CHANNEL.get() else {
        return false;
    };
    // SAFETY: `CHANNEL` holds the live boxed instance until deinit.
    let inst = unsafe { inst.as_ref() };
    if !inst.parent_left() {
        return false;
    }
    inst.state.set(ChannelState::ParentLeft {
        restore_ref: enabled,
    });
    true
}

/// node:cluster set this worker up: the channel is in use from here on.
pub(crate) fn start_for_cluster_worker(vm: &mut bun_jsc::virtual_machine::VirtualMachine) {
    let parent_left = parent_left_watched_channel();
    let _ = get_ipc_instance(vm);
    if parent_left {
        // A worker exits on 'disconnect'. Its listener for it does not ref the
        // channel, and nothing is sent to a primary that left, so hold the loop
        // until the end of the channel is read.
        vm.channel_ref.ref_(bun_io::js_vm_ctx());
    }
}

/// Returns the IPC instance for a use of the channel: it reads and writes from
/// here on. Creates it from the VM's recorded `PendingIpc` when the channel is
/// not under watch yet.
pub(crate) fn get_ipc_instance(
    vm: &mut bun_jsc::virtual_machine::VirtualMachine,
) -> Option<*mut IPCInstance> {
    if let Some(inst) = CHANNEL.get() {
        #[cfg(not(windows))]
        // SAFETY: `CHANNEL` holds the live boxed instance until deinit.
        unsafe { inst.as_ref() }.start(vm);
        return Some(inst.as_ptr());
    }
    let pending = vm.pending_ipc.take()?;
    let fd = pending.fd;
    bun_core::scoped_log!(IPC, "getIPCInstance {:?}", fd);

    #[cfg(not(windows))]
    let instance: *mut IPCInstance = {
        let Some(instance) = open_channel(vm, pending, ChannelState::Started) else {
            bun_core::warn!("Unable to start IPC socket");
            return None;
        };
        instance
    };

    #[cfg(windows)]
    let instance: *mut IPCInstance = {
        let mode = if pending.advanced {
            IPC::Mode::Advanced
        } else {
            IPC::Mode::Json
        };
        vm.event_loop_mut().ensure_waker();
        let instance = IPCInstance::new(IPCInstance {
            data: SendQueue::new(mode, None, IPC::SocketUnion::Uninitialized),
            state: core::cell::Cell::new(ChannelState::Started),
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
pub(crate) fn global_object_connected_ipc(global: &JSGlobalObject) -> bool {
    if let Some(inst) = CHANNEL.get() {
        // SAFETY: `CHANNEL` holds the live boxed instance until deinit.
        let inst = unsafe { inst.as_ref() };
        return !inst.parent_left() && inst.data().is_connected();
    }
    global.bun_vm().as_mut().pending_ipc.is_some()
}

// HOST_EXPORT(Bun__GlobalObject__hasIPC, c)
pub(crate) fn global_object_has_ipc(global: &JSGlobalObject) -> bool {
    // JSGlobalObject::bun_vm contract.
    CHANNEL.get().is_some() || global.bun_vm().as_mut().pending_ipc.is_some()
}

/// When IPC environment variables are passed, the socket is not immediately read,
/// but rather we wait for process.on('message') or process.send() to be called, THEN
/// we read the socket. This is to avoid missing messages at the start of the program.
// HOST_EXPORT(Bun__ensureProcessIPCInitialized, c)
pub(crate) fn ensure_process_ipc_initialized(global: &JSGlobalObject) {
    let _ = get_ipc_instance(global.bun_vm().as_mut());
}
