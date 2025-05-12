const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;

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
    bytecode_cache: ?[*]u8 = null,
    bytecode_cache_size: usize = 0,

    pub const Tag = @import("ResolvedSourceTag").ResolvedSourceTag;
};
