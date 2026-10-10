use bun_lint_oxlint::import::common_js_require;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbids importing modules from parent directories using relative paths.
pub struct NoRelativeParentImports;

const NO_RELATIVE_PARENT_IMPORTS: Message = Message::new("", "Relative imports from parent directories are not allowed");

impl Rule for NoRelativeParentImports {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-relative-parent-imports", Kind::Suggestion);
    const ON: On =
        On::new().stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar]).exprs(&[ExprTag::ImportCall, ExprTag::Call]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoRelativeParentImports
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().stmts(&[StmtTag::Import, StmtTag::ExportNamed, StmtTag::ExportStar]).exprs(&[ExprTag::ImportCall]);
        if file.mentions("require") {
            on = on.exprs(&[ExprTag::Call]);
        }
        on
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let source = match stmt.kind() {
            StmtKind::Import(import) => Some(import.spec()),
            StmtKind::ExportNamed(export) => export.spec(),
            StmtKind::ExportStar { spec, .. } => spec,
            _ => None,
        };
        if source.is_some_and(is_parent_import)
            && let Some(span) = stmt.module_specifier_span()
        {
            cx.report(span, NO_RELATIVE_PARENT_IMPORTS);
        }
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::ImportCall => {
                if let ExprKind::ImportCall { args } = e.kind()
                    && let Some(source) = args.first().filter(|it| !it.is_parenthesized())
                    && source.as_string().is_some_and(is_parent_import)
                {
                    cx.report(source, NO_RELATIVE_PARENT_IMPORTS);
                }
            }
            ExprTag::Call => {
                if let Some(source) = e.as_call().and_then(common_js_require)
                    && source.as_string().is_some_and(is_parent_import)
                {
                    cx.report(source, NO_RELATIVE_PARENT_IMPORTS);
                }
            }
            _ => {}
        }
    }
}

fn is_parent_import(path: Name) -> bool {
    let mut normalized = path.bytes();
    while let Some(rest) = normalized.strip_prefix(b"./") {
        normalized = rest;
    }
    normalized == b".." || normalized.starts_with(b"../")
}
