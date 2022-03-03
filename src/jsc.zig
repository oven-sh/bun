// Top-level so it can access all files
pub const is_bindgen = @import("std").meta.globalOption("bindgen", bool) orelse false;

pub usingnamespace @import("./javascript/jsc/bindings/exports.zig");
pub usingnamespace @import("./javascript/jsc/bindings/bindings.zig");
pub usingnamespace @import("./javascript/jsc/base.zig");
pub usingnamespace @import("./javascript/jsc/javascript.zig");
pub const C = @import("./javascript/jsc/javascript_core_c_api.zig");
pub const WebCore = @import("./javascript/jsc/webcore.zig");
pub const Jest = @import("./javascript/jsc/test/jest.zig");
pub const API = struct {
    pub const Transpiler = @import("./javascript/jsc/api/transpiler.zig");
};
pub const Node = struct {
    pub usingnamespace @import("./javascript/jsc/node/types.zig");
    pub usingnamespace @import("./javascript/jsc/node/node_fs.zig");
    pub usingnamespace @import("./javascript/jsc/node/node_fs_binding.zig");
    pub const Syscall = @import("./javascript/jsc/node/syscall.zig");
};
