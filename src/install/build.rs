// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]
//! Generates the sorted `DEFAULT_TRUSTED_DEPENDENCIES_LIST` slice from
//! `default-trusted-dependencies.txt`.
//!
//! Rust cannot tokenize/sort at const time without a build script, so we
//! emit a `&[&[u8]]` literal here and `include!` it from `lockfile.rs`.

use std::env;
use std::fmt::Write as _;
use std::fs;
use std::path::PathBuf;

const MAX_DEFAULT_TRUSTED_DEPENDENCIES: usize = 512;

fn main() {
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let txt = manifest.join("default-trusted-dependencies.txt");
    println!("cargo:rerun-if-changed={}", txt.display());

    let data = fs::read_to_string(&txt)
        .unwrap_or_else(|e| panic!("failed to read {}: {e}", txt.display()));

    let mut names: Vec<&str> = data
        .split([' ', '\r', '\n', '\t'])
        .filter(|s| !s.is_empty())
        .collect();

    // Alphabetical byte-wise sort so `bun pm trusted --default` doesn't need to sort.
    names.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    assert!(
        names.len() <= MAX_DEFAULT_TRUSTED_DEPENDENCIES,
        "default-trusted-dependencies.txt is too large, please increase \
         'MAX_DEFAULT_TRUSTED_DEPENDENCIES' in lockfile.rs"
    );
    #[allow(
        clippy::disallowed_methods,
        reason = "adjacent-pair check, not a byte search"
    )]
    for w in names.windows(2) {
        assert!(w[0] != w[1], "Duplicate trusted dependency: {}", w[0]);
    }

    let mut out = String::from("&[\n");
    for name in &names {
        // Package names are plain ASCII (npm scope/name charset); emit as b"..".
        debug_assert!(
            name.bytes()
                .all(|b| b.is_ascii() && b != b'"' && b != b'\\')
        );
        writeln!(out, "    b\"{name}\",").unwrap();
    }
    out.push_str("]\n");

    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());
    fs::write(out_dir.join("default_trusted_dependencies_list.rs"), out)
        .expect("write default_trusted_dependencies_list.rs");

    // ── Windows .bin/ shim PE ───────────────────────────────────────────────
    // `BinLinkingShim.rs` does
    // `include_bytes!(concat!(env!("BUN_CODEGEN_DIR"), "/bun-shim-impl.exe"))`
    // on Windows. The build system builds the shim into the codegen directory
    // *before* any edge of this package runs — but a bare `cargo check` run
    // outside the build system has no such step. Create a 0-byte placeholder
    // so compilation succeeds; `embedded_executable_data()` asserts non-empty
    // at runtime so a placeholder can never silently ship.
    //
    // Same resolution as `bun_runtime`'s build script: the build system sets
    // BUN_CODEGEN_DIR; bare cargo defaults to the debug profile's directory.
    let repo = manifest
        .parent()
        .and_then(|p| p.parent())
        .expect("repo root from CARGO_MANIFEST_DIR");
    let codegen_dir = env::var("BUN_CODEGEN_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug/codegen"));
    println!("cargo:rustc-env=BUN_CODEGEN_DIR={}", codegen_dir.display());
    println!("cargo:rerun-if-env-changed=BUN_CODEGEN_DIR");
    if env::var("CARGO_CFG_WINDOWS").is_ok() {
        let exe = codegen_dir.join("bun-shim-impl.exe");
        if !exe.exists() {
            fs::create_dir_all(&codegen_dir)
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", codegen_dir.display()));
            fs::write(&exe, [])
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", exe.display()));
        }
        // build.rs's own `rerun-if-changed` set replaces the default "rerun
        // on any source change" heuristic, so list the embed explicitly.
        println!("cargo:rerun-if-changed={}", exe.display());
    }
}
