use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;

use crate::js_lexer;
use crate::js_lexer::T;
use crate::p::P;
use crate::parser::{
    ARGUMENTS_STR as arguments_str, AwaitOrYield, FnOrArrowDataParse, FunctionKind,
    LexicalDecl, ParseStatementOptions, TypeParameterFlag,
};
use bun_ast as js_ast;
use bun_ast::op::Level;
use bun_ast::{E, Expr, ExprNodeList, Flags, G, S, Stmt};

// TODO(port): narrow error set
type Error = bun_core::Error;

// Zig: `pub fn ParseFn(comptime typescript, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block.
impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // Zig: `const is_typescript_enabled = P.is_typescript_enabled;`
    // (PORT NOTE: P.rs already defines `IS_TYPESCRIPT_ENABLED`; reuse it.)

    /// This assumes the "function" token has already been parsed
    pub fn parse_fn_stmt(
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
        let mut name_text: &'a [u8] = b"";

        // The name is optional for "export default function() {}" pseudo-statements
        if !opts.is_name_optional || p.lexer.token == T::TIdentifier {
            let name_loc = p.lexer.loc();
            name_text = p.lexer.identifier;
            p.lexer.expect(T::TIdentifier)?;
            // Difference
            let ref_ = p.new_symbol(js_ast::symbol::Kind::Other, name_text)?;
            name = Some(js_ast::LocRef {
                loc: name_loc,
                ref_: Some(ref_),
            });
        }

        // Even anonymous functions can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        }

        // Introduce a fake block scope for function declarations inside if statements
        let mut if_stmt_scope_index: usize = 0;
        let has_if_scope = opts.lexical_decl == LexicalDecl::AllowFnInsideIf;
        if has_if_scope {
            if_stmt_scope_index = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        }
        let _ = if_stmt_scope_index;

        let scope_index: usize =
            p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionArgs, p.lexer.loc())?;

        let mut func = p.parse_fn(
            name,
            FnOrArrowDataParse {
                needs_async_loc: loc,
                async_range: async_range.unwrap_or(bun_ast::Range::NONE),
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
            if opts.is_typescript_declare
                || func.flags.contains(Flags::Function::IsForwardDeclaration)
            {
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
                js_ast::symbol::Kind::GeneratorOrAsyncFunction
            } else {
                js_ast::symbol::Kind::HoistedFunction
            };

            n.ref_ = Some(p.declare_symbol(kind, n.loc, name_text)?);
        }
        func.name = name;

        // Zig: func.flags.setPresent(.has_if_scope, hasIfScope) — flags is freshly built so unset → only insert when true
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

    pub fn parse_fn(
        &mut self,
        name: Option<js_ast::LocRef>,
        opts: FnOrArrowDataParse,
    ) -> Result<G::Fn, Error> {
        let p = self;
        // if data.allowAwait and data.allowYield {
        //     p.markSyntaxFeature(compat.AsyncGenerator, data.asyncRange)
        // }

        // Zig: Flags.Function.init(.{ .has_rest_arg = false, .is_async = ..., .is_generator = ... })
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
            arguments_ref: None,
            open_parens_loc: p.lexer.loc(),
            ..Default::default()
        };
        p.lexer.expect(T::TOpenParen)?;

        // Await and yield are not allowed in function arguments
        // PORT NOTE: Zig used `std.mem.toBytes` / `bytesToValue` to save/restore by value;
        // in Rust `FnOrArrowDataParse` is `Clone`, so a clone is equivalent.
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

        let mut rest_arg: bool = false;
        let mut arg_has_decorators: bool = false;
        // PERF(port): Zig used ArrayListUnmanaged backed by p.arena (arena).
        let mut args = bun_alloc::ArenaVec::<G::Arg>::new_in(p.arena);
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

            let mut ts_decorators = bun_alloc::AstAlloc::vec();
            if opts.allow_ts_decorators {
                ts_decorators = p.parse_type_script_decorators()?;
                if ts_decorators.len_u32() > 0 {
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
            let mut ts_metadata = bun_ast::ts::Metadata::default();

            if Self::IS_TYPESCRIPT_ENABLED {
                if is_identifier && opts.is_constructor {
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

            let parse_stmt_opts = ParseStatementOptions::default();
            p.declare_binding(js_ast::symbol::Kind::Hoisted, &mut arg, &parse_stmt_opts)
                .expect("unreachable");

            let mut default_value: Option<Expr> = None;
            if !func.flags.contains(Flags::Function::HasRestArg) && p.lexer.token == T::TEquals {
                // p.markSyntaxFeature
                p.lexer.next()?;
                default_value = Some(p.parse_expr(Level::Comma)?);
            }

            // PERF(port): was appendAssumeCapacity-style (catch unreachable on alloc)
            args.push(G::Arg {
                ts_decorators,
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
            func.args = bun_ast::StoreSlice::new_mut(args.into_bump_slice_mut());
        }

        // Reserve the special name "arguments" in this scope. This ensures that it
        // shadows any variable called "arguments" in any parent scopes. But only do
        // this if it wasn't already declared above because arguments are allowed to
        // be called "arguments", in which case the real "arguments" is inaccessible.
        if !p.current_scope().members.contains_key(arguments_str) {
            func.arguments_ref = Some(
                p.declare_symbol_maybe_generated::<false>(
                    js_ast::symbol::Kind::Arguments,
                    func.open_parens_loc,
                    arguments_str,
                )
                .expect("unreachable"),
            );
            p.symbols[func.arguments_ref.unwrap().inner_index() as usize].must_not_be_renamed =
                true;
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
                    func.return_ts_metadata = bun_ast::ts::Metadata::MPromise;
                } else {
                    func.return_ts_metadata = bun_ast::ts::Metadata::MUndefined;
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
        func.body = p.parse_fn_body(&mut temp_opts)?;

        Ok(func)
    }

    pub fn parse_fn_expr(
        &mut self,
        loc: bun_ast::Loc,
        is_async: bool,
        async_range: bun_ast::Range,
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
                p.new_symbol(js_ast::symbol::Kind::HoistedFunction, text)?
            };
            name = Some(js_ast::LocRef {
                loc: name_loc,
                ref_: Some(ref_),
            });

            p.lexer.next()?;
        }

        // Even anonymous functions can have TypeScript type parameters
        if Self::IS_TYPESCRIPT_ENABLED {
            let _ = p.skip_type_script_type_parameters(TypeParameterFlag::ALLOW_CONST_MODIFIER)?;
        }

        let func = p.parse_fn(
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

        Ok(p.new_expr(E::Function { func }, loc))
    }

    pub fn parse_fn_body(&mut self, data: &mut FnOrArrowDataParse) -> Result<G::FnBody, Error> {
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
        let mut opts = ParseStatementOptions::default();
        let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut opts)?;
        p.lexer.next()?;

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

    pub fn parse_arrow_body(
        &mut self,
        args: &'a mut [G::Arg],
        data: &mut FnOrArrowDataParse,
    ) -> Result<E::Arrow, Error> {
        let p = self;
        let arrow_loc = p.lexer.loc();

        // Newlines are not allowed before "=>"
        if p.lexer.has_newline_before {
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"Unexpected newline before \"=>\"",
            );
            return Err(bun_core::err!("SyntaxError"));
        }

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

        if p.lexer.token == T::TOpenBrace {
            let body = p.parse_fn_body(data)?;
            p.after_arrow_body_loc = p.lexer.loc();
            return Ok(E::Arrow {
                args: args_slice,
                body,
                ..Default::default()
            });
        }

        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::FunctionBody, arrow_loc)?;
        // PORT NOTE: Zig `defer p.popScope();` — moved to explicit call before each return below.
        // TODO(port): consider scopeguard if more early-returns are added.

        // PORT NOTE: Zig used `std.mem.toBytes`/`bytesToValue`; clone is equivalent.
        let old_fn_or_arrow_data = p.fn_or_arrow_data_parse.clone();

        p.fn_or_arrow_data_parse = data.clone();
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

        // PERF(port): Zig used `p.arena.alloc(Stmt, 1)` (arena bulk-free).
        let ret_stmt = p.s(S::Return { value: Some(expr) }, expr.loc);
        let stmts: &'a mut [Stmt] = p.arena.alloc_slice_copy(&[ret_stmt]);

        p.pop_scope();
        Ok(E::Arrow {
            args: args_slice,
            prefer_expr: true,
            body: G::FnBody {
                loc: arrow_loc,
                stmts: bun_ast::StoreSlice::new_mut(stmts),
            },
            ..Default::default()
        })
    }
}

// ported from: src/js_parser/ast/parseFn.zig
