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
//!     satisfy those and shouldn't carry them. Zig's original
//!     (`bun_shim_impl.zig`) was self-contained for the same reason.
//!
//! `BinLinkingShim.rs` is path-included for `Flags`/`VersionFlag` only; its
//! encoder side (Shebang, `encode_into`, `include_bytes!` of this crate's own
//! output) is gated out under `feature = "shim_standalone"`.

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

#[cfg(windows)]
#[unsafe(no_mangle)]
pub(crate) extern "C" fn shim_main() -> ! {
    _bun_shim_impl::main()
}

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

#[cfg(not(windows))]
#[panic_handler]
fn panic(_: &core::panic::PanicInfo<'_>) -> ! {
    loop {}
}

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
