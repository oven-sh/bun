// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use bun_jsc::ipc::{IsInternal, SerializeAndSendResult};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StrongOptional};

use crate::api::bun::subprocess::Subprocess;

// Struct moved to `bun_jsc::ipc` (cycle-break per docs/PORTING.md) —
// `SendQueue` stores one inline so it must live at that tier. Re-exported here so
// existing `bun_runtime` paths (`node_cluster_binding::InternalMsgHolder`) keep working.
pub use bun_jsc::ipc::InternalMsgHolder;

bun_output::declare_scope!(IPC, visible);

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
    handle: JSValue,
) -> JsResult<()> {
    bun_output::scoped_log!(IPC, "handleInternalMessageChild");

    child_singleton().dispatch(message, handle, global)
}

#[bun_jsc::host_fn]
pub(crate) fn send_helper_primary(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    bun_output::scoped_log!(IPC, "sendHelperPrimary");

    let arguments = frame.arguments_old::<4>().ptr;
    let Some(subprocess) = arguments[0].as_class_ref::<Subprocess<'_>>() else {
        return Ok(JSValue::NULL);
    };
    let message = arguments[1];
    let handle = arguments[2];
    let callback = arguments[3];

    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(JSValue::NULL);
    };

    if message.is_undefined() {
        return Err(global.throw_missing_arguments_value(&["message"]));
    }
    if !message.is_object() {
        return Err(global.throw_invalid_argument_type_value("message", "object", message));
    }
    let mut native_handle: Option<bun_jsc::ipc::Handle> = None;
    if !handle.is_null() && !handle.is_undefined() {
        let Some(fd_value) = handle.get(global, "fd")? else {
            return Err(global.throw(format_args!("cluster handle is missing 'fd'")));
        };
        if !fd_value.is_number() {
            return Err(global.throw_invalid_argument_type_value("handle.fd", "number", fd_value));
        }
        #[cfg(not(windows))]
        let native_fd = {
            let raw_fd = fd_value.to_int32();
            if raw_fd < 0 {
                return Ok(JSValue::NULL);
            }
            bun_sys::Fd::from_uv(raw_fd)
        };
        #[cfg(windows)]
        let native_fd = {
            let raw = fd_value.to_number(global)?;
            if !(raw.is_finite() && raw >= 0.0) {
                return Ok(JSValue::NULL);
            }
            bun_sys::Fd::from_system(raw as u64 as usize as *mut core::ffi::c_void)
        };
        message.put(global, b"$hasHandle", JSValue::TRUE);
        #[cfg(windows)]
        {
            let peer_pid = subprocess.pid() as u32;
            let Some(hex) = crate::ipc_host::attach_windows_socket_payload(
                global, message, native_fd, peer_pid,
            ) else {
                return Ok(JSValue::NULL);
            };
            let mut h = bun_jsc::ipc::Handle::init(native_fd, handle);
            h.win_export_hex = Some(hex);
            h.peer_pid = peer_pid;
            native_handle = Some(h);
        }
        #[cfg(not(windows))]
        {
            native_handle = match bun_jsc::ipc::Handle::init_dup(native_fd, handle, false) {
                Ok(h) => Some(h),
                Err(_) => return Ok(JSValue::NULL),
            };
        }
    }
    let this_seq = ipc_data.internal_msg_queue.seq;
    if callback.is_function() {
        let _ = ipc_data
            .internal_msg_queue
            .callbacks
            .put(this_seq, StrongOptional::create(callback, global));
        if let Some(h) = &mut native_handle {
            h.cluster_seq = Some(this_seq);
        }
    }

    // sequence number for InternalMsgHolder
    message.put(global, b"seq", JSValue::js_number(this_seq as f64));
    ipc_data.internal_msg_queue.seq = this_seq.wrapping_add(1);

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

    let success = ipc_data.serialize_and_send(
        global,
        message,
        IsInternal::Internal,
        JSValue::NULL,
        native_handle,
    );
    Ok(match success {
        SerializeAndSendResult::Success => JSValue::TRUE,
        SerializeAndSendResult::Backoff => JSValue::FALSE,
        SerializeAndSendResult::Failure => JSValue::NULL,
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
pub(crate) fn channel_fd(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // Node parity: `process.channel.fd` is the raw IPC descriptor while the
    // channel is open, `undefined` otherwise (v26.3.0
    // lib/internal/child_process.js Control#fd).
    let vm = global.bun_vm().as_mut();
    let Some(instance) = vm.get_ipc_instance() else {
        return Ok(JSValue::UNDEFINED);
    };
    // SAFETY: get_ipc_instance returns the VM-owned live heap pointer.
    let fd = unsafe { (*instance).data.channel_fd() };
    Ok(match fd {
        Some(fd) => JSValue::from(fd.native() as i32),
        None => JSValue::UNDEFINED,
    })
}

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

#[bun_jsc::host_fn]
pub(crate) fn cluster_raw_bind(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    {
        let arguments = frame.arguments_old::<4>().ptr;
        let address_type = arguments[0];
        let address = arguments[1];
        let port = arguments[2].to_int32();
        let flags = arguments[3].to_int32();

        if address_type.is_string() || address_type.to_int32() == -1 {
            return Ok(JSValue::js_number_from_int32(-bun_sys::UV_E::NOTSUP));
        }
        let atype = address_type.to_int32();

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
        const WSAEADDRINUSE: core::ffi::c_int = 10048;
        if fd == bun_uws::LIBUS_SOCKET_DESCRIPTOR::MAX && err != WSAEADDRINUSE {
            if let Some(v4) = fallback_host {
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
            // SAFETY: pure translation function.
            let uv_err = unsafe { bun_libuv_sys::uv_translate_sys_error(err) };
            return Ok(JSValue::js_number_from_int32(if uv_err != 0 {
                uv_err
            } else {
                -4094
            }));
        }

        let obj = JSValue::create_empty_object(global, 2);
        obj.put(
            global,
            b"fd",
            if (fd as u64) <= i32::MAX as u64 {
                JSValue::js_number_from_int32(fd as i32)
            } else {
                JSValue::js_number_from_uint64(fd as u64)
            },
        );
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

        fn close_fd(fd: c_int) {
            bun_sys::FdExt::close(bun_sys::Fd::from_native(fd));
        }

        fn set_cloexec_nonblock(fd: c_int) {
            let fd = bun_sys::Fd::from_native(fd);
            let _ = bun_sys::set_close_on_exec(fd);
            let _ = bun_sys::set_nonblocking(fd);
        }

        if atype == -1 {
            if !address.is_string() {
                return Err(global.throw_invalid_argument_type_value("address", "string", address));
            }
            let path_slice = bun_jsc::JSString::opaque_ref(address.as_string()).to_slice(global);
            let path_bytes = path_slice.slice();
            // SAFETY: sockaddr_un is plain C data; all-zero is a valid value.
            let mut sun: libc::sockaddr_un = unsafe { bun_core::ffi::zeroed_unchecked() };
            sun.sun_family = libc::AF_UNIX as libc::sa_family_t;
            if path_bytes.len() >= sun.sun_path.len() {
                return Ok(JSValue::js_number_from_int32(-(libc::ENAMETOOLONG)));
            }
            for (i, b) in path_bytes.iter().enumerate() {
                sun.sun_path[i] = *b as _;
            }
            // SAFETY: socket/bind FFI with a NUL-safe sockaddr built above;
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

        fn wildcard_sockaddr(
            family: c_int,
            port: i32,
        ) -> (libc::sockaddr_storage, libc::socklen_t) {
            // SAFETY: sockaddr_storage is plain C data; all-zero is a valid
            unsafe {
                let mut ss: libc::sockaddr_storage = bun_core::ffi::zeroed_unchecked();
                let ss_len: libc::socklen_t = if family == libc::AF_INET6 {
                    let sin6: &mut libc::sockaddr_in6 =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in6>();
                    sin6.sin6_family = libc::AF_INET6 as libc::sa_family_t;
                    sin6.sin6_port = (port as u16).to_be();
                    core::mem::size_of::<libc::sockaddr_in6>() as libc::socklen_t
                } else {
                    let sin: &mut libc::sockaddr_in =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in>();
                    sin.sin_family = libc::AF_INET as libc::sa_family_t;
                    sin.sin_port = (port as u16).to_be();
                    sin.sin_addr.s_addr = libc::INADDR_ANY.to_be();
                    core::mem::size_of::<libc::sockaddr_in>() as libc::socklen_t
                };
                (ss, ss_len)
            }
        }

        fn create_and_bind(
            family: c_int,
            socktype: c_int,
            is_udp: bool,
            flags: i32,
            ss: &libc::sockaddr_storage,
            ss_len: libc::socklen_t,
        ) -> Result<c_int, i32> {
            // SAFETY: socket/setsockopt/bind FFI on a freshly created fd with
            unsafe {
                let fd = libc::socket(family, socktype, 0);
                if fd < 0 {
                    return Err(-bun_core::ffi::errno());
                }
                set_cloexec_nonblock(fd);

                let one: c_int = 1;
                let one_ptr = (&raw const one).cast::<core::ffi::c_void>();
                let one_len = core::mem::size_of::<c_int>() as libc::socklen_t;
                if !is_udp {
                    libc::setsockopt(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, one_ptr, one_len);
                } else if flags & 0x4 != 0 {
                    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
                    {
                        libc::setsockopt(
                            fd,
                            libc::SOL_SOCKET,
                            libc::SO_REUSEPORT,
                            one_ptr,
                            one_len,
                        );
                        libc::setsockopt(
                            fd,
                            libc::SOL_SOCKET,
                            libc::SO_REUSEADDR,
                            one_ptr,
                            one_len,
                        );
                    }
                    #[cfg(not(any(
                        target_os = "macos",
                        target_os = "ios",
                        target_os = "freebsd"
                    )))]
                    {
                        libc::setsockopt(
                            fd,
                            libc::SOL_SOCKET,
                            libc::SO_REUSEADDR,
                            one_ptr,
                            one_len,
                        );
                    }
                }
                if family == libc::AF_INET6 {
                    let v6only: libc::c_int = if flags & 0x1 != 0 { 1 } else { 0 };
                    libc::setsockopt(
                        fd,
                        libc::IPPROTO_IPV6,
                        libc::IPV6_V6ONLY,
                        (&raw const v6only).cast(),
                        one_len,
                    );
                }

                if libc::bind(fd, core::ptr::from_ref(ss).cast(), ss_len) != 0 {
                    let e = -bun_core::ffi::errno();
                    close_fd(fd);
                    return Err(e);
                }
                Ok(fd)
            }
        }

        // SAFETY: sockaddr_storage is plain C data; all-zero is a valid value.
        let mut ss: libc::sockaddr_storage = unsafe { bun_core::ffi::zeroed_unchecked() };
        let ss_len: libc::socklen_t;
        let fd: c_int;
        let bound_family: c_int;
        if address.is_string() {
            let addr_slice = bun_jsc::JSString::opaque_ref(address.as_string()).to_slice(global);
            let addr_bytes = addr_slice.slice();
            let mut addr_z: [u8; 256] = [0; 256];
            if addr_bytes.len() >= addr_z.len() {
                return Ok(JSValue::js_number_from_int32(-(libc::EINVAL)));
            }
            addr_z[..addr_bytes.len()].copy_from_slice(addr_bytes);

            // SAFETY: `ss` is a zeroed sockaddr_storage large enough for
            let parsed = unsafe {
                if family == libc::AF_INET6 {
                    let sin6: &mut libc::sockaddr_in6 =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in6>();
                    sin6.sin6_family = libc::AF_INET6 as libc::sa_family_t;
                    sin6.sin6_port = (port as u16).to_be();
                    bun_core::strings::ares_inet_pton(
                        libc::AF_INET6,
                        addr_z.as_ptr().cast(),
                        (&raw mut sin6.sin6_addr).cast(),
                    ) == 1
                } else {
                    let sin: &mut libc::sockaddr_in =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in>();
                    sin.sin_family = libc::AF_INET as libc::sa_family_t;
                    sin.sin_port = (port as u16).to_be();
                    bun_core::strings::ares_inet_pton(
                        libc::AF_INET,
                        addr_z.as_ptr().cast(),
                        (&raw mut sin.sin_addr).cast(),
                    ) == 1
                }
            };
            if !parsed {
                // SAFETY: addrinfo is plain C data; all-zero is a valid hints value.
                let mut hints: libc::addrinfo = unsafe { bun_core::ffi::zeroed_unchecked() };
                hints.ai_family = family;
                hints.ai_socktype = socktype;
                let mut res: *mut libc::addrinfo = core::ptr::null_mut();
                // SAFETY: `addr_z` is NUL-terminated; out-params are live locals.
                let rc = unsafe {
                    libc::getaddrinfo(
                        addr_z.as_ptr().cast(),
                        core::ptr::null(),
                        &raw const hints,
                        &raw mut res,
                    )
                };
                if rc != 0 || res.is_null() {
                    return Ok(JSValue::js_number_from_int32(-(libc::EINVAL)));
                }
                // SAFETY: rc == 0 and res was null-checked; ai_addr/ai_addrlen
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
            match create_and_bind(family, socktype, is_udp, flags, &ss, ss_len) {
                Ok(bound) => {
                    fd = bound;
                    bound_family = family;
                }
                Err(e) => return Ok(JSValue::js_number_from_int32(e)),
            }
        } else {
            let (ss6, len6) = wildcard_sockaddr(libc::AF_INET6, port);
            match create_and_bind(libc::AF_INET6, socktype, is_udp, flags, &ss6, len6) {
                Ok(bound) => {
                    fd = bound;
                    bound_family = libc::AF_INET6;
                }
                Err(e) if e == -(libc::EADDRINUSE) => {
                    return Ok(JSValue::js_number_from_int32(e));
                }
                Err(_) => {
                    let (ss4, len4) = wildcard_sockaddr(libc::AF_INET, port);
                    match create_and_bind(libc::AF_INET, socktype, is_udp, flags, &ss4, len4) {
                        Ok(bound) => {
                            fd = bound;
                            bound_family = libc::AF_INET;
                        }
                        Err(e) => return Ok(JSValue::js_number_from_int32(e)),
                    }
                }
            }
        }

        // SAFETY: getsockname FFI on the bound fd with a properly sized
        unsafe {
            let mut bound_port = port;
            let mut out: libc::sockaddr_storage = bun_core::ffi::zeroed_unchecked();
            let mut out_len = core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
            if libc::getsockname(fd, (&raw mut out).cast(), &raw mut out_len) == 0 {
                bound_port = if bound_family == libc::AF_INET6 {
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

#[bun_jsc::host_fn]
pub(crate) fn cluster_validate_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    let _ = global;
    let value = frame.arguments_old::<1>().ptr[0];
    if !value.is_number() {
        return Ok(JSValue::js_number_from_int32(-bun_sys::UV_E::INVAL));
    }
    #[cfg(not(windows))]
    {
        let fd = value.to_int32();
        if fd < 0 {
            return Ok(JSValue::js_number_from_int32(-bun_sys::UV_E::BADF));
        }
        let mut ty: libc::c_int = 0;
        let mut len = core::mem::size_of::<libc::c_int>() as libc::socklen_t;
        // SAFETY: plain getsockopt on a caller-supplied fd; out-params are
        let rc = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_TYPE,
                (&raw mut ty).cast(),
                &raw mut len,
            )
        };
        if rc != 0 {
            return Ok(JSValue::js_number_from_int32(-bun_core::ffi::errno()));
        }
        if ty != libc::SOCK_STREAM && ty != libc::SOCK_DGRAM {
            return Ok(JSValue::js_number_from_int32(-bun_sys::UV_E::INVAL));
        }
        Ok(JSValue::js_number_from_int32(0))
    }
    #[cfg(windows)]
    {
        let _ = value;
        Ok(JSValue::js_number_from_int32(-bun_sys::UV_E::INVAL))
    }
}

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
                bun_sys::FdExt::close(bun_sys::Fd::from_native(fd));
            }
        }
    }
    Ok(JSValue::UNDEFINED)
}
