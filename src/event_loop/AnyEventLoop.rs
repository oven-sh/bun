use core::sync::atomic::{AtomicPtr, Ordering};

use bun_aio::FilePoll;
use bun_dotenv::Loader as DotEnvLoader;
use bun_uws::Loop as UwsLoop;

use crate::{AnyTaskWithExtraContext, ConcurrentTask, MiniEventLoop};

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
    pub enqueue_task_concurrent: unsafe fn(*mut (), *mut ConcurrentTask),
    /// `el.virtual_machine.transpiler.env`.
    pub env: unsafe fn(*mut ()) -> *mut DotEnvLoader,
    /// `el.virtual_machine.transpiler.fs.top_level_dir` — borrowed slice valid for VM lifetime.
    pub top_level_dir: unsafe fn(*mut ()) -> *const [u8],
    /// `el.virtual_machine.transpiler.env.map.createNullDelimitedEnvMap(alloc)`.
    pub create_null_delimited_env_map:
        unsafe fn(*mut ()) -> bun_core::OomResult<Box<[Option<*const i8>]>>,
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

impl<'a> AnyEventLoop<'a> {
    pub fn iteration_number(&self) -> u64 {
        match self {
            // SAFETY: vtable populated by runtime; owner is the erased EventLoop ptr.
            AnyEventLoop::Js { owner, vtable } => unsafe { (vtable.iteration_number)(*owner) },
            // TODO(port): `loop` is a Rust keyword; assumes MiniEventLoop port names the field `loop_`.
            AnyEventLoop::Mini(mini) => mini.loop_.iteration_number(),
        }
    }

    pub fn wakeup(&mut self) {
        self.r#loop().wakeup();
    }

    pub fn file_polls(&mut self) -> &mut bun_aio::file_poll::Store {
        match self {
            // SAFETY: vtable contract — returns a valid &mut Store owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { &mut *(vtable.file_polls)(*owner) },
            AnyEventLoop::Mini(mini) => mini.file_polls(),
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        // TODO(port): `poll.flags.contains(.was_ever_registered)` — exact flag-set type/path TBD in bun_aio.
        let was_ever_registered = poll.flags.contains(bun_aio::file_poll::Flag::WasEverRegistered);
        match self {
            AnyEventLoop::Js { owner, vtable } => unsafe {
                (vtable.put_file_poll)(*owner, poll, was_ever_registered)
            },
            AnyEventLoop::Mini(mini) => {
                // PORT NOTE: reshaped for borrowck — Zig passed `&this.mini` while also holding
                // `this.mini.filePolls()` mutably; Phase B may need to split the borrow.
                let store = mini.file_polls();
                store.put(poll, mini, was_ever_registered);
            }
        }
    }

    // PORT NOTE: renamed via raw identifier — `loop` is a Rust keyword.
    pub fn r#loop(&mut self) -> &mut UwsLoop {
        match self {
            // SAFETY: vtable contract — returns a valid &mut UwsLoop owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { &mut *(vtable.uws_loop)(*owner) },
            AnyEventLoop::Mini(mini) => mini.loop_,
        }
    }

    pub fn pipe_read_buffer(&mut self) -> &mut [u8] {
        match self {
            // SAFETY: vtable contract — returns a valid &mut [u8] owned by the VM.
            AnyEventLoop::Js { owner, vtable } => unsafe { &mut *(vtable.pipe_read_buffer)(*owner) },
            AnyEventLoop::Mini(mini) => mini.pipe_read_buffer(),
        }
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

    pub fn tick<C: Copy>(&mut self, context: C, is_done: fn(C) -> bool) {
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
            AnyEventLoop::Mini(mini) => {
                // TODO(port): Zig used `@ptrCast(isDone)` to erase the fn-pointer type for
                // `mini.tick(context, *const fn(*anyopaque) bool)`. Phase B: decide whether
                // MiniEventLoop::tick is generic over C or takes an erased `*mut c_void` + fn ptr.
                mini.tick(context, is_done);
            }
        }
    }

    pub fn tick_once<C>(&mut self, context: C) {
        match self {
            AnyEventLoop::Js { owner, vtable } => {
                let _ = context;
                // SAFETY: vtable contract.
                unsafe {
                    (vtable.tick)(*owner);
                    (vtable.auto_tick_active)(*owner);
                }
            }
            AnyEventLoop::Mini(mini) => {
                mini.tick_without_idle(context);
            }
        }
    }

    pub fn enqueue_task_concurrent<Context, ParentContext>(
        &mut self,
        ctx: &mut Context,
        callback: fn(&mut Context, &mut ParentContext),
        // TODO(port): Zig param `comptime field: std.meta.FieldEnum(Context)` — struct-field
        // reflection has no Rust equivalent. Likely becomes `core::mem::offset_of!`-based or
        // the caller passes `&mut ctx.<field>` directly. See MiniEventLoop port.
    ) {
        match self {
            AnyEventLoop::Js { .. } => {
                bun_core::todo_panic!("AnyEventLoop.enqueueTaskConcurrent");
                // const TaskType = AnyTask.New(Context, Callback);
                // @field(ctx, field) = TaskType.init(ctx);
                // var concurrent = bun.default_allocator.create(ConcurrentTask) catch unreachable;
                // _ = concurrent.from(jsc.Task.init(&@field(ctx, field)));
                // concurrent.auto_delete = true;
                // this.virtual_machine.jsc.enqueueTaskConcurrent(concurrent);
            }
            AnyEventLoop::Mini(mini) => {
                // TODO(port): forward the `field` reflection param once its Rust shape is decided.
                mini.enqueue_task_concurrent_with_extra_ctx::<Context, ParentContext>(ctx, callback);
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
    pub fn init(kind: crate::EventLoopKind) -> EventLoopTask {
        match kind {
            crate::EventLoopKind::Js => EventLoopTask::Js(ConcurrentTask::default()),
            crate::EventLoopKind::Mini => EventLoopTask::Mini(AnyTaskWithExtraContext::default()),
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

    pub fn file_polls(self) -> &'static mut bun_aio::file_poll::Store {
        match self {
            // SAFETY: vtable contract — returns a valid &mut Store owned by the VM.
            EventLoopHandle::Js { owner, vtable } => unsafe { &mut *(vtable.file_polls)(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).file_polls() },
        }
    }

    pub fn put_file_poll(&mut self, poll: &mut FilePoll) {
        let was_ever_registered = poll.flags.contains(bun_aio::file_poll::Flag::WasEverRegistered);
        match self {
            EventLoopHandle::Js { owner, vtable } => unsafe {
                (vtable.put_file_poll)(*owner, poll, was_ever_registered)
            },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe {
                let store = (**mini).file_polls();
                store.put(poll, &mut **mini, was_ever_registered);
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
            EventLoopHandle::Mini(mini) => unsafe { (*mini).loop_ as *const _ as *mut _ },
        }
    }

    #[inline]
    pub fn platform_event_loop(self) -> *mut UwsLoop {
        self.r#loop()
    }

    pub fn pipe_read_buffer(self) -> &'static mut [u8] {
        match self {
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe { &mut *(vtable.pipe_read_buffer)(owner) },
            // SAFETY: see `stdout`.
            EventLoopHandle::Mini(mini) => unsafe { (*mini).pipe_read_buffer() },
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

    pub fn env(self) -> *mut DotEnvLoader {
        match self {
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe { (vtable.env)(owner) },
            // SAFETY: see `stdout`. Zig unwraps `mini.env.?` — caller invariant.
            EventLoopHandle::Mini(mini) => unsafe {
                (*mini).env.expect("MiniEventLoop.env unset") as *const _ as *mut _
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
    ) -> bun_core::OomResult<Box<[Option<*const i8>]>> {
        match self {
            // SAFETY: vtable contract.
            EventLoopHandle::Js { owner, vtable } => unsafe {
                (vtable.create_null_delimited_env_map)(owner)
            },
            // SAFETY: see `stdout`. Zig unwraps `mini.env.?`.
            EventLoopHandle::Mini(mini) => unsafe {
                (*(*mini).env.expect("MiniEventLoop.env unset"))
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
