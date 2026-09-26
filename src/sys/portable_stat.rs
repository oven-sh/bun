//! `Stat` in the portable image.
//!
//! A build for POSIX has the `struct stat` of its C library, a build for Windows the `uv_stat_t` of
//! libuv for Windows. The portable image runs on both and has one type for its callers: the fields of
//! `uv_stat_t`, which name everything that either one holds, with 64 bits for the seconds of a time
//! (the `long` of `uv_timespec_t` has 32 on Windows). The code for one OS still fills the structure of
//! its OS (`crate::flavor`), and the function that picks by host converts.

use bun_core::Timespec;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Stat {
    pub st_dev: u64,
    pub st_mode: u64,
    pub st_nlink: u64,
    pub st_uid: u64,
    pub st_gid: u64,
    pub st_rdev: u64,
    pub st_ino: u64,
    pub st_size: u64,
    pub st_blksize: u64,
    pub st_blocks: u64,
    pub st_flags: u64,
    pub st_gen: u64,
    pub atim: Timespec,
    pub mtim: Timespec,
    pub ctim: Timespec,
    pub birthtim: Timespec,
}

// SAFETY: integers only.
unsafe impl bun_core::ffi::Zeroable for Stat {}

/// The `struct stat` of the image's C library, as libuv fills its `uv_stat_t` from one on Linux: the
/// time of the last change of status stands for the time of birth, which the structure does not have.
impl From<libc::stat> for Stat {
    fn from(stat: libc::stat) -> Stat {
        let change = Timespec {
            sec: stat.st_ctime,
            nsec: stat.st_ctime_nsec,
        };
        Stat {
            st_dev: stat.st_dev,
            st_mode: u64::from(stat.st_mode),
            st_nlink: stat.st_nlink,
            st_uid: u64::from(stat.st_uid),
            st_gid: u64::from(stat.st_gid),
            st_rdev: stat.st_rdev,
            st_ino: stat.st_ino,
            st_size: stat.st_size as u64,
            st_blksize: stat.st_blksize as u64,
            st_blocks: stat.st_blocks as u64,
            st_flags: 0,
            st_gen: 0,
            atim: Timespec {
                sec: stat.st_atime,
                nsec: stat.st_atime_nsec,
            },
            mtim: Timespec {
                sec: stat.st_mtime,
                nsec: stat.st_mtime_nsec,
            },
            ctim: change,
            birthtim: change,
        }
    }
}

impl From<bun_libuv_sys::uv_stat_t> for Stat {
    fn from(stat: bun_libuv_sys::uv_stat_t) -> Stat {
        let time = |time: bun_libuv_sys::uv_timespec_t| Timespec {
            sec: i64::from(time.sec),
            nsec: i64::from(time.nsec),
        };
        Stat {
            st_dev: stat.st_dev,
            st_mode: stat.st_mode,
            st_nlink: stat.st_nlink,
            st_uid: stat.st_uid,
            st_gid: stat.st_gid,
            st_rdev: stat.st_rdev,
            st_ino: stat.st_ino,
            st_size: stat.st_size,
            st_blksize: stat.st_blksize,
            st_blocks: stat.st_blocks,
            st_flags: stat.st_flags,
            st_gen: stat.st_gen,
            atim: time(stat.atim),
            mtim: time(stat.mtim),
            ctim: time(stat.ctim),
            birthtim: time(stat.birthtim),
        }
    }
}
