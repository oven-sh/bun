//! MOVE_DOWN: the `posix_spawn`(2) FFI wrappers (`Actions`, `Attr`, `spawn_z`,
//! `wait4`) and the `bun_spawn` `Action`/`Attr` structs now live in the
//! `bun_spawn` workspace crate (`src/spawn/posix_spawn.rs`). They were moved
//! out of `bun_runtime` so that `bun_spawn::process` (which `bun_install` /
//! `bun_jsc` depend on) can call them without a `bun_runtime` dependency.
//!
//! This file re-exports them for existing `crate::api::bun_spawn::*` paths and
//! keeps the `stdio` submodule (which depends on the JSC-tier `Subprocess`
//! type and so must stay in `bun_runtime`).

#![allow(unused_imports, dead_code)]
#![warn(unused_must_use)]

// child module: src/runtime/api/bun/spawn/stdio.zig
// NOTE: explicit #[path] required because the parent (`api.rs`) loads this file
// via `#[path = "api/bun/spawn.rs"]`, which disables the implicit `spawn/`
// submodule dir.
#[path = "spawn/stdio.rs"]
pub mod stdio;

pub use ::bun_spawn::posix_spawn::{BunSpawn, PosixSpawn, bun_spawn, posix_spawn};

// sibling module: src/runtime/api/bun/process.zig — now re-exported from the
// `bun_spawn` workspace crate.
use super::bun_process as process;
