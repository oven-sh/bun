//! Export `BUN_CODEGEN_DIR` to rustc so `include!(concat!(env!("BUN_CODEGEN_DIR"), …))`
//! resolves under plain `cargo check`/rust-analyzer (the ninja edge already sets it).
//! Same shape as `src/runtime/build.rs`; if a third crate needs this, extract a
//! shared `[build-dependencies]` helper instead of pasting again.

use std::env;
use std::path::PathBuf;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest.parent().and_then(|p| p.parent()).expect("repo root").to_path_buf();
    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    let generated = codegen_dir.join("defines_table_generated.rs");
    if !generated.exists() {
        panic!(
            "{} not found — run `bun bd` (or `ninja -C build/debug codegen/defines_table_generated.rs`) first",
            generated.display()
        );
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-changed={}", generated.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
