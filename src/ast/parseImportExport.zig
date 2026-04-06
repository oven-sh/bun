pub fn ParseImportExport(
    comptime parser_feature__typescript: bool,
    comptime parser_feature__jsx: JSXTransformType,
    comptime parser_feature__scan_only: bool,
) type {
    return struct {
        const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
        const is_typescript_enabled = P.is_typescript_enabled;
        const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;

        /// Note: The caller has already parsed the "import" keyword
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
    };
}

const std = @import("std");
const ListManaged = std.array_list.Managed;

const bun = @import("bun");
const assert = bun.assert;
const js_lexer = bun.js_lexer;
const logger = bun.logger;
const strings = bun.strings;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
const LocRef = js_ast.LocRef;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const js_parser = bun.js_parser;
const ExportClauseResult = js_parser.ExportClauseResult;
const ImportClause = js_parser.ImportClause;
const JSXTransformType = js_parser.JSXTransformType;
const isEvalOrArguments = js_parser.isEvalOrArguments;
const options = js_parser.options;
