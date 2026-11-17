// Most of this code should be rewritten.
// - Usage of jsc.Strong.Optional here is likely to cause memory leaks.
// - These sequence numbers and ACKs shouldn't exist from JavaScript's perspective
//   at all. It should happen in the protocol before it reaches JS.
// - We should not be creating JSFunction's in process.nextTick.

use crate::ipc::{Handle, SerializeAndSendResult};
use bun_jsc::bindgen::{Callable, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{JSGlobalObject, JSObject, JSValue, JsCell, JsResult, Strong};

use crate::api::bun::subprocess::Subprocess;
use crate::generated_bindgen::node_cluster_binding::{
    BindAddress, BindAddressType, BindResult, BoundHandle,
};

bun_output::declare_scope!(IPC, visible);

/// `callback.call(worker, message, handle)` for each message of node:cluster.
struct Listener {
    worker: Strong,
    callback: Strong,
}

impl Listener {
    fn new(global: &JSGlobalObject, worker: JsLocal<'_>, callback: JsLocal<'_>) -> Self {
        Self {
            worker: Strong::create(worker.to_js(), global),
            callback: Strong::create(callback.to_js(), global),
        }
    }

    fn get(&self) -> (JSValue, JSValue) {
        (self.worker.get(), self.callback.get())
    }
}

/// The primary's side of the channel to one worker.
#[derive(Default)]
pub(crate) struct ClusterPeer {
    seq: i32,
    /// By the `seq` of the message whose `ack` they wait for.
    callbacks: bun_collections::ArrayHashMap<i32, Strong>,
    listener: Option<Listener>,
}

impl ClusterPeer {
    pub(crate) fn take_callback(&mut self, seq: i32) -> Option<Strong> {
        Some(self.callbacks.fetch_swap_remove(&seq)?.1)
    }
}

enum ChildInbox {
    /// For node:cluster, once it is loaded.
    Queued(Vec<Strong>),
    Ready(Listener),
}

#[thread_local]
static CHILD_INBOX: JsCell<ChildInbox> = JsCell::new(ChildInbox::Queued(Vec::new()));

pub(crate) fn forget_child_listener() {
    CHILD_INBOX.set(ChildInbox::Queued(Vec::new()));
}

pub(crate) fn on_internal_message_child<'a>(
    cx: &mut JsScope<'a>,
    worker: JsLocal<'a>,
    callback: JsLocal<'a>,
) -> JsResult<()> {
    let global = cx.global();
    let ready = ChildInbox::Ready(Listener::new(global, worker, callback));
    if let ChildInbox::Queued(messages) = CHILD_INBOX.replace(ready) {
        for message in messages {
            handle_internal_message_child(global, message.get(), JSValue::NULL);
        }
    }
    Ok(())
}

/// Returns whether `handle` was passed on. A queued message goes without it.
pub(crate) fn handle_internal_message_child(
    global: &JSGlobalObject,
    message: JSValue,
    handle: JSValue,
) -> bool {
    let Some((worker, callback)) = CHILD_INBOX.with_mut(|inbox| match inbox {
        ChildInbox::Ready(listener) => Some(listener.get()),
        ChildInbox::Queued(messages) => {
            messages.push(Strong::create(message, global));
            None
        }
    }) else {
        return false;
    };
    global.bun_vm().event_loop().run_callback(
        bun_event_loop::ContextId::NONE,
        callback,
        global,
        worker,
        &[message, handle],
    );
    true
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

    let mut native_handle = None;
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
        let Ok(h) = Handle::new(native_fd, handle, false) else {
            return Ok(None);
        };
        #[cfg(windows)]
        let h = {
            let peer_pid = subprocess.pid() as u32;
            let Some(hex) = crate::ipc_host::attach_windows_socket_payload(
                global, message, native_fd, peer_pid,
            )?
            else {
                return Ok(None);
            };
            let mut h = h;
            h.win_export_hex = Some(hex);
            h.peer_pid = peer_pid;
            h
        };
        native_handle = Some(h);
    }
    let callback = callback.map(|callback| Strong::create(callback.to_js(), global));
    let this_seq = ipc_data.cluster.with_mut(|peer| {
        let seq = peer.seq;
        peer.seq = seq.wrapping_add(1);
        if let Some(callback) = callback {
            let _ = peer.callbacks.put(seq, callback);
            if let Some(h) = &mut native_handle {
                h.cluster_seq = Some(seq);
            }
        }
        seq
    });
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
        bun_ipc::Kind::Internal,
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
    let listener = Listener::new(cx.global(), worker, callback);
    (ipc_data.cluster).with_mut(|peer| peer.listener = Some(listener));
}

pub(crate) fn handle_internal_message_primary(
    global: &JSGlobalObject,
    subprocess: &Subprocess<'_>,
    message: JSValue,
) -> JsResult<()> {
    let Some(ipc_data) = subprocess.ipc() else {
        return Ok(());
    };

    let Some((worker, listener)) = ipc_data.cluster.get().listener.as_ref().map(Listener::get)
    else {
        return Ok(());
    };
    let acked = (message.get(global, "ack")?.filter(|ack| ack.is_int32()))
        .and_then(|ack| (ipc_data.cluster).with_mut(|peer| peer.take_callback(ack.as_int32())));
    global.bun_vm().event_loop().run_callback(
        subprocess.context,
        acked.as_ref().map_or(listener, Strong::get),
        global,
        worker,
        &[message, JSValue::NULL],
    );
    Ok(())
}

pub(crate) fn set_ref(enabled: bool) {
    let vm = VirtualMachine::get();
    vm.channel_ref_overridden.set(true);
    if enabled {
        vm.channel_ref.ref_(vm.loop_ctx());
    } else {
        vm.channel_ref.unref(vm.loop_ctx());
    }
}

// HOST_EXPORT(Bun__refChannelUnlessOverridden, c)
pub(crate) fn ref_channel_unless_overridden(global: &JSGlobalObject) {
    let vm = global.bun_vm();
    if !vm.channel_ref_overridden.get() {
        vm.channel_ref.ref_(vm.loop_ctx());
    }
}

// HOST_EXPORT(Bun__unrefChannelUnlessOverridden, c)
pub(crate) fn unref_channel_unless_overridden(global: &JSGlobalObject) {
    let vm = global.bun_vm();
    if !vm.channel_ref_overridden.get() {
        vm.channel_ref.unref(vm.loop_ctx());
    }
}

pub(crate) fn channel_ignore_one_disconnect_event_listener() {
    let vm = VirtualMachine::get();
    vm.channel_ref_should_ignore_one_disconnect_event_listener
        .set(true);
}

// HOST_EXPORT(Bun__shouldIgnoreOneDisconnectEventListener, c)
pub(crate) fn should_ignore_one_disconnect_event_listener(global: &JSGlobalObject) -> bool {
    let vm = global.bun_vm();
    vm.channel_ref_should_ignore_one_disconnect_event_listener
        .get()
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
            let uv_err = bun_libuv_sys::uv_translate_sys_error(err);
            return Ok(BindResult::Errno(if uv_err != 0 { uv_err } else { -4094 }));
        }

        return Ok(BindResult::Handle(BoundHandle {
            fd: fd as u64,
            port: out_port,
        }));
    }
    #[cfg(not(windows))]
    {
        use bun_sys::Fd;
        use bun_sys::net::{Address, getsockname, setsockopt_int};
        use core::ffi::c_int;
        use core::net::{Ipv4Addr, Ipv6Addr};

        let (is_udp, atype): (bool, i32) = match address_type {
            BindAddressType::Udp(name) => (true, if name == b"udp6" { 6 } else { 4 }),
            BindAddressType::Family(6.0) => (false, 6),
            BindAddressType::Family(-1.0) => (false, -1),
            BindAddressType::Family(_) | BindAddressType::Ignored(_) => (false, 4),
        };

        fn create_and_bind(
            family: c_int,
            socktype: c_int,
            flags: i32,
            address: &[u8],
        ) -> Result<Fd, i32> {
            // SAFETY: socket(2) takes no pointers.
            let fd = unsafe { libc::socket(family, socktype, 0) };
            if fd < 0 {
                return Err(-bun_core::ffi::errno());
            }
            let fd = Fd::from_native(fd);
            let _ = bun_sys::set_close_on_exec(fd);
            let _ = bun_sys::set_nonblocking(fd);

            let is_udp = socktype == libc::SOCK_DGRAM;
            if family != libc::AF_UNIX && (!is_udp || flags & 0x4 != 0) {
                #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
                if is_udp {
                    let _ = setsockopt_int(fd, libc::SOL_SOCKET, libc::SO_REUSEPORT, 1);
                }
                let _ = setsockopt_int(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, 1);
            }
            if family == libc::AF_INET6 {
                let _ = setsockopt_int(fd, libc::IPPROTO_IPV6, libc::IPV6_V6ONLY, flags & 0x1);
            }

            let len = address.len() as libc::socklen_t;
            // SAFETY: bind(2) reads at most `len` bytes of `address`.
            if unsafe { libc::bind(fd.native(), address.as_ptr().cast(), len) } != 0 {
                let e = -bun_core::ffi::errno();
                let _ = bun_sys::FdExt::close_allowing_standard_io(fd, None);
                return Err(e);
            }
            Ok(fd)
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
            // Abstract names (leading NUL) are length-delimited: a padded length binds a different name.
            let len = if path_bytes.first() == Some(&0) {
                core::mem::offset_of!(libc::sockaddr_un, sun_path) + path_bytes.len()
            } else {
                core::mem::size_of::<libc::sockaddr_un>()
            };
            let sun = &bun_core::bytes_of(&sun)[..len];
            return Ok(
                match create_and_bind(libc::AF_UNIX, libc::SOCK_STREAM, flags, sun) {
                    Ok(fd) => BindResult::Handle(BoundHandle {
                        fd: fd.native() as u64,
                        port: -1,
                    }),
                    Err(e) => BindResult::Errno(e),
                },
            );
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

        let bound = if let BindAddress::Text(addr_bytes) = address {
            let mut addr_z: [u8; 256] = [0; 256];
            let Some(host) = bun_core::strings::copy_z(&mut addr_z, addr_bytes) else {
                return Ok(BindResult::Errno(-(libc::EINVAL)));
            };

            let parsed = if family == libc::AF_INET6 {
                bun_cares_sys::pton::<16>(host).map(Into::into)
            } else {
                bun_cares_sys::pton::<4>(host).map(Into::into)
            };
            let address = if let Some(ip) = parsed {
                Address::from_ip(ip, port as u16)
            } else {
                let mut hints: libc::addrinfo = bun_core::ffi::zeroed();
                hints.ai_family = family;
                hints.ai_socktype = socktype;
                let list = bun_dns::AddrInfoList::lookup(Some(host), None, Some(&hints));
                let Some(first) = list.iter().flat_map(|list| list.addresses()).next() else {
                    return Ok(BindResult::Errno(-(libc::EINVAL)));
                };
                let mut address = Address::from_bytes(first);
                address.set_port(port as u16);
                address
            };
            create_and_bind(family, socktype, flags, address.as_bytes())
        } else {
            let any6 = Address::from_ip(Ipv6Addr::UNSPECIFIED.into(), port as u16);
            match create_and_bind(libc::AF_INET6, socktype, flags, any6.as_bytes()) {
                Err(e) if e != -(libc::EADDRINUSE) => {
                    let any4 = Address::from_ip(Ipv4Addr::UNSPECIFIED.into(), port as u16);
                    create_and_bind(libc::AF_INET, socktype, flags, any4.as_bytes())
                }
                result => result,
            }
        };
        let fd = match bound {
            Ok(fd) => fd,
            Err(e) => return Ok(BindResult::Errno(e)),
        };

        let bound_port = getsockname(fd).ok().and_then(|addr| addr.port());
        Ok(BindResult::Handle(BoundHandle {
            fd: fd.native() as u64,
            port: bound_port.map_or(port, i32::from),
        }))
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
        // SAFETY: plain getsockopt on a caller-supplied fd; out-params are live locals, and `len`
        // is the size of `ty`.
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
            // SAFETY: getpeername only writes within `peer_len`, the size of `peer`.
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
