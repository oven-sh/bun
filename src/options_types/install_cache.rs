use bun_core::env_var;
use bun_dotenv::Loader;
use bun_paths::resolve_path::{join_abs_string, platform};

/// The `bun install` package cache directory, absolute.
pub fn fetch_cache_directory_path(
    env: &Loader,
    cache_directory_override: Option<&[u8]>,
) -> Vec<u8> {
    let top = bun_paths::fs::FileSystem::instance().top_level_dir();
    let abs = |parts: &[&[u8]]| join_abs_string::<platform::Loose>(top, parts).to_vec();

    if let Some(dir) = env.get(b"BUN_INSTALL_CACHE_DIR") {
        return abs(&[dir]);
    }

    if let Some(dir) = cache_directory_override.filter(|d| !d.is_empty()) {
        return abs(&[dir]);
    }

    if let Some(dir) = env.get(b"BUN_INSTALL") {
        return abs(&[dir, b"install/", b"cache/"]);
    }

    if let Some(dir) = env_var::XDG_CACHE_HOME.get() {
        return abs(&[dir, b".bun/", b"install/", b"cache/"]);
    }

    if let Some(dir) = env_var::HOME.get() {
        return abs(&[dir, b".bun/", b"install/", b"cache/"]);
    }

    abs(&[b"node_modules/.bun-cache"])
}
