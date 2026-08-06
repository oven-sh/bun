//! Per-thread list of the objects that currently own an open libuv *stream*
//! or *process* handle on this thread's loop — Bun's counterpart of Node's
//! HandleWrap list. A thread teardown closes each of them through its owner's
//! ordinary close path while the VM is still alive (their close callbacks and
//! any request completions they trigger, e.g. a pending pipe write finishing
//! with ECANCELED, run against a live VM), so afterwards no request can keep
//! the loop from draining and nothing on those handles fires after the VM is
//! gone. Sockets, servers, listeners and watchers have their own stop phase;
//! this list is only for handles the io/spawn layer opens directly.

use core::cell::RefCell;
use core::ffi::c_void;

struct Entry {
    key: *mut c_void,
    close: unsafe fn(*mut c_void),
}

thread_local! {
    static OWNERS: RefCell<Vec<Entry>> = const { RefCell::new(Vec::new()) };
}

/// `key` owns an open handle from now until [`unregister`]; `close(key)` is
/// its ordinary close (must be callable at any point on this thread while the
/// owner is alive, and must lead to `unregister(key)`). Registering an owner
/// that is already listed (a reader/writer restarted on the same source) keeps
/// the one entry.
pub fn register(key: *mut c_void, close: unsafe fn(*mut c_void)) {
    OWNERS.with(|o| {
        let mut o = o.borrow_mut();
        if !o.iter().any(|e| e.key == key) {
            o.push(Entry { key, close });
        }
    });
}

/// The owner has issued its `uv_close` (or handed the handle elsewhere).
pub fn unregister(key: *mut c_void) {
    OWNERS.with(|o| {
        let mut o = o.borrow_mut();
        if let Some(i) = o.iter().position(|e| e.key == key) {
            o.swap_remove(i);
        }
    });
}

/// Thread teardown, VM alive, script still allowed: close every open stream /
/// process handle through its owner. Owners may close (unregister) others
/// from their callbacks, so pop one at a time.
pub fn close_all_for_teardown() {
    loop {
        let Some(entry) = OWNERS.with(|o| o.borrow_mut().pop()) else {
            break;
        };
        // SAFETY: a registered key is a live owner on this thread (contract of
        // `register`); it was just removed, so its own `unregister` is a no-op.
        unsafe { (entry.close)(entry.key) };
    }
}
