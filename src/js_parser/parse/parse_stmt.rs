#![allow(clippy::single_match)]
#![warn(unused_must_use)]
use bun_collections::VecExt;
use bun_core;

use crate::lexer as js_lexer;
use crate::p::P;
use bun_ast as js_ast;

use js_ast::op::Level;
use js_ast::{Expr, G, LocRef, S, Stmt};
use js_lexer::T;

use crate::parser::fs;
use crate::parser::{
    AwaitOrYield, DeferredTsDecorators, LexicalDecl, ParseStatementOptions, ParsedPath, Ref,
    StatementScope, StmtList,
};
use crate::typescript;
use bun_ast::{ImportKind, ImportRecordFlags, ImportRecordTag};
use js_ast::expr::EFlags;

type Result<T> = crate::CrateResult<T>;

// The 25+ per-token `t_*` helpers are private; only `parse_stmt` is surfaced.

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // Note on `#[inline]` / `#[inline(never)]` / `#[cold]` annotations across the `t_*` arms:
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
        let loc = p.lexer.loc();
        p.lexer.next()?;
        if p.lexer.tolerant {
            // 1313 is reported at the `;`.
            return Ok(Stmt {
                loc,
                ..Stmt::empty()
            });
        }
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
            return Err(crate::Error::SyntaxError);
        }
        p.parse_typescript_enum_stmt(loc, opts)
    }

    /// An error TypeScript's parser knows nothing of: its checker says it of the tree (`grammarErrorOnNode` and the like).
    /// It is no part of what the parser objects to, so it hides nothing that is said of the same place afterwards.
    #[cold]
    #[inline(never)]
    fn grammar_error(p: &mut Self, r: bun_ast::Range, code: u32) {
        p.lexer.ts_grammar_error(r, code);
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
            // spec stores the Vec<Expr> directly into `opts.ts_decorators.values`.
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
            // (but reject "export @decorator export class Foo {}")
            if p.lexer.token != T::TClass
                && !(p.lexer.token == T::TExport && !opts.is_export)
                && !(Self::IS_TYPESCRIPT_ENABLED && p.lexer.is_contextual_keyword(b"abstract"))
                && !(Self::IS_TYPESCRIPT_ENABLED && p.lexer.is_contextual_keyword(b"declare"))
            {
                if p.lexer.tolerant && !p.lexer.is_log_disabled {
                    return Self::declaration_after_decorators(p, opts);
                }
                p.lexer.expected(T::TClass)?;
            }

            return p.parse_stmt(opts);
        }
        // notimpl();

        p.lexer.unexpected()?;
        Err(crate::Error::SyntaxError)
    }

    /// `parseDeclaration` after decorators that are not followed by `class`, `export`, `abstract` or `declare`. Tolerant mode only.
    #[cold]
    #[inline(never)]
    fn declaration_after_decorators(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<Stmt> {
        // `nextTokenCanFollowDefaultKeyword`: `default` is a modifier.
        if p.lexer.token == T::TDefault
            && p.next_token_matches(|p| {
                matches!(p.lexer.token, T::TClass | T::TFunction)
                    || p.lexer.is_contextual_keyword(b"interface")
                    || p.lexer.is_contextual_keyword(b"abstract")
                    || p.lexer.is_contextual_keyword(b"async")
            })
        {
            let default_range = p.lexer.range();
            p.push_statement_modifier(bun_ast::ts_syntax::Flags::DEFAULT, default_range.loc);
            p.lexer.next()?;
            opts.is_name_optional = true;
            if p.lexer.token == T::TClass || p.lexer.is_contextual_keyword(b"abstract") {
                // `checkGrammarModifiers`: `export` must precede `default`.
                p.lexer.ts_grammar_error(default_range, 1029);
                return p.parse_stmt(opts);
            }
        }
        // `parseDeclarationWorker` decides by the kind of the token.
        let is_declaration = match p.lexer.token {
            T::TVar | T::TConst | T::TFunction | T::TEnum | T::TImport | T::TExport => true,
            T::TIdentifier => {
                matches!(
                    p.lexer.raw(),
                    b"let"
                        | b"using"
                        | b"interface"
                        | b"type"
                        | b"namespace"
                        | b"module"
                        | b"global"
                ) || p.is_start_of_declaration()
            }
            _ => false,
        };
        if !is_declaration {
            // A MissingDeclaration: nothing is consumed, and its decorators are not checked.
            let at = p.lexer.full_start();
            if let Some(decorators) = opts.ts_decorators.take() {
                p.note_stray_decorators(decorators.values, at);
            }
            p.lexer.ts_error(bun_ast::Range { loc: at, len: 0 }, 1146);
            return Ok(Stmt::empty());
        }
        Self::decorators_without_class(p, opts)?;
        if p.lexer.is_contextual_keyword(b"using")
            && !p.next_token_matches(|p| {
                p.lexer.token == T::TIdentifier && !p.lexer.has_newline_before
            })
        {
            // `parseVariableStatement`: after modifiers, `using` starts a declaration list whatever follows it.
            let loc = p.lexer.loc();
            p.lexer.next()?;
            opts.is_using_statement = true;
            let decls = p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, opts)?;
            p.lexer.expect_or_insert_semicolon()?;
            return Ok(p.s(
                S::Local {
                    kind: js_ast::s::Kind::KUsing,
                    decls,
                    ..Default::default()
                },
                loc,
            ));
        }
        p.parse_stmt(opts)
    }

    /// Call where decorators are followed by something other than a class. Ordinary builds report that a class is expected.
    /// Tolerant mode reports 1206 at the first one (`reportObviousDecoratorErrors`) and keeps them as it keeps those of a missing
    /// declaration.
    #[cold]
    #[inline(never)]
    fn decorators_without_class(p: &mut Self, opts: &mut ParseStatementOptions<'a>) -> Result<()> {
        if !p.lexer.tolerant || p.lexer.is_log_disabled {
            p.lexer.expected(T::TClass)?;
            return Ok(());
        }
        if let Some(decorators) = opts.ts_decorators.take()
            && let Some(first) = decorators.values.first()
        {
            let before = &p.source.contents()[..first.loc.start.max(0) as usize];
            let at = before.iter().rposition(|&b| b == b'@').unwrap_or(0);
            p.lexer.ts_grammar_error(
                bun_ast::Range {
                    loc: bun_ast::usize2loc(at),
                    len: 1,
                },
                1206,
            );
            let end = p.lexer.full_start();
            p.note_stray_decorators(decorators.values, end);
        }
        Ok(())
    }

    /// `parseModifiersEx`: decorators are modifiers, and may come after `export` or `export default` as well as before.
    /// They all decorate the class. What `checkGrammarModifiers` has against where they are is said here.
    #[cold]
    #[inline(never)]
    fn more_decorators(p: &mut Self, opts: &mut ParseStatementOptions<'a>) -> Result<()> {
        let at = p.lexer.range();
        let scope_index = p.scopes_in_order.len();
        let more = p.parse_type_script_decorators()?;
        match opts.ts_decorators.take() {
            // Before `export` and after it.
            Some(first) => {
                Self::grammar_error(p, at, 8038);
                let mut all: Vec<Expr> = first.values.to_vec();
                all.extend_from_slice(more.slice());
                opts.ts_decorators = Some(DeferredTsDecorators {
                    values: p.arena.alloc_slice_copy(&all),
                    scope_index: first.scope_index,
                });
            }
            None => {
                opts.ts_decorators = Some(DeferredTsDecorators {
                    values: p.arena.alloc_slice_copy(more.slice()),
                    scope_index,
                });
                // "export @decorator default class Foo {}"
                if p.lexer.token == T::TDefault {
                    Self::grammar_error(p, at, 1206);
                }
            }
        }
        Ok(())
    }

    #[inline(never)]
    fn t_class(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        if opts.lexical_decl != LexicalDecl::AllowAll {
            p.forbid_lexical_decl(loc);
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
            p.forbid_lexical_decl(loc);
        }
        // p.markSyntaxFeature(compat.Const, p.lexer.Range())

        p.lexer.next()?;

        if Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TEnum {
            p.push_statement_modifier(bun_ast::ts_syntax::Flags::CONST, loc);
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
        // `StoreRef` (arena back-pointer with safe `Deref`/`DerefMut`)
        // into the previous iteration's `S::If` allocation — borrowck cannot
        // express the cross-iteration back-reference, but the arena keeps every
        // node alive for `'a`.
        let mut current_if: Option<js_ast::StoreRef<S::If>> = None;

        loop {
            p.lexer.next()?;
            let open_paren = p.lexer.loc();
            p.lexer.expect(T::TOpenParen)?;
            let test = p.parse_expr(Level::Lowest)?;
            p.lexer.expect_closing(T::TCloseParen, open_paren)?;
            let mut stmt_opts = ParseStatementOptions {
                lexical_decl: LexicalDecl::AllowFnInsideIf,
                ..Default::default()
            };
            let yes = Self::parse_embedded_stmt(p, &mut stmt_opts)?;

            // Create the if node
            let if_stmt = p.s(
                S::If {
                    test,
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
                let no = Self::parse_embedded_stmt(p, &mut stmt_opts)?;
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
        let body = Self::parse_embedded_stmt(p, &mut stmt_opts)?;
        p.lexer.expect(T::TWhile)?;
        let open_paren = p.lexer.loc();
        p.lexer.expect(T::TOpenParen)?;
        let test = p.parse_expr(Level::Lowest)?;
        p.lexer.expect_closing(T::TCloseParen, open_paren)?;

        // This is a weird corner case where automatic semicolon insertion applies
        // even without a newline present
        if p.lexer.token == T::TSemicolon {
            p.lexer.next()?;
        }
        Ok(p.s(S::DoWhile { body, test }, loc))
    }

    #[inline(never)]
    fn t_while(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;

        let open_paren = p.lexer.loc();
        p.lexer.expect(T::TOpenParen)?;
        let test = p.parse_expr(Level::Lowest)?;
        p.lexer.expect_closing(T::TCloseParen, open_paren)?;

        let mut stmt_opts = ParseStatementOptions::default();
        let body = Self::parse_embedded_stmt(p, &mut stmt_opts)?;

        Ok(p.s(S::While { body, test }, loc))
    }

    #[cold]
    #[inline(never)]
    fn t_with(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;
        let open_paren = p.lexer.loc();
        p.lexer.expect(T::TOpenParen)?;
        let test = p.parse_expr(Level::Lowest)?;
        let body_loc = p.lexer.loc();
        p.lexer.expect_closing(T::TCloseParen, open_paren)?;

        // Push a scope so we make sure to prevent any bare identifiers referenced
        // within the body from being renamed. Renaming them might change the
        // semantics of the code.
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::With, body_loc)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = Self::parse_embedded_stmt(p, &mut stmt_opts)?;
        p.pop_scope();

        Ok(p.s(
            S::With {
                body,
                body_loc,
                value: test,
            },
            loc,
        ))
    }

    /// What is neither a clause of a `switch` (`code` 1130) nor a statement of one (1129). `abortParsingListOrMoveToNextToken`,
    /// as far as it goes without knowing which lists are open: what can start no statement is skipped, and the list ends at
    /// anything else. `true`: it ends here, and the token stays.
    #[cold]
    #[inline(never)]
    fn stray_in_switch(p: &mut Self, code: u32) -> Result<bool> {
        match p.lexer.token {
            // `isListTerminator`: every list ends where the file does.
            T::TEndOfFile => return Ok(true),
            // A clause starts with the word, however it is written.
            T::TEscapedKeyword if matches!(p.lexer.identifier, b"case" | b"default") => {
                p.lexer.unescape_keyword();
                return Ok(false);
            }
            _ => {}
        }
        let range = p.lexer.range();
        p.lexer.ts_error(range, code);
        if matches!(
            p.lexer.token,
            // `isListElement`: while recovering, `;` is no statement.
            T::TSemicolon
                | T::TCloseParen
                | T::TCloseBracket
                | T::TComma
                | T::TColon
                | T::TEqualsGreaterThan
                | T::TEquals
                | T::TDot
                | T::TQuestion
                | T::TQuestionDot
                | T::TDotDotDot
        ) {
            p.lexer.next()?;
            return Ok(false);
        }
        Ok(true)
    }

    #[inline(never)]
    fn t_switch(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        p.lexer.next()?;

        p.lexer.expect(T::TOpenParen)?;
        let test = p.parse_expr(Level::Lowest)?;
        p.lexer.expect(T::TCloseParen)?;

        let body_loc = p.lexer.loc();
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, body_loc)?;
        // Wrap the body in an inner closure so `pop_scope` runs once on
        // its `Result`, covering every `?` early-exit as well as explicit returns.
        let result: Result<Stmt> = (|| {
            p.lexer.expect(T::TOpenBrace)?;
            let mut cases = bun_alloc::ArenaVec::<js_ast::Case>::new_in(p.arena);
            let mut found_default = false;
            let mut said_default = false;
            while p.lexer.token != T::TCloseBrace {
                let mut body = StmtList::new_in(p.arena);
                // `value`/`stmt_opts` are reinitialized every iteration before any read, so
                // declare per-iteration.
                let mut value: Option<js_ast::Expr> = None;
                if p.lexer.token == T::TDefault {
                    if found_default {
                        if !p.lexer.tolerant {
                            p.log().add_range_error(
                                Some(p.source),
                                p.lexer.range(),
                                b"Multiple default clauses are not allowed",
                            );
                            return Err(crate::Error::SyntaxError);
                        }
                        // `checkSwitchStatement` objects to the second one, once for each `switch`.
                        if !said_default {
                            said_default = true;
                            let range = p.lexer.range();
                            Self::grammar_error(p, range, 1113);
                        }
                    }

                    found_default = true;
                    p.lexer.next()?;
                    p.lexer.expect(T::TColon)?;
                } else {
                    // `parseCaseBlock`
                    if p.lexer.token != T::TCase && p.lexer.tolerant && !p.lexer.is_log_disabled {
                        if Self::stray_in_switch(p, 1130)? {
                            break;
                        }
                        continue;
                    }
                    p.lexer.expect(T::TCase)?;
                    value = Some(p.parse_expr(Level::Lowest)?);
                    p.lexer.expect(T::TColon)?;
                }

                'case_body: loop {
                    match p.lexer.token {
                        T::TCloseBrace | T::TCase | T::TDefault => {
                            break 'case_body;
                        }
                        // They end the statements of a clause, however they are written.
                        T::TEscapedKeyword
                            if p.lexer.tolerant
                                && !p.lexer.is_log_disabled
                                && matches!(p.lexer.identifier, b"case" | b"default") =>
                        {
                            p.lexer.unescape_keyword();
                        }
                        // `parseCaseClause`, `parseDefaultClause`
                        T::TEndOfFile
                        | T::TCloseParen
                        | T::TCloseBracket
                        | T::TComma
                        | T::TColon
                        | T::TEqualsGreaterThan
                        | T::TEquals
                        | T::TDot
                        | T::TQuestion
                        | T::TQuestionDot
                        | T::TDotDotDot
                            if p.lexer.tolerant && !p.lexer.is_log_disabled =>
                        {
                            if Self::stray_in_switch(p, 1129)? {
                                break 'case_body;
                            }
                        }
                        _ => {
                            let mut stmt_opts = ParseStatementOptions {
                                lexical_decl: LexicalDecl::AllowAll,
                                ..Default::default()
                            };
                            body.push(Self::parse_embedded_stmt(p, &mut stmt_opts)?);
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
                    test,
                    body_loc,
                    cases: bun_ast::StoreSlice::from_bump(cases),
                },
                loc,
            ))
        })();
        p.pop_scope();
        result
    }

    /// The `{` of `parseBlock`. `false`, in tolerant mode only: it is not there. That has been said, the token stays, the
    /// block is empty and no `}` is looked for.
    #[inline]
    fn open_block(p: &mut Self) -> Result<bool> {
        let is_there = p.lexer.token == T::TOpenBrace || !p.lexer.tolerant;
        p.lexer.expect(T::TOpenBrace)?;
        Ok(is_there)
    }

    #[inline(never)]
    fn t_try(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        // `parseStatement` sends `catch` and `finally` here as well: `try` is missed then, and nothing is taken for it.
        p.lexer.expect(T::TTry)?;
        let body_loc = p.lexer.loc();
        let has_block = Self::open_block(p)?;
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        let mut stmt_opts = ParseStatementOptions::default();
        let body = if has_block {
            p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?
        } else {
            StmtList::new_in(p.arena)
        };
        p.pop_scope();
        if has_block {
            p.end_of_block(body_loc)?;
        }

        let mut catch: Option<js_ast::Catch> = None;
        let mut finally: Option<js_ast::Finally> = None;

        if p.lexer.token == T::TCatch {
            let catch_loc = p.lexer.loc();
            let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::CatchBinding, catch_loc)?;
            p.lexer.next()?;
            let mut binding: Option<js_ast::Binding> = None;

            // The catch binding is optional, and can be omitted. `parseCatchClause`: there is one only if there is a `(`.
            if p.lexer.token != T::TOpenBrace
                && (p.lexer.token == T::TOpenParen || !p.lexer.tolerant)
            {
                p.lexer.expect(T::TOpenParen)?;
                // `parseVariableDeclaration`: what is caught is a variable like any other.
                let mut value = p.parse_binding(crate::parser::ParseBindingOptions {
                    private_name_code: 18029,
                    ..Default::default()
                })?;

                // Skip over types
                let has_type = Self::IS_TYPESCRIPT_ENABLED && p.lexer.token == T::TColon;
                if has_type {
                    p.lexer.expect(T::TColon)?;
                    p.mark_type_syntax(value.loc, crate::sema::Mark::Annotation, p.lexer.loc());
                    p.skip_type_script_type(Level::Lowest)?;
                }

                // It may have an initializer, then. `checkCatchClause` objects to it, unless there is a type to look at.
                if p.lexer.token == T::TEquals && p.lexer.tolerant {
                    p.lexer.next()?;
                    let at = p.lexer.range();
                    let _ = p.parse_expr(Level::Comma)?;
                    if !has_type {
                        Self::grammar_error(p, at, 1197);
                    }
                }

                p.lexer.expect(T::TCloseParen)?;

                // Bare identifiers are a special case
                let kind = match value.data {
                    js_ast::b::B::BIdentifier(_) => js_ast::symbol::Kind::CatchIdentifier,
                    _ => js_ast::symbol::Kind::Other,
                };
                p.declare_binding(kind, &mut value, &stmt_opts)?;
                binding = Some(value);
            }

            let catch_body_loc = p.lexer.loc();
            let has_block = Self::open_block(p)?;

            let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, catch_body_loc)?;
            let stmts = if has_block {
                p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?
            } else {
                StmtList::new_in(p.arena)
            };
            p.pop_scope();
            if has_block {
                p.end_of_block(catch_body_loc)?;
            }
            catch = Some(js_ast::Catch {
                loc: catch_loc,
                binding,
                body: bun_ast::StoreSlice::from_bump(stmts),
                body_loc: catch_body_loc,
            });
            p.pop_scope();
        }

        if p.lexer.token == T::TFinally || catch.is_none() {
            let finally_loc = p.lexer.loc();
            let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, finally_loc)?;
            if p.lexer.token != T::TFinally && p.lexer.tolerant && !p.lexer.is_log_disabled {
                // `parseTryStatement`: 'catch' or 'finally' expected, and nothing is taken for it.
                let (before, range) = (p.lexer.prev_error_loc, p.lexer.range());
                p.lexer.ts_error(range, 1472);
                p.lexer.put_up_with(before)?;
            } else {
                p.lexer.expect(T::TFinally)?;
            }
            let finally_body_loc = p.lexer.loc();
            let has_block = Self::open_block(p)?;
            let stmts = if has_block {
                p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?
            } else {
                StmtList::new_in(p.arena)
            };
            if has_block {
                p.end_of_block(finally_body_loc)?;
                p.mark_end(finally_loc, crate::sema::Mark::StatementEnd);
            }
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
                catch,
                finally,
            },
            loc,
        ))
    }

    /// `parseVariableDeclarationList` in the head of a `for`, the lexer past `var`, `let` or `const`: whether the list of
    /// declarations is empty.
    #[cold]
    #[inline(never)]
    fn no_declaration_follows(p: &mut Self) -> bool {
        if p.lexer.is_contextual_keyword(b"of") {
            // `nextIsIdentifierAndCloseParen`: "for (var of x)", where `of` is the keyword of the loop and no variable.
            let old_lexer = p.lexer.snapshot();
            p.lexer.is_log_disabled = true;
            let is_keyword = p.lexer.next().is_ok()
                && p.lexer.token == T::TIdentifier
                && p.lexer.next().is_ok()
                && p.lexer.token == T::TCloseParen;
            p.lexer.restore(&old_lexer);
            return is_keyword;
        }
        // What starts no declaration (`isBindingIdentifierOrPrivateIdentifierOrPattern`) and ends the list (`isListTerminator`).
        match p.lexer.token {
            T::TIdentifier | T::TOpenBrace | T::TOpenBracket | T::TPrivateIdentifier => false,
            T::TIn | T::TSemicolon | T::TEqualsGreaterThan | T::TCloseBrace | T::TEndOfFile => true,
            _ => p.lexer.has_newline_before,
        }
    }

    /// The same, the lexer at the keyword, where it stays.
    #[cold]
    #[inline(never)]
    fn no_declaration_follows_keyword(p: &mut Self) -> bool {
        let old_lexer = p.lexer.snapshot();
        p.lexer.is_log_disabled = true;
        let result = p.lexer.next().is_ok() && Self::no_declaration_follows(p);
        p.lexer.restore(&old_lexer);
        result
    }

    /// The declarations of a list that has none. `checkGrammarVariableDeclarationList` objects where they would start, right
    /// after `keyword`.
    #[cold]
    #[inline(never)]
    fn no_declarations(p: &mut Self, keyword: bun_ast::Range) -> G::DeclList {
        let after = bun_ast::Range {
            loc: keyword.end(),
            len: 0,
        };
        Self::grammar_error(p, after, 1123);
        bun_alloc::AstAlloc::vec()
    }

    #[inline(never)]
    fn t_for(p: &mut Self, _: &mut ParseStatementOptions, loc: bun_ast::Loc) -> Result<Stmt> {
        let _ = p.push_scope_for_parse_pass(js_ast::scope::Kind::Block, loc)?;
        // Wrap the body in an inner closure so `pop_scope` runs once on
        // its `Result`, covering every `?` early-exit as well as explicit returns.
        let result: Result<Stmt> = (|| {
            p.lexer.next()?;

            // "for await (let x of y) {}"
            let mut is_for_await = p.lexer.is_contextual_keyword(b"await");
            let wrote_await = is_for_await;
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
            let mut test: Option<Expr> = None;
            let mut update: Option<Expr> = None;

            // "in" expressions aren't allowed here
            p.allow_in = false;

            let mut bad_let_range: Option<bun_ast::Range> = None;
            if p.lexer.is_contextual_keyword(b"let") {
                bad_let_range = Some(p.lexer.range());
            }

            // "for (async of" is disallowed by the [lookahead != async of] restriction
            // on for-of; "for await (async of" is allowed. Cleared below when the init
            // parses to anything other than a bare identifier (e.g. "async of => {}").
            let mut bad_async_range: Option<bun_ast::Range> = None;
            if !is_for_await
                && p.lexer.is_contextual_keyword(b"async")
                && p.next_token_matches(|p| p.lexer.is_contextual_keyword(b"of"))
            {
                bad_async_range = Some(p.lexer.range());
            }

            // Track the decl slice separately so we can reference it after `decls` is moved into
            // an arena-backed S::Local. The Vec's heap buffer stays put across the move; the
            // arena outlives this fn, so the lifetime-erased view remains valid.
            let mut decls_ptr: bun_ast::StoreSlice<G::Decl> = bun_ast::StoreSlice::EMPTY;
            let init_loc = p.lexer.loc();
            let mut is_var = false;
            // `parseForOrForInOrForOfStatement`: `let` here always starts a list of declarations, be it an empty one.
            let is_empty_let_list = bad_let_range.is_some()
                && p.lexer.tolerant
                && Self::no_declaration_follows_keyword(p);
            match p.lexer.token {
                // for (var )
                T::TVar => {
                    is_var = true;
                    let keyword = p.lexer.range();
                    p.lexer.next()?;
                    let mut stmt_opts = ParseStatementOptions::default();
                    let decls = if p.lexer.tolerant && Self::no_declaration_follows(p) {
                        Self::no_declarations(p, keyword)
                    } else {
                        p.parse_and_declare_decls(js_ast::symbol::Kind::Hoisted, &mut stmt_opts)?
                    };
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
                    let keyword = p.lexer.range();
                    p.lexer.next()?;
                    let mut stmt_opts = ParseStatementOptions::default();
                    let decls = if p.lexer.tolerant && Self::no_declaration_follows(p) {
                        Self::no_declarations(p, keyword)
                    } else {
                        p.parse_and_declare_decls(js_ast::symbol::Kind::Constant, &mut stmt_opts)?
                    };
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
                // for (let in ), for (let;), for (let of x)
                _ if is_empty_let_list => {
                    bad_let_range = None;
                    let keyword = p.lexer.range();
                    p.lexer.next()?;
                    let decls = Self::no_declarations(p, keyword);
                    init_ = Some(p.s(
                        S::Local {
                            kind: js_ast::s::Kind::KLet,
                            decls,
                            ..Default::default()
                        },
                        init_loc,
                    ));
                }
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
                            bad_async_range = None;
                            // Keep the "let"/"using" declarations visible to the for-in/for-of
                            // checks below ("forbid_initializers"), like the "var"/"const" arms.
                            decls_ptr = bun_ast::StoreSlice::new(res.decls.slice());
                            init_ = Some(stmt);
                        }
                        js_ast::StmtOrExpr::Expr(expr) => {
                            if !matches!(expr.data, js_ast::ExprData::EIdentifier(_)) {
                                bad_async_range = None;
                            }
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
            if let Some(init) = &init_ {
                p.mark_end(init.loc, crate::sema::Mark::StatementEnd);
            }

            // `parseForOrForInOrForOfStatement`: after `await`, wherever the loop stands, `of` is expected, and nothing is taken
            // for it. Failing that the loop is what it looks like without.
            if wrote_await
                && !p.lexer.is_contextual_keyword(b"of")
                && p.lexer.tolerant
                && !p.lexer.is_log_disabled
            {
                p.lexer.expected_string(b"\"of\"")?;
                is_for_await = false;
            }

            // Detect for-of loops
            if p.lexer.is_contextual_keyword(b"of") || is_for_await {
                if let Some(r) = bad_let_range {
                    p.log().add_range_error(
                        Some(p.source),
                        r,
                        b"\"let\" must be wrapped in parentheses to be used as an expression here",
                    );
                    return Err(crate::Error::SyntaxError);
                }

                // TypeScript's parser accepts it, and `checkGrammarForInOrForOfStatement` reports it (1106).
                if let Some(r) = bad_async_range
                    && !p.lexer.tolerant
                {
                    let full = bun_ast::Range {
                        loc: r.loc,
                        len: p.lexer.range().end().start - r.loc.start,
                    };
                    p.log().add_range_error(
                        Some(p.source),
                        full,
                        b"For loop initializers cannot start with \"async of\"",
                    );
                    return Err(crate::Error::SyntaxError);
                }

                if is_for_await && !p.lexer.is_contextual_keyword(b"of") {
                    if init_.is_some() {
                        p.lexer.expected_string(b"\"of\"")?;
                    } else {
                        p.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                }

                p.forbid_initializers(decls_ptr.slice(), "of", false)?;
                p.lexer.next()?;
                let value = p.parse_expr(Level::Comma)?;
                p.lexer.expect(T::TCloseParen)?;
                let mut stmt_opts = ParseStatementOptions::default();
                let body = Self::parse_embedded_stmt(p, &mut stmt_opts)?;
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
                let body = Self::parse_embedded_stmt(p, &mut stmt_opts)?;
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
            // `parseForOrForInOrForOfStatement`: no condition is looked for before a `)` either.
            if p.lexer.token != T::TSemicolon
                && !(p.lexer.token == T::TCloseParen && p.lexer.tolerant)
            {
                test = Some(p.parse_expr(Level::Lowest)?);
            }

            p.lexer.expect(T::TSemicolon)?;

            if p.lexer.token != T::TCloseParen {
                update = Some(p.parse_expr(Level::Lowest)?);
            }

            p.lexer.expect(T::TCloseParen)?;
            let mut stmt_opts = ParseStatementOptions::default();
            let body = Self::parse_embedded_stmt(p, &mut stmt_opts)?;
            Ok(p.s(
                S::For {
                    init: init_,
                    test,
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
            return Self::t_throw_before_newline(p, loc);
        }
        let expr = p.parse_expr(Level::Lowest)?;
        if !p.can_parse_semicolon() && p.lexer.tolerant {
            Self::missing_semicolon_after_expr(p, &expr, loc)?;
        } else {
            p.lexer.expect_or_insert_semicolon()?;
        }
        Ok(p.s(S::Throw { value: expr }, loc))
    }

    #[cold]
    #[inline(never)]
    fn t_throw_before_newline(p: &mut Self, loc: bun_ast::Loc) -> Result<Stmt> {
        let after = bun_ast::Loc {
            start: loc.start + 5,
        };
        if p.lexer.tolerant {
            // `parseThrowStatement`: nothing of the next line is taken, and what is thrown is missing. `checkThrowStatement`
            // objects, right after the keyword.
            Self::grammar_error(p, bun_ast::Range { loc: after, len: 0 }, 1142);
            let value = p.new_expr(js_ast::E::Missing {}, after);
            p.lexer.expect_or_insert_semicolon()?;
            return Ok(p.s(S::Throw { value }, loc));
        }
        p.log()
            .add_error(Some(p.source), after, b"Unexpected newline after \"throw\"");
        Err(crate::Error::SyntaxError)
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
        // Wrap the body in an inner closure so `pop_scope` runs once on
        // its `Result`, covering every `?` early-exit.
        let result: Result<Stmt> = (|| {
            p.lexer.next()?;
            let mut stmt_opts = ParseStatementOptions::default();
            let stmts = p.parse_stmts_up_to(T::TCloseBrace, &mut stmt_opts)?;
            let close_brace_loc = p.lexer.loc();
            p.end_of_block(loc)?;
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
        match opts.scope {
            StatementScope::Module => p.esm_export_keyword = p.lexer.range(),
            StatementScope::Namespace => {}
            StatementScope::Nested => {
                // `parseStatement` takes `export` anywhere. The checker reports 1184, 1231, 1233 or 1258.
                if !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }
            }
        }
        p.push_statement_modifier(bun_ast::ts_syntax::Flags::EXPORT, loc);
        p.lexer.next()?;

        if p.lexer.token == T::TAt && p.lexer.tolerant {
            Self::more_decorators(p, opts)?;
        }

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
            // One more modifier, which is objected to as such.
            && !(p.lexer.token == T::TExport && p.lexer.tolerant)
        {
            Self::decorators_without_class(p, opts)?;
        }

        match p.lexer.token {
            T::TClass | T::TConst | T::TFunction | T::TVar | T::TAt => {
                opts.is_export = true;
                p.parse_stmt(opts)
            }

            T::TImport => {
                // "export import foo = bar"
                if Self::IS_TYPESCRIPT_ENABLED
                    && (opts.scope != StatementScope::Nested || p.lexer.tolerant)
                {
                    opts.is_export = true;
                    let mut stmt = p.parse_stmt(opts)?;
                    // `parseDeclarationWorker`: any import may follow `export`. An import declaration is read again from the
                    // modifier on, which `checkImportDeclaration` reports (1191).
                    if p.lexer.tolerant && matches!(stmt.data, js_ast::StmtData::SImport(_)) {
                        stmt.loc = loc;
                    }
                    return Ok(stmt);
                }

                p.lexer.unexpected()?;
                Err(crate::Error::SyntaxError)
            }

            T::TEnum => {
                if !Self::IS_TYPESCRIPT_ENABLED {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }

                opts.is_export = true;
                p.parse_stmt(opts)
            }

            T::TIdentifier => {
                if p.lexer.is_contextual_keyword(b"let") {
                    opts.is_export = true;
                    return p.parse_stmt(opts);
                }

                // "export using x", "export await using x": `checkGrammarModifiers` reports the modifier (1491, 1495).
                if p.lexer.tolerant
                    && (p.lexer.is_contextual_keyword(b"using")
                        || p.lexer.is_contextual_keyword(b"await"))
                    && p.is_start_of_declaration()
                {
                    opts.is_export = true;
                    return p.parse_stmt(opts);
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    if p.lexer.is_contextual_keyword(b"as") {
                        // "export as namespace ns;"
                        p.lexer.next()?;
                        p.lexer.expect_contextual_keyword(b"namespace")?;
                        p.lexer.expect(T::TIdentifier)?;
                        p.lexer.expect_or_insert_semicolon()?;

                        return Ok(p.s(S::TypeScript::default(), loc));
                    }
                }

                if p.lexer.is_contextual_keyword(b"async") {
                    let async_range = p.lexer.range();
                    p.push_statement_modifier(bun_ast::ts_syntax::Flags::ASYNC, async_range.loc);
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
                                // "export type\n{ foo }" and "export type\n* from 'bar'" are fine
                                if p.lexer.has_newline_before
                                    && p.lexer.token != T::TOpenBrace
                                    && p.lexer.token != T::TAsterisk
                                {
                                    p.log().add_error_fmt(
                                        Some(p.source),
                                        type_range.end(),
                                        format_args!("Unexpected newline after \"type\""),
                                    );
                                    return Err(crate::Error::SyntaxError);
                                }
                                let mut skipper = ParseStatementOptions {
                                    scope: opts.scope,
                                    is_export: true,
                                    ..Default::default()
                                };
                                p.skip_type_script_type_stmt(&mut skipper, loc)?;
                                return Ok(p.s(S::TypeScript::default(), loc));
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
                                return p.parse_stmt(opts);
                            }
                        }
                    }

                    // "export public class Foo {}", "export global {}": `parseModifiersEx` takes any modifiers.
                    // `parse_declaration_after_modifiers` reports the misplaced ones.
                    if p.lexer.tolerant
                        && !p.lexer.is_contextual_keyword(b"defer")
                        && p.is_start_of_declaration()
                    {
                        opts.is_export = true;
                        return p.parse_stmt(opts);
                    }
                }

                Self::export_without_declaration(p, loc, previous_export_keyword)
            }

            T::TDefault => {
                if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }

                let default_loc = p.lexer.loc();
                p.push_statement_modifier(bun_ast::ts_syntax::Flags::DEFAULT, default_loc);
                p.lexer.next()?;

                if p.lexer.token == T::TAt && p.lexer.tolerant {
                    Self::more_decorators(p, opts)?;
                }

                // TypeScript decorators only work on class declarations
                // "@decorator export default class Foo {}"
                // "@decorator export default abstract class Foo {}"
                if opts.ts_decorators.is_some()
                    && p.lexer.token != T::TClass
                    && !p.lexer.is_contextual_keyword(b"abstract")
                {
                    Self::decorators_without_class(p, opts)?;
                }

                if p.lexer.is_contextual_keyword(b"async") {
                    let async_range = p.lexer.range();
                    p.lexer.next()?;
                    if p.lexer.token == T::TFunction && !p.lexer.has_newline_before {
                        p.push_statement_modifier(
                            bun_ast::ts_syntax::Flags::ASYNC,
                            async_range.loc,
                        );
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
                                p.create_default_name(default_loc)
                            }
                        } else {
                            p.create_default_name(default_loc)
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

                    let default_name = p.create_default_name(loc);

                    let mut expr =
                        p.parse_async_prefix_expr(async_range, Level::Comma, EFlags::None)?;
                    p.parse_suffix(&mut expr, Level::Comma, None, EFlags::None)?;
                    p.lexer.expect_or_insert_semicolon()?;
                    let value = js_ast::StmtOrExpr::Expr(expr);
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
                            // "interface" turned out not to start an interface
                            // declaration: the nested statement came back as an
                            // expression statement ("export default interface = 2",
                            // "export default interface => 1") or a labeled statement
                            // ("export default interface: 0"). None of these can be a
                            // default export value, so report a syntax error instead of
                            // building an S.ExportDefault that the visit and print
                            // passes don't support.
                            _ => {
                                let r = js_lexer::range_of_identifier(p.source, stmt.loc);
                                p.log().add_range_error_fmt(
                                    Some(p.source),
                                    r,
                                    format_args!(
                                        "Unexpected \"{}\"",
                                        bstr::BStr::new(p.source.text_for_range(r))
                                    ),
                                );
                                return Err(crate::Error::SyntaxError);
                            }
                        }

                        p.create_default_name(default_loc)
                    };
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
                    && !p.lexer.has_newline_before
                    && matches!(expr.data, js_ast::ExprData::EIdentifier(_))
                {
                    p.push_statement_modifier(bun_ast::ts_syntax::Flags::ABSTRACT, expr.loc);
                    let mut stmt_opts = ParseStatementOptions {
                        ts_decorators: opts.ts_decorators.take(),
                        is_name_optional: true,
                        ..Default::default()
                    };
                    // Scopes are pushed in the order of the places they are given, and decorators that come after `default` may
                    // have pushed some.
                    let class_loc = if p.lexer.tolerant { expr.loc } else { loc };
                    let stmt: Stmt = p.parse_class_stmt(class_loc, &mut stmt_opts)?;

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

                        p.create_default_name(default_loc)
                    };
                    return Ok(p.s(
                        S::ExportDefault {
                            default_name,
                            value: js_ast::StmtOrExpr::Stmt(stmt),
                        },
                        loc,
                    ));
                }

                // "@decorator export default abstract = 1"
                // "@decorator export default abstract \n class Foo {}"
                if opts.ts_decorators.is_some() {
                    if is_identifier
                        && name == b"abstract"
                        && p.lexer.has_newline_before
                        && matches!(expr.data, js_ast::ExprData::EIdentifier(_))
                        && !p.lexer.tolerant
                    {
                        let r = js_lexer::range_of_identifier(p.source, expr.loc);
                        p.log()
                            .add_range_error(Some(p.source), r, b"Unexpected \"abstract\"");
                        return Err(crate::Error::SyntaxError);
                    }
                    Self::decorators_without_class(p, opts)?;
                }

                p.lexer.expect_or_insert_semicolon()?;

                // Use the expression name if present, since it's a better name
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
                if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
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
                    namespace_ref = p.store_name_in_ref(name);
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
                    // Sanitize the basename into an identifier and copy into the arena.
                    let name: &'a [u8] = {
                        use std::io::Write as _;
                        let base = fs::PathName::init(path.text).non_unique_name_string_base();
                        let mut buf: Vec<u8> = Vec::new();
                        write!(&mut buf, "{}", bun_core::fmt::fmt_identifier(base))
                            .expect("unreachable");
                        p.arena.alloc_slice_copy(&buf)
                    };
                    namespace_ref = p.store_name_in_ref(name);
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
                if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
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
                            return Ok(p.s(S::TypeScript::default(), loc));
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
                    let namespace_ref = {
                        use std::io::Write as _;
                        let mut buf: Vec<u8> = Vec::new();
                        write!(
                            &mut buf,
                            "import_{}",
                            bun_core::fmt::fmt_identifier(path_name.non_unique_name_string_base())
                        )
                        .expect("unreachable");
                        p.store_name_in_ref(p.arena.alloc_slice_copy(&buf))
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
                        return Ok(p.s(S::TypeScript::default(), loc));
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
                    // `parseExportAssignment`: an assignment expression, which a comma ends.
                    let value = p.parse_expr(if p.lexer.tolerant {
                        Level::Comma
                    } else {
                        Level::Lowest
                    })?;
                    p.lexer.expect_or_insert_semicolon()?;
                    return Ok(p.s(S::ExportEquals { value }, loc));
                }
                p.lexer.unexpected()?;
                Err(crate::Error::SyntaxError)
            }
            // `parseModifiersEx`: `export` is a modifier as often as it is written. `checkGrammarModifiers` objects to the
            // second one and looks no further.
            T::TExport if p.lexer.tolerant && !p.lexer.is_log_disabled => {
                if Self::export_is_modifier(p) {
                    if !opts.is_export {
                        let again = p.lexer.range();
                        Self::grammar_error(p, again, 1030);
                    }
                    opts.is_export = true;
                }
                p.esm_export_keyword = previous_export_keyword;
                p.parse_stmt(opts)
            }
            _ => Self::export_without_declaration(p, loc, previous_export_keyword),
        }
    }

    /// Call at the token after the `export` at `loc` if nothing that can be exported starts there. Ordinary builds fail.
    /// Tolerant mode reports the error, consumes nothing more, and leaves the token to the next statement.
    #[cold]
    #[inline(never)]
    fn export_without_declaration(
        p: &mut Self,
        loc: bun_ast::Loc,
        previous_export_keyword: bun_ast::Range,
    ) -> Result<Stmt> {
        if !p.lexer.tolerant || p.lexer.is_log_disabled {
            p.lexer.unexpected()?;
            return Err(crate::Error::SyntaxError);
        }
        p.esm_export_keyword = previous_export_keyword;
        if p.is_start_of_declaration() {
            // `parseDeclarationWorker`: `export` is a modifier of a MissingDeclaration.
            let at = p.lexer.full_start();
            p.lexer.ts_error(bun_ast::Range { loc: at, len: 0 }, 1146);
        } else {
            // A list of statements has skipped such an `export` already (1128). Where a single statement is parsed,
            // `parseStatement` looks for an expression.
            p.lexer.ts_error(bun_ast::Range { loc, len: 6 }, 1109);
        }
        Ok(Stmt::empty())
    }

    /// `nextTokenCanFollowModifier`, of the `export` the lexer is at: whether it is a modifier of what follows. If not it is
    /// the keyword of `export =`, `export {}`, `export *`, `export as namespace` or `export default` before an expression.
    #[cold]
    #[inline(never)]
    fn export_is_modifier(p: &mut Self) -> bool {
        let old_lexer = p.lexer.snapshot();
        p.lexer.is_log_disabled = true;
        let is_modifier = Self::scan_after_export(p).unwrap_or(false);
        p.lexer.restore(&old_lexer);
        is_modifier
    }

    /// What `export_is_modifier` looks at. The lexer is left wherever that took it.
    fn scan_after_export(p: &mut Self) -> Result<bool> {
        p.lexer.next()?;
        if p.lexer.token == T::TDefault {
            // `nextTokenCanFollowDefaultKeyword`
            p.lexer.next()?;
            if matches!(p.lexer.token, T::TClass | T::TFunction | T::TAt)
                || p.lexer.is_contextual_keyword(b"interface")
            {
                return Ok(true);
            }
            let wanted = if p.lexer.is_contextual_keyword(b"abstract") {
                T::TClass
            } else if p.lexer.is_contextual_keyword(b"async") {
                T::TFunction
            } else {
                return Ok(false);
            };
            p.lexer.next()?;
            return Ok(p.lexer.token == wanted && !p.lexer.has_newline_before);
        }
        if p.lexer.is_contextual_keyword(b"type") {
            p.lexer.next()?;
        }
        // `canFollowExportModifier`
        Ok(p.lexer.token == T::TAt
            || (!p.lexer.is_contextual_keyword(b"as")
                && (p.lexer.is_identifier_or_keyword()
                    || matches!(
                        p.lexer.token,
                        T::TOpenBracket
                            | T::TDotDotDot
                            | T::TStringLiteral
                            | T::TNumericLiteral
                            | T::TBigIntegerLiteral
                    ))))
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
        if (opts.is_export || (opts.scope.is_namespace() && !opts.is_typescript_declare))
            && p.lexer.token != T::TIdentifier
            // `parseImportDeclarationOrImportEqualsDeclaration` takes every form of import after `export` and in a namespace.
            && !p.lexer.tolerant
        {
            p.lexer.expected(T::TIdentifier)?;
        }

        match p.lexer.token {
            // "import('path')"
            // "import.meta"
            // "import<T>": no declaration either (`isStartOfStatement`). `parse_import_expr` says what is wrong with it.
            T::TOpenParen | T::TDot | T::TLessThan
                if p.lexer.token != T::TLessThan || p.lexer.tolerant =>
            {
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
                if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }
                was_originally_bare_import = true;
            }
            T::TAsterisk => {
                // "import * as ns from 'path'"
                if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }

                p.lexer.next()?;
                p.lexer.expect_contextual_keyword(b"as")?;
                stmt = S::Import {
                    namespace_ref: p.store_name_in_ref(p.lexer.identifier),
                    star_name_loc: p.lexer.loc(),
                    import_record_index: u32::MAX,
                    ..Default::default()
                };
                p.lexer.expect(T::TIdentifier)?;
                p.lexer.expect_contextual_keyword(b"from")?;
            }
            T::TOpenBrace => {
                // "import {item1, item2} from 'path'"
                if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }
                let import_clause = p.parse_import_clause()?;
                if Self::IS_TYPESCRIPT_ENABLED {
                    if import_clause.had_type_only_imports && import_clause.items.is_empty() {
                        p.lexer.expect_contextual_keyword(b"from")?;
                        if p.lexer.tolerant && !Self::is_at_string_specifier(p) {
                            return Self::import_with_expression_specifier(p, loc);
                        }
                        let _ = p.parse_path()?;
                        p.lexer.expect_or_insert_semicolon()?;
                        return Ok(p.s(S::TypeScript::default(), loc));
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
                if opts.scope == StatementScope::Nested && !p.lexer.tolerant {
                    p.lexer.unexpected()?;
                    return Err(crate::Error::SyntaxError);
                }

                let default_name = p.lexer.identifier;
                let default_name_raw = p.lexer.raw();
                stmt = S::Import {
                    namespace_ref: Ref::NONE,
                    import_record_index: u32::MAX,
                    default_name: Some(LocRef {
                        loc: p.lexer.loc(),
                        ref_: p.store_name_in_ref(default_name),
                    }),
                    ..Default::default()
                };
                p.lexer.next()?;

                // "import defer * as ns from 'path'"
                //
                // https://tc39.es/proposal-defer-import-eval/
                //
                // `defer` is only a phase keyword when followed by `*`; in
                // every other position (`import defer from 'x'`,
                // `import defer, {x} from 'y'`) it is an ordinary default
                // binding named `defer`. Compare the raw token so
                // `def\u0065r` is not treated as the phase keyword.
                //
                // `opts.is_export` rules out `export import defer * as ...`
                // (only reachable via the TypeScript `export import foo = bar`
                // re-entry) so it falls through to the import-equals handler
                // and errors there.
                if default_name_raw == b"defer"
                    && p.lexer.token == T::TAsterisk
                    && (!opts.is_export || p.lexer.tolerant)
                {
                    // Same scope restriction as `import * as ns from 'path'`:
                    // ESM import declarations are only valid at module scope
                    // (or inside a TypeScript `declare namespace`).
                    if !opts.allows_esm_import_export() && !p.lexer.tolerant {
                        p.lexer.unexpected()?;
                        return Err(crate::Error::SyntaxError);
                    }
                    p.lexer.next()?;
                    p.lexer.expect_contextual_keyword(b"as")?;
                    stmt = S::Import {
                        namespace_ref: p.store_name_in_ref(p.lexer.identifier),
                        star_name_loc: p.lexer.loc(),
                        import_record_index: u32::MAX,
                        phase_defer: true,
                        ..Default::default()
                    };
                    p.lexer.expect(T::TIdentifier)?;
                    p.lexer.expect_contextual_keyword(b"from")?;

                    if p.lexer.tolerant && !Self::is_at_string_specifier(p) {
                        return Self::import_with_expression_specifier(p, loc);
                    }
                    let path = p.parse_path()?;
                    p.lexer.expect_or_insert_semicolon()?;
                    return p.process_import_statement(stmt, path, loc, false);
                }

                if p.lexer.tolerant && default_name_raw == b"defer" && Self::defer_is_modifier(p) {
                    return Self::import_after_defer(p, loc);
                }

                if Self::IS_TYPESCRIPT_ENABLED {
                    // Skip over type-only imports
                    if default_name == b"type" {
                        match p.lexer.token {
                            T::TIdentifier => {
                                // A name of "from" is left to the code below when this is
                                // "import type from 'bar';" (a value import named "type"), or
                                // when only "import foo = bar" is valid here and the guard
                                // below has to reject everything but "import type from = bar".
                                let import_equals_only = (opts.is_export
                                    || (opts.scope.is_namespace() && !opts.is_typescript_declare))
                                    && !p.lexer.tolerant;
                                let leave_from = p.lexer.identifier == b"from"
                                    && p.next_token_matches(|p| {
                                        if import_equals_only {
                                            p.lexer.token != T::TEquals
                                        } else {
                                            matches!(
                                                p.lexer.token,
                                                T::TStringLiteral
                                                    | T::TNoSubstitutionTemplateLiteral
                                            )
                                        }
                                    });
                                if !leave_from {
                                    let name = p.lexer.identifier;
                                    let name_loc = p.lexer.loc();
                                    p.lexer.next()?;

                                    if p.lexer.token == T::TEquals
                                        // `tokenAfterImportedIdentifierDefinitelyProducesImportDeclaration`
                                        || (p.lexer.tolerant
                                            && p.lexer.token != T::TComma
                                            && !p.lexer.is_contextual_keyword(b"from"))
                                    {
                                        // "import type foo = require('bar');" (foo may be "from")
                                        opts.is_typescript_declare = true;
                                        return p.parse_type_script_import_equals_stmt(
                                            loc, opts, name_loc, name,
                                        );
                                    } else {
                                        // "import type foo from 'bar';" (foo may be "from")
                                        let has_bindings =
                                            p.lexer.token == T::TComma && p.lexer.tolerant;
                                        if has_bindings {
                                            Self::bindings_after_type_only_name(p)?;
                                        }
                                        p.lexer.expect_contextual_keyword(b"from")?;
                                        if p.lexer.tolerant && !Self::is_at_string_specifier(p) {
                                            return Self::import_with_expression_specifier(p, loc);
                                        }
                                        if has_bindings && opts.scope.is_module() {
                                            // `checkGrammarImportClause`
                                            let type_keyword = stmt
                                                .default_name
                                                .as_ref()
                                                .map_or(loc, |name| name.loc);
                                            p.lexer.ts_grammar_error(
                                                bun_ast::Range {
                                                    loc: type_keyword,
                                                    len: 4,
                                                },
                                                1363,
                                            );
                                        }
                                        let _ = p.parse_path()?;
                                        p.lexer.expect_or_insert_semicolon()?;
                                        return Ok(p.s(S::TypeScript::default(), loc));
                                    }
                                }
                            }
                            T::TAsterisk => {
                                // "import type * as foo from 'bar';"
                                p.lexer.next()?;
                                p.lexer.expect_contextual_keyword(b"as")?;
                                p.lexer.expect(T::TIdentifier)?;
                                p.lexer.expect_contextual_keyword(b"from")?;
                                if p.lexer.tolerant && !Self::is_at_string_specifier(p) {
                                    return Self::import_with_expression_specifier(p, loc);
                                }
                                let _ = p.parse_path()?;
                                p.lexer.expect_or_insert_semicolon()?;
                                return Ok(p.s(S::TypeScript::default(), loc));
                            }

                            T::TOpenBrace => {
                                // "import type {foo} from 'bar';"
                                let _ = p.parse_import_clause()?;
                                p.lexer.expect_contextual_keyword(b"from")?;
                                if p.lexer.tolerant && !Self::is_at_string_specifier(p) {
                                    return Self::import_with_expression_specifier(p, loc);
                                }
                                let _ = p.parse_path()?;
                                p.lexer.expect_or_insert_semicolon()?;
                                return Ok(p.s(S::TypeScript::default(), loc));
                            }
                            _ => {}
                        }
                    }

                    // Parse TypeScript import assignment statements
                    let is_import_equals = if p.lexer.tolerant {
                        // `tokenAfterImportedIdentifierDefinitelyProducesImportDeclaration`
                        p.lexer.token != T::TComma && !p.lexer.is_contextual_keyword(b"from")
                    } else {
                        p.lexer.token == T::TEquals
                            || opts.is_export
                            || (opts.scope.is_namespace() && !opts.is_typescript_declare)
                    };
                    if is_import_equals {
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
                            stmt.namespace_ref = p.store_name_in_ref(p.lexer.identifier);
                            stmt.star_name_loc = p.lexer.loc();
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
                        // `parseNamedImports`: the "{" is missing, and so is the list.
                        _ if p.lexer.tolerant => p.lexer.expect(T::TOpenBrace)?,
                        _ => {
                            p.lexer.unexpected()?;
                            return Err(crate::Error::SyntaxError);
                        }
                    }
                }

                p.lexer.expect_contextual_keyword(b"from")?;
            }
            // `tryParseImportClause`: a reserved word starts no import clause. It is where the module specifier should be.
            _ if p.lexer.tolerant => {}
            _ => {
                p.lexer.unexpected()?;
                return Err(crate::Error::SyntaxError);
            }
        }

        if p.lexer.tolerant && !Self::is_at_string_specifier(p) {
            return Self::import_with_expression_specifier(p, loc);
        }
        let path = p.parse_path()?;
        p.lexer.expect_or_insert_semicolon()?;

        p.process_import_statement(stmt, path, loc, was_originally_bare_import)
    }

    /// `parseImportClause`, at the "," after `import type name`: the namespace import or the named imports.
    #[cold]
    #[inline(never)]
    fn bindings_after_type_only_name(p: &mut Self) -> Result<()> {
        p.lexer.next()?;
        match p.lexer.token {
            T::TAsterisk => {
                p.lexer.next()?;
                p.lexer.expect_contextual_keyword(b"as")?;
                p.lexer.expect(T::TIdentifier)?;
            }
            T::TOpenBrace => {
                let _ = p.parse_import_clause()?;
            }
            // `parseNamedImports`: the "{" is missing, and so is the list.
            _ => p.lexer.expect(T::TOpenBrace)?,
        }
        Ok(())
    }

    /// Whether `parse_path` can read the module specifier at the current token.
    #[inline]
    fn is_at_string_specifier(p: &Self) -> bool {
        matches!(
            p.lexer.token,
            T::TStringLiteral | T::TNoSubstitutionTemplateLiteral
        )
    }

    /// `parseModuleSpecifier` at a token that is not a string, and the rest of the import declaration. Any expression is taken.
    /// `checkExternalImportOrExportDeclaration` reports 1141 unless the expression is missing, and checks nothing else.
    /// Tolerant mode only.
    #[cold]
    #[inline(never)]
    fn import_with_expression_specifier(p: &mut Self, loc: bun_ast::Loc) -> Result<Stmt> {
        let specifier = p.parse_expr(Level::Lowest)?;
        if !matches!(specifier.data, js_ast::ExprData::EMissing(_)) {
            p.ts_checker_error(specifier.loc, 1141);
            if let Some(syntax) = &mut p.type_syntax {
                syntax.specifier_expressions.push(specifier);
            }
        }
        p.lexer.expect_or_insert_semicolon()?;
        // Read again from the source, which only finds that the file is a module.
        Ok(p.s(S::TypeScript::default(), loc))
    }

    /// `parseImportDeclarationOrImportEqualsDeclaration`, at the token after `import defer`: whether `defer` is a modifier and not
    /// the name of the default import.
    #[cold]
    #[inline(never)]
    fn defer_is_modifier(p: &mut Self) -> bool {
        if p.lexer.is_contextual_keyword(b"from") {
            !p.next_token_matches(|p| p.lexer.token == T::TStringLiteral)
        } else {
            !matches!(p.lexer.token, T::TComma | T::TEquals)
        }
    }

    /// The rest of `parseImportDeclarationOrImportEqualsDeclaration` after a `defer` modifier that is not followed by `*`.
    /// `checkGrammarImportClause` reports a default name (18058) and named imports (18059). Tolerant mode only.
    #[cold]
    #[inline(never)]
    fn import_after_defer(p: &mut Self, loc: bun_ast::Loc) -> Result<Stmt> {
        let mut stmt = S::Import {
            namespace_ref: Ref::NONE,
            import_record_index: u32::MAX,
            ..Default::default()
        };
        let has_default_name = p.lexer.token == T::TIdentifier;
        if has_default_name {
            stmt.default_name = Some(LocRef {
                loc: p.lexer.loc(),
                ref_: p.store_name_in_ref(p.lexer.identifier),
            });
            p.lexer.next()?;
        }
        // `tryParseImportClause`
        let has_clause = has_default_name || p.lexer.token == T::TOpenBrace;
        if has_clause {
            // `parseImportClause`
            if !has_default_name || p.lexer.token == T::TComma {
                if has_default_name {
                    p.lexer.next()?;
                }
                match p.lexer.token {
                    T::TAsterisk => {
                        p.lexer.next()?;
                        p.lexer.expect_contextual_keyword(b"as")?;
                        stmt.namespace_ref = p.store_name_in_ref(p.lexer.identifier);
                        stmt.star_name_loc = p.lexer.loc();
                        p.lexer.expect(T::TIdentifier)?;
                    }
                    T::TOpenBrace => {
                        let import_clause = p.parse_import_clause()?;
                        stmt.items = import_clause.items.into();
                        stmt.is_single_line = import_clause.is_single_line;
                    }
                    // `parseNamedImports`: the "{" is missing, and so is the list.
                    _ => p.lexer.expect(T::TOpenBrace)?,
                }
            }
            p.lexer.expect_contextual_keyword(b"from")?;
        }
        if !Self::is_at_string_specifier(p) {
            return Self::import_with_expression_specifier(p, loc);
        }
        let path = p.parse_path()?;
        p.lexer.expect_or_insert_semicolon()?;
        p.process_import_statement(stmt, path, loc, !has_clause)
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
        // Pop after parsing the labeled body; done explicitly so we can keep
        // `p` exclusively borrowed.

        // Parse a labeled statement
        p.lexer.next()?;

        let _name = LocRef {
            loc: label_loc,
            ref_: label_ref,
        };
        let mut nested_opts = ParseStatementOptions::default();

        match opts.lexical_decl {
            LexicalDecl::AllowAll | LexicalDecl::AllowFnInsideLabel => {
                nested_opts.lexical_decl = LexicalDecl::AllowFnInsideLabel;
            }
            _ => {}
        }
        let stmt_result = Self::parse_embedded_stmt(p, &mut nested_opts);
        p.pop_scope();
        let stmt = stmt_result?;
        Ok(p.s(S::Label { name: _name, stmt }, loc))
    }

    /// `parseStatement`, of a statement that is in no list: the body of an `if`, a loop or a label, what follows a `case`. Its
    /// modifiers are its own.
    #[inline]
    fn parse_embedded_stmt(p: &mut Self, opts: &mut ParseStatementOptions<'a>) -> Result<Stmt> {
        let outer_modifiers_base = p.begin_statement();
        let stmt = p.parse_stmt(opts)?;
        p.end_statement(outer_modifiers_base, stmt.loc);
        Ok(stmt)
    }

    fn parse_stmt_fallthrough(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        let is_identifier = p.lexer.token == T::TIdentifier;
        let name = p.lexer.identifier;
        if p.lexer.tolerant && is_identifier && Self::IS_TYPESCRIPT_ENABLED {
            if let Some(stmt) = Self::parse_declaration_after_modifiers(p, opts)? {
                return Ok(stmt);
            }
        }
        // Parse either an async function, an async expression, or a normal expression.
        // Every branch below either assigns `expr` or `return`s.
        let mut expr: Expr;
        if is_identifier && p.lexer.raw() == b"async" {
            let async_range = p.lexer.range();
            p.lexer.next()?;
            if p.lexer.token == T::TFunction && !p.lexer.has_newline_before {
                p.push_statement_modifier(bun_ast::ts_syntax::Flags::ASYNC, async_range.loc);
                p.lexer.next()?;

                return p.parse_fn_stmt(async_range.loc, opts, Some(async_range));
            }

            expr = p.parse_async_prefix_expr(async_range, Level::Lowest, EFlags::None)?;
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

                if Self::IS_TYPESCRIPT_ENABLED {
                    if let Some(ts_stmt) = js_lexer::TypescriptStmtKeyword::from_bytes(name) {
                        // Hand the cold TS-keyword statement forms (`type`/`interface`/`namespace`/
                        // `module`/`abstract`/`global`/`declare`) to an out-of-line helper so the
                        // common `SExpr` fall-through keeps a small stack frame.
                        if let Some(stmt) =
                            Self::parse_stmt_fallthrough_ts_keyword(p, opts, loc, ts_stmt)?
                        {
                            if p.lexer.tolerant {
                                Self::ts_keyword_was_taken(p, loc, name, ts_stmt);
                            }
                            return Ok(stmt);
                        }
                    }
                }
            }
        }
        // Output.print("\n\nmVALUE {s}:{s}\n", .{ expr, name });
        if !p.can_parse_semicolon() && p.lexer.tolerant {
            Self::missing_semicolon_after_expr(p, &expr, loc)?;
        } else {
            p.lexer.expect_or_insert_semicolon()?;
        }
        Ok(p.s(
            S::SExpr {
                value: expr,
                ..Default::default()
            },
            loc,
        ))
    }

    /// `parseDeclaration`, at a modifier that no statement takes: `public class C {}`, `async enum E {}`, `abstract interface I {}`.
    /// TypeScript's parser accepts any modifiers before a declaration, and `checkGrammarModifiers` reports the first misplaced one.
    /// Returns `None`, with nothing consumed, if no declaration starts here or none of its modifiers has to be dropped.
    #[cold]
    #[inline(never)]
    fn parse_declaration_after_modifiers(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
    ) -> Result<Option<Stmt>> {
        const ACCESSIBILITY: u8 = 1 << 0;
        const STATIC: u8 = 1 << 1;
        const ACCESSOR: u8 = 1 << 2;
        const READONLY: u8 = 1 << 3;
        const ASYNC: u8 = 1 << 4;
        const ABSTRACT: u8 = 1 << 5;
        #[derive(Copy, Clone, PartialEq, Eq)]
        enum Declaration {
            Function,
            Class,
            Enum,
            Variable,
            InterfaceOrTypeAlias,
            /// A namespace, an import or an export. Also whatever follows `export` or `declare`.
            Other,
        }

        if p.lexer.is_log_disabled
            || !matches!(
                p.lexer.raw(),
                b"public"
                    | b"private"
                    | b"protected"
                    | b"static"
                    | b"accessor"
                    | b"readonly"
                    | b"async"
                    | b"abstract"
            )
            || !p.is_start_of_declaration()
        {
            return Ok(None);
        }

        // `parseModifiersEx`. `async function` and `abstract class` are left for `parse_stmt`.
        let mut modifiers: Vec<(u8, bun_ast::Range)> = Vec::new();
        let mut dropped = 0;
        while p.lexer.token == T::TIdentifier {
            use bun_ast::ts_syntax::Flags as Modifier;
            let (flag, taken_by, modifier) = match p.lexer.raw() {
                b"public" => (ACCESSIBILITY, T::TEndOfFile, Modifier::PUBLIC),
                b"private" => (ACCESSIBILITY, T::TEndOfFile, Modifier::PRIVATE),
                b"protected" => (ACCESSIBILITY, T::TEndOfFile, Modifier::PROTECTED),
                b"static" => (STATIC, T::TEndOfFile, Modifier::STATIC),
                b"accessor" => (ACCESSOR, T::TEndOfFile, Modifier::ACCESSOR),
                b"readonly" => (READONLY, T::TEndOfFile, Modifier::READONLY),
                b"async" => (ASYNC, T::TFunction, Modifier::ASYNC),
                b"abstract" => (ABSTRACT, T::TClass, Modifier::ABSTRACT),
                _ => break,
            };
            modifiers.push((flag, p.lexer.range()));
            if p.next_token_matches(|p| p.lexer.token == taken_by && !p.lexer.has_newline_before) {
                break;
            }
            let loc = p.lexer.loc();
            p.push_statement_modifier(modifier, loc);
            p.lexer.next()?;
            dropped += 1;
        }
        if dropped == 0 {
            return Ok(None);
        }

        let token = p.lexer.token;
        let declaration = match token {
            T::TFunction => Declaration::Function,
            T::TClass => Declaration::Class,
            T::TEnum => Declaration::Enum,
            T::TVar => Declaration::Variable,
            T::TConst if p.next_token_matches(|p| p.lexer.token == T::TEnum) => Declaration::Enum,
            T::TConst => Declaration::Variable,
            T::TIdentifier => match p.lexer.raw() {
                b"async" => Declaration::Function,
                b"abstract" => Declaration::Class,
                b"let" | b"using" | b"await" => Declaration::Variable,
                b"interface" | b"type" => Declaration::InterfaceOrTypeAlias,
                _ => Declaration::Other,
            },
            _ => Declaration::Other,
        };
        let is_nested = opts.scope == StatementScope::Nested;
        // `findFirstIllegalModifier`: the only modifier that may come first in a block.
        let allowed_first = match declaration {
            Declaration::Function => ASYNC,
            Declaration::Class => ABSTRACT,
            _ => 0,
        };
        let mut error = None;
        if is_nested && declaration != Declaration::Other && modifiers[0].0 != allowed_first {
            error = Some((modifiers[0].1, 1184));
        } else {
            let mut seen = 0u8;
            let mut last_async = modifiers[0].1;
            for &(flag, range) in &modifiers {
                let code = match flag {
                    ACCESSIBILITY if seen & ACCESSIBILITY != 0 => 1028,
                    ACCESSIBILITY if seen & (STATIC | ACCESSOR | READONLY | ASYNC) != 0 => 1029,
                    STATIC if seen & (ACCESSOR | READONLY | ASYNC) != 0 && seen & STATIC == 0 => {
                        1029
                    }
                    _ if seen & flag != 0 => 1030,
                    ACCESSIBILITY | STATIC if !is_nested => 1044,
                    ACCESSOR if seen & READONLY != 0 => 1243,
                    ACCESSOR => 1275,
                    READONLY => 1024,
                    ABSTRACT if declaration != Declaration::Class => 1242,
                    ASYNC if opts.is_typescript_declare => 1040,
                    ASYNC if seen & ABSTRACT != 0 => 1243,
                    _ => 0,
                };
                if code != 0 {
                    error = Some((range, code));
                    break;
                }
                seen |= flag;
                if flag == ASYNC {
                    last_async = range;
                }
            }
            if error.is_none() {
                let here = p.lexer.range();
                if p.lexer.token == T::TExport
                    && seen & (ASYNC | ABSTRACT) != 0
                    && p.next_token_matches(|p| {
                        matches!(
                            p.lexer.token,
                            T::TClass | T::TFunction | T::TVar | T::TConst | T::TEnum | T::TImport
                        ) || p.lexer.token == T::TIdentifier && p.lexer.raw() != b"as"
                    })
                {
                    error = Some((here, 1029));
                } else if seen & ASYNC != 0 && p.lexer.is_contextual_keyword(b"declare") {
                    error = Some((here, 1040));
                } else if seen & ASYNC != 0 && declaration != Declaration::Function {
                    // `checkGrammarAsyncModifier`
                    error = Some((last_async, 1042));
                }
            }
        }
        if let Some((range, code)) = error {
            p.lexer.ts_grammar_error(range, code);
        }
        let mut stmt = p.parse_stmt(opts)?;
        // `parseFunctionDeclaration`: `modifierListHasAsync`, wherever `async` stands among the modifiers.
        if modifiers.iter().any(|modifier| modifier.0 == ASYNC)
            && let js_ast::StmtData::SFunction(function) = &mut stmt.data
        {
            function.func.flags.insert(js_ast::Flags::Function::IsAsync);
        }
        Ok(Some(stmt))
    }

    /// `parseErrorForMissingSemicolonAfter(expression)`, for the expression of the statement that starts at `loc`.
    #[cold]
    #[inline(never)]
    fn missing_semicolon_after_expr(p: &mut Self, expr: &Expr, loc: bun_ast::Loc) -> Result<()> {
        // `(x)`, `x as T`, `x!` and `x<T>` are only `x` in the tree.
        let key = crate::sema::ExprKey::of(expr);
        let is_wrapped = p.type_syntax.as_ref().is_some_and(|syntax| {
            let mut casts_in_statement = syntax
                .casts
                .iter()
                .rev()
                .take_while(|cast| cast.2 >= loc.start);
            casts_in_statement.any(|cast| cast.0 == key)
        });
        match &expr.data {
            js_ast::ExprData::ETemplate(template)
                if template.tag.is_some() && !is_wrapped && !p.lexer.is_log_disabled =>
            {
                if let Some(backtick) = Self::tagged_template_start(p, template) {
                    let before = p.lexer.prev_error_loc;
                    p.lexer.ts_error(
                        bun_ast::Range {
                            loc: backtick,
                            len: 1,
                        },
                        1443,
                    );
                    p.lexer.put_up_with(before)?;
                    return Ok(());
                }
            }
            js_ast::ExprData::EIdentifier(identifier) if !is_wrapped => {
                let word = p.load_name_from_ref(identifier.ref_);
                return p.missing_semicolon_after(word, expr.loc);
            }
            _ => {}
        }
        p.missing_semicolon_after(b"", expr.loc)
    }

    /// Where the backtick of a tagged template is. The raw text of its head is a slice of the source, unless it contains "\r".
    fn tagged_template_start(p: &Self, template: &js_ast::E::Template) -> Option<bun_ast::Loc> {
        let js_ast::E::TemplateContents::Raw(head) = &template.head else {
            return None;
        };
        let text = p.lexer.contents;
        let offset = head.as_ptr().addr().checked_sub(text.as_ptr().addr())?;
        (1..=text.len())
            .contains(&offset)
            .then(|| bun_ast::usize2loc(offset - 1))
    }

    /// `parseErrorForMissingSemicolonAfter`, for a node that is not a tagged template. Call where no semicolon can be parsed.
    /// `word`: the text of the node if it is an identifier, which starts at `at`, otherwise empty. Consumes nothing.
    #[cold]
    #[inline(never)]
    pub(crate) fn missing_semicolon_after(&mut self, word: &[u8], at: bun_ast::Loc) -> Result<()> {
        let p = self;
        // A speculative parse fails here.
        if word.is_empty() || p.lexer.is_log_disabled {
            p.lexer.expect(T::TSemicolon)?;
            return Ok(());
        }
        let before = p.lexer.prev_error_loc;
        let here = p.lexer.range();
        let name = bun_ast::Range {
            loc: at,
            len: word.len() as i32,
        };
        let token = p.lexer.token;
        let (range, code) = match word {
            b"const" | b"let" | b"var" => (name, 1440),
            b"declare" => return Ok(()),
            // `parseErrorForInvalidName`
            b"interface" => (here, if token == T::TOpenBrace { 1438 } else { 2427 }),
            b"is" => (name, 1228),
            b"module" | b"namespace" => (here, if token == T::TOpenBrace { 1437 } else { 2819 }),
            b"type" => (here, if token == T::TEquals { 1439 } else { 2457 }),
            _ if has_keyword_suggestion(word) => (name, 1435),
            // The scanner has reported the invalid character.
            _ if token == T::TSyntaxError => return Ok(()),
            _ => (name, 1434),
        };
        p.lexer.ts_error(range, code);
        p.lexer.put_up_with(before)?;
        Ok(())
    }

    /// The word at `loc`, which spells `name`, was taken for the keyword of the statement that has just been parsed. `nextToken`
    /// objects to a keyword that is written with an escape. `global` is read as a name (`parseAmbientExternalModuleDeclaration`).
    #[cold]
    #[inline(never)]
    fn ts_keyword_was_taken(
        p: &mut Self,
        loc: bun_ast::Loc,
        name: &[u8],
        ts_stmt: js_lexer::TypescriptStmtKeyword,
    ) {
        if ts_stmt != js_lexer::TypescriptStmtKeyword::TsStmtGlobal
            && !p.source.contents()[loc.start as usize..].starts_with(name)
        {
            // It comes before all that was said of the rest of the statement.
            let last = p.lexer.prev_error_loc;
            p.lexer.ts_error(bun_ast::Range { loc, len: 0 }, 1260);
            p.lexer.prev_error_loc = last;
        }
    }

    /// A reserved word written with an escape, where a statement starts. It is the word it spells, and `nextToken` objects to
    /// the escape when the word is taken.
    #[cold]
    #[inline(never)]
    fn t_escaped_keyword(
        p: &mut Self,
        opts: &mut ParseStatementOptions<'a>,
        loc: bun_ast::Loc,
    ) -> Result<Stmt> {
        if p.lexer.tolerant && !p.lexer.is_log_disabled {
            match js_lexer::keyword(p.lexer.identifier) {
                // Something else is said at these before they are taken: `try` or an expression is missed.
                Some(word @ (T::TCatch | T::TFinally | T::TIn | T::TInstanceof)) => {
                    p.lexer.token = word;
                }
                _ => p.lexer.unescape_keyword(),
            }
            return p.parse_stmt(opts);
        }
        Self::parse_stmt_fallthrough(p, opts, loc)
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
                        scope: opts.scope,
                        ..Default::default()
                    };
                    p.skip_type_script_type_stmt(&mut stmt_opts, loc)?;
                    return Ok(Some(p.s(S::TypeScript::default(), loc)));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtNamespace
            | js_lexer::TypescriptStmtKeyword::TsStmtModule => {
                // "namespace Foo {}"
                // "module Foo {}"
                // "declare module 'fs' {}"
                // "declare module 'fs';"
                // `parseDeclarationWorker` has no regard for where the statement stands: `checkModuleDeclaration` does.
                if !p.lexer.has_newline_before
                    && (opts.scope != StatementScope::Nested || p.lexer.tolerant)
                    && (p.lexer.token == T::TIdentifier
                        || (p.lexer.token == T::TStringLiteral
                            && (opts.is_typescript_declare
                                // `parseModuleDeclaration`: `checkModuleDeclaration` reports the missing `declare` (1035).
                                || (p.lexer.tolerant
                                    && ts_stmt == js_lexer::TypescriptStmtKeyword::TsStmtModule))))
                {
                    return Ok(Some(p.parse_type_script_namespace_stmt(loc, opts)?));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtInterface => {
                // "interface Foo {}"
                // "export default interface Foo {}"
                // "export default interface \n Foo {}"
                if !p.lexer.has_newline_before || opts.is_name_optional {
                    // `scanStartOfDeclaration`: `interface` is a name unless a name follows it on the same line.
                    // After `export default` it is always the keyword (`nextTokenCanFollowDefaultKeyword`).
                    if p.lexer.tolerant && !opts.is_name_optional && !p.is_identifier_in_context() {
                        return Ok(None);
                    }
                    let mut stmt_opts = ParseStatementOptions {
                        scope: opts.scope,
                        ..Default::default()
                    };

                    p.skip_type_script_interface_stmt(&mut stmt_opts, loc)?;
                    return Ok(Some(p.s(S::TypeScript::default(), loc)));
                }
                // "interface \n Foo {}"
                // "export interface \n Foo {}"
                if opts.is_export {
                    let r = js_lexer::range_of_identifier(p.source, loc);
                    p.log()
                        .add_range_error(Some(p.source), r, b"Unexpected \"interface\"");
                    return Err(crate::Error::SyntaxError);
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtAbstract => {
                if !p.lexer.has_newline_before
                    && (p.lexer.token == T::TClass || opts.ts_decorators.is_some())
                {
                    p.push_statement_modifier(bun_ast::ts_syntax::Flags::ABSTRACT, loc);
                    return Ok(Some(p.parse_class_stmt(loc, opts)?));
                }
                if opts.ts_decorators.is_some() {
                    let r = js_lexer::range_of_identifier(p.source, loc);
                    p.log()
                        .add_range_error(Some(p.source), r, b"Unexpected \"abstract\"");
                    return Err(crate::Error::SyntaxError);
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtGlobal => {
                // "declare module 'fs' { global { namespace NodeJS {} } }"
                // `scanStartOfDeclaration`: for TypeScript's parser it is a declaration anywhere, with or without `declare`.
                if (opts.scope.is_namespace() && opts.is_typescript_declare || p.lexer.tolerant)
                    && p.lexer.token == T::TOpenBrace
                {
                    p.lexer.next()?;
                    let scope_index = p.scopes_in_order.len();
                    let mut body_opts = *opts;
                    if p.lexer.tolerant {
                        body_opts.is_typescript_declare = true;
                        body_opts.scope = StatementScope::Namespace;
                    }
                    let _ = p.parse_stmts_up_to(T::TCloseBrace, &mut body_opts)?;
                    p.lexer.expect(T::TCloseBrace)?;
                    if p.lexer.tolerant {
                        // The statements inside are dropped.
                        p.discard_scopes_up_to(scope_index);
                    }
                    return Ok(Some(p.s(S::TypeScript::default(), loc)));
                }
                // `parseAmbientExternalModuleDeclaration`: without a "{" there is no body.
                if p.lexer.tolerant && matches!(p.lexer.token, T::TIdentifier | T::TExport) {
                    p.lexer.expect_or_insert_semicolon()?;
                    return Ok(Some(p.s(S::TypeScript::default(), loc)));
                }
            }
            js_lexer::TypescriptStmtKeyword::TsStmtDeclare => {
                if p.lexer.has_newline_before {
                    if opts.ts_decorators.is_some() {
                        let r = js_lexer::range_of_identifier(p.source, loc);
                        p.log()
                            .add_range_error(Some(p.source), r, b"Unexpected \"declare\"");
                        return Err(crate::Error::SyntaxError);
                    }
                    return Ok(None);
                }
                // `scanStartOfDeclaration`: `declare` is a name unless a declaration follows it. `declare type` always is one.
                if p.lexer.tolerant
                    && opts.ts_decorators.is_none()
                    && !p.lexer.is_contextual_keyword(b"type")
                    && !p.is_start_of_declaration()
                {
                    return Ok(None);
                }
                opts.lexical_decl = LexicalDecl::AllowAll;
                opts.is_typescript_declare = true;
                p.push_statement_modifier(bun_ast::ts_syntax::Flags::AMBIENT, loc);

                // "@decorator declare class Foo {}"
                // "@decorator declare abstract class Foo {}"
                if opts.ts_decorators.is_some()
                    && p.lexer.token != T::TClass
                    && !p.lexer.is_contextual_keyword(b"abstract")
                {
                    Self::decorators_without_class(p, opts)?;
                }

                // "declare global { ... }"
                if p.lexer.is_contextual_keyword(b"global") {
                    p.lexer.next()?;
                    // `parseAmbientExternalModuleDeclaration`: without a "{" there is no body.
                    if p.lexer.token != T::TOpenBrace && p.lexer.tolerant {
                        p.lexer.expect_or_insert_semicolon()?;
                        return Ok(Some(p.s(S::TypeScript::default(), loc)));
                    }
                    p.lexer.expect(T::TOpenBrace)?;
                    let scope_index = p.scopes_in_order.len();
                    let _ = p.parse_stmts_up_to(T::TCloseBrace, opts)?;
                    p.lexer.expect(T::TCloseBrace)?;
                    // The statements inside are dropped, so discard any scopes they
                    // recorded or the visit pass will hit a scope order mismatch.
                    p.discard_scopes_up_to(scope_index);
                    return Ok(Some(p.s(S::TypeScript::default(), loc)));
                }

                // `scanStartOfDeclaration`: `declare type` is an alias, come what may. `parseTypeAliasDeclaration` objects to a
                // line break before the name.
                if p.lexer.tolerant
                    && !p.lexer.is_log_disabled
                    && p.lexer.is_contextual_keyword(b"type")
                {
                    let type_keyword_loc = p.lexer.loc();
                    p.lexer.next()?;
                    if p.lexer.has_newline_before {
                        let range = p.lexer.range();
                        p.lexer.ts_error(range, 1142);
                    }
                    let mut stmt_opts = ParseStatementOptions {
                        scope: opts.scope,
                        ..Default::default()
                    };
                    p.skip_type_script_type_stmt(&mut stmt_opts, type_keyword_loc)?;
                    return Ok(Some(p.s(S::TypeScript::default(), loc)));
                }

                // "declare const x: any"
                let after_declare_range = p.lexer.range();
                let scope_index = p.scopes_in_order.len();
                let stmt = p.parse_stmt(opts)?;
                p.note_ambient_statement(after_declare_range.loc, &stmt);
                // Anything unexpected is a syntax error ("declare foo", "declare type \n Foo").
                // esbuild rewinds its lexer here; we point at the range captured above instead.
                if !matches!(
                    &stmt.data,
                    js_ast::StmtData::STypeScript(_)
                        | js_ast::StmtData::SLocal(_)
                        | js_ast::StmtData::SEmpty(_)
                ) {
                    // `parseDeclarationWorker`: imports and exports take modifiers like any declaration. The checker reports
                    // them (1120, 1193, 1079).
                    if p.lexer.tolerant
                        && matches!(
                            &stmt.data,
                            js_ast::StmtData::SExportEquals(_)
                                | js_ast::StmtData::SExportDefault(_)
                                | js_ast::StmtData::SExportClause(_)
                                | js_ast::StmtData::SExportFrom(_)
                                | js_ast::StmtData::SExportStar(_)
                                | js_ast::StmtData::SImport(_)
                        )
                    {
                        return Ok(Some(stmt));
                    }
                    // An ambient namespace that `parse_type_script_namespace_stmt` kept because it holds real statements. It
                    // starts at `declare`.
                    if p.lexer.tolerant && matches!(&stmt.data, js_ast::StmtData::SNamespace(_)) {
                        return Ok(Some(Stmt {
                            loc,
                            data: stmt.data,
                        }));
                    }
                    p.log().add_range_error_fmt(
                        Some(p.source),
                        after_declare_range,
                        format_args!(
                            "Unexpected {}",
                            bun_core::fmt::quote(p.source.text_for_range(after_declare_range))
                        ),
                    );
                    return Err(crate::Error::SyntaxError);
                }
                if let Some(decs) = &opts.ts_decorators {
                    p.discard_scopes_up_to(decs.scope_index);
                } else {
                    // The statement is dropped below (or reduced to just its bindings
                    // for "export declare var" inside a namespace), so discard any
                    // scopes it recorded or the visit pass will hit a scope order
                    // mismatch (e.g. "declare foo: bar" parses a labeled statement
                    // that records a Label scope).
                    p.discard_scopes_up_to(scope_index);
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
                if opts.scope.is_namespace() && opts.is_export {
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

                return Ok(Some(p.s(S::TypeScript::default(), loc)));
            }
        }
        Ok(None)
    }

    pub(crate) fn parse_stmt(&mut self, opts: &mut ParseStatementOptions<'a>) -> Result<Stmt> {
        if !self.stack_check.is_safe_to_recurse() {
            // Sentinel error; mapped to a "Maximum call stack size exceeded"
            // syntax error at the catch site in parse_entry.rs.
            return Err(crate::Error::StackOverflow);
        }

        let loc = self.lexer.loc();
        let stmt = match self.lexer.token {
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
            T::TCatch | T::TFinally if self.lexer.tolerant => Self::t_try(self, opts, loc),
            T::TEscapedKeyword => Self::t_escaped_keyword(self, opts, loc),

            _ => Self::parse_stmt_fallthrough(self, opts, loc),
        }?;
        if stmt.loc.start > loc.start {
            self.mark_type_syntax(stmt.loc, crate::sema::Mark::DeclarationStart, loc);
        }
        self.mark_end(loc, crate::sema::Mark::StatementEnd);
        Ok(stmt)
    }
}

/// `GetViableKeywordSuggestions`: TypeScript's keywords of more than two letters.
const KEYWORD_SUGGESTIONS: &[&[u8]] = &[
    b"abstract",
    b"accessor",
    b"any",
    b"asserts",
    b"assert",
    b"bigint",
    b"boolean",
    b"break",
    b"case",
    b"catch",
    b"class",
    b"continue",
    b"const",
    b"constructor",
    b"debugger",
    b"declare",
    b"default",
    b"defer",
    b"delete",
    b"else",
    b"enum",
    b"export",
    b"extends",
    b"false",
    b"finally",
    b"for",
    b"from",
    b"function",
    b"get",
    b"immediate",
    b"implements",
    b"import",
    b"infer",
    b"instanceof",
    b"interface",
    b"intrinsic",
    b"keyof",
    b"let",
    b"module",
    b"namespace",
    b"never",
    b"new",
    b"null",
    b"number",
    b"object",
    b"package",
    b"private",
    b"protected",
    b"public",
    b"override",
    b"out",
    b"readonly",
    b"require",
    b"global",
    b"return",
    b"satisfies",
    b"set",
    b"static",
    b"string",
    b"super",
    b"switch",
    b"symbol",
    b"this",
    b"throw",
    b"true",
    b"try",
    b"type",
    b"typeof",
    b"undefined",
    b"unique",
    b"unknown",
    b"using",
    b"var",
    b"void",
    b"while",
    b"with",
    b"yield",
    b"async",
    b"await",
];

/// Whether `parseErrorForMissingSemicolonAfter` finds a keyword to suggest for `word` (`GetSpellingSuggestionForStrings`,
/// `getSpaceSuggestion`).
#[cold]
#[inline(never)]
fn has_keyword_suggestion(word: &[u8]) -> bool {
    // One byte per code point. Keywords are ASCII, so the first byte of a longer code point equals none of their letters.
    let name: Vec<u8> = word
        .iter()
        .copied()
        .filter(|byte| byte & 0xC0 != 0x80)
        .collect();
    let max_length_difference = (name.len() * 34 / 100).max(2);
    // In tenths.
    let max_distance = name.len() * 4 / 10 * 10 + 9;
    KEYWORD_SUGGESTIONS.iter().any(|&keyword| {
        keyword != word
            && name.len().abs_diff(keyword.len()) <= max_length_difference
            && is_within_edit_distance(&name, keyword, max_distance)
    }) || KEYWORD_SUGGESTIONS
        .iter()
        .any(|&keyword| word.len() > keyword.len() + 2 && word.starts_with(keyword))
}

/// `levenshteinWithMax`, in tenths: whether the distance between `s1` and `s2` is at most `max`.
fn is_within_edit_distance(s1: &[u8], s2: &[u8], max: usize) -> bool {
    let big = max + 1;
    let mut previous: Vec<usize> = (0..=s2.len()).map(|j| j * 10).collect();
    let mut current = vec![0usize; s2.len() + 1];
    for i in 1..=s1.len() {
        let c1 = s1[i - 1];
        let min_j = (i * 10).saturating_sub(max).div_ceil(10).max(1);
        let max_j = ((max + i * 10) / 10).min(s2.len());
        let mut column_min = i * 10;
        current[0] = column_min;
        current[1..min_j.min(s2.len() + 1)].fill(big);
        for j in min_j..=max_j {
            let c2 = s2[j - 1];
            let distance = if c1 == c2 {
                previous[j - 1]
            } else {
                let substitution =
                    previous[j - 1] + if c1.eq_ignore_ascii_case(&c2) { 1 } else { 20 };
                (previous[j] + 10)
                    .min(current[j - 1] + 10)
                    .min(substitution)
            };
            current[j] = distance;
            column_min = column_min.min(distance);
        }
        current[max_j + 1..].fill(big);
        if column_min > max {
            return false;
        }
        core::mem::swap(&mut previous, &mut current);
    }
    previous[s2.len()] <= max
}
