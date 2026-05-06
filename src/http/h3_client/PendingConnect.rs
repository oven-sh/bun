//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `onDNSResolved[Threadsafe]`, at which point the resolved address is
//! handed to lsquic and the resulting `quic.Socket` bound to the waiting
//! `ClientSession`.
//!
//! Lifetime: holds one ref on `session` from `register` until
//! `onDNSResolved` runs. The `quic.PendingConnect` C handle is consumed by
//! exactly one of `resolved()` or `cancel()`.

use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

use bun_uws as uws;
use bun_uws::quic;

use super::ClientSession;

pub struct PendingConnect {
    // INTRUSIVE: intrusive-refcounted (ref_/deref) ClientSession; one ref held
    // from `register` until `on_dns_resolved` runs.
    session: *mut ClientSession,
    // FFI: C handle owned until exactly one of resolved()/cancel() consumes it.
    pc: *mut quic::PendingConnect,
    // BACKREF: the uws event loop (lives as long as the HTTP thread).
    loop_ptr: *mut uws::Loop,
    // Intrusive singly-linked-list link for the threadsafe resolved queue.
    next: *mut PendingConnect,
}

impl PendingConnect {
    pub fn register(
        session: *mut ClientSession,
        pc: *mut quic::PendingConnect,
        l: *mut uws::Loop,
    ) {
        let self_ = Box::into_raw(Box::new(PendingConnect {
            session,
            pc,
            loop_ptr: l,
            next: ptr::null_mut(),
        }));
        // SAFETY: caller passes a live intrusive-refcounted ClientSession; we hold one ref
        // from here until on_dns_resolved runs.
        unsafe { (*session).ref_() };
        // SAFETY: pc is a live quic::PendingConnect C handle; addrinfo() yields its addrinfo
        // request slot which the DNS layer fills. self_ is the Box we just leaked above and
        // is consumed by on_dns_resolved (via the global cache's notify path).
        unsafe { bun_dns::internal::register_quic((*pc).addrinfo(), self_.cast()) };
    }

    pub fn r#loop(&self) -> *mut uws::Loop {
        self.loop_ptr
    }

    /// SAFETY: `this` must be the pointer produced by `Box::into_raw` in `register`
    /// and must not be used after this call (it is freed here).
    pub unsafe fn on_dns_resolved(this: *mut PendingConnect) {
        // SAFETY: `this` is the Box::into_raw'd ptr from register; live until dropped at end of fn.
        let session = unsafe { (*this).session };
        // Zig: defer { session.deref(); bun.destroy(this); }
        let _guard = scopeguard::guard((), move |_| {
            ClientSession::deref(session);
            // SAFETY: `this` was Box::into_raw'd in `register`; not used after this point.
            unsafe { drop(Box::from_raw(this)) };
        });

        // SAFETY: session is kept alive by the ref we hold for the duration of this fn.
        let s = unsafe { &mut *session };
        if s.closed || s.pending.is_empty() {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use.
            // SAFETY: pc is a live C handle; cancel() consumes it.
            unsafe { (*(*this).pc).cancel() };
            if !s.closed {
                Self::fail_session(session, bun_core::err!("Aborted"));
            }
            return;
        }
        // SAFETY: pc is a live C handle; resolved() consumes it and returns the
        // connected quic socket or None on DNS failure.
        let Some(qs) = (unsafe { (*(*this).pc).resolved() }) else {
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
    /// SAFETY: `this` must be the pointer produced by `Box::into_raw` in `register`.
    pub unsafe fn on_dns_resolved_threadsafe(this: *mut PendingConnect) {
        RESOLVED_MUTEX.lock();
        // SAFETY: `this` is a live Box::into_raw'd PendingConnect (guaranteed by caller).
        // RESOLVED_HEAD is only read/written while RESOLVED_MUTEX is held; Relaxed is
        // sufficient because the mutex provides the happens-before ordering.
        unsafe { (*this).next = RESOLVED_HEAD.load(Ordering::Relaxed) };
        RESOLVED_HEAD.store(this, Ordering::Relaxed);
        RESOLVED_MUTEX.unlock();
        // SAFETY: loop_ptr is a live uws::Loop for as long as the HTTP thread runs.
        unsafe { (*(*this).loop_ptr).wakeup() };
    }

    pub fn drain_resolved() {
        RESOLVED_MUTEX.lock();
        // RESOLVED_HEAD is only read/written while RESOLVED_MUTEX is held; Relaxed is
        // sufficient because the mutex provides the happens-before ordering.
        let mut head = RESOLVED_HEAD.swap(ptr::null_mut(), Ordering::Relaxed);
        RESOLVED_MUTEX.unlock();
        while !head.is_null() {
            // SAFETY: every node on this list was Box::into_raw'd in register() and
            // is consumed exactly once by on_dns_resolved below.
            let next = unsafe { (*head).next };
            // SAFETY: `head` is a valid Box::into_raw'd PendingConnect (see above).
            unsafe { PendingConnect::on_dns_resolved(head) };
            head = next;
        }
    }

    /// Tear down a session that never reached `on_conn_close` (DNS failure or
    /// every waiter aborted while DNS was in flight).
    pub fn fail_session(session: *mut ClientSession, err: bun_core::Error) {
        // SAFETY: caller guarantees `session` is live (held by an intrusive ref).
        let s = unsafe { &mut *session };
        s.closed = true;
        if let Some(ctx) = super::client_context::ClientContext::get() {
            ctx.unregister(s);
        }
        while !s.pending.is_empty() {
            let stream = s.pending[0];
            // SAFETY: stream is live while attached to session.pending.
            let cl = unsafe { (*stream).client };
            s.detach(stream);
            if let Some(cl) = cl {
                // SAFETY: HTTPClient outlives its h3 Stream; detach() nulled stream.client
                // but `cl` is alive (ownership stays with the caller's request lifecycle).
                unsafe { (*cl.as_ptr()).fail_from_h2(err) };
            }
        }
        // Zig .monotonic == LLVM monotonic == Rust Relaxed
        let _ = super::LIVE_SESSIONS.fetch_sub(1, Ordering::Relaxed);
        // session is intrusive-refcounted; this drops the connection-alive ref.
        ClientSession::deref(session);
    }
}

static RESOLVED_MUTEX: bun_threading::Mutex = bun_threading::Mutex::new();
// Only read/written while RESOLVED_MUTEX is held (see on_dns_resolved_threadsafe /
// drain_resolved). AtomicPtr instead of `static mut` for edition-2024 hygiene; all
// accesses use Relaxed because the mutex provides synchronization.
static RESOLVED_HEAD: AtomicPtr<PendingConnect> = AtomicPtr::new(ptr::null_mut());

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/PendingConnect.zig (95 lines)
//   confidence: high
//   todos:      0
//   notes:      ptr fields classified INTRUSIVE/FFI/BACKREF as raw *mut. `ref`/`loop` keyword collisions handled as ref_()/r#loop. resolved_head as AtomicPtr (mutex-guarded, Relaxed).
// ──────────────────────────────────────────────────────────────────────────
