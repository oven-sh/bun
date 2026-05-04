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

use bun_uws::{us_bun_verify_error_t, ConnectingSocket, NewSocketHandler};
use bun_uws_sys::us_socket_t;

use bun_http_jsc::websocket_client;
use bun_http_jsc::websocket_client::web_socket_upgrade_client as websocket_upgrade_client;
use bun_jsc::ipc as IPC;
use bun_sql_jsc::mysql;
use crate::api;
use crate::valkey_jsc::js_valkey;

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
    fn on_open(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_data(&mut self, _s: NewSocketHandler<SSL>, _data: &[u8]) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_writable(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_close(&mut self, _s: NewSocketHandler<SSL>, _code: i32, _reason: Option<NonNull<c_void>>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_timeout(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_long_timeout(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_end(&mut self, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_connect_error(&mut self, _s: NewSocketHandler<SSL>, _code: i32) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_handshake(&mut self, _s: NewSocketHandler<SSL>, _ok: i32, _err: us_bun_verify_error_t) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_fd(&mut self, _s: NewSocketHandler<SSL>, _fd: c_int) -> bun_jsc::JsResult<()> { Ok(()) }
}

/// `Ext = *?*T`: the socket ext stores a single pointer to the heap-allocated
/// owner (matching the old `socket.ext(**anyopaque).* = this` pattern). It is
/// optional because a connect/accept can fail and dispatch `on_close` /
/// `on_connect_error` BEFORE the caller has had a chance to stash `this` in the
/// freshly-calloc'd ext slot — pretending it's `**T` there is a NULL deref the
/// type system can't see.
pub struct PtrHandler<T, const SSL: bool>(core::marker::PhantomData<T>);

impl<T, const SSL: bool> PtrHandler<T, SSL>
where
    T: SocketEvents<SSL>,
{
    /// `*?*T` — raw because the slot lives in C-allocated (`calloc`) memory.
    pub type Ext = *mut Option<NonNull<T>>;

    #[inline]
    fn wrap(s: &mut us_socket_t) -> NewSocketHandler<SSL> {
        NewSocketHandler::<SSL>::from(s)
    }

    pub fn on_open(ext: Self::Ext, s: &mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // SAFETY (applies to every `*ext` read in this impl): dispatcher
        // guarantees `ext` points at this socket's calloc'd ext slot for the
        // socket's lifetime.
        let Some(this) = (unsafe { *ext }) else { return };
        // SAFETY (applies to every `.as_mut()` in this impl): the ext slot
        // holds the unique heap owner; dispatch is single-threaded so no
        // aliasing `&mut` exists.
        swallow(unsafe { this.as_mut() }.on_open(Self::wrap(s)));
    }
    pub fn on_data(ext: Self::Ext, s: &mut us_socket_t, data: &[u8]) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_data(Self::wrap(s), data));
    }
    pub fn on_writable(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_writable(Self::wrap(s)));
    }
    pub fn on_close(ext: Self::Ext, s: &mut us_socket_t, code: i32, reason: Option<NonNull<c_void>>) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_close(Self::wrap(s), code, reason));
    }
    pub fn on_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_timeout(Self::wrap(s)));
    }
    pub fn on_long_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_long_timeout(Self::wrap(s)));
    }
    pub fn on_end(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_end(Self::wrap(s)));
    }
    pub fn on_connect_error(ext: Self::Ext, s: &mut us_socket_t, code: i32) {
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
        // SAFETY: see `on_open` — `ext` is this socket's live ext slot.
        let this = unsafe { *ext };
        s.close(bun_uws::CloseCode::Failure);
        if let Some(t) = this {
            // SAFETY: see `on_open` — unique heap owner, single-threaded dispatch.
            swallow(unsafe { t.as_mut() }.on_connect_error(Self::wrap(s), code));
        }
    }
    pub fn on_connecting_error(c: &mut ConnectingSocket, code: i32) {
        let Some(this) = *c.ext::<Option<NonNull<T>>>() else { return };
        // SAFETY: see `on_open` — unique heap owner, single-threaded dispatch.
        swallow(
            unsafe { this.as_mut() }
                .on_connect_error(NewSocketHandler::<SSL>::from_connecting(c), code),
        );
    }
    pub fn on_handshake(ext: Self::Ext, s: &mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_handshake(Self::wrap(s), ok as i32, err));
    }
    pub fn on_fd(ext: Self::Ext, s: &mut us_socket_t, fd: c_int) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(unsafe { this.as_mut() }.on_fd(Self::wrap(s), fd));
    }
}

// ── Bun.connect / Bun.listen ────────────────────────────────────────────────
pub type BunSocket<const SSL: bool> = PtrHandler<api::NewSocket<SSL>, SSL>;

/// Listener accept path: the ext is uninitialised at on_open time (the C accept
/// loop just calloc'd it), so we read the `*Listener` off `group->ext` and let
/// `on_create` allocate the `NewSocket` and stash it in the ext. After that the
/// socket is re-stamped as `.bun_socket_{tcp,tls}` and routes through
/// `BunSocket` above.
pub struct BunListener<const SSL: bool>;

impl<const SSL: bool> BunListener<SSL> {
    // No `Ext` decl — owner comes from `s.group().owner(Listener)`.

    pub fn on_open(s: &mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        let listener = s.group().owner::<api::Listener>();
        // on_create allocates the NewSocket, stashes it in ext, and
        // restamps kind → .bun_socket_*. Fire the user `open` handler
        // (markActive, ALPN, JS callback) before returning so the same
        // dispatch tick that accepted the fd sees an open socket — the
        // old `configure({onCreate, onOpen})` path did this in one
        // on_open call.
        let ns = api::Listener::on_create::<SSL>(listener, NewSocketHandler::<SSL>::from(s));
        swallow(ns.on_open(NewSocketHandler::<SSL>::from(s)));
    }
    // Accepted sockets reach the remaining events as `.bun_socket_*` once
    // on_create has restamped them; if anything fires before that, route to
    // the freshly stashed NewSocket.
    pub fn on_close(s: &mut us_socket_t, code: i32, reason: Option<NonNull<c_void>>) {
        if let Some(ns) = *s.ext::<Option<NonNull<api::NewSocket<SSL>>>>() {
            // SAFETY (applies to every `.as_mut()` in this impl): the ext slot
            // holds the unique heap `NewSocket` stashed by `on_create`; dispatch
            // is single-threaded so no aliasing `&mut` exists.
            swallow(unsafe { ns.as_mut() }.on_close(NewSocketHandler::<SSL>::from(s), code, reason));
        }
    }
    pub fn on_data(s: &mut us_socket_t, data: &[u8]) {
        if let Some(ns) = *s.ext::<Option<NonNull<api::NewSocket<SSL>>>>() {
            swallow(unsafe { ns.as_mut() }.on_data(NewSocketHandler::<SSL>::from(s), data));
        }
    }
    pub fn on_writable(s: &mut us_socket_t) {
        if let Some(ns) = *s.ext::<Option<NonNull<api::NewSocket<SSL>>>>() {
            swallow(unsafe { ns.as_mut() }.on_writable(NewSocketHandler::<SSL>::from(s)));
        }
    }
    pub fn on_end(s: &mut us_socket_t) {
        if let Some(ns) = *s.ext::<Option<NonNull<api::NewSocket<SSL>>>>() {
            swallow(unsafe { ns.as_mut() }.on_end(NewSocketHandler::<SSL>::from(s)));
        }
    }
    pub fn on_timeout(s: &mut us_socket_t) {
        if let Some(ns) = *s.ext::<Option<NonNull<api::NewSocket<SSL>>>>() {
            swallow(unsafe { ns.as_mut() }.on_timeout(NewSocketHandler::<SSL>::from(s)));
        }
    }
    pub fn on_handshake(s: &mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        if let Some(ns) = *s.ext::<Option<NonNull<api::NewSocket<SSL>>>>() {
            swallow(unsafe { ns.as_mut() }.on_handshake(NewSocketHandler::<SSL>::from(s), ok as i32, err));
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
    fn on_open(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_data(_this: &mut Owner, _s: NewSocketHandler<SSL>, _data: &[u8]) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_writable(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_close(_this: &mut Owner, _s: NewSocketHandler<SSL>, _code: i32, _reason: Option<NonNull<c_void>>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_timeout(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_long_timeout(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_end(_this: &mut Owner, _s: NewSocketHandler<SSL>) -> bun_jsc::JsResult<()> { Ok(()) }
    fn on_connect_error(_this: &mut Owner, _s: NewSocketHandler<SSL>, _code: i32) -> bun_jsc::JsResult<()> { Ok(()) }
    /// Zig guarded this with `@TypeOf(H.onHandshake) != @TypeOf(null)` — i.e.
    /// some adapters explicitly set `onHandshake = null`. Default no-op covers
    /// that case.
    fn on_handshake(_this: &mut Owner, _s: NewSocketHandler<SSL>, _ok: i32, _err: us_bun_verify_error_t) -> bun_jsc::JsResult<()> { Ok(()) }
}

pub struct NsHandler<Owner, H, const SSL: bool>(core::marker::PhantomData<(Owner, H)>);

impl<Owner, H, const SSL: bool> NsHandler<Owner, H, SSL>
where
    H: NsSocketEvents<Owner, SSL>,
{
    pub type Ext = *mut Option<NonNull<Owner>>;

    #[inline]
    fn wrap(s: &mut us_socket_t) -> NewSocketHandler<SSL> {
        NewSocketHandler::<SSL>::from(s)
    }

    pub fn on_open(ext: Self::Ext, s: &mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // SAFETY (applies to every `*ext` read in this impl): dispatcher
        // guarantees `ext` points at this socket's calloc'd ext slot for the
        // socket's lifetime.
        let Some(this) = (unsafe { *ext }) else { return };
        // SAFETY (applies to every `.as_mut()` in this impl): the ext slot
        // holds the unique heap owner; dispatch is single-threaded so no
        // aliasing `&mut` exists.
        swallow(H::on_open(unsafe { this.as_mut() }, Self::wrap(s)));
    }
    pub fn on_data(ext: Self::Ext, s: &mut us_socket_t, data: &[u8]) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_data(unsafe { this.as_mut() }, Self::wrap(s), data));
    }
    pub fn on_writable(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_writable(unsafe { this.as_mut() }, Self::wrap(s)));
    }
    pub fn on_close(ext: Self::Ext, s: &mut us_socket_t, code: i32, reason: Option<NonNull<c_void>>) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_close(unsafe { this.as_mut() }, Self::wrap(s), code, reason));
    }
    pub fn on_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_timeout(unsafe { this.as_mut() }, Self::wrap(s)));
    }
    pub fn on_long_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_long_timeout(unsafe { this.as_mut() }, Self::wrap(s)));
    }
    pub fn on_end(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_end(unsafe { this.as_mut() }, Self::wrap(s)));
    }
    pub fn on_connect_error(ext: Self::Ext, s: &mut us_socket_t, code: i32) {
        // Close before notify — see PtrHandler::on_connect_error.
        // SAFETY: see `on_open` — `ext` is this socket's live ext slot.
        let this = unsafe { *ext };
        s.close(bun_uws::CloseCode::Failure);
        if let Some(t) = this {
            // SAFETY: see `on_open` — unique heap owner, single-threaded dispatch.
            swallow(H::on_connect_error(unsafe { t.as_mut() }, Self::wrap(s), code));
        }
    }
    pub fn on_connecting_error(c: &mut ConnectingSocket, code: i32) {
        let Some(this) = *c.ext::<Option<NonNull<Owner>>>() else { return };
        swallow(H::on_connect_error(
            // SAFETY: see `on_open` — unique heap owner, single-threaded dispatch.
            unsafe { this.as_mut() },
            NewSocketHandler::<SSL>::from_connecting(c),
            code,
        ));
    }
    pub fn on_handshake(ext: Self::Ext, s: &mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        swallow(H::on_handshake(unsafe { this.as_mut() }, Self::wrap(s), ok as i32, err));
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

impl<const SSL: bool> HTTPClient<SSL> {
    pub type Ext = *mut Option<NonNull<c_void>>;

    #[inline]
    fn wrap(s: &mut us_socket_t) -> NewSocketHandler<SSL> {
        NewSocketHandler::<SSL>::from(s)
    }

    // Zig's `fwd` helper used `@field` + `@call` to dispatch by name; Rust has
    // no field-by-string reflection, so each event is written out. The
    // `@TypeOf(@field(H, name)) != @TypeOf(null)` guard becomes the trait's
    // default no-op (see NsSocketEvents::on_handshake note).
    // TODO(port): `bun_http::NewHTTPContext<SSL>::Handler` must impl a trait
    // matching these free-fn signatures (first arg `*mut c_void` = packed
    // ActiveSocket word). Phase B wires that.
    type H = bun_http::NewHTTPContext<SSL>::Handler;

    pub fn on_open(ext: Self::Ext, s: &mut us_socket_t, _is_client: bool, _ip: &[u8]) {
        // SAFETY (applies to every `*ext` read in this impl): dispatcher
        // guarantees `ext` points at this socket's calloc'd ext slot for the
        // socket's lifetime. The word read out is a packed `ActiveSocket`
        // tagged-pointer value, not dereferenced here.
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_open(owner.as_ptr(), Self::wrap(s)));
    }
    pub fn on_data(ext: Self::Ext, s: &mut us_socket_t, data: &[u8]) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_data(owner.as_ptr(), Self::wrap(s), data));
    }
    pub fn on_writable(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_writable(owner.as_ptr(), Self::wrap(s)));
    }
    pub fn on_close(ext: Self::Ext, s: &mut us_socket_t, code: i32, reason: Option<NonNull<c_void>>) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_close(owner.as_ptr(), Self::wrap(s), code, reason));
    }
    pub fn on_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_timeout(owner.as_ptr(), Self::wrap(s)));
    }
    pub fn on_long_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_long_timeout(owner.as_ptr(), Self::wrap(s)));
    }
    pub fn on_end(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_end(owner.as_ptr(), Self::wrap(s)));
    }
    pub fn on_connect_error(ext: Self::Ext, s: &mut us_socket_t, code: i32) {
        // Close before notify — see PtrHandler::on_connect_error. SEMI_SOCKET
        // close skips dispatch, so the tagged owner survives the close.
        // SAFETY: see `on_open` — `ext` is this socket's live ext slot.
        let owner = unsafe { *ext };
        s.close(bun_uws::CloseCode::Failure);
        let Some(owner) = owner else { return };
        swallow(Self::H::on_connect_error(owner.as_ptr(), Self::wrap(s), code));
    }
    pub fn on_connecting_error(cs: &mut ConnectingSocket, code: i32) {
        let Some(owner) = *cs.ext::<Option<NonNull<c_void>>>() else { return };
        swallow(Self::H::on_connect_error(
            owner.as_ptr(),
            NewSocketHandler::<SSL>::from_connecting(cs),
            code,
        ));
    }
    pub fn on_handshake(ext: Self::Ext, s: &mut us_socket_t, ok: bool, err: us_bun_verify_error_t) {
        let Some(owner) = (unsafe { *ext }) else { return };
        swallow(Self::H::on_handshake(owner.as_ptr(), Self::wrap(s), ok as i32, err));
    }
}

// ── WebSocket client ────────────────────────────────────────────────────────
pub type WSUpgrade<const SSL: bool> =
    PtrHandler<websocket_upgrade_client::NewHTTPUpgradeClient<SSL>, SSL>;
pub type WSClient<const SSL: bool> = PtrHandler<websocket_client::NewWebSocketClient<SSL>, SSL>;

// ── SQL drivers ─────────────────────────────────────────────────────────────
// TODO(port): `bun.api.Postgres` resolved via `bun.jsc.API` in Zig; confirm
// crate path once `crate::api::postgres` is ported.
pub type Postgres<const SSL: bool> = NsHandler<
    crate::api::postgres::PostgresSQLConnection,
    crate::api::postgres::PostgresSQLConnection::SocketHandler<SSL>,
    SSL,
>;
pub type MySQL<const SSL: bool> =
    NsHandler<mysql::MySQLConnection, mysql::MySQLConnection::SocketHandler<SSL>, SSL>;
pub type Valkey<const SSL: bool> =
    NsHandler<js_valkey::JSValkeyClient, js_valkey::SocketHandler<SSL>, SSL>;

// ── Bun.spawn IPC / process.send() ──────────────────────────────────────────
// Ext is `*IPC.SendQueue` for both child-side `process.send` and parent-side
// `Bun.spawn({ipc})`. Handlers live in `ipc.zig` as free functions, not
// methods on SendQueue, so we adapt manually instead of via PtrHandler.
pub struct SpawnIPC;

impl SpawnIPC {
    type H = IPC::IPCHandlers::PosixSocket;
    type S = NewSocketHandler<false>;
    pub type Ext = *mut Option<NonNull<IPC::SendQueue>>;

    pub fn on_open(_ext: Self::Ext, _s: &mut us_socket_t, _is_client: bool, _ip: &[u8]) {}
    pub fn on_data(ext: Self::Ext, s: &mut us_socket_t, data: &[u8]) {
        // SAFETY (applies to every `*ext` read in this impl): dispatcher
        // guarantees `ext` points at this socket's calloc'd ext slot for the
        // socket's lifetime.
        let Some(this) = (unsafe { *ext }) else { return };
        // SAFETY (applies to every `.as_mut()` in this impl): the ext slot
        // holds the unique heap `SendQueue`; dispatch is single-threaded so no
        // aliasing `&mut` exists.
        Self::H::on_data(unsafe { this.as_mut() }, Self::S::from(s), data);
    }
    pub fn on_fd(ext: Self::Ext, s: &mut us_socket_t, fd: c_int) {
        let Some(this) = (unsafe { *ext }) else { return };
        Self::H::on_fd(unsafe { this.as_mut() }, Self::S::from(s), fd);
    }
    pub fn on_writable(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        Self::H::on_writable(unsafe { this.as_mut() }, Self::S::from(s));
    }
    pub fn on_close(ext: Self::Ext, s: &mut us_socket_t, code: i32, reason: Option<NonNull<c_void>>) {
        let Some(this) = (unsafe { *ext }) else { return };
        Self::H::on_close(unsafe { this.as_mut() }, Self::S::from(s), code, reason);
    }
    pub fn on_timeout(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        Self::H::on_timeout(unsafe { this.as_mut() }, Self::S::from(s));
    }
    pub fn on_end(ext: Self::Ext, s: &mut us_socket_t) {
        let Some(this) = (unsafe { *ext }) else { return };
        Self::H::on_end(unsafe { this.as_mut() }, Self::S::from(s));
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/uws_handlers.zig (330 lines)
//   confidence: medium
//   todos:      3
//   notes:      @hasDecl/@typeInfo reflection → SocketEvents/NsSocketEvents traits with default no-ops; inherent associated types (`type Ext = ...` in impl) need feature(inherent_associated_types) or hoisting in Phase B; cross-crate paths (api::, bun_http::NewHTTPContext::Handler) are best-guess; handler params take `&mut us_socket_t` per type-map — revert to raw `*mut` only if Phase B dispatcher must register them as `extern "C"` callbacks.
// ──────────────────────────────────────────────────────────────────────────
