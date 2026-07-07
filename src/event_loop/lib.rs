#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod AnyTask;
pub mod AnyTaskWithExtraContext;
pub mod AutoFlusher;
pub mod ConcurrentTask;
pub mod DeferredTaskQueue;
pub mod EventLoopTimer;
pub mod ManagedTask;

use core::ptr::NonNull;

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
// `jsc::VirtualMachine` directly. The handle stores an opaque
// `*mut JscEventLoop`; `bun_jsc::event_loop` defines the
// `#[no_mangle]` `bun_jsc_event_loop_*` fns, resolved at link time — hardcoded,
// single implementor, no runtime registration and no init-order hazard.

bun_opaque::opaque_ffi! {
    /// The JS event loop (`jsc::EventLoop`), opaque at this tier.
    pub struct JscEventLoop;
}

// One typed link fn per `JsEventLoop` method, all defined in
// `bun_jsc::event_loop`. Every body casts `el` back to the live
// `*mut jsc::EventLoop` it was erased from.
unsafe extern "Rust" {
    pub unsafe fn bun_jsc_event_loop_iteration_number(el: NonNull<JscEventLoop>) -> u64;
    pub unsafe fn bun_jsc_event_loop_file_polls(
        el: NonNull<JscEventLoop>,
    ) -> *mut bun_io::file_poll::Store;
    pub unsafe fn bun_jsc_event_loop_put_file_poll(
        el: NonNull<JscEventLoop>,
        poll: *mut bun_io::FilePoll,
        was_ever_registered: bool,
    );
    pub unsafe fn bun_jsc_event_loop_uws_loop(el: NonNull<JscEventLoop>) -> *mut bun_uws::Loop;
    pub unsafe fn bun_jsc_event_loop_pipe_read_buffer(el: NonNull<JscEventLoop>) -> *mut [u8];
    pub unsafe fn bun_jsc_event_loop_tick(el: NonNull<JscEventLoop>);
    pub unsafe fn bun_jsc_event_loop_auto_tick(el: NonNull<JscEventLoop>);
    pub unsafe fn bun_jsc_event_loop_auto_tick_active(el: NonNull<JscEventLoop>);
    pub unsafe fn bun_jsc_event_loop_global_object(el: NonNull<JscEventLoop>) -> *mut ();
    pub unsafe fn bun_jsc_event_loop_bun_vm(el: NonNull<JscEventLoop>) -> *mut ();
    pub unsafe fn bun_jsc_event_loop_enter(el: NonNull<JscEventLoop>);
    pub unsafe fn bun_jsc_event_loop_exit(el: NonNull<JscEventLoop>);
    pub unsafe fn bun_jsc_event_loop_enqueue_task(el: NonNull<JscEventLoop>, task: Task);
    pub unsafe fn bun_jsc_event_loop_enqueue_task_concurrent(
        el: NonNull<JscEventLoop>,
        task: core::ptr::NonNull<ConcurrentTask::ConcurrentTask>,
    );
    pub unsafe fn bun_jsc_event_loop_env(
        el: NonNull<JscEventLoop>,
    ) -> *mut bun_dotenv::Loader<'static>;
    pub unsafe fn bun_jsc_event_loop_top_level_dir(el: NonNull<JscEventLoop>) -> *const [u8];
    pub unsafe fn bun_jsc_event_loop_create_null_delimited_env_map(
        el: NonNull<JscEventLoop>,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>;
    pub unsafe fn bun_jsc_event_loop_as_event_loop_ctx(
        el: NonNull<JscEventLoop>,
    ) -> bun_io::EventLoopCtx;
}

/// Typed handle over the erased, opaque `jsc::EventLoop` pointer.
///
/// The pointer is raw (not `NonNull`) because `EventLoopHandle::init(null)`
/// is a documented never-dispatched placeholder; every dispatch requires a
/// live (hence non-null) owner per the constructor contracts.
#[derive(Copy, Clone)]
pub struct JsEventLoop(*mut JscEventLoop);

impl JsEventLoop {
    /// SAFETY: `el` must be the live `*mut jsc::EventLoop` this handle is
    /// for (live for every dispatch through the handle), or null for a
    /// handle that is never dispatched through.
    #[inline]
    pub unsafe fn from_ptr(el: *mut JscEventLoop) -> Self {
        Self(el)
    }

    /// The erased `*mut jsc::EventLoop` this handle wraps.
    #[inline]
    pub fn as_ptr(self) -> *mut JscEventLoop {
        self.0
    }

    /// SAFETY: constructor contract — non-null on every dispatch.
    #[inline]
    unsafe fn owner(&self) -> NonNull<JscEventLoop> {
        debug_assert!(
            !self.0.is_null(),
            "dispatch through a placeholder JsEventLoop"
        );
        // SAFETY: forwarded to the caller (`from_ptr` contract).
        unsafe { NonNull::new_unchecked(self.0) }
    }

    #[inline]
    pub fn iteration_number(self) -> u64 {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_iteration_number(self.owner()) }
    }

    #[inline]
    pub fn file_polls(self) -> *mut bun_io::file_poll::Store {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_file_polls(self.owner()) }
    }

    /// `poll` is forwarded to the JS event loop's poll store verbatim and
    /// never dereferenced here.
    #[inline]
    #[allow(clippy::not_unsafe_ptr_arg_deref)]
    pub fn put_file_poll(self, poll: *mut bun_io::FilePoll, was_ever_registered: bool) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_put_file_poll(self.owner(), poll, was_ever_registered) }
    }

    #[inline]
    pub fn uws_loop(self) -> *mut bun_uws::Loop {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_uws_loop(self.owner()) }
    }

    #[inline]
    pub fn pipe_read_buffer(self) -> *mut [u8] {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_pipe_read_buffer(self.owner()) }
    }

    #[inline]
    pub fn tick(self) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_tick(self.owner()) }
    }

    #[inline]
    pub fn auto_tick(self) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_auto_tick(self.owner()) }
    }

    #[inline]
    pub fn auto_tick_active(self) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_auto_tick_active(self.owner()) }
    }

    #[inline]
    pub fn global_object(self) -> *mut () {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_global_object(self.owner()) }
    }

    #[inline]
    pub fn bun_vm(self) -> *mut () {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_bun_vm(self.owner()) }
    }

    #[inline]
    pub fn enter(self) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_enter(self.owner()) }
    }

    #[inline]
    pub fn exit(self) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_exit(self.owner()) }
    }

    #[inline]
    pub fn enqueue_task(self, task: Task) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_enqueue_task(self.owner(), task) }
    }

    #[inline]
    pub fn enqueue_task_concurrent(self, task: core::ptr::NonNull<ConcurrentTask::ConcurrentTask>) {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_enqueue_task_concurrent(self.owner(), task) }
    }

    #[inline]
    pub fn env(self) -> *mut bun_dotenv::Loader<'static> {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_env(self.owner()) }
    }

    #[inline]
    pub fn top_level_dir(self) -> *const [u8] {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_top_level_dir(self.owner()) }
    }

    #[inline]
    pub fn create_null_delimited_env_map(
        self,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_create_null_delimited_env_map(self.owner()) }
    }

    #[inline]
    pub fn as_event_loop_ctx(self) -> bun_io::EventLoopCtx {
        // SAFETY: `new()` contract — `self.0` is the live `*mut jsc::EventLoop`.
        unsafe { bun_jsc_event_loop_as_event_loop_ctx(self.owner()) }
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
