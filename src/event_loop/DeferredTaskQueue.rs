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

// PORT NOTE: Zig `*const fn(*anyopaque) bool`. Declared `extern "C"` so the
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
        // Zig: `getOrPutValue(ctx, task).found_existing`.
        // PORT NOTE: `ArrayHashMap` is currently aliased to std `HashMap`; the
        // entry API gives the same semantics (insert-if-absent + report-existing).
        match self.map.entry(ctx) {
            bun_collections::hash_map::Entry::Occupied(_) => true,
            bun_collections::hash_map::Entry::Vacant(v) => {
                v.insert(task);
                false
            }
        }
    }

    pub fn unregister_task(&mut self, ctx: Option<NonNull<c_void>>) -> bool {
        // Zig: `swapRemove(ctx) -> bool`. Order is irrelevant for this map's
        // contract (see file doc — "order may not particularly matter"), so
        // plain `remove().is_some()` is equivalent.
        self.map.remove(&ctx).is_some()
    }

    pub fn run(&mut self) {
        // PORT NOTE: Zig used `swapRemoveAt(i)` (O(1) by index). The current
        // `ArrayHashMap` exposes `keys()/values()` slices and `swap_remove(&K)`
        // (O(n) hash lookup) but not `swap_remove_at`. Keys here are `Copy`
        // pointers, so copy the key out and remove by key — semantically
        // identical (keys are unique), just an extra hash per removal.
        // PERF(port): swap_remove(&K) re-hashes; restore swap_remove_at when
        // bun_collections::ArrayHashMap grows it — profile in Phase B.
        let mut i: usize = 0;
        let mut last = self.map.len();
        while i < last {
            let key = self.map.keys()[i];
            let Some(nn) = key else {
                self.map.swap_remove(&key);
                last = self.map.len();
                continue;
            };

            // PORT NOTE: reshaped for borrowck — copy fn ptr out before calling
            let task = self.map.values()[i];
            // SAFETY: `nn` is the live `*mut T` registered by the caller; the
            // callback contract (Zig `Type.onAutoFlush`) is that `task` may be
            // invoked with exactly that pointer until it returns `false` or is
            // explicitly unregistered.
            if !unsafe { task(nn.as_ptr()) } {
                self.map.swap_remove(&key);
                last = self.map.len();
            } else {
                i += 1;
            }
        }
    }
}

// Zig `deinit` only freed the map's backing storage; `ArrayHashMap: Drop` handles that.

// ported from: src/event_loop/DeferredTaskQueue.zig
