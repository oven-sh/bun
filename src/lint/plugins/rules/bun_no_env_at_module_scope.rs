use crate::bun::{RunsLater, is_listed, list_option, runs_while_module_is_evaluated};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::ast_util::{is_global_reference, is_import_from_module, is_import_symbol};

/// Disallow reading environment variables while the module is evaluated.
pub struct NoEnvAtModuleScope {
    allow: Box<[Box<[u8]>]>,
}

const VARIABLE: Message = Message::new(
    "variable",
    "`{{text}}` is read as soon as the module is evaluated. Read it in the function that needs it.",
);
const ENVIRONMENT: Message = Message::new(
    "environment",
    "The environment is read as soon as the module is evaluated. Read it in the function that needs it.",
);

const PROCESS_MODULES: [&str; 2] = ["node:process", "process"];

/// `process.env`, `Bun.env`, `import.meta.env`, and the `env` of `import { env } from "node:process"`.
fn is_environment(e: Expr) -> bool {
    match e.kind() {
        ExprKind::Dot { obj, name, .. } if name.name().is("env") => match obj.kind() {
            ExprKind::ImportMeta => true,
            ExprKind::Ident(owner) if owner.is("Bun") => is_global_reference(obj),
            ExprKind::Ident(owner) if owner.is("process") => {
                is_global_reference(obj) || PROCESS_MODULES.iter().any(|it| is_import_from_module(obj, it))
            }
            _ => false,
        },
        ExprKind::Ident(_) => PROCESS_MODULES.iter().any(|it| e.file().mentions(it) && is_import_symbol(e, it, "env")),
        _ => false,
    }
}

/// `e = 1`, `e ||= 1`, `delete e`
fn is_written(e: Expr) -> bool {
    matches!(e.parent().as_expr().map(Expr::kind), Some(
        ExprKind::Assign { target: operand, .. } | ExprKind::Unary { op: UnOp::Delete, operand }
    ) if operand == e)
}

impl NoEnvAtModuleScope {
    fn allows(&self, name: &[u8]) -> bool {
        is_listed(&self.allow, name)
    }

    /// `environment` is used as a whole. What `const { A, B } = process.env` reads has names.
    fn allows_all_of(&self, environment: Expr) -> bool {
        match environment.parent() {
            Node::VarDecl(declaration) => match declaration.pat().kind() {
                PatKind::Object(properties) => {
                    let mut names = properties.iter().map(|it| it.key().and_then(Key::name));
                    names.all(|name| name.is_some_and(|it| self.allows(it.bytes())))
                }
                _ => false,
            },
            _ => false,
        }
    }
}

impl Rule for NoEnvAtModuleScope {
    const META: Meta = Meta::plugin(Plugin::Bun, "no-env-at-module-scope", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]);
    type State<'a> = RunsLater<'a>;

    fn new(options: &Options) -> Self {
        NoEnvAtModuleScope { allow: list_option(options, "allow", &["NODE_ENV"]) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<RunsLater<'a>> {
        file.mentions("env").then(RunsLater::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        // Not what a type has after `typeof`.
        if !ast_utils::is_member_expression(e) {
            return;
        }
        if e.object().is_some_and(is_environment) {
            let is_allowed = || ast_utils::get_static_property_name(e).is_some_and(|name| self.allows(&name));
            if !is_written(e) && !is_allowed() && runs_while_module_is_evaluated(Node::Expr(e), &mut cx.state) {
                cx.report(e, VARIABLE).data("text", e.text());
            }
        } else if is_environment(e)
            && !matches!(e.parent(), Node::Expr(member) if member.object() == Some(e))
            && !self.allows_all_of(e)
            && runs_while_module_is_evaluated(Node::Expr(e), &mut cx.state)
        {
            cx.report(e, ENVIRONMENT);
        }
    }
}
