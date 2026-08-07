//! [`VmHandle`] — the only way another thread reaches a [`VirtualMachine`].
//!
//! Off-thread code (thread-pool jobs, the HTTP thread, watcher/waiter threads,
//! addon threads) legitimately needs three things from a VM: post a completion
//! and wake its loop, ref/unref its keep-alive, and — while running — sometimes
//! use memory the VM owns. It never needs the `VirtualMachine`, its global or
//! its heap directly; whatever touches those runs later, on the JS thread, from
//! the posted task. A `VmHandle` provides exactly those three, safely and for
//! as long as anyone holds it (it outlives the VM), and the VM's teardown
//! *closes* it: after `close()` returns no thread can reach the VM's queues,
//! waker or memory through any handle, and posts are refused (the poster gets
//! its task back and releases it on its own thread — deliver-or-discard, as
//! WebKit's WorkerRunLoop does). The same object carries the script-forbidden
//! bit that native→JS entry points consult (Node's `can_call_into_js`).
//!
//! Gate: posters/borrowers hold `active` for the duration of their access and
//! then check `state`; `close()` publishes `Closed` and waits for `active == 0`
//! (SeqCst on both sides — the Dekker pair). So an access either finished
//! before `close()` returned or observed `Closed` and touched nothing.

use core::ptr::NonNull;
use core::sync::atomic::{AtomicU8, AtomicU32, Ordering};
use std::sync::{Arc, Condvar, Mutex};

use crate::event_loop::EventLoop;
use crate::virtual_machine::VirtualMachine;
use bun_event_loop::ConcurrentTask::ConcurrentTask as ConcurrentTaskItem;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum State {
    /// Normal operation.
    Open = 0,
    /// Teardown phase A: user close/exit handlers still run; posts accepted so
    /// completions of already-running work are delivered (and released) normally.
    Stopping = 1,
    /// Teardown after `forbidExecution`: no user script; posts still accepted
    /// (released, never run, by the teardown before `close`).
    ScriptForbidden = 2,
    /// `close()` ran: nothing off-thread reaches the VM any more.
    Closed = 3,
}

/// Which of the VM's two event loops a task belongs to (fixed when the task is
/// created on the JS thread; a task started while a macro runs completes into
/// the macro loop the macro runner is ticking).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LoopKind {
    Regular,
    Macro,
}

pub struct Inner {
    state: AtomicU8,
    /// Threads currently inside `post`/`wake`/`ref`/`unref` or holding a
    /// [`Borrow`]. `close()` waits for zero after publishing `Closed`.
    active: AtomicU32,
    /// Only for `close()` to sleep on while `active` drains (borrows may be long).
    drained: (Mutex<()>, Condvar),
    /// Dereferenced only while an `Access` guard is held and `state != Closed`,
    /// or on the JS thread. Nulled by `close()`.
    vm: core::cell::UnsafeCell<*mut VirtualMachine>,
    #[cfg(debug_assertions)]
    js_thread: std::thread::ThreadId,
}

// SAFETY: `vm` is only dereferenced under the gate described in the module doc;
// everything else is atomics / std sync primitives.
unsafe impl Send for Inner {}
unsafe impl Sync for Inner {}

/// See the module documentation. `repr(transparent)` over the `Arc` so a
/// `*const VmHandle` can cross FFI (C++ / napi hold boxed clones).
#[derive(Clone)]
#[repr(transparent)]
pub struct VmHandle(Arc<Inner>);

/// Result of [`VmHandle::post`]: the task was queued, or the VM is closed and
/// the caller has it back to release on this thread.
#[must_use]
pub enum Posted {
    Queued,
    Refused(NonNull<ConcurrentTaskItem>),
}

/// RAII: one unit of `active`. While held, `close()` cannot complete.
struct Access<'a>(&'a Inner);
impl Drop for Access<'_> {
    fn drop(&mut self) {
        if self.0.active.fetch_sub(1, Ordering::SeqCst) == 1
            && self.0.state.load(Ordering::SeqCst) == State::Closed as u8
        {
            let _g = self.0.drained.0.lock().unwrap();
            self.0.drained.1.notify_all();
        }
    }
}

/// An off-thread job is using memory the VM owns (request buffers, a JS
/// buffer's backing store) for as long as this is held; the VM's teardown
/// waits for it before freeing anything. Obtain with [`VmHandle::borrow`].
pub struct Borrow(
    #[allow(dead_code)] Access<'static>,
    #[allow(dead_code)] VmHandle,
);

impl VmHandle {
    /// JS thread, at VM creation.
    pub(crate) fn new(vm: *mut VirtualMachine) -> Self {
        VmHandle(Arc::new(Inner {
            state: AtomicU8::new(State::Open as u8),
            active: AtomicU32::new(0),
            drained: (Mutex::new(()), Condvar::new()),
            vm: core::cell::UnsafeCell::new(vm),
            #[cfg(debug_assertions)]
            js_thread: std::thread::current().id(),
        }))
    }

    #[inline]
    fn enter(&self) -> Option<Access<'_>> {
        self.0.active.fetch_add(1, Ordering::SeqCst);
        let a = Access(&self.0);
        if self.0.state.load(Ordering::SeqCst) == State::Closed as u8 {
            drop(a);
            return None;
        }
        Some(a)
    }

    /// # Safety
    /// Caller holds an `Access` obtained from `enter()` (so `state != Closed`
    /// was observed after `active` was raised, and `close()` cannot have
    /// returned), or is the JS thread before `close()`.
    #[inline]
    unsafe fn vm(&self) -> *mut VirtualMachine {
        // SAFETY: per fn contract.
        unsafe { *self.0.vm.get() }
    }

    #[inline]
    fn loop_of<'a>(vm: *mut VirtualMachine, kind: LoopKind) -> &'a EventLoop {
        // SAFETY: caller is inside the gate; the VM and both embedded loops are alive.
        unsafe {
            match kind {
                LoopKind::Regular => &(*vm).regular_event_loop,
                LoopKind::Macro => &(*vm).macro_event_loop,
            }
        }
    }

    // ── off-thread API ────────────────────────────────────────────────────

    /// Queue `task` on the VM's `kind` loop and wake it, or hand it back.
    pub fn post(&self, kind: LoopKind, task: NonNull<ConcurrentTaskItem>) -> Posted {
        let Some(_a) = self.enter() else {
            return Posted::Refused(task);
        };
        // SAFETY: inside the gate.
        let el = Self::loop_of(unsafe { self.vm() }, kind);
        el.concurrent_tasks.push(task);
        el.wakeup();
        Posted::Queued
    }

    /// Wake the VM's loop (no-op once closed).
    pub fn wake(&self) {
        if let Some(_a) = self.enter() {
            // SAFETY: inside the gate.
            Self::loop_of(unsafe { self.vm() }, LoopKind::Regular).wakeup();
        }
    }

    /// Keep the VM's loop alive from another thread (no-op once closed; the
    /// teardown ignores keep-alives anyway).
    pub fn ref_keep_alive(&self, kind: LoopKind) {
        if let Some(_a) = self.enter() {
            // SAFETY: inside the gate.
            let el = Self::loop_of(unsafe { self.vm() }, kind);
            let _ = el.concurrent_ref.fetch_add(1, Ordering::SeqCst);
            el.wakeup();
        }
    }

    pub fn unref_keep_alive(&self, kind: LoopKind) {
        if let Some(_a) = self.enter() {
            // SAFETY: inside the gate.
            let el = Self::loop_of(unsafe { self.vm() }, kind);
            let _ = el.concurrent_ref.fetch_sub(1, Ordering::SeqCst);
            el.wakeup();
        }
    }

    /// Advisory: has the VM started tearing down? Correct decisions go through
    /// `post`/`borrow`; this only lets a producer skip starting new work.
    pub fn is_open(&self) -> bool {
        self.0.state.load(Ordering::Acquire) == State::Open as u8
    }

    /// This job is about to use VM-owned memory off-thread; `None` if the VM
    /// is closed (touch nothing). Hold the result until done. Jobs that could
    /// block indefinitely on an external party must own their memory instead.
    pub fn borrow(&self) -> Option<Borrow> {
        let a = self.enter()?;
        // SAFETY: lifetime extension is sound because `Borrow` also holds a
        // clone of the Arc that `a` borrows from.
        let a: Access<'static> = unsafe { core::mem::transmute(a) };
        Some(Borrow(a, self.clone()))
    }

    // ── JS-thread API ─────────────────────────────────────────────────────

    #[cfg(debug_assertions)]
    fn assert_js_thread(&self) {
        debug_assert_eq!(std::thread::current().id(), self.0.js_thread);
    }
    #[cfg(not(debug_assertions))]
    fn assert_js_thread(&self) {}

    /// Teardown phase A begins.
    pub(crate) fn set_stopping(&self) {
        self.assert_js_thread();
        let _ = self.0.state.compare_exchange(
            State::Open as u8,
            State::Stopping as u8,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    /// `forbidExecution` ran: from here native code must not enter user script.
    pub(crate) fn forbid_script(&self) {
        self.assert_js_thread();
        let s = self.0.state.load(Ordering::SeqCst);
        if s < State::ScriptForbidden as u8 {
            self.0
                .state
                .store(State::ScriptForbidden as u8, Ordering::SeqCst);
        }
    }

    /// May native code call into user JS right now? (Node's `can_call_into_js`.)
    pub fn script_allowed(&self) -> bool {
        self.0.state.load(Ordering::Acquire) < State::ScriptForbidden as u8
    }

    /// Teardown, JS thread, after children are joined and before queued work
    /// is released: refuse every future post/wake/ref/borrow and wait until no
    /// thread is inside one. After this returns nothing off-thread can reach
    /// the VM; whatever was posted before is in the queues for the teardown to
    /// release.
    pub(crate) fn close(&self) {
        self.assert_js_thread();
        self.0.state.store(State::Closed as u8, Ordering::SeqCst);
        if self.0.active.load(Ordering::SeqCst) != 0 {
            let mut g = self.0.drained.0.lock().unwrap();
            while self.0.active.load(Ordering::SeqCst) != 0 {
                g = self.0.drained.1.wait(g).unwrap();
            }
        }
        // SAFETY: JS thread; no accessor can be inside any more.
        unsafe { *self.0.vm.get() = core::ptr::null_mut() };
    }

    pub fn is_closed(&self) -> bool {
        self.0.state.load(Ordering::Acquire) == State::Closed as u8
    }
}

// ── C++ holds handles as an opaque box of a clone ─────────────────────────
//
// `JSVMClientData` (and through it ScriptExecutionContext, the JSC deferred-
// work scheduler, EventLoopTaskNoContext, the debugger) keep a `BunVmHandle*`
// created here on the JS thread and released when the client data goes away.
// The box holds an Arc clone, so it stays valid however long C++ keeps it.

/// JS thread: box a clone of `vm`'s handle for C++ to keep.
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VmHandle__create(vm: &VirtualMachine) -> *mut VmHandle {
    bun_core::heap::into_raw(Box::new(vm.handle()))
}

/// Any thread: release a box obtained from `Bun__VmHandle__create`.
///
/// # Safety
/// `handle` came from `Bun__VmHandle__create` and is not used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__release(handle: *mut VmHandle) {
    // SAFETY: fn contract.
    drop(unsafe { bun_core::heap::take(handle) });
}

/// Any thread: adjust the VM's keep-alive (no-op once the VM is closed).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VmHandle__refKeepAlive(handle: &VmHandle, delta: core::ffi::c_int) {
    if delta > 0 {
        handle.ref_keep_alive(LoopKind::Regular);
    } else {
        handle.unref_keep_alive(LoopKind::Regular);
    }
}

// ── Producers that serve either a JS VM or a MiniEventLoop ────────────────
//
// fs.cp (also used by the shell), shell builtins, password hashing, zlib run
// on the work pool for whichever loop created them. For the JS case the
// completion goes through the VM's handle; a MiniEventLoop (bundler / shell /
// install threads) is owned by its thread and outlives the work it schedules,
// so its concurrent queue is posted to directly, as before.

/// Where an off-thread completion goes: a JS VM (through its handle) or a
/// mini event loop. Captured on the owning thread when the work is created.
#[derive(Clone)]
pub enum ConcurrentPoster {
    /// Erased handle of the JS loop's VM (obtained from the `EventLoopHandle`
    /// itself, so it is correct whichever thread constructs the poster).
    Js(bun_event_loop::JsPoster),
    Mini(bun_ptr::BackRef<bun_event_loop::MiniEventLoop::MiniEventLoop, bun_ptr::Mut>),
}

impl ConcurrentPoster {
    /// From an `EventLoopHandle`: the JS arm asks the loop for its VM's poster
    /// (a JS-thread-owned handle knows its VM); the mini arm posts directly.
    pub fn from_event_loop_handle(h: &bun_event_loop::EventLoopHandle) -> Self {
        match h {
            bun_event_loop::EventLoopHandle::Js { owner } => ConcurrentPoster::Js(owner.js_poster()),
            bun_event_loop::EventLoopHandle::Mini(mini) => ConcurrentPoster::Mini(*mini),
        }
    }

    pub fn is_js(&self) -> bool {
        matches!(self, ConcurrentPoster::Js(..))
    }

    /// Post a JS-loop `ConcurrentTask`. `Refused` ⇒ VM torn down, caller
    /// releases. Panics (debug) if this poster is `Mini`.
    pub fn post_js(&self, task: NonNull<ConcurrentTaskItem>) -> Posted {
        match self {
            ConcurrentPoster::Js(p) => match p.post(task) {
                Ok(()) => Posted::Queued,
                Err(task) => Posted::Refused(task),
            },
            ConcurrentPoster::Mini(_) => {
                debug_assert!(false, "post_js on a Mini poster");
                Posted::Refused(task)
            }
        }
    }

    /// Post a mini-loop task (always accepted; the mini loop outlives its work).
    pub fn post_mini(
        &self,
        task: NonNull<bun_event_loop::AnyTaskWithExtraContext::AnyTaskWithExtraContext>,
    ) {
        match self {
            ConcurrentPoster::Mini(mini) => {
                let mut mini = *mini;
                // SAFETY: per `EventLoopHandle::Mini` invariant — the mini loop is
                // alive for as long as work it created runs; its concurrent queue
                // push is thread-safe.
                unsafe { mini.get_mut() }.enqueue_task_concurrent(task);
            }
            ConcurrentPoster::Js(..) => debug_assert!(false, "post_mini on a Js poster"),
        }
    }
}

// ── Erased form for crates below bun_jsc (spawn, bundler) ─────────────────

struct PosterData {
    handle: VmHandle,
    kind: LoopKind,
}

unsafe fn poster_post(data: *const (), task: NonNull<ConcurrentTaskItem>) -> bool {
    // SAFETY: `data` is a leaked `Arc<PosterData>` pointer (see `to_js_poster`).
    let d = unsafe { &*(data as *const PosterData) };
    matches!(d.handle.post(d.kind, task), Posted::Queued)
}
unsafe fn poster_wake(data: *const ()) {
    // SAFETY: as above.
    unsafe { &*(data as *const PosterData) }.handle.wake();
}
unsafe fn poster_clone(data: *const ()) -> *const () {
    // SAFETY: as above; bump the Arc count and hand out the same pointer.
    unsafe { Arc::increment_strong_count(data as *const PosterData) };
    data
}
unsafe fn poster_drop(data: *const ()) {
    // SAFETY: as above; balances `into_raw`/`increment_strong_count`.
    unsafe { drop(Arc::from_raw(data as *const PosterData)) };
}
static POSTER_VTABLE: bun_event_loop::JsPosterVTable = bun_event_loop::JsPosterVTable {
    post: poster_post,
    wake: poster_wake,
    clone: poster_clone,
    drop: poster_drop,
};

impl VmHandle {
    /// An erased poster for `kind`, for code that cannot name `VmHandle`.
    pub fn to_js_poster(&self, kind: LoopKind) -> bun_event_loop::JsPoster {
        let data = Arc::into_raw(Arc::new(PosterData {
            handle: self.clone(),
            kind,
        })) as *const ();
        // SAFETY: `data`/vtable pair as documented on `JsPoster::from_raw`.
        unsafe { bun_event_loop::JsPoster::from_raw(data, &POSTER_VTABLE) }
    }
}

impl VirtualMachine {
    /// JS thread: an erased poster for the current loop of this VM.
    pub fn js_poster(&self) -> bun_event_loop::JsPoster {
        self.handle().to_js_poster(self.current_loop_kind())
    }
}
