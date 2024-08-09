//! Work-in-progress.

/// Temporary function to invoke dev server via JavaScript. Will be
/// replaced with a user-facing API. Refs the event loop forever.
pub fn jsWipDevServer(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
    _ = callframe;

    bun.Output.warn("Please be advised that kit is experimental. Its API will change frequently.", .{});

    const t = std.Thread.spawn(.{}, wipDevServer, .{}) catch @panic("Failed to start");
    t.detach();

    var keep_alive = bun.Async.KeepAlive.init();
    keep_alive.ref(global.bunVM());

    return .undefined;
}

pub fn wipDevServer() noreturn {
    bun.Output.Source.configureNamedThread("Dev Server");

    const routes = bun.default_allocator.dupe(
        DevServer.Route,
        &.{.{
            .pattern = "/",
            .entry_point = "./single_file_react.tsx",
        }},
    ) catch bun.outOfMemory();

    const dev = DevServer.init(.{
        .cwd = bun.getcwdAlloc(bun.default_allocator) catch bun.outOfMemory(),
        .routes = routes,
    });
    dev.runLoopForever();
}

pub const DevServer = @import("./DevServer.zig");

const std = @import("std");

const bun = @import("root").bun;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
