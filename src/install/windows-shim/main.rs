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

// Mirror `bun_install/lib.rs`'s crate-level attributes — the path-included
// modules assume these are set at the crate root.
#![allow(unused, nonstandard_style, ambiguous_glob_reexports, incomplete_features)]
#![feature(adt_const_params)]

#[cfg(windows)]
#[path = "BinLinkingShim.rs"]
mod _bin_linking_shim;

#[cfg(windows)]
#[path = "bun_shim_impl.rs"]
mod _bun_shim_impl;

#[cfg(windows)]
fn main() -> ! {
    _bun_shim_impl::main()
}

#[cfg(not(windows))]
fn main() {
    // Unreachable in practice — the build system only builds this crate for
    // `*-pc-windows-msvc` targets. Present so a stray `cargo check` on a
    // non-Windows host doesn't fail with "main function not found".
    panic!("bun_shim_impl is a Windows-only binary");
}

// ═══════════════════════════════════════════════════════════════════════════
//  Stand-ins for `bun_core` / `bun_sys::windows` / `bun_str`
//
//  Brought into `bun_shim_impl.rs`'s scope via a single
//  `#[cfg(feature = "shim_standalone")] use crate::{bun_core, bun_str, w};`
//  so the inline `bun_core::ffi::slice(...)` / `bun_str::w!(...)` paths
//  resolve here instead of the extern prelude, and `w` (= the
//  `bun_sys::windows` namespace) comes from `compat` below.
// ═══════════════════════════════════════════════════════════════════════════

/// `bun_str::w!("foo")` → `&'static [u16]` UTF-16 literal (ASCII-only).
/// Mirrors `bun_string::w!` (src/string/immutable.rs).
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
pub mod bun_str {
    // Re-export under the path the shared source uses (`bun_str::w!`).
    pub use crate::w_lit as w;
}

#[cfg(windows)]
pub mod bun_core {
    /// Mirrors `bun_core::RacyCell` (src/bun_core/util.rs) — `static`-safe
    /// `UnsafeCell` with no synchronization. The shim is single-threaded
    /// (Zig built it `single_threaded = true`), so the unconditional `Sync`
    /// is trivially upheld.
    #[repr(transparent)]
    pub struct RacyCell<T: ?Sized>(core::cell::UnsafeCell<T>);
    // SAFETY: standalone shim is single-threaded.
    unsafe impl<T: ?Sized> Sync for RacyCell<T> {}
    impl<T> RacyCell<T> {
        #[inline]
        pub const fn new(value: T) -> Self {
            Self(core::cell::UnsafeCell::new(value))
        }
        #[inline]
        pub const fn get(&self) -> *mut T {
            self.0.get()
        }
        /// # Safety
        /// No concurrent writer (trivially true: single-threaded).
        #[inline]
        pub unsafe fn read(&self) -> T
        where
            T: Copy,
        {
            unsafe { *self.0.get() }
        }
        /// # Safety
        /// No concurrent reader/writer (trivially true: single-threaded).
        #[inline]
        pub unsafe fn write(&self, value: T) {
            unsafe { *self.0.get() = value }
        }
    }

    /// Mirrors the subset of `bun_core::ffi` the shim calls.
    pub mod ffi {
        /// Marker: all-zero bit pattern is a valid `Self`. Local re-spelling
        /// of `bun_core::ffi::Zeroable`; impl'd below for the two
        /// `bun_windows_sys` POD types the shim zero-inits.
        ///
        /// # Safety
        /// `Self` must be inhabited at the all-zero bit pattern.
        pub unsafe trait Zeroable: Sized {}
        // SAFETY: `#[repr(C)]` POD — all integer / raw-pointer fields.
        unsafe impl Zeroable for bun_windows_sys::IO_STATUS_BLOCK {}
        // SAFETY: two raw-pointer HANDLEs (null-valid) + two u32.
        unsafe impl Zeroable for crate::compat::PROCESS_INFORMATION {}

        /// Mirrors `bun_core::ffi::zeroed`.
        #[inline(always)]
        pub const fn zeroed<T: Zeroable>() -> T {
            // SAFETY: `T: Zeroable` asserts all-zero is valid for `T`.
            unsafe { core::mem::zeroed() }
        }

        /// Mirrors `bun_core::ffi::slice` — tolerates `(null, 0)`.
        ///
        /// # Safety
        /// `from_raw_parts` contract when `len > 0`; null only at `len == 0`.
        #[inline(always)]
        pub const unsafe fn slice<'a, T>(ptr: *const T, len: usize) -> &'a [T] {
            if ptr.is_null() {
                assert!(len == 0, "ffi::slice: null ptr with non-zero len");
                // SAFETY: dangling is non-null + aligned; len 0 needs no backing.
                unsafe { core::slice::from_raw_parts(core::ptr::NonNull::dangling().as_ptr(), 0) }
            } else {
                // SAFETY: caller contract.
                unsafe { core::slice::from_raw_parts(ptr, len) }
            }
        }

        /// Mirrors `bun_core::ffi::slice_mut`.
        ///
        /// # Safety
        /// As [`slice`], plus exclusive access for `'a`.
        #[inline(always)]
        pub const unsafe fn slice_mut<'a, T>(ptr: *mut T, len: usize) -> &'a mut [T] {
            if ptr.is_null() {
                assert!(len == 0, "ffi::slice_mut: null ptr with non-zero len");
                // SAFETY: dangling is non-null + aligned; len 0 needs no backing.
                unsafe { core::slice::from_raw_parts_mut(core::ptr::NonNull::dangling().as_ptr(), 0) }
            } else {
                // SAFETY: caller contract.
                unsafe { core::slice::from_raw_parts_mut(ptr, len) }
            }
        }
    }
}

/// `bun_sys::windows` stand-in. Re-exports the leaf `bun_windows_sys`
/// surface and locally declares the handful of items that live in
/// `bun_sys::windows` / `bun_core::windows_sys` proper (CreateProcessW,
/// STARTUPINFOW, PROCESS_INFORMATION, TEB→PEB→ProcessParameters chain,
/// teb()). Layouts/signatures must match the originals; the `const _: () =
/// assert!(offset_of!...)` checks below pin the field offsets the shim
/// actually reads.
#[cfg(windows)]
pub mod compat {
    use core::ffi::c_void;

    pub use bun_windows_sys::*;
    // Distinct sub-module so `w::ntdll::NtClose` etc. resolve.
    pub use bun_windows_sys::ntdll;

    // ── aliases / consts not yet in bun_windows_sys ──
    pub type PVOID = *mut c_void;
    pub const ENABLE_VIRTUAL_TERMINAL_PROCESSING: DWORD = 0x0004;

    // ── kernel32 surface (bun_sys::windows::kernel32 layers extras on top
    //    of bun_windows_sys::kernel32; mirror just what the shim calls) ──
    pub mod kernel32 {
        use super::*;
        pub use bun_windows_sys::kernel32::*;
        pub use bun_windows_sys::externs::{
            GetConsoleMode, GetExitCodeProcess, SetConsoleMode, WaitForSingleObject,
        };
        // SAFETY: standard Win32 externs; signatures match SDK.
        #[link(name = "kernel32")]
        unsafe extern "system" {
            pub fn SetHandleInformation(hObject: HANDLE, dwMask: DWORD, dwFlags: DWORD) -> BOOL;
            pub fn CreateProcessW(
                lpApplicationName: LPCWSTR,
                lpCommandLine: LPWSTR,
                lpProcessAttributes: *mut c_void,
                lpThreadAttributes: *mut c_void,
                bInheritHandles: BOOL,
                dwCreationFlags: DWORD,
                lpEnvironment: *mut c_void,
                lpCurrentDirectory: LPCWSTR,
                lpStartupInfo: *mut STARTUPINFOW,
                lpProcessInformation: *mut PROCESS_INFORMATION,
            ) -> BOOL;
        }
    }

    // ── process-creation POD (processthreadsapi.h) ──
    #[repr(C)]
    pub struct STARTUPINFOW {
        pub cb: DWORD,
        pub lpReserved: PWSTR,
        pub lpDesktop: PWSTR,
        pub lpTitle: PWSTR,
        pub dwX: DWORD,
        pub dwY: DWORD,
        pub dwXSize: DWORD,
        pub dwYSize: DWORD,
        pub dwXCountChars: DWORD,
        pub dwYCountChars: DWORD,
        pub dwFillAttribute: DWORD,
        pub dwFlags: DWORD,
        pub wShowWindow: WORD,
        pub cbReserved2: WORD,
        pub lpReserved2: *mut u8,
        pub hStdInput: HANDLE,
        pub hStdOutput: HANDLE,
        pub hStdError: HANDLE,
    }
    #[repr(C)]
    pub struct PROCESS_INFORMATION {
        pub hProcess: HANDLE,
        pub hThread: HANDLE,
        pub dwProcessId: DWORD,
        pub dwThreadId: DWORD,
    }

    // ── TEB → PEB → RTL_USER_PROCESS_PARAMETERS chain (winternl/phnt) ──
    // Mirrors the minimal views in bun_core::windows_sys + bun_sys::windows.
    // Only the fields the shim dereferences are modelled; `offset_of!`
    // asserts pin them to the documented x64 offsets so a typo in the
    // padding arrays fails at compile time, not at runtime.
    #[repr(C)]
    pub struct Curdir {
        pub DosPath: UNICODE_STRING,
        pub Handle: HANDLE,
    }
    #[repr(C)]
    pub struct RTL_USER_PROCESS_PARAMETERS {
        _reserved1: [u8; 16],
        _reserved2: [*mut c_void; 2],
        pub hStdInput: HANDLE,
        pub hStdOutput: HANDLE,
        pub hStdError: HANDLE,
        pub CurrentDirectory: Curdir,
        pub DllPath: UNICODE_STRING,
        pub ImagePathName: UNICODE_STRING,
        pub CommandLine: UNICODE_STRING,
    }
    const _: () = assert!(core::mem::offset_of!(RTL_USER_PROCESS_PARAMETERS, hStdInput) == 0x20);
    const _: () = assert!(core::mem::offset_of!(RTL_USER_PROCESS_PARAMETERS, ImagePathName) == 0x60);
    #[repr(C)]
    pub struct PEB {
        _reserved1: [u8; 2],
        pub BeingDebugged: u8,
        _reserved2: [u8; 1],
        _reserved3: [*mut c_void; 2],
        pub Ldr: *mut c_void,
        pub ProcessParameters: *const RTL_USER_PROCESS_PARAMETERS,
    }
    #[repr(C)]
    pub struct TEB {
        _nt_tib: [*mut c_void; 7],
        pub EnvironmentPointer: *mut c_void,
        _client_id: [*mut c_void; 2],
        pub ActiveRpcHandle: *mut c_void,
        pub ThreadLocalStoragePointer: *mut c_void,
        pub ProcessEnvironmentBlock: *mut PEB,
    }
    const _: () = assert!(core::mem::offset_of!(TEB, ProcessEnvironmentBlock) == 0x60);

    /// `gs:[0x30]` (x64) / `x18` (ARM64) — Zig `std.os.windows.teb()`.
    ///
    /// # Safety
    /// Only sound on Windows targets (the segment register / x18 reservation
    /// is the OS thread-block pointer there). Guaranteed by `#[cfg(windows)]`
    /// on the enclosing module.
    #[inline(always)]
    pub unsafe fn teb() -> *mut TEB {
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let p: *mut TEB;
            core::arch::asm!("mov {}, gs:[0x30]", out(reg) p, options(nostack, pure, readonly));
            p
        }
        #[cfg(target_arch = "aarch64")]
        unsafe {
            let p: *mut TEB;
            core::arch::asm!("mov {}, x18", out(reg) p, options(nostack, pure, readonly));
            p
        }
    }
}
