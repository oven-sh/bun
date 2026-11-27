use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::ops::Range;
use core::ptr::NonNull;

use bun_core::ZStr;

use crate::{LIBUS_SOCKET_DESCRIPTOR, Loop, thunk};
// `sockaddr_storage` is not in `libc` on Windows; route through the leaf
// ws2_32 shim there. Both definitions are 128-byte 8-aligned POD.
#[cfg(windows)]
use bun_windows_sys::ws2_32::sockaddr_storage;
#[cfg(not(windows))]
use libc::sockaddr_storage;

bun_opaque::opaque_ffi! {
    /// Opaque uSockets UDP socket handle (`us_udp_socket_t`).
    pub struct Socket;
}

/// Closed on drop, which runs its close callback.
pub struct OwnedSocket(NonNull<Socket>);

impl OwnedSocket {
    pub fn as_ptr(&self) -> *mut Socket {
        self.0.as_ptr()
    }

    /// For the close callback: the loop closes a socket that has failed.
    pub fn into_raw(self) -> *mut Socket {
        core::mem::ManuallyDrop::new(self).as_ptr()
    }
}

impl Drop for OwnedSocket {
    fn drop(&mut self) {
        us_udp_socket_close(Socket::opaque_mut(self.as_ptr()))
    }
}

impl Socket {
    pub fn create<H: Fn(*mut Socket, Packets<'_>) + Copy + 'static>(
        loop_: &'static Loop,
        _data_cb: H,
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int, c_int),
        host: &ZStr,
        port: c_ushort,
        options: c_int,
        err: Option<&mut c_int>,
        user_data: *mut c_void,
    ) -> Option<OwnedSocket> {
        // SAFETY: thin wrapper over us_create_udp_socket; all pointer args are
        // forwarded as-is from the caller, who upholds uSockets' contract.
        let socket = unsafe {
            us_create_udp_socket(
                loop_,
                on_data::<H>,
                drain_cb,
                close_cb,
                recv_error_cb,
                host.as_ptr(),
                port,
                options,
                match err {
                    Some(e) => std::ptr::from_mut::<c_int>(e),
                    None => core::ptr::null_mut(),
                },
                user_data,
            )
        };
        NonNull::new(socket).map(OwnedSocket)
    }

    /// Adopts an already created (and usually bound) UDP socket descriptor
    /// instead of creating a new one. See `us_create_udp_socket_from_fd`.
    pub fn create_from_fd<H: Fn(*mut Socket, Packets<'_>) + Copy + 'static>(
        loop_: &'static Loop,
        _data_cb: H,
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int, c_int),
        fd: c_int,
        shared: bool,
        err: Option<&mut c_int>,
        user_data: *mut c_void,
    ) -> Option<OwnedSocket> {
        #[cfg(not(windows))]
        let fd_native: LIBUS_SOCKET_DESCRIPTOR = fd;
        #[cfg(windows)]
        let fd_native = fd as LIBUS_SOCKET_DESCRIPTOR;
        // SAFETY: thin wrapper over us_create_udp_socket_from_fd; all pointer
        // args are forwarded as-is from the caller, who upholds uSockets'
        // contract.
        let socket = unsafe {
            us_create_udp_socket_from_fd(
                loop_,
                on_data::<H>,
                drain_cb,
                close_cb,
                recv_error_cb,
                fd_native,
                shared as c_int,
                err.map_or(core::ptr::null_mut(), core::ptr::from_mut),
                user_data,
            )
        };
        NonNull::new(socket).map(OwnedSocket)
    }

    pub fn send(
        &mut self,
        payloads: &[*const u8],
        lengths: &[usize],
        addresses: &[*const c_void],
    ) -> c_int {
        debug_assert!(payloads.len() == lengths.len() && payloads.len() == addresses.len());
        // SAFETY: slices share length (asserted above); self is a live us_udp_socket_t.
        unsafe {
            us_udp_socket_send(
                self,
                payloads.as_ptr(),
                lengths.as_ptr(),
                addresses.as_ptr(),
                c_int::try_from(payloads.len()).expect("int cast"),
            )
        }
    }

    pub fn user(&mut self) -> *mut c_void {
        us_udp_socket_user(self)
    }

    /// Get the bound port in host byte order
    pub fn bound_port(&mut self) -> c_int {
        us_udp_socket_bound_port(self)
    }

    pub fn bound_ip(&mut self, buf: *mut u8, length: &mut i32) {
        // SAFETY: buf must point to at least *length bytes; thin FFI passthrough.
        unsafe { us_udp_socket_bound_ip(self, buf, length) }
    }

    pub fn remote_ip(&mut self, buf: *mut u8, length: &mut i32) {
        // SAFETY: buf must point to at least *length bytes; thin FFI passthrough.
        unsafe { us_udp_socket_remote_ip(self, buf, length) }
    }

    pub fn connect(&mut self, hostname: &ZStr, port: c_uint) -> c_int {
        // SAFETY: `hostname` is NUL-terminated (`ZStr`), and is only read during the call.
        unsafe { us_udp_socket_connect(self, hostname.as_ptr(), port) }
    }

    pub fn disconnect(&mut self) -> c_int {
        us_udp_socket_disconnect(self)
    }

    /// SO_RCVBUF / SO_SNDBUF. `size == 0` reads the current value, non-zero sets
    /// it (without re-reading, like libuv). Returns 0 and writes the resulting
    /// value to `out`, or the failing setsockopt/getsockopt result.
    pub fn buffer_size(&mut self, is_recv: bool, size: i32, out: &mut c_int) -> c_int {
        us_udp_socket_buffer_size(self, is_recv as c_int, size, out)
    }

    /// Underlying socket descriptor.
    pub fn fd(&mut self) -> c_int {
        let raw: LIBUS_SOCKET_DESCRIPTOR = us_udp_socket_fd(self);
        #[cfg(not(windows))]
        {
            raw
        }
        #[cfg(windows)]
        {
            // A Windows SOCKET fits in 32 bits in practice; node's JS-facing
            // fd contract is a small integer.
            raw as c_int
        }
    }

    pub fn set_broadcast(&mut self, enabled: bool) -> c_int {
        us_udp_socket_set_broadcast(self, enabled as c_int)
    }

    pub fn set_unicast_ttl(&mut self, ttl: i32) -> c_int {
        us_udp_socket_set_ttl_unicast(self, ttl as c_int)
    }

    pub fn set_multicast_ttl(&mut self, ttl: i32) -> c_int {
        us_udp_socket_set_ttl_multicast(self, ttl as c_int)
    }

    pub fn set_multicast_loopback(&mut self, enabled: bool) -> c_int {
        us_udp_socket_set_multicast_loopback(self, enabled as c_int)
    }

    pub fn set_multicast_interface(&mut self, iface: &sockaddr_storage) -> c_int {
        us_udp_socket_set_multicast_interface(self, iface)
    }

    pub fn set_membership(
        &mut self,
        address: &sockaddr_storage,
        iface: Option<&sockaddr_storage>,
        drop: bool,
    ) -> c_int {
        us_udp_socket_set_membership(self, address, iface, drop as c_int)
    }

    pub fn set_source_specific_membership(
        &mut self,
        source: &sockaddr_storage,
        group: &sockaddr_storage,
        iface: Option<&sockaddr_storage>,
        drop: bool,
    ) -> c_int {
        us_udp_socket_set_source_specific_membership(self, source, group, iface, drop as c_int)
    }
}

unsafe extern "C" {
    fn us_create_udp_socket(
        loop_: &Loop,
        data_cb: extern "C" fn(*mut Socket, &PacketBuffer, c_int),
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int, c_int),
        host: *const c_char,
        port: c_ushort,
        options: c_int,
        err: *mut c_int,
        user_data: *mut c_void,
    ) -> *mut Socket;
    fn us_udp_socket_connect(socket: *mut Socket, hostname: *const c_char, port: c_uint) -> c_int;
    safe fn us_udp_socket_disconnect(socket: &mut Socket) -> c_int;
    fn us_udp_socket_send(
        socket: *mut Socket,
        payloads: *const *const u8,
        lengths: *const usize,
        addresses: *const *const c_void,
        num: c_int,
    ) -> c_int;
    safe fn us_udp_socket_user(socket: &mut Socket) -> *mut c_void;
    safe fn us_udp_socket_bound_port(socket: &mut Socket) -> c_int;
    fn us_udp_socket_bound_ip(socket: *mut Socket, buf: *mut u8, length: *mut i32);
    fn us_udp_socket_remote_ip(socket: *mut Socket, buf: *mut u8, length: *mut i32);
    safe fn us_udp_socket_close(socket: &mut Socket);
    safe fn us_udp_socket_set_broadcast(socket: &mut Socket, enabled: c_int) -> c_int;
    safe fn us_udp_socket_buffer_size(
        socket: &mut Socket,
        is_recv: c_int,
        size: c_int,
        out: &mut c_int,
    ) -> c_int;
    safe fn us_udp_socket_fd(socket: &mut Socket) -> LIBUS_SOCKET_DESCRIPTOR;
    fn us_create_udp_socket_from_fd(
        loop_: &Loop,
        data_cb: extern "C" fn(*mut Socket, &PacketBuffer, c_int),
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int, c_int),
        fd: LIBUS_SOCKET_DESCRIPTOR,
        shared: c_int,
        err: *mut c_int,
        user_data: *mut c_void,
    ) -> *mut Socket;
    safe fn us_udp_socket_set_ttl_unicast(socket: &mut Socket, ttl: c_int) -> c_int;
    safe fn us_udp_socket_set_ttl_multicast(socket: &mut Socket, ttl: c_int) -> c_int;
    safe fn us_udp_socket_set_multicast_loopback(socket: &mut Socket, enabled: c_int) -> c_int;
    safe fn us_udp_socket_set_multicast_interface(
        socket: &mut Socket,
        iface: &sockaddr_storage,
    ) -> c_int;
    // `Option<&sockaddr_storage>` is FFI-safe (null-pointer niche → `*const`);
    // the C side reads through `iface` only when non-null. With every pointer
    // arg either a reference or a niche-optimized `Option<&T>`, the validity
    // proof is in the type signature — no remaining preconditions, so `safe fn`.
    safe fn us_udp_socket_set_membership(
        socket: &mut Socket,
        address: &sockaddr_storage,
        iface: Option<&sockaddr_storage>,
        drop: c_int,
    ) -> c_int;
    safe fn us_udp_socket_set_source_specific_membership(
        socket: &mut Socket,
        source: &sockaddr_storage,
        group: &sockaddr_storage,
        iface: Option<&sockaddr_storage>,
        drop: c_int,
    ) -> c_int;
}

/// Raw-descriptor helpers exposed for `internal/dgram`'s UDP wrap so it does
/// not hand-roll socket()/bind()/setsockopt() and diverge from bsd.cpp's
/// platform gates (SO_REUSEPORT vs SO_REUSEADDR, CLOEXEC, EINTR retry).
/// POSIX-only; the JS layer reports ENOTSUP on Windows.
#[cfg(not(windows))]
pub mod raw {
    use super::LIBUS_SOCKET_DESCRIPTOR;
    use core::ffi::{c_int, c_void};

    unsafe extern "C" {
        pub safe fn bsd_create_socket(
            domain: c_int,
            type_: c_int,
            protocol: c_int,
            err: &mut c_int,
        ) -> LIBUS_SOCKET_DESCRIPTOR;
        pub safe fn bsd_close_socket(fd: LIBUS_SOCKET_DESCRIPTOR);
        pub safe fn bsd_set_reuseaddr(fd: LIBUS_SOCKET_DESCRIPTOR) -> c_int;
        /// SAFETY: `addr` must point to `addrlen` bytes of a `sockaddr_in`/`in6`.
        pub unsafe fn bsd_bind_udp_fd(
            fd: LIBUS_SOCKET_DESCRIPTOR,
            addr: *const c_void,
            addrlen: c_int,
            flags: c_int,
        ) -> c_int;
    }
}

bun_opaque::opaque_ffi! {
    /// Opaque uSockets UDP packet buffer (`us_udp_packet_buffer_t`).
    struct PacketBuffer;
}

extern "C" fn on_data<H: Fn(*mut Socket, Packets<'_>) + Copy + 'static>(
    socket: *mut Socket,
    buf: &PacketBuffer,
    count: c_int,
) {
    let indices = 0..count;
    thunk::zst::<H>()(socket, Packets { buf, indices });
}

/// The packets of one read, lent to the data callback.
pub struct Packets<'a> {
    buf: &'a PacketBuffer,
    indices: Range<c_int>,
}

impl<'a> Iterator for Packets<'a> {
    type Item = Packet<'a>;

    fn next(&mut self) -> Option<Packet<'a>> {
        let buf = self.buf;
        self.indices.next().map(|index| Packet { buf, index })
    }
}

#[derive(Clone, Copy)]
pub struct Packet<'a> {
    buf: &'a PacketBuffer,
    index: c_int,
}

impl<'a> Packet<'a> {
    /// On Windows the bytes past the address are uninitialized: the storage must not be copied.
    pub fn peer(self) -> &'a sockaddr_storage {
        // SAFETY: `index` is below the count that came with `buf`. The address is a part of `buf`,
        // which only the frame that calls `on_data` has.
        unsafe { &*us_udp_packet_buffer_peer(self.buf, self.index) }
    }

    /// In the loop's receive buffer, which the next read on the loop refills.
    pub fn payload(self) -> &'a [u8] {
        // SAFETY: `index` is below the count that came with `buf`, so the read wrote `len` bytes there.
        // Only convention keeps a nested tick or `read_now` from writing under the borrow.
        unsafe {
            let payload = us_udp_packet_buffer_payload(self.buf, self.index);
            let len = us_udp_packet_buffer_payload_length(self.buf, self.index);
            core::slice::from_raw_parts(payload, usize::try_from(len).expect("int cast"))
        }
    }

    pub fn is_truncated(self) -> bool {
        // SAFETY: `index` is below the count that came with `buf`.
        unsafe { us_udp_packet_buffer_truncated(self.buf, self.index) != 0 }
    }
}

unsafe extern "C" {
    fn us_udp_packet_buffer_peer(buf: &PacketBuffer, index: c_int) -> *const sockaddr_storage;
    fn us_udp_packet_buffer_payload(buf: &PacketBuffer, index: c_int) -> *const u8;
    fn us_udp_packet_buffer_payload_length(buf: &PacketBuffer, index: c_int) -> c_int;
    fn us_udp_packet_buffer_truncated(buf: &PacketBuffer, index: c_int) -> c_int;
}
