#![allow(unused_imports, unused_variables, dead_code, unused_mut)]
//! AST visitor pass: visits statements, expressions, bindings, function bodies,
//! classes, and declarations. This is the second pass after parsing.

use bumpalo::collections::Vec as BumpVec;
use crate::ast as js_ast;
use crate::ast::{
    AssignTarget, Binding, BindingNodeIndex, Expr, ExprData, ExprNodeList, LocRef, Scope, Stmt,
    StmtData, StmtNodeIndex, Symbol, B, E, G, S,
};
use crate::ast::b::B as BData;
use crate::ast::G::{Arg, Decl, Property, PropertyKind};
use crate::ast::p::P;
use crate::ast::scope::{Kind as ScopeKind, Member as ScopeMember};
use crate::ast::symbol::Kind as SymbolKind;
use crate::flags;
use crate::lexer as js_lexer;
use crate::parser::{
    is_eval_or_arguments, ExprIn, FnOnlyDataVisit, FnOrArrowDataVisit, ImportItemForNamespaceMap,
    JsxT, PrependTempRefsOpts, Ref, RuntimeFeatures, SideEffects, StmtsKind, StrictModeFeature,
    StringVoidMap, TempRef, VisitArgsOpts,
};
use crate::StrictModeKind;
use bun_logger as logger;

// In the AST crate, ListManaged is arena-backed.
type ListManaged<'bump, T> = BumpVec<'bump, T>;

// Zig: `pub fn Visit(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
// — file-split mixin pattern. Round-C lowered `const JSX: JSXTransformType` → `J: JsxT`, so this is
// a direct `impl P` block. Full draft body preserved under #[cfg(any())] mod _draft below.

impl<'a, const TYPESCRIPT: bool, J: JsxT, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, J, SCAN_ONLY> {
    // SAFETY: `current_scope` is always a valid arena-owned Scope for the parse;
    // `pushScopeForVisitPass`/`popScope` keep it non-dangling. Private to this
    // impl block (sibling files have their own copy).
    #[inline(always)]
    fn vis_scope(&mut self) -> &mut js_ast::Scope {
        unsafe { &mut *self.current_scope }
    }

    pub fn visit_stmts_and_prepend_temp_refs(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        opts: &mut PrependTempRefsOpts,
    ) -> Result<(), bun_core::Error> {
        // Zig: `if (only_scan_imports_and_do_not_visit) @compileError(...)`
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        // p.temp_refs_to_declare.deinit(p.allocator); + reset to empty
        self.temp_refs_to_declare = BumpVec::new_in(self.allocator);
        self.temp_ref_count = 0;

        self.visit_stmts(stmts, opts.kind)?;

        // Prepend values for "this" and "arguments"
        if let Some(fn_body_loc) = opts.fn_body_loc {
            // Capture "this"
            if let Some(ref_) = self.fn_only_data_visit.this_capture_ref {
                let value = self.new_expr(E::This {}, fn_body_loc);
                self.temp_refs_to_declare.push(TempRef {
                    r#ref: ref_,
                    value: Some(value),
                });
            }
        }
        Ok(())
    }

    pub fn record_declared_symbol(&mut self, r#ref: Ref) {
        debug_assert!(r#ref.is_symbol());
        self.declared_symbols
            .append(crate::DeclaredSymbol {
                ref_: r#ref,
                is_top_level: core::ptr::eq(self.current_scope, self.module_scope),
            })
            .expect("oom");
    }

    pub fn visit_func(&mut self, mut func: G::Fn, open_parens_loc: logger::Loc) -> G::Fn {
        // Zig: `if (only_scan_imports_and_do_not_visit) @compileError(...)`
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        // PORT NOTE: FnOnlyDataVisit holds `Option<&'a mut Ref>` (non-Copy); save/restore
        // via `take` instead of by-value copy.
        let old_fn_or_arrow_data = self.fn_or_arrow_data_visit;
        let old_fn_only_data = core::mem::take(&mut self.fn_only_data_visit);
        self.fn_or_arrow_data_visit = FnOrArrowDataVisit {
            is_async: func.flags.contains(flags::Function::IsAsync),
            ..Default::default()
        };
        self.fn_only_data_visit = FnOnlyDataVisit {
            is_this_nested: true,
            arguments_ref: func.arguments_ref,
            ..Default::default()
        };

        if let Some(name) = func.name {
            if let Some(name_ref) = name.ref_ {
                self.record_declared_symbol(name_ref);
                let symbol_name = self.load_name_from_ref(name_ref);
                if is_eval_or_arguments(symbol_name) {
                    self.mark_strict_mode_feature(
                        StrictModeFeature::EvalOrArguments,
                        js_lexer::range_of_identifier(self.source, name.loc),
                        symbol_name,
                    )
                    .expect("unreachable");
                }
            }
        }

        let body_loc = func.body.loc;
        // SAFETY: arena-owned slice valid for 'a (Zig: `body.stmts`).
        let body_stmts: &'a [Stmt] = unsafe { &*func.body.stmts };

        self.push_scope_for_visit_pass(ScopeKind::FunctionArgs, open_parens_loc)
            .expect("unreachable");
        // SAFETY: arena-owned slice valid for 'a (Zig: `func.args` is []G.Arg).
        let args: &mut [G::Arg] = unsafe { &mut *func.args };
        self.visit_args(
            args,
            VisitArgsOpts {
                has_rest_arg: func.flags.contains(flags::Function::HasRestArg),
                body: body_stmts,
                is_unique_formal_parameters: true,
            },
        );

        self.push_scope_for_visit_pass(ScopeKind::FunctionBody, body_loc)
            .expect("unreachable");
        // PERF(port): was arena-backed ListManaged.fromOwnedSlice — Stmt is Copy.
        let mut stmts = BumpVec::with_capacity_in(body_stmts.len(), self.allocator);
        stmts.extend_from_slice(body_stmts);
        let mut temp_opts = PrependTempRefsOpts {
            kind: StmtsKind::FnBody,
            fn_body_loc: Some(body_loc),
        };
        self.visit_stmts_and_prepend_temp_refs(&mut stmts, &mut temp_opts)
            .expect("unreachable");

        if self.options.features.react_fast_refresh {
            // blocked_on: react_refresh.hook_ctx_storage is `Option<&'a mut Option<HookContext>>`;
            //   borrowing it through `&mut self` while calling another `&mut self` method is
            //   disjoint-borrow-incompatible. Body preserved in `_draft::visit_func`.
            // TODO(port): wire handle_react_refresh_post_visit_function_body once hook storage
            // is reshaped to a raw ptr (matching the Zig `*?Hook`).
            #[cfg(any())]
            {
                let hook_storage = self
                    .react_refresh
                    .hook_ctx_storage
                    .as_deref_mut()
                    .expect("caller did not init hook storage. any function can have react hooks!");
                if let Some(hook) = hook_storage.as_mut() {
                    self.handle_react_refresh_post_visit_function_body(&mut stmts, hook);
                }
            }
        }

        func.body = G::FnBody {
            stmts: stmts.into_bump_slice_mut() as *mut [Stmt],
            loc: body_loc,
        };

        self.pop_scope();
        self.pop_scope();

        self.fn_or_arrow_data_visit = old_fn_or_arrow_data;
        self.fn_only_data_visit = old_fn_only_data;

        func
    }

    pub fn visit_args(&mut self, args: &mut [G::Arg], opts: VisitArgsOpts) {
        let strict_loc = fn_body_contains_use_strict(opts.body);
        let has_simple_args = Self::is_simple_parameter_list(args, opts.has_rest_arg);
        // StringVoidMap::get returns a pool guard; Drop releases (replaces Zig `defer release`).
        let mut duplicate_args_check: Option<bun_collections::pool::PoolGuard<'static, StringVoidMap>> = None;

        // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
        // FunctionBodyContainsUseStrict of FunctionBody is true and
        // IsSimpleParameterList of FormalParameters is false."
        if strict_loc.is_some() && !has_simple_args {
            self.log
                .add_range_error(
                    Some(self.source),
                    self.source.range_of_string(strict_loc.unwrap()),
                    b"Cannot use a \"use strict\" directive in a function with a non-simple parameter list".as_slice().into(),
                )
                .expect("unreachable");
        }

        // Section 15.1.1 Static Semantics: Early Errors: "Multiple occurrences of
        // the same BindingIdentifier in a FormalParameterList is only allowed for
        // functions which have simple parameter lists and which are not defined in
        // strict mode code."
        if opts.is_unique_formal_parameters
            || strict_loc.is_some()
            || !has_simple_args
            || self.is_strict_mode()
        {
            duplicate_args_check = Some(StringVoidMap::get());
        }

        for arg in args.iter_mut() {
            if arg.ts_decorators.len > 0 {
                self.visit_ts_decorators(&mut arg.ts_decorators);
            }

            // PORT NOTE: reborrow per-iter (Zig passes the same pointer each time).
            let dup: Option<&mut StringVoidMap> =
                duplicate_args_check.as_mut().map(|g| &mut **g);
            self.visit_binding(arg.binding, dup);
            if let Some(default) = arg.default {
                arg.default = Some(self.visit_expr(default));
            }
        }
    }

    // PORT NOTE: Zig returned the list by value (`ExprNodeList` is a fat ptr there).
    // `BabyList<Expr>` is not `Copy` in Rust; mutate in place instead.
    pub fn visit_ts_decorators(&mut self, decs: &mut ExprNodeList) {
        for dec in decs.slice_mut() {
            *dec = self.visit_expr(*dec);
        }
    }

    pub fn visit_decls<const IS_POSSIBLY_DECL_TO_REMOVE: bool>(
        &mut self,
        decls: &mut [G::Decl],
        was_const: bool,
    ) -> usize {
        let mut j: usize = 0;
        // PORT NOTE: reshaped for borrowck — Zig aliased `out_decls = decls` and
        // iterated `decls` while writing through `out_decls[j]`. We iterate by index.
        let len = decls.len();
        let mut i: usize = 0;
        'outer: while i < len {
            // SAFETY: i < len; we need disjoint borrows of decls[i] (read/mutate)
            // and decls[j] (write at end). j <= i always holds.
            let decl: &mut G::Decl = unsafe { &mut *decls.as_mut_ptr().add(i) };
            i += 1;

            self.visit_binding(decl.binding, None);

            if let Some(mut val) = decl.value {
                let was_anonymous_named_expr = val.is_anonymous_named();

                let prev_require_to_convert_count = self.imports_to_convert_from_require.len();
                let prev_macro_call_count = self.macro_call_count;
                let orig_dead = self.is_control_flow_dead;
                // blocked_on: Runtime::Features.replace_exports is a `bool` stub (parser.rs:260),
                //   not the real `StringArrayHashMap<ReplaceableExport>`; replace_decl_and_possibly_remove
                //   is gated (P.rs:5202). The IS_POSSIBLY_DECL_TO_REMOVE lookup/replace path is preserved
                //   in `_draft::visit_decls` and re-enabled when those un-gate.
                let _ = orig_dead;

                if self.options.features.react_fast_refresh {
                    self.react_refresh.last_hook_seen = None;
                }

                debug_assert!(
                    !SCAN_ONLY,
                    "only_scan_imports_and_do_not_visit must not run this."
                );
                // Propagate name from binding to anonymous decorated class expressions
                let prev_decorator_class_name = self.decorator_class_name;
                if was_anonymous_named_expr {
                    if let ExprData::EClass(e_class) = &val.data {
                        if e_class.should_lower_standard_decorators {
                            if let BData::BIdentifier(id) = decl.binding.data {
                                // SAFETY: arena-owned B::Identifier valid for 'a.
                                let id = unsafe { &*id };
                                self.decorator_class_name = Some(self.load_name_from_ref(id.r#ref));
                            }
                        }
                    }
                }
                decl.value = Some(self.visit_expr_in_out(
                    val,
                    ExprIn {
                        is_immediately_assigned_to_decl: true,
                        ..Default::default()
                    },
                ));
                self.decorator_class_name = prev_decorator_class_name;

                if self.options.features.react_fast_refresh {
                    // When hooks are immediately assigned to something, we need to hash the binding.
                    if let Some(last_hook) = self.react_refresh.last_hook_seen {
                        if let Some(call) = decl.value.unwrap().data.e_call() {
                            if core::ptr::eq(last_hook, &*call) {
                                // blocked_on: B::write_to_hasher generic bound + hook_ctx_storage
                                //   double-borrow; preserved in `_draft::visit_decls`.
                                #[cfg(any())]
                                decl.binding.data.write_to_hasher(
                                    &mut self
                                        .react_refresh
                                        .hook_ctx_storage
                                        .as_deref_mut()
                                        .unwrap()
                                        .as_mut()
                                        .unwrap()
                                        .hasher,
                                    self.symbols.as_mut_slice(),
                                );
                            }
                        }
                    }
                }

                if self.should_unwrap_common_js_to_esm() {
                    if prev_require_to_convert_count < self.imports_to_convert_from_require.len() {
                        if let BData::BIdentifier(id) = decl.binding.data {
                            // SAFETY: arena-owned B::Identifier valid for 'a.
                            let ref_ = unsafe { (*id).r#ref };
                            if let Some(value) = decl.value {
                                if let ExprData::ERequireString(req) = value.data {
                                    if req.unwrapped_id != u32::MAX {
                                        self.imports_to_convert_from_require
                                            [req.unwrapped_id as usize]
                                            .namespace
                                            .ref_ = Some(ref_);
                                        self.import_items_for_namespace
                                            .insert(ref_, ImportItemForNamespaceMap::default());
                                        continue 'outer;
                                    }
                                }
                            }
                        }
                    }
                }

                // blocked_on: see above — IS_POSSIBLY_DECL_TO_REMOVE replace path gated.

                let is_after = self.vis_scope().is_after_const_local_prefix;
                self.visit_decl(
                    decl,
                    was_anonymous_named_expr,
                    was_const && !is_after,
                    if Self::ALLOW_MACROS {
                        prev_macro_call_count != self.macro_call_count
                    } else {
                        false
                    },
                );
            } else if IS_POSSIBLY_DECL_TO_REMOVE {
                // blocked_on: Runtime::Features.replace_exports map + replace_decl_and_possibly_remove.
                // Preserved in `_draft::visit_decls`.
            }

            // out_decls[j] = decl.*;
            if j != i - 1 {
                // SAFETY: j < i-1 < len; src/dst non-overlapping; Decl has no Drop.
                unsafe {
                    core::ptr::copy_nonoverlapping(
                        decls.as_ptr().add(i - 1),
                        decls.as_mut_ptr().add(j),
                        1,
                    );
                }
            }
            j += 1;
        }

        j
    }

    pub fn visit_binding_and_expr_for_macro(&mut self, binding: Binding, expr: Expr) {
        match binding.data {
            BData::BObject(bound_object) => {
                // SAFETY: arena-owned B::Object valid for 'a.
                let bound_object = unsafe { &*bound_object };
                if let ExprData::EObject(mut object) = expr.data {
                    if object.was_originally_macro {
                        for property in bound_object.properties() {
                            if property.flags.contains(flags::Property::IsSpread) {
                                return;
                            }
                        }
                        // blocked_on: E::Object::as_property + Expr::as_string_literal both touch
                        //   gated rope/EString surface; the inner property-match-and-compact loop
                        //   is preserved verbatim in `_draft::visit_binding_and_expr_for_macro`.
                        let _ = &mut object;
                    }
                }
            }
            BData::BArray(bound_array) => {
                // SAFETY: arena-owned B::Array valid for 'a.
                let bound_array = unsafe { &*bound_array };
                if let ExprData::EArray(mut array) = expr.data {
                    if array.was_originally_macro && !bound_array.has_spread {
                        let bound_items = bound_array.items();
                        array.items.len = array.items.len.min(bound_items.len() as u32);
                        let n = array.items.len as usize;
                        for (item, child_expr) in bound_items[..n]
                            .iter()
                            .zip(array.items.slice_mut().iter_mut())
                        {
                            if matches!(item.binding.data, BData::BMissing(_)) {
                                *child_expr = self.new_expr(E::Missing {}, expr.loc);
                                continue;
                            }
                            self.visit_binding_and_expr_for_macro(item.binding, *child_expr);
                        }
                    }
                }
            }
            BData::BIdentifier(id) => {
                if self.options.features.inlining {
                    // SAFETY: arena-owned B::Identifier valid for 'a.
                    let id = unsafe { &*id };
                    self.const_values.put(id.r#ref, expr).expect("oom");
                }
            }
            BData::BMissing(_) => {}
        }
    }

    pub fn visit_decl(
        &mut self,
        decl: &mut G::Decl,
        was_anonymous_named_expr: bool,
        could_be_const_value: bool,
        could_be_macro: bool,
    ) {
        // Optionally preserve the name
        match decl.binding.data {
            BData::BIdentifier(id) => {
                // SAFETY: arena-owned B::Identifier valid for 'a.
                let id_ref = unsafe { (*id).r#ref };
                if could_be_const_value || (Self::ALLOW_MACROS && could_be_macro) {
                    if let Some(val) = decl.value {
                        if val.can_be_const_value() {
                            self.const_values.put(id_ref, val).expect("oom");
                        }
                    }
                } else {
                    self.vis_scope().is_after_const_local_prefix = true;
                }
                // SAFETY: original_name is arena-owned, valid for 'a.
                let original_name: &'a [u8] =
                    unsafe { &*self.symbols[id_ref.inner_index() as usize].original_name };
                decl.value = Some(self.maybe_keep_expr_symbol_name(
                    decl.value.unwrap(),
                    original_name,
                    was_anonymous_named_expr,
                ));
            }
            BData::BObject(_) | BData::BArray(_) => {
                if Self::ALLOW_MACROS {
                    if could_be_macro && decl.value.is_some() {
                        self.visit_binding_and_expr_for_macro(decl.binding, decl.value.unwrap());
                    }
                }
            }
            BData::BMissing(_) => {}
        }
    }

    pub fn visit_for_loop_init(&mut self, stmt: Stmt, is_in_or_of: bool) -> Stmt {
        match stmt.data {
            StmtData::SExpr(mut st) => {
                let assign_target = if is_in_or_of {
                    AssignTarget::Replace
                } else {
                    AssignTarget::None
                };
                self.stmt_expr_value = st.value.data;
                st.value = self.visit_expr_in_out(
                    st.value,
                    ExprIn {
                        assign_target,
                        ..Default::default()
                    },
                );
            }
            StmtData::SLocal(mut st) => {
                for dec in st.decls.slice_mut() {
                    self.visit_binding(dec.binding, None);
                    if let Some(val) = dec.value {
                        dec.value = Some(self.visit_expr(val));
                    }
                }
                st.kind = self.select_local_kind(st.kind);
            }
            _ => {
                self.panic("Unexpected stmt in visitForLoopInit", format_args!(""));
            }
        }

        stmt
    }

    pub fn visit_binding(
        &mut self,
        binding: BindingNodeIndex,
        mut duplicate_arg_check: Option<&mut StringVoidMap>,
    ) {
        match binding.data {
            BData::BMissing(_) => {}
            BData::BIdentifier(bind) => {
                // SAFETY: arena-owned B::Identifier valid for 'a.
                let bind = unsafe { &*bind };
                self.record_declared_symbol(bind.r#ref);
                // SAFETY: original_name is arena-owned, valid for 'a.
                let name: &'a [u8] =
                    unsafe { &*self.symbols[bind.r#ref.inner_index() as usize].original_name };
                if is_eval_or_arguments(name) {
                    self.mark_strict_mode_feature(
                        StrictModeFeature::EvalOrArguments,
                        js_lexer::range_of_identifier(self.source, binding.loc),
                        name,
                    )
                    .expect("unreachable");
                }
                if let Some(dup) = duplicate_arg_check {
                    if dup.get_or_put_contains(name) {
                        self.log
                            .add_range_error_fmt(
                                Some(self.source),
                                js_lexer::range_of_identifier(self.source, binding.loc),
                                format_args!(
                                    "\"{}\" cannot be bound multiple times in the same parameter list",
                                    bstr::BStr::new(name)
                                ),
                            )
                            .expect("unreachable");
                    }
                }
            }
            BData::BArray(bind) => {
                // SAFETY: arena-owned B::Array valid for 'a; exclusive during visit pass.
                let bind = unsafe { &mut *bind };
                for item in bind.items_mut() {
                    self.visit_binding(item.binding, duplicate_arg_check.as_deref_mut());
                    if let Some(default_value) = item.default_value {
                        let was_anonymous_named_expr = default_value.is_anonymous_named();
                        let prev_decorator_class_name2 = self.decorator_class_name;
                        if was_anonymous_named_expr {
                            if let ExprData::EClass(e_class) = &default_value.data {
                                if e_class.should_lower_standard_decorators {
                                    if let BData::BIdentifier(id) = item.binding.data {
                                        // SAFETY: arena-owned B::Identifier valid for 'a.
                                        let id = unsafe { &*id };
                                        self.decorator_class_name =
                                            Some(self.load_name_from_ref(id.r#ref));
                                    }
                                }
                            }
                        }
                        item.default_value = Some(self.visit_expr(default_value));
                        self.decorator_class_name = prev_decorator_class_name2;

                        if let BData::BIdentifier(bind_) = item.binding.data {
                            // SAFETY: arena-owned B::Identifier valid for 'a.
                            let bind_ = unsafe { &*bind_ };
                            // SAFETY: original_name is arena-owned, valid for 'a.
                            let name: &'a [u8] = unsafe {
                                &*self.symbols[bind_.r#ref.inner_index() as usize].original_name
                            };
                            item.default_value = Some(self.maybe_keep_expr_symbol_name(
                                item.default_value.expect("unreachable"),
                                name,
                                was_anonymous_named_expr,
                            ));
                        }
                    }
                }
            }
            BData::BObject(bind) => {
                // SAFETY: arena-owned B::Object valid for 'a; exclusive during visit pass.
                let bind = unsafe { &mut *bind };
                for property in bind.properties_mut() {
                    if !property.flags.contains(flags::Property::IsSpread) {
                        property.key = self.visit_expr(property.key);
                    }

                    self.visit_binding(property.value, duplicate_arg_check.as_deref_mut());
                    if let Some(default_value) = property.default_value {
                        let was_anonymous_named_expr = default_value.is_anonymous_named();
                        let prev_decorator_class_name3 = self.decorator_class_name;
                        if was_anonymous_named_expr {
                            if let ExprData::EClass(e_class) = &default_value.data {
                                if e_class.should_lower_standard_decorators {
                                    if let BData::BIdentifier(id) = property.value.data {
                                        // SAFETY: arena-owned B::Identifier valid for 'a.
                                        let id = unsafe { &*id };
                                        self.decorator_class_name =
                                            Some(self.load_name_from_ref(id.r#ref));
                                    }
                                }
                            }
                        }
                        property.default_value = Some(self.visit_expr(default_value));
                        self.decorator_class_name = prev_decorator_class_name3;

                        if let BData::BIdentifier(bind_) = property.value.data {
                            // SAFETY: arena-owned B::Identifier valid for 'a.
                            let bind_ = unsafe { &*bind_ };
                            // SAFETY: original_name is arena-owned, valid for 'a.
                            let name: &'a [u8] = unsafe {
                                &*self.symbols[bind_.r#ref.inner_index() as usize].original_name
                            };
                            property.default_value = Some(self.maybe_keep_expr_symbol_name(
                                property.default_value.expect("unreachable"),
                                name,
                                was_anonymous_named_expr,
                            ));
                        }
                    }
                }
            }
        }
    }

    // PORT NOTE: P::stmts_to_single_stmt is `#[cfg(any())]`-gated (P.rs:6267, blocked on
    // S::Block Default). Inline a local copy until that un-gates.
    fn stmts_to_single_stmt_(&mut self, loc: logger::Loc, stmts: &'a mut [Stmt]) -> Stmt {
        if stmts.is_empty() {
            return Stmt { data: StmtData::SEmpty(S::Empty {}), loc };
        }

        if stmts.len() == 1 && !crate::parser::statement_cares_about_scope(&stmts[0]) {
            // "let" and "const" must be put in a block when in a single-statement context
            return stmts[0];
        }

        self.s(
            S::Block { stmts: stmts as *mut [Stmt], close_brace_loc: logger::Loc::EMPTY },
            loc,
        )
    }

    pub fn visit_loop_body(&mut self, stmt: Stmt) -> Stmt {
        let old_is_inside_loop = self.fn_or_arrow_data_visit.is_inside_loop;
        self.fn_or_arrow_data_visit.is_inside_loop = true;
        self.loop_body = stmt.data;
        let res = self.visit_single_stmt(stmt, StmtsKind::LoopBody);
        self.fn_or_arrow_data_visit.is_inside_loop = old_is_inside_loop;
        res
    }

    pub fn visit_single_stmt_block(&mut self, stmt: Stmt, kind: StmtsKind) -> Stmt {
        let mut new_stmt = stmt;
        self.push_scope_for_visit_pass(ScopeKind::Block, stmt.loc)
            .expect("unreachable");
        // SAFETY: caller guarantees `stmt.data` is `SBlock`; stmts is arena-owned.
        let block_stmts: &[Stmt] = match stmt.data {
            StmtData::SBlock(b) => unsafe { &*b.stmts },
            _ => unreachable!(),
        };
        let mut stmts = BumpVec::with_capacity_in(block_stmts.len(), self.allocator);
        stmts.extend_from_slice(block_stmts);
        self.visit_stmts(&mut stmts, kind).expect("unreachable");
        self.pop_scope();
        let items: &'a mut [Stmt] = stmts.into_bump_slice_mut();
        if let StmtData::SBlock(mut b) = new_stmt.data {
            b.stmts = items as *mut [Stmt];
        }
        if self.options.features.minify_syntax {
            // PORT NOTE: reshaped for borrowck — `stmts` was consumed above; in Zig
            // `stmts.items` aliases the slice now stored in `s_block.stmts`.
            new_stmt = self.stmts_to_single_stmt_(stmt.loc, items);
        }

        new_stmt
    }

    pub fn visit_single_stmt(&mut self, stmt: Stmt, kind: StmtsKind) -> Stmt {
        if matches!(stmt.data, StmtData::SBlock(_)) {
            return self.visit_single_stmt_block(stmt, kind);
        }

        let has_if_scope = match stmt.data {
            StmtData::SFunction(f) => f.func.flags.contains(flags::Function::HasIfScope),
            _ => false,
        };

        // Introduce a fake block scope for function declarations inside if statements
        if has_if_scope {
            self.push_scope_for_visit_pass(ScopeKind::Block, stmt.loc)
                .expect("unreachable");
        }

        let mut stmts = BumpVec::with_capacity_in(1, self.allocator);
        stmts.push(stmt);
        self.visit_stmts(&mut stmts, kind).expect("unreachable");

        if has_if_scope {
            self.pop_scope();
        }

        self.stmts_to_single_stmt_(stmt.loc, stmts.into_bump_slice_mut())
    }

    pub fn visit_class(
        &mut self,
        name_scope_loc: logger::Loc,
        class: &mut G::Class,
        default_name_ref: Ref,
    ) -> Ref {
        // Zig: `if (only_scan_imports_and_do_not_visit) @compileError(...)`
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        class.ts_decorators = self.visit_ts_decorators(class.ts_decorators);

        if let Some(name) = class.class_name {
            self.record_declared_symbol(name.ref_.unwrap());
        }

        self.push_scope_for_visit_pass(ScopeKind::ClassName, name_scope_loc)
            .expect("unreachable");
        let old_enclosing_class_keyword = self.enclosing_class_keyword;
        self.enclosing_class_keyword = class.class_keyword;
        self.vis_scope()
            .recursive_set_strict_mode(StrictModeKind::ImplicitStrictModeClass);
        // PORT NOTE: `FnOnlyDataVisit::class_name_ref` is `Option<&'a mut Ref>`, so the
        // shadow ref must outlive the parser. Allocate it in the bump arena (Zig kept it
        // on the stack and passed `&shadow_ref` — Rust's lifetime on the field forbids that).
        let shadow_ref: &'a mut Ref = self.allocator.alloc(Ref::NONE);

        // Insert a shadowing name that spans the whole class, which matches
        // JavaScript's semantics. The class body (and extends clause) "captures" the
        // original value of the name. This matters for class statements because the
        // symbol can be re-assigned to something else later. The captured values
        // must be the original value of the name, not the re-assigned value.
        // Use "const" for this symbol to match JavaScript run-time semantics. You
        // are not allowed to assign to this symbol (it throws a TypeError).
        if let Some(name) = class.class_name {
            *shadow_ref = name.ref_.unwrap();
            // SAFETY: original_name is arena-owned, valid for 'a.
            let original_name: &'a [u8] =
                unsafe { &*self.symbols[shadow_ref.inner_index() as usize].original_name };
            self.vis_scope()
                .members
                .put(
                    original_name,
                    ScopeMember {
                        ref_: name.ref_.unwrap_or(Ref::NONE),
                        loc: name.loc,
                    },
                )
                .expect("oom");
        } else {
            let name_str: &'a [u8] = if default_name_ref.is_null() {
                b"_this"
            } else {
                b"_default"
            };
            *shadow_ref = self
                .new_symbol(SymbolKind::Constant, name_str)
                .expect("unreachable");
        }

        self.record_declared_symbol(*shadow_ref);

        if let Some(extends) = class.extends {
            class.extends = Some(self.visit_expr(extends));
        }

        {
            self.push_scope_for_visit_pass(ScopeKind::ClassBody, class.body_loc)
                .expect("unreachable");
            // defer { p.pop_scope(); p.enclosing_class_keyword = old_enclosing_class_keyword; }
            // — manual restore at block end below; no early returns in this block.

            let shadow_ref_ptr: *mut Ref = shadow_ref as *mut Ref;
            let mut constructor_function: Option<*mut E::Function> = None;
            // SAFETY: arena-owned slice valid for 'a; exclusive during visit pass.
            let properties: &mut [G::Property] = unsafe { &mut *class.properties };
            for property in properties.iter_mut() {
                if property.kind == PropertyKind::ClassStaticBlock {
                    let old_fn_or_arrow_data = self.fn_or_arrow_data_visit;
                    let old_fn_only_data = core::mem::take(&mut self.fn_only_data_visit);
                    self.fn_or_arrow_data_visit = FnOrArrowDataVisit::default();
                    self.fn_only_data_visit = FnOnlyDataVisit {
                        is_this_nested: true,
                        is_new_target_allowed: true,
                        // SAFETY: shadow_ref is bump-allocated for 'a.
                        class_name_ref: Some(unsafe { &mut *shadow_ref_ptr }),

                        // TODO: down transpilation
                        should_replace_this_with_class_name_ref: false,
                        ..Default::default()
                    };
                    // SAFETY: class_static_block is `Some(NonNull<ClassStaticBlock>)` here
                    // (PropertyKind::ClassStaticBlock guarantees it); arena-owned for 'a.
                    let csb = unsafe { property.class_static_block.unwrap().as_mut() };
                    self.push_scope_for_visit_pass(ScopeKind::ClassStaticInit, csb.loc)
                        .expect("unreachable");

                    // Make it an error to use "arguments" in a static class block
                    self.vis_scope().forbid_arguments = true;

                    // PERF(port): was BabyList::move_to_list_managed; Stmt is Copy.
                    let csb_stmts = csb.stmts.slice();
                    let mut list = BumpVec::with_capacity_in(csb_stmts.len(), self.allocator);
                    list.extend_from_slice(csb_stmts);
                    self.visit_stmts(&mut list, StmtsKind::FnBody).expect("unreachable");
                    // SAFETY: bump-arena slice; BabyList marked Borrowed (no growth, no free).
                    csb.stmts = unsafe {
                        bun_collections::BabyList::from_bump_slice(list.into_bump_slice_mut())
                    };
                    self.pop_scope();

                    self.fn_or_arrow_data_visit = old_fn_or_arrow_data;
                    self.fn_only_data_visit = old_fn_only_data;

                    continue;
                }
                property.ts_decorators = self.visit_ts_decorators(property.ts_decorators);
                let is_private = if let Some(key) = property.key {
                    matches!(key.data, ExprData::EPrivateIdentifier(_))
                } else {
                    false
                };

                // Special-case EPrivateIdentifier to allow it here

                if is_private {
                    let priv_ref = match property.key.unwrap().data {
                        ExprData::EPrivateIdentifier(pi) => pi.ref_,
                        _ => unreachable!(),
                    };
                    self.record_declared_symbol(priv_ref);
                } else if let Some(key) = property.key {
                    property.key = Some(self.visit_expr(key));
                }

                // Make it an error to use "arguments" in a class body
                self.vis_scope().forbid_arguments = true;
                // defer p.current_scope.forbid_arguments = false;

                // The value of "this" is shadowed inside property values
                let old_is_this_captured = self.fn_only_data_visit.is_this_nested;
                let old_class_name_ref = self.fn_only_data_visit.class_name_ref.take();
                self.fn_only_data_visit.is_this_nested = true;
                self.fn_only_data_visit.is_new_target_allowed = true;
                // SAFETY: shadow_ref is bump-allocated for 'a; reborrow per-iter.
                self.fn_only_data_visit.class_name_ref = Some(unsafe { &mut *shadow_ref_ptr });
                // defer p.fn_only_data_visit.is_this_nested = old_is_this_captured;
                // defer p.fn_only_data_visit.class_name_ref = old_class_name_ref;
                // — manual restore at end of loop body; no `continue` after this point.

                // We need to explicitly assign the name to the property initializer if it
                // will be transformed such that it is no longer an inline initializer.

                let mut constructor_function_: Option<*mut E::Function> = None;

                let mut name_to_keep: Option<&'a [u8]> = None;
                if is_private {
                    // (no-op)
                } else if !property.flags.contains(flags::Property::IsMethod)
                    && !property.flags.contains(flags::Property::IsComputed)
                {
                    if let Some(key) = property.key {
                        if let ExprData::EString(e_str) = key.data {
                            name_to_keep = Some(e_str.string(self.allocator).expect("oom"));
                        }
                    }
                } else if property.flags.contains(flags::Property::IsMethod) {
                    if Self::IS_TYPESCRIPT_ENABLED {
                        if let (Some(value), Some(key)) = (property.value, property.key) {
                            if let (ExprData::EFunction(mut e_func), ExprData::EString(e_str)) =
                                (value.data, key.data)
                            {
                                if e_str.eql_comptime(b"constructor") {
                                    // PORT NOTE: Zig keeps a `*E.Function` into property.value's
                                    // arena slot, then re-reads it after visit_expr overwrites the
                                    // value below. We mirror via raw ptr.
                                    constructor_function_ = Some(&mut *e_func as *mut E::Function);
                                    constructor_function = constructor_function_;
                                }
                            }
                        }
                    }
                }

                if let Some(val) = property.value {
                    if let Some(name) = name_to_keep {
                        let was_anon = val.is_anonymous_named();
                        let prev_dcn = self.decorator_class_name;
                        if let ExprData::EClass(e_class) = &val.data {
                            if e_class.class_name.is_none()
                                && e_class.should_lower_standard_decorators
                            {
                                self.decorator_class_name = Some(name);
                            }
                        }
                        let visited = self.visit_expr(val);
                        property.value =
                            Some(self.maybe_keep_expr_symbol_name(visited, name, was_anon));
                        self.decorator_class_name = prev_dcn;
                    } else {
                        property.value = Some(self.visit_expr(val));
                    }

                    if Self::IS_TYPESCRIPT_ENABLED {
                        if constructor_function_.is_some() {
                            if let Some(value) = property.value {
                                if let ExprData::EFunction(mut e_func) = value.data {
                                    constructor_function = Some(&mut *e_func as *mut E::Function);
                                }
                            }
                        }
                    }
                }

                if let Some(val) = property.initializer {
                    // if (property.flags.is_static and )
                    if let Some(name) = name_to_keep {
                        let was_anon = val.is_anonymous_named();
                        let prev_dcn2 = self.decorator_class_name;
                        if let ExprData::EClass(e_class) = &val.data {
                            if e_class.class_name.is_none()
                                && e_class.should_lower_standard_decorators
                            {
                                self.decorator_class_name = Some(name);
                            }
                        }
                        let visited = self.visit_expr(val);
                        property.initializer =
                            Some(self.maybe_keep_expr_symbol_name(visited, name, was_anon));
                        self.decorator_class_name = prev_dcn2;
                    } else {
                        property.initializer = Some(self.visit_expr(val));
                    }
                }

                // manual restore for the three `defer`s above
                self.vis_scope().forbid_arguments = false;
                self.fn_only_data_visit.is_this_nested = old_is_this_captured;
                self.fn_only_data_visit.class_name_ref = old_class_name_ref;
            }

            // note: our version assumes useDefineForClassFields is true
            if Self::IS_TYPESCRIPT_ENABLED {
                if let Some(constructor) = constructor_function {
                    // blocked_on: TS ctor-field hoisting — touches `Stmt::assign`, `E::Dot` ctor,
                    //   `declare_symbol`, and overlapping `&mut [Property]` borrows that need a
                    //   reshaped Vec dance. Preserved verbatim in `_draft::visit_class`.
                    let _ = constructor;
                }
            }

            // manual restore for the block-level `defer`
            self.pop_scope();
            self.enclosing_class_keyword = old_enclosing_class_keyword;
        }

        if self.symbols[shadow_ref.inner_index() as usize].use_count_estimate == 0 {
            // If there was originally no class name but something inside needed one
            // (e.g. there was a static property initializer that referenced "this"),
            // store our generated name so the class expression ends up with a name.
            *shadow_ref = Ref::NONE;
        } else if class.class_name.is_none() {
            class.class_name = Some(LocRef {
                ref_: Some(*shadow_ref),
                loc: name_scope_loc,
            });
            self.record_declared_symbol(*shadow_ref);
        }

        // class name scope
        self.pop_scope();

        *shadow_ref
    }

    // Try separating the list for appending, so that it's not a pointer.
    pub fn visit_stmts(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        kind: StmtsKind,
    ) -> Result<(), bun_core::Error> {
        // blocked_on: visitStmt — `visit_and_append_stmt` body + the heavy P helpers it calls
        //   (substitute_single_use_symbol_in_stmt, should_lower_using_declarations,
        //   maybe_relocate_vars_to_top_level, SideEffects::should_keep_stmt_in_dead_control_flow,
        //   scopes_in_order_for_enum) are mid-port. Full body preserved in `_draft::visit_stmts`.
        let _ = (stmts, kind);
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );
        todo!("b2-ast-E: visit_stmts — blocked on visitStmt.rs")
    }
}

pub fn fn_body_contains_use_strict(body: &[Stmt]) -> Option<logger::Loc> {
    use crate::ast::stmt::Data as StmtData;
    for stmt in body {
        // "use strict" has to appear at the top of the function body
        // but we can allow comments
        match &stmt.data {
            StmtData::SComment(_) => continue,
            StmtData::SDirective(dir) => {
                // SAFETY: arena-owned slice valid for the parse.
                if unsafe { &*dir.value } == b"use strict" {
                    return Some(stmt.loc);
                }
            }
            StmtData::SEmpty(_) => {}
            _ => return None,
        }
    }
    None
}

#[cfg(any())]
// blocked_on: P::{push_scope_for_visit_pass, pop_scope, record_usage, ignore_usage,
//   record_declared_symbol, mark_strict_mode_feature, declare_symbol, find_label_symbol,
//   handle_react_refresh_*, lower_class, generate_temp_ref, append_if_body_preserving_scope}
//   all gated (P.rs:640 impl block); _draft uses `const JSX: JSXTransformType` const-generic
//   (needs J: JsxT lowering); `defer`-restore patterns need scopeguard; ~1400-line bodies,
//   >30 path/shape errors per method.
#[allow(warnings)]
mod _draft {
//! Port of src/js_parser/ast/visit.zig
//!
//! AST visitor pass: visits statements, expressions, bindings, function bodies,
//! classes, and declarations. This is the second pass after parsing.

use bun_collections::{BabyList, HashMap};
use crate::ast as js_ast;
use crate::ast::{
    AssignTarget, Binding, BindingData, BindingNodeIndex, DeclaredSymbol, Expr, ExprData,
    ExprNodeList, LocRef, Scope, Stmt, StmtData, StmtNodeIndex, Symbol, B, E, G, S,
};
use crate::ast::G::{Arg, Decl, Property};
use crate::lexer as js_lexer;
use crate::{
    is_eval_or_arguments, ExprIn, FnOnlyDataVisit, FnOrArrowDataVisit, ImportItemForNamespaceMap,
    JSXTransformType, NewParser_, PrependTempRefsOpts, Ref, RuntimeFeatures, SideEffects,
    StmtsKind, StringVoidMap, TempRef, VisitArgsOpts,
};
use bun_logger as logger;

// In the AST crate, ListManaged is arena-backed.
// PERF(port): was std.array_list.Managed over p.allocator (arena) — profile in Phase B
type ListManaged<'bump, T> = bumpalo::collections::Vec<'bump, T>;

/// `P` is the monomorphized parser type for the given feature flags.
/// In Zig: `js_parser.NewParser_(typescript, jsx, scan_only)`.
type P<
    'bump,
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
> = NewParser_<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>;

/// Zero-sized marker holding the visit-pass associated functions.
///
/// Zig: `pub fn Visit(comptime ts, comptime jsx, comptime scan_only) type { return struct { ... } }`
pub struct Visit<
    const PARSER_FEATURE_TYPESCRIPT: bool,
    const PARSER_FEATURE_JSX: JSXTransformType,
    const PARSER_FEATURE_SCAN_ONLY: bool,
>;

impl<
        'bump,
        const PARSER_FEATURE_TYPESCRIPT: bool,
        const PARSER_FEATURE_JSX: JSXTransformType,
        const PARSER_FEATURE_SCAN_ONLY: bool,
    > Visit<PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>
{
    // const allow_macros = P.allow_macros;
    // const is_typescript_enabled = P.is_typescript_enabled;
    // const only_scan_imports_and_do_not_visit = P.only_scan_imports_and_do_not_visit;
    // TODO(port): inherent associated consts on generic impls referencing another type's
    // consts are awkward; these are referenced inline below as
    // `P::<...>::ALLOW_MACROS` etc. For readability we shadow with local consts.
    const ALLOW_MACROS: bool =
        P::<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::ALLOW_MACROS;
    const IS_TYPESCRIPT_ENABLED: bool =
        P::<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::IS_TYPESCRIPT_ENABLED;
    const ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT: bool =
        P::<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT;

    // Thin re-exports — in Zig these mixin sibling-module methods onto `P` so
    // `p.visitExpr(...)` resolves. In Rust those are inherent methods on `P`
    // defined in `super::visit_expr` / `super::visit_stmt`; callsites below use
    // `p.visit_expr(...)` directly.
    // pub const visitExpr = VisitExpr(ts, jsx, scan).visitExpr;
    // pub const visitExprInOut = VisitExpr(ts, jsx, scan).visitExprInOut;
    // pub const visitAndAppendStmt = VisitStmt(ts, jsx, scan).visitAndAppendStmt;
    // TODO(port): if a `Visit` re-export surface is required, add
    // `pub use super::visit_expr::VisitExpr; pub use super::visit_stmt::VisitStmt;`

    pub fn visit_stmts_and_prepend_temp_refs(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut ListManaged<'bump, Stmt>,
        opts: &mut PrependTempRefsOpts,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): @compileError gate — in Zig this is a compile-time guard
        // that prevents instantiation when scan_only is true. Phase B should
        // express this via a `where`-clause / negative trait or split impl.
        debug_assert!(
            !Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        // p.temp_refs_to_declare.deinit(p.allocator); + reset to empty
        p.temp_refs_to_declare = Default::default();
        p.temp_ref_count = 0;

        Self::visit_stmts(p, stmts, opts.kind)?;

        // Prepend values for "this" and "arguments"
        if let Some(fn_body_loc) = opts.fn_body_loc {
            // Capture "this"
            if let Some(ref_) = p.fn_only_data_visit.this_capture_ref {
                p.temp_refs_to_declare.push(TempRef {
                    ref_: ref_,
                    value: p.new_expr(E::This {}, fn_body_loc),
                });
                // TODO(port): narrow error set — Zig used `try` here for OOM
            }
        }
        Ok(())
    }

    pub fn record_declared_symbol(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        ref_: Ref,
    ) -> Result<(), bun_core::Error> {
        debug_assert!(ref_.is_symbol());
        p.declared_symbols.push(DeclaredSymbol {
            ref_: ref_,
            is_top_level: core::ptr::eq(p.current_scope, p.module_scope),
        });
        // TODO(port): narrow error set
        Ok(())
    }

    pub fn visit_func(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        func_: G::Fn,
        open_parens_loc: logger::Loc,
    ) -> G::Fn {
        // TODO(port): @compileError gate
        debug_assert!(
            !Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        let mut func = func_;
        let old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
        let old_fn_only_data = p.fn_only_data_visit;
        p.fn_or_arrow_data_visit = FnOrArrowDataVisit {
            is_async: func.flags.contains(G::FnFlags::IsAsync),
            ..Default::default()
        };
        p.fn_only_data_visit = FnOnlyDataVisit {
            is_this_nested: true,
            arguments_ref: func.arguments_ref,
            ..Default::default()
        };

        if let Some(name) = func.name {
            if let Some(name_ref) = name.ref_ {
                Self::record_declared_symbol(p, name_ref).expect("unreachable");
                let symbol_name = p.load_name_from_ref(name_ref);
                if is_eval_or_arguments(symbol_name) {
                    p.mark_strict_mode_feature(
                        StrictModeFeature::EvalOrArguments,
                        js_lexer::range_of_identifier(p.source, name.loc),
                        symbol_name,
                    )
                    .expect("unreachable");
                }
            }
        }

        let body = func.body;

        p.push_scope_for_visit_pass(ScopeKind::FunctionArgs, open_parens_loc)
            .expect("unreachable");
        Self::visit_args(
            p,
            func.args,
            VisitArgsOpts {
                has_rest_arg: func.flags.contains(G::FnFlags::HasRestArg),
                body: body.stmts,
                is_unique_formal_parameters: true,
            },
        );

        p.push_scope_for_visit_pass(ScopeKind::FunctionBody, body.loc)
            .expect("unreachable");
        let mut stmts = ListManaged::from_owned_slice_in(body.stmts, p.allocator);
        // PERF(port): was arena-backed ListManaged.fromOwnedSlice
        let mut temp_opts = PrependTempRefsOpts {
            kind: StmtsKind::FnBody,
            fn_body_loc: Some(body.loc),
        };
        Self::visit_stmts_and_prepend_temp_refs(p, &mut stmts, &mut temp_opts)
            .expect("unreachable");

        if p.options.features.react_fast_refresh {
            let hook_storage = p
                .react_refresh
                .hook_ctx_storage
                .expect("caller did not init hook storage. any function can have react hooks!");

            if let Some(hook) = hook_storage.as_mut() {
                // TODO(port): hook_storage is `*?Hook` in Zig (pointer to optional);
                // Rust shape is likely `&mut Option<Hook>` — verify in Phase B.
                p.handle_react_refresh_post_visit_function_body(&mut stmts, hook);
            }
        }

        func.body = G::FnBody {
            stmts: stmts.into_bump_slice(),
            loc: body.loc,
        };

        p.pop_scope();
        p.pop_scope();

        p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
        p.fn_only_data_visit = old_fn_only_data;

        func
    }

    pub fn visit_args(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        args: &mut [G::Arg],
        opts: VisitArgsOpts,
    ) {
        let strict_loc = fn_body_contains_use_strict(opts.body);
        let has_simple_args = P::<
            'bump,
            PARSER_FEATURE_TYPESCRIPT,
            PARSER_FEATURE_JSX,
            PARSER_FEATURE_SCAN_ONLY,
        >::is_simple_parameter_list(args, opts.has_rest_arg);
        // StringVoidMap::get returns a pool guard; Drop releases.
        let mut duplicate_args_check: Option<StringVoidMap::PoolGuard> = None;
        // (defer StringVoidMap.release → handled by Drop on the guard)

        // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
        // FunctionBodyContainsUseStrict of FunctionBody is true and
        // IsSimpleParameterList of FormalParameters is false."
        if strict_loc.is_some() && !has_simple_args {
            p.log
                .add_range_error(
                    p.source,
                    p.source.range_of_string(strict_loc.unwrap()),
                    "Cannot use a \"use strict\" directive in a function with a non-simple parameter list",
                )
                .expect("unreachable");
        }

        // Section 15.1.1 Static Semantics: Early Errors: "Multiple occurrences of
        // the same BindingIdentifier in a FormalParameterList is only allowed for
        // functions which have simple parameter lists and which are not defined in
        // strict mode code."
        if opts.is_unique_formal_parameters
            || strict_loc.is_some()
            || !has_simple_args
            || p.is_strict_mode()
        {
            duplicate_args_check = Some(StringVoidMap::get());
        }

        let duplicate_args_check_ptr: Option<&mut StringVoidMap> =
            duplicate_args_check.as_mut().map(|n| &mut n.data);

        for arg in args.iter_mut() {
            if arg.ts_decorators.len() > 0 {
                arg.ts_decorators = Self::visit_ts_decorators(p, arg.ts_decorators);
            }

            Self::visit_binding(p, arg.binding, duplicate_args_check_ptr.as_deref_mut());
            // TODO(port): borrowck — `duplicate_args_check_ptr` reborrowed per-iter;
            // may need to compute the pointer inside the loop.
            if let Some(default) = arg.default {
                arg.default = Some(p.visit_expr(default));
            }
        }
    }

    pub fn visit_ts_decorators(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        decs: ExprNodeList,
    ) -> ExprNodeList {
        for dec in decs.slice_mut() {
            *dec = p.visit_expr(*dec);
        }

        decs
    }

    pub fn visit_decls<const IS_POSSIBLY_DECL_TO_REMOVE: bool>(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        decls: &mut [G::Decl],
        was_const: bool,
    ) -> usize {
        let mut j: usize = 0;
        // PORT NOTE: reshaped for borrowck — Zig aliased `out_decls = decls` and
        // iterated `decls` while writing through `out_decls[j]`. We iterate by
        // index instead.
        let len = decls.len();
        let mut i: usize = 0;
        while i < len {
            // SAFETY: i < len; we need disjoint borrows of decls[i] (read/mutate)
            // and decls[j] (write at end). j <= i always holds.
            let decl = unsafe { &mut *decls.as_mut_ptr().add(i) };
            i += 1;

            Self::visit_binding(p, decl.binding, None);

            if decl.value.is_some() {
                let mut val = decl.value.unwrap();
                let was_anonymous_named_expr = val.is_anonymous_named();
                let mut replacement: Option<&RuntimeFeatures::ReplaceableExport> = None;

                let prev_require_to_convert_count = p.imports_to_convert_from_require.len();
                let prev_macro_call_count = p.macro_call_count;
                let orig_dead = p.is_control_flow_dead;
                if IS_POSSIBLY_DECL_TO_REMOVE {
                    if let BindingData::BIdentifier(id) = &decl.binding.data {
                        if let Some(replacer) = p
                            .options
                            .features
                            .replace_exports
                            .get_ptr(p.load_name_from_ref(id.ref_))
                        {
                            replacement = Some(replacer);
                            if p.options.features.dead_code_elimination
                                && !matches!(*replacer, RuntimeFeatures::ReplaceableExport::Replace(_))
                            {
                                p.is_control_flow_dead = true;
                            }
                        }
                    }
                }

                if p.options.features.react_fast_refresh {
                    p.react_refresh.last_hook_seen = None;
                }

                // TODO(port): @compileError gate
                debug_assert!(
                    !Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT,
                    "only_scan_imports_and_do_not_visit must not run this."
                );
                // Propagate name from binding to anonymous decorated class expressions
                let prev_decorator_class_name = p.decorator_class_name;
                if was_anonymous_named_expr {
                    if let ExprData::EClass(e_class) = &val.data {
                        if e_class.should_lower_standard_decorators {
                            if let BindingData::BIdentifier(id) = &decl.binding.data {
                                p.decorator_class_name = Some(p.load_name_from_ref(id.ref_));
                            }
                        }
                    }
                }
                decl.value = Some(p.visit_expr_in_out(
                    val,
                    ExprIn {
                        is_immediately_assigned_to_decl: true,
                        ..Default::default()
                    },
                ));
                p.decorator_class_name = prev_decorator_class_name;

                if p.options.features.react_fast_refresh {
                    // When hooks are immediately assigned to something, we need to hash the binding.
                    if let Some(last_hook) = p.react_refresh.last_hook_seen {
                        if let Some(call) = decl.value.unwrap().data.as_e_call() {
                            if core::ptr::eq(last_hook, call) {
                                decl.binding.data.write_to_hasher(
                                    &mut p
                                        .react_refresh
                                        .hook_ctx_storage
                                        .unwrap()
                                        .as_mut()
                                        .unwrap()
                                        .hasher,
                                    &p.symbols,
                                );
                            }
                        }
                    }
                }

                if p.should_unwrap_common_js_to_esm() {
                    if prev_require_to_convert_count < p.imports_to_convert_from_require.len() {
                        if let BindingData::BIdentifier(id) = &decl.binding.data {
                            let ref_ = id.ref_;
                            if let Some(value) = decl.value {
                                if let ExprData::ERequireString(req) = &value.data {
                                    if req.unwrapped_id != u32::MAX {
                                        p.imports_to_convert_from_require[req.unwrapped_id as usize]
                                            .namespace
                                            .ref_ = ref_;
                                        p.import_items_for_namespace
                                            .insert(ref_, ImportItemForNamespaceMap::new_in(p.allocator));
                                        // PERF(port): was `put(...) catch unreachable`
                                        continue;
                                    }
                                }
                            }
                        }
                    }
                }

                if IS_POSSIBLY_DECL_TO_REMOVE {
                    p.is_control_flow_dead = orig_dead;
                }
                if IS_POSSIBLY_DECL_TO_REMOVE {
                    if let BindingData::BIdentifier(_) = &decl.binding.data {
                        if let Some(ptr) = replacement {
                            if !p.replace_decl_and_possibly_remove(decl, ptr) {
                                continue;
                            }
                        }
                    }
                }

                Self::visit_decl(
                    p,
                    decl,
                    was_anonymous_named_expr,
                    was_const && !p.current_scope.is_after_const_local_prefix,
                    if Self::ALLOW_MACROS {
                        prev_macro_call_count != p.macro_call_count
                    } else {
                        false
                    },
                );
            } else if IS_POSSIBLY_DECL_TO_REMOVE {
                if let BindingData::BIdentifier(id) = &decl.binding.data {
                    if let Some(ptr) = p
                        .options
                        .features
                        .replace_exports
                        .get_ptr(p.load_name_from_ref(id.ref_))
                    {
                        if !p.replace_decl_and_possibly_remove(decl, ptr) {
                            Self::visit_decl(
                                p,
                                decl,
                                was_const && !p.current_scope.is_after_const_local_prefix,
                                false,
                                false,
                            );
                        } else {
                            continue;
                        }
                    }
                }
            }

            // out_decls[j] = decl.*;
            // SAFETY: j <= i-1 < len; non-overlapping with current `decl` borrow when j < i-1,
            // and a self-assignment when j == i-1.
            unsafe {
                *decls.as_mut_ptr().add(j) = core::ptr::read(decl);
            }
            j += 1;
        }

        j
    }

    pub fn visit_binding_and_expr_for_macro(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        binding: Binding,
        expr: Expr,
    ) {
        match &binding.data {
            BindingData::BObject(bound_object) => {
                if let ExprData::EObject(object) = &expr.data {
                    if object.was_originally_macro {
                        let object = object; // mutable view below
                        for property in bound_object.properties.iter() {
                            if property.flags.contains(PropertyFlags::IsSpread) {
                                return;
                            }
                        }
                        let output_properties = object.properties.slice_mut();
                        let mut end: u32 = 0;
                        for property in bound_object.properties.iter() {
                            if let Some(name) = property.key.as_string_literal(p.allocator) {
                                if let Some(query) = object.as_property(name) {
                                    match &query.expr.data {
                                        ExprData::EObject(_) | ExprData::EArray(_) => {
                                            Self::visit_binding_and_expr_for_macro(
                                                p,
                                                property.value,
                                                query.expr,
                                            );
                                        }
                                        _ => {
                                            if p.options.features.inlining {
                                                if let BindingData::BIdentifier(id) =
                                                    &property.value.data
                                                {
                                                    p.const_values
                                                        .insert(id.ref_, query.expr);
                                                    // PERF(port): was `put(...) catch unreachable`
                                                }
                                            }
                                        }
                                    }
                                    output_properties[end as usize] =
                                        output_properties[query.i as usize];
                                    end += 1;
                                }
                            }
                        }

                        // TODO(port): `object` is behind `&expr.data`; needs `&mut` to set len.
                        object.properties.len = end;
                    }
                }
            }
            BindingData::BArray(bound_array) => {
                if let ExprData::EArray(array) = &expr.data {
                    if array.was_originally_macro && !bound_array.has_spread {
                        let array = array;
                        // TODO(port): needs `&mut` to set len.
                        array.items.len =
                            array.items.len.min(bound_array.items.len() as u32);
                        let n = array.items.len as usize;
                        debug_assert_eq!(bound_array.items[..n].len(), array.items.slice().len());
                        for (item, child_expr) in bound_array.items[..n]
                            .iter()
                            .zip(array.items.slice_mut().iter_mut())
                        {
                            if matches!(item.binding.data, BindingData::BMissing) {
                                *child_expr = p.new_expr(E::Missing {}, expr.loc);
                                continue;
                            }

                            Self::visit_binding_and_expr_for_macro(p, item.binding, *child_expr);
                        }
                    }
                }
            }
            BindingData::BIdentifier(id) => {
                if p.options.features.inlining {
                    p.const_values.insert(id.ref_, expr);
                    // PERF(port): was `put(...) catch unreachable`
                }
            }
            _ => {}
        }
    }

    pub fn visit_decl(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        decl: &mut Decl,
        was_anonymous_named_expr: bool,
        could_be_const_value: bool,
        could_be_macro: bool,
    ) {
        // Optionally preserve the name
        match &decl.binding.data {
            BindingData::BIdentifier(id) => {
                if could_be_const_value || (Self::ALLOW_MACROS && could_be_macro) {
                    if let Some(val) = decl.value {
                        if val.can_be_const_value() {
                            p.const_values.insert(id.ref_, val);
                            // PERF(port): was `put(...) catch unreachable`
                        }
                    }
                } else {
                    p.current_scope.is_after_const_local_prefix = true;
                }
                decl.value = Some(p.maybe_keep_expr_symbol_name(
                    decl.value.unwrap(),
                    p.symbols[id.ref_.inner_index()].original_name,
                    was_anonymous_named_expr,
                ));
            }
            BindingData::BObject(_) | BindingData::BArray(_) => {
                if Self::ALLOW_MACROS {
                    if could_be_macro && decl.value.is_some() {
                        Self::visit_binding_and_expr_for_macro(p, decl.binding, decl.value.unwrap());
                    }
                }
            }
            _ => {}
        }
    }

    pub fn visit_for_loop_init(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmt: Stmt,
        is_in_or_of: bool,
    ) -> Stmt {
        match &stmt.data {
            StmtData::SExpr(st) => {
                let assign_target = if is_in_or_of {
                    AssignTarget::Replace
                } else {
                    AssignTarget::None
                };
                p.stmt_expr_value = st.value.data;
                st.value = p.visit_expr_in_out(
                    st.value,
                    ExprIn {
                        assign_target,
                        ..Default::default()
                    },
                );
            }
            StmtData::SLocal(st) => {
                for dec in st.decls.slice_mut() {
                    Self::visit_binding(p, dec.binding, None);
                    if let Some(val) = dec.value {
                        dec.value = Some(p.visit_expr(val));
                    }
                }
                st.kind = p.select_local_kind(st.kind);
            }
            _ => {
                p.panic("Unexpected stmt in visitForLoopInit", ());
            }
        }

        stmt
    }

    pub fn visit_binding(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        binding: BindingNodeIndex,
        duplicate_arg_check: Option<&mut StringVoidMap>,
    ) {
        match &binding.data {
            BindingData::BMissing => {}
            BindingData::BIdentifier(bind) => {
                Self::record_declared_symbol(p, bind.ref_).expect("unreachable");
                let name = p.symbols[bind.ref_.inner_index()].original_name;
                if is_eval_or_arguments(name) {
                    p.mark_strict_mode_feature(
                        StrictModeFeature::EvalOrArguments,
                        js_lexer::range_of_identifier(p.source, binding.loc),
                        name,
                    )
                    .expect("unreachable");
                }
                if let Some(dup) = duplicate_arg_check {
                    if dup.get_or_put_contains(name) {
                        p.log
                            .add_range_error_fmt(
                                p.source,
                                js_lexer::range_of_identifier(p.source, binding.loc),
                                format_args!(
                                    "\"{}\" cannot be bound multiple times in the same parameter list",
                                    bstr::BStr::new(name)
                                ),
                            )
                            .expect("unreachable");
                    }
                }
            }
            BindingData::BArray(bind) => {
                for item in bind.items.iter_mut() {
                    // TODO(port): borrowck — `duplicate_arg_check` is moved on first
                    // iteration; needs reborrow per-iter (`.as_deref_mut()`).
                    Self::visit_binding(p, item.binding, duplicate_arg_check.as_deref_mut());
                    if let Some(default_value) = item.default_value {
                        let was_anonymous_named_expr = default_value.is_anonymous_named();
                        let prev_decorator_class_name2 = p.decorator_class_name;
                        if was_anonymous_named_expr {
                            if let ExprData::EClass(e_class) = &default_value.data {
                                if e_class.should_lower_standard_decorators {
                                    if let BindingData::BIdentifier(id) = &item.binding.data {
                                        p.decorator_class_name =
                                            Some(p.load_name_from_ref(id.ref_));
                                    }
                                }
                            }
                        }
                        item.default_value = Some(p.visit_expr(default_value));
                        p.decorator_class_name = prev_decorator_class_name2;

                        match &item.binding.data {
                            BindingData::BIdentifier(bind_) => {
                                item.default_value = Some(p.maybe_keep_expr_symbol_name(
                                    item.default_value.expect("unreachable"),
                                    p.symbols[bind_.ref_.inner_index()].original_name,
                                    was_anonymous_named_expr,
                                ));
                            }
                            _ => {}
                        }
                    }
                }
            }
            BindingData::BObject(bind) => {
                for property in bind.properties.iter_mut() {
                    if !property.flags.contains(PropertyFlags::IsSpread) {
                        property.key = p.visit_expr(property.key);
                    }

                    Self::visit_binding(p, property.value, duplicate_arg_check.as_deref_mut());
                    if let Some(default_value) = property.default_value {
                        let was_anonymous_named_expr = default_value.is_anonymous_named();
                        let prev_decorator_class_name3 = p.decorator_class_name;
                        if was_anonymous_named_expr {
                            if let ExprData::EClass(e_class) = &default_value.data {
                                if e_class.should_lower_standard_decorators {
                                    if let BindingData::BIdentifier(id) = &property.value.data {
                                        p.decorator_class_name =
                                            Some(p.load_name_from_ref(id.ref_));
                                    }
                                }
                            }
                        }
                        property.default_value = Some(p.visit_expr(default_value));
                        p.decorator_class_name = prev_decorator_class_name3;

                        match &property.value.data {
                            BindingData::BIdentifier(bind_) => {
                                property.default_value = Some(p.maybe_keep_expr_symbol_name(
                                    property.default_value.expect("unreachable"),
                                    p.symbols[bind_.ref_.inner_index()].original_name,
                                    was_anonymous_named_expr,
                                ));
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    pub fn visit_loop_body(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmt: StmtNodeIndex,
    ) -> StmtNodeIndex {
        let old_is_inside_loop = p.fn_or_arrow_data_visit.is_inside_loop;
        p.fn_or_arrow_data_visit.is_inside_loop = true;
        p.loop_body = stmt.data;
        let res = Self::visit_single_stmt(p, stmt, StmtsKind::LoopBody);
        p.fn_or_arrow_data_visit.is_inside_loop = old_is_inside_loop;
        res
    }

    pub fn visit_single_stmt_block(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmt: Stmt,
        kind: StmtsKind,
    ) -> Stmt {
        let mut new_stmt = stmt;
        p.push_scope_for_visit_pass(ScopeKind::Block, stmt.loc)
            .expect("unreachable");
        let s_block = match &stmt.data {
            StmtData::SBlock(b) => b,
            _ => unreachable!(),
        };
        let mut stmts =
            ListManaged::with_capacity_in(s_block.stmts.len(), p.allocator);
        stmts.extend_from_slice(s_block.stmts);
        // PERF(port): was assume_capacity
        Self::visit_stmts(p, &mut stmts, kind).expect("unreachable");
        p.pop_scope();
        // TODO(port): mutate through `new_stmt.data` (SBlock) — needs `&mut` payload
        if let StmtData::SBlock(b) = &mut new_stmt.data {
            b.stmts = stmts.into_bump_slice();
        }
        if p.options.features.minify_syntax {
            // PORT NOTE: reshaped for borrowck — `stmts` was consumed above; in Zig
            // `stmts.items` aliases the slice now stored in `s_block.stmts`.
            let items = match &new_stmt.data {
                StmtData::SBlock(b) => b.stmts,
                _ => unreachable!(),
            };
            new_stmt = p.stmts_to_single_stmt(stmt.loc, items);
        }

        new_stmt
    }

    pub fn visit_single_stmt(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmt: Stmt,
        kind: StmtsKind,
    ) -> Stmt {
        if matches!(stmt.data, StmtData::SBlock(_)) {
            return Self::visit_single_stmt_block(p, stmt, kind);
        }

        let has_if_scope = match &stmt.data {
            StmtData::SFunction(f) => f.func.flags.contains(G::FnFlags::HasIfScope),
            _ => false,
        };

        // Introduce a fake block scope for function declarations inside if statements
        if has_if_scope {
            p.push_scope_for_visit_pass(ScopeKind::Block, stmt.loc)
                .expect("unreachable");
        }

        let mut stmts = ListManaged::with_capacity_in(1, p.allocator);
        stmts.push(stmt);
        // PERF(port): was assume_capacity
        Self::visit_stmts(p, &mut stmts, kind).expect("unreachable");

        if has_if_scope {
            p.pop_scope();
        }

        p.stmts_to_single_stmt(stmt.loc, stmts.into_bump_slice())
    }

    pub fn visit_class(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        name_scope_loc: logger::Loc,
        class: &mut G::Class,
        default_name_ref: Ref,
    ) -> Ref {
        // TODO(port): @compileError gate
        debug_assert!(
            !Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        class.ts_decorators = Self::visit_ts_decorators(p, class.ts_decorators);

        if let Some(name) = class.class_name {
            Self::record_declared_symbol(p, name.ref_.unwrap()).expect("unreachable");
        }

        p.push_scope_for_visit_pass(ScopeKind::ClassName, name_scope_loc)
            .expect("unreachable");
        let old_enclosing_class_keyword = p.enclosing_class_keyword;
        p.enclosing_class_keyword = class.class_keyword;
        p.current_scope
            .recursive_set_strict_mode(StrictMode::ImplicitStrictModeClass);
        let mut shadow_ref = Ref::NONE;

        // Insert a shadowing name that spans the whole class, which matches
        // JavaScript's semantics. The class body (and extends clause) "captures" the
        // original value of the name. This matters for class statements because the
        // symbol can be re-assigned to something else later. The captured values
        // must be the original value of the name, not the re-assigned value.
        // Use "const" for this symbol to match JavaScript run-time semantics. You
        // are not allowed to assign to this symbol (it throws a TypeError).
        if let Some(name) = class.class_name {
            shadow_ref = name.ref_.unwrap();
            p.current_scope.members.insert(
                p.symbols[shadow_ref.inner_index()].original_name,
                Scope::Member {
                    ref_: name.ref_.unwrap_or(Ref::NONE),
                    loc: name.loc,
                },
            );
            // PERF(port): was `put(...) catch unreachable`
        } else {
            let name_str: &[u8] = if default_name_ref.is_null() {
                b"_this"
            } else {
                b"_default"
            };
            shadow_ref = p
                .new_symbol(SymbolKind::Constant, name_str)
                .expect("unreachable");
        }

        Self::record_declared_symbol(p, shadow_ref).expect("unreachable");

        if let Some(extends) = class.extends {
            class.extends = Some(p.visit_expr(extends));
        }

        {
            p.push_scope_for_visit_pass(ScopeKind::ClassBody, class.body_loc)
                .expect("unreachable");
            // defer { p.pop_scope(); p.enclosing_class_keyword = old_enclosing_class_keyword; }
            // TODO(port): defer — manual restore at block end below; no early returns in this block.

            let mut constructor_function: Option<*mut E::Function> = None;
            for property in class.properties.iter_mut() {
                if property.kind == PropertyKind::ClassStaticBlock {
                    let old_fn_or_arrow_data = p.fn_or_arrow_data_visit;
                    let old_fn_only_data = p.fn_only_data_visit;
                    p.fn_or_arrow_data_visit = FnOrArrowDataVisit::default();
                    p.fn_only_data_visit = FnOnlyDataVisit {
                        is_this_nested: true,
                        is_new_target_allowed: true,
                        class_name_ref: Some(&mut shadow_ref),

                        // TODO: down transpilation
                        should_replace_this_with_class_name_ref: false,
                        ..Default::default()
                    };
                    let csb = property.class_static_block.as_mut().unwrap();
                    p.push_scope_for_visit_pass(ScopeKind::ClassStaticInit, csb.loc)
                        .expect("unreachable");

                    // Make it an error to use "arguments" in a static class block
                    p.current_scope.forbid_arguments = true;

                    let mut list = csb.stmts.move_to_list_managed(p.allocator);
                    Self::visit_stmts(p, &mut list, StmtsKind::FnBody).expect("unreachable");
                    csb.stmts = BabyList::<Stmt>::move_from_list(&mut list);
                    p.pop_scope();

                    p.fn_or_arrow_data_visit = old_fn_or_arrow_data;
                    p.fn_only_data_visit = old_fn_only_data;

                    continue;
                }
                property.ts_decorators = Self::visit_ts_decorators(p, property.ts_decorators);
                let is_private = if let Some(key) = property.key {
                    matches!(key.data, ExprData::EPrivateIdentifier(_))
                } else {
                    false
                };

                // Special-case EPrivateIdentifier to allow it here

                if is_private {
                    let priv_ref = match &property.key.unwrap().data {
                        ExprData::EPrivateIdentifier(pi) => pi.ref_,
                        _ => unreachable!(),
                    };
                    Self::record_declared_symbol(p, priv_ref).expect("unreachable");
                } else if let Some(key) = property.key {
                    property.key = Some(p.visit_expr(key));
                }

                // Make it an error to use "arguments" in a class body
                p.current_scope.forbid_arguments = true;
                // defer p.current_scope.forbid_arguments = false;

                // The value of "this" is shadowed inside property values
                let old_is_this_captured = p.fn_only_data_visit.is_this_nested;
                let old_class_name_ref = p.fn_only_data_visit.class_name_ref;
                p.fn_only_data_visit.is_this_nested = true;
                p.fn_only_data_visit.is_new_target_allowed = true;
                p.fn_only_data_visit.class_name_ref = Some(&mut shadow_ref);
                // defer p.fn_only_data_visit.is_this_nested = old_is_this_captured;
                // defer p.fn_only_data_visit.class_name_ref = old_class_name_ref;
                // TODO(port): defer — manual restore at end of loop body; this loop body
                // has no `continue` after this point so end-of-body restore is correct.

                // We need to explicitly assign the name to the property initializer if it
                // will be transformed such that it is no longer an inline initializer.

                let mut constructor_function_: Option<*mut E::Function> = None;

                let mut name_to_keep: Option<&[u8]> = None;
                if is_private {
                    // (no-op)
                } else if !property.flags.contains(PropertyFlags::IsMethod)
                    && !property.flags.contains(PropertyFlags::IsComputed)
                {
                    if let Some(key) = property.key {
                        if let ExprData::EString(e_str) = &key.data {
                            name_to_keep = Some(e_str.string(p.allocator).expect("unreachable"));
                        }
                    }
                } else if property.flags.contains(PropertyFlags::IsMethod) {
                    if Self::IS_TYPESCRIPT_ENABLED {
                        if let (Some(value), Some(key)) = (property.value, property.key) {
                            if let (ExprData::EFunction(e_func), ExprData::EString(e_str)) =
                                (&value.data, &key.data)
                            {
                                if e_str.eql_comptime(b"constructor") {
                                    // TODO(port): `*E.Function` raw ptr — Zig keeps a pointer
                                    // into `property.value` which is later overwritten; verify
                                    // aliasing is sound in Phase B.
                                    constructor_function_ = Some(e_func as *const _ as *mut _);
                                    constructor_function = constructor_function_;
                                }
                            }
                        }
                    }
                }

                if let Some(val) = property.value {
                    if let Some(name) = name_to_keep {
                        let was_anon = val.is_anonymous_named();
                        let prev_dcn = p.decorator_class_name;
                        if let ExprData::EClass(e_class) = &val.data {
                            if e_class.class_name.is_none()
                                && e_class.should_lower_standard_decorators
                            {
                                p.decorator_class_name = Some(name);
                            }
                        }
                        property.value =
                            Some(p.maybe_keep_expr_symbol_name(p.visit_expr(val), name, was_anon));
                        p.decorator_class_name = prev_dcn;
                    } else {
                        property.value = Some(p.visit_expr(val));
                    }

                    if Self::IS_TYPESCRIPT_ENABLED {
                        if constructor_function_.is_some() {
                            if let Some(value) = property.value {
                                if let ExprData::EFunction(e_func) = &value.data {
                                    constructor_function =
                                        Some(e_func as *const _ as *mut _);
                                }
                            }
                        }
                    }
                }

                if let Some(val) = property.initializer {
                    // if (property.flags.is_static and )
                    if let Some(name) = name_to_keep {
                        let was_anon = val.is_anonymous_named();
                        let prev_dcn2 = p.decorator_class_name;
                        if let ExprData::EClass(e_class) = &val.data {
                            if e_class.class_name.is_none()
                                && e_class.should_lower_standard_decorators
                            {
                                p.decorator_class_name = Some(name);
                            }
                        }
                        property.initializer =
                            Some(p.maybe_keep_expr_symbol_name(p.visit_expr(val), name, was_anon));
                        p.decorator_class_name = prev_dcn2;
                    } else {
                        property.initializer = Some(p.visit_expr(val));
                    }
                }

                // manual restore for the three `defer`s above
                p.current_scope.forbid_arguments = false;
                p.fn_only_data_visit.is_this_nested = old_is_this_captured;
                p.fn_only_data_visit.class_name_ref = old_class_name_ref;
            }

            // note: our version assumes useDefineForClassFields is true
            if Self::IS_TYPESCRIPT_ENABLED {
                if let Some(constructor) = constructor_function {
                    // SAFETY: `constructor` points into `class.properties[i].value.data`
                    // which is arena-allocated and outlives this block.
                    let constructor = unsafe { &mut *constructor };
                    let mut to_add: usize = 0;
                    for arg in constructor.func.args.iter() {
                        to_add += (arg.is_typescript_ctor_field
                            && matches!(arg.binding.data, BindingData::BIdentifier(_)))
                            as usize;
                    }

                    // if this is an expression, we can move statements after super() because there will be 0 decorators
                    let mut super_index: Option<usize> = None;
                    if class.extends.is_some() {
                        for (index, stmt) in constructor.func.body.stmts.iter().enumerate() {
                            let is_super = 'chk: {
                                let StmtData::SExpr(se) = &stmt.data else {
                                    break 'chk false;
                                };
                                let ExprData::ECall(call) = &se.value.data else {
                                    break 'chk false;
                                };
                                matches!(call.target.data, ExprData::ESuper(_))
                            };
                            if !is_super {
                                continue;
                            }
                            super_index = Some(index);
                            break;
                        }
                    }

                    if to_add > 0 {
                        // to match typescript behavior, we also must prepend to the class body
                        let mut stmts = ListManaged::from_owned_slice_in(
                            constructor.func.body.stmts,
                            p.allocator,
                        );
                        stmts.reserve(to_add);
                        let mut class_body =
                            ListManaged::from_owned_slice_in(class.properties, p.allocator);
                        class_body.reserve(to_add);
                        let mut j: usize = 0;

                        for arg in constructor.func.args.iter() {
                            if arg.is_typescript_ctor_field {
                                match &arg.binding.data {
                                    BindingData::BIdentifier(id) => {
                                        let arg_symbol = &p.symbols[id.ref_.inner_index()];
                                        let name = arg_symbol.original_name;
                                        let arg_ident = p.new_expr(
                                            E::Identifier { ref_: id.ref_ },
                                            arg.binding.loc,
                                        );

                                        let insert_at = if let Some(k) = super_index {
                                            j + k + 1
                                        } else {
                                            j
                                        };
                                        stmts.insert(
                                            insert_at,
                                            Stmt::assign(
                                                p.new_expr(
                                                    E::Dot {
                                                        target: p.new_expr(
                                                            E::This {},
                                                            arg.binding.loc,
                                                        ),
                                                        name,
                                                        name_loc: arg.binding.loc,
                                                    },
                                                    arg.binding.loc,
                                                ),
                                                arg_ident,
                                            ),
                                        );
                                        // O(N)
                                        // class_body.items.len += 1; bun.copy(...) — open a 1-slot gap at j
                                        // PORT NOTE: reshaped for borrowck — Zig manually grows
                                        // len and memmoves; we push a default then rotate.
                                        class_body.push(G::Property::default());
                                        let len = class_body.len();
                                        class_body.copy_within(j..len - 1, j + 1);
                                        // Copy the argument name symbol to prevent the class field declaration from being renamed
                                        // but not the constructor argument.
                                        let field_symbol_ref = p
                                            .declare_symbol(SymbolKind::Other, arg.binding.loc, name)
                                            .unwrap_or(id.ref_);
                                        field_symbol_ref
                                            .get_symbol_mut(&mut p.symbols)
                                            .must_not_be_renamed = true;
                                        let field_ident = p.new_expr(
                                            E::Identifier {
                                                ref_: field_symbol_ref,
                                            },
                                            arg.binding.loc,
                                        );
                                        class_body[j] = G::Property {
                                            key: Some(field_ident),
                                            ..Default::default()
                                        };
                                        j += 1;
                                    }
                                    _ => {}
                                }
                            }
                        }

                        class.properties = class_body.into_bump_slice();
                        constructor.func.body.stmts = stmts.into_bump_slice();
                    }
                }
            }

            // manual restore for the block-level `defer`
            p.pop_scope();
            p.enclosing_class_keyword = old_enclosing_class_keyword;
        }

        if p.symbols[shadow_ref.inner_index()].use_count_estimate == 0 {
            // If there was originally no class name but something inside needed one
            // (e.g. there was a static property initializer that referenced "this"),
            // store our generated name so the class expression ends up with a name.
            shadow_ref = Ref::NONE;
        } else if class.class_name.is_none() {
            class.class_name = Some(LocRef {
                ref_: Some(shadow_ref),
                loc: name_scope_loc,
            });
            Self::record_declared_symbol(p, shadow_ref).expect("unreachable");
        }

        // class name scope
        p.pop_scope();

        shadow_ref
    }

    // Try separating the list for appending, so that it's not a pointer.
    pub fn visit_stmts(
        p: &mut P<'bump, PARSER_FEATURE_TYPESCRIPT, PARSER_FEATURE_JSX, PARSER_FEATURE_SCAN_ONLY>,
        stmts: &mut ListManaged<'bump, Stmt>,
        kind: StmtsKind,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): @compileError gate
        debug_assert!(
            !Self::ONLY_SCAN_IMPORTS_AND_DO_NOT_VISIT,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        #[cfg(debug_assertions)]
        let initial_scope = p.current_scope as *const _;

        {
            // Save the current control-flow liveness. This represents if we are
            // currently inside an "if (false) { ... }" block.
            let old_is_control_flow_dead = p.is_control_flow_dead;
            // defer p.is_control_flow_dead = old_is_control_flow_dead;
            // TODO(port): defer — restore on error path (scopeguard would conflict
            // with `&mut p` borrows below). Manually restored at block end.

            let mut before = ListManaged::new_in(p.allocator);
            let mut after = ListManaged::new_in(p.allocator);

            // Preprocess TypeScript enums to improve code generation. Otherwise
            // uses of an enum before that enum has been declared won't be inlined:
            //
            //   console.log(Foo.FOO) // We want "FOO" to be inlined here
            //   const enum Foo { FOO = 0 }
            //
            // The TypeScript compiler itself contains code with this pattern, so
            // it's important to implement this optimization.
            let mut preprocessed_enums: ListManaged<'bump, &'bump [Stmt]> =
                ListManaged::new_in(p.allocator);
            if p.scopes_in_order_for_enum.count() > 0 {
                let mut found: usize = 0;
                for stmt in stmts.iter_mut() {
                    if matches!(stmt.data, StmtData::SEnum(_)) {
                        let old_scopes_in_order = p.scope_order_to_visit;
                        // defer p.scope_order_to_visit = old_scopes_in_order;

                        p.scope_order_to_visit =
                            p.scopes_in_order_for_enum.get(stmt.loc).unwrap();

                        let mut temp = ListManaged::new_in(p.allocator);
                        p.visit_and_append_stmt(&mut temp, stmt)?;
                        // TODO(port): defer — restore must run even if `?` above returns.
                        p.scope_order_to_visit = old_scopes_in_order;
                        preprocessed_enums.push(temp.into_bump_slice());
                        found += 1;
                    }
                }
                let _ = found;
            }

            if core::ptr::eq(p.current_scope, p.module_scope) {
                p.macro_.prepend_stmts = Some(&mut before);
                // TODO(port): lifetime — `before` is a local; storing `&mut before` on
                // `p` is the BACKREF pattern. Phase B should make this a raw ptr.
            }

            // visit all statements first
            let mut visited = ListManaged::with_capacity_in(stmts.len(), p.allocator);

            let prev_nearest_stmt_list = p.nearest_stmt_list;
            // defer p.nearest_stmt_list = prev_nearest_stmt_list;
            p.nearest_stmt_list = Some(&mut before);
            // TODO(port): lifetime — same BACKREF concern as `prepend_stmts` above.

            let mut preprocessed_enum_i: usize = 0;

            for stmt in stmts.iter_mut() {
                let list: &mut ListManaged<'bump, Stmt> = 'list_getter: {
                    match &stmt.data {
                        StmtData::SExportEquals(_) => {
                            // TypeScript "export = value;" becomes "module.exports = value;". This
                            // must happen at the end after everything is parsed because TypeScript
                            // moves this statement to the end when it generates code.
                            break 'list_getter &mut after;
                        }
                        StmtData::SFunction(data) => {
                            if
                            // Manually hoist block-level function declarations to preserve semantics.
                            // This is only done for function declarations that are not generators
                            // or async functions, since this is a backwards-compatibility hack from
                            // Annex B of the JavaScript standard.
                            !p.current_scope.kind_stops_hoisting()
                                && p.symbols
                                    [data.func.name.unwrap().ref_.unwrap().inner_index()]
                                .kind
                                    == SymbolKind::HoistedFunction
                            {
                                break 'list_getter &mut before;
                            }
                        }
                        StmtData::SEnum(_) => {
                            let enum_stmts = preprocessed_enums[preprocessed_enum_i];
                            preprocessed_enum_i += 1;
                            visited.extend_from_slice(enum_stmts);

                            let enum_scope_count =
                                p.scopes_in_order_for_enum.get(stmt.loc).unwrap().len();
                            p.scope_order_to_visit =
                                &p.scope_order_to_visit[enum_scope_count..];
                            continue;
                        }
                        _ => {}
                    }
                    break 'list_getter &mut visited;
                };
                p.visit_and_append_stmt(list, stmt)?;
            }

            // Transform block-level function declarations into variable declarations
            if before.len() > 0 {
                let mut let_decls = ListManaged::<G::Decl>::new_in(p.allocator);
                let mut var_decls = ListManaged::<G::Decl>::new_in(p.allocator);
                let mut non_fn_stmts = ListManaged::<Stmt>::new_in(p.allocator);
                let mut fn_stmts: HashMap<Ref, u32> = HashMap::default();

                for stmt in before.iter() {
                    match &stmt.data {
                        StmtData::SFunction(data) => {
                            // This transformation of function declarations in nested scopes is
                            // intended to preserve the hoisting semantics of the original code. In
                            // JavaScript, function hoisting works differently in strict mode vs.
                            // sloppy mode code. We want the code we generate to use the semantics of
                            // the original environment, not the generated environment. However, if
                            // direct "eval" is present then it's not possible to preserve the
                            // semantics because we need two identifiers to do that and direct "eval"
                            // means neither identifier can be renamed to something else. So in that
                            // case we give up and do not preserve the semantics of the original code.
                            let name_ref = data.func.name.unwrap().ref_.unwrap();
                            if p.current_scope.contains_direct_eval {
                                if let Some(hoisted_ref) =
                                    p.hoisted_ref_for_sloppy_mode_block_fn.get(&name_ref)
                                {
                                    // Merge the two identifiers back into a single one
                                    p.symbols[hoisted_ref.inner_index()].link = name_ref;
                                }
                                non_fn_stmts.push(*stmt);
                                continue;
                            }

                            let gpe = fn_stmts.get_or_put(name_ref);
                            let mut index = *gpe.value_ptr;
                            if !gpe.found_existing {
                                index = u32::try_from(let_decls.len()).unwrap();
                                *gpe.value_ptr = index;
                                let_decls.push(G::Decl {
                                    binding: p.b(
                                        B::Identifier { ref_: name_ref },
                                        data.func.name.unwrap().loc,
                                    ),
                                    value: None,
                                });

                                // Also write the function to the hoisted sibling symbol if applicable
                                if let Some(hoisted_ref) =
                                    p.hoisted_ref_for_sloppy_mode_block_fn.get(&name_ref)
                                {
                                    p.record_usage(name_ref);
                                    var_decls.push(G::Decl {
                                        binding: p.b(
                                            B::Identifier { ref_: *hoisted_ref },
                                            data.func.name.unwrap().loc,
                                        ),
                                        value: Some(p.new_expr(
                                            E::Identifier { ref_: name_ref },
                                            data.func.name.unwrap().loc,
                                        )),
                                    });
                                }
                            }

                            // The last function statement for a given symbol wins
                            // TODO(port): `data` is `&S.Function` borrowed from `before`;
                            // mutating `data.func.name` requires `&mut`. Phase B reshape.
                            let mut func = data.func;
                            func.name = None;
                            let_decls[index as usize].value =
                                Some(p.new_expr(E::Function { func }, stmt.loc));
                        }
                        _ => {
                            non_fn_stmts.push(*stmt);
                        }
                    }
                }
                before.clear();

                before.reserve(
                    usize::from(let_decls.len() > 0)
                        + usize::from(var_decls.len() > 0)
                        + non_fn_stmts.len(),
                );

                if let_decls.len() > 0 {
                    let decls = Decl::List::move_from_list(&mut let_decls);
                    before.push(p.s(
                        S::Local {
                            kind: LocalKind::KLet,
                            decls,
                            ..Default::default()
                        },
                        decls.at(0).value.unwrap().loc,
                    ));
                    // PERF(port): was assume_capacity
                }

                if var_decls.len() > 0 {
                    let relocated = p.maybe_relocate_vars_to_top_level(&var_decls, RelocateMode::Normal);
                    if relocated.ok {
                        if let Some(new) = relocated.stmt {
                            before.push(new);
                            // PERF(port): was assume_capacity
                        }
                    } else {
                        let decls = Decl::List::move_from_list(&mut var_decls);
                        before.push(p.s(
                            S::Local {
                                kind: LocalKind::KVar,
                                decls,
                                ..Default::default()
                            },
                            decls.at(0).value.unwrap().loc,
                        ));
                        // PERF(port): was assume_capacity
                    }
                }

                before.extend_from_slice(&non_fn_stmts);
                // PERF(port): was assume_capacity
            }

            let mut visited_count = visited.len();
            if p.is_control_flow_dead && p.options.features.dead_code_elimination {
                let mut end: usize = 0;
                for idx in 0..visited.len() {
                    let item = visited[idx];
                    if !SideEffects::should_keep_stmt_in_dead_control_flow(item, p.allocator) {
                        continue;
                    }

                    visited[end] = item;
                    end += 1;
                }
                visited_count = end;
            }

            let total_size = visited_count + before.len() + after.len();

            if total_size != stmts.len() {
                stmts.resize(total_size, Stmt::default());
                // TODO(port): Zig `resize` leaves new slots uninitialized; we fill with
                // a default. Phase B may want `set_len` + manual write to avoid the init.
            }

            // PORT NOTE: reshaped for borrowck — Zig walks a `remain` slice; we use an index.
            let mut w: usize = 0;
            for item in before.iter() {
                stmts[w] = *item;
                w += 1;
            }
            for item in visited[..visited_count].iter() {
                stmts[w] = *item;
                w += 1;
            }
            for item in after.iter() {
                stmts[w] = *item;
                w += 1;
            }

            // manual restore for the block-level `defer`s
            p.nearest_stmt_list = prev_nearest_stmt_list;
            p.is_control_flow_dead = old_is_control_flow_dead;
        }

        // Lower using declarations
        if kind != StmtsKind::SwitchStmt && p.should_lower_using_declarations(stmts.as_slice()) {
            let mut ctx = P::<
                'bump,
                PARSER_FEATURE_TYPESCRIPT,
                PARSER_FEATURE_JSX,
                PARSER_FEATURE_SCAN_ONLY,
            >::LowerUsingDeclarationsContext::init(p)?;
            ctx.scan_stmts(p, stmts.as_slice());
            *stmts = ctx.finalize(p, stmts.as_slice(), p.current_scope.parent.is_none());
        }

        #[cfg(debug_assertions)]
        // if this fails it means that scope pushing/popping is not balanced
        debug_assert!(core::ptr::eq(p.current_scope, initial_scope));

        if !p.options.features.minify_syntax || !p.options.features.dead_code_elimination {
            return Ok(());
        }

        if p.current_scope.parent.is_some() && !p.current_scope.contains_direct_eval {
            // Remove inlined constants now that we know whether any of these statements
            // contained a direct eval() or not. This can't be done earlier when we
            // encounter the constant because we haven't encountered the eval() yet.
            // Inlined constants are not removed if they are in a top-level scope or
            // if they are exported (which could be in a nested TypeScript namespace).
            if p.const_values.count() > 0 {
                let items: &mut [Stmt] = stmts.as_mut_slice();
                for stmt in items.iter_mut() {
                    match &mut stmt.data {
                        StmtData::SEmpty
                        | StmtData::SComment(_)
                        | StmtData::SDirective(_)
                        | StmtData::SDebugger
                        | StmtData::STypeScript => continue,
                        StmtData::SLocal(local) => {
                            // "using" / "await using" declarations have disposal
                            // side-effects on scope exit. Their refs can end up in
                            // `const_values` via the macro path in `visitDecl`
                            // (`could_be_macro`), so skip them here to avoid
                            // silently dropping the declaration.
                            if local.kind.is_using() {
                                continue;
                            }
                            if !local.is_export && !local.was_commonjs_export {
                                let decls: &mut [Decl] = local.decls.slice_mut();
                                let mut end: usize = 0;
                                let mut any_decl_in_const_values =
                                    local.kind == LocalKind::KConst;
                                for idx in 0..decls.len() {
                                    let decl = decls[idx];
                                    if let BindingData::BIdentifier(id) = &decl.binding.data {
                                        if p.const_values.contains(&id.ref_) {
                                            any_decl_in_const_values = true;
                                            let symbol = &p.symbols[id.ref_.inner_index()];
                                            if symbol.use_count_estimate == 0 {
                                                // Skip declarations that are constants with zero usage
                                                continue;
                                            }
                                        }
                                    }
                                    decls[end] = decl;
                                    end += 1;
                                }
                                local.decls.len = end as u32;
                                if any_decl_in_const_values {
                                    if end == 0 {
                                        *stmt = stmt.to_empty();
                                    }
                                    continue;
                                }
                            }
                        }
                        _ => {}
                    }

                    // Break after processing relevant statements
                    break;
                }
            }
        }

        let mut is_control_flow_dead = false;

        let mut output = ListManaged::with_capacity_in(stmts.len(), p.allocator);

        let dead_code_elimination = p.options.features.dead_code_elimination;
        for stmt in stmts.iter().copied() {
            if is_control_flow_dead
                && dead_code_elimination
                && !SideEffects::should_keep_stmt_in_dead_control_flow(stmt, p.allocator)
            {
                // Strip unnecessary statements if the control flow is dead here
                continue;
            }

            // Inline single-use variable declarations where possible:
            //
            //   // Before
            //   let x = fn();
            //   return x.y();
            //
            //   // After
            //   return fn().y();
            //
            // The declaration must not be exported. We can't just check for the
            // "export" keyword because something might do "export {id};" later on.
            // Instead we just ignore all top-level declarations for now. That means
            // this optimization currently only applies in nested scopes.
            //
            // Ignore declarations if the scope is shadowed by a direct "eval" call.
            // The eval'd code may indirectly reference this symbol and the actual
            // use count may be greater than 1.
            if !core::ptr::eq(p.current_scope, p.module_scope)
                && !p.current_scope.contains_direct_eval
            {
                // Keep inlining variables until a failure or until there are none left.
                // That handles cases like this:
                //
                //   // Before
                //   let x = fn();
                //   let y = x.prop;
                //   return y;
                //
                //   // After
                //   return fn().prop;
                //
                'inner: while output.len() > 0 {
                    // Ignore "var" declarations since those have function-level scope and
                    // we may not have visited all of their uses yet by this point. We
                    // should have visited all the uses of "let" and "const" declarations
                    // by now since they are scoped to this block which we just finished
                    // visiting.
                    let prev_idx = output.len() - 1;
                    let prev_statement = &mut output[prev_idx];
                    match &mut prev_statement.data {
                        StmtData::SLocal(local) => {
                            // "using" / "await using" declarations have disposal
                            // side-effects on scope exit, so they must not be
                            // removed by inlining their initializer into the use.
                            if local.decls.len == 0
                                || local.kind == LocalKind::KVar
                                || local.kind.is_using()
                                || local.is_export
                            {
                                break;
                            }

                            let last: &mut Decl = local.decls.last_mut().unwrap();
                            // The variable must be initialized, since we will be substituting
                            // the value into the usage.
                            if last.value.is_none() {
                                break;
                            }

                            // The binding must be an identifier that is only used once.
                            // Ignore destructuring bindings since that's not the simple case.
                            // Destructuring bindings could potentially execute side-effecting
                            // code which would invalidate reordering.

                            match &last.binding.data {
                                BindingData::BIdentifier(ident) => {
                                    let id = ident.ref_;

                                    let symbol: &Symbol = &p.symbols[id.inner_index()];

                                    // Try to substitute the identifier with the initializer. This will
                                    // fail if something with side effects is in between the declaration
                                    // and the usage.
                                    if symbol.use_count_estimate == 1 {
                                        if p.substitute_single_use_symbol_in_stmt(
                                            stmt,
                                            id,
                                            last.value.unwrap(),
                                        ) {
                                            match local.decls.len {
                                                1 => {
                                                    local.decls.len = 0;
                                                    let new_len = output.len() - 1;
                                                    output.truncate(new_len);
                                                    continue 'inner;
                                                }
                                                _ => {
                                                    local.decls.len -= 1;
                                                    continue 'inner;
                                                }
                                            }
                                        }
                                    }
                                }
                                _ => {}
                            }
                        }
                        _ => {}
                    }
                    break;
                }
            }

            // don't merge super calls to ensure they are called before "this" is accessed
            if stmt.is_super_call() {
                output.push(stmt);
                continue;
            }

            // The following calls to `joinWithComma` are only enabled during bundling. We do this
            // to avoid changing line numbers too much for source maps

            match &stmt.data {
                StmtData::SEmpty => continue,

                // skip directives for now
                StmtData::SDirective(_) => continue,

                StmtData::SLocal(local) => {
                    // Merge adjacent local statements
                    if output.len() > 0 {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if let StmtData::SLocal(prev_local) = &mut prev_stmt.data {
                            if local.can_merge_with(prev_local) {
                                prev_local.decls.append_slice(p.allocator, local.decls.slice());
                                continue;
                            }
                        }
                    }
                }

                StmtData::SExpr(s_expr) => {
                    // Merge adjacent expression statements
                    if output.len() > 0 {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if matches!(prev_stmt.data, StmtData::SExpr(_))
                            && !prev_stmt.is_super_call()
                            && p.options.runtime_merge_adjacent_expression_statements()
                        {
                            let StmtData::SExpr(prev_expr) = &mut prev_stmt.data else {
                                unreachable!()
                            };
                            prev_expr.does_not_affect_tree_shaking =
                                prev_expr.does_not_affect_tree_shaking
                                    && s_expr.does_not_affect_tree_shaking;
                            prev_expr.value =
                                prev_expr.value.join_with_comma(s_expr.value, p.allocator);
                            continue;
                        } else if
                        //
                        // Input:
                        //      var f;
                        //      f = 123;
                        // Output:
                        //      var f = 123;
                        //
                        // This doesn't handle every case. Only the very simple one.
                        matches!(prev_stmt.data, StmtData::SLocal(_))
                            && matches!(s_expr.value.data, ExprData::EBinary(_))
                        {
                            let StmtData::SLocal(prev_local) = &mut prev_stmt.data else {
                                unreachable!()
                            };
                            let ExprData::EBinary(bin_assign) = &s_expr.value.data else {
                                unreachable!()
                            };
                            if prev_local.decls.len == 1
                                && bin_assign.op == BinOp::BinAssign
                                // we can only do this with var because var is hoisted
                                // the statement we are merging into may use the statement before its defined.
                                && prev_local.kind == LocalKind::KVar
                            {
                                if let ExprData::EIdentifier(left_id) = &bin_assign.left.data {
                                    let decl = &mut prev_local.decls.slice_mut()[0];
                                    if let BindingData::BIdentifier(bid) = &decl.binding.data {
                                        if bid.ref_.eql(left_id.ref_)
                                            // If the value was assigned, we shouldn't merge it incase it was used in the current statement
                                            // https://github.com/oven-sh/bun/issues/2948
                                            // We don't have a more granular way to check symbol usage so this is the best we can do
                                            && decl.value.is_none()
                                        {
                                            decl.value = Some(bin_assign.right);
                                            p.ignore_usage(left_id.ref_);
                                            continue;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
                StmtData::SSwitch(s_switch) => {
                    // Absorb a previous expression statement
                    if output.len() > 0
                        && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if matches!(prev_stmt.data, StmtData::SExpr(_)) && !prev_stmt.is_super_call()
                        {
                            let StmtData::SExpr(prev_expr) = &prev_stmt.data else {
                                unreachable!()
                            };
                            // TODO(port): `s_switch` is `&S.Switch` borrowed from `stmt`;
                            // mutation requires `&mut`. Phase B reshape.
                            s_switch.test_ = prev_expr
                                .value
                                .join_with_comma(s_switch.test_, p.allocator);
                            output.truncate(prev_idx);
                        }
                    }
                }
                StmtData::SIf(s_if) => {
                    // Absorb a previous expression statement
                    if output.len() > 0
                        && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if matches!(prev_stmt.data, StmtData::SExpr(_)) && !prev_stmt.is_super_call()
                        {
                            let StmtData::SExpr(prev_expr) = &prev_stmt.data else {
                                unreachable!()
                            };
                            s_if.test_ = prev_expr.value.join_with_comma(s_if.test_, p.allocator);
                            output.truncate(prev_idx);
                        }
                    }

                    // TODO: optimize jump
                }

                StmtData::SReturn(ret) => {
                    // Merge return statements with the previous expression statement
                    if output.len() > 0
                        && ret.value.is_some()
                        && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if matches!(prev_stmt.data, StmtData::SExpr(_)) && !prev_stmt.is_super_call()
                        {
                            let StmtData::SExpr(prev_expr) = &prev_stmt.data else {
                                unreachable!()
                            };
                            ret.value = Some(
                                prev_expr
                                    .value
                                    .join_with_comma(ret.value.unwrap(), p.allocator),
                            );
                            *prev_stmt = stmt;
                            continue;
                        }
                    }

                    is_control_flow_dead = true;
                }

                StmtData::SBreak(_) | StmtData::SContinue(_) => {
                    is_control_flow_dead = true;
                }

                StmtData::SThrow(s_throw) => {
                    // Merge throw statements with the previous expression statement
                    if output.len() > 0
                        && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if matches!(prev_stmt.data, StmtData::SExpr(_)) && !prev_stmt.is_super_call()
                        {
                            let StmtData::SExpr(prev_expr) = &prev_stmt.data else {
                                unreachable!()
                            };
                            *prev_stmt = p.s(
                                S::Throw {
                                    value: prev_expr
                                        .value
                                        .join_with_comma(s_throw.value, p.allocator),
                                },
                                stmt.loc,
                            );
                            continue;
                        }
                    }

                    is_control_flow_dead = true;
                }

                _ => {}
            }

            output.push(stmt);
        }

        // stmts.deinit(); — Drop handles freeing the old buffer
        *stmts = output;
        Ok(())
    }
}

pub fn fn_body_contains_use_strict(body: &[Stmt]) -> Option<logger::Loc> {
    for stmt in body {
        // "use strict" has to appear at the top of the function body
        // but we can allow comments
        match &stmt.data {
            StmtData::SComment(_) => {
                continue;
            }
            StmtData::SDirective(dir) => {
                if dir.value == b"use strict" {
                    return Some(stmt.loc);
                }
            }
            StmtData::SEmpty => {}
            _ => return None,
        }
    }

    None
}

// TODO(port): the following are placeholder imports referenced above whose exact
// Rust paths depend on how `crate::ast` lays out enum variants and flag
// types. Phase B fixes the `use` lines.
use crate::ast::Expr as _ExprAlias; // keep `Expr::Tag` callsites in mind
use crate::ast::PropertyFlags;
use crate::ast::PropertyKind;
use crate::ast::Scope::Kind as ScopeKind;
use crate::ast::StrictMode;
use crate::ast::Symbol::Kind as SymbolKind;
use crate::ast::S::Local::Kind as LocalKind;
use crate::ast::E::Binary::Op as BinOp;
use crate::RelocateMode;
use crate::StrictModeFeature;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/js_parser/ast/visit.zig (1415 lines)
//   confidence: medium
//   todos:      26
//   notes:      Mixin pattern (Visit returns struct of methods on P) ported as ZST + assoc fns; many `defer` state-restores done manually (need scopeguard on error paths); tagged-union payload mutability (`&mut` through StmtData/ExprData) needs Phase B reshape; `'bump` lifetime threading is approximate.
// ──────────────────────────────────────────────────────────────────────────
} // end mod _draft
