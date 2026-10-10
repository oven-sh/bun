use bun_lint_oxlint::import::{default_keyword_span, export_default};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid default exports.
pub struct NoDefaultExport;

const PREFER_NAMED: Message = Message::new("", "Prefer named exports.");
const NO_ALIAS_DEFAULT: Message =
    Message::new("", "Do not alias `{{local}}` as `default`. Just export `{{local}}` itself instead.");
const OXLINT: Message = Message::new("", "Prefer named exports");

const EXPORTS: [StmtTag; 5] =
    [StmtTag::Fn, StmtTag::Class, StmtTag::Interface, StmtTag::ExportNamed, StmtTag::ExportDefault];

impl Rule for NoDefaultExport {
    const META: Meta = Meta::plugin(Plugin::Import, "no-default-export", Kind::Suggestion);
    const ON: On = On::new().stmts(&EXPORTS).finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoDefaultExport
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // oxlint asks its record of the module, which keeps one default export.
        if file.language().is_oxlint { On::new().finish() } else { On::new().stmts(&EXPORTS) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let language = file.language();
        // oxlint does not ask what the file is configured to be.
        let source_type = language.parser_source_type.unwrap_or(language.source_type);
        (language.is_oxlint || source_type == SourceType::Module).then_some(())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::ExportNamed(export) = stmt.kind() else {
            if stmt.tag() == StmtTag::ExportDefault || stmt.is_default_export() {
                cx.report(default_keyword_span(stmt), PREFER_NAMED);
            }
            return;
        };
        for specifier in export.items().iter().filter(|it| it.exported().name().is("default")) {
            // The second token of the statement.
            let start = skip_trivia(cx.text(), stmt.span().start + "export".len() as u32);
            let len = if export.is_type_only() { "type".len() } else { "{".len() };
            let local = specifier.local();
            // A name in quotes has no `name`.
            let local = if local.is_string() { &b"undefined"[..] } else { local.bytes() };
            cx.report(Span::new(start, start + len as u32), NO_ALIAS_DEFAULT).data("local", local);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if let Some(span) = export_default(cx.file()) {
            cx.report(span, OXLINT);
        }
    }
}
