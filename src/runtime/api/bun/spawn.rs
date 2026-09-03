//! `Bun.spawn` stdio glue; the process implementation lives in the `bun_spawn` crate.

#![warn(unused_must_use)]

// NOTE: explicit #[path] required because the parent (`api.rs`) loads this file
// via `#[path = "api/bun/spawn.rs"]`, which disables the implicit `spawn/`
// submodule dir.
#[path = "spawn/stdio.rs"]
pub mod stdio;

// `process` is re-exported from the `bun_spawn` workspace crate.
