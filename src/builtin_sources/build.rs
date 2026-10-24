#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    if env::var_os("CARGO_FEATURE_LINKED_ARCHIVE").is_some() {
        println!("cargo:rerun-if-changed=build.rs");
        return;
    }

    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    let archive = codegen_dir.join("builtin_sources.bin");
    if !archive.exists() {
        panic!(
            "builtin_sources.bin not found at {} — run `bun bd` first",
            archive.display()
        );
    }
    println!("cargo:rerun-if-changed={}", archive.display());
    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
