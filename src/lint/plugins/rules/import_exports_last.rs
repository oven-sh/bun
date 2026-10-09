use bun_lint_oxlint::import::{export_declaration_span, is_export_declaration};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce that all exports are declared at the bottom of the file.
pub struct ExportsLast;

const EXPORTS_LAST: Message = Message::new("", "Export statements should appear at the end of the file");

impl Rule for ExportsLast {
    const META: Meta = Meta::oxlint(Plugin::Import, "exports-last", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        ExportsLast
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|_, cx| {
            let after_last_other = cx.file().body().iter().rev().skip_while(|it| is_exports_declaration(*it));
            for stmt in after_last_other.filter(|it| is_exports_declaration(*it)) {
                cx.report(export_declaration_span(stmt), EXPORTS_LAST);
            }
        });
    }
}

fn is_exports_declaration(stmt: Stmt) -> bool {
    matches!(stmt.tag(), StmtTag::ExportStar | StmtTag::ExportDefault | StmtTag::ExportNamed)
        || is_export_declaration(stmt)
        || stmt.is_default_export()
}
