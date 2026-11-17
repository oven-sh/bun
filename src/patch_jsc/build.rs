// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Export `BUN_CODEGEN_DIR` for `generated_bindgen.rs`, which `include!`s what `src/codegen/bindgen.ts` writes.

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

    let generated = codegen_dir.join("generated_bindgen_bun_patch_jsc.rs");
    if !generated.exists() {
        panic!(
            "generated_bindgen_bun_patch_jsc.rs not found at {} — run `bun bd` first",
            generated.display()
        );
    }

    println!("cargo:rerun-if-changed={}", generated.display());
    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
