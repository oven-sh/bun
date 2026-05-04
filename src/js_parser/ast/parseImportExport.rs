use bun_core::Error;
use bun_js_parser::ast::{self as js_ast, ClauseItem, Expr, ExprData, LocRef, E};
use bun_js_parser::ast::op::Level;
use bun_js_parser::lexer::{self as js_lexer, T};
use bun_js_parser::{
    is_eval_or_arguments, ExportClauseResult, ImportClause, JSXTransformType, NewParser_,
};
use bun_logger as logger;

// Zig: `fn ParseImportExport(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// This is a mixin struct whose methods take `*P`. Port as a ZST carrying the const
// generics, with associated fns that take `&mut P`. Phase B may flatten these into
// `impl P { ... }` directly.
pub struct ParseImportExport<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

type P<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
> = NewParser_<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>;

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > ParseImportExport<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    const IS_TYPESCRIPT_ENABLED: bool =
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::IS_TYPESCRIPT_ENABLED;
    const ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT: bool =
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT;

    /// Note: The caller has already parsed the "import" keyword
    pub fn parse_import_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
        level: Level,
    ) -> Result<Expr, Error> {
        // Parse an "import.meta" expression
        if p.lexer.token == T::TDot {
            p.esm_import_keyword = js_lexer::range_of_identifier(p.source, loc);
            p.lexer.next()?;
            if p.lexer.is_contextual_keyword(b"meta") {
                p.lexer.next()?;
                p.has_import_meta = true;
                return Ok(p.new_expr(E::ImportMeta {}, loc));
            } else {
                p.lexer.expected_string("\"meta\"")?;
            }
        }

        if level.gt(Level::Call) {
            let r = js_lexer::range_of_identifier(p.source, loc);
            p.log
                .add_range_error(
                    p.source,
                    r,
                    "Cannot use an \"import\" expression here without parentheses",
                )
                .expect("unreachable");
        }

        // allow "in" inside call arguments;
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        p.lexer.preserve_all_comments_before = true;
        p.lexer.expect(T::TOpenParen)?;

        // const comments = try p.lexer.comments_to_preserve_before.toOwnedSlice();
        p.lexer.comments_to_preserve_before.clear();

        p.lexer.preserve_all_comments_before = false;

        let value = p.parse_expr(Level::Comma)?;

        let mut import_options = Expr::EMPTY;
        if p.lexer.token == T::TComma {
            // "import('./foo.json', )"
            p.lexer.next()?;

            if p.lexer.token != T::TCloseParen {
                // "import('./foo.json', { assert: { type: 'json' } })"
                import_options = p.parse_expr(Level::Comma)?;

                if p.lexer.token == T::TComma {
                    // "import('./foo.json', { assert: { type: 'json' } }, )"
                    p.lexer.next()?;
                }
            }
        }

        p.lexer.expect(T::TCloseParen)?;

        p.allow_in = old_allow_in;

        if Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT {
            if let ExprData::EString(e_string) = &value.data {
                if e_string.is_utf8() && e_string.is_present() {
                    // PORT NOTE: reshaped for borrowck — capture slice before calling &mut self method.
                    let slice = e_string.slice(p.allocator);
                    let import_record_index = p.add_import_record(
                        bun_options_types::ImportKind::Dynamic,
                        value.loc,
                        slice,
                    );

                    return Ok(p.new_expr(
                        E::Import {
                            expr: value,
                            // .leading_interior_comments = comments,
                            import_record_index,
                            options: import_options,
                        },
                        loc,
                    ));
                }
            }
        }

        // _ = comments; // TODO: leading_interior comments

        Ok(p.new_expr(
            E::Import {
                expr: value,
                // .leading_interior_comments = comments,
                import_record_index: u32::MAX,
                options: import_options,
            },
            loc,
        ))
    }

    pub fn parse_import_clause(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<ImportClause, Error> {
        // TODO(port): narrow error set
        let mut items = bumpalo::collections::Vec::<ClauseItem>::new_in(p.allocator);
        p.lexer.expect(T::TOpenBrace)?;
        let mut is_single_line = !p.lexer.has_newline_before;
        // this variable should not exist if we're not in a typescript file
        // PORT NOTE: in Zig this var was comptime-gated to only exist when TS is enabled;
        // in Rust we declare it unconditionally — dead-store elim removes it when !TS.
        let mut had_type_only_imports = false;

        while p.lexer.token != T::TCloseBrace {
            // The alias may be a keyword;
            let is_identifier = p.lexer.token == T::TIdentifier;
            let alias_loc = p.lexer.loc();
            let alias = p.parse_clause_alias(b"import")?;
            let mut name = LocRef {
                loc: alias_loc,
                ref_: p.store_name_in_ref(alias)?,
            };
            let mut original_name = alias;
            p.lexer.next()?;

            let probably_type_only_import = if Self::IS_TYPESCRIPT_ENABLED {
                alias == b"type"
                    && p.lexer.token != T::TComma
                    && p.lexer.token != T::TCloseBrace
            } else {
                false
            };

            // "import { type xx } from 'mod'"
            // "import { type xx as yy } from 'mod'"
            // "import { type 'xx' as yy } from 'mod'"
            // "import { type as } from 'mod'"
            // "import { type as as } from 'mod'"
            // "import { type as as as } from 'mod'"
            if probably_type_only_import {
                if p.lexer.is_contextual_keyword(b"as") {
                    p.lexer.next()?;
                    if p.lexer.is_contextual_keyword(b"as") {
                        original_name = p.lexer.identifier;
                        name = LocRef {
                            loc: p.lexer.loc(),
                            ref_: p.store_name_in_ref(original_name)?,
                        };
                        p.lexer.next()?;

                        if p.lexer.token == T::TIdentifier {
                            // "import { type as as as } from 'mod'"
                            // "import { type as as foo } from 'mod'"
                            had_type_only_imports = true;
                            p.lexer.next()?;
                        } else {
                            // "import { type as as } from 'mod'"

                            items.push(ClauseItem {
                                alias,
                                alias_loc,
                                name,
                                original_name,
                            });
                        }
                    } else if p.lexer.token == T::TIdentifier {
                        had_type_only_imports = true;

                        // "import { type as xxx } from 'mod'"
                        original_name = p.lexer.identifier;
                        name = LocRef {
                            loc: p.lexer.loc(),
                            ref_: p.store_name_in_ref(original_name)?,
                        };
                        p.lexer.expect(T::TIdentifier)?;

                        if is_eval_or_arguments(original_name) {
                            let r = p.source.range_of_string(name.loc);
                            p.log.add_range_error_fmt(
                                p.source,
                                r,
                                format_args!(
                                    "Cannot use {} as an identifier here",
                                    bstr::BStr::new(original_name)
                                ),
                            )?;
                        }

                        items.push(ClauseItem {
                            alias,
                            alias_loc,
                            name,
                            original_name,
                        });
                    }
                } else {
                    let is_identifier_inner = p.lexer.token == T::TIdentifier;

                    // "import { type xx } from 'mod'"
                    // "import { type xx as yy } from 'mod'"
                    // "import { type if as yy } from 'mod'"
                    // "import { type 'xx' as yy } from 'mod'"
                    let _ = p.parse_clause_alias(b"import")?;
                    p.lexer.next()?;

                    if p.lexer.is_contextual_keyword(b"as") {
                        p.lexer.next()?;

                        p.lexer.expect(T::TIdentifier)?;
                    } else if !is_identifier_inner {
                        // An import where the name is a keyword must have an alias
                        p.lexer.expected_string("\"as\"")?;
                    }
                    had_type_only_imports = true;
                }
            } else {
                if p.lexer.is_contextual_keyword(b"as") {
                    p.lexer.next()?;
                    original_name = p.lexer.identifier;
                    name = LocRef {
                        loc: alias_loc,
                        ref_: p.store_name_in_ref(original_name)?,
                    };
                    p.lexer.expect(T::TIdentifier)?;
                } else if !is_identifier {
                    // An import where the name is a keyword must have an alias
                    p.lexer.expected_string("\"as\"")?;
                }

                // Reject forbidden names
                if is_eval_or_arguments(original_name) {
                    let r = js_lexer::range_of_identifier(p.source, name.loc);
                    p.log.add_range_error_fmt(
                        p.source,
                        r,
                        format_args!(
                            "Cannot use \"{}\" as an identifier here",
                            bstr::BStr::new(original_name)
                        ),
                    )?;
                }

                items.push(ClauseItem {
                    alias,
                    alias_loc,
                    name,
                    original_name,
                });
            }

            if p.lexer.token != T::TComma {
                break;
            }

            if p.lexer.has_newline_before {
                is_single_line = false;
            }

            p.lexer.next()?;

            if p.lexer.has_newline_before {
                is_single_line = false;
            }
        }

        if p.lexer.has_newline_before {
            is_single_line = false;
        }

        p.lexer.expect(T::TCloseBrace)?;
        Ok(ImportClause {
            items: items.into_bump_slice(),
            is_single_line,
            had_type_only_imports: if Self::IS_TYPESCRIPT_ENABLED {
                had_type_only_imports
            } else {
                false
            },
        })
    }

    pub fn parse_export_clause(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<ExportClauseResult, Error> {
        // TODO(port): narrow error set
        let mut items =
            bumpalo::collections::Vec::<ClauseItem>::with_capacity_in(1, p.allocator);
        p.lexer.expect(T::TOpenBrace)?;
        let mut is_single_line = !p.lexer.has_newline_before;
        let mut first_non_identifier_loc = logger::Loc { start: 0 };
        let mut had_type_only_exports = false;

        while p.lexer.token != T::TCloseBrace {
            let mut alias = p.parse_clause_alias(b"export")?;
            let mut alias_loc = p.lexer.loc();

            let name = LocRef {
                loc: alias_loc,
                ref_: p.store_name_in_ref(alias).expect("unreachable"),
            };
            let original_name = alias;

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
            if p.lexer.token != T::TIdentifier && first_non_identifier_loc.start == 0 {
                first_non_identifier_loc = p.lexer.loc();
            }
            p.lexer.next()?;

            if Self::IS_TYPESCRIPT_ENABLED {
                if alias == b"type"
                    && p.lexer.token != T::TComma
                    && p.lexer.token != T::TCloseBrace
                {
                    if p.lexer.is_contextual_keyword(b"as") {
                        p.lexer.next()?;

                        if p.lexer.is_contextual_keyword(b"as") {
                            alias = p.parse_clause_alias(b"export")?;
                            alias_loc = p.lexer.loc();
                            p.lexer.next()?;

                            if p.lexer.token != T::TComma && p.lexer.token != T::TCloseBrace {
                                // "export { type as as as }"
                                // "export { type as as foo }"
                                // "export { type as as 'foo' }"
                                let _ = p.parse_clause_alias(b"export").unwrap_or(b"");
                                had_type_only_exports = true;
                                p.lexer.next()?;
                            } else {
                                // "export { type as as }"
                                items.push(ClauseItem {
                                    alias,
                                    alias_loc,
                                    name,
                                    original_name,
                                });
                                // PERF(port): was assume_capacity (catch unreachable on append)
                            }
                        } else if p.lexer.token != T::TComma && p.lexer.token != T::TCloseBrace
                        {
                            // "export { type as xxx }"
                            // "export { type as 'xxx' }"
                            alias = p.parse_clause_alias(b"export")?;
                            alias_loc = p.lexer.loc();
                            p.lexer.next()?;

                            items.push(ClauseItem {
                                alias,
                                alias_loc,
                                name,
                                original_name,
                            });
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
                        if p.lexer.token != T::TIdentifier && first_non_identifier_loc.start == 0 {
                            first_non_identifier_loc = p.lexer.loc();
                        }

                        // "export { type xx }"
                        // "export { type xx as yy }"
                        // "export { type xx as if }"
                        // "export { type default } from 'path'"
                        // "export { type default as if } from 'path'"
                        // "export { type xx as 'yy' }"
                        // "export { type 'xx' } from 'mod'"
                        let _ = p.parse_clause_alias(b"export").unwrap_or(b"");
                        p.lexer.next()?;

                        if p.lexer.is_contextual_keyword(b"as") {
                            p.lexer.next()?;
                            let _ = p.parse_clause_alias(b"export").unwrap_or(b"");
                            p.lexer.next()?;
                        }

                        had_type_only_exports = true;
                    }
                } else {
                    if p.lexer.is_contextual_keyword(b"as") {
                        p.lexer.next()?;
                        alias = p.parse_clause_alias(b"export")?;
                        alias_loc = p.lexer.loc();

                        p.lexer.next()?;
                    }

                    items.push(ClauseItem {
                        alias,
                        alias_loc,
                        name,
                        original_name,
                    });
                }
            } else {
                if p.lexer.is_contextual_keyword(b"as") {
                    p.lexer.next()?;
                    alias = p.parse_clause_alias(b"export")?;
                    alias_loc = p.lexer.loc();

                    p.lexer.next()?;
                }

                items.push(ClauseItem {
                    alias,
                    alias_loc,
                    name,
                    original_name,
                });
            }

            // we're done if there's no comma
            if p.lexer.token != T::TComma {
                break;
            }

            if p.lexer.has_newline_before {
                is_single_line = false;
            }
            p.lexer.next()?;
            if p.lexer.has_newline_before {
                is_single_line = false;
            }
        }

        if p.lexer.has_newline_before {
            is_single_line = false;
        }
        p.lexer.expect(T::TCloseBrace)?;

        // Throw an error here if we found a keyword earlier and this isn't an
        // "export from" statement after all
        if first_non_identifier_loc.start != 0 && !p.lexer.is_contextual_keyword(b"from") {
            let r = js_lexer::range_of_identifier(p.source, first_non_identifier_loc);
            p.lexer.add_range_error(
                r,
                format_args!(
                    "Expected identifier but found \"{}\"",
                    bstr::BStr::new(p.source.text_for_range(r))
                ),
                true,
            )?;
            return Err(bun_core::err!("SyntaxError"));
        }

        Ok(ExportClauseResult {
            clauses: items.into_bump_slice(),
            is_single_line,
            had_type_only_exports,
        })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseImportExport.zig (437 lines)
//   confidence: medium
//   todos:      2
//   notes:      mixin-struct pattern ported as ZST + assoc fns over P<const TS, const JSX, const SCAN_ONLY>; Phase B may flatten into `impl P`. Arena Vec used for clause items (AST crate).
// ──────────────────────────────────────────────────────────────────────────
