//! `RUSTC_WORKSPACE_WRAPPER` for the bun workspace: pin `-C metadata` so our
//! crates keep the same v0 symbol names from one build to the next.
//!
//! Cargo derives a unit's `-C metadata` from, among other things, the
//! `-C metadata` of every dependency it has (`compute_metadata` in
//! `compilation_files.rs`). rustc hashes that value into the `StableCrateId`
//! that every v0 symbol carries: the `Cs…` in
//! `_RNvNtNtCs4EG9u9StnXu_11bun_runtime3cli7command15boot_standalone`. So a
//! dependency-edge edit *anywhere below a crate* renames every symbol that
//! crate defines. `bun_runtime` sits at the top of the dependency cone (direct
//! deps on ~100 workspace crates), so it is renamed by almost every commit,
//! while leaves like `bun_core` never move. Nothing is wrong with the binary —
//! but anything that matches symbol names across two builds silently loses the
//! crate: lld `--symbol-ordering-file` reuse, sccache hits, symbolicating an
//! old profile against a new binary.
//!
//! There is no cargo knob for this, and rustc sorts/dedups/hashes *every*
//! `-C metadata` it is handed, so an extra one from RUSTFLAGS cannot shadow
//! cargo's. Rewriting the value before rustc sees it is the only lever.
//!
//! The replacement keeps everything in cargo's hash that identifies this
//! compilation unit — package, version, features, target, crate types — and
//! drops only the dependency hash. Symbols stay unique because rustc mixes the
//! crate name into `StableCrateId` independently of `-C metadata`, and no two
//! workspace packages share a name.
//!
//! Built by `scripts/build/rust.ts` with a bare `rustc`; it is not a workspace
//! member (it has to exist before cargo runs).

use std::env;
use std::ffi::OsString;
use std::process::Command;

fn main() {
    let mut argv = env::args_os().skip(1);
    let Some(rustc) = argv.next() else {
        eprintln!("rustc-metadata-shim: expected rustc's path as the first argument");
        std::process::exit(1);
    };

    let args: Vec<OsString> = argv.collect();
    let args = rewrite_metadata(&args, &pin(&args));
    run(&rustc, &args);
}

/// Replace the value of cargo's `-C metadata=<hash>` with `pin`.
///
/// Cargo emits it as two arguments (`-C`, `metadata=…`); the one-argument
/// spelling is handled too in case a RUSTFLAG ever uses it. Invocations
/// without one (cargo's `-vV` / `--print` probes) pass straight through.
fn rewrite_metadata(args: &[OsString], pin: &str) -> Vec<OsString> {
    let mut out: Vec<OsString> = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].to_string_lossy();
        let next_is_metadata =
            i + 1 < args.len() && args[i + 1].to_string_lossy().starts_with("metadata=");
        if arg == "-C" && next_is_metadata {
            out.push(OsString::from("-C"));
            out.push(OsString::from(format!("metadata={pin}")));
            i += 2;
            continue;
        }
        if arg.starts_with("-Cmetadata=") {
            out.push(OsString::from(format!("-Cmetadata={pin}")));
            i += 1;
            continue;
        }
        out.push(args[i].clone());
        i += 1;
    }
    out
}

/// The unit's identity, stable across dependency-graph edits.
///
/// Package name and version come from cargo's per-invocation env; target,
/// crate types and features come off the command line. Sorted so argument
/// order can never change the result.
fn pin(args: &[OsString]) -> String {
    let scan: Vec<String> = args
        .iter()
        .map(|a| a.to_string_lossy().into_owned())
        .collect();
    let mut target: Option<String> = None;
    let mut crate_types: Vec<String> = Vec::new();
    let mut features: Vec<String> = Vec::new();

    let mut i = 0;
    while i < scan.len() {
        if let Some(v) = value_of(&scan, &mut i, "--target") {
            target = Some(v);
        } else if let Some(v) = value_of(&scan, &mut i, "--crate-type") {
            crate_types.push(v);
        } else if let Some(v) = value_of(&scan, &mut i, "--cfg") {
            if let Some(f) = v.strip_prefix("feature=") {
                features.push(f.trim_matches('"').to_string());
            }
        }
        i += 1;
    }

    crate_types.sort();
    features.sort();
    features.dedup();
    format!(
        "bun/{}@{}/{}/{}/{}",
        env::var("CARGO_PKG_NAME").unwrap_or_default(),
        env::var("CARGO_PKG_VERSION").unwrap_or_default(),
        target.as_deref().unwrap_or("host"),
        crate_types.join("+"),
        features.join(","),
    )
}

/// `--flag value` and `--flag=value`, but never `--flag-something`. Advances
/// `i` past the value when it was a separate argument.
fn value_of(scan: &[String], i: &mut usize, flag: &str) -> Option<String> {
    let arg = scan[*i].as_str();
    let rest = arg.strip_prefix(flag)?;
    if rest.is_empty() {
        let value = scan.get(*i + 1)?.clone();
        *i += 1;
        return Some(value);
    }
    rest.strip_prefix('=').map(str::to_string)
}

#[cfg(unix)]
fn run(rustc: &OsString, args: &[OsString]) -> ! {
    use std::os::unix::process::CommandExt;
    let err = Command::new(rustc).args(args).exec();
    eprintln!(
        "rustc-metadata-shim: failed to exec {}: {err}",
        rustc.to_string_lossy()
    );
    std::process::exit(1);
}

#[cfg(not(unix))]
fn run(rustc: &OsString, args: &[OsString]) -> ! {
    match Command::new(rustc).args(args).status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(err) => {
            eprintln!(
                "rustc-metadata-shim: failed to run {}: {err}",
                rustc.to_string_lossy()
            );
            std::process::exit(1);
        }
    }
}
