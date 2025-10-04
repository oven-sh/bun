const bun = @import("../bun.zig");

/// POSIX-like stat structure with birthtime support for node:fs
/// This extends the standard POSIX stat with birthtime (creation time)
pub const PosixStat = extern struct {
    dev: u64,
    ino: u64,
    mode: u32,
    nlink: u64,
    uid: u32,
    gid: u32,
    rdev: u64,
    size: i64,
    blksize: i64,
    blocks: i64,

    /// Access time
    atim: bun.timespec,
    /// Modification time
    mtim: bun.timespec,
    /// Change time (metadata)
    ctim: bun.timespec,
    /// Birth time (creation time) - may be zero if not supported
    birthtim: bun.timespec,

    pub fn atime(self: *const PosixStat) bun.timespec {
        return self.atim;
    }

    pub fn mtime(self: *const PosixStat) bun.timespec {
        return self.mtim;
    }

    pub fn ctime(self: *const PosixStat) bun.timespec {
        return self.ctim;
    }

    pub fn birthtime(self: *const PosixStat) bun.timespec {
        return self.birthtim;
    }
};
