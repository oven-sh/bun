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
    let problems = match bun_appkit::verify_bindings() {
        Ok(problems) => problems,
        Err(err) => {
            eprintln!("bindings: could not load the frameworks: {err}");
            std::process::exit(1);
        }
    };
    if problems.is_empty() {
        eprintln!("bindings: every binding matches the SDK");
        return;
    }
    for p in &problems {
        eprintln!("{p}");
    }
    eprintln!("bindings: {} problem(s)", problems.len());
    std::process::exit(1);
}

#[cfg(not(target_os = "macos"))]
fn main() {}
