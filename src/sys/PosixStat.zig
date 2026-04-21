/// POSIX-like stat structure with birthtime support for node:fs.
/// Mirrors libuv's `uv_stat_t` (all `uint64_t` fields) so the native → JS
/// conversion matches Node.js exactly.
pub const PosixStat = extern struct {
    dev: u64,
    ino: u64,
    mode: u64,
    nlink: u64,
    uid: u64,
    gid: u64,
    rdev: u64,
    size: u64,
    blksize: u64,
    blocks: u64,

    /// Access time
    atim: bun.timespec,
    /// Modification time
    mtim: bun.timespec,
    /// Change time (metadata)
    ctim: bun.timespec,
    /// Birth time (creation time) - may be zero if not supported
    birthtim: bun.timespec,

    /// C's implicit integer → `uint64_t` conversion, i.e. what libuv does
    /// when copying platform `struct stat` fields into `uv_stat_t`.
    fn toU64(value: anytype) u64 {
        return switch (@typeInfo(@TypeOf(value)).int.signedness) {
            .signed => @bitCast(@as(i64, value)),
            .unsigned => value,
        };
    }

    /// Convert platform-specific bun.Stat to PosixStat
    pub fn init(stat_: *const bun.Stat) PosixStat {
        const atime_val = stat_.atime();
        const mtime_val = stat_.mtime();
        const ctime_val = stat_.ctime();
        const birthtime_val = if (Environment.isLinux)
            bun.timespec.epoch
        else
            stat_.birthtime();

        return PosixStat{
            .dev = toU64(stat_.dev),
            .ino = toU64(stat_.ino),
            .mode = toU64(stat_.mode),
            .nlink = toU64(stat_.nlink),
            .uid = toU64(stat_.uid),
            .gid = toU64(stat_.gid),
            .rdev = toU64(stat_.rdev),
            .size = toU64(stat_.size),
            .blksize = toU64(stat_.blksize),
            .blocks = toU64(stat_.blocks),
            .atim = .{ .sec = atime_val.sec, .nsec = atime_val.nsec },
            .mtim = .{ .sec = mtime_val.sec, .nsec = mtime_val.nsec },
            .ctim = .{ .sec = ctime_val.sec, .nsec = ctime_val.nsec },
            .birthtim = .{ .sec = birthtime_val.sec, .nsec = birthtime_val.nsec },
        };
    }

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

const bun = @import("bun");
const Environment = bun.Environment;
