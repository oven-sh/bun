//! AST part representation

stmts: []Stmt = &([_]Stmt{}),
scopes: []*Scope = &([_]*Scope{}),

/// Each is an index into the file-level import record list
import_record_indices: ImportRecordIndices = .{},

/// All symbols that are declared in this part. Note that a given symbol may
/// have multiple declarations, and so may end up being declared in multiple
/// parts (e.g. multiple "var" declarations with the same name). Also note
/// that this list isn't deduplicated and may contain duplicates.
declared_symbols: DeclaredSymbol.List = .{},

/// An estimate of the number of uses of all symbols used within this part.
symbol_uses: SymbolUseMap = .{},

/// This tracks property accesses off of imported symbols. We don't know
/// during parsing if an imported symbol is going to be an inlined enum
/// value or not. This is only known during linking. So we defer adding
/// a dependency on these imported symbols until we know whether the
/// property access is an inlined enum value or not.
import_symbol_property_uses: SymbolPropertyUseMap = .{},

/// The indices of the other parts in this file that are needed if this part
/// is needed.
dependencies: Dependency.List = .{},

/// If true, this part can be removed if none of the declared symbols are
/// used. If the file containing this part is imported, then all parts that
/// don't have this flag enabled must be included.
can_be_removed_if_unused: bool = false,

/// This is used for generated parts that we don't want to be present if they
/// aren't needed. This enables tree shaking for these parts even if global
/// tree shaking isn't enabled.
force_tree_shaking: bool = false,

/// This is true if this file has been marked as live by the tree shaking
/// algorithm.
is_live: bool = false,

tag: Tag = Tag.none,

pub const Tag = enum {
    none,
    jsx_import,
    runtime,
    cjs_imports,
    react_fast_refresh,
    dirname_filename,
    bun_test,
    dead_due_to_inlining,
    commonjs_named_export,
    import_to_convert_from_require,
};

pub const SymbolUseMap = std.ArrayHashMapUnmanaged(Ref, Symbol.Use, RefHashCtx, false);
pub const SymbolPropertyUseMap = std.ArrayHashMapUnmanaged(Ref, bun.StringHashMapUnmanaged(Symbol.Use), RefHashCtx, false);

pub fn jsonStringify(self: *const Part, writer: anytype) !void {
    return writer.write(self.stmts);
}

const js_ast = @import("js_ast.zig");
const Ref = js_ast.Ref;
const Symbol = js_ast.Symbol;
const RefHashCtx = Ref.ArrayHashCtx;
const std = @import("std");
const bun = @import("root").bun;
const BabyList = bun.BabyList;
const Stmt = js_ast.Stmt;
const Scope = js_ast.Scope;
const DeclaredSymbol = js_ast.DeclaredSymbol;
const Dependency = js_ast.Dependency;

/// Represents a part of an AST (e.g., a chunk of statements)
const Part = @This();

/// List of import record indices
pub const ImportRecordIndices = BabyList(u32);

/// List of parts
pub const List = BabyList(Part);
