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

/// Which bunfig file a value comes from.
///
/// A project `bunfig.toml` is part of a checkout, so it is no more trusted
/// than the rest of the tree. Keys that point Bun at a machine-global write
/// location are accepted from [`ConfigScope::User`] only.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub enum ConfigScope {
    /// `$XDG_CONFIG_HOME/.bunfig.toml`, `$HOME/.bunfig.toml`, or the path the
    /// user passed to `--config`.
    User,
    /// The `bunfig.toml` that Bun discovers next to the project.
    Project,
}
