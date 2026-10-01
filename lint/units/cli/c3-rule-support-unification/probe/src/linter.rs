//! The one walk of a file: every hook a rule needs is here and calls the rule's handler.
use crate::context::{Context, Report};
use crate::rules;
use bun_ast::expr::Data as ExprData;
use bun_ast::stmt::Data as StmtData;
use bun_ast::walk::{self, Visitor};
use bun_ast::{B, Binding, E, Expr, Loc, OpCode, S, Stmt};
use bun_js_parser::parse::parse_entry::ParsedOnly;

pub(crate) struct Linter<'a, 'p> {
    cx: Context<'a, 'p>,
    stack: bun_core::StackCheck,
    too_deep: Option<Loc>,
}

pub(crate) fn lint<'a, 'p>(parsed: &'p ParsedOnly<'p, 'a>, source: &'a bun_ast::Source, arena: &'a bun_alloc::Arena) -> Vec<Report> {
    let mut linter = Linter { cx: Context::new(parsed, source, arena), stack: bun_core::StackCheck::init(), too_deep: None };
    for stmt in parsed.stmts {
        linter.visit_stmt(stmt);
    }
    if let Some(at) = linter.too_deep {
        linter.cx.report("internal-error", at, format_args!("The code nests too deeply to lint: what is inside was not checked."));
    }
    linter.cx.finish()
}

impl Linter<'_, '_> {
    /// False once: the stack is nearly used up, and the node at `at` is not walked.
    fn has_stack(&mut self, at: Loc) -> bool {
        if self.stack.is_safe_to_recurse() {
            return true;
        }
        self.too_deep.get_or_insert(at);
        false
    }
}

impl<'ast> Visitor<'ast> for Linter<'_, '_> {
    fn visit_stmt(&mut self, stmt: &'ast Stmt) {
        if self.has_stack(stmt.loc) {
            walk::walk_stmt(self, stmt);
        }
    }
    fn visit_expr(&mut self, expr: &'ast Expr) {
        if self.has_stack(expr.loc) {
            walk::walk_expr(self, expr);
        }
    }
    fn visit_binding(&mut self, binding: &'ast Binding) {
        if self.has_stack(binding.loc) {
            walk::walk_binding(self, binding);
        }
    }

    fn visit_s_debugger(&mut self, _node: &'ast S::Debugger, loc: Loc) {
        rules::no_debugger::s_debugger(&mut self.cx, loc);
    }
    fn visit_s_switch(&mut self, node: &'ast S::Switch, loc: Loc) {
        rules::use_isnan::s_switch(&mut self.cx, node, loc);
        rules::no_duplicate_case::s_switch(&mut self.cx, node);
        walk::walk_s_switch(self, node);
    }
    fn visit_s_for_in(&mut self, node: &'ast S::ForIn, _loc: Loc) {
        if let StmtData::SExpr(init) = &node.init.data {
            self.cx.mark_target(&init.value);
        }
        walk::walk_s_for_in(self, node);
    }
    fn visit_s_for_of(&mut self, node: &'ast S::ForOf, _loc: Loc) {
        if let StmtData::SExpr(init) = &node.init.data {
            self.cx.mark_target(&init.value);
        }
        walk::walk_s_for_of(self, node);
    }
    fn visit_s_function(&mut self, node: &'ast S::Function, _loc: Loc) {
        if let Some(name) = node.func.name {
            self.cx.declare(name.ref_);
        }
        walk::walk_s_function(self, node);
    }
    fn visit_e_function(&mut self, node: &'ast E::Function, _loc: Loc) {
        if let Some(name) = node.func.name {
            self.cx.declare(name.ref_);
        }
        walk::walk_e_function(self, node);
    }
    fn visit_s_class(&mut self, node: &'ast S::Class, _loc: Loc) {
        if let Some(name) = node.class.class_name {
            self.cx.declare(name.ref_);
        }
        rules::no_dupe_class_members::class(&mut self.cx, &node.class);
        walk::walk_s_class(self, node);
    }
    fn visit_e_class(&mut self, node: &'ast E::Class, _loc: Loc) {
        if let Some(name) = node.class_name {
            self.cx.declare(name.ref_);
        }
        rules::no_dupe_class_members::class(&mut self.cx, node);
        walk::walk_e_class(self, node);
    }
    fn visit_s_import(&mut self, node: &'ast S::Import, _loc: Loc) {
        if let Some(name) = node.default_name {
            self.cx.declare(name.ref_);
        }
        if node.star_name_loc.start >= 0 {
            self.cx.declare(node.namespace_ref);
        }
        for item in node.items.iter() {
            self.cx.declare(item.name.ref_);
        }
    }
    fn visit_b_identifier(&mut self, node: &'ast B::Identifier, _loc: Loc) {
        self.cx.declare(node.r#ref);
    }
    fn visit_b_object(&mut self, node: &'ast B::Object, loc: Loc) {
        rules::no_empty_pattern::b_object(&mut self.cx, node, loc);
        walk::walk_b_object(self, node);
    }
    fn visit_b_array(&mut self, node: &'ast B::Array, loc: Loc) {
        rules::no_empty_pattern::b_array(&mut self.cx, node, loc);
        walk::walk_b_array(self, node);
    }
    fn visit_e_array(&mut self, node: &'ast E::Array, loc: Loc) {
        let is_target = self.cx.take_target(node);
        if is_target {
            for item in node.items.iter() {
                self.cx.mark_target(item);
            }
        }
        rules::no_sparse_arrays::e_array(&mut self.cx, node, is_target);
        rules::no_empty_pattern::e_array(&mut self.cx, node, loc, is_target);
        walk::walk_e_array(self, node);
    }
    fn visit_e_object(&mut self, node: &'ast E::Object, loc: Loc) {
        let is_target = self.cx.take_target(node);
        if is_target {
            for property in node.properties.iter() {
                if let Some(value) = &property.value {
                    self.cx.mark_target(value);
                }
            }
        }
        rules::no_dupe_keys::e_object(&mut self.cx, node, is_target);
        rules::no_empty_pattern::e_object(&mut self.cx, node, loc, is_target);
        walk::walk_e_object(self, node);
    }
    fn visit_e_binary(&mut self, node: &'ast E::Binary, loc: Loc) -> Option<&'ast Expr> {
        let is_default = self.cx.take_target(node);
        if node.op == OpCode::BinAssign {
            self.cx.mark_target(&node.left);
        }
        rules::no_compare_neg_zero::e_binary(&mut self.cx, node, loc);
        rules::use_isnan::e_binary(&mut self.cx, node, loc);
        rules::valid_typeof::e_binary(&mut self.cx, node);
        rules::no_unsafe_negation::e_binary(&mut self.cx, node);
        rules::no_self_assign::e_binary(&mut self.cx, node, is_default);
        walk::walk_e_binary(self, node)
    }
}

#[allow(dead_code)]
fn _unused(_: &ExprData) {}
