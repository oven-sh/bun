//! A simple wrapper around an integer reference count. This type doesn't do any
//! memory management itself.
//!
//! May be useful for implementing the interface required by `ExternalShared`.

#[cfg(debug_assertions)]
use bun_core::ThreadLock;

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
