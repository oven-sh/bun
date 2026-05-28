#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum OutKind {
    Stdout,
    Stderr,
}

// Spec (util.zig): `pub const Stdio = bun.spawn.Stdio;` — the user-facing
// stdio union with `isPiped()` from `runtime/api/bun/spawn/stdio.zig`, NOT the
// low-level `PosixStdio`/`WindowsStdio` spawn-option shape that the
// `bun_spawn` *crate* re-exports under the same name.
pub use crate::api::bun_spawn::stdio::Stdio;

#[cfg(any(target_os = "linux", target_os = "android"))]
#[allow(dead_code)]
pub(crate) type WatchFd = core::ffi::c_int; // std.posix.fd_t

// ported from: src/shell/util.zig
