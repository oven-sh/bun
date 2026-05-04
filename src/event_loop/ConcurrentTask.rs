//! A task that runs concurrently in the work pool.
//!
//! This is used to run tasks that are CPU-intensive or blocking on the work pool.
//! It's also used to run tasks that need to be run on a different thread than the main JavaScript thread.
//!
//! The task is run on a thread pool and then the result is returned to the main JavaScript thread.
//!
//! If `auto_delete` is true, the task is automatically deallocated when it's finished.
//! Otherwise, it's expected that the containing struct will deallocate the task.

use core::sync::atomic::{AtomicUsize, Ordering};

use bun_jsc::{ManagedTask, Task};
// TODO(port): confirm crate for UnboundedQueue (bun.UnboundedQueue) — assuming bun_threading
use bun_threading::UnboundedQueue;

#[repr(C)]
pub struct ConcurrentTask {
    pub task: Task,
    /// Packed representation of the next pointer and auto_delete flag.
    /// Uses the low bit to store auto_delete (since pointers are at least 2-byte aligned).
    pub next: PackedNextPtr,
}

impl Default for ConcurrentTask {
    fn default() -> Self {
        Self {
            // SAFETY: matches Zig `task: Task = undefined` — caller must set before use.
            task: unsafe { core::mem::zeroed() },
            next: PackedNextPtr::NONE,
        }
    }
}

/// Packed next pointer that encodes both the next ConcurrentTask pointer and the auto_delete flag.
/// Uses the low bit for auto_delete since ConcurrentTask pointers are at least 2-byte aligned.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub struct PackedNextPtr(usize);

impl PackedNextPtr {
    pub const NONE: Self = Self(0);
    pub const AUTO_DELETE: Self = Self(1);

    #[inline]
    pub fn init(ptr: Option<*mut ConcurrentTask>, auto_del: bool) -> PackedNextPtr {
        let ptr_bits = match ptr {
            Some(p) => p as usize,
            None => 0,
        };
        Self(ptr_bits | (auto_del as usize))
    }

    #[inline]
    pub fn get_ptr(self) -> Option<*mut ConcurrentTask> {
        let addr = self.0 & !1usize;
        if addr == 0 {
            None
        } else {
            Some(addr as *mut ConcurrentTask)
        }
    }

    #[inline]
    pub fn set_ptr(&mut self, ptr: Option<*mut ConcurrentTask>) {
        let auto_del = self.0 & 1;
        let ptr_bits = match ptr {
            Some(p) => p as usize,
            None => 0,
        };
        *self = Self(ptr_bits | auto_del);
    }

    #[inline]
    pub fn is_auto_delete(self) -> bool {
        (self.0 & 1) != 0
    }

    #[inline]
    pub fn atomic_load_ptr(&self, ordering: Ordering) -> Option<*mut ConcurrentTask> {
        // SAFETY: PackedNextPtr is #[repr(transparent)] over usize; casting &self to
        // *const AtomicUsize is layout-valid and matches Zig's @atomicLoad on @ptrCast(self).
        let value = unsafe { (*(self as *const Self as *const AtomicUsize)).load(ordering) };
        let addr = value & !1usize;
        if addr == 0 {
            None
        } else {
            Some(addr as *mut ConcurrentTask)
        }
    }

    #[inline]
    pub fn atomic_store_ptr(&mut self, ptr: Option<*mut ConcurrentTask>, ordering: Ordering) {
        let ptr_bits = match ptr {
            Some(p) => p as usize,
            None => 0,
        };
        // auto_delete is immutable after construction, so we can safely read it
        // with a relaxed load and preserve it in the new value.
        // SAFETY: PackedNextPtr is #[repr(transparent)] over usize; cast is layout-valid.
        let self_ptr = unsafe { &*(self as *mut Self as *const AtomicUsize) };
        let auto_del_bit = self_ptr.load(Ordering::Relaxed) & 1;
        self_ptr.store(ptr_bits | auto_del_bit, ordering);
    }
}

const _: () = assert!(
    core::mem::size_of::<ConcurrentTask>() == 16,
    "ConcurrentTask should be 16 bytes"
);
// PackedNextPtr stores a pointer in the upper bits and auto_delete in bit 0.
// This requires ConcurrentTask to be at least 2-byte aligned.
const _: () = assert!(
    core::mem::align_of::<ConcurrentTask>() >= 2,
    "ConcurrentTask must be at least 2-byte aligned for pointer packing"
);

// TODO(port): UnboundedQueue's second param `.next` is the intrusive link field name.
// Rust side will need an intrusive-link trait or `offset_of!(ConcurrentTask, next)`.
pub type Queue = UnboundedQueue<ConcurrentTask>;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum AutoDeinit {
    ManualDeinit,
    AutoDeinit,
}

impl ConcurrentTask {
    /// `bun.TrivialNew(@This())` — heap-allocate a ConcurrentTask and return a raw pointer.
    /// The pointer is intrusive (linked into `Queue`), so we use `Box::into_raw` rather than `Box<T>`.
    #[inline]
    pub fn new(init: ConcurrentTask) -> *mut ConcurrentTask {
        Box::into_raw(Box::new(init))
    }

    /// `bun.TrivialDeinit(@This())` — free a ConcurrentTask previously returned by `new`.
    ///
    /// # Safety
    /// `this` must have been produced by `ConcurrentTask::new` and not yet freed.
    #[inline]
    pub unsafe fn deinit(this: *mut ConcurrentTask) {
        // SAFETY: caller contract above.
        drop(unsafe { Box::from_raw(this) });
    }

    pub fn create(task: Task) -> *mut ConcurrentTask {
        ConcurrentTask::new(ConcurrentTask {
            task,
            next: PackedNextPtr::AUTO_DELETE,
        })
    }

    pub fn create_from<T>(task: T) -> *mut ConcurrentTask {
        bun_jsc::mark_binding!();
        Self::create(Task::init(task))
    }

    // TODO(port): `comptime callback: anytype` + `std.meta.Child(@TypeOf(ptr))` is comptime
    // reflection. Modeled here as a generic over the pointee type `T` with a plain fn-pointer
    // callback. ManagedTask::New(T, callback).init(ptr) likely becomes ManagedTask::new::<T>.
    pub fn from_callback<T>(ptr: *mut T, callback: fn(*mut T)) -> *mut ConcurrentTask {
        bun_jsc::mark_binding!();
        Self::create(ManagedTask::new::<T>(callback).init(ptr))
    }

    pub fn from<T>(&mut self, of: T, auto_deinit: AutoDeinit) -> &mut ConcurrentTask {
        bun_jsc::mark_binding!();
        *self = ConcurrentTask {
            task: Task::init(of),
            next: if auto_deinit == AutoDeinit::AutoDeinit {
                PackedNextPtr::AUTO_DELETE
            } else {
                PackedNextPtr::NONE
            },
        };
        self
    }

    /// Returns whether this task should be automatically deallocated after execution.
    pub fn auto_delete(&self) -> bool {
        self.next.is_auto_delete()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/ConcurrentTask.zig (121 lines)
//   confidence: medium
//   todos:      3
//   notes:      UnboundedQueue intrusive field param + ManagedTask::New comptime reflection need Phase B wiring; mark_binding! assumed macro
// ──────────────────────────────────────────────────────────────────────────
