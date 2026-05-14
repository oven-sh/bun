#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    clippy::single_match
)]
#![warn(unused_must_use)]
use bun_core::{Error, err};

use crate::lexer::T;
use crate::p::P;
use crate::parser::{DeferredErrors};
use crate::scan::scan_side_effects::SideEffects;
use bun_ast::expr::EFlags;
use bun_ast::op::Level;
use bun_ast::{self as js_ast, E, Expr, ExprData, Op, OpCode, OptionalChain};

// Zig: `fn ParseSuffix(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block. The 50+ per-token `t_*` helpers are private; only `parse_suffix` is
// surfaced. Round-G un-gates the per-token bodies (same JsxT pattern as parseStmt.rs).

#[derive(Clone, Copy, PartialEq, Eq)]
enum Continuation {
    Next,
    Done,
}

type CResult = core::result::Result<Continuation, Error>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    fn sfx_handle_typescript_as(p: &mut Self, level: Level) -> CResult {
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

    fn sfx_t_dot(
        p: &mut Self,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        p.lexer.next()?;
        let target = *left;

        if p.lexer.token == T::TPrivateIdentifier && p.allow_private_identifiers {
            // "a.#b"
            // "a?.b.#c"
            if matches!(left.data, ExprData::ESuper(_)) {
                p.lexer.expected(T::TIdentifier)?;
            }

            let name = p.lexer.identifier;
            let name_loc = p.lexer.loc();
            p.lexer.next()?;
            let ref_ = p.store_name_in_ref(name).expect("unreachable");
            let loc = left.loc;
            let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
            *left = p.new_expr(
                E::Index {
                    target,
                    index,
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

            // TODO(port): `E::Dot::name` is `&'static [u8]` (arena-owned slice
            // placeholder); lexer hands back `&'a [u8]`.
            let name = E::Str::new(p.lexer.identifier);
            let name_loc = p.lexer.loc();
            p.lexer.next()?;

            let loc = left.loc;
            *left = p.new_expr(
                E::Dot {
                    target,
                    name,
                    name_loc,
                    optional_chain: old_optional_chain,
                    ..Default::default()
                },
                loc,
            );
        }
        *optional_chain = old_optional_chain;
        Ok(Continuation::Next)
    }

    fn sfx_t_question_dot(
        p: &mut Self,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        p.lexer.next()?;
        let mut optional_start: Option<OptionalChain> = Some(OptionalChain::Start);

        // Remove unnecessary optional chains
        if p.options.features.minify_syntax {
            let result = SideEffects::to_null_or_undefined(p, &left.data);
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
                        ..Default::default()
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

                let _ = p.skip_type_script_type_arguments::<false>()?;
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
                        ..Default::default()
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
                    let ref_ = p.store_name_in_ref(name).expect("unreachable");
                    let loc = left.loc;
                    let target = *left;
                    let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
                    *left = p.new_expr(
                        E::Index {
                            target,
                            index,
                            optional_chain: optional_start,
                        },
                        loc,
                    );
                } else {
                    // "a?.b"
                    if !p.lexer.is_identifier_or_keyword() {
                        p.lexer.expect(T::TIdentifier)?;
                    }
                    let name = E::Str::new(p.lexer.identifier);
                    let name_loc = p.lexer.loc();
                    p.lexer.next()?;

                    let loc = left.loc;
                    let target = *left;
                    *left = p.new_expr(
                        E::Dot {
                            target,
                            name: name.into(),
                            name_loc,
                            optional_chain: optional_start,
                            ..Default::default()
                        },
                        loc,
                    );
                }
            }
        }

        // Only continue if we have started
        if optional_start == Some(OptionalChain::Start) {
            *optional_chain = Some(OptionalChain::Continuation);
        }

        Ok(Continuation::Next)
    }

    fn sfx_t_no_substitution_template_literal(
        p: &mut Self,
        _level: Level,
        _optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        if old_optional_chain.is_some() {
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"Template literals cannot have an optional chain as a tag",
            );
        }
        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
        let head = E::Str::new(p.lexer.raw_template_contents());
        p.lexer.next()?;

        let loc = left.loc;
        let tag = *left;
        *left = p.new_expr(
            E::Template {
                tag: Some(tag),
                head: E::TemplateContents::Raw(head),
                parts: E::Template::empty_parts(),
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_template_head(
        p: &mut Self,
        _level: Level,
        _optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        if old_optional_chain.is_some() {
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"Template literals cannot have an optional chain as a tag",
            );
        }
        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
        let head = E::Str::new(p.lexer.raw_template_contents());
        let (parts, _tail_loc) = p.parse_template_parts(true)?;
        let tag = *left;
        let loc = left.loc;
        *left = p.new_expr(
            E::Template {
                tag: Some(tag),
                head: E::TemplateContents::Raw(head.into()),
                parts,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_open_bracket(
        p: &mut Self,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
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

    fn sfx_t_open_paren(
        p: &mut Self,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
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
                ..Default::default()
            },
            loc,
        );
        *optional_chain = old_optional_chain;
        Ok(Continuation::Next)
    }

    fn sfx_t_question(
        p: &mut Self,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        left: &mut Expr,
    ) -> CResult {
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
            errors.invalid_expr_after_question = Some(p.lexer.range());
            return Ok(Continuation::Done);
        }

        let loc = left.loc;
        let prev = *left;
        // PORT NOTE: Zig allocates an E::If with `undefined` yes/no then writes through the
        // arena pointer (`ternary.data.e_if.yes`). The `Data::EIf(StoreRef<E::If>)` payload is a
        // boxed arena slot, so we mirror that: allocate first, then fill via DerefMut on StoreRef.
        let mut ternary = p.new_expr(
            E::If {
                test_: prev,
                yes: Expr::EMPTY,
                no: Expr::EMPTY,
            },
            loc,
        );
        let ExprData::EIf(mut e_if) = ternary.data else {
            unreachable!()
        };

        // Allow "in" in between "?" and ":"
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        // condition ? yes : no
        //             ^
        p.parse_expr_with_flags(Level::Comma, EFlags::None, &mut e_if.yes)?;

        p.allow_in = old_allow_in;

        // condition ? yes : no
        //                 ^
        p.lexer.expect(T::TColon)?;

        // condition ? yes : no
        //                   ^
        p.parse_expr_with_flags(Level::Comma, EFlags::None, &mut e_if.no)?;

        // condition ? yes : no
        //                     ^

        *left = ternary;
        Ok(Continuation::Next)
    }

    fn sfx_t_exclamation(
        p: &mut Self,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
    ) -> CResult {
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

    fn sfx_t_minus_minus(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if p.lexer.has_newline_before || level.gte(Level::Postfix) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let value = *left;
        *left = p.new_expr(
            E::Unary {
                op: OpCode::UnPostDec,
                value,
                flags: E::UnaryFlags::default(),
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_plus_plus(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if p.lexer.has_newline_before || level.gte(Level::Postfix) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let value = *left;
        *left = p.new_expr(
            E::Unary {
                op: OpCode::UnPostInc,
                value,
                flags: E::UnaryFlags::default(),
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_comma(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Comma) {
            return Ok(Continuation::Done);
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Comma)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinComma,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    // Zig used `inline` @field/@tagName comptime dispatch for the 30+ simple binary
    // operators below. Rust has no struct-field-name reflection; each is written out.
    // PORT NOTE: bodies are uniform — `if level.gte(L) {Done}; next; new Binary{op,left,right}`.

    fn sfx_t_plus(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Add) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Add)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinAdd,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_plus_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        // PORT NOTE: Zig wrote `@enumFromInt(@intFromEnum(Op.Level.assign) - 1)`; equivalent to `Level::Assign.sub(1)`.
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinAddAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_minus(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Add) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Add)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinSub,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_minus_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinSubAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_asterisk(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Multiply) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Multiply)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinMul,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_asterisk_asterisk(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Exponentiation) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Exponentiation.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinPow,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_asterisk_asterisk_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinPowAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_asterisk_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinMulAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_percent(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Multiply) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Multiply)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinRem,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_percent_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinRemAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_slash(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Multiply) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Multiply)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinDiv,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_slash_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinDivAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_equals_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Equals)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLooseEq,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_exclamation_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Equals)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLooseNe,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_equals_equals_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Equals)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinStrictEq,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_exclamation_equals_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Equals) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Equals)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinStrictNe,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_less_than(
        p: &mut Self,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        // TypeScript allows type arguments to be specified with angle brackets
        // inside an expression. Unlike in other languages, this unfortunately
        // appears to require backtracking to parse.
        if Self::IS_TYPESCRIPT_ENABLED && p.try_skip_type_script_type_arguments_with_backtracking()
        {
            *optional_chain = old_optional_chain;
            return Ok(Continuation::Next);
        }

        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Compare)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLt,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_less_than_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Compare)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLe,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_greater_than(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Compare)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinGt,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_greater_than_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Compare)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinGe,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_less_than_less_than(
        p: &mut Self,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        // TypeScript allows type arguments to be specified with angle brackets
        // inside an expression. Unlike in other languages, this unfortunately
        // appears to require backtracking to parse.
        if Self::IS_TYPESCRIPT_ENABLED && p.try_skip_type_script_type_arguments_with_backtracking()
        {
            *optional_chain = old_optional_chain;
            return Ok(Continuation::Next);
        }

        if level.gte(Level::Shift) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Shift)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinShl,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_less_than_less_than_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinShlAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_greater_than_greater_than(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Shift) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Shift)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinShr,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_greater_than_greater_than_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
    ) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinShrAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_greater_than_greater_than_greater_than(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
    ) -> CResult {
        if level.gte(Level::Shift) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Shift)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinUShr,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_greater_than_greater_than_greater_than_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
    ) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinUShrAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_question_question(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::NullishCoalescing) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let prev = *left;
        let loc = left.loc;
        let right = p.parse_expr(Level::NullishCoalescing)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinNullishCoalescing,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_question_question_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinNullishCoalescingAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_bar_bar(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
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
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLogicalOr,
                left: prev,
                right,
            },
            loc,
        );

        if level.lt(Level::NullishCoalescing) {
            p.parse_suffix(left, Level::NullishCoalescing.add_f(1), None, flags)?;

            if p.lexer.token == T::TQuestionQuestion {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }
        }
        Ok(Continuation::Next)
    }

    fn sfx_t_bar_bar_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLogicalOrAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_ampersand_ampersand(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
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
        let right = p.parse_expr(Level::LogicalAnd)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLogicalAnd,
                left: prev,
                right,
            },
            loc,
        );

        // Prevent "&&" inside "??" from the left
        if level.lt(Level::NullishCoalescing) {
            p.parse_suffix(left, Level::NullishCoalescing.add_f(1), None, flags)?;

            if p.lexer.token == T::TQuestionQuestion {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }
        }
        Ok(Continuation::Next)
    }

    fn sfx_t_ampersand_ampersand_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinLogicalAndAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_bar(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::BitwiseOr) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::BitwiseOr)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinBitwiseOr,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_bar_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinBitwiseOrAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_ampersand(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::BitwiseAnd) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::BitwiseAnd)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinBitwiseAnd,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_ampersand_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinBitwiseAndAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_caret(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::BitwiseXor) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::BitwiseXor)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinBitwiseXor,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_caret_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinBitwiseXorAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_equals(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Assign) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Assign.sub(1))?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinAssign,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_in(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Compare) || !p.allow_in {
            return Ok(Continuation::Done);
        }

        // Warn about "!a in b" instead of "!(a in b)"
        if let ExprData::EUnary(unary) = &left.data {
            if unary.op == OpCode::UnNot {
                // TODO:
                // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
            }
        }

        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Compare)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinIn,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    fn sfx_t_instanceof(p: &mut Self, level: Level, left: &mut Expr) -> CResult {
        if level.gte(Level::Compare) {
            return Ok(Continuation::Done);
        }

        // Warn about "!a instanceof b" instead of "!(a instanceof b)". Here's an
        // example of code with this problem: https://github.com/mrdoob/three.js/pull/11182.
        if !p.options.suppress_warnings_about_weird_code {
            if let ExprData::EUnary(unary) = &left.data {
                if unary.op == OpCode::UnNot {
                    // TODO:
                    // p.log.addRangeWarning(source: ?Source, r: Range, text: string)
                }
            }
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = p.parse_expr(Level::Compare)?;
        *left = p.new_expr(
            E::Binary {
                op: OpCode::BinInstanceof,
                left: prev,
                right,
            },
            loc,
        );
        Ok(Continuation::Next)
    }

    pub fn parse_suffix(
        &mut self,
        left: &mut Expr,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> Result<(), Error> {
        let p = self;
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
                            let right = p.parse_expr(Level::Comma)?;
                            *left = p.new_expr(
                                E::Binary {
                                    op: OpCode::BinComma,
                                    left: prev,
                                    right,
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
                T::TAmpersand => Self::sfx_t_ampersand(p, level, left),
                T::TAmpersandAmpersandEquals => {
                    Self::sfx_t_ampersand_ampersand_equals(p, level, left)
                }
                T::TAmpersandEquals => Self::sfx_t_ampersand_equals(p, level, left),
                T::TAsterisk => Self::sfx_t_asterisk(p, level, left),
                T::TAsteriskAsterisk => Self::sfx_t_asterisk_asterisk(p, level, left),
                T::TAsteriskAsteriskEquals => Self::sfx_t_asterisk_asterisk_equals(p, level, left),
                T::TAsteriskEquals => Self::sfx_t_asterisk_equals(p, level, left),
                T::TBar => Self::sfx_t_bar(p, level, left),
                T::TBarBarEquals => Self::sfx_t_bar_bar_equals(p, level, left),
                T::TBarEquals => Self::sfx_t_bar_equals(p, level, left),
                T::TCaret => Self::sfx_t_caret(p, level, left),
                T::TCaretEquals => Self::sfx_t_caret_equals(p, level, left),
                T::TComma => Self::sfx_t_comma(p, level, left),
                T::TEquals => Self::sfx_t_equals(p, level, left),
                T::TEqualsEquals => Self::sfx_t_equals_equals(p, level, left),
                T::TEqualsEqualsEquals => Self::sfx_t_equals_equals_equals(p, level, left),
                T::TExclamationEquals => Self::sfx_t_exclamation_equals(p, level, left),
                T::TExclamationEqualsEquals => {
                    Self::sfx_t_exclamation_equals_equals(p, level, left)
                }
                T::TGreaterThan => Self::sfx_t_greater_than(p, level, left),
                T::TGreaterThanEquals => Self::sfx_t_greater_than_equals(p, level, left),
                T::TGreaterThanGreaterThan => Self::sfx_t_greater_than_greater_than(p, level, left),
                T::TGreaterThanGreaterThanEquals => {
                    Self::sfx_t_greater_than_greater_than_equals(p, level, left)
                }
                T::TGreaterThanGreaterThanGreaterThan => {
                    Self::sfx_t_greater_than_greater_than_greater_than(p, level, left)
                }
                T::TGreaterThanGreaterThanGreaterThanEquals => {
                    Self::sfx_t_greater_than_greater_than_greater_than_equals(p, level, left)
                }
                T::TIn => Self::sfx_t_in(p, level, left),
                T::TInstanceof => Self::sfx_t_instanceof(p, level, left),
                T::TLessThanEquals => Self::sfx_t_less_than_equals(p, level, left),
                T::TLessThanLessThanEquals => {
                    Self::sfx_t_less_than_less_than_equals(p, level, left)
                }
                T::TMinus => Self::sfx_t_minus(p, level, left),
                T::TMinusEquals => Self::sfx_t_minus_equals(p, level, left),
                T::TMinusMinus => Self::sfx_t_minus_minus(p, level, left),
                T::TPercent => Self::sfx_t_percent(p, level, left),
                T::TPercentEquals => Self::sfx_t_percent_equals(p, level, left),
                T::TPlus => Self::sfx_t_plus(p, level, left),
                T::TPlusEquals => Self::sfx_t_plus_equals(p, level, left),
                T::TPlusPlus => Self::sfx_t_plus_plus(p, level, left),
                T::TQuestionQuestion => Self::sfx_t_question_question(p, level, left),
                T::TQuestionQuestionEquals => Self::sfx_t_question_question_equals(p, level, left),
                T::TSlash => Self::sfx_t_slash(p, level, left),
                T::TSlashEquals => Self::sfx_t_slash_equals(p, level, left),
                T::TExclamation => {
                    Self::sfx_t_exclamation(p, &mut optional_chain, old_optional_chain)
                }
                T::TBarBar => Self::sfx_t_bar_bar(p, level, left, flags),
                T::TAmpersandAmpersand => Self::sfx_t_ampersand_ampersand(p, level, left, flags),
                T::TQuestion => Self::sfx_t_question(p, level, errors.as_deref_mut(), left),
                T::TQuestionDot => Self::sfx_t_question_dot(p, level, &mut optional_chain, left),
                T::TTemplateHead => Self::sfx_t_template_head(
                    p,
                    level,
                    &mut optional_chain,
                    old_optional_chain,
                    left,
                ),
                T::TLessThan => {
                    Self::sfx_t_less_than(p, level, &mut optional_chain, old_optional_chain, left)
                }
                T::TOpenParen => {
                    Self::sfx_t_open_paren(p, level, &mut optional_chain, old_optional_chain, left)
                }
                T::TNoSubstitutionTemplateLiteral => Self::sfx_t_no_substitution_template_literal(
                    p,
                    level,
                    &mut optional_chain,
                    old_optional_chain,
                    left,
                ),
                T::TOpenBracket => Self::sfx_t_open_bracket(
                    p,
                    &mut optional_chain,
                    old_optional_chain,
                    left,
                    flags,
                ),
                T::TDot => Self::sfx_t_dot(p, &mut optional_chain, old_optional_chain, left),
                T::TLessThanLessThan => Self::sfx_t_less_than_less_than(
                    p,
                    level,
                    &mut optional_chain,
                    old_optional_chain,
                    left,
                ),
                _ => Self::sfx_handle_typescript_as(p, level),
            };

            match continuation? {
                Continuation::Next => {}
                Continuation::Done => break,
            }
        }

        Ok(())
    }
}

// ported from: src/js_parser/ast/parseSuffix.zig
