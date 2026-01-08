pub fn AstMaybe(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);

        pub fn maybeRelocateVarsToTopLevel(p: *P, decls: []const G.Decl, mode: RelocateVars.Mode) RelocateVars {
            // Only do this when the scope is not already top-level and when we're not inside a function.
            if (p.current_scope == p.module_scope) {
                return .{ .ok = false };
            }

            var scope = p.current_scope;
            while (!scope.kindStopsHoisting()) {
                if (comptime Environment.allow_assert) assert(scope.parent != null);
                scope = scope.parent.?;
            }

            if (scope != p.module_scope) {
                return .{ .ok = false };
            }

            var value: Expr = Expr{ .loc = logger.Loc.Empty, .data = Expr.Data{ .e_missing = E.Missing{} } };

            for (decls) |decl| {
                const binding = Binding.toExpr(
                    &decl.binding,
                    p.to_expr_wrapper_hoisted,
                );
                if (decl.value) |decl_value| {
                    value = value.joinWithComma(Expr.assign(binding, decl_value), p.allocator);
                } else if (mode == .for_in_or_for_of) {
                    value = value.joinWithComma(binding, p.allocator);
                }
            }

            if (value.data == .e_missing) {
                return .{ .ok = true };
            }

            return .{ .stmt = p.s(S.SExpr{ .value = value }, value.loc), .ok = true };
        }

        // EDot nodes represent a property access. This function may return an
        // expression to replace the property access with. It assumes that the
        // target of the EDot expression has already been visited.
        pub fn maybeRewritePropertyAccess(
            p: *P,
            loc: logger.Loc,
            target: js_ast.Expr,
            name: string,
            name_loc: logger.Loc,
            identifier_opts: IdentifierOpts,
        ) ?Expr {
            sw: switch (target.data) {
                .e_identifier => |id| {
                    // Rewrite property accesses on explicit namespace imports as an identifier.
                    // This lets us replace them easily in the printer to rebind them to
                    // something else without paying the cost of a whole-tree traversal during
                    // module linking just to rewrite these EDot expressions.
                    if (p.options.bundle) {
                        if (p.import_items_for_namespace.getPtr(id.ref)) |import_items| {
                            const ref = (import_items.get(name) orelse brk: {
                                // Generate a new import item symbol in the module scope
                                const new_item = LocRef{
                                    .loc = name_loc,
                                    .ref = p.newSymbol(.import, name) catch unreachable,
                                };
                                bun.handleOom(p.module_scope.generated.append(p.allocator, new_item.ref.?));

                                import_items.put(name, new_item) catch unreachable;
                                p.is_import_item.put(p.allocator, new_item.ref.?, {}) catch unreachable;

                                var symbol = &p.symbols.items[new_item.ref.?.innerIndex()];

                                // Mark this as generated in case it's missing. We don't want to
                                // generate errors for missing import items that are automatically
                                // generated.
                                symbol.import_item_status = .generated;

                                break :brk new_item;
                            }).ref.?;

                            // Undo the usage count for the namespace itself. This is used later
                            // to detect whether the namespace symbol has ever been "captured"
                            // or whether it has just been used to read properties off of.
                            //
                            // The benefit of doing this is that if both this module and the
                            // imported module end up in the same module group and the namespace
                            // symbol has never been captured, then we don't need to generate
                            // any code for the namespace at all.
                            p.ignoreUsage(id.ref);

                            // Track how many times we've referenced this symbol
                            p.recordUsage(ref);

                            return p.handleIdentifier(
                                name_loc,
                                E.Identifier{ .ref = ref },
                                name,
                                .{
                                    .assign_target = identifier_opts.assign_target,
                                    .is_call_target = identifier_opts.is_call_target,
                                    .is_delete_target = identifier_opts.is_delete_target,

                                    // If this expression is used as the target of a call expression, make
                                    // sure the value of "this" is preserved.
                                    .was_originally_identifier = false,
                                },
                            );
                        }
                    }

                    if (!p.is_control_flow_dead and id.ref.eql(p.module_ref)) {
                        // Rewrite "module.require()" to "require()" for Webpack compatibility.
                        // See https://github.com/webpack/webpack/pull/7750 for more info.
                        // This also makes correctness a little easier.
                        if (identifier_opts.is_call_target and strings.eqlComptime(name, "require")) {
                            p.ignoreUsage(p.module_ref);
                            return p.valueForRequire(name_loc);
                        } else if (!p.commonjs_named_exports_deoptimized and strings.eqlComptime(name, "exports")) {
                            if (identifier_opts.assign_target != .none) {
                                p.commonjs_module_exports_assigned_deoptimized = true;
                            }

                            // Detect if we are doing
                            //
                            //  module.exports = {
                            //    foo: "bar"
                            //  }
                            //
                            //  Note that it cannot be any of these:
                            //
                            //  module.exports += { };
                            //  delete module.exports = {};
                            //  module.exports()
                            if (!(identifier_opts.is_call_target or identifier_opts.is_delete_target) and
                                identifier_opts.assign_target == .replace and
                                p.stmt_expr_value == .e_binary and
                                p.stmt_expr_value.e_binary.op == .bin_assign)
                            {
                                if (
                                // if it's not top-level, don't do this
                                p.module_scope != p.current_scope or
                                    // if you do
                                    //
                                    // exports.foo = 123;
                                    // module.exports = {};
                                    //
                                    // that's a de-opt.
                                    p.commonjs_named_exports.count() > 0 or

                                    // anything which is not module.exports = {} is a de-opt.
                                    p.stmt_expr_value.e_binary.right.data != .e_object or
                                    p.stmt_expr_value.e_binary.left.data != .e_dot or
                                    !strings.eqlComptime(p.stmt_expr_value.e_binary.left.data.e_dot.name, "exports") or
                                    p.stmt_expr_value.e_binary.left.data.e_dot.target.data != .e_identifier or
                                    !p.stmt_expr_value.e_binary.left.data.e_dot.target.data.e_identifier.ref.eql(p.module_ref))
                                {
                                    p.deoptimizeCommonJSNamedExports();
                                    return null;
                                }

                                const props: []const G.Property = p.stmt_expr_value.e_binary.right.data.e_object.properties.slice();
                                for (props) |prop| {
                                    // if it's not a trivial object literal, de-opt
                                    if (prop.kind != .normal or
                                        prop.key == null or
                                        prop.key.?.data != .e_string or
                                        prop.flags.contains(Flags.Property.is_method) or
                                        prop.flags.contains(Flags.Property.is_computed) or
                                        prop.flags.contains(Flags.Property.is_spread) or
                                        prop.flags.contains(Flags.Property.is_static) or
                                        // If it creates a new scope, we can't do this optimization right now
                                        // Our scope order verification stuff will get mad
                                        // But we should let you do module.exports = { bar: foo(), baz: 123 }
                                        // just not module.exports = { bar: function() {}  }
                                        // just not module.exports = { bar() {}  }
                                        switch (prop.value.?.data) {
                                            .e_commonjs_export_identifier, .e_import_identifier, .e_identifier => false,
                                            .e_call => |call| switch (call.target.data) {
                                                .e_commonjs_export_identifier, .e_import_identifier, .e_identifier => false,
                                                else => |call_target| !@as(Expr.Tag, call_target).isPrimitiveLiteral(),
                                            },
                                            else => !prop.value.?.isPrimitiveLiteral(),
                                        })
                                    {
                                        p.deoptimizeCommonJSNamedExports();
                                        return null;
                                    }
                                } else {
                                    // empty object de-opts because otherwise the statement becomes
                                    // <empty space> = {};
                                    p.deoptimizeCommonJSNamedExports();
                                    return null;
                                }

                                var stmts = std.array_list.Managed(Stmt).initCapacity(p.allocator, props.len * 2) catch unreachable;
                                var decls = p.allocator.alloc(Decl, props.len) catch unreachable;
                                var clause_items = p.allocator.alloc(js_ast.ClauseItem, props.len) catch unreachable;

                                for (props) |prop| {
                                    const key = prop.key.?.data.e_string.string(p.allocator) catch unreachable;
                                    const visited_value = p.visitExpr(prop.value.?);
                                    const value = SideEffects.simplifyUnusedExpr(p, visited_value) orelse visited_value;

                                    // We are doing `module.exports = { ... }`
                                    // lets rewrite it to a series of what will become export assignments
                                    const named_export_entry = p.commonjs_named_exports.getOrPut(p.allocator, key) catch unreachable;
                                    if (!named_export_entry.found_existing) {
                                        const new_ref = p.newSymbol(
                                            .other,
                                            std.fmt.allocPrint(p.allocator, "${f}", .{bun.fmt.fmtIdentifier(key)}) catch unreachable,
                                        ) catch unreachable;
                                        bun.handleOom(p.module_scope.generated.append(p.allocator, new_ref));
                                        named_export_entry.value_ptr.* = .{
                                            .loc_ref = LocRef{
                                                .loc = name_loc,
                                                .ref = new_ref,
                                            },
                                            .needs_decl = false,
                                        };
                                    }
                                    const ref = named_export_entry.value_ptr.loc_ref.ref.?;
                                    // module.exports = {
                                    //   foo: "bar",
                                    //   baz: "qux",
                                    // }
                                    // ->
                                    // exports.foo = "bar", exports.baz = "qux"
                                    // Which will become
                                    // $foo = "bar";
                                    // $baz = "qux";
                                    // export { $foo as foo, $baz as baz }

                                    decls[0] = .{
                                        .binding = p.b(B.Identifier{ .ref = ref }, prop.key.?.loc),
                                        .value = value,
                                    };
                                    // we have to ensure these are known to be top-level
                                    p.declared_symbols.append(p.allocator, .{
                                        .ref = ref,
                                        .is_top_level = true,
                                    }) catch unreachable;
                                    p.had_commonjs_named_exports_this_visit = true;
                                    clause_items[0] = js_ast.ClauseItem{
                                        // We want the generated name to not conflict
                                        .alias = key,
                                        .alias_loc = prop.key.?.loc,
                                        .name = named_export_entry.value_ptr.loc_ref,
                                    };

                                    stmts.appendSlice(
                                        &[_]Stmt{
                                            p.s(
                                                S.Local{
                                                    .kind = .k_var,
                                                    .is_export = false,
                                                    .was_commonjs_export = true,
                                                    .decls = G.Decl.List.init(decls[0..1]),
                                                },
                                                prop.key.?.loc,
                                            ),
                                            p.s(
                                                S.ExportClause{
                                                    .items = clause_items[0..1],
                                                    .is_single_line = true,
                                                },
                                                prop.key.?.loc,
                                            ),
                                        },
                                    ) catch unreachable;
                                    decls = decls[1..];
                                    clause_items = clause_items[1..];
                                }

                                p.ignoreUsage(p.module_ref);
                                p.commonjs_replacement_stmts = stmts.items;
                                return p.newExpr(E.Missing{}, name_loc);
                            }

                            // Deoptimizations:
                            //      delete module.exports
                            //      module.exports();
                            if (identifier_opts.is_call_target or identifier_opts.is_delete_target or identifier_opts.assign_target != .none) {
                                p.deoptimizeCommonJSNamedExports();
                                return null;
                            }

                            // rewrite `module.exports` to `exports`
                            return .{ .data = .{ .e_special = .module_exports }, .loc = name_loc };
                        } else if (p.options.bundle and strings.eqlComptime(name, "id") and identifier_opts.assign_target == .none) {
                            // inline module.id
                            p.ignoreUsage(p.module_ref);
                            return p.newExpr(E.String.init(p.source.path.pretty), name_loc);
                        } else if (p.options.bundle and strings.eqlComptime(name, "filename") and identifier_opts.assign_target == .none) {
                            // inline module.filename
                            p.ignoreUsage(p.module_ref);
                            return p.newExpr(E.String.init(p.source.path.name.filename), name_loc);
                        } else if (p.options.bundle and strings.eqlComptime(name, "path") and identifier_opts.assign_target == .none) {
                            // inline module.path
                            p.ignoreUsage(p.module_ref);
                            return p.newExpr(E.String.init(p.source.path.pretty), name_loc);
                        }
                    }

                    if (p.shouldUnwrapCommonJSToESM()) {
                        if (!p.is_control_flow_dead and id.ref.eql(p.exports_ref)) {
                            if (!p.commonjs_named_exports_deoptimized) {
                                if (identifier_opts.is_delete_target) {
                                    p.deoptimizeCommonJSNamedExports();
                                    return null;
                                }

                                const named_export_entry = p.commonjs_named_exports.getOrPut(p.allocator, name) catch unreachable;
                                if (!named_export_entry.found_existing) {
                                    const new_ref = p.newSymbol(
                                        .other,
                                        std.fmt.allocPrint(p.allocator, "${f}", .{bun.fmt.fmtIdentifier(name)}) catch unreachable,
                                    ) catch unreachable;
                                    bun.handleOom(p.module_scope.generated.append(p.allocator, new_ref));
                                    named_export_entry.value_ptr.* = .{
                                        .loc_ref = LocRef{
                                            .loc = name_loc,
                                            .ref = new_ref,
                                        },
                                        .needs_decl = true,
                                    };
                                    if (p.commonjs_named_exports_needs_conversion == std.math.maxInt(u32))
                                        p.commonjs_named_exports_needs_conversion = @as(u32, @truncate(p.commonjs_named_exports.count() - 1));
                                }

                                const ref = named_export_entry.value_ptr.*.loc_ref.ref.?;
                                p.ignoreUsage(id.ref);
                                p.recordUsage(ref);

                                return p.newExpr(
                                    E.CommonJSExportIdentifier{
                                        .ref = ref,
                                    },
                                    name_loc,
                                );
                            } else if (p.options.features.commonjs_at_runtime and identifier_opts.assign_target != .none) {
                                p.has_commonjs_export_names = true;
                            }
                        }
                    }

                    // Handle references to namespaces or namespace members
                    if (p.ts_namespace.expr == .e_identifier and
                        id.ref.eql(p.ts_namespace.expr.e_identifier.ref) and
                        identifier_opts.assign_target == .none and
                        !identifier_opts.is_delete_target)
                    {
                        return maybeRewritePropertyAccessForNamespace(p, name, &target, loc, name_loc);
                    }
                },
                .e_string => |str| {
                    if (p.options.features.minify_syntax) {
                        // minify "long-string".length to 11
                        if (strings.eqlComptime(name, "length")) {
                            if (str.javascriptLength()) |len| {
                                return p.newExpr(E.Number{ .value = @floatFromInt(len) }, loc);
                            }
                        }
                    }
                },
                .e_inlined_enum => |ie| {
                    continue :sw ie.value.data;
                },
                .e_object => |obj| {
                    if (comptime FeatureFlags.inline_properties_in_transpiler) {
                        if (p.options.features.minify_syntax) {
                            // Rewrite a property access like this:
                            //   { f: () => {} }.f
                            // To:
                            //   () => {}
                            //
                            // To avoid thinking too much about edgecases, only do this for:
                            //   1) Objects with a single property
                            //   2) Not a method, not a computed property
                            if (obj.properties.len == 1 and
                                !identifier_opts.is_delete_target and
                                identifier_opts.assign_target == .none and !identifier_opts.is_call_target)
                            {
                                const prop: G.Property = obj.properties.ptr[0];
                                if (prop.value != null and
                                    prop.flags.count() == 0 and
                                    prop.key != null and
                                    prop.key.?.data == .e_string and
                                    prop.key.?.data.e_string.eql([]const u8, name) and
                                    !bun.strings.eqlComptime(name, "__proto__"))
                                {
                                    return prop.value.?;
                                }
                            }
                        }
                    }
                },
                .e_import_meta => {
                    if (strings.eqlComptime(name, "main")) {
                        return p.valueForImportMetaMain(false, target.loc);
                    }

                    if (strings.eqlComptime(name, "hot")) {
                        return .{ .data = .{
                            .e_special = if (p.options.features.hot_module_reloading) .hot_enabled else .hot_disabled,
                        }, .loc = loc };
                    }

                    // Inline import.meta properties for Bake
                    if (p.options.framework != null or (p.options.bundle and p.options.output_format == .cjs)) {
                        if (strings.eqlComptime(name, "dir") or strings.eqlComptime(name, "dirname")) {
                            // Inline import.meta.dir
                            return p.newExpr(E.String.init(p.source.path.name.dir), name_loc);
                        } else if (strings.eqlComptime(name, "file")) {
                            // Inline import.meta.file (filename only)
                            return p.newExpr(E.String.init(p.source.path.name.filename), name_loc);
                        } else if (strings.eqlComptime(name, "path")) {
                            // Inline import.meta.path (full path)
                            return p.newExpr(E.String.init(p.source.path.text), name_loc);
                        } else if (strings.eqlComptime(name, "url")) {
                            // Inline import.meta.url as file:// URL
                            const bunstr = bun.String.fromBytes(p.source.path.text);
                            defer bunstr.deref();
                            const url = std.fmt.allocPrint(p.allocator, "{f}", .{jsc.URL.fileURLFromString(bunstr)}) catch unreachable;
                            return p.newExpr(E.String.init(url), name_loc);
                        }
                    }

                    // Make all property accesses on `import.meta.url` side effect free.
                    return p.newExpr(
                        E.Dot{
                            .target = target,
                            .name = name,
                            .name_loc = name_loc,
                            .can_be_removed_if_unused = true,
                        },
                        target.loc,
                    );
                },
                .e_require_call_target => {
                    if (strings.eqlComptime(name, "main")) {
                        return .{ .loc = loc, .data = .e_require_main };
                    }
                },
                .e_import_identifier => |id| {
                    // Symbol uses due to a property access off of an imported symbol are tracked
                    // specially. This lets us do tree shaking for cross-file TypeScript enums.
                    if (p.options.bundle and !p.is_control_flow_dead) {
                        const use = p.symbol_uses.getPtr(id.ref).?;
                        use.count_estimate -|= 1;
                        // note: this use is not removed as we assume it exists later

                        // Add a special symbol use instead
                        const gop = p.import_symbol_property_uses.getOrPutValue(
                            p.allocator,
                            id.ref,
                            .{},
                        ) catch |err| bun.handleOom(err);
                        const inner_use = gop.value_ptr.getOrPutValue(
                            p.allocator,
                            name,
                            .{},
                        ) catch |err| bun.handleOom(err);
                        inner_use.value_ptr.count_estimate += 1;
                    }
                },
                inline .e_dot, .e_index => |data, tag| {
                    if (p.ts_namespace.expr == tag and
                        data == @field(p.ts_namespace.expr, @tagName(tag)) and
                        identifier_opts.assign_target == .none and
                        !identifier_opts.is_delete_target)
                    {
                        return maybeRewritePropertyAccessForNamespace(p, name, &target, loc, name_loc);
                    }
                },
                .e_special => |special| switch (special) {
                    .module_exports => {
                        if (p.shouldUnwrapCommonJSToESM()) {
                            if (!p.is_control_flow_dead) {
                                if (!p.commonjs_named_exports_deoptimized) {
                                    if (identifier_opts.is_delete_target) {
                                        p.deoptimizeCommonJSNamedExports();
                                        return null;
                                    }

                                    const named_export_entry = p.commonjs_named_exports.getOrPut(p.allocator, name) catch unreachable;
                                    if (!named_export_entry.found_existing) {
                                        const new_ref = p.newSymbol(
                                            .other,
                                            std.fmt.allocPrint(p.allocator, "${f}", .{bun.fmt.fmtIdentifier(name)}) catch unreachable,
                                        ) catch unreachable;
                                        bun.handleOom(p.module_scope.generated.append(p.allocator, new_ref));
                                        named_export_entry.value_ptr.* = .{
                                            .loc_ref = LocRef{
                                                .loc = name_loc,
                                                .ref = new_ref,
                                            },
                                            .needs_decl = true,
                                        };
                                        if (p.commonjs_named_exports_needs_conversion == std.math.maxInt(u32))
                                            p.commonjs_named_exports_needs_conversion = @as(u32, @truncate(p.commonjs_named_exports.count() - 1));
                                    }

                                    const ref = named_export_entry.value_ptr.*.loc_ref.ref.?;
                                    p.recordUsage(ref);

                                    return p.newExpr(
                                        E.CommonJSExportIdentifier{
                                            .ref = ref,
                                            // Record this as from module.exports
                                            .base = .module_dot_exports,
                                        },
                                        name_loc,
                                    );
                                } else if (p.options.features.commonjs_at_runtime and identifier_opts.assign_target != .none) {
                                    p.has_commonjs_export_names = true;
                                }
                            }
                        }
                    },
                    .hot_enabled, .hot_disabled => {
                        const enabled = p.options.features.hot_module_reloading;
                        if (bun.strings.eqlComptime(name, "data")) {
                            return if (enabled)
                                .{ .data = .{ .e_special = .hot_data }, .loc = loc }
                            else
                                Expr.init(E.Object, .{}, loc);
                        }
                        if (bun.strings.eqlComptime(name, "accept")) {
                            if (!enabled) {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return .{ .data = .e_undefined, .loc = loc };
                            }
                            return .{ .data = .{
                                .e_special = .hot_accept,
                            }, .loc = loc };
                        }
                        const lookup_table = comptime bun.ComptimeStringMap(void, [_]struct { [:0]const u8, void }{
                            .{ "decline", {} },
                            .{ "dispose", {} },
                            .{ "prune", {} },
                            .{ "invalidate", {} },
                            .{ "on", {} },
                            .{ "off", {} },
                            .{ "send", {} },
                        });
                        if (lookup_table.has(name)) {
                            if (enabled) {
                                return Expr.init(E.Dot, .{
                                    .target = Expr.initIdentifier(p.hmr_api_ref, target.loc),
                                    .name = name,
                                    .name_loc = name_loc,
                                }, loc);
                            } else {
                                p.method_call_must_be_replaced_with_undefined = true;
                                return .{ .data = .e_undefined, .loc = loc };
                            }
                        } else {
                            // This error is a bit out of place since the HMR
                            // API is validated in the parser instead of at
                            // runtime. When the API is not validated in this
                            // way, the developer may unintentionally read or
                            // write internal fields of HMRModule.
                            p.log.addError(
                                p.source,
                                loc,
                                std.fmt.allocPrint(
                                    p.allocator,
                                    "import.meta.hot.{s} does not exist",
                                    .{name},
                                ) catch |err| bun.handleOom(err),
                            ) catch |err| bun.handleOom(err);
                            return .{ .data = .e_undefined, .loc = loc };
                        }
                    },
                    else => {},
                },
                else => {},
            }

            return null;
        }

        fn maybeRewritePropertyAccessForNamespace(
            p: *P,
            name: string,
            target: *const Expr,
            loc: logger.Loc,
            name_loc: logger.Loc,
        ) ?Expr {
            if (p.ts_namespace.map.?.get(name)) |value| {
                switch (value.data) {
                    .enum_number => |num| {
                        p.ignoreUsageOfIdentifierInDotChain(target.*);
                        return p.wrapInlinedEnum(
                            .{ .loc = loc, .data = .{ .e_number = .{ .value = num } } },
                            name,
                        );
                    },

                    .enum_string => |str| {
                        p.ignoreUsageOfIdentifierInDotChain(target.*);
                        return p.wrapInlinedEnum(
                            .{ .loc = loc, .data = .{ .e_string = str } },
                            name,
                        );
                    },

                    .namespace => |namespace| {
                        // If this isn't a constant, return a clone of this property access
                        // but with the namespace member data associated with it so that
                        // more property accesses off of this property access are recognized.
                        const expr = if (js_lexer.isIdentifier(name))
                            p.newExpr(E.Dot{
                                .target = target.*,
                                .name = name,
                                .name_loc = name_loc,
                            }, loc)
                        else
                            p.newExpr(E.Dot{
                                .target = target.*,
                                .name = name,
                                .name_loc = name_loc,
                            }, loc);

                        p.ts_namespace = .{
                            .expr = expr.data,
                            .map = namespace,
                        };

                        return expr;
                    },

                    else => {},
                }
            }

            return null;
        }

        pub fn checkIfDefinedHelper(p: *P, expr: Expr) !Expr {
            return p.newExpr(
                E.Binary{
                    .op = .bin_strict_eq,
                    .left = p.newExpr(
                        E.Unary{
                            .op = .un_typeof,
                            .value = expr,
                            .flags = .{
                                .was_originally_typeof_identifier = expr.data == .e_identifier,
                            },
                        },
                        logger.Loc.Empty,
                    ),
                    .right = p.newExpr(
                        E.String{ .data = "undefined" },
                        logger.Loc.Empty,
                    ),
                },
                logger.Loc.Empty,
            );
        }

        pub fn maybeDefinedHelper(p: *P, identifier_expr: Expr) !Expr {
            return p.newExpr(
                E.If{
                    .test_ = try p.checkIfDefinedHelper(identifier_expr),
                    .yes = p.newExpr(
                        E.Identifier{
                            .ref = (p.findSymbol(logger.Loc.Empty, "Object") catch unreachable).ref,
                        },
                        logger.Loc.Empty,
                    ),
                    .no = identifier_expr,
                },
                logger.Loc.Empty,
            );
        }

        pub fn maybeCommaSpreadError(p: *P, _comma_after_spread: ?logger.Loc) void {
            const comma_after_spread = _comma_after_spread orelse return;
            if (comma_after_spread.start == -1) return;

            p.log.addRangeError(p.source, logger.Range{ .loc = comma_after_spread, .len = 1 }, "Unexpected \",\" after rest pattern") catch unreachable;
        }
    };
}

const string = []const u8;

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const assert = bun.assert;
const js_lexer = bun.js_lexer;
const jsc = bun.jsc;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const Flags = js_ast.Flags;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Decl = G.Decl;
const Property = G.Property;

const js_parser = bun.js_parser;
const IdentifierOpts = js_parser.IdentifierOpts;
const JSXTransformType = js_parser.JSXTransformType;
const RelocateVars = js_parser.RelocateVars;
const SideEffects = js_parser.SideEffects;
const TypeScript = js_parser.TypeScript;
const options = js_parser.options;

const std = @import("std");
const List = std.ArrayListUnmanaged;
