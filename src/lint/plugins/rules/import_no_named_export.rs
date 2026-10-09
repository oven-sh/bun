use bun_lint_oxlint::import::{export_declaration_span, is_export_declaration, module_items};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Prohibit named exports.
pub struct NoNamedExport;

const NO_NAMED_EXPORT: Message = Message::new("", "Named exports are not allowed.");

impl Rule for NoNamedExport {
    const META: Meta = Meta::oxlint(Plugin::Import, "no-named-export", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNamedExport
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(|_, cx| {
            for stmt in module_items(cx.file()) {
                let is_named = match stmt.kind() {
                    StmtKind::ExportStar { .. } => true,
                    StmtKind::ExportNamed(export) => {
                        export.items().is_empty() || export.items().iter().any(|it| !it.exported().name().is("default"))
                    }
                    _ => is_export_declaration(stmt),
                };
                if is_named {
                    cx.report(export_declaration_span(stmt), NO_NAMED_EXPORT);
                }
            }
        });
    }
}
