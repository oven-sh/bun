pub fn ParseSuffix(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const is_typescript_enabled = P.is_typescript_enabled;

        fn handleTypescriptAs(p: *P, level: Level) anyerror!Continuation {
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
                        return .done;
                    },
                    else => {},
                }

                if (p.lexer.token.isAssign()) {
                    p.forbid_suffix_after_as_loc = p.lexer.loc();
                    return .done;
                }
                return .next;
            }
            return .done;
        }

        fn t_dot(p: *P, optional_chain: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr) anyerror!Continuation {
            try p.lexer.next();
            const target = left.*;

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
                left.* = p.newExpr(E.Index{
                    .target = target,
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

                left.* = p.newExpr(
                    E.Dot{
                        .target = target,
                        .name = name,
                        .name_loc = name_loc,
                        .optional_chain = old_optional_chain,
                    },
                    left.loc,
                );
            }
            optional_chain.* = old_optional_chain;
            return .next;
        }
        fn t_question_dot(p: *P, level: Level, optional_chain: *?OptionalChain, left: *Expr) anyerror!Continuation {
            try p.lexer.next();
            var optional_start: ?OptionalChain = OptionalChain.start;

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
                    left.* = p.newExpr(
                        E.Index{ .target = left.*, .index = index, .optional_chain = optional_start },
                        left.loc,
                    );
                },

                .t_open_paren => {
                    // "a?.()"
                    if (level.gte(.call)) {
                        return .done;
                    }

                    const list_loc = try p.parseCallArgs();
                    left.* = p.newExpr(E.Call{
                        .target = left.*,
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
                        return .done;
                    }

                    const list_loc = try p.parseCallArgs();
                    left.* = p.newExpr(E.Call{
                        .target = left.*,
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
                        left.* = p.newExpr(E.Index{
                            .target = left.*,
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

                        left.* = p.newExpr(E.Dot{
                            .target = left.*,
                            .name = name,
                            .name_loc = name_loc,
                            .optional_chain = optional_start,
                        }, left.loc);
                    }
                },
            }

            // Only continue if we have started
            if ((optional_start orelse .continuation) == .start) {
                optional_chain.* = .continuation;
            }

            return .next;
        }
        fn t_no_substitution_template_literal(p: *P, _: Level, _: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr) anyerror!Continuation {
            if (old_optional_chain != null) {
                p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
            }
            // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
            const head = p.lexer.rawTemplateContents();
            try p.lexer.next();

            left.* = p.newExpr(E.Template{
                .tag = left.*,
                .head = .{ .raw = head },
            }, left.loc);
            return .next;
        }
        fn t_template_head(p: *P, _: Level, _: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr) anyerror!Continuation {
            if (old_optional_chain != null) {
                p.log.addRangeError(p.source, p.lexer.range(), "Template literals cannot have an optional chain as a tag") catch unreachable;
            }
            // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
            const head = p.lexer.rawTemplateContents();
            const partsGroup = try p.parseTemplateParts(true);
            const tag = left.*;
            left.* = p.newExpr(E.Template{
                .tag = tag,
                .head = .{ .raw = head },
                .parts = partsGroup,
            }, left.loc);
            return .next;
        }
        fn t_open_bracket(p: *P, optional_chain: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr, flags: Expr.EFlags) anyerror!Continuation {
            // When parsing a decorator, ignore EIndex expressions since they may be
            // part of a computed property:
            //
            //   class Foo {
            //     @foo ['computed']() {}
            //   }
            //
            // This matches the behavior of the TypeScript compiler.
            if (flags == .ts_decorator) {
                return .done;
            }

            try p.lexer.next();

            // Allow "in" inside the brackets
            const old_allow_in = p.allow_in;
            p.allow_in = true;

            const index = try p.parseExpr(.lowest);

            p.allow_in = old_allow_in;

            try p.lexer.expect(.t_close_bracket);

            left.* = p.newExpr(E.Index{
                .target = left.*,
                .index = index,
                .optional_chain = old_optional_chain,
            }, left.loc);
            optional_chain.* = old_optional_chain;
            return .next;
        }
        fn t_open_paren(p: *P, level: Level, optional_chain: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr) anyerror!Continuation {
            if (level.gte(.call)) {
                return .done;
            }

            const list_loc = try p.parseCallArgs();
            left.* = p.newExpr(
                E.Call{
                    .target = left.*,
                    .args = list_loc.list,
                    .close_paren_loc = list_loc.loc,
                    .optional_chain = old_optional_chain,
                },
                left.loc,
            );
            optional_chain.* = old_optional_chain;
            return .next;
        }
        fn t_question(p: *P, level: Level, noalias errors: ?*DeferredErrors, left: *Expr) anyerror!Continuation {
            if (level.gte(.conditional)) {
                return .done;
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
                return .done;
            }

            const ternary = p.newExpr(E.If{
                .test_ = left.*,
                .yes = undefined,
                .no = undefined,
            }, left.loc);

            // Allow "in" in between "?" and ":"
            const old_allow_in = p.allow_in;
            p.allow_in = true;

            // condition ? yes : no
            //             ^
            try p.parseExprWithFlags(.comma, .none, &ternary.data.e_if.yes);

            p.allow_in = old_allow_in;

            // condition ? yes : no
            //                 ^
            try p.lexer.expect(.t_colon);

            // condition ? yes : no
            //                   ^
            try p.parseExprWithFlags(.comma, .none, &ternary.data.e_if.no);

            // condition ? yes : no
            //                     ^

            left.* = ternary;
            return .next;
        }
        fn t_exclamation(p: *P, optional_chain: *?OptionalChain, old_optional_chain: ?OptionalChain) anyerror!Continuation {
            // Skip over TypeScript non-null assertions
            if (p.lexer.has_newline_before) {
                return .done;
            }

            if (!is_typescript_enabled) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            try p.lexer.next();
            optional_chain.* = old_optional_chain;

            return .next;
        }
        fn t_minus_minus(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (p.lexer.has_newline_before or level.gte(.postfix)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Unary{ .op = .un_post_dec, .value = left.* }, left.loc);
            return .next;
        }
        fn t_plus_plus(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (p.lexer.has_newline_before or level.gte(.postfix)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Unary{ .op = .un_post_inc, .value = left.* }, left.loc);
            return .next;
        }
        fn t_comma(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.comma)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_comma, .left = left.*, .right = try p.parseExpr(.comma) }, left.loc);
            return .next;
        }
        fn t_plus(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.add)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_add, .left = left.*, .right = try p.parseExpr(.add) }, left.loc);
            return .next;
        }
        fn t_plus_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_add_assign, .left = left.*, .right = try p.parseExpr(@as(Op.Level, @enumFromInt(@intFromEnum(Op.Level.assign) - 1))) }, left.loc);
            return .next;
        }
        fn t_minus(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.add)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_sub, .left = left.*, .right = try p.parseExpr(.add) }, left.loc);
            return .next;
        }
        fn t_minus_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_sub_assign, .left = left.*, .right = try p.parseExpr(Op.Level.sub(Op.Level.assign, 1)) }, left.loc);
            return .next;
        }
        fn t_asterisk(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.multiply)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_mul, .left = left.*, .right = try p.parseExpr(.multiply) }, left.loc);
            return .next;
        }
        fn t_asterisk_asterisk(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.exponentiation)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_pow, .left = left.*, .right = try p.parseExpr(Op.Level.exponentiation.sub(1)) }, left.loc);
            return .next;
        }
        fn t_asterisk_asterisk_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_pow_assign, .left = left.*, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_asterisk_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_mul_assign, .left = left.*, .right = try p.parseExpr(Op.Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_percent(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.multiply)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_rem, .left = left.*, .right = try p.parseExpr(Op.Level.multiply) }, left.loc);
            return .next;
        }
        fn t_percent_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_rem_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_slash(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.multiply)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_div, .left = left.*, .right = try p.parseExpr(Level.multiply) }, left.loc);
            return .next;
        }
        fn t_slash_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_div_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_equals_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.equals)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_loose_eq, .left = left.*, .right = try p.parseExpr(Level.equals) }, left.loc);
            return .next;
        }
        fn t_exclamation_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.equals)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_loose_ne, .left = left.*, .right = try p.parseExpr(Level.equals) }, left.loc);
            return .next;
        }
        fn t_equals_equals_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.equals)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_strict_eq, .left = left.*, .right = try p.parseExpr(Level.equals) }, left.loc);
            return .next;
        }
        fn t_exclamation_equals_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.equals)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_strict_ne, .left = left.*, .right = try p.parseExpr(Level.equals) }, left.loc);
            return .next;
        }
        fn t_less_than(p: *P, level: Level, optional_chain: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr) anyerror!Continuation {
            // TypeScript allows type arguments to be specified with angle brackets
            // inside an expression. Unlike in other languages, this unfortunately
            // appears to require backtracking to parse.
            if (is_typescript_enabled and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                optional_chain.* = old_optional_chain;
                return .next;
            }

            if (level.gte(.compare)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_lt, .left = left.*, .right = try p.parseExpr(.compare) }, left.loc);
            return .next;
        }
        fn t_less_than_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.compare)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_le, .left = left.*, .right = try p.parseExpr(.compare) }, left.loc);
            return .next;
        }
        fn t_greater_than(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.compare)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_gt, .left = left.*, .right = try p.parseExpr(.compare) }, left.loc);
            return .next;
        }
        fn t_greater_than_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.compare)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_ge, .left = left.*, .right = try p.parseExpr(.compare) }, left.loc);
            return .next;
        }
        fn t_less_than_less_than(p: *P, level: Level, optional_chain: *?OptionalChain, old_optional_chain: ?OptionalChain, left: *Expr) anyerror!Continuation {
            // TypeScript allows type arguments to be specified with angle brackets
            // inside an expression. Unlike in other languages, this unfortunately
            // appears to require backtracking to parse.
            if (is_typescript_enabled and p.trySkipTypeScriptTypeArgumentsWithBacktracking()) {
                optional_chain.* = old_optional_chain;
                return .next;
            }

            if (level.gte(.shift)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_shl, .left = left.*, .right = try p.parseExpr(.shift) }, left.loc);
            return .next;
        }
        fn t_less_than_less_than_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_shl_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_greater_than_greater_than(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.shift)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_shr, .left = left.*, .right = try p.parseExpr(.shift) }, left.loc);
            return .next;
        }
        fn t_greater_than_greater_than_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_shr_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_greater_than_greater_than_greater_than(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.shift)) {
                return .done;
            }
            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_u_shr, .left = left.*, .right = try p.parseExpr(.shift) }, left.loc);
            return .next;
        }
        fn t_greater_than_greater_than_greater_than_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_u_shr_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_question_question(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.nullish_coalescing)) {
                return .done;
            }
            try p.lexer.next();
            const prev = left.*;
            left.* = p.newExpr(E.Binary{ .op = .bin_nullish_coalescing, .left = prev, .right = try p.parseExpr(.nullish_coalescing) }, left.loc);
            return .next;
        }
        fn t_question_question_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_nullish_coalescing_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_bar_bar(p: *P, level: Level, left: *Expr, flags: Expr.EFlags) anyerror!Continuation {
            if (level.gte(.logical_or)) {
                return .done;
            }

            // Prevent "||" inside "??" from the right
            if (level.eql(.nullish_coalescing)) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            try p.lexer.next();
            const right = try p.parseExpr(.logical_or);
            left.* = p.newExpr(E.Binary{ .op = Op.Code.bin_logical_or, .left = left.*, .right = right }, left.loc);

            if (level.lt(.nullish_coalescing)) {
                try p.parseSuffix(left, Level.nullish_coalescing.addF(1), null, flags);

                if (p.lexer.token == .t_question_question) {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                }
            }
            return .next;
        }
        fn t_bar_bar_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_logical_or_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_ampersand_ampersand(p: *P, level: Level, left: *Expr, flags: Expr.EFlags) anyerror!Continuation {
            if (level.gte(.logical_and)) {
                return .done;
            }

            // Prevent "&&" inside "??" from the right
            if (level.eql(.nullish_coalescing)) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_logical_and, .left = left.*, .right = try p.parseExpr(.logical_and) }, left.loc);

            // Prevent "&&" inside "??" from the left
            if (level.lt(.nullish_coalescing)) {
                try p.parseSuffix(left, Level.nullish_coalescing.addF(1), null, flags);

                if (p.lexer.token == .t_question_question) {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                }
            }
            return .next;
        }
        fn t_ampersand_ampersand_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_logical_and_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_bar(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.bitwise_or)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_bitwise_or, .left = left.*, .right = try p.parseExpr(.bitwise_or) }, left.loc);
            return .next;
        }
        fn t_bar_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_bitwise_or_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_ampersand(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.bitwise_and)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_bitwise_and, .left = left.*, .right = try p.parseExpr(.bitwise_and) }, left.loc);
            return .next;
        }
        fn t_ampersand_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_bitwise_and_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_caret(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.bitwise_xor)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_bitwise_xor, .left = left.*, .right = try p.parseExpr(.bitwise_xor) }, left.loc);
            return .next;
        }
        fn t_caret_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();
            left.* = p.newExpr(E.Binary{ .op = .bin_bitwise_xor_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_equals(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.assign)) {
                return .done;
            }

            try p.lexer.next();

            left.* = p.newExpr(E.Binary{ .op = .bin_assign, .left = left.*, .right = try p.parseExpr(Level.assign.sub(1)) }, left.loc);
            return .next;
        }
        fn t_in(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.compare) or !p.allow_in) {
                return .done;
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
            left.* = p.newExpr(E.Binary{ .op = .bin_in, .left = left.*, .right = try p.parseExpr(.compare) }, left.loc);
            return .next;
        }
        fn t_instanceof(p: *P, level: Level, left: *Expr) anyerror!Continuation {
            if (level.gte(.compare)) {
                return .done;
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
            left.* = p.newExpr(E.Binary{ .op = .bin_instanceof, .left = left.*, .right = try p.parseExpr(.compare) }, left.loc);
            return .next;
        }

        pub fn parseSuffix(p: *P, left_and_out: *Expr, level: Level, noalias errors: ?*DeferredErrors, flags: Expr.EFlags) anyerror!void {
            var left_value = left_and_out.*;
            // Zig has a bug where it creates a new address to stack locals each & usage.
            const left = &left_value;

            var optional_chain_: ?OptionalChain = null;
            const optional_chain = &optional_chain_;
            while (true) {
                if (p.lexer.loc().start == p.after_arrow_body_loc.start) {
                    defer left_and_out.* = left_value;
                    next_token: switch (p.lexer.token) {
                        .t_comma => {
                            if (level.gte(.comma)) {
                                return;
                            }

                            try p.lexer.next();
                            left.* = p.newExpr(E.Binary{
                                .op = .bin_comma,
                                .left = left.*,
                                .right = try p.parseExpr(.comma),
                            }, left.loc);

                            continue :next_token p.lexer.token;
                        },
                        else => {
                            return;
                        },
                    }
                }

                if (comptime is_typescript_enabled) {
                    // Stop now if this token is forbidden to follow a TypeScript "as" cast
                    if (p.forbid_suffix_after_as_loc.start > -1 and p.lexer.loc().start == p.forbid_suffix_after_as_loc.start) {
                        break;
                    }
                }

                // Reset the optional chain flag by default. That way we won't accidentally
                // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
                const old_optional_chain = optional_chain.*;
                optional_chain.* = null;

                // Each of these tokens are split into a function to conserve
                // stack space. Currently in Zig, the compiler does not reuse
                // stack space between scopes This means that having a large
                // function with many scopes and local variables consumes
                // enormous amounts of stack space.
                const continuation = switch (p.lexer.token) {
                    inline .t_ampersand,
                    .t_ampersand_ampersand_equals,
                    .t_ampersand_equals,
                    .t_asterisk,
                    .t_asterisk_asterisk,
                    .t_asterisk_asterisk_equals,
                    .t_asterisk_equals,
                    .t_bar,
                    .t_bar_bar_equals,
                    .t_bar_equals,
                    .t_caret,
                    .t_caret_equals,
                    .t_comma,
                    .t_equals,
                    .t_equals_equals,
                    .t_equals_equals_equals,
                    .t_exclamation_equals,
                    .t_exclamation_equals_equals,
                    .t_greater_than,
                    .t_greater_than_equals,
                    .t_greater_than_greater_than,
                    .t_greater_than_greater_than_equals,
                    .t_greater_than_greater_than_greater_than,
                    .t_greater_than_greater_than_greater_than_equals,
                    .t_in,
                    .t_instanceof,
                    .t_less_than_equals,
                    .t_less_than_less_than_equals,
                    .t_minus,
                    .t_minus_equals,
                    .t_minus_minus,
                    .t_percent,
                    .t_percent_equals,
                    .t_plus,
                    .t_plus_equals,
                    .t_plus_plus,
                    .t_question_question,
                    .t_question_question_equals,
                    .t_slash,
                    .t_slash_equals,
                    => |tag| @field(@This(), @tagName(tag))(p, level, left),
                    .t_exclamation => t_exclamation(p, optional_chain, old_optional_chain),
                    .t_bar_bar => t_bar_bar(p, level, left, flags),
                    .t_ampersand_ampersand => t_ampersand_ampersand(p, level, left, flags),
                    .t_question => t_question(p, level, errors, left),
                    .t_question_dot => t_question_dot(p, level, optional_chain, left),
                    .t_template_head => t_template_head(p, level, optional_chain, old_optional_chain, left),
                    .t_less_than => t_less_than(p, level, optional_chain, old_optional_chain, left),
                    .t_open_paren => t_open_paren(p, level, optional_chain, old_optional_chain, left),
                    .t_no_substitution_template_literal => t_no_substitution_template_literal(p, level, optional_chain, old_optional_chain, left),
                    .t_open_bracket => t_open_bracket(p, optional_chain, old_optional_chain, left, flags),
                    .t_dot => t_dot(p, optional_chain, old_optional_chain, left),
                    .t_less_than_less_than => t_less_than_less_than(p, level, optional_chain, old_optional_chain, left),
                    else => handleTypescriptAs(p, level),
                };

                switch (try continuation) {
                    .next => {},
                    .done => break,
                }
            }

            left_and_out.* = left_value;
        }
    };
}
const Continuation = enum { next, done };
const string = []const u8;

const bun = @import("bun");

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const OptionalChain = js_ast.OptionalChain;

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
