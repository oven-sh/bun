#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Export `BUN_CODEGEN_DIR` for what JavaScriptCore's `aot/ir/generator/index.ts` writes from the schema.

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    let schema = codegen_dir.join("aot_schema_interface.rs");
    if !schema.exists() {
        panic!(
            "aot_schema_interface.rs not found at {} — run `bun bd` first",
            schema.display()
        );
    }
    println!("cargo:rerun-if-changed={}", schema.display());

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
