const js_ast = @import("js_ast.zig");
const _global = @import("global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const std = @import("std");
const Ref = @import("./ast/base.zig").Ref;
const logger = @import("logger.zig");

// This is...poorly named
// It does not rename
// It merely names
pub const Renamer = struct {
    symbols: js_ast.Symbol.Map,
    source: *const logger.Source,

    pub fn init(symbols: js_ast.Symbol.Map, source: *const logger.Source) Renamer {
        return Renamer{ .symbols = symbols, .source = source };
    }

    pub fn nameForSymbol(renamer: *Renamer, ref: Ref) string {
        if (ref.is_source_contents_slice) {
            return renamer.source.contents[ref.source_index .. ref.source_index + ref.inner_index];
        }

        const resolved = renamer.symbols.follow(ref);

        if (renamer.symbols.get(resolved)) |symbol| {
            return symbol.original_name;
        } else {
            Global.panic("Invalid symbol {s} in {s}", .{ ref, renamer.source.path.text });
        }
    }
};

pub const DisabledRenamer = struct {
    pub fn init(_: js_ast.Symbol.Map) DisabledRenamer {}
    pub inline fn nameForSymbol(_: *Renamer, _: js_ast.Ref) string {
        @compileError("DisabledRunner called");
    }
};
