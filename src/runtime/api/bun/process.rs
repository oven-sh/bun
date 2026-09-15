//! `Process` / `Poller` / `WaiterThread` / `spawn_process` / `sync` belong to
//! the `bun_spawn` crate (`src/spawn/process.rs`), so that `bun_install`
//! (lifecycle scripts, security scanner, git repositories), `bun_jsc`
//! (`ProcessAutoKiller`) and `bun_patch` can spawn and track child processes
//! without a `bun_runtime → bun_install`/`bun_jsc` dependency cycle.
//!
//! This file re-exports them as `crate::api::bun_process::*`.

pub use bun_spawn::process::sync;
pub use bun_spawn::process::*;

pub use bun_spawn::process::event_loop_handle_to_ctx;
pub use bun_spawn::process::spawn_sys;
