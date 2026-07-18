#![warn(unused_must_use)]
//! AST visitor pass: visits statements, expressions, bindings, function bodies,
//! classes, and declarations. This is the second pass after parsing.

pub mod visit_binary;
pub mod visit_expr;
pub mod visit_stmt;

use crate::lexer as js_lexer;
use crate::p::{LowerUsingDeclarationsContext, P};
use crate::parser::{
    ExprIn, FnOnlyDataVisit, FnOrArrowDataVisit, ImportItemForNamespaceMap, PrependTempRefsOpts,
    Ref, RelocateVarsMode, ScopeOrder, StmtsKind, StrictModeFeature, StringVoidMap, TempRef,
    VisitArgsOpts, is_eval_or_arguments,
};
use bun_core::alloc_impl::{ArenaVec as BumpVec, ArenaVecExt as _};
use bun_ast as js_ast;
use bun_ast::G::{Decl, PropertyKind};
use bun_ast::OpCode;
use bun_ast::b::B as BData;
use bun_ast::flags;
use bun_ast::s::Kind as LocalKind;
use bun_ast::scope::{Kind as ScopeKind, Member as ScopeMember};
use bun_ast::symbol::Kind as SymbolKind;
use bun_ast::{
    AssignTarget, B, Binding, BindingNodeIndex, E, Expr, ExprData, ExprNodeList, G, LocRef, S,
    Stmt, StmtData, Symbol,
};
use bun_core::collections::VecExt;
// `parser::SideEffects` is a stub enum without the assoc fns; the real
// `should_keep_stmt_in_dead_control_flow` lives on `ast::side_effects::SideEffects`.
use crate::scan::scan_side_effects::SideEffects;
use bun_ast::StrictModeKind;
use bun_core::collections::HashMap;
use core::ptr::NonNull;

// In the AST crate, ListManaged is arena-backed.
type ListManaged<'bump, T> = BumpVec<'bump, T>;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    // Thin alias of `current_scope_mut()` kept for local readability.
    #[inline(always)]
    fn vis_scope(&mut self) -> &mut js_ast::Scope {
        self.current_scope_mut()
    }

    pub fn visit_stmts_and_prepend_temp_refs(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        opts: &mut PrependTempRefsOpts,
    ) -> Result<(), crate::js_parser::Error> {
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        // p.temp_refs_to_declare.deinit(p.arena); + reset to empty
        self.temp_refs_to_declare = BumpVec::new_in(self.arena);

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
            .append(bun_ast::DeclaredSymbol {
                ref_: r#ref,
                is_top_level: self.current_scope == self.module_scope,
            })
            .expect("oom");
    }

    pub fn visit_func(&mut self, mut func: G::Fn, open_parens_loc: bun_ast::Loc) -> G::Fn {
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        // FnOnlyDataVisit holds `Option<&'a Cell<Ref>>`; save/restore via
        // `take` so the old value is moved out before we overwrite the field.
        let old_fn_or_arrow_data = self.fn_or_arrow_data_visit;
        let old_fn_only_data = core::mem::take(&mut self.fn_only_data_visit);
        self.fn_or_arrow_data_visit = FnOrArrowDataVisit {
            is_async: func.flags.contains(flags::Function::IsAsync),
            ..Default::default()
        };
        self.fn_only_data_visit = FnOnlyDataVisit {
            is_this_nested: true,
            arguments_ref: func.arguments_ref.to_nullable(),
            ..Default::default()
        };

        if let Some(name) = func.name {
            if let Some(name_ref) = name.ref_.to_nullable() {
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
        let body_stmts: &'a [Stmt] = func.body.stmts.slice();

        self.push_scope_for_visit_pass(ScopeKind::FunctionArgs, open_parens_loc)
            .expect("unreachable");
        let args: &mut [G::Arg] = func.args.slice_mut();
        self.visit_args(
            args,
            &VisitArgsOpts {
                has_rest_arg: func.flags.contains(flags::Function::HasRestArg),
                body: body_stmts,
                is_unique_formal_parameters: true,
            },
        );

        self.push_scope_for_visit_pass(ScopeKind::FunctionBody, body_loc)
            .expect("unreachable");
        // Stmt is Copy — copy the slice into a bump-backed Vec.
        let mut stmts = BumpVec::with_capacity_in(body_stmts.len(), self.arena);
        stmts.extend_from_slice(body_stmts);
        let mut temp_opts = PrependTempRefsOpts {
            kind: StmtsKind::FnBody,
            fn_body_loc: Some(body_loc),
        };
        let rc_binding = self.react_compiler_candidate_name.take();
        if rc_binding.is_some() {
            self.react_compiler_pending = Some(bun_react_compiler::PendingCompile {
                args: func.args,
                flags: func.flags,
                body_loc,
                args_loc: func.open_parens_loc,
                binding: func
                    .name
                    .map(|n| n.ref_)
                    .filter(|r| r.is_valid())
                    .or(rc_binding),
                in_react_hoc: core::mem::take(&mut self.react_compiler_in_react_hoc),
            });
        }
        self.visit_stmts_and_prepend_temp_refs(&mut stmts, &mut temp_opts)
            .expect("unreachable");
        self.react_compiler_pending = None;
        if let Some(result) = self.react_compiler_result.take() {
            func.args = result.args;
            func.flags = result.flags;
            if let Some(b) = rc_binding.filter(|r| *r != js_ast::Ref::NONE) {
                self.record_usage(b);
            }
        }

        if self.options.features.react_fast_refresh {
            // react_refresh.hook_ctx_storage is `Option<NonNull<Option<HookContext>>>`
            // pointing at a stack-local on the visitStmt caller frame.
            // `ReactRefresh::hook_ctx_mut` centralises the raw-pointer deref and returns a
            // borrow detached from `self` (the storage is on the caller's stack frame), so
            // it can be held across the `&mut self` method call below.
            let hook_ctx = self
                .react_refresh
                .hook_ctx_mut()
                .expect("caller did not init hook storage. any function can have react hooks!");
            if let Some(hook) = hook_ctx.as_ref() {
                // `handle_react_refresh_post_visit_function_body` does not re-enter
                // `hook_ctx_storage` (it only touches `stmts` and unrelated `P` fields).
                self.handle_react_refresh_post_visit_function_body(&mut stmts, hook);
            }
        }

        func.body = G::FnBody {
            stmts: bun_ast::StoreSlice::new_mut(stmts.into_bump_slice_mut()),
            loc: body_loc,
        };

        self.pop_scope();
        self.pop_scope();

        self.fn_or_arrow_data_visit = old_fn_or_arrow_data;
        self.fn_only_data_visit = old_fn_only_data;

        func
    }

    pub fn visit_args(&mut self, args: &mut [G::Arg], opts: &VisitArgsOpts) {
        let strict_loc = fn_body_contains_use_strict(opts.body);
        let has_simple_args = Self::is_simple_parameter_list(args, opts.has_rest_arg);
        // StringVoidMap::get returns a pool guard; Drop releases.
        let mut duplicate_args_check: Option<
            bun_core::collections::pool::PoolGuard<'static, StringVoidMap>,
        > = None;

        // Section 15.2.1 Static Semantics: Early Errors: "It is a Syntax Error if
        // FunctionBodyContainsUseStrict of FunctionBody is true and
        // IsSimpleParameterList of FormalParameters is false."
        if let Some(strict_loc) = strict_loc
            && !has_simple_args
        {
            self.log()
                .add_range_error(
                    Some(self.source),
                    self.source.range_of_string(strict_loc),
                    b"Cannot use a \"use strict\" directive in a function with a non-simple parameter list".as_slice(),
                );
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
            if arg.ts_decorators.len_u32() > 0 {
                self.visit_ts_decorators(&mut arg.ts_decorators);
            }

            // reborrow per-iter.
            let dup: Option<&mut StringVoidMap> = duplicate_args_check.as_deref_mut();
            self.visit_binding(arg.binding, dup);
            if let Some(default) = arg.default.as_mut() {
                self.visit_expr(default);
            }
        }
    }

    // `Vec<Expr>` is not `Copy`; mutate in place.
    pub fn visit_ts_decorators(&mut self, decs: &mut ExprNodeList) {
        for dec in decs.slice_mut() {
            self.visit_expr(dec);
        }
    }

    pub fn visit_decls<const IS_POSSIBLY_DECL_TO_REMOVE: bool>(
        &mut self,
        decls: &mut [G::Decl],
        was_const: bool,
    ) -> usize {
        let mut j: usize = 0;
        // Iterate by index so kept entries can be written back through `decls[j]`
        // while scanning ahead.
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
                // `replacement` is a `BackRef` so the
                // borrow of `self.options` does not survive across `visit_expr_in_out(&mut self)`.
                // `BackRef` invariant: `self.options.features.replace_exports` is never mutated
                // during the visit pass, so the entry strictly outlives this loop body.
                let mut replacement: Option<
                    bun_core::ptr::BackRef<crate::parser::Runtime::ReplaceableExport>,
                > = None;
                if IS_POSSIBLY_DECL_TO_REMOVE {
                    if let BData::BIdentifier(id) = decl.binding.data {
                        let id_ref = id.r#ref;
                        let name = self.load_name_from_ref(id_ref);
                        let found = self
                            .options
                            .features
                            .replace_exports
                            .get_ptr(name)
                            .map(|r| (bun_core::ptr::BackRef::new(r), r.is_replace()));
                        if let Some((ptr, is_replace)) = found {
                            replacement = Some(ptr);
                            if self.options.features.dead_code_elimination && !is_replace {
                                self.is_control_flow_dead = true;
                            }
                        }
                    }
                }

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
                                let id = id.get();
                                self.decorator_class_name = Some(self.load_name_from_ref(id.r#ref));
                            }
                        }
                    }
                }
                if self.react_compiler.is_some()
                    && self.current_scope == self.module_scope
                    && let BData::BIdentifier(id) = decl.binding.data
                    && let Some(in_hoc) = self.react_compiler_candidate_expr(&val)
                {
                    self.react_compiler_candidate_name = Some(id.r#ref);
                    self.react_compiler_in_react_hoc = in_hoc;
                }
                self.visit_expr_in_out(
                    &mut val,
                    ExprIn {
                        is_immediately_assigned_to_decl: true,
                        ..Default::default()
                    },
                );
                self.react_compiler_candidate_name = None;
                self.react_compiler_in_react_hoc = false;
                decl.value = Some(val);
                self.decorator_class_name = prev_decorator_class_name;

                if self.options.features.react_fast_refresh {
                    // When hooks are immediately assigned to something, we need to hash the binding.
                    if let Some(last_hook) = self.react_refresh.last_hook_seen {
                        if let Some(call) = decl.value.unwrap().data.e_call() {
                            if core::ptr::eq(last_hook, &raw const *call) {
                                // disjoint field borrows — `react_refresh.hook_ctx_storage`
                                // points at caller-frame stack storage (detached lifetime via
                                // `hook_ctx_mut`), and `symbols` is an independent field of `P`.
                                let hasher = &mut self
                                    .react_refresh
                                    .hook_ctx_mut()
                                    .unwrap()
                                    .as_mut()
                                    .unwrap()
                                    .hasher;
                                decl.binding
                                    .data
                                    .write_to_hasher(hasher, self.symbols.as_mut_slice());
                            }
                        }
                    }
                }

                if self.should_unwrap_common_js_to_esm() {
                    if prev_require_to_convert_count < self.imports_to_convert_from_require.len() {
                        if let BData::BIdentifier(id) = decl.binding.data {
                            let ref_ = id.r#ref;
                            if let Some(value) = decl.value {
                                if let ExprData::ERequireString(req) = value.data {
                                    if req.unwrapped_id != u32::MAX {
                                        self.imports_to_convert_from_require
                                            [req.unwrapped_id as usize]
                                            .namespace
                                            .ref_ = ref_;
                                        self.import_items_for_namespace
                                            .insert(ref_, ImportItemForNamespaceMap::default());
                                        continue 'outer;
                                    }
                                }
                            }
                        }
                    }
                }

                if IS_POSSIBLY_DECL_TO_REMOVE {
                    self.is_control_flow_dead = orig_dead;
                    if let BData::BIdentifier(_) = decl.binding.data {
                        if let Some(_ptr) = replacement {
                            // `BackRef::get` — entry lives in `self.options.features.replace_exports`,
                            // which is not mutated during the visit pass.
                            let replacer = _ptr.get();
                            if !self.replace_decl_and_possibly_remove(decl, replacer) {
                                continue 'outer;
                            }
                        }
                    }
                }

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
                if let BData::BIdentifier(id) = decl.binding.data {
                    let id_ref = id.r#ref;
                    let name = self.load_name_from_ref(id_ref);
                    if let Some(_ptr) = self
                        .options
                        .features
                        .replace_exports
                        .get_ptr(name)
                        .map(bun_core::ptr::BackRef::new)
                    {
                        // `BackRef::get` — entry lives in `self.options.features.replace_exports`,
                        // which is not mutated during the visit pass.
                        let replacer = _ptr.get();
                        if !self.replace_decl_and_possibly_remove(decl, replacer) {
                            let is_after = self.vis_scope().is_after_const_local_prefix;
                            self.visit_decl(decl, false, was_const && !is_after, false);
                        } else {
                            continue 'outer;
                        }
                    }
                }
            }

            // out_decls[j] = decl.*;
            if j != i - 1 {
                // SAFETY: j < i-1 < len; src/dst non-overlapping; Decl has no Drop.
                // Derive both pointers from a single `as_mut_ptr()` so the src `*const`
                // shares provenance with dst (Stacked Borrows: a separate `as_ptr()`
                // SharedRO tag would be popped by the later `as_mut_ptr()` Unique).
                unsafe {
                    let base = decls.as_mut_ptr();
                    core::ptr::copy_nonoverlapping(base.add(i - 1), base.add(j), 1);
                }
            }
            j += 1;
        }

        j
    }

    pub fn visit_binding_and_expr_for_macro(&mut self, binding: Binding, expr: Expr) {
        match binding.data {
            BData::BObject(bound_object) => {
                let bound_object = bound_object.get();
                if let ExprData::EObject(mut object) = expr.data {
                    if object.was_originally_macro {
                        for property in bound_object.properties() {
                            if property.flags.contains(flags::Property::IsSpread) {
                                return;
                            }
                        }
                        let mut end: u32 = 0;
                        for property in bound_object.properties() {
                            if let Some(name) = property.key.as_string_literal(self.arena) {
                                if let Some(query) = object.as_property(name) {
                                    match query.expr.data {
                                        ExprData::EObject(_) | ExprData::EArray(_) => {
                                            self.visit_binding_and_expr_for_macro(
                                                property.value,
                                                query.expr,
                                            );
                                        }
                                        _ => {
                                            if self.options.features.inlining {
                                                if let BData::BIdentifier(id) = property.value.data
                                                {
                                                    self.const_values
                                                        .put(id.r#ref, query.expr)
                                                        .expect("oom");
                                                }
                                            }
                                        }
                                    }
                                    // output_properties[end] = output_properties[query.i]
                                    // SAFETY: both indices < object.properties.len; G::Property
                                    // has no Drop; src/dst may alias when end == query.i.
                                    unsafe {
                                        let props_ptr = object.properties.slice_mut().as_mut_ptr();
                                        core::ptr::copy(
                                            props_ptr.add(query.i as usize),
                                            props_ptr.add(end as usize),
                                            1,
                                        );
                                    }
                                    end += 1;
                                }
                            }
                        }
                        object.properties.truncate(end as usize);
                    }
                }
            }
            BData::BArray(bound_array) => {
                let bound_array = bound_array.get();
                if let ExprData::EArray(mut array) = expr.data {
                    if array.was_originally_macro && !bound_array.has_spread {
                        let bound_items = bound_array.items();
                        let trunc_n = array.items.len().min(bound_items.len());
                        array.items.truncate(trunc_n);
                        let n = array.items.len_u32() as usize;
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
                let id_ref = id.r#ref;
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
                let original_name: &'a [u8] = self.symbols[id_ref.inner_index() as usize]
                    .original_name
                    .slice();
                decl.value = Some(self.maybe_keep_expr_symbol_name(
                    decl.value.unwrap(),
                    original_name,
                    was_anonymous_named_expr,
                ));
            }
            BData::BObject(_) | BData::BArray(_) => {
                if Self::ALLOW_MACROS {
                    if could_be_macro && let Some(value) = decl.value {
                        self.visit_binding_and_expr_for_macro(decl.binding, value);
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
                self.visit_expr_in_out(
                    &mut st.value,
                    ExprIn {
                        assign_target,
                        ..Default::default()
                    },
                );
            }
            StmtData::SLocal(mut st) => {
                for dec in st.decls.slice_mut() {
                    self.visit_binding(dec.binding, None);
                    if let Some(val) = dec.value.as_mut() {
                        self.visit_expr(val);
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
        if !self.stack_check.is_safe_to_recurse() {
            self.report_stack_overflow(binding.loc);
            return;
        }
        match binding.data {
            BData::BMissing(_) => {}
            BData::BIdentifier(bind) => {
                let bind = bind.get();
                self.record_declared_symbol(bind.r#ref);
                // SAFETY: original_name is arena-owned, valid for 'a.
                let name: &'a [u8] = self.symbols[bind.r#ref.inner_index() as usize]
                    .original_name
                    .slice();
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
                        self.log().add_range_error_fmt(
                            Some(self.source),
                            js_lexer::range_of_identifier(self.source, binding.loc),
                            format_args!(
                                "\"{}\" cannot be bound multiple times in the same parameter list",
                                bstr::BStr::new(name)
                            ),
                        );
                    }
                }
            }
            BData::BArray(mut bind) => {
                // Arena-owned B::Array valid for 'a; exclusive during visit pass.
                for item in bind.items_mut() {
                    self.visit_binding(item.binding, duplicate_arg_check.as_deref_mut());
                    if let Some(default_value) = item.default_value {
                        let was_anonymous_named_expr = default_value.is_anonymous_named();
                        let prev_decorator_class_name2 = self.decorator_class_name;
                        if was_anonymous_named_expr {
                            if let ExprData::EClass(e_class) = &default_value.data {
                                if e_class.should_lower_standard_decorators {
                                    if let BData::BIdentifier(id) = item.binding.data {
                                        let id = id.get();
                                        self.decorator_class_name =
                                            Some(self.load_name_from_ref(id.r#ref));
                                    }
                                }
                            }
                        }
                        self.visit_expr(item.default_value.as_mut().unwrap());
                        self.decorator_class_name = prev_decorator_class_name2;

                        if let BData::BIdentifier(bind_) = item.binding.data {
                            let bind_ = bind_.get();
                            let name: &'a [u8] = self.symbols[bind_.r#ref.inner_index() as usize]
                                .original_name
                                .slice();
                            item.default_value = Some(self.maybe_keep_expr_symbol_name(
                                item.default_value.expect("unreachable"),
                                name,
                                was_anonymous_named_expr,
                            ));
                        }
                    }
                }
            }
            BData::BObject(mut bind) => {
                // Arena-owned B::Object valid for 'a; exclusive during visit pass.
                for property in bind.properties_mut() {
                    if !property.flags.contains(flags::Property::IsSpread) {
                        self.visit_expr(&mut property.key);
                    }

                    self.visit_binding(property.value, duplicate_arg_check.as_deref_mut());
                    if let Some(default_value) = property.default_value {
                        let was_anonymous_named_expr = default_value.is_anonymous_named();
                        let prev_decorator_class_name3 = self.decorator_class_name;
                        if was_anonymous_named_expr {
                            if let ExprData::EClass(e_class) = &default_value.data {
                                if e_class.should_lower_standard_decorators {
                                    if let BData::BIdentifier(id) = property.value.data {
                                        let id = id.get();
                                        self.decorator_class_name =
                                            Some(self.load_name_from_ref(id.r#ref));
                                    }
                                }
                            }
                        }
                        self.visit_expr(property.default_value.as_mut().unwrap());
                        self.decorator_class_name = prev_decorator_class_name3;

                        if let BData::BIdentifier(bind_) = property.value.data {
                            let bind_ = bind_.get();
                            let name: &'a [u8] = self.symbols[bind_.r#ref.inner_index() as usize]
                                .original_name
                                .slice();
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
        let block_stmts: &[Stmt] = match stmt.data {
            StmtData::SBlock(b) => b.stmts.slice(),
            _ => unreachable!(),
        };
        let mut stmts = BumpVec::with_capacity_in(block_stmts.len(), self.arena);
        stmts.extend_from_slice(block_stmts);
        self.visit_stmts(&mut stmts, kind).expect("unreachable");
        self.pop_scope();
        let items: &'a mut [Stmt] = stmts.into_bump_slice_mut();
        if let StmtData::SBlock(mut b) = new_stmt.data {
            b.stmts = bun_ast::StoreSlice::new_mut(items);
        }
        if self.options.features.minify_syntax {
            // `stmts` was consumed above; `items` aliases the slice now
            // stored in `s_block.stmts`.
            new_stmt = self.stmts_to_single_stmt(stmt.loc, items);
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

        let mut stmts = BumpVec::with_capacity_in(1, self.arena);
        stmts.push(stmt);
        self.visit_stmts(&mut stmts, kind).expect("unreachable");

        if has_if_scope {
            self.pop_scope();
        }

        self.stmts_to_single_stmt(stmt.loc, stmts.into_bump_slice_mut())
    }

    pub fn visit_class(
        &mut self,
        name_scope_loc: bun_ast::Loc,
        class: &mut G::Class,
        default_name_ref: Ref,
    ) -> Ref {
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        self.visit_ts_decorators(&mut class.ts_decorators);

        if let Some(name) = class.class_name {
            self.record_declared_symbol(name.ref_);
        }

        self.push_scope_for_visit_pass(ScopeKind::ClassName, name_scope_loc)
            .expect("unreachable");
        let old_enclosing_class_keyword = self.enclosing_class_keyword;
        self.enclosing_class_keyword = class.class_keyword;
        self.vis_scope()
            .recursive_set_strict_mode(StrictModeKind::ImplicitStrictModeClass);
        // `FnOnlyDataVisit::class_name_ref` is `Option<&'a Cell<Ref>>`, so the
        // shadow ref must outlive the parser borrow. Allocate it in the bump arena.
        // `Cell` lets us hand out a shared `&'a Cell<Ref>` to nested frames while
        // still reading/writing it here, with no raw-pointer `unsafe`.
        let shadow_ref: &'a core::cell::Cell<Ref> =
            core::cell::Cell::from_mut(self.arena.alloc(Ref::NONE));

        // Insert a shadowing name that spans the whole class, which matches
        // JavaScript's semantics. The class body (and extends clause) "captures" the
        // original value of the name. This matters for class statements because the
        // symbol can be re-assigned to something else later. The captured values
        // must be the original value of the name, not the re-assigned value.
        // Use "const" for this symbol to match JavaScript run-time semantics. You
        // are not allowed to assign to this symbol (it throws a TypeError).
        if let Some(name) = class.class_name {
            let name_ref = name.ref_;
            shadow_ref.set(name_ref);
            let original_name: &'a [u8] = self.symbols[name_ref.inner_index() as usize]
                .original_name
                .slice();
            self.vis_scope()
                .members
                .put(
                    original_name,
                    ScopeMember {
                        ref_: name.ref_,
                        loc: name.loc,
                    },
                )
                .expect("oom");
        } else {
            let name_str: &'a [u8] = if default_name_ref.is_empty() {
                b"_this"
            } else {
                b"_default"
            };
            let new_ref = self
                .new_symbol(SymbolKind::Constant, name_str)
                .expect("unreachable");
            shadow_ref.set(new_ref);
        }

        self.record_declared_symbol(shadow_ref.get());

        if let Some(extends) = class.extends.as_mut() {
            self.visit_expr(extends);
        }

        {
            self.push_scope_for_visit_pass(ScopeKind::ClassBody, class.body_loc)
                .expect("unreachable");
            // defer { p.pop_scope(); p.enclosing_class_keyword = old_enclosing_class_keyword; }
            // — manual restore at block end below; no early returns in this block.

            let mut constructor_function: Option<bun_ast::StoreRef<E::Function>> = None;
            let properties: &mut [G::Property] = class.properties.slice_mut();
            for property in properties.iter_mut() {
                if property.kind == PropertyKind::ClassStaticBlock {
                    let old_fn_or_arrow_data = self.fn_or_arrow_data_visit;
                    let old_fn_only_data = core::mem::take(&mut self.fn_only_data_visit);
                    self.fn_or_arrow_data_visit = FnOrArrowDataVisit::default();
                    self.fn_only_data_visit = FnOnlyDataVisit {
                        is_this_nested: true,
                        is_new_target_allowed: true,
                        class_name_ref: Some(shadow_ref),

                        // TODO: down transpilation
                        should_replace_this_with_class_name_ref: false,
                        ..Default::default()
                    };
                    // PropertyKind::ClassStaticBlock guarantees `Some`; arena-owned for 'a.
                    let csb = property.class_static_block_mut().unwrap();
                    self.push_scope_for_visit_pass(ScopeKind::ClassStaticInit, csb.loc)
                        .expect("unreachable");

                    // Make it an error to use "arguments" in a static class block
                    self.vis_scope().forbid_arguments = true;

                    // Stmt is Copy — copy the slice into a bump-backed Vec.
                    let csb_stmts = csb.stmts.slice();
                    let mut list = BumpVec::with_capacity_in(csb_stmts.len(), self.arena);
                    list.extend_from_slice(csb_stmts);
                    self.visit_stmts(&mut list, StmtsKind::FnBody)
                        .expect("unreachable");
                    csb.stmts = Vec::from_bump_vec(list);
                    self.pop_scope();

                    self.fn_or_arrow_data_visit = old_fn_or_arrow_data;
                    self.fn_only_data_visit = old_fn_only_data;

                    continue;
                }
                self.visit_ts_decorators(&mut property.ts_decorators);
                let is_private = if let Some(key) = property.key {
                    matches!(key.data, ExprData::EPrivateIdentifier(_))
                } else {
                    false
                };

                // Special-case EPrivateIdentifier to allow it here

                if is_private {
                    let priv_ref = match property.key.expect("infallible: prop has key").data {
                        ExprData::EPrivateIdentifier(pi) => pi.ref_,
                        _ => unreachable!(),
                    };
                    self.record_declared_symbol(priv_ref);
                } else if let Some(key) = property.key.as_mut() {
                    self.visit_expr(key);
                }

                // Make it an error to use "arguments" in a class body
                self.vis_scope().forbid_arguments = true;
                // defer p.current_scope.forbid_arguments = false;

                // The value of "this" is shadowed inside property values
                let old_is_this_captured = self.fn_only_data_visit.is_this_nested;
                let old_class_name_ref = self.fn_only_data_visit.class_name_ref.take();
                self.fn_only_data_visit.is_this_nested = true;
                self.fn_only_data_visit.is_new_target_allowed = true;
                self.fn_only_data_visit.class_name_ref = Some(shadow_ref);
                // defer p.fn_only_data_visit.is_this_nested = old_is_this_captured;
                // defer p.fn_only_data_visit.class_name_ref = old_class_name_ref;
                // — manual restore at end of loop body; no `continue` after this point.

                // We need to explicitly assign the name to the property initializer if it
                // will be transformed such that it is no longer an inline initializer.

                let mut constructor_function_: Option<bun_ast::StoreRef<E::Function>> = None;

                let mut name_to_keep: Option<&'a [u8]> = None;
                if is_private {
                    // (no-op)
                } else if !property.flags.contains(flags::Property::IsMethod)
                    && !property.flags.contains(flags::Property::IsComputed)
                {
                    if let Some(key) = property.key {
                        if let ExprData::EString(e_str) = key.data {
                            name_to_keep = Some(e_str.string(self.arena).expect("oom"));
                        }
                    }
                } else if property.flags.contains(flags::Property::IsMethod) {
                    if Self::IS_TYPESCRIPT_ENABLED {
                        if let (Some(value), Some(key)) = (property.value, property.key) {
                            if let (ExprData::EFunction(e_func), ExprData::EString(e_str)) =
                                (value.data, key.data)
                            {
                                if e_str.eql_comptime(b"constructor") {
                                    // `StoreRef` points into property.value's arena slot,
                                    // so it can be re-read after visit_expr overwrites the
                                    // value below.
                                    constructor_function_ = Some(e_func);
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
                        let mut visited = val;
                        self.visit_expr(&mut visited);
                        property.value =
                            Some(self.maybe_keep_expr_symbol_name(visited, name, was_anon));
                        self.decorator_class_name = prev_dcn;
                    } else {
                        self.visit_expr(property.value.as_mut().unwrap());
                    }

                    if Self::IS_TYPESCRIPT_ENABLED {
                        if constructor_function_.is_some() {
                            if let Some(value) = property.value {
                                if let ExprData::EFunction(e_func) = value.data {
                                    constructor_function = Some(e_func);
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
                        let mut visited = val;
                        self.visit_expr(&mut visited);
                        property.initializer =
                            Some(self.maybe_keep_expr_symbol_name(visited, name, was_anon));
                        self.decorator_class_name = prev_dcn2;
                    } else {
                        self.visit_expr(property.initializer.as_mut().unwrap());
                    }
                }

                // manual restore for the three `defer`s above
                self.vis_scope().forbid_arguments = false;
                self.fn_only_data_visit.is_this_nested = old_is_this_captured;
                self.fn_only_data_visit.class_name_ref = old_class_name_ref;
            }

            // note: our version assumes useDefineForClassFields is true
            if Self::IS_TYPESCRIPT_ENABLED {
                if let Some(mut constructor) = constructor_function {
                    // `constructor` is a `StoreRef<E::Function>` arena slot captured from
                    // `class.properties[i].value.data` above; arena-owned for 'a, and the
                    // per-property `&mut [Property]` borrow has been released. Moving the
                    // `Property` structs below does not invalidate this pointer (it points to
                    // a separate Store allocation, not into the Property slice itself).
                    let func_args: bun_ast::StoreSlice<G::Arg> = constructor.func.args;
                    let mut to_add: usize = 0;
                    for arg in func_args.iter() {
                        if arg.is_typescript_ctor_field
                            && matches!(arg.binding.data, BData::BIdentifier(_))
                        {
                            to_add += 1;
                        }
                    }

                    // if this is an expression, we can move statements after super() because there will be 0 decorators
                    let mut super_index: Option<usize> = None;
                    if class.extends.is_some() {
                        let body_stmts = constructor.func.body.stmts.slice();
                        for (index, stmt) in body_stmts.iter().enumerate() {
                            let is_super = match &stmt.data {
                                StmtData::SExpr(se) => match &se.value.data {
                                    ExprData::ECall(call) => {
                                        matches!(call.target.data, ExprData::ESuper(_))
                                    }
                                    _ => false,
                                },
                                _ => false,
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
                        let old_body: &[Stmt] = constructor.func.body.stmts.slice();
                        let mut stmts =
                            BumpVec::<Stmt>::with_capacity_in(old_body.len() + to_add, self.arena);
                        stmts.extend_from_slice(old_body);

                        let old_props: bun_ast::StoreSlice<G::Property> = class.properties;
                        let old_props_len = old_props.len();
                        let mut class_body = BumpVec::<G::Property>::with_capacity_in(
                            old_props_len + to_add,
                            self.arena,
                        );
                        // BumpVec can't adopt a foreign arena slice, so move each element
                        // out by `ptr::read` (G::Property has no Drop; old slice becomes dead
                        // arena bytes).
                        for i in 0..old_props_len {
                            // SAFETY: in-bounds; arena-owned; no Drop on Property.
                            unsafe {
                                class_body.push(core::ptr::read(old_props.as_ptr().add(i)));
                            }
                        }
                        let mut j: usize = 0;

                        let args_len = func_args.len();
                        for arg_idx in 0..args_len {
                            // reshaped for borrowck — copy the scalars we need
                            // (id_ref, bind_loc) out of the arg before calling `&mut self`
                            // helpers, so no live `&Arg` overlaps `self.new_expr`/`declare_symbol`.
                            let (id_ref, bind_loc) = {
                                let arg = &func_args[arg_idx];
                                if !arg.is_typescript_ctor_field {
                                    continue;
                                }
                                match arg.binding.data {
                                    BData::BIdentifier(id) => (id.r#ref, arg.binding.loc),
                                    _ => continue,
                                }
                            };

                            // SAFETY: original_name is an arena-owned slice valid for 'a.
                            let name: &'a [u8] = self.symbols[id_ref.inner_index() as usize]
                                .original_name
                                .slice();
                            let arg_ident = self.new_expr(
                                E::Identifier {
                                    ref_: id_ref,
                                    ..Default::default()
                                },
                                bind_loc,
                            );
                            let this_target = self.new_expr(E::This {}, bind_loc);
                            let dot = self.new_expr(
                                E::Dot {
                                    target: this_target,
                                    name: name.into(),
                                    name_loc: bind_loc,
                                    ..Default::default()
                                },
                                bind_loc,
                            );
                            let insert_at = match super_index {
                                Some(k) => j + k + 1,
                                None => j,
                            };
                            stmts.insert(insert_at, Stmt::assign(dot, arg_ident));

                            // O(N)
                            // `Vec::insert` opens a 1-slot gap at j and writes the
                            // new field (memmove + write).
                            // Copy the argument name symbol to prevent the class field
                            // declaration from being renamed but not the constructor argument.
                            let field_symbol_ref = self
                                .declare_symbol(SymbolKind::Other, bind_loc, name)
                                .unwrap_or(id_ref);
                            self.symbols[field_symbol_ref.inner_index() as usize]
                                .set_must_not_be_renamed(true);
                            let field_ident = self.new_expr(
                                E::Identifier {
                                    ref_: field_symbol_ref,
                                    ..Default::default()
                                },
                                bind_loc,
                            );
                            class_body.insert(
                                j,
                                G::Property {
                                    key: Some(field_ident),
                                    ..Default::default()
                                },
                            );
                            j += 1;
                        }

                        class.properties = bun_ast::StoreSlice::from_bump(class_body);
                        constructor.func.body.stmts = bun_ast::StoreSlice::from_bump(stmts);
                    }
                }
            }

            // manual restore for the block-level `defer`
            self.pop_scope();
            self.enclosing_class_keyword = old_enclosing_class_keyword;
        }

        if self.symbols[shadow_ref.get().inner_index() as usize].use_count_estimate == 0 {
            // If there was originally no class name but something inside needed one
            // (e.g. there was a static property initializer that referenced "this"),
            // store our generated name so the class expression ends up with a name.
            shadow_ref.set(Ref::NONE);
        } else if class.class_name.is_none() {
            let sr = shadow_ref.get();
            class.class_name = Some(LocRef {
                ref_: sr,
                loc: name_scope_loc,
            });
            self.record_declared_symbol(sr);
        }

        // class name scope
        self.pop_scope();

        shadow_ref.get()
    }

    // Try separating the list for appending, so that it's not a pointer.
    pub fn visit_stmts(
        &mut self,
        stmts: &mut ListManaged<'a, Stmt>,
        kind: StmtsKind,
    ) -> Result<(), crate::js_parser::Error> {
        debug_assert!(
            !SCAN_ONLY,
            "only_scan_imports_and_do_not_visit must not run this."
        );

        let p = self;

        // Consume before recursing so a nested function body's `visit_stmts`
        // doesn't compile the wrong target.
        let rc_pending = if kind == StmtsKind::FnBody {
            p.react_compiler_pending.take()
        } else {
            None
        };

        #[cfg(debug_assertions)]
        let initial_scope: js_ast::StoreRef<js_ast::Scope> = p.current_scope;

        {
            // Save the current control-flow liveness. This represents if we are
            // currently inside an "if (false) { ... }" block.
            let old_is_control_flow_dead = p.is_control_flow_dead;
            // Restored manually at block end. The error
            // path (`?`) skips restore; acceptable because callers `.expect()` or
            // propagate fatally (parse abort) — no resumption after error.

            let mut before: ListManaged<'a, Stmt> = ListManaged::new_in(p.arena);
            let mut after: ListManaged<'a, Stmt> = ListManaged::new_in(p.arena);

            // Preprocess TypeScript enums to improve code generation. Otherwise
            // uses of an enum before that enum has been declared won't be inlined:
            //
            //   console.log(Foo.FOO) // We want "FOO" to be inlined here
            //   const enum Foo { FOO = 0 }
            //
            // The TypeScript compiler itself contains code with this pattern, so
            // it's important to implement this optimization.
            let mut preprocessed_enums: ListManaged<'a, &'a [Stmt]> = ListManaged::new_in(p.arena);
            if p.scopes_in_order_for_enum.count() > 0 {
                for stmt in stmts.iter_mut() {
                    if matches!(stmt.data, StmtData::SEnum(_)) {
                        // `scope_order_to_visit: &'a [ScopeOrder<'a>]` is `Copy`;
                        // plain save/restore.
                        let old_scopes_in_order = p.scope_order_to_visit;

                        p.scope_order_to_visit =
                            scopes_for_enum_at(&p.scopes_in_order_for_enum, stmt.loc);

                        let mut temp = ListManaged::new_in(p.arena);
                        let res = p.visit_and_append_stmt(&mut temp, stmt);
                        p.scope_order_to_visit = old_scopes_in_order;
                        res?;
                        preprocessed_enums.push(temp.into_bump_slice());
                    }
                }
            }

            // `p.macro.prepend_stmts` is write-only (nothing ever reads it),
            // so the backref is intentionally not wired here.

            // visit all statements first
            let mut visited: ListManaged<'a, Stmt> =
                ListManaged::with_capacity_in(stmts.len(), p.arena);

            let prev_nearest_stmt_list = p.nearest_stmt_list;
            // BACKREF — `before` outlives this block; raw NonNull avoids
            // the `&'a mut` borrow conflict. Derive via `addr_of_mut!` (no intermediate
            // `&mut`) so the pointer shares the local's base tag and survives the
            // direct `&mut before` reborrows in the loop below (Stacked Borrows).
            p.nearest_stmt_list = NonNull::new(core::ptr::addr_of_mut!(before));

            let mut preprocessed_enum_i: usize = 0;

            'stmt_loop: for stmt in stmts.iter_mut() {
                let list: &mut ListManaged<'a, Stmt> = 'list_getter: {
                    match stmt.data {
                        StmtData::SExportEquals(_) => {
                            // TypeScript "export = value;" becomes "module.exports = value;". This
                            // must happen at the end after everything is parsed because TypeScript
                            // moves this statement to the end when it generates code.
                            break 'list_getter &mut after;
                        }
                        StmtData::SFunction(data) => {
                            // Manually hoist block-level function declarations to preserve semantics.
                            // This is only done for function declarations that are not generators
                            // or async functions, since this is a backwards-compatibility hack from
                            // Annex B of the JavaScript standard.
                            // SAFETY: current_scope is a valid arena ptr for the parse.
                            if !p.current_scope().kind_stops_hoisting()
                                && p.symbols[data.func.name.unwrap().ref_.inner_index() as usize]
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
                                scopes_for_enum_at(&p.scopes_in_order_for_enum, stmt.loc).len();
                            p.scope_order_to_visit = &p.scope_order_to_visit[enum_scope_count..];
                            continue 'stmt_loop;
                        }
                        _ => {}
                    }
                    break 'list_getter &mut visited;
                };
                p.visit_and_append_stmt(list, stmt)?;
            }

            // Transform block-level function declarations into variable declarations
            if before.len() > 0 {
                let mut let_decls: ListManaged<'a, G::Decl> = ListManaged::new_in(p.arena);
                let mut var_decls: ListManaged<'a, G::Decl> = ListManaged::new_in(p.arena);
                let mut non_fn_stmts: ListManaged<'a, Stmt> = ListManaged::new_in(p.arena);
                let mut fn_stmts: HashMap<Ref, u32> = HashMap::default();

                for stmt in before.iter().copied() {
                    match stmt.data {
                        StmtData::SFunction(mut data) => {
                            // This transformation of function declarations in nested scopes is
                            // intended to preserve the hoisting semantics of the original code. In
                            // JavaScript, function hoisting works differently in strict mode vs.
                            // sloppy mode code. We want the code we generate to use the semantics of
                            // the original environment, not the generated environment. However, if
                            // direct "eval" is present then it's not possible to preserve the
                            // semantics because we need two identifiers to do that and direct "eval"
                            // means neither identifier can be renamed to something else. So in that
                            // case we give up and do not preserve the semantics of the original code.
                            let name = data.func.name.unwrap();
                            let name_ref = name.ref_;
                            // SAFETY: current_scope is a valid arena ptr for the parse.
                            if p.current_scope().contains_direct_eval {
                                if let Some(hoisted_ref) =
                                    p.hoisted_ref_for_sloppy_mode_block_fn.get(&name_ref)
                                {
                                    // Merge the two identifiers back into a single one
                                    p.symbols[hoisted_ref.inner_index() as usize]
                                        .link
                                        .set(name_ref);
                                }
                                non_fn_stmts.push(stmt);
                                continue;
                            }

                            let gpe = fn_stmts.get_or_put(name_ref).expect("oom");
                            let mut index = *gpe.value_ptr;
                            if !gpe.found_existing {
                                index = u32::try_from(let_decls.len()).expect("int cast");
                                *gpe.value_ptr = index;
                                let_decls.push(G::Decl {
                                    binding: p.b(B::Identifier { r#ref: name_ref }, name.loc),
                                    value: None,
                                });

                                // Also write the function to the hoisted sibling symbol if applicable
                                if let Some(&hoisted_ref) =
                                    p.hoisted_ref_for_sloppy_mode_block_fn.get(&name_ref)
                                {
                                    p.record_usage(name_ref);
                                    let value = p.new_expr(
                                        E::Identifier {
                                            ref_: name_ref,
                                            ..Default::default()
                                        },
                                        name.loc,
                                    );
                                    var_decls.push(G::Decl {
                                        binding: p
                                            .b(B::Identifier { r#ref: hoisted_ref }, name.loc),
                                        value: Some(value),
                                    });
                                }
                            }

                            // The last function statement for a given symbol wins
                            data.func.name = None;
                            // SAFETY: `G::Fn`'s fields are POD (`StoreSlice<T>`, ints, flags)
                            // with no `Drop`, so a bitwise read is a plain copy; the type just
                            // lacks `derive(Copy)`.
                            let func = unsafe { core::ptr::read(&raw const data.func) };
                            let_decls[index as usize].value =
                                Some(p.new_expr(E::Function { func }, stmt.loc));
                        }
                        _ => {
                            non_fn_stmts.push(stmt);
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
                    let decls = G::DeclList::from_bump_vec(let_decls);
                    let loc = decls.at(0).value.unwrap().loc;
                    before.push(p.s(
                        S::Local {
                            kind: LocalKind::KLet,
                            decls,
                            ..Default::default()
                        },
                        loc,
                    ));
                }

                if var_decls.len() > 0 {
                    let relocated =
                        p.maybe_relocate_vars_to_top_level(&var_decls, RelocateVarsMode::Normal);
                    if relocated.ok {
                        if let Some(new) = relocated.stmt {
                            before.push(new);
                        }
                    } else {
                        let decls = G::DeclList::from_bump_vec(var_decls);
                        let loc = decls.at(0).value.unwrap().loc;
                        before.push(p.s(
                            S::Local {
                                kind: LocalKind::KVar,
                                decls,
                                ..Default::default()
                            },
                            loc,
                        ));
                    }
                }

                before.extend_from_slice(&non_fn_stmts);
            }

            let mut visited_count = visited.len();
            if p.is_control_flow_dead && p.options.features.dead_code_elimination {
                let mut end: usize = 0;
                for idx in 0..visited.len() {
                    let item = visited[idx];
                    if !SideEffects::should_keep_stmt_in_dead_control_flow(item, p.arena) {
                        continue;
                    }

                    visited[end] = item;
                    end += 1;
                }
                visited_count = end;
            }

            // `Stmt: Copy`, so clear+extend avoids a `Stmt::default()`
            // filler value.
            stmts.clear();
            stmts.reserve(visited_count + before.len() + after.len());
            stmts.extend_from_slice(&before);
            stmts.extend_from_slice(&visited[..visited_count]);
            stmts.extend_from_slice(&after);

            // manual restore for the block-level `defer`s
            p.nearest_stmt_list = prev_nearest_stmt_list;
            p.is_control_flow_dead = old_is_control_flow_dead;
        }

        // Lower using declarations
        if kind != StmtsKind::SwitchStmt && p.should_lower_using_declarations(stmts.as_slice()) {
            let mut ctx = LowerUsingDeclarationsContext::init(p)?;
            ctx.scan_stmts(p, stmts.as_mut_slice());
            // `finalize` stores a sub-slice of the old buffer as the lowered
            // S.Try `body`, so the buffer must outlive the assignment. Leak
            // the old buffer into the 'a arena via `into_bump_slice_mut`
            // (reclaimed on arena reset) before installing the new list —
            // dropping the old `Vec<_, &MimallocArena>` would `mi_free` it
            // and leave the S.Try body dangling.
            let arena = p.arena;
            let raw = core::mem::replace(stmts, ListManaged::new_in(arena)).into_bump_slice_mut();
            // SAFETY: current_scope is a valid arena ptr for the parse.
            let parent_is_none = p.current_scope().parent.is_none();
            *stmts = ctx.finalize(p, raw, parent_is_none);
        }

        #[cfg(debug_assertions)]
        // if this fails it means that scope pushing/popping is not balanced
        debug_assert!(p.current_scope == initial_scope);

        if let Some(pending) = rc_pending
            && let Some(mut rc) = p.react_compiler.take()
        {
            let name = pending
                .binding
                .filter(|r| *r != js_ast::Ref::NONE)
                .map(|r| p.load_name_from_ref(r));
            let compiled = {
                let host = &mut crate::react_compiler_host::ReactCompilerHost::new(p);
                bun_react_compiler::maybe_compile_pending(
                    &mut rc,
                    host,
                    &pending,
                    stmts.as_mut_slice(),
                    name,
                )
            };
            p.react_compiler = Some(rc);
            if let Some((new_body, result)) = compiled {
                stmts.clear();
                stmts.extend(new_body);
                p.react_compiler_result = Some(result);
            }
        }

        if !p.options.features.minify_syntax || !p.options.features.dead_code_elimination {
            return Ok(());
        }

        // SAFETY: current_scope is a valid arena ptr for the parse.
        if p.current_scope().parent.is_some() && !p.current_scope().contains_direct_eval {
            // Remove inlined constants now that we know whether any of these statements
            // contained a direct eval() or not. This can't be done earlier when we
            // encounter the constant because we haven't encountered the eval() yet.
            // Inlined constants are not removed if they are in a top-level scope or
            // if they are exported (which could be in a nested TypeScript namespace).
            if p.const_values.count() > 0 {
                let items: &mut [Stmt] = stmts.as_mut_slice();
                for stmt in items.iter_mut() {
                    match stmt.data {
                        StmtData::SEmpty(_)
                        | StmtData::SComment(_)
                        | StmtData::SDirective(_)
                        | StmtData::SDebugger(_)
                        | StmtData::STypeScript(_) => continue,
                        StmtData::SLocal(mut local) => {
                            // "using" / "await using" declarations have disposal
                            // side-effects on scope exit. Their refs can end up in
                            // `const_values` via the macro path in `visitDecl`
                            // (`could_be_macro`), so skip them here to avoid
                            // silently dropping the declaration.
                            if local.kind.is_using() {
                                continue;
                            }
                            if !local.is_export && !local.was_commonjs_export {
                                let mut any_decl_in_const_values = local.kind == LocalKind::KConst;
                                let decls: &mut [Decl] = local.decls.slice_mut();
                                let mut end: usize = 0;
                                for idx in 0..decls.len() {
                                    if let BData::BIdentifier(id_ptr) = decls[idx].binding.data {
                                        let id_ref = id_ptr.r#ref;
                                        if p.const_values.contains(&id_ref) {
                                            any_decl_in_const_values = true;
                                            let symbol = &p.symbols[id_ref.inner_index() as usize];
                                            if symbol.use_count_estimate == 0 {
                                                // Skip declarations that are constants with zero usage
                                                continue;
                                            }
                                        }
                                    }
                                    // `Decl` is field-wise `Copy` but lacks the
                                    // derive; `swap` compacts in place (idx >= end always).
                                    decls.swap(end, idx);
                                    end += 1;
                                }
                                local.decls.truncate(end);
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

        let mut output: ListManaged<'a, Stmt> = ListManaged::with_capacity_in(stmts.len(), p.arena);

        let dead_code_elimination = p.options.features.dead_code_elimination;
        for stmt in stmts.iter().copied() {
            if is_control_flow_dead
                && dead_code_elimination
                && !SideEffects::should_keep_stmt_in_dead_control_flow(stmt, p.arena)
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
            // SAFETY: current_scope is a valid arena ptr for the parse.
            if p.current_scope != p.module_scope && !p.current_scope().contains_direct_eval {
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
                    // borrowck: read the `StoreRef` (Copy) first, then re-borrow
                    // `output` only when truncating.
                    let StmtData::SLocal(mut local) = output[prev_idx].data else {
                        break;
                    };
                    // "using" / "await using" declarations have disposal
                    // side-effects on scope exit, so they must not be
                    // removed by inlining their initializer into the use.
                    if local.decls.len_u32() == 0
                        || local.kind == LocalKind::KVar
                        || local.kind.is_using()
                        || local.is_export
                    {
                        break;
                    }

                    // The variable must be initialized, since we will be substituting
                    // the value into the usage.
                    let last_idx = (local.decls.len_u32() - 1) as usize;
                    let last: &mut Decl = &mut local.decls.slice_mut()[last_idx];
                    let Some(replacement) = last.value else { break };

                    // The binding must be an identifier that is only used once.
                    // Ignore destructuring bindings since that's not the simple case.
                    // Destructuring bindings could potentially execute side-effecting
                    // code which would invalidate reordering.
                    let BData::BIdentifier(ident_ptr) = last.binding.data else {
                        break;
                    };
                    let id = ident_ptr.r#ref;

                    let symbol: &Symbol = &p.symbols[id.inner_index() as usize];

                    // Try to substitute the identifier with the initializer. This will
                    // fail if something with side effects is in between the declaration
                    // and the usage.
                    if symbol.use_count_estimate == 1
                        && p.substitute_single_use_symbol_in_stmt(stmt, id, replacement)
                    {
                        match local.decls.len_u32() {
                            1 => {
                                local.decls.clear();
                                let new_len = output.len() - 1;
                                output.truncate(new_len);
                                continue 'inner;
                            }
                            _ => {
                                let n = local.decls.len() - 1;
                                local.decls.truncate(n);
                                continue 'inner;
                            }
                        }
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

            match stmt.data {
                StmtData::SEmpty(_) => continue,

                // skip directives for now
                StmtData::SDirective(_) => continue,

                StmtData::SLocal(local) => {
                    // Merge adjacent local statements
                    if output.len() > 0 {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = &mut output[prev_idx];
                        if let StmtData::SLocal(mut prev_local) = prev_stmt.data {
                            if local.can_merge_with(&prev_local) {
                                // `Vec::append_slice` requires `T: Clone`
                                // but `G::Decl` lacks the derive (its fields are all
                                // `Copy`). Per-element bitwise copy instead.
                                //
                                // The parse pass allocates `decls` in the bump arena
                                // (`from_bump_slice` → `Origin::Borrowed`); promote to a
                                // global-heap buffer before growing it.
                                for d in local.decls.slice() {
                                    // SAFETY: Decl is field-wise Copy (Binding, Option<Expr>).
                                    prev_local.decls.push(unsafe { core::ptr::read(d) });
                                }
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
                        if let StmtData::SExpr(mut prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call()
                                && p.options.runtime_merge_adjacent_expression_statements()
                            {
                                prev_expr.does_not_affect_tree_shaking = prev_expr
                                    .does_not_affect_tree_shaking
                                    && s_expr.does_not_affect_tree_shaking;
                                prev_expr.value =
                                    Expr::join_with_comma(prev_expr.value, s_expr.value);
                                continue;
                            }
                        } else if let StmtData::SLocal(prev_local) = prev_stmt.data {
                            //
                            // Input:
                            //      var f;
                            //      f = 123;
                            // Output:
                            //      var f = 123;
                            //
                            // This doesn't handle every case. Only the very simple one.
                            if let ExprData::EBinary(bin_assign) = s_expr.value.data {
                                if prev_local.decls.len_u32() == 1
                                    && bin_assign.op == OpCode::BinAssign
                                    // we can only do this with var because var is hoisted
                                    // the statement we are merging into may use the statement before its defined.
                                    && prev_local.kind == LocalKind::KVar
                                {
                                    if let ExprData::EIdentifier(left_id) = bin_assign.left.data {
                                        // `prev_local` is a `StoreRef` (Copy) so
                                        // re-slicing here writes through to the arena slot.
                                        let mut prev_local = prev_local;
                                        let decl = &mut prev_local.decls.slice_mut()[0];
                                        if let BData::BIdentifier(bid_ptr) = decl.binding.data {
                                            let bid_ref = bid_ptr.r#ref;
                                            if bid_ref.eql(left_id.ref_)
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
                }
                StmtData::SSwitch(mut s_switch) => {
                    // Absorb a previous expression statement
                    if output.len() > 0 && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                s_switch.test_ =
                                    Expr::join_with_comma(prev_expr.value, s_switch.test_);
                                output.truncate(prev_idx);
                            }
                        }
                    }
                }
                StmtData::SIf(mut s_if) => {
                    // Absorb a previous expression statement
                    if output.len() > 0 && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                s_if.test_ = Expr::join_with_comma(prev_expr.value, s_if.test_);
                                output.truncate(prev_idx);
                            }
                        }
                    }

                    // TODO: optimize jump
                }

                StmtData::SReturn(mut ret) => {
                    // Merge return statements with the previous expression statement
                    if output.len() > 0
                        && ret.value.is_some()
                        && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                ret.value = Some(Expr::join_with_comma(
                                    prev_expr.value,
                                    ret.value.unwrap(),
                                ));
                                output[prev_idx] = stmt;
                                continue;
                            }
                        }
                    }

                    is_control_flow_dead = true;
                }

                StmtData::SBreak(_) | StmtData::SContinue(_) => {
                    is_control_flow_dead = true;
                }

                StmtData::SThrow(s_throw) => {
                    // Merge throw statements with the previous expression statement
                    if output.len() > 0 && p.options.runtime_merge_adjacent_expression_statements()
                    {
                        let prev_idx = output.len() - 1;
                        let prev_stmt = output[prev_idx];
                        if let StmtData::SExpr(prev_expr) = prev_stmt.data {
                            if !prev_stmt.is_super_call() {
                                output[prev_idx] = p.s(
                                    S::Throw {
                                        value: Expr::join_with_comma(
                                            prev_expr.value,
                                            s_throw.value,
                                        ),
                                    },
                                    stmt.loc,
                                );
                                continue;
                            }
                        }
                    }

                    is_control_flow_dead = true;
                }

                _ => {}
            }

            output.push(stmt);
        }

        // stmts.deinit(); — Drop handles freeing the old buffer (BumpVec is arena-backed).
        *stmts = output;
        Ok(())
    }
}

fn scopes_for_enum_at<'a>(
    map: &bun_core::collections::ArrayHashMap<bun_ast::Loc, &'a [ScopeOrder<'a>]>,
    loc: bun_ast::Loc,
) -> &'a [ScopeOrder<'a>] {
    map.get(&loc)
        .copied()
        .expect("scopes_in_order_for_enum miss for enum stmt loc")
}

pub(crate) fn fn_body_contains_use_strict(body: &[Stmt]) -> Option<bun_ast::Loc> {
    use bun_ast::stmt::Data as StmtData;
    for stmt in body {
        // "use strict" has to appear at the top of the function body
        // but we can allow comments
        match &stmt.data {
            StmtData::SComment(_) => continue,
            StmtData::SDirective(dir) => {
                // SAFETY: arena-owned slice valid for the parse.
                if dir.value.slice() == b"use strict" {
                    return Some(stmt.loc);
                }
            }
            StmtData::SEmpty(_) => {}
            _ => return None,
        }
    }
    None
}
