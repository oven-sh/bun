#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

#![warn(unreachable_pub)]
#[cfg(target_os = "macos")] pub mod darwin_errno;
#[cfg(target_os = "macos")] pub use darwin_errno::{*, posix};
#[cfg(target_os = "freebsd")] pub mod freebsd_errno;
#[cfg(target_os = "freebsd")] pub use freebsd_errno::{*, posix};
#[cfg(target_os = "linux")] pub mod linux_errno;
#[cfg(target_os = "linux")] pub use linux_errno::{*, posix};
#[cfg(windows)] pub mod windows_errno;
#[cfg(windows)] pub use windows_errno::*;

impl SystemErrno {
    /// Zig: `@enumFromInt(n)`. Unchecked discriminant cast; debug-asserts `n < MAX`.
    #[inline]
    pub fn from_int(n: u16) -> SystemErrno {
        debug_assert!((n as usize) < (Self::MAX as usize));
        // SAFETY: caller guarantees n < MAX; #[repr(u16)] with contiguous discriminants.
        unsafe { core::mem::transmute::<u16, SystemErrno>(n) }
    }
}

impl bun_core::output::ErrName for SystemErrno {
    fn name(&self) -> &[u8] {
        <&'static str>::from(*self).as_bytes()
    }
}
