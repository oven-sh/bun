//! Port of `src/runtime/socket/socket.zig`.
//!
//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use bun_boringssl as boringssl;
use bun_io::KeepAlive;
use bun_jsc::JsCell;
use bun_ptr::IntrusiveRc;
// PORT NOTE: do NOT `use bun_boringssl_sys::SSL` here — it shadows the
// `const SSL: bool` generic param in `NewSocket<SSL>` below, making rustc
// resolve `<SSL>` as a type arg (E0747). Use the qualified path instead.
use bun_boringssl_sys::SSL_CTX;
use bun_collections::VecExt;
use bun_core::{self, fmt as bun_fmt};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsClass, JsError, JsRef, JsResult, Strong,
    SysErrorJsc, SystemError,
};
// `bun_jsc::VirtualMachine` is the *module* (alias of `virtual_machine`); name the
// struct directly so `VirtualMachine::get()` resolves as an associated fn.
use super::upgraded_duplex::{Handlers as UpgradedDuplexHandlers, UpgradedDuplex};
use crate::crypto::boringssl_jsc::err_to_js as boringssl_err_to_js;
use crate::node::{BlobOrStringOrBuffer, StringOrBuffer};
use crate::socket::{SSLConfig, SSLConfigFromJs};
use crate::webcore::blob::BlobExt;
use bun_boringssl_sys as boringssl_sys;
use bun_core::{self as bstr, String as BunString, ZStr, ZigString};
use bun_event_loop::AnyTask::AnyTask;
use bun_jsc::virtual_machine::VirtualMachine;
use bun_sys as sys;
use bun_uws as uws;

// `uws::NewSocketHandler::from_duplex` is now inherent on the canonical
// `bun_uws_sys::socket` impl; thin local wrapper that erases the concrete
// `runtime::socket::UpgradedDuplex` to the opaque `bun_uws_sys::UpgradedDuplex`
// handle (same allocation, different-crate newtype — see uws_sys/lib.rs §shim).
#[inline]
fn from_duplex<const SSL: bool>(duplex: &mut UpgradedDuplex) -> uws::NewSocketHandler<SSL> {
    uws::NewSocketHandler::<SSL>::from_duplex(std::ptr::from_mut::<UpgradedDuplex>(duplex).cast())
}

// ──────────────────────────────────────────────────────────────────────────
// Local NewSocketHandler address helpers (not yet in `bun_uws`)
// ──────────────────────────────────────────────────────────────────────────
//
// `bun_uws::NewSocketHandler` exposes `local_port`/`remote_port` but not the
// address accessors. The underlying `us_socket_t` already has them, so wrap
// with a small extension trait until they land upstream.
trait SocketHandlerAddrExt {
    fn local_address<'a>(&self, buf: &'a mut [u8]) -> Option<&'a [u8]>;
    fn remote_address<'a>(&self, buf: &'a mut [u8]) -> Option<&'a [u8]>;
}

// `bun_uws::NewSocketHandler` lacks pause/resume/nodelay/keepalive/is_named_pipe;
// the underlying `us_socket_t` already has them (uws_sys/us_socket_t.rs), so
// dispatch over `InternalSocket` here until they land upstream.
trait SocketHandlerStreamExt {
    fn resume_stream(&self) -> bool;
    fn pause_stream(&self) -> bool;
    fn set_no_delay(&self, enabled: bool) -> bool;
    fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool;
    fn is_named_pipe(&self) -> bool;
}
impl<const SSL: bool> SocketHandlerStreamExt for uws::NewSocketHandler<SSL> {
    fn resume_stream(&self) -> bool {
        match self.socket {
            uws::InternalSocket::Connected(s) => {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(s).resume();
                true
            }
            uws::InternalSocket::Detached => true,
            #[cfg(windows)]
            uws::InternalSocket::Pipe(p) => {
                // SAFETY: `Pipe` carries a non-null `*mut WindowsNamedPipe`
                // (type-erased in `bun_uws`); set by `WindowsNamedPipeContext`.
                unsafe {
                    (*p.cast::<super::windows_named_pipe::WindowsNamedPipe>()).resume_stream()
                }
            }
            _ => false,
        }
    }
    fn pause_stream(&self) -> bool {
        match self.socket {
            uws::InternalSocket::Connected(s) => {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(s).pause();
                true
            }
            uws::InternalSocket::Detached => true,
            #[cfg(windows)]
            uws::InternalSocket::Pipe(p) => {
                // SAFETY: see `resume_stream` above.
                unsafe { (*p.cast::<super::windows_named_pipe::WindowsNamedPipe>()).pause_stream() }
            }
            _ => false,
        }
    }
    fn set_no_delay(&self, enabled: bool) -> bool {
        match self.socket {
            uws::InternalSocket::Connected(s) => {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(s).set_nodelay(enabled);
                true
            }
            _ => false,
        }
    }
    fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool {
        match self.socket {
            uws::InternalSocket::Connected(s) => {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(s).set_keepalive(enabled, delay) == 0
            }
            _ => false,
        }
    }
    fn is_named_pipe(&self) -> bool {
        #[cfg(windows)]
        return matches!(self.socket, uws::InternalSocket::Pipe(_));
        #[cfg(not(windows))]
        return matches!(self.socket, uws::InternalSocket::Pipe);
    }
}
impl<const SSL: bool> SocketHandlerAddrExt for uws::NewSocketHandler<SSL> {
    fn local_address<'a>(&self, buf: &'a mut [u8]) -> Option<&'a [u8]> {
        match self.socket {
            uws::InternalSocket::Connected(s) => {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(s).local_address(buf).ok()
            }
            _ => None,
        }
    }
    fn remote_address<'a>(&self, buf: &'a mut [u8]) -> Option<&'a [u8]> {
        match self.socket {
            uws::InternalSocket::Connected(s) => {
                // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
                bun_opaque::opaque_deref_mut(s).remote_address(buf).ok()
            }
            _ => None,
        }
    }
}

/// Shorthand for the JS-side `EventLoopCtx` (replaces direct VM passing to
/// `KeepAlive::ref_/unref` — `bun_io` no longer accepts `&VirtualMachine`).
#[inline]
fn js_loop_ctx() -> bun_io::EventLoopCtx {
    bun_io::posix_event_loop::get_vm_ctx(bun_io::posix_event_loop::AllocatorType::Js)
}

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub use super::handlers::Handlers;
pub use super::handlers::SocketConfig;
pub use super::listener::Listener;
pub use super::socket_address::SocketAddress;
#[cfg(windows)]
pub use super::windows_named_pipe_context::WindowsNamedPipeContext;
#[cfg(not(windows))]
pub type WindowsNamedPipeContext = ();

mod tls_socket_functions;
use crate::api::bun::h2_frame_parser::H2FrameParser;
use crate::api::bun_secure_context::SecureContext;

bun_output::declare_scope!(Socket, visible);
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(Socket, $($arg)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// ALPN select callback
// ──────────────────────────────────────────────────────────────────────────

/// `SSL_CTX_set_alpn_select_cb` registers on the listener-level `SSL_CTX`, so
/// its `arg` is shared across every accepted connection — using it for a
/// per-connection `*TLSSocket` is a UAF when handshakes overlap. Read the
/// socket back from the per-SSL ex_data slot set in `onOpen` instead.
extern "C" fn select_alpn_callback(
    ssl: *mut bun_boringssl_sys::SSL,
    out: *mut *const u8,
    outlen: *mut u8,
    in_: *const u8,
    inlen: c_uint,
    _arg: *mut c_void,
) -> c_int {
    // BoringSSL never invokes the ALPN callback with a null `SSL*`; route
    // through the const-asserted opaque-ZST accessor so the call is safe.
    let this_ptr =
        tls_socket_functions::ffi::SSL_get_ex_data(boringssl_sys::SSL::opaque_ref(ssl), 0);
    if this_ptr.is_null() {
        return boringssl_sys::SSL_TLSEXT_ERR_NOACK;
    }
    // SAFETY: ex_data slot 0 holds a `*mut TLSSocket` (set in on_open).
    let this: &TLSSocket = unsafe { &*this_ptr.cast::<TLSSocket>() };
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
///
/// In Zig this is `fn NewSocket(comptime ssl: bool) type { return struct {...} }`.
// PORT NOTE: `#[bun_jsc::JsClass]` cannot be applied here — the proc-macro
// emits monomorphic `impl JsClass for NewSocket` (no generics) and a single
// set of `${Name}__fromJS`/`__create` externs, but this type maps to TWO
// codegen classes (`JSTCPSocket` / `JSTLSSocket`). The codegen accessors are
// hand-dispatched per-monomorphisation in the `impl` block below instead.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut NewSocket` until Phase 1 lands — `&mut T`
// auto-derefs to `&T` so the impls below compile against either. With every
// mutated field behind `UnsafeCell`, `&NewSocket` carries no LLVM `noalias`
// for those fields, so a re-entrant `socket.write()`/`socket.end()` (which
// re-derives `&Self` from `m_ctx`) cannot be miscompiled by a stale cached
// load — the systemic fix vs the per-method `black_box` launder previously
// applied in `internal_flush`.
#[repr(C)]
pub struct NewSocket<const SSL: bool> {
    pub socket: Cell<uws::NewSocketHandler<SSL>>,
    /// `SSL_CTX*` this client connection was opened with. One owned ref —
    /// `SSL_CTX_free` on deinit. Server-accepted sockets and plain TCP
    /// leave this `None` (the Listener / SecureContext owns the ref there).
    pub owned_ssl_ctx: Cell<Option<*mut SSL_CTX>>,

    pub flags: Cell<Flags>,
    pub ref_count: bun_ptr::RefCount<Self>, // intrusive — see `bun_ptr::IntrusiveRc<Self>`
    // Zig: `handlers: ?*Handlers` — a freely-aliased mutable raw pointer.
    //
    // OWNERSHIP: in **server** mode this points at `&mut listener.handlers`
    // (the embedded `Listener.handlers` field — Listener.rs:34) so
    // `container_of`-style offset arithmetic in `get_listener` and
    // `Handlers::mark_inactive` can recover the parent `Listener`. In
    // **client** mode it is `heap::alloc(Box::new(Handlers))` and
    // `Handlers::mark_inactive` frees it via `heap::take` once the last
    // connection drops.
    //
    // ALIASING: this is intentionally a raw pointer, NOT `&mut`/`Rc`/
    // `Box`. JS dispatch is reentrant (`socket.reload()` overwrites the
    // pointee while a callback frame still holds the pointer), so Rust's
    // `&mut` exclusivity cannot be upheld across `callback.call()`. A raw
    // pointer carries no aliasing guarantee to violate; callers reborrow
    // `unsafe { &mut *p }` only for the exact field access they need and
    // never across a reentrant JS call. See `get_handlers` for the access
    // contract.
    pub handlers: Cell<Option<NonNull<Handlers>>>,
    /// Reference to the JS wrapper. Held strong while the socket is active so the
    /// wrapper cannot be garbage-collected out from under in-flight callbacks, and
    /// downgraded to weak once the socket is closed/inactive so GC can reclaim it.
    pub this_value: JsCell<JsRef>,
    pub poll_ref: JsCell<KeepAlive>,
    pub ref_pollref_on_connect: Cell<bool>,
    pub connection: JsCell<Option<super::listener::UnixOrHost>>,
    pub protos: JsCell<Option<Box<[u8]>>>,
    pub server_name: JsCell<Option<Box<[u8]>>>,
    pub buffered_data_for_node_net: JsCell<Vec<u8>>,
    pub bytes_written: Cell<u64>,

    pub native_callback: JsCell<NativeCallbacks>,
    /// `upgradeTLS` produces two `TLSSocket` wrappers over one
    /// `us_socket_t` (the encrypted view + the raw-bytes view node:net
    /// expects at index 0). The encrypted half holds a ref on the raw half
    /// here so a single `onClose` can retire both — no `Handlers.clone()`,
    /// no second context.
    // PORT NOTE: LIFETIMES.tsv says `Option<Rc<Self>>`, but `*Self` is stored in
    // a uws ext slot (FFI) and is intrusively refcounted — PORTING.md mandates
    // IntrusiveRc, never Rc, when *T crosses FFI.
    pub twin: JsCell<Option<IntrusiveRc<Self>>>,
}

/// Associated `Socket` handler type (Zig: `pub const Socket = uws.NewSocketHandler(ssl)`).
pub type SocketHandler<const SSL: bool> = uws::NewSocketHandler<SSL>;

// Intrusive refcount mixin (Zig: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`).
impl<const SSL: bool> bun_ptr::RefCounted for NewSocket<SSL> {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut bun_ptr::RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Self.
        unsafe { &raw mut (*this).ref_count }
    }
    unsafe fn destructor(this: *mut Self, _ctx: ()) {
        // SAFETY: refcount reached zero; we are the unique owner of the
        // `heap::alloc` allocation and `this` is not used after.
        unsafe { Self::deinit_and_destroy(this) };
    }
}

impl<const SSL: bool> NewSocket<SSL> {
    // TODO(port): `pub const js = if (!ssl) jsc.Codegen.JSTCPSocket else jsc.Codegen.JSTLSSocket`
    // — codegen module accessor. `#[bun_jsc::JsClass]` derive provides
    // `to_js`/`from_js`/`from_js_direct`. `dataSetCached`/`dataGetCached` are
    // emitted as `Self::data_set_cached` / `Self::data_get_cached`.

    // ─── R-2 interior-mutability helpers ─────────────────────────────────────

    /// Read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// `self`'s address as `*mut Self` for uSockets ext slots / refcount FFI.
    /// All mutated fields are `UnsafeCell`-backed, so the `*mut` spelling is
    /// purely to match C signatures; callbacks deref it as `&*const` (shared).
    #[inline]
    pub fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    // ─────────────────────────────────────────────────────────────────────────

    // Intrusive refcount API (Zig: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`).
    pub fn ref_(&self) {
        // SAFETY: `self` is live; `RefCount::ref_` only reads/writes the
        // embedded `ref_count` Cell (interior-mutable), so `&self`→`*mut`
        // is sound for that access.
        unsafe { bun_ptr::RefCount::<Self>::ref_(self.as_ctx_ptr()) };
    }
    // R-2: takes `&self` — every mutated field is `UnsafeCell`-backed so the
    // `*mut Self` formed for `RefCount::deref` (and onward into
    // `deinit_and_destroy`) writes only through interior-mutable storage. The
    // codegen host-fn shim still hands us a `&mut Self`-derived borrow whose
    // root provenance is the heap allocation, so `heap::take` in the
    // destructor remains valid.
    pub fn deref(&self) {
        // SAFETY: `self` is live; if count hits 0, `RefCounted::destructor`
        // (→ `deinit_and_destroy`) runs and `self` is not used after.
        unsafe { bun_ptr::RefCount::<Self>::deref(self.as_ctx_ptr()) };
    }

    // ── codegen accessors (Zig: `pub const js = if (!ssl) jsc.Codegen.JSTCPSocket else jsc.Codegen.JSTLSSocket`) ──
    // `#[bun_jsc::JsClass]` can't express the per-monomorphisation symbol
    // dispatch, so these hand-roll the `if (ssl) js_TLSSocket else js_TCPSocket`
    // split and route through the codegen'd safe wrappers.
    pub fn to_js(&self, global: &JSGlobalObject) -> JSValue {
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
    pub fn data_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        jsc::mark_binding!();
        if SSL {
            js_TLSSocket::data_set_cached(this, global, value);
        } else {
            js_TCPSocket::data_set_cached(this, global, value);
        }
    }
    pub fn data_get_cached(this: JSValue) -> Option<JSValue> {
        jsc::mark_binding!();
        if SSL {
            js_TLSSocket::data_get_cached(this)
        } else {
            js_TCPSocket::data_get_cached(this)
        }
    }

    pub fn new(init: Self) -> *mut Self {
        bun_core::heap::into_raw(Box::new(init))
    }

    pub fn memory_cost(&self) -> usize {
        // Per-socket SSL state (SSL*, BIO pair, handshake buffers) is ~40 KB
        // off-heap. Reporting it lets the GC apply pressure when JS churns
        // through short-lived TLS connections. The raw `[raw, tls]` upgrade
        // twin shares the same SSL* — only the encrypted half reports it.
        let ssl_cost: usize = if SSL && !self.flags.get().contains(Flags::BYPASS_TLS) {
            40 * 1024
        } else {
            0
        };
        core::mem::size_of::<Self>()
            + self.buffered_data_for_node_net.get().capacity() as usize
            + ssl_cost
    }

    pub fn attach_native_callback(&self, callback: NativeCallbacks) -> bool {
        if !matches!(self.native_callback.get(), NativeCallbacks::None) {
            return false;
        }
        // Zig `h2.ref()` — IntrusiveRc holds the +1 by construction (caller
        // passes ownership of the handle), so no explicit inc here.
        self.native_callback.set(callback);
        true
    }

    pub fn detach_native_callback(&self) {
        let native_callback = self.native_callback.replace(NativeCallbacks::None);
        match native_callback {
            NativeCallbacks::H2(h2) => {
                // `RefPtr: Deref<Target = H2FrameParser>`; `on_native_close`
                // takes `&self`, so no raw-pointer reach-through is needed.
                h2.on_native_close();
                // Zig `h2.deref()` — IntrusiveRc::drop decrements.
                drop(h2);
            }
            NativeCallbacks::None => {}
        }
    }

    /// Connect to `self.connection` (must be `Some`). Reads the field directly
    /// rather than taking it by-ref so the single caller in `connect_finish`
    /// doesn't need a disjoint borrow (the Zig original satisfied this via an
    /// aliased pointer read).
    pub fn do_connect(&self) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        // Zig: `this.ref(); defer this.deref();` — keep `self` alive across the
        // re-entrant connect path. `ScopedRef` stores a raw `*mut Self` (no
        // borrow held across the body) and derefs on Drop.
        // SAFETY: `self` is live until guard drop; all writes go through
        // interior-mutable cells.
        let _guard = unsafe { bun_ptr::ScopedRef::new(self.as_ctx_ptr()) };
        // Stash the raw `*mut Self` for the uSockets ext slot.
        let self_ptr: *mut Self = self.as_ctx_ptr();

        let vm = self.get_handlers().vm;
        // SAFETY: per-thread VM singleton; `VirtualMachine::get()` yields the
        // canonical `*mut` (write provenance) — never derive `&mut` from the
        // `&'static` borrow stored on Handlers (that's `invalid_reference_casting`).
        // No aliasing `&mut` held across the `rare_data()` borrow — `vm`
        // reborrowed immutably for the 2nd arg.
        let group = VirtualMachine::get()
            .as_mut()
            .rare_data()
            .bun_connect_group::<SSL>(vm);
        let kind: uws::SocketKind = if SSL {
            uws::SocketKind::BunSocketTls
        } else {
            uws::SocketKind::BunSocketTcp
        };
        let flags: i32 = if self.flags.get().contains(Flags::ALLOW_HALF_OPEN) {
            uws::LIBUS_SOCKET_ALLOW_HALF_OPEN
        } else {
            0
        };
        let ssl_ctx: Option<*mut uws::SslCtx> = if SSL {
            self.owned_ssl_ctx.get().map(|p| p.cast::<uws::SslCtx>())
        } else {
            None
        };

        use super::listener::UnixOrHost;
        match self.connection.get() {
            Some(UnixOrHost::Host { host, port }) => {
                // PERF(port): was stack-fallback alloc — profile in Phase B.
                // getaddrinfo doesn't accept bracketed IPv6.
                let raw: &[u8] = host;
                let clean = if raw.len() > 1 && raw[0] == b'[' && raw[raw.len() - 1] == b']' {
                    &raw[1..raw.len() - 1]
                } else {
                    raw
                };
                let hostz = bun_core::ZBox::from_bytes(clean);
                let port = *port;
                // `host` borrow ends here; `self.connection` no longer borrowed.
                // `ZBox` guarantees a trailing NUL; host bytes contain no interior NUL.
                let host_c = hostz.as_zstr().as_cstr();

                self.socket.set(
                    match group.connect(
                        kind,
                        ssl_ctx,
                        host_c,
                        c_int::from(port),
                        flags,
                        core::mem::size_of::<*mut c_void>() as c_int,
                    ) {
                        uws::ConnectResult::Failed => {
                            return Err(bun_core::err!("FailedToOpenSocket"));
                        }
                        uws::ConnectResult::Socket(s) => {
                            // SAFETY: ext slot is sized for `*mut Self`.
                            unsafe { *(*s).ext::<*mut Self>() = self_ptr };
                            SocketHandler::<SSL>::from(s)
                        }
                        uws::ConnectResult::Connecting(c) => {
                            // SAFETY: ext slot is sized for `*mut Self`.
                            unsafe { *(*c).ext::<*mut Self>() = self_ptr };
                            SocketHandler::<SSL>::from_connecting(c)
                        }
                    },
                );
            }
            Some(UnixOrHost::Unix(u)) => {
                // PERF(port): was stack-fallback alloc — profile in Phase B.
                let s = group.connect_unix(
                    kind,
                    ssl_ctx,
                    u,
                    flags,
                    core::mem::size_of::<*mut c_void>() as c_int,
                );
                if s.is_null() {
                    return Err(bun_core::err!("FailedToOpenSocket"));
                }
                // SAFETY: ext slot is sized for `*mut Self`.
                unsafe { *(*s).ext::<*mut Self>() = self_ptr };
                self.socket.set(SocketHandler::<SSL>::from(s));
            }
            Some(UnixOrHost::Fd(f)) => {
                // `LIBUS_SOCKET_DESCRIPTOR` is `c_int` on POSIX, `SOCKET`
                // (`usize`) on Windows; `Fd::native()` is `c_int` / HANDLE
                // (`*mut c_void`) respectively. The Zig spec passes
                // `f.native()` verbatim (Zig's descriptor type *is*
                // `*anyopaque`); cast to bridge the Rust-side `usize` alias.
                let s = group.from_fd(
                    kind,
                    ssl_ctx,
                    core::mem::size_of::<*mut c_void>() as c_int,
                    f.native() as uws::LIBUS_SOCKET_DESCRIPTOR,
                    false,
                );
                if s.is_null() {
                    return Err(bun_core::err!("ConnectionFailed"));
                }
                // SAFETY: ext slot is sized for `*mut Self`.
                unsafe { *(*s).ext::<*mut Self>() = self_ptr };
                let sock = SocketHandler::<SSL>::from(s);
                self.socket.set(sock);
                // SAFETY: the `&self.connection` match borrow has ended (NLL —
                // `f` is unused past `from_fd`); `self_ptr` is the live
                // `*mut Self`. `on_open` takes `*mut Self` (noalias re-entrancy).
                unsafe { Self::on_open(self_ptr, sock) };
            }
            None => unreachable!("do_connect requires self.connection to be set"),
        }
        Ok(())
    }

    // PORT NOTE: no `#[bun_jsc::host_fn]` here — that macro's free-fn shim
    // emits a bare `constructor(...)` call which doesn't resolve inside an
    // `impl<const SSL: bool>` block. The codegen `JsClass` derive owns the
    // constructor link name, so the placeholder shim isn't needed.
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global.throw(format_args!("Cannot construct Socket")))
    }

    #[bun_jsc::host_fn(method)]
    pub fn resume_from_js(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        log!("resume");
        // The raw half of an upgradeTLS pair is an observation tap; flow
        // control belongs to the TLS half. Pausing the shared fd here would
        // wedge the TLS read path (#15438).
        if this.flags.get().contains(Flags::BYPASS_TLS) {
            return Ok(JSValue::UNDEFINED);
        }
        if this.flags.get().contains(Flags::IS_PAUSED) {
            let resumed = this.socket.get().resume_stream();
            this.update_flags(|f| f.set(Flags::IS_PAUSED, !resumed));
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pause_from_js(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        log!("pause");
        if this.flags.get().contains(Flags::BYPASS_TLS) {
            return Ok(JSValue::UNDEFINED);
        }
        if !this.flags.get().contains(Flags::IS_PAUSED) {
            let paused = this.socket.get().pause_stream();
            this.update_flags(|f| f.set(Flags::IS_PAUSED, paused));
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_keep_alive(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old::<2>();

        let enabled: bool = if args.len >= 1 {
            args.ptr[0].to_boolean()
        } else {
            false
        };

        let initial_delay: u32 = if args.len > 1 {
            // TODO(port): `JSGlobalObject::validate_integer_range` is gated
            // `bun_sql_jsc` extension-trait port until it's un-gated.
            use bun_sql_jsc::jsc::JSGlobalObjectSqlExt as _;
            u32::try_from(global.validate_integer_range(
                args.ptr[1],
                0i32,
                bun_sql_jsc::jsc::IntegerRange {
                    min: 0,
                    field_name: b"initialDelay",
                    ..Default::default()
                },
            )?)
            .unwrap()
        } else {
            0
        };
        log!("setKeepAlive({}, {})", enabled, initial_delay);

        Ok(JSValue::from(
            this.socket.get().set_keep_alive(enabled, initial_delay),
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_no_delay(
        this: &Self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old::<1>();
        let enabled: bool = if args.len >= 1 {
            args.ptr[0].to_boolean()
        } else {
            true
        };
        log!("setNoDelay({})", enabled);

        Ok(JSValue::from(this.socket.get().set_no_delay(enabled)))
    }

    pub fn handle_error(&self, err_value: JSValue) {
        log!("handleError");
        let handlers = self.get_handlers();
        let vm = handlers.vm;
        if vm.is_shutting_down() {
            return;
        }
        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);
        // TODO(port): errdefer — `scope.exit()` returns true when handlers freed
        let global = handlers.global_object;
        let this_value = self.get_this_value(&global);
        let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
        if scope.exit() {
            self.handlers.set(None);
        }
    }

    /// PORT NOTE (noalias re-entrancy): takes `this: *mut Self`, NOT
    /// `&mut self`. `callback.call(...)` re-enters JS which can call
    /// `socket.write()`/`socket.end()`/`socket.reload()` on this same wrapper
    /// via the JS object's `m_ptr`, re-deriving a `&mut NewSocket` and mutating
    /// `flags`/`handlers`/`ref_count`/`buffered_data_for_node_net`. A live
    /// noalias `&mut self` across that call lets LLVM cache those fields and
    /// dead-store the re-entrant write (and is plain aliasing UB). Each
    /// `(*this).foo()` materialises a short-lived borrow scoped to one
    /// statement; none span `callback.call`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket` (uws dispatch contract: the ext
    /// slot holds the unique heap allocation); JS-thread only.
    pub unsafe fn on_writable(this: *mut Self, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        // SAFETY (whole body): per fn contract; R-2 — every field is
        // `Cell`/`JsCell`, so a single shared reborrow is sufficient and no
        // borrow spans `callback.call`.
        let this: &Self = unsafe { &*this };
        if this.socket.get().is_detached() {
            return;
        }
        if this.native_callback.get().on_writable() {
            return;
        }
        let handlers = this.get_handlers();
        let callback = handlers.on_writable;
        if callback.is_empty() {
            return;
        }

        let vm = handlers.vm;
        if vm.is_shutting_down() {
            return;
        }
        this.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end instead of `defer`.
        this.internal_flush();
        log!(
            "onWritable buffered_data_for_node_net {}",
            this.buffered_data_for_node_net.get().len()
        );
        // is not writable if we have buffered data or if we are already detached
        if this.buffered_data_for_node_net.get().len() > 0 || this.socket.get().is_detached() {
            this.deref();
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            this.handlers.set(None);
        }
        this.deref();
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_timeout(this: *mut Self, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        // SAFETY (whole body): per fn contract; R-2 shared reborrow.
        let this: &Self = unsafe { &*this };
        if this.socket.get().is_detached() {
            return;
        }
        let handlers = this.get_handlers();
        log!(
            "onTimeout {}",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            }
        );
        let callback = handlers.on_timeout;
        if callback.is_empty() || this.flags.get().contains(Flags::FINALIZING) {
            return;
        }
        if handlers.vm.is_shutting_down() {
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            this.handlers.set(None);
        }
    }

    /// Zig `getHandlers(this) *Handlers` — returns the raw, freely-aliased
    /// pointer. **Do not** materialise a long-lived `&mut Handlers` from this
    /// across any `callback.call(...)` / `resolve_promise` / `reject_promise`
    /// boundary: JS may synchronously reenter `socket.reload()` which
    /// `drop_in_place`s + `ptr::write`s the pointee, invalidating any
    /// outstanding `&mut` under Stacked Borrows. Reborrow `unsafe { &mut *p }`
    /// per field access (or re-derive after every reentrant call) instead.
    ///
    /// Server-mode: the returned pointer addresses the embedded
    /// `Listener.handlers` field, so `container_of` arithmetic on it is
    /// valid. Client-mode: the pointer is a `heap::alloc` allocation that
    /// `Handlers::mark_inactive` may free — callers null `self.handlers` when
    /// `mark_inactive`/`scope.exit()` returns `true`.
    ///
    /// Returned as a [`BackRef`](bun_ptr::BackRef) so the ~40 read-only field
    /// projections at call sites go through `Deref` (one short-lived `&Handlers`
    /// per expression — same Stacked-Borrows footprint as the previous manual
    /// `unsafe { (*p).field }`). Mutating sites use `.as_ptr()` and reborrow
    /// `&mut` explicitly.
    pub fn get_handlers(&self) -> bun_ptr::BackRef<Handlers> {
        self.handlers
            .get()
            .expect("No handlers set on Socket")
            .into()
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable` —
    /// `callback.call`/`reject` re-enter JS which can `connectInner()`/mutate
    /// this socket via `m_ptr` (node:net `autoSelectFamily` retries inside the
    /// `connectError` callback).
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn handle_connect_error(this: *mut Self, errno: c_int) -> JsResult<()> {
        // SAFETY (whole body): per fn contract; R-2 — shared reborrow, all
        // mutated fields are `Cell`/`JsCell`.
        let this: &Self = unsafe { &*this };
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
        // Ensure the socket is still alive for any defer's we have
        this.ref_();
        // PORT NOTE: Zig's first `defer this.deref()` is declared here, before
        // clear_and_free/unrefOnNextTick — keep it as its own guard so the
        // ref_() above is balanced even if those calls unwind.
        let _outer_deref = scopeguard::guard(this.as_ctx_ptr(), |p| {
            // SAFETY: `p` is the live `*mut Self`; shared reborrow, fields celled.
            unsafe { (*p).deref() };
        });
        // PORT NOTE: reshaped for borrowck — explicit cleanup at end of fn.
        this.buffered_data_for_node_net
            .with_mut(|b| b.clear_and_free());

        let needs_deref = !this.socket.get().is_detached();
        this.socket.set(SocketHandler::<SSL>::DETACHED);

        let vm = handlers.vm;
        let _ = vm;
        this.poll_ref
            .with_mut(|p| p.unref_on_next_tick(js_loop_ctx()));

        // TODO(port): errdefer — `defer markInactive()` + `defer if (needs_deref) deref()`
        // moved to a guard so all early-returns run them. The outer
        // `_outer_deref` above owns the final `deref()`; LIFO drop order
        // (cleanup → _outer_deref) mirrors Zig's three defers exactly.
        let cleanup = scopeguard::guard((this.as_ctx_ptr(), needs_deref), |(p, nd)| {
            // SAFETY: `p` is the live `*mut Self`; shared reborrow, fields celled.
            unsafe {
                // Zig defer order (reverse-declaration): needs_deref → markInactive.
                if nd {
                    (*p).deref();
                }
                (*p).mark_inactive();
            }
        });

        if vm.is_shutting_down() {
            drop(cleanup);
            return Ok(());
        }

        debug_assert!(errno >= 0);
        let mut errno_: c_int = if errno == sys::SystemErrno::ENOENT as c_int {
            sys::SystemErrno::ENOENT as c_int
        } else {
            sys::SystemErrno::ECONNREFUSED as c_int
        };
        let code_ = if errno == sys::SystemErrno::ENOENT as c_int {
            BunString::static_("ENOENT")
        } else {
            BunString::static_("ECONNREFUSED")
        };
        #[cfg(windows)]
        {
            if errno_ == sys::SystemErrno::ENOENT as c_int {
                errno_ = sys::SystemErrno::UV_ENOENT as c_int;
            }
            if errno_ == sys::SystemErrno::ECONNREFUSED as c_int {
                errno_ = sys::SystemErrno::UV_ECONNREFUSED as c_int;
            }
        }

        let callback = handlers.on_connect_error;
        let global = handlers.global_object;
        let err = SystemError {
            errno: -errno_,
            message: BunString::static_("Failed to connect"),
            syscall: BunString::static_("connect"),
            code: code_,
            path: BunString::EMPTY,
            hostname: BunString::EMPTY,
            fd: c_int::MIN,
            dest: BunString::EMPTY,
        };

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = Handlers::enter_ref(handlers);
        // PORT NOTE: `let _ = guard` would drop *immediately* (end of
        // statement, not end of scope) and run `scope.exit()` before the
        // user's onConnectError callback. Bind to a named `_`-prefixed
        // local so it lives to end of scope like Zig's `defer`.
        let _scope_guard = scopeguard::guard((this.as_ctx_ptr(), scope), |(p, mut sc)| {
            if sc.exit() {
                // Connection never opened (`is_active == false`), so the
                // scope's decrement is what brings client handlers to zero
                // and frees them. Null the field so a retry via
                // `connectInner` doesn't double-free.
                // SAFETY: `p` is the live `*mut Self`.
                unsafe { (*p).handlers.set(None) };
            }
        });

        if callback.is_empty() {
            // Connection failed before open; allow the wrapper to be GC'd
            // regardless of whether this path is promise-backed (e.g. the
            // duplex TLS upgrade flow has no connect promise).
            if !matches!(this.this_value.get(), JsRef::Finalized) {
                this.this_value.with_mut(|r| r.downgrade());
            }
            // BackRef Deref → `&Handlers`; `promise: JsCell<Strong>` so the
            // swap/deinit go through interior mutability — no `&mut Handlers`
            // held across the reentrant `reject` below.
            if let Some(promise) = handlers.promise.with_mut(|p| p.try_swap()) {
                handlers.promise.with_mut(|p| p.deinit());

                // reject the promise on connect() error
                let js_promise: *mut jsc::JSPromise = promise.as_promise().unwrap();
                // SAFETY: `as_promise` returned non-null; promise lives for this call.
                let err_value =
                    err.to_error_instance_with_async_stack(&global, unsafe { &*js_promise });
                // SAFETY: same — `reject` takes &mut self.
                unsafe { (*js_promise).reject(&global, Ok(err_value)) }?;
            }

            return Ok(());
        }

        let this_value = this.get_this_value(&global);
        this_value.ensure_still_alive();
        // Connection failed before open; allow the wrapper to be GC'd once this
        // callback returns. The on-stack `this_value` keeps it alive for the call.
        this.this_value.with_mut(|r| r.downgrade());

        let err_value = err.to_error_instance(&global);
        let result = match callback.call(&global, this_value, &[this_value, err_value]) {
            Ok(v) => v,
            Err(e) => global.take_exception(e),
        };

        if let Some(err_val) = result.to_error() {
            // TODO: properly propagate exception upwards
            if handlers.reject_promise(err_val).unwrap_or(true) {
                return Ok(());
            }
            let _ = handlers.call_error_handler(this_value, &[this_value, err_val]);
        } else if let Some(val) = handlers.promise.with_mut(|p| p.try_swap()) {
            // They've defined a `connectError` callback
            // The error is effectively handled, but we should still reject the promise.
            // UFCS so rustc can back-infer `val: JSValue` even if the
            // `promise` field's `try_swap()` resolution is in flux upstream.
            let promise = jsc::JSPromise::opaque_mut(JSValue::as_promise(val).unwrap());
            let err_ = err.to_error_instance_with_async_stack(&global, promise);
            promise.reject_as_handled(&global, err_)?;
        }

        // `_scope_guard` (declared after `cleanup`) drops first → scope.exit();
        // then `cleanup` → needs_deref/markInactive/deref. Matches Zig defer LIFO.
        Ok(())
    }

    /// `*mut Self` for the same noalias-reentry reason as `handle_connect_error`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_connect_error(
        this: *mut Self,
        _socket: SocketHandler<SSL>,
        errno: c_int,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        // SAFETY: per fn contract.
        unsafe { Self::handle_connect_error(this, errno) }
    }

    pub fn mark_active(&self) {
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

    pub fn close_and_detach(&self, code: uws::CloseCode) {
        let socket = self.socket.get();
        self.buffered_data_for_node_net
            .with_mut(|b| b.clear_and_free());

        self.socket.set(SocketHandler::<SSL>::DETACHED);
        self.detach_native_callback();

        socket.close(code);
    }

    pub fn mark_inactive(&self) {
        if self.flags.get().contains(Flags::IS_ACTIVE) {
            // we have to close the socket before the socket context is closed
            // otherwise we will get a segfault
            // uSockets will defer freeing the TCP socket until the next tick
            if !self.socket.get().is_closed() {
                self.close_and_detach(uws::CloseCode::Normal);
                // onClose will call markInactive again
                return;
            }

            self.update_flags(|f| f.remove(Flags::IS_ACTIVE));
            // Allow the JS wrapper to be GC'd now that the socket is idle.
            // Do this before touching `handlers`: in client mode
            // `handlers.markInactive()` frees the Handlers allocation
            // entirely, and for the last server-side connection on a
            // stopped listener it releases the listener's own strong ref.
            if !matches!(self.this_value.get(), JsRef::Finalized) {
                self.this_value.with_mut(|r| r.downgrade());
            }
            // During VM shutdown, the Listener (which embeds `handlers`
            // for server sockets) may already have been finalized by the
            // time a deferred `onClose` → `markInactive` reaches here,
            // leaving `this.handlers` dangling. Active-connection
            // bookkeeping is irrelevant once the process is exiting, so
            // just release the event-loop ref and stop.
            let vm = VirtualMachine::get();
            // SAFETY: VM singleton is always live once initialized.
            if unsafe { (*vm).is_shutting_down() } {
                self.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));
                return;
            }
            let handlers = self.get_handlers();
            // SAFETY: server-mode `handlers` points at the embedded
            // `Listener.handlers` field, so `mark_inactive`'s
            // `container_of` arithmetic is valid; client-mode it is the
            // `heap::alloc` allocation `mark_inactive` frees in place.
            if unsafe { Handlers::mark_inactive(handlers.as_ptr()) } {
                // Client-mode handlers are allocated per-connection and
                // `Handlers.markInactive` just freed them. Null the field
                // so `connectInner` (net.Socket reconnect path) and
                // `getListener` don't dereference/destroy freed memory.
                self.handlers.set(None);
            }
            self.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));
        }
    }

    pub fn is_server(&self) -> bool {
        // `handlers` is null on detached sockets and on closed client
        // sockets (markInactive nulls it once the allocation is freed).
        // JS-callable TLS accessors (`setServername`, `getPeerCertificate`,
        // `getEphemeralKeyInfo`, `setVerifyMode`) consult this on sockets
        // whose connection may already be gone.
        let Some(handlers) = self.handlers.get() else {
            return false;
        };
        bun_ptr::BackRef::from(handlers).mode.is_server()
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable` —
    /// `resolve_promise`/`callback.call` re-enter JS which can mutate this
    /// socket via `m_ptr`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_open(this: *mut Self, socket: SocketHandler<SSL>) {
        // SAFETY (whole body): per fn contract; R-2 — shared reborrow, all
        // mutated fields are `Cell`/`JsCell`.
        let this_ptr = this;
        let this: &Self = unsafe { &*this };
        log!(
            "onOpen {} {:p} {} {}",
            if this.is_server() { "S" } else { "C" },
            this_ptr,
            this.socket.get().is_detached(),
            this.ref_count.get()
        );
        // Ensure the socket remains alive until this is finished
        this.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end.

        // update the internal socket instance to the one that was just connected
        // This socket must be replaced because the previous one is a connecting socket not a uSockets socket
        this.socket.set(socket);
        jsc::mark_binding!();

        // Add SNI support for TLS (mongodb and others requires this)
        if SSL {
            if let Some(ssl_ptr) = this.socket.get().ssl() {
                if tls_socket_functions::ffi::SSL_is_init_finished(boringssl_sys::SSL::opaque_ref(
                    ssl_ptr,
                )) == 0
                {
                    if let Some(server_name) = this.server_name.get() {
                        let host: &[u8] = server_name.as_ref();
                        if !host.is_empty() {
                            let host_z = bun_core::ZBox::from_bytes(host);
                            // SAFETY: `host_z` is NUL-terminated; FFI reads until NUL.
                            unsafe {
                                boringssl_sys::SSL_set_tlsext_host_name(ssl_ptr, host_z.as_ptr())
                            };
                        }
                    } else if let Some(connection) = this.connection.get() {
                        if let super::listener::UnixOrHost::Host { host, .. } = connection {
                            let host: &[u8] = host.as_ref();
                            if !host.is_empty() {
                                let host_z = bun_core::ZBox::from_bytes(host);
                                // SAFETY: `host_z` is NUL-terminated; FFI reads until NUL.
                                unsafe {
                                    boringssl_sys::SSL_set_tlsext_host_name(
                                        ssl_ptr,
                                        host_z.as_ptr(),
                                    )
                                };
                            }
                        }
                    }
                    if let Some(protos) = this.protos.get() {
                        if this.is_server() {
                            // Per-connection: callback reads `this` from the SSL,
                            // not the CTX-level arg (shared across the listener).
                            // ffi-safe-fn: opaque-ZST `&SSL`/`&SSL_CTX` redecls;
                            // `ssl_ptr` non-null in this branch and
                            // `SSL_get_SSL_CTX` never returns null for a live SSL.
                            let ssl_ref = boringssl_sys::SSL::opaque_ref(ssl_ptr);
                            tls_socket_functions::ffi::SSL_set_ex_data(
                                ssl_ref,
                                0,
                                this_ptr.cast::<c_void>(),
                            );
                            tls_socket_functions::ffi::SSL_CTX_set_alpn_select_cb(
                                SSL_CTX::opaque_ref(tls_socket_functions::ffi::SSL_get_SSL_CTX(
                                    ssl_ref,
                                )),
                                Some(select_alpn_callback),
                                ptr::null_mut(),
                            );
                        } else {
                            // SAFETY: `ssl_ptr` non-null in this branch;
                            // `protos.as_ptr()` is readable for `protos.len()`
                            // bytes (borrowed `&[u8]` from `this.protos`) and
                            // BoringSSL copies the buffer internally — raw
                            // ptr+len pair is the genuine FFI precondition here.
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

        let handlers = this.get_handlers();
        let callback = handlers.on_open;
        let handshake_callback = handlers.on_handshake;

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);

        this.mark_active();
        // TODO: properly propagate exception upwards
        let _ = handlers.resolve_promise(this_value);

        if SSL {
            // only calls open callback if handshake callback is provided
            // If handshake is provided, open is called on connection open
            // If is not provided, open is called after handshake
            if callback.is_empty() || handshake_callback.is_empty() {
                this.deref();
                return;
            }
        } else {
            if callback.is_empty() {
                this.deref();
                return;
            }
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);
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

            // TODO: properly propagate exception upwards
            let rejected = handlers.reject_promise(err).unwrap_or(true);
            if !rejected {
                let _ = handlers.call_error_handler(this_value, &[this_value, err]);
            }
            this.mark_inactive();
        }
        if scope.exit() {
            this.handlers.set(None);
        }
        this.deref();
    }

    pub fn get_this_value(&self, global: &JSGlobalObject) -> JSValue {
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
        // Hold strong until the socket is closed / marked inactive.
        self.this_value.with_mut(|r| r.set_strong(value, global));
        value
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_end(this: *mut Self, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        // SAFETY (whole body): per fn contract; R-2 shared reborrow.
        let this: &Self = unsafe { &*this };
        if this.socket.get().is_detached() {
            return;
        }
        let handlers = this.get_handlers();
        log!(
            "onEnd {}",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            }
        );
        // Ensure the socket remains alive until this is finished
        this.ref_();

        let callback = handlers.on_end;
        let vm = handlers.vm;
        if callback.is_empty() || vm.is_shutting_down() {
            this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));

            // If you don't handle TCP fin, we assume you're done.
            this.mark_inactive();
            this.deref();
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            this.handlers.set(None);
        }
        this.deref();
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_handshake(
        this: *mut Self,
        s: SocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        // SAFETY (whole body): per fn contract; R-2 shared reborrow.
        let this: &Self = unsafe { &*this };
        this.update_flags(|f| f.insert(Flags::HANDSHAKE_COMPLETE));
        this.socket.set(s);
        if this.socket.get().is_detached() {
            return Ok(());
        }
        let handlers = this.get_handlers();
        log!(
            "onHandshake {} ({})",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            },
            success
        );

        let authorized = success == 1;

        this.update_flags(|f| f.set(Flags::AUTHORIZED, authorized));

        let mut callback = handlers.on_handshake;
        let mut is_open = false;

        if handlers.vm.is_shutting_down() {
            return Ok(());
        }

        // Use open callback when handshake is not provided
        if callback.is_empty() {
            callback = handlers.on_open;
            if callback.is_empty() {
                return Ok(());
            }
            is_open = true;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);

        let result: JSValue;
        // open callback only have 1 parameters and its the socket
        // you should use getAuthorizationError and authorized getter to get those values in this case
        if is_open {
            result = match callback.call(&global, this_value, &[this_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

            // only call onOpen once for clients
            if handlers.mode != super::SocketMode::Server {
                // clean onOpen callback so only called in the first handshake and not in every renegotiation
                // on servers this would require a different approach but it's not needed because our servers will not call handshake multiple times
                // servers don't support renegotiation
                // SAFETY: short-lived `&mut` write; raw-ptr access is the
                // ONLY way to mutate the freely-aliased `Handlers` here.
                unsafe {
                    (*handlers.as_ptr()).on_open.unprotect();
                    (*handlers.as_ptr()).on_open = JSValue::ZERO;
                }
            }
        } else {
            // call handhsake callback with authorized and authorization error if has one
            let authorization_error: JSValue = if ssl_error.error_no == 0 {
                JSValue::NULL
            } else {
                match super::uws_jsc::verify_error_to_js(&ssl_error, &global) {
                    Ok(v) => v,
                    Err(e) => {
                        // `Scope` has no Drop — balance event_loop().enter() and
                        // active_connections before propagating (Zig: `defer if (scope.exit()) ...`).
                        if scope.exit() {
                            this.handlers.set(None);
                        }
                        return Err(e);
                    }
                }
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

        if let Some(err_value) = result.to_error() {
            let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
        }
        if scope.exit() {
            this.handlers.set(None);
        }
        Ok(())
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_close(
        this: *mut Self,
        socket: SocketHandler<SSL>,
        err: c_int,
        reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        // SAFETY (whole body): per fn contract; R-2 shared reborrow.
        let this: &Self = unsafe { &*this };
        let handlers = this.get_handlers();
        log!(
            "onClose {}",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            }
        );
        this.detach_native_callback();
        this.socket.set(SocketHandler::<SSL>::DETACHED);
        // The upgradeTLS raw twin shares the same us_socket_t so it never
        // gets its own dispatch — fire its (pre-upgrade) close handler
        // here, then retire it. `raw.twin == None` so this doesn't
        // recurse, and `onClose` derefs the +1 we took at creation.
        if let Some(raw) = this.twin.with_mut(|t| t.take()) {
            // SAFETY: twin holds a +1 intrusive ref; uniquely accessed here.
            // `on_close` itself runs `this.deref()` (via the cleanup guard),
            // which releases that +1 — so hand it the raw pointer instead of
            // letting `IntrusiveRc::drop` release a *second* time.
            let raw = IntrusiveRc::into_raw(raw);
            unsafe { Self::on_close(raw, socket, err, reason).ok() };
        }
        // PORT NOTE: reshaped for borrowck — `defer this.deref()` + `defer markInactive()`.
        let cleanup = scopeguard::guard(this.as_ctx_ptr(), |p| {
            // SAFETY: `p` is the live `*mut Self`; shared reborrow, fields celled.
            unsafe {
                (*p).mark_inactive();
                (*p).deref();
            }
        });

        if this.flags.get().contains(Flags::FINALIZING) {
            drop(cleanup);
            return Ok(());
        }

        let vm = handlers.vm;
        this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));

        let callback = handlers.on_close;

        if callback.is_empty() {
            drop(cleanup);
            return Ok(());
        }

        if vm.is_shutting_down() {
            drop(cleanup);
            return Ok(());
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let mut js_error: JSValue = JSValue::UNDEFINED;
        if err != 0 {
            // errors here are always a read error
            js_error = <sys::Error as jsc::SysErrorJsc>::to_js(
                &sys::Error::from_code_int(err, sys::Tag::read),
                &global,
            );
        }

        if let Err(e) = callback.call(&global, this_value, &[this_value, js_error]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(e)]);
        }
        if scope.exit() {
            this.handlers.set(None);
        }
        drop(cleanup);
        Ok(())
    }

    /// `*mut Self` for the same noalias-reentry reason as `on_writable`.
    ///
    /// # Safety
    /// `this` points at a live `NewSocket`; JS-thread only.
    pub unsafe fn on_data(this: *mut Self, s: SocketHandler<SSL>, data: &[u8]) {
        jsc::mark_binding!();
        // SAFETY (whole body): per fn contract; R-2 shared reborrow.
        let this: &Self = unsafe { &*this };
        this.socket.set(s);
        if this.socket.get().is_detached() {
            return;
        }
        let handlers = this.get_handlers();
        log!(
            "onData {} ({})",
            if handlers.mode == super::SocketMode::Server {
                "S"
            } else {
                "C"
            },
            data.len()
        );
        if this.native_callback.get().on_data(data) {
            return;
        }

        let callback = handlers.on_data;
        if callback.is_empty() || this.flags.get().contains(Flags::FINALIZING) {
            return;
        }
        if handlers.vm.is_shutting_down() {
            return;
        }

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let output_value = match handlers.binary_type.to_js(data, &global) {
            Ok(v) => v,
            Err(err) => {
                this.handle_error(global.take_exception(err));
                return;
            }
        };

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = Handlers::enter_ref(handlers);

        // const encoding = handlers.encoding;
        if let Err(err) = callback.call(&global, this_value, &[this_value, output_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            this.handlers.set(None);
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_data(_this: &Self, _global: &JSGlobalObject) -> JSValue {
        log!("getData()");
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(this: &Self, global: &JSGlobalObject, value: JSValue) -> JsResult<bool> {
        log!("setData()");
        Self::data_set_cached(this.get_this_value(global), global, value);
        Ok(true)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_listener(this: &Self, _global: &JSGlobalObject) -> JSValue {
        let Some(handlers) = this.handlers.get() else {
            return JSValue::UNDEFINED;
        };
        let handlers = bun_ptr::BackRef::from(handlers);

        if handlers.mode != super::SocketMode::Server || this.socket.get().is_detached() {
            return JSValue::UNDEFINED;
        }

        // Zig: `@fieldParentPtr("handlers", handlers)`. Server-mode
        // `this.handlers` is set to `&mut listener.handlers` (the embedded
        // `Listener.handlers` field — Listener.rs:34 / Listener.rs on_create),
        // so subtracting the field offset recovers the parent `Listener*`.
        // This is ONLY valid because `NewSocket.handlers` is a raw
        // `NonNull<Handlers>` pointing into the `Listener` allocation; an
        // `Rc`/`Box` payload would break the invariant.
        //
        // SAFETY: server-mode invariant (checked above) guarantees `handlers`
        // addresses `Listener.handlers`.
        let l: &Listener =
            unsafe { &*bun_core::from_field_ptr!(Listener, handlers, handlers.as_ptr()) };
        l.strong_self.get().get().unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ready_state(this: &Self, _global: &JSGlobalObject) -> JSValue {
        let socket = this.socket.get();
        if socket.is_detached() {
            JSValue::js_number_from_int32(-1)
        } else if socket.is_closed() {
            JSValue::js_number_from_int32(0)
        } else if socket.is_established() {
            JSValue::js_number_from_int32(1)
        } else if socket.is_shutdown() {
            JSValue::js_number_from_int32(-2)
        } else {
            JSValue::js_number_from_int32(2)
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_authorized(this: &Self, _global: &JSGlobalObject) -> JSValue {
        log!("getAuthorized()");
        JSValue::from(this.flags.get().contains(Flags::AUTHORIZED))
    }

    #[bun_jsc::host_fn(method)]
    pub fn timeout(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old::<1>();
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        if args.len == 0 {
            return Err(global.throw(format_args!("Expected 1 argument, got 0")));
        }
        let t = args.ptr[0].coerce::<i32>(global)?;
        if t < 0 {
            return Err(global.throw(format_args!("Timeout must be a positive integer")));
        }
        log!("timeout({})", t);

        this.socket
            .get()
            .set_timeout(c_uint::try_from(t).expect("int cast"));

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_authorization_error(
        this: &Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if this.socket.get().is_detached() {
            return Ok(JSValue::NULL);
        }

        // this error can change if called in different stages of hanshake
        // is very usefull to have this feature depending on the user workflow
        let ssl_error = this.socket.get().get_verify_error();
        if ssl_error.error_no == 0 {
            return Ok(JSValue::NULL);
        }

        let code: &[u8] = ssl_error.code_bytes();
        let reason: &[u8] = ssl_error.reason_bytes();

        let fallback = SystemError {
            errno: 0,
            code: BunString::clone_utf8(code),
            message: BunString::clone_utf8(reason),
            path: BunString::EMPTY,
            syscall: BunString::EMPTY,
            hostname: BunString::EMPTY,
            fd: c_int::MIN,
            dest: BunString::EMPTY,
        };

        Ok(fallback.to_error_instance(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn write(this: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if this.socket.get().is_detached() {
            return Ok(JSValue::js_number_from_int32(-1));
        }

        let mut args = callframe.arguments_undef::<5>();

        Ok(
            match this.write_or_end::<false>(global, args.mut_(), false) {
                WriteResult::Fail => JSValue::ZERO,
                WriteResult::Success { wrote, .. } => JSValue::js_number_from_int32(wrote),
            },
        )
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_local_family(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let Some(address_bytes) = this.socket.get().local_address(&mut buf) else {
            return Ok(JSValue::UNDEFINED);
        };
        Ok(match address_bytes.len() {
            4 => global.common_strings().ipv4(),
            16 => global.common_strings().ipv6(),
            _ => JSValue::UNDEFINED,
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_local_address(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let Some(address_bytes) = this.socket.get().local_address(&mut buf) else {
            return Ok(JSValue::UNDEFINED);
        };
        // `format_ip` expects `addr:port` / `[addr]:port` shape (it strips
        // `:port` and brackets), so pass a `SocketAddr` like Zig's
        // `std.net.Address.initIp{4,6}(.., 0)` — bare `IpAddr` corrupts IPv6.
        let address: std::net::SocketAddr = match address_bytes.len() {
            4 => std::net::SocketAddrV4::new(
                std::net::Ipv4Addr::from(<[u8; 4]>::try_from(address_bytes).unwrap()),
                0,
            )
            .into(),
            16 => std::net::SocketAddrV6::new(
                std::net::Ipv6Addr::from(<[u8; 16]>::try_from(address_bytes).unwrap()),
                0,
                0,
                0,
            )
            .into(),
            _ => return Ok(JSValue::UNDEFINED),
        };

        let text = bun_fmt::format_ip(&address, &mut text_buf).expect("unreachable");
        jsc::bun_string_jsc::create_utf8_for_js(global, text)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_local_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if this.socket.get().is_detached() {
            return JSValue::UNDEFINED;
        }

        JSValue::js_number_from_int32(this.socket.get().local_port())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_family(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let Some(address_bytes) = this.socket.get().remote_address(&mut buf) else {
            return Ok(JSValue::UNDEFINED);
        };
        Ok(match address_bytes.len() {
            4 => global.common_strings().ipv4(),
            16 => global.common_strings().ipv6(),
            _ => JSValue::UNDEFINED,
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_address(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let Some(address_bytes) = this.socket.get().remote_address(&mut buf) else {
            return Ok(JSValue::UNDEFINED);
        };
        let address: std::net::SocketAddr = match address_bytes.len() {
            4 => std::net::SocketAddrV4::new(
                std::net::Ipv4Addr::from(<[u8; 4]>::try_from(address_bytes).unwrap()),
                0,
            )
            .into(),
            16 => std::net::SocketAddrV6::new(
                std::net::Ipv6Addr::from(<[u8; 16]>::try_from(address_bytes).unwrap()),
                0,
                0,
                0,
            )
            .into(),
            _ => return Ok(JSValue::UNDEFINED),
        };

        let text = bun_fmt::format_ip(&address, &mut text_buf).expect("unreachable");
        jsc::bun_string_jsc::create_utf8_for_js(global, text)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if this.socket.get().is_detached() {
            return JSValue::UNDEFINED;
        }

        JSValue::js_number_from_int32(this.socket.get().remote_port())
    }

    #[inline]
    fn do_socket_write(&self, buffer: &[u8]) -> i32 {
        if self.flags.get().contains(Flags::BYPASS_TLS) {
            self.socket.get().raw_write(buffer)
        } else {
            self.socket.get().write(buffer)
        }
    }

    pub fn write_maybe_corked(&self, buffer: &[u8]) -> i32 {
        let socket = self.socket.get();
        if socket.is_shutdown() || socket.is_closed() {
            return -1;
        }

        let res = self.do_socket_write(buffer);
        let uwrote: usize = usize::try_from(res.max(0)).expect("int cast");
        self.bytes_written
            .set(self.bytes_written.get() + uwrote as u64);
        log!("write({}) = {}", buffer.len(), res);
        res
    }

    #[bun_jsc::host_fn(method)]
    pub fn write_buffered(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.socket.get().is_detached() {
            this.buffered_data_for_node_net
                .with_mut(|b| b.clear_and_free());
            return Ok(JSValue::FALSE);
        }

        let args = callframe.arguments_undef::<2>();

        Ok(
            match this.write_or_end_buffered::<false>(global, args.ptr[0], args.ptr[1]) {
                WriteResult::Fail => JSValue::ZERO,
                WriteResult::Success { wrote, total } => {
                    if usize::try_from(wrote.max(0)).expect("int cast") == total {
                        JSValue::TRUE
                    } else {
                        JSValue::FALSE
                    }
                }
            },
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn end_buffered(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.socket.get().is_detached() {
            this.buffered_data_for_node_net
                .with_mut(|b| b.clear_and_free());
            return Ok(JSValue::FALSE);
        }

        let args = callframe.arguments_undef::<2>();
        this.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end.
        let result = match this.write_or_end_buffered::<true>(global, args.ptr[0], args.ptr[1]) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, total } => {
                if wrote >= 0 && usize::try_from(wrote).expect("int cast") == total {
                    this.internal_flush();
                }

                JSValue::from(usize::try_from(wrote.max(0)).expect("int cast") == total)
            }
        };
        this.deref();
        Ok(result)
    }

    fn write_or_end_buffered<const IS_END: bool>(
        &self,
        global: &JSGlobalObject,
        data_value: JSValue,
        encoding_value: JSValue,
    ) -> WriteResult {
        if self.buffered_data_for_node_net.get().len() == 0 {
            let mut values = [
                data_value,
                JSValue::UNDEFINED,
                JSValue::UNDEFINED,
                encoding_value,
            ];
            return self.write_or_end::<IS_END>(global, &mut values, true);
        }

        // PERF(port): was stack-fallback alloc — profile in Phase B.
        let allow_string_object = true;
        let buffer: StringOrBuffer = if data_value.is_undefined() {
            StringOrBuffer::EMPTY
        } else {
            match StringOrBuffer::from_js_with_encoding_value_allow_string_object(
                global,
                // allocator dropped (global mimalloc)
                data_value,
                encoding_value,
                allow_string_object,
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
        // `buffer` Drop frees.
        if !self.flags.get().contains(Flags::END_AFTER_FLUSH) && IS_END {
            self.update_flags(|f| f.insert(Flags::END_AFTER_FLUSH));
        }

        let socket = self.socket.get();
        if socket.is_shutdown() || socket.is_closed() {
            return WriteResult::Success {
                wrote: -1,
                total: buffer.slice().len() + self.buffered_data_for_node_net.get().len() as usize,
            };
        }

        let total_to_write: usize =
            buffer.slice().len() + self.buffered_data_for_node_net.get().len() as usize;
        if total_to_write == 0 {
            if SSL {
                log!("total_to_write == 0");
                if !data_value.is_undefined() {
                    log!("data_value is not undefined");
                    // special condition for SSL_write(0, "", 0)
                    // we need to send an empty packet after the buffer is flushed and after the handshake is complete
                    // and in this case we need to ignore SSL_write() return value because 0 should not be treated as an error
                    self.update_flags(|f| f.insert(Flags::EMPTY_PACKET_PENDING));
                    if !self.try_write_empty_packet() {
                        return WriteResult::Success {
                            wrote: -1,
                            total: total_to_write,
                        };
                    }
                }
            }

            return WriteResult::Success { wrote: 0, total: 0 };
        }

        let wrote: i32 = 'brk: {
            #[cfg(unix)]
            if !SSL {
                // fast-ish path: use writev() to avoid cloning to another buffer.
                if let uws::InternalSocket::Connected(connected) = socket.socket {
                    if !buffer.slice().is_empty() {
                        // SAFETY: `connected` is a live `*mut us_socket_t` (guard above).
                        let rc = unsafe {
                            (*connected).write2(
                                self.buffered_data_for_node_net.get().slice(),
                                buffer.slice(),
                            )
                        };
                        let written: usize = usize::try_from(rc.max(0)).expect("int cast");
                        let leftover = total_to_write.saturating_sub(written);
                        if leftover == 0 {
                            self.buffered_data_for_node_net
                                .with_mut(|b| b.clear_and_free());
                            break 'brk rc;
                        }

                        let buf_len = self.buffered_data_for_node_net.get().len() as usize;
                        let remaining_in_buffered_len =
                            self.buffered_data_for_node_net.get().slice()[written.min(buf_len)..]
                                .len();
                        let remaining_in_input_data = &buffer.slice()
                            [(buf_len.saturating_sub(written)).min(buffer.slice().len())..];

                        if written > 0 {
                            if remaining_in_buffered_len > 0 {
                                self.buffered_data_for_node_net.with_mut(|b| {
                                    // `remaining_in_buffered_len > 0` ⇒ `written < b.len()`,
                                    // so `written..` is in-bounds; safe overlapping memmove.
                                    b.copy_within(written.., 0);
                                    b.truncate(remaining_in_buffered_len);
                                });
                            }
                        }

                        if !remaining_in_input_data.is_empty() {
                            // Zig parity: result intentionally discarded
                            let _ = self
                                .buffered_data_for_node_net
                                .with_mut(|b| b.append_slice(remaining_in_input_data));
                            // PERF(port): was assume_capacity — profile in Phase B.
                        }

                        break 'brk rc;
                    }
                }
            }

            // slower-path: clone the data, do one write.
            // Zig parity: result intentionally discarded
            let _ = self
                .buffered_data_for_node_net
                .with_mut(|b| b.append_slice(buffer.slice()));
            // R-2: `write_maybe_corked` takes `&self` and does not touch
            // `buffered_data_for_node_net`, so a `JsCell::get()` projection
            // is valid for the duration of the call.
            let rc = self.write_maybe_corked(self.buffered_data_for_node_net.get().slice());
            if rc > 0 {
                let wrote_u: usize = usize::try_from(rc.max(0)).expect("int cast");
                self.buffered_data_for_node_net.with_mut(|b| {
                    // did we write everything?
                    // we can free this temporary buffer.
                    if wrote_u == b.len() as usize {
                        b.clear_and_free();
                    } else {
                        // Otherwise, let's move the temporary buffer back.
                        let len = b.len() as usize - wrote_u;
                        debug_assert!(len <= b.len() as usize);
                        debug_assert!(len <= b.capacity() as usize);
                        // `wrote_u < b.len()` (else branch) — safe overlapping memmove.
                        b.copy_within(wrote_u.., 0);
                        b.truncate(len);
                    }
                });
            }

            rc
        };

        WriteResult::Success {
            wrote,
            total: total_to_write,
        }
    }

    fn write_or_end<const IS_END: bool>(
        &self,
        global: &JSGlobalObject,
        args: &mut [JSValue],
        buffer_unwritten_data: bool,
    ) -> WriteResult {
        if args[0].is_undefined() {
            if !self.flags.get().contains(Flags::END_AFTER_FLUSH) && IS_END {
                self.update_flags(|f| f.insert(Flags::END_AFTER_FLUSH));
            }
            log!("writeOrEnd undefined");
            return WriteResult::Success { wrote: 0, total: 0 };
        }

        debug_assert!(self.buffered_data_for_node_net.get().len() == 0);
        let mut encoding_value: JSValue = args[3];
        if args[2].is_string() {
            encoding_value = args[2];
            args[2] = JSValue::UNDEFINED;
        } else if args[1].is_string() {
            encoding_value = args[1];
            args[1] = JSValue::UNDEFINED;
        }

        let offset_value = args[1];
        let length_value = args[2];

        if !encoding_value.is_undefined()
            && (!offset_value.is_undefined() || !length_value.is_undefined())
        {
            let _ = global.throw_todo(b"Support encoding with offset and length altogether. Only either encoding or offset, length is supported, but not both combinations yet.");
            return WriteResult::Fail;
        }

        // PERF(port): was stack-fallback alloc — profile in Phase B.
        let buffer: BlobOrStringOrBuffer = if args[0].is_undefined() {
            BlobOrStringOrBuffer::StringOrBuffer(StringOrBuffer::EMPTY)
        } else {
            match BlobOrStringOrBuffer::from_js_with_encoding_value_allow_request_response(
                global,
                args[0],
                encoding_value,
                true,
            ) {
                Ok(Some(b)) => b,
                Ok(None) => {
                    if !global.has_exception() {
                        let _ = global.throw_invalid_argument_type_value(
                            b"data",
                            b"string, buffer, or blob",
                            args[0],
                        );
                    }
                    return WriteResult::Fail;
                }
                Err(_) => return WriteResult::Fail,
            }
        };
        // `buffer` Drop frees.
        if matches!(&buffer, BlobOrStringOrBuffer::Blob(b) if b.needs_to_read_file()) {
            let _ = global.throw(format_args!(
                "File blob not supported yet in this function."
            ));
            return WriteResult::Fail;
        }

        // PORT NOTE: was `comptime if (is_end) "end" else "write"` in Zig; Rust
        // can't reference an outer `const` generic in a nested `const` item
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
                break 'brk buffer.slice().len();
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

        let socket = self.socket.get();
        if socket.is_shutdown() || socket.is_closed() {
            return WriteResult::Success {
                wrote: -1,
                total: bytes.len(),
            };
        }
        if !self.flags.get().contains(Flags::END_AFTER_FLUSH) && IS_END {
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
        let wrote = self.write_maybe_corked(bytes);
        let uwrote: usize = usize::try_from(wrote.max(0)).expect("int cast");
        if buffer_unwritten_data {
            let remaining = &bytes[uwrote..];
            if !remaining.is_empty() {
                let _ = self
                    .buffered_data_for_node_net
                    .with_mut(|b| b.append_slice(remaining)); // OOM/capacity: Zig aborts; port keeps fire-and-forget
            }
        }

        WriteResult::Success {
            wrote,
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

    fn internal_flush(&self) {
        // R-2: every mutated field is `Cell`/`JsCell`, so `&self` carries no
        // `noalias` for them and the previous `black_box` launder (which
        // mitigated ASM-verified PROVEN_CACHED stale loads of
        // `bytes_written`/`flags`/`buffered_data_for_node_net` across the
        // re-entrant `do_socket_write`) is no longer needed.
        if self.buffered_data_for_node_net.get().len() > 0 {
            // `do_socket_write` does not touch `buffered_data_for_node_net`, so a
            // `JsCell::get()` projection is valid for the duration of the call.
            let written: usize = usize::try_from(
                self.do_socket_write(self.buffered_data_for_node_net.get().slice())
                    .max(0),
            )
            .unwrap();
            self.bytes_written
                .set(self.bytes_written.get() + written as u64);
            if written > 0 {
                self.buffered_data_for_node_net.with_mut(|b| {
                    if b.len() as usize > written {
                        let remaining_len = b.len() as usize - written;
                        // `written < b.len()` — safe overlapping memmove.
                        b.copy_within(written.., 0);
                        b.truncate(remaining_len);
                    } else {
                        b.clear_and_free();
                    }
                });
            }
        }

        let _ = self.try_write_empty_packet();
        self.socket.get().flush();

        if self.can_end_after_flush() {
            self.mark_inactive();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush(this: &Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();
        // `end()` → `internalFlush` → `markInactive` → `closeAndDetach(.normal)`
        // detaches `this.socket` and, for TLS, defers the raw close until the
        // peer's close_notify arrives — leaving `is_active` set so the eventual
        // `onClose` can run `handlers.markInactive()`. Without this guard a
        // follow-up `flush()` re-enters `markInactive`, sees the detached
        // socket as closed, and frees `*Handlers` early; the deferred `onClose`
        // then derefs freed memory. Every other `internalFlush` caller already
        // has this check.
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        this.internal_flush();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn terminate(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        this.close_and_detach(uws::CloseCode::Failure);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn shutdown(
        this: &Self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old::<1>();
        if args.len > 0 && args.ptr[0].to_boolean() {
            this.socket.get().shutdown_read();
        } else {
            this.socket.get().shutdown();
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(
        this: &Self,
        global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        // `_handle.close()` is the net.Socket `_destroy()` path — Node emits close_notify
        // once and closes the fd without waiting for the peer's reply. `.fast_shutdown`
        // makes `ssl_handle_shutdown` take the fast branch so the raw close runs
        // synchronously (with `.normal` the SSL layer defers waiting for the peer, but we
        // detach + unref immediately below, orphaning the `us_socket_t`). NOT `.failure`:
        // that arms SO_LINGER{1,0} → RST and drops any data still in the kernel send
        // buffer, which `destroy()` after `write()` must not do.
        this.socket.get().close(uws::CloseCode::FastShutdown);
        this.socket.set(SocketHandler::<SSL>::DETACHED);
        let _ = global;
        this.poll_ref.with_mut(|p| {
            p.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn end(this: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();

        let mut args = callframe.arguments_undef::<5>();

        log!("end({} args)", args.len);
        if this.socket.get().is_detached() {
            return Ok(JSValue::js_number(-1.0));
        }

        this.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end.

        let result = match this.write_or_end::<true>(global, args.mut_(), false) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, total } => {
                if wrote >= 0 && usize::try_from(wrote).expect("int cast") == total {
                    this.internal_flush();
                }
                JSValue::js_number(wrote as f64)
            }
        };
        this.deref();
        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_ref(this: &Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.get().is_detached() {
            this.ref_pollref_on_connect.set(true);
        }
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        let _ = global;
        this.poll_ref.with_mut(|p| {
            p.ref_(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_unref(this: &Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.get().is_detached() {
            this.ref_pollref_on_connect.set(false);
        }
        let _ = global;
        this.poll_ref.with_mut(|p| {
            p.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
        Ok(JSValue::UNDEFINED)
    }

    /// Called when refcount reaches zero. NOT `impl Drop` — this struct is the
    /// `m_ctx` payload of a `.classes.ts` class; teardown is owned by the
    /// intrusive refcount + `finalize()`.
    // SAFETY: `this` was allocated via `heap::alloc` and refcount == 0.
    unsafe fn deinit_and_destroy(this: *mut Self) {
        let this_ref: &Self = unsafe { &*this };
        this_ref.mark_inactive();
        this_ref.detach_native_callback();
        // PORT NOTE: Zig `JSRef.deinit()` → reset to empty (Strong drops on assign).
        this_ref.this_value.set(JsRef::empty());

        this_ref
            .buffered_data_for_node_net
            .with_mut(|b| b.clear_and_free());

        this_ref.poll_ref.with_mut(|p| {
            p.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
        // need to deinit event without being attached
        if this_ref.flags.get().contains(Flags::OWNED_PROTOS) {
            this_ref.protos.set(None); // Box::<[u8]> drops
        }

        this_ref.server_name.set(None); // Box::<[u8]> drops

        if let Some(connection) = this_ref.connection.with_mut(|c| c.take()) {
            drop(connection);
        }
        if let Some(ctx) = this_ref.owned_ssl_ctx.take() {
            // SAFETY: BoringSSL FFI; we hold one owned ref.
            unsafe { boringssl_sys::SSL_CTX_free(ctx) };
        }
        // SAFETY: `this` was heap-allocated in `new()`.
        drop(unsafe { bun_core::heap::take(this) });
    }

    pub fn finalize(self: Box<Self>) {
        // Refcounted: the trailing `deref()` releases the JS wrapper's +1;
        // allocation may outlive this call if other refs remain, so hand
        // ownership back to the raw refcount.
        let this_ref = bun_core::heap::release(self);
        log!("finalize() {}", core::ptr::from_mut(this_ref) as usize);
        this_ref.update_flags(|f| f.insert(Flags::FINALIZING));
        this_ref.this_value.with_mut(|r| r.finalize());
        if !this_ref.socket.get().is_closed() {
            this_ref.close_and_detach(uws::CloseCode::Failure);
        }

        this_ref.deref();
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old::<1>();

        if args.len < 1 {
            return Err(global.throw(format_args!("Expected 1 argument")));
        }

        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let opts = args.ptr[0];
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw(format_args!("Expected options object")));
        }

        let socket_obj = opts
            .get(global, "socket")?
            .ok_or_else(|| global.throw(format_args!("Expected \"socket\" option")))?;

        // In Zig `this_handlers.* = handlers` overwrites the pointee so the
        // listener + all sockets observe the new callbacks. `this.handlers` is
        // a raw `*mut Handlers` (server: `&mut listener.handlers`; client:
        // `heap::alloc`), so writing through it has valid provenance.
        let p: *mut Handlers = this
            .handlers
            .get()
            .expect("No handlers set on Socket")
            .as_ptr();
        // SAFETY: `p` is the freely-aliased raw pointer; no `&Handlers` borrow
        // is live across the read/writes below (single-threaded event loop,
        // and `from_js` cannot reenter this socket's handlers).
        let prev_mode = unsafe { (*p).mode };
        let handlers =
            Handlers::from_js(global, socket_obj, prev_mode == super::SocketMode::Server)?;
        // Preserve runtime state across the struct assignment. `Handlers.fromJS` returns a
        // fresh struct with `active_connections = 0` and `mode` limited to `.server`/`.client`,
        // but this socket (and any in-flight callback scope) still holds references that were
        // counted against the old value, and a duplex-upgraded server socket must keep
        // `.duplex_server`. Losing the counter causes the next `markInactive` to either free
        // the heap-allocated client `Handlers` while the socket still points at it, or
        // underflow on the server path.
        // SAFETY: raw-pointer-only access; see `get_handlers` contract.
        unsafe {
            let active_connections = (*p).active_connections.get();
            core::ptr::drop_in_place(p); // Zig: this_handlers.deinit()
            core::ptr::write(p, handlers);
            (*p).mode = prev_mode;
            (*p).active_connections.set(active_connections);
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fd(this: &Self, _global: &JSGlobalObject) -> JSValue {
        // Zig: `return this.socket.fd().toJSWithoutMakingLibUVOwned();`
        // On Windows the fd is a system-kind SOCKET handle; routing it through
        // `.uv()` panics for anything but stdio. The sys_jsc helper branches on
        // kind exactly like fd_jsc.zig (system→u64, uv→i32, posix→i32).
        use bun_sys_jsc::FdJsc as _;
        this.socket.get().fd().to_js_without_making_lib_uv_owned()
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_bytes_written(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(
            (this.bytes_written.get() + this.buffered_data_for_node_net.get().len() as u64) as f64,
        )
    }

    /// In-place TCP→TLS upgrade. The underlying `us_socket_t` is
    /// `adoptTLS`'d into the per-VM TLS group with a fresh (or
    /// SecureContext-shared) `SSL_CTX*`. Returns `[raw, tls]` — two
    /// `TLSSocket` wrappers over one fd: `tls` is the encrypted view that
    /// owns dispatch; `raw` has `bypass_tls` set so node:net's
    /// `socket._handle` can pipe pre-handshake/tunnelled bytes via
    /// `us_socket_raw_write`. No second context, no `Handlers.clone()`.
    #[bun_jsc::host_fn(method)]
    pub fn upgrade_tls(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if SSL {
            return Ok(JSValue::UNDEFINED);
        }
        // adoptTLS needs a real `*us_socket_t`. `.connecting` (DNS /
        // happy-eyeballs in flight) and `.upgradedDuplex` have no fd to
        // adopt; the old `isDetached()/isNamedPipe()` guard let those
        // through and the `.connected` payload read below would then be
        // illegal-union-access on a `.connecting` socket.
        // PORT NOTE: Zig `InternalSocket.get()` returns `?*us_socket_t` (Some
        // only for `.connected`); inline the match here since the Rust
        // `bun_uws::InternalSocket` lacks `get()`.
        let uws::InternalSocket::Connected(raw_socket) = this.socket.get().socket else {
            return Err(global.throw_invalid_arguments(format_args!(
                "upgradeTLS requires an established socket"
            )));
        };
        if this.is_server() {
            return Err(global.throw(format_args!("Server-side upgradeTLS is not supported. Use upgradeDuplexToTLS with isServer: true instead.")));
        }

        let args = callframe.arguments_old::<1>();
        if args.len < 1 {
            return Err(global.throw(format_args!("Expected 1 arguments")));
        }
        let opts = args.ptr[0];
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw(format_args!("Expected options object")));
        }

        let socket_obj = opts
            .get(global, "socket")?
            .ok_or_else(|| global.throw(format_args!("Expected \"socket\" option")))?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        let handlers = Handlers::from_js(global, socket_obj, false)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        // 9 .protect()'d JS callbacks live in `handlers`; every error/throw
        // from here until they're moved into `tls.handlers` would leak them.
        // The flag flips once ownership transfers so the errdefer is a no-op
        // on success.
        let mut handlers_guard = scopeguard::guard(Some(handlers), |h| {
            // PORT NOTE: Zig `handlers.deinit()` → `Drop for Handlers`
            // (unprotect + Strong drop). Explicit drop for clarity.
            drop(h);
        });

        // Resolve the `SSL_CTX*`. Prefer a passed `SecureContext` (the
        // memoised `tls.createSecureContext` path) so 10k upgrades share
        // one `SSL_CTX_new`; otherwise build an owned one from inline
        // `tls:` options. Either way `owned_ctx` holds one ref we drop in
        // deinit; SSL_new() takes its own.
        //
        // Zig: `errdefer if (owned_ctx) |c| SSL_CTX_free(c)` — by-name
        // capture. The local lives INSIDE the guard so all reads/writes go
        // through `*owned_ctx` (DerefMut); capturing `&mut owned_ctx as *mut _`
        // and then writing the local by name would pop the guard's pointer
        // tag under Stacked Borrows and make the closure deref UB on a
        // `?`-error path.
        let mut owned_ctx = scopeguard::guard(None::<*mut SSL_CTX>, |c| {
            if let Some(c) = c {
                // SAFETY: BoringSSL FFI; `c` is the +1 ref taken below.
                unsafe { boringssl_sys::SSL_CTX_free(c) };
            }
        });
        let mut ssl_opts: Option<SSLConfig> = None;
        // Drop frees ssl_opts.

        // node:net wraps the result of `[buntls]` as `opts.tls`, so the
        // SecureContext arrives as `opts.tls.secureContext`. Bun.connect
        // userland may also pass it top-level. Check both.
        let sc_js: JSValue = 'blk: {
            if let Some(v) = opts.get_truthy(global, "secureContext")? {
                break 'blk v;
            }
            if let Some(t) = opts.get_truthy(global, "tls")? {
                if t.is_object() {
                    if let Some(v) = t.get_truthy(global, "secureContext")? {
                        break 'blk v;
                    }
                }
            }
            JSValue::ZERO
        };
        if !sc_js.is_empty() {
            let Some(sc) = SecureContext::from_js(sc_js) else {
                return Err(global.throw_invalid_argument_type_value(
                    b"secureContext",
                    b"SecureContext",
                    sc_js,
                ));
            };
            // SAFETY: `from_js` returns a live `*mut SecureContext`.
            *owned_ctx = Some(unsafe { (*sc).borrow() }.cast::<SSL_CTX>());
            // servername / ALPN still come from the surrounding tls config.
            if let Some(t) = opts.get_truthy(global, "tls")? {
                if !t.is_boolean() {
                    ssl_opts = SSLConfig::from_js(
                        // SAFETY: per-thread VM singleton.
                        VirtualMachine::get().as_mut(),
                        global,
                        t,
                    )?;
                }
            }
        } else if let Some(tls_js) = opts.get_truthy(global, "tls")? {
            if !tls_js.is_boolean() {
                ssl_opts = SSLConfig::from_js(
                    // SAFETY: per-thread VM singleton.
                    VirtualMachine::get().as_mut(),
                    global,
                    tls_js,
                )?;
            } else if tls_js.to_boolean() {
                ssl_opts = Some(SSLConfig::default());
            }
            let cfg = ssl_opts
                .as_mut()
                .ok_or_else(|| global.throw(format_args!("Expected \"tls\" option")))?;
            let mut create_err = uws::create_bun_socket_error_t::none;
            // Per-VM weak cache: `tls:true` and `{servername}`-only hit
            // the same CTX as `Bun.connect`; an inline CA dedupes across
            // every upgradeTLS that names it.
            // PORT NOTE: `bun_jsc::rare_data::RareData::ssl_ctx_cache()` returns
            // the high-tier opaque ZST stub (cycle-break); the concrete
            // `SSLContextCache` lives on this thread's `RuntimeState`.
            let cache = {
                let state = crate::jsc_hooks::runtime_state();
                debug_assert!(!state.is_null(), "RuntimeState not installed");
                // SAFETY: per-thread `RuntimeState` boxed by `init_runtime_state`;
                // stable address for the VM's lifetime, JS-thread-only access.
                unsafe { &mut (*state).ssl_ctx_cache }
            };
            *owned_ctx = match cache.get_or_create(cfg, &mut create_err) {
                Some(c) => Some(c.cast::<SSL_CTX>()),
                None => {
                    // us_ssl_ctx_from_options only sets *err for the CA/cipher
                    // cases; bad cert/key/DH return NULL with err==.none and the
                    // detail is on the BoringSSL error queue.
                    if create_err != uws::create_bun_socket_error_t::none {
                        return Err(global.throw_value(
                            crate::socket::uws_jsc::create_bun_socket_error_to_js(
                                create_err, global,
                            ),
                        ));
                    }
                    return Err(global
                        .throw_value(boringssl_err_to_js(global, boringssl_sys::ERR_get_error())));
                }
            };
        } else {
            return Err(global.throw(format_args!("Expected \"tls\" option")));
        }
        if global.has_exception() {
            return Err(jsc::JsError::Thrown);
        }

        let mut default_data = JSValue::ZERO;
        if let Some(v) = opts.fast_get(global, jsc::BuiltinName::Data)? {
            default_data = v;
            default_data.ensure_still_alive();
        }

        let handlers_taken = handlers_guard.take().unwrap();
        scopeguard::ScopeGuard::into_inner(handlers_guard);
        let vm = handlers_taken.vm;
        // Zig: `bun.default_allocator.create(Handlers)` — client-mode
        // `Handlers` is a standalone heap allocation that
        // `Handlers::mark_inactive` later frees via `heap::take`.
        let handlers_ptr = bun_core::heap::into_raw_nn(Box::new(handlers_taken));

        // Ownership of the +1 `SSL_CTX` ref transfers into `tls.owned_ssl_ctx`
        // below; defuse the errdefer so a later `?` doesn't double-free.
        let owned_ctx_taken = scopeguard::ScopeGuard::into_inner(owned_ctx);

        let cfg = ssl_opts.as_ref();
        let tls_ptr: *mut TLSSocket = TLSSocket::new(TLSSocket {
            ref_count: bun_ptr::RefCount::init(),
            handlers: Cell::new(Some(handlers_ptr)),
            socket: Cell::new(SocketHandler::<true>::DETACHED),
            owned_ssl_ctx: Cell::new(owned_ctx_taken),
            connection: JsCell::new(this.connection.get().as_ref().map(|c| c.clone())),
            protos: JsCell::new(cfg.and_then(|c| c.protos_bytes().map(Box::<[u8]>::from))),
            server_name: JsCell::new(
                cfg.and_then(|c| c.server_name_bytes().map(Box::<[u8]>::from)),
            ),
            flags: Cell::new(Flags::default()),
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            buffered_data_for_node_net: JsCell::new(Vec::new()),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
        });
        // Do NOT shadow `tls_ptr` with a long-lived `&mut TLSSocket`: the
        // allocation-root pointer (from `heap::alloc`) must be the value
        // stored in the uws ext slot below so dispatch-derived `&mut`s share
        // its provenance. A `&mut *tls_ptr` reborrow that outlives the
        // ext-slot store and the `on_open`/`start_tls_handshake` calls would
        // alias the `&mut TLSSocket` those calls materialise from ext.
        // Reborrow short-lived `unsafe { &mut *tls_ptr }` per use instead.

        let sni: Option<&core::ffi::CStr> = cfg.and_then(|c| c.server_name_cstr());
        // SAFETY: per-thread VM singleton; no aliasing `&mut` held.
        let group = VirtualMachine::get()
            .as_mut()
            .rare_data()
            .bun_connect_group::<true>(vm);
        // SAFETY: `raw_socket` is the live `*mut us_socket_t` extracted from
        // `InternalSocket::Connected` above; `owned_ssl_ctx` is the +1 ref
        // taken from SecureContext/ssl_ctx_cache and never null here.
        let new_raw: NonNull<uws::us_socket_t> = match unsafe {
            (*raw_socket).adopt_tls(
                group,
                uws::SocketKind::BunSocketTls,
                &mut *((*tls_ptr).owned_ssl_ctx.get().unwrap()),
                sni,
                core::mem::size_of::<*mut c_void>() as i32,
                core::mem::size_of::<*mut c_void>() as i32,
            )
        } {
            Some(s) => s,
            None => {
                let err = boringssl_sys::ERR_get_error();
                scopeguard::defer! {
                    if err != 0 {
                        boringssl_sys::ERR_clear_error();
                    }
                }
                // tls.deinit drops the owned_ctx ref. Null the handlers field
                // first so `TLSSocket::deinit` doesn't double-destroy the
                // `Handlers` we're about to free explicitly (Zig sequences
                // `tls.deref()` then `handlers_ptr.deinit(); destroy(handlers_ptr)`).
                // SAFETY: sole owner of the fresh allocation.
                unsafe {
                    (*tls_ptr).handlers.set(None);
                    (*tls_ptr).deref();
                }
                // Zig: `handlers_ptr.deinit(); allocator.destroy(handlers_ptr)`.
                // `Handlers` has a `Drop` impl that runs `deinit` (unprotect).
                // SAFETY: `handlers_ptr` is the `heap::alloc` allocation
                // created above; sole owner here.
                drop(unsafe { bun_core::heap::take(handlers_ptr.as_ptr()) });
                if err != 0 && !global.has_exception() {
                    return Err(global.throw_value(boringssl_err_to_js(global, err)));
                }
                if !global.has_exception() {
                    return Err(global.throw(format_args!(
                        "Failed to upgrade socket from TCP -> TLS. Is the TLS config correct?",
                    )));
                }
                return Ok(JSValue::UNDEFINED);
            }
        };

        // Retire the original TCP wrapper before any TLS dispatch can run
        // back into JS — it must not see two live owners on one fd. Its
        // *Handlers are TRANSFERRED to the raw twin (the `[raw, tls]`
        // contract is: index 0 keeps the pre-upgrade callbacks and sees
        // ciphertext, index 1 gets the new ones and sees plaintext).
        let raw_handlers = this.handlers.take();
        // Preserve `socket.unref()` across the upgrade — node:tls callers
        // that unref the underlying TCP socket before upgrading must not
        // suddenly hold the loop open via the TLS wrapper.
        let was_reffed = this.poll_ref.get().is_active();
        // Capture before downgrade so the cached `data` (net.ts stores
        // `{self: net.Socket}` there) survives onto the raw twin.
        let original_data: JSValue =
            Self::data_get_cached(this.get_this_value(global)).unwrap_or(JSValue::UNDEFINED);
        original_data.ensure_still_alive();
        if this.flags.get().contains(Flags::IS_ACTIVE) {
            this.poll_ref.with_mut(|p| p.disable());
            this.update_flags(|f| f.remove(Flags::IS_ACTIVE));
            // Do NOT markInactive raw_handlers — ownership of the
            // active_connections=1 it holds is transferring to `raw`.
            this.this_value.with_mut(|r| r.downgrade());
        }
        // Zig `defer this.deref()` — must run on EVERY exit past this point,
        // including the `?` early-returns from `create_empty_array`/`put_index`
        // below, or we leak one ref on the retired TCP wrapper.
        let _this_deref = scopeguard::guard(this.as_ctx_ptr(), |p| {
            // SAFETY: `this` is the JS-wrapper-owned allocation; the wrapper's
            // +1 keeps it alive across the whole call regardless of which exit
            // we take. Single JS thread.
            unsafe { (*p).deref() };
        });
        this.detach_native_callback();
        this.socket.set(SocketHandler::<SSL>::DETACHED);

        // Only NOW is it safe for dispatch to fire: ext + kind point at `tls`.
        // Store the allocation-root `tls_ptr` (from `heap::alloc`), NOT a
        // reborrow-derived pointer, so dispatch's `&mut *ext` shares
        // provenance with our per-use reborrows below.
        // SAFETY: ext slot is sized for `*mut TLSSocket`; `new_raw` is the live
        // adopted `us_socket_t`.
        unsafe { *(*new_raw.as_ptr()).ext::<*mut TLSSocket>() = tls_ptr };
        // SAFETY: short-lived reborrows; no `&mut TLSSocket` is held across
        // any dispatch boundary (`on_open`/`start_tls_handshake` below).
        unsafe {
            (*tls_ptr)
                .socket
                .set(SocketHandler::<true>::from(new_raw.as_ptr()));
            (*tls_ptr).ref_();
        }

        // The `raw` half — same `us_socket_t*`, ORIGINAL pre-upgrade
        // *Handlers, writes bypass SSL. Dispatch reaches it via the
        // `ssl_raw_tap` ciphertext hook, never via the ext slot.
        let raw = TLSSocket::new(TLSSocket {
            ref_count: bun_ptr::RefCount::init(),
            handlers: Cell::new(raw_handlers),
            socket: Cell::new(SocketHandler::<true>::from(new_raw.as_ptr())),
            owned_ssl_ctx: Cell::new(None),
            connection: JsCell::new(None),
            protos: JsCell::new(None),
            server_name: JsCell::new(None),
            // is_active so the chained `raw.onClose` → `markInactive` path
            // tears down `raw_handlers` (client-mode handlers free
            // themselves there). No poll_ref — `tls` keeps the loop alive.
            // active_connections=1 was already on raw_handlers from `this`.
            flags: Cell::new(Flags::BYPASS_TLS | Flags::IS_ACTIVE | Flags::OWNED_PROTOS),
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            buffered_data_for_node_net: JsCell::new(Vec::new()),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
        });
        // SAFETY: raw just allocated via heap::alloc.
        let raw_ref: &TLSSocket = unsafe { &*raw };
        raw_ref.ref_();
        // SAFETY: `raw` came from `TLSSocket::new` (heap::alloc); intrusive +1 held.
        unsafe { (*tls_ptr).twin.set(Some(IntrusiveRc::from_raw(raw))) };
        // SAFETY: `new_raw` is the live adopted `us_socket_t`.
        unsafe { (*new_raw.as_ptr()).set_ssl_raw_tap(true) };

        // SAFETY: short-lived reborrow; no dispatch can fire until
        // `on_open`/`start_tls_handshake` below.
        let tls_js_value = unsafe { (*tls_ptr).get_this_value(global) };
        let raw_js_value = raw_ref.get_this_value(global);
        TLSSocket::data_set_cached(tls_js_value, global, default_data);
        // `raw` keeps the pre-upgrade `data` so its callbacks emit on the
        // original net.Socket, not the TLS one.
        TLSSocket::data_set_cached(raw_js_value, global, original_data);

        // SAFETY: short-lived reborrows on the allocation-root pointer.
        unsafe {
            (*tls_ptr).mark_active();
            if was_reffed {
                (*tls_ptr).poll_ref.with_mut(|p| {
                    p.ref_(bun_io::posix_event_loop::get_vm_ctx(
                        bun_io::AllocatorType::Js,
                    ))
                });
            }
        }
        let _ = vm;

        // Fire onOpen with the right `this`, then send ClientHello. Doing
        // it before ext was repointed would have ALPN/onOpen land in the
        // dead TCPSocket.
        // SAFETY: `on_open` takes `*mut Self` (noalias re-entrancy) and may
        // synchronously dispatch through the ext slot (which now stores
        // `tls_ptr`); passing the allocation-root pointer keeps provenance and
        // no `&mut TLSSocket` is held across the call.
        unsafe {
            let sock = (*tls_ptr).socket.get();
            TLSSocket::on_open(tls_ptr, sock);
        };
        // SAFETY: `new_raw` is the live adopted `us_socket_t`.
        unsafe { (*new_raw.as_ptr()).start_tls_handshake() };

        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(global, 0, raw_js_value)?;
        array.put_index(global, 1, tls_js_value)?;
        // `this.deref()` runs via `_this_deref` scopeguard on return.
        Ok(array)
    }

    // ──────────────────────────────────────────────────────────────────────
    // TLS-only accessor methods. In Zig these are `pub const X = if (ssl) ...
    // else fallback`. Rust cannot const-select inherent methods on a const
    // generic bool, so Phase A defines all of them as forwarding methods that
    // branch on `SSL` at runtime (monomorphised away).
    //
    // PORT NOTE: rustc does not unify `NewSocket<SSL>` with `NewSocket<true>`
    // inside an `if SSL { .. }` block. The cast is sound because both
    // monomorphisations have identical layout and the branch only runs when
    // `SSL == true` (so `Self` *is* `TLSSocket`).
    // ──────────────────────────────────────────────────────────────────────

    #[inline(always)]
    fn as_tls(this: &Self) -> &TLSSocket {
        debug_assert!(SSL);
        // SAFETY: only called from the `if SSL` branch; `NewSocket<SSL>` and
        // `NewSocket<true>` are the same monomorphisation when `SSL == true`.
        unsafe { &*std::ptr::from_ref::<Self>(this).cast::<TLSSocket>() }
    }

    #[bun_jsc::host_fn(method)]
    pub fn disable_renegotiation(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::disable_renegotiation(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn is_session_reused(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::is_session_reused(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::FALSE)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_verify_mode(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::set_verify_mode(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn renegotiate(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::renegotiate(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_ticket(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_tls_ticket(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_session(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::set_session(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_session(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_session(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_alpn_protocol(this: &Self, g: &JSGlobalObject) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_alpn_protocol(Self::as_tls(this), g)
        } else {
            Ok(JSValue::FALSE)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn export_keying_material(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::export_keying_material(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_ephemeral_key_info(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_ephemeral_key_info(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::NULL)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_cipher(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_cipher(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_peer_finished_message(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_tls_peer_finished_message(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_finished_message(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_tls_finished_message(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_shared_sigalgs(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_shared_sigalgs(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_version(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_tls_version(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::NULL)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_max_send_fragment(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::set_max_send_fragment(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::FALSE)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_peer_certificate(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_peer_certificate(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::NULL)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_certificate(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_certificate(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_peer_x509_certificate(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_peer_x509_certificate(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_x509_certificate(
        this: &Self,
        g: &JSGlobalObject,
        f: &CallFrame,
    ) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_x509_certificate(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_servername(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::get_servername(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_servername(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::set_servername(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
        }
    }
}

pub type TCPSocket = NewSocket<false>;
pub type TLSSocket = NewSocket<true>;

/// Codegen accessors for `JSTCPSocket` / `JSTLSSocket` (emitted by
/// `src/codegen/generate-classes.ts`). The const-generic `NewSocket<SSL>`
/// dispatches between the two modules at monomorphization time; see
/// `to_js` / `data_{get,set}_cached` above.
use crate::generated_classes::{js_TCPSocket, js_TLSSocket};

// ── JsClass impls (manual — `#[bun_jsc::JsClass]` derive can't handle the
// const-generic split into two codegen classes `JSTCPSocket` / `JSTLSSocket`).
// Routes through the codegen'd `js_$name` safe wrappers so the
// `${name}__create`/`__fromJS` extern symbols are declared exactly once.
macro_rules! impl_socket_js_class {
    ($ty:ty, $gen:ident) => {
        impl bun_jsc::JsClass for $ty {
            fn from_js(value: JSValue) -> Option<*mut Self> {
                $gen::from_js(value).map(|p| p.as_ptr())
            }
            fn from_js_direct(value: JSValue) -> Option<*mut Self> {
                $gen::from_js_direct(value).map(|p| p.as_ptr())
            }
            fn to_js(self, global: &JSGlobalObject) -> JSValue {
                // Ownership of the boxed `NewSocket` transfers to the C++
                // wrapper (freed via `${typeName}Class__finalize`).
                $gen::to_js(bun_core::heap::into_raw(Box::new(self)), global)
            }
            // `noConstructor: true` — no `${name}__getConstructor` export; trait default applies.
        }
    };
}
impl_socket_js_class!(TCPSocket, js_TCPSocket);
impl_socket_js_class!(TLSSocket, js_TLSSocket);

// ──────────────────────────────────────────────────────────────────────────
// NativeCallbacks — direct callbacks on HTTP2 when available
// ──────────────────────────────────────────────────────────────────────────

pub enum NativeCallbacks {
    H2(IntrusiveRc<H2FrameParser>),
    None,
}

impl NativeCallbacks {
    pub fn on_data(&self, data: &[u8]) -> bool {
        match self {
            NativeCallbacks::H2(h2) => {
                // TODO: properly propagate exception upwards
                // `RefPtr: Deref<Target = H2FrameParser>`; `on_native_read`
                // takes `&self`.
                if h2.on_native_read(data).is_err() {
                    return false;
                }
                true
            }
            NativeCallbacks::None => false,
        }
    }
    pub fn on_writable(&self) -> bool {
        match self {
            NativeCallbacks::H2(h2) => {
                // `on_native_writable(&self)` — Deref through `RefPtr`.
                h2.on_native_writable();
                true
            }
            NativeCallbacks::None => false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WriteResult
// ──────────────────────────────────────────────────────────────────────────

enum WriteResult {
    Fail,
    Success { wrote: i32, total: usize },
}

// ──────────────────────────────────────────────────────────────────────────
// Flags
// ──────────────────────────────────────────────────────────────────────────

bitflags::bitflags! {
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub struct Flags: u16 {
        const IS_ACTIVE            = 1 << 0;
        /// Prevent onClose from calling into JavaScript while we are finalizing
        const FINALIZING           = 1 << 1;
        const AUTHORIZED           = 1 << 2;
        const HANDSHAKE_COMPLETE   = 1 << 3;
        const EMPTY_PACKET_PENDING = 1 << 4;
        const END_AFTER_FLUSH      = 1 << 5;
        const OWNED_PROTOS         = 1 << 6;
        const IS_PAUSED            = 1 << 7;
        const ALLOW_HALF_OPEN      = 1 << 8;
        /// Set on the `raw` half of an `upgradeTLS` pair. Writes route through
        /// `us_socket_raw_write` (bypassing the SSL layer) so node:net can pipe
        /// pre-handshake bytes / read the underlying TCP stream.
        const BYPASS_TLS           = 1 << 9;
        // bits 10..15 unused (Zig: `_: u6 = 0`)
    }
}

impl Default for Flags {
    fn default() -> Self {
        // Zig default: `owned_protos: bool = true`, all others false.
        Flags::OWNED_PROTOS
    }
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
    /// Duplex upgraded to TLS server role. Not listener-owned —
    /// markInactive uses client lifecycle path.
    DuplexServer,
}

impl SocketMode {
    /// Returns true for any mode that acts as a TLS server (ALPN, handshake direction).
    /// Both .server and .duplex_server present as server to peers.
    pub fn is_server(self) -> bool {
        matches!(self, SocketMode::Server | SocketMode::DuplexServer)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DuplexUpgradeContext
// ──────────────────────────────────────────────────────────────────────────

pub struct DuplexUpgradeContext {
    pub upgrade: UpgradedDuplex,
    // We only us a tls and not a raw socket when upgrading a Duplex, Duplex dont support socketpairs
    pub tls: Option<IntrusiveRc<TLSSocket>>,
    // task used to deinit the context in the next tick, vm is used to enqueue the task
    /// JSC_BORROW: process-lifetime per-thread VM (immortal). Stored as
    /// `&'static` so [`enqueue_self_task`](Self::enqueue_self_task) routes
    /// through the safe `event_loop_mut()` accessor instead of a raw deref.
    pub vm: &'static VirtualMachine,
    pub task: AnyTask,
    pub task_event: EventState,
    /// Config to build a fresh `SSL_CTX` from (legacy `{ca,cert,key}` callers).
    /// Mutually exclusive with `owned_ctx` — `runEvent` prefers `owned_ctx`.
    pub ssl_config: Option<SSLConfig>,
    /// One ref on a prebuilt `SSL_CTX` (from `opts.tls.secureContext` — the
    /// memoised `tls.createSecureContext` path). Adopted by `startTLSWithCTX`
    /// on success, freed in `deinit` if Close races ahead of StartTLS.
    pub owned_ctx: Option<*mut SSL_CTX>,
    pub is_open: bool,
    // Zig private field `#mode`.
    mode: SocketMode,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum EventState {
    StartTLS,
    Close,
}

impl DuplexUpgradeContext {
    #[inline(always)]
    fn duplex_socket(&mut self) -> SocketHandler<true> {
        SocketHandler::<true>::from_any(uws::InternalSocket::UpgradedDuplex(
            (&raw mut self.upgrade).cast(),
        ))
    }

    fn on_open(&mut self) {
        self.is_open = true;
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch. `on_open`
            // takes `*mut Self` (noalias re-entrancy) — no `&mut TLSSocket` held.
            unsafe { TLSSocket::on_open(tls.as_ptr(), socket) };
        }
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { TLSSocket::on_data(tls.as_ptr(), socket, decoded_data) };
        }
    }

    fn on_handshake(&mut self, success: bool, ssl_error: uws::us_bun_verify_error_t) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            let _ =
                unsafe { TLSSocket::on_handshake(tls.as_ptr(), socket, success as i32, ssl_error) };
        }
    }

    fn on_end(&mut self) {
        let socket = self.duplex_socket();
        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { TLSSocket::on_end(tls.as_ptr(), socket) };
        }
    }

    fn on_writable(&mut self) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { TLSSocket::on_writable(tls.as_ptr(), socket) };
        }
    }

    fn on_error(&mut self, err_value: JSValue) {
        if self.is_open {
            if let Some(tls) = &self.tls {
                // `RefPtr: Deref<Target = TLSSocket>`; `handle_error(&self)`.
                tls.handle_error(err_value);
            }
        } else {
            if let Some(tls) = self.tls.take() {
                // Pre-open error (e.g. the duplex emitted non-Buffer data
                // before the queued `.StartTLS` task ran). `handleConnectError`
                // → `markInactive` frees `tls.handlers`; null `tls` so the
                // still-queued `.StartTLS` → `onOpen` — and any further
                // duplex events — skip the TLSSocket instead of calling
                // `getHandlers()` on the freed allocation.
                //
                // Refcount: `tls.socket` is `InternalSocket::UpgradedDuplex`
                // here (assigned in `js_upgrade_duplex_to_tls` *before*
                // `start_tls()` enqueues anything and before any duplex
                // callback can dispatch), so `handle_connect_error`'s
                // `needs_deref = !is_detached()` is `true` and it consumes
                // the owner's +1 we hold. Do NOT let `IntrusiveRc::Drop`
                // fire on top of that (over-deref → UAF on the JS wrapper's
                // pointee).
                let p = IntrusiveRc::into_raw(tls);
                // SAFETY: intrusive refcount; single-threaded dispatch. The
                // +1 transferred via `into_raw` is released by
                // `handle_connect_error`'s `needs_deref` arm (socket is
                // UpgradedDuplex, not Detached) — do NOT reconstruct the
                // IntrusiveRc. `handle_connect_error` takes `*mut Self`.
                let _ = unsafe {
                    TLSSocket::handle_connect_error(p, sys::SystemErrno::ECONNREFUSED as c_int)
                };
            }
        }
    }

    fn on_timeout(&mut self) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { TLSSocket::on_timeout(tls.as_ptr(), socket) };
        }
    }

    fn on_close(&mut self) {
        let socket = self.duplex_socket();

        if let Some(tls) = self.tls.take() {
            // `tls.onClose` consumes the +1 we hold (its `defer this.deref()`
            // is the ext-slot/owner pin). Null our pointer first so the
            // `deinitInNextTick` → `deinit` path doesn't deref it a second
            // time — that's the over-deref behind the cross-file
            // `TLSSocket.finalize` use-after-poison. It also means a throw
            // from `duplex.end()` (called right after this returns via
            // `UpgradedDuplex.onClose` → `callWriteOrEnd`) hits the null-check
            // in `onError` instead of reading the Handlers that `tls.onClose`
            // → `markInactive` just freed.
            let p = IntrusiveRc::into_raw(tls);
            // SAFETY: intrusive refcount; single-threaded dispatch. `on_close`
            // consumes the +1 we held via its internal `deref()`, so we do NOT
            // reconstruct the IntrusiveRc (that would double-deref). `on_close`
            // takes `*mut Self` (noalias re-entrancy).
            let _ = unsafe { TLSSocket::on_close(p, socket, 0, None) };
        }

        self.deinit_in_next_tick();
    }

    /// # Safety
    /// `this` must be the live heap allocation produced in
    /// `js_upgrade_duplex_to_tls`. May free `this` (via [`Self::deinit`]);
    /// callers must not hold a `&`/`&mut Self` across the call — pass the raw
    /// pointer directly so no Stacked Borrows protector spans the dealloc.
    unsafe fn run_event(this: *mut Self) {
        // SAFETY: `this` is live; copy of a `Copy` field.
        match unsafe { (*this).task_event } {
            EventState::StartTLS => {
                // A pre-open error (onError's `!is_open` branch) may have
                // already fired the connect-error callback, freed
                // `tls.handlers`, and nulled `tls` while this task was
                // queued. There is nothing to open in that case — and
                // nothing else will reach `deinit()` since the SSLWrapper
                // (whose close callback normally schedules it) is never
                // created — so tear everything down here instead of
                // spinning up a wrapper that would dispatch `onOpen` into
                // the dead socket.
                //
                // SAFETY: `this` is live; short-lived `&` for the null-check.
                if unsafe { (*this).tls.is_none() } {
                    // SAFETY: per fn contract; no `&Self` live across this.
                    unsafe { Self::deinit(this) };
                    return;
                }
                // SAFETY: `this` is live; this `&mut` is scoped to the block
                // and ends before any `Self::deinit` call below.
                let started: Result<(), bun_core::Error> = {
                    let this_ref = unsafe { &mut *this };
                    log!(
                        "DuplexUpgradeContext.startTLS mode={}",
                        <&'static str>::from(this_ref.mode)
                    );
                    let is_client = this_ref.mode == SocketMode::Client;
                    if let Some(ctx) = this_ref.owned_ctx.take() {
                        // Transfer the ref into SSLWrapper; null first so the
                        // failure path / deinit don't double-free it.
                        this_ref.upgrade.start_tls_with_ctx(ctx, is_client)
                    } else if let Some(config) = &this_ref.ssl_config {
                        this_ref.upgrade.start_tls(config, is_client)
                    } else {
                        Ok(())
                    }
                };
                if let Err(err) = started {
                    if err == bun_core::err!("OutOfMemory") {
                        bun_core::out_of_memory();
                    }
                    let errno = sys::SystemErrno::ECONNREFUSED as c_int;
                    // SAFETY: `this` is live; short-lived `&mut` for `take`.
                    if let Some(tls) = unsafe { (*this).tls.take() } {
                        // `handleConnectError` consumes our +1 — `tls.socket`
                        // is `InternalSocket::UpgradedDuplex` (set before
                        // `start_tls()` was queued), so `needs_deref =
                        // !is_detached()` is true — and detaches. Null
                        // `this.tls` so `deinit` doesn't deref again.
                        let p = IntrusiveRc::into_raw(tls);
                        // SAFETY: intrusive refcount; `handle_connect_error`'s
                        // `needs_deref` arm releases the +1 transferred via
                        // `into_raw` (socket is UpgradedDuplex, not Detached).
                        // `handle_connect_error` takes `*mut Self`.
                        let _ = unsafe { TLSSocket::handle_connect_error(p, errno) };
                    }
                    // `startTLS`/`startTLSWithCTX` failed before the
                    // SSLWrapper was assigned, so its close callback
                    // was never registered and nothing will schedule
                    // `.Close`. Same as the `tls == null` early-return
                    // above: tear down here.
                    // SAFETY: per fn contract; no `&Self` live across this.
                    unsafe { Self::deinit(this) };
                    return;
                }
                // SAFETY: `this` is live; short-lived `&mut` for the field write.
                unsafe { (*this).ssl_config = None }; // Drop frees.
            }
            // Previously this only called `upgrade.close()` and never `deinit`,
            // leaking the SSLWrapper, the strong refs, and this struct itself
            // for every duplex-upgraded TLS socket.
            // SAFETY: per fn contract; no `&Self` live across this.
            EventState::Close => unsafe { Self::deinit(this) },
        }
    }

    /// Enqueue `self.task` on the owning VM's event loop. `vm` is the
    /// process-lifetime per-thread singleton stored at construction
    /// (`js_upgrade_duplex_to_tls`); `event_loop_mut()` is the safe accessor
    /// for the VM-owned event-loop self-pointer.
    #[inline]
    fn enqueue_self_task(&mut self) {
        self.vm
            .event_loop_mut()
            .enqueue_task(jsc::Task::init(&raw mut self.task));
    }

    fn deinit_in_next_tick(&mut self) {
        self.task_event = EventState::Close;
        self.enqueue_self_task();
    }

    fn start_tls(&mut self) {
        self.task_event = EventState::StartTLS;
        self.enqueue_self_task();
    }

    /// # Safety
    /// `this` must be the unique live pointer to the heap allocation produced
    /// in `js_upgrade_duplex_to_tls`. Frees the allocation; callers must not
    /// hold a `&`/`&mut Self` across this call (taking `&mut self` here would
    /// be a Stacked Borrows protector violation when the backing `Box` is
    /// reclaimed below).
    unsafe fn deinit(this: *mut Self) {
        {
            // SAFETY: `this` is live; short-lived `&mut` ends before the
            // `heap::take` free below — no protector spans the dealloc.
            let this_ref = unsafe { &mut *this };
            if let Some(tls) = this_ref.tls.take() {
                // Zig `tls.deref()` — IntrusiveRc::drop decrements.
                drop(tls);
            }
            // Close raced ahead of StartTLS — drop the unconsumed config.
            this_ref.ssl_config = None;
            if let Some(ctx) = this_ref.owned_ctx.take() {
                // SAFETY: BoringSSL FFI; we hold one owned ref.
                unsafe { boringssl_sys::SSL_CTX_free(ctx) };
            }
        }
        // PORT NOTE: Zig `self.upgrade.deinit()` — `UpgradedDuplex` cleanup
        // runs via `Drop` when `heap::take(this)` frees the containing
        // struct below; an explicit call here would double-free.
        // SAFETY: heap-allocated in `js_upgrade_duplex_to_tls`; this is the
        // matching free. No `&`/`&mut Self` survives past this point.
        drop(unsafe { bun_core::heap::take(this) });
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Free-standing host functions
// ──────────────────────────────────────────────────────────────────────────

#[bun_jsc::host_fn]
pub fn js_upgrade_duplex_to_tls(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let args = callframe.arguments_old::<2>();
    if args.len < 2 {
        return Err(global.throw(format_args!("Expected 2 arguments")));
    }
    let duplex = args.ptr[0];
    // TODO: do better type checking
    if duplex.is_empty_or_undefined_or_null() {
        return Err(global.throw(format_args!("Expected a Duplex instance")));
    }

    let opts = args.ptr[1];
    if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
        return Err(global.throw(format_args!("Expected options object")));
    }

    let socket_obj = opts
        .get(global, "socket")?
        .ok_or_else(|| global.throw(format_args!("Expected \"socket\" option")))?;

    let mut is_server = false;
    if let Some(is_server_val) = opts.get_truthy(global, "isServer")? {
        is_server = is_server_val.to_boolean();
    }
    // Note: Handlers.fromJS is_server=false because these handlers are standalone
    // allocations (not embedded in a Listener). The mode field on Handlers
    // controls lifecycle (markInactive expects a Listener parent when .server).
    // The TLS direction (client vs server) is controlled by DuplexUpgradeContext.mode.
    let handlers = Handlers::from_js(global, socket_obj, false)?;
    // PORT NOTE: Zig `handlers.deinit()` → `Drop for Handlers`.
    let mut handlers_guard = scopeguard::guard(Some(handlers), |h| {
        drop(h);
    });

    // Resolve the `SSL_CTX*`. Prefer a passed `SecureContext` (the memoised
    // `tls.createSecureContext` path — what `[buntls]` now returns) so the
    // duplex/named-pipe path shares one `SSL_CTX_new` with everyone else.
    // node:net wraps `[buntls]`'s return as `opts.tls.secureContext`; userland
    // may also pass it top-level. Same lookup as `upgradeTLS` above.
    // Zig: `errdefer if (owned_ctx) |c| SSL_CTX_free(c)` — by-name capture.
    // The local lives INSIDE the guard so all reads/writes go through
    // `*owned_ctx` (DerefMut); capturing `&mut owned_ctx as *mut _` and then
    // writing the local by name would invalidate the guard's pointer tag
    // under Stacked Borrows.
    let mut owned_ctx = scopeguard::guard(None::<*mut SSL_CTX>, |c| {
        if let Some(c) = c {
            // SAFETY: BoringSSL FFI; `c` is the +1 ref taken below.
            unsafe { boringssl_sys::SSL_CTX_free(c) };
        }
    });
    let sc_js: JSValue = 'blk: {
        if let Some(v) = opts.get_truthy(global, "secureContext")? {
            break 'blk v;
        }
        if let Some(t) = opts.get_truthy(global, "tls")? {
            if t.is_object() {
                if let Some(v) = t.get_truthy(global, "secureContext")? {
                    break 'blk v;
                }
            }
        }
        JSValue::ZERO
    };
    if !sc_js.is_empty() {
        let Some(sc) = SecureContext::from_js(sc_js) else {
            return Err(global.throw_invalid_argument_type_value(
                b"secureContext",
                b"SecureContext",
                sc_js,
            ));
        };
        // SAFETY: `from_js` returns a live `*mut SecureContext`.
        *owned_ctx = Some(unsafe { (*sc).borrow() }.cast::<SSL_CTX>());
    }

    // Still parse SSLConfig for servername/ALPN (those live on the JS-side
    // wrapper, not the SSL_CTX) and as the build source when no SecureContext.
    let mut ssl_opts: Option<SSLConfig> = None;
    // Drop frees ssl_opts on error.
    if let Some(tls) = opts.get_truthy(global, "tls")? {
        if !tls.is_boolean() {
            ssl_opts = SSLConfig::from_js(VirtualMachine::get().as_mut(), global, tls)?;
        } else if tls.to_boolean() {
            ssl_opts = Some(SSLConfig::default());
        }
    }
    if owned_ctx.is_none() && ssl_opts.is_none() {
        return Err(global.throw(format_args!("Expected \"tls\" option")));
    }
    let socket_config: Option<&SSLConfig> = ssl_opts.as_ref();

    let mut default_data = JSValue::ZERO;
    if let Some(v) = opts.fast_get(global, jsc::BuiltinName::Data)? {
        default_data = v;
        default_data.ensure_still_alive();
    }

    let mut handlers_taken = handlers_guard.take().unwrap();
    scopeguard::ScopeGuard::into_inner(handlers_guard);
    // Set mode to duplex_server so TLSSocket.isServer() returns true for ALPN server mode
    // without affecting markInactive lifecycle (which requires a Listener parent).
    handlers_taken.mode = if is_server {
        crate::socket::SocketMode::DuplexServer
    } else {
        crate::socket::SocketMode::Client
    };
    // Zig: `bun.default_allocator.create(Handlers)` — client-mode `Handlers`
    // is a standalone heap allocation that `Handlers::mark_inactive` later
    // frees via `heap::take`.
    let handlers_ptr = bun_core::heap::into_raw_nn(Box::new(handlers_taken));
    let tls = TLSSocket::new(TLSSocket {
        ref_count: bun_ptr::RefCount::init(),
        handlers: Cell::new(Some(handlers_ptr)),
        socket: Cell::new(SocketHandler::<true>::DETACHED),
        owned_ssl_ctx: Cell::new(None),
        connection: JsCell::new(None),
        protos: JsCell::new(
            socket_config.and_then(|cfg| cfg.protos_bytes().map(Box::<[u8]>::from)),
        ),
        server_name: JsCell::new(
            socket_config.and_then(|cfg| cfg.server_name_bytes().map(Box::<[u8]>::from)),
        ),
        flags: Cell::new(Flags::default()),
        this_value: JsCell::new(JsRef::empty()),
        poll_ref: JsCell::new(KeepAlive::init()),
        ref_pollref_on_connect: Cell::new(true),
        buffered_data_for_node_net: JsCell::new(Vec::new()),
        bytes_written: Cell::new(0),
        native_callback: JsCell::new(NativeCallbacks::None),
        twin: JsCell::new(None),
    });
    // SAFETY: tls just allocated via heap::alloc.
    let tls_ref: &TLSSocket = unsafe { &*tls };
    let tls_js_value = tls_ref.get_this_value(global);
    TLSSocket::data_set_cached(tls_js_value, global, default_data);

    // Ownership of the +1 `SSL_CTX` ref transfers into
    // `DuplexUpgradeContext.owned_ctx` below; defuse the errdefer.
    let owned_ctx_taken = scopeguard::ScopeGuard::into_inner(owned_ctx);

    // `DuplexUpgradeContext` is self-referential: `task.ctx` and
    // `upgrade.handlers.ctx` both point at the containing allocation, and
    // `UpgradedDuplex` has fn-ptr-niched fields plus a `Drop` impl, so it
    // cannot be value-constructed with a placeholder and assigned later
    // (`=` would Drop the placeholder; `zeroed()` is an invalid value).
    // Allocate uninit, leak to a raw pointer for the stable address, then
    // field-write everything in place — `upgrade` last, once the address is
    // known. Mirrors Zig `bun.new(...)` then `.upgrade = .from(...)`.
    let duplex_context: *mut DuplexUpgradeContext = bun_core::heap::into_raw(Box::new(
        core::mem::MaybeUninit::<DuplexUpgradeContext>::uninit(),
    ))
    .cast();
    // SAFETY: fresh heap allocation; every field is `ptr::write`-initialized
    // below before any read or `&mut DuplexUpgradeContext` is formed.
    unsafe {
        ptr::addr_of_mut!((*duplex_context).tls).write(Some(IntrusiveRc::from_raw(tls)));
        ptr::addr_of_mut!((*duplex_context).vm).write(VirtualMachine::get());
        // Zig: `jsc.AnyTask.New(DuplexUpgradeContext, runEvent).init(ctx)`.
        // Rust's `AnyTask::New` can't take a comptime callback (see AnyTask.rs
        // PORT NOTE), so hand-write the `*mut c_void → run_event` shim.
        ptr::addr_of_mut!((*duplex_context).task).write(AnyTask {
            ctx: NonNull::new(duplex_context.cast::<c_void>()),
            callback: |p| {
                // SAFETY: `p` is the `*mut DuplexUpgradeContext` stored in
                // `ctx`. `run_event` may free the allocation, so pass the raw
                // pointer through — never form a `&mut` here whose protector
                // would span the dealloc.
                unsafe { DuplexUpgradeContext::run_event(p.cast::<DuplexUpgradeContext>()) };
                Ok(())
            },
        });
        ptr::addr_of_mut!((*duplex_context).task_event).write(EventState::StartTLS);
        // When `owned_ctx` is set, `runEvent` builds from it and ignores
        // `ssl_config` for SSL_CTX construction; servername/ALPN already
        // copied onto `tls` above so the config's only remaining use is the
        // legacy build path.
        ptr::addr_of_mut!((*duplex_context).ssl_config).write(if owned_ctx_taken.is_none() {
            ssl_opts.take()
        } else {
            None
        });
        ptr::addr_of_mut!((*duplex_context).owned_ctx).write(owned_ctx_taken);
        ptr::addr_of_mut!((*duplex_context).is_open).write(false);
        ptr::addr_of_mut!((*duplex_context).mode).write(if is_server {
            SocketMode::DuplexServer
        } else {
            SocketMode::Client
        });
        ptr::addr_of_mut!((*duplex_context).upgrade).write(UpgradedDuplex::from(
            global,
            duplex,
            UpgradedDuplexHandlers {
                on_open: |c: *mut ()| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_open()
                },
                on_data: |c: *mut (), d| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_data(d)
                },
                on_handshake: |c: *mut (), ok, err| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_handshake(ok, err)
                },
                on_close: |c: *mut ()| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_close()
                },
                on_end: |c: *mut ()| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_end()
                },
                on_writable: |c: *mut ()| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_writable()
                },
                on_error: |c: *mut (), e| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_error(e)
                },
                on_timeout: |c: *mut ()| unsafe {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_timeout()
                },
                ctx: duplex_context.cast::<()>(),
            },
        ));
    }
    // SAFETY: every field initialized above.
    let dc = unsafe { &mut *duplex_context };
    // ssl_opts is moved into duplexContext.ssl_config when owned_ctx == null;
    // otherwise it was only used for protos/server_name and is freed here.
    if dc.ssl_config.is_none() {
        drop(ssl_opts.take());
    }
    // Disarm the errdefer — either moved into duplexContext or just
    // freed above; both the move-target and the deinit case must not see it
    // freed again on a later throw.
    let _ = ssl_opts;
    tls_ref.ref_();

    tls_ref.socket.set(from_duplex::<true>(&mut dc.upgrade));
    tls_ref.mark_active();
    tls_ref.poll_ref.with_mut(|p| {
        p.ref_(bun_io::posix_event_loop::get_vm_ctx(
            bun_io::posix_event_loop::AllocatorType::Js,
        ))
    });

    dc.start_tls();

    let array = JSValue::create_empty_array(global, 2)?;
    array.put_index(global, 0, tls_js_value)?;
    // data, end, drain and close events must be reported
    array.put_index(global, 1, dc.upgrade.get_js_handlers(global)?)?;

    Ok(array)
}

#[bun_jsc::host_fn]
pub fn js_is_named_pipe_socket(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = callframe.arguments_old::<3>();
    if arguments.len < 1 {
        return Err(global.throw_not_enough_arguments("isNamedPipeSocket", 1, arguments.len));
    }
    let socket = arguments.ptr[0];
    if let Some(this) = socket.as_class_ref::<TCPSocket>() {
        return Ok(JSValue::from(this.socket.get().is_named_pipe()));
    } else if let Some(this) = socket.as_class_ref::<TLSSocket>() {
        return Ok(JSValue::from(this.socket.get().is_named_pipe()));
    }
    Ok(JSValue::FALSE)
}

#[bun_jsc::host_fn]
pub fn js_get_buffered_amount(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = callframe.arguments_old::<3>();
    if arguments.len < 1 {
        return Err(global.throw_not_enough_arguments("getBufferedAmount", 1, arguments.len));
    }
    let socket = arguments.ptr[0];
    if let Some(this) = socket.as_class_ref::<TCPSocket>() {
        return Ok(JSValue::js_number(
            this.buffered_data_for_node_net.get().len() as f64,
        ));
    } else if let Some(this) = socket.as_class_ref::<TLSSocket>() {
        return Ok(JSValue::js_number(
            this.buffered_data_for_node_net.get().len() as f64,
        ));
    }
    Ok(JSValue::js_number(0.0))
}

#[bun_jsc::host_fn]
pub fn js_create_socket_pair(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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

#[bun_jsc::host_fn]
pub fn js_set_socket_options(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 3 {
        return Err(global.throw_not_enough_arguments("setSocketOptions", 3, arguments.len()));
    }

    let Some(socket) = arguments[0].as_::<TCPSocket>() else {
        return Err(global.throw(format_args!("Expected a SocketTCP instance")));
    };
    // SAFETY: `as_` returned a non-null `*mut TCPSocket` owned by the JS wrapper.
    let socket: &TCPSocket = unsafe { &*socket };

    let is_for_send_buffer = arguments[1].to_int32() == 1;
    let is_for_recv_buffer = arguments[1].to_int32() == 2;
    let buffer_size = arguments[2].to_int32();
    let file_descriptor = socket.socket.get().fd();

    #[cfg(unix)]
    {
        // TODO(port): Zig used `bun.sys.setsockopt`; not yet surfaced in
        // `bun_sys`, so call libc directly with the same `Maybe` shape.
        let setsockopt = |level: libc::c_int, opt: libc::c_int| -> Option<sys::Error> {
            let val: libc::c_int = buffer_size;
            // SAFETY: libc FFI; `val` lives for the call.
            let rc = unsafe {
                libc::setsockopt(
                    file_descriptor.native(),
                    level,
                    opt,
                    (&raw const val).cast::<c_void>(),
                    core::mem::size_of::<libc::c_int>() as libc::socklen_t,
                )
            };
            if rc != 0 {
                Some(sys::Error::from_code(
                    sys::get_errno(rc),
                    sys::Tag::setsockopt,
                ))
            } else {
                None
            }
        };
        if is_for_send_buffer {
            if let Some(err) = setsockopt(libc::SOL_SOCKET, libc::SO_SNDBUF) {
                return Err(global.throw_value(err.to_js(global)));
            }
        } else if is_for_recv_buffer {
            if let Some(err) = setsockopt(libc::SOL_SOCKET, libc::SO_RCVBUF) {
                return Err(global.throw_value(err.to_js(global)));
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (
            is_for_send_buffer,
            is_for_recv_buffer,
            buffer_size,
            file_descriptor,
        );
    }

    Ok(JSValue::UNDEFINED)
}

// ported from: src/runtime/socket/socket.zig
