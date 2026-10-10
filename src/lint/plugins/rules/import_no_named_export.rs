use bun_lint_oxlint::import::{export_declaration_span, is_export_declaration, module_items};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid named exports.
pub struct NoNamedExport;

const NO_NAMED_EXPORT: Message = Message::new("", "Named exports are not allowed.");

impl Rule for NoNamedExport {
    const META: Meta = Meta::plugin(Plugin::Import, "no-named-export", Kind::Suggestion);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoNamedExport
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let language = file.language();
        // upstream's `sourceType`. oxlint does not ask.
        let source_type = language.parser_source_type.unwrap_or(language.source_type);
        (language.is_oxlint || source_type == SourceType::Module).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
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
    }
}
