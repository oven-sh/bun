//! A `Copy` value that may travel between threads but can only be read on
//! the thread that wrapped it.

/// See the module doc. `T` needs no `Send`/`Sync`: other threads only ever
/// hold the bytes, and [`get`](Self::get) checks the caller's thread.
#[derive(Clone, Copy)]
pub struct ThreadBound<T: Copy> {
    value: T,
    thread: u64,
}

// SAFETY: `value` is only reachable through `get`, which refuses every thread
// but the one that constructed it; `T: Copy` has no `Drop` to run elsewhere.
unsafe impl<T: Copy> Send for ThreadBound<T> {}
// SAFETY: as above.
unsafe impl<T: Copy> Sync for ThreadBound<T> {}

impl<T: Copy> ThreadBound<T> {
    #[inline]
    pub fn new(value: T) -> Self {
        Self {
            value,
            thread: crate::current_thread_id(),
        }
    }

    /// The value. Panics off the constructing thread.
    #[inline]
    pub fn get(&self) -> &T {
        assert!(
            crate::current_thread_id() == self.thread,
            "ThreadBound value read off its thread"
        );
        &self.value
    }
}
