//! Segmented GC-root table for armed `setTimeout`/`setInterval`/`setImmediate`
//! wrappers.
//!
//! Each armed timer needs its JS wrapper kept reachable so the cached
//! `callback`/`arguments` fields survive until the timer fires. Holding a
//! per-timer `Strong` handle works, but JSC walks the entire strong-handle
//! list on every collection including eden, so N armed timers cost O(N) on
//! every eden GC.
//!
//! Wrappers are stored in fixed-size `JSTimerRootSegment` cells
//! (see `src/jsc/bindings/JSTimerRootSegment.cpp`). Each segment holds 4096
//! `WriteBarrier<Unknown>` slots plus a `WTF::BitSet<4096>` occupancy map.
//! Active segments form a singly-linked list whose head is a `WriteBarrier` on
//! `ZigGlobalObject` visited by `GlobalObject::visitChildren`, so no strong
//! handle is held for any segment. A barriered slot store dirties only that
//! segment, so an eden collection re-scans only segments touched since the
//! last full GC. When a segment's occupancy drops to zero it is unlinked and
//! parked in a single spare slot on the global (or dropped for GC if the spare
//! is taken), so the table shrinks after a burst.
//!
//! Slot handles are `(segment cell pointer, index)` stored directly on the
//! timer (JSC does not relocate cells); this side only caches the segment most
//! recently handed out so the common path skips the C++ list walk.

use core::cell::Cell;
use core::ptr::NonNull;

use crate::jsc::{JSGlobalObject, JSValue};

bun_opaque::opaque_ffi! {
    /// `Bun::JSTimerRootSegment*`. Opaque on the Rust side; addresses are
    /// stable while the segment is on the global's active list because JSC
    /// does not move cells.
    pub struct Segment;
}

unsafe extern "C" {
    safe fn Bun__TimerRootSegment__acquire(global: &JSGlobalObject) -> *mut Segment;
    safe fn Bun__TimerRootSegment__set(segment: &Segment, index: u32, value: JSValue);
    safe fn Bun__TimerRootSegment__clear(
        global: &JSGlobalObject,
        segment: &Segment,
        index: u32,
    ) -> bool;
    safe fn Bun__TimerRootSegment__findFreeSlot(segment: &Segment) -> u32;
    safe fn Bun__TimerRootSegment__clearAll(global: &JSGlobalObject);
}

/// Must match `JSTimerRootSegment::capacity`.
const SEGMENT_CAPACITY: u32 = 4096;

/// Handle to an occupied root-table slot, stored on `TimerObjectInternals`.
#[derive(Copy, Clone, Default)]
pub struct RootSlot {
    segment: Option<NonNull<Segment>>,
    index: u16,
}

impl RootSlot {
    #[inline]
    pub(super) fn is_none(self) -> bool {
        self.segment.is_none()
    }
}

#[derive(Default)]
pub struct RootTable {
    /// Segment most recently returned by `acquire`; checked first on `arm` to
    /// skip the C++ list walk while it still has room.
    cursor: Cell<Option<NonNull<Segment>>>,
    /// Set by [`clear`] at VM teardown; later `disarm` calls no-op so a stale
    /// [`RootSlot`] never touches a collected segment.
    cleared: Cell<bool>,
}

impl RootTable {
    /// Root `wrapper` and return a handle to its slot. JS thread only.
    pub(super) fn arm(&self, wrapper: JSValue, global: &JSGlobalObject) -> RootSlot {
        debug_assert!(wrapper.is_cell());
        debug_assert!(!self.cleared.get());

        let (segment, index) = self.find_slot(global);
        Bun__TimerRootSegment__set(Segment::opaque_ref(segment.as_ptr()), index, wrapper);
        RootSlot {
            segment: Some(segment),
            index: index as u16,
        }
    }

    /// Clear `slot` and return it to its segment's occupancy map. The segment
    /// is released back to the global's spare slot (or dropped) if this was
    /// its last occupant. No-op for an empty handle and after [`clear`]. JS
    /// thread only.
    pub(super) fn disarm(&self, slot: RootSlot, global: &JSGlobalObject) {
        let Some(segment) = slot.segment else { return };
        if self.cleared.get() {
            return;
        }
        let released = Bun__TimerRootSegment__clear(
            global,
            Segment::opaque_ref(segment.as_ptr()),
            u32::from(slot.index),
        );
        if released && self.cursor.get() == Some(segment) {
            // The cursor pointed at a released segment; drop it so the next
            // `arm` re-walks from the head.
            self.cursor.set(None);
        }
    }

    /// Drop both segment references from `ZigGlobalObject` so wrappers become
    /// collectible at VM teardown.
    pub(super) fn clear(&self, global: &JSGlobalObject) {
        Bun__TimerRootSegment__clearAll(global);
        self.cursor.set(None);
        self.cleared.set(true);
    }

    fn find_slot(&self, global: &JSGlobalObject) -> (NonNull<Segment>, u32) {
        if let Some(segment) = self.cursor.get() {
            let idx = Bun__TimerRootSegment__findFreeSlot(Segment::opaque_ref(segment.as_ptr()));
            if idx < SEGMENT_CAPACITY {
                return (segment, idx);
            }
        }
        let segment = NonNull::new(Bun__TimerRootSegment__acquire(global))
            .expect("JSTimerRootSegment allocation");
        self.cursor.set(Some(segment));
        let idx = Bun__TimerRootSegment__findFreeSlot(Segment::opaque_ref(segment.as_ptr()));
        debug_assert!(idx < SEGMENT_CAPACITY);
        (segment, idx)
    }
}
