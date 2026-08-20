//! Location of the `bun install` cache. The package manager and
//! `bun build --compile` (which downloads the executables of other targets
//! into the cache) share this so that both honor the same settings.

use bun_dotenv::Loader as DotEnvLoader;
use bun_paths::resolve_path::{join_abs_string, platform};

/// Resolves the cache directory. In order of precedence: `$BUN_INSTALL_CACHE_DIR`,
/// the configured `install.cache.dir` (`configured`), `$BUN_INSTALL/install/cache`,
/// `$XDG_CACHE_HOME/.bun/install/cache`, `$HOME/.bun/install/cache`, and
/// `node_modules/.bun-cache` when none of them is set. An empty value does not
/// select its candidate.
///
/// Each candidate is joined onto `top_level_dir`, so a relative value names a
/// directory inside the project and an absolute one is used as is.
pub fn fetch_cache_directory_path(
    top_level_dir: &[u8],
    env: &DotEnvLoader,
    configured: Option<&[u8]>,
) -> Vec<u8> {
    let abs = |parts: &[&[u8]]| join_abs_string::<platform::Loose>(top_level_dir, parts).to_vec();

    if let Some(dir) = not_empty(env.get(b"BUN_INSTALL_CACHE_DIR")) {
        return abs(&[dir]);
    }

    if let Some(dir) = not_empty(configured) {
        return abs(&[dir]);
    }

    if let Some(dir) = not_empty(env.get(b"BUN_INSTALL")) {
        return abs(&[dir, b"install/", b"cache/"]);
    }

    if let Some(dir) = bun_core::env_var::XDG_CACHE_HOME.get_not_empty() {
        return abs(&[dir, b".bun/", b"install/", b"cache/"]);
    }

    if let Some(dir) = bun_core::env_var::HOME.get_not_empty() {
        return abs(&[dir, b".bun/", b"install/", b"cache/"]);
    }

    abs(&[b"node_modules/.bun-cache"])
}

fn not_empty(value: Option<&[u8]>) -> Option<&[u8]> {
    value.filter(|value| !value.is_empty())
}
