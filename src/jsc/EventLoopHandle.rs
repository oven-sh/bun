//! `jsc.EventLoopHandle` — non-owning reference to either the JS event loop or
//! the mini event loop.
//!
//! LAYERING: the Zig spec (`src/jsc/EventLoopHandle.zig`) lives
//! under `jsc` and reaches freely into `jsc.EventLoop`, `jsc.VirtualMachine`,
//! and `bun_runtime::webcore::Blob::Store`. In Rust that is a hard dep cycle:
//! `bun_runtime → bun_jsc`, and many tier-≤4 crates (`bun_install`,
//! `bun_spawn`, `bun_shell`) need `EventLoopHandle` without pulling in
//! `bun_jsc`. The type was therefore MOVED DOWN to
//! [`bun_event_loop::any_event_loop`] (`src/event_loop/AnyEventLoop.rs`),
//! where the `.js` arm holds an erased `*mut ()` and dispatches through a
//! link-time `extern "Rust"` shims defined in `bun_jsc::event_loop`.
//!
//! This module is the thin shim that keeps the `bun_jsc::event_loop_handle`
//! path (and the `jsc.EventLoopHandle` namespace shape) compiling. All
//! behaviour lives in the lower crate; nothing here owns logic.
//!
//! Spec mapping (EventLoopHandle.zig → bun_event_loop::any_event_loop):
//!   `globalObject`                → `EventLoopHandle::global_object` (erased ptr)
//!   `bunVM`                       → `EventLoopHandle::bun_vm` (erased ptr)
//!   `stdout` / `stderr`           → `EventLoopHandle::{stdout,stderr}` (erased ptr)
//!   `enter` / `exit`              → `EventLoopHandle::{enter,exit}` / `entered`
//!   `init(anytype)`               → `EventLoopHandle::{init,init_mini,from_any,js_current}`
//!   `filePolls` / `putFilePoll`   → `EventLoopHandle::{file_polls,put_file_poll}`
//!   `enqueueTaskConcurrent`       → `EventLoopHandle::enqueue_task_concurrent`
//!   `loop` / `platformEventLoop`  → `EventLoopHandle::{loop_,platform_event_loop}`
//!   `pipeReadBuffer`              → `EventLoopHandle::pipe_read_buffer`
//!   `ref` / `unref`               → `EventLoopHandle::{ref_,unref}`
//!   `createNullDelimitedEnvMap`   → `EventLoopHandle::create_null_delimited_env_map`
//!   `topLevelDir` / `env`         → `EventLoopHandle::{top_level_dir,env}`
//!   `cast(tag)`                   → callers pattern-match on the enum directly
//!   `allocator`                   → dropped per PORTING.md §Allocators (non-AST crate)
//!   `EventLoopTask` / `EventLoopTaskPtr` → re-exported verbatim

pub use bun_event_loop::any_event_loop::{
    EnteredEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr,
};

// ported from: src/jsc/EventLoopHandle.zig
