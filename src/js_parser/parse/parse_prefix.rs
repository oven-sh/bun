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

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
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
                // What `new` is given is a primary expression, where `super` is only the keyword.
                if p.lexer.tolerant && !p.lexer.is_log_disabled && level.lt(Level::Member) {
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
        let target = p.new_expr(E::Super {}, loc);
        if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TLessThan {
            let less_than = p.lexer.loc();
            if p.try_skip_type_script_type_arguments_with_backtracking() {
                let after_super = bun_ast::Range {
                    loc: super_range.end(),
                    len: 0,
                };
                p.lexer.ts_error(after_super, 2754);
                // A template drops the type arguments, and `resolveCall` ignores those of a call.
                if !matches!(
                    p.lexer.token,
                    T::TOpenParen | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead
                ) {
                    p.note_type_arguments(&target, less_than);
                }
                if matches!(p.lexer.token, T::TOpenParen | T::TDot | T::TOpenBracket) {
                    return Ok(target);
                }
            }
        }
        let range = p.lexer.range();
        p.lexer.ts_error(range, 1034);

        // `parseRightSideOfDot`. A missing name is where the previous token ends.
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
            // A word on a new line that another word follows on that line starts something else.
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
        p.lexer.next()?;

        // Arrow functions aren't allowed in the middle of expressions
        if level.gt(Level::Assign) {
            // Allow "in" inside parentheses
            let old_allow_in = p.allow_in;
            p.allow_in = true;

            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.mark_paren(&value, loc);
            p.lexer.expect(T::TCloseParen)?;

            p.allow_in = old_allow_in;
            return Ok(value);
        }

        p.parse_paren_expr(
            loc,
            level,
            ParenExprOpts {
                is_after_question_and_before_colon: flags == EFlags::AfterQuestionAndBeforeColon,
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
        // `parsePrimaryExpression` takes a private name anywhere. The checker reports 1451, 18016 or 2304.
        if (!p.allow_private_identifiers || !p.allow_in || level.gte(Level::Compare))
            && !p.lexer.tolerant
        {
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
        }

        let name = p.lexer.identifier;
        p.lexer.next()?;

        // Check for "#foo in bar"
        if p.lexer.token != T::TIn && !p.lexer.tolerant {
            p.lexer.expected(T::TIn)?;
        }

        let ref_ = p.store_name_in_ref(name);
        Ok(p.new_expr(E::PrivateIdentifier { ref_ }, loc))
    }

    fn pfx_t_identifier(p: &mut Self, level: Level, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
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
            if p.lexer.tolerant && Self::pfx_word_is_no_name_here(p, async_kind, level, flags) {
                return Self::pfx_missing(p);
            }
            (p.lexer.range(), p.lexer.raw())
        };

        p.lexer.next()?;

        // Handle async and await expressions
        match async_kind {
            AsyncPrefixExpression::IsAsync => {
                if (raw.as_ptr() == name.as_ptr() && raw.len() == name.len())
                    || AsyncPrefixExpression::find(raw) == AsyncPrefixExpression::IsAsync
                {
                    return p.parse_async_prefix_expr(name_range, level, flags);
                }
                if p.lexer.tolerant && !p.lexer.is_log_disabled {
                    return Self::pfx_escaped_async(p, name_range, level, flags);
                }
            }

            AsyncPrefixExpression::IsAwait => match p.fn_or_arrow_data_parse.allow_await {
                // `parseParametersWorker`, `parseClassStaticBlockBody`: an await context.
                AwaitOrYield::ForbidAll if p.lexer.tolerant && level.lte(Level::Prefix) => {
                    return Self::pfx_misplaced_await(p, name_range, raw, level);
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
                    if is_escaped && !(p.lexer.tolerant && !p.lexer.is_log_disabled) {
                        p.log().add_range_error(
                            Some(p.source),
                            name_range,
                            b"The keyword \"await\" cannot be escaped",
                        );
                    } else {
                        if is_escaped {
                            // `nextToken`: it is the keyword it spells, and the escape is objected to.
                            p.lexer.ts_error(name_range, 1260);
                        }

                        if p.fn_or_arrow_data_parse.is_top_level {
                            p.top_level_await_keyword = name_range;
                        }

                        if p.fn_or_arrow_data_parse.track_arrow_arg_errors {
                            p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_await =
                                name_range;
                        }

                        let value = p.parse_expr(Level::Prefix)?;
                        if p.lexer.token == T::TAsteriskAsterisk {
                            p.unary_before_exponentiation(level, loc, 17006)?;
                        }

                        return Ok(p.new_expr(E::Await { value }, loc));
                    }
                }
                AwaitOrYield::AllowIdent => {
                    // `isAwaitExpression`
                    if p.lexer.tolerant
                        && level.lte(Level::Prefix)
                        && Self::pfx_operand_follows_on_same_line(p)
                    {
                        return Self::pfx_misplaced_await(p, name_range, raw, level);
                    }
                    p.lexer.prev_token_was_await_keyword = true;
                    p.lexer.fn_or_arrow_start_loc = p.fn_or_arrow_data_parse.needs_async_loc;
                    // `isUpdateExpression`: `await` starts none even where it is a name, so `parseUnaryExpressionOrHigher`
                    // objects to it on the left of `**`.
                    if p.lexer.token == T::TAsteriskAsterisk
                        && p.lexer.tolerant
                        && level.lt(Level::Prefix)
                    {
                        p.lexer.ts_error(name_range, 17006);
                    }
                }
            },

            AsyncPrefixExpression::IsYield => {
                match p.fn_or_arrow_data_parse.allow_yield {
                    // `parseParametersWorker`: a yield context.
                    AwaitOrYield::ForbidAll if p.lexer.tolerant && level.lte(Level::Assign) => {
                        return Self::pfx_misplaced_yield(p, name_range, raw, true);
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
                        if is_escaped && !(p.lexer.tolerant && !p.lexer.is_log_disabled) {
                            p.log().add_range_error(
                                Some(p.source),
                                name_range,
                                b"The keyword \"yield\" cannot be escaped",
                            );
                        } else {
                            if is_escaped {
                                // `nextToken`: it is the keyword it spells, and the escape is objected to.
                                p.lexer.ts_error(name_range, 1260);
                            }

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
                        if p.lexer.tolerant
                            && level.lte(Level::Assign)
                            && Self::pfx_operand_follows_on_same_line(p)
                        {
                            return Self::pfx_misplaced_yield(p, name_range, raw, false);
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
            let binding = p.b(B::Identifier { r#ref: ref_ }, loc);
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
            let arrow_result = p.parse_arrow_body(args, &mut fn_or_arrow_data);
            p.pop_scope();
            return Ok(p.new_expr(arrow_result?, loc));
        }

        let ref_ = p.store_name_in_ref(name);

        Ok(Expr::init_identifier(ref_, loc))
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
        raw: &[u8],
        level: Level,
    ) -> PResult<Expr> {
        if AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsAwait {
            // `nextToken`: a keyword written with an escape.
            p.lexer.ts_error(await_range, 1260);
        }
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.unary_before_exponentiation(level, await_range.loc, 17006)?;
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
        raw: &[u8],
        in_generator: bool,
    ) -> PResult<Expr> {
        if AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsYield {
            // `nextToken`: a keyword written with an escape.
            p.lexer.ts_error(yield_range, 1260);
        }
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
            p.unary_before_exponentiation(level, loc, 17006)?;
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
            p.unary_before_exponentiation(level, loc, 17006)?;
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
            p.unary_before_exponentiation(level, loc, 17006)?;
        }
        if let ExprData::EIndex(e_index) = &value.data {
            if let ExprData::EPrivateIdentifier(private) = &e_index.index.data {
                let name = p.load_name_from_ref(private.ref_);
                let range = bun_ast::Range {
                    loc: value.loc,
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
            p.unary_before_exponentiation(level, loc, 17006)?;
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
            p.unary_before_exponentiation(level, loc, 17006)?;
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
            p.unary_before_exponentiation(level, loc, 17006)?;
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
            p.unary_before_exponentiation(level, loc, 17006)?;
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
        let value = if p.lexer.tolerant {
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
        let value = if p.lexer.tolerant {
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
            // Member accesses, calls and `!` are taken. A postfix `++` and binary operators are not.
            p.parse_expr(Level::Postfix)?
        };
        if Self::cannot_follow_update(p) {
            p.forbid_suffix_after_as_loc = p.lexer.loc();
        }
        Ok(value)
    }

    /// Whether the current token starts a unary expression that `parsePrimaryExpression` does not take.
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
        p.parse_fn_expr(loc, false)
    }

    fn pfx_t_class(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let class_keyword = p.lexer.range();
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
            let _ = p.skip_type_script_type_parameters(
                TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                    | TypeParameterFlag::ALLOW_CONST_MODIFIER,
            )?;
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

        Ok(p.new_expr(class, loc))
    }

    fn pfx_t_at(p: &mut Self) -> PResult<Expr> {
        // Parse decorators before a class expression: @dec class { ... }
        let at_loc = p.lexer.loc();
        let ts_decorators = p.parse_type_script_decorators()?;

        // Expect class keyword after decorators
        if p.lexer.token != T::TClass {
            if p.lexer.tolerant && !p.lexer.is_log_disabled {
                // `parseDecoratedExpression`: 1109 where the last decorator ends, and a missing declaration.
                let node_pos = p.lexer.full_start();
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
        let class_keyword = p.lexer.range();
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
            let _ = p.skip_type_script_type_parameters(
                TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                    | TypeParameterFlag::ALLOW_CONST_MODIFIER,
            )?;
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

        Ok(p.new_expr(class, loc))
    }

    fn pfx_t_new(p: &mut Self, flags: EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;

        // Special-case the weird "new.target" expression here
        if p.lexer.token == T::TDot {
            p.lexer.next()?;

            if p.lexer.token != T::TIdentifier || p.lexer.raw() != b"target" {
                if !p.lexer.tolerant || p.lexer.is_log_disabled {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }
                if !p.lexer.is_identifier_or_keyword() && p.lexer.token != T::TPrivateIdentifier {
                    // `parseIdentifierName`: 1003, the token stays, and the name is missing.
                    p.lexer.expect(T::TIdentifier)?;
                    let range = bun_ast::Range { loc, len: 3 };
                    return Ok(p.new_expr(E::NewTarget { range }, loc));
                }
                // `checkGrammarMetaProperty`: any word makes a meta property, and all but `target` are objected to.
                if p.lexer.identifier != b"target" {
                    let name = p.lexer.range();
                    p.lexer.ts_error(name, 17012);
                }
            }
            let range = bun_ast::Range {
                loc,
                len: p.lexer.range().end().start - loc.start,
            };

            p.lexer.next()?;
            return Ok(p.new_expr(E::NewTarget { range }, loc));
        }

        // This will become the new expr
        // Parse target into a local, then construct E::New once.
        let mut target = Expr::EMPTY;
        if p.lexer.tolerant
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

        if Self::IS_TYPESCRIPT_ENABLED {
            // The target's own suffixes may have taken them.
            if let Some(type_arguments) = p.take_type_arguments() {
                p.mark_type_syntax(loc, crate::sema::Mark::TypeArguments, type_arguments);
            }
            // Skip over TypeScript type arguments here if there are any
            if p.lexer.token == T::TLessThan {
                let type_arguments = p.lexer.loc();
                if p.try_skip_type_script_type_arguments_with_backtracking() {
                    p.mark_type_syntax(loc, crate::sema::Mark::TypeArguments, type_arguments);
                }
            }
        }

        let (args, close_parens_loc) = if p.lexer.token == T::TOpenParen {
            let call_args = p.parse_call_args()?;
            (call_args.list, call_args.loc)
        } else {
            (bun_alloc::AstAlloc::vec(), bun_ast::Loc::EMPTY)
        };

        Ok(p.new_expr(
            E::New {
                target,
                args,
                close_parens_loc,
                ..Default::default()
            },
            loc,
        ))
    }

    fn pfx_t_open_bracket(p: &mut Self, errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let mut is_single_line = !p.lexer.has_newline_before;
        let mut items: smallvec::SmallVec<[Expr; 8]> = smallvec::SmallVec::new();
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread = bun_ast::Loc::default();

        // Allow "in" inside arrays
        let old_allow_in = p.allow_in;
        p.allow_in = true;
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
                    items.push(Expr {
                        data: ExprData::EMissing(E::Missing {}),
                        loc: p.lexer.loc(),
                    });
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
        p.lexer.expect(T::TCloseBracket)?;
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

    fn pfx_t_open_brace(p: &mut Self, errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let mut is_single_line = !p.lexer.has_newline_before;
        let mut properties: bun_alloc::ArenaVec<'_, G::Property> =
            bun_alloc::ArenaVec::new_in(p.arena);
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread: bun_ast::Loc = bun_ast::Loc::default();

        // Allow "in" inside object literals
        let old_allow_in = p.allow_in;
        p.allow_in = true;
        let saved_contexts = p.enter_list(ListKind::ObjectLiteralMembers);

        while p.lexer.token != T::TCloseBrace {
            match p.classify_list_token(ListKind::ObjectLiteralMembers)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let element_start = p.lexer.loc();
            if p.lexer.token == T::TDotDotDot {
                p.lexer.next()?;
                let mut value = Expr::EMPTY;
                p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut value)?;
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
                if let Some(prop) = p.parse_property(
                    PropertyKind::Normal,
                    &mut property_opts,
                    Some(&mut self_errors),
                )? {
                    debug_assert!(prop.key.is_some() || prop.value.is_some());
                    properties.push(prop);
                }
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
        p.lexer.expect(T::TCloseBrace)?;
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
                let _ =
                    p.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
                p.lexer.expect(T::TOpenParen)?;
                return p.parse_paren_expr(
                    loc,
                    level,
                    ParenExprOpts {
                        force_arrow_fn: true,
                        ..Default::default()
                    },
                );
            }
        }

        if p.is_jsx_enabled() {
            if p.lexer.tolerant {
                return Self::pfx_jsx_or_missing(p, level);
            }
            // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
            p.lexer.next_inside_jsx_element()?;
            let element = p.parse_jsx_element(loc)?;

            // The call to parseJSXElement() above doesn't consume the last
            // TGreaterThan because the caller knows what Next() function to call.
            // Use Next() instead of NextInsideJSXElement() here since the next
            // token is an expression.
            p.lexer.next()?;
            return Ok(element);
        }

        if Self::IS_TYPESCRIPT_ENABLED {
            // This is either an old-style type cast or a generic lambda function

            // `parseSimpleUnaryExpression`: an arrow function starts an assignment expression. In an operand "<" can
            // only open a type assertion, which has one type between the brackets (`parseTypeAssertion`).
            let only_a_cast =
                level.gt(Level::Assign) && p.lexer.tolerant && !p.lexer.is_log_disabled;

            // "<T>(x)"
            // "<T>(x) => {}"
            let skipped = if only_a_cast {
                SkipTypeParameterResult::DidNotSkipAnything
            } else {
                p.try_skip_type_script_type_parameters_then_open_paren_with_backtracking()
            };
            match skipped {
                SkipTypeParameterResult::DidNotSkipAnything => {}
                result => {
                    p.lexer.expect(T::TOpenParen)?;
                    let mut value = p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    )?;
                    // "<T>(x).y" turned out to be a cast, of "(x).y".
                    if p.keeps_type_syntax()
                        && !(matches!(value.data, ExprData::EArrow(_)) && value.loc == loc)
                    {
                        p.parse_suffix(&mut value, Level::Prefix, None, flags)?;
                        p.mark_cast(
                            &value,
                            crate::sema::CastKind::As,
                            bun_ast::Loc {
                                start: loc.start + 1,
                            },
                        );
                        if p.lexer.token == T::TAsteriskAsterisk
                            && p.lexer.tolerant
                            && !p.lexer.is_log_disabled
                        {
                            p.unary_before_exponentiation(level, loc, 17007)?;
                        }
                    }
                    return Ok(value);
                }
            }

            // "<T>x"
            p.lexer.next()?;
            let type_loc = p.lexer.loc();
            if p.keeps_type_syntax() {
                p.skip_type_script_type(Level::Lowest)?;
                p.lexer.expect_greater_than::<false>()?;
                // The cast covers "x.y" in "<T>x.y", which the caller's suffix
                // loop would otherwise apply to the annotated "x".
                let mut value = Expr::EMPTY;
                if only_a_cast && p.lexer.token == T::TOpenParen {
                    // As on the path above: the parentheses of "<T>(x)" are noted as opening at the "<".
                    value = p.parse_prefix(Level::Prefix, None, flags)?;
                    p.mark_paren(&value, loc);
                    p.parse_suffix(&mut value, Level::Prefix, None, flags)?;
                } else {
                    p.parse_expr_with_flags(Level::Prefix, flags, &mut value)?;
                }
                p.mark_cast(&value, crate::sema::CastKind::As, type_loc);
                if p.lexer.token == T::TAsteriskAsterisk
                    && p.lexer.tolerant
                    && !p.lexer.is_log_disabled
                {
                    p.unary_before_exponentiation(level, loc, 17007)?;
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

    /// `parseUpdateExpression` and `parseSimpleUnaryExpression` at a `<` in a file with JSX.
    #[cold]
    #[inline(never)]
    fn pfx_jsx_or_missing(p: &mut Self, level: Level) -> PResult<Expr> {
        // The operand of a unary operator is parsed at Level::Prefix: no lookahead, and `mustBeUnary`.
        let must_be_unary = level.eql(Level::Prefix);
        let starts_jsx = level.lte(Level::Prefix)
            && !p.lexer.is_less_than_slash()
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

    /// `parseJsxElementOrSelfClosingElementOrFragment` in an expression, at its `<`. Another element right after it is
    /// reported (2657) where the first of them starts, `first`, and joined to this one by a comma.
    fn pfx_jsx_elements(p: &mut Self, first: bun_ast::Loc, must_be_unary: bool) -> PResult<Expr> {
        let less_than = p.lexer.loc();
        // Use NextInsideJSXElement() instead of Next() so we parse "<<" as "<"
        p.lexer.next_inside_jsx_element()?;
        let element = p.parse_jsx_element(less_than)?;
        // The last ">" is left to the caller, and so is the conflict marker that ended the children, which is a syntax
        // error token. Nothing is consumed for a ">" that is missing.
        if matches!(p.lexer.token, T::TGreaterThan | T::TSyntaxError) {
            p.lexer.next()?;
        }
        if must_be_unary || p.lexer.token != T::TLessThan || p.lexer.is_less_than_slash() {
            return Ok(element);
        }
        if p.lexer.is_log_disabled {
            return Err(crate::Error::Backtrack);
        }
        let rest = Self::pfx_jsx_elements(p, first, false)?;
        p.lexer
            .ts_error(bun_ast::Range { loc: first, len: 1 }, 2657);
        Ok(element.join_with_comma(rest))
    }

    #[inline]
    fn pfx_t_import(p: &mut Self, level: Level) -> PResult<Expr> {
        if p.lexer.tolerant && !p.lexer.is_log_disabled && !Self::pfx_import_starts_expression(p) {
            return Self::pfx_missing(p);
        }
        let loc = p.lexer.loc();
        p.lexer.next()?;
        p.parse_import_expr(loc, level)
    }

    /// `parseLeftHandSideExpressionOrHigher`: only `(`, `<` and `.` make an expression of `import`. Before anything else it is
    /// left for the statement it starts.
    #[cold]
    #[inline(never)]
    fn pfx_import_starts_expression(p: &mut Self) -> bool {
        p.next_token_matches(|p| matches!(p.lexer.token, T::TOpenParen | T::TLessThan | T::TDot))
    }

    /// `createMissingNode`: 1109 at the current token, which stays, and what should have been there is missing.
    #[cold]
    #[inline(never)]
    fn pfx_missing(p: &mut Self) -> PResult<Expr> {
        let (range, before) = (p.lexer.range(), p.lexer.prev_error_loc);
        p.lexer.ts_error(range, 1109);
        p.lexer.put_up_with(before)?;
        Ok(p.new_expr(E::Missing {}, range.loc))
    }

    /// `isIdentifier`: `yield` in a generator and `await` where it is a keyword are no names. `word` is the current token.
    /// Only an assignment expression starts with such a `yield` (`parseAssignmentExpressionOrHigherWorker`) and only a unary
    /// expression with such an `await` (`parseSimpleUnaryExpression`): for `parsePrimaryExpression` nothing starts there.
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
            // `parseDecoratorExpression` deals with `@await` in a way of its own.
            AsyncPrefixExpression::IsAwait => {
                level.gt(Level::Prefix)
                    && flags != EFlags::TsDecorator
                    && p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
            }
            _ => false,
        }
    }

    /// `async` written with an escape, which has been consumed. `nextToken`: where it is the modifier of a function it is
    /// objected to. Where it is a name (`createIdentifierWithDiagnostic`) it is not.
    #[cold]
    #[inline(never)]
    fn pfx_escaped_async(
        p: &mut Self,
        async_range: bun_ast::Range,
        level: Level,
        flags: EFlags,
    ) -> PResult<Expr> {
        let expr = p.parse_async_prefix_expr(async_range, level, flags)?;
        let is_modifier = match &expr.data {
            ExprData::EFunction(_) => true,
            ExprData::EArrow(arrow) => arrow.is_async,
            _ => false,
        };
        if is_modifier {
            p.lexer.ts_error(async_range, 1260);
        }
        Ok(expr)
    }

    /// `nextToken`: 1260 is said of a keyword written with an escape when it is consumed, so only of one that the expression
    /// wanted at `level` starts with. Any other stays, and is no expression.
    #[cold]
    #[inline(never)]
    fn pfx_escaped_keyword_starts_expression(p: &mut Self, level: Level) -> bool {
        if !p.lexer.tolerant || p.lexer.is_log_disabled {
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
            // `parseLeftHandSideExpressionOrHigher`: what `new` is given is not one.
            Some(T::TImport) => level.lt(Level::Member) && Self::pfx_import_starts_expression(p),
            _ => false,
        }
    }

    /// `isImplementsClause`: `implements` after `class` is the name of the class unless a name or a keyword follows it.
    #[cold]
    #[inline(never)]
    fn pfx_implements_is_the_name(p: &mut Self) -> bool {
        p.lexer.tolerant && !p.next_token_matches(|p| p.lexer.is_identifier_or_keyword())
    }

    /// `isParenthesizedArrowFunctionExpression`: a lone `=>` where an assignment expression starts is taken for an arrow
    /// function. `parseParenthesizedArrowFunctionExpression`: 1005 for the `(`, and there are no parameters.
    #[cold]
    #[inline(never)]
    fn pfx_arrow_without_parameters(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.expect(T::TOpenParen)?;
        let _ = p.push_scope_for_parse_pass(scope::Kind::FunctionArgs, loc)?;
        let mut fn_or_arrow_data = FnOrArrowDataParse {
            needs_async_loc: loc,
            ..Default::default()
        };
        let arrow_result = p.parse_arrow_body(&mut [], &mut fn_or_arrow_data);
        p.pop_scope();
        Ok(p.new_expr(arrow_result?, loc))
    }

    /// `parseUnaryExpressionOrHigher`: what starts at `loc` is on the left of `**`.
    #[cold]
    #[inline(never)]
    fn unary_before_exponentiation(
        &mut self,
        level: Level,
        loc: bun_ast::Loc,
        code: u32,
    ) -> PResult<()> {
        let p = self;
        if p.lexer.tolerant && !p.lexer.is_log_disabled {
            // The operand of a unary operator, of `await` and of `<T>` is parsed at Level::Prefix
            // (`parseSimpleUnaryExpression`): only the outermost is objected to.
            if level.lt(Level::Prefix) {
                let len = p.lexer.start as i32 - loc.start;
                p.lexer.ts_error(bun_ast::Range { loc, len }, code);
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
                    && p.lexer.tolerant
                    && !p.lexer.is_log_disabled
                {
                    return Self::pfx_arrow_without_parameters(p);
                }
                if p.lexer.token == T::TEndOfFile && p.lexer.tolerant && !p.lexer.is_log_disabled {
                    return Self::pfx_missing_at_end_of_file(p);
                }
                let before = p.lexer.prev_error_loc;
                p.lexer.unexpected()?;
                if p.lexer.tolerant && !p.lexer.is_log_disabled {
                    // `createMissingNode`: nothing is consumed, and what should have been there is missing.
                    p.lexer.put_up_with(before)?;
                    return Ok(p.new_expr(E::Missing {}, p.lexer.loc()));
                }
                Err(crate::Error::SyntaxError)
            }
        }
    }

    /// `createIdentifierWithDiagnostic`: at the end of the file, 1109 is reported where the last token ended.
    #[cold]
    #[inline(never)]
    fn pfx_missing_at_end_of_file(p: &mut Self) -> PResult<Expr> {
        let at: bun_ast::Loc = p.lexer.full_start();
        let (here, before) = (p.lexer.loc(), p.lexer.prev_error_loc);
        p.lexer.ts_error(bun_ast::Range { loc: at, len: 0 }, 1109);
        // A repeat of this error counts as no progress, like a repeat at the token.
        p.lexer
            .put_up_with(if before.eql(at) { here } else { before })?;
        Ok(p.new_expr(E::Missing {}, here))
    }
}
