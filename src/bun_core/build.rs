// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Export `BUN_CODEGEN_DIR` and fingerprint `build_options.rs` for
//! `include!(concat!(env!("BUN_CODEGEN_DIR"), "/build_options.rs"))`.
//!
//! `build_options.rs` is written at configure time by
//! `scripts/build/buildOptionsRs.ts` from the resolved `Config` (sha,
//! version, …). This script does NOT run the generator — it just
//! resolves the path and tells cargo to track the file so a sha/version
//! change recompiles `bun_core`. Mirrors `src/{jsc,runtime}/build.rs`.

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    // src/bun_core → repo root is two up.
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    let build_options = codegen_dir.join("build_options.rs");
    if !build_options.exists() {
        panic!(
            "build_options.rs not found at {} — run `bun bd --configure-only` first",
            build_options.display()
        );
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-changed={}", build_options.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
