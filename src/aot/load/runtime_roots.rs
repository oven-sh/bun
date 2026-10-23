use bun_sema::program::{CodeAnswer, Files, HostModuleId};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashSet, SharedSort};

use crate::builtins::table::{MODULE_LOADER_FUNCTIONS, STARTUP_FUNCTIONS, STARTUP_MODULES};
use crate::builtins::{Platforms, RuntimeFunction, RuntimeModule, RuntimeUses};
use crate::load::runtime_modules::RuntimeModules;
use crate::load::sources::parsed_source;

pub(crate) struct RuntimeRoots {
    pub paths: Vec<Vec<u8>>,
    pub host_loaded_modules: Vec<RuntimeModule>,
    pub imports_cluster: bool,
    pub imports_uncompiled_code: bool,
}

/// What the application, the language and the start of the process ask of Bun's own code.
struct RootUses {
    imported_modules: Vec<RuntimeModule>,
    host_loaded_modules: Vec<RuntimeModule>,
    functions: Vec<RuntimeFunction>,
    imports_uncompiled_code: bool,
}

fn collect_root_uses(application: &Files<'_>, platform: Platforms) -> RootUses {
    let language_uses = RuntimeUses::of_language(platform);
    let mut host_loaded: FxHashSet<RuntimeModule> = language_uses.modules.iter().copied().collect();
    let mut functions: FxHashSet<RuntimeFunction> = STARTUP_FUNCTIONS
        .iter()
        .chain(MODULE_LOADER_FUNCTIONS)
        .chain(language_uses.functions.iter())
        .copied()
        .collect();
    let mut imports_uncompiled_code = false;
    let mut named: Vec<RuntimeModule> = Vec::new();
    for &file in application.compiled_files() {
        if let Some(compiled) = application.compiled(file) {
            host_loaded.extend(compiled.implied_answers.iter().filter_map(implied_module));
            imports_uncompiled_code |= compiled.code_answers.iter().any(is_uncompiled_code);
        }
        if let Some(source) = parsed_source(application, file) {
            functions.extend(source.builtins.called_functions());
            named.extend(source.named_modules().iter().map(|it| it.module));
        }
    }
    host_loaded.extend(named.iter().copied());
    host_loaded.extend(STARTUP_MODULES);
    let mut host_loaded_modules: Vec<RuntimeModule> = host_loaded.into_iter().collect();
    host_loaded_modules.shared_sort_unstable_by_key(|module| module.registry_id());
    let mut functions: Vec<RuntimeFunction> = functions.into_iter().collect();
    functions.shared_sort_unstable();
    let imported = application.host_modules().iter().copied();
    RootUses {
        imported_modules: imported.map(to_runtime_module).chain(named).collect(),
        host_loaded_modules,
        functions,
        imports_uncompiled_code,
    }
}

pub(crate) fn collect_runtime_roots(
    application: &Files<'_>,
    runtime_modules: &RuntimeModules,
    platform: Platforms,
) -> RuntimeRoots {
    let RootUses {
        imported_modules,
        host_loaded_modules,
        functions,
        imports_uncompiled_code,
    } = collect_root_uses(application, platform);
    let imports_cluster = imported_modules.contains(&RuntimeModule::NodeCluster);
    let modules = imported_modules
        .into_iter()
        .chain(host_loaded_modules.iter().copied())
        .collect();
    RuntimeRoots {
        paths: order_root_paths(runtime_modules, modules, functions),
        host_loaded_modules,
        imports_cluster,
        imports_uncompiled_code,
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
