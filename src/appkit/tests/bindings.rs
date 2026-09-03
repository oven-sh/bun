//! Checks every Objective-C binding compiled into `bun_appkit` against the
//! AppKit, Metal and MetalKit this machine has: the class or protocol exists,
//! it declares the selector, and the declared type encoding matches the Rust
//! signature. Runs without a window server or GPU.
//!
//! `harness = false` because AppKit may only be loaded on the process main
//! thread, which the default test harness does not run tests on.
//!
//! The same check runs in the JS suite through
//! `bun:internal-for-testing` (`appKitInternals.verifyBindings()`).
//!
//!     cargo test -p bun_appkit --test bindings

#[cfg(target_os = "macos")]
fn main() {
    use std::io::Write;
    let mut err = std::io::stderr().lock();
    let problems = match bun_appkit::verify_bindings() {
        Ok(problems) => problems,
        Err(e) => {
            let _ = writeln!(err, "bindings: could not load the frameworks: {e}");
            std::process::exit(1);
        }
    };
    if problems.is_empty() {
        let _ = writeln!(err, "bindings: every binding matches the SDK");
        return;
    }
    for p in &problems {
        let _ = writeln!(err, "{p}");
    }
    let _ = writeln!(err, "bindings: {} problem(s)", problems.len());
    std::process::exit(1);
}

#[cfg(not(target_os = "macos"))]
fn main() {}
