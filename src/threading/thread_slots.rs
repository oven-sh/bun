//! Per-thread values for the threads cooperating on one job: each thread
//! lazily creates its own value the first time it asks and is the only thread
//! that uses it; the job's owner reclaims them all at the end.

use core::cell::UnsafeCell;
use core::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

struct Slot<T> {
    /// Thread id of the claimant; `0` while unclaimed.
    owner: AtomicU64,
    /// A guard is live on the owning thread.
    in_use: AtomicBool,
    value: UnsafeCell<Option<Box<T>>>,
}

/// `capacity` values addressed by calling thread. [`get_or_init`](Self::get_or_init)
/// hands the calling thread exclusive use of its own value; [`take_all`](Self::take_all)
/// (`&mut self`) hands every value to the owner. A value is created and used
/// on the one thread that claimed its slot, then moved out (and dropped) by
/// the slots' owner — hence `T: Send`.
pub struct ThreadSlots<T: Send> {
    slots: Box<[Slot<T>]>,
    claimed: AtomicUsize,
    /// Unique per instance: keys the per-thread slot-index cache.
    id: u64,
}

// SAFETY: through `&self` a thread only reaches the slot it claimed (matched by
// its own thread id / its own thread-local cache), so no slot's `value` is
// touched by two threads; `take_all`/drop need `&mut self`/ownership, and the
// cross-thread move they perform is what `T: Send` vouches for.
unsafe impl<T: Send> Sync for ThreadSlots<T> {}
// SAFETY: as above — owning the set means owning every `T` in it.
unsafe impl<T: Send> Send for ThreadSlots<T> {}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// `(ThreadSlots::id, slot index)` last used on this thread. `0` never matches.
#[thread_local]
static CURRENT: core::cell::Cell<(u64, usize)> = core::cell::Cell::new((0, 0));

impl<T: Send> ThreadSlots<T> {
    pub fn new(capacity: usize) -> Self {
        Self {
            slots: (0..capacity)
                .map(|_| Slot {
                    owner: AtomicU64::new(0),
                    in_use: AtomicBool::new(false),
                    value: UnsafeCell::new(None),
                })
                .collect(),
            claimed: AtomicUsize::new(0),
            id: NEXT_ID.fetch_add(1, Ordering::Relaxed),
        }
    }

    #[inline]
    fn my_slot(&self) -> (usize, &Slot<T>) {
        let (id, index) = CURRENT.get();
        if id == self.id {
            return (index, &self.slots[index]);
        }
        self.my_slot_slow()
    }

    #[cold]
    fn my_slot_slow(&self) -> (usize, &Slot<T>) {
        let me = crate::current_thread_id();
        let claimed = self.claimed.load(Ordering::Acquire).min(self.slots.len());
        for (index, slot) in self.slots[..claimed].iter().enumerate() {
            if slot.owner.load(Ordering::Acquire) == me {
                CURRENT.set((self.id, index));
                return (index, slot);
            }
        }
        let index = self.claimed.fetch_add(1, Ordering::AcqRel);
        // Indexing panics if more threads ask than the set was sized for.
        let slot = &self.slots[index];
        slot.owner.store(me, Ordering::Release);
        CURRENT.set((self.id, index));
        (index, slot)
    }

    /// Exclusive use of the calling thread's value for the guard's lifetime,
    /// creating it with `init(slot_index)` on this thread's first call. Panics
    /// if this thread already holds a guard from this set.
    #[inline]
    pub fn get_or_init(&self, init: impl FnOnce(usize) -> T) -> SlotGuard<'_, T> {
        let (index, slot) = self.my_slot();
        assert!(
            !slot.in_use.swap(true, Ordering::Relaxed),
            "ThreadSlots: re-entered on the thread that already holds its value"
        );
        // SAFETY: this thread owns `slot` (see `Sync`) and `in_use` was clear,
        // so no other reference into `value` exists.
        let value = unsafe { &mut *slot.value.get() };
        let value: &mut T = value.get_or_insert_with(|| Box::new(init(index)));
        SlotGuard { value, slot }
    }

    /// Every value created so far, moved out; the slots stay claimed.
    pub fn take_all(&mut self) -> impl Iterator<Item = Box<T>> + '_ {
        self.slots.iter_mut().filter_map(|slot| {
            debug_assert!(!*slot.in_use.get_mut());
            slot.value.get_mut().take()
        })
    }
}

/// The calling thread's value, exclusively, until dropped.
pub struct SlotGuard<'a, T> {
    value: &'a mut T,
    slot: &'a Slot<T>,
}

impl<T> core::ops::Deref for SlotGuard<'_, T> {
    type Target = T;
    #[inline]
    fn deref(&self) -> &T {
        self.value
    }
}

impl<T> core::ops::DerefMut for SlotGuard<'_, T> {
    #[inline]
    fn deref_mut(&mut self) -> &mut T {
        self.value
    }
}

impl<T> Drop for SlotGuard<'_, T> {
    #[inline]
    fn drop(&mut self) {
        self.slot.in_use.store(false, Ordering::Relaxed);
    }
}
