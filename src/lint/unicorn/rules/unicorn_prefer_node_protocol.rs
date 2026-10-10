use bun_lint_oxlint::ast_util::get_inner_expression;
use bun_lint_oxlint::import::is_nodejs_builtin_module;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prefer using the `node:` protocol when importing Node.js built-in modules.
pub struct PreferNodeProtocol;

const PREFER_NODE_PROTOCOL: Message =
    Message::new("", "Prefer using the `node:` protocol when importing Node.js built-in modules.");

/// `span`: the string with its quotes.
fn check<'a>(module_name: Option<Name<'a>>, span: Option<Span>, cx: &Cx<'a, PreferNodeProtocol>) {
    if let (Some(module_name), Some(span)) = (module_name, span)
        && !module_name.bytes().starts_with(b"node:")
        && is_nodejs_builtin_module(module_name.bytes())
    {
        cx.report(span, PREFER_NODE_PROTOCOL)
            .data("module_name", module_name)
            .fix(|fixer| fixer.replace(span.shrink(1, 1), [&b"node:"[..], module_name.bytes()].concat()));
    }
}

/// `e`: the only argument of `require(..)`, the first of `import(..)`.
fn check_argument<'a>(e: Option<Expr<'a>>, cx: &Cx<'a, PreferNodeProtocol>) {
    if let Some(e) = e.filter(|it| !it.is_parenthesized()) {
        check(e.as_string(), Some(e.span()), cx);
    }
}

impl Rule for PreferNodeProtocol {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "prefer-node-protocol", Kind::Suggestion).fixable(Fixable::Code);
    const ON: On = On::new()
        .exprs(&[ExprTag::ImportCall, ExprTag::Call])
        .stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ImportEquals]);
    no_state!();

    fn new(_: &Options) -> Self {
        PreferNodeProtocol
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let module_name = match stmt.kind() {
            StmtKind::Import(import) => Some(import.spec()),
            StmtKind::ExportNamed(export) => export.spec(),
            StmtKind::ImportEquals(import) => match import.target() {
                ImportEqualsTarget::Require(module_name) => module_name,
                ImportEqualsTarget::Entity(_) => None,
            },
            _ => None,
        };
        if module_name.is_some() {
            check(module_name, stmt.module_specifier_span(), cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::ImportCall => {
                if let ExprKind::ImportCall { args } = e.kind() {
                    check_argument(args.first(), cx);
                }
            }
            ExprTag::Call => {
                if !cx.file().mentions("require") {
                    return;
                }
                if let Some(call) = e.as_call()
                    && call.args().len() == 1
                    && !call.is_optional()
                    && get_inner_expression(call.callee()).is_ident("require")
                {
                    check_argument(call.args().first(), cx);
                }
            }
            _ => {}
        }
    }
}
