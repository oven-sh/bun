#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
pub mod AnyTaskWithExtraContext;
pub mod ConcurrentTask;
pub mod DeferredTaskQueue;
pub mod EventLoopTimer;
pub mod ManagedTask;

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
// associated fns (`::init()`, `::js_current()`, `::as_handle()`), never as a
// module path, so the snake_case module name is internal.
#[path = "SpawnSyncEventLoop.rs"]
pub mod SpawnSyncEventLoop;
#[path = "AnyEventLoop.rs"]
pub mod any_event_loop;

// ─── scoped event-loop runs ──────────────────────────────────────────────────
// The run driver lives in `bun_runtime::domain_run` (it needs the timer heap
// and the VM); the one piece of state lower tiers need — which run is innermost
// on this thread — is mirrored here so `Task` stamping and the gates are a
// single TLS load with no upward call.
thread_local! {
    static ACTIVE_RUN_DOMAIN: core::cell::Cell<u32> = const { core::cell::Cell::new(0) };
    static IS_JS_THREAD: core::cell::Cell<bool> = const { core::cell::Cell::new(false) };
}

/// The innermost scoped event-loop run's domain on this thread; 0 when none.
#[inline]
pub fn active_run_domain() -> u32 {
    ACTIVE_RUN_DOMAIN.get()
}

/// `bun_runtime::domain_run` only: entering/exiting a run.
#[inline]
pub fn set_active_run_domain(domain: u32) {
    ACTIVE_RUN_DOMAIN.set(domain)
}

/// This thread owns a JS VM (main thread or a Worker): work it creates while no
/// scoped run is active belongs to the *root* domain rather than to nobody.
#[inline]
pub fn mark_js_thread() {
    IS_JS_THREAD.set(true)
}

/// A [`Task`] stamped with this was created by root-domain code on a JS thread
/// (as opposed to 0: created off-thread, provenance unknown). During a scoped
/// run it is foreign like any other domain's; outside one it is nothing special.
pub const ROOT_TASK_DOMAIN: u32 = u32::MAX;

/// What a task created right now, on this thread, is attributed to: the active
/// run's domain; else the root domain on a JS thread; else 0 (unknown — such a
/// task is admitted by any run, since its observable continuations are
/// microtasks, which are gated).
#[inline]
pub fn current_task_domain() -> u32 {
    match ACTIVE_RUN_DOMAIN.get() {
        0 if IS_JS_THREAD.get() => ROOT_TASK_DOMAIN,
        domain => domain,
    }
}

// ─── public surface ─────────────────────────────────────────────────────────

pub type JsResult<T> = core::result::Result<T, bun_core::JsError>;
pub use ConcurrentTask::{Task, TaskTag, Taskable, task_tag};

// snake_case alias for the file-level-struct module so higher tiers avoid
// the type/module namespace collision on the PascalCase form.
pub use DeferredTaskQueue as deferred_task_queue;

pub use MiniEventLoop::PipeReadBuffer;
pub use any_event_loop::{
    AnyEventLoop, EventLoopHandle, EventLoopTask, JsPoster, JsPosterVTable, Posted,
};

// JS-event-loop arm of `AnyEventLoop` / `EventLoopHandle`. `bun_event_loop` is
// a lower tier than `bun_jsc`, so it cannot name `jsc::EventLoop` /
// `jsc::VirtualMachine` directly. Owner is an erased `*mut jsc::EventLoop`;
// `bun_jsc::event_loop` provides the `Jsc` arm.
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
