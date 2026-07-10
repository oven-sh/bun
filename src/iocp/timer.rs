#![cfg(windows)]

//! Loop timers with lazy cancellation.
//!
//! Backend-owned timers (the uSockets sweep/QUIC/date-header timers,
//! spawnSync timeouts) number in the handfuls, so a binary heap with
//! generation-tagged entries — stale entries are skipped on pop instead of
//! removed in place — is the simplest honest shape. JS timers do not live
//! here: `runtime/timer` keeps its own wheel and drives the loop through the
//! tick timeout. Ties break by arm order (FIFO), matching libuv's start_id
//! tiebreak so equal-deadline callbacks fire in the order they were set.
//!
//! Precision policy: never call `timeBeginPeriod` — timer coarseness (up to
//! one ~15.6 ms scheduler tick) is the contract, matching Node; the tick's
//! deadline re-arm guarantees "never early", not "sub-tick precise".
//! // quirk: ADD-02

use std::cmp::Reverse;
use std::collections::BinaryHeap;

use crate::event_loop::Loop;

/// Fired-timer callback. Receives the loop (re-lent, so callbacks may freely
/// arm/stop timers and drive the loop) plus the `data` it was armed with.
pub type TimerCb = unsafe fn(&mut Loop, *mut core::ffi::c_void);

/// A timer slot handle owned by its embedder. The loop stores only
/// slot indices + generations, never pointers into the embedder; armed state
/// lives in the slot (query via `Loop::timer_armed` — a one-shot disarms
/// itself when it fires, which the handle cannot observe).
pub struct Timer {
    slot: usize,
}

impl Timer {
    pub const fn new() -> Timer {
        Timer { slot: usize::MAX }
    }
}

impl Default for Timer {
    fn default() -> Timer {
        Timer::new()
    }
}

struct Slot {
    /// Bumped on every stop/re-arm; heap entries with a stale generation are
    /// tombstones, skipped on pop.
    generation: u64,
    cb: TimerCb,
    data: *mut core::ffi::c_void,
    /// 0 = one-shot.
    repeat_ms: u64,
    armed: bool,
}

#[derive(Eq, PartialEq, Ord, PartialOrd)]
struct Entry {
    due_ms: u64,
    /// FIFO tiebreak for equal deadlines.
    seq: u64,
    slot: usize,
    generation: u64,
}

pub(crate) struct Timers {
    heap: BinaryHeap<Reverse<Entry>>,
    slots: Vec<Slot>,
    free_slots: Vec<usize>,
    next_seq: u64,
}

impl Timers {
    pub(crate) fn new() -> Timers {
        Timers {
            heap: BinaryHeap::new(),
            slots: Vec::new(),
            free_slots: Vec::new(),
            next_seq: 0,
        }
    }

    /// Arm (or re-arm) `timer` to fire at `now + timeout_ms`, then every
    /// `repeat_ms` (0 = one-shot). Re-arming replaces the previous deadline.
    pub(crate) fn start(
        &mut self,
        timer: &mut Timer,
        cb: TimerCb,
        data: *mut core::ffi::c_void,
        now_ms: u64,
        timeout_ms: u64,
        repeat_ms: u64,
    ) {
        if timer.slot == usize::MAX {
            timer.slot = match self.free_slots.pop() {
                Some(i) => i,
                None => {
                    self.slots.push(Slot {
                        generation: 0,
                        cb,
                        data,
                        repeat_ms: 0,
                        armed: false,
                    });
                    self.slots.len() - 1
                }
            };
        }
        let slot = &mut self.slots[timer.slot];
        slot.generation += 1;
        slot.cb = cb;
        slot.data = data;
        slot.repeat_ms = repeat_ms;
        slot.armed = true;
        let generation = slot.generation;
        self.push_entry(timer.slot, generation, now_ms.saturating_add(timeout_ms));
    }

    /// Disarm. Heap entries become tombstones; the slot stays reserved for
    /// the timer's lifetime.
    pub(crate) fn stop(&mut self, timer: &mut Timer) {
        if timer.slot != usize::MAX {
            let slot = &mut self.slots[timer.slot];
            slot.generation += 1;
            slot.armed = false;
        }
    }

    pub(crate) fn armed(&self, timer: &Timer) -> bool {
        timer.slot != usize::MAX && self.slots[timer.slot].armed
    }

    /// Release the timer's slot entirely (owner is destroying it).
    pub(crate) fn release(&mut self, timer: &mut Timer) {
        self.stop(timer);
        if timer.slot != usize::MAX {
            self.free_slots.push(timer.slot);
            timer.slot = usize::MAX;
        }
    }

    /// Equal deadlines fire FIFO via the monotonically increasing seq
    /// tiebreak. // quirk: LOOP-43
    fn push_entry(&mut self, slot: usize, generation: u64, due_ms: u64) {
        let seq = self.next_seq;
        self.next_seq += 1;
        self.heap.push(Reverse(Entry {
            due_ms,
            seq,
            slot,
            generation,
        }));
    }

    /// Milliseconds until the next live deadline (0 if already due), or
    /// `None` when no timer is armed. Pops tombstones encountered on the way.
    pub(crate) fn next_due_in(&mut self, now_ms: u64) -> Option<u64> {
        loop {
            let Reverse(top) = self.heap.peek()?;
            let slot = &self.slots[top.slot];
            if !slot.armed || slot.generation != top.generation {
                self.heap.pop();
                continue;
            }
            return Some(top.due_ms.saturating_sub(now_ms));
        }
    }

    /// Pop the next timer due at `now_ms`, handling tombstones and repeat
    /// re-arm internally. Returns the callback to invoke plus its
    /// (slot, generation) identity for the dispatch-time liveness re-check —
    /// the borrow of the timer state ends before the caller fires it, so
    /// callbacks can re-enter freely. A `stop()` from inside a repeat
    /// callback wins: the re-arm happened under the pre-callback generation,
    /// which the stop tombstones.
    pub(crate) fn pop_due(&mut self, now_ms: u64) -> Option<Due> {
        loop {
            let Reverse(top) = self.heap.peek()?;
            if top.due_ms > now_ms {
                return None;
            }
            let Reverse(entry) = self.heap.pop().unwrap();
            let slot = &mut self.slots[entry.slot];
            if !slot.armed || slot.generation != entry.generation {
                continue; // tombstone
            }
            let (cb, data, repeat) = (slot.cb, slot.data, slot.repeat_ms);
            if repeat > 0 {
                self.push_entry(entry.slot, entry.generation, now_ms + repeat);
            } else {
                slot.armed = false;
            }
            return Some(Due {
                cb,
                data,
                slot: entry.slot,
                generation: entry.generation,
            });
        }
    }

    /// Whether a collected firing is still current at dispatch time: a
    /// `stop()` or restart from an earlier callback in the same batch bumps
    /// the generation, voiding entries collected before it. // quirk: LOOP-44
    pub(crate) fn is_current(&self, slot: usize, generation: u64) -> bool {
        self.slots[slot].generation == generation
    }
}

/// One collected due firing (see [`Timers::pop_due`]).
pub(crate) struct Due {
    pub(crate) cb: TimerCb,
    pub(crate) data: *mut core::ffi::c_void,
    pub(crate) slot: usize,
    pub(crate) generation: u64,
}
