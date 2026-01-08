pub fn VisitExpr(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const allow_macros = P.allow_macros;
        const BinaryExpressionVisitor = P.BinaryExpressionVisitor;
        const jsx_transform_type = P.jsx_transform_type;
        const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;

        // public for JSNode.JSXWriter usage
        pub inline fn visitExpr(noalias p: *P, expr: Expr) Expr {
            if (only_scan_imports_and_do_not_visit) {
                @compileError("only_scan_imports_and_do_not_visit must not run this.");
            }

            // hopefully this gets tailed
            return p.visitExprInOut(expr, .{});
        }

        pub fn visitExprInOut(p: *P, expr: Expr, in: ExprIn) Expr {
            if (in.assign_target != .none and !p.isValidAssignmentTarget(expr)) {
                p.log.addError(p.source, expr.loc, "Invalid assignment target") catch unreachable;
            }

            return switch (@as(Expr.Tag, expr.data)) {
                inline else => |tag| if (comptime @hasDecl(visitors, @tagName(tag)))
                    @field(visitors, @tagName(tag))(p, expr, in)
                else
                    expr,
            };
        }

        const visitors = struct {
            pub fn e_new_target(_: *P, expr: Expr, _: ExprIn) Expr {
                // this error is not necessary and it is causing breakages
                // if (!p.fn_only_data_visit.is_new_target_allowed) {
                //     p.log.addRangeError(p.source, target.range, "Cannot use \"new.target\" here") catch unreachable;
                // }
                return expr;
            }
            pub fn e_string(_: *P, expr: Expr, _: ExprIn) Expr {
                // If you're using this, you're probably not using 0-prefixed legacy octal notation
                // if e.LegacyOctalLoc.Start > 0 {
                return expr;
            }
            pub fn e_number(_: *P, expr: Expr, _: ExprIn) Expr {
                // idc about legacy octal loc
                return expr;
            }
            pub fn e_this(p: *P, expr: Expr, _: ExprIn) Expr {
                if (p.valueForThis(expr.loc)) |exp| {
                    return exp;
                }

                //                 // Capture "this" inside arrow functions that will be lowered into normal
                // // function expressions for older language environments
                // if p.fnOrArrowDataVisit.isArrow && p.options.unsupportedJSFeatures.Has(compat.Arrow) && p.fnOnlyDataVisit.isThisNested {
                //     return js_ast.Expr{Loc: expr.Loc, Data: &js_ast.EIdentifier{Ref: p.captureThis()}}, exprOut{}
                // }
                return expr;
            }
            pub fn e_import_meta(p: *P, expr: Expr, in: ExprIn) Expr {
                // TODO: delete import.meta might not work
                const is_delete_target = p.delete_target == .e_import_meta;

                if (p.define.dots.get("meta")) |meta| {
                    for (meta) |define| {
                        // TODO: clean up how we do define matches
                        if (p.isDotDefineMatch(expr, define.parts)) {
                            // Substitute user-specified defines
                            return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                        }
                    }
                }

                return expr;
            }
            pub fn e_spread(p: *P, expr: Expr, _: ExprIn) Expr {
                const exp = expr.data.e_spread;
                exp.value = p.visitExpr(exp.value);
                return expr;
            }
            pub fn e_identifier(p: *P, expr: Expr, in: ExprIn) Expr {
                var e_ = expr.data.e_identifier;
                const is_delete_target = @as(Expr.Tag, p.delete_target) == .e_identifier and e_.ref.eql(p.delete_target.e_identifier.ref);

                const name = p.loadNameFromRef(e_.ref);
                if (p.isStrictMode() and js_lexer.StrictModeReservedWords.has(name)) {
                    p.markStrictModeFeature(.reserved_word, js_lexer.rangeOfIdentifier(p.source, expr.loc), name) catch unreachable;
                }

                const result = p.findSymbol(expr.loc, name) catch unreachable;

                e_.must_keep_due_to_with_stmt = result.is_inside_with_scope;
                e_.ref = result.ref;

                // Handle assigning to a constant
                if (in.assign_target != .none) {
                    if (p.symbols.items[result.ref.innerIndex()].kind == .constant) { // TODO: silence this for runtime transpiler
                        const r = js_lexer.rangeOfIdentifier(p.source, expr.loc);
                        var notes = p.allocator.alloc(logger.Data, 1) catch unreachable;
                        notes[0] = logger.Data{
                            .text = std.fmt.allocPrint(p.allocator, "The symbol \"{s}\" was declared a constant here:", .{name}) catch unreachable,
                            .location = logger.Location.initOrNull(p.source, js_lexer.rangeOfIdentifier(p.source, result.declare_loc.?)),
                        };

                        const is_error = p.const_values.contains(result.ref) or p.options.bundle;
                        switch (is_error) {
                            true => p.log.addRangeErrorFmtWithNotes(
                                p.source,
                                r,
                                p.allocator,
                                notes,
                                "Cannot assign to \"{s}\" because it is a constant",
                                .{name},
                            ) catch unreachable,

                            false => p.log.addRangeErrorFmtWithNotes(
                                p.source,
                                r,
                                p.allocator,
                                notes,
                                "This assignment will throw because \"{s}\" is a constant",
                                .{name},
                            ) catch unreachable,
                        }
                    } else if (p.exports_ref.eql(e_.ref)) {
                        // Assigning to `exports` in a CommonJS module must be tracked to undo the
                        // `module.exports` -> `exports` optimization.
                        p.commonjs_module_exports_assigned_deoptimized = true;
                    }

                    p.symbols.items[result.ref.innerIndex()].has_been_assigned_to = true;
                }

                var original_name: ?string = null;

                // Substitute user-specified defines for unbound symbols
                if (p.symbols.items[e_.ref.innerIndex()].kind == .unbound and !result.is_inside_with_scope and !is_delete_target) {
                    if (p.define.forIdentifier(name)) |def| {
                        if (!def.valueless()) {
                            const newvalue = p.valueForDefine(expr.loc, in.assign_target, is_delete_target, def);

                            // Don't substitute an identifier for a non-identifier if this is an
                            // assignment target, since it'll cause a syntax error
                            if (@as(Expr.Tag, newvalue.data) == .e_identifier or in.assign_target == .none) {
                                p.ignoreUsage(e_.ref);
                                return newvalue;
                            }

                            original_name = def.original_name();
                        }

                        // Copy the side effect flags over in case this expression is unused
                        if (def.can_be_removed_if_unused()) {
                            e_.can_be_removed_if_unused = true;
                        }
                        if (def.call_can_be_unwrapped_if_unused() == .if_unused and !p.options.ignore_dce_annotations) {
                            e_.call_can_be_unwrapped_if_unused = true;
                        }

                        // If the user passed --drop=console, drop all property accesses to console.
                        if (def.method_call_must_be_replaced_with_undefined() and in.property_access_for_method_call_maybe_should_replace_with_undefined and in.assign_target == .none) {
                            p.method_call_must_be_replaced_with_undefined = true;
                        }
                    }

                    // Substitute uncalled "require" for the require target
                    if (p.require_ref.eql(e_.ref) and !p.isSourceRuntime()) {
                        // mark a reference to __require only if this is not about to be used for a call target
                        if (!(p.call_target == .e_identifier and
                            expr.data.e_identifier.ref.eql(p.call_target.e_identifier.ref)) and
                            p.options.features.allow_runtime)
                        {
                            p.recordUsageOfRuntimeRequire();
                        }

                        return p.valueForRequire(expr.loc);
                    }
                }

                return p.handleIdentifier(expr.loc, e_, original_name, IdentifierOpts{
                    .assign_target = in.assign_target,
                    .is_delete_target = is_delete_target,
                    .is_call_target = @as(Expr.Tag, p.call_target) == .e_identifier and expr.data.e_identifier.ref.eql(p.call_target.e_identifier.ref),
                    .was_originally_identifier = true,
                });
            }
            pub fn e_jsx_element(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_jsx_element;
                switch (comptime jsx_transform_type) {
                    .react => {
                        const tag: Expr = tagger: {
                            if (e_.tag) |_tag| {
                                break :tagger p.visitExpr(_tag);
                            } else {
                                if (p.options.jsx.runtime == .classic) {
                                    break :tagger p.jsxStringsToMemberExpression(expr.loc, p.options.jsx.fragment) catch unreachable;
                                }

                                break :tagger p.jsxImport(.Fragment, expr.loc);
                            }
                        };

                        const all_props: []G.Property = e_.properties.slice();
                        for (all_props) |*property| {
                            if (property.kind != .spread) {
                                property.key = p.visitExpr(property.key.?);
                            }

                            if (property.value != null) {
                                property.value = p.visitExpr(property.value.?);
                            }

                            if (property.initializer != null) {
                                property.initializer = p.visitExpr(property.initializer.?);
                            }
                        }

                        const runtime = if (p.options.jsx.runtime == .automatic) options.JSX.Runtime.automatic else options.JSX.Runtime.classic;
                        const is_key_after_spread = e_.flags.contains(.is_key_after_spread);
                        const children_count = e_.children.len;

                        // TODO: maybe we should split these into two different AST Nodes
                        // That would reduce the amount of allocations a little
                        if (runtime == .classic or is_key_after_spread) {
                            // Arguments to createElement()
                            var args = bun.BabyList(Expr).initCapacity(
                                p.allocator,
                                2 + children_count,
                            ) catch |err| bun.handleOom(err);
                            args.appendAssumeCapacity(tag);

                            const num_props = e_.properties.len;
                            if (num_props > 0) {
                                const props = p.allocator.alloc(G.Property, num_props) catch unreachable;
                                bun.copy(G.Property, props, e_.properties.slice());
                                args.appendAssumeCapacity(p.newExpr(
                                    E.Object{ .properties = G.Property.List.fromOwnedSlice(props) },
                                    expr.loc,
                                ));
                            } else {
                                args.appendAssumeCapacity(p.newExpr(E.Null{}, expr.loc));
                            }

                            const children_elements = e_.children.slice()[0..children_count];
                            for (children_elements) |child| {
                                const arg = p.visitExpr(child);
                                if (arg.data != .e_missing) {
                                    args.appendAssumeCapacity(arg);
                                }
                            }

                            const target = p.jsxStringsToMemberExpression(expr.loc, p.options.jsx.factory) catch unreachable;

                            // Call createElement()
                            return p.newExpr(E.Call{
                                .target = if (runtime == .classic) target else p.jsxImport(.createElement, expr.loc),
                                .args = args,
                                // Enable tree shaking
                                .can_be_unwrapped_if_unused = if (!p.options.ignore_dce_annotations and !p.options.jsx.side_effects) .if_unused else .never,
                                .close_paren_loc = e_.close_tag_loc,
                            }, expr.loc);
                        }
                        // function jsxDEV(type, config, maybeKey, source, self) {
                        else if (runtime == .automatic) {
                            // --- These must be done in all cases --
                            const allocator = p.allocator;
                            var props = &e_.properties;

                            const maybe_key_value: ?ExprNodeIndex =
                                if (e_.key_prop_index > -1) props.orderedRemove(@intCast(e_.key_prop_index)).value else null;

                            // arguments needs to be like
                            // {
                            //    ...props,
                            //    children: [el1, el2]
                            // }

                            {
                                var last_child: u32 = 0;
                                const children = e_.children.slice()[0..children_count];
                                for (children) |child| {
                                    e_.children.ptr[last_child] = p.visitExpr(child);
                                    // if tree-shaking removes the element, we must also remove it here.
                                    last_child += @as(u32, @intCast(@intFromBool(e_.children.ptr[last_child].data != .e_missing)));
                                }
                                e_.children.len = last_child;
                            }

                            const children_key = Expr{ .data = jsxChildrenKeyData, .loc = expr.loc };

                            // Optimization: if the only non-child prop is a spread object
                            // we can just pass the object as the first argument
                            // this goes as deep as there are spreads
                            // <div {{...{...{...{...foo}}}}} />
                            // ->
                            // <div {{...foo}} />
                            // jsx("div", {...foo})
                            while (props.len == 1 and props.at(0).kind == .spread and props.at(0).value.?.data == .e_object) {
                                props = &props.at(0).value.?.data.e_object.properties;
                            }

                            // Typescript defines static jsx as children.len > 1 or single spread
                            // https://github.com/microsoft/TypeScript/blob/d4fbc9b57d9aa7d02faac9b1e9bb7b37c687f6e9/src/compiler/transformers/jsx.ts#L340
                            const is_static_jsx = e_.children.len > 1 or (e_.children.len == 1 and e_.children.ptr[0].data == .e_spread);

                            if (is_static_jsx) {
                                props.append(allocator, G.Property{
                                    .key = children_key,
                                    .value = p.newExpr(E.Array{
                                        .items = e_.children,
                                        .is_single_line = e_.children.len < 2,
                                    }, e_.close_tag_loc),
                                }) catch |err| bun.handleOom(err);
                            } else if (e_.children.len == 1) {
                                props.append(allocator, G.Property{
                                    .key = children_key,
                                    .value = e_.children.ptr[0],
                                }) catch |err| bun.handleOom(err);
                            }

                            // Either:
                            // jsxDEV(type, arguments, key, isStaticChildren, source, self)
                            // jsx(type, arguments, key)
                            const args = p.allocator.alloc(Expr, if (p.options.jsx.development) @as(usize, 6) else @as(usize, 2) + @as(usize, @intFromBool(maybe_key_value != null))) catch unreachable;
                            args[0] = tag;

                            args[1] = p.newExpr(E.Object{
                                .properties = props.*,
                            }, expr.loc);

                            if (maybe_key_value) |key| {
                                args[2] = key;
                            } else if (p.options.jsx.development) {
                                // if (maybeKey !== undefined)
                                args[2] = Expr{
                                    .loc = expr.loc,
                                    .data = .{
                                        .e_undefined = E.Undefined{},
                                    },
                                };
                            }

                            if (p.options.jsx.development) {
                                // is the return type of the first child an array?
                                // It's dynamic
                                // Else, it's static
                                args[3] = Expr{
                                    .loc = expr.loc,
                                    .data = .{
                                        .e_boolean = .{
                                            .value = is_static_jsx,
                                        },
                                    },
                                };

                                args[4] = p.newExpr(E.Undefined{}, expr.loc);
                                args[5] = Expr{ .data = Prefill.Data.This, .loc = expr.loc };
                            }

                            return p.newExpr(E.Call{
                                .target = p.jsxImportAutomatic(expr.loc, is_static_jsx),
                                .args = ExprNodeList.fromOwnedSlice(args),
                                // Enable tree shaking
                                .can_be_unwrapped_if_unused = if (!p.options.ignore_dce_annotations and !p.options.jsx.side_effects) .if_unused else .never,
                                .was_jsx_element = true,
                                .close_paren_loc = e_.close_tag_loc,
                            }, expr.loc);
                        } else {
                            unreachable;
                        }
                    },
                    else => unreachable,
                }
                return expr;
            }
            pub fn e_template(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_template;
                if (e_.tag) |tag| {
                    e_.tag = p.visitExpr(tag);

                    if (comptime allow_macros) {
                        const ref = switch (e_.tag.?.data) {
                            .e_import_identifier => |ident| ident.ref,
                            .e_dot => |dot| if (dot.target.data == .e_identifier) dot.target.data.e_identifier.ref else null,
                            else => null,
                        };

                        if (ref != null and !p.options.features.is_macro_runtime) {
                            if (p.macro.refs.get(ref.?)) |macro_ref_data| {
                                p.ignoreUsage(ref.?);
                                if (p.is_control_flow_dead) {
                                    return p.newExpr(E.Undefined{}, e_.tag.?.loc);
                                }

                                // this ordering incase someone wants to use a macro in a node_module conditionally
                                if (p.options.features.no_macros) {
                                    p.log.addError(p.source, tag.loc, "Macros are disabled") catch unreachable;
                                    return p.newExpr(E.Undefined{}, e_.tag.?.loc);
                                }

                                if (p.source.path.isNodeModule()) {
                                    p.log.addError(p.source, expr.loc, "For security reasons, macros cannot be run from node_modules.") catch unreachable;
                                    return p.newExpr(E.Undefined{}, expr.loc);
                                }

                                p.macro_call_count += 1;
                                const name = macro_ref_data.name orelse e_.tag.?.data.e_dot.name;
                                const record = &p.import_records.items[macro_ref_data.import_record_id];
                                // We must visit it to convert inline_identifiers and record usage
                                const macro_result = (p.options.macro_context.call(
                                    record.path.text,
                                    p.source.path.sourceDir(),
                                    p.log,
                                    p.source,
                                    record.range,
                                    expr,
                                    name,
                                ) catch return expr);

                                if (macro_result.data != .e_template) {
                                    return p.visitExpr(macro_result);
                                }
                            }
                        }
                    }
                }

                for (e_.parts) |*part| {
                    part.value = p.visitExpr(part.value);
                }

                // When mangling, inline string values into the template literal. Note that
                // it may no longer be a template literal after this point (it may turn into
                // a plain string literal instead).
                if (p.should_fold_typescript_constant_expressions or p.options.features.inlining) {
                    return e_.fold(p.allocator, expr.loc);
                }
                return expr;
            }
            pub fn e_binary(p: *P, expr: Expr, in: ExprIn) Expr {
                const e_ = expr.data.e_binary;

                // The handling of binary expressions is convoluted because we're using
                // iteration on the heap instead of recursion on the call stack to avoid
                // stack overflow for deeply-nested ASTs.
                var v = BinaryExpressionVisitor{
                    .e = e_,
                    .loc = expr.loc,
                    .in = in,
                    .left_in = ExprIn{},
                };

                // Everything uses a single stack to reduce allocation overhead. This stack
                // should almost always be very small, and almost all visits should reuse
                // existing memory without allocating anything.
                const stack_bottom = p.binary_expression_stack.items.len;

                var current = Expr{ .data = .{ .e_binary = e_ }, .loc = v.loc };

                // Iterate down into the AST along the left node of the binary operation.
                // Continue iterating until we encounter something that's not a binary node.

                while (true) {
                    if (v.checkAndPrepare(p)) |out| {
                        current = out;
                        break;
                    }

                    // Grab the arguments to our nested "visitExprInOut" call for the left
                    // node. We only care about deeply-nested left nodes because most binary
                    // operators in JavaScript are left-associative and the problematic edge
                    // cases we're trying to avoid crashing on have lots of left-associative
                    // binary operators chained together without parentheses (e.g. "1+2+...").
                    const left = v.e.left;
                    const left_in = v.left_in;

                    const left_binary: ?*E.Binary = if (left.data == .e_binary) left.data.e_binary else null;

                    // Stop iterating if iteration doesn't apply to the left node. This checks
                    // the assignment target because "visitExprInOut" has additional behavior
                    // in that case that we don't want to miss (before the top-level "switch"
                    // statement).
                    if (left_binary == null or left_in.assign_target != .none) {
                        v.e.left = p.visitExprInOut(left, left_in);
                        current = v.visitRightAndFinish(p);
                        break;
                    }

                    // Note that we only append to the stack (and therefore allocate memory
                    // on the heap) when there are nested binary expressions. A single binary
                    // expression doesn't add anything to the stack.
                    bun.handleOom(p.binary_expression_stack.append(v));
                    v = BinaryExpressionVisitor{
                        .e = left_binary.?,
                        .loc = left.loc,
                        .in = left_in,
                        .left_in = .{},
                    };
                }

                // Process all binary operations from the deepest-visited node back toward
                // our original top-level binary operation.
                while (p.binary_expression_stack.items.len > stack_bottom) {
                    v = p.binary_expression_stack.pop().?;
                    v.e.left = current;
                    current = v.visitRightAndFinish(p);
                }

                return current;
            }
            pub fn e_index(p: *P, expr: Expr, in: ExprIn) Expr {
                const e_ = expr.data.e_index;
                const is_call_target = p.call_target == .e_index and expr.data.e_index == p.call_target.e_index;
                const is_delete_target = p.delete_target == .e_index and expr.data.e_index == p.delete_target.e_index;

                // "a['b']" => "a.b"
                if (p.options.features.minify_syntax and
                    e_.index.data == .e_string and
                    e_.index.data.e_string.isUTF8() and
                    e_.index.data.e_string.isIdentifier(p.allocator))
                {
                    const dot = p.newExpr(
                        E.Dot{
                            .name = e_.index.data.e_string.slice(p.allocator),
                            .name_loc = e_.index.loc,
                            .target = e_.target,
                            .optional_chain = e_.optional_chain,
                        },
                        expr.loc,
                    );

                    if (is_call_target) {
                        p.call_target = dot.data;
                    }

                    if (is_delete_target) {
                        p.delete_target = dot.data;
                    }

                    return p.visitExprInOut(dot, in);
                }

                const target_visited = p.visitExprInOut(e_.target, ExprIn{
                    .has_chain_parent = e_.optional_chain == .continuation,
                });
                e_.target = target_visited;

                switch (e_.index.data) {
                    .e_private_identifier => |_private| {
                        var private = _private;
                        const name = p.loadNameFromRef(private.ref);
                        const result = p.findSymbol(e_.index.loc, name) catch unreachable;
                        private.ref = result.ref;

                        // Unlike regular identifiers, there are no unbound private identifiers
                        const kind: Symbol.Kind = p.symbols.items[result.ref.innerIndex()].kind;
                        var r: logger.Range = undefined;
                        if (!Symbol.isKindPrivate(kind)) {
                            r = logger.Range{ .loc = e_.index.loc, .len = @as(i32, @intCast(name.len)) };
                            p.log.addRangeErrorFmt(p.source, r, p.allocator, "Private name \"{s}\" must be declared in an enclosing class", .{name}) catch unreachable;
                        } else {
                            if (in.assign_target != .none and (kind == .private_method or kind == .private_static_method)) {
                                r = logger.Range{ .loc = e_.index.loc, .len = @as(i32, @intCast(name.len)) };
                                p.log.addRangeWarningFmt(p.source, r, p.allocator, "Writing to read-only method \"{s}\" will throw", .{name}) catch unreachable;
                            } else if (in.assign_target != .none and (kind == .private_get or kind == .private_static_get)) {
                                r = logger.Range{ .loc = e_.index.loc, .len = @as(i32, @intCast(name.len)) };
                                p.log.addRangeWarningFmt(p.source, r, p.allocator, "Writing to getter-only property \"{s}\" will throw", .{name}) catch unreachable;
                            } else if (in.assign_target != .replace and (kind == .private_set or kind == .private_static_set)) {
                                r = logger.Range{ .loc = e_.index.loc, .len = @as(i32, @intCast(name.len)) };
                                p.log.addRangeWarningFmt(p.source, r, p.allocator, "Reading from setter-only property \"{s}\" will throw", .{name}) catch unreachable;
                            }
                        }

                        e_.index = .{ .data = .{ .e_private_identifier = private }, .loc = e_.index.loc };
                    },
                    else => {
                        const index = p.visitExpr(e_.index);
                        e_.index = index;

                        const unwrapped = e_.index.unwrapInlined();
                        if (unwrapped.data == .e_string and
                            unwrapped.data.e_string.isUTF8())
                        {
                            // "a['b' + '']" => "a.b"
                            // "enum A { B = 'b' }; a[A.B]" => "a.b"
                            if (p.options.features.minify_syntax and
                                unwrapped.data.e_string.isIdentifier(p.allocator))
                            {
                                const dot = p.newExpr(
                                    E.Dot{
                                        .name = unwrapped.data.e_string.slice(p.allocator),
                                        .name_loc = unwrapped.loc,
                                        .target = e_.target,
                                        .optional_chain = e_.optional_chain,
                                    },
                                    expr.loc,
                                );

                                if (is_call_target) {
                                    p.call_target = dot.data;
                                }

                                if (is_delete_target) {
                                    p.delete_target = dot.data;
                                }

                                // don't call visitExprInOut on `dot` because we've already visited `target` above!
                                return dot;
                            }

                            // Handle property rewrites to ensure things
                            // like .e_import_identifier tracking works
                            // Reminder that this can only be done after
                            // `target` is visited.
                            if (p.maybeRewritePropertyAccess(
                                expr.loc,
                                e_.target,
                                unwrapped.data.e_string.data,
                                unwrapped.loc,
                                .{
                                    .is_call_target = is_call_target,
                                    // .is_template_tag = is_template_tag,
                                    .is_delete_target = is_delete_target,
                                    .assign_target = in.assign_target,
                                },
                            )) |rewrite| {
                                return rewrite;
                            }
                        }
                    },
                }

                const target = e_.target.unwrapInlined();
                const index = e_.index.unwrapInlined();

                if (p.options.features.minify_syntax) {
                    if (index.data.as(.e_number)) |number| {
                        if (number.value >= 0 and
                            number.value < @as(f64, @as(comptime_float, std.math.maxInt(usize))) and
                            @mod(number.value, 1) == 0)
                        {
                            // "foo"[2] -> "o"
                            if (target.data.as(.e_string)) |str| {
                                if (str.isUTF8()) {
                                    const literal = str.slice(p.allocator);
                                    const num: usize = index.data.e_number.toUsize();
                                    if (Environment.allow_assert) {
                                        bun.assert(bun.strings.isAllASCII(literal));
                                    }
                                    if (num < literal.len) {
                                        return p.newExpr(E.String{ .data = literal[num .. num + 1] }, expr.loc);
                                    }
                                }
                            } else if (target.data.as(.e_array)) |array| {
                                // [x][0] -> x
                                if (array.items.len == 1 and number.value == 0) {
                                    const inlined = target.data.e_array.items.at(0).*;
                                    if (inlined.canBeInlinedFromPropertyAccess())
                                        return inlined;
                                }

                                // ['a', 'b', 'c'][1] -> 'b'
                                const int: usize = @intFromFloat(number.value);
                                if (int < array.items.len and p.exprCanBeRemovedIfUnused(&target)) {
                                    const inlined = target.data.e_array.items.at(int).*;
                                    // ['a', , 'c'][1] -> undefined
                                    if (inlined.data == .e_missing) return p.newExpr(E.Undefined{}, inlined.loc);
                                    if (Environment.allow_assert) assert(inlined.canBeInlinedFromPropertyAccess());
                                    return inlined;
                                }
                            }
                        }
                    }
                }

                // Create an error for assigning to an import namespace when bundling. Even
                // though this is a run-time error, we make it a compile-time error when
                // bundling because scope hoisting means these will no longer be run-time
                // errors.
                if ((in.assign_target != .none or is_delete_target) and
                    @as(Expr.Tag, e_.target.data) == .e_identifier and
                    p.symbols.items[e_.target.data.e_identifier.ref.innerIndex()].kind == .import)
                {
                    const r = js_lexer.rangeOfIdentifier(p.source, e_.target.loc);
                    p.log.addRangeErrorFmt(
                        p.source,
                        r,
                        p.allocator,
                        "Cannot assign to property on import \"{s}\"",
                        .{p.symbols.items[e_.target.data.e_identifier.ref.innerIndex()].original_name},
                    ) catch unreachable;
                }

                return p.newExpr(e_, expr.loc);
            }
            pub fn e_unary(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_unary;
                switch (e_.op) {
                    .un_typeof => {
                        const id_before = e_.value.data == .e_identifier;
                        e_.value = p.visitExprInOut(e_.value, ExprIn{ .assign_target = e_.op.unaryAssignTarget() });
                        const id_after = e_.value.data == .e_identifier;

                        // The expression "typeof (0, x)" must not become "typeof x" if "x"
                        // is unbound because that could suppress a ReferenceError from "x"
                        if (!id_before and id_after and p.symbols.items[e_.value.data.e_identifier.ref.innerIndex()].kind == .unbound) {
                            e_.value = Expr.joinWithComma(
                                Expr{ .loc = e_.value.loc, .data = Prefill.Data.Zero },
                                e_.value,
                                p.allocator,
                            );
                        }

                        if (e_.value.data == .e_require_call_target) {
                            p.ignoreUsageOfRuntimeRequire();
                            return p.newExpr(E.String{ .data = "function" }, expr.loc);
                        }

                        if (SideEffects.typeof(e_.value.data)) |typeof| {
                            return p.newExpr(E.String{ .data = typeof }, expr.loc);
                        }
                    },
                    .un_delete => {
                        e_.value = p.visitExprInOut(e_.value, ExprIn{ .has_chain_parent = true });
                    },
                    else => {
                        e_.value = p.visitExprInOut(e_.value, ExprIn{ .assign_target = e_.op.unaryAssignTarget() });

                        // Post-process the unary expression
                        switch (e_.op) {
                            .un_not => {
                                if (p.options.features.minify_syntax)
                                    e_.value = SideEffects.simplifyBoolean(p, e_.value);

                                const side_effects = SideEffects.toBoolean(p, e_.value.data);
                                if (side_effects.ok) {
                                    return p.newExpr(E.Boolean{ .value = !side_effects.value }, expr.loc);
                                }

                                if (p.options.features.minify_syntax) {
                                    if (e_.value.maybeSimplifyNot(p.allocator)) |exp| {
                                        return exp;
                                    }
                                    if (e_.value.data == .e_import_meta_main) {
                                        e_.value.data.e_import_meta_main.inverted = !e_.value.data.e_import_meta_main.inverted;
                                        return e_.value;
                                    }
                                }
                            },
                            .un_cpl => {
                                if (p.should_fold_typescript_constant_expressions) {
                                    if (SideEffects.toNumber(e_.value.data)) |value| {
                                        return p.newExpr(E.Number{
                                            .value = @floatFromInt(~floatToInt32(value)),
                                        }, expr.loc);
                                    }
                                }
                            },
                            .un_void => {
                                if (p.exprCanBeRemovedIfUnused(&e_.value)) {
                                    return p.newExpr(E.Undefined{}, e_.value.loc);
                                }
                            },
                            .un_pos => {
                                if (SideEffects.toNumber(e_.value.data)) |num| {
                                    return p.newExpr(E.Number{ .value = num }, expr.loc);
                                }
                            },
                            .un_neg => {
                                if (SideEffects.toNumber(e_.value.data)) |num| {
                                    return p.newExpr(E.Number{ .value = -num }, expr.loc);
                                }
                            },

                            ////////////////////////////////////////////////////////////////////////////////

                            .un_pre_dec => {
                                // TODO: private fields
                            },
                            .un_pre_inc => {
                                // TODO: private fields
                            },
                            .un_post_dec => {
                                // TODO: private fields
                            },
                            .un_post_inc => {
                                // TODO: private fields
                            },
                            else => {},
                        }

                        if (p.options.features.minify_syntax) {
                            // "-(a, b)" => "a, -b"
                            if (switch (e_.op) {
                                .un_delete, .un_typeof => false,
                                else => true,
                            }) {
                                switch (e_.value.data) {
                                    .e_binary => |comma| {
                                        if (comma.op == .bin_comma) {
                                            return Expr.joinWithComma(
                                                comma.left,
                                                p.newExpr(
                                                    E.Unary{
                                                        .op = e_.op,
                                                        .value = comma.right,
                                                        .flags = e_.flags,
                                                    },
                                                    comma.right.loc,
                                                ),
                                                p.allocator,
                                            );
                                        }
                                    },
                                    else => {},
                                }
                            }
                        }
                    },
                }
                return expr;
            }
            pub fn e_dot(p: *P, expr: Expr, in: ExprIn) Expr {
                const e_ = expr.data.e_dot;
                const is_delete_target = @as(Expr.Tag, p.delete_target) == .e_dot and expr.data.e_dot == p.delete_target.e_dot;
                const is_call_target = @as(Expr.Tag, p.call_target) == .e_dot and expr.data.e_dot == p.call_target.e_dot;

                if (p.define.dots.get(e_.name)) |parts| {
                    for (parts) |*define| {
                        if (p.isDotDefineMatch(expr, define.parts)) {
                            if (in.assign_target == .none) {
                                // Substitute user-specified defines
                                if (!define.data.valueless()) {
                                    return p.valueForDefine(expr.loc, in.assign_target, is_delete_target, &define.data);
                                }

                                if (define.data.method_call_must_be_replaced_with_undefined() and in.property_access_for_method_call_maybe_should_replace_with_undefined) {
                                    p.method_call_must_be_replaced_with_undefined = true;
                                }
                            }

                            // Copy the side effect flags over in case this expression is unused
                            if (define.data.can_be_removed_if_unused()) {
                                e_.can_be_removed_if_unused = true;
                            }

                            if (define.data.call_can_be_unwrapped_if_unused() != .never and !p.options.ignore_dce_annotations) {
                                e_.call_can_be_unwrapped_if_unused = define.data.call_can_be_unwrapped_if_unused();
                            }

                            break;
                        }
                    }
                }

                // Track ".then().catch()" chains
                if (is_call_target and @as(Expr.Tag, p.then_catch_chain.next_target) == .e_dot and p.then_catch_chain.next_target.e_dot == expr.data.e_dot) {
                    if (strings.eqlComptime(e_.name, "catch")) {
                        p.then_catch_chain = ThenCatchChain{
                            .next_target = e_.target.data,
                            .has_catch = true,
                        };
                    } else if (strings.eqlComptime(e_.name, "then")) {
                        p.then_catch_chain = ThenCatchChain{
                            .next_target = e_.target.data,
                            .has_catch = p.then_catch_chain.has_catch or p.then_catch_chain.has_multiple_args,
                        };
                    }
                }

                e_.target = p.visitExprInOut(e_.target, .{
                    .property_access_for_method_call_maybe_should_replace_with_undefined = in.property_access_for_method_call_maybe_should_replace_with_undefined,
                });

                // 'require.resolve' -> .e_require_resolve_call_target
                if (e_.target.data == .e_require_call_target and
                    strings.eqlComptime(e_.name, "resolve"))
                {
                    // we do not need to call p.recordUsageOfRuntimeRequire(); because `require`
                    // was not a call target. even if the call target is `require.resolve`, it should be set.
                    return .{
                        .data = .{
                            .e_require_resolve_call_target = {},
                        },
                        .loc = expr.loc,
                    };
                }

                if (e_.optional_chain == null) {
                    if (p.maybeRewritePropertyAccess(
                        expr.loc,
                        e_.target,
                        e_.name,
                        e_.name_loc,
                        .{
                            .is_call_target = is_call_target,
                            .assign_target = in.assign_target,
                            .is_delete_target = is_delete_target,
                            // .is_template_tag = p.template_tag != null,
                        },
                    )) |_expr| {
                        return _expr;
                    }

                    if (comptime allow_macros) {
                        if (!p.options.features.is_macro_runtime) {
                            if (p.macro_call_count > 0 and e_.target.data == .e_object and e_.target.data.e_object.was_originally_macro) {
                                if (e_.target.get(e_.name)) |obj| {
                                    return obj;
                                }
                            }
                        }
                    }
                }
                return expr;
            }
            pub fn e_if(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_if;
                const is_call_target = @as(Expr.Data, p.call_target) == .e_if and expr.data.e_if == p.call_target.e_if;

                const prev_in_branch = p.in_branch_condition;
                p.in_branch_condition = true;
                e_.test_ = p.visitExpr(e_.test_);
                p.in_branch_condition = prev_in_branch;

                e_.test_ = SideEffects.simplifyBoolean(p, e_.test_);

                const side_effects = SideEffects.toBoolean(p, e_.test_.data);

                if (!side_effects.ok) {
                    e_.yes = p.visitExpr(e_.yes);
                    e_.no = p.visitExpr(e_.no);
                } else {
                    // Mark the control flow as dead if the branch is never taken
                    if (side_effects.value) {
                        // "true ? live : dead"
                        e_.yes = p.visitExpr(e_.yes);
                        const old = p.is_control_flow_dead;
                        p.is_control_flow_dead = true;
                        e_.no = p.visitExpr(e_.no);
                        p.is_control_flow_dead = old;

                        if (side_effects.side_effects == .could_have_side_effects) {
                            return Expr.joinWithComma(SideEffects.simplifyUnusedExpr(p, e_.test_) orelse p.newExpr(E.Missing{}, e_.test_.loc), e_.yes, p.allocator);
                        }

                        // "(1 ? fn : 2)()" => "fn()"
                        // "(1 ? this.fn : 2)" => "this.fn"
                        // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                        if (is_call_target and e_.yes.hasValueForThisInCall()) {
                            return p.newExpr(E.Number{ .value = 0 }, e_.test_.loc).joinWithComma(e_.yes, p.allocator);
                        }

                        return e_.yes;
                    } else {
                        // "false ? dead : live"
                        const old = p.is_control_flow_dead;
                        p.is_control_flow_dead = true;
                        e_.yes = p.visitExpr(e_.yes);
                        p.is_control_flow_dead = old;
                        e_.no = p.visitExpr(e_.no);

                        // "(a, false) ? b : c" => "a, c"
                        if (side_effects.side_effects == .could_have_side_effects) {
                            return Expr.joinWithComma(SideEffects.simplifyUnusedExpr(p, e_.test_) orelse p.newExpr(E.Missing{}, e_.test_.loc), e_.no, p.allocator);
                        }

                        // "(1 ? fn : 2)()" => "fn()"
                        // "(1 ? this.fn : 2)" => "this.fn"
                        // "(1 ? this.fn : 2)()" => "(0, this.fn)()"
                        if (is_call_target and e_.no.hasValueForThisInCall()) {
                            return p.newExpr(E.Number{ .value = 0 }, e_.test_.loc).joinWithComma(e_.no, p.allocator);
                        }
                        return e_.no;
                    }
                }
                return expr;
            }
            pub fn e_await(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_await;
                p.await_target = e_.value.data;
                e_.value = p.visitExpr(e_.value);
                return expr;
            }
            pub fn e_yield(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_yield;
                if (e_.value) |val| {
                    e_.value = p.visitExpr(val);
                }
                return expr;
            }
            pub fn e_array(p: *P, expr: Expr, in: ExprIn) Expr {
                const e_ = expr.data.e_array;
                if (in.assign_target != .none) {
                    p.maybeCommaSpreadError(e_.comma_after_spread);
                }
                const items = e_.items.slice();
                var spread_item_count: usize = 0;
                for (items) |*item| {
                    switch (item.data) {
                        .e_missing => {},
                        .e_spread => |spread| {
                            spread.value = p.visitExprInOut(spread.value, ExprIn{ .assign_target = in.assign_target });

                            spread_item_count += if (spread.value.data == .e_array)
                                @as(usize, spread.value.data.e_array.items.len)
                            else
                                0;
                        },
                        .e_binary => |e2| {
                            if (in.assign_target != .none and e2.op == .bin_assign) {
                                const was_anonymous_named_expr = e2.right.isAnonymousNamed();
                                e2.left = p.visitExprInOut(e2.left, ExprIn{ .assign_target = .replace });
                                e2.right = p.visitExpr(e2.right);

                                if (@as(Expr.Tag, e2.left.data) == .e_identifier) {
                                    e2.right = p.maybeKeepExprSymbolName(
                                        e2.right,
                                        p.symbols.items[e2.left.data.e_identifier.ref.innerIndex()].original_name,
                                        was_anonymous_named_expr,
                                    );
                                }
                            } else {
                                item.* = p.visitExprInOut(item.*, ExprIn{ .assign_target = in.assign_target });
                            }
                        },
                        else => {
                            item.* = p.visitExprInOut(item.*, ExprIn{ .assign_target = in.assign_target });
                        },
                    }
                }

                // "[1, ...[2, 3], 4]" => "[1, 2, 3, 4]"
                if (p.options.features.minify_syntax and spread_item_count > 0 and in.assign_target == .none) {
                    e_.items = e_.inlineSpreadOfArrayLiterals(p.allocator, spread_item_count) catch e_.items;
                }
                return expr;
            }
            pub fn e_object(p: *P, expr: Expr, in: ExprIn) Expr {
                const e_ = expr.data.e_object;
                if (in.assign_target != .none) {
                    p.maybeCommaSpreadError(e_.comma_after_spread);
                }

                var has_spread = false;
                var has_proto = false;
                for (e_.properties.slice()) |*property| {
                    if (property.kind != .spread) {
                        property.key = p.visitExpr(property.key orelse Output.panic("Expected property key", .{}));
                        const key = property.key.?;
                        // Forbid duplicate "__proto__" properties according to the specification
                        if (!property.flags.contains(.is_computed) and
                            !property.flags.contains(.was_shorthand) and
                            !property.flags.contains(.is_method) and
                            in.assign_target == .none and
                            key.data.isStringValue() and
                            strings.eqlComptime(
                                // __proto__ is utf8, assume it lives in refs
                                key.data.e_string.slice(p.allocator),
                                "__proto__",
                            ))
                        {
                            if (has_proto) {
                                const r = js_lexer.rangeOfIdentifier(p.source, key.loc);
                                p.log.addRangeError(p.source, r, "Cannot specify the \"__proto__\" property more than once per object") catch unreachable;
                            }
                            has_proto = true;
                        }
                    } else {
                        has_spread = true;
                    }

                    // Extract the initializer for expressions like "({ a: b = c } = d)"
                    if (in.assign_target != .none and property.initializer == null and property.value != null) {
                        switch (property.value.?.data) {
                            .e_binary => |bin| {
                                if (bin.op == .bin_assign) {
                                    property.initializer = bin.right;
                                    property.value = bin.left;
                                }
                            },
                            else => {},
                        }
                    }

                    if (property.value != null) {
                        property.value = p.visitExprInOut(property.value.?, ExprIn{ .assign_target = in.assign_target });
                    }

                    if (property.initializer != null) {
                        const was_anonymous_named_expr = property.initializer.?.isAnonymousNamed();
                        property.initializer = p.visitExpr(property.initializer.?);

                        if (property.value) |val| {
                            if (@as(Expr.Tag, val.data) == .e_identifier) {
                                property.initializer = p.maybeKeepExprSymbolName(
                                    property.initializer orelse unreachable,
                                    p.symbols.items[val.data.e_identifier.ref.innerIndex()].original_name,
                                    was_anonymous_named_expr,
                                );
                            }
                        }
                    }
                }
                return expr;
            }
            pub fn e_import(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_import;
                // We want to forcefully fold constants inside of imports
                // even when minification is disabled, so that if we have an
                // import based on a string template, it does not cause a
                // bundle error. This is especially relevant for bundling NAPI
                // modules with 'bun build --compile':
                //
                // const binding = await import(`./${process.platform}-${process.arch}.node`);
                //
                const prev_should_fold_typescript_constant_expressions = true;
                defer p.should_fold_typescript_constant_expressions = prev_should_fold_typescript_constant_expressions;
                p.should_fold_typescript_constant_expressions = true;

                e_.expr = p.visitExpr(e_.expr);
                e_.options = p.visitExpr(e_.options);

                // Import transposition is able to duplicate the options structure, so
                // only perform it if the expression is side effect free.
                //
                // TODO: make this more like esbuild by emitting warnings that explain
                // why this import was not analyzed. (see esbuild 'unsupported-dynamic-import')
                if (p.exprCanBeRemovedIfUnused(&e_.options)) {
                    const state = TransposeState{
                        .is_await_target = if (p.await_target) |await_target|
                            await_target == .e_import and await_target.e_import == e_
                        else
                            false,

                        .is_then_catch_target = p.then_catch_chain.has_catch and
                            p.then_catch_chain.next_target == .e_import and
                            expr.data.e_import == p.then_catch_chain.next_target.e_import,

                        .import_options = e_.options,

                        .loc = e_.expr.loc,
                        .import_loader = e_.importRecordLoader(),
                    };

                    return p.import_transposer.maybeTransposeIf(e_.expr, &state);
                }
                return expr;
            }
            pub fn e_call(p: *P, expr: Expr, in: ExprIn) Expr {
                const e_ = expr.data.e_call;
                p.call_target = e_.target.data;

                p.then_catch_chain = ThenCatchChain{
                    .next_target = e_.target.data,
                    .has_multiple_args = e_.args.len >= 2,
                    .has_catch = @as(Expr.Tag, p.then_catch_chain.next_target) == .e_call and p.then_catch_chain.next_target.e_call == expr.data.e_call and p.then_catch_chain.has_catch,
                };

                const target_was_identifier_before_visit = e_.target.data == .e_identifier;
                e_.target = p.visitExprInOut(e_.target, .{
                    .has_chain_parent = e_.optional_chain == .continuation,
                    .property_access_for_method_call_maybe_should_replace_with_undefined = true,
                });

                // Copy the call side effect flag over if this is a known target
                switch (e_.target.data) {
                    .e_identifier => |ident| {
                        if (ident.call_can_be_unwrapped_if_unused and e_.can_be_unwrapped_if_unused == .never)
                            e_.can_be_unwrapped_if_unused = .if_unused;

                        // Detect if this is a direct eval. Note that "(1 ? eval : 0)(x)" will
                        // become "eval(x)" after we visit the target due to dead code elimination,
                        // but that doesn't mean it should become a direct eval.
                        //
                        // Note that "eval?.(x)" is considered an indirect eval. There was debate
                        // about this after everyone implemented it as a direct eval, but the
                        // language committee said it was indirect and everyone had to change it:
                        // https://github.com/tc39/ecma262/issues/2062.
                        if (e_.optional_chain == null and
                            target_was_identifier_before_visit and
                            strings.eqlComptime(
                                p.symbols.items[e_.target.data.e_identifier.ref.inner_index].original_name,
                                "eval",
                            ))
                        {
                            e_.is_direct_eval = true;

                            // Pessimistically assume that if this looks like a CommonJS module
                            // (e.g. no "export" keywords), a direct call to "eval" means that
                            // code could potentially access "module" or "exports".
                            if (p.options.bundle and !p.is_file_considered_to_have_esm_exports) {
                                p.recordUsage(p.module_ref);
                                p.recordUsage(p.exports_ref);
                            }

                            var scope_iter: ?*js_ast.Scope = p.current_scope;
                            while (scope_iter) |scope| : (scope_iter = scope.parent) {
                                scope.contains_direct_eval = true;
                            }

                            // TODO: Log a build note for this like esbuild does
                        }
                    },
                    .e_dot => |dot| {
                        if (dot.call_can_be_unwrapped_if_unused != .never and e_.can_be_unwrapped_if_unused == .never) {
                            e_.can_be_unwrapped_if_unused = dot.call_can_be_unwrapped_if_unused;
                        }
                    },
                    else => {},
                }

                const is_macro_ref: bool = if (comptime allow_macros) brk: {
                    const possible_macro_ref = switch (e_.target.data) {
                        .e_import_identifier => |ident| ident.ref,
                        .e_dot => |dot| if (dot.target.data == .e_identifier)
                            dot.target.data.e_identifier.ref
                        else
                            null,
                        else => null,
                    };

                    break :brk possible_macro_ref != null and p.macro.refs.contains(possible_macro_ref.?);
                } else false;

                {
                    const old_ce = p.options.ignore_dce_annotations;
                    defer p.options.ignore_dce_annotations = old_ce;
                    const old_should_fold_typescript_constant_expressions = p.should_fold_typescript_constant_expressions;
                    defer p.should_fold_typescript_constant_expressions = old_should_fold_typescript_constant_expressions;
                    const old_is_control_flow_dead = p.is_control_flow_dead;

                    // We want to forcefully fold constants inside of
                    // certain calls even when minification is disabled, so
                    // that if we have an import based on a string template,
                    // it does not cause a bundle error. This is relevant for
                    // macros, as they require constant known values, but also
                    // for `require` and `require.resolve`, as they go through
                    // the module resolver.
                    if (is_macro_ref or
                        e_.target.data == .e_require_call_target or
                        e_.target.data == .e_require_resolve_call_target)
                    {
                        p.options.ignore_dce_annotations = true;
                        p.should_fold_typescript_constant_expressions = true;
                    }

                    // When a value is targeted by `--drop`, it will be removed.
                    // The HMR APIs in `import.meta.hot` are implicitly dropped when HMR is disabled.
                    var method_call_should_be_replaced_with_undefined = p.method_call_must_be_replaced_with_undefined;
                    if (method_call_should_be_replaced_with_undefined) {
                        p.method_call_must_be_replaced_with_undefined = false;
                        switch (e_.target.data) {
                            // If we're removing this call, don't count any arguments as symbol uses
                            .e_index, .e_dot, .e_identifier => {
                                p.is_control_flow_dead = true;
                            },
                            // Special case from `import.meta.hot.*` functions.
                            .e_undefined => {
                                p.is_control_flow_dead = true;
                            },
                            else => {
                                method_call_should_be_replaced_with_undefined = false;
                            },
                        }
                    }

                    for (e_.args.slice()) |*arg| {
                        arg.* = p.visitExpr(arg.*);
                    }

                    if (method_call_should_be_replaced_with_undefined) {
                        p.is_control_flow_dead = old_is_control_flow_dead;
                        return .{ .data = .{ .e_undefined = .{} }, .loc = expr.loc };
                    }
                }

                // Handle `feature("FLAG_NAME")` calls from `import { feature } from "bun:bundle"`
                // Check if the bundler_feature_flag_ref is set before calling the function
                // to avoid stack memory usage from copying values back and forth.
                if (p.bundler_feature_flag_ref.isValid()) {
                    if (maybeReplaceBundlerFeatureCall(p, e_, expr.loc)) |result| {
                        return result;
                    }
                }

                if (e_.target.data == .e_require_call_target) {
                    e_.can_be_unwrapped_if_unused = .never;

                    // Heuristic: omit warnings inside try/catch blocks because presumably
                    // the try/catch statement is there to handle the potential run-time
                    // error from the unbundled require() call failing.
                    if (e_.args.len == 1) {
                        const first = e_.args.slice()[0];
                        const state = TransposeState{
                            .is_require_immediately_assigned_to_decl = in.is_immediately_assigned_to_decl and
                                first.data == .e_string,
                        };
                        switch (first.data) {
                            .e_string => {
                                // require(FOO) => require(FOO)
                                return p.transposeRequire(first, &state);
                            },
                            .e_if => {
                                // require(FOO  ? '123' : '456') => FOO ? require('123') : require('456')
                                // This makes static analysis later easier
                                return p.require_transposer.transposeKnownToBeIf(first, &state);
                            },
                            else => {},
                        }
                    }

                    // Ignore calls to require() if the control flow is provably
                    // dead here. We don't want to spend time scanning the required files
                    // if they will never be used.
                    if (p.is_control_flow_dead) {
                        return p.newExpr(E.Null{}, expr.loc);
                    }

                    if (p.options.warn_about_unbundled_modules) {
                        const r = js_lexer.rangeOfIdentifier(p.source, e_.target.loc);
                        p.log.addRangeDebug(p.source, r, "This call to \"require\" will not be bundled because it has multiple arguments") catch unreachable;
                    }

                    if (p.options.features.allow_runtime) {
                        p.recordUsageOfRuntimeRequire();
                    }

                    return expr;
                } else if (e_.target.data == .e_require_resolve_call_target) {
                    // Ignore calls to require.resolve() if the control flow is provably
                    // dead here. We don't want to spend time scanning the required files
                    // if they will never be used.
                    if (p.is_control_flow_dead) {
                        return p.newExpr(E.Null{}, expr.loc);
                    }

                    if (e_.args.len == 1) {
                        const first = e_.args.slice()[0];
                        switch (first.data) {
                            .e_string => {
                                // require.resolve(FOO) => require.resolve(FOO)
                                // (this will register dependencies)
                                return p.transposeRequireResolveKnownString(first);
                            },
                            .e_if => {
                                // require.resolve(FOO  ? '123' : '456')
                                //  =>
                                // FOO ? require.resolve('123') : require.resolve('456')
                                // This makes static analysis later easier
                                return p.require_resolve_transposer.transposeKnownToBeIf(first, e_.target);
                            },
                            else => {},
                        }
                    }

                    return expr;
                } else if (e_.target.data.as(.e_special)) |special|
                    switch (special) {
                        .hot_accept => {
                            p.handleImportMetaHotAcceptCall(e_);
                            // After validating that the import.meta.hot
                            // code is correct, discard the entire
                            // expression in production.
                            if (!p.options.features.hot_module_reloading)
                                return .{ .data = .e_undefined, .loc = expr.loc };
                        },
                        else => {},
                    };

                if (comptime allow_macros) {
                    if (is_macro_ref and !p.options.features.is_macro_runtime) {
                        const ref = switch (e_.target.data) {
                            .e_import_identifier => |ident| ident.ref,
                            .e_dot => |dot| dot.target.data.e_identifier.ref,
                            else => unreachable,
                        };

                        const macro_ref_data = p.macro.refs.get(ref).?;
                        p.ignoreUsage(ref);
                        if (p.is_control_flow_dead) {
                            return p.newExpr(E.Undefined{}, e_.target.loc);
                        }

                        if (p.options.features.no_macros) {
                            p.log.addError(p.source, expr.loc, "Macros are disabled") catch unreachable;
                            return p.newExpr(E.Undefined{}, expr.loc);
                        }

                        if (p.source.path.isNodeModule()) {
                            p.log.addError(p.source, expr.loc, "For security reasons, macros cannot be run from node_modules.") catch unreachable;
                            return p.newExpr(E.Undefined{}, expr.loc);
                        }

                        const name = macro_ref_data.name orelse e_.target.data.e_dot.name;
                        const record = &p.import_records.items[macro_ref_data.import_record_id];
                        const copied = Expr{ .loc = expr.loc, .data = .{ .e_call = e_ } };
                        const start_error_count = p.log.msgs.items.len;
                        p.macro_call_count += 1;
                        const macro_result = p.options.macro_context.call(
                            record.path.text,
                            p.source.path.sourceDir(),
                            p.log,
                            p.source,
                            record.range,
                            copied,
                            name,
                        ) catch |err| {
                            if (err == error.MacroFailed) {
                                if (p.log.msgs.items.len == start_error_count) {
                                    p.log.addError(p.source, expr.loc, "macro threw exception") catch unreachable;
                                }
                            } else {
                                p.log.addErrorFmt(p.source, expr.loc, p.allocator, "\"{s}\" error in macro", .{@errorName(err)}) catch unreachable;
                            }
                            return expr;
                        };

                        if (macro_result.data != .e_call) {
                            return p.visitExpr(macro_result);
                        }
                    }
                }

                // In fast refresh, any function call that looks like a hook (/^use[A-Z]/) is a
                // hook, even if it is not the value of `SExpr` or `SLocal`. It can be anywhere
                // in the function call. This makes sense for some weird situations with `useCallback`,
                // where it is not assigned to a variable.
                //
                // When we see a hook call, we need to hash it, and then mark a flag so that if
                // it is assigned to a variable, that variable also get's hashed.
                if (p.options.features.react_fast_refresh or p.options.features.server_components.isServerSide()) try_record_hook: {
                    const original_name = switch (e_.target.data) {
                        inline .e_identifier,
                        .e_import_identifier,
                        .e_commonjs_export_identifier,
                        => |id| p.symbols.items[id.ref.innerIndex()].original_name,
                        .e_dot => |dot| dot.name,
                        else => break :try_record_hook,
                    };
                    if (!ReactRefresh.isHookName(original_name)) break :try_record_hook;
                    if (p.options.features.react_fast_refresh) {
                        p.handleReactRefreshHookCall(e_, original_name);
                    } else if (
                    // If we're here it means we're in server component.
                    // Error if the user is using the `useState` hook as it
                    // is disallowed in server components.
                    //
                    // We're also specifically checking that the target is
                    // `.e_import_identifier`.
                    //
                    // Why? Because we *don't* want to check for uses of
                    // `useState` _inside_ React, and we know React uses
                    // commonjs so it will never be `.e_import_identifier`.
                    check_for_usestate: {
                        if (e_.target.data == .e_import_identifier) break :check_for_usestate true;
                        // Also check for `React.useState(...)`
                        if (e_.target.data == .e_dot and e_.target.data.e_dot.target.data == .e_import_identifier) {
                            const id = e_.target.data.e_dot.target.data.e_import_identifier;
                            const name = p.symbols.items[id.ref.innerIndex()].original_name;
                            break :check_for_usestate bun.strings.eqlComptime(name, "React");
                        }
                        break :check_for_usestate false;
                    }) {
                        bun.assert(p.options.features.server_components.isServerSide());
                        if (!bun.strings.startsWith(p.source.path.pretty, "node_modules") and
                            bun.strings.eqlComptime(original_name, "useState"))
                        {
                            p.log.addError(
                                p.source,
                                expr.loc,
                                std.fmt.allocPrint(
                                    p.allocator,
                                    "\"useState\" is not available in a server component. If you need interactivity, consider converting part of this to a Client Component (by adding `\"use client\";` to the top of the file).",
                                    .{},
                                ) catch |err| bun.handleOom(err),
                            ) catch |err| bun.handleOom(err);
                        }
                    }
                }

                // Implement constant folding for 'string'.charCodeAt(n)
                if (e_.args.len == 1) if (e_.target.data.as(.e_dot)) |dot| {
                    if (dot.target.data == .e_string and
                        dot.target.data.e_string.isUTF8() and
                        bun.strings.eqlComptime(dot.name, "charCodeAt"))
                    {
                        const str = dot.target.data.e_string.data;
                        const arg1 = e_.args.at(0).unwrapInlined();
                        if (arg1.data == .e_number) {
                            const float = arg1.data.e_number.value;
                            if (@mod(float, 1) == 0 and
                                float < @as(f64, @floatFromInt(str.len)) and
                                float >= 0)
                            {
                                const char = str[@intFromFloat(float)];
                                if (char < 0x80) {
                                    return p.newExpr(E.Number{
                                        .value = @floatFromInt(char),
                                    }, expr.loc);
                                }
                            }
                        }
                    }
                };

                return expr;
            }
            pub fn e_new(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_new;
                e_.target = p.visitExpr(e_.target);

                for (e_.args.slice()) |*arg| {
                    arg.* = p.visitExpr(arg.*);
                }

                if (p.options.features.minify_syntax) {
                    if (KnownGlobal.minifyGlobalConstructor(p.allocator, e_, p.symbols.items, expr.loc, p.options.features.minify_whitespace)) |minified| {
                        return minified;
                    }
                }
                return expr;
            }
            pub fn e_arrow(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_arrow;
                if (p.is_revisit_for_substitution) {
                    return expr;
                }

                const old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_visit);
                p.fn_or_arrow_data_visit = FnOrArrowDataVisit{
                    .is_arrow = true,
                    .is_async = e_.is_async,
                };

                // Mark if we're inside an async arrow function. This value should be true
                // even if we're inside multiple arrow functions and the closest inclosing
                // arrow function isn't async, as long as at least one enclosing arrow
                // function within the current enclosing function is async.
                const old_inside_async_arrow_fn = p.fn_only_data_visit.is_inside_async_arrow_fn;
                p.fn_only_data_visit.is_inside_async_arrow_fn = e_.is_async or p.fn_only_data_visit.is_inside_async_arrow_fn;

                p.pushScopeForVisitPass(.function_args, expr.loc) catch unreachable;
                const dupe = p.allocator.dupe(Stmt, e_.body.stmts) catch unreachable;

                p.visitArgs(e_.args, VisitArgsOpts{
                    .has_rest_arg = e_.has_rest_arg,
                    .body = dupe,
                    .is_unique_formal_parameters = true,
                });
                p.pushScopeForVisitPass(.function_body, e_.body.loc) catch unreachable;

                var react_hook_data: ?ReactRefresh.HookContext = null;
                const prev = p.react_refresh.hook_ctx_storage;
                defer p.react_refresh.hook_ctx_storage = prev;
                p.react_refresh.hook_ctx_storage = &react_hook_data;

                var stmts_list = ListManaged(Stmt).fromOwnedSlice(p.allocator, dupe);
                var temp_opts = PrependTempRefsOpts{ .kind = .fn_body };
                p.visitStmtsAndPrependTempRefs(&stmts_list, &temp_opts) catch unreachable;
                p.allocator.free(e_.body.stmts);
                e_.body.stmts = stmts_list.items;
                p.popScope();
                p.popScope();

                p.fn_only_data_visit.is_inside_async_arrow_fn = old_inside_async_arrow_fn;
                p.fn_or_arrow_data_visit = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_visit), &old_fn_or_arrow_data);

                if (react_hook_data) |*hook| try_mark_hook: {
                    const stmts = p.nearest_stmt_list orelse break :try_mark_hook;
                    bun.handleOom(stmts.append(p.getReactRefreshHookSignalDecl(hook.signature_cb)));

                    p.handleReactRefreshPostVisitFunctionBody(&stmts_list, hook);
                    e_.body.stmts = stmts_list.items;

                    return p.getReactRefreshHookSignalInit(hook, expr);
                }
                return expr;
            }
            pub fn e_function(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_function;
                if (p.is_revisit_for_substitution) {
                    return expr;
                }

                var react_hook_data: ?ReactRefresh.HookContext = null;
                const prev = p.react_refresh.hook_ctx_storage;
                defer p.react_refresh.hook_ctx_storage = prev;
                p.react_refresh.hook_ctx_storage = &react_hook_data;

                e_.func = p.visitFunc(e_.func, expr.loc);

                // Remove unused function names when minifying (only when bundling is enabled)
                // unless --keep-names is specified
                if (p.options.features.minify_syntax and p.options.bundle and
                    !p.options.features.minify_keep_names and
                    !p.current_scope.contains_direct_eval and
                    e_.func.name != null and
                    e_.func.name.?.ref != null and
                    p.symbols.items[e_.func.name.?.ref.?.innerIndex()].use_count_estimate == 0)
                {
                    e_.func.name = null;
                }

                var final_expr = expr;

                if (react_hook_data) |*hook| try_mark_hook: {
                    const stmts = p.nearest_stmt_list orelse break :try_mark_hook;
                    bun.handleOom(stmts.append(p.getReactRefreshHookSignalDecl(hook.signature_cb)));
                    final_expr = p.getReactRefreshHookSignalInit(hook, expr);
                }

                if (e_.func.name) |name| {
                    final_expr = p.keepExprSymbolName(final_expr, p.symbols.items[name.ref.?.innerIndex()].original_name);
                }

                return final_expr;
            }
            pub fn e_class(p: *P, expr: Expr, _: ExprIn) Expr {
                const e_ = expr.data.e_class;
                if (p.is_revisit_for_substitution) {
                    return expr;
                }

                _ = p.visitClass(expr.loc, e_, Ref.None);

                // Remove unused class names when minifying (only when bundling is enabled)
                // unless --keep-names is specified
                if (p.options.features.minify_syntax and p.options.bundle and
                    !p.options.features.minify_keep_names and
                    !p.current_scope.contains_direct_eval and
                    e_.class_name != null and
                    e_.class_name.?.ref != null and
                    p.symbols.items[e_.class_name.?.ref.?.innerIndex()].use_count_estimate == 0)
                {
                    e_.class_name = null;
                }

                return expr;
            }

            /// Handles `feature("FLAG_NAME")` calls from `import { feature } from "bun:bundle"`.
            /// This enables statically analyzable dead-code elimination through feature gating.
            ///
            /// When a feature flag is enabled via `--feature=FLAG_NAME`, `feature("FLAG_NAME")`
            /// is replaced with `true`, otherwise it's replaced with `false`. This allows
            /// bundlers to eliminate dead code branches at build time.
            ///
            /// Returns the replacement expression if this is a feature() call, or null otherwise.
            /// Note: Caller must check `p.bundler_feature_flag_ref.isValid()` before calling.
            fn maybeReplaceBundlerFeatureCall(p: *P, e_: *E.Call, loc: logger.Loc) ?Expr {
                // Check if the target is the `feature` function from "bun:bundle"
                // It could be e_identifier (for unbound) or e_import_identifier (for imports)
                const target_ref: ?Ref = switch (e_.target.data) {
                    .e_identifier => |ident| ident.ref,
                    .e_import_identifier => |ident| ident.ref,
                    else => null,
                };

                if (target_ref == null or !target_ref.?.eql(p.bundler_feature_flag_ref)) {
                    return null;
                }

                // If control flow is dead, just return false without validation errors
                if (p.is_control_flow_dead) {
                    return p.newExpr(E.Boolean{ .value = false }, loc);
                }

                // Validate: exactly one argument required
                if (e_.args.len != 1) {
                    p.log.addError(p.source, loc, "feature() requires exactly one string argument") catch unreachable;
                    return p.newExpr(E.Boolean{ .value = false }, loc);
                }

                const arg = e_.args.slice()[0];

                // Validate: argument must be a string literal
                if (arg.data != .e_string) {
                    p.log.addError(p.source, arg.loc, "feature() argument must be a string literal") catch unreachable;
                    return p.newExpr(E.Boolean{ .value = false }, loc);
                }

                // Check if the feature flag is enabled
                // Use the underlying string data directly without allocation.
                // Feature flag names should be ASCII identifiers, so UTF-16 is unexpected.
                const flag_string = arg.data.e_string;
                if (flag_string.is_utf16) {
                    p.log.addError(p.source, arg.loc, "feature() flag name must be an ASCII string") catch unreachable;
                    return p.newExpr(E.Boolean{ .value = false }, loc);
                }

                // feature() can only be used directly in an if statement or ternary condition
                if (!p.in_branch_condition) {
                    p.log.addError(p.source, loc, "feature() from \"bun:bundle\" can only be used directly in an if statement or ternary condition") catch unreachable;
                    return p.newExpr(E.Boolean{ .value = false }, loc);
                }

                const is_enabled = p.options.features.bundler_feature_flags.map.contains(flag_string.data);
                return .{ .data = .{ .e_branch_boolean = .{ .value = is_enabled } }, .loc = loc };
            }
        };
    };
}

var jsxChildrenKeyData = Expr.Data{ .e_string = &Prefill.String.Children };

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
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const Scope = js_ast.Scope;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Property = G.Property;

const js_parser = bun.js_parser;
const ExprIn = js_parser.ExprIn;
const FnOrArrowDataVisit = js_parser.FnOrArrowDataVisit;
const IdentifierOpts = js_parser.IdentifierOpts;
const JSXTransformType = js_parser.JSXTransformType;
const KnownGlobal = js_parser.KnownGlobal;
const Prefill = js_parser.Prefill;
const PrependTempRefsOpts = js_parser.PrependTempRefsOpts;
const ReactRefresh = js_parser.ReactRefresh;
const Ref = js_parser.Ref;
const SideEffects = js_parser.SideEffects;
const ThenCatchChain = js_parser.ThenCatchChain;
const TransposeState = js_parser.TransposeState;
const VisitArgsOpts = js_parser.VisitArgsOpts;
const floatToInt32 = js_parser.floatToInt32;
const options = js_parser.options;

const std = @import("std");
const List = std.ArrayListUnmanaged;
const ListManaged = std.array_list.Managed;
