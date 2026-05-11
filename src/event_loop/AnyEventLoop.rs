use bun_io::FilePoll;
use bun_dotenv::Loader as DotEnvLoader;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use crate::ConcurrentTask::ConcurrentTask;
use crate::MiniEventLoop::{EventLoopKind, MiniEventLoop};
use crate::JsEventLoop;

/// JS-event-loop arm of `AnyEventLoop` / `EventLoopHandle`.
///
/// LAYERING: `bun_event_loop` is a lower tier than `bun_jsc`, so it cannot name
/// `jsc::EventLoop` / `jsc::VirtualMachine` directly. Zig has no crate
/// boundaries and just calls `this.js.tick()` etc. inline (see
/// `src/event_loop/AnyEventLoop.zig` / `src/jsc/EventLoopHandle.zig`). To match
/// that — direct calls, no runtime registration — the concrete bodies live in
/// `bun_jsc::event_loop` as `#[no_mangle]` Rust-ABI functions and are declared
/// here as `extern "Rust"`. The linker resolves them at link time, so there is
/// no vtable, no `AtomicPtr`, and no init-order hazard.
///
/// The `Js` variant stores a typed [`JsEventLoop`] handle over the erased
/// `*mut jsc::EventLoop`. The single `unsafe` is at handle construction; all
/// dispatch sites are safe method calls over that typed sidecar handle.
unsafe extern "Rust" {
    /// `jsc::VirtualMachine::get().event_loop()` — erased `*mut jsc::EventLoop`
    /// for the current thread. Kept as a bare extern (no owner).
    pub(crate) fn __bun_js_event_loop_current() -> *mut ();
}

/// Useful for code that may need an event loop and could be used from either JavaScript or directly without JavaScript.
/// Unlike jsc.EventLoopHandle, this owns the event loop when it's not a JavaScript event loop.
// PORT NOTE: Zig `union(EventLoopKind)` — variant order/discriminant must match `crate::EventLoopKind`.
pub enum AnyEventLoop<'a> {
    Js {
        /// Typed handle wrapping the erased `*mut jsc::EventLoop`. The
        /// owner-liveness invariant is established once at construction;
        /// dispatch is safe.
        owner: JsEventLoop,
    },
    Mini(MiniEventLoop<'a>),
}

// PORT NOTE: Zig had `pub const Task = AnyTaskWithExtraContext;` as an associated decl.
// Inherent associated types are unstable in Rust, so expose at module level.
pub type Task = AnyTaskWithExtraContext;

impl<'a> Default for AnyEventLoop<'a> {
    /// Stub default for `#[derive(Default)]` containers (e.g. the
    /// `bun_install::PackageManager` stub). Real consumers always overwrite
    /// this via `init()` / `js_current()` before use.
    fn default() -> Self {
        AnyEventLoop::Mini(MiniEventLoop::init())
    }
}

impl<'a> AnyEventLoop<'a> {
    /// Alias for [`r#loop`](Self::r#loop) so callers that already spell
    /// `event_loop.loop_()` (Zig: `eventLoop().loop()`) compile without the
    /// raw-identifier escape. Returns the underlying uws/libuv loop pointer.
    #[inline]
    pub fn loop_(&mut self) -> *mut UwsLoop {
        self.r#loop()
    }

    pub fn iteration_number(&self) -> u64 {
        match self {
            AnyEventLoop::Js { owner } => owner.iteration_number(),
            // SAFETY: see `MiniEventLoop::loop_ptr()` invariant.
            AnyEventLoop::Mini(mini) => unsafe { (*mini.loop_ptr()).iteration_number() },
        }
    }

    pub fn wakeup(&mut self) {
        // SAFETY: `r#loop()` returns a valid live loop pointer.
        unsafe { (*self.r#loop()).wakeup() };
    }

    /// Returns the FilePoll store as a raw pointer (mirrors Zig `*FilePoll.Store`).
    /// The `Js` arm reaches VM-owned storage via an erased `*mut ()`; multiple
    /// `AnyEventLoop::Js` (and `EventLoopHandle::Js`) may name the same VM, so
    /// promoting to `&mut` here would assert uniqueness we can't prove. Callers
    /// deref locally for the brief region they need `&mut` — same contract as
    /// [`EventLoopHandle::file_polls`].
    pub fn file_polls(&mut self) -> *mut bun_io::file_poll::Store {
        match self {
            AnyEventLoop::Js { owner } => owner.file_polls(),
            AnyEventLoop::Mini(mini) => std::ptr::from_mut(mini.file_polls()),
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll
            .flags
            .contains(bun_io::file_poll::Flags::WasEverRegistered);
        match self {
            AnyEventLoop::Js { owner } => owner.put_file_poll(poll, was_ever_registered),
            AnyEventLoop::Mini(mini) => {
                // PORT NOTE: reshaped for borrowck — Zig passed `&this.mini`
                // while also holding `this.mini.filePolls()` mutably. Erase
                // `mini` to a raw `EventLoopCtx` (Copy, no borrow) before
                // taking the `&mut Store` borrow; `Store::put` only touches
                // `mini.after_event_loop_callback{,_ctx}` through the ctx,
                // which is field-disjoint from `file_polls_`.
                let ctx = MiniEventLoop::as_event_loop_ctx(std::ptr::from_mut(mini));
                mini.file_polls().put(poll, ctx, was_ever_registered);
            }
        }
    }

    // PORT NOTE: renamed via raw identifier — `loop` is a Rust keyword.
    pub fn r#loop(&mut self) -> *mut UwsLoop {
        match self {
            AnyEventLoop::Js { owner } => owner.uws_loop(),
            AnyEventLoop::Mini(mini) => mini.loop_ptr(),
        }
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same VM-shared-storage aliasing concern as [`file_polls`] —
    /// the `Js` arm cannot prove exclusive access, so callers deref locally.
    pub fn pipe_read_buffer(&mut self) -> *mut [u8] {
        match self {
            AnyEventLoop::Js { owner } => owner.pipe_read_buffer(),
            AnyEventLoop::Mini(mini) => std::ptr::from_mut::<[u8]>(mini.pipe_read_buffer()),
        }
    }

    /// Convert to an owned [`EventLoopHandle`]. Thin alias for
    /// [`EventLoopHandle::from_any`] kept for Zig-shape parity — callers that
    /// were `jsc.EventLoopHandle.init(any_loop)` in Zig spell it
    /// `AnyEventLoop::as_handle(any_loop)` in Rust.
    #[inline]
    pub fn as_handle(this: &mut AnyEventLoop<'static>) -> EventLoopHandle {
        EventLoopHandle::from_any(this)
    }

    pub fn init() -> AnyEventLoop<'a> {
        // PORT NOTE: Zig took `std.mem.Allocator param`; dropped per §Allocators (non-AST crate).
        AnyEventLoop::Mini(MiniEventLoop::init())
    }

    /// Construct the `Js` variant wrapping a specific erased
    /// `*mut jsc::EventLoop`. Mirrors Zig's `.{ .js = vm.eventLoop() }`
    /// literal — callers that already hold a VM pointer use this instead of
    /// the thread-local lookup in [`js_current`].
    #[inline]
    pub fn js(js_event_loop: *mut ()) -> AnyEventLoop<'static> {
        // SAFETY: caller passes a live erased `*mut jsc::EventLoop` (Zig
        // `vm.eventLoop()`). This is the single `unsafe` boundary for the
        // `AnyEventLoop::Js` arm — all subsequent dispatch is safe.
        AnyEventLoop::from_js(unsafe { JsEventLoop::from_raw(js_event_loop) })
    }

    #[inline]
    pub fn from_js(owner: JsEventLoop) -> AnyEventLoop<'static> {
        AnyEventLoop::Js { owner }
    }

    /// Construct the `Js` variant for the current thread's JS event loop.
    /// Replaces `jsc::VirtualMachine::get().event_loop()` for tier-≤4 callers
    /// (e.g. `bun_install::PackageManager`).
    pub fn js_current() -> AnyEventLoop<'static> {
        AnyEventLoop::Js { owner: JsEventLoop::current() }
    }

    // PORT NOTE: Zig `context: anytype` + `@ptrCast(isDone)` erases the fn-ptr
    // type at the call into `mini.tick(ctx, *const fn(*anyopaque) bool)`. All
    // callers pass a pointer, so we take the erased form directly; callers cast.
    pub fn tick(
        &mut self,
        context: *mut core::ffi::c_void,
        is_done: fn(*mut core::ffi::c_void) -> bool,
    ) {
        match self {
            AnyEventLoop::Js { owner } => {
                let owner = *owner;
                while !is_done(context) {
                    let previous_context = owner.set_current_context(context);
                    let _context_guard = scopeguard::guard(previous_context, |previous_context| {
                        owner.restore_current_context(previous_context);
                    });
                    owner.tick();
                    owner.auto_tick();
                }
            }
            AnyEventLoop::Mini(mini) => mini.tick(context, is_done),
        }
    }

    /// Raw-pointer variant of [`Self::tick`] for callers whose `is_done`
    /// callback may reborrow the struct that *contains* this `AnyEventLoop`
    /// (e.g. `bun_install::PackageManager::sleep_until`, where the closure's
    /// `is_done` does `&mut *closure.manager` and that `PackageManager` owns
    /// `event_loop` by value). Holding a `&mut Self` across `is_done` in that
    /// case is UB under Stacked Borrows — the callback's whole-struct Unique
    /// retag pops the field borrow. This variant reborrows `*this`
    /// per-iteration *after* `is_done` returns, so no `&mut Self` is live
    /// while the callback runs. Zig spec (`jsc.EventLoop.tick`) has no such
    /// constraint because Zig `*T` is non-exclusive.
    ///
    /// SAFETY: `this` must be valid for `&mut` access for the duration of the
    /// call, *except* while `is_done` is executing (when the callback may hold
    /// a competing `&mut` to a parent struct).
    pub unsafe fn tick_raw(
        this: *mut Self,
        context: *mut core::ffi::c_void,
        is_done: fn(*mut core::ffi::c_void) -> bool,
    ) {
        unsafe { Self::tick_raw_with_current_context(this, context, context, is_done) };
    }

    /// Variant of [`Self::tick_raw`] for drivers whose `is_done` callback needs
    /// one erased context while process-exit/task delivery should expose a
    /// stable owner context through [`EventLoopHandle::current_context`].
    ///
    /// SAFETY: same as [`Self::tick_raw`]. `task_context` is passed to queued
    /// Mini tasks and to `is_done`; `current_context` is only stored as the
    /// event-loop current context while a tick body is running.
    pub unsafe fn tick_raw_with_current_context(
        this: *mut Self,
        task_context: *mut core::ffi::c_void,
        current_context: *mut core::ffi::c_void,
        is_done: fn(*mut core::ffi::c_void) -> bool,
    ) {
        while !is_done(task_context) {
            // SAFETY: per fn contract — reborrow strictly after `is_done`
            // returns; the borrow ends at the bottom of this loop body before
            // the next `is_done` call.
            match unsafe { &mut *this } {
                AnyEventLoop::Js { owner } => {
                    let owner = *owner;
                    let previous_context = owner.set_current_context(current_context);
                    let _context_guard = scopeguard::guard(previous_context, |previous_context| {
                        owner.restore_current_context(previous_context);
                    });
                    owner.tick();
                    owner.auto_tick();
                }
                AnyEventLoop::Mini(mini) => {
                    // One iteration only — we cannot call the *looping*
                    // `MiniEventLoop::tick` here because that would hold
                    // `&mut mini` across `is_done`. A single `tick_once`
                    // borrow ends at the bottom of this match arm before the
                    // next `is_done` reborrow. Spec: MiniEventLoop.zig `tick`
                    // loop body.
                    mini.tick_once_with_current_context(task_context, current_context);
                }
            }
        }
    }

    pub fn tick_once(&mut self, context: *mut core::ffi::c_void) {
        match self {
            AnyEventLoop::Js { owner } => {
                let owner = *owner;
                let previous_context = owner.set_current_context(context);
                let _context_guard = scopeguard::guard(previous_context, |previous_context| {
                    owner.restore_current_context(previous_context);
                });
                owner.tick();
                owner.auto_tick_active();
            }
            AnyEventLoop::Mini(mini) => mini.tick_without_idle(context),
        }
    }

    pub fn enqueue_task_concurrent<Context, ParentContext>(
        &mut self,
        ctx: *mut Context,
        callback: fn(*mut Context, *mut ParentContext),
        // Zig param `comptime field: std.meta.FieldEnum(Context)` — replaced per
        // PORTING.md (§reflection) with a caller-supplied byte offset to the
        // embedded `AnyTaskWithExtraContext` (`core::mem::offset_of!(Context, field)`).
        field_offset: usize,
    ) {
        match self {
            AnyEventLoop::Js { .. } => {
                let _ = (ctx, callback, field_offset);
                // Zig: `bun.todoPanic(@src(), "AnyEventLoop.enqueueTaskConcurrent", .{});`
                // — intentionally unreachable in Zig too.
                unreachable!("AnyEventLoop.enqueueTaskConcurrent");
                // const TaskType = AnyTask.New(Context, Callback);
                // @field(ctx, field) = TaskType.init(ctx);
                // var concurrent = bun.default_allocator.create(ConcurrentTask) catch unreachable;
                // _ = concurrent.from(jsc.Task.init(&@field(ctx, field)));
                // concurrent.auto_delete = true;
                // this.virtual_machine.jsc.enqueueTaskConcurrent(concurrent);
            }
            AnyEventLoop::Mini(mini) => {
                mini.enqueue_task_concurrent_with_extra_ctx::<Context, ParentContext>(
                    ctx,
                    callback,
                    field_offset,
                );
            }
        }
    }
}

// ─────────────────────────── EventLoopHandle ───────────────────────────────
// MOVE-IN: relocated from `bun_jsc::EventLoopHandle` (src/jsc/EventLoopHandle.zig)
// Non-owning reference to either the JS event
// loop or the mini event loop. The `.js` arm holds a `JsEventLoop` handle
// (link-time-resolved dispatch; impls in `bun_jsc`).

#[derive(Copy, Clone)]
pub enum EventLoopHandle {
    Js {
        /// Typed handle wrapping the erased `*mut jsc::EventLoop` — see
        /// [`AnyEventLoop::Js`]. `JsEventLoop` is `Copy`, so the handle stays
        /// `Copy`.
        owner: JsEventLoop,
    },
    // PORT NOTE: raw `*mut MiniEventLoop` (not `&mut`) because the handle is
    // `Copy` and stored in `uws::InternalLoopData` as a non-owning backref —
    // matches Zig `*MiniEventLoop`.
    Mini(*mut MiniEventLoop<'static>),
}

/// Untagged pointer to either kind of concurrent task. Tag is the surrounding
/// `EventLoopHandle` discriminant — Zig `EventLoopTaskPtr` was an untagged union.
#[derive(Copy, Clone)]
pub union EventLoopTaskPtr {
    pub js: *mut ConcurrentTask,
    pub mini: *mut AnyTaskWithExtraContext,
}

/// Owned storage for either kind of concurrent task (Zig `EventLoopTask`).
pub enum EventLoopTask {
    Js(ConcurrentTask),
    Mini(AnyTaskWithExtraContext),
}

impl EventLoopTask {
    pub fn init(kind: EventLoopKind) -> EventLoopTask {
        match kind {
            EventLoopKind::Js => EventLoopTask::Js(ConcurrentTask::default()),
            EventLoopKind::Mini => EventLoopTask::Mini(AnyTaskWithExtraContext::default()),
        }
    }

    pub fn from_event_loop(loop_: EventLoopHandle) -> EventLoopTask {
        match loop_ {
            EventLoopHandle::Js { .. } => EventLoopTask::Js(ConcurrentTask::default()),
            EventLoopHandle::Mini(_) => EventLoopTask::Mini(AnyTaskWithExtraContext::default()),
        }
    }
}

/// RAII pairing for [`EventLoopHandle::enter`] / [`EventLoopHandle::exit`].
/// Construct via [`EventLoopHandle::entered`]. `EventLoopHandle` is `Copy`, so
/// the guard owns its own copy and the caller may keep using the handle.
#[must_use = "dropping immediately exits the event loop scope"]
pub struct EnteredEventLoop(EventLoopHandle);

impl Drop for EnteredEventLoop {
    #[inline]
    fn drop(&mut self) {
        self.0.exit();
    }
}

impl EventLoopHandle {
    /// Wrap an erased `*mut jsc::EventLoop`.
    // PORT NOTE: Zig `init(anytype)` dispatched on `@TypeOf` over five input
    // types. Rust splits by overload: `init` (jsc::EventLoop), `init_mini`,
    // `from_any`, plus the trivial `EventLoopHandle → EventLoopHandle` is
    // identity. The `*VirtualMachine` overload moves to bun_runtime (it must
    // call `vm.eventLoop()`).
    #[inline]
    pub fn init(js_event_loop: *mut ()) -> EventLoopHandle {
        // SAFETY: caller passes a live erased `*mut jsc::EventLoop` (the
        // back-reference invariant — owner outlives every dispatch through this
        // handle). This is the single `unsafe` boundary for the
        // `EventLoopHandle::Js` arm.
        EventLoopHandle::from_js(unsafe { JsEventLoop::from_raw(js_event_loop) })
    }

    #[inline]
    pub fn from_js(owner: JsEventLoop) -> EventLoopHandle {
        EventLoopHandle::Js { owner }
    }

    #[inline]
    pub fn init_mini(mini: *mut MiniEventLoop<'static>) -> EventLoopHandle {
        EventLoopHandle::Mini(mini)
    }

    #[inline]
    pub fn as_event_loop_ctx(self) -> bun_io::EventLoopCtx {
        match self {
            // SAFETY: `owner.bun_vm()` returns the owning `*mut VirtualMachine`.
            // Both are per-thread singletons that outlive the ctx.
            EventLoopHandle::Js { owner } => {
                let vm = unsafe {
                    bun_jsc_types::event_loop::VirtualMachineHandle::from_raw(owner.bun_vm())
                };
                bun_io::EventLoopCtx::js(vm)
            },
            EventLoopHandle::Mini(mini) => MiniEventLoop::as_event_loop_ctx(mini),
        }
    }

    /// Erase to the `(tag, ptr)` pair stored in `uws::InternalLoopData`
    /// (`parent_tag` / `parent_ptr`). Tag 1 = JS, tag 2 = mini — matches Zig
    /// `setParentEventLoop`.
    #[inline]
    pub fn into_tag_ptr(self) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner, .. } => (1, owner.as_void_ptr()),
            EventLoopHandle::Mini(mini) => (2, mini.cast()),
        }
    }

    /// Inverse of [`into_tag_ptr`] — recover from the `(tag, ptr)` pair stored
    /// in `uws::InternalLoopData` (Zig: `loop.internal_loop_data.getParent()`).
    ///
    /// # Safety
    /// `(tag, ptr)` must have been produced by [`into_tag_ptr`] on a still-live
    /// event loop (i.e. read from `internal_loop_data` while the loop is alive).
    #[inline]
    pub unsafe fn from_tag_ptr(tag: core::ffi::c_char, ptr: *mut core::ffi::c_void) -> EventLoopHandle {
        match tag {
            // SAFETY: per fn contract — `(tag, ptr)` was produced by
            // `into_tag_ptr` on a still-live event loop, so `ptr` is a live
            // erased `*mut jsc::EventLoop`.
            1 => EventLoopHandle::Js {
                owner: unsafe { JsEventLoop::from_raw(ptr.cast::<()>()) },
            },
            2 => EventLoopHandle::Mini(ptr.cast()),
            _ => unreachable!("invalid parent event-loop tag {}", tag),
        }
    }

}

/// Carrier-trait impl so `bun_uws::InternalLoopDataExt::set_parent_event_loop`
/// accepts `EventLoopHandle` directly. Kept here (not in `bun_uws`) because
/// `bun_uws` is a lower tier than `bun_event_loop` and cannot name this enum.
impl bun_uws::ParentEventLoopHandle for EventLoopHandle {
    #[inline]
    fn into_tag_ptr(self) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        EventLoopHandle::into_tag_ptr(self)
    }
}

impl EventLoopHandle {
    /// Zig: `loop.internal_loop_data.setParentEventLoop(jsc.EventLoopHandle.init(..))`.
    /// Convenience wrapper so callers don't need both `bun_uws::InternalLoopDataExt`
    /// (the trait) and the `*mut Loop` deref dance in scope.
    #[inline]
    pub fn set_as_parent_of(self, uws_loop: *mut UwsLoop) {
        let (tag, ptr) = self.into_tag_ptr();
        // SAFETY: `uws_loop` is the live process-global loop returned by
        // `AnyEventLoop::r#loop()`; `internal_loop_data` is the first field
        // (#[repr(C)]) and outlives every event-loop user.
        unsafe { (*uws_loop).internal_loop_data.set_parent_raw(tag, ptr) };
    }

    pub fn from_any(any: &mut AnyEventLoop<'static>) -> EventLoopHandle {
        match any {
            AnyEventLoop::Js { owner } => EventLoopHandle::Js { owner: *owner },
            AnyEventLoop::Mini(mini) => EventLoopHandle::Mini(std::ptr::from_mut(mini)),
        }
    }

    /// `EventLoopHandle` for the current thread's JS event loop. Replaces
    /// `jsc::EventLoopHandle.init(jsc::VirtualMachine.get())` for tier-≤4 callers.
    pub fn js_current() -> EventLoopHandle {
        EventLoopHandle::Js { owner: JsEventLoop::current() }
    }

    /// Erased `*mut jsc::JSGlobalObject` or null (Mini has no JS global).
    pub fn global_object(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.global_object(),
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    /// Erased `*mut jsc::VirtualMachine` or null.
    pub fn bun_vm(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.bun_vm(),
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    pub fn current_context(self) -> *mut core::ffi::c_void {
        match self {
            EventLoopHandle::Js { owner } => owner.current_context(),
            // SAFETY: `mini` is a live backref (set in `init_global` / caller).
            EventLoopHandle::Mini(mini) => unsafe { (*mini).current_context() },
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stdout(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.stdout(),
            // SAFETY: `mini` is a live backref (set in `init_global` / caller).
            EventLoopHandle::Mini(mini) => unsafe { (*mini).stdout() },
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stderr(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.stderr(),
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).stderr() },
        }
    }

    pub fn enter(self) {
        if let EventLoopHandle::Js { owner } = self {
            owner.enter();
        }
    }

    pub fn exit(self) {
        if let EventLoopHandle::Js { owner } = self {
            owner.exit();
        }
    }

    /// `enter()` and return an RAII guard that `exit()`s on drop. Prefer this
    /// over a bare `enter()`/`exit()` pair so early returns and `?` don't leak
    /// the entered scope.
    #[inline]
    pub fn entered(self) -> EnteredEventLoop {
        self.enter();
        EnteredEventLoop(self)
    }
    /// Returns the FilePoll store as a raw pointer (mirrors Zig `*FilePoll.Store`).
    /// `EventLoopHandle` is `Copy`; promoting to `&'static mut` would let two
    /// calls produce aliased exclusive references (UB). Callers deref locally
    /// for the brief region they need `&mut`.
    pub fn file_polls(self) -> *mut bun_io::file_poll::Store {
        match self {
            EventLoopHandle::Js { owner } => owner.file_polls(),
            // SAFETY: see `stdout`. We hold `*mut MiniEventLoop`; derive a
            // unique borrow at the call site only.
            EventLoopHandle::Mini(mini) => unsafe { std::ptr::from_mut((*mini).file_polls()) },
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll
            .flags
            .contains(bun_io::file_poll::Flags::WasEverRegistered);
        match self {
            EventLoopHandle::Js { owner } => owner.put_file_poll(poll, was_ever_registered),
            // SAFETY: see `stdout`. Same disjoint-field reasoning as
            // `AnyEventLoop::put_file_poll` — the ctx only touches
            // `after_event_loop_callback{,_ctx}`, not `file_polls_`.
            EventLoopHandle::Mini(mini) => unsafe {
                let ctx = MiniEventLoop::as_event_loop_ctx(*mini);
                (**mini).file_polls().put(poll, ctx, was_ever_registered);
            },
        }
    }

    pub fn enqueue_task_concurrent(self, task: EventLoopTaskPtr) {
        match self {
            // SAFETY: caller guarantees `task.js` is the active union member when `self` is `Js`.
            EventLoopHandle::Js { owner } => owner.enqueue_task_concurrent(unsafe { task.js }),
            // SAFETY: caller guarantees `task.mini` is active; `mini` is a live backref.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).enqueue_task_concurrent(task.mini) },
        }
    }

    pub fn r#loop(self) -> *mut UwsLoop {
        match self {
            EventLoopHandle::Js { owner } => owner.uws_loop(),
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).loop_ptr() },
        }
    }

    #[inline]
    pub fn platform_event_loop(self) -> *mut UwsLoop {
        self.r#loop()
    }

    /// Alias for [`r#loop`](Self::r#loop) so callers spell `handle.loop_()`
    /// without the raw-identifier escape (Zig: `handle.loop()`).
    #[inline]
    pub fn loop_(self) -> *mut UwsLoop {
        self.r#loop()
    }

    /// Windows convenience: skip the `WindowsLoop` wrapper and return the
    /// embedded `uv_loop_t*` directly. Exists because `loop_()` returns a raw
    /// pointer and Rust forbids field access (`.uv_loop`) on `*mut T` without
    /// an explicit deref — which would push every Windows call site into an
    /// `unsafe` block just to project a field that is set once at loop
    /// creation and never changes.
    #[cfg(windows)]
    #[inline]
    pub fn uv_loop(self) -> *mut bun_io::Loop {
        // SAFETY: `r#loop()` returns the live us_loop allocated by
        // `us_create_loop`; `uv_loop` is initialised in C before any Rust
        // caller can observe the handle and is immutable thereafter.
        unsafe { (*self.r#loop()).uv_loop }
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same `Copy`-handle aliasing concern as [`file_polls`].
    pub fn pipe_read_buffer(self) -> *mut [u8] {
        match self {
            EventLoopHandle::Js { owner } => owner.pipe_read_buffer(),
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { std::ptr::from_mut::<[u8]>((*mini).pipe_read_buffer()) },
        }
    }

    pub fn ref_(self) {
        // SAFETY: `r#loop` returns a valid live loop.
        unsafe { (*self.r#loop()).ref_() };
    }

    pub fn unref(self) {
        // SAFETY: `r#loop` returns a valid live loop.
        unsafe { (*self.r#loop()).unref() };
    }

    pub fn env(self) -> *mut DotEnvLoader<'static> {
        match self {
            EventLoopHandle::Js { owner } => owner.env(),
            // SAFETY: see `stdout`. Zig unwraps `mini.env.?` — caller invariant.
            // `MiniEventLoop::env` is `Option<NonNull<DotEnvLoader>>` so
            // provenance is mutable (Zig field is `?*DotEnvLoader`).
            EventLoopHandle::Mini(mini) => unsafe {
                (*mini).env.expect("MiniEventLoop.env unset").as_ptr().cast()
            },
        }
    }

    pub fn top_level_dir(self) -> &'static [u8] {
        match self {
            // SAFETY: slice borrowed for VM lifetime.
            EventLoopHandle::Js { owner } => unsafe { &*owner.top_level_dir() },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { &(*mini).top_level_dir },
        }
    }

    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        match self {
            EventLoopHandle::Js { owner } => owner.create_null_delimited_env_map(),
            // SAFETY: see `stdout`. Zig unwraps `mini.env.?`. `env` is a
            // `NonNull<DotEnvLoader>` backref; the loader outlives the loop.
            EventLoopHandle::Mini(mini) => unsafe {
                (*(*mini).env.expect("MiniEventLoop.env unset").as_ptr())
                    .map
                    .create_null_delimited_env_map()
            },
        }
    }

    // PORT NOTE: Zig `cast(tag)` returned `tag.Type()` at comptime — no Rust
    // equivalent. Callers should pattern-match the enum directly.
    // PORT NOTE: Zig `allocator()` dropped per §Allocators (non-AST crate).
}

// ported from: src/event_loop/AnyEventLoop.zig
