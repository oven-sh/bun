//! Set BUN_CODEGEN_DIR for `include!(concat!(env!("BUN_CODEGEN_DIR"), "/generated_classes.rs"))`.
//!
//! The codegen output lives at `<repo>/build/<profile>/codegen/` and is
//! produced by `src/codegen/generate-classes.ts` (run as part of `bun bd`).
//! This build script just resolves and exports the path; it does NOT run the
//! generator (that would create a Bun→cargo→Bun bootstrap loop).

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    // src/runtime → repo root is two up.
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

    let gen_rs = codegen_dir.join("generated_classes.rs");
    if !gen_rs.exists() {
        panic!(
            "generated_classes.rs not found at {} — run `bun src/codegen/generate-classes.ts` (or `bun bd`) first",
            gen_rs.display()
        );
    }

    let gen_js2native_rs = codegen_dir.join("generated_js2native.rs");
    if !gen_js2native_rs.exists() {
        panic!(
            "generated_js2native.rs not found at {} — run `bun bd` (bundle-modules codegen) first",
            gen_js2native_rs.display()
        );
    }

    let gen_jssink_rs = codegen_dir.join("generated_jssink.rs");
    if !gen_jssink_rs.exists() {
        panic!(
            "generated_jssink.rs not found at {} — run `bun src/codegen/generate-jssink.ts` (or `bun bd`) first",
            gen_jssink_rs.display()
        );
    }

    let gen_host_exports_rs = codegen_dir.join("generated_host_exports.rs");
    if !gen_host_exports_rs.exists() {
        panic!(
            "generated_host_exports.rs not found at {} — run `bun src/codegen/generate-host-exports.ts {}` (or `bun bd`) first",
            gen_host_exports_rs.display(),
            codegen_dir.display(),
        );
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-changed={}", gen_rs.display());
    println!("cargo:rerun-if-changed={}", gen_js2native_rs.display());
    println!("cargo:rerun-if-changed={}", gen_jssink_rs.display());
    println!("cargo:rerun-if-changed={}", gen_host_exports_rs.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
