//! Hosts the JSC-tier `stdio` submodule, which depends on `Subprocess` and so
//! must stay in `bun_runtime`.

#![warn(unused_must_use)]

// NOTE: explicit #[path] required because the parent (`api.rs`) loads this file
// via `#[path = "api/bun/spawn.rs"]`, which disables the implicit `spawn/`
// submodule dir.
#[path = "spawn/stdio.rs"]
pub mod stdio;
