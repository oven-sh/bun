//! Thin platform-abstraction layer over BSD-socket syscalls.
//!
//! Ports `packages/bun-usockets/src/bsd.c` + `internal/networking/bsd.h`. Every
//! `bsd_*` function is `#[unsafe(no_mangle)] extern "C"` so the rest of uSockets and
//! uWebSockets (C++) keep linking unchanged.

#![allow(dead_code, unused_variables, unused_mut, clippy::missing_safety_doc)]

use core::ffi::{c_char, c_int, c_uint, c_void};
use core::mem::{MaybeUninit, size_of};
use core::ptr;

use crate::types::{
    LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE, LIBUS_LISTEN_EXCLUSIVE_PORT, LIBUS_LISTEN_REUSE_ADDR,
    LIBUS_LISTEN_REUSE_PORT, LIBUS_RECV_BUFFER_LENGTH, LIBUS_SOCKET_DESCRIPTOR,
    LIBUS_SOCKET_IPV6_ONLY, bsd_addr_t, sockaddr_storage, socklen_t, us_iovec_t,
};

// ═══════════════════════════════════════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
pub const LIBUS_SOCKET_ERROR: LIBUS_SOCKET_DESCRIPTOR = -1;
#[cfg(windows)]
pub const LIBUS_SOCKET_ERROR: LIBUS_SOCKET_DESCRIPTOR = usize::MAX; // INVALID_SOCKET

pub const LIBUS_UDP_MAX_SIZE: usize = 64 * 1024;

#[cfg(windows)]
pub const LIBUS_UDP_RECV_COUNT: usize = 1;
#[cfg(not(windows))]
pub const LIBUS_UDP_RECV_COUNT: usize = LIBUS_RECV_BUFFER_LENGTH / LIBUS_UDP_MAX_SIZE;

#[cfg(not(windows))]
pub type ssize_t = isize;
#[cfg(windows)]
pub type ssize_t = isize; // SSIZE_T

// ═══════════════════════════════════════════════════════════════════════════
// errno / platform-error helpers
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
#[inline(always)]
unsafe fn errno_ptr() -> *mut c_int {
    unsafe extern "C" {
        #[cfg_attr(
            any(target_os = "macos", target_os = "ios", target_os = "freebsd"),
            link_name = "__error"
        )]
        #[cfg_attr(target_os = "linux", link_name = "__errno_location")]
        #[cfg_attr(target_os = "android", link_name = "__errno")]
        fn __errno() -> *mut c_int;
    }
    // SAFETY: returns a valid thread-local int* for the calling thread.
    unsafe { __errno() }
}

#[cfg(windows)]
#[inline(always)]
unsafe fn errno_ptr() -> *mut c_int {
    unsafe extern "C" {
        fn _errno() -> *mut c_int;
    }
    // SAFETY: MSVCRT thread-local errno slot.
    unsafe { _errno() }
}

#[inline(always)]
unsafe fn errno() -> c_int {
    // SAFETY: errno_ptr always returns a valid thread-local pointer.
    unsafe { *errno_ptr() }
}

#[inline(always)]
unsafe fn set_errno(e: c_int) {
    // SAFETY: errno_ptr always returns a valid thread-local pointer.
    unsafe { *errno_ptr() = e };
}

/// C `LIBUS_ERR` — `errno` on POSIX, `WSAGetLastError()` on Windows.
#[inline(always)]
unsafe fn libus_err() -> c_int {
    #[cfg(windows)]
    {
        win::WSAGetLastError()
    }
    #[cfg(not(windows))]
    {
        // SAFETY: reads thread-local errno; always valid.
        unsafe { errno() }
    }
}

/// `IS_EINTR` for `ssize_t`-returning calls.
#[inline(always)]
unsafe fn is_eintr(rc: ssize_t) -> bool {
    #[cfg(windows)]
    {
        rc == -1 && win::WSAGetLastError() == win::WSAEINTR
    }
    #[cfg(not(windows))]
    {
        // SAFETY: reads thread-local errno; always valid.
        rc == -1 && unsafe { errno() } == libc::EINTR
    }
}

/// `IS_EINTR` for `LIBUS_SOCKET_DESCRIPTOR`-returning calls.
#[inline(always)]
unsafe fn is_eintr_fd(rc: LIBUS_SOCKET_DESCRIPTOR) -> bool {
    #[cfg(windows)]
    {
        rc == LIBUS_SOCKET_ERROR && win::WSAGetLastError() == win::WSAEINTR
    }
    #[cfg(not(windows))]
    {
        // SAFETY: reads thread-local errno; always valid.
        rc == -1 && unsafe { errno() } == libc::EINTR
    }
}

#[inline(always)]
const fn ntohs(n: u16) -> u16 {
    u16::from_be(n)
}
#[inline(always)]
const fn ntohl(n: u32) -> u32 {
    u32::from_be(n)
}
#[inline(always)]
const fn htonl(n: u32) -> u32 {
    n.to_be()
}

// ═══════════════════════════════════════════════════════════════════════════
// POSIX platform glue
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
mod plat {
    use super::*;
    pub(super) use libc::{
        AF_INET, AF_INET6, AF_UNIX, AF_UNSPEC, AI_PASSIVE, F_GETFD, F_GETFL, F_SETFD, F_SETFL,
        FD_CLOEXEC, INADDR_ANY, IP_ADD_MEMBERSHIP, IP_DROP_MEMBERSHIP, IP_MULTICAST_IF,
        IP_MULTICAST_LOOP, IP_MULTICAST_TTL, IP_TOS, IP_TTL, IPPROTO_IP, IPPROTO_IPV6, IPPROTO_TCP,
        IPV6_MULTICAST_HOPS, IPV6_MULTICAST_IF, IPV6_MULTICAST_LOOP, IPV6_RECVTCLASS, IPV6_TCLASS,
        IPV6_UNICAST_HOPS, IPV6_V6ONLY, MSG_DONTWAIT, MSG_TRUNC, O_NONBLOCK, SHUT_RD, SHUT_WR,
        SO_BROADCAST, SO_KEEPALIVE, SO_REUSEADDR, SOCK_DGRAM, SOCK_STREAM, SOL_SOCKET, TCP_NODELAY,
        addrinfo, in_addr, in6_addr, ip_mreq, ipv6_mreq, sockaddr, sockaddr_in, sockaddr_in6,
        sockaddr_un,
    };

    pub(super) use libc::{
        bind, close, connect, fcntl, freeaddrinfo, getaddrinfo, getpeername, getsockname,
        getsockopt, listen, recv, recvmsg, send, sendmsg, shutdown, socket, writev,
    };

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub(super) use libc::O_RDONLY;
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
    pub(super) use libc::accept;
    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "ios"
    ))]
    pub(super) use libc::{O_CLOEXEC, O_DIRECTORY, open};

    pub(super) use libc::{IP_ADD_SOURCE_MEMBERSHIP, IP_DROP_SOURCE_MEMBERSHIP, ip_mreq_source};
    pub(super) use libc::{IP_RECVTOS, IPV6_RECVPKTINFO};

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) use libc::{
        IPV6_ADD_MEMBERSHIP as IPV6_JOIN_GROUP, IPV6_DROP_MEMBERSHIP as IPV6_LEAVE_GROUP,
    };
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    pub(super) use libc::{IPV6_JOIN_GROUP, IPV6_LEAVE_GROUP};

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    pub(super) use libc::{SOCK_CLOEXEC, SOCK_NONBLOCK, accept4};

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) use libc::{
        IP_PKTINFO, IP_RECVERR, IPV6_PKTINFO, IPV6_RECVERR, MCAST_JOIN_SOURCE_GROUP,
        MCAST_LEAVE_SOURCE_GROUP, MSG_NOSIGNAL, O_PATH, TCP_CORK, TCP_DEFER_ACCEPT, TCP_KEEPCNT,
        TCP_KEEPIDLE, TCP_KEEPINTVL, in_pktinfo, in6_pktinfo, mmsghdr,
    };

    #[cfg(target_os = "freebsd")]
    pub(super) use libc::{
        IP_RECVDSTADDR, IPV6_PKTINFO, MSG_NOSIGNAL, SO_ACCEPTFILTER, TCP_KEEPCNT, TCP_KEEPIDLE,
        TCP_KEEPINTVL, accept_filter_arg, in6_pktinfo, mmsghdr,
    };

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub(super) use libc::{
        IP_PKTINFO, MSG_PEEK, SO_NOSIGPIPE, TCP_KEEPALIVE, TCP_KEEPCNT, TCP_KEEPINTVL,
    };

    // `struct group_source_req` — not in the libc crate on any platform.
    #[repr(C)]
    pub(super) struct group_source_req {
        pub gsr_interface: u32,
        pub gsr_group: libc::sockaddr_storage,
        pub gsr_source: libc::sockaddr_storage,
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub(super) const MCAST_JOIN_SOURCE_GROUP: c_int = 82;
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    pub(super) const MCAST_LEAVE_SOURCE_GROUP: c_int = 83;
    #[cfg(target_os = "freebsd")]
    pub(super) const MCAST_JOIN_SOURCE_GROUP: c_int = 74;
    #[cfg(target_os = "freebsd")]
    pub(super) const MCAST_LEAVE_SOURCE_GROUP: c_int = 75;

    // Darwin-only `struct mmsghdr` for sendmsg_x/recvmsg_x (private XNU syscall).
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    #[repr(C)]
    #[derive(Clone, Copy)]
    pub(super) struct mmsghdr {
        pub msg_hdr: libc::msghdr,
        pub msg_len: usize,
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    unsafe extern "C" {
        pub(super) fn recvmsg_x(s: c_int, msgp: *const mmsghdr, cnt: c_uint, flags: c_int)
        -> isize;
        pub(super) fn sendmsg_x(s: c_int, msgp: *const mmsghdr, cnt: c_uint, flags: c_int)
        -> isize;
        // Per-thread cwd (private, stable since macOS 10.5). Pass -1 to clear.
        pub(super) fn __pthread_fchdir(fd: c_int) -> c_int;
        pub(super) fn Bun__doesMacOSVersionSupportSendRecvMsgX() -> c_int;
    }

    // Linux sendmmsg/recvmmsg — declared locally so musl links too.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    unsafe extern "C" {
        pub(super) fn sendmmsg(
            sockfd: c_int,
            msgvec: *mut mmsghdr,
            vlen: c_uint,
            flags: c_int,
        ) -> c_int;
        pub(super) fn recvmmsg(
            sockfd: c_int,
            msgvec: *mut mmsghdr,
            vlen: c_uint,
            flags: c_int,
            timeout: *mut libc::timespec,
        ) -> c_int;
    }

    #[cfg(target_os = "freebsd")]
    pub(super) use libc::{recvmmsg, sendmmsg};

    #[inline(always)]
    pub(super) unsafe fn sso(
        fd: c_int,
        level: c_int,
        opt: c_int,
        val: *const c_void,
        len: socklen_t,
    ) -> c_int {
        // SAFETY: thin setsockopt wrapper; caller provides valid optval/len.
        unsafe { libc::setsockopt(fd, level, opt, val, len) }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Windows platform glue (winsock2 / ws2ipdef / mstcpip / afunix subset)
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(windows)]
mod win {
    use super::*;
    pub(super) use bun_windows_sys::ws2_32::{
        SOCKET_ERROR, WSAGetLastError, WSASetLastError, addrinfo, closesocket, freeaddrinfo,
        getaddrinfo, in_addr, in6_addr, recv as ws_recv, send as ws_send, sockaddr, sockaddr_in,
        sockaddr_in6,
    };

    pub(super) type SOCKET = usize;
    pub(super) const INVALID_SOCKET: SOCKET = usize::MAX;

    pub(super) const AF_UNSPEC: c_int = 0;
    pub(super) const AF_UNIX: c_int = 1;
    pub(super) const AF_INET: c_int = 2;
    pub(super) const AF_INET6: c_int = 23;
    pub(super) const SOCK_STREAM: c_int = 1;
    pub(super) const SOCK_DGRAM: c_int = 2;

    pub(super) const SOL_SOCKET: c_int = 0xFFFF;
    pub(super) const IPPROTO_IP: c_int = 0;
    pub(super) const IPPROTO_TCP: c_int = 6;
    pub(super) const IPPROTO_IPV6: c_int = 41;

    pub(super) const SO_REUSEADDR: c_int = 0x0004;
    pub(super) const SO_KEEPALIVE: c_int = 0x0008;
    pub(super) const SO_BROADCAST: c_int = 0x0020;
    pub(super) const SO_EXCLUSIVEADDRUSE: c_int = !SO_REUSEADDR;

    pub(super) const IP_TOS: c_int = 3;
    pub(super) const IP_TTL: c_int = 4;
    pub(super) const IP_MULTICAST_IF: c_int = 9;
    pub(super) const IP_MULTICAST_TTL: c_int = 10;
    pub(super) const IP_MULTICAST_LOOP: c_int = 11;
    pub(super) const IP_ADD_MEMBERSHIP: c_int = 12;
    pub(super) const IP_DROP_MEMBERSHIP: c_int = 13;
    pub(super) const IP_ADD_SOURCE_MEMBERSHIP: c_int = 15;
    pub(super) const IP_DROP_SOURCE_MEMBERSHIP: c_int = 16;
    pub(super) const IP_PKTINFO: c_int = 19;
    pub(super) const IP_RECVTOS: c_int = 40;

    pub(super) const IPV6_UNICAST_HOPS: c_int = 4;
    pub(super) const IPV6_MULTICAST_IF: c_int = 9;
    pub(super) const IPV6_MULTICAST_HOPS: c_int = 10;
    pub(super) const IPV6_MULTICAST_LOOP: c_int = 11;
    pub(super) const IPV6_JOIN_GROUP: c_int = 12;
    pub(super) const IPV6_LEAVE_GROUP: c_int = 13;
    pub(super) const IPV6_PKTINFO: c_int = 19;
    pub(super) const IPV6_V6ONLY: c_int = 27;
    pub(super) const IPV6_TCLASS: c_int = 39;
    pub(super) const IPV6_RECVTCLASS: c_int = 40;
    pub(super) const IPV6_RECVPKTINFO: c_int = IPV6_PKTINFO;

    pub(super) const MCAST_JOIN_SOURCE_GROUP: c_int = 45;
    pub(super) const MCAST_LEAVE_SOURCE_GROUP: c_int = 46;

    pub(super) const TCP_NODELAY: c_int = 1;
    pub(super) const TCP_KEEPALIVE: c_int = 3;

    pub(super) const AI_PASSIVE: c_int = 0x0001;

    pub(super) const SD_RECEIVE: c_int = 0;
    pub(super) const SD_SEND: c_int = 1;

    pub(super) const FIONBIO: u32 = 0x8004667E;
    pub(super) const SIO_UDP_CONNRESET: u32 = 0x9800000C;
    pub(super) const SIO_UDP_NETRESET: u32 = 0x9800000F;
    pub(super) const SIO_TCP_INITIAL_RTO: u32 = 0x98000011;
    pub(super) const TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS: u8 = 0xFE; // (UCHAR)-2

    pub(super) const WSAEINTR: c_int = 10004;
    pub(super) const WSAEBADF: c_int = 10009;
    pub(super) const WSAEINVAL: c_int = 10022;
    pub(super) const WSAEWOULDBLOCK: c_int = 10035;
    pub(super) const WSAEINPROGRESS: c_int = 10036;
    pub(super) const WSAEALREADY: c_int = 10037;
    pub(super) const WSAENOPROTOOPT: c_int = 10042;
    pub(super) const WSAEOPNOTSUPP: c_int = 10045;
    pub(super) const WSAEAFNOSUPPORT: c_int = 10047;
    pub(super) const WSAENETDOWN: c_int = 10050;
    pub(super) const WSAENETRESET: c_int = 10052;
    pub(super) const WSAECONNRESET: c_int = 10054;
    pub(super) const WSAENOBUFS: c_int = 10055;

    pub(super) const ERROR_PATH_NOT_FOUND: u32 = 3;
    pub(super) const ERROR_FILENAME_EXCED_RANGE: u32 = 206;

    pub(super) const INADDR_ANY: u32 = 0;
    pub(super) const INADDR_LOOPBACK: u32 = 0x7F000001;
    pub(super) const IN6ADDR_ANY: [u8; 16] = [0; 16];
    pub(super) const IN6ADDR_LOOPBACK: [u8; 16] = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1];

    #[repr(C)]
    pub(super) struct sockaddr_un {
        pub sun_family: u16,
        pub sun_path: [c_char; 108],
    }

    #[repr(C)]
    pub(super) struct ip_mreq {
        pub imr_multiaddr: in_addr,
        pub imr_interface: in_addr,
    }
    #[repr(C)]
    pub(super) struct ipv6_mreq {
        pub ipv6mr_multiaddr: in6_addr,
        pub ipv6mr_interface: u32,
    }
    #[repr(C)]
    pub(super) struct ip_mreq_source {
        pub imr_multiaddr: in_addr,
        pub imr_sourceaddr: in_addr,
        pub imr_interface: in_addr,
    }
    #[repr(C)]
    pub(super) struct group_source_req {
        pub gsr_interface: u32,
        pub gsr_group: sockaddr_storage,
        pub gsr_source: sockaddr_storage,
    }
    #[repr(C)]
    pub(super) struct TCP_INITIAL_RTO_PARAMETERS {
        pub Rtt: u16,
        pub MaxSynRetransmissions: u8,
    }

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        pub(super) fn socket(af: c_int, socket_type: c_int, protocol: c_int) -> SOCKET;
        pub(super) fn setsockopt(
            s: SOCKET,
            level: c_int,
            optname: c_int,
            optval: *const c_char,
            optlen: c_int,
        ) -> c_int;
        pub(super) fn getsockopt(
            s: SOCKET,
            level: c_int,
            optname: c_int,
            optval: *mut c_char,
            optlen: *mut c_int,
        ) -> c_int;
        pub(super) fn getsockname(s: SOCKET, name: *mut sockaddr, namelen: *mut c_int) -> c_int;
        pub(super) fn getpeername(s: SOCKET, name: *mut sockaddr, namelen: *mut c_int) -> c_int;
        pub(super) fn connect(s: SOCKET, name: *const sockaddr, namelen: c_int) -> c_int;
        pub(super) fn bind(s: SOCKET, name: *const sockaddr, namelen: c_int) -> c_int;
        pub(super) fn listen(s: SOCKET, backlog: c_int) -> c_int;
        pub(super) fn accept(s: SOCKET, addr: *mut sockaddr, addrlen: *mut c_int) -> SOCKET;
        pub(super) fn recvfrom(
            s: SOCKET,
            buf: *mut c_char,
            len: c_int,
            flags: c_int,
            from: *mut sockaddr,
            fromlen: *mut c_int,
        ) -> c_int;
        pub(super) fn sendto(
            s: SOCKET,
            buf: *const c_char,
            len: c_int,
            flags: c_int,
            to: *const sockaddr,
            tolen: c_int,
        ) -> c_int;
        pub(super) fn shutdown(s: SOCKET, how: c_int) -> c_int;
        pub(super) fn ioctlsocket(s: SOCKET, cmd: u32, argp: *mut u32) -> c_int;
        pub(super) fn WSAIoctl(
            s: SOCKET,
            dwIoControlCode: u32,
            lpvInBuffer: *mut c_void,
            cbInBuffer: u32,
            lpvOutBuffer: *mut c_void,
            cbOutBuffer: u32,
            lpcbBytesReturned: *mut u32,
            lpOverlapped: *mut c_void,
            lpCompletionRoutine: *mut c_void,
        ) -> c_int;
    }
    #[link(name = "kernel32")]
    unsafe extern "system" {
        pub(super) fn SetLastError(dwErrCode: u32);
    }

    #[inline(always)]
    pub(super) unsafe fn sso(
        fd: SOCKET,
        level: c_int,
        opt: c_int,
        val: *const c_void,
        len: socklen_t,
    ) -> c_int {
        // SAFETY: thin setsockopt wrapper; caller provides valid optval/len.
        unsafe { setsockopt(fd, level, opt, val.cast::<c_char>(), len) }
    }
}

#[cfg(windows)]
use win as plat;

// ═══════════════════════════════════════════════════════════════════════════
// Fault-injection hook
// ═══════════════════════════════════════════════════════════════════════════

#[allow(non_camel_case_types)]
#[repr(C)]
pub enum us_fault_syscall {
    US_FAULT_RECV = 0,
    US_FAULT_SEND = 1,
    US_FAULT_WRITEV = 2,
    US_FAULT_SENDMSG = 3,
    US_FAULT_RECVMSG = 4,
    US_FAULT_CONNECT = 5,
    US_FAULT_ACCEPT = 6,
    US_FAULT_SOCKET = 7,
    US_FAULT_CLOSE = 8,
    US_FAULT_SHUTDOWN = 9,
    US_FAULT_SSL_LOOP_BUFFER = 10,
    US_FAULT_COUNT = 11,
}

#[cfg(socket_fault_injection)]
unsafe extern "C" {
    static us_fault_armed: core::sync::atomic::AtomicI32;
    fn us_fault_hit(syscall: c_int, fd: c_int, out: *mut ssize_t, clamp: *mut c_int) -> c_int;
}

#[inline(always)]
unsafe fn us_fault_check(
    _sc: us_fault_syscall,
    _fd: LIBUS_SOCKET_DESCRIPTOR,
    _out: *mut ssize_t,
    _clamp: *mut c_int,
) -> bool {
    #[cfg(socket_fault_injection)]
    unsafe {
        use core::sync::atomic::Ordering;
        if us_fault_armed.load(Ordering::Acquire) != 0 {
            return us_fault_hit(_sc as c_int, _fd as c_int, _out, _clamp) != 0;
        }
    }
    false
}

// ═══════════════════════════════════════════════════════════════════════════
// Debug network-traffic logging (BUN_RECV / BUN_SEND)
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(debug_assertions)]
mod debug_log {
    use super::*;
    use core::sync::atomic::{AtomicI32, AtomicPtr, Ordering};

    static RECV_FILE: AtomicPtr<libc::FILE> = AtomicPtr::new(ptr::null_mut());
    static SEND_FILE: AtomicPtr<libc::FILE> = AtomicPtr::new(ptr::null_mut());
    static INITIALIZED: AtomicI32 = AtomicI32::new(0);

    unsafe fn init() {
        if INITIALIZED.load(Ordering::Relaxed) != 0 {
            return;
        }
        INITIALIZED.store(1, Ordering::Relaxed);
        // SAFETY: C-string literals; getenv returns thread-local borrowed ptr.
        unsafe {
            let recv_path = libc::getenv(c"BUN_RECV".as_ptr());
            let send_path = libc::getenv(c"BUN_SEND".as_ptr());
            if !recv_path.is_null() && RECV_FILE.load(Ordering::Relaxed).is_null() {
                RECV_FILE.store(libc::fopen(recv_path, c"w".as_ptr()), Ordering::Relaxed);
            }
            if !send_path.is_null() && SEND_FILE.load(Ordering::Relaxed).is_null() {
                SEND_FILE.store(libc::fopen(send_path, c"w".as_ptr()), Ordering::Relaxed);
            }
        }
    }

    pub(super) unsafe fn on_recv(buf: *const c_void, n: usize) {
        // SAFETY: caller passes a buffer with at least `n` readable bytes.
        unsafe {
            init();
            let f = RECV_FILE.load(Ordering::Relaxed);
            if !f.is_null() {
                libc::fwrite(buf, 1, n, f);
                libc::fflush(f);
            }
        }
    }
    pub(super) unsafe fn on_send(buf: *const c_void, n: usize) {
        // SAFETY: caller passes a buffer with at least `n` readable bytes.
        unsafe {
            init();
            let f = SEND_FILE.load(Ordering::Relaxed);
            if !f.is_null() {
                libc::fwrite(buf, 1, n, f);
                libc::fflush(f);
            }
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UDP buffer structs (ABI-locked)
// ═══════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
#[repr(C)]
pub struct udp_recvbuf {
    msgvec: [plat::mmsghdr; LIBUS_UDP_RECV_COUNT],
    iov: [libc::iovec; LIBUS_UDP_RECV_COUNT],
    addr: [sockaddr_storage; LIBUS_UDP_RECV_COUNT],
    control: [[c_char; 256]; LIBUS_UDP_RECV_COUNT],
}

#[cfg(windows)]
#[repr(C)]
pub struct udp_recvbuf {
    pub buf: *mut c_char,
    pub buflen: usize,
    pub recvlen: usize,
    pub addr: sockaddr_storage,
}

/// `struct udp_sendbuf` — POSIX layout is `{ bits:u32, num:u32, msgvec[] }`.
#[cfg(not(windows))]
#[repr(C)]
pub struct udp_sendbuf {
    bits: u32,
    pub num: c_uint,
    // followed by a flexible `mmsghdr msgvec[]` in the same allocation
}

#[cfg(not(windows))]
impl udp_sendbuf {
    const HAS_EMPTY: u32 = 1 << 0;
    const HAS_ADDRESSES: u32 = 1 << 1;

    #[inline]
    fn has_empty(&self) -> bool {
        self.bits & Self::HAS_EMPTY != 0
    }
    #[inline]
    fn set_has_empty(&mut self, v: bool) {
        if v {
            self.bits |= Self::HAS_EMPTY
        } else {
            self.bits &= !Self::HAS_EMPTY
        }
    }
    #[inline]
    fn has_addresses(&self) -> bool {
        self.bits & Self::HAS_ADDRESSES != 0
    }
    #[inline]
    fn set_has_addresses(&mut self, v: bool) {
        if v {
            self.bits |= Self::HAS_ADDRESSES
        } else {
            self.bits &= !Self::HAS_ADDRESSES
        }
    }
    #[inline]
    unsafe fn msgvec(this: *mut Self) -> *mut plat::mmsghdr {
        // SAFETY: flexible-array member follows the fixed header.
        unsafe { this.add(1).cast() }
    }
}

#[cfg(windows)]
#[repr(C)]
pub struct udp_sendbuf {
    pub payloads: *mut *mut c_void,
    pub lengths: *mut usize,
    pub addresses: *mut *mut c_void,
    pub num: c_int,
}

// ═══════════════════════════════════════════════════════════════════════════
// UDP batched send/recv
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_sendmmsg(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    sendbuf: *mut udp_sendbuf,
    flags: c_int,
) -> c_int {
    #[cfg(windows)]
    unsafe {
        let sb = &mut *sendbuf;
        let mut i = 0;
        while i < sb.num {
            loop {
                let addr = (*sb.addresses.add(i as usize)).cast::<plat::sockaddr>();
                let payload = (*sb.payloads.add(i as usize)).cast::<c_char>().cast_const();
                let len = *sb.lengths.add(i as usize) as c_int;
                let ret: c_int = if addr.is_null() || (*addr).sa_family as c_int == plat::AF_UNSPEC
                {
                    win::ws_send(fd, payload.cast(), len, flags)
                } else if (*addr).sa_family as c_int == plat::AF_INET {
                    plat::sendto(
                        fd,
                        payload,
                        len,
                        flags,
                        addr,
                        size_of::<plat::sockaddr_in>() as c_int,
                    )
                } else if (*addr).sa_family as c_int == plat::AF_INET6 {
                    plat::sendto(
                        fd,
                        payload,
                        len,
                        flags,
                        addr,
                        size_of::<plat::sockaddr_in6>() as c_int,
                    )
                } else {
                    set_errno(libc::EAFNOSUPPORT);
                    return -1;
                };
                let err = win::WSAGetLastError();
                if ret < 0 {
                    if err == win::WSAEINTR {
                        continue;
                    }
                    if err == win::WSAEWOULDBLOCK {
                        return i;
                    }
                    return ret;
                }
                break;
            }
            i += 1;
        }
        return sb.num;
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    // SAFETY: FFI; caller guarantees `sendbuf` is a valid udp_sendbuf with `num` initialized entries.
    unsafe {
        let sb = &mut *sendbuf;
        let msgvec = udp_sendbuf::msgvec(sendbuf);
        // sendmsg_x does not support addresses.
        if !sb.has_empty()
            && !sb.has_addresses()
            && plat::Bun__doesMacOSVersionSupportSendRecvMsgX() != 0
        {
            loop {
                let ret = plat::sendmsg_x(fd, msgvec, sb.num, flags);
                if ret >= 0 {
                    return ret as c_int;
                }
                // On EMSGSIZE fall back to per-message sendmsg.
                if errno() == libc::EMSGSIZE {
                    break;
                }
                if errno() != libc::EINTR {
                    return ret as c_int;
                }
            }
        }
        let count = sb.num as usize;
        let mut i = 0usize;
        while i < count {
            loop {
                let ret = libc::sendmsg(fd, &raw const (*msgvec.add(i)).msg_hdr, flags);
                if ret < 0 {
                    let e = errno();
                    if e == libc::EINTR {
                        continue;
                    }
                    if e == libc::EAGAIN || e == libc::EWOULDBLOCK {
                        return i as c_int;
                    }
                    return ret as c_int;
                }
                break;
            }
            i += 1;
        }
        return sb.num as c_int;
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    // SAFETY: FFI; caller guarantees `sendbuf` is a valid udp_sendbuf with `num` initialized entries.
    unsafe {
        let sb = &mut *sendbuf;
        let msgvec = udp_sendbuf::msgvec(sendbuf);
        loop {
            let ret = plat::sendmmsg(fd, msgvec, sb.num as _, flags | plat::MSG_NOSIGNAL);
            if ret >= 0 || errno() != libc::EINTR {
                return ret as c_int;
            }
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_recvmmsg(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    recvbuf: *mut udp_recvbuf,
    flags: c_int,
) -> c_int {
    #[cfg(windows)]
    unsafe {
        loop {
            let mut addr_len: c_int = size_of::<sockaddr_storage>() as c_int;
            let ret = plat::recvfrom(
                fd,
                (*recvbuf).buf,
                LIBUS_RECV_BUFFER_LENGTH as c_int,
                flags,
                (&raw mut (*recvbuf).addr).cast(),
                &raw mut addr_len,
            ) as isize;
            if ret < 0 {
                let err = win::WSAGetLastError();
                if err == win::WSAEINTR {
                    continue;
                }
                // Winsock surfaces ICMP "port/host unreachable" from a previous
                // sendto as WSAECONNRESET / WSAENETRESET. Per-destination, not
                // per-socket — treat as "no packet" and retry. Mirrors libuv.
                if err == win::WSAECONNRESET || err == win::WSAENETRESET {
                    continue;
                }
                return ret as c_int;
            }
            (*recvbuf).recvlen = ret as usize;
            return 1;
        }
    }

    #[cfg(any(target_os = "macos", target_os = "ios"))]
    // SAFETY: FFI; caller guarantees `recvbuf` is a valid udp_recvbuf set up via bsd_udp_setup_recvbuf.
    unsafe {
        if plat::Bun__doesMacOSVersionSupportSendRecvMsgX() != 0 {
            loop {
                let ret = plat::recvmsg_x(
                    fd,
                    (*recvbuf).msgvec.as_ptr(),
                    LIBUS_UDP_RECV_COUNT as c_uint,
                    flags,
                );
                if ret >= 0 || errno() != libc::EINTR {
                    return ret as c_int;
                }
            }
        }
        let mut i = 0usize;
        while i < LIBUS_UDP_RECV_COUNT {
            loop {
                let ret = libc::recvmsg(fd, &raw mut (*recvbuf).msgvec[i].msg_hdr, flags);
                if ret < 0 {
                    let e = errno();
                    if e == libc::EINTR {
                        continue;
                    }
                    if e == libc::EAGAIN || e == libc::EWOULDBLOCK {
                        return i as c_int;
                    }
                    return ret as c_int;
                }
                (*recvbuf).msgvec[i].msg_len = ret as usize;
                break;
            }
            i += 1;
        }
        return LIBUS_UDP_RECV_COUNT as c_int;
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    // SAFETY: FFI; caller guarantees `recvbuf` is a valid udp_recvbuf set up via bsd_udp_setup_recvbuf.
    unsafe {
        loop {
            let ret = plat::recvmmsg(
                fd,
                (*recvbuf).msgvec.as_mut_ptr(),
                LIBUS_UDP_RECV_COUNT as _,
                flags as _,
                ptr::null_mut(),
            );
            if ret >= 0 || errno() != libc::EINTR {
                return ret as c_int;
            }
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_setup_recvbuf(
    recvbuf: *mut udp_recvbuf,
    databuf: *mut c_void,
    databuflen: usize,
) {
    #[cfg(windows)]
    unsafe {
        (*recvbuf).buf = databuf.cast();
        (*recvbuf).buflen = databuflen;
    }
    #[cfg(not(windows))]
    // SAFETY: FFI; caller owns `recvbuf` and provides a `databuf` of LIBUS_UDP_RECV_COUNT*LIBUS_UDP_MAX_SIZE bytes.
    unsafe {
        ptr::write_bytes(recvbuf, 0, 1);
        let rb = &mut *recvbuf;
        for i in 0..LIBUS_UDP_RECV_COUNT {
            rb.iov[i].iov_base = databuf.cast::<c_char>().add(i * LIBUS_UDP_MAX_SIZE).cast();
            rb.iov[i].iov_len = LIBUS_UDP_MAX_SIZE;
            let mut mh: libc::msghdr = MaybeUninit::zeroed().assume_init();
            mh.msg_name = (&raw mut rb.addr[i]).cast();
            mh.msg_namelen = size_of::<sockaddr_storage>() as _;
            mh.msg_iov = &raw mut rb.iov[i];
            mh.msg_iovlen = 1 as _;
            mh.msg_control = rb.control[i].as_mut_ptr().cast();
            mh.msg_controllen = 256 as _;
            rb.msgvec[i].msg_hdr = mh;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_setup_sendbuf(
    buf: *mut udp_sendbuf,
    bufsize: usize,
    payloads: *mut *mut c_void,
    lengths: *mut usize,
    addresses: *mut *mut c_void,
    num: c_int,
) -> c_int {
    #[cfg(windows)]
    unsafe {
        (*buf).payloads = payloads;
        (*buf).lengths = lengths;
        (*buf).addresses = addresses;
        (*buf).num = num;
        return num;
    }
    #[cfg(not(windows))]
    // SAFETY: FFI; caller owns `buf` (bufsize bytes) and `payloads`/`lengths`/`addresses` each have `num` entries.
    unsafe {
        (*buf).set_has_empty(false);
        // sendmsg_x docs state it does not support addresses.
        (*buf).set_has_addresses(false);

        let msgvec = udp_sendbuf::msgvec(buf);
        let mut count = (bufsize - size_of::<udp_sendbuf>())
            / (size_of::<plat::mmsghdr>() + size_of::<libc::iovec>());
        if count > num as usize {
            count = num as usize;
        }
        // iov array is laid out immediately after msgvec[count] in the same buffer.
        let iov = msgvec.add(count).cast::<libc::iovec>();
        for i in 0..count {
            let addr = (*addresses.add(i)).cast::<plat::sockaddr>();
            let mut addr_len: socklen_t = 0;
            if !addr.is_null() {
                let fam = (*addr).sa_family as c_int;
                addr_len = if fam == plat::AF_INET {
                    size_of::<plat::sockaddr_in>() as socklen_t
                } else if fam == plat::AF_INET6 {
                    size_of::<plat::sockaddr_in6>() as socklen_t
                } else {
                    0
                };
                if addr_len > 0 {
                    (*buf).set_has_addresses(true);
                }
            }
            (*iov.add(i)).iov_base = *payloads.add(i);
            (*iov.add(i)).iov_len = *lengths.add(i);
            let mh = &mut (*msgvec.add(i)).msg_hdr;
            mh.msg_name = *addresses.add(i);
            mh.msg_namelen = addr_len;
            mh.msg_control = ptr::null_mut();
            mh.msg_controllen = 0;
            mh.msg_iov = iov.add(i);
            mh.msg_iovlen = 1 as _;
            mh.msg_flags = 0;
            (*msgvec.add(i)).msg_len = 0;

            if *lengths.add(i) == 0 {
                (*buf).set_has_empty(true);
            }
        }
        (*buf).num = count as c_uint;
        count as c_int
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UDP packet-buffer accessors
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_packet_buffer_local_ip(
    msgvec: *mut udp_recvbuf,
    index: c_int,
    ip: *mut c_char,
) -> c_int {
    #[cfg(any(windows, target_os = "macos", target_os = "ios"))]
    {
        let _ = (msgvec, index, ip);
        return 0;
    }
    #[cfg(not(any(windows, target_os = "macos", target_os = "ios")))]
    // SAFETY: FFI; `msgvec` is a valid recv buffer with at least `index+1` entries, `ip` has room for 16 bytes.
    unsafe {
        let mh: *mut libc::msghdr =
            &raw mut (*(msgvec.cast::<plat::mmsghdr>().add(index as usize))).msg_hdr;
        let mut cmsg = libc::CMSG_FIRSTHDR(mh);
        while !cmsg.is_null() {
            if (*cmsg).cmsg_level == plat::IPPROTO_IP {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                if (*cmsg).cmsg_type == plat::IP_PKTINFO {
                    // CMSG_DATA is aligned for the declared level/type payload.
                    #[allow(clippy::cast_ptr_alignment)]
                    let pi = libc::CMSG_DATA(cmsg).cast::<plat::in_pktinfo>();
                    ptr::copy_nonoverlapping(
                        (&raw const (*pi).ipi_addr).cast::<u8>(),
                        ip.cast::<u8>(),
                        4,
                    );
                    return 4;
                }
                #[cfg(target_os = "freebsd")]
                if (*cmsg).cmsg_type == plat::IP_RECVDSTADDR {
                    ptr::copy_nonoverlapping(libc::CMSG_DATA(cmsg), ip.cast::<u8>(), 4);
                    return 4;
                }
            }
            if (*cmsg).cmsg_level == plat::IPPROTO_IPV6 && (*cmsg).cmsg_type == plat::IPV6_PKTINFO {
                // CMSG_DATA is aligned for the declared level/type payload.
                #[allow(clippy::cast_ptr_alignment)]
                let pi6 = libc::CMSG_DATA(cmsg).cast::<plat::in6_pktinfo>();
                ptr::copy_nonoverlapping(
                    (&raw const (*pi6).ipi6_addr).cast::<u8>(),
                    ip.cast::<u8>(),
                    16,
                );
                return 16;
            }
            cmsg = libc::CMSG_NXTHDR(mh, cmsg);
        }
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_packet_buffer_peer(
    msgvec: *mut udp_recvbuf,
    index: c_int,
) -> *mut c_char {
    #[cfg(windows)]
    unsafe {
        (&raw mut (*msgvec).addr).cast()
    }
    #[cfg(not(windows))]
    // SAFETY: FFI; `msgvec` is a valid recv buffer with at least `index+1` entries.
    unsafe {
        (*(msgvec.cast::<plat::mmsghdr>().add(index as usize)))
            .msg_hdr
            .msg_name
            .cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_packet_buffer_payload(
    msgvec: *mut udp_recvbuf,
    index: c_int,
) -> *mut c_char {
    #[cfg(windows)]
    unsafe {
        (*msgvec).buf
    }
    #[cfg(not(windows))]
    // SAFETY: FFI; `msgvec` is a valid recv buffer with at least `index+1` entries.
    unsafe {
        (*(*(msgvec.cast::<plat::mmsghdr>().add(index as usize)))
            .msg_hdr
            .msg_iov)
            .iov_base
            .cast()
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_packet_buffer_payload_length(
    msgvec: *mut udp_recvbuf,
    index: c_int,
) -> c_int {
    #[cfg(windows)]
    unsafe {
        (*msgvec).recvlen as c_int
    }
    #[cfg(not(windows))]
    // SAFETY: FFI; `msgvec` is a valid recv buffer with at least `index+1` entries.
    unsafe {
        // Clamp so a truncated datagram never reports more bytes than we
        // actually copied (Darwin recvmsg_x may report original length).
        let len = (*(msgvec.cast::<plat::mmsghdr>().add(index as usize))).msg_len as c_int;
        if len > LIBUS_UDP_MAX_SIZE as c_int {
            LIBUS_UDP_MAX_SIZE as c_int
        } else {
            len
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_udp_packet_buffer_truncated(
    msgvec: *mut udp_recvbuf,
    index: c_int,
) -> c_int {
    #[cfg(windows)]
    {
        let _ = (msgvec, index);
        0
    }
    #[cfg(not(windows))]
    // SAFETY: FFI; `msgvec` is a valid recv buffer with at least `index+1` entries.
    unsafe {
        let flags = (*(msgvec.cast::<plat::mmsghdr>().add(index as usize)))
            .msg_hdr
            .msg_flags;
        if flags & plat::MSG_TRUNC != 0 { 1 } else { 0 }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket setup / options
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn apple_no_sigpipe(fd: LIBUS_SOCKET_DESCRIPTOR) -> LIBUS_SOCKET_DESCRIPTOR {
    #[cfg(any(target_os = "macos", target_os = "ios"))]
    if fd != LIBUS_SOCKET_ERROR {
        let one: c_int = 1;
        // SAFETY: valid fd, optval points to a live c_int.
        unsafe {
            plat::sso(
                fd,
                plat::SOL_SOCKET,
                plat::SO_NOSIGPIPE,
                (&raw const one).cast(),
                size_of::<c_int>() as _,
            )
        };
    }
    fd
}

#[inline]
unsafe fn win32_set_nonblocking(fd: LIBUS_SOCKET_DESCRIPTOR) -> LIBUS_SOCKET_DESCRIPTOR {
    #[cfg(windows)]
    if fd != LIBUS_SOCKET_ERROR {
        // libuv sets non-blocking at poll init; connect needs it earlier.
        let mut yes: u32 = 1;
        // SAFETY: valid SOCKET, FIONBIO writes through argp.
        unsafe { win::ioctlsocket(fd, win::FIONBIO, &raw mut yes) };
    }
    fd
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_set_nonblocking(
    fd: LIBUS_SOCKET_DESCRIPTOR,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // Libuv sets Windows sockets non-blocking itself.
    #[cfg(not(windows))]
    if fd != LIBUS_SOCKET_ERROR {
        // SAFETY: fcntl on a valid fd; result ignored to match C.
        unsafe {
            let flags = plat::fcntl(fd, plat::F_GETFL, 0);
            plat::fcntl(fd, plat::F_SETFL, flags | plat::O_NONBLOCK);
            let flags = plat::fcntl(fd, plat::F_GETFD, 0);
            plat::fcntl(fd, plat::F_SETFD, flags | plat::FD_CLOEXEC);
        }
    }
    fd
}

unsafe fn setsockopt_6_or_4(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    option4: c_int,
    option6: c_int,
    val: *const c_void,
    len: socklen_t,
) -> c_int {
    // SAFETY: caller guarantees val/len validity.
    let res = unsafe { plat::sso(fd, plat::IPPROTO_IPV6, option6, val, len) };
    if res == 0 {
        return 0;
    }
    #[cfg(windows)]
    let fallthrough = {
        let err = win::WSAGetLastError();
        err == win::WSAENOPROTOOPT || err == win::WSAEINVAL
    };
    #[cfg(not(windows))]
    let fallthrough = {
        // SAFETY: reads thread-local errno; always valid.
        let e = unsafe { errno() };
        e == libc::ENOPROTOOPT || e == libc::EINVAL
    };
    if fallthrough {
        // SAFETY: caller guarantees val/len validity.
        return unsafe { plat::sso(fd, plat::IPPROTO_IP, option4, val, len) };
    }
    res
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_nodelay(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: c_int) {
    // SAFETY: optval is a live c_int.
    unsafe {
        plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_NODELAY,
            (&raw const enabled).cast(),
            size_of::<c_int>() as _,
        )
    };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_broadcast(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    enabled: c_int,
) -> c_int {
    // SAFETY: optval is a live c_int.
    unsafe {
        plat::sso(
            fd,
            plat::SOL_SOCKET,
            plat::SO_BROADCAST,
            (&raw const enabled).cast(),
            size_of::<c_int>() as _,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_multicast_loopback(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    enabled: c_int,
) -> c_int {
    // SAFETY: optval is a live c_int.
    unsafe {
        setsockopt_6_or_4(
            fd,
            plat::IP_MULTICAST_LOOP,
            plat::IPV6_MULTICAST_LOOP,
            (&raw const enabled).cast(),
            size_of::<c_int>() as _,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_multicast_interface(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *const sockaddr_storage,
) -> c_int {
    // SAFETY: FFI; caller guarantees `addr` points to a valid sockaddr_storage.
    unsafe {
        #[cfg(windows)]
        if fd == win::SOCKET_ERROR as usize as LIBUS_SOCKET_DESCRIPTOR {
            win::WSASetLastError(win::WSAEBADF);
            set_errno(libc::EBADF);
            return -1;
        }
        if (*addr).ss_family as c_int == plat::AF_INET {
            let addr4 = addr.cast::<plat::sockaddr_in>();
            let first_octet = ntohl((*addr4).sin_addr.s_addr) >> 24;
            // 224.0.0.0/4 is multicast — not a valid interface address.
            if !(224..=239).contains(&first_octet) {
                return plat::sso(
                    fd,
                    plat::IPPROTO_IP,
                    plat::IP_MULTICAST_IF,
                    (&raw const (*addr4).sin_addr).cast(),
                    size_of::<plat::in_addr>() as _,
                );
            }
        }
        if (*addr).ss_family as c_int == plat::AF_INET6 {
            let addr6 = addr.cast::<plat::sockaddr_in6>();
            return plat::sso(
                fd,
                plat::IPPROTO_IPV6,
                plat::IPV6_MULTICAST_IF,
                (&raw const (*addr6).sin6_scope_id).cast(),
                size_of::<u32>() as _,
            );
        }
        #[cfg(windows)]
        win::WSASetLastError(win::WSAEINVAL);
        set_errno(libc::EINVAL);
        -1
    }
}

unsafe fn bsd_socket_set_membership4(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *const plat::sockaddr_in,
    iface: *const plat::sockaddr_in,
    drop: c_int,
) -> c_int {
    // SAFETY: caller guarantees `addr` is valid and `iface` is null or valid; ip_mreq is zeroable.
    unsafe {
        let mut mreq: plat::ip_mreq = MaybeUninit::zeroed().assume_init();
        mreq.imr_multiaddr.s_addr = (*addr).sin_addr.s_addr;
        mreq.imr_interface.s_addr = if iface.is_null() {
            htonl(plat::INADDR_ANY)
        } else {
            (*iface).sin_addr.s_addr
        };
        let option = if drop != 0 {
            plat::IP_DROP_MEMBERSHIP
        } else {
            plat::IP_ADD_MEMBERSHIP
        };
        plat::sso(
            fd,
            plat::IPPROTO_IP,
            option,
            (&raw const mreq).cast(),
            size_of::<plat::ip_mreq>() as _,
        )
    }
}

unsafe fn bsd_socket_set_membership6(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *const plat::sockaddr_in6,
    iface: *const plat::sockaddr_in6,
    drop: c_int,
) -> c_int {
    // SAFETY: caller guarantees `addr` is valid and `iface` is null or valid; ipv6_mreq is zeroable.
    unsafe {
        let mut mreq: plat::ipv6_mreq = MaybeUninit::zeroed().assume_init();
        mreq.ipv6mr_multiaddr = (*addr).sin6_addr;
        if !iface.is_null() {
            mreq.ipv6mr_interface = (*iface).sin6_scope_id as _;
        }
        let option = if drop != 0 {
            plat::IPV6_LEAVE_GROUP
        } else {
            plat::IPV6_JOIN_GROUP
        };
        plat::sso(
            fd,
            plat::IPPROTO_IPV6,
            option,
            (&raw const mreq).cast(),
            size_of::<plat::ipv6_mreq>() as _,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_set_membership(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *const sockaddr_storage,
    iface: *const sockaddr_storage,
    drop: c_int,
) -> c_int {
    // SAFETY: FFI; caller guarantees `addr` is valid and `iface` is null or valid.
    unsafe {
        if !iface.is_null() && (*addr).ss_family != (*iface).ss_family {
            set_errno(libc::EINVAL);
            return -1;
        }
        if (*addr).ss_family as c_int == plat::AF_INET6 {
            bsd_socket_set_membership6(fd, addr.cast(), iface.cast(), drop)
        } else {
            bsd_socket_set_membership4(fd, addr.cast(), iface.cast(), drop)
        }
    }
}

unsafe fn bsd_socket_set_source_specific_membership4(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    source: *const plat::sockaddr_in,
    group: *const plat::sockaddr_in,
    iface: *const plat::sockaddr_in,
    drop: c_int,
) -> c_int {
    // SAFETY: caller guarantees `source`/`group` are valid and `iface` is null or valid; ip_mreq_source is zeroable.
    unsafe {
        let mut mreq: plat::ip_mreq_source = MaybeUninit::zeroed().assume_init();
        mreq.imr_interface.s_addr = if iface.is_null() {
            htonl(plat::INADDR_ANY)
        } else {
            (*iface).sin_addr.s_addr
        };
        mreq.imr_sourceaddr.s_addr = (*source).sin_addr.s_addr;
        mreq.imr_multiaddr.s_addr = (*group).sin_addr.s_addr;
        let option = if drop != 0 {
            plat::IP_DROP_SOURCE_MEMBERSHIP
        } else {
            plat::IP_ADD_SOURCE_MEMBERSHIP
        };
        plat::sso(
            fd,
            plat::IPPROTO_IP,
            option,
            (&raw const mreq).cast(),
            size_of::<plat::ip_mreq_source>() as _,
        )
    }
}

unsafe fn bsd_socket_set_source_specific_membership6(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    source: *const plat::sockaddr_in6,
    group: *const plat::sockaddr_in6,
    iface: *const plat::sockaddr_in6,
    drop: c_int,
) -> c_int {
    // SAFETY: caller guarantees `source`/`group` are valid and `iface` is null or valid; group_source_req is zeroable.
    unsafe {
        let mut mreq: plat::group_source_req = MaybeUninit::zeroed().assume_init();
        if !iface.is_null() {
            mreq.gsr_interface = (*iface).sin6_scope_id;
        }
        ptr::copy_nonoverlapping(
            source.cast::<u8>(),
            (&raw mut mreq.gsr_source).cast(),
            size_of::<sockaddr_storage>(),
        );
        ptr::copy_nonoverlapping(
            group.cast::<u8>(),
            (&raw mut mreq.gsr_group).cast(),
            size_of::<sockaddr_storage>(),
        );
        let option = if drop != 0 {
            plat::MCAST_LEAVE_SOURCE_GROUP
        } else {
            plat::MCAST_JOIN_SOURCE_GROUP
        };
        plat::sso(
            fd,
            plat::IPPROTO_IPV6,
            option,
            (&raw const mreq).cast(),
            size_of::<plat::group_source_req>() as _,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_set_source_specific_membership(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    source: *const sockaddr_storage,
    group: *const sockaddr_storage,
    iface: *const sockaddr_storage,
    drop: c_int,
) -> c_int {
    // SAFETY: FFI; caller guarantees `source`/`group` are valid and `iface` is null or valid.
    unsafe {
        if (*source).ss_family == (*group).ss_family
            && (iface.is_null() || (*group).ss_family == (*iface).ss_family)
        {
            if (*source).ss_family as c_int == plat::AF_INET {
                return bsd_socket_set_source_specific_membership4(
                    fd,
                    source.cast(),
                    group.cast(),
                    iface.cast(),
                    drop,
                );
            } else if (*source).ss_family as c_int == plat::AF_INET6 {
                return bsd_socket_set_source_specific_membership6(
                    fd,
                    source.cast(),
                    group.cast(),
                    iface.cast(),
                    drop,
                );
            }
        }
        #[cfg(windows)]
        win::WSASetLastError(win::WSAEINVAL);
        set_errno(libc::EINVAL);
        -1
    }
}

unsafe fn bsd_socket_ttl_any(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    ttl: c_int,
    ipv4: c_int,
    ipv6: c_int,
) -> c_int {
    if !(1..=255).contains(&ttl) {
        #[cfg(windows)]
        win::WSASetLastError(win::WSAEINVAL);
        // SAFETY: writes thread-local errno; always valid.
        unsafe { set_errno(libc::EINVAL) };
        return -1;
    }
    // SAFETY: optval is a live c_int.
    unsafe {
        setsockopt_6_or_4(
            fd,
            ipv4,
            ipv6,
            (&raw const ttl).cast(),
            size_of::<c_int>() as _,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_ttl_unicast(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: c_int) -> c_int {
    // SAFETY: thin setsockopt wrapper; no pointer arguments.
    unsafe { bsd_socket_ttl_any(fd, ttl, plat::IP_TTL, plat::IPV6_UNICAST_HOPS) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_ttl_multicast(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    ttl: c_int,
) -> c_int {
    // SAFETY: thin setsockopt wrapper; no pointer arguments.
    unsafe { bsd_socket_ttl_any(fd, ttl, plat::IP_MULTICAST_TTL, plat::IPV6_MULTICAST_HOPS) }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_keepalive(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    on: c_int,
    delay: c_uint,
) -> c_int {
    #[cfg(not(windows))]
    // SAFETY: all optvals are live stack values; setsockopt only reads them.
    unsafe {
        if plat::sso(
            fd,
            plat::SOL_SOCKET,
            plat::SO_KEEPALIVE,
            (&raw const on).cast(),
            size_of::<c_int>() as _,
        ) != 0
        {
            return errno();
        }
        if on == 0 {
            return 0;
        }
        if delay == 0 {
            return -1;
        }
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        if plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_KEEPIDLE,
            (&raw const delay).cast(),
            size_of::<c_uint>() as _,
        ) != 0
        {
            return errno();
        }
        // Darwin uses TCP_KEEPALIVE in place of TCP_KEEPIDLE.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_KEEPALIVE,
            (&raw const delay).cast(),
            size_of::<c_uint>() as _,
        ) != 0
        {
            return errno();
        }
        let intvl: c_int = 1;
        if plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_KEEPINTVL,
            (&raw const intvl).cast(),
            size_of::<c_int>() as _,
        ) != 0
        {
            return errno();
        }
        let cnt: c_int = 10;
        if plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_KEEPCNT,
            (&raw const cnt).cast(),
            size_of::<c_int>() as _,
        ) != 0
        {
            return errno();
        }
        0
    }
    #[cfg(windows)]
    unsafe {
        if plat::sso(
            fd,
            plat::SOL_SOCKET,
            plat::SO_KEEPALIVE,
            (&raw const on).cast(),
            size_of::<c_int>() as _,
        ) == -1
        {
            return win::WSAGetLastError();
        }
        if on == 0 {
            return 0;
        }
        if delay < 1 {
            // LIBUS_USE_LIBUV is always set on Windows.
            return -4071; // UV_EINVAL
        }
        if plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_KEEPALIVE,
            (&raw const delay).cast(),
            size_of::<c_uint>() as _,
        ) == -1
        {
            return win::WSAGetLastError();
        }
        0
    }
}

unsafe fn bsd_socket_tos_level(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    level: *mut c_int,
    option: *mut c_int,
) -> c_int {
    // SAFETY: caller passes valid out-pointers for `level`/`option`; sockaddr_storage is zeroable.
    unsafe {
        let mut storage: sockaddr_storage = MaybeUninit::zeroed().assume_init();
        let mut addrlen: socklen_t = size_of::<sockaddr_storage>() as _;
        #[cfg(windows)]
        let rc = win::getsockname(fd, (&raw mut storage).cast(), &raw mut addrlen);
        #[cfg(not(windows))]
        let rc = plat::getsockname(fd, (&raw mut storage).cast(), &raw mut addrlen);
        if rc != 0 {
            return -libus_err();
        }
        if storage.ss_family as c_int == plat::AF_INET {
            *level = plat::IPPROTO_IP;
            *option = plat::IP_TOS;
        } else if storage.ss_family as c_int == plat::AF_INET6 {
            *level = plat::IPPROTO_IPV6;
            *option = plat::IPV6_TCLASS;
        } else {
            return -libc::EINVAL;
        }
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_set_tos(fd: LIBUS_SOCKET_DESCRIPTOR, tos: c_int) -> c_int {
    // SAFETY: all optvals are live stack values.
    unsafe {
        let mut level = 0;
        let mut option = 0;
        let err = bsd_socket_tos_level(fd, &raw mut level, &raw mut option);
        if err != 0 {
            return err;
        }
        if plat::sso(
            fd,
            level,
            option,
            (&raw const tos).cast(),
            size_of::<c_int>() as _,
        ) != 0
        {
            return -libus_err();
        }
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_get_tos(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
    // SAFETY: getsockopt writes into live stack `tos`/`len`.
    unsafe {
        let mut level = 0;
        let mut option = 0;
        let err = bsd_socket_tos_level(fd, &raw mut level, &raw mut option);
        if err != 0 {
            return err;
        }
        let mut tos: c_int = 0;
        let mut len: socklen_t = size_of::<c_int>() as _;
        #[cfg(windows)]
        let rc = win::getsockopt(fd, level, option, (&raw mut tos).cast(), &raw mut len);
        #[cfg(not(windows))]
        let rc = plat::getsockopt(fd, level, option, (&raw mut tos).cast(), &raw mut len);
        if rc != 0 {
            return -libus_err();
        }
        tos
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_socket_flush(fd: LIBUS_SOCKET_DESCRIPTOR) {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: optval is a live c_int.
    unsafe {
        let enabled: c_int = 0;
        plat::sso(
            fd,
            plat::IPPROTO_TCP,
            plat::TCP_CORK,
            (&raw const enabled).cast(),
            size_of::<c_int>() as _,
        );
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let _ = fd;
}

// ═══════════════════════════════════════════════════════════════════════════
// Socket lifecycle
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_create_socket(
    domain: c_int,
    type_: c_int,
    protocol: c_int,
    err: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; `err` is null or a valid out-pointer.
    unsafe {
        if !err.is_null() {
            *err = 0;
        }
        let mut created_fd: LIBUS_SOCKET_DESCRIPTOR;
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            let flags = plat::SOCK_CLOEXEC | plat::SOCK_NONBLOCK;
            loop {
                created_fd = plat::socket(domain, type_ | flags, protocol);
                if !is_eintr_fd(created_fd) {
                    break;
                }
            }
            if created_fd == -1 {
                if !err.is_null() {
                    *err = errno();
                }
                return LIBUS_SOCKET_ERROR;
            }
            return apple_no_sigpipe(created_fd);
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        {
            loop {
                created_fd = plat::socket(domain, type_, protocol);
                if !is_eintr_fd(created_fd) {
                    break;
                }
            }
            if created_fd == LIBUS_SOCKET_ERROR {
                if !err.is_null() {
                    *err = errno();
                }
                return LIBUS_SOCKET_ERROR;
            }
            bsd_set_nonblocking(apple_no_sigpipe(created_fd))
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_close_socket(fd: LIBUS_SOCKET_DESCRIPTOR) {
    #[cfg(windows)]
    unsafe {
        win::closesocket(fd)
    };
    #[cfg(not(windows))]
    // SAFETY: FFI; `fd` is a caller-owned descriptor.
    unsafe {
        plat::close(fd)
    };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_shutdown_socket(fd: LIBUS_SOCKET_DESCRIPTOR) {
    #[cfg(windows)]
    unsafe {
        win::shutdown(fd, win::SD_SEND)
    };
    #[cfg(not(windows))]
    // SAFETY: FFI; `fd` is a caller-owned descriptor.
    unsafe {
        plat::shutdown(fd, plat::SHUT_WR)
    };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_shutdown_socket_read(fd: LIBUS_SOCKET_DESCRIPTOR) {
    #[cfg(windows)]
    unsafe {
        win::shutdown(fd, win::SD_RECEIVE)
    };
    #[cfg(not(windows))]
    // SAFETY: FFI; `fd` is a caller-owned descriptor.
    unsafe {
        plat::shutdown(fd, plat::SHUT_RD)
    };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn internal_finalize_bsd_addr(addr: *mut bsd_addr_t) {
    // SAFETY: `mem` is first field, so the struct pointer aliases sockaddr_*.
    unsafe {
        let fam = (*addr).mem.ss_family as c_int;
        if fam == plat::AF_INET6 {
            let a6 = addr.cast::<plat::sockaddr_in6>();
            (*addr).ip = (&raw mut (*a6).sin6_addr).cast();
            (*addr).ip_length = size_of::<plat::in6_addr>() as c_int;
            (*addr).port = ntohs((*a6).sin6_port) as c_int;
        } else if fam == plat::AF_INET {
            let a4 = addr.cast::<plat::sockaddr_in>();
            (*addr).ip = (&raw mut (*a4).sin_addr).cast();
            (*addr).ip_length = size_of::<plat::in_addr>() as c_int;
            (*addr).port = ntohs((*a4).sin_port) as c_int;
        } else {
            (*addr).ip_length = 0;
            (*addr).port = -1;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_local_addr(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *mut bsd_addr_t,
) -> c_int {
    // SAFETY: FFI; caller guarantees `addr` is a valid bsd_addr_t out-pointer.
    unsafe {
        (*addr).len = size_of::<sockaddr_storage>() as _;
        #[cfg(windows)]
        let rc = win::getsockname(fd, (&raw mut (*addr).mem).cast(), &raw mut (*addr).len);
        #[cfg(not(windows))]
        let rc = plat::getsockname(fd, (&raw mut (*addr).mem).cast(), &raw mut (*addr).len);
        if rc != 0 {
            return -1;
        }
        internal_finalize_bsd_addr(addr);
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_remote_addr(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *mut bsd_addr_t,
) -> c_int {
    // SAFETY: FFI; caller guarantees `addr` is a valid bsd_addr_t out-pointer.
    unsafe {
        (*addr).len = size_of::<sockaddr_storage>() as _;
        #[cfg(windows)]
        let rc = win::getpeername(fd, (&raw mut (*addr).mem).cast(), &raw mut (*addr).len);
        #[cfg(not(windows))]
        let rc = plat::getpeername(fd, (&raw mut (*addr).mem).cast(), &raw mut (*addr).len);
        if rc != 0 {
            return -1;
        }
        internal_finalize_bsd_addr(addr);
        0
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_addr_get_ip(addr: *mut bsd_addr_t) -> *mut c_char {
    // SAFETY: FFI; caller guarantees `addr` is a valid bsd_addr_t.
    unsafe { (*addr).ip }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_addr_get_ip_length(addr: *mut bsd_addr_t) -> c_int {
    // SAFETY: FFI; caller guarantees `addr` is a valid bsd_addr_t.
    unsafe { (*addr).ip_length }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_addr_get_port(addr: *mut bsd_addr_t) -> c_int {
    // SAFETY: FFI; caller guarantees `addr` is a valid bsd_addr_t.
    unsafe { (*addr).port }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_accept_socket(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *mut bsd_addr_t,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; caller guarantees `addr` is a valid bsd_addr_t out-pointer.
    unsafe {
        let mut injected: ssize_t = 0;
        let mut unused: c_int = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_ACCEPT,
            fd,
            &raw mut injected,
            &raw mut unused,
        ) {
            return LIBUS_SOCKET_ERROR;
        }

        let accepted_fd: LIBUS_SOCKET_DESCRIPTOR;
        loop {
            (*addr).len = size_of::<sockaddr_storage>() as _;
            #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
            let afd = plat::accept4(
                fd,
                addr.cast::<plat::sockaddr>(),
                &raw mut (*addr).len,
                plat::SOCK_CLOEXEC | plat::SOCK_NONBLOCK,
            );
            #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
            let afd = plat::accept(fd, addr.cast::<plat::sockaddr>(), &raw mut (*addr).len);

            if is_eintr_fd(afd) {
                continue;
            }
            if afd == LIBUS_SOCKET_ERROR {
                return LIBUS_SOCKET_ERROR;
            }
            // XNU bug: accept() can return a socket with addrlen=0 when an
            // IPv4-on-dual-stack connection was aborted. There may still be
            // buffered connectx() data; peek before discarding.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if (*addr).len == 0 {
                let mut peek_buf: [c_char; 1] = [0];
                let has_data = libc::recv(
                    afd,
                    peek_buf.as_mut_ptr().cast(),
                    1,
                    plat::MSG_PEEK | plat::MSG_DONTWAIT,
                );
                if has_data <= 0 {
                    bsd_close_socket(afd);
                    continue;
                }
            }
            accepted_fd = afd;
            break;
        }

        internal_finalize_bsd_addr(addr);

        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            accepted_fd
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        {
            bsd_set_nonblocking(apple_no_sigpipe(accepted_fd))
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// I/O wrappers
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_recv(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    buf: *mut c_void,
    mut length: c_int,
    flags: c_int,
) -> ssize_t {
    // SAFETY: FFI; caller guarantees `buf` has `length` writable bytes.
    unsafe {
        let mut injected: ssize_t = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_RECV,
            fd,
            &raw mut injected,
            &raw mut length,
        ) {
            return injected;
        }
        loop {
            #[cfg(windows)]
            let ret = win::ws_recv(fd, buf, length, flags) as ssize_t;
            #[cfg(not(windows))]
            let ret = plat::recv(fd, buf, length as usize, flags);
            if is_eintr(ret) {
                continue;
            }
            #[cfg(debug_assertions)]
            if ret > 0 {
                debug_log::on_recv(buf, ret as usize);
            }
            return ret;
        }
    }
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_recvmsg(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    msg: *mut libc::msghdr,
    flags: c_int,
) -> ssize_t {
    // SAFETY: FFI; caller guarantees `msg` is a valid msghdr.
    unsafe {
        let mut injected: ssize_t = 0;
        let mut unused: c_int = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_RECVMSG,
            fd,
            &raw mut injected,
            &raw mut unused,
        ) {
            return injected;
        }
        loop {
            let ret = plat::recvmsg(fd, msg, flags);
            if is_eintr(ret) {
                continue;
            }
            return ret;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_writev(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    iov: *const us_iovec_t,
    mut count: c_int,
) -> ssize_t {
    #[cfg(not(windows))]
    // SAFETY: FFI; caller guarantees `iov` points to `count` valid iovecs.
    unsafe {
        let mut injected: ssize_t = 0;
        let mut unused: c_int = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_WRITEV,
            fd,
            &raw mut injected,
            &raw mut unused,
        ) {
            return injected;
        }
        // writev fails with EINVAL past IOV_MAX; cap and let the caller's
        // partial-write path carry the remainder.
        if count > 1024 {
            count = 1024;
        }
        loop {
            let written = plat::writev(fd, iov.cast(), count);
            if is_eintr(written) {
                continue;
            }
            return written;
        }
    }
    #[cfg(windows)]
    unsafe {
        let mut total: ssize_t = 0;
        let mut i = 0;
        while i < count {
            let v = &*iov.add(i as usize);
            let written = bsd_send(fd, v.iov_base.cast(), v.iov_len as c_int);
            if written > 0 {
                total += written;
            }
            if written != v.iov_len as ssize_t {
                break;
            }
            i += 1;
        }
        if total > 0 { total } else { -1 }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_write2(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    header: *const c_char,
    header_length: c_int,
    payload: *const c_char,
    payload_length: c_int,
) -> ssize_t {
    #[cfg(not(windows))]
    // SAFETY: FFI; caller guarantees `header`/`payload` are readable for their lengths.
    unsafe {
        let mut injected: ssize_t = 0;
        let mut unused: c_int = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_WRITEV,
            fd,
            &raw mut injected,
            &raw mut unused,
        ) {
            return injected;
        }
        let chunks: [libc::iovec; 2] = [
            libc::iovec {
                iov_base: header as *mut c_void,
                iov_len: header_length as usize,
            },
            libc::iovec {
                iov_base: payload as *mut c_void,
                iov_len: payload_length as usize,
            },
        ];
        loop {
            let written = plat::writev(fd, chunks.as_ptr(), 2);
            if is_eintr(written) {
                continue;
            }
            return written;
        }
    }
    #[cfg(windows)]
    unsafe {
        let mut written = bsd_send(fd, header, header_length);
        if written == header_length as ssize_t {
            let second = bsd_send(fd, payload, payload_length);
            if second > 0 {
                written += second;
            }
        }
        written
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_send(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    buf: *const c_char,
    mut length: c_int,
) -> ssize_t {
    // SAFETY: FFI; caller guarantees `buf` has `length` readable bytes.
    unsafe {
        let mut injected: ssize_t = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_SEND,
            fd,
            &raw mut injected,
            &raw mut length,
        ) {
            return injected;
        }
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        let sflags = plat::MSG_NOSIGNAL | plat::MSG_DONTWAIT;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        let sflags = plat::MSG_DONTWAIT;
        #[cfg(windows)]
        let sflags = 0;
        loop {
            #[cfg(windows)]
            let rc = win::ws_send(fd, buf.cast(), length, sflags) as ssize_t;
            #[cfg(not(windows))]
            let rc = plat::send(fd, buf.cast(), length as usize, sflags);
            if is_eintr(rc) {
                continue;
            }
            #[cfg(debug_assertions)]
            if rc > 0 {
                debug_log::on_send(buf.cast(), rc as usize);
            }
            return rc;
        }
    }
}

#[cfg(not(windows))]
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_sendmsg(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    msg: *const libc::msghdr,
    flags: c_int,
) -> ssize_t {
    // SAFETY: FFI; caller guarantees `msg` is a valid msghdr.
    unsafe {
        let mut injected: ssize_t = 0;
        let mut unused: c_int = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_SENDMSG,
            fd,
            &raw mut injected,
            &raw mut unused,
        ) {
            return injected;
        }
        loop {
            let rc = plat::sendmsg(fd, msg, flags);
            if is_eintr(rc) {
                continue;
            }
            return rc;
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_would_block() -> c_int {
    #[cfg(windows)]
    {
        (win::WSAGetLastError() == win::WSAEWOULDBLOCK) as c_int
    }
    #[cfg(not(windows))]
    // SAFETY: reads thread-local errno; always valid.
    unsafe {
        (errno() == libc::EWOULDBLOCK) as c_int
    }
}

/// Transient kernel-resource exhaustion on send(): distinct from
/// bsd_would_block() so recv() EOF-vs-error callers never spin on ENOBUFS.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_send_is_transient_error() -> c_int {
    #[cfg(windows)]
    {
        (win::WSAGetLastError() == win::WSAENOBUFS) as c_int
    }
    #[cfg(not(windows))]
    // SAFETY: reads thread-local errno; always valid.
    unsafe {
        let e = errno();
        (e == libc::ENOBUFS || e == libc::ENOMEM) as c_int
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Listen-socket helpers
// ═══════════════════════════════════════════════════════════════════════════

unsafe fn us_internal_bind_and_listen(
    listen_fd: LIBUS_SOCKET_DESCRIPTOR,
    listen_addr: *const plat::sockaddr,
    listen_addr_len: socklen_t,
    backlog: c_int,
    error: *mut c_int,
) -> c_int {
    // SAFETY: caller guarantees `listen_addr` is valid for `listen_addr_len` bytes and `error` is writable.
    unsafe {
        let mut result;
        loop {
            result = plat::bind(listen_fd, listen_addr, listen_addr_len);
            if !is_eintr(result as ssize_t) {
                break;
            }
        }
        if result == -1 {
            *error = libus_err();
            return -1;
        }
        loop {
            result = plat::listen(listen_fd, backlog);
            if !is_eintr(result as ssize_t) {
                break;
            }
        }
        *error = libus_err();
        result
    }
}

unsafe fn bsd_set_reuseaddr(listen_fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
    let one: c_int = 1;
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
    // SAFETY: optval is a live c_int.
    unsafe {
        plat::sso(
            listen_fd,
            plat::SOL_SOCKET,
            libc::SO_REUSEPORT,
            (&raw const one).cast(),
            size_of::<c_int>() as _,
        )
    }
    #[cfg(not(any(target_os = "macos", target_os = "ios", target_os = "freebsd")))]
    // SAFETY: optval is a live c_int.
    unsafe {
        plat::sso(
            listen_fd,
            plat::SOL_SOCKET,
            plat::SO_REUSEADDR,
            (&raw const one).cast(),
            size_of::<c_int>() as _,
        )
    }
}

unsafe fn bsd_set_reuseport(listen_fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
    #[cfg(all(
        not(windows),
        any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "ios",
            target_os = "freebsd"
        )
    ))]
    // SAFETY: optval is a live c_int.
    unsafe {
        let one: c_int = 1;
        plat::sso(
            listen_fd,
            plat::SOL_SOCKET,
            libc::SO_REUSEPORT,
            (&raw const one).cast(),
            size_of::<c_int>() as _,
        )
    }
    #[cfg(windows)]
    unsafe {
        win::WSASetLastError(win::WSAEOPNOTSUPP);
        set_errno(libc::ENOTSUP);
        -1
    }
}

unsafe fn bsd_set_reuse(listen_fd: LIBUS_SOCKET_DESCRIPTOR, options: c_int) -> c_int {
    // SAFETY: calls setsockopt wrappers with live stack optvals only.
    unsafe {
        if options & LIBUS_LISTEN_EXCLUSIVE_PORT != 0 {
            #[cfg(windows)]
            {
                let one: c_int = 1;
                let result = plat::sso(
                    listen_fd,
                    plat::SOL_SOCKET,
                    win::SO_EXCLUSIVEADDRUSE,
                    (&raw const one).cast(),
                    size_of::<c_int>() as _,
                );
                if result != 0 {
                    return result;
                }
            }
        }
        if options & LIBUS_LISTEN_REUSE_ADDR != 0 {
            let result = bsd_set_reuseaddr(listen_fd);
            if result != 0 {
                return result;
            }
        }
        if options & LIBUS_LISTEN_REUSE_PORT != 0 {
            let result = bsd_set_reuseport(listen_fd);
            if result != 0 {
                if errno() == libc::ENOTSUP {
                    if options & LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE == 0 {
                        set_errno(0);
                        return 0;
                    }
                }
                return result;
            }
        }
        0
    }
}

#[inline(always)]
unsafe fn bsd_bind_listen_fd(
    listen_fd: LIBUS_SOCKET_DESCRIPTOR,
    listen_addr: *mut plat::addrinfo,
    _port: c_int,
    options: c_int,
    error: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: caller guarantees `listen_addr` is a valid addrinfo and `error` is writable.
    unsafe {
        if bsd_set_reuse(listen_fd, options) != 0 {
            return LIBUS_SOCKET_ERROR;
        }
        // On Unix SO_REUSEADDR lets a TIME_WAIT port be rebound; on Windows it
        // would allow stealing an in-use port (libuv #1360), so skip there.
        #[cfg(not(windows))]
        {
            let one: c_int = 1;
            plat::sso(
                listen_fd,
                plat::SOL_SOCKET,
                plat::SO_REUSEADDR,
                (&raw const one).cast(),
                size_of::<c_int>() as _,
            );
        }
        if (*listen_addr).ai_family == plat::AF_INET6 {
            let enabled: c_int = (options & LIBUS_SOCKET_IPV6_ONLY != 0) as c_int;
            if plat::sso(
                listen_fd,
                plat::IPPROTO_IPV6,
                plat::IPV6_V6ONLY,
                (&raw const enabled).cast(),
                size_of::<c_int>() as _,
            ) != 0
            {
                return LIBUS_SOCKET_ERROR;
            }
        }
        if us_internal_bind_and_listen(
            listen_fd,
            (*listen_addr).ai_addr.cast(),
            (*listen_addr).ai_addrlen as socklen_t,
            512,
            error,
        ) != 0
        {
            return LIBUS_SOCKET_ERROR;
        }
        listen_fd
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_set_defer_accept(listen_fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    // SAFETY: optval is a live c_int.
    unsafe {
        let timeout: c_int = 1;
        (plat::sso(
            listen_fd,
            plat::IPPROTO_TCP,
            plat::TCP_DEFER_ACCEPT,
            (&raw const timeout).cast(),
            size_of::<c_int>() as _,
        ) == 0) as c_int
    }
    #[cfg(target_os = "freebsd")]
    unsafe {
        let mut afa: plat::accept_filter_arg = MaybeUninit::zeroed().assume_init();
        let name = c"dataready".to_bytes_with_nul();
        ptr::copy_nonoverlapping(name.as_ptr(), afa.af_name.as_mut_ptr().cast(), name.len());
        (plat::sso(
            listen_fd,
            plat::SOL_SOCKET,
            plat::SO_ACCEPTFILTER,
            (&raw const afa).cast(),
            size_of::<plat::accept_filter_arg>() as _,
        ) == 0) as c_int
    }
    #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
    {
        let _ = listen_fd;
        0
    }
}

unsafe fn port_to_cstr(port: c_int, buf: &mut [c_char; 16]) {
    // SAFETY: 16 bytes is enough for any i32 + NUL.
    unsafe { libc::snprintf(buf.as_mut_ptr(), 16, c"%d".as_ptr(), port) };
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_create_listen_socket(
    host: *const c_char,
    port: c_int,
    options: c_int,
    error: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; `host` is null or a NUL-terminated C string, `error` is writable; addrinfo is zeroable.
    unsafe {
        let mut hints: plat::addrinfo = MaybeUninit::zeroed().assume_init();
        hints.ai_flags = plat::AI_PASSIVE;
        hints.ai_family = plat::AF_UNSPEC;
        hints.ai_socktype = plat::SOCK_STREAM;

        let mut port_string: [c_char; 16] = [0; 16];
        port_to_cstr(port, &mut port_string);

        let mut result: *mut plat::addrinfo = ptr::null_mut();
        if plat::getaddrinfo(
            host,
            port_string.as_ptr(),
            &raw const hints,
            &raw mut result,
        ) != 0
        {
            return LIBUS_SOCKET_ERROR;
        }

        for family in [plat::AF_INET6, plat::AF_INET] {
            let mut a = result;
            while !a.is_null() {
                if (*a).ai_family == family {
                    let listen_fd = bsd_create_socket(
                        (*a).ai_family,
                        (*a).ai_socktype,
                        (*a).ai_protocol,
                        ptr::null_mut(),
                    );
                    if listen_fd != LIBUS_SOCKET_ERROR {
                        if bsd_bind_listen_fd(listen_fd, a, port, options, error)
                            != LIBUS_SOCKET_ERROR
                        {
                            plat::freeaddrinfo(result);
                            return listen_fd;
                        }
                        bsd_close_socket(listen_fd);
                    }
                }
                a = (*a).ai_next;
            }
        }

        plat::freeaddrinfo(result);
        LIBUS_SOCKET_ERROR
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Unix-domain sockets
// ═══════════════════════════════════════════════════════════════════════════

unsafe fn bsd_create_unix_socket_address(
    path: *const c_char,
    path_len: usize,
    dirfd_out: *mut c_int,
    server_address: *mut plat::sockaddr_un,
    addrlen: *mut usize,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: caller owns `server_address`/`addrlen`/`dirfd_out`; `path` has `path_len` readable bytes.
    unsafe {
        ptr::write_bytes(server_address, 0, 1);
        (*server_address).sun_family = plat::AF_UNIX as _;

        if path_len == 0 {
            #[cfg(windows)]
            win::SetLastError(win::ERROR_PATH_NOT_FOUND);
            #[cfg(not(windows))]
            set_errno(libc::ENOENT);
            return LIBUS_SOCKET_ERROR;
        }

        *addrlen = size_of::<plat::sockaddr_un>();
        let sun_path_cap = (*server_address).sun_path.len();
        let sun_path = (*server_address).sun_path.as_mut_ptr();

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // Use /proc/self/fd/N/ to shorten paths that exceed sun_path.
            if path_len >= sun_path_cap && *path != 0 {
                let mut dirname_len = path_len;
                while dirname_len > 1 && *path.add(dirname_len - 1) != b'/' as c_char {
                    dirname_len -= 1;
                }
                if dirname_len < 2 || (path_len - dirname_len + 1) >= sun_path_cap {
                    set_errno(libc::ENAMETOOLONG);
                    return LIBUS_SOCKET_ERROR;
                }
                let mut dirname_buf: [c_char; 4096] = [0; 4096];
                if dirname_len + 1 > dirname_buf.len() {
                    set_errno(libc::ENAMETOOLONG);
                    return LIBUS_SOCKET_ERROR;
                }
                ptr::copy_nonoverlapping(path, dirname_buf.as_mut_ptr(), dirname_len);
                dirname_buf[dirname_len] = 0;
                let socket_dir_fd = plat::open(
                    dirname_buf.as_ptr(),
                    plat::O_CLOEXEC | plat::O_PATH | plat::O_DIRECTORY,
                    0o700,
                );
                if socket_dir_fd == -1 {
                    set_errno(libc::ENAMETOOLONG);
                    return LIBUS_SOCKET_ERROR;
                }
                let sun_path_len = libc::snprintf(
                    sun_path,
                    sun_path_cap,
                    c"/proc/self/fd/%d/%s".as_ptr(),
                    socket_dir_fd,
                    path.add(dirname_len),
                );
                if sun_path_len < 0 || sun_path_len as usize >= sun_path_cap {
                    plat::close(socket_dir_fd);
                    set_errno(libc::ENAMETOOLONG);
                    return LIBUS_SOCKET_ERROR;
                }
                *dirfd_out = socket_dir_fd;
                return 0;
            } else if path_len < sun_path_cap {
                ptr::copy_nonoverlapping(path, sun_path, path_len);
                // abstract domain sockets
                if *sun_path == 0 {
                    *addrlen = core::mem::offset_of!(plat::sockaddr_un, sun_path) + path_len;
                }
                return 0;
            }
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if path_len >= sun_path_cap {
            // macOS: open the parent directory and let the caller
            // __pthread_fchdir() into it, then bind/connect the basename.
            let mut dirname_len = path_len;
            while dirname_len > 1 && *path.add(dirname_len - 1) != b'/' as c_char {
                dirname_len -= 1;
            }
            let basename_len = path_len - dirname_len;
            if dirname_len < 2 || basename_len + 1 >= sun_path_cap {
                set_errno(libc::ENAMETOOLONG);
                return LIBUS_SOCKET_ERROR;
            }
            let mut dirname_buf: [c_char; 4096] = [0; 4096];
            if dirname_len + 1 > dirname_buf.len() {
                set_errno(libc::ENAMETOOLONG);
                return LIBUS_SOCKET_ERROR;
            }
            ptr::copy_nonoverlapping(path, dirname_buf.as_mut_ptr(), dirname_len);
            dirname_buf[dirname_len] = 0;
            let socket_dir_fd = plat::open(
                dirname_buf.as_ptr(),
                plat::O_CLOEXEC | plat::O_RDONLY | plat::O_DIRECTORY,
            );
            if socket_dir_fd == -1 {
                set_errno(libc::ENAMETOOLONG);
                return LIBUS_SOCKET_ERROR;
            }
            ptr::copy_nonoverlapping(path.add(dirname_len), sun_path, basename_len);
            *sun_path.add(basename_len) = 0;
            *dirfd_out = socket_dir_fd;
            return 0;
        }

        if path_len >= sun_path_cap {
            #[cfg(windows)]
            win::SetLastError(win::ERROR_FILENAME_EXCED_RANGE);
            #[cfg(not(windows))]
            set_errno(libc::ENAMETOOLONG);
            return LIBUS_SOCKET_ERROR;
        }

        ptr::copy_nonoverlapping(path, sun_path, path_len);
        0
    }
}

unsafe fn internal_bsd_create_listen_socket_unix(
    _path: *const c_char,
    _options: c_int,
    server_address: *mut plat::sockaddr_un,
    addrlen: usize,
    error: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: caller guarantees `server_address` is valid for `addrlen` bytes and `error` is writable.
    unsafe {
        let listen_fd = bsd_create_socket(plat::AF_UNIX, plat::SOCK_STREAM, 0, ptr::null_mut());
        if listen_fd == LIBUS_SOCKET_ERROR {
            return LIBUS_SOCKET_ERROR;
        }
        if us_internal_bind_and_listen(
            listen_fd,
            server_address.cast(),
            addrlen as socklen_t,
            512,
            error,
        ) != 0
        {
            #[cfg(windows)]
            let should_simulate_enoent = win::WSAGetLastError() == win::WSAENETDOWN;
            bsd_close_socket(listen_fd);
            #[cfg(windows)]
            if should_simulate_enoent {
                win::SetLastError(win::ERROR_PATH_NOT_FOUND);
            }
            return LIBUS_SOCKET_ERROR;
        }
        listen_fd
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_create_listen_socket_unix(
    path: *const c_char,
    len: usize,
    options: c_int,
    error: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; `path` has `len` readable bytes, `error` is null or writable.
    unsafe {
        let mut dirfd: c_int = -1;
        let mut server_address = MaybeUninit::<plat::sockaddr_un>::uninit();
        let mut addrlen: usize = 0;
        if bsd_create_unix_socket_address(
            path,
            len,
            &raw mut dirfd,
            server_address.as_mut_ptr(),
            &raw mut addrlen,
        ) != 0
        {
            if !error.is_null() && errno() != 0 {
                *error = errno();
            }
            return LIBUS_SOCKET_ERROR;
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if dirfd != -1 {
            if plat::__pthread_fchdir(dirfd) != 0 {
                plat::close(dirfd);
                set_errno(libc::ENAMETOOLONG);
                return LIBUS_SOCKET_ERROR;
            }
        }

        let listen_fd = internal_bsd_create_listen_socket_unix(
            path,
            options,
            server_address.as_mut_ptr(),
            addrlen,
            error,
        );

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if dirfd != -1 {
            let saved = errno();
            plat::__pthread_fchdir(-1);
            plat::close(dirfd);
            set_errno(saved);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if dirfd != -1 {
            plat::close(dirfd);
        }

        listen_fd
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// UDP bind / connect
// ═══════════════════════════════════════════════════════════════════════════

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_create_udp_socket(
    host: *const c_char,
    port: c_int,
    options: c_int,
    err: *mut c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; `host` is null or a NUL-terminated C string, `err` is null or writable; addrinfo is zeroable.
    unsafe {
        if !err.is_null() {
            *err = 0;
        }

        let mut hints: plat::addrinfo = MaybeUninit::zeroed().assume_init();
        hints.ai_flags = plat::AI_PASSIVE;
        hints.ai_family = plat::AF_UNSPEC;
        hints.ai_socktype = plat::SOCK_DGRAM;

        let mut port_string: [c_char; 16] = [0; 16];
        port_to_cstr(port, &mut port_string);

        let mut result: *mut plat::addrinfo = ptr::null_mut();
        let gai = plat::getaddrinfo(
            host,
            port_string.as_ptr(),
            &raw const hints,
            &raw mut result,
        );
        if gai != 0 {
            if !err.is_null() {
                *err = -gai;
            }
            return LIBUS_SOCKET_ERROR;
        }

        let mut listen_fd = LIBUS_SOCKET_ERROR;
        let mut listen_addr: *mut plat::addrinfo = ptr::null_mut();
        for family in [plat::AF_INET6, plat::AF_INET] {
            let mut a = result;
            while !a.is_null() && listen_fd == LIBUS_SOCKET_ERROR {
                if (*a).ai_family == family {
                    listen_fd =
                        bsd_create_socket((*a).ai_family, (*a).ai_socktype, (*a).ai_protocol, err);
                    listen_addr = a;
                }
                a = (*a).ai_next;
            }
        }

        if listen_fd == LIBUS_SOCKET_ERROR {
            plat::freeaddrinfo(result);
            return LIBUS_SOCKET_ERROR;
        }

        if bsd_set_reuse(listen_fd, options) != 0 {
            if !err.is_null() {
                *err = libus_err();
            }
            bsd_close_socket(listen_fd);
            plat::freeaddrinfo(result);
            return LIBUS_SOCKET_ERROR;
        }

        if (*listen_addr).ai_family == plat::AF_INET6 {
            let enabled: c_int = (options & LIBUS_SOCKET_IPV6_ONLY != 0) as c_int;
            if plat::sso(
                listen_fd,
                plat::IPPROTO_IPV6,
                plat::IPV6_V6ONLY,
                (&raw const enabled).cast(),
                size_of::<c_int>() as _,
            ) != 0
            {
                return LIBUS_SOCKET_ERROR;
            }
        }

        let enabled: c_int = 1;
        if plat::sso(
            listen_fd,
            plat::IPPROTO_IPV6,
            plat::IPV6_RECVPKTINFO,
            (&raw const enabled).cast(),
            size_of::<c_int>() as _,
        ) == -1
        {
            let e = errno();
            if e == libc::ENOPROTOOPT || e == libc::EINVAL {
                #[cfg(any(
                    target_os = "linux",
                    target_os = "android",
                    target_os = "macos",
                    target_os = "ios",
                    windows
                ))]
                {
                    plat::sso(
                        listen_fd,
                        plat::IPPROTO_IP,
                        plat::IP_PKTINFO,
                        (&raw const enabled).cast(),
                        size_of::<c_int>() as _,
                    );
                }
                #[cfg(target_os = "freebsd")]
                {
                    plat::sso(
                        listen_fd,
                        plat::IPPROTO_IP,
                        plat::IP_RECVDSTADDR,
                        (&raw const enabled).cast(),
                        size_of::<c_int>() as _,
                    );
                }
            }
        }

        // For ECN.
        if plat::sso(
            listen_fd,
            plat::IPPROTO_IPV6,
            plat::IPV6_RECVTCLASS,
            (&raw const enabled).cast(),
            size_of::<c_int>() as _,
        ) == -1
        {
            let e = errno();
            if e == libc::ENOPROTOOPT || e == libc::EINVAL {
                plat::sso(
                    listen_fd,
                    plat::IPPROTO_IP,
                    plat::IP_RECVTOS,
                    (&raw const enabled).cast(),
                    size_of::<c_int>() as _,
                );
            }
        }

        #[cfg(windows)]
        {
            // Disable ICMP-driven WSAECONNRESET/WSAENETRESET at the source so
            // they can't race a real packet in WSARecvFrom.
            let mut off: u32 = 0;
            let mut br: u32 = 0;
            win::WSAIoctl(
                listen_fd,
                win::SIO_UDP_CONNRESET,
                (&raw mut off).cast(),
                size_of::<u32>() as u32,
                ptr::null_mut(),
                0,
                &raw mut br,
                ptr::null_mut(),
                ptr::null_mut(),
            );
            win::WSAIoctl(
                listen_fd,
                win::SIO_UDP_NETRESET,
                (&raw mut off).cast(),
                size_of::<u32>() as u32,
                ptr::null_mut(),
                0,
                &raw mut br,
                ptr::null_mut(),
                ptr::null_mut(),
            );
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // Surface ICMP errors on unconnected sockets as errno on the next
            // send/recv instead of silently dropping them. Matches libuv.
            plat::sso(
                listen_fd,
                plat::IPPROTO_IP,
                plat::IP_RECVERR,
                (&raw const enabled).cast(),
                size_of::<c_int>() as _,
            );
            if (*listen_addr).ai_family == plat::AF_INET6 {
                plat::sso(
                    listen_fd,
                    plat::IPPROTO_IPV6,
                    plat::IPV6_RECVERR,
                    (&raw const enabled).cast(),
                    size_of::<c_int>() as _,
                );
            }
        }

        if plat::bind(
            listen_fd,
            (*listen_addr).ai_addr.cast(),
            (*listen_addr).ai_addrlen as socklen_t,
        ) != 0
        {
            if !err.is_null() {
                *err = libus_err();
            }
            bsd_close_socket(listen_fd);
            plat::freeaddrinfo(result);
            return LIBUS_SOCKET_ERROR;
        }

        plat::freeaddrinfo(result);
        if !err.is_null() {
            *err = 0;
        }
        listen_fd
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_connect_udp_socket(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    host: *const c_char,
    port: c_int,
) -> c_int {
    // SAFETY: FFI; `host` is a NUL-terminated C string; addrinfo is zeroable.
    unsafe {
        let mut hints: plat::addrinfo = MaybeUninit::zeroed().assume_init();
        hints.ai_family = plat::AF_UNSPEC;
        hints.ai_socktype = plat::SOCK_DGRAM;

        let mut port_string: [c_char; 16] = [0; 16];
        port_to_cstr(port, &mut port_string);

        let mut result: *mut plat::addrinfo = ptr::null_mut();
        let gai = plat::getaddrinfo(
            host,
            port_string.as_ptr(),
            &raw const hints,
            &raw mut result,
        );
        if gai != 0 {
            return gai;
        }
        if result.is_null() {
            return -1;
        }
        let mut rp = result;
        while !rp.is_null() {
            if plat::connect(fd, (*rp).ai_addr.cast(), (*rp).ai_addrlen as socklen_t) == 0 {
                plat::freeaddrinfo(result);
                return 0;
            }
            rp = (*rp).ai_next;
        }
        plat::freeaddrinfo(result);
        LIBUS_SOCKET_ERROR as c_int
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_disconnect_udp_socket(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
    // SAFETY: `addr` is a live stack sockaddr; sockaddr is zeroable.
    unsafe {
        let mut addr: plat::sockaddr = MaybeUninit::zeroed().assume_init();
        addr.sa_family = plat::AF_UNSPEC as _;
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        {
            addr.sa_len = size_of::<plat::sockaddr>() as u8;
        }

        let res = plat::connect(
            fd,
            &raw const addr,
            size_of::<plat::sockaddr>() as socklen_t,
        );
        // EAFNOSUPPORT is harmless — we only want to disconnect.
        #[cfg(windows)]
        let harmless = win::WSAGetLastError() == win::WSAEAFNOSUPPORT;
        #[cfg(not(windows))]
        let harmless = errno() == libc::EAFNOSUPPORT;
        if res == 0 || harmless { 0 } else { -1 }
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Connect
// ═══════════════════════════════════════════════════════════════════════════

unsafe fn bsd_do_connect_raw(
    fd: LIBUS_SOCKET_DESCRIPTOR,
    addr: *const plat::sockaddr,
    namelen: usize,
) -> c_int {
    // SAFETY: caller guarantees `addr` is valid for `namelen` bytes.
    unsafe {
        let mut injected: ssize_t = 0;
        let mut unused: c_int = 0;
        if us_fault_check(
            us_fault_syscall::US_FAULT_CONNECT,
            fd,
            &raw mut injected,
            &raw mut unused,
        ) {
            return errno();
        }
        #[cfg(windows)]
        loop {
            if plat::connect(fd, addr, namelen as c_int) == 0 {
                return 0;
            }
            match win::WSAGetLastError() {
                win::WSAEINPROGRESS | win::WSAEWOULDBLOCK | win::WSAEALREADY => return 0,
                win::WSAEINTR => continue,
                err => return err,
            }
        }
        #[cfg(not(windows))]
        {
            let mut r;
            loop {
                set_errno(0);
                r = plat::connect(fd, addr, namelen as socklen_t);
                if !is_eintr(r as ssize_t) {
                    break;
                }
            }
            // connect() can return -1 with errno 0; errno is authoritative.
            if r == -1 && errno() != 0 {
                if errno() == libc::EINPROGRESS {
                    return 0;
                }
                return errno();
            }
            0
        }
    }
}

#[cfg(windows)]
unsafe fn convert_null_addr(addr: *const sockaddr_storage, result: *mut sockaddr_storage) -> c_int {
    unsafe {
        if (*addr).ss_family as c_int == plat::AF_INET {
            let a4 = addr.cast::<plat::sockaddr_in>();
            if (*a4).sin_addr.s_addr == htonl(win::INADDR_ANY) {
                ptr::copy_nonoverlapping(
                    addr.cast::<u8>(),
                    result.cast(),
                    size_of::<plat::sockaddr_in>(),
                );
                (*result.cast::<plat::sockaddr_in>()).sin_addr.s_addr = htonl(win::INADDR_LOOPBACK);
                return 1;
            }
        } else if (*addr).ss_family as c_int == plat::AF_INET6 {
            let a6 = addr.cast::<plat::sockaddr_in6>();
            if (*a6).sin6_addr.s6_addr == win::IN6ADDR_ANY {
                ptr::copy_nonoverlapping(
                    addr.cast::<u8>(),
                    result.cast(),
                    size_of::<plat::sockaddr_in6>(),
                );
                (*result.cast::<plat::sockaddr_in6>()).sin6_addr.s6_addr = win::IN6ADDR_LOOPBACK;
                return 1;
            }
        }
        0
    }
}

#[cfg(windows)]
unsafe fn is_loopback(addr: *const sockaddr_storage) -> c_int {
    unsafe {
        if (*addr).ss_family as c_int == plat::AF_INET {
            ((*addr.cast::<plat::sockaddr_in>()).sin_addr.s_addr == htonl(win::INADDR_LOOPBACK))
                as c_int
        } else if (*addr).ss_family as c_int == plat::AF_INET6 {
            ((*addr.cast::<plat::sockaddr_in6>()).sin6_addr.s6_addr == win::IN6ADDR_LOOPBACK)
                as c_int
        } else {
            0
        }
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_create_connect_socket(
    mut addr: *mut sockaddr_storage,
    local_addr: *mut sockaddr_storage,
    _options: c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; caller guarantees `addr` is a valid sockaddr_storage and `local_addr` is null or valid.
    unsafe {
        let fd = bsd_create_socket(
            (*addr).ss_family as c_int,
            plat::SOCK_STREAM,
            0,
            ptr::null_mut(),
        );
        if fd == LIBUS_SOCKET_ERROR {
            return LIBUS_SOCKET_ERROR;
        }

        if !local_addr.is_null() {
            // Match libuv uv__tcp_bind: SO_REUSEADDR so binding succeeds over
            // TIME_WAIT. Skipped on Windows where it allows port-stealing.
            #[cfg(not(windows))]
            {
                let on: c_int = 1;
                plat::sso(
                    fd,
                    plat::SOL_SOCKET,
                    plat::SO_REUSEADDR,
                    (&raw const on).cast(),
                    size_of::<c_int>() as _,
                );
            }
            let local_len = if (*local_addr).ss_family as c_int == plat::AF_INET {
                size_of::<plat::sockaddr_in>()
            } else {
                size_of::<plat::sockaddr_in6>()
            } as socklen_t;
            if plat::bind(fd, local_addr.cast(), local_len) != 0 {
                let bind_err = libus_err();
                bsd_close_socket(fd);
                #[cfg(windows)]
                win::WSASetLastError(bind_err);
                #[cfg(not(windows))]
                set_errno(bind_err);
                return LIBUS_SOCKET_ERROR;
            }
        }

        #[cfg(windows)]
        {
            win32_set_nonblocking(fd);
            // Windows can't connect to 0.0.0.0/:: directly — rewrite to loopback.
            let mut converted: sockaddr_storage = MaybeUninit::zeroed().assume_init();
            if convert_null_addr(addr, &raw mut converted) != 0 {
                addr = &raw mut converted;
            }
            // Fail fast to localhost (matches libuv): avoid the default 2 s
            // retransmit when the IPv6 loopback isn't listening.
            if is_loopback(addr) != 0 {
                let mut rto: win::TCP_INITIAL_RTO_PARAMETERS = MaybeUninit::zeroed().assume_init();
                rto.Rtt = win::TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS as u16;
                rto.MaxSynRetransmissions = win::TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS;
                let mut bytes: u32 = 0;
                win::WSAIoctl(
                    fd,
                    win::SIO_TCP_INITIAL_RTO,
                    (&raw mut rto).cast(),
                    size_of::<win::TCP_INITIAL_RTO_PARAMETERS>() as u32,
                    ptr::null_mut(),
                    0,
                    &raw mut bytes,
                    ptr::null_mut(),
                    ptr::null_mut(),
                );
            }
        }

        let namelen = if (*addr).ss_family as c_int == plat::AF_INET {
            size_of::<plat::sockaddr_in>()
        } else {
            size_of::<plat::sockaddr_in6>()
        };
        if bsd_do_connect_raw(fd, addr.cast(), namelen) != 0 {
            bsd_close_socket(fd);
            return LIBUS_SOCKET_ERROR;
        }
        fd
    }
}

unsafe fn internal_bsd_create_connect_socket_unix(
    _server_path: *const c_char,
    _len: usize,
    _options: c_int,
    server_address: *mut plat::sockaddr_un,
    addrlen: usize,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: caller guarantees `server_address` is valid for `addrlen` bytes.
    unsafe {
        let fd = bsd_create_socket(plat::AF_UNIX, plat::SOCK_STREAM, 0, ptr::null_mut());
        if fd == LIBUS_SOCKET_ERROR {
            return LIBUS_SOCKET_ERROR;
        }
        win32_set_nonblocking(fd);
        if bsd_do_connect_raw(fd, server_address.cast(), addrlen) != 0 {
            bsd_close_socket(fd);
            return LIBUS_SOCKET_ERROR;
        }
        fd
    }
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn bsd_create_connect_socket_unix(
    server_path: *const c_char,
    len: usize,
    options: c_int,
) -> LIBUS_SOCKET_DESCRIPTOR {
    // SAFETY: FFI; `server_path` has `len` readable bytes.
    unsafe {
        let mut server_address = MaybeUninit::<plat::sockaddr_un>::uninit();
        let mut addrlen: usize = 0;
        let mut dirfd: c_int = -1;
        if bsd_create_unix_socket_address(
            server_path,
            len,
            &raw mut dirfd,
            server_address.as_mut_ptr(),
            &raw mut addrlen,
        ) != 0
        {
            return LIBUS_SOCKET_ERROR;
        }

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if dirfd != -1 {
            if plat::__pthread_fchdir(dirfd) != 0 {
                plat::close(dirfd);
                set_errno(libc::ENAMETOOLONG);
                return LIBUS_SOCKET_ERROR;
            }
        }

        let fd = internal_bsd_create_connect_socket_unix(
            server_path,
            len,
            options,
            server_address.as_mut_ptr(),
            addrlen,
        );

        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if dirfd != -1 {
            let saved = errno();
            plat::__pthread_fchdir(-1);
            plat::close(dirfd);
            set_errno(saved);
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if dirfd != -1 {
            plat::close(dirfd);
        }

        fd
    }
}
