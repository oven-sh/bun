//! macOS: periodically probes a `BufferedReader` parked on a FIFO (named
//! pipe) for the EOF that its kqueue registration never reports. The kernel
//! side is explained at `bun_sys::select_is_readable`, the reader side at
//! `BufferedReader::set_poll_registered_hook`; this is the timer side, shared
//! by `FileReader` (`Bun.file(fifo).stream()`, a FIFO as stdin) and
//! `FileResponseStream` (`new Response(Bun.file(fifo))`).
//!
//! The owner attaches the probe before starting its reader. Every readiness
//! registration the reader makes arms the probe at the shortest interval (a
//! writer usually closes right after its last write), and each tick that finds
//! the FIFO still parked and silent re-arms with the interval doubled, up to
//! the cap; a tick that finds the reader no longer parked (paused, stopped by
//! the owner, finished) lets the probe lapse, and the next registration starts
//! it again. The owner cancels it when it is finished with the reader.
//!
//! While the timer is active the probe holds one reference on the owner
//! (`Ops::ref_`), released by whichever side takes the timer out of the active
//! state, so a tick always runs against a live owner and reader.

use core::cell::Cell;
use core::ffi::c_void;

use bun_core::{Timespec, TimespecMockMode};
use bun_io::{BufferedReader, PollRegisteredHook};
use bun_jsc::JsCell;

use crate::jsc_hooks::timer_all;
use crate::timer::{EventLoopTimer, EventLoopTimerState, EventLoopTimerTag};

pub(crate) struct FifoEofProbe {
    /// `pub(crate)` for the container_of in the timer dispatch.
    pub(crate) timer: JsCell<EventLoopTimer>,
    interval_ms: Cell<u32>,
    owner: Cell<*mut c_void>,
    reader: Cell<*mut BufferedReader>,
    ops: &'static Ops,
}

/// How the probe keeps its owner alive while armed. Both receive the `owner`
/// pointer passed to [`FifoEofProbe::attach`].
pub(crate) struct Ops {
    pub(crate) ref_: unsafe fn(*mut c_void),
    /// May free the owner, and with it the probe.
    pub(crate) unref: unsafe fn(*mut c_void),
}

const MIN_INTERVAL_MS: u32 = 2;
const MAX_INTERVAL_MS: u32 = 128;

impl FifoEofProbe {
    pub(crate) fn init(ops: &'static Ops) -> Self {
        Self {
            timer: JsCell::new(EventLoopTimer::init_paused(EventLoopTimerTag::FifoEofProbe)),
            interval_ms: Cell::new(MIN_INTERVAL_MS),
            owner: Cell::new(core::ptr::null_mut()),
            reader: Cell::new(core::ptr::null_mut()),
            ops,
        }
    }

    /// Installs the probe on `reader`. Call before the reader is started, so
    /// its first registration is covered too.
    ///
    /// # Safety
    /// `owner` is what `ops` operate on; it and `reader` must embed `self` and
    /// stay at their addresses for as long as the reader lives (both are
    /// fields of the heap-allocated owner at every call site), and the owner
    /// must [`cancel`](Self::cancel) before it stops being usable.
    pub(crate) unsafe fn attach(&self, owner: *mut c_void, reader: *mut BufferedReader) {
        self.owner.set(owner);
        self.reader.set(reader);
        // SAFETY: caller contract; the hook's `ctx` is `self`, which the
        // caller keeps alive alongside the reader.
        unsafe {
            (*reader).set_poll_registered_hook(PollRegisteredHook {
                callback: Self::on_poll_registered,
                ctx: core::ptr::from_ref(self).cast_mut().cast(),
            });
        }
    }

    unsafe fn on_poll_registered(ctx: *mut c_void) {
        // SAFETY: `ctx` was set to the probe in `attach`, whose contract keeps
        // it alive for the reader's lifetime; all fields are interior-mutable.
        let this = unsafe { &*ctx.cast::<Self>() };
        this.arm();
    }

    /// The reader just parked itself on a registration: (re)start probing at
    /// the shortest interval.
    fn arm(&self) {
        let timer_all = timer_all();
        if timer_all.is_null() {
            return;
        }
        let timer = self.timer.as_ptr();
        self.interval_ms.set(MIN_INTERVAL_MS);
        // SAFETY: single-threaded event loop; `timer` is the node embedded in
        // `self`. An ACTIVE timer already holds the owner ref (see module
        // doc) and is merely rescheduled; any other state takes a fresh one.
        unsafe {
            if (*timer).state != EventLoopTimerState::ACTIVE {
                (self.ops.ref_)(self.owner.get());
            }
            (*timer_all).update(timer, &Self::deadline(MIN_INTERVAL_MS));
        }
    }

    /// The owner is finished with its reader. Safe to call whether or not the
    /// probe was ever attached or armed, and from inside a tick's own read
    /// dispatch.
    pub(crate) fn cancel(&self) {
        let timer = self.timer.as_ptr();
        // SAFETY: single-threaded event loop; `timer` is embedded in `self`.
        match unsafe { (*timer).state } {
            EventLoopTimerState::ACTIVE => {
                let timer_all = timer_all();
                if !timer_all.is_null() {
                    // SAFETY: as above; `remove` leaves the timer CANCELLED.
                    unsafe { (*timer_all).remove(timer) };
                } else {
                    // SAFETY: as above. Teardown: the heap is gone already.
                    unsafe { (*timer).state = EventLoopTimerState::CANCELLED };
                }
                // Releases the armed ref. Every caller reaches this from a
                // path that holds its own reference on the owner (a reader
                // dispatch, a JS call, a uWS callback), so this does not free.
                // SAFETY: paired with the `ref_` taken in `arm`.
                unsafe { (self.ops.unref)(self.owner.get()) };
            }
            EventLoopTimerState::FIRED => {
                // Mid-tick: `on_fire` owns the armed ref and releases it once
                // it sees this instead of re-arming.
                // SAFETY: as above.
                unsafe { (*timer).state = EventLoopTimerState::CANCELLED };
            }
            _ => {}
        }
    }

    /// Timer dispatch target (`EventLoopTimerTag::FifoEofProbe`).
    ///
    /// # Safety
    /// `this` was recovered from the timer node just popped from the heap,
    /// on the event-loop thread; the armed ref keeps the owner, and so
    /// `*this`, alive until this function releases it.
    pub(crate) unsafe fn on_fire(this: *mut Self) {
        // SAFETY: caller contract. Every field is interior-mutable, so the
        // re-entrant `arm`/`cancel` calls the read dispatch below can make go
        // through this same shared reference.
        let this = unsafe { &*this };
        let timer = this.timer.as_ptr();
        // SAFETY: caller contract; the node is out of the heap, so this is
        // the standard fired-timer bookkeeping before any re-arm.
        unsafe {
            (*timer).state = EventLoopTimerState::FIRED;
            (*timer).heap = Default::default();
        }
        let (owner, ops) = (this.owner.get(), this.ops);

        // SAFETY: `attach`'s contract; the armed ref keeps the owner live
        // across whatever the dispatch does to it.
        let parked = unsafe { BufferedReader::probe_fifo_eof(this.reader.get()) };

        // The dispatch may have re-registered (the hook re-armed us at the
        // minimum interval, with its own ref) or cancelled us; only a timer
        // still in the fired state is ours to back off and re-arm.
        // SAFETY: `this` is still live (the ref is released below).
        if parked && unsafe { (*timer).state } == EventLoopTimerState::FIRED {
            let timer_all = timer_all();
            if !timer_all.is_null() {
                let next = (this.interval_ms.get() * 2).min(MAX_INTERVAL_MS);
                this.interval_ms.set(next);
                // SAFETY: as in `arm`. Re-arming carries the armed ref over.
                unsafe { (*timer_all).update(timer, &Self::deadline(next)) };
                return;
            }
        }

        // Lapsing (or someone else owns the current arming): release the ref
        // this arming held. Tail position: it may free the owner and `*this`.
        // SAFETY: paired with the `ref_` taken when this arming was made.
        unsafe { (ops.unref)(owner) };
    }

    fn deadline(interval_ms: u32) -> Timespec {
        // This tag opts out of fake timers, so the deadline is in real time.
        Timespec::ms_from_now(TimespecMockMode::ForceRealTime, i64::from(interval_ms))
    }
}

impl Drop for FifoEofProbe {
    fn drop(&mut self) {
        // An armed probe holds a ref on the owner, so the owner cannot be
        // dropped while it is armed unless a terminal path forgot to cancel.
        debug_assert!(self.timer.get().state != EventLoopTimerState::ACTIVE);
    }
}
