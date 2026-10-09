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
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoNodejsModules { allow: options.object(0).strings("allow").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        on.stmts([StmtTag::Import, StmtTag::ImportEquals, StmtTag::ExportNamed, StmtTag::ExportStar], |rule, stmt, cx| {
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
                rule.check(module_name, if is_import_equals { stmt.span_without_export() } else { stmt.span() }, cx);
            }
        });
        on.exprs([ExprTag::ImportCall], |rule, e, cx| {
            let ExprKind::ImportCall { args } = e.kind() else {
                return;
            };
            let module_name = args.first().filter(|it| !it.is_parenthesized()).and_then(|source| match source.kind() {
                ExprKind::String(value) => Some(value),
                ExprKind::Template(template) => template.as_static(),
                _ => None,
            });
            if let Some(module_name) = module_name {
                rule.check(module_name, e.span(), cx);
            }
        });
        if file.mentions("require") {
            on.exprs([ExprTag::Call], |rule, e, cx| {
                if let Some(call) = e.as_call().filter(|it| !it.is_optional())
                    && let Some(module_name) = common_js_require(call).and_then(Expr::as_string)
                {
                    rule.check(module_name, e.span(), cx);
                }
            });
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
