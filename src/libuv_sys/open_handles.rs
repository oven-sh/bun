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
//! on close — both keyed by address, so neither costs more as handles pile up.
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
    /// `bun_io::StdinTty`: never owned here; closed in place, freed by its owner.
    StdinTty,
    Process,
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
pub fn add_stdin_tty(t: *mut uv_tty_t) {
    add(t.cast(), Kind::StdinTty);
}
pub(super) fn add_process(p: *mut Process) {
    add(p.cast(), Kind::Process);
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
/// on this thread, already closing) and for the shared stdin tty.
pub fn set_owner(handle: *mut uv_handle_t, owner: *mut c_void, close: Option<CloseViaOwner>) {
    OPEN.with(|o| {
        if let Some(e) = o.borrow_mut().handles.get_mut(&handle) {
            if e.kind == Kind::StdinTty {
                return;
            }
            e.owner = owner;
            e.close_via_owner = if owner.is_null() { None } else { close };
        }
    });
}

#[cfg(debug_assertions)]
pub fn count() -> usize {
    OPEN.with(|o| {
        let o = o.borrow();
        o.handles.len() + o.files.len()
    })
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
                // lists and records it in one step, `set_parent` keeps it current.
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
                Kind::StdinTty => "stdin tty",
                Kind::Process => "process",
            },
            handle,
            e.owner
        );
        match (e.close_via_owner, e.kind) {
            // SAFETY: the owner recorded itself for this live handle and clears
            // or replaces the slot before it goes away (set_owner contract).
            (Some(close), _) => unsafe { close(e.owner) },
            // SAFETY: listed ⇒ initialised on this thread and not closing; a
            // pipe/tty nobody adopted is a leaked Box handed to libuv here.
            (None, Kind::Pipe) => unsafe { Pipe::close_and_destroy_unlisted(handle.cast()) },
            // SAFETY: as above (a leaked Box<Tty> nobody adopted).
            (None, Kind::Tty) => unsafe {
                unsafe extern "C" fn free_tty(t: *mut uv_tty_t) {
                    // SAFETY: heap `Box<Tty>` (the shared stdin tty is
                    // `Kind::StdinTty`); `from_uv` recovers the owning box.
                    drop(unsafe { Box::from_raw(super::Tty::from_uv(t)) });
                }
                uv_close(
                    handle,
                    Some(mem::transmute::<
                        unsafe extern "C" fn(*mut uv_tty_t),
                        unsafe extern "C" fn(*mut uv_handle_t),
                    >(free_tty)),
                );
            },
            // A process handle is embedded in its owner and always adopted at
            // spawn; an unowned one cannot be freed safely — close in place.
            // The stdin tty too: its owner frees it once the loop is closed.
            // SAFETY: listed ⇒ an initialised, not-closing handle on this loop.
            (None, Kind::StdinTty | Kind::Process) => unsafe { uv_close(handle, None) },
        }
    }
}
