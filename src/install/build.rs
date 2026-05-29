// Build scripts run on the host before bun_* crates are compiled; std is the only option.
#![allow(
    clippy::disallowed_methods,
    clippy::disallowed_types,
    clippy::disallowed_macros
)]

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

    if env::var("CARGO_CFG_WINDOWS").is_ok() {
        let exe = manifest.join("windows-shim").join("bun_shim_impl.exe");
        if !exe.exists() {
            fs::write(&exe, [])
                .unwrap_or_else(|e| panic!("failed to create {}: {e}", exe.display()));
        }
        println!("cargo:rerun-if-changed={}", exe.display());
    }
}
