use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;

use crate::js_lexer;
use crate::js_lexer::T;
use crate::p::P;
use crate::parse::lists::{ListKind, ListStep};
use crate::parser::{
    ARGUMENTS_STR as arguments_str, AwaitOrYield, FnOrArrowDataParse, LexicalDecl,
    ParseBindingOptions, ParseStatementOptions, TypeParameterFlag,
};
use crate::sema::Mark;
use bun_ast as js_ast;
use bun_ast::expr::EFlags;
use bun_ast::op::Level;
use bun_ast::{E, Expr, Flags, G, S, Stmt};

type Error = crate::Error;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool, const SEMA: bool>
    P<'a, TYPESCRIPT, SCAN_ONLY, SEMA>
{
    /// This assumes the "function" token has already been parsed
    pub(crate) fn parse_fn_stmt(
        &mut self,
        loc: bun_ast::Loc,
        opts: &mut ParseStatementOptions,
        async_range: Option<bun_ast::Range>,
    ) -> Result<Stmt, Error> {
        let p = self;
        let is_generator = p.lexer.token == T::TAsterisk;
        let is_async = async_range.is_some();

        if is_generator {
            // p.markSyntaxFeature(compat.Generator, p.lexer.Range())
            p.lexer.next()?;
        } else if is_async {
            // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
        }

        match opts.lexical_decl {
            LexicalDecl::Forbid => {
                p.forbid_lexical_decl(loc);
            }

            // Allow certain function statements in certain single-statement contexts
            LexicalDecl::AllowFnInsideIf | LexicalDecl::AllowFnInsideLabel => {
                if opts.is_typescript_declare || is_generator || is_async {
                    p.forbid_lexical_decl(loc);
                }
            }
            _ => {}
        }

        let mut name: Option<js_ast::LocRef> = None;
        let mut name_text: &'a [u8] = b"";

        // The name is optional for "export default function() {}" pseudo-statements
        if !opts.is_name_optional || p.lexer.token == T::TIdentifier {
            let mut name_loc = p.lexer.loc();
            name_text = p.lexer.identifier;
            if p.lexer.token == T::TPrivateIdentifier && p.is_tolerant() {
                // `createIdentifierWithDiagnostic`: a private name is reported as an error and
                // still used as the name.
                let range = p.lexer.range();
                p.lexer.ts_error(range, 18016);
                p.lexer.next()?;
            } else if p.lexer.token != T::TIdentifier && p.is_tolerant() && !p.lexer.is_log_disabled
            {
                name_loc = p.report_missing_fn_name()?;
                name_text = b"";
            } else {
                p.lexer.expect(T::TIdentifier)?;
            }
            // Difference
            let ref_ = p.new_symbol(js_ast::symbol::Kind::Other, name_text);
            name = Some(js_ast::LocRef {
                loc: name_loc,
                ref_,
            });
        }

        // Even anonymous functions can have TypeScript type parameters
        let mut type_parameters = None;
        if Self::IS_TYPESCRIPT_ENABLED {
            type_parameters = p.parse_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        }

        // Introduce a fake block scope for function declarations inside if statements
        let mut if_stmt_scope_index: usize = 0;
        let has_if_scope = opts.lexical_decl == LexicalDecl::AllowFnInsideIf;
        if has_if_scope {
            if_stmt_scope_index = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        }

        let scope_index: usize =
            p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, p.lexer.loc())?;

        let mut func = p.parse_fn(
            name,
            FnOrArrowDataParse {
                needs_async_loc: loc,
                allow_await: if is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                allow_yield: if is_generator {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                is_typescript_declare: opts.is_typescript_declare,

                // Only allow omitting the body if we're parsing TypeScript
                allow_missing_body_for_type_script: Self::IS_TYPESCRIPT_ENABLED,
                brace_or_semicolon: true,
                ..Default::default()
            },
        )?;
        p.note_type_parameters(&mut func.open_parens_loc, type_parameters);
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        if Self::IS_TYPESCRIPT_ENABLED {
            // Don't output anything if it's just a forward declaration of a function
            if opts.is_typescript_declare
                || func.flags.contains(Flags::Function::IsForwardDeclaration)
            {
                // Every declaration is passed to the type checker.
                if p.preserves_type_syntax() {
                    p.pop_scope();
                    if has_if_scope {
                        p.pop_scope();
                    }
                    func.name = name;
                    if opts.is_export {
                        func.flags.insert(Flags::Function::IsExport);
                    }
                    return Ok(p.s(S::Function { func }, loc));
                }

                p.pop_and_discard_scope(scope_index);

                // Discard the fake block scope introduced above. A forward declaration
                // emits nothing (`S::TypeScript`), so the block must be removed from
                // `scopes_in_order` too — a plain `pop_scope()` only updates
                // `current_scope` and would leave the block orphaned in the scope order,
                // desyncing the visit pass (scope mismatch / pop past the topmost scope).
                if has_if_scope {
                    p.pop_and_discard_scope(if_stmt_scope_index);
                }

                if opts.is_typescript_declare && opts.scope.is_namespace() && opts.is_export {
                    p.has_non_local_export_declare_inside_namespace = true;
                }

                return Ok(p.s(S::TypeScript::default(), loc));
            }
        }

        p.pop_scope();

        // Only declare the function after we know if it had a body or not. Otherwise
        // TypeScript code such as this will double-declare the symbol:
        //
        //     function foo(): void;
        //     function foo(): void {}
        //
        if let Some(n) = name.as_mut() {
            let kind = if is_generator || is_async {
                js_ast::symbol::Kind::GeneratorOrAsyncFunction
            } else {
                js_ast::symbol::Kind::HoistedFunction
            };

            n.ref_ = p.declare_symbol(kind, n.loc, name_text)?;
        }
        func.name = name;

        // flags is freshly built so unset → only insert when true
        if has_if_scope {
            func.flags.insert(Flags::Function::HasIfScope);
        }
        if opts.is_export {
            func.flags.insert(Flags::Function::IsExport);
        }

        // Balance the fake block scope introduced above
        if has_if_scope {
            p.pop_scope();
        }

        Ok(p.s(S::Function { func }, loc))
    }

    /// `createIdentifierWithDiagnostic`, where the name of a function declaration is missing.
    /// Nothing is consumed.
    /// Returns the position of the empty name (`createMissingIdentifier`).
    #[cold]
    #[inline(never)]
    fn report_missing_fn_name(&mut self) -> Result<bun_ast::Loc, Error> {
        let full_start = self.lexer.full_start();
        let before = self.lexer.prev_error_loc;
        let range = if self.lexer.token == T::TEndOfFile {
            bun_ast::Range {
                loc: full_start,
                len: 0,
            }
        } else {
            self.lexer.range()
        };
        let is_reserved_word =
            self.lexer.token.is_reserved_word() || self.lexer.token == T::TEscapedKeyword;
        self.lexer
            .ts_error(range, if is_reserved_word { 1359 } else { 1003 });
        self.lexer.put_up_with(before)?;
        Ok(full_start)
    }

    pub(crate) fn parse_fn(
        &mut self,
        name: Option<js_ast::LocRef>,
        opts: FnOrArrowDataParse,
    ) -> Result<G::Fn, Error> {
        let p = self;

        let mut initial_flags = Flags::FunctionSet::empty();
        if opts.allow_await == AwaitOrYield::AllowExpr {
            initial_flags.insert(Flags::Function::IsAsync);
        }
        if opts.allow_yield == AwaitOrYield::AllowExpr {
            initial_flags.insert(Flags::Function::IsGenerator);
        }

        let mut func = G::Fn {
            name,
            flags: initial_flags,
            arguments_ref: js_ast::Ref::NONE,
            open_parens_loc: p.lexer.loc(),
            ..Default::default()
        };
        // `parseParameters`: without the "(" there are no parameters, and no ")" is expected.
        let has_parens = p.lexer.token == T::TOpenParen || !p.is_tolerant();
        if !has_parens {
            p.note_token_full_start(&mut func.open_parens_loc, Mark::MissingParameters);
        }
        p.lexer.expect(T::TOpenParen)?;

        // Await and yield are not allowed in function arguments
        // `FnOrArrowDataParse` is `Clone`, so save/restore is a clone.
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();

        p.fn_or_arrow_data_parse.allow_await = if opts.allow_await == AwaitOrYield::AllowExpr {
            AwaitOrYield::ForbidAll
        } else {
            AwaitOrYield::AllowIdent
        };

        p.fn_or_arrow_data_parse.allow_yield = if opts.allow_yield == AwaitOrYield::AllowExpr {
            AwaitOrYield::ForbidAll
        } else {
            AwaitOrYield::AllowIdent
        };

        // Don't suggest inserting "async" before anything if "await" is found
        p.fn_or_arrow_data_parse.needs_async_loc = bun_ast::Loc::EMPTY;

        // If "super()" is allowed in the body, it's allowed in the arguments
        p.fn_or_arrow_data_parse.allow_super_call = opts.allow_super_call;
        p.fn_or_arrow_data_parse.allow_super_property = opts.allow_super_property;

        // A private name in place of a parameter name has its own error. `parseNameOfParameter`
        let name_of_parameter = ParseBindingOptions {
            private_name_code: 18009,
            ..Default::default()
        };

        let mut rest_arg: bool = false;
        let mut arg_has_decorators: bool = false;
        // `parseParameterEx` accepts decorators and modifiers before any parameter of any function.
        // The checker reports them.
        let takes_any_modifiers = Self::IS_TYPESCRIPT_ENABLED && p.is_tolerant();
        let mut has_this_parameter = false;
        let mut args = bun_alloc::ArenaVec::<G::Arg>::new_in(p.arena);
        let saved_contexts = p.enter_list(ListKind::Parameters);
        while has_parens && p.lexer.token != T::TCloseParen {
            match p.classify_list_token(ListKind::Parameters)? {
                ListStep::Element => {}
                ListStep::Skipped => continue,
                ListStep::Over => break,
            }
            let parameter_start = p.lexer.loc();
            let parameter_full_start = p.lexer.full_start();
            let mut ts_decorators = bun_alloc::AstAlloc::vec();
            // Start of the first decorator or modifier, and whether a modifier keyword is among
            // them.
            let mut modifiers: Option<(bun_ast::Range, bool)> = None;
            let mut modifiers_base = 0;
            if takes_any_modifiers {
                modifiers_base = p.pushed_modifiers();
                modifiers = p.parse_parameter_modifiers(
                    old_fn_or_arrow_data.allow_await,
                    &mut ts_decorators,
                )?;
            }
            // Skip over "this" type annotations
            if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TThis {
                if takes_any_modifiers {
                    let is_first = args.is_empty() && !has_this_parameter;
                    has_this_parameter = true;
                    let first_modifier = modifiers.map(|(start, _)| start);
                    if let Some(arg) = p.parse_this_parameter(
                        &mut func.open_parens_loc,
                        is_first,
                        ts_decorators,
                        (parameter_start, parameter_full_start),
                        first_modifier,
                        modifiers_base,
                    )? {
                        args.push(arg);
                    }
                } else {
                    p.lexer.next()?;
                    if p.lexer.token == T::TColon {
                        p.lexer.next()?;
                        p.skip_type_script_type(Level::Lowest)?;
                    }
                }
                if p.lexer.token != T::TComma {
                    if p.recover_missing_comma(ListKind::Parameters, parameter_start)? {
                        continue;
                    }
                    break;
                }

                p.lexer.next()?;
                continue;
            }

            if opts.allow_ts_decorators && !takes_any_modifiers {
                ts_decorators = p.parse_type_script_decorators()?;
            }
            if ts_decorators.len_u32() > 0 {
                arg_has_decorators = true;
            }

            // TypeScript's parser accepts the dots before any parameter.
            // `checkGrammarParameterList` reports them.
            let mut dots = bun_ast::Loc::EMPTY;
            if p.lexer.token == T::TDotDotDot
                && (!func.flags.contains(Flags::Function::HasRestArg) || p.is_tolerant())
            {
                // p.markSyntaxFeature
                dots = p.lexer.loc();
                p.lexer.next()?;
                rest_arg = true;
                func.flags.insert(Flags::Function::HasRestArg);
            }

            let mut is_typescript_ctor_field = matches!(modifiers, Some((_, true)));
            let is_identifier = p.lexer.token == T::TIdentifier;
            let mut text = p.lexer.identifier;
            let name_start = p.lexer.loc();
            let mut arg = p.parse_binding(name_of_parameter)?;
            if p.preserves_type_syntax() {
                if dots != bun_ast::Loc::EMPTY {
                    p.note_loc(&mut arg.loc, Mark::DotDotDot, dots);
                }
                if parameter_start != p.real_loc(arg.loc) {
                    p.note_loc(&mut arg.loc, Mark::DeclarationStart, parameter_start);
                }
            }
            if modifiers.is_some() {
                p.end_parameter_modifiers(modifiers_base, &mut arg.loc);
            }
            let mut ts_metadata = bun_ast::ts::Metadata::default();

            // `parseNameOfParameter`: a modifier keyword that is neither a modifier nor a name is skipped.
            if matches!(p.lexer.token, T::TConst | T::TDefault | T::TExport | T::TIn)
                && p.is_tolerant()
                && modifiers.is_none()
                && p.lexer.loc() == name_start
            {
                p.lexer.next()?;
            }

            if Self::IS_TYPESCRIPT_ENABLED {
                if is_identifier && opts.is_constructor && !takes_any_modifiers {
                    // Skip over TypeScript accessibility modifiers, which turn this argument
                    // into a class field when used inside a class constructor. This is known
                    // as a "parameter property" in TypeScript.
                    loop {
                        match p.lexer.token {
                            T::TIdentifier | T::TOpenBrace | T::TOpenBracket => {
                                if !js_lexer::is_type_script_accessibility_modifier(text) {
                                    break;
                                }

                                is_typescript_ctor_field = true;

                                // TypeScript requires an identifier binding
                                if p.lexer.token != T::TIdentifier {
                                    p.lexer.expect(T::TIdentifier)?;
                                }
                                text = p.lexer.identifier;

                                // Re-parse the binding (the current binding is the TypeScript keyword)
                                arg = p.parse_binding(name_of_parameter)?;
                            }
                            _ => {
                                break;
                            }
                        }
                    }
                }

                // "function foo(a?) {}"
                if p.lexer.token == T::TQuestion {
                    p.note_loc(&mut arg.loc, Mark::Optional, p.lexer.loc());
                    p.lexer.next()?;
                }

                // "function foo(a: any) {}"
                if p.lexer.token == T::TColon {
                    p.lexer.next()?;
                    if !rest_arg {
                        if p.options.features.emit_decorator_metadata
                            && opts.allow_ts_decorators
                            && (opts.has_argument_decorators
                                || opts.has_decorators
                                || arg_has_decorators)
                        {
                            ts_metadata = p.skip_type_script_type_with_metadata(Level::Lowest)?;
                        } else {
                            p.skip_type_script_type(Level::Lowest)?;
                        }
                    } else {
                        // rest parameter is always object, leave metadata as m_none
                        p.skip_type_script_type(Level::Lowest)?;
                    }
                    p.note_type(&mut arg.loc, Mark::Annotation);
                }
            }

            let parse_stmt_opts = ParseStatementOptions::default();
            p.declare_binding(js_ast::symbol::Kind::Hoisted, &mut arg, &parse_stmt_opts)
                .expect("unreachable");

            let mut default_value: Option<Expr> = None;
            if p.lexer.token == T::TEquals
                && (!func.flags.contains(Flags::Function::HasRestArg) || p.is_tolerant())
            {
                // p.markSyntaxFeature
                p.lexer.next()?;
                default_value = Some(p.parse_expr(Level::Comma)?);
            }
            p.finish_node(&mut arg.loc, parameter_full_start);

            args.push(G::Arg {
                ts_decorators,
                binding: arg,
                default: default_value,

                // We need to track this because it affects code generation
                is_typescript_ctor_field,
                ts_metadata,
            });

            if p.lexer.token != T::TComma {
                if p.recover_missing_comma(ListKind::Parameters, parameter_start)? {
                    rest_arg = false;
                    continue;
                }
                break;
            }

            if func.flags.contains(Flags::Function::HasRestArg) && !p.is_tolerant() {
                // JavaScript does not allow a comma after a rest argument
                if opts.is_typescript_declare {
                    // TypeScript does allow a comma after a rest argument in a "declare" context
                    p.lexer.next()?;
                } else {
                    p.lexer.expect(T::TCloseParen)?;
                }

                break;
            }

            p.lexer.next()?;
            rest_arg = false;
        }
        p.lexer.list_contexts = saved_contexts;
        if !args.is_empty() {
            func.args = bun_ast::StoreSlice::new_mut(args.into_bump_slice_mut());
        }

        // Reserve the special name "arguments" in this scope. This ensures that it
        // shadows any variable called "arguments" in any parent scopes. But only do
        // this if it wasn't already declared above because arguments are allowed to
        // be called "arguments", in which case the real "arguments" is inaccessible.
        if !p.preserves_type_syntax() && !p.current_scope().members.contains_key(arguments_str) {
            func.arguments_ref = p
                .declare_symbol(
                    js_ast::symbol::Kind::Arguments,
                    p.real_loc(func.open_parens_loc),
                    arguments_str,
                )
                .expect("unreachable");
            p.symbols[func.arguments_ref.inner_index() as usize].set_must_not_be_renamed(true);
        }

        if has_parens {
            p.lexer.expect(T::TCloseParen)?;
        }
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        p.fn_or_arrow_data_parse.has_argument_decorators = arg_has_decorators;

        // "function foo(): any {}"
        if Self::IS_TYPESCRIPT_ENABLED {
            if p.lexer.token == T::TColon {
                p.lexer.next()?;

                if p.options.features.emit_decorator_metadata
                    && opts.allow_ts_decorators
                    && (opts.has_argument_decorators || opts.has_decorators)
                {
                    func.return_ts_metadata = p.skip_typescript_return_type_with_metadata()?;
                } else {
                    p.skip_typescript_return_type()?;
                }
                p.note_type(&mut func.open_parens_loc, Mark::ReturnType);
            } else if p.options.features.emit_decorator_metadata
                && opts.allow_ts_decorators
                && (opts.has_argument_decorators || opts.has_decorators)
            {
                if func.flags.contains(Flags::Function::IsAsync) {
                    func.return_ts_metadata = bun_ast::ts::Metadata::MPromise;
                } else {
                    func.return_ts_metadata = bun_ast::ts::Metadata::MUndefined;
                }
            }
        }

        if p.lexer.token != T::TOpenBrace && p.is_tolerant() && !p.lexer.is_log_disabled {
            p.recover_missing_fn_body(&mut func, &opts)?;
            return Ok(func);
        }

        // "function foo(): any;"
        if opts.allow_missing_body_for_type_script && p.lexer.token != T::TOpenBrace {
            p.lexer.expect_or_insert_semicolon()?;
            func.flags.insert(Flags::Function::IsForwardDeclaration);
            return Ok(func);
        }
        let mut temp_opts = opts;
        func.body = p.parse_fn_body(&mut temp_opts)?;
        if p.lexer.has_react_hooks_suppression_before || p.lexer.has_react_hooks_block_suppression {
            func.flags.insert(Flags::Function::HasReactHooksSuppression);
            // next-line semantics: a suppression marks the enclosing top-level
            // function and is consumed; it never reaches that function's siblings.
            if p.fn_or_arrow_data_parse.is_top_level {
                p.lexer.has_react_hooks_suppression_before = false;
            }
        }

        Ok(func)
    }

    /// `parseModifiersEx` at the start of a parameter: decorators, which are added to `decorators`, and modifier keywords.
    /// `None` if there are none. Otherwise `Loc` of the first one, and whether any of them is a keyword.
    #[cold]
    #[inline(never)]
    fn parse_parameter_modifiers(
        &mut self,
        outer_await: AwaitOrYield,
        decorators: &mut js_ast::ExprNodeList,
    ) -> Result<Option<(bun_ast::Range, bool)>, Error> {
        let p = self;
        if p.lexer.token != T::TAt && !p.is_modifier_kind() {
            return Ok(None);
        }
        let full_start = p.lexer.full_start();
        let mut first_end = p.lexer.range().end();
        let mut has_any = false;
        let mut has_keyword = false;
        let mut has_trailing_decorator = false;
        let mut has_trailing_modifier = false;
        let mut has_static = false;
        loop {
            if p.lexer.token == T::TAt && !has_trailing_modifier {
                // Decorators are parsed in the [Await] context enclosing the function.
                let inner_await = p.fn_or_arrow_data_parse.allow_await;
                p.fn_or_arrow_data_parse.allow_await = outer_await;
                let parsed = p.parse_type_script_decorators();
                p.fn_or_arrow_data_parse.allow_await = inner_await;
                let parsed = parsed?;
                if !has_any
                    && let Some(first) = parsed.slice().first()
                    && let Some(end) = p.noted(first.loc, Mark::DecoratorEnd)
                {
                    first_end.start = end as i32;
                }
                decorators.append(&mut { parsed });
                has_trailing_decorator |= has_keyword;
            } else {
                if !p.is_at_modifier(has_static) {
                    break;
                }
                has_static |= p.lexer.is_contextual_keyword(b"static");
                let (flag, loc) = (p.modifier_flag_here(), p.lexer.loc());
                p.push_statement_modifier(flag, loc);
                p.lexer.next()?;
                has_trailing_modifier |= has_trailing_decorator;
                has_keyword = true;
            }
            has_any = true;
        }
        let first = bun_ast::Range {
            loc: full_start,
            len: first_end.start - full_start.start,
        };
        Ok(has_any.then_some((first, has_keyword)))
    }

    /// `parseAnyContextualModifier`, without consuming anything: whether the current token is a modifier keyword followed by
    /// something a modifier can apply to. `has_static`: a second "static" is a name (`tryParseModifier`).
    #[cold]
    #[inline(never)]
    fn is_at_modifier(&mut self, has_static: bool) -> bool {
        if !self.is_modifier_kind() || (has_static && self.lexer.is_contextual_keyword(b"static")) {
            return false;
        }
        let here = self.lexer.snapshot();
        self.lexer.is_log_disabled = true;
        let found = self.next_token_can_follow_modifier();
        self.lexer.restore(&here);
        found
    }

    /// `nextTokenCanFollowModifier`, at a modifier keyword. Advances the lexer: the caller restores
    /// it.
    fn next_token_can_follow_modifier(&mut self) -> bool {
        let p = self;
        let keyword = p.lexer.token;
        let mut is_after_default = keyword == T::TDefault;
        let is_static = p.lexer.is_contextual_keyword(b"static");
        if p.lexer.next().is_err() {
            return false;
        }
        match keyword {
            T::TConst => return p.lexer.token == T::TEnum,
            T::TExport if p.lexer.token == T::TDefault => {
                is_after_default = true;
                if p.lexer.next().is_err() {
                    return false;
                }
            }
            T::TExport => {
                if p.lexer.is_contextual_keyword(b"type") && p.lexer.next().is_err() {
                    return false;
                }
                // `canFollowExportModifier`
                if p.lexer.token == T::TAt {
                    return true;
                }
                if matches!(p.lexer.token, T::TAsterisk | T::TOpenBrace)
                    || p.lexer.is_contextual_keyword(b"as")
                {
                    return false;
                }
            }
            _ => {}
        }
        if is_after_default {
            // `nextTokenCanFollowDefaultKeyword`
            let expected = match p.lexer.token {
                T::TClass | T::TFunction | T::TAt => return true,
                T::TIdentifier => match p.lexer.raw() {
                    b"interface" => return true,
                    b"abstract" => T::TClass,
                    b"async" => T::TFunction,
                    _ => return false,
                },
                _ => return false,
            };
            return p.lexer.next().is_ok()
                && p.lexer.token == expected
                && !p.lexer.has_newline_before;
        }
        // `canFollowModifier`. Only "static" and "export" may be followed by a line break.
        (is_static || keyword == T::TExport || !p.lexer.has_newline_before)
            && (p.lexer.is_identifier_or_keyword()
                || matches!(
                    p.lexer.token,
                    T::TPrivateIdentifier
                        | T::TOpenBracket
                        | T::TOpenBrace
                        | T::TAsterisk
                        | T::TDotDotDot
                        | T::TStringLiteral
                        | T::TNumericLiteral
                        | T::TBigIntegerLiteral
                ))
    }

    /// `parseParameterEx` at "this": the name and an optional type, nothing else. `open_parens_loc`
    /// is that of the function. Only the first parameter is the "this" parameter
    /// (`getSignatureFromDeclaration`). Any other is returned as a parameter named "this", which
    /// the checker reports (2680). `start`, `full_start`: the position of the parameter's first
    /// token, and its `TokenFullStart`. `first_modifier`: `Loc` of its first modifier, if it has
    /// any. Its modifiers are those pushed since the stack had `modifiers_base` entries.
    #[cold]
    #[inline(never)]
    fn parse_this_parameter(
        &mut self,
        open_parens_loc: &mut bun_ast::Loc,
        is_first: bool,
        decorators: js_ast::ExprNodeList,
        (start, full_start): (bun_ast::Loc, bun_ast::Loc),
        first_modifier: Option<bun_ast::Range>,
        modifiers_base: usize,
    ) -> Result<Option<G::Arg>, Error> {
        let p = self;
        let loc = p.lexer.loc();
        p.lexer.next()?;
        let has_type = p.lexer.token == T::TColon;
        if has_type {
            p.lexer.next()?;
            p.skip_type_script_type(Level::Lowest)?;
        }
        if let Some(first) = first_modifier {
            // Neither decorators nor modifiers may be applied to "this" parameters.
            p.lexer.ts_error(first, 1433);
        }
        if is_first {
            p.drop_modifiers(modifiers_base);
            let first_token = if first_modifier.is_some() { start } else { loc };
            let mut parameter = crate::sema::ts_syntax::Param::at(first_token);
            parameter.full_start = full_start;
            p.keep_this_parameter(open_parens_loc, parameter, loc, has_type);
            p.note_stray_decorators(decorators.slice(), loc);
            return Ok(None);
        }
        let r#ref = p.store_name_in_ref(b"this");
        let mut binding = p.b(js_ast::B::Identifier { r#ref }, loc);
        if has_type {
            p.note_type(&mut binding.loc, Mark::Annotation);
        }
        p.finish_node(&mut binding.loc, full_start);
        if first_modifier.is_some() {
            p.note_loc(&mut binding.loc, Mark::DeclarationStart, start);
        }
        p.end_parameter_modifiers(modifiers_base, &mut binding.loc);
        Ok(Some(G::Arg {
            ts_decorators: decorators,
            binding,
            ..Default::default()
        }))
    }

    /// `parseFunctionBlockOrSemicolon` and `parseFunctionBlock`, where the "{" of the body is missing.
    #[cold]
    #[inline(never)]
    fn recover_missing_fn_body(
        &mut self,
        func: &mut G::Fn,
        opts: &FnOrArrowDataParse,
    ) -> Result<(), Error> {
        let p = self;
        func.flags.insert(Flags::Function::IsForwardDeclaration);
        // There is no body at all. Only a function expression must have a block.
        if opts.allow_missing_body_for_type_script && p.can_parse_semicolon() {
            if p.lexer.token == T::TSemicolon {
                p.lexer.next()?;
            }
            return Ok(());
        }
        // `parseBlock`: the body is a missing block. Nothing is consumed.
        let before = p.lexer.prev_error_loc;
        let range = p.lexer.range();
        if opts.brace_or_semicolon {
            p.lexer.ts_error(range, 1144);
        } else {
            p.lexer.ts_expected(range, "{");
        }
        p.lexer.put_up_with(before)?;
        p.note_loc(&mut func.open_parens_loc, Mark::MissingBody, range.loc);
        // Distinguishes a missing block from an absent body, whose `loc` stays empty.
        func.body.loc = range.loc;
        Ok(())
    }

    pub(crate) fn parse_fn_expr(
        &mut self,
        loc: bun_ast::Loc,
        is_async: bool,
    ) -> Result<Expr, Error> {
        let p = self;
        p.lexer.next()?;
        let is_generator = p.lexer.token == T::TAsterisk;
        if is_generator {
            // p.markSyntaxFeature()
            p.lexer.next()?;
        } else if is_async {
            // p.markLoweredSyntaxFeature(compat.AsyncAwait, asyncRange, compat.Generator)
        }

        let mut name: Option<js_ast::LocRef> = None;

        let _ = p
            .push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, loc)
            .expect("unreachable");

        // The name is optional
        if p.lexer.token == T::TIdentifier {
            let text = p.lexer.identifier;

            // Don't declare the name "arguments" since it's shadowed and inaccessible
            let name_loc = p.lexer.loc();
            let ref_ = if !text.is_empty() && text != arguments_str {
                p.declare_symbol(js_ast::symbol::Kind::HoistedFunction, name_loc, text)?
            } else {
                p.new_symbol(js_ast::symbol::Kind::HoistedFunction, text)
            };
            name = Some(js_ast::LocRef {
                loc: name_loc,
                ref_,
            });

            p.lexer.next()?;
        }

        // Even anonymous functions can have TypeScript type parameters
        let mut type_parameters = None;
        if Self::IS_TYPESCRIPT_ENABLED {
            type_parameters = p.parse_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        }

        let mut func = p.parse_fn(
            name,
            FnOrArrowDataParse {
                needs_async_loc: loc,
                allow_await: if is_async {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                allow_yield: if is_generator {
                    AwaitOrYield::AllowExpr
                } else {
                    AwaitOrYield::AllowIdent
                },
                ..Default::default()
            },
        )?;
        p.note_type_parameters(&mut func.open_parens_loc, type_parameters);
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        p.validate_function_name(&func);
        p.pop_scope();

        Ok(p.new_expr(E::Function { func }, loc))
    }

    pub(crate) fn parse_fn_body(
        &mut self,
        data: &mut FnOrArrowDataParse,
    ) -> Result<G::FnBody, Error> {
        let p = self;
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        let old_allow_in = p.allow_in;
        p.fn_or_arrow_data_parse = data.clone();
        p.allow_in = true;

        let loc = p.lexer.loc();
        let mut pushed_scope_for_function_body = false;
        if p.lexer.token == T::TOpenBrace {
            let _ =
                p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionBody, p.lexer.loc())?;
            pushed_scope_for_function_body = true;
        }

        p.lexer.expect(T::TOpenBrace)?;
        // `parseBlock`: without the "{" the block has no statements, and nothing more is consumed.
        if !pushed_scope_for_function_body && p.is_tolerant() {
            p.allow_in = old_allow_in;
            p.fn_or_arrow_data_parse = old_fn_or_arrow_data;
            return Ok(G::FnBody {
                loc,
                stmts: bun_ast::StoreSlice::EMPTY,
            });
        }
        let mut opts = ParseStatementOptions::default();
        let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut opts)?;
        p.end_of_block(loc)?;

        if pushed_scope_for_function_body {
            p.pop_scope();
        }

        p.allow_in = old_allow_in;
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;
        Ok(G::FnBody {
            loc,
            stmts: bun_ast::StoreSlice::new_mut(stmts.into_bump_slice_mut()),
        })
    }

    #[inline]
    pub(crate) fn parse_arrow_body(
        &mut self,
        args: &'a mut [G::Arg],
        data: &mut FnOrArrowDataParse,
    ) -> Result<E::Arrow, Error> {
        self.parse_arrow_body_with_flags(args, data, EFlags::None)
    }

    /// `flags` are those the arrow function itself is parsed with. Only tolerant mode passes them
    /// on to an expression body (`parseArrowFunctionExpressionBody`,
    /// `allowReturnTypeInArrowFunction`).
    pub(crate) fn parse_arrow_body_with_flags(
        &mut self,
        args: &'a mut [G::Arg],
        data: &mut FnOrArrowDataParse,
        flags: EFlags,
    ) -> Result<E::Arrow, Error> {
        let p = self;
        let arrow_loc = p.lexer.loc();

        // Newlines are not allowed before "=>". TypeScript's parser accepts the arrow anywhere:
        // `checkGrammarArrowFunction` reports the line break.
        if p.lexer.has_newline_before && !p.is_tolerant() {
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"Unexpected newline before \"=>\"",
            );
            return Err(crate::Error::SyntaxError);
        }

        let has_arrow = p.lexer.token == T::TEqualsGreaterThan;
        // `parseExpectedToken`: a missing token is at the end of the previous token.
        let arrow_token = if has_arrow || !p.is_tolerant() {
            arrow_loc
        } else {
            p.lexer.full_start()
        };
        p.lexer.expect(T::TEqualsGreaterThan)?;

        for arg in args.iter_mut() {
            let opts = ParseStatementOptions::default();
            p.declare_binding(js_ast::symbol::Kind::Hoisted, &mut arg.binding, &opts)?;
        }

        // The ability to use "this" and "super()" is inherited by arrow functions
        data.allow_super_call = p.fn_or_arrow_data_parse.allow_super_call;
        data.allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
        data.is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;

        let args_slice = bun_ast::StoreSlice::<G::Arg>::new_mut(args);

        let is_missing_open_brace = p.lexer.token != T::TOpenBrace
            && p.is_tolerant()
            && !p.lexer.is_log_disabled
            && has_arrow
            && p.is_arrow_body_missing_open_brace();
        if p.lexer.token == T::TOpenBrace || is_missing_open_brace {
            let mut body = if is_missing_open_brace {
                p.parse_fn_body_without_open_brace(data)?
            } else {
                p.parse_fn_body(data)?
            };
            p.note_loc(&mut body.loc, Mark::ArrowToken, arrow_token);
            p.after_arrow_body_loc = p.lexer.loc();
            let has_react_hooks_suppression = p.lexer.has_react_hooks_suppression_before
                || p.lexer.has_react_hooks_block_suppression;
            if has_react_hooks_suppression && p.fn_or_arrow_data_parse.is_top_level {
                p.lexer.has_react_hooks_suppression_before = false;
            }
            return Ok(E::Arrow {
                args: args_slice,
                body,
                has_react_hooks_suppression,
                ..Default::default()
            });
        }

        if let Some(starts) = &mut p.starts_for_parse_only {
            starts
                .arrow_expression_bodies
                .insert(arrow_loc.start, p.lexer.loc().start);
        }
        let mut body_loc = arrow_loc;
        if !has_arrow {
            p.note_loc(&mut body_loc, Mark::ArrowToken, arrow_token);
        }
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionBody, arrow_loc)?;
        // `pop_scope` is called explicitly before each return below.

        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();

        p.fn_or_arrow_data_parse = data.clone();
        let parsed = if flags == EFlags::AfterQuestionAndBeforeColon && has_arrow && p.is_tolerant()
        {
            p.parse_arrow_body_before_colon()
        } else if has_arrow || !p.is_tolerant() {
            p.parse_expr(Level::Comma)
        } else {
            p.parse_arrow_body_without_arrow()
        };
        let expr = match parsed {
            Ok(e) => e,
            Err(err) => {
                // The error path returns without restoring fn_or_arrow_data_parse;
                // only the scope pop runs.
                p.pop_scope();
                return Err(err);
            }
        };
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        let ret_stmt = p.s(S::Return { value: Some(expr) }, expr.loc);
        let stmts: &'a mut [Stmt] = p.arena.alloc_slice_copy(&[ret_stmt]);

        p.pop_scope();
        let has_react_hooks_suppression =
            p.lexer.has_react_hooks_suppression_before || p.lexer.has_react_hooks_block_suppression;
        if has_react_hooks_suppression && p.fn_or_arrow_data_parse.is_top_level {
            p.lexer.has_react_hooks_suppression_before = false;
        }
        Ok(E::Arrow {
            args: args_slice,
            prefer_expr: true,
            body: G::FnBody {
                loc: body_loc,
                stmts: bun_ast::StoreSlice::new_mut(stmts),
            },
            has_react_hooks_suppression,
            ..Default::default()
        })
    }

    /// The body of an arrow function between the "?" and ":" of a conditional is between them too.
    #[cold]
    #[inline(never)]
    fn parse_arrow_body_before_colon(&mut self) -> Result<Expr, Error> {
        let mut body = Expr::EMPTY;
        self.parse_expr_with_flags(Level::Comma, EFlags::AfterQuestionAndBeforeColon, &mut body)?;
        Ok(body)
    }

    /// `parseArrowFunctionExpressionBody`: whether a statement that is not an expression statement
    /// follows the "=>". In that case the "{" of a block is missing.
    #[cold]
    #[inline(never)]
    fn is_arrow_body_missing_open_brace(&mut self) -> bool {
        !matches!(
            self.lexer.token,
            T::TSemicolon | T::TFunction | T::TClass | T::TOpenBrace
        ) && self.is_start_of_statement()
            // `isStartOfExpressionStatement`
            && (self.lexer.token == T::TAt || !self.is_start_of_expression_or_shift_assign())
    }

    /// `parseFunctionBlock(ParseFlagsIgnoreMissingOpenBrace)`: the "{" is reported as missing, and the statements up to the "}" are
    /// the body.
    #[cold]
    #[inline(never)]
    fn parse_fn_body_without_open_brace(
        &mut self,
        data: &mut FnOrArrowDataParse,
    ) -> Result<G::FnBody, Error> {
        let p = self;
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();
        let old_allow_in = p.allow_in;
        p.fn_or_arrow_data_parse = data.clone();
        p.allow_in = true;

        let loc = p.lexer.loc();
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionBody, loc)?;
        p.lexer.expect(T::TOpenBrace)?;
        let mut opts = ParseStatementOptions::default();
        let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut opts)?;
        p.end_of_block(loc)?;
        p.pop_scope();

        p.allow_in = old_allow_in;
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;
        Ok(G::FnBody {
            loc,
            stmts: bun_ast::StoreSlice::new_mut(stmts.into_bump_slice_mut()),
        })
    }

    /// `parseParenthesizedArrowFunctionExpression`: with neither "=>" nor "{", the body is
    /// `parseIdentifier()`. Its diagnostic for the missing identifier is dropped: the "=>" was
    /// reported as missing at the same position.
    #[cold]
    #[inline(never)]
    fn parse_arrow_body_without_arrow(&mut self) -> Result<Expr, Error> {
        let p = self;
        let loc = p.lexer.loc();
        if !p.is_identifier_in_context() {
            return Ok(p.new_expr(E::Missing {}, loc));
        }
        let ref_ = p.store_name_in_ref(p.lexer.identifier);
        p.lexer.next()?;
        Ok(Expr::init_identifier(ref_, loc))
    }
}
