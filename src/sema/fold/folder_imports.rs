use super::Constant;
use super::evaluate::Value;
use super::folder::{Effects, Folded, Folder};
use crate::atom::{Atom, known};
use crate::bind::{BindingKind, Decl, SymbolId};
use crate::hir::{ExprId, ImportedName};
use crate::util::FxHashMap;

const MAX_SCANNED_CONSTANTS: usize = 16;

#[derive(Default)]
pub(super) struct ImportedNames {
    asked_for: Vec<ImportedName>,
    answers: FxHashMap<ImportedName, Option<Constant>>,
    given: Option<FxHashMap<ImportedName, Constant>>,
    holders: Vec<ImportedName>,
    holder_numbers: Vec<u32>,
}

impl ImportedNames {
    pub(super) fn into_asked_for(self) -> Vec<ImportedName> {
        self.asked_for
    }

    fn note_holder(&mut self, holder: ExprId, name: ImportedName, expr_count: usize) {
        if self.holder_numbers.is_empty() {
            self.holder_numbers = vec![0; expr_count];
        }
        self.holders.push(name);
        self.holder_numbers[holder.idx()] = self.holders.len() as u32;
    }

    fn find_holder(&self, holder: ExprId) -> Option<ImportedName> {
        let number = *self.holder_numbers.get(holder.idx())?;
        Some(self.holders[number.checked_sub(1)? as usize])
    }
}

impl<'s> Folder<'_, 's> {
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
        let is_evaluated_first = !hir[import].type_only && !hir[import].is_deferred;
        is_evaluated_first.then_some(ImportedName {
            import,
            export,
            member: Atom::NONE,
        })
    }

    fn fold_imported_name(&mut self, read: ExprId, name: ImportedName) -> Folded {
        let hir = self.hir;
        let names = &mut self.imported_names;
        let answer = *names.answers.entry(name).or_insert_with(|| {
            names.asked_for.push(name);
            let given = &hir.imported_constants;
            if given.len() <= MAX_SCANNED_CONSTANTS {
                return Some(given.iter().find(|constant| constant.name == name)?.value);
            }
            let by_name = names.given.get_or_insert_with(|| {
                let mut by_name = FxHashMap::default();
                for constant in given.iter() {
                    by_name.entry(constant.name).or_insert(constant.value);
                }
                by_name
            });
            by_name.get(&name).copied()
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
        let expr_count = self.hir.exprs.len();
        self.imported_names.note_holder(ident, name, expr_count);
        let is_read = name.export.is_some() && !self.is_assignment_target(ident);
        is_read.then(|| self.fold_imported_name(ident, name))
    }

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
        let holder = self.imported_names.find_holder(object)?;
        let is_read = !self.is_assignment_target(access) && !self.is_delete_operand(access);
        is_read.then(|| self.fold_imported_name(access, ImportedName { member, ..holder }))
    }
}
