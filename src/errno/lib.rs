#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![warn(unused_must_use)]

#![warn(unreachable_pub)]

// Shared by Linux/Darwin/FreeBSD: libc syscall wrappers signal failure with the
// same-width all-ones sentinel (`-1` signed / `MAX` unsigned — Zig's
// `@bitCast(...) == -1`) and stash the real errno in a thread-local. Only the
// per-OS INVOCATION lists differ: notably Linux keeps a bespoke `usize` impl
// that decodes raw-syscall `-errno`-in-retval and MUST NOT route through this.
// Declared before the `mod` lines so textual-order macro visibility reaches them.
#[cfg(not(windows))]
macro_rules! impl_get_errno_libc {
    ($($t:ty),+ $(,)?) => {$(
        impl $crate::GetErrno for $t {
            #[inline]
            fn get_errno(self) -> $crate::E {
                // Zig bitcasts unsigned → SAME-width signed before `== -1`.
                // `as i64` would zero-extend u32, never matching -1. Compare
                // against the type's own all-ones value instead (== -1 for
                // signed, == MAX for unsigned — both are libc's failure rc).
                if self == !(0 as $t) {
                    $crate::E::from_raw($crate::posix::errno() as u16)
                } else {
                    $crate::E::SUCCESS
                }
            }
        }
    )+};
}

#[cfg(target_os = "macos")] pub mod darwin_errno;
#[cfg(target_os = "macos")] pub use darwin_errno::{*, posix};
#[cfg(target_os = "freebsd")] pub mod freebsd_errno;
#[cfg(target_os = "freebsd")] pub use freebsd_errno::{*, posix};
// Android shares the Linux kernel errno space (bionic copies <asm/errno.h>),
// so it uses the same per-errno enum. Rust splits `target_os` into
// `linux`/`android` (Zig keeps both as `os.tag == .linux`), so list both.
#[cfg(any(target_os = "linux", target_os = "android"))] pub mod linux_errno;
#[cfg(any(target_os = "linux", target_os = "android"))] pub use linux_errno::{*, posix};
#[cfg(windows)] pub mod windows_errno;
#[cfg(windows)] pub use windows_errno::{*, posix};

/// Zig's `getErrno(rc: anytype)` switches on `@TypeOf(rc)` to pick the errno
/// extraction strategy. Rust has no type-switch, so we model it as a trait with
/// per-type impls — call as `rc.get_errno()` or `get_errno(rc)`.
///
/// The trait declaration is target-independent; each per-OS module supplies its
/// own `impl GetErrno for {i32,u32,isize,usize,...}` (Linux decodes raw-syscall
/// `-errno` from `usize`, Darwin/FreeBSD read thread-local errno on `-1`,
/// Windows ignores `rc` and reads `GetLastError()`/`WSAGetLastError()`).
pub trait GetErrno: Copy {
    fn get_errno(self) -> E;
}

// Free-function shim mirroring Zig's `getErrno(rc)` call shape. POSIX-only:
// Windows defines its own divergent `get_errno<T>(_rc)` (no trait bound, reads
// GetLastError/WSAGetLastError) in windows_errno.rs.
#[cfg(not(windows))]
#[inline]
pub fn get_errno<T: GetErrno>(rc: T) -> E {
    rc.get_errno()
}

impl SystemErrno {
    /// Zig: `@enumFromInt(n)`. Unchecked discriminant cast.
    ///
    /// On POSIX the enum is dense `0..MAX`, so we debug-assert `n < MAX`.
    /// On Windows the enum is **sparse** (dense `0..=137` plus isolated `UV_E*`
    /// discriminants in the ~3000-4095 range — see windows_errno.rs), so the
    /// `< MAX` bound does not hold for valid tags and the assert is skipped.
    #[inline]
    pub const fn from_raw(n: u16) -> SystemErrno {
        // `as usize` on both sides papers over per-OS `MAX` typing (POSIX `u16`
        // vs Windows `usize`) without normalizing the constant itself.
        #[cfg(not(windows))]
        debug_assert!((n as usize) < (Self::MAX as usize));
        // SAFETY: caller guarantees `n` is a declared `#[repr(u16)]` discriminant
        // of `SystemErrno` (Zig `@enumFromInt` precondition). The enum is NOT
        // contiguous on Windows; do not assume `n < MAX` implies validity there.
        unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
    }
}

#[cfg(not(windows))]
impl SystemErrno {
    // TODO(port): Zig `anytype` accepted any integer width (signed or unsigned).
    // i64 covers every concrete call site (errno-range values); revisit if a
    // caller passes u64/usize directly.
    //
    // Windows defines its own `init<C: SystemErrnoInit>` (typed dispatch over
    // DWORD/c_int/Win32Error) in windows_errno.rs, so this impl is POSIX-only.
    pub fn init(code: i64) -> Option<SystemErrno> {
        if code < 0 {
            if code <= -(Self::MAX as i64) {
                return None;
            }
            return Some(Self::from_raw((-code) as u16));
        }
        if code >= Self::MAX as i64 {
            return None;
        }
        Some(Self::from_raw(code as u16))
    }
}

impl bun_core::output::ErrName for SystemErrno {
    fn name(&self) -> &[u8] {
        <&'static str>::from(*self).as_bytes()
    }
}
