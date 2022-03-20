// Top-level so it can access all files
pub const is_bindgen = @import("std").meta.globalOption("bindgen", bool) orelse false;

pub usingnamespace @import("./javascript/jsc/bindings/exports.zig");
pub usingnamespace @import("./javascript/jsc/bindings/bindings.zig");
pub usingnamespace @import("./javascript/jsc/base.zig");
pub usingnamespace @import("./javascript/jsc/javascript.zig");
pub const C = @import("./javascript/jsc/javascript_core_c_api.zig");
pub const WebCore = @import("./javascript/jsc/webcore.zig");
pub const Cloudflare = struct {
    pub const HTMLRewriter = @import("./javascript/jsc/api/html_rewriter.zig").HTMLRewriter;
    pub const ContentOptions = @import("./javascript/jsc/api/html_rewriter.zig").ContentOptions;
    pub const Element = @import("./javascript/jsc/api/html_rewriter.zig").Element;
    pub const Comment = @import("./javascript/jsc/api/html_rewriter.zig").Comment;
    pub const TextChunk = @import("./javascript/jsc/api/html_rewriter.zig").TextChunk;
    pub const DocType = @import("./javascript/jsc/api/html_rewriter.zig").DocType;
    pub const DocEnd = @import("./javascript/jsc/api/html_rewriter.zig").DocEnd;
    pub const EndTag = @import("./javascript/jsc/api/html_rewriter.zig").EndTag;
    pub const AttributeIterator = @import("./javascript/jsc/api/html_rewriter.zig").AttributeIterator;
};
pub const Jest = @import("./javascript/jsc/test/jest.zig");
pub const API = struct {
    pub const Transpiler = @import("./javascript/jsc/api/transpiler.zig");
    pub const Server = @import("./javascript/jsc/api/server.zig").Server;
    pub const SSLServer = @import("./javascript/jsc/api/server.zig").SSLServer;
    pub const Bun = @import("./javascript/jsc/api/bun.zig");
    pub const Router = @import("./javascript/jsc/api/router.zig");
};
pub const Node = struct {
    pub usingnamespace @import("./javascript/jsc/node/types.zig");
    pub usingnamespace @import("./javascript/jsc/node/node_fs.zig");
    pub usingnamespace @import("./javascript/jsc/node/node_fs_binding.zig");
    pub const Syscall = @import("./javascript/jsc/node/syscall.zig");
};
