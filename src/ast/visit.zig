pub fn Visit(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const allow_macros = P.allow_macros;
        const is_typescript_enabled = P.is_typescript_enabled;
        const isSimpleParameterList = P.isSimpleParameterList;
        const LowerUsingDeclarationsContext = P.LowerUsingDeclarationsContext;
        const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;

        pub const visitExpr = @import("./visitExpr.zig").VisitExpr(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).visitExpr;
        pub const visitExprInOut = @import("./visitExpr.zig").VisitExpr(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).visitExprInOut;
        pub const visitAndAppendStmt = @import("./visitStmt.zig").VisitStmt(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).visitAndAppendStmt;

        pub fn visitStmtsAndPrependTempRefs(p: *P, stmts: *ListManaged(Stmt), opts: *PrependTempRefsOpts) anyerror!void {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            p.temp_refs_to_declare.deinit(p.allocator);
            p.temp_refs_to_declare = @TypeOf(p.temp_refs_to_declare){};
            p.temp_ref_count = 0;

            try p.visitStmts(stmts, opts.kind);

            // Prepend values for "this" and "arguments"
            if (opts.fn_body_loc) |fn_body_loc| {
                // Capture "this"
                if (p.fn_only_data_visit.this_capture_ref) |ref| {
                    try p.temp_refs_to_declare.append(p.allocator, TempRef{
                        .ref = ref,
                        .value = p.newExpr(E.This{}, fn_body_loc),
                    });
                }
            }
        }

        pub fn recordDeclaredSymbol(noalias p: *P, ref: Ref) anyerror!void {
            bun.assert(ref.isSymbol());
            try p.declared_symbols.append(p.allocator, DeclaredSymbol{
                .ref = ref,
                .is_top_level = p.current_scope == p.module_scope,
            });
        }

        pub fn visitFunc(p: *P, _func: G.Fn, open_parens_loc: logger.Loc) G.Fn {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            var func = _func;
            const old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
            const old_fn_only_data = p.fn_only_data_visit;
            p.fn_or_arrow_data_visit = FnOrArrowDataVisit{ .is_async = func.flags.contains(.is_async) };
            p.fn_only_data_visit = FnOnlyDataVisit{ .is_this_nested = true, .arguments_ref = func.arguments_ref };

            if (func.name) |name| {
                if (name.ref) |name_ref| {
                    p.recordDeclaredSymbol(name_ref) catch unreachable;
                    const symbol_name = p.loadNameFromRef(name_ref);
                    if (isEvalOrArguments(symbol_name)) {
                        p.markStrictModeFeature(.eval_or_arguments, js_lexer.rangeOfIdentifier(p.source, name.loc), symbol_name) catch unreachable;
                    }
                }
            }

            const body = func.body;

            p.pushScopeForVisitPass(.function_args, open_parens_loc) catch unreachable;
            p.visitArgs(
                func.args,
                VisitArgsOpts{
                    .has_rest_arg = func.flags.contains(.has_rest_arg),
                    .body = body.stmts,
                    .is_unique_formal_parameters = true,
                },
            );

            p.pushScopeForVisitPass(.function_body, body.loc) catch unreachable;
            var stmts = ListManaged(Stmt).fromOwnedSlice(p.allocator, body.stmts);
            var temp_opts = PrependTempRefsOpts{ .kind = StmtsKind.fn_body, .fn_body_loc = body.loc };
            p.visitStmtsAndPrependTempRefs(&stmts, &temp_opts) catch unreachable;

            if (p.options.features.react_fast_refresh) {
                const hook_storage = p.react_refresh.hook_ctx_storage orelse
                    unreachable; // caller did not init hook storage. any function can have react hooks!

                if (hook_storage.*) |*hook| {
                    p.handleReactRefreshPostVisitFunctionBody(&stmts, hook);
                }
            }

            func.body = G.FnBody{ .stmts = stmts.items, .loc = body.loc };

            p.popScope();
            p.popScope();

            p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
            p.fn_only_data_visit = old_fn_only_data;

            return func;
        }

        pub fn visitArgs(p: *P, args: []G.Arg, opts: VisitArgsOpts) void {
            const strict_loc = fnBodyContainsUseStrict(opts.body);
            const has_simple_args = isSimpleParameterList(args, opts.has_rest_arg);
            var duplicate_args_check: ?*StringVoidMap.Node = null;
            defer {
                if (duplicate_args_check) |checker| {
                    StringVoidMap.release(checker);
                }
            }

            // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
            // FunctionBodyContainsUseStrict of FunctionBody is true and
            // IsSimpleParameterList of FormalParameters is false."
            if (strict_loc != null and !has_simple_args) {
                p.log.addRangeError(p.source, p.source.rangeOfString(strict_loc.?), "Cannot use a \"use strict\" directive in a function with a non-simple parameter list") catch unreachable;
            }

            // Section 15.1.1 Static Semantics: Early Errors: "Multiple occurrences of
            // the same BindingIdentifier in a FormalParameterList is only allowed for
            // functions which have simple parameter lists and which are not defined in
            // strict mode code."
            if (opts.is_unique_formal_parameters or strict_loc != null or !has_simple_args or p.isStrictMode()) {
                duplicate_args_check = StringVoidMap.get(bun.default_allocator);
            }

            const duplicate_args_check_ptr: ?*StringVoidMap = if (duplicate_args_check != null)
                &duplicate_args_check.?.data
            else
                null;

            for (args) |*arg| {
                if (arg.ts_decorators.len > 0) {
                    arg.ts_decorators = p.visitTSDecorators(arg.ts_decorators);
                }

                p.visitBinding(arg.binding, duplicate_args_check_ptr);
                if (arg.default) |default| {
                    arg.default = p.visitExpr(default);
                }
            }
        }

        pub fn visitTSDecorators(p: *P, decs: ExprNodeList) ExprNodeList {
            for (decs.slice()) |*dec| {
                dec.* = p.visitExpr(dec.*);
            }

            return decs;
        }

        pub fn visitDecls(noalias p: *P, decls: []G.Decl, was_const: bool, comptime is_possibly_decl_to_remove: bool) usize {
            var j: usize = 0;
            var out_decls = decls;
            for (decls) |*decl| {
                p.visitBinding(decl.binding, null);

                if (decl.value != null) {
                    var val = decl.value.?;
                    const was_anonymous_named_expr = val.isAnonymousNamed();
                    var replacement: ?*const RuntimeFeatures.ReplaceableExport = null;

                    const prev_require_to_convert_count = p.imports_to_convert_from_require.items.len;
                    const prev_macro_call_count = p.macro_call_count;
                    const orig_dead = p.is_control_flow_dead;
                    if (comptime is_possibly_decl_to_remove) {
                        if (decl.binding.data == .b_identifier) {
                            if (p.options.features.replace_exports.getPtr(p.loadNameFromRef(decl.binding.data.b_identifier.ref))) |replacer| {
                                replacement = replacer;
                                if (p.options.features.dead_code_elimination and (replacer.* != .replace)) {
                                    p.is_control_flow_dead = true;
                                }
                            }
                        }
                    }

                    if (p.options.features.react_fast_refresh) {
                        p.react_refresh.last_hook_seen = null;
                    }

                    if (only_scan_imports_and_do_not_visit) {
                        @compileError("only_scan_imports_and_do_not_visit must not run this.");
                    }
                    decl.value = p.visitExprInOut(val, .{
                        .is_immediately_assigned_to_decl = true,
                    });

                    if (p.options.features.react_fast_refresh) {
                        // When hooks are immediately assigned to something, we need to hash the binding.
                        if (p.react_refresh.last_hook_seen) |last_hook| {
                            if (decl.value.?.data.as(.e_call)) |call| {
                                if (last_hook == call) {
                                    decl.binding.data.writeToHasher(&p.react_refresh.hook_ctx_storage.?.*.?.hasher, p.symbols.items);
                                }
                            }
                        }
                    }

                    if (p.shouldUnwrapCommonJSToESM()) {
                        if (prev_require_to_convert_count < p.imports_to_convert_from_require.items.len) {
                            if (decl.binding.data == .b_identifier) {
                                const ref = decl.binding.data.b_identifier.ref;
                                if (decl.value != null and
                                    decl.value.?.data == .e_require_string and
                                    decl.value.?.data.e_require_string.unwrapped_id != std.math.maxInt(u32))
                                {
                                    p.imports_to_convert_from_require.items[decl.value.?.data.e_require_string.unwrapped_id].namespace.ref = ref;
                                    p.import_items_for_namespace.put(
                                        p.allocator,
                                        ref,
                                        ImportItemForNamespaceMap.init(p.allocator),
                                    ) catch unreachable;
                                    continue;
                                }
                            }
                        }
                    }

                    if (comptime is_possibly_decl_to_remove) {
                        p.is_control_flow_dead = orig_dead;
                    }
                    if (comptime is_possibly_decl_to_remove) {
                        if (decl.binding.data == .b_identifier) {
                            if (replacement) |ptr| {
                                if (!p.replaceDeclAndPossiblyRemove(decl, ptr)) {
                                    continue;
                                }
                            }
                        }
                    }

                    p.visitDecl(
                        decl,
                        was_anonymous_named_expr,
                        was_const and !p.current_scope.is_after_const_local_prefix,
                        if (comptime allow_macros)
                            prev_macro_call_count != p.macro_call_count
                        else
                            false,
                    );
                } else if (comptime is_possibly_decl_to_remove) {
                    if (decl.binding.data == .b_identifier) {
                        if (p.options.features.replace_exports.getPtr(p.loadNameFromRef(decl.binding.data.b_identifier.ref))) |ptr| {
                            if (!p.replaceDeclAndPossiblyRemove(decl, ptr)) {
                                p.visitDecl(
                                    decl,
                                    was_const and !p.current_scope.is_after_const_local_prefix,
                                    false,
                                    false,
                                );
                            } else {
                                continue;
                            }
                        }
                    }
                }

                out_decls[j] = decl.*;
                j += 1;
            }

            return j;
        }

        pub fn visitBindingAndExprForMacro(p: *P, binding: Binding, expr: Expr) void {
            switch (binding.data) {
                .b_object => |bound_object| {
                    if (expr.data == .e_object and
                        expr.data.e_object.was_originally_macro)
                    {
                        var object = expr.data.e_object;
                        for (bound_object.properties) |property| {
                            if (property.flags.contains(.is_spread)) return;
                        }
                        var output_properties = object.properties.slice();
                        var end: u32 = 0;
                        for (bound_object.properties) |property| {
                            if (property.key.asStringLiteral(p.allocator)) |name| {
                                if (object.asProperty(name)) |query| {
                                    switch (query.expr.data) {
                                        .e_object, .e_array => p.visitBindingAndExprForMacro(property.value, query.expr),
                                        else => {
                                            if (p.options.features.inlining) {
                                                if (property.value.data == .b_identifier) {
                                                    p.const_values.put(p.allocator, property.value.data.b_identifier.ref, query.expr) catch unreachable;
                                                }
                                            }
                                        },
                                    }
                                    output_properties[end] = output_properties[query.i];
                                    end += 1;
                                }
                            }
                        }

                        object.properties.len = end;
                    }
                },
                .b_array => |bound_array| {
                    if (expr.data == .e_array and
                        expr.data.e_array.was_originally_macro and !bound_array.has_spread)
                    {
                        var array = expr.data.e_array;

                        array.items.len = @min(array.items.len, @as(u32, @truncate(bound_array.items.len)));
                        for (bound_array.items[0..array.items.len], array.items.slice()) |item, *child_expr| {
                            if (item.binding.data == .b_missing) {
                                child_expr.* = p.newExpr(E.Missing{}, expr.loc);
                                continue;
                            }

                            p.visitBindingAndExprForMacro(item.binding, child_expr.*);
                        }
                    }
                },
                .b_identifier => |id| {
                    if (p.options.features.inlining) {
                        p.const_values.put(p.allocator, id.ref, expr) catch unreachable;
                    }
                },
                else => {},
            }
        }

        pub fn visitDecl(p: *P, decl: *Decl, was_anonymous_named_expr: bool, could_be_const_value: bool, could_be_macro: bool) void {
            // Optionally preserve the name
            switch (decl.binding.data) {
                .b_identifier => |id| {
                    if (could_be_const_value or (allow_macros and could_be_macro)) {
                        if (decl.value) |val| {
                            if (val.canBeConstValue()) {
                                p.const_values.put(p.allocator, id.ref, val) catch unreachable;
                            }
                        }
                    } else {
                        p.current_scope.is_after_const_local_prefix = true;
                    }
                    decl.value = p.maybeKeepExprSymbolName(
                        decl.value.?,
                        p.symbols.items[id.ref.innerIndex()].original_name,
                        was_anonymous_named_expr,
                    );
                },
                .b_object, .b_array => {
                    if (comptime allow_macros) {
                        if (could_be_macro and decl.value != null) {
                            p.visitBindingAndExprForMacro(decl.binding, decl.value.?);
                        }
                    }
                },
                else => {},
            }
        }

        pub fn visitForLoopInit(p: *P, stmt: Stmt, is_in_or_of: bool) Stmt {
            switch (stmt.data) {
                .s_expr => |st| {
                    const assign_target = if (is_in_or_of) js_ast.AssignTarget.replace else js_ast.AssignTarget.none;
                    p.stmt_expr_value = st.value.data;
                    st.value = p.visitExprInOut(st.value, ExprIn{ .assign_target = assign_target });
                },
                .s_local => |st| {
                    for (st.decls.slice()) |*dec| {
                        p.visitBinding(dec.binding, null);
                        if (dec.value) |val| {
                            dec.value = p.visitExpr(val);
                        }
                    }
                    st.kind = p.selectLocalKind(st.kind);
                },
                else => {
                    p.panic("Unexpected stmt in visitForLoopInit", .{});
                },
            }

            return stmt;
        }

        pub fn visitBinding(noalias p: *P, binding: BindingNodeIndex, duplicate_arg_check: ?*StringVoidMap) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |bind| {
                    p.recordDeclaredSymbol(bind.ref) catch unreachable;
                    const name = p.symbols.items[bind.ref.innerIndex()].original_name;
                    if (isEvalOrArguments(name)) {
                        p.markStrictModeFeature(.eval_or_arguments, js_lexer.rangeOfIdentifier(p.source, binding.loc), name) catch unreachable;
                    }
                    if (duplicate_arg_check) |dup| {
                        if (dup.getOrPutContains(name)) {
                            p.log.addRangeErrorFmt(
                                p.source,
                                js_lexer.rangeOfIdentifier(p.source, binding.loc),
                                p.allocator,
                                "\"{s}\" cannot be bound multiple times in the same parameter list",
                                .{name},
                            ) catch unreachable;
                        }
                    }
                },
                .b_array => |bind| {
                    for (bind.items) |*item| {
                        p.visitBinding(item.binding, duplicate_arg_check);
                        if (item.default_value) |default_value| {
                            const was_anonymous_named_expr = default_value.isAnonymousNamed();
                            item.default_value = p.visitExpr(default_value);

                            switch (item.binding.data) {
                                .b_identifier => |bind_| {
                                    item.default_value = p.maybeKeepExprSymbolName(
                                        item.default_value orelse unreachable,
                                        p.symbols.items[bind_.ref.innerIndex()].original_name,
                                        was_anonymous_named_expr,
                                    );
                                },
                                else => {},
                            }
                        }
                    }
                },
                .b_object => |bind| {
                    for (bind.properties) |*property| {
                        if (!property.flags.contains(.is_spread)) {
                            property.key = p.visitExpr(property.key);
                        }

                        p.visitBinding(property.value, duplicate_arg_check);
                        if (property.default_value) |default_value| {
                            const was_anonymous_named_expr = default_value.isAnonymousNamed();
                            property.default_value = p.visitExpr(default_value);

                            switch (property.value.data) {
                                .b_identifier => |bind_| {
                                    property.default_value = p.maybeKeepExprSymbolName(
                                        property.default_value orelse unreachable,
                                        p.symbols.items[bind_.ref.innerIndex()].original_name,
                                        was_anonymous_named_expr,
                                    );
                                },
                                else => {},
                            }
                        }
                    }
                },
            }
        }

        pub fn visitLoopBody(noalias p: *P, stmt: StmtNodeIndex) StmtNodeIndex {
            const old_is_inside_loop = p.fn_or_arrow_data_visit.is_inside_loop;
            p.fn_or_arrow_data_visit.is_inside_loop = true;
            p.loop_body = stmt.data;
            const res = p.visitSingleStmt(stmt, .loop_body);
            p.fn_or_arrow_data_visit.is_inside_loop = old_is_inside_loop;
            return res;
        }

        pub fn visitSingleStmtBlock(noalias p: *P, stmt: Stmt, kind: StmtsKind) Stmt {
            var new_stmt = stmt;
            p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
            var stmts = ListManaged(Stmt).initCapacity(p.allocator, stmt.data.s_block.stmts.len) catch unreachable;
            stmts.appendSlice(stmt.data.s_block.stmts) catch unreachable;
            p.visitStmts(&stmts, kind) catch unreachable;
            p.popScope();
            new_stmt.data.s_block.stmts = stmts.items;
            if (p.options.features.minify_syntax) {
                new_stmt = p.stmtsToSingleStmt(stmt.loc, stmts.items);
            }

            return new_stmt;
        }

        pub fn visitSingleStmt(noalias p: *P, stmt: Stmt, kind: StmtsKind) Stmt {
            if (stmt.data == .s_block) {
                return p.visitSingleStmtBlock(stmt, kind);
            }

            const has_if_scope = switch (stmt.data) {
                .s_function => stmt.data.s_function.func.flags.contains(.has_if_scope),
                else => false,
            };

            // Introduce a fake block scope for function declarations inside if statements
            if (has_if_scope) {
                p.pushScopeForVisitPass(.block, stmt.loc) catch unreachable;
            }

            var stmts = ListManaged(Stmt).initCapacity(p.allocator, 1) catch unreachable;
            stmts.append(stmt) catch unreachable;
            p.visitStmts(&stmts, kind) catch unreachable;

            if (has_if_scope) {
                p.popScope();
            }

            return p.stmtsToSingleStmt(stmt.loc, stmts.items);
        }

        pub fn visitClass(noalias p: *P, name_scope_loc: logger.Loc, noalias class: *G.Class, default_name_ref: Ref) Ref {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            class.ts_decorators = p.visitTSDecorators(class.ts_decorators);

            if (class.class_name) |name| {
                p.recordDeclaredSymbol(name.ref.?) catch unreachable;
            }

            p.pushScopeForVisitPass(.class_name, name_scope_loc) catch unreachable;
            const old_enclosing_class_keyword = p.enclosing_class_keyword;
            p.enclosing_class_keyword = class.class_keyword;
            p.current_scope.recursiveSetStrictMode(.implicit_strict_mode_class);
            var shadow_ref = Ref.None;

            // Insert a shadowing name that spans the whole class, which matches
            // JavaScript's semantics. The class body (and extends clause) "captures" the
            // original value of the name. This matters for class statements because the
            // symbol can be re-assigned to something else later. The captured values
            // must be the original value of the name, not the re-assigned value.
            // Use "const" for this symbol to match JavaScript run-time semantics. You
            // are not allowed to assign to this symbol (it throws a TypeError).
            if (class.class_name) |name| {
                shadow_ref = name.ref.?;
                p.current_scope.members.put(
                    p.allocator,
                    p.symbols.items[shadow_ref.innerIndex()].original_name,
                    Scope.Member{ .ref = name.ref orelse Ref.None, .loc = name.loc },
                ) catch unreachable;
            } else {
                const name_str: []const u8 = if (default_name_ref.isNull()) "_this" else "_default";
                shadow_ref = p.newSymbol(.constant, name_str) catch unreachable;
            }

            p.recordDeclaredSymbol(shadow_ref) catch unreachable;

            if (class.extends) |extends| {
                class.extends = p.visitExpr(extends);
            }

            {
                p.pushScopeForVisitPass(.class_body, class.body_loc) catch unreachable;
                defer {
                    p.popScope();
                    p.enclosing_class_keyword = old_enclosing_class_keyword;
                }

                var constructor_function: ?*E.Function = null;
                for (class.properties) |*property| {
                    if (property.kind == .class_static_block) {
                        const old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
                        const old_fn_only_data = p.fn_only_data_visit;
                        p.fn_or_arrow_data_visit = .{};
                        p.fn_only_data_visit = .{
                            .is_this_nested = true,
                            .is_new_target_allowed = true,
                            .class_name_ref = &shadow_ref,

                            // TODO: down transpilation
                            .should_replace_this_with_class_name_ref = false,
                        };
                        p.pushScopeForVisitPass(.class_static_init, property.class_static_block.?.loc) catch unreachable;

                        // Make it an error to use "arguments" in a static class block
                        p.current_scope.forbid_arguments = true;

                        var list = property.class_static_block.?.stmts.moveToListManaged(p.allocator);
                        p.visitStmts(&list, .fn_body) catch unreachable;
                        property.class_static_block.?.stmts = js_ast.BabyList(Stmt).moveFromList(&list);
                        p.popScope();

                        p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
                        p.fn_only_data_visit = old_fn_only_data;

                        continue;
                    }
                    property.ts_decorators = p.visitTSDecorators(property.ts_decorators);
                    const is_private = if (property.key != null) @as(Expr.Tag, property.key.?.data) == .e_private_identifier else false;

                    // Special-case EPrivateIdentifier to allow it here

                    if (is_private) {
                        p.recordDeclaredSymbol(property.key.?.data.e_private_identifier.ref) catch unreachable;
                    } else if (property.key) |key| {
                        property.key = p.visitExpr(key);
                    }

                    // Make it an error to use "arguments" in a class body
                    p.current_scope.forbid_arguments = true;
                    defer p.current_scope.forbid_arguments = false;

                    // The value of "this" is shadowed inside property values
                    const old_is_this_captured = p.fn_only_data_visit.is_this_nested;
                    const old_class_name_ref = p.fn_only_data_visit.class_name_ref;
                    p.fn_only_data_visit.is_this_nested = true;
                    p.fn_only_data_visit.is_new_target_allowed = true;
                    p.fn_only_data_visit.class_name_ref = &shadow_ref;
                    defer p.fn_only_data_visit.is_this_nested = old_is_this_captured;
                    defer p.fn_only_data_visit.class_name_ref = old_class_name_ref;

                    // We need to explicitly assign the name to the property initializer if it
                    // will be transformed such that it is no longer an inline initializer.

                    var constructor_function_: ?*E.Function = null;

                    var name_to_keep: ?string = null;
                    if (is_private) {} else if (!property.flags.contains(.is_method) and !property.flags.contains(.is_computed)) {
                        if (property.key) |key| {
                            if (@as(Expr.Tag, key.data) == .e_string) {
                                name_to_keep = key.data.e_string.string(p.allocator) catch unreachable;
                            }
                        }
                    } else if (property.flags.contains(.is_method)) {
                        if (comptime is_typescript_enabled) {
                            if (property.value.?.data == .e_function and property.key.?.data == .e_string and
                                property.key.?.data.e_string.eqlComptime("constructor"))
                            {
                                constructor_function_ = property.value.?.data.e_function;
                                constructor_function = constructor_function_;
                            }
                        }
                    }

                    if (property.value) |val| {
                        if (name_to_keep) |name| {
                            const was_anon = val.isAnonymousNamed();
                            property.value = p.maybeKeepExprSymbolName(p.visitExpr(val), name, was_anon);
                        } else {
                            property.value = p.visitExpr(val);
                        }

                        if (comptime is_typescript_enabled) {
                            if (constructor_function_ != null and property.value != null and property.value.?.data == .e_function) {
                                constructor_function = property.value.?.data.e_function;
                            }
                        }
                    }

                    if (property.initializer) |val| {
                        // if (property.flags.is_static and )
                        if (name_to_keep) |name| {
                            const was_anon = val.isAnonymousNamed();
                            property.initializer = p.maybeKeepExprSymbolName(p.visitExpr(val), name, was_anon);
                        } else {
                            property.initializer = p.visitExpr(val);
                        }
                    }
                }

                // note: our version assumes useDefineForClassFields is true
                if (comptime is_typescript_enabled) {
                    if (constructor_function) |constructor| {
                        var to_add: usize = 0;
                        for (constructor.func.args) |arg| {
                            to_add += @intFromBool(arg.is_typescript_ctor_field and arg.binding.data == .b_identifier);
                        }

                        // if this is an expression, we can move statements after super() because there will be 0 decorators
                        var super_index: ?usize = null;
                        if (class.extends != null) {
                            for (constructor.func.body.stmts, 0..) |stmt, index| {
                                if (stmt.data != .s_expr or stmt.data.s_expr.value.data != .e_call or stmt.data.s_expr.value.data.e_call.target.data != .e_super) continue;
                                super_index = index;
                                break;
                            }
                        }

                        if (to_add > 0) {
                            // to match typescript behavior, we also must prepend to the class body
                            var stmts = std.array_list.Managed(Stmt).fromOwnedSlice(p.allocator, constructor.func.body.stmts);
                            stmts.ensureUnusedCapacity(to_add) catch unreachable;
                            var class_body = std.array_list.Managed(G.Property).fromOwnedSlice(p.allocator, class.properties);
                            class_body.ensureUnusedCapacity(to_add) catch unreachable;
                            var j: usize = 0;

                            for (constructor.func.args) |arg| {
                                if (arg.is_typescript_ctor_field) {
                                    switch (arg.binding.data) {
                                        .b_identifier => |id| {
                                            const arg_symbol = p.symbols.items[id.ref.innerIndex()];
                                            const name = arg_symbol.original_name;
                                            const arg_ident = p.newExpr(E.Identifier{ .ref = id.ref }, arg.binding.loc);

                                            stmts.insert(if (super_index) |k| j + k + 1 else j, Stmt.assign(
                                                p.newExpr(E.Dot{
                                                    .target = p.newExpr(E.This{}, arg.binding.loc),
                                                    .name = name,
                                                    .name_loc = arg.binding.loc,
                                                }, arg.binding.loc),
                                                arg_ident,
                                            )) catch unreachable;
                                            // O(N)
                                            class_body.items.len += 1;
                                            bun.copy(G.Property, class_body.items[j + 1 ..], class_body.items[j .. class_body.items.len - 1]);
                                            // Copy the argument name symbol to prevent the class field declaration from being renamed
                                            // but not the constructor argument.
                                            const field_symbol_ref = p.declareSymbol(.other, arg.binding.loc, name) catch id.ref;
                                            field_symbol_ref.getSymbol(p.symbols.items).must_not_be_renamed = true;
                                            const field_ident = p.newExpr(E.Identifier{ .ref = field_symbol_ref }, arg.binding.loc);
                                            class_body.items[j] = G.Property{ .key = field_ident };
                                            j += 1;
                                        },
                                        else => {},
                                    }
                                }
                            }

                            class.properties = class_body.items;
                            constructor.func.body.stmts = stmts.items;
                        }
                    }
                }
            }

            if (p.symbols.items[shadow_ref.innerIndex()].use_count_estimate == 0) {
                // If there was originally no class name but something inside needed one
                // (e.g. there was a static property initializer that referenced "this"),
                // store our generated name so the class expression ends up with a name.
                shadow_ref = Ref.None;
            } else if (class.class_name == null) {
                class.class_name = LocRef{
                    .ref = shadow_ref,
                    .loc = name_scope_loc,
                };
                p.recordDeclaredSymbol(shadow_ref) catch unreachable;
            }

            // class name scope
            p.popScope();

            return shadow_ref;
        }

        // Try separating the list for appending, so that it's not a pointer.
        pub fn visitStmts(p: *P, stmts: *ListManaged(Stmt), kind: StmtsKind) anyerror!void {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            const initial_scope = if (comptime Environment.allow_assert) p.current_scope;

            {
                // Save the current control-flow liveness. This represents if we are
                // currently inside an "if (false) { ... }" block.
                const old_is_control_flow_dead = p.is_control_flow_dead;
                defer p.is_control_flow_dead = old_is_control_flow_dead;

                var before = ListManaged(Stmt).init(p.allocator);
                defer before.deinit();

                var after = ListManaged(Stmt).init(p.allocator);
                defer after.deinit();

                // Preprocess TypeScript enums to improve code generation. Otherwise
                // uses of an enum before that enum has been declared won't be inlined:
                //
                //   console.log(Foo.FOO) // We want "FOO" to be inlined here
                //   const enum Foo { FOO = 0 }
                //
                // The TypeScript compiler itself contains code with this pattern, so
                // it's important to implement this optimization.
                var preprocessed_enums: std.ArrayListUnmanaged([]Stmt) = .{};
                defer preprocessed_enums.deinit(p.allocator);
                if (p.scopes_in_order_for_enum.count() > 0) {
                    var found: usize = 0;
                    for (stmts.items) |*stmt| {
                        if (stmt.data == .s_enum) {
                            const old_scopes_in_order = p.scope_order_to_visit;
                            defer p.scope_order_to_visit = old_scopes_in_order;

                            p.scope_order_to_visit = p.scopes_in_order_for_enum.get(stmt.loc).?;

                            var temp = ListManaged(Stmt).init(p.allocator);
                            try p.visitAndAppendStmt(&temp, stmt);
                            try preprocessed_enums.append(p.allocator, temp.items);
                            found += 1;
                        }
                    }
                }

                if (p.current_scope == p.module_scope) {
                    p.macro.prepend_stmts = &before;
                }

                // visit all statements first
                var visited = try ListManaged(Stmt).initCapacity(p.allocator, stmts.items.len);
                defer visited.deinit();

                const prev_nearest_stmt_list = p.nearest_stmt_list;
                defer p.nearest_stmt_list = prev_nearest_stmt_list;
                p.nearest_stmt_list = &before;

                var preprocessed_enum_i: usize = 0;

                for (stmts.items) |*stmt| {
                    const list = list_getter: {
                        switch (stmt.data) {
                            .s_export_equals => {
                                // TypeScript "export = value;" becomes "module.exports = value;". This
                                // must happen at the end after everything is parsed because TypeScript
                                // moves this statement to the end when it generates code.
                                break :list_getter &after;
                            },
                            .s_function => |data| {
                                if (
                                // Manually hoist block-level function declarations to preserve semantics.
                                // This is only done for function declarations that are not generators
                                // or async functions, since this is a backwards-compatibility hack from
                                // Annex B of the JavaScript standard.
                                !p.current_scope.kindStopsHoisting() and
                                    p.symbols.items[data.func.name.?.ref.?.innerIndex()].kind == .hoisted_function)
                                {
                                    break :list_getter &before;
                                }
                            },
                            .s_enum => {
                                const enum_stmts = preprocessed_enums.items[preprocessed_enum_i];
                                preprocessed_enum_i += 1;
                                try visited.appendSlice(enum_stmts);

                                const enum_scope_count = p.scopes_in_order_for_enum.get(stmt.loc).?.len;
                                p.scope_order_to_visit = p.scope_order_to_visit[enum_scope_count..];
                                continue;
                            },
                            else => {},
                        }
                        break :list_getter &visited;
                    };
                    try p.visitAndAppendStmt(list, stmt);
                }

                // Transform block-level function declarations into variable declarations
                if (before.items.len > 0) {
                    var let_decls = ListManaged(G.Decl).init(p.allocator);
                    var var_decls = ListManaged(G.Decl).init(p.allocator);
                    var non_fn_stmts = ListManaged(Stmt).init(p.allocator);
                    var fn_stmts = std.AutoHashMap(Ref, u32).init(p.allocator);

                    defer {
                        non_fn_stmts.deinit();
                        fn_stmts.deinit();
                    }

                    for (before.items) |stmt| {
                        switch (stmt.data) {
                            .s_function => |data| {
                                // This transformation of function declarations in nested scopes is
                                // intended to preserve the hoisting semantics of the original code. In
                                // JavaScript, function hoisting works differently in strict mode vs.
                                // sloppy mode code. We want the code we generate to use the semantics of
                                // the original environment, not the generated environment. However, if
                                // direct "eval" is present then it's not possible to preserve the
                                // semantics because we need two identifiers to do that and direct "eval"
                                // means neither identifier can be renamed to something else. So in that
                                // case we give up and do not preserve the semantics of the original code.
                                const name_ref = data.func.name.?.ref.?;
                                if (p.current_scope.contains_direct_eval) {
                                    if (p.hoisted_ref_for_sloppy_mode_block_fn.get(name_ref)) |hoisted_ref| {
                                        // Merge the two identifiers back into a single one
                                        p.symbols.items[hoisted_ref.innerIndex()].link = name_ref;
                                    }
                                    bun.handleOom(non_fn_stmts.append(stmt));
                                    continue;
                                }

                                const gpe = bun.handleOom(fn_stmts.getOrPut(name_ref));
                                var index = gpe.value_ptr.*;
                                if (!gpe.found_existing) {
                                    index = @as(u32, @intCast(let_decls.items.len));
                                    gpe.value_ptr.* = index;
                                    let_decls.append(.{
                                        .binding = p.b(B.Identifier{
                                            .ref = name_ref,
                                        }, data.func.name.?.loc),
                                    }) catch unreachable;

                                    // Also write the function to the hoisted sibling symbol if applicable
                                    if (p.hoisted_ref_for_sloppy_mode_block_fn.get(name_ref)) |hoisted_ref| {
                                        p.recordUsage(name_ref);
                                        var_decls.append(.{
                                            .binding = p.b(
                                                B.Identifier{ .ref = hoisted_ref },
                                                data.func.name.?.loc,
                                            ),
                                            .value = p.newExpr(
                                                E.Identifier{
                                                    .ref = name_ref,
                                                },
                                                data.func.name.?.loc,
                                            ),
                                        }) catch |err| bun.handleOom(err);
                                    }
                                }

                                // The last function statement for a given symbol wins
                                data.func.name = null;
                                let_decls.items[index].value = p.newExpr(
                                    E.Function{
                                        .func = data.func,
                                    },
                                    stmt.loc,
                                );
                            },
                            else => {
                                non_fn_stmts.append(stmt) catch unreachable;
                            },
                        }
                    }
                    before.items.len = 0;

                    before.ensureUnusedCapacity(@as(usize, @intFromBool(let_decls.items.len > 0)) + @as(usize, @intFromBool(var_decls.items.len > 0)) + non_fn_stmts.items.len) catch unreachable;

                    if (let_decls.items.len > 0) {
                        const decls: Decl.List = .moveFromList(&let_decls);
                        before.appendAssumeCapacity(p.s(
                            S.Local{
                                .kind = .k_let,
                                .decls = decls,
                            },
                            decls.at(0).value.?.loc,
                        ));
                    }

                    if (var_decls.items.len > 0) {
                        const relocated = p.maybeRelocateVarsToTopLevel(var_decls.items, .normal);
                        if (relocated.ok) {
                            if (relocated.stmt) |new| {
                                before.appendAssumeCapacity(new);
                            }
                        } else {
                            const decls: Decl.List = .moveFromList(&var_decls);
                            before.appendAssumeCapacity(p.s(
                                S.Local{
                                    .kind = .k_var,
                                    .decls = decls,
                                },
                                decls.at(0).value.?.loc,
                            ));
                        }
                    }

                    before.appendSliceAssumeCapacity(non_fn_stmts.items);
                }

                var visited_count = visited.items.len;
                if (p.is_control_flow_dead and p.options.features.dead_code_elimination) {
                    var end: usize = 0;
                    for (visited.items) |item| {
                        if (!SideEffects.shouldKeepStmtInDeadControlFlow(item, p.allocator)) {
                            continue;
                        }

                        visited.items[end] = item;
                        end += 1;
                    }
                    visited_count = end;
                }

                const total_size = visited_count + before.items.len + after.items.len;

                if (total_size != stmts.items.len) {
                    try stmts.resize(total_size);
                }

                var remain = stmts.items;

                for (before.items) |item| {
                    remain[0] = item;
                    remain = remain[1..];
                }

                const visited_slice = visited.items[0..visited_count];
                for (visited_slice) |item| {
                    remain[0] = item;
                    remain = remain[1..];
                }

                for (after.items) |item| {
                    remain[0] = item;
                    remain = remain[1..];
                }
            }

            // Lower using declarations
            if (kind != .switch_stmt and p.shouldLowerUsingDeclarations(stmts.items)) {
                var ctx = try LowerUsingDeclarationsContext.init(p);
                ctx.scanStmts(p, stmts.items);
                stmts.* = ctx.finalize(p, stmts.items, p.current_scope.parent == null);
            }

            if (comptime Environment.allow_assert)
                // if this fails it means that scope pushing/popping is not balanced
                assert(p.current_scope == initial_scope);

            if (!p.options.features.minify_syntax or !p.options.features.dead_code_elimination) {
                return;
            }

            if (p.current_scope.parent != null and !p.current_scope.contains_direct_eval) {
                // Remove inlined constants now that we know whether any of these statements
                // contained a direct eval() or not. This can't be done earlier when we
                // encounter the constant because we haven't encountered the eval() yet.
                // Inlined constants are not removed if they are in a top-level scope or
                // if they are exported (which could be in a nested TypeScript namespace).
                if (p.const_values.count() > 0) {
                    const items: []Stmt = stmts.items;
                    for (items) |*stmt| {
                        switch (stmt.data) {
                            .s_empty, .s_comment, .s_directive, .s_debugger, .s_type_script => continue,
                            .s_local => |local| {
                                if (!local.is_export and !local.was_commonjs_export) {
                                    var decls: []Decl = local.decls.slice();
                                    var end: usize = 0;
                                    var any_decl_in_const_values = local.kind == .k_const;
                                    for (decls) |decl| {
                                        if (decl.binding.data == .b_identifier) {
                                            if (p.const_values.contains(decl.binding.data.b_identifier.ref)) {
                                                any_decl_in_const_values = true;
                                                const symbol = p.symbols.items[decl.binding.data.b_identifier.ref.innerIndex()];
                                                if (symbol.use_count_estimate == 0) {
                                                    // Skip declarations that are constants with zero usage
                                                    continue;
                                                }
                                            }
                                        }
                                        decls[end] = decl;
                                        end += 1;
                                    }
                                    local.decls.len = @as(u32, @truncate(end));
                                    if (any_decl_in_const_values) {
                                        if (end == 0) {
                                            stmt.* = stmt.*.toEmpty();
                                        }
                                        continue;
                                    }
                                }
                            },
                            else => {},
                        }

                        // Break after processing relevant statements
                        break;
                    }
                }
            }

            var is_control_flow_dead = false;

            var output = ListManaged(Stmt).initCapacity(p.allocator, stmts.items.len) catch unreachable;

            const dead_code_elimination = p.options.features.dead_code_elimination;
            for (stmts.items) |stmt| {
                if (is_control_flow_dead and dead_code_elimination and
                    !SideEffects.shouldKeepStmtInDeadControlFlow(stmt, p.allocator))
                {
                    // Strip unnecessary statements if the control flow is dead here
                    continue;
                }

                // Inline single-use variable declarations where possible:
                //
                //   // Before
                //   let x = fn();
                //   return x.y();
                //
                //   // After
                //   return fn().y();
                //
                // The declaration must not be exported. We can't just check for the
                // "export" keyword because something might do "export {id};" later on.
                // Instead we just ignore all top-level declarations for now. That means
                // this optimization currently only applies in nested scopes.
                //
                // Ignore declarations if the scope is shadowed by a direct "eval" call.
                // The eval'd code may indirectly reference this symbol and the actual
                // use count may be greater than 1.
                if (p.current_scope != p.module_scope and !p.current_scope.contains_direct_eval) {
                    // Keep inlining variables until a failure or until there are none left.
                    // That handles cases like this:
                    //
                    //   // Before
                    //   let x = fn();
                    //   let y = x.prop;
                    //   return y;
                    //
                    //   // After
                    //   return fn().prop;
                    //
                    inner: while (output.items.len > 0) {
                        // Ignore "var" declarations since those have function-level scope and
                        // we may not have visited all of their uses yet by this point. We
                        // should have visited all the uses of "let" and "const" declarations
                        // by now since they are scoped to this block which we just finished
                        // visiting.
                        const prev_statement = &output.items[output.items.len - 1];
                        switch (prev_statement.data) {
                            .s_local => {
                                var local = prev_statement.data.s_local;
                                if (local.decls.len == 0 or local.kind == .k_var or local.is_export) {
                                    break;
                                }

                                const last: *Decl = local.decls.last().?;
                                // The variable must be initialized, since we will be substituting
                                // the value into the usage.
                                if (last.value == null)
                                    break;

                                // The binding must be an identifier that is only used once.
                                // Ignore destructuring bindings since that's not the simple case.
                                // Destructuring bindings could potentially execute side-effecting
                                // code which would invalidate reordering.

                                switch (last.binding.data) {
                                    .b_identifier => |ident| {
                                        const id = ident.ref;

                                        const symbol: *const Symbol = &p.symbols.items[id.innerIndex()];

                                        // Try to substitute the identifier with the initializer. This will
                                        // fail if something with side effects is in between the declaration
                                        // and the usage.
                                        if (symbol.use_count_estimate == 1) {
                                            if (p.substituteSingleUseSymbolInStmt(stmt, id, last.value.?)) {
                                                switch (local.decls.len) {
                                                    1 => {
                                                        local.decls.len = 0;
                                                        output.items.len -= 1;
                                                        continue :inner;
                                                    },
                                                    else => {
                                                        local.decls.len -= 1;
                                                        continue :inner;
                                                    },
                                                }
                                            }
                                        }
                                    },
                                    else => {},
                                }
                            },
                            else => {},
                        }
                        break;
                    }
                }

                // don't merge super calls to ensure they are called before "this" is accessed
                if (stmt.isSuperCall()) {
                    output.append(stmt) catch unreachable;
                    continue;
                }

                // The following calls to `joinWithComma` are only enabled during bundling. We do this
                // to avoid changing line numbers too much for source maps

                switch (stmt.data) {
                    .s_empty => continue,

                    // skip directives for now
                    .s_directive => continue,

                    .s_local => |local| {
                        // Merge adjacent local statements
                        if (output.items.len > 0) {
                            var prev_stmt = &output.items[output.items.len - 1];
                            if (prev_stmt.data == .s_local and
                                local.canMergeWith(prev_stmt.data.s_local))
                            {
                                prev_stmt.data.s_local.decls.appendSlice(
                                    p.allocator,
                                    local.decls.slice(),
                                ) catch |err| bun.handleOom(err);
                                continue;
                            }
                        }
                    },

                    .s_expr => |s_expr| {
                        // Merge adjacent expression statements
                        if (output.items.len > 0) {
                            var prev_stmt = &output.items[output.items.len - 1];
                            if (prev_stmt.data == .s_expr and !prev_stmt.isSuperCall() and p.options.runtimeMergeAdjacentExpressionStatements()) {
                                prev_stmt.data.s_expr.does_not_affect_tree_shaking = prev_stmt.data.s_expr.does_not_affect_tree_shaking and
                                    s_expr.does_not_affect_tree_shaking;
                                prev_stmt.data.s_expr.value = prev_stmt.data.s_expr.value.joinWithComma(
                                    s_expr.value,
                                    p.allocator,
                                );
                                continue;
                            } else if
                            //
                            // Input:
                            //      var f;
                            //      f = 123;
                            // Output:
                            //      var f = 123;
                            //
                            // This doesn't handle every case. Only the very simple one.
                            (prev_stmt.data == .s_local and
                                s_expr.value.data == .e_binary and
                                prev_stmt.data.s_local.decls.len == 1 and
                                s_expr.value.data.e_binary.op == .bin_assign and
                                // we can only do this with var because var is hoisted
                                // the statement we are merging into may use the statement before its defined.
                                prev_stmt.data.s_local.kind == .k_var)
                            {
                                var prev_local = prev_stmt.data.s_local;
                                const bin_assign = s_expr.value.data.e_binary;

                                if (bin_assign.left.data == .e_identifier) {
                                    var decl = &prev_local.decls.slice()[0];
                                    if (decl.binding.data == .b_identifier and
                                        decl.binding.data.b_identifier.ref.eql(bin_assign.left.data.e_identifier.ref) and
                                        // If the value was assigned, we shouldn't merge it incase it was used in the current statement
                                        // https://github.com/oven-sh/bun/issues/2948
                                        // We don't have a more granular way to check symbol usage so this is the best we can do
                                        decl.value == null)
                                    {
                                        decl.value = bin_assign.right;
                                        p.ignoreUsage(bin_assign.left.data.e_identifier.ref);
                                        continue;
                                    }
                                }
                            }
                        }
                    },
                    .s_switch => |s_switch| {
                        // Absorb a previous expression statement
                        if (output.items.len > 0 and p.options.runtimeMergeAdjacentExpressionStatements()) {
                            var prev_stmt = &output.items[output.items.len - 1];
                            if (prev_stmt.data == .s_expr and !prev_stmt.isSuperCall()) {
                                s_switch.test_ = prev_stmt.data.s_expr.value.joinWithComma(s_switch.test_, p.allocator);
                                output.items.len -= 1;
                            }
                        }
                    },
                    .s_if => |s_if| {
                        // Absorb a previous expression statement
                        if (output.items.len > 0 and p.options.runtimeMergeAdjacentExpressionStatements()) {
                            var prev_stmt = &output.items[output.items.len - 1];
                            if (prev_stmt.data == .s_expr and !prev_stmt.isSuperCall()) {
                                s_if.test_ = prev_stmt.data.s_expr.value.joinWithComma(s_if.test_, p.allocator);
                                output.items.len -= 1;
                            }
                        }

                        // TODO: optimize jump
                    },

                    .s_return => |ret| {
                        // Merge return statements with the previous expression statement
                        if (output.items.len > 0 and ret.value != null and p.options.runtimeMergeAdjacentExpressionStatements()) {
                            var prev_stmt = &output.items[output.items.len - 1];
                            if (prev_stmt.data == .s_expr and !prev_stmt.isSuperCall()) {
                                ret.value = prev_stmt.data.s_expr.value.joinWithComma(ret.value.?, p.allocator);
                                prev_stmt.* = stmt;
                                continue;
                            }
                        }

                        is_control_flow_dead = true;
                    },

                    .s_break, .s_continue => {
                        is_control_flow_dead = true;
                    },

                    .s_throw => {
                        // Merge throw statements with the previous expression statement
                        if (output.items.len > 0 and p.options.runtimeMergeAdjacentExpressionStatements()) {
                            var prev_stmt = &output.items[output.items.len - 1];
                            if (prev_stmt.data == .s_expr and !prev_stmt.isSuperCall()) {
                                prev_stmt.* = p.s(S.Throw{
                                    .value = prev_stmt.data.s_expr.value.joinWithComma(
                                        stmt.data.s_throw.value,
                                        p.allocator,
                                    ),
                                }, stmt.loc);
                                continue;
                            }
                        }

                        is_control_flow_dead = true;
                    },

                    else => {},
                }

                output.append(stmt) catch unreachable;
            }

            stmts.deinit();
            stmts.* = output;
        }
    };
}

pub fn fnBodyContainsUseStrict(body: []Stmt) ?logger.Loc {
    for (body) |stmt| {
        // "use strict" has to appear at the top of the function body
        // but we can allow comments
        switch (stmt.data) {
            .s_comment => {
                continue;
            },
            .s_directive => |dir| {
                if (strings.eqlComptime(dir.value, "use strict")) {
                    return stmt.loc;
                }
            },
            .s_empty => {},
            else => return null,
        }
    }

    return null;
}

const string = []const u8;

const bun = @import("bun");
const Environment = bun.Environment;
const Output = bun.Output;
const assert = bun.assert;
const js_lexer = bun.js_lexer;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const DeclaredSymbol = js_ast.DeclaredSymbol;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Scope = js_ast.Scope;
const Stmt = js_ast.Stmt;
const StmtNodeIndex = js_ast.StmtNodeIndex;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Arg = G.Arg;
const Decl = G.Decl;
const Property = G.Property;

const js_parser = bun.js_parser;
const ExprIn = js_parser.ExprIn;
const FnOnlyDataVisit = js_parser.FnOnlyDataVisit;
const FnOrArrowDataVisit = js_parser.FnOrArrowDataVisit;
const ImportItemForNamespaceMap = js_parser.ImportItemForNamespaceMap;
const JSXTransformType = js_parser.JSXTransformType;
const PrependTempRefsOpts = js_parser.PrependTempRefsOpts;
const Ref = js_parser.Ref;
const RuntimeFeatures = js_parser.RuntimeFeatures;
const SideEffects = js_parser.SideEffects;
const StmtsKind = js_parser.StmtsKind;
const StringVoidMap = js_parser.StringVoidMap;
const TempRef = js_parser.TempRef;
const TypeScript = js_parser.TypeScript;
const VisitArgsOpts = js_parser.VisitArgsOpts;
const isEvalOrArguments = js_parser.isEvalOrArguments;
const options = js_parser.options;

const std = @import("std");
const AutoHashMap = std.AutoHashMap;
const List = std.ArrayListUnmanaged;
const ListManaged = std.array_list.Managed;
