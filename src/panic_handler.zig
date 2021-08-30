const std = @import("std");
const logger = @import("logger.zig");
const root = @import("root");
usingnamespace @import("global.zig");

/// This function is used by the Zig language code generation and
/// therefore must be kept in sync with the compiler implementation.
pub fn default_panic(msg: []const u8, error_return_trace: ?*std.builtin.StackTrace) noreturn {
    @setCold(true);
    if (@hasDecl(root, "os") and @hasDecl(root.os, "panic")) {
        root.os.panic(msg, error_return_trace);
        unreachable;
    }
    switch (std.builtin.os.tag) {
        .freestanding => {
            while (true) {
                @breakpoint();
            }
        },
        .wasi => {
            std.debug.warn("{s}", .{msg});
            std.os.abort();
        },
        .uefi => {
            // TODO look into using the debug info and logging helpful messages
            std.os.abort();
        },
        else => {
            const first_trace_addr = @returnAddress();
            std.debug.panicExtra(error_return_trace, first_trace_addr, "{s}", .{msg});
        },
    }
}

pub fn NewPanicHandler(panic_func: fn handle_panic(msg: []const u8, error_return_type: ?*std.builtin.StackTrace) noreturn) type {
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
            Output.flush();

            if (@This().Singleton) |singleton| {
                singleton.panic_count += 1;
            }

            panic_func(msg, error_return_type);
        }
    };
}
