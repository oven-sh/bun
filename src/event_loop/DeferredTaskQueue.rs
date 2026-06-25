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

use core::ffi::c_void;
use core::ptr::NonNull;

use bun_collections::ArrayHashMap;

// Declared `extern "C"` so the
// same fn-pointer type can flow across the FFI boundary (e.g.
// `Bun__VM__postDeferredTask`) without an ABI-crossing fn-ptr cast. All in-tree
// producers go through monomorphic `extern "C"` trampolines (see
// `AutoFlusher::erase_flush_callback`).
pub type DeferredRepeatingTask = unsafe extern "C" fn(*mut c_void) -> bool;

#[derive(Default)]
pub struct DeferredTaskQueue {
    pub map: ArrayHashMap<Option<NonNull<c_void>>, DeferredRepeatingTask>,
}

impl DeferredTaskQueue {
    pub fn post_task(&mut self, ctx: Option<NonNull<c_void>>, task: DeferredRepeatingTask) -> bool {
        // `ArrayHashMap` is currently aliased to std `HashMap`; the entry API
        // gives insert-if-absent + report-existing semantics.
        match self.map.entry(ctx) {
            bun_collections::hash_map::Entry::Occupied(_) => true,
            bun_collections::hash_map::Entry::Vacant(v) => {
                v.insert(task);
                false
            }
        }
    }

    pub fn unregister_task(&mut self, ctx: Option<NonNull<c_void>>) -> bool {
        // Order is irrelevant for this map's contract (see file doc), so
        // swap-remove is fine and O(1).
        self.map.swap_remove(&ctx)
    }

    pub fn run(&mut self) {
        // Callbacks may re-entrantly `post_task` / `unregister_task` on this
        // same map (e.g. `H2FrameParser::on_auto_flush` unregisters itself and
        // returns `true`), so `self.map.len()` and entry positions can change
        // under us. Re-read `len()` each iteration and, after the callback,
        // re-check whether `key` is still at `i` to decide whether to advance.
        // `remaining` bounds the pass to the initial entry count so a callback
        // that both removes and re-posts can't spin and entries appended
        // mid-run are left for the next `run()`.
        let mut i: usize = 0;
        let mut remaining = self.map.len();
        while remaining > 0 && i < self.map.len() {
            remaining -= 1;
            let key = self.map.keys()[i];
            let Some(nn) = key else {
                self.map.swap_remove_at(i);
                continue;
            };

            let task = self.map.values()[i];
            // SAFETY: `nn` is the live `*mut T` registered by the caller; the
            // callback contract (`HasAutoFlusher::on_auto_flush`) is that
            // `task` may be invoked with exactly that pointer until it returns
            // `false` or is explicitly unregistered.
            let keep = unsafe { task(nn.as_ptr()) };
            if !keep {
                // `key` may already be gone (callback unregistered it) or may
                // have moved; remove by key, not index.
                self.map.swap_remove(&key);
            } else if self.map.keys().get(i) == Some(&key) {
                i += 1;
            }
        }
    }
}
