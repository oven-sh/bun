// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use bun_core::String as BunString;
use bun_jsc::ipc::{IsInternal, SerializeAndSendResult};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, StrongOptional};

use crate::api::bun::subprocess::Subprocess;

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
    // TODO: we should not create two jsc.Strong.Optional here. If absolutely necessary, a single Array. should be all we use.
    singleton.worker = StrongOptional::create(arguments[0], global);
    singleton.cb = StrongOptional::create(arguments[1], global);
    singleton.flush(global)?;
    Ok(JSValue::UNDEFINED)
}

pub(crate) fn handle_internal_message_child(
    global: &JSGlobalObject,
    message: JSValue,
) -> JsResult<()> {
    bun_output::scoped_log!(IPC, "handleInternalMessageChild");

    child_singleton().dispatch(message, global)
}

#[bun_jsc::host_fn]
pub(crate) fn send_helper_primary(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperPrimary");

    let arguments = frame.arguments_old::<4>().ptr;
    // `as_class_ref` is the safe shared-borrow downcast (centralised deref
    // proof in `JSValue`); `Subprocess::ipc(&self)` projects the `JsCell`.
    let subprocess = arguments[0].as_class_ref::<Subprocess<'_>>().unwrap();
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
        let _ = ipc_data.internal_msg_queue.callbacks.put(
            ipc_data.internal_msg_queue.seq,
            StrongOptional::create(callback, global),
        );
    }

    // sequence number for InternalMsgHolder
    message.put(
        global,
        b"seq",
        JSValue::js_number(ipc_data.internal_msg_queue.seq as f64),
    );
    ipc_data.internal_msg_queue.seq = ipc_data.internal_msg_queue.seq.wrapping_add(1);

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

    // Cluster handle handoff (round-robin `newconn`, shared listen handles):
    // the JS side passes an object exposing a numeric `.fd`. The fd rides the
    // wire as SCM_RIGHTS ancillary data attached to this message's bytes; the
    // `$hasHandle` marker lets the receiving side pair the stashed fd with
    // this message (surfaced there as `$fd`). The JS handle object is kept
    // alive by `Handle` until the bytes (and fd) are flushed.
    let mut native_handle: Option<bun_jsc::ipc::Handle> = None;
    if !handle.is_null() && !handle.is_undefined() {
        let Some(fd_value) = handle.get(global, "fd")? else {
            return Err(global.throw(format_args!("cluster handle is missing 'fd'")));
        };
        if !fd_value.is_number() {
            return Err(global.throw_invalid_argument_type_value("handle.fd", "number", fd_value));
        }
        // POSIX: a plain fd; Windows: the raw SOCKET value (see
        // `to_js_without_making_lib_uv_owned`).
        #[cfg(not(windows))]
        let native_fd = {
            let raw_fd = fd_value.to_int32();
            if raw_fd < 0 {
                return Err(global.throw(format_args!("cluster handle has invalid fd")));
            }
            bun_sys::Fd::from_uv(raw_fd)
        };
        #[cfg(windows)]
        let native_fd = {
            let raw = fd_value.to_number(global)?;
            if !(raw.is_finite() && raw >= 0.0) {
                return Err(global.throw(format_args!("cluster handle has invalid fd")));
            }
            bun_sys::Fd::from_system(raw as u64 as usize as *mut core::ffi::c_void)
        };
        message.put(global, b"$hasHandle", JSValue::TRUE);
        // Windows: the fd cannot ride the pipe as ancillary data; serialize
        // the socket for the worker process and attach it to the message. A
        // failed export (worker already dead, WSA error) means the handle can
        // never arrive - report send failure instead of emitting a newconn
        // the worker could not act on; the caller's worker-removal path
        // reclaims the pending connection.
        #[cfg(windows)]
        if !crate::ipc_host::attach_windows_socket_payload(
            global,
            message,
            native_fd,
            subprocess.pid() as u32,
        ) {
            return Ok(JSValue::FALSE);
        }
        native_handle = Some(bun_jsc::ipc::Handle::init(native_fd, handle));
    }
    let success = ipc_data.serialize_and_send(
        global,
        message,
        IsInternal::Internal,
        JSValue::NULL,
        native_handle,
    );
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
    let subprocess = arguments[0].as_class_ref::<Subprocess<'_>>().unwrap();
    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(JSValue::UNDEFINED);
    };
    // TODO: remove these strongs.
    ipc_data.internal_msg_queue.worker = StrongOptional::create(arguments[1], global);
    ipc_data.internal_msg_queue.cb = StrongOptional::create(arguments[2], global);
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

    if !ipc_data.internal_msg_queue.is_ready() {
        return Ok(());
    }

    let event_loop = global.bun_vm().event_loop_mut();

    // TODO: investigate if "ack" and "seq" are observable and if they're not, remove them entirely.
    if let Some(p) = message.get(global, "ack")? {
        if !p.is_undefined() {
            let ack = p.to_int32();
            // Peek the JSValue first (ending the immutable borrow), then
            // swap_remove (which drops the Strong).
            let entry = ipc_data
                .internal_msg_queue
                .callbacks
                .get(&ack)
                .map(|s| s.get());
            if let Some(callback_opt) = entry {
                ipc_data.internal_msg_queue.callbacks.swap_remove(&ack);
                let cb = callback_opt.unwrap();
                event_loop.run_callback(
                    cb,
                    global,
                    ipc_data.internal_msg_queue.worker.get().unwrap(),
                    &[
                        message,
                        JSValue::NULL, // handle
                    ],
                );
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

/// `clusterRawBind(addressType, address, port, flags)` — bind-only socket
/// creation for cluster's SharedHandle (node's `net._createServerHandle` /
/// `dgram._createSocketHandle` without the wrap object). The primary binds and
/// ships the fd to workers over SCM_RIGHTS; each worker does its own
/// `listen(2)` (TCP/pipe) or `recv` (UDP) on a dup of the fd.
///
/// addressType: 4 | 6 | -1 (pipe) | "udp4" | "udp6".
/// flags: bit 0 = ipv6only, bit 2 (0x4) = UV_UDP_REUSEADDR.
/// Returns `{ fd, port }` on success or a negative errno number on failure
/// (matching the uv-style codes `util.getSystemErrorName` understands).
#[bun_jsc::host_fn]
pub(crate) fn cluster_raw_bind(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        let arguments = frame.arguments_old::<4>().ptr;
        let address_type = arguments[0];
        let address = arguments[1];
        let port = arguments[2].to_int32();
        let flags = arguments[3].to_int32();

        // UDP sockets and pipes cannot be shared across processes on Windows
        // (node's dgram clustering is ENOTSUP there too; pipes would need
        // DuplicateHandle plumbing). TCP shared handles work: the socket is
        // bound here and each worker imports a WSADuplicateSocketW copy and
        // does its own listen().
        if address_type.is_string() || address_type.to_int32() == -1 {
            return Ok(JSValue::js_number_from_int32(-bun_sys::UV_E::NOTSUP));
        }
        let atype = address_type.to_int32();

        // node's createServerHandle prefers the IPv6 wildcard when no address
        // was given (falling back to 0.0.0.0 on machines without IPv6) - on
        // Windows that is also what makes an in-use port collide correctly,
        // since a v4-wildcard bind does not conflict with an existing
        // dual-stack listener there.
        let host_owned: Vec<u8> = if address.is_string() {
            let s = bun_jsc::JSString::opaque_ref(address.as_string()).to_slice(global);
            let mut v = s.slice().to_vec();
            v.push(0);
            v
        } else {
            b"::\0".to_vec()
        };
        let fallback_host: Option<&[u8]> = if address.is_string() {
            None
        } else {
            Some(b"0.0.0.0\0")
        };
        let _ = atype;

        // flags bit 0 = ipv6only (matches the POSIX branch / UV_TCP_IPV6ONLY).
        let options: core::ffi::c_int = if flags & 1 != 0 {
            bun_uws::LIBUS_SOCKET_IPV6_ONLY
        } else {
            0
        };

        let mut out_port: core::ffi::c_int = 0;
        let mut err: core::ffi::c_int = 0;
        // SAFETY: `host_owned` is NUL-terminated; out params are live locals.
        let mut fd = unsafe {
            bun_uws::socket_transfer::bsd_create_bound_socket(
                host_owned.as_ptr().cast(),
                if port >= 0 { port } else { 0 },
                options,
                &mut out_port,
                &mut err,
            )
        };
        // WSAEADDRINUSE must NOT trigger the v4 fallback: on Windows a
        // 0.0.0.0 bind does not conflict with an existing dual-stack
        // listener, so retrying would mask the very EADDRINUSE the caller
        // needs to see. The fallback exists for machines without IPv6.
        const WSAEADDRINUSE: core::ffi::c_int = 10048;
        if fd == bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX && err != WSAEADDRINUSE {
            if let Some(v4) = fallback_host {
                // No IPv6 support: retry the IPv4 wildcard (node does the same).
                let mut err2: core::ffi::c_int = 0;
                // SAFETY: as above.
                let retry = unsafe {
                    bun_uws::socket_transfer::bsd_create_bound_socket(
                        v4.as_ptr().cast(),
                        if port >= 0 { port } else { 0 },
                        options,
                        &mut out_port,
                        &mut err2,
                    )
                };
                if retry != bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX {
                    err = 0;
                    fd = retry;
                }
            }
        }
        if fd == bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX {
            // Contract: negative uv-style errno. `err` is a WSA error code;
            // uv_translate_sys_error returns the matching negative UV_E*.
            // SAFETY: pure translation function.
            let uv_err = unsafe { bun_libuv_sys::uv_translate_sys_error(err) };
            // -4094 is UV_UNKNOWN (no `UV_E` const is generated for it).
            return Ok(JSValue::js_number_from_int32(if uv_err != 0 {
                uv_err
            } else {
                -4094
            }));
        }

        let obj = JSValue::create_empty_object(global, 2);
        obj.put(global, b"fd", JSValue::js_number_from_uint64(fd as u64));
        obj.put(global, b"port", JSValue::js_number_from_int32(out_port));
        return Ok(obj);
    }
    #[cfg(not(windows))]
    {
        use core::ffi::c_int;

        let arguments = frame.arguments_old::<4>().ptr;
        let address_type = arguments[0];
        let address = arguments[1];
        let port = arguments[2].to_int32();
        let flags = arguments[3].to_int32();

        let mut is_udp = false;
        let atype: i32;
        if address_type.is_string() {
            let s = bun_jsc::JSString::opaque_ref(address_type.as_string()).to_slice(global);
            is_udp = true;
            atype = if s.slice() == b"udp6" { 6 } else { 4 };
        } else {
            atype = address_type.to_int32();
        }

        fn last_neg_errno() -> JSValue {
            JSValue::js_number_from_int32(-bun_core::ffi::errno())
        }

        unsafe fn close_fd(fd: c_int) {
            unsafe {
                libc::close(fd);
            }
        }

        fn set_cloexec_nonblock(fd: c_int) {
            unsafe {
                let fl = libc::fcntl(fd, libc::F_GETFD);
                libc::fcntl(fd, libc::F_SETFD, fl | libc::FD_CLOEXEC);
                let fl = libc::fcntl(fd, libc::F_GETFL);
                libc::fcntl(fd, libc::F_SETFL, fl | libc::O_NONBLOCK);
            }
        }

        // Pipe (UNIX domain) server: bind to the path.
        if atype == -1 {
            if !address.is_string() {
                return Err(global.throw_invalid_argument_type_value("address", "string", address));
            }
            let path_slice = bun_jsc::JSString::opaque_ref(address.as_string()).to_slice(global);
            let path_bytes = path_slice.slice();
            let mut sun: libc::sockaddr_un = unsafe { core::mem::zeroed() };
            sun.sun_family = libc::AF_UNIX as libc::sa_family_t;
            if path_bytes.len() >= sun.sun_path.len() {
                return Ok(JSValue::js_number_from_int32(-(libc::ENAMETOOLONG)));
            }
            for (i, b) in path_bytes.iter().enumerate() {
                sun.sun_path[i] = *b as _;
            }
            unsafe {
                let fd = libc::socket(libc::AF_UNIX, libc::SOCK_STREAM, 0);
                if fd < 0 {
                    return Ok(last_neg_errno());
                }
                set_cloexec_nonblock(fd);
                let len = core::mem::size_of::<libc::sockaddr_un>() as libc::socklen_t;
                if libc::bind(fd, (&raw const sun).cast(), len) != 0 {
                    let e = last_neg_errno();
                    close_fd(fd);
                    return Ok(e);
                }
                let obj = JSValue::create_empty_object(global, 2);
                obj.put(global, b"fd", JSValue::js_number_from_int32(fd));
                obj.put(global, b"port", JSValue::js_number_from_int32(-1));
                return Ok(obj);
            }
        }

        let family: c_int = if atype == 6 {
            libc::AF_INET6
        } else {
            libc::AF_INET
        };
        let socktype: c_int = if is_udp {
            libc::SOCK_DGRAM
        } else {
            libc::SOCK_STREAM
        };

        // Resolve the address. Cluster normally passes an IP literal or null;
        // a hostname (e.g. "localhost") falls back to getaddrinfo.
        let mut ss: libc::sockaddr_storage = unsafe { core::mem::zeroed() };
        let ss_len: libc::socklen_t;
        if address.is_string() {
            let addr_slice = bun_jsc::JSString::opaque_ref(address.as_string()).to_slice(global);
            let addr_bytes = addr_slice.slice();
            let mut addr_z: [u8; 256] = [0; 256];
            if addr_bytes.len() >= addr_z.len() {
                return Ok(JSValue::js_number_from_int32(-(libc::EINVAL)));
            }
            addr_z[..addr_bytes.len()].copy_from_slice(addr_bytes);

            let parsed = unsafe {
                if family == libc::AF_INET6 {
                    let sin6: &mut libc::sockaddr_in6 =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in6>();
                    sin6.sin6_family = libc::AF_INET6 as libc::sa_family_t;
                    sin6.sin6_port = (port as u16).to_be();
                    // The libc crate does not bind inet_pton; use the vendored
                    // c-ares implementation (same convention as bun_core).
                    bun_core::immutable::ares_inet_pton(
                        libc::AF_INET6,
                        addr_z.as_ptr().cast(),
                        (&raw mut sin6.sin6_addr).cast(),
                    ) == 1
                } else {
                    let sin: &mut libc::sockaddr_in =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in>();
                    sin.sin_family = libc::AF_INET as libc::sa_family_t;
                    sin.sin_port = (port as u16).to_be();
                    bun_core::immutable::ares_inet_pton(
                        libc::AF_INET,
                        addr_z.as_ptr().cast(),
                        (&raw mut sin.sin_addr).cast(),
                    ) == 1
                }
            };
            if !parsed {
                // Hostname: numeric-service getaddrinfo with the family hint.
                let mut hints: libc::addrinfo = unsafe { core::mem::zeroed() };
                hints.ai_family = family;
                hints.ai_socktype = socktype;
                let mut res: *mut libc::addrinfo = core::ptr::null_mut();
                let rc = unsafe {
                    libc::getaddrinfo(addr_z.as_ptr().cast(), core::ptr::null(), &hints, &mut res)
                };
                if rc != 0 || res.is_null() {
                    return Ok(JSValue::js_number_from_int32(-(libc::EINVAL)));
                }
                unsafe {
                    let ai = &*res;
                    core::ptr::copy_nonoverlapping(
                        ai.ai_addr.cast::<u8>(),
                        (&raw mut ss).cast::<u8>(),
                        ai.ai_addrlen as usize,
                    );
                    libc::freeaddrinfo(res);
                    if family == libc::AF_INET6 {
                        (*(&raw mut ss).cast::<libc::sockaddr_in6>()).sin6_port =
                            (port as u16).to_be();
                    } else {
                        (*(&raw mut ss).cast::<libc::sockaddr_in>()).sin_port =
                            (port as u16).to_be();
                    }
                }
            }
            ss_len = if family == libc::AF_INET6 {
                core::mem::size_of::<libc::sockaddr_in6>() as libc::socklen_t
            } else {
                core::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t
            };
        } else {
            // No address: any-address for the family.
            unsafe {
                if family == libc::AF_INET6 {
                    let sin6: &mut libc::sockaddr_in6 =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in6>();
                    sin6.sin6_family = libc::AF_INET6 as libc::sa_family_t;
                    sin6.sin6_port = (port as u16).to_be();
                    sin6.sin6_addr = core::mem::zeroed(); // in6addr_any
                    ss_len = core::mem::size_of::<libc::sockaddr_in6>() as libc::socklen_t;
                } else {
                    let sin: &mut libc::sockaddr_in =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in>();
                    sin.sin_family = libc::AF_INET as libc::sa_family_t;
                    sin.sin_port = (port as u16).to_be();
                    sin.sin_addr.s_addr = libc::INADDR_ANY.to_be();
                    ss_len = core::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t;
                }
            }
        }

        unsafe {
            let fd = libc::socket(family, socktype, 0);
            if fd < 0 {
                return Ok(last_neg_errno());
            }
            set_cloexec_nonblock(fd);

            let one: c_int = 1;
            let one_ptr = (&raw const one).cast::<core::ffi::c_void>();
            let one_len = core::mem::size_of::<c_int>() as libc::socklen_t;
            if !is_udp {
                // libuv sets SO_REUSEADDR on every TCP server socket.
                libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, one_ptr, one_len);
            } else if flags & 0x4 != 0 {
                // UV_UDP_REUSEADDR: SO_REUSEPORT on BSD/macOS, SO_REUSEADDR on Linux.
                #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
                {
                    libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_REUSEPORT, one_ptr, one_len);
                    libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, one_ptr, one_len);
                }
                #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "freebsd")))]
                {
                    libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, one_ptr, one_len);
                }
            }
            if family == libc::AF_INET6 {
                // Always set the option explicitly (0 or 1): some kernels
                // default to v6only=1 (FreeBSD, sysctl'd Linux), and node's
                // uv__tcp_bind always writes it for AF_INET6.
                let v6only: libc::c_int = if flags & 0x1 != 0 { 1 } else { 0 };
                libc::setsockopt(
                    fd,
                    libc::IPPROTO_IPV6,
                    libc::IPV6_V6ONLY,
                    (&raw const v6only).cast(),
                    one_len,
                );
            }

            if libc::bind(fd, (&raw const ss).cast(), ss_len) != 0 {
                let e = last_neg_errno();
                close_fd(fd);
                return Ok(e);
            }

            // Report the kernel-assigned port for port-0 binds.
            let mut bound_port = port;
            let mut out: libc::sockaddr_storage = core::mem::zeroed();
            let mut out_len = core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
            if libc::getsockname(fd, (&raw mut out).cast(), &mut out_len) == 0 {
                bound_port = if family == libc::AF_INET6 {
                    u16::from_be((*(&raw const out).cast::<libc::sockaddr_in6>()).sin6_port) as i32
                } else {
                    u16::from_be((*(&raw const out).cast::<libc::sockaddr_in>()).sin_port) as i32
                };
            }

            let obj = JSValue::create_empty_object(global, 2);
            obj.put(global, b"fd", JSValue::js_number_from_int32(fd));
            obj.put(global, b"port", JSValue::js_number_from_int32(bound_port));
            Ok(obj)
        }
    }
}

/// `clusterCloseHandle(fd)` — close a numeric fd held by cluster JS (shared
/// listen handles that were never adopted by a native socket). On Windows the
/// number is a raw SOCKET, which must go through closesocket();
/// `fs.closeSync` would route it through the CRT fd table and close an
/// unrelated descriptor.
#[bun_jsc::host_fn]
pub(crate) fn cluster_close_handle(
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    let _ = global;
    let value = frame.arguments_old::<1>().ptr[0];
    if value.is_number() {
        #[cfg(windows)]
        {
            let raw = value.to_number(global)?;
            if raw.is_finite() && raw >= 0.0 {
                bun_uws::socket_transfer::bsd_close_socket(
                    raw as u64 as bun_uws::LIBUS_SOCKET_DESCRIPTOR,
                );
            }
        }
        #[cfg(not(windows))]
        {
            let fd = value.to_int32();
            if fd >= 0 {
                // SAFETY: closing a caller-owned descriptor.
                unsafe { libc::close(fd) };
            }
        }
    }
    Ok(JSValue::UNDEFINED)
}
