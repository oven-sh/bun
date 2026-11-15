use super::ScanInputs;
use super::call_sites::follow_initialized_bindings;
use super::changed_files::{TextsOfFile, find_value_of_export};
use super::named_paths::may_lead_to_own_folder;
use crate::atom::{Atom, known};
use crate::bind::{Decl, SymbolId};
use crate::hir::{ExprId, ExprKind, PropKey, PropKind};

const DEEPEST_OBJECT: usize = 4;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub struct ExportedPath {
    pub members: Atom,
    pub path: Atom,
}

impl TextsOfFile<'_, '_> {
    pub fn find_exported_paths(&self) -> Vec<ExportedPath> {
        let mut found = Vec::new();
        if self.inputs().bound.may_name_own_path() {
            collect_exported_paths(self.inputs(), self, &mut found);
        }
        found
    }
}

fn collect_exported_paths(
    inputs: &ScanInputs<'_, '_>,
    texts: &TextsOfFile<'_, '_>,
    found: &mut Vec<ExportedPath>,
) {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    for &(export, symbol) in bound.table(bound.symbol(bound.file_symbol).exports) {
        let assigned = || find_module_exports_value(inputs, symbol);
        let Some(value) = find_value_of_export(hir, bound, symbol).or_else(assigned) else {
            continue;
        };
        let members = match export == known::export_equals {
            true => Vec::new(),
            false => atoms.bytes(export).to_vec(),
        };
        collect_paths_in(inputs, texts, value, &members, DEEPEST_OBJECT, found);
    }
}

fn find_module_exports_value(inputs: &ScanInputs<'_, '_>, export: SymbolId) -> Option<ExprId> {
    let &ScanInputs { hir, bound, .. } = inputs;
    let mut declarations = bound.symbol(export).decls.iter();
    declarations.find_map(|&declaration| match declaration {
        Decl::ModuleExports(assignment) => match hir[assignment].kind {
            ExprKind::Assign {
                op: None, value, ..
            } => Some(value),
            _ => None,
        },
        _ => None,
    })
}

fn collect_paths_in(
    inputs: &ScanInputs<'_, '_>,
    texts: &TextsOfFile<'_, '_>,
    value: ExprId,
    members: &[u8],
    steps_left: usize,
    found: &mut Vec<ExportedPath>,
) {
    let &ScanInputs {
        hir, bound, atoms, ..
    } = inputs;
    let written = follow_initialized_bindings(hir, bound, value, value);
    let ExprKind::Object(properties) = hir[written].kind else {
        if may_lead_to_own_folder(inputs, value) {
            let paths = texts.find_module_relative_reads(value).paths;
            let members = atoms.intern(members);
            found.extend(paths.into_iter().map(|path| ExportedPath { members, path }));
        }
        return;
    };
    let Some(steps_left) = steps_left.checked_sub(1) else {
        return;
    };
    for id in properties.iter() {
        if let (PropKind::Init | PropKind::Shorthand, PropKey::Name(name)) =
            (hir[id].kind, hir.runtime_property_key(id))
        {
            let members = write_members(members, atoms.bytes(name));
            collect_paths_in(inputs, texts, hir[id].value, &members, steps_left, found);
        }
    }
}

fn write_members(members: &[u8], name: &[u8]) -> Vec<u8> {
    match members {
        [] => name.to_vec(),
        _ => [members, b"\0", name].concat(),
    }
}
