/// Context type for FrameworkRouter in production mode
/// Implements the required methods for route scanning
const ProductionFrameworkRouter = @This();

file_id_counter: u32 = 0,

pub fn init() ProductionFrameworkRouter {
    return .{};
}

/// Generate a file ID for a route file
/// In production, we don't need to track actual files since they're bundled
pub fn getFileIdForRouter(
    this: *ProductionFrameworkRouter,
    abs_path: []const u8,
    associated_route: bun.bake.FrameworkRouter.Route.Index,
    file_kind: bun.bake.FrameworkRouter.Route.FileKind,
) !bun.bake.FrameworkRouter.OpaqueFileId {
    _ = abs_path;
    _ = associated_route;
    _ = file_kind;
    // In production, we just need unique IDs for the route structure
    // The actual files are already bundled
    const id = this.file_id_counter;
    this.file_id_counter += 1;
    return bun.bake.FrameworkRouter.OpaqueFileId.init(id);
}

/// Handle route syntax errors
pub fn onRouterSyntaxError(
    this: *ProductionFrameworkRouter,
    rel_path: []const u8,
    log: bun.bake.FrameworkRouter.TinyLog,
) !void {
    _ = this;
    // In production, log syntax errors to console
    // These shouldn't happen in production as routes are pre-validated during build
    bun.Output.prettyErrorln("<r><red>error<r>: route syntax error in {s}", .{rel_path});
    log.print(rel_path);
    Output.flush();
}

/// Handle route collision errors
pub fn onRouterCollisionError(
    this: *ProductionFrameworkRouter,
    rel_path: []const u8,
    other_id: bun.bake.FrameworkRouter.OpaqueFileId,
    file_kind: bun.bake.FrameworkRouter.Route.FileKind,
) !void {
    _ = this;
    _ = other_id;
    // In production, log collision errors
    // These shouldn't happen in production as routes are pre-validated during build
    Output.errGeneric("Multiple {s} matching the same route pattern is ambiguous", .{
        switch (file_kind) {
            .page => "pages",
            .layout => "layout",
        },
    });
    Output.prettyErrorln("  - <blue>{s}<r>", .{rel_path});
    Output.flush();
}

const bun = @import("bun");
const std = @import("std");
const bake = bun.bake;
const strings = bun.strings;
const logger = bun.logger;
const Loc = logger.Loc;

const Route = bun.bake.FrameworkRouter.Route;
const SSRRouteList = bun.bake.SSRRouteList;

const jsc = bun.jsc;
const JSError = bun.JSError;
const CallFrame = jsc.CallFrame;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const E = bun.ast.E;

const DirInfo = bun.resolver.DirInfo;
const Resolver = bun.resolver.Resolver;

const mem = std.mem;
const Allocator = mem.Allocator;
const Output = bun.Output;
const Manifest = bun.bake.Manifest;

const FrameworkRouter = bun.bake.FrameworkRouter;
