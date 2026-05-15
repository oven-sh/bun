use core::ptr::NonNull;

use bun_dotenv::Loader as DotEnvLoader;
use bun_io::FilePoll;
use bun_ptr::BackRef;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use crate::ConcurrentTask::ConcurrentTask;
use crate::MiniEventLoop::{EventLoopKind, MiniEventLoop};
use crate::{JsEventLoop, JsEventLoopKind};

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
/// The `Js` variant stores a [`JsEventLoop`] handle (the `link_interface!`
/// newtype around the erased `*mut jsc::EventLoop`). The single `unsafe` is at
/// handle construction (`JsEventLoop::new`); all dispatch sites are safe method
/// calls.
unsafe extern "Rust" {
    /// `jsc::VirtualMachine::get().event_loop()` — erased `*mut jsc::EventLoop`
    /// for the current thread. Kept as a bare extern (no owner). No caller-side
    /// preconditions: panics (not UB) if no VM is bound on this thread.
    pub(crate) safe fn __bun_js_event_loop_current() -> *mut ();
}

/// Useful for code that may need an event loop and could be used from either JavaScript or directly without JavaScript.
/// Unlike jsc.EventLoopHandle, this owns the event loop when it's not a JavaScript event loop.
// PORT NOTE: Zig `union(EventLoopKind)` — variant order/discriminant must match `crate::EventLoopKind`.
pub enum AnyEventLoop<'a> {
    Js {
        /// Typed handle wrapping the erased `*mut jsc::EventLoop`. The
        /// `link_interface!` invariant ("owner is live for every dispatch") is
        /// established once at construction; dispatch is safe.
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
    pub fn iteration_number(&self) -> u64 {
        match self {
            AnyEventLoop::Js { owner } => owner.iteration_number(),
            // SAFETY: see `MiniEventLoop::loop_ptr()` invariant.
            AnyEventLoop::Mini(mini) => unsafe { (*mini.loop_ptr()).iteration_number() },
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
        AnyEventLoop::Js {
            owner: unsafe { JsEventLoop::new(JsEventLoopKind::Jsc, js_event_loop) },
        }
    }

    /// Construct the `Js` variant for the current thread's JS event loop.
    /// Replaces `jsc::VirtualMachine::get().event_loop()` for tier-≤4 callers
    /// (e.g. `bun_install::PackageManager`).
    pub fn js_current() -> AnyEventLoop<'static> {
        AnyEventLoop::Js {
            owner: JsEventLoop::current(),
        }
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
                while !is_done(context) {
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
    /// # Safety
    /// `this` must be valid for `&mut` access for the duration of the call,
    /// *except* while `is_done` is executing (when the callback may hold a
    /// competing `&mut` to a parent struct). (Not eligible for
    /// `unsafe-fn-narrow`: the per-iteration `&mut *this` reborrow is sound
    /// only under this caller-supplied aliasing window.)
    pub unsafe fn tick_raw(
        this: *mut Self,
        context: *mut core::ffi::c_void,
        is_done: fn(*mut core::ffi::c_void) -> bool,
    ) {
        while !is_done(context) {
            // SAFETY: per fn contract — reborrow strictly after `is_done`
            // returns; the borrow ends at the bottom of this loop body before
            // the next `is_done` call.
            match unsafe { &mut *this } {
                AnyEventLoop::Js { owner } => {
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
                    mini.tick_once(context);
                }
            }
        }
    }

    pub fn tick_once(&mut self, context: *mut core::ffi::c_void) {
        match self {
            AnyEventLoop::Js { owner } => {
                let _ = context;
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

// ─── AnyEventLoop → EventLoopHandle forwarders ──────────────────────────────
// `EventLoopHandle` (below, same file) is the canonical Js/Mini dispatcher for
// these four methods. `AnyEventLoop` forwards through `from_any` instead of
// duplicating each `match`. Bound to `'static` because `from_any` stores
// `BackRef<MiniEventLoop<'static>>`; every concrete `AnyEventLoop`
// instantiation in the tree is already `'static` (verified: install, patch,
// build_command, ChangedFilesFilter, `js()`/`js_current()`).
impl AnyEventLoop<'static> {
    // PORT NOTE: renamed via raw identifier — `loop` is a Rust keyword.
    #[inline]
    pub fn r#loop(&mut self) -> *mut UwsLoop {
        EventLoopHandle::from_any(self).r#loop()
    }

    /// Alias for [`r#loop`](Self::r#loop) so callers spell `event_loop.loop_()`
    /// (Zig: `eventLoop().loop()`) without the raw-identifier escape.
    #[inline]
    pub fn loop_(&mut self) -> *mut UwsLoop {
        self.r#loop()
    }

    /// Platform-native loop pointer (`us_loop_t*` on POSIX, `uv_loop_t*` on
    /// Windows). See [`bun_io::uws_to_native`].
    #[inline]
    pub fn native_loop(&mut self) -> *mut bun_io::Loop {
        bun_io::uws_to_native(self.r#loop())
    }

    #[inline]
    pub fn wakeup(&mut self) {
        // SAFETY: `r#loop()` returns a valid live loop pointer.
        unsafe { (*self.r#loop()).wakeup() };
    }

    /// Returns the FilePoll store as a raw pointer (mirrors Zig
    /// `*FilePoll.Store`). See [`EventLoopHandle::file_polls`] for the aliasing
    /// contract — callers deref locally for the brief region they need `&mut`.
    #[inline]
    pub fn file_polls(&mut self) -> *mut bun_io::file_poll::Store {
        EventLoopHandle::from_any(self).file_polls()
    }

    #[inline]
    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        EventLoopHandle::from_any(self).put_file_poll(poll)
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). See [`EventLoopHandle::pipe_read_buffer`].
    #[inline]
    pub fn pipe_read_buffer(&mut self) -> *mut [u8] {
        EventLoopHandle::from_any(self).pipe_read_buffer()
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
    // PORT NOTE: `BackRef<MiniEventLoop>` (not `&mut`) because the handle is
    // `Copy` and stored in `uws::InternalLoopData` as a non-owning backref —
    // matches Zig `*MiniEventLoop`. The pointee is the per-thread singleton
    // (`init_global`) or an `AnyEventLoop::Mini`-owned loop, both of which
    // strictly outlive every `EventLoopHandle` derived from them — the
    // [`BackRef`] invariant. Read-only sites use safe `Deref`; the few
    // `&mut`-taking dispatch sites go through [`mini_mut`] (single deref site).
    Mini(BackRef<MiniEventLoop<'static>>),
}

/// Single `unsafe` deref site for the `EventLoopHandle::Mini` arm — collapses
/// the half-dozen identical `unsafe { mini.get_mut() }` dispatch sites below.
///
/// Soundness: the `MiniEventLoop` behind every `EventLoopHandle::Mini` is the
/// per-thread `!Send` singleton (see [`EventLoopHandle::init_mini`] /
/// `MiniEventLoop::GLOBAL`) or an `AnyEventLoop::Mini`-owned loop accessed only
/// on its owning thread. Dispatch is single-threaded and every caller below
/// immediately invokes a method then drops the borrow, so no other `&`/`&mut`
/// to the loop is live for the returned borrow's lifetime — exactly the
/// [`BackRef::get_mut`] precondition, discharged once here instead of at each
/// dispatch site. Private to this module so the invariant is local.
#[inline]
fn mini_mut<'a>(mini: &'a mut BackRef<MiniEventLoop<'static>>) -> &'a mut MiniEventLoop<'static> {
    // SAFETY: see fn doc — per-thread `!Send` singleton, exclusive for the
    // returned borrow's duration.
    unsafe { mini.get_mut() }
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
        EventLoopHandle::Js {
            owner: unsafe { JsEventLoop::new(JsEventLoopKind::Jsc, js_event_loop) },
        }
    }

    #[inline]
    pub fn init_mini(mini: *mut MiniEventLoop<'static>) -> EventLoopHandle {
        // `mini` is the live per-thread singleton (or an `AnyEventLoop::Mini`
        // payload) — never null at any call site. `BackRef: From<NonNull<T>>`
        // wraps it without an `unsafe` block; the back-reference invariant
        // (pointee outlives every copy of the handle) is the caller's
        // structural guarantee, same as before.
        EventLoopHandle::Mini(
            NonNull::new(mini)
                .expect("MiniEventLoop ptr is non-null")
                .into(),
        )
    }

    #[inline]
    pub fn as_event_loop_ctx(self) -> bun_io::EventLoopCtx {
        match self {
            // SAFETY: `owner.bun_vm()` returns the owning `*mut VirtualMachine`,
            // which is what the `EventLoopCtxKind::Js` `link_impl_EventLoopCtx!`
            // (in `bun_jsc`) is written for. Both are per-thread singletons
            // that outlive the ctx.
            EventLoopHandle::Js { owner } => unsafe {
                bun_io::EventLoopCtx::new(bun_io::EventLoopCtxKind::Js, owner.bun_vm())
            },
            EventLoopHandle::Mini(mini) => MiniEventLoop::as_event_loop_ctx(mini.as_ptr()),
        }
    }

    /// Erase to the `(tag, ptr)` pair stored in `uws::InternalLoopData`
    /// (`parent_tag` / `parent_ptr`). Tag 1 = JS, tag 2 = mini — matches Zig
    /// `setParentEventLoop`.
    #[inline]
    pub fn into_tag_ptr(self) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner, .. } => (1, owner.owner.cast()),
            EventLoopHandle::Mini(mini) => (2, mini.as_ptr().cast()),
        }
    }

    /// Inverse of [`into_tag_ptr`] — recover from the `(tag, ptr)` pair stored
    /// in `uws::InternalLoopData` (Zig: `loop.internal_loop_data.getParent()`).
    ///
    /// `(tag, ptr)` must have been produced by [`into_tag_ptr`] on a still-live
    /// event loop (i.e. read from `internal_loop_data` while the loop is alive).
    ///
    /// # Safety
    /// `(tag, ptr)` must have been produced by [`into_tag_ptr`] on a still-live
    /// event loop. The constructor itself only stores the opaque pointer, but
    /// dispatch through the resulting handle dereferences it — this fn is the
    /// last place the precondition can be discharged. (NOT eligible for
    /// `unsafe-fn-narrow`: the invariant is caller-provided, not internally
    /// guarded.)
    #[inline]
    pub unsafe fn from_tag_ptr(
        tag: core::ffi::c_char,
        ptr: *mut core::ffi::c_void,
    ) -> EventLoopHandle {
        match tag {
            1 => EventLoopHandle::Js {
                // SAFETY: `(tag, ptr)` was produced by `into_tag_ptr` on a
                // still-live event loop, so `ptr` is a live erased
                // `*mut jsc::EventLoop`. Same boundary as `EventLoopHandle::init`.
                owner: unsafe { JsEventLoop::new(JsEventLoopKind::Jsc, ptr.cast::<()>()) },
            },
            // `(tag, ptr)` came from `into_tag_ptr` on a live loop, so `ptr`
            // is non-null. `BackRef: From<NonNull<T>>`.
            2 => EventLoopHandle::Mini(NonNull::new(ptr.cast()).expect("non-null mini ptr").into()),
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
            AnyEventLoop::Mini(mini) => EventLoopHandle::Mini(BackRef::new_mut(mini)),
        }
    }

    /// `EventLoopHandle` for the current thread's JS event loop. Replaces
    /// `jsc::EventLoopHandle.init(jsc::VirtualMachine.get())` for tier-≤4 callers.
    pub fn js_current() -> EventLoopHandle {
        EventLoopHandle::Js {
            owner: JsEventLoop::current(),
        }
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

    /// Erased `*mut webcore::blob::Store`.
    pub fn stdout(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.stdout(),
            EventLoopHandle::Mini(mut mini) => mini_mut(&mut mini).stdout(),
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stderr(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => owner.stderr(),
            EventLoopHandle::Mini(mut mini) => mini_mut(&mut mini).stderr(),
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
            EventLoopHandle::Mini(mut mini) => std::ptr::from_mut(mini_mut(&mut mini).file_polls()),
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll
            .flags
            .contains(bun_io::file_poll::Flags::WasEverRegistered);
        match self {
            EventLoopHandle::Js { owner } => owner.put_file_poll(poll, was_ever_registered),
            // ctx only touches `after_event_loop_callback{,_ctx}`, field-disjoint
            // from `file_polls_` — safe to hold both across `Store::put`.
            EventLoopHandle::Mini(mini) => {
                let ctx = MiniEventLoop::as_event_loop_ctx(mini.as_ptr());
                mini_mut(mini)
                    .file_polls()
                    .put(poll, ctx, was_ever_registered);
            }
        }
    }

    pub fn enqueue_task_concurrent(self, task: EventLoopTaskPtr) {
        match self {
            // SAFETY: caller guarantees `task.js` is the active union member when `self` is `Js`.
            EventLoopHandle::Js { owner } => owner.enqueue_task_concurrent(unsafe { task.js }),
            // SAFETY: caller guarantees `task.mini` is the active union member
            // when `self` is `Mini`.
            EventLoopHandle::Mini(mut mini) => {
                mini_mut(&mut mini).enqueue_task_concurrent(unsafe { task.mini })
            }
        }
    }

    pub fn r#loop(self) -> *mut UwsLoop {
        match self {
            EventLoopHandle::Js { owner } => owner.uws_loop(),
            // `loop_ptr` takes `&self`; safe via `BackRef: Deref`.
            EventLoopHandle::Mini(mini) => mini.loop_ptr(),
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

    /// Platform-native loop pointer (`us_loop_t*` on POSIX, `uv_loop_t*` on
    /// Windows). See [`bun_io::uws_to_native`] — collapses the per-site
    /// `#[cfg(windows)]` `.uv_loop` projection that previously appeared at
    /// every `BufferedReaderParent::loop_` impl.
    #[inline]
    pub fn native_loop(self) -> *mut bun_io::Loop {
        bun_io::uws_to_native(self.r#loop())
    }

    /// Windows convenience alias for [`native_loop`](Self::native_loop)
    /// (kept for existing `cfg(windows)` callers that spell `uv_loop`).
    #[cfg(windows)]
    #[inline]
    pub fn uv_loop(self) -> *mut bun_io::Loop {
        self.native_loop()
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same `Copy`-handle aliasing concern as [`file_polls`].
    pub fn pipe_read_buffer(self) -> *mut [u8] {
        match self {
            EventLoopHandle::Js { owner } => owner.pipe_read_buffer(),
            EventLoopHandle::Mini(mut mini) => {
                std::ptr::from_mut::<[u8]>(mini_mut(&mut mini).pipe_read_buffer())
            }
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
            // Zig unwraps `mini.env.?` — caller invariant. `env_ptr()` takes
            // `&self` and returns `Option<NonNull<DotEnvLoader>>` (mutable
            // provenance; Zig field is `?*DotEnvLoader`). Safe via
            // `BackRef: Deref`.
            EventLoopHandle::Mini(mini) => mini
                .env_ptr()
                .expect("MiniEventLoop.env unset")
                .as_ptr()
                .cast(),
        }
    }

    pub fn top_level_dir(self) -> &'static [u8] {
        match self {
            // SAFETY: slice borrowed for VM lifetime.
            EventLoopHandle::Js { owner } => unsafe { &*owner.top_level_dir() },
            // SAFETY: `BackRef::get()` ties the borrow to the local `mini`, but
            // the pointee is the per-thread singleton (process-lifetime); widen
            // to `'static` so the return type matches the Js arm.
            EventLoopHandle::Mini(mini) => unsafe { &(*mini.as_ptr()).top_level_dir },
        }
    }

    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        match self {
            EventLoopHandle::Js { owner } => owner.create_null_delimited_env_map(),
            EventLoopHandle::Mini(mini) => {
                // `env_ptr()` takes `&self` — safe via `BackRef: Deref`. Zig
                // unwraps `mini.env.?` (caller invariant).
                let env = mini.env_ptr().expect("MiniEventLoop.env unset");
                // SAFETY: `env` is a `NonNull<DotEnvLoader>` backref; the
                // loader is a thread-/process-lifetime singleton (see
                // `MiniEventLoop::env_ptr` invariant) and outlives this call.
                unsafe { (*env.as_ptr()).map.create_null_delimited_env_map() }
            }
        }
    }

    // PORT NOTE: Zig `cast(tag)` returned `tag.Type()` at comptime — no Rust
    // equivalent. Callers should pattern-match the enum directly.
    // PORT NOTE: Zig `allocator()` dropped per §Allocators (non-AST crate).
}

// ported from: src/event_loop/AnyEventLoop.zig
