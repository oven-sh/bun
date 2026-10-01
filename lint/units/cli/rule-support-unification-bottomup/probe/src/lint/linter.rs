//! The one walk: every rule handler is called from here.

use bun_ast::walk::{self, Visitor};
use bun_ast::{B, E, Expr, ExprData, G, Loc, OpCode, S, Stmt, StmtData};

use super::Diagnostic;
use super::context::Context;
use super::rules;

#[allow(clippy::disallowed_methods)]
pub(crate) fn run(context: Context<'_, '_>, stmts: &[Stmt]) -> Vec<Diagnostic> {
    let mut linter = Linter {
        context,
        targets: Vec::new(),
        stress: std::env::var_os("PROBE_STRESS").is_some(),
    };
    for stmt in stmts {
        linter.visit_stmt(stmt);
    }
    if linter.stress {
        linter.context.stress_report();
    }
    linter.context.finish()
}

struct Linter<'p, 'a> {
    context: Context<'p, 'a>,
    /// Nodes that are assignment targets and are not walked yet, the next one to be walked last.
    targets: Vec<usize>,
    /// Probe only: run every service of the scanner on every node it can serve.
    stress: bool,
}

/// The address of the node that `mark` names: an array or an object that is a pattern, or the `=` of a default.
fn target_of(expr: &Expr) -> Option<usize> {
    match &expr.data {
        ExprData::EArray(array) => Some(core::ptr::from_ref::<E::Array>(array).addr()),
        ExprData::EObject(object) => Some(core::ptr::from_ref::<E::Object>(object).addr()),
        ExprData::EBinary(binary) if binary.op == OpCode::BinAssign => {
            Some(core::ptr::from_ref::<E::Binary>(binary).addr())
        }
        ExprData::ESpread(spread) => match &spread.value.data {
            ExprData::EArray(_) | ExprData::EObject(_) => target_of(&spread.value),
            _ => None,
        },
        _ => None,
    }
}

impl Linter<'_, '_> {
    /// `expr` is written where a target is expected.
    fn mark(&mut self, expr: &Expr) {
        if let Some(address) = target_of(expr) {
            self.targets.push(address);
        }
    }

    /// Whether the node at `address` was marked. It is the next marked node that the walk reaches, or none.
    fn take(&mut self, address: usize) -> bool {
        if self.targets.last() == Some(&address) {
            self.targets.pop();
            return true;
        }
        false
    }

    /// `expr` is not walked: a mark on it is dropped with it.
    fn skip(&mut self, expr: &Expr) {
        if let Some(address) = target_of(expr) {
            self.take(address);
        }
    }
}

impl<'ast> Visitor<'ast> for Linter<'_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if !self.context.stack_check.is_safe_to_recurse() {
            if let StmtData::SExpr(expr) = &stmt.data {
                self.skip(&expr.value);
            }
            self.context.too_deep(stmt.loc);
            return;
        }
        walk::walk_stmt(self, stmt);
    }

    fn visit_expr(&mut self, expr: &'ast Expr) {
        if !self.context.stack_check.is_safe_to_recurse() {
            self.skip(expr);
            self.context.too_deep(expr.loc);
            return;
        }
        walk::walk_expr(self, expr);
    }

    fn visit_binding(&mut self, binding: &'ast bun_ast::Binding) {
        if !self.context.stack_check.is_safe_to_recurse() {
            self.context.too_deep(binding.loc);
            return;
        }
        walk::walk_binding(self, binding);
    }

    fn visit_s_debugger(&mut self, _: &'ast S::Debugger, loc: Loc) {
        rules::no_debugger::s_debugger(&mut self.context, loc);
    }

    fn visit_s_switch(&mut self, node: &'ast S::Switch, loc: Loc) {
        if self.stress {
            self.context.stress_switch(node);
        }
        rules::no_duplicate_case::s_switch(&mut self.context, node);
        rules::use_isnan::s_switch(&mut self.context, node, loc);
        walk::walk_s_switch(self, node);
    }

    fn visit_s_for_in(&mut self, node: &'ast S::ForIn, _: Loc) {
        if let StmtData::SExpr(head) = &node.init.data {
            self.mark(&head.value);
        }
        walk::walk_s_for_in(self, node);
    }

    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _: Loc) {
        if let StmtData::SExpr(head) = &node.init.data {
            self.mark(&head.value);
        }
        walk::walk_s_for_of(self, node);
    }

    fn visit_s_function(&mut self, node: &'ast S::Function, _: Loc) {
        if let Some(name) = &node.func.name {
            self.context.declare(name.ref_);
        }
        walk::walk_s_function(self, node);
    }

    fn visit_e_function(&mut self, node: &'ast E::Function, _: Loc) {
        if let Some(name) = &node.func.name {
            self.context.declare(name.ref_);
        }
        walk::walk_e_function(self, node);
    }

    fn visit_s_class(&mut self, node: &'ast S::Class, _: Loc) {
        self.class(&node.class);
        walk::walk_s_class(self, node);
    }

    fn visit_e_class(&mut self, node: &'ast E::Class, _: Loc) {
        self.class(node);
        walk::walk_e_class(self, node);
    }

    fn visit_s_import(&mut self, node: &'ast S::Import, _: Loc) {
        if let Some(name) = &node.default_name {
            self.context.declare(name.ref_);
        }
        if node.star_name_loc.start >= 0 {
            self.context.declare(node.namespace_ref);
        }
        for item in node.items.slice() {
            self.context.declare(item.name.ref_);
        }
    }

    fn visit_b_identifier(&mut self, node: &'ast B::Identifier, _: Loc) {
        self.context.declare(node.r#ref);
    }

    fn visit_b_array(&mut self, node: &'ast B::Array, loc: Loc) {
        rules::no_empty_pattern::b_array(&mut self.context, node, loc);
        walk::walk_b_array(self, node);
    }

    fn visit_b_object(&mut self, node: &'ast B::Object, loc: Loc) {
        rules::no_empty_pattern::b_object(&mut self.context, node, loc);
        walk::walk_b_object(self, node);
    }

    fn visit_e_binary(&mut self, node: &'ast E::Binary, loc: Loc) -> Option<&'ast Expr> {
        // The `=` of a default in a pattern is not an assignment: its left side is a target all the same.
        if self.stress {
            self.context.stress_binary(node, loc);
        }
        let is_default =
            node.op == OpCode::BinAssign && self.take(core::ptr::from_ref(node).addr());
        if node.op == OpCode::BinAssign
            && matches!(node.left.data, ExprData::EArray(_) | ExprData::EObject(_))
        {
            self.mark(&node.left);
        }
        if !is_default {
            rules::no_self_assign::e_binary(&mut self.context, node);
        }
        rules::no_compare_neg_zero::e_binary(&mut self.context, node, loc);
        rules::use_isnan::e_binary(&mut self.context, node, loc);
        rules::valid_typeof::e_binary(&mut self.context, node);
        rules::no_unsafe_negation::e_binary(&mut self.context, node);
        walk::walk_e_binary(self, node)
    }

    fn visit_e_dot(&mut self, node: &'ast E::Dot, loc: Loc) {
        if self.stress {
            self.context
                .stress_member(loc, node.name_loc, &node.target, None);
        }
        walk::walk_e_dot(self, node);
    }

    fn visit_e_index(&mut self, node: &'ast E::Index, loc: Loc) {
        if self.stress {
            self.context
                .stress_member(loc, node.index.loc, &node.target, Some(&node.index));
        }
        walk::walk_e_index(self, node);
    }

    fn visit_e_array(&mut self, node: &'ast E::Array, loc: Loc) {
        let is_target = self.take(core::ptr::from_ref(node).addr());
        if is_target {
            rules::no_empty_pattern::e_array(&mut self.context, node, loc);
            for item in node.items.as_slice().iter().rev() {
                self.mark(item);
            }
        } else {
            rules::no_sparse_arrays::e_array(&mut self.context, node);
        }
        walk::walk_e_array(self, node);
    }

    fn visit_e_object(&mut self, node: &'ast E::Object, loc: Loc) {
        let is_target = self.take(core::ptr::from_ref(node).addr());
        if is_target {
            rules::no_empty_pattern::e_object(&mut self.context, node, loc);
            for property in node.properties.as_slice().iter().rev() {
                if let Some(value) = &property.value {
                    self.mark(value);
                }
            }
        } else {
            rules::no_dupe_keys::e_object(&mut self.context, node);
        }
        walk::walk_e_object(self, node);
    }
}

impl Linter<'_, '_> {
    fn class(&mut self, class: &G::Class) {
        if let Some(name) = &class.class_name {
            self.context.declare(name.ref_);
        }
        rules::no_dupe_class_members::class(&mut self.context, class);
    }
}
