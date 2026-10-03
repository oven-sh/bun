use crate::Error;
use crate::lexer::{self as js_lexer, T};
use crate::p::P;
use crate::parse::lists::{ListKind, ListStep};
use crate::parser::{ExportClauseResult, ImportClause, is_eval_or_arguments};
use bun_alloc::ArenaVecExt as _;
use bun_ast::LexerLog as _;
use bun_ast::expr::Data as ExprData;
use bun_ast::op::Level;
use bun_ast::{ClauseItem, E, Expr, LocRef, Ref};

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    /// Note: The caller has already parsed the "import" keyword
    pub(crate) fn parse_import_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
    ) -> Result<Expr, Error> {
        let p = self;
        let mut is_deferred = false;
        let mut type_arguments = None;
        // Parse an "import.meta" expression
        if p.lexer.token == T::TDot {
            p.esm_import_keyword = js_lexer::range_of_identifier(p.source, loc);
            p.lexer.next()?;
            if p.lexer.is_contextual_keyword(b"meta") {
                p.lexer.next()?;
                p.has_import_meta = true;
                return Ok(p.new_expr(E::ImportMeta {}, loc));
            } else if p.lexer.tolerant {
                if let Some(expr) = p.parse_other_import_meta_property(loc)? {
                    return Ok(expr);
                }
                // `import.defer(..)` is an import call.
                is_deferred = true;
            } else {
                p.lexer.expected_string(b"\"meta\"")?;
            }
        } else if TYPESCRIPT && p.lexer.token == T::TLessThan && p.lexer.tolerant {
            // `parseLeftHandSideExpressionOrHigher`: `import` before `<` is the keyword by itself, an expression of the error type.
            // Type arguments are tried after it as after any expression (`tryParseTypeArgumentsInExpression`). None of this is a
            // syntax error, so it is no reason for an attempt at parsing to fail either.
            let less_than = p.lexer.loc();
            let (logged, errors) = (p.log().msgs.len(), p.log().errors);
            if !p.try_skip_type_script_type_arguments_with_backtracking() {
                // `import < a`: nothing is said, and the caller goes on with the comparison.
                return Ok(p.new_expr(E::Missing {}, loc));
            }
            if p.lexer.token != T::TOpenParen {
                // `parseMemberExpressionRest`: a tagged template takes the type arguments for itself, and nothing objects to them there.
                if !matches!(
                    p.lexer.token,
                    T::TNoSubstitutionTemplateLiteral | T::TTemplateHead
                ) {
                    // `checkGrammarExpressionWithTypeArguments`
                    p.lexer.ts_grammar_error(p.lexer.range_from(loc), 1326);
                }
                // `checkExpressionWithTypeArguments` checks the type arguments.
                let mut keyword = p.new_expr(E::Missing {}, loc);
                p.note_type_arguments(&mut keyword, less_than);
                return Ok(keyword);
            }
            // `import<T>(x)` is the call. `checkImportCallExpression` never looks at its type arguments, so what the list logged about
            // itself (1099, 1009) goes.
            let log = p.log();
            log.msgs.truncate(logged);
            log.errors = errors;
            type_arguments = p.kept_type_arguments();
        }

        if level.gt(Level::Call) {
            let r = js_lexer::range_of_identifier(p.source, loc);
            p.log().add_range_error(
                Some(p.source),
                r,
                b"Cannot use an \"import\" expression here without parentheses",
            );
        }

        if p.lexer.tolerant {
            return p.parse_import_call_tolerant(loc, is_deferred, type_arguments);
        }

        // allow "in" inside call arguments;
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        p.lexer.preserve_all_comments_before = true;
        p.lexer.expect(T::TOpenParen)?;

        // const comments = try p.lexer.comments_to_preserve_before.toOwnedSlice();
        p.lexer.comments_to_preserve_before.clear();

        p.lexer.preserve_all_comments_before = false;

        let mut value = p.parse_expr(Level::Comma)?;

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

        if SCAN_ONLY {
            // Reshaped for borrowck — EString::slice takes &mut self (rope flatten),
            // so capture the slice (arena-lifetime) before re-using `value` by-value below.
            let slice_opt: Option<&'a [u8]> = if let ExprData::EString(e_string) = &mut value.data {
                if e_string.is_utf8() && e_string.is_present() {
                    Some(e_string.slice(p.arena))
                } else {
                    None
                }
            } else {
                None
            };
            if let Some(slice) = slice_opt {
                let import_record_index =
                    p.add_import_record(bun_ast::ImportKind::Dynamic, value.loc, slice);
                return Ok(p.new_expr(
                    E::Import {
                        expr: value,
                        import_record_index,
                        options: import_options,
                        namespace_ref: Ref::NONE,
                    },
                    loc,
                ));
            }
        }

        // _ = comments; // TODO: leading_interior comments

        Ok(p.new_expr(
            E::Import {
                expr: value,
                // .leading_interior_comments = comments,
                import_record_index: u32::MAX,
                options: import_options,
                namespace_ref: Ref::NONE,
            },
            loc,
        ))
    }

    /// `import.name` where the name is not `meta`, after the dot (`parseLeftHandSideExpressionOrHigher`). It is a meta property
    /// of the error type whatever the name is, and `checkGrammarMetaProperty` objects. It is kept as an access to the name on a missing
    /// expression where the keyword is, which has that type. `None`: `import.defer` before its arguments.
    #[cold]
    #[inline(never)]
    fn parse_other_import_meta_property(
        &mut self,
        loc: bun_ast::Loc,
    ) -> Result<Option<Expr>, Error> {
        let p = self;
        if !p.lexer.is_identifier_or_keyword() {
            // `parseIdentifierName`: 1003, nothing consumed.
            p.lexer.expect(T::TIdentifier)?;
            return Ok(Some(p.new_expr(E::Missing {}, loc)));
        }
        let name = p.lexer.range();
        let word = p.lexer.identifier;
        let text = E::Str::new(word);
        let is_defer = word == b"defer";
        p.lexer.next()?;
        let is_callee = p.lexer.token == T::TOpenParen;
        if is_defer && is_callee {
            return Ok(None);
        }
        if is_defer {
            // "(" expected, where the meta property ends.
            let end = bun_ast::Loc {
                start: name.loc.start + name.len,
            };
            p.lexer
                .ts_grammar_expected(bun_ast::Range { loc: end, len: 0 }, "(");
        } else if is_callee {
            p.lexer.ts_grammar_error_about(name, 18061, word);
        } else {
            let named = [word, b"import", b"meta"].join(&0);
            p.lexer.ts_grammar_error_about(name, 17012, &named);
        }
        let target = p.new_expr(E::Missing {}, loc);
        Ok(Some(p.new_expr(
            E::Dot {
                target,
                name: text,
                name_loc: name.loc,
                ..Default::default()
            },
            loc,
        )))
    }

    /// `parseArgumentList` after `import` or `import.defer`: any number of arguments, spreads included.
    /// `checkGrammarImportCallExpression` objects to them. `E::Import` has room for two.
    #[cold]
    #[inline(never)]
    fn parse_import_call_tolerant(
        &mut self,
        loc: bun_ast::Loc,
        is_deferred: bool,
        type_arguments: Option<u32>,
    ) -> Result<Expr, Error> {
        let p = self;
        let args = p.parse_call_args()?;
        let specifier = match args.list.first() {
            Some(first) => *first,
            None => p.new_expr(E::Missing {}, args.loc),
        };
        let options = match args.list.get(1) {
            Some(second) => *second,
            None => Expr::EMPTY,
        };
        let mut call = p.new_expr(
            E::Import {
                expr: specifier,
                import_record_index: u32::MAX,
                options,
                namespace_ref: Ref::NONE,
            },
            loc,
        );
        if is_deferred {
            p.note_loc(
                &mut call.loc,
                crate::sema::Mark::DeferredImportClose,
                args.loc,
            );
        }
        if let Some(type_arguments) = type_arguments {
            // `checkGrammarImportCallExpression`
            p.lexer.ts_grammar_error(p.lexer.range_from(loc), 1326);
            p.note(
                &mut call.loc,
                crate::sema::Mark::TypeArguments,
                type_arguments,
            );
        }
        for argument in args.list.get(2..).unwrap_or_default() {
            p.note_expr(&mut call.loc, crate::sema::Mark::OtherArgument, *argument);
        }
        Ok(call)
    }

    pub(crate) fn parse_import_clause(&mut self) -> Result<ImportClause<'a>, Error> {
        let p = self;
        if p.lexer.tolerant {
            let (items, had_type_only_imports) = p.parse_specifiers_tolerant(true)?;
            return Ok(ImportClause {
                items,
                is_single_line: false,
                had_type_only_imports,
            });
        }
        let mut items = bun_alloc::ArenaVec::<ClauseItem>::new_in(p.arena);
        p.lexer.expect(T::TOpenBrace)?;
        let mut is_single_line = !p.lexer.has_newline_before;
        // this variable should not exist if we're not in a typescript file
        // Declared unconditionally — dead-store elim removes it when !TS.
        let mut had_type_only_imports = false;

        while p.lexer.token != T::TCloseBrace {
            // The alias may be a keyword;
            let is_identifier = p.lexer.token == T::TIdentifier;
            let alias_loc = p.lexer.loc();
            let alias = p.parse_clause_alias(b"import")?;
            let mut name = LocRef {
                loc: alias_loc,
                ref_: p.store_name_in_ref(alias),
            };
            let mut original_name = alias;
            p.lexer.next()?;

            let probably_type_only_import = if TYPESCRIPT {
                alias == b"type" && p.lexer.token != T::TComma && p.lexer.token != T::TCloseBrace
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
                            ref_: p.store_name_in_ref(original_name),
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
                                alias: alias.into(),
                                alias_loc,
                                name,
                                original_name: original_name.into(),
                            });
                        }
                    } else if p.lexer.token == T::TIdentifier {
                        had_type_only_imports = true;

                        // "import { type as xxx } from 'mod'"
                        original_name = p.lexer.identifier;
                        name = LocRef {
                            loc: p.lexer.loc(),
                            ref_: p.store_name_in_ref(original_name),
                        };
                        p.lexer.expect(T::TIdentifier)?;

                        if is_eval_or_arguments(original_name) {
                            let r = p.source.range_of_string(name.loc);
                            p.log().add_range_error_fmt(
                                Some(p.source),
                                r,
                                format_args!(
                                    "Cannot use {} as an identifier here",
                                    bstr::BStr::new(original_name)
                                ),
                            );
                        }

                        items.push(ClauseItem {
                            alias: alias.into(),
                            alias_loc,
                            name,
                            original_name: original_name.into(),
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
                        p.lexer.expected_string(b"\"as\"")?;
                    }
                    had_type_only_imports = true;
                }
            } else {
                if p.lexer.is_contextual_keyword(b"as") {
                    p.lexer.next()?;
                    original_name = p.lexer.identifier;
                    name = LocRef {
                        loc: alias_loc,
                        ref_: p.store_name_in_ref(original_name),
                    };
                    p.lexer.expect(T::TIdentifier)?;
                } else if !is_identifier {
                    // An import where the name is a keyword must have an alias
                    p.lexer.expected_string(b"\"as\"")?;
                }

                // Reject forbidden names
                if is_eval_or_arguments(original_name) {
                    let r = js_lexer::range_of_identifier(p.source, name.loc);
                    p.log().add_range_error_fmt(
                        Some(p.source),
                        r,
                        format_args!(
                            "Cannot use \"{}\" as an identifier here",
                            bstr::BStr::new(original_name)
                        ),
                    );
                }

                items.push(ClauseItem {
                    alias: alias.into(),
                    alias_loc,
                    name,
                    original_name: original_name.into(),
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
            items: items.into_bump_slice_mut(),
            is_single_line,
            had_type_only_imports: if TYPESCRIPT {
                had_type_only_imports
            } else {
                false
            },
        })
    }

    /// `parseNamedImports`, `parseNamedExports`. Returns the specifiers that are not type-only, and whether any is type-only.
    /// All of them are kept for the checker.
    #[cold]
    #[inline(never)]
    fn parse_specifiers_tolerant(
        &mut self,
        is_import: bool,
    ) -> Result<(&'a mut [ClauseItem], bool), Error> {
        let p = self;
        let mut items = bun_alloc::ArenaVec::<ClauseItem>::new_in(p.arena);
        let mut had_type_only = false;
        let mut kept: smallvec::SmallVec<[crate::sema::ts_syntax::Specifier; 8]> =
            smallvec::SmallVec::new();
        // `parseBracketedList`: without a "{" there is no list, and no "}" is expected.
        if p.lexer.token != T::TOpenBrace {
            p.lexer.expect(T::TOpenBrace)?;
            p.keep_specifiers(&kept);
            return Ok((items.into_bump_slice_mut(), false));
        }
        p.lexer.next()?;
        let saved_contexts = p.enter_list(ListKind::ImportOrExportSpecifiers);
        while p.lexer.token != T::TCloseBrace {
            match p.classify_list_token(ListKind::ImportOrExportSpecifiers)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let start = p.lexer.loc();
            let specifier = p.parse_specifier_tolerant(is_import)?;
            kept.push(crate::sema::ts_syntax::Specifier {
                loc: start,
                is_type_only: specifier.is_type_only,
                property_name: specifier.property_name.map(ModuleExportName::syntax),
                name: specifier.name.syntax(),
                end: p.lexer.full_start(),
            });
            let other = specifier.property_name.unwrap_or(specifier.name);
            // The name in this file, and the name in the other module or for other modules.
            let (local, alias) = if is_import {
                (specifier.name, other)
            } else {
                (other, specifier.name)
            };
            if specifier.is_type_only {
                had_type_only = true;
            } else if !local.text.is_empty() && !(is_import && local.is_string) {
                items.push(ClauseItem {
                    alias: alias.text.into(),
                    alias_loc: alias.range.loc,
                    name: LocRef {
                        loc: local.range.loc,
                        ref_: p.store_name_in_ref(local.text),
                    },
                    original_name: local.text.into(),
                });
            }
            if p.lexer.token == T::TComma {
                p.lexer.next()?;
            } else if !p.recover_missing_comma(ListKind::ImportOrExportSpecifiers, start)? {
                break;
            }
        }
        p.lexer.list_contexts = saved_contexts;
        p.lexer.expect(T::TCloseBrace)?;
        p.keep_specifiers(&kept);
        Ok((items.into_bump_slice_mut(), had_type_only))
    }

    /// `parseImportOrExportSpecifier`, and for an import the end of `parseImportSpecifier`.
    #[cold]
    #[inline(never)]
    fn parse_specifier_tolerant(&mut self, is_import: bool) -> Result<Specifier<'a>, Error> {
        let p = self;
        let mut is_type_only = false;
        let mut property_name = None;
        let mut can_parse_as_keyword = true;
        let mut name = p.parse_module_export_name_tolerant(is_import)?;
        if !name.is_string && name.text == b"type" {
            if p.lexer.is_contextual_keyword(b"as") {
                // { type as ...? }
                let first_as = p.parse_module_export_name_tolerant(false)?;
                if p.lexer.is_contextual_keyword(b"as") {
                    // { type as as ...? }
                    let second_as = p.parse_module_export_name_tolerant(false)?;
                    if p.can_parse_module_export_name() {
                        // { type as as something }
                        is_type_only = true;
                        property_name = Some(first_as);
                        name = p.parse_module_export_name_tolerant(is_import)?;
                    } else {
                        // { type as as }
                        property_name = Some(name);
                        name = second_as;
                    }
                    can_parse_as_keyword = false;
                } else if p.can_parse_module_export_name() {
                    // { type as something }
                    property_name = Some(name);
                    can_parse_as_keyword = false;
                    name = p.parse_module_export_name_tolerant(is_import)?;
                } else {
                    // { type as }
                    is_type_only = true;
                    name = first_as;
                }
            } else if p.can_parse_module_export_name() {
                // { type something ...? }
                is_type_only = true;
                name = p.parse_module_export_name_tolerant(is_import)?;
            }
        }
        if can_parse_as_keyword && p.lexer.is_contextual_keyword(b"as") {
            property_name = Some(name);
            p.lexer.next()?;
            name = p.parse_module_export_name_tolerant(is_import)?;
        }
        // The name an import declares is neither a reserved word nor a string.
        if !name.is_ok || (is_import && name.is_string) {
            p.lexer.ts_error(name.range, 1003);
        }
        Ok(Specifier {
            is_type_only,
            property_name,
            name,
        })
    }

    /// `canParseModuleExportName`
    fn can_parse_module_export_name(&self) -> bool {
        self.lexer.is_identifier_or_keyword()
            || matches!(self.lexer.token, T::TStringLiteral | T::TPrivateIdentifier)
    }

    /// `parseModuleExportName`: a string or any word is consumed. Anything else stays: 1003, and the name is missing.
    #[cold]
    #[inline(never)]
    fn parse_module_export_name_tolerant(
        &mut self,
        disallow_keywords: bool,
    ) -> Result<ModuleExportName<'a>, Error> {
        let p = self;
        let range = p.lexer.range();
        if !p.can_parse_module_export_name() {
            // `createMissingNode`: where the token before it ends.
            let range = bun_ast::Range {
                loc: p.lexer.full_start(),
                len: 0,
            };
            p.lexer.expect(T::TIdentifier)?;
            return Ok(ModuleExportName {
                text: b"",
                range,
                is_string: false,
                is_ok: true,
            });
        }
        let is_string = p.lexer.token == T::TStringLiteral;
        let name = ModuleExportName {
            text: if is_string {
                p.parse_clause_alias(b"import")?
            } else {
                p.lexer.identifier
            },
            range,
            is_string,
            is_ok: is_string
                || !disallow_keywords
                || p.lexer.token == T::TPrivateIdentifier
                || p.is_identifier_in_context(),
        };
        p.lexer.next()?;
        Ok(name)
    }

    pub(crate) fn parse_export_clause(&mut self) -> Result<ExportClauseResult<'a>, Error> {
        let p = self;
        if p.lexer.tolerant {
            let (clauses, had_type_only_exports) = p.parse_specifiers_tolerant(false)?;
            return Ok(ExportClauseResult {
                clauses,
                is_single_line: false,
                had_type_only_exports,
            });
        }
        let mut items = bun_alloc::ArenaVec::<ClauseItem>::with_capacity_in(1, p.arena);
        p.lexer.expect(T::TOpenBrace)?;
        let mut is_single_line = !p.lexer.has_newline_before;
        let mut first_non_identifier_loc = bun_ast::Loc { start: 0 };
        let mut had_type_only_exports = false;

        while p.lexer.token != T::TCloseBrace {
            let mut alias = p.parse_clause_alias(b"export")?;
            let mut alias_loc = p.lexer.loc();

            let name = LocRef {
                loc: alias_loc,
                ref_: p.store_name_in_ref(alias),
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

            if TYPESCRIPT {
                if alias == b"type" && p.lexer.token != T::TComma && p.lexer.token != T::TCloseBrace
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
                                    alias: alias.into(),
                                    alias_loc,
                                    name,
                                    original_name: original_name.into(),
                                });
                            }
                        } else if p.lexer.token != T::TComma && p.lexer.token != T::TCloseBrace {
                            // "export { type as xxx }"
                            // "export { type as 'xxx' }"
                            alias = p.parse_clause_alias(b"export")?;
                            alias_loc = p.lexer.loc();
                            p.lexer.next()?;

                            items.push(ClauseItem {
                                alias: alias.into(),
                                alias_loc,
                                name,
                                original_name: original_name.into(),
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
                        alias: alias.into(),
                        alias_loc,
                        name,
                        original_name: original_name.into(),
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
                    alias: alias.into(),
                    alias_loc,
                    name,
                    original_name: original_name.into(),
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
            )?;
            return Err(crate::Error::SyntaxError);
        }

        Ok(ExportClauseResult {
            clauses: items.into_bump_slice_mut(),
            is_single_line,
            had_type_only_exports,
        })
    }
}

/// What `parse_module_export_name_tolerant` read.
#[derive(Clone, Copy)]
struct ModuleExportName<'a> {
    /// Empty if the name is missing.
    text: &'a [u8],
    range: bun_ast::Range,
    is_string: bool,
    /// `nameOk`: false for a reserved word where an import declares a name.
    is_ok: bool,
}

impl ModuleExportName<'_> {
    fn syntax(self) -> crate::sema::ts_syntax::ModuleExportName {
        crate::sema::ts_syntax::ModuleExportName {
            text: bun_ast::StoreStr::new(self.text),
            loc: self.range.loc,
            end: self.range.end(),
            is_string: self.is_string,
        }
    }
}

/// What `parse_specifier_tolerant` read.
struct Specifier<'a> {
    is_type_only: bool,
    /// The name before `as`.
    property_name: Option<ModuleExportName<'a>>,
    name: ModuleExportName<'a>,
}
