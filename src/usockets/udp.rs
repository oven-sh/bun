//! UDP sockets + per-loop packet buffer. Contract per C15 (docs/design.md):
//! sync on_close, `closed_udp_head` lifetime, one-shot drain,
//! Linux MSG_ERRQUEUE vs non-Linux close-on-error, batch recv loop close
//! recheck. Rules R9.1–R9.9 (docs/semantics.md §9).

use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::ptr;

#[cfg(not(windows))]
use libc::sockaddr_storage;

/// Winsock `SOCKADDR_STORAGE` (ws2def.h): 128 bytes, 8-aligned; the libc
/// crate ships no windows sockaddr types.
#[cfg(windows)]
#[repr(C, align(8))]
#[derive(Copy, Clone)]
#[allow(non_camel_case_types)]
pub struct sockaddr_storage {
    pub ss_family: c_ushort,
    __pad: [u8; 126],
}

#[cfg(not(windows))]
use crate::LIBUS_RECV_BUFFER_LENGTH;
use crate::backend::Events;
use crate::loop_::Loop;
use crate::unsafe_core::io;
use crate::{LIBUS_SOCKET_DESCRIPTOR, LIBUS_SOCKET_ERROR};

/// `LIBUS_SEND_BUFFER_LENGTH` — the loop's shared UDP send scratch (metadata
/// only; payload bytes are never copied). The loop allocator must match.
pub(crate) const LIBUS_SEND_BUFFER_LENGTH: usize = 16384;

/// `LIBUS_UDP_MAX_SIZE` — per-datagram slot in the shared recv buffer.
pub(crate) const LIBUS_UDP_MAX_SIZE: usize = 64 * 1024;

/// Batch size: 8 on POSIX (512 KiB / 64 KiB), 1 on Windows (plain recvfrom).
#[cfg(not(windows))]
pub(crate) const LIBUS_UDP_RECV_COUNT: usize = LIBUS_RECV_BUFFER_LENGTH / LIBUS_UDP_MAX_SIZE;
#[cfg(windows)]
pub(crate) const LIBUS_UDP_RECV_COUNT: usize = 1;

/// Per-packet ancillary-data capacity (bsd.h `control[..][256]`).
#[cfg(not(windows))]
pub(crate) const UDP_CONTROL_LEN: usize = 256;

/// POSIX `struct mmsghdr` (macOS: the `recvmsg_x`/`sendmsg_x` extended shape).
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
pub(crate) use libc::mmsghdr as Mmsghdr;
#[cfg(target_os = "macos")]
#[repr(C)]
pub(crate) struct Mmsghdr {
    pub(crate) msg_hdr: libc::msghdr,
    pub(crate) msg_len: usize,
}

/// `us_udp_socket_t`. Heap-stable address (self-linked into `closed_udp_head`,
/// used as the poll's tagged udata word — hence the 16-byte alignment).
/// quic.c's poll-first cast survives via cabi accessors (docs/cabi.md §3.6).
#[repr(C, align(16))]
pub struct Socket {
    pub(crate) fd: LIBUS_SOCKET_DESCRIPTOR,
    pub(crate) loop_: *mut Loop,
    pub(crate) user: *mut c_void,
    pub(crate) closed: bool,
    /// Declared-but-never-written parity bit (R9.9: the C core never sets it).
    pub(crate) connected: bool,
    /// Bound port cached once at creation (R9.2); `bound_port` never syscalls.
    pub(crate) port: c_int,
    /// Believed kernel registration (R2.6 equivalent for the UDP poll).
    pub(crate) poll_events: u32,
    pub(crate) next_closed: *mut Socket,
    /// Windows: owning uv_poll wrapper (io.rs udp arm), null until first arm
    /// and after stop; freed by its uv_close callback (deferred, R2.4).
    #[cfg(windows)]
    pub(crate) uv_p: *mut c_void,
    pub(crate) data_cb: Option<extern "C" fn(*mut Socket, *mut PacketBuffer, c_int)>,
    pub(crate) drain_cb: Option<extern "C" fn(*mut Socket)>,
    pub(crate) close_cb: Option<extern "C" fn(*mut Socket)>,
    pub(crate) recv_error_cb: Option<extern "C" fn(*mut Socket, c_int)>,
}

/// Immutable-after-create snapshot so dispatch never holds a borrow of the
/// socket across a consumer callback (C17).
#[derive(Copy, Clone)]
pub(crate) struct Meta {
    pub(crate) fd: LIBUS_SOCKET_DESCRIPTOR,
    pub(crate) loop_: *mut Loop,
    pub(crate) data_cb: Option<extern "C" fn(*mut Socket, *mut PacketBuffer, c_int)>,
    pub(crate) drain_cb: Option<extern "C" fn(*mut Socket)>,
    pub(crate) recv_error_cb: Option<extern "C" fn(*mut Socket, c_int)>,
}

fn last_errno() -> c_int {
    std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
}

#[cfg(not(windows))]
fn would_block(errno: c_int) -> bool {
    errno == libc::EWOULDBLOCK
}
#[cfg(windows)]
fn would_block(errno: c_int) -> bool {
    // WSAEWOULDBLOCK; std maps WSAGetLastError into last_os_error on Windows.
    errno == 10035
}

/// Map the io layer's `0 / -errno` convention back to the raw setsockopt rc
/// contract consumers key on (`-1` + errno set).
fn raw_rc(rc: i32) -> c_int {
    if rc == 0 {
        0
    } else {
        io::set_errno(-rc);
        -1
    }
}

impl Socket {
    /// Create + bind + start readable polling. `data_cb(socket, buf,
    /// npackets)`: `buf` is the per-loop shared recv batch, valid only during
    /// the callback. `recv_error_cb` fires for non-EAGAIN recvmmsg errors —
    /// the socket is NOT closed automatically. Null + `*err` on bind failure.
    pub fn create(
        loop_: *mut Loop,
        data_cb: extern "C" fn(*mut Socket, *mut PacketBuffer, c_int),
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int),
        host: *const c_char,
        port: c_ushort,
        options: c_int,
        err: Option<&mut c_int>,
        user_data: *mut c_void,
    ) -> *mut Socket {
        let mut err = err;
        let mut bind_err: c_int = 0;
        let fd = io::udp_bind_fd(host, port, options, &mut bind_err);
        if fd == LIBUS_SOCKET_ERROR {
            if let Some(e) = err.as_deref_mut() {
                *e = bind_err;
            }
            return ptr::null_mut();
        }

        let this = bun_core::heap::into_raw(Box::new(Socket {
            fd,
            loop_,
            user: user_data,
            closed: false,
            connected: false,
            port: io::udp_local_port(fd),
            poll_events: 0,
            next_closed: ptr::null_mut(),
            #[cfg(windows)]
            uv_p: ptr::null_mut(),
            data_cb: Some(data_cb),
            drain_cb: Some(drain_cb),
            close_cb: Some(close_cb),
            recv_error_cb: Some(recv_error_cb),
        }));

        // us_create_poll(fallthrough = 0); libuv counts active handles itself.
        #[cfg(not(windows))]
        {
            io::loop_mut(loop_).num_polls += 1;
        }

        if io::udp_poll_start(loop_, this, Events::READABLE.0 | Events::WRITABLE.0) != 0 {
            let saved = last_errno();
            io::close(fd, false);
            #[cfg(not(windows))]
            {
                io::loop_mut(loop_).num_polls -= 1;
            }
            io::udp_destroy(this);
            if let Some(e) = err.as_deref_mut() {
                *e = saved;
            }
            io::set_errno(saved);
            return ptr::null_mut();
        }

        if let Some(e) = err.as_deref_mut() {
            *e = 0;
        }
        this
    }

    /// sendmmsg-style batch; parallel slices must share length. Returns
    /// packets sent (may be short), negative on hard error. Batching
    /// arithmetic ported verbatim including OQ-1: `num` is post-decremented,
    /// so both the loop bound and the re-arm test compare against the
    /// *remaining* count (final-batch partial sends never arm WRITABLE).
    pub fn send(
        &mut self,
        payloads: &[*const u8],
        lengths: &[usize],
        addresses: &[*const c_void],
    ) -> c_int {
        debug_assert!(payloads.len() == lengths.len() && payloads.len() == addresses.len());
        let mut num = c_int::try_from(payloads.len()).expect("int cast");
        if num == 0 {
            return 0;
        }
        let fd = self.fd;
        let loop_ = self.loop_;
        // Derived after the last direct `self` access: `this` stays valid
        // through the raw-pointer poll re-arms below (provenance).
        let this: *mut Socket = self;

        let mut off = 0usize;
        let mut total_sent: c_int = 0;
        while total_sent < num {
            let send_buf = io::loop_mut(loop_).internal_loop_data.send_buf;
            let (count, sent) = io::udp_send_batch(
                fd,
                send_buf,
                LIBUS_SEND_BUFFER_LENGTH,
                &payloads[off..],
                &lengths[off..],
                &addresses[off..],
            );
            off += usize::try_from(count).expect("int cast");
            num -= count;
            if sent < 0 {
                return sent;
            }
            total_sent += sent;
            if sent < num {
                // Partial send: re-arm WRITABLE so on_drain fires later (R9.7).
                io::udp_poll_change(loop_, this, Events::READABLE.0 | Events::WRITABLE.0);
            }
        }
        total_sent
    }

    pub fn user(&mut self) -> *mut c_void {
        self.user
    }

    /// Bound port in host byte order (cached at create — R9.2).
    pub fn bound_port(&mut self) -> c_int {
        self.port
    }

    pub fn bound_ip(&mut self, buf: *mut u8, length: &mut i32) {
        io::udp_addr_ip(self.fd, false, buf, length);
    }

    pub fn remote_ip(&mut self, buf: *mut u8, length: &mut i32) {
        io::udp_addr_ip(self.fd, true, buf, length);
    }

    /// Stops the poll, closes the fd, fires close_cb synchronously, defers
    /// the free to the tick postlude via `closed_udp_head` (R9.3, C15). Safe
    /// while iterating and re-entrant from any callback.
    pub fn close(&mut self) {
        // Idempotent: a second close would self-link closed_udp_head (cycle
        // in the postlude drain) and double-free the Box.
        if self.closed {
            return;
        }
        let loop_ = self.loop_;
        let fd = self.fd;
        let cb = self.close_cb;
        self.closed = true;
        self.next_closed = io::loop_mut(loop_).internal_loop_data.closed_udp_head;
        // Derived after the last direct `self` access so it stays valid
        // through the callback; on_close re-derives the socket from `this`
        // (C15: user data readable during and after the callback).
        let this: *mut Socket = self;
        io::udp_poll_stop(loop_, this);
        io::close(fd, false);
        io::loop_mut(loop_).internal_loop_data.closed_udp_head = this;
        if let Some(cb) = cb {
            cb(this);
        }
    }

    /// getaddrinfo + connect to the first address that succeeds. 0 on
    /// success, the gai error as-is on DNS failure, -1 + errno otherwise (R9.9).
    pub fn connect(&mut self, hostname: *const c_char, port: c_uint) -> c_int {
        io::udp_connect_fd(self.fd, hostname, port)
    }

    /// connect(AF_UNSPEC); EAFNOSUPPORT counts as success (R9.9).
    pub fn disconnect(&mut self) -> c_int {
        io::udp_disconnect_fd(self.fd)
    }

    pub fn set_broadcast(&mut self, enabled: bool) -> c_int {
        raw_rc(io::broadcast(self.fd, enabled))
    }

    pub fn set_unicast_ttl(&mut self, ttl: i32) -> c_int {
        raw_rc(io::ttl_unicast(self.fd, ttl))
    }

    pub fn set_multicast_ttl(&mut self, ttl: i32) -> c_int {
        raw_rc(io::ttl_multicast(self.fd, ttl))
    }

    pub fn set_multicast_loopback(&mut self, enabled: bool) -> c_int {
        raw_rc(io::multicast_loopback(self.fd, enabled))
    }

    pub fn set_multicast_interface(&mut self, iface: &sockaddr_storage) -> c_int {
        raw_rc(io::multicast_interface(self.fd, iface))
    }

    pub fn set_membership(
        &mut self,
        address: &sockaddr_storage,
        iface: Option<&sockaddr_storage>,
        drop: bool,
    ) -> c_int {
        raw_rc(io::set_membership(self.fd, address, iface, drop))
    }

    pub fn set_source_specific_membership(
        &mut self,
        source: &sockaddr_storage,
        group: &sockaddr_storage,
        iface: Option<&sockaddr_storage>,
        drop: bool,
    ) -> c_int {
        raw_rc(io::set_source_specific_membership(
            self.fd, source, group, iface, drop,
        ))
    }
}

// ── ready-poll dispatch (R9.4 — the POLL_TYPE_UDP arm of loop dispatch) ─────

/// Called by the loop's ready-poll dispatcher for a UDP-tagged udata word.
/// `error` = EPOLLERR / kqueue EV_ERROR / libuv error event.
pub(crate) fn dispatch_ready_poll(s: *mut Socket, error: bool, readable: bool, writable: bool) {
    if io::udp_is_closed(s) {
        return;
    }
    let m = io::udp_meta(s);

    // kqueue EVFILT_WRITE is one-shot: a delivered writable event consumed the
    // kernel filter, so drop the believed W bit (loop.c:556-563 equivalent).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    if writable {
        io::udp_clear_writable_believed(s);
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    let mut recv_error_surfaced = false;
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let mut recv_would_block_only = false;
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let mut error = error;

    // Linux IP_RECVERR: EPOLLERR is level-triggered until the error queue is
    // drained via recvmsg(MSG_ERRQUEUE); the socket stays open (R9.4.2).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if error {
        while !io::udp_is_closed(s) {
            let Some(ee) = io::udp_recv_errqueue(m.fd) else {
                break;
            };
            recv_error_surfaced = true;
            if let Some(cb) = m.recv_error_cb {
                cb(s, if ee != 0 { ee } else { libc::ECONNREFUSED });
            }
        }
    }

    if readable && !io::udp_is_closed(s) {
        let mut recvbuf = io::udp_recvbuf_zeroed();
        loop {
            let recv_buf = io::loop_mut(m.loop_).internal_loop_data.recv_buf;
            let npackets = io::udp_recvmmsg(m.fd, &mut recvbuf, recv_buf);
            if npackets > 0 {
                if let Some(cb) = m.data_cb {
                    cb(s, &mut recvbuf, npackets);
                }
            } else {
                if npackets == -1 {
                    let errno = last_errno();
                    if !would_block(errno) {
                        #[cfg(any(target_os = "linux", target_os = "android"))]
                        {
                            recv_error_surfaced = true;
                            if let Some(cb) = m.recv_error_cb {
                                cb(s, errno);
                            }
                        }
                        #[cfg(not(any(target_os = "linux", target_os = "android")))]
                        {
                            // non-Linux: fatal — fall through to close below.
                            error = true;
                        }
                    } else {
                        #[cfg(any(target_os = "linux", target_os = "android"))]
                        {
                            recv_would_block_only = true;
                        }
                    }
                }
                // 0 packets: batch not divisible by LIBUS_UDP_RECV_COUNT, done.
                break;
            }
            // A callback in this batch may have closed the socket (C15).
            if io::udp_is_closed(s) {
                break;
            }
        }
    }

    if writable && !io::udp_is_closed(s) {
        // Clear WRITABLE before on_drain so a callback that re-arms it keeps
        // the re-arm (one-shot drain); not gated on !error — a queued ICMP
        // error must not leave level-triggered EPOLLOUT+EPOLLERR spinning.
        let believed = io::udp_poll_events(s);
        io::udp_poll_change(m.loop_, s, believed & Events::READABLE.0);
        if let Some(cb) = m.drain_cb {
            cb(s);
        }
        if io::udp_is_closed(s) {
            return;
        }
    }

    // Residual unexplained EPOLLERR closes on Linux; any error closes elsewhere.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    if error && !recv_error_surfaced && !recv_would_block_only && !io::udp_is_closed(s) {
        io::udp_close_raw(s);
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    if error && !io::udp_is_closed(s) {
        io::udp_close_raw(s);
    }
}

/// Tick-postlude sweep of `closed_udp_head` (`us_internal_free_closed_sockets`
/// UDP half): memory stays readable until here (C6/C15).
pub(crate) fn free_closed_udp_sockets(loop_: *mut Loop) {
    let mut s = {
        let data = &mut io::loop_mut(loop_).internal_loop_data;
        core::mem::replace(&mut data.closed_udp_head, ptr::null_mut())
    };
    while !s.is_null() {
        let next = io::udp_next_closed(s);
        // us_poll_free parity: each UDP socket owned one non-fallthrough poll.
        #[cfg(not(windows))]
        {
            io::loop_mut(loop_).num_polls -= 1;
        }
        io::udp_destroy(s);
        s = next;
    }
}

// ── packet buffer ─────────────────────────────────────────────────────────────

/// `us_udp_packet_buffer_t` / `struct udp_recvbuf` — the receive batch wired
/// over the loop's shared 512 KiB recv_buf. Loaned to `data_cb` only; payload
/// and peer pointers die when the callback returns. Lives on the dispatch
/// stack; `msg_hdr` points at this struct's own `addr`/`control` slots, so it
/// must never move between setup and consumption (udp_recvmmsg does both).
#[cfg(not(windows))]
#[repr(C)]
pub struct PacketBuffer {
    pub(crate) msgvec: [Mmsghdr; LIBUS_UDP_RECV_COUNT],
    pub(crate) iov: [libc::iovec; LIBUS_UDP_RECV_COUNT],
    pub(crate) addr: [sockaddr_storage; LIBUS_UDP_RECV_COUNT],
    pub(crate) control: [[u8; UDP_CONTROL_LEN]; LIBUS_UDP_RECV_COUNT],
}

/// Windows: one packet per recvfrom (`LIBUS_UDP_RECV_COUNT == 1`).
#[cfg(windows)]
#[repr(C)]
pub struct PacketBuffer {
    pub(crate) buf: *mut u8,
    pub(crate) buflen: usize,
    pub(crate) recvlen: usize,
    pub(crate) addr: sockaddr_storage,
}

impl PacketBuffer {
    pub fn get_peer(&mut self, index: i32) -> &mut sockaddr_storage {
        #[cfg(not(windows))]
        {
            &mut self.addr[usize::try_from(index).expect("int cast")]
        }
        #[cfg(windows)]
        {
            let _ = index;
            &mut self.addr
        }
    }

    /// Length clamped to LIBUS_UDP_MAX_SIZE so a truncated datagram never
    /// reports more bytes than were copied (Darwin recvmsg_x quirk).
    pub fn get_payload(&mut self, index: i32) -> &mut [u8] {
        io::udp_packet_payload(self, index)
    }

    pub fn get_truncated(&mut self, index: i32) -> bool {
        #[cfg(not(windows))]
        {
            let i = usize::try_from(index).expect("int cast");
            self.msgvec[i].msg_hdr.msg_flags & libc::MSG_TRUNC != 0
        }
        #[cfg(windows)]
        {
            // WSARecvFrom signals truncation via WSAEMSGSIZE; not surfaced.
            let _ = index;
            false
        }
    }
}
