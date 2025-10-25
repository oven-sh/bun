/// Tagged union return type from transpiler
const bun = @import("bun");
const JSValue = bun.jsc.JSValue;
const TranspiledSource = @import("./TranspiledSource.zig").TranspiledSource;
const SpecialModule = @import("./SpecialModule.zig").SpecialModule;

/// Tagged union return type from transpiler
pub const ModuleResult = extern struct {
    tag: Tag,
    value: extern union {
        transpiled: TranspiledSource,
        special: SpecialModule,
        builtin_id: u32,
        err: ErrorResult,
    },

    pub const Tag = enum(u8) {
        transpiled,
        special,
        builtin,
        err,
    };
};

/// Error information from transpilation/module loading
pub const ErrorResult = extern struct {
    /// Error value (JSValue) - already an exception
    exception: JSValue,
};
