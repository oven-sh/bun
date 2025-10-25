/// Tagged union return type from module loading/transpilation.
/// This is the main result type returned by the transpiler to C++.
pub const ModuleResult = extern struct {
    /// Tag indicating which variant is active
    tag: u8,

    /// Explicit padding to match C struct alignment
    _padding: [7]u8,

    /// The actual result data (tagged union)
    result: Result,

    pub const Tag = enum(u8) {
        /// Normal transpiled source code
        transpiled = 0,

        /// Special module (synthetic, custom extension, etc.)
        special = 1,

        /// Built-in module reference
        builtin = 2,

        /// Error occurred during loading/transpilation
        err = 3,
    };

    pub const Result = extern union {
        /// Transpiled source code (when tag == .transpiled)
        transpiled: TranspiledSource,

        /// Special module (when tag == .special)
        special: SpecialModule,

        /// Built-in module specifier (when tag == .builtin)
        builtin: bun.String,

        /// Error result (when tag == .err)
        err: ErrorResult,
    };

    pub const ErrorResult = extern struct {
        /// The exception JSValue to throw
        exception: jsc.JSValue,
    };

    /// Helper to create a transpiled result
    pub fn transpiled(source: TranspiledSource) ModuleResult {
        return .{
            .tag = @intFromEnum(Tag.transpiled),
            ._padding = undefined,
            .result = .{ .transpiled = source },
        };
    }

    /// Helper to create a special module result
    pub fn special(spec: SpecialModule) ModuleResult {
        return .{
            .tag = @intFromEnum(Tag.special),
            ._padding = undefined,
            .result = .{ .special = spec },
        };
    }

    /// Helper to create a builtin module result
    pub fn builtin(specifier: bun.String) ModuleResult {
        return .{
            .tag = @intFromEnum(Tag.builtin),
            ._padding = undefined,
            .result = .{ .builtin = specifier },
        };
    }

    /// Helper to create an error result
    pub fn err(exception: jsc.JSValue) ModuleResult {
        return .{
            .tag = @intFromEnum(Tag.err),
            ._padding = undefined,
            .result = .{ .err = .{ .exception = exception } },
        };
    }
};

const bun = @import("bun");
const jsc = bun.jsc;
const TranspiledSource = @import("./TranspiledSource.zig").TranspiledSource;
const SpecialModule = @import("./SpecialModule.zig").SpecialModule;
