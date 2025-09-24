const std = @import("std");
const c = @cImport({
    @cInclude("stdlib.h");
});

const Logger = struct {
    var log_file: ?std.fs.File = null;
    var proc_id: std.os.windows.DWORD = 0;
    var name_buf: [64]u8 = undefined;
    var name: []u8 = undefined;

    export fn cleanup() void {
        if (Logger.log_file) |*file| {
            file.sync() catch {
                @panic("Failed to flush mlog.txt: {any}\n");
            };

            file.close();
            Logger.log_file = null;
        }
    }

    fn getAndOpenFile() *std.fs.File {
        if (Logger.log_file) |*file| {
            return file;
        }

        Logger.proc_id = std.os.windows.GetCurrentProcessId();

        var gpa = std.heap.GeneralPurposeAllocator(.{}){};
        defer _ = gpa.deinit();

        var cwd = std.fs.cwd();

        Logger.name = std.fmt.bufPrint(&name_buf, "mlog_{}.txt", .{Logger.proc_id}) catch {
            @panic("Failed to format mlog filename: {any}\n");
        };

        Logger.log_file = cwd.openFile(Logger.name, .{
            .mode = .read_write,
        }) catch
            cwd.createFile(
                Logger.name,
                .{
                    .read = true,
                    .truncate = true,
                },
            ) catch
            @panic("Failed to create mlog.txt: {any}\n");

        _ = c.atexit(cleanup);

        return &(Logger.log_file orelse unreachable);
    }

    pub fn log(comptime fmt: []const u8, args: anytype) void {
        const file = Logger.getAndOpenFile();

        const writer = file.writer();

        const nanos = std.time.nanoTimestamp();
        std.fmt.format(writer, "[{}] (pid {}) " ++ fmt, .{ nanos, Logger.proc_id } ++ args) catch {
            @panic("Failed to write to mlog.txt: {any}\n");
        };

        std.debug.print("Saved output to {s}.\n", .{name_buf});
    }
};

pub const log = Logger.log;
