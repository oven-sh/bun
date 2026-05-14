//! `us_quic_socket_context_t` — one lsquic engine + its event-loop wiring.
//! For the client there is exactly one of these per HTTP-thread loop and it
//! lives for the process; the server creates one per `Bun.serve({h3:true})`.

use core::ffi::{CStr, c_char, c_int, c_uint, c_void};

use crate::Loop;
use crate::quic::{PendingConnect, Socket, Stream};

bun_opaque::opaque_ffi! { pub struct Context; }

unsafe extern "C" {
    fn us_create_quic_client_context(
        loop_: *mut Loop,
        ext_size: c_uint,
        conn_ext: c_uint,
        stream_ext: c_uint,
    ) -> *mut Context;

    // `Context` is an `opaque_ffi!` ZST (`UnsafeCell<[u8; 0]>`), so
    // `&mut Context` is ABI-identical to a non-null `*mut Context` with no
    // `noalias`/`readonly` attribute. Shims taking only the handle + value
    // types (incl. fn-pointer callbacks) are `safe fn`.
    safe fn us_quic_socket_context_loop(ctx: &mut Context) -> *mut Loop;

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

    safe fn us_quic_socket_context_on_hsk_done(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Socket, c_int),
    );
    safe fn us_quic_socket_context_on_goaway(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Socket),
    );
    safe fn us_quic_socket_context_on_close(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Socket),
    );
    safe fn us_quic_socket_context_on_stream_open(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Stream, c_int),
    );
    safe fn us_quic_socket_context_on_stream_headers(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Stream),
    );
    safe fn us_quic_socket_context_on_stream_data(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Stream, *const u8, c_uint, c_int),
    );
    safe fn us_quic_socket_context_on_stream_writable(
        ctx: &mut Context,
        cb: unsafe extern "C" fn(*mut Stream),
    );
    safe fn us_quic_socket_context_on_stream_close(
        ctx: &mut Context,
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
    /// # Safety
    /// `loop_` must point to a live `us_loop_t`. Takes a raw pointer (not `&mut Loop`)
    /// because the Loop is shared across every context/socket/timer on the thread —
    /// Zig `*uws.Loop` freely aliases — so requiring `&mut` would force callers to
    /// assert uniqueness that does not hold.
    #[inline]
    pub unsafe fn create_client(
        loop_: *mut Loop,
        ext_size: c_uint,
        conn_ext: c_uint,
        stream_ext: c_uint,
    ) -> Option<*mut Context> {
        // SAFETY: thin FFI forward; all args are POD, return is nullable.
        let p = unsafe { us_create_quic_client_context(loop_, ext_size, conn_ext, stream_ext) };
        if p.is_null() { None } else { Some(p) }
    }

    #[inline]
    pub fn r#loop(&mut self) -> *mut Loop {
        // Returns a raw pointer because the Loop is shared across every
        // context/socket/timer on the thread (Zig `*uws.Loop` freely aliases) —
        // materializing `&mut Loop` here would assert uniqueness we cannot
        // guarantee.
        us_quic_socket_context_loop(self)
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
                &raw mut qs,
                &raw mut pc,
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
        us_quic_socket_context_on_hsk_done(self, cb)
    }
    #[inline]
    pub fn on_goaway(&mut self, cb: unsafe extern "C" fn(*mut Socket)) {
        us_quic_socket_context_on_goaway(self, cb)
    }
    #[inline]
    pub fn on_close(&mut self, cb: unsafe extern "C" fn(*mut Socket)) {
        us_quic_socket_context_on_close(self, cb)
    }
    #[inline]
    pub fn on_stream_open(&mut self, cb: unsafe extern "C" fn(*mut Stream, c_int)) {
        us_quic_socket_context_on_stream_open(self, cb)
    }
    #[inline]
    pub fn on_stream_headers(&mut self, cb: unsafe extern "C" fn(*mut Stream)) {
        us_quic_socket_context_on_stream_headers(self, cb)
    }
    #[inline]
    pub fn on_stream_data(
        &mut self,
        cb: unsafe extern "C" fn(*mut Stream, *const u8, c_uint, c_int),
    ) {
        us_quic_socket_context_on_stream_data(self, cb)
    }
    #[inline]
    pub fn on_stream_writable(&mut self, cb: unsafe extern "C" fn(*mut Stream)) {
        us_quic_socket_context_on_stream_writable(self, cb)
    }
    #[inline]
    pub fn on_stream_close(&mut self, cb: unsafe extern "C" fn(*mut Stream)) {
        us_quic_socket_context_on_stream_close(self, cb)
    }
}

// ported from: src/uws_sys/quic/Context.zig
