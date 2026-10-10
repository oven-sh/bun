use bun_lint_oxlint::ast_util::{get_inner_expression, is_method_call, is_specific_id};
use crate::oxlint::vue::{as_inner_object_expression, is_vue_file, is_vue_setup};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// This rule requires that the component object be directly exported.
pub struct RequireDirectExport {
    disallow_functional_component_function: bool,
}

const REQUIRE_DIRECT_EXPORT: Message = Message::new("", "Expected the component literal to be directly exported.");

impl Rule for RequireDirectExport {
    const META: Meta = Meta::oxlint(Plugin::Vue, "require-direct-export", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::ExportDefault, StmtTag::Fn, StmtTag::Class, StmtTag::Interface]);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        RequireDirectExport { disallow_functional_component_function: options.bool_or("disallowFunctionalComponentFunction", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        if !is_vue_file(file) || is_vue_setup(file) {
            return None;
        }
        Some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let is_direct = match stmt.kind() {
            StmtKind::ExportDefault(e) => self.is_direct_expression(get_inner_expression(e)),
            _ if !stmt.is_default_export() => true,
            // `export default function () {}`
            StmtKind::Fn(func) => self.is_functional_component(func),
            _ => false,
        };
        if !is_direct {
            cx.report(stmt, REQUIRE_DIRECT_EXPORT);
        }
    }
}

impl RequireDirectExport {
    /// A function that returns a value.
    fn is_functional_component(&self, func: Func) -> bool {
        !self.disallow_functional_component_function
            && (matches!(func.body(), FnBody::Expr(_)) || func.returns().any(|it| matches!(it.kind(), StmtKind::Return(Some(_)))))
    }

    fn is_direct_expression(&self, inner_expr: Expr) -> bool {
        match inner_expr.kind() {
            ExprKind::Ident(_) => false,
            ExprKind::Fn(func) => self.is_functional_component(func),
            // `defineComponent({ .. })`, `Vue.extend({ .. })`
            ExprKind::Call(call_expr) if !inner_expr.is_chain_root() => {
                (is_specific_id(call_expr.callee(), "defineComponent")
                    || is_method_call(call_expr, Some(&["Vue"]), Some(&["extend"]), None, None))
                    && call_expr.args().first().and_then(as_inner_object_expression).is_some()
            }
            _ => true,
        }
    }
}
