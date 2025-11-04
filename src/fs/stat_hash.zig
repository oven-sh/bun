value: u64 = 0,

last_modified_u64: u64 = 0,
last_modified_buffer: [32]u8 = undefined,
last_modified_buffer_len: u8 = 0,

// TODO: add etag support here!

pub fn hash(this: *@This(), stat: bun.Stat, path: []const u8) void {
    var stat_hasher = std.hash.XxHash64.init(42);
    stat_hasher.update(std.mem.asBytes(&stat.size));
    stat_hasher.update(std.mem.asBytes(&stat.mode));
    stat_hasher.update(std.mem.asBytes(&stat.mtime()));
    stat_hasher.update(std.mem.asBytes(&stat.ino));
    stat_hasher.update(path);

    const prev = this.value;
    this.value = stat_hasher.final();

    if (prev != this.value and bun.S.ISREG(@intCast(stat.mode))) {
        const mtime_timespec = stat.mtime();
        // Clamp negative values to 0 to avoid timestamp overflow issues on Windows
        const mtime = bun.timespec{
            .nsec = @intCast(@max(mtime_timespec.nsec, 0)),
            .sec = @intCast(@max(mtime_timespec.sec, 0)),
        };
        if (mtime.ms() > 0) {
            this.last_modified_buffer_len = @intCast(bun.jsc.wtf.writeHTTPDate(&this.last_modified_buffer, mtime.msUnsigned()).len);
            this.last_modified_u64 = mtime.msUnsigned();
        } else {
            this.last_modified_buffer_len = 0;
            this.last_modified_u64 = 0;
        }
    } else if (!bun.S.ISREG(@intCast(stat.mode))) {
        this.last_modified_buffer_len = 0;
        this.last_modified_u64 = 0;
    }
}

pub fn lastModified(this: *const @This()) ?[]const u8 {
    if (this.last_modified_buffer_len == 0) {
        return null;
    }

    return this.last_modified_buffer[0..this.last_modified_buffer_len];
}

const bun = @import("bun");
const std = @import("std");
