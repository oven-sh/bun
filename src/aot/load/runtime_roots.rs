use bun_ast::Loader;
use bun_options_types::aot_options::AotOptions;
use bun_removable_features::Feature;
use bun_sema::program::{CodeAnswer, Files, HostModuleId};
use bun_sema::resolve::ExternalKind;
use bun_sema::util::{FxHashSet, SharedSort};

use crate::builtins::runtime_uses::Mentions;
use crate::builtins::table::{ModuleFlags, module_by_specifier, module_data, runtime_function};
use crate::builtins::{
    AsksOfText, BuiltinId, Platforms, RuntimeFunction, RuntimeModule, RuntimeUses,
};
use crate::load::contents::ProgramContents;
use crate::load::contents::load_names::find_library_modules_that_unknown_names_may_stand_for;
use crate::load::loaders::{HostLoaderKind, host_loader_kind};
use crate::load::runtime_modules::RuntimeModules;
use crate::load::sources::parsed_source;
use crate::module_keys::loader_by_name;

pub(crate) struct RuntimeRoots {
    pub paths: Vec<Vec<u8>>,
    pub host_loaded_modules: Vec<RuntimeModule>,
    pub modules_named_at_run_time: Vec<RuntimeModule>,
    pub imports_cluster: bool,
    pub imports_uncompiled_code: bool,
    pub asks: RuntimeUses,
    pub holds_what_unseen_code_finds: bool,
    pub keeps_code_without_names: bool,
}

fn exists_on(function: RuntimeFunction, platform: Platforms) -> bool {
    runtime_function(function).is_some_and(|data| data.platforms.contains(platform))
}

fn has_source(module: RuntimeModule) -> bool {
    module_data(module).flags.contains(ModuleFlags::HAS_SOURCE)
}

pub(crate) fn builtins_used_at_start(options: &AotOptions) -> Vec<BuiltinId> {
    let read_for = |feature: &Feature| match feature {
        Feature::Sql => Some(BuiltinId::Bun_sql),
        _ => None,
    };
    let features = options.features_of_embedded_options.iter();
    features.filter_map(read_for).collect()
}

pub(crate) fn uses_of_what_start_reads(
    used_at_start: &[BuiltinId],
    platform: Platforms,
) -> RuntimeUses {
    let handed_to_the_start = Mentions {
        mentioned: used_at_start,
        exposed: used_at_start,
        is_of_program: true,
        ..Mentions::default()
    };
    RuntimeUses::of_mentions(&handed_to_the_start, platform)
}

#[derive(Copy, Clone)]
pub(crate) struct FurtherLibraryCode<'a> {
    pub used_at_start: &'a [BuiltinId],
    pub serves_unseen_code: bool,
    pub loads_code_from_disk: bool,
    pub runs_tests: bool,
    pub has_file_that_asks_for_it: bool,
}

pub(crate) fn collect_runtime_roots(
    application: &Files<'_>,
    contents: &ProgramContents,
    runtime_modules: &RuntimeModules,
    platform: Platforms,
    further: FurtherLibraryCode<'_>,
) -> RuntimeRoots {
    let used_at_start = uses_of_what_start_reads(further.used_at_start, platform);
    let mut host_loaded: FxHashSet<RuntimeModule> = used_at_start.modules.iter().copied().collect();
    let mut functions: FxHashSet<RuntimeFunction> =
        used_at_start.functions.iter().copied().collect();
    let mut imports_uncompiled_code = false;
    let mut asks_module_of_host = used_at_start.has_module_of_host();
    let mut named: Vec<RuntimeModule> = Vec::new();
    let mut lets_in_what_nobody_names =
        further.has_file_that_asks_for_it || used_at_start.lets_in_what_nobody_names;
    let mut asks_of_texts = AsksOfText::default();
    for &file in application.compiled_files() {
        lets_in_what_nobody_names |=
            loader_by_name(application.module(file).file_name()) == Loader::Napi;
        if let Some(compiled) = application.compiled(file) {
            lets_in_what_nobody_names |=
                host_loader_kind(compiled.loader) == Some(HostLoaderKind::Loader(Loader::Napi));
            host_loaded.extend(compiled.implied_answers.iter().filter_map(implied_module));
            imports_uncompiled_code |= compiled.code_answers.iter().any(is_uncompiled_code);
            let mut imported = compiled.code_answers.iter().filter_map(implied_module);
            asks_module_of_host |= imported.any(has_source);
        }
        if let Some(source) = parsed_source(application, file) {
            functions.extend(source.builtins.called_functions());
            named.extend(source.named_modules().iter().map(|it| it.module));
            lets_in_what_nobody_names |= source.builtins.uses().lets_in_what_nobody_names
                || source.contents.names.may_go_to_loader_of_host;
            asks_module_of_host |= source.builtins.uses().has_module_of_host();
            asks_of_texts.add(&source.builtins.uses().asks);
        }
    }
    named.extend(find_library_modules_that_unknown_names_may_stand_for(
        application,
    ));
    named.shared_sort_unstable_by_key(|module| module.registry_id());
    named.dedup();
    asks_module_of_host |= named.iter().copied().any(has_source);
    host_loaded.extend(named.iter().copied());
    if further.serves_unseen_code
        || imports_uncompiled_code
        || (further.loads_code_from_disk && contents.loads_by_unknown_path)
    {
        host_loaded.extend(module_by_specifier(b"node:worker_threads"));
    }
    let is_held_whatever_texts_ask = further.serves_unseen_code
        || imports_uncompiled_code
        || asks_module_of_host
        || contents.names_worker_constructor
        || contents.loads_by_unknown_name
        || contents.loads_by_unknown_path
        || further.runs_tests
        || lets_in_what_nobody_names;
    let answered = match is_held_whatever_texts_ask {
        true => RuntimeUses::default(),
        false => RuntimeUses::of_asks(&asks_of_texts, platform),
    };
    functions.extend(&answered.functions);
    host_loaded.extend(&answered.modules);
    asks_module_of_host |= answered.has_module_of_host();
    let keeps_code_without_names = further.serves_unseen_code
        || imports_uncompiled_code
        || asks_module_of_host
        || contents.names_worker_constructor
        || contents.loads_by_unknown_name
        || contents.loads_by_unknown_path;
    let holds_what_unseen_code_finds =
        keeps_code_without_names || further.runs_tests || lets_in_what_nobody_names;
    let without_names = match holds_what_unseen_code_finds {
        true => RuntimeUses::of_unseen_code(platform),
        false => RuntimeUses::default(),
    };
    host_loaded.extend(&without_names.modules);
    functions.extend(&without_names.functions);
    let asks = match holds_what_unseen_code_finds {
        true => RuntimeUses::default(),
        false => collect_asks(application, &named, &host_loaded, &answered),
    };
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
        holds_what_unseen_code_finds,
        asks,
        keeps_code_without_names,
    }
}

fn collect_asks(
    application: &Files<'_>,
    named: &[RuntimeModule],
    host_loaded: &FxHashSet<RuntimeModule>,
    answered: &RuntimeUses,
) -> RuntimeUses {
    let mut asks = Asks::default();
    asks.add(answered);
    for &file in application.compiled_files() {
        if let Some(compiled) = application.compiled(file) {
            (asks.modules_read_whole)
                .extend(compiled.code_answers.iter().filter_map(implied_module));
        }
        if let Some(source) = parsed_source(application, file) {
            asks.add(source.builtins.uses());
        }
    }
    asks.modules_read_whole.extend(named);
    asks.modules.extend(host_loaded);
    asks.finish()
}

#[derive(Default)]
struct Asks {
    modules: Vec<RuntimeModule>,
    modules_read_whole: Vec<RuntimeModule>,
    exports_read: Vec<(RuntimeModule, &'static str)>,
    functions: Vec<RuntimeFunction>,
}

impl Asks {
    fn add(&mut self, uses: &RuntimeUses) {
        self.modules.extend(&uses.modules);
        self.modules_read_whole.extend(&uses.modules_read_whole);
        self.exports_read.extend(&uses.exports_read);
        self.functions.extend(&uses.functions);
    }

    fn finish(mut self) -> RuntimeUses {
        self.modules.extend(&self.modules_read_whole);
        for modules in [&mut self.modules, &mut self.modules_read_whole] {
            modules.shared_sort_unstable_by_key(|module| module.registry_id());
            modules.dedup();
        }
        (self.exports_read)
            .shared_sort_unstable_by_key(|&(module, name)| (module.registry_id(), name));
        self.exports_read.dedup();
        self.functions
            .shared_sort_unstable_by_key(|function| function.0);
        self.functions.dedup();
        RuntimeUses {
            modules: self.modules.into(),
            modules_read_whole: self.modules_read_whole.into(),
            exports_read: self.exports_read.into(),
            functions: self.functions.into(),
            lets_in_what_nobody_names: false,
            asks: AsksOfText::default(),
        }
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
    use crate::builtins::table::{
        MODULE_LOADER_FUNCTIONS, RuntimeFunctionRole, STARTUP_FUNCTIONS, STARTUP_MODULES,
        runtime_functions,
    };
    use crate::compile::testing::{default_settings, with_loaded_build};
    use crate::load::runtime_modules::RuntimeFileKind;
    use crate::load::{ProjectId, host_platform};

    fn runtime_modules() -> RuntimeModules {
        RuntimeModules::new(Archive::embedded(), false)
    }

    const NOTHING_FURTHER: FurtherLibraryCode<'static> = FurtherLibraryCode {
        used_at_start: &[],
        serves_unseen_code: false,
        loads_code_from_disk: false,
        runs_tests: false,
        has_file_that_asks_for_it: false,
    };

    fn collect_roots_of(source: &str, runtime_modules: &RuntimeModules) -> RuntimeRoots {
        collect_roots_beside(source, runtime_modules, NOTHING_FURTHER)
    }

    fn collect_roots_beside(
        source: &str,
        runtime_modules: &RuntimeModules,
        further: FurtherLibraryCode<'_>,
    ) -> RuntimeRoots {
        let files = [("main.ts", source)];
        with_loaded_build(&files, &default_settings(), |_, loaded| {
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
    fn program_that_hands_no_value_to_a_native_has_no_root_with_code() {
        let runtime = runtime_modules();
        let of_nothing = collect_roots_of("export {};", &runtime);
        assert!(!of_nothing.keeps_code_without_names);
        assert!(!of_nothing.holds_what_unseen_code_finds);
        assert!(of_nothing.host_loaded_modules.is_empty());
        assert_eq!(of_nothing.paths.len(), runtime.declaration_paths().len());
        let of_a_printed_line = collect_roots_of("console.log(1);", &runtime);
        assert_eq!(of_a_printed_line.paths, of_nothing.paths);
        let of_a_printed_value = collect_roots_of("console.log(f);", &runtime);
        assert!(!of_a_printed_value.holds_what_unseen_code_finds);
        assert!(of_a_printed_value.paths.len() > of_nothing.paths.len());
    }

    #[test]
    fn what_the_start_reads_for_an_embedded_option_is_held_as_where_the_program_hands_it_on() {
        let runtime = runtime_modules();
        let further = FurtherLibraryCode {
            used_at_start: &[BuiltinId::Bun_sql],
            ..NOTHING_FURTHER
        };
        let by_option = collect_roots_beside("console.log(1);", &runtime, further);
        let by_text = collect_roots_of("f(Bun.sql);", &runtime);
        assert!(by_option.holds_what_unseen_code_finds);
        for path in &by_text.paths {
            assert!(by_option.paths.contains(path));
        }
    }

    #[test]
    fn test_run_holds_what_unseen_code_finds() {
        let runtime = runtime_modules();
        let in_test_run = FurtherLibraryCode {
            runs_tests: true,
            ..NOTHING_FURTHER
        };
        let roots = collect_roots_beside("export {};", &runtime, in_test_run);
        assert!(!roots.keeps_code_without_names);
        let held = RuntimeUses::of_unseen_code(host_platform());
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
    fn host_loads_worker_threads_where_code_that_nobody_reads_may_start_a_worker() {
        let runtime = runtime_modules();
        let threads = module_by_specifier(b"node:worker_threads").unwrap();
        let is_loaded = |source: &str, further: FurtherLibraryCode<'_>| {
            let roots = collect_roots_beside(source, &runtime, further);
            let is_root = has_module_root(&runtime, &roots, threads);
            assert_eq!(roots.host_loaded_modules.contains(&threads), is_root);
            is_root
        };
        assert!(!is_loaded("export {};", NOTHING_FURTHER));
        assert!(is_loaded(
            "import 'https://example.com/a.js';",
            NOTHING_FURTHER
        ));
        let beside_unseen_code = FurtherLibraryCode {
            serves_unseen_code: true,
            ..NOTHING_FURTHER
        };
        assert!(is_loaded("export {};", beside_unseen_code));
        let beside_code_from_disk = FurtherLibraryCode {
            loads_code_from_disk: true,
            ..NOTHING_FURTHER
        };
        assert!(!is_loaded("export {};", beside_code_from_disk));
        let loads = "export const load = (at: string) => import(at);";
        assert!(!is_loaded(loads, NOTHING_FURTHER));
        assert!(is_loaded(loads, beside_code_from_disk));
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
    fn roots_start_with_declarations() {
        let runtime = runtime_modules();
        let roots = order_root_paths(&runtime, vec![RuntimeModule::NodeFs], Vec::new());
        let (declarations, others) = roots.split_at(2);
        assert_eq!(declarations, runtime.declaration_paths());
        for path in declarations {
            assert_eq!(runtime.file_kind(path), Some(RuntimeFileKind::Declarations));
        }
        assert!(!others.is_empty());
        assert_eq!(
            others[0],
            runtime.module_path(RuntimeModule::NodeFs).unwrap()
        );
    }

    #[test]
    fn omitted_builtin_modules_leave_the_declarations() {
        let runtime = RuntimeModules::new(Archive::embedded(), true);
        let modules = vec![RuntimeModule::NodeFs];
        let roots = order_root_paths(&runtime, modules, STARTUP_FUNCTIONS.to_vec());
        assert_eq!(roots, runtime.declaration_paths());
    }

    #[test]
    fn file_of_the_prelude_is_a_root_where_one_of_its_functions_is_asked_for() {
        let mut functions = runtime_functions().iter();
        let written_for_compiler = functions
            .find(|data| {
                data.role == RuntimeFunctionRole::CompilerFunction
                    && data.file.starts_with("prelude/")
            })
            .unwrap()
            .function;
        for omits_builtin_modules in [false, true] {
            let runtime = RuntimeModules::new(Archive::embedded(), omits_builtin_modules);
            let roots = order_root_paths(&runtime, Vec::new(), vec![written_for_compiler]);
            let path = runtime.function_file_path(written_for_compiler).unwrap();
            assert!(runtime.prelude_paths().any(|listed| listed == path));
            assert_eq!(runtime.file_kind(&path), Some(RuntimeFileKind::Functions));
            assert_eq!(roots[2..], [path]);
        }
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
        let first_module = 2;
        assert_eq!(roots[first_module..][..module_paths.len()], module_paths);
    }
}
