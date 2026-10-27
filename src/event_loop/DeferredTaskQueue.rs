//! Sometimes, you have work that will be scheduled, cancelled, and rescheduled multiple times
//! The order of that work may not particularly matter.
//!
//! An example of this is when writing to a file or network socket.
//!
//! You want to balance:
//!     1) Writing as much as possible to the file/socket in as few system calls as possible
//!     2) Writing to the file/socket as soon as possible
//!
//! That is a scheduling problem. How do you decide when to write to the file/socket? Developers
//! don't want to remember to call `flush` every time they write to a file/socket, but we don't
//! want them to have to think about buffering or not buffering either.
//!
//! Our answer to this is the DeferredTaskQueue.
//!
//! When you call write() when sending a streaming HTTP response, we don't actually write it immediately
//! by default. Instead, we wait until the end of the microtask queue to write it, unless either:
//!
//! - The buffer is full
//! - The developer calls `flush` manually
//!
//! But that means every time you call .write(), we have to check not only if the buffer is full, but also if
//! it previously had scheduled a write to the file/socket. So we use an ArrayHashMap to keep track of the
//! list of pointers which have a deferred task scheduled.
//!
//! The DeferredTaskQueue is drained after the microtask queue, but before other tasks are executed. This avoids re-entrancy
//! issues with the event loop.
//!
//! `run()` must tolerate re-entrant mutation of the map: a callback can reach user JS, which can
//! `post_task` / `unregister_task` any entry (for example, `H2FrameParser`'s auto-flush unregisters
//! itself and then returns `true`, and before the cork slot became self-scoped one parser's flush
//! could unregister another's). Each pass is capped at the number of entries present when it
//! started; that cap is a livelock bound, not a strict "no new entries this pass" frontier, because
//! a swap-remove can pull a freshly appended entry forward. Every callback flushes its own object's
//! buffer to its own fd or socket, so relative order within a pass has no correctness effect, and
//! anything a pass skips runs on the next one.

use core::cell::UnsafeCell;
use core::ffi::c_void;
use core::ptr::NonNull;

use bun_collections::ArrayHashMap;

// Declared `extern "C"` so the
// same fn-pointer type can flow across the FFI boundary (e.g.
// `Bun__VM__postDeferredTask`) without an ABI-crossing fn-ptr cast. All in-tree
// producers go through monomorphic `extern "C"` trampolines (see
// `AutoFlusher::erase_flush_callback`).
pub type DeferredRepeatingTask = unsafe extern "C" fn(*mut c_void) -> bool;

type Key = Option<NonNull<c_void>>;

/// Changed through `&self`, because a callback `run()` calls can post and unregister. Every borrow
/// of the map is inside one of the methods below other than `run()`, which copy a key or a value in
/// or out and call nothing but the map: hashing and comparing a pointer, and the allocator, cannot come back
/// here. `run()` holds none across a callback.
#[derive(Default)]
pub struct DeferredTaskQueue {
    map: UnsafeCell<ArrayHashMap<Key, DeferredRepeatingTask>>,
}

impl DeferredTaskQueue {
    pub fn post_task(&self, ctx: Key, task: DeferredRepeatingTask) -> bool {
        // SAFETY: see the type.
        match unsafe { &mut *self.map.get() }.entry(ctx) {
            bun_collections::hash_map::Entry::Occupied(_) => true,
            bun_collections::hash_map::Entry::Vacant(v) => {
                v.insert(task);
                false
            }
        }
    }

    pub fn unregister_task(&self, ctx: Key) -> bool {
        // Order is irrelevant for this map's contract (see file doc), so
        // swap-remove is fine and O(1).
        // SAFETY: see the type.
        unsafe { &mut *self.map.get() }.swap_remove(&ctx)
    }

    fn len(&self) -> usize {
        // SAFETY: see the type.
        unsafe { &*self.map.get() }.len()
    }

    fn at(&self, index: usize) -> Option<(Key, DeferredRepeatingTask)> {
        // SAFETY: see the type.
        let map = unsafe { &*self.map.get() };
        Some((*map.keys().get(index)?, map.values()[index]))
    }

    fn swap_remove_at(&self, index: usize) {
        // SAFETY: see the type.
        unsafe { &mut *self.map.get() }.swap_remove_at(index);
    }

    /// Frees the map's storage without running anything.
    pub fn clear_and_free(&self) {
        // SAFETY: see the type. Keys and values are `Copy`, so the old map's drop only frees.
        unsafe { *self.map.get() = ArrayHashMap::default() };
    }

    pub fn run(&self) {
        // Callbacks may re-entrantly mutate the map (see the re-entrancy
        // note in the file doc), so re-read `len()` every iteration and
        // re-check slot `i` after each callback. `remaining` is a livelock bound.
        let mut i: usize = 0;
        let mut remaining = self.len();
        while remaining > 0 {
            let Some((key, task)) = self.at(i) else { break };
            remaining -= 1;
            let Some(nn) = key else {
                self.swap_remove_at(i);
                continue;
            };

            // SAFETY: `nn` is the live `*mut T` registered by the caller; the
            // callback contract (`HasAutoFlusher::on_auto_flush`) is that
            // `task` may be invoked with exactly that pointer until it returns
            // `false` or is explicitly unregistered.
            let keep = unsafe { task(nn.as_ptr()) };
            if !keep {
                // `key` may already be gone (callback unregistered it) or may
                // have moved; remove by key, not index.
                self.unregister_task(key);
            } else if self.at(i).is_some_and(|(now, _)| now == key) {
                i += 1;
            }
        }
    }
}
