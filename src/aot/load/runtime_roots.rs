use bun_sema::program::{CodeAnswer, Files, HostModuleId};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashSet, SharedSort};

use crate::builtins::table::{ModuleFlags, module_data, runtime_function};
use crate::builtins::{Platforms, RuntimeFunction, RuntimeModule, RuntimeUses};
use crate::load::contents::ProgramContents;
use crate::load::contents::load_names::find_library_modules_that_unknown_names_may_stand_for;
use crate::load::runtime_modules::RuntimeModules;
use crate::load::sources::parsed_source;

pub(crate) struct RuntimeRoots {
    pub paths: Vec<Vec<u8>>,
    pub host_loaded_modules: Vec<RuntimeModule>,
    pub modules_named_at_run_time: Vec<RuntimeModule>,
    pub imports_cluster: bool,
    pub imports_uncompiled_code: bool,
    /// A module of the host, code that the build does not see or a Worker is in the program, so the engine may enter functions of the host that no file names.
    pub keeps_code_without_names: bool,
}

fn exists_on(function: RuntimeFunction, platform: Platforms) -> bool {
    runtime_function(function).is_some_and(|data| data.platforms.contains(platform))
}

fn has_source(module: RuntimeModule) -> bool {
    module_data(module).flags.contains(ModuleFlags::HAS_SOURCE)
}

/// What a program holds of Bun's own code beside what its files name.
#[derive(Copy, Clone)]
pub(crate) struct FurtherLibraryCode {
    pub serves_unseen_code: bool,
}

pub(crate) fn collect_runtime_roots(
    application: &Files<'_>,
    contents: &ProgramContents,
    runtime_modules: &RuntimeModules,
    platform: Platforms,
    further: FurtherLibraryCode,
) -> RuntimeRoots {
    let mut host_loaded: FxHashSet<RuntimeModule> = FxHashSet::default();
    let mut functions: FxHashSet<RuntimeFunction> = FxHashSet::default();
    let mut imports_uncompiled_code = false;
    let mut asks_module_of_host = false;
    let mut named: Vec<RuntimeModule> = Vec::new();
    for &file in application.compiled_files() {
        if let Some(compiled) = application.compiled(file) {
            host_loaded.extend(compiled.implied_answers.iter().filter_map(implied_module));
            imports_uncompiled_code |= compiled.code_answers.iter().any(is_uncompiled_code);
            let mut imported = compiled.code_answers.iter().filter_map(implied_module);
            asks_module_of_host |= imported.any(has_source);
        }
        if let Some(source) = parsed_source(application, file) {
            functions.extend(source.builtins.called_functions());
            named.extend(source.named_modules().iter().map(|it| it.module));
            asks_module_of_host |= source.builtins.uses().has_module_of_host();
        }
    }
    named.extend(find_library_modules_that_unknown_names_may_stand_for(
        application,
    ));
    named.shared_sort_unstable_by_key(|module| module.registry_id());
    named.dedup();
    asks_module_of_host |= named.iter().copied().any(has_source);
    host_loaded.extend(named.iter().copied());
    // A function that comes along tells by its bindings what it runs, as the program does. A module evaluates too much for that, and what a Worker sends may be anything.
    let keeps_code_without_names = further.serves_unseen_code
        || imports_uncompiled_code
        || asks_module_of_host
        || contents.names_worker_constructor
        || contents.loads_by_unknown_name
        || contents.loads_by_unknown_path;
    let without_names = RuntimeUses::of_every_program(platform);
    host_loaded.extend(&without_names.modules);
    functions.extend(&without_names.functions);
    functions.retain(|&function| exists_on(function, platform));
    let mut host_loaded_modules: Vec<RuntimeModule> = host_loaded.into_iter().collect();
    host_loaded_modules.shared_sort_unstable_by_key(|module| module.registry_id());
    let imported = application.host_modules().iter().copied();
    let mut modules: Vec<RuntimeModule> = imported.map(to_runtime_module).collect();
    modules.extend(&named);
    let imports_cluster = modules.contains(&RuntimeModule::NodeCluster);
    modules.extend(&host_loaded_modules);
    let functions: Vec<RuntimeFunction> = functions.into_iter().collect();
    RuntimeRoots {
        paths: order_root_paths(runtime_modules, modules, functions),
        host_loaded_modules,
        modules_named_at_run_time: named,
        imports_cluster,
        imports_uncompiled_code,
        keeps_code_without_names,
    }
}

fn order_root_paths(
    runtime_modules: &RuntimeModules,
    mut modules: Vec<RuntimeModule>,
    functions: Vec<RuntimeFunction>,
) -> Vec<Vec<u8>> {
    modules.shared_sort_unstable_by_key(|module| module.registry_id());
    modules.dedup();
    let module_paths = modules
        .iter()
        .filter_map(|&module| Some(runtime_modules.module_path(module)?.to_vec()));
    let mut function_files: Vec<Vec<u8>> = functions
        .into_iter()
        .filter_map(|function| runtime_modules.function_file_path(function))
        .collect();
    function_files.shared_sort_unstable();
    function_files.dedup();

    let mut roots = Vec::from(runtime_modules.declaration_paths());
    roots.extend(runtime_modules.prelude_paths());
    roots.extend(module_paths);
    roots.extend(function_files);
    roots.extend(runtime_modules.function_files_without_ids());
    let mut listed = FxHashSet::default();
    roots.retain(|path| listed.insert(path.clone()));
    roots
}

fn is_uncompiled_code(answer: &CodeAnswer<'_>) -> bool {
    matches!(
        *answer,
        CodeAnswer::External {
            kind: ExternalKind::UncompiledCode,
            ..
        }
    )
}

fn implied_module(answer: &CodeAnswer<'_>) -> Option<RuntimeModule> {
    match *answer {
        CodeAnswer::HostModule(id) => Some(to_runtime_module(id)),
        _ => None,
    }
}

fn to_runtime_module(id: HostModuleId) -> RuntimeModule {
    RuntimeModule::from_registry_id(id.0)
        .expect("the archive and the built-ins table must come from the same build")
}

#[cfg(test)]
mod tests {
    use bstr::BStr;
    use bun_builtin_sources::Archive;

    use super::*;
    use crate::builtins::table::{MODULE_LOADER_FUNCTIONS, STARTUP_FUNCTIONS, STARTUP_MODULES};
    use crate::compile::testing::{default_settings, with_loaded_build};
    use crate::load::runtime_modules::RuntimeFileKind;
    use crate::load::{ProjectId, host_platform};
    use crate::prelude;

    fn runtime_modules() -> RuntimeModules {
        RuntimeModules::new(Archive::embedded(), false)
    }

    fn collect_roots_of(source: &str, runtime_modules: &RuntimeModules) -> RuntimeRoots {
        let files = [("main.ts", source)];
        with_loaded_build(&files, &default_settings(), |_, loaded| {
            let further = FurtherLibraryCode {
                serves_unseen_code: false,
            };
            collect_runtime_roots(
                loaded.project(ProjectId::Application).loaded.files(),
                loaded.contents,
                runtime_modules,
                host_platform(),
                further,
            )
        })
    }

    fn has_module_root(
        runtime_modules: &RuntimeModules,
        roots: &RuntimeRoots,
        module: RuntimeModule,
    ) -> bool {
        let path = runtime_modules.module_path(module).unwrap();
        roots.paths.iter().any(|root| root == path)
    }

    fn assert_holds_startup_code(runtime: &RuntimeModules, roots: &RuntimeRoots) {
        for &module in STARTUP_MODULES {
            assert!(roots.host_loaded_modules.contains(&module), "{module:?}");
            if runtime.module_path(module).is_some() {
                assert!(has_module_root(runtime, roots, module), "{module:?}");
            }
        }
        let here = host_platform();
        for &function in STARTUP_FUNCTIONS.iter().chain(MODULE_LOADER_FUNCTIONS) {
            let path = runtime.function_file_path(function).unwrap();
            assert!(
                !exists_on(function, here) || roots.paths.contains(&path),
                "{function:?}"
            );
        }
    }

    #[test]
    fn program_that_names_nothing_of_bun_holds_what_every_program_holds() {
        let runtime = runtime_modules();
        let roots = collect_roots_of("export {};", &runtime);
        assert!(!roots.keeps_code_without_names);
        let held = RuntimeUses::of_every_program(host_platform());
        assert_eq!(roots.host_loaded_modules.len(), held.modules.len());
        assert!(!held.functions.is_empty());
        for &function in &held.functions {
            let path = runtime.function_file_path(function);
            assert!(
                path.is_none_or(|path| roots.paths.contains(&path)),
                "{function:?}"
            );
        }
        assert_holds_startup_code(&runtime, &roots);
    }

    #[test]
    fn startup_modules_are_roots_of_a_program_that_names_code_of_the_host() {
        let runtime = runtime_modules();
        let roots = collect_roots_of("process.openStdin();", &runtime);
        assert!(roots.keeps_code_without_names);
        assert_holds_startup_code(&runtime, &roots);
        for path in runtime.function_files_without_ids() {
            assert!(roots.paths.contains(&path), "{}", BStr::new(&path));
        }
        let host_loaded = &roots.host_loaded_modules;
        assert!(host_loaded.is_sorted_by(|a, b| a.registry_id() < b.registry_id()));
    }

    #[test]
    fn worker_or_load_by_unknown_name_keeps_code_without_names() {
        let runtime = runtime_modules();
        let keeps = |source: &str| collect_roots_of(source, &runtime).keeps_code_without_names;
        assert!(!keeps("export const same = (at: string) => at;"));
        assert!(keeps("export const load = (at: string) => import(at);"));
        assert!(keeps(
            "export const load = (name: string) => process.getBuiltinModule(name);"
        ));
        assert!(keeps("export const worker = new Worker('./main.ts');"));
    }

    #[test]
    fn imported_module_is_a_root_but_not_host_loaded() {
        let runtime = runtime_modules();
        let roots = collect_roots_of("import 'node:os';", &runtime);
        assert!(has_module_root(&runtime, &roots, RuntimeModule::NodeOs));
        assert!(!roots.host_loaded_modules.contains(&RuntimeModule::NodeOs));
    }

    #[test]
    fn import_that_no_option_lists_brings_uncompiled_code() {
        let runtime = runtime_modules();
        let imports_uncompiled_code =
            |source: &str| collect_roots_of(source, &runtime).imports_uncompiled_code;
        assert!(imports_uncompiled_code(
            "import 'https://example.com/a.js';"
        ));
        assert!(imports_uncompiled_code(
            "export const a = import('data:text/javascript,1');"
        ));
        assert!(!imports_uncompiled_code("import 'node:os';"));
        assert!(!imports_uncompiled_code(
            "export const url = 'https://example.com/a.js';"
        ));
    }

    #[test]
    fn implied_module_is_host_loaded_and_roots_are_unique_and_readable() {
        let runtime = runtime_modules();
        let roots = collect_roots_of("process.openStdin();", &runtime);
        assert!(has_module_root(&runtime, &roots, RuntimeModule::NodeTty));
        assert!(roots.host_loaded_modules.contains(&RuntimeModule::NodeTty));
        assert!(roots.modules_named_at_run_time.is_empty());
        for (index, path) in roots.paths.iter().enumerate() {
            let name = BStr::new(path);
            assert!(runtime.file_kind(path).is_some(), "{name}");
            let text = runtime.read(path);
            assert!(text.is_some_and(|text| !text.is_empty()), "{name}");
            let earlier = &roots.paths[..index];
            assert!(!earlier.contains(path), "{name} is listed twice");
        }

        let roots = collect_roots_of("export const text = 'process.openStdin';", &runtime);
        assert!(!has_module_root(&runtime, &roots, RuntimeModule::NodeTty));
        assert!(!roots.host_loaded_modules.contains(&RuntimeModule::NodeTty));
    }

    #[test]
    fn only_a_module_whose_name_the_program_writes_is_named_at_run_time() {
        let runtime = runtime_modules();
        let loads = "process.openStdin(typeof require(process.argv[2]));";
        let roots = collect_roots_of(loads, &runtime);
        assert!(roots.host_loaded_modules.contains(&RuntimeModule::NodeTty));
        assert!(roots.modules_named_at_run_time.is_empty());

        let names = format!("export const names = ['node:os', 'zlib', 'os'];\n{loads}");
        let roots = collect_roots_of(&names, &runtime);
        let mut expected = [RuntimeModule::NodeOs, RuntimeModule::NodeZlib];
        expected.sort_unstable_by_key(|module| module.registry_id());
        assert_eq!(roots.modules_named_at_run_time, expected);
        for module in expected {
            assert!(has_module_root(&runtime, &roots, module), "{module:?}");
            assert!(roots.host_loaded_modules.contains(&module), "{module:?}");
        }
    }

    #[test]
    fn roots_start_with_declarations_then_prelude_files() {
        let runtime = runtime_modules();
        let roots = order_root_paths(&runtime, vec![RuntimeModule::NodeFs], Vec::new());
        let (declarations, others) = roots.split_at(2);
        assert_eq!(declarations, runtime.declaration_paths());
        for path in declarations {
            assert_eq!(runtime.file_kind(path), Some(RuntimeFileKind::Declarations));
        }
        let (prelude_files, others) = others.split_at(prelude::FILES.len());
        for (path, (_, text)) in prelude_files.iter().zip(prelude::FILES) {
            assert_eq!(runtime.file_kind(path), Some(RuntimeFileKind::Functions));
            assert_eq!(runtime.read(path).unwrap(), text.as_bytes());
        }
        assert_eq!(
            others[0],
            runtime.module_path(RuntimeModule::NodeFs).unwrap()
        );
    }

    #[test]
    fn omitted_builtin_modules_leave_the_prelude() {
        let runtime = RuntimeModules::new(Archive::embedded(), true);
        let modules = vec![RuntimeModule::NodeFs];
        let roots = order_root_paths(&runtime, modules, STARTUP_FUNCTIONS.to_vec());
        let declarations = runtime.declaration_paths().into_iter();
        let expected: Vec<Vec<u8>> = declarations.chain(runtime.prelude_paths()).collect();
        assert_eq!(roots, expected);
    }

    #[test]
    fn order_does_not_depend_on_input_order() {
        let runtime = runtime_modules();
        let modules = vec![
            RuntimeModule::NodeTty,
            RuntimeModule::BunJsc,
            RuntimeModule::NodeFs,
            RuntimeModule::NodeTty,
        ];
        let functions: Vec<RuntimeFunction> = STARTUP_FUNCTIONS
            .iter()
            .chain(MODULE_LOADER_FUNCTIONS)
            .copied()
            .collect();
        let reversed_modules = modules.iter().rev().copied().collect();
        let reversed_functions = functions.iter().rev().copied().collect();
        let roots = order_root_paths(&runtime, modules, functions);
        let reversed_roots = order_root_paths(&runtime, reversed_modules, reversed_functions);
        assert_eq!(roots, reversed_roots);

        let mut modules_with_source = [RuntimeModule::NodeTty, RuntimeModule::NodeFs];
        modules_with_source.sort_unstable_by_key(|module| module.registry_id());
        let module_paths = modules_with_source.map(|module| runtime.module_path(module).unwrap());
        let first_module = 2 + prelude::FILES.len();
        assert_eq!(roots[first_module..][..module_paths.len()], module_paths);
    }
}
