//! Dev-only: archives the ninja build's prebuilt libuv objects into a static
//! lib so `cargo test -p bun_sys`/`-p bun_paths` can link the real libuv.
//! Never part of the product build — only test binaries depend on this crate.

use std::path::{Path, PathBuf};

fn find_archiver() -> Option<PathBuf> {
    // llvm-lib (scoop/llvm on dev machines) or MSVC lib.exe.
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) {
            for name in ["llvm-lib.exe", "llvm-lib", "lib.exe"] {
                let candidate = dir.join(name);
                if candidate.is_file() {
                    return Some(candidate);
                }
            }
        }
    }
    // Fall back to any installed MSVC toolset.
    let glob_root = Path::new("C:\\Program Files\\Microsoft Visual Studio");
    let mut newest: Option<PathBuf> = None;
    let walk = |dir: &Path| {
        let Ok(entries) = std::fs::read_dir(dir) else {
            return Vec::new();
        };
        entries.flatten().map(|e| e.path()).collect::<Vec<_>>()
    };
    for edition in walk(glob_root) {
        for flavor in walk(&edition) {
            let msvc = flavor.join("VC\\Tools\\MSVC");
            for toolset in walk(&msvc) {
                let lib = toolset.join("bin\\Hostx64\\x64\\lib.exe");
                if lib.is_file() {
                    newest = Some(lib);
                }
            }
        }
    }
    newest
}

fn main() {
    println!("cargo::rerun-if-env-changed=BUN_BUILD_DIR");
    // The prebuilt-object wiring is Windows-only (matching the ninja build
    // that produced them); elsewhere this crate contributes only Rust shims.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("windows") {
        return;
    }
    let manifest = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo_root = manifest.parent().unwrap().parent().unwrap().to_path_buf();
    let build_dir = std::env::var_os("BUN_BUILD_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| repo_root.join("build").join("debug"));
    let uv_obj_root = build_dir
        .join("obj")
        .join("vendor")
        .join("libuv")
        .join("src");
    if !uv_obj_root.is_dir() {
        // Warn instead of panic so non-linking consumers (Miri interprets,
        // never links) keep working without a ninja build directory.
        println!(
            "cargo::warning=libuv objects not found at {} — `cargo test` will \
             fail to link; run `bun bd` once first (or set BUN_BUILD_DIR)",
            uv_obj_root.display()
        );
        return;
    }

    let mut objs = Vec::new();
    let mut stack = vec![uv_obj_root.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                stack.push(path);
            } else if path.extension().is_some_and(|e| e == "obj") {
                println!("cargo::rerun-if-changed={}", path.display());
                objs.push(path);
            }
        }
    }
    assert!(
        !objs.is_empty(),
        "no .obj files under {}",
        uv_obj_root.display()
    );
    objs.sort();

    let out_dir = PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let archive = out_dir.join("uv_prebuilt.lib");
    let archiver = find_archiver().expect(
        "no llvm-lib/lib.exe found on PATH or under Visual Studio — needed to \
         archive the prebuilt libuv objects for cargo tests",
    );
    let mut cmd = std::process::Command::new(&archiver);
    cmd.arg(format!("/OUT:{}", archive.display()));
    for obj in &objs {
        cmd.arg(obj);
    }
    let status = cmd.status().expect("failed to run archiver");
    assert!(status.success(), "{} failed: {status}", archiver.display());

    println!("cargo::rustc-link-search=native={}", out_dir.display());
    println!("cargo::rustc-link-lib=static=uv_prebuilt");
    // Win32 import libraries libuv needs.
    for lib in [
        "ws2_32", "iphlpapi", "userenv", "dbghelp", "ole32", "shell32", "advapi32", "psapi",
        "user32", "ntdll",
    ] {
        println!("cargo::rustc-link-lib={lib}");
    }
}
