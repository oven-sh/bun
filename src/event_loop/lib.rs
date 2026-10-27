#![allow(non_snake_case)]
#![warn(unused_must_use)]
pub mod AnyTaskWithExtraContext;
pub mod ConcurrentTask;
pub mod DeferredTaskQueue;
pub mod EventLoopTimer;

// ────────────────────────────────────────────────────────────────────────────
// AnyEventLoop / SpawnSyncEventLoop / MiniEventLoop.
// The parent event loop is wired via the lower-tier `set_parent_raw(tag, ptr)`
// + `EventLoopHandle::into_tag_ptr()`. The Windows-only `uv_loop` projection
// lives on `EventLoopHandle::uv_loop` (`#[cfg(windows)]`); the POSIX build is
// gate-free.
// ────────────────────────────────────────────────────────────────────────────

#[path = "MiniEventLoop.rs"]
pub mod MiniEventLoop;
// Module renamed `any_event_loop` so the *type* `AnyEventLoop` can be re-exported
// at crate root without colliding (modules and types share the type namespace).
// Downstream callers use `bun_event_loop::AnyEventLoop` as a type / for
// associated fns (`::init()`, `::js_current()`), never as a
// module path, so the snake_case module name is internal.
#[path = "AnyEventLoop.rs"]
pub mod any_event_loop;

// ─── public surface ─────────────────────────────────────────────────────────

pub type JsResult<T> = core::result::Result<T, bun_core::JsError>;
pub use ConcurrentTask::{ContextId, Task, TaskTag, Taskable, task_tag};

// snake_case alias for the file-level-struct module so higher tiers avoid
// the type/module namespace collision on the PascalCase form.
pub use DeferredTaskQueue as deferred_task_queue;

pub use any_event_loop::{
    AnyEventLoop, EventLoopHandle, EventLoopTask, JsPoster, JsPosterVTable, LoopWaker, Posted,
    Poster,
};
pub use bun_io::PipeReadScratch;

// JS-event-loop arm of `AnyEventLoop` / `EventLoopHandle`. `bun_event_loop` is
// a lower tier than `bun_jsc`, so it cannot name `jsc::EventLoop` /
// `jsc::VirtualMachine` directly. Owner is an erased `*mut jsc::EventLoop`;
// `bun_jsc::event_loop` provides the `Jsc` arm.
bun_dispatch::link_interface! {
    pub JsEventLoop[Jsc] {
        // Changes when the loop runs a task, a timer, or I/O, but not when it drains microtasks.
        fn iteration_number() -> u64;
        fn file_polls() -> *mut bun_io::file_poll::Store;
        fn put_file_poll(poll: *mut bun_io::FilePoll, was_ever_registered: bool);
        fn uws_loop() -> *mut bun_uws::Loop;
        fn event_loop_ctx() -> bun_io::EventLoopCtx;
        fn tick();
        fn auto_tick();
        fn auto_tick_active();
        fn global_object() -> *mut ();
        fn stdout() -> *mut ();
        fn stderr() -> *mut ();
        fn enter();
        fn exit();
        fn enqueue_task(task: Task);
        fn enqueue_task_after_yield(task: Task);
        fn js_poster() -> any_event_loop::JsPoster;
        fn env() -> *mut bun_dotenv::Loader;
        fn top_level_dir() -> *const [u8];
        fn create_null_delimited_env_map() -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>;
    }
}

impl JsEventLoop {
    /// `jsc::VirtualMachine::get().event_loop()` for the current thread.
    #[inline]
    pub(crate) fn current() -> Self {
        // SAFETY: `__bun_js_event_loop_current` returns the live per-thread
        // `jsc::EventLoop` (panics if none). The handle is `!Send`, and whoever
        // frees this thread's VM and loop promises that nothing here uses them
        // again.
        unsafe {
            Self::new(
                JsEventLoopKind::Jsc,
                any_event_loop::__bun_js_event_loop_current(),
            )
        }
    }
}
