use crate::import_type::{ImportType, ImportTypes};
use crate::module_visitor::static_require;
use bun_lint_oxlint::ast_util::static_string;
use bun_lint_oxlint::import::{common_js_require, is_nodejs_builtin_module};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use rustc_hash::FxHashSet;

/// Forbid Node.js builtin modules.
pub struct NoNodejsModules {
    allow: FxHashSet<Box<[u8]>>,
}

const NO_NODEJS_MODULES: Message = Message::new("", "Do not import Node.js builtin module \"{{name}}\"");
const OXLINT: Message = Message::new("", "Do not import Node.js builtin module `{{module_name}}`");

pub struct State<'a> {
    /// `None`: oxlint goes by the name alone.
    types: Option<ImportTypes<'a>>,
}

impl Rule for NoNodejsModules {
    const META: Meta = Meta::plugin(Plugin::Import, "no-nodejs-modules", Kind::Suggestion).needs_modules();
    const ON: On = On::new()
        .stmts(&[StmtTag::Import, StmtTag::ImportEquals, StmtTag::ExportNamed, StmtTag::ExportStar])
        .exprs(&[ExprTag::ImportCall, ExprTag::Call]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoNodejsModules { allow: options.object(0).strings("allow").iter().map(|it| it.as_bytes().into()).collect() }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new()
            .stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar])
            .exprs(&[ExprTag::ImportCall]);
        // oxlint looks at `import a = require("a")` too.
        if file.language().is_oxlint {
            on = on.stmts(&[StmtTag::ImportEquals]);
        }
        if file.mentions("require") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        if file.language().is_oxlint {
            return Some(State { types: None });
        }
        Some(State { types: Some(ImportTypes::of(file)?) })
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
            let node = if is_import_equals { stmt.span_without_export() } else { stmt.span() };
            self.check(module_name, node, is_import_equals, cx);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.state.types.is_none();
        let module_name = match e.kind() {
            // oxlint reads a template too, and nothing that is in parentheses.
            ExprKind::ImportCall { args } if is_oxlint => {
                args.first().filter(|it| !it.is_parenthesized()).and_then(static_string)
            }
            ExprKind::ImportCall { args } => args.first().and_then(Expr::as_string),
            // oxlint passes over `require?.("a")`, and over what is in parentheses.
            ExprKind::Call(call) if is_oxlint => {
                common_js_require(call).filter(|_| !call.is_optional()).and_then(Expr::as_string)
            }
            ExprKind::Call(call) => static_require(call).and_then(Expr::as_string),
            _ => None,
        };
        if let Some(module_name) = module_name {
            self.check(module_name, e.span(), e.tag() == ExprTag::Call, cx);
        }
    }
}

impl NoNodejsModules {
    /// upstream's `reportIfMissing`
    fn check<'a>(&self, module_name: Name<'a>, node: Span, is_require: bool, cx: &Cx<'a, Self>) {
        let name = module_name.bytes();
        if self.allow.contains(name) {
            return;
        }
        match &cx.state.types {
            None if name.starts_with(b"node:") || is_nodejs_builtin_module(name) => {
                cx.report(node, OXLINT).data("module_name", module_name);
            }
            Some(types) if types.of_name(name, is_require) == ImportType::Builtin => {
                cx.report(node, NO_NODEJS_MODULES).data("name", module_name);
            }
            _ => {}
        }
    }
}
