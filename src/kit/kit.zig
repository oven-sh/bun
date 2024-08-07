//! Work-in-progress.

/// Temporary function to invoke dev server via JavaScript. Will be
/// replaced with a user-facing API. Refs the event loop forever.
pub fn jsWipDevServer(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
    _ = callframe;

    const routes = bun.default_allocator.dupe(
        DevServer.Route,
        &.{.{
            .pattern = "/",
            .server_entry_point = "./server.ts",
        }},
    ) catch bun.outOfMemory();

    _ = DevServer.init(.{
        .server_global = global, // TODO: isolation?
        .event_loop = .{ .js = global.bunVM().event_loop },
        .routes = routes,
    });

    var keep_alive = bun.Async.KeepAlive.init();
    keep_alive.ref(global.bunVM());

    return .undefined;
}

pub const DevServer = @import("./DevServer.zig");

const std = @import("std");

const bun = @import("root").bun;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
