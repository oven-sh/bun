// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Set BUN_CODEGEN_DIR for the `include!`s in src/appkit/objc/mod.rs of the
//! tables scripts/appkit-generate.ts writes from the macOS SDK at build time
//! (`<codegen dir>/appkit/sdk.rs` and `cf.rs`). Resolves and exports the
//! path only; the generator runs from the build (scripts/build/codegen.ts),
//! never from here.

use std::env;
use std::path::{Path, PathBuf};

fn main() {
    // src/appkit → repo root is two up.
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));

    // The crate body is `#![cfg(target_os = "macos")]`: no other target reads the tables.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        for name in ["sdk.rs", "cf.rs"] {
            let table = codegen_dir.join("appkit").join(name);
            if !table.exists() {
                panic!(
                    "{} not found — run `bun bd` (scripts/appkit-generate.ts --out) first",
                    table.display()
                );
            }
            println!("cargo:rerun-if-changed={}", table.display());
        }
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
