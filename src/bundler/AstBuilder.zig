/// Utility to construct `Ast`s intended for generated code, such as the
/// boundary modules when dealing with server components. This is a saner
/// alternative to building a string, then sending it through `js_parser`
///
/// For in-depth details on the fields, most of these are documented
/// inside of `js_parser`
pub const AstBuilder = struct {
    allocator: std.mem.Allocator,
    source: *const Logger.Source,
    source_index: u31,
    stmts: std.ArrayListUnmanaged(Stmt),
    scopes: std.ArrayListUnmanaged(*Scope),
    symbols: std.ArrayListUnmanaged(Symbol),
    import_records: std.ArrayListUnmanaged(ImportRecord),
    named_imports: js_ast.Ast.NamedImports,
    named_exports: js_ast.Ast.NamedExports,
    import_records_for_current_part: std.ArrayListUnmanaged(u32),
    export_star_import_records: std.ArrayListUnmanaged(u32),
    current_scope: *Scope,
    log: Logger.Log,
    module_ref: Ref,
    declared_symbols: js_ast.DeclaredSymbol.List,
    /// When set, codegen is altered
    hot_reloading: bool,
    hmr_api_ref: Ref,

    // stub fields for ImportScanner duck typing
    comptime options: js_parser.Parser.Options = .{
        .jsx = .{},
        .bundle = true,
    },
    comptime import_items_for_namespace: struct {
        pub fn get(_: @This(), _: Ref) ?js_parser.ImportItemForNamespaceMap {
            return null;
        }
    } = .{},
    pub const parser_features = struct {
        pub const typescript = false;
    };

    pub fn init(allocator: std.mem.Allocator, source: *const Logger.Source, hot_reloading: bool) !AstBuilder {
        const scope = try allocator.create(Scope);
        scope.* = .{
            .kind = .entry,
            .label_ref = null,
            .parent = null,
            .generated = .{},
        };
        var ab: AstBuilder = .{
            .allocator = allocator,
            .current_scope = scope,
            .source = source,
            .source_index = @intCast(source.index.get()),
            .stmts = .{},
            .scopes = .{},
            .symbols = .{},
            .import_records = .{},
            .import_records_for_current_part = .{},
            .named_imports = .{},
            .named_exports = .{},
            .log = Logger.Log.init(allocator),
            .export_star_import_records = .{},
            .declared_symbols = .{},
            .hot_reloading = hot_reloading,
            .module_ref = undefined,
            .hmr_api_ref = undefined,
        };
        ab.module_ref = try ab.newSymbol(.other, "module");
        ab.hmr_api_ref = try ab.newSymbol(.other, "hmr");
        return ab;
    }

    pub fn pushScope(p: *AstBuilder, kind: Scope.Kind) *js_ast.Scope {
        try p.scopes.ensureUnusedCapacity(p.allocator, 1);
        try p.current_scope.children.ensureUnusedCapacity(p.allocator, 1);
        const scope = try p.allocator.create(Scope);
        scope.* = .{
            .kind = kind,
            .label_ref = null,
            .parent = p.current_scope,
            .generated = .{},
        };
        p.current_scope.children.appendAssumeCapacity(scope);
        p.scopes.appendAssumeCapacity(p.current_scope);
        p.current_scope = scope;
        return scope;
    }

    pub fn popScope(p: *AstBuilder) void {
        p.current_scope = p.scopes.pop();
    }

    pub fn newSymbol(p: *AstBuilder, kind: Symbol.Kind, identifier: []const u8) !Ref {
        const inner_index: Ref.Int = @intCast(p.symbols.items.len);
        try p.symbols.append(p.allocator, .{
            .kind = kind,
            .original_name = identifier,
        });
        const ref: Ref = .{
            .inner_index = inner_index,
            .source_index = p.source_index,
            .tag = .symbol,
        };
        try p.current_scope.generated.append(p.allocator, ref);
        try p.declared_symbols.append(p.allocator, .{
            .ref = ref,
            .is_top_level = p.scopes.items.len == 0 or p.current_scope == p.scopes.items[0],
        });
        return ref;
    }

    pub fn getSymbol(p: *AstBuilder, ref: Ref) *Symbol {
        bun.assert(ref.source_index == p.source.index.get());
        return &p.symbols.items[ref.inner_index];
    }

    pub fn addImportRecord(p: *AstBuilder, path: []const u8, kind: ImportKind) !u32 {
        const index = p.import_records.items.len;
        try p.import_records.append(p.allocator, .{
            .path = bun.fs.Path.init(path),
            .kind = kind,
            .range = .{},
        });
        return @intCast(index);
    }

    pub fn addImportStmt(
        p: *AstBuilder,
        path: []const u8,
        identifiers_to_import: anytype,
    ) ![identifiers_to_import.len]Expr {
        var out: [identifiers_to_import.len]Expr = undefined;

        const record = try p.addImportRecord(path, .stmt);

        var path_name = bun.fs.PathName.init(path);
        const name = try strings.append(p.allocator, "import_", try path_name.nonUniqueNameString(p.allocator));
        const namespace_ref = try p.newSymbol(.other, name);

        const clauses = try p.allocator.alloc(js_ast.ClauseItem, identifiers_to_import.len);

        inline for (identifiers_to_import, &out, clauses) |import_id_untyped, *out_ref, *clause| {
            const import_id: []const u8 = import_id_untyped; // must be given '[N][]const u8'
            const ref = try p.newSymbol(.import, import_id);
            if (p.hot_reloading) {
                p.getSymbol(ref).namespace_alias = .{
                    .namespace_ref = namespace_ref,
                    .alias = import_id,
                    .import_record_index = record,
                };
            }
            out_ref.* = p.newExpr(E.ImportIdentifier{ .ref = ref });
            clause.* = .{
                .name = .{ .loc = Logger.Loc.Empty, .ref = ref },
                .original_name = import_id,
                .alias = import_id,
            };
        }

        try p.appendStmt(S.Import{
            .namespace_ref = namespace_ref,
            .import_record_index = record,
            .items = clauses,
            .is_single_line = identifiers_to_import.len < 1,
        });

        return out;
    }

    pub fn appendStmt(p: *AstBuilder, data: anytype) !void {
        try p.stmts.ensureUnusedCapacity(p.allocator, 1);
        p.stmts.appendAssumeCapacity(p.newStmt(data));
    }

    pub fn newStmt(p: *AstBuilder, data: anytype) Stmt {
        _ = p;
        return Stmt.alloc(@TypeOf(data), data, Logger.Loc.Empty);
    }

    pub fn newExpr(p: *AstBuilder, data: anytype) Expr {
        _ = p;
        return Expr.init(@TypeOf(data), data, Logger.Loc.Empty);
    }

    pub fn newExternalSymbol(p: *AstBuilder, name: []const u8) !Ref {
        const ref = try p.newSymbol(.other, name);
        const sym = p.getSymbol(ref);
        sym.must_not_be_renamed = true;
        return ref;
    }

    pub fn toBundledAst(p: *AstBuilder, target: options.Target) !js_ast.BundledAst {
        // TODO: missing import scanner
        bun.assert(p.scopes.items.len == 0);
        const module_scope = p.current_scope;

        var parts = try Part.List.initCapacity(p.allocator, 2);
        parts.len = 2;
        parts.mut(0).* = .{};
        parts.mut(1).* = .{
            .stmts = p.stmts.items,
            .can_be_removed_if_unused = false,

            // pretend that every symbol was used
            .symbol_uses = uses: {
                var map: Part.SymbolUseMap = .{};
                try map.ensureTotalCapacity(p.allocator, p.symbols.items.len);
                for (0..p.symbols.items.len) |i| {
                    map.putAssumeCapacity(Ref{
                        .tag = .symbol,
                        .source_index = p.source_index,
                        .inner_index = @intCast(i),
                    }, .{ .count_estimate = 1 });
                }
                break :uses map;
            },
        };

        const single_u32 = try BabyList(u32).fromSlice(p.allocator, &.{1});

        var top_level_symbols_to_parts = js_ast.Ast.TopLevelSymbolToParts{};
        try top_level_symbols_to_parts.entries.setCapacity(p.allocator, module_scope.generated.len);
        top_level_symbols_to_parts.entries.len = module_scope.generated.len;
        const slice = top_level_symbols_to_parts.entries.slice();
        for (
            slice.items(.key),
            slice.items(.value),
            module_scope.generated.slice(),
        ) |*k, *v, ref| {
            k.* = ref;
            v.* = single_u32;
        }
        try top_level_symbols_to_parts.reIndex(p.allocator);

        // For more details on this section, look at js_parser.toAST
        // This is mimicking how it calls ImportScanner
        if (p.hot_reloading) {
            var hmr_transform_ctx = js_parser.ConvertESMExportsForHmr{
                .last_part = parts.last() orelse
                    unreachable, // was definitely allocated
                .is_in_node_modules = p.source.path.isNodeModule(),
            };
            try hmr_transform_ctx.stmts.ensureTotalCapacity(p.allocator, prealloc_count: {
                // get a estimate on how many statements there are going to be
                const count = p.stmts.items.len;
                break :prealloc_count count + 2;
            });

            _ = try js_parser.ImportScanner.scan(AstBuilder, p, p.stmts.items, false, true, &hmr_transform_ctx);

            try hmr_transform_ctx.finalize(p, parts.slice());
            const new_parts = parts.slice();
            // preserve original capacity
            parts.len = @intCast(new_parts.len);
            bun.assert(new_parts.ptr == parts.ptr);
        } else {
            const result = try js_parser.ImportScanner.scan(AstBuilder, p, p.stmts.items, false, false, {});
            parts.mut(1).stmts = result.stmts;
        }

        parts.mut(1).declared_symbols = p.declared_symbols;
        parts.mut(1).scopes = p.scopes.items;
        parts.mut(1).import_record_indices = BabyList(u32).moveFromList(&p.import_records_for_current_part);

        return .{
            .parts = parts,
            .module_scope = module_scope.*,
            .symbols = js_ast.Symbol.List.moveFromList(&p.symbols),
            .exports_ref = Ref.None,
            .wrapper_ref = Ref.None,
            .module_ref = p.module_ref,
            .import_records = ImportRecord.List.moveFromList(&p.import_records),
            .export_star_import_records = &.{},
            .approximate_newline_count = 1,
            .exports_kind = .esm,
            .named_imports = p.named_imports,
            .named_exports = p.named_exports,
            .top_level_symbols_to_parts = top_level_symbols_to_parts,
            .char_freq = .{},
            .flags = .{},
            .target = target,
            .top_level_await_keyword = Logger.Range.None,
            // .nested_scope_slot_counts = if (p.options.features.minify_identifiers)
            //     renamer.assignNestedScopeSlots(p.allocator, p.scopes.items[0], p.symbols.items)
            // else
            //     js_ast.SlotCounts{},
        };
    }

    // stub methods for ImportScanner duck typing

    pub fn generateTempRef(ab: *AstBuilder, name: ?[]const u8) Ref {
        return bun.handleOom(ab.newSymbol(.other, name orelse "temp"));
    }

    pub fn recordExport(p: *AstBuilder, _: Logger.Loc, alias: []const u8, ref: Ref) !void {
        if (p.named_exports.get(alias)) |_| {
            // Duplicate exports are an error
            Output.panic(
                "In generated file, duplicate export \"{s}\"",
                .{alias},
            );
        } else {
            try p.named_exports.put(p.allocator, alias, .{ .alias_loc = Logger.Loc.Empty, .ref = ref });
        }
    }

    pub fn recordExportedBinding(p: *AstBuilder, binding: Binding) void {
        switch (binding.data) {
            .b_missing => {},
            .b_identifier => |ident| {
                p.recordExport(binding.loc, p.symbols.items[ident.ref.innerIndex()].original_name, ident.ref) catch unreachable;
            },
            .b_array => |array| {
                for (array.items) |prop| {
                    p.recordExportedBinding(prop.binding);
                }
            },
            .b_object => |obj| {
                for (obj.properties) |prop| {
                    p.recordExportedBinding(prop.value);
                }
            },
        }
    }

    pub fn ignoreUsage(p: *AstBuilder, ref: Ref) void {
        _ = p;
        _ = ref;
    }

    pub fn panic(p: *AstBuilder, comptime fmt: []const u8, args: anytype) noreturn {
        _ = p;
        Output.panic(fmt, args);
    }

    pub fn @"module.exports"(p: *AstBuilder, loc: Logger.Loc) Expr {
        return p.newExpr(E.Dot{ .name = "exports", .name_loc = loc, .target = p.newExpr(E.Identifier{ .ref = p.module_ref }) });
    }
};

pub const Ref = bun.ast.Ref;

pub const Index = bun.ast.Index;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;

const string = []const u8;

const options = @import("../options.zig");
const std = @import("std");

const Logger = @import("../logger.zig");
const Loc = Logger.Loc;

const bun = @import("bun");
const ImportKind = bun.ImportKind;
const ImportRecord = bun.ImportRecord;
const Output = bun.Output;
const js_parser = bun.js_parser;
const renamer = bun.renamer;
const strings = bun.strings;
const BabyList = bun.collections.BabyList;

const js_ast = bun.ast;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const Part = js_ast.Part;
const S = js_ast.S;
const Scope = js_ast.Scope;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;
