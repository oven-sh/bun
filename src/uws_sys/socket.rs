//! High-level socket wrapper over `us_socket_t` / `ConnectingSocket` /
//! [`Transport`].
//!
//! THIS IS THE ONE CANONICAL IMPLEMENTATION. `bun_uws`
//! re-exports everything here; do NOT add a parallel `InternalSocket` /
//! `NewSocketHandler` in `bun_uws` again — the earlier "thin placeholder"
//! that grew full bodies there has been deleted.
//!
//! Shape: `InternalSocket` is a `Copy` tagged raw pointer, passed by value, and all `NewSocketHandler` methods take `&self`.

use core::cell::Cell;
use core::ffi::{c_int, c_uint, c_void};
use core::mem::size_of;
use core::ptr::NonNull;

use bun_core::{Fd, ZStr};

use crate::{
    CloseCode, ConnectResult, ConnectingSocket, LIBUS_SOCKET_DESCRIPTOR, QueuedInput, SocketGroup,
    SocketKind, SslCtx, us_bun_verify_error_t, us_socket_t,
};

bun_core::declare_scope!(uws, visible);

// ──────────────────────────────────────────────────────────────────────────
// CloseCode PascalCase aliases
// ──────────────────────────────────────────────────────────────────────────
// `bun_uws_sys::CloseCode` (us_socket_t.rs) keeps the snake-case variant
// names (`normal`/`failure`/`fast_shutdown`). The deleted `bun_uws::CloseKind`
// duplicate used PascalCase. Expose both spellings via associated consts so
// every existing call site (`CloseCode::Normal`, `CloseKind::Failure`, …)
// resolves against the one canonical `#[repr(i32)]` enum.
#[allow(non_upper_case_globals)]
impl CloseCode {
    pub const Normal: CloseCode = CloseCode::normal;
    pub const Failure: CloseCode = CloseCode::failure;
    pub const FastShutdown: CloseCode = CloseCode::fast_shutdown;
}

// ──────────────────────────────────────────────────────────────────────────
// InternalSocket
// ──────────────────────────────────────────────────────────────────────────

/// State of a single connection. `Copy` — passed by value
/// through the entire HTTP-client / Bun.Socket state machines, so the handle
/// is a trivially-copyable tagged pointer, re-borrowed per call via the deref helpers below.
#[derive(Copy, Clone)]
pub enum InternalSocket {
    Connected(*mut us_socket_t),
    /// A node:http server connection while uWS still owes HTTP on it. Its group, kind and ext are uWS's.
    UwsHttp(*mut us_socket_t),
    Connecting(*mut ConnectingSocket),
    Detached,
    Transport(*const TransportHandle),
}

const _: () = assert!(size_of::<InternalSocket>() == 2 * size_of::<usize>());

/// A field of every [`Transport`]: the wide pointer to the transport it sits in. A socket handle points here, which keeps it at two words.
#[derive(Default)]
pub struct TransportHandle(Cell<Option<NonNull<dyn Transport>>>);

impl TransportHandle {
    /// `transport` is the heap allocation that holds `self`.
    pub fn set(&self, transport: *mut dyn Transport) {
        self.0.set(NonNull::new(transport));
    }
}

/// What a socket handle drives when it isn't a `us_socket_t`: TLS over a JS stream, a Windows named pipe, a pipe descriptor. `bun_runtime::socket` has the implementors.
pub trait Transport {
    fn is_closed(&self) -> bool;
    fn is_shutdown(&self) -> bool;
    /// Returns the bytes taken and the errno of a write that failed for good. Fewer bytes with no errno owe the owner one `on_writable`.
    fn write(&self, data: &[u8]) -> (i32, i32);
    /// Writes below the TLS layer, if there is one.
    fn raw_write(&self, data: &[u8]) -> i32;
    fn shutdown(&self);
    fn close(&self);
    fn pause_stream(&self) -> bool;
    fn resume_stream(&self) -> bool;
    fn shutdown_read(&self) {}
    fn flush(&self) {}
    fn set_timeout(&self, _seconds: c_uint) {}
    fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        None
    }
    fn fd(&self) -> Fd {
        Fd::INVALID
    }
    /// See [`NewSocketHandler::reject_send`]. The close comes from the event loop, never from inside this call.
    fn reject_send(&self, _error: i32) {}
    fn rejected_send_error(&self) -> i32 {
        0
    }
    /// See [`NewSocketHandler::prepare_for_finalize`].
    fn abandon_js_side(&self) {}
    /// Whether a write runs user JS before it returns.
    fn write_runs_js(&self) -> bool {
        false
    }
}

// Variant + pointer-identity equality.
impl PartialEq for InternalSocket {
    fn eq(&self, other: &Self) -> bool {
        match (*self, *other) {
            (InternalSocket::Connected(a), InternalSocket::Connected(b)) => core::ptr::eq(a, b),
            (InternalSocket::UwsHttp(a), InternalSocket::UwsHttp(b)) => core::ptr::eq(a, b),
            (InternalSocket::Connecting(a), InternalSocket::Connecting(b)) => core::ptr::eq(a, b),
            (InternalSocket::Detached, InternalSocket::Detached) => true,
            (InternalSocket::Transport(a), InternalSocket::Transport(b)) => core::ptr::eq(a, b),
            _ => false,
        }
    }
}

impl InternalSocket {
    /// `Some` only for `.connected`.
    #[inline]
    pub fn get(&self) -> Option<*mut us_socket_t> {
        match *self {
            InternalSocket::Connected(s) => Some(s),
            _ => None,
        }
    }
    #[inline]
    pub fn is_detached(&self) -> bool {
        matches!(self, InternalSocket::Detached)
    }
}

// ── Safe deref helpers for `InternalSocket` payloads ────────────────────────
// Both uSockets payload types are `#[repr(C)] UnsafeCell<[u8; 0]>` opaque ZSTs
// (`opaque_ffi!` / `opaque_extern!`): zero-sized, align-1, no `noalias` /
// `readonly`. Materializing `&mut T` from `*mut T` therefore has exactly one
// validity requirement — non-null — which uSockets guarantees for every
// pointer it stores in `Connected` / `Connecting`.
// Centralizing the deref keeps the proof local instead of repeating
// `unsafe { &mut *s }` at ~50 match arms.

/// Reborrow the `InternalSocket::Connected` payload.
#[inline(always)]
fn sock<'a>(p: *mut us_socket_t) -> &'a mut us_socket_t {
    bun_opaque::opaque_deref_mut(p)
}
/// Reborrow the `InternalSocket::Connecting` payload.
#[inline(always)]
fn conn<'a>(p: *mut ConnectingSocket) -> &'a mut ConnectingSocket {
    bun_opaque::opaque_deref_mut(p)
}
/// Reborrow the `InternalSocket::Transport` payload.
#[inline(always)]
fn transport<'a>(p: *const TransportHandle) -> &'a dyn Transport {
    // SAFETY: a transport sets its handle before it gives it out, and detaches its owner before it frees itself.
    unsafe { (*p).0.get().unwrap_unchecked().as_ref() }
}

/// `InternalSocket::UwsHttp`: a write queues behind the HTTP response in uWS's buffer, and the FIN and the close wait for that buffer.
mod uws_http {
    use super::us_socket_t;
    unsafe extern "C" {
        fn Bun__NodeHTTPServerSocket__write(
            s: *mut us_socket_t,
            ssl: bool,
            data: *const u8,
            len: usize,
        );
        pub(super) safe fn Bun__NodeHTTPServerSocket__shutdown(s: &mut us_socket_t, ssl: bool);
        pub(super) safe fn Bun__NodeHTTPServerSocket__close(
            s: &mut us_socket_t,
            ssl: bool,
            code: i32,
        );
        pub(super) safe fn Bun__NodeHTTPServerSocket__setReadsPaused(
            s: &mut us_socket_t,
            ssl: bool,
            paused: bool,
        );
        pub(super) safe fn Bun__NodeHTTPServerSocket__hasUnsentBytes(
            s: &mut us_socket_t,
            ssl: bool,
        ) -> bool;
    }
    pub(super) fn write(s: *mut us_socket_t, ssl: bool, data: &[u8]) -> i32 {
        let taken = data.len().min(i32::MAX as usize);
        // SAFETY: `s` is the live socket of an `InternalSocket::UwsHttp`, and `data` is valid for `taken` bytes.
        unsafe { Bun__NodeHTTPServerSocket__write(s, ssl, data.as_ptr(), taken) };
        taken as i32
    }
}

/// `match self.socket` with each arm bound to the deref'd payload, so method bodies are one-liners.
macro_rules! on_socket {
    (
        $sock:expr;
        connected $s:ident => $conn:expr,
        connecting $c:ident => $cing:expr,
        detached => $det:expr,
        transport $t:ident => $tra:expr $(,)?
    ) => {
        match $sock {
            InternalSocket::Connected(__s) | InternalSocket::UwsHttp(__s) => { let $s = sock(__s); $conn }
            InternalSocket::Connecting(__c) => { let $c = conn(__c); $cing }
            InternalSocket::Detached => $det,
            InternalSocket::Transport(__t) => { let $t = transport(__t); $tra }
        }
    };
    // Short form: connecting/detached collapse to one default.
    (
        $sock:expr;
        connected $s:ident => $conn:expr,
        transport $t:ident => $tra:expr,
        else => $det:expr $(,)?
    ) => {
        on_socket!($sock;
            connected $s => $conn,
            connecting _c => { let _ = _c; $det },
            detached => $det,
            transport $t => $tra,
        )
    };
}

// ──────────────────────────────────────────────────────────────────────────
// NewSocketHandler<IS_SSL>
// ──────────────────────────────────────────────────────────────────────────

/// The const generic only
/// selects `*SSL` vs fd for `get_native_handle`; it is NOT forwarded to C —
/// TLS is per-socket there.
#[derive(Copy, Clone)]
pub struct NewSocketHandler<const IS_SSL: bool> {
    pub socket: InternalSocket,
}

pub type SocketTCP = NewSocketHandler<false>;
pub type SocketTLS = NewSocketHandler<true>;
/// Alias used by `http`, `ipc`, `websocket_client` — same type, less ceremony.
pub type SocketHandler<const SSL: bool> = NewSocketHandler<SSL>;

impl<const IS_SSL: bool> NewSocketHandler<IS_SSL> {
    pub const DETACHED: Self = Self {
        socket: InternalSocket::Detached,
    };

    /// Constructor form of [`Self::DETACHED`].
    #[inline]
    pub const fn detached() -> Self {
        Self::DETACHED
    }

    // ── const-generic discriminant casts ────────────────────────────────────
    // Layout is identical (single `InternalSocket` field — the bool only gates
    // `get_native_handle`); these are safe field moves with a matching debug
    // assert that the caller passed the right arm.
    #[inline]
    pub const fn assume_ssl(self) -> NewSocketHandler<true> {
        debug_assert!(IS_SSL);
        NewSocketHandler {
            socket: self.socket,
        }
    }
    #[inline]
    pub const fn assume_tcp(self) -> NewSocketHandler<false> {
        debug_assert!(!IS_SSL);
        NewSocketHandler {
            socket: self.socket,
        }
    }
    /// Generic counterpart of [`Self::assume_ssl`]/[`Self::assume_tcp`] for
    /// callers inside an `if IS_SSL { ... }` arm widening a concrete handle
    /// back to the surrounding `NewSocketHandler<IS_SSL>`.
    #[inline]
    pub const fn cast_ssl<const NEW_SSL: bool>(self) -> NewSocketHandler<NEW_SSL> {
        debug_assert!(IS_SSL == NEW_SSL);
        NewSocketHandler {
            socket: self.socket,
        }
    }

    #[inline]
    pub fn detach(&mut self) {
        self.socket = InternalSocket::Detached;
    }
    #[inline]
    pub fn is_detached(&self) -> bool {
        self.socket.is_detached()
    }
    /// No `us_socket_t`, so no descriptor that TLS could adopt.
    #[inline]
    pub fn is_transport(&self) -> bool {
        matches!(self.socket, InternalSocket::Transport(_))
    }
    pub fn write_runs_js(&self) -> bool {
        matches!(self.socket, InternalSocket::Transport(t) if transport(t).write_runs_js())
    }

    // ── state queries ───────────────────────────────────────────────────────

    /// Write that also reports a fatal write error as a positive errno (0 = none).
    pub fn write_check_error(&self, data: &[u8]) -> (i32, i32) {
        if let InternalSocket::UwsHttp(s) = self.socket {
            return (uws_http::write(s, IS_SSL, data), 0);
        }
        on_socket!(self.socket;
            connected s => s.write_check_error(data),
            transport t => t.write(data),
            else => (0, 0),
        )
    }

    pub fn is_closed(&self) -> bool {
        on_socket!(self.socket;
            connected s => s.is_closed(),
            connecting c => c.is_closed(),
            detached => true,
            transport t => t.is_closed(),
        )
    }

    pub fn is_shutdown(&self) -> bool {
        on_socket!(self.socket;
            connected s => s.is_shutdown(),
            connecting c => c.is_shutdown(),
            detached => true,
            transport t => t.is_shutdown(),
        )
    }

    pub fn is_established(&self) -> bool {
        on_socket!(self.socket;
            connected s => s.is_established(),
            transport t => !t.is_closed(),
            else => false,
        )
    }

    #[inline]
    pub fn is_closed_or_has_error(&self) -> bool {
        self.is_closed() || self.is_shutdown() || self.get_error() != 0
    }

    /// Returns true if bytes that `write` already counted as written still wait in user space for the kernel: TLS records, or all that uWS buffers for a node:http connection.
    pub fn ssl_spill_pending(&self) -> bool {
        if let InternalSocket::UwsHttp(s) = self.socket {
            return uws_http::Bun__NodeHTTPServerSocket__hasUnsentBytes(sock(s), IS_SSL);
        }
        on_socket!(self.socket;
            connected s => s.ssl_spill_pending(),
            transport _t => false,
            else => false,
        )
    }

    /// Gives up on a send that `write_check_error` failed with `error`: no more writes, and once the peer's bytes are read the loop closes the socket. `rejected_send_error()` answers `error` from then on.
    pub fn reject_send(&self, error: i32) {
        on_socket!(self.socket;
            connected s => s.reject_send(error),
            transport t => t.reject_send(error),
            else => {},
        )
    }

    /// The error of a rejected send, in usockets' numbering, or 0.
    pub fn rejected_send_error(&self) -> i32 {
        on_socket!(self.socket;
            connected s => s.rejected_send_error(),
            transport t => t.rejected_send_error(),
            else => 0,
        )
    }

    /// What the read side holds right now, without waiting for the loop to
    /// poll. Transports the loop does not `recv()` report nothing queued.
    pub fn queued_input(&self) -> QueuedInput {
        on_socket!(self.socket;
            connected s => s.queued_input(),
            transport _t => QueuedInput::None,
            else => QueuedInput::None,
        )
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        match self.ssl_mut() {
            Some(ssl) if !self.is_closed() => crate::ssl::us_ssl_socket_verify_error_from_ssl(ssl),
            _ => us_bun_verify_error_t::default(),
        }
    }

    pub fn get_error(&self) -> i32 {
        on_socket!(self.socket;
            connected s => s.get_error(),
            connecting c => c.get_error(),
            detached => 0,
            transport _t => 0,
        )
    }

    /// Raw `getaddrinfo(3)` return code for a pending connect whose name
    /// lookup failed; 0 otherwise (a connect failure past name resolution, or
    /// any non-connecting handle). A different namespace from
    /// [`Self::get_error`] (errno).
    pub fn dns_error(&self) -> i32 {
        match self.socket {
            InternalSocket::Connecting(c) => conn(c).get_dns_error(),
            _ => 0,
        }
    }

    // ── lifecycle ───────────────────────────────────────────────────────────

    pub fn close(&self, code: CloseCode) {
        if let InternalSocket::UwsHttp(s) = self.socket {
            return uws_http::Bun__NodeHTTPServerSocket__close(sock(s), IS_SSL, code as i32);
        }
        on_socket!(self.socket;
            connected s => s.close(code),
            connecting c => c.close(),
            detached => {},
            transport t => t.close(),
        )
    }

    /// Closes with a FIN before it returns; TLS sends close_notify but does not wait for the peer's, which `CloseCode::Normal` does.
    pub fn close_now(&self) {
        match self.socket {
            InternalSocket::Connected(s) => sock(s).close_now(),
            _ => self.close(CloseCode::FastShutdown),
        }
    }

    /// The JS wrapper that owns this socket is being finalized: whatever the
    /// close below unwinds must not reach back into JS objects.
    pub fn prepare_for_finalize(&self) {
        on_socket!(self.socket;
            connected _s => {},
            connecting _c => {},
            detached => {},
            transport t => t.abandon_js_side(),
        )
    }

    pub fn shutdown(&self) {
        if let InternalSocket::UwsHttp(s) = self.socket {
            return uws_http::Bun__NodeHTTPServerSocket__shutdown(sock(s), IS_SSL);
        }
        on_socket!(self.socket;
            connected s => s.shutdown(),
            connecting c => c.shutdown(),
            detached => {},
            transport t => t.shutdown(),
        )
    }

    pub fn shutdown_read(&self) {
        on_socket!(self.socket;
            connected s => s.shutdown_read(),
            connecting c => c.shutdown_read(),
            detached => {},
            transport t => t.shutdown_read(),
        )
    }

    // ── I/O ─────────────────────────────────────────────────────────────────

    pub fn write(&self, data: &[u8]) -> i32 {
        if let InternalSocket::UwsHttp(s) = self.socket {
            return uws_http::write(s, IS_SSL, data);
        }
        on_socket!(self.socket;
            connected s => s.write(data),
            transport t => t.write(data).0,
            else => 0,
        )
    }

    /// Write `data` and pass `file_descriptor` over the socket via SCM_RIGHTS.
    /// POSIX-only — Windows IPC fd passing goes through libuv pipes instead.
    ///
    /// LAYERING: takes the raw POSIX fd (`c_int`) rather than `bun_sys::Fd` —
    /// `bun_uws_sys` sits below `bun_sys`; callers extract `.native()` at the
    /// boundary.
    #[cfg(not(windows))]
    pub fn write_fd(&self, data: &[u8], file_descriptor: c_int) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) => {
                sock(s).write_fd(data, Fd::from_native(file_descriptor))
            }
            // Falls back to a plain write (the fd is silently dropped).
            InternalSocket::Transport(_) | InternalSocket::UwsHttp(_) => self.write(data),
            InternalSocket::Connecting(_) | InternalSocket::Detached => 0,
        }
    }

    /// Vectored raw write: one writev on real sockets; sequential raw writes on
    /// a [`Transport`]. Plain-TCP callers only — raw
    /// writes bypass TLS framing.
    pub fn raw_writev(&self, iov: &[crate::UsIoVec]) -> i32 {
        on_socket!(self.socket;
            connected s => s.raw_writev(iov),
            transport t => {
                let mut total: i32 = 0;
                for v in iov {
                    // SAFETY: UsIoVec contract — base/len reference caller-owned memory
                    let slice = unsafe { core::slice::from_raw_parts(v.base.cast::<u8>(), v.len) };
                    let w = t.raw_write(slice);
                    if w > 0 { total += w; }
                    if w < slice.len() as i32 { break; }
                }
                total
            },
            else => 0,
        )
    }

    /// Bypass TLS — raw bytes to the fd even on a TLS socket.
    pub fn raw_write(&self, data: &[u8]) -> i32 {
        on_socket!(self.socket;
            connected s => s.raw_write(data),
            transport t => t.raw_write(data),
            else => 0,
        )
    }

    pub fn flush(&self) {
        on_socket!(self.socket;
            connected s => s.flush(),
            transport t => t.flush(),
            else => {},
        )
    }

    // ── timeouts ────────────────────────────────────────────────────────────

    /// Fires `on_timeout` once, at the first 4 s sweep after `seconds` have passed. 0 disarms.
    pub fn set_timeout(&self, seconds: c_uint) {
        // The timer of a connection that uWS owns is uWS's.
        if matches!(self.socket, InternalSocket::UwsHttp(_)) {
            return;
        }
        on_socket!(self.socket;
            connected s => s.set_timeout(seconds),
            connecting c => c.timeout(seconds),
            detached => {},
            transport t => t.set_timeout(seconds),
        )
    }

    // ── flow control / sockopts ─────────────────────────────────────────────

    /// A connect that has not completed yet is left alone (like the
    /// `connecting` arm): the open re-arms reads, so latching a pause here
    /// would only make the next real `pause()` a no-op.
    pub fn pause_stream(&self) -> bool {
        if let InternalSocket::UwsHttp(s) = self.socket {
            uws_http::Bun__NodeHTTPServerSocket__setReadsPaused(sock(s), IS_SSL, true);
            return true;
        }
        on_socket!(self.socket;
            connected s => if s.is_established() { s.pause(); true } else { false },
            connecting _c => false,
            detached => true,
            transport t => t.pause_stream(),
        )
    }

    pub fn resume_stream(&self) -> bool {
        if let InternalSocket::UwsHttp(s) = self.socket {
            uws_http::Bun__NodeHTTPServerSocket__setReadsPaused(sock(s), IS_SSL, false);
            return true;
        }
        on_socket!(self.socket;
            connected s => if s.is_established() { s.resume(); true } else { false },
            connecting _c => false,
            detached => true,
            transport t => t.resume_stream(),
        )
    }

    pub fn set_no_delay(&self, enabled: bool) -> bool {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => {
                sock(s).set_nodelay(enabled);
                true
            }
            _ => false,
        }
    }

    pub fn set_keep_alive(&self, enabled: bool, delay: u32) -> bool {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => {
                sock(s).set_keepalive(enabled, delay) == 0
            }
            _ => false,
        }
    }

    /// Set the IP type-of-service. Returns 0 on success or a negative errno;
    /// non-TCP sockets (pipes, duplexes, not-yet-connected) report -EBADF (-9)
    /// the way Node's no-handle fallback does.
    pub fn set_tos(&self, tos: i32) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => sock(s).set_tos(tos),
            _ => -9,
        }
    }

    /// Get the IP type-of-service (>= 0) or a negative errno.
    pub fn get_tos(&self) -> i32 {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => sock(s).get_tos(),
            _ => -9,
        }
    }

    /// Resume a handshake suspended by an asynchronous SNICallback. The ctx
    /// reference is consumed (freed here when no TLS engine is left to resume).
    pub fn sni_resolve(&self, ctx: *mut crate::SslCtx, error: bool) {
        if let InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) = self.socket {
            return sock(s).sni_resolve(ctx, error);
        }
        let Some(ssl) = self.ssl_mut() else {
            // SAFETY: the caller passed an owned SSL_CTX reference, or null.
            return unsafe { bun_boringssl_sys::SSL_CTX_free(ctx) };
        };
        // SAFETY: `ssl` is live, and the callee takes the reference `ctx` carries.
        if unsafe { crate::ssl::us_ssl_sni_resolve(ssl, ctx, c_int::from(error)) } != 0 {
            // Drives the handshake again.
            self.flush();
        }
    }

    // ── TLS ─────────────────────────────────────────────────────────────────

    /// Refuse a bad server chain during the handshake, before the client
    /// certificate goes out. Client-only; call it before the handshake is driven.
    pub fn set_inline_reject(&self) {
        if let Some(ssl) = self.ssl_mut() {
            crate::ssl::us_ssl_set_inline_reject(ssl);
        }
    }

    /// Drop the handshake flight that usockets holds across the handshake callback.
    pub fn release_held_flight(&self) {
        if let InternalSocket::Connected(s) = self.socket {
            sock(s).release_held_flight();
        }
    }

    /// A shutdown before the first handshake step sends its FIN after that step.
    pub fn set_first_flight_before_fin(&self) {
        if let InternalSocket::Connected(s) = self.socket {
            sock(s).set_first_flight_before_fin();
        }
    }

    /// `SSL*` if this is a TLS socket, else `None`.
    #[inline]
    pub fn ssl(&self) -> Option<*mut bun_boringssl_sys::SSL> {
        // A connecting socket has no `SSL` yet (its native handle is a
        // sentinel, not a pointer).
        if !IS_SSL || matches!(self.socket, InternalSocket::Connecting(_)) {
            return None;
        }
        self.get_native_handle().map(|h| h.cast())
    }

    /// The socket's `SSL` handle as a borrow (`SSL` is a zero-sized opaque,
    /// so this is the safe spelling of [`ssl`](Self::ssl)).
    #[inline]
    pub fn ssl_mut(&self) -> Option<&mut bun_boringssl_sys::SSL> {
        self.ssl()
            .filter(|p| !p.is_null())
            .map(bun_opaque::opaque_deref_mut)
    }

    /// `*SSL` when `IS_SSL`, raw fd-as-ptr otherwise. Type-erased to
    /// `*mut c_void` here because const-generic type dispatch
    /// (`NativeSocketHandleType(is_ssl)`) is unsupported in stable Rust;
    /// callers `cast()` immediately anyway.
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => {
                sock(s).get_native_handle()
            }
            InternalSocket::Connecting(s) => {
                let h = conn(s).get_native_handle();
                if h.is_null() { None } else { Some(h) }
            }
            InternalSocket::Transport(t) => transport(t).ssl().map(|p| p.cast()),
            InternalSocket::Detached => None,
        }
    }

    // ── ext / fd ────────────────────────────────────────────────────────────

    /// Clear the `Option<NonNull<Owner>>` ext slot written by
    /// [`connect_group`](Self::connect_group), returning whether it still held
    /// the owner. Used when the owner tears the socket down itself and must
    /// reclaim the ref the slot represented.
    pub fn take_ext_owner<Owner>(&self) -> bool {
        match self.socket {
            InternalSocket::Connected(s) => {
                sock(s).ext::<Option<NonNull<Owner>>>().take().is_some()
            }
            InternalSocket::Connecting(s) => {
                conn(s).ext::<Option<NonNull<Owner>>>().take().is_some()
            }
            _ => false,
        }
    }

    /// Typed ext storage. `None` for non-uSockets transports.
    pub fn ext<T>(&self) -> Option<*mut T> {
        match self.socket {
            // Raw `*mut T` only — do NOT route through `ext::<T>()` (which
            // materializes `&mut T` and would assert validity invariants).
            InternalSocket::Connected(s) => Some(sock(s).ext_ptr().cast::<T>()),
            InternalSocket::Connecting(s) => {
                Some(crate::connecting_socket::us_connecting_socket_ext(conn(s)).cast::<T>())
            }
            _ => None,
        }
    }

    /// Underlying fd. Same fd regardless of TLS — read directly off the poll.
    #[inline]
    pub fn fd(&self) -> Fd {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => sock(s).get_fd(),
            InternalSocket::Transport(t) => transport(t).fd(),
            _ => Fd::INVALID,
        }
    }

    pub fn local_port(&self) -> Option<u16> {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => sock(s).local_port(),
            _ => None,
        }
    }

    pub fn remote_port(&self) -> Option<u16> {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => sock(s).remote_port(),
            _ => None,
        }
    }

    pub fn local_address<'b>(&self, buf: &'b mut [u8]) -> Option<&'b [u8]> {
        match self.socket {
            // getsockname() can fail (EBADF/ENOTCONN/…) on a socket the OS
            // closed or reset underneath us; callers treat that as "no address".
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => {
                sock(s).local_address(buf).ok()
            }
            _ => None,
        }
    }

    pub fn remote_address<'b>(&self, buf: &'b mut [u8]) -> Option<&'b [u8]> {
        match self.socket {
            InternalSocket::Connected(s) | InternalSocket::UwsHttp(s) => {
                sock(s).remote_address(buf).ok()
            }
            _ => None,
        }
    }

    pub fn mark_needs_more_for_sendfile(&self) {
        const { assert!(!IS_SSL, "SSL sockets do not support sendfile yet") };
        if let InternalSocket::Connected(s) = self.socket {
            sock(s).request_writable();
        }
    }

    // ── constructors ────────────────────────────────────────────────────────

    #[inline]
    pub fn from(socket: *mut us_socket_t) -> Self {
        Self {
            socket: InternalSocket::Connected(socket),
        }
    }
    #[inline]
    pub fn from_uws_http(socket: *mut us_socket_t) -> Self {
        Self {
            socket: InternalSocket::UwsHttp(socket),
        }
    }
    #[inline]
    pub fn from_connecting(connecting: *mut ConnectingSocket) -> Self {
        Self {
            socket: InternalSocket::Connecting(connecting),
        }
    }
    #[inline]
    pub fn from_any(socket: InternalSocket) -> Self {
        Self { socket }
    }
    #[inline]
    pub fn from_transport(transport: *const TransportHandle) -> Self {
        Self {
            socket: InternalSocket::Transport(transport),
        }
    }

    /// Wrap an already-open fd. Ext stores `*mut This`; the socket is linked
    /// into `g` with kind `k`. Port of `NewSocketHandler.fromFd`.
    pub fn from_fd<This>(
        g: &mut SocketGroup,
        k: SocketKind,
        handle: Fd,
        this: *mut This,
        is_ipc: bool,
    ) -> Option<Self> {
        // The dispatch trampolines read the ext slot as `Option<NonNull<_>>`
        // (8 bytes, null-niche optimized), so size and write must match that
        // layout — NOT `Option<*mut This>` (16 bytes).
        let ext_size = size_of::<Option<NonNull<This>>>() as c_int;
        let raw = g.from_fd(
            k,
            None,
            ext_size,
            handle.native() as LIBUS_SOCKET_DESCRIPTOR,
            0,
            is_ipc,
        );
        if raw.is_null() {
            return None;
        }
        // ext storage was sized for `?*This` above; `raw` is a freshly-created
        // live socket. `ext::<T>()` is sound here because we immediately
        // overwrite the slot, never reading the prior (zeroed) bit pattern.
        *sock(raw).ext::<Option<NonNull<This>>>() = NonNull::new(this);
        Some(Self {
            socket: InternalSocket::Connected(raw),
        })
    }

    /// Connect via a `SocketGroup` and stash `owner` in the socket ext.
    /// Replaces the deleted `connectAnon`/`connectPtr`.
    pub fn connect_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        raw_host: &[u8],
        port: c_int,
        owner: *mut Owner,
    ) -> Result<Self, ConnectError> {
        // getaddrinfo doesn't understand bracketed IPv6 literals; URL parsing
        // leaves them in (`[::1]`).
        let host = bun_core::ip_address::strip_ipv6_brackets(raw_host);
        // SocketGroup.connect needs a NUL-terminated host.
        let mut stack = [0u8; 256];
        let heap: Vec<u8>;
        let host_z: &core::ffi::CStr = if host.len() < stack.len() {
            stack[..host.len()].copy_from_slice(host);
            stack[host.len()] = 0;
            ZStr::from_buf(&stack, host.len()).as_cstr()
        } else {
            heap = {
                let mut v = Vec::with_capacity(host.len() + 1);
                v.extend_from_slice(host);
                v.push(0);
                v
            };
            ZStr::from_slice_with_nul(&heap).as_cstr()
        };

        // The dispatch trampolines read the ext slot as `Option<NonNull<_>>`
        // (8 bytes, null-niche optimized), so size and write must match that
        // layout — NOT `Option<*mut Owner>` (16 bytes, discriminant-first),
        // which would hand the trampoline `1` instead of the owner pointer.
        let ext_size = size_of::<Option<NonNull<Owner>>>() as c_int;
        match g.connect(kind, ssl_ctx, host_z, port, None, 0, ext_size) {
            ConnectResult::Failed => Err(ConnectError::FailedToOpenSocket),
            ConnectResult::Socket(s) => {
                *sock(s).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner);
                Ok(Self {
                    socket: InternalSocket::Connected(s),
                })
            }
            ConnectResult::Connecting(cs) => {
                *conn(cs).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner);
                Ok(Self {
                    socket: InternalSocket::Connecting(cs),
                })
            }
        }
    }

    pub fn connect_unix_group<Owner>(
        g: &mut SocketGroup,
        kind: SocketKind,
        ssl_ctx: Option<*mut SslCtx>,
        path: &[u8],
        owner: *mut Owner,
    ) -> Result<Self, ConnectError> {
        // See connect_group above for the ext-slot layout rationale.
        let ext_size = size_of::<Option<NonNull<Owner>>>() as c_int;
        let s = g.connect_unix(kind, ssl_ctx, path, 0, ext_size);
        if s.is_null() {
            return Err(ConnectError::FailedToOpenSocket);
        }
        *sock(s).ext::<Option<NonNull<Owner>>>() = NonNull::new(owner);
        Ok(Self {
            socket: InternalSocket::Connected(s),
        })
    }

    /// Move an open socket into a new group/kind, stashing `owner` in the ext.
    /// Replaces `Socket.adoptPtr`. Returns `false` and leaves the socket and
    /// `owner` untouched if the socket is closed or shut down.
    ///
    /// `set_socket_field` — the closure writes the resulting
    /// `Self` into the owner's socket field via the raw `*mut Owner` (passing
    /// `&mut Owner` here would alias any live `&mut` the caller already holds).
    pub fn adopt_group<Owner>(
        tcp: *mut us_socket_t,
        g: *mut SocketGroup,
        kind: SocketKind,
        owner: *mut Owner,
        set_socket_field: impl FnOnce(*mut Owner, Self),
    ) -> bool {
        // SAFETY: `tcp` and `g` are non-null FFI handles; ext sizes are word-sized.
        let new_s = unsafe {
            sock_c::us_socket_adopt(
                tcp,
                g,
                kind as u8,
                size_of::<*mut c_void>() as i32,
                size_of::<*mut c_void>() as i32,
            )
        };
        if new_s.is_null() {
            return false;
        }
        *sock(new_s).ext::<*mut c_void>() = owner.cast::<c_void>();
        // Forward the raw pointer — do NOT materialize `&mut *owner` here:
        // callers (e.g. websocket_client) hold a live `&mut Owner` across this
        // call, so creating a second one would be aliased UB. The closure
        // performs the field write through the raw pointer itself.
        set_socket_field(
            owner,
            Self {
                socket: InternalSocket::Connected(new_s),
            },
        );
        true
    }
}

/// Residual raw FFI: `adopt` takes a raw `*mut SocketGroup` from a caller
/// that already holds it as raw, and `SocketGroup` is a sized `#[repr(C)]`
/// mirror (not an opaque ZST), so `opaque_deref_mut` can't help.
mod sock_c {
    use super::{SocketGroup, us_socket_t};
    unsafe extern "C" {
        pub(super) fn us_socket_adopt(
            s: *mut us_socket_t,
            group: *mut SocketGroup,
            kind: u8,
            old_ext_size: i32,
            ext_size: i32,
        ) -> *mut us_socket_t;
    }
}

// ──────────────────────────────────────────────────────────────────────────
// ConnectError
// ──────────────────────────────────────────────────────────────────────────

#[derive(strum::IntoStaticStr, Debug)]
pub enum ConnectError {
    FailedToOpenSocket,
}
impl From<ConnectError> for crate::Error {
    fn from(_: ConnectError) -> Self {
        crate::Error::FailedToOpenSocket
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AnySocket
// ──────────────────────────────────────────────────────────────────────────

/// TODO: rename to ConnectedSocket
#[derive(Copy, Clone)]
pub enum AnySocket {
    SocketTcp(SocketTCP),
    SocketTls(SocketTLS),
}

/// Stamp out `AnySocket::$m` as a two-arm forward to `NewSocketHandler<SSL>::$m`.
macro_rules! any_socket_forward {
    ($( fn $name:ident(&self $(, $arg:ident : $ty:ty)* ) $(-> $ret:ty)? ; )*) => {$(
        #[inline]
        pub fn $name(&self $(, $arg: $ty)*) $(-> $ret)? {
            match self {
                AnySocket::SocketTcp(s) => s.$name($($arg),*),
                AnySocket::SocketTls(s) => s.$name($($arg),*),
            }
        }
    )*};
}

impl AnySocket {
    #[inline]
    pub fn socket(&self) -> &InternalSocket {
        match self {
            AnySocket::SocketTcp(s) => &s.socket,
            AnySocket::SocketTls(s) => &s.socket,
        }
    }

    any_socket_forward! {
        fn is_closed(&self) -> bool;
        fn is_shutdown(&self) -> bool;
        fn is_established(&self) -> bool;
        fn close(&self, code: CloseCode);
        fn close_now(&self);
        fn write(&self, data: &[u8]) -> i32;
        fn set_timeout(&self, seconds: c_uint);
        fn shutdown(&self);
        fn shutdown_read(&self);
        fn local_port(&self) -> Option<u16>;
        fn get_native_handle(&self) -> Option<*mut c_void>;
    }
}
