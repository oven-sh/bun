pub const bun = @import("./bun.zig");

const Output = bun.Output;
const Environment = bun.Environment;

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
    // This should appear before we make any calls at all to libuv.
    // So it's safest to put it very early in the main function.
    if (Environment.isWindows) {
        _ = bun.windows.libuv.uv_replace_allocator(
            @ptrCast(&bun.mimalloc.mi_malloc),
            @ptrCast(&bun.mimalloc.mi_realloc),
            @ptrCast(&bun.mimalloc.mi_calloc),
            @ptrCast(&bun.mimalloc.mi_free),
        );
        environ = @ptrCast(std.os.environ.ptr);
        _environ = @ptrCast(std.os.environ.ptr);
    }

    bun.initArgv() catch |err| {
        Output.panic("Failed to initialize argv: {s}\n", .{@errorName(err)});
    };

    Output.Source.Stdio.init();
    defer Output.flush();
    bun.StackCheck.configureThread();
    const exit_code = runTests();
    bun.Global.exit(exit_code);
}

const Stats = struct {
    pass: u32,
    fail: u32,
    leak: u32,
    panic: u32,
    start: i64,

    fn init() Stats {
        var stats = std.mem.zeroes(Stats);
        stats.start = std.time.milliTimestamp();
        return stats;
    }

    /// Time elapsed since start in milliseconds
    fn elapsed(this: *const Stats) i64 {
        return std.time.milliTimestamp() - this.start;
    }

    /// Total number of tests run
    fn total(this: *const Stats) u32 {
        return this.pass + this.fail + this.leak + this.panic;
    }

    fn exitCode(this: *const Stats) u8 {
        var result: u8 = 0;
        if (this.fail > 0) result |= 1;
        if (this.leak > 0) result |= 2;
        if (this.panic > 0) result |= 4;
        return result;
    }
};

fn runTests() u8 {
    var stats = Stats.init();
    var stderr = std.fs.File.stderr();

    namebuf = std.heap.page_allocator.alloc(u8, namebuf_size) catch {
        Output.panic("Failed to allocate name buffer", .{});
    };
    defer std.heap.page_allocator.free(namebuf);

    const tests: []const TestFn = builtin.test_functions;
    for (tests) |t| {
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
    const total_time = stats.elapsed();

    if (total == stats.pass) {
        Output.pretty("\n<green>All tests passed</r>\n", .{});
    } else {
        Output.pretty("\n<green>{d}</r> passed", .{stats.pass});
        if (stats.fail > 0)
            Output.pretty(", <red>{d}</r> failed", .{stats.fail})
        else
            Output.pretty(", 0 failed", .{});
        if (stats.leak > 0) Output.pretty(", <yellow>{d}</r> leaked", .{stats.leak});
        if (stats.panic > 0) Output.pretty(", <magenta>{d}</r> panicked", .{stats.panic});
    }

    Output.pretty("\n\tRan <b>{d}</r> tests in <b>{d}</r>ms\n\n", .{ total, total_time });
    return stats.exitCode();
}

// heap-allocated on start to avoid increasing binary size
threadlocal var namebuf: []u8 = undefined;
const namebuf_size = 4096;
comptime {
    std.debug.assert(std.math.isPowerOfTwo(namebuf_size));
}

fn extractName(t: TestFn) []const u8 {
    inline for (.{ ".test.", ".decltest." }) |test_sep| {
        if (std.mem.lastIndexOf(u8, t.name, test_sep)) |marker| {
            const prefix = t.name[0..marker];
            const test_name = t.name[marker + test_sep.len ..];
            const full_name = std.fmt.bufPrint(namebuf, "{s}\t{s}", .{ prefix, test_name }) catch @panic("name buffer too small");
            return full_name;
        }
    }

    return t.name;
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
    _ = bun.bake.production.BakeProdResolve;
    _ = bun.bake.production.BakeProdLoad;

    _ = bun.bun_js.Bun__onRejectEntryPointResult;
    _ = bun.bun_js.Bun__onResolveEntryPointResult;
    _ = &@import("./bun.js/node/buffer.zig").BufferVectorized;
    @import("./cli/upgrade_command.zig").@"export"();
    @import("./cli/test_command.zig").@"export"();
}

const builtin = @import("builtin");
const recover = @import("./test/recover.zig");
const std = @import("std");
const TestFn = std.builtin.TestFn;
