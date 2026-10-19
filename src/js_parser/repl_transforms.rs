//! REPL Transform module - transforms code for interactive REPL evaluation
//!
//! This module provides transformations for REPL mode:
//! - Wraps the last expression in { value: expr } for result capture
//! - Hoists declarations for variable persistence across REPL lines
//! - Wraps code with await or an import in an async IIFE, and strict code or code
//!   with a top-level return in a sync one. Other code stays the statements of a script.

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_collections::VecExt;

use bun_ast as js_ast;
use bun_ast::flags;
use bun_ast::stmt::Data as StmtData;
use bun_ast::symbol::Kind as SymbolKind;
use bun_ast::{B, Binding, E, Expr, ExprNodeList, G, S, Scope, Stmt};

use crate::p::P;
use crate::parser::RefMap;

/// The function that the statements of a REPL input run in.
#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplWrapper {
    /// No function: the statements are the script. The engine then gives a direct `eval` the
    /// global scope to declare in, and a function in a block its `var` (Annex B.3.3).
    None,
    /// `(() => { ... })()`. A `return` needs a function. A strict input needs one to hold
    /// its directive: the hoisted `var`s must stay sloppy code, because a strict script
    /// that runs through an indirect `eval` keeps what it declares to itself.
    Arrow,
    /// `(async () => { ... })()`, for top-level await and imports.
    AsyncArrow,
}

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    /// Apply REPL-mode transforms to the AST.
    /// This transforms code for interactive evaluation:
    /// - Wraps the last expression in { value: expr } for result capture
    /// - Hoists declarations out of the IIFE that wraps some inputs (see `ReplWrapper`)
    pub(crate) fn apply_repl_transforms<'bump>(
        &mut self,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        bump: &'bump Bump,
    ) -> Result<(), bun_alloc::AllocError> {
        // Collect all statements
        let mut total_stmts_count: usize = 0;
        for part in parts.iter() {
            total_stmts_count += part.stmts.len();
        }

        let is_strict =
            self.module_scope().strict_mode == js_ast::StrictModeKind::ExplicitStrictMode;

        // A prologue "use strict" was consumed into module-scope strict mode and dropped, but
        // node's repl still evaluates the directive as a string expression. Reinject it at the
        // front, like the CJS wrapper's preserve_strict_mode.
        let reinject_strict = is_strict
            && !(!parts.is_empty()
                && !parts[0].stmts.is_empty()
                && matches!(parts[0].stmts[0].data, StmtData::SDirective(_)));
        total_stmts_count += usize::from(reinject_strict);

        if total_stmts_count == 0 {
            return Ok(());
        }

        // Collect all statements into a single array
        let mut all_stmts = BumpVec::with_capacity_in(total_stmts_count, bump);
        if reinject_strict {
            all_stmts.push(self.s(
                S::Directive {
                    value: b"use strict".into(),
                },
                self.module_scope_directive_loc,
            ));
        }
        for part in parts.iter() {
            for stmt in part.stmts.iter() {
                all_stmts.push(*stmt);
            }
        }
        let all_stmts: &mut [Stmt] = all_stmts.into_bump_slice_mut();

        // Check if there's top-level await or imports (imports become dynamic awaited imports)
        let mut has_top_level_await = self.top_level_await_keyword.len > 0;
        if !has_top_level_await {
            for stmt in all_stmts.iter() {
                if matches!(stmt.data, StmtData::SImport(_)) {
                    has_top_level_await = true;
                    break;
                }
            }
        }

        let mut has_block_fn = false;
        let mut statements = ReplStatements {
            stack_check: self.stack_check,
            each_list: &mut |list| {
                has_block_fn =
                    has_block_fn || list.slice().iter().any(|stmt| self.repl_is_block_fn(stmt));
            },
            has_return: false,
        };
        for stmt in all_stmts.iter() {
            statements.stmt(*stmt);
        }
        let has_return = statements.has_return;

        let wrapper = if has_top_level_await {
            ReplWrapper::AsyncArrow
        } else if is_strict || has_return {
            ReplWrapper::Arrow
        } else {
            ReplWrapper::None
        };

        // Strict code has no Annex B: there a function in a block stays in its block.
        let place_block_fns = has_block_fn && !is_strict;

        self.repl_transform_with_hoisting(parts, all_stmts, bump, wrapper, place_block_fns)
    }

    /// Transform code with hoisting and the IIFE wrapper that `wrapper` names.
    /// `place_block_fns`: the input has a function in a block that can be a `var` of the input.
    fn repl_transform_with_hoisting<'bump>(
        &mut self,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        all_stmts: &[Stmt],
        bump: &'bump Bump,
        wrapper: ReplWrapper,
        place_block_fns: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        if all_stmts.is_empty() {
            return Ok(());
        }

        // Lists for hoisted declarations and inner statements
        let mut hoisted_stmts = BumpVec::<Stmt>::with_capacity_in(all_stmts.len(), bump);
        let mut inner_stmts = BumpVec::<Stmt>::with_capacity_in(all_stmts.len(), bump);

        let block_fn_vars = if place_block_fns {
            self.repl_block_fn_vars()
        } else {
            RefMap::default()
        };

        // Process each statement - hoist all declarations for REPL persistence
        for stmt in all_stmts.iter() {
            match stmt.data {
                StmtData::SLocal(local) => {
                    // Hoist all declarations as var so they become context properties
                    // In sloppy mode, var at top level becomes a property of the global/context object
                    // This is essential for REPL variable persistence across vm.runInContext calls
                    let kind = S::Kind::KVar;

                    // Extract individual identifiers from binding patterns for hoisting
                    let mut hoisted_decl_list = BumpVec::<G::Decl>::new_in(bump);
                    for decl in local.decls.slice() {
                        self.repl_extract_identifiers_from_binding(
                            decl.binding,
                            &mut hoisted_decl_list,
                        )?;
                    }

                    if !hoisted_decl_list.is_empty() {
                        let decls = G::DeclList::from_bump_vec(hoisted_decl_list);
                        hoisted_stmts.push(self.s(
                            S::Local {
                                kind,
                                decls,
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    }

                    // Create assignment expressions for the inner statements
                    for decl in local.decls.slice() {
                        if let Some(value) = decl.value {
                            // Create assignment expression: binding = value
                            let assign_expr =
                                self.repl_create_binding_assignment(decl.binding, value, bump);
                            inner_stmts.push(self.s(
                                S::SExpr {
                                    value: assign_expr,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                        }
                    }
                }
                StmtData::SFunction(func) => {
                    // For function declarations in a wrapper:
                    // Hoist as: var funcName;
                    // Inner: this.funcName = funcName; function funcName() {}
                    // With no wrapper the declaration is already one of the script.
                    if wrapper != ReplWrapper::None
                        && let Some(name) = func.func.name
                    {
                        let copy_out =
                            self.repl_persist_fn_name(name, stmt.loc, &mut hoisted_stmts, bump);
                        inner_stmts.push(copy_out);
                    }
                    // Add the function declaration itself
                    inner_stmts.push(*stmt);
                }
                StmtData::SClass(mut class) => {
                    // For class declarations:
                    // Hoist as: var ClassName; (use var so it persists to vm context)
                    // Inner: ClassName = class ClassName {}
                    if let Some(name_loc) = class.class.class_name {
                        let name_ref = name_loc.ref_;
                        hoisted_stmts.push(self.s(
                            S::Local {
                                kind: S::Kind::KVar,
                                decls: repl_one_decl(
                                    bump,
                                    Binding::alloc(
                                        bump,
                                        B::Identifier { r#ref: name_ref },
                                        name_loc.loc,
                                    ),
                                ),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));

                        // Convert class declaration to assignment: ClassName = class ClassName {}
                        // G::Class is non-Copy (owns a Vec); the original
                        // S::Class store entry is dead after this rewrite, so move it out.
                        let class_value = core::mem::take(&mut class.class);
                        let class_expr = self.new_expr(class_value, stmt.loc);
                        let class_id = self.new_expr(
                            E::Identifier {
                                ref_: name_ref,
                                ..Default::default()
                            },
                            name_loc.loc,
                        );
                        let assign = self.new_expr(
                            E::Binary {
                                op: js_ast::OpCode::BinAssign,
                                left: class_id,
                                right: class_expr,
                            },
                            stmt.loc,
                        );
                        inner_stmts.push(self.s(
                            S::SExpr {
                                value: assign,
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    } else {
                        inner_stmts.push(*stmt);
                    }
                }
                StmtData::SImport(import_data) => {
                    // Convert static imports to dynamic imports for REPL evaluation:
                    //   import X from 'mod'      -> var X = (await import('mod')).default
                    //   import { a, b } from 'mod' -> var {a, b} = await import('mod')
                    //   import * as X from 'mod'   -> var X = await import('mod')
                    //   import 'mod'              -> await import('mod')
                    let path_str: &'static [u8] = self.import_records.items()
                        [import_data.import_record_index as usize]
                        .path
                        .text;
                    let str_expr = self.new_expr(
                        E::String {
                            data: path_str.into(),
                            ..Default::default()
                        },
                        stmt.loc,
                    );
                    let import_expr = self.new_expr(
                        E::Import {
                            expr: str_expr,
                            options: Expr::EMPTY,
                            import_record_index: u32::MAX,
                            namespace_ref: bun_ast::Ref::NONE,
                        },
                        stmt.loc,
                    );
                    let await_expr = self.new_expr(E::Await { value: import_expr }, stmt.loc);

                    // `items` is an arena-owned `StoreSlice<ClauseItem>` valid for 'a.
                    let import_items: &[bun_ast::ClauseItem] = import_data.items.slice();

                    if !import_data.star_name_loc.is_empty() {
                        // import * as X from 'mod' -> var X = await import('mod')
                        hoisted_stmts.push(self.s(
                            S::Local {
                                kind: S::Kind::KVar,
                                decls: repl_one_decl(
                                    bump,
                                    Binding::alloc(
                                        bump,
                                        B::Identifier {
                                            r#ref: import_data.namespace_ref,
                                        },
                                        stmt.loc,
                                    ),
                                ),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                        let left = self.new_expr(
                            E::Identifier {
                                ref_: import_data.namespace_ref,
                                ..Default::default()
                            },
                            stmt.loc,
                        );
                        let assign = self.new_expr(
                            E::Binary {
                                op: js_ast::OpCode::BinAssign,
                                left,
                                right: await_expr,
                            },
                            stmt.loc,
                        );
                        inner_stmts.push(self.s(
                            S::SExpr {
                                value: assign,
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    } else if let Some(default_name) = import_data.default_name {
                        // import X from 'mod' -> var X = (await import('mod')).default
                        // import X, { a } from 'mod' -> var __ns = await import('mod'); var X = __ns.default; var a = __ns.a;
                        let default_ref = default_name.ref_;
                        hoisted_stmts.push(self.s(
                            S::Local {
                                kind: S::Kind::KVar,
                                decls: repl_one_decl(
                                    bump,
                                    Binding::alloc(
                                        bump,
                                        B::Identifier { r#ref: default_ref },
                                        default_name.loc,
                                    ),
                                ),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));

                        if !import_items.is_empty() {
                            // Share a single await import() between default and named imports.
                            // namespace_ref is synthesized by processImportStatement for all non-star imports.
                            self.repl_convert_named_imports(
                                &*import_data,
                                import_items,
                                await_expr,
                                &mut hoisted_stmts,
                                &mut inner_stmts,
                                bump,
                                stmt.loc,
                            )?;
                            let ns_ref_expr = self.new_expr(
                                E::Identifier {
                                    ref_: import_data.namespace_ref,
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                            let dot_default = self.new_expr(
                                E::Dot {
                                    target: ns_ref_expr,
                                    name: b"default".into(),
                                    name_loc: stmt.loc,
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                            let left = self.new_expr(
                                E::Identifier {
                                    ref_: default_ref,
                                    ..Default::default()
                                },
                                default_name.loc,
                            );
                            let assign = self.new_expr(
                                E::Binary {
                                    op: js_ast::OpCode::BinAssign,
                                    left,
                                    right: dot_default,
                                },
                                stmt.loc,
                            );
                            inner_stmts.push(self.s(
                                S::SExpr {
                                    value: assign,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                        } else {
                            let dot_default = self.new_expr(
                                E::Dot {
                                    target: await_expr,
                                    name: b"default".into(),
                                    name_loc: stmt.loc,
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                            let left = self.new_expr(
                                E::Identifier {
                                    ref_: default_ref,
                                    ..Default::default()
                                },
                                default_name.loc,
                            );
                            let assign = self.new_expr(
                                E::Binary {
                                    op: js_ast::OpCode::BinAssign,
                                    left,
                                    right: dot_default,
                                },
                                stmt.loc,
                            );
                            inner_stmts.push(self.s(
                                S::SExpr {
                                    value: assign,
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                        }
                    } else if !import_items.is_empty() {
                        // import { a, b } from 'mod' -> destructure from await import('mod')
                        self.repl_convert_named_imports(
                            &*import_data,
                            import_items,
                            await_expr,
                            &mut hoisted_stmts,
                            &mut inner_stmts,
                            bump,
                            stmt.loc,
                        )?;
                    } else {
                        // import 'mod' (side-effect only) -> await import('mod')
                        inner_stmts.push(self.s(
                            S::SExpr {
                                value: await_expr,
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    }
                }
                StmtData::SDirective(directive) => {
                    // In REPL mode, treat directives (string literals) as expressions.
                    let value_str: &'static [u8] = directive.value.slice();
                    let str_expr = self.new_expr(
                        E::String {
                            data: value_str.into(),
                            ..Default::default()
                        },
                        stmt.loc,
                    );
                    inner_stmts.push(self.s(
                        S::SExpr {
                            value: str_expr,
                            ..Default::default()
                        },
                        stmt.loc,
                    ));
                }
                _ => {
                    if place_block_fns {
                        ReplStatements {
                            stack_check: self.stack_check,
                            each_list: &mut |list| {
                                self.repl_place_block_fns(
                                    list,
                                    wrapper,
                                    &block_fn_vars,
                                    &mut hoisted_stmts,
                                    bump,
                                )
                            },
                            has_return: false,
                        }
                        .stmt(*stmt);
                    }
                    inner_stmts.push(*stmt);
                }
            }
        }

        // Make the last expression the value of the input: { value: expr }
        self.repl_wrap_last_expression(&mut inner_stmts, wrapper, bump);

        // Final output: hoisted declarations, then the statements or the IIFE call
        let mut final_stmts = hoisted_stmts;
        if wrapper == ReplWrapper::None {
            final_stmts.extend_from_slice(&inner_stmts);
        } else {
            // Create the IIFE: (() => { ...inner_stmts... })() or (async () => { ... })()
            let inner_slice: &mut [Stmt] = inner_stmts.into_bump_slice_mut();
            let arrow = self.new_expr(
                E::Arrow {
                    body: G::FnBody {
                        loc: bun_ast::Loc::EMPTY,
                        stmts: bun_ast::StoreSlice::new_mut(inner_slice),
                    },
                    is_async: wrapper == ReplWrapper::AsyncArrow,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );

            let iife = self.new_expr(
                E::Call {
                    target: arrow,
                    args: bun_alloc::AstAlloc::vec(),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            );

            final_stmts.push(self.s(
                S::SExpr {
                    value: iife,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            ));
        }
        let final_slice: &mut [Stmt] = final_stmts.into_bump_slice_mut();

        // Update parts. Input consisting solely of a consumed "use strict"
        // prologue arrives with no parts at all — create one so the
        // reinjected directive's IIFE isn't dropped.
        if parts.is_empty() {
            parts.push(js_ast::Part {
                stmts: bun_ast::StoreSlice::new_mut(final_slice),
                ..Default::default()
            });
        } else {
            parts[0].stmts = bun_ast::StoreSlice::new_mut(final_slice);
            parts.truncate(1);
        }

        Ok(())
    }

    /// Convert named imports to individual var assignments from the dynamic import
    /// import { a, b as c } from 'mod' ->
    ///   var a; var c;  (hoisted)
    ///   var __mod = await import('mod'); a = __mod.a; c = __mod.b;  (inner)
    #[allow(clippy::too_many_arguments)]
    fn repl_convert_named_imports<'bump>(
        &mut self,
        import_data: &S::Import,
        import_items: &[bun_ast::ClauseItem],
        await_expr: Expr,
        hoisted_stmts: &mut BumpVec<'bump, Stmt>,
        inner_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
        loc: bun_ast::Loc,
    ) -> Result<(), bun_alloc::AllocError> {
        // Store the module in the namespace ref: var __ns = await import('mod')
        hoisted_stmts.push(self.s(
            S::Local {
                kind: S::Kind::KVar,
                decls: repl_one_decl(
                    bump,
                    Binding::alloc(
                        bump,
                        B::Identifier {
                            r#ref: import_data.namespace_ref,
                        },
                        loc,
                    ),
                ),
                ..Default::default()
            },
            loc,
        ));
        let left = self.new_expr(
            E::Identifier {
                ref_: import_data.namespace_ref,
                ..Default::default()
            },
            loc,
        );
        let ns_assign = self.new_expr(
            E::Binary {
                op: js_ast::OpCode::BinAssign,
                left,
                right: await_expr,
            },
            loc,
        );
        inner_stmts.push(self.s(
            S::SExpr {
                value: ns_assign,
                ..Default::default()
            },
            loc,
        ));

        // For each named import: var name; name = __ns.originalName;
        for item in import_items.iter() {
            let item_ref = item.name.ref_;
            hoisted_stmts.push(self.s(
                S::Local {
                    kind: S::Kind::KVar,
                    decls: repl_one_decl(
                        bump,
                        Binding::alloc(bump, B::Identifier { r#ref: item_ref }, item.name.loc),
                    ),
                    ..Default::default()
                },
                loc,
            ));
            let ns_ref_expr = self.new_expr(
                E::Identifier {
                    ref_: import_data.namespace_ref,
                    ..Default::default()
                },
                loc,
            );
            // `alias` is an arena-owned `StoreStr` valid for 'a.
            let alias_str: &'static [u8] = item.alias.slice();
            let prop_access = self.new_expr(
                E::Dot {
                    target: ns_ref_expr,
                    name: alias_str.into(),
                    name_loc: item.name.loc,
                    ..Default::default()
                },
                loc,
            );
            let left = self.new_expr(
                E::Identifier {
                    ref_: item_ref,
                    ..Default::default()
                },
                item.name.loc,
            );
            let item_assign = self.new_expr(
                E::Binary {
                    op: js_ast::OpCode::BinAssign,
                    left,
                    right: prop_access,
                },
                loc,
            );
            inner_stmts.push(self.s(
                S::SExpr {
                    value: item_assign,
                    ..Default::default()
                },
                loc,
            ));
        }

        Ok(())
    }

    /// Make the input evaluate to { value: expr } when its last statement is an expression:
    /// `return { value: expr }` in a wrapper, `void 0, { value: expr }` without one.
    fn repl_wrap_last_expression<'bump>(
        &mut self,
        inner_stmts: &mut BumpVec<'bump, Stmt>,
        wrapper: ReplWrapper,
        bump: &'bump Bump,
    ) {
        let mut last_idx: usize = inner_stmts.len();
        while last_idx > 0 {
            last_idx -= 1;
            let last_stmt = inner_stmts[last_idx];
            match last_stmt.data {
                StmtData::SEmpty(_) | StmtData::SComment(_) => continue,
                StmtData::SExpr(expr_data) => {
                    let wrapped = self.repl_wrap_expr_in_value_object(expr_data.value, bump);
                    inner_stmts[last_idx] = if wrapper == ReplWrapper::None {
                        // An object literal that starts a statement needs parentheses.
                        // After `void 0,` it needs none.
                        let value = self.repl_void_0(last_stmt.loc).join_with_comma(wrapped);
                        self.s(
                            S::SExpr {
                                value,
                                ..Default::default()
                            },
                            last_stmt.loc,
                        )
                    } else {
                        self.s(
                            S::Return {
                                value: Some(wrapped),
                            },
                            last_stmt.loc,
                        )
                    };
                    return;
                }
                _ => break,
            }
        }

        if wrapper == ReplWrapper::None {
            // A script evaluates to the value of its last statement that has one, which
            // can be any earlier statement. Only { value: expr } may be the value of an input.
            let value = self.repl_void_0(bun_ast::Loc::EMPTY);
            inner_stmts.push(self.s(
                S::SExpr {
                    value,
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            ));
        }
    }

    fn repl_void_0(&mut self, loc: bun_ast::Loc) -> Expr {
        let zero = self.new_expr(E::Number::new(0.0), loc);
        self.new_expr(
            E::Unary {
                op: js_ast::OpCode::UnVoid,
                value: zero,
                flags: E::UnaryFlags::default(),
            },
            loc,
        )
    }

    /// A function declared inside the wrapper is a local of the wrapper. Declares
    /// `var NAME;` outside of it and returns `this.NAME = NAME;`, which copies the function out.
    fn repl_persist_fn_name<'bump>(
        &mut self,
        name: js_ast::LocRef,
        loc: bun_ast::Loc,
        hoisted_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
    ) -> Stmt {
        hoisted_stmts.push(self.s(
            S::Local {
                kind: S::Kind::KVar,
                decls: repl_one_decl(
                    bump,
                    Binding::alloc(bump, B::Identifier { r#ref: name.ref_ }, name.loc),
                ),
                ..Default::default()
            },
            loc,
        ));

        let this_expr = self.new_expr(E::This {}, loc);
        // `original_name` is an arena-owned `StoreStr` valid for 'a; `.slice()`
        // detaches the borrow from `self.symbols` so the &mut self calls below
        // don't conflict.
        let name_str: &[u8] = self.symbols[name.ref_.inner_index() as usize]
            .original_name
            .slice();
        let this_dot = self.new_expr(
            E::Dot {
                target: this_expr,
                name: name_str.into(),
                name_loc: name.loc,
                ..Default::default()
            },
            loc,
        );
        let func_id = self.new_expr(
            E::Identifier {
                ref_: name.ref_,
                ..Default::default()
            },
            name.loc,
        );
        let assign = self.new_expr(
            E::Binary {
                op: js_ast::OpCode::BinAssign,
                left: this_dot,
                right: func_id,
            },
            loc,
        );
        self.s(
            S::SExpr {
                value: assign,
                ..Default::default()
            },
            loc,
        )
    }

    /// `visit_stmts` moves the plain functions of a block to its head: as one
    /// `let NAME = function() {}`, or as the declarations if the block has a direct `eval`.
    fn repl_is_block_fn(&self, stmt: &Stmt) -> bool {
        let name = match stmt.data {
            StmtData::SFunction(func) => func.func.name.map(|name| name.ref_),
            StmtData::SLocal(local) if local.kind == S::Kind::KLet => {
                match local.decls.slice().first().map(|decl| decl.binding.data) {
                    Some(B::B::BIdentifier(ident)) => Some(ident.r#ref),
                    _ => None,
                }
            }
            _ => None,
        };
        name.is_some_and(|name| {
            self.symbols[name.inner_index() as usize].kind == SymbolKind::HoistedFunction
        })
    }

    /// Gives the functions that `visit_stmts` moved to the head of `list` their `var`, at the
    /// place of each declaration: that is where Annex B.3.3 copies the function to it.
    /// With no wrapper the declaration goes back there and the engine does the rest.
    /// In a wrapper `this.NAME = NAME;` goes there.
    fn repl_place_block_fns<'bump>(
        &mut self,
        list: &mut js_ast::StmtNodeList,
        wrapper: ReplWrapper,
        vars: &RefMap,
        hoisted_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
    ) {
        let stmts = list.slice();
        if !stmts.iter().any(|stmt| self.repl_is_block_fn(stmt)) {
            return;
        }

        // `placed` is what goes to the place of a declaration. Each statement in it has
        // the `loc` of its declaration, and they are in the order of the source.
        let mut placed = BumpVec::<Stmt>::new_in(bump);
        let place = |placed: &mut BumpVec<'bump, Stmt>, stmt: Stmt| {
            let after = placed
                .iter()
                .rposition(|before| before.loc.start <= stmt.loc.start);
            placed.insert(after.map_or(0, |index| index + 1), stmt);
        };

        // The statements that stay at the head of the block come first.
        let mut out = BumpVec::<Stmt>::with_capacity_in(stmts.len() + 1, bump);
        for stmt in stmts {
            match stmt.data {
                _ if !self.repl_is_block_fn(stmt) => {}
                StmtData::SFunction(_) if wrapper == ReplWrapper::None => place(&mut placed, *stmt),
                StmtData::SFunction(func) => {
                    out.push(*stmt);
                    if let Some(name) = func.func.name
                        && vars.contains_key(&name.ref_)
                    {
                        let copy_out =
                            self.repl_persist_fn_name(name, stmt.loc, hoisted_stmts, bump);
                        place(&mut placed, copy_out);
                    }
                }
                StmtData::SLocal(local) => {
                    let mut lets = BumpVec::<G::Decl>::new_in(bump);
                    for decl in local.decls.slice() {
                        let (B::B::BIdentifier(ident), Some(value)) =
                            (decl.binding.data, decl.value)
                        else {
                            lets.push(*decl);
                            continue;
                        };
                        let name = js_ast::LocRef {
                            loc: decl.binding.loc,
                            ref_: ident.r#ref,
                        };
                        if !vars.contains_key(&name.ref_) {
                            lets.push(*decl);
                            continue;
                        }
                        match value.data {
                            js_ast::ExprData::EFunction(mut function)
                                if wrapper == ReplWrapper::None =>
                            {
                                // This `let` is dead after the rewrite, so move the function out.
                                let mut func = core::mem::take(&mut function.func);
                                func.name = Some(name);
                                place(&mut placed, self.s(S::Function { func }, value.loc));
                            }
                            _ => {
                                lets.push(*decl);
                                let copy_out =
                                    self.repl_persist_fn_name(name, value.loc, hoisted_stmts, bump);
                                place(&mut placed, copy_out);
                            }
                        }
                    }
                    if lets.len() == local.decls.len() {
                        out.push(*stmt);
                    } else if !lets.is_empty() {
                        out.push(self.s(
                            S::Local {
                                kind: S::Kind::KLet,
                                decls: G::DeclList::from_bump_vec(lets),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    }
                }
                _ => {}
            }
        }

        // Then the other statements, each one after what was declared before it.
        let mut placed = placed.iter().peekable();
        for stmt in stmts {
            if self.repl_is_block_fn(stmt) {
                continue;
            }
            while let Some(before) = placed.next_if(|placed| placed.loc.start < stmt.loc.start) {
                out.push(*before);
            }
            out.push(*stmt);
        }
        out.extend(placed.copied());

        *list = js_ast::StoreSlice::from_bump(out);
    }

    /// Annex B.3.3: in sloppy code a plain function in a block is also a `var` of the
    /// enclosing function or script, unless a lexical binding of its name is in the way.
    /// `hoist_symbols` decides that only for code it takes as sloppy, and an `await` or an
    /// `import` makes the input a module there. So this reads the scopes itself: it gives
    /// the functions in blocks, outside of every function, that are also a `var`.
    fn repl_block_fn_vars(&self) -> RefMap {
        let mut vars = RefMap::default();
        self.repl_collect_block_fn_vars(self.module_scope_ref(), &mut vars);
        vars
    }

    fn repl_collect_block_fn_vars(&self, scope: js_ast::StoreRef<Scope>, vars: &mut RefMap) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        for child in scope.children.slice() {
            if child.kind_stops_hoisting() {
                continue;
            }
            self.repl_collect_block_fn_vars(*child, vars);
            for (name, member) in child.members.iter() {
                let fn_ref = member.ref_;
                if self.symbols[fn_ref.inner_index() as usize].kind == SymbolKind::HoistedFunction
                    && self.repl_block_fn_is_also_var(*child, name, fn_ref)
                {
                    vars.insert(fn_ref, ());
                }
            }
        }
    }

    /// Whether `var NAME` at the place of the function `fn_ref` would be no early error.
    /// `block` is the scope that declares the function, or a scope above it that
    /// `hoist_symbols` put the function into: the answer is the same from there.
    fn repl_block_fn_is_also_var(
        &self,
        block: js_ast::StoreRef<Scope>,
        name: &[u8],
        fn_ref: js_ast::Ref,
    ) -> bool {
        let hash = Scope::get_member_hash(name);
        let mut next = block.parent;
        while let Some(scope) = next {
            if let Some(member) = scope.get_member_with_hash(name, hash)
                && member.ref_ != fn_ref
            {
                match self.symbols[member.ref_.inner_index() as usize].kind {
                    // B.3.5: `catch (e) { var e }` is allowed.
                    SymbolKind::CatchIdentifier => {}
                    SymbolKind::Unbound | SymbolKind::Hoisted => return true,
                    kind => return kind.is_function() && scope.kind_stops_hoisting(),
                }
            }
            if scope.kind_stops_hoisting() {
                break;
            }
            next = scope.parent;
        }
        true
    }

    /// Extract individual identifiers from a binding pattern for hoisting
    fn repl_extract_identifiers_from_binding<'bump>(
        &mut self,
        binding: Binding,
        decls: &mut BumpVec<'bump, G::Decl>,
    ) -> Result<(), bun_alloc::AllocError> {
        match binding.data {
            B::B::BIdentifier(ident) => {
                decls.push(G::Decl {
                    binding: self.b(B::Identifier { r#ref: ident.r#ref }, binding.loc),
                    value: None,
                });
            }
            B::B::BArray(arr) => {
                for item in arr.items().iter() {
                    self.repl_extract_identifiers_from_binding(item.binding, decls)?;
                }
            }
            B::B::BObject(obj) => {
                for prop in obj.properties().iter() {
                    self.repl_extract_identifiers_from_binding(prop.value, decls)?;
                }
            }
            B::B::BMissing(_) => {}
        }
        Ok(())
    }

    /// Create { __proto__: null, value: expr } wrapper object
    /// Uses null prototype to create a clean data object
    fn repl_wrap_expr_in_value_object<'bump>(&mut self, expr: Expr, bump: &'bump Bump) -> Expr {
        // G::Property is non-Copy (owns Vec) → use bump Vec instead of alloc_slice_copy.
        let mut properties = BumpVec::<G::Property>::with_capacity_in(2, bump);
        // __proto__: null - creates null-prototype object
        properties.push(G::Property {
            key: Some(self.new_expr(
                E::String {
                    data: b"__proto__".into(),
                    ..Default::default()
                },
                expr.loc,
            )),
            value: Some(self.new_expr(E::Null {}, expr.loc)),
            ..Default::default()
        });
        // value: expr - the actual result value
        properties.push(G::Property {
            key: Some(self.new_expr(
                E::String {
                    data: b"value".into(),
                    ..Default::default()
                },
                expr.loc,
            )),
            value: Some(expr),
            ..Default::default()
        });
        let prop_list = G::PropertyList::from_bump_vec(properties);
        self.new_expr(
            E::Object {
                properties: prop_list,
                ..Default::default()
            },
            expr.loc,
        )
    }

    /// Create assignment expression from binding pattern
    fn repl_create_binding_assignment<'bump>(
        &mut self,
        binding: Binding,
        value: Expr,
        bump: &'bump Bump,
    ) -> Expr {
        match binding.data {
            B::B::BIdentifier(ident) => {
                let left = self.new_expr(
                    E::Identifier {
                        ref_: ident.r#ref,
                        ..Default::default()
                    },
                    binding.loc,
                );
                self.new_expr(
                    E::Binary {
                        op: js_ast::OpCode::BinAssign,
                        left,
                        right: value,
                    },
                    binding.loc,
                )
            }
            B::B::BArray(_) => {
                // For array destructuring, create: [a, b] = value
                let left = self.repl_convert_binding_to_expr(binding, bump);
                self.new_expr(
                    E::Binary {
                        op: js_ast::OpCode::BinAssign,
                        left,
                        right: value,
                    },
                    binding.loc,
                )
            }
            B::B::BObject(_) => {
                // For object destructuring, create: {a, b} = value
                let left = self.repl_convert_binding_to_expr(binding, bump);
                self.new_expr(
                    E::Binary {
                        op: js_ast::OpCode::BinAssign,
                        left,
                        right: value,
                    },
                    binding.loc,
                )
            }
            B::B::BMissing(_) => {
                // Return Missing expression to match convertBindingToExpr
                self.new_expr(E::Missing {}, binding.loc)
            }
        }
    }

    /// Convert a binding pattern to an expression (for assignment targets)
    /// Handles spread/rest patterns in arrays and objects to match Binding.toExpr behavior
    fn repl_convert_binding_to_expr<'bump>(&mut self, binding: Binding, bump: &'bump Bump) -> Expr {
        match binding.data {
            B::B::BIdentifier(ident) => self.new_expr(
                E::Identifier {
                    ref_: ident.r#ref,
                    ..Default::default()
                },
                binding.loc,
            ),
            B::B::BArray(arr) => {
                let arr = arr.get();
                let arr_items = arr.items();
                let mut items = BumpVec::with_capacity_in(arr_items.len(), bump);
                for (i, item) in arr_items.iter().enumerate() {
                    let expr = self.repl_convert_binding_to_expr(item.binding, bump);
                    // Check for spread pattern: if has_spread and this is the last element
                    if arr.has_spread && i == arr_items.len() - 1 {
                        items.push(self.new_expr(E::Spread { value: expr }, expr.loc));
                    } else if let Some(default_val) = item.default_value {
                        items.push(self.new_expr(
                            E::Binary {
                                op: js_ast::OpCode::BinAssign,
                                left: expr,
                                right: default_val,
                            },
                            item.binding.loc,
                        ));
                    } else {
                        items.push(expr);
                    }
                }
                let item_list = ExprNodeList::from_bump_vec(items);
                self.new_expr(
                    E::Array {
                        items: item_list,
                        is_single_line: arr.is_single_line,
                        ..Default::default()
                    },
                    binding.loc,
                )
            }
            B::B::BObject(obj) => {
                let obj = obj.get();
                let obj_props = obj.properties();
                let mut properties = BumpVec::with_capacity_in(obj_props.len(), bump);
                for prop in obj_props.iter() {
                    properties.push(G::Property {
                        flags: prop.flags,
                        key: Some(prop.key),
                        // Set kind to .spread if the property has spread flag
                        kind: if prop.flags.contains(flags::Property::IsSpread) {
                            G::PropertyKind::Spread
                        } else {
                            G::PropertyKind::Normal
                        },
                        value: Some(self.repl_convert_binding_to_expr(prop.value, bump)),
                        initializer: prop.default_value,
                        ..Default::default()
                    });
                }
                let prop_list = G::PropertyList::from_bump_vec(properties);
                self.new_expr(
                    E::Object {
                        properties: prop_list,
                        is_single_line: obj.is_single_line,
                        ..Default::default()
                    },
                    binding.loc,
                )
            }
            B::B::BMissing(_) => self.new_expr(E::Missing {}, binding.loc),
        }
    }
}

/// Bump-allocate a single-element `G::DeclList`.
#[inline]
fn repl_one_decl(bump: &Bump, binding: Binding) -> G::DeclList {
    let slice: &mut [G::Decl] = bump.alloc_slice_fill_with(1, |_| G::Decl {
        binding,
        value: None,
    });
    G::DeclList::from_arena_slice(slice)
}

/// A walk over the statements that share the `var` scope of a REPL input. It enters no
/// function, class or expression.
struct ReplStatements<'f> {
    stack_check: bun_core::StackCheck,
    /// Called with each list of statements, outermost first. It can replace the list.
    each_list: &'f mut dyn FnMut(&mut js_ast::StmtNodeList),
    /// One of the statements is a `return`.
    has_return: bool,
}

impl ReplStatements<'_> {
    fn stmt(&mut self, stmt: Stmt) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        match stmt.data {
            StmtData::SReturn(_) => self.has_return = true,
            StmtData::SBlock(mut block) => self.list(&mut block.stmts),
            StmtData::SIf(if_) => {
                self.stmt(if_.yes);
                if let Some(no) = if_.no {
                    self.stmt(no);
                }
            }
            StmtData::SFor(for_) => self.stmt(for_.body),
            StmtData::SForIn(for_in) => self.stmt(for_in.body),
            StmtData::SForOf(for_of) => self.stmt(for_of.body),
            StmtData::SWhile(while_) => self.stmt(while_.body),
            StmtData::SDoWhile(do_while) => self.stmt(do_while.body),
            StmtData::SWith(with) => self.stmt(with.body),
            StmtData::SLabel(label) => self.stmt(label.stmt),
            StmtData::STry(mut try_) => {
                self.list(&mut try_.body);
                if let Some(catch) = try_.catch.as_mut() {
                    self.list(&mut catch.body);
                }
                if let Some(finally) = try_.finally.as_mut() {
                    self.list(&mut finally.stmts);
                }
            }
            StmtData::SSwitch(switch) => {
                for case in switch.cases.slice_mut() {
                    self.list(&mut case.body);
                }
            }
            _ => {}
        }
    }

    fn list(&mut self, stmts: &mut js_ast::StmtNodeList) {
        (self.each_list)(stmts);
        for stmt in stmts.slice() {
            self.stmt(*stmt);
        }
    }
}
