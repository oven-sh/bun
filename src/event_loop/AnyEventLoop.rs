use bun_aio::FilePoll;
use bun_dotenv::Loader as DotEnvLoader;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use crate::ConcurrentTask::ConcurrentTask;
use crate::MiniEventLoop::{EventLoopKind, MiniEventLoop};

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
/// `owner` is always an erased `*mut jsc::EventLoop`; the `bun_jsc` side casts
/// it back.
pub mod js {
    use super::*;

    unsafe extern "Rust" {
        // ── AnyEventLoop slots ─────────────────────────────────────────────
        fn __bun_js_event_loop_iteration_number(owner: *mut ()) -> u64;
        fn __bun_js_event_loop_file_polls(owner: *mut ()) -> *mut bun_aio::file_poll::Store;
        fn __bun_js_event_loop_put_file_poll(
            owner: *mut (),
            poll: *mut FilePoll,
            was_ever_registered: bool,
        );
        fn __bun_js_event_loop_uws_loop(owner: *mut ()) -> *mut UwsLoop;
        fn __bun_js_event_loop_pipe_read_buffer(owner: *mut ()) -> *mut [u8];
        fn __bun_js_event_loop_tick(owner: *mut ());
        fn __bun_js_event_loop_auto_tick(owner: *mut ());
        fn __bun_js_event_loop_auto_tick_active(owner: *mut ());
        // ── EventLoopHandle slots ──────────────────────────────────────────
        /// `el.global` — erased `*mut jsc::JSGlobalObject` or null.
        fn __bun_js_event_loop_global_object(owner: *mut ()) -> *mut ();
        /// `el.virtual_machine` — erased `*mut jsc::VirtualMachine`.
        fn __bun_js_event_loop_bun_vm(owner: *mut ()) -> *mut ();
        /// `el.virtual_machine.rareData().stdout()` — erased `*mut webcore::blob::Store`.
        fn __bun_js_event_loop_stdout(owner: *mut ()) -> *mut ();
        /// `el.virtual_machine.rareData().stderr()` — erased `*mut webcore::blob::Store`.
        fn __bun_js_event_loop_stderr(owner: *mut ()) -> *mut ();
        fn __bun_js_event_loop_enter(owner: *mut ());
        fn __bun_js_event_loop_exit(owner: *mut ());
        /// `el.enqueueTask(jsc.Task)` — same-thread task enqueue (no wakeup).
        fn __bun_js_event_loop_enqueue_task(owner: *mut (), task: crate::Task);
        fn __bun_js_event_loop_enqueue_task_concurrent(owner: *mut (), task: *mut ConcurrentTask);
        /// `el.virtual_machine.transpiler.env`.
        fn __bun_js_event_loop_env(owner: *mut ()) -> *mut DotEnvLoader<'static>;
        /// `el.virtual_machine.transpiler.fs.top_level_dir` — borrowed for VM lifetime.
        fn __bun_js_event_loop_top_level_dir(owner: *mut ()) -> *const [u8];
        /// `el.virtual_machine.transpiler.env.map.createNullDelimitedEnvMap(alloc)`.
        fn __bun_js_event_loop_create_null_delimited_env_map(
            owner: *mut (),
        ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>;
        /// `jsc::VirtualMachine::get().event_loop()` — erased `*mut jsc::EventLoop`
        /// for the current thread.
        fn __bun_js_event_loop_current() -> *mut ();
    }

    // Thin wrappers so callers outside this module (bundler, etc.) don't spell
    // the mangled extern names. SAFETY on each: `o` must be a live erased
    // `*mut jsc::EventLoop` (the value stored in the `Js` variant).
    #[inline] pub unsafe fn iteration_number(o: *mut ()) -> u64 { unsafe { __bun_js_event_loop_iteration_number(o) } }
    #[inline] pub unsafe fn file_polls(o: *mut ()) -> *mut bun_aio::file_poll::Store { unsafe { __bun_js_event_loop_file_polls(o) } }
    #[inline] pub unsafe fn put_file_poll(o: *mut (), p: *mut FilePoll, w: bool) { unsafe { __bun_js_event_loop_put_file_poll(o, p, w) } }
    #[inline] pub unsafe fn uws_loop(o: *mut ()) -> *mut UwsLoop { unsafe { __bun_js_event_loop_uws_loop(o) } }
    #[inline] pub unsafe fn pipe_read_buffer(o: *mut ()) -> *mut [u8] { unsafe { __bun_js_event_loop_pipe_read_buffer(o) } }
    #[inline] pub unsafe fn tick(o: *mut ()) { unsafe { __bun_js_event_loop_tick(o) } }
    #[inline] pub unsafe fn auto_tick(o: *mut ()) { unsafe { __bun_js_event_loop_auto_tick(o) } }
    #[inline] pub unsafe fn auto_tick_active(o: *mut ()) { unsafe { __bun_js_event_loop_auto_tick_active(o) } }
    #[inline] pub unsafe fn global_object(o: *mut ()) -> *mut () { unsafe { __bun_js_event_loop_global_object(o) } }
    #[inline] pub unsafe fn bun_vm(o: *mut ()) -> *mut () { unsafe { __bun_js_event_loop_bun_vm(o) } }
    #[inline] pub unsafe fn stdout(o: *mut ()) -> *mut () { unsafe { __bun_js_event_loop_stdout(o) } }
    #[inline] pub unsafe fn stderr(o: *mut ()) -> *mut () { unsafe { __bun_js_event_loop_stderr(o) } }
    #[inline] pub unsafe fn enter(o: *mut ()) { unsafe { __bun_js_event_loop_enter(o) } }
    #[inline] pub unsafe fn exit(o: *mut ()) { unsafe { __bun_js_event_loop_exit(o) } }
    #[inline] pub unsafe fn enqueue_task(o: *mut (), t: crate::Task) { unsafe { __bun_js_event_loop_enqueue_task(o, t) } }
    #[inline] pub unsafe fn enqueue_task_concurrent(o: *mut (), t: *mut ConcurrentTask) { unsafe { __bun_js_event_loop_enqueue_task_concurrent(o, t) } }
    #[inline] pub unsafe fn env(o: *mut ()) -> *mut DotEnvLoader<'static> { unsafe { __bun_js_event_loop_env(o) } }
    #[inline] pub unsafe fn top_level_dir(o: *mut ()) -> *const [u8] { unsafe { __bun_js_event_loop_top_level_dir(o) } }
    #[inline] pub unsafe fn create_null_delimited_env_map(o: *mut ()) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> { unsafe { __bun_js_event_loop_create_null_delimited_env_map(o) } }
    #[inline] pub unsafe fn current() -> *mut () { unsafe { __bun_js_event_loop_current() } }
}

/// Useful for code that may need an event loop and could be used from either JavaScript or directly without JavaScript.
/// Unlike jsc.EventLoopHandle, this owns the event loop when it's not a JavaScript event loop.
// PORT NOTE: Zig `union(EventLoopKind)` — variant order/discriminant must match `crate::EventLoopKind`.
pub enum AnyEventLoop<'a> {
    Js {
        // SAFETY: erased `*mut jsc::EventLoop` — runtime constructs this variant.
        owner: *mut (),
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
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            AnyEventLoop::Js { owner } => unsafe { js::iteration_number(*owner) },
            // SAFETY: `loop_` is the live C-owned uws loop (set in `MiniEventLoop::init`).
            AnyEventLoop::Mini(mini) => unsafe { (*mini.loop_).iteration_number() },
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
    pub fn file_polls(&mut self) -> *mut bun_aio::file_poll::Store {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            AnyEventLoop::Js { owner } => unsafe { js::file_polls(*owner) },
            AnyEventLoop::Mini(mini) => mini.file_polls() as *mut _,
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll
            .flags
            .contains(bun_aio::file_poll::Flags::WasEverRegistered);
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            AnyEventLoop::Js { owner } => unsafe {
                js::put_file_poll(*owner, poll, was_ever_registered)
            },
            AnyEventLoop::Mini(mini) => {
                // PORT NOTE: reshaped for borrowck — Zig passed `&this.mini`
                // while also holding `this.mini.filePolls()` mutably. Erase
                // `mini` to a raw `EventLoopCtx` (Copy, no borrow) before
                // taking the `&mut Store` borrow; `Store::put` only touches
                // `mini.after_event_loop_callback{,_ctx}` through the ctx,
                // which is field-disjoint from `file_polls_`.
                let ctx = MiniEventLoop::as_event_loop_ctx(mini as *mut _);
                mini.file_polls().put(poll, ctx, was_ever_registered);
            }
        }
    }

    // PORT NOTE: renamed via raw identifier — `loop` is a Rust keyword.
    pub fn r#loop(&mut self) -> *mut UwsLoop {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            AnyEventLoop::Js { owner } => unsafe { js::uws_loop(*owner) },
            AnyEventLoop::Mini(mini) => mini.loop_,
        }
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same VM-shared-storage aliasing concern as [`file_polls`] —
    /// the `Js` arm cannot prove exclusive access, so callers deref locally.
    pub fn pipe_read_buffer(&mut self) -> *mut [u8] {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            AnyEventLoop::Js { owner } => unsafe { js::pipe_read_buffer(*owner) },
            AnyEventLoop::Mini(mini) => mini.pipe_read_buffer() as *mut [u8],
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
        // PORT NOTE: Zig took `allocator: std.mem.Allocator`; dropped per §Allocators (non-AST crate).
        AnyEventLoop::Mini(MiniEventLoop::init())
    }

    /// Construct the `Js` variant wrapping a specific erased
    /// `*mut jsc::EventLoop`. Mirrors Zig's `.{ .js = vm.eventLoop() }`
    /// literal — callers that already hold a VM pointer use this instead of
    /// the thread-local lookup in [`js_current`].
    #[inline]
    pub fn js(js_event_loop: *mut ()) -> AnyEventLoop<'static> {
        AnyEventLoop::Js { owner: js_event_loop }
    }

    /// Construct the `Js` variant for the current thread's JS event loop.
    /// Replaces `jsc::VirtualMachine::get().event_loop()` for tier-≤4 callers
    /// (e.g. `bun_install::PackageManager`).
    pub fn js_current() -> AnyEventLoop<'static> {
        // SAFETY: link-time resolved; panics in `bun_jsc` if no VM on thread.
        AnyEventLoop::Js { owner: unsafe { js::current() } }
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
                    // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
                    unsafe {
                        js::tick(*owner);
                        js::auto_tick(*owner);
                    }
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
        while !is_done(context) {
            // SAFETY: per fn contract — reborrow strictly after `is_done`
            // returns; the borrow ends at the bottom of this loop body before
            // the next `is_done` call.
            match unsafe { &mut *this } {
                AnyEventLoop::Js { owner } => {
                    // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
                    unsafe {
                        js::tick(*owner);
                        js::auto_tick(*owner);
                    }
                }
                AnyEventLoop::Mini(mini) => {
                    // Inline one iteration of `MiniEventLoop::tick` so the
                    // `&mut MiniEventLoop` borrow does not straddle the next
                    // `is_done`. Spec: MiniEventLoop.zig `tick` loop body.
                    if mini.tick_concurrent_with_count() == 0
                        && mini.tasks.readable_length() == 0
                    {
                        // SAFETY: `loop_` is the live C-owned uws loop set in
                        // `MiniEventLoop::init()`.
                        unsafe {
                            (*mini.loop_).inc();
                            (*mini.loop_).tick();
                            (*mini.loop_).dec();
                        }
                        mini.on_after_event_loop();
                    }
                    while let Some(task) = mini.tasks.read_item() {
                        // SAFETY: see `MiniEventLoop::tick_once`.
                        unsafe { (*task).run(context) };
                    }
                }
            }
        }
    }

    pub fn tick_once(&mut self, context: *mut core::ffi::c_void) {
        match self {
            AnyEventLoop::Js { owner } => {
                let _ = context;
                // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
                unsafe {
                    js::tick(*owner);
                    js::auto_tick_active(*owner);
                }
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
// per CYCLEBREAK.md §→event_loop. Non-owning reference to either the JS event
// loop or the mini event loop. The `.js` arm holds an erased `*mut jsc::EventLoop`
// and dispatches through link-time-resolved `js::*` shims (defined in `bun_jsc`).

#[derive(Copy, Clone)]
pub enum EventLoopHandle {
    Js {
        // SAFETY: erased `*mut jsc::EventLoop` — runtime constructs this variant.
        owner: *mut (),
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
        EventLoopHandle::Js { owner: js_event_loop }
    }

    #[inline]
    pub fn init_mini(mini: *mut MiniEventLoop<'static>) -> EventLoopHandle {
        EventLoopHandle::Mini(mini)
    }

    /// Erase to a `bun_aio::EventLoopCtx` for `KeepAlive`/`FilePoll` calls
    /// (Zig: `KeepAlive.ref(anytype)` accepted `EventLoopHandle` directly via
    /// comptime dispatch). The JS arm reaches the global VM-ctx hook — there
    /// is exactly one JS event loop per thread, so the hook resolves to the
    /// same loop as `owner`. The mini arm uses the per-loop adapter so a
    /// non-global `MiniEventLoop` (e.g. spawn-sync) is honoured.
    #[inline]
    pub fn as_event_loop_ctx(self) -> bun_aio::EventLoopCtx {
        match self {
            EventLoopHandle::Js { .. } => {
                bun_aio::posix_event_loop::get_vm_ctx(bun_aio::AllocatorType::Js)
            }
            EventLoopHandle::Mini(mini) => MiniEventLoop::as_event_loop_ctx(mini),
        }
    }

    /// Erase to the `(tag, ptr)` pair stored in `uws::InternalLoopData`
    /// (`parent_tag` / `parent_ptr`). Tag 1 = JS, tag 2 = mini — matches Zig
    /// `setParentEventLoop`.
    #[inline]
    pub fn into_tag_ptr(self) -> (core::ffi::c_char, *mut core::ffi::c_void) {
        match self {
            EventLoopHandle::Js { owner, .. } => (1, owner.cast()),
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
            1 => EventLoopHandle::Js { owner: ptr.cast() },
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
            AnyEventLoop::Mini(mini) => EventLoopHandle::Mini(mini as *mut _),
        }
    }

    /// `EventLoopHandle` for the current thread's JS event loop. Replaces
    /// `jsc::EventLoopHandle.init(jsc::VirtualMachine.get())` for tier-≤4 callers.
    pub fn js_current() -> EventLoopHandle {
        // SAFETY: link-time resolved; panics in `bun_jsc` if no VM on thread.
        EventLoopHandle::init(unsafe { js::current() })
    }

    /// Erased `*mut jsc::JSGlobalObject` or null (Mini has no JS global).
    pub fn global_object(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => unsafe { js::global_object(owner) },
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    /// Erased `*mut jsc::VirtualMachine` or null.
    pub fn bun_vm(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => unsafe { js::bun_vm(owner) },
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stdout(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => unsafe { js::stdout(owner) },
            // SAFETY: `mini` is a live backref (set in `init_global` / caller).
            EventLoopHandle::Mini(mini) => unsafe { (*mini).stdout() },
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stderr(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner } => unsafe { js::stderr(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).stderr() },
        }
    }

    pub fn enter(self) {
        if let EventLoopHandle::Js { owner } = self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            unsafe { js::enter(owner) };
        }
    }

    pub fn exit(self) {
        if let EventLoopHandle::Js { owner } = self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            unsafe { js::exit(owner) };
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
    pub fn file_polls(self) -> *mut bun_aio::file_poll::Store {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            EventLoopHandle::Js { owner } => unsafe { js::file_polls(owner) },
            // SAFETY: see `stdout`. We hold `*mut MiniEventLoop`; derive a
            // unique borrow at the call site only.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).file_polls() as *mut _ },
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll
            .flags
            .contains(bun_aio::file_poll::Flags::WasEverRegistered);
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            EventLoopHandle::Js { owner } => unsafe {
                js::put_file_poll(*owner, poll, was_ever_registered)
            },
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
            EventLoopHandle::Js { owner } => unsafe {
                js::enqueue_task_concurrent(owner, task.js)
            },
            // SAFETY: caller guarantees `task.mini` is active; `mini` is a live backref.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).enqueue_task_concurrent(task.mini) },
        }
    }

    pub fn r#loop(self) -> *mut UwsLoop {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            EventLoopHandle::Js { owner } => unsafe { js::uws_loop(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).loop_ },
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

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same `Copy`-handle aliasing concern as [`file_polls`].
    pub fn pipe_read_buffer(self) -> *mut [u8] {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            EventLoopHandle::Js { owner } => unsafe { js::pipe_read_buffer(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).pipe_read_buffer() as *mut [u8] },
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
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            EventLoopHandle::Js { owner } => unsafe { js::env(owner) },
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
            EventLoopHandle::Js { owner } => unsafe { &*js::top_level_dir(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { &(*mini).top_level_dir },
        }
    }

    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        match self {
            // SAFETY: owner is the live erased `*mut jsc::EventLoop`.
            EventLoopHandle::Js { owner } => unsafe {
                js::create_null_delimited_env_map(owner)
            },
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

// ════════════════════════════════════════════════════════════════════════════
// bun_io FilePoll link-time bodies (CYCLEBREAK §io)
//
// `bun_io` (T2) cannot name `bun_aio::FilePoll` (T3) or this crate's
// `EventLoopHandle` (T4). It declares the surface below as `extern "Rust"` and
// stores opaque `*mut c_void` handles; the bodies live here because this is
// the lowest tier that can name *both* concrete types. Zig
// (`PipeReader.zig` / `PipeWriter.zig`) reached `bun.aio.FilePoll` directly.
// ════════════════════════════════════════════════════════════════════════════

use bun_aio::posix_event_loop::{
    FilePoll as AioFilePoll, Flags as AioFlags, FlagsSet as AioFlagsSet, OneShotFlag, Owner,
};
use bun_io::{FilePollFlag, FilePollKind, FilePollPtr};
use bun_sys::Fd;

/// Recover the typed `EventLoopHandle` from `bun_io`'s opaque newtype. Every
/// `bun_io::EventLoopHandle` is constructed by a `bun_runtime` caller as
/// `bun_io::EventLoopHandle(&handle as *const EventLoopHandle as *mut c_void)`,
/// so the pointee is always one of ours.
///
/// SAFETY: `ev.0` must point to a live `EventLoopHandle` for the call.
#[inline]
unsafe fn io_ev(ev: bun_io::EventLoopHandle) -> EventLoopHandle {
    // SAFETY: per fn contract; `EventLoopHandle` is `Copy`.
    unsafe { *(ev.0 as *const EventLoopHandle) }
}

#[inline]
fn io_flag(f: FilePollFlag) -> AioFlags {
    match f {
        FilePollFlag::PollWritable => AioFlags::PollWritable,
        FilePollFlag::Nonblocking => AioFlags::Nonblocking,
        FilePollFlag::Hup => AioFlags::Hup,
        FilePollFlag::WasEverRegistered => AioFlags::WasEverRegistered,
        FilePollFlag::Socket => AioFlags::Socket,
        FilePollFlag::Fifo => AioFlags::Fifo,
    }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_init(
    ev: bun_io::EventLoopHandle,
    fd: Fd,
    owner_tag: u8,
    owner: *mut core::ffi::c_void,
) -> FilePollPtr {
    // SAFETY: see `io_ev`.
    let ctx = unsafe { io_ev(ev) }.as_event_loop_ctx();
    AioFilePoll::init(ctx, fd, AioFlagsSet::empty(), Owner::new(owner_tag, owner.cast()))
        .cast()
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_fd(p: FilePollPtr) -> Fd {
    // SAFETY: `p` is a hive slot returned by `__bun_io_file_poll_init`.
    unsafe { (*p.cast::<AioFilePoll>()).fd }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_set_owner(p: FilePollPtr, owner_tag: u8, owner: *mut core::ffi::c_void) {
    // SAFETY: `p` is a live hive slot; field write only.
    unsafe { (*p.cast::<AioFilePoll>()).owner = Owner::new(owner_tag, owner.cast()) };
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_deinit_force_unregister(p: FilePollPtr) {
    // SAFETY: `p` is a live hive slot; `deinit_force_unregister` returns it to
    // the pool (caller must not touch `p` afterwards — matches Zig).
    unsafe { (*p.cast::<AioFilePoll>()).deinit_force_unregister() };
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_register(
    p: FilePollPtr,
    loop_: *mut core::ffi::c_void,
    kind: FilePollKind,
    fd: Fd,
) -> bun_sys::Result<()> {
    // Spec PipeReader.zig:330 / PipeWriter.zig:64: `registerWithFd(loop,
    // .{read,writ}able, .dispatch, fd)` — the *request* flag (`Readable` /
    // `Writable`), not the registered-state flag (`PollReadable` / …).
    // `register_with_fd_impl` switches on the former and would hit
    // `unreachable!()` on the latter.
    let flag = match kind {
        FilePollKind::Readable => AioFlags::Readable,
        FilePollKind::Writable => AioFlags::Writable,
    };
    // SAFETY: `p` is a live hive slot; `loop_` is the `*mut UwsLoop` returned
    // by `__bun_io_event_loop_to_loop` (same ev handle).
    unsafe {
        (*p.cast::<AioFilePoll>()).register_with_fd(
            &mut *loop_.cast::<UwsLoop>(),
            flag,
            OneShotFlag::Dispatch,
            fd,
        )
    }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_unregister(
    p: FilePollPtr,
    loop_: *mut core::ffi::c_void,
    force_unregister: bool,
) -> bun_sys::Result<()> {
    // SAFETY: see `__bun_io_file_poll_register`.
    unsafe {
        (*p.cast::<AioFilePoll>()).unregister(&mut *loop_.cast::<UwsLoop>(), force_unregister)
    }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_has_flag(p: FilePollPtr, f: FilePollFlag) -> bool {
    // SAFETY: `p` is a live hive slot; field read only.
    unsafe { (*p.cast::<AioFilePoll>()).flags.contains(io_flag(f)) }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_set_flag(p: FilePollPtr, f: FilePollFlag) {
    // SAFETY: `p` is a live hive slot; field write only.
    unsafe { (*p.cast::<AioFilePoll>()).flags.insert(io_flag(f)) };
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_file_type(p: FilePollPtr) -> bun_io::FileType {
    // SAFETY: `p` is a live hive slot.
    unsafe { (*p.cast::<AioFilePoll>()).file_type() }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_is_registered(p: FilePollPtr) -> bool {
    // SAFETY: `p` is a live hive slot.
    unsafe { (*p.cast::<AioFilePoll>()).is_registered() }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_is_watching(p: FilePollPtr) -> bool {
    // SAFETY: `p` is a live hive slot.
    unsafe { (*p.cast::<AioFilePoll>()).is_watching() }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_is_active(p: FilePollPtr) -> bool {
    // SAFETY: `p` is a live hive slot.
    unsafe { (*p.cast::<AioFilePoll>()).is_active() }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_can_enable_keeping_process_alive(p: FilePollPtr) -> bool {
    // SAFETY: `p` is a live hive slot.
    unsafe { (*p.cast::<AioFilePoll>()).can_enable_keeping_process_alive() }
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_enable_keeping_process_alive(
    p: FilePollPtr,
    ev: bun_io::EventLoopHandle,
) {
    // SAFETY: `p` is a live hive slot; see `io_ev`.
    let ctx = unsafe { io_ev(ev) }.as_event_loop_ctx();
    unsafe { (*p.cast::<AioFilePoll>()).enable_keeping_process_alive(ctx) };
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_file_poll_disable_keeping_process_alive(
    p: FilePollPtr,
    ev: bun_io::EventLoopHandle,
) {
    // SAFETY: `p` is a live hive slot; see `io_ev`.
    let ctx = unsafe { io_ev(ev) }.as_event_loop_ctx();
    unsafe { (*p.cast::<AioFilePoll>()).disable_keeping_process_alive(ctx) };
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_event_loop_to_loop(ev: bun_io::EventLoopHandle) -> *mut core::ffi::c_void {
    // SAFETY: see `io_ev`.
    unsafe { io_ev(ev) }.loop_().cast()
}

#[unsafe(no_mangle)]
pub unsafe fn __bun_io_pipe_read_buffer(ev: bun_io::EventLoopHandle) -> *mut [u8] {
    // SAFETY: see `io_ev`.
    unsafe { io_ev(ev) }.pipe_read_buffer()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AnyEventLoop.zig (123 lines)
//               src/jsc/EventLoopHandle.zig (179 lines) — MOVE-IN per CYCLEBREAK
//   confidence: medium
//   todos:      6
//   notes:      Js variant borrow may need &mut; `loop` keyword collision; FieldEnum reflection deferred.
//               EventLoopHandle Js arm dispatches via link-time `extern "Rust"` shims defined in bun_jsc::event_loop.
// ──────────────────────────────────────────────────────────────────────────
