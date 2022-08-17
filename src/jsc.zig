// Top-level so it can access all files
pub const is_bindgen = @import("std").meta.globalOption("bindgen", bool) orelse false;

pub const napi = @import("./napi/napi.zig");
pub usingnamespace @import("./bun.js/bindings/exports.zig");
pub usingnamespace @import("./bun.js/bindings/bindings.zig");
pub usingnamespace @import("./bun.js/event_loop.zig");
pub usingnamespace @import("./bun.js/base.zig");
pub const RareData = @import("./bun.js/rare_data.zig");
pub const Shimmer = @import("./bun.js/bindings/shimmer.zig").Shimmer;
pub usingnamespace @import("./bun.js/javascript.zig");
pub const C = @import("./bun.js/javascript_core_c_api.zig");
pub const WebCore = @import("./bun.js/webcore.zig");
pub const Cloudflare = struct {
    pub const HTMLRewriter = @import("./bun.js/api/html_rewriter.zig").HTMLRewriter;
    pub const ContentOptions = @import("./bun.js/api/html_rewriter.zig").ContentOptions;
    pub const Element = @import("./bun.js/api/html_rewriter.zig").Element;
    pub const Comment = @import("./bun.js/api/html_rewriter.zig").Comment;
    pub const TextChunk = @import("./bun.js/api/html_rewriter.zig").TextChunk;
    pub const DocType = @import("./bun.js/api/html_rewriter.zig").DocType;
    pub const DocEnd = @import("./bun.js/api/html_rewriter.zig").DocEnd;
    pub const EndTag = @import("./bun.js/api/html_rewriter.zig").EndTag;
    pub const AttributeIterator = @import("./bun.js/api/html_rewriter.zig").AttributeIterator;
};
pub const Jest = @import("./bun.js/test/jest.zig");
pub const API = struct {
    pub const Transpiler = @import("./bun.js/api/transpiler.zig");
    pub const Server = @import("./bun.js/api/server.zig").Server;
    pub const SSLServer = @import("./bun.js/api/server.zig").SSLServer;
    pub const DebugServer = @import("./bun.js/api/server.zig").DebugServer;
    pub const DebugSSLServer = @import("./bun.js/api/server.zig").DebugSSLServer;
    pub const Bun = @import("./bun.js/api/bun.zig");
    pub const Router = @import("./bun.js/api/router.zig");
    pub const ServerConfig = @import("./bun.js/api/server.zig").ServerConfig;
};
pub const FFI = @import("./bun.js/api/ffi.zig").FFI;
pub const Node = struct {
    pub usingnamespace @import("./bun.js/node/types.zig");
    pub usingnamespace @import("./bun.js/node/node_fs.zig");
    pub usingnamespace @import("./bun.js/node/node_fs_binding.zig");
    pub const Syscall = @import("./bun.js/node/syscall.zig");
    pub const fs = @import("./bun.js/node/node_fs_constant.zig");
};
pub const Maybe = Node.Maybe;
pub const jsNumber = @This().JSValue.jsNumber;
pub const jsBoolean = @This().JSValue.jsBoolean;
pub inline fn markBinding() void {
    if (comptime is_bindgen) unreachable;
}

pub const Codegen = @import("./bun.js/bindings/generated_classes.zig");
