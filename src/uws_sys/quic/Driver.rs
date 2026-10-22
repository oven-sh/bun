//! `us_quic_driver_t` and `us_quic_udp_t`, which every lsquic engine in Bun runs on. The HTTP/3 contexts use them from C, `node:quic` from here.

use core::ffi::{c_char, c_int, c_void};

use bun_boringssl_sys::SSL_CTX;

use crate::{Loop, udp};

bun_opaque::opaque_ffi! {
    /// Owns lsquic engines and their UDP sockets, and is the only code that enters the engines.
    pub struct Driver;
    /// A driver's UDP socket. Valid until `Driver::close`.
    pub struct Udp;
}

/// Runs the owner's engines if they have work. Returns the µs until they want the next pass, or -1. It may free the driver.
pub type Pass = unsafe extern "C" fn(driver: *mut Driver, in_microtask_drain: c_int) -> c_int;

unsafe extern "C" {
    fn us_quic_driver_create(loop_: *mut Loop, pass: Pass, owner: *mut c_void) -> *mut Driver;
    safe fn us_quic_driver_close(driver: &Driver);
    fn us_quic_driver_free(driver: *mut Driver);
    safe fn us_quic_driver_owner(driver: &Driver) -> *mut c_void;
    safe fn us_quic_driver_process(driver: &Driver);
    safe fn us_quic_driver_next_tick_us(driver: &Driver) -> c_int;
    safe fn us_quic_driver_set_pending(driver: &Driver);
    safe fn us_quic_driver_is_pending(driver: &Driver) -> c_int;
    fn us_quic_driver_set_ssl_ctx(driver: *mut Driver, ssl_ctx: *mut SSL_CTX);
    fn us_quic_udp_create(
        driver: *mut Driver,
        host: *const c_char,
        port: c_int,
        flags: c_int,
        err: *mut c_int,
        on_data: extern "C" fn(*mut udp::Socket, *mut udp::PacketBuffer, c_int),
        on_recv_error: extern "C" fn(*mut udp::Socket, c_int, c_int),
    ) -> *mut Udp;
    safe fn us_quic_udp_owner(udp: &Udp) -> *mut c_void;
    safe fn us_quic_udp_socket(udp: &Udp) -> *mut udp::Socket;
    safe fn us_quic_udp_local(udp: &Udp) -> *const c_void;
    fn us_quic_udp_count_sent(udp: *mut Udp, packets: *mut u64, bytes: *mut u64);
    fn us_quic_udp_connect(
        udp: *mut Udp,
        engine: *mut c_void,
        peer: *const c_void,
        ssl_ctx: *mut SSL_CTX,
        conn_ctx: *mut c_void,
        sni: *const c_char,
        session_resume: *const u8,
        session_resume_len: usize,
    ) -> *mut c_void;
}

impl Driver {
    /// `pass` runs before and after each poll of `loop_` (this thread's), and after a microtask drain while the driver is pending. `owner` must outlive the driver.
    pub unsafe fn create(loop_: *mut Loop, pass: Pass, owner: *mut c_void) -> *mut Driver {
        // SAFETY: caller contract.
        unsafe { us_quic_driver_create(loop_, pass, owner) }
    }

    /// Closes the UDP sockets and destroys the engines. `pass` keeps running.
    pub fn close(&self) {
        us_quic_driver_close(self)
    }

    /// `this` came from `Driver::create` and isn't used again.
    pub unsafe fn free(this: *mut Driver) {
        // SAFETY: caller contract.
        unsafe { us_quic_driver_free(this) }
    }

    pub fn owner(&self) -> *mut c_void {
        us_quic_driver_owner(self)
    }

    /// `lsquic_engine_process_conns` on every engine. Does nothing while an engine is on the stack.
    pub fn process(&self) {
        us_quic_driver_process(self)
    }

    /// The µs until an engine wants the next `process`, or -1.
    pub fn next_tick_us(&self) -> c_int {
        us_quic_driver_next_tick_us(self)
    }

    /// The owner queued work in an engine. `process` clears it.
    pub fn set_pending(&self) {
        us_quic_driver_set_pending(self)
    }

    pub fn is_pending(&self) -> bool {
        us_quic_driver_is_pending(self) != 0
    }

    /// What a server engine starts a handshake with, before SNI. `ssl_ctx` must outlive the engines.
    pub unsafe fn set_ssl_ctx(&self, ssl_ctx: *mut SSL_CTX) {
        // SAFETY: caller contract.
        unsafe { us_quic_driver_set_ssl_ctx(self.as_mut_ptr(), ssl_ctx) }
    }

    /// Binds a UDP socket to the NUL-terminated `host`. Its user data is the returned `Udp`. Null on failure, with the errno in `err`.
    pub unsafe fn create_udp(
        &self,
        host: *const c_char,
        port: u16,
        flags: c_int,
        err: &mut c_int,
        on_data: extern "C" fn(*mut udp::Socket, *mut udp::PacketBuffer, c_int),
        on_recv_error: extern "C" fn(*mut udp::Socket, c_int, c_int),
    ) -> *mut Udp {
        // SAFETY: caller contract. `err` is a valid out-param.
        unsafe {
            us_quic_udp_create(
                self.as_mut_ptr(),
                host,
                c_int::from(port),
                flags,
                err,
                on_data,
                on_recv_error,
            )
        }
    }
}

impl Udp {
    /// The `owner` of this socket's driver.
    pub fn owner(&self) -> *mut c_void {
        us_quic_udp_owner(self)
    }

    /// Null once the fd has closed.
    pub fn socket(&self) -> *mut udp::Socket {
        us_quic_udp_socket(self)
    }

    /// The bound `sockaddr`, which is the `sa_local` of every `lsquic_engine_packet_in` call for this socket.
    pub fn local(&self) -> *const c_void {
        us_quic_udp_local(self)
    }

    /// Adds every datagram this socket sends to the two counters, which must stay valid until `Driver::close`.
    pub unsafe fn count_sent(&self, packets: *mut u64, bytes: *mut u64) {
        // SAFETY: caller contract.
        unsafe { us_quic_udp_count_sent(self.as_mut_ptr(), packets, bytes) }
    }

    /// `lsquic_engine_connect` on `engine`, one of the driver's, from this socket. Returns the `lsquic_conn_t`, or null. `sni` is null or NUL-terminated.
    pub unsafe fn connect(
        &self,
        engine: *mut c_void,
        peer: *const c_void,
        ssl_ctx: *mut SSL_CTX,
        conn_ctx: *mut c_void,
        sni: *const c_char,
        session_resume: &[u8],
    ) -> *mut c_void {
        // SAFETY: caller contract. lsquic copies `session_resume`.
        unsafe {
            us_quic_udp_connect(
                self.as_mut_ptr(),
                engine,
                peer,
                ssl_ctx,
                conn_ctx,
                sni,
                if session_resume.is_empty() {
                    core::ptr::null()
                } else {
                    session_resume.as_ptr()
                },
                session_resume.len(),
            )
        }
    }
}
