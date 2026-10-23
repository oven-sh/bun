use super::bindings::{SyntheticExport, SyntheticExportId};
use super::code_unit_order::compare_code_units;
use super::commonjs_exports::{CommonJsTexts, collect_seen_namespaces};
use super::exports::{ExportTables, Resolution};
use super::imports::{FileImports, NamedMember, PendingBinding};
use super::interop::ModuleKind;
use super::module_set::ModuleSet;
use super::{BindInput, ModuleRef, compare_modules};
use crate::builtins::{ModuleExport, find_module_export};
use crate::load::SourceKind;
use bun_sema::atom::Atom;
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};

type SyntheticExportKey = (ModuleRef, Atom);

pub(super) struct SyntheticExports {
    list: Vec<SyntheticExport>,
    ids: FxHashMap<SyntheticExportKey, SyntheticExportId>,
}

impl SyntheticExports {
    pub(super) fn id_of(&self, module: ModuleRef, name: Atom) -> SyntheticExportId {
        let id = self.ids.get(&(module, name));
        *id.expect("a synthetic export without an id")
    }

    pub(super) fn iter(&self) -> impl Iterator<Item = (SyntheticExportId, &SyntheticExport)> {
        (0..).map(SyntheticExportId).zip(&self.list)
    }

    pub(super) fn into_list(self) -> Vec<SyntheticExport> {
        self.list
    }
}

pub(super) fn number_synthetic_exports(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
    commonjs: &CommonJsTexts,
) -> SyntheticExports {
    let SyntheticExportKeys {
        mut keys, required, ..
    } = collect_synthetic_export_keys(modules, tables, imports, commonjs);
    let atoms = &input.files.atoms;
    keys.shared_sort_unstable_by(|a, b| {
        let compare_names = || compare_code_units(atoms.bytes(a.1), atoms.bytes(b.1));
        compare_modules(a.0, b.0, atoms).then_with(compare_names)
    });
    let create_export = |&(module, name): &SyntheticExportKey| {
        debug_assert!(
            !modules.is_uncompiled_code(module),
            "a binding of uncompiled code is live and is never captured"
        );
        // `ns.x` is `undefined` where the module has no `x`. Only a name that is imported or exported must be there.
        let can_be_absent = !required.contains(&(module, name));
        SyntheticExport {
            module,
            name,
            is_known_member: can_be_absent || is_known_member(input, modules, module, name),
        }
    };
    let ids = (0..).map(SyntheticExportId);
    SyntheticExports {
        list: keys.iter().map(create_export).collect(),
        ids: keys.into_iter().zip(ids).collect(),
    }
}

#[derive(Default)]
struct SyntheticExportKeys {
    keys: Vec<SyntheticExportKey>,
    key_set: FxHashSet<SyntheticExportKey>,
    required: FxHashSet<SyntheticExportKey>,
}

impl SyntheticExportKeys {
    fn add(&mut self, key: SyntheticExportKey, is_required: bool) {
        if self.key_set.insert(key) {
            self.keys.push(key);
        }
        if is_required {
            self.required.insert(key);
        }
    }

    // A name of a CommonJS module, which may stand for a name of another one.
    fn add_name(
        &mut self,
        modules: &ModuleSet,
        tables: &ExportTables,
        module: ModuleRef,
        name: Atom,
    ) {
        if let Resolution::Synthetic { module, name } =
            tables.resolve_in(modules, module, name).resolution
        {
            self.add((module, name), false);
        }
    }
}

fn collect_synthetic_export_keys(
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
    commonjs: &CommonJsTexts,
) -> SyntheticExportKeys {
    let mut keys = SyntheticExportKeys::default();
    for file_imports in imports {
        let symbol_bindings = file_imports
            .bindings
            .iter()
            .map(|&(_, binding)| (binding, true));
        let member_bindings = file_imports
            .members
            .iter()
            .map(|&(_, binding)| (binding, false));
        let jsx_bindings = file_imports.jsx.iter().map(|&(_, binding)| (binding, true));
        // A key of `const { n } = require(K)` reads `undefined` where the module has no `n`.
        let named_bindings = file_imports
            .named_members
            .iter()
            .filter_map(|&(_, member)| match member {
                NamedMember::Binding(binding) => Some((binding, false)),
                NamedMember::Fixed(_) => None,
            });
        let bindings = symbol_bindings.chain(member_bindings).chain(jsx_bindings);
        let bindings = bindings.chain(named_bindings);
        for (binding, is_required) in bindings {
            match binding {
                PendingBinding::Synthetic { module, name }
                | PendingBinding::CapturedBuiltin { module, name, .. } => {
                    keys.add((module, name), is_required);
                }
                PendingBinding::Bound(_) => {}
            }
        }
    }
    for &file in &modules.record_files {
        for &(_, resolved) in tables.names(file) {
            match resolved.resolution {
                Resolution::Synthetic { module, name } => keys.add((module, name), true),
                Resolution::RuntimeMember { module, name } => {
                    keys.add((ModuleRef::Runtime(module), name), true);
                }
                Resolution::Variable(_)
                | Resolution::Namespace { .. }
                | Resolution::LiveName { .. }
                | Resolution::DynamicStar { .. }
                | Resolution::Unloadable { .. }
                | Resolution::NotFound
                | Resolution::Ambiguous => {}
            }
        }
    }
    // A name of a CommonJS module has a variable where somebody reads it. A store asks for none.
    for (module, name) in commonjs.names_read_by_own_text() {
        keys.add_name(modules, tables, module, name);
    }
    // A namespace object shows every name.
    for file in collect_seen_namespaces(modules, tables, imports) {
        let module = ModuleRef::File(file);
        for name in tables
            .names_of_commonjs_module(module)
            .into_iter()
            .flatten()
        {
            keys.add_name(modules, tables, module, name);
        }
    }
    keys
}

fn is_known_member(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    module: ModuleRef,
    name: Atom,
) -> bool {
    let runtime_module = match module {
        ModuleRef::Runtime(runtime_module) => runtime_module,
        ModuleRef::File(file) if modules.interop(module).kind == ModuleKind::RuntimeSource => {
            match input.sources.kind(file) {
                SourceKind::RuntimeModule(runtime_module) => runtime_module,
                _ => return false,
            }
        }
        _ => return false,
    };
    match find_module_export(input.builtin_names, runtime_module, name, input.platform) {
        ModuleExport::Absent | ModuleExport::Unknown => false,
        _ => true,
    }
}
