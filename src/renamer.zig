const js_ast = @import("js_ast.zig");

pub const Renamer = struct {
    symbols: js_ast.Symbol.Map,
    pub fn init(symbols: js_ast.Symbol.Map) Renamer {
        return Renamer{ .symbols = symbols };
    }

    pub fn nameForSymbol(renamer: *Renamer, ref: js_ast.Ref) string {
        const resolved = renamer.symbols.follow(ref);
        const symbol = renamer.symbols.get(resolved) orelse std.debug.panic("Internal error: symbol not found for ref: {s}", .{resolved});

        return symbol.original_name;
    }
};

pub const DisabledRenamer = struct {
    pub fn init(symbols: js_ast.Symbol.Map) DisabledRenamer {}
    pub fn nameForSymbol(renamer: *Renamer, ref: js_ast.Ref) callconv(.Inline) string {
        @compileError("DisabledRunner called");
    }
};
