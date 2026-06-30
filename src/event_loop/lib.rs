#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod AnyTask;
pub mod AnyTaskWithExtraContext;
pub mod AutoFlusher;
pub mod ConcurrentTask;
pub mod DeferredTaskQueue;
pub mod EventLoopTimer;
pub mod ManagedTask;

// ────────────────────────────────────────────────────────────────────────────
// AnyEventLoop / MiniEventLoop.
// `InternalLoopData::set_parent_event_loop`
// is reached via the lower-tier `set_parent_raw(tag, ptr)` +
// `EventLoopHandle::into_tag_ptr()`. The Windows-only `uv_loop` projection
// lives on `EventLoopHandle::uv_loop` (`#[cfg(windows)]`); the POSIX build is
// gate-free.
// ────────────────────────────────────────────────────────────────────────────

#[path = "MiniEventLoop.rs"]
pub mod MiniEventLoop;
// Module renamed `any_event_loop` so the *type* `AnyEventLoop` can be re-exported
// at crate root without colliding (modules and types share the type namespace).
// Downstream callers use `bun_event_loop::AnyEventLoop` as a type / for
// associated fns (`::init()`, `::js_current()`, `::as_handle()`), never as a
// module path, so the snake_case module name is internal.
#[path = "AnyEventLoop.rs"]
pub mod any_event_loop;

// ─── public surface ─────────────────────────────────────────────────────────

pub use ConcurrentTask::{Task, TaskTag, Taskable};

// snake_case alias for the file-level-struct module so higher tiers can
// `use bun_event_loop::auto_flusher::{AutoFlusher, HasAutoFlusher}` without
// tripping the type/module namespace collision on the PascalCase form.
pub use AutoFlusher as auto_flusher;
pub use DeferredTaskQueue as deferred_task_queue;

pub use MiniEventLoop::{EventLoopKind, PIPE_READ_BUFFER_SIZE, PipeReadBuffer, PlatformEventLoop};
pub use any_event_loop::{AnyEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr};

// JS-event-loop arm of `AnyEventLoop` / `EventLoopHandle`. `bun_event_loop` is
// a lower tier than `bun_jsc`, so it cannot name `jsc::EventLoop` /
// `jsc::VirtualMachine` directly. Owner is an erased `*mut jsc::EventLoop`;
// `bun_jsc::event_loop` provides the method table.

/// Method table for the JS event loop (`jsc::EventLoop`). The single
/// implementor lives in bun_jsc, which builds JS_EVENT_LOOP_VTABLE from
/// typed shims; the owner pointer is the live `*mut jsc::EventLoop`.
pub struct JsEventLoopVTable {
    pub iteration_number: unsafe fn(*mut ()) -> u64,
    pub file_polls: unsafe fn(*mut ()) -> *mut bun_io::file_poll::Store,
    pub put_file_poll: unsafe fn(*mut (), poll: *mut bun_io::FilePoll, was_ever_registered: bool),
    pub uws_loop: unsafe fn(*mut ()) -> *mut bun_uws::Loop,
    pub pipe_read_buffer: unsafe fn(*mut ()) -> *mut [u8],
    pub tick: unsafe fn(*mut ()),
    pub auto_tick: unsafe fn(*mut ()),
    pub auto_tick_active: unsafe fn(*mut ()),
    pub global_object: unsafe fn(*mut ()) -> *mut (),
    pub bun_vm: unsafe fn(*mut ()) -> *mut (),
    pub enter: unsafe fn(*mut ()),
    pub exit: unsafe fn(*mut ()),
    pub enqueue_task: unsafe fn(*mut (), Task),
    pub enqueue_task_concurrent:
        unsafe fn(*mut (), core::ptr::NonNull<ConcurrentTask::ConcurrentTask>),
    pub env: unsafe fn(*mut ()) -> *mut bun_dotenv::Loader<'static>,
    pub top_level_dir: unsafe fn(*mut ()) -> *const [u8],
    pub create_null_delimited_env_map:
        unsafe fn(*mut ()) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>,
    pub as_event_loop_ctx: unsafe fn(*mut ()) -> bun_io::EventLoopCtx,
}

/// Typed handle over the erased `*mut jsc::EventLoop` plus the owner-provided
/// method table.
#[derive(Copy, Clone)]
pub struct JsEventLoop {
    pub owner: *mut (),
    pub vtable: &'static JsEventLoopVTable,
}

unsafe extern "Rust" {
    /// The single `#[no_mangle]` method table, defined in `bun_jsc::event_loop`
    /// and resolved at link time.
    pub safe static __BUN_JS_EVENT_LOOP_VTABLE: JsEventLoopVTable;
}

impl JsEventLoop {
    /// SAFETY: `owner` must be the live `*mut jsc::EventLoop` the vtable was
    /// written for, live for every dispatch through the handle.
    #[inline]
    pub unsafe fn new(owner: *mut (), vtable: &'static JsEventLoopVTable) -> Self {
        Self { owner, vtable }
    }

    #[inline]
    pub fn iteration_number(&self) -> u64 {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.iteration_number)(self.owner) }
    }

    #[inline]
    pub fn file_polls(&self) -> *mut bun_io::file_poll::Store {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.file_polls)(self.owner) }
    }

    /// `poll` is forwarded to the JS event loop's poll store verbatim and
    /// never dereferenced here.
    #[inline]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn put_file_poll(&self, poll: *mut bun_io::FilePoll, was_ever_registered: bool) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.put_file_poll)(self.owner, poll, was_ever_registered) }
    }

    #[inline]
    pub fn uws_loop(&self) -> *mut bun_uws::Loop {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.uws_loop)(self.owner) }
    }

    #[inline]
    pub fn pipe_read_buffer(&self) -> *mut [u8] {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.pipe_read_buffer)(self.owner) }
    }

    #[inline]
    pub fn tick(&self) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.tick)(self.owner) }
    }

    #[inline]
    pub fn auto_tick(&self) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.auto_tick)(self.owner) }
    }

    #[inline]
    pub fn auto_tick_active(&self) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.auto_tick_active)(self.owner) }
    }

    #[inline]
    pub fn global_object(&self) -> *mut () {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.global_object)(self.owner) }
    }

    #[inline]
    pub fn bun_vm(&self) -> *mut () {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.bun_vm)(self.owner) }
    }

    #[inline]
    pub fn enter(&self) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.enter)(self.owner) }
    }

    #[inline]
    pub fn exit(&self) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.exit)(self.owner) }
    }

    #[inline]
    pub fn enqueue_task(&self, task: Task) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.enqueue_task)(self.owner, task) }
    }

    #[inline]
    pub fn enqueue_task_concurrent(
        &self,
        task: core::ptr::NonNull<ConcurrentTask::ConcurrentTask>,
    ) {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.enqueue_task_concurrent)(self.owner, task) }
    }

    #[inline]
    pub fn env(&self) -> *mut bun_dotenv::Loader<'static> {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.env)(self.owner) }
    }

    #[inline]
    pub fn top_level_dir(&self) -> *const [u8] {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.top_level_dir)(self.owner) }
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        &self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.create_null_delimited_env_map)(self.owner) }
    }

    #[inline]
    pub fn as_event_loop_ctx(&self) -> bun_io::EventLoopCtx {
        // SAFETY: `new()` contract — `owner` is the live `*mut jsc::EventLoop`.
        unsafe { (self.vtable.as_event_loop_ctx)(self.owner) }
    }
}

thread_local! {
    /// Installed by bun_jsc when a VM binds/unbinds its event loop on this thread.
    pub static CURRENT_JS_EVENT_LOOP: core::cell::Cell<Option<JsEventLoop>> = const { core::cell::Cell::new(None) };
}

impl JsEventLoop {
    /// `jsc::VirtualMachine::get().event_loop()` for the current thread.
    #[inline]
    pub fn current() -> Self {
        CURRENT_JS_EVENT_LOOP
            .with(|c| c.get())
            .expect("no JS event loop bound on this thread")
    }

    pub fn set_current(h: Option<JsEventLoop>) {
        CURRENT_JS_EVENT_LOOP.with(|c| c.set(h));
    }
}
