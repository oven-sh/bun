//! Syscall edges beyond what `bun_sys` covers: the uSockets BSD layer per
//! docs/semantics.md §8 (socket creation, option sequences, addr plumbing,
//! unix-socket long-path workarounds, listen/connect/accept, SCM_RIGHTS).
//! ENOBUFS/ENOMEM mapping to would-block happens in write.rs, not here.
//!
//! Return conventions: byte-count ops return bytes or `-errno`; fd-producing
//! ops return `Result<fd, errno>`; option setters return `0` or `-errno`
//! except `keepalive` (positive errno / `-1`, verbatim C convention).

use crate::LIBUS_SOCKET_DESCRIPTOR;

/// Clear TCP_CORK on Linux; no-op elsewhere (docs/semantics.md R4.6 — the
/// send path itself never corks, so this only matters if another layer did).
pub(crate) fn socket_flush(fd: LIBUS_SOCKET_DESCRIPTOR) {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        let enabled: core::ffi::c_int = 0;
        // SAFETY: setsockopt reads sizeof(int) bytes from `enabled`; failure
        // (e.g. closed fd) is deliberately ignored, matching bsd_socket_flush.
        unsafe {
            libc::setsockopt(
                fd,
                libc::IPPROTO_TCP,
                libc::TCP_CORK,
                (&raw const enabled).cast(),
                core::mem::size_of::<core::ffi::c_int>() as libc::socklen_t,
            );
        }
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = fd;
    }
}

/// Connect-address currency of the bsd layer (`struct sockaddr_storage`).
#[cfg(not(windows))]
pub(crate) type ConnectAddr = libc::sockaddr_storage;
/// Windows: the shared winsock `SOCKADDR_STORAGE` layout (udp.rs owns the
/// definition; the libc crate ships no windows sockaddr types).
#[cfg(windows)]
pub(crate) type ConnectAddr = crate::udp::sockaddr_storage;

/// Winsock declarations/constants shared by the windows `imp` and `udp_imp`
/// arms. Externs beyond `bun_windows_sys::ws2_32`'s subset are declared here
/// (namespaced — several share names with the wrappers below).
#[cfg(windows)]
mod win {
    #![allow(non_camel_case_types, non_snake_case)]
    use core::ffi::{c_char, c_int, c_ulong, c_void};

    pub(super) use bun_windows_sys::kernel32;
    pub(super) use bun_windows_sys::ws2_32 as ws2;

    pub(super) type SockaddrStorage = crate::udp::sockaddr_storage;

    // winsock2.h
    pub(super) const SOL_SOCKET: c_int = 0xFFFF;
    pub(super) const SO_REUSEADDR: c_int = 0x0004;
    pub(super) const SO_KEEPALIVE: c_int = 0x0008;
    pub(super) const SO_BROADCAST: c_int = 0x0020;
    pub(super) const SO_LINGER: c_int = 0x0080;
    /// `((int)(~SO_REUSEADDR))` (winsock2.h).
    pub(super) const SO_EXCLUSIVEADDRUSE: c_int = !SO_REUSEADDR;
    pub(super) const SD_RECEIVE: c_int = 0;
    pub(super) const SD_SEND: c_int = 1;
    pub(super) const SOCKET_ERROR: c_int = -1;
    /// `_IOW('f', 126, u_long)` (winsock2.h).
    pub(super) const FIONBIO: c_int = 0x8004667Eu32 as c_int;
    // ws2def.h
    pub(super) const AI_PASSIVE: c_int = 0x01;
    pub(super) const IPPROTO_IP: c_int = 0;
    pub(super) const IPPROTO_IPV6: c_int = 41;
    // ws2ipdef.h
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
    /// Windows has no IPV6_RECVPKTINFO; the C shim aliased it to IPV6_PKTINFO.
    pub(super) const IPV6_PKTINFO: c_int = 19;
    pub(super) const IPV6_V6ONLY: c_int = 27;
    pub(super) const IPV6_TCLASS: c_int = 39;
    pub(super) const IPV6_RECVTCLASS: c_int = 40;
    pub(super) const MCAST_JOIN_SOURCE_GROUP: c_int = 45;
    pub(super) const MCAST_LEAVE_SOURCE_GROUP: c_int = 46;
    pub(super) const TCP_NODELAY: c_int = 0x0001;
    /// ws2ipdef.h — keep-alive idle time in seconds (Win32's TCP_KEEPIDLE).
    pub(super) const TCP_KEEPALIVE: c_int = 3;
    // mstcpip.h `_WSAIOW(IOC_VENDOR, n)`
    pub(super) const SIO_UDP_CONNRESET: u32 = 0x9800000C;
    pub(super) const SIO_UDP_NETRESET: u32 = 0x9800000F;
    pub(super) const SIO_TCP_INITIAL_RTO: u32 = 0x98000011;
    /// mstcpip.h `((UCHAR)-2)`.
    pub(super) const TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS: u8 = 0xFE;
    /// handleapi.h.
    pub(super) const HANDLE_FLAG_INHERIT: u32 = 0x1;

    pub(super) const WSAEINTR: c_int = ws2::WinsockError::WSAEINTR.0 as c_int;
    pub(super) const WSAEBADF: c_int = ws2::WinsockError::WSAEBADF.0 as c_int;
    pub(super) const WSAEINVAL: c_int = ws2::WinsockError::WSAEINVAL.0 as c_int;
    pub(super) const WSAEWOULDBLOCK: c_int = ws2::WinsockError::WSAEWOULDBLOCK.0 as c_int;
    pub(super) const WSAEINPROGRESS: c_int = ws2::WinsockError::WSAEINPROGRESS.0 as c_int;
    pub(super) const WSAEALREADY: c_int = ws2::WinsockError::WSAEALREADY.0 as c_int;
    pub(super) const WSAENOPROTOOPT: c_int = ws2::WinsockError::WSAENOPROTOOPT.0 as c_int;
    pub(super) const WSAEOPNOTSUPP: c_int = ws2::WinsockError::WSAEOPNOTSUPP.0 as c_int;
    pub(super) const WSAEAFNOSUPPORT: c_int = ws2::WinsockError::WSAEAFNOSUPPORT.0 as c_int;
    pub(super) const WSAENETDOWN: c_int = ws2::WinsockError::WSAENETDOWN.0 as c_int;
    pub(super) const WSAENETRESET: c_int = ws2::WinsockError::WSAENETRESET.0 as c_int;
    pub(super) const WSAECONNRESET: c_int = ws2::WinsockError::WSAECONNRESET.0 as c_int;
    /// winerror.h ERROR_PATH_NOT_FOUND — the C source simulated ENOENT with it.
    pub(super) const ERROR_PATH_NOT_FOUND: c_int =
        bun_windows_sys::Win32Error::PATH_NOT_FOUND.0 as c_int;
    /// winerror.h — the C source simulated ENAMETOOLONG with it.
    pub(super) const ERROR_FILENAME_EXCED_RANGE: c_int = 206;

    /// winsock2.h `struct linger` — `u_short` pair, unlike POSIX's ints.
    #[repr(C)]
    pub(super) struct linger {
        pub(super) l_onoff: u16,
        pub(super) l_linger: u16,
    }

    /// ws2ipdef.h.
    #[repr(C)]
    pub(super) struct ip_mreq {
        pub(super) imr_multiaddr: ws2::in_addr,
        pub(super) imr_interface: ws2::in_addr,
    }

    /// ws2ipdef.h — the interface is a `ULONG` index, not an address.
    #[repr(C)]
    pub(super) struct ipv6_mreq {
        pub(super) ipv6mr_multiaddr: ws2::in6_addr,
        pub(super) ipv6mr_interface: c_ulong,
    }

    /// ws2ipdef.h — NOTE: field ORDER differs from Linux's ip_mreq_source.
    #[repr(C)]
    pub(super) struct ip_mreq_source {
        pub(super) imr_multiaddr: ws2::in_addr,
        pub(super) imr_sourceaddr: ws2::in_addr,
        pub(super) imr_interface: ws2::in_addr,
    }

    /// ws2ipdef.h GROUP_SOURCE_REQ (natural MSVC layout: 4 pad bytes after
    /// the ULONG before the 8-aligned storages).
    #[repr(C)]
    pub(super) struct group_source_req {
        pub(super) gsr_interface: c_ulong,
        pub(super) gsr_group: SockaddrStorage,
        pub(super) gsr_source: SockaddrStorage,
    }

    /// mstcpip.h TCP_INITIAL_RTO_PARAMETERS.
    #[repr(C)]
    pub(super) struct TCP_INITIAL_RTO_PARAMETERS {
        pub(super) Rtt: u16,
        pub(super) MaxSynRetransmissions: u8,
    }

    /// afunix.h SOCKADDR_UN (`UNIX_PATH_MAX` = 108).
    #[repr(C)]
    pub(super) struct sockaddr_un {
        pub(super) sun_family: u16,
        pub(super) sun_path: [u8; 108],
    }

    #[link(name = "ws2_32")]
    unsafe extern "system" {
        pub(super) fn socket(af: c_int, ty: c_int, protocol: c_int) -> usize;
        pub(super) fn bind(s: usize, name: *const ws2::sockaddr, namelen: c_int) -> c_int;
        pub(super) fn listen(s: usize, backlog: c_int) -> c_int;
        pub(super) fn accept(s: usize, addr: *mut ws2::sockaddr, addrlen: *mut c_int) -> usize;
        pub(super) fn connect(s: usize, name: *const ws2::sockaddr, namelen: c_int) -> c_int;
        pub(super) fn getsockname(s: usize, name: *mut ws2::sockaddr, namelen: *mut c_int)
        -> c_int;
        pub(super) fn getpeername(s: usize, name: *mut ws2::sockaddr, namelen: *mut c_int)
        -> c_int;
        pub(super) fn setsockopt(
            s: usize,
            level: c_int,
            optname: c_int,
            optval: *const c_void,
            optlen: c_int,
        ) -> c_int;
        pub(super) fn getsockopt(
            s: usize,
            level: c_int,
            optname: c_int,
            optval: *mut c_void,
            optlen: *mut c_int,
        ) -> c_int;
        pub(super) fn shutdown(s: usize, how: c_int) -> c_int;
        pub(super) fn ioctlsocket(s: usize, cmd: c_int, argp: *mut c_ulong) -> c_int;
        pub(super) fn sendto(
            s: usize,
            buf: *const c_void,
            len: c_int,
            flags: c_int,
            to: *const ws2::sockaddr,
            tolen: c_int,
        ) -> c_int;
        pub(super) fn recvfrom(
            s: usize,
            buf: *mut c_void,
            len: c_int,
            flags: c_int,
            from: *mut ws2::sockaddr,
            fromlen: *mut c_int,
        ) -> c_int;
        pub(super) fn inet_pton(family: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
        pub(super) fn WSAIoctl(
            s: usize,
            code: u32,
            in_buf: *mut c_void,
            in_len: u32,
            out_buf: *mut c_void,
            out_len: u32,
            bytes_returned: *mut u32,
            overlapped: *mut c_void,
            completion_routine: *mut c_void,
        ) -> c_int;
    }

    #[inline]
    pub(super) fn wsa_errno() -> i32 {
        ws2::WSAGetLastError()
    }

    #[inline]
    pub(super) fn so<T>(fd: usize, level: c_int, opt: c_int, val: &T) -> c_int {
        // SAFETY: the kernel reads exactly size_of::<T>() bytes from `val`.
        unsafe {
            setsockopt(
                fd,
                level,
                opt,
                core::ptr::from_ref(val).cast::<c_void>(),
                core::mem::size_of::<T>() as c_int,
            )
        }
    }

    /// Zero-initialized C struct.
    pub(super) fn pod_zeroed<T>() -> T {
        // SAFETY: only instantiated with plain-old-data winsock structs for
        // which all-zero bytes is a valid value.
        unsafe { core::mem::zeroed() }
    }

    /// Caller must have checked `ss_family == AF_INET`.
    pub(super) fn as_v4(ss: &SockaddrStorage) -> &ws2::sockaddr_in {
        // SAFETY: SOCKADDR_STORAGE is sized/aligned for every sockaddr type.
        unsafe { &*core::ptr::from_ref(ss).cast::<ws2::sockaddr_in>() }
    }

    /// Caller must have checked `ss_family == AF_INET6`.
    pub(super) fn as_v6(ss: &SockaddrStorage) -> &ws2::sockaddr_in6 {
        // SAFETY: SOCKADDR_STORAGE is sized/aligned for every sockaddr type.
        unsafe { &*core::ptr::from_ref(ss).cast::<ws2::sockaddr_in6>() }
    }

    /// FD_CLOEXEC parity: keep sockets out of spawned children (POSIX side
    /// passes SOCK_CLOEXEC / sets the flag via fcntl).
    pub(super) fn set_no_inherit(fd: usize) {
        kernel32::SetHandleInformation(fd as bun_windows_sys::HANDLE, HANDLE_FLAG_INHERIT, 0);
    }

    /// `win32_set_nonblocking` (bsd.c:343-354): libuv only sets FIONBIO at
    /// poll init, so connect paths must set it explicitly.
    pub(super) fn set_fionbio(fd: usize) {
        let mut yes: c_ulong = 1;
        // SAFETY: FIONBIO reads one u_long from `yes`; failure ignored as in C.
        unsafe { ioctlsocket(fd, FIONBIO, &mut yes) };
    }

    /// Try the IPv6 option; on WSAENOPROTOOPT/WSAEINVAL retry the IPv4 option
    /// (bsd.c:375-392). 0 or negative WSA error.
    pub(super) fn setsockopt_6_or_4<T>(fd: usize, option4: c_int, option6: c_int, val: &T) -> i32 {
        if so(fd, IPPROTO_IPV6, option6, val) == 0 {
            return 0;
        }
        let e = wsa_errno();
        if e == WSAENOPROTOOPT || e == WSAEINVAL {
            if so(fd, IPPROTO_IP, option4, val) == 0 {
                return 0;
            }
            return -wsa_errno();
        }
        -e
    }

    /// Connect/bind namelen by family (16 for v4, 28 for v6).
    pub(super) fn ip_addrlen(family: c_int) -> c_int {
        if family == ws2::AF_INET {
            core::mem::size_of::<ws2::sockaddr_in>() as c_int
        } else {
            core::mem::size_of::<ws2::sockaddr_in6>() as c_int
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use core::ffi::{CStr, c_char, c_int, c_void};
    use core::mem::{offset_of, size_of, zeroed};
    use core::ptr;

    use crate::write::UsIoVec;
    use crate::{
        LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE, LIBUS_LISTEN_REUSE_ADDR,
        LIBUS_LISTEN_REUSE_PORT, LIBUS_SOCKET_IPV6_ONLY,
    };
    use crate::{LIBUS_SOCKET_DESCRIPTOR, LIBUS_SOCKET_ERROR};

    const _: () = assert!(size_of::<UsIoVec>() == size_of::<libc::iovec>());

    #[cfg(target_vendor = "apple")]
    const MSG_NOSIGNAL: c_int = 0; // no MSG_NOSIGNAL on Darwin; SO_NOSIGPIPE at creation
    #[cfg(not(target_vendor = "apple"))]
    const MSG_NOSIGNAL: c_int = libc::MSG_NOSIGNAL;

    #[inline]
    pub(crate) fn errno() -> i32 {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    }

    macro_rules! retry_eintr {
        ($e:expr) => {
            loop {
                let r = $e;
                if r == -1 && errno() == libc::EINTR {
                    continue;
                }
                break r;
            }
        };
    }

    /// Fault hook for byte-count ops: early-returns `-errno`/`0`, or clamps
    /// `$len` in place (SHORT). No-op without the feature (R11.1).
    macro_rules! fault_check {
        ($sc:ident, $fd:expr, $len:ident) => {
            #[cfg(feature = "socket_fault_injection")]
            match crate::fault::check(crate::fault::$sc, $fd as c_int, $len) {
                Some(crate::fault::Fault::Errno(e)) => return -(e as isize),
                Some(crate::fault::Fault::Zero) => return 0,
                Some(crate::fault::Fault::Clamp(n)) => $len = n,
                None => {}
            }
        };
        ($sc:ident, $fd:expr) => {
            #[cfg(feature = "socket_fault_injection")]
            match crate::fault::check(crate::fault::$sc, $fd as c_int, 0) {
                Some(crate::fault::Fault::Errno(e)) => return -(e as isize),
                Some(crate::fault::Fault::Zero) => return 0,
                Some(crate::fault::Fault::Clamp(_)) | None => {}
            }
        };
    }

    #[inline]
    fn so<T>(fd: LIBUS_SOCKET_DESCRIPTOR, level: c_int, opt: c_int, val: &T) -> c_int {
        // SAFETY: the kernel reads exactly size_of::<T>() bytes from `val`.
        unsafe {
            libc::setsockopt(
                fd,
                level,
                opt,
                ptr::from_ref(val).cast::<c_void>(),
                size_of::<T>() as libc::socklen_t,
            )
        }
    }

    /// Zero-initialized C struct.
    fn pod_zeroed<T>() -> T {
        // SAFETY: only instantiated with plain-old-data C structs (sockaddr_*,
        // msghdr, addrinfo, mreq) for which all-zero bytes is a valid value.
        unsafe { zeroed() }
    }

    /// Caller must have checked `ss_family == AF_INET`.
    fn as_v4(ss: &libc::sockaddr_storage) -> &libc::sockaddr_in {
        // SAFETY: sockaddr_storage is sized/aligned for every sockaddr type.
        unsafe { &*ptr::from_ref(ss).cast::<libc::sockaddr_in>() }
    }

    /// Caller must have checked `ss_family == AF_INET6`.
    fn as_v6(ss: &libc::sockaddr_storage) -> &libc::sockaddr_in6 {
        // SAFETY: sockaddr_storage is sized/aligned for every sockaddr type.
        unsafe { &*ptr::from_ref(ss).cast::<libc::sockaddr_in6>() }
    }

    // ───────────────────────── byte I/O (R8.11) ─────────────────────────

    /// send(2), MSG_NOSIGNAL|MSG_DONTWAIT, EINTR-retried. No MSG_MORE (C7).
    pub(crate) fn send(fd: LIBUS_SOCKET_DESCRIPTOR, data: &[u8]) -> isize {
        #[cfg_attr(not(feature = "socket_fault_injection"), allow(unused_mut))]
        let mut len = data.len();
        fault_check!(SEND, fd, len);
        // SAFETY: `data[..len]` is a valid read of `len` bytes (len ≤ data.len()).
        let r = retry_eintr!(unsafe {
            libc::send(fd, data.as_ptr().cast(), len, MSG_NOSIGNAL | libc::MSG_DONTWAIT)
        });
        if r < 0 { -(errno() as isize) } else { r as isize }
    }

    /// writev(2), IOV_MAX-capped at 1024, EINTR-retried.
    pub(crate) fn writev(fd: LIBUS_SOCKET_DESCRIPTOR, iov: &[UsIoVec]) -> isize {
        fault_check!(WRITEV, fd);
        let count = iov.len().min(1024);
        // SAFETY: UsIoVec is layout-identical to iovec (asserted above);
        // count ≤ iov.len().
        let r = retry_eintr!(unsafe {
            libc::writev(fd, iov.as_ptr().cast::<libc::iovec>(), count as c_int)
        });
        if r < 0 { -(errno() as isize) } else { r as isize }
    }

    /// 2-chunk writev (`bsd_write2`); shares the WRITEV fault hook (R11.2).
    pub(crate) fn write2(fd: LIBUS_SOCKET_DESCRIPTOR, first: &[u8], second: &[u8]) -> isize {
        fault_check!(WRITEV, fd);
        let chunks = [
            libc::iovec { iov_base: first.as_ptr().cast_mut().cast(), iov_len: first.len() },
            libc::iovec { iov_base: second.as_ptr().cast_mut().cast(), iov_len: second.len() },
        ];
        // SAFETY: `chunks` holds 2 valid iovecs borrowing `first`/`second`.
        let r = retry_eintr!(unsafe { libc::writev(fd, chunks.as_ptr(), 2) });
        if r < 0 { -(errno() as isize) } else { r as isize }
    }

    /// recv(2) with MSG_DONTWAIT into the loop's shared buffer, EINTR-retried.
    pub(crate) fn recv(fd: LIBUS_SOCKET_DESCRIPTOR, buf: &mut [u8]) -> isize {
        #[cfg_attr(not(feature = "socket_fault_injection"), allow(unused_mut))]
        let mut len = buf.len();
        fault_check!(RECV, fd, len);
        // SAFETY: `buf[..len]` is a valid write of `len` bytes (len ≤ buf.len()).
        let r = retry_eintr!(unsafe {
            libc::recv(fd, buf.as_mut_ptr().cast(), len, libc::MSG_DONTWAIT)
        });
        if r < 0 { -(errno() as isize) } else { r as isize }
    }

    /// Control buffer sized/aligned for one SCM_RIGHTS int.
    #[repr(C)]
    union CmsgBuf {
        hdr: libc::cmsghdr,
        buf: [u8; 64],
    }

    /// sendmsg with SCM_RIGHTS fd attachment (SpawnIpc, C14; socket.c:558-600).
    pub(crate) fn send_with_fd(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        data: &[u8],
        pass: LIBUS_SOCKET_DESCRIPTOR,
    ) -> isize {
        fault_check!(SENDMSG, fd);
        // SAFETY: msg/iov/cbuf are stack-valid across the call; the control
        // buffer is CMSG_SPACE(int)-sized and cmsghdr-aligned via the union.
        unsafe {
            let mut cbuf = CmsgBuf { buf: [0; 64] };
            let mut iov = libc::iovec {
                iov_base: data.as_ptr().cast_mut().cast(),
                iov_len: data.len(),
            };
            let mut msg: libc::msghdr = zeroed();
            msg.msg_iov = &mut iov;
            msg.msg_iovlen = 1;
            msg.msg_control = cbuf.buf.as_mut_ptr().cast();
            msg.msg_controllen = libc::CMSG_SPACE(size_of::<c_int>() as _) as _;

            let cmsg = libc::CMSG_FIRSTHDR(&msg);
            (*cmsg).cmsg_level = libc::SOL_SOCKET;
            (*cmsg).cmsg_type = libc::SCM_RIGHTS;
            (*cmsg).cmsg_len = libc::CMSG_LEN(size_of::<c_int>() as _) as _;
            ptr::write_unaligned(libc::CMSG_DATA(cmsg).cast::<c_int>(), pass);

            let r = retry_eintr!(libc::sendmsg(fd, &msg, 0));
            if r < 0 { -(errno() as isize) } else { r as isize }
        }
    }

    /// recvmsg with a one-int SCM_RIGHTS control buffer (ipc receive path,
    /// loop.c:646-676). Returns (bytes-or-negative-errno, received fd).
    pub(crate) fn recv_with_fd(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        buf: &mut [u8],
    ) -> (isize, Option<LIBUS_SOCKET_DESCRIPTOR>) {
        #[cfg(feature = "socket_fault_injection")]
        match crate::fault::check(crate::fault::RECVMSG, fd, 0) {
            Some(crate::fault::Fault::Errno(e)) => return (-(e as isize), None),
            Some(crate::fault::Fault::Zero) => return (0, None),
            Some(crate::fault::Fault::Clamp(_)) | None => {}
        }
        // SAFETY: msg/iov/cbuf are stack-valid across the call; the kernel
        // writes at most CMSG_LEN(int) control bytes and buf.len() data bytes.
        unsafe {
            let mut cbuf = CmsgBuf { buf: [0; 64] };
            let mut iov = libc::iovec {
                iov_base: buf.as_mut_ptr().cast(),
                iov_len: buf.len(),
            };
            let mut msg: libc::msghdr = zeroed();
            msg.msg_iov = &mut iov;
            msg.msg_iovlen = 1;
            msg.msg_control = cbuf.buf.as_mut_ptr().cast();
            msg.msg_controllen = libc::CMSG_LEN(size_of::<c_int>() as _) as _;

            let r = retry_eintr!(libc::recvmsg(fd, &mut msg, libc::MSG_DONTWAIT));
            if r < 0 {
                return (-(errno() as isize), None);
            }
            let mut received = None;
            if r > 0 && msg.msg_controllen > 0 {
                let cmsg = libc::CMSG_FIRSTHDR(&msg);
                if !cmsg.is_null()
                    && (*cmsg).cmsg_level == libc::SOL_SOCKET
                    && (*cmsg).cmsg_type == libc::SCM_RIGHTS
                {
                    received = Some(ptr::read_unaligned(libc::CMSG_DATA(cmsg).cast::<c_int>()));
                }
            }
            (r as isize, received)
        }
    }

    // ─────────────────── close / shutdown / nonblocking ───────────────────

    /// close(2) with optional SO_LINGER{1,0} RST (CloseCode::failure — C12,
    /// socket.c:305-309).
    pub(crate) fn close(fd: LIBUS_SOCKET_DESCRIPTOR, rst: bool) {
        if rst {
            let l = libc::linger { l_onoff: 1, l_linger: 0 };
            so(fd, libc::SOL_SOCKET, libc::SO_LINGER, &l);
        }
        // SAFETY: plain fd syscall; caller owns the fd.
        unsafe { libc::close(fd) };
    }

    pub(crate) fn shutdown(fd: LIBUS_SOCKET_DESCRIPTOR) {
        // SAFETY: plain fd syscall.
        unsafe { libc::shutdown(fd, libc::SHUT_WR) };
    }

    pub(crate) fn shutdown_read(fd: LIBUS_SOCKET_DESCRIPTOR) {
        // SAFETY: plain fd syscall.
        unsafe { libc::shutdown(fd, libc::SHUT_RD) };
    }

    /// Set O_NONBLOCK + FD_CLOEXEC via fcntl (bsd.c:356-373); returns `fd`.
    pub(crate) fn set_nonblocking(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        if fd != LIBUS_SOCKET_ERROR {
            // SAFETY: plain fd syscalls; failures are ignored as in C.
            unsafe {
                let flags = libc::fcntl(fd, libc::F_GETFL, 0);
                libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK);
                let flags = libc::fcntl(fd, libc::F_GETFD, 0);
                libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC);
            }
        }
        fd
    }

    fn apple_no_sigpipe(fd: LIBUS_SOCKET_DESCRIPTOR) -> LIBUS_SOCKET_DESCRIPTOR {
        #[cfg(target_vendor = "apple")]
        if fd != LIBUS_SOCKET_ERROR {
            let one: c_int = 1;
            so(fd, libc::SOL_SOCKET, libc::SO_NOSIGPIPE, &one);
        }
        fd
    }

    /// Public alias for the from_fd path (R3.27 applies it to adopted fds).
    pub(crate) fn no_sigpipe(fd: LIBUS_SOCKET_DESCRIPTOR) {
        apple_no_sigpipe(fd);
    }

    /// Write thread-local errno: listen registration failure reports through
    /// BOTH the out-param and errno (context.c:379-389).
    pub(crate) fn set_errno(v: i32) {
        // SAFETY: thread-local errno slot is always valid to write.
        unsafe {
            #[cfg(target_os = "linux")]
            {
                *libc::__errno_location() = v;
            }
            #[cfg(target_os = "android")]
            {
                *libc::__errno() = v;
            }
            #[cfg(target_vendor = "apple")]
            {
                *libc::__error() = v;
            }
            #[cfg(target_os = "freebsd")]
            {
                *libc::__error() = v;
            }
        }
    }

    /// socketpair(AF_UNIX, SOCK_STREAM) — POSIX only (R3.28). 0 on success
    /// with both fds written; fds are NOT made nonblocking here (from_fd does).
    pub(crate) fn socketpair_stream(fds: &mut [LIBUS_SOCKET_DESCRIPTOR; 2]) -> i32 {
        // SAFETY: `fds` is a caller-owned 2-int out array.
        unsafe { libc::socketpair(libc::AF_UNIX, libc::SOCK_STREAM, 0, fds.as_mut_ptr()) }
    }

    // ───────────────────── socket creation (R8.1) ─────────────────────

    /// socket(2), EINTR-retried, nonblocking + cloexec (one syscall where
    /// SOCK_CLOEXEC|SOCK_NONBLOCK exist), SO_NOSIGPIPE on Darwin.
    pub(crate) fn create_socket(
        domain: c_int,
        ty: c_int,
        protocol: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        #[cfg(not(target_vendor = "apple"))]
        {
            let flags = libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK;
            // SAFETY: plain syscall.
            let fd = retry_eintr!(unsafe { libc::socket(domain, ty | flags, protocol) });
            if fd == -1 {
                return Err(errno());
            }
            Ok(apple_no_sigpipe(fd))
        }
        #[cfg(target_vendor = "apple")]
        {
            // SAFETY: plain syscall.
            let fd = retry_eintr!(unsafe { libc::socket(domain, ty, protocol) });
            if fd == -1 {
                return Err(errno());
            }
            Ok(set_nonblocking(apple_no_sigpipe(fd)))
        }
    }

    // ───────────────────── addr plumbing (R8.2/R8.3) ─────────────────────

    /// `struct bsd_addr_t` equivalent: raw sockaddr storage + finalized view.
    /// IPs cross the API as raw 4/16 bytes — no string formatting (R8.2).
    pub(crate) struct BsdAddr {
        mem: libc::sockaddr_storage,
        len: libc::socklen_t,
        ip_off: u32,
        ip_len: u32,
        port: i32,
    }

    impl BsdAddr {
        pub(crate) fn zeroed() -> Self {
            BsdAddr {
                mem: pod_zeroed(),
                len: size_of::<libc::sockaddr_storage>() as _,
                ip_off: 0,
                ip_len: 0,
                port: -1,
            }
        }

        /// `internal_finalize_bsd_addr` (bsd.c:743-757): unknown family →
        /// empty ip, port −1.
        fn finalize(&mut self) {
            match self.mem.ss_family as c_int {
                libc::AF_INET6 => {
                    let sa = as_v6(&self.mem);
                    self.ip_off = offset_of!(libc::sockaddr_in6, sin6_addr) as u32;
                    self.ip_len = 16;
                    self.port = u16::from_be(sa.sin6_port) as i32;
                }
                libc::AF_INET => {
                    let sa = as_v4(&self.mem);
                    self.ip_off = offset_of!(libc::sockaddr_in, sin_addr) as u32;
                    self.ip_len = 4;
                    self.port = u16::from_be(sa.sin_port) as i32;
                }
                _ => {
                    self.ip_len = 0;
                    self.port = -1;
                }
            }
        }

        /// Raw address bytes (4 = v4, 16 = v6, empty = unknown family).
        pub(crate) fn ip(&self) -> &[u8] {
            // SAFETY: ip_off/ip_len point inside self.mem (set by finalize).
            unsafe {
                core::slice::from_raw_parts(
                    (&raw const self.mem).cast::<u8>().add(self.ip_off as usize),
                    self.ip_len as usize,
                )
            }
        }

        pub(crate) fn port(&self) -> i32 {
            self.port
        }
    }

    /// getsockname + finalize; None on failure (bsd.c:759-766).
    pub(crate) fn local_addr(fd: LIBUS_SOCKET_DESCRIPTOR) -> Option<BsdAddr> {
        let mut addr = BsdAddr::zeroed();
        // SAFETY: addr.len starts as sizeof(sockaddr_storage); kernel writes ≤ that.
        let rc = unsafe { libc::getsockname(fd, (&raw mut addr.mem).cast(), &mut addr.len) };
        if rc != 0 {
            return None;
        }
        addr.finalize();
        Some(addr)
    }

    /// getpeername + finalize; None on failure (bsd.c:768-775).
    pub(crate) fn remote_addr(fd: LIBUS_SOCKET_DESCRIPTOR) -> Option<BsdAddr> {
        let mut addr = BsdAddr::zeroed();
        // SAFETY: addr.len starts as sizeof(sockaddr_storage); kernel writes ≤ that.
        let rc = unsafe { libc::getpeername(fd, (&raw mut addr.mem).cast(), &mut addr.len) };
        if rc != 0 {
            return None;
        }
        addr.finalize();
        Some(addr)
    }

    // ───────────────────────── accept (R8.10) ─────────────────────────

    /// accept4(SOCK_CLOEXEC|SOCK_NONBLOCK) where available, EINTR-retried,
    /// with the macOS addrlen==0 dead-socket quirk (bsd.c:790-847).
    pub(crate) fn accept(
        fd: LIBUS_SOCKET_DESCRIPTOR,
    ) -> Result<(LIBUS_SOCKET_DESCRIPTOR, BsdAddr), i32> {
        #[cfg(feature = "socket_fault_injection")]
        match crate::fault::check(crate::fault::ACCEPT, fd, 0) {
            Some(crate::fault::Fault::Errno(e)) => return Err(e),
            Some(crate::fault::Fault::Zero) => return Err(errno()),
            Some(crate::fault::Fault::Clamp(_)) | None => {}
        }
        let mut addr = BsdAddr::zeroed();
        let accepted = loop {
            addr.len = size_of::<libc::sockaddr_storage>() as _;

            // SAFETY: addr.len tracks the storage capacity; kernel writes ≤ that.
            #[cfg(not(target_vendor = "apple"))]
            let accepted = unsafe {
                libc::accept4(
                    fd,
                    (&raw mut addr.mem).cast(),
                    &mut addr.len,
                    libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK,
                )
            };
            // SAFETY: addr.len tracks the storage capacity; kernel writes ≤ that.
            #[cfg(target_vendor = "apple")]
            let accepted = unsafe { libc::accept(fd, (&raw mut addr.mem).cast(), &mut addr.len) };

            if accepted == -1 && errno() == libc::EINTR {
                continue;
            }
            if accepted == LIBUS_SOCKET_ERROR {
                return Err(errno());
            }

            // XNU bug: dual-stack v4 RST-abort can accept() with addrlen==0
            // but buffered connectx() data may still be readable.
            #[cfg(target_vendor = "apple")]
            if addr.len == 0 {
                let mut peek = [0u8; 1];
                // SAFETY: 1-byte peek into a stack buffer.
                let has_data = unsafe {
                    libc::recv(
                        accepted,
                        peek.as_mut_ptr().cast(),
                        1,
                        libc::MSG_PEEK | libc::MSG_DONTWAIT,
                    )
                };
                if has_data <= 0 {
                    close(accepted, false);
                    continue;
                }
            }

            break accepted;
        };
        addr.finalize();
        #[cfg(target_vendor = "apple")]
        let accepted = set_nonblocking(apple_no_sigpipe(accepted));
        Ok((accepted, addr))
    }

    // ─────────────────── option helpers (R8.12-R8.14) ───────────────────

    pub(crate) fn nodelay(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: bool) {
        let v: c_int = enabled as c_int;
        so(fd, libc::IPPROTO_TCP, libc::TCP_NODELAY, &v);
    }

    /// SO_KEEPALIVE (+idle/intvl/cnt). Verbatim C convention (bsd.c:547-613):
    /// 0 on success, positive errno on setsockopt failure, −1 for delay==0.
    pub(crate) fn keepalive(fd: LIBUS_SOCKET_DESCRIPTOR, on: bool, delay: u32) -> i32 {
        let on_val: c_int = on as c_int;
        if so(fd, libc::SOL_SOCKET, libc::SO_KEEPALIVE, &on_val) != 0 {
            return errno();
        }
        if !on {
            return 0;
        }
        if delay == 0 {
            return -1;
        }
        #[cfg(target_vendor = "apple")]
        const IDLE_OPT: c_int = libc::TCP_KEEPALIVE;
        #[cfg(not(target_vendor = "apple"))]
        const IDLE_OPT: c_int = libc::TCP_KEEPIDLE;
        if so(fd, libc::IPPROTO_TCP, IDLE_OPT, &(delay as c_int)) != 0 {
            return errno();
        }
        let intvl: c_int = 1;
        if so(fd, libc::IPPROTO_TCP, libc::TCP_KEEPINTVL, &intvl) != 0 {
            return errno();
        }
        let cnt: c_int = 10;
        if so(fd, libc::IPPROTO_TCP, libc::TCP_KEEPCNT, &cnt) != 0 {
            return errno();
        }
        0
    }

    /// Option level for TOS: IP_TOS or IPV6_TCLASS by bound family (R8.13).
    fn tos_level(fd: LIBUS_SOCKET_DESCRIPTOR) -> Result<(c_int, c_int), i32> {
        let mut storage: libc::sockaddr_storage = pod_zeroed();
        let mut len = size_of::<libc::sockaddr_storage>() as libc::socklen_t;
        // SAFETY: `len` starts as sizeof(sockaddr_storage); kernel writes ≤ that.
        if unsafe { libc::getsockname(fd, (&raw mut storage).cast(), &mut len) } != 0 {
            return Err(-errno());
        }
        match storage.ss_family as c_int {
            libc::AF_INET => Ok((libc::IPPROTO_IP, libc::IP_TOS)),
            libc::AF_INET6 => Ok((libc::IPPROTO_IPV6, libc::IPV6_TCLASS)),
            _ => Err(-libc::EINVAL),
        }
    }

    /// 0 or negative errno.
    pub(crate) fn set_tos(fd: LIBUS_SOCKET_DESCRIPTOR, tos: i32) -> i32 {
        let (level, option) = match tos_level(fd) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if so(fd, level, option, &(tos as c_int)) != 0 {
            return -errno();
        }
        0
    }

    /// TOS value or negative errno.
    pub(crate) fn get_tos(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        let (level, option) = match tos_level(fd) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let mut tos: c_int = 0;
        let mut len = size_of::<c_int>() as libc::socklen_t;
        // SAFETY: kernel writes ≤ `len` (= sizeof(int)) bytes into `tos`.
        let rc = unsafe { libc::getsockopt(fd, level, option, (&raw mut tos).cast(), &mut len) };
        if rc != 0 {
            return -errno();
        }
        tos
    }

    /// Try the IPv6 option; on ENOPROTOOPT/EINVAL retry the IPv4 option
    /// (bsd.c:375-392). 0 or negative errno.
    fn setsockopt_6_or_4<T>(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        option4: c_int,
        option6: c_int,
        val: &T,
    ) -> i32 {
        if so(fd, libc::IPPROTO_IPV6, option6, val) == 0 {
            return 0;
        }
        let e = errno();
        if e == libc::ENOPROTOOPT || e == libc::EINVAL {
            if so(fd, libc::IPPROTO_IP, option4, val) == 0 {
                return 0;
            }
            return -errno();
        }
        -e
    }

    pub(crate) fn broadcast(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: bool) -> i32 {
        let v: c_int = enabled as c_int;
        if so(fd, libc::SOL_SOCKET, libc::SO_BROADCAST, &v) != 0 {
            return -errno();
        }
        0
    }

    pub(crate) fn multicast_loopback(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: bool) -> i32 {
        let v: c_int = enabled as c_int;
        setsockopt_6_or_4(fd, libc::IP_MULTICAST_LOOP, libc::IPV6_MULTICAST_LOOP, &v)
    }

    /// Rejects multicast-range (224.0.0.0/4) IPv4 interface addresses
    /// (bsd.c:406-435). 0 or negative errno.
    pub(crate) fn multicast_interface(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: &libc::sockaddr_storage,
    ) -> i32 {
        if addr.ss_family as c_int == libc::AF_INET {
            let addr4 = as_v4(addr);
            let first_octet = u32::from_be(addr4.sin_addr.s_addr) >> 24;
            if !(224..=239).contains(&first_octet) {
                if so(fd, libc::IPPROTO_IP, libc::IP_MULTICAST_IF, &addr4.sin_addr) != 0 {
                    return -errno();
                }
                return 0;
            }
        }
        if addr.ss_family as c_int == libc::AF_INET6 {
            let addr6 = as_v6(addr);
            if so(fd, libc::IPPROTO_IPV6, libc::IPV6_MULTICAST_IF, &addr6.sin6_scope_id) != 0 {
                return -errno();
            }
            return 0;
        }
        -libc::EINVAL
    }

    // Darwin's libc crate lacks group_source_req / MCAST_*_SOURCE_GROUP;
    // values and pack(4) layout from xnu netinet/in.h.
    #[cfg(target_vendor = "apple")]
    #[repr(C, packed(4))]
    struct GroupSourceReq {
        gsr_interface: u32,
        gsr_group: libc::sockaddr_storage,
        gsr_source: libc::sockaddr_storage,
    }
    // BSD value 82/83 (FreeBSD netinet/in.h, copied by xnu); linux 46/47.
    #[cfg(any(target_vendor = "apple", target_os = "freebsd"))]
    const MCAST_JOIN_SOURCE_GROUP: c_int = 82;
    #[cfg(any(target_vendor = "apple", target_os = "freebsd"))]
    const MCAST_LEAVE_SOURCE_GROUP: c_int = 83;
    // libc lacks `group_source_req` on linux/freebsd too; glibc/FreeBSD layout is
    // naturally aligned (sockaddr_storage is 8-aligned, 4 pad bytes after gsr_interface).
    #[cfg(not(target_vendor = "apple"))]
    #[repr(C)]
    struct GroupSourceReq {
        gsr_interface: u32,
        gsr_group: libc::sockaddr_storage,
        gsr_source: libc::sockaddr_storage,
    }
    #[cfg(not(any(target_vendor = "apple", target_os = "freebsd")))]
    use libc::{MCAST_JOIN_SOURCE_GROUP, MCAST_LEAVE_SOURCE_GROUP};

    /// IGMP membership; iface family must match addr's (bsd.c:437-475).
    pub(crate) fn set_membership(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: &libc::sockaddr_storage,
        iface: Option<&libc::sockaddr_storage>,
        drop: bool,
    ) -> i32 {
        if let Some(iface) = iface {
            if addr.ss_family != iface.ss_family {
                return -libc::EINVAL;
            }
        }
        let rc = if addr.ss_family as c_int == libc::AF_INET6 {
            let addr6 = as_v6(addr);
            let mut mreq: libc::ipv6_mreq = pod_zeroed();
            mreq.ipv6mr_multiaddr = addr6.sin6_addr;
            if let Some(iface) = iface {
                mreq.ipv6mr_interface = as_v6(iface).sin6_scope_id as _;
            }
            // linux libc spells IPV6_JOIN/LEAVE_GROUP as IPV6_ADD/DROP_MEMBERSHIP (same values).
            #[cfg(any(target_os = "linux", target_os = "android"))]
            let option =
                if drop { libc::IPV6_DROP_MEMBERSHIP } else { libc::IPV6_ADD_MEMBERSHIP };
            #[cfg(not(any(target_os = "linux", target_os = "android")))]
            let option = if drop { libc::IPV6_LEAVE_GROUP } else { libc::IPV6_JOIN_GROUP };
            so(fd, libc::IPPROTO_IPV6, option, &mreq)
        } else {
            let addr4 = as_v4(addr);
            let mut mreq: libc::ip_mreq = pod_zeroed();
            mreq.imr_multiaddr.s_addr = addr4.sin_addr.s_addr;
            mreq.imr_interface.s_addr = match iface {
                Some(iface) => as_v4(iface).sin_addr.s_addr,
                None => libc::INADDR_ANY.to_be(),
            };
            let option = if drop { libc::IP_DROP_MEMBERSHIP } else { libc::IP_ADD_MEMBERSHIP };
            so(fd, libc::IPPROTO_IP, option, &mreq)
        };
        if rc != 0 { -errno() } else { 0 }
    }

    /// Source-specific membership (bsd.c:477-525). All families must match.
    pub(crate) fn set_source_specific_membership(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        source: &libc::sockaddr_storage,
        group: &libc::sockaddr_storage,
        iface: Option<&libc::sockaddr_storage>,
        drop: bool,
    ) -> i32 {
        let family_ok = source.ss_family == group.ss_family
            && iface.is_none_or(|i| i.ss_family == group.ss_family);
        if family_ok {
            if source.ss_family as c_int == libc::AF_INET {
                let mut mreq: libc::ip_mreq_source = pod_zeroed();
                mreq.imr_interface.s_addr = match iface {
                    Some(iface) => as_v4(iface).sin_addr.s_addr,
                    None => libc::INADDR_ANY.to_be(),
                };
                mreq.imr_sourceaddr.s_addr = as_v4(source).sin_addr.s_addr;
                mreq.imr_multiaddr.s_addr = as_v4(group).sin_addr.s_addr;
                let option = if drop {
                    libc::IP_DROP_SOURCE_MEMBERSHIP
                } else {
                    libc::IP_ADD_SOURCE_MEMBERSHIP
                };
                if so(fd, libc::IPPROTO_IP, option, &mreq) != 0 {
                    return -errno();
                }
                return 0;
            } else if source.ss_family as c_int == libc::AF_INET6 {
                let mut mreq: GroupSourceReq = pod_zeroed();
                if let Some(iface) = iface {
                    mreq.gsr_interface = as_v6(iface).sin6_scope_id as _;
                }
                mreq.gsr_source = *source;
                mreq.gsr_group = *group;
                let option = if drop { MCAST_LEAVE_SOURCE_GROUP } else { MCAST_JOIN_SOURCE_GROUP };
                if so(fd, libc::IPPROTO_IPV6, option, &mreq) != 0 {
                    return -errno();
                }
                return 0;
            }
        }
        -libc::EINVAL
    }

    fn ttl_any(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: i32, opt4: c_int, opt6: c_int) -> i32 {
        if !(1..=255).contains(&ttl) {
            return -libc::EINVAL;
        }
        setsockopt_6_or_4(fd, opt4, opt6, &(ttl as c_int))
    }

    pub(crate) fn ttl_unicast(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: i32) -> i32 {
        ttl_any(fd, ttl, libc::IP_TTL, libc::IPV6_UNICAST_HOPS)
    }

    pub(crate) fn ttl_multicast(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: i32) -> i32 {
        ttl_any(fd, ttl, libc::IP_MULTICAST_TTL, libc::IPV6_MULTICAST_HOPS)
    }

    /// Linux TCP_DEFER_ACCEPT = 1s; FreeBSD SO_ACCEPTFILTER "dataready"
    /// (R8.8). 1 on success, 0 otherwise.
    pub(crate) fn set_defer_accept(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let timeout: c_int = 1;
            (so(fd, libc::IPPROTO_TCP, libc::TCP_DEFER_ACCEPT, &timeout) == 0) as i32
        }
        #[cfg(target_os = "freebsd")]
        {
            let mut afa: libc::accept_filter_arg = pod_zeroed();
            const NAME: &[u8] = b"dataready";
            for (dst, &src) in afa.af_name.iter_mut().zip(NAME) {
                *dst = src as _;
            }
            (so(fd, libc::SOL_SOCKET, libc::SO_ACCEPTFILTER, &afa) == 0) as i32
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        {
            let _ = fd;
            0
        }
    }

    // ───────────────────── listen path (R8.4-R8.6) ─────────────────────

    /// SO_REUSEPORT on non-Linux, SO_REUSEADDR on Linux — Android defines
    /// __linux__ so it takes the SO_REUSEADDR branch (bsd.c:1044-1051).
    fn set_reuseaddr(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        let one: c_int = 1;
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        return so(fd, libc::SOL_SOCKET, libc::SO_REUSEPORT, &one);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        so(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, &one)
    }

    fn set_reuseport(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        let one: c_int = 1;
        so(fd, libc::SOL_SOCKET, libc::SO_REUSEPORT, &one)
    }

    /// Reuse option sequence (R8.4). EXCLUSIVE_PORT is Windows-only. A
    /// missing-SO_REUSEPORT ENOTSUP is swallowed unless DISALLOW is set.
    /// pub(crate): shared with the UDP bind path (bsd_create_udp_socket).
    pub(crate) fn set_reuse(fd: LIBUS_SOCKET_DESCRIPTOR, options: c_int) -> Result<(), i32> {
        if options & LIBUS_LISTEN_REUSE_ADDR != 0 && set_reuseaddr(fd) != 0 {
            return Err(errno());
        }
        if options & LIBUS_LISTEN_REUSE_PORT != 0 && set_reuseport(fd) != 0 {
            let e = errno();
            if !(e == libc::ENOTSUP && options & LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE == 0) {
                return Err(e);
            }
            // C clears errno when swallowing the ENOTSUP (bsd.c:1091).
            set_errno(0);
        }
        Ok(())
    }

    fn bind_and_listen(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: *const libc::sockaddr,
        addrlen: libc::socklen_t,
        backlog: c_int,
    ) -> Result<(), i32> {
        // SAFETY: caller passes a live sockaddr spanning `addrlen` bytes.
        let rc = retry_eintr!(unsafe { libc::bind(fd, addr, addrlen) });
        if rc == -1 {
            return Err(errno());
        }
        // SAFETY: plain fd syscall.
        let rc = retry_eintr!(unsafe { libc::listen(fd, backlog) });
        if rc != 0 {
            return Err(errno());
        }
        Ok(())
    }

    /// `bsd_bind_listen_fd` (R8.5): reuse options; plain SO_REUSEADDR always
    /// on POSIX (TIME_WAIT rebinding); IPV6_V6ONLY per options (fatal on
    /// failure); bind + listen(512). Err(None) = C quirk: set_reuse/V6ONLY
    /// failures leave *error untouched (only bind/listen writes it).
    fn bind_listen_fd(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        family: c_int,
        addr: *const libc::sockaddr,
        addrlen: libc::socklen_t,
        options: c_int,
    ) -> Result<(), Option<i32>> {
        set_reuse(fd, options).map_err(|_| None)?;

        let one: c_int = 1;
        so(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, &one);

        if family == libc::AF_INET6 {
            let enabled: c_int = (options & LIBUS_SOCKET_IPV6_ONLY != 0) as c_int;
            if so(fd, libc::IPPROTO_IPV6, libc::IPV6_V6ONLY, &enabled) != 0 {
                return Err(None);
            }
        }

        bind_and_listen(fd, addr, addrlen, 512).map_err(Some)
    }

    /// `bsd_create_listen_socket` (R8.6): getaddrinfo(AI_PASSIVE, AF_UNSPEC,
    /// SOCK_STREAM) on the decimal port; all AF_INET6 candidates first, then
    /// AF_INET; first bind+listen wins. Err(0) when getaddrinfo itself failed
    /// or no candidate socket could be created (C leaves `*error` untouched).
    pub(crate) fn create_listen_socket(
        host: Option<&CStr>,
        port: i32,
        options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let mut hints: libc::addrinfo = pod_zeroed();
        hints.ai_flags = libc::AI_PASSIVE;
        hints.ai_family = libc::AF_UNSPEC;
        hints.ai_socktype = libc::SOCK_STREAM;

        let port_string = std::ffi::CString::new(port.to_string()).unwrap();
        let host_ptr = match host {
            Some(h) => h.as_ptr(),
            None => ptr::null(),
        };
        let mut result: *mut libc::addrinfo = ptr::null_mut();
        // SAFETY: host/port are NUL-terminated; `result` is freed below on
        // every path after a 0 return.
        let rc = unsafe { libc::getaddrinfo(host_ptr, port_string.as_ptr(), &hints, &mut result) };
        if rc != 0 {
            return Err(0);
        }

        let mut error = 0;
        for family in [libc::AF_INET6, libc::AF_INET] {
            let mut a = result;
            while !a.is_null() {
                // SAFETY: non-null node of the live getaddrinfo list.
                let ai = unsafe { &*a };
                if ai.ai_family == family {
                    if let Ok(fd) = create_socket(ai.ai_family, ai.ai_socktype, ai.ai_protocol) {
                        match bind_listen_fd(fd, ai.ai_family, ai.ai_addr, ai.ai_addrlen as _, options)
                        {
                            Ok(()) => {
                                // SAFETY: `result` is the live list; freed once.
                                unsafe { libc::freeaddrinfo(result) };
                                return Ok(fd);
                            }
                            Err(e) => {
                                if let Some(e) = e {
                                    error = e;
                                }
                                close(fd, false);
                            }
                        }
                    }
                }
                a = ai.ai_next;
            }
        }
        // SAFETY: `result` is the live list; freed once.
        unsafe { libc::freeaddrinfo(result) };
        Err(error)
    }

    // ──────────────── unix sockets (R8.7) — long-path workarounds ────────────────

    #[cfg(target_vendor = "apple")]
    unsafe extern "C" {
        /// Per-thread chdir; stable Darwin syscall since 10.5. -1 clears it.
        fn __pthread_fchdir(fd: c_int) -> c_int;
    }

    /// sizeof(sun_path): 108 on Linux, 104 on Darwin. sun_path is the final,
    /// unpadded field of sockaddr_un, so size minus offset is its length.
    const SUN_PATH_LEN: usize =
        size_of::<libc::sockaddr_un>() - offset_of!(libc::sockaddr_un, sun_path);

    struct UnixSocketAddr {
        addr: libc::sockaddr_un,
        len: libc::socklen_t,
        /// Kept open across bind/connect for the long-path workaround; -1 = unused.
        dirfd: c_int,
    }

    /// Split `path` at the last '/' as bsd.c:1251-1254 does; dirname keeps the
    /// trailing slash. Err(ENAMETOOLONG) mirrors every C failure in this path.
    #[cfg(any(target_os = "linux", target_os = "android", target_vendor = "apple"))]
    fn split_long_unix_path(path: &[u8]) -> Result<(usize, &[u8]), i32> {
        let mut dirname_len = path.len();
        while dirname_len > 1 && path[dirname_len - 1] != b'/' {
            dirname_len -= 1;
        }
        let basename = &path[dirname_len..];
        if dirname_len < 2 || basename.len() + 1 >= SUN_PATH_LEN || dirname_len + 1 > 4096 {
            return Err(libc::ENAMETOOLONG);
        }
        Ok((dirname_len, basename))
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_vendor = "apple"))]
    fn open_socket_dir(path: &[u8], dirname_len: usize, flags: c_int) -> Result<c_int, i32> {
        // C copies into a NUL-terminated buffer: an interior NUL truncates.
        let dirname = &path[..dirname_len];
        let dirname = &dirname[..dirname.iter().position(|&b| b == 0).unwrap_or(dirname.len())];
        let cstr = std::ffi::CString::new(dirname).unwrap();
        // SAFETY: cstr is NUL-terminated and outlives the call.
        let dirfd = unsafe { libc::open(cstr.as_ptr(), flags | libc::O_CLOEXEC, 0o700) };
        if dirfd == -1 {
            return Err(libc::ENAMETOOLONG);
        }
        Ok(dirfd)
    }

    fn copy_to_sun_path(addr: &mut libc::sockaddr_un, bytes: &[u8]) {
        // SAFETY: caller checked bytes.len() < SUN_PATH_LEN; sun_path is zeroed.
        unsafe {
            ptr::copy_nonoverlapping(
                bytes.as_ptr(),
                addr.sun_path.as_mut_ptr().cast::<u8>(),
                bytes.len(),
            );
        }
    }

    /// sun_path overflow workaround: Linux rewrites through
    /// /proc/self/fd/<dirfd>/<basename> (bsd.c:1246-1296).
    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn long_unix_path(path: &[u8], ua: &mut UnixSocketAddr) -> Result<(), i32> {
        let (dirname_len, basename) = split_long_unix_path(path)?;
        let dirfd = open_socket_dir(path, dirname_len, libc::O_PATH | libc::O_DIRECTORY)?;

        let mut sun = [0u8; SUN_PATH_LEN];
        let mut n = 0;
        let mut push = |bytes: &[u8]| -> bool {
            if n + bytes.len() >= SUN_PATH_LEN {
                return false;
            }
            sun[n..n + bytes.len()].copy_from_slice(bytes);
            n += bytes.len();
            true
        };
        let fits = push(b"/proc/self/fd/")
            && push(dirfd.to_string().as_bytes())
            && push(b"/")
            && push(basename);
        if !fits {
            // SAFETY: dirfd is owned here and unpublished.
            unsafe { libc::close(dirfd) };
            return Err(libc::ENAMETOOLONG);
        }
        copy_to_sun_path(&mut ua.addr, &sun[..n]);
        ua.dirfd = dirfd;
        Ok(())
    }

    /// Darwin: /dev/fd/N/ is not traversable, so open the parent dir and let
    /// the caller __pthread_fchdir into it with a relative basename
    /// (bsd.c:1298-1335).
    #[cfg(target_vendor = "apple")]
    fn long_unix_path(path: &[u8], ua: &mut UnixSocketAddr) -> Result<(), i32> {
        let (dirname_len, basename) = split_long_unix_path(path)?;
        let dirfd = open_socket_dir(path, dirname_len, libc::O_RDONLY | libc::O_DIRECTORY)?;
        copy_to_sun_path(&mut ua.addr, basename);
        ua.dirfd = dirfd;
        Ok(())
    }

    /// `bsd_create_unix_socket_address` (R8.7). Empty path → ENOENT; abstract
    /// sockets (leading NUL, Linux) shrink addrlen; oversize → ENAMETOOLONG.
    fn create_unix_socket_address(path: &[u8]) -> Result<UnixSocketAddr, i32> {
        let mut ua = UnixSocketAddr {
            addr: pod_zeroed(),
            len: size_of::<libc::sockaddr_un>() as _,
            dirfd: -1,
        };
        ua.addr.sun_family = libc::AF_UNIX as _;

        if path.is_empty() {
            return Err(libc::ENOENT);
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        if path.len() >= SUN_PATH_LEN && path[0] != 0 {
            long_unix_path(path, &mut ua)?;
            return Ok(ua);
        }
        #[cfg(target_vendor = "apple")]
        if path.len() >= SUN_PATH_LEN {
            long_unix_path(path, &mut ua)?;
            return Ok(ua);
        }

        if path.len() >= SUN_PATH_LEN {
            return Err(libc::ENAMETOOLONG);
        }
        copy_to_sun_path(&mut ua.addr, path);
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if path[0] == 0 {
            ua.len = (offset_of!(libc::sockaddr_un, sun_path) + path.len()) as _;
        }
        Ok(ua)
    }

    /// Builds the address, wraps `f` in the Darwin __pthread_fchdir dance,
    /// and closes the workaround dirfd on every exit (bsd.c:1389-1414).
    fn with_unix_addr(
        path: &[u8],
        f: impl FnOnce(*const libc::sockaddr, libc::socklen_t) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32>,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let ua = create_unix_socket_address(path)?;

        // SAFETY: dirfd is a live directory fd owned by `ua`.
        #[cfg(target_vendor = "apple")]
        if ua.dirfd != -1 && unsafe { __pthread_fchdir(ua.dirfd) } != 0 {
            // SAFETY: closing our own dirfd.
            unsafe { libc::close(ua.dirfd) };
            return Err(libc::ENAMETOOLONG);
        }

        let r = f((&raw const ua.addr).cast(), ua.len);

        if ua.dirfd != -1 {
            // Darwin restores the bind/connect errno around the teardown
            // (bsd.c saved_errno dance) — cabi consumers read thread errno.
            #[cfg(target_vendor = "apple")]
            {
                let saved = errno();
                // SAFETY: -1 clears the per-thread cwd override set above.
                unsafe { __pthread_fchdir(-1) };
                // SAFETY: closing our own dirfd, exactly once.
                unsafe { libc::close(ua.dirfd) };
                set_errno(saved);
            }
            // SAFETY: closing our own dirfd, exactly once.
            #[cfg(not(target_vendor = "apple"))]
            unsafe {
                libc::close(ua.dirfd)
            };
        }
        r
    }

    /// `bsd_create_listen_socket_unix`: no reuse options, no unlink of stale
    /// socket files — bind fails EADDRINUSE and the caller deals with it.
    pub(crate) fn create_listen_socket_unix(
        path: &[u8],
        _options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        with_unix_addr(path, |addr, addrlen| {
            let fd = create_socket(libc::AF_UNIX, libc::SOCK_STREAM, 0)?;
            if let Err(e) = bind_and_listen(fd, addr, addrlen, 512) {
                close(fd, false);
                return Err(e);
            }
            Ok(fd)
        })
    }

    /// `bsd_create_connect_socket_unix`.
    pub(crate) fn create_connect_socket_unix(
        path: &[u8],
        _options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        with_unix_addr(path, |addr, addrlen| {
            let fd = create_socket(libc::AF_UNIX, libc::SOCK_STREAM, 0)?;
            let rc = do_connect_raw(fd, addr, addrlen);
            if rc != 0 {
                close(fd, false);
                return Err(rc);
            }
            Ok(fd)
        })
    }

    // ───────────────────────── connect (R8.9) ─────────────────────────

    /// EINTR-retried connect; EINPROGRESS and `-1 && errno==0` count as
    /// success (bsd.c:1643-1690). Returns 0 or the connect errno.
    pub(crate) fn do_connect_raw(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: *const libc::sockaddr,
        addrlen: libc::socklen_t,
    ) -> i32 {
        #[cfg(feature = "socket_fault_injection")]
        match crate::fault::check(crate::fault::CONNECT, fd, 0) {
            // C returns the (just-set) errno on fire.
            Some(crate::fault::Fault::Errno(e)) => return e,
            Some(crate::fault::Fault::Zero) => return errno(),
            Some(crate::fault::Fault::Clamp(_)) | None => {}
        }
        let r = loop {
            set_errno(0);
            // SAFETY: caller passes a live sockaddr spanning `addrlen` bytes.
            let r = unsafe { libc::connect(fd, addr, addrlen) };
            if r == -1 && errno() == libc::EINTR {
                continue;
            }
            break r;
        };
        if r == -1 && errno() != 0 {
            if errno() == libc::EINPROGRESS {
                return 0;
            }
            return errno();
        }
        0
    }

    fn ip_addrlen(family: c_int) -> libc::socklen_t {
        if family == libc::AF_INET {
            size_of::<libc::sockaddr_in>() as _
        } else {
            size_of::<libc::sockaddr_in6>() as _
        }
    }

    /// `bsd_create_connect_socket` (R8.9): optional local bind (SO_REUSEADDR
    /// first, matching libuv; TIME_WAIT local-port reuse), then nonblocking
    /// connect. Err carries errno.
    pub(crate) fn create_connect_socket(
        addr: &libc::sockaddr_storage,
        local_addr: Option<&libc::sockaddr_storage>,
        _options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let fd = create_socket(addr.ss_family as c_int, libc::SOCK_STREAM, 0)?;

        if let Some(local) = local_addr {
            let one: c_int = 1;
            so(fd, libc::SOL_SOCKET, libc::SO_REUSEADDR, &one);
            let local_len = ip_addrlen(local.ss_family as c_int);
            // SAFETY: `local` outlives the call; local_len ≤ its size.
            let rc = unsafe { libc::bind(fd, ptr::from_ref(local).cast(), local_len) };
            if rc != 0 {
                let e = errno();
                close(fd, false);
                return Err(e);
            }
        }

        let rc = do_connect_raw(fd, ptr::from_ref(addr).cast(), ip_addrlen(addr.ss_family as c_int));
        if rc != 0 {
            close(fd, false);
            return Err(rc);
        }
        Ok(fd)
    }

    /// `init_addr_with_port` (context.c:530-540): resolved DNS entry →
    /// connect sockaddr with the requested port stamped over the entry's.
    pub(crate) fn addr_from_entry(
        info: *const bun_dns::addrinfo,
        port: u16,
    ) -> libc::sockaddr_storage {
        // SAFETY: `info` is a live entry of the DNS request's result buffer
        // (borrowed until freeRequest); `ai_addr` spans `ai_addrlen` bytes of
        // the family it declares.
        unsafe {
            let mut storage: libc::sockaddr_storage = zeroed();
            let len = (*info).ai_addrlen as usize;
            ptr::copy_nonoverlapping(
                (*info).ai_addr.cast::<u8>(),
                (&raw mut storage).cast::<u8>(),
                len.min(size_of::<libc::sockaddr_storage>()),
            );
            if (*info).ai_family == libc::AF_INET {
                (*(&raw mut storage).cast::<libc::sockaddr_in>()).sin_port = port.to_be();
            } else {
                (*(&raw mut storage).cast::<libc::sockaddr_in6>()).sin6_port = port.to_be();
            }
            storage
        }
    }

    // libc 0.2.186 does not declare inet_pton; POSIX symbol present in every unix libc.
    unsafe extern "C" {
        fn inet_pton(af: c_int, src: *const c_char, dst: *mut c_void) -> c_int;
    }

    /// `try_parse_ip` (context.c:542-565): literal v4 then v6 with the port
    /// stamped in; never resolves. `None` = not a literal.
    pub(crate) fn try_parse_ip(host: &CStr, port: u16) -> Option<super::ConnectAddr> {
        // SAFETY: inet_pton reads the NUL-terminated string and writes only
        // the (in-bounds) address field of the zeroed storage.
        unsafe {
            let mut storage: libc::sockaddr_storage = zeroed();
            let v4 = (&raw mut storage).cast::<libc::sockaddr_in>();
            if inet_pton(libc::AF_INET, host.as_ptr(), (&raw mut (*v4).sin_addr).cast()) == 1
            {
                (*v4).sin_family = libc::AF_INET as libc::sa_family_t;
                (*v4).sin_port = port.to_be();
                #[cfg(target_vendor = "apple")]
                {
                    (*v4).sin_len = size_of::<libc::sockaddr_in>() as u8;
                }
                return Some(storage);
            }
            let v6 = (&raw mut storage).cast::<libc::sockaddr_in6>();
            if inet_pton(libc::AF_INET6, host.as_ptr(), (&raw mut (*v6).sin6_addr).cast())
                == 1
            {
                (*v6).sin6_family = libc::AF_INET6 as libc::sa_family_t;
                (*v6).sin6_port = port.to_be();
                #[cfg(target_vendor = "apple")]
                {
                    (*v6).sin6_len = size_of::<libc::sockaddr_in6>() as u8;
                }
                return Some(storage);
            }
            None
        }
    }
}

/// Windows: the winsock arm of the BSD layer (bsd.c `_WIN32` branches).
/// Byte-count ops return `-WSAGetLastError()` (WSAEWOULDBLOCK = 10035 is the
/// would-block sentinel socket.rs/write.rs key on); fd ops return
/// `Result<fd, wsa_error>`; option setters `0 / -wsa_error` — the same
/// shapes as the POSIX arm above, so callers stay platform-neutral.
#[cfg(windows)]
mod imp {
    use core::ffi::{CStr, c_int, c_void};
    use core::mem::{offset_of, size_of};
    use core::ptr;

    use super::win::{self, SockaddrStorage, ws2};
    use crate::write::UsIoVec;
    use crate::{
        LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE, LIBUS_LISTEN_EXCLUSIVE_PORT,
        LIBUS_LISTEN_REUSE_ADDR, LIBUS_LISTEN_REUSE_PORT, LIBUS_SOCKET_DESCRIPTOR,
        LIBUS_SOCKET_ERROR, LIBUS_SOCKET_IPV6_ONLY,
    };

    pub(crate) fn errno() -> i32 {
        std::io::Error::last_os_error().raw_os_error().unwrap_or(0)
    }

    /// Fault hook for byte-count ops (mirrors the POSIX arm; R11.1).
    #[cfg_attr(not(feature = "socket_fault_injection"), allow(unused_macros))]
    macro_rules! fault_check {
        ($sc:ident, $fd:expr, $len:ident) => {
            #[cfg(feature = "socket_fault_injection")]
            match crate::fault::check(crate::fault::$sc, $fd as c_int, $len) {
                Some(crate::fault::Fault::Errno(e)) => return -(e as isize),
                Some(crate::fault::Fault::Zero) => return 0,
                Some(crate::fault::Fault::Clamp(n)) => $len = n,
                None => {}
            }
        };
    }

    /// send via winsock; flags 0 (no MSG_NOSIGNAL/MSG_DONTWAIT on Windows —
    /// internal.h defined both to 0; sockets are nonblocking via FIONBIO).
    pub(crate) fn send(fd: LIBUS_SOCKET_DESCRIPTOR, data: &[u8]) -> isize {
        #[cfg_attr(not(feature = "socket_fault_injection"), allow(unused_mut))]
        let mut len = data.len();
        fault_check!(SEND, fd, len);
        let len = len.min(c_int::MAX as usize) as c_int;
        let r = loop {
            // SAFETY: `data[..len]` is a valid read of `len` bytes (len ≤ data.len()).
            let r = unsafe { ws2::send(fd, data.as_ptr().cast(), len, 0) };
            if r == win::SOCKET_ERROR && win::wsa_errno() == win::WSAEINTR {
                continue;
            }
            break r;
        };
        if r < 0 { -(win::wsa_errno() as isize) } else { r as isize }
    }

    /// `bsd_writev` windows arm (bsd.c:988-997): sequential sends, stopping
    /// at the first short/failed chunk (each send carries the SEND fault
    /// hook, as in C). The C returned `total>0 ? total : -1` with the WSA
    /// error in TLS; the Rust convention carries it in the return instead.
    pub(crate) fn writev(fd: LIBUS_SOCKET_DESCRIPTOR, iov: &[UsIoVec]) -> isize {
        let mut total: isize = 0;
        for chunk in iov {
            // SAFETY: each UsIoVec borrows caller-owned bytes for this call.
            let data = unsafe { core::slice::from_raw_parts(chunk.base.cast::<u8>(), chunk.len) };
            let written = send(fd, data);
            if written < 0 {
                return if total > 0 { total } else { written };
            }
            total += written;
            if written != data.len() as isize {
                break;
            }
        }
        total
    }

    /// `bsd_write2` (bsd.c:999-1008): two sequential sends; the payload send
    /// is attempted only if the header fully flushed.
    pub(crate) fn write2(fd: LIBUS_SOCKET_DESCRIPTOR, first: &[u8], second: &[u8]) -> isize {
        let written = send(fd, first);
        if written == first.len() as isize {
            let second_write = send(fd, second);
            if second_write > 0 {
                return written + second_write;
            }
        }
        written
    }

    /// recv via winsock into the loop's shared buffer, WSAEINTR-retried.
    pub(crate) fn recv(fd: LIBUS_SOCKET_DESCRIPTOR, buf: &mut [u8]) -> isize {
        #[cfg_attr(not(feature = "socket_fault_injection"), allow(unused_mut))]
        let mut len = buf.len();
        fault_check!(RECV, fd, len);
        let len = len.min(c_int::MAX as usize) as c_int;
        let r = loop {
            // SAFETY: `buf[..len]` is a valid write of `len` bytes (len ≤ buf.len()).
            let r = unsafe { ws2::recv(fd, buf.as_mut_ptr().cast(), len, 0) };
            if r == win::SOCKET_ERROR && win::wsa_errno() == win::WSAEINTR {
                continue;
            }
            break r;
        };
        if r < 0 { -(win::wsa_errno() as isize) } else { r as isize }
    }

    /// R6.9 pre-step (context.c:749-765): zero-length MSG_PUSH_IMMEDIATE recv
    /// exposes a connect that completed-then-reset in the AFD race window.
    /// Returns 0 (still good) or the WSA error to treat as a connect error.
    pub(crate) fn connect_probe(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        const MSG_PUSH_IMMEDIATE: c_int = 0x8; // ws2def.h
        // SAFETY: zero-length recv reads no buffer memory.
        if unsafe { ws2::recv(fd, core::ptr::null_mut(), 0, MSG_PUSH_IMMEDIATE) }
            != win::SOCKET_ERROR
        {
            return 0;
        }
        match win::wsa_errno() {
            e if e == win::WSAEWOULDBLOCK || e == win::WSAEINTR => 0,
            e => e,
        }
    }

    /// closesocket with optional SO_LINGER{1,0} RST (CloseCode::failure —
    /// C12, socket.c:305-309). `closesocket`, never CRT `close` (bsd.c:720-726).
    pub(crate) fn close(fd: LIBUS_SOCKET_DESCRIPTOR, rst: bool) {
        if rst {
            let l = win::linger { l_onoff: 1, l_linger: 0 };
            win::so(fd, win::SOL_SOCKET, win::SO_LINGER, &l);
        }
        // SAFETY: plain socket-handle call; caller owns the socket.
        unsafe { ws2::closesocket(fd) };
    }

    pub(crate) fn shutdown(fd: LIBUS_SOCKET_DESCRIPTOR) {
        // SAFETY: plain socket-handle call.
        unsafe { win::shutdown(fd, win::SD_SEND) };
    }

    pub(crate) fn shutdown_read(fd: LIBUS_SOCKET_DESCRIPTOR) {
        // SAFETY: plain socket-handle call.
        unsafe { win::shutdown(fd, win::SD_RECEIVE) };
    }

    /// No-op on Windows (R8.1): libuv sets FIONBIO at poll init; connect
    /// paths call `win::set_fionbio` explicitly.
    pub(crate) fn set_nonblocking(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        fd as i32
    }

    /// No-op off Darwin.
    pub(crate) fn no_sigpipe(_fd: LIBUS_SOCKET_DESCRIPTOR) {}

    /// Mirror of `errno()`: winsock error codes live in the thread's
    /// last-error slot (`WSAGetLastError` == `GetLastError`), so the
    /// save/restore dance around close() round-trips through it.
    pub(crate) fn set_errno(v: i32) {
        ws2::WSASetLastError(v);
    }

    /// POSIX-only (R3.28): pair() returns null on Windows.
    pub(crate) fn socketpair_stream(_fds: &mut [LIBUS_SOCKET_DESCRIPTOR; 2]) -> i32 {
        -1
    }

    /// `bsd_create_socket` (R8.1): plain socket() — nonblocking comes from
    /// libuv poll init / explicit FIONBIO on connect paths. No-inherit is
    /// the FD_CLOEXEC parity bit.
    pub(crate) fn create_socket(
        domain: c_int,
        ty: c_int,
        protocol: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let fd = loop {
            // SAFETY: plain constructor call.
            let fd = unsafe { win::socket(domain, ty, protocol) };
            if fd == LIBUS_SOCKET_ERROR && win::wsa_errno() == win::WSAEINTR {
                continue;
            }
            break fd;
        };
        if fd == LIBUS_SOCKET_ERROR {
            return Err(win::wsa_errno());
        }
        win::set_no_inherit(fd);
        Ok(fd)
    }

    // ───────────────────── addr plumbing (R8.2/R8.3) ─────────────────────

    /// `struct bsd_addr_t` equivalent (winsock SOCKADDR_STORAGE backing).
    pub(crate) struct BsdAddr {
        mem: SockaddrStorage,
        len: c_int,
        ip_off: u32,
        ip_len: u32,
        port: i32,
    }

    impl BsdAddr {
        pub(crate) fn zeroed() -> Self {
            BsdAddr {
                mem: win::pod_zeroed(),
                len: size_of::<SockaddrStorage>() as c_int,
                ip_off: 0,
                ip_len: 0,
                port: -1,
            }
        }

        /// `internal_finalize_bsd_addr` (bsd.c:743-757): unknown family →
        /// empty ip, port −1.
        fn finalize(&mut self) {
            match c_int::from(self.mem.ss_family) {
                x if x == ws2::AF_INET6 => {
                    let sa = win::as_v6(&self.mem);
                    self.ip_off = offset_of!(ws2::sockaddr_in6, sin6_addr) as u32;
                    self.ip_len = 16;
                    self.port = u16::from_be(sa.sin6_port) as i32;
                }
                x if x == ws2::AF_INET => {
                    let sa = win::as_v4(&self.mem);
                    self.ip_off = offset_of!(ws2::sockaddr_in, sin_addr) as u32;
                    self.ip_len = 4;
                    self.port = u16::from_be(sa.sin_port) as i32;
                }
                _ => {
                    self.ip_len = 0;
                    self.port = -1;
                }
            }
        }

        /// Raw address bytes (4 = v4, 16 = v6, empty = unknown family).
        pub(crate) fn ip(&self) -> &[u8] {
            // SAFETY: ip_off/ip_len point inside self.mem (set by finalize).
            unsafe {
                core::slice::from_raw_parts(
                    (&raw const self.mem).cast::<u8>().add(self.ip_off as usize),
                    self.ip_len as usize,
                )
            }
        }

        pub(crate) fn port(&self) -> i32 {
            self.port
        }
    }

    /// getsockname + finalize; None on failure (bsd.c:759-766).
    pub(crate) fn local_addr(fd: LIBUS_SOCKET_DESCRIPTOR) -> Option<BsdAddr> {
        let mut addr = BsdAddr::zeroed();
        // SAFETY: addr.len starts as sizeof(SOCKADDR_STORAGE); winsock writes ≤ that.
        let rc = unsafe { win::getsockname(fd, (&raw mut addr.mem).cast(), &mut addr.len) };
        if rc != 0 {
            return None;
        }
        addr.finalize();
        Some(addr)
    }

    /// getpeername + finalize; None on failure (bsd.c:768-775).
    pub(crate) fn remote_addr(fd: LIBUS_SOCKET_DESCRIPTOR) -> Option<BsdAddr> {
        let mut addr = BsdAddr::zeroed();
        // SAFETY: addr.len starts as sizeof(SOCKADDR_STORAGE); winsock writes ≤ that.
        let rc = unsafe { win::getpeername(fd, (&raw mut addr.mem).cast(), &mut addr.len) };
        if rc != 0 {
            return None;
        }
        addr.finalize();
        Some(addr)
    }

    /// Plain accept + no-inherit, WSAEINTR-retried (R8.10). The accepted
    /// socket stays blocking until uv_poll_init_socket sets FIONBIO — the C
    /// relied on the same poll-init timing.
    pub(crate) fn accept(
        fd: LIBUS_SOCKET_DESCRIPTOR,
    ) -> Result<(LIBUS_SOCKET_DESCRIPTOR, BsdAddr), i32> {
        #[cfg(feature = "socket_fault_injection")]
        match crate::fault::check(crate::fault::ACCEPT, fd as c_int, 0) {
            Some(crate::fault::Fault::Errno(e)) => return Err(e),
            Some(crate::fault::Fault::Zero) => return Err(errno()),
            Some(crate::fault::Fault::Clamp(_)) | None => {}
        }
        let mut addr = BsdAddr::zeroed();
        let accepted = loop {
            addr.len = size_of::<SockaddrStorage>() as c_int;
            // SAFETY: addr.len tracks the storage capacity; winsock writes ≤ that.
            let accepted = unsafe { win::accept(fd, (&raw mut addr.mem).cast(), &mut addr.len) };
            if accepted == LIBUS_SOCKET_ERROR {
                if win::wsa_errno() == win::WSAEINTR {
                    continue;
                }
                return Err(win::wsa_errno());
            }
            break accepted;
        };
        win::set_no_inherit(accepted);
        addr.finalize();
        Ok((accepted, addr))
    }

    // ─────────────────── option helpers (R8.12-R8.14) ───────────────────

    pub(crate) fn nodelay(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: bool) {
        let v: c_int = enabled as c_int;
        win::so(fd, ws2::IPPROTO_TCP, win::TCP_NODELAY, &v);
    }

    /// SO_KEEPALIVE + TCP_KEEPALIVE idle seconds (bsd.c:583-611). Win32's
    /// interval/count defaults already match the POSIX arm's 1 s / 10.
    /// Verbatim C convention: 0 on success, positive WSA error on setsockopt
    /// failure, −4071 (UV_EINVAL, the LIBUS_USE_LIBUV branch) for delay==0.
    pub(crate) fn keepalive(fd: LIBUS_SOCKET_DESCRIPTOR, on: bool, delay: u32) -> i32 {
        let on_val: c_int = on as c_int;
        if win::so(fd, win::SOL_SOCKET, win::SO_KEEPALIVE, &on_val) != 0 {
            return win::wsa_errno();
        }
        if !on {
            return 0;
        }
        if delay < 1 {
            return -4071; // UV_EINVAL
        }
        if win::so(fd, ws2::IPPROTO_TCP, win::TCP_KEEPALIVE, &(delay as c_int)) != 0 {
            return win::wsa_errno();
        }
        0
    }

    /// Option level for TOS: IP_TOS or IPV6_TCLASS by bound family (R8.13).
    /// Unknown family → −EINVAL with the CRT value, exactly as the C did.
    fn tos_level(fd: LIBUS_SOCKET_DESCRIPTOR) -> Result<(c_int, c_int), i32> {
        const EINVAL_CRT: i32 = 22; // errno.h EINVAL (the C returned -EINVAL here)
        let mut storage: SockaddrStorage = win::pod_zeroed();
        let mut len = size_of::<SockaddrStorage>() as c_int;
        // SAFETY: `len` starts as sizeof(SOCKADDR_STORAGE); winsock writes ≤ that.
        if unsafe { win::getsockname(fd, (&raw mut storage).cast(), &mut len) } != 0 {
            return Err(-win::wsa_errno());
        }
        match c_int::from(storage.ss_family) {
            x if x == ws2::AF_INET => Ok((win::IPPROTO_IP, win::IP_TOS)),
            x if x == ws2::AF_INET6 => Ok((win::IPPROTO_IPV6, win::IPV6_TCLASS)),
            _ => Err(-EINVAL_CRT),
        }
    }

    /// 0 or negative WSA error.
    pub(crate) fn set_tos(fd: LIBUS_SOCKET_DESCRIPTOR, tos: i32) -> i32 {
        let (level, option) = match tos_level(fd) {
            Ok(v) => v,
            Err(e) => return e,
        };
        if win::so(fd, level, option, &(tos as c_int)) != 0 {
            return -win::wsa_errno();
        }
        0
    }

    /// TOS value or negative WSA error.
    pub(crate) fn get_tos(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        let (level, option) = match tos_level(fd) {
            Ok(v) => v,
            Err(e) => return e,
        };
        let mut tos: c_int = 0;
        let mut len = size_of::<c_int>() as c_int;
        // SAFETY: winsock writes ≤ `len` (= sizeof(int)) bytes into `tos`.
        let rc = unsafe { win::getsockopt(fd, level, option, (&raw mut tos).cast(), &mut len) };
        if rc != 0 {
            return -win::wsa_errno();
        }
        tos
    }

    pub(crate) fn broadcast(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: bool) -> i32 {
        let v: c_int = enabled as c_int;
        if win::so(fd, win::SOL_SOCKET, win::SO_BROADCAST, &v) != 0 {
            return -win::wsa_errno();
        }
        0
    }

    pub(crate) fn multicast_loopback(fd: LIBUS_SOCKET_DESCRIPTOR, enabled: bool) -> i32 {
        let v: c_int = enabled as c_int;
        win::setsockopt_6_or_4(fd, win::IP_MULTICAST_LOOP, win::IPV6_MULTICAST_LOOP, &v)
    }

    /// Rejects multicast-range (224.0.0.0/4) IPv4 interface addresses; the
    /// windows arm also rejects an invalid socket with WSAEBADF
    /// (bsd.c:407-435). 0 or negative WSA error.
    pub(crate) fn multicast_interface(fd: LIBUS_SOCKET_DESCRIPTOR, addr: &SockaddrStorage) -> i32 {
        if fd == LIBUS_SOCKET_ERROR {
            return -win::WSAEBADF;
        }
        if c_int::from(addr.ss_family) == ws2::AF_INET {
            let addr4 = win::as_v4(addr);
            let first_octet = u32::from_be(addr4.sin_addr.s_addr) >> 24;
            if !(224..=239).contains(&first_octet) {
                if win::so(fd, win::IPPROTO_IP, win::IP_MULTICAST_IF, &addr4.sin_addr) != 0 {
                    return -win::wsa_errno();
                }
                return 0;
            }
        }
        if c_int::from(addr.ss_family) == ws2::AF_INET6 {
            let addr6 = win::as_v6(addr);
            if win::so(fd, win::IPPROTO_IPV6, win::IPV6_MULTICAST_IF, &addr6.sin6_scope_id) != 0 {
                return -win::wsa_errno();
            }
            return 0;
        }
        -win::WSAEINVAL
    }

    /// IGMP membership; iface family must match addr's (bsd.c:437-475).
    pub(crate) fn set_membership(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: &SockaddrStorage,
        iface: Option<&SockaddrStorage>,
        drop: bool,
    ) -> i32 {
        if let Some(iface) = iface {
            if addr.ss_family != iface.ss_family {
                return -win::WSAEINVAL;
            }
        }
        let rc = if c_int::from(addr.ss_family) == ws2::AF_INET6 {
            let addr6 = win::as_v6(addr);
            let mut mreq: win::ipv6_mreq = win::pod_zeroed();
            mreq.ipv6mr_multiaddr = addr6.sin6_addr;
            if let Some(iface) = iface {
                mreq.ipv6mr_interface = win::as_v6(iface).sin6_scope_id as _;
            }
            let option = if drop { win::IPV6_LEAVE_GROUP } else { win::IPV6_JOIN_GROUP };
            win::so(fd, win::IPPROTO_IPV6, option, &mreq)
        } else {
            let addr4 = win::as_v4(addr);
            let mut mreq: win::ip_mreq = win::pod_zeroed();
            mreq.imr_multiaddr.s_addr = addr4.sin_addr.s_addr;
            mreq.imr_interface.s_addr = match iface {
                Some(iface) => win::as_v4(iface).sin_addr.s_addr,
                None => 0, // INADDR_ANY
            };
            let option =
                if drop { win::IP_DROP_MEMBERSHIP } else { win::IP_ADD_MEMBERSHIP };
            win::so(fd, win::IPPROTO_IP, option, &mreq)
        };
        if rc != 0 { -win::wsa_errno() } else { 0 }
    }

    /// Source-specific membership (bsd.c:477-525). All families must match.
    pub(crate) fn set_source_specific_membership(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        source: &SockaddrStorage,
        group: &SockaddrStorage,
        iface: Option<&SockaddrStorage>,
        drop: bool,
    ) -> i32 {
        let family_ok = source.ss_family == group.ss_family
            && iface.is_none_or(|i| i.ss_family == group.ss_family);
        if family_ok {
            if c_int::from(source.ss_family) == ws2::AF_INET {
                let mut mreq: win::ip_mreq_source = win::pod_zeroed();
                mreq.imr_interface.s_addr = match iface {
                    Some(iface) => win::as_v4(iface).sin_addr.s_addr,
                    None => 0, // INADDR_ANY
                };
                mreq.imr_sourceaddr.s_addr = win::as_v4(source).sin_addr.s_addr;
                mreq.imr_multiaddr.s_addr = win::as_v4(group).sin_addr.s_addr;
                let option = if drop {
                    win::IP_DROP_SOURCE_MEMBERSHIP
                } else {
                    win::IP_ADD_SOURCE_MEMBERSHIP
                };
                if win::so(fd, win::IPPROTO_IP, option, &mreq) != 0 {
                    return -win::wsa_errno();
                }
                return 0;
            } else if c_int::from(source.ss_family) == ws2::AF_INET6 {
                let mut mreq: win::group_source_req = win::pod_zeroed();
                if let Some(iface) = iface {
                    mreq.gsr_interface = win::as_v6(iface).sin6_scope_id as _;
                }
                mreq.gsr_source = *source;
                mreq.gsr_group = *group;
                let option = if drop {
                    win::MCAST_LEAVE_SOURCE_GROUP
                } else {
                    win::MCAST_JOIN_SOURCE_GROUP
                };
                if win::so(fd, win::IPPROTO_IPV6, option, &mreq) != 0 {
                    return -win::wsa_errno();
                }
                return 0;
            }
        }
        -win::WSAEINVAL
    }

    fn ttl_any(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: i32, opt4: c_int, opt6: c_int) -> i32 {
        if !(1..=255).contains(&ttl) {
            return -win::WSAEINVAL;
        }
        win::setsockopt_6_or_4(fd, opt4, opt6, &(ttl as c_int))
    }

    pub(crate) fn ttl_unicast(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: i32) -> i32 {
        ttl_any(fd, ttl, win::IP_TTL, win::IPV6_UNICAST_HOPS)
    }

    pub(crate) fn ttl_multicast(fd: LIBUS_SOCKET_DESCRIPTOR, ttl: i32) -> i32 {
        ttl_any(fd, ttl, win::IP_MULTICAST_TTL, win::IPV6_MULTICAST_HOPS)
    }

    /// Unsupported platform → 0 (R8.8).
    pub(crate) fn set_defer_accept(_fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        0
    }

    // ───────────────────── listen path (R8.4-R8.6) ─────────────────────

    /// Reuse option sequence (R8.4, windows arm): SO_EXCLUSIVEADDRUSE for
    /// EXCLUSIVE_PORT; REUSE_ADDR → SO_REUSEADDR (no SO_REUSEPORT on
    /// Windows, bsd.c:1044-1051); REUSE_PORT is always unsupported →
    /// WSAEOPNOTSUPP, swallowed unless DISALLOW (bsd.c:1054-1098).
    pub(crate) fn set_reuse(fd: LIBUS_SOCKET_DESCRIPTOR, options: c_int) -> Result<(), i32> {
        let one: c_int = 1;
        if options & LIBUS_LISTEN_EXCLUSIVE_PORT != 0
            && win::so(fd, win::SOL_SOCKET, win::SO_EXCLUSIVEADDRUSE, &one) != 0
        {
            return Err(win::wsa_errno());
        }
        if options & LIBUS_LISTEN_REUSE_ADDR != 0
            && win::so(fd, win::SOL_SOCKET, win::SO_REUSEADDR, &one) != 0
        {
            return Err(win::wsa_errno());
        }
        if options & LIBUS_LISTEN_REUSE_PORT != 0 {
            if options & LIBUS_LISTEN_DISALLOW_REUSE_PORT_FAILURE != 0 {
                return Err(win::WSAEOPNOTSUPP);
            }
            // C clears errno when swallowing the unsupported option.
            set_errno(0);
        }
        Ok(())
    }

    fn bind_and_listen(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: *const ws2::sockaddr,
        addrlen: c_int,
        backlog: c_int,
    ) -> Result<(), i32> {
        loop {
            // SAFETY: caller passes a live sockaddr spanning `addrlen` bytes.
            let rc = unsafe { win::bind(fd, addr, addrlen) };
            if rc == win::SOCKET_ERROR {
                if win::wsa_errno() == win::WSAEINTR {
                    continue;
                }
                return Err(win::wsa_errno());
            }
            break;
        }
        loop {
            // SAFETY: plain socket-handle call.
            let rc = unsafe { win::listen(fd, backlog) };
            if rc != 0 {
                if win::wsa_errno() == win::WSAEINTR {
                    continue;
                }
                return Err(win::wsa_errno());
            }
            break;
        }
        Ok(())
    }

    /// `bsd_bind_listen_fd` (R8.5, windows arm): reuse options; NO plain
    /// SO_REUSEADDR (port stealing — bsd.c:1115-1122); IPV6_V6ONLY per
    /// options (fatal); bind + listen(512). Err(None) = C quirk: set_reuse/
    /// V6ONLY failures leave *error untouched (only bind/listen writes it).
    fn bind_listen_fd(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        family: c_int,
        addr: *const ws2::sockaddr,
        addrlen: c_int,
        options: c_int,
    ) -> Result<(), Option<i32>> {
        set_reuse(fd, options).map_err(|_| None)?;

        if family == ws2::AF_INET6 {
            let enabled: c_int = (options & LIBUS_SOCKET_IPV6_ONLY != 0) as c_int;
            if win::so(fd, win::IPPROTO_IPV6, win::IPV6_V6ONLY, &enabled) != 0 {
                return Err(None);
            }
        }

        bind_and_listen(fd, addr, addrlen, 512).map_err(Some)
    }

    /// `bsd_create_listen_socket` (R8.6): getaddrinfo(AI_PASSIVE, AF_UNSPEC,
    /// SOCK_STREAM) on the decimal port; all AF_INET6 candidates first, then
    /// AF_INET; first bind+listen wins. Err(0) when getaddrinfo itself failed
    /// or no candidate socket could be created (C leaves `*error` untouched).
    pub(crate) fn create_listen_socket(
        host: Option<&CStr>,
        port: i32,
        options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let mut hints: ws2::addrinfo = win::pod_zeroed();
        hints.ai_flags = win::AI_PASSIVE;
        hints.ai_family = ws2::AF_UNSPEC;
        hints.ai_socktype = ws2::SOCK_STREAM;

        let port_string = std::ffi::CString::new(port.to_string()).unwrap();
        let host_ptr = match host {
            Some(h) => h.as_ptr(),
            None => ptr::null(),
        };
        let mut result: *mut ws2::addrinfo = ptr::null_mut();
        // SAFETY: host/port are NUL-terminated; `result` is freed below on
        // every path after a 0 return.
        let rc =
            unsafe { ws2::getaddrinfo(host_ptr, port_string.as_ptr(), &hints, &mut result) };
        if rc != 0 {
            return Err(0);
        }

        let mut error = 0;
        for family in [ws2::AF_INET6, ws2::AF_INET] {
            let mut a = result;
            while !a.is_null() {
                // SAFETY: non-null node of the live getaddrinfo list.
                let ai = unsafe { &*a };
                if ai.ai_family == family {
                    if let Ok(fd) = create_socket(ai.ai_family, ai.ai_socktype, ai.ai_protocol) {
                        match bind_listen_fd(fd, ai.ai_family, ai.ai_addr, ai.ai_addrlen as c_int, options)
                        {
                            Ok(()) => {
                                // SAFETY: `result` is the live list; freed once.
                                unsafe { ws2::freeaddrinfo(result) };
                                return Ok(fd);
                            }
                            Err(e) => {
                                if let Some(e) = e {
                                    error = e;
                                }
                                close(fd, false);
                            }
                        }
                    }
                }
                a = ai.ai_next;
            }
        }
        // SAFETY: `result` is the live list; freed once.
        unsafe { ws2::freeaddrinfo(result) };
        Err(error)
    }

    // ─────────────────────── unix sockets (R8.7) ───────────────────────
    // afunix.h since Win10 RS4; no long-path workaround (sun_path is 108
    // and NT paths can't be shortened the /proc/self/fd way). The C
    // simulated ENOENT/ENAMETOOLONG via SetLastError win32 codes.

    fn create_unix_socket_address(path: &[u8]) -> Result<win::sockaddr_un, i32> {
        if path.is_empty() {
            return Err(win::ERROR_PATH_NOT_FOUND); // simulated ENOENT
        }
        let mut addr: win::sockaddr_un = win::pod_zeroed();
        addr.sun_family = ws2::AF_UNIX as u16;
        if path.len() >= addr.sun_path.len() {
            return Err(win::ERROR_FILENAME_EXCED_RANGE); // simulated ENAMETOOLONG
        }
        addr.sun_path[..path.len()].copy_from_slice(path);
        Ok(addr)
    }

    /// `bsd_create_listen_socket_unix`: no reuse options, no unlink of stale
    /// socket files. afunix bind on a missing directory fails WSAENETDOWN,
    /// which the C mapped to ERROR_PATH_NOT_FOUND (bsd.c:1362-1370).
    pub(crate) fn create_listen_socket_unix(
        path: &[u8],
        _options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let addr = create_unix_socket_address(path)?;
        let fd = create_socket(ws2::AF_UNIX, ws2::SOCK_STREAM, 0)?;
        if let Err(e) =
            bind_and_listen(fd, (&raw const addr).cast(), size_of::<win::sockaddr_un>() as c_int, 512)
        {
            close(fd, false);
            return Err(if e == win::WSAENETDOWN { win::ERROR_PATH_NOT_FOUND } else { e });
        }
        Ok(fd)
    }

    /// `bsd_create_connect_socket_unix`.
    pub(crate) fn create_connect_socket_unix(
        path: &[u8],
        _options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let addr = create_unix_socket_address(path)?;
        let fd = create_socket(ws2::AF_UNIX, ws2::SOCK_STREAM, 0)?;
        win::set_fionbio(fd);
        let rc =
            do_connect_raw(fd, (&raw const addr).cast(), size_of::<win::sockaddr_un>() as c_int);
        if rc != 0 {
            close(fd, false);
            return Err(rc);
        }
        Ok(fd)
    }

    // ───────────────────────── connect (R8.9) ─────────────────────────

    /// WSAEINTR-retried connect; WSAEINPROGRESS/WSAEWOULDBLOCK/WSAEALREADY
    /// count as success (bsd.c:1648-1676). Returns 0 or the WSA error.
    pub(crate) fn do_connect_raw(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        addr: *const ws2::sockaddr,
        addrlen: c_int,
    ) -> i32 {
        #[cfg(feature = "socket_fault_injection")]
        match crate::fault::check(crate::fault::CONNECT, fd as c_int, 0) {
            // C returns the (just-set) errno on fire.
            Some(crate::fault::Fault::Errno(e)) => return e,
            Some(crate::fault::Fault::Zero) => return errno(),
            Some(crate::fault::Fault::Clamp(_)) | None => {}
        }
        loop {
            // SAFETY: caller passes a live sockaddr spanning `addrlen` bytes.
            if unsafe { win::connect(fd, addr, addrlen) } == 0 {
                return 0;
            }
            match win::wsa_errno() {
                e if e == win::WSAEINPROGRESS
                    || e == win::WSAEWOULDBLOCK
                    || e == win::WSAEALREADY =>
                {
                    return 0;
                }
                e if e == win::WSAEINTR => continue,
                e => return e,
            }
        }
    }

    /// Null-address connects (0.0.0.0 / ::) don't work on Windows — rewrite
    /// to the loopback of the same family (bsd.c:1694-1712).
    fn convert_null_addr(addr: &SockaddrStorage) -> Option<SockaddrStorage> {
        if c_int::from(addr.ss_family) == ws2::AF_INET {
            if win::as_v4(addr).sin_addr.s_addr == 0 {
                let mut result = *addr;
                // SAFETY: result is SOCKADDR_STORAGE with ss_family AF_INET.
                unsafe {
                    (*(&raw mut result).cast::<ws2::sockaddr_in>()).sin_addr.s_addr =
                        0x7f000001u32.to_be(); // INADDR_LOOPBACK
                }
                return Some(result);
            }
        } else if c_int::from(addr.ss_family) == ws2::AF_INET6 {
            let v6 = win::as_v6(addr);
            if v6.sin6_addr.s6_addr == [0u8; 16] {
                let mut result = *addr;
                let mut loopback = [0u8; 16];
                loopback[15] = 1; // in6addr_loopback
                // SAFETY: result is SOCKADDR_STORAGE with ss_family AF_INET6.
                unsafe {
                    (*(&raw mut result).cast::<ws2::sockaddr_in6>()).sin6_addr.s6_addr = loopback;
                }
                return Some(result);
            }
        }
        None
    }

    fn is_loopback(addr: &SockaddrStorage) -> bool {
        if c_int::from(addr.ss_family) == ws2::AF_INET {
            win::as_v4(addr).sin_addr.s_addr == 0x7f000001u32.to_be()
        } else if c_int::from(addr.ss_family) == ws2::AF_INET6 {
            let mut loopback = [0u8; 16];
            loopback[15] = 1;
            win::as_v6(addr).sin6_addr.s6_addr == loopback
        } else {
            false
        }
    }

    /// `bsd_create_connect_socket` windows arm (bsd.c:1727-1799): optional
    /// local bind (NO SO_REUSEADDR — port stealing), explicit FIONBIO,
    /// null-addr→loopback rewrite, SIO_TCP_INITIAL_RTO fast-fail for
    /// loopback (IPv6-first connect probing), then nonblocking connect.
    pub(crate) fn create_connect_socket(
        addr: &super::ConnectAddr,
        local_addr: Option<&super::ConnectAddr>,
        _options: c_int,
    ) -> Result<LIBUS_SOCKET_DESCRIPTOR, i32> {
        let fd = create_socket(c_int::from(addr.ss_family), ws2::SOCK_STREAM, 0)?;

        if let Some(local) = local_addr {
            let local_len = win::ip_addrlen(c_int::from(local.ss_family));
            // SAFETY: `local` outlives the call; local_len ≤ its size.
            let rc = unsafe { win::bind(fd, ptr::from_ref(local).cast(), local_len) };
            if rc != 0 {
                let e = win::wsa_errno();
                close(fd, false);
                // closesocket clobbers the thread error slot; C restores it.
                set_errno(e);
                return Err(e);
            }
        }

        win::set_fionbio(fd);

        let converted = convert_null_addr(addr);
        let addr = converted.as_ref().unwrap_or(addr);

        if is_loopback(addr) {
            // Fail fast (no SYN retransmissions) so the v6→v4 fallback isn't
            // stuck behind the 2 s default (libuv win/tcp.c:806 parity).
            let mut rto = win::TCP_INITIAL_RTO_PARAMETERS {
                Rtt: win::TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS as u16,
                MaxSynRetransmissions: win::TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS,
            };
            let mut bytes: u32 = 0;
            // SAFETY: in-buffer is a live TCP_INITIAL_RTO_PARAMETERS; no
            // out-buffer; failure deliberately ignored, matching the C.
            unsafe {
                win::WSAIoctl(
                    fd,
                    win::SIO_TCP_INITIAL_RTO,
                    (&raw mut rto).cast::<c_void>(),
                    size_of::<win::TCP_INITIAL_RTO_PARAMETERS>() as u32,
                    ptr::null_mut(),
                    0,
                    &mut bytes,
                    ptr::null_mut(),
                    ptr::null_mut(),
                )
            };
        }

        let rc = do_connect_raw(
            fd,
            ptr::from_ref(addr).cast(),
            win::ip_addrlen(c_int::from(addr.ss_family)),
        );
        if rc != 0 {
            close(fd, false);
            return Err(rc);
        }
        Ok(fd)
    }

    /// `init_addr_with_port` (context.c:530-540): resolved DNS entry →
    /// connect sockaddr with the requested port stamped over the entry's.
    pub(crate) fn addr_from_entry(
        info: *const bun_dns::addrinfo,
        port: u16,
    ) -> super::ConnectAddr {
        // SAFETY: `info` is a live entry of the DNS request's result buffer
        // (borrowed until freeRequest); `ai_addr` spans `ai_addrlen` bytes of
        // the family it declares.
        unsafe {
            let mut storage: super::ConnectAddr = win::pod_zeroed();
            let len = (*info).ai_addrlen;
            ptr::copy_nonoverlapping(
                (*info).ai_addr.cast::<u8>(),
                (&raw mut storage).cast::<u8>(),
                len.min(size_of::<super::ConnectAddr>()),
            );
            if (*info).ai_family == ws2::AF_INET {
                (*(&raw mut storage).cast::<ws2::sockaddr_in>()).sin_port = port.to_be();
            } else {
                (*(&raw mut storage).cast::<ws2::sockaddr_in6>()).sin6_port = port.to_be();
            }
            storage
        }
    }

    /// `try_parse_ip` (context.c:542-565): literal v4 then v6 with the port
    /// stamped in; never resolves. `None` = not a literal.
    pub(crate) fn try_parse_ip(host: &CStr, port: u16) -> Option<super::ConnectAddr> {
        // SAFETY: inet_pton reads the NUL-terminated string and writes only
        // the (in-bounds) address field of the zeroed storage.
        unsafe {
            let mut storage: super::ConnectAddr = win::pod_zeroed();
            let v4 = (&raw mut storage).cast::<ws2::sockaddr_in>();
            if win::inet_pton(ws2::AF_INET, host.as_ptr(), (&raw mut (*v4).sin_addr).cast()) == 1
            {
                (*v4).sin_family = ws2::AF_INET as u16;
                (*v4).sin_port = port.to_be();
                return Some(storage);
            }
            let v6 = (&raw mut storage).cast::<ws2::sockaddr_in6>();
            if win::inet_pton(ws2::AF_INET6, host.as_ptr(), (&raw mut (*v6).sin6_addr).cast())
                == 1
            {
                (*v6).sin6_family = ws2::AF_INET6 as u16;
                (*v6).sin6_port = port.to_be();
                return Some(storage);
            }
            None
        }
    }
}

pub(crate) use imp::*;

// ─────────────────────────────────────────────────────────────────────────────
// UDP edges (docs/semantics.md §9) — raw-pointer field
// access, kernel poll arming, and mmsg batches for udp.rs (forbid(unsafe)).
// Ownership: `udp::Socket` boxes come from `Socket::create` (heap::into_raw)
// and are freed ONLY by `udp_destroy` — create's failure path (before the
// pointer escapes) or the tick-postlude closed sweep (C6/C15).
// ─────────────────────────────────────────────────────────────────────────────

use crate::loop_::Loop;
use crate::udp;

/// Live-loop deref. The borrow must NOT be held across any consumer callback
/// (C17) — re-derive per use.
pub(crate) fn loop_mut<'a>(loop_: *mut Loop) -> &'a mut Loop {
    // SAFETY: loops live from creation to thread exit; callers pass the
    // owning loop pointer on its own thread and drop the borrow before
    // re-entering consumer code.
    unsafe { &mut *loop_ }
}

// ── udp::Socket raw-pointer access ───────────────────────────────────────────

pub(crate) fn udp_is_closed(s: *mut udp::Socket) -> bool {
    // SAFETY: sockets on `closed_udp_head` stay readable until the tick
    // postlude (C6/C15); live handles are always readable.
    unsafe { (*s).closed }
}

pub(crate) fn udp_meta(s: *mut udp::Socket) -> udp::Meta {
    // SAFETY: same readability contract as `udp_is_closed`; every copied
    // field is immutable after create.
    unsafe {
        udp::Meta {
            fd: (*s).fd,
            loop_: (*s).loop_,
            data_cb: (*s).data_cb,
            drain_cb: (*s).drain_cb,
            recv_error_cb: (*s).recv_error_cb,
        }
    }
}

pub(crate) fn udp_poll_events(s: *mut udp::Socket) -> u32 {
    // SAFETY: readability contract as above.
    unsafe { (*s).poll_events }
}

/// kqueue EVFILT_WRITE is one-shot: drop the believed W bit after delivery
/// (loop.c:556-563 equivalent, scoped to the UDP poll).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub(crate) fn udp_clear_writable_believed(s: *mut udp::Socket) {
    // SAFETY: dispatch holds no other borrow of `*s` at the call site.
    unsafe { (*s).poll_events &= !crate::backend::Events::WRITABLE.0 }
}

pub(crate) fn udp_next_closed(s: *mut udp::Socket) -> *mut udp::Socket {
    // SAFETY: closed-list nodes stay readable until swept (C6).
    unsafe { (*s).next_closed }
}

/// Close through a raw handle (dispatch's close-on-error path).
pub(crate) fn udp_close_raw(s: *mut udp::Socket) {
    // SAFETY: dispatch holds no live borrow of `*s` when calling; `close`
    // re-enters the consumer only via the raw pointer it derives itself.
    unsafe { (&mut *s).close() }
}

/// Free a swept socket — the ONLY deallocation site for `udp::Socket`.
pub(crate) fn udp_destroy(s: *mut udp::Socket) {
    // SAFETY: called only by the tick-postlude sweep or create's failure
    // path; no handle may touch `*s` afterwards (C6).
    unsafe { bun_core::heap::destroy(s) }
}

#[cfg(not(windows))]
mod udp_imp {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    use core::mem::size_of;
    use core::ptr;

    use super::{close, create_socket, errno, local_addr, remote_addr, set_reuse};
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    use crate::backend::Events;
    use crate::backend::PollType;
    use crate::loop_::Loop;
    use crate::udp::{self, PacketBuffer};
    use crate::{LIBUS_SOCKET_DESCRIPTOR, LIBUS_SOCKET_ERROR, LIBUS_SOCKET_IPV6_ONLY};

    #[inline]
    fn so_int(fd: c_int, level: c_int, name: c_int, value: c_int) -> c_int {
        // SAFETY: `value` outlives the call.
        unsafe {
            libc::setsockopt(
                fd,
                level,
                name,
                (&value as *const c_int).cast(),
                size_of::<c_int>() as libc::socklen_t,
            )
        }
    }

    // ── kernel poll arming (UDP-only subset of R2.7/R2.8/R2.9/R2.10) ────────

    /// udata word: `socket_ptr | PollType::Udp` (`udp::Socket` is align(16),
    /// so the tag fits the low 4 bits). Dispatch: mask with 0xf, match
    /// `PollType::Udp`, call `udp::dispatch_ready_poll`.
    fn udp_tag(s: *mut udp::Socket) -> usize {
        (s as usize) | (PollType::Udp as usize)
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn epoll_ctl_retry(epfd: c_int, op: c_int, fd: c_int, ev: *mut libc::epoll_event) -> c_int {
        loop {
            // SAFETY: plain epoll_ctl on fds we own; `ev` outlives the call.
            let rc = unsafe { libc::epoll_ctl(epfd, op, fd, ev) };
            if rc == 0 || errno() != libc::EINTR {
                return rc;
            }
        }
    }

    /// R2.9 kqueue state machine: single source of truth in the backend
    /// (level-triggered R, one-shot W, zero-events one-shot-W, errno mirror).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    fn kqueue_change(kqfd: c_int, fd: c_int, old: u32, new: u32, udata: usize) -> c_int {
        crate::backend::kqueue::kqueue_change(kqfd, fd, Events(old), Events(new), udata as u64)
    }

    /// Register the UDP fd (`us_poll_start_rc` equivalent). 0 on success.
    pub(crate) fn udp_poll_start(loop_: *mut Loop, s: *mut udp::Socket, events: u32) -> c_int {
        // SAFETY: `s` is live and not yet visible to any callback.
        let fd = unsafe {
            (*s).poll_events = events;
            (*s).fd
        };
        let loop_fd = super::loop_mut(loop_).fd;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let mut ev = libc::epoll_event {
                events,
                u64: udp_tag(s) as u64,
            };
            epoll_ctl_retry(loop_fd, libc::EPOLL_CTL_ADD, fd, &mut ev)
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            kqueue_change(loop_fd, fd, 0, events, udp_tag(s))
        }
    }

    /// `us_poll_change` equivalent: no-op when the believed events match.
    pub(crate) fn udp_poll_change(loop_: *mut Loop, s: *mut udp::Socket, events: u32) {
        // SAFETY: callers derive `s` from their own live handle/&mut.
        let (fd, old) = unsafe { ((*s).fd, (*s).poll_events) };
        if old == events {
            return;
        }
        // SAFETY: as above.
        unsafe { (*s).poll_events = events };
        let loop_fd = super::loop_mut(loop_).fd;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = old;
            let mut ev = libc::epoll_event {
                events,
                u64: udp_tag(s) as u64,
            };
            epoll_ctl_retry(loop_fd, libc::EPOLL_CTL_MOD, fd, &mut ev);
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            kqueue_change(loop_fd, fd, old, events, udp_tag(s));
        }
    }

    /// `us_poll_stop` equivalent. Poll bits in `*s` are NOT cleared (R2.10).
    pub(crate) fn udp_poll_stop(loop_: *mut Loop, s: *mut udp::Socket) {
        // SAFETY: as in `udp_poll_change`.
        let (fd, old) = unsafe { ((*s).fd, (*s).poll_events) };
        let loop_fd = super::loop_mut(loop_).fd;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let _ = old;
            // DEL's event argument may be null since Linux 2.6.9 (R2.10).
            epoll_ctl_retry(loop_fd, libc::EPOLL_CTL_DEL, fd, ptr::null_mut());
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            if old != 0 {
                // The zero-events rule may arm a NULL-udata one-shot write;
                // it is delivered later as a null ready poll and skipped.
                kqueue_change(loop_fd, fd, old, 0, 0);
            }
        }
    }

    // ── create/bind (bsd_create_udp_socket — R9.8) ──────────────────────────

    /// getaddrinfo(AI_PASSIVE, SOCK_DGRAM), IPv6-preferred; reuse opts,
    /// IPV6_V6ONLY, PKTINFO, RECVTCLASS/RECVTOS, Linux IP_RECVERR(+v6); bind.
    /// `*err` = -gai on DNS failure, errno otherwise; 0 on success.
    pub(crate) fn udp_bind_fd(
        host: *const c_char,
        port: u16,
        options: c_int,
        err: &mut c_int,
    ) -> LIBUS_SOCKET_DESCRIPTOR {
        *err = 0;
        // SAFETY: zeroed addrinfo is a valid hints value.
        let mut hints: libc::addrinfo = unsafe { core::mem::zeroed() };
        hints.ai_flags = libc::AI_PASSIVE;
        hints.ai_family = libc::AF_UNSPEC;
        hints.ai_socktype = libc::SOCK_DGRAM;
        let port_string = format!("{port}\0");
        let mut result: *mut libc::addrinfo = ptr::null_mut();
        // SAFETY: `host` is caller-provided NUL-terminated (or null);
        // `port_string` is NUL-terminated and outlives the call.
        let gai =
            unsafe { libc::getaddrinfo(host, port_string.as_ptr().cast(), &hints, &mut result) };
        if gai != 0 {
            *err = -gai;
            return LIBUS_SOCKET_ERROR;
        }

        let mut listen_fd = LIBUS_SOCKET_ERROR;
        let mut listen_addr: *mut libc::addrinfo = ptr::null_mut();
        for family in [libc::AF_INET6, libc::AF_INET] {
            let mut a = result;
            while !a.is_null() && listen_fd == LIBUS_SOCKET_ERROR {
                // SAFETY: `a` walks the getaddrinfo-owned list.
                unsafe {
                    if (*a).ai_family == family {
                        *err = 0;
                        match create_socket((*a).ai_family, (*a).ai_socktype, (*a).ai_protocol) {
                            Ok(fd) => listen_fd = fd,
                            Err(e) => *err = e,
                        }
                        listen_addr = a;
                    }
                    a = (*a).ai_next;
                }
            }
        }
        if listen_fd == LIBUS_SOCKET_ERROR {
            // SAFETY: `result` came from getaddrinfo above.
            unsafe { libc::freeaddrinfo(result) };
            return LIBUS_SOCKET_ERROR;
        }

        if let Err(e) = set_reuse(listen_fd, options) {
            *err = e;
            close(listen_fd, false);
            // SAFETY: as above.
            unsafe { libc::freeaddrinfo(result) };
            return LIBUS_SOCKET_ERROR;
        }

        // SAFETY: listen_addr points into the live getaddrinfo list.
        let family = unsafe { (*listen_addr).ai_family };
        if family == libc::AF_INET6 {
            let enabled = c_int::from(options & LIBUS_SOCKET_IPV6_ONLY != 0);
            if so_int(listen_fd, libc::IPPROTO_IPV6, libc::IPV6_V6ONLY, enabled) != 0 {
                // Quirk ported verbatim (bsd.c:1478-1481): fd + addrinfo leak,
                // *err left at 0.
                return LIBUS_SOCKET_ERROR;
            }
        }

        // Destination-address reporting: IPV6_RECVPKTINFO with v4 fallback.
        // C prefers IP_PKTINFO wherever defined (incl. Darwin, bsd.c:1493);
        // only FreeBSD lacks it and falls back to IP_RECVDSTADDR.
        if so_int(listen_fd, libc::IPPROTO_IPV6, libc::IPV6_RECVPKTINFO, 1) == -1 {
            let e = errno();
            if e == libc::ENOPROTOOPT || e == libc::EINVAL {
                #[cfg(not(target_os = "freebsd"))]
                so_int(listen_fd, libc::IPPROTO_IP, libc::IP_PKTINFO, 1);
                #[cfg(target_os = "freebsd")]
                so_int(listen_fd, libc::IPPROTO_IP, libc::IP_RECVDSTADDR, 1);
            }
        }
        // ECN/TOS reporting: IPV6_RECVTCLASS with IP_RECVTOS fallback.
        if so_int(listen_fd, libc::IPPROTO_IPV6, libc::IPV6_RECVTCLASS, 1) == -1 {
            let e = errno();
            if e == libc::ENOPROTOOPT || e == libc::EINVAL {
                so_int(listen_fd, libc::IPPROTO_IP, libc::IP_RECVTOS, 1);
            }
        }
        // Linux: surface ICMP errors instead of dropping them (libuv parity);
        // drained via MSG_ERRQUEUE in dispatch.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            so_int(listen_fd, libc::IPPROTO_IP, libc::IP_RECVERR, 1);
            if family == libc::AF_INET6 {
                so_int(listen_fd, libc::IPPROTO_IPV6, libc::IPV6_RECVERR, 1);
            }
        }

        // SAFETY: ai_addr/ai_addrlen come from the live getaddrinfo entry.
        let bind_rc =
            unsafe { libc::bind(listen_fd, (*listen_addr).ai_addr, (*listen_addr).ai_addrlen) };
        if bind_rc != 0 {
            *err = errno();
            close(listen_fd, false);
            // SAFETY: as above.
            unsafe { libc::freeaddrinfo(result) };
            return LIBUS_SOCKET_ERROR;
        }

        // SAFETY: as above.
        unsafe { libc::freeaddrinfo(result) };
        *err = 0;
        listen_fd
    }

    /// Bound port, host order; 0 when getsockname fails, -1 for unknown
    /// family (bsd_addr_get_port over the create-time `bsd_addr_t`).
    pub(crate) fn udp_local_port(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        match local_addr(fd) {
            Some(addr) => addr.port(),
            None => 0,
        }
    }

    /// Raw local/remote IP bytes (4 or 16) into `buf`; `*length = 0` on
    /// error, unknown family, or a too-small buffer (us_udp_socket_bound_ip).
    pub(crate) fn udp_addr_ip(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        remote: bool,
        buf: *mut u8,
        length: &mut i32,
    ) {
        let addr = if remote { remote_addr(fd) } else { local_addr(fd) };
        let Some(addr) = addr else {
            *length = 0;
            return;
        };
        let ip = addr.ip();
        if *length < ip.len() as i32 {
            *length = 0;
            return;
        }
        *length = ip.len() as i32;
        if !ip.is_empty() {
            // SAFETY: caller guarantees `buf` holds at least the original
            // `*length` bytes, checked >= ip.len() above.
            unsafe { ptr::copy_nonoverlapping(ip.as_ptr(), buf, ip.len()) };
        }
    }

    // ── connect / disconnect (bsd.c:1558-1610 — R9.9) ───────────────────────

    /// `bsd_connect_udp_socket`: returns the gai error as-is when nonzero,
    /// 0 on the first successful connect, else -1 (+errno).
    pub(crate) fn udp_connect_fd(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        host: *const c_char,
        port: c_uint,
    ) -> c_int {
        // SAFETY: zeroed addrinfo is a valid hints value.
        let mut hints: libc::addrinfo = unsafe { core::mem::zeroed() };
        hints.ai_family = libc::AF_UNSPEC;
        hints.ai_socktype = libc::SOCK_DGRAM;
        let port_string = format!("{port}\0");
        let mut result: *mut libc::addrinfo = ptr::null_mut();
        // SAFETY: host NUL-terminated per caller; port_string NUL-terminated.
        let gai =
            unsafe { libc::getaddrinfo(host, port_string.as_ptr().cast(), &hints, &mut result) };
        if gai != 0 {
            return gai;
        }
        if result.is_null() {
            return -1;
        }
        let mut rp = result;
        while !rp.is_null() {
            // SAFETY: rp walks the live getaddrinfo list.
            unsafe {
                if libc::connect(fd, (*rp).ai_addr, (*rp).ai_addrlen) == 0 {
                    libc::freeaddrinfo(result);
                    return 0;
                }
                rp = (*rp).ai_next;
            }
        }
        // SAFETY: as above.
        unsafe { libc::freeaddrinfo(result) };
        -1
    }

    /// `bsd_disconnect_udp_socket`: connect(AF_UNSPEC); EAFNOSUPPORT = ok.
    pub(crate) fn udp_disconnect_fd(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        // SAFETY: zeroed sockaddr + AF_UNSPEC is the documented disconnect.
        let mut addr: libc::sockaddr = unsafe { core::mem::zeroed() };
        addr.sa_family = libc::AF_UNSPEC as _;
        #[cfg(target_vendor = "apple")]
        {
            addr.sa_len = size_of::<libc::sockaddr>() as u8;
        }
        // SAFETY: addr outlives the call.
        let res =
            unsafe { libc::connect(fd, &addr, size_of::<libc::sockaddr>() as libc::socklen_t) };
        if res == 0 || errno() == libc::EAFNOSUPPORT {
            0
        } else {
            -1
        }
    }

    // ── recv/send batches (bsd_recvmmsg / bsd_sendmmsg + setup — R9.5-R9.7) ─

    #[cfg(target_vendor = "apple")]
    unsafe extern "C" {
        // Private Darwin batch syscalls (bsd.h); no addresses/ancillary data.
        fn recvmsg_x(s: c_int, msgp: *const udp::Mmsghdr, cnt: c_uint, flags: c_int) -> isize;
        fn sendmsg_x(s: c_int, msgp: *const udp::Mmsghdr, cnt: c_uint, flags: c_int) -> isize;
        fn Bun__doesMacOSVersionSupportSendRecvMsgX() -> c_int;
    }

    /// A zeroed receive batch (null msghdr/iovec are valid pre-setup states).
    pub(crate) fn udp_recvbuf_zeroed() -> PacketBuffer {
        // SAFETY: PacketBuffer is repr(C) POD (pointers + byte arrays).
        unsafe { core::mem::zeroed() }
    }

    /// `bsd_udp_setup_recvbuf` + `bsd_recvmmsg(MSG_DONTWAIT)` under one
    /// borrow: wires each 64 KiB slot of `databuf` plus this batch's own
    /// name/control slots, then receives. Packet count, 0, or -1 (+errno).
    pub(crate) fn udp_recvmmsg(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        buf: &mut PacketBuffer,
        databuf: *mut u8,
    ) -> c_int {
        // SAFETY: re-zeroing POD; every pointer written below outlives the
        // syscall (they point into `*buf` and the loop-owned `databuf`).
        unsafe {
            ptr::write_bytes(
                (buf as *mut PacketBuffer).cast::<u8>(),
                0,
                size_of::<PacketBuffer>(),
            );
            for i in 0..udp::LIBUS_UDP_RECV_COUNT {
                buf.iov[i].iov_base = databuf.add(i * udp::LIBUS_UDP_MAX_SIZE).cast();
                buf.iov[i].iov_len = udp::LIBUS_UDP_MAX_SIZE as _;
                let name = ptr::addr_of_mut!(buf.addr[i]);
                let control = ptr::addr_of_mut!(buf.control[i]);
                let iov = ptr::addr_of_mut!(buf.iov[i]);
                let mh = &mut buf.msgvec[i].msg_hdr;
                mh.msg_name = name.cast();
                mh.msg_namelen = size_of::<libc::sockaddr_storage>() as libc::socklen_t;
                mh.msg_iov = iov;
                mh.msg_iovlen = 1 as _;
                mh.msg_control = control.cast();
                mh.msg_controllen = udp::UDP_CONTROL_LEN as _;
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        loop {
            // SAFETY: msgvec fully wired above.
            let ret = unsafe {
                libc::recvmmsg(
                    fd,
                    buf.msgvec.as_mut_ptr(),
                    udp::LIBUS_UDP_RECV_COUNT as c_uint,
                    libc::MSG_DONTWAIT as _,
                    ptr::null_mut(),
                )
            };
            if ret >= 0 || errno() != libc::EINTR {
                return ret;
            }
        }
        #[cfg(target_os = "freebsd")]
        loop {
            // SAFETY: msgvec fully wired above.
            let ret = unsafe {
                libc::recvmmsg(
                    fd,
                    buf.msgvec.as_mut_ptr(),
                    udp::LIBUS_UDP_RECV_COUNT as libc::size_t,
                    libc::MSG_DONTWAIT,
                    ptr::null_mut(),
                )
            };
            if ret >= 0 || errno() != libc::EINTR {
                return ret as c_int;
            }
        }
        #[cfg(target_vendor = "apple")]
        {
            // SAFETY: pure version probe (provided by the C++ side).
            if unsafe { Bun__doesMacOSVersionSupportSendRecvMsgX() } != 0 {
                loop {
                    // SAFETY: msgvec fully wired above.
                    let ret = unsafe {
                        recvmsg_x(
                            fd,
                            buf.msgvec.as_ptr(),
                            udp::LIBUS_UDP_RECV_COUNT as c_uint,
                            libc::MSG_DONTWAIT,
                        )
                    };
                    if ret >= 0 || errno() != libc::EINTR {
                        return ret as c_int;
                    }
                }
            }
            for i in 0..udp::LIBUS_UDP_RECV_COUNT {
                loop {
                    // SAFETY: per-message recvmsg over the wired msghdr.
                    let ret = unsafe {
                        libc::recvmsg(fd, &mut buf.msgvec[i].msg_hdr, libc::MSG_DONTWAIT)
                    };
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
                    buf.msgvec[i].msg_len = ret as usize;
                    break;
                }
            }
            udp::LIBUS_UDP_RECV_COUNT as c_int
        }
    }

    /// Payload of packet `index`, clamped to LIBUS_UDP_MAX_SIZE (Darwin
    /// recvmsg_x reports the pre-truncation datagram length).
    pub(crate) fn udp_packet_payload(buf: &mut PacketBuffer, index: i32) -> &mut [u8] {
        let i = usize::try_from(index).expect("int cast");
        let len = (buf.msgvec[i].msg_len as usize).min(udp::LIBUS_UDP_MAX_SIZE);
        // SAFETY: iov_base points at 64 KiB slot `i` of the loop's shared
        // recv_buf, which outlives the data callback this borrow is scoped to.
        unsafe { core::slice::from_raw_parts_mut(buf.iov[i].iov_base.cast::<u8>(), len) }
    }

    /// One `recvmsg(MSG_ERRQUEUE)` drain step (Linux IP_RECVERR):
    /// `Some(ee_errno)` per queued ICMP error (0 when the cmsg is missing),
    /// `None` once the queue is drained.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn udp_recv_errqueue(fd: LIBUS_SOCKET_DESCRIPTOR) -> Option<c_int> {
        let mut ebuf = [0u8; 1];
        let mut ectrl = [0u8; 512];
        let mut eiov = libc::iovec {
            iov_base: ebuf.as_mut_ptr().cast(),
            iov_len: ebuf.len(),
        };
        // SAFETY: zeroed msghdr then fully wired to live locals.
        let mut eh: libc::msghdr = unsafe { core::mem::zeroed() };
        eh.msg_iov = &mut eiov;
        eh.msg_iovlen = 1 as _;
        eh.msg_control = ectrl.as_mut_ptr().cast();
        eh.msg_controllen = ectrl.len() as _;
        // SAFETY: eh wired above; MSG_ERRQUEUE never blocks.
        if unsafe { libc::recvmsg(fd, &mut eh, libc::MSG_ERRQUEUE) } < 0 {
            return None;
        }
        let mut ee: c_int = 0;
        // SAFETY: CMSG_* walk over the control buffer the kernel just filled.
        unsafe {
            let mut cm = libc::CMSG_FIRSTHDR(&eh);
            while !cm.is_null() {
                if ((*cm).cmsg_level == libc::IPPROTO_IP && (*cm).cmsg_type == libc::IP_RECVERR)
                    || ((*cm).cmsg_level == libc::IPPROTO_IPV6
                        && (*cm).cmsg_type == libc::IPV6_RECVERR)
                {
                    let se = libc::CMSG_DATA(cm).cast::<libc::sock_extended_err>();
                    ee = (*se).ee_errno as c_int;
                    break;
                }
                cm = libc::CMSG_NXTHDR(&eh, cm);
            }
        }
        Some(ee)
    }

    /// One `bsd_udp_setup_sendbuf` + `bsd_sendmmsg(MSG_DONTWAIT)` batch over
    /// the loop's shared send scratch. Returns `(packets_consumed_into_batch,
    /// packets_sent_or_negative)`. `addresses[i] == null` = connected send.
    pub(crate) fn udp_send_batch(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        send_buf: *mut u8,
        bufsize: usize,
        payloads: &[*const u8],
        lengths: &[usize],
        addresses: &[*const c_void],
    ) -> (c_int, c_int) {
        // The C `struct udp_sendbuf` header is 8 bytes before msgvec[]
        // (bit flags + unsigned num); the capacity formula keeps it.
        const SENDBUF_HEADER: usize = 8;
        let cap =
            (bufsize - SENDBUF_HEADER) / (size_of::<udp::Mmsghdr>() + size_of::<libc::iovec>());
        let count = cap.min(payloads.len());
        if count == 0 {
            return (0, 0);
        }

        let mut has_empty = false;
        let mut has_addresses = false;
        // SAFETY: send_buf is the loop's LIBUS_SEND_BUFFER_LENGTH scratch,
        // 16-aligned by the loop allocator; msgvec/iov stay within it by the
        // capacity formula above; payload/address pointers are borrowed from
        // the caller's slices for the duration of this call only.
        let msgvec = unsafe {
            let msgvec = send_buf.add(SENDBUF_HEADER).cast::<udp::Mmsghdr>();
            let iov = msgvec.add(count).cast::<libc::iovec>();
            for i in 0..count {
                let addr = addresses[i].cast::<libc::sockaddr>();
                let mut addr_len: libc::socklen_t = 0;
                if !addr.is_null() {
                    addr_len = match c_int::from((*addr).sa_family) {
                        libc::AF_INET => size_of::<libc::sockaddr_in>() as libc::socklen_t,
                        libc::AF_INET6 => size_of::<libc::sockaddr_in6>() as libc::socklen_t,
                        _ => 0,
                    };
                    if addr_len > 0 {
                        has_addresses = true;
                    }
                }
                (*iov.add(i)).iov_base = payloads[i] as *mut c_void;
                (*iov.add(i)).iov_len = lengths[i] as _;
                let m = &mut *msgvec.add(i);
                m.msg_hdr = core::mem::zeroed();
                m.msg_hdr.msg_name = addresses[i] as *mut c_void;
                m.msg_hdr.msg_namelen = addr_len;
                m.msg_hdr.msg_iov = iov.add(i);
                m.msg_hdr.msg_iovlen = 1 as _;
                m.msg_len = 0 as _;
                if lengths[i] == 0 {
                    has_empty = true;
                }
            }
            msgvec
        };

        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        {
            let _ = (has_empty, has_addresses);
            loop {
                #[cfg(not(target_os = "freebsd"))]
                // SAFETY: msgvec holds `count` wired entries.
                let ret = unsafe {
                    libc::sendmmsg(
                        fd,
                        msgvec,
                        count as c_uint,
                        (libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL) as _,
                    )
                };
                #[cfg(target_os = "freebsd")]
                // SAFETY: msgvec holds `count` wired entries.
                let ret = unsafe {
                    libc::sendmmsg(
                        fd,
                        msgvec,
                        count as libc::size_t,
                        libc::MSG_DONTWAIT | libc::MSG_NOSIGNAL,
                    ) as c_int
                };
                if ret >= 0 || errno() != libc::EINTR {
                    return (count as c_int, ret);
                }
            }
        }
        #[cfg(target_vendor = "apple")]
        {
            // sendmsg_x supports neither addresses nor empty payloads.
            // SAFETY: pure version probe.
            if !has_empty
                && !has_addresses
                && unsafe { Bun__doesMacOSVersionSupportSendRecvMsgX() } != 0
            {
                loop {
                    // SAFETY: msgvec holds `count` wired entries.
                    let ret =
                        unsafe { sendmsg_x(fd, msgvec, count as c_uint, libc::MSG_DONTWAIT) };
                    if ret >= 0 {
                        return (count as c_int, ret as c_int);
                    }
                    let e = errno();
                    if e == libc::EMSGSIZE {
                        break; // fall back to the per-message path
                    }
                    if e != libc::EINTR {
                        return (count as c_int, ret as c_int);
                    }
                }
            }
            for i in 0..count {
                loop {
                    // SAFETY: per-message sendmsg over wired headers.
                    let ret = unsafe {
                        libc::sendmsg(fd, &(*msgvec.add(i)).msg_hdr, libc::MSG_DONTWAIT)
                    };
                    if ret < 0 {
                        let e = errno();
                        if e == libc::EINTR {
                            continue;
                        }
                        if e == libc::EAGAIN || e == libc::EWOULDBLOCK {
                            return (count as c_int, i as c_int);
                        }
                        return (count as c_int, ret as c_int);
                    }
                    break;
                }
            }
            (count as c_int, count as c_int)
        }
    }
}

/// Windows: UDP rides one uv_poll per socket (owned via `udp::Socket.uv_p`,
/// mirroring `SocketHeader.uv_p`) + Winsock recvfrom/sendto — the bsd.c
/// `_WIN32` UDP branches. Signatures preserved so udp.rs stays
/// platform-neutral.
#[cfg(windows)]
mod udp_imp {
    use core::ffi::{c_char, c_int, c_uint, c_void};
    use core::mem::size_of;
    use core::ptr;

    use bun_libuv_sys as sys;
    use sys::UvHandle;

    use super::win::{self, ws2};
    use super::{close, create_socket, local_addr, remote_addr, set_errno, set_reuse};
    use crate::backend::Events;
    use crate::loop_::Loop;
    use crate::udp::{self, PacketBuffer};
    use crate::{
        LIBUS_RECV_BUFFER_LENGTH, LIBUS_SOCKET_DESCRIPTOR, LIBUS_SOCKET_ERROR,
        LIBUS_SOCKET_IPV6_ONLY,
    };

    #[inline]
    fn so_int(fd: LIBUS_SOCKET_DESCRIPTOR, level: c_int, name: c_int, value: c_int) -> c_int {
        win::so(fd, level, name, &value)
    }

    // ── uv_poll arming (the libuv arm of R2.7-R2.10, scoped to UDP) ─────────
    // Same single-owner shape as ffi.rs's `UvPollHandle` for TCP: the wrapper
    // box lives in `udp::Socket.uv_p` from first arm until stop; the pending
    // uv_close callback frees it (deferred free, R2.4).

    #[repr(C)]
    struct UvUdpPollHandle {
        /// MUST stay first: `*mut UvUdpPollHandle` doubles as the uv handle ptr.
        uv: sys::uv_poll_t,
    }

    unsafe extern "C" fn udp_poll_cb(p: *mut sys::uv_poll_t, status: c_int, events: c_int) {
        // SAFETY: `data` points at the owning udp::Socket, which stays
        // readable until the tick-postlude sweep (C6/C15); uv fires no
        // poll_cb after uv_poll_stop.
        let s = unsafe { (*p).data.cast::<udp::Socket>() };
        // libuv.c:26-29: status<0 && !=UV_EOF → error; ==UV_EOF → eof
        // (unread in the UDP arm, matching C's POLL_TYPE_UDP case).
        let error = status < 0 && status != sys::UV_EOF;
        let eof = status == sys::UV_EOF;
        let ready = (events as u32) & super::udp_poll_events(s);
        if ready != 0 || error || eof {
            crate::udp::dispatch_ready_poll(
                s,
                error,
                ready & Events::READABLE.0 != 0,
                ready & Events::WRITABLE.0 != 0,
            );
        }
    }

    unsafe extern "C" fn udp_poll_close_cb(h: *mut sys::uv_poll_t) {
        // SAFETY: sole owner post-close; box leaked in `udp_poll_start`.
        drop(unsafe { Box::from_raw(h.cast::<UvUdpPollHandle>()) });
    }

    /// Register the UDP socket (`us_poll_start_rc` equivalent): alloc the
    /// wrapper, uv_poll_init_socket (this also sets FIONBIO) + always-unref
    /// (keep-alive is Bun's `Async.KeepAlive`), `data = s`, start. 0 on
    /// success, −1 on init failure (the socket stays unarmed).
    pub(crate) fn udp_poll_start(loop_: *mut Loop, s: *mut udp::Socket, events: u32) -> c_int {
        // SAFETY: `s` is live and not yet visible to any callback.
        let fd = unsafe {
            (*s).poll_events = events;
            (*s).fd
        };
        let uv_loop = super::loop_mut(loop_).uv_loop.cast::<sys::Loop>();
        // SAFETY: fresh zeroed POD box; init on this thread's loop; on init
        // failure the box is reclaimed here (uv registered nothing). On
        // success it is owned by `s.uv_p` until `udp_poll_stop`.
        unsafe {
            let h: *mut UvUdpPollHandle = Box::into_raw(Box::new(core::mem::zeroed()));
            if sys::uv_poll_init_socket(uv_loop, &raw mut (*h).uv, fd) != 0 {
                drop(Box::from_raw(h));
                return -1;
            }
            (*h).uv.unref();
            (*h).uv.data = s.cast();
            (*s).uv_p = h.cast();
            let _ = sys::uv_poll_start(&raw mut (*h).uv, events as c_int, Some(udp_poll_cb));
        }
        0
    }

    /// `us_poll_change` equivalent (libuv.c:112-121): no-op when the poll
    /// was never armed / already stopped or the believed events match.
    pub(crate) fn udp_poll_change(_loop: *mut Loop, s: *mut udp::Socket, events: u32) {
        // SAFETY: callers derive `s` from their own live handle/&mut.
        let (old, h) = unsafe { ((*s).poll_events, (*s).uv_p.cast::<UvUdpPollHandle>()) };
        if h.is_null() || old == events {
            return;
        }
        // SAFETY: as above; non-null `uv_p` is live until `udp_poll_stop`.
        unsafe {
            (*s).poll_events = events;
            let _ = sys::uv_poll_start(&raw mut (*h).uv, events as c_int, Some(udp_poll_cb));
        }
    }

    /// `us_poll_stop` equivalent: stop, null the owner field, uv_close with
    /// the freeing callback. Poll bits in `*s` are NOT cleared (R2.10).
    pub(crate) fn udp_poll_stop(_loop: *mut Loop, s: *mut udp::Socket) {
        // SAFETY: as in `udp_poll_change`; ownership of the wrapper moves to
        // the pending close callback.
        unsafe {
            let h = (*s).uv_p.cast::<UvUdpPollHandle>();
            if h.is_null() {
                return;
            }
            (*s).uv_p = ptr::null_mut();
            let _ = sys::uv_poll_stop(&raw mut (*h).uv);
            (*h).uv.close(udp_poll_close_cb);
        }
    }

    // ── create/bind (bsd_create_udp_socket — R9.8, windows arm) ─────────────

    /// getaddrinfo(AI_PASSIVE, SOCK_DGRAM), IPv6-preferred; reuse opts,
    /// IPV6_V6ONLY, PKTINFO/RECVTCLASS reporting, SIO_UDP_CONNRESET and
    /// SIO_UDP_NETRESET disabled at the source; bind. `*err` = -gai on DNS
    /// failure, WSA error otherwise; 0 on success.
    pub(crate) fn udp_bind_fd(
        host: *const c_char,
        port: u16,
        options: c_int,
        err: &mut c_int,
    ) -> LIBUS_SOCKET_DESCRIPTOR {
        *err = 0;
        let mut hints: ws2::addrinfo = win::pod_zeroed();
        hints.ai_flags = win::AI_PASSIVE;
        hints.ai_family = ws2::AF_UNSPEC;
        hints.ai_socktype = ws2::SOCK_DGRAM;
        let port_string = format!("{port}\0");
        let mut result: *mut ws2::addrinfo = ptr::null_mut();
        // SAFETY: `host` is caller-provided NUL-terminated (or null);
        // `port_string` is NUL-terminated and outlives the call.
        let gai =
            unsafe { ws2::getaddrinfo(host, port_string.as_ptr().cast(), &hints, &mut result) };
        if gai != 0 {
            *err = -gai;
            return LIBUS_SOCKET_ERROR;
        }

        let mut listen_fd = LIBUS_SOCKET_ERROR;
        let mut listen_addr: *mut ws2::addrinfo = ptr::null_mut();
        for family in [ws2::AF_INET6, ws2::AF_INET] {
            let mut a = result;
            while !a.is_null() && listen_fd == LIBUS_SOCKET_ERROR {
                // SAFETY: `a` walks the getaddrinfo-owned list.
                unsafe {
                    if (*a).ai_family == family {
                        *err = 0;
                        match create_socket((*a).ai_family, (*a).ai_socktype, (*a).ai_protocol) {
                            Ok(fd) => listen_fd = fd,
                            Err(e) => *err = e,
                        }
                        listen_addr = a;
                    }
                    a = (*a).ai_next;
                }
            }
        }
        if listen_fd == LIBUS_SOCKET_ERROR {
            // SAFETY: `result` came from getaddrinfo above.
            unsafe { ws2::freeaddrinfo(result) };
            return LIBUS_SOCKET_ERROR;
        }

        if let Err(e) = set_reuse(listen_fd, options) {
            *err = e;
            close(listen_fd, false);
            // SAFETY: as above.
            unsafe { ws2::freeaddrinfo(result) };
            return LIBUS_SOCKET_ERROR;
        }

        // SAFETY: listen_addr points into the live getaddrinfo list.
        let family = unsafe { (*listen_addr).ai_family };
        if family == ws2::AF_INET6 {
            let enabled = c_int::from(options & LIBUS_SOCKET_IPV6_ONLY != 0);
            if so_int(listen_fd, win::IPPROTO_IPV6, win::IPV6_V6ONLY, enabled) != 0 {
                // Quirk ported verbatim (bsd.c:1478-1481): fd + addrinfo leak,
                // *err left at 0.
                return LIBUS_SOCKET_ERROR;
            }
        }

        // Destination-address reporting: IPV6_PKTINFO (Windows has no
        // IPV6_RECVPKTINFO alias) with the IP_PKTINFO v4 fallback.
        if so_int(listen_fd, win::IPPROTO_IPV6, win::IPV6_PKTINFO, 1) == -1 {
            let e = win::wsa_errno();
            if e == win::WSAENOPROTOOPT || e == win::WSAEINVAL {
                so_int(listen_fd, win::IPPROTO_IP, win::IP_PKTINFO, 1);
            }
        }
        // ECN/TOS reporting: IPV6_RECVTCLASS with IP_RECVTOS fallback.
        if so_int(listen_fd, win::IPPROTO_IPV6, win::IPV6_RECVTCLASS, 1) == -1 {
            let e = win::wsa_errno();
            if e == win::WSAENOPROTOOPT || e == win::WSAEINVAL {
                so_int(listen_fd, win::IPPROTO_IP, win::IP_RECVTOS, 1);
            }
        }

        // Winsock reports ICMP "port unreachable" from a previous sendto as
        // WSAECONNRESET (NETRESET for TTL-expired) on the next recv; disable
        // at the source so a queued ICMP can't race a real packet either
        // (bsd.c:1508-1520). Failures deliberately ignored, matching the C.
        {
            let mut off: u32 = 0;
            let mut br: u32 = 0;
            // SAFETY: in-buffer is a live DWORD; no out-buffer.
            unsafe {
                win::WSAIoctl(
                    listen_fd,
                    win::SIO_UDP_CONNRESET,
                    (&raw mut off).cast::<c_void>(),
                    size_of::<u32>() as u32,
                    ptr::null_mut(),
                    0,
                    &mut br,
                    ptr::null_mut(),
                    ptr::null_mut(),
                );
                win::WSAIoctl(
                    listen_fd,
                    win::SIO_UDP_NETRESET,
                    (&raw mut off).cast::<c_void>(),
                    size_of::<u32>() as u32,
                    ptr::null_mut(),
                    0,
                    &mut br,
                    ptr::null_mut(),
                    ptr::null_mut(),
                );
            }
        }

        // SAFETY: ai_addr/ai_addrlen come from the live getaddrinfo entry.
        let bind_rc = unsafe {
            win::bind(listen_fd, (*listen_addr).ai_addr, (*listen_addr).ai_addrlen as c_int)
        };
        if bind_rc != 0 {
            *err = win::wsa_errno();
            close(listen_fd, false);
            // SAFETY: as above.
            unsafe { ws2::freeaddrinfo(result) };
            return LIBUS_SOCKET_ERROR;
        }

        // SAFETY: as above.
        unsafe { ws2::freeaddrinfo(result) };
        *err = 0;
        listen_fd
    }

    /// Bound port, host order; 0 when getsockname fails, -1 for unknown
    /// family (bsd_addr_get_port over the create-time `bsd_addr_t`).
    pub(crate) fn udp_local_port(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        match local_addr(fd) {
            Some(addr) => addr.port(),
            None => 0,
        }
    }

    /// Raw local/remote IP bytes (4 or 16) into `buf`; `*length = 0` on
    /// error, unknown family, or a too-small buffer (us_udp_socket_bound_ip).
    pub(crate) fn udp_addr_ip(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        remote: bool,
        buf: *mut u8,
        length: &mut i32,
    ) {
        let addr = if remote { remote_addr(fd) } else { local_addr(fd) };
        let Some(addr) = addr else {
            *length = 0;
            return;
        };
        let ip = addr.ip();
        if *length < ip.len() as i32 {
            *length = 0;
            return;
        }
        *length = ip.len() as i32;
        if !ip.is_empty() {
            // SAFETY: caller guarantees `buf` holds at least the original
            // `*length` bytes, checked >= ip.len() above.
            unsafe { ptr::copy_nonoverlapping(ip.as_ptr(), buf, ip.len()) };
        }
    }

    // ── connect / disconnect (bsd.c:1558-1610 — R9.9) ───────────────────────

    /// `bsd_connect_udp_socket`: returns the gai error as-is when nonzero,
    /// 0 on the first successful connect, else -1 (+WSA error in TLS).
    pub(crate) fn udp_connect_fd(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        host: *const c_char,
        port: c_uint,
    ) -> c_int {
        let mut hints: ws2::addrinfo = win::pod_zeroed();
        hints.ai_family = ws2::AF_UNSPEC;
        hints.ai_socktype = ws2::SOCK_DGRAM;
        let port_string = format!("{port}\0");
        let mut result: *mut ws2::addrinfo = ptr::null_mut();
        // SAFETY: host NUL-terminated per caller; port_string NUL-terminated.
        let gai =
            unsafe { ws2::getaddrinfo(host, port_string.as_ptr().cast(), &hints, &mut result) };
        if gai != 0 {
            return gai;
        }
        if result.is_null() {
            return -1;
        }
        let mut rp = result;
        while !rp.is_null() {
            // SAFETY: rp walks the live getaddrinfo list.
            unsafe {
                if win::connect(fd, (*rp).ai_addr, (*rp).ai_addrlen as c_int) == 0 {
                    ws2::freeaddrinfo(result);
                    return 0;
                }
                rp = (*rp).ai_next;
            }
        }
        // SAFETY: as above.
        unsafe { ws2::freeaddrinfo(result) };
        -1
    }

    /// `bsd_disconnect_udp_socket`: connect(AF_UNSPEC); WSAEAFNOSUPPORT = ok.
    pub(crate) fn udp_disconnect_fd(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int {
        let mut addr: ws2::sockaddr = win::pod_zeroed();
        addr.sa_family = ws2::AF_UNSPEC as u16;
        // SAFETY: addr outlives the call.
        let res = unsafe { win::connect(fd, &addr, size_of::<ws2::sockaddr>() as c_int) };
        if res == 0 || win::wsa_errno() == win::WSAEAFNOSUPPORT {
            0
        } else {
            -1
        }
    }

    // ── recv/send (bsd_recvmmsg / bsd_sendmmsg windows arms — R9.5-R9.7) ────

    pub(crate) fn udp_recvbuf_zeroed() -> PacketBuffer {
        PacketBuffer {
            buf: ptr::null_mut(),
            buflen: 0,
            recvlen: 0,
            // SAFETY: sockaddr_storage is POD.
            addr: unsafe { core::mem::zeroed() },
        }
    }

    /// `bsd_udp_setup_recvbuf` + `bsd_recvmmsg` windows arm (bsd.c:131-155):
    /// one recvfrom per call into the loop's shared recv_buf, swallowing
    /// WSAECONNRESET/WSAENETRESET (per-destination ICMP — treating it as a
    /// socket error would tear down every conn sharing the socket, e.g. the
    /// QUIC client endpoint; mirrors libuv's uv__udp_recv handling).
    /// 1 packet, or -1 with the WSA error left in TLS.
    pub(crate) fn udp_recvmmsg(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        buf: &mut PacketBuffer,
        databuf: *mut u8,
    ) -> c_int {
        buf.buf = databuf;
        buf.buflen = LIBUS_RECV_BUFFER_LENGTH;
        loop {
            let mut addr_len = size_of::<udp::sockaddr_storage>() as c_int;
            // SAFETY: `databuf` is the loop's LIBUS_RECV_BUFFER_LENGTH recv
            // scratch; `buf.addr` is a live SOCKADDR_STORAGE out-param.
            let ret = unsafe {
                win::recvfrom(
                    fd,
                    databuf.cast::<c_void>(),
                    LIBUS_RECV_BUFFER_LENGTH as c_int,
                    0,
                    (&raw mut buf.addr).cast(),
                    &mut addr_len,
                )
            };
            if ret < 0 {
                let e = win::wsa_errno();
                if e == win::WSAEINTR || e == win::WSAECONNRESET || e == win::WSAENETRESET {
                    continue;
                }
                return -1;
            }
            buf.recvlen = ret as usize;
            return 1;
        }
    }

    pub(crate) fn udp_packet_payload(buf: &mut PacketBuffer, _index: i32) -> &mut [u8] {
        // SAFETY: buf.buf points at the loop's shared recv_buf; recvlen is
        // the last recvfrom's byte count.
        unsafe { core::slice::from_raw_parts_mut(buf.buf, buf.recvlen) }
    }

    /// `bsd_sendmmsg` windows arm (bsd.c:70-97): per-packet send (connected)
    /// or sendto by family. Returns `(packets_consumed_into_batch,
    /// packets_sent_or_negative)`; consumed = all (the windows setup has no
    /// capacity limit — no msgvec is built). WSAEWOULDBLOCK stops the batch
    /// at `i`; unknown family → WSAEAFNOSUPPORT + -1, as in C.
    pub(crate) fn udp_send_batch(
        fd: LIBUS_SOCKET_DESCRIPTOR,
        _send_buf: *mut u8,
        _bufsize: usize,
        payloads: &[*const u8],
        lengths: &[usize],
        addresses: &[*const c_void],
    ) -> (c_int, c_int) {
        let count = payloads.len();
        for i in 0..count {
            loop {
                let addr = addresses[i].cast::<ws2::sockaddr>();
                let len = lengths[i].min(c_int::MAX as usize) as c_int;
                // SAFETY: payload/address pointers are borrowed from the
                // caller's slices for the duration of this call only.
                let ret = unsafe {
                    let family =
                        if addr.is_null() { ws2::AF_UNSPEC } else { c_int::from((*addr).sa_family) };
                    if family == ws2::AF_UNSPEC {
                        ws2::send(fd, payloads[i].cast(), len, 0)
                    } else if family == ws2::AF_INET {
                        win::sendto(
                            fd,
                            payloads[i].cast(),
                            len,
                            0,
                            addr,
                            size_of::<ws2::sockaddr_in>() as c_int,
                        )
                    } else if family == ws2::AF_INET6 {
                        win::sendto(
                            fd,
                            payloads[i].cast(),
                            len,
                            0,
                            addr,
                            size_of::<ws2::sockaddr_in6>() as c_int,
                        )
                    } else {
                        set_errno(win::WSAEAFNOSUPPORT);
                        return (count as c_int, -1);
                    }
                };
                if ret < 0 {
                    let e = win::wsa_errno();
                    if e == win::WSAEINTR {
                        continue;
                    }
                    if e == win::WSAEWOULDBLOCK {
                        return (count as c_int, i as c_int);
                    }
                    return (count as c_int, ret);
                }
                break;
            }
        }
        (count as c_int, count as c_int)
    }
}

pub(crate) use udp_imp::*;

// ── SO_ERROR (R3.22e / R6.8) ────────────────────────────────────

/// getsockopt(SO_ERROR); falls back to the thread errno if the getsockopt
/// itself fails (epoll_kqueue.c:863-871).
#[cfg(not(windows))]
pub(crate) fn so_error(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
    let mut error: core::ffi::c_int = 0;
    let mut len = core::mem::size_of::<core::ffi::c_int>() as libc::socklen_t;
    // SAFETY: out-params are stack-valid ints of the advertised length.
    let rc = unsafe {
        libc::getsockopt(
            fd,
            libc::SOL_SOCKET,
            libc::SO_ERROR,
            (&raw mut error).cast(),
            &raw mut len,
        )
    };
    if rc == -1 { errno() } else { error }
}

/// getsockopt(SO_ERROR) via winsock; falls back to WSAGetLastError when the
/// getsockopt itself fails (bsd.c / libuv.c:368-376 parity).
#[cfg(windows)]
pub(crate) fn so_error(fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
    const SO_ERROR: core::ffi::c_int = 0x1007; // winsock2.h
    let mut error: core::ffi::c_int = 0;
    let mut len = core::mem::size_of::<core::ffi::c_int>() as core::ffi::c_int;
    // SAFETY: out-params are stack-valid ints of the advertised length.
    let rc = unsafe {
        win::getsockopt(fd, win::SOL_SOCKET, SO_ERROR, (&raw mut error).cast(), &raw mut len)
    };
    if rc == -1 { errno() } else { error }
}
