const bun = @import("bun");

/// Minimal POD struct for transpiled source code
/// Can be safely created on worker threads
/// src/bun.js/bindings/TranspiledSource.zig
pub const TranspiledSource = extern struct {
    /// Transpiled source code (Latin1 or UTF16)
    /// Ownership transfers to C++ on return
    source_code: bun.String,

    /// Module specifier for debugging/sourcemaps
    source_url: bun.String,

    /// Optional bytecode cache (for bun build --compile)
    bytecode_cache: ?[*]u8 = null,
    bytecode_cache_len: usize = 0,

    /// Packed flags
    flags: Flags = .{},

    pub const Flags = packed struct(u32) {
        is_commonjs: bool = false,
        is_already_bundled: bool = false,
        _padding: u30 = 0,
    };
};
