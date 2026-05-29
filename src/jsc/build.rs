// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    // src/jsc → repo root is two up.
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    // Allow override; default to debug profile codegen dir.
    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    let cpp_rs = codegen_dir.join("cpp.rs");
    if !cpp_rs.exists() {
        panic!(
            "cpp.rs not found at {} — run `bun src/codegen/cppbind.ts` (or `bun bd`) first",
            cpp_rs.display()
        );
    }

    let resolved_source_tag_rs = codegen_dir.join("generated_resolved_source_tag.rs");
    if !resolved_source_tag_rs.exists() {
        panic!(
            "generated_resolved_source_tag.rs not found at {} — run `bun bd` (bundle-modules codegen) first",
            resolved_source_tag_rs.display()
        );
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-changed={}", cpp_rs.display());
    println!(
        "cargo:rerun-if-changed={}",
        resolved_source_tag_rs.display()
    );
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
