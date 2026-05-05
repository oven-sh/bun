pub fn SkipTypescript(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);

        pub inline fn skipTypescriptReturnType(p: *P) anyerror!void {
            try p.skipTypeScriptTypeWithOpts(.lowest, TypeScript.SkipTypeOptions.Bitset.initOne(.is_return_type), false, {});
        }

        pub inline fn skipTypescriptReturnTypeWithMetadata(p: *P) anyerror!TypeScript.Metadata {
            var result = TypeScript.Metadata.default;
            try p.skipTypeScriptTypeWithOpts(.lowest, TypeScript.SkipTypeOptions.Bitset.initOne(.is_return_type), true, &result);
            return result;
        }

        pub inline fn skipTypeScriptType(p: *P, level: js_ast.Op.Level) anyerror!void {
            p.markTypeScriptOnly();
            try p.skipTypeScriptTypeWithOpts(level, TypeScript.SkipTypeOptions.empty, false, {});
        }

        pub inline fn skipTypeScriptTypeWithMetadata(p: *P, level: js_ast.Op.Level) anyerror!TypeScript.Metadata {
            p.markTypeScriptOnly();
            var result = TypeScript.Metadata.default;
            try p.skipTypeScriptTypeWithOpts(level, TypeScript.SkipTypeOptions.empty, true, &result);
            return result;
        }

        pub fn skipTypeScriptBinding(p: *P) anyerror!void {
            p.markTypeScriptOnly();
            switch (p.lexer.token) {
                .t_identifier, .t_this => {
                    try p.lexer.next();
                },
                .t_open_bracket => {
                    try p.lexer.next();

                    // "[, , a]"

                    while (p.lexer.token == .t_comma) {
                        try p.lexer.next();
                    }
                    // "[a, b]"
                    while (p.lexer.token != .t_close_bracket) {
                        // "[...a]"
                        if (p.lexer.token == .t_dot_dot_dot) {
                            try p.lexer.next();
                        }

                        try p.skipTypeScriptBinding();

                        if (p.lexer.token != .t_comma) {
                            break;
                        }
                        try p.lexer.next();
                    }

                    try p.lexer.expect(.t_close_bracket);
                },
                .t_open_brace => {
                    try p.lexer.next();

                    while (p.lexer.token != .t_close_brace) {
                        var found_identifier = false;

                        switch (p.lexer.token) {
                            .t_identifier => {
                                found_identifier = true;
                                try p.lexer.next();
                            },

                            // "{...x}"
                            .t_dot_dot_dot => {
                                try p.lexer.next();

                                if (p.lexer.token != .t_identifier) {
                                    try p.lexer.unexpected();
                                }

                                found_identifier = true;
                                try p.lexer.next();
                            },

                            // "{1: y}"
                            // "{'x': y}"
                            .t_string_literal, .t_numeric_literal => {
                                try p.lexer.next();
                            },

                            else => {
                                if (p.lexer.isIdentifierOrKeyword()) {
                                    // "{if: x}"
                                    try p.lexer.next();
                                } else {
                                    try p.lexer.unexpected();
                                }
                            },
                        }

                        if (p.lexer.token == .t_colon or !found_identifier) {
                            try p.lexer.expect(.t_colon);
                            try p.skipTypeScriptBinding();
                        }

                        if (p.lexer.token != .t_comma) {
                            break;
                        }

                        try p.lexer.next();
                    }

                    try p.lexer.expect(.t_close_brace);
                },
                else => {
                    // try p.lexer.unexpected();
                    return error.Backtrack;
                },
            }
        }

        pub fn skipTypescriptFnArgs(p: *P) anyerror!void {
            p.markTypeScriptOnly();

            try p.lexer.expect(.t_open_paren);

            while (p.lexer.token != .t_close_paren) {
                // "(...a)"
                if (p.lexer.token == .t_dot_dot_dot) {
                    try p.lexer.next();
                }

                try p.skipTypeScriptBinding();

                // "(a?)"
                if (p.lexer.token == .t_question) {
                    try p.lexer.next();
                }

                // "(a: any)"
                if (p.lexer.token == .t_colon) {
                    try p.lexer.next();
                    try p.skipTypeScriptType(.lowest);
                }

                // "(a, b)"
                if (p.lexer.token != .t_comma) {
                    break;
                }

                try p.lexer.next();
            }

            try p.lexer.expect(.t_close_paren);
        }

        /// This is a spot where the TypeScript grammar is highly ambiguous. Here are
        /// some cases that are valid:
        ///
        ///     let x = (y: any): (() => {}) => { };
        ///     let x = (y: any): () => {} => { };
        ///     let x = (y: any): (y) => {} => { };
        ///     let x = (y: any): (y[]) => {};
        ///     let x = (y: any): (a | b) => {};
        ///
        /// Here are some cases that aren't valid:
        ///
        ///     let x = (y: any): (y) => {};
        ///     let x = (y: any): (y) => {return 0};
        ///     let x = (y: any): asserts y is (y) => {};
        ///
        pub fn skipTypeScriptParenOrFnType(
            p: *P,
            comptime get_metadata: bool,
            result: if (get_metadata) *TypeScript.Metadata else void,
        ) anyerror!void {
            p.markTypeScriptOnly();

            if (p.trySkipTypeScriptArrowArgsWithBacktracking()) {
                try p.skipTypescriptReturnType();
                if (comptime get_metadata)
                    result.* = .m_function;
            } else {
                try p.lexer.expect(.t_open_paren);
                if (comptime get_metadata) {
                    result.* = try p.skipTypeScriptTypeWithMetadata(.lowest);
                } else {
                    try p.skipTypeScriptType(.lowest);
                }
                try p.lexer.expect(.t_close_paren);
            }
        }

        pub fn skipTypeScriptTypeWithOpts(
            p: *P,
            level: js_ast.Op.Level,
            opts: TypeScript.SkipTypeOptions.Bitset,
            comptime get_metadata: bool,
            result: if (get_metadata) *TypeScript.Metadata else void,
        ) anyerror!void {
            p.markTypeScriptOnly();

            while (true) {
                switch (p.lexer.token) {
                    .t_numeric_literal => {
                        try p.lexer.next();
                        if (comptime get_metadata) {
                            result.* = .m_number;
                        }
                    },
                    .t_big_integer_literal => {
                        try p.lexer.next();
                        if (comptime get_metadata) {
                            result.* = .m_bigint;
                        }
                    },
                    .t_string_literal, .t_no_substitution_template_literal => {
                        try p.lexer.next();
                        if (comptime get_metadata) {
                            result.* = .m_string;
                        }
                    },
                    .t_true, .t_false => {
                        try p.lexer.next();
                        if (comptime get_metadata) {
                            result.* = .m_boolean;
                        }
                    },
                    .t_null => {
                        try p.lexer.next();
                        if (comptime get_metadata) {
                            result.* = .m_null;
                        }
                    },
                    .t_void => {
                        try p.lexer.next();
                        if (comptime get_metadata) {
                            result.* = .m_void;
                        }
                    },
                    .t_const => {
                        const r = p.lexer.range();
                        try p.lexer.next();

                        // ["const: number]"
                        if (opts.contains(.allow_tuple_labels) and p.lexer.token == .t_colon) {
                            try p.log.addRangeError(p.source, r, "Unexpected \"const\"");
                        }
                    },

                    .t_this => {
                        try p.lexer.next();

                        // "function check(): this is boolean"
                        if (p.lexer.isContextualKeyword("is") and !p.lexer.has_newline_before) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            return;
                        }

                        if (comptime get_metadata) {
                            result.* = .m_object;
                        }
                    },
                    .t_minus => {
                        // "-123"
                        // "-123n"
                        try p.lexer.next();

                        if (p.lexer.token == .t_big_integer_literal) {
                            try p.lexer.next();
                            if (comptime get_metadata) {
                                result.* = .m_bigint;
                            }
                        } else {
                            try p.lexer.expect(.t_numeric_literal);
                            if (comptime get_metadata) {
                                result.* = .m_number;
                            }
                        }
                    },
                    .t_ampersand, .t_bar => {
                        // Support things like "type Foo = | A | B" and "type Foo = & A & B"
                        try p.lexer.next();
                        continue;
                    },
                    .t_import => {
                        // "import('fs')"
                        try p.lexer.next();

                        // "[import: number]"
                        if (opts.contains(.allow_tuple_labels) and p.lexer.token == .t_colon) {
                            return;
                        }

                        try p.lexer.expect(.t_open_paren);
                        try p.lexer.expect(.t_string_literal);

                        // "import('./foo.json', { assert: { type: 'json' } })"
                        // "import('./foo.json', { with: { type: 'json' } })"
                        if (p.lexer.token == .t_comma) {
                            try p.lexer.next();
                            try p.skipTypeScriptObjectType();

                            // "import('./foo.json', { assert: { type: 'json' } }, )"
                            // "import('./foo.json', { with: { type: 'json' } }, )"
                            if (p.lexer.token == .t_comma) {
                                try p.lexer.next();
                            }
                        }

                        try p.lexer.expect(.t_close_paren);
                    },
                    .t_new => {
                        // "new () => Foo"
                        // "new <T>() => Foo<T>"
                        try p.lexer.next();

                        // "[new: number]"
                        if (opts.contains(.allow_tuple_labels) and p.lexer.token == .t_colon) {
                            return;
                        }

                        _ = try p.skipTypeScriptTypeParameters(.{ .allow_const_modifier = true });
                        try p.skipTypeScriptParenOrFnType(get_metadata, result);
                    },
                    .t_less_than => {
                        // "<T>() => Foo<T>"
                        _ = try p.skipTypeScriptTypeParameters(.{ .allow_const_modifier = true });
                        try p.skipTypeScriptParenOrFnType(get_metadata, result);
                    },
                    .t_open_paren => {
                        // "(number | string)"
                        try p.skipTypeScriptParenOrFnType(get_metadata, result);
                    },
                    .t_identifier => {
                        const kind = TypeScript.Identifier.IMap.get(p.lexer.identifier) orelse .normal;

                        var check_type_parameters = true;

                        switch (kind) {
                            .prefix_keyof => {
                                try p.lexer.next();

                                // Valid:
                                //   "[keyof: string]"
                                //   "{[keyof: string]: number}"
                                //   "{[keyof in string]: number}"
                                //
                                // Invalid:
                                //   "A extends B ? keyof : string"
                                //
                                if ((p.lexer.token != .t_colon and p.lexer.token != .t_in) or (!opts.contains(.is_index_signature) and !opts.contains(.allow_tuple_labels))) {
                                    try p.skipTypeScriptType(.prefix);
                                }

                                if (comptime get_metadata) {
                                    result.* = .m_object;
                                }

                                break;
                            },
                            .prefix_readonly => {
                                try p.lexer.next();

                                if ((p.lexer.token != .t_colon and p.lexer.token != .t_in) or (!opts.contains(.is_index_signature) and !opts.contains(.allow_tuple_labels))) {
                                    try p.skipTypeScriptType(.prefix);
                                }

                                // assume array or tuple literal
                                if (comptime get_metadata) {
                                    result.* = .m_array;
                                }

                                break;
                            },
                            .infer => {
                                try p.lexer.next();

                                // "type Foo = Bar extends [infer T] ? T : null"
                                // "type Foo = Bar extends [infer T extends string] ? T : null"
                                // "type Foo = Bar extends [infer T extends string ? infer T : never] ? T : null"
                                // "type Foo = { [infer in Bar]: number }"
                                if ((p.lexer.token != .t_colon and p.lexer.token != .t_in) or (!opts.contains(.is_index_signature) and !opts.contains(.allow_tuple_labels))) {
                                    try p.lexer.expect(.t_identifier);
                                    if (p.lexer.token == .t_extends) {
                                        _ = p.trySkipTypeScriptConstraintOfInferTypeWithBacktracking(opts);
                                    }
                                }

                                break;
                            },
                            .unique => {
                                try p.lexer.next();

                                // "let foo: unique symbol"
                                if (p.lexer.isContextualKeyword("symbol")) {
                                    try p.lexer.next();
                                    break;
                                }
                            },
                            .abstract => {
                                try p.lexer.next();

                                // "let foo: abstract new () => {}" added in TypeScript 4.2
                                if (p.lexer.token == .t_new) {
                                    continue;
                                }
                            },
                            .asserts => {
                                try p.lexer.next();

                                // "function assert(x: boolean): asserts x"
                                // "function assert(x: boolean): asserts x is boolean"
                                if (opts.contains(.is_return_type) and !p.lexer.has_newline_before and (p.lexer.token == .t_identifier or p.lexer.token == .t_this)) {
                                    try p.lexer.next();
                                }
                            },
                            .primitive_any => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_any;
                                }
                            },
                            .primitive_never => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_never;
                                }
                            },
                            .primitive_unknown => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_unknown;
                                }
                            },
                            .primitive_undefined => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_undefined;
                                }
                            },
                            .primitive_object => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_object;
                                }
                            },
                            .primitive_number => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_number;
                                }
                            },
                            .primitive_string => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_string;
                                }
                            },
                            .primitive_boolean => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_boolean;
                                }
                            },
                            .primitive_bigint => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_bigint;
                                }
                            },
                            .primitive_symbol => {
                                try p.lexer.next();
                                check_type_parameters = false;
                                if (comptime get_metadata) {
                                    result.* = .m_symbol;
                                }
                            },
                            else => {
                                if (comptime get_metadata) {
                                    const find_result = p.findSymbol(logger.Loc.Empty, p.lexer.identifier) catch unreachable;
                                    result.* = .{ .m_identifier = find_result.ref };
                                }

                                try p.lexer.next();
                            },
                        }

                        // "function assert(x: any): x is boolean"
                        if (p.lexer.isContextualKeyword("is") and !p.lexer.has_newline_before) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            return;
                        }

                        // "let foo: any \n <number>foo" must not become a single type
                        if (check_type_parameters and !p.lexer.has_newline_before) {
                            _ = try p.skipTypeScriptTypeArguments(false);
                        }
                    },
                    .t_typeof => {
                        try p.lexer.next();

                        // "[typeof: number]"
                        if (opts.contains(.allow_tuple_labels) and p.lexer.token == .t_colon) {
                            return;
                        }

                        // always `Object`
                        if (comptime get_metadata) {
                            result.* = .m_object;
                        }

                        if (p.lexer.token == .t_import) {
                            // "typeof import('fs')"
                            continue;
                        } else {
                            // "typeof x"
                            if (!p.lexer.isIdentifierOrKeyword()) {
                                try p.lexer.expected(.t_identifier);
                            }
                            try p.lexer.next();

                            // "typeof x.#y"
                            // "typeof x.y"
                            while (p.lexer.token == .t_dot) {
                                try p.lexer.next();

                                if (!p.lexer.isIdentifierOrKeyword() and p.lexer.token != .t_private_identifier) {
                                    try p.lexer.expected(.t_identifier);
                                }
                                try p.lexer.next();
                            }

                            if (!p.lexer.has_newline_before) {
                                _ = try p.skipTypeScriptTypeArguments(false);
                            }
                        }
                    },
                    .t_open_bracket => {
                        // "[number, string]"
                        // "[first: number, second: string]"
                        try p.lexer.next();

                        if (comptime get_metadata) {
                            result.* = .m_array;
                        }

                        while (p.lexer.token != .t_close_bracket) {
                            if (p.lexer.token == .t_dot_dot_dot) {
                                try p.lexer.next();
                            }
                            try p.skipTypeScriptTypeWithOpts(.lowest, TypeScript.SkipTypeOptions.Bitset.initOne(.allow_tuple_labels), false, {});
                            if (p.lexer.token == .t_question) {
                                try p.lexer.next();
                            }
                            if (p.lexer.token == .t_colon) {
                                try p.lexer.next();
                                try p.skipTypeScriptType(.lowest);
                            }
                            if (p.lexer.token != .t_comma) {
                                break;
                            }
                            try p.lexer.next();
                        }
                        try p.lexer.expect(.t_close_bracket);
                    },
                    .t_open_brace => {
                        try p.skipTypeScriptObjectType();
                        if (comptime get_metadata) {
                            result.* = .m_object;
                        }
                    },
                    .t_template_head => {
                        // "`${'a' | 'b'}-${'c' | 'd'}`"
                        while (true) {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            try p.lexer.rescanCloseBraceAsTemplateToken();

                            if (p.lexer.token == .t_template_tail) {
                                try p.lexer.next();
                                break;
                            }
                        }
                        if (comptime get_metadata) {
                            result.* = .m_string;
                        }
                    },

                    else => {
                        // "[function: number]"
                        if (opts.contains(.allow_tuple_labels) and p.lexer.isIdentifierOrKeyword()) {
                            if (p.lexer.token != .t_function) {
                                try p.lexer.unexpected();
                            }
                            try p.lexer.next();

                            if (p.lexer.token != .t_colon) {
                                try p.lexer.expect(.t_colon);
                            }

                            return;
                        }

                        try p.lexer.unexpected();
                    },
                }
                break;
            }

            while (true) {
                switch (p.lexer.token) {
                    .t_bar => {
                        if (level.gte(.bitwise_or)) {
                            return;
                        }

                        try p.lexer.next();

                        if (comptime get_metadata) {
                            var left = result.*;
                            if (left.finishUnion(p)) |final| {
                                // finish skipping the rest of the type without collecting type metadata.
                                result.* = final;
                                try p.skipTypeScriptTypeWithOpts(.bitwise_or, opts, false, {});
                            } else {
                                try p.skipTypeScriptTypeWithOpts(.bitwise_or, opts, get_metadata, result);
                                result.mergeUnion(left);
                            }
                        } else {
                            try p.skipTypeScriptTypeWithOpts(.bitwise_or, opts, false, {});
                        }
                    },
                    .t_ampersand => {
                        if (level.gte(.bitwise_and)) {
                            return;
                        }

                        try p.lexer.next();

                        if (comptime get_metadata) {
                            var left = result.*;
                            if (left.finishIntersection(p)) |final| {
                                // finish skipping the rest of the type without collecting type metadata.
                                result.* = final;
                                try p.skipTypeScriptTypeWithOpts(.bitwise_and, opts, false, {});
                            } else {
                                try p.skipTypeScriptTypeWithOpts(.bitwise_and, opts, get_metadata, result);
                                result.mergeIntersection(left);
                            }
                        } else {
                            try p.skipTypeScriptTypeWithOpts(.bitwise_and, opts, false, {});
                        }
                    },
                    .t_exclamation => {
                        // A postfix "!" is allowed in JSDoc types in TypeScript, which are only
                        // present in comments. While it's not valid in a non-comment position,
                        // it's still parsed and turned into a soft error by the TypeScript
                        // compiler. It turns out parsing this is important for correctness for
                        // "as" casts because the "!" token must still be consumed.
                        if (p.lexer.has_newline_before) {
                            return;
                        }

                        try p.lexer.next();
                    },
                    .t_dot => {
                        try p.lexer.next();
                        if (!p.lexer.isIdentifierOrKeyword()) {
                            try p.lexer.expect(.t_identifier);
                        }

                        if (comptime get_metadata) {
                            if (result.* == .m_identifier) {
                                var dot = List(Ref).initCapacity(p.allocator, 2) catch unreachable;
                                dot.appendAssumeCapacity(result.m_identifier);
                                const find_result = p.findSymbol(logger.Loc.Empty, p.lexer.identifier) catch unreachable;
                                dot.appendAssumeCapacity(find_result.ref);
                                result.* = .{ .m_dot = dot };
                            } else if (result.* == .m_dot) {
                                if (p.lexer.isIdentifierOrKeyword()) {
                                    const find_result = p.findSymbol(logger.Loc.Empty, p.lexer.identifier) catch unreachable;
                                    result.m_dot.append(p.allocator, find_result.ref) catch unreachable;
                                }
                            }
                        }

                        try p.lexer.next();

                        // "{ <A extends B>(): c.d \n <E extends F>(): g.h }" must not become a single type
                        if (!p.lexer.has_newline_before) {
                            _ = try p.skipTypeScriptTypeArguments(false);
                        }
                    },
                    .t_open_bracket => {
                        // "{ ['x']: string \n ['y']: string }" must not become a single type
                        if (p.lexer.has_newline_before) {
                            return;
                        }
                        try p.lexer.next();
                        var skipped = false;
                        if (p.lexer.token != .t_close_bracket) {
                            skipped = true;
                            try p.skipTypeScriptType(.lowest);
                        }
                        try p.lexer.expect(.t_close_bracket);

                        if (comptime get_metadata) {
                            if (result.* == .m_none) {
                                result.* = .m_array;
                            } else {
                                // if something was skipped, it is object type
                                if (skipped) {
                                    result.* = .m_object;
                                } else {
                                    result.* = .m_array;
                                }
                            }
                        }
                    },
                    .t_extends => {
                        // "{ x: number \n extends: boolean }" must not become a single type
                        if (p.lexer.has_newline_before or opts.contains(.disallow_conditional_types)) {
                            return;
                        }

                        try p.lexer.next();

                        // The type following "extends" is not permitted to be another conditional type
                        var extends_type = if (get_metadata) TypeScript.Metadata.default;
                        try p.skipTypeScriptTypeWithOpts(
                            .lowest,
                            TypeScript.SkipTypeOptions.Bitset.initOne(.disallow_conditional_types),
                            get_metadata,
                            if (get_metadata) &extends_type,
                        );

                        if (comptime get_metadata) {
                            // intersection
                            try p.lexer.expect(.t_question);
                            var left = try p.skipTypeScriptTypeWithMetadata(.lowest);
                            try p.lexer.expect(.t_colon);
                            if (left.finishIntersection(p)) |final| {
                                result.* = final;
                                try p.skipTypeScriptType(.lowest);
                            } else {
                                try p.skipTypeScriptTypeWithOpts(.bitwise_and, TypeScript.SkipTypeOptions.empty, get_metadata, result);
                                result.mergeIntersection(left);
                            }
                        } else {
                            try p.lexer.expect(.t_question);
                            try p.skipTypeScriptType(.lowest);
                            try p.lexer.expect(.t_colon);
                            try p.skipTypeScriptType(.lowest);
                        }
                    },
                    else => {
                        return;
                    },
                }
            }
        }
        pub fn skipTypeScriptObjectType(p: *P) anyerror!void {
            p.markTypeScriptOnly();

            try p.lexer.expect(.t_open_brace);

            while (p.lexer.token != .t_close_brace) {
                // "{ -readonly [K in keyof T]: T[K] }"
                // "{ +readonly [K in keyof T]: T[K] }"
                if (p.lexer.token == .t_plus or p.lexer.token == .t_minus) {
                    try p.lexer.next();
                }

                // Skip over modifiers and the property identifier
                var found_key = false;
                while (p.lexer.isIdentifierOrKeyword() or p.lexer.token == .t_string_literal or p.lexer.token == .t_numeric_literal) {
                    try p.lexer.next();
                    found_key = true;
                }

                if (p.lexer.token == .t_open_bracket) {
                    // Index signature or computed property
                    try p.lexer.next();
                    try p.skipTypeScriptTypeWithOpts(.lowest, TypeScript.SkipTypeOptions.Bitset.initOne(.is_index_signature), false, {});

                    // "{ [key: string]: number }"
                    // "{ readonly [K in keyof T]: T[K] }"
                    switch (p.lexer.token) {
                        .t_colon => {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                        },
                        .t_in => {
                            try p.lexer.next();
                            try p.skipTypeScriptType(.lowest);
                            if (p.lexer.isContextualKeyword("as")) {
                                // "{ [K in keyof T as `get-${K}`]: T[K] }"
                                try p.lexer.next();
                                try p.skipTypeScriptType(.lowest);
                            }
                        },
                        else => {},
                    }

                    try p.lexer.expect(.t_close_bracket);

                    // "{ [K in keyof T]+?: T[K] }"
                    // "{ [K in keyof T]-?: T[K] }"
                    switch (p.lexer.token) {
                        .t_plus, .t_minus => {
                            try p.lexer.next();
                        },
                        else => {},
                    }

                    found_key = true;
                }

                // "?" indicates an optional property
                // "!" indicates an initialization assertion
                if (found_key and (p.lexer.token == .t_question or p.lexer.token == .t_exclamation)) {
                    try p.lexer.next();
                }

                // Type parameters come right after the optional mark
                _ = try p.skipTypeScriptTypeParameters(.{
                    .allow_const_modifier = true,
                });

                switch (p.lexer.token) {
                    .t_colon => {
                        // Regular property
                        if (!found_key) {
                            try p.lexer.expect(.t_identifier);
                        }

                        try p.lexer.next();
                        try p.skipTypeScriptType(.lowest);
                    },
                    .t_open_paren => {
                        // Method signature
                        try p.skipTypescriptFnArgs();

                        if (p.lexer.token == .t_colon) {
                            try p.lexer.next();
                            try p.skipTypescriptReturnType();
                        }
                    },
                    else => {
                        if (!found_key) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }
                    },
                }
                switch (p.lexer.token) {
                    .t_close_brace => {},
                    .t_comma, .t_semicolon => {
                        try p.lexer.next();
                    },
                    else => {
                        if (!p.lexer.has_newline_before) {
                            try p.lexer.unexpected();
                            return error.SyntaxError;
                        }
                    },
                }
            }
            try p.lexer.expect(.t_close_brace);
        }

        // This is the type parameter declarations that go with other symbol
        // declarations (class, function, type, etc.)
        pub fn skipTypeScriptTypeParameters(p: *P, flags: TypeParameterFlag) anyerror!SkipTypeParameterResult {
            p.markTypeScriptOnly();

            if (p.lexer.token != .t_less_than) {
                return .did_not_skip_anything;
            }

            var result = SkipTypeParameterResult.could_be_type_cast;
            try p.lexer.next();

            if (p.lexer.token == .t_greater_than and flags.allow_empty_type_parameters) {
                try p.lexer.next();
                return .definitely_type_parameters;
            }

            while (true) {
                var has_in = false;
                var has_out = false;
                var expect_identifier = true;

                var invalid_modifier_range = logger.Range.None;

                // Scan over a sequence of "in" and "out" modifiers (a.k.a. optional
                // variance annotations) as well as "const" modifiers
                while (true) {
                    if (p.lexer.token == .t_const) {
                        if (invalid_modifier_range.len == 0 and !flags.allow_const_modifier) {
                            // Valid:
                            //   "class Foo<const T> {}"
                            // Invalid:
                            //   "interface Foo<const T> {}"
                            invalid_modifier_range = p.lexer.range();
                        }

                        result = .definitely_type_parameters;
                        try p.lexer.next();
                        expect_identifier = true;
                        continue;
                    }

                    if (p.lexer.token == .t_in) {
                        if (invalid_modifier_range.len == 0 and (!flags.allow_in_out_variance_annotations or has_in or has_out)) {
                            // Valid:
                            //   "type Foo<in T> = T"
                            // Invalid:
                            //   "type Foo<in in T> = T"
                            //   "type Foo<out in T> = T"
                            invalid_modifier_range = p.lexer.range();
                        }

                        try p.lexer.next();
                        has_in = true;
                        expect_identifier = true;
                        continue;
                    }

                    if (p.lexer.isContextualKeyword("out")) {
                        const r = p.lexer.range();
                        if (invalid_modifier_range.len == 0 and !flags.allow_in_out_variance_annotations) {
                            // Valid:
                            //   "type Foo<out T> = T"
                            // Invalid:
                            //   "type Foo<out out T> = T"
                            //   "type Foo<in out T> = T"
                            invalid_modifier_range = r;
                        }

                        try p.lexer.next();
                        if (invalid_modifier_range.len == 0 and has_out and (p.lexer.token == .t_in or p.lexer.token == .t_identifier)) {
                            // Valid:
                            //   "type Foo<out T> = T"
                            //   "type Foo<out out> = T"
                            //   "type Foo<out out, T> = T"
                            //   "type Foo<out out = T> = T"
                            //   "type Foo<out out extends T> = T"
                            // Invalid:
                            //   "type Foo<out out in T> = T"
                            //   "type Foo<out out T> = T"
                            invalid_modifier_range = r;
                        }
                        has_out = true;
                        expect_identifier = false;
                        continue;
                    }

                    break;
                }

                // Only report an error for the first invalid modifier
                if (invalid_modifier_range.len > 0) {
                    try p.log.addRangeErrorFmt(
                        p.source,
                        invalid_modifier_range,
                        p.allocator,
                        "The modifier \"{s}\" is not valid here",
                        .{p.source.textForRange(invalid_modifier_range)},
                    );
                }

                // expectIdentifier => Mandatory identifier (e.g. after "type Foo <in ___")
                // !expectIdentifier => Optional identifier (e.g. after "type Foo <out ___" since "out" may be the identifier)
                if (expect_identifier or p.lexer.token == .t_identifier) {
                    try p.lexer.expect(.t_identifier);
                }

                // "class Foo<T extends number> {}"
                if (p.lexer.token == .t_extends) {
                    result = .definitely_type_parameters;
                    try p.lexer.next();
                    try p.skipTypeScriptType(.lowest);
                }

                // "class Foo<T = void> {}"
                if (p.lexer.token == .t_equals) {
                    result = .definitely_type_parameters;
                    try p.lexer.next();
                    try p.skipTypeScriptType(.lowest);
                }

                if (p.lexer.token != .t_comma) {
                    break;
                }

                try p.lexer.next();

                if (p.lexer.token == .t_greater_than) {
                    result = .definitely_type_parameters;
                    break;
                }
            }

            try p.lexer.expectGreaterThan(false);
            return result;
        }

        pub fn skipTypeScriptTypeStmt(p: *P, opts: *ParseStatementOptions) anyerror!void {
            if (opts.is_export) {
                switch (p.lexer.token) {
                    .t_open_brace => {
                        // "export type {foo}"
                        // "export type {foo} from 'bar'"
                        _ = try p.parseExportClause();
                        if (p.lexer.isContextualKeyword("from")) {
                            try p.lexer.next();
                            _ = try p.parsePath();
                        }
                        try p.lexer.expectOrInsertSemicolon();
                        return;
                    },
                    .t_asterisk => {
                        // https://github.com/microsoft/TypeScript/pull/52217
                        // - export type * as Foo from 'bar';
                        // - export type Foo from 'bar';
                        try p.lexer.next();
                        if (p.lexer.isContextualKeyword("as")) {
                            // "export type * as ns from 'path'"
                            try p.lexer.next();
                            _ = try p.parseClauseAlias("export");
                            try p.lexer.next();
                        }
                        try p.lexer.expectContextualKeyword("from");
                        _ = try p.parsePath();
                        try p.lexer.expectOrInsertSemicolon();
                        return;
                    },
                    else => {},
                }
            }

            const name = p.lexer.identifier;
            try p.lexer.expect(.t_identifier);

            if (opts.is_module_scope) {
                p.local_type_names.put(p.allocator, name, true) catch unreachable;
            }

            _ = try p.skipTypeScriptTypeParameters(.{
                .allow_in_out_variance_annotations = true,
                .allow_empty_type_parameters = true,
            });

            try p.lexer.expect(.t_equals);
            try p.skipTypeScriptType(.lowest);
            try p.lexer.expectOrInsertSemicolon();
        }

        pub fn skipTypeScriptInterfaceStmt(p: *P, opts: *ParseStatementOptions) anyerror!void {
            const name = p.lexer.identifier;
            try p.lexer.expect(.t_identifier);

            if (opts.is_module_scope) {
                p.local_type_names.put(p.allocator, name, true) catch unreachable;
            }

            _ = try p.skipTypeScriptTypeParameters(.{
                .allow_in_out_variance_annotations = true,
                .allow_empty_type_parameters = true,
            });

            if (p.lexer.token == .t_extends) {
                try p.lexer.next();

                while (true) {
                    try p.skipTypeScriptType(.lowest);
                    if (p.lexer.token != .t_comma) {
                        break;
                    }
                    try p.lexer.next();
                }
            }

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

            try p.skipTypeScriptObjectType();
        }

        pub fn skipTypeScriptTypeArguments(p: *P, comptime isInsideJSXElement: bool) anyerror!bool {
            p.markTypeScriptOnly();
            switch (p.lexer.token) {
                .t_less_than, .t_less_than_equals, .t_less_than_less_than, .t_less_than_less_than_equals => {},
                else => {
                    return false;
                },
            }

            try p.lexer.expectLessThan(false);

            while (true) {
                try p.skipTypeScriptType(.lowest);
                if (p.lexer.token != .t_comma) {
                    break;
                }
                try p.lexer.next();
            }

            // This type argument list must end with a ">"
            try p.lexer.expectGreaterThan(isInsideJSXElement);
            return true;
        }

        pub const Backtracking = struct {
            pub inline fn lexerBacktracker(p: *P, func: anytype, comptime ReturnType: type) ReturnType {
                p.markTypeScriptOnly();
                const old_lexer = p.lexer;
                const old_log_disabled = p.lexer.is_log_disabled;
                p.lexer.is_log_disabled = true;
                defer p.lexer.is_log_disabled = old_log_disabled;
                var backtrack = false;
                const FnReturnType = bun.meta.ReturnOf(func);
                const result = func(p) catch |err| brk: {
                    switch (err) {
                        error.Backtrack => {
                            backtrack = true;
                        },
                        else => {
                            if (p.lexer.did_panic) {
                                backtrack = true;
                            }
                        },
                    }
                    if (comptime FnReturnType == anyerror!bool or FnReturnType == anyerror!void)
                        // we are not using the value
                        break :brk undefined;

                    break :brk SkipTypeParameterResult.did_not_skip_anything;
                };

                if (backtrack) {
                    p.lexer.restore(&old_lexer);

                    if (comptime FnReturnType == anyerror!bool) {
                        return false;
                    }
                }

                if (comptime FnReturnType == anyerror!bool) {
                    return true;
                }

                if (comptime ReturnType == void or ReturnType == bool)
                    // If we did not backtrack, then we skipped successfully.
                    return !backtrack;

                return result;
            }

            pub inline fn lexerBacktrackerWithArgs(p: *P, func: anytype, args: anytype, comptime ReturnType: type) ReturnType {
                p.markTypeScriptOnly();
                const old_lexer = p.lexer;
                const old_log_disabled = p.lexer.is_log_disabled;
                p.lexer.is_log_disabled = true;

                defer p.lexer.is_log_disabled = old_log_disabled;
                var backtrack = false;
                const FnReturnType = bun.meta.ReturnOf(func);
                const result = @call(.auto, func, args) catch |err| brk: {
                    switch (err) {
                        error.Backtrack => {
                            backtrack = true;
                        },
                        else => {},
                    }
                    if (comptime FnReturnType == anyerror!bool or FnReturnType == anyerror!void)
                        // we are not using the value
                        break :brk undefined;
                    break :brk SkipTypeParameterResult.did_not_skip_anything;
                };

                if (backtrack) {
                    p.lexer.restore(&old_lexer);
                    if (comptime FnReturnType == anyerror!bool) {
                        return false;
                    }
                }

                if (comptime FnReturnType == anyerror!bool) {
                    return true;
                }

                if (comptime ReturnType == void or ReturnType == bool) return backtrack;
                return result;
            }

            pub fn skipTypeScriptTypeParametersThenOpenParenWithBacktracking(p: *P) anyerror!SkipTypeParameterResult {
                const result = try p.skipTypeScriptTypeParameters(.{ .allow_const_modifier = true });
                if (p.lexer.token != .t_open_paren) {
                    return error.Backtrack;
                }

                return result;
            }

            pub fn skipTypeScriptConstraintOfInferTypeWithBacktracking(p: *P, flags: TypeScript.SkipTypeOptions.Bitset) anyerror!bool {
                try p.lexer.expect(.t_extends);
                try p.skipTypeScriptTypeWithOpts(.prefix, TypeScript.SkipTypeOptions.Bitset.initOne(.disallow_conditional_types), false, {});

                if (!flags.contains(.disallow_conditional_types) and p.lexer.token == .t_question) {
                    return error.Backtrack;
                }

                return true;
            }

            pub fn skipTypeScriptArrowArgsWithBacktracking(p: *P) anyerror!bool {
                try p.skipTypescriptFnArgs();
                p.lexer.expect(.t_equals_greater_than) catch
                    return error.Backtrack;

                return true;
            }

            pub fn skipTypeScriptTypeArgumentsWithBacktracking(p: *P) anyerror!bool {
                if (try p.skipTypeScriptTypeArguments(false)) {
                    // Check the token after this and backtrack if it's the wrong one
                    if (!TypeScript.canFollowTypeArgumentsInExpression(p)) {
                        return error.Backtrack;
                    }
                }

                return true;
            }

            pub fn skipTypeScriptArrowReturnTypeWithBacktracking(p: *P) anyerror!void {
                try p.lexer.expect(.t_colon);

                try p.skipTypescriptReturnType();
                // Check the token after this and backtrack if it's the wrong one
                if (p.lexer.token != .t_equals_greater_than) {
                    return error.Backtrack;
                }
            }
        };

        pub fn trySkipTypeScriptTypeParametersThenOpenParenWithBacktracking(p: *P) SkipTypeParameterResult {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptTypeParametersThenOpenParenWithBacktracking, SkipTypeParameterResult);
        }

        pub fn trySkipTypeScriptTypeArgumentsWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptTypeArgumentsWithBacktracking, bool);
        }

        pub fn trySkipTypeScriptArrowReturnTypeWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptArrowReturnTypeWithBacktracking, bool);
        }

        pub fn trySkipTypeScriptArrowArgsWithBacktracking(p: *P) bool {
            return Backtracking.lexerBacktracker(p, Backtracking.skipTypeScriptArrowArgsWithBacktracking, bool);
        }

        pub fn trySkipTypeScriptConstraintOfInferTypeWithBacktracking(p: *P, flags: TypeScript.SkipTypeOptions.Bitset) bool {
            return Backtracking.lexerBacktrackerWithArgs(p, Backtracking.skipTypeScriptConstraintOfInferTypeWithBacktracking, .{ p, flags }, bool);
        }
    };
}

const string = []const u8;

const bun = @import("bun");
const assert = bun.assert;
const logger = bun.logger;

const js_ast = bun.ast;
const B = js_ast.B;
const E = js_ast.E;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const JSXTransformType = js_parser.JSXTransformType;
const ParseStatementOptions = js_parser.ParseStatementOptions;
const Ref = js_parser.Ref;
const SkipTypeParameterResult = js_parser.SkipTypeParameterResult;
const TypeParameterFlag = js_parser.TypeParameterFlag;
const TypeScript = js_parser.TypeScript;
const fs = js_parser.fs;

const std = @import("std");
const List = std.ArrayListUnmanaged;
