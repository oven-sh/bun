#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::fs;
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

    let archive = codegen_dir.join("builtin_sources.bin");
    if !archive.exists() {
        panic!(
            "builtin_sources.bin not found at {} — run `bun bd` first",
            archive.display()
        );
    }
    let bytes = fs::read(&archive).expect("builtin_sources.bin can be read");
    let files = bytes.get(..4).map_or(0, |n| u32::from_le_bytes([n[0], n[1], n[2], n[3]]) as usize);
    let written_for = bytes
        .get(4..)
        .unwrap_or_default()
        .chunks_exact(1 + 63 + 4 + 4)
        .take(files)
        .filter_map(|record| record.get(1..1 + record[0] as usize))
        .find_map(|name| name.strip_prefix(b"table-"))
        .and_then(|hash| String::from_utf8(hash.to_vec()).ok());
    let table = repo.join("src/aot/builtins_generated.rs");
    let current = fs::read_to_string(&table)
        .ok()
        .and_then(|text| text.split_once("BUILTINS_HASH: u32 = 0x").and_then(|(_, rest)| rest.get(..8).map(str::to_owned)));
    if current.is_none() || written_for != current {
        panic!(
            "{} was written for the table of built-ins {}, and src/aot/builtins_generated.rs has {} — run `bun bd` again",
            archive.display(),
            written_for.as_deref().unwrap_or("of an older format"),
            current.as_deref().unwrap_or("none"),
        );
    }
    println!("cargo:rerun-if-changed={}", archive.display());
    println!("cargo:rerun-if-changed={}", table.display());
    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
}
