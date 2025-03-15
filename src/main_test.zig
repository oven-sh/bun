const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const Output = bun.Output;
const Environment = bun.Environment;

pub const panic = bun.crash_handler.panic;
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
    bun.crash_handler.init();

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
    runTests();
    bun.Global.exit(0);
}

fn runTests() void {
    var pass: u32 = 0;
    var fail: u32 = 0;
    for (builtin.test_functions) |t| {
        const start = std.time.milliTimestamp();
        std.testing.allocator_instance = .{};
        const result = t.func();
        const elapsed = std.time.milliTimestamp() - start;

        const name = extractName(t);
        if (std.testing.allocator_instance.deinit() == .leak) {
            Output.err(error.MemoryLeakDetected, "{s} leaked memory", .{name});
        }

        if (result) |_| {
            Output.pretty("<green>pass</r> - {s} <i>({d}ms)</r>\n", .{ name, elapsed });
            pass += 1;
        } else |err| {
            Output.pretty("<red>fail</r> - {s} <i>({d}ms)</r>\n{s}", .{ t.name, elapsed, @errorName(err) });
            fail += 1;
        }
    }

    // todo: detect leaks in a test, then run mi_stats_print_out?

    const total = pass + fail;
    bun.assert(total > 0);
    Output.pretty("\n{d} tests, {d} passed, {d} failed\n", .{ total, pass, fail });
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
