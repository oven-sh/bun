const std = @import("std");
const logger = @import("logger.zig");
const root = @import("root");
const _global = @import("global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const CLI = @import("./cli.zig").Cli;
const Features = @import("./analytics/analytics_thread.zig").Features;
const HTTP = @import("http").AsyncHTTP;
const Report = @import("./report.zig");

pub fn NewPanicHandler(comptime panic_func: fn handle_panic(msg: []const u8, error_return_type: ?*std.builtin.StackTrace) noreturn) type {
    return struct {
        panic_count: usize = 0,
        skip_next_panic: bool = false,
        log: *logger.Log,

        pub var Singleton: ?*Handler = null;
        const Handler = @This();

        pub fn init(log: *logger.Log) Handler {
            return Handler{
                .log = log,
            };
        }
        pub inline fn handle_panic(msg: []const u8, error_return_type: ?*std.builtin.StackTrace) noreturn {
            // This exists to ensure we flush all buffered output before panicking.
            Output.flush();

            Report.fatal(null, msg);

            Output.disableBuffering();

            // // We want to always inline the panic handler so it doesn't show up in the stacktrace.
            @call(.{ .modifier = .always_inline }, panic_func, .{ msg, error_return_type });
        }
    };
}
