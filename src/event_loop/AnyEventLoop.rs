use core::sync::atomic::{AtomicPtr, Ordering};

use bun_aio::FilePoll;
use bun_dotenv::Loader as DotEnvLoader;
use bun_uws::Loop as UwsLoop;

use crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
use crate::ConcurrentTask::ConcurrentTask;
use crate::MiniEventLoop::{EventLoopKind, MiniEventLoop};

/// Manual vtable for the JS-event-loop arm of `AnyEventLoop` / `EventLoopHandle`
/// (cold dispatch — see PORTING.md §Dispatch). `bun_runtime` provides the static
/// instance that casts `owner` back to `*mut jsc::EventLoop` and forwards to the
/// real methods, then writes its address into `JS_EVENT_LOOP_VTABLE` at init.
// PERF(port): was inline switch
pub struct JsEventLoopVTable {
    // ── AnyEventLoop slots ─────────────────────────────────────────────
    pub iteration_number: unsafe fn(*mut ()) -> u64,
    pub file_polls: unsafe fn(*mut ()) -> *mut bun_aio::file_poll::Store,
    pub put_file_poll: unsafe fn(*mut (), *mut FilePoll, was_ever_registered: bool),
    pub uws_loop: unsafe fn(*mut ()) -> *mut UwsLoop,
    pub pipe_read_buffer: unsafe fn(*mut ()) -> *mut [u8],
    pub tick: unsafe fn(*mut ()),
    pub auto_tick: unsafe fn(*mut ()),
    pub auto_tick_active: unsafe fn(*mut ()),
    // ── EventLoopHandle slots (was bun_jsc::EventLoopHandle) ───────────
    /// `el.global` — erased `*mut jsc::JSGlobalObject` or null.
    pub global_object: unsafe fn(*mut ()) -> *mut (),
    /// `el.virtual_machine` — erased `*mut jsc::VirtualMachine`.
    pub bun_vm: unsafe fn(*mut ()) -> *mut (),
    /// `el.virtual_machine.rareData().stdout()` — erased `*mut webcore::blob::Store`.
    pub stdout: unsafe fn(*mut ()) -> *mut (),
    /// `el.virtual_machine.rareData().stderr()` — erased `*mut webcore::blob::Store`.
    pub stderr: unsafe fn(*mut ()) -> *mut (),
    pub enter: unsafe fn(*mut ()),
    pub exit: unsafe fn(*mut ()),
    /// `el.enqueueTask(jsc.Task)` — same-thread task enqueue (no wakeup).
    pub enqueue_task: unsafe fn(*mut (), crate::Task),
    pub enqueue_task_concurrent: unsafe fn(*mut (), *mut ConcurrentTask),
    /// `el.virtual_machine.transpiler.env`.
    pub env: unsafe fn(*mut ()) -> *mut DotEnvLoader<'static>,
    /// `el.virtual_machine.transpiler.fs.top_level_dir` — borrowed slice valid for VM lifetime.
    pub top_level_dir: unsafe fn(*mut ()) -> *const [u8],
    /// `el.virtual_machine.transpiler.env.map.createNullDelimitedEnvMap(alloc)`.
    pub create_null_delimited_env_map:
        unsafe fn(*mut ()) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>,
}

/// Registered by `bun_runtime::init()` — the single static `JsEventLoopVTable`
/// instance used by every `AnyEventLoop::Js` / `EventLoopHandle::Js`.
pub static JS_EVENT_LOOP_VTABLE: AtomicPtr<JsEventLoopVTable> =
    AtomicPtr::new(core::ptr::null_mut());

/// `unsafe fn() -> *mut ()` — returns the current thread's `*mut jsc::EventLoop`
/// (i.e. `jsc::VirtualMachine::get().event_loop()`). Registered by
/// `bun_runtime::init()`. Backs `AnyEventLoop::js_current()` /
/// `EventLoopHandle::js_current()` for callers (install, cli, patch) that
/// previously reached through `bun_jsc`.
pub static JS_EVENT_LOOP_CURRENT: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

#[inline]
fn js_vtable() -> &'static JsEventLoopVTable {
    let p = JS_EVENT_LOOP_VTABLE.load(Ordering::Relaxed);
    debug_assert!(
        !p.is_null(),
        "JS_EVENT_LOOP_VTABLE not registered by bun_runtime::init()"
    );
    // SAFETY: registered once at startup, &'static thereafter.
    unsafe { &*p }
}

/// Useful for code that may need an event loop and could be used from either JavaScript or directly without JavaScript.
/// Unlike jsc.EventLoopHandle, this owns the event loop when it's not a JavaScript event loop.
// PORT NOTE: Zig `union(EventLoopKind)` — variant order/discriminant must match `crate::EventLoopKind`.
pub enum AnyEventLoop<'a> {
    Js {
        // SAFETY: erased `*mut jsc::EventLoop` — runtime constructs this variant.
        owner: *mut (),
        vtable: &'static JsEventLoopVTable,
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
            // SAFETY: vtable populated by runtime; owner is the erased EventLoop ptr.
            AnyEventLoop::Js { owner, vtable } => unsafe { (vtable.iteration_number)(*owner) },
            // SAFETY: `loop_` is the live C-owned uws loop (set in `MiniEventLoop::init`).
            AnyEventLoop::Mini(mini) => unsafe { (*mini.loop_).iteration_number() },
        }
    }

    pub fn wakeup(&mut self) {
        // SAFETY: `r#loop()` returns a valid live loop pointer (vtable contract / mini.loop_).
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
            // SAFETY: vtable contract — slot returns a valid live *mut Store.
            AnyEventLoop::Js { owner, vtable } => unsafe { (vtable.file_polls)(*owner) },
            AnyEventLoop::Mini(mini) => mini.file_polls() as *mut _,
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll
            .flags
            .contains(bun_aio::file_poll::Flags::WasEverRegistered);
        match self {
            // SAFETY: vtable contract.
            AnyEventLoop::Js { owner, vtable } => unsafe {
                (vtable.put_file_poll)(*owner, poll, was_ever_registered)
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
            // SAFETY: vtable contract — returns a valid *mut UwsLoop owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { (vtable.uws_loop)(*owner) },
            AnyEventLoop::Mini(mini) => mini.loop_,
        }
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same VM-shared-storage aliasing concern as [`file_polls`] —
    /// the `Js` arm cannot prove exclusive access, so callers deref locally.
    pub fn pipe_read_buffer(&mut self) -> *mut [u8] {
        match self {
            // SAFETY: vtable contract — slot returns a valid live *mut [u8].
            AnyEventLoop::Js { owner, vtable } => unsafe { (vtable.pipe_read_buffer)(*owner) },
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

    /// Construct the `Js` variant for the current thread's JS event loop.
    /// Replaces `jsc::VirtualMachine::get().event_loop()` for tier-≤4 callers
    /// (e.g. `bun_install::PackageManager`).
    pub fn js_current() -> AnyEventLoop<'static> {
        let hook = JS_EVENT_LOOP_CURRENT.load(Ordering::Relaxed);
        debug_assert!(
            !hook.is_null(),
            "JS_EVENT_LOOP_CURRENT not registered by bun_runtime::init()"
        );
        // SAFETY: hook signature documented on `JS_EVENT_LOOP_CURRENT`.
        let f: unsafe fn() -> *mut () = unsafe { core::mem::transmute(hook) };
        AnyEventLoop::Js {
            owner: unsafe { f() },
            vtable: js_vtable(),
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
            AnyEventLoop::Js { owner, vtable } => {
                while !is_done(context) {
                    // SAFETY: vtable contract.
                    unsafe {
                        (vtable.tick)(*owner);
                        (vtable.auto_tick)(*owner);
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
                AnyEventLoop::Js { owner, vtable } => {
                    // SAFETY: vtable contract.
                    unsafe {
                        (vtable.tick)(*owner);
                        (vtable.auto_tick)(*owner);
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
            AnyEventLoop::Js { owner, vtable } => {
                let _ = context;
                // SAFETY: vtable contract.
                unsafe {
                    (vtable.tick)(*owner);
                    (vtable.auto_tick_active)(*owner);
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
// and dispatches through `JsEventLoopVTable` (registered by bun_runtime).

#[derive(Copy, Clone)]
pub enum EventLoopHandle {
    Js {
        // SAFETY: erased `*mut jsc::EventLoop` — runtime constructs this variant.
        owner: *mut (),
        vtable: &'static JsEventLoopVTable,
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

impl EventLoopHandle {
    /// Wrap an erased `*mut jsc::EventLoop`. The vtable is read from the
    /// global `JS_EVENT_LOOP_VTABLE` static (registered by `bun_runtime::init()`).
    // PORT NOTE: Zig `init(anytype)` dispatched on `@TypeOf` over five input
    // types. Rust splits by overload: `init` (jsc::EventLoop), `init_mini`,
    // `from_any`, plus the trivial `EventLoopHandle → EventLoopHandle` is
    // identity. The `*VirtualMachine` overload moves to bun_runtime (it must
    // call `vm.eventLoop()`).
    #[inline]
    pub fn init(js_event_loop: *mut ()) -> EventLoopHandle {
        EventLoopHandle::Js {
            owner: js_event_loop,
            vtable: js_vtable(),
        }
    }

    #[inline]
    pub fn init_mini(mini: *mut MiniEventLoop<'static>) -> EventLoopHandle {
        EventLoopHandle::Mini(mini)
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
            AnyEventLoop::Js { owner, vtable } => EventLoopHandle::Js {
                owner: *owner,
                vtable,
            },
            AnyEventLoop::Mini(mini) => EventLoopHandle::Mini(mini as *mut _),
        }
    }

    /// `EventLoopHandle` for the current thread's JS event loop. Replaces
    /// `jsc::EventLoopHandle.init(jsc::VirtualMachine.get())` for tier-≤4 callers.
    pub fn js_current() -> EventLoopHandle {
        let hook = JS_EVENT_LOOP_CURRENT.load(Ordering::Relaxed);
        debug_assert!(!hook.is_null(), "JS_EVENT_LOOP_CURRENT not registered");
        // SAFETY: hook signature documented on `JS_EVENT_LOOP_CURRENT`.
        let f: unsafe fn() -> *mut () = unsafe { core::mem::transmute(hook) };
        EventLoopHandle::init(unsafe { f() })
    }

    /// Erased `*mut jsc::JSGlobalObject` or null (Mini has no JS global).
    pub fn global_object(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.global_object)(owner) },
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    /// Erased `*mut jsc::VirtualMachine` or null.
    pub fn bun_vm(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.bun_vm)(owner) },
            EventLoopHandle::Mini(_) => core::ptr::null_mut(),
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stdout(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.stdout)(owner) },
            // SAFETY: `mini` is a live backref (set in `init_global` / caller).
            EventLoopHandle::Mini(mini) => unsafe { (*mini).stdout() },
        }
    }

    /// Erased `*mut webcore::blob::Store`.
    pub fn stderr(self) -> *mut () {
        match self {
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.stderr)(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).stderr() },
        }
    }

    pub fn enter(self) {
        if let EventLoopHandle::Js { owner, vtable } = self {
            // SAFETY: vtable contract.
            unsafe { (vtable.enter)(owner) };
        }
    }

    pub fn exit(self) {
        if let EventLoopHandle::Js { owner, vtable } = self {
            // SAFETY: vtable contract.
            unsafe { (vtable.exit)(owner) };
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
            // SAFETY: vtable contract — slot returns a valid live *mut Store.
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.file_polls)(owner) },
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
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe {
                (vtable.put_file_poll)(*owner, poll, was_ever_registered)
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
            EventLoopHandle::Js { owner, vtable } => unsafe {
                (vtable.enqueue_task_concurrent)(owner, task.js)
            },
            // SAFETY: caller guarantees `task.mini` is active; `mini` is a live backref.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).enqueue_task_concurrent(task.mini) },
        }
    }

    pub fn r#loop(self) -> *mut UwsLoop {
        match self {
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.uws_loop)(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).loop_ },
        }
    }

    #[inline]
    pub fn platform_event_loop(self) -> *mut UwsLoop {
        self.r#loop()
    }

    /// Returns the shared pipe-read scratch buffer as a raw fat ptr (mirrors
    /// Zig `[]u8`). Same `Copy`-handle aliasing concern as [`file_polls`].
    pub fn pipe_read_buffer(self) -> *mut [u8] {
        match self {
            // SAFETY: vtable contract — slot returns a valid live *mut [u8].
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.pipe_read_buffer)(owner) },
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
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.env)(owner) },
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
            // SAFETY: vtable contract — slice borrowed for VM lifetime.
            EventLoopHandle::Js { owner, vtable } => unsafe { &*(vtable.top_level_dir)(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { &(*mini).top_level_dir },
        }
    }

    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        match self {
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe {
                (vtable.create_null_delimited_env_map)(owner)
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/AnyEventLoop.zig (123 lines)
//               src/jsc/EventLoopHandle.zig (179 lines) — MOVE-IN per CYCLEBREAK
//   confidence: medium
//   todos:      6
//   notes:      Js variant borrow may need &mut; `loop` keyword collision; FieldEnum reflection deferred.
//               EventLoopHandle Js arm dispatches via JsEventLoopVTable + JS_EVENT_LOOP_VTABLE static (runtime registers).
// ──────────────────────────────────────────────────────────────────────────
