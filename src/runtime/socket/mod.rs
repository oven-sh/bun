//! Port of `src/runtime/socket/socket.zig`.
//!
//! TCP/TLS socket JS bindings (`Bun.connect` / `Bun.listen` socket wrappers).

use core::cell::Cell;
use core::ffi::{c_char, c_int, c_uint, c_void};
use core::ptr;
use std::rc::Rc;

use bun_aio::KeepAlive;
use bun_ptr::IntrusiveRc;
use bun_boringssl as boringssl;
use bun_boringssl_sys::{SSL, SSL_CTX};
use bun_collections::BabyList;
use bun_core::{self, fmt as bun_fmt};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsRef, JsResult, Strong, SystemError,
    VirtualMachine,
};
use bun_str::{self as bstr, String as BunString, ZigString, ZStr};
use bun_sys as sys;
use bun_uws as uws;

// ──────────────────────────────────────────────────────────────────────────
// Re-exports
// ──────────────────────────────────────────────────────────────────────────

pub use super::socket_address::SocketAddress;
pub use super::handlers::Handlers;
pub use super::handlers::SocketConfig;
pub use super::listener::Listener;
#[cfg(windows)]
pub use super::windows_named_pipe_context::WindowsNamedPipeContext;
#[cfg(not(windows))]
pub type WindowsNamedPipeContext = ();

mod tls_socket_functions;
use bun_runtime::api::bun::h2_frame_parser::H2FrameParser;
use bun_runtime::api::SecureContext;

bun_output::declare_scope!(Socket, visible);
macro_rules! log {
    ($($arg:tt)*) => { bun_output::scoped_log!(Socket, $($arg)*) };
}

// ──────────────────────────────────────────────────────────────────────────
// JSSocketType — codegen selector
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): in Zig this returns the codegen module (`jsc.Codegen.JSTCPSocket`
// vs `JSTLSSocket`). Rust codegen exposes these as `bun_jsc::codegen::*`; the
// `#[bun_jsc::JsClass]` derive on `NewSocket<SSL>` wires `toJS`/`fromJS`.
// Kept as a marker for Phase B.
#[allow(dead_code)]
fn js_socket_type<const SSL: bool>() {
    // no-op marker; see `NewSocket::js` associated module.
}

// ──────────────────────────────────────────────────────────────────────────
// ALPN select callback
// ──────────────────────────────────────────────────────────────────────────

/// `SSL_CTX_set_alpn_select_cb` registers on the listener-level `SSL_CTX`, so
/// its `arg` is shared across every accepted connection — using it for a
/// per-connection `*TLSSocket` is a UAF when handshakes overlap. Read the
/// socket back from the per-SSL ex_data slot set in `onOpen` instead.
#[unsafe(no_mangle)]
pub extern "C" fn select_alpn_callback(
    ssl: *mut SSL,
    out: *mut *const u8,
    outlen: *mut u8,
    in_: *const u8,
    inlen: c_uint,
    _arg: *mut c_void,
) -> c_int {
    // SAFETY: `SSL_get_ex_data(ssl, 0)` was set in `on_open` to `*mut TLSSocket`.
    let this_ptr = unsafe { boringssl::SSL_get_ex_data(ssl, 0) };
    if this_ptr.is_null() {
        return boringssl::SSL_TLSEXT_ERR_NOACK;
    }
    // SAFETY: ex_data slot 0 holds a `*mut TLSSocket` (set in on_open).
    let this: &TLSSocket = unsafe { &*(this_ptr as *const TLSSocket) };
    if let Some(protos) = &this.protos {
        if protos.is_empty() {
            return boringssl::SSL_TLSEXT_ERR_NOACK;
        }
        // SAFETY: out/outlen/in are valid per BoringSSL ALPN callback contract.
        let status = unsafe {
            boringssl::SSL_select_next_proto(
                out as *mut *mut u8,
                outlen,
                protos.as_ptr(),
                c_uint::try_from(protos.len()).unwrap(),
                in_,
                inlen,
            )
        };
        // Previous versions of Node.js returned SSL_TLSEXT_ERR_NOACK if no protocol
        // match was found. This would neither cause a fatal alert nor would it result
        // in a useful ALPN response as part of the Server Hello message.
        // We now return SSL_TLSEXT_ERR_ALERT_FATAL in that case as per Section 3.2
        // of RFC 7301, which causes a fatal no_application_protocol alert.
        if status == boringssl::OPENSSL_NPN_NEGOTIATED {
            boringssl::SSL_TLSEXT_ERR_OK
        } else {
            boringssl::SSL_TLSEXT_ERR_ALERT_FATAL
        }
    } else {
        boringssl::SSL_TLSEXT_ERR_NOACK
    }
}

// ──────────────────────────────────────────────────────────────────────────
// NewSocket<SSL>
// ──────────────────────────────────────────────────────────────────────────

/// Generic socket wrapper. `SSL = false` → `TCPSocket`, `SSL = true` → `TLSSocket`.
///
/// In Zig this is `fn NewSocket(comptime ssl: bool) type { return struct {...} }`.
#[bun_jsc::JsClass]
pub struct NewSocket<const SSL: bool> {
    pub socket: uws::NewSocketHandler<SSL>,
    /// `SSL_CTX*` this client connection was opened with. One owned ref —
    /// `SSL_CTX_free` on deinit. Server-accepted sockets and plain TCP
    /// leave this `None` (the Listener / SecureContext owns the ref there).
    pub owned_ssl_ctx: Option<*mut SSL_CTX>,

    pub flags: Flags,
    pub ref_count: Cell<u32>, // intrusive — see `bun_ptr::IntrusiveRc<Self>`
    // TODO(port): TSV says `Option<Rc<Handlers>>`, but `reload()` mutates
    // through it (`this_handlers.* = handlers`). Phase B: decide between
    // `Rc<RefCell<Handlers>>` or raw `*mut Handlers` (server sockets borrow
    // the Listener-embedded value).
    pub handlers: Option<Rc<Handlers>>,
    /// Reference to the JS wrapper. Held strong while the socket is active so the
    /// wrapper cannot be garbage-collected out from under in-flight callbacks, and
    /// downgraded to weak once the socket is closed/inactive so GC can reclaim it.
    pub this_value: JsRef,
    pub poll_ref: KeepAlive,
    pub ref_pollref_on_connect: bool,
    pub connection: Option<super::listener::UnixOrHost>,
    pub protos: Option<Box<[u8]>>,
    pub server_name: Option<Box<[u8]>>,
    pub buffered_data_for_node_net: BabyList<u8>,
    pub bytes_written: u64,

    pub native_callback: NativeCallbacks,
    /// `upgradeTLS` produces two `TLSSocket` wrappers over one
    /// `us_socket_t` (the encrypted view + the raw-bytes view node:net
    /// expects at index 0). The encrypted half holds a ref on the raw half
    /// here so a single `onClose` can retire both — no `Handlers.clone()`,
    /// no second context.
    // PORT NOTE: LIFETIMES.tsv says `Option<Rc<Self>>`, but `*Self` is stored in
    // a uws ext slot (FFI) and is intrusively refcounted — PORTING.md mandates
    // IntrusiveRc, never Rc, when *T crosses FFI.
    pub twin: Option<IntrusiveRc<Self>>,
}

/// Associated `Socket` handler type (Zig: `pub const Socket = uws.NewSocketHandler(ssl)`).
pub type SocketHandler<const SSL: bool> = uws::NewSocketHandler<SSL>;

impl<const SSL: bool> NewSocket<SSL> {
    // TODO(port): `pub const js = if (!ssl) jsc.Codegen.JSTCPSocket else jsc.Codegen.JSTLSSocket`
    // — codegen module accessor. `#[bun_jsc::JsClass]` derive provides
    // `to_js`/`from_js`/`from_js_direct`. `dataSetCached`/`dataGetCached` are
    // emitted as `Self::data_set_cached` / `Self::data_get_cached`.

    // Intrusive refcount API (Zig: `bun.ptr.RefCount(@This(), "ref_count", deinit, .{})`).
    pub fn ref_(&self) {
        self.ref_count.set(self.ref_count.get() + 1);
    }
    pub fn deref(&self) {
        let n = self.ref_count.get() - 1;
        self.ref_count.set(n);
        if n == 0 {
            // SAFETY: refcount reached zero; we own the allocation.
            unsafe { Self::deinit_and_destroy(self as *const Self as *mut Self) };
        }
    }

    pub fn new(init: Self) -> *mut Self {
        Box::into_raw(Box::new(init))
    }

    pub fn memory_cost(&self) -> usize {
        // Per-socket SSL state (SSL*, BIO pair, handshake buffers) is ~40 KB
        // off-heap. Reporting it lets the GC apply pressure when JS churns
        // through short-lived TLS connections. The raw `[raw, tls]` upgrade
        // twin shares the same SSL* — only the encrypted half reports it.
        let ssl_cost: usize = if SSL && !self.flags.contains(Flags::BYPASS_TLS) {
            40 * 1024
        } else {
            0
        };
        core::mem::size_of::<Self>()
            + self.buffered_data_for_node_net.cap as usize
            + ssl_cost
    }

    pub fn attach_native_callback(&mut self, callback: NativeCallbacks) -> bool {
        if !matches!(self.native_callback, NativeCallbacks::None) {
            return false;
        }
        // Zig `h2.ref()` — IntrusiveRc holds the +1 by construction (caller
        // passes ownership of the handle), so no explicit inc here.
        self.native_callback = callback;
        true
    }

    pub fn detach_native_callback(&mut self) {
        let native_callback = core::mem::replace(&mut self.native_callback, NativeCallbacks::None);
        match native_callback {
            NativeCallbacks::H2(h2) => {
                h2.on_native_close();
                // Zig `h2.deref()` — IntrusiveRc::drop decrements.
                drop(h2);
            }
            NativeCallbacks::None => {}
        }
    }

    pub fn do_connect(
        &mut self,
        connection: &super::listener::UnixOrHost,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        self.ref_();
        let _guard = scopeguard::guard((), |_| self.deref());
        // PORT NOTE: reshaped for borrowck — Zig used `defer this.deref()`.

        let vm = self.get_handlers().vm;
        let group = vm.rare_data().bun_connect_group(vm, SSL);
        let kind: uws::SocketKind = if SSL {
            uws::SocketKind::BunSocketTls
        } else {
            uws::SocketKind::BunSocketTcp
        };
        let flags: i32 = if self.flags.contains(Flags::ALLOW_HALF_OPEN) {
            uws::LIBUS_SOCKET_ALLOW_HALF_OPEN
        } else {
            0
        };
        let ssl_ctx: Option<*mut uws::SslCtx> = if SSL {
            self.owned_ssl_ctx.map(|p| p as *mut uws::SslCtx)
        } else {
            None
        };

        use super::listener::UnixOrHost;
        match connection {
            UnixOrHost::Host(host) => {
                // PERF(port): was stack-fallback alloc — profile in Phase B.
                // getaddrinfo doesn't accept bracketed IPv6.
                let raw = host.host.as_slice();
                let clean = if raw.len() > 1 && raw[0] == b'[' && raw[raw.len() - 1] == b']' {
                    &raw[1..raw.len() - 1]
                } else {
                    raw
                };
                let hostz = ZStr::from_bytes(clean);

                self.socket = match group.connect(
                    kind,
                    ssl_ctx,
                    hostz.as_cstr(),
                    host.port,
                    flags,
                    core::mem::size_of::<*mut c_void>(),
                ) {
                    uws::ConnectResult::Failed => {
                        return Err(bun_core::err!("FailedToOpenSocket"))
                    }
                    uws::ConnectResult::Socket(s) => {
                        // SAFETY: ext slot is sized for `*mut Self`.
                        unsafe { *s.ext::<*mut Self>() = self as *mut Self };
                        SocketHandler::<SSL>::from(s)
                    }
                    uws::ConnectResult::Connecting(c) => {
                        // SAFETY: ext slot is sized for `*mut Self`.
                        unsafe { *c.ext::<*mut Self>() = self as *mut Self };
                        SocketHandler::<SSL>::from_connecting(c)
                    }
                };
            }
            UnixOrHost::Unix(u) => {
                // PERF(port): was stack-fallback alloc — profile in Phase B.
                let pathz = ZStr::from_bytes(u);
                let s = group
                    .connect_unix(
                        kind,
                        ssl_ctx,
                        pathz.as_ptr(),
                        pathz.len(),
                        flags,
                        core::mem::size_of::<*mut c_void>(),
                    )
                    .ok_or(bun_core::err!("FailedToOpenSocket"))?;
                // SAFETY: ext slot is sized for `*mut Self`.
                unsafe { *s.ext::<*mut Self>() = self as *mut Self };
                self.socket = SocketHandler::<SSL>::from(s);
            }
            UnixOrHost::Fd(f) => {
                let s = group
                    .from_fd(
                        kind,
                        ssl_ctx,
                        core::mem::size_of::<*mut c_void>(),
                        f.native(),
                        false,
                    )
                    .ok_or(bun_core::err!("ConnectionFailed"))?;
                // SAFETY: ext slot is sized for `*mut Self`.
                unsafe { *s.ext::<*mut Self>() = self as *mut Self };
                self.socket = SocketHandler::<SSL>::from(s);
                self.on_open(self.socket);
            }
        }
        Ok(())
    }

    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        global.throw("Cannot construct Socket", ())
    }

    #[bun_jsc::host_fn(method)]
    pub fn resume_from_js(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        log!("resume");
        // The raw half of an upgradeTLS pair is an observation tap; flow
        // control belongs to the TLS half. Pausing the shared fd here would
        // wedge the TLS read path (#15438).
        if this.flags.contains(Flags::BYPASS_TLS) {
            return Ok(JSValue::UNDEFINED);
        }
        if this.flags.contains(Flags::IS_PAUSED) {
            this.flags.set(Flags::IS_PAUSED, !this.socket.resume_stream());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn pause_from_js(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        log!("pause");
        if this.flags.contains(Flags::BYPASS_TLS) {
            return Ok(JSValue::UNDEFINED);
        }
        if !this.flags.contains(Flags::IS_PAUSED) {
            this.flags.set(Flags::IS_PAUSED, this.socket.pause_stream());
        }
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_keep_alive(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old(2);

        let enabled: bool = if args.len() >= 1 {
            args.ptr()[0].to_boolean()
        } else {
            false
        };

        let initial_delay: u32 = if args.len() > 1 {
            u32::try_from(global.validate_integer_range(
                args.ptr()[1],
                0i32,
                jsc::IntegerRangeOptions {
                    min: 0,
                    field_name: "initialDelay",
                    ..Default::default()
                },
            )?)
            .unwrap()
        } else {
            0
        };
        log!("setKeepAlive({}, {})", enabled, initial_delay);

        Ok(JSValue::from(this.socket.set_keep_alive(enabled, initial_delay)))
    }

    #[bun_jsc::host_fn(method)]
    pub fn set_no_delay(
        this: &mut Self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old(1);
        let enabled: bool = if args.len() >= 1 {
            args.ptr()[0].to_boolean()
        } else {
            true
        };
        log!("setNoDelay({})", enabled);

        Ok(JSValue::from(this.socket.set_no_delay(enabled)))
    }

    pub fn handle_error(&mut self, err_value: JSValue) {
        log!("handleError");
        let handlers = self.get_handlers();
        let vm = handlers.vm;
        if vm.is_shutting_down() {
            return;
        }
        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();
        // TODO(port): errdefer — `scope.exit()` returns true when handlers freed
        let global = handlers.global_object;
        let this_value = self.get_this_value(global);
        let _ = handlers.call_error_handler(this_value, &[this_value, err_value]);
        if scope.exit() {
            self.handlers = None;
        }
    }

    pub fn on_writable(&mut self, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        if self.socket.is_detached() {
            return;
        }
        if self.native_callback.on_writable() {
            return;
        }
        let handlers = self.get_handlers();
        let callback = handlers.on_writable;
        if callback.is_empty() {
            return;
        }

        let vm = handlers.vm;
        if vm.is_shutting_down() {
            return;
        }
        self.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end instead of `defer`.
        self.internal_flush();
        log!(
            "onWritable buffered_data_for_node_net {}",
            self.buffered_data_for_node_net.len
        );
        // is not writable if we have buffered data or if we are already detached
        if self.buffered_data_for_node_net.len > 0 || self.socket.is_detached() {
            self.deref();
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);
        if let Err(err) = callback.call(global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            self.handlers = None;
        }
        self.deref();
    }

    pub fn on_timeout(&mut self, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        if self.socket.is_detached() {
            return;
        }
        let handlers = self.get_handlers();
        log!(
            "onTimeout {}",
            if handlers.mode == SocketMode::Server { "S" } else { "C" }
        );
        let callback = handlers.on_timeout;
        if callback.is_empty() || self.flags.contains(Flags::FINALIZING) {
            return;
        }
        if handlers.vm.is_shutting_down() {
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);
        if let Err(err) = callback.call(global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            self.handlers = None;
        }
    }

    pub fn get_handlers(&self) -> &Handlers {
        // TODO(port): lifetime — Rc<Handlers> deref vs &Handlers; see field note.
        self.handlers
            .as_deref()
            .expect("No handlers set on Socket")
    }

    pub fn handle_connect_error(&mut self, errno: c_int) -> JsResult<()> {
        let handlers = self.get_handlers();
        log!(
            "onConnectError {} ({}, {})",
            if handlers.mode == SocketMode::Server { "S" } else { "C" },
            errno,
            self.ref_count.get()
        );
        // Ensure the socket is still alive for any defer's we have
        self.ref_();
        // PORT NOTE: reshaped for borrowck — explicit cleanup at end of fn.
        self.buffered_data_for_node_net.clear_and_free();

        let needs_deref = !self.socket.is_detached();
        self.socket = SocketHandler::<SSL>::DETACHED;

        let vm = handlers.vm;
        self.poll_ref.unref_on_next_tick(vm);

        // TODO(port): errdefer — combined `defer markInactive()` + `defer deref()`
        // moved to a guard so all early-returns run them.
        let cleanup = scopeguard::guard((self as *mut Self, needs_deref), |(p, nd)| {
            // SAFETY: p is &mut self captured for deferred cleanup.
            let this = unsafe { &mut *p };
            // Zig defer order (reverse-declaration): needs_deref → markInactive → deref.
            if nd {
                this.deref();
            }
            this.mark_inactive();
            this.deref();
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
            ..Default::default()
        };

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();
        let scope_guard = scopeguard::guard((self as *mut Self, scope), |(p, mut sc)| {
            if sc.exit() {
                // Connection never opened (`is_active == false`), so the
                // scope's decrement is what brings client handlers to zero
                // and frees them. Null the field so a retry via
                // `connectInner` doesn't double-free.
                // SAFETY: p is &mut self.
                unsafe { (*p).handlers = None };
            }
        });
        let _ = scope_guard; // disarmed by drop at end of scope

        if callback.is_empty() {
            // Connection failed before open; allow the wrapper to be GC'd
            // regardless of whether this path is promise-backed (e.g. the
            // duplex TLS upgrade flow has no connect promise).
            if !self.this_value.is_finalized() {
                self.this_value.downgrade();
            }
            if let Some(promise) = handlers.promise.try_swap() {
                handlers.promise.deinit();

                // reject the promise on connect() error
                let js_promise = promise.as_promise().unwrap();
                let err_value = err.to_error_instance_with_async_stack(global, js_promise);
                js_promise.reject(global, err_value)?;
            }

            drop(cleanup);
            return Ok(());
        }

        let this_value = self.get_this_value(global);
        this_value.ensure_still_alive();
        // Connection failed before open; allow the wrapper to be GC'd once this
        // callback returns. The on-stack `this_value` keeps it alive for the call.
        self.this_value.downgrade();

        let err_value = err.to_error_instance(global);
        let result = match callback.call(global, this_value, &[this_value, err_value]) {
            Ok(v) => v,
            Err(e) => global.take_exception(e),
        };

        if let Some(err_val) = result.to_error() {
            // TODO: properly propagate exception upwards
            if handlers.reject_promise(err_val).unwrap_or(true) {
                drop(cleanup);
                return Ok(());
            }
            let _ = handlers.call_error_handler(this_value, &[this_value, err_val]);
        } else if let Some(val) = handlers.promise.try_swap() {
            // They've defined a `connectError` callback
            // The error is effectively handled, but we should still reject the promise.
            let promise = val.as_promise().unwrap();
            let err_ = err.to_error_instance_with_async_stack(global, promise);
            promise.reject_as_handled(global, err_)?;
        }

        drop(cleanup);
        Ok(())
    }

    pub fn on_connect_error(&mut self, _socket: SocketHandler<SSL>, errno: c_int) -> JsResult<()> {
        jsc::mark_binding!();
        self.handle_connect_error(errno)
    }

    pub fn mark_active(&mut self) {
        if !self.flags.contains(Flags::IS_ACTIVE) {
            let handlers = self.get_handlers();
            handlers.mark_active();
            self.flags.insert(Flags::IS_ACTIVE);
            // Keep the JS wrapper alive while the socket is active.
            // `getThisValue` may not have been called yet (e.g. server-side
            // sockets without default data), in which case the ref is still
            // empty and there's nothing to upgrade.
            if self.this_value.is_not_empty() {
                self.this_value.upgrade(handlers.global_object);
            }
        }
    }

    pub fn close_and_detach(&mut self, code: uws::SocketCloseCode) {
        let socket = self.socket;
        self.buffered_data_for_node_net.clear_and_free();

        self.socket.detach();
        self.detach_native_callback();

        socket.close(code);
    }

    pub fn mark_inactive(&mut self) {
        if self.flags.contains(Flags::IS_ACTIVE) {
            // we have to close the socket before the socket context is closed
            // otherwise we will get a segfault
            // uSockets will defer freeing the TCP socket until the next tick
            if !self.socket.is_closed() {
                self.close_and_detach(uws::SocketCloseCode::Normal);
                // onClose will call markInactive again
                return;
            }

            self.flags.remove(Flags::IS_ACTIVE);
            // Allow the JS wrapper to be GC'd now that the socket is idle.
            // Do this before touching `handlers`: in client mode
            // `handlers.markInactive()` frees the Handlers allocation
            // entirely, and for the last server-side connection on a
            // stopped listener it releases the listener's own strong ref.
            if !self.this_value.is_finalized() {
                self.this_value.downgrade();
            }
            // During VM shutdown, the Listener (which embeds `handlers`
            // for server sockets) may already have been finalized by the
            // time a deferred `onClose` → `markInactive` reaches here,
            // leaving `this.handlers` dangling. Active-connection
            // bookkeeping is irrelevant once the process is exiting, so
            // just release the event-loop ref and stop.
            let vm = VirtualMachine::get();
            if vm.is_shutting_down() {
                self.poll_ref.unref(vm);
                return;
            }
            let handlers = self.get_handlers();
            if handlers.mark_inactive() {
                // Client-mode handlers are allocated per-connection and
                // `Handlers.markInactive` just freed them. Null the field
                // so `connectInner` (net.Socket reconnect path) and
                // `getListener` don't dereference/destroy freed memory.
                self.handlers = None;
            }
            self.poll_ref.unref(vm);
        }
    }

    pub fn is_server(&self) -> bool {
        // `handlers` is null on detached sockets and on closed client
        // sockets (markInactive nulls it once the allocation is freed).
        // JS-callable TLS accessors (`setServername`, `getPeerCertificate`,
        // `getEphemeralKeyInfo`, `setVerifyMode`) consult this on sockets
        // whose connection may already be gone.
        let Some(handlers) = self.handlers.as_deref() else {
            return false;
        };
        handlers.mode.is_server()
    }

    pub fn on_open(&mut self, socket: SocketHandler<SSL>) {
        log!(
            "onOpen {} {:p} {} {}",
            if self.is_server() { "S" } else { "C" },
            self as *const Self,
            self.socket.is_detached(),
            self.ref_count.get()
        );
        // Ensure the socket remains alive until this is finished
        self.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end.

        // update the internal socket instance to the one that was just connected
        // This socket must be replaced because the previous one is a connecting socket not a uSockets socket
        self.socket = socket;
        jsc::mark_binding!();

        // Add SNI support for TLS (mongodb and others requires this)
        if SSL {
            if let Some(ssl_ptr) = self.socket.ssl() {
                if !ssl_ptr.is_init_finished() {
                    if let Some(server_name) = &self.server_name {
                        let host = server_name.as_ref();
                        if !host.is_empty() {
                            let host_z = ZStr::from_bytes(host);
                            ssl_ptr.set_hostname(host_z.as_cstr());
                        }
                    } else if let Some(connection) = &self.connection {
                        if let super::listener::UnixOrHost::Host(h) = connection {
                            let host = h.host.as_slice();
                            if !host.is_empty() {
                                let host_z = ZStr::from_bytes(host);
                                ssl_ptr.set_hostname(host_z.as_cstr());
                            }
                        }
                    }
                    if let Some(protos) = &self.protos {
                        if self.is_server() {
                            // Per-connection: callback reads `this` from the SSL,
                            // not the CTX-level arg (shared across the listener).
                            // SAFETY: BoringSSL FFI; `self` outlives the SSL handshake.
                            unsafe {
                                boringssl::SSL_set_ex_data(
                                    ssl_ptr.as_ptr(),
                                    0,
                                    self as *mut Self as *mut c_void,
                                );
                                boringssl::SSL_CTX_set_alpn_select_cb(
                                    boringssl::SSL_get_SSL_CTX(ssl_ptr.as_ptr()),
                                    Some(select_alpn_callback),
                                    ptr::null_mut(),
                                );
                            }
                        } else {
                            // SAFETY: BoringSSL FFI.
                            unsafe {
                                boringssl::SSL_set_alpn_protos(
                                    ssl_ptr.as_ptr(),
                                    protos.as_ptr(),
                                    c_uint::try_from(protos.len()).unwrap(),
                                );
                            }
                        }
                    }
                }
            }
        }

        if let Some(ctx) = socket.ext::<*mut c_void>() {
            // SAFETY: ext slot is sized for `*mut anyopaque`.
            unsafe { *ctx = self as *mut Self as *mut c_void };
        }

        let handlers = self.get_handlers();
        let callback = handlers.on_open;
        let handshake_callback = handlers.on_handshake;

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);

        self.mark_active();
        // TODO: properly propagate exception upwards
        let _ = handlers.resolve_promise(this_value);

        if SSL {
            // only calls open callback if handshake callback is provided
            // If handshake is provided, open is called on connection open
            // If is not provided, open is called after handshake
            if callback.is_empty() || handshake_callback.is_empty() {
                self.deref();
                return;
            }
        } else {
            if callback.is_empty() {
                self.deref();
                return;
            }
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();
        let result = match callback.call(global, this_value, &[this_value]) {
            Ok(v) => v,
            Err(err) => global.take_exception(err),
        };

        if let Some(err) = result.to_error() {
            if !self.socket.is_closed() {
                log!("Closing due to error");
            } else {
                log!("Already closed");
            }

            // TODO: properly propagate exception upwards
            let rejected = handlers.reject_promise(err).unwrap_or(true);
            if !rejected {
                let _ = handlers.call_error_handler(this_value, &[this_value, err]);
            }
            self.mark_inactive();
        }
        if scope.exit() {
            self.handlers = None;
        }
        self.deref();
    }

    pub fn get_this_value(&mut self, global: &JSGlobalObject) -> JSValue {
        if let Some(value) = self.this_value.try_get() {
            return value;
        }
        if self.this_value.is_finalized() {
            // The JS wrapper was already garbage-collected. Creating a new one
            // here would result in a second `finalize` (and double-deref) later.
            return JSValue::UNDEFINED;
        }
        let value = self.to_js(global);
        value.ensure_still_alive();
        // Hold strong until the socket is closed / marked inactive.
        self.this_value.set_strong(value, global);
        value
    }

    pub fn on_end(&mut self, _socket: SocketHandler<SSL>) {
        jsc::mark_binding!();
        if self.socket.is_detached() {
            return;
        }
        let handlers = self.get_handlers();
        log!(
            "onEnd {}",
            if handlers.mode == SocketMode::Server { "S" } else { "C" }
        );
        // Ensure the socket remains alive until this is finished
        self.ref_();

        let callback = handlers.on_end;
        if callback.is_empty() || handlers.vm.is_shutting_down() {
            self.poll_ref.unref(handlers.vm);

            // If you don't handle TCP fin, we assume you're done.
            self.mark_inactive();
            self.deref();
            return;
        }

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);
        if let Err(err) = callback.call(global, this_value, &[this_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            self.handlers = None;
        }
        self.deref();
    }

    pub fn on_handshake(
        &mut self,
        s: SocketHandler<SSL>,
        success: i32,
        ssl_error: uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        self.flags.insert(Flags::HANDSHAKE_COMPLETE);
        self.socket = s;
        if self.socket.is_detached() {
            return Ok(());
        }
        let handlers = self.get_handlers();
        log!(
            "onHandshake {} ({})",
            if handlers.mode == SocketMode::Server { "S" } else { "C" },
            success
        );

        let authorized = success == 1;

        self.flags.set(Flags::AUTHORIZED, authorized);

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
        let mut scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);

        let result: JSValue;
        // open callback only have 1 parameters and its the socket
        // you should use getAuthorizationError and authorized getter to get those values in this case
        if is_open {
            result = match callback.call(global, this_value, &[this_value]) {
                Ok(v) => v,
                Err(err) => global.take_exception(err),
            };

            // only call onOpen once for clients
            if handlers.mode != SocketMode::Server {
                // clean onOpen callback so only called in the first handshake and not in every renegotiation
                // on servers this would require a different approach but it's not needed because our servers will not call handshake multiple times
                // servers don't support renegotiation
                handlers.on_open.unprotect();
                // TODO(port): mutation through &Handlers (Rc) — Phase B interior mutability.
                // handlers.on_open = JSValue::ZERO;
            }
        } else {
            // call handhsake callback with authorized and authorization error if has one
            let authorization_error: JSValue = if ssl_error.error_no == 0 {
                JSValue::NULL
            } else {
                ssl_error.to_js(global)?
            };

            result = match callback.call(
                global,
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
            self.handlers = None;
        }
        Ok(())
    }

    pub fn on_close(
        &mut self,
        socket: SocketHandler<SSL>,
        err: c_int,
        reason: Option<*mut c_void>,
    ) -> JsResult<()> {
        jsc::mark_binding!();
        let handlers = self.get_handlers();
        log!(
            "onClose {}",
            if handlers.mode == SocketMode::Server { "S" } else { "C" }
        );
        self.detach_native_callback();
        self.socket.detach();
        // The upgradeTLS raw twin shares the same us_socket_t so it never
        // gets its own dispatch — fire its (pre-upgrade) close handler
        // here, then retire it. `raw.twin == None` so this doesn't
        // recurse, and `onClose` derefs the +1 we took at creation.
        if let Some(mut raw) = self.twin.take() {
            // SAFETY: twin holds a +1 intrusive ref; uniquely accessed here.
            unsafe { raw.as_mut().on_close(socket, err, reason).ok() };
            drop(raw);
        }
        // PORT NOTE: reshaped for borrowck — `defer this.deref()` + `defer markInactive()`.
        let cleanup = scopeguard::guard(self as *mut Self, |p| {
            // SAFETY: p is &mut self captured for deferred cleanup.
            let this = unsafe { &mut *p };
            this.mark_inactive();
            this.deref();
        });

        if self.flags.contains(Flags::FINALIZING) {
            drop(cleanup);
            return Ok(());
        }

        let vm = handlers.vm;
        self.poll_ref.unref(vm);

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
        let mut scope = handlers.enter();

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);
        let mut js_error: JSValue = JSValue::UNDEFINED;
        if err != 0 {
            // errors here are always a read error
            js_error = sys::Error::from_code_int(err, sys::Tag::Read).to_js(global)?;
        }

        if let Err(e) = callback.call(global, this_value, &[this_value, js_error]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(e)]);
        }
        if scope.exit() {
            self.handlers = None;
        }
        drop(cleanup);
        Ok(())
    }

    pub fn on_data(&mut self, s: SocketHandler<SSL>, data: &[u8]) {
        jsc::mark_binding!();
        self.socket = s;
        if self.socket.is_detached() {
            return;
        }
        let handlers = self.get_handlers();
        log!(
            "onData {} ({})",
            if handlers.mode == SocketMode::Server { "S" } else { "C" },
            data.len()
        );
        if self.native_callback.on_data(data) {
            return;
        }

        let callback = handlers.on_data;
        if callback.is_empty() || self.flags.contains(Flags::FINALIZING) {
            return;
        }
        if handlers.vm.is_shutting_down() {
            return;
        }

        let global = handlers.global_object;
        let this_value = self.get_this_value(global);
        let output_value = match handlers.binary_type.to_js(data, global) {
            Ok(v) => v,
            Err(err) => {
                self.handle_error(global.take_exception(err));
                return;
            }
        };

        // the handlers must be kept alive for the duration of the function call
        // that way if we need to call the error handler, we can
        let mut scope = handlers.enter();

        // const encoding = handlers.encoding;
        if let Err(err) = callback.call(global, this_value, &[this_value, output_value]) {
            let _ = handlers.call_error_handler(this_value, &[this_value, global.take_error(err)]);
        }
        if scope.exit() {
            self.handlers = None;
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_data(_this: &Self, _global: &JSGlobalObject) -> JSValue {
        log!("getData()");
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(setter)]
    pub fn set_data(this: &mut Self, global: &JSGlobalObject, value: JSValue) {
        log!("setData()");
        Self::data_set_cached(this.get_this_value(global), global, value);
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_listener(this: &Self, _global: &JSGlobalObject) -> JSValue {
        let Some(handlers) = this.handlers.as_deref() else {
            return JSValue::UNDEFINED;
        };

        if handlers.mode != SocketMode::Server || this.socket.is_detached() {
            return JSValue::UNDEFINED;
        }

        // SAFETY: handlers points to Listener.handlers field (server mode invariant).
        let l: &Listener = unsafe {
            &*((handlers as *const Handlers as *const u8)
                .sub(core::mem::offset_of!(Listener, handlers))
                as *const Listener)
        };
        l.strong_self.get().unwrap_or(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_ready_state(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if this.socket.is_detached() {
            JSValue::js_number(-1i32)
        } else if this.socket.is_closed() {
            JSValue::js_number(0i32)
        } else if this.socket.is_established() {
            JSValue::js_number(1i32)
        } else if this.socket.is_shutdown() {
            JSValue::js_number(-2i32)
        } else {
            JSValue::js_number(2i32)
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_authorized(this: &Self, _global: &JSGlobalObject) -> JSValue {
        log!("getAuthorized()");
        JSValue::from(this.flags.contains(Flags::AUTHORIZED))
    }

    #[bun_jsc::host_fn(method)]
    pub fn timeout(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old(1);
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        if args.len() == 0 {
            return global.throw("Expected 1 argument, got 0", ());
        }
        let t = args.ptr()[0].coerce::<i32>(global)?;
        if t < 0 {
            return global.throw("Timeout must be a positive integer", ());
        }
        log!("timeout({})", t);

        this.socket.set_timeout(c_uint::try_from(t).unwrap());

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_authorization_error(
        this: &mut Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if this.socket.is_detached() {
            return Ok(JSValue::NULL);
        }

        // this error can change if called in different stages of hanshake
        // is very usefull to have this feature depending on the user workflow
        let ssl_error = this.socket.get_verify_error();
        if ssl_error.error_no == 0 {
            return Ok(JSValue::NULL);
        }

        let code: &[u8] = if ssl_error.code.is_null() {
            b""
        } else {
            // SAFETY: ssl_error.code is a NUL-terminated C string from BoringSSL.
            unsafe { core::ffi::CStr::from_ptr(ssl_error.code) }.to_bytes()
        };

        let reason: &[u8] = if ssl_error.reason.is_null() {
            b""
        } else {
            // SAFETY: ssl_error.reason is a NUL-terminated C string from BoringSSL.
            unsafe { core::ffi::CStr::from_ptr(ssl_error.reason) }.to_bytes()
        };

        let fallback = SystemError {
            code: BunString::clone_utf8(code),
            message: BunString::clone_utf8(reason),
            ..Default::default()
        };

        Ok(fallback.to_error_instance(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn write(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        if this.socket.is_detached() {
            return Ok(JSValue::js_number(-1i32));
        }

        let mut args = callframe.arguments_undef(5);

        Ok(match this.write_or_end::<false>(global, args.mut_(), false) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, .. } => JSValue::js_number(wrote),
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_local_family(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let Some(address_bytes) = this.socket.local_address(&mut buf) else {
            return Ok(JSValue::UNDEFINED);
        };
        Ok(match address_bytes.len() {
            4 => global.common_strings().ipv4(),
            16 => global.common_strings().ipv6(),
            _ => JSValue::UNDEFINED,
        })
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_local_address(this: &Self, global: &JSGlobalObject) -> JSValue {
        if this.socket.is_detached() {
            return JSValue::UNDEFINED;
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let Some(address_bytes) = this.socket.local_address(&mut buf) else {
            return JSValue::UNDEFINED;
        };
        // TODO(port): std::net::Address used in Zig — bun_core::net::Address in Rust.
        let address = match address_bytes.len() {
            4 => bun_core::net::Address::init_ip4(
                <[u8; 4]>::try_from(address_bytes).unwrap(),
                0,
            ),
            16 => bun_core::net::Address::init_ip6(
                <[u8; 16]>::try_from(address_bytes).unwrap(),
                0,
                0,
                0,
            ),
            _ => return JSValue::UNDEFINED,
        };

        let text = bun_fmt::format_ip(address, &mut text_buf).expect("unreachable");
        ZigString::init(text).to_js(global)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_local_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if this.socket.is_detached() {
            return JSValue::UNDEFINED;
        }

        JSValue::js_number(this.socket.local_port())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_family(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let Some(address_bytes) = this.socket.remote_address(&mut buf) else {
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
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let mut buf = [0u8; 64];
        let mut text_buf = [0u8; 512];

        let Some(address_bytes) = this.socket.remote_address(&mut buf) else {
            return Ok(JSValue::UNDEFINED);
        };
        let address = match address_bytes.len() {
            4 => bun_core::net::Address::init_ip4(
                <[u8; 4]>::try_from(address_bytes).unwrap(),
                0,
            ),
            16 => bun_core::net::Address::init_ip6(
                <[u8; 16]>::try_from(address_bytes).unwrap(),
                0,
                0,
                0,
            ),
            _ => return Ok(JSValue::UNDEFINED),
        };

        let text = bun_fmt::format_ip(address, &mut text_buf).expect("unreachable");
        BunString::create_utf8_for_js(global, text)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_remote_port(this: &Self, _global: &JSGlobalObject) -> JSValue {
        if this.socket.is_detached() {
            return JSValue::UNDEFINED;
        }

        JSValue::js_number(this.socket.remote_port())
    }

    #[inline]
    fn do_socket_write(&mut self, buffer: &[u8]) -> i32 {
        if self.flags.contains(Flags::BYPASS_TLS) {
            self.socket.raw_write(buffer)
        } else {
            self.socket.write(buffer)
        }
    }

    pub fn write_maybe_corked(&mut self, buffer: &[u8]) -> i32 {
        if self.socket.is_shutdown() || self.socket.is_closed() {
            return -1;
        }

        let res = self.do_socket_write(buffer);
        let uwrote: usize = usize::try_from(res.max(0)).unwrap();
        self.bytes_written += uwrote as u64;
        log!("write({}) = {}", buffer.len(), res);
        res
    }

    #[bun_jsc::host_fn(method)]
    pub fn write_buffered(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.socket.is_detached() {
            this.buffered_data_for_node_net.clear_and_free();
            return Ok(JSValue::FALSE);
        }

        let args = callframe.arguments_undef(2);

        Ok(
            match this.write_or_end_buffered::<false>(global, args.ptr()[0], args.ptr()[1]) {
                WriteResult::Fail => JSValue::ZERO,
                WriteResult::Success { wrote, total } => {
                    if usize::try_from(wrote.max(0)).unwrap() == total {
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
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.socket.is_detached() {
            this.buffered_data_for_node_net.clear_and_free();
            return Ok(JSValue::FALSE);
        }

        let args = callframe.arguments_undef(2);
        this.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end.
        let result = match this.write_or_end_buffered::<true>(global, args.ptr()[0], args.ptr()[1]) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, total } => {
                if wrote >= 0 && usize::try_from(wrote).unwrap() == total {
                    this.internal_flush();
                }

                JSValue::from(usize::try_from(wrote.max(0)).unwrap() == total)
            }
        };
        this.deref();
        Ok(result)
    }

    fn write_or_end_buffered<const IS_END: bool>(
        &mut self,
        global: &JSGlobalObject,
        data_value: JSValue,
        encoding_value: JSValue,
    ) -> WriteResult {
        if self.buffered_data_for_node_net.len == 0 {
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
        let buffer: jsc::node::StringOrBuffer = if data_value.is_undefined() {
            jsc::node::StringOrBuffer::EMPTY
        } else {
            match jsc::node::StringOrBuffer::from_js_with_encoding_value_allow_string_object(
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
                            "data",
                            "string, buffer, or blob",
                            data_value,
                        );
                    }
                    return WriteResult::Fail;
                }
                Err(_) => return WriteResult::Fail,
            }
        };
        // `buffer` Drop frees.
        if !self.flags.contains(Flags::END_AFTER_FLUSH) && IS_END {
            self.flags.insert(Flags::END_AFTER_FLUSH);
        }

        if self.socket.is_shutdown() || self.socket.is_closed() {
            return WriteResult::Success {
                wrote: -1,
                total: buffer.slice().len() + self.buffered_data_for_node_net.len as usize,
            };
        }

        let total_to_write: usize =
            buffer.slice().len() + self.buffered_data_for_node_net.len as usize;
        if total_to_write == 0 {
            if SSL {
                log!("total_to_write == 0");
                if !data_value.is_undefined() {
                    log!("data_value is not undefined");
                    // special condition for SSL_write(0, "", 0)
                    // we need to send an empty packet after the buffer is flushed and after the handshake is complete
                    // and in this case we need to ignore SSL_write() return value because 0 should not be treated as an error
                    self.flags.insert(Flags::EMPTY_PACKET_PENDING);
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
                if let uws::SocketState::Connected(connected) = &self.socket.socket {
                    if !buffer.slice().is_empty() {
                        let rc = connected
                            .write2(self.buffered_data_for_node_net.slice(), buffer.slice());
                        let written: usize = usize::try_from(rc.max(0)).unwrap();
                        let leftover = total_to_write.saturating_sub(written);
                        if leftover == 0 {
                            self.buffered_data_for_node_net.clear_and_free();
                            break 'brk rc;
                        }

                        let buf_len = self.buffered_data_for_node_net.len as usize;
                        let remaining_in_buffered_data = &self
                            .buffered_data_for_node_net
                            .slice()[written.min(buf_len)..];
                        let remaining_in_buffered_len = remaining_in_buffered_data.len();
                        let remaining_in_input_data =
                            &buffer.slice()[(buf_len.saturating_sub(written)).min(buffer.slice().len())..];

                        if written > 0 {
                            if remaining_in_buffered_len > 0 {
                                let input_buffer = self.buffered_data_for_node_net.slice_mut();
                                // SAFETY: overlapping copy within the same buffer.
                                unsafe {
                                    core::ptr::copy(
                                        input_buffer.as_ptr().add(written),
                                        input_buffer.as_mut_ptr(),
                                        remaining_in_buffered_len,
                                    );
                                }
                                self.buffered_data_for_node_net.len =
                                    remaining_in_buffered_len as u32;
                            }
                        }

                        if !remaining_in_input_data.is_empty() {
                            self.buffered_data_for_node_net
                                .append_slice(remaining_in_input_data);
                            // PERF(port): was assume_capacity — profile in Phase B.
                        }

                        break 'brk rc;
                    }
                }
            }

            // slower-path: clone the data, do one write.
            self.buffered_data_for_node_net
                .append_slice(buffer.slice());
            // PORT NOTE: reshaped for borrowck — capture slice ptr/len before write.
            let rc = self.write_maybe_corked(self.buffered_data_for_node_net.slice());
            if rc > 0 {
                let wrote_u: usize = usize::try_from(rc.max(0)).unwrap();
                // did we write everything?
                // we can free this temporary buffer.
                if wrote_u == self.buffered_data_for_node_net.len as usize {
                    self.buffered_data_for_node_net.clear_and_free();
                } else {
                    // Otherwise, let's move the temporary buffer back.
                    let len = self.buffered_data_for_node_net.len as usize - wrote_u;
                    debug_assert!(len <= self.buffered_data_for_node_net.len as usize);
                    debug_assert!(len <= self.buffered_data_for_node_net.cap as usize);
                    // SAFETY: overlapping copy within the same buffer.
                    unsafe {
                        core::ptr::copy(
                            self.buffered_data_for_node_net.ptr.add(wrote_u),
                            self.buffered_data_for_node_net.ptr,
                            len,
                        );
                    }
                    self.buffered_data_for_node_net.len = len as u32;
                }
            }

            rc
        };

        WriteResult::Success {
            wrote,
            total: total_to_write,
        }
    }

    fn write_or_end<const IS_END: bool>(
        &mut self,
        global: &JSGlobalObject,
        args: &mut [JSValue],
        buffer_unwritten_data: bool,
    ) -> WriteResult {
        if args[0].is_undefined() {
            if !self.flags.contains(Flags::END_AFTER_FLUSH) && IS_END {
                self.flags.insert(Flags::END_AFTER_FLUSH);
            }
            log!("writeOrEnd undefined");
            return WriteResult::Success { wrote: 0, total: 0 };
        }

        debug_assert!(self.buffered_data_for_node_net.len == 0);
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
            let _ = global.throw_todo("Support encoding with offset and length altogether. Only either encoding or offset, length is supported, but not both combinations yet.");
            return WriteResult::Fail;
        }

        // PERF(port): was stack-fallback alloc — profile in Phase B.
        let buffer: jsc::node::BlobOrStringOrBuffer = if args[0].is_undefined() {
            jsc::node::BlobOrStringOrBuffer::StringOrBuffer(jsc::node::StringOrBuffer::EMPTY)
        } else {
            match jsc::node::BlobOrStringOrBuffer::from_js_with_encoding_value_allow_request_response(
                global,
                args[0],
                encoding_value,
                true,
            ) {
                Ok(Some(b)) => b,
                Ok(None) => {
                    if !global.has_exception() {
                        let _ = global.throw_invalid_argument_type_value(
                            "data",
                            "string, buffer, or blob",
                            args[0],
                        );
                    }
                    return WriteResult::Fail;
                }
                Err(_) => return WriteResult::Fail,
            }
        };
        // `buffer` Drop frees.
        if matches!(&buffer, jsc::node::BlobOrStringOrBuffer::Blob(b) if b.needs_to_read_file()) {
            let _ = global.throw("File blob not supported yet in this function.", ());
            return WriteResult::Fail;
        }

        const LABEL: &str = if IS_END { "end" } else { "write" };

        let byte_offset: usize = 'brk: {
            if offset_value.is_undefined() {
                break 'brk 0;
            }
            if !offset_value.is_any_int() {
                let _ = global.throw_invalid_argument_type(
                    const_format::concatcp!("Socket.", LABEL),
                    "byteOffset",
                    "integer",
                );
                return WriteResult::Fail;
            }
            let i = offset_value.to_int64();
            if i < 0 {
                let _ = global.throw_range_error(
                    i,
                    jsc::RangeErrorOptions {
                        field_name: "byteOffset",
                        min: 0,
                        max: jsc::MAX_SAFE_INTEGER,
                    },
                );
                return WriteResult::Fail;
            }
            usize::try_from(i).unwrap()
        };

        let byte_length: usize = 'brk: {
            if length_value.is_undefined() {
                break 'brk buffer.slice().len();
            }
            if !length_value.is_any_int() {
                let _ = global.throw_invalid_argument_type(
                    const_format::concatcp!("Socket.", LABEL),
                    "byteLength",
                    "integer",
                );
                return WriteResult::Fail;
            }

            let l = length_value.to_int64();

            if l < 0 {
                let _ = global.throw_range_error(
                    l,
                    jsc::RangeErrorOptions {
                        field_name: "byteLength",
                        min: 0,
                        max: jsc::MAX_SAFE_INTEGER,
                    },
                );
                return WriteResult::Fail;
            }
            usize::try_from(l).unwrap()
        };

        let mut bytes = buffer.slice();

        if byte_offset > bytes.len() {
            let _ = global.throw_range_error(
                i64::try_from(byte_offset).unwrap(),
                jsc::RangeErrorOptions {
                    field_name: "byteOffset",
                    min: 0,
                    max: i64::try_from(bytes.len()).unwrap(),
                },
            );
            return WriteResult::Fail;
        }

        bytes = &bytes[byte_offset..];

        if byte_length > bytes.len() {
            let _ = global.throw_range_error(
                i64::try_from(byte_length).unwrap(),
                jsc::RangeErrorOptions {
                    field_name: "byteLength",
                    min: 0,
                    max: i64::try_from(bytes.len()).unwrap(),
                },
            );
            return WriteResult::Fail;
        }

        bytes = &bytes[..byte_length];

        if global.has_exception() {
            return WriteResult::Fail;
        }

        if self.socket.is_shutdown() || self.socket.is_closed() {
            return WriteResult::Success {
                wrote: -1,
                total: bytes.len(),
            };
        }
        if !self.flags.contains(Flags::END_AFTER_FLUSH) && IS_END {
            self.flags.insert(Flags::END_AFTER_FLUSH);
        }

        if bytes.is_empty() {
            if SSL {
                log!("writeOrEnd 0");
                // special condition for SSL_write(0, "", 0)
                // we need to send an empty packet after the buffer is flushed and after the handshake is complete
                // and in this case we need to ignore SSL_write() return value because 0 should not be treated as an error
                self.flags.insert(Flags::EMPTY_PACKET_PENDING);
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
        let uwrote: usize = usize::try_from(wrote.max(0)).unwrap();
        if buffer_unwritten_data {
            let remaining = &bytes[uwrote..];
            if !remaining.is_empty() {
                self.buffered_data_for_node_net.append_slice(remaining);
            }
        }

        WriteResult::Success {
            wrote,
            total: bytes.len(),
        }
    }

    fn try_write_empty_packet(&mut self) -> bool {
        if SSL {
            // just mimic the side-effect dont actually write empty non-TLS data onto the socket, we just wanna to have same behavior of node.js
            if !self.flags.contains(Flags::HANDSHAKE_COMPLETE)
                || self.buffered_data_for_node_net.len > 0
            {
                return false;
            }

            self.flags.remove(Flags::EMPTY_PACKET_PENDING);
            return true;
        }
        false
    }

    fn can_end_after_flush(&self) -> bool {
        self.flags.contains(Flags::IS_ACTIVE)
            && self.flags.contains(Flags::END_AFTER_FLUSH)
            && !self.flags.contains(Flags::EMPTY_PACKET_PENDING)
            && self.buffered_data_for_node_net.len == 0
    }

    fn internal_flush(&mut self) {
        if self.buffered_data_for_node_net.len > 0 {
            let written: usize = usize::try_from(
                self.do_socket_write(self.buffered_data_for_node_net.slice())
                    .max(0),
            )
            .unwrap();
            self.bytes_written += written as u64;
            if written > 0 {
                if self.buffered_data_for_node_net.len as usize > written {
                    let remaining_len =
                        self.buffered_data_for_node_net.len as usize - written;
                    // SAFETY: overlapping copy within the same buffer.
                    unsafe {
                        core::ptr::copy(
                            self.buffered_data_for_node_net.ptr.add(written),
                            self.buffered_data_for_node_net.ptr,
                            remaining_len,
                        );
                    }
                    self.buffered_data_for_node_net.len = remaining_len as u32;
                } else {
                    self.buffered_data_for_node_net.clear_and_free();
                }
            }
        }

        let _ = self.try_write_empty_packet();
        self.socket.flush();

        if self.can_end_after_flush() {
            self.mark_inactive();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn flush(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        // `end()` → `internalFlush` → `markInactive` → `closeAndDetach(.normal)`
        // detaches `this.socket` and, for TLS, defers the raw close until the
        // peer's close_notify arrives — leaving `is_active` set so the eventual
        // `onClose` can run `handlers.markInactive()`. Without this guard a
        // follow-up `flush()` re-enters `markInactive`, sees the detached
        // socket as closed, and frees `*Handlers` early; the deferred `onClose`
        // then derefs freed memory. Every other `internalFlush` caller already
        // has this check.
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        this.internal_flush();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn terminate(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        this.close_and_detach(uws::SocketCloseCode::Failure);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn shutdown(
        this: &mut Self,
        _global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        let args = callframe.arguments_old(1);
        if args.len() > 0 && args.ptr()[0].to_boolean() {
            this.socket.shutdown_read();
        } else {
            this.socket.shutdown();
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn close(
        this: &mut Self,
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
        this.socket.close(uws::SocketCloseCode::FastShutdown);
        this.socket.detach();
        this.poll_ref.unref(global.bun_vm());
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn end(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();

        let mut args = callframe.arguments_undef(5);

        log!("end({} args)", args.len());
        if this.socket.is_detached() {
            return Ok(JSValue::js_number(-1i32));
        }

        this.ref_();
        // PORT NOTE: reshaped for borrowck — explicit deref at end.

        let result = match this.write_or_end::<true>(global, args.mut_(), false) {
            WriteResult::Fail => JSValue::ZERO,
            WriteResult::Success { wrote, total } => {
                if wrote >= 0 && usize::try_from(wrote).unwrap() == total {
                    this.internal_flush();
                }
                JSValue::js_number(wrote)
            }
        };
        this.deref();
        Ok(result)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_ref(
        this: &mut Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.is_detached() {
            this.ref_pollref_on_connect = true;
        }
        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }
        this.poll_ref.ref_(global.bun_vm());
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn js_unref(
        this: &mut Self,
        global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        jsc::mark_binding!();
        if this.socket.is_detached() {
            this.ref_pollref_on_connect = false;
        }
        this.poll_ref.unref(global.bun_vm());
        Ok(JSValue::UNDEFINED)
    }

    /// Called when refcount reaches zero. NOT `impl Drop` — this struct is the
    /// `m_ctx` payload of a `.classes.ts` class; teardown is owned by the
    /// intrusive refcount + `finalize()`.
    // SAFETY: `this` was allocated via `Box::into_raw` and refcount == 0.
    unsafe fn deinit_and_destroy(this: *mut Self) {
        let this_ref = unsafe { &mut *this };
        this_ref.mark_inactive();
        this_ref.detach_native_callback();
        this_ref.this_value.deinit();

        this_ref.buffered_data_for_node_net.deinit();

        this_ref.poll_ref.unref(VirtualMachine::get());
        // need to deinit event without being attached
        if this_ref.flags.contains(Flags::OWNED_PROTOS) {
            this_ref.protos = None; // Box::<[u8]> drops
        }

        this_ref.server_name = None; // Box::<[u8]> drops

        if let Some(connection) = this_ref.connection.take() {
            drop(connection);
        }
        if let Some(ctx) = this_ref.owned_ssl_ctx.take() {
            // SAFETY: BoringSSL FFI; we hold one owned ref.
            unsafe { boringssl::SSL_CTX_free(ctx) };
        }
        // SAFETY: `this` was Box::into_raw'd in `new()`.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called from JSC finalizer; `this` is the m_ctx payload.
        let this_ref = unsafe { &mut *this };
        log!("finalize() {}", this as usize);
        this_ref.flags.insert(Flags::FINALIZING);
        this_ref.this_value.finalize();
        if !this_ref.socket.is_closed() {
            this_ref.close_and_detach(uws::SocketCloseCode::Failure);
        }

        this_ref.deref();
    }

    #[bun_jsc::host_fn(method)]
    pub fn reload(
        this: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_old(1);

        if args.len() < 1 {
            return global.throw("Expected 1 argument", ());
        }

        if this.socket.is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        let opts = args.ptr()[0];
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return global.throw("Expected options object", ());
        }

        let socket_obj = opts.get(global, "socket")?.ok_or_else(|| {
            global.throw_err("Expected \"socket\" option", ())
        })?;

        // TODO(port): mutation through Rc<Handlers>. In Zig `this_handlers.* = handlers`
        // overwrites the pointee. Phase B: interior mutability or raw `*mut Handlers`.
        let this_handlers = this.get_handlers();
        let prev_mode = this_handlers.mode;
        let handlers = Handlers::from_js(global, socket_obj, prev_mode == SocketMode::Server)?;
        // Preserve runtime state across the struct assignment. `Handlers.fromJS` returns a
        // fresh struct with `active_connections = 0` and `mode` limited to `.server`/`.client`,
        // but this socket (and any in-flight callback scope) still holds references that were
        // counted against the old value, and a duplex-upgraded server socket must keep
        // `.duplex_server`. Losing the counter causes the next `markInactive` to either free
        // the heap-allocated client `Handlers` while the socket still points at it, or
        // underflow on the server path.
        let active_connections = this_handlers.active_connections;
        // SAFETY: this_handlers points into a heap allocation we conceptually own.
        // TODO(port): Rc<Handlers> aliasing — see field note.
        unsafe {
            let p = this_handlers as *const Handlers as *mut Handlers;
            (*p).deinit();
            *p = handlers;
            (*p).mode = prev_mode;
            (*p).active_connections = active_connections;
        }

        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_fd(this: &Self, _global: &JSGlobalObject) -> JSValue {
        this.socket.fd().to_js_without_making_libuv_owned()
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_bytes_written(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.bytes_written + this.buffered_data_for_node_net.len as u64)
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
        this: &mut Self,
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
        let Some(raw_socket) = this.socket.socket.get() else {
            return global
                .throw_invalid_arguments("upgradeTLS requires an established socket", ());
        };
        if this.is_server() {
            return global.throw("Server-side upgradeTLS is not supported. Use upgradeDuplexToTLS with isServer: true instead.", ());
        }

        let args = callframe.arguments_old(1);
        if args.len() < 1 {
            return global.throw("Expected 1 arguments", ());
        }
        let opts = args.ptr()[0];
        if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
            return global.throw("Expected options object", ());
        }

        let socket_obj = opts.get(global, "socket")?.ok_or_else(|| {
            global.throw_err("Expected \"socket\" option", ())
        })?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        let mut handlers = Handlers::from_js(global, socket_obj, false)?;
        if global.has_exception() {
            return Ok(JSValue::ZERO);
        }
        // 9 .protect()'d JS callbacks live in `handlers`; every error/throw
        // from here until they're moved into `tls.handlers` would leak them.
        // The flag flips once ownership transfers so the errdefer is a no-op
        // on success.
        let mut handlers_guard = scopeguard::guard(Some(handlers), |h| {
            if let Some(mut h) = h {
                h.deinit();
            }
        });

        // Resolve the `SSL_CTX*`. Prefer a passed `SecureContext` (the
        // memoised `tls.createSecureContext` path) so 10k upgrades share
        // one `SSL_CTX_new`; otherwise build an owned one from inline
        // `tls:` options. Either way `owned_ctx` holds one ref we drop in
        // deinit; SSL_new() takes its own.
        let mut owned_ctx: Option<*mut SSL_CTX> = None;
        // Dropped once `tls.owned_ssl_ctx` takes ownership; covers throws
        // between sc.borrow()/createSSLContext() and `bun.new(TLSSocket, …)`.
        let owned_ctx_guard = scopeguard::guard(&mut owned_ctx as *mut _, |p| {
            // SAFETY: p points to local owned_ctx.
            if let Some(c) = unsafe { (*p).take() } {
                unsafe { boringssl::SSL_CTX_free(c) };
            }
        });
        let mut ssl_opts: Option<jsc::api::ServerConfig::SSLConfig> = None;
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
                return global.throw_invalid_argument_type_value(
                    "secureContext",
                    "SecureContext",
                    sc_js,
                );
            };
            owned_ctx = Some(sc.borrow());
            // servername / ALPN still come from the surrounding tls config.
            if let Some(t) = opts.get_truthy(global, "tls")? {
                if !t.is_boolean() {
                    ssl_opts = jsc::api::ServerConfig::SSLConfig::from_js(
                        VirtualMachine::get(),
                        global,
                        t,
                    )?;
                }
            }
        } else if let Some(tls_js) = opts.get_truthy(global, "tls")? {
            if !tls_js.is_boolean() {
                ssl_opts = jsc::api::ServerConfig::SSLConfig::from_js(
                    VirtualMachine::get(),
                    global,
                    tls_js,
                )?;
            } else if tls_js.to_boolean() {
                ssl_opts = Some(jsc::api::ServerConfig::SSLConfig::ZERO);
            }
            let cfg = ssl_opts
                .as_mut()
                .ok_or_else(|| global.throw_err("Expected \"tls\" option", ()))?;
            let mut create_err = uws::create_bun_socket_error_t::None;
            // Per-VM weak cache: `tls:true` and `{servername}`-only hit
            // the same CTX as `Bun.connect`; an inline CA dedupes across
            // every upgradeTLS that names it.
            owned_ctx = match VirtualMachine::get()
                .rare_data()
                .ssl_ctx_cache()
                .get_or_create(cfg, &mut create_err)
            {
                Some(c) => Some(c),
                None => {
                    // us_ssl_ctx_from_options only sets *err for the CA/cipher
                    // cases; bad cert/key/DH return NULL with err==.none and the
                    // detail is on the BoringSSL error queue.
                    if create_err != uws::create_bun_socket_error_t::None {
                        return global.throw_value(create_err.to_js(global));
                    }
                    return global.throw_value(boringssl::err_to_js(
                        global,
                        // SAFETY: BoringSSL FFI.
                        unsafe { boringssl::ERR_get_error() },
                    ));
                }
            };
        } else {
            return global.throw("Expected \"tls\" option", ());
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
        // TODO(port): Rc<Handlers> vs Box — Zig allocates a raw `*Handlers` here.
        let handlers_ptr = Rc::new(handlers_taken);

        let cfg = ssl_opts.as_ref();
        let mut tls = TLSSocket::new(TLSSocket {
            ref_count: Cell::new(1),
            handlers: Some(handlers_ptr.clone()),
            socket: SocketHandler::<true>::DETACHED,
            owned_ssl_ctx: owned_ctx,
            connection: this.connection.as_ref().map(|c| c.clone()),
            protos: cfg.and_then(|c| {
                c.protos.map(|p| {
                    // SAFETY: protos is NUL-terminated C string from SSLConfig.
                    Box::<[u8]>::from(unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes())
                })
            }),
            server_name: cfg.and_then(|c| {
                c.server_name.map(|sn| {
                    // SAFETY: server_name is NUL-terminated C string from SSLConfig.
                    Box::<[u8]>::from(unsafe { core::ffi::CStr::from_ptr(sn) }.to_bytes())
                })
            }),
            flags: Flags::default(),
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::init(),
            ref_pollref_on_connect: true,
            buffered_data_for_node_net: BabyList::default(),
            bytes_written: 0,
            native_callback: NativeCallbacks::None,
            twin: None,
        });
        // SAFETY: tls just allocated via Box::into_raw.
        let tls = unsafe { &mut *tls };
        // tls.deinit() now drops the ref; clear so errdefer doesn't double-free.
        owned_ctx = None;
        scopeguard::ScopeGuard::into_inner(owned_ctx_guard);

        let sni: *const c_char = cfg
            .and_then(|c| c.server_name)
            .map(|p| p as *const c_char)
            .unwrap_or(ptr::null());
        let group = vm.rare_data().bun_connect_group(vm, true);
        let new_raw = match raw_socket.adopt_tls(
            group,
            uws::SocketKind::BunSocketTls,
            tls.owned_ssl_ctx.unwrap(),
            sni,
            core::mem::size_of::<*mut c_void>(),
            core::mem::size_of::<*mut c_void>(),
        ) {
            Some(s) => s,
            None => {
                // SAFETY: BoringSSL FFI.
                let err = unsafe { boringssl::ERR_get_error() };
                let _clear = scopeguard::guard((), |_| {
                    if err != 0 {
                        // SAFETY: BoringSSL FFI.
                        unsafe { boringssl::ERR_clear_error() };
                    }
                });
                // tls.deinit drops the owned_ctx ref
                tls.deref();
                // TODO(port): handlers_ptr.deinit() + destroy — Rc::drop handles
                // the destroy if this was the last ref; deinit is the unprotect.
                drop(handlers_ptr);
                if err != 0 && !global.has_exception() {
                    return global.throw_value(boringssl::err_to_js(global, err));
                }
                if !global.has_exception() {
                    return global.throw(
                        "Failed to upgrade socket from TCP -> TLS. Is the TLS config correct?",
                        (),
                    );
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
        let was_reffed = this.poll_ref.is_active();
        // Capture before downgrade so the cached `data` (net.ts stores
        // `{self: net.Socket}` there) survives onto the raw twin.
        let original_data: JSValue =
            Self::data_get_cached(this.get_this_value(global)).unwrap_or(JSValue::UNDEFINED);
        original_data.ensure_still_alive();
        if this.flags.contains(Flags::IS_ACTIVE) {
            this.poll_ref.disable();
            this.flags.remove(Flags::IS_ACTIVE);
            // Do NOT markInactive raw_handlers — ownership of the
            // active_connections=1 it holds is transferring to `raw`.
            this.this_value.downgrade();
        }
        // PORT NOTE: reshaped for borrowck — `defer this.deref()` moved to end.
        this.detach_native_callback();
        this.socket.detach();

        // Only NOW is it safe for dispatch to fire: ext + kind point at `tls`.
        // SAFETY: ext slot is sized for `*mut TLSSocket`.
        unsafe { *new_raw.ext::<*mut TLSSocket>() = tls as *mut TLSSocket };
        tls.socket = SocketHandler::<true>::from(new_raw);
        tls.ref_();

        // The `raw` half — same `us_socket_t*`, ORIGINAL pre-upgrade
        // *Handlers, writes bypass SSL. Dispatch reaches it via the
        // `ssl_raw_tap` ciphertext hook, never via the ext slot.
        let raw = TLSSocket::new(TLSSocket {
            ref_count: Cell::new(1),
            handlers: raw_handlers,
            socket: SocketHandler::<true>::from(new_raw),
            owned_ssl_ctx: None,
            connection: None,
            protos: None,
            server_name: None,
            // is_active so the chained `raw.onClose` → `markInactive` path
            // tears down `raw_handlers` (client-mode handlers free
            // themselves there). No poll_ref — `tls` keeps the loop alive.
            // active_connections=1 was already on raw_handlers from `this`.
            flags: Flags::BYPASS_TLS | Flags::IS_ACTIVE | Flags::OWNED_PROTOS,
            this_value: JsRef::empty(),
            poll_ref: KeepAlive::init(),
            ref_pollref_on_connect: true,
            buffered_data_for_node_net: BabyList::default(),
            bytes_written: 0,
            native_callback: NativeCallbacks::None,
            twin: None,
        });
        // SAFETY: raw just allocated via Box::into_raw.
        let raw_ref = unsafe { &mut *raw };
        raw_ref.ref_();
        // SAFETY: `raw` came from `TLSSocket::new` (Box::into_raw); intrusive +1 held.
        tls.twin = Some(unsafe { IntrusiveRc::from_raw(raw) });
        new_raw.set_ssl_raw_tap(true);

        let tls_js_value = tls.get_this_value(global);
        let raw_js_value = raw_ref.get_this_value(global);
        TLSSocket::data_set_cached(tls_js_value, global, default_data);
        // `raw` keeps the pre-upgrade `data` so its callbacks emit on the
        // original net.Socket, not the TLS one.
        TLSSocket::data_set_cached(raw_js_value, global, original_data);

        tls.mark_active();
        if was_reffed {
            tls.poll_ref.ref_(vm);
        }

        // Fire onOpen with the right `this`, then send ClientHello. Doing
        // it before ext was repointed would have ALPN/onOpen land in the
        // dead TCPSocket.
        tls.on_open(tls.socket);
        new_raw.start_tls_handshake();

        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(global, 0, raw_js_value)?;
        array.put_index(global, 1, tls_js_value)?;
        this.deref();
        Ok(array)
    }

    // ──────────────────────────────────────────────────────────────────────
    // TLS-only accessor methods. In Zig these are `pub const X = if (ssl) ...
    // else fallback`. Rust cannot const-select inherent methods on a const
    // generic bool, so Phase A defines all of them as forwarding methods that
    // branch on `SSL` at runtime (monomorphised away).
    // ──────────────────────────────────────────────────────────────────────

    #[bun_jsc::host_fn(method)]
    pub fn disable_renegotiation(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::disable_renegotiation(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn is_session_reused(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::is_session_reused(this, g, f) } else { Ok(JSValue::FALSE) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_verify_mode(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::set_verify_mode(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn renegotiate(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::renegotiate(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_ticket(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_tls_ticket(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_session(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::set_session(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_session(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_session(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(getter)]
    pub fn get_alpn_protocol(this: &Self, g: &JSGlobalObject) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_alpn_protocol(this, g) } else { Ok(JSValue::FALSE) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn export_keying_material(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::export_keying_material(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_ephemeral_key_info(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_ephemeral_key_info(this, g, f) } else { Ok(JSValue::NULL) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_cipher(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_cipher(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_peer_finished_message(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_tls_peer_finished_message(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_finished_message(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_tls_finished_message(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_shared_sigalgs(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_shared_sigalgs(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_tls_version(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_tls_version(this, g, f) } else { Ok(JSValue::NULL) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_max_send_fragment(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::set_max_send_fragment(this, g, f) } else { Ok(JSValue::FALSE) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_peer_certificate(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_peer_certificate(this, g, f) } else { Ok(JSValue::NULL) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_certificate(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_certificate(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_peer_x509_certificate(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_peer_x509_certificate(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_x509_certificate(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_x509_certificate(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn get_servername(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::get_servername(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
    #[bun_jsc::host_fn(method)]
    pub fn set_servername(this: &mut Self, g: &JSGlobalObject, f: &CallFrame) -> JsResult<JSValue> {
        if SSL { tls_socket_functions::set_servername(this, g, f) } else { Ok(JSValue::UNDEFINED) }
    }
}

pub type TCPSocket = NewSocket<false>;
pub type TLSSocket = NewSocket<true>;

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
    pub upgrade: uws::UpgradedDuplex,
    // We only us a tls and not a raw socket when upgrading a Duplex, Duplex dont support socketpairs
    pub tls: Option<IntrusiveRc<TLSSocket>>,
    // task used to deinit the context in the next tick, vm is used to enqueue the task
    pub vm: &'static VirtualMachine,
    pub task: jsc::AnyTask,
    pub task_event: EventState,
    /// Config to build a fresh `SSL_CTX` from (legacy `{ca,cert,key}` callers).
    /// Mutually exclusive with `owned_ctx` — `runEvent` prefers `owned_ctx`.
    pub ssl_config: Option<jsc::api::ServerConfig::SSLConfig>,
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
    pub fn new(init: Self) -> *mut Self {
        Box::into_raw(Box::new(init))
    }

    fn on_open(&mut self) {
        self.is_open = true;
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { tls.as_mut().on_open(socket) };
        }
    }

    fn on_data(&mut self, decoded_data: &[u8]) {
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { tls.as_mut().on_data(socket, decoded_data) };
        }
    }

    fn on_handshake(&mut self, success: bool, ssl_error: uws::us_bun_verify_error_t) {
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            let _ = unsafe { tls.as_mut().on_handshake(socket, success as i32, ssl_error) };
        }
    }

    fn on_end(&mut self) {
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);
        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { tls.as_mut().on_end(socket) };
        }
    }

    fn on_writable(&mut self) {
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { tls.as_mut().on_writable(socket) };
        }
    }

    fn on_error(&mut self, err_value: JSValue) {
        if self.is_open {
            if let Some(tls) = &mut self.tls {
                // SAFETY: intrusive refcount; single-threaded dispatch.
                unsafe { tls.as_mut().handle_error(err_value) };
            }
        } else {
            if let Some(mut tls) = self.tls.take() {
                // Pre-open error (e.g. the duplex emitted non-Buffer data
                // before the queued `.StartTLS` task ran). `handleConnectError`
                // → `markInactive` frees `tls.handlers`; null `tls` so the
                // still-queued `.StartTLS` → `onOpen` — and any further
                // duplex events — skip the TLSSocket instead of calling
                // `getHandlers()` on the freed allocation.
                // SAFETY: intrusive refcount; single-threaded dispatch.
                let _ = unsafe {
                    tls.as_mut()
                        .handle_connect_error(sys::SystemErrno::ECONNREFUSED as c_int)
                };
                // Zig `tls.deref()` — IntrusiveRc::drop decrements.
                drop(tls);
            }
        }
    }

    fn on_timeout(&mut self) {
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);

        if let Some(tls) = &mut self.tls {
            // SAFETY: intrusive refcount; single-threaded dispatch.
            unsafe { tls.as_mut().on_timeout(socket) };
        }
    }

    fn on_close(&mut self) {
        let socket = SocketHandler::<true>::from_duplex(&mut self.upgrade);

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
            // reconstruct the IntrusiveRc (that would double-deref).
            let _ = unsafe { (*p).on_close(socket, 0, None) };
        }

        self.deinit_in_next_tick();
    }

    fn run_event(&mut self) {
        match self.task_event {
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
                if self.tls.is_none() {
                    self.deinit();
                    return;
                }
                log!(
                    "DuplexUpgradeContext.startTLS mode={}",
                    <&'static str>::from(self.mode)
                );
                let is_client = self.mode == SocketMode::Client;
                let started: Result<(), bun_core::Error> = if let Some(ctx) = self.owned_ctx.take()
                {
                    // Transfer the ref into SSLWrapper; null first so the
                    // failure path / deinit don't double-free it.
                    self.upgrade.start_tls_with_ctx(ctx, is_client)
                } else if let Some(config) = &self.ssl_config {
                    self.upgrade.start_tls(config, is_client)
                } else {
                    Ok(())
                };
                if let Err(err) = started {
                    if err == bun_core::err!("OutOfMemory") {
                        bun_core::out_of_memory();
                    }
                    let errno = sys::SystemErrno::ECONNREFUSED as c_int;
                    if let Some(tls) = self.tls.take() {
                        // `handleConnectError` consumes our +1 (its
                        // `needs_deref` path) and detaches. Null
                        // `this.tls` so `deinit` doesn't deref again.
                        let p = IntrusiveRc::into_raw(tls);
                        // SAFETY: intrusive refcount; `handle_connect_error`
                        // consumes the +1, so do NOT reconstruct the IntrusiveRc.
                        let _ = unsafe { (*p).handle_connect_error(errno) };
                    }
                    // `startTLS`/`startTLSWithCTX` failed before the
                    // SSLWrapper was assigned, so its close callback
                    // was never registered and nothing will schedule
                    // `.Close`. Same as the `tls == null` early-return
                    // above: tear down here.
                    self.deinit();
                    return;
                }
                self.ssl_config = None; // Drop frees.
            }
            // Previously this only called `upgrade.close()` and never `deinit`,
            // leaking the SSLWrapper, the strong refs, and this struct itself
            // for every duplex-upgraded TLS socket.
            EventState::Close => self.deinit(),
        }
    }

    fn deinit_in_next_tick(&mut self) {
        self.task_event = EventState::Close;
        self.vm.enqueue_task(jsc::Task::init(&mut self.task));
    }

    fn start_tls(&mut self) {
        self.task_event = EventState::StartTLS;
        self.vm.enqueue_task(jsc::Task::init(&mut self.task));
    }

    fn deinit(&mut self) {
        if let Some(tls) = self.tls.take() {
            // Zig `tls.deref()` — IntrusiveRc::drop decrements.
            drop(tls);
        }
        // Close raced ahead of StartTLS — drop the unconsumed config.
        self.ssl_config = None;
        if let Some(ctx) = self.owned_ctx.take() {
            // SAFETY: BoringSSL FFI; we hold one owned ref.
            unsafe { boringssl::SSL_CTX_free(ctx) };
        }
        self.upgrade.deinit();
        // SAFETY: `self` was Box::into_raw'd in `new()`.
        drop(unsafe { Box::from_raw(self as *mut Self) });
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

    let args = callframe.arguments_old(2);
    if args.len() < 2 {
        return global.throw("Expected 2 arguments", ());
    }
    let duplex = args.ptr()[0];
    // TODO: do better type checking
    if duplex.is_empty_or_undefined_or_null() {
        return global.throw("Expected a Duplex instance", ());
    }

    let opts = args.ptr()[1];
    if opts.is_empty_or_undefined_or_null() || opts.is_boolean() || !opts.is_object() {
        return global.throw("Expected options object", ());
    }

    let socket_obj = opts.get(global, "socket")?.ok_or_else(|| {
        global.throw_err("Expected \"socket\" option", ())
    })?;

    let mut is_server = false;
    if let Some(is_server_val) = opts.get_truthy(global, "isServer")? {
        is_server = is_server_val.to_boolean();
    }
    // Note: Handlers.fromJS is_server=false because these handlers are standalone
    // allocations (not embedded in a Listener). The mode field on Handlers
    // controls lifecycle (markInactive expects a Listener parent when .server).
    // The TLS direction (client vs server) is controlled by DuplexUpgradeContext.mode.
    let handlers = Handlers::from_js(global, socket_obj, false)?;
    let mut handlers_guard = scopeguard::guard(Some(handlers), |h| {
        if let Some(mut h) = h {
            h.deinit();
        }
    });

    // Resolve the `SSL_CTX*`. Prefer a passed `SecureContext` (the memoised
    // `tls.createSecureContext` path — what `[buntls]` now returns) so the
    // duplex/named-pipe path shares one `SSL_CTX_new` with everyone else.
    // node:net wraps `[buntls]`'s return as `opts.tls.secureContext`; userland
    // may also pass it top-level. Same lookup as `upgradeTLS` above.
    let mut owned_ctx: Option<*mut SSL_CTX> = None;
    let owned_ctx_guard = scopeguard::guard(&mut owned_ctx as *mut _, |p| {
        // SAFETY: p points to local owned_ctx.
        if let Some(c) = unsafe { (*p).take() } {
            unsafe { boringssl::SSL_CTX_free(c) };
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
            return global.throw_invalid_argument_type_value(
                "secureContext",
                "SecureContext",
                sc_js,
            );
        };
        owned_ctx = Some(sc.borrow());
    }

    // Still parse SSLConfig for servername/ALPN (those live on the JS-side
    // wrapper, not the SSL_CTX) and as the build source when no SecureContext.
    let mut ssl_opts: Option<jsc::api::ServerConfig::SSLConfig> = None;
    // Drop frees ssl_opts on error.
    if let Some(tls) = opts.get_truthy(global, "tls")? {
        if !tls.is_boolean() {
            ssl_opts =
                jsc::api::ServerConfig::SSLConfig::from_js(VirtualMachine::get(), global, tls)?;
        } else if tls.to_boolean() {
            ssl_opts = Some(jsc::api::ServerConfig::SSLConfig::ZERO);
        }
    }
    if owned_ctx.is_none() && ssl_opts.is_none() {
        return global.throw("Expected \"tls\" option", ());
    }
    let socket_config: Option<&jsc::api::ServerConfig::SSLConfig> = ssl_opts.as_ref();

    let mut default_data = JSValue::ZERO;
    if let Some(v) = opts.fast_get(global, jsc::BuiltinName::Data)? {
        default_data = v;
        default_data.ensure_still_alive();
    }

    let handlers_taken = handlers_guard.take().unwrap();
    scopeguard::ScopeGuard::into_inner(handlers_guard);
    // TODO(port): Rc<Handlers> vs Box — Zig allocates a raw `*Handlers` here.
    let mut handlers_rc = Rc::new(handlers_taken);
    // Set mode to duplex_server so TLSSocket.isServer() returns true for ALPN server mode
    // without affecting markInactive lifecycle (which requires a Listener parent).
    // SAFETY: freshly allocated, sole owner.
    unsafe {
        Rc::get_mut(&mut handlers_rc).unwrap().mode = if is_server {
            SocketMode::DuplexServer
        } else {
            SocketMode::Client
        };
    }
    let tls = TLSSocket::new(TLSSocket {
        ref_count: Cell::new(1),
        handlers: Some(handlers_rc),
        socket: SocketHandler::<true>::DETACHED,
        owned_ssl_ctx: None,
        connection: None,
        protos: socket_config.and_then(|cfg| {
            cfg.protos.map(|p| {
                // SAFETY: protos is NUL-terminated C string from SSLConfig.
                Box::<[u8]>::from(unsafe { core::ffi::CStr::from_ptr(p) }.to_bytes())
            })
        }),
        server_name: socket_config.and_then(|cfg| {
            cfg.server_name.map(|sn| {
                // SAFETY: server_name is NUL-terminated C string from SSLConfig.
                Box::<[u8]>::from(unsafe { core::ffi::CStr::from_ptr(sn) }.to_bytes())
            })
        }),
        flags: Flags::default(),
        this_value: JsRef::empty(),
        poll_ref: KeepAlive::init(),
        ref_pollref_on_connect: true,
        buffered_data_for_node_net: BabyList::default(),
        bytes_written: 0,
        native_callback: NativeCallbacks::None,
        twin: None,
    });
    // SAFETY: tls just allocated via Box::into_raw.
    let tls_ref = unsafe { &mut *tls };
    let tls_js_value = tls_ref.get_this_value(global);
    TLSSocket::data_set_cached(tls_js_value, global, default_data);

    let owned_ctx_taken = owned_ctx.take();
    scopeguard::ScopeGuard::into_inner(owned_ctx_guard);

    let duplex_context = DuplexUpgradeContext::new(DuplexUpgradeContext {
        // TODO(port): in-place init — Zig `undefined`, assigned below after we
        // have `duplex_context` (self-referential ctx ptr). `zeroed()` is UB if
        // `UpgradedDuplex` has NonNull/fn-ptr fields; Phase B: allocate via
        // `Box::<MaybeUninit<Self>>::new_uninit()` and field-write.
        upgrade: unsafe { core::mem::zeroed() },
        // SAFETY: `tls` came from `TLSSocket::new` (Box::into_raw); intrusive +1 held.
        tls: Some(unsafe { IntrusiveRc::from_raw(tls) }),
        vm: global.bun_vm(),
        // TODO(port): in-place init — Zig `undefined`, assigned below after we
        // have `duplex_context`. `zeroed()` is UB if `AnyTask` has fn-ptr fields;
        // Phase B: same MaybeUninit two-phase init as `upgrade`.
        task: unsafe { core::mem::zeroed() },
        task_event: EventState::StartTLS,
        // When `owned_ctx` is set, `runEvent` builds from it and ignores
        // `ssl_config` for SSL_CTX construction; servername/ALPN already
        // copied onto `tls` above so the config's only remaining use is the
        // legacy build path.
        ssl_config: if owned_ctx_taken.is_none() {
            ssl_opts.take()
        } else {
            None
        },
        owned_ctx: owned_ctx_taken,
        is_open: false,
        mode: if is_server {
            SocketMode::DuplexServer
        } else {
            SocketMode::Client
        },
    });
    // SAFETY: just allocated via Box::into_raw.
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

    dc.task = jsc::AnyTask::new::<DuplexUpgradeContext>(
        DuplexUpgradeContext::run_event,
        duplex_context,
    );
    dc.upgrade = uws::UpgradedDuplex::from(
        global,
        duplex,
        uws::UpgradedDuplexCallbacks {
            on_open: DuplexUpgradeContext::on_open as *const _,
            on_data: DuplexUpgradeContext::on_data as *const _,
            on_handshake: DuplexUpgradeContext::on_handshake as *const _,
            on_close: DuplexUpgradeContext::on_close as *const _,
            on_end: DuplexUpgradeContext::on_end as *const _,
            on_writable: DuplexUpgradeContext::on_writable as *const _,
            on_error: DuplexUpgradeContext::on_error as *const _,
            on_timeout: DuplexUpgradeContext::on_timeout as *const _,
            ctx: duplex_context as *mut c_void,
        },
    );

    tls_ref.socket = SocketHandler::<true>::from_duplex(&mut dc.upgrade);
    tls_ref.mark_active();
    tls_ref.poll_ref.ref_(global.bun_vm());

    dc.start_tls();

    let array = JSValue::create_empty_array(global, 2)?;
    array.put_index(global, 0, tls_js_value)?;
    // data, end, drain and close events must be reported
    array.put_index(global, 1, dc.upgrade.get_js_handlers(global)?)?;

    Ok(array)
}

#[bun_jsc::host_fn]
pub fn js_is_named_pipe_socket(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = callframe.arguments_old(3);
    if arguments.len() < 1 {
        return global.throw_not_enough_arguments("isNamedPipeSocket", 1, arguments.len());
    }
    let socket = arguments.ptr()[0];
    if let Some(this) = socket.as_::<TCPSocket>() {
        return Ok(JSValue::from(this.socket.is_named_pipe()));
    } else if let Some(this) = socket.as_::<TLSSocket>() {
        return Ok(JSValue::from(this.socket.is_named_pipe()));
    }
    Ok(JSValue::FALSE)
}

#[bun_jsc::host_fn]
pub fn js_get_buffered_amount(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    let arguments = callframe.arguments_old(3);
    if arguments.len() < 1 {
        return global.throw_not_enough_arguments("getBufferedAmount", 1, arguments.len());
    }
    let socket = arguments.ptr()[0];
    if let Some(this) = socket.as_::<TCPSocket>() {
        return Ok(JSValue::js_number(this.buffered_data_for_node_net.len));
    } else if let Some(this) = socket.as_::<TLSSocket>() {
        return Ok(JSValue::js_number(this.buffered_data_for_node_net.len));
    }
    Ok(JSValue::js_number(0))
}

#[bun_jsc::host_fn]
pub fn js_create_socket_pair(global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding!();

    #[cfg(windows)]
    {
        return global.throw("Not implemented on Windows", ());
    }

    #[cfg(not(windows))]
    {
        let mut fds_: [sys::c::fd_t; 2] = [0, 0];
        // SAFETY: libc FFI.
        let rc = unsafe {
            sys::c::socketpair(
                sys::posix::AF_UNIX,
                sys::posix::SOCK_STREAM,
                0,
                fds_.as_mut_ptr(),
            )
        };
        if rc != 0 {
            let err = sys::Error::from_code(sys::get_errno(rc), sys::Tag::Socketpair);
            return global.throw_value(err.to_js(global)?);
        }

        let _ = sys::Fd::from_native(fds_[0]).update_nonblocking(true);
        let _ = sys::Fd::from_native(fds_[1]).update_nonblocking(true);

        let array = JSValue::create_empty_array(global, 2)?;
        array.put_index(global, 0, JSValue::js_number(fds_[0]))?;
        array.put_index(global, 1, JSValue::js_number(fds_[1]))?;
        Ok(array)
    }
}

#[bun_jsc::host_fn]
pub fn js_set_socket_options(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();

    if arguments.len() < 3 {
        return global.throw_not_enough_arguments("setSocketOptions", 3, arguments.len());
    }

    let Some(socket) = arguments.ptr()[0].as_::<TCPSocket>() else {
        return global.throw("Expected a SocketTCP instance", ());
    };

    let is_for_send_buffer = arguments.ptr()[1].to_int32() == 1;
    let is_for_recv_buffer = arguments.ptr()[1].to_int32() == 2;
    let buffer_size = arguments.ptr()[2].to_int32();
    let file_descriptor = socket.socket.fd();

    #[cfg(unix)]
    {
        if is_for_send_buffer {
            let result = sys::setsockopt(
                file_descriptor,
                sys::posix::SOL_SOCKET,
                sys::posix::SO_SNDBUF,
                buffer_size,
            );
            if let Some(err) = result.as_err() {
                return global.throw_value(err.to_js(global)?);
            }
        } else if is_for_recv_buffer {
            let result = sys::setsockopt(
                file_descriptor,
                sys::posix::SOL_SOCKET,
                sys::posix::SO_RCVBUF,
                buffer_size,
            );
            if let Some(err) = result.as_err() {
                return global.throw_value(err.to_js(global)?);
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (is_for_send_buffer, is_for_recv_buffer, buffer_size, file_descriptor);
    }

    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/socket.zig (2286 lines)
//   confidence: medium
//   todos:      16
//   notes:      `twin`/`DuplexUpgradeContext.tls`/`NativeCallbacks::H2` switched to IntrusiveRc (intrusive RefCount + raw *T crosses FFI). `handlers: Rc<Handlers>` still pending (heavy mutation; Phase B → raw *mut or IntrusiveRc). DuplexUpgradeContext upgrade/task need MaybeUninit two-phase init (self-referential ctx). Handlers scope.exit() defer-pattern reshaped to tail-calls; verify ordering vs Zig defers.
// ──────────────────────────────────────────────────────────────────────────
