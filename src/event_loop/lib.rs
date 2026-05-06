#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod AutoFlusher;
pub mod AnyTask;
pub mod ManagedTask;
pub mod DeferredTaskQueue;
pub mod AnyTaskWithExtraContext;
pub mod ConcurrentTask;
pub mod EventLoopTimer;

// ────────────────────────────────────────────────────────────────────────────
// B-2 un-gated: AnyEventLoop / SpawnSyncEventLoop / MiniEventLoop compile.
// Un-gated this pass: DeferredTaskQueue::run, MiniEventLoop::{stdout,stderr},
// EventLoopHandle::create_null_delimited_env_map, both put_file_poll (via new
// MINI_EVENT_LOOP_CTX_VTABLE adapter), AnyEventLoop::{tick,tick_once}.
// Function bodies that touch still-gated lower-tier surface — bun_uws::Loop
// methods/fields (the bun_uws_sys::Loop module is itself `#[cfg(any())]`-gated,
// so Loop is opaque) and bun_core::Timespec — remain individually re-gated
// with `// TODO(b2-blocked):` markers.
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

pub use AnyTask::JsResult;
pub use ConcurrentTask::{Task, TaskTag, task_tag};

pub use any_event_loop::{
    AnyEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr, JsEventLoopVTable,
};
pub use MiniEventLoop::{EventLoopKind, PlatformEventLoop, MINI_EVENT_LOOP_CTX_VTABLE};
