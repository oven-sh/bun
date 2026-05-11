#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]
// AUTOGEN: mod declarations only — real exports added in B-1.
#![warn(unreachable_pub)]
pub mod AutoFlusher;
pub mod AnyTask;
pub mod ManagedTask;
pub mod DeferredTaskQueue;
pub mod AnyTaskWithExtraContext;
pub mod ConcurrentTask;
pub mod EventLoopTimer;

// ────────────────────────────────────────────────────────────────────────────
// B-2 un-gated: AnyEventLoop / SpawnSyncEventLoop / MiniEventLoop compile.
// All `` gates removed this pass — bun_uws_sys::Loop and
// bun_core::Timespec are now real types. `InternalLoopData::set_parent_event_loop`
// is reached via the lower-tier `set_parent_raw(tag, ptr)` +
// `EventLoopHandle::into_tag_ptr()`. Windows-only `MiniVM::platform_event_loop`
// (`uws::Loop::uv_loop`) remains `#[cfg(windows)]`-guarded with a
// `TODO(b2-blocked)` marker; the POSIX build is gate-free.
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
#[path = "SpawnSyncEventLoop.rs"]
pub mod SpawnSyncEventLoop;

// ─── public surface ─────────────────────────────────────────────────────────

pub use AnyTask::{ErasedJsError, JsResult};
pub use ConcurrentTask::{Task, TaskTag, Taskable, task_tag};

// snake_case alias for the file-level-struct module so higher tiers can
// `use bun_event_loop::auto_flusher::{AutoFlusher, HasAutoFlusher}` without
// tripping the type/module namespace collision on the PascalCase form.
pub use AutoFlusher as auto_flusher;
pub use DeferredTaskQueue as deferred_task_queue;

pub use any_event_loop::{
    AnyEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr,
};
pub use MiniEventLoop::{EventLoopKind, PipeReadBuffer, PlatformEventLoop, PIPE_READ_BUFFER_SIZE};

#[repr(transparent)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct JsEventLoop(bun_jsc_types::event_loop::JsEventLoopHandle);

unsafe extern "Rust" {
    fn __bun_js_event_loop_iteration_number(owner: bun_jsc_types::event_loop::JsEventLoopHandle) -> u64;
    fn __bun_js_event_loop_file_polls(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> *mut bun_io::file_poll::Store;
    fn __bun_js_event_loop_put_file_poll(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
        poll: *mut bun_io::FilePoll,
        was_ever_registered: bool,
    );
    fn __bun_js_event_loop_uws_loop(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> *mut bun_uws::Loop;
    fn __bun_js_event_loop_pipe_read_buffer(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> *mut [u8];
    fn __bun_js_event_loop_tick(owner: bun_jsc_types::event_loop::JsEventLoopHandle);
    fn __bun_js_event_loop_auto_tick(owner: bun_jsc_types::event_loop::JsEventLoopHandle);
    fn __bun_js_event_loop_auto_tick_active(owner: bun_jsc_types::event_loop::JsEventLoopHandle);
    fn __bun_js_event_loop_global_object(owner: bun_jsc_types::event_loop::JsEventLoopHandle) -> *mut ();
    fn __bun_js_event_loop_bun_vm(owner: bun_jsc_types::event_loop::JsEventLoopHandle) -> *mut ();
    fn __bun_js_event_loop_stdout(owner: bun_jsc_types::event_loop::JsEventLoopHandle) -> *mut ();
    fn __bun_js_event_loop_stderr(owner: bun_jsc_types::event_loop::JsEventLoopHandle) -> *mut ();
    fn __bun_js_event_loop_current_context(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> *mut core::ffi::c_void;
    fn __bun_js_event_loop_set_current_context(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
        context: *mut core::ffi::c_void,
    ) -> *mut core::ffi::c_void;
    fn __bun_js_event_loop_restore_current_context(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
        previous: *mut core::ffi::c_void,
    );
    fn __bun_js_event_loop_enter(owner: bun_jsc_types::event_loop::JsEventLoopHandle);
    fn __bun_js_event_loop_exit(owner: bun_jsc_types::event_loop::JsEventLoopHandle);
    fn __bun_js_event_loop_enqueue_task(owner: bun_jsc_types::event_loop::JsEventLoopHandle, task: Task);
    fn __bun_js_event_loop_enqueue_task_concurrent(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
        task: *mut ConcurrentTask::ConcurrentTask,
    );
    fn __bun_js_event_loop_env(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> *mut bun_dotenv::Loader<'static>;
    fn __bun_js_event_loop_top_level_dir(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> *const [u8];
    fn __bun_js_event_loop_create_null_delimited_env_map(
        owner: bun_jsc_types::event_loop::JsEventLoopHandle,
    ) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>;
}

impl JsEventLoop {
    /// Wrap an erased `*mut bun_jsc::event_loop::EventLoop`.
    ///
    /// # Safety
    /// `ptr` must point to a live JSC event loop that outlives every dispatch
    /// through this handle.
    #[inline]
    pub unsafe fn from_raw(ptr: *mut ()) -> Self {
        Self(unsafe { bun_jsc_types::event_loop::JsEventLoopHandle::from_raw(ptr) })
    }

    #[inline]
    pub fn as_void_ptr(self) -> *mut core::ffi::c_void {
        self.0.as_void_ptr()
    }

    /// `jsc::VirtualMachine::get().event_loop()` for the current thread.
    #[inline]
    pub fn current() -> Self {
        // SAFETY: `__bun_js_event_loop_current` panics if no VM on this thread.
        unsafe { Self::from_raw(any_event_loop::__bun_js_event_loop_current()) }
    }

    #[inline]
    pub fn iteration_number(self) -> u64 {
        unsafe { __bun_js_event_loop_iteration_number(self.0) }
    }

    #[inline]
    pub fn file_polls(self) -> *mut bun_io::file_poll::Store {
        unsafe { __bun_js_event_loop_file_polls(self.0) }
    }

    #[inline]
    pub fn put_file_poll(self, poll: *mut bun_io::FilePoll, was_ever_registered: bool) {
        unsafe { __bun_js_event_loop_put_file_poll(self.0, poll, was_ever_registered) }
    }

    #[inline]
    pub fn uws_loop(self) -> *mut bun_uws::Loop {
        unsafe { __bun_js_event_loop_uws_loop(self.0) }
    }

    #[inline]
    pub fn pipe_read_buffer(self) -> *mut [u8] {
        unsafe { __bun_js_event_loop_pipe_read_buffer(self.0) }
    }

    #[inline]
    pub fn tick(self) {
        unsafe { __bun_js_event_loop_tick(self.0) }
    }

    #[inline]
    pub fn auto_tick(self) {
        unsafe { __bun_js_event_loop_auto_tick(self.0) }
    }

    #[inline]
    pub fn auto_tick_active(self) {
        unsafe { __bun_js_event_loop_auto_tick_active(self.0) }
    }

    #[inline]
    pub fn global_object(self) -> *mut () {
        unsafe { __bun_js_event_loop_global_object(self.0) }
    }

    #[inline]
    pub fn bun_vm(self) -> *mut () {
        unsafe { __bun_js_event_loop_bun_vm(self.0) }
    }

    #[inline]
    pub fn stdout(self) -> *mut () {
        unsafe { __bun_js_event_loop_stdout(self.0) }
    }

    #[inline]
    pub fn stderr(self) -> *mut () {
        unsafe { __bun_js_event_loop_stderr(self.0) }
    }

    #[inline]
    pub fn current_context(self) -> *mut core::ffi::c_void {
        unsafe { __bun_js_event_loop_current_context(self.0) }
    }

    #[inline]
    pub fn set_current_context(self, context: *mut core::ffi::c_void) -> *mut core::ffi::c_void {
        unsafe { __bun_js_event_loop_set_current_context(self.0, context) }
    }

    #[inline]
    pub fn restore_current_context(self, previous: *mut core::ffi::c_void) {
        unsafe { __bun_js_event_loop_restore_current_context(self.0, previous) }
    }

    #[inline]
    pub fn enter(self) {
        unsafe { __bun_js_event_loop_enter(self.0) }
    }

    #[inline]
    pub fn exit(self) {
        unsafe { __bun_js_event_loop_exit(self.0) }
    }

    #[inline]
    pub fn enqueue_task(self, task: Task) {
        unsafe { __bun_js_event_loop_enqueue_task(self.0, task) }
    }

    #[inline]
    pub fn enqueue_task_concurrent(self, task: *mut ConcurrentTask::ConcurrentTask) {
        unsafe { __bun_js_event_loop_enqueue_task_concurrent(self.0, task) }
    }

    #[inline]
    pub fn env(self) -> *mut bun_dotenv::Loader<'static> {
        unsafe { __bun_js_event_loop_env(self.0) }
    }

    #[inline]
    pub fn top_level_dir(self) -> *const [u8] {
        unsafe { __bun_js_event_loop_top_level_dir(self.0) }
    }
    #[inline]
    pub fn create_null_delimited_env_map(self) -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError> {
        unsafe { __bun_js_event_loop_create_null_delimited_env_map(self.0) }
    }
}
