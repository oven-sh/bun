/// Special module cases that need JSValue handling.
/// Used for modules that cannot be represented as transpiled source code.
pub const SpecialModule = extern struct {
    /// Tag indicating the type of special module
    tag: Tag,

    /// The JavaScript value containing the module contents
    jsvalue: jsc.JSValue,

    pub const Tag = enum(u8) {
        /// Module exports an object directly (synthetic modules)
        exports_object = 0,

        /// Module exports a default object
        export_default_object = 1,

        /// Module with custom extension handling
        custom_extension = 2,
    };
};

const bun = @import("bun");
const jsc = bun.jsc;
