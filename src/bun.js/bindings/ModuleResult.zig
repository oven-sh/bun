/// Error information from transpilation/module loading
pub const ErrorResult = extern struct {
    /// Error value (JSValue) - already an exception
    exception: JSValue,
};

/// Tagged union return type from transpiler
/// src/bun.js/bindings/ModuleResult.zig
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

    // Re-export ErrorResult for convenience
    pub const Error = ErrorResult;
};

const bun = @import("bun");
const SpecialModule = @import("./SpecialModule.zig").SpecialModule;
const TranspiledSource = @import("./TranspiledSource.zig").TranspiledSource;
const JSValue = bun.jsc.JSValue;
