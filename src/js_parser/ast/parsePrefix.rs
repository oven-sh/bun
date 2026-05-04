use crate::js_ast::{self, Expr, ExprNodeList, B, E, G};
use crate::js_ast::G::{Arg, Property};
use crate::js_ast::Op::Level;
use crate::js_lexer::T;
use crate::{
    AsyncPrefixExpression, DeferredErrors, FnOrArrowDataParse, JSXTransformType, NewParser_,
    ParenExprOpts, ParseClassOptions, Prefill, PropertyOpts, TypeParameterFlag, TypeScript,
};
use bun_logger as logger;
use bstr::BStr;

// TODO(port): narrow error set — Zig used `anyerror!Expr` throughout
type PResult<T> = Result<T, bun_core::Error>;

/// Zig: `fn ParsePrefix(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
/// Ported as a zero-sized generic struct whose impl block holds the per-token helpers.
pub struct ParsePrefix<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

// TODO(port): inherent associated types are unstable; Phase B may need to inline `P` everywhere
// or restructure these as inherent methods on `NewParser_` directly.
impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > ParsePrefix<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    // Zig: const P = js_parser.NewParser_(parser_feature__typescript, parser_feature__jsx, parser_feature__scan_only);
    // TODO(port): inherent associated type (feature(inherent_associated_types))
    type P = NewParser_<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>;

    const IS_JSX_ENABLED: bool = Self::P::IS_JSX_ENABLED;
    const IS_TYPESCRIPT_ENABLED: bool = Self::P::IS_TYPESCRIPT_ENABLED;

    fn t_super(p: &mut Self::P, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let l = level as u8;
        let super_range = p.lexer.range();
        p.lexer.next()?;

        match p.lexer.token {
            T::TOpenParen => {
                if l < (Level::Call as u8) && p.fn_or_arrow_data_parse.allow_super_call {
                    return Ok(p.new_expr(E::Super {}, loc));
                }
            }
            T::TDot | T::TOpenBracket => {
                if p.fn_or_arrow_data_parse.allow_super_property {
                    return Ok(p.new_expr(E::Super {}, loc));
                }
            }
            _ => {}
        }

        p.log
            .add_range_error(p.source, super_range, "Unexpected \"super\"")
            .expect("unreachable");
        Ok(p.new_expr(E::Super {}, loc))
    }

    fn t_open_paren(p: &mut Self::P, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;

        // Arrow functions aren't allowed in the middle of expressions
        if level.gt(Level::Assign) {
            // Allow "in" inside parentheses
            let old_allow_in = p.allow_in;
            p.allow_in = true;

            let mut value = p.parse_expr(Level::Lowest)?;
            p.mark_expr_as_parenthesized(&mut value);
            p.lexer.expect(T::TCloseParen)?;

            p.allow_in = old_allow_in;
            return Ok(value);
        }

        p.parse_paren_expr(loc, level, ParenExprOpts::default())
    }

    fn t_false(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.new_expr(E::Boolean { value: false }, loc))
    }

    fn t_true(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.new_expr(E::Boolean { value: true }, loc))
    }

    fn t_null(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        Ok(p.new_expr(E::Null {}, loc))
    }

    fn t_this(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        if p.fn_or_arrow_data_parse.is_this_disallowed {
            p.log
                .add_range_error(p.source, p.lexer.range(), "Cannot use \"this\" here")
                .expect("unreachable");
        }
        p.lexer.next()?;
        Ok(Expr {
            data: Prefill::Data::THIS,
            loc,
        })
    }

    fn t_private_identifier(p: &mut Self::P, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        if !p.allow_private_identifiers || !p.allow_in || level.gte(Level::Compare) {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        let name = p.lexer.identifier;
        p.lexer.next()?;

        // Check for "#foo in bar"
        if p.lexer.token != T::TIn {
            p.lexer.expected(T::TIn)?;
        }

        let ref_ = p.store_name_in_ref(name)?;
        Ok(p.new_expr(E::PrivateIdentifier { ref_ }, loc))
    }

    fn t_identifier(p: &mut Self::P, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let name = p.lexer.identifier;
        let name_range = p.lexer.range();
        let raw = p.lexer.raw();

        p.lexer.next()?;

        // Handle async and await expressions
        match AsyncPrefixExpression::find(name) {
            AsyncPrefixExpression::IsAsync => {
                if (raw.as_ptr() == name.as_ptr() && raw.len() == name.len())
                    || AsyncPrefixExpression::find(raw) == AsyncPrefixExpression::IsAsync
                {
                    return p.parse_async_prefix_expr(name_range, level);
                }
            }

            AsyncPrefixExpression::IsAwait => {
                match p.fn_or_arrow_data_parse.allow_await {
                    AllowAwait::ForbidAll => {
                        p.log
                            .add_range_error(
                                p.source,
                                name_range,
                                "The keyword \"await\" cannot be used here",
                            )
                            .expect("unreachable");
                    }
                    AllowAwait::AllowExpr => {
                        if AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsAwait {
                            p.log
                                .add_range_error(
                                    p.source,
                                    name_range,
                                    "The keyword \"await\" cannot be escaped",
                                )
                                .expect("unreachable");
                        } else {
                            if p.fn_or_arrow_data_parse.is_top_level {
                                p.top_level_await_keyword = name_range;
                            }

                            if p.fn_or_arrow_data_parse.track_arrow_arg_errors {
                                p.fn_or_arrow_data_parse
                                    .arrow_arg_errors
                                    .invalid_expr_await = name_range;
                            }

                            let value = p.parse_expr(Level::Prefix)?;
                            if p.lexer.token == T::TAsteriskAsterisk {
                                p.lexer.unexpected()?;
                                return Err(bun_core::err!("SyntaxError"));
                            }

                            return Ok(p.new_expr(E::Await { value }, loc));
                        }
                    }
                    AllowAwait::AllowIdent => {
                        p.lexer.prev_token_was_await_keyword = true;
                        p.lexer.await_keyword_loc = name_range.loc;
                        p.lexer.fn_or_arrow_start_loc =
                            p.fn_or_arrow_data_parse.needs_async_loc;
                    }
                }
            }

            AsyncPrefixExpression::IsYield => {
                match p.fn_or_arrow_data_parse.allow_yield {
                    AllowYield::ForbidAll => {
                        p.log
                            .add_range_error(
                                p.source,
                                name_range,
                                "The keyword \"yield\" cannot be used here",
                            )
                            .expect("unreachable");
                    }
                    AllowYield::AllowExpr => {
                        if AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsYield {
                            p.log
                                .add_range_error(
                                    p.source,
                                    name_range,
                                    "The keyword \"yield\" cannot be escaped",
                                )
                                .expect("unreachable");
                        } else {
                            if level.gt(Level::Assign) {
                                p.log
                                    .add_range_error(
                                        p.source,
                                        name_range,
                                        "Cannot use a \"yield\" here without parentheses",
                                    )
                                    .expect("unreachable");
                            }

                            if p.fn_or_arrow_data_parse.track_arrow_arg_errors {
                                p.fn_or_arrow_data_parse
                                    .arrow_arg_errors
                                    .invalid_expr_yield = name_range;
                            }

                            return p.parse_yield_expr(loc);
                        }
                    }
                    // .allow_ident => {

                    // },
                    _ => {
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
                                    p.log
                                        .add_range_error(
                                            p.source,
                                            name_range,
                                            "Cannot use \"yield\" outside a generator function",
                                        )
                                        .expect("unreachable");
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
            let ref_ = p.store_name_in_ref(name).expect("unreachable");
            // PORT NOTE: reshaped for borrowck — build binding before borrowing allocator
            let binding = p.b(B::Identifier { ref_ }, loc);
            // TODO(port): arena slice alloc; Zig: p.allocator.alloc(Arg, 1)
            let args = p.allocator.alloc_slice_copy(&[Arg {
                binding,
                ..Default::default()
            }]);

            let _ = p
                .push_scope_for_parse_pass(ScopeKind::FunctionArgs, loc)
                .expect("unreachable");
            // PORT NOTE: Zig `defer p.popScope()` — reshaped so pop_scope runs before `?` propagates
            let mut fn_or_arrow_data = FnOrArrowDataParse {
                needs_async_loc: loc,
                ..Default::default()
            };
            let arrow_result = p.parse_arrow_body(args, &mut fn_or_arrow_data);
            p.pop_scope();
            return Ok(p.new_expr(arrow_result?, loc));
        }

        let ref_ = p.store_name_in_ref(name).expect("unreachable");

        Ok(Expr::init_identifier(ref_, loc))
    }

    fn t_template_head(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let head = p.lexer.to_e_string()?;

        let parts = p.parse_template_parts(false)?;

        // Check if TemplateLiteral is unsupported. We don't care for this product.`
        // if ()

        Ok(p.new_expr(
            E::Template {
                head: TemplateHead::Cooked(head),
                parts,
            },
            loc,
        ))
    }

    fn t_numeric_literal(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let value = p.new_expr(E::Number { value: p.lexer.number }, loc);
        // p.checkForLegacyOctalLiteral()
        p.lexer.next()?;
        Ok(value)
    }

    fn t_big_integer_literal(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let value = p.lexer.identifier;
        // markSyntaxFeature bigInt
        p.lexer.next()?;
        Ok(p.new_expr(E::BigInt { value }, loc))
    }

    fn t_slash(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.scan_reg_exp()?;
        // always set regex_flags_start to null to make sure we don't accidentally use the wrong value later
        // PORT NOTE: Zig `defer p.lexer.regex_flags_start = null` — scopeguard so the reset also
        // runs on the `next()?` error path (Zig defer fires on both success and error return).
        let mut lexer = scopeguard::guard(&mut p.lexer, |l| l.regex_flags_start = None);
        let value = lexer.raw();
        lexer.next()?;
        let flags_offset = lexer.regex_flags_start;
        drop(lexer); // runs the reset and releases the borrow on `p`

        Ok(p.new_expr(E::RegExp { value, flags_offset }, loc))
    }

    fn t_void(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        Ok(p.new_expr(
            E::Unary {
                op: Op::UnVoid,
                value,
            },
            loc,
        ))
    }

    fn t_typeof(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        let was_originally_typeof_identifier = matches!(value.data, ExprData::EIdentifier(_));
        Ok(p.new_expr(
            E::Unary {
                op: Op::UnTypeof,
                value,
                flags: UnaryFlags {
                    was_originally_typeof_identifier,
                    ..Default::default()
                },
            },
            loc,
        ))
    }

    fn t_delete(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }
        if let ExprData::EIndex(e_index) = &value.data {
            if let ExprData::EPrivateIdentifier(private) = &e_index.index.data {
                let name = p.load_name_from_ref(private.ref_);
                let range = logger::Range {
                    loc: value.loc,
                    len: i32::try_from(name.len()).unwrap(),
                };
                p.log
                    .add_range_error_fmt(
                        p.source,
                        range,
                        format_args!(
                            "Deleting the private name \"{}\" is forbidden",
                            BStr::new(name)
                        ),
                    )
                    .expect("unreachable");
            }
        }

        let was_originally_delete_of_identifier_or_property_access =
            matches!(value.data, ExprData::EIdentifier(_)) || value.is_property_access();
        Ok(p.new_expr(
            E::Unary {
                op: Op::UnDelete,
                value,
                flags: UnaryFlags {
                    was_originally_delete_of_identifier_or_property_access,
                    ..Default::default()
                },
            },
            loc,
        ))
    }

    fn t_plus(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        Ok(p.new_expr(E::Unary { op: Op::UnPos, value }, loc))
    }

    fn t_minus(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        Ok(p.new_expr(E::Unary { op: Op::UnNeg, value }, loc))
    }

    fn t_tilde(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        Ok(p.new_expr(E::Unary { op: Op::UnCpl, value }, loc))
    }

    fn t_exclamation(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
        }

        Ok(p.new_expr(E::Unary { op: Op::UnNot, value }, loc))
    }

    fn t_minus_minus(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        Ok(p.new_expr(E::Unary { op: Op::UnPreDec, value }, loc))
    }

    fn t_plus_plus(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        Ok(p.new_expr(E::Unary { op: Op::UnPreInc, value }, loc))
    }

    fn t_function(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.parse_fn_expr(loc, false, logger::Range::NONE)
    }

    fn t_class(p: &mut Self::P) -> PResult<Expr> {
        let loc = p.lexer.loc();
        let class_keyword = p.lexer.range();
        // markSyntaxFEatuer class
        p.lexer.next()?;
        let mut name: Option<js_ast::LocRef> = None;

        let _ = p
            .push_scope_for_parse_pass(ScopeKind::ClassName, loc)
            .expect("unreachable");

        // Parse an optional class name
        if p.lexer.token == T::TIdentifier {
            let name_text = p.lexer.identifier;
            if !Self::IS_TYPESCRIPT_ENABLED || name_text != b"implements" {
                if p.fn_or_arrow_data_parse.allow_await != AllowAwait::AllowIdent
                    && name_text == b"await"
                {
                    p.log
                        .add_range_error(
                            p.source,
                            p.lexer.range(),
                            "Cannot use \"await\" as an identifier here",
                        )
                        .expect("unreachable");
                }

                name = Some(js_ast::LocRef {
                    loc: p.lexer.loc(),
                    ref_: p.new_symbol(SymbolKind::Other, name_text).expect("unreachable"),
                });
                p.lexer.next()?;
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(TypeParameterFlag {
                allow_in_out_variance_annotations: true,
                allow_const_modifier: true,
                ..Default::default()
            })?;
        }

        let class = p.parse_class(
            class_keyword,
            name,
            ParseClassOptions {
                allow_ts_decorators: Self::IS_TYPESCRIPT_ENABLED
                    || p.options.features.standard_decorators,
                ..Default::default()
            },
        )?;
        p.pop_scope();

        Ok(p.new_expr(class, loc))
    }

    fn t_at(p: &mut Self::P) -> PResult<Expr> {
        // Parse decorators before a class expression: @dec class { ... }
        let ts_decorators = p.parse_type_script_decorators()?;

        // Expect class keyword after decorators
        if p.lexer.token != T::TClass {
            p.lexer.expected(T::TClass)?;
            return Err(bun_core::err!("SyntaxError"));
        }

        let loc = p.lexer.loc();
        let class_keyword = p.lexer.range();
        p.lexer.next()?;
        let mut name: Option<js_ast::LocRef> = None;

        let _ = p
            .push_scope_for_parse_pass(ScopeKind::ClassName, loc)
            .expect("unreachable");

        // Parse an optional class name
        if p.lexer.token == T::TIdentifier {
            let name_text = p.lexer.identifier;
            if !Self::IS_TYPESCRIPT_ENABLED || name_text != b"implements" {
                if p.fn_or_arrow_data_parse.allow_await != AllowAwait::AllowIdent
                    && name_text == b"await"
                {
                    p.log
                        .add_range_error(
                            p.source,
                            p.lexer.range(),
                            "Cannot use \"await\" as an identifier here",
                        )
                        .expect("unreachable");
                }

                name = Some(js_ast::LocRef {
                    loc: p.lexer.loc(),
                    ref_: p.new_symbol(SymbolKind::Other, name_text).expect("unreachable"),
                });
                p.lexer.next()?;
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(TypeParameterFlag {
                allow_in_out_variance_annotations: true,
                allow_const_modifier: true,
                ..Default::default()
            })?;
        }

        let class = p.parse_class(
            class_keyword,
            name,
            ParseClassOptions {
                ts_decorators,
                allow_ts_decorators: true,
                ..Default::default()
            },
        )?;
        p.pop_scope();

        Ok(p.new_expr(class, loc))
    }

    fn t_new(p: &mut Self::P, flags: Expr::EFlags) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;

        // Special-case the weird "new.target" expression here
        if p.lexer.token == T::TDot {
            p.lexer.next()?;

            if p.lexer.token != T::TIdentifier || p.lexer.raw() != b"target" {
                p.lexer.unexpected()?;
                return Err(bun_core::err!("SyntaxError"));
            }
            let range = logger::Range {
                loc,
                len: p.lexer.range().end().start - loc.start,
            };

            p.lexer.next()?;
            return Ok(p.new_expr(E::NewTarget { range }, loc));
        }

        // This wil become the new expr
        // TODO(port): Zig allocates E::New with undefined fields then fills them via the arena
        // pointer. Reshaped: parse target into a local, then construct E::New once.
        let mut target = Expr::empty();
        p.parse_expr_with_flags(Level::Member, flags, &mut target)?;

        if Self::IS_TYPESCRIPT_ENABLED {
            // Skip over TypeScript type arguments here if there are any
            if p.lexer.token == T::TLessThan {
                let _ = p.try_skip_type_script_type_arguments_with_backtracking();
            }
        }

        let (args, close_parens_loc) = if p.lexer.token == T::TOpenParen {
            let call_args = p.parse_call_args()?;
            (call_args.list, call_args.loc)
        } else {
            (ExprNodeList::default(), logger::Loc::EMPTY)
        };

        Ok(p.new_expr(
            E::New {
                target,
                args,
                close_parens_loc,
            },
            loc,
        ))
    }

    fn t_open_bracket(p: &mut Self::P, errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let mut is_single_line = !p.lexer.has_newline_before;
        // PERF(port): was arena-backed ArrayList — profile in Phase B
        let mut items: bumpalo::collections::Vec<'_, Expr> =
            bumpalo::collections::Vec::new_in(p.allocator);
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread = logger::Loc::default();

        // Allow "in" inside arrays
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        while p.lexer.token != T::TCloseBracket {
            match p.lexer.token {
                T::TComma => {
                    items.push(Expr {
                        data: Prefill::Data::E_MISSING,
                        loc: p.lexer.loc(),
                    });
                    // PERF(port): was assume_capacity (catch unreachable on append)
                }
                T::TDotDotDot => {
                    if let Some(errors) = errors.as_deref_mut() {
                        errors.array_spread_feature = p.lexer.range();
                    }

                    let dots_loc = p.lexer.loc();
                    p.lexer.next()?;
                    // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
                    // then bumped len; here we parse into a local then push.
                    let mut value = Expr::empty();
                    p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut value)?;
                    items.push(p.new_expr(E::Spread { value }, dots_loc));

                    // Commas are not allowed here when destructuring
                    if p.lexer.token == T::TComma {
                        comma_after_spread = p.lexer.loc();
                    }
                }
                _ => {
                    // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
                    let mut item = Expr::empty();
                    p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut item)?;
                    items.push(item);
                }
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
        Ok(p.new_expr(
            E::Array {
                items: ExprNodeList::move_from_list(&mut items),
                comma_after_spread: comma_after_spread.to_nullable(),
                is_single_line,
                close_bracket_loc,
            },
            loc,
        ))
    }

    fn t_open_brace(p: &mut Self::P, errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let mut is_single_line = !p.lexer.has_newline_before;
        // PERF(port): was arena-backed ArrayList — profile in Phase B
        let mut properties: bumpalo::collections::Vec<'_, G::Property> =
            bumpalo::collections::Vec::new_in(p.allocator);
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread: logger::Loc = logger::Loc::default();

        // Allow "in" inside object literals
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        while p.lexer.token != T::TCloseBrace {
            if p.lexer.token == T::TDotDotDot {
                p.lexer.next()?;
                // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
                // with `value: Expr.empty` then parsed into &property.value.?
                let mut value = Expr::empty();
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
                if let Some(prop) =
                    p.parse_property(PropertyKind::Normal, &mut property_opts, &mut self_errors)?
                {
                    if cfg!(debug_assertions) {
                        debug_assert!(prop.key.is_some() || prop.value.is_some());
                    }
                    properties.push(prop);
                    // PERF(port): was assume_capacity (catch unreachable on append)
                }
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

        Ok(p.new_expr(
            E::Object {
                properties: G::Property::List::move_from_list(&mut properties),
                comma_after_spread: if comma_after_spread.start > 0 {
                    Some(comma_after_spread)
                } else {
                    None
                },
                is_single_line,
                close_brace_loc,
            },
            loc,
        ))
    }

    fn t_less_than(
        p: &mut Self::P,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        flags: Expr::EFlags,
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
        // PERF(port): was comptime monomorphization — profile in Phase B
        if Self::IS_TYPESCRIPT_ENABLED && Self::IS_JSX_ENABLED {
            if TypeScript::is_ts_arrow_fn_jsx(p)? {
                let _ = p.skip_type_script_type_parameters(TypeParameterFlag {
                    allow_const_modifier: true,
                    ..Default::default()
                })?;
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

        if Self::IS_JSX_ENABLED {
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

            // "<T>(x)"
            // "<T>(x) => {}"
            match p.try_skip_type_script_type_parameters_then_open_paren_with_backtracking() {
                SkipTypeParametersResult::DidNotSkipAnything => {}
                result => {
                    p.lexer.expect(T::TOpenParen)?;
                    return p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParametersResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    );
                }
            }

            // "<T>x"
            p.lexer.next()?;
            p.skip_type_script_type(Level::Lowest)?;
            p.lexer.expect_greater_than(false)?;
            return p.parse_prefix(level, errors, flags);
        }

        p.lexer.unexpected()?;
        Err(bun_core::err!("SyntaxError"))
    }

    fn t_import(p: &mut Self::P, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        p.parse_import_expr(loc, level)
    }

    // Before splitting this up, this used 3 KB of stack space per call.
    pub fn parse_prefix(
        p: &mut Self::P,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        flags: Expr::EFlags,
    ) -> PResult<Expr> {
        match p.lexer.token {
            T::TOpenBracket => Self::t_open_bracket(p, errors),
            T::TOpenBrace => Self::t_open_brace(p, errors),
            T::TLessThan => Self::t_less_than(p, level, errors, flags),
            T::TImport => Self::t_import(p, level),
            T::TOpenParen => Self::t_open_paren(p, level),
            T::TPrivateIdentifier => Self::t_private_identifier(p, level),
            T::TIdentifier => Self::t_identifier(p, level),
            T::TFalse => Self::t_false(p),
            T::TTrue => Self::t_true(p),
            T::TNull => Self::t_null(p),
            T::TThis => Self::t_this(p),
            T::TTemplateHead => Self::t_template_head(p),
            T::TNumericLiteral => Self::t_numeric_literal(p),
            T::TBigIntegerLiteral => Self::t_big_integer_literal(p),
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => p.parse_string_literal(),
            T::TSlashEquals | T::TSlash => Self::t_slash(p),
            T::TVoid => Self::t_void(p),
            T::TTypeof => Self::t_typeof(p),
            T::TDelete => Self::t_delete(p),
            T::TPlus => Self::t_plus(p),
            T::TMinus => Self::t_minus(p),
            T::TTilde => Self::t_tilde(p),
            T::TExclamation => Self::t_exclamation(p),
            T::TMinusMinus => Self::t_minus_minus(p),
            T::TPlusPlus => Self::t_plus_plus(p),
            T::TFunction => Self::t_function(p),
            T::TClass => Self::t_class(p),
            T::TAt => Self::t_at(p),
            T::TNew => Self::t_new(p, flags),
            T::TSuper => Self::t_super(p, level),
            _ => {
                // PERF(port): @branchHint(.cold) — profile in Phase B
                p.lexer.unexpected()?;
                Err(bun_core::err!("SyntaxError"))
            }
        }
    }
}

// TODO(port): these are referenced from sibling modules in the Zig; Phase B wires the real paths.
use crate::js_ast::Expr::Data as ExprData;
use crate::js_ast::E::Unary::Flags as UnaryFlags;
use crate::js_ast::E::Template::Head as TemplateHead;
use crate::js_ast::G::Property::Kind as PropertyKind;
use crate::js_ast::Op;
use crate::js_ast::Symbol::Kind as SymbolKind;
use crate::Scope::Kind as ScopeKind;
use crate::FnOrArrowDataParse::{AllowAwait, AllowYield};
use crate::SkipTypeParametersResult;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parsePrefix.zig (831 lines)
//   confidence: medium
//   todos:      6
//   notes:      inherent associated type `P` is unstable; t_new/t_open_bracket/t_open_brace reshaped from in-place unusedCapacitySlice writes; t_slash defer-reset uses scopeguard for error-path parity
// ──────────────────────────────────────────────────────────────────────────
