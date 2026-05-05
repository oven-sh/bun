use core::mem;

use bumpalo::collections::Vec as BumpVec;

use bun_core::{err, Error};
use bun_logger as logger;
use bun_str::strings;

use crate::ast as js_ast;
use crate::ast::{
    Binding, Expr, ExprNodeIndex, ExprNodeList, Flags, LocRef, Stmt, Symbol, B, E, G, S,
};
use crate::ast::Op::Level;
use crate::js_lexer::{self, T};
use crate::{
    AwaitOrYield, DeferredArrowArgErrors, DeferredErrors, ExprListLoc, ExprOrLetStmt,
    FnOrArrowDataParse, JSXTransformType, LocList, NewParser_, ParenExprOpts, ParseBindingOptions,
    ParseClassOptions, ParseStatementOptions, ParsedPath, Prefill, PropertyOpts, StmtList,
    TypeScript,
};

// ──────────────────────────────────────────────────────────────────────────
// Zig: `pub fn Parse(comptime ts, comptime jsx, comptime scan) type { return struct { ... } }`
// This is a comptime mixin that bundles parse-phase methods for `NewParser_`.
// In Rust we model it as a zero-sized marker with const-generic params and an
// inherent impl whose associated fns take `&mut P` as the receiver-equivalent.
// TODO(port): Phase B may collapse this into `impl NewParser_<..>` directly.
// ──────────────────────────────────────────────────────────────────────────
pub struct Parse<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

type P<const TS: bool, const JSX: JSXTransformType, const SCAN: bool> = NewParser_<TS, JSX, SCAN>;

impl<
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > Parse<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    const IS_JSX_ENABLED: bool =
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::IS_JSX_ENABLED;
    const IS_TYPESCRIPT_ENABLED: bool =
        P::<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::IS_TYPESCRIPT_ENABLED;

    // ──────────────────────────────────────────────────────────────────────
    // Re-exports from sibling parse modules.
    // In Zig these are `pub const parseX = @import("./parseX.zig").ParseX(ts,jsx,scan).parseX;`
    // — associated-const aliases to sibling generic-struct methods. Rust impls
    // cannot `pub use`, so Phase B should make all of these inherent methods on
    // `NewParser_<TS,JSX,SCAN>` (one impl block per sibling file) and delete
    // this aggregator.
    // TODO(port): re-export parse_prefix from super::parse_prefix::ParsePrefix
    // TODO(port): re-export parse_suffix from super::parse_suffix::ParseSuffix
    // TODO(port): re-export parse_stmt from super::parse_stmt::ParseStmt
    // TODO(port): re-export parse_property from super::parse_property::ParseProperty
    // TODO(port): re-export parse_fn / parse_fn_stmt / parse_fn_expr / parse_fn_body / parse_arrow_body from super::parse_fn::ParseFn
    // TODO(port): re-export parse_jsx_element from super::parse_jsx_element::ParseJSXElement
    // TODO(port): re-export parse_import_expr / parse_import_clause / parse_export_clause from super::parse_import_export::ParseImportExport
    // TODO(port): re-export parse_type_script_decorators / parse_standard_decorator / parse_type_script_namespace_stmt / parse_type_script_import_equals_stmt / parse_typescript_enum_stmt from super::parse_typescript::ParseTypescript
    // ──────────────────────────────────────────────────────────────────────

    #[inline]
    pub fn parse_expr_or_bindings(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        p.parse_expr_common(level, errors, Expr::EFlags::None, expr)
    }

    #[inline]
    pub fn parse_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
    ) -> Result<Expr, Error> {
        // PORT NOTE: Zig used `var expr: Expr = undefined;` (out-param). Reshaped to return value.
        let mut expr = Expr::default();
        p.parse_expr_common(level, None, Expr::EFlags::None, &mut expr)?;
        Ok(expr)
    }

    #[inline]
    pub fn parse_expr_with_flags(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        flags: Expr::EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        p.parse_expr_common(level, None, flags, expr)
    }

    pub fn parse_expr_common(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        flags: Expr::EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        if !p.stack_check.is_safe_to_recurse() {
            bun_core::throw_stack_overflow()?;
        }

        let had_pure_comment_before =
            p.lexer.has_pure_comment_before && !p.options.ignore_dce_annotations;
        *expr = p.parse_prefix(level, errors.as_deref_mut(), flags)?;
        // PORT NOTE: reshaped for borrowck — `errors` is reborrowed below.

        // There is no formal spec for "__PURE__" comments but from reverse-
        // engineering, it looks like they apply to the next CallExpression or
        // NewExpression. So in "/* @__PURE__ */ a().b() + c()" the comment applies
        // to the expression "a().b()".

        if had_pure_comment_before && level.lt(Level::Call) {
            // SAFETY: Level is #[repr(uN)]; `Call as uN - 1` is a valid discriminant.
            let sub_call =
                unsafe { mem::transmute::<u8, Level>(Level::Call as u8 - 1) };
            p.parse_suffix(expr, sub_call, errors.as_deref_mut(), flags)?;
            match &mut expr.data {
                Expr::Data::ECall(ex) => {
                    ex.can_be_unwrapped_if_unused = E::CanBeUnwrapped::IfUnused;
                }
                Expr::Data::ENew(ex) => {
                    ex.can_be_unwrapped_if_unused = E::CanBeUnwrapped::IfUnused;
                }
                _ => {}
            }
        }

        p.parse_suffix(expr, level, errors, flags)?;
        Ok(())
    }

    pub fn parse_yield_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
    ) -> Result<ExprNodeIndex, Error> {
        // TODO(port): narrow error set
        // Parse a yield-from expression, which yields from an iterator
        let is_star = p.lexer.token == T::TAsterisk;

        if is_star {
            if p.lexer.has_newline_before {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
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

        Ok(p.new_expr(
            E::Yield {
                value,
                is_star,
            },
            loc,
        ))
    }

    // By the time we call this, the identifier and type parameters have already
    // been parsed. We need to start parsing from the "extends" clause.
    pub fn parse_class(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        class_keyword: logger::Range,
        name: Option<js_ast::LocRef>,
        class_opts: ParseClassOptions,
    ) -> Result<G::Class, Error> {
        // TODO(port): narrow error set
        let mut extends: Option<Expr> = None;
        let mut has_decorators: bool = false;
        let mut has_auto_accessor: bool = false;

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
                let _ = p.skip_type_script_type_arguments(false)?; // isInsideJSXElement
            }
        }

        if Self::IS_TYPESCRIPT_ENABLED {
            if p.lexer.is_contextual_keyword(b"implements") {
                p.lexer.next()?;

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
        p.lexer.expect(T::TOpenBrace)?;
        let mut properties = BumpVec::<G::Property>::new_in(p.allocator);

        // Allow "in" and private fields inside class bodies
        let old_allow_in = p.allow_in;
        let old_allow_private_identifiers = p.allow_private_identifiers;
        p.allow_in = true;
        p.allow_private_identifiers = true;

        // A scope is needed for private identifiers
        let scope_index = p
            .push_scope_for_parse_pass(js_ast::Scope::Kind::ClassBody, body_loc)
            .expect("unreachable");

        let mut opts = PropertyOpts {
            is_class: true,
            allow_ts_decorators: class_opts.allow_ts_decorators,
            class_has_extends: extends.is_some(),
            ..Default::default()
        };
        while !p.lexer.token.is_close_brace_or_eof() {
            if p.lexer.token == T::TSemicolon {
                p.lexer.next()?;
                continue;
            }

            opts = PropertyOpts {
                is_class: true,
                allow_ts_decorators: class_opts.allow_ts_decorators,
                class_has_extends: extends.is_some(),
                has_argument_decorators: false,
                ..Default::default()
            };

            // Parse decorators for this property
            let first_decorator_loc = p.lexer.loc();
            if opts.allow_ts_decorators {
                opts.ts_decorators = p.parse_type_script_decorators()?;
                opts.has_class_decorators = class_opts.ts_decorators.len() > 0;
                has_decorators = has_decorators || opts.ts_decorators.len() > 0;
            } else {
                opts.ts_decorators = &[];
            }

            // This property may turn out to be a type in TypeScript, which should be ignored
            if let Some(property) = p.parse_property(G::Property::Kind::Normal, &mut opts, None)? {
                properties.push(property);
                // PERF(port): was assume_capacity (catch unreachable on append)
                has_auto_accessor =
                    has_auto_accessor || property.kind == G::Property::Kind::AutoAccessor;

                // Forbid decorators on class constructors
                if opts.ts_decorators.len() > 0 {
                    let key = property.key.unwrap_or_else(|| {
                        p.panic("Internal error: Expected property to have a key.", &[])
                    });
                    match &key.data {
                        Expr::Data::EString(str) => {
                            if str.eql_comptime(b"constructor") {
                                p.log
                                    .add_error(
                                        p.source,
                                        first_decorator_loc,
                                        b"TypeScript does not allow decorators on class constructors",
                                    )
                                    .expect("unreachable");
                            }
                        }
                        _ => {}
                    }
                }

                has_decorators = has_decorators || opts.has_argument_decorators;
            }
        }

        if class_opts.is_type_script_declare {
            p.pop_and_discard_scope(scope_index);
        } else {
            p.pop_scope();
        }

        p.allow_in = old_allow_in;
        p.allow_private_identifiers = old_allow_private_identifiers;
        let close_brace_loc = p.lexer.loc();
        p.lexer.expect(T::TCloseBrace)?;

        let has_any_decorators = has_decorators || class_opts.ts_decorators.len() > 0;
        Ok(G::Class {
            class_name: name,
            extends,
            close_brace_loc,
            ts_decorators: ExprNodeList::from_owned_slice(class_opts.ts_decorators),
            class_keyword,
            body_loc,
            properties: properties.into_bump_slice(),
            has_decorators: has_any_decorators,
            should_lower_standard_decorators: p.options.features.standard_decorators
                && (has_any_decorators || has_auto_accessor),
        })
    }

    pub fn parse_template_parts(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        include_raw: bool,
    ) -> Result<&'bump [E::TemplatePart], Error> {
        // TODO(port): narrow error set; lifetime 'bump on return slice
        let mut parts =
            BumpVec::<E::TemplatePart>::with_capacity_in(1, p.allocator);
        // PERF(port): was assume_capacity (initCapacity catch unreachable)
        // Allow "in" inside template literals
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        'parse_template_part: loop {
            p.lexer.next()?;
            let value = p.parse_expr(Level::Lowest)?;
            let tail_loc = p.lexer.loc();
            p.lexer.rescan_close_brace_as_template_token()?;

            let tail: E::Template::Contents = 'brk: {
                if !include_raw {
                    break 'brk E::Template::Contents::Cooked(p.lexer.to_e_string()?);
                }
                break 'brk E::Template::Contents::Raw(p.lexer.raw_template_contents());
            };

            parts.push(E::TemplatePart {
                value,
                tail_loc,
                tail,
            });
            // PERF(port): was assume_capacity (append catch unreachable)

            if p.lexer.token == T::TTemplateTail {
                p.lexer.next()?;
                break 'parse_template_part;
            }
            if cfg!(debug_assertions) {
                debug_assert!(p.lexer.token != T::TEndOfFile);
            }
        }

        p.allow_in = old_allow_in;

        Ok(parts.into_bump_slice())
    }

    // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
    pub fn parse_string_literal(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<Expr, Error> {
        let loc = p.lexer.loc();
        let mut str = p.lexer.to_e_string()?;
        str.prefer_template = p.lexer.token == T::TNoSubstitutionTemplateLiteral;

        let expr = p.new_expr(str, loc);
        p.lexer.next()?;
        Ok(expr)
    }

    pub fn parse_call_args(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<ExprListLoc, Error> {
        // Allow "in" inside call arguments
        let old_allow_in = p.allow_in;
        p.allow_in = true;
        // TODO(port): errdefer — restore `p.allow_in = old_allow_in` on error path (borrowck blocks scopeguard over &mut p)

        let mut args = BumpVec::<Expr>::new_in(p.allocator);
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
            // PERF(port): was assume_capacity (append catch unreachable)
            if p.lexer.token != T::TComma {
                break;
            }
            p.lexer.next()?;
        }
        let close_paren_loc = p.lexer.loc();
        p.lexer.expect(T::TCloseParen)?;
        p.allow_in = old_allow_in;
        Ok(ExprListLoc {
            list: ExprNodeList::move_from_list(&mut args),
            loc: close_paren_loc,
        })
    }

    pub fn parse_jsx_prop_value_identifier(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        previous_string_with_backslash_loc: &mut logger::Loc,
    ) -> Result<Expr, Error> {
        // TODO(port): narrow error set
        // Use NextInsideJSXElement() not Next() so we can parse a JSX-style string literal
        p.lexer.next_inside_jsx_element()?;
        if p.lexer.token == T::TStringLiteral {
            previous_string_with_backslash_loc.start = p
                .lexer
                .loc()
                .start
                .max(p.lexer.previous_backslash_quote_in_jsx.loc.start);
            let expr = p.new_expr(p.lexer.to_e_string()?, *previous_string_with_backslash_loc);

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
    pub fn parse_paren_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
        level: Level,
        opts: ParenExprOpts,
    ) -> Result<Expr, Error> {
        let mut items_list = BumpVec::<Expr>::new_in(p.allocator);
        let mut errors = DeferredErrors::default();
        let mut arrow_arg_errors = DeferredArrowArgErrors::default();
        let mut spread_range = logger::Range::default();
        let mut type_colon_range = logger::Range::default();
        let mut comma_after_spread: Option<logger::Loc> = None;

        // Push a scope assuming this is an arrow function. It may not be, in which
        // case we'll need to roll this change back. This has to be done ahead of
        // parsing the arguments instead of later on when we hit the "=>" token and
        // we know it's an arrow function because the arguments may have default
        // values that introduce new scopes and declare new symbols. If this is an
        // arrow function, then those new scopes will need to be parented under the
        // scope of the arrow function itself.
        let scope_index = p.push_scope_for_parse_pass(js_ast::Scope::Kind::FunctionArgs, loc)?;

        // Allow "in" inside parentheses
        let old_allow_in = p.allow_in;
        p.allow_in = true;

        // Forbid "await" and "yield", but only for arrow functions
        // PORT NOTE: Zig saved/restored via toBytes/bytesToValue; clone is equivalent.
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

            // PORT NOTE: reshaped for borrowck — Zig wrote into unusedCapacitySlice()[0]
            // then bumped len. Push a placeholder and borrow last_mut() instead.
            items_list.reserve(1);
            items_list.push(Expr::default());
            let item_idx = items_list.len() - 1;
            {
                let item: &mut Expr = &mut items_list[item_idx];
                p.parse_expr_or_bindings(Level::Comma, Some(&mut errors), item)?;
            }

            if is_spread {
                let v = items_list[item_idx];
                items_list[item_idx] = p.new_expr(E::Spread { value: v }, loc);
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
                let v = items_list[item_idx];
                items_list[item_idx] = Expr::assign(v, p.parse_expr(Level::Comma)?);
            }

            if p.lexer.token != T::TComma {
                break;
            }

            // Spread arguments must come last. If there's a spread argument followed
            if is_spread {
                comma_after_spread = Some(p.lexer.loc());
            }

            // Eat the comma token
            p.lexer.next()?;
        }
        let items = items_list.into_bump_slice();
        // PORT NOTE: Zig kept `items_list` alive and aliased `.items`; bump_slice is equivalent (arena-owned).

        // The parenthetical construct must end with a close parenthesis
        p.lexer.expect(T::TCloseParen)?;

        // Restore "in" operator status before we parse the arrow function body
        p.allow_in = old_allow_in;

        // Also restore "await" and "yield" expression errors
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // Are these arguments to an arrow function?
        if p.lexer.token == T::TEqualsGreaterThan
            || opts.force_arrow_fn
            || (Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon)
        {
            // Arrow functions are not allowed inside certain expressions
            if level.gt(Level::Assign) {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }

            let mut invalid_log = LocList::new_in(p.allocator);
            let mut args = BumpVec::<G::Arg>::new_in(p.allocator);

            if opts.is_async {
                // markl,oweredsyntaxpoksdpokasd
            }

            // First, try converting the expressions to bindings
            for i in 0..items.len() {
                let mut is_spread = false;
                match &items[i].data {
                    Expr::Data::ESpread(v) => {
                        is_spread = true;
                        items[i] = v.value;
                    }
                    _ => {}
                }

                let mut item = items[i];
                let tuple =
                    p.convert_expr_to_binding_and_initializer(&mut item, &mut invalid_log, is_spread);
                // double allocations
                args.push(G::Arg {
                    binding: tuple.binding.unwrap_or(Binding {
                        data: Prefill::Data::B_MISSING,
                        loc: item.loc,
                    }),
                    default: tuple.expr,
                    ..Default::default()
                });
                // PERF(port): was assume_capacity (append catch unreachable)
            }

            // Avoid parsing TypeScript code like "a ? (1 + 2) : (3 + 4)" as an arrow
            // function. The ":" after the ")" may be a return type annotation, so we
            // attempt to convert the expressions to bindings first before deciding
            // whether this is an arrow function, and only pick an arrow function if
            // there were no conversion errors.
            if p.lexer.token == T::TEqualsGreaterThan
                || (Self::IS_TYPESCRIPT_ENABLED
                    && invalid_log.is_empty()
                    && p.try_skip_type_script_arrow_return_type_with_backtracking())
                || opts.force_arrow_fn
            {
                p.maybe_comma_spread_error(comma_after_spread);
                p.log_arrow_arg_errors(&mut arrow_arg_errors);

                // Now that we've decided we're an arrow function, report binding pattern
                // conversion errors
                if !invalid_log.is_empty() {
                    for loc_ in invalid_log.iter() {
                        loc_.add_error(p.log, p.source);
                    }
                }
                let mut arrow_data = FnOrArrowDataParse {
                    allow_await: if opts.is_async {
                        AwaitOrYield::AllowExpr
                    } else {
                        AwaitOrYield::AllowIdent
                    },
                    ..Default::default()
                };
                let mut arrow = p.parse_arrow_body(args.into_bump_slice(), &mut arrow_data)?;
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
            p.log
                .add_range_error(p.source, type_colon_range, b"Unexpected \":\"")?;
            return Err(err!("SyntaxError"));
        }

        // Are these arguments for a call to a function named "async"?
        if opts.is_async {
            p.log_expr_errors(&mut errors);
            let async_expr = p.new_expr(
                E::Identifier {
                    ref_: p.store_name_in_ref(b"async")?,
                    ..Default::default()
                },
                loc,
            );
            return Ok(p.new_expr(
                E::Call {
                    target: async_expr,
                    args: ExprNodeList::from_owned_slice(items),
                    ..Default::default()
                },
                loc,
            ));
        }

        // Is this a chain of expressions and comma operators?
        if items.len() > 0 {
            p.log_expr_errors(&mut errors);
            if spread_range.len > 0 {
                p.log
                    .add_range_error(p.source, type_colon_range, b"Unexpected \"...\"")?;
                return Err(err!("SyntaxError"));
            }

            let mut value = Expr::join_all_with_comma(items, p.allocator);
            p.mark_expr_as_parenthesized(&mut value);
            return Ok(value);
        }

        // Indicate that we expected an arrow function
        p.lexer.expected(T::TEqualsGreaterThan)?;
        Err(err!("SyntaxError"))
    }

    pub fn parse_label_name(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<Option<js_ast::LocRef>, Error> {
        // TODO(port): narrow error set
        if p.lexer.token != T::TIdentifier || p.lexer.has_newline_before {
            return Ok(None);
        }

        let name = LocRef {
            loc: p.lexer.loc(),
            ref_: Some(p.store_name_in_ref(p.lexer.identifier)?),
        };
        p.lexer.next()?;
        Ok(Some(name))
    }

    pub fn parse_class_stmt(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        loc: logger::Loc,
        opts: &mut ParseStatementOptions,
    ) -> Result<Stmt, Error> {
        // TODO(port): narrow error set
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
                return Err(err!("SyntaxError"));
            }

            if p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowIdent
                && name_text == b"await"
            {
                p.log.add_range_error(
                    p.source,
                    p.lexer.range(),
                    b"Cannot use \"await\" as an identifier here",
                )?;
            }

            name = Some(LocRef {
                loc: name_loc,
                ref_: None,
            });
            if !opts.is_typescript_declare {
                name.as_mut().unwrap().ref_ = Some(
                    p.declare_symbol(Symbol::Kind::Class, name_loc, name_text)
                        .expect("unreachable"),
                );
            }
        }

        // Even anonymous classes can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(TypeScript::SkipTypeParameterOptions {
                allow_in_out_variance_annotations: true,
                allow_const_modifier: true,
                ..Default::default()
            })?;
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
            .push_scope_for_parse_pass(js_ast::Scope::Kind::ClassName, loc)
            .expect("unreachable");
        let class = p.parse_class(class_keyword, name, class_opts)?;

        if Self::IS_TYPESCRIPT_ENABLED {
            if opts.is_typescript_declare {
                p.pop_and_discard_scope(scope_index);
                if opts.is_namespace_scope && opts.is_export {
                    p.has_non_local_export_declare_inside_namespace = true;
                }

                return Ok(p.s(S::TypeScript {}, loc));
            }
        }

        p.pop_scope();
        Ok(p.s(
            S::Class {
                class,
                is_export: opts.is_export,
                ..Default::default()
            },
            loc,
        ))
    }

    pub fn parse_clause_alias(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        kind: &[u8],
    ) -> Result<&'bump [u8], Error> {
        // TODO(port): narrow error set; lifetime 'bump on return slice
        let loc = p.lexer.loc();

        // The alias may now be a utf-16 (not wtf-16) string (see https://github.com/tc39/ecma262/pull/2154)
        if p.lexer.token == T::TStringLiteral {
            let estr = p.lexer.to_e_string()?;
            if estr.is_utf8() {
                return Ok(estr.slice8());
            } else {
                match strings::to_utf8_alloc_with_type_without_invalid_surrogate_pairs(
                    p.lexer.allocator,
                    estr.slice16(),
                ) {
                    Ok(alias_utf8) => return Ok(alias_utf8),
                    Err(e) => {
                        let r = p.source.range_of_string(loc);
                        p.log.add_range_error_fmt(
                            p.source,
                            r,
                            p.allocator,
                            format_args!(
                                "Invalid {} alias because it contains an unpaired Unicode surrogate ({})",
                                bstr::BStr::new(kind),
                                e.name()
                            ),
                        )?;
                        return Ok(p.source.text_for_range(r));
                    }
                }
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

    pub fn parse_expr_or_let_stmt(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        opts: &mut ParseStatementOptions,
    ) -> Result<ExprOrLetStmt, Error> {
        // TODO(port): narrow error set
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
                    if opts.lexical_decl == ParseStatementOptions::LexicalDecl::AllowAll
                        || !p.lexer.has_newline_before
                        || p.lexer.token == T::TOpenBracket
                    {
                        if opts.lexical_decl != ParseStatementOptions::LexicalDecl::AllowAll {
                            p.forbid_lexical_decl(token_range.loc)?;
                        }

                        let mut decls_list = p.parse_and_declare_decls(Symbol::Kind::Other, opts)?;
                        let decls = G::Decl::List::move_from_list(&mut decls_list);
                        return Ok(ExprOrLetStmt {
                            stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                                S::Local {
                                    kind: S::Local::Kind::KLet,
                                    decls,
                                    is_export: opts.is_export,
                                    ..Default::default()
                                },
                                token_range.loc,
                            )),
                            decls: decls.slice(),
                        });
                    }
                }
                _ => {}
            }
        } else if raw == b"using" {
            // Handle an "using" declaration
            if opts.is_export {
                p.log.add_error(
                    p.source,
                    token_range.loc,
                    b"Cannot use \"export\" with a \"using\" declaration",
                )?;
            }

            p.lexer.next()?;

            if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {
                if opts.lexical_decl != ParseStatementOptions::LexicalDecl::AllowAll {
                    p.forbid_lexical_decl(token_range.loc)?;
                }
                // p.markSyntaxFeature(.using, token_range.loc);
                opts.is_using_statement = true;
                let mut decls_list = p.parse_and_declare_decls(Symbol::Kind::Constant, opts)?;
                let decls = G::Decl::List::move_from_list(&mut decls_list);
                if !opts.is_for_loop_init {
                    p.require_initializers(S::Local::Kind::KUsing, decls.slice())?;
                }
                return Ok(ExprOrLetStmt {
                    stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                        S::Local {
                            kind: S::Local::Kind::KUsing,
                            decls,
                            is_export: false,
                            ..Default::default()
                        },
                        token_range.loc,
                    )),
                    decls: decls.slice(),
                });
            }
        } else if p.fn_or_arrow_data_parse.allow_await == AwaitOrYield::AllowExpr && raw == b"await"
        {
            // Handle an "await using" declaration
            if opts.is_export {
                p.log.add_error(
                    p.source,
                    token_range.loc,
                    b"Cannot use \"export\" with an \"await using\" declaration",
                )?;
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
                        if opts.lexical_decl != ParseStatementOptions::LexicalDecl::AllowAll {
                            p.forbid_lexical_decl(using_range.loc)?;
                        }
                        // p.markSyntaxFeature(.using, using_range.loc);
                        opts.is_using_statement = true;
                        let mut decls_list =
                            p.parse_and_declare_decls(Symbol::Kind::Constant, opts)?;
                        let decls = G::Decl::List::move_from_list(&mut decls_list);
                        if !opts.is_for_loop_init {
                            p.require_initializers(S::Local::Kind::KAwaitUsing, decls.slice())?;
                        }
                        return Ok(ExprOrLetStmt {
                            stmt_or_expr: js_ast::StmtOrExpr::Stmt(p.s(
                                S::Local {
                                    kind: S::Local::Kind::KAwaitUsing,
                                    decls,
                                    is_export: false,
                                    ..Default::default()
                                },
                                token_range.loc,
                            )),
                            decls: decls.slice(),
                        });
                    }
                    break 'value Expr {
                        data: Expr::Data::EIdentifier(E::Identifier {
                            ref_: p.store_name_in_ref(raw)?,
                            ..Default::default()
                        }),
                        // TODO: implement saveExprCommentsHere and use using_loc here
                        loc: using_range.loc,
                    };
                }
            } else {
                p.parse_expr(Level::Prefix)?
            };

            if p.lexer.token == T::TAsteriskAsterisk {
                p.lexer.unexpected()?;
            }
            p.parse_suffix(&mut value, Level::Prefix, None, Expr::EFlags::None)?;
            let mut expr = p.new_expr(E::Await { value }, token_range.loc);
            p.parse_suffix(&mut expr, Level::Lowest, None, Expr::EFlags::None)?;
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
        let ref_ = p.store_name_in_ref(raw)?;
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
        // PORT NOTE: reshaped for borrowck — Zig mutated `result.stmt_or_expr.expr` in place.
        if let js_ast::StmtOrExpr::Expr(ref mut e) = result.stmt_or_expr {
            p.parse_suffix(e, Level::Lowest, None, Expr::EFlags::None)?;
        }
        Ok(result)
    }

    pub fn parse_binding(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        opts: ParseBindingOptions,
    ) -> Result<Binding, Error> {
        // PERF(port): was comptime monomorphization (`comptime opts`) — profile in Phase B
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
                    p.log
                        .add_range_error(
                            p.source,
                            p.lexer.range(),
                            b"Cannot use \"yield\" or \"await\" here.",
                        )
                        .expect("unreachable");
                }

                let ref_ = p.store_name_in_ref(name).expect("unreachable");
                p.lexer.next()?;
                return Ok(p.b(B::Identifier { ref_ }, loc));
            }
            T::TOpenBracket => {
                if !opts.is_using_statement {
                    p.lexer.next()?;
                    let mut is_single_line = !p.lexer.has_newline_before;
                    let mut items = BumpVec::<js_ast::ArrayBinding>::new_in(p.allocator);
                    let mut has_spread = false;

                    // "in" expressions are allowed
                    let old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while p.lexer.token != T::TCloseBracket {
                        if p.lexer.token == T::TComma {
                            items.push(js_ast::ArrayBinding {
                                binding: Binding {
                                    data: Prefill::Data::B_MISSING,
                                    loc: p.lexer.loc(),
                                },
                                ..Default::default()
                            });
                            // PERF(port): was assume_capacity (append catch unreachable)
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

                            items.push(js_ast::ArrayBinding {
                                binding,
                                default_value,
                            });
                            // PERF(port): was assume_capacity (append catch unreachable)

                            // Commas after spread elements are not allowed
                            if has_spread && p.lexer.token == T::TComma {
                                p.log
                                    .add_range_error(
                                        p.source,
                                        p.lexer.range(),
                                        b"Unexpected \",\" after rest pattern",
                                    )
                                    .expect("unreachable");
                                return Err(err!("SyntaxError"));
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
                            items: items.into_bump_slice(),
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
                    let mut properties = BumpVec::<js_ast::B::Property>::new_in(p.allocator);

                    // "in" expressions are allowed
                    let old_allow_in = p.allow_in;
                    p.allow_in = true;

                    while p.lexer.token != T::TCloseBrace {
                        let property = p.parse_property_binding()?;
                        properties.push(property);
                        // PERF(port): was assume_capacity (append catch unreachable)

                        // Commas after spread elements are not allowed
                        if property.flags.contains(Flags::Property::IS_SPREAD)
                            && p.lexer.token == T::TComma
                        {
                            p.log
                                .add_range_error(
                                    p.source,
                                    p.lexer.range(),
                                    b"Unexpected \",\" after rest pattern",
                                )
                                .expect("unreachable");
                            return Err(err!("SyntaxError"));
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
                            properties: properties.into_bump_slice(),
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
            data: Prefill::Data::B_MISSING,
        })
    }

    pub fn parse_property_binding(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<B::Property, Error> {
        let mut key: js_ast::Expr = Expr {
            loc: logger::Loc::EMPTY,
            data: Prefill::Data::E_MISSING,
        };
        let mut is_computed = false;

        match p.lexer.token {
            T::TDotDotDot => {
                p.lexer.next()?;
                let value = p.b(
                    B::Identifier {
                        ref_: p.store_name_in_ref(p.lexer.identifier).expect("unreachable"),
                    },
                    p.lexer.loc(),
                );
                p.lexer.expect(T::TIdentifier)?;
                return Ok(B::Property {
                    key: p.new_expr(E::Missing {}, p.lexer.loc()),

                    flags: Flags::Property::IS_SPREAD,
                    value,
                    ..Default::default()
                });
            }
            T::TNumericLiteral => {
                key = p.new_expr(
                    E::Number {
                        value: p.lexer.number,
                    },
                    p.lexer.loc(),
                );
                // check for legacy octal literal
                p.lexer.next()?;
            }
            T::TStringLiteral => {
                key = p.parse_string_literal()?;
            }
            T::TBigIntegerLiteral => {
                key = p.new_expr(
                    E::BigInt {
                        value: p.lexer.identifier,
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

                key = p.new_expr(E::String { data: name, ..Default::default() }, loc);

                if p.lexer.token != T::TColon && p.lexer.token != T::TOpenParen {
                    let ref_ = p.store_name_in_ref(name).expect("unreachable");
                    let value = p.b(B::Identifier { ref_ }, loc);
                    let mut default_value: Option<Expr> = None;
                    if p.lexer.token == T::TEquals {
                        p.lexer.next()?;
                        default_value = Some(p.parse_expr(Level::Comma)?);
                    }

                    return Ok(B::Property {
                        key,
                        value,
                        default_value,
                        ..Default::default()
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
                Flags::Property::IS_COMPUTED
            } else {
                Flags::Property::empty()
            },
            key,
            value,
            default_value,
        })
    }

    pub fn parse_and_declare_decls(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        kind: Symbol::Kind,
        opts: &mut ParseStatementOptions,
    ) -> Result<BumpVec<'bump, G::Decl>, Error> {
        // TODO(port): lifetime 'bump on return type
        let mut decls = BumpVec::<G::Decl>::new_in(p.allocator);

        loop {
            // Forbid "let let" and "const let" but not "var let"
            if (kind == Symbol::Kind::Other || kind == Symbol::Kind::Constant)
                && p.lexer.is_contextual_keyword(b"let")
            {
                p.log
                    .add_range_error(
                        p.source,
                        p.lexer.range(),
                        b"Cannot use \"let\" as an identifier here",
                    )
                    .expect("unreachable");
            }

            let mut value: Option<js_ast::Expr> = None;
            // PERF(port): was comptime bool dispatch (`inline else => |is_using|`) — profile in Phase B
            let mut local = p.parse_binding(ParseBindingOptions {
                is_using_statement: opts.is_using_statement,
            })?;
            p.declare_binding(kind, &mut local, opts).expect("unreachable");

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
            // PERF(port): was assume_capacity (append catch unreachable)

            if p.lexer.token != T::TComma {
                break;
            }
            p.lexer.next()?;
        }

        Ok(decls)
    }

    pub fn parse_path(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
    ) -> Result<ParsedPath, Error> {
        // TODO(port): narrow error set
        let path_text = p.lexer.to_utf8_e_string()?;
        let mut path = ParsedPath {
            loc: p.lexer.loc(),
            text: path_text.slice8(),
            is_macro: false,
            import_tag: ParsedPath::ImportTag::None,
            ..Default::default()
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
                        // PORT NOTE: Zig used `inline for` over enum values + @tagName.
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
                        let string_literal_text = p.lexer.to_utf8_e_string()?.slice8();
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
                let string_literal_text = p.lexer.to_utf8_e_string()?.slice8();
                if let Some(attr) = supported_attribute {
                    match attr {
                        SupportedAttribute::Type => {
                            // This logic is duplicated in js_ast.zig fn importRecordTag()
                            let type_attr = string_literal_text;
                            if type_attr == b"macro" {
                                path.is_macro = true;
                            } else if let Some(loader) =
                                bun_options_types::Loader::from_string(type_attr)
                            {
                                path.loader = Some(loader);
                                if loader == bun_options_types::Loader::Sqlite
                                    && has_seen_embed_true
                                {
                                    path.loader = Some(bun_options_types::Loader::SqliteEmbedded);
                                }
                            } else {
                                // unknown loader; consider erroring
                            }
                        }
                        SupportedAttribute::Embed => {
                            if string_literal_text == b"true" {
                                has_seen_embed_true = true;
                                if path.loader.is_some()
                                    && path.loader == Some(bun_options_types::Loader::Sqlite)
                                {
                                    path.loader =
                                        Some(bun_options_types::Loader::SqliteEmbedded);
                                }
                            }
                        }
                        SupportedAttribute::BunBakeGraph => {
                            if string_literal_text == b"ssr" {
                                path.import_tag = ParsedPath::ImportTag::BakeResolveToSsrGraph;
                            } else {
                                p.lexer.add_range_error(
                                    p.lexer.range(),
                                    "'bunBakeGraph' can only be set to 'ssr'",
                                    format_args!(""),
                                    true,
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

    pub fn parse_stmts_up_to(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        eend: js_lexer::T,
        _opts: &mut ParseStatementOptions,
    ) -> Result<&'bump [Stmt], Error> {
        // TODO(port): narrow error set; lifetime 'bump on return slice
        let mut opts = _opts.clone();
        let mut stmts = StmtList::new_in(p.allocator);

        let mut return_without_semicolon_start: i32 = -1;
        opts.lexical_decl = ParseStatementOptions::LexicalDecl::AllowAll;
        let mut is_directive_prologue = true;

        loop {
            for comment in p.lexer.comments_to_preserve_before.iter() {
                stmts.push(p.s(
                    S::Comment {
                        text: comment.text,
                    },
                    p.lexer.loc(),
                ));
            }
            p.lexer.comments_to_preserve_before.clear();

            if p.lexer.token == eend {
                break;
            }

            let mut current_opts = opts.clone();
            let mut stmt = p.parse_stmt(&mut current_opts)?;

            // Skip TypeScript types entirely
            if Self::IS_TYPESCRIPT_ENABLED {
                match stmt.data {
                    Stmt::Data::STypeScript(_) => {
                        continue;
                    }
                    _ => {}
                }
            }

            let mut skip = matches!(stmt.data, Stmt::Data::SEmpty(_));
            // Parse one or more directives at the beginning
            if is_directive_prologue {
                is_directive_prologue = false;
                match &stmt.data {
                    Stmt::Data::SExpr(expr) => match &expr.value.data {
                        Expr::Data::EString(str) => {
                            if !str.prefer_template {
                                is_directive_prologue = true;

                                if str.eql_comptime(b"use strict") {
                                    skip = true;
                                    // Track "use strict" directives
                                    p.current_scope.strict_mode =
                                        js_ast::Scope::StrictMode::ExplicitStrictMode;
                                    if core::ptr::eq(p.current_scope, p.module_scope) {
                                        p.module_scope_directive_loc = stmt.loc;
                                    }
                                } else if str.eql_comptime(b"use asm") {
                                    skip = true;
                                    stmt.data = Prefill::Data::S_EMPTY;
                                } else {
                                    stmt = Stmt::alloc(
                                        S::Directive {
                                            value: str.slice(p.allocator),
                                        },
                                        stmt.loc,
                                    );
                                }
                            }
                        }
                        _ => {}
                    },
                    _ => {}
                }
            }

            if !skip {
                stmts.push(stmt);
            }

            // Warn about ASI and return statements. Here's an example of code with
            // this problem: https://github.com/rollup/rollup/issues/3729
            if !p.options.suppress_warnings_about_weird_code {
                let mut needs_check = true;
                match &stmt.data {
                    Stmt::Data::SReturn(ret) => {
                        if ret.value.is_none() && !p.latest_return_had_semicolon {
                            return_without_semicolon_start = stmt.loc.start;
                            needs_check = false;
                        }
                    }
                    _ => {}
                }

                if needs_check && return_without_semicolon_start != -1 {
                    match &stmt.data {
                        Stmt::Data::SExpr(_) => {
                            p.log.add_warning(
                                p.source,
                                logger::Loc {
                                    start: return_without_semicolon_start + 6,
                                },
                                b"The following expression is not returned because of an automatically-inserted semicolon",
                            )?;
                        }
                        _ => {}
                    }

                    return_without_semicolon_start = -1;
                }
            }
        }

        Ok(stmts.into_bump_slice())
    }

    /// This parses an expression. This assumes we've already parsed the "async"
    /// keyword and are currently looking at the following token.
    pub fn parse_async_prefix_expr(
        p: &mut P<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        async_range: logger::Range,
        level: Level,
    ) -> Result<Expr, Error> {
        // TODO(port): narrow error set
        // "async function() {}"
        if !p.lexer.has_newline_before && p.lexer.token == T::TFunction {
            return p.parse_fn_expr(async_range.loc, true, async_range);
        }

        // Check the precedence level to avoid parsing an arrow function in
        // "new async () => {}". This also avoids parsing "new async()" as
        // "new (async())()" instead.
        if !p.lexer.has_newline_before && level.lt(Level::Member) {
            match p.lexer.token {
                // "async => {}"
                T::TEqualsGreaterThan => {
                    if level.lte(Level::Assign) {
                        let async_ref = p.store_name_in_ref(b"async")?;
                        let args = p.allocator.alloc_slice_fill_with(1, |_| G::Arg {
                            binding: p.b(B::Identifier { ref_: async_ref }, async_range.loc),
                            ..Default::default()
                        });
                        let _ = p
                            .push_scope_for_parse_pass(
                                js_ast::Scope::Kind::FunctionArgs,
                                async_range.loc,
                            )
                            .expect("unreachable");
                        let mut data = FnOrArrowDataParse {
                            needs_async_loc: async_range.loc,
                            ..Default::default()
                        };
                        let arrow_body = p.parse_arrow_body(args, &mut data)?;
                        p.pop_scope();
                        return Ok(p.new_expr(arrow_body, async_range.loc));
                    }
                }
                // "async x => {}"
                T::TIdentifier => {
                    if level.lte(Level::Assign) {
                        // p.markLoweredSyntaxFeature();

                        let ref_ = p.store_name_in_ref(p.lexer.identifier)?;
                        let arg_loc = p.lexer.loc();
                        let args = p.allocator.alloc_slice_fill_with(1, |_| G::Arg {
                            binding: p.b(B::Identifier { ref_ }, arg_loc),
                            ..Default::default()
                        });
                        p.lexer.next()?;

                        let _ = p.push_scope_for_parse_pass(
                            js_ast::Scope::Kind::FunctionArgs,
                            async_range.loc,
                        )?;
                        // TODO(port): errdefer — `defer p.popScope()` (borrowck blocks scopeguard over &mut p)

                        let mut data = FnOrArrowDataParse {
                            allow_await: AwaitOrYield::AllowExpr,
                            needs_async_loc: args[0].binding.loc,
                            ..Default::default()
                        };
                        let mut arrow_body = p.parse_arrow_body(args, &mut data)?;
                        arrow_body.is_async = true;
                        p.pop_scope();
                        return Ok(p.new_expr(arrow_body, async_range.loc));
                    }
                }

                // "async()"
                // "async () => {}"
                T::TOpenParen => {
                    p.lexer.next()?;
                    return p.parse_paren_expr(
                        async_range.loc,
                        level,
                        ParenExprOpts {
                            is_async: true,
                            async_range,
                            ..Default::default()
                        },
                    );
                }

                // "async<T>()"
                // "async <T>() => {}"
                T::TLessThan => {
                    if Self::IS_TYPESCRIPT_ENABLED
                        && (!Self::IS_JSX_ENABLED || TypeScript::is_ts_arrow_fn_jsx(p)?)
                    {
                        match p.try_skip_type_script_type_parameters_then_open_paren_with_backtracking()
                        {
                            TypeScript::SkipResult::DidNotSkipAnything => {}
                            result => {
                                p.lexer.next()?;
                                return p.parse_paren_expr(
                                    async_range.loc,
                                    level,
                                    ParenExprOpts {
                                        is_async: true,
                                        async_range,
                                        force_arrow_fn: result
                                            == TypeScript::SkipResult::DefinitelyTypeParameters,
                                        ..Default::default()
                                    },
                                );
                            }
                        }
                    }
                }

                _ => {}
            }
        }

        // "async"
        // "async + 1"
        Ok(p.new_expr(
            E::Identifier {
                ref_: p.store_name_in_ref(b"async")?,
                ..Default::default()
            },
            async_range.loc,
        ))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parse.zig (1407 lines)
//   confidence: medium
//   todos:      23
//   notes:      comptime mixin → ZST + const-generics; sibling re-exports left as TODOs (Phase B should make all parse fns inherent on NewParser_); 'bump lifetimes on return slices need wiring; defer/errdefer state-restore on &mut p needs scopeguard pattern
// ──────────────────────────────────────────────────────────────────────────
