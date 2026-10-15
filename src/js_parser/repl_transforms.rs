//! REPL Transform module - transforms code for interactive REPL evaluation
//!
//! This module provides transformations for REPL mode:
//! - Wraps the last expression in { value: expr } for result capture
//! - Wraps code with await in async IIFE with variable hoisting
//! - Hoists declarations for variable persistence across REPL lines

use bun_alloc::Arena as Bump;
use bun_alloc::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_collections::VecExt;

use bun_ast as js_ast;
use bun_ast::binding::ToExprWrapper;
use bun_ast::stmt::Data as StmtData;
use bun_ast::{B, Binding, E, Expr, G, S, Stmt};

use crate::p::P;

impl<'a, const TS: bool, const SCAN: bool> P<'a, TS, SCAN> {
    /// Apply REPL-mode transforms to the AST.
    /// This transforms code for interactive evaluation:
    /// - Wraps the last expression in { value: expr } for result capture
    /// - Wraps code with await in async IIFE with variable hoisting
    pub(crate) fn apply_repl_transforms<'bump>(
        &mut self,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        bump: &'bump Bump,
    ) -> Result<(), bun_alloc::AllocError> {
        // Skip transform if there's a top-level return (indicates module pattern)
        if self.has_top_level_return {
            return Ok(());
        }

        // Collect all statements
        let mut total_stmts_count: usize = 0;
        for part in parts.iter() {
            total_stmts_count += part.stmts.len();
        }

        // A prologue "use strict" was consumed into module-scope strict mode and dropped, but
        // node's repl still evaluates the directive as a string expression. Reinject it at the
        // front, like the CJS wrapper's preserve_strict_mode.
        let reinject_strict = self.module_scope().strict_mode
            == js_ast::StrictModeKind::ExplicitStrictMode
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
    ) -> Result<(), bun_alloc::AllocError> {
        if all_stmts.is_empty() {
            return Ok(());
        }

        // Lists for hoisted declarations and inner statements
        let mut hoisted_stmts = BumpVec::<Stmt>::with_capacity_in(all_stmts.len(), bump);
        let mut inner_stmts = BumpVec::<Stmt>::with_capacity_in(all_stmts.len(), bump);

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
                    // For function declarations:
                    // Hoist as: var funcName;
                    // Inner: this.funcName = funcName; function funcName() {}
                    if let Some(name_loc) = func.func.name {
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

                        // Add this.funcName = funcName assignment
                        let this_expr = self.new_expr(E::This {}, stmt.loc);
                        // `original_name` is an arena-owned `StoreStr` valid for 'a; `.slice()`
                        // detaches the borrow from `self.symbols` so the &mut self calls below
                        // don't conflict.
                        let name_str: &[u8] = self.symbols[name_ref.inner_index() as usize]
                            .original_name
                            .slice();
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
                    inner_stmts.push(*stmt);
                }
            }
        }

        // Wrap the last expression in return { value: expr }
        self.repl_wrap_last_expression_with_return(&mut inner_stmts, bump);

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

    /// Wrap the last expression in return { value: expr }
    fn repl_wrap_last_expression_with_return<'bump>(
        &mut self,
        inner_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
    ) {
        if !inner_stmts.is_empty() {
            let mut last_idx: usize = inner_stmts.len();
            while last_idx > 0 {
                last_idx -= 1;
                let last_stmt = inner_stmts[last_idx];
                match last_stmt.data {
                    StmtData::SEmpty(_) | StmtData::SComment(_) => continue,
                    StmtData::SExpr(expr_data) => {
                        // Wrap in return { value: expr }
                        let wrapped = self.repl_wrap_expr_in_value_object(expr_data.value, bump);
                        inner_stmts[last_idx] = self.s(
                            S::Return {
                                value: Some(wrapped),
                            },
                            last_stmt.loc,
                        );
                        break;
                    }
                    _ => break,
                }
            }
        }
    }

    /// Extract individual identifiers from a binding pattern for hoisting
    fn repl_extract_identifiers_from_binding<'bump>(
        &mut self,
        binding: Binding,
        decls: &mut BumpVec<'bump, G::Decl>,
    ) -> Result<(), bun_alloc::AllocError> {
        for (loc, ident) in binding.identifiers() {
            decls.push(G::Decl {
                binding: self.b(B::Identifier { r#ref: ident.r#ref }, loc),
                value: None,
            });
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
        // The names of the pattern are hoisted as `var` by now, so each one is a plain
        // identifier in the assignment target.
        let wrapper = ToExprWrapper::new(bump, |_, loc, ref_| Expr::init_identifier(ref_, loc));
        let left = Binding::to_expr(&binding, core::ptr::null_mut(), wrapper);
        if matches!(binding.data, B::B::BMissing(_)) {
            return left;
        }
        self.new_expr(
            E::Binary {
                op: js_ast::OpCode::BinAssign,
                left,
                right: value,
            },
            binding.loc,
        )
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
