//! Slab-slot socket header + internal open/close/read/write paths.
//! Implements core-semantics.md §3 (SOCKET LIFECYCLE); handle-facing method
//! surface per consumers/01-api-surface.md §1. TLS close/open orchestration
//! (us_internal_ssl_{on_open,close,on_end} composition over `TlsState`
//! pieces) lives here because socket.c owned those call sites. Group
//! linkage, adoption bookkeeping and ext allocation live in group.rs.

use core::ffi::{c_int, c_void};
use core::ptr::{self, NonNull};

use bun_core::Fd;

use crate::backend::{Events, PollState, PollType};
use crate::connecting::ConnectingSocket;
use crate::dispatch;
use crate::group::SocketGroup;
use crate::handle::CloseCode;
use crate::kind::SocketKind;
use crate::loop_::Loop;
use crate::tls::context::{SslCtx, us_bun_verify_error_t};
use crate::tls::state::{HandshakeState, TlsState};
use crate::tls::{SSL, Transport};
use crate::unsafe_core::deref::{with_group, with_loop_data, with_socket};
use crate::unsafe_core::ext::{deref_mut, header_mut};
use crate::unsafe_core::{ffi, io};
use crate::write::UsIoVec;
#[cfg(not(windows))]
use crate::LIBUS_RECV_BUFFER_LENGTH;
use crate::LIBUS_SOCKET_DESCRIPTOR;

/// Packed 1-byte socket flags (bit assignments per cabi-surface.md §3.7:
/// `last_write_failed` is bit 7 — frozen while the SHIM pokes it).
#[derive(Copy, Clone, Default)]
#[repr(transparent)]
pub(crate) struct SocketFlags(pub(crate) u8);

impl SocketFlags {
    pub(crate) const IS_CLOSED: u8 = 1 << 0;
    /// Raw TCP FIN-sent bit (poll type SOCKET_SHUT_DOWN in C). The TLS-aware
    /// query is [`is_shut_down_full`].
    pub(crate) const IS_SHUT_DOWN: u8 = 1 << 1;
    pub(crate) const IS_PAUSED: u8 = 1 << 2;
    pub(crate) const ALLOW_HALF_OPEN: u8 = 1 << 3;
    pub(crate) const IS_IPC: u8 = 1 << 4;
    pub(crate) const LAST_WRITE_FAILED: u8 = 1 << 7;

    #[inline]
    pub(crate) fn get(self, bit: u8) -> bool {
        self.0 & bit != 0
    }
    #[inline]
    pub(crate) fn set(&mut self, bit: u8, value: bool) {
        if value {
            self.0 |= bit;
        } else {
            self.0 &= !bit;
        }
    }
}

/// The slab slot body. Never moves and is never returned to the OS while the
/// loop lives (unsafe_core/slab.rs); the slot's generation lives alongside it
/// in the slab slot and is validated by every `SocketRef` operation.
/// `p` MUST stay first: the kernel udata pointer doubles as the header
/// pointer (backend `slab_generation` / `on_socket_poll_ready` cast).
#[repr(C)]
pub struct SocketHeader {
    pub(crate) p: PollState,
    pub(crate) flags: SocketFlags,
    pub(crate) kind: SocketKind,
    /// 4-second wheel bucket; 255 = off (core-semantics.md §5).
    pub(crate) timeout: u8,
    /// Minute wheel bucket; 255 = off.
    pub(crate) long_timeout: u8,
    /// Low-prio queue state 0/1/2 (core-semantics.md §1, C8).
    pub(crate) low_prio_state: u8,
    pub(crate) fd: LIBUS_SOCKET_DESCRIPTOR,
    /// libuv poll handle (Windows only; owned until poll_stop_close).
    #[cfg(windows)]
    pub(crate) uv_p: *mut c_void,
    pub(crate) prev: *mut SocketHeader,
    pub(crate) next: *mut SocketHeader,
    pub(crate) group: *mut SocketGroup,
    /// Owning `ConnectingSocket` while this is a happy-eyeballs attempt.
    pub(crate) connect_state: *mut ConnectingSocket,
    pub(crate) transport: Transport,
    /// Rust kinds: one 8-byte owner word (`Option<NonNull<Owner>>` niche
    /// layout — the word IS the storage). uWS/Dynamic kinds: pointer to the
    /// slot's INLINE ext area, contiguous after this header and sized at
    /// creation for the adoption family (P0b; freed with the slab slot).
    /// Listener (kind == Invalid): `Box<ListenerData>` (group.rs).
    pub(crate) ext: *mut c_void,
}

/// C-facing name; a `us_socket_t*` handed across cabi is a pointer to the
/// slab-resident header (opaque to all surviving C/C++).
pub type us_socket_t = SocketHeader;

// ── slab allocation entries (used by group.rs / connecting.rs) ───────────────

/// One slab slot, stamped per R3.3 (all four creation paths funnel here:
/// accept / connect / from_fd / listen). Timeouts start disarmed; every flag
/// beyond the caller-provided ones is zero; transport is Plain. `ext_size`
/// picks the slab size class for group-vtable kinds (family-max ext bytes,
/// inline after the header — P0b); Rust kinds always use the word (class 0).
pub(crate) fn alloc(
    loop_: *mut Loop,
    poll_kind: PollType,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    group: *mut SocketGroup,
    kind: SocketKind,
    flags: SocketFlags,
    ext_size: c_int,
) -> *mut us_socket_t {
    let ext_capacity = if dispatch::uses_group_vtable(kind) {
        ext_size.max(0) as usize
    } else {
        0
    };
    let s = crate::loop_::alloc_socket(
        loop_,
        SocketHeader {
            p: PollState::init(fd, poll_kind),
            flags,
            kind,
            timeout: 255,
            long_timeout: 255,
            low_prio_state: 0,
            fd,
            #[cfg(windows)]
            uv_p: ptr::null_mut(),
            prev: ptr::null_mut(),
            next: ptr::null_mut(),
            group,
            connect_state: ptr::null_mut(),
            transport: Transport::Plain,
            ext: ptr::null_mut(),
        },
        ext_capacity,
    );
    if ext_capacity > 0 {
        header_mut(s).ext = crate::unsafe_core::ext::inline_ext_ptr(s);
    }
    s
}

/// Return a slot whose kernel registration FAILED (never linked, never
/// polled, fd not owned) straight to the slab.
pub(crate) fn free_unstarted(loop_: *mut Loop, s: *mut us_socket_t) {
    crate::loop_::free_socket(loop_, s);
}

// ── platform errno helpers ────────────────────────────────────────────────────

/// R4.7: POSIX checks EWOULDBLOCK ONLY.
#[cfg(not(windows))]
#[inline]
fn is_would_block(neg_errno: isize) -> bool {
    neg_errno == -(libc::EWOULDBLOCK as isize)
}
#[cfg(windows)]
#[inline]
fn is_would_block(neg_errno: isize) -> bool {
    neg_errno == -10035 // WSAEWOULDBLOCK
}

#[cfg(not(windows))]
const ECONNRESET_ERRNO: c_int = libc::ECONNRESET;
/// MSVC CRT ECONNRESET: the loop.c:797 clamp used errno.h, not WSA codes.
#[cfg(windows)]
const ECONNRESET_ERRNO: c_int = 108;

/// socket.c:705 `#ifndef EBADF #define EBADF 9` — same value on all targets.
const NEG_EBADF: i32 = -9;

impl CloseCode {
    /// Lossy int → enum for the TLS deferred-close protocol: errno codes (>2)
    /// collapse to `normal` (C kept the raw code in ssl_pending_close_code).
    /// Unreachable today — errno-coded closes never run inside the in_use bracket.
    pub(crate) fn from_c(code: c_int) -> CloseCode {
        match code {
            1 => CloseCode::failure,
            2 => CloseCode::fast_shutdown,
            _ => CloseCode::normal,
        }
    }
}

// ── raw-pointer helpers (fresh borrow per access cluster — C17) ──────────────

/// Loop of a linked socket; the group may change during callbacks, the loop
/// cannot (loop.c:552-553).
pub(crate) fn socket_loop(s: *mut SocketHeader) -> *mut Loop {
    let g = with_socket(s, |h| h.group);
    with_group(g, |g| g.loop_)
}

/// Raw `*mut TlsState` behind the transport box (stable address); `None` for
/// plain. The Box itself stays in place until the slab slot frees (C6).
fn tls_state(s: *mut SocketHeader) -> Option<*mut TlsState> {
    match &mut header_mut(s).transport {
        Transport::Tls(t) => Some(&raw mut **t),
        Transport::Plain => None,
    }
}

/// `us_socket_server_name_userdata` (openssl.c:2528-2531): SNI userdata read
/// from the negotiated SSL_CTX's ex_data slot; null for plain/detached.
pub(crate) fn server_name_userdata(s: *mut us_socket_t) -> *mut c_void {
    let Some(t) = tls_state(s) else {
        return ptr::null_mut();
    };
    let ssl = deref_mut(t).ssl;
    if ssl.is_null() {
        return ptr::null_mut();
    }
    let ctx = crate::unsafe_core::bssl::ssl_get_ctx(ssl);
    if ctx.is_null() {
        return ptr::null_mut();
    }
    crate::tls::context::ctx_sni_user(ctx)
}

/// `ssl_gone`: transport dropped / SSL detached / socket closed.
fn tls_gone(s: *mut SocketHeader) -> bool {
    match tls_state(s) {
        Some(t) => deref_mut(t).ssl.is_null() || header_mut(s).is_closed(),
        None => true,
    }
}

/// `us_socket_is_shut_down` (R3.21): TLS asks the SSL layer, plain reads the
/// FIN-sent bit. Thin raw-pointer wrapper over [`SocketHeader::is_shutdown`].
pub(crate) fn is_shut_down_full(s: *mut SocketHeader) -> bool {
    with_socket(s, |h| h.is_shutdown())
}

// ── kernel poll plumbing ──────────────────────────────────────────────────────

/// `us_poll_change` on this socket (absolute event set).
pub(crate) fn poll_change(s: *mut SocketHeader, events: Events) {
    let loop_ = socket_loop(s);
    poll_change_on(s, loop_, events);
}

fn poll_change_on(s: *mut SocketHeader, loop_: *mut Loop, events: Events) {
    #[cfg(not(windows))]
    crate::backend::poll_change(s.cast::<PollState>(), loop_, events);
    #[cfg(windows)]
    crate::backend::libuv::socket_poll_change(s, loop_, events);
}

fn poll_stop_on(s: *mut SocketHeader, loop_: *mut Loop) {
    #[cfg(not(windows))]
    crate::backend::poll_stop(s.cast::<PollState>(), loop_);
    #[cfg(windows)]
    crate::backend::libuv::socket_poll_stop(s, loop_);
}

/// Deregistration for a close that is about to close the fd: kqueue skips
/// the kevent syscall (fd close removes filters) and only nulls pending
/// ready entries (R3.17.3).
fn poll_stop_for_close(s: *mut SocketHeader, loop_: *mut Loop) {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    {
        let ev = with_socket(s, |h| h.p.events());
        crate::backend::update_pending_ready_polls(
            loop_,
            s.cast::<PollState>(),
            ptr::null_mut(),
            ev,
            Events::NONE,
        );
    }
    #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
    poll_stop_on(s, loop_);
}

// ── death bookkeeping shared by close_raw / detach ───────────────────────────

/// close_raw step 2: low-prio queue splice (with group counter + emptiness
/// re-check) or plain group unlink (which also fixes the sweep iterator).
fn unlink_for_death(s: *mut SocketHeader, loop_: *mut Loop) {
    let (low_prio, group) = with_socket(s, |h| (h.low_prio_state, h.group));
    if low_prio == 1 {
        let (prev, next) = with_socket(s, |h| (h.prev, h.next));
        if prev.is_null() {
            with_loop_data(loop_, |ld| ld.low_prio_head = next);
        } else {
            with_socket(prev, |h| h.next = next);
        }
        if !next.is_null() {
            with_socket(next, |h| h.prev = prev);
        }
        with_socket(s, |h| {
            h.prev = ptr::null_mut();
            h.next = ptr::null_mut();
            h.low_prio_state = 0;
        });
        with_group(group, |g| g.low_prio_count -= 1);
        crate::group::group_maybe_unlink(group);
    } else {
        crate::group::unlink_socket(group, s);
    }
}

fn push_closed(s: *mut SocketHeader, loop_: *mut Loop) {
    let head = with_loop_data(loop_, |ld| ld.closed_head);
    with_socket(s, |h| h.next = head);
    with_loop_data(loop_, |ld| ld.closed_head = s);
}

// ── close / detach (R3.15-R3.18; contracts C1-C6, C12) ───────────────────────

/// `us_internal_socket_close_raw` with an enum code (self-initiated closes;
/// group.rs / TLS entry points use this form).
pub(crate) fn close_raw(s: *mut SocketHeader, code: CloseCode, reason: *mut c_void) {
    close_raw_errno(s, code as c_int, reason);
}

/// `us_internal_socket_close_raw` (socket.c:263-337), exact 10-step order.
/// `code`: 0..2 = CloseCode, >2 = real errno (contract C3).
pub(crate) fn close_raw_errno(s: *mut SocketHeader, code: c_int, reason: *mut c_void) {
    // Step 0 (§1.4): a JS callback inside BoringSSL destroyed this socket —
    // defer to the SSL driver's epilogue, preserving the close code.
    if let Some(t) = tls_state(s) {
        if deref_mut(t).request_defer_close(CloseCode::from_c(code)) {
            // An errno code deferred here would replay as `normal` (a peer
            // error demoted to self-initiated) — see CloseCode::from_c.
            debug_assert!((0..=2).contains(&code), "errno close code {code} deferred");
            return;
        }
    }
    if with_socket(s, |h| h.is_closed()) {
        return;
    }
    let loop_ = socket_loop(s);
    unlink_for_death(s, loop_); // step 2
    poll_stop_for_close(s, loop_); // step 3
    // steps 4-5: SO_LINGER{1,0} RST for CONNECTION_RESET, then close(2).
    io::close(with_socket(s, |h| h.fd), code == CloseCode::failure as c_int);
    with_socket(s, |h| h.flags.set(SocketFlags::IS_CLOSED, true)); // step 6
    // Step 7 (C1): a never-opened connect (SEMI_SOCKET) gets NO on_close —
    // its owner is notified via on_connect_error instead (OQ-10 equality).
    if with_socket(s, |h| h.p.kind_bits()) != PollType::SemiSocket as u8 {
        // TLS §5.3: user on_close first (ALPN/cert still inspectable) — the
        // SSL is freed in step 8, after the dispatch.
        dispatch::dispatch_close(s, code, reason);
    } else {
        // Silent SEMI_SOCKET close: no callback, but core's owner ext ref is
        // still released exactly once (safe-protocol.md terminal contract).
        dispatch::release_owner_on_silent_terminal(s);
    }
    // Step 8: idempotent SSL free (no-op for plain / already detached).
    if let Some(t) = tls_state(s) {
        deref_mut(t).detach();
    }
    push_closed(s, loop_); // step 9 — freed at the outermost tick postlude (C6)
}

/// `us_socket_detach` (R3.18): close bookkeeping WITHOUT closing the fd,
/// without SO_LINGER and without on_close; fd ownership passes to the caller.
pub(crate) fn socket_detach(s: *mut SocketHeader) {
    if with_socket(s, |h| h.is_closed()) {
        return;
    }
    let loop_ = socket_loop(s);
    unlink_for_death(s, loop_);
    poll_stop_on(s, loop_);
    // IS_CLOSED before the owner release (close_raw step-6 ordering): the
    // release may run the owner's destructor, and a re-entrant close must
    // see the socket already closed (C6 idempotence).
    with_socket(s, |h| h.flags.set(SocketFlags::IS_CLOSED, true));
    // Terminal without on_close: release core's owner ext ref exactly once.
    dispatch::release_owner_on_silent_terminal(s);
    if let Some(t) = tls_state(s) {
        deref_mut(t).detach();
    }
    push_closed(s, loop_);
}

/// R6.10 step 2: direct fd teardown of a happy-eyeballs attempt — no
/// dispatch, no linger, real poll_stop.
pub(crate) fn teardown_connecting_attempt(s: *mut SocketHeader) {
    if with_socket(s, |h| h.is_closed()) {
        return;
    }
    let loop_ = socket_loop(s);
    crate::group::unlink_socket(with_socket(s, |h| h.group), s);
    poll_stop_on(s, loop_);
    io::close(with_socket(s, |h| h.fd), false);
    push_closed(s, loop_);
    with_socket(s, |h| h.flags.set(SocketFlags::IS_CLOSED, true));
}

/// `us_socket_close` (R3.16): TLS routes to the graceful §5.2 close.
pub(crate) fn socket_close(s: *mut SocketHeader, code: CloseCode, reason: *mut c_void) {
    if tls_state(s).is_some() && !with_socket(s, |h| h.is_closed()) {
        tls_close(s, code, reason);
    } else {
        close_raw(s, code, reason);
    }
}

/// `us_internal_ssl_close` (tls-semantics §5.2) composed over TlsState.
fn tls_close(s: *mut SocketHeader, code: CloseCode, reason: *mut c_void) {
    let Some(t) = tls_state(s) else {
        close_raw(s, code, reason);
        return;
    };
    // §1.4 in-use deferral (releases the spill inside).
    if deref_mut(t).request_defer_close(code) {
        return;
    }
    // node `_handle.close()`: spilled ciphertext was reported written — defer
    // (at most once) until it drains.
    if code == CloseCode::fast_shutdown && reason.is_null() {
        if deref_mut(t).close_deferred_by_spill(s) {
            return;
        }
    }
    ffi::with_ctl(deref_mut(t).ctl, |c| c.release_pending());
    // SEMI_SOCKET (eager fast-path attach, never connected) or gone: raw
    // close — on_handshake(0) after onConnectError would land in torn-down JS.
    if tls_gone(s) || with_socket(s, |h| h.p.kind_bits()) == PollType::SemiSocket as u8 {
        close_raw(s, code, reason);
        return;
    }
    TlsState::handshake(t, s); // drive a final step
    if tls_gone(s) {
        return;
    }
    if deref_mut(t).handshake_state != HandshakeState::Completed {
        TlsState::trigger_handshake_econnreset(t, s);
        if tls_gone(s) {
            return;
        }
    }
    if code != CloseCode::normal {
        // Forceful: best-effort close_notify then raw-close now (the destroy
        // path unrefs immediately after; deferring would orphan the socket).
        let _ = deref_mut(t).handle_shutdown(s, true);
        if !with_socket(s, |h| h.is_closed()) {
            close_raw(s, code, reason);
        }
    } else if deref_mut(t).handle_shutdown(s, false) {
        if !with_socket(s, |h| h.is_closed()) {
            close_raw(s, CloseCode::normal, reason);
        }
    }
    // else: close_notify sent, fd close deferred until the peer replies —
    // on_end / ZERO_RETURN re-enters with SENT_SHUTDOWN set (§5.2).
}

// ── open / shutdown ───────────────────────────────────────────────────────────

/// `us_socket_open` (R3.4): dispatch on_open, then kick the TLS handshake
/// immediately (some peers stall waiting for ClientHello).
pub(crate) fn socket_open(s: *mut SocketHeader, is_client: bool, ip: &[u8]) {
    dispatch::dispatch_open(s, is_client, ip);
    if tls_gone(s) {
        return;
    }
    if let Some(t) = tls_state(s) {
        TlsState::handshake(t, s);
    }
}

/// `us_socket_shutdown` (R3.19): TLS close_notify rules / TCP FIN. Raw entry
/// so callers need not hold a `&mut` across the dispatch it can run (C17).
pub(crate) fn socket_shutdown(s: *mut SocketHeader) {
    match tls_state(s) {
        Some(t) => deref_mut(t).shutdown(s, CloseCode::normal),
        None => raw_shutdown(s),
    }
}

/// Resume a handshake suspended by an async SNI callback; consumes the owned
/// `ssl_ctx` ref (null = fall through to default); `error` aborts.
pub(crate) fn socket_sni_resolve(s: *mut SocketHeader, ctx: *mut SslCtx, error: bool) {
    match tls_state(s) {
        Some(t) => crate::tls::state::sni_resolve(t, s, ctx, error),
        None => {
            // Socket is no longer TLS; release the handed-in reference.
            if !ctx.is_null() {
                crate::tls::context::ssl_ctx_unref(ctx);
            }
        }
    }
}

/// `us_internal_socket_raw_shutdown` (R3.19): FIN + stop polling writable,
/// keep reading.
pub(crate) fn raw_shutdown(s: *mut SocketHeader) {
    let already = with_socket(s, |h| {
        h.is_closed() || h.flags.get(SocketFlags::IS_SHUT_DOWN)
    });
    if already {
        return;
    }
    with_socket(s, |h| {
        h.flags.set(SocketFlags::IS_SHUT_DOWN, true);
        h.p.set_kind(PollType::SocketShutDown);
    });
    let ev = with_socket(s, |h| Events(h.p.events().0 & Events::READABLE.0));
    poll_change(s, ev);
    io::shutdown(with_socket(s, |h| h.fd));
}

// ── connect promotion (R6.9 `us_internal_socket_after_open`) ─────────────────

/// Connecting-socket promotion after a non-blocking connect completes.
/// `error` 0 = success; nonzero = SO_ERROR fetched by the dispatcher (R6.8).
pub(crate) fn on_connect(s: *mut SocketHeader, cs: *mut ConnectingSocket, error: c_int) {
    // R6.9 Windows pre-step: an apparent success may have already been reset
    // in the AFD race window; probe before promoting (context.c:749-765).
    #[cfg(windows)]
    let error = if error == 0 {
        io::connect_probe(with_socket(s, |h| h.fd))
    } else {
        error
    };
    if error != 0 {
        if cs.is_null() {
            // Direct connect: the handler is expected to close the socket.
            dispatch::dispatch_connect_error(s, error);
        } else {
            crate::connecting::attempt_failed(cs, s);
        }
        return;
    }
    // Success: absolute R, nodelay again, promote type, disarm timeout.
    poll_change(s, Events::READABLE);
    io::nodelay(with_socket(s, |h| h.fd), true);
    with_socket(s, |h| {
        h.p.set_kind(PollType::Socket);
        h.timeout = 255;
    });
    if !cs.is_null() {
        let ssl_ctx = crate::connecting::promote_winner(cs, s);
        if !ssl_ctx.is_null() {
            let tls = TlsState::attach(s, ssl_ctx, true, None);
            with_socket(s, |h| h.transport = Transport::Tls(tls));
        }
        crate::connecting::finish_promotion(cs);
        with_socket(s, |h| h.connect_state = ptr::null_mut());
    }
    socket_open(s, true, &[]);
}

// ── established-socket event dispatch (R3.22; loop.c:544-800) ────────────────

/// Combined SOCKET / SOCKET_SHUT_DOWN readiness dispatch. Entry from the
/// backend's ready-poll switch; `events` are already masked to the poll's
/// believed registration (R1.18).
pub(crate) fn on_socket_poll_ready(
    s: *mut SocketHeader,
    error: bool,
    mut eof: bool,
    events: Events,
) {
    let loop_ = socket_loop(s);

    // (b) WRITABLE (only when not error).
    if events.contains(Events::WRITABLE) && !error {
        with_socket(s, |h| {
            h.flags.set(SocketFlags::LAST_WRITE_FAILED, false);
            // kqueue EVFILT_WRITE is one-shot: the kernel filter is gone
            // after delivery; clear POLLING_OUT, preserving POLLING_IN from
            // the poll's own state (R2.13).
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            {
                let keep = Events(h.p.events().0 & Events::READABLE.0);
                h.p.set_polling(keep);
            }
        });
        match tls_state(s) {
            Some(t) => {
                if TlsState::on_writable(t, s, loop_) {
                    dispatch::dispatch_writable(s);
                }
            }
            None => dispatch::dispatch_writable(s),
        }
        if with_socket(s, |h| h.is_closed()) {
            return;
        }
        if !with_socket(s, |h| h.flags.get(SocketFlags::LAST_WRITE_FAILED)) || is_shut_down_full(s)
        {
            let ev = with_socket(s, |h| Events(h.p.events().0 & Events::READABLE.0));
            poll_change_on(s, loop_, ev);
        } else {
            // kqueue one-shot writable needs re-registration.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            {
                let ev = with_socket(s, |h| h.p.events() | Events::WRITABLE);
                poll_change_on(s, loop_, ev);
            }
        }
    }

    // (c) READABLE.
    if events.contains(Events::READABLE) {
        // Low-prio gate (R1.24): only TLS sockets mid-handshake are parked.
        let low_prio = match tls_state(s) {
            Some(t) => deref_mut(t).is_low_prio(),
            None => false,
        };
        if low_prio {
            let state = with_socket(s, |h| h.low_prio_state);
            if state == 2 {
                // Was parked; process one readable dispatch now.
                with_socket(s, |h| h.low_prio_state = 0);
            } else if with_loop_data(loop_, |ld| ld.low_prio_budget) > 0 {
                with_loop_data(loop_, |ld| ld.low_prio_budget -= 1);
            } else {
                let ev = with_socket(s, |h| Events(h.p.events().0 & Events::WRITABLE.0));
                poll_change_on(s, loop_, ev);
                // Already parked: a writable dispatch re-enabled READABLE
                // without knowing about the queue; leave it where it is.
                if state == 1 {
                    return;
                }
                let group = with_socket(s, |h| h.group);
                // Bump BEFORE unlinking so maybe_unlink still sees the group
                // as non-empty (loop.c:613-620).
                with_group(group, |g| g.low_prio_count += 1);
                crate::group::unlink_socket(group, s);
                // LIFO push onto the loop's low-prio queue (prev/next reused).
                let head = with_loop_data(loop_, |ld| ld.low_prio_head);
                with_socket(s, |h| {
                    h.prev = ptr::null_mut();
                    h.next = head;
                });
                if !head.is_null() {
                    with_socket(head, |h| h.prev = s);
                }
                with_loop_data(loop_, |ld| ld.low_prio_head = s);
                with_socket(s, |h| h.low_prio_state = 1);
                // C `break`: the eof/error tail is skipped for this event.
                return;
            }
        }

        let mut repeat_recv_count: usize = 0;
        loop {
            let fd = with_socket(s, |h| h.fd);
            #[cfg(not(windows))]
            let mut received_fd: Option<LIBUS_SOCKET_DESCRIPTOR> = None;
            #[cfg(windows)]
            let received_fd: Option<LIBUS_SOCKET_DESCRIPTOR> = None;
            #[cfg(not(windows))]
            let n: isize = if with_socket(s, |h| h.flags.get(SocketFlags::IS_IPC)) {
                let (len, f) = io::recv_with_fd(fd, ffi::loop_recv_area(loop_));
                received_fd = f;
                len
            } else {
                io::recv(fd, ffi::loop_recv_area(loop_))
            };
            #[cfg(windows)]
            let n: isize = io::recv(fd, ffi::loop_recv_area(loop_));

            if n > 0 {
                // IPC: dispatch the passed fd FIRST, then the same bytes.
                if let Some(passed) = received_fd {
                    dispatch::dispatch_fd(s, passed as c_int);
                    if with_socket(s, |h| h.is_closed()) {
                        break;
                    }
                }
                let len = n as usize;
                match tls_state(s) {
                    Some(t) => {
                        let data = &ffi::loop_recv_area(loop_)[..len];
                        TlsState::read(t, s, loop_, data);
                    }
                    None => {
                        let data = &mut ffi::loop_recv_area(loop_)[..len];
                        dispatch::dispatch_data(s, data);
                    }
                }
                // Repeat-read heuristic (POSIX, loop.c:691-713).
                #[cfg(not(windows))]
                {
                    let alive = with_socket(s, |h| {
                        !h.is_closed() && !h.flags.get(SocketFlags::IS_PAUSED)
                    });
                    let busy = crate::unsafe_core::poll_access::num_ready_polls(loop_);
                    if alive
                        && len >= LIBUS_RECV_BUFFER_LENGTH - 24 * 1024
                        && len <= LIBUS_RECV_BUFFER_LENGTH
                        && (error || busy < 25)
                    {
                        repeat_recv_count += usize::from(!error);
                        // Starvation guard: at most 10 repeats on a busy loop.
                        if !(repeat_recv_count > 10 && busy > 2) {
                            continue;
                        }
                    }
                }
                // Windows AFD_POLL_ABORT race: probe recv exactly once more.
                #[cfg(windows)]
                {
                    let alive = with_socket(s, |h| {
                        !h.is_closed() && !h.flags.get(SocketFlags::IS_PAUSED)
                    });
                    let first = repeat_recv_count == 0;
                    repeat_recv_count += 1;
                    if alive && first {
                        continue;
                    }
                }
                break;
            } else if n == 0 {
                eof = true; // handle EOF in the same place below
                break;
            } else if !is_would_block(n) {
                // Peer-initiated TCP error (RST etc.): straight raw-close —
                // routing through the TLS-graceful path would fire
                // on_handshake for a passive close (loop.c:736-748).
                close_raw_errno(s, (-n) as c_int, ptr::null_mut());
                return;
            } else {
                break;
            }
        }
    }

    // (d) EOF (loop.c:755-784).
    if eof {
        if with_socket(s, |h| h.is_closed()) {
            return; // no on_end after close
        }
        if is_shut_down_full(s) {
            // We sent FIN first; got FIN back.
            close_raw(s, CloseCode::normal, ptr::null_mut());
            return;
        }
        if with_socket(s, |h| h.flags.get(SocketFlags::ALLOW_HALF_OPEN)) {
            // ABSOLUTE event set: stop readable, force-keep writable so a
            // same-tick queued write still flushes (loop.c:765-775).
            poll_change_on(s, loop_, Events::WRITABLE);
            tls_aware_on_end(s);
        } else {
            tls_aware_on_end(s);
            if !with_socket(s, |h| h.is_closed()) {
                close_raw(s, CloseCode::normal, ptr::null_mut());
            }
            return;
        }
    }

    // (e) ERROR (loop.c:786-799): fetch the real errno; 0..2 would collide
    // with the CloseCode enum JS filters as self-initiated.
    if error && !with_socket(s, |h| h.is_closed()) {
        let so_error = io::so_error(with_socket(s, |h| h.fd));
        let code = if so_error > 2 { so_error } else { ECONNRESET_ERRNO };
        close_raw_errno(s, code, ptr::null_mut());
    }
}

/// eof routing: TLS = `us_internal_ssl_on_end` (§5.3 — the peer's write side
/// is gone, no close_notify reply is coming: send ours best-effort and
/// raw-close CLEAN); plain = consumer on_end.
fn tls_aware_on_end(s: *mut SocketHeader) {
    if tls_state(s).is_some() {
        tls_close(s, CloseCode::normal, ptr::null_mut());
        if !with_socket(s, |h| h.is_closed()) {
            close_raw(s, CloseCode::normal, ptr::null_mut());
        }
    } else {
        dispatch::dispatch_end(s);
    }
}

// ── thin loop-facing wrappers ─────────────────────────────────────────────────

pub(crate) fn on_readable(s: *mut SocketHeader) {
    on_socket_poll_ready(s, false, false, Events::READABLE);
}

pub(crate) fn on_writable(s: *mut SocketHeader) {
    on_socket_poll_ready(s, false, false, Events::WRITABLE);
}

pub(crate) fn on_end(s: *mut SocketHeader) {
    on_socket_poll_ready(s, false, true, Events::NONE);
}

// ── handle-facing methods ─────────────────────────────────────────────────────

impl SocketHeader {
    // ── lifecycle ───────────────────────────────────────────────────────────

    /// Fire the open path / kick TLS accept-connect.
    pub fn open(&mut self, is_client: bool, ip_addr: Option<&[u8]>) {
        let s: *mut Self = self;
        socket_open(s, is_client, ip_addr.unwrap_or(&[]));
    }

    /// `us_socket_pause` (R3.23): keep only writable armed.
    pub fn pause(&mut self) {
        if self.flags.get(SocketFlags::IS_PAUSED) || self.is_closed() {
            return;
        }
        let s: *mut Self = self;
        poll_change(s, Events::WRITABLE);
        header_mut(s).flags.set(SocketFlags::IS_PAUSED, true);
    }

    /// `us_socket_resume` (R3.23). NOTE: unconditionally arms W even with no
    /// write pending; the next writable dispatch disarms it (R3.22b).
    pub fn resume(&mut self) {
        if !self.flags.get(SocketFlags::IS_PAUSED) {
            return;
        }
        self.flags.set(SocketFlags::IS_PAUSED, false);
        if self.is_closed() {
            return;
        }
        let s: *mut Self = self;
        if is_shut_down_full(s) {
            poll_change(s, Events::READABLE);
        } else {
            poll_change(s, Events::READABLE | Events::WRITABLE);
        }
    }

    /// Close with semantics per `CloseCode` (contracts C1-C6, C12).
    pub fn close(&mut self, code: CloseCode) {
        let s: *mut Self = self;
        socket_close(s, code, ptr::null_mut());
    }

    /// Write-side shutdown (TLS close_notify rules / TCP FIN).
    pub fn shutdown(&mut self) {
        socket_shutdown(self);
    }

    /// shutdown(2) SHUT_RD — idempotent, no state change (R3.20).
    pub fn shutdown_read(&mut self) {
        io::shutdown_read(self.fd);
    }

    /// `us_socket_detach`: releases everything except the fd, which the
    /// caller now owns (never dispatches on_close).
    pub fn detach_fd(&mut self) -> Fd {
        let fd = self.get_fd();
        let s: *mut Self = self;
        socket_detach(s);
        fd
    }

    // ── state ───────────────────────────────────────────────────────────────

    pub fn is_closed(&self) -> bool {
        self.flags.get(SocketFlags::IS_CLOSED)
    }

    /// `us_socket_is_shut_down` (R3.21, socket.c:602): TLS-aware — for TLS
    /// sockets ssl==NULL, a fatal SSL error or SSL SENT_SHUTDOWN also count
    /// (openssl.c:2021-2026). Raw-bit query: [`Self::is_shut_down_raw`].
    pub fn is_shutdown(&self) -> bool {
        if self.flags.get(SocketFlags::IS_SHUT_DOWN) {
            return true;
        }
        match &self.transport {
            Transport::Tls(t) => {
                t.ssl.is_null()
                    || ffi::with_ctl(t.ctl, |c| c.fatal)
                    || ffi::ssl_get_shutdown(t.ssl).0
            }
            Transport::Plain => false,
        }
    }

    /// Raw TCP FIN-sent bit only (C `POLL_TYPE_SOCKET_SHUT_DOWN` probe); the
    /// raw write gates (R4.4/R4.5) must use this, NOT the TLS-aware query.
    pub(crate) fn is_shut_down_raw(&self) -> bool {
        self.flags.get(SocketFlags::IS_SHUT_DOWN)
    }

    pub fn is_tls(&self) -> bool {
        matches!(self.transport, Transport::Tls(_))
    }

    /// `poll type != SEMI_SOCKET` (R3.21).
    pub fn is_established(&self) -> bool {
        self.p.kind_bits() != PollType::SemiSocket as u8
    }

    /// SO_ERROR; falls back to errno if getsockopt itself fails (R3.22e).
    pub fn get_error(&self) -> i32 {
        io::so_error(self.fd)
    }

    pub fn get_verify_error(&self) -> us_bun_verify_error_t {
        match &self.transport {
            Transport::Tls(t) => t.verify_error(),
            Transport::Plain => us_bun_verify_error_t::default(),
        }
    }

    // ── io (delegates to write.rs — core-semantics §4 / C7) ─────────────────

    /// Write that also reports a fatal non-EWOULDBLOCK send error (node:net).
    pub fn write_check_error(&mut self, data: &[u8]) -> (i32, bool) {
        crate::write::write_check_error(self, data)
    }

    pub fn write(&mut self, data: &[u8]) -> i32 {
        crate::write::write(self, data)
    }

    /// Write + SCM_RIGHTS fd pass (SpawnIpc). C14.
    #[cfg(not(windows))]
    pub fn write_fd(&mut self, data: &[u8], file_descriptor: Fd) -> i32 {
        crate::write::write_fd(self, data, file_descriptor)
    }

    #[cfg(windows)]
    pub fn write_fd(&mut self, _data: &[u8], _file_descriptor: Fd) -> i32 {
        unreachable!("us_socket_t::write_fd is not implemented on Windows")
    }

    /// Two-buffer write (frame header + payload, no copy).
    pub fn write2(&mut self, first: &[u8], second: &[u8]) -> i32 {
        crate::write::write2(self, first, second)
    }

    /// Vectored raw write; plain-TCP only (bypasses TLS framing).
    pub fn raw_writev(&mut self, iov: &[UsIoVec]) -> i32 {
        crate::write::raw_writev(self, iov)
    }

    /// Bypass TLS — raw bytes to the fd even if `is_tls()`.
    pub fn raw_write(&mut self, data: &[u8]) -> i32 {
        crate::write::raw_write(self, data)
    }

    pub fn flush(&mut self) {
        crate::write::flush(self);
    }

    pub fn send_file_needs_more(&mut self) {
        crate::write::sendfile_needs_more(self);
    }

    // ── options ─────────────────────────────────────────────────────────────

    /// Seconds wheel (R5.2): 0 clears; else ceil(seconds/4) ticks from the
    /// group's short clock, mod 240 (longer values alias).
    pub fn set_timeout(&mut self, seconds: u32) {
        if seconds == 0 {
            self.timeout = 255;
            return;
        }
        let ts = with_group(self.group, |g| g.timestamp);
        self.timeout = ((u32::from(ts).wrapping_add(seconds.wrapping_add(3) >> 2)) % 240) as u8;
    }

    /// Minute wheel (R5.3).
    pub fn set_long_timeout(&mut self, minutes: u32) {
        if minutes == 0 {
            self.long_timeout = 255;
            return;
        }
        let ts = with_group(self.group, |g| g.long_timestamp);
        self.long_timeout = ((u32::from(ts) + minutes) % 240) as u8;
    }

    /// Gated on the TLS-aware shutdown state (socket.c:697-701).
    pub fn set_nodelay(&mut self, enabled: bool) {
        if !self.is_shutdown() {
            io::nodelay(self.fd, enabled);
        }
    }

    /// 0 success; positive errno; -1 for enabled with delay 0 (verbatim C).
    /// No-op 0 on shut-down sockets (socket.c:729-734).
    pub fn set_keepalive(&mut self, enabled: bool, delay: u32) -> i32 {
        if self.is_shutdown() {
            return 0;
        }
        io::keepalive(self.fd, enabled, delay)
    }

    /// IP TOS / traffic class; negative errno on failure. -EBADF when closed
    /// (socket.c:708-722) — the fd number may already be recycled.
    pub fn set_tos(&mut self, tos: i32) -> i32 {
        if self.is_closed() {
            return NEG_EBADF;
        }
        io::set_tos(self.fd, tos)
    }

    pub fn get_tos(&self) -> i32 {
        if self.is_closed() {
            return NEG_EBADF;
        }
        io::get_tos(self.fd)
    }

    // ── identity ────────────────────────────────────────────────────────────

    /// getsockname port; -1 on failure (R3.25, nothing cached).
    pub fn local_port(&self) -> i32 {
        io::local_addr(self.fd).map_or(-1, |a| a.port())
    }

    pub fn remote_port(&self) -> i32 {
        io::remote_addr(self.fd).map_or(-1, |a| a.port())
    }

    /// Returned slice is a view into `buf` (raw 4/16 address bytes).
    /// Verbatim C quirk (R3.25): syscall failure or a too-small buffer yield
    /// an EMPTY slice, never an error — the Err arm exists for surface parity.
    pub fn local_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        Ok(copy_addr(io::local_addr(self.fd), buf))
    }

    /// Returned slice is a view into `buf`.
    pub fn remote_address<'a>(&self, buf: &'a mut [u8]) -> Result<&'a [u8], bun_core::Error> {
        Ok(copy_addr(io::remote_addr(self.fd), buf))
    }

    pub fn get_fd(&self) -> Fd {
        #[cfg(windows)]
        {
            Fd::from_system(self.fd as *mut c_void)
        }
        #[cfg(not(windows))]
        {
            Fd::from_native(self.fd)
        }
    }

    /// node `_handle` shape: `SSL*` for TLS, fd-as-pointer for TCP. A
    /// detached SSL (post-close) falls through to the fd (socket.c:456-461).
    pub fn get_native_handle(&self) -> Option<*mut c_void> {
        let p: *mut c_void = match &self.transport {
            Transport::Tls(t) if !t.ssl.is_null() => t.ssl.cast(),
            _ => self.fd as usize as *mut c_void,
        };
        if p.is_null() { None } else { Some(p) }
    }

    /// `SSL*` if TLS else `None`.
    pub fn ssl(&mut self) -> Option<&mut SSL> {
        match &self.transport {
            Transport::Tls(t) if !t.ssl.is_null() => Some(deref_mut(t.ssl)),
            _ => None,
        }
    }

    pub fn kind(&self) -> SocketKind {
        self.kind
    }

    /// Re-stamp the dispatch tag in place (Listener.onCreate → BunSocket).
    pub fn set_kind(&mut self, kind: SocketKind) {
        self.kind = kind;
    }

    /// Typed ext access. Storage rule mirrors `unsafe_core::ext::downcast`:
    /// group-vtable kinds (uWS/Dynamic) use the ext-area pointer, static Rust
    /// kinds the 8-byte ext word itself.
    pub fn ext<T>(&mut self) -> &mut T {
        debug_assert!(
            dispatch::uses_group_vtable(self.kind)
                || (core::mem::size_of::<T>() <= core::mem::size_of::<*mut c_void>()
                    && core::mem::align_of::<T>() <= core::mem::align_of::<*mut c_void>()),
            "Rust-kind ext type does not fit the 8-byte ext word"
        );
        deref_mut(self.ext_ptr().cast::<T>())
    }

    /// Same storage predicate as `ext::downcast_raw`
    /// (`dispatch::uses_group_vtable`) — Dynamic sockets carry an ext area.
    pub fn ext_ptr(&mut self) -> *mut u8 {
        crate::unsafe_core::ext::ext_ptr_raw(self)
    }

    pub fn group(&mut self) -> &mut SocketGroup {
        deref_mut(self.group)
    }

    pub fn raw_group(&self) -> *mut SocketGroup {
        self.group
    }

    // ── adoption / TLS attach ───────────────────────────────────────────────

    /// Move this socket to a new group/kind. In-place (api.md §Strategy 3):
    /// `Some` is always `self`; `None` = refused (closed/shut-down, R3.5).
    /// Ext capacity was fixed at creation — never realloc'd; `new_ext` is
    /// release-checked against the slot's inline capacity (P0b family max).
    pub fn adopt(
        &mut self,
        g: &mut SocketGroup,
        k: SocketKind,
        old_ext: i32,
        new_ext: i32,
    ) -> Option<NonNull<us_socket_t>> {
        let s: *mut Self = self;
        let _ = old_ext;
        assert_adopt_ext_fits(s, k, new_ext);
        debug_assert!(
            dispatch::uses_group_vtable(self.kind) == dispatch::uses_group_vtable(k),
            "adoption across ext families (capacity fixed at creation)"
        );
        // Fail closed where `group::adopt_socket` would silently refuse
        // (R3.5 precondition): a `Some` return with the old kind's vtable
        // still stamped would be a type-confusion hazard (C10).
        if self.is_closed() || is_shut_down_full(s) {
            return None;
        }
        // R3.5 step 2 (OQ-7): C restamps a live connect_state's group/kind on
        // every adopt; unreachable here — after_open nulls connect_state
        // before any dispatch that could adopt.
        debug_assert!(self.connect_state.is_null(), "adopt with live connect_state");
        crate::group::adopt_socket(s, g, k);
        NonNull::new(s)
    }

    /// `adopt` + attach a fresh `SSL*` from `ssl_ctx`. Does NOT kick the
    /// handshake — caller repoints ext then calls `start_tls_handshake`
    /// (C10, tls-semantics §6.1). Refuses closed sockets, and already-TLS
    /// ones: replacing the transport would SSL_free a `TlsState` whose
    /// `&mut` frames may still be on the stack (§1.4 deferral bypass).
    pub fn adopt_tls(
        &mut self,
        g: &mut SocketGroup,
        k: SocketKind,
        ssl_ctx: &mut SslCtx,
        sni: Option<&core::ffi::CStr>,
        is_client: bool,
        old_ext: i32,
        new_ext: i32,
    ) -> Option<NonNull<us_socket_t>> {
        if self.is_closed() || self.is_tls() {
            return None;
        }
        let _ = old_ext;
        let s: *mut Self = self;
        assert_adopt_ext_fits(s, k, new_ext);
        crate::group::adopt_tls_socket(s, g, k, ptr::from_mut(ssl_ctx), sni, is_client);
        // §6.1: adopt → attach → resume (readable was likely disabled by the
        // pre-upgrade pause).
        header_mut(s).resume();
        NonNull::new(s)
    }

    /// Tee inbound ciphertext to the ssl_raw_tap dispatch before SSL_read.
    pub fn set_ssl_raw_tap(&mut self, enabled: bool) {
        if let Transport::Tls(t) = &mut self.transport {
            t.raw_tap = enabled;
        }
    }

    /// Resume a handshake suspended by an async SNI callback; consumes the
    /// owned `ssl_ctx` ref (null = fall through to default); `error` aborts.
    pub fn sni_resolve(&mut self, ctx: *mut SslCtx, error: bool) {
        socket_sni_resolve(self, ctx, error);
    }
}

/// P0b family-max enforcement: inline ext capacity is fixed at creation, so
/// an adopt declaring more ext bytes than the slot carries would overwrite
/// the ADJACENT slab slot — fail loudly instead of corrupting cross-socket.
fn assert_adopt_ext_fits(s: *mut us_socket_t, k: SocketKind, new_ext: i32) {
    if !dispatch::uses_group_vtable(k) || new_ext <= 0 {
        return;
    }
    let nn = NonNull::new(s).expect("null socket in adopt");
    let cap = crate::unsafe_core::slab::inline_ext_capacity_of(nn);
    // Capacity-0 slots keep the pre-inline area-pointer word (see
    // ext::downcast_raw) — no inline bound exists to enforce.
    assert!(
        cap == 0 || new_ext as u32 <= cap,
        "us_socket_adopt ext size ({new_ext}) exceeds the slot's inline capacity ({cap}); \
the creation site must register the adoption family's max ext size"
    );
}

/// Send ClientHello; split from `adopt_tls` so ext can be repointed first.
/// No-op on a closed (or non-TLS) socket, like C us_socket_start_tls_handshake.
/// Raw entry: the handshake dispatches consumer callbacks (C17).
pub(crate) fn socket_start_tls_handshake(s: *mut SocketHeader) {
    if header_mut(s).is_closed() {
        return;
    }
    if let Some(t) = tls_state(s) {
        TlsState::handshake(t, s);
    }
}

/// Feed already-read bytes through the TLS decrypt path (chunked at i32;
/// stops if the socket closes mid-feed). Raw entry: dispatches decrypted
/// on_data / on_handshake (C17).
pub(crate) fn socket_tls_feed(s: *mut SocketHeader, data: &[u8]) {
    let loop_ = socket_loop(s);
    for chunk in data.chunks(i32::MAX as usize) {
        let Some(t) = tls_state(s) else { return };
        if header_mut(s).is_closed() {
            return;
        }
        TlsState::read(t, s, loop_, chunk);
    }
}

/// Copy raw 4/16 address bytes into the caller buffer; empty on failure or
/// too-small buffer (verbatim `us_socket_local_address` semantics).
fn copy_addr<'a>(addr: Option<io::BsdAddr>, buf: &'a mut [u8]) -> &'a [u8] {
    match addr {
        Some(a) => {
            let ip = a.ip();
            if buf.len() < ip.len() || ip.is_empty() {
                &buf[..0]
            } else {
                buf[..ip.len()].copy_from_slice(ip);
                &buf[..ip.len()]
            }
        }
        None => &buf[..0],
    }
}
