use bun_logger as logger;
use bun_str::strings;

use crate::ast as js_ast;
use crate::ast::{E, Expr, ExprNodeIndex, ExprNodeList, Flags, G, S, Scope, Stmt, Symbol};
use crate::ast::Op::Level;
use crate::js_lexer;
use crate::js_lexer::T;
use crate::{
    AwaitOrYield, FnOrArrowDataParse, JSXTransformType, NewParser, ParseStatementOptions,
    TypeScript, ARGUMENTS_STR as arguments_str,
};

// TODO(port): narrow error set
type Error = bun_core::Error;

/// Module-level alias for the monomorphized parser type. In Zig this was
/// `const P = js_parser.NewParser_(typescript, jsx, scan_only)` inside the
/// returned struct; Rust lacks inherent associated type aliases, so we hoist it.
type P<const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool> =
    NewParser<TYPESCRIPT, JSX, SCAN_ONLY>;

/// Zig: `pub fn ParseFn(comptime typescript, comptime jsx, comptime scan_only) type { return struct { ... } }`
/// — a comptime mixin returning a struct of associated fns that all take `*P`.
/// Rust: zero-sized marker struct with const-generic params; fns are associated items.
pub struct ParseFn<const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool>;

impl<const TYPESCRIPT: bool, const JSX: JSXTransformType, const SCAN_ONLY: bool>
    ParseFn<TYPESCRIPT, JSX, SCAN_ONLY>
{
    // Zig: `const is_typescript_enabled = P.is_typescript_enabled;`
    // TODO(port): verify `NewParser::IS_TYPESCRIPT_ENABLED == TYPESCRIPT` (it should be).
    const IS_TYPESCRIPT_ENABLED: bool = TYPESCRIPT;

    /// This assumes the "function" token has already been parsed
    pub fn parse_fn_stmt(
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
        loc: logger::Loc,
        opts: &mut ParseStatementOptions,
        async_range: Option<logger::Range>,
    ) -> Result<Stmt, Error> {
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
                p.forbid_lexical_decl(loc)?;
            }

            // Allow certain function statements in certain single-statement contexts
            LexicalDecl::AllowFnInsideIf | LexicalDecl::AllowFnInsideLabel => {
                if opts.is_typescript_declare || is_generator || is_async {
                    p.forbid_lexical_decl(loc)?;
                }
            }
            _ => {}
        }

        let mut name: Option<js_ast::LocRef> = None;
        let mut name_text: &[u8] = b"";

        // The name is optional for "export default function() {}" pseudo-statements
        if !opts.is_name_optional || p.lexer.token == T::TIdentifier {
            let name_loc = p.lexer.loc();
            name_text = p.lexer.identifier;
            p.lexer.expect(T::TIdentifier)?;
            // Difference
            let r#ref = p.new_symbol(Symbol::Kind::Other, name_text)?;
            name = Some(js_ast::LocRef {
                loc: name_loc,
                r#ref,
            });
        }

        // Even anonymous functions can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(SkipTypeParameterOptions {
                allow_const_modifier: true,
                ..Default::default()
            })?;
        }

        // Introduce a fake block scope for function declarations inside if statements
        let mut if_stmt_scope_index: usize = 0;
        let has_if_scope = opts.lexical_decl == LexicalDecl::AllowFnInsideIf;
        if has_if_scope {
            if_stmt_scope_index = p.push_scope_for_parse_pass(js_ast::Scope::Kind::Block, loc)?;
        }
        let _ = if_stmt_scope_index;

        let scope_index: usize =
            p.push_scope_for_parse_pass(js_ast::Scope::Kind::FunctionArgs, p.lexer.loc())?;

        let mut func = Self::parse_fn(
            p,
            name,
            FnOrArrowDataParse {
                needs_async_loc: loc,
                async_range: async_range.unwrap_or(logger::Range::NONE),
                has_async_range: async_range.is_some(),
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
                ..Default::default()
            },
        )?;
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        if Self::IS_TYPESCRIPT_ENABLED {
            // Don't output anything if it's just a forward declaration of a function
            if opts.is_typescript_declare || func.flags.contains(Flags::Function::IsForwardDeclaration) {
                p.pop_and_discard_scope(scope_index);

                // Balance the fake block scope introduced above
                if has_if_scope {
                    p.pop_scope();
                }

                if opts.is_typescript_declare && opts.is_namespace_scope && opts.is_export {
                    p.has_non_local_export_declare_inside_namespace = true;
                }

                return Ok(p.s(S::TypeScript {}, loc));
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
                Symbol::Kind::GeneratorOrAsyncFunction
            } else {
                Symbol::Kind::HoistedFunction
            };

            n.r#ref = p.declare_symbol(kind, n.loc, name_text)?;
            func.name = name;
        }

        func.flags.set(Flags::Function::HasIfScope, has_if_scope);
        func.flags.set(Flags::Function::IsExport, opts.is_export);

        // Balance the fake block scope introduced above
        if has_if_scope {
            p.pop_scope();
        }

        Ok(p.s(S::Function { func }, loc))
    }

    pub fn parse_fn(
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
        name: Option<js_ast::LocRef>,
        opts: FnOrArrowDataParse,
    ) -> Result<G::Fn, Error> {
        // if data.allowAwait and data.allowYield {
        //     p.markSyntaxFeature(compat.AsyncGenerator, data.asyncRange)
        // }

        let mut func = G::Fn {
            name,

            flags: Flags::Function::init(Flags::FunctionInit {
                has_rest_arg: false,
                is_async: opts.allow_await == AwaitOrYield::AllowExpr,
                is_generator: opts.allow_yield == AwaitOrYield::AllowExpr,
                ..Default::default()
            }),

            arguments_ref: None,
            open_parens_loc: p.lexer.loc(),
            ..Default::default()
        };
        p.lexer.expect(T::TOpenParen)?;

        // Await and yield are not allowed in function arguments
        // PORT NOTE: Zig used `std.mem.toBytes` / `bytesToValue` to save/restore by value;
        // in Rust `FnOrArrowDataParse` is `Copy`/`Clone`, so a plain copy is equivalent.
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse;

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
        p.fn_or_arrow_data_parse.needs_async_loc = logger::Loc::EMPTY;

        // If "super()" is allowed in the body, it's allowed in the arguments
        p.fn_or_arrow_data_parse.allow_super_call = opts.allow_super_call;
        p.fn_or_arrow_data_parse.allow_super_property = opts.allow_super_property;

        let mut rest_arg: bool = false;
        let mut arg_has_decorators: bool = false;
        // PERF(port): Zig used ArrayListUnmanaged backed by p.allocator (arena).
        let mut args = bumpalo::collections::Vec::<G::Arg>::new_in(p.allocator);
        while p.lexer.token != T::TCloseParen {
            // Skip over "this" type annotations
            if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TThis {
                p.lexer.next()?;
                if p.lexer.token == T::TColon {
                    p.lexer.next()?;
                    p.skip_type_script_type(Level::Lowest)?;
                }
                if p.lexer.token != T::TComma {
                    break;
                }

                p.lexer.next()?;
                continue;
            }

            let mut ts_decorators: &[ExprNodeIndex] = &[];
            if opts.allow_ts_decorators {
                ts_decorators = p.parse_type_script_decorators()?;
                if !ts_decorators.is_empty() {
                    arg_has_decorators = true;
                }
            }

            if !func.flags.contains(Flags::Function::HasRestArg) && p.lexer.token == T::TDotDotDot {
                // p.markSyntaxFeature
                p.lexer.next()?;
                rest_arg = true;
                func.flags.insert(Flags::Function::HasRestArg);
            }

            let mut is_typescript_ctor_field = false;
            let is_identifier = p.lexer.token == T::TIdentifier;
            let mut text = p.lexer.identifier;
            let mut arg = p.parse_binding(Default::default())?;
            let mut ts_metadata = TypeScript::Metadata::default();

            if Self::IS_TYPESCRIPT_ENABLED {
                if is_identifier && opts.is_constructor {
                    // Skip over TypeScript accessibility modifiers, which turn this argument
                    // into a class field when used inside a class constructor. This is known
                    // as a "parameter property" in TypeScript.
                    loop {
                        match p.lexer.token {
                            T::TIdentifier | T::TOpenBrace | T::TOpenBracket => {
                                if !js_lexer::TypeScriptAccessibilityModifier::has(text) {
                                    break;
                                }

                                is_typescript_ctor_field = true;

                                // TypeScript requires an identifier binding
                                if p.lexer.token != T::TIdentifier {
                                    p.lexer.expect(T::TIdentifier)?;
                                }
                                text = p.lexer.identifier;

                                // Re-parse the binding (the current binding is the TypeScript keyword)
                                arg = p.parse_binding(Default::default())?;
                            }
                            _ => {
                                break;
                            }
                        }
                    }
                }

                // "function foo(a?) {}"
                if p.lexer.token == T::TQuestion {
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
                }
            }

            let mut parse_stmt_opts = ParseStatementOptions::default();
            p.declare_binding(Symbol::Kind::Hoisted, &mut arg, &mut parse_stmt_opts)
                .expect("unreachable");

            let mut default_value: Option<ExprNodeIndex> = None;
            if !func.flags.contains(Flags::Function::HasRestArg) && p.lexer.token == T::TEquals {
                // p.markSyntaxFeature
                p.lexer.next()?;
                default_value = Some(p.parse_expr(Level::Comma)?);
            }

            // PERF(port): was appendAssumeCapacity-style (catch unreachable on alloc)
            args.push(G::Arg {
                ts_decorators: ExprNodeList::from_owned_slice(ts_decorators),
                binding: arg,
                default: default_value,

                // We need to track this because it affects code generation
                is_typescript_ctor_field,
                ts_metadata,
            });

            if p.lexer.token != T::TComma {
                break;
            }

            if func.flags.contains(Flags::Function::HasRestArg) {
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
        if !args.is_empty() {
            func.args = args.into_bump_slice();
        }

        // Reserve the special name "arguments" in this scope. This ensures that it
        // shadows any variable called "arguments" in any parent scopes. But only do
        // this if it wasn't already declared above because arguments are allowed to
        // be called "arguments", in which case the real "arguments" is inaccessible.
        if !p.current_scope.members.contains_key(b"arguments".as_slice()) {
            func.arguments_ref = Some(
                p.declare_symbol_maybe_generated(
                    Symbol::Kind::Arguments,
                    func.open_parens_loc,
                    arguments_str,
                    false,
                )
                .expect("unreachable"),
            );
            p.symbols[func.arguments_ref.unwrap().inner_index() as usize].must_not_be_renamed = true;
        }

        p.lexer.expect(T::TCloseParen)?;
        // PORT NOTE: Zig restored via `std.mem.bytesToValue`; plain copy is equivalent.
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
            } else if p.options.features.emit_decorator_metadata
                && opts.allow_ts_decorators
                && (opts.has_argument_decorators || opts.has_decorators)
            {
                if func.flags.contains(Flags::Function::IsAsync) {
                    func.return_ts_metadata = TypeScript::Metadata::MPromise;
                } else {
                    func.return_ts_metadata = TypeScript::Metadata::MUndefined;
                }
            }
        }

        // "function foo(): any;"
        if opts.allow_missing_body_for_type_script && p.lexer.token != T::TOpenBrace {
            p.lexer.expect_or_insert_semicolon()?;
            func.flags.insert(Flags::Function::IsForwardDeclaration);
            return Ok(func);
        }
        let mut temp_opts = opts;
        func.body = Self::parse_fn_body(p, &mut temp_opts)?;

        Ok(func)
    }

    pub fn parse_fn_expr(
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
        loc: logger::Loc,
        is_async: bool,
        async_range: logger::Range,
    ) -> Result<Expr, Error> {
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
            .push_scope_for_parse_pass(Scope::Kind::FunctionArgs, loc)
            .expect("unreachable");

        // The name is optional
        if p.lexer.token == T::TIdentifier {
            let text = p.lexer.identifier;

            // Don't declare the name "arguments" since it's shadowed and inaccessible
            name = Some(js_ast::LocRef {
                loc: p.lexer.loc(),
                r#ref: if !text.is_empty() && text != b"arguments" {
                    p.declare_symbol(Symbol::Kind::HoistedFunction, p.lexer.loc(), text)?
                } else {
                    p.new_symbol(Symbol::Kind::HoistedFunction, text)?
                },
            });

            p.lexer.next()?;
        }

        // Even anonymous functions can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(SkipTypeParameterOptions {
                allow_const_modifier: true,
                ..Default::default()
            })?;
        }

        let func = Self::parse_fn(
            p,
            name,
            FnOrArrowDataParse {
                needs_async_loc: loc,
                async_range,
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
        p.fn_or_arrow_data_parse.has_argument_decorators = false;

        p.validate_function_name(&func, FunctionKind::Expr);
        p.pop_scope();

        Ok(p.new_expr(js_ast::E::Function { func }, loc))
    }

    pub fn parse_fn_body(
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
        data: &mut FnOrArrowDataParse,
    ) -> Result<G::FnBody, Error> {
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse;
        let old_allow_in = p.allow_in;
        p.fn_or_arrow_data_parse = *data;
        p.allow_in = true;

        let loc = p.lexer.loc();
        let mut pushed_scope_for_function_body = false;
        if p.lexer.token == T::TOpenBrace {
            let _ = p.push_scope_for_parse_pass(Scope::Kind::FunctionBody, p.lexer.loc())?;
            pushed_scope_for_function_body = true;
        }

        p.lexer.expect(T::TOpenBrace)?;
        let mut opts = ParseStatementOptions::default();
        let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut opts)?;
        p.lexer.next()?;

        if pushed_scope_for_function_body {
            p.pop_scope();
        }

        p.allow_in = old_allow_in;
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;
        Ok(G::FnBody { loc, stmts })
    }

    pub fn parse_arrow_body(
        p: &mut P<TYPESCRIPT, JSX, SCAN_ONLY>,
        args: &mut [js_ast::G::Arg],
        data: &mut FnOrArrowDataParse,
    ) -> Result<E::Arrow, Error> {
        let arrow_loc = p.lexer.loc();

        // Newlines are not allowed before "=>"
        if p.lexer.has_newline_before {
            p.log
                .add_range_error(p.source, p.lexer.range(), "Unexpected newline before \"=>\"")?;
            return Err(bun_core::err!("SyntaxError"));
        }

        p.lexer.expect(T::TEqualsGreaterThan)?;

        for arg in args.iter_mut() {
            let mut opts = ParseStatementOptions::default();
            p.declare_binding(Symbol::Kind::Hoisted, &mut arg.binding, &mut opts)?;
        }

        // The ability to use "this" and "super()" is inherited by arrow functions
        data.allow_super_call = p.fn_or_arrow_data_parse.allow_super_call;
        data.allow_super_property = p.fn_or_arrow_data_parse.allow_super_property;
        data.is_this_disallowed = p.fn_or_arrow_data_parse.is_this_disallowed;

        if p.lexer.token == T::TOpenBrace {
            let body = Self::parse_fn_body(p, data)?;
            p.after_arrow_body_loc = p.lexer.loc();
            return Ok(E::Arrow {
                args,
                body,
                ..Default::default()
            });
        }

        let _ = p.push_scope_for_parse_pass(Scope::Kind::FunctionBody, arrow_loc)?;
        // PORT NOTE: Zig `defer p.popScope();` — moved to explicit call before each return below.
        // TODO(port): consider scopeguard if more early-returns are added.

        // PORT NOTE: Zig used `std.mem.toBytes`/`bytesToValue`; plain copy is equivalent.
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse;

        p.fn_or_arrow_data_parse = *data;
        let expr = match p.parse_expr(Level::Comma) {
            Ok(e) => e,
            Err(err) => {
                // PORT NOTE: Zig `try` returns here without restoring fn_or_arrow_data_parse;
                // only the `defer p.popScope()` fires on the error path.
                p.pop_scope();
                return Err(err);
            }
        };
        p.fn_or_arrow_data_parse = old_fn_or_arrow_data;

        // PERF(port): Zig used `p.allocator.alloc(Stmt, 1)` (arena bulk-free).
        let stmts = p
            .allocator
            .alloc_slice_fill_iter(core::iter::once(p.s(S::Return { value: Some(expr) }, expr.loc)));

        p.pop_scope();
        Ok(E::Arrow {
            args,
            prefer_expr: true,
            body: G::FnBody {
                loc: arrow_loc,
                stmts,
            },
            ..Default::default()
        })
    }
}

// TODO(port): these are referenced from sibling modules in `crate::*`; exact paths TBD in Phase B.
use crate::LexicalDecl;
use crate::SkipTypeParameterOptions;
use crate::FunctionKind;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/parseFn.zig (508 lines)
//   confidence: medium
//   todos:      4
//   notes:      comptime-type-returning fn → ZST + const generics; `defer p.popScope()` in parse_arrow_body manually unrolled; std.mem.toBytes/bytesToValue → plain Copy; arena-backed Vec via bumpalo
// ──────────────────────────────────────────────────────────────────────────
