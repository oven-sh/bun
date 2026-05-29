#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum OutKind {
    Stdout,
    Stderr,
}

pub use crate::api::bun_spawn::stdio::Stdio;

#[cfg(any(target_os = "linux", target_os = "android"))]
#[allow(dead_code)]
pub(crate) type WatchFd = core::ffi::c_int; // std.posix.fd_t

// ported from: src/shell/util.zig
