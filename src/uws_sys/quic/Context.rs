//! `us_quic_socket_context_t` — one lsquic engine + its event-loop wiring.
//! For the client there is exactly one of these per HTTP-thread loop and it
//! lives for the process; the server creates one per `Bun.serve({http3:true})`.

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

/// The event handlers of a client [`Context`], as safe Rust. lsquic invokes them
/// on the loop's thread from inside `process_conns`; each handle is live for
/// the duration of the call (a [`Socket`] until its `on_conn_close` returns, a
/// [`Stream`] until its `on_stream_close` returns).
pub trait ClientHandler {
    fn on_hsk_done(qs: &mut Socket, ok: bool);
    fn on_goaway(qs: &mut Socket);
    fn on_conn_close(qs: &mut Socket);
    fn on_stream_open(s: &mut Stream, is_client: bool);
    fn on_stream_headers(s: &mut Stream);
    fn on_stream_data(s: &mut Stream, data: &[u8], fin: bool);
    fn on_stream_writable(s: &mut Stream);
    fn on_stream_close(s: &mut Stream);
}

impl Context {
    /// Create the client engine on the calling thread's uSockets loop.
    pub fn create_client_for_current_thread(
        ext_size: c_uint,
        conn_ext: c_uint,
        stream_ext: c_uint,
    ) -> Option<core::ptr::NonNull<Context>> {
        // SAFETY: `Loop::get()` is this thread's live loop.
        unsafe { Self::create_client(Loop::get(), ext_size, conn_ext, stream_ext) }
            .and_then(core::ptr::NonNull::new)
    }

    /// Route every client event to `H`.
    pub fn register_client_handler<H: ClientHandler>(&mut self) {
        extern "C" fn hsk_done<H: ClientHandler>(qs: *mut Socket, ok: c_int) {
            H::on_hsk_done(Socket::opaque_mut(qs), ok != 0)
        }
        extern "C" fn goaway<H: ClientHandler>(qs: *mut Socket) {
            H::on_goaway(Socket::opaque_mut(qs))
        }
        extern "C" fn close<H: ClientHandler>(qs: *mut Socket) {
            H::on_conn_close(Socket::opaque_mut(qs))
        }
        extern "C" fn stream_open<H: ClientHandler>(s: *mut Stream, is_client: c_int) {
            H::on_stream_open(Stream::opaque_mut(s), is_client != 0)
        }
        extern "C" fn stream_headers<H: ClientHandler>(s: *mut Stream) {
            H::on_stream_headers(Stream::opaque_mut(s))
        }
        extern "C" fn stream_data<H: ClientHandler>(
            s: *mut Stream,
            data: *const u8,
            len: c_uint,
            fin: c_int,
        ) {
            // SAFETY: lsquic hands `len` readable bytes at `data` (or len 0).
            let data = unsafe { bun_core::ffi::slice(data, len as usize) };
            H::on_stream_data(Stream::opaque_mut(s), data, fin != 0)
        }
        extern "C" fn stream_writable<H: ClientHandler>(s: *mut Stream) {
            H::on_stream_writable(Stream::opaque_mut(s))
        }
        extern "C" fn stream_close<H: ClientHandler>(s: *mut Stream) {
            H::on_stream_close(Stream::opaque_mut(s))
        }
        self.on_hsk_done(hsk_done::<H>);
        self.on_goaway(goaway::<H>);
        self.on_close(close::<H>);
        self.on_stream_open(stream_open::<H>);
        self.on_stream_headers(stream_headers::<H>);
        self.on_stream_data(stream_data::<H>);
        self.on_stream_writable(stream_writable::<H>);
        self.on_stream_close(stream_close::<H>);
    }

    /// # Safety
    /// `loop_` must point to a live `us_loop_t`. Takes a raw pointer (not `&mut Loop`)
    /// because the Loop is shared across every context/socket/timer on the thread,
    /// so requiring `&mut` would force callers to assert uniqueness that does not
    /// hold.
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
        // context/socket/timer on the thread —
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
