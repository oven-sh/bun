#![allow(
    unused_imports,
    unused_variables,
    dead_code,
    unused_mut,
    clippy::single_match
)]
#![warn(unused_must_use)]
use bun_alloc::ArenaVecExt as _;
use bun_collections::VecExt;
use bun_core::strings;
use bun_core::{self, err};

use crate::lexer as js_lexer;
use crate::p::P;
use bun_ast as js_ast;

use js_ast::op::Level;
use js_ast::{Binding, Expr, G, LocRef, S, Stmt, Symbol};
use js_lexer::T;

use crate::parser::fs;
use crate::parser::{
    AwaitOrYield, DeferredTsDecorators, LexicalDecl, ParseStatementOptions, ParsedPath, Ref,
    StmtList,
};
use crate::typescript;
use bun_ast::{ImportKind, ImportRecordFlags, ImportRecordTag};
use js_ast::expr::EFlags;

// TODO(port): narrow error set
type Result<T> = core::result::Result<T, bun_core::Error>;

// Zig: `pub fn ParseStmt(comptime ts, comptime jsx, comptime scan_only) type { return struct {...} }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block. The 25+ per-token `t_*` helpers are private; only `parse_stmt` is
// surfaced. Round-G un-gated the simpler `t_*` bodies; phase-d ported the remaining
// `t_export`/`t_import`/fallthrough bodies inline (the `_draft_heavy` staging mod is gone).

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // PORT NOTE on `#[inline]` / `#[inline(never)]` / `#[cold]` annotations across the `t_*` arms:
    // `parse_stmt` is invoked once per leading statement token; profiling showed its
    // stack-adjust prologue/epilogue dominating because LLVM was hoisting the larger
    // (and rarely-taken) `t_*` bodies inline, ballooning `parse_stmt`'s frame. Keep the
    // rare / heavy arms out-of-line so `parse_stmt` stays a thin dispatcher, and fold the
    // trivial forwarders in so the `parse_stmts_up_to → parse_stmt → t_* → parse_*` chain
    // loses a hop on the hot statements (`;`, `function`, `var`, `const`, `return`, …).
    //
    // `P` is monomorphized over `(TYPESCRIPT, SCAN_ONLY)` (JSX is a runtime field, not a
    // type parameter — see `parser.rs`), so every `#[inline(never)]`
    // `t_*` becomes 2-3 sibling symbols that the linker would otherwise interleave with the
    // hot ones. Anything that can't fire on a plain `bun run` of a `.js`/`.ts` script — the
    // TS-only keyword forms (`enum`, `@decorator`, `type`/`namespace`/`module`/`declare`),
    // `with` (illegal in strict/module code), `do … while`, `debugger`, and `label:` — is
    // additionally `#[cold]` so LLVM parks all of those instantiations together in
    // `.text.unlikely`, leaving the bytes that actually execute on startup dense instead of
    // spread across sibling monomorphizations that fault-around drags in.

    #[inline]
    fn t_semicolon(p: &mut Self) -> Result<Stmt> {
        p.lexer.next()?;
        Ok(Stmt::empty())
    }

    #[inline]
    fn t_function(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        p.parse_fn_stmt(loc, opts, None)
    }

    #[cold]
    #[inline(never)]
    fn t_enum(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        if !Self::IS_TYPESCRIPT_ENABLED {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }
        p.parse_typescript_enum_stmt(loc, opts)
    }

    #[cold]
    #[inline(never)]
    fn t_at(p: &mut Self, opts: &mut ParseStatementOptions<'a>) -> Result<Stmt> {
        // Parse decorators before class statements, which are potentially exported
        if Self::IS_TYPESCRIPT_ENABLED || p.options.features.standard_decorators {
            let scope_index = p.scopes_in_order.len();
            let ts_decorators = p.parse_type_script_decorators()?;

            // If this turns out to be a "declare class" statement, we need to undo the
            // scopes that were potentially pushed while parsing the decorator arguments.
            // That can look like any one of the following:
            //
            //   "@decorator declare class Foo {}"
            //   "@decorator declare abstract class Foo {}"
            //   "@decorator export declare class Foo {}"
            //   "@decorator export declare abstract class Foo {}"
            //
            // PORT NOTE: spec stores the Vec<Expr> directly into `opts.ts_decorators.values`.
            // `DeferredTsDecorators::values` is currently typed `&'a [Expr]` (parser.rs), so until
            // that field is widened to `ExprNodeList` we copy into the arena (Expr is `Copy`) and
            // let `ts_decorators` drop normally — no `mem::forget` / `from_raw_parts` lifetime
            // laundering (forbidden per PORTING.md §Forbidden patterns).
            let ts_decorators_slice: &'a [Expr] = p.arena.alloc_slice_copy(ts_decorators.slice());
            opts.ts_decorators = Some(DeferredTsDecorators {
                values: ts_decorators_slice,
                scope_index,
            });

            // "@decorator class Foo {}"
            // "@decorator abstract class Foo {}"
            // "@decorator declare class Foo {}"
            // "@decorator declare abstract class Foo {}"
            // "@decorator export class Foo {}"
            // "@decorator export abstract class Foo {}"
            // "@decorator export declare class Foo {}"
            // "@decorator export declare abstract class Foo {}"
            // "@decorator export default class Foo {}"
            // "@decorator export default abstract class Foo {}"
            if p.lexer.token != T::TClass
                && p.lexer.token != T::TExport
                && !(Self::IS_TYPESCRIPT_ENABLED && p.lexer.is_contextual_keyword(b"abstract"))
                && !(Self::IS_TYPESCRIPT_ENABLED && p.lexer.is_contextual_keyword(b"declare"))
            {
                p.lexer.expected(T::TClass)?;
            }

            return p.parse_stmt(opts);
        }
        // notimpl();

        p.lexer.unexpected()?;
        Err(err!("SyntaxError"))
    }

    #[inline(never)]
    fn t_class(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        if opts.lexical_decl != LexicalDecl::AllowAll {
            p.forbid_lexical_decl(loc)?;
        }

        p.parse_class_stmt(loc, opts)
    }

    #[inline]
    fn t_var(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        p.lexer.next()?;
        let decls = p.parse_and_declare_decls(js_ast::symbol::Kind::Hoisted, opts)?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(
            S::Local {
                kind: js_ast::s::Kind::KVar,
                decls,
                is_export: opts.is_export,
                ..Default::default()
            },
            loc,
        ))
    }

    #[inline]
    fn t_const(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        if opts.lexical_decl != LexicalDecl::AllowAll {
            p.forbid_lexical_decl(loc)?;
        }
        // p.markSyntaxFeature(compat.Const, p.lexer.Range())

        p.lexer.next()?;

        if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TEnum {
            return p.parse_typescript_enum_stmt(loc, opts);
        }

        let decls = p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, opts)?;
        p.lexer.expect_or_insert_semicolon()?;

        if !opts.is_typescript_declare {
            p.require_initializers(js_ast::s::Kind::KConst, decls.slice())?;
        }

        Ok(p.s(
            S::Local {
                kind: js_ast::s::Kind::KConst,
                decls,
                is_export: opts.is_export,
                ..Default::default()
            },
            loc,
        ))
    }

    #[inline(never)]
    fn t_if(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        let mut current_loc = loc;
        let mut root_if: Option<Stmt> = None;
        // PORT NOTE: `StoreRef` (arena back-pointer with safe `Deref`/`DerefMut`)
        // into the previous iteration's `S::If` allocation — borrowck cannot
        // express the cross-iteration back-reference, but the arena keeps every
        // node alive for `'a`.
        let mut current_if: Option<js_ast::StoreRef<S::If>> = None;

        loop {
            p.lexer.next()?;
            p.lexer.expect(T::TOpenParen)?;
            let test_ = p.parse_expr(Level::Lowest)?;
            p.lexer.expect(T::TCloseParen)?;
            let mut stmt_opts = ParseStatementOptions {
                lexical_decl: LexicalDecl::AllowFnInsideIf,
                ..Default::default()
            };
            let yes = p.parse_stmt(&mut stmt_opts)?;

            // Create the if node
            let if_stmt = p.s(
                S::If {
                    test_,
                    yes,
                    no: None,
                },
                current_loc,
            );

            // First if statement becomes root
            if root_if.is_none() {
                root_if = Some(if_stmt);
            }

            // Link to previous if statement's else branch
            if let Some(mut prev_if) = current_if {
                // `StoreRef` `DerefMut` — arena-allocated S::If from prior iteration.
                prev_if.no = Some(if_stmt);
            }

            // Set current if for next iteration. The S::If was just allocated via Stmt::alloc;
            // recover its arena handle through the StmtData payload.
            current_if = match if_stmt.data {
                js_ast::StmtData::SIf(s_if) => Some(s_if),
                _ => unreachable!(),
            };

            if p.lexer.token != T::TElse {
                return Ok(root_if.unwrap());
            }

            p.lexer.next()?;

            // Handle final else
            if p.lexer.token != T::TIf {
                stmt_opts = ParseStatementOptions {
                    lexical_decl: LexicalDecl::AllowFnInsideIf,
                    ..Default::default()
                };
                // current_if was set just above in this iteration; `StoreRef` `DerefMut`.
                let no = p.parse_stmt(&mut stmt_opts)?;
                let mut cur = current_if.unwrap();
                cur.no = Some(no);
                return Ok(root_if.unwrap());
            }

            // Continue with else if
            current_loc = p.lexer.loc();
        }
    }

    #[cold]
    #[inline(never)]
    fn t_do(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;
        p.lexer.expect(T::TWhile)?;
        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        // This is a weird corner case where automatic semicolon insertion applies
        // even without a newline present
        if p.lexer.token == T::TSemicolon {
            p.lexer.next()?;
        }
        Ok(p.s(S::DoWhile { body, test_ }, loc))
    }

    #[inline(never)]
    fn t_while(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;

        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;

        Ok(p.s(S::While { body, test_ }, loc))
    }

    #[cold]
    #[inline(never)]
    fn t_with(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        let body_loc = p.lexer.loc();
        p.lexer.expect(T::TCloseParen)?;

        // Push a scope so we make sure to prevent any bare identifiers referenced
        // within the body from being renamed. Renaming them might change the
        // semantics of the code.
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::With, body_loc)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmt(&mut stmt_opts)?;
        p.pop_scope();

        Ok(p.s(
            S::With {
                body,
                body_loc,
                value: test_,
            },
            loc,
        ))
    }

    #[inline(never)]
    fn t_switch(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;

        p.lexer.expect(T::TOpenParen)?;
        let test_ = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        let body_loc = p.lexer.loc();
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, body_loc)?;
        // Zig: `defer p.popScope()`. Wrap the body in an inner closure so `pop_scope` runs once on
        // its `Result`, covering every `?` early-exit as well as explicit returns.
        let result: Result<Stmt> = (|| {
            p.lexer.expect(T::TOpenBrace)?;
            let mut cases = bun_alloc::ArenaVec::<js_ast::Case>::new_in(p.arena);
            let mut found_default = false;
            while p.lexer.token != T::TCloseBrace {
                let mut body = StmtList::new_in(p.arena);
                // PORT NOTE: Zig hoisted `value`/`stmt_opts` above the loop;
                // both are reinitialized every iteration before any read, so
                // declare per-iteration.
                let mut value: Option<js_ast::Expr> = None;
                if p.lexer.token == T::TDefault {
                    if found_default {
                        p.log().add_range_error(
                            Some(p.source),
                            p.lexer.range(),
                            b"Multiple default clauses are not allowed",
                        );
                        return Err(err!("SyntaxError"));
                    }

                    found_default = true;
                    p.lexer.next()?;
                    p.lexer.expect(T::TColon)?;
                } else {
                    p.lexer.expect(T::TCase)?;
                    value = Some(p.parse_expr(Level::Lowest)?);
                    p.lexer.expect(T::TColon)?;
                }

                'case_body: loop {
                    match p.lexer.token {
                        T::TCloseBrace | T::TCase | T::TDefault => {
                            break 'case_body;
                        }
                        _ => {
                            let mut stmt_opts = ParseStatementOptions {
                                lexical_decl: LexicalDecl::AllowAll,
                                ..Default::default()
                            };
                            body.push(p.parse_stmt(&mut stmt_opts)?);
                        }
                    }
                }
                cases.push(js_ast::Case {
                    value,
                    body: bun_ast::StoreSlice::from_bump(body),
                    loc: bun_ast::Loc::EMPTY,
                });
            }
            p.lexer.expect(T::TCloseBrace)?;
            Ok(p.s(
                S::Switch {
                    test_,
                    body_loc,
                    cases: bun_ast::StoreSlice::from_bump(cases),
                },
                loc,
            ))
        })();
        p.pop_scope();
        result
    }

    #[inline(never)]
    fn t_try(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        let body_loc = p.lexer.loc();
        p.lexer.expect(T::TOpenBrace)?;
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
        p.pop_scope();
        p.lexer.next()?;

        let mut catch_: Option<js_ast::Catch> = None;
        let mut finally: Option<js_ast::Finally> = None;

        if p.lexer.token == T::TCatch {
            let catch_loc = p.lexer.loc();
            let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::CatchBinding, catch_loc)?;
            p.lexer.next()?;
            let mut binding: Option<js_ast::Binding> = None;

            // The catch binding is optional, and can be omitted
            if p.lexer.token != T::TOpenBrace {
                p.lexer.expect(T::TOpenParen)?;
                let mut value = p.parse_binding(Default::default())?;

                // Skip over types
                if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon {
                    p.lexer.expect(T::TColon)?;
                    p.skip_type_script_type(Level::Lowest)?;
                }

                p.lexer.expect(T::TCloseParen)?;

                // Bare identifiers are a special case
                let kind = match value.data {
                    js_ast::b::B::BIdentifier(_) => js_ast::symbol::Kind::CatchIdentifier,
                    _ => js_ast::symbol::Kind::Other,
                };
                p.declare_binding(kind, &mut value, &mut stmt_opts)?;
                binding = Some(value);
            }

            let catch_body_loc = p.lexer.loc();
            p.lexer.expect(T::TOpenBrace)?;

            let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, catch_body_loc)?;
            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
            p.pop_scope();
            p.lexer.next()?;
            catch_ = Some(js_ast::Catch {
                loc: catch_loc,
                binding,
                body: bun_ast::StoreSlice::from_bump(stmts),
                body_loc: catch_body_loc,
            });
            p.pop_scope();
        }

        if p.lexer.token == T::TFinally || catch_.is_none() {
            let finally_loc = p.lexer.loc();
            let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, finally_loc)?;
            p.lexer.expect(T::TFinally)?;
            p.lexer.expect(T::TOpenBrace)?;
            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
            p.lexer.next()?;
            finally = Some(js_ast::Finally {
                loc: finally_loc,
                stmts: bun_ast::StoreSlice::from_bump(stmts),
            });
            p.pop_scope();
        }

        Ok(p.s(
            S::Try {
                body_loc,
                body: bun_ast::StoreSlice::from_bump(body),
                catch_,
                finally,
            },
            loc,
        ))
    }

    #[inline(never)]
    fn t_for(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        // Zig: `defer p.popScope()`. Wrap the body in an inner closure so `pop_scope` runs once on
        // its `Result`, covering every `?` early-exit as well as explicit returns.
        let result: Result<Stmt> = (|| {
            p.lexer.next()?;

            // "for await (let x of y) {}"
            let mut is_for_await = p.lexer.is_contextual_keyword(b"await");
            if is_for_await {
                let await_range = p.lexer.range();
                if p.fn_or_arrow_data_parse.allow_await != AwaitOrYield::AllowExpr {
                    p.log().add_range_error(
                        Some(p.source),
                        await_range,
                        b"Cannot use \"await\" outside an async function",
                    );
                    is_for_await = false;
                } else {
                    // TODO: improve error handling here
                    //                 didGenerateError := p.markSyntaxFeature(compat.ForAwait, awaitRange)
                    if p.fn_or_arrow_data_parse.is_top_level {
                        p.top_level_await_keyword = await_range;
                        // p.markSyntaxFeature(compat.TopLevelAwait, awaitRange)
                    }
                }
                p.lexer.next()?;
            }

            p.lexer.expect(T::TOpenParen)?;

            let mut init_: Option<Stmt> = None;
            let mut test_: Option<Expr> = None;
            let mut update: Option<Expr> = None;

            // "in" expressions aren't allowed here
            p.allow_in = false;

            let mut bad_let_range: Option<bun_ast::Range> = None;
            if p.lexer.is_contextual_keyword(b"let") {
                bad_let_range = Some(p.lexer.range());
            }

            // Track the decl slice separately so we can reference it after `decls` is moved into
            // an arena-backed S::Local. The Vec's heap buffer stays put across the move; the
            // arena outlives this fn, so the lifetime-erased view remains valid.
            let mut decls_ptr: bun_ast::StoreSlice<G::Decl> = bun_ast::StoreSlice::EMPTY;
            let init_loc = p.lexer.loc();
            let mut is_var = false;
            match p.lexer.token {
                // for (var )
                T::TVar => {
                    is_var = true;
                    p.lexer.next()?;
                    let mut stmt_opts = ParseStatementOptions::default();
                    let decls =
                        p.parse_and_declare_decls(js_ast::symbol::Kind::Hoisted, &mut stmt_opts)?;
                    decls_ptr = bun_ast::StoreSlice::new(decls.slice());
                    init_ = Some(p.s(
                        S::Local {
                            kind: js_ast::s::Kind::KVar,
                            decls,
                            ..Default::default()
                        },
                        init_loc,
                    ));
                }
                // for (const )
                T::TConst => {
                    p.lexer.next()?;
                    let mut stmt_opts = ParseStatementOptions::default();
                    let decls =
                        p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, &mut stmt_opts)?;
                    decls_ptr = bun_ast::StoreSlice::new(decls.slice());
                    init_ = Some(p.s(
                        S::Local {
                            kind: js_ast::s::Kind::KConst,
                            decls,
                            ..Default::default()
                        },
                        init_loc,
                    ));
                }
                // for (;)
                T::TSemicolon => {}
                _ => {
                    let mut stmt_opts = ParseStatementOptions {
                        lexical_decl: LexicalDecl::AllowAll,
                        is_for_loop_init: true,
                        ..Default::default()
                    };

                    let res = p.parse_expr_or_let_stmt(&mut stmt_opts)?;
                    match res.stmt_or_expr {
                        js_ast::StmtOrExpr::Stmt(stmt) => {
                            bad_let_range = None;
                            init_ = Some(stmt);
                        }
                        js_ast::StmtOrExpr::Expr(expr) => {
                            init_ = Some(p.s(
                                S::SExpr {
                                    value: expr,
                                    ..Default::default()
                                },
                                init_loc,
                            ));
                        }
                    }
                }
            }

            // "in" expressions are allowed again
            p.allow_in = true;

            // Detect for-of loops
            if p.lexer.is_contextual_keyword(b"of") || is_for_await {
                if let Some(r) = bad_let_range {
                    p.log().add_range_error(
                        Some(p.source),
                        r,
                        b"\"let\" must be wrapped in parentheses to be used as an expression here",
                    );
                    return Err(err!("SyntaxError"));
                }

                if is_for_await && !p.lexer.is_contextual_keyword(b"of") {
                    if init_.is_some() {
                        p.lexer.expected_string(b"\"of\"")?;
                    } else {
                        p.lexer.unexpected()?;
                        return Err(err!("SyntaxError"));
                    }
                }

                p.forbid_initializers(decls_ptr.slice(), "of", false)?;
                p.lexer.next()?;
                let value = p.parse_expr(Level::Comma)?;
                p.lexer.expect(T::TCloseParen)?;
                let mut stmt_opts = ParseStatementOptions::default();
                let body = p.parse_stmt(&mut stmt_opts)?;
                return Ok(p.s(
                    S::ForOf {
                        is_await: is_for_await,
                        init: init_.unwrap(),
                        value,
                        body,
                    },
                    loc,
                ));
            }

            // Detect for-in loops
            if p.lexer.token == T::TIn {
                p.forbid_initializers(decls_ptr.slice(), "in", is_var)?;
                p.lexer.next()?;
                let value = p.parse_expr(Level::Lowest)?;
                p.lexer.expect(T::TCloseParen)?;
                let mut stmt_opts = ParseStatementOptions::default();
                let body = p.parse_stmt(&mut stmt_opts)?;
                return Ok(p.s(
                    S::ForIn {
                        init: init_.unwrap(),
                        value,
                        body,
                    },
                    loc,
                ));
            }

            // Only require "const" statement initializers when we know we're a normal for loop
            if let Some(init_stmt) = &init_ {
                match &init_stmt.data {
                    js_ast::StmtData::SLocal(local) => {
                        if local.kind == js_ast::s::Kind::KConst {
                            p.require_initializers(js_ast::s::Kind::KConst, decls_ptr.slice())?;
                        }
                    }
                    _ => {}
                }
            }

            p.lexer.expect(T::TSemicolon)?;
            if p.lexer.token != T::TSemicolon {
                test_ = Some(p.parse_expr(Level::Lowest)?);
            }

            p.lexer.expect(T::TSemicolon)?;

            if p.lexer.token != T::TCloseParen {
                update = Some(p.parse_expr(Level::Lowest)?);
            }

            p.lexer.expect(T::TCloseParen)?;
            let mut stmt_opts = ParseStatementOptions::default();
            let body = p.parse_stmt(&mut stmt_opts)?;
            Ok(p.s(
                S::For {
                    init: init_,
                    test_,
                    update,
                    body,
                },
                loc,
            ))
        })();
        p.pop_scope();
        result
    }

    #[inline]
    fn t_break(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        let name = p.parse_label_name()?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Break { label: name }, loc))
    }

    #[inline]
    fn t_continue(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        let name = p.parse_label_name()?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Continue { label: name }, loc))
    }

    #[inline]
    fn t_return(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        if p.fn_or_arrow_data_parse.is_return_disallowed {
            p.log().add_range_error(
                Some(p.source),
                p.lexer.range(),
                b"A return statement cannot be used here",
            );
        }
        p.lexer.next()?;
        let mut value: Option<Expr> = None;
        if p.lexer.token != T::TSemicolon
            && !p.lexer.has_newline_before
            && p.lexer.token != T::TCloseBrace
            && p.lexer.token != T::TEndOfFile
        {
            value = Some(p.parse_expr(Level::Lowest)?);
        }
        p.latest_return_had_semicolon = p.lexer.token == T::TSemicolon;
        p.lexer.expect_or_insert_semicolon()?;

        Ok(p.s(S::Return { value }, loc))
    }

    #[inline]
    fn t_throw(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        if p.lexer.has_newline_before {
            p.log().add_error(
                Some(p.source),
                bun_ast::Loc {
                    start: loc.start + 5,
                },
                b"Unexpected newline after \"throw\"",
            );
            return Err(err!("SyntaxError"));
        }
        let expr = p.parse_expr(Level::Lowest)?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Throw { value: expr }, loc))
    }

    #[cold]
    #[inline(never)]
    fn t_debugger(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(S::Debugger {}, loc))
    }

    #[inline(never)]
    fn t_open_brace(
        p: &mut Self,
        _: &mut ParseStatementOptions,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        // Zig: `defer p.popScope()`. Wrap the body in an inner closure so `pop_scope` runs once on
        // its `Result`, covering every `?` early-exit.
        let result: Result<Stmt> = (|| {
            p.lexer.next()?;
            let mut stmt_opts = ParseStatementOptions::default();
            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
            let close_brace_loc = p.lexer.loc();
            p.lexer.next()?;
            Ok(p.s(
                S::Block {
                    stmts: bun_ast::StoreSlice::from_bump(stmts),
                    close_brace_loc,
                },
                loc,
            ))
        })();
        p.pop_scope();
        result
    }

    // ─── heavy bodies still blocked ──────────────────────────────────────────
    #[inline(never)]
    fn t_export(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        let previous_export_keyword = p.esm_export_keyword;
        if opts.is_module_scope {
            p.esm_export_keyword = p.lexer.range();
        } else if !opts.is_namespace_scope {
            p.lexer.unexpected()?;
            return Err(err!("SyntaxError"));
        }
        p.lexer.next()?;

        // TypeScript decorators only work on class declarations
        // "@decorator export class Foo {}"
        // "@decorator export abstract class Foo {}"
        // "@decorator export default class Foo {}"
        // "@decorator export default abstract class Foo {}"
        // "@decorator export declare class Foo {}"
        // "@decorator export declare abstract class Foo {}"
        if opts.ts_decorators.is_some()
            && p.lexer.token != T::TClass
            && p.lexer.token != T::TDefault
            && !p.lexer.is_contextual_keyword(b"abstract")
            && !p.lexer.is_contextual_keyword(b"declare")
        {
            p.lexer.expected(T::TClass)?;
        }

        match p.lexer.token {
            T::TClass | T::TConst | T::TFunction | T::TVar => {
                opts.is_export = true;
                p.parse_stmt(opts)
            }

            T::TImport => {
                // "export import foo = bar"
                if Self::IS_TYPESCRIPT_ENABLED && (opts.is_module_scope || opts.is_namespace_scope)
                {
                    opts.is_export = true;
                    return p.parse_stmt(opts);
                }

                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }

            T::TEnum => {
                if !Self::IS_TYPESCRIPT_ENABLED {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                opts.is_export = true;
                p.parse_stmt(opts)
            }

            T::TIdentifier => {
                if p.lexer.is_contextual_keyword(b"let") {
                    opts.is_export = true;
                    return p.parse_stmt(opts);
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    if opts.is_typescript_declare && p.lexer.is_contextual_keyword(b"as") {
                        // "export as namespace ns;"
                        p.lexer.next()?;
                        p.lexer.expect_contextual_keyword(b"namespace")?;
                        p.lexer.expect(T::TIdentifier)?;
                        p.lexer.expect_or_insert_semicolon()?;

                        return Ok(p.s(S::TypeScript {}, loc));
                    }
                }

                if p.lexer.is_contextual_keyword(b"async") {
                    let async_range = p.lexer.range();
                    p.lexer.next()?;
                    if p.lexer.has_newline_before {
                        p.log().add_range_error(
                            Some(p.source),
                            async_range,
                            b"Unexpected newline after \"async\"",
                        );
                    }

                    p.lexer.expect(T::TFunction)?;
                    opts.is_export = true;
                    return p.parse_fn_stmt(loc, opts, Some(async_range));
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    use typescript::identifier::StmtIdentifier;
                    if let Some(ident) = typescript::identifier::for_str(p.lexer.identifier) {
                        match ident {
                            StmtIdentifier::SType => {
                                // "export type foo = ..."
                                let type_range = p.lexer.range();
                                p.lexer.next()?;
                                if p.lexer.has_newline_before {
                                    p.log().add_error_fmt(
                                        Some(p.source),
                                        type_range.end(),
                                        format_args!("Unexpected newline after \"type\""),
                                    );
                                    return Err(err!("SyntaxError"));
                                }
                                let mut skipper = ParseStatementOptions {
                                    is_module_scope: opts.is_module_scope,
                                    is_export: true,
                                    ..Default::default()
                                };
                                p.skip_type_script_type_stmt(&mut skipper)?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }
                            StmtIdentifier::SNamespace
                            | StmtIdentifier::SAbstract
                            | StmtIdentifier::SModule
                            | StmtIdentifier::SInterface => {
                                // "export namespace Foo {}"
                                // "export abstract class Foo {}"
                                // "export module Foo {}"
                                // "export interface Foo {}"
                                opts.is_export = true;
                                return p.parse_stmt(opts);
                            }
                            StmtIdentifier::SDeclare => {
                                // "export declare class Foo {}"
                                opts.is_export = true;
                                opts.lexical_decl = LexicalDecl::AllowAll;
                                opts.is_typescript_declare = true;
                                return p.parse_stmt(opts);
                            }
                        }
                    }
                }

                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }

            T::TDefault => {
                if !opts.is_module_scope
                    && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                let default_loc = p.lexer.loc();
                p.lexer.next()?;

                // TypeScript decorators only work on class declarations
                // "@decorator export default class Foo {}"
                // "@decorator export default abstract class Foo {}"
                if opts.ts_decorators.is_some()
                    && p.lexer.token != T::TClass
                    && !p.lexer.is_contextual_keyword(b"abstract")
                {
                    p.lexer.expected(T::TClass)?;
                }

                if p.lexer.is_contextual_keyword(b"async") {
                    let async_range = p.lexer.range();
                    p.lexer.next()?;
                    if p.lexer.token == T::TFunction && !p.lexer.has_newline_before {
                        p.lexer.next()?;
                        let mut stmt_opts = ParseStatementOptions {
                            is_name_optional: true,
                            lexical_decl: LexicalDecl::AllowAll,
                            ..Default::default()
                        };
                        let stmt = p.parse_fn_stmt(loc, &mut stmt_opts, Some(async_range))?;
                        if matches!(stmt.data, js_ast::StmtData::STypeScript(_)) {
                            // This was just a type annotation
                            return Ok(stmt);
                        }

                        let default_name = if let Some(func) = stmt.data.s_function() {
                            if let Some(name) = func.func.name {
                                LocRef {
                                    loc: name.loc,
                                    ref_: name.ref_,
                                }
                            } else {
                                p.create_default_name(default_loc)?
                            }
                        } else {
                            p.create_default_name(default_loc)?
                        };

                        let value = js_ast::StmtOrExpr::Stmt(stmt);
                        return Ok(p.s(
                            S::ExportDefault {
                                default_name,
                                value,
                            },
                            loc,
                        ));
                    }

                    let default_name = p.create_default_name(loc)?;

                    let mut expr = p.parse_async_prefix_expr(async_range, Level::Comma)?;
                    p.parse_suffix(&mut expr, Level::Comma, None, EFlags::None)?;
                    p.lexer.expect_or_insert_semicolon()?;
                    let value = js_ast::StmtOrExpr::Expr(expr);
                    p.has_export_default = true;
                    return Ok(p.s(
                        S::ExportDefault {
                            default_name,
                            value,
                        },
                        loc,
                    ));
                }

                if p.lexer.token == T::TFunction
                    || p.lexer.token == T::TClass
                    || p.lexer.is_contextual_keyword(b"interface")
                {
                    let mut _opts = ParseStatementOptions {
                        ts_decorators: opts.ts_decorators.take(),
                        is_name_optional: true,
                        lexical_decl: LexicalDecl::AllowAll,
                        ..Default::default()
                    };
                    let stmt = p.parse_stmt(&mut _opts)?;

                    let default_name: LocRef = 'default_name_getter: {
                        match &stmt.data {
                            // This was just a type annotation
                            js_ast::StmtData::STypeScript(_) => {
                                return Ok(stmt);
                            }

                            js_ast::StmtData::SFunction(func_container) => {
                                if let Some(name) = func_container.func.name {
                                    break 'default_name_getter LocRef {
                                        loc: name.loc,
                                        ref_: name.ref_,
                                    };
                                }
                            }
                            js_ast::StmtData::SClass(class) => {
                                if let Some(name) = class.class.class_name {
                                    break 'default_name_getter LocRef {
                                        loc: name.loc,
                                        ref_: name.ref_,
                                    };
                                }
                            }
                            _ => {}
                        }

                        p.create_default_name(default_loc).expect("unreachable")
                    };
                    p.has_export_default = true;
                    p.has_es_module_syntax = true;
                    return Ok(p.s(
                        S::ExportDefault {
                            default_name,
                            value: js_ast::StmtOrExpr::Stmt(stmt),
                        },
                        loc,
                    ));
                }

                let is_identifier = p.lexer.token == T::TIdentifier;
                let name = p.lexer.identifier;
                let expr = p.parse_expr(Level::Comma)?;

                // Handle the default export of an abstract class in TypeScript
                if Self::IS_TYPESCRIPT_ENABLED
                    && is_identifier
                    && (p.lexer.token == T::TClass || opts.ts_decorators.is_some())
                    && name == b"abstract"
                {
                    match &expr.data {
                        js_ast::ExprData::EIdentifier(_) => {
                            let mut stmt_opts = ParseStatementOptions {
                                ts_decorators: opts.ts_decorators.take(),
                                is_name_optional: true,
                                ..Default::default()
                            };
                            let stmt: Stmt = p.parse_class_stmt(loc, &mut stmt_opts)?;

                            // Use the statement name if present, since it's a better name
                            let default_name: LocRef = 'default_name_getter: {
                                match &stmt.data {
                                    // This was just a type annotation
                                    js_ast::StmtData::STypeScript(_) => {
                                        return Ok(stmt);
                                    }

                                    js_ast::StmtData::SFunction(func_container) => {
                                        if let Some(_name) = func_container.func.name {
                                            break 'default_name_getter LocRef {
                                                loc: default_loc,
                                                ref_: _name.ref_,
                                            };
                                        }
                                    }
                                    js_ast::StmtData::SClass(class) => {
                                        if let Some(_name) = class.class.class_name {
                                            break 'default_name_getter LocRef {
                                                loc: default_loc,
                                                ref_: _name.ref_,
                                            };
                                        }
                                    }
                                    _ => {}
                                }

                                p.create_default_name(default_loc).expect("unreachable")
                            };
                            p.has_export_default = true;
                            return Ok(p.s(
                                S::ExportDefault {
                                    default_name,
                                    value: js_ast::StmtOrExpr::Stmt(stmt),
                                },
                                loc,
                            ));
                        }
                        _ => {
                            p.panic("internal error: unexpected", format_args!(""));
                        }
                    }
                }

                p.lexer.expect_or_insert_semicolon()?;

                // Use the expression name if present, since it's a better name
                p.has_export_default = true;
                let default_name = p.default_name_for_expr(expr, default_loc);
                Ok(p.s(
                    S::ExportDefault {
                        default_name,
                        value: js_ast::StmtOrExpr::Expr(expr),
                    },
                    loc,
                ))
            }
            T::TAsterisk => {
                if !opts.is_module_scope
                    && !(opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                p.lexer.next()?;
                // Both arms below assign exactly once before any read.
                let namespace_ref: Ref;
                let mut alias: Option<G::ExportStarAlias> = None;
                let path: ParsedPath;

                if p.lexer.is_contextual_keyword(b"as") {
                    // "export * as ns from 'path'"
                    p.lexer.next()?;
                    let name = p.parse_clause_alias(b"export")?;
                    namespace_ref = p.store_name_in_ref(name)?;
                    alias = Some(G::ExportStarAlias {
                        loc: p.lexer.loc(),
                        original_name: bun_ast::StoreStr::new(name),
                    });
                    p.lexer.next()?;
                    p.lexer.expect_contextual_keyword(b"from")?;
                    path = p.parse_path()?;
                } else {
                    // "export * from 'path'"
                    p.lexer.expect_contextual_keyword(b"from")?;
                    path = p.parse_path()?;
                    // Zig: `fs.PathName.init(path.text).nonUniqueNameString(arena)` —
                    // sanitize the basename into an identifier and copy into the arena.
                    let name: &'a [u8] = {
                        use std::io::Write as _;
                        let base = fs::PathName::init(path.text).non_unique_name_string_base();
                        let mut buf: Vec<u8> = Vec::new();
                        write!(&mut buf, "{}", bun_core::fmt::fmt_identifier(base))
                            .expect("unreachable");
                        p.arena.alloc_slice_copy(&buf)
                    };
                    namespace_ref = p.store_name_in_ref(name)?;
                }

                let import_record_index = p.add_import_record(
                    ImportKind::Stmt,
                    path.loc,
                    path.text,
                    // TODO: import assertions
                    // path.assertions
                );

                if path.is_macro {
                    p.log().add_error(
                        Some(p.source),
                        path.loc,
                        b"cannot use macro in export statement",
                    );
                } else if path.import_tag != ImportRecordTag::None {
                    p.log().add_error(
                        Some(p.source),
                        loc,
                        b"cannot use export statement with \"type\" attribute",
                    );
                }

                if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                    // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                    p.import_records.items_mut()[import_record_index as usize]
                        .flags
                        .insert(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN);
                }

                p.lexer.expect_or_insert_semicolon()?;
                p.has_es_module_syntax = true;
                Ok(p.s(
                    S::ExportStar {
                        namespace_ref,
                        alias,
                        import_record_index,
                    },
                    loc,
                ))
            }
            T::TOpenBrace => {
                if !opts.is_module_scope
                    && !(opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                let export_clause = p.parse_export_clause()?;
                if p.lexer.is_contextual_keyword(b"from") {
                    p.lexer.expect_contextual_keyword(b"from")?;
                    let parsed_path = p.parse_path()?;

                    p.lexer.expect_or_insert_semicolon()?;

                    if Self::IS_TYPESCRIPT_ENABLED {
                        // export {type Foo} from 'bar';
                        // ->
                        // nothing
                        // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                        if export_clause.clauses.is_empty() && export_clause.had_type_only_exports {
                            return Ok(p.s(S::TypeScript {}, loc));
                        }
                    }

                    if parsed_path.is_macro {
                        p.log().add_error(
                            Some(p.source),
                            loc,
                            b"export from cannot be used with \"type\": \"macro\"",
                        );
                    } else if parsed_path.import_tag != ImportRecordTag::None {
                        p.log().add_error(
                            Some(p.source),
                            loc,
                            b"export from cannot be used with \"type\" attribute",
                        );
                    }

                    let import_record_index =
                        p.add_import_record(ImportKind::Stmt, parsed_path.loc, parsed_path.text);
                    let path_name = fs::PathName::init(parsed_path.text);
                    // PERF(port): was arena allocPrint — profile in Phase B
                    let namespace_ref = {
                        use std::io::Write as _;
                        let mut buf: Vec<u8> = Vec::new();
                        write!(
                            &mut buf,
                            "import_{}",
                            bun_core::fmt::fmt_identifier(path_name.non_unique_name_string_base())
                        )
                        .expect("unreachable");
                        // TODO(port): store_name_in_ref expects arena-owned slice; verify lifetime
                        p.store_name_in_ref(p.arena.alloc_slice_copy(&buf))?
                    };

                    if Self::TRACK_SYMBOL_USAGE_DURING_PARSE_PASS {
                        // In the scan pass, we need _some_ way of knowing *not* to mark as unused
                        p.import_records.items_mut()[import_record_index as usize]
                            .flags
                            .insert(ImportRecordFlags::CALLS_RUNTIME_RE_EXPORT_FN);
                    }
                    p.current_scope_mut().is_after_const_local_prefix = true;
                    p.has_es_module_syntax = true;
                    return Ok(p.s(
                        S::ExportFrom {
                            // SAFETY: sole owner — fresh arena slice from parse_export_clause,
                            // moved into the AST node here; no other &mut alias exists.
                            items: export_clause.clauses.into(),
                            is_single_line: export_clause.is_single_line,
                            namespace_ref,
                            import_record_index,
                        },
                        loc,
                    ));
                }
                p.lexer.expect_or_insert_semicolon()?;

                if Self::IS_TYPESCRIPT_ENABLED {
                    // export {type Foo};
                    // ->
                    // nothing
                    // https://www.typescriptlang.org/play?useDefineForClassFields=true&esModuleInterop=false&declaration=false&target=99&isolatedModules=false&ts=4.5.4#code/KYDwDg9gTgLgBDAnmYcDeAxCEC+cBmUEAtnAOQBGAhlGQNwBQQA
                    if export_clause.clauses.is_empty() && export_clause.had_type_only_exports {
                        return Ok(p.s(S::TypeScript {}, loc));
                    }
                }
                p.has_es_module_syntax = true;
                Ok(p.s(
                    S::ExportClause {
                        // SAFETY: sole owner — fresh arena slice from parse_export_clause,
                        // moved into the AST node here; no other &mut alias exists.
                        items: export_clause.clauses.into(),
                        is_single_line: export_clause.is_single_line,
                    },
                    loc,
                ))
            }
            T::TEquals => {
                // "export = value;"

                p.esm_export_keyword = previous_export_keyword; // This wasn't an ESM export statement after all
                if Self::IS_TYPESCRIPT_ENABLED {
                    p.lexer.next()?;
                    let value = p.parse_expr(Level::Lowest)?;
                    p.lexer.expect_or_insert_semicolon()?;
                    return Ok(p.s(S::ExportEquals { value }, loc));
                }
                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }
            _ => {
                p.lexer.unexpected()?;
                Err(err!("SyntaxError"))
            }
        }
    }

    #[inline(never)]
    fn t_import(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        let previous_import_keyword = p.esm_import_keyword;
        p.esm_import_keyword = p.lexer.range();
        p.lexer.next()?;
        let mut stmt: S::Import = S::Import {
            namespace_ref: Ref::NONE,
            import_record_index: u32::MAX,
            ..Default::default()
        };
        let mut was_originally_bare_import = false;

        // "export import foo = bar"
        if (opts.is_export || (opts.is_namespace_scope && !opts.is_typescript_declare))
            && p.lexer.token != T::TIdentifier
        {
            p.lexer.expected(T::TIdentifier)?;
        }

        match p.lexer.token {
            // "import('path')"
            // "import.meta"
            T::TOpenParen | T::TDot => {
                p.esm_import_keyword = previous_import_keyword; // this wasn't an esm import statement after all
                let mut expr = p.parse_import_expr(loc, Level::Lowest)?;
                p.parse_suffix(&mut expr, Level::Lowest, None, EFlags::None)?;
                p.lexer.expect_or_insert_semicolon()?;
                return Ok(p.s(
                    S::SExpr {
                        value: expr,
                        ..Default::default()
                    },
                    loc,
                ));
            }
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral => {
                // "import 'path'"
                if !opts.is_module_scope
                    && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }
                was_originally_bare_import = true;
            }
            T::TAsterisk => {
                // "import * as ns from 'path'"
                if !opts.is_module_scope
                    && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                p.lexer.next()?;
                p.lexer.expect_contextual_keyword(b"as")?;
                stmt = S::Import {
                    namespace_ref: p.store_name_in_ref(p.lexer.identifier)?,
                    star_name_loc: Some(p.lexer.loc()),
                    import_record_index: u32::MAX,
                    ..Default::default()
                };
                p.lexer.expect(T::TIdentifier)?;
                p.lexer.expect_contextual_keyword(b"from")?;
            }
            T::TOpenBrace => {
                // "import {item1, item2} from 'path'"
                if !opts.is_module_scope
                    && (!opts.is_namespace_scope || !opts.is_typescript_declare)
                {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }
                let import_clause = p.parse_import_clause()?;
                if Self::IS_TYPESCRIPT_ENABLED {
                    if import_clause.had_type_only_imports && import_clause.items.is_empty() {
                        p.lexer.expect_contextual_keyword(b"from")?;
                        let _ = p.parse_path()?;
                        p.lexer.expect_or_insert_semicolon()?;
                        return Ok(p.s(S::TypeScript {}, loc));
                    }
                }

                stmt = S::Import {
                    namespace_ref: Ref::NONE,
                    import_record_index: u32::MAX,
                    // SAFETY: sole owner — fresh arena slice from parse_import_clause,
                    // moved into the AST node here; no other &mut alias exists.
                    items: import_clause.items.into(),
                    is_single_line: import_clause.is_single_line,
                    ..Default::default()
                };
                p.lexer.expect_contextual_keyword(b"from")?;
            }
            T::TIdentifier => {
                // "import defaultItem from 'path'"
                // "import foo = bar"
                if !opts.is_module_scope && !opts.is_namespace_scope {
                    p.lexer.unexpected()?;
                    return Err(err!("SyntaxError"));
                }

                let mut default_name = p.lexer.identifier;
                stmt = S::Import {
                    namespace_ref: Ref::NONE,
                    import_record_index: u32::MAX,
                    default_name: Some(LocRef {
                        loc: p.lexer.loc(),
                        ref_: Some(p.store_name_in_ref(default_name)?),
                    }),
                    ..Default::default()
                };
                p.lexer.next()?;

                if Self::IS_TYPESCRIPT_ENABLED {
                    // Skip over type-only imports
                    if default_name == b"type" {
                        match p.lexer.token {
                            T::TIdentifier => {
                                if p.lexer.identifier != b"from" {
                                    default_name = p.lexer.identifier;
                                    stmt.default_name.as_mut().unwrap().loc = p.lexer.loc();
                                    p.lexer.next()?;

                                    if p.lexer.token == T::TEquals {
                                        // "import type foo = require('bar');"
                                        // "import type foo = bar.baz;"
                                        opts.is_typescript_declare = true;
                                        return p.parse_type_script_import_equals_stmt(
                                            loc,
                                            opts,
                                            stmt.default_name.unwrap().loc,
                                            default_name,
                                        );
                                    } else {
                                        // "import type foo from 'bar';"
                                        p.lexer.expect_contextual_keyword(b"from")?;
                                        let _ = p.parse_path()?;
                                        p.lexer.expect_or_insert_semicolon()?;
                                        return Ok(p.s(S::TypeScript {}, loc));
                                    }
                                }
                            }
                            T::TAsterisk => {
                                // "import type * as foo from 'bar';"
                                p.lexer.next()?;
                                p.lexer.expect_contextual_keyword(b"as")?;
                                p.lexer.expect(T::TIdentifier)?;
                                p.lexer.expect_contextual_keyword(b"from")?;
                                let _ = p.parse_path()?;
                                p.lexer.expect_or_insert_semicolon()?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }

                            T::TOpenBrace => {
                                // "import type {foo} from 'bar';"
                                let _ = p.parse_import_clause()?;
                                p.lexer.expect_contextual_keyword(b"from")?;
                                let _ = p.parse_path()?;
                                p.lexer.expect_or_insert_semicolon()?;
                                return Ok(p.s(S::TypeScript {}, loc));
                            }
                            _ => {}
                        }
                    }

                    // Parse TypeScript import assignment statements
                    if p.lexer.token == T::TEquals
                        || opts.is_export
                        || (opts.is_namespace_scope && !opts.is_typescript_declare)
                    {
                        p.esm_import_keyword = previous_import_keyword; // This wasn't an ESM import statement after all;
                        return p.parse_type_script_import_equals_stmt(
                            loc,
                            opts,
                            bun_ast::Loc::EMPTY,
                            default_name,
                        );
                    }
                }

                if p.lexer.token == T::TComma {
                    p.lexer.next()?;

                    match p.lexer.token {
                        // "import defaultItem, * as ns from 'path'"
                        T::TAsterisk => {
                            p.lexer.next()?;
                            p.lexer.expect_contextual_keyword(b"as")?;
                            stmt.namespace_ref = p.store_name_in_ref(p.lexer.identifier)?;
                            stmt.star_name_loc = Some(p.lexer.loc());
                            p.lexer.expect(T::TIdentifier)?;
                        }
                        // "import defaultItem, {item1, item2} from 'path'"
                        T::TOpenBrace => {
                            let import_clause = p.parse_import_clause()?;

                            // SAFETY: sole owner — fresh arena slice from parse_import_clause,
                            // moved into the AST node here; no other &mut alias exists.
                            stmt.items = import_clause.items.into();
                            stmt.is_single_line = import_clause.is_single_line;
                        }
                        _ => {
                            p.lexer.unexpected()?;
                            return Err(err!("SyntaxError"));
                        }
                    }
                }

                p.lexer.expect_contextual_keyword(b"from")?;
            }
            _ => {
                p.lexer.unexpected()?;
                return Err(err!("SyntaxError"));
            }
        }

        let path = p.parse_path()?;
        p.lexer.expect_or_insert_semicolon()?;

        p.process_import_statement(stmt, path, loc, was_originally_bare_import)
    }

    /// Out-of-line tail for the (uncommon) `label: stmt` form reached from
    /// `parse_stmt_fallthrough`. Keeping the nested `ParseStatementOptions` and the
    /// recursive `parse_stmt` call here keeps `parse_stmt_fallthrough`'s frame small.
    #[cold]
    #[inline(never)]
    fn parse_labeled_stmt(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
        label_loc: bun_ast::Loc,
        label_ref: Ref,
    ) -> Result<Stmt> {
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Label, loc)?;
        // Zig: `defer p.popScope();` — pop after parsing the labeled body.
        // Hand-roll the defer so we can keep `p` exclusively borrowed.

        // Parse a labeled statement
        p.lexer.next()?;

        let _name = LocRef {
            loc: label_loc,
            ref_: Some(label_ref),
        };
        let mut nested_opts = ParseStatementOptions::default();

        match opts.lexical_decl {
            LexicalDecl::AllowAll | LexicalDecl::AllowFnInsideLabel => {
                nested_opts.lexical_decl = LexicalDecl::AllowFnInsideLabel;
            }
            _ => {}
        }
        let stmt_result = p.parse_stmt(&mut nested_opts);
        p.pop_scope();
        let stmt = stmt_result?;
        Ok(p.s(S::Label { name: _name, stmt }, loc))
    }

    fn parse_stmt_fallthrough(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        let is_identifier = p.lexer.token == T::TIdentifier;
        let name = p.lexer.identifier;
        // Parse either an async function, an async expression, or a normal expression.
        // Every branch below either assigns `expr` or `return`s.
        let mut expr: Expr;
        if is_identifier && p.lexer.raw() == b"async" {
            let async_range = p.lexer.range();
            p.lexer.next()?;
            if p.lexer.token == T::TFunction && !p.lexer.has_newline_before {
                p.lexer.next()?;

                return p.parse_fn_stmt(async_range.loc, opts, Some(async_range));
            }

            expr = p.parse_async_prefix_expr(async_range, Level::Lowest)?;
            p.parse_suffix(&mut expr, Level::Lowest, None, EFlags::None)?;
        } else {
            let expr_or_let = p.parse_expr_or_let_stmt(opts)?;
            match expr_or_let.stmt_or_expr {
                js_ast::StmtOrExpr::Stmt(stmt) => {
                    p.lexer.expect_or_insert_semicolon()?;
                    return Ok(stmt);
                }
                js_ast::StmtOrExpr::Expr(_expr) => {
                    expr = _expr;
                }
            }
        }
        if is_identifier {
            if let js_ast::ExprData::EIdentifier(ident) = &expr.data {
                if p.lexer.token == T::TColon && !opts.has_decorators() {
                    return Self::parse_labeled_stmt(p, opts, loc, expr.loc, ident.ref_);
                }
            }

            if Self::IS_TYPESCRIPT_ENABLED {
                if let Some(ts_stmt) = js_lexer::TypescriptStmtKeyword::from_bytes(name) {
                    // Hand the cold TS-keyword statement forms (`type`/`interface`/`namespace`/
                    // `module`/`abstract`/`global`/`declare`) to an out-of-line helper so the
                    // common `SExpr` fall-through keeps a small stack frame.
                    if let Some(stmt) =
                        Self::parse_stmt_fallthrough_ts_keyword(p, opts, loc, ts_stmt)?
                    {
                        return Ok(stmt);
                    }
                }
            }
        }
        // Output.print("\n\nmVALUE {s}:{s}\n", .{ expr, name });
        p.lexer.expect_or_insert_semicolon()?;
        Ok(p.s(
            S::SExpr {
                value: expr,
                ..Default::default()
            },
            loc,
        ))
    }

    /// Cold TS-only statement keywords reached from `parse_stmt_fallthrough` once the
    /// leading identifier has been recognised as one of the contextual statement keywords.
    /// Returns `Some(stmt)` when the keyword form was consumed; `None` means the caller
    /// should fall through to treating the already-parsed expression as an `SExpr`.
    #[cold]
    #[inline(never)]
    fn parse_stmt_fallthrough_ts_keyword(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
        ts_stmt: js_lexer::TypescriptStmtKeyword,
    ) -> Result<Option<Stmt>> {
        match ts_stmt {
            js_lexer::TypescriptStmtKeyword::TsStmtType => {
                if p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before {
                    // "type Foo = any"
                    let mut stmt_opts = ParseStatementOptions {
                        is_module_scope: opts.is_module_scope,
                        ..Default::default()
                    };
                    p.skip_type_script_type_stmt(&mut stmt_opts)?;
                    return Ok(Some(p.s(S::TypeScript {}, loc)));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtNamespace
            | js_lexer::TypescriptStmtKeyword::TsStmtModule => {
                // "namespace Foo {}"
                // "module Foo {}"
                // "declare module 'fs' {}"
                // "declare module 'fs';"
                if !p.lexer.has_newline_before
                    && (opts.is_module_scope || opts.is_namespace_scope)
                    && (p.lexer.token == T::TIdentifier
                        || (p.lexer.token == T::TStringLiteral && opts.is_typescript_declare))
                {
                    return Ok(Some(p.parse_type_script_namespace_stmt(loc, opts)?));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtInterface => {
                // "interface Foo {}"
                let mut stmt_opts = ParseStatementOptions {
                    is_module_scope: opts.is_module_scope,
                    ..Default::default()
                };

                p.skip_type_script_interface_stmt(&mut stmt_opts)?;
                return Ok(Some(p.s(S::TypeScript {}, loc)));
            }
            js_lexer::TypescriptStmtKeyword::TsStmtAbstract => {
                if p.lexer.token == T::TClass || opts.ts_decorators.is_some() {
                    return Ok(Some(p.parse_class_stmt(loc, opts)?));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtGlobal => {
                // "declare module 'fs' { global { namespace NodeJS {} } }"
                if opts.is_namespace_scope
                    && opts.is_typescript_declare
                    && p.lexer.token == T::TOpenBrace
                {
                    p.lexer.next()?;
                    let _ = p.parse_stmts_up_to(T::TCloseBrace, opts)?;
                    p.lexer.next()?;
                    return Ok(Some(p.s(S::TypeScript {}, loc)));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtDeclare => {
                opts.lexical_decl = LexicalDecl::AllowAll;
                opts.is_typescript_declare = true;

                // "@decorator declare class Foo {}"
                // "@decorator declare abstract class Foo {}"
                if opts.ts_decorators.is_some()
                    && p.lexer.token != T::TClass
                    && !p.lexer.is_contextual_keyword(b"abstract")
                {
                    p.lexer.expected(T::TClass)?;
                }

                // "declare global { ... }"
                if p.lexer.is_contextual_keyword(b"global") {
                    p.lexer.next()?;
                    p.lexer.expect(T::TOpenBrace)?;
                    let _ = p.parse_stmts_up_to(T::TCloseBrace, opts)?;
                    p.lexer.next()?;
                    return Ok(Some(p.s(S::TypeScript {}, loc)));
                }

                // "declare const x: any"
                let stmt = p.parse_stmt(opts)?;
                if let Some(decs) = &opts.ts_decorators {
                    p.discard_scopes_up_to(decs.scope_index);
                }

                // Unlike almost all uses of "declare", statements that use
                // "export declare" with "var/let/const" inside a namespace affect
                // code generation. They cause any declared bindings to be
                // considered exports of the namespace. Identifier references to
                // those names must be converted into property accesses off the
                // namespace object:
                //
                //   namespace ns {
                //     export declare const x
                //     export function y() { return x }
                //   }
                //
                //   (ns as any).x = 1
                //   console.log(ns.y())
                //
                // In this example, "return x" must be replaced with "return ns.x".
                // This is handled by replacing each "export declare" statement
                // inside a namespace with an "export var" statement containing all
                // of the declared bindings. That "export var" statement will later
                // cause identifiers to be transformed into property accesses.
                if opts.is_namespace_scope && opts.is_export {
                    let mut decls: G::DeclList = bun_alloc::AstAlloc::vec();
                    match &stmt.data {
                        js_ast::StmtData::SLocal(local) => {
                            let mut _decls = bun_alloc::ArenaVec::<G::Decl>::with_capacity_in(
                                local.decls.len_u32() as usize,
                                p.arena,
                            );
                            for decl in local.decls.slice() {
                                Self::extract_decls_for_binding(decl.binding, &mut _decls)?;
                            }
                            decls = G::DeclList::from_bump_vec(_decls);
                        }
                        _ => {}
                    }

                    if decls.len_u32() > 0 {
                        return Ok(Some(p.s(
                            S::Local {
                                kind: js_ast::LocalKind::KVar,
                                is_export: true,
                                decls,
                                ..Default::default()
                            },
                            loc,
                        )));
                    }
                }

                return Ok(Some(p.s(S::TypeScript {}, loc)));
            }
        }
        Ok(None)
    }

    pub fn parse_stmt(&mut self, opts: &mut ParseStatementOptions<'a>) -> Result<Stmt> {
        // PORT NOTE: Zig only checks `stack_check`; the hard cap is added so
        // Windows' 18 MB worker stack (where the small Rust `parse_stmt`→`t_*`
        // frames never exhaust it) still throws before the uncapped visitor/
        // printer pass hard-overflows. See `P::parse_stmt_depth` field doc.
        if self.parse_stmt_depth >= MAX_STMT_DEPTH || !self.stack_check.is_safe_to_recurse() {
            // TODO(port): bun_core::throw_stack_overflow() not yet exported; map to a SyntaxError
            // until the StackOverflow error variant lands.
            return Err(err!("StackOverflow"));
        }
        self.parse_stmt_depth += 1;

        // Zig used `inline ... => |function| @field(@This(), @tagName(function))(...)` to dispatch
        // by token name via comptime reflection. Rust has no `@field`/`@tagName`; expand the arms.
        let loc = self.lexer.loc();
        let result = match self.lexer.token {
            T::TSemicolon => Self::t_semicolon(self),
            T::TAt => Self::t_at(self, opts),

            T::TExport => Self::t_export(self, opts, loc),
            T::TFunction => Self::t_function(self, opts, loc),
            T::TEnum => Self::t_enum(self, opts, loc),
            T::TClass => Self::t_class(self, opts, loc),
            T::TVar => Self::t_var(self, opts, loc),
            T::TConst => Self::t_const(self, opts, loc),
            T::TIf => Self::t_if(self, opts, loc),
            T::TDo => Self::t_do(self, opts, loc),
            T::TWhile => Self::t_while(self, opts, loc),
            T::TWith => Self::t_with(self, opts, loc),
            T::TSwitch => Self::t_switch(self, opts, loc),
            T::TTry => Self::t_try(self, opts, loc),
            T::TFor => Self::t_for(self, opts, loc),
            T::TImport => Self::t_import(self, opts, loc),
            T::TBreak => Self::t_break(self, opts, loc),
            T::TContinue => Self::t_continue(self, opts, loc),
            T::TReturn => Self::t_return(self, opts, loc),
            T::TThrow => Self::t_throw(self, opts, loc),
            T::TDebugger => Self::t_debugger(self, opts, loc),
            T::TOpenBrace => Self::t_open_brace(self, opts, loc),

            _ => Self::parse_stmt_fallthrough(self, opts, loc),
        };
        self.parse_stmt_depth -= 1;
        result
    }
}

/// See `P::parse_stmt_depth` — sized so the visitor/printer (larger per-level
/// frames, no stack check) fit on the smallest 4 MB POSIX worker stack.
const MAX_STMT_DEPTH: u32 = 1000;
