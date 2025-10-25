/// For special cases that need JSValue handling
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

const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
