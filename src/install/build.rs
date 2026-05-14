//! Generates the sorted `DEFAULT_TRUSTED_DEPENDENCIES_LIST` slice from
//! `default-trusted-dependencies.txt`.
//!
//! Zig builds this at comptime via `@embedFile` + tokenize + sort
//! (see `src/install/lockfile.zig`). Rust cannot tokenize/sort at const time
//! without a build script, so we emit a `&[&[u8]]` literal here and `include!`
//! it from `lockfile.rs`.

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

    // Zig: std.mem.tokenizeAny(u8, data, " \r\n\t")
    let mut names: Vec<&str> = data
        .split([' ', '\r', '\n', '\t'])
        .filter(|s| !s.is_empty())
        .collect();

    // Zig: alphabetical sort so `bun pm trusted --default` doesn't need to sort.
    // std.mem.order(u8, ..) == .lt  ↔  byte-wise ordering.
    names.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));

    assert!(
        names.len() <= MAX_DEFAULT_TRUSTED_DEPENDENCIES,
        "default-trusted-dependencies.txt is too large, please increase \
         'MAX_DEFAULT_TRUSTED_DEPENDENCIES' in lockfile.rs"
    );
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
    // `BinLinkingShim.rs` does `include_bytes!("bun_shim_impl.exe")` on
    // Windows. The real PE is produced by a separate `cargo build -p
    // bun_shim_impl` step (scripts/build/rust.ts) *before* this crate compiles
    // — but a bare `cargo check` run outside the build system has no such step,
    // and the file is git-ignored. Create a 0-byte placeholder so compilation
    // succeeds; `embedded_executable_data()` asserts non-empty at runtime so a
    // placeholder can never silently ship.
    //
    // `rerun-if-changed` is the load-bearing line: it makes cargo recompile
    // this crate when the build system overwrites the placeholder with the
    // real PE (rustc's dep-info would also catch it, but build.rs's own
    // `rerun-if-changed` set replaces the default "rerun on any source change"
    // heuristic, so we must list it explicitly).
    if env::var("CARGO_CFG_WINDOWS").is_ok() {
        let exe = manifest.join("windows-shim").join("bun_shim_impl.exe");
        if !exe.exists() {
            fs::write(&exe, [])
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", exe.display()));
        }
        println!("cargo:rerun-if-changed={}", exe.display());
    }
}
