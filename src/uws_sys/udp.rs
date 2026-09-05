use core::ffi::{CStr, c_char, c_int, c_uint, c_ushort, c_void};
use core::ptr::NonNull;

use bun_ptr::ThisPtr;

use crate::{LIBUS_SOCKET_DESCRIPTOR, Loop};
// `sockaddr_storage` is not in `libc` on Windows; route through the leaf
// ws2_32 shim there. Both definitions are 128-byte 8-aligned POD.
#[cfg(windows)]
pub use bun_windows_sys::ws2_32::sockaddr_storage;
#[cfg(not(windows))]
pub use libc::sockaddr_storage;

/// Callbacks for a UDP socket created with [`UdpSocket::create`], whose
/// user slot is the intrusively-refcounted owner `Self`.
pub trait UdpHandler: bun_ptr::AnyRefCounted + Sized + 'static {
    fn on_data(this: ThisPtr<Self>, socket: &mut Socket, buf: &mut PacketBuffer, packets: c_int);
    fn on_drain(this: ThisPtr<Self>, socket: &mut Socket);
    /// uSockets closed the socket: either the owner's [`UdpSocket::close`],
    /// or a poll error. The owner must dispose of a [`UdpSocket`] it still
    /// holds through [`UdpSocket::closed`] here.
    fn on_close(this: ThisPtr<Self>, socket: &mut Socket);
    /// Always registered, so the socket is created with `IP_RECVERR` where
    /// the platform has it.
    fn on_recv_error(_this: ThisPtr<Self>, _socket: &mut Socket, _errno: c_int, _errqueue: c_int) {}
}

fn udp_owner<U>(socket: *mut Socket) -> Option<(ThisPtr<U>, &'static mut Socket)> {
    let socket = Socket::opaque_mut(socket);
    let user = socket.user().cast::<U>();
    // SAFETY: `user` is the owner `UdpSocket::<U>::create` registered; that
    // handle holds a ref on it until the socket is closed, and uSockets stops
    // calling back once it is (on_close is the last callback).
    (!user.is_null()).then(|| (unsafe { ThisPtr::new(user) }, socket))
}

extern "C" fn udp_on_data<U: UdpHandler>(s: *mut Socket, buf: *mut PacketBuffer, n: c_int) {
    if let Some((this, socket)) = udp_owner::<U>(s) {
        U::on_data(this, socket, PacketBuffer::opaque_mut(buf), n);
    }
}
extern "C" fn udp_on_drain<U: UdpHandler>(s: *mut Socket) {
    if let Some((this, socket)) = udp_owner::<U>(s) {
        U::on_drain(this, socket);
    }
}
extern "C" fn udp_on_close<U: UdpHandler>(s: *mut Socket) {
    if let Some((this, socket)) = udp_owner::<U>(s) {
        let _keep = bun_ptr::RefPtr::from_this(this);
        U::on_close(this, socket);
    }
}
extern "C" fn udp_on_recv_error<U: UdpHandler>(s: *mut Socket, errno: c_int, errqueue: c_int) {
    if let Some((this, socket)) = udp_owner::<U>(s) {
        U::on_recv_error(this, socket, errno, errqueue);
    }
}

/// An open UDP socket whose user slot is its owner `U`; holds a ref on the
/// owner for as long as uSockets can call back through it.
pub struct UdpSocket<U: UdpHandler> {
    /// `None` only once uSockets has closed it ([`UdpSocket::closed`]).
    socket: Option<NonNull<Socket>>,
    _owner: bun_ptr::RefPtr<U>,
}

impl<U: UdpHandler> UdpSocket<U> {
    /// Bind a UDP socket on this thread's loop. On failure `Err` carries the
    /// errno.
    pub fn create(
        host: &CStr,
        port: c_ushort,
        options: c_int,
        owner: ThisPtr<U>,
    ) -> Result<Self, c_int> {
        let owner = bun_ptr::RefPtr::from_this(owner);
        let mut err: c_int = 0;
        match NonNull::new(Socket::create(
            Loop::get(),
            udp_on_data::<U>,
            udp_on_drain::<U>,
            udp_on_close::<U>,
            udp_on_recv_error::<U>,
            host.as_ptr(),
            port,
            options,
            Some(&mut err),
            owner.as_ptr().cast(),
        )) {
            Some(socket) => Ok(UdpSocket {
                socket: Some(socket),
                _owner: owner,
            }),
            None => Err(err),
        }
    }

    #[allow(clippy::mut_from_ref)]
    pub fn get(&self) -> &mut Socket {
        Socket::opaque_mut(self.as_ptr().as_ptr())
    }

    pub fn as_ptr(&self) -> NonNull<Socket> {
        self.socket.expect("UdpSocket used after closed()")
    }

    /// Close the socket (fires [`UdpHandler::on_close`] synchronously) and
    /// release the owner ref. Take the handle out of the owner first so
    /// `on_close` finds none.
    pub fn close(self) {
        drop(self);
    }

    /// Dispose of a handle whose socket uSockets already closed (from
    /// [`UdpHandler::on_close`]): releases the owner ref without closing.
    pub fn closed(mut self) {
        self.socket = None;
    }
}

impl<U: UdpHandler> Drop for UdpSocket<U> {
    /// Closes the socket if still open (fires [`UdpHandler::on_close`]
    /// synchronously), then releases the owner ref.
    fn drop(&mut self) {
        if let Some(socket) = self.socket.take() {
            Socket::opaque_mut(socket.as_ptr()).close();
        }
    }
}

bun_opaque::opaque_ffi! {
    /// Opaque uSockets UDP socket handle (`us_udp_socket_t`).
    pub struct Socket;
}

impl Socket {
    pub fn create(
        loop_: *mut Loop,
        data_cb: extern "C" fn(*mut Socket, *mut PacketBuffer, c_int),
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int, c_int),
        host: *const c_char,
        port: c_ushort,
        options: c_int,
        err: Option<&mut c_int>,
        user_data: *mut c_void,
    ) -> *mut Socket {
        // SAFETY: thin wrapper over us_create_udp_socket; all pointer args are
        // forwarded as-is from the caller, who upholds uSockets' contract.
        unsafe {
            us_create_udp_socket(
                loop_,
                data_cb,
                drain_cb,
                close_cb,
                recv_error_cb,
                host,
                port,
                options,
                match err {
                    Some(e) => std::ptr::from_mut::<c_int>(e),
                    None => core::ptr::null_mut(),
                },
                user_data,
            )
        }
    }

    /// Adopts an already created (and usually bound) UDP socket descriptor
    /// instead of creating a new one. See `us_create_udp_socket_from_fd`.
    pub fn create_from_fd(
        loop_: *mut Loop,
        data_cb: extern "C" fn(*mut Socket, *mut PacketBuffer, c_int),
        drain_cb: extern "C" fn(*mut Socket),
        close_cb: extern "C" fn(*mut Socket),
        recv_error_cb: extern "C" fn(*mut Socket, c_int, c_int),
        fd: c_int,
        shared: bool,
        err: Option<&mut c_int>,
        user_data: *mut c_void,
    ) -> *mut Socket {
        #[cfg(not(windows))]
        let fd_native: LIBUS_SOCKET_DESCRIPTOR = fd;
        #[cfg(windows)]
        let fd_native = fd as LIBUS_SOCKET_DESCRIPTOR;
        // SAFETY: thin wrapper over us_create_udp_socket_from_fd; all pointer
        // args are forwarded as-is from the caller, who upholds uSockets'
        // contract.
        unsafe {
            us_create_udp_socket_from_fd(
                loop_,
                data_cb,
                drain_cb,
                close_cb,
                recv_error_cb,
                fd_native,
                shared as c_int,
                err.map_or(core::ptr::null_mut(), core::ptr::from_mut),
                user_data,
            )
        }
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

    /// The bound address's raw bytes (4 for IPv4, 16 for IPv6), written to
    /// the front of `buf`; returns how many were written (0 when unbound or
    /// `buf` is too small).
    pub fn bound_ip_into(&mut self, buf: &mut [u8]) -> usize {
        let mut len = i32::try_from(buf.len()).unwrap_or(i32::MAX);
        // SAFETY: `buf` is writable for `len` bytes; uSockets writes at most
        // that many and stores the count back.
        unsafe { us_udp_socket_bound_ip(self, buf.as_mut_ptr(), &raw mut len) };
        usize::try_from(len).unwrap_or(0).min(buf.len())
    }

    pub fn remote_ip(&mut self, buf: *mut u8, length: &mut i32) {
        // SAFETY: buf must point to at least *length bytes; thin FFI passthrough.
        unsafe { us_udp_socket_remote_ip(self, buf, length) }
    }

    pub fn close(&mut self) {
        us_udp_socket_close(self)
    }

    pub fn connect(&mut self, hostname: *const c_char, port: c_uint) -> c_int {
        // SAFETY: thin FFI passthrough; hostname must be NUL-terminated per uSockets.
        unsafe { us_udp_socket_connect(self, hostname, port) }
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
        loop_: *mut Loop,
        data_cb: extern "C" fn(*mut Socket, *mut PacketBuffer, c_int),
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
        loop_: *mut Loop,
        data_cb: extern "C" fn(*mut Socket, *mut PacketBuffer, c_int),
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
/// not hand-roll socket()/bind()/setsockopt() and diverge from bsd.c's
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
    pub struct PacketBuffer;
}

impl PacketBuffer {
    pub fn get_peer(&mut self, index: c_int) -> &mut sockaddr_storage {
        // SAFETY: uSockets guarantees a non-null, properly-aligned peer pointer for
        // indices < packet count. The returned storage lives inside the C-owned packet
        // buffer, which is exclusively loaned to the data callback for its duration; no
        // other Rust or C path holds a reference to it. The reborrow of `&mut self`
        // ties the returned lifetime to this handle, so the borrow checker prevents
        // obtaining a second overlapping `&mut` via `get_peer`/`get_payload`.
        unsafe { &mut *us_udp_packet_buffer_peer(self, index) }
    }

    pub fn get_payload(&mut self, index: c_int) -> &mut [u8] {
        // SAFETY: for `index < packet_count`, uSockets returns a non-null
        // pointer to `len` initialized bytes inside the C-owned packet buffer,
        // exclusively loaned to the data callback for its duration. The
        // returned borrow is tied to `&mut self`, so the borrow checker
        // prevents overlapping `&mut` via `get_peer`/`get_payload`.
        unsafe {
            let payload = us_udp_packet_buffer_payload(self, index);
            let len = us_udp_packet_buffer_payload_length(self, index);
            core::slice::from_raw_parts_mut(payload, usize::try_from(len).expect("int cast"))
        }
    }

    pub fn get_truncated(&mut self, index: c_int) -> bool {
        us_udp_packet_buffer_truncated(self, index) != 0
    }
}

unsafe extern "C" {
    safe fn us_udp_packet_buffer_peer(
        buf: &mut PacketBuffer,
        index: c_int,
    ) -> *mut sockaddr_storage;
    safe fn us_udp_packet_buffer_payload(buf: &mut PacketBuffer, index: c_int) -> *mut u8;
    safe fn us_udp_packet_buffer_payload_length(buf: &mut PacketBuffer, index: c_int) -> c_int;
    safe fn us_udp_packet_buffer_truncated(buf: &mut PacketBuffer, index: c_int) -> c_int;
}
