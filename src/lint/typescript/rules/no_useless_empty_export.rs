use bun_lint::prelude::*;

/// Disallow empty exports that don't change anything in a module file.
pub struct NoUselessEmptyExport;

const USELESS_EXPORT: Message =
    Message::new("uselessExport", "Empty export does nothing and can be removed.");

/// `export {}`, with or without `from`.
fn is_empty_export(stmt: Stmt) -> bool {
    matches!(stmt.kind(), StmtKind::ExportNamed(export) if export.items().is_empty())
}

fn is_other_export_or_import(stmt: Stmt) -> bool {
    match stmt.tag() {
        StmtTag::ExportNamed => !is_empty_export(stmt),
        StmtTag::ExportStar
        | StmtTag::ExportDefault
        | StmtTag::ExportAssign
        | StmtTag::Import
        | StmtTag::ImportEquals => true,
        _ => stmt.is_exported(),
    }
}

impl Rule for NoUselessEmptyExport {
    const META: Meta =
        Meta::typescript("no-useless-empty-export", Kind::Suggestion).fixable(Fixable::Code);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUselessEmptyExport
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        // There `export {}` keeps what is not exported out of the module.
        if ts_utils::is_definition_file(file.path()) {
            return;
        }
        on.stmts([StmtTag::ExportNamed], |_, stmt, cx| {
            if is_empty_export(stmt)
                && matches!(stmt.parent(), Node::File(_))
                && cx.file().body().iter().any(is_other_export_or_import)
            {
                cx.report(stmt, USELESS_EXPORT).fix(|fixer| fixer.remove(stmt));
            }
        });
    }
}
