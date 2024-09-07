//! Kit is the code name for the work-in-progress "Framework API [SOON]" for Bun.

/// Temporary function to invoke dev server via JavaScript. Will be
/// replaced with a user-facing API. Refs the event loop forever.
///
/// Requires one argument object for configuration. Very little is
/// exposed over the JS api as it is not intended to be used for
/// real applications yet.
/// ```ts
/// interface WipDevServerOptions {
///     routes: WipDevServerRoute[]
/// }
/// interface WipDevServerRoute {
///     pattern: string;
///     entrypoint: string;
/// }
/// ```
pub fn jsWipDevServer(global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSValue {
    if (!bun.FeatureFlags.kit) return .undefined;

    bun.Output.warn(
        \\Be advised that Kit is highly experimental, and its API is subject to change
    , .{});
    bun.Output.flush();

    const options = devServerOptionsFromJs(global, callframe.argument(0)) catch {
        if (!global.hasException())
            global.throwInvalidArguments("invalid arguments", .{});
        return .zero;
    };

    const t = std.Thread.spawn(.{}, wipDevServer, .{options}) catch @panic("Failed to start");
    t.detach();

    {
        var futex = std.atomic.Value(u32).init(0);
        while (true) std.Thread.Futex.wait(&futex, 0);
    }
}

// TODO: this function leaks memory and bad error handling, but that is OK since
// this API is not finalized.
fn devServerOptionsFromJs(global: *JSC.JSGlobalObject, options: JSValue) !DevServer.Options {
    if (!options.isObject()) return error.Invalid;
    const routes_js = try options.getArray(global, "routes") orelse return error.Invalid;

    const len = routes_js.getLength(global);
    const routes = try bun.default_allocator.alloc(DevServer.Route, len);

    var it = routes_js.arrayIterator(global);
    var i: usize = 0;
    while (it.next()) |route| : (i += 1) {
        if (!route.isObject()) return error.Invalid;

        const pattern_js = route.get(global, "pattern") orelse return error.Invalid;
        if (!pattern_js.isString()) return error.Invalid;
        const entry_point_js = route.get(global, "entrypoint") orelse return error.Invalid;
        if (!entry_point_js.isString()) return error.Invalid;

        const pattern = pattern_js.toBunString(global).toUTF8(bun.default_allocator);
        defer pattern.deinit();
        // this dupe is stupid
        const pattern_z = try bun.default_allocator.dupeZ(u8, pattern.slice());
        const entry_point = entry_point_js.toBunString(global).toUTF8(bun.default_allocator).slice(); // leak

        routes[i] = .{
            .pattern = pattern_z,
            .entry_point = entry_point,
        };
    }

    return .{
        .cwd = bun.getcwdAlloc(bun.default_allocator) catch bun.outOfMemory(),
        .routes = routes,
    };
}

export fn Bun__getTemporaryDevServer(global: *JSC.JSGlobalObject) JSValue {
    if (!bun.FeatureFlags.kit) return .undefined;
    return JSC.JSFunction.create(global, "wipDevServer", bun.JSC.toJSHostFunction(jsWipDevServer), 0, .{});
}

pub fn wipDevServer(options: DevServer.Options) noreturn {
    bun.Output.Source.configureNamedThread("Dev Server");

    const dev = DevServer.init(options);
    dev.runLoopForever();
}

pub fn getHmrRuntime(mode: enum { server, client }) []const u8 {
    return if (Environment.embed_code)
        switch (mode) {
            .client => @embedFile("kit-codegen/kit.client.js"),
            .server => @embedFile("kit-codegen/kit.server.js"),
        }
    else switch (mode) {
        inline else => |m| bun.runtimeEmbedFile(.codegen, "kit." ++ @tagName(m) ++ ".js"),
    };
}

pub const DevServer = @import("./DevServer.zig");

const std = @import("std");

const bun = @import("root").bun;
const Environment = bun.Environment;

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
