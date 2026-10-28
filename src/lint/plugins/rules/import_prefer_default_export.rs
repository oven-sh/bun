use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::import::export_default;
use bun_lint_oxlint::module_record::ModuleRecord;
use smallvec::{SmallVec, smallvec};

/// Prefer a default export if module exports a single name or multiple names.
pub struct PreferDefaultExport {
    /// True for `target: "any"`, false for `"single"`.
    target_is_any: bool,
}

const SINGLE: Message = Message::new("", "Prefer default export on a file with single export.");
const ANY: Message = Message::new("", "Prefer default export to be present on every file that has export.");

#[derive(Default)]
pub struct ExportSummary {
    /// True if there's a default export, an `export *` or a type export.
    is_exempt: bool,
    count: u32,
    /// upstream's `namedExportNode`: the span to report.
    last: Option<Span>,
}

impl ExportSummary {
    /// Listeners run in no particular order. ESLint visits the node that starts later last.
    fn record_named_export(&mut self, node: Span) {
        if self.last.is_none_or(|it| it.start < node.start) {
            self.last = Some(node);
        }
    }

    /// oxlint's version, which uses its module record. That only has the top level, with one entry per name.
    fn from_module_record<'a>(file: &'a File<'a>, target_is_any: bool) -> ExportSummary {
        if export_default(file).is_some() {
            return ExportSummary { is_exempt: true, ..ExportSummary::default() };
        }
        let record = ModuleRecord::new(file);
        let (indirect, local) = (&record.indirect_export_entries, &record.local_export_entries);
        ExportSummary {
            is_exempt: !record.star_export_entries.is_empty() || indirect.iter().chain(local).any(|it| it.is_type),
            count: (indirect.len() + local.len()) as u32,
            last: match indirect.first() {
                _ if target_is_any => {
                    indirect.iter().chain(local).max_by_key(|it| it.statement_span.start).map(|it| it.statement_span)
                }
                Some(entry) => Some(entry.span),
                None => local.first().map(|it| it.statement_span),
            },
        }
    }
}

/// upstream's `captureDeclaration`. A hole counts as one, and so does an element that has a default or follows `...`.
fn capture_declaration(pattern: Pat<'_>) -> u32 {
    let mut count = 0;
    let mut pending: SmallVec<[Pat<'_>; 8]> = smallvec![pattern];
    while let Some(pat) = pending.pop() {
        match pat.kind() {
            PatKind::Object(properties) => {
                for it in properties {
                    match it.is_rest() || it.default().is_some() {
                        true => count += 1,
                        false => pending.push(it.value()),
                    }
                }
            }
            PatKind::Array(elements) => {
                for it in elements {
                    match it.pat().filter(|_| !it.is_rest() && it.default().is_none()) {
                        Some(element) => pending.push(element),
                        None => count += 1,
                    }
                }
            }
            PatKind::Ident(_) | PatKind::Missing => count += 1,
        }
    }
    count
}

impl Rule for PreferDefaultExport {
    const META: Meta = Meta::plugin(Plugin::Import, "prefer-default-export", Kind::Suggestion).reports_at_the_end();
    const ON: On = On::new()
        .stmts(&[
            StmtTag::Var,
            StmtTag::Fn,
            StmtTag::Class,
            StmtTag::Interface,
            StmtTag::TypeAlias,
            StmtTag::Enum,
            StmtTag::Module,
            StmtTag::ImportEquals,
            StmtTag::ExportStar,
            StmtTag::ExportDefault,
        ])
        .export_specs()
        .finish();
    type State<'a> = ExportSummary;

    fn new(options: &Options) -> Self {
        PreferDefaultExport { target_is_any: options.object(0).str("target") == Some("any") }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // oxlint only uses its module record.
        if file.language().is_oxlint { On::new().finish() } else { Self::ON }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<ExportSummary> {
        Some(ExportSummary::default())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(stmt.tag(), StmtTag::ExportStar | StmtTag::ExportDefault) {
            cx.state.is_exempt = true;
            return;
        }
        // typescript-estree turns a declaration whose first modifier is `export` into an export, wherever it is.
        let mut keywords = stmt.modifiers().iter().filter(|it| it.decorator().is_none());
        let Some(export) = keywords.next().filter(|it| it.flag() == Flags::EXPORT) else { return };
        let is_default = keywords.next().is_some_and(|it| it.flag() == Flags::DEFAULT);
        if is_default || matches!(stmt.tag(), StmtTag::TypeAlias | StmtTag::Interface) {
            cx.state.is_exempt = true;
            return;
        }
        cx.state.count += match stmt.kind() {
            StmtKind::Var(declarations) => declarations.iter().map(|it| capture_declaration(it.pat())).sum::<u32>(),
            _ => 1,
        };
        cx.state.record_named_export(Span::new(export.span().start, stmt.span().end));
    }

    fn export_spec<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.exported().name().is("default") {
            cx.state.is_exempt = true;
        } else {
            cx.state.count += 1;
            cx.state.record_named_export(spec.span());
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if cx.language().is_oxlint {
            cx.state = ExportSummary::from_module_record(cx.file(), self.target_is_any);
        }
        let ExportSummary { is_exempt: false, count, last: Some(last) } = cx.state else { return };
        if self.target_is_any && count > 0 {
            cx.report(last, ANY);
        } else if !self.target_is_any && count == 1 {
            cx.report(last, SINGLE);
        }
    }
}
