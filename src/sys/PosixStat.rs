use crate::{Stat, Timespec};

/// POSIX-like stat structure with birthtime support for node:fs.
/// Mirrors libuv's `uv_stat_t` (all `uint64_t` fields) so the native → JS
/// conversion matches Node.js exactly.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct PosixStat {
    pub dev: u64,
    pub ino: u64,
    pub mode: u64,
    pub nlink: u64,
    pub uid: u64,
    pub gid: u64,
    pub rdev: u64,
    pub size: u64,
    pub blksize: u64,
    pub blocks: u64,

    /// Access time
    pub atim: Timespec,
    /// Modification time
    pub mtim: Timespec,
    /// Change time (metadata)
    pub ctim: Timespec,
    /// Birth time (creation time) - may be zero if not supported
    pub birthtim: Timespec,
}
// SAFETY: ten `u64` + four `Timespec{i64,i64}` fields; all-zero is the
// documented "no stat yet" value (see `node:fs` StatWatcher initial emit).
unsafe impl bun_core::ffi::Zeroable for PosixStat {}

/// C's implicit integer → `uint64_t` conversion, i.e. what libuv does
/// when copying platform `struct stat` fields into `uv_stat_t`.
//
// TODO(port): Zig used `@typeInfo(@TypeOf(value)).int.signedness` reflection.
// Rust has no equivalent; expressed here as a trait impl'd per primitive int.
trait ToU64: Copy {
    fn to_u64(self) -> u64;
}
macro_rules! impl_to_u64_signed {
    ($($t:ty),*) => {$(
        impl ToU64 for $t {
            #[inline]
            fn to_u64(self) -> u64 {
                // SAFETY-equivalent of Zig `@bitCast(@as(i64, value))`:
                // sign-extend to i64, then reinterpret bits as u64.
                self as i64 as u64
            }
        }
    )*};
}
macro_rules! impl_to_u64_unsigned {
    ($($t:ty),*) => {$(
        impl ToU64 for $t {
            #[inline]
            fn to_u64(self) -> u64 { self as u64 }
        }
    )*};
}
impl_to_u64_signed!(i8, i16, i32, i64, isize);
impl_to_u64_unsigned!(u8, u16, u32, u64, usize);

#[inline]
fn to_u64<T: ToU64>(value: T) -> u64 {
    value.to_u64()
}

/// Platform-specific accessors over `libc::stat` mirroring Zig's
/// `Stat.atime()` / `.mtime()` / `.ctime()` / `.birthtime()` helpers.
/// Exported so callers (e.g. `bunx_command.rs`) can read times off the bare
/// `bun_sys::Stat` (= `libc::stat`) without re-deriving the per-platform field
/// names.
// NOTE: the `libc` crate flattens Darwin/BSD `st_*timespec` into `st_*time` +
// `st_*time_nsec` (matching Linux), so the field access is uniform across all
// `unix` targets. The Zig std uses the nested `timespec` form; this is a
// deliberate divergence at the libc-crate layer, not a port bug.
#[inline]
pub fn stat_atime(s: &Stat) -> Timespec {
    #[cfg(unix)]
    {
        Timespec {
            sec: s.st_atime as i64,
            nsec: s.st_atime_nsec as i64,
        }
    }
    #[cfg(windows)]
    {
        Timespec {
            sec: s.atim.sec as i64,
            nsec: s.atim.nsec as i64,
        }
    }
}
#[inline]
pub fn stat_mtime(s: &Stat) -> Timespec {
    #[cfg(unix)]
    {
        Timespec {
            sec: s.st_mtime as i64,
            nsec: s.st_mtime_nsec as i64,
        }
    }
    #[cfg(windows)]
    {
        Timespec {
            sec: s.mtim.sec as i64,
            nsec: s.mtim.nsec as i64,
        }
    }
}
#[inline]
pub fn stat_ctime(s: &Stat) -> Timespec {
    #[cfg(unix)]
    {
        Timespec {
            sec: s.st_ctime as i64,
            nsec: s.st_ctime_nsec as i64,
        }
    }
    #[cfg(windows)]
    {
        Timespec {
            sec: s.ctim.sec as i64,
            nsec: s.ctim.nsec as i64,
        }
    }
}
#[inline]
pub fn stat_birthtime(s: &Stat) -> Timespec {
    // Zig spec: `if (Environment.isLinux) bun.timespec.epoch else stat_.birthtime()`.
    // Windows `Stat` is `uv_stat_t` and libuv fills `birthtim` from NTFS
    // CreationTime, so it must NOT fall into the epoch arm.
    #[cfg(windows)]
    {
        Timespec {
            sec: s.birthtim.sec as i64,
            nsec: s.birthtim.nsec as i64,
        }
    }
    #[cfg(any(
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    ))]
    {
        Timespec {
            sec: s.st_birthtime as i64,
            nsec: s.st_birthtime_nsec as i64,
        }
    }
    #[cfg(not(any(
        windows,
        target_os = "macos",
        target_os = "ios",
        target_os = "freebsd",
        target_os = "openbsd",
        target_os = "netbsd",
        target_os = "dragonfly"
    )))]
    {
        let _ = s;
        Timespec::EPOCH
    }
}

impl PosixStat {
    /// Convert platform-specific bun.Stat to PosixStat
    pub fn init(stat_: &Stat) -> PosixStat {
        let atime_val = stat_atime(stat_);
        let mtime_val = stat_mtime(stat_);
        let ctime_val = stat_ctime(stat_);
        let birthtime_val = stat_birthtime(stat_);

        #[cfg(unix)]
        {
            PosixStat {
                dev: to_u64(stat_.st_dev),
                ino: to_u64(stat_.st_ino),
                mode: to_u64(stat_.st_mode),
                nlink: to_u64(stat_.st_nlink),
                uid: to_u64(stat_.st_uid),
                gid: to_u64(stat_.st_gid),
                rdev: to_u64(stat_.st_rdev),
                size: to_u64(stat_.st_size),
                blksize: to_u64(stat_.st_blksize),
                blocks: to_u64(stat_.st_blocks),
                atim: atime_val,
                mtim: mtime_val,
                ctim: ctime_val,
                birthtim: birthtime_val,
            }
        }
        #[cfg(windows)]
        {
            // Windows `Stat` is libuv `uv_stat_t` — `st_*`-named u64 fields
            // (matches uv.h; see libuv.rs `uv_stat_t`).
            PosixStat {
                dev: stat_.st_dev,
                ino: stat_.st_ino,
                mode: stat_.st_mode,
                nlink: stat_.st_nlink,
                uid: stat_.st_uid,
                gid: stat_.st_gid,
                rdev: stat_.st_rdev,
                size: stat_.st_size,
                blksize: stat_.st_blksize,
                blocks: stat_.st_blocks,
                atim: atime_val,
                mtim: mtime_val,
                ctim: ctime_val,
                birthtim: birthtime_val,
            }
        }
    }

    pub fn atime(&self) -> Timespec {
        self.atim
    }

    pub fn mtime(&self) -> Timespec {
        self.mtim
    }

    pub fn ctime(&self) -> Timespec {
        self.ctim
    }

    pub fn birthtime(&self) -> Timespec {
        self.birthtim
    }
}

// ported from: src/sys/PosixStat.zig
