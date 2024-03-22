pub usingnamespace @import("./src/main.zig");

/// These functions are used throughout Bun's codebase.
pub const bun = @import("./src/bun.zig");

pub const content = struct {
    pub const error_js_path = "packages/bun-error/dist/index.js";
    pub const error_js = @embedFile(error_js_path);

    pub const error_css_path = "packages/bun-error/dist/bun-error.css";
    pub const error_css_path_dev = "packages/bun-error/bun-error.css";

    pub const error_css = @embedFile(error_css_path);
};

pub const completions = struct {
    pub const bash = @embedFile("./completions/bun.bash");
    pub const zsh = @embedFile("./completions/bun.zsh");
    pub const fish = @embedFile("./completions/bun.fish");
};

pub const JavaScriptCore = @import("./src/jsc.zig");
pub const C = @import("./src/c.zig");
