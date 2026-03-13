pub const ResolvedSource = extern struct {
    /// Specifier's lifetime is the caller from C++
    /// https://github.com/oven-sh/bun/issues/9521
    specifier: bun.String = bun.String.empty,
    source_code: bun.String = bun.String.empty,

    /// source_url is eventually deref'd on success
    source_url: bun.String = bun.String.empty,

    is_commonjs_module: bool = false,

    /// When .tag is .common_js_custom_extension, this is special-cased to hold
    /// the JSFunction extension. It is kept alive by
    /// - This structure is stored on the stack
    /// - There is a JSC::Strong reference to it
    cjs_custom_extension_index: JSValue = .zero,

    allocator: ?*anyopaque = null,

    jsvalue_for_export: JSValue = .zero,

    tag: Tag = .javascript,

    /// This is for source_code
    source_code_needs_deref: bool = true,
    already_bundled: bool = false,

    // -- Bytecode cache fields --
    bytecode_cache: ?[*]u8 = null,
    bytecode_cache_size: usize = 0,
    module_info: ?*anyopaque = null,
    /// The file path used as the source origin for bytecode cache validation.
    /// JSC validates bytecode by checking if the origin URL matches exactly what
    /// was used at build time. If empty, the origin is derived from source_url.
    /// This is converted to a file:// URL on the C++ side.
    bytecode_origin_path: bun.String = bun.String.empty,

    pub const Tag = @import("ResolvedSourceTag").ResolvedSourceTag;
};

const bun = @import("bun");

const jsc = bun.jsc;
const JSValue = jsc.JSValue;
