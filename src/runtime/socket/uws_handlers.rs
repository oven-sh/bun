//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `on_open`/`on_data`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

use bun_ptr::ThisPtr;
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
/// A tiny trait specialised on `()` and `Result<(), E>` handles both shapes.
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

#[inline(always)]
fn wrap<const SSL: bool>(s: *mut us_socket_t) -> NewSocketHandler<SSL> {
    NewSocketHandler::<SSL>::from(s)
}

// ── RawSocketEvents / RawPtrHandler ─────────────────────────────────────────
//
// These handlers may free or re-enter `Self` mid-call (a JS callback closing
// the socket, the refcount reaching zero), so they cannot take `&mut self` —
// a `&mut` argument protector outliving the allocation is UB. They take
// [`ThisPtr<Self>`](bun_ptr::ThisPtr) instead: `Copy + Deref`, so each field
// access is its own short-lived shared borrow and none spans a callback.
//
// The ext slot stores that `ThisPtr` directly, so recovering it is safe and
// the `unsafe` lives once, in the vtable's ext read.
pub trait RawSocketEvents<const SSL: bool>: Sized {
    const HAS_ON_OPEN: bool = false;

    fn on_open(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_data(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>, _data: &[u8]) {}
    fn on_writable(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_close(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>, _code: i32, _reason: *mut c_void) {
    }
    fn on_timeout(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_long_timeout(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_end(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) {}
    fn on_connect_error(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>, _code: i32) {}
    fn on_handshake(
        _this: ThisPtr<Self>,
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
    type Ext = Option<ThisPtr<T>>;

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
        T::on_open(this, wrap::<SSL>(s));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = *ext else { return };
        T::on_data(this, wrap::<SSL>(s), data);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        T::on_writable(this, wrap::<SSL>(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = *ext else { return };
        T::on_close(
            this,
            wrap::<SSL>(s),
            code,
            reason.unwrap_or(core::ptr::null_mut()),
        );
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        T::on_timeout(this, wrap::<SSL>(s));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        T::on_long_timeout(this, wrap::<SSL>(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        T::on_end(this, wrap::<SSL>(s));
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
        let this = *ext;
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        if let Some(t) = this {
            T::on_connect_error(t, wrap::<SSL>(s), code);
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = *ConnectingSocket::opaque_mut(c).ext::<Option<ThisPtr<T>>>() else {
            return;
        };
        T::on_connect_error(this, NewSocketHandler::<SSL>::from_connecting(c), code);
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = *ext else { return };
        T::on_handshake(this, wrap::<SSL>(s), ok as i32, err);
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_upgrade_client::NewHttpUpgradeClient<SSL> {
    const HAS_ON_OPEN: bool = true;

    fn on_open(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        Self::handle_open(this, s)
    }
    fn on_data(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, data: &[u8]) {
        Self::handle_data(this, s, data)
    }
    fn on_writable(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        Self::handle_writable(this, s)
    }
    fn on_close(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, code: i32, reason: *mut c_void) {
        Self::handle_close(this, s, code, reason)
    }
    fn on_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        Self::handle_timeout(this, s)
    }
    fn on_long_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        Self::handle_timeout(this, s)
    }
    fn on_end(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        Self::handle_end(this, s)
    }
    fn on_connect_error(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, code: i32) {
        Self::handle_connect_error(this, s, code)
    }
    fn on_handshake(
        this: ThisPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        Self::handle_handshake(this, s, ok, err)
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_client::WebSocket<SSL> {
    // No `on_open` override — adoption of an already-connected socket.

    fn on_data(this: ThisPtr<Self>, _s: NewSocketHandler<SSL>, data: &[u8]) {
        Self::handle_data(this, data)
    }
    fn on_writable(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        let _guard = this.ref_guard();
        this.handle_writable(s)
    }
    fn on_close(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, code: i32, reason: *mut c_void) {
        let _guard = this.ref_guard();
        this.handle_close(s, code, reason)
    }
    fn on_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        let _guard = this.ref_guard();
        this.handle_timeout(s)
    }
    fn on_long_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        let _guard = this.ref_guard();
        this.handle_timeout(s)
    }
    fn on_end(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) {
        let _guard = this.ref_guard();
        this.handle_end(s)
    }
    fn on_connect_error(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, code: i32) {
        let _guard = this.ref_guard();
        this.handle_connect_error(s, code)
    }
    fn on_handshake(
        this: ThisPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) {
        let _guard = this.ref_guard();
        this.handle_handshake(s, ok, err)
    }
}

// ── NsSocketEvents impls ────────────────────────────────────────────────────
//
// A trait with default
// no-ops; each consumer type opts in with an `impl` that overrides only the
// events it actually handles. `api::NewSocket`'s real impl lives in
// `socket/mod.rs` (bridges to inherent methods).

/// Forwards `NsSocketEvents` to the inherent `on_*` methods on a driver's
/// `SocketHandler<SSL>` namespace type. `swallow()` (specialised on `()` and
/// `Result<(), E>` above) absorbs both infallible and fallible
/// returns, so one expansion covers drivers whose inherent fns are
/// infallible (postgres, mysql) and those returning `JsTerminatedResult<()>`
/// (valkey). The dispatcher (`NsHandler: VHandler`) `swallow`s the trait
/// result anyway, so swallowing one frame earlier is behaviour-preserving.
///
/// `on_long_timeout` is intentionally NOT forwarded — no driver defines it,
/// so the trait default fires.
///
/// `on_handshake` reads the inherent `ON_HANDSHAKE: Option<fn(..)>` const —
/// `None` means "leave the slot unbound" so the dispatcher's
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
// Noalias re-entrancy: routed through `RawPtrHandler`. `NewSocket::on_*`
// re-enter JS (`socket.write/end/reload`) which re-derives `&mut NewSocket`
// via the wrapper's `m_ptr`; a `&mut NewSocket` argument protected through
// the dispatch frame would alias that re-entrant borrow (Stacked-Borrows UB +
// `noalias` dead-store of the re-entrant write). `RawPtrHandler` passes
// `ThisPtr<Self>`.
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
        api::NewSocket::on_open(ns, wrap::<SSL>(s));
    }
    // Accepted sockets reach the remaining events as `.bun_socket_*` once
    // on_create has restamped them; if anything fires before that, route to
    // the freshly stashed NewSocket.
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
        {
            // `ns` is the live heap `NewSocket` stashed by `on_create`. The
            // `on_*` handlers may free it, so they take `ThisPtr`, never `&mut`.
            swallow(api::NewSocket::on_close(ns, wrap::<SSL>(s), code, reason));
        }
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
        {
            api::NewSocket::on_data(ns, wrap::<SSL>(s), data);
        }
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
        {
            api::NewSocket::on_writable(ns, wrap::<SSL>(s));
        }
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
        {
            api::NewSocket::on_end(ns, wrap::<SSL>(s));
        }
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
        {
            api::NewSocket::on_timeout(ns, wrap::<SSL>(s));
        }
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = *us_socket_t::opaque_mut(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
        {
            swallow(api::NewSocket::on_handshake(
                ns,
                wrap::<SSL>(s),
                ok as i32,
                err,
            ));
        }
    }
}

/// The callbacks live on a separate namespace `H` (the driver's pre-existing
/// `SocketHandler(ssl)` adapter) rather than as methods on the owner type
/// itself. Ext stores `*Owner`; it is optional because a connect/accept can
/// fail and dispatch `on_close` / `on_connect_error` BEFORE the caller has
/// had a chance to stash `this` in the freshly-calloc'd ext slot.
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
    /// Default no-op covers adapters that leave the handshake slot unbound.
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
        // Close before notify — see RawPtrHandler::on_connect_error.
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
        let Some(this) = ConnectingSocket::opaque_mut(c)
            .ext::<ExtSlot<Owner>>()
            .owner_mut()
        else {
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

// Each event is written out by hand; `HAS_ON_*` is simply left unset
// for events the upstream `Handler<SSL>` doesn't define.
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
        HttpH::<SSL>::on_open(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_data(owner.as_ptr(), wrap::<SSL>(s), data);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_writable(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_close(owner.as_ptr(), wrap::<SSL>(s), code, reason);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_timeout(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_long_timeout(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_end(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        // Close before notify — see RawPtrHandler::on_connect_error. SEMI_SOCKET
        // close skips dispatch, so the tagged owner survives the close.
        let owner = *ext;
        // `us_socket_t` is an `opaque_ffi!` ZST — `opaque_mut` is the safe
        // deref (`s` is a live socket passed by the trampoline).
        us_socket_t::opaque_mut(s).close(CloseCode::failure);
        let Some(owner) = owner else { return };
        HttpH::<SSL>::on_connect_error(owner.as_ptr(), wrap::<SSL>(s), code);
    }
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) {
        let Some(owner) = *ConnectingSocket::opaque_mut(cs).ext::<Option<NonNull<c_void>>>() else {
            return;
        };
        HttpH::<SSL>::on_connect_error(
            owner.as_ptr(),
            NewSocketHandler::<SSL>::from_connecting(cs),
            code,
        );
    }
    fn on_handshake(
        ext: &mut Self::Ext,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(owner) = *ext else { return };
        HttpH::<SSL>::on_handshake(owner.as_ptr(), wrap::<SSL>(s), ok as i32, err);
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
// `Bun.spawn({ipc})`. The IPC handlers are free functions, not
// methods on SendQueue, so we adapt manually here.
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
