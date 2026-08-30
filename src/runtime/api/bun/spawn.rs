//! The `posix_spawn`(2) FFI wrappers live in the `bun_spawn_sys` crate and the
//! `Process` glue in `bun_spawn`. This file keeps the `stdio` submodule, which
//! depends on the JSC-tier `Subprocess` type and so must stay in `bun_runtime`.

#![warn(unused_must_use)]

// NOTE: explicit #[path] required because the parent (`api.rs`) loads this file
// via `#[path = "api/bun/spawn.rs"]`, which disables the implicit `spawn/`
// submodule dir.
#[path = "spawn/stdio.rs"]
pub mod stdio;

// `process` is re-exported from the `bun_spawn` workspace crate.
