//! Set BUN_CODEGEN_DIR for `include!(concat!(env!("BUN_CODEGEN_DIR"), "/cpp.rs"))`.
//!
//! The codegen output lives at `<repo>/build/<profile>/codegen/` and is produced by
//! `src/codegen/cppbind.ts` (run as part of `bun bd`). This build script just
//! resolves and exports the path; it does NOT run the generator (that would
//! create a Bun→cargo→Bun bootstrap loop).
//!
//! Mirrors `src/runtime/build.rs` so `cargo check -p bun_jsc` (and `--workspace`)
//! works without a manually-exported `BUN_CODEGEN_DIR`.

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

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-changed={}", cpp_rs.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
