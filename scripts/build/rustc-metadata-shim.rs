//! `RUSTC_WORKSPACE_WRAPPER`: replace cargo's `-C metadata` with the package
//! name, so bun's crates keep the same v0 symbol names from build to build.
//!
//! Cargo mixes the `-C metadata` of every dependency into a unit's own, and
//! rustc hashes that into the `StableCrateId` every v0 symbol carries — the
//! `Cs…` in `_RNvNtNtCs4EG9u9StnXu_11bun_runtime3cli7command15boot_standalone`.
//! A dependency-edge edit *anywhere below a crate* therefore renames every
//! symbol that crate defines. `bun_runtime` has ~100 direct workspace deps, so
//! it was renamed by nearly every commit, and anything matching symbol names
//! across two builds silently lost it: lld `--symbol-ordering-file` reuse,
//! sccache hits, symbolicating an old profile against a new binary.
//!
//! rustc hashes *every* `-C metadata` it is handed, so an extra one from
//! RUSTFLAGS can't shadow cargo's — rewriting it here is the only lever.
//!
//! The package name alone keeps symbols unique: rustc mixes the crate name into
//! `StableCrateId` on top of this, no two workspace packages share a name, and
//! cargo applies this wrapper to workspace members only — registry crates, where
//! two versions of one name can coexist, keep cargo's hash.

use std::env;
use std::ffi::OsString;
use std::process::Command;

fn main() {
    let mut argv = env::args_os().skip(1);
    let Some(rustc) = argv.next() else {
        eprintln!("rustc-metadata-shim: expected rustc's path as the first argument");
        std::process::exit(1);
    };

    // Cargo emits `-C` and `metadata=<hash>` as two arguments, and nothing else
    // it passes starts with `metadata=`. Invocations with none at all (cargo's
    // `-vV` / `--print` probes) fall through untouched.
    let pin = format!(
        "metadata=bun.{}",
        env::var("CARGO_PKG_NAME").unwrap_or_default()
    );
    let args: Vec<OsString> = argv
        .map(|arg| match arg.to_str() {
            Some(a) if a.starts_with("metadata=") => OsString::from(pin.as_str()),
            _ => arg,
        })
        .collect();

    run(&rustc, &args)
}

#[cfg(unix)]
fn run(rustc: &OsString, args: &[OsString]) -> ! {
    use std::os::unix::process::CommandExt;
    let err = Command::new(rustc).args(args).exec();
    eprintln!(
        "rustc-metadata-shim: cannot exec {}: {err}",
        rustc.to_string_lossy()
    );
    std::process::exit(1)
}

#[cfg(not(unix))]
fn run(rustc: &OsString, args: &[OsString]) -> ! {
    match Command::new(rustc).args(args).status() {
        Ok(status) => std::process::exit(status.code().unwrap_or(1)),
        Err(err) => {
            eprintln!(
                "rustc-metadata-shim: cannot run {}: {err}",
                rustc.to_string_lossy()
            );
            std::process::exit(1)
        }
    }
}
