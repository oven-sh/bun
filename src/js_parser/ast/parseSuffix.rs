use bun_core::{err, Error};
use bun_js_parser::ast::{self as js_ast, E, Expr, Op, OptionalChain};
use bun_js_parser::ast::op::Level;
use bun_js_parser::ast::expr::EFlags;
use bun_js_parser::lexer::T;
use bun_js_parser::{self as js_parser, DeferredErrors, JSXTransformType, SideEffects};

// Zig: `fn ParseSuffix(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// Rust: zero-sized struct carrying the const-generic feature flags; all fns are associated.
pub struct ParseSuffix<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

// TODO(port): inherent associated types are unstable; module-level alias used instead.
type P<const TS: bool, const JSX: JSXTransformType, const SO: bool> =
    js_parser::NewParser_<TS, JSX, SO>;

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > ParseSuffix<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    // Zig: `const is_typescript_enabled = P.is_typescript_enabled;`
    // TODO(port): verify this equals NewParser_::IS_TYPESCRIPT_ENABLED (it should — derived from the same flag).
    const IS_TYPESCRIPT_ENABLED: bool = PARSER_FEATURE_TYPESCRIPT;

    fn handle_typescript_as(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
    ) -> Result<Continuation, Error> {
        if Self::IS_TYPESCRIPT_ENABLED
            && level.lt(Level::Compare)
            && !p.lexer.has_newline_before
            && (p.lexer.is_contextual_keyword(b"as") || p.lexer.is_contextual_keyword(b"satisfies"))
        {
            p.lexer.next()?;
            p.skip_type_script_type(Level::Lowest)?;

            // These tokens are not allowed to follow a cast expression. This isn't
            // an outright error because it may be on a new line, in which case it's
            // the start of a new expression when it's after a cast:
            //
            //   x = y as z
            //   (something);
            //
            match p.lexer.token {
                T::TPlusPlus
                | T::TMinusMinus
                | T::TNoSubstitutionTemplateLiteral
                | T::TTemplateHead
                | T::TOpenParen
                | T::TOpenBracket
                | T::TQuestionDot => {
                    p.forbid_suffix_after_as_loc = p.lexer.loc();
                    return Ok(Continuation::Done);
                }
                _ => {}
            }

            if p.lexer.token.is_assign() {
                p.forbid_suffix_after_as_loc = p.lexer.loc();
                return Ok(Continuation::Done);
            }
            return Ok(Continuation::Next);
        }
        Ok(Continuation::Done)
    }

    fn t_dot(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        p.lexer.next()?;
        let target = *left;

        if p.lexer.token == T::TPrivateIdentifier && p.allow_private_identifiers {
            // "a.#b"
            // "a?.b.#c"
            if matches!(left.data, js_ast::expr::Data::ESuper(_)) {
                p.lexer.expected(T::TIdentifier)?;
            }

            let name = p.lexer.identifier;
            let name_loc = p.lexer.loc();
            p.lexer.next()?;
            let r#ref = p.store_name_in_ref(name).expect("unreachable");
            let loc = left.loc;
            *left = p.new_expr(
                E::Index {
                    target,
                    index: p.new_expr(E::PrivateIdentifier { r#ref }, name_loc),
                    optional_chain: old_optional_chain,
                },
                loc,
            );
        } else {
            // "a.b"
            // "a?.b.c"
            if !p.lexer.is_identifier_or_keyword() {
                p.lexer.expect(T::TIdentifier)?;
            }

            let name = p.lexer.identifier;
            let name_loc = p.lexer.loc();
            p.lexer.next()?;

            let loc = left.loc;
            *left = p.new_expr(
                E::Dot {
                    target,
                    name,
                    name_loc,
                    optional_chain: old_optional_chain,
                },
                loc,
            );
        }
        *optional_chain = old_optional_chain;
        Ok(Continuation::Next)
    }

    fn t_question_dot(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        p.lexer.next()?;
        let mut optional_start: Option<OptionalChain> = Some(OptionalChain::Start);

        // Remove unnecessary optional chains
        if p.options.features.minify_syntax {
            let result = SideEffects::to_null_or_undefined(p, left.data);
            if result.ok && !result.value {
                optional_start = None;
            }
        }

        match p.lexer.token {
            T::TOpenBracket => {
                // "a?.[b]"
                p.lexer.next()?;

                // allow "in" inside the brackets;
                let old_allow_in = p.allow_in;
                p.allow_in = true;

                let index = p.parse_expr(Level::Lowest)?;

                p.allow_in = old_allow_in;

                p.lexer.expect(T::TCloseBracket)?;
                let loc = left.loc;
                let target = *left;
                *left = p.new_expr(
                    E::Index {
                        target,
                        index,
                        optional_chain: optional_start,
                    },
                    loc,
                );
            }

            T::TOpenParen => {
                // "a?.()"
                if level.gte(Level::Call) {
                    return Ok(Continuation::Done);
                }

                let list_loc = p.parse_call_args()?;
                let loc = left.loc;
                let target = *left;
                *left = p.new_expr(
                    E::Call {
                        target,
                        args: list_loc.list,
                        close_paren_loc: list_loc.loc,
                        optional_chain: optional_start,
                    },
                    loc,
                );
            }
            T::TLessThan | T::TLessThanLessThan => {
                // "a?.<T>()"
                if !Self::IS_TYPESCRIPT_ENABLED {
                    p.lexer.expected(T::TIdentifier)?;
                    return Err(err!("SyntaxError"));
                }

                let _ = p.skip_type_script_type_arguments(false)?;
                if p.lexer.token != T::TOpenParen {
                    p.lexer.expected(T::TOpenParen)?;
                }

                if level.gte(Level::Call) {
                    return Ok(Continuation::Done);
                }

                let list_loc = p.parse_call_args()?;
                let loc = left.loc;
                let target = *left;
                *left = p.new_expr(
                    E::Call {
                        target,
                        args: list_loc.list,
                        close_paren_loc: list_loc.loc,
                        optional_chain: optional_start,
                    },
                    loc,
                );
            }
            _ => {
                if p.lexer.token == T::TPrivateIdentifier && p.allow_private_identifiers {
                    // "a?.#b"
                    let name = p.lexer.identifier;
                    let name_loc = p.lexer.loc();
                    p.lexer.next()?;
                    let r#ref = p.store_name_in_ref(name).expect("unreachable");
                    let loc = left.loc;
                    let target = *left;
                    *left = p.new_expr(
                        E::Index {
                            target,
                            index: p.new_expr(E::PrivateIdentifier { r#ref }, name_loc),
                            optional_chain: optional_start,
                        },
                        loc,
                    );
                } else {
                    // "a?.b"
                    if !p.lexer.is_identifier_or_keyword() {
                        p.lexer.expect(T::TIdentifier)?;
                    }
                    let name = p.lexer.identifier;
                    let name_loc = p.lexer.loc();
                    p.lexer.next()?;

                    let loc = left.loc;
                    let target = *left;
                    *left = p.new_expr(
                        E::Dot {
                            target,
                            name,
                            name_loc,
                            optional_chain: optional_start,
                        },
                        loc,
                    );
                }
            }
        }

        // Only continue if we have started
        if optional_start.unwrap_or(OptionalChain::Continuation) == OptionalChain::Start {
            *optional_chain = Some(OptionalChain::Continuation);
        }

        Ok(Continuation::Next)
    }

    fn t_no_substitution_template_literal(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        _level: Level,
        _optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if old_optional_chain.is_some() {
            p.log
                .add_range_error(
                    p.source,
                    p.lexer.range(),
                    b"Template literals cannot have an optional chain as a tag",
                )
                .expect("unreachable");
        }
        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
        let head = p.lexer.raw_template_contents();
        p.lexer.next()?;

        let loc = left.loc;
        let tag = *left;
        *left = p.new_expr(
            E::Template {
                tag,
                // TODO(port): exact head constructor name (`.{ .raw = head }` in Zig)
                head: E::TemplateData::raw(head),
                ..Default::default()
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_template_head(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        _level: Level,
        _optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if old_optional_chain.is_some() {
            p.log
                .add_range_error(
                    p.source,
                    p.lexer.range(),
                    b"Template literals cannot have an optional chain as a tag",
                )
                .expect("unreachable");
        }
        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
        let head = p.lexer.raw_template_contents();
        let parts_group = p.parse_template_parts(true)?;
        let tag = *left;
        let loc = left.loc;
        *left = p.new_expr(
            E::Template {
                tag,
                // TODO(port): exact head constructor name (`.{ .raw = head }` in Zig)
                head: E::TemplateData::raw(head),
                parts: parts_group,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_open_bracket(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
        flags: EFlags,
    ) -> Result<Continuation, Error> {
        // When parsing a decorator, ignore EIndex expressions since they may be
        // part of a computed property:
        //
        //   class Foo {
        //     @foo ['computed']() {}
        //   }
        //
        // This matches the behavior of the TypeScript compiler.
        if flags == EFlags::TsDecorator {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;

        // Allow "in" inside the brackets
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        let index = p.parse_expr(Level::Lowest)?;

        p.allow_in = old_allow_in;

        p.lexer.expect(T::TCloseBracket)?;

        let loc = left.loc;
        let target = *left;
        *left = p.new_expr(
            E::Index {
                target,
                index,
                optional_chain: old_optional_chain,
            },
            loc,
        );
        *optional_chain = old_optional_chain;
        Ok(Continuation::Next)
    }

    fn t_open_paren(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Call) {
            return Ok(Continuation::Done);
        }

        let list_loc = p.parse_call_args()?;
        let loc = left.loc;
        let target = *left;
        *left = p.new_expr(
            E::Call {
                target,
                args: list_loc.list,
                close_paren_loc: list_loc.loc,
                optional_chain: old_optional_chain,
            },
            loc,
        );
        *optional_chain = old_optional_chain;
        Ok(Continuation::Next)
    }

    fn t_question(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Conditional) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;

        // Stop now if we're parsing one of these:
        // "(a?) => {}"
        // "(a?: b) => {}"
        // "(a?, b?) => {}"
        if Self::IS_TYPESCRIPT_ENABLED
            && left.loc.start == p.latest_arrow_arg_loc.start
            && (p.lexer.token == T::TColon
                || p.lexer.token == T::TCloseParen
                || p.lexer.token == T::TComma)
        {
            let Some(errors) = errors else {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            };
            errors.invalid_expr_after_question = p.lexer.range();
            return Ok(Continuation::Done);
        }

        let loc = left.loc;
        let prev = *left;
        // TODO(port): Zig used `undefined` for yes/no then filled via `&ternary.data.e_if.{yes,no}`.
        // Need a mutable accessor into the arena-allocated E::If payload.
        let ternary = p.new_expr(
            E::If {
                test_: prev,
                yes: Expr::empty(),
                no: Expr::empty(),
            },
            loc,
        );

        // Allow "in" in between "?" and ":"
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        // condition ? yes : no
        //             ^
        // TODO(port): `ternary.data.e_if` accessor — Phase B must expose `as_e_if_mut()` or equivalent
        p.parse_expr_with_flags(Level::Comma, EFlags::None, &mut ternary.data.e_if_mut().yes)?;

        p.allow_in = old_allow_in;

        // condition ? yes : no
        //                 ^
        p.lexer.expect(T::TColon)?;

        // condition ? yes : no
        //                   ^
        p.parse_expr_with_flags(Level::Comma, EFlags::None, &mut ternary.data.e_if_mut().no)?;

        // condition ? yes : no
        //                     ^

        *left = ternary;
        Ok(Continuation::Next)
    }

    fn t_exclamation(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
    ) -> Result<Continuation, Error> {
        // Skip over TypeScript non-null assertions
        if p.lexer.has_newline_before {
            return Ok(Continuation::Done);
        }

        if !Self::IS_TYPESCRIPT_ENABLED {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }

        p.lexer.next()?;
        *optional_chain = old_optional_chain;

        Ok(Continuation::Next)
    }

    fn t_minus_minus(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if p.lexer.has_newline_before || level.gte(Level::Postfix) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let value = *left;
        *left = p.new_expr(E::Unary { op: Op::Code::UnPostDec, value }, loc);
        Ok(Continuation::Next)
    }

    fn t_plus_plus(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if p.lexer.has_newline_before || level.gte(Level::Postfix) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let value = *left;
        *left = p.new_expr(E::Unary { op: Op::Code::UnPostInc, value }, loc);
        Ok(Continuation::Next)
    }

    fn t_comma(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Comma) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinComma, left: prev, right: p.parse_expr(Level::Comma)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_plus(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Add) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinAdd, left: prev, right: p.parse_expr(Level::Add)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_plus_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        // PORT NOTE: Zig wrote `@enumFromInt(@intFromEnum(Op.Level.assign) - 1)`; equivalent to `Level::Assign.sub(1)`.
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinAddAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_minus(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Add) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinSub, left: prev, right: p.parse_expr(Level::Add)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_minus_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinSubAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_asterisk(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Multiply) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinMul, left: prev, right: p.parse_expr(Level::Multiply)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_asterisk_asterisk(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Exponentiation) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinPow, left: prev, right: p.parse_expr(Level::Exponentiation.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_asterisk_asterisk_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinPowAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_asterisk_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinMulAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_percent(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Multiply) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinRem, left: prev, right: p.parse_expr(Level::Multiply)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_percent_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinRemAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_slash(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Multiply) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinDiv, left: prev, right: p.parse_expr(Level::Multiply)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_slash_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinDivAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_equals_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLooseEq, left: prev, right: p.parse_expr(Level::Equals)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_exclamation_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLooseNe, left: prev, right: p.parse_expr(Level::Equals)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_equals_equals_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinStrictEq, left: prev, right: p.parse_expr(Level::Equals)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_exclamation_equals_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinStrictNe, left: prev, right: p.parse_expr(Level::Equals)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_less_than(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        // TypeScript allows type arguments to be specified with angle brackets
        // inside an expression. Unlike in other languages, this unfortunately
        // appears to require backtracking to parse.
        if Self::IS_TYPESCRIPT_ENABLED && p.try_skip_type_script_type_arguments_with_backtracking() {
            *optional_chain = old_optional_chain;
            return Ok(Continuation::Next);
        }

        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLt, left: prev, right: p.parse_expr(Level::Compare)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_less_than_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLe, left: prev, right: p.parse_expr(Level::Compare)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_greater_than(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinGt, left: prev, right: p.parse_expr(Level::Compare)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_greater_than_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinGe, left: prev, right: p.parse_expr(Level::Compare)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_less_than_less_than(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        // TypeScript allows type arguments to be specified with angle brackets
        // inside an expression. Unlike in other languages, this unfortunately
        // appears to require backtracking to parse.
        if Self::IS_TYPESCRIPT_ENABLED && p.try_skip_type_script_type_arguments_with_backtracking() {
            *optional_chain = old_optional_chain;
            return Ok(Continuation::Next);
        }

        if level.gte(Level::Shift) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinShl, left: prev, right: p.parse_expr(Level::Shift)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_less_than_less_than_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinShlAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_greater_than_greater_than(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Shift) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinShr, left: prev, right: p.parse_expr(Level::Shift)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_greater_than_greater_than_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinShrAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_greater_than_greater_than_greater_than(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Shift) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinUShr, left: prev, right: p.parse_expr(Level::Shift)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_greater_than_greater_than_greater_than_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinUShrAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_question_question(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::NullishCoalescing) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let prev = *left;
        let loc = left.loc;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinNullishCoalescing, left: prev, right: p.parse_expr(Level::NullishCoalescing)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_question_question_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinNullishCoalescingAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_bar_bar(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::LogicalOr) {
            return Ok(Continuation::Done);
        }

        // Prevent "||" inside "??" from the right
        if level.eql(Level::NullishCoalescing) {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }

        p.lexer.next()?;
        let right = p.parse_expr(Level::LogicalOr)?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(E::Binary { op: Op::Code::BinLogicalOr, left: prev, right }, loc);

        if level.lt(Level::NullishCoalescing) {
            Self::parse_suffix(p, left, Level::NullishCoalescing.add_f(1), None, flags)?;

            if p.lexer.token == T::TQuestionQuestion {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }
        }
        Ok(Continuation::Next)
    }

    fn t_bar_bar_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLogicalOrAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_ampersand_ampersand(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::LogicalAnd) {
            return Ok(Continuation::Done);
        }

        // Prevent "&&" inside "??" from the right
        if level.eql(Level::NullishCoalescing) {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLogicalAnd, left: prev, right: p.parse_expr(Level::LogicalAnd)? },
            loc,
        );

        // Prevent "&&" inside "??" from the left
        if level.lt(Level::NullishCoalescing) {
            Self::parse_suffix(p, left, Level::NullishCoalescing.add_f(1), None, flags)?;

            if p.lexer.token == T::TQuestionQuestion {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }
        }
        Ok(Continuation::Next)
    }

    fn t_ampersand_ampersand_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinLogicalAndAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_bar(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::BitwiseOr) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinBitwiseOr, left: prev, right: p.parse_expr(Level::BitwiseOr)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_bar_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinBitwiseOrAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_ampersand(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::BitwiseAnd) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinBitwiseAnd, left: prev, right: p.parse_expr(Level::BitwiseAnd)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_ampersand_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinBitwiseAndAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_caret(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::BitwiseXor) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinBitwiseXor, left: prev, right: p.parse_expr(Level::BitwiseXor)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_caret_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinBitwiseXorAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_equals(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;

        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinAssign, left: prev, right: p.parse_expr(Level::Assign.sub(1))? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_in(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Compare) || !p.allow_in {
            return Ok(Continuation::Done);
        }

        // Warn about "!a in b" instead of "!(a in b)"
        if let js_ast::expr::Data::EUnary(unary) = &left.data {
            if unary.op == Op::Code::UnNot {
                // TODO:
                // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
            }
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinIn, left: prev, right: p.parse_expr(Level::Compare)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn t_instanceof(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        left: &mut Expr,
    ) -> Result<Continuation, Error> {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }

        // Warn about "!a instanceof b" instead of "!(a instanceof b)". Here's an
        // example of code with this problem: https://github.com/mrdoob/three.js/pull/11182.
        if !p.options.suppress_warnings_about_weird_code {
            if let js_ast::expr::Data::EUnary(unary) = &left.data {
                if unary.op == Op::Code::UnNot {
                    // TODO:
                    // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                }
            }
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        *left = p.new_expr(
            E::Binary { op: Op::Code::BinInstanceof, left: prev, right: p.parse_expr(Level::Compare)? },
            loc,
        );
        Ok(Continuation::Next)
    }

    pub fn parse_suffix(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        left: &mut Expr,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> Result<(), Error> {
        // PORT NOTE: Zig kept a separate `left_value` local + `left = &left_value`
        // to work around a Zig codegen bug ("creates a new address to stack locals
        // each & usage"). Rust has no such bug, so we mutate `left` directly and
        // drop the trailing/deferred `left_and_out.* = left_value` writebacks.

        let mut optional_chain: Option<OptionalChain> = None;
        loop {
            if p.lexer.loc().start == p.after_arrow_body_loc.start {
                // PORT NOTE: Zig labeled-switch `next_token: switch (...) { continue :next_token ... }`
                // becomes a plain loop re-reading `p.lexer.token` each iteration.
                loop {
                    match p.lexer.token {
                        T::TComma => {
                            if level.gte(Level::Comma) {
                                return Ok(());
                            }

                            p.lexer.next()?;
                            let loc = left.loc;
                            let prev = *left;
                            *left = p.new_expr(
                                E::Binary {
                                    op: Op::Code::BinComma,
                                    left: prev,
                                    right: p.parse_expr(Level::Comma)?,
                                },
                                loc,
                            );

                            continue;
                        }
                        _ => {
                            return Ok(());
                        }
                    }
                }
            }

            if Self::IS_TYPESCRIPT_ENABLED {
                // Stop now if this token is forbidden to follow a TypeScript "as" cast
                if p.forbid_suffix_after_as_loc.start > -1
                    && p.lexer.loc().start == p.forbid_suffix_after_as_loc.start
                {
                    break;
                }
            }

            // Reset the optional chain flag by default. That way we won't accidentally
            // treat "c.d" as OptionalChainContinue in "a?.b + c.d".
            let old_optional_chain = optional_chain;
            optional_chain = None;

            // Each of these tokens are split into a function to conserve
            // stack space. Currently in Zig, the compiler does not reuse
            // stack space between scopes This means that having a large
            // function with many scopes and local variables consumes
            // enormous amounts of stack space.
            //
            // PORT NOTE: Zig used `inline ... => |tag| @field(@This(), @tagName(tag))(p, level, left)`
            // for comptime name-based dispatch. Rust has no @field/@tagName reflection, so each
            // arm is written out explicitly.
            let continuation = match p.lexer.token {
                T::TAmpersand => Self::t_ampersand(p, level, left),
                T::TAmpersandAmpersandEquals => Self::t_ampersand_ampersand_equals(p, level, left),
                T::TAmpersandEquals => Self::t_ampersand_equals(p, level, left),
                T::TAsterisk => Self::t_asterisk(p, level, left),
                T::TAsteriskAsterisk => Self::t_asterisk_asterisk(p, level, left),
                T::TAsteriskAsteriskEquals => Self::t_asterisk_asterisk_equals(p, level, left),
                T::TAsteriskEquals => Self::t_asterisk_equals(p, level, left),
                T::TBar => Self::t_bar(p, level, left),
                T::TBarBarEquals => Self::t_bar_bar_equals(p, level, left),
                T::TBarEquals => Self::t_bar_equals(p, level, left),
                T::TCaret => Self::t_caret(p, level, left),
                T::TCaretEquals => Self::t_caret_equals(p, level, left),
                T::TComma => Self::t_comma(p, level, left),
                T::TEquals => Self::t_equals(p, level, left),
                T::TEqualsEquals => Self::t_equals_equals(p, level, left),
                T::TEqualsEqualsEquals => Self::t_equals_equals_equals(p, level, left),
                T::TExclamationEquals => Self::t_exclamation_equals(p, level, left),
                T::TExclamationEqualsEquals => Self::t_exclamation_equals_equals(p, level, left),
                T::TGreaterThan => Self::t_greater_than(p, level, left),
                T::TGreaterThanEquals => Self::t_greater_than_equals(p, level, left),
                T::TGreaterThanGreaterThan => Self::t_greater_than_greater_than(p, level, left),
                T::TGreaterThanGreaterThanEquals => {
                    Self::t_greater_than_greater_than_equals(p, level, left)
                }
                T::TGreaterThanGreaterThanGreaterThan => {
                    Self::t_greater_than_greater_than_greater_than(p, level, left)
                }
                T::TGreaterThanGreaterThanGreaterThanEquals => {
                    Self::t_greater_than_greater_than_greater_than_equals(p, level, left)
                }
                T::TIn => Self::t_in(p, level, left),
                T::TInstanceof => Self::t_instanceof(p, level, left),
                T::TLessThanEquals => Self::t_less_than_equals(p, level, left),
                T::TLessThanLessThanEquals => Self::t_less_than_less_than_equals(p, level, left),
                T::TMinus => Self::t_minus(p, level, left),
                T::TMinusEquals => Self::t_minus_equals(p, level, left),
                T::TMinusMinus => Self::t_minus_minus(p, level, left),
                T::TPercent => Self::t_percent(p, level, left),
                T::TPercentEquals => Self::t_percent_equals(p, level, left),
                T::TPlus => Self::t_plus(p, level, left),
                T::TPlusEquals => Self::t_plus_equals(p, level, left),
                T::TPlusPlus => Self::t_plus_plus(p, level, left),
                T::TQuestionQuestion => Self::t_question_question(p, level, left),
                T::TQuestionQuestionEquals => Self::t_question_question_equals(p, level, left),
                T::TSlash => Self::t_slash(p, level, left),
                T::TSlashEquals => Self::t_slash_equals(p, level, left),
                T::TExclamation => Self::t_exclamation(p, &mut optional_chain, old_optional_chain),
                T::TBarBar => Self::t_bar_bar(p, level, left, flags),
                T::TAmpersandAmpersand => Self::t_ampersand_ampersand(p, level, left, flags),
                T::TQuestion => Self::t_question(p, level, errors.as_deref_mut(), left),
                T::TQuestionDot => Self::t_question_dot(p, level, &mut optional_chain, left),
                T::TTemplateHead => {
                    Self::t_template_head(p, level, &mut optional_chain, old_optional_chain, left)
                }
                T::TLessThan => {
                    Self::t_less_than(p, level, &mut optional_chain, old_optional_chain, left)
                }
                T::TOpenParen => {
                    Self::t_open_paren(p, level, &mut optional_chain, old_optional_chain, left)
                }
                T::TNoSubstitutionTemplateLiteral => Self::t_no_substitution_template_literal(
                    p,
                    level,
                    &mut optional_chain,
                    old_optional_chain,
                    left,
                ),
                T::TOpenBracket => {
                    Self::t_open_bracket(p, &mut optional_chain, old_optional_chain, left, flags)
                }
                T::TDot => Self::t_dot(p, &mut optional_chain, old_optional_chain, left),
                T::TLessThanLessThan => Self::t_less_than_less_than(
                    p,
                    level,
                    &mut optional_chain,
                    old_optional_chain,
                    left,
                ),
                _ => Self::handle_typescript_as(p, level),
            };

            match continuation? {
                Continuation::Next => {}
                Continuation::Done => break,
            }
        }

        Ok(())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Continuation {
    Next,
    Done,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseSuffix.zig (957 lines)
//   confidence: medium
//   todos:      5
//   notes:      Const-generic mixin over NewParser_; @field/@tagName dispatch expanded to explicit match arms; Zig stack-local-aliasing workaround dropped (mutate `left` directly); E::Template head ctor + E::If arena payload accessor need Phase-B wiring.
// ──────────────────────────────────────────────────────────────────────────
