use super::bindings::{SyntheticExport, SyntheticExportId};
use super::commonjs_exports::{CommonJsTexts, collect_seen_namespaces};
use super::exports::{ExportTables, Resolution};
use super::imports::{FileImports, NamedMember, PendingBinding};
use super::interop::ModuleKind;
use super::module_set::ModuleSet;
use super::{BindInput, ModuleRef, compare_code_units, compare_modules};
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
    } = collect_synthetic_export_keys(input, modules, tables, imports, commonjs);
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
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
    commonjs: &CommonJsTexts,
) -> SyntheticExportKeys {
    let mut keys = SyntheticExportKeys::default();
    for file_imports in imports {
        let symbols = file_imports.bindings.iter().map(|it| (it.1, true));
        let members = file_imports.members.iter().map(|it| (it.1, false));
        let jsx = file_imports.jsx.iter().map(|it| (it.1, true));
        // A key of `const { n } = require(K)` reads `undefined` where the module has no `n`.
        let named = file_imports.named_members.iter();
        let named = named.filter_map(|it| match it.1 {
            NamedMember::Binding(binding) => Some((binding, false)),
            NamedMember::Fixed(_) => None,
        });
        for (binding, is_required) in symbols.chain(members).chain(jsx).chain(named) {
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
        let names = tables.commonjs.names_of(module);
        for name in names.into_iter().flatten() {
            keys.add_name(modules, tables, module, name);
        }
    }
    if let Some(application) = input.application {
        for export in application.graph.synthetic_exports() {
            if let ModuleRef::File(_) | ModuleRef::Inner { .. } = export.module
                && let Some(module) = application.local_module(export.module)
            {
                keys.add((module, export.name), false);
            }
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
    !matches!(
        find_module_export(input.builtin_names, runtime_module, name, input.platform),
        ModuleExport::Absent | ModuleExport::Unknown
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::module_set::collect_modules;
    use crate::modules::requests::scan_files;
    use crate::modules::testing::{file_named, with_graph, with_runtime_graph};
    use crate::modules::{ExportBinding, ImportBinding, ModuleGraph};
    use bun_sema::bind::Decl;
    use bun_sema::hir::ImportId;

    fn name_of<'a>(input: &BindInput<'a, '_>, export: &SyntheticExport) -> &'a str {
        let name = core::str::from_utf8(input.files.atoms.bytes(export.name));
        name.expect("the programs of these tests export ASCII names")
    }

    fn first_named_import(
        graph: &ModuleGraph,
        input: &BindInput<'_, '_>,
        importer: &str,
    ) -> ImportBinding {
        let file = file_named(input, importer);
        let mut specifiers = input.files.hir(file)[ImportId(0)].named.iter();
        let specifier = specifiers
            .next()
            .expect("the first import has no named specifier");
        let bound = input.files.bound(file);
        graph.import_binding(file, bound.declared_symbol(Decl::ImportSpec(specifier)))
    }

    fn only_export(
        graph: &ModuleGraph,
        input: &BindInput<'_, '_>,
        exporter: &str,
    ) -> ExportBinding {
        let [export] = graph.exports(file_named(input, exporter)) else {
            panic!("{exporter} does not have exactly one export");
        };
        export.binding
    }

    #[test]
    fn ids_follow_module_and_name_order() {
        let main = "import { b, a, Z } from './c.cjs'; import './reexport.js';";
        let files = [
            ("main.js", main),
            ("reexport.js", "export { Buffer } from 'node:buffer';"),
            ("c.cjs", "module.exports = { a: 1, b: 2, Z: 3 };"),
        ];
        with_graph(&files, |graph, input| {
            let exports = graph.synthetic_exports();
            let names: Vec<&str> = exports
                .iter()
                .map(|export| name_of(input, export))
                .collect();
            assert_eq!(names, ["Z", "a", "b", "Buffer"]);
            let commonjs_module = ModuleRef::File(file_named(input, "c.cjs"));
            assert!(
                exports[..3]
                    .iter()
                    .all(|export| export.module == commonjs_module)
            );
            assert!(matches!(exports[3].module, ModuleRef::Runtime(_)));
            let last_id = ExportBinding::Synthetic(SyntheticExportId(3));
            assert_eq!(only_export(graph, input, "reexport.js"), last_id);
        });
    }

    #[test]
    fn one_id_per_module_and_name() {
        let main = "
            import { x } from './c.cjs';
            import { x as other } from './other.cjs';
            import './second.js';
            import './barrel.js';
        ";
        let files = [
            ("main.js", main),
            ("second.js", "import { x } from './c.cjs';"),
            ("barrel.js", "export { x } from './c.cjs';"),
            ("c.cjs", "exports.x = 1;"),
            ("other.cjs", "exports.x = 2;"),
        ];
        with_graph(&files, |graph, input| {
            let ImportBinding::Synthetic(id) = first_named_import(graph, input, "main.js") else {
                panic!("a name of a CommonJS module is a synthetic export");
            };
            let second = first_named_import(graph, input, "second.js");
            assert_eq!(second, ImportBinding::Synthetic(id));
            assert_eq!(
                only_export(graph, input, "barrel.js"),
                ExportBinding::Synthetic(id)
            );
            let commonjs_module = ModuleRef::File(file_named(input, "c.cjs"));
            assert_eq!(graph.synthetic_export(id).module, commonjs_module);
            assert_eq!(graph.synthetic_exports().len(), 2);
        });
    }

    #[test]
    fn member_paths_ask_for_ids() {
        let main = "import * as ns from './c.cjs'; export const x = ns.x;";
        let files = [("main.js", main), ("c.cjs", "exports.x = 1;")];
        with_graph(&files, |graph, input| {
            let [export] = graph.synthetic_exports() else {
                panic!("ns.x asks for exactly one synthetic export");
            };
            assert_eq!(export.module, ModuleRef::File(file_named(input, "c.cjs")));
            assert_eq!(name_of(input, export), "x");
        });
    }

    #[test]
    fn known_member_of_bun_module() {
        let main = "
            import { x } from './c.cjs';
            export { Buffer, nope } from 'node:buffer';
            import 'node:path';
        ";
        let files = [("main.js", main), ("c.cjs", "exports.x = 1;")];
        with_graph(&files, |graph, input| {
            let exports = graph.synthetic_exports().iter();
            let known_members: Vec<(&str, bool)> = exports
                .map(|export| (name_of(input, export), export.is_known_member))
                .collect();
            assert_eq!(
                known_members,
                [("x", false), ("Buffer", true), ("nope", false)]
            );
        });
        with_runtime_graph(&files, |_, input| {
            let modules = collect_modules(input, &scan_files(input));
            let source = ModuleRef::File(file_named(input, "/$bun/js/node/path.ts"));
            let atom = |text: &str| input.files.atoms.intern(text.as_bytes());
            assert!(is_known_member(input, &modules, source, atom("join")));
            assert!(!is_known_member(input, &modules, source, atom("nope")));
        });
    }
}
