const TranspiledSource = @import("./TranspiledSource.zig").TranspiledSource;
const SpecialModule = @import("./SpecialModule.zig").SpecialModule;

/// Tagged union return type from transpiler
pub const ModuleResult = extern struct {
    tag: Tag,
    value: extern union {
        transpiled: TranspiledSource,
        special: SpecialModule,
        builtin_id: u32,
    },

    pub const Tag = enum(u8) {
        transpiled,
        special,
        builtin,
    };
};
