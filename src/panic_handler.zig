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

            if (msg.len > 0) {
                if (Output.isEmojiEnabled()) {
                    Output.prettyErrorln("<r><red>Bun crashed 😭😭😭<r><d>: <r><b>{s}<r>\n", .{msg});
                } else {
                    Output.prettyErrorln("<r><red>Crash<r><d>:<r> <b>{s}<r>", .{msg});
                }
                Output.flush();
            } else {
                if (Output.isEmojiEnabled()) {
                    Output.prettyErrorln("<r><red>Bun will crash now<r> 😭😭😭<r>\n", .{});
                    Output.flush();
                } else {
                    Output.printError("Bun has crashed :'(\n", .{});
                }
                Output.flush();
            }
            Output.disableBuffering();

            // // We want to always inline the panic handler so it doesn't show up in the stacktrace.
            @call(.{ .modifier = .always_inline }, panic_func, .{ msg, error_return_type });
        }
    };
}
