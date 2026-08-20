//! The `bun install` cache directory, shared with `bun build --compile`, which downloads other targets into it.

use bun_dotenv::Loader as DotEnvLoader;
use bun_paths::resolve_path::{join_abs_string, platform};

/// `configured` is the bunfig `install.cache.dir`. Every candidate is joined onto `top_level_dir`; an empty one is skipped.
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
