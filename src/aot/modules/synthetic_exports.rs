use super::bindings::{SyntheticExport, SyntheticExportId};
use super::commonjs_exports::{CommonJsTexts, collect_seen_namespaces};
use super::exports::{ExportTables, Resolution};
use super::imports::{FileImports, NamedMember, PendingBinding};
use super::interop::ModuleKind;
use super::module_set::ModuleSet;
use super::{BindInput, ModuleRef, compare_code_units, compare_modules};
use crate::builtins::{BuiltinNames, ModuleExport, Platforms, RuntimeModule, find_module_export};
use crate::load::{SourceKind, Sources};
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

#[derive(Copy, Clone)]
pub(super) struct ReplacedNames<'a> {
    pub names: &'a [SyntheticExportKey],
    pub modules: &'a FxHashSet<ModuleRef>,
    pub is_every_module: bool,
}

pub(super) fn number_synthetic_exports(
    input: &BindInput<'_, '_>,
    modules: &ModuleSet,
    tables: &ExportTables,
    imports: &[FileImports],
    commonjs: &CommonJsTexts,
    replaced: ReplacedNames<'_>,
) -> SyntheticExports {
    let mut found = collect_synthetic_export_keys(modules, tables, imports, commonjs);
    for &key in replaced.names {
        found.add(key, false);
    }
    found.add_names_behind(modules, tables, commonjs);
    let SyntheticExportKeys {
        mut keys, required, ..
    } = found;
    let replaced_names: FxHashSet<SyntheticExportKey> = replaced.names.iter().copied().collect();
    let atoms = &input.files.atoms;
    keys.shared_sort_unstable_by(|a, b| {
        let compare_names = || compare_code_units(atoms.bytes(a.1), atoms.bytes(b.1));
        compare_modules(a.0, b.0, atoms).then_with(compare_names)
    });
    let known_members = KnownMembers::new(input);
    let create_export = |&(module, name): &SyntheticExportKey| {
        debug_assert!(
            !modules.is_uncompiled_code(module),
            "a binding of uncompiled code is live and is never captured"
        );
        let can_be_absent = !required.contains(&(module, name));
        SyntheticExport {
            module,
            name,
            is_known_member: can_be_absent || known_members.has(modules, module, name),
            is_replaceable: replaced_names.contains(&(module, name))
                || (replaced.is_every_module
                    && module != ModuleRef::Runtime(RuntimeModule::BunTest))
                || replaced.modules.contains(&module),
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

    fn add_resolution(&mut self, resolution: Resolution) {
        if let Resolution::Synthetic { module, name } = resolution {
            self.add((module, name), false);
        }
    }

    /// The names that the names listed are copies of, and those that literals spread under them.
    fn add_names_behind(
        &mut self,
        modules: &ModuleSet,
        tables: &ExportTables,
        commonjs: &CommonJsTexts,
    ) {
        let mut position = 0;
        while let Some(&(module, name)) = self.keys.get(position) {
            position += 1;
            if tables.commonjs.is_copied(module, name) {
                self.add_resolution(tables.resolve_required(modules, module, name).resolution);
            }
            for source in commonjs.sources_of_spread_name(module, name) {
                self.add_resolution(tables.resolve_required(modules, source, name).resolution);
            }
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
        let symbols = file_imports.bindings.iter().map(|it| (it.1, true));
        let members = file_imports.members.iter().map(|it| (it.1, false));
        let jsx = file_imports.jsx.iter().map(|it| (it.binding, true));
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
    for named in tables.statements_ahead_of_stars() {
        if let Resolution::Synthetic { module, name } = named {
            keys.add((module, name), true);
        }
    }
    for (module, name) in commonjs.names_read_by_own_text() {
        keys.add_resolution(tables.resolve_required(modules, module, name).resolution);
    }
    for file in collect_seen_namespaces(modules, tables, imports) {
        let module = ModuleRef::File(file);
        let names = tables.commonjs.names_of(module);
        for name in names.into_iter().flatten() {
            keys.add_resolution(tables.resolve_in(modules, module, name).resolution);
        }
    }
    keys
}

#[derive(Copy, Clone)]
pub(super) struct KnownMembers<'a> {
    sources: &'a Sources,
    builtin_names: &'a BuiltinNames,
    platform: Platforms,
}

impl<'a> KnownMembers<'a> {
    pub(super) fn new(input: &BindInput<'a, '_>) -> KnownMembers<'a> {
        KnownMembers {
            sources: input.sources,
            builtin_names: input.builtin_names,
            platform: input.platform,
        }
    }

    pub(super) fn has(self, modules: &ModuleSet, module: ModuleRef, name: Atom) -> bool {
        let runtime_module = match module {
            ModuleRef::Runtime(runtime_module) => runtime_module,
            ModuleRef::File(file) if modules.interop(module).kind == ModuleKind::RuntimeSource => {
                match self.sources.kind(file) {
                    SourceKind::RuntimeModule(runtime_module) => runtime_module,
                    _ => return false,
                }
            }
            _ => return false,
        };
        !matches!(
            find_module_export(self.builtin_names, runtime_module, name, self.platform),
            ModuleExport::Absent | ModuleExport::Unknown | ModuleExport::PropertyOfNamespace(_)
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::modules::commonjs_exports::{CommonJsInput, scan_commonjs_modules};
    use crate::modules::exports::{collect_export_entries, resolve_exports};
    use crate::modules::imports::find_mocked_modules;
    use crate::modules::module_set::collect_modules;
    use crate::modules::order::compute_order;
    use crate::modules::requests::scan_files;
    use crate::modules::testing::{file_named, with_graph, with_runtime_graph};
    use crate::modules::{ExportBinding, ImportBinding, ModuleGraph};
    use bun_sema::bind::{Decl, SymbolId};
    use bun_sema::hir::ImportId;
    use bun_sema::program::FileId;

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

    fn replaceable_names<'a>(
        input: &BindInput<'a, '_>,
        asked_for: &[SyntheticExportKey],
        replaced: ReplacedNames<'_>,
    ) -> Vec<&'a str> {
        let scans = scan_files(input);
        let modules = collect_modules(input, &scans);
        let (order, _) = compute_order(input, &scans, &modules);
        let commonjs_input = CommonJsInput {
            bind: input,
            scans: &scans,
            modules: &modules,
            half: &|module: ModuleRef| order.half(module),
            half_at_link: &|module: ModuleRef| order.half_at_link(module),
            is_prefix_root: &|file: FileId| order.is_prefix_root(file),
        };
        let texts = scan_commonjs_modules(&commonjs_input);
        let entries = collect_export_entries(input, &scans, &modules);
        let mocked = find_mocked_modules(input, &scans, &modules);
        let tables = resolve_exports(input, &scans, &modules, entries, &texts, &mocked);
        let bindings = asked_for
            .iter()
            .map(|&(module, name)| PendingBinding::Synthetic { module, name });
        let imports = [FileImports {
            bindings: (0..).map(SymbolId).zip(bindings).collect(),
            ..FileImports::default()
        }];
        let numbered =
            number_synthetic_exports(input, &modules, &tables, &imports, &texts, replaced);
        let replaceable = numbered.list.iter().filter(|export| export.is_replaceable);
        replaceable.map(|export| name_of(input, export)).collect()
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
    fn seen_namespaces_ask_for_ids_of_all_names() {
        let ways_to_see_the_namespace = [
            "import * as ns from './c.cjs'; console.log(ns);",
            "await import('./c.cjs');",
            "export * from './c.cjs';",
            "export * as ns from './c.cjs';",
            "import * as ns from './c.cjs'; export { ns };",
        ];
        for main in ways_to_see_the_namespace {
            let files = [
                ("main.js", main),
                ("c.cjs", "exports.a = 1; exports.b = 2;"),
            ];
            with_graph(&files, |graph, input| {
                let exports = graph.synthetic_exports().iter();
                let names: Vec<&str> = exports.map(|export| name_of(input, export)).collect();
                assert_eq!(names, ["a", "b", "default"], "{main}");
            });
        }
    }

    #[test]
    fn names_that_the_test_runner_may_store_are_replaceable() {
        with_graph(&[("main.js", "export {};")], |_, input| {
            let atom = |text: &str| input.files.atoms.intern(text.as_bytes());
            let path = ModuleRef::Runtime(RuntimeModule::NodePath);
            let test_runner = ModuleRef::Runtime(RuntimeModule::BunTest);
            let asked_for = [
                (path, atom("join")),
                (path, atom("sep")),
                (test_runner, atom("test")),
            ];
            let replaceable =
                |replaced: ReplacedNames<'_>| replaceable_names(input, &asked_for, replaced);
            let no_modules = FxHashSet::default();
            let nothing = ReplacedNames {
                names: &[],
                modules: &no_modules,
                is_every_module: false,
            };
            assert_eq!(replaceable(nothing), [""; 0]);
            let names = [(path, atom("sep")), (path, atom("resolve"))];
            let single_names = ReplacedNames {
                names: &names,
                ..nothing
            };
            assert_eq!(replaceable(single_names), ["resolve", "sep"]);
            let modules: FxHashSet<ModuleRef> = [path].into_iter().collect();
            let one_module = ReplacedNames {
                modules: &modules,
                ..nothing
            };
            assert_eq!(replaceable(one_module), ["join", "sep"]);
            let every_module = ReplacedNames {
                is_every_module: true,
                ..nothing
            };
            assert_eq!(replaceable(every_module), ["join", "sep"]);
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
            let known_members = KnownMembers::new(input);
            assert!(known_members.has(&modules, source, atom("join")));
            assert!(!known_members.has(&modules, source, atom("nope")));
        });
    }

    #[test]
    fn name_handed_on_from_bun_is_known_where_the_table_lists_it() {
        let files = [("main.js", "export { nope, serve } from 'bun';")];
        with_graph(&files, |graph, input| {
            let exports = graph.synthetic_exports().iter();
            let unknown: Vec<&str> = exports
                .filter(|export| !export.is_known_member)
                .map(|export| name_of(input, export))
                .collect();
            assert_eq!(unknown, ["nope"]);
        });
    }
}
