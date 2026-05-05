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

// TODO(port): verify crate path for bun.spawn.Stdio in Phase B
pub use bun_spawn::Stdio;

#[cfg(target_os = "linux")]
pub type WatchFd = core::ffi::c_int; // std.posix.fd_t
#[cfg(not(target_os = "linux"))]
pub type WatchFd = i32;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/shell/util.zig (21 lines)
//   confidence: high
//   todos:      1
//   notes:      Stdio re-export crate path (bun_spawn) needs Phase B verification
// ──────────────────────────────────────────────────────────────────────────
