#![warn(unused_must_use)]
use bun_collections::VecExt;

use crate::lexer::T;
use crate::p::P;
use crate::parse::lists::{ListKind, ListStep};
use crate::parser::{
    AsyncPrefixExpression, AwaitOrYield, DeferredErrors, FnOrArrowDataParse, ParenExprOpts,
    ParseClassOptions, PropertyOpts, SkipTypeParameterResult, TypeParameterFlag, prefill,
};
use bun_ast::e::UnaryFlags;
use bun_ast::expr::EFlags;
use bun_ast::g::{Arg, PropertyKind};
use bun_ast::op::Level;
use bun_ast::{self as js_ast, B, E, Expr, ExprData, ExprNodeList, G, OpCode, scope, symbol};

type PResult<T> = crate::CrateResult<T>;

// The 30+ per-token `t_*` helpers are private; only `parse_prefix` is surfaced. Helper
// names pfx_-prefixed to avoid colliding with parseStmt.rs / parseSuffix.rs mixins on the same `P`.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    fn pfx_t_super(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let super_range = p.lexer.range();
        p.lexer.next()?;

        match p.lexer.token {
            T::TOpenParen => {
                if level.lt(Level::Call) && p.fn_or_arrow_data_parse.allow_super_call {
                    return Ok(p.new_expr(E::Super {}, loc));
                }
            }
            T::TDot | T::TOpenBracket => {
                if p.fn_or_arrow_data_parse.allow_super_property {
                    return Ok(p.new_expr(E::Super {}, loc));
                }
            }
            _ => {
                // The operand of `new` is a primary expression, where `super` is only the keyword.
                if p.is_tolerant() && !p.lexer.is_log_disabled && level.lt(Level::Member) {
                    return Self::pfx_super_without_access(p, super_range);
                }
            }
        }

        p.log()
            .add_range_error(Some(p.source), super_range, b"Unexpected \"super\"");
        Ok(p.new_expr(E::Super {}, loc))
    }

    /// `parseSuperExpression`, after a `super` that is not followed by `(`, `.` or `[`.
    #[cold]
    #[inline(never)]
    fn pfx_super_without_access(p: &mut Self, super_range: bun_ast::Range) -> PResult<Expr> {
        let loc = super_range.loc;
        let mut target = p.new_expr(E::Super {}, loc);
        if Self::IS_TYPESCRIPT_ENABLED
            && p.lexer.token == T::TLessThan
            && !p.lexer.is_javascript_file()
        {
            let less_than = p.lexer.loc();
            if p.try_skip_type_script_type_arguments_with_backtracking()? {
                p.lexer
                    .ts_error(p.lexer.range_from(super_range.end()), 2754);
                // A template drops the type arguments.
                if !matches!(
                    p.lexer.token,
                    T::TNoSubstitutionTemplateLiteral | T::TTemplateHead
                ) {
                    p.note_type_arguments(&mut target, less_than);
                }
                if matches!(p.lexer.token, T::TOpenParen | T::TDot | T::TOpenBracket) {
                    return Ok(target);
                }
            }
        }
        let range = p.lexer.range();
        p.lexer.ts_error(range, 1034);

        // `parseRightSideOfDot`. A missing name is at the end of the previous token.
        let node_pos = p.lexer.full_start();
        let is_name = p.lexer.is_identifier_or_keyword() || p.lexer.token == T::TPrivateIdentifier;
        if is_name
            && p.lexer.has_newline_before
            && p.next_token_matches(|p| {
                !p.lexer.has_newline_before
                    && (p.lexer.is_identifier_or_keyword()
                        || p.lexer.token == T::TPrivateIdentifier)
            })
        {
            // An identifier or keyword on a new line, followed by another on the same line, starts
            // a different construct.
            p.lexer.ts_error(
                bun_ast::Range {
                    loc: node_pos,
                    len: 0,
                },
                1003,
            );
        } else if p.lexer.token == T::TPrivateIdentifier {
            let name = p.lexer.identifier;
            let name_loc = p.lexer.loc();
            p.lexer.next()?;
            let ref_ = p.store_name_in_ref(name);
            let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
            return Ok(p.new_expr(
                E::Index {
                    target,
                    index,
                    optional_chain: None,
                    is_import_property_use: false,
                },
                loc,
            ));
        } else if is_name {
            let name = E::Str::new(p.lexer.identifier);
            let name_loc = p.lexer.loc();
            p.lexer.next()?;
            return Ok(p.new_expr(
                E::Dot {
                    target,
                    name,
                    name_loc,
                    ..Default::default()
                },
                loc,
            ));
        } else {
            // `parseIdentifierName`
            p.lexer.expect(T::TIdentifier)?;
        }
        Ok(p.new_expr(
            E::Dot {
                target,
                name: E::Str::EMPTY,
                name_loc: node_pos,
                ..Default::default()
            },
            loc,
        ))
    }

    fn pfx_t_open_paren(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let full_start = p.pos_for_jsdoc();
        p.lexer.next()?;

        // Arrow functions aren't allowed in the middle of expressions
        if level.gt(Level::Assign) {
            // Allow "in" inside parentheses
            let old_allow_in = p.allow_in;
            p.allow_in = true;

            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lexer.expect(T::TCloseParen)?;
            p.mark_paren(&mut value, loc, full_start);

            p.allow_in = old_allow_in;
            return Ok(value);
        }

        p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
                full_start,
                ..Default::default()
            },
        )
    }

    #[inline]
    fn pfx_t_false(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.new_expr(E::Boolean { value: false }, loc))
    }

    #[inline]
    fn pfx_t_true(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.new_expr(E::Boolean { value: true }, loc))
    }

    #[inline]
    fn pfx_t_null(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.new_expr(E::Null {}, loc))
    }

    #[inline]
    fn pfx_t_this(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        if p.fn_or_arrow_data_parse.is_this_disallowed {
            p.log()
                .add_range_error(Some(p.source), p.lexer.range(), b"Cannot use \"this\" here");
        }
        p.lexer.next()?;
        Ok(Expr {
            data: prefill::data::THIS,
            loc,
        })
    }

    fn pfx_t_private_identifier(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        // `parsePrimaryExpression` accepts a private name anywhere. The checker reports 1451, 18016
        // or 2304.
        if (!p.allow_private_identifiers || !p.allow_in || level.gte(Level::Compare))
            && !p.is_tolerant()
        {
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
        }

        let name = p.lexer.identifier;
        p.lexer.next()?;

        // Check for "#foo in bar"
        if p.lexer.token != T::TIn && !p.is_tolerant() {
            p.lexer.expected(T::TIn)?;
        }

        let ref_ = p.store_name_in_ref(name);
        Ok(p.new_expr(E::PrivateIdentifier { ref_ }, loc))
    }

    fn pfx_t_identifier(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        // For the parameter of `x => x`. Only the type checker uses it.
        let full_start = if p.preserves_type_syntax() {
            p.lexer.full_start()
        } else {
            bun_ast::Loc::EMPTY
        };
        let name = p.lexer.identifier;

        // Fast path: only `async` / `await` / `yield` need `name_range` and the raw
        // (possibly escaped) token text. For every other identifier — the vast
        // majority of identifier-prefix expressions — skip the bounds-checked
        // `raw()` slice and the `range()` construction. Both must be read before
        // `lexer.next()` advances past the token, so compute them here when needed.
        let async_kind = AsyncPrefixExpression::find(name);
        let (name_range, raw) = if async_kind == AsyncPrefixExpression::None {
            (bun_ast::Range::NONE, name)
        } else {
            if p.is_tolerant() && Self::pfx_word_is_no_name_here(p, async_kind, level, flags) {
                return Self::pfx_missing(p);
            }
            (p.lexer.range(), p.lexer.raw())
        };
        let escaped_word = if p.is_tolerant() && async_kind != AsyncPrefixExpression::None {
            p.lexer.escaped_word()
        } else {
            None
        };

        p.lexer.next()?;

        // Handle async and await expressions
        match async_kind {
            AsyncPrefixExpression::IsAsync => {
                if (raw.as_ptr() == name.as_ptr() && raw.len() == name.len())
                    || AsyncPrefixExpression::find(raw) == AsyncPrefixExpression::IsAsync
                {
                    return p.parse_async_prefix_expr(name_range, full_start, level, flags);
                }
                if p.is_tolerant() && !p.lexer.is_log_disabled {
                    return Self::pfx_escaped_async(
                        p,
                        name_range,
                        escaped_word,
                        full_start,
                        level,
                        flags,
                    );
                }
            }

            AsyncPrefixExpression::IsAwait => match p.fn_or_arrow_data_parse.allow_await {
                // `parseParametersWorker`, `parseClassStaticBlockBody`: an await context.
                AwaitOrYield::ForbidAll if p.is_tolerant() && level.lte(Level::Prefix) => {
                    return Self::pfx_misplaced_await(p, name_range, escaped_word, level);
                }
                AwaitOrYield::ForbidAll => {
                    p.log().add_range_error(
                        Some(p.source),
                        name_range,
                        b"The keyword \"await\" cannot be used here",
                    );
                }
                AwaitOrYield::AllowExpr => {
                    let is_escaped =
                        AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsAwait;
                    if is_escaped && !(p.is_tolerant() && !p.lexer.is_log_disabled) {
                        p.log().add_range_error(
                            Some(p.source),
                            name_range,
                            b"The keyword \"await\" cannot be escaped",
                        );
                    } else {
                        p.lexer.keyword_was_taken(escaped_word);

                        if p.fn_or_arrow_data_parse.is_top_level {
                            p.top_level_await_keyword = name_range;
                            // `isAwaitExpression`: the first parse treats this `await` as an
                            // identifier, so `reparseTopLevelAwait` reparses the statement.
                            if p.is_tolerant() && !Self::pfx_operand_follows_on_same_line(p) {
                                p.lexer.await_name_seen = true;
                            }
                        }

                        if p.fn_or_arrow_data_parse.track_arrow_arg_errors {
                            p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_await =
                                name_range;
                        }

                        let value = p.parse_expr(Level::Prefix)?;
                        if p.lexer.token == T::TAsteriskAsterisk {
                            p.unary_before_exponentiation(level, loc, b"await")?;
                        }

                        return Ok(p.new_expr(E::Await { value }, loc));
                    }
                }
                AwaitOrYield::AllowIdent => {
                    // `isAwaitExpression`
                    if p.is_tolerant()
                        && level.lte(Level::Prefix)
                        && Self::pfx_operand_follows_on_same_line(p)
                    {
                        return Self::pfx_misplaced_await(p, name_range, escaped_word, level);
                    }
                    // Outside the await context of the top level of a module: a computed name, or the
                    // initializer of a field, which stays outside it.
                    p.await_read_as_identifier |=
                        p.is_tolerant() && p.fn_or_arrow_data_parse.is_top_level;
                    p.lexer.prev_token_was_await_keyword = !p.is_tolerant();
                    p.lexer.fn_or_arrow_start_loc = p.fn_or_arrow_data_parse.needs_async_loc;
                    // `isUpdateExpression`: `await` does not start one even where it is an
                    // identifier, so `parseUnaryExpressionOrHigher` reports it on the left of `**`.
                    if p.lexer.token == T::TAsteriskAsterisk
                        && p.is_tolerant()
                        && level.lt(Level::Prefix)
                    {
                        p.lexer.ts_error_about(name_range, 17006, b"await");
                    }
                }
            },

            AsyncPrefixExpression::IsYield => {
                match p.fn_or_arrow_data_parse.allow_yield {
                    // `parseParametersWorker`: a yield context.
                    AwaitOrYield::ForbidAll if p.is_tolerant() && level.lte(Level::Assign) => {
                        return Self::pfx_misplaced_yield(p, name_range, escaped_word, true);
                    }
                    AwaitOrYield::ForbidAll => {
                        p.log().add_range_error(
                            Some(p.source),
                            name_range,
                            b"The keyword \"yield\" cannot be used here",
                        );
                    }
                    AwaitOrYield::AllowExpr => {
                        let is_escaped =
                            AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsYield;
                        if is_escaped && !(p.is_tolerant() && !p.lexer.is_log_disabled) {
                            p.log().add_range_error(
                                Some(p.source),
                                name_range,
                                b"The keyword \"yield\" cannot be escaped",
                            );
                        } else {
                            p.lexer.keyword_was_taken(escaped_word);

                            if level.gt(Level::Assign) {
                                p.log().add_range_error(
                                    Some(p.source),
                                    name_range,
                                    b"Cannot use a \"yield\" here without parentheses",
                                );
                            }

                            if p.fn_or_arrow_data_parse.track_arrow_arg_errors {
                                p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_yield =
                                    name_range;
                            }

                            return p.parse_yield_expr(loc);
                        }
                    }
                    // .allow_ident => {

                    // },
                    _ => {
                        // `isYieldExpression`
                        if p.is_tolerant()
                            && level.lte(Level::Assign)
                            && Self::pfx_operand_follows_on_same_line(p)
                        {
                            return Self::pfx_misplaced_yield(p, name_range, escaped_word, false);
                        }
                        // Try to gracefully recover if "yield" is used in the wrong place
                        if !p.lexer.has_newline_before {
                            match p.lexer.token {
                                T::TNull
                                | T::TIdentifier
                                | T::TFalse
                                | T::TTrue
                                | T::TNumericLiteral
                                | T::TBigIntegerLiteral
                                | T::TStringLiteral => {
                                    p.log().add_range_error(
                                        Some(p.source),
                                        name_range,
                                        b"Cannot use \"yield\" outside a generator function",
                                    );
                                }
                                _ => {}
                            }
                        }
                    }
                }
            }
            AsyncPrefixExpression::None => {}
        }

        // Handle the start of an arrow expression
        if p.lexer.token == T::TEqualsGreaterThan && level.lte(Level::Assign) {
            let ref_ = p.store_name_in_ref(name);
            // reshaped for borrowck — build binding before borrowing arena.
            // `Arg` is non-Copy (owns Vec) → use fill_iter instead of alloc_slice_copy.
            let mut binding = p.b(B::Identifier { r#ref: ref_ }, loc);
            if p.has_comments_before(loc, full_start) {
                p.note_flag(&mut binding.loc, crate::sema::Mark::SimpleArrowParameter);
            }
            p.finish_node(&mut binding.loc, full_start);
            let args = p.arena.alloc_slice_fill_iter([Arg {
                binding,
                ..Default::default()
            }]);

            let _ = p
                .push_scope_for_parse_pass(scope::Kind::FunctionArgs, loc)
                .expect("unreachable");
            // pop_scope runs before `?` propagates
            let mut fn_or_arrow_data = FnOrArrowDataParse {
                needs_async_loc: loc,
                ..Default::default()
            };
            let arrow_result = p.parse_arrow_body_with_flags(args, &mut fn_or_arrow_data, flags);
            p.pop_scope();
            let mut arrow = p.new_expr(arrow_result?, loc);
            p.mark_comments_before(&mut arrow.loc, loc, full_start);
            return Ok(arrow);
        }

        let ref_ = p.store_name_in_ref(name);
        let mut identifier = Expr::init_identifier(ref_, loc);
        // With an escape, the source text is longer than the name.
        if Self::IS_TYPESCRIPT_ENABLED && !ref_.is_source_contents_slice() {
            p.finish_expr(&mut identifier);
        }
        Ok(identifier)
    }

    /// `nextTokenIsIdentifierOrKeywordOrLiteralOnSameLine`, with the lexer already at that token.
    #[cold]
    #[inline(never)]
    fn pfx_operand_follows_on_same_line(p: &Self) -> bool {
        !p.lexer.has_newline_before
            && (p.lexer.is_identifier_or_keyword()
                || matches!(
                    p.lexer.token,
                    T::TPrivateIdentifier
                        | T::TNumericLiteral
                        | T::TBigIntegerLiteral
                        | T::TStringLiteral
                ))
    }

    /// `parseAwaitExpression`, after an `await` that ordinary builds reject. The checker reports 1308, 1375, 2524 or 18037.
    #[cold]
    #[inline(never)]
    fn pfx_misplaced_await(
        p: &mut Self,
        await_range: bun_ast::Range,
        escaped_word: Option<crate::lexer::EscapedWord>,
        level: Level,
    ) -> PResult<Expr> {
        p.lexer.keyword_was_taken(escaped_word);
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, await_range.loc, b"await")?;
        }
        Ok(p.new_expr(E::Await { value }, await_range.loc))
    }

    /// `parseYieldExpression`, after a `yield` that ordinary builds reject. In the parameters of a generator the checker reports
    /// 2523. Outside a generator it is 1163 (`checkGrammarYieldExpression`).
    #[cold]
    #[inline(never)]
    fn pfx_misplaced_yield(
        p: &mut Self,
        yield_range: bun_ast::Range,
        escaped_word: Option<crate::lexer::EscapedWord>,
        in_generator: bool,
    ) -> PResult<Expr> {
        p.lexer.keyword_was_taken(escaped_word);
        if !in_generator && !p.lexer.is_log_disabled {
            p.log().add_range_error(
                Some(p.source),
                yield_range,
                b"Cannot use \"yield\" outside a generator function",
            );
        }
        p.parse_yield_expr(yield_range.loc)
    }

    fn pfx_t_template_head(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let head = p.lexer.to_e_string()?;

        let (parts, _tail_loc) = p.parse_template_parts(false)?;

        // Check if TemplateLiteral is unsupported. We don't care for this product.`
        // if ()

        Ok(p.new_expr(
            E::Template {
                tag: None,
                head: E::TemplateContents::Cooked(head),
                parts,
            },
            loc,
        ))
    }

    #[inline]
    fn pfx_t_numeric_literal(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let value = p.new_expr(E::Number::new(p.lexer.number), loc);
        // p.checkForLegacyOctalLiteral()
        p.lexer.next()?;
        Ok(value)
    }

    #[inline]
    fn pfx_t_big_integer_literal(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let value = E::Str::new(p.lexer.identifier);
        // markSyntaxFeature bigInt
        p.lexer.next()?;
        Ok(p.new_expr(E::BigInt { value }, loc))
    }

    fn pfx_t_slash(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.scan_reg_exp()?;
        // always set regex_flags_start to null to make sure we don't accidentally use the wrong value later
        // Reset after both success and
        // the `next()?` error path: capture, advance, then unconditionally reset before
        // propagating any error from `next()`.
        let value = E::Str::new(p.lexer.raw());
        let next_result = p.lexer.next();
        let flags_offset = p.lexer.regex_flags_start;
        p.lexer.regex_flags_start = None;
        next_result?;

        Ok(p.new_expr(
            E::RegExp {
                value,
                flags_offset,
            },
            loc,
        ))
    }

    fn pfx_t_void(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"void")?;
        }

        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnVoid,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    fn pfx_t_typeof(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"typeof")?;
        }

        let mut flags = UnaryFlags::default();
        if matches!(value.data, ExprData::EIdentifier(_)) {
            flags |= UnaryFlags::WAS_ORIGINALLY_TYPEOF_IDENTIFIER;
        }
        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnTypeof,
                value,
                flags,
            },
            loc,
        ))
    }

    fn pfx_t_delete(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"delete")?;
        }
        if let ExprData::EIndex(e_index) = &value.data {
            if let ExprData::EPrivateIdentifier(private) = &e_index.index.data {
                let name = p.load_name_from_ref(private.ref_);
                let range = bun_ast::Range {
                    loc: p.real_loc(value.loc),
                    len: i32::try_from(name.len()).expect("int cast"),
                };
                p.log().add_range_error_fmt(
                    Some(p.source),
                    range,
                    format_args!(
                        "Deleting the private name \"{}\" is forbidden",
                        bstr::BStr::new(name),
                    ),
                );
            }
        }

        let mut flags = UnaryFlags::default();
        if matches!(
            value.data,
            ExprData::EIdentifier(_) | ExprData::EDot(_) | ExprData::EIndex(_)
        ) {
            flags |= UnaryFlags::WAS_ORIGINALLY_DELETE_OF_IDENTIFIER_OR_PROPERTY_ACCESS;
        }
        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnDelete,
                value,
                flags,
            },
            loc,
        ))
    }

    fn pfx_t_plus(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"+")?;
        }

        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnPos,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    fn pfx_t_minus(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"-")?;
        }

        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnNeg,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    fn pfx_t_tilde(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"~")?;
        }

        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnCpl,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    fn pfx_t_exclamation(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, loc, b"!")?;
        }

        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnNot,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    fn pfx_t_minus_minus(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = if p.is_tolerant() {
            Self::pfx_update_operand(p)?
        } else {
            p.parse_expr(Level::Prefix)?
        };
        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnPreDec,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    fn pfx_t_plus_plus(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = if p.is_tolerant() {
            Self::pfx_update_operand(p)?
        } else {
            p.parse_expr(Level::Prefix)?
        };
        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnPreInc,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    /// `parseUpdateExpression`: the operand of a prefix `++` or `--` is a LeftHandSideExpression, and the result is not one.
    #[cold]
    #[inline(never)]
    fn pfx_update_operand(p: &mut Self) -> PResult<Expr> {
        let value = if !p.lexer.is_log_disabled && Self::pfx_starts_no_primary_expression(p) {
            Self::pfx_missing(p)?
        } else {
            // Member accesses, calls and `!` are consumed. A postfix `++` and binary operators are
            // not.
            p.parse_expr(Level::Postfix)?
        };
        if Self::cannot_follow_update(p) {
            p.forbid_suffix_after_as_loc = p.lexer.loc();
        }
        Ok(value)
    }

    /// Whether the current token starts a unary expression that `parsePrimaryExpression` does not
    /// accept.
    fn pfx_starts_no_primary_expression(p: &Self) -> bool {
        matches!(
            p.lexer.token,
            T::TPlusPlus
                | T::TMinusMinus
                | T::TPlus
                | T::TMinus
                | T::TTilde
                | T::TExclamation
                | T::TDelete
                | T::TTypeof
                | T::TVoid
                | T::TLessThan
        )
    }

    #[inline]
    fn pfx_t_function(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let full_start = p.pos_for_jsdoc();
        let mut function = p.parse_fn_expr(loc, false)?;
        p.mark_comments_before(&mut function.loc, loc, full_start);
        Ok(function)
    }

    fn pfx_t_class(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let full_start = p.pos_for_jsdoc();
        let mut class_keyword = p.lexer.range();
        // markSyntaxFEatuer class
        p.lexer.next()?;
        let mut name: Option<js_ast::LocRef> = None;

        let _ = p
            .push_scope_for_parse_pass(scope::Kind::ClassName, loc)
            .expect("unreachable");

        // Parse an optional class name
        if p.lexer.token == T::TIdentifier {
            let name_text = p.lexer.identifier;
            if !Self::IS_TYPESCRIPT_ENABLED
                || name_text != b"implements"
                || Self::pfx_implements_is_the_name(p)
            {
                if p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                    && name_text == b"await"
                {
                    p.log().add_range_error(
                        Some(p.source),
                        p.lexer.range(),
                        b"Cannot use \"await\" as an identifier here",
                    );
                }

                name = Some(js_ast::LocRef {
                    loc: p.lexer.loc(),
                    ref_: p.new_symbol(symbol::Kind::Other, name_text),
                });
                p.lexer.next()?;
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            p.skip_class_type_parameters(&mut class_keyword.loc)?;
        }

        let class = p.parse_class(
            class_keyword,
            name,
            &ParseClassOptions {
                allow_ts_decorators: Self::IS_TYPESCRIPT_ENABLED
                    || p.options.features.standard_decorators,
                ..Default::default()
            },
        )?;
        p.pop_scope();

        let mut class = p.new_expr(class, loc);
        p.mark_comments_before(&mut class.loc, loc, full_start);
        Ok(class)
    }

    fn pfx_t_at(p: &mut Self) -> PResult<Expr> {
        // Parse decorators before a class expression: @dec class { ... }
        let at_loc = p.lexer.loc();
        // `parseDecoratedExpression`: `parseModifiersEx`, which takes keywords too.
        // `checkGrammarModifiers` reports them.
        let mut modifiers = Vec::new();
        let ts_decorators = if p.is_tolerant() {
            let allow_await = p.fn_or_arrow_data_parse.allow_await;
            p.parse_modifiers_of_parameter(allow_await, &mut modifiers)?;
            let mut decorators = bun_alloc::AstAlloc::vec();
            decorators.extend(modifiers.iter().filter_map(|modifier| modifier.decorator));
            modifiers.retain(|modifier| modifier.decorator.is_none());
            decorators
        } else {
            p.parse_type_script_decorators()?
        };

        // Expect class keyword after decorators
        if p.lexer.token != T::TClass {
            if p.is_tolerant() && !p.lexer.is_log_disabled {
                // `parseDecoratedExpression`: 1109 at the end of the last modifier, and a missing
                // declaration.
                let node_pos = p.lexer.full_start();
                p.note_stray_decorators(ts_decorators.slice(), node_pos);
                p.lexer.ts_error(
                    bun_ast::Range {
                        loc: node_pos,
                        len: 0,
                    },
                    1109,
                );
                return Ok(p.new_expr(E::Missing {}, at_loc));
            }
            p.lexer.expected(T::TClass)?;
            return Err(crate::Error::SyntaxError);
        }

        let loc = p.lexer.loc();
        let full_start = p.pos_for_jsdoc();
        let mut class_keyword = p.lexer.range();
        p.note_parameter_modifiers(&mut class_keyword.loc, &modifiers);
        p.lexer.next()?;
        let mut name: Option<js_ast::LocRef> = None;

        let _ = p
            .push_scope_for_parse_pass(scope::Kind::ClassName, loc)
            .expect("unreachable");

        // Parse an optional class name
        if p.lexer.token == T::TIdentifier {
            let name_text = p.lexer.identifier;
            if !Self::IS_TYPESCRIPT_ENABLED
                || name_text != b"implements"
                || Self::pfx_implements_is_the_name(p)
            {
                if p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                    && name_text == b"await"
                {
                    p.log().add_range_error(
                        Some(p.source),
                        p.lexer.range(),
                        b"Cannot use \"await\" as an identifier here",
                    );
                }

                name = Some(js_ast::LocRef {
                    loc: p.lexer.loc(),
                    ref_: p.new_symbol(symbol::Kind::Other, name_text),
                });
                p.lexer.next()?;
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            p.skip_class_type_parameters(&mut class_keyword.loc)?;
        }

        // spec passes the arena-backed `[]ExprNodeIndex` slice directly into
        // `ParseClassOptions{.ts_decorators = ts_decorators}`. `ParseClassOptions::ts_decorators`
        // is currently typed `&'a [Expr]` (parser.rs), so until that field is widened to
        // `ExprNodeList` we copy into the arena (Expr is `Copy`) and let `ts_decorators` drop
        // normally — no `mem::forget` / `from_raw_parts` lifetime laundering (forbidden per
        // PORTING.md §Forbidden patterns; would leak heap when origin is `Owned`).
        let ts_decorators_slice: &'a [Expr] = p.arena.alloc_slice_copy(ts_decorators.slice());

        let class = p.parse_class(
            class_keyword,
            name,
            &ParseClassOptions {
                ts_decorators: ts_decorators_slice,
                allow_ts_decorators: true,
                ..Default::default()
            },
        )?;
        p.pop_scope();

        let mut class = p.new_expr(class, loc);
        p.note_loc(&mut class.loc, crate::sema::Mark::DeclarationStart, at_loc);
        p.mark_comments_before(&mut class.loc, loc, full_start);
        Ok(class)
    }

    fn pfx_t_new(p: &mut Self, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;

        // Special-case the weird "new.target" expression here
        if p.lexer.token == T::TDot {
            p.lexer.next()?;
            // The name used instead of "target".
            let mut other_name = None;

            if p.lexer.token != T::TIdentifier || p.lexer.raw() != b"target" {
                if !p.is_tolerant() || p.lexer.is_log_disabled {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }
                if !p.lexer.is_identifier_or_keyword() && p.lexer.token != T::TPrivateIdentifier {
                    // `parseIdentifierName`: 1003, the token is not consumed, and the name is
                    // missing.
                    p.lexer.expect(T::TIdentifier)?;
                    let range = bun_ast::Range { loc, len: 3 };
                    let name = p.new_expr(E::EString::init(b""), loc);
                    let mut value = p.new_expr(E::NewTarget { range }, loc);
                    p.note_expr(&mut value.loc, crate::sema::Mark::MetaPropertyName, name);
                    return Ok(value);
                }
                // `checkGrammarMetaProperty`: any identifier or keyword forms a meta property, and
                // all but `target` are reported.
                if p.lexer.identifier != b"target" {
                    let name = p.lexer.range();
                    let named = [p.lexer.raw(), b"new", b"target"].join(&0);
                    p.lexer.ts_grammar_error_about(name, 17012, &named);
                    other_name = Some(p.new_expr(E::EString::init(p.lexer.identifier), name.loc));
                }
            }
            let range = bun_ast::Range {
                loc,
                len: p.lexer.range().end().start - loc.start,
            };

            p.lexer.next()?;
            let mut value = p.new_expr(E::NewTarget { range }, loc);
            if let Some(name) = other_name {
                p.note_expr(&mut value.loc, crate::sema::Mark::MetaPropertyName, name);
            }
            return Ok(value);
        }

        // This will become the new expr
        // Parse target into a local, then construct E::New once.
        let mut target = Expr::EMPTY;
        if p.is_tolerant()
            && !p.lexer.is_log_disabled
            && matches!(
                p.lexer.token,
                T::TLessThan
                    | T::TPlus
                    | T::TMinus
                    | T::TTilde
                    | T::TExclamation
                    | T::TPlusPlus
                    | T::TMinusMinus
                    | T::TTypeof
                    | T::TVoid
                    | T::TDelete
                    | T::TImport
            )
        {
            // `parsePrimaryExpression`: none of these starts one.
            target = Self::pfx_missing(p)?;
        } else {
            p.parse_expr_with_flags(Level::Member, flags, &mut target)?;
        }

        let mut type_arguments = None;
        if Self::IS_TYPESCRIPT_ENABLED {
            // The target's own suffixes may have consumed them.
            type_arguments = p.take_type_arguments();
            // Skip over TypeScript type arguments here if there are any
            if p.lexer.token == T::TLessThan
                && !p.lexer.is_javascript_file()
                && p.try_skip_type_script_type_arguments_with_backtracking()?
            {
                let more = p.saved_type_arguments();
                type_arguments = type_arguments.or(more);
            }
        }

        let (args, close_parens_loc) = if p.lexer.token == T::TOpenParen {
            let call_args = p.parse_call_args()?;
            (call_args.list, call_args.loc)
        } else {
            (bun_alloc::AstAlloc::vec(), bun_ast::Loc::EMPTY)
        };

        let mut value = p.new_expr(
            E::New {
                target,
                args,
                close_parens_loc,
                ..Default::default()
            },
            loc,
        );
        if let Some(type_arguments) = type_arguments {
            p.note(
                &mut value.loc,
                crate::sema::Mark::TypeArguments,
                type_arguments,
            );
        }
        Ok(value)
    }

    fn pfx_t_open_bracket(p: &mut Self, errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let mut is_single_line = !p.lexer.has_newline_before;
        let mut items: smallvec::SmallVec<[Expr; 8]> = smallvec::SmallVec::new();
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread = bun_ast::Loc::default();

        // Allow "in" inside arrays. (`parseArrayLiteralExpression` leaves the context as it is: see
        // `parse_expr_allow_in`.)
        let old_allow_in = p.allow_in;
        p.allow_in = old_allow_in || !p.is_tolerant();
        let saved_contexts = p.enter_list(ListKind::ArrayLiteralMembers);

        while p.lexer.token != T::TCloseBracket {
            match p.classify_list_token(ListKind::ArrayLiteralMembers)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let element_start = p.lexer.loc();
            match p.lexer.token {
                T::TComma => {
                    let mut hole = Expr {
                        data: ExprData::EMissing(E::Missing {}),
                        loc: p.lexer.loc(),
                    };
                    p.finish_expr(&mut hole);
                    p.note_token_full_start(&mut hole.loc, crate::sema::Mark::OmittedExpression);
                    items.push(hole);
                }
                T::TDotDotDot => {
                    let dots_loc = p.lexer.loc();
                    p.lexer.next()?;
                    // Parse into a local then push.
                    let mut value = Expr::EMPTY;
                    p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut value)?;
                    items.push(p.new_expr(E::Spread { value }, dots_loc));

                    // Commas are not allowed here when destructuring
                    if p.lexer.token == T::TComma {
                        comma_after_spread = p.lexer.loc();
                    }
                }
                _ => {
                    let mut item = Expr::EMPTY;
                    p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut item)?;
                    items.push(item);
                }
            }

            if p.lexer.token != T::TComma {
                if p.recover_missing_comma(ListKind::ArrayLiteralMembers, element_start)? {
                    continue;
                }
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

        p.lexer.list_contexts = saved_contexts;
        let close_bracket_loc = p.lexer.loc();
        p.note_literal_if_unclosed(T::TCloseBracket, loc);
        p.lexer.expect_closing(T::TCloseBracket, loc)?;
        p.allow_in = old_allow_in;

        // Is this a binding pattern?
        if p.will_need_binding_pattern() {
            // noop
        } else if errors.is_none() {
            // Is this an expression?
            p.log_expr_errors(&mut self_errors);
        } else {
            // In this case, we can't distinguish between the two yet
            self_errors.merge_into(errors.unwrap());
        }
        let items_list = ExprNodeList::from_arena_slice(&items);
        Ok(p.new_expr(
            E::Array {
                items: items_list,
                comma_after_spread,
                is_single_line,
                close_bracket_loc,
                ..Default::default()
            },
            loc,
        ))
    }

    /// `parseJSONText`, except for `validateJsonValue`: the expression of its single statement.
    /// `{}` for a text that contains no value.
    #[cold]
    pub(crate) fn parse_json_text(&mut self) -> PResult<Expr> {
        let p = self;
        let loc = p.lexer.loc();
        let mut expressions: bun_alloc::ArenaVec<'_, Expr> = bun_alloc::ArenaVec::new_in(p.arena);
        while p.lexer.token != T::TEndOfFile {
            let is_no_name = |p: &mut Self| p.step() && p.lexer.token != T::TColon;
            let is_value = match p.lexer.token {
                T::TOpenBracket | T::TTrue | T::TFalse | T::TNull => true,
                T::TMinus => p.look_ahead(|p| {
                    p.step() && p.lexer.token == T::TNumericLiteral && is_no_name(p)
                }),
                T::TNumericLiteral | T::TStringLiteral => p.look_ahead(is_no_name),
                _ => false,
            };
            expressions.push(if is_value {
                p.parse_prefix(Level::Lowest, None, EFlags::None)?
            } else {
                Self::pfx_t_open_brace(p, None)?
            });
            if expressions.len() == 1 && p.lexer.token != T::TEndOfFile {
                let range = p.lexer.range();
                p.lexer.ts_error(range, 1012);
            }
        }
        Ok(match expressions.len() {
            0 => p.new_expr(E::Object::default(), loc),
            1 => expressions[0],
            _ => {
                let items = ExprNodeList::from_bump_vec(expressions);
                p.new_expr(
                    E::Array {
                        items,
                        ..Default::default()
                    },
                    loc,
                )
            }
        })
    }

    fn pfx_t_open_brace(p: &mut Self, errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.expect(T::TOpenBrace)?;
        let mut is_single_line = !p.lexer.has_newline_before;
        let mut properties: bun_alloc::ArenaVec<'_, G::Property> =
            bun_alloc::ArenaVec::new_in(p.arena);
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread: bun_ast::Loc = bun_ast::Loc::default();

        // Allow "in" inside object literals. (`parseObjectLiteralElement` does so for the value of a
        // property only: see `parse_expr_allow_in`.)
        let old_allow_in = p.allow_in;
        p.allow_in = old_allow_in || !p.is_tolerant();
        let saved_contexts = p.enter_list(ListKind::ObjectLiteralMembers);

        while p.lexer.token != T::TCloseBrace {
            match p.classify_list_token(ListKind::ObjectLiteralMembers)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let element_start = p.lexer.loc();
            let element_full_start = p.pos_for_jsdoc();
            if p.lexer.token == T::TDotDotDot {
                p.lexer.next()?;
                let mut value = Expr::EMPTY;
                p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut value)?;
                p.note_loc(&mut value.loc, crate::sema::Mark::DotDotDot, element_start);
                p.note_token_full_start(&mut value.loc, crate::sema::Mark::MemberEnd);
                properties.push(G::Property {
                    kind: PropertyKind::Spread,
                    value: Some(value),
                    ..Default::default()
                });

                // Commas are not allowed here when destructuring
                if p.lexer.token == T::TComma {
                    comma_after_spread = p.lexer.loc();
                }
            } else {
                // This property may turn out to be a type in TypeScript, which should be ignored
                let mut property_opts = PropertyOpts::default();
                let modifiers_base = p.pushed_modifiers();
                if let Some(mut prop) = p.parse_property(
                    PropertyKind::Normal,
                    &mut property_opts,
                    Some(&mut self_errors),
                )? {
                    debug_assert!(prop.key.is_some() || prop.value.is_some());
                    if let Some(key) = &mut prop.key {
                        p.end_parameter_modifiers(modifiers_base, &mut key.loc);
                        if p.real_loc(key.loc) != element_start {
                            p.note_loc(&mut key.loc, crate::sema::Mark::MemberStart, element_start);
                        }
                        p.note_token_full_start(&mut key.loc, crate::sema::Mark::MemberEnd);
                        if p.has_comments_before(element_start, element_full_start) {
                            p.note_loc(
                                &mut key.loc,
                                crate::sema::Mark::MemberFullStart,
                                element_full_start,
                            );
                        }
                    }
                    properties.push(prop);
                }
                p.drop_modifiers(modifiers_base);
            }

            if p.lexer.token != T::TComma {
                if p.recover_missing_comma(ListKind::ObjectLiteralMembers, element_start)? {
                    continue;
                }
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

        p.lexer.list_contexts = saved_contexts;
        let close_brace_loc = p.lexer.loc();
        p.note_literal_if_unclosed(T::TCloseBrace, loc);
        p.lexer.expect_closing(T::TCloseBrace, loc)?;
        p.allow_in = old_allow_in;

        if p.will_need_binding_pattern() {
            // Is this a binding pattern?
        } else if errors.is_none() {
            // Is this an expression?
            p.log_expr_errors(&mut self_errors);
        } else {
            // In this case, we can't distinguish between the two yet
            self_errors.merge_into(errors.unwrap());
        }

        // BumpVec → Vec via arena slice; see pfx_t_open_bracket.
        let properties_list = G::PropertyList::from_bump_vec(properties);
        Ok(p.new_expr(
            E::Object {
                properties: properties_list,
                comma_after_spread,
                is_single_line,
                close_brace_loc,
                ..Default::default()
            },
            loc,
        ))
    }

    fn pfx_t_less_than(
        p: &mut Self,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let full_start = p.pos_for_jsdoc();
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
        if Self::IS_TYPESCRIPT_ENABLED && p.is_jsx_enabled() {
            if p.is_ts_arrow_fn_jsx()? {
                let opts = ParenExprOpts {
                    force_arrow_fn: true,
                    full_start,
                    ..Default::default()
                };
                return Self::pfx_generic_arrow_fn(p, loc, level, opts);
            }
        }

        if p.is_jsx_enabled() {
            if p.is_tolerant() {
                return Self::pfx_jsx_or_missing(p, level);
            }
            // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
            let full_start = p.lexer.full_start();
            p.lexer.next_inside_jsx_element()?;
            let element = p.parse_jsx_element(loc, full_start)?;

            // The call to parseJSXElement() above doesn't consume the last
            // TGreaterThan because the caller knows what Next() function to call.
            // Use Next() instead of NextInsideJSXElement() here since the next
            // token is an expression.
            p.lexer.next()?;
            return Ok(element);
        }

        if Self::IS_TYPESCRIPT_ENABLED {
            // This is either an old-style type cast or a generic lambda function

            let is_tolerant = p.is_tolerant() && !p.lexer.is_log_disabled;

            // "<T>(x)"
            // "<T>(x) => {}"
            let skipped = if is_tolerant && level.gt(Level::Assign) {
                // `parseSimpleUnaryExpression`: an arrow function starts an assignment expression. In an operand "<" can
                // only open a type assertion, which has one type between the brackets (`parseTypeAssertion`).
                SkipTypeParameterResult::DidNotSkipAnything
            } else if is_tolerant && !Self::pfx_is_name_in_angle_brackets(p) {
                let opts = ParenExprOpts {
                    is_after_question_and_before_colon: flags
                        == EFlags::AfterQuestionAndBeforeColon,
                    full_start,
                    ..Default::default()
                };
                if let Some(arrow) = p.try_parse_generic_arrow_fn(loc, level, opts)? {
                    return Ok(arrow);
                }
                SkipTypeParameterResult::DidNotSkipAnything
            } else {
                p.try_skip_type_script_type_parameters_then_open_paren_with_backtracking()?
            };
            match skipped {
                SkipTypeParameterResult::DidNotSkipAnything => {}
                result => {
                    let type_parameters = p.saved_type_parameters(result);
                    let open_paren = p.lexer.loc();
                    p.lexer.expect(T::TOpenParen)?;
                    let mut value = p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            is_after_question_and_before_colon: p.is_tolerant()
                                && flags == EFlags::AfterQuestionAndBeforeColon,
                            open_paren,
                            full_start,
                            ..Default::default()
                        },
                    )?;
                    let is_arrow =
                        matches!(value.data, ExprData::EArrow(_)) && p.real_loc(value.loc) == loc;
                    if is_arrow {
                        p.note_type_parameters(&mut value.loc, type_parameters);
                    }
                    // "<T>(x).y" turned out to be a cast, of "(x).y".
                    if p.preserves_type_syntax() && !is_arrow {
                        p.parse_suffix(&mut value, Level::Prefix, None, flags)?;
                        p.note_cast_to_type_parameter(&mut value, type_parameters, loc);
                        if p.lexer.token == T::TAsteriskAsterisk
                            && p.is_tolerant()
                            && !p.lexer.is_log_disabled
                        {
                            p.unary_before_exponentiation(level, loc, b"")?;
                        }
                    }
                    return Ok(value);
                }
            }

            // "<T>x"
            p.lexer.next()?;
            if p.preserves_type_syntax() {
                p.skip_type_script_type(Level::Lowest)?;
                let ty = p.saved_type_or_error();
                let is_parenthesized = p.is_saved_type_parenthesized();
                p.lexer.expect_greater_than::<false>()?;
                // The cast covers "x.y" in "<T>x.y", which the caller's suffix
                // loop would otherwise apply to the annotated "x".
                let mut value = Expr::EMPTY;
                p.parse_expr_with_flags(Level::Prefix, flags, &mut value)?;
                p.note_token_full_start(&mut value.loc, crate::sema::Mark::End);
                p.note_loc(&mut value.loc, crate::sema::Mark::LessThan, loc);
                if is_parenthesized {
                    p.note_flag(&mut value.loc, crate::sema::Mark::ParenthesizedType);
                }
                p.note_saved_type(&mut value.loc, crate::sema::Mark::As, ty);
                if p.lexer.token == T::TAsteriskAsterisk
                    && p.is_tolerant()
                    && !p.lexer.is_log_disabled
                {
                    p.unary_before_exponentiation(level, loc, b"")?;
                }
                return Ok(value);
            }
            p.skip_type_script_type(Level::Lowest)?;
            p.lexer.expect_greater_than::<false>()?;
            return p.parse_prefix(level, errors, flags);
        }

        p.lexer.unexpected()?;
        Err(crate::Error::SyntaxError)
    }

    /// `parseParenthesizedArrowFunctionExpression` with `allowAmbiguity`, at the `<` of its type
    /// parameters. `loc`: of its first token.
    pub(super) fn pfx_generic_arrow_fn(
        p: &mut Self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> PResult<Expr> {
        let type_parameters = p.parse_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        let mut value =
            if p.lexer.token != T::TOpenParen && p.is_tolerant() && !p.lexer.is_log_disabled {
                Self::pfx_arrow_without_parameters(p, loc, opts.full_start, opts.is_async)?
            } else {
                p.lexer.expect(T::TOpenParen)?;
                p.parse_paren_expr(loc, level, opts)?
            };
        if matches!(value.data, ExprData::EArrow(_)) {
            p.note_type_parameters(&mut value.loc, type_parameters);
        }
        Ok(value)
    }

    /// Whether the `<` the lexer is at opens `<T>`, which is the same tokens as the type parameters
    /// of an arrow function and as the type of a type assertion: it need not be parsed twice.
    #[cold]
    #[inline(never)]
    pub(super) fn pfx_is_name_in_angle_brackets(p: &mut Self) -> bool {
        p.look_ahead(|p| {
            p.step() && p.is_identifier_in_context() && p.step() && p.lexer.token == T::TGreaterThan
        })
    }

    /// `parseUpdateExpression` and `parseSimpleUnaryExpression` at a `<` in a file with JSX.
    #[cold]
    #[inline(never)]
    fn pfx_jsx_or_missing(p: &mut Self, level: Level) -> PResult<Expr> {
        // The operand of a unary operator is parsed at Level::Prefix: no lookahead, and `mustBeUnary`.
        let must_be_unary = level.eql(Level::Prefix);
        let starts_jsx = level.lte(Level::Prefix)
            && (must_be_unary
                // `nextTokenIsIdentifierOrKeywordOrGreaterThan`
                || p.next_token_matches(|p| {
                    p.lexer.is_identifier_or_keyword()
                        || p.lexer.token == T::TPrivateIdentifier
                        || p.lexer.raw().first() == Some(&b'>')
                }));
        if !starts_jsx {
            if p.lexer.is_log_disabled {
                return Err(crate::Error::Backtrack);
            }
            // `parsePrimaryExpression`: the operand is missing, and the `<` is left for the operator.
            return Self::pfx_missing(p);
        }
        let first = p.lexer.loc();
        let element = Self::pfx_jsx_elements(p, first, must_be_unary)?;
        // The element is returned as it is, not as the start of a member or call expression.
        if matches!(
            p.lexer.token,
            T::TDot
                | T::TQuestionDot
                | T::TOpenBracket
                | T::TOpenParen
                | T::TTemplateHead
                | T::TNoSubstitutionTemplateLiteral
                | T::TExclamation
                | T::TPlusPlus
                | T::TMinusMinus
        ) {
            p.forbid_suffix_after_as_loc = p.lexer.loc();
        }
        Ok(element)
    }

    /// `parseJsxElementOrSelfClosingElementOrFragment` in an expression, at its `<`. Another
    /// element right after it is reported (2657) at `first`, the start of the first of them, and
    /// joined to this one by a comma.
    fn pfx_jsx_elements(p: &mut Self, first: bun_ast::Loc, must_be_unary: bool) -> PResult<Expr> {
        let less_than = p.lexer.loc();
        let full_start = p.lexer.full_start();
        // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
        p.lexer.next_inside_jsx_element()?;
        let element = p.parse_jsx_element(less_than, full_start)?;
        // The last ">" is left to the caller. Nothing is consumed for a ">" that is missing: a
        // conflict marker that ended the children stays the current token.
        if p.lexer.token == T::TGreaterThan {
            p.lexer.next()?;
        }
        if must_be_unary || p.lexer.token != T::TLessThan {
            return Ok(element);
        }
        if p.lexer.is_log_disabled {
            return Err(crate::Error::Backtrack);
        }
        let rest = Self::pfx_jsx_elements(p, first, false)?;
        p.lexer.ts_error(p.lexer.range_from(first), 2657);
        Ok(p.join_with_comma(element, rest))
    }

    #[inline]
    fn pfx_t_import(p: &mut Self, level: Level) -> PResult<Expr> {
        if p.is_tolerant() && !p.lexer.is_log_disabled && !Self::pfx_import_starts_expression(p) {
            return Self::pfx_missing(p);
        }
        let loc = p.lexer.loc();
        p.lexer.next()?;
        p.parse_import_expr(loc, level)
    }

    /// `parseLeftHandSideExpressionOrHigher`: `import` starts an expression only before `(`, `<`
    /// and `.`. Before any other token it is left for the statement it starts.
    #[cold]
    #[inline(never)]
    fn pfx_import_starts_expression(p: &mut Self) -> bool {
        p.next_token_matches(|p| matches!(p.lexer.token, T::TOpenParen | T::TLessThan | T::TDot))
    }

    /// `createMissingNode`: 1109 at the current token, which is not consumed, and the expected node
    /// is missing.
    #[cold]
    #[inline(never)]
    fn pfx_missing(p: &mut Self) -> PResult<Expr> {
        let (range, before) = (p.lexer.range(), p.lexer.prev_error_loc);
        p.lexer.ts_error(range, 1109);
        p.lexer.put_up_with(before)?;
        Ok(p.new_expr(E::Missing {}, range.loc))
    }

    /// `isIdentifier`: `yield` in a generator and `await` where it is a keyword are not
    /// identifiers. `word` is the current token. Only an assignment expression starts with such a
    /// `yield` (`parseAssignmentExpressionOrHigherWorker`) and only a unary expression with such an
    /// `await` (`parseSimpleUnaryExpression`): for `parsePrimaryExpression` no expression starts
    /// there.
    #[cold]
    #[inline(never)]
    fn pfx_word_is_no_name_here(
        p: &Self,
        word: AsyncPrefixExpression,
        level: Level,
        flags: EFlags,
    ) -> bool {
        if p.lexer.is_log_disabled {
            return false;
        }
        match word {
            AsyncPrefixExpression::IsYield => {
                level.gt(Level::Assign)
                    && p.fn_or_arrow_data_parse.allow_yield != AwaitOrYield::AllowIdent
            }
            // `parseDecoratorExpression` handles `@await` separately.
            AsyncPrefixExpression::IsAwait => {
                level.gt(Level::Prefix)
                    && flags != EFlags::TsDecorator
                    && p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
            }
            _ => false,
        }
    }

    /// `async` containing an escape, which has been consumed. `nextToken`: it is reported where it
    /// is the modifier of a function. Where it is an identifier (`createIdentifierWithDiagnostic`)
    /// it is not.
    #[cold]
    #[inline(never)]
    fn pfx_escaped_async(
        p: &mut Self,
        async_range: bun_ast::Range,
        escaped_word: Option<crate::lexer::EscapedWord>,
        async_full_start: bun_ast::Loc,
        level: Level,
        flags: EFlags,
    ) -> PResult<Expr> {
        let expr = p.parse_async_prefix_expr(async_range, async_full_start, level, flags)?;
        let is_modifier = match &expr.data {
            ExprData::EFunction(_) => true,
            ExprData::EArrow(arrow) => arrow.is_async,
            _ => false,
        };
        if is_modifier {
            p.lexer.keyword_was_taken(escaped_word);
        }
        Ok(expr)
    }

    /// `nextToken`: 1260 is reported for a keyword containing an escape when it is consumed, so
    /// only for one that starts the expression expected at `level`. Any other is not consumed, and
    /// is not an expression.
    #[cold]
    #[inline(never)]
    fn pfx_escaped_keyword_starts_expression(p: &mut Self, level: Level) -> bool {
        if !p.is_tolerant() || p.lexer.is_log_disabled {
            return false;
        }
        match crate::lexer::keyword(p.lexer.identifier) {
            // `parsePrimaryExpression`
            Some(
                T::TThis
                | T::TSuper
                | T::TNull
                | T::TTrue
                | T::TFalse
                | T::TClass
                | T::TFunction
                | T::TNew,
            ) => true,
            // `parseSimpleUnaryExpression`
            Some(T::TTypeof | T::TVoid | T::TDelete) => level.lte(Level::Prefix),
            // `parseLeftHandSideExpressionOrHigher`: the operand of `new` is not one.
            Some(T::TImport) => level.lt(Level::Member) && Self::pfx_import_starts_expression(p),
            _ => false,
        }
    }

    /// `isImplementsClause`: `implements` after `class` is the name of the class unless a name or a keyword follows it.
    #[cold]
    #[inline(never)]
    fn pfx_implements_is_the_name(p: &mut Self) -> bool {
        p.is_tolerant() && !p.next_token_matches(|p| p.lexer.is_identifier_or_keyword())
    }

    /// `parseParenthesizedArrowFunctionExpression` with `allowAmbiguity`, at a token other than its
    /// `(`: 1005, and there are no parameters. `isParenthesizedArrowFunctionExpression`: so for a
    /// lone `=>` where an assignment expression starts. `loc`, `full_start`: of its first token.
    #[cold]
    #[inline(never)]
    fn pfx_arrow_without_parameters(
        p: &mut Self,
        loc: bun_ast::Loc,
        full_start: bun_ast::Loc,
        is_async: bool,
    ) -> PResult<Expr> {
        p.lexer.expect(T::TOpenParen)?;
        let _ = p.push_scope_for_parse_pass(scope::Kind::FunctionArgs, loc)?;
        let mut return_type = crate::sema::ts_syntax::TypeId::NONE;
        if p.lexer.token == T::TColon {
            p.lexer.next()?;
            p.skip_typescript_return_type()?;
            return_type = p.saved_type_or_error();
        }
        let mut fn_or_arrow_data = FnOrArrowDataParse {
            needs_async_loc: loc,
            allow_await: if is_async {
                AwaitOrYield::AllowExpr
            } else {
                AwaitOrYield::AllowIdent
            },
            ..Default::default()
        };
        let has_arrow_token = p.lexer.token == T::TEqualsGreaterThan;
        let arrow_result = p.parse_arrow_body(&mut [], &mut fn_or_arrow_data);
        p.pop_scope();
        let mut arrow = arrow_result?;
        arrow.is_async = is_async;
        if !has_arrow_token && arrow.prefer_expr && p.lexer.token != T::TComma {
            // `parseAssignmentExpressionOrHigher` returns the arrow function as is.
            p.forbid_suffix_after_as_loc = p.lexer.loc();
        }
        let mut arrow = p.new_expr(arrow, loc);
        p.mark_comments_before(&mut arrow.loc, loc, full_start);
        if return_type.is_some() {
            p.note_saved_type(&mut arrow.loc, crate::sema::Mark::ReturnType, return_type);
        }
        Ok(arrow)
    }

    /// `parseUnaryExpressionOrHigher`: the expression that starts at `loc` is the left operand of
    /// `**`. `operator`: its leading operator, none for `<T>`.
    #[cold]
    #[inline(never)]
    fn unary_before_exponentiation(
        &mut self,
        level: Level,
        loc: bun_ast::Loc,
        operator: &[u8],
    ) -> PResult<()> {
        let p = self;
        if p.is_tolerant() && !p.lexer.is_log_disabled {
            // The operand of a unary operator, of `await` and of `<T>` is parsed at Level::Prefix
            // (`parseSimpleUnaryExpression`): only the outermost is reported.
            if level.lt(Level::Prefix) {
                let range = p.lexer.range_from(loc);
                match operator {
                    b"" => p.lexer.ts_error(range, 17007),
                    _ => p.lexer.ts_error_about(range, 17006, operator),
                }
            }
            return Ok(());
        }
        p.lexer.unexpected()?;
        Err(crate::Error::SyntaxError)
    }

    // Before splitting this up, this used 3 KB of stack space per call.
    pub(crate) fn parse_prefix(
        &mut self,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> PResult<Expr> {
        let p = self;
        match p.lexer.token {
            T::TOpenBracket => Self::pfx_t_open_bracket(p, errors),
            T::TOpenBrace => Self::pfx_t_open_brace(p, errors),
            T::TLessThan => Self::pfx_t_less_than(p, level, errors, flags),
            T::TImport => Self::pfx_t_import(p, level),
            T::TOpenParen => Self::pfx_t_open_paren(p, level, flags),
            T::TPrivateIdentifier => Self::pfx_t_private_identifier(p, level),
            T::TIdentifier => Self::pfx_t_identifier(p, level, flags),
            T::TFalse => Self::pfx_t_false(p),
            T::TTrue => Self::pfx_t_true(p),
            T::TNull => Self::pfx_t_null(p),
            T::TThis => Self::pfx_t_this(p),
            T::TTemplateHead => Self::pfx_t_template_head(p),
            T::TNumericLiteral => Self::pfx_t_numeric_literal(p),
            T::TBigIntegerLiteral => Self::pfx_t_big_integer_literal(p),
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => p.parse_string_literal(),
            T::TSlashEquals | T::TSlash => Self::pfx_t_slash(p),
            T::TVoid => Self::pfx_t_void(p, level),
            T::TTypeof => Self::pfx_t_typeof(p, level),
            T::TDelete => Self::pfx_t_delete(p, level),
            T::TPlus => Self::pfx_t_plus(p, level),
            T::TMinus => Self::pfx_t_minus(p, level),
            T::TTilde => Self::pfx_t_tilde(p, level),
            T::TExclamation => Self::pfx_t_exclamation(p, level),
            T::TMinusMinus => Self::pfx_t_minus_minus(p),
            T::TPlusPlus => Self::pfx_t_plus_plus(p),
            T::TFunction => Self::pfx_t_function(p),
            T::TClass => Self::pfx_t_class(p),
            T::TAt => Self::pfx_t_at(p),
            T::TNew => Self::pfx_t_new(p, flags),
            T::TSuper => Self::pfx_t_super(p, level),
            _ => {
                if p.lexer.token == T::TEscapedKeyword
                    && Self::pfx_escaped_keyword_starts_expression(p, level)
                {
                    p.lexer.unescape_keyword();
                    return p.parse_prefix(level, errors, flags);
                }
                if p.lexer.token == T::TEqualsGreaterThan
                    && level.lte(Level::Assign)
                    && p.is_tolerant()
                    && !p.lexer.is_log_disabled
                {
                    let (loc, full_start) = (p.lexer.loc(), p.pos_for_jsdoc());
                    return Self::pfx_arrow_without_parameters(p, loc, full_start, false);
                }
                if p.lexer.token == T::TEndOfFile && p.is_tolerant() && !p.lexer.is_log_disabled {
                    return Self::pfx_missing_at_end_of_file(p);
                }
                let before = p.lexer.prev_error_loc;
                p.lexer.unexpected()?;
                if p.is_tolerant() && !p.lexer.is_log_disabled {
                    // `createMissingNode`: nothing is consumed, and the expected node is missing.
                    p.lexer.put_up_with(before)?;
                    return Ok(p.new_expr(E::Missing {}, p.lexer.loc()));
                }
                Err(crate::Error::SyntaxError)
            }
        }
    }

    /// `createIdentifierWithDiagnostic`: at the end of the file, 1109 is reported at the end of the
    /// last token.
    #[cold]
    #[inline(never)]
    fn pfx_missing_at_end_of_file(p: &mut Self) -> PResult<Expr> {
        let at: bun_ast::Loc = p.lexer.full_start();
        let (here, before) = (p.lexer.loc(), p.lexer.prev_error_loc);
        p.lexer.ts_error(bun_ast::Range { loc: at, len: 0 }, 1109);
        p.lexer.put_up_with(before)?;
        Ok(p.new_expr(E::Missing {}, here))
    }
}
