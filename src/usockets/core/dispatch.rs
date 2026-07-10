//! Safe hot-path ready-poll dispatch.
//!
//! Replaces `loop_core::us_internal_dispatch_ready_poll`. Control flow mirrors
//! `packages/bun-usockets/src/loop.c` exactly; the one type-pun lives in
//! [`ReadyPoll::classify`] and everything downstream operates on safe
//! `Socket<'l>` / `&SocketHeader` borrows whose allocation is guaranteed to
//! outlive the tick (freeing is deferred to `free_closed_sockets`).

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::{MaybeUninit, size_of};
use core::ptr::{self, NonNull};

#[cfg(not(windows))]
use crate::bsd::bsd_recvmsg;
use crate::bsd::{
    bsd_accept_socket, bsd_addr_get_ip, bsd_addr_get_ip_length, bsd_close_socket, bsd_recv,
    bsd_recvmmsg, bsd_socket_nodelay, bsd_udp_setup_recvbuf, udp_recvbuf,
};
#[cfg(not(windows))]
use crate::eventing::us_internal_accept_poll_event;
use crate::eventing::{
    LIBUS_SOCKET_READABLE, LIBUS_SOCKET_WRITABLE, us_create_poll, us_poll_change, us_poll_free,
    us_poll_init, us_poll_start_rc, us_socket_get_error,
};
#[cfg(not(windows))]
use crate::types::us_dispatch_fd;
use crate::types::{
    LIBUS_RECV_BUFFER_LENGTH, LIBUS_RECV_BUFFER_PADDING, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN,
    POLL_TYPE_SOCKET, bsd_addr_t, us_dispatch_data, us_dispatch_end, us_dispatch_open,
    us_dispatch_writable, us_listen_socket_t, us_socket_group_t, us_socket_t,
};
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
use crate::types::{POLL_TYPE_KIND_MASK, POLL_TYPE_POLLING_IN};

use super::group::SocketGroup;
use super::loop_::{Loop, LoopTick};
use super::poll::{Poll, PollEvents, PollKind};
use super::socket::{Socket, SocketHeader};
use super::sys::{Fd, last_error, would_block};

// Safe-core wrappers for these are not written yet; borrow the C types.
pub use crate::types::us_internal_callback_t as InternalCallback;
pub use crate::types::us_udp_socket_t as UdpSocket;

// ═══════════════════════════════════════════════════════════════════════════
// Externs still routed through the C ABI (sibling .rs files)
// ═══════════════════════════════════════════════════════════════════════════

unsafe extern "C" {
    fn us_internal_ssl_attach(
        s: *mut us_socket_t,
        ssl_ctx: *mut bun_boringssl_sys::SSL_CTX,
        is_client: c_int,
        sni: *const c_char,
        listener: *mut us_listen_socket_t,
    );
    fn us_internal_ssl_on_open(
        s: *mut us_socket_t,
        is_client: c_int,
        ip: *mut c_char,
        ip_length: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_on_data(
        s: *mut us_socket_t,
        data: *mut c_char,
        len: c_int,
    ) -> *mut us_socket_t;
    fn us_internal_ssl_on_writable(s: *mut us_socket_t) -> *mut us_socket_t;
    fn us_internal_ssl_on_end(s: *mut us_socket_t) -> *mut us_socket_t;
    fn us_internal_ssl_is_low_prio(s: *mut us_socket_t) -> c_int;

    fn us_internal_socket_close_raw(
        s: *mut us_socket_t,
        code: c_int,
        reason: *mut c_void,
    ) -> *mut us_socket_t;
    fn us_internal_socket_after_open(s: *mut us_socket_t, error: c_int);
    fn us_internal_socket_group_link_socket(g: *mut us_socket_group_t, s: *mut us_socket_t);
    fn us_internal_socket_group_unlink_socket(g: *mut us_socket_group_t, s: *mut us_socket_t);
    fn us_socket_is_shut_down(s: *mut us_socket_t) -> c_int;

    fn us_udp_socket_close(s: *mut UdpSocket);
}

// ═══════════════════════════════════════════════════════════════════════════
// Platform constants
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
const ECONNRESET: c_int = libc::ECONNRESET;
/// MSVC `<errno.h>` value (not `WSAECONNRESET`).
#[cfg(windows)]
const ECONNRESET: c_int = 108;

#[cfg(not(windows))]
const RECV_FLAGS: c_int = libc::MSG_DONTWAIT;
/// Winsock `MSG_PUSH_IMMEDIATE` — deliver partial data without waiting for PSH.
#[cfg(windows)]
const RECV_FLAGS: c_int = 0x20;

#[cfg(not(windows))]
const MSG_DONTWAIT: c_int = libc::MSG_DONTWAIT;
#[cfg(windows)]
const MSG_DONTWAIT: c_int = 0;

#[cold]
#[inline(never)]
fn cold() {}
#[inline(always)]
fn unlikely(b: bool) -> bool {
    if b {
        cold();
    }
    b
}

// ═══════════════════════════════════════════════════════════════════════════
// ReadyPoll — the one type-pun from `NonNull<Poll>` to its container
// ═══════════════════════════════════════════════════════════════════════════

/// A ready poll classified by its `poll_type` kind bits into the concrete
/// handle that embeds it. `Socket<'l>` variants borrow for the tick; the
/// `Callback`/`Udp` containers are not yet `Cell`-wrapped so stay `NonNull`.
pub enum ReadyPoll<'l> {
    /// `POLL_TYPE_SOCKET` / `POLL_TYPE_SOCKET_SHUT_DOWN` — established stream.
    Stream(Socket<'l>),
    /// `POLL_TYPE_SEMI_SOCKET` — connecting (polls W) or listening (polls R).
    Semi(Socket<'l>),
    /// `POLL_TYPE_CALLBACK` — timer / async / eventfd.
    Callback(NonNull<InternalCallback>),
    /// `POLL_TYPE_UDP` — datagram socket.
    Udp(NonNull<UdpSocket>),
}

impl<'l> ReadyPoll<'l> {
    /// Reinterpret `p` as the container selected by its kind bits.
    ///
    /// # Safety
    /// `p` must be a live poll whose `poll_type` kind bits were set by this
    /// crate to match the allocation's actual container, and that container
    /// must remain live for `'l` (i.e. until after `free_closed_sockets`).
    #[inline]
    pub(crate) unsafe fn classify(p: NonNull<Poll>) -> Self {
        // SAFETY: `Poll` is `Cell`-only; shared read of `poll_type` is sound.
        let kind = unsafe { p.as_ref() }.kind();
        match kind {
            PollKind::Socket | PollKind::SocketShutDown => {
                // SAFETY: `Poll` is the first field of `SocketHeader` (const-asserted).
                ReadyPoll::Stream(unsafe { Socket::from_raw(p.cast()) })
            }
            PollKind::SemiSocket => {
                // SAFETY: semi-sockets are `us_socket_t` / `us_listen_socket_t`,
                // both of which start with a `SocketHeader`.
                ReadyPoll::Semi(unsafe { Socket::from_raw(p.cast()) })
            }
            PollKind::Callback => ReadyPoll::Callback(p.cast()),
            PollKind::Udp => ReadyPoll::Udp(p.cast()),
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Thin adapters over the extern-C dispatch / SSL callbacks
// ═══════════════════════════════════════════════════════════════════════════

#[inline(always)]
fn to_c(s: Socket<'_>) -> *mut us_socket_t {
    s.as_raw().as_ptr().cast()
}

/// Wrap a callback's `*mut us_socket_t` return into an `Option<Socket<'l>>`.
/// # Safety
/// Non-null `p` must be live for `'l` (the dispatch contract: freeing is
/// deferred to `free_closed_sockets`).
#[inline(always)]
unsafe fn from_c<'l>(p: *mut us_socket_t) -> Option<Socket<'l>> {
    // SAFETY: caller contract above.
    NonNull::new(p).map(|p| unsafe { Socket::from_raw(p.cast()) })
}

#[inline(always)]
fn has_ssl(s: Socket<'_>) -> bool {
    !s.header().ssl.get().is_null()
}

/// After adoption the old socket is a tombstone whose `prev` points at the
/// relocated one; follow it once.
#[inline(always)]
fn follow_adoption<'l>(s: Option<Socket<'l>>) -> Option<Socket<'l>> {
    let s = s?;
    if s.header().flags.adopted() {
        // SAFETY: `SocketHeader` ≡ `us_socket_t` (const-asserted); `links.prev`
        // occupies the `prev` slot. Adoption guarantees it is live for the tick.
        let prev = unsafe { (*(to_c(s) as *const us_socket_t)).prev };
        if let Some(p) = NonNull::new(prev) {
            // SAFETY: see above.
            return Some(unsafe { Socket::from_raw(p.cast()) });
        }
    }
    Some(s)
}

#[inline]
fn on_writable<'l>(s: Socket<'l>) -> Option<Socket<'l>> {
    // SAFETY: `s` is live; callee may relocate/free — result is the new handle or null.
    unsafe {
        from_c(if has_ssl(s) {
            us_internal_ssl_on_writable(to_c(s))
        } else {
            us_dispatch_writable(to_c(s))
        })
    }
}

#[inline]
fn on_data<'l>(s: Socket<'l>, buf: *mut c_char, len: c_int) -> Option<Socket<'l>> {
    // SAFETY: `s` is live; `buf[..len]` is the loop's recv buffer.
    unsafe {
        from_c(if has_ssl(s) {
            us_internal_ssl_on_data(to_c(s), buf, len)
        } else {
            us_dispatch_data(to_c(s), buf, len)
        })
    }
}

#[inline]
fn on_end<'l>(s: Socket<'l>) -> Option<Socket<'l>> {
    // SAFETY: `s` is live; callee may relocate/free.
    unsafe {
        from_c(if has_ssl(s) {
            us_internal_ssl_on_end(to_c(s))
        } else {
            us_dispatch_end(to_c(s))
        })
    }
}

#[inline]
fn close_raw<'l>(s: Socket<'l>, code: c_int) -> Option<Socket<'l>> {
    // SAFETY: `s` is live; raw-close bypasses SSL on_handshake for passive closes.
    unsafe { from_c(us_internal_socket_close_raw(to_c(s), code, ptr::null_mut())) }
}

#[inline]
fn is_shut_down(s: Socket<'_>) -> bool {
    // SAFETY: `s` is live; SSL has its own shutdown state so this stays extern.
    unsafe { us_socket_is_shut_down(to_c(s)) != 0 }
}

#[inline]
fn socket_error(s: Socket<'_>) -> c_int {
    // SAFETY: `s` is live; reads `SO_ERROR` via getsockopt.
    unsafe { us_socket_get_error(to_c(s)) }
}

#[inline]
fn poll_change(s: Socket<'_>, tick: LoopTick<'_>, events: PollEvents) {
    // SAFETY: `s` and `tick.loop_` are live for the call.
    unsafe { us_poll_change(to_c(s).cast(), tick.as_ptr(), events.raw()) }
}

/// `&SocketGroup` for `s` — sound because every field is `Cell`.
#[inline]
fn group_of<'l>(s: Socket<'l>) -> &'l SocketGroup {
    let g = s.header().group.get();
    debug_assert!(g.is_some());
    // SAFETY: a live non-closed socket always has a live group; its storage
    // outlives the tick and all fields are `Cell`.
    unsafe { g.unwrap_unchecked().as_ref() }
}

#[cfg(not(windows))]
#[inline]
fn num_ready_polls(tick: LoopTick<'_>) -> c_int {
    // SAFETY: `tick` guarantees `loop_` is live; field read only.
    unsafe { (*tick.as_ptr()).num_ready_polls }
}

// ═══════════════════════════════════════════════════════════════════════════
// dispatch_ready — top-level fan-out
// ═══════════════════════════════════════════════════════════════════════════

/// Dispatch one ready poll. `error`/`eof` are the backend's `EPOLLERR`/`HUP`
/// (or kqueue `EV_ERROR`/`EV_EOF`) flags; `events` is the fired direction mask.
pub fn dispatch_ready(
    tick: LoopTick<'_>,
    rp: ReadyPoll<'_>,
    error: bool,
    eof: bool,
    events: PollEvents,
) {
    match rp {
        ReadyPoll::Callback(cb) => dispatch_callback(cb),

        ReadyPoll::Semi(s) => {
            // Connect and listen sockets are both semi-sockets polling for
            // different events. Test the WRITABLE bit (not equality) so a
            // pre-connect write's `poll_change(R|W)` still hits connect-done.
            if s.header().poll.events().writable() {
                // Report the kernel's actual `SO_ERROR` (e.g. ECONNRESET for
                // the completed-then-RST race) instead of the literal flag.
                let mut connect_error = 0;
                if error || eof {
                    connect_error = socket_error(s);
                    if connect_error == 0 {
                        connect_error = ECONNRESET;
                    }
                }
                // SAFETY: `s` is a live connecting `us_socket_t`.
                unsafe { us_internal_socket_after_open(to_c(s), connect_error) };
            } else {
                dispatch_listen(tick, s);
            }
        }

        ReadyPoll::Stream(s) => dispatch_stream(tick, s, error, eof, events),

        ReadyPoll::Udp(u) => dispatch_udp(tick, u, error, events),
    }
}

#[inline]
fn dispatch_callback(cb: NonNull<InternalCallback>) {
    // SAFETY: `cb` is a live `us_internal_callback_t` with `p` as its first
    // field; field reads only — the callback itself is the sole re-entrance.
    unsafe {
        let p = cb.as_ptr();
        if (*p).leave_poll_ready == 0 {
            #[cfg(not(windows))]
            us_internal_accept_poll_event(p.cast());
        }
        let arg = if (*p).cb_expects_the_loop != 0 {
            (*p).loop_ as *mut InternalCallback
        } else {
            p
        };
        if let Some(f) = (*p).cb {
            f(arg);
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// dispatch_stream — writable / readable / EOF / error for an established socket
// ═══════════════════════════════════════════════════════════════════════════

fn dispatch_stream(
    tick: LoopTick<'_>,
    s: Socket<'_>,
    error: bool,
    mut eof: bool,
    events: PollEvents,
) {
    // We only use `s` from here — the poll may be relocated by adoption.
    let mut s = follow_adoption(Some(s));

    if events.writable() && !error {
        let Some(cur) = s else { return };
        cur.header().flags.set_last_write_failed(false);
        #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
        {
            // Kqueue EVFILT_WRITE is one-shot; clear POLLING_OUT to reflect
            // removal. Keep POLLING_IN from the poll's own state, not `events`.
            let poll = &cur.header().poll;
            let pt = poll.poll_type();
            poll.set_poll_type((pt & POLL_TYPE_KIND_MASK) | (pt & POLL_TYPE_POLLING_IN));
        }

        s = follow_adoption(on_writable(cur));

        let Some(cur) = s else { return };
        if cur.is_closed() {
            return;
        }

        // No failed write or we shut down → stop polling writable.
        if !cur.header().flags.last_write_failed() || is_shut_down(cur) {
            poll_change(
                cur,
                tick,
                PollEvents(cur.header().poll.events().raw() & LIBUS_SOCKET_READABLE),
            );
        } else {
            #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
            {
                // Kqueue one-shot writable needs re-registration.
                poll_change(
                    cur,
                    tick,
                    PollEvents(cur.header().poll.events().raw() | LIBUS_SOCKET_WRITABLE),
                );
            }
        }
    }

    if events.readable() {
        let Some(cur) = s else { return };
        // Only the SSL handshake gate ever returns low-prio.
        if has_ssl(cur) && unsafe { us_internal_ssl_is_low_prio(to_c(cur)) } != 0 {
            let flags = &cur.header().flags;
            let data = tick.data();
            match flags.low_prio_state() {
                // Delayed once already — process this iteration.
                2 => flags.set_low_prio_state(0),
                _ if data.low_prio_budget.get() > 0 => {
                    data.low_prio_budget.set(data.low_prio_budget.get() - 1);
                }
                state => {
                    poll_change(
                        cur,
                        tick,
                        PollEvents(cur.header().poll.events().raw() & LIBUS_SOCKET_WRITABLE),
                    );
                    // Already parked: a writable dispatch re-enabled READABLE.
                    // It sits in `low_prio_head`, not `head_sockets` — the
                    // unlink below would cross-wire the two lists. Leave it.
                    if state == 1 {
                        return;
                    }
                    let g = group_of(cur);
                    // Bump before unlinking so `maybe_unlink()` still sees non-empty.
                    g.low_prio_count.set(g.low_prio_count.get() + 1);
                    // SAFETY: `g`/`cur` are live.
                    unsafe {
                        us_internal_socket_group_unlink_socket(
                            NonNull::from(g).as_ptr().cast(),
                            to_c(cur),
                        )
                    };
                    // LIFO — prioritise newer clients under high load.
                    data.low_prio_head.push_front(cur.as_raw());
                    flags.set_low_prio_state(1);
                    return;
                }
            }
        }

        s = recv_loop(tick, cur, error, &mut eof);
    }

    if eof {
        let Some(cur) = s else { return };
        if unlikely(cur.is_closed()) {
            return;
        }
        if is_shut_down(cur) {
            // Got FIN back after sending it.
            close_raw(cur, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN);
            return;
        }
        if cur.header().flags.allow_half_open() {
            // Stop reading but keep writable so a queued `end()` still flushes.
            poll_change(cur, tick, PollEvents::WRITABLE);
            s = on_end(cur);
        } else {
            if let Some(after) = on_end(cur) {
                close_raw(after, LIBUS_SOCKET_CLOSE_CODE_CLEAN_SHUTDOWN);
            }
            return;
        }
    }

    if error {
        let Some(cur) = s else { return };
        // Fetch the real errno; clamp 0..2 which collide with the libus
        // `CloseCode` enum JS filters out as self-initiated.
        let so_err = socket_error(cur);
        close_raw(cur, if so_err > 2 { so_err } else { ECONNRESET });
    }
}

/// The read-into-shared-buffer loop. Returns the (possibly relocated) socket
/// or `None` if it was closed; sets `*eof` when `recv` returned 0.
#[inline]
fn recv_loop<'l>(
    tick: LoopTick<'l>,
    mut s: Socket<'l>,
    #[cfg_attr(windows, allow(unused_variables))] error: bool,
    eof: &mut bool,
) -> Option<Socket<'l>> {
    // SAFETY: `recv_buf` is a `RECV_BUF_LEN`-byte allocation; `PADDING` is in-bounds.
    let recv_buf = unsafe { tick.data().recv_buf.get().add(LIBUS_RECV_BUFFER_PADDING) };
    #[allow(unused_mut)]
    let mut repeat_recv_count: usize = 0;

    loop {
        #[allow(unused_assignments, unused_mut)]
        let mut length: c_int;

        #[cfg(not(windows))]
        if s.header().flags.is_ipc() {
            length = recv_ipc(s, recv_buf);
            // recv_ipc may have dispatched `on_fd` which can close/relocate `s`.
            if length > 0 {
                let maybe = follow_adoption(Some(s));
                match maybe {
                    Some(cur) if !cur.is_closed() => s = cur,
                    _ => return maybe,
                }
            }
        } else {
            // SAFETY: `recv_buf` has `LIBUS_RECV_BUFFER_LENGTH` writable bytes.
            length = unsafe {
                bsd_recv(
                    s.fd().raw(),
                    recv_buf.cast(),
                    LIBUS_RECV_BUFFER_LENGTH as c_int,
                    RECV_FLAGS,
                )
            } as c_int;
        }
        #[cfg(windows)]
        {
            // SAFETY: `recv_buf` has `LIBUS_RECV_BUFFER_LENGTH` writable bytes.
            length = unsafe {
                bsd_recv(
                    s.fd().raw(),
                    recv_buf.cast(),
                    LIBUS_RECV_BUFFER_LENGTH as c_int,
                    RECV_FLAGS,
                )
            } as c_int;
        }

        if length > 0 {
            let next = follow_adoption(on_data(s, recv_buf.cast(), length));

            #[cfg(not(windows))]
            {
                // Keep reading when we filled (nearly) the buffer and either
                // the socket has hung up or the loop isn't busy.
                const BUSY_THRESHOLD: c_int = 25;
                if let Some(cur) = next
                    && length >= (LIBUS_RECV_BUFFER_LENGTH - 24 * 1024) as c_int
                    && length <= LIBUS_RECV_BUFFER_LENGTH as c_int
                    && (error || num_ready_polls(tick) < BUSY_THRESHOLD)
                    && !cur.is_closed()
                    && !cur.header().flags.is_paused()
                {
                    repeat_recv_count += (!error) as usize;
                    // Cap at 10 non-error repeats to avoid starving others.
                    if !(repeat_recv_count > 10 && num_ready_polls(tick) > 2) {
                        s = cur;
                        continue;
                    }
                }
            }
            #[cfg(windows)]
            {
                // AFD_POLL_ABORT isn't level-triggered; a RST landed while on
                // the stack is only surfaced by a second recv probe.
                if let Some(cur) = next
                    && !cur.is_closed()
                    && !cur.header().flags.is_paused()
                    && {
                        let first = repeat_recv_count == 0;
                        repeat_recv_count += 1;
                        first
                    }
                {
                    s = cur;
                    continue;
                }
            }
            return next;
        } else if length == 0 {
            *eof = true;
            return Some(s);
        } else if !would_block(last_error()) {
            // Peer-initiated TCP error (RST etc.) — raw-close so the SSL path
            // doesn't fire `on_handshake` for a passive close.
            close_raw(s, last_error());
            return None;
        }
        return Some(s);
    }
}

/// IPC `recvmsg` path: may carry an `SCM_RIGHTS` fd, dispatched before data.
#[cfg(not(windows))]
#[inline]
fn recv_ipc(s: Socket<'_>, recv_buf: *mut u8) -> c_int {
    // SAFETY: constructs a msghdr on the stack, calls `bsd_recvmsg`, then
    // walks `CMSG_*` only on success. `recv_buf` has `LIBUS_RECV_BUFFER_LENGTH`
    // writable bytes.
    // CMSG_SPACE is a const-eval-safe macro wrapper; the value is fixed at compile time.
    const CMSG_BUF_LEN: usize = unsafe { libc::CMSG_SPACE(size_of::<c_int>() as c_uint) as usize };
    unsafe {
        let mut cmsg_buf = [0u8; CMSG_BUF_LEN];
        let mut iov = libc::iovec {
            iov_base: recv_buf.cast(),
            iov_len: LIBUS_RECV_BUFFER_LENGTH,
        };
        let mut msg: libc::msghdr = core::mem::zeroed();
        msg.msg_iov = &mut iov;
        msg.msg_iovlen = 1 as _;
        msg.msg_controllen = libc::CMSG_LEN(size_of::<c_int>() as c_uint) as _;
        msg.msg_control = cmsg_buf.as_mut_ptr().cast();

        let length = bsd_recvmsg(s.fd().raw(), &mut msg, RECV_FLAGS) as c_int;

        if length > 0 && msg.msg_controllen > 0 {
            let cm = libc::CMSG_FIRSTHDR(&msg);
            if !cm.is_null()
                && (*cm).cmsg_level == libc::SOL_SOCKET
                && (*cm).cmsg_type == libc::SCM_RIGHTS
            {
                let fd = ptr::read_unaligned(libc::CMSG_DATA(cm) as *const c_int);
                us_dispatch_fd(to_c(s), fd);
            }
        }
        length
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// dispatch_listen — the accept loop
// ═══════════════════════════════════════════════════════════════════════════

fn dispatch_listen(tick: LoopTick<'_>, ls: Socket<'_>) {
    // SAFETY: a semi-socket polling READABLE is a `us_listen_socket_t`; it
    // stays allocated for the tick even if `on_open` closes it.
    let listen = unsafe { &*(ls.as_raw().as_ptr() as *const us_listen_socket_t) };
    let listen_p = ls.as_raw().as_ptr() as *mut us_listen_socket_t;
    let accept_group: NonNull<SocketGroup> = NonNull::new(listen.accept_group)
        .expect("listen socket has accept_group")
        .cast();
    let loop_ = tick.as_ptr();
    let mut addr = MaybeUninit::<bsd_addr_t>::uninit();

    // SAFETY: `addr` is a valid out-pointer.
    let mut client_fd = Fd(unsafe { bsd_accept_socket(ls.fd().raw(), addr.as_mut_ptr()) });
    if !client_fd.is_valid() {
        // Todo: start timer here.
        return;
    }
    // Todo: stop timer if any.

    loop {
        // SAFETY: `loop_` is live.
        let accepted_p = unsafe {
            us_create_poll(
                loop_,
                0,
                (size_of::<us_socket_t>() - size_of::<crate::eventing::us_poll_t>()) as c_uint
                    + listen.socket_ext_size,
            )
        };
        // SAFETY: `accepted_p` is a fresh poll.
        unsafe { us_poll_init(accepted_p, client_fd.raw(), POLL_TYPE_SOCKET) };
        // SAFETY: `accepted_p`/`loop_` are live.
        if unsafe { us_poll_start_rc(accepted_p, loop_, LIBUS_SOCKET_READABLE) } != 0 {
            // EPOLL_CTL_ADD failed (e.g. ENOSPC). Close the fd so the peer
            // sees a RST instead of a silent non-answer.
            // SAFETY: `client_fd` is owned here; `accepted_p` was never started.
            unsafe {
                bsd_close_socket(client_fd.raw());
                us_poll_free(accepted_p, loop_);
            }
        } else {
            // SAFETY: `accepted_p` is a fresh calloc'd `us_socket_t` (Poll at
            // offset 0); it stays live for the tick.
            let s: Socket<'_> =
                unsafe { Socket::from_raw(NonNull::new_unchecked(accepted_p).cast()) };
            let h: &SocketHeader = s.header();

            h.group.set(Some(accept_group));
            h.kind.set(listen.accept_kind);
            h.ssl.set(ptr::null_mut());
            h.connect_state.set(None);
            h.timeout.set(255);
            h.long_timeout.set(255);
            h.flags.set_low_prio_state(0);
            h.flags
                .set_allow_half_open(ls.header().flags.allow_half_open());
            h.flags.set_is_paused(false);
            h.flags.set_is_ipc(false);
            h.flags.set_is_closed(false);
            h.flags.set_adopted(false);

            // We always use nodelay.
            // SAFETY: setsockopt on a live fd.
            unsafe { bsd_socket_nodelay(client_fd.raw(), 1) };

            // SAFETY: `accept_group`/`s` are live.
            unsafe { us_internal_socket_group_link_socket(accept_group.as_ptr().cast(), to_c(s)) };

            // SAFETY: `addr` was written by `bsd_accept_socket`.
            let (ip, ip_len) = unsafe {
                (
                    bsd_addr_get_ip(addr.as_mut_ptr()),
                    bsd_addr_get_ip_length(addr.as_mut_ptr()),
                )
            };
            let after = if !listen.ssl_ctx.is_null() {
                // SAFETY: `s` is live; `listen_p` and its `ssl_ctx` outlive the call.
                unsafe {
                    us_internal_ssl_attach(to_c(s), listen.ssl_ctx, 0, ptr::null(), listen_p);
                    from_c(us_internal_ssl_on_open(to_c(s), 0, ip, ip_len))
                }
            } else {
                // SAFETY: `s` is live.
                unsafe { from_c(us_dispatch_open(to_c(s), 0, ip, ip_len)) }
            };
            let after = follow_adoption(after);

            // With TCP_DEFER_ACCEPT / SO_ACCEPTFILTER the payload is already
            // buffered — dispatch readable now instead of round-tripping.
            if listen.deferred_accept != 0
                && let Some(cur) = after
                && !cur.is_closed()
            {
                dispatch_ready(
                    tick,
                    ReadyPoll::Stream(cur),
                    false,
                    false,
                    PollEvents::READABLE,
                );
            }

            // Exit accept loop if listen socket was closed in on_open / handler.
            if ls.is_closed() {
                break;
            }
        }

        // SAFETY: `addr` is a valid out-pointer.
        client_fd = Fd(unsafe { bsd_accept_socket(ls.fd().raw(), addr.as_mut_ptr()) });
        if !client_fd.is_valid() {
            break;
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// dispatch_udp — datagram readable / writable / error
// ═══════════════════════════════════════════════════════════════════════════

#[inline(always)]
fn udp_closed(u: NonNull<UdpSocket>) -> bool {
    // SAFETY: `u` is live for the tick; field read only.
    unsafe { (*u.as_ptr()).closed() }
}

#[allow(unused_mut, unused_assignments)]
#[cfg_attr(
    not(any(target_os = "linux", target_os = "android")),
    allow(unused_variables, unused_mut)
)]
fn dispatch_udp(tick: LoopTick<'_>, u: NonNull<UdpSocket>, mut error: bool, events: PollEvents) {
    if udp_closed(u) {
        return;
    }
    let p = u.as_ptr();
    // SAFETY: `u` is live; `p` is its first field.
    let poll = unsafe { ptr::addr_of_mut!((*p).p) };
    // SAFETY: field reads only.
    let (fd, u_loop) = unsafe { (Fd(crate::eventing::us_poll_fd(poll)), (*p).loop_) };

    #[cfg(any(target_os = "linux", target_os = "android"))]
    let mut recv_error_surfaced = false;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let mut recv_would_block_only = false;

    #[cfg(any(target_os = "linux", target_os = "android"))]
    if error {
        // IP_RECVERR: EPOLLERR stays level-triggered until MSG_ERRQUEUE is
        // drained; surface each queued ICMP error via `on_recv_error`.
        drain_udp_errqueue(fd, u, &mut recv_error_surfaced);
    }

    if events.readable() && !udp_closed(u) {
        loop {
            let mut recvbuf = MaybeUninit::<udp_recvbuf>::uninit();
            // SAFETY: `recvbuf` is a valid out-pointer; `recv_buf` backs it.
            unsafe {
                bsd_udp_setup_recvbuf(
                    recvbuf.as_mut_ptr(),
                    tick.data().recv_buf.get().cast(),
                    LIBUS_RECV_BUFFER_LENGTH,
                );
            }
            // SAFETY: `recvbuf` was set up above.
            let npackets = unsafe { bsd_recvmmsg(fd.raw(), recvbuf.as_mut_ptr(), MSG_DONTWAIT) };
            if npackets > 0 {
                // SAFETY: `u` is live; `on_data` was installed by the owner.
                unsafe {
                    if let Some(cb) = (*p).on_data {
                        cb(p, recvbuf.as_mut_ptr().cast(), npackets);
                    }
                }
            } else {
                if npackets < 0 {
                    let err = last_error();
                    if !would_block(err) {
                        #[cfg(any(target_os = "linux", target_os = "android"))]
                        {
                            recv_error_surfaced = true;
                            // SAFETY: `u` is live; optional callback.
                            unsafe {
                                if let Some(cb) = (*p).on_recv_error {
                                    cb(p, err);
                                }
                            }
                        }
                        #[cfg(not(any(target_os = "linux", target_os = "android")))]
                        {
                            error = true;
                        }
                    } else {
                        #[cfg(any(target_os = "linux", target_os = "android"))]
                        {
                            recv_would_block_only = true;
                        }
                    }
                }
                break;
            }
            if udp_closed(u) {
                break;
            }
        }
    }

    if events.writable() && !udp_closed(u) {
        // Clear WRITABLE before `on_drain` so a callback that re-arms it keeps
        // the re-arm. Not gated on `!error` so a queued ICMP error doesn't spin.
        // SAFETY: `poll`/`u_loop` are live.
        unsafe {
            let ev = crate::eventing::us_poll_events(poll) & LIBUS_SOCKET_READABLE;
            us_poll_change(poll, u_loop, ev);
            if let Some(cb) = (*p).on_drain {
                cb(p);
            }
        }
        if udp_closed(u) {
            return;
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    if error && !recv_error_surfaced && !recv_would_block_only && !udp_closed(u) {
        // SAFETY: `u` is live.
        unsafe { us_udp_socket_close(p) };
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    if error && !udp_closed(u) {
        // SAFETY: `u` is live.
        unsafe { us_udp_socket_close(p) };
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn drain_udp_errqueue(fd: Fd, u: NonNull<UdpSocket>, surfaced: &mut bool) {
    let mut ectrl = [0u8; 512];
    let mut ebuf = [0u8; 1];
    while !udp_closed(u) {
        let mut eiov = libc::iovec {
            iov_base: ebuf.as_mut_ptr().cast(),
            iov_len: ebuf.len(),
        };
        // SAFETY: zeroed is a valid `msghdr`.
        let mut eh: libc::msghdr = unsafe { core::mem::zeroed() };
        eh.msg_iov = &mut eiov;
        eh.msg_iovlen = 1 as _;
        eh.msg_control = ectrl.as_mut_ptr().cast();
        eh.msg_controllen = ectrl.len() as _;
        // SAFETY: reads the socket's error queue.
        if unsafe { libc::recvmsg(fd.raw(), &mut eh, libc::MSG_ERRQUEUE) } < 0 {
            break;
        }
        *surfaced = true;
        // SAFETY: `u` is live; optional callback.
        let on_err = unsafe { (*u.as_ptr()).on_recv_error };
        if let Some(cb) = on_err {
            // The queued ICMP error is in `sock_extended_err`, not errno.
            let mut ee: c_int = 0;
            // SAFETY: `eh` was populated by `recvmsg`.
            let mut cm = unsafe { libc::CMSG_FIRSTHDR(&eh) };
            while !cm.is_null() {
                // SAFETY: `cm` walks valid cmsg records inside `ectrl`.
                unsafe {
                    if ((*cm).cmsg_level == libc::IPPROTO_IP && (*cm).cmsg_type == libc::IP_RECVERR)
                        || ((*cm).cmsg_level == libc::IPPROTO_IPV6
                            && (*cm).cmsg_type == libc::IPV6_RECVERR)
                    {
                        ee = (*(libc::CMSG_DATA(cm) as *const libc::sock_extended_err)).ee_errno
                            as c_int;
                        break;
                    }
                    cm = libc::CMSG_NXTHDR(&mut eh, cm);
                }
            }
            // SAFETY: `u` is live.
            unsafe { cb(u.as_ptr(), if ee != 0 { ee } else { libc::ECONNREFUSED }) };
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// extern "C" shim — keeps the existing ABI calling into the safe path
// ═══════════════════════════════════════════════════════════════════════════

/// ABI-compatible replacement for `loop_core::us_internal_dispatch_ready_poll`.
///
/// # Safety
/// `p` must be a live poll owned by `loop_`; must be called on the loop thread.
#[inline]
pub unsafe fn dispatch_ready_poll_raw(
    loop_: NonNull<Loop>,
    p: NonNull<Poll>,
    error: c_int,
    eof: c_int,
    events: c_int,
) {
    // SAFETY: caller contract above.
    let tick = unsafe { LoopTick::new(loop_) };
    // SAFETY: `p` was registered by this crate with a matching `poll_type`.
    let rp = unsafe { ReadyPoll::classify(p) };
    dispatch_ready(tick, rp, error != 0, eof != 0, PollEvents(events));
}
