//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::ptr::{self, NonNull};

use bun_io::KeepAlive;
use bun_jsc::JsCell;
use bun_jsc::ZigStringJsc as _;
use bun_jsc::zig_string::ZigString;
use bun_ptr::IntrusiveRc;
// do NOT `use bun_boringssl_sys::SSL` here — it shadows the
// `const SSL: bool` generic param in `NewSocket<SSL>` below, making rustc
// resolve `<SSL>` as a type arg (E0747). Use the qualified path instead.
use bun_boringssl_sys::SSL_CTX;
use bun_collections::VecExt;
use bun_core::{self, fmt as bun_fmt};
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, SystemError};
// `err.to_js(global)` on `sys::Error` (the `SysErrorJsc` trait method) is only
// reached from `#[cfg(not(windows))]` / `#[cfg(unix)]` blocks below.
#[cfg(not(windows))]
use bun_jsc::SysErrorJsc;
// `bun_jsc::VirtualMachine` is the *module* (alias of `virtual_machine`); name the
// struct directly so `VirtualMachine::get()` resolves as an associated fn.
use super::upgraded_duplex::{Handlers as UpgradedDuplexHandlers, UpgradedDuplex};
use crate::crypto::boringssl_jsc::err_to_js as boringssl_err_to_js;
use crate::node::{BlobOrStringOrBuffer, StringOrBuffer};
use crate::socket::{SSLConfig, SSLConfigFromJs};
use bun_boringssl_sys as boringssl_sys;
use bun_cares_sys::c_ares_draft as c_ares;
use bun_core::String as BunString;
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

/// Shorthand for the JS-side `EventLoopCtx` (replaces direct VM passing to
/// `KeepAlive::ref_/unref` — `bun_io` no longer accepts `&VirtualMachine`).
#[inline]
fn js_loop_ctx() -> bun_io::EventLoopCtx {
    bun_io::posix_event_loop::get_vm_ctx(bun_io::posix_event_loop::AllocatorType::Js)
}

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub(super) use super::handlers::Handlers;
use std::rc::Rc;

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
    // SAFETY: ex_data slot 0 holds a `*mut TLSSocket` (set in on_open), kept
    // live for this handshake callback by the JS wrapper's ref.
    let this = unsafe { bun_ptr::ThisPtr::new(this_ptr.cast::<TLSSocket>()) };
    // Same handlers-presence guard as every other dispatch entry point:
    // an idle socket has dropped its Handlers, and the ALPN selection
    // callback can still fire for a connection JS already detached -
    // get_handlers() would panic. NOACK falls through to the static list.
    if !this.has_handlers() {
        return boringssl_sys::SSL_TLSEXT_ERR_NOACK;
    }
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
        if !callback.is_empty() && !handlers.vm.is_shutting_down() && !in_.is_null() && inlen > 0 {
            let scope = handlers.enter();
            let global = handlers.global_object;
            let this_value = this.get_this_value(&global);
            let wire_len = inlen as usize;
            let buffer = match JSValue::create_buffer_from_length(&global, wire_len) {
                Ok(b) => b,
                Err(_) => {
                    this.exit_scope(scope);
                    return boringssl_sys::SSL_TLSEXT_ERR_ALERT_FATAL;
                }
            };
            if let Some(ab) = buffer.as_array_buffer(&global) {
                // SAFETY: `ab.ptr` points at a fresh `wire_len`-byte JS buffer
                // and `in_` is valid for `inlen` per the callback contract.
                unsafe { core::ptr::copy_nonoverlapping(in_, ab.ptr, wire_len) };
            }
            // SAFETY: `ssl` is the live SSL handle passed into this ALPN
            // callback; SSL_get_servername reads the negotiated SNI name and
            // returns NULL or a NUL-terminated string owned by the SSL.
            let servername_ptr = unsafe { boringssl_sys::SSL_get_servername(ssl.cast_const(), 0) };
            let servername_js = if servername_ptr.is_null() {
                JSValue::UNDEFINED
            } else {
                // SAFETY: BoringSSL hands back a NUL-terminated name.
                let name = unsafe { core::ffi::CStr::from_ptr(servername_ptr) };
                ZigString::init(name.to_bytes()).to_js(&global)
            };
            // The user callback (and the error handler below) run from inside
            // SSL_do_handshake on this socket: JS that writes to or destroys a
            // different TLS socket on the same loop re-points the per-loop BIO
            // routing state, and this handshake's next flight would land on
            // that other socket's fd. Snapshot and restore it around every
            // JS-running region.
            let mut saved_loop_state: [*mut c_void; 5] = [core::ptr::null_mut(); 5];
            tls_socket_functions::ffi::us_internal_ssl_loop_state_save(
                boringssl_sys::SSL::opaque_ref(ssl),
                saved_loop_state.as_mut_ptr(),
            );
            let result =
                match callback.call(&global, this_value, &[this_value, servername_js, buffer]) {
                    Ok(v) => v,
                    Err(err) => global.take_exception(err),
                };
            if let Some(err_value) = result.to_error() {
                let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
                tls_socket_functions::ffi::us_internal_ssl_loop_state_restore(
                    saved_loop_state.as_mut_ptr(),
                );
                this.exit_scope(scope);
                return boringssl_sys::SSL_TLSEXT_ERR_ALERT_FATAL;
            }
            tls_socket_functions::ffi::us_internal_ssl_loop_state_restore(
                saved_loop_state.as_mut_ptr(),
            );
            this.exit_scope(scope);
            if !result.is_boolean() || result.to_boolean() {
                // The server has an ALPNCallback and it answered: a string
                // selects that protocol for this connection; anything else
                // refuses it.
                let chosen = match result.to_slice(&global) {
                    Ok(chosen) => chosen,
                    Err(err) => {
                        // The selection's ToString threw (a Symbol or a throwing
                        // toString): consume the pending exception the same way
                        // the callback's own throw is handled above, then refuse
                        // the protocol.
                        global.take_exception(err);
                        return boringssl_sys::SSL_TLSEXT_ERR_ALERT_FATAL;
                    }
                };
                let chosen_bytes = chosen.slice();
                if !result.is_string() || chosen_bytes.is_empty() || chosen_bytes.len() > 255 {
                    return boringssl_sys::SSL_TLSEXT_ERR_ALERT_FATAL;
                }
                let mut wire = Vec::with_capacity(chosen_bytes.len() + 1);
                wire.push(chosen_bytes.len() as u8);
                wire.extend_from_slice(chosen_bytes);
                this.protos.set(Some(wire.into_boxed_slice()));
                // Fall through to the standard selection below, which now
                // negotiates against the single chosen protocol (and sends the
                // fatal alert if the client did not actually offer it).
            }
        }
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
// `#[bun_jsc::JsClass]` cannot be applied here — the proc-macro
// emits monomorphic `impl JsClass for NewSocket` (no generics) and a single
// set of `${Name}__fromJS`/`__create` externs, but this type maps to TWO
// codegen classes (`JSTCPSocket` / `JSTLSSocket`). The codegen accessors are
// hand-dispatched per-monomorphisation in the `impl` block below instead.
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). The codegen
// shim still emits `this: &mut NewSocket` — `&mut T` auto-derefs to `&T`
// so the impls below compile against either. With every
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
    /// The callbacks this socket dispatches to: shared with its listener and
    /// sibling sockets (server), or with its own reconnects and TLS twin
    /// (client). `None` once the socket has gone idle or been detached, which
    /// every dispatch entry point treats as "nothing left to call".
    ///
    /// `Rc`, not a raw pointer: JS dispatch is reentrant (a `close` handler can
    /// re-enter `connect` and repoint this field) and every in-flight callback
    /// [`Scope`] holds its own reference, so the callbacks outlive the frame
    /// that is running them.
    pub handlers: JsCell<Option<Rc<Handlers>>>,
    /// Reference to the JS wrapper. Held strong while the socket is active so the
    /// wrapper cannot be garbage-collected out from under in-flight callbacks, and
    /// downgraded to weak once the socket is closed/inactive so GC can reclaim it.
    pub this_value: JsCell<JsRef>,
    pub poll_ref: JsCell<KeepAlive>,
    pub ref_pollref_on_connect: Cell<bool>,
    pub connection: JsCell<Option<super::listener::UnixOrHost>>,
    /// `localAddress`/`localPort` from the connect options: the socket is
    /// bound to this address before connecting. Always a literal IP.
    pub local_binding: JsCell<Option<(Box<[u8]>, u16)>>,
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
    // LIFETIMES.tsv says `Option<Rc<Self>>`, but `*Self` is stored in
    // a uws ext slot (FFI) and is intrusively refcounted — PORTING.md mandates
    // IntrusiveRc, never Rc, when *T crosses FFI.
    pub twin: JsCell<Option<IntrusiveRc<Self>>>,
    /// Owned copy of the handshake verify error, so `getAuthorizationError()`
    /// keeps its verdict after detach (the live error borrows the `SSL`, and
    /// EPROTO reasons are stack-copied in uSockets).
    pub verify_error: JsCell<Option<StoredVerifyError>>,
}

/// Associated `Socket` handler type.
pub(super) type SocketHandler<const SSL: bool> = uws::NewSocketHandler<SSL>;

// Intrusive refcount mixin.
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
            if !VirtualMachine::get().is_shutting_down() {
                self.entered.mark_inactive();
            }
        }
        // Last: this can be the final ref, freeing the socket read above.
        this.get().deref();
    }
}

/// Drains the thread's BoringSSL error queue on scope exit, whichever way the
/// scope is left.
struct ClearErrorQueue(bool);

impl Drop for ClearErrorQueue {
    fn drop(&mut self) {
        if self.0 {
            boringssl_sys::ERR_clear_error();
        }
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

impl Drop for PendingSystemError {
    fn drop(&mut self) {
        if let Some(err) = self.0.take() {
            err.deref();
        }
    }
}

/// `needs_deref` releases the ref the now-detached native socket held. The idle
/// teardown is gated on the socket still holding the `Handlers` we entered with:
/// `onConnectError` can reconnect, and we must not tear that connection down.
struct ConnectErrorTeardown<const SSL: bool> {
    socket: bun_ptr::ThisPtr<NewSocket<SSL>>,
    entered: Rc<Handlers>,
    needs_deref: bool,
}

impl<const SSL: bool> Drop for ConnectErrorTeardown<SSL> {
    fn drop(&mut self) {
        let this = self.socket;
        // `deref` before `mark_inactive`, as the hand-rolled guard did. It
        // cannot free the socket here: `handle_connect_error`'s `_keepalive`
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
        std::ptr::from_ref::<Self>(self).cast_mut()
    }

    // ─────────────────────────────────────────────────────────────────────────

    // Intrusive refcount API.
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

    // ── codegen accessors ──
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
    pub fn handlers_set_cached(this: JSValue, global: &JSGlobalObject, value: JSValue) {
        jsc::mark_binding!();
        if SSL {
            js_TLSSocket::handlers_set_cached(this, global, value);
        } else {
            js_TCPSocket::handlers_set_cached(this, global, value);
        }
    }

    /// Heap-allocates the socket; ownership passes to the intrusive refcount.
    /// The returned handle is live by construction.
    pub fn new(init: Self) -> bun_ptr::ThisPtr<Self> {
        // SAFETY: freshly allocated, non-null.
        unsafe { bun_ptr::ThisPtr::new(bun_core::heap::into_raw(Box::new(init))) }
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
        // IntrusiveRc holds the +1 by construction (caller
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
                h2.deref();
            }
            NativeCallbacks::None => {}
        }
    }

    /// Connect to `self.connection` (must be `Some`). Reads the field directly
    /// rather than taking it by-ref so the single caller in `connect_finish`
    /// doesn't need a disjoint borrow.
    pub fn do_connect(&self) -> crate::Result<()> {
        // Keep `self` alive across the re-entrant connect path.
        // SAFETY: `self` is live for this call and outlives the sockets below.
        let this = unsafe { bun_ptr::ThisPtr::new(self.as_ctx_ptr()) };
        let _guard = this.ref_guard();

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
                        uws::ConnectResult::Failed => {
                            return Err(crate::Error::FailedToOpenSocket);
                        }
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
            Some(UnixOrHost::Unix(u)) => {
                let s = group.connect_unix(
                    kind,
                    ssl_ctx,
                    u,
                    flags,
                    core::mem::size_of::<*mut c_void>() as c_int,
                );
                if s.is_null() {
                    return Err(crate::Error::FailedToOpenSocket);
                }
                *uws::us_socket_t::opaque_mut(s).ext() = Some(this);
                self.socket.set(SocketHandler::<SSL>::from(s));
            }
            Some(UnixOrHost::Fd(f)) => {
                // `LIBUS_SOCKET_DESCRIPTOR` is `c_int` on POSIX, `SOCKET`
                // (`usize`) on Windows; `Fd::native()` is `c_int` / HANDLE
                // (`*mut c_void`) respectively; cast to bridge the Rust-side `usize` alias.
                let s = group.from_fd(
                    kind,
                    ssl_ctx,
                    core::mem::size_of::<*mut c_void>() as c_int,
                    f.native() as uws::LIBUS_SOCKET_DESCRIPTOR,
                    false,
                );
                if s.is_null() {
                    return Err(crate::Error::ConnectionFailed);
                }
                *uws::us_socket_t::opaque_mut(s).ext() = Some(this);
                let sock = SocketHandler::<SSL>::from(s);
                self.socket.set(sock);
                Self::on_open(this, sock);
            }
            None => unreachable!("do_connect requires self.connection to be set"),
        }
        Ok(())
    }

    // no `#[bun_jsc::host_fn]` here — that macro's free-fn shim
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

        // `initialDelay` is documented in milliseconds; TCP_KEEPIDLE is seconds.
        let initial_delay_ms: u32 = if args.len > 1 {
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
        let initial_delay = initial_delay_ms / 1000;
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

    /// `_handle.setTypeOfService(tos)` - returns 0 on success or a negative
    /// platform errno (Node's TCPWrap::SetTypeOfService convention, so the JS
    /// layer can hand it to ErrnoException).
    #[bun_jsc::host_fn(method)]
    pub fn set_type_of_service(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old::<1>();
        let tos: i32 = if args.len >= 1 {
            let arg = args.ptr[0];
            // validate_integer_range maps NaN to the default; node:net rejects
            // it with ERR_INVALID_ARG_TYPE, so do that explicitly here.
            if arg.is_number() && arg.as_number().is_nan() {
                return Err(global.throw_invalid_property_type_value(b"tos", b"integer", arg));
            }
            global.validate_integer_range(
                arg,
                0i32,
                bun_sql_jsc::jsc::IntegerRange {
                    min: 0,
                    max: 255,
                    field_name: b"tos",
                    ..Default::default()
                },
            )?
        } else {
            0
        };
        log!("setTypeOfService({})", tos);
        Ok(JSValue::from(this.socket.get().set_tos(tos)))
    }

    /// `_handle.getTypeOfService()` - returns the value (>= 0) or a negative
    /// platform errno.
    #[bun_jsc::host_fn(method)]
    pub fn get_type_of_service(
        this: &Self,
        _global: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        log!("getTypeOfService()");
        Ok(JSValue::from(this.socket.get().get_tos()))
    }

    /// `handle.resumeSNI(secureContextOrNull, isError)` - resumes a server
    /// handshake suspended by an asynchronous SNICallback. A no-op when the
    /// socket already closed (the resolution outlived the connection).
    #[bun_jsc::host_fn(method)]
    pub fn resume_sni(
        this: &Self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old::<2>();
        log!("resumeSNI");
        let socket = this.socket.get();
        if socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        let is_error = args.len > 1 && args.ptr[1].to_boolean();
        // The selected context: a native SecureContext (borrow() hands back an
        // owned SSL_CTX reference that us_socket_sni_resolve consumes) or null
        // to fall through to the listener's default context.
        let ctx_ptr = if args.len >= 1 && !is_error {
            if let Some(sc) =
                args.ptr[0].as_class_ref::<crate::api::bun_secure_context::SecureContext>()
            {
                sc.borrow()
            } else {
                core::ptr::null_mut()
            }
        } else {
            core::ptr::null_mut()
        };
        socket.sni_resolve(ctx_ptr.cast(), is_error);
        Ok(JSValue::UNDEFINED)
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
        let scope = handlers.enter();
        let global = handlers.global_object;
        let this_value = self.get_this_value(&global);
        let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
        self.exit_scope(scope);
    }

    /// Takes `ThisPtr<Self>`, not `&mut self`: `callback.call(...)` re-enters
    /// JS which can call `socket.write()`/`end()`/`reload()` on this same
    /// wrapper via the JS object's `m_ptr`, re-deriving a borrow and mutating
    /// `flags`/`handlers`/`ref_count`/`buffered_data_for_node_net`. A live
    /// `&mut self` across that call is aliasing UB and lets LLVM cache those
    /// fields and dead-store the re-entrant write. `ThisPtr` derefs yield a
    /// short-lived shared borrow per access; none span `callback.call`.
    pub fn on_writable(this: bun_ptr::ThisPtr<Self>, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        // A late event on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to.
        if !this.has_handlers() {
            return;
        }
        if this.socket.get().is_detached() {
            return;
        }
        if this.native_callback.get().on_writable() {
            return;
        }
        let handlers = this.get_handlers();
        let callback = handlers.on_writable();
        if callback.is_empty() {
            return;
        }

        let vm = handlers.vm;
        if vm.is_shutting_down() {
            return;
        }
        // Hold the socket alive for the rest of the dispatch: `internal_flush`
        // and the drain callback can both re-enter JS and close it.
        let _keepalive = this.ref_guard();
        // NOTE (Windows): the drain dispatch deliberately does not depend on
        // whether the flush hit a fatal send error. Skipping it on fatal
        // (tried in f0325bddf2) made Windows servers reset FIN-terminated
        // responses: write_check_error's fatal detection interacts with
        // Windows would-block semantics, and a skipped drain stalls the
        // response teardown into an RST. Until that detection is verified on
        // Windows, keep the legacy contract there (the close path still fails
        // the pending write callback when the socket is torn down).
        let fatal_send_errno = this.internal_flush();
        // On POSIX the fatal signal is trustworthy: us_socket_write_check_error
        // only reports an errno that is either known peer-gone or persisted
        // across its bounded unclassified-errno retry window. internal_flush
        // already dropped the undeliverable buffer and the writable poll is no
        // longer re-armed, so this dispatch is the last place the errno is
        // visible - swallowing it here acknowledged the bytes to JS, sent a
        // clean FIN, and the peer saw a silently truncated stream. Deliver it
        // like a failed write (syscall "write", same shape as net.ts
        // failWrite) and close the socket so 'error' is followed by 'close'.
        #[cfg(not(windows))]
        if fatal_send_errno != 0 {
            let global = handlers.global_object;
            let scope = handlers.enter();
            let this_value = this.get_this_value(&global);
            let err_value = <sys::Error as jsc::SysErrorJsc>::to_js(
                &sys::Error::from_code_int(fatal_send_errno, sys::Tag::write),
                &global,
            );
            let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
            // The error handler can destroy the socket itself; only close a
            // still-attached socket. Close without detaching so on_close runs
            // and JS observes 'close' (mirrors h2's dead-transport close).
            if !this.socket.get().is_detached() {
                this.socket.get().close(uws::CloseCode::Normal);
            }
            this.exit_scope(scope);
            return;
        }
        #[cfg(windows)]
        let _ = fatal_send_errno;
        log!(
            "onWritable buffered_data_for_node_net {}",
            this.buffered_data_for_node_net.get().len()
        );
        // is not writable if we have buffered data or if we are already detached
        if this.buffered_data_for_node_net.get().len() > 0 || this.socket.get().is_detached() {
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        this.exit_scope(scope);
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_timeout(this: bun_ptr::ThisPtr<Self>, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        // A late event on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to.
        if !this.has_handlers() {
            return;
        }
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
        let callback = handlers.on_timeout();
        if callback.is_empty() || this.flags.get().contains(Flags::FINALIZING) {
            return;
        }
        if handlers.vm.is_shutting_down() {
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        this.exit_scope(scope);
    }

    /// This socket's callbacks. Panics if it has none — every dispatch entry
    /// point checks [`has_handlers`](Self::has_handlers) first.
    ///
    /// Returns a fresh `Rc`, so JS re-entrancy from the caller (a `close`
    /// handler that reconnects, an `upgradeTLS` that transfers the handlers to
    /// a twin) cannot free the callbacks the caller is still reading.
    pub fn get_handlers(&self) -> Rc<Handlers> {
        self.handlers_opt().expect("No handlers set on Socket")
    }

    #[inline]
    pub fn handlers_opt(&self) -> Option<Rc<Handlers>> {
        self.handlers.get().clone()
    }

    #[inline]
    pub fn has_handlers(&self) -> bool {
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
    /// `dns_error` is the raw `getaddrinfo(3)` return code when the name
    /// lookup itself failed; 0 for a connect failure past name resolution
    /// (then `errno` carries the connect error).
    pub fn handle_connect_error(
        this: bun_ptr::ThisPtr<Self>,
        errno: c_int,
        dns_error: i32,
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
        // before clear_and_free/unrefOnNextTick so the ref is balanced even if
        // those calls unwind.
        let _keepalive = this.ref_guard();
        this.buffered_data_for_node_net
            .with_mut(|b| b.clear_and_free());

        let needs_deref = !this.socket.get().is_detached();
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
            needs_deref,
        };

        if vm.is_shutting_down() {
            drop(cleanup);
            return Ok(());
        }

        let callback = handlers.on_connect_error();
        let global = handlers.global_object;
        // A failed name lookup is reported as the resolver error
        // (`getaddrinfo ENOTFOUND <hostname>`, `syscall`/`hostname` set),
        // matching `node:dns` — never collapsed into ECONNREFUSED. On that
        // path `errno` carries the same (possibly negative) getaddrinfo code
        // as `dns_error`, so it is only treated as an errno in the else arm.
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
            debug_assert!(errno >= 0);
            // Unix-path connect errors keep their real code (a non-socket file
            // is ENOTSOCK, a permission-denied path is EACCES, a missing one is
            // ENOENT, an inexpressible path is EINVAL); everything else stays
            // ECONNREFUSED.
            let errno_: c_int = if errno == sys::SystemErrno::ENOENT as c_int
                || errno == sys::SystemErrno::ENOTSOCK as c_int
                || errno == sys::SystemErrno::EACCES as c_int
                || errno == sys::SystemErrno::EINVAL as c_int
                || errno == sys::SystemErrno::ECONNRESET as c_int
                || errno == sys::SystemErrno::EADDRINUSE as c_int
                || errno == sys::SystemErrno::EADDRNOTAVAIL as c_int
            {
                errno
            } else {
                sys::SystemErrno::ECONNREFUSED as c_int
            };
            let code_ = if errno == sys::SystemErrno::ENOENT as c_int {
                BunString::static_("ENOENT")
            } else if errno == sys::SystemErrno::ENOTSOCK as c_int {
                BunString::static_("ENOTSOCK")
            } else if errno == sys::SystemErrno::EACCES as c_int {
                BunString::static_("EACCES")
            } else if errno == sys::SystemErrno::EINVAL as c_int {
                BunString::static_("EINVAL")
            } else if errno == sys::SystemErrno::ECONNRESET as c_int {
                BunString::static_("ECONNRESET")
            } else if errno == sys::SystemErrno::EADDRINUSE as c_int {
                BunString::static_("EADDRINUSE")
            } else if errno == sys::SystemErrno::EADDRNOTAVAIL as c_int {
                BunString::static_("EADDRNOTAVAIL")
            } else {
                BunString::static_("ECONNREFUSED")
            };
            #[cfg(windows)]
            let errno_ = {
                let mut errno_ = errno_;
                if errno_ == sys::SystemErrno::ENOENT as c_int {
                    errno_ = sys::SystemErrno::UV_ENOENT as c_int;
                }
                if errno_ == sys::SystemErrno::ECONNREFUSED as c_int {
                    errno_ = sys::SystemErrno::UV_ECONNREFUSED as c_int;
                }
                errno_
            };
            SystemError {
                errno: -errno_,
                message: BunString::static_("Failed to connect"),
                syscall: BunString::static_("connect"),
                code: code_,
                path: BunString::EMPTY,
                hostname: BunString::EMPTY,
                fd: c_int::MIN,
                dest: BunString::EMPTY,
            }
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
            } else {
                // No callback and no promise (the duplex TLS upgrade flow):
                // nothing consumed `err`, so release the strings it holds.
                err.deref();
            }

            return Ok(());
        }

        let this_value = this.get_this_value(&global);
        this_value.ensure_still_alive();
        // Connection failed before open; allow the wrapper to be GC'd once this
        // callback returns. The on-stack `this_value` keeps it alive for the call.
        this.this_value.with_mut(|r| r.downgrade());

        let mut err_for_promise = PendingSystemError(Some(err.dupe()));
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
        // then `cleanup` → needs_deref/markInactive/deref.
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as
    /// `handle_connect_error`.
    pub fn on_connect_error(
        this: bun_ptr::ThisPtr<Self>,
        socket: SocketHandler<SSL>,
        errno: c_int,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        Self::handle_connect_error(this, errno, socket.dns_error())
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
    pub fn detach_for_reconnect(&self) {
        let old = self.socket.get();
        let Some(ext) = old.ext::<*mut c_void>() else {
            return;
        };
        // SAFETY: ext slot is sized for `*mut c_void`; single-threaded.
        unsafe { *ext = core::ptr::null_mut() };
        self.socket.set(SocketHandler::<SSL>::DETACHED);
        self.buffered_data_for_node_net
            .with_mut(|b| b.clear_and_free());
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

    pub fn is_server(&self) -> bool {
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
    pub fn acts_as_tls_server(&self) -> bool {
        self.is_server() || self.flags.get().contains(Flags::TLS_SERVER_ROLE)
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`:
    /// `resolve_promise`/`callback.call` re-enter JS which can mutate this
    /// socket via `m_ptr`.
    pub fn on_open(this: bun_ptr::ThisPtr<Self>, socket: SocketHandler<SSL>) {
        let this_ptr = this.as_ptr();
        // A late event on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to.
        if !this.has_handlers() {
            return;
        }
        log!(
            "onOpen {} {:p} {} {}",
            if this.is_server() { "S" } else { "C" },
            this_ptr,
            this.socket.get().is_detached(),
            this.ref_count.get()
        );
        // Ensure the socket remains alive: the callbacks below re-enter JS.
        let _keepalive = this.ref_guard();

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
                    // A server needs the per-connection ALPN selector when it
                    // has static ALPNProtocols OR a dynamic ALPNCallback (the
                    // selector consults the callback first and falls back to
                    // the static list). The callback reads `this` from the SSL,
                    // not the CTX-level arg (shared across the listener).
                    // ffi-safe-fn: opaque-ZST `&SSL`/`&SSL_CTX` redecls;
                    // `ssl_ptr` non-null in this branch and `SSL_get_SSL_CTX`
                    // never returns null for a live SSL.
                    if this.is_server()
                        && (this.protos.get().is_some()
                            || !this.get_handlers().on_alpn_callback().is_empty())
                    {
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
                    }
                    if let Some(protos) = this.protos.get() {
                        if this.is_server() {
                            // Registered above (selector + ex_data); nothing
                            // further to do for the static server list here.
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
        let callback = handlers.on_open();
        let handshake_callback = handlers.on_handshake();

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
                return;
            }
        } else {
            if callback.is_empty() {
                return;
            }
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = handlers.enter();
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
        if !SSL
            && !this.socket.get().is_detached()
            && this.buffered_data_for_node_net.get().len() > 0
        {
            // A write issued from inside the open/'connection' callback (a
            // server answering the moment a connection arrives) can be
            // deferred into `buffered_data_for_node_net` before the socket has
            // any usockets-level backpressure, so no writable event would ever
            // flush it and its JS write callback would never run - the socket
            // then never finishes and holds the event loop (the FIN-terminated
            // http response tests hung on every Linux target). Deliver it now
            // that the open dispatch is done; if it fully drains, complete the
            // pending JS write the same way on_writable's tail does, otherwise
            // the do_socket_write backpressure arms the normal writable
            // subscription.
            let _ = this.internal_flush();
            if this.buffered_data_for_node_net.get().len() == 0 {
                let drain_callback = handlers.on_writable();
                if !drain_callback.is_empty() {
                    if let Err(err) = drain_callback.call(&global, this_value, &[this_value]) {
                        let _ = handlers
                            .call_error_handler(this_value, &[this_value, global.take_error(err)]);
                    }
                }
            }
        }
        this.exit_scope(scope);
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

    /// Points this socket at `handlers` and, when its JS wrapper already
    /// exists (the `node:net` prev-socket reuse paths), stores the new cell in
    /// the wrapper's visited slot. Fresh wrappers get it in
    /// [`get_this_value`](Self::get_this_value).
    pub fn set_handlers(&self, global: &JSGlobalObject, handlers: Option<Rc<Handlers>>) {
        self.handlers.set(handlers);
        if let (Some(handlers), Some(wrapper)) =
            (self.handlers.get(), self.this_value.get().try_get())
        {
            Self::handlers_set_cached(wrapper, global, handlers.cell());
        }
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_end(this: bun_ptr::ThisPtr<Self>, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        // A late event on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to.
        if !this.has_handlers() {
            return;
        }
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
        let _keepalive = this.ref_guard();

        let callback = handlers.on_end();
        let vm = handlers.vm;
        if callback.is_empty() || vm.is_shutting_down() {
            this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));

            // If you don't handle TCP fin, we assume you're done.
            this.mark_inactive();
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        if let Err(err) = callback.call(&global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        this.exit_scope(scope);
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_handshake(
        this: bun_ptr::ThisPtr<Self>,
        s: SocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        // A late event on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to.
        if !this.has_handlers() {
            return Ok(());
        }
        this.update_flags(|f| f.insert(Flags::HANDSHAKE_COMPLETE));
        this.socket.set(s);
        if this.socket.get().is_detached() {
            return Ok(());
        }
        // Keep the socket alive across the callbacks below (which re-enter JS)
        // and across `reject_unauthorized_connection`, whose close may
        // otherwise drop the last reference.
        let _keepalive = this.ref_guard();
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

        let mut authorized = success == 1;
        let mut hostname_mismatch = false;
        let mut hostname_mismatch_message: Option<Box<[u8]>> = None;

        if SSL && authorized && !this.acts_as_tls_server() {
            if let Some(ssl_ptr) = this.socket.get().ssl() {
                let hostname: &[u8] = if let Some(server_name) = this.server_name.get() {
                    &server_name[..]
                } else if let Some(super::listener::UnixOrHost::Host { host, .. }) =
                    this.connection.get()
                {
                    &host[..]
                } else {
                    b""
                };
                if !hostname.is_empty()
                    && !bun_boringssl::check_server_identity(
                        boringssl_sys::SSL::opaque_mut(ssl_ptr),
                        hostname,
                    )
                {
                    authorized = false;
                    hostname_mismatch = true;
                    let mut message =
                        String::from("Hostname/IP does not match certificate's altnames: ");
                    // Infallible: the writer is a `String`.
                    let _ = bun_boringssl::write_server_identity_mismatch_reason(
                        boringssl_sys::SSL::opaque_mut(ssl_ptr),
                        hostname,
                        &mut message,
                    );
                    hostname_mismatch_message = Some(message.into_bytes().into_boxed_slice());
                }
            }
        }

        let verify_failed = SSL && ssl_error.error_no != 0;

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

        // node:tls sockets defer the hostname verdict: their JS layer applies
        // `checkServerIdentity` (default or user override) itself.
        let flags = this.flags.get();
        let reject_unauthorized = success == 1
            && flags.contains(Flags::REJECT_UNAUTHORIZED)
            && (verify_failed
                || (hostname_mismatch && !flags.contains(Flags::DEFERS_SERVER_IDENTITY)));

        // `REJECTED` is set before the callback runs so no write path can
        // deliver application data to a peer that is about to be rejected —
        // including the raw twin of an `upgradeTLS` pair, which shares the fd.
        this.update_flags(|f| {
            f.set(Flags::AUTHORIZED, authorized && !verify_failed);
            f.set(Flags::HOSTNAME_MISMATCH, hostname_mismatch);
            f.set(Flags::REJECTED, reject_unauthorized);
        });
        if reject_unauthorized {
            if let Some(twin) = this.twin.get().as_ref() {
                twin.update_flags(|f| f.insert(Flags::REJECTED));
            }
        }

        let mut callback = handlers.on_handshake();
        let mut is_open = false;

        if handlers.vm.is_shutting_down() {
            // `on_close` skips its JS dispatch during shutdown, so the native
            // close is still safe here.
            if reject_unauthorized {
                this.reject_unauthorized_connection();
            }
            return Ok(());
        }

        // Use open callback when handshake is not provided
        if callback.is_empty() {
            callback = handlers.on_open();
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
        let scope = handlers.enter();

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
                handlers.clear_on_open();
            }
        } else {
            // call handhsake callback with authorized and authorization error if has one
            let authorization_error: JSValue = if ssl_error.error_no == 0 {
                // node:tls (DEFERS) builds its own identity error in JS.
                if hostname_mismatch && !flags.contains(Flags::DEFERS_SERVER_IDENTITY) {
                    this.stored_verify_error_to_js(&global)
                        .unwrap_or(JSValue::NULL)
                } else {
                    JSValue::NULL
                }
            } else {
                match super::uws_jsc::verify_error_to_js(&ssl_error, &global) {
                    Ok(v) => v,
                    Err(e) => {
                        // `Scope` has no Drop — balance event_loop().enter() and
                        // active_connections before propagating.
                        this.exit_scope(scope);
                        if reject_unauthorized {
                            // Take the pending exception before `on_close` re-enters JS.
                            let pending = global.take_exception(e);
                            this.reject_unauthorized_connection();
                            return Err(global.throw_value(pending));
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
        this.exit_scope(scope);
        if reject_unauthorized {
            this.reject_unauthorized_connection();
        }
        Ok(())
    }

    /// Stamps the resolved client `rejectUnauthorized` policy on a fresh or
    /// reused (reconnect) wrapper, clearing any previous handshake verdict.
    pub(crate) fn reset_client_tls_flags(&self, reject_unauthorized: bool) {
        self.verify_error.set(None);
        self.update_flags(|f| {
            f.remove(
                Flags::HANDSHAKE_COMPLETE
                    | Flags::AUTHORIZED
                    | Flags::HOSTNAME_MISMATCH
                    | Flags::REJECTED,
            );
            f.set(Flags::REJECT_UNAUTHORIZED, reject_unauthorized);
        });
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

    /// A new resumable TLS session arrived (the peer's NewSessionTicket was
    /// processed during an earlier `SSL_read`). Hands the serialized session
    /// to the JS `session` handler, mirroring Node's `onnewsession` callback.
    /// Dispatched from `ssl_flush_pending_session()` after the SSL stack has
    /// unwound, so the JS handler may safely destroy the socket.
    ///
    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_session(this: bun_ptr::ThisPtr<Self>, session: &[u8]) -> JsResult<()> {
        jsc::mark_binding!();
        if this.socket.get().is_detached() {
            return Ok(());
        }
        // Same late-event guard as the other dispatch entry points: the
        // socket may already have released its Handlers.
        if !this.has_handlers() {
            return Ok(());
        }
        let handlers = this.get_handlers();
        if handlers.vm.is_shutting_down() {
            return Ok(());
        }
        let callback = handlers.on_session();
        if callback.is_empty() {
            return Ok(());
        }
        let scope = handlers.enter();
        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let buffer = match JSValue::create_buffer_from_length(&global, session.len()) {
            Ok(b) => b,
            Err(e) => {
                this.exit_scope(scope);
                return Err(e);
            }
        };
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
            let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
        }
        this.exit_scope(scope);
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_keylog(this: bun_ptr::ThisPtr<Self>, line: &[u8]) -> JsResult<()> {
        jsc::mark_binding!();
        if this.socket.get().is_detached() {
            return Ok(());
        }
        // Same late-event guard as the other dispatch entry points: the
        // socket may already have released its Handlers.
        if !this.has_handlers() {
            return Ok(());
        }
        let handlers = this.get_handlers();
        if handlers.vm.is_shutting_down() {
            return Ok(());
        }
        let callback = handlers.on_keylog();
        if callback.is_empty() {
            return Ok(());
        }
        let scope = handlers.enter();
        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let buffer = match JSValue::create_buffer_from_length(&global, line.len()) {
            Ok(b) => b,
            Err(e) => {
                this.exit_scope(scope);
                return Err(e);
            }
        };
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
            let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
        }
        this.exit_scope(scope);
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_close(
        this: bun_ptr::ThisPtr<Self>,
        socket: SocketHandler<SSL>,
        err: c_int,
        reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        // A late close on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to, but the caller transferred its +1 (the
        // ext-slot/owner pin) - release it and detach so nothing further
        // dispatches either. mark_inactive is not needed: handlers being
        // null means the previous teardown already ran it.
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
        this.detach_native_callback();
        this.socket.set(SocketHandler::<SSL>::DETACHED);
        // The upgradeTLS raw twin shares the same us_socket_t so it never
        // gets its own dispatch — fire its (pre-upgrade) close handler
        // here, then retire it. `raw.twin == None` so this doesn't
        // recurse, and `onClose` derefs the +1 we took at creation.
        if let Some(raw) = this.twin.with_mut(|t| t.take()) {
            // `on_close` consumes the twin's +1 via its `CloseTeardown`, so
            // hand over the raw pointer rather than letting `IntrusiveRc::drop`
            // release it a second time.
            Self::on_close(raw.into_this_ptr(), socket, err, reason).ok();
        }
        let cleanup = CloseTeardown {
            socket: this,
            entered: Rc::clone(&handlers),
        };

        if this.flags.get().contains(Flags::FINALIZING) {
            drop(cleanup);
            return Ok(());
        }

        let vm = handlers.vm;
        this.poll_ref.with_mut(|p| p.unref(js_loop_ctx()));

        let callback = handlers.on_close();

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
        let scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let mut js_error: JSValue = JSValue::UNDEFINED;
        // `err` is overloaded: when WE closed the socket it's a libus
        // CloseCode enum (0=clean, 1=failure/RST, 2=fast-shutdown); when the
        // close was driven by a recv() failure (loop.c:664) or a poll error
        // (loop.c's EPOLLERR/EV_ERROR branch, which reports SO_ERROR) it's the
        // actual errno. Neither producer can yield EPERM(1)/ENOENT(2) — recv
        // never returns them and the poll-error branch clamps them away — so
        // values >2 are real read errnos and 0/1/2 are self-initiated closes
        // that must not surface as a JS read error (matching Node's
        // onStreamRead, which only sees errors that came from uv_read_cb).
        if err > 2 {
            js_error = <sys::Error as jsc::SysErrorJsc>::to_js(
                &sys::Error::from_code_int(err, sys::Tag::read),
                &global,
            );
        }

        if let Err(e) = callback.call(&global, this_value, &[this_value, js_error]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(e)]);
        }
        this.exit_scope(scope);
        drop(cleanup);
        Ok(())
    }

    /// Takes `ThisPtr<Self>` for the same re-entrancy reason as `on_writable`.
    pub fn on_data(this: bun_ptr::ThisPtr<Self>, s: SocketHandler<SSL>, data: &[u8]) {
        jsc::mark_binding!();
        // A late event on a socket that already released its Handlers through
        // a path that did not route back through this dispatch - e.g. a
        // JS-side destroy on a TLS socket driven by an upgraded duplex. There
        // is nothing to dispatch to.
        if !this.has_handlers() {
            return;
        }
        this.socket.set(s);
        if this.socket.get().is_detached() {
            return;
        }
        if this.native_callback.get().on_data(data) {
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

        let callback = handlers.on_data();
        if callback.is_empty() || this.flags.get().contains(Flags::FINALIZING) {
            return;
        }
        if handlers.vm.is_shutting_down() {
            return;
        }

        let global = handlers.global_object;
        let this_value = this.get_this_value(&global);
        let output_value = match handlers.binary_type.get().to_js(data, &global) {
            Ok(v) => v,
            Err(err) => {
                this.handle_error(global.take_exception(err));
                return;
            }
        };

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let scope = handlers.enter();

        // const encoding = handlers.encoding;
        if let Err(err) = callback.call(&global, this_value, &[this_value, output_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        this.exit_scope(scope);
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

        if handlers.mode != super::SocketMode::Server || this.socket.get().is_detached() {
            return JSValue::UNDEFINED;
        }

        let Some(listener) = handlers.listener() else {
            return JSValue::UNDEFINED;
        };
        listener
            .this_value
            .get()
            .try_get()
            .unwrap_or(JSValue::UNDEFINED)
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

    fn stored_verify_error_to_js(&self, global: &JSGlobalObject) -> Option<JSValue> {
        self.verify_error.get().as_ref().map(|stored| {
            let err = SystemError {
                errno: 0,
                code: BunString::clone_utf8(&stored.code),
                message: BunString::clone_utf8(&stored.reason),
                path: BunString::EMPTY,
                syscall: BunString::EMPTY,
                hostname: BunString::EMPTY,
                fd: c_int::MIN,
                dest: BunString::EMPTY,
            };
            err.to_error_instance(global)
        })
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_authorization_error(
        this: &Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if this.socket.get().is_detached() {
            // The verdict must survive the forced close.
            return Ok(this
                .stored_verify_error_to_js(global)
                .unwrap_or(JSValue::NULL));
        }

        // this error can change if called in different stages of hanshake
        // is very usefull to have this feature depending on the user workflow
        let ssl_error = this.socket.get().get_verify_error();
        if ssl_error.error_no == 0 {
            return Ok(this
                .stored_verify_error_to_js(global)
                .unwrap_or(JSValue::NULL));
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
        // `:port` and brackets), so pass a `SocketAddr` — bare `IpAddr` corrupts IPv6.
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

    /// Vectored raw write for plain-TCP sockets: all chunks reach the fd in one
    /// writev. Callers guarantee this socket has no TLS layer (raw writes bypass
    /// SSL framing). Updates bytes_written like the scalar path.
    pub fn write_vectored_raw(&self, iov: &[bun_uws_sys::UsIoVec]) -> i32 {
        let socket = self.socket.get();
        if socket.is_shutdown() || socket.is_closed() {
            return -1;
        }
        if SSL && self.flags.get().contains(Flags::REJECTED) {
            return -1;
        }
        let res = socket.raw_writev(iov);
        let uwrote: usize = usize::try_from(res.max(0)).expect("int cast");
        self.bytes_written
            .set(self.bytes_written.get() + uwrote as u64);
        res
    }

    pub fn write_maybe_corked(&self, buffer: &[u8]) -> i32 {
        let socket = self.socket.get();
        if socket.is_shutdown() || socket.is_closed() {
            return -1;
        }
        let flags = self.flags.get();
        if SSL && flags.contains(Flags::REJECTED) {
            return -1;
        }

        // The raw [raw, tls] upgrade twin shares the TLS half's us_socket_t
        // (`s->ssl` is set) but must write raw bytes: write_check_error would
        // route it through the SSL-encrypting us_socket_write, and its fatal
        // signal is never set for TLS sockets anyway.
        if flags.contains(Flags::BYPASS_TLS) {
            let res = self.do_socket_write(buffer);
            let uwrote: usize = usize::try_from(res.max(0)).expect("int cast");
            self.bytes_written
                .set(self.bytes_written.get() + uwrote as u64);
            log!("write({}) = {}", buffer.len(), res);
            return res;
        }

        let (res, fatal_errno) = socket.write_check_error(buffer);
        if fatal_errno != 0 {
            // Kernel rejected the send (peer gone): return the negative errno so
            // JS fails the write; never close from under the caller's stack, and
            // leave the undeliverable buffer to the caller (aliasing).
            return -fatal_errno;
        }
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
                    if wrote < -1 {
                        // Fatal send (peer gone): hand JS the negative errno so
                        // node:net fails the write like Node's onWriteComplete;
                        // -1 stays the legacy closed/shutdown sentinel.
                        JSValue::js_number(f64::from(wrote))
                    } else if usize::try_from(wrote.max(0)).expect("int cast") == total {
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
        // `write_or_end_buffered` reaches `internal_flush`, which re-enters JS.
        // SAFETY: the JS wrapper holds a ref for the whole host-fn call.
        let _keepalive = unsafe { bun_ptr::ScopedRef::new(this.as_ctx_ptr()) };
        let result = match this.write_or_end_buffered::<true>(global, args.ptr[0], args.ptr[1]) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, total } => {
                if wrote >= 0 && usize::try_from(wrote).expect("int cast") == total {
                    let _ = this.internal_flush();
                }

                JSValue::from(usize::try_from(wrote.max(0)).expect("int cast") == total)
            }
        };
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

        #[allow(unused_labels)]
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
                            // Result intentionally discarded
                            let _ = self
                                .buffered_data_for_node_net
                                .with_mut(|b| b.append_slice(remaining_in_input_data));
                        }

                        break 'brk rc;
                    }
                }
            }

            // slower-path: clone the data, do one write.
            // Result intentionally discarded
            let _ = self
                .buffered_data_for_node_net
                .with_mut(|b| b.append_slice(buffer.slice()));
            // R-2: `write_maybe_corked` takes `&self` and does not touch
            // `buffered_data_for_node_net`, so a `JsCell::get()` projection
            // is valid for the duration of the call.
            let rc = self.write_maybe_corked(self.buffered_data_for_node_net.get().slice());
            if rc < 0 {
                // Fatal write error (or the socket is already shut down/closed):
                // the buffered bytes can never be delivered - drop them now that
                // the borrow of their slice has ended.
                self.buffered_data_for_node_net
                    .with_mut(|b| b.clear_and_free());
            } else if rc > 0 {
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
                    .with_mut(|b| b.append_slice(remaining)); // OOM/capacity: fire-and-forget
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

    /// Flushes the node:net buffered tail. Returns 0, or the positive errno of
    /// a fatal send error (buffer dropped, writable not re-armed).
    /// On POSIX, `on_writable` consumes the errno: it dispatches the error
    /// handler and closes the socket. On Windows the errno is still ignored
    /// (the drain callback is dispatched regardless) - skipping the drain on
    /// fatal made Windows servers reset FIN-terminated responses (see
    /// a5e7ba5905) - until the Windows fatal-write detection is verified.
    fn internal_flush(&self) -> i32 {
        // A TLS socket whose handshake was rejected has no usable transport:
        // never push the buffered tail at it, and report no error (the
        // rejection is surfaced by the handshake path, not by the flush).
        if SSL && self.flags.get().contains(Flags::REJECTED) {
            return 0;
        }
        // R-2: every mutated field is `Cell`/`JsCell`, so `&self` carries no
        // `noalias` for them and the previous `black_box` launder (which
        // mitigated ASM-verified PROVEN_CACHED stale loads of
        // `bytes_written`/`flags`/`buffered_data_for_node_net` across the
        // re-entrant `do_socket_write`) is no longer needed.
        if self.buffered_data_for_node_net.get().len() > 0 {
            // Neither write call touches `buffered_data_for_node_net`, so a
            // `JsCell::get()` projection is valid for the duration of the call.
            //
            // The drain-driven retry must detect a fatal send error the same way
            // the initial write does: once the peer is gone the kernel rejects
            // every retry (EPIPE/ECONNRESET), and treating that as would-block
            // kept this buffer parked forever (the FIN-terminated-response hang).
            // BYPASS_TLS twins keep the raw write path; TLS errors propagate
            // through the SSL layer.
            let res: i32 = if self.flags.get().contains(Flags::BYPASS_TLS) {
                self.do_socket_write(self.buffered_data_for_node_net.get().slice())
            } else {
                let (res, fatal_errno) = self
                    .socket
                    .get()
                    .write_check_error(self.buffered_data_for_node_net.get().slice());
                if fatal_errno != 0 {
                    // Same rule as write_maybe_corked: drop the undeliverable
                    // buffer, stop re-arming the writable retry, and report the
                    // errno so the event-loop caller surfaces it (the data was
                    // already acknowledged to JS, so only an 'error' can).
                    self.buffered_data_for_node_net
                        .with_mut(|b| b.clear_and_free());
                    return fatal_errno;
                }
                res
            };
            let written: usize = usize::try_from(res.max(0)).unwrap();
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
        0
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush(this: &Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        jsc::mark_binding!();
        // `end()` → `internalFlush` → `markInactive` → `closeAndDetach(.normal)`
        // detaches `this.socket` and, for TLS, defers the raw close until the
        // peer's close_notify arrives — leaving `is_active` set so the eventual
        // `onClose` can run `handlers.markInactive()`. Without this guard a
        // follow-up `flush()` re-enters `markInactive`, sees the detached
        // socket as closed, and decrements `active_connections` a second time;
        // the deferred `onClose` then underflows it. Every other
        // `internalFlush` caller already has this check.
        if this.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        let _ = this.internal_flush();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn terminate(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        // Capture the in-flight-connect state before close_and_detach() sets
        // DETACHED. Resetting a SEMI_SOCKET (Connected arm, handshake not yet
        // established) dispatches no terminal callback in us_socket_close, so
        // on_close/mark_inactive never runs — balance connect_finish's ref_(),
        // downgrade the Strong this_value, and release the event-loop ref here,
        // exactly as close() does. Without it those refs leak (LSan-caught).
        let socket = this.socket.get();
        let is_semi_connect = socket.socket.get().is_some() && !socket.is_established();
        this.close_and_detach(uws::CloseCode::Failure);
        if is_semi_connect {
            this.poll_ref.with_mut(|p| {
                p.unref(bun_io::posix_event_loop::get_vm_ctx(
                    bun_io::AllocatorType::Js,
                ))
            });
            if !matches!(this.this_value.get(), JsRef::Finalized) {
                this.this_value.with_mut(|r| r.downgrade());
            }
            this.deref();
        }
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
        let socket = this.socket.get();
        // An in-flight `connect()` whose `on_open` has not fired yet is a
        // SEMI_SOCKET — `us_socket_close` skips dispatch for those (firing
        // `on_close` without a prior `on_open` is wrong, and the natural
        // failure path delivers `on_connect_error` from the loop instead).
        // Closing one here therefore runs *no* terminal callback, stranding
        // the +1 `connect_finish` took on `this` (whose matching `deref()`
        // lives in `on_close`/`handle_connect_error`) and the Strong
        // `this_value` upgrade. node:net reaches this for every aborted /
        // `autoSelectFamily`-timed-out attempt via `_handle.close()`.
        //
        // `socket.socket.get().is_some()` is `true` only for the
        // `Connected(us_socket_t)` arm — the `Connecting` arm fires
        // `on_connecting_error` synchronously inside `close()` and so does
        // its own `deref()`; double-releasing it would underflow.
        let is_semi_connect = socket.socket.get().is_some() && !socket.is_established();
        // `_handle.close()` is the net.Socket `_destroy()` path — Node emits close_notify
        // once and closes the fd without waiting for the peer's reply. `.fast_shutdown`
        // makes `ssl_handle_shutdown` take the fast branch so the raw close runs
        // synchronously (with `.normal` the SSL layer defers waiting for the peer, but we
        // detach + unref immediately below, orphaning the `us_socket_t`). NOT `.failure`:
        // that arms SO_LINGER{1,0} → RST and drops any data still in the kernel send
        // buffer, which `destroy()` after `write()` must not do. The SSL layer may
        // briefly defer this close behind its own ciphertext write spill
        // (`ssl_close_after_spill`); that waits only on our fd, not the peer.
        socket.close(uws::CloseCode::FastShutdown);
        this.socket.set(SocketHandler::<SSL>::DETACHED);
        let _ = global;
        this.poll_ref.with_mut(|p| {
            p.unref(bun_io::posix_event_loop::get_vm_ctx(
                bun_io::AllocatorType::Js,
            ))
        });
        if is_semi_connect {
            if !matches!(this.this_value.get(), JsRef::Finalized) {
                this.this_value.with_mut(|r| r.downgrade());
            }
            // Balance `connect_finish`'s `socket_ref.ref_()`. The JS wrapper
            // we were called through holds the remaining +1, so refcount
            // stays ≥ 1 across this call.
            this.deref();
        }
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

        // `write_or_end` reaches `internal_flush`, which re-enters JS.
        // SAFETY: the JS wrapper holds a ref for the whole host-fn call.
        let _keepalive = unsafe { bun_ptr::ScopedRef::new(this.as_ctx_ptr()) };
        let result = match this.write_or_end::<true>(global, args.mut_(), false) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, total } => {
                if wrote >= 0 && usize::try_from(wrote).expect("int cast") == total {
                    let _ = this.internal_flush();
                }
                JSValue::js_number(wrote as f64)
            }
        };
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
        // Not a `ThisPtr`: the refcount is already zero, so `ref_guard()` here
        // would be a resurrection bug.
        // SAFETY: per fn contract — sole owner, live until the `heap::take` below.
        let this_ref: &Self = unsafe { &*this };
        this_ref.mark_inactive();
        this_ref.detach_native_callback();
        // Reset to empty (Strong drops on assign).
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
        } else {
            this_ref.detach_native_callback();
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

        let handlers = this.get_handlers();
        // Parse and validate first: the option getters run user JS that can
        // close this socket and repoint its `Handlers`.
        let reloaded = Handlers::prepare_reload(global, socket_obj)?;
        if !this.handlers_are(&handlers) {
            return Ok(JSValue::UNDEFINED);
        }
        // Update the callbacks of the existing cell in place, so the listener
        // and every socket sharing it observe them; nothing else about the
        // shared `Handlers` (mode, active_connections) is touched.
        handlers.apply_reload(global, &reloaded);

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fd(this: &Self, _global: &JSGlobalObject) -> JSValue {
        // On Windows the fd is a system-kind SOCKET handle; routing it through
        // `.uv()` panics for anything but stdio. The sys_jsc helper branches on
        // kind (system→u64, uv→i32, posix→i32).
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
        let args = callframe.arguments_old::<1>();
        if args.len < 1 {
            return Err(global.throw(format_args!("Expected 1 arguments")));
        }
        Self::upgrade_tls_impl(this, global, args.ptr[0], false)
    }

    /// `defers_server_identity`: node:tls owns hostname policy in its JS layer
    /// (`checkServerIdentity`), so its internal entry point sets it; the public
    /// `upgradeTLS` never does.
    pub(crate) fn upgrade_tls_impl(
        this: &Self,
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
        let uws::InternalSocket::Connected(raw_socket) = this.socket.get().socket else {
            return Err(global.throw_invalid_arguments(format_args!(
                "upgradeTLS requires an established socket"
            )));
        };
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return Err(global.throw(format_args!("Expected options object")));
        }

        // Server-side upgrade (`new tls.TLSSocket(socket, { isServer: true })`):
        // adopt the fd into an accept-state SSL so the native read path drives the
        // handshake — same code path as the client upgrade, only `is_client` flips.
        // An explicit `isServer` option wins over the underlying socket's mode so
        // an outgoing connection can still be wrapped as the server side, the way
        // Node honors the option regardless of how the socket was created.
        let is_server = match opts.get_truthy(global, "isServer")? {
            Some(value) => value.to_boolean(),
            None => this.is_server(),
        };

        let socket_obj = opts
            .get(global, "socket")?
            .ok_or_else(|| global.throw(format_args!("Expected \"socket\" option")))?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        // Bytes already consumed from the wire before the upgrade (e.g. the
        // ClientHello sitting in the readable buffer of the socket being
        // wrapped); fed into the TLS engine once the upgrade is wired up.
        let initial_data: Vec<u8> = match opts.get_truthy(global, "initialData")? {
            Some(v) => StringOrBuffer::from_js(global, v)?
                .map(|data| data.slice().to_vec())
                .unwrap_or_default(),
            None => Vec::new(),
        };
        // Client mode: a standalone `new TLSSocket(socket, { isServer })` is NOT
        // a SocketListener, so these handlers have no listener to release. The
        // server-ness lives in the SSL accept state (adopt_tls
        // is_client=!is_server) + the ServerHandlers JS table, not here.
        let handlers = Handlers::from_js(global, socket_obj, super::SocketMode::Client)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        // Nothing holds the callback cell until the TLS wrapper below does.
        let _cell_root = handlers.root_cell(global);

        // Resolve the `SSL_CTX*`. Prefer a passed `SecureContext` (the
        // memoised `tls.createSecureContext` path) so 10k upgrades share
        // one `SSL_CTX_new`; otherwise build an owned one from inline
        // `tls:` options. Either way `owned_ctx` holds one ref we drop in
        // deinit; SSL_new() takes its own.
        //
        let owned_ctx: Option<boringssl_sys::OwnedSslCtx>;
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
            let Some(sc) = sc_js.as_class_ref::<SecureContext>() else {
                return Err(global.throw_invalid_argument_type_value(
                    b"secureContext",
                    b"SecureContext",
                    sc_js,
                ));
            };
            // `borrow()` returns a +1 ref (it calls `SSL_CTX_up_ref`).
            // SAFETY: that ref is ours to release.
            owned_ctx =
                unsafe { boringssl_sys::OwnedSslCtx::from_raw(sc.borrow().cast::<SSL_CTX>()) };
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
                ssl_opts = Some(crate::socket::tls_true_defaults(handlers.vm));
            }
            let cfg = ssl_opts
                .as_mut()
                .ok_or_else(|| global.throw(format_args!("Expected \"tls\" option")))?;
            let mut create_err = uws::create_bun_socket_error_t::none;
            // Per-VM weak cache: `tls:true` and `{servername}`-only hit
            // the same CTX as `Bun.connect`; an inline CA dedupes across
            // every upgradeTLS that names it.
            // `bun_jsc::rare_data::RareData::ssl_ctx_cache()` returns
            // the high-tier opaque ZST stub (cycle-break); the concrete
            // `SSLContextCache` lives on this thread's `RuntimeState`.
            let cache = {
                let state = crate::jsc_hooks::runtime_state();
                debug_assert!(!state.is_null(), "RuntimeState not installed");
                // SAFETY: per-thread `RuntimeState` boxed by `init_runtime_state`;
                // stable address for the VM's lifetime, JS-thread-only access.
                unsafe { &mut (*state).ssl_ctx_cache }
            };
            owned_ctx = match cache.get_or_create(cfg, &mut create_err) {
                // SAFETY: `get_or_create` hands back a +1 ref.
                Some(c) => unsafe { boringssl_sys::OwnedSslCtx::from_raw(c.cast::<SSL_CTX>()) },
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

        let vm = handlers.vm;

        let cfg = ssl_opts.as_ref();
        let reject_unauthorized =
            upgrade_reject_policy(vm, cfg, is_server, owned_ctx.as_ref().map(|c| c.as_ptr()));
        let mut initial_flags = Flags::initial(reject_unauthorized);
        initial_flags.set(Flags::DEFERS_SERVER_IDENTITY, defers_server_identity);
        initial_flags.set(Flags::TLS_SERVER_ROLE, is_server);
        let tls: bun_ptr::ThisPtr<TLSSocket> = TLSSocket::new(TLSSocket {
            ref_count: bun_ptr::RefCount::init(),
            handlers: JsCell::new(Some(handlers)),
            socket: Cell::new(SocketHandler::<true>::DETACHED),
            // Ownership of the +1 `SSL_CTX` ref transfers here; the
            // `OwnedSslCtx` guard stays armed until this point.
            owned_ssl_ctx: Cell::new(owned_ctx.map(|c| c.into_raw())),
            connection: JsCell::new(this.connection.get().clone()),
            local_binding: JsCell::new(None),
            protos: JsCell::new(cfg.and_then(|c| c.protos_bytes().map(Box::<[u8]>::from))),
            server_name: JsCell::new(
                cfg.and_then(|c| c.server_name_bytes().map(Box::<[u8]>::from)),
            ),
            flags: Cell::new(initial_flags),
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            buffered_data_for_node_net: JsCell::new(Vec::new()),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
            verify_error: JsCell::new(None),
        });
        // Never shadow this with a long-lived borrow: it would alias the
        // reference dispatch materialises from the ext slot during
        // `on_open`/`start_tls_handshake`.

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
                &mut *(tls.owned_ssl_ctx.get().unwrap()),
                sni,
                !is_server,
                core::mem::size_of::<*mut c_void>() as i32,
                core::mem::size_of::<*mut c_void>() as i32,
            )
        } {
            Some(s) => s,
            None => {
                let err = boringssl_sys::ERR_get_error();
                let _clear_err = ClearErrorQueue(err != 0);
                // `deref` runs `deinit_and_destroy`, which drops the owned_ctx
                // ref and the handlers `Rc`. Sole owner of the fresh allocation.
                tls.get().deref();
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
        let raw_handlers = this.take_handlers();
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
        // Release the retired TCP wrapper's ref on EVERY exit past this point,
        // including the `?` early-returns below.
        // SAFETY: `this` owns the outstanding ref this guard consumes; the JS
        // wrapper's own +1 keeps the allocation alive across the whole call.
        let _this_deref = unsafe { bun_ptr::ScopedRef::adopt(this.as_ctx_ptr()) };
        this.detach_native_callback();
        this.socket.set(SocketHandler::<SSL>::DETACHED);

        // Only NOW is it safe for dispatch to fire: ext + kind point at `tls`.
        *uws::us_socket_t::opaque_mut(new_raw.as_ptr()).ext() = Some(tls);
        tls.socket
            .set(SocketHandler::<true>::from(new_raw.as_ptr()));
        tls.ref_();

        // The `raw` half — same `us_socket_t*`, ORIGINAL pre-upgrade
        // *Handlers, writes bypass SSL. Dispatch reaches it via the
        // `ssl_raw_tap` ciphertext hook, never via the ext slot.
        let raw = TLSSocket::new(TLSSocket {
            ref_count: bun_ptr::RefCount::init(),
            handlers: JsCell::new(raw_handlers),
            socket: Cell::new(SocketHandler::<true>::from(new_raw.as_ptr())),
            owned_ssl_ctx: Cell::new(None),
            connection: JsCell::new(None),
            local_binding: JsCell::new(None),
            protos: JsCell::new(None),
            server_name: JsCell::new(None),
            // is_active so the chained `raw.onClose` → `markInactive` path
            // releases `raw_handlers`. No poll_ref — `tls` keeps the loop
            // alive. active_connections=1 was already on raw_handlers from
            // `this`.
            flags: Cell::new(Flags::BYPASS_TLS | Flags::IS_ACTIVE | Flags::OWNED_PROTOS),
            this_value: JsCell::new(JsRef::empty()),
            poll_ref: JsCell::new(KeepAlive::init()),
            ref_pollref_on_connect: Cell::new(true),
            buffered_data_for_node_net: JsCell::new(Vec::new()),
            bytes_written: Cell::new(0),
            native_callback: JsCell::new(NativeCallbacks::None),
            twin: JsCell::new(None),
            verify_error: JsCell::new(None),
        });
        let raw_ref = raw;
        raw_ref.ref_();
        // SAFETY: `raw` came from `TLSSocket::new` (heap::alloc); intrusive +1 held.
        tls.twin
            .set(Some(unsafe { IntrusiveRc::from_raw(raw.as_ptr()) }));
        // S008: `us_socket_t` is an `opaque_ffi!` ZST — safe deref.
        bun_opaque::opaque_deref_mut(new_raw.as_ptr()).set_ssl_raw_tap(true);

        let tls_js_value = tls.get_this_value(global);
        let raw_js_value = raw_ref.get_this_value(global);
        TLSSocket::data_set_cached(tls_js_value, global, default_data);
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
        TLSSocket::on_open(tls, tls.socket.get());
        bun_opaque::opaque_deref_mut(new_raw.as_ptr()).start_tls_handshake();
        // The socket being wrapped may have had its readable interest off (an
        // accepted socket nobody was reading yet — its ClientHello is still in
        // the kernel buffer); make sure the adopted TLS socket is reading so
        // the handshake can be driven. A no-op when it was already reading.
        bun_opaque::opaque_deref_mut(new_raw.as_ptr()).resume();
        // Feed bytes that arrived before the upgrade (already pulled off the fd
        // by the plain-TCP layer) into the TLS engine exactly as if they had
        // just been received — for a server-side wrap this is the ClientHello.
        if !initial_data.is_empty() {
            bun_opaque::opaque_deref_mut(new_raw.as_ptr()).tls_feed(initial_data.as_slice());
        }

        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(global, 0, raw_js_value)?;
        array.put_index(global, 1, tls_js_value)?;
        Ok(array)
    }

    // ──────────────────────────────────────────────────────────────────────
    // TLS-only accessor methods. Rust cannot const-select inherent methods on a const
    // generic bool, so these are all forwarding methods that branch on `SSL`
    // at runtime (monomorphised away).
    //
    // rustc does not unify `NewSocket<SSL>` with `NewSocket<true>`
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
    pub fn set_key_cert(this: &Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL {
            tls_socket_functions::set_key_cert(Self::as_tls(this), g, f)
        } else {
            Ok(JSValue::UNDEFINED)
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
    /// `&self` borrows the socket's `JsCell<NativeCallbacks>`; the dispatch
    /// re-enters JS, which can `detach_native_callback` and overwrite that cell.
    /// Copy the parser pointer out first; the callee's `keepalive()` holds it.
    pub fn on_data(&self, data: &[u8]) -> bool {
        let h2 = match self {
            NativeCallbacks::H2(h2) => h2.as_ptr(),
            NativeCallbacks::None => return false,
        };
        // SAFETY: `on_native_read` takes a keepalive; `h2` stays live across re-entry.
        unsafe { (*h2).on_native_read(data).is_ok() }
    }
    pub fn on_writable(&self) -> bool {
        let h2 = match self {
            NativeCallbacks::H2(h2) => h2.as_ptr(),
            NativeCallbacks::None => return false,
        };
        // SAFETY: `on_native_writable` takes a keepalive; `h2` stays live across re-entry.
        unsafe { (*h2).on_native_writable() };
        true
    }
}

// ──────────────────────────────────────────────────────────────────────────
// WriteResult
// ──────────────────────────────────────────────────────────────────────────

enum WriteResult {
    Fail,
    Success { wrote: i32, total: usize },
}

pub struct StoredVerifyError {
    pub code: Box<[u8]>,
    pub reason: Box<[u8]>,
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
        /// The peer failed verification under an enforcing policy: the socket
        /// refuses writes and is closed right after the handshake callback.
        const REJECTED             = 1 << 10;
        const HOSTNAME_MISMATCH    = 1 << 11;
        const REJECT_UNAUTHORIZED  = 1 << 12;
        /// Set only by the node:net / node:tls socket constructors: their JS
        /// layer owns server-identity policy (`checkServerIdentity`), so a
        /// hostname mismatch alone is reported but never enforced natively.
        const DEFERS_SERVER_IDENTITY = 1 << 13;
        /// `upgradeTLS({ isServer: true })`: the socket acts as the TLS server
        /// even though its `Handlers` mode is `Client` (no listener), so the
        /// client-only server-identity check must not run against its peer.
        const TLS_SERVER_ROLE      = 1 << 14;
    }
}

impl Flags {
    fn initial(reject_unauthorized: bool) -> Flags {
        let mut flags = Flags::default();
        flags.set(Flags::REJECT_UNAUTHORIZED, reject_unauthorized);
        flags
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

/// A bare server-side `secureContext` carries no parsed config, so the policy
/// comes from the ctx itself: `us_ssl_ctx_from_options` sets
/// `FAIL_IF_NO_PEER_CERT` iff the context was created with `rejectUnauthorized`.
fn server_ctx_rejects_unauthorized(ctx: Option<*mut SSL_CTX>) -> bool {
    let Some(ctx) = ctx else { return false };
    const MODE: c_int =
        boringssl_sys::SSL_VERIFY_PEER | boringssl_sys::SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
    // SAFETY: `ctx` is the +1 `SSL_CTX` ref held for this socket; read-only.
    unsafe { boringssl_sys::SSL_CTX_get_verify_mode(ctx) & MODE == MODE }
}

impl Default for Flags {
    fn default() -> Self {
        // Default: `owned_protos` true, all others false.
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

pub(super) struct DuplexUpgradeContext {
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
    mode: SocketMode,
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum EventState {
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
            TLSSocket::on_open(tls.this_ptr(), socket);
        }
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            TLSSocket::on_data(tls.this_ptr(), socket, decoded_data);
        }
    }

    fn on_session(&mut self, session: &[u8]) {
        if let Some(tls) = &mut self.tls {
            let _ = TLSSocket::on_session(tls.this_ptr(), session);
        }
    }

    fn on_keylog(&mut self, line: &[u8]) {
        if let Some(tls) = &mut self.tls {
            let _ = TLSSocket::on_keylog(tls.this_ptr(), line);
        }
    }

    fn on_handshake(&mut self, success: bool, ssl_error: uws::us_bun_verify_error_t) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            let tls = tls.this_ptr();
            let _ = TLSSocket::on_handshake(tls, socket, success as i32, ssl_error);
        }
    }

    fn on_end(&mut self) {
        let socket = self.duplex_socket();
        if let Some(tls) = &mut self.tls {
            TLSSocket::on_end(tls.this_ptr(), socket);
        }
    }

    fn on_writable(&mut self) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            TLSSocket::on_writable(tls.this_ptr(), socket);
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
                // → `markInactive` releases `tls.handlers`; null `tls` so the
                // still-queued `.StartTLS` → `onOpen` — and any further
                // duplex events — skip the TLSSocket instead of hitting
                // `has_handlers() == false` in `onOpen`.
                //
                // Refcount: `tls.socket` is `InternalSocket::UpgradedDuplex`
                // here (assigned in `js_upgrade_duplex_to_tls` *before*
                // `start_tls()` enqueues anything and before any duplex
                // callback can dispatch), so `handle_connect_error`'s
                // `needs_deref = !is_detached()` is `true` and it consumes
                // the owner's +1 we hold. Do NOT let `IntrusiveRc::Drop`
                // fire on top of that (over-deref → UAF on the JS wrapper's
                // pointee).
                let p = tls.into_this_ptr();
                let _ =
                    TLSSocket::handle_connect_error(p, sys::SystemErrno::ECONNREFUSED as c_int, 0);
            }
        }
    }

    fn on_timeout(&mut self) {
        let socket = self.duplex_socket();

        if let Some(tls) = &mut self.tls {
            TLSSocket::on_timeout(tls.this_ptr(), socket);
        }
    }

    fn on_close(&mut self) {
        let socket = self.duplex_socket();

        if let Some(tls) = self.tls.take() {
            // `tls.onClose` consumes the +1 we hold (its scope-exit deref
            // is the ext-slot/owner pin). Null our pointer first so the
            // `deinitInNextTick` → `deinit` path doesn't deref it a second
            // time — that's the over-deref behind the cross-file
            // `TLSSocket.finalize` use-after-poison. It also means a throw
            // from `duplex.end()` (called right after this returns via
            // `UpgradedDuplex.onClose` → `callWriteOrEnd`) hits the null-check
            // in `onError` instead of reading the Handlers that `tls.onClose`
            // → `markInactive` just released.
            let p = tls.into_this_ptr();
            let _ = TLSSocket::on_close(p, socket, 0, None);
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
                let started: crate::Result<()> = {
                    // SAFETY: `this` is live; this `&mut` is scoped to the block
                    // and ends before any `Self::deinit` call below.
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
                    if matches!(err, crate::Error::Alloc(_)) {
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
                        let p = tls.into_this_ptr();
                        let _ = TLSSocket::handle_connect_error(p, errno, 0);
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
                // Release the owner's +1.
                tls.deref();
            }
            // Close raced ahead of StartTLS — drop the unconsumed config.
            this_ref.ssl_config = None;
            if let Some(ctx) = this_ref.owned_ctx.take() {
                // SAFETY: BoringSSL FFI; we hold one owned ref.
                unsafe { boringssl_sys::SSL_CTX_free(ctx) };
            }
        }
        // `UpgradedDuplex` cleanup
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

/// node:tls's `tls.connect({ socket })` entry point: same upgrade as the
/// public `upgradeTLS`, but hostname policy stays with node's JS layer.
#[bun_jsc::host_fn]
pub fn js_upgrade_tls_deferred(
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding!();
    let [socket, opts] = callframe.arguments_as_array::<2>();
    if let Some(this) = socket.as_class_ref::<TCPSocket>() {
        return NewSocket::<false>::upgrade_tls_impl(this, global, opts, true);
    }
    if let Some(this) = socket.as_class_ref::<TLSSocket>() {
        return NewSocket::<true>::upgrade_tls_impl(this, global, opts, true);
    }
    Err(global.throw(format_args!("Expected a socket instance")))
}

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
    // `DuplexServer` mode makes `TLSSocket.isServer()` report the server role
    // for ALPN without claiming a listener parent — these handlers have none,
    // so `mark_inactive` must take the client path. The TLS direction itself is
    // controlled by DuplexUpgradeContext.mode.
    let handlers = Handlers::from_js(
        global,
        socket_obj,
        if is_server {
            crate::socket::SocketMode::DuplexServer
        } else {
            crate::socket::SocketMode::Client
        },
    )?;
    // Nothing holds the callback cell until the TLS wrapper below does.
    let _cell_root = handlers.root_cell(global);

    // Resolve the `SSL_CTX*`. Prefer a passed `SecureContext` (the memoised
    // `tls.createSecureContext` path — what `[buntls]` now returns) so the
    // duplex/named-pipe path shares one `SSL_CTX_new` with everyone else.
    // node:net wraps `[buntls]`'s return as `opts.tls.secureContext`; userland
    // may also pass it top-level. Same lookup as `upgradeTLS` above.
    let mut owned_ctx: Option<boringssl_sys::OwnedSslCtx> = None;
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
        let Some(sc) = sc_js.as_class_ref::<SecureContext>() else {
            return Err(global.throw_invalid_argument_type_value(
                b"secureContext",
                b"SecureContext",
                sc_js,
            ));
        };
        // `borrow()` returns a +1 ref (it calls `SSL_CTX_up_ref`).
        // SAFETY: that ref is ours to release.
        owned_ctx = unsafe { boringssl_sys::OwnedSslCtx::from_raw(sc.borrow().cast::<SSL_CTX>()) };
    }

    // Still parse SSLConfig for servername/ALPN (those live on the JS-side
    // wrapper, not the SSL_CTX) and as the build source when no SecureContext.
    let mut ssl_opts: Option<SSLConfig> = None;
    // Drop frees ssl_opts on error.
    if let Some(tls) = opts.get_truthy(global, "tls")? {
        if !tls.is_boolean() {
            ssl_opts = SSLConfig::from_js(handlers.vm, global, tls)?;
        } else if tls.to_boolean() {
            ssl_opts = Some(crate::socket::tls_true_defaults(handlers.vm));
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

    let reject_unauthorized = upgrade_reject_policy(
        handlers.vm,
        socket_config,
        is_server,
        owned_ctx.as_ref().map(|c| c.as_ptr()),
    );
    // Client duplex upgrades come from net.ts, whose JS layer owns
    // server-identity policy; http2's server upgrade also lands here, where
    // the deferral is meaningless.
    let initial_flags = Flags::initial(reject_unauthorized)
        | if is_server {
            Flags::empty()
        } else {
            Flags::DEFERS_SERVER_IDENTITY
        };
    let tls = TLSSocket::new(TLSSocket {
        ref_count: bun_ptr::RefCount::init(),
        handlers: JsCell::new(Some(handlers)),
        socket: Cell::new(SocketHandler::<true>::DETACHED),
        owned_ssl_ctx: Cell::new(None),
        connection: JsCell::new(None),
        local_binding: JsCell::new(None),
        protos: JsCell::new(
            socket_config.and_then(|cfg| cfg.protos_bytes().map(Box::<[u8]>::from)),
        ),
        server_name: JsCell::new(
            socket_config.and_then(|cfg| cfg.server_name_bytes().map(Box::<[u8]>::from)),
        ),
        flags: Cell::new(initial_flags),
        this_value: JsCell::new(JsRef::empty()),
        poll_ref: JsCell::new(KeepAlive::init()),
        ref_pollref_on_connect: Cell::new(true),
        buffered_data_for_node_net: JsCell::new(Vec::new()),
        bytes_written: Cell::new(0),
        native_callback: JsCell::new(NativeCallbacks::None),
        twin: JsCell::new(None),
        verify_error: JsCell::new(None),
    });
    let tls_ref = tls;
    let tls_js_value = tls_ref.get_this_value(global);
    TLSSocket::data_set_cached(tls_js_value, global, default_data);

    // The +1 `SSL_CTX` ref transfers into `DuplexUpgradeContext.owned_ctx` below.
    let owned_ctx_taken = owned_ctx.map(|c| c.into_raw());

    // `DuplexUpgradeContext` is self-referential: `task.ctx` and
    // `upgrade.handlers.ctx` both point at the containing allocation, and
    // `UpgradedDuplex` has fn-ptr-niched fields plus a `Drop` impl, so it
    // cannot be value-constructed with a placeholder and assigned later
    // (`=` would Drop the placeholder; `zeroed()` is an invalid value).
    // Allocate uninit, leak to a raw pointer for the stable address, then
    // field-write everything in place — `upgrade` last, once the address is
    // known.
    let duplex_context: *mut DuplexUpgradeContext = bun_core::heap::into_raw(Box::new(
        core::mem::MaybeUninit::<DuplexUpgradeContext>::uninit(),
    ))
    .cast();
    // SAFETY: fresh heap allocation; every field is `ptr::write`-initialized
    // below before any read or `&mut DuplexUpgradeContext` is formed.
    unsafe {
        ptr::addr_of_mut!((*duplex_context).tls).write(Some(IntrusiveRc::from_raw(tls.as_ptr())));
        ptr::addr_of_mut!((*duplex_context).vm).write(VirtualMachine::get());
        // `AnyTask::New` can't take the callback as a type parameter (see the
        // notes in AnyTask.rs), so hand-write the `*mut c_void → run_event` shim.
        ptr::addr_of_mut!((*duplex_context).task).write(AnyTask {
            ctx: NonNull::new(duplex_context.cast::<c_void>()),
            callback: |p| {
                // SAFETY: `p` is the `*mut DuplexUpgradeContext` stored in
                // `ctx`. `run_event` may free the allocation, so pass the raw
                // pointer through — never form a `&mut` here whose protector
                // would span the dealloc.
                DuplexUpgradeContext::run_event(p.cast::<DuplexUpgradeContext>());
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
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_open: |c: *mut ()| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_open()
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_data: |c: *mut (), d| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_data(d)
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_handshake: |c: *mut (), ok, err| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_handshake(ok, err)
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_close: |c: *mut ()| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_close()
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_end: |c: *mut ()| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_end()
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_writable: |c: *mut ()| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_writable()
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_error: |c: *mut (), e| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_error(e)
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_timeout: |c: *mut ()| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_timeout()
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_session: |c: *mut (), s| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_session(s)
                },
                // SAFETY: `c` is `ctx` below — the live `DuplexUpgradeContext` heap allocation.
                on_keylog: |c: *mut (), l| {
                    bun_ptr::callback_ctx::<DuplexUpgradeContext>(c.cast()).on_keylog(l)
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
    // Disarm the guard — either moved into duplexContext or just
    // freed above; both the move-target and the deinit case must not see it
    // freed again on a later throw.
    let _ = ssl_opts;
    tls_ref.ref_();

    tls_ref.socket.set(from_duplex::<true>(&mut dc.upgrade));
    tls_ref.mark_active();
    // Unlike a real socket, a TLS engine over a JS stream has no I/O of its
    // own to wait for - it is driven entirely by the stream's events - so it
    // must not hold the event loop open. Node's TLSWrap over a JS stream
    // behaves the same way: a script that leaves a duplexPair-backed TLS pair
    // dangling still exits. If the underlying stream is a real socket, that
    // socket's own handle keeps the loop alive.

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

    let Some(socket) = arguments[0].as_class_ref::<TCPSocket>() else {
        return Err(global.throw(format_args!("Expected a SocketTCP instance")));
    };

    let is_for_send_buffer = arguments[1].to_int32() == 1;
    let is_for_recv_buffer = arguments[1].to_int32() == 2;
    let buffer_size = arguments[2].to_int32();
    let file_descriptor = socket.socket.get().fd();

    #[cfg(unix)]
    {
        // `bun_sys` exposes no public wrapper, so call libc directly.
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

pub mod testing_apis {
    use super::*;

    #[bun_jsc::host_fn]
    pub fn js_socket_fault_injection_available(
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        Ok(JSValue::from(cfg!(socket_fault_injection)))
    }

    #[bun_jsc::host_fn]
    pub fn js_clear_socket_faults(
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
    pub fn js_set_socket_fault(global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

            let syscall_str =
                bun_core::OwnedString::new(match opts.get_truthy(global, "syscall")? {
                    Some(v) => v.to_bun_string(global)?,
                    None => {
                        return Err(global.throw_invalid_argument_type_value(
                            "rule.syscall",
                            "string",
                            JSValue::UNDEFINED,
                        ));
                    }
                });
            let syscall: c_int = if syscall_str.eql_comptime(b"recv") {
                fi::RECV
            } else if syscall_str.eql_comptime(b"send") {
                fi::SEND
            } else if syscall_str.eql_comptime(b"writev") {
                fi::WRITEV
            } else if syscall_str.eql_comptime(b"sendmsg") {
                fi::SENDMSG
            } else if syscall_str.eql_comptime(b"recvmsg") {
                fi::RECVMSG
            } else if syscall_str.eql_comptime(b"connect") {
                fi::CONNECT
            } else if syscall_str.eql_comptime(b"accept") {
                fi::ACCEPT
            } else if syscall_str.eql_comptime(b"ssl_loop_buffer") {
                fi::SSL_LOOP_BUFFER
            } else {
                // socket/close/shutdown have enum slots but no bsd.c hooks;
                // accepting them would arm rules that can never fire.
                return Err(global.throw(format_args!(
                    "rule.syscall must be one of: recv, send, writev, sendmsg, recvmsg, connect, accept, ssl_loop_buffer"
                )));
            };

            let action_str =
                bun_core::OwnedString::new(match opts.get_truthy(global, "action")? {
                    Some(v) => v.to_bun_string(global)?,
                    None => {
                        return Err(global.throw_invalid_argument_type_value(
                            "rule.action",
                            "string",
                            JSValue::UNDEFINED,
                        ));
                    }
                });
            let action: c_int = if action_str.eql_comptime(b"errno") {
                fi::ACTION_ERRNO
            } else if action_str.eql_comptime(b"short") {
                fi::ACTION_SHORT
            } else if action_str.eql_comptime(b"zero") {
                fi::ACTION_ZERO
            } else if action_str.eql_comptime(b"none") {
                fi::ACTION_NONE
            } else {
                return Err(global.throw(format_args!(
                    "rule.action must be one of: errno, short, zero, none"
                )));
            };

            // "short" clamps a byte count, which only recv/send have; arming it
            // on any other syscall would silently never fire.
            if action == fi::ACTION_SHORT && syscall != fi::RECV && syscall != fi::SEND {
                return Err(global.throw(format_args!(
                    "rule.action \"short\" is only supported for syscall \"recv\" or \"send\""
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

            let errno_value: c_int = match opts.get_truthy(global, "errno")? {
                None if action == fi::ACTION_ERRNO => {
                    return Err(global.throw(format_args!(
                        "rule.errno is required when action is \"errno\""
                    )));
                }
                None => 0,
                Some(v) if v.is_number() => v.coerce_to_i32(global)?,
                Some(v) => {
                    let name = bun_core::OwnedString::new(v.to_bun_string(global)?);
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

            // ssl_loop_buffer is an allocation, not a socket operation: its hook
            // passes fd = -1, so a rule pinned to a descriptor would arm and then
            // silently never fire.
            let target_fd = get_i32("fd", -1)?;
            if syscall == fi::SSL_LOOP_BUFFER && target_fd != -1 {
                return Err(global.throw(format_args!(
                    "rule.fd is not supported for syscall \"ssl_loop_buffer\""
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
    fn parse_errno_name(name: &bun_core::OwnedString) -> Option<c_int> {
        macro_rules! map {
            ($($s:literal => $v:expr,)*) => {
                $(if name.eql_comptime($s) { return Some($v as c_int); })*
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
pub use testing_apis as testing_ap_is;
