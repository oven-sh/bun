#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    clippy::single_match
)]
#![warn(unused_must_use)]
use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;
use bun_core::strings;

use crate::lexer::T;
use crate::p::P;
use crate::parser::{
    AsyncPrefixExpression, AwaitOrYield, DeferredErrors, FnOrArrowDataParse, ParenExprOpts,
    ParseClassOptions, PropertyOpts, SkipTypeParameterResult, TypeParameterFlag, prefill,
};
use bun_ast::e::UnaryFlags;
use bun_ast::expr::EFlags;
use bun_ast::g::{Arg, Property, PropertyKind};
use bun_ast::op::Level;
use bun_ast::{self as js_ast, B, E, Expr, ExprData, ExprNodeList, G, OpCode, scope, symbol};

// TODO(port): narrow error set — Zig used `anyerror!Expr` throughout
type PResult<T> = core::result::Result<T, bun_core::Error>;

// Zig: `fn ParsePrefix(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block. The 30+ per-token `t_*` helpers are private; only `parse_prefix` is
// surfaced. Round-G un-gates the per-token bodies (same JsxT pattern as parseStmt.rs); helper
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
            _ => {}
        }

        p.log()
            .add_range_error(Some(p.source), super_range, b"Unexpected \"super\"");
        Ok(p.new_expr(E::Super {}, loc))
    }

    fn pfx_t_open_paren(p: &mut Self, level: Level) -> PResult<Expr> {
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

    fn pfx_t_identifier(p: &mut Self, level: Level) -> PResult<Expr> {
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
            (p.lexer.range(), p.lexer.raw())
        };

        p.lexer.next()?;

        // Handle async and await expressions
        match async_kind {
            AsyncPrefixExpression::IsAsync => {
                if (raw.as_ptr() == name.as_ptr() && raw.len() == name.len())
                    || AsyncPrefixExpression::find(raw) == AsyncPrefixExpression::IsAsync
                {
                    return p.parse_async_prefix_expr(name_range, level);
                }
            }

            AsyncPrefixExpression::IsAwait => match p.fn_or_arrow_data_parse.allow_await {
                AwaitOrYield::ForbidAll => {
                    p.log().add_range_error(
                        Some(p.source),
                        name_range,
                        b"The keyword \"await\" cannot be used here",
                    );
                }
                AwaitOrYield::AllowExpr => {
                    if AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsAwait {
                        p.log().add_range_error(
                            Some(p.source),
                            name_range,
                            b"The keyword \"await\" cannot be escaped",
                        );
                    } else {
                        if p.fn_or_arrow_data_parse.is_top_level {
                            p.top_level_await_keyword = name_range;
                        }

                        if p.fn_or_arrow_data_parse.track_arrow_arg_errors {
                            p.fn_or_arrow_data_parse.arrow_arg_errors.invalid_expr_await =
                                name_range;
                        }

                        let value = p.parse_expr(Level::Prefix)?;
                        if p.lexer.token == T::TAsteriskAsterisk {
                            p.lexer.unexpected()?;
                            return Err(bun_core::err!("SyntaxError"));
                        }

                        return Ok(p.new_expr(E::Await { value }, loc));
                    }
                }
                AwaitOrYield::AllowIdent => {
                    p.lexer.prev_token_was_await_keyword = true;
                    p.lexer.await_keyword_loc = name_range.loc;
                    p.lexer.fn_or_arrow_start_loc = p.fn_or_arrow_data_parse.needs_async_loc;
                }
            },

            AsyncPrefixExpression::IsYield => {
                match p.fn_or_arrow_data_parse.allow_yield {
                    AwaitOrYield::ForbidAll => {
                        p.log().add_range_error(
                            Some(p.source),
                            name_range,
                            b"The keyword \"yield\" cannot be used here",
                        );
                    }
                    AwaitOrYield::AllowExpr => {
                        if AsyncPrefixExpression::find(raw) != AsyncPrefixExpression::IsYield {
                            p.log().add_range_error(
                                Some(p.source),
                                name_range,
                                b"The keyword \"yield\" cannot be escaped",
                            );
                        } else {
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
            let ref_ = p.store_name_in_ref(name).expect("unreachable");
            // PORT NOTE: reshaped for borrowck — build binding before borrowing arena.
            // `Arg` is non-Copy (owns Vec) → use fill_iter instead of alloc_slice_copy.
            let binding = p.b(B::Identifier { r#ref: ref_ }, loc);
            let args = p.arena.alloc_slice_fill_iter([Arg {
                binding,
                ..Default::default()
            }]);

            let _ = p
                .push_scope_for_parse_pass(scope::Kind::FunctionArgs, loc)
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
        let value = p.new_expr(
            E::Number {
                value: p.lexer.number,
            },
            loc,
        );
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
        // PORT NOTE: Zig `defer p.lexer.regex_flags_start = null` — reset after both success and
        // the `next()?` error path. Reshaped: capture, advance, then unconditionally reset before
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

    fn pfx_t_void(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
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

    fn pfx_t_typeof(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
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

    fn pfx_t_delete(p: &mut Self) -> PResult<Expr> {
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
        // Zig: `value.isPropertyAccess()` — `.e_dot, .e_index => true`.
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

    fn pfx_t_plus(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
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

    fn pfx_t_minus(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
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

    fn pfx_t_tilde(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
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

    fn pfx_t_exclamation(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let value = p.parse_expr(Level::Prefix)?;
        if p.lexer.token == T::TAsteriskAsterisk {
            p.lexer.unexpected()?;
            return Err(bun_core::err!("SyntaxError"));
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
        let value = p.parse_expr(Level::Prefix)?;
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
        let value = p.parse_expr(Level::Prefix)?;
        Ok(p.new_expr(
            E::Unary {
                op: OpCode::UnPreInc,
                value,
                flags: UnaryFlags::default(),
            },
            loc,
        ))
    }

    #[inline]
    fn pfx_t_function(p: &mut Self) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.parse_fn_expr(loc, false, bun_ast::Range::NONE)
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
            if !Self::IS_TYPESCRIPT_ENABLED || name_text != b"implements" {
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
                    ref_: Some(
                        p.new_symbol(symbol::Kind::Other, name_text)
                            .expect("unreachable"),
                    ),
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
            ParseClassOptions {
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
            .push_scope_for_parse_pass(scope::Kind::ClassName, loc)
            .expect("unreachable");

        // Parse an optional class name
        if p.lexer.token == T::TIdentifier {
            let name_text = p.lexer.identifier;
            if !Self::IS_TYPESCRIPT_ENABLED || name_text != b"implements" {
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
                    ref_: Some(
                        p.new_symbol(symbol::Kind::Other, name_text)
                            .expect("unreachable"),
                    ),
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

        // PORT NOTE: spec passes the arena-backed `[]ExprNodeIndex` slice directly into
        // `ParseClassOptions{.ts_decorators = ts_decorators}`. `ParseClassOptions::ts_decorators`
        // is currently typed `&'a [Expr]` (parser.rs), so until that field is widened to
        // `ExprNodeList` we copy into the arena (Expr is `Copy`) and let `ts_decorators` drop
        // normally — no `mem::forget` / `from_raw_parts` lifetime laundering (forbidden per
        // PORTING.md §Forbidden patterns; would leak heap when origin is `Owned`).
        let ts_decorators_slice: &'a [Expr] = p.arena.alloc_slice_copy(ts_decorators.slice());

        let class = p.parse_class(
            class_keyword,
            name,
            ParseClassOptions {
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
                p.lexer.unexpected()?;
                return Err(bun_core::err!("SyntaxError"));
            }
            let range = bun_ast::Range {
                loc,
                len: p.lexer.range().end().start - loc.start,
            };

            p.lexer.next()?;
            return Ok(p.new_expr(E::NewTarget { range }, loc));
        }

        // This will become the new expr
        // PORT NOTE: Zig allocates E::New with undefined fields then fills via the arena
        // pointer. Reshaped: parse target into a local, then construct E::New once.
        let mut target = Expr::EMPTY;
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

    fn pfx_t_open_bracket(p: &mut Self, mut errors: Option<&mut DeferredErrors>) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let mut is_single_line = !p.lexer.has_newline_before;
        // PERF(port): was arena-backed ArrayList — profile in Phase B
        let mut items: bun_alloc::ArenaVec<'_, Expr> = bun_alloc::ArenaVec::new_in(p.arena);
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread = bun_ast::Loc::default();

        // Allow "in" inside arrays
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        while p.lexer.token != T::TCloseBracket {
            match p.lexer.token {
                T::TComma => {
                    items.push(Expr {
                        data: ExprData::EMissing(E::Missing {}),
                        loc: p.lexer.loc(),
                    });
                    // PERF(port): was assume_capacity (catch unreachable on append)
                }
                T::TDotDotDot => {
                    if let Some(e) = errors.as_deref_mut() {
                        e.array_spread_feature = Some(p.lexer.range());
                    }

                    let dots_loc = p.lexer.loc();
                    p.lexer.next()?;
                    // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
                    // then bumped len; here we parse into a local then push.
                    let mut value = Expr::EMPTY;
                    p.parse_expr_or_bindings(Level::Comma, Some(&mut self_errors), &mut value)?;
                    items.push(p.new_expr(E::Spread { value }, dots_loc));

                    // Commas are not allowed here when destructuring
                    if p.lexer.token == T::TComma {
                        comma_after_spread = p.lexer.loc();
                    }
                }
                _ => {
                    // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
                    let mut item = Expr::EMPTY;
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
        let items_list = ExprNodeList::from_bump_vec(items);
        Ok(p.new_expr(
            E::Array {
                items: items_list,
                comma_after_spread: comma_after_spread.to_nullable(),
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
        // PERF(port): was arena-backed ArrayList — profile in Phase B
        let mut properties: bun_alloc::ArenaVec<'_, G::Property> =
            bun_alloc::ArenaVec::new_in(p.arena);
        let mut self_errors = DeferredErrors::default();
        let mut comma_after_spread: bun_ast::Loc = bun_ast::Loc::default();

        // Allow "in" inside object literals
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        while p.lexer.token != T::TCloseBrace {
            if p.lexer.token == T::TDotDotDot {
                p.lexer.next()?;
                // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
                // with `value: Expr.empty` then parsed into &property.value.?
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

        // PORT NOTE: BumpVec → Vec via arena slice; see pfx_t_open_bracket.
        let properties_list = G::PropertyList::from_bump_vec(properties);
        Ok(p.new_expr(
            E::Object {
                properties: properties_list,
                comma_after_spread: if comma_after_spread.start > 0 {
                    Some(comma_after_spread)
                } else {
                    None
                },
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
        // PERF(port): was comptime monomorphization — profile in Phase B
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
                SkipTypeParameterResult::DidNotSkipAnything => {}
                result => {
                    p.lexer.expect(T::TOpenParen)?;
                    return p.parse_paren_expr(
                        loc,
                        level,
                        ParenExprOpts {
                            force_arrow_fn: result
                                == SkipTypeParameterResult::DefinitelyTypeParameters,
                            ..Default::default()
                        },
                    );
                }
            }

            // "<T>x"
            p.lexer.next()?;
            p.skip_type_script_type(Level::Lowest)?;
            p.lexer.expect_greater_than::<false>()?;
            return p.parse_prefix(level, errors, flags);
        }

        p.lexer.unexpected()?;
        Err(bun_core::err!("SyntaxError"))
    }

    #[inline]
    fn pfx_t_import(p: &mut Self, level: Level) -> PResult<Expr> {
        let loc = p.lexer.loc();
        p.lexer.next()?;
        p.parse_import_expr(loc, level)
    }

    // Before splitting this up, this used 3 KB of stack space per call.
    pub fn parse_prefix(
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
            T::TOpenParen => Self::pfx_t_open_paren(p, level),
            T::TPrivateIdentifier => Self::pfx_t_private_identifier(p, level),
            T::TIdentifier => Self::pfx_t_identifier(p, level),
            T::TFalse => Self::pfx_t_false(p),
            T::TTrue => Self::pfx_t_true(p),
            T::TNull => Self::pfx_t_null(p),
            T::TThis => Self::pfx_t_this(p),
            T::TTemplateHead => Self::pfx_t_template_head(p),
            T::TNumericLiteral => Self::pfx_t_numeric_literal(p),
            T::TBigIntegerLiteral => Self::pfx_t_big_integer_literal(p),
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => p.parse_string_literal(),
            T::TSlashEquals | T::TSlash => Self::pfx_t_slash(p),
            T::TVoid => Self::pfx_t_void(p),
            T::TTypeof => Self::pfx_t_typeof(p),
            T::TDelete => Self::pfx_t_delete(p),
            T::TPlus => Self::pfx_t_plus(p),
            T::TMinus => Self::pfx_t_minus(p),
            T::TTilde => Self::pfx_t_tilde(p),
            T::TExclamation => Self::pfx_t_exclamation(p),
            T::TMinusMinus => Self::pfx_t_minus_minus(p),
            T::TPlusPlus => Self::pfx_t_plus_plus(p),
            T::TFunction => Self::pfx_t_function(p),
            T::TClass => Self::pfx_t_class(p),
            T::TAt => Self::pfx_t_at(p),
            T::TNew => Self::pfx_t_new(p, flags),
            T::TSuper => Self::pfx_t_super(p, level),
            _ => {
                // PERF(port): @branchHint(.cold) — profile in Phase B
                p.lexer.unexpected()?;
                Err(bun_core::err!("SyntaxError"))
            }
        }
    }
}

// ported from: src/js_parser/ast/parsePrefix.zig
