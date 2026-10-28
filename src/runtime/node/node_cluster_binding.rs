// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use crate::ipc::{IsInternal, SerializeAndSendResult};
use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsResult, StrongOptional};

use crate::api::bun::subprocess::Subprocess;
use crate::generated_bindgen::node_cluster_binding::{
    BindAddress, BindAddressType, BindResult, BoundHandle,
};

// Struct lives in `crate::ipc` —
// `SendQueue` stores one inline so it must live at that tier. Re-exported here so
// existing `bun_runtime` paths (`node_cluster_binding::InternalMsgHolder`) keep working.
pub(crate) use crate::ipc::InternalMsgHolder;

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

pub(crate) fn on_internal_message_child<'a>(
    cx: &mut JsScope<'a>,
    worker: JsLocal<'a>,
    callback: JsLocal<'a>,
) -> JsResult<()> {
    bun_output::scoped_log!(IPC, "onInternalMessageChild");
    let global = cx.global();
    let singleton = child_singleton();
    // TODO: we should not create two jsc.Strong.Optional here. If absolutely necessary, a single Array. should be all we use.
    singleton.worker = StrongOptional::create(worker.to_js(), global);
    singleton.cb = StrongOptional::create(callback.to_js(), global);
    singleton.flush(global)
}

pub(crate) fn handle_internal_message_child(
    global: &JSGlobalObject,
    message: JSValue,
    handle: JSValue,
) -> JsResult<()> {
    bun_output::scoped_log!(IPC, "handleInternalMessageChild");

    child_singleton().dispatch(message, handle, global)
}

pub(crate) fn send_helper_primary<'a>(
    cx: &mut JsScope<'a>,
    process_handle: Option<&Subprocess>,
    message: JsLocal<'a, JSObject>,
    handle: Option<JsLocal<'a, JSObject>>,
    callback: Option<JsLocal<'a, Callable>>,
) -> JsResult<Option<bool>> {
    bun_output::scoped_log!(IPC, "sendHelperPrimary");

    // `cluster.Worker({ process })` accepts any object, so `process[kHandle]`
    // is `undefined` unless `cluster.fork()` created the process; Node's
    // `sendHelper` returns false for a worker with no IPC channel.
    let Some(subprocess) = process_handle else {
        return Ok(None);
    };
    let global = cx.global();
    let message = message.to_js();

    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(None);
    };

    let mut native_handle: Option<crate::ipc::Handle> = None;
    if let Some(handle) = handle {
        let handle = handle.to_js();
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
                return Ok(None);
            }
            bun_sys::Fd::from_uv(raw_fd)
        };
        #[cfg(windows)]
        let native_fd = {
            let raw = fd_value.to_number(global)?;
            if !(raw.is_finite() && raw >= 0.0) {
                return Ok(None);
            }
            bun_sys::Fd::from_system(raw as u64 as usize as *mut core::ffi::c_void)
        };
        message.put(global, b"$hasHandle", JSValue::TRUE);
        #[cfg(windows)]
        {
            let peer_pid = subprocess.pid() as u32;
            let Some(hex) = crate::ipc_host::attach_windows_socket_payload(
                global, message, native_fd, peer_pid,
            )?
            else {
                return Ok(None);
            };
            let mut h = crate::ipc::Handle::init(native_fd, handle);
            h.win_export_hex = Some(hex);
            h.peer_pid = peer_pid;
            native_handle = Some(h);
        }
        #[cfg(not(windows))]
        {
            native_handle = match crate::ipc::Handle::init_dup(native_fd, handle, false) {
                Ok(h) => Some(h),
                Err(_) => return Ok(None),
            };
        }
    }
    let this_seq = ipc_data.internal_msg_queue.with_mut(|q| {
        let seq = q.seq;
        if let Some(callback) = callback {
            let _ = q
                .callbacks
                .put(seq, StrongOptional::create(callback.to_js(), global));
        }
        q.seq = seq.wrapping_add(1);
        seq
    });
    if callback.is_some() {
        if let Some(h) = &mut native_handle {
            h.cluster_seq = Some(this_seq);
        }
    }

    // sequence number for InternalMsgHolder
    message.put(global, b"seq", JSValue::js_number(this_seq as f64));

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
        SerializeAndSendResult::Success => Some(true),
        SerializeAndSendResult::Backoff => Some(false),
        SerializeAndSendResult::Failure => None,
    })
}

pub(crate) fn on_internal_message_primary<'a>(
    cx: &mut JsScope<'a>,
    handle: Option<&Subprocess>,
    worker: JsLocal<'a>,
    callback: JsLocal<'a>,
) {
    // Same guard as `send_helper_primary`: nothing to subscribe to when the
    // worker's process has no native child handle.
    let Some(subprocess) = handle else {
        return;
    };
    let Some(ipc_data) = subprocess.ipc() else {
        return;
    };
    let global = cx.global();
    // TODO: remove these strongs.
    ipc_data.internal_msg_queue.with_mut(|q| {
        q.worker = StrongOptional::create(worker.to_js(), global);
        q.cb = StrongOptional::create(callback.to_js(), global);
    });
}

pub(crate) fn handle_internal_message_primary(
    global: &JSGlobalObject,
    subprocess: &Subprocess<'_>,
    message: JSValue,
) -> JsResult<()> {
    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(());
    };

    if !ipc_data.internal_msg_queue.get().is_ready() {
        return Ok(());
    }

    let event_loop = global.bun_vm().event_loop_mut();

    // TODO: investigate if "ack" and "seq" are observable and if they're not, remove them entirely.
    if let Some(p) = message.get(global, "ack")? {
        if p.is_int32() {
            let ack = p.as_int32();
            let entry = ipc_data.internal_msg_queue.with_mut(|q| {
                let cb = q.callbacks.get(&ack).and_then(|s| s.get());
                if q.callbacks.contains_key(&ack) {
                    q.callbacks.swap_remove(&ack);
                }
                cb.zip(q.worker.get())
            });
            if let Some((cb, worker)) = entry {
                event_loop.run_callback(
                    subprocess.context,
                    cb,
                    global,
                    worker,
                    &[
                        message,
                        JSValue::NULL, // handle
                    ],
                );
                return Ok(());
            }
        }
    }
    let (cb, worker) = {
        let q = ipc_data.internal_msg_queue.get();
        (q.cb.get().unwrap(), q.worker.get().unwrap())
    };
    event_loop.run_callback(
        subprocess.context,
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

//
//
//

pub(crate) fn set_ref(enabled: bool) {
    let vm = VirtualMachine::get().as_mut();
    vm.channel_ref_overridden = true;
    if enabled {
        vm.channel_ref.ref_(bun_io::js_vm_ctx());
    } else {
        vm.channel_ref.unref(bun_io::js_vm_ctx());
    }
}

// HOST_EXPORT(Bun__refChannelUnlessOverridden, c)
pub(crate) fn ref_channel_unless_overridden(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if !vm.channel_ref_overridden {
        vm.channel_ref.ref_(bun_io::js_vm_ctx());
    }
}

// HOST_EXPORT(Bun__unrefChannelUnlessOverridden, c)
pub(crate) fn unref_channel_unless_overridden(global: &JSGlobalObject) {
    let vm = global.bun_vm().as_mut();
    if !vm.channel_ref_overridden {
        vm.channel_ref.unref(bun_io::js_vm_ctx());
    }
}

pub(crate) fn channel_ignore_one_disconnect_event_listener() {
    let vm = VirtualMachine::get().as_mut();
    vm.channel_ref_should_ignore_one_disconnect_event_listener = true;
}

// HOST_EXPORT(Bun__shouldIgnoreOneDisconnectEventListener, c)
pub(crate) fn should_ignore_one_disconnect_event_listener(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    vm.channel_ref_should_ignore_one_disconnect_event_listener
}

pub(crate) fn cluster_raw_bind<'a>(
    cx: &mut JsScope<'a>,
    address_type: BindAddressType<'a>,
    address: BindAddress<'a>,
    port: f64,
    flags: i32,
) -> JsResult<BindResult> {
    let port = port as i32;

    #[cfg(windows)]
    {
        let _ = cx;
        match address_type {
            BindAddressType::Udp(_) => return Ok(BindResult::Errno(-bun_sys::UV_E::NOTSUP)),
            BindAddressType::Family(family) if family == -1.0 => {
                return Ok(BindResult::Errno(-bun_sys::UV_E::NOTSUP));
            }
            BindAddressType::Family(_) | BindAddressType::Ignored(_) => {}
        }

        let (host_owned, fallback_host): (Vec<u8>, Option<&[u8]>) = match address {
            BindAddress::Text(host) => {
                let mut v = host.to_vec();
                v.push(0);
                (v, None)
            }
            BindAddress::Ignored(_) => (b"::\0".to_vec(), Some(b"0.0.0.0\0")),
        };

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
            return Ok(BindResult::Errno(if uv_err != 0 { uv_err } else { -4094 }));
        }

        return Ok(BindResult::Handle(BoundHandle {
            fd: fd as u64,
            port: out_port,
        }));
    }
    #[cfg(not(windows))]
    {
        use core::ffi::c_int;

        let (is_udp, atype): (bool, i32) = match address_type {
            BindAddressType::Udp(name) => (true, if name == b"udp6" { 6 } else { 4 }),
            BindAddressType::Family(6.0) => (false, 6),
            BindAddressType::Family(-1.0) => (false, -1),
            BindAddressType::Family(_) | BindAddressType::Ignored(_) => (false, 4),
        };

        fn last_neg_errno() -> BindResult {
            BindResult::Errno(-bun_core::ffi::errno())
        }

        fn close_fd(fd: c_int) {
            let _ = bun_sys::FdExt::close_allowing_standard_io(bun_sys::Fd::from_native(fd), None);
        }

        fn set_cloexec_nonblock(fd: c_int) {
            let fd = bun_sys::Fd::from_native(fd);
            let _ = bun_sys::set_close_on_exec(fd);
            let _ = bun_sys::set_nonblocking(fd);
        }

        if atype == -1 {
            let path_bytes = match address {
                BindAddress::Text(path) => path,
                BindAddress::Ignored(value) => {
                    return Err(cx.global().throw_invalid_argument_type_value(
                        "address",
                        "string",
                        value.to_js(),
                    ));
                }
            };
            let mut sun: libc::sockaddr_un = bun_core::ffi::zeroed();
            sun.sun_family = libc::AF_UNIX as libc::sa_family_t;
            if path_bytes.len() >= sun.sun_path.len() {
                return Ok(BindResult::Errno(-(libc::ENAMETOOLONG)));
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
                // Abstract names (leading NUL) are length-delimited: a padded length binds a different name.
                let len = if path_bytes.first() == Some(&0) {
                    core::mem::offset_of!(libc::sockaddr_un, sun_path) + path_bytes.len()
                } else {
                    core::mem::size_of::<libc::sockaddr_un>()
                } as libc::socklen_t;
                if libc::bind(fd, (&raw const sun).cast(), len) != 0 {
                    let e = last_neg_errno();
                    close_fd(fd);
                    return Ok(e);
                }
                return Ok(BindResult::Handle(BoundHandle {
                    fd: fd as u64,
                    port: -1,
                }));
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
            let mut ss: libc::sockaddr_storage = bun_core::ffi::zeroed();
            // SAFETY: `sockaddr_storage` is sized and aligned for every sockaddr type, and all-zero
            // is a valid `sockaddr_in` / `sockaddr_in6`.
            unsafe {
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

        let mut ss: libc::sockaddr_storage = bun_core::ffi::zeroed();
        let ss_len: libc::socklen_t;
        let fd: c_int;
        let bound_family: c_int;
        if let BindAddress::Text(addr_bytes) = address {
            let mut addr_z: [u8; 256] = [0; 256];
            if addr_bytes.len() >= addr_z.len() {
                return Ok(BindResult::Errno(-(libc::EINVAL)));
            }
            addr_z[..addr_bytes.len()].copy_from_slice(addr_bytes);

            use bun_cares_sys::ares_inet_pton;
            // SAFETY: `ss` is a zeroed sockaddr_storage large enough for
            let parsed = unsafe {
                if family == libc::AF_INET6 {
                    let sin6: &mut libc::sockaddr_in6 =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in6>();
                    sin6.sin6_family = libc::AF_INET6 as libc::sa_family_t;
                    sin6.sin6_port = (port as u16).to_be();
                    ares_inet_pton(
                        libc::AF_INET6,
                        addr_z.as_ptr().cast(),
                        (&raw mut sin6.sin6_addr).cast(),
                    ) == 1
                } else {
                    let sin: &mut libc::sockaddr_in =
                        &mut *(&raw mut ss).cast::<libc::sockaddr_in>();
                    sin.sin_family = libc::AF_INET as libc::sa_family_t;
                    sin.sin_port = (port as u16).to_be();
                    ares_inet_pton(
                        libc::AF_INET,
                        addr_z.as_ptr().cast(),
                        (&raw mut sin.sin_addr).cast(),
                    ) == 1
                }
            };
            if !parsed {
                let mut hints: libc::addrinfo = bun_core::ffi::zeroed();
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
                    return Ok(BindResult::Errno(-(libc::EINVAL)));
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
                Err(e) => return Ok(BindResult::Errno(e)),
            }
        } else {
            let (ss6, len6) = wildcard_sockaddr(libc::AF_INET6, port);
            match create_and_bind(libc::AF_INET6, socktype, is_udp, flags, &ss6, len6) {
                Ok(bound) => {
                    fd = bound;
                    bound_family = libc::AF_INET6;
                }
                Err(e) if e == -(libc::EADDRINUSE) => {
                    return Ok(BindResult::Errno(e));
                }
                Err(_) => {
                    let (ss4, len4) = wildcard_sockaddr(libc::AF_INET, port);
                    match create_and_bind(libc::AF_INET, socktype, is_udp, flags, &ss4, len4) {
                        Ok(bound) => {
                            fd = bound;
                            bound_family = libc::AF_INET;
                        }
                        Err(e) => return Ok(BindResult::Errno(e)),
                    }
                }
            }
        }

        // SAFETY: getsockname FFI on the bound fd with a properly sized
        unsafe {
            let mut bound_port = port;
            let mut out: libc::sockaddr_storage = bun_core::ffi::zeroed();
            let mut out_len = core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
            if libc::getsockname(fd, (&raw mut out).cast(), &raw mut out_len) == 0 {
                bound_port = if bound_family == libc::AF_INET6 {
                    u16::from_be((*(&raw const out).cast::<libc::sockaddr_in6>()).sin6_port) as i32
                } else {
                    u16::from_be((*(&raw const out).cast::<libc::sockaddr_in>()).sin_port) as i32
                };
            }

            Ok(BindResult::Handle(BoundHandle {
                fd: fd as u64,
                port: bound_port,
            }))
        }
    }
}

/// Returns 0 if `fd` is an unconnected socket of the wanted type, or a negative errno.
pub(crate) fn cluster_validate_fd(fd: f64, want_dgram: bool) -> i32 {
    #[cfg(not(windows))]
    {
        let number = fd;
        let fd = number as i32;
        // Reject a fractional fd like 3.5 instead of truncating it.
        if f64::from(fd) != number {
            return -bun_sys::UV_E::INVAL;
        }
        if fd < 0 {
            return -bun_sys::UV_E::BADF;
        }
        let wanted = if want_dgram {
            libc::SOCK_DGRAM
        } else {
            libc::SOCK_STREAM
        };
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
        // node's createServerHandle: EINVAL for anything that cannot listen (e.g. a connected stdio socketpair), fd left untouched.
        if rc != 0 || ty != wanted {
            return -bun_sys::UV_E::INVAL;
        }
        if ty == libc::SOCK_STREAM {
            // SAFETY: sockaddr_storage is plain data; getpeername only writes within `peer_len`.
            let connected = unsafe {
                let mut peer: libc::sockaddr_storage = bun_core::ffi::zeroed();
                let mut peer_len =
                    core::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
                libc::getpeername(fd, (&raw mut peer).cast(), &raw mut peer_len) == 0
            };
            if connected {
                return -bun_sys::UV_E::INVAL;
            }
        }
        0
    }
    #[cfg(windows)]
    {
        let _ = (fd, want_dgram);
        -bun_sys::UV_E::INVAL
    }
}

pub(crate) fn cluster_close_handle(fd: f64) {
    #[cfg(windows)]
    {
        if fd.is_finite() && fd >= 0.0 {
            bun_uws::socket_transfer::bsd_close_socket(
                fd as u64 as bun_uws::LIBUS_SOCKET_DESCRIPTOR,
            );
        }
    }
    #[cfg(not(windows))]
    {
        let fd = fd as i32;
        if fd >= 0 {
            let _ = bun_sys::FdExt::close_allowing_standard_io(bun_sys::Fd::from_native(fd), None);
        }
    }
}
