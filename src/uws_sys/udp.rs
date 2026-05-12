use core::ffi::{c_char, c_int, c_uint, c_ushort, c_void};
use core::marker::{PhantomData, PhantomPinned};

use crate::Loop;
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

impl Socket {
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
        recv_error_cb: extern "C" fn(*mut Socket, c_int),
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

// ported from: src/uws_sys/udp.zig
