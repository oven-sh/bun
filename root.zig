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

// -- Zig Standard Library Additions --
pub fn copyForwards(comptime T: type, dest: []T, source: []const T) void {
    if (source.len == 0) {
        return;
    }
    bun.copy(T, dest[0..source.len], source);
}
pub fn copyBackwards(comptime T: type, dest: []T, source: []const T) void {
    if (source.len == 0) {
        return;
    }
    bun.copy(T, dest[0..source.len], source);
}
pub fn eqlBytes(src: []const u8, dest: []const u8) bool {
    return bun.C.memcmp(src.ptr, dest.ptr, src.len) == 0;
}
// -- End Zig Standard Library Additions --
