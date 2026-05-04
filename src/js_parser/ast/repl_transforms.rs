//! REPL Transform module - transforms code for interactive REPL evaluation
//!
//! This module provides transformations for REPL mode:
//! - Wraps the last expression in { value: expr } for result capture
//! - Wraps code with await in async IIFE with variable hoisting
//! - Hoists declarations for variable persistence across REPL lines

use core::marker::PhantomData;

use bumpalo::collections::Vec as BumpVec;
use bumpalo::Bump;

use bun_logger as logger;

use bun_js_parser::ast as js_ast;
use bun_js_parser::ast::{
    B, Binding, E, Expr, ExprNodeList, G, S, Stmt,
};
// TODO(port): verify exact module paths for nested types (Decl::List, G::Property::List,
// S::Local::Kind, stmt::Data / binding::Data variant names) once bun_js_parser crate lands.
use bun_js_parser::ast::G::Decl;

/// Zig: `pub fn ReplTransforms(comptime P: type) type { return struct { ... } }`
///
/// Zero-sized namespace struct; all fns are associated and take `p: &mut P`.
pub struct ReplTransforms<P>(PhantomData<P>);

// TODO(port): `P` needs a trait bound exposing the parser surface used here:
//   fields:  has_top_level_return: bool, top_level_await_keyword: logger::Range,
//            symbols: Vec<Symbol>, import_records: Vec<ImportRecord>
//   methods: s(..), b(..), new_expr(..)
// In Zig this is structural (`comptime P: type`); Phase B should introduce a
// `ParserLike` trait or move these into `impl P` directly.
impl<P> ReplTransforms<P> {
    /// Apply REPL-mode transforms to the AST.
    /// This transforms code for interactive evaluation:
    /// - Wraps the last expression in { value: expr } for result capture
    /// - Wraps code with await in async IIFE with variable hoisting
    pub fn apply<'bump>(
        p: &mut P,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        bump: &'bump Bump,
    ) -> Result<(), bun_alloc::AllocError> {
        // Skip transform if there's a top-level return (indicates module pattern)
        if p.has_top_level_return {
            return Ok(());
        }

        // Collect all statements
        let mut total_stmts_count: usize = 0;
        for part in parts.iter() {
            total_stmts_count += part.stmts.len();
        }

        if total_stmts_count == 0 {
            return Ok(());
        }

        // Collect all statements into a single array
        // PERF(port): was bun.handleOom(allocator.alloc(Stmt, n)) — bump alloc + index fill
        let mut all_stmts = BumpVec::with_capacity_in(total_stmts_count, bump);
        for part in parts.iter() {
            for stmt in part.stmts.iter() {
                all_stmts.push(*stmt);
            }
        }
        let all_stmts = all_stmts.into_bump_slice();

        // Check if there's top-level await or imports (imports become dynamic awaited imports)
        let mut has_top_level_await = p.top_level_await_keyword.len > 0;
        if !has_top_level_await {
            for stmt in all_stmts.iter() {
                if matches!(stmt.data, stmt::Data::SImport(_)) {
                    has_top_level_await = true;
                    break;
                }
            }
        }

        // Apply transform with is_async based on presence of top-level await
        Self::transform_with_hoisting(p, parts, all_stmts, bump, has_top_level_await)
    }

    /// Transform code with hoisting and IIFE wrapper
    /// `is_async`: true for async IIFE (when top-level await present), false for sync IIFE
    fn transform_with_hoisting<'bump>(
        p: &mut P,
        parts: &mut BumpVec<'bump, js_ast::Part>,
        all_stmts: &'bump [Stmt],
        bump: &'bump Bump,
        is_async: bool,
    ) -> Result<(), bun_alloc::AllocError> {
        if all_stmts.is_empty() {
            return Ok(());
        }

        // Lists for hoisted declarations and inner statements
        let mut hoisted_stmts = BumpVec::<Stmt>::new_in(bump);
        let mut inner_stmts = BumpVec::<Stmt>::new_in(bump);
        hoisted_stmts.reserve(all_stmts.len());
        inner_stmts.reserve(all_stmts.len());

        // Process each statement - hoist all declarations for REPL persistence
        for stmt in all_stmts.iter() {
            match &stmt.data {
                stmt::Data::SLocal(local) => {
                    // Hoist all declarations as var so they become context properties
                    // In sloppy mode, var at top level becomes a property of the global/context object
                    // This is essential for REPL variable persistence across vm.runInContext calls
                    let kind = S::Local::Kind::KVar;

                    // Extract individual identifiers from binding patterns for hoisting
                    let mut hoisted_decl_list = BumpVec::<G::Decl>::new_in(bump);
                    for decl in local.decls.slice() {
                        Self::extract_identifiers_from_binding(p, decl.binding, &mut hoisted_decl_list)?;
                    }

                    if !hoisted_decl_list.is_empty() {
                        hoisted_stmts.push(p.s(
                            S::Local {
                                kind,
                                decls: Decl::List::from_owned_slice(hoisted_decl_list.into_bump_slice()),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                    }

                    // Create assignment expressions for the inner statements
                    for decl in local.decls.slice() {
                        if let Some(value) = decl.value {
                            // Create assignment expression: binding = value
                            let assign_expr = Self::create_binding_assignment(p, decl.binding, value, bump);
                            inner_stmts.push(p.s(S::SExpr { value: assign_expr, ..Default::default() }, stmt.loc));
                        }
                    }
                }
                stmt::Data::SFunction(func) => {
                    // For function declarations:
                    // Hoist as: var funcName;
                    // Inner: this.funcName = funcName; function funcName() {}
                    if let Some(name_loc) = func.func.name {
                        hoisted_stmts.push(p.s(
                            S::Local {
                                kind: S::Local::Kind::KVar,
                                decls: Decl::List::from_owned_slice(bump.alloc_slice_copy(&[G::Decl {
                                    binding: p.b(B::Identifier { ref_: name_loc.ref_.unwrap() }, name_loc.loc),
                                    value: None,
                                }])),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));

                        // Add this.funcName = funcName assignment
                        let this_expr = p.new_expr(E::This {}, stmt.loc);
                        let this_dot = p.new_expr(
                            E::Dot {
                                target: this_expr,
                                name: p.symbols[name_loc.ref_.unwrap().inner_index()].original_name,
                                name_loc: name_loc.loc,
                                ..Default::default()
                            },
                            stmt.loc,
                        );
                        let func_id = p.new_expr(E::Identifier { ref_: name_loc.ref_.unwrap(), ..Default::default() }, name_loc.loc);
                        let assign = p.new_expr(
                            E::Binary {
                                op: js_ast::Op::BinAssign,
                                left: this_dot,
                                right: func_id,
                            },
                            stmt.loc,
                        );
                        inner_stmts.push(p.s(S::SExpr { value: assign, ..Default::default() }, stmt.loc));
                    }
                    // Add the function declaration itself
                    inner_stmts.push(*stmt);
                }
                stmt::Data::SClass(class) => {
                    // For class declarations:
                    // Hoist as: var ClassName; (use var so it persists to vm context)
                    // Inner: ClassName = class ClassName {}
                    if let Some(name_loc) = class.class.class_name {
                        hoisted_stmts.push(p.s(
                            S::Local {
                                kind: S::Local::Kind::KVar,
                                decls: Decl::List::from_owned_slice(bump.alloc_slice_copy(&[G::Decl {
                                    binding: p.b(B::Identifier { ref_: name_loc.ref_.unwrap() }, name_loc.loc),
                                    value: None,
                                }])),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));

                        // Convert class declaration to assignment: ClassName = class ClassName {}
                        let class_expr = p.new_expr(class.class, stmt.loc);
                        let class_id = p.new_expr(E::Identifier { ref_: name_loc.ref_.unwrap(), ..Default::default() }, name_loc.loc);
                        let assign = p.new_expr(
                            E::Binary {
                                op: js_ast::Op::BinAssign,
                                left: class_id,
                                right: class_expr,
                            },
                            stmt.loc,
                        );
                        inner_stmts.push(p.s(S::SExpr { value: assign, ..Default::default() }, stmt.loc));
                    } else {
                        inner_stmts.push(*stmt);
                    }
                }
                stmt::Data::SImport(import_data) => {
                    // Convert static imports to dynamic imports for REPL evaluation:
                    //   import X from 'mod'      -> var X = (await import('mod')).default
                    //   import { a, b } from 'mod' -> var {a, b} = await import('mod')
                    //   import * as X from 'mod'   -> var X = await import('mod')
                    //   import 'mod'              -> await import('mod')
                    let path_str = p.import_records[import_data.import_record_index as usize].path.text;
                    let import_expr = p.new_expr(
                        E::Import {
                            expr: p.new_expr(E::String { data: path_str, ..Default::default() }, stmt.loc),
                            import_record_index: u32::MAX,
                            ..Default::default()
                        },
                        stmt.loc,
                    );
                    let await_expr = p.new_expr(E::Await { value: import_expr }, stmt.loc);

                    if import_data.star_name_loc.is_some() {
                        // import * as X from 'mod' -> var X = await import('mod')
                        hoisted_stmts.push(p.s(
                            S::Local {
                                kind: S::Local::Kind::KVar,
                                decls: Decl::List::from_owned_slice(bump.alloc_slice_copy(&[G::Decl {
                                    binding: p.b(B::Identifier { ref_: import_data.namespace_ref }, stmt.loc),
                                    value: None,
                                }])),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));
                        let assign = p.new_expr(
                            E::Binary {
                                op: js_ast::Op::BinAssign,
                                left: p.new_expr(E::Identifier { ref_: import_data.namespace_ref, ..Default::default() }, stmt.loc),
                                right: await_expr,
                            },
                            stmt.loc,
                        );
                        inner_stmts.push(p.s(S::SExpr { value: assign, ..Default::default() }, stmt.loc));
                    } else if let Some(default_name) = import_data.default_name {
                        // import X from 'mod' -> var X = (await import('mod')).default
                        // import X, { a } from 'mod' -> var __ns = await import('mod'); var X = __ns.default; var a = __ns.a;
                        hoisted_stmts.push(p.s(
                            S::Local {
                                kind: S::Local::Kind::KVar,
                                decls: Decl::List::from_owned_slice(bump.alloc_slice_copy(&[G::Decl {
                                    binding: p.b(B::Identifier { ref_: default_name.ref_.unwrap() }, default_name.loc),
                                    value: None,
                                }])),
                                ..Default::default()
                            },
                            stmt.loc,
                        ));

                        if !import_data.items.is_empty() {
                            // Share a single await import() between default and named imports.
                            // namespace_ref is synthesized by processImportStatement for all non-star imports.
                            Self::convert_named_imports(p, import_data, await_expr, &mut hoisted_stmts, &mut inner_stmts, bump, stmt.loc)?;
                            let ns_ref_expr = p.new_expr(E::Identifier { ref_: import_data.namespace_ref, ..Default::default() }, stmt.loc);
                            let dot_default = p.new_expr(
                                E::Dot {
                                    target: ns_ref_expr,
                                    name: b"default",
                                    name_loc: stmt.loc,
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                            let assign = p.new_expr(
                                E::Binary {
                                    op: js_ast::Op::BinAssign,
                                    left: p.new_expr(E::Identifier { ref_: default_name.ref_.unwrap(), ..Default::default() }, default_name.loc),
                                    right: dot_default,
                                },
                                stmt.loc,
                            );
                            inner_stmts.push(p.s(S::SExpr { value: assign, ..Default::default() }, stmt.loc));
                        } else {
                            let dot_default = p.new_expr(
                                E::Dot {
                                    target: await_expr,
                                    name: b"default",
                                    name_loc: stmt.loc,
                                    ..Default::default()
                                },
                                stmt.loc,
                            );
                            let assign = p.new_expr(
                                E::Binary {
                                    op: js_ast::Op::BinAssign,
                                    left: p.new_expr(E::Identifier { ref_: default_name.ref_.unwrap(), ..Default::default() }, default_name.loc),
                                    right: dot_default,
                                },
                                stmt.loc,
                            );
                            inner_stmts.push(p.s(S::SExpr { value: assign, ..Default::default() }, stmt.loc));
                        }
                    } else if !import_data.items.is_empty() {
                        // import { a, b } from 'mod' -> destructure from await import('mod')
                        Self::convert_named_imports(p, import_data, await_expr, &mut hoisted_stmts, &mut inner_stmts, bump, stmt.loc)?;
                    } else {
                        // import 'mod' (side-effect only) -> await import('mod')
                        inner_stmts.push(p.s(S::SExpr { value: await_expr, ..Default::default() }, stmt.loc));
                    }
                }
                stmt::Data::SDirective(directive) => {
                    // In REPL mode, treat directives (string literals) as expressions
                    let str_expr = p.new_expr(E::String { data: directive.value, ..Default::default() }, stmt.loc);
                    inner_stmts.push(p.s(S::SExpr { value: str_expr, ..Default::default() }, stmt.loc));
                }
                _ => {
                    inner_stmts.push(*stmt);
                }
            }
        }

        // Wrap the last expression in return { value: expr }
        Self::wrap_last_expression_with_return(p, &mut inner_stmts, bump);

        // Create the IIFE: (() => { ...inner_stmts... })() or (async () => { ... })()
        let arrow = p.new_expr(
            E::Arrow {
                args: &[],
                body: G::FnBody { loc: logger::Loc::EMPTY, stmts: inner_stmts.into_bump_slice() },
                is_async,
                ..Default::default()
            },
            logger::Loc::EMPTY,
        );

        let iife = p.new_expr(
            E::Call {
                target: arrow,
                args: ExprNodeList::default(),
                ..Default::default()
            },
            logger::Loc::EMPTY,
        );

        // Final output: hoisted declarations + IIFE call
        let final_stmts_count = hoisted_stmts.len() + 1;
        // PERF(port): was bun.handleOom(allocator.alloc(Stmt, n)) — bump Vec + into_bump_slice
        let mut final_stmts = BumpVec::with_capacity_in(final_stmts_count, bump);
        for stmt in hoisted_stmts.iter() {
            final_stmts.push(*stmt);
        }
        final_stmts.push(p.s(S::SExpr { value: iife, ..Default::default() }, logger::Loc::EMPTY));
        let final_stmts = final_stmts.into_bump_slice();

        // Update parts
        if !parts.is_empty() {
            parts[0].stmts = final_stmts;
            parts.truncate(1);
        }

        Ok(())
    }

    /// Convert named imports to individual var assignments from the dynamic import
    /// import { a, b as c } from 'mod' ->
    ///   var a; var c;  (hoisted)
    ///   var __mod = await import('mod'); a = __mod.a; c = __mod.b;  (inner)
    fn convert_named_imports<'bump>(
        p: &mut P,
        import_data: &S::Import,
        await_expr: Expr,
        hoisted_stmts: &mut BumpVec<'bump, Stmt>,
        inner_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
        loc: logger::Loc,
    ) -> Result<(), bun_alloc::AllocError> {
        // Store the module in the namespace ref: var __ns = await import('mod')
        hoisted_stmts.push(p.s(
            S::Local {
                kind: S::Local::Kind::KVar,
                decls: Decl::List::from_owned_slice(bump.alloc_slice_copy(&[G::Decl {
                    binding: p.b(B::Identifier { ref_: import_data.namespace_ref }, loc),
                    value: None,
                }])),
                ..Default::default()
            },
            loc,
        ));
        let ns_assign = p.new_expr(
            E::Binary {
                op: js_ast::Op::BinAssign,
                left: p.new_expr(E::Identifier { ref_: import_data.namespace_ref, ..Default::default() }, loc),
                right: await_expr,
            },
            loc,
        );
        inner_stmts.push(p.s(S::SExpr { value: ns_assign, ..Default::default() }, loc));

        // For each named import: var name; name = __ns.originalName;
        for item in import_data.items.iter() {
            hoisted_stmts.push(p.s(
                S::Local {
                    kind: S::Local::Kind::KVar,
                    decls: Decl::List::from_owned_slice(bump.alloc_slice_copy(&[G::Decl {
                        binding: p.b(B::Identifier { ref_: item.name.ref_.unwrap() }, item.name.loc),
                        value: None,
                    }])),
                    ..Default::default()
                },
                loc,
            ));
            let ns_ref_expr = p.new_expr(E::Identifier { ref_: import_data.namespace_ref, ..Default::default() }, loc);
            let prop_access = p.new_expr(
                E::Dot {
                    target: ns_ref_expr,
                    name: item.alias,
                    name_loc: item.name.loc,
                    ..Default::default()
                },
                loc,
            );
            let item_assign = p.new_expr(
                E::Binary {
                    op: js_ast::Op::BinAssign,
                    left: p.new_expr(E::Identifier { ref_: item.name.ref_.unwrap(), ..Default::default() }, item.name.loc),
                    right: prop_access,
                },
                loc,
            );
            inner_stmts.push(p.s(S::SExpr { value: item_assign, ..Default::default() }, loc));
        }

        Ok(())
    }

    /// Wrap the last expression in return { value: expr }
    fn wrap_last_expression_with_return<'bump>(
        p: &mut P,
        inner_stmts: &mut BumpVec<'bump, Stmt>,
        bump: &'bump Bump,
    ) {
        if !inner_stmts.is_empty() {
            let mut last_idx: usize = inner_stmts.len();
            while last_idx > 0 {
                last_idx -= 1;
                let last_stmt = inner_stmts[last_idx];
                match &last_stmt.data {
                    stmt::Data::SEmpty(_) | stmt::Data::SComment(_) => continue,
                    stmt::Data::SExpr(expr_data) => {
                        // Wrap in return { value: expr }
                        let wrapped = Self::wrap_expr_in_value_object(p, expr_data.value, bump);
                        inner_stmts[last_idx] = p.s(S::Return { value: Some(wrapped) }, last_stmt.loc);
                        break;
                    }
                    _ => break,
                }
            }
        }
    }

    /// Extract individual identifiers from a binding pattern for hoisting
    fn extract_identifiers_from_binding<'bump>(
        p: &mut P,
        binding: Binding,
        decls: &mut BumpVec<'bump, G::Decl>,
    ) -> Result<(), bun_alloc::AllocError> {
        match &binding.data {
            binding::Data::BIdentifier(ident) => {
                decls.push(G::Decl {
                    binding: p.b(B::Identifier { ref_: ident.ref_ }, binding.loc),
                    value: None,
                });
            }
            binding::Data::BArray(arr) => {
                for item in arr.items.iter() {
                    Self::extract_identifiers_from_binding(p, item.binding, decls)?;
                }
            }
            binding::Data::BObject(obj) => {
                for prop in obj.properties.iter() {
                    Self::extract_identifiers_from_binding(p, prop.value, decls)?;
                }
            }
            binding::Data::BMissing(_) => {}
        }
        Ok(())
    }

    /// Create { __proto__: null, value: expr } wrapper object
    /// Uses null prototype to create a clean data object
    fn wrap_expr_in_value_object<'bump>(p: &mut P, expr: Expr, bump: &'bump Bump) -> Expr {
        // PERF(port): was bun.handleOom(allocator.alloc(G.Property, 2))
        let properties = bump.alloc_slice_copy(&[
            // __proto__: null - creates null-prototype object
            G::Property {
                key: Some(p.new_expr(E::String { data: b"__proto__", ..Default::default() }, expr.loc)),
                value: Some(p.new_expr(E::Null {}, expr.loc)),
                ..Default::default()
            },
            // value: expr - the actual result value
            G::Property {
                key: Some(p.new_expr(E::String { data: b"value", ..Default::default() }, expr.loc)),
                value: Some(expr),
                ..Default::default()
            },
        ]);
        p.new_expr(
            E::Object {
                properties: G::Property::List::from_owned_slice(properties),
                ..Default::default()
            },
            expr.loc,
        )
    }

    /// Create assignment expression from binding pattern
    fn create_binding_assignment<'bump>(p: &mut P, binding: Binding, value: Expr, bump: &'bump Bump) -> Expr {
        match &binding.data {
            binding::Data::BIdentifier(ident) => p.new_expr(
                E::Binary {
                    op: js_ast::Op::BinAssign,
                    left: p.new_expr(E::Identifier { ref_: ident.ref_, ..Default::default() }, binding.loc),
                    right: value,
                },
                binding.loc,
            ),
            binding::Data::BArray(_) => {
                // For array destructuring, create: [a, b] = value
                p.new_expr(
                    E::Binary {
                        op: js_ast::Op::BinAssign,
                        left: Self::convert_binding_to_expr(p, binding, bump),
                        right: value,
                    },
                    binding.loc,
                )
            }
            binding::Data::BObject(_) => {
                // For object destructuring, create: {a, b} = value
                p.new_expr(
                    E::Binary {
                        op: js_ast::Op::BinAssign,
                        left: Self::convert_binding_to_expr(p, binding, bump),
                        right: value,
                    },
                    binding.loc,
                )
            }
            binding::Data::BMissing(_) => {
                // Return Missing expression to match convertBindingToExpr
                p.new_expr(E::Missing {}, binding.loc)
            }
        }
    }

    /// Convert a binding pattern to an expression (for assignment targets)
    /// Handles spread/rest patterns in arrays and objects to match Binding.toExpr behavior
    fn convert_binding_to_expr<'bump>(p: &mut P, binding: Binding, bump: &'bump Bump) -> Expr {
        match &binding.data {
            binding::Data::BIdentifier(ident) => {
                p.new_expr(E::Identifier { ref_: ident.ref_, ..Default::default() }, binding.loc)
            }
            binding::Data::BArray(arr) => {
                // PERF(port): was bun.handleOom(allocator.alloc(Expr, n))
                let mut items = BumpVec::with_capacity_in(arr.items.len(), bump);
                for (i, item) in arr.items.iter().enumerate() {
                    let expr = Self::convert_binding_to_expr(p, item.binding, bump);
                    // Check for spread pattern: if has_spread and this is the last element
                    if arr.has_spread && i == arr.items.len() - 1 {
                        items.push(p.new_expr(E::Spread { value: expr }, expr.loc));
                    } else if let Some(default_val) = item.default_value {
                        items.push(p.new_expr(
                            E::Binary {
                                op: js_ast::Op::BinAssign,
                                left: expr,
                                right: default_val,
                            },
                            item.binding.loc,
                        ));
                    } else {
                        items.push(expr);
                    }
                }
                p.new_expr(
                    E::Array {
                        items: ExprNodeList::from_owned_slice(items.into_bump_slice()),
                        is_single_line: arr.is_single_line,
                        ..Default::default()
                    },
                    binding.loc,
                )
            }
            binding::Data::BObject(obj) => {
                // PERF(port): was bun.handleOom(allocator.alloc(G.Property, n))
                let mut properties = BumpVec::with_capacity_in(obj.properties.len(), bump);
                for prop in obj.properties.iter() {
                    properties.push(G::Property {
                        flags: prop.flags,
                        key: prop.key,
                        // Set kind to .spread if the property has spread flag
                        kind: if prop.flags.contains(js_ast::PropertyFlags::IsSpread) {
                            G::Property::Kind::Spread
                        } else {
                            G::Property::Kind::Normal
                        },
                        value: Some(Self::convert_binding_to_expr(p, prop.value, bump)),
                        initializer: prop.default_value,
                        ..Default::default()
                    });
                }
                p.new_expr(
                    E::Object {
                        properties: G::Property::List::from_owned_slice(properties.into_bump_slice()),
                        is_single_line: obj.is_single_line,
                        ..Default::default()
                    },
                    binding.loc,
                )
            }
            binding::Data::BMissing(_) => p.new_expr(E::Missing {}, binding.loc),
        }
    }
}

// TODO(port): these `stmt::Data` / `binding::Data` module paths are placeholders for the
// Rust enum that replaces Zig's `Stmt.Data` / `Binding.Data` union(enum). Phase B: align
// with actual bun_js_parser::ast variant naming.
use bun_js_parser::ast::stmt;
use bun_js_parser::ast::binding;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/repl_transforms.zig (510 lines)
//   confidence: medium
//   todos:      3
//   notes:      Generic-P mixin needs a ParserLike trait bound; AST nested type paths (S::Local::Kind, Decl::List, stmt::Data variants) are guesses pending bun_js_parser crate shape.
// ──────────────────────────────────────────────────────────────────────────
