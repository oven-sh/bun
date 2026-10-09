use bun_lint_oxlint::text::find_next_token_within;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Enforce a non-empty specifier list in `import` and `export` statements.
pub struct RequireModuleSpecifiers;

const EMPTY_SPECIFIER: Message = Message::new("", "Empty {{statement_type}} specifier is not allowed");

/// The first `{` and the next `}` in `span`, if there is nothing but whitespace between them.
fn find_empty_braces_in_span<'a>(file: &'a File<'a>, span: Span) -> Option<Span> {
    let open_brace = find_next_token_within(file, span.start, span.end, b"{")?;
    let close_brace = find_next_token_within(file, open_brace + 1, span.end, b"}")?;
    let between = file.slice(Span::new(open_brace + 1, close_brace));
    text::trim(between).is_empty().then(|| Span::new(open_brace, close_brace + 1))
}

impl Rule for RequireModuleSpecifiers {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "require-module-specifiers", Kind::Problem).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        RequireModuleSpecifiers
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Import], |_, stmt, cx| {
            let StmtKind::Import(import) = stmt.kind() else {
                return;
            };
            if import.is_side_effect() || import.namespace().is_some() || !import.named().is_empty() {
                return;
            }
            let (file, span) = (cx.file(), stmt.span());
            let Some(braces) = find_empty_braces_in_span(file, span) else {
                return;
            };
            cx.report(braces, EMPTY_SPECIFIER).data("statement_type", "import").fix(|fixer| {
                let comma = find_next_token_within(file, span.start, span.end, b",")?;
                let from = find_next_token_within(file, comma, span.end, b"from")?;
                let default_part = file.slice(Span::new(span.start, comma));
                let from_part = file.slice(Span::new(from, span.end));
                Some(fixer.replace(span, [default_part, b" ", from_part].concat()))
            });
        });
        on.stmts([StmtTag::ExportNamed], |_, stmt, cx| {
            let StmtKind::ExportNamed(export) = stmt.kind() else {
                return;
            };
            if !export.items().is_empty() {
                return;
            }
            let braces = find_empty_braces_in_span(cx.file(), stmt.span()).unwrap_or_else(|| stmt.span());
            cx.report(braces, EMPTY_SPECIFIER)
                .data("statement_type", "export")
                .fix(|fixer| (!export.has_from()).then(|| fixer.remove(stmt)));
        });
    }
}
