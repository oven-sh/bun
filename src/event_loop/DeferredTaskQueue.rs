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
//! anything a pass skips runs on the next one. `run()` reports a pass that stopped at its cap with
//! entries it never reached, and the event loop then wakes itself so the next pass comes on the
//! next turn. Without that, an idle loop would leave those entries until unrelated I/O or a timer
//! woke it. An entry that posts work during the pass consumes the cap too: the HTTP/2 server's
//! drain task, which each response sink's flush posts, is one.

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
    pub(crate) map: ArrayHashMap<Option<NonNull<c_void>>, DeferredRepeatingTask>,
    /// The entry whose callback `run` is executing, if any.
    running: Option<NonNull<c_void>>,
    /// Whether the running entry was posted anew during its own callback: it
    /// unregistered itself and then queued more work, as `H2FrameParser`'s
    /// auto-flush does when a JS-backed transport writes another frame while it
    /// uncorks.
    running_reposted: bool,
}

impl DeferredTaskQueue {
    pub fn post_task(&mut self, ctx: Option<NonNull<c_void>>, task: DeferredRepeatingTask) -> bool {
        // `ArrayHashMap` is currently aliased to std `HashMap`; the entry API
        // gives insert-if-absent + report-existing semantics.
        match self.map.entry(ctx) {
            bun_collections::hash_map::Entry::Occupied(_) => true,
            bun_collections::hash_map::Entry::Vacant(v) => {
                v.insert(task);
                if ctx.is_some() && ctx == self.running {
                    self.running_reposted = true;
                }
                false
            }
        }
    }

    pub fn unregister_task(&mut self, ctx: Option<NonNull<c_void>>) -> bool {
        // Order is irrelevant for this map's contract (see file doc), so
        // swap-remove is fine and O(1).
        self.map.swap_remove(&ctx)
    }

    /// Run one capped pass. Returns whether the pass left work behind: entries
    /// it never reached because the cap ran out, or an entry that unregistered
    /// itself and posted new work during its own callback. The caller then
    /// makes sure another pass runs soon. Entries the pass ran and that asked to
    /// stay registered are not counted: they wait for their own wakeup, such as
    /// a writable socket.
    pub fn run(&mut self) -> bool {
        let mut left_behind = false;
        // Callbacks may re-entrantly mutate `self.map` (see the re-entrancy
        // note in the file doc), so re-read `len()` every iteration and
        // re-check slot `i` after each callback. `remaining` is a livelock bound.
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
            self.running = key;
            self.running_reposted = false;
            // SAFETY: `nn` is the live `*mut T` registered by the caller; the
            // callback contract (`HasAutoFlusher::on_auto_flush`) is that
            // `task` may be invoked with exactly that pointer until it returns
            // `false` or is explicitly unregistered.
            let keep = unsafe { task(nn.as_ptr()) };
            self.running = None;
            if !keep {
                // `key` may already be gone (callback unregistered it) or may
                // have moved; remove by key, not index.
                self.map.swap_remove(&key);
            } else if self.map.keys().get(i) == Some(&key) {
                // Still in its slot, but possibly as a new registration with
                // work this pass will not run again.
                left_behind |= self.running_reposted;
                i += 1;
            }
        }
        // Slots from `i` on were never reached: the cap ran out first.
        left_behind || i < self.map.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A test entry: what its callback does, and the queue it acts on.
    struct Entry {
        queue: *mut DeferredTaskQueue,
        /// Unregister itself and post itself again, then ask to stay.
        repost: bool,
        /// Post this other entry while running.
        posts: Option<NonNull<c_void>>,
        keep: bool,
    }

    unsafe extern "C" fn callback(ctx: *mut c_void) -> bool {
        // SAFETY: every test posts a pointer to a live `Entry`.
        let entry = unsafe { &*ctx.cast::<Entry>() };
        // SAFETY: the queue outlives the pass; this re-enters it as the
        // event loop's callbacks do.
        let queue = unsafe { &mut *entry.queue };
        let me = NonNull::new(ctx);
        if entry.repost {
            queue.unregister_task(me);
            queue.post_task(me, callback);
        }
        if let Some(other) = entry.posts {
            queue.post_task(Some(other), callback);
        }
        entry.keep
    }

    fn ctx(entry: &mut Entry) -> Option<NonNull<c_void>> {
        NonNull::new(core::ptr::from_mut(entry).cast::<c_void>())
    }

    #[test]
    fn an_entry_that_stays_registered_leaves_nothing_behind() {
        let mut queue = DeferredTaskQueue::default();
        let queue_ptr = core::ptr::from_mut(&mut queue);
        let mut entry = Entry {
            queue: queue_ptr,
            repost: false,
            posts: None,
            keep: true,
        };
        queue.post_task(ctx(&mut entry), callback);
        assert!(!queue.run());
        assert_eq!(queue.map.len(), 1);
    }

    #[test]
    fn an_entry_that_reposts_itself_during_its_callback_is_left_behind() {
        let mut queue = DeferredTaskQueue::default();
        let queue_ptr = core::ptr::from_mut(&mut queue);
        let mut entry = Entry {
            queue: queue_ptr,
            repost: true,
            posts: None,
            keep: true,
        };
        queue.post_task(ctx(&mut entry), callback);
        assert!(queue.run(), "the new registration needs another pass");
        assert_eq!(queue.map.len(), 1);
    }

    #[test]
    fn a_pass_that_runs_out_of_its_cap_leaves_the_rest_behind() {
        let mut queue = DeferredTaskQueue::default();
        let queue_ptr = core::ptr::from_mut(&mut queue);
        // Like the HTTP/2 server's drain: posted by the first entry, pulled
        // into the finished entry's slot, it uses up the cap.
        let mut drain = Entry {
            queue: queue_ptr,
            repost: false,
            posts: None,
            keep: false,
        };
        let drain_ctx = ctx(&mut drain);
        let mut first = Entry {
            queue: queue_ptr,
            repost: false,
            posts: drain_ctx,
            keep: false,
        };
        let mut second = Entry {
            queue: queue_ptr,
            repost: false,
            posts: None,
            keep: false,
        };
        queue.post_task(ctx(&mut first), callback);
        queue.post_task(ctx(&mut second), callback);
        assert!(
            queue.run(),
            "the cap of two ran out before the second entry"
        );
        assert!(queue.map.contains_key(&ctx(&mut second)));
        assert!(!queue.run());
        assert!(queue.map.is_empty());
    }
}
