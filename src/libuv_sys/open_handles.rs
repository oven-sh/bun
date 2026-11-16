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
//! on close; neither costs more as handles pile up.
//!
//! A reader over a *file* has no handle — its `uv_fs_read` is a request, which
//! cannot be closed and completes only when the loop is drained — so the reader
//! lists the boxed `File` it reads through (`add_file`, a stable address however
//! the reader itself moves) with itself as owner; the stop phase closes it the
//! same way, and the drained completion then finds a closed reader instead of a
//! parent that is gone or may no longer run script.

use super::*;

use core::cell::RefCell;
use std::collections::HashMap;

/// How a teardown closes a handle that has an owner: `close(owner)`.
pub type CloseViaOwner = unsafe fn(owner: *mut c_void);

struct Entry {
    kind: Kind,
    owner: *mut c_void,
    close_via_owner: Option<CloseViaOwner>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Pipe,
    Tty,
}

/// A file a reader holds: closed through that reader.
struct FileEntry {
    owner: *mut c_void,
    close_via_owner: Option<CloseViaOwner>,
}

#[derive(Default)]
struct Open {
    /// By handle address.
    handles: HashMap<*mut uv_handle_t, Entry>,
    /// By the boxed `File`'s address (what the reader's `Source` owns).
    files: HashMap<*mut c_void, FileEntry>,
}

std::thread_local! {
    static OPEN: RefCell<Open> = RefCell::new(Open::default());
    static HANDLES: Cell<*const Link> = const { Cell::new(ptr::null()) };
    static REQUESTS: Cell<*const Link> = const { Cell::new(ptr::null()) };
}

/// A node of one of this thread's lists, which it leaves when it is dropped.
pub(super) struct Link {
    next: Cell<*const Link>,
    /// The cell that points to `self`. Null while it is on no list.
    prev_next: Cell<*const Cell<*const Link>>,
    stop: Cell<Option<(unsafe fn(*mut c_void), *mut c_void)>>,
}

impl Link {
    pub(super) const fn new() -> Self {
        Self {
            next: Cell::new(ptr::null()),
            prev_next: Cell::new(ptr::null()),
            stop: Cell::new(None),
        }
    }

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

fn add(handle: *mut uv_handle_t, kind: Kind) {
    OPEN.with(|o| {
        let previous = o.borrow_mut().handles.insert(
            handle,
            Entry {
                kind,
                owner: ptr::null_mut(),
                close_via_owner: None,
            },
        );
        debug_assert!(previous.is_none(), "uv handle registered twice");
    });
}

pub(super) fn add_pipe(p: *mut Pipe) {
    add(p.cast(), Kind::Pipe);
}
pub(super) fn add_tty(t: *mut uv_tty_t) {
    add(t.cast(), Kind::Tty);
}

/// The `uv_close` for `handle` has been (or is about to be) issued.
pub(super) fn remove(handle: *mut uv_handle_t) {
    OPEN.with(|o| {
        o.borrow_mut().handles.remove(&handle);
    });
}

/// A reader took a file as its source: list the boxed `File` (its address is
/// stable however the reader moves). The owner follows via [`set_file_owner`];
/// [`remove_file`] when the reader hands the box to libuv or drops it.
pub fn add_file(file: *mut c_void) {
    OPEN.with(|o| {
        o.borrow_mut().files.entry(file).or_insert(FileEntry {
            owner: ptr::null_mut(),
            close_via_owner: None,
        });
    });
}

pub fn remove_file(file: *mut c_void) {
    OPEN.with(|o| {
        o.borrow_mut().files.remove(&file);
    });
}

/// The reader that now drives `file` (called again whenever that reader
/// settles at a new address). No-op for a file no reader listed — writers
/// share `Source::set_owner` and never list.
pub fn set_file_owner(file: *mut c_void, owner: *mut c_void, close: CloseViaOwner) {
    OPEN.with(|o| {
        if let Some(e) = o.borrow_mut().files.get_mut(&file) {
            e.owner = owner;
            e.close_via_owner = if owner.is_null() { None } else { Some(close) };
        }
    });
}

/// `owner` now drives `handle` and closes it via `close(owner)`; pass a
/// null `owner` to clear. No-op for handles not listed (never initialised
/// on this thread, already closing, or the process-static stdin tty).
pub fn set_owner(handle: *mut uv_handle_t, owner: *mut c_void, close: Option<CloseViaOwner>) {
    OPEN.with(|o| {
        if let Some(e) = o.borrow_mut().handles.get_mut(&handle) {
            e.owner = owner;
            e.close_via_owner = if owner.is_null() { None } else { close };
        }
    });
}

enum Next {
    Handle(*mut uv_handle_t, Entry),
    File(*mut c_void, FileEntry),
}

/// One entry out of the registry, if any is left. Owners may close other
/// handles from their callbacks, so the stop phase takes one at a time and
/// never holds the borrow across a close.
fn take_next() -> Option<Next> {
    OPEN.with(|o| {
        let mut o = o.borrow_mut();
        if let Some(&file) = o.files.keys().next() {
            let entry = o.files.remove(&file).unwrap();
            return Some(Next::File(file, entry));
        }
        let &handle = o.handles.keys().next()?;
        let entry = o.handles.remove(&handle).unwrap();
        Some(Next::Handle(handle, entry))
    })
}

/// Thread teardown's stop phase (VM alive, script forbidden): close every open pipe /
/// tty / process handle and every reader mid file-read — through its owner when
/// it has one, directly when nothing adopted it.
pub fn stop_all_for_vm_teardown() {
    while let Some(next) = take_next() {
        let (handle, e) = match next {
            Next::File(
                file,
                FileEntry {
                    owner,
                    close_via_owner,
                },
            ) => {
                log!(
                    "teardown: closing reader over file @{:p} (owner {:p})",
                    file,
                    owner
                );
                // A listed file always has its reader as owner: `set_source`
                // lists and records it in one step, `set_owner` keeps it current.
                let close = close_via_owner.expect("file listed without its reader");
                // SAFETY: the reader unlists the file before handing it off or
                // dropping it, and re-records itself whenever it moves.
                unsafe { close(owner) };
                continue;
            }
            Next::Handle(handle, e) => (handle, e),
        };
        log!(
            "teardown: closing open {} handle @{:p} (owner {:p})",
            match e.kind {
                Kind::Pipe => "pipe",
                Kind::Tty => "tty",
            },
            handle,
            e.owner
        );
        match e.close_via_owner {
            // SAFETY: the owner recorded itself for this live handle and clears
            // or replaces the slot before it goes away (set_owner contract).
            Some(close) => unsafe { close(e.owner) },
            // SAFETY: listed ⇒ initialised on this loop and not closing. Its holder frees it.
            None => unsafe { uv_close(handle, None) },
        }
    }
    // Closing these runs no callback.
    HANDLES.with(stop_all);
}
