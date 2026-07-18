// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! §8 Step 13.3: track `#[path]`-mounted source dirs outside CARGO_MANIFEST_DIR.

fn main() {
    for dir in [
        "which",
        "perf",
        "platform",
        "threading",
        "spawn_sys",
        "glob",
        "watcher",
        "libarchive",
        "zlib",
        "zlib_sys",
        "zstd",
        "brotli",
        "brotli_sys",
        "libdeflate_sys",
        "tcc_sys",
        "cares_sys",
        "dns",
        "crash_handler",
    ] {
        println!("cargo:rerun-if-changed=../{dir}/");
    }
}
