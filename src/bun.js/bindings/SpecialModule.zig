const bun = @import("root").bun;
const JSValue = bun.JSC.JSValue;

/// For special cases that need JSValue handling
/// Main thread only (contains JSValue)
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
