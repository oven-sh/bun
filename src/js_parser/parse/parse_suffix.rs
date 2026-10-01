#![warn(unused_must_use)]
use crate::Error;

use crate::lexer::T;
use crate::p::P;
use crate::parser::DeferredErrors;
use crate::scan::scan_side_effects::SideEffects;
use crate::sema::ExprKey;
use crate::sema::{CastKind, Mark};
use bun_ast::expr::EFlags;
use bun_ast::op::Level;
use bun_ast::{E, Expr, ExprData, OpCode, OptionalChain};

// The 50+ per-token `t_*` helpers are private; only `parse_suffix` is surfaced.

#[derive(Clone, Copy, PartialEq, Eq)]
enum Continuation {
    Next,
    Done,
}

type CResult = core::result::Result<Continuation, Error>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    fn sfx_handle_typescript_as(p: &mut Self, level: Level, left: &Expr) -> CResult {
        if Self::IS_TYPESCRIPT_ENABLED
            && level.lt(Level::Compare)
            && !p.lexer.has_newline_before
            && (p.lexer.is_contextual_keyword(b"as") || p.lexer.is_contextual_keyword(b"satisfies"))
        {
            if p.keeps_type_syntax() {
                let kind = if p.lexer.identifier == b"as" {
                    CastKind::As
                } else {
                    CastKind::Satisfies
                };
                let keyword_end = bun_ast::usize2loc(p.lexer.end);
                p.mark_cast(left, kind, keyword_end);
            }
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
        let after_dot = bun_ast::usize2loc(p.lexer.end);
        p.lexer.next()?;
        let target = *left;

        if (p.lexer.has_newline_before || !p.lexer.is_identifier_or_keyword())
            && p.lexer.tolerant
            && Self::sfx_name_after_dot_is_missing(p, after_dot, false)?
        {
            let loc = left.loc;
            *left = p.new_expr(
                E::Dot {
                    target,
                    name: E::Str::EMPTY,
                    name_loc: after_dot,
                    optional_chain: old_optional_chain,
                    ..Default::default()
                },
                loc,
            );
        } else if p.lexer.token == T::TPrivateIdentifier
            // `parseRightSideOfDot` takes a private name anywhere. The checker reports 18013, 18016 or 2339.
            && (p.allow_private_identifiers || p.lexer.tolerant)
        {
            // "a.#b"
            // "a?.b.#c"
            if matches!(left.data, ExprData::ESuper(_)) && !p.lexer.tolerant {
                p.lexer.expected(T::TIdentifier)?;
            }

            let name = p.lexer.identifier;
            let name_range = p.lexer.range();
            let name_loc = name_range.loc;
            p.lexer.next()?;
            // `parsePropertyAccessExpressionRest`: an optional chain has no private names in it.
            if old_optional_chain.is_some() && p.lexer.tolerant {
                p.lexer.ts_error(name_range, 18030);
            }
            let ref_ = p.store_name_in_ref(name);
            let loc = left.loc;
            let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
            *left = p.new_expr(
                E::Index {
                    target,
                    index,
                    optional_chain: old_optional_chain,
                    is_import_property_use: false,
                },
                loc,
            );
        } else {
            // "a.b"
            // "a?.b.c"
            if !p.lexer.is_identifier_or_keyword() {
                p.lexer.expect(T::TIdentifier)?;
            }

            // `E::Dot::name` is spelled `&'static [u8]` but actually holds an
            // arena-owned slice; the lexer hands back `&'a [u8]`.
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

    /// `parseRightSideOfDot`, at the token after a `.` or `?.` that ends at `after_dot`. Whether the name is missing, which
    /// is reported (1003). Nothing is consumed.
    #[cold]
    #[inline(never)]
    fn sfx_name_after_dot_is_missing(
        p: &mut Self,
        after_dot: bun_ast::Loc,
        is_optional: bool,
    ) -> Result<bool, Error> {
        // `tokenIsIdentifierOrKeyword`
        let is_name = p.lexer.is_identifier_or_keyword() || p.lexer.token == T::TPrivateIdentifier;
        // A word on a new line that another word follows on the same line starts something else.
        if is_name
            && !(p.lexer.has_newline_before
                && p.next_token_matches(|p| {
                    !p.lexer.has_newline_before
                        && (p.lexer.is_identifier_or_keyword()
                            || p.lexer.token == T::TPrivateIdentifier)
                }))
        {
            return Ok(false);
        }
        if p.lexer.is_log_disabled {
            return Err(Error::Backtrack);
        }
        // `createIdentifierWithDiagnostic`: at the end of the file, where the last token ended. `parseCallExpressionRest`
        // reports a `?.` that nothing follows at the current token.
        let range = if is_name || (p.lexer.token == T::TEndOfFile && !is_optional) {
            bun_ast::Range {
                loc: after_dot,
                len: 0,
            }
        } else {
            p.lexer.range()
        };
        p.lexer.ts_error(range, 1003);
        Ok(true)
    }

    fn sfx_t_question_dot(
        p: &mut Self,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        // `parseNewExpressionOrNewDotTarget`: what `new` is given has no `?.` in it. The `new` ends here, without arguments, and the
        // chain hangs from what it makes. Only `new` asks for this level.
        if level.eql(Level::Member) && p.lexer.tolerant {
            let range = p.lexer.range();
            p.lexer.ts_error(range, 1209);
            return Ok(Continuation::Done);
        }
        let after_dot = bun_ast::usize2loc(p.lexer.end);
        p.lexer.next()?;
        let mut optional_start: Option<OptionalChain> = Some(OptionalChain::Start);

        // Remove unnecessary optional chains
        if p.options.features.minify_syntax {
            if let Some(result) = SideEffects::to_null_or_undefined(p, &left.data) {
                if !result.value {
                    optional_start = None;
                }
            }
        }

        match p.lexer.token {
            T::TOpenBracket => {
                // "a?.[b]"
                let after_bracket = bun_ast::usize2loc(p.lexer.end);
                p.lexer.next()?;

                // allow "in" inside the brackets;
                let old_allow_in = p.allow_in;
                p.allow_in = true;

                let index = if p.lexer.token == T::TCloseBracket
                    && p.lexer.tolerant
                    && !p.lexer.is_log_disabled
                {
                    Self::sfx_missing_index(p, after_bracket)
                } else {
                    p.parse_expr(Level::Lowest)?
                };

                p.allow_in = old_allow_in;

                p.lexer.expect(T::TCloseBracket)?;
                let loc = left.loc;
                let target = *left;
                *left = p.new_expr(
                    E::Index {
                        target,
                        index,
                        optional_chain: optional_start,
                        is_import_property_use: false,
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
                    return Err(crate::Error::SyntaxError);
                }

                let type_arguments = p.lexer.loc();
                let _ = p.skip_type_script_type_arguments::<false, false>()?;
                if p.lexer.token != T::TOpenParen {
                    p.lexer.expected(T::TOpenParen)?;
                }

                if level.gte(Level::Call) {
                    return Ok(Continuation::Done);
                }

                let list_loc = p.parse_call_args()?;
                p.mark_type_syntax(list_loc.loc, Mark::TypeArguments, type_arguments);
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
            // "a?.`b`": `parseTaggedTemplateRest` takes it. The suffix that parses the template reports it.
            T::TNoSubstitutionTemplateLiteral | T::TTemplateHead if p.lexer.tolerant => {}
            _ => {
                if (p.lexer.has_newline_before || !p.lexer.is_identifier_or_keyword())
                    && p.lexer.tolerant
                    && Self::sfx_name_after_dot_is_missing(p, after_dot, true)?
                {
                    let loc = left.loc;
                    let target = *left;
                    *left = p.new_expr(
                        E::Dot {
                            target,
                            name: E::Str::EMPTY,
                            name_loc: after_dot,
                            optional_chain: optional_start,
                            ..Default::default()
                        },
                        loc,
                    );
                } else if p.lexer.token == T::TPrivateIdentifier
                    && (p.allow_private_identifiers || p.lexer.tolerant)
                {
                    // "a?.#b"
                    let name = p.lexer.identifier;
                    let name_range = p.lexer.range();
                    let name_loc = name_range.loc;
                    p.lexer.next()?;
                    // `parsePropertyAccessExpressionRest`: an optional chain has no private names in it.
                    if p.lexer.tolerant {
                        p.lexer.ts_error(name_range, 18030);
                    }
                    let ref_ = p.store_name_in_ref(name);
                    let loc = left.loc;
                    let target = *left;
                    let index = p.new_expr(E::PrivateIdentifier { ref_ }, name_loc);
                    *left = p.new_expr(
                        E::Index {
                            target,
                            index,
                            optional_chain: optional_start,
                            is_import_property_use: false,
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
                            name,
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
        if let Some(type_arguments) = p.take_type_arguments() {
            p.mark_type_syntax(left.loc, Mark::TagTypeArguments, type_arguments);
        }
        // `hasCorrectArity`: a call with an unterminated template is incomplete.
        if p.lexer.tolerant && p.lexer.unterminated_at == p.lexer.start {
            p.mark_type_syntax(left.loc, Mark::IncompleteTemplate, left.loc);
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
        if let Some(type_arguments) = p.take_type_arguments() {
            p.mark_type_syntax(left.loc, Mark::TagTypeArguments, type_arguments);
        }
        // p.markSyntaxFeature(compat.TemplateLiteral, p.lexer.Range());
        let head = E::Str::new(p.lexer.raw_template_contents());
        let (parts, tail_loc) = p.parse_template_parts(true)?;
        // `hasCorrectArity`: a call with a template whose last literal is missing or unterminated is incomplete.
        if p.lexer.tolerant && p.lexer.unterminated_at == tail_loc.start as usize {
            p.mark_type_syntax(left.loc, Mark::IncompleteTemplate, left.loc);
        }
        let tag = *left;
        let loc = left.loc;
        *left = p.new_expr(
            E::Template {
                tag: Some(tag),
                head: E::TemplateContents::Raw(head),
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

        let after_bracket = bun_ast::usize2loc(p.lexer.end);
        p.lexer.next()?;

        // Allow "in" inside the brackets
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        let index =
            if p.lexer.token == T::TCloseBracket && p.lexer.tolerant && !p.lexer.is_log_disabled {
                Self::sfx_missing_index(p, after_bracket)
            } else {
                p.parse_expr(Level::Lowest)?
            };

        p.allow_in = old_allow_in;

        p.lexer.expect(T::TCloseBracket)?;

        let loc = left.loc;
        let target = *left;
        *left = p.new_expr(
            E::Index {
                target,
                index,
                optional_chain: old_optional_chain,
                is_import_property_use: false,
            },
            loc,
        );
        *optional_chain = old_optional_chain;
        Ok(Continuation::Next)
    }

    /// `parseElementAccessExpressionRest`, at the `]` of `a[]`: 1011 and a missing argument, both where the `[` ends.
    #[cold]
    #[inline(never)]
    fn sfx_missing_index(p: &mut Self, after_bracket: bun_ast::Loc) -> Expr {
        p.lexer.ts_error(
            bun_ast::Range {
                loc: after_bracket,
                len: 0,
            },
            1011,
        );
        p.new_expr(E::Missing {}, after_bracket)
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

        let type_arguments = p.take_type_arguments();
        let list_loc = p.parse_call_args()?;
        if let Some(type_arguments) = type_arguments {
            p.mark_type_syntax(list_loc.loc, Mark::TypeArguments, type_arguments);
        }
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
        flags: EFlags,
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
                || p.lexer.token == T::TComma
                // "(a?=": `nextIsParenthesizedArrowFunctionExpression`. The checker reports 1015.
                || (p.lexer.token == T::TEquals && p.lexer.tolerant))
        {
            if let Some(errors) = errors {
                errors.invalid_expr_after_question = Some(p.lexer.range());
                return Ok(Continuation::Done);
            }
            // `parseConditionalExpressionRest`: a conditional expression like any other, with nothing after its `?`.
            if !p.lexer.tolerant {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
        }

        let loc = left.loc;
        let prev = *left;
        // The `Data::EIf(StoreRef<E::If>)` payload is a
        // boxed arena slot: allocate first, then fill via DerefMut on StoreRef.
        let ternary = p.new_expr(
            E::If {
                test: prev,
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
        p.parse_expr_with_flags(
            Level::Comma,
            EFlags::AfterQuestionAndBeforeColon,
            &mut e_if.yes,
        )?;

        p.allow_in = old_allow_in;

        // condition ? yes : no
        //                 ^
        if p.lexer.token != T::TColon && p.lexer.tolerant {
            // `parseConditionalExpressionRest`: without the colon, what would come after it is missing as well.
            p.lexer.expect(T::TColon)?;
            e_if.no = p.new_expr(E::Missing {}, p.lexer.loc());
            *left = ternary;
            return Ok(Continuation::Next);
        }
        p.lexer.expect(T::TColon)?;

        // condition ? yes : no
        //                   ^
        // Still between the "?" and ":" of an outer conditional when nested in its "yes"
        let no_flags = if flags == EFlags::AfterQuestionAndBeforeColon {
            flags
        } else {
            EFlags::None
        };
        p.parse_expr_with_flags(Level::Comma, no_flags, &mut e_if.no)?;

        // condition ? yes : no
        //                     ^

        *left = ternary;
        Ok(Continuation::Next)
    }

    fn sfx_t_exclamation(
        p: &mut Self,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &Expr,
    ) -> CResult {
        // Skip over TypeScript non-null assertions
        if p.lexer.has_newline_before {
            return Ok(Continuation::Done);
        }

        if !Self::IS_TYPESCRIPT_ENABLED {
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
        }

        p.lexer.next()?;
        *optional_chain = old_optional_chain;
        p.mark_cast(left, CastKind::NonNull, left.loc);

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
        if p.lexer.tolerant && Self::cannot_follow_update(p) {
            p.forbid_suffix_after_as_loc = p.lexer.loc();
            return Ok(Continuation::Done);
        }
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
        if p.lexer.tolerant && Self::cannot_follow_update(p) {
            p.forbid_suffix_after_as_loc = p.lexer.loc();
            return Ok(Continuation::Done);
        }
        Ok(Continuation::Next)
    }

    /// `parseUpdateExpression`: `a++` and `++a` are no LeftHandSideExpression. Whether the current token is one that only
    /// continues a LeftHandSideExpression. Assignment operators are refused by `sfx_takes_no_assignment`.
    #[cold]
    #[inline(never)]
    pub(crate) fn cannot_follow_update(p: &Self) -> bool {
        match p.lexer.token {
            T::TPlusPlus | T::TMinusMinus | T::TExclamation => !p.lexer.has_newline_before,
            T::TDot
            | T::TQuestionDot
            | T::TOpenBracket
            | T::TOpenParen
            | T::TNoSubstitutionTemplateLiteral
            | T::TTemplateHead => true,
            _ => false,
        }
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

    // The 30+ simple binary operators below have uniform
    // bodies — `if level.gte(L) {Done}; next; new Binary{op,left,right}`.

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

    /// The right side of an assignment. `parseAssignmentExpressionOrHigherWorker`: it is between the same `?` and `:` as the
    /// assignment is, so that the `(c) : d => e` of `a ? b = (c) : d => e` is no arrow function.
    #[inline]
    fn sfx_right_of_assignment(p: &mut Self, flags: EFlags) -> Result<Expr, Error> {
        let flags = if flags == EFlags::AfterQuestionAndBeforeColon && p.lexer.tolerant {
            flags
        } else {
            EFlags::None
        };
        let mut right = Expr::EMPTY;
        p.parse_expr_with_flags(Level::Assign.sub(1), flags, &mut right)?;
        Ok(right)
    }

    fn sfx_t_plus_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_minus_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_asterisk_asterisk_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_asterisk_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_percent_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_slash_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    /// Whether `token`, which follows type arguments, starts what they are the type arguments of: `parseCallExpressionRest` and
    /// `parseMemberExpressionRest` give those of an ExpressionWithTypeArguments to the call or the tagged template that follows.
    #[inline]
    fn sfx_takes_type_arguments(token: T) -> bool {
        matches!(
            token,
            T::TOpenParen | T::TNoSubstitutionTemplateLiteral | T::TTemplateHead
        )
    }

    /// The optional chain that goes on after `e<T>`, where `e` was in `chain`. `tryReparseOptionalChain`: an instantiation
    /// expression is no part of a chain. The call or the tagged template that takes the type arguments is.
    #[inline]
    fn sfx_chain_after_type_arguments(
        p: &Self,
        chain: Option<OptionalChain>,
    ) -> Option<OptionalChain> {
        if chain.is_some() && p.lexer.tolerant && !Self::sfx_takes_type_arguments(p.lexer.token) {
            return None;
        }
        chain
    }

    fn sfx_t_less_than(
        p: &mut Self,
        level: Level,
        optional_chain: &mut Option<OptionalChain>,
        old_optional_chain: Option<OptionalChain>,
        left: &mut Expr,
    ) -> CResult {
        // `Scan`: in a file with JSX "</" is one token (LessThanSlashToken), which is no operator.
        if p.lexer.tolerant && p.is_jsx_enabled() && p.lexer.is_less_than_slash() {
            return Ok(Continuation::Done);
        }
        // TypeScript allows type arguments to be specified with angle brackets
        // inside an expression. Unlike in other languages, this unfortunately
        // appears to require backtracking to parse.
        let less_than = p.lexer.loc();
        if Self::IS_TYPESCRIPT_ENABLED && p.try_skip_type_script_type_arguments_with_backtracking()
        {
            *optional_chain = Self::sfx_chain_after_type_arguments(p, old_optional_chain);
            // `parseSuperExpression`: type arguments after `super` are objected to from where the keyword ends. Not after what `new`
            // is given, which is a primary expression. A template drops them, and `resolveCall` does not look at those of a call.
            if matches!(left.data, ExprData::ESuper(_))
                && level.lt(Level::Member)
                && p.lexer.tolerant
            {
                let after_super = bun_ast::Loc {
                    start: left.loc.start + 5,
                };
                p.lexer.ts_error(
                    bun_ast::Range {
                        loc: after_super,
                        len: 0,
                    },
                    2754,
                );
                if Self::sfx_takes_type_arguments(p.lexer.token) {
                    return Ok(Continuation::Next);
                }
            }
            p.note_type_arguments(left, less_than);
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
        let less_than = p.lexer.loc();
        if Self::IS_TYPESCRIPT_ENABLED && p.try_skip_type_script_type_arguments_with_backtracking()
        {
            *optional_chain = Self::sfx_chain_after_type_arguments(p, old_optional_chain);
            p.note_type_arguments(left, less_than);
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

    fn sfx_t_less_than_less_than_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_question_question_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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
            if p.lexer.tolerant {
                // `GetBinaryOperatorPrecedence`: "??" has the precedence of "||". The checker reports 5076.
                return Ok(Continuation::Done);
            }
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
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

            if p.lexer.token == T::TQuestionQuestion && !p.lexer.tolerant {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
        }
        Ok(Continuation::Next)
    }

    fn sfx_t_bar_bar_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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
        // TypeScript's parser takes it, since "&&" binds tighter. The checker reports 5076.
        if level.eql(Level::NullishCoalescing) && !p.lexer.tolerant {
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
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

            if p.lexer.token == T::TQuestionQuestion && !p.lexer.tolerant {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
        }
        Ok(Continuation::Next)
    }

    fn sfx_t_ampersand_ampersand_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_bar_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_ampersand_equals(
        p: &mut Self,
        level: Level,
        left: &mut Expr,
        flags: EFlags,
    ) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_caret_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    fn sfx_t_equals(p: &mut Self, level: Level, left: &mut Expr, flags: EFlags) -> CResult {
        if level.gte(Level::Assign) || Self::sfx_takes_no_assignment(p, left) {
            return Ok(Continuation::Done);
        }
        p.lexer.next()?;
        let loc = left.loc;
        let prev = *left;
        let right = Self::sfx_right_of_assignment(p, flags)?;
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

    /// `parseAssignmentExpressionOrHigherWorker`: an assignment operator is only taken after a LeftHandSideExpression.
    /// After anything else the expression ends.
    #[inline]
    fn sfx_takes_no_assignment(p: &Self, left: &Expr) -> bool {
        p.lexer.tolerant && Self::sfx_is_not_left_hand_side(p, left)
    }

    /// `isLeftHandSideExpressionKind`, negated. `left` was just parsed.
    #[cold]
    #[inline(never)]
    fn sfx_is_not_left_hand_side(p: &Self, left: &Expr) -> bool {
        if p.lexer.is_log_disabled {
            return false;
        }
        // Parentheses, `!`, type arguments and type assertions make a node of their own kind.
        let last_cast = p
            .type_syntax
            .as_ref()
            .and_then(|syntax| syntax.casts.last());
        if let Some(&(key, kind, _)) = last_cast
            && key == ExprKey::of(left)
        {
            return matches!(kind, CastKind::As | CastKind::Satisfies);
        }
        matches!(
            left.data,
            ExprData::EUnary(_)
                | ExprData::EBinary(_)
                | ExprData::EIf(_)
                | ExprData::EAwait(_)
                | ExprData::EYield(_)
                | ExprData::EArrow(_)
        )
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

    pub(crate) fn parse_suffix(
        &mut self,
        left: &mut Expr,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
    ) -> Result<(), Error> {
        let p = self;

        let mut optional_chain: Option<OptionalChain> = None;
        loop {
            if p.lexer.loc().start == p.after_arrow_body_loc.start
                // Once this very token has been objected to, the arrow function has ended what it had to end. Whoever comes next
                // (`parseParenthesizedExpression`, the next statement) takes the operator, as `parseBinaryExpressionRest` does.
                && !(p.lexer.tolerant && p.lexer.prev_error_loc.eql(p.lexer.loc()))
            {
                // Plain loop re-reading `p.lexer.token` each iteration.
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
            // stack space.
            let continuation = match p.lexer.token {
                T::TAmpersand => Self::sfx_t_ampersand(p, level, left),
                T::TAmpersandAmpersandEquals => {
                    Self::sfx_t_ampersand_ampersand_equals(p, level, left, flags)
                }
                T::TAmpersandEquals => Self::sfx_t_ampersand_equals(p, level, left, flags),
                T::TAsterisk => Self::sfx_t_asterisk(p, level, left),
                T::TAsteriskAsterisk => Self::sfx_t_asterisk_asterisk(p, level, left),
                T::TAsteriskAsteriskEquals => {
                    Self::sfx_t_asterisk_asterisk_equals(p, level, left, flags)
                }
                T::TAsteriskEquals => Self::sfx_t_asterisk_equals(p, level, left, flags),
                T::TBar => Self::sfx_t_bar(p, level, left),
                T::TBarBarEquals => Self::sfx_t_bar_bar_equals(p, level, left, flags),
                T::TBarEquals => Self::sfx_t_bar_equals(p, level, left, flags),
                T::TCaret => Self::sfx_t_caret(p, level, left),
                T::TCaretEquals => Self::sfx_t_caret_equals(p, level, left, flags),
                T::TComma => Self::sfx_t_comma(p, level, left),
                T::TEquals => Self::sfx_t_equals(p, level, left, flags),
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
                    Self::sfx_t_greater_than_greater_than_equals(p, level, left, flags)
                }
                T::TGreaterThanGreaterThanGreaterThan => {
                    Self::sfx_t_greater_than_greater_than_greater_than(p, level, left)
                }
                T::TGreaterThanGreaterThanGreaterThanEquals => {
                    Self::sfx_t_greater_than_greater_than_greater_than_equals(p, level, left, flags)
                }
                T::TIn => Self::sfx_t_in(p, level, left),
                T::TInstanceof => Self::sfx_t_instanceof(p, level, left),
                T::TLessThanEquals => Self::sfx_t_less_than_equals(p, level, left),
                T::TLessThanLessThanEquals => {
                    Self::sfx_t_less_than_less_than_equals(p, level, left, flags)
                }
                T::TMinus => Self::sfx_t_minus(p, level, left),
                T::TMinusEquals => Self::sfx_t_minus_equals(p, level, left, flags),
                T::TMinusMinus => Self::sfx_t_minus_minus(p, level, left),
                T::TPercent => Self::sfx_t_percent(p, level, left),
                T::TPercentEquals => Self::sfx_t_percent_equals(p, level, left, flags),
                T::TPlus => Self::sfx_t_plus(p, level, left),
                T::TPlusEquals => Self::sfx_t_plus_equals(p, level, left, flags),
                T::TPlusPlus => Self::sfx_t_plus_plus(p, level, left),
                T::TQuestionQuestion => Self::sfx_t_question_question(p, level, left),
                T::TQuestionQuestionEquals => {
                    Self::sfx_t_question_question_equals(p, level, left, flags)
                }
                T::TSlash => Self::sfx_t_slash(p, level, left),
                T::TSlashEquals => Self::sfx_t_slash_equals(p, level, left, flags),
                T::TExclamation => {
                    Self::sfx_t_exclamation(p, &mut optional_chain, old_optional_chain, left)
                }
                T::TBarBar => Self::sfx_t_bar_bar(p, level, left, flags),
                T::TAmpersandAmpersand => Self::sfx_t_ampersand_ampersand(p, level, left, flags),
                T::TQuestion => Self::sfx_t_question(p, level, errors.as_deref_mut(), left, flags),
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
                _ => Self::sfx_handle_typescript_as(p, level, left),
            };

            match continuation? {
                Continuation::Next => {}
                Continuation::Done => break,
            }
        }

        Ok(())
    }
}
