pub fn Parse(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const is_jsx_enabled = P.is_jsx_enabled;
        const is_typescript_enabled = P.is_typescript_enabled;

        pub const parsePrefix = @import("./parsePrefix.zig").ParsePrefix(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parsePrefix;
        pub const parseSuffix = @import("./parseSuffix.zig").ParseSuffix(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseSuffix;
        pub const parseStmt = @import("./parseStmt.zig").ParseStmt(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseStmt;
        pub const parseProperty = @import("./parseProperty.zig").ParseProperty(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseProperty;
        pub const parseFn = @import("./parseFn.zig").ParseFn(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseFn;
        pub const parseFnStmt = @import("./parseFn.zig").ParseFn(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseFnStmt;
        pub const parseFnExpr = @import("./parseFn.zig").ParseFn(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseFnExpr;
        pub const parseFnBody = @import("./parseFn.zig").ParseFn(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseFnBody;
        pub const parseArrowBody = @import("./parseFn.zig").ParseFn(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseArrowBody;
        pub const parseJSXElement = @import("./parseJSXElement.zig").ParseJSXElement(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseJSXElement;
        pub const parseImportExpr = @import("./parseImportExport.zig").ParseImportExport(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseImportExpr;
        pub const parseImportClause = @import("./parseImportExport.zig").ParseImportExport(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseImportClause;
        pub const parseExportClause = @import("./parseImportExport.zig").ParseImportExport(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseExportClause;
        pub const parseTypeScriptDecorators = @import("./parseTypescript.zig").ParseTypescript(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseTypeScriptDecorators;
        pub const parseTypeScriptNamespaceStmt = @import("./parseTypescript.zig").ParseTypescript(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseTypeScriptNamespaceStmt;
        pub const parseTypeScriptImportEqualsStmt = @import("./parseTypescript.zig").ParseTypescript(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseTypeScriptImportEqualsStmt;
        pub const parseTypescriptEnumStmt = @import("./parseTypescript.zig").ParseTypescript(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only).parseTypescriptEnumStmt;

        pub inline fn parseExprOrBindings(p: *P, level: Level, errors: ?*DeferredErrors, expr: *Expr) anyerror!void {
            return p.parseExprCommon(level, errors, Expr.EFlags.none, expr);
        }

        pub inline fn parseExpr(p: *P, level: Level) anyerror!Expr {
            var expr: Expr = undefined;
            try p.parseExprCommon(level, null, Expr.EFlags.none, &expr);
            return expr;
        }

        pub inline fn parseExprWithFlags(p: *P, level: Level, flags: Expr.EFlags, expr: *Expr) anyerror!void {
            return p.parseExprCommon(level, null, flags, expr);
        }

        pub fn parseExprCommon(p: *P, level: Level, errors: ?*DeferredErrors, flags: Expr.EFlags, expr: *Expr) anyerror!void {
            if (!p.stack_check.isSafeToRecurse()) {
                try bun.throwStackOverflow();
            }

            const had_pure_comment_before = p.lexer.has_pure_comment_before and !p.options.ignore_dce_annotations;
            expr.* = try p.parsePrefix(level, errors, flags);

            // There is no formal spec for "__PURE__" comments but from reverse-
            // engineering, it looks like they apply to the next CallExpression or
            // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
            // to the expression "a().b()".

            if (had_pure_comment_before and level.lt(.call)) {
                try p.parseSuffix(expr, @as(Level, @enumFromInt(@intFromEnum(Level.call) - 1)), errors, flags);
                switch (expr.data) {
                    .e_call => |ex| {
                        ex.can_be_unwrapped_if_unused = .if_unused;
                    },
                    .e_new => |ex| {
                        ex.can_be_unwrapped_if_unused = .if_unused;
                    },
                    else => {},
                }
            }

            try p.parseSuffix(expr, level, errors, flags);
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
                        switch ((property.key orelse p.panic("Internal error: Expected property to have a key.", .{})).data) {
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
                .ts_decorators = ExprNodeList.fromOwnedSlice(class_opts.ts_decorators),
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
            return ExprListLoc{ .list = ExprNodeList.moveFromList(&args), .loc = close_paren_loc };
        }

        pub fn parseJSXPropValueIdentifier(noalias p: *P, previous_string_with_backslash_loc: *logger.Loc) !Expr {
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

                try items_list.ensureUnusedCapacity(1);
                const item: *Expr = &items_list.unusedCapacitySlice()[0];
                try p.parseExprOrBindings(.comma, &errors, item);
                items_list.items.len += 1;

                if (is_spread) {
                    item.* = p.newExpr(E.Spread{ .value = item.* }, loc);
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
                    item.* = Expr.assign(item.*, try p.parseExpr(.comma));
                }

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
                return p.newExpr(E.Call{
                    .target = async_expr,
                    .args = ExprNodeList.fromOwnedSlice(items),
                }, loc);
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
                } else if (strings.toUTF8AllocWithTypeWithoutInvalidSurrogatePairs(p.lexer.allocator, estr.slice16())) |alias_utf8| {
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

                            var decls_list = try p.parseAndDeclareDecls(.other, opts);
                            const decls: G.Decl.List = .moveFromList(&decls_list);
                            return ExprOrLetStmt{
                                .stmt_or_expr = js_ast.StmtOrExpr{
                                    .stmt = p.s(S.Local{
                                        .kind = .k_let,
                                        .decls = decls,
                                        .is_export = opts.is_export,
                                    }, token_range.loc),
                                },
                                .decls = decls.slice(),
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
                    var decls_list = try p.parseAndDeclareDecls(.constant, opts);
                    const decls: G.Decl.List = .moveFromList(&decls_list);
                    if (!opts.is_for_loop_init) {
                        try p.requireInitializers(.k_using, decls.slice());
                    }
                    return ExprOrLetStmt{
                        .stmt_or_expr = js_ast.StmtOrExpr{
                            .stmt = p.s(S.Local{
                                .kind = .k_using,
                                .decls = decls,
                                .is_export = false,
                            }, token_range.loc),
                        },
                        .decls = decls.slice(),
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
                var value = if (p.lexer.token == .t_identifier and strings.eqlComptime(raw2, "using")) value: {
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
                        var decls_list = try p.parseAndDeclareDecls(.constant, opts);
                        const decls: G.Decl.List = .moveFromList(&decls_list);
                        if (!opts.is_for_loop_init) {
                            try p.requireInitializers(.k_await_using, decls.slice());
                        }
                        return ExprOrLetStmt{
                            .stmt_or_expr = js_ast.StmtOrExpr{
                                .stmt = p.s(S.Local{
                                    .kind = .k_await_using,
                                    .decls = decls,
                                    .is_export = false,
                                }, token_range.loc),
                            },
                            .decls = decls.slice(),
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
                try p.parseSuffix(&value, .prefix, null, .none);
                var expr = p.newExpr(
                    E.Await{ .value = value },
                    token_range.loc,
                );
                try p.parseSuffix(&expr, .lowest, null, .none);
                return ExprOrLetStmt{
                    .stmt_or_expr = js_ast.StmtOrExpr{
                        .expr = expr,
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
            var result = ExprOrLetStmt{
                .stmt_or_expr = js_ast.StmtOrExpr{
                    .expr = p.newExpr(E.Identifier{ .ref = ref }, token_range.loc),
                },
            };
            try p.parseSuffix(&result.stmt_or_expr.expr, .lowest, null, .none);
            return result;
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
    };
}

const string = []const u8;

const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const Flags = js_ast.Flags;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Arg = G.Arg;
const Decl = G.Decl;
const Property = G.Property;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const AwaitOrYield = js_parser.AwaitOrYield;
const DeferredArrowArgErrors = js_parser.DeferredArrowArgErrors;
const DeferredErrors = js_parser.DeferredErrors;
const ExprListLoc = js_parser.ExprListLoc;
const ExprOrLetStmt = js_parser.ExprOrLetStmt;
const FnOrArrowDataParse = js_parser.FnOrArrowDataParse;
const JSXTransformType = js_parser.JSXTransformType;
const LocList = js_parser.LocList;
const ParenExprOpts = js_parser.ParenExprOpts;
const ParseBindingOptions = js_parser.ParseBindingOptions;
const ParseClassOptions = js_parser.ParseClassOptions;
const ParseStatementOptions = js_parser.ParseStatementOptions;
const ParsedPath = js_parser.ParsedPath;
const Prefill = js_parser.Prefill;
const PropertyOpts = js_parser.PropertyOpts;
const StmtList = js_parser.StmtList;
const TypeScript = js_parser.TypeScript;
const options = js_parser.options;

const std = @import("std");
const List = std.ArrayListUnmanaged;
const ListManaged = std.array_list.Managed;
