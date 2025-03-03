const bun = @import("root").bun;
const JSC = bun.JSC;
const NodePath = JSC.Node.Path;
const WebSocketHTTPClient = JSC.WebSocketHTTPClient;
const WebSocketHTTPSClient = JSC.WebSocketHTTPSClient;
const WebSocketClient = JSC.WebSocketClient;
const WebSocketClientTLS = JSC.WebSocketClientTLS;

const JSArrayBufferSink = JSC.JSArrayBufferSink;
const JSHTTPResponseSink = JSC.JSHTTPResponseSink;
const JSHTTPSResponseSink = JSC.JSHTTPSResponseSink;
const JSNetworkSink = JSC.JSNetworkSink;
const JSFileSink = JSC.JSFileSink;
const HTTPServerRequestContext = JSC.HTTPServerRequestContext;
const HTTPSSLServerRequestContext = JSC.HTTPSSLServerRequestContext;
const HTTPDebugServerRequestContext = JSC.HTTPDebugServerRequestContext;
const HTTPDebugSSLServerRequestContext = JSC.HTTPDebugSSLServerRequestContext;
const BodyValueBuffererContext = JSC.BodyValueBuffererContext;
const TestScope = JSC.TestScope;
const Process = JSC.Process;
const Environment = bun.Environment;
const Mimalloc = bun.Mimalloc;
const ZigString = JSC.ZigString;
const std = @import("std");

export fn ZigString__free(raw: [*]const u8, len: usize, allocator_: ?*anyopaque) void {
    var allocator: std.mem.Allocator = @as(*std.mem.Allocator, @ptrCast(@alignCast(allocator_ orelse return))).*;
    var ptr = ZigString.init(raw[0..len]).slice().ptr;
    if (comptime Environment.allow_assert) {
        bun.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    const str = ptr[0..len];

    allocator.free(str);
}

export fn ZigString__free_global(ptr: [*]const u8, len: usize) void {
    const untagged = @as(*anyopaque, @ptrFromInt(@intFromPtr(ZigString.init(ptr[0..len]).slice().ptr)));
    if (comptime Environment.allow_assert) {
        bun.assert(Mimalloc.mi_is_in_heap_region(ptr));
    }
    // we must untag the string pointer
    Mimalloc.mi_free(untagged);
}

pub fn addShimReferences() void {
    WebSocketHTTPClient.shim.ref();
    WebSocketHTTPSClient.shim.ref();
    WebSocketClient.shim.ref();
    WebSocketClientTLS.shim.ref();

    HTTPServerRequestContext.shim.ref();
    HTTPSSLServerRequestContext.shim.ref();
    HTTPDebugServerRequestContext.shim.ref();
    HTTPDebugSSLServerRequestContext.shim.ref();

    _ = Process.getTitle;
    _ = Process.setTitle;
    NodePath.shim.ref();
    JSArrayBufferSink.shim.ref();
    JSHTTPResponseSink.shim.ref();
    JSHTTPSResponseSink.shim.ref();
    JSNetworkSink.shim.ref();
    JSFileSink.shim.ref();
    JSFileSink.shim.ref();
    _ = &ZigString__free;
    _ = &ZigString__free_global;

    TestScope.shim.ref();
    BodyValueBuffererContext.shim.ref();

    _ = @import("LoadLibrary.zig").Bun__LoadLibraryBunString;
    _ = &JSC.NodeModuleModule__findPath;
}
