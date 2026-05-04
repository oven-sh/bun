//! This type helps detect race conditions in debug/`ci_assert` builds.
//!
//! Store an instance of this type in or alongside shared data. Then, add the following to any
//! block of code that accesses the shared data:
//!
//!     shared_data.critical_section.begin();
//!     defer shared_data.critical_section.end();
//!     // (do stuff with shared_data...)
//!
//! If a mutex is being used to ensure threads don't access the data simultaneously, call `begin`
//! *after* locking the mutex, and call `end` before releasing it, since it's the code that runs
//! when the mutex is held that needs to be prevented from concurrent execution.
//!
//! In code that only *reads* the shared data, and does not write to it, `beginReadOnly` can be
//! used instead. This allows multiple threads to read the data simultaneously, but will still
//! error if a thread tries to modify it (via calling `begin`).
//!
//!     shared_data.critical_section.beginReadOnly();
//!     defer shared_data.critical_section.end();
//!     // (do *read-only* stuff with shared_data...)
//!
//! One use of this type could be to ensure that single-threaded containers aren't being used
//! concurrently without appropriate synchronization. For example, each method in an `ArrayList`
//! could start with a call to `begin` or `beginReadOnly` and end with a call to `end`. Then, an
//! `ArrayList` used by only one thread, or one used by multiple threads but synchronized via a
//! mutex, won't cause an error, but an `ArrayList` used by multiple threads concurrently without
//! synchronization, assuming at least one thread is modifying the data, will cause an error.

use core::fmt;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_crash_handler::StoredTrace;

// TODO(port): `ThreadId` / `INVALID_THREAD_ID` / `current_thread_id()` come from the sibling
// `src/safety/thread_id.zig` port + Zig's `std.Thread`. Phase B: confirm the concrete integer
// width and atomic type (Zig's `std.Thread.Id` is platform-dependent).
use super::thread_id::{ThreadId, AtomicThreadId, current as current_thread_id, INVALID as INVALID_THREAD_ID};

// TODO(port): `bun.Environment.ci_assert` — map to the correct cfg gate in Phase B.
#[cfg(feature = "ci_assert")]
pub const ENABLED: bool = true;
#[cfg(not(feature = "ci_assert"))]
pub const ENABLED: bool = false;

#[derive(Default)]
pub struct CriticalSection {
    #[cfg(feature = "ci_assert")]
    internal_state: State,
    // When not enabled, this is a zero-sized type (Zig: `void`).
}

struct OptionalThreadId {
    inner: ThreadId,
}

impl OptionalThreadId {
    pub fn init(id: ThreadId) -> OptionalThreadId {
        OptionalThreadId { inner: id }
    }
}

impl fmt::Display for OptionalThreadId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.inner == INVALID_THREAD_ID {
            f.write_str("another thread")
        } else {
            write!(f, "thread {}", self.inner)
        }
    }
}

/// A reentrant lock that prevents multiple threads from accessing data at the same time,
/// except if all threads' use of the data is read-only.
struct State {
    /// The ID of the thread that first acquired the lock (the "owner thread").
    thread_id: AtomicThreadId,

    /// Stack trace of the first time the owner thread acquired the lock (that is, when it became
    /// the owner).
    #[cfg(debug_assertions)]
    owner_trace: StoredTrace,
    // When traces are disabled, this is a zero-sized type (Zig: `void`).

    /// Number of nested calls to `lockShared`/`lockExclusive` performed on the owner thread.
    /// Only accessed on the owner thread.
    owned_count: u32,

    /// Number of (possibly nested) calls to `lockShared` performed on any thread except the
    /// owner thread.
    count: AtomicU32,
}

impl Default for State {
    fn default() -> Self {
        Self {
            thread_id: AtomicThreadId::new(INVALID_THREAD_ID),
            #[cfg(debug_assertions)]
            owner_trace: StoredTrace::empty(),
            owned_count: 0,
            count: AtomicU32::new(0),
        }
    }
}

impl State {
    /// If `count` is set to this value, it indicates that a thread has requested exclusive
    /// (read/write) access.
    const EXCLUSIVE: u32 = u32::MAX;

    fn get_or_become_owner(&mut self) -> ThreadId {
        let current_id = current_thread_id();
        // Relaxed is okay because we don't need to synchronize-with other threads; we just need
        // to make sure that only one thread succeeds in setting the value.
        match self.thread_id.compare_exchange(
            INVALID_THREAD_ID,
            current_id,
            Ordering::Relaxed,
            Ordering::Relaxed,
        ) {
            Ok(_) => {
                #[cfg(debug_assertions)]
                {
                    // TODO(port): Zig passes `@returnAddress()` here; no stable Rust equivalent.
                    // Phase B: decide whether `StoredTrace::capture` should take a frame skip
                    // count instead, or use inline asm / a nightly intrinsic.
                    self.owner_trace = StoredTrace::capture(0);
                }
                current_id
            }
            Err(existing) => existing,
        }
    }

    fn show_trace(&mut self) {
        #[cfg(not(debug_assertions))]
        {
            return;
        }
        #[cfg(debug_assertions)]
        {
            bun_core::Output::err("race condition", "`CriticalSection` first entered here:");
            bun_crash_handler::dump_stack_trace(
                self.owner_trace.trace(),
                bun_crash_handler::DumpOptions { frame_count: 10, stop_at_jsc_llint: true },
            );
        }
    }

    /// Acquire the lock for shared (read-only) access.
    fn lock_shared(&mut self) {
        let current_id = current_thread_id();
        let owner_id = self.get_or_become_owner();
        if owner_id == current_id {
            self.owned_count += 1;
        } else if self.count.fetch_add(1, Ordering::Relaxed) == Self::EXCLUSIVE {
            self.show_trace();
            panic!(
                "race condition: thread {} tried to read data being modified by {}",
                current_id,
                OptionalThreadId::init(owner_id),
            );
        }
    }

    /// Acquire the lock for exclusive (read/write) access.
    fn lock_exclusive(&mut self) {
        let current_id = current_thread_id();
        let owner_id = self.get_or_become_owner();
        if owner_id == current_id {
            // Relaxed is okay because concurrent access is an error.
            match self.count.swap(Self::EXCLUSIVE, Ordering::Relaxed) {
                0 | Self::EXCLUSIVE => {}
                _ => {
                    self.show_trace();
                    panic!(
                        "race condition: thread {} tried to modify data being read by {}",
                        current_id,
                        OptionalThreadId::init(owner_id),
                    );
                }
            }
            self.owned_count += 1;
        } else {
            self.show_trace();
            panic!(
                "race condition: thread {} tried to modify data being accessed by {}",
                current_id,
                OptionalThreadId::init(owner_id),
            );
        }
    }

    /// Release the lock.
    fn unlock(&mut self) {
        let current_id = current_thread_id();
        // Relaxed is okay because this value shouldn't change until all locks are released, and
        // we currently hold a lock.
        let owner_id = self.thread_id.load(Ordering::Relaxed);

        // It's possible for this thread to be the owner (`owner_id == current_id`) and for
        // `owned_count` to be 0, if this thread originally wasn't the owner, but became the owner
        // when the original owner released all of its locks. In this case, some of the lock count
        // for this thread is still in `self.count` rather than `self.owned_count`.
        if owner_id == current_id && self.owned_count > 0 {
            self.owned_count -= 1;
            if self.owned_count == 0 {
                // Relaxed is okay because:
                // * If this succeeds, it means the current thread holds an exclusive lock, so
                //   concurrent access would be an error.
                // * If this fails, we don't care about the value.
                let _ = self.count.compare_exchange(
                    Self::EXCLUSIVE,
                    0,
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                );
                // Relaxed is okay because another thread that loads `thread_id` should not rely
                // on that load to synchronize-with the update to `self.count` above; other
                // synchronization should have already been performed. (This type is not meant to
                // provide its own synchronization, but rather assert that such synchronization has
                // already been provided.)
                self.thread_id.store(INVALID_THREAD_ID, Ordering::Relaxed);
            }
        } else {
            match self.count.fetch_sub(1, Ordering::Relaxed) {
                // The Relaxed `fetch_sub` above is okay because we don't need to synchronize-with
                // other threads (this type is not meant to provide its own synchronization).
                0 => panic!("called `CriticalSection.end` too many times"),
                Self::EXCLUSIVE => panic!(
                    "count should not be `exclusive` if multiple threads hold the lock",
                ),
                _ => {}
            }
        }
    }
}

impl CriticalSection {
    /// Marks the beginning of a critical section which accesses (and potentially modifies) shared data.
    /// Calls to this function can be nested; each must be paired with a call to `end`.
    pub fn begin(&mut self) {
        #[cfg(feature = "ci_assert")]
        self.internal_state.lock_exclusive();
    }

    /// Marks the beginning of a critical section which performs read-only accesses on shared data.
    /// Calls to this function can be nested; each must be paired with a call to `end`.
    pub fn begin_read_only(&mut self) {
        #[cfg(feature = "ci_assert")]
        self.internal_state.lock_shared();
    }

    /// Marks the end of a critical section started by `begin` or `begin_read_only`.
    pub fn end(&mut self) {
        #[cfg(feature = "ci_assert")]
        self.internal_state.unlock();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/safety/CriticalSection.zig (202 lines)
//   confidence: medium
//   todos:      2
//   notes:      `ci_assert` cfg gate + ThreadId/AtomicThreadId provenance need Phase-B wiring; @returnAddress() stubbed.
// ──────────────────────────────────────────────────────────────────────────
