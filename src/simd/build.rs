//! Tells src/simd/lib.rs which compiler makes the code.
#![allow(clippy::disallowed_methods, clippy::disallowed_types, clippy::disallowed_macros)]
#![forbid(unsafe_code)]
use std::{env, process::Command};

/// For llvm/llvm-project#205113.
fn is_recent(version: &str) -> bool {
    version.split('.').next().and_then(|it| it.parse().ok()).is_some_and(|major: u32| major >= 23)
}

fn llvm(mut rustc: Command) -> String {
    let about = rustc.arg("-Cllvm-args=--version").output().map(|it| it.stdout).unwrap_or_default();
    let about = String::from_utf8_lossy(&about);
    about.lines().find_map(|line| line.trim().strip_prefix("LLVM version ")).unwrap_or("unknown").into()
}

fn main() {
    println!(r#"cargo::rustc-check-cfg=cfg(halves, bun_simd_check, bun_simd_misfits_panic)"#);
    println!(r#"cargo::rustc-check-cfg=cfg(bun_simd_misfits_where, bun_simd_no_known, bun_simd_recent_llvm)"#);
    println!(r#"cargo::rustc-check-cfg=cfg(bun_simd_all_branches, bun_simd_sve_fill, bun_simd_unoptimized)"#);
    println!(r#"cargo::rustc-check-cfg=cfg(bun_simd_sanitize, values(any()))"#);
    println!(r#"cargo::rustc-check-cfg=cfg(bun_simd_native, values("16", "32", "64"))"#);
    let var = |name| env::var(name).unwrap_or_default();
    for name in ["RUSTC", "CARGO_BUILD_RUSTC", "RUSTUP_TOOLCHAIN"] {
        println!("cargo::rerun-if-env-changed={name}");
    }
    let rustc = || Command::new(env::var_os("RUSTC").unwrap_or_default());
    let flags = var("CARGO_ENCODED_RUSTFLAGS").replace('_', "-");
    // Miri makes no code.
    if env::var_os("CARGO_CFG_MIRI").is_none() && is_recent(&llvm(rustc())) {
        println!("cargo::rustc-cfg=bun_simd_recent_llvm");
    }
    // The condition of rustc is not stable.
    for it in var("CARGO_CFG_SANITIZE").split(',').filter(|it| !it.is_empty()) {
        println!("cargo::rustc-cfg=bun_simd_sanitize=\"{it}\"");
    }
    // See `op` in src/simd_macros/lib.rs. MemorySanitizer doesn't see what assembly writes.
    if env::var_os("CARGO_CFG_MIRI").is_some()
        || var("OPT_LEVEL") == "0"
            && !var("CARGO_CFG_SANITIZE").contains("memory")
            && !["opt-level", "-O", "inline-mir"].iter().any(|it| flags.contains(it))
    {
        println!("cargo::rustc-cfg=bun_simd_unoptimized");
    }
}
