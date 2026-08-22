//! Work recorded by libuv callbacks, run once `uv_run` has returned.
//!
//! `uv_run` is not re-entrant, and libuv keeps touching a handle after that
//! handle's callback returns (re-arms polls, runs endgames, walks a request
//! list it detached before dispatching). Bun's handlers, on the other hand,
//! run JavaScript, and JavaScript can always drive the event loop again before
//! it returns (anything that waits on a promise synchronously, `process.exit`
//! draining the loop, the debugger pausing, ...). So on Windows the rule is:
//! **a libuv callback only records what completed** (bookkeeping on Bun's own
//! memory is fine, running a handler is not) and links a [`Deferred`] node
//! into its loop's queue. `us_loop_run` (packages/bun-usockets, libuv.c)
//! drains that queue right after `uv_run` returns, from Bun's own frame, the
//! same place epoll/kqueue builds dispatch their ready fds. A nested tick from
//! one of those handlers is then just another sequential `uv_run` to libuv,
//! and it keeps draining the same queue, so nothing an outer `uv_run`
//! collected is lost to it.
//!
//! The queue is per loop, not per thread: `spawnSync` runs a second loop on
//! the JS thread precisely so that the main loop's handlers do not run inside
//! it. `uv_loop_t.data` points at the queue: a thread-local next to the
//! thread's own loop (`Loop::get`), or two words in `us_loop_t` for a loop
//! `us_create_loop` made itself.
//!
//! The node is intrusive (no allocation per event) and doubly linked so that
//! whoever owns it can [`Deferred::cancel`] a pending dispatch when it tears
//! down first. Coalescing is the owner's business: [`Deferred::enqueue`] on a
//! node that is already queued keeps its place and its `run`; the owner
//! accumulates whatever else completed in its own state.

use super::libuv::{
    Handle, Loop, ReturnCode, fs_t, uv__queue, uv_close_cb, uv_connect_cb, uv_connect_t, uv_fs_cb,
    uv_req_t,
};
use core::ffi::{c_int, c_void};
use core::mem::{offset_of, size_of};
use core::ptr;

/// The per-loop FIFO `uv_loop_t.data` points at.
#[repr(C)]
pub struct Queue {
    head: *mut Deferred,
    tail: *mut Deferred,
}
impl Queue {
    pub const fn new() -> Self {
        Self {
            head: ptr::null_mut(),
            tail: ptr::null_mut(),
        }
    }
}

/// One pending dispatch. Embed it in the structure whose libuv callback
/// defers, recover that structure in `run` with `from_field_ptr!`.
#[repr(C)]
pub struct Deferred {
    prev: *mut Deferred,
    next: *mut Deferred,
    run: Option<unsafe fn(*mut Deferred)>,
    /// The queue this node is linked into; null when not queued.
    queue: *mut Queue,
}

impl Default for Deferred {
    fn default() -> Self {
        Self::new()
    }
}

/// The queue of `loop_`: the thread's own loop gets one in `Loop::get`, a loop
/// `us_create_loop` made itself keeps it in `us_loop_t`. Null for any other
/// loop (nothing drains such a loop, so nothing may defer on it).
///
/// # Safety
/// `loop_` is a live loop.
#[inline]
pub unsafe fn queue_of(loop_: *mut Loop) -> *mut Queue {
    // SAFETY: per fn contract.
    unsafe { (*loop_).data.cast() }
}

impl Deferred {
    pub const fn new() -> Self {
        Self {
            prev: ptr::null_mut(),
            next: ptr::null_mut(),
            run: None,
            queue: ptr::null_mut(),
        }
    }

    #[inline]
    pub fn is_queued(&self) -> bool {
        !self.queue.is_null()
    }

    /// Schedule `run(this)` for the dispatch phase of the tick of `loop_` that
    /// is on the stack. Call this from the libuv callback. Already queued:
    /// no-op (first `run` wins).
    ///
    /// # Safety
    /// `this` stays valid until it runs or is [`cancel`](Self::cancel)led;
    /// `loop_` is the loop whose callback this is.
    pub unsafe fn enqueue(loop_: *mut Loop, this: *mut Deferred, run: unsafe fn(*mut Deferred)) {
        // SAFETY: per fn contract.
        unsafe {
            if !(*this).queue.is_null() {
                return;
            }
            let q = queue_of(loop_);
            assert!(
                !q.is_null(),
                "libuv callback deferred on a loop nothing dispatches"
            );
            (*this).queue = q;
            (*this).run = Some(run);
            (*this).next = ptr::null_mut();
            (*this).prev = (*q).tail;
            if let Some(tail) = (*q).tail.as_mut() {
                tail.next = this;
            } else {
                (*q).head = this;
            }
            (*q).tail = this;
        }
    }

    /// Drop a pending dispatch (owner teardown). No-op if not queued.
    ///
    /// # Safety
    /// `this` is valid; called on the loop's thread.
    pub unsafe fn cancel(this: *mut Deferred) {
        // SAFETY: per fn contract; neighbours are queued nodes, hence valid.
        unsafe {
            let q = (*this).queue;
            if q.is_null() {
                return;
            }
            let prev = (*this).prev;
            let next = (*this).next;
            if prev.is_null() {
                (*q).head = next;
            } else {
                (*prev).next = next;
            }
            if next.is_null() {
                (*q).tail = prev;
            } else {
                (*next).prev = prev;
            }
            (*this).queue = ptr::null_mut();
            (*this).prev = ptr::null_mut();
            (*this).next = ptr::null_mut();
        }
    }

    /// Move a pending dispatch to another node (the owner's state moved to a
    /// new address). `to` takes `from`'s place in the queue and its `run`.
    ///
    /// # Safety
    /// Both are valid; `to` is not queued.
    pub unsafe fn relocate(from: *mut Deferred, to: *mut Deferred) {
        // SAFETY: per fn contract.
        unsafe {
            debug_assert!((*to).queue.is_null());
            *to = ptr::read(from);
            *from = Deferred::new();
            let q = (*to).queue;
            if q.is_null() {
                return;
            }
            if (*to).prev.is_null() {
                (*q).head = to;
            } else {
                (*(*to).prev).next = to;
            }
            if (*to).next.is_null() {
                (*q).tail = to;
            } else {
                (*(*to).next).prev = to;
            }
        }
    }
}

/// Run everything libuv callbacks have queued on `loop_`, in order, including
/// whatever the handlers themselves cause to be queued (a handler may tick the
/// loop again). Each node is unlinked before its `run`, so `run` may free the
/// node's owner or enqueue it again.
///
/// # Safety
/// `loop_` is a live loop; called on its thread, outside `uv_run`.
pub unsafe fn dispatch(loop_: *mut Loop) {
    // SAFETY: per fn contract.
    let q = unsafe { queue_of(loop_) };
    if q.is_null() {
        return;
    }
    loop {
        // SAFETY: q is the loop's queue storage.
        let node = unsafe { (*q).head };
        if node.is_null() {
            return;
        }
        // SAFETY: queued nodes are valid (enqueue contract); unlink, then run.
        unsafe {
            let run = (*node).run;
            Deferred::cancel(node);
            if let Some(run) = run {
                run(node);
            }
        }
    }
}

/// libuv.c: called by `us_loop_run` / `us_loop_pump` after `uv_run` returns
/// and the socket ready list has been dispatched.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__uv_dispatch_deferred(loop_: *mut Loop) {
    // SAFETY: caller contract (libuv.c).
    unsafe { dispatch(loop_) };
}

// ── Requests ────────────────────────────────────────────────────────────────
//
// Every libuv request starts with `UV_REQ_FIELDS`, whose `void* reserved[6]`
// libuv itself never touches. That is exactly enough room for the completion
// callback, a queue node and the completion status, so a request needs no
// cooperation from its owner to be deferred: arm it with `fs_callback` /
// `connect_callback` (or `uv_write_t::write`) when issuing it (they return the libuv callback to
// pass), and the owner's callback runs from the dispatch phase with the same
// arguments libuv delivered. The request has to stay allocated until its
// callback ran anyway, so the node is always valid while queued.

#[repr(C)]
pub(crate) struct ReqSlots {
    pub(crate) cb: *mut c_void,
    pub(crate) node: Deferred,
    pub(crate) status: isize,
}
const _: () = assert!(size_of::<ReqSlots>() == size_of::<[*mut c_void; 6]>());

#[inline]
pub(crate) unsafe fn req_slots<R>(req: *mut R) -> *mut ReqSlots {
    // SAFETY: every uv request type is layout-prefixed by uv_req_t.
    unsafe { req.cast::<u8>().add(offset_of!(uv_req_t, reserved)).cast() }
}
#[inline]
pub(crate) unsafe fn req_from_node<R>(node: *mut Deferred) -> *mut R {
    // SAFETY: inverse of `req_slots(..).node`.
    unsafe {
        node.cast::<u8>()
            .sub(offset_of!(uv_req_t, reserved) + offset_of!(ReqSlots, node))
            .cast()
    }
}
#[inline]
pub(crate) unsafe fn arm<R>(req: *mut R, cb: *mut c_void) {
    // SAFETY: caller passes a request it is about to hand to libuv.
    unsafe {
        let slots = req_slots(req);
        // Re-issuing a request whose previous completion has not been dispatched
        // yet would unlink nothing and corrupt the queue; owners issue the next
        // operation from the completion callback, never before it.
        debug_assert!(
            !(*slots).node.is_queued(),
            "libuv request re-issued before its completion was dispatched"
        );
        (*slots).cb = cb;
        (*slots).node = Deferred::new();
        (*slots).status = 0;
    }
}

/// Arm `req` so that `cb` runs from the dispatch phase, and return the libuv
/// callback to issue the request with:
/// `uv_fs_read(loop, req, .., fs_callback(req, on_read))`.
///
/// # Safety
/// `req` is the request being issued and stays allocated until `cb` ran.
pub unsafe fn fs_callback(req: *mut fs_t, cb: unsafe extern "C" fn(*mut fs_t)) -> uv_fs_cb {
    unsafe extern "C" fn trampoline(req: *mut fs_t) {
        unsafe fn run(node: *mut Deferred) {
            // SAFETY: armed by `fs_callback`; libuv is done with the request.
            unsafe {
                let req: *mut fs_t = req_from_node(node);
                let cb: unsafe extern "C" fn(*mut fs_t) =
                    core::mem::transmute((*req_slots(req)).cb);
                cb(req);
            }
        }
        // SAFETY: `req` is the armed request libuv just completed.
        unsafe { Deferred::enqueue((*req).loop_, &raw mut (*req_slots(req)).node, run) };
    }
    // SAFETY: per fn contract.
    unsafe { arm(req, cb as *mut c_void) };
    Some(trampoline)
}

/// As [`fs_callback`], for `uv_pipe_connect2` / `uv_tcp_connect`.
///
/// # Safety
/// `req` is the request being issued and stays allocated until `cb` ran.
pub unsafe fn connect_callback(
    req: *mut uv_connect_t,
    cb: unsafe extern "C" fn(*mut uv_connect_t, ReturnCode),
) -> uv_connect_cb {
    unsafe extern "C" fn trampoline(req: *mut uv_connect_t, status: ReturnCode) {
        unsafe fn run(node: *mut Deferred) {
            // SAFETY: armed by `connect_callback`; libuv is done with the request.
            unsafe {
                let req: *mut uv_connect_t = req_from_node(node);
                let slots = req_slots(req);
                let cb: unsafe extern "C" fn(*mut uv_connect_t, ReturnCode) =
                    core::mem::transmute((*slots).cb);
                cb(req, ReturnCode((*slots).status as c_int));
            }
        }
        // SAFETY: `req` is the armed request libuv just completed.
        unsafe {
            (*req_slots(req)).status = status.0 as isize;
            Deferred::enqueue((*(*req).handle).loop_, &raw mut (*req_slots(req)).node, run);
        }
    }
    // SAFETY: per fn contract.
    unsafe { arm(req, cb as *mut c_void) };
    Some(trampoline)
}

// ── uv_close ────────────────────────────────────────────────────────────────
//
// Once libuv calls a handle's close callback it never touches the handle
// again (uv__handle_close in handle-inl.h: the callback is the last thing),
// so from that point the handle's own memory can carry the queue node: it is
// laid over `handle_queue` and the first slots of `u`. Until then the owner's
// callback waits in `u.reserved[3]`, which lies past the node and which libuv
// leaves alone (pipes and ttys use `u.fd`, the first slot, only).
//
// libuv sets UV_HANDLE_CLOSED immediately before that call, and owners read
// `is_closed()` as "my close callback ran" (safe to free / nothing pending).
// To keep that true, the bit is held back while the callback sits in the
// queue: cleared when queued, set again right before the owner's callback
// runs. `is_closing()` stays true throughout, so nothing closes twice.

const _: () = assert!(
    offset_of!(Handle, handle_queue) + size_of::<Deferred>()
        <= offset_of!(Handle, u) + 3 * size_of::<*mut c_void>()
);
const _: () = assert!(size_of::<uv__queue>() == 2 * size_of::<*mut c_void>());

/// Close callback that runs `cb` from the dispatch phase:
/// `uv_close(handle, close_callback(handle, on_close))`. For close callbacks
/// that do more than free memory.
///
/// # Safety
/// `handle` is the handle being closed and stays allocated until `cb` ran.
pub unsafe fn close_callback(
    handle: *mut Handle,
    cb: unsafe extern "C" fn(*mut Handle),
) -> uv_close_cb {
    unsafe extern "C" fn trampoline(handle: *mut Handle) {
        unsafe fn run(node: *mut Deferred) {
            // SAFETY: `node` overlays `handle_queue` (below).
            unsafe {
                let handle: *mut Handle = node
                    .cast::<u8>()
                    .sub(offset_of!(Handle, handle_queue))
                    .cast();
                let cb: unsafe extern "C" fn(*mut Handle) =
                    core::mem::transmute((*handle).u.reserved[3]);
                (*handle).flags |= super::libuv::UV_HANDLE_CLOSED;
                cb(handle);
            }
        }
        // SAFETY: libuv is done with `handle`; its list links are dead memory now.
        unsafe {
            (*handle).flags &= !super::libuv::UV_HANDLE_CLOSED;
            let node: *mut Deferred = handle
                .cast::<u8>()
                .add(offset_of!(Handle, handle_queue))
                .cast();
            node.write(Deferred::new());
            Deferred::enqueue((*handle).loop_, node, run);
        }
    }
    // SAFETY: per fn contract; libuv does not read u.reserved[3].
    unsafe { (*handle).u.reserved[3] = cb as *mut c_void };
    Some(trampoline)
}
