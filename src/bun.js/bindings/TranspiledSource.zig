/// Minimal POD struct for transpiled source code
/// Thread-safe - contains no JSValue fields
pub const TranspiledSource = extern struct {
    source_code: bun.String,
    source_url: bun.String,
    bytecode_cache: ?[*]u8,
    bytecode_cache_len: usize,
    flags: Flags,

    pub const Flags = packed struct(u32) {
        is_commonjs: bool,
        is_already_bundled: bool,
        _padding: u30 = 0,
    };
};

const bun = @import("bun");
