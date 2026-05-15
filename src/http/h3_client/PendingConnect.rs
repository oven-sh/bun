//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `onDNSResolved[Threadsafe]`, at which point the resolved address is
//! handed to lsquic and the resulting `quic.Socket` bound to the waiting
//! `ClientSession`.
//!
//! Lifetime: holds one ref on `session` from `register` until
//! `onDNSResolved` runs. The `quic.PendingConnect` C handle is consumed by
//! exactly one of `resolved()` or `cancel()`.

use core::ptr::NonNull;
use core::sync::atomic::Ordering;

use bun_threading::Guarded;
use bun_uws as uws;
use bun_uws::quic;

use super::ClientSession;
use super::client_session::session_mut;

pub struct PendingConnect {
    // INTRUSIVE: intrusive-refcounted (ref_/deref) ClientSession; one ref held
    // from `register` until `on_dns_resolved` runs.
    session: *mut ClientSession,
    // FFI: C handle owned until exactly one of resolved()/cancel() consumes it.
    pc: *mut quic::PendingConnect,
    // BACKREF: the uws event loop (lives as long as the HTTP thread).
    loop_ptr: *mut uws::Loop,
}

impl Drop for PendingConnect {
    fn drop(&mut self) {
        // Invariant: a constructed PendingConnect holds exactly one ref on `session`
        // (taken in `register`); release it here.
        // SAFETY: ref taken in `register`; session is live until this drops it.
        unsafe { ClientSession::deref(self.session) };
    }
}

impl PendingConnect {
    /// Mutable access to the owned `quic::PendingConnect` C handle.
    ///
    /// INVARIANT: `pc` is set once in [`register`] to a live
    /// `us_quic_pending_connect_t` and is consumed by exactly one of
    /// `resolved()` / `cancel()` in [`on_dns_resolved`]. The handle is a
    /// separate FFI heap allocation disjoint from `self`. HTTP-thread-only at
    /// every caller. Centralises the raw `(*this.pc)` upgrade repeated at
    /// each consume site.
    #[inline]
    fn pc_mut<'a>(&self) -> &'a mut quic::PendingConnect {
        // SAFETY: see INVARIANT above.
        unsafe { &mut *self.pc }
    }

    pub fn register(session: *mut ClientSession, pc: *mut quic::PendingConnect, l: *mut uws::Loop) {
        // Caller passes a live intrusive-refcounted ClientSession; PendingConnect
        // holds one ref from construction until Drop. `session_mut` centralises
        // the backref upgrade (same invariant as the other call sites below).
        session_mut(session).ref_();
        let self_ = Box::new(PendingConnect {
            session,
            pc,
            loop_ptr: l,
        });
        // Route the addrinfo read through the existing [`pc_mut`] accessor
        // (centralised raw upgrade) instead of an open-coded `(*pc)` deref.
        let addrinfo = self_.pc_mut().addrinfo();
        let self_ = bun_core::heap::into_raw(self_);
        // SAFETY: `self_` is the Box we just leaked above and is consumed by
        // `on_dns_resolved` (via the global cache's notify path).
        unsafe { bun_dns::internal::register_quic(addrinfo, self_.cast()) };
    }

    pub fn r#loop(&self) -> *mut uws::Loop {
        self.loop_ptr
    }

    /// SAFETY: `this` must be the pointer produced by `heap::alloc` in `register`
    /// and must not be used after this call (it is freed here).
    pub unsafe fn on_dns_resolved(this: *mut PendingConnect) {
        // SAFETY: `this` was heap-allocated in `register`; reclaim it so the Box drops at
        // end of scope — `Drop` derefs `session` and the allocation is freed.
        // (Zig: defer { session.deref(); bun.destroy(this); })
        let this = unsafe { bun_core::heap::take(this) };
        let session = this.session;

        // session is kept alive by the ref `this` holds for the duration of this
        // fn — `session_mut` centralises the backref upgrade.
        let s = session_mut(session);
        if s.closed || s.pending.is_empty() {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use. `pc_mut` upgrades the owned C
            // handle; `cancel()` consumes it.
            this.pc_mut().cancel();
            if !s.closed {
                Self::fail_session(session, bun_core::err!("Aborted"));
            }
            return;
        }
        // `pc_mut` upgrades the owned C handle; `resolved()` consumes it and
        // returns the connected quic socket or None on DNS failure.
        let Some(qs) = this.pc_mut().resolved() else {
            Self::fail_session(session, bun_core::err!("DNSResolutionFailed"));
            return;
        };
        s.qsocket = Some(NonNull::from(&mut *qs));
        // qs.ext() returns the per-socket user storage slot for ClientSession.
        *qs.ext::<ClientSession>() = NonNull::new(session);
    }

    /// DNS worker may call from off the HTTP thread; mirror
    /// us_internal_dns_callback_threadsafe: push onto a mutex-protected list and
    /// wake the loop. `drain_resolved` runs from `HTTPThread.drainEvents` on the
    /// next loop iteration after the wakeup.
    ///
    /// SAFETY: `this` must be the pointer produced by `heap::alloc` in `register`.
    pub unsafe fn on_dns_resolved_threadsafe(this: *mut PendingConnect) {
        // `this` is a live heap-allocated PendingConnect (caller contract);
        // wrap it in a `ParentRef` (pointee outlives holder) so the shared
        // `loop_ptr` read goes through the safe `Deref` impl instead of an
        // open-coded `(*this)`. Read *before* publishing — once pushed, the
        // HTTP thread may free `this` at any time via `drain_resolved`.
        let loop_ptr = bun_ptr::ParentRef::from(
            NonNull::new(this).expect("on_dns_resolved_threadsafe: non-null"),
        )
        .r#loop();
        RESOLVED.lock().push(Resolved(this));
        // SAFETY: `loop_ptr` is a live uws::Loop for as long as the HTTP thread runs.
        unsafe { (*loop_ptr).wakeup() };
    }

    pub fn drain_resolved() {
        let batch = core::mem::take(&mut *RESOLVED.lock());
        for Resolved(head) in batch {
            // SAFETY: every entry was heap-allocated in `register()` and is
            // consumed exactly once here.
            unsafe { PendingConnect::on_dns_resolved(head) };
        }
    }

    /// Tear down a session that never reached `on_conn_close` (DNS failure or
    /// every waiter aborted while DNS was in flight).
    pub fn fail_session(session: *mut ClientSession, err: bun_core::Error) {
        // Caller guarantees `session` is live (held by an intrusive ref) —
        // `session_mut` centralises the backref upgrade.
        let s = session_mut(session);
        s.closed = true;
        if let Some(ctx) = super::client_context::ClientContext::get() {
            super::client_context::ClientContext::as_mut(ctx).unregister(s);
        }
        while !s.pending.is_empty() {
            let stream = s.pending[0];
            // stream is live while attached to session.pending.
            let cl = super::client_session::stream_ref(stream).client;
            s.detach(stream);
            if let Some(cl) = cl {
                // HTTPClient outlives its h3 Stream; detach() nulled stream.client
                // but `cl` is alive — `client_mut` centralises this backref upgrade.
                super::client_session::client_mut(cl).fail_from_h2(err);
            }
        }
        // Zig .monotonic == LLVM monotonic == Rust Relaxed
        let _ = super::LIVE_SESSIONS.fetch_sub(1, Ordering::Relaxed);
        // session is intrusive-refcounted; this drops the connection-alive ref.
        unsafe { ClientSession::deref(session) };
    }
}

/// Heap-allocated `PendingConnect` handed from DNS worker → HTTP thread.
/// `*mut T` is `!Send` by default; this wrapper asserts the actual contract:
/// the pointee is touched by exactly one thread at a time (producer pushes,
/// consumer pops + frees), serialized by `RESOLVED`'s mutex.
#[repr(transparent)]
struct Resolved(*mut PendingConnect);
// SAFETY: `Resolved` only ever crosses threads while held inside `RESOLVED`'s
// mutex; the pointee is heap-allocated in `register()` and freed on the HTTP
// thread in `on_dns_resolved()`. No thread touches it without the lock or
// after handoff.
unsafe impl Send for Resolved {}

/// Queue of `PendingConnect`s whose DNS resolved off the HTTP thread, drained
/// on the next `HTTPThread::drain_events`. Conceptually a field of
/// [`HTTPThread`](crate::HTTPThread) (there is exactly one), but kept as a
/// module static because `http_thread()` hands out `&'static mut HTTPThread`
/// to the HTTP thread — projecting a shared `&` to an interior field from the
/// DNS worker would alias that exclusive borrow under Stacked Borrows. A
/// dedicated `Sync` static sidesteps that without weakening the singleton
/// accessor's `&mut` contract.
static RESOLVED: Guarded<Vec<Resolved>> = Guarded::new(Vec::new());

// ported from: src/http/h3_client/PendingConnect.zig
