//! The lsquic engine and its callbacks (`packages/bun-usockets/src/node_quic_shim.c` lists them).

use core::cell::Cell;
use core::ffi::{CStr, c_char, c_int, c_uint, c_void};
use core::ptr::{NonNull, null, null_mut};

use bun_core::ffi::slice;
use bun_jsc::bindgen::{JsPayload, StrongWrapper};
use bun_lsquic_sys::{self as lsquic, Conn, Stream, lsquic_conn, lsquic_stream};
use bun_ptr::AliasableBox;

use crate::test_runner::cells::CellExt as _;

use super::endpoint::match_sni;
use super::roots::Root;
use super::session::StoredAddr;
use super::tls::TlsContext;
use super::{QuicEndpoint, QuicSession, QuicStream};

/// What lsquic keeps pointers to: the context of the engine's callbacks, and the `peer_ctx` of its paths.
struct Shared {
    /// Null unless a call that borrows it is on the stack.
    endpoint: Cell<*const QuicEndpoint>,
    tls: Cell<Option<TlsContext>>,
    origin_blob: Vec<u8>,
}

/// What can call back takes `&mut self`, so a callback can't run or destroy the engine it came from.
pub(super) struct Engine {
    raw: NonNull<lsquic::lsquic_engine>,
    shared: AliasableBox<Shared>,
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
            // SAFETY: pure library init.
            unsafe {
                lsquic::lsquic_global_init(
                    lsquic::LSQUIC_GLOBAL_CLIENT | lsquic::LSQUIC_GLOBAL_SERVER,
                )
            };
            if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_lsquic")).is_some() {
                // SAFETY: static C string.
                unsafe { lsquic::us_nq_enable_logging(c"debug".as_ptr()) };
            }
        });
        lsquic::debug_assert_layout();

        let shared = AliasableBox::new(Shared {
            endpoint: Cell::new(null()),
            tls: Cell::new(Some(tls)),
            origin_blob,
        });
        // SAFETY: `shared` is dropped after the engine is destroyed. lsquic copies `settings`.
        let raw = unsafe {
            lsquic::us_nq_engine_new(
                is_server as c_int,
                is_http as c_int,
                shared.as_ptr().cast(),
                settings.as_mut_ptr(),
                shared.origin_blob.as_ptr(),
                shared.origin_blob.len(),
            )
        };
        Some(Self {
            raw: NonNull::new(raw)?,
            shared,
        })
    }

    fn lend_endpoint(&mut self, endpoint: &QuicEndpoint, call: impl FnOnce(&Self)) {
        self.shared.endpoint.set(endpoint);
        call(self);
        self.shared.endpoint.set(null());
    }

    pub(super) fn packet_in(
        &mut self,
        endpoint: &QuicEndpoint,
        packet: &[u8],
        local: &StoredAddr,
        peer: &StoredAddr,
    ) {
        self.lend_endpoint(endpoint, |this| {
            // SAFETY: the engine is live and not running. It copies what it keeps, except `shared`.
            unsafe {
                lsquic::lsquic_engine_packet_in(
                    this.raw.as_ptr(),
                    packet.as_ptr(),
                    packet.len(),
                    local.as_ptr(),
                    peer.as_ptr(),
                    this.shared.as_ptr().cast(),
                    0,
                )
            };
        });
    }

    pub(super) fn process_conns(&mut self, endpoint: &QuicEndpoint) {
        self.lend_endpoint(endpoint, |this| {
            // SAFETY: the engine is live and not running.
            unsafe { lsquic::lsquic_engine_process_conns(this.raw.as_ptr()) }
        });
    }

    pub(super) fn send_unsent_packets(&mut self, endpoint: &QuicEndpoint) {
        self.lend_endpoint(endpoint, |this| {
            // SAFETY: as above.
            unsafe { lsquic::lsquic_engine_send_unsent_packets(this.raw.as_ptr()) }
        });
    }

    /// For the conns to come. An `SSL` holds a reference to its `SSL_CTX`, which is all that a client's needs.
    pub(super) fn set_client_tls(&mut self, tls: TlsContext) {
        let old = self.shared.tls.take();
        assert!(!old.as_ref().is_some_and(TlsContext::selects_alpn));
        self.shared.tls.set(Some(tls));
    }

    /// Binds the new conn to `session`, unless lsquic refused.
    pub(super) fn connect(
        &mut self,
        session: &Attached<QuicSession>,
        local: &StoredAddr,
        peer: &StoredAddr,
        servername: Option<&CStr>,
        resume: &[u8],
    ) {
        // SAFETY: as in `packet_in`. The result is null or live, and is only used here.
        let conn = unsafe {
            Conn::lent(lsquic::lsquic_engine_connect(
                self.raw.as_ptr(),
                lsquic::N_LSQVER,
                local.as_ptr(),
                peer.as_ptr(),
                self.shared.as_ptr().cast(),
                null_mut(),
                servername.map_or(null(), CStr::as_ptr),
                0,
                if resume.is_empty() {
                    null()
                } else {
                    resume.as_ptr()
                },
                resume.len(),
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
        let Some(conn) = conn.as_ptr() else { return };
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

    /// The stateless resets that were sent, and those that the rate limit held back.
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

/// Empty while its engine is in use.
#[derive(Default)]
pub(super) struct EngineSlot(Cell<Option<Engine>>);

impl EngineSlot {
    pub(super) fn set(&self, engine: Option<Engine>) {
        self.0.set(engine);
    }

    pub(super) fn is_some(&self) -> bool {
        self.with(|_| ()).is_some()
    }

    pub(super) fn with<R>(&self, f: impl FnOnce(&mut Engine) -> R) -> Option<R> {
        self.0.with_taken(|engine| engine.as_mut().map(f))
    }
}

pub(super) trait Detach: JsPayload {
    fn detach(&self);
}

/// The root of what lsquic can have as a context, which it takes back before it lets go.
pub(super) struct Attached<T: Detach>(StrongWrapper<T>);

impl<T: Detach> Attached<T> {
    pub(super) fn new(root: StrongWrapper<T>) -> Self {
        Self(root)
    }
}

impl<T: Detach> Root for Attached<T> {
    type Payload = T;
    fn wrapper(&self) -> &StrongWrapper<T> {
        &self.0
    }
}

impl<T: Detach> Drop for Attached<T> {
    fn drop(&mut self) {
        self.0.lend(|attached| attached.detach());
    }
}

impl Detach for QuicSession {
    fn detach(&self) {
        self.conn.detach();
    }
}

impl Attached<QuicSession> {
    pub(super) fn bind(&self, conn: &Conn) {
        self.0.lend(|session| {
            let ctx = core::ptr::from_ref(session.payload()).cast_mut().cast();
            // SAFETY: `onConnClosed` detaches `session.conn` and lends no `Conn`. `self` roots the
            // session until it detaches. The teardown of the VM ignores roots, and then the slot
            // detaches when the session is dropped.
            unsafe { session.conn.bind(conn, ctx) }
        });
    }
}

impl Detach for QuicStream {
    fn detach(&self) {
        self.raw.detach();
    }
}

impl Attached<QuicStream> {
    pub(super) fn bind(&self, stream: &Stream) {
        self.0.lend(|attached| {
            let ctx = core::ptr::from_ref(attached.payload()).cast_mut().cast();
            // SAFETY: as for a session, with `onStreamClose`.
            unsafe { attached.raw.bind(stream, ctx) }
        });
    }
}

/// # Safety
/// `ctx` is null or was given to lsquic by `Attached::<T>::bind`, and lsquic still has it.
unsafe fn with_ctx<T: Detach, R>(ctx: *mut c_void, f: impl FnOnce(&T) -> R) -> Option<R> {
    // SAFETY: not dropped yet, see `bind`.
    let result = f(unsafe { ctx.cast::<T>().as_ref() }?);
    // The collector sees the wrapper up to here, even if `f` dropped the root.
    core::hint::black_box(ctx);
    Some(result)
}

/// # Safety
/// `ctx` is the context or the `peer_ctx` of an engine that is calling back.
unsafe fn with_endpoint<R>(ctx: *mut c_void, f: impl FnOnce(&QuicEndpoint) -> R) -> Option<R> {
    // SAFETY: `Shared` outlives its engine, and `endpoint` is borrowed further up the stack.
    unsafe { (*ctx.cast::<Shared>()).endpoint.get().as_ref() }.map(f)
}

/// The local address and the peer's.
pub(super) fn addresses(conn: &Conn) -> Option<(StoredAddr, StoredAddr)> {
    let (mut local, mut peer) = (null(), null());
    // SAFETY: the conn is live. On success both point into its `network_path`, where each has the
    // size of a `sockaddr_in6` and is aligned for one.
    unsafe {
        (lsquic::lsquic_conn_get_sockaddr(conn.as_ptr()?, &raw mut local, &raw mut peer) == 0)
            .then(|| (*local.cast(), *peer.cast()))
    }
}

/// `struct lsquic_out_spec`. Only lsquic makes one, and it lends it with what it points to.
#[repr(C)]
pub(super) struct OutSpec<'a> {
    iov: *const lsquic::iovec,
    iovlen: usize,
    pub(super) local: &'a StoredAddr,
    pub(super) dest: &'a StoredAddr,
    _peer_ctx: *mut c_void,
    _conn_ctx: *mut c_void,
    _ecn: c_int,
}

// node_quic_shim.c asserts the same numbers.
bun_opaque::assert_ffi_layout!(OutSpec<'static>, 56, 8; iov @ 0, iovlen @ 8, local @ 16, dest @ 24);

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
    // SAFETY: lsquic lends `count` specs for this call. The addresses are as in `addresses`.
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
    // SAFETY: the context or the `peer_ctx` of the engine. lsquic takes a reference to the result
    // before it calls back again.
    let shared = unsafe { &*ctx.cast::<Shared>() };
    (shared.tls).with_taken(|tls| tls.as_ref().map_or(null_mut(), TlsContext::raw))
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__lookupCert(
    ctx: *mut c_void,
    local: *const c_void,
    servername: *const c_char,
) -> *mut bun_boringssl_sys::SSL_CTX {
    // SAFETY: lsquic lends a C string or null. It takes a reference to the result before it calls
    // back again. BoringSSL selects the ALPN, which reads the `TlsContext`, in the same step.
    unsafe {
        if !servername.is_null() {
            let host = CStr::from_ptr(servername).to_bytes();
            let found = with_endpoint(ctx, |e| {
                (e.sni_contexts).with_taken(|entries| match_sni(entries, host).map(TlsContext::raw))
            });
            if let Some(Some(found)) = found {
                return found;
            }
        }
        Bun__nodeQuic__getSslCtx(ctx, local)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onMiniConnFailed(
    ctx: *mut c_void,
    peer: &StoredAddr,
    error_code: u64,
) {
    // SAFETY: the context of the engine.
    unsafe { with_endpoint(ctx, |e| e.on_mini_conn_failed(peer, error_code)) };
}

/// The conn of `connect` has no endpoint to go to: `connect` binds it.
#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onNewConn(
    ctx: *mut c_void,
    c: *mut lsquic_conn,
) -> *mut c_void {
    // SAFETY: lsquic lends the conn for this call, in which its engine can't run.
    unsafe {
        with_endpoint(ctx, |e| e.on_new_conn(&Conn::lent(c)));
        lsquic::lsquic_conn_get_ctx(c)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onConnClosed(c: *mut lsquic_conn) {
    // SAFETY: lsquic lends the conn for this call.
    unsafe {
        with_ctx(lsquic::lsquic_conn_get_ctx(c), |session: &QuicSession| {
            let status = session.conn.status();
            session.detach();
            session.on_conn_closed(status);
        })
    };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onDatagramWrite(
    c: *mut lsquic_conn,
    buf: *mut u8,
    room: usize,
) -> isize {
    // SAFETY: lsquic lends the conn, and `room` bytes at `buf`, for this call.
    unsafe {
        let ctx = lsquic::lsquic_conn_get_ctx(c);
        match with_ctx(ctx, |session: &QuicSession| session.next_datagram(room)) {
            Some(Some(payload)) if payload.len() <= room => {
                buf.copy_from_nonoverlapping(payload.as_ptr(), payload.len());
                payload.len() as isize
            }
            // lsquic frames any value >= 0, so 0 would put an empty DATAGRAM frame on the wire.
            _ => -1,
        }
    }
}

macro_rules! session_callbacks {
    ($($symbol:ident($($arg:ident: $Arg:ty),*) => $method:ident($($value:expr),*);)+) => {$(
        #[unsafe(no_mangle)]
        unsafe extern "C" fn $symbol(c: *mut lsquic_conn, $($arg: $Arg),*) {
            // SAFETY: lsquic lends the conn, and `len` bytes at `data`, for this call. The
            // addresses are as in `addresses`.
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
        preferred: c_int,
        new_local: &StoredAddr,
        new_peer: &StoredAddr,
        old_local: &StoredAddr,
        old_peer: &StoredAddr
    ) => on_path_switch(validated != 0, preferred != 0, [*new_local, *new_peer, *old_local, *old_peer]);
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
        if let Some((_, peer)) = addresses(&Conn::lent(c)) {
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
    // SAFETY: lsquic lends the stream and its conn for this call, in which their engine can't run.
    // An `Attached` names the session.
    unsafe {
        let ctx = lsquic::lsquic_conn_get_ctx(lsquic::lsquic_stream_conn(s));
        if !ctx.is_null() {
            StrongWrapper::lend_payload(ctx.cast(), |session| {
                QuicSession::on_new_stream(session, &Stream::lent(s))
            });
        }
        lsquic::lsquic_stream_get_ctx(s)
    }
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamRead(_: *mut lsquic_stream, ctx: *mut c_void) {
    // SAFETY: the context of the stream.
    unsafe { with_ctx(ctx, QuicStream::on_read) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamWrite(_: *mut lsquic_stream, ctx: *mut c_void) {
    // SAFETY: as above.
    unsafe { with_ctx(ctx, QuicStream::on_write) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamReset(
    _: *mut lsquic_stream,
    ctx: *mut c_void,
    how: c_int,
) {
    // SAFETY: as above.
    unsafe { with_ctx(ctx, |stream: &QuicStream| stream.on_reset(how)) };
}

#[unsafe(no_mangle)]
unsafe extern "C" fn Bun__nodeQuic__onStreamClose(_: *mut lsquic_stream, ctx: *mut c_void) {
    // SAFETY: as above.
    unsafe {
        with_ctx(ctx, |stream: &QuicStream| {
            stream.detach();
            stream.on_close();
        })
    };
}
