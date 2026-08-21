//! `bun_bunfig` — bunfig.toml parser and `Arguments::loadConfig` entrypoints.
//!
//! Split out so that `bun_install::PackageManager::init` can call
//! `Arguments::loadConfig`
//! without a tier-6 dependency or fn-pointer hook.
//! Every dependency of this crate was already a transitive dependency of
//! `bun_install` (via `bun_transpiler` → `bun_bundler`), so no cycle is
//! introduced; this only makes the existing edge direct.

#![allow(non_snake_case)]
pub mod arguments;
pub mod bunfig;
pub mod error;

pub use arguments::{load_config, load_config_path, load_config_with_cmd_args};
pub use error::{Error, Result};
