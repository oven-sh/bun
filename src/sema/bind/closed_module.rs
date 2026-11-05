use crate::atom::Atom;
use crate::hir::{File, FileKind, ImportEqualsTarget, ModuleName, StmtKind};
use crate::util::FxHashSet;

pub fn specifiers_of_closed_module(file: &File) -> Option<Vec<Atom>> {
    let is_typescript = matches!(file.kind, FileKind::Ts | FileKind::Tsx) && !file.is_js;
    let is_namespace = |name: ModuleName| matches!(name, ModuleName::Ident(_));
    if !is_typescript
        || !file.has_module_syntax
        || !file.modules.iter().all(|module| is_namespace(module.name))
    {
        return None;
    }
    let mut specifiers = Vec::new();
    let mut statement_count = 0;
    for statement in file.ids(file.body) {
        let specifier = match file[statement].kind {
            StmtKind::Import(import) => file[import].spec,
            StmtKind::ImportEquals(import) => match file[import].target {
                ImportEqualsTarget::Require(specifier) => specifier,
                ImportEqualsTarget::Entity(_) => Atom::NONE,
            },
            StmtKind::ExportNamed(export) => file[export].spec,
            _ => continue,
        };
        statement_count += 1;
        specifiers.extend(specifier.is_some().then_some(specifier));
    }
    let names_other_files = |kind: StmtKind| match kind {
        StmtKind::Import(_) | StmtKind::ImportEquals(_) | StmtKind::ExportNamed(_) => Some(1),
        StmtKind::ExportStar { .. } | StmtKind::ExportAsNamespace(_) => None,
        _ => Some(0),
    };
    let all_statements = file
        .stmts
        .iter()
        .map(|statement| names_other_files(statement.kind));
    if all_statements.sum::<Option<usize>>() != Some(statement_count) {
        return None;
    }
    let uses = file.specifier_uses.iter();
    let dynamic = uses.filter(|it| it.kind.is_dynamic() && it.spec.is_some());
    let mut dynamic: Vec<(u32, Atom)> = dynamic.map(|it| (it.pos, it.spec)).collect();
    dynamic.sort_by_key(|it| it.0);
    specifiers.extend(dynamic.iter().map(|it| it.1));
    let mut seen = FxHashSet::default();
    specifiers.retain(|&specifier| seen.insert(specifier));
    Some(specifiers)
}
