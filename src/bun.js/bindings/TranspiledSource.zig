/// POD (Plain Old Data) struct for transpiled source code.
/// Thread-safe: contains no JSValue fields, only raw data.
/// Ownership of all data transfers to C++ when returned.
pub const TranspiledSource = extern struct {
    /// The transpiled JavaScript source code
    source_code: bun.String,

    /// The source URL (file path or specifier)
    source_url: bun.String,

    /// Optional bytecode cache data (may be null)
    bytecode_cache: ?[*]const u8,

    /// Length of bytecode cache (0 if no cache)
    bytecode_cache_len: usize,

    /// Packed flags for module metadata
    flags: Flags,

    pub const Flags = packed struct(u8) {
        /// True if this is a CommonJS module
        is_commonjs: bool = false,

        /// True if the module was already bundled (skip re-bundling)
        is_already_bundled: bool = false,

        /// True if the module comes from package.json type: "module"
        from_package_json_type_module: bool = false,

        /// Reserved bits for future use
        _padding: u5 = 0,
    };
};

const bun = @import("bun");
