use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint_oxlint::import::export_default;
use bun_lint_oxlint::module_record::ModuleRecord;
use smallvec::{SmallVec, smallvec};

/// Prefer a default export if module exports a single name or multiple names.
pub struct PreferDefaultExport {
    /// `target: "any"`, not `"single"`.
    is_for_any: bool,
}

const SINGLE: Message = Message::new("", "Prefer default export on a file with single export.");
const ANY: Message = Message::new("", "Prefer default export to be present on every file that has export.");

#[derive(Default)]
pub struct Seen {
    /// There is a default export, an `export *` or an export of a type.
    is_exempt: bool,
    count: u32,
    /// upstream's `namedExportNode`: what is reported.
    last: Option<Span>,
}

impl Seen {
    /// The listeners are called in no particular order. Of two nodes ESLint comes last to the one that starts later.
    fn see(&mut self, node: Span) {
        if self.last.is_none_or(|it| it.start < node.start) {
            self.last = Some(node);
        }
    }

    /// What oxlint goes by: its module record, which has the top level alone, with an entry for each name.
    fn in_record<'a>(file: &'a File<'a>, is_for_any: bool) -> Seen {
        if export_default(file).is_some() {
            return Seen { is_exempt: true, ..Seen::default() };
        }
        let record = ModuleRecord::new(file);
        let (indirect, local) = (&record.indirect_export_entries, &record.local_export_entries);
        Seen {
            is_exempt: !record.star_export_entries.is_empty() || indirect.iter().chain(local).any(|it| it.is_type),
            count: (indirect.len() + local.len()) as u32,
            last: match indirect.first() {
                _ if is_for_any => {
                    indirect.iter().chain(local).max_by_key(|it| it.statement_span.start).map(|it| it.statement_span)
                }
                Some(entry) => Some(entry.span),
                None => local.first().map(|it| it.statement_span),
            },
        }
    }
}

/// upstream's `captureDeclaration`: a hole counts, and so does, for one, what has a default or follows `...`.
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
    type State<'a> = Seen;

    fn new(options: &Options) -> Self {
        PreferDefaultExport { is_for_any: options.object(0).str("target") == Some("any") }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        // oxlint looks at nothing but its module record.
        if file.language().is_oxlint { On::new().finish() } else { Self::ON }
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Seen> {
        Some(Seen::default())
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if matches!(stmt.tag(), StmtTag::ExportStar | StmtTag::ExportDefault) {
            cx.state.is_exempt = true;
            return;
        }
        // typescript-estree makes an export of a declaration whose first modifier is `export`, wherever it is.
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
        cx.state.see(Span::new(export.span().start, stmt.span().end));
    }

    fn export_spec<'a>(&self, spec: ExportSpec<'a>, cx: &mut Cx<'a, Self>) {
        if spec.exported().name().is("default") {
            cx.state.is_exempt = true;
        } else {
            cx.state.count += 1;
            cx.state.see(spec.span());
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if cx.language().is_oxlint {
            cx.state = Seen::in_record(cx.file(), self.is_for_any);
        }
        let Seen { is_exempt: false, count, last: Some(last) } = cx.state else { return };
        if self.is_for_any && count > 0 {
            cx.report(last, ANY);
        } else if !self.is_for_any && count == 1 {
            cx.report(last, SINGLE);
        }
    }
}
