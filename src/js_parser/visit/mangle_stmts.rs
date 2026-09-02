#![warn(unused_must_use)]
//! The minifier that runs over a statement list once every statement in it has been visited: single-use inlining, unused-declaration removal and statement merging, with another look at the list tail after every edit.

use crate::p::P;
use crate::parser::{StmtSubstitution, StmtsKind};
use crate::scan::scan_side_effects::SideEffects;
use bun_alloc::ArenaVec as BumpVec;
use bun_ast as js_ast;
use bun_ast::b::B as BData;
use bun_ast::s::Kind as LocalKind;
use bun_ast::{Expr, ExprData, G, OpCode, S, Stmt, StmtData, Symbol};
use bun_collections::VecExt;

type ListManaged<'bump, T> = BumpVec<'bump, T>;

/// State for the statement list being finalized.
pub(crate) struct StmtListMangler {
    /// A `return`, `throw`, `break` or `continue` was emitted: what follows is dead.
    is_control_flow_dead: bool,
    /// Declarations in this list may be inlined into the statement after them.
    can_inline_locals: bool,
    /// Bundler only: declarations in this list that nothing uses may be dropped.
    can_drop_unused_locals: bool,
    /// Bundler only: the outermost list of a function body, where every use of a `var` declared in it has been visited.
    can_touch_vars: bool,
    /// `output.len()` when the last declaration in `output` could not move into the statement after it; appending to that statement cannot change the outcome.
    blocked_tail_len: usize,
    /// How many statements were merged into the last statement of `output`.
    tail_merge_count: u32,
}

/// A merged statement is a left-deep comma chain that every walk recurses through; past this many merges it is no longer searched for an inlining target.
const MAX_MERGES_TO_SEARCH: u32 = 32;

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    pub(crate) fn stmt_list_mangler(&self, kind: StmtsKind) -> StmtListMangler {
        let scope = self.current_scope();

        // Top-level declarations may still be exported ("export {id};"), and eval'd code may reference anything in scope.
        let can_inline_locals =
            self.current_scope != self.module_scope && !scope.contains_direct_eval;

        // The runtime transpiler keeps the old one-statement-at-a-time behavior so its output stays close to the source.
        let bundle = self.options.bundle;
        // A `let` declared in one `case` can be used by a later case, which is not visited yet.
        let can_drop_unused_locals = can_inline_locals && bundle && kind != StmtsKind::SwitchStmt;
        StmtListMangler {
            is_control_flow_dead: false,
            can_inline_locals,
            can_drop_unused_locals,
            can_touch_vars: can_inline_locals
                && bundle
                && kind == StmtsKind::FnBody
                && scope.kind_stops_hoisting(),
            blocked_tail_len: usize::MAX,
            tail_merge_count: 0,
        }
    }

    /// Appends `stmt` to `output`, minified against what is already there.
    pub(crate) fn mangle_stmt_into_list(
        &mut self,
        m: &mut StmtListMangler,
        output: &mut ListManaged<'a, Stmt>,
        stmt: Stmt,
    ) {
        if m.is_control_flow_dead
            && self.options.features.dead_code_elimination
            && !SideEffects::should_keep_stmt_in_dead_control_flow(stmt, self.arena)
        {
            // Strip unnecessary statements if the control flow is dead here
            return;
        }

        if m.can_drop_unused_locals
            && let StmtData::SLocal(local) = stmt.data
            && let Some(rest) = self.drop_unused_decls(stmt, local, m.can_touch_vars)
        {
            for stmt in rest {
                self.merge_stmt_into_list(m, output, stmt);
            }
            return;
        }

        self.merge_stmt_into_list(m, output, stmt);
    }

    fn merge_stmt_into_list(
        &mut self,
        m: &mut StmtListMangler,
        output: &mut ListManaged<'a, Stmt>,
        mut stmt: Stmt,
    ) {
        match stmt.data {
            StmtData::SEmpty(_) => return,
            // skip directives for now
            StmtData::SDirective(_) => return,
            _ => {}
        }

        let mut try_inline = m.can_inline_locals;
        let mut merge_count: u32 = 0;
        loop {
            if try_inline {
                self.inline_tail_decls_into(m, output, &mut stmt);
                // Inlining into a statement kept for its side effects may have left it side-effect free.
                if let StmtData::SEmpty(_) = stmt.data {
                    return;
                }
            }
            // don't merge super calls to ensure they are called before "this" is accessed
            if stmt.is_super_call() || !self.merge_stmt_with_tail(output, &mut stmt) {
                break;
            }
            merge_count = if merge_count == 0 {
                m.tail_merge_count
            } else {
                merge_count
            }
            .saturating_add(1);
            // `stmt` absorbed the statement before it, so a declaration two statements back is now right in front of it: `let x = 1; a(); return x` => `let x = 1; return a(), x` => `return a(), 1`.
            try_inline = m.can_inline_locals
                && self.options.bundle
                && m.blocked_tail_len != output.len()
                && merge_count <= MAX_MERGES_TO_SEARCH;
        }

        match stmt.data {
            StmtData::SReturn(_)
            | StmtData::SThrow(_)
            | StmtData::SBreak(_)
            | StmtData::SContinue(_) => {
                m.is_control_flow_dead = true;
            }
            _ => {}
        }

        output.push(stmt);
        m.tail_merge_count = merge_count;
    }

    /// Every use of the name resolves to this symbol, so its use count is complete.
    fn use_count_is_exact(symbol: &Symbol) -> bool {
        !symbol.has_link() && !symbol.is_link_target() && !symbol.must_not_be_renamed()
    }

    /// Inlines single-use declarations at the end of `output` into `stmt` (`let x = fn(); return x.y()` => `return fn().y()`) until one stays, and drops declarations there that nothing uses anymore.
    fn inline_tail_decls_into(
        &mut self,
        m: &mut StmtListMangler,
        output: &mut ListManaged<'a, Stmt>,
        stmt: &mut Stmt,
    ) {
        while let Some(&prev) = output.last() {
            let StmtData::SLocal(mut local) = prev.data else {
                break;
            };

            // A `var` has function scope, so its uses are all visited only at the function body's own list; a `using` declaration has disposal side effects on scope exit.
            if local.decls.is_empty()
                || local.kind.is_using()
                || local.is_export
                || (local.kind == LocalKind::KVar && !m.can_touch_vars)
            {
                break;
            }

            let last: G::Decl = *local.decls.slice().last().unwrap();

            // Destructuring can run code (getters, iterators), which would invalidate the reordering.
            let BData::BIdentifier(ident) = last.binding.data else {
                break;
            };
            let id = ident.r#ref;

            let symbol = &self.symbols[id.inner_index() as usize];
            if !Self::use_count_is_exact(symbol) {
                break;
            }
            let use_count = symbol.use_count_estimate;

            if use_count == 0 {
                if !m.can_drop_unused_locals {
                    break;
                }
                if let Some(value) = last.value {
                    if !self.expr_can_be_removed_if_unused(&value) {
                        break;
                    }
                    self.ignore_usages_in_removed_expr(&value);
                }
                Self::pop_last_decl(output, &mut local);
                continue;
            }

            // The value is what gets substituted into the use.
            let Some(replacement) = last.value else {
                break;
            };
            if use_count != 1 {
                break;
            }

            // Fails when something with side effects sits between the declaration and the use.
            match self.substitute_single_use_symbol_in_stmt(*stmt, id, replacement) {
                StmtSubstitution::Substituted => {
                    // `const ns = await import(x); return ns`: the single use moved into `replacement`, and unless it was a tracked read (`f(ns.a)`) the namespace escapes there.
                    if self.dynamic_import_namespace_locals.contains_key(&id)
                        && self.namespace_tracked_uses.get(&id).copied().unwrap_or(0) == 0
                    {
                        // Read as "more uses than accounted for" when finalizing.
                        self.namespace_tracked_uses.insert(id, u32::MAX);
                    }
                    Self::pop_last_decl(output, &mut local);
                    m.blocked_tail_len = usize::MAX;

                    // `const D = Math.PI / 180; D * 2;` (what an unused declaration left behind): with `D` inlined the statement has no side effect anymore.
                    if m.can_drop_unused_locals
                        && let StmtData::SExpr(mut s_expr) = stmt.data
                    {
                        match SideEffects::simplify_unused_expr(self, s_expr.value) {
                            Some(value) => s_expr.value = value,
                            None => {
                                *stmt = stmt.to_empty();
                                break;
                            }
                        }
                    }
                }
                StmtSubstitution::NotFound => {
                    m.blocked_tail_len = usize::MAX;
                    break;
                }
                StmtSubstitution::Blocked => {
                    m.blocked_tail_len = output.len();
                    break;
                }
            }
        }
    }

    /// Removes the last declaration of `local` (the statement at the end of `output`), and the statement itself when that was its only one.
    fn pop_last_decl(output: &mut ListManaged<'a, Stmt>, local: &mut js_ast::StoreRef<S::Local>) {
        let n = local.decls.len() - 1;
        local.decls.truncate(n);
        if n == 0 {
            output.pop();
        }
    }

    /// Merges `stmt` with the statement at the end of `output`; on success `stmt` holds the merged statement and the old end is popped. Comma joins are bundler only, to keep line numbers close to the source.
    fn merge_stmt_with_tail(
        &mut self,
        output: &mut ListManaged<'a, Stmt>,
        stmt: &mut Stmt,
    ) -> bool {
        let Some(&prev) = output.last() else {
            return false;
        };
        let merge_expressions =
            self.options.runtime_merge_adjacent_expression_statements() && !prev.is_super_call();

        match stmt.data {
            StmtData::SLocal(local) => {
                // Merge adjacent local statements
                let StmtData::SLocal(mut prev_local) = prev.data else {
                    return false;
                };
                if !local.can_merge_with(&prev_local) {
                    return false;
                }
                prev_local.decls.extend_from_slice(local.decls.slice());
            }

            StmtData::SExpr(s_expr) => match prev.data {
                // Merge adjacent expression statements
                StmtData::SExpr(mut prev_expr) => {
                    if !merge_expressions {
                        return false;
                    }
                    prev_expr.does_not_affect_tree_shaking = prev_expr.does_not_affect_tree_shaking
                        && s_expr.does_not_affect_tree_shaking;
                    prev_expr.value = Expr::join_with_comma(prev_expr.value, s_expr.value);
                }
                // `var f; f = 123;` => `var f = 123;` (only this simple case)
                StmtData::SLocal(mut prev_local) => {
                    let ExprData::EBinary(bin_assign) = s_expr.value.data else {
                        return false;
                    };
                    // Only `var` is hoisted, so only it may be used before the declaration it merges into.
                    if prev_local.decls.len() != 1
                        || bin_assign.op != OpCode::BinAssign
                        || prev_local.kind != LocalKind::KVar
                    {
                        return false;
                    }
                    let ExprData::EIdentifier(left_id) = bin_assign.left.data else {
                        return false;
                    };
                    let decl = &mut prev_local.decls.slice_mut()[0];
                    let BData::BIdentifier(bid_ptr) = decl.binding.data else {
                        return false;
                    };
                    // An initialized declaration may already be read by the assignment's right side (https://github.com/oven-sh/bun/issues/2948).
                    if !bid_ptr.r#ref.eql(left_id.ref_) || decl.value.is_some() {
                        return false;
                    }
                    decl.value = Some(bin_assign.right);
                    self.ignore_usage(left_id.ref_);
                }
                _ => return false,
            },

            // Absorb a previous expression statement
            StmtData::SSwitch(mut s_switch) => {
                let StmtData::SExpr(prev_expr) = prev.data else {
                    return false;
                };
                if !merge_expressions {
                    return false;
                }
                s_switch.test = Expr::join_with_comma(prev_expr.value, s_switch.test);
                output.pop();
                return true;
            }

            // Absorb a previous expression statement
            StmtData::SIf(mut s_if) => {
                let StmtData::SExpr(prev_expr) = prev.data else {
                    return false;
                };
                if !merge_expressions {
                    return false;
                }
                s_if.test = Expr::join_with_comma(prev_expr.value, s_if.test);
                output.pop();
                return true;
            }

            // Merge return statements with the previous expression statement
            StmtData::SReturn(mut ret) => {
                let StmtData::SExpr(prev_expr) = prev.data else {
                    return false;
                };
                let Some(value) = ret.value else {
                    return false;
                };
                if !merge_expressions {
                    return false;
                }
                ret.value = Some(Expr::join_with_comma(prev_expr.value, value));
                output.pop();
                return true;
            }

            // Merge throw statements with the previous expression statement
            StmtData::SThrow(mut s_throw) => {
                let StmtData::SExpr(prev_expr) = prev.data else {
                    return false;
                };
                if !merge_expressions {
                    return false;
                }
                s_throw.value = Expr::join_with_comma(prev_expr.value, s_throw.value);
                output.pop();
                return true;
            }

            _ => return false,
        }

        // `stmt` was folded into `prev`, which now stands for both.
        *stmt = prev;
        output.pop();
        true
    }

    /// Bundler only: drops the declarations of `stmt` (an `S::Local`) that nothing uses, keeping a side-effecting initializer as an expression statement in place. `None` when every declaration stays.
    fn drop_unused_decls(
        &mut self,
        stmt: Stmt,
        mut local: js_ast::StoreRef<S::Local>,
        can_touch_vars: bool,
    ) -> Option<ListManaged<'a, Stmt>> {
        // The caller already ruled out the top-level scope, where "export {id};" can still follow.
        if local.is_export
            || local.origin.is_commonjs_export()
            || local.kind.is_using()
            || (local.kind == LocalKind::KVar && !can_touch_vars)
        {
            return None;
        }

        let decls: &[G::Decl] = local.decls.slice();
        if !decls.iter().any(|decl| self.decl_is_unused(decl)) {
            return None;
        }

        let mut result: ListManaged<'a, Stmt> = ListManaged::new_in(self.arena);
        let mut kept: G::DeclList = VecExt::init_capacity(decls.len());
        for decl in decls.iter().copied() {
            if !self.decl_is_unused(&decl) {
                kept.push(decl);
                continue;
            }
            let Some(value) = decl.value else {
                continue;
            };
            if self.expr_can_be_removed_if_unused(&value) {
                self.ignore_usages_in_removed_expr(&value);
                continue;
            }
            let Some(side_effects) = SideEffects::simplify_unused_expr(self, value) else {
                continue;
            };
            if !kept.is_empty() {
                let decls = core::mem::replace(&mut kept, VecExt::init_capacity(decls.len()));
                result.push(self.s(
                    S::Local {
                        kind: local.kind,
                        decls,
                        is_export: false,
                        origin: local.origin,
                    },
                    stmt.loc,
                ));
            }
            result.push(self.s(
                S::SExpr {
                    value: side_effects,
                    ..Default::default()
                },
                value.loc,
            ));
        }

        if !kept.is_empty() {
            if result.is_empty() {
                // Only the dropped declarations changed: keep the statement node.
                local.decls = kept;
                result.push(stmt);
            } else {
                result.push(self.s(
                    S::Local {
                        kind: local.kind,
                        decls: kept,
                        is_export: false,
                        origin: local.origin,
                    },
                    stmt.loc,
                ));
            }
        }

        Some(result)
    }

    fn decl_is_unused(&self, decl: &G::Decl) -> bool {
        let BData::BIdentifier(ident) = decl.binding.data else {
            return false;
        };
        let symbol = &self.symbols[ident.r#ref.inner_index() as usize];
        symbol.use_count_estimate == 0 && Self::use_count_is_exact(symbol)
    }

    /// `expr` is removed without being evaluated: take back the uses it recorded so a binding it held the last use of can go too. Function and class bodies are not entered, which at worst keeps a binding.
    fn ignore_usages_in_removed_expr(&mut self, expr: &Expr) {
        if !self.stack_check.is_safe_to_recurse() {
            return;
        }
        match expr.data {
            ExprData::EIdentifier(id) => {
                // The escape analysis of a dynamic import namespace compares its use count with its tracked uses.
                if !self.dynamic_import_namespace_locals.contains_key(&id.ref_) {
                    self.ignore_usage(id.ref_);
                }
            }
            ExprData::EDot(dot) => self.ignore_usages_in_removed_expr(&dot.target),
            ExprData::EIndex(index) => {
                self.ignore_usages_in_removed_expr(&index.target);
                self.ignore_usages_in_removed_expr(&index.index);
            }
            ExprData::EUnary(un) => self.ignore_usages_in_removed_expr(&un.value),
            ExprData::EBinary(bin) => {
                self.ignore_usages_in_removed_expr(&bin.left);
                self.ignore_usages_in_removed_expr(&bin.right);
            }
            ExprData::EIf(ternary) => {
                self.ignore_usages_in_removed_expr(&ternary.test);
                self.ignore_usages_in_removed_expr(&ternary.yes);
                self.ignore_usages_in_removed_expr(&ternary.no);
            }
            ExprData::EArray(array) => {
                for item in array.items.slice() {
                    self.ignore_usages_in_removed_expr(item);
                }
            }
            ExprData::EObject(object) => {
                for property in object.properties.slice() {
                    if property.flags.contains(js_ast::flags::Property::IsComputed)
                        && let Some(key) = &property.key
                    {
                        self.ignore_usages_in_removed_expr(key);
                    }
                    if let Some(value) = &property.value {
                        self.ignore_usages_in_removed_expr(value);
                    }
                }
            }
            ExprData::ECall(call) => {
                self.ignore_usages_in_removed_expr(&call.target);
                for arg in call.args.slice() {
                    self.ignore_usages_in_removed_expr(arg);
                }
            }
            ExprData::ENew(new) => {
                self.ignore_usages_in_removed_expr(&new.target);
                for arg in new.args.slice() {
                    self.ignore_usages_in_removed_expr(arg);
                }
            }
            ExprData::ETemplate(template) => {
                if let Some(tag) = &template.tag {
                    self.ignore_usages_in_removed_expr(tag);
                }
                for part in template.parts().iter() {
                    self.ignore_usages_in_removed_expr(&part.value);
                }
            }
            ExprData::ESpread(spread) => self.ignore_usages_in_removed_expr(&spread.value),
            ExprData::EInlinedEnum(inlined) => self.ignore_usages_in_removed_expr(&inlined.value),
            _ => {}
        }
    }
}
