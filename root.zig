pub usingnamespace @import("./src/main.zig");

/// These functions are used throughout Bun's codebase.
pub const bun = @import("./src/bun.zig");

pub const completions = struct {
    pub const bash = @embedFile("./completions/bun.bash");
    pub const zsh = @embedFile("./completions/bun.zsh");
    pub const fish = @embedFile("./completions/bun.fish");
};

pub const JavaScriptCore = @import("./src/jsc.zig");
pub const C = @import("./src/c.zig");
