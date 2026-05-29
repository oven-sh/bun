#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod AnyTask;
pub mod AnyTaskWithExtraContext;
pub mod AutoFlusher;
pub mod ConcurrentTask;
pub mod DeferredTaskQueue;
pub mod EventLoopTimer;
pub mod ManagedTask;

#[path = "MiniEventLoop.rs"]
pub mod MiniEventLoop;
#[path = "SpawnSyncEventLoop.rs"]
pub mod SpawnSyncEventLoop;
#[path = "AnyEventLoop.rs"]
pub mod any_event_loop;

// ─── public surface ─────────────────────────────────────────────────────────

pub use AnyTask::{ErasedJsError, JsResult};
pub use ConcurrentTask::{Task, TaskTag, Taskable, task_tag};

// snake_case alias for the file-level-struct module so higher tiers can
// `use bun_event_loop::auto_flusher::{AutoFlusher, HasAutoFlusher}` without
// tripping the type/module namespace collision on the PascalCase form.
pub use AutoFlusher as auto_flusher;
pub use DeferredTaskQueue as deferred_task_queue;

pub use MiniEventLoop::{EventLoopKind, PIPE_READ_BUFFER_SIZE, PipeReadBuffer, PlatformEventLoop};
pub use any_event_loop::{AnyEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr};

bun_dispatch::link_interface! {
    pub JsEventLoop[Jsc] {
        fn iteration_number() -> u64;
        fn file_polls() -> *mut bun_io::file_poll::Store;
        fn put_file_poll(poll: *mut bun_io::FilePoll, was_ever_registered: bool);
        fn uws_loop() -> *mut bun_uws::Loop;
        fn pipe_read_buffer() -> *mut [u8];
        fn tick();
        fn auto_tick();
        fn auto_tick_active();
        fn global_object() -> *mut ();
        fn bun_vm() -> *mut ();
        fn stdout() -> *mut ();
        fn stderr() -> *mut ();
        fn enter();
        fn exit();
        fn enqueue_task(task: Task);
        fn enqueue_task_concurrent(task: core::ptr::NonNull<ConcurrentTask::ConcurrentTask>);
        fn env() -> *mut bun_dotenv::Loader<'static>;
        fn top_level_dir() -> *const [u8];
        fn create_null_delimited_env_map() -> Result<bun_dotenv::NullDelimitedEnvMap, bun_core::AllocError>;
    }
}

impl JsEventLoop {
    /// `jsc::VirtualMachine::get().event_loop()` for the current thread.
    #[inline]
    pub fn current() -> Self {
        // SAFETY: `__bun_js_event_loop_current` returns the live per-thread
        // `jsc::EventLoop` (panics if none), so the `link_interface!` owner
        // invariant for `Self::new` is upheld for every dispatch on this handle.
        unsafe {
            Self::new(
                JsEventLoopKind::Jsc,
                any_event_loop::__bun_js_event_loop_current(),
            )
        }
    }
}
