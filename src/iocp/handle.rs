#![cfg(windows)]

//! Handle lifecycle core: activity/ref accounting and the deferred-close
//! (endgame) protocol every handle class embeds.
//!
//! Close is ALWAYS asynchronous: `close()` only marks the handle CLOSING and
//! performs the caller's type-specific shutdown; the handle's resources are
//! released by its endgame, which runs from the loop once the last in-flight
//! request has drained (`reqs_pending == 0`) — never before, because the
//! kernel writes into request memory until each completion is dequeued.
//! // quirk: LOOP-25, LOOP-04

use crate::event_loop::Loop;

/// Handle is started (it will receive events).
const ACTIVE: u32 = 1 << 0;
/// Handle holds the loop open while active. Active+ref'd is the only normal
/// state counted in `active_handles`.
const REF: u32 = 1 << 1;
/// `close()` has been called; no new operations may start.
const CLOSING: u32 = 1 << 2;
/// Endgame already queued (guards double-queue). // quirk: LOOP-26
const ENDGAME_QUEUED: u32 = 1 << 3;
/// Endgame ran; terminal state.
const CLOSED: u32 = 1 << 4;
/// `close()` took an `active_handles` count of its own because the handle
/// was not already counted; released by the endgame. // quirk: LOOP-27
const CLOSE_KEEPALIVE: u32 = 1 << 5;

/// Runs the handle class's teardown once all in-flight requests drained.
/// Receives the `HandleCore` embedded in the handle; implementations recover
/// their full handle type from it, free OS resources, and invoke close_cb.
pub type EndgameFn = unsafe fn(*mut HandleCore);

/// Embedded at a stable location inside every handle class.
pub struct HandleCore {
    flags: u32,
    /// In-flight overlapped requests owned by this handle. The endgame is
    /// gated on this reaching zero. // quirk: LOOP-25, POLL-35
    reqs_pending: u32,
    pub(crate) endgame_next: *mut HandleCore,
    endgame: EndgameFn,
    pub(crate) loop_: *mut Loop,
}

impl HandleCore {
    /// # Safety
    /// `loop_` must outlive the handle; the handle must be heap-pinned for as
    /// long as it is active or has requests in flight.
    pub unsafe fn new(loop_: *mut Loop, endgame: EndgameFn) -> HandleCore {
        HandleCore {
            flags: REF,
            reqs_pending: 0,
            endgame_next: core::ptr::null_mut(),
            endgame,
            loop_,
        }
    }

    #[inline]
    pub fn is_closing(&self) -> bool {
        self.flags & (CLOSING | CLOSED) != 0
    }

    #[inline]
    pub fn is_closed(&self) -> bool {
        self.flags & CLOSED != 0
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.flags & ACTIVE != 0
    }

    #[inline]
    pub fn has_ref(&self) -> bool {
        self.flags & REF != 0
    }

    #[inline]
    fn counted(&self) -> bool {
        self.flags & ACTIVE != 0 && self.flags & REF != 0
    }

    #[inline]
    fn loop_mut(&mut self) -> &mut Loop {
        // SAFETY: `new`s contract — the loop outlives the handle.
        unsafe { &mut *self.loop_ }
    }

    pub fn start(&mut self) {
        debug_assert!(!self.is_closing());
        if self.flags & ACTIVE == 0 {
            self.flags |= ACTIVE;
            if self.flags & REF != 0 {
                self.loop_mut().active_handles_inc();
            }
        }
    }

    pub fn stop(&mut self) {
        debug_assert!(!self.is_closing());
        if self.flags & ACTIVE != 0 {
            self.flags &= !ACTIVE;
            if self.flags & REF != 0 {
                self.loop_mut().active_handles_dec();
            }
        }
    }

    pub fn ref_(&mut self) {
        if self.flags & REF == 0 {
            self.flags |= REF;
            if self.flags & ACTIVE != 0 && self.flags & CLOSING == 0 {
                self.loop_mut().active_handles_inc();
            }
        }
    }

    pub fn unref(&mut self) {
        if self.flags & REF != 0 {
            self.flags &= !REF;
            if self.flags & ACTIVE != 0 && self.flags & CLOSING == 0 {
                self.loop_mut().active_handles_dec();
            }
        }
    }

    /// A request was submitted on behalf of this handle.
    pub fn req_submitted(&mut self) {
        self.reqs_pending += 1;
        self.loop_mut().active_reqs_inc();
    }

    /// A request belonging to this handle completed (its packet was dequeued
    /// or it was drained from the pending queue). If the handle is closing
    /// and this was the last one, the endgame becomes eligible.
    /// // quirk: LOOP-25
    pub fn req_completed(&mut self) {
        debug_assert!(self.reqs_pending > 0);
        self.reqs_pending -= 1;
        self.loop_mut().active_reqs_dec();
        if self.reqs_pending == 0 && self.flags & CLOSING != 0 {
            self.want_endgame();
        }
    }

    /// Like [`req_submitted`](Self::req_submitted), but the request does NOT
    /// hold the loop open: an AFD poll watcher has an IRP in flight at all
    /// times by design (re-arm before callback), so counting those in
    /// `active_reqs` would make an unref'd watcher pin the loop forever —
    /// libuv likewise never registers its poll reqs. Endgame gating
    /// (`reqs_pending`) is unchanged. // quirk: POLL-26, LOOP-25
    pub(crate) fn req_submitted_uncounted(&mut self) {
        self.reqs_pending += 1;
    }

    /// Completion pair of [`req_submitted_uncounted`](Self::req_submitted_uncounted).
    pub(crate) fn req_completed_uncounted(&mut self) {
        debug_assert!(self.reqs_pending > 0);
        self.reqs_pending -= 1;
        if self.reqs_pending == 0 && self.flags & CLOSING != 0 {
            self.want_endgame();
        }
    }

    #[inline]
    pub fn reqs_pending(&self) -> u32 {
        self.reqs_pending
    }

    /// Begin closing. The caller performs its type-specific shutdown
    /// (cancel I/O, deregister, …) BEFORE calling this, then must not start
    /// new operations. Closing twice is a bug.
    pub fn close(&mut self) {
        assert!(self.flags & CLOSING == 0, "handle closed twice"); // quirk: LOOP-25
        // Every closing handle contributes exactly one to `active_handles`
        // until its endgame runs — even if it was unref'd or never started —
        // so the loop cannot exit between close() and the close callback.
        // quirk: LOOP-27
        if !self.counted() {
            self.flags |= CLOSE_KEEPALIVE;
            self.loop_mut().active_handles_inc();
        }
        self.flags |= CLOSING;
        if self.reqs_pending == 0 {
            self.want_endgame();
        }
    }

    /// Queue this handle's endgame (idempotent). // quirk: LOOP-26
    pub fn want_endgame(&mut self) {
        if self.flags & ENDGAME_QUEUED != 0 {
            return;
        }
        self.flags |= ENDGAME_QUEUED;
        let this: *mut HandleCore = self;
        // SAFETY: `new`s contract — the loop outlives the handle.
        unsafe { (*self.loop_).endgame_push(this) };
    }

    /// Called by the loop's endgame drain. Marks the handle CLOSED, releases
    /// its `active_handles` contribution, and runs the class teardown; after
    /// this returns the handle memory may be freed by its owner.
    pub(crate) unsafe fn run_endgame(this: *mut HandleCore) {
        // SAFETY: the endgame drain passes live queued handles (caller
        // contract); the embedder keeps the handle pinned while closing.
        unsafe {
            let h = &mut *this;
            debug_assert!(h.flags & CLOSING != 0);
            debug_assert!(h.reqs_pending == 0);
            h.flags &= !ENDGAME_QUEUED;
            // Exactly one count is held while closing: either the handle's
            // own (it was active+ref'd at close) or the keep-alive taken by
            // close(). // quirk: LOOP-27
            (*h.loop_).active_handles_dec();
            h.flags &= !(ACTIVE | CLOSE_KEEPALIVE);
            h.flags |= CLOSED;
            (h.endgame)(this);
        }
    }
}
