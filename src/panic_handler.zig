const std = @import("std");
const logger = @import("logger.zig");
const root = @import("root");
const bun = @import("global.zig");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const CLI = @import("./cli.zig").Cli;
const Features = @import("./analytics/analytics_thread.zig").Features;
const HTTP = @import("http").AsyncHTTP;
const Report = @import("./report.zig");

pub fn NewPanicHandler(comptime panic_func: @TypeOf(std.builtin.default_panic)) type {
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
        pub fn handle_panic(msg: []const u8, error_return_type: ?*std.builtin.StackTrace, addr: ?usize) noreturn {
            // This exists to ensure we flush all buffered output before panicking.
            Output.flush();

            Report.fatal(null, msg);

            Output.disableBuffering();

            // // We want to always inline the panic handler so it doesn't show up in the stacktrace.
            @call(.{ .modifier = .always_inline }, panic_func, .{ msg,  error_return_type, addr });
        }
    };
}
