use bun_lint_oxlint::import::export_default;
use bun_lint_oxlint::module_record::ModuleRecord;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Checks whether there is a default export.
pub struct PreferDefaultExport {
    /// `target: "any"`, not `"single"`.
    is_for_any: bool,
}

const SINGLE: Message = Message::new("", "Prefer default export on a file with single export.");
const ANY: Message = Message::new("", "Prefer default export to be present on every file that has export.");

impl Rule for PreferDefaultExport {
    const META: Meta = Meta::oxlint(Plugin::Import, "prefer-default-export", Kind::Suggestion);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        PreferDefaultExport { is_for_any: options.object(0).str("target") == Some("any") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.finish(Self::check);
    }
}

impl PreferDefaultExport {
    fn check<'a>(&self, cx: &mut Cx<'a, Self>) {
        if export_default(cx.file()).is_some() {
            return;
        }
        let record = ModuleRecord::new(cx.file());
        let (indirect, local) = (&record.indirect_export_entries, &record.local_export_entries);
        if !record.star_export_entries.is_empty() || indirect.iter().chain(local).any(|it| it.is_type) {
            return;
        }
        if self.is_for_any {
            if let Some(last) = indirect.iter().chain(local).max_by_key(|it| it.statement_span.start) {
                cx.report(last.statement_span, ANY);
            }
        } else if let ([entry], []) = (&indirect[..], &local[..]) {
            cx.report(entry.span, SINGLE);
        } else if let ([], [entry]) = (&indirect[..], &local[..]) {
            cx.report(entry.statement_span, SINGLE);
        }
    }
}
