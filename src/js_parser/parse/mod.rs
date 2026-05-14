#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    unused_unsafe,
    clippy::all
)]
#![warn(unused_must_use)]
pub mod parse_entry;
pub mod parse_fn;
pub mod parse_import_export;
pub mod parse_jsx;
pub mod parse_prefix;
pub mod parse_property;
pub mod parse_skip_typescript;
pub mod parse_stmt;
pub mod parse_suffix;
pub mod parse_typescript;

use bun_collections::VecExt;
use core::mem;

use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};

use bun_core::strings;
use bun_core::{Error, err};

use bun_ast::LexerLog as _;

use crate::lexer::{self as js_lexer, T};
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
use bun_ast::{
    B, Binding, E, Expr, ExprNodeIndex, ExprNodeList, Flags, G, LocRef, S, Stmt, Symbol,
};

// Zig: `pub fn Parse(comptime ts, comptime jsx, comptime scan) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // Zig: `inline fn parseExprOrBindings(p, level, errors: ?*DeferredErrors, expr: *Expr) !void`
    #[inline]
    pub fn parse_expr_or_bindings(
        &mut self,
        level: Level,
        errors: Option<&mut DeferredErrors>,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        self.parse_expr_common(level, errors, EFlags::None, expr)
    }
    // Zig: `inline fn parseExpr(p, level) !Expr`
    #[inline]
    pub fn parse_expr(&mut self, level: Level) -> Result<Expr, Error> {
        let mut expr = Expr::EMPTY;
        self.parse_expr_common(level, None, EFlags::None, &mut expr)?;
        Ok(expr)
    }
    // Zig: `inline fn parseExprWithFlags(p, level, flags, expr: *Expr) !void`
    #[inline]
    pub fn parse_expr_with_flags(
        &mut self,
        level: Level,
        flags: EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        self.parse_expr_common(level, None, flags, expr)
    }
    pub fn parse_expr_common(
        &mut self,
        level: Level,
        mut errors: Option<&mut DeferredErrors>,
        flags: EFlags,
        expr: &mut Expr,
    ) -> Result<(), Error> {
        if !self.stack_check.is_safe_to_recurse() {
            return Err(err!("StackOverflow"));
        }

        let had_pure_comment_before =
            self.lexer.has_pure_comment_before && !self.options.ignore_dce_annotations;
        *expr = self.parse_prefix(level, errors.as_deref_mut(), flags)?;
        // PORT NOTE: reshaped for borrowck — `errors` is reborrowed via as_deref_mut
        // for each call site instead of Zig's single pointer pass-through.

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

    pub fn parse_yield_expr(&mut self, loc: bun_ast::Loc) -> Result<Expr, Error> {
        let p = self;
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

        Ok(p.new_expr(E::Yield { value, is_star }, loc))
    }

    // By the time we call this, the identifier and type parameters have already
    // been parsed. We need to start parsing from the "extends" clause.
    pub fn parse_class(
        &mut self,
        class_keyword: bun_ast::Range,
        name: Option<js_ast::LocRef>,
        class_opts: ParseClassOptions<'a>,
    ) -> Result<G::Class, Error> {
        let p = self;
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
                let _ = p.skip_type_script_type_arguments::<false>()?; // isInsideJSXElement
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

        while !p.lexer.token.is_close_brace_or_eof() {
            if p.lexer.token == T::TSemicolon {
                p.lexer.next()?;
                continue;
            }

            // PORT NOTE: Zig hoisted `opts` above the loop; it is fully
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
            if opts.allow_ts_decorators {
                opts.ts_decorators = p.parse_type_script_decorators()?;
                opts.has_class_decorators = class_opts.ts_decorators.len() > 0;
                has_decorators = has_decorators || opts.ts_decorators.len() > 0;
            }

            // This property may turn out to be a type in TypeScript, which should be ignored
            if let Some(property) =
                p.parse_property(js_ast::g::PropertyKind::Normal, &mut opts, None)?
            {
                // PORT NOTE: read fields before move (G::Property is not Copy).
                let prop_kind = property.kind;
                let prop_key = property.key;
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

    pub fn parse_template_parts(
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
            if cfg!(debug_assertions) {
                debug_assert!(p.lexer.token != T::TEndOfFile);
            }
        }

        p.allow_in = old_allow_in;

        // `from_bump` leaks into the arena and wraps the unique `&'bump mut [T]`
        // so mutable provenance is preserved for the visit pass.
        Ok((bun_ast::StoreSlice::from_bump(parts), tail_loc))
    }

    // This assumes the caller has already checked for TStringLiteral or TNoSubstitutionTemplateLiteral
    pub fn parse_string_literal(&mut self) -> Result<Expr, Error> {
        let p = self;
        let loc = p.lexer.loc();
        let mut str_ = p.lexer.to_e_string()?;
        str_.prefer_template = p.lexer.token == T::TNoSubstitutionTemplateLiteral;

        let expr = p.new_expr(str_, loc);
        p.lexer.next()?;
        Ok(expr)
    }

    pub fn parse_call_args(&mut self) -> Result<ExprListLoc, Error> {
        let p = self;
        // Allow "in" inside call arguments
        let old_allow_in = p.allow_in;
        p.allow_in = true;
        // TODO(port): errdefer — restore `p.allow_in = old_allow_in` on error path

        let mut args = BumpVec::<Expr>::new_in(p.arena);
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
        p.allow_in = old_allow_in;
        Ok(ExprListLoc {
            list: ExprNodeList::from_bump_vec(args),
            loc: close_paren_loc,
        })
    }

    pub fn parse_jsx_prop_value_identifier(
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
    pub fn parse_paren_expr(
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
        let mut comma_after_spread: Option<bun_ast::Loc> = None;

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
                comma_after_spread = Some(p.lexer.loc());
            }

            // Eat the comma token
            p.lexer.next()?;
        }
        let items: &'a mut [Expr] = items_list.into_bump_slice_mut();
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
                        loc_.add_error(p.log(), p.source);
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
                let args_slice: &'a mut [G::Arg] = args.into_bump_slice_mut();
                let mut arrow = p.parse_arrow_body(args_slice, &mut arrow_data)?;
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
            return Err(err!("SyntaxError"));
        }

        // Are these arguments for a call to a function named "async"?
        if opts.is_async {
            p.log_expr_errors(&mut errors);
            let async_ref = p.store_name_in_ref(b"async")?;
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
                return Err(err!("SyntaxError"));
            }

            let mut value = Expr::join_all_with_comma(items);
            p.mark_expr_as_parenthesized(&mut value);
            return Ok(value);
        }

        // Indicate that we expected an arrow function
        p.lexer.expected(T::TEqualsGreaterThan)?;
        Err(err!("SyntaxError"))
    }

    pub fn parse_label_name(&mut self) -> Result<Option<js_ast::LocRef>, Error> {
        let p = self;
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
                return Err(err!("SyntaxError"));
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
                ref_: None,
            });
            if !opts.is_typescript_declare {
                name.as_mut().unwrap().ref_ = Some(
                    p.declare_symbol(js_ast::symbol::Kind::Class, name_loc, name_text)
                        .expect("unreachable"),
                );
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
            },
            loc,
        ))
    }

    pub fn parse_clause_alias(&mut self, kind: &[u8]) -> Result<&'a [u8], Error> {
        let p = self;
        let loc = p.lexer.loc();

        // The alias may now be a utf-16 (not wtf-16) string (see https://github.com/tc39/ecma262/pull/2154)
        if p.lexer.token == T::TStringLiteral {
            let estr = p.lexer.to_e_string()?;
            if estr.is_utf8() {
                // SAFETY: E::String slices are arena-owned for 'a.
                return Ok(unsafe { bun_collections::detach_lifetime(estr.slice8()) });
            } else {
                // PORT NOTE: Zig used toUTF8AllocWithTypeWithoutInvalidSurrogatePairs which
                // errors on lone surrogates. The Rust port replaces them with U+FFFD; the
                // surrogate-error diagnostic path is dropped until the strict variant lands.
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

    pub fn parse_expr_or_let_stmt(
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
                            p.forbid_lexical_decl(token_range.loc)?;
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
                    p.forbid_lexical_decl(token_range.loc)?;
                }
                // p.markSyntaxFeature(.using, token_range.loc);
                opts.is_using_statement = true;
                let decls = p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, opts)?;
                let decls_slice = bun_collections::RawSlice::new(decls.slice());
                if !opts.is_for_loop_init {
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
                            p.forbid_lexical_decl(using_range.loc)?;
                        }
                        // p.markSyntaxFeature(.using, using_range.loc);
                        opts.is_using_statement = true;
                        let decls =
                            p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, opts)?;
                        let decls_slice = bun_collections::RawSlice::new(decls.slice());
                        if !opts.is_for_loop_init {
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
                    let r = p.store_name_in_ref(raw)?;
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
            p.parse_suffix(e, Level::Lowest, None, EFlags::None)?;
        }
        Ok(result)
    }

    pub fn parse_binding(&mut self, opts: ParseBindingOptions) -> Result<Binding, Error> {
        let p = self;
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

                let ref_ = p.store_name_in_ref(name).expect("unreachable");
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

    pub fn parse_property_binding(&mut self) -> Result<B::Property, Error> {
        let p = self;
        // Every match arm below assigns `key` (or `return`s) before any read.
        let key: Expr;
        let mut is_computed = false;

        match p.lexer.token {
            T::TDotDotDot => {
                p.lexer.next()?;
                let ident_ref = p
                    .store_name_in_ref(p.lexer.identifier)
                    .expect("unreachable");
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
                    let ref_ = p.store_name_in_ref(name).expect("unreachable");
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

    pub fn parse_and_declare_decls(
        &mut self,
        kind: js_ast::symbol::Kind,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<G::DeclList, Error> {
        let p = self;
        let mut decls = BumpVec::<G::Decl>::new_in(p.arena);

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
                break;
            }
            p.lexer.next()?;
        }

        Ok(G::DeclList::from_bump_vec(decls))
    }

    pub fn parse_path(&mut self) -> Result<ParsedPath<'a>, Error> {
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
                            // This logic is duplicated in js_ast.zig fn importRecordTag()
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

    pub fn parse_stmts_up_to(
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
                            } else if str_.eql_comptime(b"use asm") {
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

    /// This parses an expression. This assumes we've already parsed the "async"
    /// keyword and are currently looking at the following token.
    pub fn parse_async_prefix_expr(
        &mut self,
        async_range: bun_ast::Range,
        level: Level,
    ) -> Result<Expr, Error> {
        let p = self;
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
                        let arg_binding = p.b(B::Identifier { r#ref: ref_ }, arg_loc);
                        let args: &'a mut [G::Arg] = p.arena.alloc_slice_fill_with(1, |_| G::Arg {
                            binding: arg_binding,
                            ..Default::default()
                        });
                        p.lexer.next()?;

                        let _ = p.push_scope_for_parse_pass(
                            js_ast::scope::Kind::FunctionArgs,
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
                        && (!p.is_jsx_enabled() || p.is_ts_arrow_fn_jsx()?)
                    {
                        match p
                            .try_skip_type_script_type_parameters_then_open_paren_with_backtracking(
                            ) {
                            SkipTypeParameterResult::DidNotSkipAnything => {}
                            result => {
                                p.lexer.next()?;
                                return p.parse_paren_expr(
                                    async_range.loc,
                                    level,
                                    ParenExprOpts {
                                        is_async: true,
                                        async_range,
                                        force_arrow_fn: result
                                            == SkipTypeParameterResult::DefinitelyTypeParameters,
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
        let async_ref = p.store_name_in_ref(b"async")?;
        Ok(p.new_expr(
            E::Identifier {
                ref_: async_ref,
                ..Default::default()
            },
            async_range.loc,
        ))
    }
}

// ported from: src/js_parser/ast/parse.zig
