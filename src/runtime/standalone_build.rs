//! `bun-standalone` build support.
//!
//! The `bun-standalone` binary is the reduced-footprint runtime that
//! `bun build --compile` attaches a module graph to. It carries the full JS
//! runtime (event loop, module loader, `Bun.serve`, `fetch`, node compat,
//! crypto, FFI, …) but compiles out the toolkit subcommands and the JS APIs
//! that back them — `bun install`/`add`/`remove`/`pm`, `bun build`,
//! `bun test`, `bun create`/`init`/`x`/`upgrade`, `Bun.build()`, the bake
//! DevServer, and the CSS parser surface.
//!
//! Gating is on `cfg(bun_standalone)` (a global RUSTFLAG set by
//! `scripts/build/rust.ts`), not `cfg(feature = "standalone")`, so any crate
//! can branch on it without threading a cargo feature through the workspace.
//! The C/C++ object set is identical between `bun` and `bun-standalone`;
//! `--gc-sections` + `.llvm_addrsig` drop the C++ functions whose only
//! Rust-side callers were compiled out.
//!
//! Every stub here surfaces a user-facing error; nothing is a silent no-op.

/// True for the `bun-standalone` binary. Same as
/// `bun_core::build_options::STANDALONE_BUILD`.
pub const IS_STANDALONE: bool = cfg!(bun_standalone);

/// Print the "not available in this binary" error for a CLI subcommand and
/// exit non-zero. Used by the `cfg(bun_standalone)` dispatch arm in
/// `cli::Command::start()`.
#[cold]
#[allow(dead_code)]
pub fn unavailable_command(name: &[u8]) -> ! {
    bun_core::pretty_errorln!(
        "<r><red>error<r><d>:<r> <b>bun {}<r> is not available in this executable",
        bstr::BStr::new(name),
    );
    bun_core::pretty_errorln!("");
    bun_core::pretty_errorln!(
        "This is a standalone executable built with <b>bun build --compile<r>. It contains the",
    );
    bun_core::pretty_errorln!(
        "Bun runtime but not the bundler, package manager, or test runner.",
    );
    bun_core::pretty_errorln!("");
    bun_core::pretty_errorln!(
        "To use <b>bun {}<r>, install Bun: <cyan>https://bun.com/get<r>",
        bstr::BStr::new(name),
    );
    bun_core::output::flush();
    bun_core::Global::exit(1);
}
