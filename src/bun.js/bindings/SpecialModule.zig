const bun = @import("bun");
const JSValue = bun.jsc.JSValue;

/// For special cases that need JSValue handling
/// src/bun.js/bindings/SpecialModule.zig
pub const SpecialModule = extern struct {
    tag: Tag,
    jsvalue: JSValue,

    pub const Tag = enum(u8) {
        /// Return exports object directly
        exports_object,
        /// Return default export only
        export_default_object,
        /// Call custom require.extensions handler
        custom_extension,
    };
};
