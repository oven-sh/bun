use crate::builtins::table::MemberLookup;
use crate::builtins::{
    BuiltinId, BuiltinNames, ImportTargets, Platforms, ResolveInput, ResolvedBuiltins,
    SourceDialect, named_value_of, prototype_operation_of, resolve_file, table,
};
use crate::load::host_platform;
use bun_sema::atom::Atom;
use bun_sema::bind::{
    Bound, LinkedBinding, LoadedValue, ReferentContext, SymbolId, static_referent,
};
use bun_sema::check::aot::{NamedValue, NamedValues, PrototypeOperation};
use bun_sema::hir::{ExprId, File};
use bun_sema::program::{FileId, Files};

pub struct UnlinkedFiles<'a, 's> {
    files: &'a Files<'s>,
    builtin_names: BuiltinNames,
    platform: Platforms,
    builtins: Vec<Option<ResolvedBuiltins>>,
}

impl<'a, 's> UnlinkedFiles<'a, 's> {
    pub fn new(files: &'a Files<'s>) -> Self {
        let builtin_names = BuiltinNames::new(&files.atoms);
        let platform = host_platform();
        let mut builtins = Vec::new();
        builtins.resize_with(files.modules.len(), || None);
        for &file in files.compiled_files() {
            let (hir, bound) = (files.hir(file), files.bound(file));
            if hir.ran_out_of_stack || bound.ran_out_of_stack {
                continue;
            }
            let analysis = files.analysis(file);
            let sites = analysis.import_sites.iter();
            let mut targets: Vec<_> = sites.map(|site| (site.kind, None)).collect();
            targets.sort_unstable_by_key(|target| target.0);
            builtins[file.idx()] = Some(resolve_file(&ResolveInput {
                hir,
                bound,
                decisions: &analysis.decisions,
                atoms: &files.atoms,
                module_format: analysis.module_format,
                targets: &ImportTargets::new(&targets),
                names: &builtin_names,
                platform,
                dialect: SourceDialect::Program,
                replaced: &[],
                runs_tests: false,
                holds_language: true,
                is_text_asked: false,
            }));
        }
        UnlinkedFiles {
            files,
            builtin_names,
            platform,
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
        let builtins = self.builtins[file.idx()].as_ref()?;
        builtins.builtin_of_expression(expr)
    }

    fn builtin_member(&self, holder: BuiltinId, name: Atom) -> Option<BuiltinId> {
        match table::member(holder, self.builtin_names.get(name)?) {
            MemberLookup::Found(member) if table::exists_on(member, self.platform) => {
                Some(table::canonical_id(member))
            }
            MemberLookup::Found(_) | MemberLookup::Unknown | MemberLookup::Absent => None,
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

    fn find_target_of_copied_properties(&self, builtin: BuiltinId) -> Option<u32> {
        match prototype_operation_of(builtin)? {
            PrototypeOperation::CopyProperties { target } => Some(target),
            _ => None,
        }
    }
}

impl NamedValues for UnlinkedFiles<'_, '_> {
    fn find_named_value(&self, file: FileId, expression: ExprId) -> Option<NamedValue> {
        named_value_of(static_referent(self, file, expression).referent)
    }
}
