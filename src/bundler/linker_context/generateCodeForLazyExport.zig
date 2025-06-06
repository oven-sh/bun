pub fn generateCodeForLazyExport(this: *LinkerContext, source_index: Index.Int) !void {
    const exports_kind = this.graph.ast.items(.exports_kind)[source_index];
    const all_sources = this.parse_graph.input_files.items(.source);
    const all_css_asts = this.graph.ast.items(.css);
    const maybe_css_ast: ?*bun.css.BundlerStyleSheet = all_css_asts[source_index];
    var parts = &this.graph.ast.items(.parts)[source_index];

    if (parts.len < 1) {
        @panic("Internal error: expected at least one part for lazy export");
    }

    var part: *Part = &parts.ptr[1];

    if (part.stmts.len == 0) {
        @panic("Internal error: expected at least one statement in the lazy export");
    }

    const module_ref = this.graph.ast.items(.module_ref)[source_index];

    // Handle css modules
    //
    // --- original comment from esbuild ---
    // If this JavaScript file is a stub from a CSS file, populate the exports of
    // this JavaScript stub with the local names from that CSS file. This is done
    // now instead of earlier because we need the whole bundle to be present.
    if (maybe_css_ast) |css_ast| {
        const stmt: Stmt = part.stmts[0];
        if (stmt.data != .s_lazy_export) {
            @panic("Internal error: expected top-level lazy export statement");
        }
        if (css_ast.local_scope.count() > 0) out: {
            var exports = E.Object{};

            const symbols: *const Symbol.List = &this.graph.ast.items(.symbols)[source_index];
            const all_import_records: []const BabyList(bun.css.ImportRecord) = this.graph.ast.items(.import_records);

            const values = css_ast.local_scope.values();
            if (values.len == 0) break :out;
            const size = size: {
                var size: u32 = 0;
                for (values) |entry| {
                    size = @max(size, entry.ref.inner_index);
                }
                break :size size + 1;
            };

            var inner_visited = try BitSet.initEmpty(this.allocator, size);
            defer inner_visited.deinit(this.allocator);
            var composes_visited = std.AutoArrayHashMap(bun.bundle_v2.Ref, void).init(this.allocator);
            defer composes_visited.deinit();

            const Visitor = struct {
                inner_visited: *BitSet,
                composes_visited: *std.AutoArrayHashMap(bun.bundle_v2.Ref, void),
                parts: *std.ArrayList(E.TemplatePart),
                all_import_records: []const BabyList(bun.css.ImportRecord),
                all_css_asts: []?*bun.css.BundlerStyleSheet,
                all_sources: []const Logger.Source,
                all_symbols: []const Symbol.List,
                source_index: Index.Int,
                log: *Logger.Log,
                loc: Loc,
                allocator: std.mem.Allocator,

                fn clearAll(visitor: *@This()) void {
                    visitor.inner_visited.setAll(false);
                    visitor.composes_visited.clearRetainingCapacity();
                }

                fn visitName(visitor: *@This(), ast: *bun.css.BundlerStyleSheet, ref: bun.css.CssRef, idx: Index.Int) void {
                    bun.assert(ref.canBeComposed());
                    const from_this_file = ref.sourceIndex(idx) == visitor.source_index;
                    if ((from_this_file and visitor.inner_visited.isSet(ref.innerIndex())) or
                        (!from_this_file and visitor.composes_visited.contains(ref.toRealRef(idx))))
                    {
                        return;
                    }

                    visitor.visitComposes(ast, ref, idx);
                    visitor.parts.append(E.TemplatePart{
                        .value = Expr.init(
                            E.NameOfSymbol,
                            E.NameOfSymbol{
                                .ref = ref.toRealRef(idx),
                            },
                            visitor.loc,
                        ),
                        .tail = .{
                            .cooked = E.String.init(" "),
                        },
                        .tail_loc = visitor.loc,
                    }) catch bun.outOfMemory();

                    if (from_this_file) {
                        visitor.inner_visited.set(ref.innerIndex());
                    } else {
                        visitor.composes_visited.put(ref.toRealRef(idx), {}) catch unreachable;
                    }
                }

                fn warnNonSingleClassComposes(visitor: *@This(), ast: *bun.css.BundlerStyleSheet, css_ref: bun.css.CssRef, idx: Index.Int, compose_loc: Loc) void {
                    const ref = css_ref.toRealRef(idx);
                    _ = ref;
                    const syms: *const Symbol.List = &visitor.all_symbols[css_ref.sourceIndex(idx)];
                    const name = syms.at(css_ref.innerIndex()).original_name;
                    const loc = ast.local_scope.get(name).?.loc;

                    visitor.log.addRangeErrorFmtWithNote(
                        &visitor.all_sources[idx],
                        .{ .loc = compose_loc },
                        visitor.allocator,
                        "The composes property cannot be used with {}, because it is not a single class name.",
                        .{
                            bun.fmt.quote(name),
                        },
                        "The definition of {} is here.",
                        .{
                            bun.fmt.quote(name),
                        },

                        .{
                            .loc = loc,
                        },
                    ) catch bun.outOfMemory();
                }

                fn visitComposes(visitor: *@This(), ast: *bun.css.BundlerStyleSheet, css_ref: bun.css.CssRef, idx: Index.Int) void {
                    const ref = css_ref.toRealRef(idx);
                    if (ast.composes.count() > 0) {
                        const composes = ast.composes.getPtr(ref) orelse return;
                        // while parsing we check that we only allow `composes` on single class selectors
                        bun.assert(css_ref.tag.class);

                        for (composes.composes.slice()) |*compose| {
                            // it is imported
                            if (compose.from != null) {
                                if (compose.from.? == .import_record_index) {
                                    const import_record_idx = compose.from.?.import_record_index;
                                    const import_records: *const BabyList(bun.css.ImportRecord) = &visitor.all_import_records[idx];
                                    const import_record = import_records.at(import_record_idx);
                                    if (import_record.source_index.isValid()) {
                                        const other_file = visitor.all_css_asts[import_record.source_index.get()] orelse {
                                            visitor.log.addErrorFmt(
                                                &visitor.all_sources[idx],
                                                compose.loc,
                                                visitor.allocator,
                                                "Cannot use the \"composes\" property with the {} file (it is not a CSS file)",
                                                .{bun.fmt.quote(visitor.all_sources[import_record.source_index.get()].path.pretty)},
                                            ) catch bun.outOfMemory();
                                            continue;
                                        };
                                        for (compose.names.slice()) |name| {
                                            const other_name_entry = other_file.local_scope.get(name.v) orelse continue;
                                            const other_name_ref = other_name_entry.ref;
                                            if (!other_name_ref.canBeComposed()) {
                                                visitor.warnNonSingleClassComposes(other_file, other_name_ref, import_record.source_index.get(), compose.loc);
                                            } else {
                                                visitor.visitName(other_file, other_name_ref, import_record.source_index.get());
                                            }
                                        }
                                    }
                                } else if (compose.from.? == .global) {
                                    // E.g.: `composes: foo from global`
                                    //
                                    // In this example `foo` is global and won't be rewritten to a locally scoped
                                    // name, so we can just add it as a string.
                                    for (compose.names.slice()) |name| {
                                        visitor.parts.append(
                                            E.TemplatePart{
                                                .value = Expr.init(
                                                    E.String,
                                                    E.String.init(name.v),
                                                    visitor.loc,
                                                ),
                                                .tail = .{
                                                    .cooked = E.String.init(" "),
                                                },
                                                .tail_loc = visitor.loc,
                                            },
                                        ) catch bun.outOfMemory();
                                    }
                                }
                            } else {
                                // it is from the current file
                                for (compose.names.slice()) |name| {
                                    const name_entry = ast.local_scope.get(name.v) orelse {
                                        visitor.log.addErrorFmt(
                                            &visitor.all_sources[idx],
                                            compose.loc,
                                            visitor.allocator,
                                            "The name {} never appears in {} as a CSS modules locally scoped class name. Note that \"composes\" only works with single class selectors.",
                                            .{
                                                bun.fmt.quote(name.v),
                                                bun.fmt.quote(visitor.all_sources[idx].path.pretty),
                                            },
                                        ) catch bun.outOfMemory();
                                        continue;
                                    };
                                    const name_ref = name_entry.ref;
                                    if (!name_ref.canBeComposed()) {
                                        visitor.warnNonSingleClassComposes(ast, name_ref, idx, compose.loc);
                                    } else {
                                        visitor.visitName(ast, name_ref, idx);
                                    }
                                }
                            }
                        }
                    }
                }
            };

            var visitor = Visitor{
                .inner_visited = &inner_visited,
                .composes_visited = &composes_visited,
                .source_index = source_index,
                .parts = undefined,
                .all_import_records = all_import_records,
                .all_css_asts = all_css_asts,
                .loc = stmt.loc,
                .log = this.log,
                .all_sources = all_sources,
                .allocator = this.allocator,
                .all_symbols = this.graph.ast.items(.symbols),
            };

            for (values) |entry| {
                const ref = entry.ref;
                bun.assert(ref.inner_index < symbols.len);

                var template_parts = std.ArrayList(E.TemplatePart).init(this.allocator);
                var value = Expr.init(E.NameOfSymbol, E.NameOfSymbol{ .ref = ref.toRealRef(source_index) }, stmt.loc);

                visitor.parts = &template_parts;
                visitor.clearAll();
                visitor.inner_visited.set(ref.innerIndex());
                if (ref.tag.class) visitor.visitComposes(css_ast, ref, source_index);

                if (template_parts.items.len > 0) {
                    template_parts.append(E.TemplatePart{
                        .value = value,
                        .tail_loc = stmt.loc,
                        .tail = .{ .cooked = E.String.init("") },
                    }) catch bun.outOfMemory();
                    value = Expr.init(
                        E.Template,
                        E.Template{
                            .parts = template_parts.items,
                            .head = .{
                                .cooked = E.String.init(""),
                            },
                        },
                        stmt.loc,
                    );
                }

                const key = symbols.at(ref.innerIndex()).original_name;
                try exports.put(this.allocator, key, value);
            }

            part.stmts[0].data.s_lazy_export.* = Expr.init(E.Object, exports, stmt.loc).data;
        }
    }

    const stmt: Stmt = part.stmts[0];
    if (stmt.data != .s_lazy_export) {
        @panic("Internal error: expected top-level lazy export statement");
    }

    const expr = Expr{
        .data = stmt.data.s_lazy_export.*,
        .loc = stmt.loc,
    };

    switch (exports_kind) {
        .cjs => {
            part.stmts[0] = Stmt.assign(
                Expr.init(
                    E.Dot,
                    E.Dot{
                        .target = Expr.initIdentifier(module_ref, stmt.loc),
                        .name = "exports",
                        .name_loc = stmt.loc,
                    },
                    stmt.loc,
                ),
                expr,
            );
            try this.graph.generateSymbolImportAndUse(source_index, 0, module_ref, 1, Index.init(source_index));

            // If this is a .napi addon and it's not node, we need to generate a require() call to the runtime
            if (expr.data == .e_call and
                expr.data.e_call.target.data == .e_require_call_target and
                // if it's commonjs, use require()
                this.options.output_format != .cjs)
            {
                try this.graph.generateRuntimeSymbolImportAndUse(
                    source_index,
                    Index.part(1),
                    "__require",
                    1,
                );
            }
        },
        else => {
            // Otherwise, generate ES6 export statements. These are added as additional
            // parts so they can be tree shaken individually.
            part.stmts.len = 0;

            if (expr.data == .e_object) {
                for (expr.data.e_object.properties.slice()) |property_| {
                    const property: G.Property = property_;
                    if (property.key == null or property.key.?.data != .e_string or property.value == null or
                        property.key.?.data.e_string.eqlComptime("default") or property.key.?.data.e_string.eqlComptime("__esModule"))
                    {
                        continue;
                    }

                    const name = property.key.?.data.e_string.slice(this.allocator);

                    // TODO: support non-identifier names
                    if (!bun.js_lexer.isIdentifier(name))
                        continue;

                    // This initializes the generated variable with a copy of the property
                    // value, which is INCORRECT for values that are objects/arrays because
                    // they will have separate object identity. This is fixed up later in
                    // "generateCodeForFileInChunkJS" by changing the object literal to
                    // reference this generated variable instead.
                    //
                    // Changing the object literal is deferred until that point instead of
                    // doing it now because we only want to do this for top-level variables
                    // that actually end up being used, and we don't know which ones will
                    // end up actually being used at this point (since import binding hasn't
                    // happened yet). So we need to wait until after tree shaking happens.
                    const generated = try this.generateNamedExportInFile(source_index, module_ref, name, name);
                    parts.ptr[generated[1]].stmts = this.allocator.alloc(Stmt, 1) catch unreachable;
                    parts.ptr[generated[1]].stmts[0] = Stmt.alloc(
                        S.Local,
                        S.Local{
                            .is_export = true,
                            .decls = js_ast.G.Decl.List.fromSlice(
                                this.allocator,
                                &.{
                                    .{
                                        .binding = Binding.alloc(
                                            this.allocator,
                                            B.Identifier{
                                                .ref = generated[0],
                                            },
                                            expr.loc,
                                        ),
                                        .value = property.value.?,
                                    },
                                },
                            ) catch unreachable,
                        },
                        property.key.?.loc,
                    );
                }
            }

            {
                const generated = try this.generateNamedExportInFile(
                    source_index,
                    module_ref,
                    std.fmt.allocPrint(
                        this.allocator,
                        "{}_default",
                        .{this.parse_graph.input_files.items(.source)[source_index].fmtIdentifier()},
                    ) catch unreachable,
                    "default",
                );
                parts.ptr[generated[1]].stmts = this.allocator.alloc(Stmt, 1) catch unreachable;
                parts.ptr[generated[1]].stmts[0] = Stmt.alloc(
                    S.ExportDefault,
                    S.ExportDefault{
                        .default_name = .{
                            .ref = generated[0],
                            .loc = stmt.loc,
                        },
                        .value = .{
                            .expr = expr,
                        },
                    },
                    stmt.loc,
                );
            }
        },
    }
}

const bun = @import("bun");
const Ref = bun.bundle_v2.Ref;
const BabyList = bun.BabyList;
const Logger = bun.logger;
const Index = bun.bundle_v2.Index;
const Loc = Logger.Loc;
const LinkerContext = bun.bundle_v2.LinkerContext;

const string = bun.string;

const std = @import("std");
const Part = js_ast.Part;
const js_ast = bun.js_ast;
const ImportRecord = bun.ImportRecord;

const Symbol = js_ast.Symbol;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const E = js_ast.E;
const S = js_ast.S;
const G = js_ast.G;
const B = js_ast.B;
const Binding = js_ast.Binding;
const BitSet = bun.bit_set.DynamicBitSetUnmanaged;

pub const DeferredBatchTask = bun.bundle_v2.DeferredBatchTask;
pub const ThreadPool = bun.bundle_v2.ThreadPool;
pub const ParseTask = bun.bundle_v2.ParseTask;
