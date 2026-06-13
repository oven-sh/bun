//! A generic wrapper for the HTTP(s) Server`RequestContext`s.
//! Only really exists because of `NewServer()` and `NewRequestContext()` generics.

const AnyRequestContext = @This();

pub const Pointer = bun.TaggedPointerUnion(.{
    HTTPServer.RequestContext,
    HTTPSServer.RequestContext,
    DebugHTTPServer.RequestContext,
    DebugHTTPSServer.RequestContext,
    HTTPSServer.H3RequestContext,
    DebugHTTPSServer.H3RequestContext,
});

tagged_pointer: Pointer,

pub const Null: @This() = .{ .tagged_pointer = Pointer.Null };

pub fn init(request_ctx: anytype) AnyRequestContext {
    return .{ .tagged_pointer = Pointer.init(request_ctx) };
}

/// Dispatch `cb(ctx, args...)` to the concrete RequestContext type behind the
/// tagged pointer. The pointer types only differ in their comptime parameters
/// (ssl/debug/http3), so every method body is identical — this collapses what
/// used to be six hand-written switch arms per accessor.
inline fn dispatch(self: AnyRequestContext, comptime Ret: type, default: Ret, comptime cb: anytype, args: anytype) Ret {
    if (self.tagged_pointer.isNull()) return default;
    inline for (Pointer.type_map) |entry| {
        if (self.tagged_pointer.repr.data == entry.value) {
            return @call(.auto, cb, .{ entry.ty, self.tagged_pointer.as(entry.ty) } ++ args);
        }
    }
    @panic("Unexpected AnyRequestContext tag");
}

pub fn setAdditionalOnAbortCallback(self: AnyRequestContext, cb: ?AdditionalOnAbortCallback) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype, c: ?AdditionalOnAbortCallback) void {
            bun.assert(ctx.additional_on_abort == null);
            ctx.additional_on_abort = c;
        }
    }.f, .{cb});
}

pub fn memoryCost(self: AnyRequestContext) usize {
    return self.dispatch(usize, 0, struct {
        fn f(comptime _: type, ctx: anytype) usize {
            return ctx.memoryCost();
        }
    }.f, .{});
}

pub fn get(self: AnyRequestContext, comptime T: type) ?*T {
    return self.tagged_pointer.get(T);
}

pub fn setTimeout(self: AnyRequestContext, seconds: c_uint) bool {
    return self.dispatch(bool, false, struct {
        fn f(comptime _: type, ctx: anytype, s: c_uint) bool {
            return ctx.setTimeout(s);
        }
    }.f, .{seconds});
}

pub fn setCookies(self: AnyRequestContext, cookie_map: ?*jsc.WebCore.CookieMap) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype, c: ?*jsc.WebCore.CookieMap) void {
            ctx.setCookies(c);
        }
    }.f, .{cookie_map});
}

pub fn enableTimeoutEvents(self: AnyRequestContext) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype) void {
            ctx.setTimeoutHandler();
        }
    }.f, .{});
}

pub fn getRemoteSocketInfo(self: AnyRequestContext) ?uws.SocketAddress {
    return self.dispatch(?uws.SocketAddress, null, struct {
        fn f(comptime _: type, ctx: anytype) ?uws.SocketAddress {
            return ctx.getRemoteSocketInfo();
        }
    }.f, .{});
}

pub fn getFd(self: AnyRequestContext) ?bun.FD {
    return self.dispatch(?bun.FD, null, struct {
        fn f(comptime T: type, ctx: anytype) ?bun.FD {
            // HTTP/3 multiplexes streams over a single UDP socket, so there
            // is no meaningful per-request OS fd to hand back.
            if (comptime T.is_h3) return null;
            return ctx.getFd();
        }
    }.f, .{});
}

pub fn detachRequest(self: AnyRequestContext) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype) void {
            ctx.req = null;
        }
    }.f, .{});
}

/// Wont actually set anything if `self` is `.none`
pub fn setRequest(self: AnyRequestContext, req: *uws.Request) void {
    self.dispatch(void, {}, struct {
        fn f(comptime T: type, ctx: anytype, r: *uws.Request) void {
            if (comptime T.is_h3) return; // H3 populates url/headers eagerly
            ctx.req = r;
        }
    }.f, .{req});
}

pub fn getRequest(self: AnyRequestContext) ?*uws.Request {
    return self.dispatch(?*uws.Request, null, struct {
        fn f(comptime T: type, ctx: anytype) ?*uws.Request {
            if (comptime T.is_h3) return null; // url/headers already on the Request
            return ctx.req;
        }
    }.f, .{});
}

pub fn onAbort(self: AnyRequestContext, response: uws.AnyResponse) void {
    self.dispatch(void, {}, struct {
        fn f(comptime T: type, ctx: anytype, r: uws.AnyResponse) void {
            // The AnyResponse arm and T.Resp are created together; assert
            // they agree so a mismatch traps in safe builds instead of being
            // silently @ptrCast.
            ctx.onAbort(switch (r) {
                inline else => |p| if (comptime @TypeOf(p) == *T.Resp) p else unreachable,
            });
        }
    }.f, .{response});
}

pub fn ref(self: AnyRequestContext) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype) void {
            ctx.ref();
        }
    }.f, .{});
}

pub fn setSignalAborted(self: AnyRequestContext, reason: bun.jsc.CommonAbortReason) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype, r: bun.jsc.CommonAbortReason) void {
            ctx.setSignalAborted(r);
        }
    }.f, .{reason});
}

pub fn devServer(self: AnyRequestContext) ?*bun.bake.DevServer {
    return self.dispatch(?*bun.bake.DevServer, null, struct {
        fn f(comptime _: type, ctx: anytype) ?*bun.bake.DevServer {
            return ctx.devServer();
        }
    }.f, .{});
}

pub fn deref(self: AnyRequestContext) void {
    self.dispatch(void, {}, struct {
        fn f(comptime _: type, ctx: anytype) void {
            ctx.deref();
        }
    }.f, .{});
}

pub const AdditionalOnAbortCallback = @import("./RequestContext.zig").AdditionalOnAbortCallback;

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;

const DebugHTTPSServer = bun.api.DebugHTTPSServer;
const DebugHTTPServer = bun.api.DebugHTTPServer;
const HTTPSServer = bun.api.HTTPSServer;
const HTTPServer = bun.api.HTTPServer;
