//! A simple wrapper around an integer reference count. This type doesn't do any
//! memory management itself.
//!
//! May be useful for implementing the interface required by `ExternalShared`.
//!
//! PORT NOTE: Zig's `RawRefCount(Int, thread_safety)` is a comptime type
//! function selecting field types from an enum. Stable Rust cannot vary a
//! field's type from a const generic, and there is no generic `Atomic<Int>`.
//! Split into two concrete structs (the only `Int` ever used is `u32`):
//!   `RawRefCount`       — single-threaded, plain `u32`, debug `ThreadLock`
//!   `RawAtomicRefCount` — thread-safe, `AtomicU32`
//! and a `const ATOMIC: bool` alias for callers that want the Zig spelling.

use core::sync::atomic::{AtomicU32, Ordering};

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
        // Zig: `fetchSub(1, .release)` then `if new == 0 { fence(.acquire) }`.
        let old = self.raw_value.fetch_sub(1, Ordering::Release);
        if cfg!(debug_assertions) || cfg!(windows) {
            // Always-on on Windows while #53265 fs-promises-writeFile is being
            // root-caused: an over-deref in release destroys the object twice;
            // the second destroy (from JSSink ~dtor → FileSink__finalize) reads
            // freed memory and the resulting `Strong<Impl>* corrupted (0x1)`
            // assert in Strong::destroy is too late to identify the *first*
            // call site that dropped the count below zero. With panic=abort the
            // crash-handler hook captures a Rust backtrace, so this surfaces
            // the exact culprit. Remove `|| cfg!(windows)` once root-caused.
            assert!(old != 0, "underflow of thread-safe ref count");
        }
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

// ported from: src/ptr/raw_ref_count.zig
