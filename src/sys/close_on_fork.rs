//! Linux and FreeBSD don't start a file that is open for writing anywhere (`ETXTBSY`), and `O_CLOEXEC` closes a child's copies of
//! this process's descriptors at the end of its exec, after the parent of a `vfork` child continues. So an executable is written
//! through a descriptor of this module: once `close` returns, no child has a copy either.

use core::ffi::c_int;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::{Fd, Mutex, ZStr};

use crate::{FdExt as _, Maybe, Mode};

#[repr(C)]
pub struct PendingFork {
    fds: *const c_int,
    fd_count: usize,
    /// Set by a `vfork` child, which shares this memory until its exec. Otherwise set once it has been started.
    has_closed_fds: AtomicBool,
}

struct State {
    fds: Vec<c_int>,
    pending_forks: Vec<NonNull<PendingFork>>,
}

// SAFETY: `with_pending_fork` keeps a pending fork alive while it is listed, and other threads read its `AtomicBool` alone.
unsafe impl Send for State {}

static STATE: Mutex<State> = Mutex::new(State {
    fds: Vec::new(),
    pending_forks: Vec::new(),
});

pub fn with_pending_fork<R>(spawn: impl FnOnce(*const PendingFork) -> R) -> R {
    let mut state = STATE.lock();
    // `fds` doesn't change before the child has closed them.
    let pending_fork = PendingFork {
        fds: state.fds.as_ptr(),
        fd_count: state.fds.len(),
        has_closed_fds: AtomicBool::new(false),
    };
    let pointer = NonNull::from(&pending_fork);
    state.pending_forks.push(pointer);
    drop(state);

    let result = spawn(pointer.as_ptr());
    pending_fork.has_closed_fds.store(true, Ordering::Release);
    STATE.lock().pending_forks.retain(|it| *it != pointer);
    result
}

fn update_fds<R>(update: impl FnOnce(&mut Vec<c_int>) -> R) -> R {
    let mut state = STATE.lock();
    let has_closed_fds = |it: &NonNull<PendingFork>| {
        // SAFETY: it is listed, so `with_pending_fork` hasn't returned.
        let pending_fork = unsafe { it.as_ref() };
        pending_fork.has_closed_fds.load(Ordering::Acquire)
    };
    while !state.pending_forks.iter().all(has_closed_fds) {
        std::thread::yield_now();
    }
    update(&mut state.fds)
}

pub fn openat(directory: Fd, path: &ZStr, flags: i32, mode: Mode) -> Maybe<Fd> {
    update_fds(|fds| {
        let fd = crate::openat(directory, path, flags, mode)?;
        fds.push(fd.native());
        Ok(fd)
    })
}

pub fn close(fd: Fd) {
    update_fds(|fds| {
        fd.close();
        fds.retain(|it| *it != fd.native());
    });
}
