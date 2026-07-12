//! Per-socket TLS engine: SSL* + a per-socket custom BIO pair; the growable
//! ciphertext buffers (batch + the single spill slot) and the fatal-reason
//! scratch are loop-shared, O(1) per loop (docs/design.md §TLS buffer ownership), owned by a
//! generation-checked `SocketRef` (stale ⇒ dropped, never dangles).
//! Handshake / read / write / shutdown machines per docs/tls.md §2-§5.
//! Batch thresholds ported verbatim: 16 KiB records, 128 KiB flush.

use core::ptr::NonNull;

use crate::dispatch::{
    dispatch_data, dispatch_handshake, dispatch_keylog, dispatch_session, dispatch_ssl_raw_tap,
    dispatch_writable,
};
use crate::handle::{CloseCode, SocketRef};
use crate::kind::SocketKind;
use crate::loop_::Loop;
use crate::socket::{SocketFlags, SocketHeader};
use crate::tls::SSL;
use crate::tls::context::{SslCtx, us_bun_verify_error_t};
use crate::unsafe_core::bssl;
use crate::unsafe_core::deref;
use crate::unsafe_core::ext::deref_mut;
use crate::unsafe_core::ffi::{self, SslErr};
use crate::{LIBUS_RECV_BUFFER_LENGTH, LIBUS_RECV_BUFFER_PADDING};

/// One TLS record of plaintext per SSL_write call (docs/tls.md §4).
const TLS_RECORD_CHUNK: usize = 16384;
/// Flush the batched ciphertext to the wire every this many bytes.
const TLS_BATCH_FLUSH: usize = 131072;
/// `ERR_error_string_n` scratch.
use crate::tls::context::US_SSL_FATAL_ERROR_REASON_MAX as TLS_FATAL_REASON_MAX;
/// C7: the C surface took `int` lengths; clamp so the return can never wrap.
const MAX_WRITE_LEN: usize = i32::MAX as usize;

/// Handshake progression (docs/tls.md §2). `on_handshake(success,
/// verify_error)` is ALWAYS delivered — verify decisions belong to the
/// consumer (contract C11).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum HandshakeState {
    Pending,
    Completed,
    RenegotiationPending,
}

/// BIO-shared control block, boxed separately from `TlsState` so the BIO
/// callbacks (unsafe_core::ffi) and re-entrant close paths can reach it
/// without aliasing a live `&mut TlsState`. All access outside the BIO
/// callbacks goes through `ffi::with_ctl` (scoped, never held across a call
/// into BoringSSL or a dispatch).
pub(crate) struct BioCtl {
    /// Slab-resident owner; never moves while the loop lives.
    pub(crate) s: *mut SocketHeader,
    /// Loop-shared engine buffers; outlives every socket on the loop.
    pub(crate) shared: *mut LoopTlsShared,
    /// Borrowed ciphertext window (read BIO input). Valid only while the
    /// caller's buffer is; `read_len` is the REMAINING byte count.
    pub(crate) read_ptr: *const u8,
    pub(crate) read_len: usize,
    pub(crate) read_off: usize,
    /// `ssl_in_use` bracket around SSL_read/SSL_do_handshake (§1.4).
    pub(crate) in_use: bool,
    /// A callback destroyed the socket mid-SSL-call; BIO write swallows
    /// output and the driver's epilogue performs the deferred close.
    pub(crate) pending_detach: bool,
    pub(crate) pending_close_code: i32,
    /// `ssl_fatal_error` bit; set by BIO alloc failure and SSL/SYSCALL errors.
    pub(crate) fatal: bool,
}

/// Saved read-window snapshot for the §1.4 save/restore protocol around JS
/// dispatched from inside `SSL_read` (always via the `WindowGuard` RAII).
#[derive(Copy, Clone)]
struct WindowSave {
    ptr: *const u8,
    len: usize,
    off: usize,
}

impl BioCtl {
    fn new(s: *mut SocketHeader, shared: *mut LoopTlsShared) -> BioCtl {
        BioCtl {
            s,
            shared,
            read_ptr: core::ptr::null(),
            read_len: 0,
            read_off: 0,
            in_use: false,
            pending_detach: false,
            pending_close_code: 0,
            fatal: false,
        }
    }

    /// Generation-stamped identity of the owning socket (spill/fatal-reason
    /// ownership key). `s` is live for the whole BioCtl lifetime (C6).
    fn me(&self) -> SocketRef {
        SocketRef::from_live(NonNull::new(self.s).expect("BioCtl.s is live"))
    }

    pub(crate) fn set_window(&mut self, data: &[u8]) {
        self.read_ptr = data.as_ptr();
        self.read_len = data.len();
        self.read_off = 0;
    }

    pub(crate) fn clear_window(&mut self) {
        self.read_ptr = core::ptr::null();
        self.read_len = 0;
        self.read_off = 0;
    }

    fn save_window(&self) -> WindowSave {
        WindowSave {
            ptr: self.read_ptr,
            len: self.read_len,
            off: self.read_off,
        }
    }

    fn restore_window(&mut self, w: WindowSave) {
        self.read_ptr = w.ptr;
        self.read_len = w.len;
        self.read_off = w.off;
    }

    pub(crate) fn window_remaining(&self) -> usize {
        self.read_len
    }

    /// This socket's spilled-ciphertext byte count (0 when the loop slot is
    /// free, stale, or owned by another socket).
    fn spill_len(&mut self) -> usize {
        let me = self.me();
        ffi::with_shared(self.shared, |sh| sh.spill_remaining(me))
    }

    /// Drain this socket's spill to the wire in order. True = fully drained,
    /// empty, or not ours (C `ssl_drain_spill`, openssl.c:602-617).
    pub(crate) fn flush_pending(&mut self) -> bool {
        let (s, me) = (self.s, self.me());
        ffi::with_shared(self.shared, |sh| sh.drain_spill(s, me))
    }

    /// Teardown: one last drain attempt, then drop whatever remains of this
    /// socket's spill (C `ssl_release_spill`, openssl.c:620-634).
    pub(crate) fn release_pending(&mut self) {
        let (s, me) = (self.s, self.me());
        ffi::with_shared(self.shared, |sh| sh.release_spill(s, me));
    }

    /// Batching is allowed only while no socket's spill occupies the loop
    /// slot (§4.4); a stale owner is dropped here, never dangles.
    fn spill_slot_free(&mut self) -> bool {
        let me = self.me();
        ffi::with_shared(self.shared, |sh| {
            let _ = sh.spill_remaining(me);
            sh.spill_owner.is_none()
        })
    }

    fn set_batching(&mut self, batching: bool) {
        ffi::with_shared(self.shared, |sh| sh.batching = batching);
    }

    fn batch_len(&self) -> usize {
        ffi::with_shared(self.shared, |sh| sh.batch.len())
    }

    /// Flush the loop batch buffer; a partial write parks the remainder as
    /// this socket's spill. True = wire took everything.
    fn flush_batch(&mut self) -> bool {
        let (s, me) = (self.s, self.me());
        match ffi::with_shared(self.shared, |sh| sh.flush_batch(s, me)) {
            FlushOutcome::Drained => true,
            FlushOutcome::Blocked => false,
            FlushOutcome::Oom => {
                // Records already sequenced; the connection cannot stay
                // coherent (§1.3.2).
                self.fatal = true;
                false
            }
        }
    }

    fn park_fatal_reason(&mut self, reason: &[u8; TLS_FATAL_REASON_MAX]) {
        let me = self.me();
        ffi::with_shared(self.shared, |sh| {
            sh.fatal_reason = *reason;
            sh.fatal_reason_owner = Some(me);
        });
    }

    /// Claim this socket's parked reason (owner check mandatory — §3.4); a
    /// stale owner's reason is dropped.
    fn take_fatal_reason(&mut self) -> Option<[u8; TLS_FATAL_REASON_MAX]> {
        let me = self.me();
        ffi::with_shared(self.shared, |sh| match sh.fatal_reason_owner {
            Some(o) if o == me => {
                sh.fatal_reason_owner = None;
                Some(sh.fatal_reason)
            }
            Some(o) if o.resolve().is_none() => {
                sh.fatal_reason_owner = None;
                None
            }
            _ => None,
        })
    }
}

/// RAII §1.4 save/restore: restores the saved read window on drop, so a JS
/// dispatch that re-enters TLS on this socket (`write` zeroes the window)
/// cannot leave the outer SSL_read loop with a clobbered window.
struct WindowGuard {
    ctl: *mut BioCtl,
    saved: WindowSave,
}

impl WindowGuard {
    fn save(ctl: *mut BioCtl) -> WindowGuard {
        WindowGuard {
            ctl,
            saved: ffi::with_ctl(ctl, |c| c.save_window()),
        }
    }
}

impl Drop for WindowGuard {
    fn drop(&mut self) {
        ffi::with_ctl(self.ctl, |c| c.restore_window(self.saved));
    }
}

/// Consumer-facing §1.4 save/restore keyed by the SSL handle: brackets user
/// JS run from inside SSL_do_handshake/SSL_read (ALPN/SNI callbacks) so a
/// same-socket re-entrant write cannot clobber the ciphertext read window.
pub struct SslWindowGuard {
    _saved: Option<WindowGuard>,
}

impl SslWindowGuard {
    pub fn save(ssl: *mut SSL) -> SslWindowGuard {
        let ctl = if ssl.is_null() {
            core::ptr::null_mut()
        } else {
            ffi::ssl_wbio_ctl(ssl)
        };
        SslWindowGuard {
            _saved: (!ctl.is_null()).then(|| WindowGuard::save(ctl)),
        }
    }
}

enum FlushOutcome {
    Drained,
    Blocked,
    Oom,
}

/// Loop-shared TLS engine state (C `loop_ssl_data`, docs/tls.md §1.2):
/// the ciphertext batch buffer, the SINGLE spill slot, the parked
/// fatal-reason scratch and the plaintext read scratch — O(1) memory per
/// loop (docs/design.md §TLS buffer ownership). Owned by the loop via `ssl_data`.
pub(crate) struct LoopTlsShared {
    /// Plaintext read scratch slot; `Option::take` semantics via LoopScratch.
    pub(crate) scratch: *mut core::ffi::c_void,
    /// True only inside `TlsState::write`'s record loop (docs/tls.md §4).
    pub(crate) batching: bool,
    /// Sealed records batched this write call; already counted written.
    pub(crate) batch: Vec<u8>,
    spill: Vec<u8>,
    spill_off: usize,
    /// Generation-checked spill owner: stale ⇒ dropped, never dangles.
    spill_owner: Option<SocketRef>,
    fatal_reason: [u8; TLS_FATAL_REASON_MAX],
    fatal_reason_owner: Option<SocketRef>,
}

impl LoopTlsShared {
    pub(crate) fn new() -> LoopTlsShared {
        LoopTlsShared {
            scratch: core::ptr::null_mut(),
            batching: false,
            batch: Vec::new(),
            spill: Vec::new(),
            spill_off: 0,
            spill_owner: None,
            fatal_reason: [0; TLS_FATAL_REASON_MAX],
            fatal_reason_owner: None,
        }
    }

    /// True iff the slot holds `me`'s spill; drops a stale owner's spill.
    fn spill_is(&mut self, me: SocketRef) -> bool {
        match self.spill_owner {
            None => false,
            Some(o) if o == me => true,
            Some(o) => {
                if o.resolve().is_none() {
                    self.clear_spill();
                }
                false
            }
        }
    }

    fn clear_spill(&mut self) {
        self.spill = Vec::new();
        self.spill_off = 0;
        self.spill_owner = None;
    }

    fn spill_remaining(&mut self, me: SocketRef) -> usize {
        if self.spill_is(me) {
            self.spill.len() - self.spill_off
        } else {
            0
        }
    }

    fn drain_spill(&mut self, s: *mut SocketHeader, me: SocketRef) -> bool {
        if !self.spill_is(me) {
            return true;
        }
        while self.spill_off < self.spill.len() {
            let n = crate::write::raw_write(s, &self.spill[self.spill_off..]);
            if n <= 0 {
                return false;
            }
            self.spill_off += n as usize;
        }
        self.clear_spill();
        true
    }

    fn release_spill(&mut self, s: *mut SocketHeader, me: SocketRef) {
        if self.spill_is(me) {
            let _ = self.drain_spill(s, me);
            self.clear_spill();
        }
    }

    /// One raw write of the whole batch; a partial write parks the remainder
    /// as `me`'s spill (C `ssl_flush_write_batch`, openssl.c:575-598). The
    /// batch keeps its capacity — loop-level O(1).
    fn flush_batch(&mut self, s: *mut SocketHeader, me: SocketRef) -> FlushOutcome {
        let mut off = 0usize;
        while off < self.batch.len() {
            let n = crate::write::raw_write(s, &self.batch[off..]);
            if n <= 0 {
                break;
            }
            off += n as usize;
        }
        if off < self.batch.len() {
            let rest = &self.batch[off..];
            let mut spill = Vec::new();
            if spill.try_reserve(rest.len()).is_err() {
                self.batch.clear();
                return FlushOutcome::Oom;
            }
            spill.extend_from_slice(rest);
            self.spill = spill;
            self.spill_off = 0;
            self.spill_owner = Some(me);
            self.batch.clear();
            return FlushOutcome::Blocked;
        }
        self.batch.clear();
        FlushOutcome::Drained
    }
}

impl Drop for LoopTlsShared {
    fn drop(&mut self) {
        if !self.scratch.is_null() {
            ffi::scratch_free(self.scratch);
            self.scratch = core::ptr::null_mut();
        }
    }
}

/// Per-socket TLS state, boxed off the `SocketHeader` transport slot.
/// Lifetime contract (mirrors C6): the owning `Transport::Tls(Box)` must stay
/// in place until the tick postlude even after detach — `detach` nulls `ssl`
/// and callers re-check `gone` instead of freeing mid-callback.
pub struct TlsState {
    /// Live BoringSSL handle; nulled by `detach`, freed exactly once.
    pub(crate) ssl: *mut SSL,
    /// BIO control block; owned (freed in Drop), shared with the BIO hooks.
    pub(crate) ctl: *mut BioCtl,
    pub(crate) handshake_state: HandshakeState,
    /// True once on_handshake has been dispatched (JSHS distinguishes
    /// "finished" from "callback fired"); reset when renegotiation begins.
    pub(crate) handshake_callback_fired: bool,
    /// Tee inbound ciphertext to dispatch_ssl_raw_tap before SSL_read.
    pub(crate) raw_tap: bool,
    pub(crate) is_server: bool,
    /// SSL_write starved for handshake input; next read re-fires writable.
    write_wants_read: bool,
    /// SSL_read starved for wire capacity; next writable re-enters the read.
    read_wants_write: bool,
    shutdown_after_spill: bool,
    close_after_spill: bool,
}

impl Drop for TlsState {
    fn drop(&mut self) {
        if !self.ssl.is_null() {
            ffi::ssl_free(self.ssl);
            self.ssl = core::ptr::null_mut();
        }
        if !self.ctl.is_null() {
            ffi::ctl_free(self.ctl);
            self.ctl = core::ptr::null_mut();
        }
    }
}

/// Session/keylog parking opt-in marker (bssl `is_socket` ex_data — the CTX
/// new-session/keylog callbacks only park for marked SSLs; §2.1/§2.7).
fn mark_socket(ssl: *mut SSL) {
    bssl::ssl_set_ex_data(
        ssl,
        bssl::ex_indices().is_socket,
        1usize as *mut core::ffi::c_void,
    );
}

/// Fresh short-lived `TlsState` borrow per access cluster (C17): must end
/// before any dispatch, close, or SSL call that can re-enter this socket.
fn t<'a>(this: *mut TlsState) -> &'a mut TlsState {
    deref_mut(this)
}

/// `us_socket_sni_resolve` (docs/tls.md §2.6, openssl.c:2186-2219): resume
/// a handshake suspended by an async SNI callback. Consumes the owned `ctx`
/// ref; no-op when the socket died or the handshake is not suspended.
pub(crate) fn sni_resolve(
    this: *mut TlsState,
    s: *mut SocketHeader,
    ctx: *mut SslCtx,
    error: bool,
) {
    let ssl = t(this).ssl;
    if ssl.is_null() || deref::with_socket(s, |h| h.is_closed()) || !bssl::sni_is_waiting(ssl) {
        // Late/duplicate resolution: release the handed-in reference.
        if !ctx.is_null() {
            crate::tls::context::ssl_ctx_unref(ctx);
        }
        return;
    }
    if error {
        if !ctx.is_null() {
            crate::tls::context::ssl_ctx_unref(ctx);
        }
        bssl::sni_set(ssl, bssl::SniSuspension::Error);
        // Alert-free drop (Node SNICallback-error behavior): mark the deferred
        // detach BEFORE re-driving so the BIO swallows the handshake_failure
        // alert and the driver epilogue closes the socket.
        ffi::with_ctl(t(this).ctl, |c| {
            c.pending_detach = true;
            c.pending_close_code = 0;
        });
    } else {
        // Stash the owned ref (null = static tree / default ctx); the
        // select-cert re-fire consumes it.
        bssl::sni_set(ssl, bssl::SniSuspension::Resolved(ctx));
    }
    TlsState::handshake(this, s);
}

impl TlsState {
    /// Attach a fresh SSL to a connected socket (server accept / adopt_tls /
    /// start_tls). Does not kick the handshake (C10).
    pub(crate) fn attach(
        s: *mut SocketHeader,
        ssl_ctx: *mut super::context::SslCtx,
        is_client: bool,
        sni: Option<&core::ffi::CStr>,
    ) -> Box<TlsState> {
        let shared = ffi::tls_shared_ptr(crate::socket::socket_loop(s));
        let ctl = Box::into_raw(Box::new(BioCtl::new(s, shared)));
        let ssl = ffi::ssl_new_attached(ssl_ctx, ctl);

        let state = Box::new(TlsState {
            ssl,
            ctl,
            handshake_state: HandshakeState::Pending,
            handshake_callback_fired: false,
            raw_tap: false,
            is_server: !is_client,
            write_wants_read: false,
            read_wants_write: false,
            shutdown_after_spill: false,
            close_after_spill: false,
        });

        if ssl.is_null() {
            // SSL_new failed (OOM): behave like an immediately-fatal socket.
            ffi::with_ctl(ctl, |c| c.fatal = true);
            return state;
        }

        if is_client {
            ffi::ssl_set_connect_state(ssl);
            // Bounded renegotiation (Node CLIENT_RENEG_LIMIT — issues #6197/#5363).
            ffi::ssl_set_reneg_mode(ssl, true);
            if let Some(name) = sni {
                ffi::ssl_set_tlsext_host_name(ssl, name);
            }
            // Verification is per-SSL, never per-CTX: a SecureContext is
            // mode-neutral (docs/tls.md §2.1).
            if bssl::ctx_get_verify_mode(ssl_ctx) == bssl::SSL_VERIFY_NONE {
                ffi::ssl_set_verify_permissive(ssl);
                let user_ca =
                    !bssl::ctx_get_ex_data(ssl_ctx, bssl::ex_indices().ctx_user_ca).is_null();
                if !user_ca {
                    let store = bssl::shared_default_ca_store();
                    if !store.is_null() {
                        // shared store returns an owned ref; set0 consumes it.
                        ffi::ssl_set0_verify_cert_store(ssl, store);
                    }
                }
            }
        } else {
            ffi::ssl_set_accept_state(ssl);
            // Server renegotiation is a DoS vector: never.
            ffi::ssl_set_reneg_mode(ssl, false);
        }

        // node:tls sockets park sessions/keylog; accepted sockets get their
        // kind stamped later — read() re-checks lazily (§2.1).
        if deref::with_socket(s, |h| h.kind()) == SocketKind::BunSocketTls {
            mark_socket(ssl);
        }
        state
    }

    // ── state predicates ────────────────────────────────────────────────────

    /// `ssl_gone`: a re-entrant close ran inside a dispatch.
    fn gone(&self, s: *mut SocketHeader) -> bool {
        self.ssl.is_null() || deref::with_socket(s, |h| h.is_closed())
    }

    /// `us_internal_ssl_is_shut_down`: FIN sent ∨ no ssl ∨ SENT_SHUTDOWN ∨ fatal.
    /// Probes only the raw FIN bit (C POLL_TYPE_SOCKET_SHUT_DOWN) — routing
    /// through the TLS-aware header query would re-borrow this `TlsState`.
    pub(crate) fn is_shut_down(&self, s: *mut SocketHeader) -> bool {
        if self.ssl.is_null() || ffi::with_ctl(self.ctl, |c| c.fatal) {
            return true;
        }
        if deref::with_socket(s, |h| h.is_shut_down_raw()) {
            return true;
        }
        ffi::ssl_get_shutdown(self.ssl).0
    }

    /// Mid-handshake sockets are throttled by the loop (docs/tls.md §3.5).
    pub(crate) fn is_low_prio(&self) -> bool {
        !self.ssl.is_null() && ffi::ssl_in_init(self.ssl)
    }

    /// Close arrived from inside SSL_read/SSL_do_handshake (§1.4): release
    /// the spill now and defer the close to the driver's epilogue. Returns
    /// true when deferred (caller must NOT proceed with teardown).
    pub(crate) fn request_defer_close(&mut self, code: CloseCode) -> bool {
        ffi::with_ctl(self.ctl, |c| {
            if !c.in_use {
                return false;
            }
            c.release_pending();
            c.pending_detach = true;
            c.pending_close_code = code as i32;
            true
        })
    }

    /// FAST_SHUTDOWN close with spilled ciphertext still pending: defer the
    /// close (at most once) until the spill drains (docs/tls.md §5.2).
    pub(crate) fn close_deferred_by_spill(&mut self, s: *mut SocketHeader) -> bool {
        if self.close_after_spill
            || ffi::with_ctl(self.ctl, |c| c.fatal)
            || deref::with_socket(s, |h| h.is_closed())
        {
            return false;
        }
        if ffi::with_ctl(self.ctl, |c| c.flush_pending()) {
            return false;
        }
        self.close_after_spill = true;
        true
    }

    /// Free the SSL after on_close (error/RST teardowns come here without a
    /// TLS close). Honors the in-use deferral; keeps `self` allocated (C6).
    pub(crate) fn detach(&mut self) {
        let deferred = ffi::with_ctl(self.ctl, |c| {
            c.release_pending();
            if c.in_use {
                c.pending_detach = true;
                true
            } else {
                false
            }
        });
        if deferred {
            return;
        }
        if !self.ssl.is_null() {
            ffi::ssl_free(self.ssl);
            self.ssl = core::ptr::null_mut();
        }
        // C parity: handshake_callback_has_fired reads `s->ssl && ...` — it
        // reports 0 once the SSL is gone (openssl.c:2033-2035).
        self.handshake_callback_fired = false;
        // An unclaimed parked reason dies with its owner (§3.4).
        ffi::with_ctl(self.ctl, |c| {
            let _ = c.take_fatal_reason();
        });
    }

    // ── on_handshake firing (exactly once per handshake; §2.3) ──────────────

    fn park_fatal_reason(&mut self) {
        // Only park while the handshake is unfinished: the handshake-failure
        // dispatch is the sole consumer (§3.4).
        if self.handshake_state != HandshakeState::Completed {
            let e = bssl::err_peek_last_error();
            if e != 0 {
                let mut buf = [0u8; TLS_FATAL_REASON_MAX];
                bssl::err_error_string(e, &mut buf[..]);
                ffi::with_ctl(self.ctl, |c| c.park_fatal_reason(&buf));
            }
        }
        bssl::err_clear_error();
        ffi::with_ctl(self.ctl, |c| c.fatal = true);
    }

    fn verify_error_for(&self, s: *mut SocketHeader) -> us_bun_verify_error_t {
        if self.ssl.is_null() || deref::with_socket(s, |h| h.is_closed()) || self.is_shut_down(s) {
            return us_bun_verify_error_t::default();
        }
        self.verify_error()
    }

    fn trigger_handshake(this: *mut TlsState, s: *mut SocketHeader, success: bool) {
        t(this).handshake_state = HandshakeState::Completed;
        t(this).handshake_callback_fired = true;
        if !success {
            // Copied to the stack and un-parked BEFORE any JS runs (§3.4).
            if let Some(reason) = ffi::with_ctl(t(this).ctl, |c| c.take_fatal_reason()) {
                // Fatal protocol error recorded just before this failure:
                // report it instead of the X509 verdict (Node tlsClientError).
                let err = us_bun_verify_error_t::eproto(reason.as_ptr().cast());
                dispatch_handshake(s, false, err);
                return;
            }
        }
        let err = t(this).verify_error_for(s);
        dispatch_handshake(s, success, err);
    }

    /// Firing site 4: close on a socket whose handshake never completed
    /// (docs/tls.md §2.4). Called by the socket close path.
    pub(crate) fn trigger_handshake_econnreset(this: *mut TlsState, s: *mut SocketHeader) {
        t(this).handshake_state = HandshakeState::Completed;
        t(this).handshake_callback_fired = true;
        if let Some(reason) = ffi::with_ctl(t(this).ctl, |c| c.take_fatal_reason()) {
            let err = us_bun_verify_error_t::eproto(reason.as_ptr().cast());
            dispatch_handshake(s, false, err);
            return;
        }
        dispatch_handshake(s, false, us_bun_verify_error_t::econnreset());
    }

    // ── handshake driver (§2.2) ─────────────────────────────────────────────

    /// Drive SSL_do_handshake; delivers on_handshake exactly once. JS may run
    /// inside (ALPN/SNI callbacks, each bracketed by the §1.4 window
    /// save/restore guard). No `&mut TlsState` is held across the
    /// dispatches (C17).
    pub(crate) fn handshake(this: *mut TlsState, s: *mut SocketHeader) {
        // Per-thread error queue may hold another socket's leftovers.
        bssl::err_clear_error();
        if t(this).ssl.is_null() || t(this).handshake_state != HandshakeState::Pending {
            return;
        }
        let ssl = t(this).ssl;
        // SSL_read may have finished the handshake before we got here;
        // RECEIVED_SHUTDOWN after completed init is a clean close, not a
        // handshake failure.
        if ffi::ssl_is_init_finished(ssl) {
            Self::trigger_handshake(this, s, true);
            return;
        }
        let (_, received) = ffi::ssl_get_shutdown(ssl);
        if deref::with_socket(s, |h| h.is_closed()) || t(this).is_shut_down(s) || received {
            Self::trigger_handshake(this, s, false);
            return;
        }

        let ctl = t(this).ctl;
        // C parity: every ssl_update_handshake entry zeroes the read window
        // (ssl_set_loop_data) so stale ciphertext can never replay here.
        ffi::with_ctl(ctl, |c| c.clear_window());
        let was_in_use = ffi::with_ctl(ctl, |c| {
            let w = c.in_use;
            c.in_use = true;
            w
        });
        let result = ffi::ssl_do_handshake(ssl);
        let deferred = ffi::with_ctl(ctl, |c| {
            c.in_use = was_in_use;
            if !was_in_use && c.pending_detach {
                c.pending_detach = false;
                Some(c.pending_close_code)
            } else {
                None
            }
        });
        if let Some(code) = deferred {
            // A callback destroyed this socket inside the handshake; perform
            // the deferred close and do not touch the SSL again.
            ffi::socket_close(s, CloseCode::from_c(code));
            return;
        }

        if ffi::ssl_get_shutdown(ssl).1 {
            ffi::socket_close(s, CloseCode::normal);
            return;
        }

        if result <= 0 {
            match ffi::ssl_get_error(ssl, result) {
                SslErr::PendingCertificate => {
                    // Async SNI suspension (SniSuspension::Waiting parked in
                    // SSL ex_data by the select-cert callback): stay PENDING,
                    // no poll re-arm; sni_resolve re-drives (§2.6).
                }
                SslErr::WantRead | SslErr::WantWrite => {
                    t(this).write_wants_read = true;
                    deref::with_socket(s, |h| h.flags.set(SocketFlags::LAST_WRITE_FAILED, true));
                }
                other => {
                    if matches!(other, SslErr::Ssl | SslErr::Syscall) {
                        t(this).park_fatal_reason();
                    }
                    Self::trigger_handshake(this, s, false);
                }
            }
            return;
        }

        Self::trigger_handshake(this, s, true);
        if t(this).gone(s) {
            return;
        }
        // Next readable re-delivers a writable to flush pre-handshake data.
        t(this).write_wants_read = true;
    }

    fn renegotiate(this: *mut TlsState, s: *mut SocketHeader) -> bool {
        // Client-only policy (default 3 per 600 s = Node CLIENT_RENEG_LIMIT/
        // WINDOW), read from the CURRENT ctx like C; limit 0 disables,
        // window 0 never resets the counter. Counter lives in SSL ex_data.
        t(this).handshake_state = HandshakeState::RenegotiationPending;
        t(this).handshake_callback_fired = false;
        let ssl = t(this).ssl;
        let (limit, window) = bssl::reneg_policy(bssl::ssl_get_ctx(ssl));
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |d| d.as_secs())
            .saturating_mul(1000);
        let over_limit = {
            let st = deref_mut(bssl::reneg_state_ptr(ssl));
            // Wall clock can step backwards (NTP); only reset when time moved forward.
            if st.count == 0
                || (window != 0
                    && now_ms >= st.window_start_ms
                    && now_ms - st.window_start_ms >= u64::from(window) * 1000)
            {
                st.window_start_ms = now_ms;
                st.count = 0;
            }
            if st.count >= limit {
                true
            } else {
                st.count += 1;
                false
            }
        };
        if over_limit || !ffi::ssl_renegotiate(ssl) {
            Self::trigger_handshake(this, s, false);
            return false;
        }
        true
    }

    // ── read path (§3) ──────────────────────────────────────────────────────

    fn close_from_read(this: *mut TlsState, s: *mut SocketHeader) {
        ffi::with_ctl(t(this).ctl, |c| c.clear_window());
        ffi::socket_close(s, CloseCode::normal);
    }

    /// Decrypt ciphertext arriving from the kernel (or `tls_feed`) and
    /// dispatch plaintext on_data via the loop scratch buffer. No
    /// `&mut TlsState` is held across the dispatches (C17).
    pub(crate) fn read(
        this: *mut TlsState,
        s: *mut SocketHeader,
        loop_: *mut Loop,
        ciphertext: &[u8],
    ) {
        bssl::err_clear_error();
        // Lazy session/keylog marker: an accepted node:tls socket's kind is
        // stamped after attach (§2.1).
        if !t(this).ssl.is_null()
            && deref::with_socket(s, |h| h.kind()) == SocketKind::BunSocketTls
            && !bssl::is_socket_marked(t(this).ssl)
        {
            mark_socket(t(this).ssl);
        }
        // upgradeTLS [raw, _] half observes ciphertext before SSL_read; skip
        // the empty flush call from on_writable (§6.1).
        if t(this).raw_tap && !ciphertext.is_empty() {
            dispatch_ssl_raw_tap(s, ciphertext);
            if t(this).gone(s) {
                return;
            }
        }

        ffi::with_ctl(t(this).ctl, |c| c.set_window(ciphertext));

        if deref::with_socket(s, |h| h.is_closed()) {
            ffi::with_ctl(t(this).ctl, |c| c.clear_window());
            return;
        }
        // A half-closed socket still reads (peer data may precede its
        // close_notify); only bail when reading is genuinely impossible.
        if t(this).ssl.is_null() || ffi::with_ctl(t(this).ctl, |c| c.fatal) {
            Self::close_from_read(this, s);
            return;
        }
        // Do NOT run the handshake driver before SSL_read: SSL_read drives it
        // and firing on_handshake first lets JS clobber piggybacked data (§2.2).

        let mut scratch = LoopScratch::take(loop_);
        let out = scratch.slice();
        const PAD: usize = LIBUS_RECV_BUFFER_PADDING;
        const LEN: usize = LIBUS_RECV_BUFFER_LENGTH;
        let mut read: usize = 0;

        loop {
            let ctl = t(this).ctl;
            let was_in_use = ffi::with_ctl(ctl, |c| {
                let w = c.in_use;
                c.in_use = true;
                w
            });
            let just = ffi::ssl_read(t(this).ssl, &mut out[PAD + read..PAD + LEN]);
            let deferred = ffi::with_ctl(ctl, |c| {
                c.in_use = was_in_use;
                if !was_in_use && c.pending_detach {
                    c.pending_detach = false;
                    Some(c.pending_close_code)
                } else {
                    None
                }
            });
            if let Some(code) = deferred {
                ffi::with_ctl(ctl, |c| c.clear_window());
                ffi::socket_close(s, CloseCode::from_c(code));
                return;
            }

            if just <= 0 {
                let mut err = ffi::ssl_get_error(t(this).ssl, just);
                if let SslErr::WantRenegotiate = err {
                    if Self::renegotiate(this, s) {
                        continue;
                    }
                    if t(this).gone(s) {
                        return;
                    }
                    err = SslErr::Ssl;
                }
                match err {
                    SslErr::ZeroReturn => {
                        // Peer close_notify. A ticket that rode ahead of it
                        // was parked; deliver in wire order, then data, close.
                        Self::flush_pending_events(this, s);
                        if t(this).gone(s) {
                            return;
                        }
                        if read > 0 {
                            dispatch_data(s, &mut out[PAD..PAD + read]);
                            if t(this).gone(s) {
                                return;
                            }
                        }
                        Self::close_from_read(this, s);
                        return;
                    }
                    SslErr::WantRead | SslErr::WantWrite | SslErr::PendingCertificate => {
                        if matches!(err, SslErr::WantWrite) {
                            t(this).read_wants_write = true;
                        }
                        // Leftover ciphertext with SSL_read wanting more is
                        // broken TLS framing.
                        if ffi::with_ctl(t(this).ctl, |c| c.window_remaining()) > 0 {
                            Self::close_from_read(this, s);
                            return;
                        }
                        // Firing site 3: peer's Finished arrived alone — fire
                        // now, not from the writable tail-call (low-prio queue
                        // reorders events under fan-out; §2.3.3).
                        if t(this).handshake_state == HandshakeState::Pending
                            && ffi::ssl_is_init_finished(t(this).ssl)
                        {
                            Self::trigger_handshake(this, s, true);
                            if t(this).gone(s) {
                                return;
                            }
                        }
                        if read == 0 {
                            break;
                        }
                        // Parked sessions/keylog precede the data (wire order;
                        // the data dispatch may close the socket and drop a
                        // deferred flush). Window is empty here.
                        Self::flush_pending_events(this, s);
                        if t(this).gone(s) {
                            return;
                        }
                        dispatch_data(s, &mut out[PAD..PAD + read]);
                        if t(this).gone(s) {
                            return;
                        }
                        break;
                    }
                    _ => {
                        if matches!(err, SslErr::Ssl | SslErr::Syscall) {
                            t(this).park_fatal_reason();
                        }
                        Self::close_from_read(this, s);
                        return;
                    }
                }
            } else {
                if t(this).handshake_state != HandshakeState::Completed {
                    // Firing site 2: handshake completed with app data in the
                    // same flight — fire BEFORE delivering data (ALPN/re-tag),
                    // window restored on guard drop around the JS (§1.4).
                    let _window = WindowGuard::save(t(this).ctl);
                    Self::trigger_handshake(this, s, true);
                    if t(this).gone(s) {
                        return;
                    }
                }
                read += just as usize;
                if read == LEN {
                    {
                        let _window = WindowGuard::save(t(this).ctl);
                        Self::flush_pending_events(this, s);
                        if t(this).gone(s) {
                            return;
                        }
                        dispatch_data(s, &mut out[PAD..PAD + read]);
                        if t(this).gone(s) {
                            return;
                        }
                    }
                    read = 0;
                }
            }
        }

        // A prior SSL_write starved for handshake input can proceed now; the
        // !read_wants_write guard prevents recursion (§3.7).
        if t(this).gone(s) {
            return;
        }
        if t(this).write_wants_read && !t(this).read_wants_write {
            t(this).write_wants_read = false;
            if Self::on_writable(this, s, loop_) {
                dispatch_writable(s);
            }
            if t(this).gone(s) {
                return;
            }
        }
        Self::flush_pending_events(this, s);
    }

    // ── write path (§4) ─────────────────────────────────────────────────────

    /// Encrypt + flush; returns plaintext bytes accepted (0 = would-block,
    /// caller buffers). Honesty invariant: reported bytes are on the wire or
    /// in the loop's bounded spill slot owned by this socket — never
    /// unboundedly parked (§4).
    pub(crate) fn write(this: *mut TlsState, s: *mut SocketHeader, data: &[u8]) -> i32 {
        // C7: int-bounded surface — the unreported tail reads as a short
        // write and the caller arms backpressure.
        let data = &data[..data.len().min(MAX_WRITE_LEN)];
        if data.is_empty()
            || t(this).ssl.is_null()
            || deref::with_socket(s, |h| h.is_closed())
            || t(this).is_shut_down(s)
        {
            return 0;
        }
        // SEMI_SOCKET (eager pre-on_open attach, fast-path connect): SNI/ALPN
        // aren't set yet; writing would serialize a bad ClientHello (§4.1).
        if !deref::with_socket(s, |h| h.is_established()) {
            return 0;
        }
        let ctl = t(this).ctl;
        // This socket's earlier sealed records must reach the wire first: SSL
        // already counts them written; nothing new may be sealed while they
        // pend (§4.2).
        if !ffi::with_ctl(ctl, |c| c.flush_pending()) {
            return 0;
        }
        // Batching only while the loop spill slot is free (§4.4); behind
        // another socket's spill this write goes through per-record.
        let batching = ffi::with_ctl(ctl, |c| c.spill_slot_free());

        ffi::with_ctl(ctl, |c| {
            c.clear_window();
            c.set_batching(batching);
        });

        let mut total: usize = 0;
        let mut last: i32 = 1;
        while total < data.len() {
            let chunk = (data.len() - total).min(TLS_RECORD_CHUNK);
            last = ffi::ssl_write(t(this).ssl, &data[total..total + chunk]);
            if last <= 0 {
                break;
            }
            total += last as usize;
            if ffi::with_ctl(ctl, |c| c.fatal) {
                break;
            }
            if batching && ffi::with_ctl(ctl, |c| c.batch_len()) >= TLS_BATCH_FLUSH {
                // Wire blocked (spill created): stop consuming plaintext.
                if !ffi::with_ctl(ctl, |c| c.flush_batch()) {
                    break;
                }
                if ffi::with_ctl(ctl, |c| c.fatal) {
                    break;
                }
            }
        }
        let fatal = ffi::with_ctl(ctl, |c| {
            c.set_batching(false);
            let _ = c.flush_batch();
            c.fatal
        });
        if fatal {
            return 0;
        }
        if total > 0 {
            // Cannot wrap: `data` was clamped to i32::MAX above.
            return total as i32;
        }
        if last <= 0 {
            match ffi::ssl_get_error(t(this).ssl, last) {
                SslErr::WantRead => t(this).write_wants_read = true,
                // A pre-secureConnect write is where handshake-config
                // failures surface; park so the handshake dispatch reports it.
                SslErr::Ssl | SslErr::Syscall => t(this).park_fatal_reason(),
                _ => {}
            }
        }
        0
    }

    // ── writable event (§4.1) ───────────────────────────────────────────────

    /// Drain spill → deferred shutdown/close → handshake → blocked-decrypt
    /// flush. Returns true when the user on_writable should be dispatched
    /// (handshake completed, not shut down, and the socket survived).
    pub(crate) fn on_writable(this: *mut TlsState, s: *mut SocketHeader, loop_: *mut Loop) -> bool {
        if !ffi::with_ctl(t(this).ctl, |c| c.flush_pending()) {
            return false;
        }
        if t(this).shutdown_after_spill {
            t(this).shutdown_after_spill = false;
            t(this).shutdown_graceful(s);
            if t(this).gone(s) {
                return false;
            }
        }
        if t(this).close_after_spill {
            t(this).close_after_spill = false;
            ffi::socket_close(s, CloseCode::fast_shutdown);
            return false;
        }
        Self::handshake(this, s);
        if t(this).gone(s) {
            return false;
        }
        if t(this).read_wants_write {
            t(this).read_wants_write = false;
            // Let a blocked decrypt flush (empty feed; raw tap skips len==0).
            Self::read(this, s, loop_, &[]);
            if t(this).gone(s) {
                return false;
            }
        }
        // Graceful FIN / SENT_SHUTDOWN / fatal suppresses the user writable
        // (openssl.c:1806 is_shut_down gate).
        if t(this).is_shut_down(s) {
            return false;
        }
        t(this).handshake_state == HandshakeState::Completed
            && !deref::with_socket(s, |h| h.is_closed())
    }

    // ── shutdown & close (§5) ───────────────────────────────────────────────

    /// `us_socket_shutdown` TLS arm (docs/tls.md §5, C12): always the
    /// graceful path — forceful closes route through `handle_shutdown` directly.
    pub(crate) fn shutdown(&mut self, s: *mut SocketHeader, code: CloseCode) {
        debug_assert!(matches!(code, CloseCode::normal));
        self.shutdown_graceful(s);
    }

    /// Graceful half-close (§5.1). BoringSSL has no TLS half-close: send
    /// close_notify only when the peer's already arrived; otherwise TCP FIN
    /// via `raw_shutdown` (preceded by the zero-length SSL_write TLS1.3
    /// ticket flush) and keep reading.
    fn shutdown_graceful(&mut self, s: *mut SocketHeader) {
        if deref::with_socket(s, |h| h.is_closed()) || self.is_shut_down(s) {
            return;
        }
        if ffi::with_ctl(self.ctl, |c| c.spill_len() > 0) {
            // Spilled ciphertext is already counted written; a FIN now would
            // cut it off. Finish from the writable event.
            if !ffi::with_ctl(self.ctl, |c| c.flush_pending()) {
                self.shutdown_after_spill = true;
                return;
            }
        }
        let (_, received) = ffi::ssl_get_shutdown(self.ssl);
        if !ffi::ssl_in_init(self.ssl) && !received {
            ffi::with_ctl(self.ctl, |c| c.clear_window());
            // Flush deferred TLS1.3 NewSessionTickets through the BIO before
            // the FIN (a server ending without writing never delivers them).
            ffi::ssl_write_zero(self.ssl);
            crate::socket::raw_shutdown(s);
            return;
        }

        ffi::with_ctl(self.ctl, |c| c.clear_window());
        let ret = ffi::ssl_shutdown(self.ssl);
        if ffi::ssl_in_init(self.ssl) || ffi::ssl_get_quiet_shutdown(self.ssl) {
            crate::socket::raw_shutdown(s);
            return;
        }
        if ret < 0 {
            if matches!(
                ffi::ssl_get_error(self.ssl, ret),
                SslErr::Ssl | SslErr::Syscall
            ) {
                bssl::err_clear_error();
                ffi::with_ctl(self.ctl, |c| c.fatal = true);
            }
            crate::socket::raw_shutdown(s);
        }
    }

    /// §5.2 close helper. True = shutdown complete (or impossible) and the
    /// TCP socket may close now; false = close_notify sent, wait for peer's.
    pub(crate) fn handle_shutdown(&mut self, s: *mut SocketHeader, force_fast: bool) -> bool {
        if self.ssl.is_null()
            || self.is_shut_down(s)
            || ffi::with_ctl(self.ctl, |c| c.fatal)
            || !ffi::ssl_is_init_finished(self.ssl)
        {
            return true;
        }
        let (sent, received) = ffi::ssl_get_shutdown(self.ssl);
        if sent && received {
            return true;
        }
        ffi::with_ctl(self.ctl, |c| c.clear_window());
        let mut ret = ffi::ssl_shutdown(self.ssl);
        if ret == 0 && force_fast {
            ret = ffi::ssl_shutdown(self.ssl);
        }
        if ret < 0 {
            match ffi::ssl_get_error(self.ssl, ret) {
                SslErr::Ssl | SslErr::Syscall => {
                    bssl::err_clear_error();
                    ffi::with_ctl(self.ctl, |c| c.fatal = true);
                    true
                }
                // Alert never left the BIO; SENT_SHUTDOWN is already set so
                // no retry path exists — close now (documented LSan leak
                // otherwise; §5.2).
                SslErr::WantRead | SslErr::WantWrite => true,
                _ => {
                    ffi::with_ctl(self.ctl, |c| c.fatal = true);
                    true
                }
            }
        } else {
            ret == 1
        }
    }

    // ── verify / sessions / keylog ──────────────────────────────────────────

    pub(crate) fn verify_error(&self) -> us_bun_verify_error_t {
        if self.ssl.is_null() {
            return us_bun_verify_error_t::default();
        }
        us_bun_verify_error_t::from_ssl(self.ssl.cast_const())
    }

    /// Session/keylog events are parked by the CTX callbacks while the SSL
    /// stack runs (bssl ex_data queues) and delivered ONLY after it unwinds
    /// (C11). Sessions first, then keylog — wire order.
    pub(crate) fn flush_pending_events(this: *mut TlsState, s: *mut SocketHeader) {
        if t(this).gone(s) {
            return;
        }
        for item in bssl::drain_pending_sessions(t(this).ssl) {
            if t(this).gone(s) {
                return;
            }
            dispatch_session(s, &item);
        }
        if t(this).gone(s) {
            return;
        }
        for item in bssl::drain_pending_keylog(t(this).ssl) {
            if t(this).gone(s) {
                return;
            }
            dispatch_keylog(s, &item);
        }
    }
}

// ── loop plaintext scratch ────────────────────────────────────────────────────

/// RAII take/restore of the loop-shared plaintext scratch
/// (`LoopTlsShared.scratch`): `take()` on entry, restore on drop; a
/// re-entrant nesting sees an empty slot and allocates fresh.
pub(crate) struct LoopScratch {
    loop_: *mut Loop,
    buf: Option<*mut core::ffi::c_void>,
}

impl LoopScratch {
    pub(crate) fn take(loop_: *mut Loop) -> LoopScratch {
        let mut buf = ffi::with_tls_shared(loop_, |sh| {
            core::mem::replace(&mut sh.scratch, core::ptr::null_mut())
        });
        if buf.is_null() {
            buf = ffi::scratch_alloc();
        }
        LoopScratch {
            loop_,
            buf: Some(buf),
        }
    }

    /// Full scratch: PADDING + 512 KiB plaintext area + PADDING.
    pub(crate) fn slice(&mut self) -> &mut [u8] {
        ffi::scratch_slice(self.buf.expect("scratch taken"))
    }
}

impl Drop for LoopScratch {
    fn drop(&mut self) {
        if let Some(buf) = self.buf.take() {
            // Refill the loop slot if empty; a nested take already put an
            // equivalent buffer back, so free ours instead.
            let leftover = ffi::with_tls_shared(self.loop_, |sh| {
                if sh.scratch.is_null() {
                    sh.scratch = buf;
                    None
                } else {
                    Some(buf)
                }
            });
            if let Some(extra) = leftover {
                ffi::scratch_free(extra);
            }
        }
    }
}
