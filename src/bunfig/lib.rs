//! `bun_bunfig` — bunfig.toml parser and `Arguments::loadConfig` entrypoints.
//!
//! Split out so that `bun_install::PackageManager::init` can call
//! `Arguments::loadConfig`
//! without a tier-6 dependency or fn-pointer hook.

pub mod arguments;
pub mod bunfig;
pub mod error;

pub use arguments::{
    Above, ToolReader, load_config, load_config_above_for_tool, load_config_for_tool,
    load_config_path, load_config_with_cmd_args,
};
pub use error::{Error, Result};
