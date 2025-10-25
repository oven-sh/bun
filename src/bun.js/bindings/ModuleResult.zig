const bun = @import("bun");
const TranspiledSource = @import("./TranspiledSource.zig").TranspiledSource;
const SpecialModule = @import("./SpecialModule.zig").SpecialModule;

/// Tagged union return type for module resolution
pub const ModuleResult = extern struct {
    tag: Tag,
    value: Value,

    pub const Tag = enum(u32) {
        transpiled,
        special,
        builtin,
    };

    pub const Value = extern union {
        transpiled: TranspiledSource,
        special: SpecialModule,
        builtin_id: u32,
    };
};
