//! The `posix_spawn`(2) FFI wrappers (`Actions`, `Attr`, `spawn_z`, `wait4`)
//! and the `bun_spawn` `Action`/`Attr` structs belong to `bun_spawn_sys`
//! (`src/spawn_sys/posix_spawn.rs`), below `bun_spawn::process`, which
//! `bun_install` / `bun_jsc` use without depending on `bun_runtime`.
//!
//! This file re-exports them as `crate::api::bun_spawn::*` and holds the
//! `stdio` submodule, which needs the JSC-tier `Subprocess` type.

#![warn(unused_must_use)]

// NOTE: explicit #[path] required because the parent (`api.rs`) loads this file
// via `#[path = "api/bun/spawn.rs"]`, which disables the implicit `spawn/`
// submodule dir.
#[path = "spawn/stdio.rs"]
pub mod stdio;

pub use ::bun_spawn::posix_spawn::{bun_spawn, posix_spawn};

// `process` is re-exported from the `bun_spawn` workspace crate.
