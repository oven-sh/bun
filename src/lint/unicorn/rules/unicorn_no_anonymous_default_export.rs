use bun_lint_oxlint::ast_util::{get_inner_expression, iter_outer_expressions};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Disallows anonymous functions and classes as default exports.
pub struct NoAnonymousDefaultExport;

const NO_ANONYMOUS_DEFAULT_EXPORT: Message = Message::new("", "This {{kind}} default export is missing a name");

impl Rule for NoAnonymousDefaultExport {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "no-anonymous-default-export", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::ExportDefault, StmtTag::Fn, StmtTag::Class]).exprs(&[ExprTag::Assign]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoAnonymousDefaultExport
    }

    // `export default ..`
    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.kind() {
            StmtKind::ExportDefault(e) => check(e, cx),
            StmtKind::Fn(func) if stmt.is_default_export() && func.name().is_none() => {
                report(func.estree_span(), "function", cx)
            }
            StmtKind::Class(class) if stmt.is_default_export() && class.name().is_none() => {
                report(class.estree_span(), "class", cx);
            }
            _ => {}
        }
    }

    // `module.exports = ..`
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.file().mentions("exports") {
            return;
        }
        if let ExprKind::Assign { target, value, .. } = e.kind()
            && matches!(get_inner_expression(value).tag(), ExprTag::Fn | ExprTag::Class)
            && is_common_js_export(target)
            && matches!(iter_outer_expressions(e).next(), Some(Node::Stmt(it)) if it.tag() == StmtTag::Expr)
            && Node::Expr(e).scope().id() == cx.file().top_level_scope().id()
        {
            check(value, cx);
        }
    }
}

type Context<'a> = Cx<'a, NoAnonymousDefaultExport>;

fn report(span: Span, kind: &'static str, cx: &Context) {
    cx.report(span, NO_ANONYMOUS_DEFAULT_EXPORT).data("kind", kind);
}

/// `is_anonymous_class_or_function`
fn check<'a>(expr: Expr<'a>, cx: &Context<'a>) {
    match get_inner_expression(expr).kind() {
        ExprKind::Class(class) if class.name().is_none() => report(class.estree_span(), "class", cx),
        ExprKind::Fn(func) if func.name().is_none() => report(func.estree_span(), "function", cx),
        _ => {}
    }
}

/// `exports`, `module.exports`
fn is_common_js_export(left: Expr) -> bool {
    match left.kind() {
        ExprKind::Ident(name) => name.is("exports"),
        ExprKind::Dot { obj, name, .. } => name.name().is("exports") && get_inner_expression(obj).is_ident("module"),
        _ => false,
    }
}
