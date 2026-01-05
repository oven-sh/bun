last_part: *js_ast.Part,
// files in node modules will not get hot updates, so the code generation
// can be a bit more concise for re-exports
is_in_node_modules: bool,
imports_seen: bun.StringArrayHashMapUnmanaged(ImportRef) = .{},
export_star_props: std.ArrayListUnmanaged(G.Property) = .{},
export_props: std.ArrayListUnmanaged(G.Property) = .{},
stmts: std.ArrayListUnmanaged(Stmt) = .{},

const ImportRef = struct {
    /// Index into ConvertESMExportsForHmr.stmts
    stmt_index: u32,
};

pub fn convertStmt(ctx: *ConvertESMExportsForHmr, p: anytype, stmt: Stmt) !void {
    const new_stmt = switch (stmt.data) {
        else => brk: {
            break :brk stmt;
        },
        .s_local => |st| stmt: {
            if (!st.is_export) {
                break :stmt stmt;
            }

            st.is_export = false;

            var new_len: usize = 0;
            for (st.decls.slice()) |*decl_ptr| {
                const decl = decl_ptr.*; // explicit copy to avoid aliasinng
                const value = decl.value orelse {
                    st.decls.mut(new_len).* = decl;
                    new_len += 1;
                    try ctx.visitBindingToExport(p, decl.binding);
                    continue;
                };

                switch (decl.binding.data) {
                    .b_missing => {},

                    .b_identifier => |id| {
                        const symbol = p.symbols.items[id.ref.inner_index];

                        // if the symbol is not used, we don't need to preserve
                        // a binding in this scope. we can move it to the exports object.
                        if (symbol.use_count_estimate == 0 and value.canBeMoved()) {
                            try ctx.export_props.append(p.allocator, .{
                                .key = Expr.init(E.String, .{ .data = symbol.original_name }, decl.binding.loc),
                                .value = value,
                            });
                        } else {
                            st.decls.mut(new_len).* = decl;
                            new_len += 1;
                            try ctx.visitBindingToExport(p, decl.binding);
                        }
                    },

                    else => {
                        st.decls.mut(new_len).* = decl;
                        new_len += 1;
                        try ctx.visitBindingToExport(p, decl.binding);
                    },
                }
            }
            if (new_len == 0) {
                return;
            }
            st.decls.len = @intCast(new_len);

            break :stmt stmt;
        },
        .s_export_default => |st| stmt: {
            // When React Fast Refresh needs to tag the default export, the statement
            // cannot be moved, since a local reference is required.
            if (p.options.features.react_fast_refresh and
                st.value == .stmt and st.value.stmt.data == .s_function)
            fast_refresh_edge_case: {
                const symbol = st.value.stmt.data.s_function.func.name orelse
                    break :fast_refresh_edge_case;
                const name = p.symbols.items[symbol.ref.?.inner_index].original_name;
                if (ReactRefresh.isComponentishName(name)) {
                    // Lower to a function statement, and reference the function in the export list.
                    try ctx.export_props.append(p.allocator, .{
                        .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                        .value = Expr.initIdentifier(symbol.ref.?, stmt.loc),
                    });
                    break :stmt st.value.stmt;
                }
                // All other functions can be properly moved.
            }

            // Try to move the export default expression to the end.
            const can_be_moved_to_inner_scope = switch (st.value) {
                .stmt => |s| switch (s.data) {
                    .s_class => |c| c.class.canBeMoved() and (if (c.class.class_name) |name|
                        p.symbols.items[name.ref.?.inner_index].use_count_estimate == 0
                    else
                        true),
                    .s_function => |f| if (f.func.name) |name|
                        p.symbols.items[name.ref.?.inner_index].use_count_estimate == 0
                    else
                        true,
                    else => unreachable,
                },
                .expr => |e| switch (e.data) {
                    .e_identifier => true,
                    else => e.canBeMoved(),
                },
            };
            if (can_be_moved_to_inner_scope) {
                try ctx.export_props.append(p.allocator, .{
                    .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                    .value = st.value.toExpr(),
                });
                // no statement emitted
                return;
            }

            // Otherwise, an identifier must be exported
            switch (st.value) {
                .expr => {
                    const temp_id = p.generateTempRef("default_export");
                    try ctx.last_part.declared_symbols.append(p.allocator, .{ .ref = temp_id, .is_top_level = true });
                    try ctx.last_part.symbol_uses.putNoClobber(p.allocator, temp_id, .{ .count_estimate = 1 });
                    try p.current_scope.generated.append(p.allocator, temp_id);

                    try ctx.export_props.append(p.allocator, .{
                        .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                        .value = Expr.initIdentifier(temp_id, stmt.loc),
                    });

                    break :stmt Stmt.alloc(S.Local, .{
                        .kind = .k_const,
                        .decls = try G.Decl.List.fromSlice(p.allocator, &.{
                            .{
                                .binding = Binding.alloc(p.allocator, B.Identifier{ .ref = temp_id }, stmt.loc),
                                .value = st.value.toExpr(),
                            },
                        }),
                    }, stmt.loc);
                },
                .stmt => |s| {
                    try ctx.export_props.append(p.allocator, .{
                        .key = Expr.init(E.String, .{ .data = "default" }, stmt.loc),
                        .value = Expr.initIdentifier(switch (s.data) {
                            .s_class => |class| class.class.class_name.?.ref.?,
                            .s_function => |func| func.func.name.?.ref.?,
                            else => unreachable,
                        }, stmt.loc),
                    });
                    break :stmt s;
                },
            }
        },
        .s_class => |st| stmt: {

            // Strip the "export" keyword
            if (!st.is_export) {
                break :stmt stmt;
            }

            // Export as CommonJS
            try ctx.export_props.append(p.allocator, .{
                .key = Expr.init(E.String, .{
                    .data = p.symbols.items[st.class.class_name.?.ref.?.inner_index].original_name,
                }, stmt.loc),
                .value = Expr.initIdentifier(st.class.class_name.?.ref.?, stmt.loc),
            });

            st.is_export = false;

            break :stmt stmt;
        },
        .s_function => |st| stmt: {
            // Strip the "export" keyword
            if (!st.func.flags.contains(.is_export)) break :stmt stmt;

            st.func.flags.remove(.is_export);

            try ctx.visitRefToExport(
                p,
                st.func.name.?.ref.?,
                null,
                stmt.loc,
                false,
            );

            break :stmt stmt;
        },
        .s_export_clause => |st| {
            for (st.items) |item| {
                const ref = item.name.ref.?;
                try ctx.visitRefToExport(p, ref, item.alias, item.name.loc, false);
            }

            return; // do not emit a statement here
        },
        .s_export_from => |st| {
            const namespace_ref = try ctx.deduplicatedImport(
                p,
                st.import_record_index,
                st.namespace_ref,
                st.items,
                stmt.loc,
                null,
                stmt.loc,
            );
            for (st.items) |*item| {
                const ref = item.name.ref.?;
                const symbol = &p.symbols.items[ref.innerIndex()];
                if (symbol.namespace_alias == null) {
                    symbol.namespace_alias = .{
                        .namespace_ref = namespace_ref,
                        .alias = item.original_name,
                        .import_record_index = st.import_record_index,
                    };
                }
                try ctx.visitRefToExport(
                    p,
                    ref,
                    item.alias,
                    item.name.loc,
                    !ctx.is_in_node_modules, // live binding when this may be replaced
                );

                // imports and export statements have their alias +
                // original_name swapped. this is likely a design bug in
                // the parser but since everything uses these
                // assumptions, this hack is simpler than making it
                // proper
                const alias = item.alias;
                item.alias = item.original_name;
                item.original_name = alias;
            }
            return;
        },
        .s_export_star => |st| {
            const namespace_ref = try ctx.deduplicatedImport(
                p,
                st.import_record_index,
                st.namespace_ref,
                &.{},
                stmt.loc,
                null,
                stmt.loc,
            );

            if (st.alias) |alias| {
                // 'export * as ns from' creates one named property.
                try ctx.export_props.append(p.allocator, .{
                    .key = Expr.init(E.String, .{ .data = alias.original_name }, stmt.loc),
                    .value = Expr.initIdentifier(namespace_ref, stmt.loc),
                });
            } else {
                // 'export * from' creates a spread, hoisted at the top.
                try ctx.export_star_props.append(p.allocator, .{
                    .kind = .spread,
                    .value = Expr.initIdentifier(namespace_ref, stmt.loc),
                });
            }
            return;
        },
        // De-duplicate import statements. It is okay to disregard
        // named/default imports here as we always rewrite them as
        // full qualified property accesses (needed for live-bindings)
        .s_import => |st| {
            _ = try ctx.deduplicatedImport(
                p,
                st.import_record_index,
                st.namespace_ref,
                st.items,
                st.star_name_loc,
                st.default_name,
                stmt.loc,
            );
            return;
        },
    };

    try ctx.stmts.append(p.allocator, new_stmt);
}

/// Deduplicates imports, returning a previously used Ref if present.
fn deduplicatedImport(
    ctx: *ConvertESMExportsForHmr,
    p: anytype,
    import_record_index: u32,
    namespace_ref: Ref,
    items: []js_ast.ClauseItem,
    star_name_loc: ?logger.Loc,
    default_name: ?js_ast.LocRef,
    loc: logger.Loc,
) !Ref {
    const ir = &p.import_records.items[import_record_index];
    const gop = try ctx.imports_seen.getOrPut(p.allocator, ir.path.text);
    if (gop.found_existing) {
        // Disable this one since an older record is getting used.  It isn't
        // practical to delete this import record entry since an import or
        // require expression can exist.
        ir.flags.is_unused = true;

        const stmt = ctx.stmts.items[gop.value_ptr.stmt_index].data.s_import;
        if (items.len > 0) {
            if (stmt.items.len == 0) {
                stmt.items = items;
            } else {
                stmt.items = try std.mem.concat(p.allocator, js_ast.ClauseItem, &.{ stmt.items, items });
            }
        }
        if (namespace_ref.isValid()) {
            if (!stmt.namespace_ref.isValid()) {
                stmt.namespace_ref = namespace_ref;
                return namespace_ref;
            } else {
                // Erase this namespace ref, but since it may be used in
                // existing AST trees, a link must be established.
                const symbol = &p.symbols.items[namespace_ref.innerIndex()];
                symbol.use_count_estimate = 0;
                symbol.link = stmt.namespace_ref;
                if (@hasField(@typeInfo(@TypeOf(p)).pointer.child, "symbol_uses")) {
                    _ = p.symbol_uses.swapRemove(namespace_ref);
                }
            }
        }
        if (stmt.star_name_loc == null) if (star_name_loc) |stl| {
            stmt.star_name_loc = stl;
        };
        if (stmt.default_name == null) if (default_name) |dn| {
            stmt.default_name = dn;
        };
        return stmt.namespace_ref;
    }

    try ctx.stmts.append(p.allocator, Stmt.alloc(S.Import, .{
        .import_record_index = import_record_index,
        .is_single_line = true,
        .default_name = default_name,
        .items = items,
        .namespace_ref = namespace_ref,
        .star_name_loc = star_name_loc,
    }, loc));

    gop.value_ptr.* = .{ .stmt_index = @intCast(ctx.stmts.items.len - 1) };
    return namespace_ref;
}

fn visitBindingToExport(ctx: *ConvertESMExportsForHmr, p: anytype, binding: Binding) !void {
    switch (binding.data) {
        .b_missing => {},
        .b_identifier => |id| {
            try ctx.visitRefToExport(p, id.ref, null, binding.loc, false);
        },
        .b_array => |array| {
            for (array.items) |item| {
                try ctx.visitBindingToExport(p, item.binding);
            }
        },
        .b_object => |object| {
            for (object.properties) |item| {
                try ctx.visitBindingToExport(p, item.value);
            }
        },
    }
}

fn visitRefToExport(
    ctx: *ConvertESMExportsForHmr,
    p: anytype,
    ref: Ref,
    export_symbol_name: ?[]const u8,
    loc: logger.Loc,
    is_live_binding_source: bool,
) !void {
    const symbol = p.symbols.items[ref.inner_index];
    const id = if (symbol.kind == .import)
        Expr.init(E.ImportIdentifier, .{ .ref = ref }, loc)
    else
        Expr.initIdentifier(ref, loc);
    if (is_live_binding_source or (symbol.kind == .import and !ctx.is_in_node_modules) or symbol.has_been_assigned_to) {
        // TODO (2024-11-24) instead of requiring getters for live-bindings,
        // a callback propagation system should be considered.  mostly
        // because here, these might not even be live bindings, and
        // re-exports are so, so common.
        //
        // update(2025-03-05): HMRModule in ts now contains an exhaustive map
        // of importers. For local live bindings, these can just remember to
        // mutate the field in the exports object. Re-exports can just be
        // encoded into the module format, propagated in `replaceModules`
        const key = Expr.init(E.String, .{
            .data = export_symbol_name orelse symbol.original_name,
        }, loc);

        // This is technically incorrect in that we've marked this as a
        // top level symbol. but all we care about is preventing name
        // collisions, not necessarily the best minificaiton (dev only)
        const arg1 = p.generateTempRef(symbol.original_name);
        try ctx.last_part.declared_symbols.append(p.allocator, .{ .ref = arg1, .is_top_level = true });
        try ctx.last_part.symbol_uses.putNoClobber(p.allocator, arg1, .{ .count_estimate = 1 });
        try p.current_scope.generated.append(p.allocator, arg1);

        // 'get abc() { return abc }'
        try ctx.export_props.append(p.allocator, .{
            .kind = .get,
            .key = key,
            .value = Expr.init(E.Function, .{ .func = .{
                .body = .{
                    .stmts = try p.allocator.dupe(Stmt, &.{
                        Stmt.alloc(S.Return, .{ .value = id }, loc),
                    }),
                    .loc = loc,
                },
            } }, loc),
        });
        // no setter is added since live bindings are read-only
    } else {
        // 'abc,'
        try ctx.export_props.append(p.allocator, .{
            .key = Expr.init(E.String, .{
                .data = export_symbol_name orelse symbol.original_name,
            }, loc),
            .value = id,
        });
    }
}

pub fn finalize(ctx: *ConvertESMExportsForHmr, p: anytype, all_parts: []js_ast.Part) !void {
    if (ctx.export_star_props.items.len > 0) {
        if (ctx.export_props.items.len == 0) {
            ctx.export_props = ctx.export_star_props;
        } else {
            const export_star_len = ctx.export_star_props.items.len;
            try ctx.export_props.ensureUnusedCapacity(p.allocator, export_star_len);
            const len = ctx.export_props.items.len;
            ctx.export_props.items.len += export_star_len;
            bun.copy(G.Property, ctx.export_props.items[export_star_len..], ctx.export_props.items[0..len]);
            @memcpy(ctx.export_props.items[0..export_star_len], ctx.export_star_props.items);
        }
    }

    if (ctx.export_props.items.len > 0) {
        const obj = Expr.init(E.Object, .{
            .properties = G.Property.List.moveFromList(&ctx.export_props),
        }, logger.Loc.Empty);

        // `hmr.exports = ...`
        try ctx.stmts.append(p.allocator, Stmt.alloc(S.SExpr, .{
            .value = Expr.assign(
                Expr.init(E.Dot, .{
                    .target = Expr.initIdentifier(p.hmr_api_ref, logger.Loc.Empty),
                    .name = "exports",
                    .name_loc = logger.Loc.Empty,
                }, logger.Loc.Empty),
                obj,
            ),
        }, logger.Loc.Empty));

        // mark a dependency on module_ref so it is renamed
        try ctx.last_part.symbol_uses.put(p.allocator, p.module_ref, .{ .count_estimate = 1 });
        try ctx.last_part.declared_symbols.append(p.allocator, .{ .ref = p.module_ref, .is_top_level = true });
    }

    if (p.options.features.react_fast_refresh and p.react_refresh.register_used) {
        try ctx.stmts.append(p.allocator, Stmt.alloc(S.SExpr, .{
            .value = Expr.init(E.Call, .{
                .target = Expr.init(E.Dot, .{
                    .target = Expr.initIdentifier(p.hmr_api_ref, .Empty),
                    .name = "reactRefreshAccept",
                    .name_loc = .Empty,
                }, .Empty),
                .args = .empty,
            }, .Empty),
        }, .Empty));
    }

    // Merge all part metadata into the first part.
    for (all_parts[0 .. all_parts.len - 1]) |*part| {
        try ctx.last_part.declared_symbols.appendList(p.allocator, part.declared_symbols);
        try ctx.last_part.import_record_indices.appendSlice(
            p.allocator,
            part.import_record_indices.slice(),
        );
        for (part.symbol_uses.keys(), part.symbol_uses.values()) |k, v| {
            const gop = try ctx.last_part.symbol_uses.getOrPut(p.allocator, k);
            if (!gop.found_existing) {
                gop.value_ptr.* = v;
            } else {
                gop.value_ptr.count_estimate += v.count_estimate;
            }
        }
        part.stmts = &.{};
        part.declared_symbols.entries.len = 0;
        part.tag = .dead_due_to_inlining;
        part.dependencies.clearRetainingCapacity();
        try part.dependencies.append(p.allocator, .{
            .part_index = @intCast(all_parts.len - 1),
            .source_index = p.source.index,
        });
    }

    try ctx.last_part.import_record_indices.appendSlice(
        p.allocator,
        p.import_records_for_current_part.items,
    );
    try ctx.last_part.declared_symbols.appendList(p.allocator, p.declared_symbols);

    ctx.last_part.stmts = ctx.stmts.items;
    ctx.last_part.tag = .none;
}

const bun = @import("bun");
const logger = bun.logger;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Stmt = js_ast.Stmt;

const G = js_ast.G;
const Decl = G.Decl;
const Property = G.Property;

const js_parser = bun.js_parser;
const ConvertESMExportsForHmr = js_parser.ConvertESMExportsForHmr;
const ReactRefresh = js_parser.ReactRefresh;
const Ref = js_parser.Ref;
const options = js_parser.options;

const std = @import("std");
const List = std.ArrayListUnmanaged;
