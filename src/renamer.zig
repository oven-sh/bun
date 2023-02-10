const js_ast = bun.JSAst;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const std = @import("std");
const Ref = @import("./ast/base.zig").Ref;
const logger = @import("bun").logger;

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
        if (ref.isSourceContentsSlice()) {
            return renamer.source.contents[ref.sourceIndex() .. ref.sourceIndex() + ref.innerIndex()];
        }

        const resolved = renamer.symbols.follow(ref);

        if (renamer.symbols.getConst(resolved)) |symbol| {
            return symbol.original_name;
        } else {
            Global.panic("Invalid symbol {s} in {s}", .{ ref, renamer.source.path.text });
        }
    }
};

pub const BundledRenamer = struct {
    symbols: js_ast.Symbol.Map,
    sources: []const []const u8,

    pub fn init(symbols: js_ast.Symbol.Map, sources: []const []const u8) Renamer {
        return Renamer{ .symbols = symbols, .source = sources };
    }

    pub fn nameForSymbol(renamer: *Renamer, ref: Ref) string {
        if (ref.isSourceContentsSlice()) {
            unreachable;
        }

        const resolved = renamer.symbols.follow(ref);

        if (renamer.symbols.getConst(resolved)) |symbol| {
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

pub const ExportRenamer = struct {
    string_buffer: bun.MutableString,
    used: bun.StringHashMap(u32),

    pub fn init(allocator: std.mem.Allocator) ExportRenamer {
        return ExportRenamer{
            .string_buffer = MutableString.initEmpty(allocator),
            .used = bun.StringHashMap(u32).init(allocator),
        };
    }

    pub fn clearRetainingCapacity(this: *ExportRenamer) void {
        this.used.clearRetainingCapacity();
        this.string_buffer.reset();
    }

    pub fn deinit(this: *ExportRenamer) void {
        this.used.deinit();
        this.string_buffer.deinit();
    }

    pub fn nextRenamedName(this: *ExportRenamer, input: []const u8) string {
        var entry = this.used.getOrPut(input) catch unreachable;
        var tries: u32 = 1;
        if (entry.found_existing) {
            while (true) {
                this.string_buffer.reset();
                var writer = this.string_buffer.writer();
                writer.print("{s}{d}", .{ input, tries }) catch unreachable;
                tries += 1;
                var attempt = this.string_buffer.toOwnedSliceLeaky();
                entry = this.used.getOrPut(attempt) catch unreachable;
                if (!entry.found_existing) {
                    const to_use = this.string_buffer.allocator.dupe(u8, attempt) catch unreachable;
                    entry.key_ptr.* = to_use;
                    entry.value_ptr.* = tries;

                    entry = this.used.getOrPut(input) catch unreachable;
                    entry.value_ptr.* = tries;
                    return to_use;
                }
            }
        } else {
            entry.value_ptr.* = tries;
        }

        return entry.key_ptr.*;
    }
};
