#![warn(unused_must_use)]
#[cfg(test)]
mod annotation_tests;
pub mod attached;
pub mod erased;
#[cfg(test)]
mod erased_tests;
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
pub mod syntax_errors;
pub(crate) mod type_sink;
pub mod wrappers;

use bun_collections::VecExt;

use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};

use crate::Error;
use bun_core::strings;

use bun_ast::LexerLog as _;

use crate::lexer::T;
use crate::p::P;
use crate::parser::{
    AwaitOrYield, DeferredArrowArgErrors, DeferredErrors, ExprListLoc, ExprOrLetStmt,
    FnOrArrowDataParse, LexicalDecl, LocList, ParenExprOpts, ParseBindingOptions,
    ParseClassOptions, ParseStatementOptions, ParsedPath, PropertyOpts, SkipTypeParameterResult,
    StmtList, TypeParameterFlag,
};
use bun_ast as js_ast;
use bun_ast::expr::EFlags;
use bun_ast::op::Level;
use bun_ast::{ArrayBinding, StrictModeKind};
use bun_ast::{B, Binding, E, Expr, ExprNodeIndex, ExprNodeList, Flags, G, LocRef, S, Stmt};

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
    /// `parse_expr`, read with `flags`.
    #[inline]
    pub(crate) fn parse_expr_flagged(
        &mut self,
        level: Level,
        flags: EFlags,
    ) -> Result<Expr, Error> {
        let mut expr = Expr::EMPTY;
        self.parse_expr_common(level, None, flags, &mut expr)?;
        Ok(expr)
    }
    /// What the expression that is the body of an arrow function is read with, where the arrow function is read with `flags`.
    #[inline]
    pub(crate) fn arrow_body_flags(flags: EFlags) -> EFlags {
        if Self::IS_TYPESCRIPT_ENABLED && flags == EFlags::AfterQuestionAndBeforeColon {
            flags
        } else {
            EFlags::None
        }
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
            | T::TSemicolon => {}
            _ => {
                if is_star || !p.lexer.has_newline_before {
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
        let mut auto_accessor_loc = bun_ast::Loc::EMPTY;

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
                let _ = p.skip_type_script_type_arguments::<false, false>()?; // isInsideJSXElement
            }
        }

        if Self::IS_TYPESCRIPT_ENABLED {
            if p.lexer.is_contextual_keyword(b"implements") {
                p.lexer.next()?;

                loop {
                    p.skip_class_implements_entry()?;
                    if p.lexer.token != T::TComma {
                        break;
                    }
                    p.lexer.next()?;
                }
            }
        }

        let body_loc = p.lexer.loc();
        p.lexer.expect(T::TOpenBrace)?;
        let mut properties = BumpVec::<G::Property>::new_in(p.arena);

        // Allow "in" and private fields inside class bodies
        let old_allow_in = p.allow_in;
        let old_allow_private_identifiers = p.allow_private_identifiers;
        p.allow_in = true;
        p.allow_private_identifiers = true;

        // The signatures of an ambient class read this: they may end with a rest argument and a comma.
        let old_is_typescript_declare = p.fn_or_arrow_data_parse.is_typescript_declare;
        if class_opts.is_type_script_declare {
            p.fn_or_arrow_data_parse.is_typescript_declare = true;
        }

        // A scope is needed for private identifiers
        let scope_index = p
            .push_scope_for_parse_pass(js_ast::scope::Kind::ClassBody, body_loc)
            .expect("unreachable");

        while !p.lexer.token.is_close_brace_or_eof() {
            if p.lexer.token == T::TSemicolon {
                p.lexer.next()?;
                continue;
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
                if prop_kind == js_ast::g::PropertyKind::AutoAccessor && !has_auto_accessor {
                    has_auto_accessor = true;
                    auto_accessor_loc = prop_key.map_or(first_decorator_loc, |key| key.loc);
                }

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
                if Self::IS_TYPESCRIPT_ENABLED {
                    if let Some(starts) = &mut p.starts_for_parse_only {
                        starts.erased.member_read(
                            erased::Cursor::at(&p.lexer),
                            first_decorator_loc,
                            body_loc,
                            properties.len(),
                            opts.is_static,
                        );
                    }
                }
            }
        }

        if class_opts.is_type_script_declare {
            p.pop_and_discard_scope(scope_index);
        } else {
            p.pop_scope();
        }

        p.allow_in = old_allow_in;
        p.allow_private_identifiers = old_allow_private_identifiers;
        p.fn_or_arrow_data_parse.is_typescript_declare = old_is_typescript_declare;
        let close_brace_loc = p.lexer.loc();
        p.lexer.expect(T::TCloseBrace)?;

        let has_any_decorators = has_decorators || class_opts.ts_decorators.len() > 0;
        let standard_decorators = p.options.features.standard_decorators;
        // Only the standard lowering knows an auto-accessor, and it calls no experimental decorator.
        if has_auto_accessor
            && has_any_decorators
            && !standard_decorators
            && !class_opts.is_type_script_declare
            && !SCAN_ONLY
            && p.starts_for_parse_only.is_none()
        {
            p.log().add_error(
                Some(p.source),
                auto_accessor_loc,
                b"An \"accessor\" property is not supported in a class with experimental decorators",
            );
        }
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
            should_lower_standard_decorators: if standard_decorators {
                has_any_decorators || has_auto_accessor
            } else {
                has_auto_accessor && !has_any_decorators
            },
        })
    }

    /// parseTypeHeritageClauseElement of a class: a type as before, else an expression with type arguments.
    fn skip_class_implements_entry(&mut self) -> Result<(), Error> {
        let p = self;
        let start = p.lexer.snapshot();
        let logged = {
            let log = p.log();
            (log.msgs.len(), log.errors, log.warnings)
        };
        let as_type = p.skip_type_script_type(Level::Lowest);
        // Inside an attempt only the type is read, so that no attempt ends differently than before.
        if p.lexer.is_log_disabled
            || (as_type.is_ok()
                && p.log().errors == logged.1
                && matches!(p.lexer.token, T::TComma | T::TOpenBrace))
        {
            return as_type;
        }
        p.reread_class_implements_entry(&start, logged, as_type)
    }

    /// parseExpressionWithTypeArguments for an entry that is no type or does not end with one.
    #[cold]
    #[inline(never)]
    fn reread_class_implements_entry(
        &mut self,
        start: &crate::lexer::LexerSnapshot<'a>,
        logged: (usize, u32, u32),
        as_type: Result<(), Error>,
    ) -> Result<(), Error> {
        let p = self;
        if let Err(Error::StackOverflow | Error::Alloc(_)) = as_type {
            return as_type;
        }
        p.rewind_class_implements_entry(start, logged);
        let mut as_expression = p.parse_and_drop_in_class(Level::New);
        if as_expression.is_ok() {
            as_expression = p
                .skip_type_script_type_arguments::<false, false>()
                .map(|_| ());
        }
        match as_expression {
            Ok(())
                if p.log().errors == logged.1
                    && matches!(p.lexer.token, T::TComma | T::TOpenBrace) =>
            {
                Ok(())
            }
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => Err(err),
            _ => {
                // Neither reading fits: the type is read again and reports what it reported before.
                p.rewind_class_implements_entry(start, logged);
                p.skip_type_script_type(Level::Lowest)
            }
        }
    }

    /// Takes back what a reading of an entry read and logged: `logged` holds the messages, errors and warnings.
    fn rewind_class_implements_entry(
        &mut self,
        start: &crate::lexer::LexerSnapshot<'a>,
        logged: (usize, u32, u32),
    ) {
        self.lexer.restore(start);
        let log = self.log();
        log.msgs.truncate(logged.0);
        log.errors = logged.1;
        log.warnings = logged.2;
    }

    /// Reads an expression that a class keeps nothing of: the lexer ends behind it, all else is as before.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_and_drop_in_class(&mut self, level: Level) -> Result<(), Error> {
        let p = self;
        let errors = p.log().errors;
        let has_import_meta = p.has_import_meta;
        let has_with_scope = p.has_with_scope;
        let has_es_module_syntax = p.has_es_module_syntax;
        let needs_jsx_import = p.needs_jsx_import;
        let top_level_await_keyword = p.top_level_await_keyword;
        // A name in what is dropped is no use of an import.
        let parse_pass_symbol_uses = p.parse_pass_symbol_uses.take();
        let snapshot = p.parser_snapshot();

        // With the log off a missing operand goes unnoticed: the count of errors decides.
        p.lexer.is_log_disabled = false;
        p.allow_in = true;
        // The reference reads "super" and private names anywhere and leaves them to its checker.
        p.allow_private_identifiers = true;
        p.fn_or_arrow_data_parse.allow_super_call = true;
        p.fn_or_arrow_data_parse.allow_super_property = true;
        let result = p.parse_expr(level);
        let has_failed = result.is_err() || p.log().errors != errors;
        let mut end = p.lexer.snapshot();

        // Scopes, symbols, import records and messages of what was read go away, and the lexer goes back.
        p.restore_parser_snapshot(snapshot);
        p.parse_pass_symbol_uses = parse_pass_symbol_uses;
        p.has_import_meta = has_import_meta;
        p.has_with_scope = has_with_scope;
        p.has_es_module_syntax = has_es_module_syntax;
        p.needs_jsx_import = needs_jsx_import;
        p.top_level_await_keyword = top_level_await_keyword;

        if has_failed {
            return Err(match result {
                Err(err @ (Error::StackOverflow | Error::Alloc(_))) => err,
                _ => Error::Backtrack,
            });
        }

        // Only the position moves: the comments inside what was read are dropped with it.
        end.is_log_disabled = p.lexer.is_log_disabled;
        end.prev_error_loc = p.lexer.prev_error_loc;
        end.all_comments_len = p.lexer.all_comments.len();
        end.comments_to_preserve_before_len = p.lexer.comments_to_preserve_before.len();
        p.lexer.restore(&end);
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

        while p.lexer.token != T::TCloseParen {
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
                break;
            }
            p.lexer.next()?;
        }
        let close_paren_loc = p.lexer.loc();
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
            // Use Expect() not ExpectInsideJSXElement() so we can parse expression tokens
            p.lexer.expect(T::TOpenBrace)?;
            let value = p.parse_expr(Level::Lowest)?;

            p.lexer.expect_inside_jsx_element(T::TCloseBrace)?;
            Ok(value)
        }
    }

    /// This assumes that the open parenthesis has already been parsed by the caller
    pub(crate) fn parse_paren_expr(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;
        let mut items_list = BumpVec::<Expr>::new_in(p.arena);
        let mut errors = DeferredErrors::default();
        let mut arrow_arg_errors = DeferredArrowArgErrors::default();
        let mut spread_range = bun_ast::Range::default();
        let mut type_colon_range = bun_ast::Range::default();
        let mut comma_after_spread = bun_ast::Loc::EMPTY;

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

        // Scan over the comma-separated arguments or expressions
        while p.lexer.token != T::TCloseParen {
            let is_spread = p.lexer.token == T::TDotDotDot;

            if is_spread {
                spread_range = p.lexer.range();
                // p.markSyntaxFeature()
                p.lexer.next()?;
            }

            // We don't know yet whether these are arguments or expressions, so parse
            p.latest_arrow_arg_loc = p.lexer.loc();

            let mut item = Expr::EMPTY;
            p.parse_expr_or_bindings(Level::Comma, Some(&mut errors), &mut item)?;

            if is_spread {
                item = p.new_expr(E::Spread { value: item }, loc);
            }

            // Skip over types
            if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon {
                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                p.skip_type_script_type(Level::Lowest)?;
            }

            // There may be a "=" after the type (but not after an "as" cast)
            if Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TEquals
                && !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())
            {
                p.lexer.next()?;
                let rhs = p.parse_expr(Level::Comma)?;
                item = Expr::assign(item, rhs);
            }

            items_list.push(item);

            if p.lexer.token != T::TComma {
                break;
            }

            // Spread arguments must come last. If there's a spread argument followed
            if is_spread {
                comma_after_spread = p.lexer.loc();
            }

            // Eat the comma token
            p.lexer.next()?;
        }
        let items: &'a mut [Expr] = items_list.into_bump_slice_mut();

        // The parenthetical construct must end with a close parenthesis
        p.lexer.expect(T::TCloseParen)?;

        // Restore "in" operator status before we parse the arrow function body
        p.allow_in = old_allow_in;

        // Also restore "await" and "yield" expression errors
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // Are these arguments to an arrow function?
        let mut is_arrow_fn = p.lexer.token == T::TEqualsGreaterThan;
        // "a ? -<T>(b) : c": an operand is no arrow function, so the ":" after it starts no return type
        if is_arrow_fn
            || opts.force_arrow_fn
            || (Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TColon
                && level.lte(Level::Assign))
        {
            // Arrow functions are not allowed inside certain expressions
            if level.gt(Level::Assign) {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }

            let mut invalid_log = LocList::new_in(p.arena);
            let mut args = BumpVec::<G::Arg>::new_in(p.arena);

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
                // double allocations
                args.push(G::Arg {
                    binding: tuple.binding.unwrap_or(Binding {
                        data: B::B::BMissing(B::Missing {}),
                        loc: item.loc,
                    }),
                    default: tuple.expr,
                    ..Default::default()
                });
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
                if opts.is_after_question_and_before_colon {
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
            }

            if is_arrow_fn || opts.force_arrow_fn {
                p.maybe_comma_spread_error(comma_after_spread);
                p.log_arrow_arg_errors(&mut arrow_arg_errors);

                // Now that we've decided we're an arrow function, report binding pattern
                // conversion errors
                if !invalid_log.is_empty() {
                    for loc_ in invalid_log.iter() {
                        loc_.add_error(p.log(), p.source);
                    }
                }
                let args_slice: &'a mut [G::Arg] = args.into_bump_slice_mut();
                // "a ? (b) => (c) : d => e": after parameters that could be an expression, the body is before the ":" too
                let is_body_before_colon = Self::IS_TYPESCRIPT_ENABLED
                    && opts.is_after_question_and_before_colon
                    && (p.paren_expr_has_type_parameters(loc, opts.is_async)
                        || Self::arrow_parameters_could_be_expr(
                            items,
                            spread_range,
                            type_colon_range,
                            &errors,
                        ));
                let body_flags = if is_body_before_colon {
                    EFlags::AfterQuestionAndBeforeColon
                } else {
                    EFlags::None
                };
                let mut arrow =
                    p.parse_arrow_body_with_flags(args_slice, &mut arrow_data, body_flags)?;
                arrow.is_async = opts.is_async;
                arrow.has_rest_arg = spread_range.len > 0;
                p.pop_scope();
                return Ok(p.new_expr(arrow, loc));
            }
        }

        // If we get here, it's not an arrow function so undo the pushing of the
        // scope we did earlier. This needs to flatten any child scopes into the
        // parent scope as if the scope was never pushed in the first place.
        p.pop_and_flatten_scope(scope_index);

        // If this isn't an arrow function, then types aren't allowed
        if type_colon_range.len > 0 {
            p.log()
                .add_range_error(Some(p.source), type_colon_range, b"Unexpected \":\"");
            return Err(crate::Error::SyntaxError);
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
                    ..Default::default()
                },
                loc,
            ));
        }

        // Is this a chain of expressions and comma operators?
        if items.len() > 0 {
            p.log_expr_errors(&mut errors);
            if spread_range.len > 0 {
                p.log()
                    .add_range_error(Some(p.source), type_colon_range, b"Unexpected \"...\"");
                return Err(crate::Error::SyntaxError);
            }

            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            return Ok(value);
        }

        // Indicate that we expected an arrow function
        p.lexer.expected(T::TEqualsGreaterThan)?;
        Err(crate::Error::SyntaxError)
    }

    /// Whether isParenthesizedArrowFunctionExpression of the reference is not certain of the arrow function whose parameters `items` were.
    #[cold]
    #[inline(never)]
    fn arrow_parameters_could_be_expr(
        items: &[Expr],
        spread_range: bun_ast::Range,
        type_colon_range: bun_ast::Range,
        errors: &DeferredErrors,
    ) -> bool {
        let Some(first) = items.first() else {
            return false;
        };
        // "(...a)" is certain, as "()" is
        if spread_range.len > 0 && items.len() == 1 {
            return false;
        }
        // "({ a }: T)" and "([a]: T)" are not
        if matches!(
            first.data,
            js_ast::expr::Data::EObject(_) | js_ast::expr::Data::EArray(_)
        ) {
            return true;
        }
        // "(a: T)" and "(a?)" are certain: a type or a "?" after a later parameter is taken as one after the first
        type_colon_range.len == 0 && errors.invalid_expr_after_question.is_none()
    }

    /// Whether type parameters stand before the parentheses of `parse_paren_expr` at `loc`: the reference is not certain of an arrow function after them.
    #[cold]
    #[inline(never)]
    fn paren_expr_has_type_parameters(&self, loc: bun_ast::Loc, is_async: bool) -> bool {
        let mut rest = self.lexer.contents.get(loc.i()..).unwrap_or(&[]);
        if is_async {
            rest = rest
                .strip_prefix(b"async")
                .unwrap_or(&[])
                .trim_ascii_start();
        }
        rest.first() == Some(&b'<')
    }

    /// `parse_paren_expr` of a lint parse of TypeScript, statement for statement: the types after what may be parameters and the return type are built and recorded.
    #[inline(never)]
    pub(crate) fn parse_paren_expr_for_lint(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let p = self;
        let mut items_list = BumpVec::<Expr>::new_in(p.arena);
        let mut errors = DeferredErrors::default();
        let arrow_arg_errors = DeferredArrowArgErrors::default();
        let mut spread_range = bun_ast::Range::default();
        let mut type_colon_range = bun_ast::Range::default();
        let mut comma_after_spread = bun_ast::Loc::EMPTY;

        let scope_index = p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, loc)?;

        let old_allow_in = p.allow_in;
        p.allow_in = true;

        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        p.fn_or_arrow_data_parse.arrow_arg_errors = arrow_arg_errors;
        p.fn_or_arrow_data_parse.track_arrow_arg_errors = true;

        while p.lexer.token != T::TCloseParen {
            let is_spread = p.lexer.token == T::TDotDotDot;

            if is_spread {
                spread_range = p.lexer.range();
                p.lexer.next()?;
            }

            p.latest_arrow_arg_loc = p.lexer.loc();

            let mut item = Expr::EMPTY;
            p.parse_expr_or_bindings(Level::Comma, Some(&mut errors), &mut item)?;

            if is_spread {
                item = p.new_expr(E::Spread { value: item }, loc);
            }

            if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon {
                type_colon_range = p.lexer.range();
                p.lexer.next()?;
                p.lint_type_annotation(arrow_parameter_loc(item))?;
            }

            if Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TEquals
                && !p.forbid_suffix_after_as_loc.eql(p.lexer.loc())
            {
                p.lexer.next()?;
                let rhs = p.parse_expr(Level::Comma)?;
                item = Expr::assign(item, rhs);
            }

            items_list.push(item);

            if p.lexer.token != T::TComma {
                break;
            }

            if is_spread {
                comma_after_spread = p.lexer.loc();
            }

            p.lexer.next()?;
        }
        let items: &'a mut [Expr] = items_list.into_bump_slice_mut();

        p.lexer.expect(T::TCloseParen)?;

        p.allow_in = old_allow_in;

        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        let mut is_arrow_fn = p.lexer.token == T::TEqualsGreaterThan;
        if is_arrow_fn
            || opts.force_arrow_fn
            || (Self::IS_TYPESCRIPT_ENABLED
                && p.lexer.token == T::TColon
                && level.lte(Level::Assign))
        {
            if level.gt(Level::Assign) {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }

            let mut invalid_log = LocList::new_in(p.arena);
            let mut args = BumpVec::<G::Arg>::new_in(p.arena);

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
                args.push(G::Arg {
                    binding: tuple.binding.unwrap_or(Binding {
                        data: B::B::BMissing(B::Missing {}),
                        loc: item.loc,
                    }),
                    default: tuple.expr,
                    ..Default::default()
                });
            }

            let mut arrow_data = FnOrArrowDataParse {
                allow_await: if opts.is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                ..Default::default()
            };

            if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon && invalid_log.is_empty() {
                is_arrow_fn = p.lint_arrow_return_type(
                    loc,
                    &arrow_data,
                    opts.is_after_question_and_before_colon,
                )?;
            }

            if is_arrow_fn || opts.force_arrow_fn {
                p.maybe_comma_spread_error(comma_after_spread);
                log_arrow_arg_errors_for_lint(p.log(), p.source, arrow_arg_errors);

                if !invalid_log.is_empty() {
                    for loc_ in invalid_log.iter() {
                        loc_.add_error(p.log(), p.source);
                    }
                }
                let args_slice: &'a mut [G::Arg] = args.into_bump_slice_mut();
                let is_body_before_colon = Self::IS_TYPESCRIPT_ENABLED
                    && opts.is_after_question_and_before_colon
                    && (p.paren_expr_has_type_parameters(loc, opts.is_async)
                        || Self::arrow_parameters_could_be_expr(
                            items,
                            spread_range,
                            type_colon_range,
                            &errors,
                        ));
                let body_flags = if is_body_before_colon {
                    EFlags::AfterQuestionAndBeforeColon
                } else {
                    EFlags::None
                };
                let mut arrow =
                    p.parse_arrow_body_with_flags(args_slice, &mut arrow_data, body_flags)?;
                arrow.is_async = opts.is_async;
                arrow.has_rest_arg = spread_range.len > 0;
                p.pop_scope();
                return Ok(p.new_expr(arrow, loc));
            }
        }

        pop_and_flatten_scope_for_lint(&mut p.current_scope, &mut p.scopes_in_order, scope_index);

        if type_colon_range.len > 0 {
            p.log()
                .add_range_error(Some(p.source), type_colon_range, b"Unexpected \":\"");
            return Err(crate::Error::SyntaxError);
        }

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
                    ..Default::default()
                },
                loc,
            ));
        }

        if items.len() > 0 {
            p.log_expr_errors(&mut errors);
            if spread_range.len > 0 {
                p.log()
                    .add_range_error(Some(p.source), type_colon_range, b"Unexpected \"...\"");
                return Err(crate::Error::SyntaxError);
            }

            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            return Ok(value);
        }

        p.lexer.expected(T::TEqualsGreaterThan)?;
        Err(crate::Error::SyntaxError)
    }

    /// `parse_paren_expr_for_lint` for a caller that a parse without lint runs too: the call stays out of its way.
    #[cold]
    #[inline(never)]
    pub(crate) fn parse_paren_expr_for_lint_cold(
        &mut self,
        loc: bun_ast::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        self.parse_paren_expr_for_lint(loc, level, opts)
    }

    /// The ":" after what may be the parameters of the arrow function at `arrow`, in a lint parse. True where a return type and "=>" follow: the type is built and recorded.
    #[cold]
    #[inline(never)]
    fn lint_arrow_return_type(
        &mut self,
        arrow: bun_ast::Loc,
        arrow_data: &FnOrArrowDataParse,
        is_after_question_and_before_colon: bool,
    ) -> Result<bool, Error> {
        let owner = attached::Owner::arrow(arrow);
        if is_after_question_and_before_colon {
            if !self.lint_is_arrow_return_type_after_question(arrow_data)? {
                return Ok(false);
            }
            // The attempt read the type and the body, and all of it went back.
            self.lexer.next()?;
            self.lint_return_type(owner)?;
            return Ok(true);
        }
        let Some(type_node) = self.lint_try_arrow_return_type() else {
            return Ok(false);
        };
        if let Some(starts) = &mut self.starts_for_parse_only {
            starts.attached.return_type(owner, type_node);
        }
        Ok(true)
    }

    /// `: T` and then "=>", or nothing moves: what `try_skip_type_script_arrow_return_type_with_backtracking` decides, with the node of the type.
    fn lint_try_arrow_return_type(&mut self) -> Option<js_ast::ts::Type> {
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let logged = {
            let log = self.log();
            (log.msgs.len(), log.errors, log.warnings)
        };
        let recorded = self
            .starts_for_parse_only
            .as_deref()
            .map(|starts| starts.attached.mark());
        self.lexer.is_log_disabled = true;
        let read = self.lint_arrow_return_type_then_arrow();
        if read.is_err() {
            self.lexer.restore(&old_lexer);
            let log = self.log();
            log.msgs.truncate(logged.0);
            log.errors = logged.1;
            log.warnings = logged.2;
            if let (Some(starts), Some(mark)) = (&mut self.starts_for_parse_only, recorded) {
                starts.attached.rewind(mark);
            }
        }
        self.lexer.is_log_disabled = old_log_disabled;
        read.ok()
    }

    /// `: T`, which "=>" follows.
    fn lint_arrow_return_type_then_arrow(&mut self) -> Result<js_ast::ts::Type, Error> {
        self.lexer.expect(T::TColon)?;
        let type_node = self.build_typescript_return_type()?;
        if self.lexer.token != T::TEqualsGreaterThan {
            return Err(Error::Backtrack);
        }
        Ok(type_node)
    }

    /// `is_type_script_arrow_return_type_after_question_and_before_colon` of a lint parse: the return type is read as the one that is kept.
    fn lint_is_arrow_return_type_after_question(
        &mut self,
        arrow_data: &FnOrArrowDataParse,
    ) -> Result<bool, Error> {
        let memo_key = u32::try_from(self.lexer.start).unwrap_or(u32::MAX);
        let attempts = &self.ts_conditional_arrow_attempts;
        let known = attempts
            .binary_search_by_key(&memo_key, |&packed| packed >> 1)
            .ok()
            .and_then(|at| attempts.get(at));
        if let Some(&packed) = known {
            return Ok(packed & 1 == 1);
        }

        let snapshot = self.parser_snapshot();
        self.lexer.is_log_disabled = true;
        let mut data = arrow_data.clone();
        let read = self.lint_arrow_return_type_then_body(&mut data);
        self.restore_parser_snapshot(snapshot);
        let is_arrow_fn = match read {
            Ok(()) => true,
            Err(err @ (Error::StackOverflow | Error::Alloc(_))) => return Err(err),
            Err(_) => false,
        };

        // An attempt inside the body may have put its own outcome in the list.
        let attempts = &mut self.ts_conditional_arrow_attempts;
        if let Err(insert_at) = attempts.binary_search_by_key(&memo_key, |&packed| packed >> 1) {
            attempts.insert(insert_at, (memo_key << 1) | u32::from(is_arrow_fn));
        }
        Ok(is_arrow_fn)
    }

    /// `: T => body :`, the arrow function that a conditional expression holds between its "?" and its ":".
    fn lint_arrow_return_type_then_body(
        &mut self,
        data: &mut FnOrArrowDataParse,
    ) -> Result<(), Error> {
        self.lexer.expect(T::TColon)?;
        self.build_typescript_return_type()?;
        self.parse_arrow_body(&mut [], data)?;
        self.lexer.expect(T::TColon)?;
        Ok(())
    }

    pub(crate) fn parse_label_name(&mut self) -> Result<Option<js_ast::LocRef>, Error> {
        let p = self;
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

        if !opts.is_name_optional
            || (is_identifier
                && (!Self::IS_TYPESCRIPT_ENABLED || p.lexer.identifier != b"implements"))
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
                    p.lexer.range(),
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
            } else if Self::IS_TYPESCRIPT_ENABLED && p.starts_for_parse_only.is_some() {
                // The record of a declared class keeps its name, which no symbol holds.
                let ref_ = p.store_name_in_ref(name_text);
                name = Some(LocRef {
                    loc: name_loc,
                    ref_,
                });
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

                if let Some(starts) = &mut p.starts_for_parse_only {
                    let mut flags = erased::ErasedFlags::AMBIENT;
                    if loc != class_keyword.loc {
                        flags |= erased::ErasedFlags::ABSTRACT;
                    }
                    let first_decorator = opts
                        .ts_decorators
                        .as_ref()
                        .and_then(|decorators| decorators.values.first())
                        .map(|decorator| decorator.loc);
                    starts.erased.class(
                        erased::Cursor::at(&p.lexer),
                        loc,
                        first_decorator,
                        flags,
                        erased::Exported::before(opts.is_export),
                        Stmt::alloc(
                            S::Class {
                                class,
                                is_export: opts.is_export,
                            },
                            loc,
                        ),
                    );
                }
                return Ok(p.s(S::TypeScript {}, loc));
            }
        }

        p.pop_scope();
        Ok(p.s(
            S::Class {
                class,
                is_export: opts.is_export,
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

            if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {
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
                            is_export: false,
                            ..Default::default()
                        },
                        token_range.loc,
                    )),
                    decls: decls_slice,
                });
            }
        } else if p.fn_or_arrow_data_parse.allow_await == AwaitOrYield::AllowExpr && raw == b"await"
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
                    if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {
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
                                    is_export: false,
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
                p.lexer.unexpected()?;
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
                if !opts.is_using_statement {
                    p.lexer.next()?;
                    let mut is_single_line = !p.lexer.has_newline_before;
                    let mut items = BumpVec::<ArrayBinding>::new_in(p.arena);
                    let mut has_spread = false;

                    // "in" expressions are allowed
                    let old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while p.lexer.token != T::TCloseBracket {
                        if p.lexer.token == T::TComma {
                            items.push(ArrayBinding {
                                binding: Binding {
                                    data: B::B::BMissing(B::Missing {}),
                                    loc: p.lexer.loc(),
                                },
                                default_value: None,
                            });
                        } else {
                            if p.lexer.token == T::TDotDotDot {
                                p.lexer.next()?;
                                has_spread = true;

                                // This was a bug in the ES2015 spec that was fixed in ES2016
                                if p.lexer.token != T::TIdentifier {
                                    // p.markSyntaxFeature(compat.NestedRestBinding, p.lexer.Range())
                                }
                            }

                            let binding = p.parse_binding(opts)?;

                            let mut default_value: Option<Expr> = None;
                            if !has_spread && p.lexer.token == T::TEquals {
                                p.lexer.next()?;
                                default_value = Some(p.parse_expr(Level::Comma)?);
                            }

                            items.push(ArrayBinding {
                                binding,
                                default_value,
                            });

                            // Commas after spread elements are not allowed
                            if has_spread && p.lexer.token == T::TComma {
                                p.log().add_range_error(
                                    Some(p.source),
                                    p.lexer.range(),
                                    b"Unexpected \",\" after rest pattern",
                                );
                                return Err(crate::Error::SyntaxError);
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
                if !opts.is_using_statement {
                    // p.markSyntaxFeature(compat.Destructuring, p.lexer.Range())
                    p.lexer.next()?;
                    let mut is_single_line = !p.lexer.has_newline_before;
                    let mut properties = BumpVec::<B::Property>::new_in(p.arena);

                    // "in" expressions are allowed
                    let old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while p.lexer.token != T::TCloseBrace {
                        let property = p.parse_property_binding()?;
                        let is_spread = property.flags.contains(Flags::Property::IsSpread);
                        properties.push(property);

                        // Commas after spread elements are not allowed
                        if is_spread && p.lexer.token == T::TComma {
                            p.log().add_range_error(
                                Some(p.source),
                                p.lexer.range(),
                                b"Unexpected \",\" after rest pattern",
                            );
                            return Err(crate::Error::SyntaxError);
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

        p.lexer.expect(T::TIdentifier)?;
        Ok(Binding {
            loc,
            data: B::B::BMissing(B::Missing {}),
        })
    }

    pub(crate) fn parse_property_binding(&mut self) -> Result<B::Property, Error> {
        let p = self;
        // Every match arm below assigns `key` (or `return`s) before any read.
        let key: Expr;
        let mut is_computed = false;

        match p.lexer.token {
            T::TDotDotDot => {
                p.lexer.next()?;
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
                key = p.parse_expr(Level::Comma)?;
                p.lexer.expect(T::TCloseBracket)?;
            }
            _ => {
                let name = p.lexer.identifier;
                let loc = p.lexer.loc();

                if !p.lexer.is_identifier_or_keyword() {
                    p.lexer.expect(T::TIdentifier)?;
                }

                p.lexer.next()?;

                key = p.new_expr(
                    E::String {
                        data: name.into(),
                        ..Default::default()
                    },
                    loc,
                );

                if p.lexer.token != T::TColon && p.lexer.token != T::TOpenParen {
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

    pub(crate) fn parse_and_declare_decls(
        &mut self,
        kind: js_ast::symbol::Kind,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<G::DeclList, Error> {
        let p = self;
        let mut decls: smallvec::SmallVec<[G::Decl; 4]> = smallvec::SmallVec::new();

        loop {
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
            })?;
            p.declare_binding(kind, &mut local, opts)
                .expect("unreachable");

            // Skip over types
            if Self::IS_TYPESCRIPT_ENABLED {
                // "let foo!"
                let is_definite_assignment_assertion =
                    p.lexer.token == T::TExclamation && !p.lexer.has_newline_before;
                if is_definite_assignment_assertion {
                    p.lexer.next()?;
                }

                // "let foo: number"
                if is_definite_assignment_assertion || p.lexer.token == T::TColon {
                    p.lexer.expect(T::TColon)?;
                    if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                        p.lint_type_annotation(local.loc)?;
                    } else {
                        p.skip_type_script_type(Level::Lowest)?;
                    }
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
                break;
            }
            p.lexer.next()?;
        }

        Ok(G::DeclList::from_arena_slice(&decls))
    }

    pub(crate) fn parse_path(&mut self) -> Result<ParsedPath<'a>, Error> {
        let p = self;
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

        loop {
            for comment in p.lexer.comments_to_preserve_before.iter() {
                let loc = p.lexer.loc();
                stmts.push(p.s(S::Comment { text: comment.text }, loc));
            }
            p.lexer.comments_to_preserve_before.clear();

            if p.lexer.token == eend {
                break;
            }

            let mut current_opts = opts;
            let mut stmt = p.parse_stmt(&mut current_opts)?;

            // Skip TypeScript types entirely
            if Self::IS_TYPESCRIPT_ENABLED {
                if let js_ast::stmt::Data::STypeScript(_) = stmt.data {
                    if let Some(starts) = &mut p.starts_for_parse_only {
                        starts.erased.dropped(
                            stmt.loc,
                            stmts.len(),
                            erased::Scopes {
                                current: p.current_scope,
                                module: p.module_scope,
                                in_order: p.scopes_in_order.as_slice(),
                            },
                        );
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

        Ok(stmts)
    }

    /// One-token lookahead: advance past the current token, evaluate `pred`,
    /// then unconditionally restore the lexer (including `is_log_disabled`).
    #[inline]
    fn next_token_matches(&mut self, pred: impl FnOnce(&Self) -> bool) -> bool {
        let old_lexer = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let result = matches!(self.lexer.next(), Ok(())) && pred(self);
        self.lexer.restore(&old_lexer);
        result
    }

    #[inline]
    fn check_for_arrow_after_the_current_token(&mut self) -> bool {
        self.next_token_matches(|p| p.lexer.token == T::TEqualsGreaterThan)
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
        if !p.lexer.has_newline_before && level.lt(Level::Member) {
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
                        let body_flags = Self::arrow_body_flags(flags);
                        let arrow_body =
                            p.parse_arrow_body_with_flags(args, &mut data, body_flags)?;
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
                            let body_flags = Self::arrow_body_flags(flags);
                            let parsed = p.parse_arrow_body_with_flags(args, &mut data, body_flags);
                            // Pop the scope on the error path too.
                            let mut arrow_body = match parsed {
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
                    p.lexer.next()?;
                    let opts = ParenExprOpts {
                        is_async: true,
                        is_after_question_and_before_colon: flags
                            == EFlags::AfterQuestionAndBeforeColon,
                        ..Default::default()
                    };
                    if !SCAN_ONLY
                        && Self::IS_TYPESCRIPT_ENABLED
                        && p.starts_for_parse_only.is_some()
                    {
                        return p.parse_paren_expr_for_lint_cold(async_range.loc, level, opts);
                    }
                    return p.parse_paren_expr(async_range.loc, level, opts);
                }

                // "async<T>()"
                // "async <T>() => {}"
                T::TLessThan => {
                    if Self::IS_TYPESCRIPT_ENABLED
                        && (!p.is_jsx_enabled() || p.is_ts_arrow_fn_jsx()?)
                    {
                        match p
                            .try_skip_type_script_type_parameters_then_open_paren_with_backtracking(
                            ) {
                            SkipTypeParameterResult::DidNotSkipAnything => {}
                            result => {
                                p.lexer.next()?;
                                // In a JSX file these type parameters prove an arrow function, as in the reference
                                let is_before_colon = flags == EFlags::AfterQuestionAndBeforeColon
                                    && !p.is_jsx_enabled();
                                let opts = ParenExprOpts {
                                    is_async: true,
                                    force_arrow_fn: result
                                        == SkipTypeParameterResult::DefinitelyTypeParameters,
                                    is_after_question_and_before_colon: is_before_colon,
                                    ..Default::default()
                                };
                                if !SCAN_ONLY && p.starts_for_parse_only.is_some() {
                                    return p.parse_paren_expr_for_lint_cold(
                                        async_range.loc,
                                        level,
                                        opts,
                                    );
                                }
                                return p.parse_paren_expr(async_range.loc, level, opts);
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

/// Where the binding starts that `item`, an entry of a list in parentheses, becomes as a parameter.
fn arrow_parameter_loc(item: Expr) -> bun_ast::Loc {
    match item.data {
        js_ast::expr::Data::ESpread(spread) => spread.value.loc,
        _ => item.loc,
    }
}

/// `P::log_arrow_arg_errors` for `parse_paren_expr_for_lint`, so that the one keeps its single caller.
fn log_arrow_arg_errors_for_lint(
    log: &mut bun_ast::Log,
    source: &bun_ast::Source,
    errors: DeferredArrowArgErrors,
) {
    if errors.invalid_expr_await.len > 0 {
        log.add_range_error(
            Some(source),
            errors.invalid_expr_await,
            b"Cannot use an \"await\" expression here",
        );
    }

    if errors.invalid_expr_yield.len > 0 {
        log.add_range_error(
            Some(source),
            errors.invalid_expr_yield,
            b"Cannot use a \"yield\" expression here",
        );
    }
}

/// `P::pop_and_flatten_scope` for `parse_paren_expr_for_lint`, so that the one keeps its single caller.
fn pop_and_flatten_scope_for_lint(
    current_scope: &mut js_ast::StoreRef<js_ast::Scope>,
    scopes_in_order: &mut crate::parser::ScopeOrderList<'_>,
    scope_index: usize,
) {
    let to_flatten = *current_scope;
    let Some(mut parent) = to_flatten.parent else {
        return;
    };
    *current_scope = parent;

    // A tombstone keeps the indices of the scopes that were pushed after this one.
    if let Some(entry) = scopes_in_order.get_mut(scope_index) {
        *entry = None;
    }
    if scopes_in_order.len() == scope_index + 1 {
        scopes_in_order.truncate(scope_index);
    }

    // The scope is the last child of its parent: its own children take its place.
    let last = parent.children.len_u32().saturating_sub(1);
    parent.children.truncate(last as usize);
    for item in to_flatten.children.slice() {
        let mut item = *item;
        item.parent = Some(parent);
        VecExt::append(&mut parent.children, item);
    }
}
