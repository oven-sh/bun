pub const TopLevelSymbolToParts = std.ArrayHashMapUnmanaged(Ref, BabyList(u32), Ref.ArrayHashCtx, false);

approximate_newline_count: usize = 0,
has_lazy_export: bool = false,
runtime_imports: Runtime.Imports = .{},

nested_scope_slot_counts: SlotCounts = SlotCounts{},

runtime_import_record_id: ?u32 = null,
needs_runtime: bool = false,
// This is a list of CommonJS features. When a file uses CommonJS features,
// it's not a candidate for "flat bundling" and must be wrapped in its own
// closure.
has_top_level_return: bool = false,
uses_exports_ref: bool = false,
uses_module_ref: bool = false,
uses_require_ref: bool = false,
commonjs_module_exports_assigned_deoptimized: bool = false,

force_cjs_to_esm: bool = false,
exports_kind: ExportsKind = ExportsKind.none,

// This is a list of ES6 features. They are ranges instead of booleans so
// that they can be used in log messages. Check to see if "Len > 0".
import_keyword: logger.Range = logger.Range.None, // Does not include TypeScript-specific syntax or "import()"
export_keyword: logger.Range = logger.Range.None, // Does not include TypeScript-specific syntax
top_level_await_keyword: logger.Range = logger.Range.None,

/// These are stored at the AST level instead of on individual AST nodes so
/// they can be manipulated efficiently without a full AST traversal
import_records: ImportRecord.List = .{},

hashbang: string = "",
directive: ?string = null,
parts: Part.List = Part.List{},
// This list may be mutated later, so we should store the capacity
symbols: Symbol.List = Symbol.List{},
module_scope: Scope = Scope{},
char_freq: ?CharFreq = null,
exports_ref: Ref = Ref.None,
module_ref: Ref = Ref.None,
/// When using format .bake_internal_dev, this is the HMR variable instead
/// of the wrapper. This is because that format does not store module
/// wrappers in a variable.
wrapper_ref: Ref = Ref.None,
require_ref: Ref = Ref.None,

// These are used when bundling. They are filled in during the parser pass
// since we already have to traverse the AST then anyway and the parser pass
// is conveniently fully parallelized.
named_imports: NamedImports = .{},
named_exports: NamedExports = .{},
export_star_import_records: []u32 = &([_]u32{}),

// allocator: std.mem.Allocator,
top_level_symbols_to_parts: TopLevelSymbolToParts = .{},

commonjs_named_exports: CommonJSNamedExports = .{},

redirect_import_record_index: ?u32 = null,

/// Only populated when bundling
target: bun.options.Target = .browser,
// const_values: ConstValuesMap = .{},
ts_enums: TsEnumsMap = .{},

/// Not to be confused with `commonjs_named_exports`
/// This is a list of named exports that may exist in a CommonJS module
/// We use this with `commonjs_at_runtime` to re-export CommonJS
has_commonjs_export_names: bool = false,
import_meta_ref: Ref = Ref.None,

pub const CommonJSNamedExport = struct {
    loc_ref: LocRef,
    needs_decl: bool = true,
};
pub const CommonJSNamedExports = bun.StringArrayHashMapUnmanaged(CommonJSNamedExport);

pub const NamedImports = std.ArrayHashMapUnmanaged(Ref, NamedImport, RefHashCtx, true);
pub const NamedExports = bun.StringArrayHashMapUnmanaged(NamedExport);
pub const ConstValuesMap = std.ArrayHashMapUnmanaged(Ref, Expr, RefHashCtx, false);
pub const TsEnumsMap = std.ArrayHashMapUnmanaged(Ref, bun.StringHashMapUnmanaged(InlinedEnumValue), RefHashCtx, false);

pub fn fromParts(parts: []Part) Ast {
    return Ast{
        .parts = Part.List.fromOwnedSlice(parts),
        .runtime_imports = .{},
    };
}

pub fn initTest(parts: []const Part) Ast {
    return Ast{
        .parts = Part.List.fromBorrowedSliceDangerous(parts),
        .runtime_imports = .{},
    };
}

pub const empty = Ast{ .parts = Part.List{}, .runtime_imports = .{} };

pub fn toJSON(self: *const Ast, _: std.mem.Allocator, stream: anytype) !void {
    const opts = std.json.StringifyOptions{ .whitespace = std.json.StringifyOptions.Whitespace{
        .separator = true,
    } };
    try std.json.stringify(self.parts, opts, stream);
}

/// Do not call this if it wasn't globally allocated!
pub fn deinit(this: *Ast) void {
    // TODO: assert mimalloc-owned memory
    this.parts.deinit(bun.default_allocator);
    this.symbols.deinit(bun.default_allocator);
    this.import_records.deinit(bun.default_allocator);
}

pub const Class = G.Class;

const string = []const u8;

const std = @import("std");
const Runtime = @import("../runtime.zig").Runtime;

const bun = @import("bun");
const BabyList = bun.BabyList;
const ImportRecord = bun.ImportRecord;
const logger = bun.logger;

const js_ast = bun.ast;
const Ast = js_ast.Ast;
const CharFreq = js_ast.CharFreq;
const ExportsKind = js_ast.ExportsKind;
const Expr = js_ast.Expr;
const G = js_ast.G;
const InlinedEnumValue = js_ast.InlinedEnumValue;
const LocRef = js_ast.LocRef;
const NamedExport = js_ast.NamedExport;
const NamedImport = js_ast.NamedImport;
const Part = js_ast.Part;
const Ref = js_ast.Ref;
const RefHashCtx = js_ast.RefHashCtx;
const Scope = js_ast.Scope;
const SlotCounts = js_ast.SlotCounts;
const Symbol = js_ast.Symbol;
