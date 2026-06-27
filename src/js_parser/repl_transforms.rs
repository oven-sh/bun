//! REPL Transform module - transforms code for interactive REPL evaluation
//!
//! This module provides transformations for REPL mode:
//! - Wraps the last expression in { value: expr } for result capture
//! - Wraps code with await in async IIFE with variable hoisting
//! - Hoists declarations for variable persistence across REPL lines
//!
//! The IIFE always returns a `{ __proto__: null, value, variables, functions }`
//! object: `value` is the completion value (own property, possibly undefined),
//! `variables` is the list of names the snippet declares, and `functions` is
//! the printed source of the snippet's replayable declarations (filled in by
//! `js_printer::print_ast` via `Ast.repl_functions`).

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_collections::VecExt;

use bun_ast as js_ast;
use bun_ast::ast_result::ReplFunctions;
use bun_ast::flags;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{B, Binding, E, Expr, ExprNodeList, G, Ref, S, Stmt};

use crate::p::P;

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    /// Apply REPL-mode transforms to the AST.
    /// This transforms code for interactive evaluation:
    /// - Wraps the last expression in { value: expr } for result capture
    /// - Wraps code with await in async IIFE with variable hoisting
    ///
    /// Returns the statements to print into the result wrapper's `functions`
    /// string (stored on `Ast.repl_functions`), if any.
    pub fn apply_repl_transforms<'bump>(
        &mut self,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        bump: &'bump Bump,
    ) -> Result<Option<ReplFunctions>, bun_alloc::AllocError> {
        // Skip transform if there's a top-level return (indicates module pattern)
        if self.has_top_level_return {
            return Ok(None);
        }

        // Collect all statements
        let mut total_stmts_count: usize = 0;
        for part in parts.iter() {
            total_stmts_count += part.stmts.len();
        }

        if total_stmts_count == 0 {
            return Ok(None);
        }

        // Collect all statements into a single array
        let mut all_stmts = BumpVec::with_capacity_in(total_stmts_count, bump);
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

        // Apply transform with is_async based on presence of top-level await
        self.repl_transform_with_hoisting(parts, all_stmts, bump, has_top_level_await)
    }

    /// Transform code with hoisting and IIFE wrapper
    /// `is_async`: true for async IIFE (when top-level await present), false for sync IIFE
    fn repl_transform_with_hoisting<'bump>(
        &mut self,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        all_stmts: &[Stmt],
        bump: &'bump Bump,
        is_async: bool,
    ) -> Result<Option<ReplFunctions>, bun_alloc::AllocError> {
        if all_stmts.is_empty() {
            return Ok(None);
        }

        // Lists for hoisted declarations and inner statements
        let mut hoisted_stmts = BumpVec::<Stmt>::with_capacity_in(all_stmts.len(), bump);
        let mut inner_stmts = BumpVec::<Stmt>::with_capacity_in(all_stmts.len(), bump);

        // Names the snippet declares, in source order (the `variables` array of
        // the result wrapper).
        let mut declared_names = BumpVec::<&'static [u8]>::new_in(bump);
        // Declarations that are safe to re-run on a fresh VM: function
        // declarations, classes, and locals whose initializers have no side
        // effects. Printed into the wrapper's `functions` string. Everything is
        // emitted in `var`-persistable form so the string can be replayed as-is.
        let mut serializable_stmts = BumpVec::<Stmt>::new_in(bump);
        // Symbols the `functions` string itself declares. An initializer is
        // only replayable if every binding it reads eagerly is in this set;
        // otherwise the printed source would throw a ReferenceError on a
        // fresh VM (e.g. `let a = effect(); let b = a` must not emit
        // `var b = a`). Function declarations are hoisted, so seed them all.
        let mut admitted_refs = BumpVec::<Ref>::new_in(bump);
        for stmt in all_stmts.iter() {
            if let StmtData::SFunction(func) = stmt.data {
                if let Some(name_loc) = func.func.name {
                    admitted_refs.push(self.repl_follow_ref(name_loc.ref_));
                }
            }
        }

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

                    for decl in hoisted_decl_list.iter() {
                        if let B::B::BIdentifier(ident) = decl.binding.data {
                            repl_push_unique_name(
                                &mut declared_names,
                                self.repl_symbol_name(ident.r#ref),
                            );
                        }
                    }

                    // `const x = 1` / `let y = [1]` are replayable; re-declare
                    // them as `var` so the printed source persists onto a vm
                    // context just like the REPL evaluation itself does.
                    // On success its bindings are admitted for later reads.
                    if self.repl_local_is_serializable(&local, &mut admitted_refs) {
                        let decls: &mut [G::Decl] = bump.alloc_slice_copy(local.decls.slice());
                        serializable_stmts.push(self.s(
                            S::Local {
                                kind: S::Kind::KVar,
                                decls: G::DeclList::from_arena_slice(decls),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
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
                    // For function declarations:
                    // Hoist as: var funcName;
                    // Inner: this.funcName = funcName; function funcName() {}
                    if let Some(name_loc) = func.func.name {
                        let name_ref = name_loc.ref_;
                        // Function declarations are always replayable.
                        serializable_stmts.push(*stmt);
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

                        // Add this.funcName = funcName assignment
                        let this_expr = self.new_expr(E::This {}, stmt.loc);
                        // `original_name` is an arena-owned `StoreStr` valid for 'a; `.slice()`
                        // detaches the borrow from `self.symbols` so the &mut self calls below
                        // don't conflict.
                        let name_str: &[u8] = self.symbols[name_ref.inner_index() as usize]
                            .original_name
                            .slice();
                        repl_push_unique_name(&mut declared_names, name_str);
                        let this_dot = self.new_expr(
                            E::Dot {
                                target: this_expr,
                                name: name_str.into(),
                                name_loc: name_loc.loc,
                                ..Default::default()
                            },
                            stmt.loc,
                        );
                        let func_id = self.new_expr(
                            E::Identifier {
                                ref_: name_ref,
                                ..Default::default()
                            },
                            name_loc.loc,
                        );
                        let assign = self.new_expr(
                            E::Binary {
                                op: js_ast::OpCode::BinAssign,
                                left: this_dot,
                                right: func_id,
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
                    // Add the function declaration itself
                    inner_stmts.push(*stmt);
                }
                StmtData::SClass(mut class) => {
                    // For class declarations:
                    // Hoist as: var ClassName; (use var so it persists to vm context)
                    // Inner: ClassName = class ClassName {}
                    if let Some(name_loc) = class.class.class_name {
                        let name_ref = name_loc.ref_;
                        repl_push_unique_name(&mut declared_names, self.repl_symbol_name(name_ref));
                        // Must be checked before `class.class` is moved out below.
                        let is_serializable = self.class_can_be_removed_if_unused(&class.class)
                            && self
                                .repl_class_eager_refs_are_admitted(&class.class, &admitted_refs);
                        if is_serializable {
                            admitted_refs.push(self.repl_follow_ref(name_ref));
                        }
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
                        if is_serializable {
                            // Serialize as `var ClassName = class ClassName {}` so the
                            // printed source persists onto a vm context when replayed.
                            let binding = Binding::alloc(
                                bump,
                                B::Identifier { r#ref: name_ref },
                                name_loc.loc,
                            );
                            let decls: &mut [G::Decl] =
                                bump.alloc_slice_fill_with(1, |_| G::Decl {
                                    binding,
                                    value: Some(class_expr),
                                });
                            serializable_stmts.push(self.s(
                                S::Local {
                                    kind: S::Kind::KVar,
                                    decls: G::DeclList::from_arena_slice(decls),
                                    ..Default::default()
                                },
                                stmt.loc,
                            ));
                        }
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
                        },
                        stmt.loc,
                    );
                    let await_expr = self.new_expr(E::Await { value: import_expr }, stmt.loc);

                    // `items` is an arena-owned `StoreSlice<ClauseItem>` valid for 'a.
                    let import_items: &[bun_ast::ClauseItem] = import_data.items.slice();

                    // Record the names this import binds in the REPL context,
                    // in grammar order: the default binding always precedes a
                    // namespace or named clause. The synthesized namespace ref
                    // for named imports is internal, so only `import * as X`
                    // reports `namespace_ref`.
                    if let Some(default_name) = import_data.default_name {
                        repl_push_unique_name(
                            &mut declared_names,
                            self.repl_symbol_name(default_name.ref_),
                        );
                    }
                    if !import_data.star_name_loc.is_empty() {
                        repl_push_unique_name(
                            &mut declared_names,
                            self.repl_symbol_name(import_data.namespace_ref),
                        );
                    }
                    for item in import_items {
                        repl_push_unique_name(
                            &mut declared_names,
                            self.repl_symbol_name(item.name.ref_),
                        );
                    }

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

                        // import X, * as ns from 'mod' -> var X; X = ns.default
                        // (the namespace was just assigned above)
                        if let Some(default_name) = import_data.default_name {
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
                        }
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
                    inner_stmts.push(*stmt);
                }
            }
        }

        // Build the `variables` array: the names this snippet declared.
        let mut name_items = BumpVec::<Expr>::with_capacity_in(declared_names.len(), bump);
        for name in declared_names.iter() {
            name_items.push(self.new_expr(
                E::String {
                    data: (*name).into(),
                    ..Default::default()
                },
                bun_ast::Loc::EMPTY,
            ));
        }
        let variables_expr = self.new_expr(
            E::Array {
                items: ExprNodeList::from_bump_vec(name_items),
                is_single_line: true,
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        );

        // Placeholder for the printed source of `serializable_stmts`; the
        // printer fills it in through `Ast.repl_functions`.
        let functions_expr = self.new_expr(
            E::String {
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        );
        let repl_functions = if serializable_stmts.is_empty() {
            None
        } else {
            Some(ReplFunctions {
                string_expr: functions_expr,
                stmts: bun_ast::StoreSlice::new_mut(serializable_stmts.into_bump_slice_mut()),
            })
        };

        // Wrap the last expression in return { value: expr, ... }; without a
        // trailing expression, append the wrapper with an undefined `value`.
        self.repl_finish_with_return(&mut inner_stmts, bump, variables_expr, functions_expr);

        // Create the IIFE: (() => { ...inner_stmts... })() or (async () => { ... })()
        let inner_slice: &mut [Stmt] = inner_stmts.into_bump_slice_mut();
        let arrow = self.new_expr(
            E::Arrow {
                body: G::FnBody {
                    loc: bun_ast::Loc::EMPTY,
                    stmts: bun_ast::StoreSlice::new_mut(inner_slice),
                },
                is_async,
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

        // Final output: hoisted declarations + IIFE call
        let final_stmts_count = hoisted_stmts.len() + 1;
        let mut final_stmts = BumpVec::with_capacity_in(final_stmts_count, bump);
        for stmt in hoisted_stmts.iter() {
            final_stmts.push(*stmt);
        }
        final_stmts.push(self.s(
            S::SExpr {
                value: iife,
                ..Default::default()
            },
            bun_ast::Loc::EMPTY,
        ));
        let final_slice: &mut [Stmt] = final_stmts.into_bump_slice_mut();

        // Update parts
        if !parts.is_empty() {
            parts[0].stmts = bun_ast::StoreSlice::new_mut(final_slice);
            parts.truncate(1);
        }

        Ok(repl_functions)
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

    /// Wrap the last trailing expression statement in
    /// `return { __proto__: null, value, variables, functions }`. When the
    /// snippet has no trailing expression, append the same `return` with an
    /// undefined `value` so the wrapper is always the completion value.
    fn repl_finish_with_return<'bump>(
        &mut self,
        inner_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
        variables: Expr,
        functions: Expr,
    ) {
        let mut last_idx: usize = inner_stmts.len();
        while last_idx > 0 {
            last_idx -= 1;
            let last_stmt = inner_stmts[last_idx];
            match last_stmt.data {
                StmtData::SEmpty(_) | StmtData::SComment(_) => continue,
                StmtData::SExpr(expr_data) => {
                    // Wrap in return { value: expr, ... }
                    let wrapped = self.repl_wrap_expr_in_value_object(
                        Some(expr_data.value),
                        variables,
                        functions,
                        bump,
                    );
                    inner_stmts[last_idx] = self.s(
                        S::Return {
                            value: Some(wrapped),
                        },
                        last_stmt.loc,
                    );
                    return;
                }
                _ => break,
            }
        }
        let wrapped = self.repl_wrap_expr_in_value_object(None, variables, functions, bump);
        inner_stmts.push(self.s(
            S::Return {
                value: Some(wrapped),
            },
            bun_ast::Loc::EMPTY,
        ));
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

    /// Resolve a symbol `Ref` minted by this parser to its source-level name.
    #[inline]
    fn repl_symbol_name(&self, r#ref: Ref) -> &'static [u8] {
        // `original_name` is an arena-owned `StoreStr`; `.slice()` detaches the
        // borrow from `self.symbols` (same contract as the hoisting code above).
        self.symbols[r#ref.inner_index() as usize]
            .original_name
            .slice()
    }

    /// Whether a `var`/`let`/`const` statement can be re-run on a fresh VM:
    /// not a `using` declaration (replaying one as `var` would drop its
    /// disposal semantics), every binding and initializer is free of side
    /// effects, and everything it reads eagerly (initializers, destructuring
    /// defaults, computed pattern keys) is declared by the serialized source
    /// itself (`admitted`).
    ///
    /// Declarators are checked left to right and admit their bindings as they
    /// go, so `const a = 1, b = a` is replayable. On success the statement's
    /// bindings stay in `admitted`; on failure `admitted` is rolled back and
    /// the whole statement is dropped (declaration statements are kept atomic
    /// rather than split per declarator).
    fn repl_local_is_serializable<'bump>(
        &mut self,
        local: &S::Local,
        admitted: &mut BumpVec<'bump, Ref>,
    ) -> bool {
        if local.kind.is_using() {
            return false;
        }
        let admitted_before = admitted.len();
        for decl in local.decls.slice() {
            if !self.binding_can_be_removed_if_unused_without_dce_check(decl.binding)
                || !self.repl_binding_eager_refs_are_admitted(decl.binding, admitted)
            {
                admitted.truncate(admitted_before);
                return false;
            }
            if let Some(value) = &decl.value {
                if !self.expr_can_be_removed_if_unused_without_dce_check(value)
                    || !self.repl_eager_refs_are_admitted(value, admitted)
                {
                    admitted.truncate(admitted_before);
                    return false;
                }
            }
            // Later declarators in this statement may read this one.
            self.repl_admit_binding_refs(decl.binding, admitted);
        }
        true
    }

    /// Record every name a binding pattern declares as admitted.
    fn repl_admit_binding_refs<'bump>(&self, binding: Binding, admitted: &mut BumpVec<'bump, Ref>) {
        match binding.data {
            B::B::BIdentifier(ident) => {
                admitted.push(self.repl_follow_ref(ident.r#ref));
            }
            B::B::BArray(array) => {
                for item in array.items.slice() {
                    self.repl_admit_binding_refs(item.binding, admitted);
                }
            }
            B::B::BObject(object) => {
                for property in object.properties.slice() {
                    self.repl_admit_binding_refs(property.value, admitted);
                }
            }
            B::B::BMissing(_) => {}
        }
    }

    /// `repl_eager_refs_are_admitted` for a binding pattern: destructuring
    /// evaluates computed keys and default values when the declaration runs.
    fn repl_binding_eager_refs_are_admitted(&self, binding: Binding, admitted: &[Ref]) -> bool {
        match binding.data {
            B::B::BIdentifier(_) | B::B::BMissing(_) => true,
            B::B::BArray(array) => array.items.slice().iter().all(|item| {
                self.repl_binding_eager_refs_are_admitted(item.binding, admitted)
                    && item
                        .default_value
                        .is_none_or(|value| self.repl_eager_refs_are_admitted(&value, admitted))
            }),
            B::B::BObject(object) => object.properties.slice().iter().all(|property| {
                (property.flags.contains(flags::Property::IsSpread)
                    || self.repl_eager_refs_are_admitted(&property.key, admitted))
                    && self.repl_binding_eager_refs_are_admitted(property.value, admitted)
                    && property
                        .default_value
                        .is_none_or(|value| self.repl_eager_refs_are_admitted(&value, admitted))
            }),
        }
    }

    /// Follow symbol links (e.g. merged `var` redeclarations) to the
    /// canonical `Ref`.
    fn repl_follow_ref(&self, r#ref: Ref) -> Ref {
        let mut r#ref = r#ref;
        let mut symbol = &self.symbols[r#ref.inner_index() as usize];
        while symbol.has_link() {
            r#ref = symbol.link.get();
            symbol = &self.symbols[r#ref.inner_index() as usize];
        }
        r#ref
    }

    /// Whether every identifier `expr` reads when evaluated refers to a
    /// binding the serialized `functions` source declares itself (`admitted`)
    /// or to a global, which the replaying context provides. Without this, a
    /// pure initializer like `let b = a` could reference a sibling that was
    /// excluded for having side effects and throw a ReferenceError on replay.
    ///
    /// Only called on expressions that already passed
    /// `expr_can_be_removed_if_unused_without_dce_check`, so the variant
    /// space is the side-effect-free subset; anything else is rejected.
    /// Function and arrow bodies are skipped: the declaration does not
    /// evaluate them.
    fn repl_eager_refs_are_admitted(&self, expr: &Expr, admitted: &[Ref]) -> bool {
        use js_ast::ExprData;
        match &expr.data {
            // No eager identifier reads.
            ExprData::ENull(_)
            | ExprData::EUndefined(_)
            | ExprData::EMissing(_)
            | ExprData::EBoolean(_)
            | ExprData::EBranchBoolean(_)
            | ExprData::ENumber(_)
            | ExprData::EBigInt(_)
            | ExprData::EString(_)
            | ExprData::EThis(_)
            | ExprData::ERegExp(_)
            | ExprData::EImportMeta(_)
            // Function bodies are deferred, not evaluated by the declaration.
            | ExprData::EFunction(_)
            | ExprData::EArrow(_) => true,
            // Import bindings are never part of the serialized source (import
            // statements are not replayable), so an eager read of one cannot
            // be satisfied on a fresh VM.
            ExprData::EImportIdentifier(_) | ExprData::ECommonjsExportIdentifier(_) => false,
            ExprData::EIdentifier(ex) => {
                // Unbound identifiers resolve against the replaying context's
                // globals, the same way the original evaluation did.
                self.symbols[ex.ref_.inner_index() as usize].kind
                    == js_ast::symbol::Kind::Unbound
                    || admitted.contains(&self.repl_follow_ref(ex.ref_))
            }
            ExprData::EInlinedEnum(ex) => self.repl_eager_refs_are_admitted(&ex.value, admitted),
            ExprData::EDot(ex) => self.repl_eager_refs_are_admitted(&ex.target, admitted),
            ExprData::ESpread(ex) => self.repl_eager_refs_are_admitted(&ex.value, admitted),
            ExprData::EClass(ex) => self.repl_class_eager_refs_are_admitted(ex, admitted),
            ExprData::EIf(ex) => {
                self.repl_eager_refs_are_admitted(&ex.test_, admitted)
                    && self.repl_eager_refs_are_admitted(&ex.yes, admitted)
                    && self.repl_eager_refs_are_admitted(&ex.no, admitted)
            }
            ExprData::EArray(ex) => ex
                .items
                .slice()
                .iter()
                .all(|item| self.repl_eager_refs_are_admitted(item, admitted)),
            ExprData::EObject(ex) => ex.properties.slice().iter().all(|property| {
                property
                    .key
                    .is_none_or(|key| self.repl_eager_refs_are_admitted(&key, admitted))
                    && property
                        .value
                        .is_none_or(|value| self.repl_eager_refs_are_admitted(&value, admitted))
            }),
            ExprData::ETemplate(ex) => {
                ex.tag.is_none()
                    && ex
                        .parts()
                        .iter()
                        .all(|part| self.repl_eager_refs_are_admitted(&part.value, admitted))
            }
            ExprData::EUnary(ex) => {
                // `typeof x` never throws, even for an undeclared `x`.
                (ex.op == js_ast::OpCode::UnTypeof
                    && matches!(ex.value.data, ExprData::EIdentifier(_)))
                    || self.repl_eager_refs_are_admitted(&ex.value, admitted)
            }
            ExprData::EBinary(ex) => {
                self.repl_eager_refs_are_admitted(&ex.left, admitted)
                    && self.repl_eager_refs_are_admitted(&ex.right, admitted)
            }
            // `/* @__PURE__ */ f(x)`: the target and arguments are still
            // evaluated when the declaration runs.
            ExprData::ECall(ex) => {
                self.repl_eager_refs_are_admitted(&ex.target, admitted)
                    && ex
                        .args
                        .slice()
                        .iter()
                        .all(|arg| self.repl_eager_refs_are_admitted(arg, admitted))
            }
            ExprData::ENew(ex) => {
                self.repl_eager_refs_are_admitted(&ex.target, admitted)
                    && ex
                        .args
                        .slice()
                        .iter()
                        .all(|arg| self.repl_eager_refs_are_admitted(arg, admitted))
            }
            _ => false,
        }
    }

    /// `repl_eager_refs_are_admitted` for a class body: `extends`, computed
    /// keys, field initializers, and static blocks all run when the
    /// declaration is evaluated.
    fn repl_class_eager_refs_are_admitted(&self, class: &G::Class, admitted: &[Ref]) -> bool {
        if let Some(extends) = &class.extends {
            if !self.repl_eager_refs_are_admitted(extends, admitted) {
                return false;
            }
        }
        for property in class.properties.iter() {
            if property.kind == G::PropertyKind::ClassStaticBlock {
                // A static block body is a statement list; rather than walk it
                // for admitted refs, only accept the trivially empty case.
                let is_empty = property
                    .class_static_block_ref()
                    .is_none_or(|block| block.stmts.slice().is_empty());
                if !is_empty {
                    return false;
                }
                continue;
            }
            if let Some(key) = &property.key {
                if !self.repl_eager_refs_are_admitted(key, admitted) {
                    return false;
                }
            }
            if let Some(value) = &property.value {
                if !self.repl_eager_refs_are_admitted(value, admitted) {
                    return false;
                }
            }
            if let Some(initializer) = &property.initializer {
                if !self.repl_eager_refs_are_admitted(initializer, admitted) {
                    return false;
                }
            }
        }
        true
    }

    /// Create the `{ __proto__: null, value, variables, functions }` result
    /// wrapper. Uses a null prototype to create a clean data object. `value`
    /// is always an own property (undefined when the snippet has no trailing
    /// expression) so consumers can unwrap it unconditionally.
    fn repl_wrap_expr_in_value_object<'bump>(
        &mut self,
        value: Option<Expr>,
        variables: Expr,
        functions: Expr,
        bump: &'bump Bump,
    ) -> Expr {
        let loc = value.map_or(bun_ast::Loc::EMPTY, |value| value.loc);
        // G::Property is non-Copy (owns Vec) → use bump Vec instead of alloc_slice_copy.
        let mut properties = BumpVec::<G::Property>::with_capacity_in(4, bump);
        // __proto__: null - creates null-prototype object
        properties.push(G::Property {
            key: Some(self.new_expr(
                E::String {
                    data: b"__proto__".into(),
                    ..Default::default()
                },
                loc,
            )),
            value: Some(self.new_expr(E::Null {}, loc)),
            ..Default::default()
        });
        // value: expr - the actual result value
        let value_expr = value.unwrap_or_else(|| self.new_expr(E::Undefined {}, loc));
        properties.push(G::Property {
            key: Some(self.new_expr(
                E::String {
                    data: b"value".into(),
                    ..Default::default()
                },
                loc,
            )),
            value: Some(value_expr),
            ..Default::default()
        });
        // variables: ["a", "b"] - names declared by the snippet
        properties.push(G::Property {
            key: Some(self.new_expr(
                E::String {
                    data: b"variables".into(),
                    ..Default::default()
                },
                loc,
            )),
            value: Some(variables),
            ..Default::default()
        });
        // functions: "..." - printed source of the replayable declarations
        properties.push(G::Property {
            key: Some(self.new_expr(
                E::String {
                    data: b"functions".into(),
                    ..Default::default()
                },
                loc,
            )),
            value: Some(functions),
            ..Default::default()
        });
        let prop_list = G::PropertyList::from_bump_vec(properties);
        self.new_expr(
            E::Object {
                properties: prop_list,
                ..Default::default()
            },
            loc,
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

/// Append `name` unless it is already present: keeps `variables` in source
/// order without duplicates (e.g. `var x = 1; var x = 2`).
#[inline]
fn repl_push_unique_name<'bump>(names: &mut BumpVec<'bump, &'static [u8]>, name: &'static [u8]) {
    if !names.contains(&name) {
        names.push(name);
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
