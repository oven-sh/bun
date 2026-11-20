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

pub struct DeferredTask {
    /// `false` takes the entry out of the queue.
    pub run: unsafe fn(NonNull<c_void>) -> bool,
    /// Called once it has.
    pub removed: unsafe fn(NonNull<c_void>),
}

#[derive(Default)]
pub struct DeferredTaskQueue {
    /// No borrow spans a callback, which reaches this queue again.
    map: UnsafeCell<ArrayHashMap<NonNull<c_void>, &'static DeferredTask>>,
}

impl DeferredTaskQueue {
    /// SAFETY: `task` can be called with `ctx` for as long as the entry is in the queue.
    pub unsafe fn post_task(&self, ctx: NonNull<c_void>, task: &'static DeferredTask) {
        // SAFETY: no callback runs in this borrow, and `run` holds none while it calls one.
        let existing = unsafe { &mut *self.map.get() }.insert(ctx, task);
        debug_assert!(existing.is_none());
    }

    pub fn unregister_task(&self, ctx: NonNull<c_void>) -> bool {
        // Order is irrelevant for this map's contract (see file doc), so
        // swap-remove is fine and O(1).
        // SAFETY: no callback runs in this borrow, and `run` holds none while it calls one.
        unsafe { &mut *self.map.get() }.swap_remove(&ctx)
    }

    pub fn run(&self) {
        // Callbacks may re-entrantly mutate `self.map` (see the re-entrancy
        // note in the file doc), so re-read `len()` every iteration and
        // re-check slot `i` after each callback. `remaining` is a livelock bound.
        let mut i: usize = 0;
        // SAFETY: the borrow ends before the callback below, after which `map` is borrowed anew.
        let mut map = unsafe { &mut *self.map.get() };
        let mut remaining = map.len();
        while remaining > 0 && i < map.len() {
            remaining -= 1;
            let key = map.keys()[i];
            let task = map.values()[i];
            // SAFETY: the contract of `post_task`.
            let keep = unsafe { (task.run)(key) };
            // SAFETY: the callback has returned; the borrow ends before the next one.
            map = unsafe { &mut *self.map.get() };
            if !keep {
                // `key` may already be gone (callback unregistered it) or may
                // have moved; remove by key, not index.
                if let Some((key, task)) = map.fetch_swap_remove(&key) {
                    // SAFETY: it was in the queue until now. `map` is borrowed anew, as above.
                    unsafe {
                        (task.removed)(key);
                        map = &mut *self.map.get();
                    }
                }
            } else if map.keys().get(i) == Some(&key) {
                i += 1;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::cell::Cell;

    #[derive(Default)]
    struct Fixture {
        queue: DeferredTaskQueue,
        grow_calls: Cell<u32>,
        calls: Box<[Cell<u32>; 32]>,
    }

    const COUNT: DeferredTask = DeferredTask {
        run: |ctx| {
            // SAFETY: posted with an element of `Fixture::calls`, which outlives `run`.
            unsafe { ctx.cast::<Cell<u32>>().as_ref() }.update(|n| n + 1);
            false
        },
        // SAFETY: as above.
        removed: |ctx| unsafe { ctx.cast::<Cell<u32>>().as_ref() }.update(|n| n + 100),
    };

    const GROW: DeferredTask = DeferredTask {
        run: |ctx| {
            // SAFETY: posted with the `Fixture`, which outlives `run`.
            let fixture = unsafe { ctx.cast::<Fixture>().as_ref() };
            fixture.grow_calls.update(|n| n + 1);
            for calls in &fixture.calls[1..] {
                // SAFETY: as above.
                unsafe { fixture.queue.post_task(NonNull::from(calls).cast(), &COUNT) };
            }
            true
        },
        removed: |_| unreachable!(),
    };

    #[test]
    fn a_task_that_grows_the_queue_does_not_take_the_turn_of_the_next() {
        let fixture = Fixture::default();
        let queue = &fixture.queue;
        // SAFETY: `fixture` outlives `run`.
        unsafe {
            queue.post_task(NonNull::from(&fixture).cast(), &GROW);
            queue.post_task(NonNull::from(&fixture.calls[0]).cast(), &COUNT);
        }
        queue.run();
        assert_eq!((fixture.grow_calls.get(), fixture.calls[0].get()), (1, 101));
    }
}
