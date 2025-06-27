pub inline fn parseExprOrBindings(p: *P, level: Level, errors: ?*DeferredErrors) anyerror!Expr {
    return try p.parseExprCommon(level, errors, Expr.EFlags.none);
}

pub inline fn parseExpr(p: *P, level: Level) anyerror!Expr {
    return try p.parseExprCommon(level, null, Expr.EFlags.none);
}

pub inline fn parseExprWithFlags(p: *P, level: Level, flags: Expr.EFlags) anyerror!Expr {
    return try p.parseExprCommon(level, null, flags);
}

fn parseExprCommon(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
    if (!p.stack_check.isSafeToRecurse()) {
        try bun.throwStackOverflow();
    }

    const had_pure_comment_before = p.lexer.has_pure_comment_before and !p.options.ignore_dce_annotations;
    var expr = try p.parsePrefix(level, errors, flags);

    // There is no formal spec for "__PURE__" comments but from reverse-
    // engineering, it looks like they apply to the next CallExpression or
    // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
    // to the expression "a().b()".

    if (had_pure_comment_before and level.lt(.call)) {
        expr = try p.parseSuffix(expr, @as(Level, @enumFromInt(@intFromEnum(Level.call) - 1)), errors, flags);
        switch (expr.data) {
            .e_call => |ex| {
                ex.can_be_unwrapped_if_unused = true;
            },
            .e_new => |ex| {
                ex.can_be_unwrapped_if_unused = true;
            },
            else => {},
        }
    }

    return try p.parseSuffix(expr, level, errors, flags);
}

pub fn parseYieldExpr(p: *P, loc: logger.Loc) !ExprNodeIndex {
    // Parse a yield-from expression, which yields from an iterator
    const isStar = p.lexer.token == T.t_asterisk;

    if (isStar) {
        if (p.lexer.has_newline_before) {
            try p.lexer.unexpected();
            return error.SyntaxError;
        }
        try p.lexer.next();
    }

    var value: ?ExprNodeIndex = null;
    switch (p.lexer.token) {
        .t_close_brace, .t_close_paren, .t_close_bracket, .t_colon, .t_comma, .t_semicolon => {},
        else => {
            if (isStar or !p.lexer.has_newline_before) {
                value = try p.parseExpr(.yield);
            }
        },
    }

    return p.newExpr(E.Yield{
        .value = value,
        .is_star = isStar,
    }, loc);
}

pub fn parseProperty(p: *P, kind: Property.Kind, opts: *PropertyOpts, errors: ?*DeferredErrors) anyerror!?G.Property {
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
            return try p.parseProperty(.normal, opts, errors);
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
                                    // p.markSyntaxFeature(ObjectAccessors, name_range)
                                    return try p.parseProperty(.get, opts, null);
                                }
                            },

                            .p_set => {
                                if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_set) {
                                    // p.markSyntaxFeature(ObjectAccessors, name_range)
                                    return try p.parseProperty(.set, opts, null);
                                }
                            },
                            .p_async => {
                                if (!opts.is_async and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == .p_async and !p.lexer.has_newline_before) {
                                    opts.is_async = true;
                                    opts.async_range = name_range;

                                    // p.markSyntaxFeature(ObjectAccessors, name_range)
                                    return try p.parseProperty(kind, opts, null);
                                }
                            },
                            .p_static => {
                                if (!opts.is_static and !opts.is_async and opts.is_class and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_get) == .p_static) {
                                    opts.is_static = true;
                                    return try p.parseProperty(kind, opts, null);
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
                                    if (try p.parseProperty(kind, opts, null)) |_prop| {
                                        var prop = _prop;
                                        if (prop.kind == .normal and prop.value == null and opts.ts_decorators.len > 0) {
                                            prop.kind = .abstract;
                                            return prop;
                                        }
                                    }
                                    p.discardScopesUpTo(scope_index);
                                    return null;
                                }
                            },
                            .p_private, .p_protected, .p_public, .p_readonly, .p_override => {
                                // Skip over TypeScript keywords
                                if (opts.is_class and is_typescript_enabled and (js_lexer.PropertyModifierKeyword.List.get(raw) orelse .p_static) == keyword) {
                                    return try p.parseProperty(kind, opts, null);
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
                        .stmts = js_ast.BabyList(Stmt).init(stmts),
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
                p.log.addRangeErrorFmt(p.source, name_range, p.allocator, "Unexpected {}", .{bun.fmt.quote(name)}) catch bun.outOfMemory();
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
            .ts_decorators = ExprNodeList.init(opts.ts_decorators),
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
            .ts_decorators = ExprNodeList.init(opts.ts_decorators),
            .kind = kind,
            .flags = Flags.Property.init(.{
                .is_computed = is_computed,
                .is_method = true,
                .is_static = opts.is_static,
            }),
            .key = key,
            .value = value,
            .ts_metadata = .m_function,
        };
    }

    // Parse an object key/value pair
    try p.lexer.expect(.t_colon);
    const value = try p.parseExprOrBindings(.comma, errors);

    return G.Property{
        .kind = kind,
        .flags = Flags.Property.init(.{
            .is_computed = is_computed,
        }),
        .key = key,
        .value = value,
    };
}

// By the time we call this, the identifier and type parameters have already
// been parsed. We need to start parsing from the "extends" clause.
pub fn parseClass(p: *P, class_keyword: logger.Range, name: ?js_ast.LocRef, class_opts: ParseClassOptions) !G.Class {
    var extends: ?Expr = null;
    var has_decorators: bool = false;

    if (p.lexer.token == .t_extends) {
        try p.lexer.next();
        extends = try p.parseExpr(.new);

        // TypeScript's type argument parser inside expressions backtracks if the
        // first token after the end of the type parameter list is "{", so the
        // parsed expression above will have backtracked if there are any type
        // arguments. This means we have to re-parse for any type arguments here.
        // This seems kind of wasteful to me but it's what the official compiler
        // does and it probably doesn't have that high of a performance overhead
        // because "extends" clauses aren't that frequent, so it should be ok.
        if (comptime is_typescript_enabled) {
            _ = try p.skipTypeScriptTypeArguments(false); // isInsideJSXElement
        }
    }

    if (comptime is_typescript_enabled) {
        if (p.lexer.isContextualKeyword("implements")) {
            try p.lexer.next();

            while (true) {
                try p.skipTypeScriptType(.lowest);
                if (p.lexer.token != .t_comma) {
                    break;
                }
                try p.lexer.next();
            }
        }
    }

    const body_loc = p.lexer.loc();
    try p.lexer.expect(T.t_open_brace);
    var properties = ListManaged(G.Property).init(p.allocator);

    // Allow "in" and private fields inside class bodies
    const old_allow_in = p.allow_in;
    const old_allow_private_identifiers = p.allow_private_identifiers;
    p.allow_in = true;
    p.allow_private_identifiers = true;

    // A scope is needed for private identifiers
    const scopeIndex = p.pushScopeForParsePass(.class_body, body_loc) catch unreachable;

    var opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null };
    while (!p.lexer.token.isCloseBraceOrEOF()) {
        if (p.lexer.token == .t_semicolon) {
            try p.lexer.next();
            continue;
        }

        opts = PropertyOpts{ .is_class = true, .allow_ts_decorators = class_opts.allow_ts_decorators, .class_has_extends = extends != null, .has_argument_decorators = false };

        // Parse decorators for this property
        const first_decorator_loc = p.lexer.loc();
        if (opts.allow_ts_decorators) {
            opts.ts_decorators = try p.parseTypeScriptDecorators();
            opts.has_class_decorators = class_opts.ts_decorators.len > 0;
            has_decorators = has_decorators or opts.ts_decorators.len > 0;
        } else {
            opts.ts_decorators = &[_]Expr{};
        }

        // This property may turn out to be a type in TypeScript, which should be ignored
        if (try p.parseProperty(.normal, &opts, null)) |property| {
            properties.append(property) catch unreachable;

            // Forbid decorators on class constructors
            if (opts.ts_decorators.len > 0) {
                switch ((property.key orelse p.panic("Internal error: Expected property {any} to have a key.", .{property})).data) {
                    .e_string => |str| {
                        if (str.eqlComptime("constructor")) {
                            p.log.addError(p.source, first_decorator_loc, "TypeScript does not allow decorators on class constructors") catch unreachable;
                        }
                    },
                    else => {},
                }
            }

            has_decorators = has_decorators or opts.has_argument_decorators;
        }
    }

    if (class_opts.is_type_script_declare) {
        p.popAndDiscardScope(scopeIndex);
    } else {
        p.popScope();
    }

    p.allow_in = old_allow_in;
    p.allow_private_identifiers = old_allow_private_identifiers;
    const close_brace_loc = p.lexer.loc();
    try p.lexer.expect(.t_close_brace);

    return G.Class{
        .class_name = name,
        .extends = extends,
        .close_brace_loc = close_brace_loc,
        .ts_decorators = ExprNodeList.init(class_opts.ts_decorators),
        .class_keyword = class_keyword,
        .body_loc = body_loc,
        .properties = properties.items,
        .has_decorators = has_decorators or class_opts.ts_decorators.len > 0,
    };
}

pub fn parseTemplateParts(p: *P, include_raw: bool) ![]E.TemplatePart {
    var parts = ListManaged(E.TemplatePart).initCapacity(p.allocator, 1) catch unreachable;
    // Allow "in" inside template literals
    const oldAllowIn = p.allow_in;
    p.allow_in = true;

    parseTemplatePart: while (true) {
        try p.lexer.next();
        const value = try p.parseExpr(.lowest);
        const tail_loc = p.lexer.loc();
        try p.lexer.rescanCloseBraceAsTemplateToken();

        const tail: E.Template.Contents = brk: {
            if (!include_raw) break :brk .{ .cooked = try p.lexer.toEString() };
            break :brk .{ .raw = p.lexer.rawTemplateContents() };
        };

        parts.append(E.TemplatePart{
            .value = value,
            .tail_loc = tail_loc,
            .tail = tail,
        }) catch unreachable;

        if (p.lexer.token == .t_template_tail) {
            try p.lexer.next();
            break :parseTemplatePart;
        }
        if (comptime Environment.allow_assert)
            assert(p.lexer.token != .t_end_of_file);
    }

    p.allow_in = oldAllowIn;

    return parts.items;
}

// This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
pub fn parseStringLiteral(p: *P) anyerror!Expr {
    const loc = p.lexer.loc();
    var str = try p.lexer.toEString();
    str.prefer_template = p.lexer.token == .t_no_substitution_template_literal;

    const expr = p.newExpr(str, loc);
    try p.lexer.next();
    return expr;
}

pub fn parseCallArgs(p: *P) anyerror!ExprListLoc {
    // Allow "in" inside call arguments
    const old_allow_in = p.allow_in;
    p.allow_in = true;
    defer p.allow_in = old_allow_in;

    var args = ListManaged(Expr).init(p.allocator);
    try p.lexer.expect(.t_open_paren);

    while (p.lexer.token != .t_close_paren) {
        const loc = p.lexer.loc();
        const is_spread = p.lexer.token == .t_dot_dot_dot;
        if (is_spread) {
            // p.mark_syntax_feature(compat.rest_argument, p.lexer.range());
            try p.lexer.next();
        }
        var arg = try p.parseExpr(.comma);
        if (is_spread) {
            arg = p.newExpr(E.Spread{ .value = arg }, loc);
        }
        args.append(arg) catch unreachable;
        if (p.lexer.token != .t_comma) {
            break;
        }
        try p.lexer.next();
    }
    const close_paren_loc = p.lexer.loc();
    try p.lexer.expect(.t_close_paren);
    return ExprListLoc{ .list = ExprNodeList.fromList(args), .loc = close_paren_loc };
}

// Note: The caller has already parsed the "import" keyword
pub fn parseImportExpr(noalias p: *P, loc: logger.Loc, level: Level) anyerror!Expr {
    // Parse an "import.meta" expression
    if (p.lexer.token == .t_dot) {
        p.esm_import_keyword = js_lexer.rangeOfIdentifier(p.source, loc);
        try p.lexer.next();
        if (p.lexer.isContextualKeyword("meta")) {
            try p.lexer.next();
            p.has_import_meta = true;
            return p.newExpr(E.ImportMeta{}, loc);
        } else {
            try p.lexer.expectedString("\"meta\"");
        }
    }

    if (level.gt(.call)) {
        const r = js_lexer.rangeOfIdentifier(p.source, loc);
        p.log.addRangeError(p.source, r, "Cannot use an \"import\" expression here without parentheses") catch unreachable;
    }

    // allow "in" inside call arguments;
    const old_allow_in = p.allow_in;
    p.allow_in = true;

    p.lexer.preserve_all_comments_before = true;
    try p.lexer.expect(.t_open_paren);

    // const comments = try p.lexer.comments_to_preserve_before.toOwnedSlice();
    p.lexer.comments_to_preserve_before.clearRetainingCapacity();

    p.lexer.preserve_all_comments_before = false;

    const value = try p.parseExpr(.comma);

    var import_options = Expr.empty;
    if (p.lexer.token == .t_comma) {
        // "import('./foo.json', )"
        try p.lexer.next();

        if (p.lexer.token != .t_close_paren) {
            // "import('./foo.json', { assert: { type: 'json' } })"
            import_options = try p.parseExpr(.comma);

            if (p.lexer.token == .t_comma) {
                // "import('./foo.json', { assert: { type: 'json' } }, )"
                try p.lexer.next();
            }
        }
    }

    try p.lexer.expect(.t_close_paren);

    p.allow_in = old_allow_in;

    if (comptime only_scan_imports_and_do_not_visit) {
        if (value.data == .e_string and value.data.e_string.isUTF8() and value.data.e_string.isPresent()) {
            const import_record_index = p.addImportRecord(.dynamic, value.loc, value.data.e_string.slice(p.allocator));

            return p.newExpr(E.Import{
                .expr = value,
                // .leading_interior_comments = comments,
                .import_record_index = import_record_index,
                .options = import_options,
            }, loc);
        }
    }

    // _ = comments; // TODO: leading_interior comments

    return p.newExpr(E.Import{
        .expr = value,
        // .leading_interior_comments = comments,
        .import_record_index = std.math.maxInt(u32),
        .options = import_options,
    }, loc);
}

fn parseJSXPropValueIdentifier(noalias p: *P, previous_string_with_backslash_loc: *logger.Loc) !Expr {
    // Use NextInsideJSXElement() not Next() so we can parse a JSX-style string literal
    try p.lexer.nextInsideJSXElement();
    if (p.lexer.token == .t_string_literal) {
        previous_string_with_backslash_loc.start = @max(p.lexer.loc().start, p.lexer.previous_backslash_quote_in_jsx.loc.start);
        const expr = p.newExpr(try p.lexer.toEString(), previous_string_with_backslash_loc.*);

        try p.lexer.nextInsideJSXElement();
        return expr;
    } else {
        // Use Expect() not ExpectInsideJSXElement() so we can parse expression tokens
        try p.lexer.expect(.t_open_brace);
        const value = try p.parseExpr(.lowest);

        try p.lexer.expectInsideJSXElement(.t_close_brace);
        return value;
    }
}

pub fn parseJSXElement(noalias p: *P, loc: logger.Loc) anyerror!Expr {
    if (only_scan_imports_and_do_not_visit) {
        p.needs_jsx_import = true;
    }

    const tag = try JSXTag.parse(P, p);

    // The tag may have TypeScript type arguments: "<Foo<T>/>"
    if (is_typescript_enabled) {
        // Pass a flag to the type argument skipper because we need to call
        _ = try p.skipTypeScriptTypeArguments(true);
    }

    var previous_string_with_backslash_loc = logger.Loc{};
    var properties = G.Property.List{};
    var key_prop_i: i32 = -1;
    var flags = Flags.JSXElement.Bitset{};
    var start_tag: ?ExprNodeIndex = null;

    // Fragments don't have props
    // Fragments of the form "React.Fragment" are not parsed as fragments.
    if (@as(JSXTag.TagType, tag.data) == .tag) {
        start_tag = tag.data.tag;

        var spread_loc: logger.Loc = logger.Loc.Empty;
        var props = ListManaged(G.Property).init(p.allocator);
        var first_spread_prop_i: i32 = -1;
        var i: i32 = 0;
        parse_attributes: while (true) {
            switch (p.lexer.token) {
                .t_identifier => {
                    defer i += 1;
                    // Parse the prop name
                    const key_range = p.lexer.range();
                    const prop_name_literal = p.lexer.identifier;
                    const special_prop = E.JSXElement.SpecialProp.Map.get(prop_name_literal) orelse E.JSXElement.SpecialProp.any;
                    try p.lexer.nextInsideJSXElement();

                    if (special_prop == .key) {
                        // <ListItem key>
                        if (p.lexer.token != .t_equals) {
                            // Unlike Babel, we're going to just warn here and move on.
                            try p.log.addWarning(p.source, key_range.loc, "\"key\" prop ignored. Must be a string, number or symbol.");
                            continue;
                        }

                        key_prop_i = i;
                    }

                    const prop_name = p.newExpr(E.String{ .data = prop_name_literal }, key_range.loc);

                    // Parse the value
                    var value: Expr = undefined;
                    if (p.lexer.token != .t_equals) {

                        // Implicitly true value
                        // <button selected>
                        value = p.newExpr(E.Boolean{ .value = true }, logger.Loc{ .start = key_range.loc.start + key_range.len });
                    } else {
                        value = try p.parseJSXPropValueIdentifier(&previous_string_with_backslash_loc);
                    }

                    try props.append(G.Property{ .key = prop_name, .value = value });
                },
                .t_open_brace => {
                    defer i += 1;
                    // Use Next() not ExpectInsideJSXElement() so we can parse "..."
                    try p.lexer.next();

                    switch (p.lexer.token) {
                        .t_dot_dot_dot => {
                            try p.lexer.next();

                            if (first_spread_prop_i == -1) first_spread_prop_i = i;
                            spread_loc = p.lexer.loc();
                            try props.append(G.Property{ .value = try p.parseExpr(.comma), .kind = .spread });
                        },
                        // This implements
                        //  <div {foo} />
                        //  ->
                        //  <div foo={foo} />
                        T.t_identifier => {
                            // we need to figure out what the key they mean is
                            // to do that, we must determine the key name
                            const expr = try p.parseExpr(Level.lowest);

                            const key = brk: {
                                switch (expr.data) {
                                    .e_import_identifier => |ident| {
                                        break :brk p.newExpr(E.String{ .data = p.loadNameFromRef(ident.ref) }, expr.loc);
                                    },
                                    .e_commonjs_export_identifier => |ident| {
                                        break :brk p.newExpr(E.String{ .data = p.loadNameFromRef(ident.ref) }, expr.loc);
                                    },
                                    .e_identifier => |ident| {
                                        break :brk p.newExpr(E.String{ .data = p.loadNameFromRef(ident.ref) }, expr.loc);
                                    },
                                    .e_dot => |dot| {
                                        break :brk p.newExpr(E.String{ .data = dot.name }, dot.name_loc);
                                    },
                                    .e_index => |index| {
                                        if (index.index.data == .e_string) {
                                            break :brk index.index;
                                        }
                                    },
                                    else => {},
                                }

                                // If we get here, it's invalid
                                try p.log.addError(p.source, expr.loc, "Invalid JSX prop shorthand, must be identifier, dot or string");
                                return error.SyntaxError;
                            };

                            try props.append(G.Property{ .value = expr, .key = key, .kind = .normal });
                        },
                        // This implements
                        //  <div {"foo"} />
                        //  <div {'foo'} />
                        //  ->
                        //  <div foo="foo" />
                        // note: template literals are not supported, operations on strings are not supported either
                        T.t_string_literal => {
                            const key = p.newExpr(try p.lexer.toEString(), p.lexer.loc());
                            try p.lexer.next();
                            try props.append(G.Property{ .value = key, .key = key, .kind = .normal });
                        },

                        else => try p.lexer.unexpected(),
                    }

                    try p.lexer.nextInsideJSXElement();
                },
                else => {
                    break :parse_attributes;
                },
            }
        }

        const is_key_after_spread = key_prop_i > -1 and first_spread_prop_i > -1 and key_prop_i > first_spread_prop_i;
        flags.setPresent(.is_key_after_spread, is_key_after_spread);
        properties = G.Property.List.fromList(props);
        if (is_key_after_spread and p.options.jsx.runtime == .automatic and !p.has_classic_runtime_warned) {
            try p.log.addWarning(p.source, spread_loc, "\"key\" prop after a {...spread} is deprecated in JSX. Falling back to classic runtime.");
            p.has_classic_runtime_warned = true;
        }
    }

    // People sometimes try to use the output of "JSON.stringify()" as a JSX
    // attribute when automatically-generating JSX code. Doing so is incorrect
    // because JSX strings work like XML instead of like JS (since JSX is XML-in-
    // JS). Specifically, using a backslash before a quote does not cause it to
    // be escaped:
    //
    //   JSX ends the "content" attribute here and sets "content" to 'some so-called \\'
    //                                          v
    //         <Button content="some so-called \"button text\"" />
    //                                                      ^
    //       There is no "=" after the JSX attribute "text", so we expect a ">"
    //
    // This code special-cases this error to provide a less obscure error message.
    if (p.lexer.token == .t_syntax_error and strings.eqlComptime(p.lexer.raw(), "\\") and previous_string_with_backslash_loc.start > 0) {
        const r = p.lexer.range();
        // Not dealing with this right now.
        try p.log.addRangeError(p.source, r, "Invalid JSX escape - use XML entity codes quotes or pass a JavaScript string instead");
        return error.SyntaxError;
    }

    // A slash here is a self-closing element
    if (p.lexer.token == .t_slash) {
        const close_tag_loc = p.lexer.loc();
        // Use NextInsideJSXElement() not Next() so we can parse ">>" as ">"

        try p.lexer.nextInsideJSXElement();

        if (p.lexer.token != .t_greater_than) {
            try p.lexer.expected(.t_greater_than);
        }

        return p.newExpr(E.JSXElement{
            .tag = start_tag,
            .properties = properties,
            .key_prop_index = key_prop_i,
            .flags = flags,
            .close_tag_loc = close_tag_loc,
        }, loc);
    }

    // Use ExpectJSXElementChild() so we parse child strings
    try p.lexer.expectJSXElementChild(.t_greater_than);
    var children = ListManaged(Expr).init(p.allocator);
    // var last_element_i: usize = 0;

    while (true) {
        switch (p.lexer.token) {
            .t_string_literal => {
                try children.append(p.newExpr(try p.lexer.toEString(), loc));
                try p.lexer.nextJSXElementChild();
            },
            .t_open_brace => {
                // Use Next() instead of NextJSXElementChild() here since the next token is an expression
                try p.lexer.next();

                const is_spread = p.lexer.token == .t_dot_dot_dot;
                if (is_spread) {
                    try p.lexer.next();
                }

                // The expression is optional, and may be absent
                if (p.lexer.token != .t_close_brace) {
                    var item = try p.parseExpr(.lowest);
                    if (is_spread) {
                        item = p.newExpr(E.Spread{ .value = item }, loc);
                    }
                    try children.append(item);
                }

                // Use ExpectJSXElementChild() so we parse child strings
                try p.lexer.expectJSXElementChild(.t_close_brace);
            },
            .t_less_than => {
                const less_than_loc = p.lexer.loc();
                try p.lexer.nextInsideJSXElement();

                if (p.lexer.token != .t_slash) {
                    // This is a child element

                    children.append(try p.parseJSXElement(less_than_loc)) catch unreachable;

                    // The call to parseJSXElement() above doesn't consume the last
                    // TGreaterThan because the caller knows what Next() function to call.
                    // Use NextJSXElementChild() here since the next token is an element
                    // child.
                    try p.lexer.nextJSXElementChild();
                    continue;
                }

                // This is the closing element
                try p.lexer.nextInsideJSXElement();
                const end_tag = try JSXTag.parse(P, p);

                if (!strings.eql(end_tag.name, tag.name)) {
                    try p.log.addRangeErrorFmtWithNote(
                        p.source,
                        end_tag.range,
                        p.allocator,
                        "Expected closing JSX tag to match opening tag \"\\<{s}\\>\"",
                        .{tag.name},
                        "Opening tag here:",
                        .{},
                        tag.range,
                    );
                    return error.SyntaxError;
                }

                if (p.lexer.token != .t_greater_than) {
                    try p.lexer.expected(.t_greater_than);
                }

                return p.newExpr(E.JSXElement{
                    .tag = end_tag.data.asExpr(),
                    .children = ExprNodeList.fromList(children),
                    .properties = properties,
                    .key_prop_index = key_prop_i,
                    .flags = flags,
                    .close_tag_loc = end_tag.range.loc,
                }, loc);
            },
            else => {
                try p.lexer.unexpected();
                return error.SyntaxError;
            },
        }
    }
}

/// This assumes that the open parenthesis has already been parsed by the caller
pub fn parseParenExpr(p: *P, loc: logger.Loc, level: Level, opts: ParenExprOpts) anyerror!Expr {
    var items_list = ListManaged(Expr).init(p.allocator);
    var errors = DeferredErrors{};
    var arrowArgErrors = DeferredArrowArgErrors{};
    var spread_range = logger.Range{};
    var type_colon_range = logger.Range{};
    var comma_after_spread: ?logger.Loc = null;

    // Push a scope assuming this is an arrow function. It may not be, in which
    // case we'll need to roll this change back. This has to be done ahead of
    // parsing the arguments instead of later on when we hit the "=>" token and
    // we know it's an arrow function because the arguments may have default
    // values that introduce new scopes and declare new symbols. If this is an
    // arrow function, then those new scopes will need to be parented under the
    // scope of the arrow function itself.
    const scope_index = try p.pushScopeForParsePass(.function_args, loc);

    // Allow "in" inside parentheses
    const oldAllowIn = p.allow_in;
    p.allow_in = true;

    // Forbid "await" and "yield", but only for arrow functions
    var old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_parse);
    p.fn_or_arrow_data_parse.arrow_arg_errors = arrowArgErrors;
    p.fn_or_arrow_data_parse.track_arrow_arg_errors = true;

    // Scan over the comma-separated arguments or expressions
    while (p.lexer.token != .t_close_paren) {
        const is_spread = p.lexer.token == .t_dot_dot_dot;

        if (is_spread) {
            spread_range = p.lexer.range();
            // p.markSyntaxFeature()
            try p.lexer.next();
        }

        // We don't know yet whether these are arguments or expressions, so parse
        p.latest_arrow_arg_loc = p.lexer.loc();

        var item = try p.parseExprOrBindings(.comma, &errors);

        if (is_spread) {
            item = p.newExpr(E.Spread{ .value = item }, loc);
        }

        // Skip over types
        if (is_typescript_enabled and p.lexer.token == .t_colon) {
            type_colon_range = p.lexer.range();
            try p.lexer.next();
            try p.skipTypeScriptType(.lowest);
        }

        // There may be a "=" after the type (but not after an "as" cast)
        if (is_typescript_enabled and p.lexer.token == .t_equals and !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())) {
            try p.lexer.next();
            item = Expr.assign(item, try p.parseExpr(.comma));
        }

        items_list.append(item) catch unreachable;

        if (p.lexer.token != .t_comma) {
            break;
        }

        // Spread arguments must come last. If there's a spread argument followed
        if (is_spread) {
            comma_after_spread = p.lexer.loc();
        }

        // Eat the comma token
        try p.lexer.next();
    }
    var items = items_list.items;

    // The parenthetical construct must end with a close parenthesis
    try p.lexer.expect(.t_close_paren);

    // Restore "in" operator status before we parse the arrow function body
    p.allow_in = oldAllowIn;

    // Also restore "await" and "yield" expression errors
    p.fn_or_arrow_data_parse = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_parse), &old_fn_or_arrow_data);

    // Are these arguments to an arrow function?
    if (p.lexer.token == .t_equals_greater_than or opts.force_arrow_fn or (is_typescript_enabled and p.lexer.token == .t_colon)) {
        // Arrow functions are not allowed inside certain expressions
        if (level.gt(.assign)) {
            try p.lexer.unexpected();
            return error.SyntaxError;
        }

        var invalidLog = LocList.init(p.allocator);
        var args = ListManaged(G.Arg).init(p.allocator);

        if (opts.is_async) {
            // markl,oweredsyntaxpoksdpokasd
        }

        // First, try converting the expressions to bindings
        for (items, 0..) |_, i| {
            var is_spread = false;
            switch (items[i].data) {
                .e_spread => |v| {
                    is_spread = true;
                    items[i] = v.value;
                },
                else => {},
            }

            var item = items[i];
            const tuple = p.convertExprToBindingAndInitializer(&item, &invalidLog, is_spread);
            // double allocations
            args.append(G.Arg{
                .binding = tuple.binding orelse Binding{ .data = Prefill.Data.BMissing, .loc = item.loc },
                .default = tuple.expr,
            }) catch unreachable;
        }

        // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
        // function. The ":" after the ")" may be a return type annotation, so we
        // attempt to convert the expressions to bindings first before deciding
        // whether this is an arrow function, and only pick an arrow function if
        // there were no conversion errors.
        if (p.lexer.token == .t_equals_greater_than or ((comptime is_typescript_enabled) and
            invalidLog.items.len == 0 and
            p.trySkipTypeScriptArrowReturnTypeWithBacktracking()) or
            opts.force_arrow_fn)
        {
            p.maybeCommaSpreadError(comma_after_spread);
            p.logArrowArgErrors(&arrowArgErrors);

            // Now that we've decided we're an arrow function, report binding pattern
            // conversion errors
            if (invalidLog.items.len > 0) {
                for (invalidLog.items) |_loc| {
                    _loc.addError(
                        p.log,
                        p.source,
                    );
                }
            }
            var arrow_data = FnOrArrowDataParse{
                .allow_await = if (opts.is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
            };
            var arrow = try p.parseArrowBody(args.items, &arrow_data);
            arrow.is_async = opts.is_async;
            arrow.has_rest_arg = spread_range.len > 0;
            p.popScope();
            return p.newExpr(arrow, loc);
        }
    }

    // If we get here, it's not an arrow function so undo the pushing of the
    // scope we did earlier. This needs to flatten any child scopes into the
    // parent scope as if the scope was never pushed in the first place.
    p.popAndFlattenScope(scope_index);

    // If this isn't an arrow function, then types aren't allowed
    if (type_colon_range.len > 0) {
        try p.log.addRangeError(p.source, type_colon_range, "Unexpected \":\"");
        return error.SyntaxError;
    }

    // Are these arguments for a call to a function named "async"?
    if (opts.is_async) {
        p.logExprErrors(&errors);
        const async_expr = p.newExpr(E.Identifier{ .ref = try p.storeNameInRef("async") }, loc);
        return p.newExpr(E.Call{ .target = async_expr, .args = ExprNodeList.init(items) }, loc);
    }

    // Is this a chain of expressions and comma operators?
    if (items.len > 0) {
        p.logExprErrors(&errors);
        if (spread_range.len > 0) {
            try p.log.addRangeError(p.source, type_colon_range, "Unexpected \"...\"");
            return error.SyntaxError;
        }

        var value = Expr.joinAllWithComma(items, p.allocator);
        p.markExprAsParenthesized(&value);
        return value;
    }

    // Indicate that we expected an arrow function
    try p.lexer.expected(.t_equals_greater_than);
    return error.SyntaxError;
}

/// This assumes the "function" token has already been parsed
pub fn parseFnStmt(noalias p: *P, loc: logger.Loc, noalias opts: *ParseStatementOptions, asyncRange: ?logger.Range) !Stmt {
    const is_generator = p.lexer.token == T.t_asterisk;
    const is_async = asyncRange != null;

    if (is_generator) {
        // p.markSyntaxFeature(compat.Generator, p.lexer.Range())
        try p.lexer.next();
    } else if (is_async) {
        // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
    }

    switch (opts.lexical_decl) {
        .forbid => {
            try p.forbidLexicalDecl(loc);
        },

        // Allow certain function statements in certain single-statement contexts
        .allow_fn_inside_if, .allow_fn_inside_label => {
            if (opts.is_typescript_declare or is_generator or is_async) {
                try p.forbidLexicalDecl(loc);
            }
        },
        else => {},
    }

    var name: ?js_ast.LocRef = null;
    var nameText: string = "";

    // The name is optional for "export default function() {}" pseudo-statements
    if (!opts.is_name_optional or p.lexer.token == T.t_identifier) {
        const nameLoc = p.lexer.loc();
        nameText = p.lexer.identifier;
        try p.lexer.expect(T.t_identifier);
        // Difference
        const ref = try p.newSymbol(Symbol.Kind.other, nameText);
        name = js_ast.LocRef{
            .loc = nameLoc,
            .ref = ref,
        };
    }

    // Even anonymous functions can have TypeScript type parameters
    if (is_typescript_enabled) {
        _ = try p.skipTypeScriptTypeParameters(.{ .allow_const_modifier = true });
    }

    // Introduce a fake block scope for function declarations inside if statements
    var ifStmtScopeIndex: usize = 0;
    const hasIfScope = opts.lexical_decl == .allow_fn_inside_if;
    if (hasIfScope) {
        ifStmtScopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.block, loc);
    }

    var scopeIndex: usize = 0;
    var pushedScopeForFunctionArgs = false;
    // Push scope if the current lexer token is an open parenthesis token.
    // That is, the parser is about parsing function arguments
    if (p.lexer.token == .t_open_paren) {
        scopeIndex = try p.pushScopeForParsePass(js_ast.Scope.Kind.function_args, p.lexer.loc());
        pushedScopeForFunctionArgs = true;
    }

    var func = try p.parseFn(name, FnOrArrowDataParse{
        .needs_async_loc = loc,
        .async_range = asyncRange orelse logger.Range.None,
        .has_async_range = asyncRange != null,
        .allow_await = if (is_async) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
        .allow_yield = if (is_generator) AwaitOrYield.allow_expr else AwaitOrYield.allow_ident,
        .is_typescript_declare = opts.is_typescript_declare,

        // Only allow omitting the body if we're parsing TypeScript
        .allow_missing_body_for_type_script = is_typescript_enabled,
    });
    p.fn_or_arrow_data_parse.has_argument_decorators = false;

    if (comptime is_typescript_enabled) {
        // Don't output anything if it's just a forward declaration of a function
        if ((opts.is_typescript_declare or func.flags.contains(.is_forward_declaration)) and pushedScopeForFunctionArgs) {
            p.popAndDiscardScope(scopeIndex);

            // Balance the fake block scope introduced above
            if (hasIfScope) {
                p.popScope();
            }

            if (opts.is_typescript_declare and opts.is_namespace_scope and opts.is_export) {
                p.has_non_local_export_declare_inside_namespace = true;
            }

            return p.s(S.TypeScript{}, loc);
        }
    }

    if (pushedScopeForFunctionArgs) {
        p.popScope();
    }

    // Only declare the function after we know if it had a body or not. Otherwise
    // TypeScript code such as this will double-declare the symbol:
    //
    //     function foo(): void;
    //     function foo(): void {}
    //
    if (name != null) {
        const kind = if (is_generator or is_async)
            Symbol.Kind.generator_or_async_function
        else
            Symbol.Kind.hoisted_function;

        name.?.ref = try p.declareSymbol(kind, name.?.loc, nameText);
        func.name = name;
    }

    func.flags.setPresent(.has_if_scope, hasIfScope);
    func.flags.setPresent(.is_export, opts.is_export);

    // Balance the fake block scope introduced above
    if (hasIfScope) {
        p.popScope();
    }

    return p.s(
        S.Function{
            .func = func,
        },
        loc,
    );
}

fn parseFn(p: *P, name: ?js_ast.LocRef, opts: FnOrArrowDataParse) anyerror!G.Fn {
    // if data.allowAwait and data.allowYield {
    //     p.markSyntaxFeature(compat.AsyncGenerator, data.asyncRange)
    // }

    var func = G.Fn{
        .name = name,

        .flags = Flags.Function.init(.{
            .has_rest_arg = false,
            .is_async = opts.allow_await == .allow_expr,
            .is_generator = opts.allow_yield == .allow_expr,
        }),

        .arguments_ref = null,
        .open_parens_loc = p.lexer.loc(),
    };
    try p.lexer.expect(T.t_open_paren);

    // Await and yield are not allowed in function arguments
    var old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_parse);

    p.fn_or_arrow_data_parse.allow_await = if (opts.allow_await == .allow_expr)
        AwaitOrYield.forbid_all
    else
        AwaitOrYield.allow_ident;

    p.fn_or_arrow_data_parse.allow_yield = if (opts.allow_yield == .allow_expr)
        AwaitOrYield.forbid_all
    else
        AwaitOrYield.allow_ident;

    // Don't suggest inserting "async" before anything if "await" is found
    p.fn_or_arrow_data_parse.needs_async_loc = logger.Loc.Empty;

    // If "super()" is allowed in the body, it's allowed in the arguments
    p.fn_or_arrow_data_parse.allow_super_call = opts.allow_super_call;
    p.fn_or_arrow_data_parse.allow_super_property = opts.allow_super_property;

    var rest_arg: bool = false;
    var arg_has_decorators: bool = false;
    var args = List(G.Arg){};
    while (p.lexer.token != T.t_close_paren) {
        // Skip over "this" type annotations
        if (is_typescript_enabled and p.lexer.token == T.t_this) {
            try p.lexer.next();
            if (p.lexer.token == T.t_colon) {
                try p.lexer.next();
                try p.skipTypeScriptType(.lowest);
            }
            if (p.lexer.token != T.t_comma) {
                break;
            }

            try p.lexer.next();
            continue;
        }

        var ts_decorators: []ExprNodeIndex = &([_]ExprNodeIndex{});
        if (opts.allow_ts_decorators) {
            ts_decorators = try p.parseTypeScriptDecorators();
            if (ts_decorators.len > 0) {
                arg_has_decorators = true;
            }
        }

        if (!func.flags.contains(.has_rest_arg) and p.lexer.token == T.t_dot_dot_dot) {
            // p.markSyntaxFeature
            try p.lexer.next();
            rest_arg = true;
            func.flags.insert(.has_rest_arg);
        }

        var is_typescript_ctor_field = false;
        const is_identifier = p.lexer.token == T.t_identifier;
        var text = p.lexer.identifier;
        var arg = try p.parseBinding(.{});
        var ts_metadata = TypeScript.Metadata.default;

        if (comptime is_typescript_enabled) {
            if (is_identifier and opts.is_constructor) {
                // Skip over TypeScript accessibility modifiers, which turn this argument
                // into a class field when used inside a class constructor. This is known
                // as a "parameter property" in TypeScript.
                while (true) {
                    switch (p.lexer.token) {
                        .t_identifier, .t_open_brace, .t_open_bracket => {
                            if (!js_lexer.TypeScriptAccessibilityModifier.has(text)) {
                                break;
                            }

                            is_typescript_ctor_field = true;

                            // TypeScript requires an identifier binding
                            if (p.lexer.token != .t_identifier) {
                                try p.lexer.expect(.t_identifier);
                            }
                            text = p.lexer.identifier;

                            // Re-parse the binding (the current binding is the TypeScript keyword)
                            arg = try p.parseBinding(.{});
                        },
                        else => {
                            break;
                        },
                    }
                }
            }

            // "function foo(a?) {}"
            if (p.lexer.token == .t_question) {
                try p.lexer.next();
            }

            // "function foo(a: any) {}"
            if (p.lexer.token == .t_colon) {
                try p.lexer.next();
                if (!rest_arg) {
                    if (p.options.features.emit_decorator_metadata and
                        opts.allow_ts_decorators and
                        (opts.has_argument_decorators or opts.has_decorators or arg_has_decorators))
                    {
                        ts_metadata = try p.skipTypeScriptTypeWithMetadata(.lowest);
                    } else {
                        try p.skipTypeScriptType(.lowest);
                    }
                } else {
                    // rest parameter is always object, leave metadata as m_none
                    try p.skipTypeScriptType(.lowest);
                }
            }
        }

        var parseStmtOpts = ParseStatementOptions{};
        p.declareBinding(.hoisted, &arg, &parseStmtOpts) catch unreachable;

        var default_value: ?ExprNodeIndex = null;
        if (!func.flags.contains(.has_rest_arg) and p.lexer.token == .t_equals) {
            // p.markSyntaxFeature
            try p.lexer.next();
            default_value = try p.parseExpr(.comma);
        }

        args.append(p.allocator, G.Arg{
            .ts_decorators = ExprNodeList.init(ts_decorators),
            .binding = arg,
            .default = default_value,

            // We need to track this because it affects code generation
            .is_typescript_ctor_field = is_typescript_ctor_field,
            .ts_metadata = ts_metadata,
        }) catch unreachable;

        if (p.lexer.token != .t_comma) {
            break;
        }

        if (func.flags.contains(.has_rest_arg)) {
            // JavaScript does not allow a comma after a rest argument
            if (opts.is_typescript_declare) {
                // TypeScript does allow a comma after a rest argument in a "declare" context
                try p.lexer.next();
            } else {
                try p.lexer.expect(.t_close_paren);
            }

            break;
        }

        try p.lexer.next();
        rest_arg = false;
    }
    if (args.items.len > 0) {
        func.args = args.items;
    }

    // Reserve the special name "arguments" in this scope. This ensures that it
    // shadows any variable called "arguments" in any parent scopes. But only do
    // this if it wasn't already declared above because arguments are allowed to
    // be called "arguments", in which case the real "arguments" is inaccessible.
    if (!p.current_scope.members.contains("arguments")) {
        func.arguments_ref = p.declareSymbolMaybeGenerated(.arguments, func.open_parens_loc, arguments_str, false) catch unreachable;
        p.symbols.items[func.arguments_ref.?.innerIndex()].must_not_be_renamed = true;
    }

    try p.lexer.expect(.t_close_paren);
    p.fn_or_arrow_data_parse = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_parse), &old_fn_or_arrow_data);

    p.fn_or_arrow_data_parse.has_argument_decorators = arg_has_decorators;

    // "function foo(): any {}"
    if (is_typescript_enabled) {
        if (p.lexer.token == .t_colon) {
            try p.lexer.next();

            if (p.options.features.emit_decorator_metadata and opts.allow_ts_decorators and (opts.has_argument_decorators or opts.has_decorators)) {
                func.return_ts_metadata = try p.skipTypescriptReturnTypeWithMetadata();
            } else {
                try p.skipTypescriptReturnType();
            }
        } else if (p.options.features.emit_decorator_metadata and opts.allow_ts_decorators and (opts.has_argument_decorators or opts.has_decorators)) {
            if (func.flags.contains(.is_async)) {
                func.return_ts_metadata = .m_promise;
            } else {
                func.return_ts_metadata = .m_undefined;
            }
        }
    }

    // "function foo(): any;"
    if (opts.allow_missing_body_for_type_script and p.lexer.token != .t_open_brace) {
        try p.lexer.expectOrInsertSemicolon();
        func.flags.insert(.is_forward_declaration);
        return func;
    }
    var tempOpts = opts;
    func.body = try p.parseFnBody(&tempOpts);

    return func;
}

pub fn parseLabelName(p: *P) !?js_ast.LocRef {
    if (p.lexer.token != .t_identifier or p.lexer.has_newline_before) {
        return null;
    }

    const name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(p.lexer.identifier) };
    try p.lexer.next();
    return name;
}

pub fn parseClassStmt(p: *P, loc: logger.Loc, opts: *ParseStatementOptions) !Stmt {
    var name: ?js_ast.LocRef = null;
    const class_keyword = p.lexer.range();
    if (p.lexer.token == .t_class) {
        //marksyntaxfeature
        try p.lexer.next();
    } else {
        try p.lexer.expected(.t_class);
    }

    const is_identifier = p.lexer.token == .t_identifier;

    if (!opts.is_name_optional or (is_identifier and (!is_typescript_enabled or !strings.eqlComptime(p.lexer.identifier, "implements")))) {
        const name_loc = p.lexer.loc();
        const name_text = p.lexer.identifier;
        try p.lexer.expect(.t_identifier);

        // We must return here
        // or the lexer will crash loop!
        // example:
        // export class {}
        if (!is_identifier) {
            return error.SyntaxError;
        }

        if (p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name_text, "await")) {
            try p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"await\" as an identifier here");
        }

        name = LocRef{ .loc = name_loc, .ref = null };
        if (!opts.is_typescript_declare) {
            (name orelse unreachable).ref = p.declareSymbol(.class, name_loc, name_text) catch unreachable;
        }
    }

    // Even anonymous classes can have TypeScript type parameters
    if (is_typescript_enabled) {
        _ = try p.skipTypeScriptTypeParameters(.{
            .allow_in_out_variance_annotations = true,
            .allow_const_modifier = true,
        });
    }
    var class_opts = ParseClassOptions{
        .allow_ts_decorators = true,
        .is_type_script_declare = opts.is_typescript_declare,
    };
    if (opts.ts_decorators) |dec| {
        class_opts.ts_decorators = dec.values;
    }

    const scope_index = p.pushScopeForParsePass(.class_name, loc) catch unreachable;
    const class = try p.parseClass(class_keyword, name, class_opts);

    if (comptime is_typescript_enabled) {
        if (opts.is_typescript_declare) {
            p.popAndDiscardScope(scope_index);
            if (opts.is_namespace_scope and opts.is_export) {
                p.has_non_local_export_declare_inside_namespace = true;
            }

            return p.s(S.TypeScript{}, loc);
        }
    }

    p.popScope();
    return p.s(S.Class{
        .class = class,
        .is_export = opts.is_export,
    }, loc);
}

pub fn parseClauseAlias(p: *P, kind: string) !string {
    const loc = p.lexer.loc();

    // The alias may now be a utf-16 (not wtf-16) string (see https://github.com/tc39/ecma262/pull/2154)
    if (p.lexer.token == .t_string_literal) {
        var estr = try p.lexer.toEString();
        if (estr.isUTF8()) {
            return estr.slice8();
        } else if (strings.toUTF8AllocWithTypeWithoutInvalidSurrogatePairs(p.lexer.allocator, []const u16, estr.slice16())) |alias_utf8| {
            return alias_utf8;
        } else |err| {
            const r = p.source.rangeOfString(loc);
            try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Invalid {s} alias because it contains an unpaired Unicode surrogate ({s})", .{ kind, @errorName(err) });
            return p.source.textForRange(r);
        }
    }

    // The alias may be a keyword
    if (!p.lexer.isIdentifierOrKeyword()) {
        try p.lexer.expect(.t_identifier);
    }

    const alias = p.lexer.identifier;
    p.checkForNonBMPCodePoint(loc, alias);
    return alias;
}

pub fn parseImportClause(
    p: *P,
) !ImportClause {
    var items = ListManaged(js_ast.ClauseItem).init(p.allocator);
    try p.lexer.expect(.t_open_brace);
    var is_single_line = !p.lexer.has_newline_before;
    // this variable should not exist if we're not in a typescript file
    var had_type_only_imports = if (comptime is_typescript_enabled)
        false;

    while (p.lexer.token != .t_close_brace) {
        // The alias may be a keyword;
        const isIdentifier = p.lexer.token == .t_identifier;
        const alias_loc = p.lexer.loc();
        const alias = try p.parseClauseAlias("import");
        var name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(alias) };
        var original_name = alias;
        try p.lexer.next();

        const probably_type_only_import = if (comptime is_typescript_enabled)
            strings.eqlComptime(alias, "type") and
                p.lexer.token != .t_comma and
                p.lexer.token != .t_close_brace
        else
            false;

        // "import { type xx } from 'mod'"
        // "import { type xx as yy } from 'mod'"
        // "import { type 'xx' as yy } from 'mod'"
        // "import { type as } from 'mod'"
        // "import { type as as } from 'mod'"
        // "import { type as as as } from 'mod'"
        if (probably_type_only_import) {
            if (p.lexer.isContextualKeyword("as")) {
                try p.lexer.next();
                if (p.lexer.isContextualKeyword("as")) {
                    original_name = p.lexer.identifier;
                    name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(original_name) };
                    try p.lexer.next();

                    if (p.lexer.token == .t_identifier) {

                        // "import { type as as as } from 'mod'"
                        // "import { type as as foo } from 'mod'"
                        had_type_only_imports = true;
                        try p.lexer.next();
                    } else {
                        // "import { type as as } from 'mod'"

                        try items.append(.{
                            .alias = alias,
                            .alias_loc = alias_loc,
                            .name = name,
                            .original_name = original_name,
                        });
                    }
                } else if (p.lexer.token == .t_identifier) {
                    had_type_only_imports = true;

                    // "import { type as xxx } from 'mod'"
                    original_name = p.lexer.identifier;
                    name = LocRef{ .loc = p.lexer.loc(), .ref = try p.storeNameInRef(original_name) };
                    try p.lexer.expect(.t_identifier);

                    if (isEvalOrArguments(original_name)) {
                        const r = p.source.rangeOfString(name.loc);
                        try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot use {s} as an identifier here", .{original_name});
                    }

                    try items.append(.{
                        .alias = alias,
                        .alias_loc = alias_loc,
                        .name = name,
                        .original_name = original_name,
                    });
                }
            } else {
                const is_identifier = p.lexer.token == .t_identifier;

                // "import { type xx } from 'mod'"
                // "import { type xx as yy } from 'mod'"
                // "import { type if as yy } from 'mod'"
                // "import { type 'xx' as yy } from 'mod'"
                _ = try p.parseClauseAlias("import");
                try p.lexer.next();

                if (p.lexer.isContextualKeyword("as")) {
                    try p.lexer.next();

                    try p.lexer.expect(.t_identifier);
                } else if (!is_identifier) {
                    // An import where the name is a keyword must have an alias
                    try p.lexer.expectedString("\"as\"");
                }
                had_type_only_imports = true;
            }
        } else {
            if (p.lexer.isContextualKeyword("as")) {
                try p.lexer.next();
                original_name = p.lexer.identifier;
                name = LocRef{ .loc = alias_loc, .ref = try p.storeNameInRef(original_name) };
                try p.lexer.expect(.t_identifier);
            } else if (!isIdentifier) {
                // An import where the name is a keyword must have an alias
                try p.lexer.expectedString("\"as\"");
            }

            // Reject forbidden names
            if (isEvalOrArguments(original_name)) {
                const r = js_lexer.rangeOfIdentifier(p.source, name.loc);
                try p.log.addRangeErrorFmt(p.source, r, p.allocator, "Cannot use \"{s}\" as an identifier here", .{original_name});
            }

            try items.append(js_ast.ClauseItem{
                .alias = alias,
                .alias_loc = alias_loc,
                .name = name,
                .original_name = original_name,
            });
        }

        if (p.lexer.token != .t_comma) {
            break;
        }

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }

        try p.lexer.next();

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }
    }

    if (p.lexer.has_newline_before) {
        is_single_line = false;
    }

    try p.lexer.expect(.t_close_brace);
    return ImportClause{
        .items = items.items,
        .is_single_line = is_single_line,
        .had_type_only_imports = if (comptime is_typescript_enabled)
            had_type_only_imports
        else
            false,
    };
}

pub fn parseExprOrLetStmt(p: *P, opts: *ParseStatementOptions) !ExprOrLetStmt {
    const token_range = p.lexer.range();

    if (p.lexer.token != .t_identifier) {
        return ExprOrLetStmt{ .stmt_or_expr = js_ast.StmtOrExpr{ .expr = try p.parseExpr(.lowest) } };
    }

    const raw = p.lexer.raw();
    if (strings.eqlComptime(raw, "let")) {
        try p.lexer.next();

        switch (p.lexer.token) {
            .t_identifier, .t_open_bracket, .t_open_brace => {
                if (opts.lexical_decl == .allow_all or !p.lexer.has_newline_before or p.lexer.token == .t_open_bracket) {
                    if (opts.lexical_decl != .allow_all) {
                        try p.forbidLexicalDecl(token_range.loc);
                    }

                    const decls = try p.parseAndDeclareDecls(.other, opts);
                    return ExprOrLetStmt{
                        .stmt_or_expr = js_ast.StmtOrExpr{
                            .stmt = p.s(S.Local{
                                .kind = .k_let,
                                .decls = G.Decl.List.fromList(decls),
                                .is_export = opts.is_export,
                            }, token_range.loc),
                        },
                        .decls = decls.items,
                    };
                }
            },
            else => {},
        }
    } else if (strings.eqlComptime(raw, "using")) {
        // Handle an "using" declaration
        if (opts.is_export) {
            try p.log.addError(p.source, token_range.loc, "Cannot use \"export\" with a \"using\" declaration");
        }

        try p.lexer.next();

        if (p.lexer.token == .t_identifier and !p.lexer.has_newline_before) {
            if (opts.lexical_decl != .allow_all) {
                try p.forbidLexicalDecl(token_range.loc);
            }
            // p.markSyntaxFeature(.using, token_range.loc);
            opts.is_using_statement = true;
            const decls = try p.parseAndDeclareDecls(.constant, opts);
            if (!opts.is_for_loop_init) {
                try p.requireInitializers(.k_using, decls.items);
            }
            return ExprOrLetStmt{
                .stmt_or_expr = js_ast.StmtOrExpr{
                    .stmt = p.s(S.Local{
                        .kind = .k_using,
                        .decls = G.Decl.List.fromList(decls),
                        .is_export = false,
                    }, token_range.loc),
                },
                .decls = decls.items,
            };
        }
    } else if (p.fn_or_arrow_data_parse.allow_await == .allow_expr and strings.eqlComptime(raw, "await")) {
        // Handle an "await using" declaration
        if (opts.is_export) {
            try p.log.addError(p.source, token_range.loc, "Cannot use \"export\" with an \"await using\" declaration");
        }

        if (p.fn_or_arrow_data_parse.is_top_level) {
            p.top_level_await_keyword = token_range;
        }

        try p.lexer.next();

        const raw2 = p.lexer.raw();
        const value = if (p.lexer.token == .t_identifier and strings.eqlComptime(raw2, "using")) value: {
            // const using_loc = p.saveExprCommentsHere();
            const using_range = p.lexer.range();
            try p.lexer.next();
            if (p.lexer.token == .t_identifier and !p.lexer.has_newline_before) {
                // It's an "await using" declaration if we get here
                if (opts.lexical_decl != .allow_all) {
                    try p.forbidLexicalDecl(using_range.loc);
                }
                // p.markSyntaxFeature(.using, using_range.loc);
                opts.is_using_statement = true;
                const decls = try p.parseAndDeclareDecls(.constant, opts);
                if (!opts.is_for_loop_init) {
                    try p.requireInitializers(.k_await_using, decls.items);
                }
                return ExprOrLetStmt{
                    .stmt_or_expr = js_ast.StmtOrExpr{
                        .stmt = p.s(S.Local{
                            .kind = .k_await_using,
                            .decls = G.Decl.List.fromList(decls),
                            .is_export = false,
                        }, token_range.loc),
                    },
                    .decls = decls.items,
                };
            }
            break :value Expr{
                .data = .{ .e_identifier = .{ .ref = try p.storeNameInRef(raw) } },
                // TODO: implement saveExprCommentsHere and use using_loc here
                .loc = using_range.loc,
            };
        } else try p.parseExpr(.prefix);

        if (p.lexer.token == .t_asterisk_asterisk) {
            try p.lexer.unexpected();
        }
        const expr = p.newExpr(
            E.Await{ .value = try p.parseSuffix(value, .prefix, null, .none) },
            token_range.loc,
        );
        return ExprOrLetStmt{
            .stmt_or_expr = js_ast.StmtOrExpr{
                .expr = try p.parseSuffix(expr, .lowest, null, .none),
            },
        };
    } else {
        return ExprOrLetStmt{
            .stmt_or_expr = js_ast.StmtOrExpr{
                .expr = try p.parseExpr(.lowest),
            },
        };
    }

    // Parse the remainder of this expression that starts with an identifier
    const ref = try p.storeNameInRef(raw);
    const expr = p.newExpr(E.Identifier{ .ref = ref }, token_range.loc);
    return ExprOrLetStmt{
        .stmt_or_expr = js_ast.StmtOrExpr{
            .expr = try p.parseSuffix(expr, .lowest, null, .none),
        },
    };
}

pub fn parseBinding(p: *P, comptime opts: ParseBindingOptions) anyerror!Binding {
    const loc = p.lexer.loc();

    switch (p.lexer.token) {
        .t_identifier => {
            const name = p.lexer.identifier;
            if ((p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name, "await")) or (p.fn_or_arrow_data_parse.allow_yield != .allow_ident and strings.eqlComptime(name, "yield"))) {
                // TODO: add fmt to addRangeError
                p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"yield\" or \"await\" here.") catch unreachable;
            }

            const ref = p.storeNameInRef(name) catch unreachable;
            try p.lexer.next();
            return p.b(B.Identifier{ .ref = ref }, loc);
        },
        .t_open_bracket => {
            if (!opts.is_using_statement) {
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var items = ListManaged(js_ast.ArrayBinding).init(p.allocator);
                var has_spread = false;

                // "in" expressions are allowed
                const old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_bracket) {
                    if (p.lexer.token == .t_comma) {
                        items.append(js_ast.ArrayBinding{
                            .binding = Binding{ .data = Prefill.Data.BMissing, .loc = p.lexer.loc() },
                        }) catch unreachable;
                    } else {
                        if (p.lexer.token == .t_dot_dot_dot) {
                            try p.lexer.next();
                            has_spread = true;

                            // This was a bug in the ES2015 spec that was fixed in ES2016
                            if (p.lexer.token != .t_identifier) {
                                // p.markSyntaxFeature(compat.NestedRestBinding, p.lexer.Range())

                            }
                        }

                        const binding = try p.parseBinding(opts);

                        var default_value: ?Expr = null;
                        if (!has_spread and p.lexer.token == .t_equals) {
                            try p.lexer.next();
                            default_value = try p.parseExpr(.comma);
                        }

                        items.append(js_ast.ArrayBinding{ .binding = binding, .default_value = default_value }) catch unreachable;

                        // Commas after spread elements are not allowed
                        if (has_spread and p.lexer.token == .t_comma) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                            return error.SyntaxError;
                        }
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.next();

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                p.allow_in = old_allow_in;

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                try p.lexer.expect(.t_close_bracket);
                return p.b(B.Array{
                    .items = items.items,
                    .has_spread = has_spread,
                    .is_single_line = is_single_line,
                }, loc);
            }
        },
        .t_open_brace => {
            if (!opts.is_using_statement) {
                // p.markSyntaxFeature(compat.Destructuring, p.lexer.Range())
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var properties = ListManaged(js_ast.B.Property).init(p.allocator);

                // "in" expressions are allowed
                const old_allow_in = p.allow_in;
                p.allow_in = true;

                while (p.lexer.token != .t_close_brace) {
                    var property = try p.parsePropertyBinding();
                    properties.append(property) catch unreachable;

                    // Commas after spread elements are not allowed
                    if (property.flags.contains(.is_spread) and p.lexer.token == .t_comma) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Unexpected \",\" after rest pattern") catch unreachable;
                        return error.SyntaxError;
                    }

                    if (p.lexer.token != .t_comma) {
                        break;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.next();
                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                }

                p.allow_in = old_allow_in;

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                try p.lexer.expect(.t_close_brace);

                return p.b(B.Object{
                    .properties = properties.items,
                    .is_single_line = is_single_line,
                }, loc);
            }
        },
        else => {},
    }

    try p.lexer.expect(.t_identifier);
    return Binding{ .loc = loc, .data = Prefill.Data.BMissing };
}

pub fn parsePropertyBinding(p: *P) anyerror!B.Property {
    var key: js_ast.Expr = Expr{ .loc = logger.Loc.Empty, .data = Prefill.Data.EMissing };
    var is_computed = false;

    switch (p.lexer.token) {
        .t_dot_dot_dot => {
            try p.lexer.next();
            const value = p.b(
                B.Identifier{
                    .ref = p.storeNameInRef(p.lexer.identifier) catch unreachable,
                },
                p.lexer.loc(),
            );
            try p.lexer.expect(.t_identifier);
            return B.Property{
                .key = p.newExpr(E.Missing{}, p.lexer.loc()),

                .flags = Flags.Property.init(.{ .is_spread = true }),
                .value = value,
            };
        },
        .t_numeric_literal => {
            key = p.newExpr(E.Number{
                .value = p.lexer.number,
            }, p.lexer.loc());
            // check for legacy octal literal
            try p.lexer.next();
        },
        .t_string_literal => {
            key = try p.parseStringLiteral();
        },
        .t_big_integer_literal => {
            key = p.newExpr(E.BigInt{
                .value = p.lexer.identifier,
            }, p.lexer.loc());
            // p.markSyntaxFeature(compat.BigInt, p.lexer.Range())
            try p.lexer.next();
        },
        .t_open_bracket => {
            is_computed = true;
            try p.lexer.next();
            key = try p.parseExpr(.comma);
            try p.lexer.expect(.t_close_bracket);
        },
        else => {
            const name = p.lexer.identifier;
            const loc = p.lexer.loc();

            if (!p.lexer.isIdentifierOrKeyword()) {
                try p.lexer.expect(.t_identifier);
            }

            try p.lexer.next();

            key = p.newExpr(E.String{ .data = name }, loc);

            if (p.lexer.token != .t_colon and p.lexer.token != .t_open_paren) {
                const ref = p.storeNameInRef(name) catch unreachable;
                const value = p.b(B.Identifier{ .ref = ref }, loc);
                var default_value: ?Expr = null;
                if (p.lexer.token == .t_equals) {
                    try p.lexer.next();
                    default_value = try p.parseExpr(.comma);
                }

                return B.Property{
                    .key = key,
                    .value = value,
                    .default_value = default_value,
                };
            }
        },
    }

    try p.lexer.expect(.t_colon);
    const value = try p.parseBinding(.{});

    var default_value: ?Expr = null;
    if (p.lexer.token == .t_equals) {
        try p.lexer.next();
        default_value = try p.parseExpr(.comma);
    }

    return B.Property{
        .flags = Flags.Property.init(.{
            .is_computed = is_computed,
        }),
        .key = key,
        .value = value,
        .default_value = default_value,
    };
}

pub fn parseAndDeclareDecls(p: *P, kind: Symbol.Kind, opts: *ParseStatementOptions) anyerror!ListManaged(G.Decl) {
    var decls = ListManaged(G.Decl).init(p.allocator);

    while (true) {
        // Forbid "let let" and "const let" but not "var let"
        if ((kind == .other or kind == .constant) and p.lexer.isContextualKeyword("let")) {
            p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"let\" as an identifier here") catch unreachable;
        }

        var value: ?js_ast.Expr = null;
        var local = switch (opts.is_using_statement) {
            inline else => |is_using| try p.parseBinding(.{
                .is_using_statement = is_using,
            }),
        };
        p.declareBinding(kind, &local, opts) catch unreachable;

        // Skip over types
        if (comptime is_typescript_enabled) {
            // "let foo!"
            const is_definite_assignment_assertion = p.lexer.token == .t_exclamation and !p.lexer.has_newline_before;
            if (is_definite_assignment_assertion) {
                try p.lexer.next();
            }

            // "let foo: number"
            if (is_definite_assignment_assertion or p.lexer.token == .t_colon) {
                try p.lexer.expect(.t_colon);
                try p.skipTypeScriptType(.lowest);
            }
        }

        if (p.lexer.token == .t_equals) {
            try p.lexer.next();
            value = try p.parseExpr(.comma);
        }

        decls.append(G.Decl{
            .binding = local,
            .value = value,
        }) catch unreachable;

        if (p.lexer.token != .t_comma) {
            break;
        }
        try p.lexer.next();
    }

    return decls;
}

pub fn parseExportClause(p: *P) !ExportClauseResult {
    var items = ListManaged(js_ast.ClauseItem).initCapacity(p.allocator, 1) catch unreachable;
    try p.lexer.expect(.t_open_brace);
    var is_single_line = !p.lexer.has_newline_before;
    var first_non_identifier_loc = logger.Loc{ .start = 0 };
    var had_type_only_exports = false;

    while (p.lexer.token != .t_close_brace) {
        var alias = try p.parseClauseAlias("export");
        var alias_loc = p.lexer.loc();

        const name = LocRef{
            .loc = alias_loc,
            .ref = p.storeNameInRef(alias) catch unreachable,
        };
        const original_name = alias;

        // The name can actually be a keyword if we're really an "export from"
        // statement. However, we won't know until later. Allow keywords as
        // identifiers for now and throw an error later if there's no "from".
        //
        //   // This is fine
        //   export { default } from 'path'
        //
        //   // This is a syntax error
        //   export { default }
        //
        if (p.lexer.token != .t_identifier and first_non_identifier_loc.start == 0) {
            first_non_identifier_loc = p.lexer.loc();
        }
        try p.lexer.next();

        if (comptime is_typescript_enabled) {
            if (strings.eqlComptime(alias, "type") and p.lexer.token != .t_comma and p.lexer.token != .t_close_brace) {
                if (p.lexer.isContextualKeyword("as")) {
                    try p.lexer.next();

                    if (p.lexer.isContextualKeyword("as")) {
                        alias = try p.parseClauseAlias("export");
                        alias_loc = p.lexer.loc();
                        try p.lexer.next();

                        if (p.lexer.token != .t_comma and p.lexer.token != .t_close_brace) {
                            // "export { type as as as }"
                            // "export { type as as foo }"
                            // "export { type as as 'foo' }"
                            _ = p.parseClauseAlias("export") catch "";
                            had_type_only_exports = true;
                            try p.lexer.next();
                        } else {
                            // "export { type as as }"
                            items.append(js_ast.ClauseItem{
                                .alias = alias,
                                .alias_loc = alias_loc,
                                .name = name,
                                .original_name = original_name,
                            }) catch unreachable;
                        }
                    } else if (p.lexer.token != .t_comma and p.lexer.token != .t_close_brace) {
                        // "export { type as xxx }"
                        // "export { type as 'xxx' }"
                        alias = try p.parseClauseAlias("export");
                        alias_loc = p.lexer.loc();
                        try p.lexer.next();

                        items.append(js_ast.ClauseItem{
                            .alias = alias,
                            .alias_loc = alias_loc,
                            .name = name,
                            .original_name = original_name,
                        }) catch unreachable;
                    } else {
                        had_type_only_exports = true;
                    }
                } else {
                    // The name can actually be a keyword if we're really an "export from"
                    // statement. However, we won't know until later. Allow keywords as
                    // identifiers for now and throw an error later if there's no "from".
                    //
                    //   // This is fine
                    //   export { default } from 'path'
                    //
                    //   // This is a syntax error
                    //   export { default }
                    //
                    if (p.lexer.token != .t_identifier and first_non_identifier_loc.start == 0) {
                        first_non_identifier_loc = p.lexer.loc();
                    }

                    // "export { type xx }"
                    // "export { type xx as yy }"
                    // "export { type xx as if }"
                    // "export { type default } from 'path'"
                    // "export { type default as if } from 'path'"
                    // "export { type xx as 'yy' }"
                    // "export { type 'xx' } from 'mod'"
                    _ = p.parseClauseAlias("export") catch "";
                    try p.lexer.next();

                    if (p.lexer.isContextualKeyword("as")) {
                        try p.lexer.next();
                        _ = p.parseClauseAlias("export") catch "";
                        try p.lexer.next();
                    }

                    had_type_only_exports = true;
                }
            } else {
                if (p.lexer.isContextualKeyword("as")) {
                    try p.lexer.next();
                    alias = try p.parseClauseAlias("export");
                    alias_loc = p.lexer.loc();

                    try p.lexer.next();
                }

                items.append(js_ast.ClauseItem{
                    .alias = alias,
                    .alias_loc = alias_loc,
                    .name = name,
                    .original_name = original_name,
                }) catch unreachable;
            }
        } else {
            if (p.lexer.isContextualKeyword("as")) {
                try p.lexer.next();
                alias = try p.parseClauseAlias("export");
                alias_loc = p.lexer.loc();

                try p.lexer.next();
            }

            items.append(js_ast.ClauseItem{
                .alias = alias,
                .alias_loc = alias_loc,
                .name = name,
                .original_name = original_name,
            }) catch unreachable;
        }

        // we're done if there's no comma
        if (p.lexer.token != .t_comma) {
            break;
        }

        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }
        try p.lexer.next();
        if (p.lexer.has_newline_before) {
            is_single_line = false;
        }
    }

    if (p.lexer.has_newline_before) {
        is_single_line = false;
    }
    try p.lexer.expect(.t_close_brace);

    // Throw an error here if we found a keyword earlier and this isn't an
    // "export from" statement after all
    if (first_non_identifier_loc.start != 0 and !p.lexer.isContextualKeyword("from")) {
        const r = js_lexer.rangeOfIdentifier(p.source, first_non_identifier_loc);
        try p.lexer.addRangeError(r, "Expected identifier but found \"{s}\"", .{p.source.textForRange(r)}, true);
        return error.SyntaxError;
    }

    return ExportClauseResult{
        .clauses = items.items,
        .is_single_line = is_single_line,
        .had_type_only_exports = had_type_only_exports,
    };
}

pub fn parsePath(p: *P) !ParsedPath {
    const path_text = try p.lexer.toUTF8EString();
    var path = ParsedPath{
        .loc = p.lexer.loc(),
        .text = path_text.slice8(),
        .is_macro = false,
        .import_tag = .none,
    };

    if (p.lexer.token == .t_no_substitution_template_literal) {
        try p.lexer.next();
    } else {
        try p.lexer.expect(.t_string_literal);
    }

    if (!p.lexer.has_newline_before and (
        // Import Assertions are deprecated.
        // Import Attributes are the new way to do this.
        // But some code may still use "assert"
        // We support both and treat them identically.
        // Once Prettier & TypeScript support import attributes, we will add runtime support
        p.lexer.isContextualKeyword("assert") or p.lexer.token == .t_with))
    {
        try p.lexer.next();
        try p.lexer.expect(.t_open_brace);

        const SupportedAttribute = enum {
            type,
            embed,
            bunBakeGraph,
        };

        var has_seen_embed_true = false;

        while (p.lexer.token != .t_close_brace) {
            const supported_attribute: ?SupportedAttribute = brk: {
                // Parse the key
                if (p.lexer.isIdentifierOrKeyword()) {
                    inline for (comptime std.enums.values(SupportedAttribute)) |t| {
                        if (strings.eqlComptime(p.lexer.identifier, @tagName(t))) {
                            break :brk t;
                        }
                    }
                } else if (p.lexer.token == .t_string_literal) {
                    const string_literal_text = (try p.lexer.toUTF8EString()).slice8();
                    inline for (comptime std.enums.values(SupportedAttribute)) |t| {
                        if (strings.eqlComptime(string_literal_text, @tagName(t))) {
                            break :brk t;
                        }
                    }
                } else {
                    try p.lexer.expect(.t_identifier);
                }

                break :brk null;
            };

            try p.lexer.next();
            try p.lexer.expect(.t_colon);

            try p.lexer.expect(.t_string_literal);
            const string_literal_text = (try p.lexer.toUTF8EString()).slice8();
            if (supported_attribute) |attr| {
                switch (attr) {
                    .type => {
                        // This logic is duplicated in js_ast.zig fn importRecordTag()
                        const type_attr = string_literal_text;
                        if (strings.eqlComptime(type_attr, "macro")) {
                            path.is_macro = true;
                        } else if (bun.options.Loader.fromString(type_attr)) |loader| {
                            path.loader = loader;
                            if (loader == .sqlite and has_seen_embed_true) path.loader = .sqlite_embedded;
                        } else {
                            // unknown loader; consider erroring
                        }
                    },
                    .embed => {
                        if (strings.eqlComptime(string_literal_text, "true")) {
                            has_seen_embed_true = true;
                            if (path.loader != null and path.loader == .sqlite) {
                                path.loader = .sqlite_embedded;
                            }
                        }
                    },
                    .bunBakeGraph => {
                        if (strings.eqlComptime(string_literal_text, "ssr")) {
                            path.import_tag = .bake_resolve_to_ssr_graph;
                        } else {
                            try p.lexer.addRangeError(p.lexer.range(), "'bunBakeGraph' can only be set to 'ssr'", .{}, true);
                        }
                    },
                }
            }

            if (p.lexer.token != .t_comma) {
                break;
            }

            try p.lexer.next();
        }

        try p.lexer.expect(.t_close_brace);
    }

    return path;
}

pub fn parseStmtsUpTo(p: *P, eend: js_lexer.T, _opts: *ParseStatementOptions) ![]Stmt {
    var opts = _opts.*;
    var stmts = StmtList.init(p.allocator);

    var returnWithoutSemicolonStart: i32 = -1;
    opts.lexical_decl = .allow_all;
    var isDirectivePrologue = true;

    while (true) {
        for (p.lexer.comments_to_preserve_before.items) |comment| {
            try stmts.append(p.s(S.Comment{
                .text = comment.text,
            }, p.lexer.loc()));
        }
        p.lexer.comments_to_preserve_before.clearRetainingCapacity();

        if (p.lexer.token == eend) {
            break;
        }

        var current_opts = opts;
        var stmt = try p.parseStmt(&current_opts);

        // Skip TypeScript types entirely
        if (is_typescript_enabled) {
            switch (stmt.data) {
                .s_type_script => {
                    continue;
                },
                else => {},
            }
        }

        var skip = stmt.data == .s_empty;
        // Parse one or more directives at the beginning
        if (isDirectivePrologue) {
            isDirectivePrologue = false;
            switch (stmt.data) {
                .s_expr => |expr| {
                    switch (expr.value.data) {
                        .e_string => |str| {
                            if (!str.prefer_template) {
                                isDirectivePrologue = true;

                                if (str.eqlComptime("use strict")) {
                                    skip = true;
                                    // Track "use strict" directives
                                    p.current_scope.strict_mode = .explicit_strict_mode;
                                    if (p.current_scope == p.module_scope)
                                        p.module_scope_directive_loc = stmt.loc;
                                } else if (str.eqlComptime("use asm")) {
                                    skip = true;
                                    stmt.data = Prefill.Data.SEmpty;
                                } else {
                                    stmt = Stmt.alloc(S.Directive, S.Directive{
                                        .value = str.slice(p.allocator),
                                    }, stmt.loc);
                                }
                            }
                        },
                        else => {},
                    }
                },
                else => {},
            }
        }

        if (!skip)
            try stmts.append(stmt);

        // Warn about ASI and return statements. Here's an example of code with
        // this problem: https://github.com/rollup/rollup/issues/3729
        if (!p.options.suppress_warnings_about_weird_code) {
            var needsCheck = true;
            switch (stmt.data) {
                .s_return => |ret| {
                    if (ret.value == null and !p.latest_return_had_semicolon) {
                        returnWithoutSemicolonStart = stmt.loc.start;
                        needsCheck = false;
                    }
                },
                else => {},
            }

            if (needsCheck and returnWithoutSemicolonStart != -1) {
                switch (stmt.data) {
                    .s_expr => {
                        try p.log.addWarning(
                            p.source,
                            logger.Loc{ .start = returnWithoutSemicolonStart + 6 },
                            "The following expression is not returned because of an automatically-inserted semicolon",
                        );
                    },
                    else => {},
                }

                returnWithoutSemicolonStart = -1;
            }
        }
    }

    return stmts.items;
}

pub fn parseFnExpr(p: *P, loc: logger.Loc, is_async: bool, async_range: logger.Range) !Expr {
    try p.lexer.next();
    const is_generator = p.lexer.token == T.t_asterisk;
    if (is_generator) {
        // p.markSyntaxFeature()
        try p.lexer.next();
    } else if (is_async) {
        // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
    }

    var name: ?js_ast.LocRef = null;

    _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;

    // The name is optional
    if (p.lexer.token == .t_identifier) {
        const text = p.lexer.identifier;

        // Don't declare the name "arguments" since it's shadowed and inaccessible
        name = js_ast.LocRef{
            .loc = p.lexer.loc(),
            .ref = if (text.len > 0 and !strings.eqlComptime(text, "arguments"))
                try p.declareSymbol(.hoisted_function, p.lexer.loc(), text)
            else
                try p.newSymbol(.hoisted_function, text),
        };

        try p.lexer.next();
    }

    // Even anonymous functions can have TypeScript type parameters
    if (comptime is_typescript_enabled) {
        _ = try p.skipTypeScriptTypeParameters(.{ .allow_const_modifier = true });
    }

    const func = try p.parseFn(name, FnOrArrowDataParse{
        .needs_async_loc = loc,
        .async_range = async_range,
        .allow_await = if (is_async) .allow_expr else .allow_ident,
        .allow_yield = if (is_generator) .allow_expr else .allow_ident,
    });
    p.fn_or_arrow_data_parse.has_argument_decorators = false;

    p.validateFunctionName(func, .expr);
    p.popScope();

    return p.newExpr(js_ast.E.Function{
        .func = func,
    }, loc);
}

fn parseFnBody(p: *P, data: *FnOrArrowDataParse) !G.FnBody {
    const oldFnOrArrowData = p.fn_or_arrow_data_parse;
    const oldAllowIn = p.allow_in;
    p.fn_or_arrow_data_parse = data.*;
    p.allow_in = true;

    const loc = p.lexer.loc();
    var pushedScopeForFunctionBody = false;
    if (p.lexer.token == .t_open_brace) {
        _ = try p.pushScopeForParsePass(Scope.Kind.function_body, p.lexer.loc());
        pushedScopeForFunctionBody = true;
    }

    try p.lexer.expect(.t_open_brace);
    var opts = ParseStatementOptions{};
    const stmts = try p.parseStmtsUpTo(.t_close_brace, &opts);
    try p.lexer.next();

    if (pushedScopeForFunctionBody) p.popScope();

    p.allow_in = oldAllowIn;
    p.fn_or_arrow_data_parse = oldFnOrArrowData;
    return G.FnBody{ .loc = loc, .stmts = stmts };
}

pub fn parseArrowBody(p: *P, args: []js_ast.G.Arg, data: *FnOrArrowDataParse) !E.Arrow {
    const arrow_loc = p.lexer.loc();

    // Newlines are not allowed before "=>"
    if (p.lexer.has_newline_before) {
        try p.log.addRangeError(p.source, p.lexer.range(), "Unexpected newline before \"=>\"");
        return error.SyntaxError;
    }

    try p.lexer.expect(T.t_equals_greater_than);

    for (args) |*arg| {
        var opts = ParseStatementOptions{};
        try p.declareBinding(Symbol.Kind.hoisted, &arg.binding, &opts);
    }

    // The ability to use "this" and "super()" is inherited by arrow functions
    data.allow_super_call = p.fn_or_arrow_data_parse.allow_super_call;
    data.allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
    data.is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;

    if (p.lexer.token == .t_open_brace) {
        const body = try p.parseFnBody(data);
        p.after_arrow_body_loc = p.lexer.loc();
        return E.Arrow{ .args = args, .body = body };
    }

    _ = try p.pushScopeForParsePass(Scope.Kind.function_body, arrow_loc);
    defer p.popScope();

    var old_fn_or_arrow_data = std.mem.toBytes(p.fn_or_arrow_data_parse);

    p.fn_or_arrow_data_parse = data.*;
    const expr = try p.parseExpr(Level.comma);
    p.fn_or_arrow_data_parse = std.mem.bytesToValue(@TypeOf(p.fn_or_arrow_data_parse), &old_fn_or_arrow_data);

    var stmts = try p.allocator.alloc(Stmt, 1);
    stmts[0] = p.s(S.Return{ .value = expr }, expr.loc);
    return E.Arrow{ .args = args, .prefer_expr = true, .body = G.FnBody{ .loc = arrow_loc, .stmts = stmts } };
}

/// This parses an expression. This assumes we've already parsed the "async"
/// keyword and are currently looking at the following token.
pub fn parseAsyncPrefixExpr(p: *P, async_range: logger.Range, level: Level) !Expr {
    // "async function() {}"
    if (!p.lexer.has_newline_before and p.lexer.token == T.t_function) {
        return try p.parseFnExpr(async_range.loc, true, async_range);
    }

    // Check the precedence level to avoid parsing an arrow function in
    // "new async () => {}". This also avoids parsing "new async()" as
    // "new (async())()" instead.
    if (!p.lexer.has_newline_before and level.lt(.member)) {
        switch (p.lexer.token) {
            // "async => {}"
            .t_equals_greater_than => {
                if (level.lte(.assign)) {
                    var args = try p.allocator.alloc(G.Arg, 1);
                    args[0] = G.Arg{ .binding = p.b(
                        B.Identifier{
                            .ref = try p.storeNameInRef("async"),
                        },
                        async_range.loc,
                    ) };
                    _ = p.pushScopeForParsePass(.function_args, async_range.loc) catch unreachable;
                    var data = FnOrArrowDataParse{
                        .needs_async_loc = async_range.loc,
                    };
                    const arrow_body = try p.parseArrowBody(args, &data);
                    p.popScope();
                    return p.newExpr(arrow_body, async_range.loc);
                }
            },
            // "async x => {}"
            .t_identifier => {
                if (level.lte(.assign)) {
                    // p.markLoweredSyntaxFeature();

                    const ref = try p.storeNameInRef(p.lexer.identifier);
                    var args = try p.allocator.alloc(G.Arg, 1);
                    args[0] = G.Arg{ .binding = p.b(
                        B.Identifier{
                            .ref = ref,
                        },
                        p.lexer.loc(),
                    ) };
                    try p.lexer.next();

                    _ = try p.pushScopeForParsePass(.function_args, async_range.loc);
                    defer p.popScope();

                    var data = FnOrArrowDataParse{
                        .allow_await = .allow_expr,
                        .needs_async_loc = args[0].binding.loc,
                    };
                    var arrowBody = try p.parseArrowBody(args, &data);
                    arrowBody.is_async = true;
                    return p.newExpr(arrowBody, async_range.loc);
                }
            },

            // "async()"
            // "async () => {}"
            .t_open_paren => {
                try p.lexer.next();
                return p.parseParenExpr(async_range.loc, level, ParenExprOpts{ .is_async = true, .async_range = async_range });
            },

            // "async<T>()"
            // "async <T>() => {}"
            .t_less_than => {
                if (is_typescript_enabled and (!is_jsx_enabled or try TypeScript.isTSArrowFnJSX(p))) {
                    switch (p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                        .did_not_skip_anything => {},
                        else => |result| {
                            try p.lexer.next();
                            return p.parseParenExpr(async_range.loc, level, ParenExprOpts{
                                .is_async = true,
                                .async_range = async_range,
                                .force_arrow_fn = result == .definitely_type_parameters,
                            });
                        },
                    }
                }
            },

            else => {},
        }
    }

    // "async"
    // "async + 1"
    return p.newExpr(
        E.Identifier{ .ref = try p.storeNameInRef("async") },
        async_range.loc,
    );
}
