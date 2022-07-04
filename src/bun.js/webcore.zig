pub usingnamespace @import("./webcore/response.zig");
pub usingnamespace @import("./webcore/encoding.zig");
pub usingnamespace @import("./webcore/streams.zig");

const JSC = @import("../jsc.zig");
const std = @import("std");

pub const Lifetime = enum {
    clone,
    transfer,
    share,
    /// When reading from a fifo like STDIN/STDERR
    temporary,
};

pub const Crypto = struct {
    const UUID = @import("./uuid.zig");

    pub const Class = JSC.NewClass(void, .{ .name = "crypto" }, .{
        .getRandomValues = .{
            .rfn = getRandomValues,
        },
        .randomUUID = .{
            .rfn = randomUUID,
        },
    }, .{});
    pub const Prototype = JSC.NewClass(
        void,
        .{ .name = "Crypto" },
        .{
            .call = .{
                .rfn = call,
            },
        },
        .{},
    );

    pub fn getRandomValues(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        arguments: []const JSC.C.JSValueRef,
        exception: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        if (arguments.len == 0) {
            JSC.JSError(JSC.getAllocator(ctx), "Expected typed array but received nothing", .{}, ctx, exception);
            return JSC.JSValue.jsUndefined().asObjectRef();
        }
        var array_buffer = JSC.MarkedArrayBuffer.fromJS(ctx.ptr(), JSC.JSValue.fromRef(arguments[0]), exception) orelse {
            JSC.JSError(JSC.getAllocator(ctx), "Expected typed array", .{}, ctx, exception);
            return JSC.JSValue.jsUndefined().asObjectRef();
        };
        var slice = array_buffer.slice();
        if (slice.len > 0)
            std.crypto.random.bytes(slice);

        return arguments[0];
    }

    pub fn call(
        // this
        _: void,
        _: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.JSValue.jsUndefined().asObjectRef();
    }

    pub fn randomUUID(
        // this
        _: void,
        ctx: JSC.C.JSContextRef,
        // function
        _: JSC.C.JSObjectRef,
        // thisObject
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        var uuid = UUID.init();
        var out: [128]u8 = undefined;
        var str = std.fmt.bufPrint(&out, "{s}", .{uuid}) catch unreachable;
        return JSC.ZigString.init(str).toValueGC(ctx.ptr()).asObjectRef();
    }
};
