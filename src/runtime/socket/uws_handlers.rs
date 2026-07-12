//! Per-`SocketKind` handler adapters. Each one names the ext payload type and
//! forwards events into the existing `on_open`/`on_data`/… methods on that type,
//! re-wrapping the raw `*us_socket_t` in the `NewSocketHandler` handle those
//! methods already expect.
//!
//! This is the *only* call-site coupling between the dispatcher and the rest
//! of Bun — everything below here is unchanged consumer code. Handlers
//! implement `bun_usockets::Handler`; ext arrives as a per-use `ExtMut` token
//! (never a call-spanning `&mut`, contract C17), and consumer callbacks are
//! always invoked OUTSIDE `ExtMut::with` because they may synchronously
//! re-enter dispatch on the same socket (close/write/reconnect from JS).

use bun_ptr::ThisPtr;
use core::ffi::{c_int, c_void};
use core::ptr::NonNull;

use bun_usockets::dispatch::{ExtMut, Handler as VHandler};
use bun_usockets::{
    CloseCode, ConnectingRef, ConnectingSocket, ExtSlot, NewSocketHandler, us_bun_verify_error_t,
    us_socket_t,
};

use super::uws_dispatch::{conn, wrap};
use crate::api;
use crate::valkey_jsc::js_valkey;
use bun_http_jsc::websocket_client;
use bun_http_jsc::websocket_client::websocket_upgrade_client;
use bun_jsc::ipc as IPC;
use bun_sql_jsc::mysql;
use bun_sql_jsc::postgres;

/// Some consumer methods are fallible (they can throw into JS), some are
/// plain `void`. JS errors are already on the pending-exception slot — there's
/// nowhere for the event loop to propagate them — so we just don't lose the
/// unwind. A tiny trait specialised on `()` and `Result<(), E>` handles both.
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

/// Snapshot the owner word out of an `ExtSlot` ext token and deref it SHARED.
///
/// # Safety
/// The stamped owner is a live heap allocation and dispatch is
/// single-threaded. The `&T` spans the consumer callback; sound because
/// re-entrant dispatch (close/write from inside the callback) only re-derives
/// further `&T`s through this same path — never a `&mut` — and each driver
/// holds a ref keeping the owner alive across its own close path.
#[inline(always)]
unsafe fn slot_owner_ref<'a, T>(ext: &mut ExtMut<'_, ExtSlot<T>>) -> Option<&'a T> {
    let snap: Option<NonNull<T>> = ext.with(|slot| slot.get());
    // SAFETY: per fn contract.
    unsafe { snap_owner_ref(snap) }
}

/// [`slot_owner_ref`] for an already-copied owner word (the close-then-notify
/// path snapshots BEFORE the close so the slot storage may be gone).
#[inline(always)]
unsafe fn snap_owner_ref<'a, T>(snap: Option<NonNull<T>>) -> Option<&'a T> {
    // SAFETY: caller upholds the `slot_owner_ref` contract for the snapshot.
    snap.map(|p| unsafe { p.as_ref() })
}

/// [`slot_owner_ref`], exclusive — SpawnIPC ONLY (the IPC handlers take
/// `&mut SendQueue`).
///
/// # Safety
/// The `&mut` spans the consumer callback, so nothing during the callback may
/// derive an aliasing borrow of the owner: the only synchronous dispatch
/// re-entry from `SendQueue` is `close_socket`, which clears this ext word
/// BEFORE the dispatching close so the nested `on_close` no-ops (C17).
#[inline(always)]
unsafe fn slot_owner_mut<'a, T>(ext: &mut ExtMut<'_, ExtSlot<T>>) -> Option<&'a mut T> {
    let snap: Option<NonNull<T>> = ext.with(|slot| slot.get());
    // SAFETY: per fn contract.
    snap.map(|mut p| unsafe { p.as_mut() })
}

#[inline(always)]
fn from_connecting<const SSL: bool>(c: *mut ConnectingSocket) -> NewSocketHandler<SSL> {
    NewSocketHandler::<SSL>::from_connecting(ConnectingRef::from_live(
        NonNull::new(c).expect("dispatch connecting socket is non-null"),
    ))
}

// ── RawSocketEvents / RawPtrHandler ─────────────────────────────────────────
//
// These handlers may free or re-enter `Self` mid-call (a JS callback closing
// the socket, the refcount reaching zero), so they cannot take `&mut self` —
// a `&mut` argument protector outliving the allocation is UB. They take
// [`ThisPtr<Self>`](bun_ptr::ThisPtr) instead: `Copy + Deref`, so each field
// access is its own short-lived shared borrow and none spans a callback.
//
// The ext slot stores that `ThisPtr` directly, so recovering it is a plain
// `Copy` read out of the per-use `ExtMut` token.
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
        _err: us_bun_verify_error_t,
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

    fn on_open(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_open(this, wrap::<SSL>(s));
    }
    fn on_data(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, data: &[u8]) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_data(this, wrap::<SSL>(s), data);
    }
    fn on_writable(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_writable(this, wrap::<SSL>(s));
    }
    fn on_close(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        code: i32,
        reason: Option<*mut c_void>,
    ) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_close(
            this,
            wrap::<SSL>(s),
            code,
            reason.unwrap_or(core::ptr::null_mut()),
        );
    }
    fn on_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_timeout(this, wrap::<SSL>(s));
    }
    fn on_long_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_long_timeout(this, wrap::<SSL>(s));
    }
    fn on_end(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(this) = ext.with(|e| *e) else { return };
        T::on_end(this, wrap::<SSL>(s));
    }
    fn on_connect_error(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, code: i32) {
        // Close FIRST, then notify — same order `main`'s `configure()`
        // trampoline used. The handler may re-enter `connectInner`
        // synchronously (node:net `autoSelectFamily` falls back to the
        // next address from inside the JS `connectError` callback); on
        // Windows/libuv, starting the next attempt's poll while this
        // half-open one is still active and then closing it *afterwards*
        // leaves the second poll never delivering writable/error → hang.
        //
        // Safe for TLS too: SEMI_SOCKET close dispatches nothing (contract
        // C1), so no `on_handshake`/`on_close` lands in JS before we read
        // the snapshotted `this`.
        let this = ext.with(|e| *e);
        wrap::<SSL>(s).close(CloseCode::Failure);
        if let Some(t) = this {
            T::on_connect_error(t, wrap::<SSL>(s), code);
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let Some(this) = *conn(c).ext::<Option<ThisPtr<T>>>() else {
            return;
        };
        T::on_connect_error(this, from_connecting::<SSL>(c), code);
    }
    fn on_handshake(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(this) = ext.with(|e| *e) else { return };
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
        err: us_bun_verify_error_t,
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
        err: us_bun_verify_error_t,
    ) {
        let _guard = this.ref_guard();
        this.handle_handshake(s, ok, err)
    }
}

// ── Bun.connect / Bun.listen ────────────────────────────────────────────────
// Noalias re-entrancy: routed through `RawPtrHandler`. `NewSocket::on_*`
// re-enter JS (`socket.write/end/reload`) which re-derives `&mut NewSocket`
// via the wrapper's `m_ptr`; a `&mut NewSocket` argument protected through
// the dispatch frame would alias that re-entrant borrow (Stacked-Borrows UB +
// `noalias` dead-store of the re-entrant write). `RawPtrHandler` passes
// `ThisPtr<Self>`.
pub type BunSocket<const SSL: bool> = RawPtrHandler<api::NewSocket<SSL>, SSL>;

/// Listener accept path: the ext is uninitialised at on_open time (the accept
/// loop just zeroed it), so we read the `*Listener` off `group->ext` and let
/// `on_create` allocate the `NewSocket` and stash it in the ext. After that
/// the socket is re-stamped as `.bun_socket_{tcp,tls}` and routes through
/// `BunSocket` above.
pub struct BunListener<const SSL: bool>;

/// Freshly-stashed accepted-socket owner, for the defensive `*_no_ext` slots
/// (events that fire before `on_create` restamps the kind).
#[inline(always)]
fn accepted_socket<const SSL: bool>(s: *mut us_socket_t) -> Option<ThisPtr<api::NewSocket<SSL>>> {
    *super::uws_dispatch::hdr(s).ext::<Option<ThisPtr<api::NewSocket<SSL>>>>()
}

impl<const SSL: bool> VHandler for BunListener<SSL>
where
    api::NewSocket<SSL>: RawSocketEvents<SSL>,
{
    // No ext — owner comes from `s.group().owner::<Listener>()`.
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
        // `group()` is non-null for accepted sockets and `owner` was stashed
        // at listen time.
        let listener = super::uws_dispatch::hdr(s).group().owner::<api::Listener>();
        // on_create allocates the NewSocket, stashes it in ext, and restamps
        // kind → .bun_socket_*. Fire the user `open` handler (markActive,
        // ALPN, JS callback) before returning so the same dispatch tick that
        // accepted the fd sees an open socket.
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
        if let Some(ns) = accepted_socket::<SSL>(s) {
            // `ns` is the live heap `NewSocket` stashed by `on_create`. The
            // `on_*` handlers may free it, so they take `ThisPtr`, never `&mut`.
            swallow(api::NewSocket::on_close(ns, wrap::<SSL>(s), code, reason));
        }
    }
    fn on_data_no_ext(s: *mut us_socket_t, data: &[u8]) {
        if let Some(ns) = accepted_socket::<SSL>(s) {
            api::NewSocket::on_data(ns, wrap::<SSL>(s), data);
        }
    }
    fn on_writable_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = accepted_socket::<SSL>(s) {
            api::NewSocket::on_writable(ns, wrap::<SSL>(s));
        }
    }
    fn on_end_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = accepted_socket::<SSL>(s) {
            api::NewSocket::on_end(ns, wrap::<SSL>(s));
        }
    }
    fn on_timeout_no_ext(s: *mut us_socket_t) {
        if let Some(ns) = accepted_socket::<SSL>(s) {
            api::NewSocket::on_timeout(ns, wrap::<SSL>(s));
        }
    }
    fn on_handshake_no_ext(s: *mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = accepted_socket::<SSL>(s) {
            swallow(api::NewSocket::on_handshake(
                ns,
                wrap::<SSL>(s),
                ok as i32,
                err,
            ));
        }
    }
}

// ── NsSocketEvents / NsHandler ──────────────────────────────────────────────
//
// Like the old `PtrHandler` but the callbacks live on a separate namespace
// `H` (the driver's pre-existing `SocketHandler(ssl)` adapter) rather than as
// methods on the owner type itself. Ext stores `?*Owner` — optional because a
// connect/accept can fail and dispatch `on_close`/`on_connect_error` BEFORE
// the caller has had a chance to stash `this` in the freshly-zeroed ext slot.
//
// Owners arrive as `&Owner`, never `&mut`: the drivers' inherent handlers all
// take `&self` (interior mutability), and a `&mut` argument protected across
// a callback that re-enters dispatch (fail/disconnect → close from inside
// on_data/on_end) would alias the re-derived owner borrow (C17).
pub trait NsSocketEvents<Owner, const SSL: bool> {
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

    fn on_open(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_open(this, wrap::<SSL>(s)));
    }
    fn on_data(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, data: &[u8]) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_data(this, wrap::<SSL>(s), data));
    }
    fn on_writable(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_writable(this, wrap::<SSL>(s)));
    }
    fn on_close(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        code: i32,
        reason: Option<*mut c_void>,
    ) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_close(this, wrap::<SSL>(s), code, reason));
    }
    fn on_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_timeout(this, wrap::<SSL>(s)));
    }
    fn on_long_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_long_timeout(this, wrap::<SSL>(s)));
    }
    fn on_end(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_end(this, wrap::<SSL>(s)));
    }
    fn on_connect_error(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, code: i32) {
        // Close before notify — see RawPtrHandler::on_connect_error.
        let snap = ext.with(|slot| slot.get());
        wrap::<SSL>(s).close(CloseCode::Failure);
        // SAFETY: snapshot taken before close (the slot storage may be gone,
        // so deref the snapshot rather than re-borrowing `ext`); shared-owner
        // contract per `slot_owner_ref`.
        if let Some(t) = unsafe { snap_owner_ref(snap) } {
            swallow(H::on_connect_error(t, wrap::<SSL>(s), code));
        }
    }
    fn on_connecting_error(c: *mut ConnectingSocket, code: i32) {
        let snap = conn(c).ext::<ExtSlot<Owner>>().get();
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { snap_owner_ref(snap) }) else {
            return;
        };
        swallow(H::on_connect_error(this, from_connecting::<SSL>(c), code));
    }
    fn on_handshake(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        // SAFETY: shared-owner contract (see `slot_owner_ref`).
        let Some(this) = (unsafe { slot_owner_ref(&mut ext) }) else {
            return;
        };
        swallow(H::on_handshake(this, wrap::<SSL>(s), ok as i32, err));
    }
}

/// Forwards `NsSocketEvents` to the inherent `on_*` methods on a driver's
/// `SocketHandler<SSL>` namespace type. `swallow()` absorbs both infallible
/// and fallible returns, so one expansion covers drivers whose inherent fns
/// are infallible (postgres, mysql) and those returning terminated results
/// (valkey).
///
/// `on_long_timeout` is intentionally NOT forwarded — no driver defines it,
/// so the trait default fires.
///
/// `on_handshake` reads the inherent `ON_HANDSHAKE: Option<fn(..)>` const —
/// `None` means "leave the slot unbound" so the no-op default fires for
/// plain TCP.
macro_rules! impl_ns_socket_events_forward {
    ($Owner:ty, $Handler:ty) => {
        impl<const SSL: bool> NsSocketEvents<$Owner, SSL> for $Handler {
            fn on_open(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_open(this, s));
                Ok(())
            }
            fn on_data(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                data: &[u8],
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_data(this, s, data));
                Ok(())
            }
            fn on_writable(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_writable(this, s));
                Ok(())
            }
            fn on_close(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
                reason: Option<*mut c_void>,
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_close(this, s, code, reason));
                Ok(())
            }
            fn on_timeout(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_timeout(this, s));
                Ok(())
            }
            fn on_end(this: &$Owner, s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> {
                swallow(Self::on_end(this, s));
                Ok(())
            }
            fn on_connect_error(
                this: &$Owner,
                s: NewSocketHandler<SSL>,
                code: i32,
            ) -> bun_jsc::JsResult<()> {
                swallow(Self::on_connect_error(this, s, code));
                Ok(())
            }
            fn on_handshake(
                this: &$Owner,
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

// ── HTTP client thread (fetch) ──────────────────────────────────────────────
//
// Unlike every other consumer the fetch ext slot does NOT hold a `*Owner`. It
// holds an `ActiveSocket` — a tagged-pointer *value* packed into one word
// (`.ptr()` → `*anyopaque` with the tag in the high bits). Dereferencing it
// as a real pointer is UB; `Handler.on*` decode it via `ActiveSocket.from`.
// This adapter just lifts the word out of the slot, so the `*anyopaque` here
// is intentional and irreducible — it IS the tagged-pointer encoding, not a
// type we forgot to name.
pub struct HTTPClient<const SSL: bool>;

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

    fn on_open(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // The word read out is a packed `ActiveSocket` tagged-pointer value,
        // not dereferenced here.
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_open(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_data(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, data: &[u8]) {
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_data(owner.as_ptr(), wrap::<SSL>(s), data);
    }
    fn on_writable(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_writable(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_close(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        code: i32,
        reason: Option<*mut c_void>,
    ) {
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_close(owner.as_ptr(), wrap::<SSL>(s), code, reason);
    }
    fn on_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_timeout(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_long_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_long_timeout(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_end(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        let Some(owner) = ext.with(|e| *e) else { return };
        HttpH::<SSL>::on_end(owner.as_ptr(), wrap::<SSL>(s));
    }
    fn on_connect_error(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, code: i32) {
        // Close before notify — see RawPtrHandler::on_connect_error.
        // SEMI_SOCKET close skips dispatch (C1), so the tagged owner survives
        // the close.
        let owner = ext.with(|e| *e);
        wrap::<SSL>(s).close(CloseCode::Failure);
        let Some(owner) = owner else { return };
        HttpH::<SSL>::on_connect_error(owner.as_ptr(), wrap::<SSL>(s), code);
    }
    fn on_connecting_error(cs: *mut ConnectingSocket, code: i32) {
        let Some(owner) = *conn(cs).ext::<Option<NonNull<c_void>>>() else {
            return;
        };
        HttpH::<SSL>::on_connect_error(owner.as_ptr(), from_connecting::<SSL>(cs), code);
    }
    fn on_handshake(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        ok: bool,
        err: us_bun_verify_error_t,
    ) {
        let Some(owner) = ext.with(|e| *e) else { return };
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
// `Bun.spawn({ipc})`. The IPC handlers are free functions, not methods on
// SendQueue, so we adapt manually. They take `&mut SendQueue`; sound only
// because `SendQueue::close_socket` clears this ext word before its
// dispatching close (see `slot_owner_mut`).
pub struct SpawnIPC;

use IPC::IPCHandlers::PosixSocket as IpcH;

impl VHandler for SpawnIPC {
    type Ext = ExtSlot<IPC::SendQueue>;

    const HAS_ON_OPEN: bool = true;
    const HAS_ON_DATA: bool = true;
    const HAS_ON_FD: bool = true;
    const HAS_ON_WRITABLE: bool = true;
    const HAS_ON_CLOSE: bool = true;
    const HAS_ON_TIMEOUT: bool = true;
    const HAS_ON_END: bool = true;

    fn on_open(_ext: ExtMut<'_, Self::Ext>, _s: *mut us_socket_t, _is_client: bool, _ip: &[u8]) {}
    fn on_data(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, data: &[u8]) {
        // SAFETY: exclusive-owner contract (see `slot_owner_mut`).
        let Some(this) = (unsafe { slot_owner_mut(&mut ext) }) else {
            return;
        };
        IpcH::on_data(this, wrap::<false>(s), data);
    }
    fn on_fd(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t, fd: c_int) {
        // SAFETY: exclusive-owner contract (see `slot_owner_mut`).
        let Some(this) = (unsafe { slot_owner_mut(&mut ext) }) else {
            return;
        };
        IpcH::on_fd(this, wrap::<false>(s), fd);
    }
    fn on_writable(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: exclusive-owner contract (see `slot_owner_mut`).
        let Some(this) = (unsafe { slot_owner_mut(&mut ext) }) else {
            return;
        };
        IpcH::on_writable(this, wrap::<false>(s));
    }
    fn on_close(
        mut ext: ExtMut<'_, Self::Ext>,
        s: *mut us_socket_t,
        code: i32,
        reason: Option<*mut c_void>,
    ) {
        // SAFETY: exclusive-owner contract (see `slot_owner_mut`).
        let Some(this) = (unsafe { slot_owner_mut(&mut ext) }) else {
            return;
        };
        IpcH::on_close(this, wrap::<false>(s), code, reason);
    }
    fn on_timeout(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: exclusive-owner contract (see `slot_owner_mut`).
        let Some(this) = (unsafe { slot_owner_mut(&mut ext) }) else {
            return;
        };
        IpcH::on_timeout(this, wrap::<false>(s));
    }
    fn on_end(mut ext: ExtMut<'_, Self::Ext>, s: *mut us_socket_t) {
        // SAFETY: exclusive-owner contract (see `slot_owner_mut`).
        let Some(this) = (unsafe { slot_owner_mut(&mut ext) }) else {
            return;
        };
        IpcH::on_end(this, wrap::<false>(s));
    }
}
