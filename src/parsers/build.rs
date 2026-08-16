#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Export `BUN_CODEGEN_DIR` for the `include!`d byte-class tables written at configure time by
//! `scripts/build/{json,xml}ByteClass.ts`.

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

    for name in ["json_byte_class.rs", "xml_byte_class.rs"] {
        let byte_class = codegen_dir.join(name);
        if !byte_class.exists() {
            panic!(
                "{name} not found at {} — run `bun bd --configure-only` first",
                byte_class.display()
            );
        }
        println!("cargo:rerun-if-changed={}", byte_class.display());
    }

    // cfgs `scripts/bench-json-rust.sh` sets when the comparison C libraries are available.
    println!("cargo:rustc-check-cfg=cfg(pugixml)");
    println!("cargo:rustc-check-cfg=cfg(expat)");
    println!("cargo:rustc-check-cfg=cfg(libxml2)");
    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
