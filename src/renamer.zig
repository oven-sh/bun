const js_ast = @import("js_ast.zig");
usingnamespace @import("strings.zig");
const std = @import("std");
const logger = @import("logger.zig");

pub const Renamer = struct {
    symbols: js_ast.Symbol.Map,
    source: *logger.Source,

    pub fn init(symbols: js_ast.Symbol.Map, source: *logger.Source) Renamer {
        return Renamer{ .symbols = symbols, .source = source };
    }

    pub fn nameForSymbol(renamer: *Renamer, ref: js_ast.Ref) string {
        if (ref.is_source_contents_slice) {
            return renamer.source.contents[ref.source_index .. ref.source_index + ref.inner_index];
        }

        const resolved = renamer.symbols.follow(ref);
        if (renamer.symbols.get(resolved)) |symbol| {
            return symbol.original_name;
        } else {
            std.debug.panic("Invalid symbol {s}", .{ref});
        }
    }
};

pub const DisabledRenamer = struct {
    pub fn init(symbols: js_ast.Symbol.Map) DisabledRenamer {}
    pub fn nameForSymbol(renamer: *Renamer, ref: js_ast.Ref) callconv(.Inline) string {
        @compileError("DisabledRunner called");
    }
};
