pub usingnamespace @import("src/main_wasm.zig");

pub const bun = @import("src/bun.zig");

pub const content = struct {
    pub const error_js_path = "packages/bun-error/dist/index.js";
    pub const error_js = @embedFile(error_js_path);

    pub const error_css_path = "packages/bun-error/dist/bun-error.css";
    pub const error_css_path_dev = "packages/bun-error/bun-error.css";

    pub const error_css = @embedFile(error_css_path);
};

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
