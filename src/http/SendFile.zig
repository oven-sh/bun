const SendFile = @This();

fd: bun.FileDescriptor,
remain: usize = 0,
offset: usize = 0,
content_size: usize = 0,

pub fn isEligible(url: bun.URL) bool {
    if (comptime Environment.isWindows or !FeatureFlags.streaming_file_uploads_for_http_client) {
        return false;
    }
    return url.isHTTP() and url.href.len > 0;
}

pub fn write(
    this: *SendFile,
    socket: NewHTTPContext(false).HTTPSocket,
) Status {
    const adjusted_count_temporary = @min(@as(u64, this.remain), @as(u63, std.math.maxInt(u63)));
    // TODO we should not need this int cast; improve the return type of `@min`
    const adjusted_count = @as(u63, @intCast(adjusted_count_temporary));

    if (Environment.isLinux) {
        var signed_offset = @as(i64, @intCast(this.offset));
        const begin = this.offset;
        const val =
            // this does the syscall directly, without libc
            std.os.linux.sendfile(socket.fd().cast(), this.fd.cast(), &signed_offset, this.remain);
        this.offset = @as(u64, @intCast(signed_offset));

        const errcode = bun.sys.getErrno(val);

        this.remain -|= @as(u64, @intCast(this.offset -| begin));

        if (errcode != .SUCCESS or this.remain == 0 or val == 0) {
            if (errcode == .SUCCESS) {
                return .{ .done = {} };
            }

            return .{ .err = bun.errnoToZigErr(errcode) };
        }
    } else if (Environment.isPosix) {
        var sbytes: std.posix.off_t = adjusted_count;
        const signed_offset = @as(i64, @bitCast(@as(u64, this.offset)));
        const errcode = bun.sys.getErrno(std.c.sendfile(
            this.fd.cast(),
            socket.fd().cast(),
            signed_offset,
            &sbytes,
            null,
            0,
        ));
        const wrote = @as(u64, @intCast(sbytes));
        this.offset +|= wrote;
        this.remain -|= wrote;
        if (errcode != .AGAIN or this.remain == 0 or sbytes == 0) {
            if (errcode == .SUCCESS) {
                return .{ .done = {} };
            }

            return .{ .err = bun.errnoToZigErr(errcode) };
        }
    }

    return .{ .again = {} };
}

pub const Status = union(enum) {
    done: void,
    err: anyerror,
    again: void,
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const NewHTTPContext = bun.http.NewHTTPContext;
