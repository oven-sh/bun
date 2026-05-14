//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `on_open`/`on_data`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_uws::{ConnectingSocket, NewSocketHandler};
use bun_uws_sys::thunk;
use bun_uws_sys::thunk::ExtSlot;
use bun_uws_sys::vtable::Handler as VHandler;
use bun_uws_sys::{CloseCode, us_bun_verify_error_t, us_socket_t};

use crate::api;
use crate::valkey_jsc::js_valkey;
use bun_http_jsc::websocket_client;
use bun_http_jsc::websocket_client::websocket_upgrade_client;
use bun_jsc::ipc as IPC;
use bun_sql_jsc::mysql;
use bun_sql_jsc::postgres;

/// Some consumer methods are `bun.JSError!void` (they can throw into JS),
/// some are plain `void`. The old `configure()` trampolines hand-unrolled the
/// catch per call site; here we do it once. JS errors are already on the
/// pending-exception slot — there's nowhere for the C event loop to propagate
/// them — so we just don't lose the unwind.
///
/// Zig used `@typeInfo(@TypeOf(result)) == .error_union` to branch at comptime;
/// in Rust we express the same with a tiny trait specialised on `()` and
/// `Result<(), E>`.
#[inline]
fn swallow<R: Swallow>(result: R) {
    result.swallow();
}

trait Swallow {
    fn swallow(self);
}
impl Swallow for () {
    #[inline]
    fn swallow(self) {}
}
impl<E> Swallow for Result<(), E> {
    #[inline]
    fn swallow(self) {
        let _ = self;
    }
}

/// Replaces the Zig `if (@hasDecl(T, "onX")) this.onX(..)` pattern: a trait
/// with default no-op methods that each owner type overrides for the events it
/// actually handles. The `<const SSL: bool>` parameter mirrors the Zig
/// `comptime ssl: bool` so a type can opt into different behaviour per
/// transport (and so `NewSocketHandler<SSL>` is nameable in signatures).
///
/// All methods default to `Ok(())`; `swallow` collapses both `()` and
/// `Result<(), _>` so consumer impls may return either — but to avoid
/// associated-type contortions in Phase A every default returns
/// `bun_jsc::JsResult<()>` and plain-`void` consumers just `Ok(())`.
// TODO(port): if a consumer's `on_*` is infallible, the trait default forces a
// `Result` wrap; revisit once consumer crates are ported.
pub trait SocketEvents<const SSL: bool> {
    fn on_open(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_data(&mut self, _s: NewSocketHandler<SSL>, _data: &[u8]) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_writable(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_close(
        &mut self,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_timeout(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_long_timeout(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_end(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_connect_error(&mut self, _s: NewSocketHandler<SSL>, _code: i32) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_handshake(
        &mut self,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_fd(&mut self, _s: NewSocketHandler<SSL>, _fd: c_int) -> bun_jsc::JsResult<()> {
        Ok(())
    }
}

/// `Ext = *?*T`: the socket ext stores a single pointer to the heap-allocated
/// owner (matching the old `socket.ext(**anyopaque).* = this` pattern). It is
/// optional because a connect/accept can fail and dispatch `on_close` /
/// `on_connect_error` BEFORE the caller has had a chance to stash `this` in the
/// freshly-calloc'd ext slot — pretending it's `**T` there is a NULL deref the
/// type system can't see.
pub struct PtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

#[inline(always)]
fn wrap<const SSL: bool>(s: *mut us_socket_t) -> NewSocketHandler<SSL> {
    NewSocketHandler::<SSL>::from(s)
}

impl<T, const SSL: bool> VHandler for PtrHandler<T, SSL>
where
    T: SocketEvents<SSL> + 'static,
{
    /// `?*T` — the slot lives in C-allocated (`calloc`) memory; the trampoline
    /// hands it to us by `&mut`. `ExtSlot<T>` (vs. raw `Option<NonNull<T>>`)
    /// encodes the non-re-entrancy contract so `owner_mut()` is a safe call.
    type Ext = ExtSlot<T>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;
    const HAS_ON_FD: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_open(wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_data(wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_writable(wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_close(wrap::<SSL>(s), code, reason));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_timeout(wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_long_timeout(wrap::<SSL>(s)));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_end(wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close FIRST, then notify — same order `main`'s `configure()`
        // trampoline used. The handler may re-enter `connectInner`
        // synchronously (node:net `autoSelectFamily` falls back to the
        // next address from inside the JS `connectError` callback); on
        // Windows/libuv, starting the next attempt's `uv_poll_t` while
        // this half-open one is still active and then closing it
        // *afterwards* leaves the second poll never delivering
        // writable/error → process hang (Win11-aarch64
        // double-connect.test, test-net-server-close).
        //
        // Safe for TLS too: `us_internal_ssl_close` short-circuits
        // SEMI_SOCKET straight to `close_raw`, and `close_raw` skips
        // dispatch for SEMI_SOCKET, so no `on_handshake`/`on_close` lands
        // in JS before we read `ext`/`this`.
        let this = ext.get();
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        // SAFETY: snapshot of the ext slot taken before close; unique heap
        // owner, single-threaded dispatch (same contract as `ExtSlot::owner_mut`,
        // but the slot storage may have been freed by `close` so we deref the
        // snapshot rather than re-borrowing `ext`).
        if let Some(t) = unsafe { thunk::ext_owner(&this) } {
            swallow(t.on_connect_error(wrap::<SSL>(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        // SAFETY: `c` is a live connecting socket; ext slot holds the unique heap owner.
        let Some(this) = (unsafe { thunk::connecting_ext_owner::<T>(c) }) else {
            return;
        };
        swallow(this.on_connect_error(NewSocketHandler::<SSL>::from_connecting(c), code));
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_handshake(wrap::<SSL>(s), ok as i32, err));
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(this.on_fd(wrap::<SSL>(s), fd));
    }
}

// ── RawSocketEvents / RawPtrHandler ─────────────────────────────────────────
//
// Some consumers' handlers may free or re-enter `*Self` mid-call (refcount
// reaching zero, `tcp.close()` synchronously dispatching `on_close`, …) and
// therefore take `*mut Self` rather than `&mut self`. Dispatching those
// through `PtrHandler` would form a `&mut T` argument that outlives the
// allocation it points to (Stacked-Borrows argument-protector UB), so they
// get a raw-pointer twin of the trait/adapter pair.
pub trait RawSocketEvents<const SSL: bool>: Sized {
    const HAS_ON_OPEN: bool = false;

    unsafe fn on_open(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_data(_this: *mut Self, _s: NewSocketHandler<SSL>, _data: &[u8]) {}
    unsafe fn on_writable(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_close(
        _this: *mut Self,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: *mut c_void,
    ) {
    }
    unsafe fn on_timeout(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_long_timeout(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_end(_this: *mut Self, _s: NewSocketHandler<SSL>) {}
    unsafe fn on_connect_error(_this: *mut Self, _s: NewSocketHandler<SSL>, _code: i32) {}
    unsafe fn on_handshake(
        _this: *mut Self,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: bun_uws::us_bun_verify_error_t,
    ) {
    }
}

pub struct RawPtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

impl<T, const SSL: bool> VHandler for RawPtrHandler<T, SSL>
where
    T: RawSocketEvents<SSL> + 'static,
{
    type Ext = Option<NonNull<T>>;

    const HAS_ON_OPEN: bool = T::HAS_ON_OPEN;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = *ext else { return };
        // SAFETY: ext slot holds the unique heap owner; single-threaded dispatch.
        unsafe { T::on_open(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_data(this.as_ptr(), wrap::<SSL>(s), data) };
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_writable(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe {
            T::on_close(
                this.as_ptr(),
                wrap::<SSL>(s),
                code,
                reason.unwrap_or(core::ptr::null_mut()),
            )
        };
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_timeout(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_long_timeout(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_end(this.as_ptr(), wrap::<SSL>(s)) };
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close first, then notify — see `PtrHandler::on_connect_error`.
        let this = *ext;
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        if let Some(t) = this {
            // SAFETY: see `on_open`.
            unsafe { T::on_connect_error(t.as_ptr(), wrap::<SSL>(s), code) };
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        // SAFETY: `c` is a live connecting socket passed by the trampoline.
        let Some(this) = (unsafe { thunk::connecting_ext_ptr::<T>(c) }) else {
            return;
        };
        // SAFETY: see `on_open`.
        unsafe {
            T::on_connect_error(
                this.as_ptr(),
                NewSocketHandler::<SSL>::from_connecting(c),
                code,
            )
        };
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = *ext else { return };
        // SAFETY: see `on_open`.
        unsafe { T::on_handshake(this.as_ptr(), wrap::<SSL>(s), ok as i32, err) };
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_upgrade_client::NewHttpUpgradeClient<SSL> {
    const HAS_ON_OPEN: bool = true;

    unsafe fn on_open(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { Self::handle_open(this, s) }
    }
    unsafe fn on_data(this: *mut Self, s: NewSocketHandler<SSL>, data: &[u8]) {
        unsafe { Self::handle_data(this, s, data) }
    }
    unsafe fn on_writable(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { Self::handle_writable(this, s) }
    }
    unsafe fn on_close(this: *mut Self, s: NewSocketHandler<SSL>, code: i32, reason: *mut c_void) {
        unsafe { Self::handle_close(this, s, code, reason) }
    }
    unsafe fn on_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { Self::handle_timeout(this, s) }
    }
    unsafe fn on_long_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { Self::handle_timeout(this, s) }
    }
    unsafe fn on_end(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { Self::handle_end(this, s) }
    }
    unsafe fn on_connect_error(this: *mut Self, s: NewSocketHandler<SSL>, code: i32) {
        unsafe { Self::handle_connect_error(this, s, code) }
    }
    unsafe fn on_handshake(
        this: *mut Self,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        unsafe { Self::handle_handshake(this, s, ok, err) }
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_client::WebSocket<SSL> {
    // Zig: no `onOpen` decl — adoption of an already-connected socket.

    unsafe fn on_data(this: *mut Self, _s: NewSocketHandler<SSL>, data: &[u8]) {
        unsafe { Self::handle_data(this, data) }
    }
    unsafe fn on_writable(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { (*this).handle_writable(s) }
    }
    unsafe fn on_close(this: *mut Self, s: NewSocketHandler<SSL>, code: i32, reason: *mut c_void) {
        unsafe { (*this).handle_close(s, code, reason) }
    }
    unsafe fn on_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { (*this).handle_timeout(s) }
    }
    unsafe fn on_long_timeout(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { (*this).handle_timeout(s) }
    }
    unsafe fn on_end(this: *mut Self, s: NewSocketHandler<SSL>) {
        unsafe { (*this).handle_end(s) }
    }
    unsafe fn on_connect_error(this: *mut Self, s: NewSocketHandler<SSL>, code: i32) {
        unsafe { (*this).handle_connect_error(s, code) }
    }
    unsafe fn on_handshake(
        this: *mut Self,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        unsafe { (*this).handle_handshake(s, ok, err) }
    }
}

// ── SocketEvents / NsSocketEvents impls ─────────────────────────────────────
//
// In Zig the consumer types carry `onOpen`/`onData`/… as inherent decls and
// `@hasDecl` filters at comptime. Rust expresses that as a trait with default
// no-ops; each consumer type opts in with an `impl` that overrides only the
// events it actually handles. `api::NewSocket`'s real impl lives in
// `socket/mod.rs` (bridges to inherent methods).

/// Forwards `NsSocketEvents` to the inherent `on_*` methods on a driver's
/// `SocketHandler<SSL>` namespace type. Mirrors Zig's single
/// `NsHandler(Owner, H, ssl)` generic (uws_handlers.zig:154), which used
/// `@hasDecl` + a comptime `swallow` to absorb both `void` and `!void`
/// returns; here `swallow()` (specialised on `()` and `Result<(), E>` above)
/// does the same, so one expansion covers drivers whose inherent fns are
/// infallible (postgres, mysql) and those returning `JsTerminatedResult<()>`
/// (valkey). The dispatcher (`NsHandler: VHandler`) `swallow`s the trait
/// result anyway, so swallowing one frame earlier is behaviour-preserving.
///
/// `on_long_timeout` is intentionally NOT forwarded — no driver defines it,
/// so the trait default fires (matches Zig's `@hasDecl` short-circuit).
///
/// `on_handshake` reads the inherent `ON_HANDSHAKE: Option<fn(..)>` const —
/// Zig's `pub const onHandshake = if (ssl) onHandshake_ else null;` pattern,
/// where the `null` arm meant "leave the slot unbound" so the dispatcher's
/// no-op default fires for plain TCP.
macro_rules! impl_ns_socket_events_forward {
    ($Owner:ty, $Handler:ty) => {
        impl<const SSL: bool> NsSocketEvents<$Owner, SSL> for $Handler {
            fn on_open(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_open(this, s));
                Ok(())
            }
            fn on_data(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                data: &[u8],
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_data(this, s, data));
                Ok(())
            }
            fn on_writable(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_writable(this, s));
                Ok(())
            }
            fn on_close(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
                reason: Option<*mut c_void>,
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_close(this, s, code, reason));
                Ok(())
            }
            fn on_timeout(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_timeout(this, s));
                Ok(())
            }
            fn on_end(this: &mut $Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_end(this, s));
                Ok(())
            }
            fn on_connect_error(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_connect_error(this, s, code));
                Ok(())
            }
            fn on_handshake(
                this: &mut $Owner,
                s: NewSocketHandler<SSL>,
                ok: i32,
                err: us_bun_verify_error_t,
            ) -> bun_jsc::JsResult<()> {
                if let Some(f) = Self::ON_HANDSHAKE {
                    swallow(f(this, s, ok, err));
                }
                Ok(())
            }
        }
    };
}

impl_ns_socket_events_forward!(
    postgres::PostgresSQLConnection,
    postgres::postgres_sql_connection::SocketHandler<SSL>
);
impl_ns_socket_events_forward!(
    mysql::js_my_sql_connection::JSMySQLConnection,
    mysql::js_my_sql_connection::SocketHandler<SSL>
);
impl_ns_socket_events_forward!(js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>);

// ── Bun.connect / Bun.listen ────────────────────────────────────────────────
// PORT NOTE (noalias re-entrancy): routed through `RawPtrHandler`, not
// `PtrHandler`. `NewSocket::on_*` re-enter JS (`socket.write/end/reload`) which
// re-derives `&mut NewSocket` via the wrapper's `m_ptr`; a `&mut NewSocket`
// argument formed by `PtrHandler` and protected through the dispatch frame
// would alias that re-entrant borrow (Stacked-Borrows UB + `noalias`
// dead-store of the re-entrant write). `RawPtrHandler` passes `*mut Self`.
pub type BunSocket<const SSL: bool> = RawPtrHandler<api::NewSocket<SSL>, SSL>;

/// Listener accept path: the ext is uninitialised at on_open time (the C accept
/// loop just calloc'd it), so we read the `*Listener` off `group->ext` and let
/// `on_create` allocate the `NewSocket` and stash it in the ext. After that the
/// socket is re-stamped as `.bun_socket_{tcp,tls}` and routes through
/// `BunSocket` above.
pub struct BunListener<const SSL: bool>;

impl<const SSL: bool> VHandler for BunListener<SSL>
where
    api::NewSocket<SSL>: RawSocketEvents<SSL>,
{
    // No `Ext` decl — owner comes from `s.group().owner(Listener)`.
    type Ext = ();
    const HAS_EXT: bool = false;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open_no_ext(s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref; `group()` is non-null for accepted sockets and `owner` was
        // stashed at listen time.
        let listener = us_socket_t::opaque_mut(s).group().owner::<api::Listener>();
        // on_create allocates the NewSocket, stashes it in ext, and
        // restamps kind → .bun_socket_*. Fire the user `open` handler
        // (markActive, ALPN, JS callback) before returning so the same
        // dispatch tick that accepted the fd sees an open socket — the
        // old `configure({onCreate, onOpen})` path did this in one
        // on_open call.
        //
        // SAFETY: `owner::<Listener>()` returns the back-pointer stashed by
        // `Listener::listen`; the listener strictly outlives every accepted
        // socket and is read-only here.
        let ns = api::Listener::on_create::<SSL>(unsafe { &*listener }, wrap::<SSL>(s));
        // SAFETY: `on_create` returns a freshly-boxed `NewSocket`; the `*mut`
        // `on_*` methods hold no `&mut NewSocket` across re-entrant JS calls.
        swallow(unsafe { api::NewSocket::on_open(ns, wrap::<SSL>(s)) });
    }
    // Accepted sockets reach the remaining events as `.bun_socket_*` once
    // on_create has restamped them; if anything fires before that, route to
    // the freshly stashed NewSocket.
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        // SAFETY (applies to every `thunk::socket_ext_owner` in this impl): `s`
        // is live; the ext slot holds the unique heap `NewSocket` stashed by
        // `on_create`; dispatch is single-threaded so no aliasing `&mut`. The
        // `&mut` from `socket_ext_owner` is immediately converted to `*mut` so
        // no `&mut NewSocket` is held across the re-entrant `on_*` body.
        if let Some(ns) = unsafe { thunk::socket_ext_owner::<api::NewSocket<SSL>>(s) } {
            let ns: *mut api::NewSocket<SSL> = ns;
            swallow(unsafe { api::NewSocket::on_close(ns, wrap::<SSL>(s), code, reason) });
        }
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        if let Some(ns) = unsafe { thunk::socket_ext_owner::<api::NewSocket<SSL>>(s) } {
            let ns: *mut api::NewSocket<SSL> = ns;
            swallow(unsafe { api::NewSocket::on_data(ns, wrap::<SSL>(s), data) });
        }
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = unsafe { thunk::socket_ext_owner::<api::NewSocket<SSL>>(s) } {
            let ns: *mut api::NewSocket<SSL> = ns;
            swallow(unsafe { api::NewSocket::on_writable(ns, wrap::<SSL>(s)) });
        }
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = unsafe { thunk::socket_ext_owner::<api::NewSocket<SSL>>(s) } {
            let ns: *mut api::NewSocket<SSL> = ns;
            swallow(unsafe { api::NewSocket::on_end(ns, wrap::<SSL>(s)) });
        }
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = unsafe { thunk::socket_ext_owner::<api::NewSocket<SSL>>(s) } {
            let ns: *mut api::NewSocket<SSL> = ns;
            swallow(unsafe { api::NewSocket::on_timeout(ns, wrap::<SSL>(s)) });
        }
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = unsafe { thunk::socket_ext_owner::<api::NewSocket<SSL>>(s) } {
            let ns: *mut api::NewSocket<SSL> = ns;
            swallow(unsafe { api::NewSocket::on_handshake(ns, wrap::<SSL>(s), ok as i32, err) });
        }
    }
}

/// Like `PtrHandler` but the callbacks live on a separate namespace `H` (the
/// driver's pre-existing `SocketHandler(ssl)` adapter) rather than as methods
/// on the owner type itself. Ext stores `*Owner` (optional for the same reason
/// as `PtrHandler`).
///
/// In Rust the "separate namespace" becomes a trait `NsSocketEvents` whose
/// methods take `&mut Owner` as the first parameter; each driver's
/// `SocketHandler<SSL>` zero-sized type implements it.
pub trait NsSocketEvents<Owner, const SSL: bool> {
    fn on_open(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_data(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _data: &[u8],
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_writable(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_close(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_timeout(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_long_timeout(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_end(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_connect_error(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _code: i32,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    /// Zig guarded this with `@TypeOf(H.onHandshake) != @TypeOf(null)` — i.e.
    /// some adapters explicitly set `onHandshake = null`. Default no-op covers
    /// that case.
    fn on_handshake(
        _this: &mut Owner,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
}

pub struct NsHandler<Owner, H, const SSL: bool>(core::marker::PhantomData<(Owner, H)>);

impl<Owner, H, const SSL: bool> VHandler for NsHandler<Owner, H, SSL>
where
    Owner: 'static,
    H: NsSocketEvents<Owner, SSL> + 'static,
{
    type Ext = ExtSlot<Owner>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_open(this, wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_data(this, wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_writable(this, wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_close(this, wrap::<SSL>(s), code, reason));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_timeout(this, wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_long_timeout(this, wrap::<SSL>(s)));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_end(this, wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close before notify — see PtrHandler::on_connect_error.
        let this = ext.get();
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        // SAFETY: snapshot of the ext slot taken before close; unique heap
        // owner, single-threaded dispatch (same contract as `ExtSlot::owner_mut`).
        if let Some(t) = unsafe { thunk::ext_owner(&this) } {
            swallow(H::on_connect_error(t, wrap::<SSL>(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        // SAFETY: `c` is a live connecting socket; ext slot holds the unique heap owner.
        let Some(this) = (unsafe { thunk::connecting_ext_owner::<Owner>(c) }) else {
            return;
        };
        swallow(H::on_connect_error(
            this,
            NewSocketHandler::<SSL>::from_connecting(c),
            code,
        ));
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = ext.owner_mut() else { return };
        swallow(H::on_handshake(this, wrap::<SSL>(s), ok as i32, err));
    }
}

// ── HTTP client thread (fetch) ──────────────────────────────────────────────
//
// Unlike every other consumer the fetch ext slot does NOT hold a `*Owner`. It
// holds an `ActiveSocket` — a `bun.TaggedPointerUnion` *value* packed into one
// word (`.ptr()` → `*anyopaque` with the tag in the high bits). Dereferencing
// it as a real pointer is UB; `Handler.on*` decode it via `ActiveSocket.from`.
// This adapter just lifts the word out of the slot, so the `*anyopaque` here
// is intentional and irreducible — it IS the tagged-pointer encoding, not a
// type we forgot to name.
pub struct HTTPClient<const SSL: bool>;

// Zig's `fwd` helper used `@field` + `@call` to dispatch by name; Rust has no
// field-by-string reflection, so each event is written out. The
// `@TypeOf(@field(H, name)) != @TypeOf(null)` guard becomes simply not setting
// `HAS_ON_*` for events the upstream `Handler<SSL>` doesn't define.
type HttpH<const SSL: bool> = bun_http::http_context::Handler<SSL>;

impl<const SSL: bool> VHandler for HTTPClient<SSL> {
    type Ext = Option<NonNull<c_void>>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_LONG_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open(ext: &mut Self::Ext, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // The word read out is a packed `ActiveSocket` tagged-pointer value,
        // not dereferenced here.
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_open(owner.as_ptr(), wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_data(owner.as_ptr(), wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_writable(owner.as_ptr(), wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_close(
            owner.as_ptr(),
            wrap::<SSL>(s),
            code,
            reason,
        ));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_timeout(owner.as_ptr(), wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_long_timeout(
            owner.as_ptr(),
            wrap::<SSL>(s),
        ));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_end(owner.as_ptr(), wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close before notify — see PtrHandler::on_connect_error. SEMI_SOCKET
        // close skips dispatch, so the tagged owner survives the close.
        let owner = *ext;
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        let Some(owner) = owner else { return };
        swallow(HttpH::<SSL>::on_connect_error(
            owner.as_ptr(),
            wrap::<SSL>(s),
            code,
        ));
    }
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) {
        // SAFETY: `cs` is a live connecting socket passed by the trampoline.
        let Some(owner) = (unsafe { thunk::connecting_ext_ptr::<c_void>(cs) }) else {
            return;
        };
        swallow(HttpH::<SSL>::on_connect_error(
            owner.as_ptr(),
            NewSocketHandler::<SSL>::from_connecting(cs),
            code,
        ));
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(owner) = *ext else { return };
        swallow(HttpH::<SSL>::on_handshake(
            owner.as_ptr(),
            wrap::<SSL>(s),
            ok as i32,
            err,
        ));
    }
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub type WSUpgrade<const SSL: bool> =
    RawPtrHandler<websocket_upgrade_client::NewHttpUpgradeClient<SSL>, SSL>;
pub type WSClient<const SSL: bool> = RawPtrHandler<websocket_client::WebSocket<SSL>, SSL>;

// ── SQL drivers ─────────────────────────────────────────────────────────────
pub type Postgres<const SSL: bool> = NsHandler<
    postgres::PostgresSQLConnection,
    postgres::postgres_sql_connection::SocketHandler<SSL>,
    SSL,
>;
pub type MySQL<const SSL: bool> = NsHandler<
    mysql::js_my_sql_connection::JSMySQLConnection,
    mysql::js_my_sql_connection::SocketHandler<SSL>,
    SSL,
>;
pub type Valkey<const SSL: bool> =
    NsHandler<js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>, SSL>;

// ── Bun.spawn IPC / process.send() ──────────────────────────────────────────
// Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side
// `Bun.spawn({ipc})`. Handlers live in `ipc.zig` as free functions, not
// methods on SendQueue, so we adapt manually instead of via PtrHandler.
pub struct SpawnIPC;

use IPC::IPCHandlers::PosixSocket as IpcH;
type IpcS = NewSocketHandler<false>;

impl VHandler for SpawnIPC {
    type Ext = ExtSlot<IPC::SendQueue>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_FD: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;

    fn on_open(_ext: &mut Self::Ext, _s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {}
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_data(this, IpcS::from(s), data);
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_fd(this, IpcS::from(s), fd);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_writable(this, IpcS::from(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_close(this, IpcS::from(s), code, reason);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_timeout(this, IpcS::from(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_mut() else { return };
        IpcH::on_end(this, IpcS::from(s));
    }
}

// ported from: src/runtime/socket/uws_handlers.zig
