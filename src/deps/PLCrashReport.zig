const root = @import("root");
const std = @import("std");

extern fn PLCrashReportStart(version: [*:0]const u8, base_path: [*:0]const u8) bool;
extern fn PLCrashReportGenerate() void;
extern fn PLCrashReportLoadPending() ?*anyopaque;
extern fn copyCrashReportPath(buf: *[1024]u8) u16;

pub export fn PLCrashReportHandler(_: ?*anyopaque) void {
    root.PLCrashReportHandler();
}
export fn mkdirp(file_path: [*c]const u8) void {
    var path = std.fs.path.dirname(std.mem.span(file_path orelse return)) orelse return;
    std.fs.cwd().makePath(path) catch {};
}

pub fn start(
    comptime version: [*:0]const u8,
) bool {
    has_started = true;
    var base_path_buf: [1024]u8 = undefined;
    var base_path: [:0]const u8 = "";
    const crash_path = "/crash/" ++ version ++ "/";
    if (std.os.getenvZ("BUN_INSTALL")) |bun_install| {
        @memcpy(&base_path_buf, bun_install.ptr, bun_install.len);
        std.mem.copy(u8, base_path_buf[bun_install.len..], crash_path);
        base_path_buf[bun_install.len + crash_path.len] = 0;
        base_path = base_path_buf[0 .. bun_install.len + crash_path.len :0];
    } else {
        base_path = "/tmp/bun" ++ crash_path;
        base_path_buf["/tmp/bun".len + crash_path.len] = 0;
    }
    return PLCrashReportStart(version, base_path.ptr);
}

pub fn generate() void {
    return PLCrashReportGenerate();
}
var has_started = false;

pub fn crashReportPath(buf: *[1024]u8) []const u8 {
    if (!has_started) return "";

    const len = copyCrashReportPath(buf);
    return buf[0..len];
}
