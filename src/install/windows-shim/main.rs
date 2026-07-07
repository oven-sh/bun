//! Entry point for the standalone `bun_shim_impl.exe` PE.
//!
//! The launcher (`bun_shim_impl::launcher`) is `#![cfg(windows)]` at module
//! scope and its `main()` returns `!`, so it can't be the bin root directly.
//! This file provides the PE entry point plus the `/NODEFAULTLIB` CRT stubs;
//! all of the shim logic lives in this crate's library (built here with the
//! `shim_standalone` feature), whose dependencies are only the two leaf
//! crates `bun_opaque` (`RacyCell`, `w!`, `ffi::{slice,slice_mut,zeroed}`)
//! and `bun_windows_sys` (Win32 externs) — neither of which has native C or
//! `#[no_mangle]` exports. Depending on the real `bun_core` / `bun_sys`
//! crates would make their `#[no_mangle]` C-ABI surface (`Bun__*`,
//! `__bun_dispatch__*`) a link root referencing libuv/simdutf/highway/ICU;
//! the shim can't satisfy those and shouldn't carry them.

// Freestanding: `no_std` + `no_main` so the link contains only the launcher
// + Win32 externs — no Rust runtime, no CRT, no `std::sys` init.
// `scripts/build/rust.ts` supplies `/ENTRY:shim_main` and rebuilds `core`
// with `panic_immediate_abort` so the panic/fmt machinery is dead code.
#![no_std]
#![no_main]
#![allow(
    nonstandard_style,
    ambiguous_glob_reexports,
    incomplete_features,
    dead_code
)]

// ── /NODEFAULTLIB CRT stubs ────────────────────────────────────────────────
// With `/NODEFAULTLIB` the MSVC CRT isn't linked, so the two CRT-hosted
// link-time symbols LLVM/link.exe expect must be provided here.

/// `_fltused` — link-time marker the MSVC toolchain references whenever a
/// translation unit touches floating-point. The CRT defines it; we just need
/// the symbol to exist.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub(crate) static _fltused: i32 = 0;

/// `__chkstk` — MSVC's stack-probe; LLVM inserts a call before any frame
/// allocating >4 KiB (the launcher's path/cmdline buffers are ~128 KiB). The
/// CRT version walks each 4 KiB page so the OS's guard-page-driven stack
/// growth commits them. With `/NODEFAULTLIB` we supply the same probe.
///
/// `compiler_builtins` *has* this routine but hard-gates it on
/// `cfg(target_env = "gnu")` (`src/x86_64.rs` / `src/aarch64.rs`) because on
/// `*-msvc` it expects the CRT to provide it; there is no feature flag to
/// opt in. So we ship the probe ourselves: the bodies
/// below are taken verbatim from `compiler_builtins` (which in turn mirrors
/// LLVM `compiler-rt/lib/builtins/{x86_64,aarch64}/chkstk.S`), so they are
/// the upstream-tested instruction sequences rather than a local rewrite.
///
/// MS x64 contract: bytes-to-probe in `rax`; must preserve all registers
/// except `rax`/`r10`/`r11`; does NOT adjust `rsp` (caller subtracts after).
///
/// Safe fn: a naked function need not be marked otherwise — the single
/// `naked_asm!` body is permitted in a safe naked fn, and the only caller is
/// the compiler-inserted prologue probe (no Rust call sites to discharge).
#[cfg(all(windows, target_arch = "x86_64"))]
#[unsafe(no_mangle)]
#[unsafe(naked)]
pub(crate) extern "C" fn __chkstk() {
    // Verbatim: compiler_builtins `src/x86_64.rs` `___chkstk_ms` (the MS-x64
    // probe-only variant — same contract as MSVC `__chkstk`).
    core::arch::naked_asm!(
        "push   rcx",
        "push   rax",
        "cmp    rax, 0x1000",
        "lea    rcx, [rsp + 24]",
        "jb     3f",
        "2:",
        "sub    rcx, 0x1000",
        "test   [rcx], rcx",
        "sub    rax, 0x1000",
        "cmp    rax, 0x1000",
        "ja     2b",
        "3:",
        "sub    rcx, rax",
        "test   [rcx], rcx",
        "pop    rax",
        "pop    rcx",
        "ret",
    );
}

/// AArch64 spelling: bytes/16 in `x15`; touches each 4 KiB page; preserves
/// everything except `x16`/`x17`.
#[cfg(all(windows, target_arch = "aarch64"))]
#[unsafe(no_mangle)]
#[unsafe(naked)]
pub(crate) extern "C" fn __chkstk() {
    // Verbatim: compiler_builtins `src/aarch64.rs` `__chkstk`.
    core::arch::naked_asm!(
        ".p2align 2",
        "lsl    x16, x15, #4",
        "mov    x17, sp",
        "1:",
        "sub    x17, x17, 4096",
        "subs   x16, x16, 4096",
        "ldr    xzr, [x17]",
        "b.gt   1b",
        "ret",
    );
}

/// PE entry point (named via `-C link-arg=/ENTRY:shim_main` in the build
/// script — bypasses `mainCRTStartup` and the CRT entirely). The launcher
/// reads its arguments / image path straight from the TEB→PEB process
/// parameters, so no CRT argv parsing is needed.
#[cfg(windows)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn shim_main() -> ! {
    bun_shim_impl::launcher::main()
}

/// `no_std` requires a crate-graph-unique panic handler. The shim's only
/// panics are debug assertions; in release the build script enables `core`'s
/// `panic_immediate_abort` so they compile to a bare trap and never reach
/// this. If one does (debug `--profile shim` build), exit 255 — same code
/// `fail_and_exit_with_reason` uses.
#[cfg(windows)]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    // Declared locally as `safe fn` (the `bun_windows_sys::ntdll` re-export
    // is not yet `safe`-qualified): no memory-safety preconditions — by-value
    // `u32`, diverges. Matches `ExitProcess`, already `safe fn` upstream.
    #[link(name = "ntdll")]
    unsafe extern "system" {
        safe fn RtlExitUserProcess(ExitStatus: u32) -> !;
    }
    RtlExitUserProcess(255)
}

// Non-Windows: the build system only ever builds this crate for
// `*-pc-windows-msvc`, but a stray `cargo check -p bun_shim_impl
// --features shim_standalone` on another host still needs a panic handler
// to satisfy `#![no_std]`. With `#![no_main]` no entry symbol is required.
#[cfg(not(windows))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}
