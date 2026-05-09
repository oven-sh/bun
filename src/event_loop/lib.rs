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
pub use MiniEventLoop::{EventLoopKind, PlatformEventLoop};
