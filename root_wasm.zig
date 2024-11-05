pub usingnamespace @import("src/main_wasm.zig");

pub const bun = @import("src/bun.zig");

pub const completions = struct {};
pub const is_bindgen = true;
pub const JavaScriptCore = struct {
    pub fn markBinding(_: @import("std").builtin.SourceLocation) void {
        unreachable;
    }

    pub const ZigString = struct {};
};

pub const C = struct {};
pub const build_options = @import("build_options");
