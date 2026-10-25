use bun_sema::atom::{Atom, Interner};
use bun_sema::bind::{
    Bound, LinkedBinding, LoadedValue, ReferentContext, StaticInitializer, SymbolId,
    static_initializer, static_referent,
};
use bun_sema::check::aot::{NamedValue, NamedValues};
use bun_sema::hir::{ExprId, File};
use bun_sema::program::{FileId, Files};

use super::table::{self, MemberLookup};
use super::{
    BuiltinId, BuiltinNames, ImportTargets, Platforms, ResolveInput, ResolvedBuiltins,
    SourceDialect, find_frozen_value, named_value_of, resolve_file,
};

const PLATFORM: Platforms = Platforms::LINUX;

// The files without the links between their modules: an imported name names nothing, and no call loads a module.
pub struct UnlinkedFiles<'a, 's> {
    files: &'a Files<'s>,
    names: BuiltinNames,
    builtins: Vec<Option<ResolvedBuiltins>>,
}

impl<'a, 's> UnlinkedFiles<'a, 's> {
    pub fn new(files: &'a Files<'s>, atoms: &Interner<'s>) -> UnlinkedFiles<'a, 's> {
        let names = BuiltinNames::new(atoms);
        let mut builtins: Vec<Option<ResolvedBuiltins>> = Vec::new();
        builtins.resize_with(files.modules.len(), || None);
        for &file in files.compiled_files() {
            let analysis = files.analysis(file);
            builtins[file.idx()] = Some(resolve_file(&ResolveInput {
                hir: files.hir(file),
                bound: files.bound(file),
                decisions: &analysis.decisions,
                module_format: analysis.module_format,
                targets: &ImportTargets::new(&[]),
                names: &names,
                platform: PLATFORM,
                dialect: SourceDialect::Program,
            }));
        }
        UnlinkedFiles {
            files,
            names,
            builtins,
        }
    }
}

impl<'s> ReferentContext<'s> for UnlinkedFiles<'_, 's> {
    type Builtin = BuiltinId;
    type Module = ();

    fn hir(&self, file: FileId) -> &File<'s> {
        self.files.hir(file)
    }

    fn bound(&self, file: FileId) -> &Bound<'s> {
        self.files.bound(file)
    }

    fn builtin_of_expression(&self, file: FileId, expr: ExprId) -> Option<BuiltinId> {
        self.builtins[file.idx()]
            .as_ref()?
            .builtin_of_expression(expr)
    }

    fn builtin_member(&self, holder: BuiltinId, name: Atom) -> Option<BuiltinId> {
        match table::member(holder, self.names.get(name)?) {
            MemberLookup::Found(member) if table::exists_on(member, PLATFORM) => {
                Some(table::canonical_id(member))
            }
            MemberLookup::Found(_) | MemberLookup::Absent | MemberLookup::Unknown => None,
        }
    }

    fn linked_binding(&self, _: FileId, _: SymbolId) -> LinkedBinding<BuiltinId, ()> {
        LinkedBinding::Unknown
    }

    fn module_export(&self, _: (), _: Atom) -> LinkedBinding<BuiltinId, ()> {
        LinkedBinding::Unknown
    }

    fn loaded_value(&self, _: FileId, _: ExprId) -> Option<LoadedValue<()>> {
        None
    }

    fn is_dead_store(&self, file: FileId, target: ExprId) -> bool {
        self.files.analysis(file).decisions.is_dead_expr(target)
    }
}

impl NamedValues for UnlinkedFiles<'_, '_> {
    fn find_named_value(&self, file: FileId, expression: ExprId) -> Option<NamedValue> {
        named_value_of(static_referent(self, file, expression).referent)
    }

    fn find_initializer(&self, file: FileId, expression: ExprId) -> Option<StaticInitializer> {
        static_initializer(self, file, expression)
    }

    fn find_frozen_value(&self, file: FileId, expression: ExprId) -> Option<ExprId> {
        find_frozen_value(self, file, expression)
    }
}
