//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use crate::generated_bindgen::socket_body::{BunSocket, SocketHandle, js_TCPSocket, js_TLSSocket};
use bun_core::EncodedSlice;
use bun_io::KeepAlive;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::JsCell;
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_ptr::RefPtr;
// do NOT `use bun_boringssl_sys::SSL` here — it shadows the
// `const SSL: bool` generic param in `NewSocket<SSL>` below, making rustc
// resolve `<SSL>` as a type arg (E0747). Use the qualified path instead.
use bun_boringssl_sys::SSL_CTX;
use bun_core::{self, fmt as bun_fmt};
use bun_jsc::SysErrorJsc;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, SystemError};
// `bun_jsc::VirtualMachine` is the *module* (alias of `virtual_machine`); name the
// struct directly so `VirtualMachine::get()` resolves as an associated fn.
use super::upgraded_duplex::{ServerVerify, UpgradedDuplex};
use crate::crypto::boringssl_jsc::err_to_js as boringssl_err_to_js;
use crate::node::{BlobOrStringOrBuffer, StringObjects, StringOrBuffer};
use crate::socket::SSLConfig;
use crate::socket::ssl_config::ParsedTls;
use bun_boringssl_sys as boringssl_sys;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::String as BunString;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys as sys;
use bun_uws as uws;

/// Shorthand for the JS-side `EventLoopCtx` (replaces direct VM passing to
/// `KeepAlive::ref_/unref` — `bun_io` no longer accepts `&VirtualMachine`).
#[inline]
fn js_loop_ctx() -> bun_io::EventLoopCtx {
    bun_io::posix_event_loop::get_vm_ctx(bun_io::posix_event_loop::AllocatorType::Js)
}

/// The `recv()` failure or `SO_ERROR` that uSockets closed the socket with (`> 2`, see `on_close`).
fn read_error_from_close_code(code: c_int) -> sys::Error {
    let errno = uws::SocketGroup::errno(code);
    // libuv reports WSAECONNABORTED as ECONNRESET on the read path (uv__process_tcp_read_req).
    #[cfg(windows)]
    let errno = errno.filter(|errno| *errno != sys::SystemErrno::ECONNABORTED);
    sys::Error::new(
        errno.unwrap_or(sys::SystemErrno::ECONNRESET),
        sys::Tag::read,
    )
}

/// "IPv4" or "IPv6" for the 4 or 16 address bytes uSockets reports, `undefined` for a socket with no such address.
fn ip_family_to_js(global: &JSGlobalObject, address: Option<&[u8]>) -> JSValue {
    match address.map_or(0, <[u8]>::len) {
        4 => global.common_strings().ipv4(),
        16 => global.common_strings().ipv6(),
        _ => JSValue::UNDEFINED,
    }
}

/// The text of the same bytes.
pub(super) fn ip_address_to_js(
    global: &JSGlobalObject,
    address: Option<&[u8]>,
) -> JsResult<JSValue> {
    let address = address.unwrap_or_default();
    let ip: std::net::IpAddr = if let Ok(v4) = <[u8; 4]>::try_from(address) {
        v4.into()
    } else if let Ok(v6) = <[u8; 16]>::try_from(address) {
        v6.into()
    } else {
        return Ok(JSValue::UNDEFINED);
    };
    let mut text_buf = [0u8; 512];
    // `format_ip` strips the port and the brackets of `addr:port` / `[addr]:port`, so a bare `IpAddr` would corrupt IPv6.
    let text =
        bun_fmt::format_ip(&std::net::SocketAddr::new(ip, 0), &mut text_buf).expect("unreachable");
    bun_string_jsc::create_utf8_for_js(global, text)
}

/// `errno` as the status libuv hands a write request's callback.
pub(super) fn uv_status(errno: sys::SystemErrno) -> c_int {
    #[cfg(windows)]
    {
        sys::windows::libuv::e_discriminant_to_uv(errno as u16).unwrap_or(-(errno as c_int))
    }
    #[cfg(not(windows))]
    {
        -(errno as c_int)
    }
}

/// Why a send failed, from uSockets' numbering.
fn send_errno(send_error: c_int) -> sys::SystemErrno {
    uws::SocketGroup::errno(send_error).unwrap_or(sys::SystemErrno::ECONNRESET)
}

/// `read_error_from_close_code` for C++: the `closeError` getter of `JSNodeHTTPServerSocket`.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn Bun__socketReadErrorFromCloseCode(
    global: &JSGlobalObject,
    code: c_int,
) -> JSValue {
    <sys::Error as jsc::SysErrorJsc>::to_js(&read_error_from_close_code(code), global)
}

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub(super) use super::handlers::Handlers;
use super::pending_writes::{Completion, PendingWrites};
use std::rc::Rc;

mod tls_socket_functions;
use crate::api::SSLContextCache::SSLContextCache;
use crate::api::bun::h2_frame_parser::H2FrameParser;
use crate::api::bun_secure_context::SecureContext;
use crate::server::ServerWebSocket;
use crate::socket::udp_socket::get_us_error;
pub(crate) use tls_socket_functions::TlsHandle;

bun_output::declare_scope!(Socket, visible);
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(Socket, $($arg)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// ALPN select callback
// ──────────────────────────────────────────────────────────────────────────

/// The socket `on_open` put on the `SSL`. An `SSL_CTX` is shared, so its ALPN callback has no argument of its own.
fn alpn_socket(ssl: *mut bun_boringssl_sys::SSL) -> Option<bun_ptr::ThisPtr<TLSSocket>> {
    // BoringSSL never invokes the ALPN callback with a null `SSL*`; route
    // through the const-asserted opaque-ZST accessor so the call is safe.
    let this_ptr =
        tls_socket_functions::ffi::us_ssl_bun_socket(boringssl_sys::SSL::opaque_ref(ssl));
    if this_ptr.is_null() {
        return None;
    }
    // SAFETY: a `*mut TLSSocket` (set in on_open, taken back in on_close), kept
    // live for this handshake callback by the JS wrapper's ref.
    let this = unsafe { bun_ptr::ThisPtr::new(this_ptr.cast::<TLSSocket>()) };
    // Same handlers-presence guard as every other dispatch entry point:
    // an idle socket has dropped its Handlers, and the ALPN selection
    // callback can still fire for a connection JS already detached -
    // get_handlers() would panic.
    this.has_handlers().then_some(this)
}

/// Runs `ALPNCallback` before BoringSSL picks the certificate and the session, so its `setKeyCert()` still applies. Returns 0 if it refused.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn us_dispatch_alpn_offer(
    ssl: *mut bun_boringssl_sys::SSL,
    in_: *const u8,
    inlen: c_uint,
) -> c_int {
    let Some(this) = alpn_socket(ssl) else {
        return 1;
    };
    let refuse = || {
        this.update_flags(|f| f.insert(Flags::ALPN_REFUSED));
        0
    };
    // Dynamic per-connection ALPN: when the listener's config carries an
    // `alpnCallback` handler, consult it with the client's protocol list (and
    // the SNI name) before the static ALPNProtocols list. The JS handler
    // returns `false` when the server has no ALPNCallback (fall through to
    // the static list), the selected protocol string, or anything else to
    // refuse the connection with a fatal no_application_protocol alert - the
    // same contract as Node's ALPNCallback.
    {
        let handlers = this.get_handlers();
        let callback = handlers.on_alpn_callback();
        if !callback.is_empty() && !in_.is_null() && inlen > 0 {
            // Snapshot the per-loop BIO routing state around everything below that
            // can run JS touching another TLS socket (the callback, its `error`
            // handler, the selection's `toString`, the scope's checkpoint), and
            // restore it on every path back to BoringSSL — after the scope guard
            // below has exited, since this guard is declared first.
            const LOOP_STATE_SLOTS: usize = 6; // US_SSL_LOOP_STATE_SLOTS
            debug_assert_eq!(
                LOOP_STATE_SLOTS as core::ffi::c_int,
                tls_socket_functions::ffi::us_internal_ssl_loop_state_slots(),
                "loop-state snapshot size drifted from US_SSL_LOOP_STATE_SLOTS in internal.h"
            );
            let mut saved_loop_state: [*mut c_void; LOOP_STATE_SLOTS] =
                [core::ptr::null_mut(); LOOP_STATE_SLOTS];
            tls_socket_functions::ffi::us_internal_ssl_loop_state_save(
                boringssl_sys::SSL::opaque_ref(ssl),
                saved_loop_state.as_mut_ptr(),
            );
            let _restore_loop_state = scopeguard::guard(saved_loop_state, |mut saved| {
                tls_socket_functions::ffi::us_internal_ssl_loop_state_restore(saved.as_mut_ptr());
            });
            // Exited (and, at loop entry, checkpointed) when this block ends or
            // returns, before the loop state is restored.
            let _scope = ScopeExit {
                socket: this,
                scope: Some(handlers.enter()),
            };
            let global = handlers.global_object;
            let this_value = this.get_this_value(&global);
            let wire_len = inlen as usize;
            // BoringSSL's select-certificate callback is these sockets' landing frame for this
            // event: whatever it leaves pending is folded before returning to C.
            let buffer = match JSValue::create_buffer_from_length(&global, wire_len) {
                Ok(b) => b,
                Err(err) => {
                    crate::dispatch::fold(Err(err));
                    return refuse();
                }
            };
            if let Some(ab) = buffer.as_array_buffer(&global) {
                // SAFETY: `ab.ptr` points at a fresh `wire_len`-byte JS buffer
                // and `in_` is valid for `inlen` per the callback contract.
                unsafe { core::ptr::copy_nonoverlapping(in_, ab.ptr, wire_len) };
            }
            // SAFETY: `ssl` is the live SSL handle passed into the select-certificate
            // callback; SSL_get_servername reads the ClientHello's SNI name and
            // returns NULL or a NUL-terminated string owned by the SSL.
            let servername_ptr = unsafe { boringssl_sys::SSL_get_servername(ssl.cast_const(), 0) };
            let servername_js = if servername_ptr.is_null() {
                JSValue::UNDEFINED
            } else {
                // SAFETY: BoringSSL hands back a NUL-terminated name.
                let name = unsafe { core::ffi::CStr::from_ptr(servername_ptr) };
                EncodedSlice::latin1(name.to_bytes()).to_js(&global)
            };
            let result =
                match callback.call(&global, this_value, &[this_value, servername_js, buffer]) {
                    Ok(v) => v,
                    Err(err) => global.take_exception(err),
                };
            if let Some(err_value) = result.to_error() {
                crate::dispatch::fold(
                    handlers.call_error_handler(this_value, &[this_value, err_value]),
                );
                return refuse();
            }
            if !result.is_boolean() || result.to_boolean() {
                // The server has an ALPNCallback and it answered: a string
                // selects that protocol for this connection; anything else
                // refuses it.
                let chosen = match result.to_utf8(&global) {
                    Ok(chosen) => chosen,
                    Err(err) => {
                        // The selection's ToString threw (a Symbol or a throwing
                        // toString): hand it to `error` like the callback's own
                        // throw, then refuse the protocol.
                        let err_value = global.take_error(err);
                        crate::dispatch::fold(
                            handlers.call_error_handler(this_value, &[this_value, err_value]),
                        );
                        return refuse();
                    }
                };
                let chosen_bytes = chosen.slice();
                if !result.is_string() || chosen_bytes.is_empty() || chosen_bytes.len() > 255 {
                    return refuse();
                }
                let mut wire = Vec::with_capacity(chosen_bytes.len() + 1);
                wire.push(chosen_bytes.len() as u8);
                wire.extend_from_slice(chosen_bytes);
                this.protos.set(Some(wire.into_boxed_slice()));
                // `us_dispatch_alpn_select` runs the standard selection, which now
                // negotiates against the single chosen protocol (and sends the
                // fatal alert if the client did not actually offer it).
            }
        }
    }
    1
}

/// BoringSSL's ALPN select callback for a server whose listen socket has no protocol list of its own.
#[unsafe(no_mangle)]
pub(crate) extern "C" fn us_dispatch_alpn_select(
    ssl: *mut bun_boringssl_sys::SSL,
    out: *mut *const u8,
    outlen: *mut u8,
    in_: *const u8,
    inlen: c_uint,
) -> c_int {
    let Some(this) = alpn_socket(ssl) else {
        return boringssl_sys::SSL_TLSEXT_ERR_NOACK;
    };
    if this.flags.get().contains(Flags::ALPN_REFUSED) {
        return boringssl_sys::SSL_TLSEXT_ERR_ALERT_FATAL;
    }
    if let Some(protos) = this.protos.get() {
        if protos.is_empty() {
            return boringssl_sys::SSL_TLSEXT_ERR_NOACK;
        }
        // SAFETY: out/outlen/in are valid per BoringSSL ALPN callback contract.
        let status = unsafe {
            boringssl_sys::SSL_select_next_proto(
                out.cast::<*mut u8>(),
                outlen,
                protos.as_ptr(),
                c_uint::try_from(protos.len()).expect("int cast"),
                in_,
                inlen,
            )
        };
        // Previous versions of Node.js returned SSL_TLSEXT_ERR_NOACK if no protocol
        // match was found. This would neither cause a fatal alert nor would it result
        // in a useful ALPN response as part of the Server Hello message.
        // We now return SSL_TLSEXT_ERR_ALERT_FATAL in that case as per Section 3.2
        // of RFC 7301, which causes a fatal no_application_protocol alert.
        if status == boringssl_sys::OPENSSL_NPN_NEGOTIATED {
            boringssl_sys::SSL_TLSEXT_ERR_OK
        } else {
            boringssl_sys::SSL_TLSEXT_ERR_ALERT_FATAL
        }
    } else {
        boringssl_sys::SSL_TLSEXT_ERR_NOACK
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NewSocket<SSL>
// ──────────────────────────────────────────────────────────────────────────

/// Generic socket wrapper. `SSL = false` → `TCPSocket`, `SSL = true` → `TLSSocket`.
// Methods take `&self` and mutated fields are `Cell`/`JsCell`: a handler can call `socket.write()` while a method runs.
#[repr(C)]
#[derive(bun_ptr::RefCounted)]
pub(crate) struct NewSocket<const SSL: bool> {
    pub(crate) socket: Cell<uws::NewSocketHandler<SSL>>,
    /// A TLS socket whose close still waits for the peer. `socket` is detached by then, so `terminate()` closes this one.
    pub(crate) closing: Cell<uws::NewSocketHandler<SSL>>,

    pub(crate) flags: Cell<Flags>,
    pub(crate) ref_count: bun_ptr::RefCount<Self>,
    /// The callbacks this socket dispatches to: shared with its listener and
    /// sibling sockets (server), or with its own reconnects and TLS twin
    /// (client). `None` once the socket has gone idle or been detached, which
    /// every dispatch entry point treats as "nothing left to call".
    ///
    /// `Rc`, not a raw pointer: JS dispatch is reentrant (a `close` handler can
    /// re-enter `connect` and repoint this field) and every in-flight callback
    /// [`Scope`] holds its own reference, so the callbacks outlive the frame
    /// that is running them.
    pub(crate) handlers: JsCell<Option<Rc<Handlers>>>,
    /// Reference to the JS wrapper. Held strong while the socket is active so the
    /// wrapper cannot be garbage-collected out from under in-flight callbacks, and
    /// downgraded to weak once the socket is closed/inactive so GC can reclaim it.
    pub this_value: JsCell<JsRef>,
    pub poll_ref: JsCell<KeepAlive>,
    pub(crate) ref_pollref_on_connect: Cell<bool>,
    /// What `timeout(seconds)` last asked for, or the 120 s of an accepted socket. uSockets keeps only when it's due.
    pub(crate) timeout_seconds: Cell<c_uint>,
    pub(crate) connection: JsCell<Option<super::listener::UnixOrHost>>,
    /// `localAddress`/`localPort` from the connect options: the socket is
    /// bound to this address before connecting. Always a literal IP.
    pub(crate) local_binding: JsCell<Option<(Box<[u8]>, u16)>>,
    pub(crate) protos: JsCell<Option<Box<[u8]>>>,
    pub(crate) server_name: JsCell<Option<Box<[u8]>>>,
    pub(crate) buffered_data_for_node_net: JsCell<PendingWrites>,
    pub(crate) bytes_written: Cell<u64>,
    /// Bytes `on_data` received. A TLS socket counts plaintext.
    pub(crate) bytes_read: Cell<u64>,

    pub(crate) native_callback: JsCell<NativeCallbacks>,
    /// `upgradeTLS` produces two `TLSSocket` wrappers over one
    /// `us_socket_t` (the encrypted view + the raw-bytes view node:net
    /// expects at index 0). The encrypted half holds a ref on the raw half
    /// here so a single `onClose` can retire both — no `Handlers.clone()`,
    /// no second context.
    pub(crate) twin: JsCell<Option<RefPtr<Self>>>,
    /// Owned copy of the handshake verify error, so `getAuthorizationError()`
    /// keeps its verdict after detach (the live error borrows the `SSL`, and
    /// EPROTO reasons are stack-copied in uSockets).
    pub(crate) verify_error: JsCell<Option<StoredVerifyError>>,
}

/// Associated `Socket` handler type.
pub(super) type SocketHandler<const SSL: bool> = uws::NewSocketHandler<SSL>;

impl<const SSL: bool> Drop for NewSocket<SSL> {
    fn drop(&mut self) {
        self.mark_inactive();
        self.detach_native_callback();
        self.poll_ref.with_mut(|p| {
            p.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
    }
}

/// Settles `IS_ACTIVE` against the `Handlers` the close callback entered with —
/// it may have synchronously reconnected onto a fresh set — then consumes the
/// +1 the caller transferred into `on_close`.
struct CloseTeardown<const SSL: bool> {
    socket: bun_ptr::ThisPtr<NewSocket<SSL>>,
    entered: Rc<Handlers>,
}

impl<const SSL: bool> Drop for CloseTeardown<SSL> {
    fn drop(&mut self) {
        let this = self.socket;
        if this.handlers_are(&self.entered) {
            this.mark_inactive();
        } else if this.flags.get().contains(Flags::IS_ACTIVE) {
            // Reconnected: `connect_finish` re-armed `this_value`/`poll_ref`, so
            // skip the idle teardown and only release what we took.
            this.update_flags(|f| f.remove(Flags::IS_ACTIVE));
            self.entered.mark_inactive();
        }
        // Last: this can be the final ref, freeing the socket read above.
        this.get().deref();
    }
}

/// The extra `SystemError` ref taken for the promise. `to_error_instance*`
/// consumes one ref of every string, so the promise needs its own copy; this
/// releases that copy on the paths that never build an error out of it.
struct PendingSystemError(Option<jsc::SystemError>);

impl PendingSystemError {
    fn take(&mut self) -> jsc::SystemError {
        self.0.take().expect("PendingSystemError consumed twice")
    }
}

/// `needs_deref` releases the ref the now-detached native socket held. The idle
/// teardown is gated on the socket still holding the `Handlers` we entered with:
/// `onConnectError` can reconnect, and we must not tear that connection down.
/// The ref `connect_finish` took for the native socket.
#[derive(Clone, Copy, PartialEq, Eq)]
enum NativeSocketRef {
    Held,
    Released,
}

struct ConnectErrorTeardown<const SSL: bool> {
    socket: bun_ptr::ThisPtr<NewSocket<SSL>>,
    entered: Rc<Handlers>,
    needs_deref: bool,
}

impl<const SSL: bool> Drop for ConnectErrorTeardown<SSL> {
    fn drop(&mut self) {
        let this = self.socket;
        // `deref` before `mark_inactive`, as the hand-rolled guard did. It
        // cannot free the socket here: `connect_failed`'s `_guard`
        // is declared before this guard, so it outlives it.
        if self.needs_deref {
            this.get().deref();
        }
        if this.handlers_are(&self.entered) {
            this.mark_inactive();
        }
    }
}

/// Balances a [`Handlers::enter`] on every exit path, including `?` returns.
/// Bind it to a named local — `let _ = ...` drops at the end of the statement,
/// running the exit before the user's callback.
struct ScopeExit<const SSL: bool> {
    socket: bun_ptr::ThisPtr<NewSocket<SSL>>,
    scope: Option<super::handlers::Scope>,
}

impl<const SSL: bool> Drop for ScopeExit<SSL> {
    fn drop(&mut self) {
        if let Some(scope) = self.scope.take() {
            self.socket.exit_scope(scope);
        }
    }
}

impl<const SSL: bool> NewSocket<SSL> {
    /// Hold a ref on `self` for the guard's lifetime (across re-entrant calls).
    #[inline]
    fn ref_guard(&self) -> RefPtr<Self> {
        // SAFETY: `self` is the live heap allocation.
        unsafe { RefPtr::init_ref(self.as_ctx_ptr()) }
    }

    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    pub(crate) fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// `self`'s address as `*mut Self` for uSockets ext slots / refcount FFI.
    /// All mutated fields are `UnsafeCell`-backed, so the `*mut` spelling is
    /// purely to match C signatures; callbacks deref it as `&*const` (shared).
    #[inline]
    pub(crate) fn as_ctx_ptr(&self) -> *mut Self {
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    // ─────────────────────────────────────────────────────────────────────────

    // Intrusive refcount API.
    pub(crate) fn ref_(&self) {
        // SAFETY: `self` is live; `RefCount::ref_` only reads/writes the
        // embedded `ref_count` Cell (interior-mutable), so `&self`→`*mut`
        // is sound for that access.
        unsafe { bun_ptr::RefCount::<Self>::ref_(self.as_ctx_ptr()) };
    }
    // R-2: takes `&self` — every mutated field is `UnsafeCell`-backed, so the
    // `*mut Self` formed for `RefCount::deref` (and `Drop`) writes only
    // through interior-mutable storage.
    pub(crate) fn deref(&self) {
        // SAFETY: `self` is live; if count hits 0, `RefCounted::destructor`
        // (→ `Drop`) runs and `self` is not used after.
        unsafe { bun_ptr::RefCount::<Self>::deref(self.as_ctx_ptr()) };
    }

    // ── codegen accessors ──
    // These hand-roll the `if (ssl) js_TLSSocket else js_TCPSocket`
    // split and route through the codegen'd safe wrappers.
    pub(crate) fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        jsc::mark_binding!();
        // `self` is a heap-allocated `NewSocket` (every caller goes through
        // `NewSocket::new` → `heap::alloc`); ownership is adopted by the C++
        // JSCell wrapper, which calls `finalize` on GC. The codegen wrappers are
        // monomorphic in `TCPSocket`/`TLSSocket`, so cast through the concrete
        // alias each branch is typed against.
        let ptr = self.as_ctx_ptr();
        let value = if SSL {
            js_TLSSocket::to_js(ptr.cast(), global)
        } else {
            js_TCPSocket::to_js(ptr.cast(), global)
        };
        debug_assert!(
            Some(ptr.cast::<c_void>())
                == if SSL {
                    js_TLSSocket::from_js(value).map(|p| p.as_ptr().cast())
                } else {
                    js_TCPSocket::from_js(value).map(|p| p.as_ptr().cast())
                },
            "JS{{TCP,TLS}}Socket.toJS: C ABI round-trip mismatch",
        );
        value
    }
    pub(crate) fn data_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        jsc::mark_binding!();
        if SSL {
            js_TLSSocket::data_set_cached(this, global, value);
        } else {
            js_TCPSocket::data_set_cached(this, global, value);
        }
    }
    pub(crate) fn data_get_cached(this: JSValue) -> Option<JSValue> {
        jsc::mark_binding!();
        if SSL {
            js_TLSSocket::data_get_cached(this)
        } else {
            js_TCPSocket::data_get_cached(this)
        }
    }
    pub(crate) fn handlers_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        jsc::mark_binding!();
        if SSL {
            js_TLSSocket::handlers_set_cached(this, global, value);
        } else {
            js_TCPSocket::handlers_set_cached(this, global, value);
        }
    }

    /// Heap-allocates a detached socket; ownership passes to the intrusive refcount.
    /// The returned handle is live by construction.
    pub(crate) fn new(handlers: Option<Rc<Handlers>>) -> bun_ptr::ThisPtr<Self> {
        let init = Self {
            socket: Cell::new(SocketHandler::<SSL>::DETACHED),
            closing: Cell::new(SocketHandler::<SSL>::DETACHED),
            flags: Cell::new(Flags::empty()),
            ref_count: bun_ptr::RefCount::init(),
            handlers: JsCell::new(handlers),
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            timeout_seconds: Cell::new(0),
            connection: JsCell::new(None),
            local_binding: JsCell::new(None),
            protos: JsCell::new(None),
            server_name: JsCell::new(None),
            buffered_data_for_node_net: Default::default(),
            bytes_written: Cell::new(0),
            bytes_read: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
            verify_error: JsCell::new(None),
        };
        // SAFETY: freshly allocated, non-null.
        unsafe { bun_ptr::ThisPtr::new(bun_core::heap::into_raw(Box::new(init))) }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        // Per-socket SSL state (SSL*, BIO pair, handshake buffers) is ~40 KB
        // off-heap. Reporting it lets the GC apply pressure when JS churns
        // through short-lived TLS connections. The raw `[raw, tls]` upgrade
        // twin shares the same SSL* — only the encrypted half reports it.
        let ssl_cost: usize = if SSL && !self.flags.get().contains(Flags::BYPASS_TLS) {
            40 * 1024
        } else {
            0
        };
        self.buffered_data_for_node_net.get().capacity() as usize + ssl_cost
    }

    /// On `false` the rejected `callback` (and the ref it holds) is dropped.
    pub(crate) fn attach_native_callback(&self, callback: NativeCallbacks) -> bool {
        if !matches!(self.native_callback.get(), NativeCallbacks::None) {
            return false;
        }
        self.native_callback.set(callback);
        true
    }

    pub(crate) fn detach_native_callback(&self) {
        if let NativeCallbacks::H2(h2) = self.native_callback.replace(NativeCallbacks::None) {
            h2.on_native_close();
        }
    }

    /// Connects to `self.connection`. `Err` is why that failed, and the inner result is what an `on_open` that ran in here left pending. What outlives the call (a connecting socket, an `SSL`, a pipe's TLS engine) takes its own reference on `ssl_ctx`.
    pub(crate) fn do_connect(
        &self,
        cx: &bun_jsc::JsThread<'_>,
        ssl_ctx: Option<boringssl_sys::OwnedSslCtx>,
    ) -> Result<JsResult<()>, sys::SystemErrno> {
        // Keep `self` alive across the re-entrant connect path.
        // SAFETY: `self` is live for this call and outlives the sockets below.
        let this = unsafe { bun_ptr::ThisPtr::new(self.as_ctx_ptr()) };
        let _guard = RefPtr::from_this(this);
        let connection = self.connection.get().as_ref();
        let connection = connection.expect("do_connect requires self.connection to be set");

        #[cfg(windows)]
        if !self.flags.get().contains(Flags::WRITE_ONLY_FD) {
            use super::listener::NamedPipe;
            use super::windows_named_pipe::{SocketType, WindowsNamedPipe};
            let mut buf = bun_paths::path_buffer_pool::get();
            let socket = SocketType::of(this);
            match super::listener::named_pipe(connection, buf.as_mut_slice()) {
                Some(NamedPipe::Path(name)) => {
                    return WindowsNamedPipe::from_path(cx, name, ssl_ctx, socket).map(Ok);
                }
                Some(NamedPipe::Fd(fd)) => {
                    return WindowsNamedPipe::from_fd(cx, fd, ssl_ctx, socket).map(Ok);
                }
                None => {}
            }
        }
        let last_errno = || sys::SystemErrno::from_raw(sys::last_error() as u16);

        // `VirtualMachine::get()` yields the canonical `*mut` (write
        // provenance) — never derive `&mut` from the `&'static` borrow stored
        // on Handlers (that's `invalid_reference_casting`).
        let vm = VirtualMachine::get().as_mut();
        let loop_ = vm.uws_loop();
        let group = vm
            .client_socket_groups_in(cx.context())
            .bun_connect_group::<SSL>(loop_);
        let kind: uws::SocketKind = if SSL {
            uws::SocketKind::BunSocketTls
        } else {
            uws::SocketKind::BunSocketTcp
        };
        // The loop never closes on a FIN. `on_end` applies `Flags::ENDS_ON_PEER_FIN`.
        let flags: i32 = uws::LIBUS_SOCKET_ALLOW_HALF_OPEN;
        let owned_ssl_ctx = ssl_ctx.filter(|_| SSL);
        let ssl_ctx: Option<*mut uws::SslCtx> = owned_ssl_ctx
            .as_ref()
            .map(|p| p.as_ptr().cast::<uws::SslCtx>());

        use super::listener::UnixOrHost;
        match connection {
            UnixOrHost::Host { host, port } => {
                // getaddrinfo doesn't accept bracketed IPv6.
                let hostz =
                    bun_core::ZBox::from_bytes(bun_core::ip_address::strip_ipv6_brackets(host));
                let port = *port;
                // `host` borrow ends here; `self.connection` no longer borrowed.
                // `ZBox` guarantees a trailing NUL; host bytes contain no interior NUL.
                let host_c = hostz.as_zstr().as_cstr();

                // Bind to the requested local address before connecting, if any.
                let local = self.local_binding.get();
                let local_z = local
                    .as_ref()
                    .map(|(h, p)| (bun_core::ZBox::from_bytes(h), *p));
                self.socket.set(
                    match group.connect(
                        kind,
                        ssl_ctx,
                        host_c,
                        c_int::from(port),
                        local_z.as_ref().map(|(z, p)| (z.as_zstr().as_cstr(), *p)),
                        flags,
                        core::mem::size_of::<*mut c_void>() as c_int,
                    ) {
                        uws::ConnectResult::Failed => return Err(last_errno()),
                        uws::ConnectResult::Socket(s) => {
                            *uws::us_socket_t::opaque_mut(s).ext() = Some(this);
                            SocketHandler::<SSL>::from(s)
                        }
                        uws::ConnectResult::Connecting(c) => {
                            *uws::ConnectingSocket::opaque_mut(c).ext() = Some(this);
                            SocketHandler::<SSL>::from_connecting(c)
                        }
                    },
                );
            }
            UnixOrHost::Unix(u) => {
                let s = group.connect_unix(
                    kind,
                    ssl_ctx,
                    u,
                    flags,
                    core::mem::size_of::<*mut c_void>() as c_int,
                );
                if s.is_null() {
                    return Err(last_errno());
                }
                *uws::us_socket_t::opaque_mut(s).ext() = Some(this);
                self.socket.set(SocketHandler::<SSL>::from(s));
            }
            UnixOrHost::Fd(f) if !SSL && self.flags.get().contains(Flags::WRITE_ONLY_FD) => {
                // SAFETY: `!SSL`, so `Self` is `TCPSocket`.
                let tcp = unsafe { bun_ptr::ThisPtr::new(self.as_ctx_ptr().cast::<TCPSocket>()) };
                return super::fd_pipe::FdPipe::open(tcp, *f, cx.context());
            }
            UnixOrHost::Fd(f) => {
                // The fd is connected, so it is registered paused outright; a dial is paused in on_open.
                let flags = if self.flags.get().contains(Flags::PAUSE_ON_CONNECT) {
                    flags | uws::LIBUS_SOCKET_OPEN_PAUSED
                } else {
                    flags
                };
                // `LIBUS_SOCKET_DESCRIPTOR` is `c_int` on POSIX, `SOCKET`
                // (`usize`) on Windows; `Fd::native()` is `c_int` / HANDLE
                // (`*mut c_void`) respectively; cast to bridge the Rust-side `usize` alias.
                let s = group.from_fd(
                    kind,
                    ssl_ctx,
                    core::mem::size_of::<*mut c_void>() as c_int,
                    f.native() as uws::LIBUS_SOCKET_DESCRIPTOR,
                    flags,
                    false,
                );
                if s.is_null() {
                    return Err(last_errno());
                }
                *uws::us_socket_t::opaque_mut(s).ext() = Some(this);
                let sock = SocketHandler::<SSL>::from(s);
                self.socket.set(sock);
                return Ok(Self::on_open(this, sock));
            }
        }
        Ok(Ok(()))
    }

    pub(crate) fn resume(&self, _: &mut JsScope<'_>) {
        if self.socket.get().is_detached() {
            return;
        }
        log!("resume");
        // The raw half of an upgradeTLS pair is an observation tap; flow
        // control belongs to the TLS half. Pausing the shared fd here would
        // wedge the TLS read path (#15438).
        if self.flags.get().contains(Flags::BYPASS_TLS) {
            return;
        }
        if self.flags.get().contains(Flags::IS_PAUSED) {
            let resumed = self.socket.get().resume_stream();
            self.update_flags(|f| f.set(Flags::IS_PAUSED, !resumed));
        }
    }

    pub(crate) fn pause(&self, _: &mut JsScope<'_>) {
        if self.socket.get().is_detached() {
            return;
        }
        log!("pause");
        if self.flags.get().contains(Flags::BYPASS_TLS) {
            return;
        }
        self.pause_reads();
    }

    fn pause_reads(&self) {
        if !self.flags.get().contains(Flags::IS_PAUSED) {
            let paused = self.socket.get().pause_stream();
            self.update_flags(|f| f.set(Flags::IS_PAUSED, paused));
            self.fail_write_of_stopped_reader();
        }
    }

    /// Consumes `PAUSE_ON_CONNECT`: a TLS client dispatches another handshake after a renegotiation.
    fn pause_on_connect_once(&self) {
        if self.flags.get().contains(Flags::PAUSE_ON_CONNECT) {
            self.update_flags(|f| f.remove(Flags::PAUSE_ON_CONNECT));
            self.pause_reads();
        }
    }

    pub(crate) fn set_keep_alive(
        &self,
        cx: &mut JsScope<'_>,
        enable: bool,
        initial_delay: JsLocal<'_>,
    ) -> JsResult<bool> {
        let global = cx.global();

        // `initialDelay` is documented in milliseconds; TCP_KEEPIDLE is seconds.
        let initial_delay_ms = u32::try_from(global.validate_integer_range(
            initial_delay.to_js(),
            0i32,
            bun_sql_jsc::jsc::IntegerRange {
                min: 0,
                field_name: b"initialDelay",
                ..Default::default()
            },
        )?)
        .unwrap();
        let initial_delay = initial_delay_ms / 1000;
        log!("setKeepAlive({}, {})", enable, initial_delay);

        Ok(self.socket.get().set_keep_alive(enable, initial_delay))
    }

    pub(crate) fn set_no_delay(&self, no_delay: &[JsLocal<'_>]) -> bool {
        let enabled = no_delay
            .first()
            .is_none_or(|enabled| enabled.to_js().to_boolean());
        log!("setNoDelay({})", enabled);

        if enabled && self.flags.get().contains(Flags::NO_DELAY) && !self.socket.get().is_closed() {
            return true;
        }
        let set = self.socket.get().set_no_delay(enabled);
        if set {
            self.update_flags(|f| f.set(Flags::NO_DELAY, enabled));
        }
        set
    }

    /// `_handle.setTypeOfService(tos)` - returns 0 on success or a negative
    /// platform errno (Node's TCPWrap::SetTypeOfService convention, so the JS
    /// layer can hand it to ErrnoException).
    pub(crate) fn set_type_of_service(
        &self,
        cx: &mut JsScope<'_>,
        tos: JsLocal<'_>,
    ) -> JsResult<i32> {
        let global = cx.global();
        let arg = tos.to_js();
        // node:net rejects NaN with ERR_INVALID_ARG_TYPE, but `validate_integer_range` maps it to the default.
        if arg.is_number() && arg.as_number().is_nan() {
            return Err(global.throw_invalid_property_type_value(b"tos", b"integer", arg));
        }
        let tos: i32 = global.validate_integer_range(
            arg,
            0i32,
            bun_sql_jsc::jsc::IntegerRange {
                min: 0,
                max: 255,
                field_name: b"tos",
                ..Default::default()
            },
        )?;
        log!("setTypeOfService({})", tos);
        Ok(self.socket.get().set_tos(tos))
    }

    /// `_handle.getTypeOfService()` - returns the value (>= 0) or a negative
    /// platform errno.
    pub(crate) fn get_type_of_service(&self) -> i32 {
        log!("getTypeOfService()");
        self.socket.get().get_tos()
    }

    pub(crate) fn handle_error(&self, err_value: JSValue) -> JsResult<()> {
        log!("handleError");
        let handlers = self.get_handlers();
        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = handlers.enter();
        let global = handlers.global_object;
        let this_value = self.get_this_value(&global);
        let called = handlers.call_error_handler(this_value, &[this_value, err_value]);
        self.exit_scope(scope);
        called
    }

    /// Calls `writeComplete(socket, status)`. What it throws is an uncaught exception, as in Node.
    fn call_write_complete(handlers: &Handlers, this_value: JSValue, status: c_int) {
        let callback = handlers.on_write_complete();
        if callback.is_empty() {
            return;
        }
        let global = handlers.global_object;
        global.bun_vm().event_loop_mut().run_callback(
            handlers.context(),
            callback,
            &global,
            this_value,
            &[this_value, JSValue::js_number_from_int32(status)],
        );
    }

    /// Completes a write from the event loop, like libuv, not inside the call that closed the handle or stopped its reads.
    fn complete_write_later(&self, handlers: &Rc<Handlers>, status: Option<c_int>) {
        if self.flags.get().contains(Flags::FINALIZING) {
            return;
        }
        let global = handlers.global_object;
        let this_value = self.get_this_value(&global);
        if this_value.is_undefined() {
            return;
        }
        let task = Box::new(DeferredWriteCompletion::<SSL> {
            socket: self.ref_guard(),
            this_value: jsc::Strong::create(this_value, &global),
            handlers: Rc::clone(handlers),
            status,
        });
        handlers
            .vm
            .event_loop_mut()
            .enqueue_task(jsc::Task::init(bun_core::heap::into_raw(task)));
    }

    /// A send failed for good. The transport reads on and closes by itself, and the write ends with that close.
    fn fail_queued_writes(
        &self,
        send_error: c_int,
        record: fn(&mut PendingWrites, sys::SystemErrno),
    ) {
        // The TLS layer has done this itself if a send is what failed.
        if !SSL {
            self.socket.get().reject_send(send_error);
        }
        self.buffered_data_for_node_net
            .with_mut(|b| record(b, send_errno(send_error)));
        self.fail_write_of_stopped_reader();
    }

    /// The transport stays open for a reader. A socket that doesn't read closes a turn later.
    fn fail_write_of_stopped_reader(&self) {
        if self.lost_write_of_stopped_reader()
            && let Some(handlers) = self.handlers.get()
        {
            self.complete_write_later(handlers, None);
        }
    }

    fn lost_write_of_stopped_reader(&self) -> bool {
        self.flags.get().contains(Flags::IS_PAUSED)
            && self.buffered_data_for_node_net.get().is_lost()
    }

    /// Takes `ThisPtr<Self>`, not `&mut self`: `callback.call(...)` re-enters
    /// JS which can call `socket.write()`/`end()`/`reload()` on this same
    /// wrapper via the JS object's `m_ptr`, re-deriving a borrow and mutating
    /// `flags`/`handlers`/`ref_count`/`buffered_data_for_node_net`. A live
    /// `&mut self` across that call is aliasing UB and lets LLVM cache those
    /// fields and dead-store the re-entrant write. `ThisPtr` derefs yield a
    /// short-lived shared borrow per access; none span `callback.call`.
    pub(crate) fn on_writable(
        this: bun_ptr::ThisPtr<Self>,
        _socket: SocketHandler<SSL>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.dispatch_handlers() else {
            return Ok(());
        };
        if this.native_callback.get().on_writable() {
            return Ok(());
        }
        // The TLS layer couldn't send records it still held.
        let send_error = this.socket.get().rejected_send_error();
        if send_error != 0 {
            if this.buffered_data_for_node_net.get().is_pending() {
                this.fail_queued_writes(send_error, PendingWrites::fail_held_records);
            }
            return Ok(());
        }
        let callback = handlers.on_writable();
        let queue = this.buffered_data_for_node_net.get();
        if callback.is_empty()
            && queue.len() == 0
            && queue.completion() == Completion::None
            && !this.flags.get().contains(Flags::END_AFTER_FLUSH)
        {
            return Ok(());
        }

        // Hold the socket alive for the rest of the dispatch: `internal_flush`
        // and the drain callback can both re-enter JS and close it.
        let _guard = RefPtr::from_this(this);
        if !this.internal_flush() || this.socket.get().is_detached() {
            return Ok(());
        }
        let queue = this.buffered_data_for_node_net.get();
        if queue.len() > 0 {
            return Ok(());
        }
        let global = handlers.global_object;
        if queue.completion() == Completion::Owed {
            if !this.holds_unsent_tls_records() {
                this.buffered_data_for_node_net.with_mut(|b| b.take());
                Self::call_write_complete(&handlers, this.get_this_value(&global), 0);
            }
            return Ok(());
        }
        if callback.is_empty() {
            return Ok(());
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            handlers.call_error_handler(this_value, &[this_value, global.take_error(err)])?;
        }
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_timeout(
        this: bun_ptr::ThisPtr<Self>,
        _socket: SocketHandler<SSL>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.dispatch_handlers() else {
            return Ok(());
        };
        log!(
            "onTimeout {}",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            }
        );
        let callback = handlers.on_timeout();
        if this.flags.get().contains(Flags::FINALIZING) {
            return Ok(());
        }
        let _guard = RefPtr::from_this(this);
        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        // The peer took nothing of `end(data)`'s tail for the whole timeout.
        let tail_timed_out = this.waits_to_send_tail();
        let mut handled = Ok(());
        if !callback.is_empty() {
            let global = handlers.global_object;
            let this_value = this.get_this_value(&global);
            if let Err(err) = callback.call(&global, this_value, &[this_value]) {
                handled =
                    handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
            }
        }
        if this.waits_to_send_tail() {
            // `end(data)` in the handler is how a program drops a peer that stopped reading, so its tail doesn't wait another timeout.
            this.buffered_data_for_node_net.with_mut(|b| {
                if tail_timed_out {
                    b.fail(sys::SystemErrno::ETIMEDOUT);
                } else {
                    b.clear();
                }
            });
            this.close_if_flushed();
        }
        handled
    }

    fn waits_to_send_tail(&self) -> bool {
        self.flags.get().contains(Flags::END_AFTER_FLUSH)
            && self.buffered_data_for_node_net.get().len() > 0
            && !self.socket.get().is_detached()
    }

    /// Closes an ended socket once its tail is sent. Until then the socket's own timeout runs, from each send that moved bytes.
    fn close_if_flushed(&self) {
        if self.can_end_after_flush() {
            self.mark_inactive();
        } else {
            self.arm_tail_timeout();
        }
    }

    fn arm_tail_timeout(&self) {
        if self.timeout_seconds.get() > 0 && self.waits_to_send_tail() {
            self.socket.get().set_timeout(self.timeout_seconds.get());
        }
    }

    /// The callbacks an event goes to. `None` for a late event: the socket is detached, or a JS-side destroy released them (TLS over a Duplex).
    fn dispatch_handlers(&self) -> Option<Rc<Handlers>> {
        if self.socket.get().is_detached() {
            return None;
        }
        self.handlers_opt()
    }

    /// This socket's callbacks. Panics if it has none — every dispatch entry
    /// point checks [`has_handlers`](Self::has_handlers) first.
    ///
    /// Returns a fresh `Rc`, so JS re-entrancy from the caller (a `close`
    /// handler that reconnects, an `upgradeTLS` that transfers the handlers to
    /// a twin) cannot free the callbacks the caller is still reading.
    pub(crate) fn get_handlers(&self) -> Rc<Handlers> {
        self.handlers_opt().expect("No handlers set on Socket")
    }

    #[inline]
    pub(crate) fn handlers_opt(&self) -> Option<Rc<Handlers>> {
        self.handlers.get().clone()
    }

    #[inline]
    pub(crate) fn has_handlers(&self) -> bool {
        self.handlers.get().is_some()
    }

    /// True when this socket still points at `handlers` — false once a
    /// re-entrant reconnect or `upgradeTLS` repointed it.
    #[inline]
    fn handlers_are(&self, handlers: &Rc<Handlers>) -> bool {
        matches!(self.handlers.get(), Some(h) if Rc::ptr_eq(h, handlers))
    }

    #[inline]
    fn take_handlers(&self) -> Option<Rc<Handlers>> {
        self.handlers.with_mut(|h| h.take())
    }

    /// The event-loop exit drains microtasks, during which a synchronous
    /// reconnect may repoint `self.handlers` at a fresh `Handlers` — only
    /// release the socket's own reference when it still holds the one we
    /// entered with, which the `Scope` itself carries.
    #[inline]
    fn exit_scope(&self, scope: super::handlers::Scope) {
        let entered = Rc::clone(&scope.handlers);
        scope.exit_event_loop();
        if scope.mark_inactive() && self.handlers_are(&entered) {
            self.handlers.set(None);
        }
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`:
    /// `callback.call`/`reject` re-enter JS which can `connectInner()`/mutate
    /// this socket via `m_ptr` (node:net `autoSelectFamily` retries inside the
    /// `connectError` callback).
    ///
    /// `Err` is what the `connectError`/`error` handler or a promise
    /// rejection left pending; the socket is released either way (guards).
    pub(crate) fn handle_connect_error(
        this: bun_ptr::ThisPtr<Self>,
        errno: sys::SystemErrno,
    ) -> JsResult<()> {
        let native_ref = if this.socket.get().is_detached() {
            NativeSocketRef::Released
        } else {
            NativeSocketRef::Held
        };
        Self::connect_failed(this, errno, 0, native_ref)
    }

    /// `dns_error` is `getaddrinfo(3)`'s return code when the name lookup failed, and `errno` means nothing then.
    fn connect_failed(
        this: bun_ptr::ThisPtr<Self>,
        errno: sys::SystemErrno,
        dns_error: i32,
        native_ref: NativeSocketRef,
    ) -> JsResult<()> {
        let handlers = this.get_handlers();
        log!(
            "onConnectError {} ({}, {})",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            },
            errno,
            this.ref_count.get()
        );
        // Ensure the socket is still alive for any defer's we have. Declared
        // before discard_queued_writes/unrefOnNextTick so the ref is balanced even if
        // those calls unwind.
        let _guard = RefPtr::from_this(this);
        this.discard_queued_writes();

        this.socket.set(SocketHandler::<SSL>::DETACHED);

        let vm = handlers.vm;
        this.poll_ref
            .with_mut(|p| p.unref_on_next_tick(js_loop_ctx()));

        // The deferred `mark_inactive()` is gated on the `Handlers` captured
        // before the user callback runs: `onConnectError` can synchronously
        // re-enter `connect()` and — via `do_connect()`'s `UnixOrHost::Fd`
        // branch — reach `on_open()`/`mark_active()` for a *fresh* `Handlers`
        // before this guard drops. Without the gate the deferred
        // `mark_inactive()` would tear down that newly activated connection.
        // When no reconnect happened the socket never opened, so `IS_ACTIVE`
        // is unset and the call is a no-op either way.
        let cleanup = ConnectErrorTeardown {
            socket: this,
            entered: Rc::clone(&handlers),
            needs_deref: native_ref == NativeSocketRef::Held,
        };

        if vm.script_execution_status() != jsc::ScriptExecutionStatus::Running
            || this.flags.get().contains(Flags::FINALIZING)
        {
            drop(cleanup);
            return Ok(());
        }

        let callback = handlers.on_connect_error();
        let global = handlers.global_object;
        // A failed name lookup is reported as the resolver error
        // (`getaddrinfo ENOTFOUND <hostname>`, `syscall`/`hostname` set),
        // matching `node:dns`.
        let dns_err = c_ares::Error::init_eai(dns_error).filter(|_| dns_error != 0);
        let err = if let Some(dns_err) = dns_err {
            let hostname: &[u8] = match this.connection.get() {
                Some(super::listener::UnixOrHost::Host { host, .. }) => host,
                _ => b"",
            };
            crate::dns_jsc::cares_jsc::system_error_with_syscall_and_hostname(
                dns_err,
                b"getaddrinfo",
                hostname,
            )
        } else {
            let mut err = SystemError::from(
                sys::Error::new(errno, sys::Tag::connect).to_shell_system_error(),
            );
            err.message = BunString::static_("Failed to connect");
            err
        };

        let _scope_guard = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        if callback.is_empty() {
            // Connection failed before open; allow the wrapper to be GC'd
            // regardless of whether this path is promise-backed (e.g. the
            // duplex TLS upgrade flow has no connect promise).
            if !matches!(this.this_value.get(), JsRef::Finalized) {
                this.this_value.with_mut(|r| r.downgrade());
            }
            if let Some(promise) = handlers.take_promise() {
                // reject the promise on connect() error
                let js_promise = jsc::JSPromise::opaque_mut(promise.as_promise().unwrap());
                let err_value = err.to_error_instance_with_async_stack(&global, js_promise);
                js_promise.reject(&global, Ok(err_value))?;
            }

            return Ok(());
        }

        let this_value = this.get_this_value(&global);
        this_value.ensure_still_alive();
        // Connection failed before open; allow the wrapper to be GC'd once this
        // callback returns. The on-stack `this_value` keeps it alive for the call.
        this.this_value.with_mut(|r| r.downgrade());

        let mut err_for_promise = PendingSystemError(Some(err.clone()));
        let err_value = err.to_error_instance(&global);
        // What the handler throws is treated as the error it reports (below);
        // what it leaves pending beyond that (a termination) is the `Err`.
        let result = match callback.call(&global, this_value, &[this_value, err_value]) {
            Ok(v) => v,
            Err(e) => global.take_exception(e),
        };
        if global.has_exception() {
            return Err(jsc::JsError::Thrown);
        }

        if let Some(err_val) = result.to_error() {
            match handlers.reject_promise(err_val)? {
                true => return Ok(()),
                false => {
                    handlers.call_error_handler(this_value, &[this_value, err_val])?;
                }
            }
        } else if let Some(val) = handlers.take_promise() {
            // They've defined a `connectError` callback
            // The error is effectively handled, but we should still reject the promise.
            let promise = jsc::JSPromise::opaque_mut(JSValue::as_promise(val).unwrap());
            let err_ = err_for_promise
                .take()
                .to_error_instance_with_async_stack(&global, promise);
            promise.reject_as_handled(&global, err_)?;
        }

        // `_scope_guard` (declared after `cleanup`) drops first → scope.exit();
        // then `cleanup` → needs_deref/mark_inactive/deref.
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as
    /// `handle_connect_error`.
    pub(crate) fn on_connect_error(
        this: bun_ptr::ThisPtr<Self>,
        socket: SocketHandler<SSL>,
        errno: c_int,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let errno = uws::SocketGroup::errno(errno).unwrap_or(sys::SystemErrno::ECONNREFUSED);
        Self::connect_failed(this, errno, socket.dns_error(), NativeSocketRef::Held)
    }

    pub(crate) fn mark_active(&self) {
        if !self.flags.get().contains(Flags::IS_ACTIVE) {
            let handlers = self.get_handlers();
            handlers.mark_active();
            self.update_flags(|f| f.insert(Flags::IS_ACTIVE));
            // Keep the JS wrapper alive while the socket is active.
            // `getThisValue` may not have been called yet (e.g. server-side
            // sockets without default data), in which case the ref is still
            // empty and there's nothing to upgrade.
            if self.this_value.get().is_not_empty() {
                self.this_value
                    .with_mut(|r| r.upgrade(&handlers.global_object));
            }
        }
    }

    /// Runs `send` over the queued bytes. It can run JS that closes the socket (a TLS callback, a Duplex transport), and `on_close` must not free them under it.
    fn send_queued<R>(&self, send: impl FnOnce(&[u8]) -> R) -> R {
        let nested = self.flags.get().contains(Flags::SENDING_QUEUE);
        self.update_flags(|f| f.insert(Flags::SENDING_QUEUE));
        let result = send(self.buffered_data_for_node_net.get().slice());
        self.update_flags(|f| f.set(Flags::SENDING_QUEUE, nested));
        result
    }

    /// Frees the bytes the socket will never take. node:net hears how its write ended. For anyone else, `close(socket, error)` reports a failure.
    fn discard_queued_writes(&self) {
        if self.flags.get().contains(Flags::SENDING_QUEUE) {
            return;
        }
        self.buffered_data_for_node_net.with_mut(|b| b.clear());
        let status = match self.buffered_data_for_node_net.get().completion() {
            Completion::None => return,
            Completion::Owed | Completion::Reset => sys::SystemErrno::ECANCELED,
            Completion::Failed(errno) => errno,
        };
        if let Some(handlers) = self.handlers.get()
            && !handlers.on_write_complete().is_empty()
        {
            self.buffered_data_for_node_net.with_mut(|b| b.take());
            self.complete_write_later(handlers, Some(uv_status(status)));
        }
    }

    /// Takes the error of the bytes that were lost, if any. `send_error` is the one uSockets closed the socket for.
    fn take_failed_write(&self, send_error: c_int) -> Option<sys::SystemErrno> {
        if self.flags.get().contains(Flags::SENDING_QUEUE) {
            return None;
        }
        if send_error != 0 && self.buffered_data_for_node_net.get().is_pending() {
            self.buffered_data_for_node_net
                .with_mut(|b| b.fail_held_records(send_errno(send_error)));
        }
        let Completion::Failed(errno) = self.buffered_data_for_node_net.get().completion() else {
            return None;
        };
        self.buffered_data_for_node_net.with_mut(|b| b.take());
        Some(errno)
    }

    pub(crate) fn close_and_detach(&self, code: uws::CloseCode) {
        let socket = self.socket.get();
        self.discard_queued_writes();

        self.socket.set(SocketHandler::<SSL>::DETACHED);
        self.detach_native_callback();

        socket.close(code);
        self.keep_if_still_closing(socket);
    }

    /// A TLS close can wait for the peer to read or to answer. Keeps that socket for `terminate()`.
    fn keep_if_still_closing(&self, socket: SocketHandler<SSL>) {
        if SSL && matches!(socket.socket, uws::InternalSocket::Connected(_)) && !socket.is_closed()
        {
            self.closing.set(socket);
        }
    }

    /// Discard a still-live native socket so this wrapper can be reused for a
    /// fresh connect. `node:net` permits `socket.connect()` on an
    /// already-connected socket; without this the previous `us_socket_t`'s
    /// ext slot keeps pointing at `self` while `do_connect` overwrites
    /// `self.socket`, aliasing two native sockets onto one wrapper. The ext
    /// slot is nulled before closing so the synchronous `on_close` /
    /// `on_connecting_error` dispatch early-returns and no JS callback fires;
    /// `mark_inactive`/`deref` balance the refs the previous `connect_finish`
    /// took. Caller must hold an independent +1 across this call. Only
    /// handles Connected/Connecting; Pipe/UpgradedDuplex back-pointers do
    /// not live in the ext slot so those are left for the caller's existing
    /// `debug_assert!` to catch.
    pub(crate) fn detach_for_reconnect(&self) {
        let old = self.socket.get();
        let Some(ext) = old.ext::<*mut c_void>() else {
            return;
        };
        // SAFETY: ext slot is sized for `*mut c_void`; single-threaded.
        unsafe { *ext = core::ptr::null_mut() };
        self.socket.set(SocketHandler::<SSL>::DETACHED);
        self.discard_queued_writes();
        self.bytes_read.set(0);
        self.detach_native_callback();
        old.close(uws::CloseCode::Failure);
        self.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));
        if self.flags.get().contains(Flags::IS_ACTIVE) {
            self.update_flags(|f| f.remove(Flags::IS_ACTIVE));
            if let Some(h) = self.handlers_opt() {
                if h.mark_inactive() {
                    self.handlers.set(None);
                }
            }
        }
        self.deref();
    }

    pub(crate) fn mark_inactive(&self) {
        if self.flags.get().contains(Flags::IS_ACTIVE) {
            // we have to close the socket before the socket context is closed
            // otherwise we will get a segfault
            // uSockets will defer freeing the TCP socket until the next tick
            if !self.socket.get().is_closed() {
                self.close_and_detach(uws::CloseCode::Normal);
                // on_close will call mark_inactive again
                return;
            }

            self.update_flags(|f| f.remove(Flags::IS_ACTIVE));
            // Allow the JS wrapper to be GC'd now that the socket is idle.
            // Do this before touching `handlers`: for the last server-side
            // connection on a stopped listener, `mark_inactive` releases the
            // listener's own strong ref.
            if !matches!(self.this_value.get(), JsRef::Finalized) {
                self.this_value.with_mut(|r| r.downgrade());
            }
            if let Some(handlers) = self.handlers_opt() {
                if handlers.mark_inactive() {
                    // Nothing else is using these handlers. Drop this socket's
                    // reference so a later dispatch sees none rather than a
                    // callback table for a connection that is over.
                    self.handlers.set(None);
                }
            }
            self.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));
        }
    }

    pub(crate) fn is_server(&self) -> bool {
        // `handlers` is None on detached sockets and on closed client sockets.
        // JS-callable TLS accessors (`setServername`, `getPeerCertificate`,
        // `getEphemeralKeyInfo`, `setVerifyMode`) consult this on sockets
        // whose connection may already be gone.
        match self.handlers.get() {
            Some(handlers) => handlers.mode.is_server(),
            None => false,
        }
    }

    /// TLS role: `upgradeTLS({ isServer: true })` sockets act as the server
    /// even though their `Handlers` mode is `Client`.
    pub(crate) fn acts_as_tls_server(&self) -> bool {
        self.is_server() || self.flags.get().contains(Flags::TLS_SERVER_ROLE)
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`:
    /// `resolve_promise`/`callback.call` re-enter JS which can mutate this
    /// socket via `m_ptr`.
    pub(crate) fn on_open(
        this: bun_ptr::ThisPtr<Self>,
        socket: SocketHandler<SSL>,
    ) -> JsResult<()> {
        let this_ptr = this.as_ptr();
        let Some(handlers) = this.handlers_opt() else {
            return Ok(());
        };
        log!(
            "onOpen {} {:p} {} {}",
            if this.is_server() { "S" } else { "C" },
            this_ptr,
            this.socket.get().is_detached(),
            this.ref_count.get()
        );
        // Ensure the socket remains alive: the callbacks below re-enter JS.
        let _guard = RefPtr::from_this(this);

        // update the internal socket instance to the one that was just connected
        // This socket must be replaced because the previous one is a connecting socket not a uSockets socket
        this.socket.set(socket);
        // Stale if node:net reconnected through this wrapper while it was paused.
        this.update_flags(|f| f.remove(Flags::IS_PAUSED));
        if !this.ref_pollref_on_connect.replace(true) {
            this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));
        }
        if !SSL {
            this.pause_on_connect_once();
        }
        jsc::mark_binding!();

        // Add SNI support for TLS (mongodb and others requires this)
        if SSL {
            if let Some(ssl_ptr) = this.socket.get().ssl() {
                // BoringSSL's callbacks find this socket through the `SSL`, whichever engine drives it.
                tls_socket_functions::ffi::us_ssl_set_bun_socket(
                    boringssl_sys::SSL::opaque_ref(ssl_ptr),
                    this_ptr.cast::<c_void>(),
                );
                if tls_socket_functions::ffi::SSL_is_init_finished(boringssl_sys::SSL::opaque_ref(
                    ssl_ptr,
                )) == 0
                {
                    if this.acts_as_tls_server() {
                        // As in Node, a `serverName` handler (the user's SNICallback) replaces the lookup in the addContext() entries.
                        if !handlers.on_server_name().is_empty() {
                            tls_socket_functions::ffi::us_ssl_on_server_name(
                                boringssl_sys::SSL::opaque_ref(ssl_ptr),
                            );
                        }
                        // The static list is read by `us_dispatch_alpn_select`.
                        if !handlers.on_alpn_callback().is_empty() {
                            tls_socket_functions::ffi::us_ssl_on_alpn_offer(
                                boringssl_sys::SSL::opaque_ref(ssl_ptr),
                            );
                        }
                    } else {
                        // Only a client sends a server name. A server's `SSL` must keep the ClientHello's.
                        let host: &[u8] = match (this.server_name.get(), this.connection.get()) {
                            (Some(server_name), _) => server_name.as_ref(),
                            (None, Some(super::listener::UnixOrHost::Host { host, .. })) => {
                                bun_core::ip_address::strip_ipv6_brackets(host.as_ref())
                            }
                            _ => b"",
                        };
                        if !host.is_empty() {
                            let host_z = bun_core::ZBox::from_bytes(host);
                            // SAFETY: `host_z` is NUL-terminated; FFI reads until NUL.
                            unsafe {
                                boringssl_sys::SSL_set_tlsext_host_name(ssl_ptr, host_z.as_ptr())
                            };
                        }
                        // Like Node observably does, a rejecting client refuses a bad chain during the handshake (test-tls-close-error).
                        if this.flags.get().contains(Flags::REJECT_UNAUTHORIZED) {
                            this.socket.get().set_inline_reject();
                        }
                        if let Some(protos) = this.protos.get() {
                            // SAFETY: `ssl_ptr` is non-null in this branch, and BoringSSL copies the `protos.len()` readable bytes.
                            unsafe {
                                boringssl_sys::SSL_set_alpn_protos(
                                    ssl_ptr,
                                    protos.as_ptr(),
                                    protos.len(),
                                );
                            }
                        }
                    }
                }
            }
        }

        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext slot is sized for `*mut anyopaque`.
            unsafe { *ctx = this_ptr.cast::<c_void>() };
        }

        let global = handlers.global_object;
        // The socket is live whether or not script may run: give it its owner
        // (the wrapper adopts the creation reference; its finalizer releases
        // it) and account for it now, so one that opens under a stop already
        // requested is closed by the sweep and freed like any other instead of
        // keeping a reference nobody holds.
        let this_value = this.get_this_value(&global);
        this.mark_active();
        // Multiple JS entries below; a worker terminate() raised in one trips
        // assertNoException() in the next.
        if handlers.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            return Ok(());
        }
        let callback = handlers.on_open();
        let handshake_callback = handlers.on_handshake();

        handlers.resolve_promise(this_value)?;

        if SSL {
            // only calls open callback if handshake callback is provided
            // If handshake is provided, open is called on connection open
            // If is not provided, open is called after handshake
            if callback.is_empty() || handshake_callback.is_empty() {
                return Ok(());
            }
        } else {
            if callback.is_empty() {
                return Ok(());
            }
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };
        let result = match callback.call(&global, this_value, &[this_value]) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        if let Some(err) = result.to_error() {
            if !this.socket.get().is_closed() {
                log!("Closing due to error");
            } else {
                log!("Already closed");
            }

            let delivered = match handlers.reject_promise(err) {
                Ok(false) => handlers.call_error_handler(this_value, &[this_value, err]),
                rejected => rejected.map(drop),
            };
            // A socket whose `open` threw is closed whatever delivering that
            // error left pending (`on_close` runs nested; it does not enter JS
            // over a pending termination).
            this.mark_inactive();
            delivered?;
        }
        if !SSL
            && !global.has_exception()
            && !this.socket.get().is_detached()
            && this.buffered_data_for_node_net.get().len() > 0
        {
            // What the `open` handler queued is sent again at once.
            return Self::on_writable(this, socket);
        }
        Ok(())
    }

    pub(crate) fn get_this_value(&self, global: &JSGlobalObject) -> JSValue {
        if let Some(value) = self.this_value.get().try_get() {
            return value;
        }
        if matches!(self.this_value.get(), JsRef::Finalized) {
            // The JS wrapper was already garbage-collected. Creating a new one
            // here would result in a second `finalize` (and double-deref) later.
            return JSValue::UNDEFINED;
        }
        let value = self.to_js(global);
        value.ensure_still_alive();
        // The wrapper holds the shared handlers cell in a visited slot, so the
        // callbacks stay reachable from every socket that can still fire them.
        // A detached socket has no handlers left to root.
        if let Some(handlers) = self.handlers.get() {
            Self::handlers_set_cached(value, global, handlers.cell());
        }
        // Hold strong until the socket is closed / marked inactive.
        self.this_value.with_mut(|r| r.set_strong(value, global));
        value
    }

    /// `get_this_value`, pinned: a Weak `node:net` handle GC'd mid-connect never fires `on_open`.
    pub(crate) fn this_value_for_connect(&self, global: &JSGlobalObject) -> JSValue {
        let value = self.get_this_value(global);
        if self.this_value.get().is_not_empty() {
            self.this_value.with_mut(|r| r.upgrade(global));
        }
        value
    }

    /// Points this socket at `handlers` and, when its JS wrapper already
    /// exists (the `node:net` prev-socket reuse paths), stores the new cell in
    /// the wrapper's visited slot. Fresh wrappers get it in
    /// [`get_this_value`](Self::get_this_value).
    pub(crate) fn set_handlers(&self, global: &JSGlobalObject, handlers: Option<Rc<Handlers>>) {
        self.handlers.set(handlers);
        if let (Some(handlers), Some(wrapper)) =
            (self.handlers.get(), self.this_value.get().try_get())
        {
            Self::handlers_set_cached(wrapper, global, handlers.cell());
        }
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_end(
        this: bun_ptr::ThisPtr<Self>,
        _socket: SocketHandler<SSL>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.dispatch_handlers() else {
            return Ok(());
        };
        log!(
            "onEnd {}",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            }
        );
        // Ensure the socket remains alive until this is finished
        let _guard = RefPtr::from_this(this);

        let callback = handlers.on_end();
        if callback.is_empty() {
            // `on_writable` sends the queued bytes, then closes.
            if this.buffered_data_for_node_net.get().len() > 0 {
                this.update_flags(|f| f.insert(Flags::END_AFTER_FLUSH));
                this.close_if_flushed();
                return Ok(());
            }
            this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));

            // If you don't handle TCP fin, we assume you're done.
            this.mark_inactive();
            return Ok(());
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let handled = match callback.call(&global, this_value, &[this_value]) {
            Ok(_) => Ok(()),
            Err(err) => {
                handlers.call_error_handler(this_value, &[this_value, global.take_error(err)])
            }
        };
        // Runs the handler's microtasks first, because one of them may call `end(data)`.
        drop(scope);
        this.end_on_peer_fin();
        handled
    }

    /// Closes an `allowHalfOpen: false` socket after the peer's FIN, once `end(data)`'s queued tail is sent.
    fn end_on_peer_fin(&self) {
        if !self.flags.get().contains(Flags::ENDS_ON_PEER_FIN)
            || !matches!(self.socket.get().socket, uws::InternalSocket::Connected(_))
            || self.socket.get().is_closed()
        {
            return;
        }
        self.update_flags(|f| f.insert(Flags::END_AFTER_FLUSH));
        self.close_if_flushed();
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_handshake(
        this: bun_ptr::ThisPtr<Self>,
        s: SocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.handlers_opt() else {
            return Ok(());
        };
        // The GC finalizer's own close reports the never-finished handshake, and a finalizer may not inspect other cells mid-sweep.
        if this.flags.get().contains(Flags::FINALIZING) {
            return Ok(());
        }
        let first_report = !this.flags.get().contains(Flags::HANDSHAKE_COMPLETE);
        this.update_flags(|f| f.insert(Flags::HANDSHAKE_COMPLETE));
        this.socket.set(s);
        // Keep the socket alive across the callbacks below (which re-enter JS)
        // and across `reject_unauthorized_connection`, whose close may
        // otherwise drop the last reference.
        let _guard = RefPtr::from_this(this);
        log!(
            "onHandshake {} ({})",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            },
            success
        );

        let mut authorized = success == 1;
        let mut hostname_mismatch = false;
        let mut hostname_mismatch_message: Option<Box<[u8]>> = None;
        // `server_identity` failed the handshake: the verdict and error of the check below.
        let rejected_in_handshake = SSL
            && success == 0
            && ssl_error.error_no == uws::us_bun_verify_error_t::HOSTNAME_MISMATCH;

        let flags = this.flags.get();
        if SSL
            && (authorized || rejected_in_handshake)
            && !flags.contains(Flags::DEFERS_SERVER_IDENTITY)
            && !this.acts_as_tls_server()
        {
            if let Some(ssl_ptr) = this.socket.get().ssl() {
                let hostname = this.server_identity_hostname();
                if rejected_in_handshake
                    || !uws::check_server_identity(
                        boringssl_sys::SSL::opaque_mut(ssl_ptr),
                        hostname,
                    )
                {
                    authorized = false;
                    hostname_mismatch = true;
                    hostname_mismatch_message = Some(
                        bun_boringssl::server_identity_mismatch_message(
                            boringssl_sys::SSL::opaque_mut(ssl_ptr),
                            hostname,
                        )
                        .into_bytes()
                        .into_boxed_slice(),
                    );
                }
            }
        }

        let verify_failed = SSL && ssl_error.error_no != 0 && !rejected_in_handshake;

        this.verify_error.set(if verify_failed {
            Some(StoredVerifyError {
                code: Box::from(ssl_error.code_bytes()),
                reason: Box::from(ssl_error.reason_bytes()),
            })
        } else {
            hostname_mismatch_message.map(|message| StoredVerifyError {
                code: Box::from(&b"ERR_TLS_CERT_ALTNAME_INVALID"[..]),
                reason: message,
            })
        });

        // node:tls closes its own sockets, and nothing marks the ones its servers accept.
        let failed_native_client = SSL
            && success == 0
            && !flags.contains(Flags::DEFERS_SERVER_IDENTITY)
            && !this.acts_as_tls_server();
        // Deliberately independent of `success`: the inline-reject path
        // dispatches with success=0 after suppressing the client Finished, and
        // REJECTED must still be set there or the write-refusal guards are
        // bypassed for the exact peer the policy is rejecting (a failed
        // handshake never has a usable transport, so fail closed on every
        // failure flavor).
        let reject_unauthorized = flags.contains(Flags::REJECT_UNAUTHORIZED)
            && (verify_failed || failed_native_client || hostname_mismatch);
        // A handshake that failed outright (success == 0 with no policy
        // verdict: protocol error, peer alert, EOF mid-handshake) never has a
        // usable transport either — node destroys the underlying socket before
        // user code can write again. Cover that flavor too, so the shared-fd
        // twin of an `upgradeTLS` pair cannot push plaintext through its
        // BYPASS_TLS write path in the window before JS tears the pair down.
        let transport_unusable = reject_unauthorized || (SSL && success == 0);

        // `REJECTED` is set before the callback runs so no write path can
        // deliver application data to a peer that is about to be rejected —
        // including the raw twin of an `upgradeTLS` pair, which shares the fd.
        this.update_flags(|f| {
            f.set(Flags::AUTHORIZED, authorized && !verify_failed);
            f.set(Flags::REJECTED, transport_unusable);
        });
        if transport_unusable {
            if let Some(twin) = this.twin.get().as_ref() {
                twin.update_flags(|f| f.insert(Flags::REJECTED));
            }
        } else if SSL {
            this.pause_on_connect_once();
        }

        let mut callback = handlers.on_handshake();
        let mut is_open = false;

        if handlers.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            // `on_close` is single-JS-entry, so the native close it routes
            // through here just takes the trap and returns.
            if reject_unauthorized {
                this.reject_unauthorized_connection();
            }
            return Ok(());
        }

        // A TLS error on the established session. With no `error` handler it stays silent: the peer chose it.
        let is_error = !first_report && success == 0;
        if is_error {
            callback = handlers.on_error();
        }

        // Use open callback when handshake is not provided
        if callback.is_empty() {
            if first_report {
                callback = handlers.on_open();
            }
            if callback.is_empty() {
                if reject_unauthorized {
                    this.reject_unauthorized_connection();
                }
                return Ok(());
            }
            is_open = true;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);

        let result: JSValue;
        // open callback only have 1 parameters and its the socket
        // you should use getAuthorizationError and authorized getter to get those values in this case
        if is_error {
            // `call_error_handler` below takes it.
            result = super::uws_jsc::verify_error_to_js(&ssl_error, &global);
        } else if is_open {
            result = match callback.call(&global, this_value, &[this_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

            // only call onOpen once for clients
            if handlers.mode != super::SocketMode::Server {
                // clean onOpen callback so only called in the first handshake and not in every renegotiation
                // on servers this would require a different approach but it's not needed because our servers will not call handshake multiple times
                // servers don't support renegotiation
                handlers.clear_on_open();
            }
        } else {
            // call handhsake callback with authorized and authorization error if has one
            let authorization_error: JSValue = if ssl_error.error_no == 0 || rejected_in_handshake {
                if hostname_mismatch {
                    this.stored_verify_error_to_js(&global)
                        .unwrap_or(JSValue::NULL)
                } else {
                    JSValue::NULL
                }
            } else {
                super::uws_jsc::verify_error_to_js(&ssl_error, &global)
            };

            result = match callback.call(
                &global,
                this_value,
                &[this_value, JSValue::from(authorized), authorization_error],
            ) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };
        }

        let handled = match result.to_error() {
            Some(err_value) => handlers.call_error_handler(this_value, &[this_value, err_value]),
            None => Ok(()),
        };
        drop(scope);
        // Fail closed: an unauthorized connection is rejected whatever happened
        // in the handlers.
        if reject_unauthorized {
            this.reject_unauthorized_connection();
        }
        handled
    }

    /// Stamps the resolved client `rejectUnauthorized` policy on a fresh or
    /// reused (reconnect) wrapper, clearing any previous handshake verdict.
    pub(crate) fn reset_client_tls_flags(&self, reject_unauthorized: bool) {
        self.verify_error.set(None);
        self.update_flags(|f| {
            f.remove(Flags::HANDSHAKE_COMPLETE | Flags::AUTHORIZED | Flags::REJECTED);
            f.set(Flags::REJECT_UNAUTHORIZED, reject_unauthorized);
        });
    }

    /// The name `on_handshake` requires the server's certificate to carry.
    fn server_identity_hostname(&self) -> &[u8] {
        match self.server_name.get() {
            Some(server_name) if !server_name.is_empty() => &server_name[..],
            _ => match self.connection.get() {
                Some(super::listener::UnixOrHost::Host { host, .. }) if !host.is_empty() => {
                    bun_core::ip_address::strip_ipv6_brackets(host)
                }
                _ => b"localhost",
            },
        }
    }

    /// `on_handshake`'s native name check, asked inside the handshake. node:tls is left out: its JS check decides.
    pub(crate) fn server_identity(
        &self,
        ssl: &mut boringssl_sys::SSL,
    ) -> bun_boringssl::ServerIdentity {
        let flags = self.flags.get();
        let enforced = !self.acts_as_tls_server()
            && flags.contains(Flags::REJECT_UNAUTHORIZED)
            && !flags.contains(Flags::DEFERS_SERVER_IDENTITY);
        bun_boringssl::server_identity(ssl, enforced.then(|| self.server_identity_hostname()))
    }

    /// Callers hold `on_handshake`'s ref guard, which outlives the
    /// synchronous `on_close` dispatch of this close.
    fn reject_unauthorized_connection(&self) {
        let socket = self.socket.get();
        if socket.is_detached() || socket.is_closed() {
            return;
        }
        self.close_and_detach(uws::CloseCode::FastShutdown);
    }

    /// The JS `Buffer` for an `on_session`/`on_keylog` payload. The
    /// `session_buffer` fault rule simulates the allocation throwing: that
    /// failure needs JSC heap exhaustion, so it is unreachable from a test
    /// without injection.
    fn create_dispatch_buffer(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
        #[cfg(socket_fault_injection)]
        {
            let mut out: isize = 0;
            let mut clamp: c_int = 0;
            // Deliberately skips `US_FAULT_CHECK`'s `us_fault_armed` fast-path
            // load: session/keylog dispatch is a few calls per connection, not
            // a per-packet hot path, so the unarmed-case lock is fine.
            // SAFETY: `out`/`clamp` are valid for the duration of the call.
            if unsafe {
                bun_uws_sys::fault_inject::us_fault_hit(
                    bun_uws_sys::fault_inject::SESSION_BUFFER,
                    -1,
                    &mut out,
                    &mut clamp,
                )
            } != 0
            {
                return Err(global.throw_out_of_memory());
            }
        }
        JSValue::create_buffer_from_length(global, len)
    }

    /// A new resumable TLS session arrived (the peer's NewSessionTicket was
    /// processed during an earlier `SSL_read`). Hands the serialized session
    /// to the JS `session` handler, mirroring Node's `onnewsession` callback.
    /// Dispatched from `ssl_flush_pending_session()` after the SSL stack has
    /// unwound, so the JS handler may safely destroy the socket.
    ///
    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_session(this: bun_ptr::ThisPtr<Self>, session: &[u8]) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.dispatch_handlers() else {
            return Ok(());
        };
        if handlers.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            return Ok(());
        }
        let callback = handlers.on_session();
        if callback.is_empty() {
            return Ok(());
        }
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };
        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let buffer = Self::create_dispatch_buffer(&global, session.len())?;
        if let Some(ab) = buffer.as_array_buffer(&global) {
            // SAFETY: `ab.ptr` points to a freshly-created `session.len()`-byte
            // JS buffer kept alive on the stack; `session` is valid for its length.
            unsafe {
                core::ptr::copy_nonoverlapping(session.as_ptr(), ab.ptr, session.len());
            }
        }
        let result = match callback.call(&global, this_value, &[this_value, buffer]) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };
        if let Some(err_value) = result.to_error() {
            handlers.call_error_handler(this_value, &[this_value, err_value])?;
        }
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_keylog(this: bun_ptr::ThisPtr<Self>, line: &[u8]) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.dispatch_handlers() else {
            return Ok(());
        };
        if handlers.vm.script_execution_status() != jsc::ScriptExecutionStatus::Running {
            return Ok(());
        }
        let callback = handlers.on_keylog();
        if callback.is_empty() {
            return Ok(());
        }
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };
        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let buffer = Self::create_dispatch_buffer(&global, line.len())?;
        if let Some(ab) = buffer.as_array_buffer(&global) {
            // SAFETY: `ab.ptr` points to a freshly-created `line.len()`-byte
            // JS buffer kept alive on the stack; `line` is valid for its length.
            unsafe {
                core::ptr::copy_nonoverlapping(line.as_ptr(), ab.ptr, line.len());
            }
        }
        let result = match callback.call(&global, this_value, &[this_value, buffer]) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };
        if let Some(err_value) = result.to_error() {
            handlers.call_error_handler(this_value, &[this_value, err_value])?;
        }
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_close(
        this: bun_ptr::ThisPtr<Self>,
        socket: SocketHandler<SSL>,
        err: c_int,
        reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        if let Some(ssl) = socket.ssl() {
            tls_socket_functions::ffi::us_ssl_set_bun_socket(
                boringssl_sys::SSL::opaque_ref(ssl),
                ptr::null_mut(),
            );
        }
        // A late close on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to, but the caller transferred its +1 (the
        // ext-slot/owner pin) - release it and detach so nothing further
        // dispatches either. mark_inactive is not needed: handlers being
        // null means the previous teardown already ran it.
        this.closing.set(SocketHandler::<SSL>::DETACHED);
        if !this.has_handlers() {
            this.detach_native_callback();
            this.socket.set(SocketHandler::<SSL>::DETACHED);
            this.get().deref();
            return Ok(());
        }
        let handlers = this.get_handlers();
        log!(
            "onClose {}",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            }
        );
        // Like Node, an http2 session reports a failed read, not a send that the kernel rejected.
        let err = if SSL
            && matches!(this.native_callback.get(), NativeCallbacks::H2(_))
            && socket.rejected_send_error() != 0
        {
            0
        } else {
            err
        };
        this.detach_native_callback();
        this.socket.set(SocketHandler::<SSL>::DETACHED);
        // A write whose send failed ends with that error, ahead of `close`. Any other queued write is canceled.
        let send_error = if err > 2 {
            socket.rejected_send_error()
        } else {
            0
        };
        let failed_write = this.take_failed_write(send_error);
        let reset = this.buffered_data_for_node_net.get().completion() == Completion::Reset;
        this.discard_queued_writes();
        // Declared first so it drops last: ticks drain ahead of the teardown.
        let _cleanup = CloseTeardown {
            socket: this,
            entered: Rc::clone(&handlers),
        };
        // The upgradeTLS raw twin shares the same us_socket_t so it never
        // gets its own dispatch — fire its (pre-upgrade) close handler
        // here, then retire it. `raw.twin == None` so this doesn't
        // recurse, and `onClose` derefs the +1 we took at creation.
        let _pair_scope = this.twin.with_mut(|t| t.take()).map(|raw| {
            // No tick checkpoint between the twin's close handler and this socket's own.
            // SAFETY: the VM owns its event loop for the life of the process.
            let scope =
                unsafe { jsc::event_loop::EventLoop::enter_scope(handlers.vm.event_loop()) };
            // `on_close` consumes the twin's +1 via its `CloseTeardown`, so
            // hand over the raw pointer rather than letting `RefPtr::drop`
            // release it a second time. This frame is the twin's trampoline for
            // the event, so what its handlers left pending is folded here and
            // this socket's own close proceeds regardless.
            crate::dispatch::fold(Self::on_close(raw.into_this_ptr(), socket, err, reason));
            scope
        });

        if this.flags.get().contains(Flags::FINALIZING) {
            return Ok(());
        }

        this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));

        if let Some(errno) = failed_write {
            let this_value = this.get_this_value(&handlers.global_object);
            Self::call_write_complete(&handlers, this_value, uv_status(errno));
        }

        let callback = handlers.on_close();

        if callback.is_empty() {
            return Ok(());
        }

        // Reached by a nested dispatch (a close from on_open's error branch,
        // a rejected handshake) while the handler
        // above is unwinding with a termination pending: it belongs to that
        // frame, so this dispatch neither enters JS over it nor claims it.
        if handlers.global_object.has_exception() {
            return Ok(());
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        // `err` is overloaded: when WE closed the socket it's a libus
        // CloseCode enum (0=clean, 1=failure/RST, 2=fast-shutdown); when the
        // close was driven by a recv() failure or a poll error (loop.c's
        // EPOLLERR/EV_ERROR branch, which reports SO_ERROR) it's the actual
        // error code. Neither producer can yield EPERM(1)/ENOENT(2) — recv
        // never returns them and the poll-error branch clamps them away — so
        // values >2 are real read errors and 0/1/2 are self-initiated closes
        // that must not surface as a JS read error (matching Node's
        // onStreamRead, which only sees errors that came from uv_read_cb).
        let error = match failed_write {
            Some(errno) => Some(sys::Error::new(errno, sys::Tag::write)),
            None if reset => Some(sys::Error::new(
                sys::SystemErrno::ECONNRESET,
                sys::Tag::read,
            )),
            None if err > 2 => Some(read_error_from_close_code(err)),
            None => None,
        };
        let js_error = error.map_or(JSValue::UNDEFINED, |error| {
            <sys::Error as jsc::SysErrorJsc>::to_js(&error, &global)
        });

        if let Err(e) = callback.call(&global, this_value, &[this_value, js_error]) {
            handlers.call_error_handler(this_value, &[this_value, global.take_error(e)])?;
        }
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub(crate) fn on_data(
        this: bun_ptr::ThisPtr<Self>,
        s: SocketHandler<SSL>,
        data: &[u8],
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let Some(handlers) = this.handlers_opt() else {
            return Ok(());
        };
        this.socket.set(s);
        this.bytes_read
            .set(this.bytes_read.get() + data.len() as u64);
        if this.native_callback.get().on_data(data)? {
            return Ok(());
        }
        log!(
            "onData {} ({})",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            },
            data.len()
        );

        let callback = handlers.on_data();
        if callback.is_empty() || this.flags.get().contains(Flags::FINALIZING) {
            return Ok(());
        }

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let output_value = match handlers.binary_type.get().to_js(data, &global) {
            Ok(v) => v,
            Err(err) => {
                return this.handle_error(global.take_error(err));
            }
        };

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let _scope = ScopeExit {
            socket: this,
            scope: Some(handlers.enter()),
        };

        // const encoding = handlers.encoding;
        if let Err(err) = callback.call(&global, this_value, &[this_value, output_value]) {
            handlers.call_error_handler(this_value, &[this_value, global.take_error(err)])?;
        }
        Ok(())
    }

    pub(crate) fn get_listener<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        let Some(handlers) = self.handlers.get() else {
            return JsLocal::UNDEFINED;
        };

        if handlers.mode != super::SocketMode::Server || self.socket.get().is_detached() {
            return JsLocal::UNDEFINED;
        }

        let Some(listener) = handlers.listener() else {
            return JsLocal::UNDEFINED;
        };
        match listener.this_value.get().try_get() {
            Some(listener) => JsLocal::new(heap, listener),
            None => JsLocal::UNDEFINED,
        }
    }

    pub(crate) fn get_ready_state(&self) -> i32 {
        let socket = self.socket.get();
        if socket.is_detached() {
            -1
        } else if socket.is_closed() {
            0
        } else if socket.is_established() {
            1
        } else if socket.is_shutdown() {
            -2
        } else {
            2
        }
    }

    pub(crate) fn get_authorized(&self) -> bool {
        log!("getAuthorized()");
        self.flags.get().contains(Flags::AUTHORIZED)
    }

    pub(crate) fn timeout(&self, cx: &mut JsScope<'_>, seconds: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if self.socket.get().is_detached() {
            return Ok(());
        }
        let t = seconds.to_js().coerce::<i32>(global)?;
        if t < 0 {
            return Err(global.throw(format_args!("Timeout must be a positive integer")));
        }
        log!("timeout({})", t);

        let seconds = c_uint::try_from(t).expect("int cast");
        self.timeout_seconds.set(seconds);
        self.socket.get().set_timeout(seconds);

        Ok(())
    }

    fn stored_verify_error_to_js(&self, global: &JSGlobalObject) -> Option<JSValue> {
        self.verify_error.get().as_ref().map(|stored| {
            let err = SystemError {
                code: BunString::clone_utf8(&stored.code),
                message: BunString::clone_utf8(&stored.reason),
                ..Default::default()
            };
            err.to_error_instance(global)
        })
    }

    pub(crate) fn get_authorization_error(&self, cx: &mut JsScope<'_>) -> JSValue {
        let global = cx.global();

        let socket = self.socket.get();
        if socket.is_detached() {
            // The verdict must survive the forced close.
            return self
                .stored_verify_error_to_js(global)
                .unwrap_or(JSValue::NULL);
        }

        // this error can change if called in different stages of hanshake
        // is very usefull to have this feature depending on the user workflow
        let ssl_error = socket.get_verify_error();
        // `on_handshake` stores the name verdict, with its full message, for the in-handshake check too.
        if ssl_error.error_no == 0
            || ssl_error.error_no == uws::us_bun_verify_error_t::HOSTNAME_MISMATCH
        {
            if let Some(stored) = self.stored_verify_error_to_js(global) {
                return stored;
            }
            if ssl_error.error_no == 0 {
                return JSValue::NULL;
            }
        } else if self.flags.get().contains(Flags::HANDSHAKE_COMPLETE) && socket.is_shutdown() {
            // What `on_handshake` reported stands.
            return self
                .stored_verify_error_to_js(global)
                .unwrap_or(JSValue::NULL);
        }

        let code: &[u8] = ssl_error.code_bytes();
        let reason: &[u8] = ssl_error.reason_bytes();

        let fallback = SystemError {
            code: BunString::clone_utf8(code),
            message: BunString::clone_utf8(reason),
            ..Default::default()
        };

        fallback.to_error_instance(global)
    }

    pub(crate) fn write(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        byte_offset: JsLocal<'_>,
        byte_length: JsLocal<'_>,
        encoding: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();

        if self.socket.get().is_detached() {
            return Ok(JSValue::js_number_from_int32(-1));
        }

        let result = self.write_or_end::<false>(
            global,
            data.to_js(),
            byte_offset.to_js(),
            byte_length.to_js(),
            encoding.to_js(),
            false,
        );
        Ok(match result {
            WriteResult::Fail => return Err(jsc::JsError::Thrown),
            // The errno of a fatal send (< -1) is for node:net; this API documents -1.
            WriteResult::Success { wrote, .. } => JSValue::js_number(wrote.max(-1) as f64),
        })
    }

    pub(crate) fn get_local_family(&self, cx: &mut JsScope<'_>) -> JSValue {
        let mut buf = [0u8; 64];
        ip_family_to_js(cx.global(), self.socket.get().local_address(&mut buf))
    }

    pub(crate) fn get_local_address(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let mut buf = [0u8; 64];
        ip_address_to_js(cx.global(), self.socket.get().local_address(&mut buf))
    }

    pub(crate) fn get_local_port(&self) -> Option<u16> {
        self.socket.get().local_port()
    }

    pub(crate) fn get_remote_family(&self, cx: &mut JsScope<'_>) -> JSValue {
        let mut buf = [0u8; 64];
        ip_family_to_js(cx.global(), self.socket.get().remote_address(&mut buf))
    }

    pub(crate) fn get_remote_address(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let mut buf = [0u8; 64];
        ip_address_to_js(cx.global(), self.socket.get().remote_address(&mut buf))
    }

    pub(crate) fn get_remote_port(&self) -> Option<u16> {
        self.socket.get().remote_port()
    }

    /// `bytesWritten` counts a write when the socket accepts it, as in Node.
    #[inline]
    fn count_written(&self, bytes: usize) {
        self.bytes_written
            .set(self.bytes_written.get() + bytes as u64);
    }

    /// Vectored raw write for plain-TCP sockets: all chunks reach the fd in one
    /// writev. Callers guarantee this socket has no TLS layer (raw writes bypass
    /// SSL framing).
    pub(crate) fn write_vectored_raw(&self, iov: &[bun_uws_sys::UsIoVec]) -> i32 {
        if !self.takes_writes() {
            return -1;
        }
        let res = self.socket.get().raw_writev(iov);
        self.count_written(usize::try_from(res.max(0)).expect("int cast"));
        res
    }

    /// Returns true if a write refused with would-block can still go out after a writable event.
    pub(crate) fn write_side_open(&self) -> bool {
        let socket = self.socket.get();
        socket.is_established()
            && !socket.is_shutdown()
            && !socket.is_closed()
            && !(SSL && self.flags.get().contains(Flags::REJECTED))
    }

    /// Asked once per write, where it enters. uSockets answers 0 to a write on such a socket, like for a full one.
    fn takes_writes(&self) -> bool {
        let socket = self.socket.get();
        !socket.is_shutdown()
            && !socket.is_closed()
            // The program closed it. `data` still comes while the TLS layer sends what it holds.
            && self.closing.get().is_detached()
            && !(SSL && self.flags.get().contains(Flags::REJECTED))
    }

    /// One send of at most `i32::MAX` bytes. Returns what the socket took, or the negative errno of a send that failed for good.
    fn try_send(&self, buffer: &[u8]) -> i32 {
        let socket = self.socket.get();
        let buffer = &buffer[..buffer.len().min(i32::MAX as usize)];
        // The raw half of an `upgradeTLS` pair shares the TLS half's us_socket_t, where `write_check_error` would encrypt.
        if self.flags.get().contains(Flags::BYPASS_TLS) {
            return socket.raw_write(buffer);
        }
        let (res, fatal_errno) = socket.write_check_error(buffer);
        log!("write({}) = {}", buffer.len(), res);
        if fatal_errno != 0 { -fatal_errno } else { res }
    }

    /// An unbuffered write: the caller keeps what the socket didn't take.
    fn send_unbuffered(&self, buffer: &[u8]) -> i32 {
        let res = self.try_send(buffer);
        self.count_written(usize::try_from(res.max(0)).expect("int cast"));
        res
    }

    /// The http2 parser's write. Returns -1 if the socket takes no writes.
    pub(crate) fn write_maybe_corked(&self, buffer: &[u8]) -> i32 {
        if !self.takes_writes() {
            return -1;
        }
        self.send_unbuffered(buffer)
    }

    /// Sends `bytes` until the socket refuses some. Returns what it took, and the errno of a send that failed for good.
    fn send(&self, mut bytes: &[u8]) -> (usize, c_int) {
        let mut sent: usize = 0;
        loop {
            let wrote = self.try_send(bytes);
            if wrote < -1 {
                return (sent, -wrote);
            }
            let wrote = usize::try_from(wrote.max(0)).expect("int cast");
            sent += wrote;
            bytes = &bytes[wrote..];
            // Only a whole `i32::MAX` slice leaves more to send without the socket having refused anything.
            if wrote < i32::MAX as usize || bytes.is_empty() {
                return (sent, 0);
            }
        }
    }

    /// Sends the queue. Returns the errno of a send that failed for good, which drops the queue.
    fn send_queue(&self) -> c_int {
        let (sent, fatal_errno) = self.send_queued(|bytes| self.send(bytes));
        if fatal_errno != 0 {
            self.fail_queued_writes(fatal_errno, PendingWrites::fail);
            return fatal_errno;
        }
        self.buffered_data_for_node_net
            .with_mut(|b| b.consume(sent));
        if self.socket.get().is_detached() {
            self.discard_queued_writes();
        }
        0
    }

    /// node:net's write. `true`: sent. `false`: queued, and `writeComplete` follows. A negative errno: refused, nothing follows.
    pub(crate) fn write_buffered(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        encoding: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (false, Some(handlers)) = (self.socket.get().is_detached(), self.handlers_opt()) else {
            let errno = if cfg!(windows) {
                sys::SystemErrno::EPIPE
            } else {
                sys::SystemErrno::EBADF
            };
            return Ok(JSValue::js_number_from_int32(uv_status(errno)));
        };

        // A Duplex transport's `write()` runs JS, which can close this socket.
        let _guard = self.ref_guard();
        let result = if self.buffered_data_for_node_net.get().len() == 0 {
            self.write_or_end::<false>(
                global,
                data.to_js(),
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
                encoding.to_js(),
                true,
            )
        } else {
            self.write_behind_queue(global, data.to_js(), encoding.to_js())
        };
        let WriteResult::Success { wrote, total } = result else {
            return Err(jsc::JsError::Thrown);
        };
        if wrote < -1 {
            let send_error = c_int::try_from(-wrote).expect("int cast");
            if !SSL {
                let status = uv_status(send_errno(send_error));
                return Ok(JSValue::js_number_from_int32(status));
            }
            // A TLS write never fails in the same call, as in Node.
            self.fail_queued_writes(send_error, PendingWrites::fail);
            return Ok(JSValue::FALSE);
        }
        if usize::try_from(wrote.max(0)).expect("int cast") == total
            && !self.holds_unsent_tls_records()
        {
            return Ok(JSValue::TRUE);
        }
        if self.socket.get().is_detached() {
            self.buffered_data_for_node_net.with_mut(|b| b.take());
            let canceled = uv_status(sys::SystemErrno::ECANCELED);
            self.complete_write_later(&handlers, Some(canceled));
        } else {
            self.buffered_data_for_node_net
                .with_mut(|b| b.owe_completion());
        }
        Ok(JSValue::FALSE)
    }

    /// The write stays pending until the writable event that follows. The raw twin of an `upgradeTLS` pair gets none.
    fn holds_unsent_tls_records(&self) -> bool {
        let uws_buffers = matches!(self.socket.get().socket, uws::InternalSocket::UwsHttp(_));
        (uws_buffers || (SSL && !self.flags.get().contains(Flags::BYPASS_TLS)))
            && self.socket.get().ssl_spill_pending()
    }

    /// `$write` while earlier bytes are still queued.
    fn write_behind_queue(
        &self,
        global: &JSGlobalObject,
        data_value: JSValue,
        encoding_value: JSValue,
    ) -> WriteResult {
        let buffer: StringOrBuffer = if data_value.is_undefined() {
            StringOrBuffer::EMPTY
        } else {
            match StringOrBuffer::from_js_with_encoding_value_allow_string_object(
                global,
                data_value,
                encoding_value,
                StringObjects::Allow,
            ) {
                Ok(Some(b)) => b,
                Ok(None) => {
                    if !global.has_exception() {
                        let _ = global.throw_invalid_argument_type_value(
                            b"data",
                            b"string, buffer, or blob",
                            data_value,
                        );
                    }
                    return WriteResult::Fail;
                }
                Err(_) => return WriteResult::Fail,
            }
        };
        let total = buffer.slice().len() + self.buffered_data_for_node_net.get().len();
        if !self.takes_writes() {
            return WriteResult::Success { wrote: -1, total };
        }
        self.count_written(buffer.slice().len());
        self.buffered_data_for_node_net
            .with_mut(|b| b.append_slice(buffer.slice()));
        let fatal_errno = self.send_queue();
        if fatal_errno != 0 {
            return WriteResult::Success {
                wrote: -(fatal_errno as isize),
                total,
            };
        }
        if self.socket.get().is_detached() {
            return WriteResult::Success { wrote: -1, total };
        }
        let left = self.buffered_data_for_node_net.get().len();
        WriteResult::Success {
            wrote: isize::try_from(total - left).expect("int cast"),
            total,
        }
    }

    fn write_or_end<const IS_END: bool>(
        &self,
        global: &JSGlobalObject,
        data: JSValue,
        byte_offset: JSValue,
        byte_length: JSValue,
        encoding: JSValue,
        buffer_unwritten_data: bool,
    ) -> WriteResult {
        if data.is_undefined() {
            if IS_END {
                self.update_flags(|f| f.insert(Flags::END_AFTER_FLUSH));
            }
            log!("writeOrEnd undefined");
            return WriteResult::Success { wrote: 0, total: 0 };
        }

        // `end(data)` left a tail queued, and a send now would jump ahead of it.
        if self.buffered_data_for_node_net.get().len() > 0 {
            return WriteResult::Success {
                wrote: -1,
                total: 0,
            };
        }
        let (offset_value, length_value, encoding_value) = if byte_length.is_string() {
            (byte_offset, JSValue::UNDEFINED, byte_length)
        } else if byte_offset.is_string() {
            (JSValue::UNDEFINED, byte_length, byte_offset)
        } else {
            (byte_offset, byte_length, encoding)
        };

        if !encoding_value.is_undefined()
            && (!offset_value.is_undefined() || !length_value.is_undefined())
        {
            let _ = global.throw_todo(b"Support encoding with offset and length altogether. Only either encoding or offset, length is supported, but not both combinations yet.");
            return WriteResult::Fail;
        }

        let buffer = match BlobOrStringOrBuffer::from_js_with_encoding_value_allow_request_response(
            global,
            data,
            encoding_value,
            true,
        ) {
            Ok(Some(b)) => b,
            Ok(None) => {
                if !global.has_exception() {
                    let _ = global.throw_invalid_argument_type_value(
                        b"data",
                        b"string, buffer, or blob",
                        data,
                    );
                }
                return WriteResult::Fail;
            }
            Err(_) => return WriteResult::Fail,
        };
        // `buffer` Drop frees.
        if matches!(&buffer, BlobOrStringOrBuffer::Blob(b) if b.needs_to_read_file()) {
            let _ = global.throw(format_args!(
                "File blob not supported yet in this function."
            ));
            return WriteResult::Fail;
        }

        // Rust can't reference an outer `const` generic in a nested `const` item
        // (E0401), so precompute the full label per branch.
        let label: &'static str = if IS_END { "Socket.end" } else { "Socket.write" };

        let byte_offset: usize = 'brk: {
            if offset_value.is_undefined() {
                break 'brk 0;
            }
            if !offset_value.is_any_int() {
                let _ = global.throw_invalid_argument_type(label, "byteOffset", "integer");
                return WriteResult::Fail;
            }
            let i = offset_value.to_int64();
            if i < 0 {
                let _ = global.throw_range_error(
                    i,
                    jsc::RangeErrorOptions {
                        field_name: b"byteOffset",
                        min: 0,
                        max: jsc::MAX_SAFE_INTEGER,
                        msg: b"",
                    },
                );
                return WriteResult::Fail;
            }
            usize::try_from(i).expect("int cast")
        };

        let byte_length: usize = 'brk: {
            if length_value.is_undefined() {
                break 'brk buffer.slice().len().saturating_sub(byte_offset);
            }
            if !length_value.is_any_int() {
                let _ = global.throw_invalid_argument_type(label, "byteLength", "integer");
                return WriteResult::Fail;
            }

            let l = length_value.to_int64();

            if l < 0 {
                let _ = global.throw_range_error(
                    l,
                    jsc::RangeErrorOptions {
                        field_name: b"byteLength",
                        min: 0,
                        max: jsc::MAX_SAFE_INTEGER,
                        msg: b"",
                    },
                );
                return WriteResult::Fail;
            }
            usize::try_from(l).expect("int cast")
        };

        let mut bytes = buffer.slice();

        if byte_offset > bytes.len() {
            let _ = global.throw_range_error(
                i64::try_from(byte_offset).expect("int cast"),
                jsc::RangeErrorOptions {
                    field_name: b"byteOffset",
                    min: 0,
                    max: i64::try_from(bytes.len()).expect("int cast"),
                    msg: b"",
                },
            );
            return WriteResult::Fail;
        }

        bytes = &bytes[byte_offset..];

        if byte_length > bytes.len() {
            let _ = global.throw_range_error(
                i64::try_from(byte_length).expect("int cast"),
                jsc::RangeErrorOptions {
                    field_name: b"byteLength",
                    min: 0,
                    max: i64::try_from(bytes.len()).expect("int cast"),
                    msg: b"",
                },
            );
            return WriteResult::Fail;
        }

        bytes = &bytes[..byte_length];

        if global.has_exception() {
            return WriteResult::Fail;
        }

        if !self.takes_writes() {
            return WriteResult::Success {
                wrote: -1,
                total: bytes.len(),
            };
        }
        if IS_END {
            self.update_flags(|f| f.insert(Flags::END_AFTER_FLUSH));
        }

        if bytes.is_empty() {
            if SSL {
                log!("writeOrEnd 0");
                // special condition for SSL_write(0, "", 0)
                // we need to send an empty packet after the buffer is flushed and after the handshake is complete
                // and in this case we need to ignore SSL_write() return value because 0 should not be treated as an error
                self.update_flags(|f| f.insert(Flags::EMPTY_PACKET_PENDING));
                if !self.try_write_empty_packet() {
                    return WriteResult::Success {
                        wrote: -1,
                        total: bytes.len(),
                    };
                }
            }
            return WriteResult::Success { wrote: 0, total: 0 };
        }
        log!("writeOrEnd {}", bytes.len());
        if !buffer_unwritten_data {
            return WriteResult::Success {
                wrote: self.send_unbuffered(bytes) as isize,
                total: bytes.len(),
            };
        }
        // Ahead of the send: a Duplex transport's `write()` can destroy the socket, and node:net reads the count there.
        self.count_written(bytes.len());
        let (sent, fatal_errno) = self.send(bytes);
        if fatal_errno != 0 {
            return WriteResult::Success {
                wrote: -(fatal_errno as isize),
                total: bytes.len(),
            };
        }
        if sent < bytes.len() {
            self.buffered_data_for_node_net
                .with_mut(|b| b.append_slice(&bytes[sent..]));
        }
        WriteResult::Success {
            wrote: isize::try_from(sent).expect("int cast"),
            total: bytes.len(),
        }
    }

    fn try_write_empty_packet(&self) -> bool {
        if SSL {
            // just mimic the side-effect dont actually write empty non-TLS data onto the socket, we just wanna to have same behavior of node.js
            if !self.flags.get().contains(Flags::HANDSHAKE_COMPLETE)
                || self.buffered_data_for_node_net.get().len() > 0
            {
                return false;
            }

            self.update_flags(|f| f.remove(Flags::EMPTY_PACKET_PENDING));
            return true;
        }
        false
    }

    fn can_end_after_flush(&self) -> bool {
        let flags = self.flags.get();
        flags.contains(Flags::IS_ACTIVE)
            && flags.contains(Flags::END_AFTER_FLUSH)
            && !flags.contains(Flags::EMPTY_PACKET_PENDING)
            && self.buffered_data_for_node_net.get().len() == 0
    }

    /// Sends the queue, then closes a socket that `end()` is waiting to close. Returns false if a send failed for good.
    fn internal_flush(&self) -> bool {
        // A TLS socket whose handshake was rejected has no usable transport:
        // never push the buffered tail at it, and report no error (the
        // rejection is surfaced by the handshake path, not by the flush).
        if SSL && self.flags.get().contains(Flags::REJECTED) {
            return true;
        }
        if self.buffered_data_for_node_net.get().len() > 0 && self.send_queue() != 0 {
            return false;
        }

        let _ = self.try_write_empty_packet();
        self.socket.get().flush();
        self.close_if_flushed();
        true
    }

    pub(crate) fn flush(&self, _: &mut JsScope<'_>) {
        // `end()` → `internal_flush` → `mark_inactive` → `close_and_detach(Normal)`
        // detaches `self.socket` and, for TLS, defers the raw close until the
        // peer's close_notify arrives — leaving `is_active` set so the eventual
        // `on_close` can run `handlers.mark_inactive()`. Without this guard a
        // follow-up `flush()` re-enters `mark_inactive`, sees the detached
        // socket as closed, and decrements `active_connections` a second time;
        // the deferred `on_close` then underflows it. Every other
        // `internal_flush` caller already has this check.
        if self.socket.get().is_detached() {
            return;
        }
        let _ = self.internal_flush();
    }

    pub(crate) fn terminate(&self, _: &mut JsScope<'_>) {
        self.close_and_detach(uws::CloseCode::Failure);
        self.closing
            .replace(SocketHandler::<SSL>::DETACHED)
            .close(uws::CloseCode::Failure);
    }

    pub(crate) fn shutdown(&self, _: &mut JsScope<'_>, half_close: bool) {
        if half_close {
            self.socket.get().shutdown_read();
        } else if !self.native_callback.get().defer_shutdown() {
            self.socket.get().shutdown();
        }
    }

    pub(crate) fn close(&self, _: &mut JsScope<'_>) {
        let socket = self.socket.get();
        self.discard_queued_writes();
        // `_handle.close()` is the net.Socket `_destroy()` path. Node closes the fd
        // with no close_notify (crypto_tls.cc sends the alert only from DoShutdown,
        // the end() path), so `.fast_shutdown` raw-closes synchronously: a bare FIN.
        // Not `.normal`: that defers for the peer's reply while we detach + unref
        // below, orphaning the `us_socket_t`. Not `.failure`: that arms
        // SO_LINGER{1,0} → RST and drops data still in the kernel send buffer,
        // which `destroy()` after `write()` must not do. The SSL layer may still
        // defer behind its ciphertext write spill (`ssl_close_after_spill`).
        socket.close(uws::CloseCode::FastShutdown);
        self.socket.set(SocketHandler::<SSL>::DETACHED);
        self.keep_if_still_closing(socket);
        self.poll_ref.with_mut(|p| {
            p.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
    }

    pub(crate) fn end(
        &self,
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        byte_offset: JsLocal<'_>,
        byte_length: JsLocal<'_>,
        encoding: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        log!("end");
        if self.socket.get().is_detached() {
            return Ok(JSValue::js_number(-1.0));
        }

        // `write_or_end` reaches `internal_flush`, which re-enters JS.
        let _guard = self.ref_guard();
        // No writable event reaches the raw half of an `upgradeTLS` pair, so nothing would send its tail.
        let queues_tail = !self.flags.get().contains(Flags::BYPASS_TLS);
        let result = self.write_or_end::<true>(
            global,
            data.to_js(),
            byte_offset.to_js(),
            byte_length.to_js(),
            encoding.to_js(),
            queues_tail,
        );
        let result = match result {
            WriteResult::Fail => return Err(jsc::JsError::Thrown),
            WriteResult::Success { wrote, total } => {
                if wrote < -1 {
                    self.fail_queued_writes(
                        c_int::try_from(-wrote).expect("int cast"),
                        PendingWrites::fail,
                    );
                } else if wrote >= 0 && usize::try_from(wrote).expect("int cast") == total {
                    let _ = self.internal_flush();
                } else {
                    self.arm_tail_timeout();
                }
                if queues_tail && wrote >= 0 {
                    JSValue::js_number(total as f64)
                } else {
                    JSValue::js_number(wrote.max(-1) as f64)
                }
            }
        };
        Ok(result)
    }

    /// Returns false for a node:http connection that uWS owns: its server holds the loop for it, and `leave_http` applies the wish.
    fn holds_loop_when_reffed(&self) -> bool {
        let socket = self.socket.get();
        socket.is_established() && !matches!(socket.socket, uws::InternalSocket::UwsHttp(_))
    }

    pub(crate) fn js_ref(&self) {
        if self.holds_loop_when_reffed() {
            self.poll_ref.with_mut(|p| p.ref_(js_loop_ctx()));
        } else {
            // `connect_finish` holds the loop until then; `on_open` applies this.
            self.ref_pollref_on_connect.set(true);
        }
    }

    pub(crate) fn js_unref(&self) {
        if self.holds_loop_when_reffed() {
            self.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));
        } else {
            self.ref_pollref_on_connect.set(false);
        }
    }

    pub(crate) fn finalize(&self) {
        log!("finalize() {}", core::ptr::from_ref(self) as usize);
        self.update_flags(|f| f.insert(Flags::FINALIZING));
        self.this_value.with_mut(|r| r.finalize());
        if !self.socket.get().is_closed() {
            self.socket.get().prepare_for_finalize();
            self.close_and_detach(uws::CloseCode::Failure);
        } else {
            self.detach_native_callback();
        }
    }

    pub(crate) fn reload(&self, cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let opts = options.to_js();

        if self.socket.get().is_detached() {
            return Ok(());
        }

        if !opts.is_object() {
            return Err(global.throw(format_args!("Expected options object")));
        }

        let socket_obj = opts
            .get(global, "socket")?
            .ok_or_else(|| global.throw(format_args!("Expected \"socket\" option")))?;

        // The "socket" getter can close this socket, which drops its handlers.
        let Some(handlers) = self.handlers_opt() else {
            return Ok(());
        };
        // Parse and validate first: the option getters run user JS that can
        // close this socket and repoint its `Handlers`.
        let reloaded = Handlers::prepare_reload(global, socket_obj)?;
        if !self.handlers_are(&handlers) {
            return Ok(());
        }
        // Update the callbacks of the existing cell in place, so the listener
        // and every socket sharing it observe them; nothing else about the
        // shared `Handlers` (mode, active_connections) is touched.
        handlers.apply_reload(global, &reloaded);

        Ok(())
    }

    pub(crate) fn get_fd<'a>(&self, heap: &JsHeap<'a>) -> JsLocal<'a> {
        // On Windows the fd is a system-kind SOCKET handle; routing it through
        // `.uv()` panics for anything but stdio. The sys_jsc helper branches on
        // kind (system→u64, uv→i32, posix→i32).
        use bun_sys_jsc::FdJsc as _;
        JsLocal::new(
            heap,
            self.socket.get().fd().to_js_without_making_lib_uv_owned(),
        )
    }

    pub(crate) fn get_bytes_written(&self) -> f64 {
        self.total_bytes_written() as f64
    }

    /// In-place TCP→TLS upgrade. The underlying `us_socket_t` is
    /// `adoptTLS`'d into the per-VM TLS group with a fresh (or
    /// SecureContext-shared) `SSL_CTX*`. Returns `[raw, tls]` — two
    /// `TLSSocket` wrappers over one fd: `tls` is the encrypted view that
    /// owns dispatch; `raw` has `bypass_tls` set so node:net's
    /// `socket._handle` can pipe pre-handshake/tunnelled bytes via
    /// `us_socket_raw_write`. No second context, no `Handlers.clone()`.
    pub(crate) fn upgrade_tls(
        &self,
        cx: &mut JsScope<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        self.upgrade_tls_impl(global, options.to_js(), false)
    }

    /// `defers_server_identity`: node:tls owns hostname policy in its JS layer
    /// (`checkServerIdentity`), so its internal entry point sets it; the public
    /// `upgradeTLS` never does.
    fn upgrade_tls_impl(
        &self,
        global: &JSGlobalObject,
        opts: JSValue,
        defers_server_identity: bool,
    ) -> JsResult<JSValue> {
        if SSL {
            return Ok(JSValue::UNDEFINED);
        }
        // adoptTLS needs a real `*us_socket_t`. `.connecting` (DNS /
        // happy-eyeballs in flight) and `.upgradedDuplex` have no fd to
        // adopt; the old `isDetached()/isNamedPipe()` guard let those
        // through and the `.connected` payload read below would then be
        // illegal-union-access on a `.connecting` socket.
        if !matches!(self.socket.get().socket, uws::InternalSocket::Connected(_)) {
            return Err(global.throw_invalid_arguments(format_args!(
                "upgradeTLS requires an established socket"
            )));
        }
        let options = UpgradeOptions::from_js(global, opts, self.is_server())?;
        let is_server = options.is_server;

        // An option getter can close this socket, or re-enter upgradeTLS and adopt its fd.
        let uws::InternalSocket::Connected(raw_socket) = self.socket.get().socket else {
            return Err(global.throw_invalid_arguments(format_args!(
                "upgradeTLS requires an established socket"
            )));
        };

        let vm = options.handlers.vm;
        let verify = options.server_verify();
        let tls = options.new_socket(defers_server_identity);
        tls.update_flags(|f| f.insert(self.flags.get() & Flags::ENDS_ON_PEER_FIN));
        tls.connection.set(self.connection.get().clone());
        let sni: Option<&core::ffi::CStr> =
            options.config.as_ref().and_then(|c| c.server_name_cstr());
        let loop_ = vm.uws_loop();
        // The TLS socket stays with the context the TCP socket belongs to, whoever upgrades it.
        let accepted = self
            .handlers
            .get()
            .as_ref()
            .is_some_and(|handlers| handlers.mode == SocketMode::Server);
        let groups: *mut bun_jsc::rare_data::SocketGroups = if accepted {
            // In its listener's own group: the listener's context.
            let listener_context = self
                .handlers
                .get()
                .as_ref()
                .and_then(|handlers| handlers.listener().map(|listener| listener.context));
            let vm = VirtualMachine::get();
            let context =
                listener_context.map_or_else(|| vm.root_context(), |id| vm.context_of(id));
            core::ptr::from_mut(vm.as_mut().client_socket_groups_in(context))
        } else {
            // SAFETY: `raw_socket` is live (below) and client sockets only join a `SocketGroups` group.
            unsafe { bun_jsc::rare_data::SocketGroups::of((*raw_socket).group()) }
        };
        // SAFETY: a boxed set that outlives this call; JS thread.
        let groups = unsafe { &mut *groups };
        let group = groups.bun_connect_group::<true>(loop_);
        // SAFETY: `raw_socket` is the live `*mut us_socket_t` extracted from
        // `InternalSocket::Connected` above; `options.ctx` is the +1 ref
        // taken from SecureContext/ssl_ctx_cache and never null here.
        let new_raw: NonNull<uws::us_socket_t> = match unsafe {
            (*raw_socket).adopt_tls(
                group,
                uws::SocketKind::BunSocketTls,
                &mut *options.ctx.as_ptr(),
                sni,
                !is_server,
                verify.request_cert,
                verify.reject_unauthorized,
                core::mem::size_of::<*mut c_void>() as i32,
                core::mem::size_of::<*mut c_void>() as i32,
            )
        } {
            Some(s) => s,
            None => {
                let err = boringssl_sys::ERR_get_error();
                // Sole owner of the fresh allocation: `deref` drops it, with its handlers.
                tls.get().deref();
                if err != 0 {
                    return Err(global.throw_value(boringssl_err_to_js(global, err)));
                }
                return Err(global.throw(format_args!(
                    "Failed to upgrade socket from TCP -> TLS. Is the TLS config correct?",
                )));
            }
        };

        // Retire the original TCP wrapper before any TLS dispatch can run
        // back into JS — it must not see two live owners on one fd. Its
        // *Handlers are TRANSFERRED to the raw twin (the `[raw, tls]`
        // contract is: index 0 keeps the pre-upgrade callbacks and sees
        // ciphertext, index 1 gets the new ones and sees plaintext).
        let raw_handlers = self.take_handlers();
        // Preserve `socket.unref()` across the upgrade — node:tls callers
        // that unref the underlying TCP socket before upgrading must not
        // suddenly hold the loop open via the TLS wrapper.
        let was_reffed = self.poll_ref.get().is_active();
        // Capture before downgrade so the cached `data` (net.ts stores
        // `{self: net.Socket}` there) survives onto the raw twin.
        let original_data: JSValue =
            Self::data_get_cached(self.get_this_value(global)).unwrap_or(JSValue::UNDEFINED);
        original_data.ensure_still_alive();
        if self.flags.get().contains(Flags::IS_ACTIVE) {
            self.poll_ref.with_mut(|p| p.disable());
            self.update_flags(|f| f.remove(Flags::IS_ACTIVE));
            // Do NOT mark_inactive raw_handlers — ownership of the
            // active_connections=1 it holds is transferring to `raw`.
            self.this_value.with_mut(|r| r.downgrade());
        }
        // Release the retired TCP wrapper's ref on EVERY exit past this point,
        // including the `?` early-returns below.
        // SAFETY: `self` owns the outstanding ref this guard consumes; the JS
        // wrapper's own +1 keeps the allocation alive across the whole call.
        let _guard = unsafe { RefPtr::from_raw(self.as_ctx_ptr()) };
        self.detach_native_callback();
        self.socket.set(SocketHandler::<SSL>::DETACHED);

        // Only NOW is it safe for dispatch to fire: ext + kind point at `tls`.
        *uws::us_socket_t::opaque_mut(new_raw.as_ptr()).ext() = Some(tls);
        tls.socket
            .set(SocketHandler::<true>::from(new_raw.as_ptr()));
        tls.ref_();

        // The `raw` half — same `us_socket_t*`, ORIGINAL pre-upgrade
        // *Handlers, writes bypass SSL. Dispatch reaches it via the
        // `ssl_raw_tap` ciphertext hook, never via the ext slot.
        let raw = TLSSocket::new(raw_handlers);
        raw.socket
            .set(SocketHandler::<true>::from(new_raw.as_ptr()));
        // IS_ACTIVE so `raw.on_close` releases `raw_handlers`, which already count this connection from `self`.
        raw.flags.set(Flags::BYPASS_TLS | Flags::IS_ACTIVE);
        // Same fd as the TCP wrapper it replaces, so the count carries over.
        raw.bytes_written.set(self.bytes_written.get());
        raw.bytes_read.set(self.bytes_read.get());
        tls.timeout_seconds.set(self.timeout_seconds.get());
        let raw_ref = raw;
        raw_ref.ref_();
        // SAFETY: `raw` came from `TLSSocket::new` (heap::alloc); intrusive +1 held.
        tls.twin
            .set(Some(unsafe { RefPtr::from_raw(raw.as_ptr()) }));

        let tls_js_value = tls.get_this_value(global);
        let raw_js_value = raw_ref.get_this_value(global);
        TLSSocket::data_set_cached(tls_js_value, global, options.data);
        // `raw` keeps the pre-upgrade `data` so its callbacks emit on the
        // original net.Socket, not the TLS one.
        TLSSocket::data_set_cached(raw_js_value, global, original_data);

        tls.mark_active();
        if was_reffed {
            tls.poll_ref.with_mut(|p| {
                p.ref_(bun_io::posix_event_loop::get_vm_ctx(
                    bun_io::AllocatorType::Js,
                ))
            });
        }

        // Fire onOpen with the right `this`, then send ClientHello. Doing
        // it before ext was repointed would have ALPN/onOpen land in the
        // dead TCPSocket.
        // What settling in the new socket's `on_open` left pending (a
        // terminating VM) is not run over: the handshake re-enters JS.
        TLSSocket::on_open(tls, tls.socket.get())?;
        bun_opaque::opaque_deref_mut(new_raw.as_ptr()).start_tls_handshake();
        // The socket being wrapped may have had its readable interest off (an
        // accepted socket nobody was reading yet — its ClientHello is still in
        // the kernel buffer); make sure the adopted TLS socket is reading so
        // the handshake can be driven. A no-op when it was already reading.
        bun_opaque::opaque_deref_mut(new_raw.as_ptr()).resume();
        // Feed bytes that arrived before the upgrade (already pulled off the fd
        // by the plain-TCP layer) into the TLS engine exactly as if they had
        // just been received — for a server-side wrap this is the ClientHello.
        if !options.initial_data.is_empty() {
            bun_opaque::opaque_deref_mut(new_raw.as_ptr())
                .tls_feed(options.initial_data.as_slice());
        }
        // After the feed: `raw` handed those bytes over, it is not shown them again.
        bun_opaque::opaque_deref_mut(new_raw.as_ptr()).set_ssl_raw_tap(true);

        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(global, 0, raw_js_value)?;
        array.put_index(global, 1, tls_js_value)?;
        Ok(array)
    }
}

pub(crate) type TCPSocket = NewSocket<false>;
pub(crate) type TLSSocket = NewSocket<true>;

// ──────────────────────────────────────────────────────────────────────────
// NativeCallbacks — direct callbacks on HTTP2 when available
// ──────────────────────────────────────────────────────────────────────────

pub(crate) enum NativeCallbacks {
    H2(RefPtr<H2FrameParser>),
    None,
}

impl NativeCallbacks {
    /// `&self` borrows the socket's `JsCell<NativeCallbacks>`; the dispatch
    /// re-enters JS, which can `detach_native_callback` and overwrite that cell.
    /// Copy the parser pointer out first; the callee's `keepalive()` holds it.
    /// `Ok(false)`: nothing attached, dispatch to the JS handlers.
    pub(crate) fn on_data(&self, data: &[u8]) -> JsResult<bool> {
        let h2 = match self {
            NativeCallbacks::H2(h2) => h2.as_ptr(),
            NativeCallbacks::None => return Ok(false),
        };
        // SAFETY: `on_native_read` takes a keepalive; `h2` stays live across re-entry.
        unsafe { (*h2).on_native_read(data) }?;
        Ok(true)
    }
    pub(crate) fn on_writable(&self) -> bool {
        let h2 = match self {
            NativeCallbacks::H2(h2) => h2.as_ptr(),
            NativeCallbacks::None => return false,
        };
        // SAFETY: `on_native_writable` takes a keepalive; `h2` stays live across re-entry.
        unsafe { (*h2).on_native_writable() };
        true
    }
    /// Returns true if the attached parser takes over the half-close and sends the FIN after its own output.
    pub(crate) fn defer_shutdown(&self) -> bool {
        match self {
            NativeCallbacks::H2(h2) => h2.defer_shutdown(),
            NativeCallbacks::None => false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WriteResult
// ──────────────────────────────────────────────────────────────────────────

enum WriteResult {
    Fail,
    Success { wrote: isize, total: usize },
}

/// The end of a write that has to come from the event loop.
pub(crate) struct DeferredWriteCompletion<const SSL: bool> {
    socket: RefPtr<NewSocket<SSL>>,
    /// A closed socket holds its wrapper weakly.
    this_value: jsc::Strong,
    handlers: Rc<Handlers>,
    /// `None`: close the socket if its reads are still stopped. `on_close` reports the failed write.
    status: Option<c_int>,
}

impl<const SSL: bool> DeferredWriteCompletion<SSL> {
    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn run(self: Box<Self>) {
        if let Some(status) = self.status {
            NewSocket::<SSL>::call_write_complete(&self.handlers, self.this_value.get(), status);
        } else if self.socket.lost_write_of_stopped_reader() {
            self.socket.socket.get().close(uws::CloseCode::Failure);
        }
    }
}

impl<const SSL: bool> bun_event_loop::Taskable for DeferredWriteCompletion<SSL> {
    const TAG: bun_event_loop::TaskTag = if SSL {
        bun_event_loop::task_tag::TLSSocketWriteCompletion
    } else {
        bun_event_loop::task_tag::TCPSocketWriteCompletion
    };
    unsafe fn release_unrun(this: *mut Self) {
        // SAFETY: fn contract. Boxed in `complete_write_later`.
        drop(unsafe { bun_core::heap::take(this) });
    }
    unsafe fn context(this: *const Self) -> bun_event_loop::ContextId {
        // SAFETY: fn contract. The queued task is live.
        unsafe { (*this).handlers.context() }
    }
}

pub(crate) struct StoredVerifyError {
    pub code: Box<[u8]>,
    pub reason: Box<[u8]>,
}

// ──────────────────────────────────────────────────────────────────────────
// Flags
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Flags: u32 {
        const IS_ACTIVE            = 1 << 0;
        /// Prevent onClose from calling into JavaScript while we are finalizing
        const FINALIZING           = 1 << 1;
        const AUTHORIZED           = 1 << 2;
        const HANDSHAKE_COMPLETE   = 1 << 3;
        const EMPTY_PACKET_PENDING = 1 << 4;
        const END_AFTER_FLUSH      = 1 << 5;
        const IS_PAUSED            = 1 << 7;
        /// Set for `allowHalfOpen: false` on `Bun.listen` / `Bun.connect`. `on_end` closes the socket.
        const ENDS_ON_PEER_FIN     = 1 << 8;
        /// Set on the `raw` half of an `upgradeTLS` pair. Writes route through
        /// `us_socket_raw_write` (bypassing the SSL layer) so node:net can pipe
        /// pre-handshake bytes / read the underlying TCP stream.
        const BYPASS_TLS           = 1 << 9;
        /// The peer failed verification under an enforcing policy: the socket
        /// refuses writes and is closed right after the handshake callback.
        const REJECTED             = 1 << 10;
        const REJECT_UNAUTHORIZED  = 1 << 12;
        /// Set only by the node:net / node:tls socket constructors: their JS
        /// layer owns server-identity policy (`checkServerIdentity`), so the
        /// native name check does not run for them.
        const DEFERS_SERVER_IDENTITY = 1 << 13;
        /// `upgradeTLS({ isServer: true })`: the socket acts as the TLS server
        /// even though its `Handlers` mode is `Client` (no listener), so the
        /// client-only server-identity check must not run against its peer.
        const TLS_SERVER_ROLE      = 1 << 14;
        /// node:net's `pauseOnConnect`: paused in `on_open` (plain; free for a socket that was registered with `LIBUS_SOCKET_OPEN_PAUSED`) or after the handshake (TLS).
        const PAUSE_ON_CONNECT     = 1 << 15;
        /// `ALPNCallback` refused the client's protocols, so `us_dispatch_alpn_select` sends the fatal alert.
        const ALPN_REFUSED         = 1 << 16;
        /// A send is reading `buffered_data_for_node_net`, so its caller frees the queue if the socket closes.
        const SENDING_QUEUE        = 1 << 17;
        /// node:net's `fdIsWriteOnly`: `do_connect` gives the descriptor to an `FdPipe`, not to uSockets.
        const WRITE_ONLY_FD        = 1 << 18;
        /// TCP_NODELAY is known to be on, so asking for it again costs no syscall. node:net asks for each connection of an http.Server, and the accept has set it.
        const NO_DELAY = 1 << 30;
        /// The `ws` package's WebSocket on this connection has closed, and the kernel had taken everything it queued.
        const CLOSED_WITH_ALL_DATA_SENT = 1 << 31;
    }
}

impl Flags {
    fn initial(reject_unauthorized: bool) -> Flags {
        let mut flags = Flags::empty();
        flags.set(Flags::REJECT_UNAUTHORIZED, reject_unauthorized);
        flags
    }
}

/// What `upgradeTLS()` and node:tls's two forms of it, over a descriptor and over a stream, read from their options.
struct UpgradeOptions {
    is_server: bool,
    handlers: Rc<Handlers>,
    /// Nothing else holds the handlers' callback cell until the TLS socket's wrapper does.
    _cell_root: jsc::Strong,
    /// Bytes read off the wire before the upgrade, such as a ClientHello in the readable buffer of the wrapped socket.
    initial_data: Vec<u8>,
    ctx: boringssl_sys::OwnedSslCtx,
    /// The server name, the ALPN protocols and the peer-certificate policy. `None` for a bare `secureContext`.
    config: Option<SSLConfig>,
    data: JSValue,
}

impl UpgradeOptions {
    /// An explicit `isServer` wins over how the wrapped socket was created, as in Node.
    fn from_js(
        global: &JSGlobalObject,
        opts: JSValue,
        is_server_by_default: bool,
    ) -> JsResult<Self> {
        if !opts.is_object() {
            return Err(global.throw(format_args!("Expected options object")));
        }
        let is_server = match opts.get_truthy(global, "isServer")? {
            Some(value) => value.to_boolean(),
            None => is_server_by_default,
        };
        let socket_obj = opts
            .get(global, "socket")?
            .ok_or_else(|| global.throw(format_args!("Expected \"socket\" option")))?;
        let initial_data: Vec<u8> = match opts.get_truthy(global, "initialData")? {
            Some(v) => StringOrBuffer::from_js(global, v)?
                .map(|data| data.slice().to_vec())
                .unwrap_or_default(),
            None => Vec::new(),
        };
        // Client mode: no listener owns these handlers. `Flags::TLS_SERVER_ROLE` carries the server role.
        let handlers = Handlers::from_js(global, socket_obj, SocketMode::Client)?;
        let cell_root = handlers.root_cell(global);
        let vm = handlers.vm;

        // node:net passes what `[buntls]` returns as `tls`, so its SecureContext is `tls.secureContext`. Userland may pass it top-level.
        let mut given_ctx = SecureContext::ctx_from_options(global, opts)?;
        let tls_js = opts.get_truthy(global, "tls")?;
        if given_ctx.is_none()
            && let Some(tls_js) = tls_js
        {
            given_ctx = SecureContext::ctx_from_options(global, tls_js)?;
        }
        let (ctx, config) = if let Some(ctx) = given_ctx {
            let config = match tls_js {
                Some(t) if !t.is_boolean() => {
                    ParsedTls::from_js(vm, global, t, is_server)?.or_none()
                }
                _ => None,
            };
            (ctx, config)
        } else if let Some(tls_js) = tls_js {
            let mut config = if tls_js.is_boolean() {
                vm.tls_config(Default::default(), is_server)
            } else {
                let parsed = ParsedTls::from_js(vm, global, tls_js, is_server)?;
                if is_server {
                    parsed
                        .or_none()
                        .ok_or_else(|| global.throw(format_args!("Expected \"tls\" option")))?
                } else {
                    // A client's object that sets no option is `true`, as in `Bun.connect`.
                    parsed.or_defaults(vm, false)
                }
            };
            (Self::cached_ctx(global, &mut config)?, Some(config))
        } else {
            return Err(global.throw(format_args!("Expected \"tls\" option")));
        };

        let data = opts
            .fast_get(global, jsc::BuiltinName::Data)?
            .unwrap_or_default();
        Ok(Self {
            is_server,
            handlers,
            _cell_root: cell_root,
            initial_data,
            ctx,
            config,
            data,
        })
    }

    /// The per-VM cache: `tls: true` and `{ servername }` share the context of `Bun.connect`, and upgrades that name one CA share theirs.
    fn cached_ctx(
        global: &JSGlobalObject,
        config: &mut SSLConfig,
    ) -> JsResult<boringssl_sys::OwnedSslCtx> {
        let mut create_err = uws::create_bun_socket_error_t::none;
        if let Some(ctx) = SSLContextCache::get_or_create(config, &mut create_err) {
            return Ok(ctx);
        }
        // Only the CA and cipher cases set the error. A bad cert, key or DH leaves the detail on BoringSSL's error queue.
        Err(
            global.throw_value(if create_err != uws::create_bun_socket_error_t::none {
                crate::socket::uws_jsc::create_bun_socket_error_to_js(create_err, global)
            } else {
                boringssl_err_to_js(global, boringssl_sys::ERR_get_error())
            }),
        )
    }

    /// A server's `requestCert` and `rejectUnauthorized`. A bare `secureContext` has them in its verify mode.
    fn server_verify(&self) -> ServerVerify {
        let ctx = Some(self.ctx.as_ptr());
        match &self.config {
            Some(c) => ServerVerify {
                request_cert: c.request_cert != 0,
                reject_unauthorized: c.reject_unauthorized != 0,
            },
            None => ServerVerify {
                request_cert: server_ctx_requests_cert(ctx),
                reject_unauthorized: server_ctx_rejects_unauthorized(ctx),
            },
        }
    }

    /// The TLS socket of the upgrade. It has no transport yet.
    fn new_socket(&self, defers_server_identity: bool) -> bun_ptr::ThisPtr<TLSSocket> {
        let config = self.config.as_ref();
        let mut flags = Flags::initial(upgrade_reject_policy(
            self.handlers.vm,
            config,
            self.is_server,
            Some(self.ctx.as_ptr()),
        ));
        flags.set(Flags::DEFERS_SERVER_IDENTITY, defers_server_identity);
        flags.set(Flags::TLS_SERVER_ROLE, self.is_server);
        let tls = TLSSocket::new(Some(Rc::clone(&self.handlers)));
        tls.protos
            .set(config.and_then(|c| c.protos_bytes().map(Box::<[u8]>::from)));
        tls.server_name
            .set(config.and_then(|c| c.server_name_bytes().map(Box::<[u8]>::from)));
        tls.flags.set(flags);
        tls
    }
}

/// Reject policy for an `upgradeTLS`/duplex socket: a parsed config wins.
fn upgrade_reject_policy(
    vm: &VirtualMachine,
    cfg: Option<&SSLConfig>,
    is_server: bool,
    ctx: Option<*mut SSL_CTX>,
) -> bool {
    if cfg.is_none() && is_server {
        server_ctx_rejects_unauthorized(ctx)
    } else {
        crate::socket::resolve_reject_unauthorized(vm, cfg, is_server)
    }
}

/// The policy a server-side `SSL_CTX` was built with: `us_ssl_ctx_from_options` sets
/// `FAIL_IF_NO_PEER_CERT` iff the context was created with `requestCert` and `rejectUnauthorized`.
pub(crate) fn server_ctx_rejects_unauthorized(ctx: Option<*mut SSL_CTX>) -> bool {
    let Some(ctx) = ctx else { return false };
    const MODE: c_int =
        boringssl_sys::SSL_VERIFY_PEER | boringssl_sys::SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
    // SAFETY: the caller holds a ref on `ctx` across the call; read-only.
    unsafe { boringssl_sys::SSL_CTX_get_verify_mode(ctx) & MODE == MODE }
}

pub(crate) fn server_ctx_requests_cert(ctx: Option<*mut SSL_CTX>) -> bool {
    let Some(ctx) = ctx else { return false };
    // SAFETY: the caller holds a ref on `ctx` across the call; read-only.
    unsafe { boringssl_sys::SSL_CTX_get_verify_mode(ctx) & boringssl_sys::SSL_VERIFY_PEER != 0 }
}

// ──────────────────────────────────────────────────────────────────────────
// SocketMode
// ──────────────────────────────────────────────────────────────────────────

/// Unified socket mode replacing the old is_server bool + TLSMode pair.
#[derive(Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum SocketMode {
    /// Default — TLS client or non-TLS socket
    Client,
    /// Listener-owned server. TLS (if any) configured at the listener level.
    Server,
}

impl SocketMode {
    /// Returns true for any mode that acts as a TLS server (ALPN, handshake direction).
    pub(crate) fn is_server(self) -> bool {
        self == SocketMode::Server
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free-standing host functions
// ──────────────────────────────────────────────────────────────────────────

/// node:tls's `tls.connect({ socket })` entry point: same upgrade as the
/// public `upgradeTLS`, but hostname policy stays with node's JS layer.
pub(crate) fn upgrade_tls_deferred<'a>(
    cx: &mut JsScope<'a>,
    socket: BunSocket<'a>,
    options: JsLocal<'a>,
) -> JsResult<JSValue> {
    match socket {
        BunSocket::Tcp(this) => {
            NewSocket::<false>::upgrade_tls_impl(this, cx.global(), options.to_js(), true)
        }
        BunSocket::Tls(this) => {
            NewSocket::<true>::upgrade_tls_impl(this, cx.global(), options.to_js(), true)
        }
    }
}

/// node:net's `destroy()`: drops the handshake flight held for the handshake callback.
pub(crate) fn release_held_flight(socket: SocketHandle<'_>) {
    match socket {
        // The raw half of an `upgradeTLS` pair shares the socket of its TLS half.
        SocketHandle::Tcp(this) => this.socket.get().release_held_flight(),
        SocketHandle::Tls(this) => this.socket.get().release_held_flight(),
        SocketHandle::Ignored(_) => {}
    }
}

/// node:tls with the built-in `checkServerIdentity`: `server_identity` refuses a wrong name like Bun.connect's.
pub(crate) fn check_server_identity_in_handshake(socket: SocketHandle<'_>, in_handshake: bool) {
    if let SocketHandle::Tls(this) = socket {
        this.update_flags(|f| f.set(Flags::DEFERS_SERVER_IDENTITY, !in_handshake));
    }
}

/// `tls.connect()`'s first 'connect' listener, where node sends the ClientHello.
pub(crate) fn first_flight_before_fin(socket: SocketHandle<'_>) {
    if let SocketHandle::Tls(this) = socket {
        this.socket.get().set_first_flight_before_fin();
    }
}

/// node:tls over a stream that has no descriptor to adopt. Returns the TLS socket and the listeners for the stream's 'data', 'end' and 'close'.
pub(crate) fn upgrade_duplex_to_tls<'a>(
    cx: &mut JsScope<'a>,
    duplex: JsLocal<'a>,
    options: JsLocal<'a>,
) -> JsResult<JSValue> {
    let global = cx.global();
    // The upgraded socket is the calling script's.
    let context = global.bun_vm().context_of_caller_no_frame();
    let options = UpgradeOptions::from_js(global, options.to_js(), false)?;
    // node:tls owns server-identity policy in its JS layer.
    let tls = options.new_socket(true);
    let tls_js_value = tls.get_this_value(global);
    TLSSocket::data_set_cached(tls_js_value, global, options.data);
    let server_verify = options.server_verify();
    // SAFETY: the engine takes over the ref `TLSSocket::new` returned.
    let engine_ref = unsafe { RefPtr::from_raw(tls.as_ptr()) };
    let engine = UpgradedDuplex::upgrade(
        global,
        context,
        duplex.to_js(),
        engine_ref,
        tls_js_value,
        options.ctx,
        !options.is_server,
        server_verify,
    );

    let array = JSValue::create_empty_array(global, 2)?;
    array.put_index(global, 0, tls_js_value)?;
    array.put_index(global, 1, engine.get_js_handlers(global)?)?;
    Ok(array)
}

pub(crate) fn is_named_pipe_socket(socket: SocketHandle<'_>) -> bool {
    match socket {
        SocketHandle::Tcp(this) => this.socket.get().is_transport(),
        SocketHandle::Tls(this) => this.socket.get().is_transport(),
        SocketHandle::Ignored(_) => false,
    }
}

pub(crate) fn get_buffered_amount(socket: SocketHandle<'_>) -> usize {
    match socket {
        SocketHandle::Tcp(this) => this.buffered_data_for_node_net.get().len(),
        SocketHandle::Tls(this) => this.buffered_data_for_node_net.get().len(),
        SocketHandle::Ignored(_) => 0,
    }
}

pub(crate) fn get_bytes_read(socket: SocketHandle<'_>) -> f64 {
    match socket {
        SocketHandle::Tcp(this) => this.total_bytes_read() as f64,
        SocketHandle::Tls(this) => this.total_bytes_read() as f64,
        SocketHandle::Ignored(_) => 0.0,
    }
}

#[bun_jsc::host_fn]
pub(crate) fn js_create_socket_pair(
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding!();

    #[cfg(windows)]
    {
        return Err(global.throw(format_args!("Not implemented on Windows")));
    }

    #[cfg(not(windows))]
    {
        let mut fds_: [libc::c_int; 2] = [0, 0];
        // SAFETY: libc FFI.
        let rc =
            unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, fds_.as_mut_ptr()) };
        if rc != 0 {
            let err = sys::Error::from_code(sys::get_errno(rc), sys::Tag::socketpair);
            return Err(global.throw_value(err.to_js(global)));
        }

        let _ = sys::update_nonblocking(sys::Fd::from_native(fds_[0]), true);
        let _ = sys::update_nonblocking(sys::Fd::from_native(fds_[1]), true);

        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(global, 0, JSValue::js_number(fds_[0] as f64))?;
        array.put_index(global, 1, JSValue::js_number(fds_[1] as f64))?;
        Ok(array)
    }
}

unsafe extern "C" {
    /// The socket of a `WebSocket` or of a node:http server socket's native handle. Null for
    /// anything else, and for one that isn't connected.
    safe fn Bun__usSocketForTesting(value: JSValue) -> *mut uws::us_socket_t;
}

/// `setSocketOptions(socket, 1 | 2, size)` of `bun:internal-for-testing`: SO_SNDBUF (1) or
/// SO_RCVBUF (2).
#[bun_jsc::host_fn]
pub(crate) fn js_set_socket_options(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 3 {
        return Err(global.throw_not_enough_arguments("setSocketOptions", 3, arguments.len()));
    }

    let target = arguments[0];
    let socket = if let Some(socket) = target.as_class_ref::<TCPSocket>() {
        socket.socket.get().socket.get()
    } else if let Some(socket) = target.as_class_ref::<TLSSocket>() {
        socket.socket.get().socket.get()
    } else if let Some(websocket) = target.as_class_ref::<ServerWebSocket>() {
        websocket.us_socket()
    } else {
        NonNull::new(Bun__usSocketForTesting(target)).map(NonNull::as_ptr)
    };
    let Some(socket) = socket else {
        return Err(global.throw(format_args!("Expected a connected socket")));
    };

    let is_recv = match arguments[1].to_int32() {
        1 => false,
        2 => true,
        _ => {
            return Err(global.throw(format_args!(
                "Expected 1 (send buffer) or 2 (receive buffer)"
            )));
        }
    };

    let mut value: c_int = 0;
    let res = uws::us_socket_t::opaque_mut(socket).buffer_size(
        is_recv,
        arguments[2].to_int32(),
        &mut value,
    );
    if let Some(err) = get_us_error::<true>(res, sys::Tag::setsockopt) {
        return Err(global.throw_value(err.to_js(global)));
    }

    Ok(JSValue::UNDEFINED)
}

pub(crate) mod testing_apis {
    use super::*;

    #[bun_jsc::host_fn]
    pub(crate) fn js_socket_fault_injection_available(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::from(cfg!(socket_fault_injection)))
    }

    /// Live `WindowsNamedPipe`s (one per connected or accepted socket
    /// over a Windows named pipe); always 0 elsewhere.
    #[bun_jsc::host_fn]
    pub(crate) fn js_named_pipe_live_count(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(windows)]
        let count = crate::socket::windows_named_pipe::LIVE_COUNT
            .load(core::sync::atomic::Ordering::Relaxed);
        #[cfg(not(windows))]
        let count = 0usize;
        Ok(JSValue::js_number(count as f64))
    }

    /// Live `UpgradedDuplex`es (one per TLS socket over a JS stream).
    #[bun_jsc::host_fn]
    pub(crate) fn js_upgraded_duplex_live_count(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let count =
            crate::socket::upgraded_duplex::LIVE_COUNT.load(core::sync::atomic::Ordering::Relaxed);
        Ok(JSValue::js_number(count as f64))
    }

    /// `sweepSocketTimers` of `bun:internal-for-testing`.
    #[bun_jsc::host_fn]
    pub(crate) fn js_sweep_socket_timers(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        let [count] = frame.arguments_as_array::<1>();
        let count = count.coerce::<i32>(global)?;
        let loop_ = uws::Loop::get();
        // SAFETY: `loop_` is this thread's live loop; plain field reads.
        let sweeping = unsafe {
            !(*loop_).internal_loop_data.iterator.is_null()
                || !(*loop_).internal_loop_data.low_prio_iterator.is_null()
        };
        if sweeping {
            return Err(global.throw(format_args!(
                "sweepSocketTimers() cannot be called from a socket timeout handler"
            )));
        }
        for _ in 0..count {
            // SAFETY: `loop_` is this thread's live loop and no sweep is running on it.
            unsafe { bun_uws_sys::loop_::us_internal_timer_sweep(loop_) };
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_clear_socket_faults(
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        #[cfg(socket_fault_injection)]
        {
            let _ = global;
            bun_uws_sys::fault_inject::us_fault_clear_all();
            Ok(JSValue::UNDEFINED)
        }
        #[cfg(not(socket_fault_injection))]
        Err(global.throw(format_args!(
            "socket fault injection was not compiled into this build (build with --socket-fault-injection=on)"
        )))
    }

    #[bun_jsc::host_fn]
    pub(crate) fn js_set_socket_fault(
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        #[cfg(not(socket_fault_injection))]
        {
            let _ = frame;
            return Err(global.throw(format_args!(
                "socket fault injection was not compiled into this build (build with --socket-fault-injection=on)"
            )));
        }
        #[cfg(socket_fault_injection)]
        {
            use bun_uws_sys::fault_inject as fi;

            let [opts] = frame.arguments_as_array::<1>();
            if !opts.is_object() {
                return Err(global.throw_invalid_argument_type_value("rule", "object", opts));
            }

            let syscall_str = match opts.get_truthy(global, "syscall")? {
                Some(v) => v.to_bun_string(global)?,
                None => {
                    return Err(global.throw_invalid_argument_type_value(
                        "rule.syscall",
                        "string",
                        JSValue::UNDEFINED,
                    ));
                }
            };
            let syscall: c_int = if syscall_str.eq_ascii(b"recv") {
                fi::RECV
            } else if syscall_str.eq_ascii(b"send") {
                fi::SEND
            } else if syscall_str.eq_ascii(b"writev") {
                fi::WRITEV
            } else if syscall_str.eq_ascii(b"sendmsg") {
                fi::SENDMSG
            } else if syscall_str.eq_ascii(b"recvmsg") {
                fi::RECVMSG
            } else if syscall_str.eq_ascii(b"connect") {
                fi::CONNECT
            } else if syscall_str.eq_ascii(b"accept") {
                fi::ACCEPT
            } else if syscall_str.eq_ascii(b"ssl_loop_buffer") {
                fi::SSL_LOOP_BUFFER
            } else if syscall_str.eq_ascii(b"poll_start") {
                fi::POLL_START
            } else if syscall_str.eq_ascii(b"session_buffer") {
                fi::SESSION_BUFFER
            } else if syscall_str.eq_ascii(b"ssl_write") {
                fi::SSL_WRITE
            } else {
                // socket/close/shutdown have enum slots but no bsd.c hooks;
                // accepting them would arm rules that can never fire.
                return Err(global.throw(format_args!(
                    "rule.syscall must be one of: recv, send, writev, sendmsg, recvmsg, connect, accept, ssl_loop_buffer, poll_start, session_buffer, ssl_write"
                )));
            };

            let action_str = match opts.get_truthy(global, "action")? {
                Some(v) => v.to_bun_string(global)?,
                None => {
                    return Err(global.throw_invalid_argument_type_value(
                        "rule.action",
                        "string",
                        JSValue::UNDEFINED,
                    ));
                }
            };
            let action: c_int = if action_str.eq_ascii(b"errno") {
                fi::ACTION_ERRNO
            } else if action_str.eq_ascii(b"short") {
                fi::ACTION_SHORT
            } else if action_str.eq_ascii(b"zero") {
                fi::ACTION_ZERO
            } else if action_str.eq_ascii(b"excess") {
                fi::ACTION_EXCESS
            } else if action_str.eq_ascii(b"none") {
                fi::ACTION_NONE
            } else {
                return Err(global.throw(format_args!(
                    "rule.action must be one of: errno, short, zero, excess, none"
                )));
            };

            // "short" clamps a byte count, which only these have; arming it on any other syscall would silently never fire.
            if action == fi::ACTION_SHORT
                && syscall != fi::RECV
                && syscall != fi::SEND
                && syscall != fi::WRITEV
            {
                return Err(global.throw(format_args!(
                    "rule.action \"short\" is only supported for syscall \"recv\", \"send\" or \"writev\""
                )));
            }

            // "zero" only has meaning where the wrapper returns a byte count
            // (EOF / backpressure); connect returns errno and accept returns a
            // descriptor, so a zero there is stale errno or nonsense.
            if action == fi::ACTION_ZERO
                && !matches!(
                    syscall,
                    fi::RECV | fi::SEND | fi::WRITEV | fi::SENDMSG | fi::RECVMSG
                )
            {
                return Err(global.throw(format_args!(
                    "rule.action \"zero\" is only supported for syscall \"recv\", \"send\", \"writev\", \"sendmsg\" or \"recvmsg\""
                )));
            }

            if action == fi::ACTION_EXCESS && syscall != fi::SEND && syscall != fi::WRITEV {
                return Err(global.throw(format_args!(
                    "rule.action \"excess\" is only supported for syscall \"send\" or \"writev\""
                )));
            }

            let errno_value: c_int = match opts.get_truthy(global, "errno")? {
                None if action == fi::ACTION_ERRNO => {
                    return Err(global.throw(format_args!(
                        "rule.errno is required when action is \"errno\""
                    )));
                }
                None => 0,
                Some(v) if v.is_number() => v.coerce_to_i32(global)?,
                Some(v) => {
                    let name = v.to_bun_string(global)?;
                    parse_errno_name(&name).ok_or_else(|| {
                        global.throw(format_args!(
                            "rule.errno: unknown errno name (use a numeric value or one of: ECONNRESET, EPIPE, ETIMEDOUT, ECONNREFUSED, EAGAIN, EWOULDBLOCK, EINTR, ENOBUFS, ENOMEM, EBADF, EINVAL, ENETUNREACH, EHOSTUNREACH, EPROTOTYPE)"
                        ))
                    })?
                }
            };

            let get_i32 = |key: &str, default: i32| -> JsResult<i32> {
                match opts.get_truthy(global, key)? {
                    Some(v) => v.coerce_to_i32(global),
                    None => Ok(default),
                }
            };

            let clamp_bytes = get_i32("bytes", 0)?;
            // A 0-byte clamp makes recv()/send() length-0 syscalls, which read
            // back as EOF/backpressure — silently aliasing action "zero".
            if action == fi::ACTION_SHORT && clamp_bytes <= 0 {
                return Err(global.throw(format_args!(
                    "rule.bytes must be > 0 when action is \"short\""
                )));
            }

            // ssl_loop_buffer/session_buffer are allocations, not socket
            // operations: their hooks pass fd = -1, so a rule pinned to a
            // descriptor would arm and then silently never fire.
            let target_fd = get_i32("fd", -1)?;
            if (syscall == fi::SSL_LOOP_BUFFER || syscall == fi::SESSION_BUFFER) && target_fd != -1
            {
                return Err(global.throw(format_args!(
                    "rule.fd is not supported for syscall \"{}\"",
                    if syscall == fi::SSL_LOOP_BUFFER {
                        "ssl_loop_buffer"
                    } else {
                        "session_buffer"
                    }
                )));
            }

            let rule = fi::UsFaultRule {
                action,
                errno_value,
                clamp_bytes,
                after_n_calls: get_i32("after", 0)?,
                repeat: get_i32("repeat", 1)?,
                target_fd,
            };

            // SAFETY: rule is a valid stack pointer for the duration of the call.
            unsafe { fi::us_fault_set(syscall, &rule) };
            Ok(JSValue::TRUE)
        }
    }

    #[cfg(socket_fault_injection)]
    fn parse_errno_name(name: &bun_core::String) -> Option<c_int> {
        macro_rules! map {
            ($($s:literal => $v:expr,)*) => {
                $(if name.eq_ascii($s) { return Some($v as c_int); })*
            };
        }
        #[cfg(unix)]
        map! {
            b"ECONNRESET" => libc::ECONNRESET,
            b"EPIPE" => libc::EPIPE,
            b"ETIMEDOUT" => libc::ETIMEDOUT,
            b"ECONNREFUSED" => libc::ECONNREFUSED,
            b"EAGAIN" => libc::EAGAIN,
            b"EWOULDBLOCK" => libc::EWOULDBLOCK,
            b"EINTR" => libc::EINTR,
            b"ENOBUFS" => libc::ENOBUFS,
            b"ENOMEM" => libc::ENOMEM,
            b"EBADF" => libc::EBADF,
            b"EINVAL" => libc::EINVAL,
            b"ENETUNREACH" => libc::ENETUNREACH,
            b"EHOSTUNREACH" => libc::EHOSTUNREACH,
            b"EPROTOTYPE" => libc::EPROTOTYPE,
            b"EMFILE" => libc::EMFILE,
            b"EPERM" => libc::EPERM,
        }
        #[cfg(windows)]
        map! {
            b"ECONNRESET" => 10054,
            b"EPIPE" => 10054,
            b"ETIMEDOUT" => 10060,
            b"ECONNREFUSED" => 10061,
            b"EAGAIN" => 10035,
            b"EWOULDBLOCK" => 10035,
            b"EINTR" => 10004,
            b"ENOBUFS" => 10055,
            b"ENOMEM" => 10055,
            b"EBADF" => 10009,
            b"EINVAL" => 10022,
            b"ENETUNREACH" => 10051,
            b"EHOSTUNREACH" => 10065,
            b"EPROTOTYPE" => 10041,
        }
        None
    }
}
pub(crate) use testing_apis as testing_ap_is;
