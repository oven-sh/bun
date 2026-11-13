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
//! could unregister another's). A callback can also post a new entry: each HTTP/2 response sink's
//! flush posts the connection's drain task, and `H2FrameParser` re-posts itself after a fatal send.
//!
//! One pass runs the entries registered when it started, once each, in the map's order (the
//! registration order until a swap-remove; several `FileSink`s on one fd rely on it), and skips
//! the ones a callback unregistered. An entry posted during the pass waits for the next one,
//! which the event loop schedules at once: `run()` reports the post and the loop wakes itself.

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
    map: ArrayHashMap<Option<NonNull<c_void>>, DeferredRepeatingTask>,
    /// The keys of the pass that is running. Kept between passes for its allocation.
    pass: Vec<Option<NonNull<c_void>>>,
    /// The entry whose callback is running. A post of this key from its own callback is a
    /// re-registration (`H2FrameParser` re-corks while it flushes), not new work.
    running: Option<NonNull<c_void>>,
    /// Whether the running pass posted an entry that waits for the next one.
    posted: bool,
}

impl DeferredTaskQueue {
    pub fn post_task(&mut self, ctx: Option<NonNull<c_void>>, task: DeferredRepeatingTask) -> bool {
        match self.map.entry(ctx) {
            bun_collections::hash_map::Entry::Occupied(_) => true,
            bun_collections::hash_map::Entry::Vacant(v) => {
                v.insert(task);
                if ctx != self.running {
                    self.posted = true;
                }
                false
            }
        }
    }

    pub fn unregister_task(&mut self, ctx: Option<NonNull<c_void>>) -> bool {
        // O(1). The order a swap-remove breaks is only promised within a pass (see file doc).
        self.map.swap_remove(&ctx)
    }

    /// Run one pass over the entries present when it starts. Returns whether a callback posted
    /// another entry, which waits for the next pass. An entry that ran and stays registered,
    /// by returning `true` or by re-posting itself, is not counted: it waits for its own
    /// wakeup, such as a writable socket.
    #[must_use = "an entry posted during the pass waits for the next one: run another pass or wake the loop"]
    pub fn run(&mut self) -> bool {
        // Callbacks reach this queue again through the VM, so no `&mut self` (`noalias`) may
        // span a callback: launder it, as `EventLoop::tick_immediate_tasks` does.
        let this: *mut Self = core::hint::black_box(core::ptr::from_mut(self));
        // SAFETY: `this` is the live queue for the whole pass; no borrow of it is held across
        // a callback.
        let queue = || unsafe { &mut *this };
        queue().posted = false;
        if queue().map.is_empty() {
            return false;
        }
        // The pass walks a copy of the keys: a post or an unregister from a callback cannot
        // move an entry past or under the cursor.
        let mut keys = core::mem::take(&mut queue().pass);
        keys.clear();
        keys.extend_from_slice(queue().map.keys());
        let outer = queue().running;
        for &key in &keys {
            let Some(nn) = key else {
                queue().map.swap_remove(&key);
                continue;
            };
            // Gone: a callback before it unregistered it.
            let Some(&task) = queue().map.get(&key) else {
                continue;
            };
            queue().running = Some(nn);
            // SAFETY: `nn` is the live `*mut T` registered by the caller; the
            // callback contract (`HasAutoFlusher::on_auto_flush`) is that
            // `task` may be invoked with exactly that pointer until it returns
            // `false` or is explicitly unregistered.
            let keep = unsafe { task(nn.as_ptr()) };
            if !keep {
                // `key` may already be gone (callback unregistered it).
                queue().map.swap_remove(&key);
            }
        }
        queue().running = outer;
        queue().pass = keys;
        queue().posted
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
        /// Unregister this other entry while running.
        unregisters: Option<NonNull<c_void>>,
        keep: bool,
        runs: usize,
    }

    unsafe extern "C" fn callback(ctx: *mut c_void) -> bool {
        // SAFETY: every test posts a pointer to a live `Entry`.
        let entry = unsafe { &mut *ctx.cast::<Entry>() };
        // SAFETY: the queue outlives the pass; this re-enters it as the
        // event loop's callbacks do.
        let queue = unsafe { &mut *entry.queue };
        let me = NonNull::new(ctx);
        entry.runs += 1;
        RUN_ORDER.with(|o| o.borrow_mut().push(me));
        if entry.repost {
            queue.unregister_task(me);
            queue.post_task(me, callback);
        }
        if let Some(other) = entry.posts {
            queue.post_task(Some(other), callback);
        }
        if let Some(other) = entry.unregisters {
            queue.unregister_task(Some(other));
        }
        entry.keep
    }

    thread_local! {
        static RUN_ORDER: core::cell::RefCell<Vec<Option<NonNull<c_void>>>> = const { core::cell::RefCell::new(Vec::new()) };
    }

    fn run_order() -> Vec<Option<NonNull<c_void>>> {
        RUN_ORDER.with(|o| core::mem::take(&mut *o.borrow_mut()))
    }

    fn entry(queue: &mut DeferredTaskQueue, keep: bool) -> Entry {
        Entry {
            queue: core::ptr::from_mut(queue),
            repost: false,
            posts: None,
            unregisters: None,
            keep,
            runs: 0,
        }
    }

    fn ctx(entry: &mut Entry) -> Option<NonNull<c_void>> {
        NonNull::new(core::ptr::from_mut(entry).cast::<c_void>())
    }

    #[test]
    fn an_entry_that_stays_registered_is_not_reported() {
        let mut queue = DeferredTaskQueue::default();
        let mut entry = entry(&mut queue, true);
        assert!(!queue.post_task(ctx(&mut entry), callback));
        assert!(!queue.run());
        assert_eq!(queue.map.len(), 1);
        assert!(!queue.run());
        assert_eq!(entry.runs, 2);
    }

    #[test]
    fn an_entry_that_returns_false_is_removed() {
        let mut queue = DeferredTaskQueue::default();
        let mut entry = entry(&mut queue, false);
        queue.post_task(ctx(&mut entry), callback);
        assert!(!queue.run());
        assert_eq!(queue.map.len(), 0);
        assert!(!queue.run());
        assert_eq!(entry.runs, 1);
    }

    #[test]
    fn an_entry_that_reposts_itself_is_kept_and_not_reported() {
        let mut queue = DeferredTaskQueue::default();
        let mut entry = entry(&mut queue, true);
        entry.repost = true;
        queue.post_task(ctx(&mut entry), callback);
        assert!(!queue.run());
        assert_eq!(queue.map.len(), 1);
        assert_eq!(entry.runs, 1);
    }

    #[test]
    fn entries_run_in_registration_order_and_a_mid_pass_post_waits_for_the_next_pass() {
        let mut queue = DeferredTaskQueue::default();
        // Like the HTTP/2 server's drain: every sink posts it while it runs.
        let mut drain = entry(&mut queue, false);
        let drain_ctx = ctx(&mut drain);
        let mut sinks: Vec<Entry> = (0..5).map(|_| entry(&mut queue, false)).collect();
        let sink_ctxs: Vec<_> = sinks.iter_mut().map(ctx).collect();
        for sink in &mut sinks {
            sink.posts = drain_ctx;
        }
        for &c in &sink_ctxs {
            queue.post_task(c, callback);
        }
        let _ = run_order();
        assert!(queue.run(), "the drain waits for the next pass");
        assert_eq!(run_order(), sink_ctxs);
        assert_eq!(drain.runs, 0);
        assert_eq!(queue.map.len(), 1);
        assert!(!queue.run());
        assert_eq!(run_order(), vec![drain_ctx]);
        assert_eq!(queue.map.len(), 0);
    }

    #[test]
    fn an_entry_unregistered_by_an_earlier_one_is_skipped() {
        let mut queue = DeferredTaskQueue::default();
        let mut a = entry(&mut queue, false);
        let mut b = entry(&mut queue, true);
        let mut c = entry(&mut queue, true);
        let mut d = entry(&mut queue, false);
        let (a_ctx, b_ctx, c_ctx, d_ctx) = (ctx(&mut a), ctx(&mut b), ctx(&mut c), ctx(&mut d));
        // `b` unregisters `c`, and `d` posts a new entry. A swap-remove of `a` or `c` must not
        // move `d` or the new entry under the cursor.
        b.unregisters = c_ctx;
        let mut e = entry(&mut queue, false);
        d.posts = ctx(&mut e);
        for &k in &[a_ctx, b_ctx, c_ctx, d_ctx] {
            queue.post_task(k, callback);
        }
        let _ = run_order();
        assert!(queue.run());
        assert_eq!(run_order(), vec![a_ctx, b_ctx, d_ctx]);
        assert_eq!((a.runs, b.runs, c.runs, d.runs, e.runs), (1, 1, 0, 1, 0));
        assert_eq!(queue.map.len(), 2);
        assert!(!queue.run());
        assert_eq!((b.runs, c.runs, e.runs), (2, 0, 1));
    }
}
