//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `on_open`/`on_data`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` shim those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. It replaces the
//! old `NewSocketHandler.configure`/`unsafeConfigure` machinery, which built
//! the same trampolines at runtime per `us_socket_context_t`.

use bun_jsc::JsResult;
use bun_ptr::{RefPtr, ThisPtr};
use core::ffi::{c_int, c_void};

use bun_uws::{ConnectingSocket, NewSocketHandler};
use bun_uws_sys::thunk::ExtSlot;
use bun_uws_sys::vtable::Handler as VHandler;
use bun_uws_sys::{us_bun_verify_error_t, us_socket_t};

use crate::api;
use crate::ipc as IPC;
use crate::socket::NativeRef;
use crate::valkey_jsc::js_valkey;
use bun_http_jsc::websocket_client;
use bun_http_jsc::websocket_client::websocket_upgrade_client;
use bun_sql_jsc::mysql;
use bun_sql_jsc::postgres;

use crate::dispatch::fold;

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
/// Every handler returns the exception it left pending and never reports it;
/// [`RawPtrHandler`] — the one trampoline from uSockets into these — folds it
/// ([`fold`]).
pub(crate) trait RawSocketEvents<const SSL: bool>: Sized {
    const HAS_ON_OPEN: bool = false;

    fn on_open(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) -> JsResult<()> {
        Ok(())
    }
    fn on_data(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>, _data: &[u8]) -> JsResult<()> {
        Ok(())
    }
    fn on_writable(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) -> JsResult<()> {
        Ok(())
    }
    fn on_close(
        _this: ThisPtr<Self>,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: *mut c_void,
    ) -> JsResult<()> {
        Ok(())
    }
    fn on_timeout(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) -> JsResult<()> {
        Ok(())
    }
    fn on_long_timeout(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) -> JsResult<()> {
        Ok(())
    }
    fn on_end(_this: ThisPtr<Self>, _s: NewSocketHandler<SSL>) -> JsResult<()> {
        Ok(())
    }
    fn on_connect_error(
        _this: ThisPtr<Self>,
        _s: NewSocketHandler<SSL>,
        _code: i32,
    ) -> JsResult<()> {
        Ok(())
    }
    fn on_handshake(
        _this: ThisPtr<Self>,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: bun_uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        Ok(())
    }
}

pub(crate) struct RawPtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

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
        fold(T::on_open(this, wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = *ext else { return };
        fold(T::on_data(this, wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        fold(T::on_writable(this, wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = *ext else { return };
        fold(T::on_close(
            this,
            wrap::<SSL>(s),
            code,
            reason.unwrap_or(core::ptr::null_mut()),
        ));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        fold(T::on_timeout(this, wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        fold(T::on_long_timeout(this, wrap::<SSL>(s)));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = *ext else { return };
        fold(T::on_end(this, wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        let Some(this) = *ext else { return };
        fold(T::on_connect_error(this, wrap::<SSL>(s), code));
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = *ConnectingSocket::opaque_mut(c).ext::<Option<ThisPtr<T>>>() else {
            return;
        };
        fold(T::on_connect_error(
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
        let Some(this) = *ext else { return };
        fold(T::on_handshake(this, wrap::<SSL>(s), ok as i32, err));
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_upgrade_client::NewHttpUpgradeClient<SSL>
where
    Self: bun_http_jsc::websocket_client::websocket_proxy_tunnel::IntoUpgradeClientRef,
{
    const HAS_ON_OPEN: bool = true;

    fn on_open(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        Self::handle_open(this, s);
        Ok(())
    }
    fn on_data(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, data: &[u8]) -> JsResult<()> {
        Self::handle_data(this, s, data);
        Ok(())
    }
    fn on_writable(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        Self::handle_writable(this, s);
        Ok(())
    }
    fn on_close(
        this: ThisPtr<Self>,
        s: NewSocketHandler<SSL>,
        code: i32,
        reason: *mut c_void,
    ) -> JsResult<()> {
        Self::handle_close(this, s, code, reason);
        Ok(())
    }
    fn on_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        Self::handle_timeout(this, s);
        Ok(())
    }
    fn on_long_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        Self::handle_timeout(this, s);
        Ok(())
    }
    fn on_end(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        Self::handle_end(this, s);
        Ok(())
    }
    fn on_connect_error(this: ThisPtr<Self>, s: NewSocketHandler<SSL>, code: i32) -> JsResult<()> {
        Self::handle_connect_error(this, s, code);
        Ok(())
    }
    fn on_handshake(
        this: ThisPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        Self::handle_handshake(this, s, ok, err);
        Ok(())
    }
}

impl<const SSL: bool> RawSocketEvents<SSL> for websocket_client::WebSocket<SSL> {
    // No `on_open` / `on_connect_error` override — adoption of an already-connected socket.
    // No `on_end` override — the socket doesn't allow half-open, so uSockets closes it right after.

    fn on_data(this: ThisPtr<Self>, _s: NewSocketHandler<SSL>, data: &[u8]) -> JsResult<()> {
        Self::handle_data(this, data);
        Ok(())
    }
    fn on_writable(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        let _guard = RefPtr::from_this(this);
        this.handle_writable(s);
        Ok(())
    }
    fn on_close(
        this: ThisPtr<Self>,
        s: NewSocketHandler<SSL>,
        code: i32,
        reason: *mut c_void,
    ) -> JsResult<()> {
        let _guard = RefPtr::from_this(this);
        this.handle_close(s, code, reason);
        Ok(())
    }
    fn on_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        let _guard = RefPtr::from_this(this);
        this.handle_timeout(s);
        Ok(())
    }
    fn on_long_timeout(this: ThisPtr<Self>, s: NewSocketHandler<SSL>) -> JsResult<()> {
        let _guard = RefPtr::from_this(this);
        this.handle_timeout(s);
        Ok(())
    }
    fn on_handshake(
        this: ThisPtr<Self>,
        s: NewSocketHandler<SSL>,
        ok: i32,
        err: bun_uws::us_bun_verify_error_t,
    ) -> JsResult<()> {
        let _guard = RefPtr::from_this(this);
        this.handle_handshake(s, ok, err);
        Ok(())
    }
}

// ── NsSocketEvents impls ────────────────────────────────────────────────────
//
// A trait with default
// no-ops; each consumer type opts in with an `impl` that overrides only the
// events it actually handles.

/// Lifts what a driver's `on_*` returns into the `JsResult<()>` the trampoline
/// folds: `()` for drivers that never enter JS, identity otherwise.
trait LiftJsResult {
    fn lift(self) -> JsResult<()>;
}
impl LiftJsResult for () {
    #[inline(always)]
    fn lift(self) -> JsResult<()> {
        Ok(())
    }
}
impl LiftJsResult for JsResult<()> {
    #[inline(always)]
    fn lift(self) -> JsResult<()> {
        self
    }
}

/// Forwards `NsSocketEvents` to the inherent `on_*` methods on a driver's
/// `SocketHandler<SSL>` namespace type; `lift()` lifts both return shapes (see
/// [`LiftJsResult`]) so one expansion covers postgres, mysql and valkey, and the dispatcher
/// (`NsHandler: VHandler`) folds the result at the entry.
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
            fn on_open(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                Self::on_open(this, s).lift()
            }
            fn on_data(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                data: &[u8],
            ) -> bun_jsc::JsResult<()> {
                Self::on_data(this, s, data).lift()
            }
            fn on_writable(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                Self::on_writable(this, s).lift()
            }
            fn on_close(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
                reason: Option<*mut c_void>,
            ) -> bun_jsc::JsResult<()> {
                Self::on_close(this, s, code, reason).lift()
            }
            fn on_timeout(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                Self::on_timeout(this, s).lift()
            }
            fn on_end(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                Self::on_end(this, s).lift()
            }
            fn on_connect_error(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
            ) -> bun_jsc::JsResult<()> {
                Self::on_connect_error(this, s, code).lift()
            }
            fn on_handshake(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                ok: i32,
                err: us_bun_verify_error_t,
            ) -> bun_jsc::JsResult<()> {
                match Self::ON_HANDSHAKE {
                    Some(f) => f(this, s, ok, err).lift(),
                    None => Ok(()),
                }
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
/// Does not borrow the ext slot across a handler, which can empty it (`connect()` again).
pub(crate) struct BunSocket<const SSL: bool>;

impl<const SSL: bool> VHandler for BunSocket<SSL> {
    type Ext = ();
    const HAS_EXT: bool = false;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;
    const HAS_ON_CONNECT_ERROR: bool = true;
    const HAS_ON_CONNECTING_ERROR: bool = true;
    const HAS_ON_HANDSHAKE: bool = true;

    fn on_open_no_ext(s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        if let Some(ns) = NativeRef::<SSL>::of(s).get() {
            fold(api::NewSocket::on_open(ns, wrap(s)));
        }
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        if let Some(ns) = NativeRef::<SSL>::of(s).get() {
            fold(api::NewSocket::on_data(ns, wrap(s), data));
        }
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).get() {
            fold(api::NewSocket::on_writable(ns, wrap(s)));
        }
    }
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        // SAFETY: a losing candidate is closed without a dispatch.
        if let Some(ns) = unsafe { NativeRef::<SSL>::of(s).take() } {
            fold(api::NewSocket::on_close(ns, wrap(s), code, reason));
        }
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).get() {
            fold(api::NewSocket::on_timeout(ns, wrap(s)));
        }
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).get() {
            fold(api::NewSocket::on_end(ns, wrap(s)));
        }
    }
    fn on_connect_error_no_ext(s: *mut us_socket_t, code: i32) {
        // SAFETY: as in `on_close_no_ext`.
        if let Some(ns) = unsafe { NativeRef::<SSL>::of(s).take() } {
            fold(api::NewSocket::on_connect_error(ns, wrap(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        // SAFETY: no candidate won.
        if let Some(ns) = unsafe { NativeRef::<SSL>::of_connecting(c).take() } {
            let socket = NewSocketHandler::from_connecting(c);
            fold(api::NewSocket::on_connect_error(ns, socket, code));
        }
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = NativeRef::<SSL>::of(s).get() {
            fold(api::NewSocket::on_handshake(ns, wrap(s), ok as i32, err));
        }
    }
}

/// Listener accept path: the ext is uninitialised at on_open time (the C accept
/// loop just calloc'd it), so we read the `*Listener` off `group->ext` and let
/// `on_create` allocate the `NewSocket` and stash it in the ext. After that the
/// socket is re-stamped as `.bun_socket_{tcp,tls}` and routes through
/// `BunSocket` above.
pub(crate) struct BunListener<const SSL: bool>;

impl<const SSL: bool> VHandler for BunListener<SSL> {
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
        let ns = api::Listener::on_create::<SSL>(unsafe { &*listener }, s);
        fold(api::NewSocket::on_open(ns, wrap::<SSL>(s)));
    }
    // Accepted sockets reach the remaining events as `.bun_socket_*` once
    // on_create has restamped them; if anything fires before that, route to
    // the freshly stashed NewSocket.
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        BunSocket::<SSL>::on_close_no_ext(s, code, reason);
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        BunSocket::<SSL>::on_data_no_ext(s, data);
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        BunSocket::<SSL>::on_writable_no_ext(s);
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        BunSocket::<SSL>::on_end_no_ext(s);
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        BunSocket::<SSL>::on_timeout_no_ext(s);
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        BunSocket::<SSL>::on_handshake_no_ext(s, ok, err);
    }
}

/// The callbacks live on a separate namespace `H` (the driver's pre-existing
/// `SocketHandler(ssl)` adapter) rather than as methods on the owner type
/// itself. Ext stores `*Owner`; it is optional because a connect/accept can
/// fail and dispatch `on_close` / `on_connect_error` BEFORE the caller has
/// had a chance to stash `this` in the freshly-calloc'd ext slot.
///
/// In Rust the "separate namespace" becomes a trait `NsSocketEvents` whose
/// methods take `&Owner` as the first parameter; each driver's
/// `SocketHandler<SSL>` zero-sized type implements it.
trait NsSocketEvents<Owner, const SSL: bool> {
    fn on_open(_this: &Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_data(_this: &Owner, _s: NewSocketHandler<SSL>, _data: &[u8]) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_writable(_this: &Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_close(
        _this: &Owner,
        _s: NewSocketHandler<SSL>,
        _code: i32,
        _reason: Option<*mut c_void>,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_timeout(_this: &Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_long_timeout(_this: &Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_end(_this: &Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    fn on_connect_error(
        _this: &Owner,
        _s: NewSocketHandler<SSL>,
        _code: i32,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
    /// Default no-op covers adapters that leave the handshake slot unbound.
    fn on_handshake(
        _this: &Owner,
        _s: NewSocketHandler<SSL>,
        _ok: i32,
        _err: us_bun_verify_error_t,
    ) -> bun_jsc::JsResult<()> {
        Ok(())
    }
}

pub(crate) struct NsHandler<Owner, H, const SSL: bool>(core::marker::PhantomData<(Owner, H)>);

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
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_open(this, wrap::<SSL>(s)));
    }
    fn on_data(ext: &mut Self::Ext, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_data(this, wrap::<SSL>(s), data));
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_writable(this, wrap::<SSL>(s)));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_close(this, wrap::<SSL>(s), code, reason));
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_timeout(this, wrap::<SSL>(s)));
    }
    fn on_long_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_long_timeout(this, wrap::<SSL>(s)));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_end(this, wrap::<SSL>(s)));
    }
    fn on_connect_error(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32) {
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_connect_error(this, wrap::<SSL>(s), code));
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = ConnectingSocket::opaque_mut(c)
            .ext::<ExtSlot<Owner>>()
            .owner_ref()
        else {
            return;
        };
        fold(H::on_connect_error(
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
        let Some(this) = ext.owner_ref() else { return };
        fold(H::on_handshake(this, wrap::<SSL>(s), ok as i32, err));
    }
}

// ── HTTP client thread (fetch) ──────────────────────────────────────────────
/// Does not borrow the ext slot across a handler, which writes to it.
pub(crate) struct HTTPClient<const SSL: bool>;

// Each event is written out by hand; `HAS_ON_*` is simply left unset
// for events the upstream `Handler<SSL>` doesn't define.
type HttpH<const SSL: bool> = bun_http::http_context::Handler<SSL>;

impl<const SSL: bool> VHandler for HTTPClient<SSL> {
    type Ext = ();
    const HAS_EXT: bool = false;

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

    fn on_open_no_ext(s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        HttpH::<SSL>::on_open(wrap::<SSL>(s));
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        HttpH::<SSL>::on_data(wrap::<SSL>(s), data);
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        HttpH::<SSL>::on_writable(wrap::<SSL>(s));
    }
    fn on_close_no_ext(s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        HttpH::<SSL>::on_close(wrap::<SSL>(s), code, reason);
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        HttpH::<SSL>::on_timeout(wrap::<SSL>(s));
    }
    fn on_long_timeout_no_ext(s: *mut us_socket_t) {
        HttpH::<SSL>::on_long_timeout(wrap::<SSL>(s));
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        HttpH::<SSL>::on_end(wrap::<SSL>(s));
    }
    fn on_connect_error_no_ext(s: *mut us_socket_t, code: i32) {
        HttpH::<SSL>::on_connect_error(wrap::<SSL>(s), code);
    }
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) {
        HttpH::<SSL>::on_connect_error(NewSocketHandler::<SSL>::from_connecting(cs), code);
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        HttpH::<SSL>::on_handshake(wrap::<SSL>(s), ok as i32, err);
    }
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub(crate) type WSUpgradeClient<const SSL: bool> =
    websocket_upgrade_client::NewHttpUpgradeClient<SSL>;
pub(crate) type WSUpgrade<const SSL: bool> =
    RawPtrHandler<websocket_upgrade_client::NewHttpUpgradeClient<SSL>, SSL>;
pub(crate) type WSClient<const SSL: bool> = RawPtrHandler<websocket_client::WebSocket<SSL>, SSL>;

// ── SQL drivers ─────────────────────────────────────────────────────────────
pub(crate) type Postgres<const SSL: bool> = NsHandler<
    postgres::PostgresSQLConnection,
    postgres::postgres_sql_connection::SocketHandler<SSL>,
    SSL,
>;
pub(crate) type MySQL<const SSL: bool> = NsHandler<
    mysql::js_my_sql_connection::JSMySQLConnection,
    mysql::js_my_sql_connection::SocketHandler<SSL>,
    SSL,
>;
pub(crate) type Valkey<const SSL: bool> =
    NsHandler<js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>, SSL>;

// ── Bun.spawn IPC / process.send() ──────────────────────────────────────────
// Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side
// `Bun.spawn({ipc})`. The IPC handlers are free functions, not
// methods on SendQueue, so we adapt manually here.
pub(crate) struct SpawnIPC;

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
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_data(this, IpcS::from(s), data);
    }
    fn on_fd(ext: &mut Self::Ext, s: *mut us_socket_t, fd: c_int) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_fd(this, IpcS::from(s), fd);
    }
    fn on_writable(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_writable(this, IpcS::from(s));
    }
    fn on_close(ext: &mut Self::Ext, s: *mut us_socket_t, code: i32, reason: Option<*mut c_void>) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_close(this, IpcS::from(s), code, reason);
    }
    fn on_timeout(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_timeout(this, IpcS::from(s));
    }
    fn on_end(ext: &mut Self::Ext, s: *mut us_socket_t) {
        let Some(this) = ext.owner_ref() else { return };
        IpcH::on_end(this, IpcS::from(s));
    }
}
