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

pub type DeferredRepeatingTask = fn(*mut c_void) -> bool;

#[derive(Default)]
pub struct DeferredTaskQueue {
    pub map: ArrayHashMap<Option<NonNull<c_void>>, DeferredRepeatingTask>,
}

impl DeferredTaskQueue {
    pub fn post_task(&mut self, ctx: Option<NonNull<c_void>>, task: DeferredRepeatingTask) -> bool {
        let existing = self.map.get_or_put_value(ctx, task);
        existing.found_existing
    }

    pub fn unregister_task(&mut self, ctx: Option<NonNull<c_void>>) -> bool {
        self.map.swap_remove(&ctx)
    }

    pub fn run(&mut self) {
        let mut i: usize = 0;
        let mut last = self.map.len();
        while i < last {
            let Some(key) = self.map.keys()[i] else {
                self.map.swap_remove_at(i);
                last = self.map.len();
                continue;
            };

            // PORT NOTE: reshaped for borrowck — copy fn ptr out before calling
            let task = self.map.values()[i];
            if !task(key.as_ptr()) {
                self.map.swap_remove_at(i);
                last = self.map.len();
            } else {
                i += 1;
            }
        }
    }
}

// Zig `deinit` only freed the map's backing storage; `ArrayHashMap: Drop` handles that.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/DeferredTaskQueue.zig (68 lines)
//   confidence: high
//   todos:      0
//   notes:      assumes ArrayHashMap exposes get_or_put_value/swap_remove_at/keys/values matching Zig API
// ──────────────────────────────────────────────────────────────────────────
