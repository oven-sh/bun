pub fn ParseProperty(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const is_typescript_enabled = P.is_typescript_enabled;

        fn parseMethodExpression(p: *P, kind: Property.Kind, opts: *PropertyOpts, is_computed: bool, key: *Expr, key_range: logger.Range) anyerror!?G.Property {
            if (p.lexer.token == .t_open_paren and kind != .get and kind != .set) {
                // markSyntaxFeature object extensions
            }

            const loc = p.lexer.loc();
            const scope_index = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
            var is_constructor = false;

            // Forbid the names "constructor" and "prototype" in some cases
            if (opts.is_class and !is_computed) {
                switch (key.data) {
                    .e_string => |str| {
                        if (!opts.is_static and str.eqlComptime("constructor")) {
                            if (kind == .get) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a getter") catch unreachable;
                            } else if (kind == .set) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a setter") catch unreachable;
                            } else if (opts.is_async) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be an async function") catch unreachable;
                            } else if (opts.is_generator) {
                                p.log.addRangeError(p.source, key_range, "Class constructor cannot be a generator function") catch unreachable;
                            } else {
                                is_constructor = true;
                            }
                        } else if (opts.is_static and str.eqlComptime("prototype")) {
                            p.log.addRangeError(p.source, key_range, "Invalid static method name \"prototype\"") catch unreachable;
                        }
                    },
                    else => {},
                }
            }

            var func = try p.parseFn(null, FnOrArrowDataParse{
                .async_range = opts.async_range,
                .needs_async_loc = key.loc,
                .has_async_range = !opts.async_range.isEmpty(),
                .allow_await = if (opts.is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                .allow_yield = if (opts.is_generator) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
                .allow_super_call = opts.class_has_extends and is_constructor,
                .allow_super_property = true,
                .allow_ts_decorators = opts.allow_ts_decorators,
                .is_constructor = is_constructor,
                .has_decorators = opts.ts_decorators.len > 0 or (opts.has_class_decorators and is_constructor),

                // Only allow omitting the body if we're parsing TypeScript class
                .allow_missing_body_for_type_script = is_typescript_enabled and opts.is_class,
            });

            opts.has_argument_decorators = opts.has_argument_decorators or p.fn_or_arrow_data_parse.has_argument_decorators;
            p.fn_or_arrow_data_parse.has_argument_decorators = false;

            // "class Foo { foo(): void; foo(): void {} }"
            if (func.flags.contains(.is_forward_declaration)) {
                // Skip this property entirely
                p.popAndDiscardScope(scope_index);
                return null;
            }

            p.popScope();
            func.flags.insert(.is_unique_formal_parameters);
            const value = p.newExpr(E.Function{ .func = func }, loc);

            // Enforce argument rules for accessors
            switch (kind) {
                .get => {
                    if (func.args.len > 0) {
                        const r = js_lexer.rangeOfIdentifier(p.source, func.args[0].binding.loc);
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Getter {s} must have zero arguments", .{p.keyNameForError(key)}) catch unreachable;
                    }
                },
                .set => {
                    if (func.args.len != 1) {
                        var r = js_lexer.rangeOfIdentifier(p.source, if (func.args.len > 0) func.args[0].binding.loc else loc);
                        if (func.args.len > 1) {
                            r = js_lexer.rangeOfIdentifier(p.source, func.args[1].binding.loc);
                        }
                        p.log.addRangeErrorFmt(p.source, r, p.allocator, "Setter {s} must have exactly 1 argument (there are {d})", .{ p.keyNameForError(key), func.args.len }) catch unreachable;
                    }
                },
                else => {},
            }

            // Special-case private identifiers
            switch (key.data) {
                .e_private_identifier => |*private| {
                    const declare: Symbol.Kind = switch (kind) {
                        .get => if (opts.is_static)
                            .private_static_get
                        else
                            .private_get,

                        .set => if (opts.is_static)
                            .private_static_set
                        else
                            .private_set,
                        else => if (opts.is_static)
                            .private_static_method
                        else
                            .private_method,
                    };

                    const name = p.loadNameFromRef(private.ref);
                    if (strings.eqlComptime(name, "#constructor")) {
                        p.log.addRangeError(p.source, key_range, "Invalid method name \"#constructor\"") catch unreachable;
                    }
                    private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                },
                else => {},
            }

            return G.Property{
                .ts_decorators = try ExprNodeList.fromSlice(p.allocator, opts.ts_decorators),
                .kind = kind,
                .flags = Flags.Property.init(.{
                    .is_computed = is_computed,
                    .is_method = true,
                    .is_static = opts.is_static,
                }),
                .key = key.*,
                .value = value,
                .ts_metadata = .m_function,
            };
        }

        pub fn parseProperty(p: *P, kind_: Property.Kind, opts: *PropertyOpts, errors_: ?*DeferredErrors) anyerror!?G.Property {
            var kind = kind_;
            var errors = errors_;
            // This while loop exists to conserve stack space by reducing (but not completely eliminating) recursion.
            restart: while (true) {
                var key: Expr = Expr{ .loc = logger.Loc.Empty, .data = .{ .e_missing = E.Missing{} } };
                const key_range = p.lexer.range();
                var is_computed = false;

                switch (p.lexer.token) {
                    .t_numeric_literal => {
                        key = p.newExpr(E.Number{
                            .value = p.lexer.number,
                        }, p.lexer.loc());
                        // p.checkForLegacyOctalLiteral()
                        try p.lexer.next();
                    },
                    .t_string_literal => {
                        key = try p.parseStringLiteral();
                    },
                    .t_big_integer_literal => {
                        key = p.newExpr(E.BigInt{ .value = p.lexer.identifier }, p.lexer.loc());
                        // markSyntaxFeature
                        try p.lexer.next();
                    },
                    .t_private_identifier => {
                        if (!opts.is_class or opts.ts_decorators.len > 0) {
                            try p.lexer.expected(.t_identifier);
                        }

                        key = p.newExpr(E.PrivateIdentifier{ .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable }, p.lexer.loc());
                        try p.lexer.next();
                    },
                    .t_open_bracket => {
                        is_computed = true;
                        // p.markSyntaxFeature(compat.objectExtensions, p.lexer.range())
                        try p.lexer.next();
                        const wasIdentifier = p.lexer.token == .t_identifier;
                        const expr = try p.parseExpr(.comma);

                        if (comptime is_typescript_enabled) {

                            // Handle index signatures
                            if (p.lexer.token == .t_colon and wasIdentifier and opts.is_class) {
                                switch (expr.data) {
                                    .e_identifier => {
                                        try p.lexer.next();
                                        try p.skipTypeScriptType(.lowest);
                                        try p.lexer.expect(.t_close_bracket);
                                        try p.lexer.expect(.t_colon);
                                        try p.skipTypeScriptType(.lowest);
                                        try p.lexer.expectOrInsertSemicolon();

                                        // Skip this property entirely
                                        return null;
                                    },
                                    else => {},
                                }
                            }
                        }

                        try p.lexer.expect(.t_close_bracket);
                        key = expr;
                    },
                    .t_asterisk => {
                        if (kind != .normal or opts.is_generator) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        try p.lexer.next();
                        opts.is_generator = true;
                        kind = .normal;
                        continue :restart;
                    },

                    else => {
                        const name = p.lexer.identifier;
                        const raw = p.lexer.raw();
                        const name_range = p.lexer.range();

                        if (!p.lexer.isIdentifierOrKeyword()) {
                            try p.lexer.expect(.t_identifier);
                        }

                        try p.lexer.next();

                        // Support contextual keywords
                        if (kind == .normal and !opts.is_generator) {
                            // Does the following token look like a key?
                            const couldBeModifierKeyword = p.lexer.isIdentifierOrKeyword() or switch (p.lexer.token) {
                                .t_open_bracket, .t_numeric_literal, .t_string_literal, .t_asterisk, .t_private_identifier => true,
                                else => false,
                            };

                            // If so, check for a modifier keyword
                            if (couldBeModifierKeyword) {
                                // TODO: micro-optimization, use a smaller list for non-typescript files.
                                if (js_lexer.PropertyModifierKeyword.List.get(name)) |keyword| {
                                    switch (keyword) {
                                        .p_get => {
                                            if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_get) {
                                                kind = .get;
                                                errors = null;
                                                continue :restart;
                                            }
                                        },

                                        .p_set => {
                                            if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_set) {
                                                // p.markSyntaxFeature(ObjectAccessors, name_range)
                                                kind = .set;
                                                errors = null;
                                                continue :restart;
                                            }
                                        },
                                        .p_async => {
                                            if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_async and !p.lexer.has_newline_before) {
                                                opts.is_async = true;
                                                opts.async_range = name_range;

                                                // p.markSyntaxFeature(ObjectAccessors, name_range)

                                                errors = null;
                                                continue :restart;
                                            }
                                        },
                                        .p_static => {
                                            if (!opts.is_static and !opts.is_async and opts.is_class and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_get) == .p_static) {
                                                opts.is_static = true;
                                                kind = .normal;
                                                errors = null;
                                                continue :restart;
                                            }
                                        },
                                        .p_declare => {
                                            // skip declare keyword entirely
                                            // https://github.com/oven-sh/bun/issues/1907
                                            if (opts.is_class and is_typescript_enabled and strings.eqlComptime(raw, "declare")) {
                                                const scope_index = p.scopes_in_order.items.len;
                                                if (try p.parseProperty(kind, opts, null)) |_prop| {
                                                    var prop = _prop;
                                                    if (prop.kind == .normal and prop.value == null and opts.ts_decorators.len > 0) {
                                                        prop.kind = .declare;
                                                        return prop;
                                                    }
                                                }

                                                p.discardScopesUpTo(scope_index);
                                                return null;
                                            }
                                        },
                                        .p_abstract => {
                                            if (opts.is_class and is_typescript_enabled and !opts.is_ts_abstract and strings.eqlComptime(raw, "abstract")) {
                                                opts.is_ts_abstract = true;
                                                const scope_index = p.scopes_in_order.items.len;
                                                if (try p.parseProperty(kind, opts, null)) |*prop| {
                                                    if (prop.kind == .normal and prop.value == null and opts.ts_decorators.len > 0) {
                                                        var prop_ = prop.*;
                                                        prop_.kind = .abstract;
                                                        return prop_;
                                                    }
                                                }
                                                p.discardScopesUpTo(scope_index);
                                                return null;
                                            }
                                        },
                                        .p_private, .p_protected, .p_public, .p_readonly, .p_override => {
                                            // Skip over TypeScript keywords
                                            if (opts.is_class and is_typescript_enabled and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == keyword) {
                                                errors = null;
                                                continue :restart;
                                            }
                                        },
                                    }
                                }
                            } else if (p.lexer.token == .t_open_brace and strings.eqlComptime(name, "static")) {
                                const loc = p.lexer.loc();
                                try p.lexer.next();

                                const old_fn_or_arrow_data_parse = p.fn_or_arrow_data_parse;
                                p.fn_or_arrow_data_parse = .{
                                    .is_return_disallowed = true,
                                    .allow_super_property = true,
                                    .allow_await = .forbid_all,
                                };

                                _ = try p.pushScopeForParsePass(.class_static_init, loc);
                                var _parse_opts = ParseStatementOptions{};
                                const stmts = try p.parseStmtsUpTo(.t_close_brace, &_parse_opts);

                                p.popScope();

                                p.fn_or_arrow_data_parse = old_fn_or_arrow_data_parse;
                                try p.lexer.expect(.t_close_brace);

                                const block = p.allocator.create(
                                    G.ClassStaticBlock,
                                ) catch unreachable;

                                block.* = G.ClassStaticBlock{
                                    .stmts = js_ast.BabyList(Stmt).fromOwnedSlice(stmts),
                                    .loc = loc,
                                };

                                return G.Property{
                                    .kind = .class_static_block,
                                    .class_static_block = block,
                                };
                            }
                        }

                        // Handle invalid identifiers in property names
                        // https://github.com/oven-sh/bun/issues/12039
                        if (p.lexer.token == .t_syntax_error) {
                            bun.handleOom(p.log.addRangeErrorFmt(p.source, name_range, p.allocator, "Unexpected {f}", .{bun.fmt.quote(name)}));
                            return error.SyntaxError;
                        }

                        key = p.newExpr(E.String{ .data = name }, name_range.loc);

                        // Parse a shorthand property
                        const isShorthandProperty = !opts.is_class and
                            kind == .normal and
                            p.lexer.token != .t_colon and
                            p.lexer.token != .t_open_paren and
                            p.lexer.token != .t_less_than and
                            !opts.is_generator and
                            !opts.is_async and
                            !js_lexer.Keywords.has(name);

                        if (isShorthandProperty) {
                            if ((p.fn_or_arrow_data_parse.allow_await != .allow_ident and
                                strings.eqlComptime(name, "await")) or
                                (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and
                                    strings.eqlComptime(name, "yield")))
                            {
                                if (strings.eqlComptime(name, "await")) {
                                    p.log.addRangeError(p.source, name_range, "Cannot use \"await\" here") catch unreachable;
                                } else {
                                    p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" here") catch unreachable;
                                }
                            }

                            const ref = p.storeNameInRef(name) catch unreachable;
                            const value = p.newExpr(E.Identifier{ .ref = ref }, key.loc);

                            // Destructuring patterns have an optional default value
                            var initializer: ?Expr = null;
                            if (errors != null and p.lexer.token == .t_equals) {
                                errors.?.invalid_expr_default_value = p.lexer.range();
                                try p.lexer.next();
                                initializer = try p.parseExpr(.comma);
                            }

                            return G.Property{
                                .kind = kind,
                                .key = key,
                                .value = value,
                                .initializer = initializer,
                                .flags = Flags.Property.init(.{
                                    .was_shorthand = true,
                                }),
                            };
                        }
                    },
                }

                var has_type_parameters = false;
                var has_definite_assignment_assertion_operator = false;

                if (comptime is_typescript_enabled) {
                    if (opts.is_class) {
                        if (p.lexer.token == .t_question) {
                            // "class X { foo?: number }"
                            // "class X { foo!: number }"
                            try p.lexer.next();
                        } else if (p.lexer.token == .t_exclamation and
                            !p.lexer.has_newline_before and
                            kind == .normal and
                            !opts.is_async and
                            !opts.is_generator)
                        {
                            // "class X { foo!: number }"
                            try p.lexer.next();
                            has_definite_assignment_assertion_operator = true;
                        }
                    }

                    // "class X { foo?<T>(): T }"
                    // "const x = { foo<T>(): T {} }"
                    if (!has_definite_assignment_assertion_operator) {
                        has_type_parameters = try p.skipTypeScriptTypeParameters(.{ .allow_const_modifier = true }) != .did_not_skip_anything;
                    }
                }

                // Parse a class field with an optional initial value
                if (opts.is_class and
                    kind == .normal and !opts.is_async and
                    !opts.is_generator and
                    p.lexer.token != .t_open_paren and
                    !has_type_parameters and
                    (p.lexer.token != .t_open_paren or has_definite_assignment_assertion_operator))
                {
                    var initializer: ?Expr = null;
                    var ts_metadata = TypeScript.Metadata.default;

                    // Forbid the names "constructor" and "prototype" in some cases
                    if (!is_computed) {
                        switch (key.data) {
                            .e_string => |str| {
                                if (str.eqlComptime("constructor") or (opts.is_static and str.eqlComptime("prototype"))) {
                                    // TODO: fmt error message to include string value.
                                    p.log.addRangeError(p.source, key_range, "Invalid field name") catch unreachable;
                                }
                            },
                            else => {},
                        }
                    }

                    if (comptime is_typescript_enabled) {
                        // Skip over types
                        if (p.lexer.token == .t_colon) {
                            try p.lexer.next();
                            if (p.options.features.emit_decorator_metadata and opts.is_class and opts.ts_decorators.len > 0) {
                                ts_metadata = try p.skipTypeScriptTypeWithMetadata(.lowest);
                            } else {
                                try p.skipTypeScriptType(.lowest);
                            }
                        }
                    }

                    if (p.lexer.token == .t_equals) {
                        if (comptime is_typescript_enabled) {
                            if (!opts.declare_range.isEmpty()) {
                                try p.log.addRangeError(p.source, p.lexer.range(), "Class fields that use \"declare\" cannot be initialized");
                            }
                        }

                        try p.lexer.next();

                        // "this" and "super" property access is allowed in field initializers
                        const old_is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;
                        const old_allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
                        p.fn_or_arrow_data_parse.is_this_disallowed = false;
                        p.fn_or_arrow_data_parse.allow_super_property = true;

                        initializer = try p.parseExpr(.comma);

                        p.fn_or_arrow_data_parse.is_this_disallowed = old_is_this_disallowed;
                        p.fn_or_arrow_data_parse.allow_super_property = old_allow_super_property;
                    }

                    // Special-case private identifiers
                    switch (key.data) {
                        .e_private_identifier => |*private| {
                            const name = p.loadNameFromRef(private.ref);
                            if (strings.eqlComptime(name, "#constructor")) {
                                p.log.addRangeError(p.source, key_range, "Invalid field name \"#constructor\"") catch unreachable;
                            }

                            const declare: js_ast.Symbol.Kind = if (opts.is_static)
                                .private_static_field
                            else
                                .private_field;

                            private.ref = p.declareSymbol(declare, key.loc, name) catch unreachable;
                        },
                        else => {},
                    }

                    try p.lexer.expectOrInsertSemicolon();

                    return G.Property{
                        .ts_decorators = try ExprNodeList.fromSlice(p.allocator, opts.ts_decorators),
                        .kind = kind,
                        .flags = Flags.Property.init(.{
                            .is_computed = is_computed,
                            .is_static = opts.is_static,
                        }),
                        .key = key,
                        .initializer = initializer,
                        .ts_metadata = ts_metadata,
                    };
                }

                // Parse a method expression
                if (p.lexer.token == .t_open_paren or kind != .normal or opts.is_class or opts.is_async or opts.is_generator) {
                    return parseMethodExpression(p, kind, opts, is_computed, &key, key_range);
                }

                // Parse an object key/value pair
                try p.lexer.expect(.t_colon);
                var property: G.Property = .{
                    .kind = kind,
                    .flags = Flags.Property.init(.{
                        .is_computed = is_computed,
                    }),
                    .key = key,
                    .value = Expr{ .data = .e_missing, .loc = .{} },
                };

                try p.parseExprOrBindings(.comma, errors, &property.value.?);
                return property;
            }
        }
    };
}

const string = []const u8;

const bun = @import("bun");
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Property = G.Property;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const AwaitOrYield = js_parser.AwaitOrYield;
const DeferredErrors = js_parser.DeferredErrors;
const FnOrArrowDataParse = js_parser.FnOrArrowDataParse;
const JSXTransformType = js_parser.JSXTransformType;
const ParseStatementOptions = js_parser.ParseStatementOptions;
const PropertyOpts = js_parser.PropertyOpts;
const TypeScript = js_parser.TypeScript;
const options = js_parser.options;

const std = @import("std");
const List = std.ArrayListUnmanaged;
