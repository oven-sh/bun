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
// Function bodies that touch still-gated lower-tier surface (bun_uws::Loop
// methods, bun_core::Timespec, bun_core::Output::DescriptorType,
// bun_dotenv::Map::create_null_delimited_env_map, bun_aio EventLoopCtx
// adapter) are individually re-gated with `// TODO(b2-blocked):` markers.
// ────────────────────────────────────────────────────────────────────────────

#[path = "MiniEventLoop.rs"]
pub mod MiniEventLoop;
#[path = "AnyEventLoop.rs"]
pub mod AnyEventLoop;
#[path = "SpawnSyncEventLoop.rs"]
pub mod SpawnSyncEventLoop;

// ─── public surface ─────────────────────────────────────────────────────────

pub use AnyTask::JsResult;
pub use ConcurrentTask::{Task, TaskTag, task_tag};

pub use AnyEventLoop::{EventLoopHandle, EventLoopTask, EventLoopTaskPtr, JsEventLoopVTable};
pub use MiniEventLoop::{EventLoopKind, PlatformEventLoop};
