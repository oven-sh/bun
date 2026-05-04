use core::ffi::{c_char, c_int, c_void};
use core::mem::MaybeUninit;

use bun_aio::KeepAlive;
use bun_core::validators;
use bun_jsc::{
    ArrayBuffer, CallFrame, Codegen, JSGlobalObject, JSValue, JsRef, JsResult, MarkedArgumentBuffer,
    Ref as JscRef, SystemError, VirtualMachine, ZigString,
};
use bun_str::{self as bun_string, String as BunString};
use bun_sys::{self, posix, SystemErrno};
use bun_uws as uws;

use crate::api::SocketAddress;

bun_output::declare_scope!(UdpSocket, visible);

#[cfg(windows)]
const INET6_ADDRSTRLEN: usize = 65;
#[cfg(not(windows))]
const INET6_ADDRSTRLEN: usize = 46;

// TODO(port): move to runtime_sys / bun_sys
unsafe extern "C" {
    fn ntohs(nshort: u16) -> u16;
    fn htonl(hlong: u32) -> u32;
    fn htons(hshort: u16) -> u16;
    fn inet_ntop(af: c_int, src: *const c_void, dst: *mut u8, size: c_int) -> *const c_char;
    fn inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
}

extern "C" fn on_close(socket: *mut uws::udp::Socket) {
    // SAFETY: socket.user() was set to `*mut UDPSocket` in `udp_socket()` via the `user` arg to
    // `uws::udp::Socket::create`. uws guarantees the user pointer is non-null here.
    let this: &mut UDPSocket = unsafe { &mut *((*socket).user().unwrap() as *mut UDPSocket) };
    this.closed = true;
    this.poll_ref.disable();
    this.this_value.downgrade();
    this.socket = None;
}

extern "C" fn on_recv_error(socket: *mut uws::udp::Socket, errno: c_int) {
    // Only called on Linux via IP_RECVERR — loop.c guards the recv-on-error
    // path with #if defined(__linux__) to preserve the pre-existing
    // close-on-error behavior on kqueue/Windows (where an error event is a
    // fatal socket condition, not a drainable error queue). Builds a
    // SystemError from the ICMP errno (ECONNREFUSED, EHOSTUNREACH,
    // ENETUNREACH, EMSGSIZE, ...) and dispatches through the 'error' handler.
    // SAFETY: see on_close.
    let this: &mut UDPSocket = unsafe { &mut *((*socket).user().unwrap() as *mut UDPSocket) };
    let sys_err = bun_sys::Error::from_code_int(errno, bun_sys::Tag::Recv);
    // SAFETY: globalThis stored at construction; VM outlives socket.
    let global_this = unsafe { &*this.global_this };
    let Ok(err_value) = sys_err.to_js(global_this) else { return };
    this.call_error_handler(JSValue::ZERO, err_value);
}

extern "C" fn on_drain(socket: *mut uws::udp::Socket) {
    // SAFETY: see on_close.
    let this: &mut UDPSocket = unsafe { &mut *((*socket).user().unwrap() as *mut UDPSocket) };
    let Some(this_value) = this.this_value.try_get() else { return };
    let Some(callback) = UDPSocket::js().gc.on_drain.get(this_value) else { return };
    if callback.is_empty_or_undefined_or_null() {
        return;
    }

    let vm = VirtualMachine::get();
    let event_loop = vm.event_loop();
    event_loop.enter();
    // SAFETY: globalThis stored at construction; VM outlives socket.
    let global_this = unsafe { &*this.global_this };
    let result = callback.call(global_this, this_value, &[this_value]);
    if let Err(err) = result {
        this.call_error_handler(JSValue::ZERO, global_this.take_exception(err));
    }
    event_loop.exit();
}

extern "C" fn on_data(socket: *mut uws::udp::Socket, buf: *mut uws::udp::PacketBuffer, packets: c_int) {
    // SAFETY: see on_close.
    let udp_socket: &mut UDPSocket = unsafe { &mut *((*socket).user().unwrap() as *mut UDPSocket) };
    let Some(this_value) = udp_socket.this_value.try_get() else { return };
    let Some(callback) = UDPSocket::js().gc.on_data.get(this_value) else { return };
    if callback.is_empty_or_undefined_or_null() {
        return;
    }

    // SAFETY: globalThis stored at construction; VM outlives socket.
    let global_this = unsafe { &*udp_socket.global_this };
    // SAFETY: buf valid for the duration of this callback per uws contract.
    let buf = unsafe { &mut *buf };

    let mut i: c_int = 0;
    while i < packets {
        let peer = buf.get_peer(i);

        let mut addr_buf = [0u8; INET6_ADDRSTRLEN + 1];
        let mut hostname: *const c_char = core::ptr::null();
        let mut port: u16 = 0;
        let mut scope_id: Option<u32> = None;

        // SAFETY: peer points to a sockaddr_storage; family discriminates the cast.
        match unsafe { (*peer).family } {
            f if f == posix::AF_INET => {
                // SAFETY: family == AF_INET so peer is sockaddr_in.
                let peer4 = unsafe { &*(peer as *const posix::sockaddr_in) };
                // SAFETY: libc addr-format fn; src points to in_addr, dst is INET6_ADDRSTRLEN+1 bytes.
                hostname = unsafe {
                    inet_ntop(
                        f as c_int,
                        &peer4.addr as *const _ as *const c_void,
                        addr_buf.as_mut_ptr(),
                        addr_buf.len() as c_int,
                    )
                };
                // SAFETY: libc byte-order fn; pure on u16.
                port = unsafe { ntohs(peer4.port) };
            }
            f if f == posix::AF_INET6 => {
                // SAFETY: family == AF_INET6 so peer is sockaddr_in6.
                let peer6 = unsafe { &*(peer as *const posix::sockaddr_in6) };
                // SAFETY: libc addr-format fn; src points to in6_addr, dst is INET6_ADDRSTRLEN+1 bytes.
                hostname = unsafe {
                    inet_ntop(
                        f as c_int,
                        &peer6.addr as *const _ as *const c_void,
                        addr_buf.as_mut_ptr(),
                        addr_buf.len() as c_int,
                    )
                };
                // SAFETY: libc byte-order fn; pure on u16.
                port = unsafe { ntohs(peer6.port) };
                if peer6.scope_id != 0 {
                    scope_id = Some(peer6.scope_id);
                }
            }
            _ => {
                i += 1;
                continue;
            }
        }

        if hostname.is_null() || port == 0 {
            i += 1;
            continue;
        }

        let slice = buf.get_payload(i);
        let truncated = buf.get_truncated(i);

        // SAFETY: inet_ntop returned non-null NUL-terminated string into addr_buf.
        let span = unsafe { core::ffi::CStr::from_ptr(hostname) }.to_bytes();
        let hostname_string = if let Some(id) = scope_id {
            'blk: {
                #[cfg(not(windows))]
                {
                    let mut buffer = [0u8; bun_sys::c::IF_NAMESIZE + 1];
                    // SAFETY: buffer is IF_NAMESIZE+1 bytes, NUL-terminated by zero-init.
                    if !unsafe { bun_sys::c::if_indextoname(id, buffer.as_mut_ptr() as *mut c_char) }.is_null() {
                        // SAFETY: if_indextoname wrote a NUL-terminated string.
                        let name = unsafe { core::ffi::CStr::from_ptr(buffer.as_ptr() as *const c_char) }.to_bytes();
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

        // SAFETY: vm stored at construction; outlives socket.
        let loop_ = unsafe { &*udp_socket.vm }.event_loop();
        loop_.enter();

        let flags = JSValue::create_empty_object(global_this, 1);
        flags.put(global_this, ZigString::static_("truncated"), JSValue::from(truncated));

        let payload_js = match udp_socket.config.binary_type.to_js(slice, global_this) {
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
            &[this_value, payload_js, JSValue::js_number(port), hostname_js, flags],
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
    pub binary_type: ArrayBuffer::BinaryType,
}

impl Default for UDPSocketConfig {
    fn default() -> Self {
        Self {
            hostname: BunString::empty(),
            connect: None,
            port: 0,
            flags: 0,
            binary_type: ArrayBuffer::BinaryType::Buffer,
        }
    }
}

impl UDPSocketConfig {
    pub fn from_js(global_this: &JSGlobalObject, options: JSValue, this_value: JSValue) -> JsResult<Self> {
        if options.is_empty_or_undefined_or_null() || !options.is_object() {
            return global_this.throw_invalid_arguments(format_args!("Expected an object"));
        }

        let port: u16 = 'brk: {
            if let Some(value) = options.get_truthy(global_this, "port")? {
                let number = value.coerce_to_int32(global_this)?;
                if number < 0 || number > 0xffff {
                    return global_this.throw_invalid_arguments(format_args!(
                        "Expected \"port\" to be an integer between 0 and 65535"
                    ));
                }
                break 'brk u16::try_from(number).unwrap();
            } else {
                break 'brk 0;
            }
        };

        let flags: i32 = if let Some(value) = options.get_truthy(global_this, "flags")? {
            validators::validate_int32(global_this, value, "flags", (), None, None)?
        } else {
            0
        };

        let hostname = 'brk: {
            if let Some(value) = options.get_truthy(global_this, "hostname")? {
                if !value.is_string() {
                    return global_this
                        .throw_invalid_arguments(format_args!("Expected \"hostname\" to be a string"));
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
                return global_this
                    .throw_invalid_arguments(format_args!("Expected \"socket\" to be an object"));
            }

            if let Some(value) = options.get_truthy(global_this, "binaryType")? {
                if !value.is_string() {
                    return global_this.throw_invalid_arguments(format_args!(
                        "Expected \"socket.binaryType\" to be a string"
                    ));
                }

                config.binary_type = match ArrayBuffer::BinaryType::from_js_value(global_this, value)? {
                    Some(bt) => bt,
                    None => {
                        return global_this.throw_invalid_arguments(format_args!(
                            "Expected \"socket.binaryType\" to be 'arraybuffer', 'uint8array', or 'buffer'"
                        ));
                    }
                };
            }

            // PORT NOTE: `inline for (handlers)` over [("data","on_data"),("drain","on_drain"),
            // ("error","on_error")] with `@field(UDPSocket.js.gc, handler.1)` — unrolled because
            // Rust cannot index struct fields by runtime/const string.
            // TODO(port): codegen accessor shape (`UDPSocket::js().gc.set(field, ...)`) — verify
            // against generated bindings in Phase B.
            macro_rules! handler {
                ($name:literal, $field:ident) => {
                    if let Some(value) = socket.get_truthy(global_this, $name)? {
                        if !value.is_cell() || !value.is_callable() {
                            return global_this.throw_invalid_arguments(format_args!(
                                concat!("Expected \"socket.", $name, "\" to be a function")
                            ));
                        }
                        let callback = value.with_async_context_if_needed(global_this);
                        UDPSocket::js().gc.$field.set(this_value, global_this, callback);
                    }
                };
            }
            handler!("data", on_data);
            handler!("drain", on_drain);
            handler!("error", on_error);
        }

        if let Some(connect) = options.get_truthy(global_this, "connect")? {
            if !connect.is_object() {
                return global_this
                    .throw_invalid_arguments(format_args!("Expected \"connect\" to be an object"));
            }

            let Some(connect_host_js) = connect.get_truthy(global_this, "hostname")? else {
                return global_this
                    .throw_invalid_arguments(format_args!("Expected \"connect.hostname\" to be a string"));
            };

            if !connect_host_js.is_string() {
                return global_this
                    .throw_invalid_arguments(format_args!("Expected \"connect.hostname\" to be a string"));
            }

            let Some(connect_port_js) = connect.get_truthy(global_this, "port")? else {
                return global_this
                    .throw_invalid_arguments(format_args!("Expected \"connect.port\" to be an integer"));
            };
            let connect_port = connect_port_js.coerce_to_int32(global_this)?;

            let connect_host = connect_host_js.to_bun_string(global_this)?;

            config.connect = Some(ConnectConfig {
                port: if connect_port < 1 || connect_port > 0xffff {
                    0
                } else {
                    u16::try_from(connect_port).unwrap()
                },
                address: connect_host,
            });
        }

        Ok(config)
    }
}

// `UDPSocketConfig::deinit` becomes Drop: `hostname.deref()` and `connect.address.deref()` are
// handled by `bun_str::String`'s own Drop. No explicit body needed.

#[derive(Clone, Copy)]
struct ConnectInfo {
    port: u16,
}

#[bun_jsc::JsClass]
pub struct UDPSocket {
    pub config: UDPSocketConfig,

    pub socket: Option<*mut uws::udp::Socket>,
    pub loop_: &'static uws::Loop,

    pub global_this: *mut JSGlobalObject,
    pub this_value: JsRef,

    pub jsc_ref: JscRef,
    pub poll_ref: KeepAlive,
    /// if marked as closed the socket pointer may be stale
    pub closed: bool,
    connect_info: Option<ConnectInfo>,
    pub vm: *mut VirtualMachine,
}

impl UDPSocket {
    // TODO(port): Codegen.JSUDPSocket — `js`, `to_js`, `from_js`, `from_js_direct` provided by
    // #[bun_jsc::JsClass] derive in Phase B. The `js()` accessor below is a placeholder.
    pub fn js() -> &'static Codegen::JSUDPSocket {
        Codegen::JSUDPSocket::get()
    }

    pub fn new(init: Self) -> *mut Self {
        Box::into_raw(Box::new(init))
    }

    pub fn udp_socket(global_this: &JSGlobalObject, options: JSValue) -> JsResult<JSValue> {
        bun_output::scoped_log!(UdpSocket, "udpSocket");

        let vm = global_this.bun_vm();
        let this_ptr = Self::new(Self {
            socket: None,
            config: UDPSocketConfig::default(),
            global_this: global_this as *const _ as *mut JSGlobalObject,
            loop_: uws::Loop::get(),
            vm,
            this_value: JsRef::empty(),
            jsc_ref: JscRef::init(),
            poll_ref: KeepAlive::init(),
            closed: false,
            connect_info: None,
        });
        // SAFETY: just allocated above; we are the sole owner.
        let this = unsafe { &mut *this_ptr };

        // errdefer { closed = true; close socket; downgrade this_value }
        // Release the strong reference so the JS wrapper can be garbage
        // collected, which will in turn call finalize() to free this struct.
        // Without this, failed config parsing or bind would leave the wrapper
        // pinned forever by the Strong handle and leak. This is idempotent, so
        // it is safe even if onClose() already downgraded via socket.close().
        let guard = scopeguard::guard((), |_| {
            this.closed = true;
            if let Some(socket) = this.socket.take() {
                // SAFETY: socket created by uws::udp::Socket::create; valid until close().
                unsafe { (*socket).close() };
            }
            this.this_value.downgrade();
        });
        // TODO(port): errdefer — scopeguard captures `&mut *this_ptr` by closure; verify borrowck
        // in Phase B (may need to re-derive `&mut` from `this_ptr` inside the closure).

        let this_value = this.to_js(global_this);
        this_value.ensure_still_alive();
        this.this_value.set_strong(this_value, global_this);

        this.config = UDPSocketConfig::from_js(global_this, options, this_value)?;

        let mut err: i32 = 0;

        let hostname_slice = this.config.hostname.to_utf8();
        let hostname_z = bun_str::ZStr::from_bytes(hostname_slice.as_bytes());

        this.socket = uws::udp::Socket::create(
            this.loop_,
            on_data,
            on_drain,
            on_close,
            on_recv_error,
            &hostname_z,
            this.config.port,
            this.config.flags,
            &mut err,
            this_ptr as *mut c_void,
        );
        drop(hostname_z);
        drop(hostname_slice);

        if this.socket.is_none() {
            this.closed = true;
            if err != 0 {
                let code: &'static str = SystemErrno::init(err as c_int).unwrap().into();
                let sys_err = SystemError {
                    errno: err,
                    code: BunString::static_(code),
                    message: BunString::create_format(format_args!(
                        "bind {} {}",
                        code, this.config.hostname
                    )),
                    ..Default::default()
                };
                let error_value = sys_err.to_error_instance(global_this);
                error_value.put(global_this, "address", this.config.hostname.to_js(global_this)?);

                return global_this.throw_value(error_value);
            }

            return global_this.throw(format_args!("Failed to bind socket"));
        }

        if let Some(connect) = &this.config.connect {
            let address_slice = connect.address.to_utf8();
            let address_z = bun_str::ZStr::from_bytes(address_slice.as_bytes());
            // SAFETY: socket is Some (checked above).
            let ret = unsafe { (*this.socket.unwrap()).connect(&address_z, connect.port) };
            if ret != 0 {
                if let Some(sys_err) = bun_sys::Result::<()>::errno_sys(ret, bun_sys::Tag::Connect) {
                    return global_this.throw_value(sys_err.err().to_js(global_this)?);
                }

                if let Some(eai_err) = bun_cares::Error::init_eai(ret) {
                    return global_this.throw_value(
                        eai_err.to_js_with_syscall_and_hostname(global_this, "connect", address_slice.as_bytes())?,
                    );
                }
            }
            this.connect_info = Some(ConnectInfo { port: connect.port });
        }

        // Disarm errdefer.
        scopeguard::ScopeGuard::into_inner(guard);

        this.poll_ref.ref_(vm);
        Ok(bun_jsc::JSPromise::resolved_promise_value(global_this, this_value))
    }

    pub fn call_error_handler(&mut self, this_value_: JSValue, err: JSValue) {
        let this_value = if this_value_.is_empty() {
            match self.this_value.try_get() {
                Some(v) => v,
                None => return,
            }
        } else {
            this_value_
        };
        let callback = Self::js().gc.on_error.get(this_value).unwrap_or(JSValue::ZERO);
        // SAFETY: global_this stored at construction; VM outlives socket.
        let global_this = unsafe { &*self.global_this };
        let vm = global_this.bun_vm();

        if err.is_termination_exception() {
            return;
        }
        if callback.is_empty_or_undefined_or_null() {
            let _ = vm.uncaught_exception(global_this, err, false);
            return;
        }

        let event_loop = vm.event_loop();
        event_loop.enter();
        let result = callback.call(global_this, this_value, &[err.to_error().unwrap_or(err)]);
        if let Err(e) = result {
            global_this.report_active_exception_as_unhandled(e);
        }
        event_loop.exit();
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_broadcast(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::BADF as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len()));
        }

        let enabled = arguments[0].to_boolean();
        // SAFETY: !closed implies socket is Some and valid.
        let res = unsafe { (*this.socket.unwrap()).set_broadcast(enabled) };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Setsockopt) {
            return global_this.throw_value(err.to_js(global_this)?);
        }

        Ok(arguments[0])
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_multicast_loopback(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::BADF as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len()));
        }

        let enabled = arguments[0].to_boolean();
        // SAFETY: !closed implies socket is Some and valid.
        let res = unsafe { (*this.socket.unwrap()).set_multicast_loopback(enabled) };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Setsockopt) {
            return global_this.throw_value(err.to_js(global_this)?);
        }

        Ok(arguments[0])
    }

    fn set_membership(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        drop: bool,
    ) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::BADF as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len()));
        }

        // SAFETY: all-zero is a valid sockaddr_storage.
        let mut addr: posix::sockaddr_storage = unsafe { core::mem::zeroed() };
        if !this.parse_addr(global_this, JSValue::js_number(0), arguments[0], &mut addr)? {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::INVAL as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        // SAFETY: all-zero is a valid sockaddr_storage.
        let mut interface: posix::sockaddr_storage = unsafe { core::mem::zeroed() };

        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };

        let res = if arguments.len() > 1
            && this.parse_addr(global_this, JSValue::js_number(0), arguments[1], &mut interface)?
        {
            if addr.family != interface.family {
                return global_this.throw_invalid_arguments(format_args!(
                    "Family mismatch between address and interface"
                ));
            }
            // SAFETY: socket valid (checked above).
            unsafe { (*socket).set_membership(&addr, Some(&interface), drop) }
        } else {
            // SAFETY: socket valid (checked above).
            unsafe { (*socket).set_membership(&addr, None, drop) }
        };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Setsockopt) {
            return global_this.throw_value(err.to_js(global_this)?);
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_membership(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_membership(this, global_this, callframe, false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn drop_membership(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_membership(this, global_this, callframe, true)
    }

    fn set_source_specific_membership(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        drop: bool,
    ) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::BADF as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        let arguments = callframe.arguments();
        if arguments.len() < 2 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 2 arguments, got {}", arguments.len()));
        }

        let mut source_addr = MaybeUninit::<posix::sockaddr_storage>::uninit();
        // SAFETY: parse_addr fully initializes on success; we never read on failure.
        if !this.parse_addr(global_this, JSValue::js_number(0), arguments[0], unsafe {
            &mut *source_addr.as_mut_ptr()
        })? {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::INVAL as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }
        // SAFETY: initialized by parse_addr above.
        let source_addr = unsafe { source_addr.assume_init() };

        let mut group_addr = MaybeUninit::<posix::sockaddr_storage>::uninit();
        // SAFETY: see above.
        if !this.parse_addr(global_this, JSValue::js_number(0), arguments[1], unsafe {
            &mut *group_addr.as_mut_ptr()
        })? {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::INVAL as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }
        // SAFETY: initialized by parse_addr above.
        let group_addr = unsafe { group_addr.assume_init() };

        if source_addr.family != group_addr.family {
            return global_this.throw_invalid_arguments(format_args!(
                "Family mismatch between source and group addresses"
            ));
        }

        let mut interface = MaybeUninit::<posix::sockaddr_storage>::uninit();

        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };

        let res = if arguments.len() > 2
            && this.parse_addr(global_this, JSValue::js_number(0), arguments[2], unsafe {
                &mut *interface.as_mut_ptr()
            })?
        {
            // SAFETY: initialized by parse_addr above.
            let interface = unsafe { interface.assume_init() };
            if source_addr.family != interface.family {
                return global_this.throw_invalid_arguments(format_args!(
                    "Family mismatch among source, group and interface addresses"
                ));
            }
            // SAFETY: socket valid (checked above).
            unsafe { (*socket).set_source_specific_membership(&source_addr, &group_addr, Some(&interface), drop) }
        } else {
            // SAFETY: socket valid (checked above).
            unsafe { (*socket).set_source_specific_membership(&source_addr, &group_addr, None, drop) }
        };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Setsockopt) {
            return global_this.throw_value(err.to_js(global_this)?);
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn add_source_specific_membership(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_source_specific_membership(this, global_this, callframe, false)
    }

    #[bun_jsc::host_fn(method)]
    pub fn drop_source_specific_membership(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_source_specific_membership(this, global_this, callframe, true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_multicast_interface(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::BADF as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len()));
        }

        let mut addr = MaybeUninit::<posix::sockaddr_storage>::uninit();

        // SAFETY: parse_addr fully initializes on success; never read on failure.
        if !this.parse_addr(global_this, JSValue::js_number(0), arguments[0], unsafe {
            &mut *addr.as_mut_ptr()
        })? {
            return Ok(JSValue::FALSE);
        }
        // SAFETY: initialized by parse_addr above.
        let addr = unsafe { addr.assume_init() };

        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };

        // SAFETY: socket valid (checked above).
        let res = unsafe { (*socket).set_multicast_interface(&addr) };

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Setsockopt) {
            return global_this.throw_value(err.to_js(global_this)?);
        }

        Ok(JSValue::TRUE)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_ttl(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_any_ttl(this, global_this, callframe, uws::udp::Socket::set_unicast_ttl)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_multicast_ttl(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        Self::set_any_ttl(this, global_this, callframe, uws::udp::Socket::set_multicast_ttl)
    }

    fn set_any_ttl(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        function: fn(*mut uws::udp::Socket, i32) -> c_int,
    ) -> JsResult<JSValue> {
        // PERF(port): was comptime monomorphization — profile in Phase B.
        if this.closed {
            return global_this.throw_value(
                bun_sys::Result::<()>::errno_sys(posix::E::BADF as i32, bun_sys::Tag::Setsockopt)
                    .unwrap()
                    .to_js(global_this)?,
            );
        }

        let arguments = callframe.arguments();
        if arguments.len() < 1 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len()));
        }

        let ttl = arguments[0].coerce_to_int32(global_this)?;
        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };
        let res = function(socket, ttl);

        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Setsockopt) {
            return global_this.throw_value(err.to_js(global_this)?);
        }

        Ok(JSValue::js_number(ttl))
    }

    #[bun_jsc::host_fn(method)]
    pub fn send_many(
        this: &mut Self,
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
            this: &'a mut UDPSocket,
            global_this: &'a JSGlobalObject,
            callframe: &'a CallFrame,
            result: JsResult<JSValue>,
        }
        extern "C" fn run(ctx: *mut c_void, payload_roots: *mut MarkedArgumentBuffer) {
            // SAFETY: ctx points to a stack-local Ctx; payload_roots provided by
            // MarkedArgumentBuffer::run for the duration of this call.
            let ctx = unsafe { &mut *(ctx as *mut Ctx) };
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
        MarkedArgumentBuffer::run(&mut ctx as *mut _ as *mut c_void, run);
        ctx.result
    }

    fn send_many_impl(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        payload_roots: &mut MarkedArgumentBuffer,
    ) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw(format_args!("Socket is closed"));
        }
        let arguments = callframe.arguments_old(1);
        if arguments.len != 1 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len));
        }

        let arg = arguments.ptr[0];
        if !arg.js_type().is_array() {
            return global_this.throw_invalid_argument_type("sendMany", "first argument", "array");
        }

        // Cache the connection state before doing anything that can run user JS.
        // Array index getters, `port.valueOf()`, and `address.toString()` can all
        // call back into JS and connect/disconnect/close this socket. If we re-read
        // `this.connect_info` on every iteration, a mid-loop flip changes how
        // `slice_idx` is computed and which branch writes into `payloads`/`lens`/
        // `addr_ptrs`, producing out-of-bounds writes (unconnected -> connected) or
        // uninitialized slots (connected -> disconnected) in the arena buffers.
        let connected = this.connect_info.is_some();

        let array_len = arg.get_length(global_this)?;
        if !connected && array_len % 3 != 0 {
            return global_this
                .throw_invalid_arguments(format_args!("Expected 3 arguments for each packet"));
        }

        let len = if connected { array_len } else { array_len / 3 };

        // PERF(port): was arena bulk-free — profile in Phase B.
        let mut payload_vals: Vec<JSValue> = Vec::with_capacity(len);
        payload_vals.resize(len, JSValue::ZERO);
        let mut payloads: Vec<*const u8> = vec![core::ptr::null(); len];
        let mut lens: Vec<usize> = vec![0; len];
        let mut addr_ptrs: Vec<*const c_void> = vec![core::ptr::null(); len];
        let mut addrs: Vec<posix::sockaddr_storage> = Vec::with_capacity(len);
        // SAFETY: sockaddr_storage is POD; entries written before read in phase 1/2.
        unsafe { addrs.set_len(len) };

        let mut iter = arg.array_iterator(global_this)?;

        // Phase 1: collect and validate payload JSValues, resolve addresses.
        // All user-JS re-entrance happens here. Root each payload in the
        // MarkedArgumentBuffer so GC cannot collect it, but do NOT yet borrow
        // raw pointers into backing stores — user JS on a later iteration
        // could otherwise free or detach that storage.
        let mut i: u32 = 0;
        let mut port: JSValue = JSValue::ZERO;
        while let Some(val) = iter.next(global_this)? {
            if (i as usize) >= array_len {
                return global_this.throw_invalid_arguments(format_args!(
                    "Mismatch between array length property and number of items"
                ));
            }
            let slice_idx = if connected { i as usize } else { (i / 3) as usize };
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
                    return global_this.throw_invalid_arguments(format_args!(
                        "Expected ArrayBufferView or string as payload"
                    ));
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
                    return global_this.throw_invalid_arguments(format_args!("Invalid address"));
                }
                addr_ptrs[slice_idx] = &addrs[slice_idx] as *const _ as *const c_void;
            }
            i += 1;
        }
        if (i as usize) != array_len {
            return global_this.throw_invalid_arguments(format_args!(
                "Mismatch between array length property and number of items"
            ));
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
        // TODO(port): `val.asString().toSlice(globalThis, alloc)` returned a ZigString.Slice owned
        // by the arena in Zig. Here we collect them into a Vec so they live until socket.send().
        let mut string_slices: Vec<bun_str::Utf8Slice> = Vec::with_capacity(len);
        for (slice_idx, val) in payload_vals.iter().enumerate() {
            let slice: &[u8] = 'brk: {
                if let Some(array_buffer) = val.as_array_buffer(global_this) {
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
                // plain cast (no `toPrimitive`, no user JS).
                string_slices.push(val.as_string().to_slice(global_this));
                break 'brk string_slices.last().unwrap().as_bytes();
            };
            payloads[slice_idx] = slice.as_ptr();
            lens[slice_idx] = slice.len();
        }

        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };
        // SAFETY: socket valid (checked above).
        let res = unsafe { (*socket).send(&payloads, &lens, &addr_ptrs) };
        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Send) {
            return global_this.throw_value(err.to_js(global_this)?);
        }
        Ok(JSValue::js_number(res))
    }

    #[bun_jsc::host_fn(method)]
    pub fn send(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        if this.closed {
            return global_this.throw(format_args!("Socket is closed"));
        }
        let arguments = callframe.arguments_old(3);
        let dst: Option<Destination> = 'brk: {
            if this.connect_info.is_some() {
                if arguments.len == 1 {
                    break 'brk None;
                }
                if arguments.len == 3 {
                    return global_this.throw_invalid_arguments(format_args!(
                        "Cannot specify destination on connected socket"
                    ));
                }
                return global_this
                    .throw_invalid_arguments(format_args!("Expected 1 argument, got {}", arguments.len));
            } else {
                if arguments.len != 3 {
                    return global_this
                        .throw_invalid_arguments(format_args!("Expected 3 arguments, got {}", arguments.len));
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
        // SAFETY: all-zero is a valid sockaddr_storage.
        let mut addr: posix::sockaddr_storage = unsafe { core::mem::zeroed() };
        let addr_ptr: *const c_void = 'brk: {
            if let Some(dest) = dst {
                if !this.parse_addr(global_this, dest.port, dest.address, &mut addr)? {
                    return global_this.throw_invalid_arguments(format_args!("Invalid address"));
                }
                break 'brk &addr as *const _ as *const c_void;
            } else {
                break 'brk core::ptr::null();
            }
        };

        let payload_arg = arguments.ptr[0];
        let mut payload_str = ZigString::Slice::empty();
        let payload: &[u8] = 'brk: {
            if let Some(array_buffer) = payload_arg.as_array_buffer(global_this) {
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
                payload_str = payload_arg.to_js_string(global_this)?.to_slice(global_this);
                break 'brk payload_str.slice();
            } else {
                return global_this.throw_invalid_arguments(format_args!(
                    "Expected ArrayBufferView or string as first argument"
                ));
            }
        };

        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };
        // SAFETY: socket valid (checked above).
        let res = unsafe { (*socket).send(&[payload.as_ptr()], &[payload.len()], &[addr_ptr]) };
        drop(payload_str);
        if let Some(err) = get_us_error::<true>(res, bun_sys::Tag::Send) {
            return global_this.throw_value(err.to_js(global_this)?);
        }
        Ok(JSValue::from(res > 0))
    }

    fn parse_addr(
        &mut self,
        global_this: &JSGlobalObject,
        port_val: JSValue,
        address_val: JSValue,
        storage: &mut posix::sockaddr_storage,
    ) -> JsResult<bool> {
        let _ = self;
        let number = port_val.coerce_to_int32(global_this)?;
        let port: u16 = if number < 1 || number > 0xffff {
            0
        } else {
            u16::try_from(number).unwrap()
        };

        let str = address_val.to_bun_string(global_this)?;
        let mut address_slice = str.to_owned_slice_z()?;

        // SAFETY: storage is large enough to hold sockaddr_in.
        let addr4 = unsafe { &mut *(storage as *mut _ as *mut posix::sockaddr_in) };
        // SAFETY: libc addr-format fn; src is NUL-terminated, dst points to in_addr-sized storage.
        if unsafe {
            inet_pton(
                posix::AF_INET as c_int,
                address_slice.as_ptr() as *const c_char,
                &mut addr4.addr as *mut _ as *mut c_void,
            )
        } == 1
        {
            // SAFETY: libc byte-order fn; pure on u16.
            addr4.port = unsafe { htons(port) };
            addr4.family = posix::AF_INET;
        } else {
            // SAFETY: storage is large enough to hold sockaddr_in6.
            let addr6 = unsafe { &mut *(storage as *mut _ as *mut posix::sockaddr_in6) };
            addr6.scope_id = 0;

            if let Some(percent) = str.index_of_ascii_char(b'%') {
                if percent + 1 < str.length() {
                    let iface_id: u32 = 'blk: {
                        #[cfg(windows)]
                        {
                            if let Some(signed) = str.substring(percent + 1).to_int32() {
                                if let Ok(id) = u32::try_from(signed) {
                                    break 'blk id;
                                }
                            }
                        }
                        #[cfg(not(windows))]
                        {
                            // SAFETY: address_slice is NUL-terminated; offset is in-bounds.
                            let index = unsafe {
                                bun_sys::c::if_nametoindex(
                                    address_slice.as_ptr().add(percent + 1) as *const c_char
                                )
                            };
                            if index > 0 {
                                if let Ok(id) = u32::try_from(index) {
                                    break 'blk id;
                                }
                            }
                        }
                        // "an invalid Scope gets turned into #0 (default selection)"
                        // (test-dgram-multicast-set-interface.js)
                        break 'blk 0;
                    };

                    address_slice[percent] = b'\0';
                    addr6.scope_id = iface_id;
                }
            }

            // SAFETY: libc addr-format fn; src is NUL-terminated, dst points to in6_addr-sized storage.
            if unsafe {
                inet_pton(
                    posix::AF_INET6 as c_int,
                    address_slice.as_ptr() as *const c_char,
                    &mut addr6.addr as *mut _ as *mut c_void,
                )
            } == 1
            {
                // SAFETY: libc byte-order fn; pure on u16.
                addr6.port = unsafe { htons(port) };
                addr6.family = posix::AF_INET6;
            } else {
                return Ok(false);
            }
        }

        Ok(true)
    }

    #[bun_jsc::host_fn(method)]
    pub fn ref_(this: &mut Self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        if !this.closed {
            this.poll_ref.ref_(global_this.bun_vm());
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unref(this: &mut Self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        this.poll_ref.unref(global_this.bun_vm());

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(this: &mut Self, _: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        if !this.closed {
            let Some(socket) = this.socket.take() else {
                return Ok(JSValue::UNDEFINED);
            };
            // SAFETY: socket created by uws::udp::Socket::create; valid until close().
            unsafe { (*socket).close() };
            this.this_value.downgrade();
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(this: &mut Self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_old(1);

        if args.len < 1 {
            return global_this.throw_invalid_arguments(format_args!("Expected 1 argument"));
        }

        let options = args.ptr[0];
        let Some(this_value) = this.this_value.try_get() else {
            return Ok(JSValue::UNDEFINED);
        };
        let config = UDPSocketConfig::from_js(global_this, options, this_value)?;

        let previous_config = core::mem::replace(&mut this.config, config);
        drop(previous_config);

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_closed(this: &Self, _: &JSGlobalObject) -> JSValue {
        JSValue::from(this.closed)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_hostname(this: &Self, _: &JSGlobalObject) -> JsResult<JSValue> {
        // SAFETY: global_this stored at construction; VM outlives socket.
        this.config.hostname.to_js(unsafe { &*this.global_this })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_port(this: &Self, _: &JSGlobalObject) -> JSValue {
        if this.closed {
            return JSValue::UNDEFINED;
        }
        // SAFETY: !closed implies socket is Some and valid.
        JSValue::js_number(unsafe { (*this.socket.unwrap()).bound_port() })
    }

    fn create_sock_addr(global_this: &JSGlobalObject, address_bytes: &[u8], port: u16) -> JSValue {
        let Ok(mut sockaddr) = SocketAddress::init(address_bytes, port) else {
            return JSValue::UNDEFINED;
        };
        sockaddr.into_dto(global_this).unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_address(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if this.closed {
            return JSValue::UNDEFINED;
        }
        let mut buf = [0u8; 64];
        let mut length: i32 = 64;
        // SAFETY: !closed implies socket is Some and valid.
        unsafe { (*this.socket.unwrap()).bound_ip(buf.as_mut_ptr(), &mut length) };

        let address_bytes = &buf[..usize::try_from(length).unwrap()];
        // SAFETY: !closed implies socket is Some and valid.
        let port = unsafe { (*this.socket.unwrap()).bound_port() };
        Self::create_sock_addr(global_this, address_bytes, u16::try_from(port).unwrap())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_address(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if this.closed {
            return JSValue::UNDEFINED;
        }
        let Some(connect_info) = this.connect_info else {
            return JSValue::UNDEFINED;
        };
        let mut buf = [0u8; 64];
        let mut length: i32 = 64;
        // SAFETY: !closed implies socket is Some and valid.
        unsafe { (*this.socket.unwrap()).remote_ip(buf.as_mut_ptr(), &mut length) };

        let address_bytes = &buf[..usize::try_from(length).unwrap()];
        Self::create_sock_addr(global_this, address_bytes, connect_info.port)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_binary_type(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match this.config.binary_type {
            ArrayBuffer::BinaryType::Buffer => global_this.common_strings().buffer(),
            ArrayBuffer::BinaryType::Uint8Array => global_this.common_strings().uint8array(),
            ArrayBuffer::BinaryType::ArrayBuffer => global_this.common_strings().arraybuffer(),
            _ => panic!("Invalid binary type"),
        })
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(UdpSocket, "Finalize {:p}", this);
        // SAFETY: finalize called once by JSC GC with the m_ctx payload.
        let this_ref = unsafe { &mut *this };
        this_ref.this_value.finalize();
        Self::deinit(this);
    }

    fn deinit(this: *mut Self) {
        // SAFETY: called from finalize with valid Box-allocated payload.
        let this_ref = unsafe { &mut *this };
        debug_assert!(this_ref.closed || unsafe { &*this_ref.vm }.is_shutting_down());
        this_ref.poll_ref.disable();
        // config drop handled by Box::from_raw below.
        // this_value.deinit() handled by JsRef Drop.
        // SAFETY: allocated via Box::into_raw in `new`; this is the matching free.
        drop(unsafe { Box::from_raw(this) });
    }

    #[bun_jsc::host_fn]
    pub fn js_connect(global_this: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let args = call_frame.arguments_old(2);

        let Some(this) = call_frame.this().as_::<UDPSocket>() else {
            return global_this.throw_invalid_arguments(format_args!("Expected UDPSocket as 'this'"));
        };

        if this.connect_info.is_some() {
            return global_this.throw(format_args!("Socket is already connected"));
        }

        if this.closed {
            return global_this.throw(format_args!("Socket is closed"));
        }

        if args.len < 2 {
            return global_this.throw_invalid_arguments(format_args!("Expected 2 arguments"));
        }

        let str = args.ptr[0].to_bun_string(global_this)?;
        let connect_host = str.to_owned_slice_z().expect("OOM");

        let connect_port_js = args.ptr[1];

        if !connect_port_js.is_number() {
            return global_this
                .throw_invalid_arguments(format_args!("Expected \"port\" to be an integer"));
        }

        let connect_port = connect_port_js.as_int32();
        let port: u16 = if connect_port < 1 || connect_port > 0xffff {
            0
        } else {
            u16::try_from(connect_port).unwrap()
        };

        let Some(socket) = this.socket else {
            return global_this.throw(format_args!("Socket is closed"));
        };
        // SAFETY: socket valid (checked above).
        if unsafe { (*socket).connect(&connect_host, port) } == -1 {
            return global_this.throw(format_args!("Failed to connect socket"));
        }
        this.connect_info = Some(ConnectInfo { port });

        Self::js().address_set_cached(call_frame.this(), global_this, JSValue::ZERO);
        Self::js().remote_address_set_cached(call_frame.this(), global_this, JSValue::ZERO);

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub fn js_disconnect(global_object: &JSGlobalObject, call_frame: &CallFrame) -> JsResult<JSValue> {
        let Some(this) = call_frame.this().as_::<UDPSocket>() else {
            return global_object.throw_invalid_arguments(format_args!("Expected UDPSocket as 'this'"));
        };

        if this.connect_info.is_none() {
            return global_object.throw(format_args!("Socket is not connected"));
        }

        if this.closed {
            return global_object.throw(format_args!("Socket is closed"));
        }

        // SAFETY: !closed implies socket is Some and valid.
        if unsafe { (*this.socket.unwrap()).disconnect() } == -1 {
            return global_object.throw(format_args!("Failed to disconnect socket"));
        }
        this.connect_info = None;

        Ok(JSValue::UNDEFINED)
    }
}

struct Destination {
    port: JSValue,
    address: JSValue,
}

fn get_us_error<const USE_WSA: bool>(res: c_int, tag: bun_sys::Tag) -> Option<bun_sys::Result<()>> {
    #[cfg(windows)]
    {
        // setsockopt returns 0 on success, but errnoSys considers 0 to be failure on Windows.
        // This applies to some other usockets functions too.
        if res >= 0 {
            return None;
        }

        if USE_WSA {
            if let Some(wsa) = bun_sys::windows::wsa_get_last_error() {
                if wsa != bun_sys::windows::WsaError::SUCCESS {
                    // SAFETY: WSASetLastError is thread-local errno write; always safe.
                    unsafe { bun_sys::windows::ws2_32::WSASetLastError(0) };
                    return bun_sys::Result::<()>::errno(wsa.to_e(), tag);
                }
            }
        }

        // SAFETY: _errno() returns a valid pointer to thread-local errno.
        let errno_val = unsafe { *bun_sys::c::_errno() };
        // SAFETY: bun_sys::E is #[repr(i32)] covering valid errno range.
        return bun_sys::Result::<()>::errno(unsafe { core::mem::transmute::<i32, bun_sys::E>(errno_val) }, tag);
    }
    #[cfg(not(windows))]
    {
        let _ = USE_WSA;
        bun_sys::Result::<()>::errno_sys(res, tag)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/udp_socket.zig (1091 lines)
//   confidence: medium
//   todos:      4
//   notes:      .classes.ts codegen accessors (js.gc.on_*, addressSetCached) and MarkedArgumentBuffer::run signature need verification; errdefer scopeguard in udp_socket() may need raw-ptr capture for borrowck
// ──────────────────────────────────────────────────────────────────────────
