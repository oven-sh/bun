#[cfg(test)]
mod tests;

use bun_sema::atom::{Atom, Interner, known};
use bun_sema::bind::{Binding, Bound, Decl};
use bun_sema::check::aot::ObjectMemberKind;
use bun_sema::hir::{self, ExportSpecId, StmtId, StmtKind};
use bun_sema::util::SharedSort;

use crate::ir::{PropertyKeyId, ValueId};
use crate::lower::member::PropertyName;
use crate::lower::{FileLowering, FunctionLowering, object};
use crate::modules::compare_code_units;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(super) struct NamedExport {
    exported: Atom,
    local: Atom,
    binding: Binding,
}

#[derive(PartialEq, Eq, Debug)]
pub(super) enum ModuleValue {
    DefaultExpression(StmtId),
    DefaultDeclaration(Binding),
    NamedExports(Vec<NamedExport>),
    Nothing,
}

#[derive(Copy, Clone)]
enum ExportedValue {
    Expression(StmtId),
    Declaration(Binding),
    Alias { local: Atom, binding: Binding },
}

#[derive(Copy, Clone)]
struct ExportScan<'a, 's> {
    hir: &'a hir::File<'s>,
    bound: &'a Bound<'s>,
    atoms: &'a Interner<'s>,
}

pub(super) fn find_module_value(file: &FileLowering<'_, '_, '_, '_>) -> ModuleValue {
    let scan = ExportScan {
        hir: file.hir,
        bound: file.bound,
        atoms: &file.queries.files().atoms,
    };
    scan.find_module_value()
}

impl ExportScan<'_, '_> {
    fn find_module_value(&self) -> ModuleValue {
        let bound = self.bound;
        let mut named = Vec::new();
        for &(exported, symbol) in bound.table(bound.symbol(bound.file_symbol).exports) {
            let mut declarations = bound.symbol(symbol).decls.iter();
            let value = declarations.find_map(|&declaration| self.find_declared_value(declaration));
            let (local, binding) = match value {
                Some(ExportedValue::Expression(statement)) => {
                    return ModuleValue::DefaultExpression(statement);
                }
                Some(ExportedValue::Declaration(binding)) if exported == known::default => {
                    return ModuleValue::DefaultDeclaration(binding);
                }
                Some(ExportedValue::Declaration(binding)) => (exported, binding),
                Some(ExportedValue::Alias { local, binding }) => (local, binding),
                None => continue,
            };
            named.push(NamedExport {
                exported,
                local,
                binding,
            });
        }
        if named.is_empty() {
            return ModuleValue::Nothing;
        }
        let text_of = |export: &NamedExport| self.atoms.bytes(export.exported);
        named.shared_sort_unstable_by(|a, b| compare_code_units(text_of(a), text_of(b)));
        ModuleValue::NamedExports(named)
    }

    fn find_declared_value(&self, declaration: Decl) -> Option<ExportedValue> {
        match declaration {
            Decl::ExportExpr(statement) => {
                let StmtKind::ExportDefault(_) = self.hir[statement].kind else {
                    return None;
                };
                Some(ExportedValue::Expression(statement))
            }
            Decl::ExportSpec(specifier) => self.find_aliased_binding(specifier),
            Decl::Var(_)
            | Decl::Fn(_)
            | Decl::Class(_)
            | Decl::Enum(_)
            | Decl::Module(_)
            | Decl::ImportEquals(_) => {
                let symbol = self.bound.declared_symbol(declaration);
                let has_value = symbol.is_some() && self.bound.has_runtime_value(symbol);
                has_value.then_some(ExportedValue::Declaration(Binding::Symbol(symbol)))
            }
            _ => None,
        }
    }

    fn find_aliased_binding(&self, specifier: ExportSpecId) -> Option<ExportedValue> {
        let item = &self.hir[specifier];
        let clause = &self.hir[item.export];
        if clause.has_module_specifier || clause.type_only || item.type_only {
            return None;
        }
        match self.bound.exported_binding(specifier) {
            binding @ Binding::Symbol(_) => Some(ExportedValue::Alias {
                local: item.local,
                binding,
            }),
            Binding::Arguments(_) | Binding::CommonJs(_) | Binding::Free => None,
        }
    }
}

pub(super) fn emit_module_value(
    lowering: &mut FunctionLowering<'_, '_, '_, '_, '_>,
    value: &ModuleValue,
) -> ValueId {
    match value {
        ModuleValue::Nothing => lowering.builder.undefined(),
        ModuleValue::DefaultExpression(statement) => {
            let declaration = Decl::ExportExpr(*statement);
            let symbol = lowering.file.bound.declared_symbol(declaration);
            lowering.get_binding(Binding::Symbol(symbol), known::default)
        }
        ModuleValue::DefaultDeclaration(binding) => lowering.get_binding(*binding, known::default),
        ModuleValue::NamedExports(exports) => lowering.emit_named_exports(exports),
    }
}

impl FunctionLowering<'_, '_, '_, '_, '_> {
    fn emit_named_exports(&mut self, exports: &[NamedExport]) -> ValueId {
        let keys = exports
            .iter()
            .map(|export| self.file.name_key(export.exported));
        let members: Vec<(PropertyKeyId, ObjectMemberKind)> =
            keys.map(|key| (key, ObjectMemberKind::Field)).collect();
        let layout = self.file.untyped_layout(&members);
        let mut created = self.begin_object(layout);
        for (export, &(key, _)) in exports.iter().zip(&members) {
            let value = self.get_binding(export.binding, export.local);
            self.add_property(&mut created, PropertyName::Constant(key), value, None);
        }
        object::finish_object(self, created)
    }
}
