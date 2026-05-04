//! DNS-pending QUIC connect. Created when `quic.Context.connect` returns
//! `.pending` (cache miss); the global DNS cache notifies via
//! `onDNSResolved[Threadsafe]`, at which point the resolved address is
//! handed to lsquic and the resulting `quic.Socket` bound to the waiting
//! `ClientSession`.
//!
//! Lifetime: holds one ref on `session` from `register` until
//! `onDNSResolved` runs. The `quic.PendingConnect` C handle is consumed by
//! exactly one of `resolved()` or `cancel()`.

use core::ptr;
use core::sync::atomic::Ordering;

use bun_uws as uws;
use bun_uws::quic;

use super::ClientSession;

pub struct PendingConnect {
    // TODO(port): lifetime — intrusive-refcounted (ref/deref) ClientSession; kept as raw ptr
    session: *mut ClientSession,
    // TODO(port): lifetime — FFI C handle owned until resolved()/cancel() consumes it
    pc: *mut quic::PendingConnect,
    // TODO(port): lifetime — backref to the uws event loop (FFI)
    loop_ptr: *mut uws::Loop,
    // intrusive singly-linked list link for the threadsafe resolved queue
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
        // TODO(port): `ref` is a Rust keyword — assuming ClientSession exposes `ref_()`/`deref()`
        // SAFETY: pc is a live quic::PendingConnect C handle; addrinfo() yields its addrinfo
        // request slot which the DNS layer fills. self_ is the Box we just leaked above.
        unsafe {
            bun_dns::internal::register_quic((*pc).addrinfo().cast(), self_);
        }
    }

    pub fn r#loop(&self) -> *mut uws::Loop {
        self.loop_ptr
    }

    /// SAFETY: `this` must be the pointer produced by `Box::into_raw` in `register`
    /// and must not be used after this call (it is freed here).
    pub unsafe fn on_dns_resolved(this: *mut PendingConnect) {
        let session = unsafe { (*this).session };
        // Zig: defer { session.deref(); bun.destroy(this); }
        let _guard = scopeguard::guard((), move |_| {
            // SAFETY: `session` had one ref taken in `register`; `this` was Box::into_raw'd there.
            unsafe {
                (*session).deref();
                drop(Box::from_raw(this));
            }
        });

        // SAFETY: session is kept alive by the ref we hold for the duration of this fn.
        let s = unsafe { &mut *session };
        if s.closed || s.pending.as_slice().is_empty() {
            // Every waiter was aborted while DNS was in flight; don't open a
            // connection nobody will use.
            // SAFETY: pc is a live C handle; cancel() consumes it.
            unsafe { (*(*this).pc).cancel() };
            if !s.closed {
                fail_session(session, bun_core::err!("Aborted"));
            }
            return;
        }
        // SAFETY: pc is a live C handle; resolved() consumes it and returns the
        // connected quic socket or None on DNS failure.
        let Some(qs) = (unsafe { (*(*this).pc).resolved() }) else {
            fail_session(session, bun_core::err!("DNSResolutionFailed"));
            return;
        };
        s.qsocket = Some(qs);
        // SAFETY: qs.ext() returns the per-socket user storage slot for *mut ClientSession.
        unsafe { *qs.ext::<*mut ClientSession>() = session };
        // TODO(port): verify quic::Socket::ext signature — Zig was `qs.ext(ClientSession).* = session`
    }

    /// DNS worker may call from off the HTTP thread; mirror
    /// us_internal_dns_callback_threadsafe: push onto a mutex-protected list and
    /// wake the loop. `drain_resolved` runs from `HTTPThread.drainEvents` on the
    /// next loop iteration after the wakeup.
    ///
    /// SAFETY: `this` must be the pointer produced by `Box::into_raw` in `register`.
    pub unsafe fn on_dns_resolved_threadsafe(this: *mut PendingConnect) {
        RESOLVED_MUTEX.lock();
        // SAFETY: RESOLVED_HEAD is only read/written while RESOLVED_MUTEX is held.
        unsafe {
            (*this).next = RESOLVED_HEAD;
            RESOLVED_HEAD = this;
        }
        RESOLVED_MUTEX.unlock();
        // SAFETY: loop_ptr is a live uws::Loop for as long as the HTTP thread runs.
        unsafe { (*(*this).loop_ptr).wakeup() };
    }

    pub fn drain_resolved() {
        RESOLVED_MUTEX.lock();
        // SAFETY: RESOLVED_HEAD is only read/written while RESOLVED_MUTEX is held.
        let mut head = unsafe { RESOLVED_HEAD };
        unsafe { RESOLVED_HEAD = ptr::null_mut() };
        RESOLVED_MUTEX.unlock();
        while !head.is_null() {
            // SAFETY: every node on this list was Box::into_raw'd in register() and
            // is consumed exactly once by on_dns_resolved below.
            let next = unsafe { (*head).next };
            unsafe { PendingConnect::on_dns_resolved(head) };
            head = next;
        }
    }
}

pub fn fail_session(session: *mut ClientSession, err: bun_core::Error) {
    // SAFETY: caller guarantees `session` is live (held by an intrusive ref).
    let s = unsafe { &mut *session };
    s.closed = true;
    if let Some(ctx) = super::ClientContext::get() {
        ctx.unregister(session);
    }
    while !s.pending.as_slice().is_empty() {
        let stream = s.pending.as_slice()[0];
        // TODO(port): `stream.client` field type — Zig `?*Client`; assuming Option-like here
        // SAFETY: stream is live while attached to session.pending
        let cl = unsafe { (*stream).client };
        s.detach(stream);
        if let Some(cl_) = cl {
            cl_.fail_from_h2(err);
        }
    }
    // Zig .monotonic == LLVM monotonic == Rust Relaxed
    let _ = super::LIVE_SESSIONS.fetch_sub(1, Ordering::Relaxed);
    // TODO(port): Zig `H3.live_sessions` — assuming `super::LIVE_SESSIONS: AtomicUsize`
    // SAFETY: session is intrusive-refcounted; this drops the connection-alive ref.
    unsafe { (*session).deref() };
}

// TODO(port): bun.Mutex — assuming `bun_threading::Mutex` with const `new()` + lock()/unlock()
static RESOLVED_MUTEX: bun_threading::Mutex = bun_threading::Mutex::new();
// SAFETY: only accessed while RESOLVED_MUTEX is held (see on_dns_resolved_threadsafe / drain_resolved).
// TODO(port): `static mut` — Phase B may want UnsafeCell/AtomicPtr to satisfy edition-2024 lints.
static mut RESOLVED_HEAD: *mut PendingConnect = ptr::null_mut();

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/http/h3_client/PendingConnect.zig (95 lines)
//   confidence: medium
//   todos:      7
//   notes:      LIFETIMES.tsv had no rows; all ptr fields classified INTRUSIVE/FFI as raw *mut. `ref`/`loop` keyword collisions handled as ref_()/r#loop. static mut for resolved_head.
// ──────────────────────────────────────────────────────────────────────────
