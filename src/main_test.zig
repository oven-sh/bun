const std = @import("std");
const builtin = @import("builtin");
pub const bun = @import("./bun.zig");
const Output = bun.Output;
const Environment = bun.Environment;
const recover = @import("test/recover.zig");

// pub const panic = bun.crash_handler.panic;
pub const panic = recover.panic;
pub const std_options = std.Options{
    .enable_segfault_handler = false,
};

pub const io_mode = .blocking;

comptime {
    bun.assert(builtin.target.cpu.arch.endian() == .little);
}

pub extern "C" var _environ: ?*anyopaque;
pub extern "C" var environ: ?*anyopaque;

pub fn main() void {
    std.debug.print("tests are running\n", .{});
    // bun.crash_handler.init();

    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    if (Environment.isWindows) {
        _ = bun.windows.libuv.uv_replace_allocator(
            @ptrCast(&bun.Mimalloc.mi_malloc),
            @ptrCast(&bun.Mimalloc.mi_realloc),
            @ptrCast(&bun.Mimalloc.mi_calloc),
            @ptrCast(&bun.Mimalloc.mi_free),
        );
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
    }

    bun.start_time = std.time.nanoTimestamp();
    bun.initArgv(bun.default_allocator) catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    Output.Source.Stdio.init();
    defer Output.flush();
    bun.StackCheck.configureThread();
    const exit_code = runTests();
    bun.Global.exit(exit_code);
}

const Stats = struct {
    pass: u32 = 0,
    fail: u32 = 0,
    leak: u32 = 0,
    panic: u32 = 0,

    pub fn total(this: *const Stats) u32 {
        return this.pass + this.fail + this.leak + this.panic;
    }

    pub fn exitCode(this: *const Stats) u8 {
        var result: u8 = 0;
        if (this.fail > 0) result |= 1;
        if (this.leak > 0) result |= 2;
        if (this.panic > 0) result |= 4;
        return result;
    }
};

fn runTests() u8 {
    var stats = Stats{};
    const all_start = std.time.milliTimestamp();
    var stderr = std.io.getStdErr();

    for (builtin.test_functions) |t| {
        std.testing.allocator_instance = .{};

        var did_lock = true;
        stderr.lock(.exclusive) catch {
            did_lock = false;
        };
        defer if (did_lock) stderr.unlock();

        const start = std.time.milliTimestamp();
        const result = recover.callForTest(t.func);
        const elapsed = std.time.milliTimestamp() - start;

        const name = extractName(t);
        const memory_check = std.testing.allocator_instance.deinit();

        if (result) |_| {
            if (memory_check == .leak) {
                Output.pretty("<yellow>leak</r> - {s} <i>({d}ms)</r>\n", .{ name, elapsed });
                stats.leak += 1;
            } else {
                Output.pretty("<green>pass</r> - {s} <i>({d}ms)</r>\n", .{ name, elapsed });
                stats.pass += 1;
            }
        } else |err| {
            switch (err) {
                error.Panic => {
                    Output.pretty("<magenta><b>panic</r> - {s} <i>({d}ms)</r>\n{s}", .{ t.name, elapsed, @errorName(err) });
                    stats.panic += 1;
                },
                else => {
                    Output.pretty("<red>fail</r> - {s} <i>({d}ms)</r>\n{s}", .{ t.name, elapsed, @errorName(err) });
                    stats.fail += 1;
                },
            }
        }
    }

    const total = stats.total();
    const total_time = std.time.milliTimestamp() - all_start;

    if (total == stats.pass) {
        Output.pretty("<green>All tests passed</r>\n", .{});
    } else {
        Output.pretty("\n<green>{d}</r> passed", .{stats.pass});
        if (stats.fail > 0)
            Output.pretty(", <red>{d}</r> failed", .{stats.fail})
        else
            Output.pretty(", 0 failed", .{});
        if (stats.leak > 0) Output.pretty(", <yellow>{d}</r> leaked", .{stats.leak});
        if (stats.panic > 0) Output.pretty(", <magenta>{d}</r> panicked", .{stats.panic});
    }

    Output.pretty("\n\n\tRan {d} tests in {d}ms\n", .{ total, total_time });
    return stats.exitCode();
}

fn extractName(t: std.builtin.TestFn) []const u8 {
    const marker = std.mem.lastIndexOf(u8, t.name, ".test.") orelse return t.name;
    return t.name[marker + 6 ..];
}

pub const overrides = struct {
    pub const mem = struct {
        extern "C" fn wcslen(s: [*:0]const u16) usize;

        pub fn indexOfSentinel(comptime T: type, comptime sentinel: T, p: [*:sentinel]const T) usize {
            if (comptime T == u16 and sentinel == 0 and Environment.isWindows) {
                return wcslen(p);
            }

            if (comptime T == u8 and sentinel == 0) {
                return bun.C.strlen(p);
            }

            var i: usize = 0;
            while (p[i] != sentinel) {
                i += 1;
            }
            return i;
        }
    };
};

pub export fn Bun__panic(msg: [*]const u8, len: usize) noreturn {
    Output.panic("{s}", .{msg[0..len]});
}

comptime {
    _ = bun.bake;
    std.testing.refAllDecls(bun.bake);
    std.testing.refAllDecls(@import("bun.js/node/buffer.zig").BufferVectorized);
    std.testing.refAllDecls(bun.bun_js);
    std.testing.refAllDeclsRecursive(@import("cli/upgrade_command.zig"));
    std.testing.refAllDeclsRecursive(@import("cli/test_command.zig"));
}
