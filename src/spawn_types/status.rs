use core::ffi::c_int;

use bun_spawn_sys::PidT;
use bun_sys::Maybe;

/// `posix_spawn::WaitPidResult` from the leaf spawn-sys crate. Its `status`
/// field is `u32` there because the Zig source bitcasts the OS `c_int`; `Status::from`
/// casts it back before calling libc's `W*` helpers.
#[cfg(unix)]
pub use bun_spawn_sys::posix_spawn::posix_spawn::WaitPidResult;

#[cfg(windows)]
#[derive(Clone, Copy)]
pub struct WaitPidResult {
    pub pid: PidT,
    pub status: c_int,
}

// PORT NOTE: not `Copy` because `bun_sys::Error` carries owned `Box<[u8]>`
// path/dest fields. The Zig `union(enum)` was copyable because its `.err` arm
// borrowed the path; the Rust port owns it. Callers use `.clone()`.
#[derive(Clone, Debug, Default)]
pub enum Status {
    #[default]
    Running,
    Exited(Exited),
    /// Raw signal byte. Zig stores `.signaled: bun.SignalCode`, where
    /// `SignalCode` is a non-exhaustive `enum(u8)`, so any `u8` is a valid
    /// payload. `bun_core::SignalCode` is exhaustive 1..=31, so storing that
    /// enum here would force lossy `Signaled -> Exited` rewrites for RT signals
    /// on Linux, observable as `{exitCode:0, signal:null}` in JS.
    Signaled(u8),
    Err(bun_sys::Error),
}

#[derive(Clone, Copy, Debug, Default)]
pub struct Exited {
    pub code: u8,
    /// Raw signal number. `0` means "no signal" (Zig: open `enum(u8)` with an
    /// explicit zero variant). `SignalCode` discriminants are 1..=31; storing
    /// it as that enum and transmuting `0` would be UB. Convert through
    /// `Status::signal_code`.
    pub signal: u8,
}

impl Status {
    #[inline]
    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Exited(Exited { code: 0, .. }))
    }

    #[inline]
    pub fn exit_code(&self) -> Option<u8> {
        match self {
            Self::Exited(exited) => Some(exited.code),
            _ => None,
        }
    }

    #[inline]
    pub fn signal_code(&self) -> Option<bun_core::SignalCode> {
        let raw = match self {
            Self::Signaled(signal) => *signal,
            Self::Exited(exited) => exited.signal,
            _ => return None,
        };

        bun_core::SignalCode::from_raw(raw)
    }

    #[cfg(unix)]
    pub fn from(pid: PidT, waitpid_result: &Maybe<WaitPidResult>) -> Option<Status> {
        let mut exit_code: Option<u8> = None;
        let mut signal: Option<u8> = None;

        match waitpid_result {
            Err(err_) => {
                return Some(Status::Err(err_.clone()));
            }
            Ok(result) => {
                if result.pid != pid {
                    return None;
                }

                // `WaitPidResult.status` is `u32` in `bun_spawn_sys` because the
                // Zig source bitcasts it; libc's `W*` helpers want `c_int`.
                let status = result.status as c_int;

                if libc::WIFEXITED(status) {
                    exit_code = Some(libc::WEXITSTATUS(status) as u8);
                }

                if libc::WIFSIGNALED(status) {
                    signal = Some(libc::WTERMSIG(status) as u8);
                } else if libc::WIFSTOPPED(status) {
                    // A stopped child is possible only when the wait call used
                    // WUNTRACED or the child is being traced. Preserve the raw
                    // signal byte and let `signal_code()` range-check later.
                    signal = Some(libc::WSTOPSIG(status) as u8);
                }
            }
        }

        if let Some(code) = exit_code {
            return Some(Status::Exited(Exited {
                code,
                signal: signal.unwrap_or(0),
            }));
        } else if let Some(sig) = signal {
            // Zig used `@enumFromInt(signal.?)` into a non-exhaustive enum; any
            // byte is valid. Carry the raw byte here.
            return Some(Status::Signaled(sig));
        }

        None
    }
}

/// Local shim for `bun.SignalCode.toExitCode` (lives in `src/sys/SignalCode.zig`).
/// Shell convention: 128 + signal number for signals 1..=31, else `None`.
pub trait SignalCodeExt {
    fn to_exit_code(self) -> Option<u8>;
}

impl SignalCodeExt for bun_core::SignalCode {
    #[inline]
    fn to_exit_code(self) -> Option<u8> {
        let n = self as u8;
        if (1..=31).contains(&n) {
            Some(128u8.wrapping_add(n))
        } else {
            None
        }
    }
}

impl core::fmt::Display for Status {
    fn fmt(&self, writer: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        if let Some(signal_code) = self.signal_code()
            && let Some(code) = signal_code.to_exit_code()
        {
            return write!(writer, "code: {code}");
        }

        match self {
            Status::Exited(exit) => write!(writer, "code: {}", exit.code),
            Status::Signaled(signal) => write!(writer, "signal: {signal}"),
            Status::Err(err) => write!(writer, "{err}"),
            _ => Ok(()),
        }
    }
}
