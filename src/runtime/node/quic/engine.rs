//! The lsquic engine and its callbacks (`packages/bun-usockets/src/node_quic_shim.c` lists them).

use core::borrow::Borrow;
use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::mem::MaybeUninit;
use core::ptr::{NonNull, null, null_mut};

use bun_core::ffi::{slice, slice_mut};
use bun_jsc::bindgen::{JsPayload, StrongWrapper};
use bun_jsc::{EnsureStillAlive, JSValue};
use bun_lsquic_sys::{self as lsquic, Conn, Stream, lsquic_conn, lsquic_stream};
use bun_ptr::{AliasableBox, CellExt as _, OptionCellExt as _};

use super::session::StoredAddr;
use super::tls::TlsContext;
use super::{QuicEndpoint, QuicSession, QuicStream};

/// The engine's `ea_stream_if_ctx`, `ea_packets_out_ctx`, `ea_cert_lu_ctx` and `peer_ctx`.
struct EngineCtx {
    /// Null outside `call_with_endpoint`.
    endpoint: Cell<*const QuicEndpoint>,
    tls: Cell<Option<TlsContext>>,
    origin_blob: Vec<u8>,
}

/// Methods that run callbacks take `&mut self`, so a callback can't re-enter or drop its engine.
pub(super) struct Engine {
    raw: NonNull<lsquic::lsquic_engine>,
    ctx: AliasableBox<EngineCtx>,
}

impl Engine {
    /// `origin_blob` is the payload of the ORIGIN frame (RFC 9412) that a server sends after SETTINGS.
    pub(super) fn new(
        is_server: bool,
        is_http: bool,
        mut settings: lsquic::Settings,
        tls: TlsContext,
        origin_blob: Vec<u8>,
    ) -> Option<Self> {
        static INIT: std::sync::Once = std::sync::Once::new();
        INIT.call_once(|| {
            if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_lsquic")).is_some() {
                // SAFETY: static C string.
                unsafe { lsquic::us_nq_enable_logging(c"debug".as_ptr()) };
            }
        });
        lsquic::debug_assert_layout();

        let ctx = AliasableBox::new(EngineCtx {
            endpoint: Cell::new(null()),
            tls: Cell::new(Some(tls)),
            origin_blob,
        });
        // SAFETY: `ctx` is dropped after the engine is destroyed. lsquic copies `settings`.
        let raw = unsafe {
            if !ctx.origin_blob.is_empty() {
                settings.origin_blob(&ctx.origin_blob);
            }
            lsquic::us_nq_engine_new(
                is_server as c_int,
                is_http as c_int,
                ctx.as_ptr().cast(),
                settings.as_ptr(),
            )
        };
        Some(Self {
            raw: NonNull::new(raw)?,
            ctx,
        })
    }

    fn call_with_endpoint(&mut self, endpoint: &QuicEndpoint, f: impl FnOnce(&Self)) {
        self.ctx.endpoint.set(endpoint);
        f(self);
        self.ctx.endpoint.set(null());
    }

    pub(super) fn packet_in(
        &mut self,
        endpoint: &QuicEndpoint,
        packet: &[u8],
        local: &StoredAddr,
        peer: &StoredAddr,
    ) {
        self.call_with_endpoint(endpoint, |this| {
            // SAFETY: the engine is live and not running. It copies what it keeps, except `ctx`.
            unsafe {
                lsquic::lsquic_engine_packet_in(
                    this.raw.as_ptr(),
                    packet.as_ptr(),
                    packet.len(),
                    local.as_ptr(),
                    peer.as_ptr(),
                    this.ctx.as_ptr().cast(),
                    0,
                )
            };
        });
    }

    pub(super) fn process_conns(&mut self, endpoint: &QuicEndpoint) {
        self.call_with_endpoint(endpoint, |this| {
            // SAFETY: the engine is live and not running.
            unsafe { lsquic::lsquic_engine_process_conns(this.raw.as_ptr()) }
        });
    }

    pub(super) fn send_unsent_packets(&mut self, endpoint: &QuicEndpoint) {
        self.call_with_endpoint(endpoint, |this| {
            // SAFETY: as above.
            unsafe { lsquic::lsquic_engine_send_unsent_packets(this.raw.as_ptr()) }
        });
    }

    /// Existing conns keep their `SSL_CTX` alive, but not the `arg` of its ALPN select callback.
    pub(super) fn set_client_tls(&mut self, tls: TlsContext) {
        let old = self.ctx.tls.replace(Some(tls));
        assert!(!old.is_some_and(|old| old.has_alpn_select_cb()));
    }

    /// Binds the new conn to `session`, unless `lsquic_engine_connect` fails.
    pub(super) fn connect(
        &mut self,
        session: &StrongCtx<QuicSession>,
        local: &StoredAddr,
        peer: &StoredAddr,
        servername: Option<&CStr>,
        sess_resume: &[u8],
    ) {
        // SAFETY: as in `packet_in`. The result is null or live, and is only used here.
        let conn = unsafe {
            Conn::from_raw(lsquic::lsquic_engine_connect(
                self.raw.as_ptr(),
                lsquic::N_LSQVER,
                local.as_ptr(),
                peer.as_ptr(),
                self.ctx.as_ptr().cast(),
                null_mut(),
                servername.map_or(null(), CStr::as_ptr),
                0,
                if sess_resume.is_empty() {
                    null()
                } else {
                    sess_resume.as_ptr()
                },
                sess_resume.len(),
                // `options.token` is validated in JS but deliberately not
                // replayed: handing it to lsquic breaks the token and zero-rtt
                // tests, at the cost of the Retry RTT it would have saved.
                null(),
                0,
            ))
        };
        session.bind(&conn);
    }

    /// Calls `on_new_stream` now, or when the peer allows another stream.
    pub(super) fn make_stream(&mut self, conn: &Conn, unidirectional: bool) {
        let Some(conn) = conn.raw() else { return };
        // SAFETY: the conn is live, and only its engine can free it.
        unsafe {
            if lsquic::lsquic_conn_get_engine(conn) != self.raw.as_ptr() {
                return;
            }
            if unidirectional {
                lsquic::lsquic_conn_make_uni_stream(conn);
            } else {
                lsquic::lsquic_conn_make_stream(conn);
            }
        }
    }

    pub(super) fn set_idle_timeout_ms(&mut self, ms: c_uint) {
        // SAFETY: the engine is live.
        unsafe { lsquic::lsquic_engine_set_idle_timeout_ms(self.raw.as_ptr(), ms) }
    }

    pub(super) fn has_unsent_packets(&self) -> bool {
        // SAFETY: as above.
        unsafe { lsquic::lsquic_engine_has_unsent_packets(self.raw.as_ptr()) != 0 }
    }

    pub(super) fn cid_in_use(&self, cid: &[u8]) -> bool {
        // SAFETY: as above; `cid` is a live slice.
        unsafe { lsquic::lsquic_engine_cid_in_use(self.raw.as_ptr(), cid.as_ptr(), cid.len()) != 0 }
    }

    pub(super) fn conn_count(&self) -> c_uint {
        // SAFETY: as above.
        unsafe { lsquic::lsquic_engine_conn_count(self.raw.as_ptr()) }
    }

    /// Microseconds from now.
    pub(super) fn earliest_adv_tick(&self) -> Option<c_int> {
        let mut diff: c_int = 0;
        // SAFETY: as above; the out-param is a stack slot.
        let advised =
            unsafe { lsquic::lsquic_engine_earliest_adv_tick(self.raw.as_ptr(), &raw mut diff) };
        (advised != 0).then_some(diff)
    }

    /// `(sent, rate_limited)`.
    pub(super) fn sreset_stats(&self) -> (u64, u64) {
        let (mut sent, mut limited) = (0u64, 0u64);
        // SAFETY: as above.
        unsafe {
            lsquic::lsquic_engine_sreset_stats(self.raw.as_ptr(), &raw mut sent, &raw mut limited)
        };
        (sent, limited)
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        // SAFETY: the engine is live and not running.
        unsafe { lsquic::lsquic_engine_destroy(self.raw.as_ptr()) }
    }
}

/// Empty while `with_taken` runs.
#[derive(Default)]
pub(super) struct EngineCell(Cell<Option<Engine>>);

impl EngineCell {
    pub(super) fn is_some(&self) -> bool {
        self.0.is_some()
    }

    pub(super) fn set(&self, engine: Engine) {
        self.0.set(Some(engine));
    }

    pub(super) fn clear(&self) {
        self.0.set(None);
    }

    pub(super) fn with_taken<R>(&self, f: impl FnOnce(&mut Engine) -> R) -> Option<R> {
        let mut engine = self.0.take()?;
        let result = f(&mut engine);
        self.0.put_back(Some(engine));
        Some(result)
    }
}

pub(super) trait Unbind: JsPayload {
    fn unbind(&self);
}

/// Roots the ctx of an lsquic conn or stream, and unbinds it on drop.
pub(super) struct StrongCtx<T: Unbind>(StrongWrapper<T>);

impl<T: Unbind> StrongCtx<T> {
    pub(super) fn new(wrapper: StrongWrapper<T>) -> Self {
        Self(wrapper)
    }
}

impl<T: Unbind> core::ops::Deref for StrongCtx<T> {
    type Target = StrongWrapper<T>;
    fn deref(&self) -> &StrongWrapper<T> {
        &self.0
    }
}

impl<T: Unbind> Borrow<StrongWrapper<T>> for StrongCtx<T> {
    fn borrow(&self) -> &StrongWrapper<T> {
        &self.0
    }
}

impl<T: Unbind> Drop for StrongCtx<T> {
    fn drop(&mut self) {
        self.0.try_with(|ctx| ctx.unbind());
    }
}

impl Unbind for QuicSession {
    fn unbind(&self) {
        self.conn.unbind();
    }
}

impl StrongCtx<QuicSession> {
    pub(super) fn bind(&self, conn: &Conn) {
        self.0.try_with(|session| {
            let ctx = core::ptr::from_ref(session.payload()).cast_mut().cast();
            // SAFETY: `onConnClosed` unbinds `session.conn` and makes no `Conn`. `self` roots the
            // session until it unbinds. The teardown of the VM ignores roots, and then
            // `session.conn` unbinds when the session is dropped.
            unsafe { session.conn.bind(conn, ctx) }
        });
    }
}

impl Unbind for QuicStream {
    fn unbind(&self) {
        self.raw.unbind();
    }
}

impl StrongCtx<QuicStream> {
    pub(super) fn bind(&self, raw: &Stream) {
        self.0.try_with(|stream| {
            let ctx = core::ptr::from_ref(stream.payload()).cast_mut().cast();
            // SAFETY: as for a session, with `onStreamClose`.
            unsafe { stream.raw.bind(raw, ctx) }
        });
    }
}

/// Not `try_with_payload_ptr`: the close callbacks have to unbind after the VM is closed.
///
/// # Safety
/// `ctx` is null, or `StrongCtx::<T>::bind` set it and it is still bound.
unsafe fn with_ctx<T: Unbind, R>(ctx: *mut c_void, f: impl FnOnce(&T) -> R) -> Option<R> {
    // SAFETY: not dropped yet, see `bind`. `_wrapper` keeps it if `f` drops the `StrongCtx`.
    let payload = unsafe { ctx.cast::<T>().as_ref() }?;
    let _wrapper = EnsureStillAlive(JSValue::from_cell(ctx.wrapping_byte_sub(T::PAYLOAD_OFFSET)));
    Some(f(payload))
}

/// # Safety
/// `ctx` is the `EngineCtx` of an engine that is running a callback.
unsafe fn with_endpoint<R>(ctx: *mut c_void, f: impl FnOnce(&QuicEndpoint) -> R) -> Option<R> {
    // SAFETY: an `EngineCtx` outlives its engine, and `call_with_endpoint` borrows `endpoint`.
    unsafe { (*ctx.cast::<EngineCtx>()).endpoint.get().as_ref() }.map(f)
}

/// `(local, peer)`.
pub(super) fn conn_sockaddrs(conn: &Conn) -> Option<(StoredAddr, StoredAddr)> {
    let (mut local, mut peer) = (null(), null());
    // SAFETY: the conn is live. On success both point into its `network_path`, where each has the
    // size of a `sockaddr_in6` and is aligned for one.
    unsafe {
        (lsquic::lsquic_conn_get_sockaddr(conn.raw()?, &raw mut local, &raw mut peer) == 0)
            .then(|| (*local.cast(), *peer.cast()))
    }
}

/// Mirrors `struct lsquic_out_spec`. Only lsquic makes one, and `iov` is valid for as long as it is.
#[repr(C)]
pub(super) struct OutSpec<'a> {
    iov: *const lsquic::iovec,
    iovlen: usize,
    pub(super) local_sa: &'a StoredAddr,
    pub(super) dest_sa: &'a StoredAddr,
    _peer_ctx: *mut c_void,
    _conn_ctx: *mut c_void,
    _ecn: c_int,
}

// node_quic_shim.c asserts the same numbers.
bun_opaque::assert_ffi_layout!(OutSpec<'static>, 56, 8; iov @ 0, iovlen @ 8, local_sa @ 16, dest_sa @ 24);

impl OutSpec<'_> {
    pub(super) fn iov(&self) -> &[lsquic::iovec] {
        // SAFETY: see the type.
        unsafe { slice(self.iov, self.iovlen) }
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__packetsOut(
    ctx: *mut c_void,
    specs: *const OutSpec<'_>,
    count: c_uint,
) -> c_int {
    // SAFETY: `specs[..count]` is valid for this callback. The addresses are as in `conn_sockaddrs`.
    let sent = unsafe { with_endpoint(ctx, |e| e.packets_out(slice(specs, count as usize))) };
    let sent = sent.unwrap_or(0);
    if sent < count as usize {
        // SAFETY: `errno_ptr()` is this thread's errno slot.
        unsafe {
            let e = bun_core::ffi::errno_ptr();
            // EMSGSIZE has to survive: it is how lsquic learns to drop
            // an oversized packet and feed DPLPMTUD (ci_packet_too_large).
            // Anything else it cannot act on becomes backpressure.
            if *e != libc::EAGAIN && *e != libc::EWOULDBLOCK && *e != libc::EMSGSIZE {
                *e = libc::EAGAIN;
            }
        }
    }
    sent as c_int
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__getSslCtx(
    ctx: *mut c_void,
    _local: *const c_void,
) -> *mut bun_boringssl_sys::SSL_CTX {
    // SAFETY: the engine's `EngineCtx`. lsquic takes a reference to the result before the next
    // callback.
    let ctx = unsafe { &*ctx.cast::<EngineCtx>() };
    ctx.tls
        .with_taken(|tls| tls.as_ref().map_or(null_mut(), TlsContext::raw))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__lookupCert(
    ctx: *mut c_void,
    local: *const c_void,
    sni: *const c_char,
) -> *mut bun_boringssl_sys::SSL_CTX {
    // SAFETY: `sni` is null or a C string that is valid for this callback. lsquic takes a reference
    // to the result before the next callback. BoringSSL runs the ALPN select callback, which
    // reads the `TlsContext`, in the same handshake step.
    unsafe {
        if !sni.is_null() {
            let host = CStr::from_ptr(sni).to_bytes();
            if let Some(found) = with_endpoint(ctx, |e| e.lookup_cert(host)).flatten() {
                return found;
            }
        }
        Bun__nodeQuic__getSslCtx(ctx, local)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onMiniConnFailed(
    ctx: *mut c_void,
    peer_sa: &StoredAddr,
    error_code: u64,
) {
    // SAFETY: the engine's `EngineCtx`.
    unsafe { with_endpoint(ctx, |e| e.on_mini_conn_failed(peer_sa, error_code)) };
}

/// Does nothing for a client conn, which `Engine::connect` binds.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onNewConn(
    ctx: *mut c_void,
    c: *mut lsquic_conn,
) -> *mut c_void {
    // SAFETY: `c` is live for this callback, which can't re-enter its engine.
    unsafe {
        with_endpoint(ctx, |e| e.on_new_conn(&Conn::from_raw(c)));
        lsquic::lsquic_conn_get_ctx(c)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onConnClosed(c: *mut lsquic_conn) {
    // SAFETY: `c` is live for this callback.
    unsafe {
        with_ctx(lsquic::lsquic_conn_get_ctx(c), |session: &QuicSession| {
            let status = session.conn.status();
            session.unbind();
            session.on_conn_closed(status);
        })
    };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onDgWrite(
    c: *mut lsquic_conn,
    buf: *mut MaybeUninit<u8>,
    len: usize,
) -> isize {
    // SAFETY: `c` is live and `buf[..len]` is writable for this callback.
    let written = unsafe {
        with_ctx(lsquic::lsquic_conn_get_ctx(c), |session: &QuicSession| {
            session.on_dg_write(slice_mut(buf, len))
        })
    };
    // -1 means "nothing written"; lsquic treats any value >= 0 as a
    // datagram it should frame, so 0 emits an empty DATAGRAM frame.
    written.flatten().map_or(-1, |n| n as isize)
}

macro_rules! session_callbacks {
    ($($symbol:ident($($arg:ident: $Arg:ty),*) => $method:ident($($value:expr),*);)+) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $symbol(c: *mut lsquic_conn, $($arg: $Arg),*) {
            // SAFETY: `c` is live and `data[..len]` is valid for this callback. The addresses are
            // as in `conn_sockaddrs`.
            unsafe {
                with_ctx(lsquic::lsquic_conn_get_ctx(c), |session: &QuicSession| {
                    session.$method($($value),*)
                })
            };
        }
    )+};
}

session_callbacks! {
    Bun__nodeQuic__onHskDone(status: c_int) => on_hsk_done(status);
    Bun__nodeQuic__onHskConfirmed() => on_hsk_confirmed();
    Bun__nodeQuic__onGoawayReceived() => on_goaway_received();
    Bun__nodeQuic__onNewToken(data: *const u8, len: usize) => on_new_token(slice(data, len));
    Bun__nodeQuic__onSessResume(data: *const u8, len: usize) => on_sess_resume(slice(data, len));
    Bun__nodeQuic__onConnCloseFrame(app_error: c_int, code: u64, data: *const u8, len: c_int)
        => on_conncloseframe(app_error == 1, code, slice(data, len.max(0) as usize));
    Bun__nodeQuic__onDatagram(data: *const u8, len: usize) => on_datagram(slice(data, len));
    Bun__nodeQuic__onDatagramStatus(count: c_uint, acked: c_int)
        => on_datagram_status(count, acked != 0);
    Bun__nodeQuic__onEarlyDataFailed() => on_early_data_failed();
    Bun__nodeQuic__onPathSwitch(
        validated: c_int,
        is_preferred: c_int,
        new_local: &StoredAddr,
        new_peer: &StoredAddr,
        old_local: &StoredAddr,
        old_peer: &StoredAddr
    ) => on_path_switch(validated != 0, is_preferred != 0, new_local, new_peer, old_local, old_peer);
    Bun__nodeQuic__onOrigin(data: *const u8, len: usize, fin: c_int)
        => on_origin(slice(data, len), fin != 0);
}

/// # Safety
/// `ssl` belongs to an `Engine`, which is calling BoringSSL with it.
pub(super) unsafe fn on_keylog(ssl: *const c_void, line: &[u8]) {
    // SAFETY: lsquic keeps the conn of an `SSL` that it is using. Its `peer_ctx` is null until
    // `lsquic_engine_connect` records the addresses.
    unsafe {
        let c = lsquic::lsquic_ssl_to_conn(ssl);
        if c.is_null() {
            return;
        }
        let ctx = lsquic::lsquic_conn_get_ctx(c);
        if with_ctx(ctx, |session: &QuicSession| session.on_keylog(line)).is_some() {
            return;
        }
        let peer_ctx = lsquic::lsquic_conn_get_peer_ctx(c, null());
        if peer_ctx.is_null() {
            return;
        }
        if let Some((_, peer)) = conn_sockaddrs(&Conn::from_raw(c)) {
            with_endpoint(peer_ctx, |e| e.buffer_early_keylog(ssl.addr(), peer, line));
        }
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onNewStream(
    _ctx: *mut c_void,
    s: *mut lsquic_stream,
) -> *mut c_void {
    if s.is_null() {
        return null_mut();
    }
    // SAFETY: `s` and its conn are live for this callback, which can't re-enter their engine. A
    // `StrongCtx` roots the session.
    unsafe {
        let ctx = lsquic::lsquic_conn_get_ctx(lsquic::lsquic_stream_conn(s));
        if !ctx.is_null() {
            StrongWrapper::try_with_payload_ptr(ctx.cast(), |session| {
                QuicSession::on_new_stream(session, &Stream::from_raw(s))
            });
        }
        lsquic::lsquic_stream_get_ctx(s)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamRead(_: *mut lsquic_stream, ctx: *mut c_void) {
    // SAFETY: the ctx of the stream.
    unsafe { with_ctx(ctx, QuicStream::on_stream_read) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamWrite(_: *mut lsquic_stream, ctx: *mut c_void) {
    // SAFETY: as above.
    unsafe { with_ctx(ctx, QuicStream::on_stream_write) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamReset(
    _: *mut lsquic_stream,
    ctx: *mut c_void,
    how: c_int,
) {
    // SAFETY: as above.
    unsafe { with_ctx(ctx, |stream: &QuicStream| stream.on_stream_reset(how)) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamClose(_: *mut lsquic_stream, ctx: *mut c_void) {
    // SAFETY: as above.
    unsafe {
        with_ctx(ctx, |stream: &QuicStream| {
            stream.unbind();
            stream.on_stream_close();
        })
    };
}
