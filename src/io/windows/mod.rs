//! Pipes, the console and plain files on Windows, driven by the loop's
//! completion port (`bun_uws_sys::iocp`).
//!
//! Memory the kernel may write to (an `OVERLAPPED`, a read buffer) belongs to
//! the kernel from submit until the completion packet is dequeued. Every
//! operation therefore lives in its own allocation that is freed only from its
//! own completion; an owner that goes away first orphans it. Cancelling and
//! closing only ask for the completion.

use core::cell::{Cell, RefCell};
use core::ffi::c_void;
use std::sync::Arc;

use bun_uws_sys::Loop;
use bun_uws_sys::iocp;

pub mod file;
pub mod ipc_frame;
pub mod pipe;
pub mod pipe_server;
pub(crate) mod sys;
pub mod tty;
mod tty_input;
mod tty_output;

pub use file::File;
pub use pipe::{ConnectRequest, Pipe, ReadEvent};
pub use pipe_server::PipeServer;
pub use tty::Tty;

// ──────────────────────────────────────────────────────────────────────────
// Loop bookkeeping
// ──────────────────────────────────────────────────────────────────────────

/// A packet that leads to `op` is now owed to `loop_`: the loop must keep
/// turning (`num_polls`) and must not close its port (`us_iocp_op_submitted`)
/// until it is dequeued.
///
/// # Safety
/// `loop_` is the live loop of the calling thread.
#[inline]
pub(crate) unsafe fn op_submitted(loop_: *mut Loop) {
    // SAFETY: caller contract.
    unsafe {
        (*loop_).inc();
        iocp::us_iocp_op_submitted(loop_);
    }
}

/// As [`op_submitted`] for a wait started with `us_iocp_wait_start`, which
/// does the port accounting itself.
///
/// # Safety
/// `loop_` is the live loop of the calling thread.
#[inline]
pub(crate) unsafe fn wait_submitted(loop_: *mut Loop) {
    // SAFETY: caller contract.
    unsafe { (*loop_).inc() };
}

/// The packet accounted by [`op_submitted`] / [`wait_submitted`] was dequeued
/// (or its wait was removed before firing).
///
/// # Safety
/// `loop_` is the live loop of the calling thread.
#[inline]
pub(crate) unsafe fn op_dequeued(loop_: *mut Loop) {
    // SAFETY: caller contract.
    unsafe { (*loop_).dec() };
}

/// Queue `op` on the loop's own thread so its `complete` runs from the loop
/// rather than re-entrantly. Returns `false` if the port refused the packet.
///
/// # Safety
/// `loop_` is the live loop of the calling thread; `op` stays allocated until
/// its `complete` has run.
pub(crate) unsafe fn post_to_loop(loop_: *mut Loop, op: *mut iocp::Op) -> bool {
    // SAFETY: caller contract; `Op` starts with the OVERLAPPED the packet carries.
    unsafe {
        if sys::PostQueuedCompletionStatus(iocp::us_loop_iocp(loop_), 0, 0, op.cast()) == 0 {
            return false;
        }
        // Only this thread dequeues, so the packet is still queued.
        op_submitted(loop_);
    }
    true
}

/// The loop's completion port as seen from other threads. It is a duplicate of
/// the loop's handle, so a helper thread that finishes after the loop is gone
/// posts into a port nobody reads instead of into a closed (or reused) handle.
pub(crate) struct Port(sys::HANDLE);

// SAFETY: a completion port handle may be posted to from any thread.
unsafe impl Send for Port {}
// SAFETY: as above; `post` takes `&self` and the handle is immutable.
unsafe impl Sync for Port {}

impl Port {
    /// Hand `op` to the loop thread. The loop-side accounting
    /// ([`op_submitted`]) was done by the loop thread when it started the work.
    ///
    /// # Safety
    /// `op` stays allocated until its `complete` has run.
    pub(crate) unsafe fn post(&self, op: *mut iocp::Op) {
        // SAFETY: caller contract.
        if unsafe { sys::PostQueuedCompletionStatus(self.0, 0, 0, op.cast()) } == 0 {
            // The loop thread would wait for this completion forever.
            panic!("PostQueuedCompletionStatus failed: {:?}", sys::last_error());
        }
    }
}

impl Drop for Port {
    fn drop(&mut self) {
        // SAFETY: `self.0` is the duplicate made in `port_for`.
        unsafe { sys::CloseHandle(self.0) };
    }
}

thread_local! {
    static PORTS: RefCell<Vec<(*mut Loop, Arc<Port>)>> = const { RefCell::new(Vec::new()) };
    static OPEN: Cell<*mut Link> = const { Cell::new(core::ptr::null_mut()) };
}

/// The cross-thread handle to `loop_`'s port, made on first use.
///
/// # Safety
/// `loop_` is the live loop of the calling thread.
pub(crate) unsafe fn port_for(loop_: *mut Loop) -> Option<Arc<Port>> {
    PORTS.with_borrow_mut(|ports| {
        if let Some((_, port)) = ports.iter().find(|(l, _)| *l == loop_) {
            return Some(port.clone());
        }
        let mut dup: sys::HANDLE = core::ptr::null_mut();
        // SAFETY: caller contract; both process handles are the pseudo-handle.
        let ok = unsafe {
            sys::DuplicateHandle(
                sys::GetCurrentProcess(),
                iocp::us_loop_iocp(loop_),
                sys::GetCurrentProcess(),
                &raw mut dup,
                0,
                0,
                sys::DUPLICATE_SAME_ACCESS,
            )
        };
        if ok == 0 {
            return None;
        }
        let port = Arc::new(Port(dup));
        ports.push((loop_, port.clone()));
        Some(port)
    })
}

// ──────────────────────────────────────────────────────────────────────────
// What a loop's thread has open
// ──────────────────────────────────────────────────────────────────────────

/// First field of every pipe, pipe server and console state. The states cache
/// their loop and are freed from completions that loop dispatches, so a loop
/// that is about to be freed (a Worker's, `spawnSync`'s) has to close whatever
/// is still open on it first: [`close_all_for_loop`] walks this list.
#[repr(C)]
pub(crate) struct Link {
    pub(crate) loop_: *mut Loop,
    prev: *mut Link,
    next: *mut Link,
    /// Cancel the state's I/O and detach it from the loop. The state stays
    /// allocated for its owner, which finds it closed.
    shut: unsafe fn(*mut Link),
}

impl Link {
    pub(crate) const fn new(loop_: *mut Loop, shut: unsafe fn(*mut Link)) -> Link {
        Link {
            loop_,
            prev: core::ptr::null_mut(),
            next: core::ptr::null_mut(),
            shut,
        }
    }

    /// # Safety
    /// `this` is at its final address and not listed.
    pub(crate) unsafe fn insert(this: *mut Link) {
        let head = OPEN.get();
        // SAFETY: caller contract; `head` is a listed (live) link or null.
        unsafe {
            (*this).prev = core::ptr::null_mut();
            (*this).next = head;
            if !head.is_null() {
                (*head).prev = this;
            }
        }
        OPEN.set(this);
    }

    /// # Safety
    /// `this` is live and was inserted on this thread. Idempotent.
    pub(crate) unsafe fn remove(this: *mut Link) {
        // SAFETY: caller contract; neighbours are listed (live) links.
        unsafe {
            let (prev, next) = ((*this).prev, (*this).next);
            if prev.is_null() {
                if OPEN.get() != this {
                    return;
                }
                OPEN.set(next);
            } else {
                (*prev).next = next;
            }
            if !next.is_null() {
                (*next).prev = prev;
            }
            (*this).prev = core::ptr::null_mut();
            (*this).next = core::ptr::null_mut();
        }
    }
}

/// Close every pipe, pipe server and console still open on `loop_`. Call on
/// the loop's thread before freeing the loop; the cancelled operations are
/// collected by the loop's own teardown drain.
pub fn close_all_for_loop(loop_: *mut Loop) {
    let mut cursor = OPEN.get();
    while !cursor.is_null() {
        // SAFETY: listed links are live; `shut` unlinks `cursor`, so the next
        // pointer is read first.
        unsafe {
            let next = (*cursor).next;
            if (*cursor).loop_ == loop_ {
                ((*cursor).shut)(cursor);
            }
            cursor = next;
        }
    }
    PORTS.with_borrow_mut(|ports| ports.retain(|(l, _)| *l != loop_));
}

// ──────────────────────────────────────────────────────────────────────────
// Type-erased callbacks
// ──────────────────────────────────────────────────────────────────────────

/// `unsafe fn(*mut T, A)` plus its `*mut T`, with `T` erased.
pub(crate) struct Callback<A> {
    ctx: *mut c_void,
    f: *const (),
    call: unsafe fn(*const (), *mut c_void, A),
}

impl<A> Clone for Callback<A> {
    fn clone(&self) -> Self {
        *self
    }
}
impl<A> Copy for Callback<A> {}

impl<A> Callback<A> {
    pub(crate) fn new<T>(ctx: *mut T, f: unsafe fn(*mut T, A)) -> Self {
        unsafe fn call<T, A>(f: *const (), ctx: *mut c_void, arg: A) {
            // SAFETY: `f` was erased from exactly this type in `new`.
            let f = unsafe { core::mem::transmute::<*const (), unsafe fn(*mut T, A)>(f) };
            // SAFETY: the owner that supplied `ctx` keeps it valid for the callback.
            unsafe { f(ctx.cast::<T>(), arg) }
        }
        Callback {
            ctx: ctx.cast(),
            f: f as *const (),
            call: call::<T, A>,
        }
    }

    /// # Safety
    /// The `ctx` given to `new` is still valid.
    pub(crate) unsafe fn invoke(self, arg: A) {
        // SAFETY: caller contract.
        unsafe { (self.call)(self.f, self.ctx, arg) }
    }
}

/// UTF-8 → NUL-terminated UTF-16 for a Win32 `W` call.
pub(crate) fn to_wide_z(bytes: &[u8]) -> Vec<u16> {
    match bun_core::handle_oom(bun_core::strings::to_utf16_alloc(bytes, false, true)) {
        Some(wide) => wide,
        // All ASCII: nothing was converted.
        None => {
            let mut wide: Vec<u16> = Vec::with_capacity(bytes.len() + 1);
            wide.extend(bytes.iter().map(|b| u16::from(*b)));
            wide.push(0);
            wide
        }
    }
}

/// Run `f(context)` on one of the system's long-running worker threads: for
/// calls that can block for as long as a peer likes, which must not occupy
/// Bun's own work pool.
///
/// # Safety
/// `f` must be sound to run on another thread with `context`.
pub(crate) unsafe fn queue_blocking_work(
    f: sys::LPTHREAD_START_ROUTINE,
    context: *mut c_void,
) -> bool {
    // SAFETY: caller contract.
    unsafe { sys::QueueUserWorkItem(f, context, sys::WT_EXECUTELONGFUNCTION) != 0 }
}
