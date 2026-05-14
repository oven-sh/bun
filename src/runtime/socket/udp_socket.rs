use core::cell::Cell;
use core::ffi::{c_char, c_int, c_void};

use bun_core::{String as BunString, ZigStringSlice};
use bun_io::KeepAlive;
use bun_jsc::JsCell;
use bun_jsc::array_buffer::BinaryType;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    CallFrame, JSGlobalObject, JSValue, JsClass, JsRef, JsResult, MarkedArgumentBuffer,
    Ref as JscRef, StringJsc, SysErrorJsc, SystemError,
};
use bun_ptr::{AsCtxPtr, BackRef};

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

/// Local shim for Zig `bun.sys.Maybe(void).errnoSys(rc, tag)` — `bun_sys::Result`
/// is a plain `core::result::Result` alias in Rust and has no associated
/// `errno_sys` constructor.
///
/// POSIX `getErrno(c_int)` semantics: only `rc == -1` is failure (any other
/// value — including positive packet counts from `us_udp_socket_send` and
/// negative EAI codes from `connect` — is "not a libc errno", so callers
/// handle it themselves).
///
/// Windows semantics (src/runtime/node.zig:227-233): for any non-NTSTATUS
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
        // rc == 0 → fall through to `sys.getErrno(rc)` in Zig, which on
        // Windows reads CRT `_errno()`. Zig then matches `.SUCCESS => null`,
        // so a zero errno must still yield `None`.
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

use bun_core::immutable::ares_inet_pton as inet_pton;

#[allow(dead_code)]
unsafe extern "C" {
    // libc byte-order conversions are pure on the integer argument — no
    // pointer/aliasing/thread preconditions — so declare them `safe fn`.
    safe fn ntohs(nshort: u16) -> u16;
    safe fn htonl(hlong: u32) -> u32;
    safe fn htons(hshort: u16) -> u16;
}

extern "C" fn on_close(socket: *mut uws::udp::Socket) {
    let this: &UDPSocket = UDPSocket::from_uws(socket);
    this.closed.set(true);
    this.poll_ref.with_mut(|p| p.disable());
    this.this_value.with_mut(|r| r.downgrade());
    this.socket.set(None);
}

extern "C" fn on_recv_error(socket: *mut uws::udp::Socket, errno: c_int) {
    // Only called on Linux via IP_RECVERR — loop.c guards the recv-on-error
    // path with #if defined(__linux__) to preserve the pre-existing
    // close-on-error behavior on kqueue/Windows (where an error event is a
    // fatal socket condition, not a drainable error queue). Builds a
    // SystemError from the ICMP errno (ECONNREFUSED, EHOSTUNREACH,
    // ENETUNREACH, EMSGSIZE, ...) and dispatches through the 'error' handler.
    let this: &UDPSocket = UDPSocket::from_uws(socket);
    let sys_err = bun_sys::Error::from_code_int(errno, bun_sys::Tag::recv);
    let global_this = this.global_this.get();
    let err_value = sys_err.to_js(global_this);
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

    let event_loop = VirtualMachine::get().event_loop_mut();
    event_loop.enter();
    let global_this = this.global_this.get();
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
        let peer = buf.get_peer(i);

        let mut addr_buf = [0u8; INET6_ADDRSTRLEN + 1];
        let mut hostname: Option<&[u8]> = None;
        let mut port: u16 = 0;
        let mut scope_id: Option<u32> = None;

        // SAFETY: peer points to a sockaddr_storage; family discriminates the cast.
        match peer.ss_family as c_int {
            f if f == inet::AF_INET => {
                // SAFETY: family == AF_INET so peer is sockaddr_in.
                let peer4 = unsafe { &*std::ptr::from_ref(peer).cast::<sockaddr_in>() };
                // SAFETY: src points to in_addr, dst is INET6_ADDRSTRLEN+1 bytes.
                hostname = unsafe {
                    bun_cares_sys::ntop(f, (&raw const peer4.addr).cast(), &mut addr_buf)
                };
                port = ntohs(peer4.port);
            }
            f if f == inet::AF_INET6 => {
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

        let flags = JSValue::create_empty_object(global_this, 1);
        flags.put(global_this, b"truncated", JSValue::from(truncated));

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
    pub binary_type: BinaryType,
}

impl Default for UDPSocketConfig {
    fn default() -> Self {
        Self {
            hostname: BunString::empty(),
            connect: None,
            port: 0,
            flags: 0,
            binary_type: BinaryType::Buffer,
        }
    }
}

impl UDPSocketConfig {
    pub fn from_js(
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
            ..Default::default()
        };

        // errdefer config.deinit() — Drop on `config` handles this on `?` paths.

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

            // PORT NOTE: `inline for (handlers)` over [("data","on_data"),("drain","on_drain"),
            // ("error","on_error")] with `@field(UDPSocket.js.gc, handler.1)` — unrolled because
            // Rust cannot index struct fields by runtime/const string.
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

            let connect_host = connect_host_js.to_bun_string(global_this)?;

            config.connect = Some(ConnectConfig {
                port: if connect_port < 1 || connect_port > 0xffff {
                    0
                } else {
                    u16::try_from(connect_port).expect("int cast")
                },
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

/// `jsc.Codegen.JSUDPSocket` — `.classes.ts` cached accessors.
///
/// `values: ["on_data", "on_drain", "on_error"]` (GC-tracked WriteBarrier slots
/// — Zig: `js.gc.on_*.{get,set}`) plus the `cache: true` getters
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
    // outlives every socket it creates (see Zig spec: `globalThis: *JSGlobalObject`).
    pub global_this: BackRef<JSGlobalObject>,
    pub this_value: JsCell<JsRef>,

    pub jsc_ref: JscRef,
    pub poll_ref: JsCell<KeepAlive>,
    /// if marked as closed the socket pointer may be stale
    pub closed: Cell<bool>,
    connect_info: Cell<Option<ConnectInfo>>,
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
        });
        // SAFETY: just allocated above; we are the sole owner. R-2: shared
        // borrow — every mutated field is `Cell`/`JsCell`.
        let this = unsafe { &*this_ptr };

        // errdefer { closed = true; close socket; downgrade this_value }
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

        // PORT NOTE: `JsClass::to_js(self)` boxes by value, but we already own
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

        let created = uws::udp::Socket::create(
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
        );
        drop(hostname_z);
        this.socket.set(if created.is_null() {
            None
        } else {
            Some(created)
        });

        if this.socket.get().is_none() {
            this.closed.set(true);
            if err != 0 {
                let code: &'static str = SystemErrno::init(err as i64)
                    .map(Into::into)
                    .unwrap_or("UNKNOWN");
                let sys_err = SystemError {
                    errno: err,
                    code: BunString::static_(code),
                    message: BunString::create_format(format_args!(
                        "bind {} {}",
                        code, config.hostname
                    )),
                    path: BunString::empty(),
                    syscall: BunString::empty(),
                    hostname: BunString::empty(),
                    fd: c_int::MIN,
                    dest: BunString::empty(),
                };
                let error_value = sys_err.to_error_instance(global_this);
                error_value.put(global_this, b"address", config.hostname.to_js(global_this)?);

                return Err(global_this.throw_value(error_value));
            }

            return Err(global_this.throw(format_args!("Failed to bind socket")));
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

        // Disarm errdefer.
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
        // Spec: udp_socket.zig:424 uses bare `.?`, but the same file's
        // `setAnyTTL` (zig:593) / `setMembership` (zig:450) guard with
        // `orelse throw` — on Windows the Rust port can observe
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

        // Zig spec uses `var addr: sockaddr.storage = undefined;`. `parse_addr`
        // only writes the leading sockaddr_in/in6 prefix (≤28 bytes), so the
        // remaining 100+ bytes stay uninitialized. Zig permits that (only
        // written fields are read), but in Rust producing a `sockaddr_storage`
        // value via `assume_init()` from a partially-initialized `MaybeUninit`
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
        // PERF(port): was comptime monomorphization — profile in Phase B.
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
            // SAFETY: ctx points to a stack-local Ctx; payload_roots provided by
            // MarkedArgumentBuffer::run for the duration of this call.
            let ctx = unsafe { &mut *ctx };
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
        if !connected && array_len % 3 != 0 {
            return Err(global_this
                .throw_invalid_arguments(format_args!("Expected 3 arguments for each packet")));
        }

        let len = if connected { array_len } else { array_len / 3 };

        // PERF(port): was arena bulk-free — profile in Phase B.
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
            if connected || i % 3 == 0 {
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
        // Zig kept `ZigString.Slice` lifetimes in the arena; here we collect
        // them into a Vec so the borrowed bytes live until `socket.send()`.
        let mut string_slices: Vec<ZigStringSlice> = Vec::with_capacity(len);
        for (slice_idx, val) in payload_vals.iter().enumerate() {
            // Hoisted so the returned `slice()` borrow lives past the `'brk` block
            // (the underlying buffer is GC-rooted via `payload_vals`; the
            // `ArrayBuffer` struct itself is just a ptr+len view).
            let array_buffer = val.as_array_buffer(global_this);
            let slice: &[u8] = 'brk: {
                if let Some(ref array_buffer) = array_buffer {
                    // `byteSlice()` returns `&.{}` for a detached view; its
                    // `.ptr` is Zig's zero-length sentinel which the kernel
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

        let str = address_val.to_bun_string(global_this)?;
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
                            // interface name (`fe80::1%5`). Mirrors Zig
                            // `str.substring(percent+1).toInt32()` + `std.math.cast(u32, ..)`.
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
            // because `on_close` repeats it. Spec: udp_socket.zig:915-920.
            this.this_value.with_mut(|r| r.downgrade());
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

        let previous_config = this.config.replace(config);
        drop(previous_config);

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
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        JSValue::js_number(
            uws::udp::Socket::opaque_mut(this.socket.get().unwrap()).bound_port() as f64,
        )
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
        let mut buf = [0u8; 64];
        let mut length: i32 = 64;
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        let socket = uws::udp::Socket::opaque_mut(this.socket.get().unwrap());
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
        let mut buf = [0u8; 64];
        let mut length: i32 = 64;
        // `Socket` is an `opaque_ffi!` ZST — `opaque_mut` is the safe deref.
        uws::udp::Socket::opaque_mut(this.socket.get().unwrap())
            .remote_ip(buf.as_mut_ptr(), &mut length);

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
        this_ref.poll_ref.with_mut(|p| p.disable());
        // config drop handled by heap::take below.
        // this_value.deinit() handled by JsRef Drop.
        // SAFETY: allocated via heap::alloc in `new`; this is the matching free.
        drop(unsafe { bun_core::heap::take(this) });
    }

    // PORT NOTE: no `#[bun_jsc::host_fn]` — the macro's free-fn shim emits a
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

        let str = args.ptr[0].to_bun_string(global_this)?;
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

    // PORT NOTE: see `js_connect` — codegen `JsClass` derive owns the link name.
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
            // Zig: `bun.windows.WSAGetLastError()` returns `?SystemErrno`; the
            // Rust wrapper (src/sys/windows/mod.rs) already maps `SystemErrno`
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

// ported from: src/runtime/socket/udp_socket.zig
