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
use std::sync::Arc;

use bun_threading::{Condvar, Mutex};

use crate::event_loop::EventLoop;
use crate::virtual_machine::VirtualMachine;
use bun_event_loop::ConcurrentTask::ConcurrentTask as ConcurrentTaskItem;

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum State {
    /// Normal operation.
    Open = 0,
    /// The VM is going away — a parent's `terminate()` (from its thread) or
    /// this thread's own exit/teardown: native code enters no more script and
    /// starts no new off-thread work; posts are still accepted so completions
    /// of already-running work are delivered (and released by the teardown).
    Stopping = 1,
    /// `close()` ran: nothing off-thread reaches the VM any more.
    Closed = 2,
}

/// Which of the VM's two embedded loops a task belongs to, fixed when the task
/// is created on the JS thread (a task started while a macro runs completes
/// into the macro loop). `Bun.spawnSync`'s isolated loop is not one of these:
/// its producers post through that loop's own [`JsPoster`].
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoopKind {
    Regular,
    Macro,
}

/// The part of [`Shared`] every native→JS entry on the JS thread reads
/// (`state`, and `vm` on each post) but that changes twice per VM lifetime.
/// Kept on its own cache line: the counters below are RMW'd by pool / HTTP
/// threads on every completion, and sharing a line with them made each of the
/// JS thread's reads a miss whenever another thread had just posted.
#[cfg_attr(
    any(
        target_arch = "x86_64",
        target_arch = "aarch64",
        target_arch = "powerpc64"
    ),
    repr(align(64))
)]
#[cfg_attr(target_arch = "s390x", repr(align(128)))]
struct ReadMostly {
    state: AtomicU8,
    /// Dereferenced only while an `Access` guard is held and `state != Closed`,
    /// or on the JS thread. Nulled by `close()`.
    vm: core::cell::UnsafeCell<*mut VirtualMachine>,
}

#[cfg_attr(
    any(
        target_arch = "x86_64",
        target_arch = "aarch64",
        target_arch = "powerpc64"
    ),
    repr(align(64))
)]
#[cfg_attr(target_arch = "s390x", repr(align(128)))]
pub struct Shared {
    hot: ReadMostly,
    /// Threads currently inside `post`/`wake`/`ref`/`unref` or holding a
    /// [`Borrow`]. `close()` waits for zero after publishing `Closed`.
    active: AtomicU32,
    /// For `close()` to sleep on while `active` drains (borrows may be long),
    /// and `wait_for_embedded_work()` while `embedded` drains.
    drained: (Mutex, Condvar),
    /// Pool work scheduled with storage inside a JS-owned object (see
    /// [`VmHandle::embedded_work_scheduled`]); teardown waits for zero.
    embedded: AtomicU32,
    #[cfg(debug_assertions)]
    js_thread: std::thread::ThreadId,
    /// Test suite only — see [`refusal_gate`].
    #[cfg(debug_assertions)]
    park_posts: core::sync::atomic::AtomicBool,
}

// SAFETY: `vm` is only dereferenced under the gate described in the module doc;
// everything else is atomics / std sync primitives.
unsafe impl Send for Shared {}
// SAFETY: as above.
unsafe impl Sync for Shared {}

/// See the module documentation. `repr(transparent)` over the `Arc` so a
/// `*const VmHandle` can cross FFI (C++ / napi hold boxed clones).
#[derive(Clone)]
#[repr(transparent)]
pub struct VmHandle(Arc<Shared>);

pub use bun_event_loop::Posted;

/// RAII: one unit of `active`. While held, `close()` cannot complete.
struct Access<'a>(&'a Shared);
impl Drop for Access<'_> {
    fn drop(&mut self) {
        if self.0.active.fetch_sub(1, Ordering::SeqCst) == 1
            && self.0.hot.state.load(Ordering::SeqCst) == State::Closed as u8
        {
            self.0.drained.0.lock();
            self.0.drained.1.notify_all();
            self.0.drained.0.unlock();
        }
    }
}

/// An off-thread job is using memory the VM owns (request buffers, a JS
/// buffer's backing store) for as long as this is held; the VM's teardown
/// waits for it before freeing anything. Obtain with [`VmHandle::borrow`].
pub struct Borrow {
    _access: Access<'static>,
    /// Keeps the `Shared` that `_access` borrows alive.
    _handle: VmHandle,
}

impl VmHandle {
    /// JS thread, at VM creation.
    pub(crate) fn new(vm: *mut VirtualMachine) -> Self {
        VmHandle(Arc::new(Shared {
            hot: ReadMostly {
                state: AtomicU8::new(State::Open as u8),
                vm: core::cell::UnsafeCell::new(vm),
            },
            active: AtomicU32::new(0),
            drained: (Mutex::new(), Condvar::new()),
            embedded: AtomicU32::new(0),
            #[cfg(debug_assertions)]
            js_thread: std::thread::current().id(),
            #[cfg(debug_assertions)]
            park_posts: core::sync::atomic::AtomicBool::new(false),
        }))
    }

    #[inline]
    fn enter(&self) -> Option<Access<'_>> {
        self.0.active.fetch_add(1, Ordering::SeqCst);
        let a = Access(&self.0);
        if self.0.hot.state.load(Ordering::SeqCst) == State::Closed as u8 {
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
        unsafe { *self.0.hot.vm.get() }
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
        refusal_gate::before_post(self);
        let Some(_a) = self.enter() else {
            // SAFETY: handed to us by the caller and not yet queued anywhere.
            let tag = unsafe { task.as_ref() }.task.tag;
            refusal_gate::refused(self, format_args!("post: {}", tag.name()));
            return Posted::Refused(task);
        };
        // SAFETY: inside the gate.
        let el = Self::loop_of(unsafe { self.vm() }, kind);
        el.concurrent_tasks.push(task);
        el.wakeup();
        Posted::Queued
    }

    /// Queue a C++ `EventLoopTask` from another thread (WebCore's
    /// `postTaskConcurrently`), or delete it unrun if the VM is gone — the
    /// same release teardown applies to queued C++ tasks.
    ///
    /// # Safety
    /// `task` is a live heap `WebCore::EventLoopTask` the caller hands over.
    pub unsafe fn post_cpp_task(&self, task: *mut crate::cpp_task::CppTask) {
        unsafe extern "C" {
            fn Bun__deleteEventLoopTask(task: *mut crate::cpp_task::CppTask);
        }
        let ct = ConcurrentTaskItem::create(bun_event_loop::Task::init(task));
        if let Posted::Refused(ct) = self.post(LoopKind::Regular, ct) {
            // SAFETY: refused ⇒ we own both boxes.
            unsafe {
                drop(bun_core::heap::take(ct.as_ptr()));
                Bun__deleteEventLoopTask(task);
            }
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

    /// This job is about to use VM-owned memory off-thread; `None` if the VM
    /// is closed (touch nothing). Hold the result until done. Jobs that could
    /// block indefinitely on an external party must own their memory instead.
    pub fn borrow(&self) -> Option<Borrow> {
        let a = self.enter()?;
        // SAFETY: lifetime extension is sound because `Borrow` also holds a
        // clone of the Arc that `a` borrows from.
        let a: Access<'static> = unsafe { core::mem::transmute(a) };
        Some(Borrow {
            _access: a,
            _handle: self.clone(),
        })
    }

    /// As [`borrow`](Self::borrow), but only while the VM is still running
    /// (not yet stopping): what a pool body checks before doing work whose
    /// only consumer is script.
    pub fn borrow_if_running(&self) -> Option<Borrow> {
        let b = self.borrow()?;
        (self.0.hot.state.load(Ordering::SeqCst) == State::Open as u8).then_some(b)
    }

    // ── embedded work ─────────────────────────────────────────────────────
    //
    // Pool work whose storage is a field of a JS-owned object (a transpile
    // slot inside the VM, a zlib stream's native part) cannot be boxed into a
    // `Job` and cannot outlive the VM. It is counted instead: teardown waits
    // for the count before the handle closes, so such work always posts its
    // completion into a live queue and is released on the JS thread — the
    // pool side never sees a dead VM. Bodies check `borrow_if_running` so a
    // stopping VM only waits for the pool to *reach* the work, not to do it.

    /// JS thread, before handing embedded work to the pool. Script starts
    /// such work only while the VM is open; a native continuation that runs
    /// during teardown (a release arm retrying a request) checks
    /// [`accepting_work`](Self::accepting_work) first and fails instead.
    pub fn embedded_work_scheduled(&self) {
        debug_assert!(
            self.0.hot.state.load(Ordering::SeqCst) != State::Closed as u8,
            "embedded work started on a closed VM handle"
        );
        self.0.embedded.fetch_add(1, Ordering::SeqCst);
    }

    /// Whether new off-thread work may still be started for this VM (it has
    /// not begun stopping). JS thread.
    pub fn accepting_work(&self) -> bool {
        self.0.hot.state.load(Ordering::SeqCst) == State::Open as u8
    }

    /// Pool thread, after its last touch of the embedded storage (i.e. after
    /// posting the completion).
    pub fn embedded_work_finished(&self) {
        if self.0.embedded.fetch_sub(1, Ordering::SeqCst) == 1
            && self.0.hot.state.load(Ordering::SeqCst) != State::Open as u8
        {
            self.0.drained.0.lock();
            self.0.drained.1.notify_all();
            self.0.drained.0.unlock();
        }
    }

    pub(crate) fn embedded_work_outstanding(&self) -> u32 {
        self.0.embedded.load(Ordering::SeqCst)
    }

    /// Teardown (JS thread, stopping, before `close()`): wait until the pool
    /// holds no embedded work of this VM.
    pub(crate) fn wait_for_embedded_work(&self) {
        self.assert_js_thread();
        debug_assert!(self.0.hot.state.load(Ordering::SeqCst) != State::Open as u8);
        if self.0.embedded.load(Ordering::SeqCst) != 0 {
            self.0.drained.0.lock();
            while self.0.embedded.load(Ordering::SeqCst) != 0 {
                self.0.drained.1.wait(&self.0.drained.0);
            }
            self.0.drained.0.unlock();
        }
    }

    // ── JS-thread API ─────────────────────────────────────────────────────

    #[cfg(debug_assertions)]
    pub(crate) fn assert_js_thread(&self) {
        debug_assert_eq!(std::thread::current().id(), self.0.js_thread);
    }
    #[cfg(not(debug_assertions))]
    #[inline(always)]
    pub(crate) fn assert_js_thread(&self) {}

    /// The VM is going away: `Open → Stopping` (idempotent; never reopens or
    /// un-closes). Any thread — a parent's `terminate()` calls it at request
    /// time, as Node's `Environment::ExitEnv` sets `is_stopping` from the
    /// requesting thread; this thread's own exit path calls it via
    /// `VirtualMachine::forbid_script`.
    pub fn stop(&self) {
        let _ = self.0.hot.state.compare_exchange(
            State::Open as u8,
            State::Stopping as u8,
            Ordering::SeqCst,
            Ordering::SeqCst,
        );
    }

    /// May native code call into user JS / settle its promises right now?
    /// (Node's `can_call_into_js()`.) Any thread; meaningful on the JS thread.
    pub fn script_allowed(&self) -> bool {
        self.0.hot.state.load(Ordering::Acquire) == State::Open as u8
    }

    /// Teardown, JS thread, after children are joined and before queued work
    /// is released: refuse every future post/wake/ref/borrow and wait until no
    /// thread is inside one. After this returns nothing off-thread can reach
    /// the VM; whatever was posted before is in the queues for the teardown to
    /// release.
    pub(crate) fn close(&self) {
        self.assert_js_thread();
        self.0
            .hot
            .state
            .store(State::Closed as u8, Ordering::SeqCst);
        refusal_gate::closed(self);
        if self.0.active.load(Ordering::SeqCst) != 0 {
            self.0.drained.0.lock();
            while self.0.active.load(Ordering::SeqCst) != 0 {
                self.0.drained.1.wait(&self.0.drained.0);
            }
            self.0.drained.0.unlock();
        }
        // SAFETY: JS thread; no accessor can be inside any more.
        unsafe { *self.0.hot.vm.get() = core::ptr::null_mut() };
    }
}

// ── Test suite only: deterministic refusals ───────────────────────────────
//
// `BUN_DEBUG_TEST_WORKER_REFUSAL_GATE` (worker VMs; builds with debug
// assertions): a post from another thread — unless counted work is
// outstanding, whose producer must post before its count can return — waits
// until this handle is closed and only then proceeds, so it is refused with the
// real preconditions (the JS side already released, the handle really closed)
// and the producer's own release path runs every time rather than only when it
// happens to lose the race with teardown. Each refusal is named on stderr.
#[cfg(debug_assertions)]
mod refusal_gate {
    use super::{Ordering, State, VmHandle};

    impl VmHandle {
        pub(crate) fn park_posts_until_closed(&self) {
            self.0.park_posts.store(true, Ordering::Relaxed);
        }
        fn posts_parked(&self) -> bool {
            self.0.park_posts.load(Ordering::Relaxed)
        }
    }

    pub(super) fn before_post(h: &VmHandle) {
        if !h.posts_parked()
            || std::thread::current().id() == h.0.js_thread
            || h.0.embedded.load(Ordering::SeqCst) != 0
        {
            return;
        }
        // Not holding `active` here: close() waits for that to drain.
        h.0.drained.0.lock();
        while h.0.hot.state.load(Ordering::SeqCst) != State::Closed as u8 {
            h.0.drained.1.wait(&h.0.drained.0);
        }
        h.0.drained.0.unlock();
    }

    /// close(), after publishing Closed: parked posts go now (and are refused).
    pub(super) fn closed(h: &VmHandle) {
        if h.posts_parked() {
            h.0.drained.0.lock();
            h.0.drained.1.notify_all();
            h.0.drained.0.unlock();
        }
    }

    pub(super) fn refused(h: &VmHandle, what: core::fmt::Arguments<'_>) {
        if h.posts_parked() {
            let w = bun_core::output::error_writer();
            let _ = writeln!(w, "[vm_handle] refused {what}");
            let _ = w.flush();
        }
    }
}
#[cfg(not(debug_assertions))]
mod refusal_gate {
    use super::VmHandle;
    #[inline(always)]
    pub(super) fn before_post(_: &VmHandle) {}
    #[inline(always)]
    pub(super) fn closed(_: &VmHandle) {}
    #[inline(always)]
    pub(super) fn refused(_: &VmHandle, _: core::fmt::Arguments<'_>) {}
}

// ── C++ holds counted references to a handle ─────────────────────────────
//
// One representation crosses the FFI: `*const Shared`, a strong count on the
// Arc every `VmHandle` clone points at (`BunVmHandleRef` in C++). Long-lived
// holders (JSVMClientData, EventLoopTaskNoContext, NapiEnv) `retain` one and
// `release` it; a call that merely uses a reference someone else holds borrows
// it for the duration ([`VmHandle::borrow_ref`]). Nothing is boxed.

/// A `VmHandle` view over a reference C++ holds, for the duration of one call:
/// the count stays C++'s.
pub struct BorrowedRef(core::mem::ManuallyDrop<VmHandle>);
impl core::ops::Deref for BorrowedRef {
    type Target = VmHandle;
    fn deref(&self) -> &VmHandle {
        &self.0
    }
}

impl VmHandle {
    /// Hand C++ one strong count on this handle.
    pub fn into_ref(self) -> *const Shared {
        Arc::into_raw(self.0)
    }

    /// # Safety
    /// `r` is a live reference obtained from [`VmHandle::into_ref`] (directly or
    /// via `Bun__VmHandle__retain*`) that its holder keeps for the duration.
    pub unsafe fn borrow_ref(r: *const Shared) -> BorrowedRef {
        // SAFETY: fn contract; ManuallyDrop leaves the holder's count untouched.
        BorrowedRef(core::mem::ManuallyDrop::new(VmHandle(unsafe {
            Arc::from_raw(r)
        })))
    }

    /// # Safety
    /// `r` came from [`VmHandle::into_ref`] and its holder gives the count up here.
    pub unsafe fn from_ref(r: *const Shared) -> VmHandle {
        // SAFETY: fn contract.
        VmHandle(unsafe { Arc::from_raw(r) })
    }
}

/// JS thread: a reference to `vm`'s handle for C++ to keep (`release` when done).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__VmHandle__retain(vm: &VirtualMachine) -> *const Shared {
    vm.handle().into_ref()
}

/// Any thread: one more reference on the same handle (for something that may
/// outlive whoever it got the reference from).
///
/// # Safety
/// `r` is a live reference its holder keeps for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__retainRef(r: *const Shared) -> *const Shared {
    // SAFETY: fn contract.
    unsafe { VmHandle::borrow_ref(r) }.clone().into_ref()
}

/// Any thread: give a reference up.
///
/// # Safety
/// `r` came from `Bun__VmHandle__retain*` and is not used afterwards.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__release(r: *const Shared) {
    // SAFETY: fn contract.
    drop(unsafe { VmHandle::from_ref(r) });
}

/// Any thread: post a C++ task through a reference and give the reference up
/// (queued, or deleted unrun if the VM is gone). For a caller that took the
/// reference only to keep the VM reachable past a lock it was about to drop.
///
/// # Safety
/// `r` came from `Bun__VmHandle__retain*` and is not used afterwards; `task` is
/// a live heap `WebCore::EventLoopTask` handed over.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__postAndRelease(
    r: *const Shared,
    task: *mut crate::cpp_task::CppTask,
) {
    // SAFETY: fn contract.
    let handle = unsafe { VmHandle::from_ref(r) };
    // SAFETY: fn contract.
    unsafe { handle.post_cpp_task(task) };
}

/// JS thread: adjust this VM's keep-alive directly (balanced pairs from
/// MessagePort / BroadcastChannel / ScriptExecutionContext stay balanced through
/// teardown; the cross-thread route below stops applying once the VM closes).
#[unsafe(no_mangle)]
pub extern "C" fn Bun__eventLoop__refKeepAlive(vm: &VirtualMachine, delta: core::ffi::c_int) {
    if delta > 0 {
        vm.event_loop_shared().ref_keep_alive();
    } else {
        vm.event_loop_shared().unref_keep_alive();
    }
}

/// Any thread: adjust the VM's keep-alive (no-op once the VM is closed).
///
/// # Safety
/// `r` is a live reference its holder keeps for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__refKeepAlive(r: *const Shared, delta: core::ffi::c_int) {
    // SAFETY: fn contract.
    let handle = unsafe { VmHandle::borrow_ref(r) };
    if delta > 0 {
        handle.ref_keep_alive(LoopKind::Regular);
    } else {
        handle.unref_keep_alive(LoopKind::Regular);
    }
}

/// Any thread: Node's `can_call_into_js()` — false once the VM's stop was
/// requested (a parent's terminate(), the worker's own exit, teardown).
///
/// # Safety
/// `r` is a live reference its holder keeps for the duration of the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__scriptAllowed(r: *const Shared) -> bool {
    // SAFETY: fn contract.
    unsafe { VmHandle::borrow_ref(r) }.script_allowed()
}

/// The address of this handle's state byte, for C++ to test
/// `*addr == BUN_VM_HANDLE_STATE_OPEN` inline on its native→JS entries instead
/// of calling out per callback. Valid as long as the reference is held.
///
/// # Safety
/// `r` is a live reference.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn Bun__VmHandle__stateAddress(r: *const Shared) -> *const AtomicU8 {
    // SAFETY: fn contract; `hot.state` lives in the Arc payload `r` points at.
    unsafe { &raw const (*r).hot.state }
}

// C++ (BunClientData.h) hard-codes this value.
const _: () = assert!(State::Open as u8 == 0);

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
            bun_event_loop::EventLoopHandle::Js { owner } => {
                ConcurrentPoster::Js(owner.js_poster())
            }
            bun_event_loop::EventLoopHandle::Mini(mini) => ConcurrentPoster::Mini(*mini),
        }
    }

    pub fn is_js(&self) -> bool {
        matches!(self, ConcurrentPoster::Js(..))
    }

    /// JS arm: count embedded work on the VM (see `VmHandle`). A mini loop is
    /// owned by its thread and outlives its work, so there is nothing to count.
    pub fn embedded_work_scheduled(&self) {
        if let ConcurrentPoster::Js(p) = self {
            p.embedded_work_scheduled();
        }
    }
    pub fn embedded_work_finished(&self) {
        if let ConcurrentPoster::Js(p) = self {
            p.embedded_work_finished();
        }
    }

    /// Post a JS-loop `ConcurrentTask`. `Refused` ⇒ VM torn down, caller
    /// releases. Panics (debug) if this poster is `Mini`.
    pub fn post_js(&self, task: NonNull<ConcurrentTaskItem>) -> Posted {
        match self {
            ConcurrentPoster::Js(p) => p.post(task),
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

unsafe fn poster_post(data: *const (), task: NonNull<ConcurrentTaskItem>) -> Posted {
    // SAFETY: `data` is a leaked `Arc<PosterData>` pointer (see `to_js_poster`).
    let d = unsafe { &*data.cast::<PosterData>() };
    d.handle.post(d.kind, task)
}
unsafe fn poster_clone(data: *const ()) -> *const () {
    // SAFETY: as above; bump the Arc count and hand out the same pointer.
    unsafe { Arc::increment_strong_count(data.cast::<PosterData>()) };
    data
}
unsafe fn poster_drop(data: *const ()) {
    // SAFETY: as above; balances `into_raw`/`increment_strong_count`.
    unsafe { drop(Arc::from_raw(data.cast::<PosterData>())) };
}
unsafe fn poster_embedded_scheduled(data: *const ()) {
    // SAFETY: as `poster_post`.
    unsafe { &*data.cast::<PosterData>() }
        .handle
        .embedded_work_scheduled();
}
unsafe fn poster_embedded_finished(data: *const ()) {
    // SAFETY: as `poster_post`.
    unsafe { &*data.cast::<PosterData>() }
        .handle
        .embedded_work_finished();
}
static POSTER_VTABLE: bun_event_loop::JsPosterVTable = bun_event_loop::JsPosterVTable {
    post: poster_post,
    embedded_work_scheduled: poster_embedded_scheduled,
    embedded_work_finished: poster_embedded_finished,
    clone: poster_clone,
    drop: poster_drop,
};

impl VmHandle {
    /// An erased poster for `kind`, for code that cannot name `VmHandle`.
    pub fn to_js_poster(&self, kind: LoopKind) -> bun_event_loop::JsPoster {
        let data = Arc::into_raw(Arc::new(PosterData {
            handle: self.clone(),
            kind,
        }))
        .cast::<()>();
        // SAFETY: `data`/vtable pair as documented on `JsPoster::from_raw`.
        unsafe { bun_event_loop::JsPoster::from_raw(data, &POSTER_VTABLE) }
    }
}

impl VirtualMachine {
    /// JS thread: an erased poster for the current loop of this VM.
    pub fn js_poster(&self) -> bun_event_loop::JsPoster {
        self.loop_handle().to_js_poster()
    }
}

// ── LoopHandle: "where this job's completion goes" ────────────────────────

/// A [`VmHandle`] plus the loop of that VM the completion belongs on — what a
/// job created on the JS thread captures (`vm.loop_handle()`) and posts back
/// through from whatever thread finishes it.
#[derive(Clone)]
pub struct LoopHandle {
    vm: VmHandle,
    kind: LoopKind,
}

/// A job that finishes off the JS thread and is posted back to its VM as a
/// `ConcurrentTask` — see [`post_job`]. It says where its [`LoopHandle`] lives
/// and how to release itself when the VM is already gone. There is
/// deliberately no default for the release: a job that cannot release itself
/// does not compile.
pub trait Postable: bun_event_loop::Taskable + Sized {
    /// The handle captured at creation (`vm.loop_handle()`), stored in the job.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn loop_handle(this: *mut Self) -> *const LoopHandle;

    /// The `ConcurrentTask` that carries `this`: a fresh heap one by default;
    /// jobs with an embedded task return that instead.
    ///
    /// # Safety
    /// `this` is live.
    unsafe fn concurrent_task(this: *mut Self) -> NonNull<ConcurrentTaskItem> {
        ConcurrentTaskItem::create_from(this)
    }

    /// The VM refused the completion (torn down). Runs on the posting thread,
    /// usually *not* the JS thread: free what the job owns, do not touch JSC
    /// handles (they die with the VM), and free the allocation itself.
    ///
    /// # Safety
    /// `this` is the live job; nothing uses it afterwards.
    unsafe fn release_refused(this: *mut Self);
}

/// Post a finished job's completion back to the VM it came from. If that VM
/// has been torn down, the job releases itself here; callers have nothing to
/// check either way.
///
/// # Safety
/// `job` is a live heap job whose off-thread part is finished; the caller does
/// not touch it afterwards (it now belongs to the VM's queue, or was released).
pub unsafe fn post_job<T: Postable>(job: *mut T) {
    // Clone the handle out first: a refusal frees `job`, handle field included.
    // SAFETY: fn contract.
    let handle = unsafe { (*T::loop_handle(job)).clone() };
    // SAFETY: fn contract.
    let task = unsafe { T::concurrent_task(job) };
    if let Posted::Refused(task) = handle.post_task(task) {
        refusal_gate::refused(
            &handle.vm,
            format_args!("job: {}", core::any::type_name::<T>()),
        );
        // SAFETY: handed back unqueued; `job` per fn contract.
        unsafe {
            ConcurrentTaskItem::release_refused(task);
            T::release_refused(job);
        }
    }
}

impl LoopHandle {
    /// Post an already-built task. Prefer [`post_job`], which leaves the caller
    /// nothing to check; this hands a refusal back.
    pub fn post_task(&self, task: NonNull<ConcurrentTaskItem>) -> Posted {
        self.vm.post(self.kind, task)
    }
    pub fn borrow(&self) -> Option<Borrow> {
        self.vm.borrow()
    }
    pub fn borrow_if_running(&self) -> Option<Borrow> {
        self.vm.borrow_if_running()
    }
    pub fn accepting_work(&self) -> bool {
        self.vm.accepting_work()
    }
    pub fn embedded_work_scheduled(&self) {
        self.vm.embedded_work_scheduled()
    }
    pub fn embedded_work_finished(&self) {
        self.vm.embedded_work_finished()
    }
    pub fn ref_keep_alive(&self) {
        self.vm.ref_keep_alive(self.kind)
    }
    pub fn unref_keep_alive(&self) {
        self.vm.unref_keep_alive(self.kind)
    }
    /// An erased poster for this loop, for code that cannot name `bun_jsc`.
    pub fn to_js_poster(&self) -> bun_event_loop::JsPoster {
        self.vm.to_js_poster(self.kind)
    }
}

impl VirtualMachine {
    /// This VM's live pool jobs. JS thread only.
    #[allow(clippy::mut_from_ref)]
    #[inline]
    pub fn jobs(&self) -> &mut crate::job::JobList {
        // SAFETY: JS-thread-only intrusive list; callers never hold two at once
        // (each call is a single push/unlink/release statement).
        unsafe { &mut *self.jobs.get() }
    }

    /// JS thread: the handle a new job captures — this VM, and the loop it is
    /// currently ticking (regular, macro, or a spawnSync isolated loop).
    pub fn loop_handle(&self) -> LoopHandle {
        LoopHandle {
            vm: self.handle(),
            kind: self.current_loop_kind(),
        }
    }
}

// ── Isolated event loops (Bun.spawnSync) ──────────────────────────────────
//
// spawnSync runs a third, heap-allocated `EventLoop` on the JS thread while it
// blocks; process exits (waiter thread) and pool completions for that call
// must land on *its* concurrent queue, not the VM's. It gets its own small
// poster with the same gate discipline, closed before the loop is freed.

/// Opaque outside this crate: the poster of a spawnSync isolated loop.
pub struct IsolatedPosterInner {
    open: core::sync::atomic::AtomicBool,
    active: AtomicU32,
    event_loop: *const EventLoop,
}
// SAFETY: `event_loop` is dereferenced only under the gate (open && counted).
unsafe impl Send for IsolatedPosterInner {}
// SAFETY: as above.
unsafe impl Sync for IsolatedPosterInner {}

impl IsolatedPosterInner {
    pub(crate) fn new(event_loop: *const EventLoop) -> Arc<Self> {
        Arc::new(Self {
            open: core::sync::atomic::AtomicBool::new(true),
            active: AtomicU32::new(0),
            event_loop,
        })
    }

    /// JS thread, before the isolated loop is freed: refuse further posts and
    /// wait out anyone mid-post.
    pub(crate) fn close(&self) {
        self.open.store(false, Ordering::SeqCst);
        while self.active.load(Ordering::SeqCst) != 0 {
            core::hint::spin_loop();
        }
    }

    pub(crate) fn post(&self, task: NonNull<ConcurrentTaskItem>) -> Posted {
        self.active.fetch_add(1, Ordering::SeqCst);
        let open = self.open.load(Ordering::SeqCst);
        if open {
            // SAFETY: gate held and open ⇒ the isolated loop is alive.
            let el = unsafe { &*self.event_loop };
            el.concurrent_tasks.push(task);
            el.wakeup();
        }
        self.active.fetch_sub(1, Ordering::SeqCst);
        if open {
            Posted::Queued
        } else {
            Posted::Refused(task)
        }
    }

    pub(crate) fn to_js_poster(this: &Arc<Self>) -> bun_event_loop::JsPoster {
        let data = Arc::into_raw(Arc::clone(this)).cast::<()>();
        // SAFETY: data/vtable pair per `JsPoster::from_raw`.
        unsafe { bun_event_loop::JsPoster::from_raw(data, &ISOLATED_POSTER_VTABLE) }
    }
}

unsafe fn isolated_post(data: *const (), task: NonNull<ConcurrentTaskItem>) -> Posted {
    // SAFETY: leaked Arc<IsolatedPosterInner>.
    unsafe { &*data.cast::<IsolatedPosterInner>() }.post(task)
}
unsafe fn isolated_clone(data: *const ()) -> *const () {
    // SAFETY: as above.
    unsafe { Arc::increment_strong_count(data.cast::<IsolatedPosterInner>()) };
    data
}
unsafe fn isolated_drop(data: *const ()) {
    // SAFETY: as above.
    unsafe { drop(Arc::from_raw(data.cast::<IsolatedPosterInner>())) };
}
// An isolated loop is driven to completion synchronously by its creator on
// the JS thread (spawnSync), so its VM cannot tear down under its work.
unsafe fn isolated_embedded_noop(_data: *const ()) {}
static ISOLATED_POSTER_VTABLE: bun_event_loop::JsPosterVTable = bun_event_loop::JsPosterVTable {
    post: isolated_post,
    embedded_work_scheduled: isolated_embedded_noop,
    embedded_work_finished: isolated_embedded_noop,
    clone: isolated_clone,
    drop: isolated_drop,
};
