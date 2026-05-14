use bun_sys::Fd;

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum OutKind {
    Stdout,
    Stderr,
}

impl OutKind {
    pub fn to_fd(self) -> Fd {
        match self {
            OutKind::Stdout => Fd::stdout(),
            OutKind::Stderr => Fd::stderr(),
        }
    }
}

// Spec (util.zig): `pub const Stdio = bun.spawn.Stdio;` — the user-facing
// stdio union with `isPiped()` from `runtime/api/bun/spawn/stdio.zig`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub use crate::api::bun_spawn::stdio::Stdio;

#[cfg(target_os = "linux")]
pub type WatchFd = core::ffi::c_int; // std.posix.fd_t
#[cfg(not(target_os = "linux"))]
pub type WatchFd = i32;

// ported from: src/shell/util.zig
