/// POSIX-like stat structure with birthtime support for node:fs
/// This extends the standard POSIX stat with birthtime (creation time)
pub const PosixStat = extern struct {
    dev: @FieldType(bun.Stat, "dev"),
    ino: @FieldType(bun.Stat, "ino"),
    mode: @FieldType(bun.Stat, "mode"),
    nlink: @FieldType(bun.Stat, "nlink"),
    uid: @FieldType(bun.Stat, "uid"),
    gid: @FieldType(bun.Stat, "gid"),
    rdev: @FieldType(bun.Stat, "rdev"),
    size: @FieldType(bun.Stat, "size"),
    blksize: @FieldType(bun.Stat, "blksize"),
    blocks: @FieldType(bun.Stat, "blocks"),

    /// Access time
    atim: bun.timespec,
    /// Modification time
    mtim: bun.timespec,
    /// Change time (metadata)
    ctim: bun.timespec,
    /// Birth time (creation time) - may be zero if not supported
    birthtim: bun.timespec,

    /// Convert platform-specific bun.Stat to PosixStat
    pub fn init(stat_: *const bun.Stat) PosixStat {
        if (Environment.isWindows) {
            // Windows: all fields need casting
            const atime_val = stat_.atime();
            const mtime_val = stat_.mtime();
            const ctime_val = stat_.ctime();
            const birthtime_val = stat_.birthtime();

            return PosixStat{
                .dev = @intCast(stat_.dev),
                .ino = @intCast(stat_.ino),
                .mode = @intCast(stat_.mode),
                .nlink = @intCast(stat_.nlink),
                .uid = @intCast(stat_.uid),
                .gid = @intCast(stat_.gid),
                .rdev = @intCast(stat_.rdev),
                .size = @intCast(stat_.size),
                .blksize = @intCast(stat_.blksize),
                .blocks = @intCast(stat_.blocks),
                .atim = .{ .sec = atime_val.sec, .nsec = atime_val.nsec },
                .mtim = .{ .sec = mtime_val.sec, .nsec = mtime_val.nsec },
                .ctim = .{ .sec = ctime_val.sec, .nsec = ctime_val.nsec },
                .birthtim = .{ .sec = birthtime_val.sec, .nsec = birthtime_val.nsec },
            };
        } else {
            // POSIX (Linux/macOS): use accessor methods and cast types
            const atime_val = stat_.atime();
            const mtime_val = stat_.mtime();
            const ctime_val = stat_.ctime();
            const birthtime_val = if (Environment.isLinux)
                bun.timespec.epoch
            else
                stat_.birthtime();

            return PosixStat{
                .dev = @intCast(stat_.dev),
                .ino = @intCast(stat_.ino),
                .mode = @intCast(stat_.mode),
                .nlink = @intCast(stat_.nlink),
                .uid = @intCast(stat_.uid),
                .gid = @intCast(stat_.gid),
                .rdev = @intCast(stat_.rdev),
                .size = @intCast(stat_.size),
                .blksize = @intCast(stat_.blksize),
                .blocks = @intCast(stat_.blocks),
                .atim = .{ .sec = atime_val.sec, .nsec = atime_val.nsec },
                .mtim = .{ .sec = mtime_val.sec, .nsec = mtime_val.nsec },
                .ctim = .{ .sec = ctime_val.sec, .nsec = ctime_val.nsec },
                .birthtim = .{ .sec = birthtime_val.sec, .nsec = birthtime_val.nsec },
            };
        }
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
