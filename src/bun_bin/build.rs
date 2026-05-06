//! Phase-C link driver.
//!
//! Bun's native build (`bun bd` → ninja) does **not** produce per-dependency
//! `.a` archives — it compiles every vendored C/C++ source straight to a
//! `.o` under `build/<profile>/obj/**` and feeds the whole list to a single
//! `clang++ … -o bun-debug` link step (see `rule link` in `build.ninja`).
//! The only true archives are the prebuilt WebKit set
//! (`libJavaScriptCore.a`, `libWTF.a`, `libbmalloc.a`, `libicu*.a`) under
//! `~/.bun/build-cache/webkit-<hash>-<variant>/lib`, plus `liblolhtml.a`
//! built by Cargo into `build/<profile>/deps/lolhtml/…`.
//!
//! Rather than re-derive that 1k+ object list ourselves, we read it back out
//! of `build.ninja`'s `build bun-debug: link …` statement together with its
//! `ldflags = …` line, then re-emit each input as a `cargo:rustc-link-arg`.
//! That keeps this script honest against upstream build changes (new vendor
//! libs, WebKit hash bumps, --wrap symbols, version scripts) without
//! hard-coding any of it.
//!
//! The `bun-zig.*.o` objects are deliberately **dropped** — those are the
//! Zig translation units this Rust port is replacing. Linking them would
//! produce duplicate-symbol collisions with the Rust crates.
//!
//! Prerequisite: a completed `bun bd` so `build/debug/` is populated.

use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    // src/bun_bin → repo root is two up.
    let manifest = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let repo = manifest
        .parent()
        .and_then(Path::parent)
        .expect("repo root from CARGO_MANIFEST_DIR")
        .to_path_buf();

    // Allow `BUN_BUILD_DIR` override; default to the debug profile dir
    // `bun bd` writes into.
    let build_dir = env::var("BUN_BUILD_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| repo.join("build/debug"));

    let ninja = build_dir.join("build.ninja");
    println!("cargo:rerun-if-env-changed=BUN_BUILD_DIR");
    println!("cargo:rerun-if-changed={}", ninja.display());

    let ninja_src = match fs::read_to_string(&ninja) {
        Ok(s) => s,
        Err(e) => {
            println!(
                "cargo:warning=bun_bin: {} not found ({e}); run `bun bd` first. \
                 Emitting no native link inputs — final link will be missing every C/C++ symbol.",
                ninja.display()
            );
            return;
        }
    };

    let (inputs, ldflags) = scrape_link_rule(&ninja_src);

    // ── Object files & archives ──────────────────────────────────────────
    // Ninja paths are relative to `build_dir`. We pass each as a verbatim
    // link-arg so order is preserved exactly as the working native link uses
    // it (lld is order-sensitive for archives; objects less so, but there is
    // no reason to perturb a known-good ordering).
    let mut search_dirs: Vec<PathBuf> = Vec::new();
    let mut obj_count = 0usize;
    for raw in &inputs {
        // Replace the Zig object set with our Rust crates.
        if raw.starts_with("bun-zig.") {
            continue;
        }
        let abs = absolutize(&build_dir, raw);
        if !abs.exists() {
            println!("cargo:warning=bun_bin: link input missing on disk: {}", abs.display());
            continue;
        }
        if raw.ends_with(".a") {
            // Feed archives by absolute path (avoids `-l` stem-mangling games
            // and keeps WebKit's six archives in their original relative
            // order: WTF → JavaScriptCore → icu* → bmalloc).
            if let Some(dir) = abs.parent() {
                if !search_dirs.iter().any(|d| d == dir) {
                    search_dirs.push(dir.to_path_buf());
                }
            }
            println!("cargo:rustc-link-arg={}", abs.display());
        } else {
            println!("cargo:rustc-link-arg={}", abs.display());
            obj_count += 1;
        }
    }
    for d in &search_dirs {
        println!("cargo:rustc-link-search=native={}", d.display());
    }
    eprintln!("bun_bin/build.rs: {} objects, {} archive dirs", obj_count, search_dirs.len());

    // ── ldflags ──────────────────────────────────────────────────────────
    // The C/C++ objects are built `-fno-pic`, so the final link must be
    // no-PIE. rustc's default `pic` model still emits a leading `-pie`;
    // clang++ honours the last one, so an explicit `-no-pie` here wins.
    // (We can't set `-C relocation-model=static` workspace-wide because
    // proc-macro dylibs would then fail to link.)
    println!("cargo:rustc-link-arg=-no-pie");
    // Re-emit the native link's flags. A few are stripped because they
    // either conflict with rustc's own driver invocation or assume the Zig
    // objects are present.
    for flag in ldflags.split_whitespace() {
        if skip_ldflag(flag) {
            continue;
        }
        println!("cargo:rustc-link-arg={flag}");
    }

    // ── Platform system libs ─────────────────────────────────────────────
    // The ninja ldflags already cover Linux (`-lc -lpthread -ldl
    // -l:libatomic.a`). For non-Linux hosts where this build script may run
    // without a populated build.ninja, fall through to the conventional set.
    let target_os = env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    match target_os.as_str() {
        "linux" => {
            // rustc drives the linker with `-nodefaultlibs`, so the
            // `-static-libstdc++` in ldflags only sets the *mode* — it does
            // not implicitly add the library. Name it explicitly. (GNU
            // libstdc++, not libc++: matches the clang++ driver default this
            // toolchain ships and what the C++ objects were built against.)
            println!("cargo:rustc-link-arg=-lstdc++");
            println!("cargo:rustc-link-lib=dylib=m");
            // Surface the full undefined-symbol set instead of lld's default
            // 20-error cutoff; Phase C wants the inventory.
            println!("cargo:rustc-link-arg=-Wl,--error-limit=0");
        }
        "macos" => {
            println!("cargo:rustc-link-lib=dylib=c++");
            for fw in [
                "CoreFoundation",
                "CoreServices",
                "Foundation",
                "Security",
                "SystemConfiguration",
            ] {
                println!("cargo:rustc-link-lib=framework={fw}");
            }
        }
        "windows" => {
            for lib in [
                "ws2_32", "userenv", "advapi32", "iphlpapi", "shell32", "ole32", "bcrypt",
                "ntdll", "crypt32", "dbghelp", "winmm",
            ] {
                println!("cargo:rustc-link-lib=dylib={lib}");
            }
        }
        _ => {}
    }
}

/// Parse `build bun-debug: link <objs...>` (with `$`-continuations) plus the
/// following `  ldflags = …` variable line out of a ninja file.
fn scrape_link_rule(ninja: &str) -> (Vec<String>, String) {
    let mut lines = ninja.lines().peekable();
    let mut inputs = Vec::new();
    let mut ldflags = String::new();

    while let Some(line) = lines.next() {
        let Some(rest) = line.strip_prefix("build bun-debug: link ") else {
            continue;
        };
        // Reassemble the `$`-continued logical line.
        let mut logical = String::from(rest);
        while logical.trim_end().ends_with('$') {
            let trimmed = logical.trim_end().trim_end_matches('$').to_string();
            logical = trimmed;
            if let Some(next) = lines.next() {
                logical.push(' ');
                logical.push_str(next.trim_start());
            } else {
                break;
            }
        }
        // Drop order-only deps (`| …`) — symbols.dyn / linker.lds, handled via ldflags.
        let explicit = logical.split('|').next().unwrap_or("");
        for tok in explicit.split_whitespace() {
            inputs.push(tok.to_string());
        }
        // The indented `ldflags = …` follows immediately.
        for var in lines.by_ref() {
            let v = var.trim_start();
            if let Some(f) = v.strip_prefix("ldflags = ") {
                ldflags = f.to_string();
                break;
            }
            if !var.starts_with(' ') {
                break;
            }
        }
        break;
    }
    (inputs, ldflags)
}

fn absolutize(build_dir: &Path, rel: &str) -> PathBuf {
    let p = Path::new(rel);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        // Ninja's paths are relative to the build dir; collapse `../..` so the
        // WebKit cache path (`../../../.bun/build-cache/...`) resolves.
        build_dir
            .join(p)
            .canonicalize()
            .unwrap_or_else(|_| build_dir.join(p))
    }
}

/// Flags from the native link that fight rustc's own link invocation.
fn skip_ldflag(flag: &str) -> bool {
    // The lld path is set workspace-wide in `.cargo/config.toml` instead.
    // `-fno-pic`/`-no-pie` are kept — the C objects are no-PIC, so the final
    // link must be no-PIE (Rust's PIC objects are still valid in a no-PIE
    // image). `-fsanitize=address`/`null` are kept because the debug C/C++
    // objects and the prebuilt WebKit archives are asan-instrumented and
    // need the asan runtime on the link line; the un-instrumented Rust TUs
    // coexist fine (asan's interceptors are process-global).
    flag.starts_with("--ld-path=")
        // The version script pins the export set to Zig's symbol names; with
        // those objects removed it would `local:`-hide std's panic machinery.
        // Revisit once the Rust side defines the matching `Bun__*` exports.
        || flag.starts_with("-Wl,--version-script=")
}
