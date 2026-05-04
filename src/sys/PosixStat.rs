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

impl PosixStat {
    /// Convert platform-specific bun.Stat to PosixStat
    pub fn init(stat_: &Stat) -> PosixStat {
        let atime_val = stat_.atime();
        let mtime_val = stat_.mtime();
        let ctime_val = stat_.ctime();
        let birthtime_val = {
            #[cfg(target_os = "linux")]
            {
                Timespec::EPOCH
            }
            #[cfg(not(target_os = "linux"))]
            {
                stat_.birthtime()
            }
        };

        PosixStat {
            dev: to_u64(stat_.dev),
            ino: to_u64(stat_.ino),
            mode: to_u64(stat_.mode),
            nlink: to_u64(stat_.nlink),
            uid: to_u64(stat_.uid),
            gid: to_u64(stat_.gid),
            rdev: to_u64(stat_.rdev),
            size: to_u64(stat_.size),
            blksize: to_u64(stat_.blksize),
            blocks: to_u64(stat_.blocks),
            atim: Timespec { sec: atime_val.sec, nsec: atime_val.nsec },
            mtim: Timespec { sec: mtime_val.sec, nsec: mtime_val.nsec },
            ctim: Timespec { sec: ctime_val.sec, nsec: ctime_val.nsec },
            birthtim: Timespec { sec: birthtime_val.sec, nsec: birthtime_val.nsec },
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/sys/PosixStat.zig (80 lines)
//   confidence: high
//   todos:      1
//   notes:      to_u64 @typeInfo reflection ported as trait+macro over primitive ints; Stat field access (.dev etc.) may need accessor methods in Phase B
// ──────────────────────────────────────────────────────────────────────────
