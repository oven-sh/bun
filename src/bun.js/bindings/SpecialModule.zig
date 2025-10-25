/// For special cases that need JSValue handling
pub const SpecialModule = extern struct {
    tag: Tag,
    jsvalue: JSValue,

    pub const Tag = enum(u32) {
        exports_object,
        export_default_object,
        custom_extension,
    };
};

const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
