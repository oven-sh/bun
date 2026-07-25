#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Export `BUN_CODEGEN_DIR` for `include!(concat!(env!("BUN_CODEGEN_DIR"), "/json_byte_class.rs"))`,
//! written at configure time by `scripts/build/jsonByteClass.ts`.

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    let byte_class = codegen_dir.join("json_byte_class.rs");
    if !byte_class.exists() {
        panic!(
            "json_byte_class.rs not found at {} — run `bun bd --configure-only` first",
            byte_class.display()
        );
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-changed={}", byte_class.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
