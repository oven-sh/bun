/// Mixin to read an entire request body into memory and run a callback.
/// Consumers should make sure a reference count is held on the server,
/// and is unreferenced after one of the two callbacks are called.
///
/// See DevServer.zig's ErrorReportRequest for an example.
pub fn BodyReaderMixin(
    Wrap: type,
    field: []const u8,
    // `body` is freed after this function returns.
    onBody: fn (*Wrap, body: []const u8, resp: uws.AnyResponse) anyerror!void,
    // Called on error or request abort
    onError: fn (*Wrap) void,
) type {
    return struct {
        body: std.ArrayList(u8),

        pub fn init(allocator: std.mem.Allocator) @This() {
            return .{ .body = .init(allocator) };
        }

        /// Memory is freed after the callback returns, or automatically on failure.
        pub fn readBody(ctx: *@This(), resp: anytype) void {
            const Mixin = @This();
            const Response = @TypeOf(resp);
            const handlers = struct {
                fn onDataGeneric(mixin: *Mixin, r: Response, chunk: []const u8, last: bool) void {
                    const any = uws.AnyResponse.init(r);
                    onData(mixin, any, chunk, last) catch |e| switch (e) {
                        error.OutOfMemory => return mixin.onOOM(any),
                        else => return mixin.onInvalid(any),
                    };
                }
                fn onAborted(mixin: *Mixin, _: Response) void {
                    mixin.body.deinit();
                    onError(@fieldParentPtr(field, mixin));
                }
            };
            resp.onData(*@This(), handlers.onDataGeneric, ctx);
            resp.onAborted(*@This(), handlers.onAborted, ctx);
        }

        fn onData(ctx: *@This(), resp: uws.AnyResponse, chunk: []const u8, last: bool) !void {
            if (last) {
                var body = ctx.body; // stack copy so onBody can free everything
                resp.clearAborted();
                resp.clearOnData();
                if (body.items.len > 0) {
                    try body.appendSlice(chunk);
                    try onBody(@fieldParentPtr(field, ctx), ctx.body.items, resp);
                } else {
                    try onBody(@fieldParentPtr(field, ctx), chunk, resp);
                }
                body.deinit();
            } else {
                try ctx.body.appendSlice(chunk);
            }
        }

        fn onOOM(ctx: *@This(), r: uws.AnyResponse) void {
            r.writeStatus("500 Internal Server Error");
            r.endWithoutBody(false);
            ctx.body.deinit();
            onError(@fieldParentPtr(field, ctx));
        }

        fn onInvalid(ctx: *@This(), r: uws.AnyResponse) void {
            r.writeStatus("400 Bad Request");
            r.endWithoutBody(false);
            ctx.body.deinit();
            onError(@fieldParentPtr(field, ctx));
        }
    };
}

const bun = @import("bun");
const uws = bun.uws;
const std = @import("std");
