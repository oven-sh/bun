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
//! on close — both O(1) and off any hot path.

use super::*;

use core::cell::RefCell;

/// How a teardown closes a handle that has an owner: `close(owner)`.
pub type CloseViaOwner = unsafe fn(owner: *mut c_void);

struct Entry {
    handle: *mut uv_handle_t,
    kind: Kind,
    owner: *mut c_void,
    close_via_owner: Option<CloseViaOwner>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Pipe,
    Tty,
    Process,
}

std::thread_local! {
    static OPEN: RefCell<Vec<Entry>> = const { RefCell::new(Vec::new()) };
}

fn add(handle: *mut uv_handle_t, kind: Kind) {
    OPEN.with(|o| {
        let mut o = o.borrow_mut();
        debug_assert!(
            !o.iter().any(|e| e.handle == handle),
            "uv handle registered twice"
        );
        o.push(Entry {
            handle,
            kind,
            owner: ptr::null_mut(),
            close_via_owner: None,
        });
    });
}

pub(super) fn add_pipe(p: *mut Pipe) {
    add(p.cast(), Kind::Pipe);
}
pub(super) fn add_tty(t: *mut uv_tty_t) {
    add(t.cast(), Kind::Tty);
}
pub(super) fn add_process(p: *mut Process) {
    add(p.cast(), Kind::Process);
}

/// The `uv_close` for `handle` has been (or is about to be) issued.
pub(super) fn remove(handle: *mut uv_handle_t) {
    OPEN.with(|o| {
        let mut o = o.borrow_mut();
        if let Some(i) = o.iter().position(|e| e.handle == handle) {
            o.swap_remove(i);
        }
    });
}

/// `owner` now drives `handle` and closes it via `close(owner)`; pass a
/// null `owner` to clear. No-op for handles not listed (never initialised
/// on this thread, already closing, or the process-static stdin tty).
pub fn set_owner(handle: *mut uv_handle_t, owner: *mut c_void, close: Option<CloseViaOwner>) {
    OPEN.with(|o| {
        if let Some(e) = o.borrow_mut().iter_mut().find(|e| e.handle == handle) {
            e.owner = owner;
            e.close_via_owner = if owner.is_null() { None } else { close };
        }
    });
}

#[cfg(debug_assertions)]
pub fn count() -> usize {
    OPEN.with(|o| o.borrow().len())
}

/// Thread teardown, VM alive, script still allowed: close every open pipe /
/// tty / process handle — through its owner when it has one, directly when
/// nothing adopted it. Owners may close other handles from their callbacks,
/// so take one entry at a time.
pub fn stop_all_for_vm_teardown() {
    loop {
        let Some(e) = OPEN.with(|o| o.borrow_mut().pop()) else {
            break;
        };
        log!(
            "teardown: closing open {} handle @{:p} (owner {:p})",
            match e.kind {
                Kind::Pipe => "pipe",
                Kind::Tty => "tty",
                Kind::Process => "process",
            },
            e.handle,
            e.owner
        );
        match (e.close_via_owner, e.kind) {
            // SAFETY: the owner recorded itself for this live handle and clears
            // or replaces the slot before it goes away (set_owner contract).
            (Some(close), _) => unsafe { close(e.owner) },
            // SAFETY: listed ⇒ initialised on this thread and not closing; a
            // pipe/tty nobody adopted is a leaked Box handed to libuv here.
            (None, Kind::Pipe) => unsafe { Pipe::close_and_destroy_unlisted(e.handle.cast()) },
            (None, Kind::Tty) => unsafe {
                unsafe extern "C" fn free_tty(t: *mut uv_tty_t) {
                    // SAFETY: heap tty (stdin's static tty is never listed).
                    drop(unsafe { Box::from_raw(t) });
                }
                uv_close(
                    e.handle,
                    Some(mem::transmute::<
                        unsafe extern "C" fn(*mut uv_tty_t),
                        unsafe extern "C" fn(*mut uv_handle_t),
                    >(free_tty)),
                );
            },
            // A process handle is embedded in its owner and always adopted at
            // spawn; an unowned one cannot be freed safely — close in place.
            (None, Kind::Process) => unsafe { uv_close(e.handle, None) },
        }
    }
}
