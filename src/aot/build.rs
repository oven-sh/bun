#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Export `BUN_CODEGEN_DIR` for the tables of built-ins that `src/codegen/builtins/index.ts` writes, and for what
//! JavaScriptCore's `aot/ir/generator/index.ts` writes from the schema.

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

    for name in [
        "aot_builtin_ids.rs",
        "aot_builtin_syntax.rs",
        "aot_builtin_table.rs",
        "aot_schema.rs",
        "aot_schema_builtins.rs",
        "aot_schema_interface.rs",
    ] {
        let table = codegen_dir.join(name);
        if !table.exists() {
            panic!(
                "{name} not found at {} — run `bun bd` first",
                table.display()
            );
        }
        println!("cargo:rerun-if-changed={}", table.display());
    }

    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
