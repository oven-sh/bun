//! A simple wrapper around an integer reference count. This type doesn't do any
//! memory management itself.
//!
//! May be useful for implementing the interface required by `ExternalShared`.
//!
//! Two concrete structs rather than one generic (stable Rust cannot vary a
//! field's type from a const generic, and there is no generic `Atomic<Int>`):
//!   `RawRefCount`       — single-threaded, plain `u32`, debug `ThreadLock`
//!   `RawAtomicRefCount` — thread-safe, `AtomicU32`
//! plus a `const ATOMIC: bool` alias for callers that select by flag.

use core::sync::atomic::{AtomicU32, Ordering};

#[cfg(debug_assertions)]
use bun_core::ThreadLock;

#[derive(PartialEq, Eq, Clone, Copy)]
pub enum ThreadSafety {
    SingleThreaded,
    ThreadSafe,
}

#[derive(PartialEq, Eq)]
pub enum DecrementResult {
    KeepAlive,
    ShouldDestroy,
}

/// `RawRefCount(u32, .single_threaded)`.
pub struct RawRefCount {
    raw_value: u32,
    #[cfg(debug_assertions)]
    thread_lock: ThreadLock,
}

impl RawRefCount {
    /// Usually the initial count should be 1.
    pub fn init(initial_count: u32) -> Self {
        Self {
            raw_value: initial_count,
            #[cfg(debug_assertions)]
            thread_lock: ThreadLock::init_locked_if_non_comptime(),
        }
    }

    pub fn increment(&mut self) {
        #[cfg(debug_assertions)]
        self.thread_lock.lock_or_assert();
        self.raw_value += 1;
    }

    pub fn decrement(&mut self) -> DecrementResult {
        #[cfg(debug_assertions)]
        self.thread_lock.lock_or_assert();
        self.raw_value -= 1;
        if self.raw_value == 0 {
            DecrementResult::ShouldDestroy
        } else {
            DecrementResult::KeepAlive
        }
    }

    /// Avoid calling this method when possible. Reasoning about ref counts can be tricky;
    /// you should usually only need `increment` and `decrement`.
    pub fn unsafe_get_value(&self) -> u32 {
        self.raw_value
    }
}

/// `RawRefCount(u32, .thread_safe)`.
#[repr(transparent)]
pub struct RawAtomicRefCount {
    raw_value: AtomicU32,
}

impl RawAtomicRefCount {
    /// Usually the initial count should be 1.
    pub const fn init(initial_count: u32) -> Self {
        Self {
            raw_value: AtomicU32::new(initial_count),
        }
    }

    pub fn increment(&self) {
        let old = self.raw_value.fetch_add(1, Ordering::Relaxed); // .monotonic
        debug_assert!(old != u32::MAX, "overflow of thread-safe ref count");
    }

    pub fn decrement(&self) -> DecrementResult {
        // Release decrement, acquire fence on the last reference (below).
        let old = self.raw_value.fetch_sub(1, Ordering::Release);
        debug_assert!(old != 0, "underflow of thread-safe ref count");
        if old == 1 {
            core::sync::atomic::fence(Ordering::Acquire);
            DecrementResult::ShouldDestroy
        } else {
            DecrementResult::KeepAlive
        }
    }

    /// Avoid calling this method when possible. Reasoning about ref counts can be tricky;
    /// you should usually only need `increment` and `decrement`.
    pub fn unsafe_get_value(&self) -> u32 {
        self.raw_value.load(Ordering::Acquire)
    }
}

// NOTE: there is no `RawRefCountT<const ATOMIC: bool>` alias. A type alias
// cannot dispatch on the const param on stable Rust, so any such alias would
// silently resolve to one variant regardless of the bool — a footgun. Callers
// must pick `RawRefCount` (single-thread) vs `RawAtomicRefCount` explicitly.
