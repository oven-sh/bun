/// REPL Transform module - transforms code for interactive REPL evaluation
///
/// This module provides transformations for REPL mode:
/// - Wraps the last expression in { value: expr } for result capture
/// - Wraps code with await in async IIFE with variable hoisting
/// - Hoists declarations for variable persistence across REPL lines
pub fn ReplTransforms(comptime P: type) type {
    return struct {
        const Self = @This();

        /// Apply REPL-mode transforms to the AST.
        /// This transforms code for interactive evaluation:
        /// - Wraps the last expression in { value: expr } for result capture
        /// - Wraps code with await in async IIFE with variable hoisting
        pub fn apply(p: *P, parts: *ListManaged(js_ast.Part), allocator: Allocator) !void {
            // Skip transform if there's a top-level return (indicates module pattern)
            if (p.has_top_level_return) {
                return;
            }

            // Collect all statements
            var total_stmts_count: usize = 0;
            for (parts.items) |part| {
                total_stmts_count += part.stmts.len;
            }

            if (total_stmts_count == 0) {
                return;
            }

            // Collect all statements into a single array
            var all_stmts = bun.handleOom(allocator.alloc(Stmt, total_stmts_count));
            var stmt_idx: usize = 0;
            for (parts.items) |part| {
                for (part.stmts) |stmt| {
                    all_stmts[stmt_idx] = stmt;
                    stmt_idx += 1;
                }
            }

            // Check if there's top-level await or imports (imports become dynamic awaited imports)
            var has_top_level_await = p.top_level_await_keyword.len > 0;
            if (!has_top_level_await) {
                for (all_stmts) |stmt| {
                    if (stmt.data == .s_import) {
                        has_top_level_await = true;
                        break;
                    }
                }
            }

            // Apply transform with is_async based on presence of top-level await
            try transformWithHoisting(p, parts, all_stmts, allocator, has_top_level_await);
        }

        /// Transform code with hoisting and IIFE wrapper
        /// @param is_async: true for async IIFE (when top-level await present), false for sync IIFE
        fn transformWithHoisting(
            p: *P,
            parts: *ListManaged(js_ast.Part),
            all_stmts: []Stmt,
            allocator: Allocator,
            is_async: bool,
        ) !void {
            if (all_stmts.len == 0) return;

            // Lists for hoisted declarations and inner statements
            var hoisted_stmts = ListManaged(Stmt).init(allocator);
            var inner_stmts = ListManaged(Stmt).init(allocator);
            try hoisted_stmts.ensureTotalCapacity(all_stmts.len);
            try inner_stmts.ensureTotalCapacity(all_stmts.len);

            // Process each statement - hoist all declarations for REPL persistence
            for (all_stmts) |stmt| {
                switch (stmt.data) {
                    .s_local => |local| {
                        // Hoist all declarations as var so they become context properties
                        // In sloppy mode, var at top level becomes a property of the global/context object
                        // This is essential for REPL variable persistence across vm.runInContext calls
                        const kind: S.Local.Kind = .k_var;

                        // Extract individual identifiers from binding patterns for hoisting
                        var hoisted_decl_list = ListManaged(G.Decl).init(allocator);
                        for (local.decls.slice()) |decl| {
                            try extractIdentifiersFromBinding(p, decl.binding, &hoisted_decl_list);
                        }

                        if (hoisted_decl_list.items.len > 0) {
                            try hoisted_stmts.append(p.s(S.Local{
                                .kind = kind,
                                .decls = Decl.List.fromOwnedSlice(hoisted_decl_list.items),
                            }, stmt.loc));
                        }

                        // Create assignment expressions for the inner statements
                        for (local.decls.slice()) |decl| {
                            if (decl.value) |value| {
                                // Create assignment expression: binding = value
                                const assign_expr = createBindingAssignment(p, decl.binding, value, allocator);
                                try inner_stmts.append(p.s(S.SExpr{ .value = assign_expr }, stmt.loc));
                            }
                        }
                    },
                    .s_function => |func| {
                        // For function declarations:
                        // Hoist as: var funcName;
                        // Inner: this.funcName = funcName; function funcName() {}
                        if (func.func.name) |name_loc| {
                            try hoisted_stmts.append(p.s(S.Local{
                                .kind = .k_var,
                                .decls = Decl.List.fromOwnedSlice(bun.handleOom(allocator.dupe(G.Decl, &.{
                                    G.Decl{
                                        .binding = p.b(B.Identifier{ .ref = name_loc.ref.? }, name_loc.loc),
                                        .value = null,
                                    },
                                }))),
                            }, stmt.loc));

                            // Add this.funcName = funcName assignment
                            const this_expr = p.newExpr(E.This{}, stmt.loc);
                            const this_dot = p.newExpr(E.Dot{
                                .target = this_expr,
                                .name = p.symbols.items[name_loc.ref.?.innerIndex()].original_name,
                                .name_loc = name_loc.loc,
                            }, stmt.loc);
                            const func_id = p.newExpr(E.Identifier{ .ref = name_loc.ref.? }, name_loc.loc);
                            const assign = p.newExpr(E.Binary{
                                .op = .bin_assign,
                                .left = this_dot,
                                .right = func_id,
                            }, stmt.loc);
                            try inner_stmts.append(p.s(S.SExpr{ .value = assign }, stmt.loc));
                        }
                        // Add the function declaration itself
                        try inner_stmts.append(stmt);
                    },
                    .s_class => |class| {
                        // For class declarations:
                        // Hoist as: var ClassName; (use var so it persists to vm context)
                        // Inner: ClassName = class ClassName {}
                        if (class.class.class_name) |name_loc| {
                            try hoisted_stmts.append(p.s(S.Local{
                                .kind = .k_var,
                                .decls = Decl.List.fromOwnedSlice(bun.handleOom(allocator.dupe(G.Decl, &.{
                                    G.Decl{
                                        .binding = p.b(B.Identifier{ .ref = name_loc.ref.? }, name_loc.loc),
                                        .value = null,
                                    },
                                }))),
                            }, stmt.loc));

                            // Convert class declaration to assignment: ClassName = class ClassName {}
                            const class_expr = p.newExpr(class.class, stmt.loc);
                            const class_id = p.newExpr(E.Identifier{ .ref = name_loc.ref.? }, name_loc.loc);
                            const assign = p.newExpr(E.Binary{
                                .op = .bin_assign,
                                .left = class_id,
                                .right = class_expr,
                            }, stmt.loc);
                            try inner_stmts.append(p.s(S.SExpr{ .value = assign }, stmt.loc));
                        } else {
                            try inner_stmts.append(stmt);
                        }
                    },
                    .s_import => |import_data| {
                        // Convert static imports to dynamic imports for REPL evaluation:
                        //   import X from 'mod'      -> var X = (await import('mod')).default
                        //   import { a, b } from 'mod' -> var {a, b} = await import('mod')
                        //   import * as X from 'mod'   -> var X = await import('mod')
                        //   import 'mod'              -> await import('mod')
                        const path_str = p.import_records.items[import_data.import_record_index].path.text;
                        const import_expr = p.newExpr(E.Import{
                            .expr = p.newExpr(E.String{ .data = path_str }, stmt.loc),
                            .import_record_index = std.math.maxInt(u32),
                        }, stmt.loc);
                        const await_expr = p.newExpr(E.Await{ .value = import_expr }, stmt.loc);

                        if (import_data.star_name_loc) |_| {
                            // import * as X from 'mod' -> var X = await import('mod')
                            try hoisted_stmts.append(p.s(S.Local{
                                .kind = .k_var,
                                .decls = Decl.List.fromOwnedSlice(bun.handleOom(allocator.dupe(G.Decl, &.{
                                    G.Decl{
                                        .binding = p.b(B.Identifier{ .ref = import_data.namespace_ref }, stmt.loc),
                                        .value = null,
                                    },
                                }))),
                            }, stmt.loc));
                            const assign = p.newExpr(E.Binary{
                                .op = .bin_assign,
                                .left = p.newExpr(E.Identifier{ .ref = import_data.namespace_ref }, stmt.loc),
                                .right = await_expr,
                            }, stmt.loc);
                            try inner_stmts.append(p.s(S.SExpr{ .value = assign }, stmt.loc));
                        } else if (import_data.default_name) |default_name| {
                            // import X from 'mod' -> var X = (await import('mod')).default
                            // import X, { a } from 'mod' -> var __ns = await import('mod'); var X = __ns.default; var a = __ns.a;
                            try hoisted_stmts.append(p.s(S.Local{
                                .kind = .k_var,
                                .decls = Decl.List.fromOwnedSlice(bun.handleOom(allocator.dupe(G.Decl, &.{
                                    G.Decl{
                                        .binding = p.b(B.Identifier{ .ref = default_name.ref.? }, default_name.loc),
                                        .value = null,
                                    },
                                }))),
                            }, stmt.loc));

                            if (import_data.items.len > 0) {
                                // Share a single await import() between default and named imports.
                                // namespace_ref is synthesized by processImportStatement for all non-star imports.
                                try convertNamedImports(p, import_data, await_expr, &hoisted_stmts, &inner_stmts, allocator, stmt.loc);
                                const ns_ref_expr = p.newExpr(E.Identifier{ .ref = import_data.namespace_ref }, stmt.loc);
                                const dot_default = p.newExpr(E.Dot{
                                    .target = ns_ref_expr,
                                    .name = "default",
                                    .name_loc = stmt.loc,
                                }, stmt.loc);
                                const assign = p.newExpr(E.Binary{
                                    .op = .bin_assign,
                                    .left = p.newExpr(E.Identifier{ .ref = default_name.ref.? }, default_name.loc),
                                    .right = dot_default,
                                }, stmt.loc);
                                try inner_stmts.append(p.s(S.SExpr{ .value = assign }, stmt.loc));
                            } else {
                                const dot_default = p.newExpr(E.Dot{
                                    .target = await_expr,
                                    .name = "default",
                                    .name_loc = stmt.loc,
                                }, stmt.loc);
                                const assign = p.newExpr(E.Binary{
                                    .op = .bin_assign,
                                    .left = p.newExpr(E.Identifier{ .ref = default_name.ref.? }, default_name.loc),
                                    .right = dot_default,
                                }, stmt.loc);
                                try inner_stmts.append(p.s(S.SExpr{ .value = assign }, stmt.loc));
                            }
                        } else if (import_data.items.len > 0) {
                            // import { a, b } from 'mod' -> destructure from await import('mod')
                            try convertNamedImports(p, import_data, await_expr, &hoisted_stmts, &inner_stmts, allocator, stmt.loc);
                        } else {
                            // import 'mod' (side-effect only) -> await import('mod')
                            try inner_stmts.append(p.s(S.SExpr{ .value = await_expr }, stmt.loc));
                        }
                    },
                    .s_directive => |directive| {
                        // In REPL mode, treat directives (string literals) as expressions
                        const str_expr = p.newExpr(E.String{ .data = directive.value }, stmt.loc);
                        try inner_stmts.append(p.s(S.SExpr{ .value = str_expr }, stmt.loc));
                    },
                    else => {
                        try inner_stmts.append(stmt);
                    },
                }
            }

            // Wrap the last expression in return { value: expr }
            wrapLastExpressionWithReturn(p, &inner_stmts, allocator);

            // Create the IIFE: (() => { ...inner_stmts... })() or (async () => { ... })()
            const arrow = p.newExpr(E.Arrow{
                .args = &.{},
                .body = .{ .loc = logger.Loc.Empty, .stmts = inner_stmts.items },
                .is_async = is_async,
            }, logger.Loc.Empty);

            const iife = p.newExpr(E.Call{
                .target = arrow,
                .args = ExprNodeList{},
            }, logger.Loc.Empty);

            // Final output: hoisted declarations + IIFE call
            const final_stmts_count = hoisted_stmts.items.len + 1;
            var final_stmts = bun.handleOom(allocator.alloc(Stmt, final_stmts_count));
            for (hoisted_stmts.items, 0..) |stmt, j| {
                final_stmts[j] = stmt;
            }
            final_stmts[hoisted_stmts.items.len] = p.s(S.SExpr{ .value = iife }, logger.Loc.Empty);

            // Update parts
            if (parts.items.len > 0) {
                parts.items[0].stmts = final_stmts;
                parts.items.len = 1;
            }
        }

        /// Convert named imports to individual var assignments from the dynamic import
        /// import { a, b as c } from 'mod' ->
        ///   var a; var c;  (hoisted)
        ///   var __mod = await import('mod'); a = __mod.a; c = __mod.b;  (inner)
        fn convertNamedImports(
            p: *P,
            import_data: *const S.Import,
            await_expr: Expr,
            hoisted_stmts: *ListManaged(Stmt),
            inner_stmts: *ListManaged(Stmt),
            allocator: Allocator,
            loc: logger.Loc,
        ) !void {

            // Store the module in the namespace ref: var __ns = await import('mod')
            try hoisted_stmts.append(p.s(S.Local{
                .kind = .k_var,
                .decls = Decl.List.fromOwnedSlice(bun.handleOom(allocator.dupe(G.Decl, &.{
                    G.Decl{
                        .binding = p.b(B.Identifier{ .ref = import_data.namespace_ref }, loc),
                        .value = null,
                    },
                }))),
            }, loc));
            const ns_assign = p.newExpr(E.Binary{
                .op = .bin_assign,
                .left = p.newExpr(E.Identifier{ .ref = import_data.namespace_ref }, loc),
                .right = await_expr,
            }, loc);
            try inner_stmts.append(p.s(S.SExpr{ .value = ns_assign }, loc));

            // For each named import: var name; name = __ns.originalName;
            for (import_data.items) |item| {
                try hoisted_stmts.append(p.s(S.Local{
                    .kind = .k_var,
                    .decls = Decl.List.fromOwnedSlice(bun.handleOom(allocator.dupe(G.Decl, &.{
                        G.Decl{
                            .binding = p.b(B.Identifier{ .ref = item.name.ref.? }, item.name.loc),
                            .value = null,
                        },
                    }))),
                }, loc));
                const ns_ref_expr = p.newExpr(E.Identifier{ .ref = import_data.namespace_ref }, loc);
                const prop_access = p.newExpr(E.Dot{
                    .target = ns_ref_expr,
                    .name = item.alias,
                    .name_loc = item.name.loc,
                }, loc);
                const item_assign = p.newExpr(E.Binary{
                    .op = .bin_assign,
                    .left = p.newExpr(E.Identifier{ .ref = item.name.ref.? }, item.name.loc),
                    .right = prop_access,
                }, loc);
                try inner_stmts.append(p.s(S.SExpr{ .value = item_assign }, loc));
            }
        }

        /// Wrap the last expression in return { value: expr }
        fn wrapLastExpressionWithReturn(p: *P, inner_stmts: *ListManaged(Stmt), allocator: Allocator) void {
            if (inner_stmts.items.len > 0) {
                var last_idx: usize = inner_stmts.items.len;
                while (last_idx > 0) {
                    last_idx -= 1;
                    const last_stmt = inner_stmts.items[last_idx];
                    switch (last_stmt.data) {
                        .s_empty, .s_comment => continue,
                        .s_expr => |expr_data| {
                            // Wrap in return { value: expr }
                            const wrapped = wrapExprInValueObject(p, expr_data.value, allocator);
                            inner_stmts.items[last_idx] = p.s(S.Return{ .value = wrapped }, last_stmt.loc);
                            break;
                        },
                        else => break,
                    }
                }
            }
        }

        /// Extract individual identifiers from a binding pattern for hoisting
        fn extractIdentifiersFromBinding(p: *P, binding: Binding, decls: *ListManaged(G.Decl)) !void {
            switch (binding.data) {
                .b_identifier => |ident| {
                    try decls.append(G.Decl{
                        .binding = p.b(B.Identifier{ .ref = ident.ref }, binding.loc),
                        .value = null,
                    });
                },
                .b_array => |arr| {
                    for (arr.items) |item| {
                        try extractIdentifiersFromBinding(p, item.binding, decls);
                    }
                },
                .b_object => |obj| {
                    for (obj.properties) |prop| {
                        try extractIdentifiersFromBinding(p, prop.value, decls);
                    }
                },
                .b_missing => {},
            }
        }

        /// Create { __proto__: null, value: expr } wrapper object
        /// Uses null prototype to create a clean data object
        fn wrapExprInValueObject(p: *P, expr: Expr, allocator: Allocator) Expr {
            var properties = bun.handleOom(allocator.alloc(G.Property, 2));
            // __proto__: null - creates null-prototype object
            properties[0] = G.Property{
                .key = p.newExpr(E.String{ .data = "__proto__" }, expr.loc),
                .value = p.newExpr(E.Null{}, expr.loc),
            };
            // value: expr - the actual result value
            properties[1] = G.Property{
                .key = p.newExpr(E.String{ .data = "value" }, expr.loc),
                .value = expr,
            };
            return p.newExpr(E.Object{
                .properties = G.Property.List.fromOwnedSlice(properties),
            }, expr.loc);
        }

        /// Create assignment expression from binding pattern
        fn createBindingAssignment(p: *P, binding: Binding, value: Expr, allocator: Allocator) Expr {
            switch (binding.data) {
                .b_identifier => |ident| {
                    return p.newExpr(E.Binary{
                        .op = .bin_assign,
                        .left = p.newExpr(E.Identifier{ .ref = ident.ref }, binding.loc),
                        .right = value,
                    }, binding.loc);
                },
                .b_array => {
                    // For array destructuring, create: [a, b] = value
                    return p.newExpr(E.Binary{
                        .op = .bin_assign,
                        .left = convertBindingToExpr(p, binding, allocator),
                        .right = value,
                    }, binding.loc);
                },
                .b_object => {
                    // For object destructuring, create: {a, b} = value
                    return p.newExpr(E.Binary{
                        .op = .bin_assign,
                        .left = convertBindingToExpr(p, binding, allocator),
                        .right = value,
                    }, binding.loc);
                },
                .b_missing => {
                    // Return Missing expression to match convertBindingToExpr
                    return p.newExpr(E.Missing{}, binding.loc);
                },
            }
        }

        /// Convert a binding pattern to an expression (for assignment targets)
        /// Handles spread/rest patterns in arrays and objects to match Binding.toExpr behavior
        fn convertBindingToExpr(p: *P, binding: Binding, allocator: Allocator) Expr {
            switch (binding.data) {
                .b_identifier => |ident| {
                    return p.newExpr(E.Identifier{ .ref = ident.ref }, binding.loc);
                },
                .b_array => |arr| {
                    var items = bun.handleOom(allocator.alloc(Expr, arr.items.len));
                    for (arr.items, 0..) |item, i| {
                        const expr = convertBindingToExpr(p, item.binding, allocator);
                        // Check for spread pattern: if has_spread and this is the last element
                        if (arr.has_spread and i == arr.items.len - 1) {
                            items[i] = p.newExpr(E.Spread{ .value = expr }, expr.loc);
                        } else if (item.default_value) |default_val| {
                            items[i] = p.newExpr(E.Binary{
                                .op = .bin_assign,
                                .left = expr,
                                .right = default_val,
                            }, item.binding.loc);
                        } else {
                            items[i] = expr;
                        }
                    }
                    return p.newExpr(E.Array{
                        .items = ExprNodeList.fromOwnedSlice(items),
                        .is_single_line = arr.is_single_line,
                    }, binding.loc);
                },
                .b_object => |obj| {
                    var properties = bun.handleOom(allocator.alloc(G.Property, obj.properties.len));
                    for (obj.properties, 0..) |prop, i| {
                        properties[i] = G.Property{
                            .flags = prop.flags,
                            .key = prop.key,
                            // Set kind to .spread if the property has spread flag
                            .kind = if (prop.flags.contains(.is_spread)) .spread else .normal,
                            .value = convertBindingToExpr(p, prop.value, allocator),
                            .initializer = prop.default_value,
                        };
                    }
                    return p.newExpr(E.Object{
                        .properties = G.Property.List.fromOwnedSlice(properties),
                        .is_single_line = obj.is_single_line,
                    }, binding.loc);
                },
                .b_missing => {
                    return p.newExpr(E.Missing{}, binding.loc);
                },
            }
        }
    };
}

const std = @import("std");
const Allocator = std.mem.Allocator;
const ListManaged = std.array_list.Managed;

const bun = @import("bun");
const logger = bun.logger;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const S = js_ast.S;
const Stmt = js_ast.Stmt;

const G = js_ast.G;
const Decl = G.Decl;
