#![warn(unused_must_use)]
pub(crate) mod lists;
pub mod parse_entry;
pub(crate) mod parse_fn;
pub(crate) mod parse_import_export;
pub(crate) mod parse_jsx;
pub(crate) mod parse_prefix;
pub(crate) mod parse_property;
pub(crate) mod parse_skip_typescript;
pub(crate) mod parse_stmt;
pub mod parse_suffix;
pub(crate) mod parse_typescript;

use bun_collections::VecExt;

use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};

use crate::Error;
use bun_core::strings;

use bun_ast::LexerLog as _;

use crate::lexer::T;
use crate::p::P;
use crate::parse::lists::{ListKind, ListStep};
use crate::parser::{
    AwaitOrYield, DeferredArrowArgErrors, DeferredErrors, ExprListLoc, ExprOrLetStmt,
    FnOrArrowDataParse, LexicalDecl, LocList, ParenExprOpts, ParseBindingOptions,
    ParseClassOptions, ParseStatementOptions, ParsedPath, PropertyOpts, SkipTypeParameterResult,
    StmtList, TypeParameterFlag,
};
use crate::sema::Mark;
use bun_ast as js_ast;
use bun_ast::expr::EFlags;
use bun_ast::op::Level;
use bun_ast::{ArrayBinding, StrictModeKind};
use bun_ast::{B, Binding, E, Expr, ExprNodeIndex, ExprNodeList, Flags, G, LocRef, S, Stmt};

/// What `parse_paren_expr_as` is to make of the parentheses. Anything but `Undecided` in tolerant mode only.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ArrowAttempt {
    /// What follows the ")" decides.
    Undecided,
    /// `parseParenthesizedArrowFunctionExpression` without `allowAmbiguity`: an arrow function, or `Err(Error::Backtrack)`.
    ArrowOrBacktrack,
    /// `isParenthesizedArrowFunctionExpression` said no, or the attempt failed: no arrow function, whatever follows the ")".
    NeverArrow,
}

// File-split mixin: Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`,
// so this is a direct `impl P` block.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    pub(crate) fn parse_expr_or_bindings(
        &mut self,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        self.parse_expr_common(level, errors, EFlags::None, expr)
    }
    #[inline]
    pub fn parse_expr(&mut self, level: Level) -> Result<Expr, Error> {
        let mut expr = Expr::EMPTY;
        self.parse_expr_common(level, None, EFlags::None, &mut expr)?;
        Ok(expr)
    }
    #[inline]
    pub(crate) fn parse_expr_with_flags(
        &mut self,
        level: Level,
        flags: EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        self.parse_expr_common(level, None, flags, expr)
    }
    pub(crate) fn parse_expr_common(
        &mut self,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }

        let had_pure_comment_before =
            self.lexer.has_pure_comment_before && !self.options.ignore_dce_annotations;
        *expr = self.parse_prefix(level, errors.as_deref_mut(), flags)?;
        // `errors` is reborrowed via as_deref_mut for each call site.

        // There is no formal spec for "__PURE__" comments but from reverse-
        // engineering, it looks like they apply to the next CallExpression or
        // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
        // to the expression "a().b()".

        if had_pure_comment_before && level.lt(Level::Call) {
            self.parse_suffix(expr, Level::Call.sub(1), errors.as_deref_mut(), flags)?;
            match &mut expr.data {
                js_ast::expr::Data::ECall(ex) => {
                    ex.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                }
                js_ast::expr::Data::ENew(ex) => {
                    ex.can_be_unwrapped_if_unused = js_ast::CanBeUnwrapped::IfUnused;
                }
                _ => {}
            }
        }

        self.parse_suffix(expr, level, errors, flags)?;
        Ok(())
    }

    pub(crate) fn parse_yield_expr(&mut self, loc: bun_ast::Loc) -> Result<Expr, Error> {
        let p = self;
        // Parse a yield-from expression, which yields from an iterator
        let is_star = p.lexer.token == T::TAsterisk;

        if is_star {
            if p.lexer.has_newline_before {
                // `parseYieldExpression`: nothing after a line break belongs to the "yield".
                if p.lexer.tolerant {
                    return Ok(p.new_expr(
                        E::Yield {
                            value: None,
                            is_star: false,
                        },
                        loc,
                    ));
                }
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
            p.lexer.next()?;
        }

        let mut value: Option<ExprNodeIndex> = None;
        match p.lexer.token {
            T::TCloseBrace
            | T::TCloseParen
            | T::TCloseBracket
            | T::TColon
            | T::TComma
            | T::TSemicolon
                // `parseYieldExpression`: after "*" the operand is parsed whatever follows (1109).
                if !(is_star && p.lexer.tolerant) => {}
            _ => {
                // `parseYieldExpression`: without "*" there is an operand only if the token can start an expression.
                if is_star
                    || (!p.lexer.has_newline_before
                        && (!p.lexer.tolerant || p.is_start_of_expression_or_shift_assign()))
                {
                    value = Some(p.parse_expr(Level::Yield)?);
                }
            }
        }

        Ok(p.new_expr(E::Yield { value, is_star }, loc))
    }

    // By the time we call this, the identifier and type parameters have already
    // been parsed. We need to start parsing from the "extends" clause.
    pub(crate) fn parse_class(
        &mut self,
        class_keyword: bun_ast::Range,
        name: Option<js_ast::LocRef>,
        class_opts: &ParseClassOptions<'a>,
    ) -> Result<G::Class, Error> {
        let p = self;
        let mut extends: Option<Expr> = None;
        let mut has_decorators: bool = false;
        let mut has_auto_accessor: bool = false;

        if Self::IS_TYPESCRIPT_ENABLED && p.lexer.tolerant && !p.lexer.is_log_disabled {
            // Consumes every clause, so the two blocks below find none.
            extends = p.parse_heritage_clauses(class_keyword)?;
        }

        if p.lexer.token == T::TExtends {
            p.lexer.next()?;
            extends = Some(p.parse_expr(Level::New)?);

            // TypeScript's type argument parser inside expressions backtracks if the
            // first token after the end of the type parameter list is "{", so the
            // parsed expression above will have backtracked if there are any type
            // arguments. This means we have to re-parse for any type arguments here.
            // This seems kind of wasteful to me but it's what the official compiler
            // does and it probably doesn't have that high of a performance overhead
            // because "extends" clauses aren't that frequent, so it should be ok.
            if Self::IS_TYPESCRIPT_ENABLED {
                let type_arguments = p.lexer.loc();
                if p.skip_type_script_type_arguments::<false, false>()? {
                    p.mark_type_syntax(class_keyword.loc, Mark::ExtendsArguments, type_arguments);
                }
            }
        }

        if Self::IS_TYPESCRIPT_ENABLED {
            if p.lexer.is_contextual_keyword(b"implements") {
                p.lexer.next()?;
                p.mark_type_syntax(class_keyword.loc, Mark::Implements, p.lexer.loc());

                loop {
                    p.skip_type_script_type(Level::Lowest)?;
                    if p.lexer.token != T::TComma {
                        break;
                    }
                    p.lexer.next()?;
                }
            }
        }

        let body_loc = p.lexer.loc();
        // `parseClassDeclarationOrExpression`: without the "{" there are no members, and no "}" is looked for.
        let has_body = p.lexer.token == T::TOpenBrace || !p.lexer.tolerant;
        p.lexer.expect(T::TOpenBrace)?;
        let mut properties = BumpVec::<G::Property>::new_in(p.arena);

        // Allow "in" and private fields inside class bodies
        let old_allow_in = p.allow_in;
        let old_allow_private_identifiers = p.allow_private_identifiers;
        p.allow_in = true;
        p.allow_private_identifiers = true;

        // A scope is needed for private identifiers
        let scope_index = p
            .push_scope_for_parse_pass(js_ast::scope::Kind::ClassBody, body_loc)
            .expect("unreachable");

        let saved_contexts = p.enter_list(ListKind::ClassMembers);
        while has_body && !p.lexer.token.is_close_brace_or_eof() {
            if p.lexer.token == T::TSemicolon {
                p.lexer.next()?;
                continue;
            }
            match p.classify_list_token(ListKind::ClassMembers)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }

            // `opts` is fully
            // reinitialized here every iteration before any read, so declare
            // per-iteration.
            let mut opts = PropertyOpts {
                is_class: true,
                allow_ts_decorators: class_opts.allow_ts_decorators,
                class_has_extends: extends.is_some(),
                has_argument_decorators: false,
                ..Default::default()
            };

            // Parse decorators for this property
            let first_decorator_loc = p.lexer.loc();
            let property_scope_index = p.scopes_in_order.len();
            if opts.allow_ts_decorators {
                opts.ts_decorators = p.parse_type_script_decorators()?;
                opts.has_class_decorators = class_opts.ts_decorators.len() > 0;
                has_decorators = has_decorators || opts.ts_decorators.len() > 0;
            }

            // This property may turn out to be a type in TypeScript, which should be ignored
            if let Some(property) =
                p.parse_property(js_ast::g::PropertyKind::Normal, &mut opts, None)?
            {
                // read fields before move (G::Property is not Copy).
                let prop_kind = property.kind;
                let prop_key = property.key;
                if p.keeps_type_syntax() {
                    let named_at = match property.class_static_block_ref() {
                        Some(block) => Some(block.loc),
                        None => prop_key.map(|key| key.loc),
                    };
                    if let Some(named_at) = named_at {
                        p.mark_type_syntax(named_at, Mark::MemberStart, first_decorator_loc);
                    }
                }
                if let Some(starts) = &mut p.starts_for_parse_only {
                    let named_at = match property.class_static_block_ref() {
                        Some(block) => Some(block.loc),
                        None => prop_key.map(|key| key.loc),
                    };
                    if let Some(named_at) = named_at {
                        starts
                            .class_elements
                            .insert(named_at.start, first_decorator_loc.start);
                    }
                }
                properties.push(property);
                has_auto_accessor =
                    has_auto_accessor || prop_kind == js_ast::g::PropertyKind::AutoAccessor;

                // Forbid decorators on class constructors
                if opts.ts_decorators.len() > 0 {
                    if let Some(key) = prop_key {
                        if let js_ast::expr::Data::EString(str_) = &key.data {
                            if str_.eql_comptime(b"constructor") {
                                p.log().add_error(
                                    Some(p.source),
                                    first_decorator_loc,
                                    b"TypeScript does not allow decorators on class constructors",
                                );
                            }
                        }
                    }
                }

                has_decorators = has_decorators || opts.has_argument_decorators;
            } else {
                // The property was dropped (e.g. a TypeScript overload signature or
                // abstract method), which drops its decorators and computed key too.
                // Discard any scopes recorded while parsing them or the visit pass
                // will hit a scope order mismatch.
                p.discard_scopes_up_to(property_scope_index);
                p.mark_type_syntax(class_keyword.loc, Mark::DroppedMember, first_decorator_loc);
            }
        }
        p.lexer.list_contexts = saved_contexts;

        if class_opts.is_type_script_declare {
            p.pop_and_discard_scope(scope_index);
        } else {
            p.pop_scope();
        }

        p.allow_in = old_allow_in;
        p.allow_private_identifiers = old_allow_private_identifiers;
        let close_brace_loc = p.lexer.loc();
        if has_body {
            p.lexer.expect(T::TCloseBrace)?;
        }

        let has_any_decorators = has_decorators || class_opts.ts_decorators.len() > 0;
        // `Expr: Copy` — safe arena-slice → owned Vec (one memcpy, no double-drop).
        let ts_decorators = ExprNodeList::from_arena_slice(class_opts.ts_decorators);
        Ok(G::Class {
            class_name: name,
            extends,
            close_brace_loc,
            ts_decorators,
            class_keyword,
            body_loc,
            properties: bun_ast::StoreSlice::new_mut(properties.into_bump_slice_mut()),
            has_decorators: has_any_decorators,
            should_lower_standard_decorators: p.options.features.standard_decorators
                && (has_any_decorators || has_auto_accessor),
        })
    }

    /// `parseHeritageClauses`, and the errors of `checkGrammarClassDeclarationHeritageClauses`. Returns the base class: the first
    /// type of the first `extends` clause. Tolerant mode only.
    #[cold]
    #[inline(never)]
    fn parse_heritage_clauses(
        &mut self,
        class_keyword: bun_ast::Range,
    ) -> Result<Option<Expr>, Error> {
        let p = self;
        let mut extends: Option<Expr> = None;
        if p.lexer.token != T::TExtends && !p.lexer.is_contextual_keyword(b"implements") {
            return Ok(extends);
        }
        let mut seen_extends = false;
        let mut seen_implements = false;
        // The checker returns after 1172, 1173, 1174 or 1175.
        let mut stop_checking = false;
        let saved_clauses = p.enter_list(ListKind::HeritageClauses);
        loop {
            match p.classify_list_token(ListKind::HeritageClauses)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let keyword = p.lexer.range();
            let is_extends = p.lexer.token == T::TExtends;
            let order_error = match (is_extends, seen_extends, seen_implements) {
                (true, true, _) => 1172,
                (true, false, true) => 1173,
                (false, _, true) => 1175,
                _ => 0,
            };
            if order_error != 0 && !stop_checking {
                p.lexer.ts_grammar_error(keyword, order_error);
                stop_checking = true;
            }
            p.lexer.next()?;

            // `parseHeritageClause`
            let saved_elements = p.enter_list(ListKind::HeritageClauseElement);
            let mut count = 0u32;
            let mut trailing_comma: Option<bun_ast::Range> = None;
            loop {
                match p.classify_list_token(ListKind::HeritageClauseElement)? {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }
                let start = p.lexer.range();
                trailing_comma = None;
                if is_extends {
                    let scope_index = p.scopes_in_order.len();
                    let value = p.parse_expr(Level::New)?;
                    let type_arguments = p.lexer.loc();
                    let has_type_arguments = p.skip_type_script_type_arguments::<false, false>()?;
                    if count == 0 && !seen_extends {
                        extends = Some(value);
                        if has_type_arguments {
                            p.mark_type_syntax(
                                class_keyword.loc,
                                Mark::ExtendsArguments,
                                type_arguments,
                            );
                        }
                    } else {
                        p.discard_scopes_up_to(scope_index);
                        if count == 1 && !stop_checking {
                            p.lexer.ts_grammar_error(start, 1174);
                            stop_checking = true;
                        }
                    }
                } else {
                    // Only the first `implements` clause counts. The lowering reads its types from the first one on.
                    if count == 0 && !seen_implements {
                        p.mark_type_syntax(class_keyword.loc, Mark::Implements, start.loc);
                    }
                    // `extends` after the type starts the next clause.
                    let opts = crate::typescript::SkipTypeOptionsBitset::only(
                        crate::typescript::SkipTypeOptions::DisallowConditionalTypes,
                    );
                    if p.should_keep_types() {
                        p.parse_and_keep_type(Level::Lowest, opts)?;
                    } else {
                        p.skip_type_script_type_with_opts::<false>(Level::Lowest, opts, None)?;
                    }
                    if matches!(
                        p.lexer.token,
                        T::TQuestionDot
                            | T::TOpenParen
                            | T::TOpenBracket
                            | T::TExclamation
                            | T::TNoSubstitutionTemplateLiteral
                            | T::TTemplateHead
                    ) {
                        p.parse_rest_of_implemented(start.loc)?;
                    }
                }
                count += 1;
                if p.lexer.token == T::TComma {
                    trailing_comma = Some(p.lexer.range());
                    p.lexer.next()?;
                    continue;
                }
                if !p.recover_missing_comma(ListKind::HeritageClauseElement, start.loc)? {
                    break;
                }
            }
            p.lexer.list_contexts = saved_elements;

            // `checkGrammarHeritageClause`
            if !stop_checking {
                if let Some(comma) = trailing_comma {
                    p.lexer.ts_grammar_error(comma, 1009);
                } else if count == 0 {
                    p.lexer.ts_grammar_error(
                        bun_ast::Range {
                            loc: keyword.end(),
                            len: 0,
                        },
                        1097,
                    );
                }
            }
            if is_extends {
                seen_extends = true;
            } else {
                seen_implements = true;
            }
        }
        p.lexer.list_contexts = saved_clauses;
        Ok(extends)
    }

    /// `parseExpressionWithTypeArguments` after `implements`, from where the expression no longer reads as a type (2500).
    #[cold]
    #[inline(never)]
    fn parse_rest_of_implemented(&mut self, start: bun_ast::Loc) -> Result<(), Error> {
        let scope_index = self.scopes_in_order.len();
        let mut value = self.new_expr(E::Missing {}, start);
        self.parse_suffix(&mut value, Level::New, None, EFlags::None)?;
        self.skip_type_script_type_arguments::<false, false>()?;
        self.discard_scopes_up_to(scope_index);
        Ok(())
    }

    pub(crate) fn parse_template_parts(
        &mut self,
        include_raw: bool,
    ) -> Result<(bun_ast::StoreSlice<E::TemplatePart>, bun_ast::Loc), Error> {
        let p = self;
        let mut parts = BumpVec::<E::TemplatePart>::with_capacity_in(1, p.arena);
        // Allow "in" inside template literals
        let old_allow_in = p.allow_in;
        p.allow_in = true;
        // Reassigned every iteration of the (always-entered) loop body before
        // any read; the loop's only `break` is after the assignment.
        let mut tail_loc;

        'parse_template_part: loop {
            p.lexer.next()?;
            let value = p.parse_expr(Level::Lowest)?;
            tail_loc = p.lexer.loc();
            if p.lexer.token != T::TCloseBrace && p.lexer.tolerant {
                let tail = p.missing_template_tail(include_raw)?;
                parts.push(E::TemplatePart {
                    value,
                    tail_loc,
                    tail,
                });
                break 'parse_template_part;
            }
            p.lexer.rescan_close_brace_as_template_token()?;

            let tail: E::TemplateContents = if !include_raw {
                E::TemplateContents::Cooked(p.lexer.to_e_string()?)
            } else {
                E::TemplateContents::Raw(p.lexer.raw_template_contents().into())
            };

            parts.push(E::TemplatePart {
                value,
                tail_loc,
                tail,
            });

            if p.lexer.token == T::TTemplateTail {
                p.lexer.next()?;
                break 'parse_template_part;
            }
            debug_assert!(p.lexer.token != T::TEndOfFile);
        }

        p.allow_in = old_allow_in;

        // `from_bump` leaks into the arena and wraps the unique `&'bump mut [T]`
        // so mutable provenance is preserved for the visit pass.
        Ok((bun_ast::StoreSlice::from_bump(parts), tail_loc))
    }

    /// `parseLiteralOfTemplateSpan` when no "}" follows the expression: 1005, nothing is consumed, and an empty tail ends the template.
    #[cold]
    #[inline(never)]
    fn missing_template_tail(&mut self, include_raw: bool) -> Result<E::TemplateContents, Error> {
        self.lexer.expect(T::TCloseBrace)?;
        // A tagged template with a missing tail is an incomplete call (`hasCorrectArity`).
        self.lexer.unterminated_at = self.lexer.start;
        Ok(if include_raw {
            E::TemplateContents::Raw(b"".into())
        } else {
            E::TemplateContents::Cooked(E::String::init(b""))
        })
    }

    // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
    pub(crate) fn parse_string_literal(&mut self) -> Result<Expr, Error> {
        let p = self;
        let loc = p.lexer.loc();
        let mut str_ = p.lexer.to_e_string()?;
        str_.prefer_template = p.lexer.token == T::TNoSubstitutionTemplateLiteral;

        let expr = p.new_expr(str_, loc);
        p.lexer.next()?;
        Ok(expr)
    }

    pub(crate) fn parse_call_args(&mut self) -> Result<ExprListLoc, Error> {
        // Allow "in" inside call arguments; restored on every exit path
        let old_allow_in = self.allow_in;
        self.allow_in = true;
        let result = self.parse_call_args_inner();
        self.allow_in = old_allow_in;
        result
    }

    fn parse_call_args_inner(&mut self) -> Result<ExprListLoc, Error> {
        let p = self;
        let mut args: smallvec::SmallVec<[Expr; 4]> = smallvec::SmallVec::new();
        p.lexer.expect(T::TOpenParen)?;
        let saved_contexts = p.enter_list(ListKind::ArgumentExpressions);

        while p.lexer.token != T::TCloseParen {
            match p.classify_list_token(ListKind::ArgumentExpressions)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let loc = p.lexer.loc();
            let is_spread = p.lexer.token == T::TDotDotDot;
            if is_spread {
                // p.mark_syntax_feature(compat.rest_argument, p.lexer.range());
                p.lexer.next()?;
            }
            let mut arg = p.parse_expr(Level::Comma)?;
            if is_spread {
                arg = p.new_expr(E::Spread { value: arg }, loc);
            }
            args.push(arg);
            if p.lexer.token != T::TComma {
                if p.recover_missing_comma(ListKind::ArgumentExpressions, loc)? {
                    continue;
                }
                break;
            }
            p.lexer.next()?;
        }
        p.lexer.list_contexts = saved_contexts;
        let mut close_paren_loc = p.lexer.loc();
        if p.lexer.token != T::TCloseParen && p.lexer.tolerant && !p.lexer.is_log_disabled {
            // `finishNode`: without the ")" the call ends where the last token it consumed ends.
            close_paren_loc.start = p.lexer.full_start().start - 1;
        }
        p.lexer.expect(T::TCloseParen)?;
        Ok(ExprListLoc {
            list: ExprNodeList::from_arena_slice(&args),
            loc: close_paren_loc,
        })
    }

    pub(crate) fn parse_jsx_prop_value_identifier(
        &mut self,
        previous_string_with_backslash_loc: &mut bun_ast::Loc,
    ) -> Result<Expr, Error> {
        let p = self;
        // Use NextInsideJSXElement() not Next() so we can parse a JSX-style string literal
        p.lexer.next_inside_jsx_element()?;
        if p.lexer.token == T::TStringLiteral {
            previous_string_with_backslash_loc.start = p
                .lexer
                .loc()
                .start
                .max(p.lexer.previous_backslash_quote_in_jsx.loc.start);
            let estr = p.lexer.to_e_string()?;
            let expr = p.new_expr(estr, *previous_string_with_backslash_loc);

            p.lexer.next_inside_jsx_element()?;
            Ok(expr)
        } else {
            if p.lexer.token != T::TOpenBrace && p.lexer.tolerant {
                return p.parse_jsx_attribute_value_without_braces();
            }
            // Use Expect() not ExpectInsideJSXElement() so we can parse expression tokens
            let open_brace = p.lexer.loc();
            p.lexer.expect(T::TOpenBrace)?;
            if p.lexer.token == T::TCloseBrace && p.lexer.tolerant {
                // `parseJsxExpression`: there may be nothing between the braces. What is missing is put where they open.
                p.lexer.next_inside_jsx_element()?;
                return Ok(p.new_expr(E::Missing {}, open_brace));
            }
            let value = p.parse_expr(Level::Lowest)?;

            if p.lexer.token != T::TCloseBrace && p.lexer.tolerant {
                // `parseExpected`: it is missed, and nothing is consumed.
                p.lexer.expect(T::TCloseBrace)?;
                return Ok(value);
            }
            p.lexer.expect_inside_jsx_element(T::TCloseBrace)?;
            Ok(value)
        }
    }

    /// `parseJsxAttributeValue`, when what follows the "=" is neither a string nor a "{": an element, or nothing at all.
    #[cold]
    #[inline(never)]
    fn parse_jsx_attribute_value_without_braces(&mut self) -> Result<Expr, Error> {
        let p = self;
        if p.is_at_less_than_token() {
            let first = p.lexer.loc();
            return p.parse_jsx_elements_in_attribute_value(first);
        }
        if p.lexer.is_log_disabled {
            return Err(Error::Backtrack);
        }
        // Nothing is consumed, and the attribute is one without a value.
        let range = p.lexer.range();
        p.lexer.ts_error(range, 1145);
        Ok(p.new_expr(E::Boolean { value: true }, range.loc))
    }

    /// Whether the "<" the lexer gave inside a JSX tag is one for TypeScript's scanner too, which makes tokens of their own of
    /// "<<", "<=" and "</", unless the "/" starts a comment (`Scan`).
    fn is_at_less_than_token(&self) -> bool {
        let lexer = &self.lexer;
        lexer.token == T::TLessThan
            && match lexer.code_point {
                0x3C | 0x3D => false,
                0x2F => lexer.contents.get(lexer.current) == Some(&b'*'),
                _ => true,
            }
    }

    /// `parseJsxElementOrSelfClosingElementOrFragment` in an expression context, at its "<". Another element that follows
    /// at once is objected to where the first of them starts, `first`, and joined to this one by a comma.
    fn parse_jsx_elements_in_attribute_value(
        &mut self,
        first: bun_ast::Loc,
    ) -> Result<Expr, Error> {
        let p = self;
        let less_than = p.lexer.loc();
        p.lexer.next_inside_jsx_element()?;
        let element = p.parse_jsx_element(less_than)?;
        // The last ">" is left to the caller. Nothing is consumed for one that is missed.
        if p.lexer.token == T::TGreaterThan {
            p.lexer.next_inside_jsx_element()?;
        }
        if !p.is_at_less_than_token() {
            return Ok(element);
        }
        if p.lexer.is_log_disabled {
            return Err(Error::Backtrack);
        }
        let rest = p.parse_jsx_elements_in_attribute_value(first)?;
        p.lexer
            .ts_error(bun_ast::Range { loc: first, len: 1 }, 2657);
        Ok(element.join_with_comma(rest))
    }

    /// This assumes that the open parenthesis has already been parsed by the caller
    #[inline]
    pub(crate) fn parse_paren_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        if self.lexer.tolerant
            && !opts.is_async
            && !opts.force_arrow_fn
            && !self.lexer.is_log_disabled
        {
            return self.parse_paren_expr_after_lookahead(loc, level, opts);
        }
        self.parse_paren_expr_as(loc, level, opts, ArrowAttempt::Undecided)
    }

    /// `tryParseParenthesizedArrowFunctionExpression`, after the "(" at `loc`, or after "<T>(" if the "<" is at `loc`.
    /// Asks `isParenthesizedArrowFunctionExpression` before parsing.
    #[cold]
    #[inline(never)]
    fn parse_paren_expr_after_lookahead(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;
        let verdict = if level.gt(Level::Assign) {
            // Only `parseAssignmentExpressionOrHigher` tries for an arrow function.
            Some(false)
        } else if p.lexer.contents.get(loc.start as usize) != Some(&b'(') {
            // After type parameters the lookahead cannot tell.
            None
        } else {
            p.is_arrow_function_after_open_paren()
        };
        match verdict {
            // `allowAmbiguity`, `allowReturnTypeInArrowFunction`
            Some(true) => p.parse_paren_expr_as(
                loc,
                level,
                ParenExprOpts {
                    force_arrow_fn: true,
                    is_after_question_and_before_colon: false,
                    ..opts
                },
                ArrowAttempt::Undecided,
            ),
            Some(false) => p.parse_paren_expr_as(loc, level, opts, ArrowAttempt::NeverArrow),
            None => p.parse_paren_expr_as(loc, level, opts, ArrowAttempt::Undecided),
        }
    }

    /// `parse_paren_expr`, told what it may come to.
    fn parse_paren_expr_as(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        mut opts: ParenExprOpts,
        mut attempt: ArrowAttempt,
    ) -> Result<Expr, Error> {
        let p = self;
        let mut items_list = BumpVec::<Expr>::new_in(p.arena);
        let mut errors = DeferredErrors::default();
        let mut arrow_arg_errors = DeferredArrowArgErrors::default();
        let mut spread_range = bun_ast::Range::default();
        let mut type_colon_range = bun_ast::Range::default();
        let mut comma_after_spread = bun_ast::Loc::EMPTY;
        // One bit for each item that had a modifier before it: "(public x) => 0". Only set when parsing for the type checker.
        let mut with_modifiers: u32 = 0;
        // "(a, )". Only set in tolerant mode.
        let mut has_trailing_comma = false;

        // Push a scope assuming this is an arrow function. It may not be, in which
        // case we'll need to roll this change back. This has to be done ahead of
        // parsing the arguments instead of later on when we hit the "=>" token and
        // we know it's an arrow function because the arguments may have default
        // values that introduce new scopes and declare new symbols. If this is an
        // arrow function, then those new scopes will need to be parented under the
        // scope of the arrow function itself.
        let scope_index = p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, loc)?;

        // Allow "in" inside parentheses
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        // Forbid "await" and "yield", but only for arrow functions
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        p.fn_or_arrow_data_parse.arrow_arg_errors = arrow_arg_errors;
        p.fn_or_arrow_data_parse.track_arrow_arg_errors = true;

        // `parseParametersWorker`: the parameters of an async arrow function are read in its [Await] context and in no
        // [Yield] context.
        let are_async_parameters = opts.is_async
            && (opts.force_arrow_fn || attempt == ArrowAttempt::ArrowOrBacktrack)
            && p.lexer.tolerant
            && !p.lexer.is_log_disabled;
        if are_async_parameters {
            p.fn_or_arrow_data_parse.allow_await = AwaitOrYield::AllowExpr;
            p.fn_or_arrow_data_parse.allow_yield = AwaitOrYield::AllowIdent;
            p.fn_or_arrow_data_parse.is_top_level = false;
        }

        // Scan over the comma-separated arguments or expressions
        let saved_contexts = p.lexer.list_contexts;
        while p.lexer.token != T::TCloseParen {
            if opts.force_arrow_fn {
                // `parseDelimitedList(PCParameters)`
                let _ = p.enter_list(ListKind::Parameters);
                match p.classify_list_token(ListKind::Parameters)? {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }
            }
            let item_start = p.lexer.loc();
            let is_spread = p.lexer.token == T::TDotDotDot;

            if is_spread {
                spread_range = p.lexer.range();
                // p.markSyntaxFeature()
                p.lexer.next()?;
            }

            // `parseParameterEx` without `allowAmbiguity`: what starts no parameter name ends the attempt.
            if p.lexer.tolerant
                && !opts.force_arrow_fn
                && attempt != ArrowAttempt::NeverArrow
                && !p.lexer.is_log_disabled
                && !matches!(
                    p.lexer.token,
                    T::TIdentifier | T::TOpenBracket | T::TOpenBrace | T::TThis
                )
                && !(is_spread && items_list.is_empty())
            {
                if attempt == ArrowAttempt::ArrowOrBacktrack {
                    return Err(Error::Backtrack);
                }
                attempt = ArrowAttempt::NeverArrow;
            }

            // We don't know yet whether these are arguments or expressions, so parse
            p.latest_arrow_arg_loc = p.lexer.loc();

            let mut item = Expr::EMPTY;
            let mut has_type = false;
            let question_before = errors.invalid_expr_after_question;
            // "(...": for TypeScript an arrow function whatever follows (`nextIsParenthesizedArrowFunctionExpression`). Not
            // where one is only tried for: type parameters came first then, and after them nothing is sure.
            let is_surely_rest_parameter = is_spread
                && p.lexer.tolerant
                && !p.lexer.is_log_disabled
                && items_list.is_empty()
                && level.lte(Level::Assign)
                && attempt == ArrowAttempt::Undecided;
            if is_surely_rest_parameter {
                opts.force_arrow_fn = true;
            }
            if is_surely_rest_parameter
                && matches!(p.lexer.token, T::TCloseParen | T::TComma | T::TColon)
            {
                // `parseNameOfParameter`: the name is missing. It is put where the dots end (`createMissingIdentifier`).
                p.lexer.expect(T::TIdentifier)?;
                p.latest_arrow_arg_loc = spread_range.end();
                let ref_ = p.store_name_in_ref(b"");
                item = p.new_expr(
                    E::Identifier {
                        ref_,
                        ..Default::default()
                    },
                    p.latest_arrow_arg_loc,
                );
            } else if opts.force_arrow_fn
                && !matches!(
                    p.lexer.token,
                    T::TIdentifier | T::TOpenBracket | T::TOpenBrace | T::TThis
                )
                && p.lexer.tolerant
                && !p.lexer.is_log_disabled
            {
                let has_modifiers = with_modifiers & (1u32 << items_list.len().min(31)) != 0;
                item = p.parse_missing_parameter_name(has_modifiers)?;
            } else if are_async_parameters && p.lexer.is_contextual_keyword(b"await") {
                // `isParameterNameStart`, `parseBindingIdentifier`: a parameter may be called "await" even there. It is
                // `checkContextualIdentifier` that objects, in the words `parse_binding` has for it.
                let range = p.lexer.range();
                p.log().add_range_error(
                    Some(p.source),
                    range,
                    b"Cannot use \"yield\" or \"await\" here.",
                );
                let ref_ = p.store_name_in_ref(p.lexer.identifier);
                item = Expr::init_identifier(ref_, range.loc);
                p.lexer.next()?;
                p.parse_suffix(&mut item, Level::Comma, Some(&mut errors), EFlags::None)?;
            } else {
                p.parse_expr_or_bindings(Level::Comma, Some(&mut errors), &mut item)?;
                if matches!(item.data, js_ast::expr::Data::EMissing(_)) && p.lexer.tolerant {
                    // `createMissingNode` puts it where the previous token ends. 2695 is reported there.
                    item.loc = p.lexer.full_start_of(item.loc.start as usize);
                }
            }

            // "(a?) => {}"
            if p.keeps_type_syntax()
                && errors.invalid_expr_after_question.map(|r| r.loc.start)
                    != question_before.map(|r| r.loc.start)
            {
                p.mark_type_syntax(item.loc, Mark::Optional, item.loc);
            }

            if is_spread {
                // The type checker goes by where an argument of a call of "async" starts (`parseSpreadElement`).
                let dots = if p.lexer.tolerant {
                    spread_range.loc
                } else {
                    loc
                };
                item = p.new_expr(E::Spread { value: item }, dots);
            }

            // Skip over types
            if Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TColon
                && attempt != ArrowAttempt::NeverArrow
            {
                has_type = true;
                // Tolerant mode reports the first ":" if this turns out to be no arrow function.
                if type_colon_range.len == 0 || !p.lexer.tolerant {
                    type_colon_range = p.lexer.range();
                }
                p.lexer.next()?;
                if p.keeps_type_syntax() {
                    let binding = p.latest_arrow_arg_loc;
                    p.mark_type_syntax(binding, Mark::Annotation, p.lexer.loc());
                    if errors.invalid_expr_after_question.map(|r| r.loc.start)
                        != question_before.map(|r| r.loc.start)
                    {
                        p.mark_type_syntax(binding, Mark::Optional, binding);
                    }
                }
                p.skip_type_script_type(Level::Lowest)?;
            }

            // There may be a "=" after the type (but not after an "as" cast)
            if Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TEquals
                && !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())
                // `parseParenthesizedExpression`: only a parameter goes on with "=", after its "?" or its type.
                && (has_type
                    || !p.lexer.tolerant
                    || errors.invalid_expr_after_question.map(|r| r.loc.start)
                        != question_before.map(|r| r.loc.start))
            {
                p.lexer.next()?;
                let rhs = p.parse_expr(Level::Comma)?;
                item = match item.data {
                    // "...a: T = x": the initializer belongs to the parameter (`parseParameterEx`).
                    js_ast::expr::Data::ESpread(spread) if p.lexer.tolerant => p.new_expr(
                        E::Spread {
                            value: Expr::assign(spread.value, rhs),
                        },
                        item.loc,
                    ),
                    _ => Expr::assign(item, rhs),
                };
            }

            items_list.push(item);

            if p.lexer.token != T::TComma {
                if Self::IS_TYPESCRIPT_ENABLED
                    && p.lexer.token != T::TCloseParen
                    && p.lexer.tolerant
                    && !is_spread
                    && level.lte(Level::Assign)
                    && attempt != ArrowAttempt::NeverArrow
                    && p.is_parameter_modifier(item, items_list.len() == 1 || opts.force_arrow_fn)
                {
                    // `parseParameterEx`: the word was a modifier of the parameter that starts here, so this is an arrow function.
                    let _ = items_list.pop();
                    with_modifiers |= 1u32 << items_list.len().min(31);
                    opts.force_arrow_fn = true;
                    continue;
                }
                // `parseDelimitedList(PCParameters)`: the list goes on after a missing comma.
                if opts.force_arrow_fn
                    && p.recover_missing_comma(ListKind::Parameters, item_start)?
                {
                    continue;
                }
                break;
            }

            // Spread arguments must come last. If there's a spread argument followed
            // by a comma, remember where. (TypeScript's parser takes the dots before any parameter: it is
            // `checkGrammarParameterList` that objects.)
            if is_spread && !p.lexer.tolerant {
                comma_after_spread = p.lexer.loc();
            }

            // Eat the comma token
            p.lexer.next()?;
            has_trailing_comma =
                p.lexer.token == T::TCloseParen && p.lexer.tolerant && !p.lexer.is_log_disabled;
        }
        p.lexer.list_contexts = saved_contexts;
        let items: &'a mut [Expr] = items_list.into_bump_slice_mut();

        // `parseParenthesizedArrowFunctionExpression`: an attempt is given up if the list does not come to its ")".
        if p.lexer.token != T::TCloseParen && attempt == ArrowAttempt::ArrowOrBacktrack {
            return Err(Error::Backtrack);
        }

        // The parenthetical construct must end with a close parenthesis
        let close_paren_loc = p.lexer.loc();
        if items.is_empty() && attempt == ArrowAttempt::NeverArrow && !opts.is_async {
            // `parseParenthesizedExpression`: an expression is expected where the ")" is.
            let close_paren = p.lexer.range();
            p.lexer.ts_error(close_paren, 1109);
        }
        p.lexer.expect(T::TCloseParen)?;

        // Restore "in" operator status before we parse the arrow function body
        p.allow_in = old_allow_in;

        // Also restore "await" and "yield" expression errors
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // Are these arguments to an arrow function? (`parseParenthesizedArrowFunctionExpression`: an attempt is kept
        // before a "{" as well, where the "=>" is then missed.)
        let mut is_arrow_fn = p.lexer.token == T::TEqualsGreaterThan
            || (p.lexer.token == T::TOpenBrace
                && (attempt == ArrowAttempt::ArrowOrBacktrack
                    || (attempt == ArrowAttempt::Undecided
                        && p.lexer.tolerant
                        && !p.lexer.is_log_disabled)));
        if (is_arrow_fn
            || opts.force_arrow_fn
            || (Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon))
            // TypeScript tries for an arrow function in `parseAssignmentExpressionOrHigher` only: an operand is what is in the
            // parentheses, and what follows them is left to whoever asked for it.
            && !(level.gt(Level::Assign)
                && !opts.force_arrow_fn
                && p.lexer.tolerant
                && !p.lexer.is_log_disabled)
            && attempt != ArrowAttempt::NeverArrow
        {
            // Arrow functions are not allowed inside certain expressions
            if level.gt(Level::Assign) {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }

            let mut invalid_log = LocList::new_in(p.arena);
            let mut args = BumpVec::<G::Arg>::new_in(p.arena);
            let mut this_parameter = bun_ast::Loc::EMPTY;

            if opts.is_async {
                // markl,oweredsyntaxpoksdpokasd
            }

            // First, try converting the expressions to bindings
            for i in 0..items.len() {
                let mut is_spread = false;
                if let js_ast::expr::Data::ESpread(v) = &items[i].data {
                    is_spread = true;
                    let inner = v.value;
                    items[i] = inner;
                }

                let mut item = items[i];
                let tuple = p.convert_expr_to_binding_and_initializer(
                    &mut item,
                    &mut invalid_log,
                    is_spread,
                );
                if tuple.binding.is_none()
                    && i == 0
                    && !is_spread
                    && p.lexer.tolerant
                    && matches!(item.data, js_ast::expr::Data::EThis(_))
                {
                    // `parseParameterEx` takes `this` for a parameter of any function. It is none of the signature's.
                    let _ = invalid_log.pop();
                    this_parameter = item.loc;
                    continue;
                }
                // double allocations
                args.push(G::Arg {
                    binding: tuple.binding.unwrap_or(Binding {
                        data: B::B::BMissing(B::Missing {}),
                        loc: item.loc,
                    }),
                    default: tuple.expr,
                    is_typescript_ctor_field: with_modifiers & (1u32 << i.min(31)) != 0,
                    ..Default::default()
                });
            }

            // `parseParameterEx`: an attempt is given up at what can be no parameter.
            if !invalid_log.is_empty() && attempt == ArrowAttempt::ArrowOrBacktrack {
                return Err(Error::Backtrack);
            }
            // The parentheses hold an expression then, and the "=>" or "{" is left to the caller.
            if !invalid_log.is_empty()
                && !opts.force_arrow_fn
                && p.lexer.tolerant
                && !p.lexer.is_log_disabled
            {
                is_arrow_fn = false;
            }

            let mut arrow_data = FnOrArrowDataParse {
                allow_await: if opts.is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                ..Default::default()
            };

            // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
            // function. The ":" after the ")" may be a return type annotation, so we
            // attempt to convert the expressions to bindings first before deciding
            // whether this is an arrow function, and only pick an arrow function if
            // there were no conversion errors.
            if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon && invalid_log.is_empty() {
                let return_type_colon = p.lexer.loc();
                if opts.force_arrow_fn && p.lexer.tolerant && !p.lexer.is_log_disabled {
                    // `allowAmbiguity`: the ":" starts the return type, whatever follows the type.
                    is_arrow_fn = true;
                    p.lexer.next()?;
                    p.skip_typescript_return_type()?;
                } else if opts.is_after_question_and_before_colon {
                    // Only do this very expensive check if we must
                    is_arrow_fn = p
                        .is_type_script_arrow_return_type_after_question_and_before_colon(
                            &arrow_data,
                        )?;
                    if is_arrow_fn {
                        // We know this will succeed because we've already done it once above
                        p.lexer.next()?;
                        p.skip_typescript_return_type()?;
                    }
                } else {
                    // Otherwise, do the less expensive check
                    is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();
                }
                if is_arrow_fn {
                    p.mark_type_syntax(p.lexer.loc(), Mark::ReturnType, return_type_colon);
                }
            }

            if is_arrow_fn || opts.force_arrow_fn {
                p.maybe_comma_spread_error(comma_after_spread);
                p.log_arrow_arg_errors(&mut arrow_arg_errors);
                if !this_parameter.is_empty() {
                    // `checkParameter`
                    p.log().add_range_error(
                        Some(p.source),
                        bun_ast::Range {
                            loc: this_parameter,
                            len: 4,
                        },
                        b"TC2730",
                    );
                }

                // Now that we've decided we're an arrow function, report binding pattern
                // conversion errors
                if !invalid_log.is_empty() {
                    for loc_ in invalid_log.iter() {
                        loc_.add_error(p.log(), p.source);
                    }
                }
                let args_slice: &'a mut [G::Arg] = args.into_bump_slice_mut();
                let has_arrow_token = p.lexer.token == T::TEqualsGreaterThan;
                let body_flags = if opts.is_after_question_and_before_colon {
                    EFlags::AfterQuestionAndBeforeColon
                } else {
                    EFlags::None
                };
                let mut arrow =
                    p.parse_arrow_body_with_flags(args_slice, &mut arrow_data, body_flags)?;
                arrow.is_async = opts.is_async;
                arrow.has_rest_arg = spread_range.len > 0;
                p.pop_scope();
                if !has_arrow_token
                    && arrow.prefer_expr
                    && p.lexer.tolerant
                    && p.lexer.token != T::TComma
                {
                    // `parseAssignmentExpressionOrHigher` returns the arrow function as it is. After a body that is missing, the
                    // next token must not be taken for a suffix of it.
                    p.forbid_suffix_after_as_loc = p.lexer.loc();
                }
                return Ok(p.new_expr(arrow, loc));
            }
        }

        if attempt == ArrowAttempt::ArrowOrBacktrack {
            return Err(Error::Backtrack);
        }

        // If we get here, it's not an arrow function so undo the pushing of the
        // scope we did earlier. This needs to flatten any child scopes into the
        // parent scope as if the scope was never pushed in the first place.
        p.pop_and_flatten_scope(scope_index);

        // If this isn't an arrow function, then types aren't allowed
        if type_colon_range.len > 0 {
            if !p.lexer.tolerant || p.lexer.is_log_disabled {
                p.log()
                    .add_range_error(Some(p.source), type_colon_range, b"Unexpected \":\"");
                return Err(crate::Error::SyntaxError);
            }
            // `parseParenthesizedExpression`: the ")" is expected at the ":".
            p.lexer.ts_error(type_colon_range, 1005);
        }

        // Are these arguments for a call to a function named "async"?
        if opts.is_async {
            p.log_expr_errors(&mut errors);
            let async_ref = p.store_name_in_ref(b"async");
            let async_expr = p.new_expr(
                E::Identifier {
                    ref_: async_ref,
                    ..Default::default()
                },
                loc,
            );
            return Ok(p.new_expr(
                E::Call {
                    target: async_expr,
                    args: ExprNodeList::from_arena_slice(items),
                    // The type checker tells calls apart by it. The printer would add a mapping for it.
                    close_paren_loc: if p.keeps_type_syntax() {
                        close_paren_loc
                    } else {
                        bun_ast::Loc::EMPTY
                    },
                    ..Default::default()
                },
                loc,
            ));
        }

        // Is this a chain of expressions and comma operators?
        if items.len() > 0 {
            p.log_expr_errors(&mut errors);
            if spread_range.len > 0 {
                if !p.lexer.tolerant || p.lexer.is_log_disabled {
                    p.log().add_range_error(
                        Some(p.source),
                        type_colon_range,
                        b"Unexpected \"...\"",
                    );
                    return Err(crate::Error::SyntaxError);
                }
                // `parsePrimaryExpression`: no expression starts with the dots.
                p.lexer.ts_error(spread_range, 1109);
                for item in items.iter_mut() {
                    if let js_ast::expr::Data::ESpread(spread) = item.data {
                        *item = spread.value;
                    }
                }
            }

            let mut value = if p.lexer.tolerant {
                p.join_with_commas_keeping_missing(items)
            } else {
                Expr::join_all_with_comma(items)
            };
            if has_trailing_comma {
                // `parseExpression`: an operand is expected after every ",".
                p.lexer.ts_error(
                    bun_ast::Range {
                        loc: close_paren_loc,
                        len: 1,
                    },
                    1109,
                );
                let missing_loc = p.lexer.full_start_of(close_paren_loc.start as usize);
                let missing = p.new_expr(E::Missing {}, missing_loc);
                value = p.join_with_commas_keeping_missing(&[value, missing]);
            }
            p.mark_expr_as_parenthesized(&mut value);
            p.mark_paren(&value, loc);
            return Ok(value);
        }

        if p.lexer.tolerant && !p.lexer.is_log_disabled {
            // "()", or "<T>()" that turned out to be a cast: 1109 at the ")". Not said twice.
            p.lexer.ts_error(
                bun_ast::Range {
                    loc: close_paren_loc,
                    len: 1,
                },
                1109,
            );
            let value = p.new_expr(E::Missing {}, close_paren_loc);
            p.mark_paren(&value, loc);
            return Ok(value);
        }

        // Indicate that we expected an arrow function
        p.lexer.expected(T::TEqualsGreaterThan)?;
        Err(crate::Error::SyntaxError)
    }

    /// `Expr::join_all_with_comma` drops missing operands. TypeScript keeps them (`makeBinaryExpression`), and reports 2695 for
    /// the operand to their left.
    #[cold]
    #[inline(never)]
    fn join_with_commas_keeping_missing(&mut self, items: &[Expr]) -> Expr {
        let mut joined = items[0];
        for item in &items[1..] {
            joined = self.new_expr(
                E::Binary {
                    op: js_ast::op::Code::BinComma,
                    left: joined,
                    right: *item,
                },
                joined.loc,
            );
        }
        joined
    }

    /// `parseNameOfParameter` where no name starts: reports it and returns a name that is missing.
    #[cold]
    #[inline(never)]
    fn parse_missing_parameter_name(&mut self, has_modifiers: bool) -> Result<Expr, Error> {
        let p = self;
        // `createIdentifierWithDiagnostic`
        let range = p.lexer.range();
        let code = if p.lexer.token == T::TPrivateIdentifier {
            18009
        } else if p.lexer.token.is_reserved_word() || p.lexer.token == T::TEscapedKeyword {
            1359
        } else {
            1003
        };
        p.lexer.ts_error(range, code);
        p.latest_arrow_arg_loc = p.lexer.full_start();
        let ref_ = p.store_name_in_ref(b"");
        let name = Expr::init_identifier(ref_, p.latest_arrow_arg_loc);
        // A modifier keyword that can be no name is skipped, so that the list makes progress.
        if !has_modifiers && p.is_modifier_kind() {
            p.lexer.next()?;
        }
        Ok(name)
    }

    pub(crate) fn parse_label_name(&mut self) -> Result<Option<js_ast::LocRef>, Error> {
        let p = self;
        if p.lexer.token != T::TSemicolon && p.lexer.tolerant && !p.lexer.is_log_disabled {
            return p.parse_identifier_unless_at_semicolon();
        }
        if p.lexer.token != T::TIdentifier || p.lexer.has_newline_before {
            return Ok(None);
        }

        let name = LocRef {
            loc: p.lexer.loc(),
            ref_: p.store_name_in_ref(p.lexer.identifier),
        };
        p.lexer.next()?;
        Ok(Some(name))
    }

    /// `parseIdentifierUnlessAtSemicolon`
    #[cold]
    #[inline(never)]
    fn parse_identifier_unless_at_semicolon(&mut self) -> Result<Option<js_ast::LocRef>, Error> {
        let p = self;
        // `canParseSemicolon`
        if p.lexer.has_newline_before
            || matches!(
                p.lexer.token,
                T::TSemicolon | T::TCloseBrace | T::TEndOfFile
            )
        {
            return Ok(None);
        }
        if !p.is_identifier_in_context() {
            // `createIdentifierWithDiagnostic`
            let range = p.lexer.range();
            if p.lexer.token != T::TPrivateIdentifier {
                // Nothing is consumed: the ";" that is missed next is missed at the same place, which is not said again.
                let is_reserved_word =
                    p.lexer.token.is_reserved_word() || p.lexer.token == T::TEscapedKeyword;
                p.lexer
                    .ts_error(range, if is_reserved_word { 1359 } else { 1003 });
                return Ok(None);
            }
            // A private name is objected to, and taken for the name all the same.
            p.lexer.ts_error(range, 18016);
        }
        let name = LocRef {
            loc: p.lexer.loc(),
            ref_: p.store_name_in_ref(p.lexer.identifier),
        };
        p.lexer.next()?;
        Ok(Some(name))
    }

    /// `isIdentifier`: "await" is no name in an [Await] context, nor "yield" in a [Yield] context.
    pub(crate) fn is_identifier_in_context(&self) -> bool {
        let data = &self.fn_or_arrow_data_parse;
        self.lexer.token == T::TIdentifier
            && !(self.lexer.identifier == b"await"
                && data.allow_await != AwaitOrYield::AllowIdent
                // TypeScript reads the statements of a file in no [Await] context, whatever can be awaited there.
                && !(data.is_top_level && data.allow_await == AwaitOrYield::AllowExpr))
            && !(self.lexer.identifier == b"yield" && data.allow_yield != AwaitOrYield::AllowIdent)
    }

    pub(crate) fn parse_class_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<Stmt, Error> {
        let p = self;
        let mut name: Option<js_ast::LocRef> = None;
        let class_keyword = p.lexer.range();
        if p.lexer.token == T::TClass {
            //marksyntaxfeature
            p.lexer.next()?;
        } else {
            p.lexer.expected(T::TClass)?;
        }

        let is_identifier = p.lexer.token == T::TIdentifier;

        // `parseNameOfClassDeclarationOrExpression`: for TypeScript's parser the name is always optional. Its checker reports 1211.
        if (!opts.is_name_optional && !p.lexer.tolerant)
            || (is_identifier
                && (!Self::IS_TYPESCRIPT_ENABLED
                    || p.lexer.identifier != b"implements"
                    // `isImplementsClause`: for TypeScript it is the name unless a name or a keyword follows it.
                    || (p.lexer.tolerant
                        && !p.next_token_matches(|p| p.lexer.is_identifier_or_keyword()))))
        {
            let name_loc = p.lexer.loc();
            let name_text = p.lexer.identifier;
            p.lexer.expect(T::TIdentifier)?;

            // We must return here
            // or the lexer will crash loop!
            // example:
            // export class {}
            if !is_identifier {
                return Err(crate::Error::SyntaxError);
            }

            if p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                && name_text == b"await"
            {
                p.log().add_range_error(
                    Some(p.source),
                    if p.lexer.tolerant {
                        // `checkContextualIdentifier` reports the name. The lexer is already past it.
                        bun_ast::Range {
                            loc: name_loc,
                            len: name_text.len() as i32,
                        }
                    } else {
                        p.lexer.range()
                    },
                    b"Cannot use \"await\" as an identifier here",
                );
            }

            name = Some(LocRef {
                loc: name_loc,
                ref_: js_ast::Ref::NONE,
            });
            if !opts.is_typescript_declare {
                name.as_mut().unwrap().ref_ = p
                    .declare_symbol(js_ast::symbol::Kind::Class, name_loc, name_text)
                    .expect("unreachable");
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(
                TypeParameterFlag::ALLOW_IN_OUT_VARIANCE_ANNOTATIONS
                    | TypeParameterFlag::ALLOW_CONST_MODIFIER,
            )?;
        }
        let mut class_opts = ParseClassOptions {
            allow_ts_decorators: true,
            is_type_script_declare: opts.is_typescript_declare,
            ..Default::default()
        };
        if let Some(dec) = &opts.ts_decorators {
            class_opts.ts_decorators = dec.values;
        }

        let scope_index = p
            .push_scope_for_parse_pass(js_ast::scope::Kind::ClassName, loc)
            .expect("unreachable");
        let class = p.parse_class(class_keyword, name, &class_opts)?;

        if Self::IS_TYPESCRIPT_ENABLED {
            if opts.is_typescript_declare {
                p.pop_and_discard_scope(scope_index);
                if opts.scope.is_namespace() && opts.is_export {
                    p.has_non_local_export_declare_inside_namespace = true;
                }

                return Ok(p.s(S::TypeScript::default(), loc));
            }
        }

        p.pop_scope();
        // `parse_type_script_namespace_stmt` unwraps the name of each exported class.
        let is_nameless_in_namespace =
            p.lexer.tolerant && class.class_name.is_none() && opts.scope.is_namespace();
        Ok(p.s(
            S::Class {
                class,
                is_export: opts.is_export && !is_nameless_in_namespace,
            },
            loc,
        ))
    }

    pub(crate) fn parse_clause_alias(&mut self, _kind: &[u8]) -> Result<&'a [u8], Error> {
        let p = self;
        let loc = p.lexer.loc();

        // The alias may now be a utf-16 (not wtf-16) string (see https://github.com/tc39/ecma262/pull/2154)
        if p.lexer.token == T::TStringLiteral {
            let estr = p.lexer.to_e_string()?;
            if estr.is_utf8() {
                // SAFETY: E::String slices are arena-owned for 'a.
                return Ok(unsafe { bun_collections::detach_lifetime(estr.slice8()) });
            } else {
                // Lone surrogates are replaced with U+FFFD; the surrogate-error
                // diagnostic path is dropped until the strict variant lands.
                let alias_utf8 = strings::to_utf8_alloc_with_type(estr.slice16());
                let leaked: &'a [u8] = p.arena.alloc_slice_copy(&alias_utf8);
                return Ok(leaked);
            }
        }

        // The alias may be a keyword
        if !p.lexer.is_identifier_or_keyword() {
            p.lexer.expect(T::TIdentifier)?;
        }

        let alias = p.lexer.identifier;
        p.check_for_non_bmp_code_point(loc, alias);
        Ok(alias)
    }

    pub(crate) fn parse_expr_or_let_stmt(
        &mut self,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<ExprOrLetStmt, Error> {
        let p = self;
        let token_range = p.lexer.range();

        if p.lexer.token != T::TIdentifier {
            return Ok(ExprOrLetStmt {
                stmt_or_expr: js_ast::StmtOrExpr::Expr(p.parse_expr(Level::Lowest)?),
                ..Default::default()
            });
        }

        let raw = p.lexer.raw();
        if raw == b"let" {
            p.lexer.next()?;

            match p.lexer.token {
                T::TIdentifier | T::TOpenBracket | T::TOpenBrace => {
                    if opts.lexical_decl == LexicalDecl::AllowAll
                        || !p.lexer.has_newline_before
                        || p.lexer.token == T::TOpenBracket
                        // `isLetDeclaration` does not ask about line breaks.
                        || p.lexer.tolerant
                    {
                        if opts.lexical_decl != LexicalDecl::AllowAll {
                            p.forbid_lexical_decl(token_range.loc);
                        }

                        let decls = p.parse_and_declare_decls(js_ast::symbol::Kind::Other, opts)?;
                        let decls_slice = bun_collections::RawSlice::new(decls.slice());
                        return Ok(ExprOrLetStmt {
                            stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                                S::Local {
                                    kind: js_ast::LocalKind::KLet,
                                    decls,
                                    is_export: opts.is_export,
                                    ..Default::default()
                                },
                                token_range.loc,
                            )),
                            decls: decls_slice,
                        });
                    }
                }
                _ => {}
            }
        } else if raw == b"using" {
            // Handle an "using" declaration
            if opts.is_export {
                p.log().add_error(
                    Some(p.source),
                    token_range.loc,
                    b"Cannot use \"export\" with a \"using\" declaration",
                );
            }

            p.lexer.next()?;

            // `isUsingDeclaration`: TypeScript's parser also takes an object pattern. Its checker reports 1492.
            if (p.lexer.token == T::TIdentifier
                || (p.lexer.token == T::TOpenBrace && p.lexer.tolerant))
                && !p.lexer.has_newline_before
                // `nextTokenIsBindingIdentifierOrStartOfDestructuringOnSameLineDisallowOf`: in `for (using of x)`, "using" is a name.
                && !(p.lexer.tolerant
                    && opts.is_for_loop_init
                    && p.lexer.is_contextual_keyword(b"of")
                    && !p.next_token_matches(|p| {
                        matches!(p.lexer.token, T::TEquals | T::TSemicolon | T::TColon)
                    }))
            {
                if opts.lexical_decl != LexicalDecl::AllowAll {
                    p.forbid_lexical_decl(token_range.loc);
                }
                // p.markSyntaxFeature(.using, token_range.loc);
                opts.is_using_statement = true;
                let decls = p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, opts)?;
                let decls_slice = bun_collections::RawSlice::new(decls.slice());
                if opts.is_typescript_declare {
                    // TypeScript does not allow "using" declarations in ambient
                    // contexts ("declare using x", "declare namespace { using x }").
                    // Their bindings are also never declared as symbols, so
                    // require_initializers (which looks up the binding's symbol)
                    // must not run here.
                    p.log().add_error(
                        Some(p.source),
                        token_range.loc,
                        b"Cannot use \"declare\" with a \"using\" declaration",
                    );
                } else if !opts.is_for_loop_init {
                    p.require_initializers(js_ast::LocalKind::KUsing, decls.slice())?;
                }
                return Ok(ExprOrLetStmt {
                    stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                        S::Local {
                            kind: js_ast::LocalKind::KUsing,
                            decls,
                            // The "export" is an error, but it makes the file a module.
                            is_export: p.lexer.tolerant && opts.is_export,
                            ..Default::default()
                        },
                        token_range.loc,
                    )),
                    decls: decls_slice,
                });
            }
        } else if raw == b"await"
            && (p.fn_or_arrow_data_parse.allow_await == AwaitOrYield::AllowExpr
                || (p.lexer.tolerant && !p.lexer.is_log_disabled && p.is_await_using_declaration()))
        {
            // Handle an "await using" declaration
            if opts.is_export {
                p.log().add_error(
                    Some(p.source),
                    token_range.loc,
                    b"Cannot use \"export\" with an \"await using\" declaration",
                );
            }

            if p.fn_or_arrow_data_parse.is_top_level {
                p.top_level_await_keyword = token_range;
            }

            p.lexer.next()?;

            let raw2 = p.lexer.raw();
            let mut value = if p.lexer.token == T::TIdentifier && raw2 == b"using" {
                'value: {
                    // const using_loc = p.saveExprCommentsHere();
                    let using_range = p.lexer.range();
                    p.lexer.next()?;
                    if (p.lexer.token == T::TIdentifier
                        || (p.lexer.token == T::TOpenBrace && p.lexer.tolerant))
                        && !p.lexer.has_newline_before
                    {
                        if p.lexer.tolerant && p.is_empty_declaration_list_before_of(using_range) {
                            return Ok(ExprOrLetStmt {
                                stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                                    S::Local {
                                        kind: js_ast::LocalKind::KAwaitUsing,
                                        ..Default::default()
                                    },
                                    token_range.loc,
                                )),
                                ..Default::default()
                            });
                        }

                        // It's an "await using" declaration if we get here
                        if opts.lexical_decl != LexicalDecl::AllowAll {
                            p.forbid_lexical_decl(using_range.loc);
                        }
                        // p.markSyntaxFeature(.using, using_range.loc);
                        opts.is_using_statement = true;
                        let decls =
                            p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, opts)?;
                        let decls_slice = bun_collections::RawSlice::new(decls.slice());
                        if opts.is_typescript_declare {
                            p.log().add_error(
                                Some(p.source),
                                token_range.loc,
                                b"Cannot use \"declare\" with an \"await using\" declaration",
                            );
                        } else if !opts.is_for_loop_init {
                            p.require_initializers(js_ast::LocalKind::KAwaitUsing, decls.slice())?;
                        }
                        return Ok(ExprOrLetStmt {
                            stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                                S::Local {
                                    kind: js_ast::LocalKind::KAwaitUsing,
                                    decls,
                                    is_export: p.lexer.tolerant && opts.is_export,
                                    ..Default::default()
                                },
                                token_range.loc,
                            )),
                            decls: decls_slice,
                        });
                    }
                    let r = p.store_name_in_ref(raw2);
                    break 'value p.new_expr(
                        E::Identifier {
                            ref_: r,
                            ..Default::default()
                        },
                        // TODO: implement saveExprCommentsHere and use using_loc here
                        using_range.loc,
                    );
                }
            } else {
                p.parse_expr(Level::Prefix)?
            };

            if p.lexer.token == T::TAsteriskAsterisk {
                if p.lexer.tolerant && !p.lexer.is_log_disabled {
                    // `parseUnaryExpressionOrHigher`: the await expression is on the left of "**".
                    let len = p.lexer.start as i32 - token_range.loc.start;
                    p.lexer.ts_error(
                        bun_ast::Range {
                            loc: token_range.loc,
                            len,
                        },
                        17006,
                    );
                } else {
                    p.lexer.unexpected()?;
                }
            }
            p.parse_suffix(&mut value, Level::Prefix, None, EFlags::None)?;
            let mut expr = p.new_expr(E::Await { value }, token_range.loc);
            p.parse_suffix(&mut expr, Level::Lowest, None, EFlags::None)?;
            return Ok(ExprOrLetStmt {
                stmt_or_expr: js_ast::StmtOrExpr::Expr(expr),
                ..Default::default()
            });
        } else {
            return Ok(ExprOrLetStmt {
                stmt_or_expr: js_ast::StmtOrExpr::Expr(p.parse_expr(Level::Lowest)?),
                ..Default::default()
            });
        }

        // Parse the remainder of this expression that starts with an identifier
        let ref_ = p.store_name_in_ref(raw);
        let mut result = ExprOrLetStmt {
            stmt_or_expr: js_ast::StmtOrExpr::Expr(p.new_expr(
                E::Identifier {
                    ref_,
                    ..Default::default()
                },
                token_range.loc,
            )),
            ..Default::default()
        };
        if let js_ast::StmtOrExpr::Expr(ref mut e) = result.stmt_or_expr {
            p.parse_suffix(e, Level::Lowest, None, EFlags::None)?;
        }
        Ok(result)
    }

    pub(crate) fn parse_binding(&mut self, opts: ParseBindingOptions) -> Result<Binding, Error> {
        let p = self;
        if !p.stack_check.is_safe_to_recurse() {
            return Err(crate::Error::StackOverflow);
        }
        let loc = p.lexer.loc();

        match p.lexer.token {
            T::TIdentifier => {
                let name = p.lexer.identifier;
                if (p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                    && name == b"await")
                    || (p.fn_or_arrow_data_parse.allow_yield != AwaitOrYield::AllowIdent
                        && name == b"yield")
                {
                    // TODO: add fmt to addRangeError
                    p.log().add_range_error(
                        Some(p.source),
                        p.lexer.range(),
                        b"Cannot use \"yield\" or \"await\" here.",
                    );
                }

                let ref_ = p.store_name_in_ref(name);
                p.lexer.next()?;
                return Ok(p.b(B::Identifier { r#ref: ref_ }, loc));
            }
            T::TOpenBracket => {
                // `parseVariableDeclarationWorker` takes a pattern after "using" too.
                if !opts.is_using_statement || p.lexer.tolerant {
                    p.lexer.next()?;
                    let mut is_single_line = !p.lexer.has_newline_before;
                    let mut items = BumpVec::<ArrayBinding>::new_in(p.arena);
                    let mut has_spread = false;

                    // "in" expressions are allowed
                    let old_allow_in = p.allow_in;
                    p.allow_in = true;

                    let saved_contexts = p.enter_list(ListKind::ArrayBindingElements);
                    while p.lexer.token != T::TCloseBracket {
                        match p.classify_list_token(ListKind::ArrayBindingElements)? {
                            ListStep::Element => {}
                            ListStep::Skipped => continue,
                            ListStep::Over => break,
                        }
                        let element_start = p.lexer.loc();
                        if p.lexer.token == T::TComma {
                            items.push(ArrayBinding {
                                binding: Binding {
                                    data: B::B::BMissing(B::Missing {}),
                                    loc: p.lexer.loc(),
                                },
                                default_value: None,
                            });
                        } else {
                            let is_rest = p.lexer.token == T::TDotDotDot;
                            if p.lexer.token == T::TDotDotDot {
                                p.lexer.next()?;
                                has_spread = true;

                                // This was a bug in the ES2015 spec that was fixed in ES2016
                                if p.lexer.token != T::TIdentifier {
                                    // p.markSyntaxFeature(compat.NestedRestBinding, p.lexer.Range())
                                }
                            }

                            // `parseArrayBindingElement`: what is said of a private name that is an element does not depend on what
                            // the pattern is for.
                            let binding = p.parse_binding(ParseBindingOptions::default())?;

                            let mut default_value: Option<Expr> = None;
                            // `parseArrayBindingElement`: TypeScript's parser takes an initializer after any element.
                            if p.lexer.token == T::TEquals && (!has_spread || p.lexer.tolerant) {
                                p.lexer.next()?;
                                default_value = Some(p.parse_expr(Level::Comma)?);
                            }

                            items.push(ArrayBinding {
                                binding,
                                default_value,
                            });

                            // Commas after spread elements are not allowed
                            if has_spread && p.lexer.token == T::TComma {
                                if !p.lexer.tolerant {
                                    p.log().add_range_error(
                                        Some(p.source),
                                        p.lexer.range(),
                                        b"Unexpected \",\" after rest pattern",
                                    );
                                    return Err(crate::Error::SyntaxError);
                                }
                                if is_rest {
                                    p.check_comma_after_rest_element(T::TCloseBracket);
                                }
                            }
                        }

                        if p.lexer.token != T::TComma {
                            if p.recover_missing_comma(
                                ListKind::ArrayBindingElements,
                                element_start,
                            )? {
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
                    p.lexer.list_contexts = saved_contexts;

                    p.allow_in = old_allow_in;

                    if p.lexer.has_newline_before {
                        is_single_line = false;
                    }
                    p.lexer.expect(T::TCloseBracket)?;
                    return Ok(p.b(
                        B::Array {
                            items: bun_ast::StoreSlice::new_mut(items.into_bump_slice_mut()),
                            has_spread,
                            is_single_line,
                        },
                        loc,
                    ));
                }
            }
            T::TOpenBrace => {
                if !opts.is_using_statement || p.lexer.tolerant {
                    // p.markSyntaxFeature(compat.Destructuring, p.lexer.Range())
                    p.lexer.next()?;
                    let mut is_single_line = !p.lexer.has_newline_before;
                    let mut properties = BumpVec::<B::Property>::new_in(p.arena);

                    // "in" expressions are allowed
                    let old_allow_in = p.allow_in;
                    p.allow_in = true;

                    let saved_contexts = p.enter_list(ListKind::ObjectBindingElements);
                    while p.lexer.token != T::TCloseBrace {
                        match p.classify_list_token(ListKind::ObjectBindingElements)? {
                            ListStep::Element => {}
                            ListStep::Skipped => continue,
                            ListStep::Over => break,
                        }
                        let element_start = p.lexer.loc();

                        let property = p.parse_property_binding()?;
                        let is_spread = property.flags.contains(Flags::Property::IsSpread);
                        properties.push(property);

                        // Commas after spread elements are not allowed
                        if is_spread && p.lexer.token == T::TComma {
                            if !p.lexer.tolerant {
                                p.log().add_range_error(
                                    Some(p.source),
                                    p.lexer.range(),
                                    b"Unexpected \",\" after rest pattern",
                                );
                                return Err(crate::Error::SyntaxError);
                            }
                            p.check_comma_after_rest_element(T::TCloseBrace);
                        }

                        if p.lexer.token != T::TComma {
                            if p.recover_missing_comma(
                                ListKind::ObjectBindingElements,
                                element_start,
                            )? {
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
                    p.lexer.list_contexts = saved_contexts;

                    p.allow_in = old_allow_in;

                    if p.lexer.has_newline_before {
                        is_single_line = false;
                    }
                    p.lexer.expect(T::TCloseBrace)?;

                    return Ok(p.b(
                        B::Object {
                            properties: bun_ast::StoreSlice::new_mut(
                                properties.into_bump_slice_mut(),
                            ),
                            is_single_line,
                        },
                        loc,
                    ));
                }
            }
            _ => {}
        }

        if p.lexer.token == T::TPrivateIdentifier && p.lexer.tolerant && !p.lexer.is_log_disabled {
            // `createIdentifierWithDiagnostic`: objected to, and taken for the name all the same.
            let range = p.lexer.range();
            let code = match opts.private_name_code {
                0 => 18016,
                code => u32::from(code),
            };
            p.lexer.ts_error(range, code);
            let ref_ = p.store_name_in_ref(p.lexer.identifier);
            p.lexer.next()?;
            return Ok(p.b(B::Identifier { r#ref: ref_ }, loc));
        }

        if p.lexer.tolerant && !p.lexer.is_log_disabled {
            return p.parse_missing_binding_name();
        }
        p.lexer.expect(T::TIdentifier)?;
        Ok(Binding {
            loc,
            data: B::B::BMissing(B::Missing {}),
        })
    }

    /// `createIdentifierWithDiagnostic`, `createMissingIdentifier`: reports the missing name and consumes nothing. The name is where the
    /// previous token ends.
    #[cold]
    #[inline(never)]
    fn parse_missing_binding_name(&mut self) -> Result<Binding, Error> {
        let loc = self.lexer.full_start();
        if self.lexer.token == T::TEndOfFile {
            // At the end of the file the error is there too.
            self.lexer.ts_error(bun_ast::Range { loc, len: 0 }, 1003);
        } else {
            self.lexer.expect(T::TIdentifier)?;
        }
        Ok(Binding {
            loc,
            data: B::B::BMissing(B::Missing {}),
        })
    }

    /// `checkGrammarBindingElement`: 1013 for a comma after a rest element that is the last of its pattern. Call at the comma.
    #[cold]
    #[inline(never)]
    fn check_comma_after_rest_element(&mut self, closing: T) {
        if self.next_token_matches(|p| p.lexer.token == closing) {
            let comma = self.lexer.range();
            self.lexer.ts_grammar_error(comma, 1013);
        }
    }

    pub(crate) fn parse_property_binding(&mut self) -> Result<B::Property, Error> {
        let p = self;
        // Every match arm below assigns `key` (or `return`s) before any read.
        let key: Expr;
        let mut is_computed = false;

        match p.lexer.token {
            T::TDotDotDot => {
                p.lexer.next()?;
                if p.lexer.tolerant {
                    return p.parse_rest_property_binding();
                }
                let ident_ref = p.store_name_in_ref(p.lexer.identifier);
                let value = p.b(B::Identifier { r#ref: ident_ref }, p.lexer.loc());
                p.lexer.expect(T::TIdentifier)?;
                return Ok(B::Property {
                    key: p.new_expr(E::Missing {}, p.lexer.loc()),
                    flags: Flags::Property::IsSpread.into(),
                    value,
                    default_value: None,
                });
            }
            T::TNumericLiteral => {
                key = p.new_expr(E::Number::new(p.lexer.number), p.lexer.loc());
                // check for legacy octal literal
                p.lexer.next()?;
            }
            T::TStringLiteral => {
                key = p.parse_string_literal()?;
            }
            T::TBigIntegerLiteral => {
                key = p.new_expr(
                    E::BigInt {
                        value: p.lexer.identifier.into(),
                    },
                    p.lexer.loc(),
                );
                // p.markSyntaxFeature(compat.BigInt, p.lexer.Range())
                p.lexer.next()?;
            }
            T::TOpenBracket => {
                is_computed = true;
                p.lexer.next()?;
                let mut expr = p.parse_expr(Level::Comma)?;
                if p.lexer.token == T::TComma && p.lexer.tolerant {
                    // `parseComputedPropertyName` takes any expression: `checkGrammarComputedPropertyName` objects to the comma.
                    p.parse_suffix(&mut expr, Level::Lowest, None, EFlags::None)?;
                }
                key = expr;
                p.lexer.expect(T::TCloseBracket)?;
            }
            _ => {
                let mut name = p.lexer.identifier;
                let loc = p.lexer.loc();
                // `isBindingIdentifier`
                let is_binding_identifier = p.lexer.token == T::TIdentifier;

                // `parsePropertyName`: for TypeScript's parser a private name is a name.
                if !p.lexer.is_identifier_or_keyword()
                    && !(p.lexer.token == T::TPrivateIdentifier && p.lexer.tolerant)
                {
                    p.lexer.expect(T::TIdentifier)?;
                    if p.lexer.tolerant {
                        // The missing name was reported, and nothing was consumed.
                        name = b"";
                    } else {
                        p.lexer.next()?;
                    }
                } else {
                    p.lexer.next()?;
                }

                key = p.new_expr(
                    E::String {
                        data: name.into(),
                        ..Default::default()
                    },
                    loc,
                );

                // `parseObjectBindingElement`: for TypeScript a name that no ":" follows stands for itself whatever follows, and a
                // reserved word is no name (`isBindingIdentifier`).
                if p.lexer.token != T::TColon
                    && (p.lexer.token != T::TOpenParen || p.lexer.tolerant)
                    && (is_binding_identifier || !p.lexer.tolerant)
                {
                    // `checkContextualIdentifier`, as in `parse_binding`.
                    if p.lexer.tolerant
                        && !p.lexer.is_log_disabled
                        && ((p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                            && name == b"await")
                            || (p.fn_or_arrow_data_parse.allow_yield != AwaitOrYield::AllowIdent
                                && name == b"yield"))
                    {
                        p.log().add_range_error(
                            Some(p.source),
                            bun_ast::Range {
                                loc,
                                len: name.len() as i32,
                            },
                            b"Cannot use \"yield\" or \"await\" here.",
                        );
                    }
                    let ref_ = p.store_name_in_ref(name);
                    let value = p.b(B::Identifier { r#ref: ref_ }, loc);
                    let mut default_value: Option<Expr> = None;
                    if p.lexer.token == T::TEquals {
                        p.lexer.next()?;
                        default_value = Some(p.parse_expr(Level::Comma)?);
                    }

                    return Ok(B::Property {
                        flags: Flags::PROPERTY_NONE,
                        key,
                        value,
                        default_value,
                    });
                }
            }
        }

        p.lexer.expect(T::TColon)?;
        let value = p.parse_binding(ParseBindingOptions::default())?;

        let mut default_value: Option<Expr> = None;
        if p.lexer.token == T::TEquals {
            p.lexer.next()?;
            default_value = Some(p.parse_expr(Level::Comma)?);
        }

        Ok(B::Property {
            flags: if is_computed {
                Flags::Property::IsComputed.into()
            } else {
                Flags::PROPERTY_NONE
            },
            key,
            value,
            default_value,
        })
    }

    /// `parseObjectBindingElement` after the `...`: TypeScript's parser reads what follows like any other element. Its checker reports
    /// a property name (2566) or an initializer (1186).
    #[cold]
    #[inline(never)]
    fn parse_rest_property_binding(&mut self) -> Result<B::Property, Error> {
        let p = self;
        let mut property = if p.lexer.token == T::TDotDotDot {
            // No property name starts here.
            B::Property {
                flags: Flags::PROPERTY_NONE,
                key: Expr::EMPTY,
                value: p.parse_missing_binding_name()?,
                default_value: None,
            }
        } else {
            p.parse_property_binding()?
        };
        property.flags = Flags::Property::IsSpread.into();
        property.key = p.new_expr(E::Missing {}, p.lexer.loc());
        Ok(property)
    }

    pub(crate) fn parse_and_declare_decls(
        &mut self,
        kind: js_ast::symbol::Kind,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<G::DeclList, Error> {
        let p = self;
        let mut decls: smallvec::SmallVec<[G::Decl; 4]> = smallvec::SmallVec::new();
        if p.lexer.tolerant && !p.lexer.is_log_disabled && p.is_for_of_without_declarations() {
            return Ok(G::DeclList::from_arena_slice(&decls));
        }
        let saved_contexts = p.enter_list(ListKind::VariableDeclarations);
        // Only set in tolerant mode.
        let mut trailing_comma: Option<bun_ast::Range> = None;

        loop {
            match p.classify_list_token(ListKind::VariableDeclarations)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => {
                    // `checkGrammarForDisallowedTrailingComma`
                    if let Some(comma) = trailing_comma {
                        p.lexer.ts_grammar_error(comma, 1009);
                    }
                    break;
                }
            }
            let decl_start = p.lexer.loc();
            // Forbid "let let" and "const let" but not "var let"
            if (kind == js_ast::symbol::Kind::Other || kind == js_ast::symbol::Kind::Constant)
                && p.lexer.is_contextual_keyword(b"let")
            {
                p.log().add_range_error(
                    Some(p.source),
                    p.lexer.range(),
                    b"Cannot use \"let\" as an identifier here",
                );
            }

            let mut value: Option<js_ast::Expr> = None;
            let mut local = p.parse_binding(ParseBindingOptions {
                is_using_statement: opts.is_using_statement,
                // `parseVariableDeclarationWorker`
                private_name_code: 18029,
            })?;
            // Only tolerant mode parses a pattern here.
            if opts.is_using_statement && matches!(local.data, B::B::BArray(_) | B::B::BObject(_)) {
                // `checkGrammarVariableDeclaration`
                p.ts_grammar_error(local.loc, 1492);
            }
            p.declare_binding(kind, &mut local, opts)
                .expect("unreachable");

            // Skip over types
            if Self::IS_TYPESCRIPT_ENABLED {
                // "let foo!"
                // `parseVariableDeclarationWorker`: for TypeScript only after a name, and not in the head of a "for".
                let is_definite_assignment_assertion = p.lexer.token == T::TExclamation
                    && !p.lexer.has_newline_before
                    && (!p.lexer.tolerant
                        || (matches!(local.data, B::B::BIdentifier(_)) && !opts.is_for_loop_init));
                if is_definite_assignment_assertion {
                    p.lexer.next()?;
                    p.mark_type_syntax(local.loc, Mark::Definite, local.loc);
                }

                // "let foo: number"
                // TypeScript's parser does not insist on a type after the "!": `checkGrammarVariableDeclaration` does.
                if (is_definite_assignment_assertion && !p.lexer.tolerant)
                    || p.lexer.token == T::TColon
                {
                    p.lexer.expect(T::TColon)?;
                    p.mark_type_syntax(local.loc, Mark::Annotation, p.lexer.loc());
                    p.skip_type_script_type(Level::Lowest)?;
                }
            }

            if p.lexer.token == T::TEquals {
                p.lexer.next()?;
                value = Some(p.parse_expr(Level::Comma)?);
            }

            decls.push(G::Decl {
                binding: local,
                value,
            });

            if p.lexer.token != T::TComma {
                if p.recover_missing_comma(ListKind::VariableDeclarations, decl_start)? {
                    trailing_comma = None;
                    continue;
                }
                break;
            }
            if p.lexer.tolerant {
                trailing_comma = Some(p.lexer.range());
            }
            p.lexer.next()?;
        }

        p.lexer.list_contexts = saved_contexts;
        Ok(G::DeclList::from_arena_slice(&decls))
    }

    pub(crate) fn parse_path(&mut self) -> Result<ParsedPath<'a>, Error> {
        let p = self;
        if p.lexer.tolerant {
            return p.parse_path_tolerant();
        }
        let path_text = p.lexer.to_utf8_e_string()?;
        let mut path = ParsedPath {
            loc: p.lexer.loc(),
            // SAFETY: E::String slice8() is arena-owned for 'a.
            text: unsafe { bun_collections::detach_lifetime(path_text.slice8()) },
            is_macro: false,
            import_tag: bun_ast::ImportRecordTag::None,
            loader: None,
        };

        if p.lexer.token == T::TNoSubstitutionTemplateLiteral {
            p.lexer.next()?;
        } else {
            p.lexer.expect(T::TStringLiteral)?;
        }

        if !p.lexer.has_newline_before
            && (
                // Import Assertions are deprecated.
                // Import Attributes are the new way to do this.
                // But some code may still use "assert"
                // We support both and treat them identically.
                // Once Prettier & TypeScript support import attributes, we will add runtime support
                p.lexer.is_contextual_keyword(b"assert") || p.lexer.token == T::TWith
            )
        {
            p.lexer.next()?;
            p.lexer.expect(T::TOpenBrace)?;

            #[derive(Copy, Clone, PartialEq, Eq)]
            enum SupportedAttribute {
                Type,
                Embed,
                BunBakeGraph,
            }

            let mut has_seen_embed_true = false;

            while p.lexer.token != T::TCloseBrace {
                let supported_attribute: Option<SupportedAttribute> = 'brk: {
                    // Parse the key
                    if p.lexer.is_identifier_or_keyword() {
                        if p.lexer.identifier == b"type" {
                            break 'brk Some(SupportedAttribute::Type);
                        }
                        if p.lexer.identifier == b"embed" {
                            break 'brk Some(SupportedAttribute::Embed);
                        }
                        if p.lexer.identifier == b"bunBakeGraph" {
                            break 'brk Some(SupportedAttribute::BunBakeGraph);
                        }
                    } else if p.lexer.token == T::TStringLiteral {
                        let estr = p.lexer.to_utf8_e_string()?;
                        let string_literal_text = estr.slice8();
                        if string_literal_text == b"type" {
                            break 'brk Some(SupportedAttribute::Type);
                        }
                        if string_literal_text == b"embed" {
                            break 'brk Some(SupportedAttribute::Embed);
                        }
                        if string_literal_text == b"bunBakeGraph" {
                            break 'brk Some(SupportedAttribute::BunBakeGraph);
                        }
                    } else {
                        p.lexer.expect(T::TIdentifier)?;
                    }

                    break 'brk None;
                };

                p.lexer.next()?;
                p.lexer.expect(T::TColon)?;

                p.lexer.expect(T::TStringLiteral)?;
                let estr = p.lexer.to_utf8_e_string()?;
                let string_literal_text = estr.slice8();
                if let Some(attr) = supported_attribute {
                    match attr {
                        SupportedAttribute::Type => {
                            let type_attr = string_literal_text;
                            if type_attr == b"macro" {
                                path.is_macro = true;
                            } else if let Some(loader) = bun_ast::Loader::from_string(type_attr) {
                                path.loader = Some(loader);
                                if loader == bun_ast::Loader::Sqlite && has_seen_embed_true {
                                    path.loader = Some(bun_ast::Loader::SqliteEmbedded);
                                }
                            } else {
                                // unknown loader; consider erroring
                            }
                        }
                        SupportedAttribute::Embed => {
                            if string_literal_text == b"true" {
                                has_seen_embed_true = true;
                                if path.loader == Some(bun_ast::Loader::Sqlite) {
                                    path.loader = Some(bun_ast::Loader::SqliteEmbedded);
                                }
                            }
                        }
                        SupportedAttribute::BunBakeGraph => {
                            if string_literal_text == b"ssr" {
                                path.import_tag = bun_ast::ImportRecordTag::BakeResolveToSsrGraph;
                            } else {
                                let r = p.lexer.range();
                                p.lexer.add_range_error(
                                    r,
                                    format_args!("'bunBakeGraph' can only be set to 'ssr'"),
                                )?;
                            }
                        }
                    }
                }

                if p.lexer.token != T::TComma {
                    break;
                }

                p.lexer.next()?;
            }

            p.lexer.expect(T::TCloseBrace)?;
        }

        Ok(path)
    }

    /// `parseModuleSpecifier`, then `tryParseImportAttributes` or the same step of `parseExportDeclaration`.
    #[cold]
    #[inline(never)]
    fn parse_path_tolerant(&mut self) -> Result<ParsedPath<'a>, Error> {
        let p = self;
        let mut path = ParsedPath {
            loc: p.lexer.loc(),
            text: b"",
            is_macro: false,
            import_tag: bun_ast::ImportRecordTag::None,
            loader: None,
        };

        if p.lexer.token == T::TStringLiteral {
            let path_text = p.lexer.to_utf8_e_string()?;
            // SAFETY: E::String slice8() is arena-owned for 'a.
            path.text = unsafe { bun_collections::detach_lifetime(path_text.slice8()) };
            p.lexer.next()?;
        } else {
            // Any expression is accepted and never checked. `checkExternalImportOrExportDeclaration` reports 1141 unless it
            // is missing. `checkGrammarModuleElementContext` returns first in a block or a function.
            let value = p.parse_expr(Level::Lowest)?;
            if !value.is_missing() && p.current_scope().kind == js_ast::scope::Kind::Entry {
                p.ts_checker_error(path.loc, 1141);
            }
        }

        // After an import, `with` can be on the next line. The old reader reports `assert` (2880).
        let is_with = p.lexer.token == T::TWith;
        if (is_with || p.lexer.is_contextual_keyword(b"assert"))
            && (!p.lexer.has_newline_before || (is_with && !p.is_in_export_statement()))
        {
            p.parse_import_attributes()?;
        }

        Ok(path)
    }

    /// Whether the statement being parsed starts with `export`. Only known in keep mode.
    fn is_in_export_statement(&self) -> bool {
        self.type_syntax.as_ref().is_some_and(|syntax| {
            syntax.statement_modifiers[syntax.statement_modifiers_base..]
                .iter()
                .any(|modifier| modifier.flag.contains(bun_ast::ts_syntax::Flags::EXPORT))
        })
    }

    /// `parseImportAttributes`, at `with` or `assert`, in tolerant mode. Keeps the attributes as an object literal for the checker.
    #[cold]
    #[inline(never)]
    fn parse_import_attributes(&mut self) -> Result<(), Error> {
        let p = self;
        let keyword_loc = p.lexer.loc();
        p.lexer.next()?;
        let open_brace_loc = p.lexer.loc();
        let mut properties = BumpVec::<G::Property>::new_in(p.arena);

        if p.lexer.token != T::TOpenBrace {
            // Reported, and there are no attributes.
            p.lexer.expect(T::TOpenBrace)?;
        } else {
            p.lexer.next()?;
            let saved_contexts = p.enter_list(ListKind::ImportAttributes);
            while p.lexer.token != T::TCloseBrace {
                match p.classify_list_token(ListKind::ImportAttributes)? {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }

                // `parseImportAttribute`
                let element_start = p.lexer.loc();
                let key = if p.lexer.token == T::TStringLiteral {
                    let text = p.lexer.to_e_string()?;
                    p.new_expr(text, element_start)
                } else {
                    let name = p.lexer.identifier;
                    p.new_expr(E::EString::init(name), element_start)
                };
                p.lexer.next()?;
                p.lexer.expect(T::TColon)?;
                let value = p.parse_expr(Level::Comma)?;
                properties.push(G::Property {
                    key: Some(key),
                    value: Some(value),
                    ..Default::default()
                });

                if p.lexer.token != T::TComma {
                    if p.recover_missing_comma(ListKind::ImportAttributes, element_start)? {
                        continue;
                    }
                    break;
                }
                p.lexer.next()?;
            }
            p.lexer.list_contexts = saved_contexts;
            p.lexer.expect(T::TCloseBrace)?;
        }

        let object = p.new_expr(
            E::Object {
                properties: G::PropertyList::from_bump_vec(properties),
                ..Default::default()
            },
            open_brace_loc,
        );
        if let Some(syntax) = &mut p.type_syntax {
            syntax.import_attributes.push((keyword_loc.start, object));
        }
        Ok(())
    }

    pub(crate) fn parse_stmts_up_to(
        &mut self,
        eend: T,
        _opts: &mut ParseStatementOptions<'a>,
    ) -> Result<StmtList<'a>, Error> {
        let p = self;
        let mut opts = *_opts;
        let mut stmts = StmtList::new_in(p.arena);

        let mut return_without_semicolon_start: i32 = -1;
        opts.lexical_decl = LexicalDecl::AllowAll;
        let mut is_directive_prologue = true;
        let list = if eend == T::TEndOfFile {
            ListKind::SourceElements
        } else {
            ListKind::BlockStatements
        };
        let saved_contexts = p.enter_list(list);
        // Those kept before this list was entered are for the list around it.
        let stray_decorators_base = p.stray_decorators.len();

        loop {
            for comment in p.lexer.comments_to_preserve_before.iter() {
                let loc = p.lexer.loc();
                stmts.push(p.s(S::Comment { text: comment.text }, loc));
            }
            p.lexer.comments_to_preserve_before.clear();

            if p.lexer.token == eend {
                break;
            }
            if p.lexer.tolerant && !p.lexer.is_log_disabled {
                // The block is never closed (`parseExpectedMatchingBrackets`). Whoever called moves on from the end of the file to
                // the end of the file.
                if p.lexer.token == T::TEndOfFile {
                    p.lexer.expected(eend)?;
                    break;
                }
                // The loop of `reparseTopLevelAwait` calls `parseStatement` whatever the token is.
                let is_reparsing = eend == T::TEndOfFile && p.reparses_rest_of_file;
                // `parseToplevelStatement`
                if eend == T::TEndOfFile && !is_reparsing {
                    p.lexer.await_name_seen = false;
                    p.await_was_refused = false;
                }
                if !is_reparsing {
                    match p.classify_list_token(list)? {
                        ListStep::Element => {}
                        ListStep::Skipped => continue,
                        ListStep::Over => break,
                    }
                }
            }

            let mut current_opts = opts;
            let stmt_start = p.lexer.loc();
            let outer_modifiers_base = p.begin_statement();
            let mut stmt = p.parse_stmt(&mut current_opts)?;
            let syntax = p.end_statement(outer_modifiers_base);
            if Self::IS_TYPESCRIPT_ENABLED && opts.is_typescript_declare {
                p.note_ambient_statement(stmt_start, &stmt);
            }
            if p.reparses_rest_of_file && eend == T::TEndOfFile && p.lexer.loc() == stmt_start {
                p.lexer.next()?;
            }
            if p.stray_decorators.len() > stray_decorators_base {
                p.push_stray_decorators(stray_decorators_base, &mut stmts);
            }

            // Skip TypeScript types entirely
            if Self::IS_TYPESCRIPT_ENABLED {
                if let js_ast::stmt::Data::STypeScript(_) = stmt.data {
                    // The visit pass drops it.
                    if p.keeps_type_syntax() {
                        stmts.push(p.s(S::TypeScript { syntax }, stmt_start));
                    }
                    continue;
                }
            }

            let mut skip = matches!(stmt.data, js_ast::stmt::Data::SEmpty(_));
            // Parse one or more directives at the beginning
            if is_directive_prologue {
                is_directive_prologue = false;
                if let js_ast::stmt::Data::SExpr(expr) = &stmt.data {
                    if let js_ast::expr::Data::EString(str_) = &expr.value.data {
                        if !str_.prefer_template {
                            is_directive_prologue = true;

                            if str_.eql_comptime(b"use strict") {
                                skip = true;
                                // Track "use strict" directives
                                p.current_scope_mut().strict_mode =
                                    StrictModeKind::ExplicitStrictMode;
                                if p.current_scope == p.module_scope {
                                    p.module_scope_directive_loc = stmt.loc;
                                }
                            } else if str_.eql_comptime(b"use asm") && !p.options.repl_mode {
                                // In the REPL the directive stays a string
                                // statement so it evaluates as the result,
                                // like node ('use asm' prints 'use asm').
                                skip = true;
                                stmt.data = js_ast::stmt::Data::SEmpty(S::Empty {});
                            } else {
                                let bytes = str_.string(p.arena).expect("OOM");
                                stmt = Stmt::alloc(
                                    S::Directive {
                                        value: bun_ast::StoreStr::new(bytes),
                                    },
                                    stmt.loc,
                                );
                            }
                        }
                    }
                }
            }

            if !skip {
                stmts.push(stmt);
            }

            // Warn about ASI and return statements. Here's an example of code with
            // this problem: https://github.com/rollup/rollup/issues/3729
            if !p.options.suppress_warnings_about_weird_code {
                let mut needs_check = true;
                if let js_ast::stmt::Data::SReturn(ret) = &stmt.data {
                    if ret.value.is_none() && !p.latest_return_had_semicolon {
                        return_without_semicolon_start = stmt.loc.start;
                        needs_check = false;
                    }
                }

                if needs_check && return_without_semicolon_start != -1 {
                    if let js_ast::stmt::Data::SExpr(_) = &stmt.data {
                        p.log().add_warning(
                    Some(p.source),
                            bun_ast::Loc { start: return_without_semicolon_start + 6 },
                            b"The following expression is not returned because of an automatically-inserted semicolon",
                        );
                    }

                    return_without_semicolon_start = -1;
                }
            }
        }

        p.lexer.list_contexts = saved_contexts;
        Ok(stmts)
    }

    /// Makes statements of what `note_stray_decorators` kept, from `base` on, while the last statement was parsed.
    #[cold]
    #[inline(never)]
    fn push_stray_decorators(&mut self, base: usize, stmts: &mut StmtList<'a>) {
        for decorator in self.stray_decorators.split_off(base) {
            stmts.push(self.s(
                S::SExpr {
                    value: decorator,
                    ..Default::default()
                },
                decorator.loc,
            ));
        }
    }

    /// The "}" of a block of statements, where `parse_stmts_up_to` stopped. `parseBlock`
    #[inline]
    pub(crate) fn end_of_block(&mut self) -> Result<(), Error> {
        if self.lexer.token != T::TCloseBrace && self.lexer.tolerant {
            // `parseExpectedMatchingBrackets`: it is missed, and nothing is consumed.
            self.lexer.expected(T::TCloseBrace)?;
        } else {
            self.lexer.next()?;
        }
        if self.lexer.token == T::TEquals && self.lexer.tolerant && !self.lexer.is_log_disabled {
            // A "=" right after the block is objected to and skipped.
            let range = self.lexer.range();
            self.lexer.ts_error(range, 2809);
            self.lexer.next()?;
        }
        Ok(())
    }

    /// One-token lookahead: advance past the current token, evaluate `pred`,
    /// then unconditionally restore the lexer (including `is_log_disabled`).
    #[inline]
    pub(crate) fn next_token_matches(&mut self, pred: impl FnOnce(&Self) -> bool) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = matches!(self.lexer.next(), Ok(())) && pred(self);
        self.lexer.restore(&old_lexer);
        result
    }

    #[inline]
    fn check_for_arrow_after_the_current_token(&mut self) -> bool {
        // `nextIsUnParenthesizedAsyncArrowFunction`: for TypeScript not after a line break, nor after a word that is no name
        // where it stands.
        self.next_token_matches(|p| {
            p.lexer.token == T::TEqualsGreaterThan
                && !(p.lexer.has_newline_before && p.lexer.tolerant)
        }) && (!self.lexer.tolerant || self.is_identifier_in_context())
    }

    /// `isParenthesizedArrowFunctionExpression`, at the "(": `Some(true)` an arrow function starts here, `Some(false)` none
    /// does, `None` one may. Only looks.
    #[cold]
    #[inline(never)]
    fn is_parenthesized_arrow_function(&mut self) -> Option<bool> {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let verdict = self.next_is_parenthesized_arrow_function();
        self.lexer.restore(&old_lexer);
        verdict.unwrap_or(Some(false))
    }

    /// `nextIsParenthesizedArrowFunctionExpression`, at the "(".
    fn next_is_parenthesized_arrow_function(&mut self) -> Result<Option<bool>, Error> {
        self.lexer.next()?;
        self.is_arrow_function_from_second_token()
    }

    /// `is_parenthesized_arrow_function`, at the token after the "(".
    #[cold]
    #[inline(never)]
    fn is_arrow_function_after_open_paren(&mut self) -> Option<bool> {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let verdict = self.is_arrow_function_from_second_token();
        self.lexer.restore(&old_lexer);
        verdict.unwrap_or(Some(false))
    }

    /// `nextIsParenthesizedArrowFunctionExpression`, from the token after the "(" on.
    fn is_arrow_function_from_second_token(&mut self) -> Result<Option<bool>, Error> {
        let p = self;
        match p.lexer.token {
            T::TCloseParen => {
                p.lexer.next()?;
                return Ok(Some(matches!(
                    p.lexer.token,
                    T::TEqualsGreaterThan | T::TColon | T::TOpenBrace
                )));
            }
            T::TOpenBracket | T::TOpenBrace => return Ok(None),
            T::TDotDotDot => return Ok(Some(true)),
            _ => {}
        }
        // `IsModifierKind`, "async" apart.
        let is_modifier = p.is_modifier_kind() && !p.lexer.is_contextual_keyword(b"async");
        let is_name_or_this = p.is_identifier_in_context() || p.lexer.token == T::TThis;
        p.lexer.next()?;
        if is_modifier && p.is_identifier_in_context() {
            return Ok(Some(!p.lexer.is_contextual_keyword(b"as")));
        }
        if !is_name_or_this {
            return Ok(Some(false));
        }
        Ok(match p.lexer.token {
            T::TColon => Some(true),
            T::TQuestion => {
                p.lexer.next()?;
                Some(matches!(
                    p.lexer.token,
                    T::TColon | T::TComma | T::TEquals | T::TCloseParen
                ))
            }
            T::TComma | T::TEquals | T::TCloseParen => None,
            _ => Some(false),
        })
    }

    /// At the "(" after "async", or after "async<T>" if `has_type_parameters`: an arrow function if TypeScript reads one
    /// there (`tryParseParenthesizedArrowFunctionExpression`), its parameters in the [Await] context; otherwise a call of
    /// "async", its arguments in the context of the surroundings.
    #[cold]
    #[inline(never)]
    fn parse_async_paren_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
        has_type_parameters: bool,
    ) -> Result<Expr, Error> {
        let p = self;
        let verdict = if level.gt(Level::Assign) {
            // `parseAssignmentExpressionOrHigher` is the only one to try.
            Some(false)
        } else if !has_type_parameters {
            p.is_parenthesized_arrow_function()
        } else if p.is_jsx_enabled() {
            // `nextIsParenthesizedArrowFunctionExpression`, at a "<": with JSX, what `is_ts_arrow_fn_jsx` lets through is one.
            Some(true)
        } else {
            None
        };
        if verdict == Some(true) {
            // `allowAmbiguity`, `allowReturnTypeInArrowFunction`
            p.lexer.next()?;
            return p.parse_paren_expr(
                loc,
                level,
                ParenExprOpts {
                    force_arrow_fn: true,
                    is_after_question_and_before_colon: false,
                    ..opts
                },
            );
        }
        // `parsePossibleParenthesizedArrowFunctionExpression`. What it keeps in `notParenthesizedArrow` is kept with the outcomes
        // of the other attempts, which are told by where a ":" is: no "async" is there.
        let key = loc.start as u32;
        if verdict.is_none()
            && p.ts_conditional_arrow_attempts
                .binary_search_by_key(&key, |&packed| packed >> 1)
                .is_err()
        {
            let snapshot = p.parser_snapshot();
            p.lexer.next()?;
            match p.parse_paren_expr_as(loc, level, opts, ArrowAttempt::ArrowOrBacktrack) {
                // Stack and memory exhaustion are not properties of the attempt
                Err(err @ (Error::StackOverflow | Error::Alloc(_))) => return Err(err),
                Err(_) => {
                    p.restore_parser_snapshot(snapshot);
                    // Attempts nested in this one may have added entries of their own.
                    if let Err(insert_at) = p
                        .ts_conditional_arrow_attempts
                        .binary_search_by_key(&key, |&packed| packed >> 1)
                    {
                        p.ts_conditional_arrow_attempts.insert(insert_at, key << 1);
                    }
                }
                arrow => return arrow,
            }
        }
        p.lexer.next()?;
        p.parse_paren_expr_as(loc, level, opts, ArrowAttempt::NeverArrow)
    }

    /// Whether `item`, just parsed as an expression in parentheses, was a modifier of the parameter that starts at the current
    /// token (`parseModifiersEx` in `parseParameterEx`). `is_arrow_fn`: this is known to be the head of an arrow function, or
    /// `item` is the first word after the "(", which makes it one (`nextIsParenthesizedArrowFunctionExpression`).
    #[cold]
    #[inline(never)]
    fn is_parameter_modifier(&mut self, item: Expr, is_arrow_fn: bool) -> bool {
        if self.lexer.is_log_disabled
            || self.lexer.has_newline_before
            || self.lexer.token != T::TIdentifier
        {
            return false;
        }
        let js_ast::expr::Data::EIdentifier(id) = item.data else {
            return false;
        };
        let word = self.load_name_from_ref(id.ref_);
        crate::lexer::is_type_script_accessibility_modifier(word)
            // Nothing but blanks between the word and the name.
            && self.lexer.contents[..self.lexer.start].trim_ascii_end().len()
                == item.loc.start as usize + word.len()
            && (is_arrow_fn || self.is_in_the_head_of_an_arrow_function())
    }

    /// Whether the list the current token is in comes to its ")" and what follows that is the "=>" of an arrow function, with
    /// a return type before it or not, or the "{" of its body. Stands for the attempt TypeScript makes at the whole head
    /// (`parsePossibleParenthesizedArrowFunctionExpression`). Only looks.
    #[cold]
    #[inline(never)]
    fn is_in_the_head_of_an_arrow_function(&mut self) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let mut depth = 0u32;
        let result = loop {
            match self.lexer.token {
                T::TOpenParen | T::TOpenBracket | T::TOpenBrace => depth += 1,
                T::TCloseParen | T::TCloseBracket | T::TCloseBrace if depth > 0 => depth -= 1,
                T::TCloseParen => {
                    break self.lexer.next().is_ok()
                        && match self.lexer.token {
                            T::TEqualsGreaterThan | T::TOpenBrace => true,
                            T::TColon => self
                                .skip_type_script_arrow_return_type_with_backtracking()
                                .is_ok(),
                            _ => false,
                        };
                }
                // The tokens of a template cannot be told without parsing what is in it.
                T::TCloseBracket | T::TCloseBrace | T::TTemplateHead | T::TEndOfFile => {
                    break false;
                }
                _ => {}
            }
            if self.lexer.next().is_err() {
                break false;
            }
        };
        self.lexer.restore(&old_lexer);
        result
    }

    /// `isAwaitUsingDeclaration`, at "await".
    #[cold]
    #[inline(never)]
    fn is_await_using_declaration(&mut self) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = self.lexer.next().is_ok()
            && self.lexer.is_contextual_keyword(b"using")
            && self.lexer.next().is_ok()
            && matches!(self.lexer.token, T::TIdentifier | T::TOpenBrace)
            && !self.lexer.has_newline_before;
        self.lexer.restore(&old_lexer);
        result
    }

    /// "for (await using of x)": no declarations, and "of" is the keyword (`parseVariableDeclarationList`).
    /// `keyword`: the word before it.
    #[cold]
    #[inline(never)]
    fn is_empty_declaration_list_before_of(&mut self, keyword: bun_ast::Range) -> bool {
        if self.lexer.is_log_disabled || !self.lexer.is_contextual_keyword(b"of") {
            return false;
        }
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = self.lexer.next().is_ok()
            && self.lexer.token == T::TIdentifier
            && self.lexer.next().is_ok()
            && self.lexer.token == T::TCloseParen;
        self.lexer.restore(&old_lexer);
        if result {
            // `checkGrammarVariableDeclarationList`
            self.lexer.ts_error(
                bun_ast::Range {
                    loc: keyword.end(),
                    len: 0,
                },
                1123,
            );
        }
        result
    }

    /// This parses an expression. This assumes we've already parsed the "async"
    /// keyword and are currently looking at the following token.
    pub(crate) fn parse_async_prefix_expr(
        &mut self,
        async_range: bun_ast::Range,
        level: Level,
        flags: EFlags,
    ) -> Result<Expr, Error> {
        let p = self;
        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .async_arrow_parameters
                .insert(async_range.loc.start, p.lexer.loc().start);
        }
        // "async function() {}"
        if !p.lexer.has_newline_before && p.lexer.token == T::TFunction {
            return p.parse_fn_expr(async_range.loc, true);
        }

        // Check the precedence level to avoid parsing an arrow function in
        // "new async () => {}". This also avoids parsing "new async()" as
        // "new (async())()" instead.
        // "async", a line break, "=>": for TypeScript the arrow function it would be without the line break, to which
        // `checkGrammarArrowFunction` objects (`parseAssignmentExpressionOrHigherWorker`).
        if (!p.lexer.has_newline_before
            || (p.lexer.token == T::TEqualsGreaterThan && p.lexer.tolerant))
            && level.lt(Level::Member)
        {
            match p.lexer.token {
                // "async => {}"
                T::TEqualsGreaterThan => {
                    if level.lte(Level::Assign) {
                        let async_ref = p.store_name_in_ref(b"async");
                        let arg_binding = p.b(B::Identifier { r#ref: async_ref }, async_range.loc);
                        let args: &'a mut [G::Arg] = p.arena.alloc_slice_fill_with(1, |_| G::Arg {
                            binding: arg_binding,
                            ..Default::default()
                        });
                        let _ = p
                            .push_scope_for_parse_pass(
                                js_ast::scope::Kind::FunctionArgs,
                                async_range.loc,
                            )
                            .expect("unreachable");
                        let mut data = FnOrArrowDataParse {
                            needs_async_loc: async_range.loc,
                            ..Default::default()
                        };
                        let arrow_body = p.parse_arrow_body_with_flags(args, &mut data, flags)?;
                        p.pop_scope();
                        return Ok(p.new_expr(arrow_body, async_range.loc));
                    }
                }
                // "async x => {}"
                T::TIdentifier => {
                    if level.lte(Level::Assign) {
                        // p.markLoweredSyntaxFeature();

                        // In TypeScript, "async <ident>" not followed by "=>" treats "async" as
                        // a plain identifier (e.g. "async as T"), matching tsc's two-token
                        // lookahead in isUnParenthesizedAsyncArrowFunctionWorker (TypeScript#8444).
                        let is_arrow_fn = !Self::IS_TYPESCRIPT_ENABLED
                            || p.check_for_arrow_after_the_current_token();

                        if is_arrow_fn {
                            let ref_ = p.store_name_in_ref(p.lexer.identifier);
                            let arg_loc = p.lexer.loc();
                            let arg_binding = p.b(B::Identifier { r#ref: ref_ }, arg_loc);
                            let args: &'a mut [G::Arg] =
                                p.arena.alloc_slice_fill_with(1, |_| G::Arg {
                                    binding: arg_binding,
                                    ..Default::default()
                                });
                            p.lexer.next()?;

                            let _ = p.push_scope_for_parse_pass(
                                js_ast::scope::Kind::FunctionArgs,
                                async_range.loc,
                            )?;

                            let mut data = FnOrArrowDataParse {
                                allow_await: AwaitOrYield::AllowExpr,
                                needs_async_loc: args[0].binding.loc,
                                ..Default::default()
                            };
                            // Pop the scope on the error path too.
                            let mut arrow_body =
                                match p.parse_arrow_body_with_flags(args, &mut data, flags) {
                                    Ok(body) => body,
                                    Err(e) => {
                                        p.pop_scope();
                                        return Err(e);
                                    }
                                };
                            arrow_body.is_async = true;
                            p.pop_scope();
                            return Ok(p.new_expr(arrow_body, async_range.loc));
                        }
                    }
                }

                // "async()"
                // "async () => {}"
                T::TOpenParen => {
                    let opts = ParenExprOpts {
                        is_async: true,
                        is_after_question_and_before_colon: flags
                            == EFlags::AfterQuestionAndBeforeColon,
                        ..Default::default()
                    };
                    if p.lexer.tolerant && !p.lexer.is_log_disabled {
                        return p.parse_async_paren_expr(async_range.loc, level, opts, false);
                    }
                    p.lexer.next()?;
                    return p.parse_paren_expr(async_range.loc, level, opts);
                }

                // "async<T>()"
                // "async <T>() => {}"
                T::TLessThan => {
                    if Self::IS_TYPESCRIPT_ENABLED
                        && (!p.is_jsx_enabled() || p.is_ts_arrow_fn_jsx()?)
                    {
                        let type_arguments = p.lexer.loc();
                        match p
                            .try_skip_type_script_type_parameters_then_open_paren_with_backtracking(
                            ) {
                            SkipTypeParameterResult::DidNotSkipAnything => {}
                            result => {
                                let opts = ParenExprOpts {
                                    is_async: true,
                                    force_arrow_fn: result
                                        == SkipTypeParameterResult::DefinitelyTypeParameters,
                                    ..Default::default()
                                };
                                let expr = if !opts.force_arrow_fn
                                    && p.lexer.tolerant
                                    && !p.lexer.is_log_disabled
                                {
                                    p.parse_async_paren_expr(async_range.loc, level, opts, true)?
                                } else {
                                    p.lexer.next()?;
                                    p.parse_paren_expr(async_range.loc, level, opts)?
                                };
                                // "async<T>()" turned out to be a call.
                                if let js_ast::expr::Data::ECall(call) = &expr.data {
                                    p.mark_type_syntax(
                                        call.close_paren_loc,
                                        Mark::TypeArguments,
                                        type_arguments,
                                    );
                                }
                                return Ok(expr);
                            }
                        }
                    }
                }

                _ => {}
            }
        }

        // "async"
        // "async + 1"
        let async_ref = p.store_name_in_ref(b"async");
        Ok(p.new_expr(
            E::Identifier {
                ref_: async_ref,
                ..Default::default()
            },
            async_range.loc,
        ))
    }
}
