//! Segmented GC-root table for armed `setTimeout`/`setInterval`/`setImmediate`
//! wrappers.
//!
//! Each armed timer needs its JS wrapper kept reachable so the cached
//! `callback`/`arguments` fields survive until the timer fires. Holding a
//! per-timer `Strong` handle works, but JSC walks the entire strong-handle
//! list on every collection including eden, so N armed timers cost O(N) on
//! every eden GC.
//!
//! This table stores wrappers in fixed-size `JSTimerRootSegment` cells
//! (see `src/jsc/bindings/JSTimerRootSegment.cpp`). Each segment holds 4096
//! `WriteBarrier<Unknown>` slots and is itself rooted via one `Strong`. A
//! barriered slot store dirties only that segment, so an eden collection
//! re-scans only the segments touched since the last full GC; idle segments
//! stay old-gen-marked and are skipped. For 1M armed timers that is ~244
//! strong handles instead of 1M.

use crate::jsc::{JSGlobalObject, JSValue, strong::Strong};

unsafe extern "C" {
    safe fn Bun__TimerRootSegment__create(global: &JSGlobalObject) -> JSValue;
    safe fn Bun__TimerRootSegment__set(segment: JSValue, index: u32, value: JSValue);
    safe fn Bun__TimerRootSegment__clear(segment: JSValue, index: u32);
}

/// Must match `JSTimerRootSegment::capacity`.
const SEGMENT_CAPACITY: u32 = 4096;

/// Sentinel for "no slot" in `TimerObjectInternals::root_slot`.
pub(super) const NO_SLOT: u32 = u32::MAX;

#[derive(Default)]
pub struct RootTable {
    /// One `Strong` per segment; `segments[i].get()` is the `JSTimerRootSegment`
    /// cell backing slots `[i * 4096, (i + 1) * 4096)`.
    segments: Vec<Strong>,
    /// Released slot indices, LIFO. Reusing the most recently freed slot keeps
    /// writes clustered in already-dirty segments.
    free: Vec<u32>,
    /// High-water mark: slots `[0, len)` have been handed out at least once.
    len: u32,
}

impl RootTable {
    /// Root `wrapper` and return its slot index. JS thread only.
    pub(super) fn arm(&mut self, wrapper: JSValue, global: &JSGlobalObject) -> u32 {
        debug_assert!(wrapper.is_cell());
        let slot = match self.free.pop() {
            Some(slot) => slot,
            None => {
                let slot = self.len;
                self.len = self
                    .len
                    .checked_add(1)
                    .expect("timer root table slot overflow");
                slot
            }
        };
        let seg = (slot / SEGMENT_CAPACITY) as usize;
        let idx = slot % SEGMENT_CAPACITY;
        if seg >= self.segments.len() {
            debug_assert_eq!(seg, self.segments.len());
            let cell = Bun__TimerRootSegment__create(global);
            self.segments.push(Strong::create(cell, global));
        }
        Bun__TimerRootSegment__set(self.segments[seg].get(), idx, wrapper);
        slot
    }

    /// Clear `slot` and return it to the freelist. No-op for [`NO_SLOT`] and
    /// for slots whose segment has already been released by [`clear`]. JS
    /// thread only.
    pub(super) fn disarm(&mut self, slot: u32) {
        if slot == NO_SLOT {
            return;
        }
        let seg = (slot / SEGMENT_CAPACITY) as usize;
        let idx = slot % SEGMENT_CAPACITY;
        let Some(segment) = self.segments.get(seg) else {
            // `clear()` ran at VM teardown; the slot is already released.
            return;
        };
        Bun__TimerRootSegment__clear(segment.get(), idx);
        self.free.push(slot);
    }

    /// Drop all segment `Strong`s so JSC teardown does not see live handles
    /// from the per-thread `RuntimeState`. Slot contents become unreachable;
    /// the wrappers are freed by the final GC sweep.
    pub(super) fn clear(&mut self) {
        self.segments.clear();
        self.free.clear();
        self.len = 0;
    }
}
