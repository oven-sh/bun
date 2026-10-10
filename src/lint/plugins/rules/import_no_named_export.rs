use bun_lint_oxlint::import::{export_declaration_span, is_export_declaration, module_items};
use bun_lint::language::Parser;
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
        // upstream's `sourceType`: that of `parserOptions`, whatever it is. For espree ESLint writes its own there.
        let written = language.parser_options.get(b"sourceType").filter(|_| language.parser != Parser::Espree);
        let is_module = match written {
            Some(source_type) => source_type.as_str().is_some_and(|it| it == b"module"),
            None => language.source_type == SourceType::Module,
        };
        // oxlint does not ask.
        (language.is_oxlint || is_module).then_some(())
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
