pub fn ParsePrefix(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const is_jsx_enabled = P.is_jsx_enabled;
        const is_typescript_enabled = P.is_typescript_enabled;

        fn t_super(noalias p: *P, level: Level) anyerror!Expr {
            const loc = p.lexer.loc();
            const l = @intFromEnum(level);
            const superRange = p.lexer.range();
            try p.lexer.next();

            switch (p.lexer.token) {
                .t_open_paren => {
                    if (l < @intFromEnum(Level.call) and p.fn_or_arrow_data_parse.allow_super_call) {
                        return p.newExpr(E.Super{}, loc);
                    }
                },
                .t_dot, .t_open_bracket => {
                    if (p.fn_or_arrow_data_parse.allow_super_property) {
                        return p.newExpr(E.Super{}, loc);
                    }
                },
                else => {},
            }

            p.log.addRangeError(p.source, superRange, "Unexpected \"super\"") catch unreachable;
            return p.newExpr(E.Super{}, loc);
        }
        fn t_open_paren(noalias p: *P, level: Level) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();

            // Arrow functions aren't allowed in the middle of expressions
            if (level.gt(.assign)) {
                // Allow "in" inside parentheses
                const oldAllowIn = p.allow_in;
                p.allow_in = true;

                var value = try p.parseExpr(Level.lowest);
                p.markExprAsParenthesized(&value);
                try p.lexer.expect(.t_close_paren);

                p.allow_in = oldAllowIn;
                return value;
            }

            return p.parseParenExpr(loc, level, ParenExprOpts{});
        }
        fn t_false(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            return p.newExpr(E.Boolean{ .value = false }, loc);
        }
        fn t_true(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            return p.newExpr(E.Boolean{ .value = true }, loc);
        }
        fn t_null(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            return p.newExpr(E.Null{}, loc);
        }
        fn t_this(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            if (p.fn_or_arrow_data_parse.is_this_disallowed) {
                p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"this\" here") catch unreachable;
            }
            try p.lexer.next();
            return Expr{ .data = Prefill.Data.This, .loc = loc };
        }
        fn t_private_identifier(noalias p: *P, level: Level) anyerror!Expr {
            const loc = p.lexer.loc();
            if (!p.allow_private_identifiers or !p.allow_in or level.gte(.compare)) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            const name = p.lexer.identifier;
            try p.lexer.next();

            // Check for "#foo in bar"
            if (p.lexer.token != .t_in) {
                try p.lexer.expected(.t_in);
            }

            return p.newExpr(E.PrivateIdentifier{ .ref = try p.storeNameInRef(name) }, loc);
        }
        fn t_identifier(noalias p: *P, level: Level) anyerror!Expr {
            const loc = p.lexer.loc();
            const name = p.lexer.identifier;
            const name_range = p.lexer.range();
            const raw = p.lexer.raw();

            try p.lexer.next();

            // Handle async and await expressions
            switch (AsyncPrefixExpression.find(name)) {
                .is_async => {
                    if ((raw.ptr == name.ptr and raw.len == name.len) or AsyncPrefixExpression.find(raw) == .is_async) {
                        return try p.parseAsyncPrefixExpr(name_range, level);
                    }
                },

                .is_await => {
                    switch (p.fn_or_arrow_data_parse.allow_await) {
                        .forbid_all => {
                            p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be used here") catch unreachable;
                        },
                        .allow_expr => {
                            if (AsyncPrefixExpression.find(raw) != .is_await) {
                                p.log.addRangeError(p.source, name_range, "The keyword \"await\" cannot be escaped") catch unreachable;
                            } else {
                                if (p.fn_or_arrow_data_parse.is_top_level) {
                                    p.top_level_await_keyword = name_range;
                                }

                                if (p.fn_or_arrow_data_parse.track_arrow_arg_errors) {
                                    p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_await = name_range;
                                }

                                const value = try p.parseExpr(.prefix);
                                if (p.lexer.token == T.t_asterisk_asterisk) {
                                    try p.lexer.unexpected();
                                    return error.SyntaxError;
                                }

                                return p.newExpr(E.Await{ .value = value }, loc);
                            }
                        },
                        .allow_ident => {
                            p.lexer.prev_token_was_await_keyword = true;
                            p.lexer.await_keyword_loc = name_range.loc;
                            p.lexer.fn_or_arrow_start_loc = p.fn_or_arrow_data_parse.needs_async_loc;
                        },
                    }
                },

                .is_yield => {
                    switch (p.fn_or_arrow_data_parse.allow_yield) {
                        .forbid_all => {
                            p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be used here") catch unreachable;
                        },
                        .allow_expr => {
                            if (AsyncPrefixExpression.find(raw) != .is_yield) {
                                p.log.addRangeError(p.source, name_range, "The keyword \"yield\" cannot be escaped") catch unreachable;
                            } else {
                                if (level.gt(.assign)) {
                                    p.log.addRangeError(p.source, name_range, "Cannot use a \"yield\" here without parentheses") catch unreachable;
                                }

                                if (p.fn_or_arrow_data_parse.track_arrow_arg_errors) {
                                    p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_yield = name_range;
                                }

                                return p.parseYieldExpr(loc);
                            }
                        },
                        // .allow_ident => {

                        // },
                        else => {
                            // Try to gracefully recover if "yield" is used in the wrong place
                            if (!p.lexer.has_newline_before) {
                                switch (p.lexer.token) {
                                    .t_null, .t_identifier, .t_false, .t_true, .t_numeric_literal, .t_big_integer_literal, .t_string_literal => {
                                        p.log.addRangeError(p.source, name_range, "Cannot use \"yield\" outside a generator function") catch unreachable;
                                    },
                                    else => {},
                                }
                            }
                        },
                    }
                },
                .none => {},
            }

            // Handle the start of an arrow expression
            if (p.lexer.token == .t_equals_greater_than and level.lte(.assign)) {
                const ref = p.storeNameInRef(name) catch unreachable;
                var args = p.allocator.alloc(Arg, 1) catch unreachable;
                args[0] = Arg{ .binding = p.b(B.Identifier{
                    .ref = ref,
                }, loc) };

                _ = p.pushScopeForParsePass(.function_args, loc) catch unreachable;
                defer p.popScope();

                var fn_or_arrow_data = FnOrArrowDataParse{
                    .needs_async_loc = loc,
                };
                return p.newExpr(try p.parseArrowBody(args, &fn_or_arrow_data), loc);
            }

            const ref = p.storeNameInRef(name) catch unreachable;

            return Expr.initIdentifier(ref, loc);
        }
        fn t_template_head(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            const head = try p.lexer.toEString();

            const parts = try p.parseTemplateParts(false);

            // Check if TemplateLiteral is unsupported. We don't care for this product.`
            // if ()

            return p.newExpr(E.Template{
                .head = .{ .cooked = head },
                .parts = parts,
            }, loc);
        }
        fn t_numeric_literal(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            const value = p.newExpr(E.Number{ .value = p.lexer.number }, loc);
            // p.checkForLegacyOctalLiteral()
            try p.lexer.next();
            return value;
        }
        fn t_big_integer_literal(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            const value = p.lexer.identifier;
            // markSyntaxFeature bigInt
            try p.lexer.next();
            return p.newExpr(E.BigInt{ .value = value }, loc);
        }
        fn t_slash(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.scanRegExp();
            // always set regex_flags_start to null to make sure we don't accidentally use the wrong value later
            defer p.lexer.regex_flags_start = null;
            const value = p.lexer.raw();
            try p.lexer.next();

            return p.newExpr(E.RegExp{ .value = value, .flags_offset = p.lexer.regex_flags_start }, loc);
        }
        fn t_void(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            return p.newExpr(E.Unary{
                .op = .un_void,
                .value = value,
            }, loc);
        }
        fn t_typeof(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            return p.newExpr(
                E.Unary{
                    .op = .un_typeof,
                    .value = value,
                    .flags = .{
                        .was_originally_typeof_identifier = value.data == .e_identifier,
                    },
                },
                loc,
            );
        }
        fn t_delete(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }
            if (value.data == .e_index) {
                if (value.data.e_index.index.data == .e_private_identifier) {
                    const private = value.data.e_index.index.data.e_private_identifier;
                    const name = p.loadNameFromRef(private.ref);
                    const range = logger.Range{ .loc = value.loc, .len = @as(i32, @intCast(name.len)) };
                    p.log.addRangeErrorFmt(p.source, range, p.allocator, "Deleting the private name \"{s}\" is forbidden", .{name}) catch unreachable;
                }
            }

            return p.newExpr(E.Unary{
                .op = .un_delete,
                .value = value,
                .flags = .{
                    .was_originally_delete_of_identifier_or_property_access = value.data == .e_identifier or
                        value.isPropertyAccess(),
                },
            }, loc);
        }
        fn t_plus(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            return p.newExpr(E.Unary{ .op = .un_pos, .value = value }, loc);
        }
        fn t_minus(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            return p.newExpr(E.Unary{ .op = .un_neg, .value = value }, loc);
        }
        fn t_tilde(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            return p.newExpr(E.Unary{ .op = .un_cpl, .value = value }, loc);
        }
        fn t_exclamation(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            const value = try p.parseExpr(.prefix);
            if (p.lexer.token == .t_asterisk_asterisk) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            return p.newExpr(E.Unary{ .op = .un_not, .value = value }, loc);
        }
        fn t_minus_minus(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            return p.newExpr(E.Unary{ .op = .un_pre_dec, .value = try p.parseExpr(.prefix) }, loc);
        }
        fn t_plus_plus(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            return p.newExpr(E.Unary{ .op = .un_pre_inc, .value = try p.parseExpr(.prefix) }, loc);
        }
        fn t_function(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            return try p.parseFnExpr(loc, false, logger.Range.None);
        }
        fn t_class(noalias p: *P) anyerror!Expr {
            const loc = p.lexer.loc();
            const classKeyword = p.lexer.range();
            // markSyntaxFEatuer class
            try p.lexer.next();
            var name: ?js_ast.LocRef = null;

            _ = p.pushScopeForParsePass(.class_name, loc) catch unreachable;

            // Parse an optional class name
            if (p.lexer.token == .t_identifier) {
                const name_text = p.lexer.identifier;
                if (!is_typescript_enabled or !strings.eqlComptime(name_text, "implements")) {
                    if (p.fn_or_arrow_data_parse.allow_await != .allow_ident and strings.eqlComptime(name_text, "await")) {
                        p.log.addRangeError(p.source, p.lexer.range(), "Cannot use \"await\" as an identifier here") catch unreachable;
                    }

                    name = js_ast.LocRef{
                        .loc = p.lexer.loc(),
                        .ref = p.newSymbol(
                            .other,
                            name_text,
                        ) catch unreachable,
                    };
                    try p.lexer.next();
                }
            }

            // Even anonymous classes can have TypeScript type parameters
            if (is_typescript_enabled) {
                _ = try p.skipTypeScriptTypeParameters(.{ .allow_in_out_variance_annotations = true, .allow_const_modifier = true });
            }

            const class = try p.parseClass(classKeyword, name, ParseClassOptions{});
            p.popScope();

            return p.newExpr(class, loc);
        }
        fn t_new(noalias p: *P, flags: Expr.EFlags) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();

            // Special-case the weird "new.target" expression here
            if (p.lexer.token == .t_dot) {
                try p.lexer.next();

                if (p.lexer.token != .t_identifier or !strings.eqlComptime(p.lexer.raw(), "target")) {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                }
                const range = logger.Range{ .loc = loc, .len = p.lexer.range().end().start - loc.start };

                try p.lexer.next();
                return p.newExpr(E.NewTarget{ .range = range }, loc);
            }

            // This wil become the new expr
            var new = p.newExpr(E.New{
                .target = undefined,
                .args = undefined,
                .close_parens_loc = undefined,
            }, loc);

            try p.parseExprWithFlags(.member, flags, &new.data.e_new.target);

            if (comptime is_typescript_enabled) {
                // Skip over TypeScript type arguments here if there are any
                if (p.lexer.token == .t_less_than) {
                    _ = p.trySkipTypeScriptTypeArgumentsWithBacktracking();
                }
            }

            if (p.lexer.token == .t_open_paren) {
                const call_args = try p.parseCallArgs();
                new.data.e_new.args = call_args.list;
                new.data.e_new.close_parens_loc = call_args.loc;
            } else {
                new.data.e_new.close_parens_loc = .Empty;
                new.data.e_new.args = .{};
            }

            return new;
        }
        fn t_open_bracket(noalias p: *P, noalias errors: ?*DeferredErrors) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            var is_single_line = !p.lexer.has_newline_before;
            var items = ListManaged(Expr).init(p.allocator);
            var self_errors = DeferredErrors{};
            var comma_after_spread = logger.Loc{};

            // Allow "in" inside arrays
            const old_allow_in = p.allow_in;
            p.allow_in = true;

            while (p.lexer.token != .t_close_bracket) {
                switch (p.lexer.token) {
                    .t_comma => {
                        items.append(Expr{ .data = Prefill.Data.EMissing, .loc = p.lexer.loc() }) catch unreachable;
                    },
                    .t_dot_dot_dot => {
                        if (errors != null)
                            errors.?.array_spread_feature = p.lexer.range();

                        const dots_loc = p.lexer.loc();
                        try p.lexer.next();
                        try items.ensureUnusedCapacity(1);
                        const spread_expr: *Expr = &items.unusedCapacitySlice()[0];
                        spread_expr.* = p.newExpr(E.Spread{ .value = undefined }, dots_loc);
                        try p.parseExprOrBindings(.comma, &self_errors, &spread_expr.data.e_spread.value);
                        items.items.len += 1;

                        // Commas are not allowed here when destructuring
                        if (p.lexer.token == .t_comma) {
                            comma_after_spread = p.lexer.loc();
                        }
                    },
                    else => {
                        try items.ensureUnusedCapacity(1);
                        const item: *Expr = &items.unusedCapacitySlice()[0];
                        try p.parseExprOrBindings(.comma, &self_errors, item);
                        items.items.len += 1;
                    },
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

            const close_bracket_loc = p.lexer.loc();
            try p.lexer.expect(.t_close_bracket);
            p.allow_in = old_allow_in;

            // Is this a binding pattern?
            if (p.willNeedBindingPattern()) {
                // noop
            } else if (errors == null) {
                // Is this an expression?
                p.logExprErrors(&self_errors);
            } else {
                // In this case, we can't distinguish between the two yet
                self_errors.mergeInto(errors.?);
            }
            return p.newExpr(E.Array{
                .items = ExprNodeList.moveFromList(&items),
                .comma_after_spread = comma_after_spread.toNullable(),
                .is_single_line = is_single_line,
                .close_bracket_loc = close_bracket_loc,
            }, loc);
        }
        fn t_open_brace(noalias p: *P, noalias errors: ?*DeferredErrors) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            var is_single_line = !p.lexer.has_newline_before;
            var properties = ListManaged(G.Property).init(p.allocator);
            var self_errors = DeferredErrors{};
            var comma_after_spread: logger.Loc = logger.Loc{};

            // Allow "in" inside object literals
            const old_allow_in = p.allow_in;
            p.allow_in = true;

            while (p.lexer.token != .t_close_brace) {
                if (p.lexer.token == .t_dot_dot_dot) {
                    try p.lexer.next();
                    try properties.ensureUnusedCapacity(1);
                    const property: *G.Property = &properties.unusedCapacitySlice()[0];
                    property.* = .{
                        .kind = .spread,
                        .value = Expr.empty,
                    };

                    try p.parseExprOrBindings(
                        .comma,
                        &self_errors,
                        &(property.value.?),
                    );
                    properties.items.len += 1;

                    // Commas are not allowed here when destructuring
                    if (p.lexer.token == .t_comma) {
                        comma_after_spread = p.lexer.loc();
                    }
                } else {
                    // This property may turn out to be a type in TypeScript, which should be ignored
                    var propertyOpts = PropertyOpts{};
                    if (try p.parseProperty(.normal, &propertyOpts, &self_errors)) |prop| {
                        if (comptime Environment.allow_assert) {
                            assert(prop.key != null or prop.value != null);
                        }
                        properties.append(prop) catch unreachable;
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

            if (p.lexer.has_newline_before) {
                is_single_line = false;
            }

            const close_brace_loc = p.lexer.loc();
            try p.lexer.expect(.t_close_brace);
            p.allow_in = old_allow_in;

            if (p.willNeedBindingPattern()) {
                // Is this a binding pattern?
            } else if (errors == null) {
                // Is this an expression?
                p.logExprErrors(&self_errors);
            } else {
                // In this case, we can't distinguish between the two yet
                self_errors.mergeInto(errors.?);
            }

            return p.newExpr(E.Object{
                .properties = G.Property.List.moveFromList(&properties),
                .comma_after_spread = if (comma_after_spread.start > 0)
                    comma_after_spread
                else
                    null,
                .is_single_line = is_single_line,
                .close_brace_loc = close_brace_loc,
            }, loc);
        }
        fn t_less_than(noalias p: *P, level: Level, noalias errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
            const loc = p.lexer.loc();
            // This is a very complicated and highly ambiguous area of TypeScript
            // syntax. Many similar-looking things are overloaded.
            //
            // TS:
            //
            //   A type cast:
            //     <A>(x)
            //     <[]>(x)
            //     <A[]>(x)
            //
            //   An arrow function with type parameters:
            //     <A>(x) => {}
            //     <A, B>(x) => {}
            //     <A = B>(x) => {}
            //     <A extends B>(x) => {}
            //
            // TSX:
            //
            //   A JSX element:
            //     <A>(x) => {}</A>
            //     <A extends>(x) => {}</A>
            //     <A extends={false}>(x) => {}</A>
            //
            //   An arrow function with type parameters:
            //     <A, B>(x) => {}
            //     <A extends B>(x) => {}
            //
            //   A syntax error:
            //     <[]>(x)
            //     <A[]>(x)
            //     <A>(x) => {}
            //     <A = B>(x) => {}
            if (comptime is_typescript_enabled and is_jsx_enabled) {
                if (try TypeScript.isTSArrowFnJSX(p)) {
                    _ = try p.skipTypeScriptTypeParameters(TypeParameterFlag{
                        .allow_const_modifier = true,
                    });
                    try p.lexer.expect(.t_open_paren);
                    return try p.parseParenExpr(loc, level, ParenExprOpts{ .force_arrow_fn = true });
                }
            }

            if (is_jsx_enabled) {
                // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
                try p.lexer.nextInsideJSXElement();
                const element = try p.parseJSXElement(loc);

                // The call to parseJSXElement() above doesn't consume the last
                // TGreaterThan because the caller knows what Next() function to call.
                // Use Next() instead of NextInsideJSXElement() here since the next
                // token is an expression.
                try p.lexer.next();
                return element;
            }

            if (is_typescript_enabled) {
                // This is either an old-style type cast or a generic lambda function

                // "<T>(x)"
                // "<T>(x) => {}"
                switch (p.trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking()) {
                    .did_not_skip_anything => {},
                    else => |result| {
                        try p.lexer.expect(.t_open_paren);
                        return p.parseParenExpr(loc, level, ParenExprOpts{
                            .force_arrow_fn = result == .definitely_type_parameters,
                        });
                    },
                }

                // "<T>x"
                try p.lexer.next();
                try p.skipTypeScriptType(.lowest);
                try p.lexer.expectGreaterThan(false);
                return p.parsePrefix(level, errors, flags);
            }

            try p.lexer.unexpected();
            return error.SyntaxError;
        }
        fn t_import(noalias p: *P, level: Level) anyerror!Expr {
            const loc = p.lexer.loc();
            try p.lexer.next();
            return p.parseImportExpr(loc, level);
        }

        // Before splitting this up, this used 3 KB of stack space per call.
        pub fn parsePrefix(noalias p: *P, level: Level, noalias errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
            return switch (p.lexer.token) {
                .t_open_bracket => t_open_bracket(p, errors),
                .t_open_brace => t_open_brace(p, errors),
                .t_less_than => t_less_than(p, level, errors, flags),
                .t_import => t_import(p, level),
                .t_open_paren => t_open_paren(p, level),
                .t_private_identifier => t_private_identifier(p, level),
                .t_identifier => t_identifier(p, level),
                .t_false => t_false(p),
                .t_true => t_true(p),
                .t_null => t_null(p),
                .t_this => t_this(p),
                .t_template_head => t_template_head(p),
                .t_numeric_literal => t_numeric_literal(p),
                .t_big_integer_literal => t_big_integer_literal(p),
                .t_string_literal, .t_no_substitution_template_literal => p.parseStringLiteral(),
                .t_slash_equals, .t_slash => t_slash(p),
                .t_void => t_void(p),
                .t_typeof => t_typeof(p),
                .t_delete => t_delete(p),
                .t_plus => t_plus(p),
                .t_minus => t_minus(p),
                .t_tilde => t_tilde(p),
                .t_exclamation => t_exclamation(p),
                .t_minus_minus => t_minus_minus(p),
                .t_plus_plus => t_plus_plus(p),
                .t_function => t_function(p),
                .t_class => t_class(p),
                .t_new => t_new(p, flags),
                .t_super => t_super(p, level),
                else => {
                    @branchHint(.cold);
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
            };
        }
    };
}

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const B = js_ast.B;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeList = js_ast.ExprNodeList;
const LocRef = js_ast.LocRef;

const G = js_ast.G;
const Arg = G.Arg;
const Property = G.Property;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const AsyncPrefixExpression = js_parser.AsyncPrefixExpression;
const DeferredErrors = js_parser.DeferredErrors;
const FnOrArrowDataParse = js_parser.FnOrArrowDataParse;
const JSXTransformType = js_parser.JSXTransformType;
const ParenExprOpts = js_parser.ParenExprOpts;
const ParseClassOptions = js_parser.ParseClassOptions;
const Prefill = js_parser.Prefill;
const PropertyOpts = js_parser.PropertyOpts;
const TypeParameterFlag = js_parser.TypeParameterFlag;
const TypeScript = js_parser.TypeScript;

const std = @import("std");
const List = std.ArrayListUnmanaged;
const ListManaged = std.array_list.Managed;
