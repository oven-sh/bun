//! MOVE_DOWN: the full `Process` / `Poller` / `WaiterThread` /
//! `spawn_process` / `sync` implementation now lives in the `bun_spawn`
//! workspace crate (`src/spawn/process.rs`). It was moved out of `bun_runtime`
//! so that `bun_install` (lifecycle scripts, security scanner, git
//! repositories), `bun_jsc` (`ProcessAutoKiller`), and `bun_patch` can spawn
//! and track child processes without the `bun_runtime → bun_install`/`bun_jsc`
//! dependency cycle.
//!
//! This file is a thin re-export façade so existing
//! `crate::api::bun_process::*` paths keep working.

pub use bun_spawn::process::sync;
pub use bun_spawn::process::*;

// `event_loop_handle_to_ctx` was `pub(crate)` in the original; re-export under
// `pub(crate)` here so other `bun_runtime` modules (e.g. `subprocess.rs`) can
// keep calling it via `crate::api::bun_process::event_loop_handle_to_ctx`.
pub use bun_spawn::process::event_loop_handle_to_ctx;
pub use bun_spawn::process::spawn_sys;
