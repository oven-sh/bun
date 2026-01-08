pub fn ParseStmt(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const createDefaultName = P.createDefaultName;
        const extractDeclsForBinding = P.extractDeclsForBinding;
        const is_typescript_enabled = P.is_typescript_enabled;
        const track_symbol_usage_during_parse_pass = P.track_symbol_usage_during_parse_pass;

        fn t_semicolon(p: *P) anyerror!Stmt {
            try p.lexer.next();
            return Stmt.empty();
        }

        fn t_export(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            const previous_export_keyword = p.esm_export_keyword;
            if (opts.is_module_scope) {
                p.esm_export_keyword = p.lexer.range();
            } else if (!opts.is_namespace_scope) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }
            try p.lexer.next();

            // TypeScript decorators only work on class declarations
            // "@decorator export class Foo {}"
            // "@decorator export abstract class Foo {}"
            // "@decorator export default class Foo {}"
            // "@decorator export default abstract class Foo {}"
            // "@decorator export declare class Foo {}"
            // "@decorator export declare abstract class Foo {}"
            if (opts.ts_decorators != null and p.lexer.token != js_lexer.T.t_class and
                p.lexer.token != js_lexer.T.t_default and
                !p.lexer.isContextualKeyword("abstract") and
                !p.lexer.isContextualKeyword("declare"))
            {
                try p.lexer.expected(js_lexer.T.t_class);
            }

            switch (p.lexer.token) {
                T.t_class, T.t_const, T.t_function, T.t_var => {
                    opts.is_export = true;
                    return p.parseStmt(opts);
                },

                T.t_import => {
                    // "export import foo = bar"
                    if (is_typescript_enabled and (opts.is_module_scope or opts.is_namespace_scope)) {
                        opts.is_export = true;
                        return p.parseStmt(opts);
                    }

                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },

                T.t_enum => {
                    if (!is_typescript_enabled) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    opts.is_export = true;
                    return p.parseStmt(opts);
                },

                T.t_identifier => {
                    if (p.lexer.isContextualKeyword("let")) {
                        opts.is_export = true;
                        return p.parseStmt(opts);
                    }

                    if (comptime is_typescript_enabled) {
                        if (opts.is_typescript_declare and p.lexer.isContextualKeyword("as")) {
                            // "export as namespace ns;"
                            try p.lexer.next();
                            try p.lexer.expectContextualKeyword("namespace");
                            try p.lexer.expect(T.t_identifier);
                            try p.lexer.expectOrInsertSemicolon();

                            return p.s(S.TypeScript{}, loc);
                        }
                    }

                    if (p.lexer.isContextualKeyword("async")) {
                        const asyncRange = p.lexer.range();
                        try p.lexer.next();
                        if (p.lexer.has_newline_before) {
                            try p.log.addRangeError(p.source, asyncRange, "Unexpected newline after \"async\"");
                        }

                        try p.lexer.expect(T.t_function);
                        opts.is_export = true;
                        return try p.parseFnStmt(loc, opts, asyncRange);
                    }

                    if (is_typescript_enabled) {
                        if (TypeScript.Identifier.forStr(p.lexer.identifier)) |ident| {
                            switch (ident) {
                                .s_type => {
                                    // "export type foo = ..."
                                    const type_range = p.lexer.range();
                                    try p.lexer.next();
                                    if (p.lexer.has_newline_before) {
                                        try p.log.addErrorFmt(p.source, type_range.end(), p.allocator, "Unexpected newline after \"type\"", .{});
                                        return error.SyntaxError;
                                    }
                                    var skipper = ParseStatementOptions{ .is_module_scope = opts.is_module_scope, .is_export = true };
                                    try p.skipTypeScriptTypeStmt(&skipper);
                                    return p.s(S.TypeScript{}, loc);
                                },
                                .s_namespace, .s_abstract, .s_module, .s_interface => {
                                    // "export namespace Foo {}"
                                    // "export abstract class Foo {}"
                                    // "export module Foo {}"
                                    // "export interface Foo {}"
                                    opts.is_export = true;
                                    return try p.parseStmt(opts);
                                },
                                .s_declare => {
                                    // "export declare class Foo {}"
                                    opts.is_export = true;
                                    opts.lexical_decl = .allow_all;
                                    opts.is_typescript_declare = true;
                                    return try p.parseStmt(opts);
                                },
                            }
                        }
                    }

                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },

                T.t_default => {
                    if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    const defaultLoc = p.lexer.loc();
                    try p.lexer.next();

                    // TypeScript decorators only work on class declarations
                    // "@decorator export default class Foo {}"
                    // "@decorator export default abstract class Foo {}"
                    if (opts.ts_decorators != null and p.lexer.token != T.t_class and !p.lexer.isContextualKeyword("abstract")) {
                        try p.lexer.expected(T.t_class);
                    }

                    if (p.lexer.isContextualKeyword("async")) {
                        const async_range = p.lexer.range();
                        try p.lexer.next();
                        if (p.lexer.token == T.t_function and !p.lexer.has_newline_before) {
                            try p.lexer.next();
                            var stmtOpts = ParseStatementOptions{
                                .is_name_optional = true,
                                .lexical_decl = .allow_all,
                            };
                            const stmt = try p.parseFnStmt(loc, &stmtOpts, async_range);
                            if (@as(Stmt.Tag, stmt.data) == .s_type_script) {
                                // This was just a type annotation
                                return stmt;
                            }

                            const defaultName = if (stmt.data.s_function.func.name) |name|
                                js_ast.LocRef{ .loc = name.loc, .ref = name.ref }
                            else
                                try p.createDefaultName(defaultLoc);

                            const value = js_ast.StmtOrExpr{ .stmt = stmt };
                            return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                        }

                        const defaultName = try createDefaultName(p, loc);

                        var expr = try p.parseAsyncPrefixExpr(async_range, Level.comma);
                        try p.parseSuffix(&expr, Level.comma, null, Expr.EFlags.none);
                        try p.lexer.expectOrInsertSemicolon();
                        const value = js_ast.StmtOrExpr{ .expr = expr };
                        p.has_export_default = true;
                        return p.s(S.ExportDefault{ .default_name = defaultName, .value = value }, loc);
                    }

                    if (p.lexer.token == .t_function or p.lexer.token == .t_class or p.lexer.isContextualKeyword("interface")) {
                        var _opts = ParseStatementOptions{
                            .ts_decorators = opts.ts_decorators,
                            .is_name_optional = true,
                            .lexical_decl = .allow_all,
                        };
                        const stmt = try p.parseStmt(&_opts);

                        const default_name: js_ast.LocRef = default_name_getter: {
                            switch (stmt.data) {
                                // This was just a type annotation
                                .s_type_script => {
                                    return stmt;
                                },

                                .s_function => |func_container| {
                                    if (func_container.func.name) |name| {
                                        break :default_name_getter LocRef{ .loc = name.loc, .ref = name.ref };
                                    }
                                },
                                .s_class => |class| {
                                    if (class.class.class_name) |name| {
                                        break :default_name_getter LocRef{ .loc = name.loc, .ref = name.ref };
                                    }
                                },
                                else => {},
                            }

                            break :default_name_getter createDefaultName(p, defaultLoc) catch unreachable;
                        };
                        p.has_export_default = true;
                        p.has_es_module_syntax = true;
                        return p.s(
                            S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } },
                            loc,
                        );
                    }

                    const is_identifier = p.lexer.token == .t_identifier;
                    const name = p.lexer.identifier;
                    const expr = try p.parseExpr(.comma);

                    // Handle the default export of an abstract class in TypeScript
                    if (is_typescript_enabled and is_identifier and (p.lexer.token == .t_class or opts.ts_decorators != null) and strings.eqlComptime(name, "abstract")) {
                        switch (expr.data) {
                            .e_identifier => {
                                var stmtOpts = ParseStatementOptions{
                                    .ts_decorators = opts.ts_decorators,
                                    .is_name_optional = true,
                                };
                                const stmt: Stmt = try p.parseClassStmt(loc, &stmtOpts);

                                // Use the statement name if present, since it's a better name
                                const default_name: js_ast.LocRef = default_name_getter: {
                                    switch (stmt.data) {
                                        // This was just a type annotation
                                        .s_type_script => {
                                            return stmt;
                                        },

                                        .s_function => |func_container| {
                                            if (func_container.func.name) |_name| {
                                                break :default_name_getter LocRef{ .loc = defaultLoc, .ref = _name.ref };
                                            }
                                        },
                                        .s_class => |class| {
                                            if (class.class.class_name) |_name| {
                                                break :default_name_getter LocRef{ .loc = defaultLoc, .ref = _name.ref };
                                            }
                                        },
                                        else => {},
                                    }

                                    break :default_name_getter createDefaultName(p, defaultLoc) catch unreachable;
                                };
                                p.has_export_default = true;
                                return p.s(S.ExportDefault{ .default_name = default_name, .value = js_ast.StmtOrExpr{ .stmt = stmt } }, loc);
                            },
                            else => {
                                p.panic("internal error: unexpected", .{});
                            },
                        }
                    }

                    try p.lexer.expectOrInsertSemicolon();

                    // Use the expression name if present, since it's a better name
                    p.has_export_default = true;
                    return p.s(
                        S.ExportDefault{
                            .default_name = p.defaultNameForExpr(expr, defaultLoc),
                            .value = js_ast.StmtOrExpr{
                                .expr = expr,
                            },
                        },
                        loc,
                    );
                },
                T.t_asterisk => {
                    if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    try p.lexer.next();
                    var namespace_ref: Ref = Ref.None;
                    var alias: ?js_ast.G.ExportStarAlias = null;
                    var path: ParsedPath = undefined;

                    if (p.lexer.isContextualKeyword("as")) {
                        // "export * as ns from 'path'"
                        try p.lexer.next();
                        const name = try p.parseClauseAlias("export");
                        namespace_ref = try p.storeNameInRef(name);
                        alias = G.ExportStarAlias{ .loc = p.lexer.loc(), .original_name = name };
                        try p.lexer.next();
                        try p.lexer.expectContextualKeyword("from");
                        path = try p.parsePath();
                    } else {
                        // "export * from 'path'"
                        try p.lexer.expectContextualKeyword("from");
                        path = try p.parsePath();
                        const name = try fs.PathName.init(path.text).nonUniqueNameString(p.allocator);
                        namespace_ref = try p.storeNameInRef(name);
                    }

                    const import_record_index = p.addImportRecord(
                        ImportKind.stmt,
                        path.loc,
                        path.text,
                        // TODO: import assertions
                        // path.assertions
                    );

                    if (path.is_macro) {
                        try p.log.addError(p.source, path.loc, "cannot use macro in export statement");
                    } else if (path.import_tag != .none) {
                        try p.log.addError(p.source, loc, "cannot use export statement with \"type\" attribute");
                    }

                    if (comptime track_symbol_usage_during_parse_pass) {
                        // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                        p.import_records.items[import_record_index].flags.calls_runtime_re_export_fn = true;
                    }

                    try p.lexer.expectOrInsertSemicolon();
                    p.has_es_module_syntax = true;
                    return p.s(S.ExportStar{
                        .namespace_ref = namespace_ref,
                        .alias = alias,
                        .import_record_index = import_record_index,
                    }, loc);
                },
                T.t_open_brace => {
                    if (!opts.is_module_scope and !(opts.is_namespace_scope or !opts.is_typescript_declare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    const export_clause = try p.parseExportClause();
                    if (p.lexer.isContextualKeyword("from")) {
                        try p.lexer.expectContextualKeyword("from");
                        const parsedPath = try p.parsePath();

                        try p.lexer.expectOrInsertSemicolon();

                        if (comptime is_typescript_enabled) {
                            // export {type Foo} from 'bar';
                            // ->
                            // nothing
                            // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                            if (export_clause.clauses.len == 0 and export_clause.had_type_only_exports) {
                                return p.s(S.TypeScript{}, loc);
                            }
                        }

                        if (parsedPath.is_macro) {
                            try p.log.addError(p.source, loc, "export from cannot be used with \"type\": \"macro\"");
                        } else if (parsedPath.import_tag != .none) {
                            try p.log.addError(p.source, loc, "export from cannot be used with \"type\" attribute");
                        }

                        const import_record_index = p.addImportRecord(.stmt, parsedPath.loc, parsedPath.text);
                        const path_name = fs.PathName.init(parsedPath.text);
                        const namespace_ref = p.storeNameInRef(
                            std.fmt.allocPrint(
                                p.allocator,
                                "import_{f}",
                                .{
                                    path_name.fmtIdentifier(),
                                },
                            ) catch |err| bun.handleOom(err),
                        ) catch |err| bun.handleOom(err);

                        if (comptime track_symbol_usage_during_parse_pass) {
                            // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                            p.import_records.items[import_record_index].flags.calls_runtime_re_export_fn = true;
                        }
                        p.current_scope.is_after_const_local_prefix = true;
                        p.has_es_module_syntax = true;
                        return p.s(
                            S.ExportFrom{
                                .items = export_clause.clauses,
                                .is_single_line = export_clause.is_single_line,
                                .namespace_ref = namespace_ref,
                                .import_record_index = import_record_index,
                            },
                            loc,
                        );
                    }
                    try p.lexer.expectOrInsertSemicolon();

                    if (comptime is_typescript_enabled) {
                        // export {type Foo};
                        // ->
                        // nothing
                        // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                        if (export_clause.clauses.len == 0 and export_clause.had_type_only_exports) {
                            return p.s(S.TypeScript{}, loc);
                        }
                    }
                    p.has_es_module_syntax = true;
                    return p.s(S.ExportClause{
                        .items = export_clause.clauses,
                        .is_single_line = export_clause.is_single_line,
                    }, loc);
                },
                T.t_equals => {
                    // "export = value;"

                    p.esm_export_keyword = previous_export_keyword; // This wasn't an ESM export statement after all
                    if (is_typescript_enabled) {
                        try p.lexer.next();
                        const value = try p.parseExpr(.lowest);
                        try p.lexer.expectOrInsertSemicolon();
                        return p.s(S.ExportEquals{ .value = value }, loc);
                    }
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
                else => {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
            }
        }

        fn t_function(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            return try p.parseFnStmt(loc, opts, null);
        }
        fn t_enum(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            if (!is_typescript_enabled) {
                try p.lexer.unexpected();
                return error.SyntaxError;
            }
            return p.parseTypescriptEnumStmt(loc, opts);
        }
        fn t_at(p: *P, opts: *ParseStatementOptions) anyerror!Stmt {
            // Parse decorators before class statements, which are potentially exported
            if (is_typescript_enabled) {
                const scope_index = p.scopes_in_order.items.len;
                const ts_decorators = try p.parseTypeScriptDecorators();

                // If this turns out to be a "declare class" statement, we need to undo the
                // scopes that were potentially pushed while parsing the decorator arguments.
                // That can look like any one of the following:
                //
                //   "@decorator declare class Foo {}"
                //   "@decorator declare abstract class Foo {}"
                //   "@decorator export declare class Foo {}"
                //   "@decorator export declare abstract class Foo {}"
                //
                opts.ts_decorators = DeferredTsDecorators{
                    .values = ts_decorators,
                    .scope_index = scope_index,
                };

                // "@decorator class Foo {}"
                // "@decorator abstract class Foo {}"
                // "@decorator declare class Foo {}"
                // "@decorator declare abstract class Foo {}"
                // "@decorator export class Foo {}"
                // "@decorator export abstract class Foo {}"
                // "@decorator export declare class Foo {}"
                // "@decorator export declare abstract class Foo {}"
                // "@decorator export default class Foo {}"
                // "@decorator export default abstract class Foo {}"
                if (p.lexer.token != .t_class and p.lexer.token != .t_export and !p.lexer.isContextualKeyword("abstract") and !p.lexer.isContextualKeyword("declare")) {
                    try p.lexer.expected(.t_class);
                }

                return p.parseStmt(opts);
            }
            // notimpl();

            try p.lexer.unexpected();
            return error.SyntaxError;
        }
        fn t_class(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            if (opts.lexical_decl != .allow_all) {
                try p.forbidLexicalDecl(loc);
            }

            return try p.parseClassStmt(loc, opts);
        }
        fn t_var(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            var decls = try p.parseAndDeclareDecls(.hoisted, opts);
            try p.lexer.expectOrInsertSemicolon();
            return p.s(S.Local{
                .kind = .k_var,
                .decls = Decl.List.moveFromList(&decls),
                .is_export = opts.is_export,
            }, loc);
        }
        fn t_const(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            if (opts.lexical_decl != .allow_all) {
                try p.forbidLexicalDecl(loc);
            }
            // p.markSyntaxFeature(compat.Const, p.lexer.Range())

            try p.lexer.next();

            if (is_typescript_enabled and p.lexer.token == T.t_enum) {
                return p.parseTypescriptEnumStmt(loc, opts);
            }

            var decls = try p.parseAndDeclareDecls(.constant, opts);
            try p.lexer.expectOrInsertSemicolon();

            if (!opts.is_typescript_declare) {
                try p.requireInitializers(.k_const, decls.items);
            }

            return p.s(S.Local{
                .kind = .k_const,
                .decls = Decl.List.moveFromList(&decls),
                .is_export = opts.is_export,
            }, loc);
        }
        fn t_if(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            var current_loc = loc;
            var root_if: ?Stmt = null;
            var current_if: ?*S.If = null;

            while (true) {
                try p.lexer.next();
                try p.lexer.expect(.t_open_paren);
                const test_ = try p.parseExpr(.lowest);
                try p.lexer.expect(.t_close_paren);
                var stmtOpts = ParseStatementOptions{
                    .lexical_decl = .allow_fn_inside_if,
                };
                const yes = try p.parseStmt(&stmtOpts);

                // Create the if node
                const if_stmt = p.s(S.If{
                    .test_ = test_,
                    .yes = yes,
                    .no = null,
                }, current_loc);

                // First if statement becomes root
                if (root_if == null) {
                    root_if = if_stmt;
                }

                // Link to previous if statement's else branch
                if (current_if) |prev_if| {
                    prev_if.no = if_stmt;
                }

                // Set current if for next iteration
                current_if = if_stmt.data.s_if;

                if (p.lexer.token != .t_else) {
                    return root_if.?;
                }

                try p.lexer.next();

                // Handle final else
                if (p.lexer.token != .t_if) {
                    stmtOpts = ParseStatementOptions{
                        .lexical_decl = .allow_fn_inside_if,
                    };
                    current_if.?.no = try p.parseStmt(&stmtOpts);
                    return root_if.?;
                }

                // Continue with else if
                current_loc = p.lexer.loc();
            }

            unreachable;
        }
        fn t_do(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            var stmtOpts = ParseStatementOptions{};
            const body = try p.parseStmt(&stmtOpts);
            try p.lexer.expect(.t_while);
            try p.lexer.expect(.t_open_paren);
            const test_ = try p.parseExpr(.lowest);
            try p.lexer.expect(.t_close_paren);

            // This is a weird corner case where automatic semicolon insertion applies
            // even without a newline present
            if (p.lexer.token == .t_semicolon) {
                try p.lexer.next();
            }
            return p.s(S.DoWhile{ .body = body, .test_ = test_ }, loc);
        }
        fn t_while(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();

            try p.lexer.expect(.t_open_paren);
            const test_ = try p.parseExpr(.lowest);
            try p.lexer.expect(.t_close_paren);

            var stmtOpts = ParseStatementOptions{};
            const body = try p.parseStmt(&stmtOpts);

            return p.s(S.While{
                .body = body,
                .test_ = test_,
            }, loc);
        }
        fn t_with(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            try p.lexer.expect(.t_open_paren);
            const test_ = try p.parseExpr(.lowest);
            const body_loc = p.lexer.loc();
            try p.lexer.expect(.t_close_paren);

            // Push a scope so we make sure to prevent any bare identifiers referenced
            // within the body from being renamed. Renaming them might change the
            // semantics of the code.
            _ = try p.pushScopeForParsePass(.with, body_loc);
            var stmtOpts = ParseStatementOptions{};
            const body = try p.parseStmt(&stmtOpts);
            p.popScope();

            return p.s(S.With{ .body = body, .body_loc = body_loc, .value = test_ }, loc);
        }
        fn t_switch(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();

            try p.lexer.expect(.t_open_paren);
            const test_ = try p.parseExpr(.lowest);
            try p.lexer.expect(.t_close_paren);

            const body_loc = p.lexer.loc();
            _ = try p.pushScopeForParsePass(.block, body_loc);
            defer p.popScope();

            try p.lexer.expect(.t_open_brace);
            var cases = ListManaged(js_ast.Case).init(p.allocator);
            var foundDefault = false;
            var stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
            var value: ?js_ast.Expr = null;
            while (p.lexer.token != .t_close_brace) {
                var body = StmtList.init(p.allocator);
                value = null;
                if (p.lexer.token == .t_default) {
                    if (foundDefault) {
                        try p.log.addRangeError(p.source, p.lexer.range(), "Multiple default clauses are not allowed");
                        return error.SyntaxError;
                    }

                    foundDefault = true;
                    try p.lexer.next();
                    try p.lexer.expect(.t_colon);
                } else {
                    try p.lexer.expect(.t_case);
                    value = try p.parseExpr(.lowest);
                    try p.lexer.expect(.t_colon);
                }

                caseBody: while (true) {
                    switch (p.lexer.token) {
                        .t_close_brace, .t_case, .t_default => {
                            break :caseBody;
                        },
                        else => {
                            stmtOpts = ParseStatementOptions{ .lexical_decl = .allow_all };
                            try body.append(try p.parseStmt(&stmtOpts));
                        },
                    }
                }
                try cases.append(js_ast.Case{ .value = value, .body = body.items, .loc = logger.Loc.Empty });
            }
            try p.lexer.expect(.t_close_brace);
            return p.s(S.Switch{ .test_ = test_, .body_loc = body_loc, .cases = cases.items }, loc);
        }
        fn t_try(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            const body_loc = p.lexer.loc();
            try p.lexer.expect(.t_open_brace);
            _ = try p.pushScopeForParsePass(.block, loc);
            var stmt_opts = ParseStatementOptions{};
            const body = try p.parseStmtsUpTo(.t_close_brace, &stmt_opts);
            p.popScope();
            try p.lexer.next();

            var catch_: ?js_ast.Catch = null;
            var finally: ?js_ast.Finally = null;

            if (p.lexer.token == .t_catch) {
                const catch_loc = p.lexer.loc();
                _ = try p.pushScopeForParsePass(.catch_binding, catch_loc);
                try p.lexer.next();
                var binding: ?js_ast.Binding = null;

                // The catch binding is optional, and can be omitted
                if (p.lexer.token != .t_open_brace) {
                    try p.lexer.expect(.t_open_paren);
                    var value = try p.parseBinding(.{});

                    // Skip over types
                    if (is_typescript_enabled and p.lexer.token == .t_colon) {
                        try p.lexer.expect(.t_colon);
                        try p.skipTypeScriptType(.lowest);
                    }

                    try p.lexer.expect(.t_close_paren);

                    // Bare identifiers are a special case
                    var kind = Symbol.Kind.other;
                    switch (value.data) {
                        .b_identifier => {
                            kind = .catch_identifier;
                        },
                        else => {},
                    }
                    try p.declareBinding(kind, &value, &stmt_opts);
                    binding = value;
                }

                const catch_body_loc = p.lexer.loc();
                try p.lexer.expect(.t_open_brace);

                _ = try p.pushScopeForParsePass(.block, catch_body_loc);
                const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmt_opts);
                p.popScope();
                try p.lexer.next();
                catch_ = js_ast.Catch{
                    .loc = catch_loc,
                    .binding = binding,
                    .body = stmts,
                    .body_loc = catch_body_loc,
                };
                p.popScope();
            }

            if (p.lexer.token == .t_finally or catch_ == null) {
                const finally_loc = p.lexer.loc();
                _ = try p.pushScopeForParsePass(.block, finally_loc);
                try p.lexer.expect(.t_finally);
                try p.lexer.expect(.t_open_brace);
                const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmt_opts);
                try p.lexer.next();
                finally = js_ast.Finally{ .loc = finally_loc, .stmts = stmts };
                p.popScope();
            }

            return p.s(
                S.Try{ .body_loc = body_loc, .body = body, .catch_ = catch_, .finally = finally },
                loc,
            );
        }
        fn t_for(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            _ = try p.pushScopeForParsePass(.block, loc);
            defer p.popScope();

            try p.lexer.next();

            // "for await (let x of y) {}"
            var isForAwait = p.lexer.isContextualKeyword("await");
            if (isForAwait) {
                const await_range = p.lexer.range();
                if (p.fn_or_arrow_data_parse.allow_await != .allow_expr) {
                    try p.log.addRangeError(p.source, await_range, "Cannot use \"await\" outside an async function");
                    isForAwait = false;
                } else {
                    // TODO: improve error handling here
                    //                 didGenerateError := p.markSyntaxFeature(compat.ForAwait, awaitRange)
                    if (p.fn_or_arrow_data_parse.is_top_level) {
                        p.top_level_await_keyword = await_range;
                        // p.markSyntaxFeature(compat.TopLevelAwait, awaitRange)
                    }
                }
                try p.lexer.next();
            }

            try p.lexer.expect(.t_open_paren);

            var init_: ?Stmt = null;
            var test_: ?Expr = null;
            var update: ?Expr = null;

            // "in" expressions aren't allowed here
            p.allow_in = false;

            var bad_let_range: ?logger.Range = null;
            if (p.lexer.isContextualKeyword("let")) {
                bad_let_range = p.lexer.range();
            }

            var decls: G.Decl.List = .{};
            const init_loc = p.lexer.loc();
            var is_var = false;
            switch (p.lexer.token) {
                // for (var )
                .t_var => {
                    is_var = true;
                    try p.lexer.next();
                    var stmtOpts = ParseStatementOptions{};
                    var decls_list = try p.parseAndDeclareDecls(.hoisted, &stmtOpts);
                    decls = .moveFromList(&decls_list);
                    init_ = p.s(S.Local{ .kind = .k_var, .decls = decls }, init_loc);
                },
                // for (const )
                .t_const => {
                    try p.lexer.next();
                    var stmtOpts = ParseStatementOptions{};
                    var decls_list = try p.parseAndDeclareDecls(.constant, &stmtOpts);
                    decls = .moveFromList(&decls_list);
                    init_ = p.s(S.Local{ .kind = .k_const, .decls = decls }, init_loc);
                },
                // for (;)
                .t_semicolon => {},
                else => {
                    var stmtOpts = ParseStatementOptions{
                        .lexical_decl = .allow_all,
                        .is_for_loop_init = true,
                    };

                    const res = try p.parseExprOrLetStmt(&stmtOpts);
                    switch (res.stmt_or_expr) {
                        .stmt => |stmt| {
                            bad_let_range = null;
                            init_ = stmt;
                        },
                        .expr => |expr| {
                            init_ = p.s(S.SExpr{
                                .value = expr,
                            }, init_loc);
                        },
                    }
                },
            }

            // "in" expressions are allowed again
            p.allow_in = true;

            // Detect for-of loops
            if (p.lexer.isContextualKeyword("of") or isForAwait) {
                if (bad_let_range) |r| {
                    try p.log.addRangeError(p.source, r, "\"let\" must be wrapped in parentheses to be used as an expression here");
                    return error.SyntaxError;
                }

                if (isForAwait and !p.lexer.isContextualKeyword("of")) {
                    if (init_ != null) {
                        try p.lexer.expectedString("\"of\"");
                    } else {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }
                }

                try p.forbidInitializers(decls.slice(), "of", false);
                try p.lexer.next();
                const value = try p.parseExpr(.comma);
                try p.lexer.expect(.t_close_paren);
                var stmtOpts = ParseStatementOptions{};
                const body = try p.parseStmt(&stmtOpts);
                return p.s(S.ForOf{ .is_await = isForAwait, .init = init_ orelse unreachable, .value = value, .body = body }, loc);
            }

            // Detect for-in loops
            if (p.lexer.token == .t_in) {
                try p.forbidInitializers(decls.slice(), "in", is_var);
                try p.lexer.next();
                const value = try p.parseExpr(.lowest);
                try p.lexer.expect(.t_close_paren);
                var stmtOpts = ParseStatementOptions{};
                const body = try p.parseStmt(&stmtOpts);
                return p.s(S.ForIn{ .init = init_ orelse unreachable, .value = value, .body = body }, loc);
            }

            // Only require "const" statement initializers when we know we're a normal for loop
            if (init_) |init_stmt| {
                switch (init_stmt.data) {
                    .s_local => {
                        if (init_stmt.data.s_local.kind == .k_const) {
                            try p.requireInitializers(.k_const, decls.slice());
                        }
                    },
                    else => {},
                }
            }

            try p.lexer.expect(.t_semicolon);
            if (p.lexer.token != .t_semicolon) {
                test_ = try p.parseExpr(.lowest);
            }

            try p.lexer.expect(.t_semicolon);

            if (p.lexer.token != .t_close_paren) {
                update = try p.parseExpr(.lowest);
            }

            try p.lexer.expect(.t_close_paren);
            var stmtOpts = ParseStatementOptions{};
            const body = try p.parseStmt(&stmtOpts);
            return p.s(
                S.For{ .init = init_, .test_ = test_, .update = update, .body = body },
                loc,
            );
        }
        fn t_import(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            const previous_import_keyword = p.esm_import_keyword;
            p.esm_import_keyword = p.lexer.range();
            try p.lexer.next();
            var stmt: S.Import = S.Import{
                .namespace_ref = Ref.None,
                .import_record_index = std.math.maxInt(u32),
            };
            var was_originally_bare_import = false;

            // "export import foo = bar"
            if ((opts.is_export or (opts.is_namespace_scope and !opts.is_typescript_declare)) and p.lexer.token != .t_identifier) {
                try p.lexer.expected(.t_identifier);
            }

            switch (p.lexer.token) {
                // "import('path')"
                // "import.meta"
                .t_open_paren, .t_dot => {
                    p.esm_import_keyword = previous_import_keyword; // this wasn't an esm import statement after all
                    var expr = try p.parseImportExpr(loc, .lowest);
                    try p.parseSuffix(&expr, .lowest, null, Expr.EFlags.none);
                    try p.lexer.expectOrInsertSemicolon();
                    return p.s(S.SExpr{
                        .value = expr,
                    }, loc);
                },
                .t_string_literal, .t_no_substitution_template_literal => {
                    // "import 'path'"
                    if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }
                    was_originally_bare_import = true;
                },
                .t_asterisk => {
                    // "import * as ns from 'path'"
                    if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    try p.lexer.next();
                    try p.lexer.expectContextualKeyword("as");
                    stmt = S.Import{
                        .namespace_ref = try p.storeNameInRef(p.lexer.identifier),
                        .star_name_loc = p.lexer.loc(),
                        .import_record_index = std.math.maxInt(u32),
                    };
                    try p.lexer.expect(.t_identifier);
                    try p.lexer.expectContextualKeyword("from");
                },
                .t_open_brace => {
                    // "import {item1, item2} from 'path'"
                    if (!opts.is_module_scope and (!opts.is_namespace_scope or !opts.is_typescript_declare)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }
                    const importClause = try p.parseImportClause();
                    if (comptime is_typescript_enabled) {
                        if (importClause.had_type_only_imports and importClause.items.len == 0) {
                            try p.lexer.expectContextualKeyword("from");
                            _ = try p.parsePath();
                            try p.lexer.expectOrInsertSemicolon();
                            return p.s(S.TypeScript{}, loc);
                        }
                    }

                    stmt = S.Import{
                        .namespace_ref = Ref.None,
                        .import_record_index = std.math.maxInt(u32),
                        .items = importClause.items,
                        .is_single_line = importClause.is_single_line,
                    };
                    try p.lexer.expectContextualKeyword("from");
                },
                .t_identifier => {
                    // "import defaultItem from 'path'"
                    // "import foo = bar"
                    if (!opts.is_module_scope and (!opts.is_namespace_scope)) {
                        try p.lexer.unexpected();
                        return error.SyntaxError;
                    }

                    var default_name = p.lexer.identifier;
                    stmt = S.Import{ .namespace_ref = Ref.None, .import_record_index = std.math.maxInt(u32), .default_name = LocRef{
                        .loc = p.lexer.loc(),
                        .ref = try p.storeNameInRef(default_name),
                    } };
                    try p.lexer.next();

                    if (comptime is_typescript_enabled) {
                        // Skip over type-only imports
                        if (strings.eqlComptime(default_name, "type")) {
                            switch (p.lexer.token) {
                                .t_identifier => {
                                    if (!strings.eqlComptime(p.lexer.identifier, "from")) {
                                        default_name = p.lexer.identifier;
                                        stmt.default_name.?.loc = p.lexer.loc();
                                        try p.lexer.next();

                                        if (p.lexer.token == .t_equals) {
                                            // "import type foo = require('bar');"
                                            // "import type foo = bar.baz;"
                                            opts.is_typescript_declare = true;
                                            return try p.parseTypeScriptImportEqualsStmt(loc, opts, stmt.default_name.?.loc, default_name);
                                        } else {
                                            // "import type foo from 'bar';"
                                            try p.lexer.expectContextualKeyword("from");
                                            _ = try p.parsePath();
                                            try p.lexer.expectOrInsertSemicolon();
                                            return p.s(S.TypeScript{}, loc);
                                        }
                                    }
                                },
                                .t_asterisk => {
                                    // "import type * as foo from 'bar';"
                                    try p.lexer.next();
                                    try p.lexer.expectContextualKeyword("as");
                                    try p.lexer.expect(.t_identifier);
                                    try p.lexer.expectContextualKeyword("from");
                                    _ = try p.parsePath();
                                    try p.lexer.expectOrInsertSemicolon();
                                    return p.s(S.TypeScript{}, loc);
                                },

                                .t_open_brace => {
                                    // "import type {foo} from 'bar';"
                                    _ = try p.parseImportClause();
                                    try p.lexer.expectContextualKeyword("from");
                                    _ = try p.parsePath();
                                    try p.lexer.expectOrInsertSemicolon();
                                    return p.s(S.TypeScript{}, loc);
                                },
                                else => {},
                            }
                        }

                        // Parse TypeScript import assignment statements
                        if (p.lexer.token == .t_equals or opts.is_export or (opts.is_namespace_scope and !opts.is_typescript_declare)) {
                            p.esm_import_keyword = previous_import_keyword; // This wasn't an ESM import statement after all;
                            return p.parseTypeScriptImportEqualsStmt(loc, opts, logger.Loc.Empty, default_name);
                        }
                    }

                    if (p.lexer.token == .t_comma) {
                        try p.lexer.next();

                        switch (p.lexer.token) {
                            // "import defaultItem, * as ns from 'path'"
                            .t_asterisk => {
                                try p.lexer.next();
                                try p.lexer.expectContextualKeyword("as");
                                stmt.namespace_ref = try p.storeNameInRef(p.lexer.identifier);
                                stmt.star_name_loc = p.lexer.loc();
                                try p.lexer.expect(.t_identifier);
                            },
                            // "import defaultItem, {item1, item2} from 'path'"
                            .t_open_brace => {
                                const importClause = try p.parseImportClause();

                                stmt.items = importClause.items;
                                stmt.is_single_line = importClause.is_single_line;
                            },
                            else => {
                                try p.lexer.unexpected();
                                return error.SyntaxError;
                            },
                        }
                    }

                    try p.lexer.expectContextualKeyword("from");
                },
                else => {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
            }

            const path = try p.parsePath();
            try p.lexer.expectOrInsertSemicolon();

            return try p.processImportStatement(stmt, path, loc, was_originally_bare_import);
        }
        fn t_break(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            const name = try p.parseLabelName();
            try p.lexer.expectOrInsertSemicolon();
            return p.s(S.Break{ .label = name }, loc);
        }
        fn t_continue(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            const name = try p.parseLabelName();
            try p.lexer.expectOrInsertSemicolon();
            return p.s(S.Continue{ .label = name }, loc);
        }
        fn t_return(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            if (p.fn_or_arrow_data_parse.is_return_disallowed) {
                try p.log.addRangeError(p.source, p.lexer.range(), "A return statement cannot be used here");
            }
            try p.lexer.next();
            var value: ?Expr = null;
            if ((p.lexer.token != .t_semicolon and
                !p.lexer.has_newline_before and
                p.lexer.token != .t_close_brace and
                p.lexer.token != .t_end_of_file))
            {
                value = try p.parseExpr(.lowest);
            }
            p.latest_return_had_semicolon = p.lexer.token == .t_semicolon;
            try p.lexer.expectOrInsertSemicolon();

            return p.s(S.Return{ .value = value }, loc);
        }
        fn t_throw(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            if (p.lexer.has_newline_before) {
                try p.log.addError(p.source, logger.Loc{
                    .start = loc.start + 5,
                }, "Unexpected newline after \"throw\"");
                return error.SyntaxError;
            }
            const expr = try p.parseExpr(.lowest);
            try p.lexer.expectOrInsertSemicolon();
            return p.s(S.Throw{ .value = expr }, loc);
        }
        fn t_debugger(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            try p.lexer.next();
            try p.lexer.expectOrInsertSemicolon();
            return p.s(S.Debugger{}, loc);
        }
        fn t_open_brace(p: *P, _: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            _ = try p.pushScopeForParsePass(.block, loc);
            defer p.popScope();
            try p.lexer.next();
            var stmtOpts = ParseStatementOptions{};
            const stmts = try p.parseStmtsUpTo(.t_close_brace, &stmtOpts);
            const close_brace_loc = p.lexer.loc();
            try p.lexer.next();
            return p.s(S.Block{
                .stmts = stmts,
                .close_brace_loc = close_brace_loc,
            }, loc);
        }

        fn parseStmtFallthrough(p: *P, opts: *ParseStatementOptions, loc: logger.Loc) anyerror!Stmt {
            const is_identifier = p.lexer.token == .t_identifier;
            const name = p.lexer.identifier;
            // Parse either an async function, an async expression, or a normal expression
            var expr: Expr = Expr{ .loc = loc, .data = Expr.Data{ .e_missing = .{} } };
            if (is_identifier and strings.eqlComptime(p.lexer.raw(), "async")) {
                const async_range = p.lexer.range();
                try p.lexer.next();
                if (p.lexer.token == .t_function and !p.lexer.has_newline_before) {
                    try p.lexer.next();

                    return try p.parseFnStmt(async_range.loc, opts, async_range);
                }

                expr = try p.parseAsyncPrefixExpr(async_range, .lowest);
                try p.parseSuffix(&expr, .lowest, null, Expr.EFlags.none);
            } else {
                const exprOrLet = try p.parseExprOrLetStmt(opts);
                switch (exprOrLet.stmt_or_expr) {
                    .stmt => |stmt| {
                        try p.lexer.expectOrInsertSemicolon();
                        return stmt;
                    },
                    .expr => |_expr| {
                        expr = _expr;
                    },
                }
            }
            if (is_identifier) {
                switch (expr.data) {
                    .e_identifier => |ident| {
                        if (p.lexer.token == .t_colon and !opts.hasDecorators()) {
                            _ = try p.pushScopeForParsePass(.label, loc);
                            defer p.popScope();

                            // Parse a labeled statement
                            try p.lexer.next();

                            const _name = LocRef{ .loc = expr.loc, .ref = ident.ref };
                            var nestedOpts = ParseStatementOptions{};

                            switch (opts.lexical_decl) {
                                .allow_all, .allow_fn_inside_label => {
                                    nestedOpts.lexical_decl = .allow_fn_inside_label;
                                },
                                else => {},
                            }
                            const stmt = try p.parseStmt(&nestedOpts);
                            return p.s(S.Label{ .name = _name, .stmt = stmt }, loc);
                        }
                    },
                    else => {},
                }

                if (is_typescript_enabled) {
                    if (js_lexer.TypescriptStmtKeyword.List.get(name)) |ts_stmt| {
                        switch (ts_stmt) {
                            .ts_stmt_type => {
                                if (p.lexer.token == .t_identifier and !p.lexer.has_newline_before) {
                                    // "type Foo = any"
                                    var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };
                                    try p.skipTypeScriptTypeStmt(&stmtOpts);
                                    return p.s(S.TypeScript{}, loc);
                                }
                            },
                            .ts_stmt_namespace, .ts_stmt_module => {
                                // "namespace Foo {}"
                                // "module Foo {}"
                                // "declare module 'fs' {}"
                                // "declare module 'fs';"
                                if (!p.lexer.has_newline_before and
                                    (opts.is_module_scope or opts.is_namespace_scope) and
                                    (p.lexer.token == .t_identifier or (p.lexer.token == .t_string_literal and opts.is_typescript_declare)))
                                {
                                    return p.parseTypeScriptNamespaceStmt(loc, opts);
                                }
                            },
                            .ts_stmt_interface => {
                                // "interface Foo {}"
                                var stmtOpts = ParseStatementOptions{ .is_module_scope = opts.is_module_scope };

                                try p.skipTypeScriptInterfaceStmt(&stmtOpts);
                                return p.s(S.TypeScript{}, loc);
                            },
                            .ts_stmt_abstract => {
                                if (p.lexer.token == .t_class or opts.ts_decorators != null) {
                                    return try p.parseClassStmt(loc, opts);
                                }
                            },
                            .ts_stmt_global => {
                                // "declare module 'fs' { global { namespace NodeJS {} } }"
                                if (opts.is_namespace_scope and opts.is_typescript_declare and p.lexer.token == .t_open_brace) {
                                    try p.lexer.next();
                                    _ = try p.parseStmtsUpTo(.t_close_brace, opts);
                                    try p.lexer.next();
                                    return p.s(S.TypeScript{}, loc);
                                }
                            },
                            .ts_stmt_declare => {
                                opts.lexical_decl = .allow_all;
                                opts.is_typescript_declare = true;

                                // "@decorator declare class Foo {}"
                                // "@decorator declare abstract class Foo {}"
                                if (opts.ts_decorators != null and p.lexer.token != .t_class and !p.lexer.isContextualKeyword("abstract")) {
                                    try p.lexer.expected(.t_class);
                                }

                                // "declare global { ... }"
                                if (p.lexer.isContextualKeyword("global")) {
                                    try p.lexer.next();
                                    try p.lexer.expect(.t_open_brace);
                                    _ = try p.parseStmtsUpTo(.t_close_brace, opts);
                                    try p.lexer.next();
                                    return p.s(S.TypeScript{}, loc);
                                }

                                // "declare const x: any"
                                const stmt = try p.parseStmt(opts);
                                if (opts.ts_decorators) |decs| {
                                    p.discardScopesUpTo(decs.scope_index);
                                }

                                // Unlike almost all uses of "declare", statements that use
                                // "export declare" with "var/let/const" inside a namespace affect
                                // code generation. They cause any declared bindings to be
                                // considered exports of the namespace. Identifier references to
                                // those names must be converted into property accesses off the
                                // namespace object:
                                //
                                //   namespace ns {
                                //     export declare const x
                                //     export function y() { return x }
                                //   }
                                //
                                //   (ns as any).x = 1
                                //   console.log(ns.y())
                                //
                                // In this example, "return x" must be replaced with "return ns.x".
                                // This is handled by replacing each "export declare" statement
                                // inside a namespace with an "export var" statement containing all
                                // of the declared bindings. That "export var" statement will later
                                // cause identifiers to be transformed into property accesses.
                                if (opts.is_namespace_scope and opts.is_export) {
                                    var decls: G.Decl.List = .{};
                                    switch (stmt.data) {
                                        .s_local => |local| {
                                            var _decls = try ListManaged(G.Decl).initCapacity(p.allocator, local.decls.len);
                                            for (local.decls.slice()) |decl| {
                                                try extractDeclsForBinding(decl.binding, &_decls);
                                            }
                                            decls = .moveFromList(&_decls);
                                        },
                                        else => {},
                                    }

                                    if (decls.len > 0) {
                                        return p.s(S.Local{
                                            .kind = .k_var,
                                            .is_export = true,
                                            .decls = decls,
                                        }, loc);
                                    }
                                }

                                return p.s(S.TypeScript{}, loc);
                            },
                        }
                    }
                }
            }
            // Output.print("\n\nmVALUE {s}:{s}\n", .{ expr, name });
            try p.lexer.expectOrInsertSemicolon();
            return p.s(S.SExpr{ .value = expr }, loc);
        }

        pub fn parseStmt(p: *P, opts: *ParseStatementOptions) anyerror!Stmt {
            if (!p.stack_check.isSafeToRecurse()) {
                try bun.throwStackOverflow();
            }

            return switch (p.lexer.token) {
                .t_semicolon => t_semicolon(p),
                .t_at => t_at(p, opts),

                inline .t_export,
                .t_function,
                .t_enum,
                .t_class,
                .t_var,
                .t_const,
                .t_if,
                .t_do,
                .t_while,
                .t_with,
                .t_switch,
                .t_try,
                .t_for,
                .t_import,
                .t_break,
                .t_continue,
                .t_return,
                .t_throw,
                .t_debugger,
                .t_open_brace,
                => |function| @field(@This(), @tagName(function))(p, opts, p.lexer.loc()),

                else => parseStmtFallthrough(p, opts, p.lexer.loc()),
            };
        }
    };
}

const bun = @import("bun");
const Output = bun.Output;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const Binding = js_ast.Binding;
const Expr = js_ast.Expr;
const LocRef = js_ast.LocRef;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const G = js_ast.G;
const Decl = G.Decl;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const js_lexer = bun.js_lexer;
const T = js_lexer.T;

const js_parser = bun.js_parser;
const DeferredTsDecorators = js_parser.DeferredTsDecorators;
const ImportKind = js_parser.ImportKind;
const JSXTransformType = js_parser.JSXTransformType;
const ParseStatementOptions = js_parser.ParseStatementOptions;
const ParsedPath = js_parser.ParsedPath;
const Ref = js_parser.Ref;
const StmtList = js_parser.StmtList;
const TypeScript = js_parser.TypeScript;
const fs = js_parser.fs;

const std = @import("std");
const List = std.ArrayListUnmanaged;
const ListManaged = std.array_list.Managed;
