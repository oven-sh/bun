use super::Constant;
use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use crate::atom::{Atom, known};
use crate::bind::{BindingKind, Decl, SymbolId};
use crate::hir::{ExprId, ImportedName};
use crate::util::FxHashMap;

#[derive(Default)]
pub(super) struct ImportedNames {
    asked_for: Vec<ImportedName>,
    answers: FxHashMap<ImportedName, Option<Constant>>,
    /// The names in the code that an import binds, each with what it binds.
    holders: FxHashMap<ExprId, ImportedName>,
}

impl ImportedNames {
    pub(super) fn into_asked_for(self) -> Vec<ImportedName> {
        self.asked_for
    }
}

impl<'s> Folder<'_, 's> {
    /// What an import binds. Without an `export`: the namespace object of the other file.
    fn find_imported_name(&self, symbol: SymbolId) -> Option<ImportedName> {
        if self.bound.binding_kind(symbol) != BindingKind::Import {
            return None;
        }
        let hir = self.hir;
        let mut declarations = self.bound.symbol(symbol).decls.iter();
        let (import, export) = declarations.find_map(|&declaration| match declaration {
            Decl::ImportSpec(spec) => {
                (!hir[spec].type_only).then_some((hir[spec].import, hir[spec].imported))
            }
            Decl::ImportDefault(import) => Some((import, known::default)),
            Decl::ImportNamespace(import) => Some((import, Atom::NONE)),
            _ => None,
        })?;
        // A deferred file runs when a member of its namespace object is first read.
        let is_evaluated_first = !hir[import].type_only && !hir[import].is_deferred;
        is_evaluated_first.then_some(ImportedName {
            import,
            export,
            member: Atom::NONE,
        })
    }

    // As for a `const` of the file itself the read stays where it is written, with its test for the dead zone and its place in a stack trace. What it decides is decided.
    fn fold_imported_name(&mut self, read: ExprId, name: ImportedName) -> Folded {
        let hir = self.hir;
        let names = &mut self.imported_names;
        let answer = *names.answers.entry(name).or_insert_with(|| {
            names.asked_for.push(name);
            let mut given = hir.imported_constants.iter();
            Some(given.find(|constant| constant.name == name)?.value)
        });
        let Some(value) = answer else {
            return Folded::UNKNOWN;
        };
        self.mark_folded_by_build_alone(read);
        Folded::new(Value::from(value), Effects::DeadZoneCheck)
    }

    pub(super) fn fold_import_read(&mut self, ident: ExprId, symbol: SymbolId) -> Option<Folded> {
        let name = self.find_imported_name(symbol)?;
        if !self.bound.is_evaluated_ident(ident) || !self.has_static_lookup(ident) {
            return None;
        }
        self.imported_names.holders.insert(ident, name);
        let is_read = name.export.is_some() && !self.is_assignment_target(ident);
        is_read.then(|| self.fold_imported_name(ident, name))
    }

    /// `namespace.member`, where an import binds `namespace`.
    pub(super) fn fold_imported_member(
        &mut self,
        access: ExprId,
        object: ExprId,
        member: Atom,
    ) -> Option<Folded> {
        if self.imported_names.holders.is_empty() {
            return None;
        }
        let object = self.hir.skip_type_assertions(object);
        let &holder = self.imported_names.holders.get(&object)?;
        let is_read = !self.is_assignment_target(access) && !self.is_delete_operand(access);
        is_read.then(|| self.fold_imported_name(access, ImportedName { member, ..holder }))
    }
}
