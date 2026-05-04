//! `us_quic_socket_context_t` — one lsquic engine + its event-loop wiring.
//! For the client there is exactly one of these per HTTP-thread loop and it
//! lives for the process; the server creates one per `Bun.serve({h3:true})`.

use core::ffi::{c_char, c_int, c_uint, c_void, CStr};

use crate::Loop;
use crate::quic::{PendingConnect, Socket, Stream};

#[repr(C)]
pub struct Context {
    _p: [u8; 0],
    _m: core::marker::PhantomData<(*mut u8, core::marker::PhantomPinned)>,
}

unsafe extern "C" {
    fn us_create_quic_client_context(
        loop_: *mut Loop,
        ext_size: c_uint,
        conn_ext: c_uint,
        stream_ext: c_uint,
    ) -> *mut Context;

    fn us_quic_socket_context_loop(ctx: *mut Context) -> *mut Loop;

    fn us_quic_socket_context_connect(
        ctx: *mut Context,
        host: *const c_char,
        port: c_int,
        sni: *const c_char,
        reject_unauthorized: c_int,
        out_qs: *mut *mut Socket,
        out_pending: *mut *mut PendingConnect,
        user: *mut c_void,
    ) -> c_int;

    fn us_quic_socket_context_on_hsk_done(
        ctx: *mut Context,
        cb: unsafe extern "C" fn(*mut Socket, c_int),
    );
    fn us_quic_socket_context_on_goaway(ctx: *mut Context, cb: unsafe extern "C" fn(*mut Socket));
    fn us_quic_socket_context_on_close(ctx: *mut Context, cb: unsafe extern "C" fn(*mut Socket));
    fn us_quic_socket_context_on_stream_open(
        ctx: *mut Context,
        cb: unsafe extern "C" fn(*mut Stream, c_int),
    );
    fn us_quic_socket_context_on_stream_headers(
        ctx: *mut Context,
        cb: unsafe extern "C" fn(*mut Stream),
    );
    fn us_quic_socket_context_on_stream_data(
        ctx: *mut Context,
        cb: unsafe extern "C" fn(*mut Stream, *const u8, c_uint, c_int),
    );
    fn us_quic_socket_context_on_stream_writable(
        ctx: *mut Context,
        cb: unsafe extern "C" fn(*mut Stream),
    );
    fn us_quic_socket_context_on_stream_close(
        ctx: *mut Context,
        cb: unsafe extern "C" fn(*mut Stream),
    );
}

pub enum ConnectResult {
    /// IP literal or DNS-cache hit: handshake already in flight.
    Socket(*mut Socket),
    /// DNS cache miss: caller must register a `Bun__addrinfo` callback on
    /// `pending.addrinfo()` and call `pending.resolved()` when it fires.
    Pending(*mut PendingConnect),
    Err,
}

impl Context {
    #[inline]
    pub fn create_client(
        loop_: &mut Loop,
        ext_size: c_uint,
        conn_ext: c_uint,
        stream_ext: c_uint,
    ) -> Option<*mut Context> {
        // SAFETY: thin FFI forward; all args are POD, return is nullable.
        let p = unsafe { us_create_quic_client_context(loop_ as *mut Loop, ext_size, conn_ext, stream_ext) };
        if p.is_null() { None } else { Some(p) }
    }

    #[inline]
    pub fn r#loop(&mut self) -> &mut Loop {
        // SAFETY: self is a live us_quic_socket_context_t; the loop outlives every context it owns.
        unsafe { &mut *us_quic_socket_context_loop(self) }
    }

    pub fn connect(
        &mut self,
        host: &CStr,
        port: u16,
        sni: &CStr,
        reject_unauthorized: bool,
        user: *mut c_void,
    ) -> ConnectResult {
        let mut qs: *mut Socket = core::ptr::null_mut();
        let mut pc: *mut PendingConnect = core::ptr::null_mut();
        // SAFETY: self is a live us_quic_socket_context_t; out-params are valid for write.
        let rc = unsafe {
            us_quic_socket_context_connect(
                self,
                host.as_ptr(),
                c_int::from(port),
                sni.as_ptr(),
                reject_unauthorized as c_int,
                &mut qs,
                &mut pc,
                user,
            )
        };
        match rc {
            1 => ConnectResult::Socket(qs),
            0 => ConnectResult::Pending(pc),
            _ => ConnectResult::Err,
        }
    }

    #[inline]
    pub fn on_hsk_done(&mut self, cb: unsafe extern "C" fn(*mut Socket, c_int)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_hsk_done(self, cb) }
    }
    #[inline]
    pub fn on_goaway(&mut self, cb: unsafe extern "C" fn(*mut Socket)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_goaway(self, cb) }
    }
    #[inline]
    pub fn on_close(&mut self, cb: unsafe extern "C" fn(*mut Socket)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_close(self, cb) }
    }
    #[inline]
    pub fn on_stream_open(&mut self, cb: unsafe extern "C" fn(*mut Stream, c_int)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_stream_open(self, cb) }
    }
    #[inline]
    pub fn on_stream_headers(&mut self, cb: unsafe extern "C" fn(*mut Stream)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_stream_headers(self, cb) }
    }
    #[inline]
    pub fn on_stream_data(&mut self, cb: unsafe extern "C" fn(*mut Stream, *const u8, c_uint, c_int)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_stream_data(self, cb) }
    }
    #[inline]
    pub fn on_stream_writable(&mut self, cb: unsafe extern "C" fn(*mut Stream)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_stream_writable(self, cb) }
    }
    #[inline]
    pub fn on_stream_close(&mut self, cb: unsafe extern "C" fn(*mut Stream)) {
        // SAFETY: thin FFI forward.
        unsafe { us_quic_socket_context_on_stream_close(self, cb) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/uws_sys/quic/Context.zig (56 lines)
//   confidence: high
//   todos:      0
//   notes:      r#loop used to avoid keyword clash; Loop refs are &mut at wrapper layer (raw ptr only at extern "C"); ConnectResult payloads are raw *mut per LIFETIMES.tsv (FFI class)
// ──────────────────────────────────────────────────────────────────────────
