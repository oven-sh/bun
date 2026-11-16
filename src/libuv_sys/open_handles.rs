//! Registry of the uv handles Bun itself opened on this thread's loop (pipes,
//! ttys, processes …), each with the owner that drives it, so a worker's
//! teardown can close every one *through its owner* before the loop is closed
//! — pending writes then complete (ECANCELED) against a live VM and nothing is
//! left for `uv_loop_close` to trip over.
//!
//! This is Node's mechanism: every `HandleWrap` links itself into
//! `Environment::handle_wrap_queue_` (node/src/handle_wrap.h, env.h) at
//! construction and `Environment::CleanupHandles()` (node/src/env.cc) walks that
//! list calling `Close()`; `uv_walk` alone is not enough because it yields bare
//! `uv_handle_t*`s with no typed owner to close through. Insert on open, remove
//! on free; neither costs more as handles pile up.
//!
//! A reader over a *file* has no handle — its `uv_fs_read` is a request, which
//! cannot be closed and completes only when the loop is drained — so the reader
//! lists the [`OwnedFile`] it reads through; the stop phase closes it the
//! same way, and the drained completion then finds a closed reader instead of a
//! parent that is gone or may no longer run script.

use super::*;

std::thread_local! {
    static HANDLES: Cell<*const Link> = const { Cell::new(ptr::null()) };
    static REQUESTS: Cell<*const Link> = const { Cell::new(ptr::null()) };
}

/// A node of one of this thread's lists, which it leaves when it is dropped.
#[derive(Default)]
pub struct Link {
    next: Cell<*const Link>,
    /// The cell that points to `self`. Null while it is on no list.
    prev_next: Cell<*const Cell<*const Link>>,
    stop: Cell<Option<(unsafe fn(*mut c_void), *mut c_void)>>,
}

impl Link {
    /// # Safety
    /// `self` stays in place and on this thread, and `stop(holder)` may be called, until `remove`.
    pub(super) unsafe fn add_handle(&self, holder: *mut c_void, stop: unsafe fn(*mut c_void)) {
        // SAFETY: fn contract.
        HANDLES.with(|head| unsafe { self.add(head, holder, stop) });
    }

    /// # Safety
    /// As for `add_handle`.
    pub(super) unsafe fn add_request(&self, holder: *mut c_void, stop: unsafe fn(*mut c_void)) {
        // SAFETY: fn contract.
        REQUESTS.with(|head| unsafe { self.add(head, holder, stop) });
    }

    /// # Safety
    /// As for `add_handle`, and `head` lasts as long as the thread.
    unsafe fn add(
        &self,
        head: &Cell<*const Link>,
        holder: *mut c_void,
        stop: unsafe fn(*mut c_void),
    ) {
        assert!(self.prev_next.get().is_null());
        self.stop.set(Some((stop, holder)));
        self.prev_next.set(head);
        self.next.set(head.replace(self));
        // SAFETY: what is listed is live.
        if let Some(next) = unsafe { self.next.get().as_ref() } {
            next.prev_next.set(&raw const self.next);
        }
    }

    pub(super) fn remove(&self) {
        let prev_next = self.prev_next.replace(ptr::null());
        // SAFETY: what is listed is live, and so is the head.
        unsafe {
            let Some(prev_next) = prev_next.as_ref() else {
                return;
            };
            prev_next.set(self.next.get());
            if let Some(next) = self.next.get().as_ref() {
                next.prev_next.set(prev_next);
            }
        }
    }
}

impl Drop for Link {
    fn drop(&mut self) {
        self.remove();
    }
}

/// One at a time: a `stop` can add and remove others.
fn stop_all(head: &Cell<*const Link>) {
    // SAFETY: what is listed is live, and `stop` has the contract of `add`.
    unsafe {
        while let Some(link) = head.get().as_ref() {
            link.remove();
            let (stop, holder) = link.stop.get().expect("set by `add`");
            log!("teardown: stopping @{:p}", holder);
            stop(holder);
        }
    }
}

/// Each `getaddrinfo` in flight completes as cancelled, or as usual if it is too late for that.
pub fn cancel_requests_for_vm_teardown() {
    REQUESTS.with(stop_all);
}

/// Thread teardown's stop phase (VM alive, script forbidden): close every open pipe /
/// tty / process handle and every reader mid file-read — through its owner when
/// it has one, directly when nothing adopted it.
pub fn stop_all_for_vm_teardown() {
    HANDLES.with(stop_all);
}
