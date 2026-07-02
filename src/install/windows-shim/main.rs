//! Entry point for the standalone `bun_shim_impl.exe` PE.
//!
//! `bun_shim_impl.rs` is `#![cfg(windows)]` at module scope and its `main()`
//! returns `!`, so it can't be the bin root directly. This file:
//!
//!   - Mirrors `bun_install/lib.rs`'s `_bin_linking_shim` / `_bun_shim_impl`
//!     module layout so the shared source's `use super::_bin_linking_shim::Flags`
//!     resolves unmodified.
//!   - Provides local stand-ins for the `bun_core` / `bun_sys::windows` /
//!     `bun_str` items the shared source reaches for, so this crate's only
//!     workspace dep is `bun_windows_sys` (leaf Win32 externs — no native C,
//!     no `#[no_mangle]` exports). Depending on the real crates would make
//!     their `#[no_mangle]` C-ABI surface (`Bun__*`, `__bun_dispatch__*`) a
//!     link root referencing libuv/simdutf/highway/ICU; the shim can't
//!     satisfy those and shouldn't carry them.
//!
//! `BinLinkingShim.rs` is path-included for `Flags`/`VersionFlag` only; its
//! encoder side (Shebang, `encode_into`, `include_bytes!` of this crate's own
//! output) is gated out under `feature = "shim_standalone"`.

// Mirror `bun_install/lib.rs`'s crate-level attributes — the path-included
// modules assume these are set at the crate root.
//
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
#![feature(adt_const_params)]

// `unreachable_pub`: these files are shared with `bun_install`, where their
// `pub` items are cross-crate API (`bun_install::windows_shim::*`). Compiled
// here as private modules of a binary, every `pub` is trivially unreachable.
#[cfg(windows)]
#[path = "BinLinkingShim.rs"]
#[allow(unreachable_pub)]
mod _bin_linking_shim;

#[cfg(windows)]
#[path = "bun_shim_impl.rs"]
#[allow(unreachable_pub)]
mod _bun_shim_impl;

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
    _bun_shim_impl::main()
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

// ═══════════════════════════════════════════════════════════════════════════
//  Stand-ins for `bun_core` / `bun_sys::windows` / `bun_str`
//
//  Brought into `bun_shim_impl.rs`'s scope via a single
//  `#[cfg(feature = "shim_standalone")] use crate::{bun_core, bun_str, w};`
//  so the inline `bun_core::ffi::slice(...)` / `bun_core::w!(...)` paths
//  resolve here instead of the extern prelude, and `w` (= the
//  `bun_sys::windows` namespace) comes from `compat` below.
// ═══════════════════════════════════════════════════════════════════════════

/// `bun_core::w!("foo")` → `&'static [u16]` UTF-16 literal (ASCII-only).
/// Mirrors `bun_core::w!` (src/string/immutable.rs).
#[macro_export]
macro_rules! w_lit {
    ($s:literal) => {{
        const __B: &[u8] = $s.as_bytes();
        const __N: usize = __B.len();
        const __W: [u16; __N] = {
            let mut out = [0u16; __N];
            let mut i = 0;
            while i < __N {
                debug_assert!(__B[i] < 0x80, "w! is ASCII-only");
                out[i] = __B[i] as u16;
                i += 1;
            }
            out
        };
        &__W as &'static [u16]
    }};
}

#[cfg(windows)]
pub mod bun_core {
    // Re-export under the path the shared source uses (`bun_core::w!`).
    pub use crate::w_lit as w;
    /// Mirrors `bun_core::RacyCell` (src/bun_core/util.rs) — `static`-safe
    /// interior-mutability cell with no synchronization. The shim is
    /// single-threaded (it never spawns a thread), so the
    /// unconditional `Sync` is trivially upheld.
    ///
    /// Internally backed by `Cell<T>` (not `UnsafeCell<T>`): `Cell` is
    /// `#[repr(transparent)]` over `UnsafeCell` with identical `Send`/`!Sync`
    /// auto-traits, but gives `.get()/.set()` for `T: Copy` without a raw
    /// deref. The only remaining `unsafe` is the `impl Sync` below — the
    /// irreducible single-thread invariant.
    #[repr(transparent)]
    pub(crate) struct RacyCell<T: ?Sized>(core::cell::Cell<T>);
    // SAFETY: standalone shim is single-threaded.
    unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
    impl<T> RacyCell<T> {
        #[inline]
        pub(crate) const fn new(value: T) -> Self {
            Self(core::cell::Cell::new(value))
        }
        #[inline]
        pub(crate) const fn get(&self) -> *mut T {
            self.0.as_ptr()
        }
        /// Body is safe `Cell::get()`; the single-thread invariant is
        /// discharged by the `Sync` impl above, not by the caller.
        /// `bun_shim_impl.rs` only uses `.new()`/`.get()`, so signature
        /// parity with `bun_core::RacyCell::read` is unneeded here.
        #[inline]
        pub(crate) fn read(&self) -> T
        where
            T: Copy,
        {
            self.0.get()
        }
        /// Body is safe `Cell::set()`; see [`Self::read`].
        #[inline]
        pub(crate) fn write(&self, value: T) {
            self.0.set(value)
        }
    }

    /// Mirrors the subset of `bun_core::ffi` the shim calls.
    pub mod ffi {
        // `core`-only slice/wstr primitives — single audited copy lives in
        // `bun_opaque::ffi` (zero-dep, zero `#[no_mangle]`, safe for this
        // freestanding PE to depend on). `Zeroable`/`zeroed` stay local: the
        // orphan rule blocks `bun_opaque` from `impl Zeroable for
        // bun_windows_sys::*`, and `bun_core`'s impls drag in link roots.
        pub use bun_opaque::ffi::{slice, slice_mut, wcslen, wstr_units};

        /// Marker: all-zero bit pattern is a valid `Self`. Local re-spelling
        /// of `bun_core::ffi::Zeroable`; impl'd below for the two
        /// `bun_windows_sys` POD types the shim zero-inits.
        ///
        /// # Safety
        /// `Self` must be inhabited at the all-zero bit pattern.
        pub(crate) unsafe trait Zeroable: Sized {}
        // SAFETY: `#[repr(C)]` POD — all integer / raw-pointer fields.
        unsafe impl Zeroable for bun_windows_sys::IO_STATUS_BLOCK {}
        // SAFETY: two raw-pointer HANDLEs (null-valid) + two u32.
        unsafe impl Zeroable for crate::compat::PROCESS_INFORMATION {}

        /// Mirrors `bun_core::ffi::zeroed`.
        #[inline(always)]
        pub(crate) const fn zeroed<T: Zeroable>() -> T {
            // SAFETY: `T: Zeroable` asserts all-zero is valid for `T`.
            unsafe { core::mem::zeroed() }
        }
    }
}

/// `bun_sys::windows` stand-in. Re-exports the leaf `bun_windows_sys` surface
/// (which now owns CreateProcessW, STARTUPINFOW / PROCESS_INFORMATION, the
/// TEB→PEB→ProcessParameters chain, and `teb()`/`peb()`); only the shim-local
/// `PVOID` alias and console-mode flag remain here.
#[cfg(windows)]
pub mod compat {
    use core::ffi::c_void;

    pub use bun_windows_sys::*;
    // Distinct sub-module so `w::ntdll::NtClose` etc. resolve.
    pub use bun_windows_sys::ntdll;

    // ── aliases / consts not yet in bun_windows_sys ──
    pub(crate) type PVOID = *mut c_void;
    pub(crate) const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

    // ── kernel32 surface (bun_sys::windows::kernel32 layers extras on top
    //    of bun_windows_sys::kernel32; mirror just what the shim calls) ──
    pub mod kernel32 {
        pub use bun_windows_sys::externs::{
            GetConsoleMode, GetExitCodeProcess, SetConsoleMode, WaitForSingleObject,
        };
        pub use bun_windows_sys::kernel32::*;
    }
}
