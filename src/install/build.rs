// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    // Keep an explicit rerun set; cargo otherwise reruns this on any crate change.
    println!("cargo:rerun-if-changed=build.rs");

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
        let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        let exe = manifest.join("windows-shim").join("bun_shim_impl.exe");
        if !exe.exists() {
            fs::write(&exe, [])
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", exe.display()));
        }
        println!("cargo:rerun-if-changed={}", exe.display());
    }
}
