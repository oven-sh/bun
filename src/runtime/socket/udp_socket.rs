use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};

use bun_core::{String as BunString, ZigStringSlice};
use bun_io::KeepAlive;
use bun_jsc::JsCell;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, MarkedArgumentBuffer, Ref as JscRef,
    StringJsc, SysErrorJsc, SystemError,
};
use bun_ptr::BackRef;

use crate::node::validators;
use bun_cares_sys::c_ares_draft as c_ares;
#[cfg(windows)]
use bun_libuv_sys::sockaddr_storage;
use bun_sys::{self, SystemErrno};
use bun_uws as uws;
#[cfg(not(windows))]
use libc::sockaddr_storage;
#[cfg(not(windows))]
use libc::{IF_NAMESIZE, if_indextoname, if_nametoindex};

use crate::api::SocketAddress;
use crate::socket::socket_address::inet::{self, INET6_ADDRSTRLEN, sockaddr_in, sockaddr_in6};

bun_output::declare_scope!(UdpSocket, visible);

/// Local errno-classification shim — `bun_sys::Result`
/// is a plain `core::result::Result` alias in Rust and has no associated
/// `errno_sys` constructor.
///
/// POSIX `getErrno(c_int)` semantics: only `rc == -1` is failure (any other
/// value — including positive packet counts from `us_udp_socket_send` and
/// negative EAI codes from `connect` — is "not a libc errno", so callers
/// handle it themselves).
///
/// Windows semantics: for any non-NTSTATUS
/// integer `rc`, `if (rc != 0) return null` — i.e. *every* non-zero rc
/// (including `-1` / `SOCKET_ERROR`) falls through to the caller's own EAI /
/// WSA handling rather than synthesising an errno. This matters for the
/// `connect()` path (line ~575): `us_udp_socket_connect()` returns a Winsock
/// status, not a CRT errno, so reading `_errno()` here would be the wrong
/// source.
#[inline]
fn errno_sys(rc: c_int, tag: bun_sys::Tag) -> Option<bun_sys::Error> {
    #[cfg(windows)]
    {
        if rc != 0 {
            return None;
        }
        // rc == 0 → read the CRT `_errno()`;
        // a zero errno must still yield `None`.
        let errno_val = bun_sys::last_errno();
        if errno_val == 0 {
            return None;
        }
        return Some(bun_sys::Error::from_code_int(errno_val, tag));
    }
    #[cfg(not(windows))]
    {
        if rc != -1 {
            return None;
        }
        Some(bun_sys::Error::from_code_int(bun_sys::last_errno(), tag))
    }
}

use bun_core::strings::ares_inet_pton as inet_pton;

unsafe extern "C" {
    // libc byte-order conversions are pure on the integer argument — no
    // pointer/aliasing/thread preconditions — so declare them `safe fn`.
    safe fn ntohs(nshort: u16) -> u16;
    safe fn htons(hshort: u16) -> u16;
}

extern "C" fn on_close(socket: *mut uws::udp::Socket) {
    let this: &UDPSocket = UDPSocket::from_uws(socket);
    this.closed.set(true);
    this.poll_ref.with_mut(|p| p.disable());
    this.this_value.with_mut(|r| r.downgrade());
    this.socket.set(None);
    // The descriptor dies with the socket: prune the registry entry so a
    // recycled fd number isn't refused (or worse, accepted) later.
    #[cfg(not(windows))]
    if let Some(fd) = this.registered_fd.take() {
        dgram_remove_fd(fd, DgramFdState::Adopted);
    }
}

extern "C" fn on_recv_error(socket: *mut uws::udp::Socket, errno: c_int, is_errqueue: c_int) {
    // Reached on every POSIX platform. `is_errqueue` distinguishes an ICMP
    // errno drained from Linux's MSG_ERRQUEUE from a real recvmmsg failure —
    // which on the BSDs (no error queue) is also how a connected socket's
    // ICMP error (so_error) arrives. node:dgram must drop only the former on
    // unconnected sockets, and the errno namespaces overlap.
    let this: &UDPSocket = UDPSocket::from_uws(socket);
    let sys_err = bun_sys::Error::from_code_int(errno, bun_sys::Tag::recv);
    let global_this = this.global_this.get();
    // A callback earlier in the same poll dispatch may have left a
    // TerminationException pending: loop.c's Linux errqueue drain calls this
    // once per queued ICMP in a `while (!u->closed)` loop, and its recv
    // do-while can reach this right after an `on_data` iteration's callback.
    // `to_js` below and the error handler both enter JS, which trips
    // executeCallImpl's assertNoException(). Mirrors on_data / on_drain.
    if global_this.has_exception() {
        return;
    }
    let err_value = sys_err.to_js(global_this);
    if is_errqueue != 0 {
        err_value.put(global_this, b"errqueue", JSValue::TRUE);
    }
    this.call_error_handler(JSValue::ZERO, err_value);
}

extern "C" fn on_drain(socket: *mut uws::udp::Socket) {
    let this: &UDPSocket = UDPSocket::from_uws(socket);
    let Some(this_value) = this.this_value.get().try_get() else {
        return;
    };
    let Some(callback) = js::on_drain_get_cached(this_value) else {
        return;
    };
    if callback.is_empty_or_undefined_or_null() {
        return;
    }

    let global_this = this.global_this.get();
    // on_data in the same poll dispatch may have left a TerminationException
    // pending (tryClearException refuses to clear it); entering JS with it set
    // trips executeCallImpl's assertNoException().
    if global_this.has_exception() {
        return;
    }
    let event_loop = VirtualMachine::get().event_loop_mut();
    event_loop.enter();
    let result = callback.call(global_this, this_value, &[this_value]);
    if let Err(err) = result {
        this.call_error_handler(JSValue::ZERO, global_this.take_exception(err));
    }
    event_loop.exit();
}

extern "C" fn on_data(
    socket: *mut uws::udp::Socket,
    buf: *mut uws::udp::PacketBuffer,
    packets: c_int,
) {
    let udp_socket: &UDPSocket = UDPSocket::from_uws(socket);
    let Some(this_value) = udp_socket.this_value.get().try_get() else {
        return;
    };
    let Some(callback) = js::on_data_get_cached(this_value) else {
        return;
    };
    if callback.is_empty_or_undefined_or_null() {
        return;
    }

    let global_this = udp_socket.global_this.get();
    // SAFETY: buf valid for the duration of this callback per uws contract.
    let buf = unsafe { &mut *buf };

    let mut i: c_int = 0;
    while i < packets {
        // A prior iteration's callback (or its error handler) may have closed
        // this socket or left a TerminationException pending; stop dispatching
        // the rest of the recvmmsg batch so no 'data' fires after 'close' and
        // no JS call is entered with a pending exception. Matches libuv's
        // per-datagram recheck.
        if udp_socket.closed.get() || global_this.has_exception() {
            break;
        }

        let peer = buf.get_peer(i);

        let mut addr_buf = [0u8; INET6_ADDRSTRLEN + 1];
        let hostname: Option<&[u8]>;
        let port: u16;
        let mut scope_id: Option<u32> = None;
        let is_ipv6: bool;

        // SAFETY: peer points to a sockaddr_storage; family discriminates the cast.
        match peer.ss_family as c_int {
            f if f == inet::AF_INET => {
                is_ipv6 = false;
                // SAFETY: family == AF_INET so peer is sockaddr_in.
                let peer4 = unsafe { &*std::ptr::from_ref(peer).cast::<sockaddr_in>() };
                // SAFETY: src points to in_addr, dst is INET6_ADDRSTRLEN+1 bytes.
                hostname = unsafe {
                    bun_cares_sys::ntop(f, (&raw const peer4.addr).cast(), &mut addr_buf)
                };
                port = ntohs(peer4.port);
            }
            f if f == inet::AF_INET6 => {
                is_ipv6 = true;
                // SAFETY: family == AF_INET6 so peer is sockaddr_in6.
                let peer6 = unsafe { &*std::ptr::from_ref(peer).cast::<sockaddr_in6>() };
                // SAFETY: src points to in6_addr, dst is INET6_ADDRSTRLEN+1 bytes.
                hostname = unsafe {
                    bun_cares_sys::ntop(f, (&raw const peer6.addr).cast(), &mut addr_buf)
                };
                port = ntohs(peer6.port);
                if peer6.scope_id != 0 {
                    scope_id = Some(peer6.scope_id);
                }
            }
            _ => {
                i += 1;
                continue;
            }
        }

        if hostname.is_none() || port == 0 {
            i += 1;
            continue;
        }

        let truncated = buf.get_truncated(i);
        let slice = buf.get_payload(i);

        let span = hostname.unwrap();
        #[allow(unused_labels)]
        let mut hostname_string = if let Some(id) = scope_id {
            'blk: {
                #[cfg(not(windows))]
                {
                    let mut buffer = [0u8; IF_NAMESIZE + 1];
                    // SAFETY: buffer is IF_NAMESIZE+1 bytes, NUL-terminated by zero-init.
                    if !unsafe { if_indextoname(id, buffer.as_mut_ptr().cast::<c_char>()) }
                        .is_null()
                    {
                        // SAFETY: if_indextoname wrote a NUL-terminated string.
                        let name = unsafe { bun_core::ffi::cstr(buffer.as_ptr().cast::<c_char>()) }
                            .to_bytes();
                        break 'blk BunString::create_format(format_args!(
                            "{}%{}",
                            bstr::BStr::new(span),
                            bstr::BStr::new(name)
                        ));
                    }
                }

                BunString::create_format(format_args!("{}%{}", bstr::BStr::new(span), id))
            }
        } else {
            BunString::init(span)
        };

        let loop_ = VirtualMachine::get().event_loop_mut();
        loop_.enter();

        let flags = JSValue::create_empty_object(global_this, 2);
        flags.put(global_this, b"truncated", JSValue::from(truncated));
        // Per-packet: rinfo.family must reflect the packet's sockaddr, not the
        // socket's constructor `type` (bind({fd}) can adopt the other family).
        flags.put(global_this, b"ipv6", JSValue::from(is_ipv6));

        let payload_js = match udp_socket
            .config
            .get()
            .binary_type
            .to_js(slice, global_this)
        {
            Ok(v) => v,
            Err(_) => {
                loop_.exit();
                this_value.ensure_still_alive();
                return;
            }
        };
        let hostname_js = match hostname_string.transfer_to_js(global_this) {
            Ok(v) => v,
            Err(_) => {
                loop_.exit();
                this_value.ensure_still_alive();
                return;
            }
        };

        let result = callback.call(
            global_this,
            this_value,
            &[
                this_value,
                payload_js,
                JSValue::js_number(port as f64),
                hostname_js,
                flags,
            ],
        );
        if let Err(err) = result {
            udp_socket.call_error_handler(JSValue::ZERO, global_this.take_exception(err));
        }

        this_value.ensure_still_alive();
        loop_.exit();

        i += 1;
    }

    this_value.ensure_still_alive();
}

pub struct ConnectConfig {
    pub port: u16,
    pub address: BunString,
}

pub struct UDPSocketConfig {
    pub hostname: BunString,
    pub connect: Option<ConnectConfig>,
    pub port: u16,
    pub flags: i32,
    /// Adopt this already-created (and usually bound) socket descriptor
    /// instead of creating a new one. Used by node:dgram for
    /// `socket.bind({ fd })` and cluster-shared sockets.
    pub fd: Option<i32>,
    pub binary_type: BinaryType,
}

impl Default for UDPSocketConfig {
    fn default() -> Self {
        Self {
            hostname: BunString::empty(),
            connect: None,
            port: 0,
            flags: 0,
            fd: None,
            binary_type: BinaryType::Buffer,
        }
    }
}

impl UDPSocketConfig {
    pub(crate) fn from_js(
        global_this: &JSGlobalObject,
        options: JSValue,
        this_value: JSValue,
    ) -> JsResult<Self> {
        if options.is_empty_or_undefined_or_null() || !options.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected an object")));
        }

        let port: u16 = 'brk: {
            if let Some(value) = options.get_truthy(global_this, "port")? {
                let number = value.coerce_to_i32(global_this)?;
                if number < 0 || number > 0xffff {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected \"port\" to be an integer between 0 and 65535"
                    )));
                }
                break 'brk u16::try_from(number).expect("int cast");
            } else {
                break 'brk 0;
            }
        };

        let flags: i32 = if let Some(value) = options.get_truthy(global_this, "flags")? {
            validators::validate_int32(global_this, value, "flags", None, None)?
        } else {
            0
        };

        // Presence, not truthiness: `fd: 0` is a valid descriptor. Non-integer
        // values are rejected instead of coercing to 0.
        let fd: Option<i32> = match options.get(global_this, "fd")? {
            Some(value) if !value.is_undefined_or_null() => {
                let number = validators::validate_int32(global_this, value, "fd", None, None)?;
                if number < 0 {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected \"fd\" to be a non-negative integer"
                    )));
                }
                Some(number)
            }
            _ => None,
        };

        let hostname = 'brk: {
            if let Some(value) = options.get_truthy(global_this, "hostname")? {
                if !value.is_string() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected \"hostname\" to be a string"
                    )));
                }
                break 'brk value.to_bun_string(global_this)?;
            } else {
                break 'brk BunString::static_("0.0.0.0");
            }
        };

        let mut config = Self {
            hostname,
            port,
            flags,
            fd,
            ..Default::default()
        };

        // `config` cleanup: Drop handles this on `?` paths.

        if let Some(socket) = options.get_truthy(global_this, "socket")? {
            if !socket.is_object() {
                return Err(global_this
                    .throw_invalid_arguments(format_args!("Expected \"socket\" to be an object")));
            }

            if let Some(value) = options.get_truthy(global_this, "binaryType")? {
                if !value.is_string() {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected \"socket.binaryType\" to be a string"
                    )));
                }

                config.binary_type = match BinaryType::from_js_value(global_this, value)? {
                    Some(bt) => bt,
                    None => {
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "Expected \"socket.binaryType\" to be 'arraybuffer', 'uint8array', or 'buffer'"
                        )));
                    }
                };
            }

            macro_rules! handler {
                ($name:literal, $set:path) => {
                    if let Some(value) = socket.get_truthy(global_this, $name)? {
                        if !value.is_cell() || !value.is_callable() {
                            return Err(global_this.throw_invalid_arguments(format_args!(
                                concat!("Expected \"socket.", $name, "\" to be a function")
                            )));
                        }
                        let callback = value.with_async_context_if_needed(global_this);
                        $set(this_value, global_this, callback);
                    }
                };
            }
            handler!("data", js::on_data_set_cached);
            handler!("drain", js::on_drain_set_cached);
            handler!("error", js::on_error_set_cached);
        }

        if let Some(connect) = options.get_truthy(global_this, "connect")? {
            if !connect.is_object() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected \"connect\" to be an object"
                )));
            }

            let Some(connect_host_js) = connect.get_truthy(global_this, "hostname")? else {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected \"connect.hostname\" to be a string"
                )));
            };

            if !connect_host_js.is_string() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected \"connect.hostname\" to be a string"
                )));
            }

            let Some(connect_port_js) = connect.get_truthy(global_this, "port")? else {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected \"connect.port\" to be an integer"
                )));
            };
            let connect_port = connect_port_js.coerce_to_i32(global_this)?;
            if connect_port < 1 || connect_port > 0xffff {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected \"connect.port\" to be an integer between 1 and 65535"
                )));
            }

            let connect_host = connect_host_js.to_bun_string(global_this)?;

            config.connect = Some(ConnectConfig {
                port: u16::try_from(connect_port).expect("int cast"),
                address: connect_host,
            });
        }

        Ok(config)
    }
}

// `UDPSocketConfig::deinit` becomes Drop: `hostname.deref()` and `connect.address.deref()` are
// handled by `bun_core::String`'s own Drop. No explicit body needed.

#[derive(Clone, Copy)]
struct ConnectInfo {
    port: u16,
}

/// `.classes.ts` codegen cached accessors.
///
/// `values: ["on_data", "on_drain", "on_error"]` (GC-tracked WriteBarrier slots)
/// plus the `cache: true` getters
/// `address` / `remoteAddress` (cleared on connect to invalidate the JS-side
/// memo). All resolve to the C++ `UDPSocketPrototype__${prop}{Get,Set}CachedValue`
/// shims via [`bun_jsc::codegen_cached_accessors!`].
pub mod js {
    bun_jsc::codegen_cached_accessors!(
        "UDPSocket";
        on_data, on_drain, on_error,
        address, remoteAddress
    );
}

// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim (`generated_classes.rs`) still passes `this: &mut UDPSocket` until the
// `sharedThis: true` regen lands — `&mut T` auto-derefs to `&T` so the impls
// below compile against either.
#[bun_jsc::JsClass(no_construct, no_constructor)]
pub struct UDPSocket {
    pub config: JsCell<UDPSocketConfig>,

    pub socket: Cell<Option<*mut uws::udp::Socket>>,
    pub loop_: *mut uws::Loop,

    // Read-only back-reference to the owning JS global; the VM/global strictly
    // outlives every socket it creates.
    pub global_this: BackRef<JSGlobalObject>,
    pub this_value: JsCell<JsRef>,

    pub jsc_ref: JscRef,
    pub poll_ref: JsCell<KeepAlive>,
    /// if marked as closed the socket pointer may be stale
    pub closed: Cell<bool>,
    connect_info: Cell<Option<ConnectInfo>>,
    /// This socket's descriptor in the raw-fd registry (adopted or created),
    /// tracked on the socket so close can prune the entry even if `reload()`
    /// replaces the config. POSIX-only, like the registry itself.
    #[cfg(not(windows))]
    registered_fd: Cell<Option<c_int>>,
    pub vm: *mut VirtualMachine,
}

impl UDPSocket {
    pub fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    /// Recover `&UDPSocket` from the uws user-data slot. Centralises the
    /// `unsafe { &*(*socket).user().cast() }` back-ref deref shared by every
    /// `extern "C"` callback below — the user pointer was set to the
    /// heap-allocated `UDPSocket` in [`udp_socket`] via
    /// `uws::udp::Socket::create(.., user_data = this_ptr)` and remains live
    /// until `on_close` (uws guarantees no callback after close). All mutated
    /// fields are `Cell`/`JsCell`, so a shared borrow is sufficient (R-2).
    #[inline]
    fn from_uws<'a>(socket: *mut uws::udp::Socket) -> &'a UDPSocket {
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let user = uws::udp::Socket::opaque_mut(socket).user();
        // SAFETY: `user` was set to `*mut UDPSocket` at creation; non-null and
        // live for the callback's duration (back-ref invariant).
        unsafe { &*user.cast::<UDPSocket>() }
    }

    pub fn udp_socket(global_this: &JSGlobalObject, options: JSValue) -> JsResult<JSValue> {
        bun_output::scoped_log!(UdpSocket, "udpSocket");

        let vm = global_this.bun_vm_ptr();
        let this_ptr = Self::new(Self {
            socket: Cell::new(None),
            config: JsCell::new(UDPSocketConfig::default()),
            global_this: BackRef::new(global_this),
            loop_: uws::Loop::get(),
            vm,
            this_value: JsCell::new(JsRef::empty()),
            jsc_ref: JscRef::init(),
            poll_ref: JsCell::new(KeepAlive::init()),
            closed: Cell::new(false),
            connect_info: Cell::new(None),
            #[cfg(not(windows))]
            registered_fd: Cell::new(None),
        });
        // SAFETY: just allocated above; we are the sole owner. R-2: shared
        // borrow — every mutated field is `Cell`/`JsCell`.
        let this = unsafe { &*this_ptr };

        // Error-path guard: { closed = true; close socket; downgrade this_value }
        // Release the strong reference so the JS wrapper can be garbage
        // collected, which will in turn call finalize() to free this struct.
        // Without this, failed config parsing or bind would leave the wrapper
        // pinned forever by the Strong handle and leak. This is idempotent, so
        // it is safe even if onClose() already downgraded via socket.close().
        //
        // Capture the raw pointer (Copy) and re-derive inside the closure so
        // borrowck does not see `this` as held across the guard's lifetime.
        let guard = scopeguard::guard(this_ptr, |ptr| {
            // SAFETY: `ptr` came from `heap::alloc` above and ownership has been
            // transferred to the JS wrapper; the guard only fires on the early-return
            // error paths below, on the same stack frame, so the allocation is live.
            // R-2: shared borrow — mutation through `Cell`/`JsCell`.
            let this = unsafe { &*ptr };
            this.closed.set(true);
            // Hoist before `(*socket).close()`: that call SYNCHRONOUSLY re-enters
            // `on_close` (udp.c `s->on_close(s)`), which re-derives `&UDPSocket`
            // from the uws user pointer. `downgrade()` is idempotent (on_close
            // repeats it), so ordering is unobservable.
            this.this_value.with_mut(|r| r.downgrade());
            if let Some(socket) = this.socket.take() {
                // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
                uws::udp::Socket::opaque_mut(socket).close();
            }
        });

        // `JsClass::to_js(self)` boxes by value, but we already own
        // the heap allocation in `this_ptr` and need to keep that exact pointer
        // (it is stashed as the uws user_data). Route through the
        // `#[bun_jsc::JsClass]`-generated `to_js_ptr` inherent method, which
        // binds `UDPSocket__create` with the correct `jsc.conv` ABI
        // (`extern "sysv64"` on Windows-x64, `extern "C"` elsewhere — the C++
        // side declares it `extern JSC_CALLCONV`). A manual `extern "C"` block
        // here would be a Win64-vs-SysV mismatch on Windows.
        //
        // SAFETY: `this_ptr` is a fresh `heap::into_raw` allocation (line 478);
        // ownership transfers to the C++ wrapper's `m_ctx`.
        let this_value = unsafe { Self::to_js_ptr(this_ptr, global_this) };
        this_value.ensure_still_alive();
        this.this_value
            .with_mut(|r| r.set_strong(this_value, global_this));

        this.config
            .set(UDPSocketConfig::from_js(global_this, options, this_value)?);

        let mut err: c_int = 0;

        let config = this.config.get();
        let hostname_z = config.hostname.to_owned_slice_z();

        // Reserve an adopted descriptor before creating the socket so a
        // concurrent adoption of the same number fails with EEXIST (like
        // libuv's uv_udp_open) instead of double-owning it.
        #[cfg(not(windows))]
        let reservation = match config.fd {
            Some(fd) => match dgram_begin_adoption(fd) {
                Some(previous) => Some((fd, previous)),
                None => {
                    return Err(global_this.throw_value(
                        bun_sys::Error::from_code_int(
                            SystemErrno::EEXIST as c_int,
                            bun_sys::Tag::open,
                        )
                        .to_js(global_this),
                    ));
                }
            },
            None => None,
        };

        let created = if let Some(fd) = config.fd {
            uws::udp::Socket::create_from_fd(
                this.loop_,
                on_data,
                on_drain,
                on_close,
                on_recv_error,
                fd,
                Some(&mut err),
                this_ptr.cast::<c_void>(),
            )
        } else {
            uws::udp::Socket::create(
                this.loop_,
                on_data,
                on_drain,
                on_close,
                on_recv_error,
                hostname_z.as_ptr(),
                config.port,
                config.flags,
                Some(&mut err),
                this_ptr.cast::<c_void>(),
            )
        };
        drop(hostname_z);
        this.socket.set(if created.is_null() {
            None
        } else {
            Some(created)
        });

        if this.socket.get().is_none() {
            // The caller keeps the descriptor when adoption fails.
            #[cfg(not(windows))]
            if let Some((fd, previous)) = reservation {
                dgram_rollback_adoption(fd, previous);
            }
            this.closed.set(true);
            if err != 0 {
                let code: &'static str = SystemErrno::init(err as i64)
                    .map(Into::into)
                    .unwrap_or("UNKNOWN");
                // Adopting a descriptor has no meaningful address: Node throws a
                // bare `open <code>` ErrnoException there, and `bind <code> <host>`
                // with `.address` for hostname binds.
                let is_fd = config.fd.is_some();
                let syscall: &'static str = if is_fd { "open" } else { "bind" };
                let message = if is_fd {
                    BunString::create_format(format_args!("{} {}", syscall, code))
                } else {
                    BunString::create_format(format_args!(
                        "{} {} {}",
                        syscall, code, config.hostname
                    ))
                };
                let sys_err = SystemError {
                    errno: err,
                    code: BunString::static_(code),
                    message,
                    path: BunString::empty(),
                    syscall: BunString::static_(syscall),
                    hostname: BunString::empty(),
                    fd: c_int::MIN,
                    dest: BunString::empty(),
                };
                let error_value = sys_err.to_error_instance(global_this);
                if !is_fd {
                    error_value.put(global_this, b"address", config.hostname.to_js(global_this)?);
                }

                return Err(global_this.throw_value(error_value));
            }

            return Err(global_this.throw(format_args!("Failed to bind socket")));
        }

        // Register this socket's live descriptor (adopted or freshly created)
        // so a later adoption of the same number fails with EEXIST; a wrap
        // that carried it here may still read its address, but must not close
        // it out from under the socket.
        #[cfg(not(windows))]
        {
            let fd = uws::udp::Socket::opaque_mut(created).fd();
            if reservation.is_none() {
                dgram_mark_fd_adopted(fd);
            }
            this.registered_fd.set(Some(fd));
        }

        if let Some(connect) = &this.config.get().connect {
            let address_z = connect.address.to_owned_slice_z();
            // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
            let ret = uws::udp::Socket::opaque_mut(this.socket.get().unwrap())
                .connect(address_z.as_ptr(), connect.port as u32);
            if ret != 0 {
                if let Some(sys_err) = errno_sys(ret, bun_sys::Tag::connect) {
                    return Err(global_this.throw_value(sys_err.to_js(global_this)));
                }

                if let Some(eai_err) = c_ares::Error::init_eai(ret) {
                    return Err(global_this.throw_value(
                        crate::dns_jsc::cares_jsc::error_to_js_with_syscall_and_hostname(
                            eai_err,
                            global_this,
                            b"connect",
                            address_z.as_bytes(),
                        )?,
                    ));
                }
            }
            this.connect_info
                .set(Some(ConnectInfo { port: connect.port }));
        }

        // Disarm the error-path guard.
        scopeguard::ScopeGuard::into_inner(guard);

        this.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        Ok(bun_jsc::JSPromise::resolved_promise_value(
            global_this,
            this_value,
        ))
    }

    pub fn call_error_handler(&self, this_value_: JSValue, err: JSValue) {
        let this_value = if this_value_.is_empty() {
            match self.this_value.get().try_get() {
                Some(v) => v,
                None => return,
            }
        } else {
            this_value_
        };
        let callback = js::on_error_get_cached(this_value).unwrap_or(JSValue::ZERO);
        let global_this = self.global_this.get();
        let vm = global_this.bun_vm().as_mut();

        // The `err` check below tests the *argument* (usually a freshly built
        // SystemError, never a termination); it says nothing about the VM's
        // own pending-exception state. If an earlier callback in the same
        // poll dispatch left a TerminationException pending, both
        // `uncaught_exception` and `callback.call` below would enter JS with
        // it set and trip assertNoException(). Guard here so every caller
        // (on_recv_error, on_data's and on_drain's error branches) inherits it.
        if global_this.has_exception() {
            return;
        }
        if err.is_termination_exception() {
            return;
        }
        if callback.is_empty_or_undefined_or_null() {
            let _ = vm.uncaught_exception(global_this, err, false);
            return;
        }

        let event_loop = vm.event_loop_mut();
        event_loop.enter();
        let result = callback.call(global_this, this_value, &[err.to_error().unwrap_or(err)]);
        if let Err(e) = result {
            global_this.report_active_exception_as_unhandled(e);
        }
        event_loop.exit();
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_broadcast(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 1 argument, got {}",
                arguments.len()
            )));
        }

        let enabled = arguments[0].to_boolean();
        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = uws::udp::Socket::opaque_mut(socket).set_broadcast(enabled);

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(arguments[0])
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_multicast_loopback(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 1 argument, got {}",
                arguments.len()
            )));
        }

        let enabled = arguments[0].to_boolean();
        // On Windows we can observe
        // `closed=false && socket=None` here (panic seen in
        // test-dgram-multicast-loopback.js). Throw EBADF to match the
        // `closed` branch above instead of panicking.
        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = uws::udp::Socket::opaque_mut(socket).set_multicast_loopback(enabled);

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(arguments[0])
    }

    fn set_membership(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        drop: bool,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 1 argument, got {}",
                arguments.len()
            )));
        }

        let mut addr: sockaddr_storage = bun_core::ffi::zeroed();
        if !this.parse_addr(
            global_this,
            JSValue::js_number(0.0),
            arguments[0],
            &mut addr,
        )? {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EINVAL as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let mut interface: sockaddr_storage = bun_core::ffi::zeroed();

        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };

        let res = if arguments.len() > 1
            && this.parse_addr(
                global_this,
                JSValue::js_number(0.0),
                arguments[1],
                &mut interface,
            )? {
            if addr.ss_family != interface.ss_family {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Family mismatch between address and interface"
                )));
            }
            // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
            uws::udp::Socket::opaque_mut(socket).set_membership(&addr, Some(&interface), drop)
        } else {
            uws::udp::Socket::opaque_mut(socket).set_membership(&addr, None, drop)
        };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_membership(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_membership(this, global_this, callframe, false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn drop_membership(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_membership(this, global_this, callframe, true)
    }

    fn set_source_specific_membership(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        drop: bool,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let arguments = callframe.arguments();
        if arguments.len() < 2 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 2 arguments, got {}",
                arguments.len()
            )));
        }

        // See `set_multicast_interface`: zero-init instead of `MaybeUninit` —
        // `parse_addr` only writes the sockaddr_in/in6 prefix, so
        // `assume_init()` on the full 128-byte storage would be UB.
        let mut source_addr: sockaddr_storage = bun_core::ffi::zeroed();
        if !this.parse_addr(
            global_this,
            JSValue::js_number(0.0),
            arguments[0],
            &mut source_addr,
        )? {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EINVAL as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let mut group_addr: sockaddr_storage = bun_core::ffi::zeroed();
        if !this.parse_addr(
            global_this,
            JSValue::js_number(0.0),
            arguments[1],
            &mut group_addr,
        )? {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EINVAL as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        if source_addr.ss_family != group_addr.ss_family {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Family mismatch between source and group addresses"
            )));
        }

        let mut interface: sockaddr_storage = bun_core::ffi::zeroed();

        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };

        let res = if arguments.len() > 2
            && this.parse_addr(
                global_this,
                JSValue::js_number(0.0),
                arguments[2],
                &mut interface,
            )? {
            if source_addr.ss_family != interface.ss_family {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Family mismatch among source, group and interface addresses"
                )));
            }
            // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
            uws::udp::Socket::opaque_mut(socket).set_source_specific_membership(
                &source_addr,
                &group_addr,
                Some(&interface),
                drop,
            )
        } else {
            uws::udp::Socket::opaque_mut(socket).set_source_specific_membership(
                &source_addr,
                &group_addr,
                None,
                drop,
            )
        };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_source_specific_membership(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_source_specific_membership(this, global_this, callframe, false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn drop_source_specific_membership(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_source_specific_membership(this, global_this, callframe, true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_multicast_interface(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 1 argument, got {}",
                arguments.len()
            )));
        }

        // `parse_addr` only writes the leading sockaddr_in/in6 prefix (≤28
        // bytes), leaving the remaining 100+ bytes uninitialized; producing a
        // `sockaddr_storage` value via `assume_init()` from a
        // partially-initialized `MaybeUninit`
        // is UB. Zero-initialize instead — matches `set_membership` and is
        // semantically equivalent (the C side reads only `ss_family` + the
        // address-family-specific fields `parse_addr` populated).
        let mut addr: sockaddr_storage = bun_core::ffi::zeroed();

        if !this.parse_addr(
            global_this,
            JSValue::js_number(0.0),
            arguments[0],
            &mut addr,
        )? {
            return Ok(JSValue::FALSE);
        }

        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };

        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = uws::udp::Socket::opaque_mut(socket).set_multicast_interface(&addr);

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_ttl(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_any_ttl(
            this,
            global_this,
            callframe,
            uws::udp::Socket::set_unicast_ttl,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_multicast_ttl(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_any_ttl(
            this,
            global_this,
            callframe,
            uws::udp::Socket::set_multicast_ttl,
        )
    }

    fn set_any_ttl(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        function: fn(&mut uws::udp::Socket, i32) -> c_int,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw_value(
                bun_sys::Error::from_code_int(
                    SystemErrno::EBADF as c_int,
                    bun_sys::Tag::setsockopt,
                )
                .to_js(global_this),
            ));
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 1 argument, got {}",
                arguments.len()
            )));
        }

        let ttl = arguments[0].coerce_to_i32(global_this)?;
        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = function(uws::udp::Socket::opaque_mut(socket), ttl);

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(JSValue::js_number(ttl as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_many(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Iterating the input array can run arbitrary user JS: `iter.next()`'s
        // slow path hits `JSObject.getIndex`, and `parseAddr` calls
        // `port.coerceToInt32()` / `address.toBunString()`. That JS can drop
        // the last reference to an earlier payload and force a GC, or detach
        // an earlier ArrayBuffer (`.transfer(n)` frees its backing store
        // synchronously), leaving borrowed pointers in `payloads[]` dangling
        // before `socket.send` reads them.
        //
        // Root every payload JSValue in a MarkedArgumentBuffer for the
        // duration of the call so GC cannot collect them, and split the work
        // into two phases: phase 1 collects/validates payloads and runs all
        // user JS; phase 2 borrows byte slices only once no more user JS
        // sits between capture and `socket.send`.
        struct Ctx<'a> {
            this: &'a UDPSocket,
            global_this: &'a JSGlobalObject,
            callframe: &'a CallFrame,
            result: JsResult<JSValue>,
        }
        extern "C" fn run(ctx: *mut Ctx<'_>, payload_roots: *mut MarkedArgumentBuffer) {
            // SAFETY: ctx points to the stack-local Ctx passed to
            // MarkedArgumentBuffer::run below; exclusive for this call.
            let ctx = unsafe { &mut *ctx };
            // SAFETY: payload_roots is the stack MarkedArgumentBuffer that
            // MarkedArgumentBuffer::run lends exclusively to this callback.
            let payload_roots = unsafe { &mut *payload_roots };
            ctx.result =
                UDPSocket::send_many_impl(ctx.this, ctx.global_this, ctx.callframe, payload_roots);
        }
        let mut ctx = Ctx {
            this,
            global_this,
            callframe,
            result: Ok(JSValue::UNDEFINED),
        };
        MarkedArgumentBuffer::run(&mut ctx, run);
        ctx.result
    }

    fn send_many_impl(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        payload_roots: &mut MarkedArgumentBuffer,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw(format_args!("Socket is closed")));
        }
        let arguments = callframe.arguments_old::<1>();
        if arguments.len != 1 {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Expected 1 argument, got {}",
                arguments.len
            )));
        }

        let arg = arguments.ptr[0];
        if !arg.js_type().is_array() {
            return Err(global_this.throw_invalid_argument_type(
                "sendMany",
                "first argument",
                "array",
            ));
        }

        // Cache the connection state before doing anything that can run user JS.
        // Array index getters, `port.valueOf()`, and `address.toString()` can all
        // call back into JS and connect/disconnect/close this socket. If we re-read
        // `this.connect_info` on every iteration, a mid-loop flip changes how
        // `slice_idx` is computed and which branch writes into `payloads`/`lens`/
        // `addr_ptrs`, producing out-of-bounds writes (unconnected -> connected) or
        // uninitialized slots (connected -> disconnected) in the arena buffers.
        let connected = this.connect_info.get().is_some();

        let array_len = arg.get_length(global_this)? as usize;
        if !connected && !array_len.is_multiple_of(3) {
            return Err(global_this
                .throw_invalid_arguments(format_args!("Expected 3 arguments for each packet")));
        }

        let len = if connected { array_len } else { array_len / 3 };

        let mut payload_vals: Vec<JSValue> = Vec::with_capacity(len);
        payload_vals.resize(len, JSValue::ZERO);
        let mut payloads: Vec<*const u8> = vec![core::ptr::null(); len];
        let mut lens: Vec<usize> = vec![0; len];
        let mut addr_ptrs: Vec<*const c_void> = vec![core::ptr::null(); len];
        // `sockaddr_storage` is POD (`Zeroable + Copy`); zero-init so phase 1/2
        // can index safely (no `set_len` over uninit memory).
        let mut addrs: Vec<sockaddr_storage> = vec![bun_core::ffi::zeroed(); len];

        let mut iter = arg.array_iterator(global_this)?;

        // Phase 1: collect and validate payload JSValues, resolve addresses.
        // All user-JS re-entrance happens here. Root each payload in the
        // MarkedArgumentBuffer so GC cannot collect it, but do NOT yet borrow
        // raw pointers into backing stores — user JS on a later iteration
        // could otherwise free or detach that storage.
        let mut i: u32 = 0;
        let mut port: JSValue = JSValue::ZERO;
        while let Some(val) = iter.next()? {
            if (i as usize) >= array_len {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Mismatch between array length property and number of items"
                )));
            }
            let slice_idx = if connected {
                i as usize
            } else {
                (i / 3) as usize
            };
            if connected || i.is_multiple_of(3) {
                let payload_val: JSValue = 'blk: {
                    if val.as_array_buffer(global_this).is_some() {
                        break 'blk val;
                    }
                    // `isString()` is `isStringLike()` and accepts boxed
                    // `StringObject` / `DerivedStringObject`; calling
                    // `toJSString` on those in phase 2 would run user
                    // `toString()`/`valueOf()` via `toPrimitive`. Resolve to
                    // the primitive JSString here — where user-JS re-entrance
                    // is expected — and root that, so phase 2 only ever sees
                    // primitive JSString cells.
                    if val.is_string() {
                        break 'blk val.to_js_string(global_this)?.to_js();
                    }
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected ArrayBufferView or string as payload"
                    )));
                };
                payload_roots.append(payload_val);
                payload_vals[slice_idx] = payload_val;
            }
            if connected {
                addr_ptrs[slice_idx] = core::ptr::null();
                i += 1;
                continue;
            }
            if i % 3 == 1 {
                port = val;
                i += 1;
                continue;
            }
            if i % 3 == 2 {
                if !this.parse_addr(global_this, port, val, &mut addrs[slice_idx])? {
                    return Err(
                        global_this.throw_invalid_arguments(format_args!("Invalid address"))
                    );
                }
                addr_ptrs[slice_idx] = (&raw const addrs[slice_idx]).cast::<c_void>();
            }
            i += 1;
        }
        if (i as usize) != array_len {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Mismatch between array length property and number of items"
            )));
        }

        // Phase 2: borrow byte slices now that no more user JS will run before
        // `socket.send`. Every `payload_vals` entry is either an
        // ArrayBufferView or a *primitive* JSString (boxed strings were
        // resolved in phase 1), so nothing here reaches `toPrimitive`. Rope
        // resolution / UTF-16 conversion may allocate and GC, but every
        // payload is rooted so borrowed WTFStringImpl / backing-store
        // pointers stay valid. An ArrayBuffer detached during phase 1 now
        // reports a zero-length slice rather than a dangling pointer.
        let empty: &'static [u8] = b"";
        // Collect the slices into a Vec so the borrowed bytes live until
        // `socket.send()`.
        let mut string_slices: Vec<ZigStringSlice> = Vec::with_capacity(len);
        for (slice_idx, val) in payload_vals.iter().enumerate() {
            // Hoisted so the returned `slice()` borrow lives past the `'brk` block
            // (the underlying buffer is GC-rooted via `payload_vals`; the
            // `ArrayBuffer` struct itself is just a ptr+len view).
            let array_buffer = val.as_array_buffer(global_this);
            let slice: &[u8] = 'brk: {
                if let Some(ref array_buffer) = array_buffer {
                    // `byteSlice()` returns `&.{}` for a detached view; its
                    // `.ptr` is a zero-length sentinel which the kernel
                    // rejects with EFAULT even though `iov_len == 0`. Hand
                    // sendmmsg a valid static address instead.
                    if array_buffer.is_detached() {
                        break 'brk empty;
                    }
                    break 'brk array_buffer.slice();
                }
                // Phase 1 stored the primitive JSString; `asString()` is a
                // plain cast (no `toPrimitive`, no user JS). `JSString` is an
                // `opaque_ffi!` ZST — `opaque_ref` is the safe deref.
                string_slices
                    .push(bun_jsc::JSString::opaque_ref(val.as_string()).to_slice(global_this));
                break 'brk string_slices.last().unwrap().slice();
            };
            payloads[slice_idx] = slice.as_ptr();
            lens[slice_idx] = slice.len();
        }

        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = uws::udp::Socket::opaque_mut(socket).send(&payloads, &lens, &addr_ptrs);
        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::send) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }
        Ok(JSValue::js_number(res as f64))
    }

    #[bun_jsc::host_fn(method)]
    pub fn send(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed.get() {
            return Err(global_this.throw(format_args!("Socket is closed")));
        }
        let arguments = callframe.arguments_old::<3>();
        let dst: Option<Destination> = 'brk: {
            if this.connect_info.get().is_some() {
                if arguments.len == 1 {
                    break 'brk None;
                }
                if arguments.len == 3 {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Cannot specify destination on connected socket"
                    )));
                }
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected 1 argument, got {}",
                    arguments.len
                )));
            } else {
                if arguments.len != 3 {
                    return Err(global_this.throw_invalid_arguments(format_args!(
                        "Expected 3 arguments, got {}",
                        arguments.len
                    )));
                }
                break 'brk Some(Destination {
                    port: arguments.ptr[1],
                    address: arguments.ptr[2],
                });
            }
        };

        // Resolve the destination before touching the payload. `parseAddr`
        // calls `port.coerceToInt32()` / `address.toBunString()` which can
        // run user JS that detaches the payload's ArrayBuffer
        // (`.transfer(n)`) or closes this socket. Doing this first means no
        // JSC safepoint sits between capturing `payload.ptr` and handing it
        // to `socket.send`, so a borrowed pointer cannot be freed out from
        // under us. `payload_arg` itself stays rooted in the callframe.
        let mut addr: sockaddr_storage = bun_core::ffi::zeroed();
        let addr_ptr: *const c_void = 'brk: {
            if let Some(dest) = dst {
                if !this.parse_addr(global_this, dest.port, dest.address, &mut addr)? {
                    return Err(
                        global_this.throw_invalid_arguments(format_args!("Invalid address"))
                    );
                }
                break 'brk (&raw const addr).cast::<c_void>();
            } else {
                break 'brk core::ptr::null();
            }
        };

        let payload_arg = arguments.ptr[0];
        let mut payload_str = ZigStringSlice::empty();
        // Hoisted so the `slice()` borrow outlives the `'brk` block; the
        // backing store is kept alive by `payload_arg` on the JS stack.
        let array_buffer = payload_arg.as_array_buffer(global_this);
        let payload: &[u8] = 'brk: {
            if let Some(ref array_buffer) = array_buffer {
                break 'brk array_buffer.slice();
            } else if payload_arg.is_string() {
                // `isString()` is `isStringLike()` and accepts boxed
                // `StringObject`/`DerivedStringObject`; `asString()` is a raw
                // `static_cast<JSString*>` that asserts/type-confuses on those.
                // `toJSString` resolves them via `toPrimitive` — safe here:
                // `parseAddr` already ran, there is only one payload so
                // `toPrimitive` cannot invalidate an earlier captured pointer,
                // and `this.socket orelse throw` below handles a
                // close-during-`toPrimitive`.
                // SAFETY: to_js_string returned non-null on success path.
                payload_str = payload_arg.to_js_string(global_this)?.to_slice(global_this);
                break 'brk payload_str.slice();
            } else {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Expected ArrayBufferView or string as first argument"
                )));
            }
        };

        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = uws::udp::Socket::opaque_mut(socket).send(
            &[payload.as_ptr()],
            &[payload.len()],
            &[addr_ptr],
        );
        drop(payload_str);
        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::send) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }
        Ok(JSValue::from(res > 0))
    }

    fn parse_addr(
        &self,
        global_this: &JSGlobalObject,
        port_val: JSValue,
        address_val: JSValue,
        storage: &mut sockaddr_storage,
    ) -> JsResult<bool> {
        let _ = self;
        let number = port_val.coerce_to_i32(global_this)?;
        let port: u16 = if number < 1 || number > 0xffff {
            0
        } else {
            u16::try_from(number).expect("int cast")
        };

        let str = bun_core::OwnedString::new(address_val.to_bun_string(global_this)?);
        // Owned NUL-terminated copy as a mutable Vec so we can write a NUL at
        // the `%` position for scope-id parsing.
        let mut address_slice: Vec<u8> = str.to_owned_slice_z().into_vec_with_nul();
        let bytes_len = address_slice.len() - 1; // exclude trailing NUL

        // SAFETY: storage is large enough to hold sockaddr_in.
        let addr4 = unsafe { &mut *std::ptr::from_mut(storage).cast::<sockaddr_in>() };
        // SAFETY: libc addr-format fn; src is NUL-terminated, dst points to in_addr-sized storage.
        if unsafe {
            inet_pton(
                inet::AF_INET as c_int,
                address_slice.as_ptr().cast::<c_char>(),
                (&raw mut addr4.addr).cast::<c_void>(),
            )
        } == 1
        {
            addr4.port = htons(port);
            addr4.family = inet::AF_INET as inet::sa_family_t;
        } else {
            // SAFETY: storage is large enough to hold sockaddr_in6.
            let addr6 = unsafe { &mut *std::ptr::from_mut(storage).cast::<sockaddr_in6>() };
            addr6.scope_id = 0;

            if let Some(percent) = address_slice[..bytes_len].iter().position(|&b| b == b'%') {
                if percent + 1 < bytes_len {
                    let iface_id: u32 = 'blk: {
                        #[cfg(windows)]
                        {
                            // Windows: zone identifier is a numeric scope id, not an
                            // interface name (`fe80::1%5`).
                            // toInt32 → BunString__toInt32 → WTF::parseIntegerAllowingTrailingJunk<int32_t>:
                            // skip leading ASCII whitespace, optional '-' (no '+'), parse leading
                            // decimal digits, ignore trailing junk; nullopt on no-digits/overflow.
                            let zone = &address_slice[percent + 1..bytes_len];
                            let mut i = 0usize;
                            while i < zone.len()
                                && matches!(zone[i], b' ' | b'\t' | b'\n' | b'\r' | b'\x0c')
                            {
                                i += 1;
                            }
                            let neg = i < zone.len() && zone[i] == b'-';
                            if neg {
                                i += 1;
                            }
                            let digits_start = i;
                            let mut acc: i64 = 0;
                            while i < zone.len() && zone[i].is_ascii_digit() {
                                acc = acc
                                    .saturating_mul(10)
                                    .saturating_add(i64::from(zone[i] - b'0'));
                                i += 1;
                            }
                            if i > digits_start {
                                let signed = if neg { acc.saturating_neg() } else { acc };
                                if let Ok(signed) = i32::try_from(signed) {
                                    if let Ok(id) = u32::try_from(signed) {
                                        break 'blk id;
                                    }
                                }
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            // SAFETY: address_slice is NUL-terminated; offset is in-bounds.
                            let index = unsafe {
                                if_nametoindex(
                                    address_slice.as_ptr().add(percent + 1).cast::<c_char>(),
                                )
                            };
                            if index > 0 {
                                break 'blk index;
                            }
                        }
                        // "an invalid Scope gets turned into #0 (default selection)"
                        // (test-dgram-multicast-set-interface.js)
                        break 'blk 0;
                    };

                    address_slice[percent] = 0;
                    addr6.scope_id = iface_id;
                }
            }

            // SAFETY: libc addr-format fn; src is NUL-terminated, dst points to in6_addr-sized storage.
            if unsafe {
                inet_pton(
                    inet::AF_INET6 as c_int,
                    address_slice.as_ptr().cast::<c_char>(),
                    (&raw mut addr6.addr).cast::<c_void>(),
                )
            } == 1
            {
                addr6.port = htons(port);
                addr6.family = inet::AF_INET6 as inet::sa_family_t;
            } else {
                return Ok(false);
            }
        }

        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn ref_(this: &Self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let _ = global_this;
        if !this.closed.get() {
            this.poll_ref.with_mut(|p| p.ref_(bun_io::js_vm_ctx()));
        }

        Ok(JSValue::UNDEFINED)
    }

    /// Codegen calls `UDPSocket::r#ref` (raw-ident lowering of JS `ref`).
    #[inline]
    pub fn r#ref(
        this: &Self,
        global_this: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::ref_(this, global_this, frame)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unref(this: &Self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let _ = global_this;
        this.poll_ref.with_mut(|p| p.unref(bun_io::js_vm_ctx()));

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        if !this.closed.get() {
            let Some(socket) = this.socket.take() else {
                return Ok(JSValue::UNDEFINED);
            };
            // `(*socket).close()` SYNCHRONOUSLY invokes `on_close` (udp.c:110
            // `s->on_close(s)`), which re-derives `&UDPSocket` from the uws
            // user pointer. R-2: with `&self` + `Cell`/`JsCell` the sibling
            // shared borrow is sound; the (idempotent) downgrade is hoisted
            // because `on_close` repeats it.
            this.this_value.with_mut(|r| r.downgrade());
            // Unregister before close(2) so no other thread can observe a
            // stale entry for the recycled number (on_close is the backstop).
            #[cfg(not(windows))]
            if let Some(fd) = this.registered_fd.take() {
                dgram_remove_fd(fd, DgramFdState::Adopted);
            }
            // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
            uws::udp::Socket::opaque_mut(socket).close();
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();

        if args.len < 1 {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected 1 argument")));
        }

        let options = args.ptr[0];
        let Some(this_value) = this.this_value.get().try_get() else {
            return Ok(JSValue::UNDEFINED);
        };
        let config = UDPSocketConfig::from_js(global_this, options, this_value)?;

        let _ = this.config.replace(config);

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_closed(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.closed.get())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hostname(this: &Self, _: &JSGlobalObject) -> JsResult<JSValue> {
        this.config.get().hostname.to_js(this.global_this.get())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_port(this: &Self, _: &JSGlobalObject) -> JSValue {
        if this.closed.get() {
            return JSValue::UNDEFINED;
        }
        let Some(socket) = this.socket.get() else {
            return JSValue::UNDEFINED;
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        JSValue::js_number(uws::udp::Socket::opaque_mut(socket).bound_port() as f64)
    }

    fn create_sock_addr(global_this: &JSGlobalObject, address_bytes: &[u8], port: u16) -> JSValue {
        let sockaddr: SocketAddress = match SocketAddress::init(address_bytes, port) {
            Ok(sa) => sa,
            Err(_) => return JSValue::UNDEFINED,
        };
        sockaddr.into_dto(global_this).unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_address(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if this.closed.get() {
            return JSValue::UNDEFINED;
        }
        let Some(socket) = this.socket.get() else {
            return JSValue::UNDEFINED;
        };
        let mut buf = [0u8; 64];
        let mut length: i32 = 64;
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let socket = uws::udp::Socket::opaque_mut(socket);
        socket.bound_ip(buf.as_mut_ptr(), &mut length);

        let address_bytes = &buf[..usize::try_from(length).expect("int cast")];
        let port = socket.bound_port();
        Self::create_sock_addr(
            global_this,
            address_bytes,
            u16::try_from(port).expect("int cast"),
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_address(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if this.closed.get() {
            return JSValue::UNDEFINED;
        }
        let Some(connect_info) = this.connect_info.get() else {
            return JSValue::UNDEFINED;
        };
        let Some(socket) = this.socket.get() else {
            return JSValue::UNDEFINED;
        };
        let mut buf = [0u8; 64];
        let mut length: i32 = 64;
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        uws::udp::Socket::opaque_mut(socket).remote_ip(buf.as_mut_ptr(), &mut length);

        let address_bytes = &buf[..usize::try_from(length).expect("int cast")];
        Self::create_sock_addr(global_this, address_bytes, connect_info.port)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_binary_type(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match this.config.get().binary_type {
            BinaryType::Buffer => global_this.common_strings().buffer(),
            BinaryType::Uint8Array => global_this.common_strings().uint8array(),
            BinaryType::ArrayBuffer => global_this.common_strings().arraybuffer(),
            _ => panic!("Invalid binary type"),
        })
    }

    pub fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(UdpSocket, "Finalize {:p}", &raw const *self);
        self.this_value.with_mut(|r| r.finalize());
        // `deinit` frees the allocation itself (`heap::take`); hand ownership
        // back so its existing raw-ptr teardown path stays intact.
        Self::deinit(Box::into_raw(self));
    }

    fn deinit(this: *mut Self) {
        // SAFETY: called from finalize with valid Box-allocated payload.
        let this_ref = unsafe { &*this };
        debug_assert!(this_ref.closed.get() || VirtualMachine::get().is_shutting_down());
        // VM-shutdown path: `lastChanceToFinalize` can finalize the wrapper
        // while the underlying poll is still open (the Strong in `this_value`
        // kept it GC-rooted until now). Close it so the `us_udp_socket_t`
        // lands on `closed_udp_head` for the post-destruct
        // `drain_closed_sockets()` sweep instead of leaking. `on_close`
        // re-derives `&UDPSocket` from the uws user pointer (= `this`, still
        // live) and only touches `Cell`/`JsCell` fields; `this_value` is
        // already `Finalized` so its `downgrade()` is a no-op.
        if let Some(socket) = this_ref.socket.take() {
            this_ref.closed.set(true);
            #[cfg(not(windows))]
            if let Some(fd) = this_ref.registered_fd.take() {
                dgram_remove_fd(fd, DgramFdState::Adopted);
            }
            uws::udp::Socket::opaque_mut(socket).close();
        }
        this_ref.poll_ref.with_mut(|p| p.disable());
        // config drop handled by heap::take below.
        // this_value.deinit() handled by JsRef Drop.
        // SAFETY: allocated via heap::alloc in `new`; this is the matching free.
        drop(unsafe { bun_core::heap::take(this) });
    }

    // No `#[bun_jsc::host_fn]` — the macro's free-fn shim emits a
    // bare `js_connect(..)` call which doesn't resolve inside an `impl` block.
    // The codegen `JsClass` derive owns the link name, so the shim isn't needed.
    pub fn js_connect(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old::<2>();

        // `as_class_ref` is the safe `&T` downcast (encapsulates `&*from_js`);
        // mutation goes through `Cell`, so a shared borrow suffices (R-2).
        let Some(this) = call_frame.this().as_class_ref::<UDPSocket>() else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("Expected UDPSocket as 'this'"))
            );
        };

        if this.connect_info.get().is_some() {
            return Err(global_this.throw(format_args!("Socket is already connected")));
        }

        if this.closed.get() {
            return Err(global_this.throw(format_args!("Socket is closed")));
        }

        if args.len < 2 {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected 2 arguments")));
        }

        let str = bun_core::OwnedString::new(args.ptr[0].to_bun_string(global_this)?);
        let connect_host = str.to_owned_slice_z();

        let connect_port_js = args.ptr[1];

        if !connect_port_js.is_number() {
            return Err(global_this
                .throw_invalid_arguments(format_args!("Expected \"port\" to be an integer")));
        }

        let connect_port = connect_port_js.as_int32();
        let port: u16 = if connect_port < 1 || connect_port > 0xffff {
            0
        } else {
            u16::try_from(connect_port).expect("int cast")
        };

        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw(format_args!("Socket is closed")));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        if uws::udp::Socket::opaque_mut(socket).connect(connect_host.as_ptr(), port as u32) == -1 {
            return Err(global_this.throw(format_args!("Failed to connect socket")));
        }
        this.connect_info.set(Some(ConnectInfo { port }));

        js::address_set_cached(call_frame.this(), global_this, JSValue::ZERO);
        js::remote_address_set_cached(call_frame.this(), global_this, JSValue::ZERO);

        Ok(JSValue::UNDEFINED)
    }

    // See `js_connect` — codegen `JsClass` derive owns the link name.
    pub fn js_disconnect(
        global_object: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // `as_class_ref` is the safe `&T` downcast (encapsulates `&*from_js`);
        // mutation goes through `Cell`, so a shared borrow suffices (R-2).
        let Some(this) = call_frame.this().as_class_ref::<UDPSocket>() else {
            return Err(
                global_object.throw_invalid_arguments(format_args!("Expected UDPSocket as 'this'"))
            );
        };

        if this.connect_info.get().is_none() {
            return Err(global_object.throw(format_args!("Socket is not connected")));
        }

        if this.closed.get() {
            return Err(global_object.throw(format_args!("Socket is closed")));
        }

        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        if uws::udp::Socket::opaque_mut(this.socket.get().unwrap()).disconnect() == -1 {
            return Err(global_object.throw(format_args!("Failed to disconnect socket")));
        }
        this.connect_info.set(None);

        Ok(JSValue::UNDEFINED)
    }

    /// `(size, isRecv)` → resulting SO_RCVBUF/SO_SNDBUF value. `size == 0`
    /// reads the current value, non-zero sets it. Backs node:dgram's
    /// get/setRecvBufferSize and get/setSendBufferSize.
    // See `js_connect` — codegen `JsClass` derive owns the link name.
    pub fn js_buffer_size(
        global_this: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        // `as_class_ref` is the safe `&T` downcast (encapsulates `&*from_js`);
        // mutation goes through `Cell`, so a shared borrow suffices (R-2).
        let Some(this) = call_frame.this().as_class_ref::<UDPSocket>() else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("Expected UDPSocket as 'this'"))
            );
        };

        let args = call_frame.arguments_old::<2>();
        if args.len < 2 {
            return Err(global_this.throw_invalid_arguments(format_args!("Expected 2 arguments")));
        }

        let size = args.ptr[0].coerce_to_i32(global_this)?;
        let is_recv = args.ptr[1].to_boolean();

        let bad_fd =
            || bun_sys::Error::from_code_int(SystemErrno::EBADF as c_int, bun_sys::Tag::setsockopt);
        if this.closed.get() {
            return Err(global_this.throw_value(bad_fd().to_js(global_this)));
        }
        let Some(socket) = this.socket.get() else {
            return Err(global_this.throw_value(bad_fd().to_js(global_this)));
        };

        let mut value: c_int = 0;
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let res = uws::udp::Socket::opaque_mut(socket).buffer_size(is_recv, size, &mut value);
        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::setsockopt) {
            return Err(global_this.throw_value(err.to_js(global_this)));
        }

        Ok(JSValue::js_number(f64::from(value)))
    }

    /// Underlying socket descriptor as a number, or -1 once closed. Backs
    /// node:dgram's handle.fd.
    // See `js_connect` — codegen `JsClass` derive owns the link name.
    pub fn js_get_fd(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        // `as_class_ref` is the safe `&T` downcast (encapsulates `&*from_js`);
        // mutation goes through `Cell`, so a shared borrow suffices (R-2).
        let Some(this) = call_frame.this().as_class_ref::<UDPSocket>() else {
            return Err(
                global_this.throw_invalid_arguments(format_args!("Expected UDPSocket as 'this'"))
            );
        };

        if this.closed.get() {
            return Ok(JSValue::js_number_from_int32(-1));
        }
        let Some(socket) = this.socket.get() else {
            return Ok(JSValue::js_number_from_int32(-1));
        };
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let fd = uws::udp::Socket::opaque_mut(socket).fd();
        Ok(JSValue::js_number_from_int32(fd))
    }
}

// ─── Raw-descriptor helpers for node:dgram's internal UDP handle shim ────────
// Free functions: they operate on descriptors that are not owned by any
// UDPSocket — `internal/dgram`'s `_createSocketHandle`, `socket.bind({ fd })`'s
// type check, and cluster-shared sockets. POSIX-only; Windows reports ENOTSUP,
// matching Node's cluster behavior for shared dgram handles.

/// Whether the raw helpers may close a registered descriptor. `Owned` means
/// the wrap layer created or received it; `Adopted` means a live `UDPSocket`
/// owns it now (read-only for the helpers, pruned when that socket closes).
#[cfg(not(windows))]
#[derive(Clone, Copy, PartialEq, Eq)]
enum DgramFdState {
    Owned,
    Adopted,
}

/// One registry with atomic state transitions so builtin JS can never close a
/// descriptor this module does not own. A process-wide mutex because worker
/// threads share the descriptor space; the set stays tiny so a Vec is enough.
#[cfg(not(windows))]
static DGRAM_FDS: bun_threading::Guarded<Vec<(c_int, DgramFdState)>> =
    bun_threading::Guarded::new(Vec::new());

#[cfg(not(windows))]
fn dgram_fd_state(fd: c_int) -> Option<DgramFdState> {
    DGRAM_FDS
        .lock()
        .iter()
        .find(|(known_fd, _)| *known_fd == fd)
        .map(|(_, state)| *state)
}

/// Registers a descriptor the wrap layer owns; no-op if already tracked (an
/// adopted descriptor stays read-only).
#[cfg(not(windows))]
fn dgram_register_owned_fd(fd: c_int) {
    let mut fds = DGRAM_FDS.lock();
    if !fds.iter().any(|(known_fd, _)| *known_fd == fd) {
        fds.push((fd, DgramFdState::Owned));
    }
}

/// A live `UDPSocket` owns `fd`: no longer closable through the raw helpers,
/// but still known for read-only ones. Any prior entry for a number the
/// kernel just handed out is stale by construction and is overwritten.
#[cfg(not(windows))]
fn dgram_mark_fd_adopted(fd: c_int) {
    let mut fds = DGRAM_FDS.lock();
    match fds.iter_mut().find(|(known_fd, _)| *known_fd == fd) {
        Some(entry) => entry.1 = DgramFdState::Adopted,
        None => fds.push((fd, DgramFdState::Adopted)),
    }
}

/// Atomically reserves `fd` for adoption unless a live socket already owns
/// it, returning the previous state for `dgram_rollback_adoption`; `None`
/// means the descriptor is already adopted.
#[cfg(not(windows))]
fn dgram_begin_adoption(fd: c_int) -> Option<Option<DgramFdState>> {
    let mut fds = DGRAM_FDS.lock();
    match fds.iter_mut().find(|(known_fd, _)| *known_fd == fd) {
        Some(entry) => match entry.1 {
            DgramFdState::Adopted => None,
            DgramFdState::Owned => {
                entry.1 = DgramFdState::Adopted;
                Some(Some(DgramFdState::Owned))
            }
        },
        None => {
            fds.push((fd, DgramFdState::Adopted));
            Some(None)
        }
    }
}

/// Restores the registry entry recorded by `dgram_begin_adoption` after a
/// failed socket create.
#[cfg(not(windows))]
fn dgram_rollback_adoption(fd: c_int, previous: Option<DgramFdState>) {
    let mut fds = DGRAM_FDS.lock();
    let index = fds.iter().position(|(known_fd, _)| *known_fd == fd);
    match (index, previous) {
        (Some(index), Some(state)) => fds[index].1 = state,
        (Some(index), None) => {
            fds.swap_remove(index);
        }
        (None, Some(state)) => fds.push((fd, state)),
        (None, None) => {}
    }
}

/// Registers a descriptor `socket(2)` just returned to the wrap layer: any
/// existing entry for that number is stale by construction.
#[cfg(not(windows))]
fn dgram_register_created_fd(fd: c_int) {
    let mut fds = DGRAM_FDS.lock();
    match fds.iter_mut().find(|(known_fd, _)| *known_fd == fd) {
        Some(entry) => entry.1 = DgramFdState::Owned,
        None => fds.push((fd, DgramFdState::Owned)),
    }
}

/// Removes `fd` from the registry if it is in `state`, returning whether it
/// was: a removed `Owned` descriptor becomes closable by the caller, a
/// removed `Adopted` one is just forgotten when its owning socket closes.
#[cfg(not(windows))]
fn dgram_remove_fd(fd: c_int, state: DgramFdState) -> bool {
    let mut fds = DGRAM_FDS.lock();
    match fds
        .iter()
        .position(|(known_fd, known_state)| *known_fd == fd && *known_state == state)
    {
        Some(index) => {
            fds.swap_remove(index);
            true
        }
        None => false,
    }
}

#[cfg(not(windows))]
fn dgram_owned_fd_arg(global: &JSGlobalObject, value: JSValue) -> JsResult<c_int> {
    let fd = value.coerce_to_i32(global)?;
    if fd < 0 || dgram_fd_state(fd) != Some(DgramFdState::Owned) {
        return Err(global.throw_value(
            bun_sys::Error::from_code_int(SystemErrno::EBADF as c_int, bun_sys::Tag::open)
                .to_js(global),
        ));
    }
    Ok(fd)
}

/// Like `dgram_owned_fd_arg`, but also accepts descriptors a `UDPSocket` has
/// adopted — a wrap that shared its fd may still ask for its address.
#[cfg(not(windows))]
fn dgram_known_fd_arg(global: &JSGlobalObject, value: JSValue) -> JsResult<c_int> {
    let fd = value.coerce_to_i32(global)?;
    if fd < 0 || dgram_fd_state(fd).is_none() {
        return Err(global.throw_value(
            bun_sys::Error::from_code_int(SystemErrno::EBADF as c_int, bun_sys::Tag::open)
                .to_js(global),
        ));
    }
    Ok(fd)
}

#[cfg(windows)]
fn dgram_not_supported(global: &JSGlobalObject) -> bun_jsc::JsError {
    global.throw_value(
        bun_sys::Error::from_code_int(SystemErrno::ENOTSUP as c_int, bun_sys::Tag::open)
            .to_js(global),
    )
}

/// `(fd)` → whether a live `UDPSocket` already owns this descriptor. Backs
/// node:dgram's synchronous EEXIST check on `bind({ fd })` so it does not have
/// to keep a second, per-VM copy of DGRAM_FDS.
#[bun_jsc::host_fn]
pub fn js_dgram_is_fd_adopted(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let fd = frame.argument(0).coerce_to_i32(global)?;
        Ok(JSValue::from(
            fd >= 0 && dgram_fd_state(fd) == Some(DgramFdState::Adopted),
        ))
    }
    #[cfg(windows)]
    {
        let _ = frame;
        // The registry is POSIX-only; on Windows the async adoption path
        // reports EEXIST itself and Node skips the sync-throw test.
        let _ = global;
        Ok(JSValue::FALSE)
    }
}

/// `(isIPv6, isStream)` → a fresh unbound SOCK_DGRAM (or SOCK_STREAM)
/// descriptor (CLOEXEC + non-blocking + SO_NOSIGPIPE), created through
/// bsd_create_socket so this doesn't fork its platform gate/EINTR loop.
#[bun_jsc::host_fn]
pub fn js_dgram_new_socket_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let is_v6 = frame.argument(0).to_boolean();
        let is_stream = frame.argument(1).to_boolean();
        let domain = if is_v6 { libc::AF_INET6 } else { libc::AF_INET };
        let sock_type = if is_stream {
            libc::SOCK_STREAM
        } else {
            libc::SOCK_DGRAM
        };

        let mut err: c_int = 0;
        let fd = uws::udp::raw::bsd_create_socket(domain, sock_type, 0, &mut err);
        if fd < 0 {
            let err = bun_sys::Error::from_code_int(err, bun_sys::Tag::open);
            return Err(global.throw_value(err.to_js(global)));
        }

        dgram_register_created_fd(fd);
        Ok(JSValue::js_number_from_int32(fd))
    }
    #[cfg(windows)]
    {
        let _ = frame;
        Err(dgram_not_supported(global))
    }
}

/// `(fd)` → registers an externally created datagram descriptor (received over
/// IPC or passed by the user) with the raw-descriptor registry so the guarded
/// helpers (getsockname/close) accept it. Ownership moves out again when a
/// `UDPSocket` adopts the descriptor.
#[bun_jsc::host_fn]
pub fn js_dgram_adopt_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let fd = frame.argument(0).coerce_to_i32(global)?;
        if fd < 0 {
            return Err(global.throw_value(
                bun_sys::Error::from_code_int(SystemErrno::EBADF as c_int, bun_sys::Tag::open)
                    .to_js(global),
            ));
        }
        // No-op for tracked descriptors: an adopted fd stays read-only rather
        // than becoming closable again through a second wrap.
        dgram_register_owned_fd(fd);
        // libuv's uv_udp_open unconditionally sets SO_REUSEADDR (kept for
        // backwards compat, libuv#4551); best-effort like it is there.
        let _ = uws::udp::raw::bsd_set_reuseaddr(fd);
        Ok(JSValue::UNDEFINED)
    }
    #[cfg(windows)]
    {
        let _ = frame;
        Err(dgram_not_supported(global))
    }
}

/// `(fd, address, port, flags)` → binds a raw datagram descriptor created by
/// `js_dgram_new_socket_fd`. `address` must be a numeric IPv4/IPv6 literal.
/// flags bit 4 is UV_UDP_REUSEADDR.
#[bun_jsc::host_fn]
pub fn js_dgram_bind_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let fd = dgram_owned_fd_arg(global, frame.argument(0))?;
        let address = bun_core::OwnedString::new(frame.argument(1).to_bun_string(global)?);
        let address_z = address.to_owned_slice_z();
        let port_num = frame.argument(2).coerce_to_i32(global)?;
        let port: u16 = if (0..=0xffff).contains(&port_num) {
            port_num as u16
        } else {
            0
        };
        let flags = frame.argument(3).coerce_to_i32(global)?;

        // Numeric literals only — the JS layer resolves names before calling.
        let mut storage: sockaddr_storage = bun_core::ffi::zeroed();
        let socklen: libc::socklen_t;
        // SAFETY: storage is large enough for sockaddr_in; src is NUL-terminated.
        let addr4 = unsafe { &mut *std::ptr::from_mut(&mut storage).cast::<sockaddr_in>() };
        // SAFETY: libc addr-format fn; src is NUL-terminated, dst points to in_addr-sized storage.
        let parsed_v4 = unsafe {
            inet_pton(
                inet::AF_INET as c_int,
                address_z.as_ptr(),
                (&raw mut addr4.addr).cast::<c_void>(),
            )
        };
        if parsed_v4 == 1 {
            addr4.family = inet::AF_INET as inet::sa_family_t;
            addr4.port = htons(port);
            socklen = size_of::<sockaddr_in>() as libc::socklen_t;
        } else {
            // SAFETY: storage is large enough for sockaddr_in6.
            let addr6 = unsafe { &mut *std::ptr::from_mut(&mut storage).cast::<sockaddr_in6>() };
            // SAFETY: libc addr-format fn; src is NUL-terminated, dst points to in6_addr-sized storage.
            let parsed_v6 = unsafe {
                inet_pton(
                    inet::AF_INET6 as c_int,
                    address_z.as_ptr(),
                    (&raw mut addr6.addr).cast::<c_void>(),
                )
            };
            if parsed_v6 != 1 {
                return Err(global.throw_value(
                    bun_sys::Error::from_code_int(
                        SystemErrno::EINVAL as c_int,
                        bun_sys::Tag::bind2,
                    )
                    .to_js(global),
                ));
            }
            addr6.family = inet::AF_INET6 as inet::sa_family_t;
            addr6.port = htons(port);
            socklen = size_of::<sockaddr_in6>() as libc::socklen_t;
        }

        // IPV6_V6ONLY, SO_REUSEADDR/SO_REUSEPORT and bind(2) go through bsd.c
        // so this doesn't fork its platform gate.
        // SAFETY: storage was initialized above for socklen bytes.
        let rc = unsafe {
            uws::udp::raw::bsd_bind_udp_fd(
                fd,
                std::ptr::from_ref(&storage).cast(),
                socklen as c_int,
                flags,
            )
        };
        if rc != 0 {
            let err = bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::bind2);
            return Err(global.throw_value(err.to_js(global)));
        }
        Ok(JSValue::UNDEFINED)
    }
    #[cfg(windows)]
    {
        let _ = frame;
        Err(dgram_not_supported(global))
    }
}

/// `(fd)` → `{ address, port, family }` of an owned raw descriptor's local
/// address.
#[bun_jsc::host_fn]
pub fn js_dgram_get_sock_name_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let fd = dgram_known_fd_arg(global, frame.argument(0))?;
        let mut storage: sockaddr_storage = bun_core::ffi::zeroed();
        let mut len = size_of::<sockaddr_storage>() as libc::socklen_t;
        // SAFETY: getsockname(2) writes at most `len` bytes into storage.
        let rc = unsafe {
            libc::getsockname(
                fd,
                std::ptr::from_mut(&mut storage).cast(),
                std::ptr::from_mut(&mut len),
            )
        };
        if rc != 0 {
            let err = bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::open);
            return Err(global.throw_value(err.to_js(global)));
        }
        let (bytes, port): (&[u8], u16) = if storage.ss_family == inet::AF_INET as libc::sa_family_t
        {
            // SAFETY: the family says this is a sockaddr_in.
            let addr4 = unsafe { &*std::ptr::from_ref(&storage).cast::<sockaddr_in>() };
            (
                // SAFETY: in_addr is 4 bytes.
                unsafe { core::slice::from_raw_parts((&raw const addr4.addr).cast::<u8>(), 4) },
                u16::from_be(addr4.port),
            )
        } else if storage.ss_family == inet::AF_INET6 as libc::sa_family_t {
            // SAFETY: the family says this is a sockaddr_in6.
            let addr6 = unsafe { &*std::ptr::from_ref(&storage).cast::<sockaddr_in6>() };
            (
                // SAFETY: in6_addr is 16 bytes.
                unsafe { core::slice::from_raw_parts((&raw const addr6.addr).cast::<u8>(), 16) },
                u16::from_be(addr6.port),
            )
        } else {
            return Err(global.throw_value(
                bun_sys::Error::from_code_int(SystemErrno::EINVAL as c_int, bun_sys::Tag::open)
                    .to_js(global),
            ));
        };
        Ok(UDPSocket::create_sock_addr(global, bytes, port))
    }
    #[cfg(windows)]
    {
        let _ = frame;
        Err(dgram_not_supported(global))
    }
}

/// `(fd)` → "UDP" | "TCP" | "PIPE" | "TTY" | "FILE" | "UNKNOWN", like Node's
/// `guessHandleType`. Never throws.
#[bun_jsc::host_fn]
pub fn js_dgram_guess_handle_type(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(windows)]
    let kind: &'static str = {
        let _ = frame;
        "UNKNOWN"
    };
    #[cfg(not(windows))]
    let kind: &'static str = 'kind: {
        let fd = frame.argument(0).coerce_to_i32(global)?;
        if fd < 0 {
            break 'kind "UNKNOWN";
        }
        let mut st: libc::stat = bun_core::ffi::zeroed();
        // SAFETY: fstat(2) with a zeroed out-param.
        let rc = unsafe { libc::fstat(fd, std::ptr::from_mut(&mut st)) };
        if rc != 0 {
            break 'kind "UNKNOWN";
        }
        let mode = st.st_mode & libc::S_IFMT;
        if mode == libc::S_IFSOCK {
            let mut sock_type: c_int = 0;
            let mut len = size_of::<c_int>() as libc::socklen_t;
            // SAFETY: getsockopt(2) writes an int into sock_type.
            let rc = unsafe {
                libc::getsockopt(
                    fd,
                    libc::SOL_SOCKET,
                    libc::SO_TYPE,
                    std::ptr::from_mut(&mut sock_type).cast::<c_void>(),
                    std::ptr::from_mut(&mut len),
                )
            };
            if rc != 0 {
                break 'kind "UNKNOWN";
            }
            let mut storage: sockaddr_storage = bun_core::ffi::zeroed();
            let mut slen = size_of::<sockaddr_storage>() as libc::socklen_t;
            // SAFETY: getsockname(2) writes at most slen bytes into storage.
            let rc = unsafe {
                libc::getsockname(
                    fd,
                    std::ptr::from_mut(&mut storage).cast(),
                    std::ptr::from_mut(&mut slen),
                )
            };
            if rc != 0 {
                break 'kind "UNKNOWN";
            }
            let family = storage.ss_family as c_int;
            break 'kind match sock_type {
                libc::SOCK_DGRAM if family == libc::AF_INET || family == libc::AF_INET6 => "UDP",
                libc::SOCK_STREAM if family == libc::AF_INET || family == libc::AF_INET6 => "TCP",
                libc::SOCK_STREAM if family == libc::AF_UNIX => "PIPE",
                _ => "UNKNOWN",
            };
        }
        if mode == libc::S_IFIFO {
            break 'kind "PIPE";
        }
        if mode == libc::S_IFCHR {
            // SAFETY: isatty(3) on a non-negative fd.
            let is_tty = unsafe { libc::isatty(fd) } == 1;
            break 'kind if is_tty { "TTY" } else { "FILE" };
        }
        if mode == libc::S_IFREG {
            break 'kind "FILE";
        }
        "UNKNOWN"
    };
    BunString::static_(kind.as_bytes()).to_js(global)
}

/// `(fd)` → puts a stream descriptor created by `js_dgram_new_socket_fd` into
/// the listening state (auto-binding to an ephemeral port if unbound).
#[bun_jsc::host_fn]
pub fn js_dgram_listen_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let fd = dgram_owned_fd_arg(global, frame.argument(0))?;
        // SAFETY: listen(2) on a descriptor this module created.
        let rc = unsafe { libc::listen(fd, 511) };
        if rc != 0 {
            let err = bun_sys::Error::from_code_int(bun_sys::last_errno(), bun_sys::Tag::listen);
            return Err(global.throw_value(err.to_js(global)));
        }
        Ok(JSValue::UNDEFINED)
    }
    #[cfg(windows)]
    {
        let _ = frame;
        Err(dgram_not_supported(global))
    }
}

/// `(fd)` → closes a raw descriptor created by `js_dgram_new_socket_fd`.
#[bun_jsc::host_fn]
pub fn js_dgram_close_fd(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    #[cfg(not(windows))]
    {
        let fd = frame.argument(0).coerce_to_i32(global)?;
        // Adopted descriptors belong to a live UDPSocket (its close prunes
        // them); only owned ones are closed here.
        if dgram_remove_fd(fd, DgramFdState::Owned) {
            uws::udp::raw::bsd_close_socket(fd);
        }
        Ok(JSValue::UNDEFINED)
    }
    #[cfg(windows)]
    {
        let _ = frame;
        Err(dgram_not_supported(global))
    }
}

struct Destination {
    port: JSValue,
    address: JSValue,
}

fn get_us_error<const USE_WSA: bool>(res: c_int, tag: bun_sys::Tag) -> Option<bun_sys::Error> {
    #[cfg(windows)]
    {
        // setsockopt returns 0 on success, but errnoSys considers 0 to be failure on Windows.
        // This applies to some other usockets functions too.
        if res >= 0 {
            return None;
        }

        if USE_WSA {
            // The wrapper (src/sys/windows/mod.rs) already maps `SystemErrno`
            // → `E` for us, so `e` is `bun_sys::E` here.
            if let Some(e) = bun_sys::windows::WSAGetLastError() {
                if e != bun_sys::E::SUCCESS {
                    // `WSASetLastError` is declared `safe fn` in
                    // `bun_windows_sys::ws2_32` (thread-local Winsock error
                    // slot write — no preconditions).
                    bun_sys::windows::ws2_32::WSASetLastError(0);
                    return Some(bun_sys::Error::from_code(e, tag));
                }
            }
        }

        let errno_val = bun_sys::last_errno();
        return Some(bun_sys::Error::from_code_int(errno_val, tag));
    }
    #[cfg(not(windows))]
    {
        let _ = USE_WSA;
        errno_sys(res, tag)
    }
}
