use bun_lint_oxlint::ast_util::static_string;
use bun_lint_oxlint::import::{common_js_require, is_nodejs_builtin_module};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Forbid the use of Node.js built-in modules.
pub struct NoNodejsModules {
    allow: FxHashSet<Box<[u8]>>,
}

const NO_NODEJS_MODULES: Message = Message::new("", "Do not import Node.js builtin module `{{module_name}}`");

impl Rule for NoNodejsModules {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-nodejs-modules", Kind::Suggestion);
    const ON: On = On::new()
        .stmts(&[StmtTag::Import, StmtTag::ImportEquals, StmtTag::ExportNamed, StmtTag::ExportStar])
        .exprs(&[ExprTag::ImportCall, ExprTag::Call]);
    no_state!();

    fn new(options: &Options) -> Self {
        NoNodejsModules { allow: options.object(0).strings("allow").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new()
            .stmts(&[StmtTag::Import, StmtTag::ImportEquals, StmtTag::ExportNamed, StmtTag::ExportStar])
            .exprs(&[ExprTag::ImportCall]);
        if file.mentions("require") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let module_name = match stmt.kind() {
            StmtKind::Import(import) => Some(import.spec()),
            StmtKind::ImportEquals(import) => match import.target() {
                ImportEqualsTarget::Require(module_name) => module_name,
                ImportEqualsTarget::Entity(_) => None,
            },
            StmtKind::ExportNamed(export) => export.spec(),
            StmtKind::ExportStar { spec, .. } => spec,
            _ => None,
        };
        if let Some(module_name) = module_name {
            let is_import_equals = stmt.tag() == StmtTag::ImportEquals;
            self.check(module_name, if is_import_equals { stmt.span_without_export() } else { stmt.span() }, cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::ImportCall => {
                let ExprKind::ImportCall { args } = e.kind() else {
                    return;
                };
                let module_name = args.first().filter(|it| !it.is_parenthesized()).and_then(static_string);
                if let Some(module_name) = module_name {
                    self.check(module_name, e.span(), cx);
                }
            }
            ExprTag::Call => {
                if let Some(call) = e.as_call().filter(|it| !it.is_optional())
                    && let Some(module_name) = common_js_require(call).and_then(Expr::as_string)
                {
                    self.check(module_name, e.span(), cx);
                }
            }
            _ => {}
        }
    }
}

impl NoNodejsModules {
    fn check<'a>(&self, module_name: Name<'a>, node: Span, cx: &Cx<'a, Self>) {
        let name = module_name.bytes();
        if (name.starts_with(b"node:") || is_nodejs_builtin_module(name)) && !self.allow.contains(name) {
            cx.report(node, NO_NODEJS_MODULES).data("module_name", module_name);
        }
    }
}
