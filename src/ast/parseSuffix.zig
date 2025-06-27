pub fn ParseSuffix(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const jsx_transform_type = P.jsx_transform_type;
        const allow_macros = P.allow_macros;
        const BinaryExpressionVisitor = P.BinaryExpressionVisitor;
        const is_typescript_enabled = P.is_typescript_enabled;
        const createDefaultName = P.createDefaultName;
        const track_symbol_usage_during_parse_pass = P.track_symbol_usage_during_parse_pass;
        const extractDeclsForBinding = P.extractDeclsForBinding;

        pub fn parseSuffix(noalias p: *P, _left: Expr, level: Level, noalias errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!Expr {
            var left = _left;
            var optional_chain: ?js_ast.OptionalChain = null;
            while (true) {
                if (p.lexer.loc().start == p.after_arrow_body_loc.start) {
                    while (true) {
                        switch (p.lexer.token) {
                            .t_comma => {
                                if (level.gte(.comma)) {
                                    return left;
                                }

                                try p.lexer.next();
                                left = p.newExpr(E.Binary{
                                    .op = .bin_comma,
                                    .left = left,
                                    .right = try p.parseExpr(.comma),
                                }, left.loc);
                            },
                            else => {
                                return left;
                            },
                        }
                    }
                }

                if (comptime is_typescript_enabled) {
                    // Stop now if this token is forbidden to follow a TypeScript "as" cast
                    if (p.forbid_suffix_after_as_loc.start > -1 and p.lexer.loc().start == p.forbid_suffix_after_as_loc.start) {
                        return left;
                    }
                }

                // Reset the optional chain flag by default. That way we won't accidentally
                // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
                const old_optional_chain = optional_chain;
                optional_chain = null;
                switch (p.lexer.token) {
                    .t_dot => {
                        try p.lexer.next();
                        if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                            // "a.#b"
                            // "a?.b.#c"
                            switch (left.data) {
                                .e_super => {
                                    try p.lexer.expected(.t_identifier);
                                },
                                else => {},
                            }

                            const name = p.lexer.identifier;
                            const name_loc = p.lexer.loc();
                            try p.lexer.next();
                            const ref = p.storeNameInRef(name) catch unreachable;
                            left = p.newExpr(E.Index{
                                .target = left,
                                .index = p.newExpr(
                                    E.PrivateIdentifier{
                                        .ref = ref,
                                    },
                                    name_loc,
                                ),
                                .optional_chain = old_optional_chain,
                            }, left.loc);
                        } else {
                            // "a.b"
                            // "a?.b.c"
                            if (!p.lexer.isIdentifierOrKeyword()) {
                                try p.lexer.expect(.t_identifier);
                            }

                            const name = p.lexer.identifier;
                            const name_loc = p.lexer.loc();
                            try p.lexer.next();

                            left = p.newExpr(E.Dot{ .target = left, .name = name, .name_loc = name_loc, .optional_chain = old_optional_chain }, left.loc);
                        }

                        optional_chain = old_optional_chain;
                    },
                    .t_question_dot => {
                        try p.lexer.next();
                        var optional_start: ?js_ast.OptionalChain = js_ast.OptionalChain.start;

                        // Remove unnecessary optional chains
                        if (p.options.features.minify_syntax) {
                            const result = SideEffects.toNullOrUndefined(p, left.data);
                            if (result.ok and !result.value) {
                                optional_start = null;
                            }
                        }

                        switch (p.lexer.token) {
                            .t_open_bracket => {
                                // "a?.[b]"
                                try p.lexer.next();

                                // allow "in" inside the brackets;
                                const old_allow_in = p.allow_in;
                                p.allow_in = true;

                                const index = try p.parseExpr(.lowest);

                                p.allow_in = old_allow_in;

                                try p.lexer.expect(.t_close_bracket);
                                left = p.newExpr(
                                    E.Index{ .target = left, .index = index, .optional_chain = optional_start },
                                    left.loc,
                                );
                            },

                            .t_open_paren => {
                                // "a?.()"
                                if (level.gte(.call)) {
                                    return left;
                                }

                                const list_loc = try p.parseCallArgs();
                                left = p.newExpr(E.Call{
                                    .target = left,
                                    .args = list_loc.list,
                                    .close_paren_loc = list_loc.loc,
                                    .optional_chain = optional_start,
                                }, left.loc);
                            },
                            .t_less_than, .t_less_than_less_than => {
                                // "a?.<T>()"
                                if (comptime !is_typescript_enabled) {
                                    try p.lexer.expected(.t_identifier);
                                    return error.SyntaxError;
                                }

                                _ = try p.skipTypeScriptTypeArguments(false);
                                if (p.lexer.token != .t_open_paren) {
                                    try p.lexer.expected(.t_open_paren);
                                }

                                if (level.gte(.call)) {
                                    return left;
                                }

                                const list_loc = try p.parseCallArgs();
                                left = p.newExpr(E.Call{
                                    .target = left,
                                    .args = list_loc.list,
                                    .close_paren_loc = list_loc.loc,
                                    .optional_chain = optional_start,
                                }, left.loc);
                            },
                            else => {
                                if (p.lexer.token == .t_private_identifier and p.allow_private_identifiers) {
                                    // "a?.#b"
                                    const name = p.lexer.identifier;
                                    const name_loc = p.lexer.loc();
                                    try p.lexer.next();
                                    const ref = p.storeNameInRef(name) catch unreachable;
                                    left = p.newExpr(E.Index{
                                        .target = left,
                                        .index = p.newExpr(
                                            E.PrivateIdentifier{
                                                .ref = ref,
                                            },
                                            name_loc,
                                        ),
                                        .optional_chain = optional_start,
                                    }, left.loc);
                                } else {
                                    // "a?.b"
                                    if (!p.lexer.isIdentifierOrKeyword()) {
                                        try p.lexer.expect(.t_identifier);
                                    }
                                    const name = p.lexer.identifier;
                                    const name_loc = p.lexer.loc();
                                    try p.lexer.next();

                                    left = p.newExpr(E.Dot{
                                        .target = left,
                                        .name = name,
                                        .name_loc = name_loc,
                                        .optional_chain = optional_start,
                                    }, left.loc);
                                }
                            },
                        }

                        // Only continue if we have started
                        if ((optional_start orelse .continuation) == .start) {
                            optional_chain = .continuation;
                        }
                    },
                    .t_no_substitution_template_literal => {
                        if (old_optional_chain != null) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                        }
                        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                        const head = p.lexer.rawTemplateContents();
                        try p.lexer.next();
                        left = p.newExpr(E.Template{
                            .tag = left,
                            .head = .{ .raw = head },
                        }, left.loc);
                    },
                    .t_template_head => {
                        if (old_optional_chain != null) {
                            p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
                        }
                        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
                        const head = p.lexer.rawTemplateContents();
                        const partsGroup = try p.parseTemplateParts(true);
                        const tag = left;
                        left = p.newExpr(E.Template{
                            .tag = tag,
                            .head = .{ .raw = head },
                            .parts = partsGroup,
                        }, left.loc);
                    },
                    .t_open_bracket => {
                        // When parsing a decorator, ignore EIndex expressions since they may be
                        // part of a computed property:
                        //
                        //   class Foo {
                        //     @foo ['computed']() {}
                        //   }
                        //
                        // This matches the behavior of the TypeScript compiler.
                        if (flags == .ts_decorator) {
                            return left;
                        }

                        try p.lexer.next();

                        // Allow "in" inside the brackets
                        const old_allow_in = p.allow_in;
                        p.allow_in = true;

                        const index = try p.parseExpr(.lowest);

                        p.allow_in = old_allow_in;

                        try p.lexer.expect(.t_close_bracket);

                        left = p.newExpr(E.Index{
                            .target = left,
                            .index = index,
                            .optional_chain = old_optional_chain,
                        }, left.loc);
                        optional_chain = old_optional_chain;
                    },
                    .t_open_paren => {
                        if (level.gte(.call)) {
                            return left;
                        }

                        const list_loc = try p.parseCallArgs();
                        left = p.newExpr(
                            E.Call{
                                .target = left,
                                .args = list_loc.list,
                                .close_paren_loc = list_loc.loc,
                                .optional_chain = old_optional_chain,
                            },
                            left.loc,
                        );
                        optional_chain = old_optional_chain;
                    },
                    .t_question => {
                        if (level.gte(.conditional)) {
                            return left;
                        }
                        try p.lexer.next();

                        // Stop now if we're parsing one of these:
                        // "(a?) => {}"
                        // "(a?: b) => {}"
                        // "(a?, b?) => {}"
                        if (is_typescript_enabled and left.loc.start == p.latest_arrow_arg_loc.start and (p.lexer.token == .t_colon or
                            p.lexer.token == .t_close_paren or p.lexer.token == .t_comma))
                        {
                            if (errors == null) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                            errors.?.invalid_expr_after_question = p.lexer.range();
                            return left;
                        }

                        // Allow "in" in between "?" and ":"
                        const old_allow_in = p.allow_in;
                        p.allow_in = true;

                        const yes = try p.parseExpr(.comma);

                        p.allow_in = old_allow_in;

                        try p.lexer.expect(.t_colon);
                        const no = try p.parseExpr(.comma);

                        left = p.newExpr(E.If{
                            .test_ = left,
                            .yes = yes,
                            .no = no,
                        }, left.loc);
                    },
                    .t_exclamation => {
                        // Skip over TypeScript non-null assertions
                        if (p.lexer.has_newline_before) {
                            return left;
                        }

                        if (!is_typescript_enabled) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        try p.lexer.next();
                        optional_chain = old_optional_chain;
                    },
                    .t_minus_minus => {
                        if (p.lexer.has_newline_before or level.gte(.postfix)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Unary{ .op = .un_post_dec, .value = left }, left.loc);
                    },
                    .t_plus_plus => {
                        if (p.lexer.has_newline_before or level.gte(.postfix)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Unary{ .op = .un_post_inc, .value = left }, left.loc);
                    },
                    .t_comma => {
                        if (level.gte(.comma)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_comma, .left = left, .right = try p.parseExpr(.comma) }, left.loc);
                    },
                    .t_plus => {
                        if (level.gte(.add)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_add, .left = left, .right = try p.parseExpr(.add) }, left.loc);
                    },
                    .t_plus_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_add_assign, .left = left, .right = try p.parseExpr(@as(Op.Level, @enumFromInt(@intFromEnum(Op.Level.assign) - 1))) }, left.loc);
                    },
                    .t_minus => {
                        if (level.gte(.add)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_sub, .left = left, .right = try p.parseExpr(.add) }, left.loc);
                    },
                    .t_minus_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_sub_assign, .left = left, .right = try p.parseExpr(Op.Level.sub(Op.Level.assign, 1)) }, left.loc);
                    },
                    .t_asterisk => {
                        if (level.gte(.multiply)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_mul, .left = left, .right = try p.parseExpr(.multiply) }, left.loc);
                    },
                    .t_asterisk_asterisk => {
                        if (level.gte(.exponentiation)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_pow, .left = left, .right = try p.parseExpr(Op.Level.exponentiation.sub(1)) }, left.loc);
                    },
                    .t_asterisk_asterisk_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_pow_assign, .left = left, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                    },
                    .t_asterisk_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_mul_assign, .left = left, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
                    },
                    .t_percent => {
                        if (level.gte(.multiply)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_rem, .left = left, .right = try p.parseExpr(Op.Level.multiply) }, left.loc);
                    },
                    .t_percent_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_rem_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_slash => {
                        if (level.gte(.multiply)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_div, .left = left, .right = try p.parseExpr(Level.multiply) }, left.loc);
                    },
                    .t_slash_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_div_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_equals_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_loose_eq, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_exclamation_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_loose_ne, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_equals_equals_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_strict_eq, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_exclamation_equals_equals => {
                        if (level.gte(.equals)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_strict_ne, .left = left, .right = try p.parseExpr(Level.equals) }, left.loc);
                    },
                    .t_less_than => {
                        // TypeScript allows type arguments to be specified with angle brackets
                        // inside an expression. Unlike in other languages, this unfortunately
                        // appears to require backtracking to parse.
                        if (is_typescript_enabled and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                            optional_chain = old_optional_chain;
                            continue;
                        }

                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_lt, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_less_than_equals => {
                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_le, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_greater_than => {
                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_gt, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_greater_than_equals => {
                        if (level.gte(.compare)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_ge, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_less_than_less_than => {
                        // TypeScript allows type arguments to be specified with angle brackets
                        // inside an expression. Unlike in other languages, this unfortunately
                        // appears to require backtracking to parse.
                        if (is_typescript_enabled and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                            optional_chain = old_optional_chain;
                            continue;
                        }

                        if (level.gte(.shift)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_shl, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                    },
                    .t_less_than_less_than_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_shl_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_greater_than_greater_than => {
                        if (level.gte(.shift)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_shr, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                    },
                    .t_greater_than_greater_than_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_shr_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_greater_than_greater_than_greater_than => {
                        if (level.gte(.shift)) {
                            return left;
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_u_shr, .left = left, .right = try p.parseExpr(.shift) }, left.loc);
                    },
                    .t_greater_than_greater_than_greater_than_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_u_shr_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_question_question => {
                        if (level.gte(.nullish_coalescing)) {
                            return left;
                        }
                        try p.lexer.next();
                        const prev = left;
                        left = p.newExpr(E.Binary{ .op = .bin_nullish_coalescing, .left = prev, .right = try p.parseExpr(.nullish_coalescing) }, left.loc);
                    },
                    .t_question_question_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_nullish_coalescing_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_bar_bar => {
                        if (level.gte(.logical_or)) {
                            return left;
                        }

                        // Prevent "||" inside "??" from the right
                        if (level.eql(.nullish_coalescing)) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        try p.lexer.next();
                        const right = try p.parseExpr(.logical_or);
                        left = p.newExpr(E.Binary{ .op = Op.Code.bin_logical_or, .left = left, .right = right }, left.loc);

                        if (level.lt(.nullish_coalescing)) {
                            left = try p.parseSuffix(left, Level.nullish_coalescing.addF(1), null, flags);

                            if (p.lexer.token == .t_question_question) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                        }
                    },
                    .t_bar_bar_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_logical_or_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_ampersand_ampersand => {
                        if (level.gte(.logical_and)) {
                            return left;
                        }

                        // Prevent "&&" inside "??" from the right
                        if (level.eql(.nullish_coalescing)) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_logical_and, .left = left, .right = try p.parseExpr(.logical_and) }, left.loc);

                        // Prevent "&&" inside "??" from the left
                        if (level.lt(.nullish_coalescing)) {
                            left = try p.parseSuffix(left, Level.nullish_coalescing.addF(1), null, flags);

                            if (p.lexer.token == .t_question_question) {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            }
                        }
                    },
                    .t_ampersand_ampersand_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_logical_and_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_bar => {
                        if (level.gte(.bitwise_or)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_bitwise_or, .left = left, .right = try p.parseExpr(.bitwise_or) }, left.loc);
                    },
                    .t_bar_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_bitwise_or_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_ampersand => {
                        if (level.gte(.bitwise_and)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_bitwise_and, .left = left, .right = try p.parseExpr(.bitwise_and) }, left.loc);
                    },
                    .t_ampersand_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_bitwise_and_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_caret => {
                        if (level.gte(.bitwise_xor)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_bitwise_xor, .left = left, .right = try p.parseExpr(.bitwise_xor) }, left.loc);
                    },
                    .t_caret_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_bitwise_xor_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_equals => {
                        if (level.gte(.assign)) {
                            return left;
                        }

                        try p.lexer.next();

                        left = p.newExpr(E.Binary{ .op = .bin_assign, .left = left, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
                    },
                    .t_in => {
                        if (level.gte(.compare) or !p.allow_in) {
                            return left;
                        }

                        // Warn about "!a in b" instead of "!(a in b)"
                        switch (left.data) {
                            .e_unary => |unary| {
                                if (unary.op == .un_not) {
                                    // TODO:
                                    // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                                }
                            },
                            else => {},
                        }

                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_in, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    .t_instanceof => {
                        if (level.gte(.compare)) {
                            return left;
                        }

                        // Warn about "!a instanceof b" instead of "!(a instanceof b)". Here's an
                        // example of code with this problem: https://github.com/mrdoob/three.js/pull/11182.
                        if (!p.options.suppress_warnings_about_weird_code) {
                            switch (left.data) {
                                .e_unary => |unary| {
                                    if (unary.op == .un_not) {
                                        // TODO:
                                        // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                                    }
                                },
                                else => {},
                            }
                        }
                        try p.lexer.next();
                        left = p.newExpr(E.Binary{ .op = .bin_instanceof, .left = left, .right = try p.parseExpr(.compare) }, left.loc);
                    },
                    else => {
                        // Handle the TypeScript "as" operator
                        // Handle the TypeScript "satisfies" operator
                        if (is_typescript_enabled and level.lt(.compare) and !p.lexer.has_newline_before and (p.lexer.isContextualKeyword("as") or p.lexer.isContextualKeyword("satisfies"))) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);

                            // These tokens are not allowed to follow a cast expression. This isn't
                            // an outright error because it may be on a new line, in which case it's
                            // the start of a new expression when it's after a cast:
                            //
                            //   x = y as z
                            //   (something);
                            //
                            switch (p.lexer.token) {
                                .t_plus_plus,
                                .t_minus_minus,
                                .t_no_substitution_template_literal,
                                .t_template_head,
                                .t_open_paren,
                                .t_open_bracket,
                                .t_question_dot,
                                => {
                                    p.forbid_suffix_after_as_loc = p.lexer.loc();
                                    return left;
                                },
                                else => {},
                            }

                            if (p.lexer.token.isAssign()) {
                                p.forbid_suffix_after_as_loc = p.lexer.loc();
                                return left;
                            }
                            continue;
                        }

                        return left;
                    },
                }
            }
        }

    };
}

// @sortImports

const bun = @import("bun");
const string = bun.string;

const js_ast = bun.JSAst;
const E = js_ast.E;
const Expr = js_ast.Expr;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const DeferredErrors = js_parser.DeferredErrors;
const JSXTransformType = js_parser.JSXTransformType;
const SideEffects = js_parser.SideEffects;
const TypeScript = js_parser.TypeScript;
const options = js_parser.options;
