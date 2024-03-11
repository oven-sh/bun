const std = @import("std");
const bun = @import("root").bun;
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
const HTTP = @import("root").bun.http.AsyncHTTP;
const Report = @import("./report.zig");

pub fn NewPanicHandler(comptime panic_func: fn ([]const u8, ?*std.builtin.StackTrace, ?usize) noreturn) type {
    return struct {
        panic_count: usize = 0,
        skip_next_panic: bool = false,
        log: *bun.logger.Log,

        pub var Singleton: ?*Handler = null;
        const Handler = @This();

        pub fn init(log: *bun.logger.Log) Handler {
            return Handler{
                .log = log,
            };
        }
        pub inline fn handle_panic(msg: []const u8, error_return_type: ?*std.builtin.StackTrace, addr: ?usize) noreturn {

            // This exists to ensure we flush all buffered output before panicking.
            Output.flush();

            bun.maybeHandlePanicDuringProcessReload();

            Report.fatal(null, msg);

            Output.disableBuffering();

            if (bun.auto_reload_on_crash) {
                // attempt to prevent a double panic
                bun.auto_reload_on_crash = false;

                Output.prettyErrorln("<d>--- Bun is auto-restarting due to crash <d>[time: <b>{d}<r><d>] ---<r>", .{@max(std.time.milliTimestamp(), 0)});
                Output.flush();
                bun.reloadProcess(bun.default_allocator, false);
            }

            // // We want to always inline the panic handler so it doesn't show up in the stacktrace.
            @call(bun.callmod_inline, panic_func, .{ msg, error_return_type, addr });
        }
    };
}
