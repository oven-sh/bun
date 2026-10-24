use std::borrow::Cow;

use bun_ast::Target;
use bun_builtin_sources::{Archive, Manifest, VIRTUAL_ROOT};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_resolve_builtins::HardcodedModule::BUN_ALIASES;
use bun_resolve_builtins::{Alias, Cfg, Module};
use bun_sema::program::HostModuleId;
use bun_sema::resolve::{HostResolution, ancestors};
use bun_sema::util::{FxHashMap, SharedSort};

use crate::builtins::{RuntimeFunction, RuntimeModule, table};
use crate::load::HOST_ROOT;
use crate::prelude;

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RuntimeFileKind {
    Module(RuntimeModule),
    Functions,
    Declarations,
    Configuration,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum RuntimeResolution {
    Module(HostModuleId),
    HostValue,
}

struct RuntimeFile {
    kind: RuntimeFileKind,
    comes_with_module: bool,
    archive_name: Box<[u8]>,
    contents: Option<&'static [u8]>,
}

/// The files and the directories.
type DirectoryEntries = (Vec<Vec<u8>>, Vec<Vec<u8>>);

pub(crate) struct RuntimeModules {
    archive: &'static Archive,
    omits_builtin_modules: bool,
    answers_modules_of_own_tests: bool,
    aliases: Cfg,
    files: FxHashMap<Vec<u8>, RuntimeFile>,
    directories: FxHashMap<Vec<u8>, DirectoryEntries>,
    public_specifiers: Vec<(HostModuleId, &'static [u8])>,
}

const PACKAGE_JSON: &[u8] = br#"{"name":"bun-runtime-modules"}"#;

const DECLARATION_FILES: [&[u8]; 2] = [b"builtins.d.ts", b"private.d.ts"];

impl RuntimeModules {
    pub(crate) fn new(archive: &'static Archive, omits_builtin_modules: bool) -> RuntimeModules {
        let files = collect_files(archive);
        RuntimeModules {
            archive,
            omits_builtin_modules,
            answers_modules_of_own_tests: runs_own_tests(),
            aliases: Cfg::default(),
            directories: collect_directories(&files),
            files,
            public_specifiers: match omits_builtin_modules {
                true => Vec::new(),
                false => collect_public_specifiers(archive.manifest()),
            },
        }
    }

    pub(crate) fn with_test_aliases(mut self, runs_tests: bool) -> RuntimeModules {
        self.aliases.rewrite_jest_for_tests = runs_tests;
        self
    }

    #[cfg(test)]
    pub(crate) fn with_replaced_sources(
        mut self,
        sources: &[(Vec<u8>, Vec<u8>)],
    ) -> RuntimeModules {
        for (path, text) in sources {
            if let Some(file) = self.files.get_mut(path) {
                let text: &'static [u8] = text.clone().leak();
                file.contents = Some(text);
            }
        }
        self
    }

    pub(crate) fn file_kind(&self, path: &[u8]) -> Option<RuntimeFileKind> {
        self.files.get(path).map(|file| file.kind)
    }

    pub(crate) fn is_directory(&self, path: &[u8]) -> bool {
        self.directories.contains_key(path)
    }

    pub(crate) fn entries(&self, path: &[u8]) -> Option<DirectoryEntries> {
        self.directories.get(path).cloned()
    }

    pub(crate) fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let file = self.files.get(path)?;
        match file.contents {
            Some(contents) => Some(Cow::Borrowed(contents)),
            None => Archive::read(&file.archive_name).map(Cow::Owned),
        }
    }

    pub(crate) fn resolve_module(
        &self,
        specifier: &[u8],
        importer: &[u8],
    ) -> Option<RuntimeResolution> {
        let manifest = self.archive.manifest();
        let internal_module = self
            .files
            .get(importer)
            .and_then(|file| manifest.resolve(specifier, &file.archive_name));
        let resolution = match internal_module {
            Some(id) => RuntimeResolution::Module(HostModuleId(id)),
            None if self.refuses(specifier, importer) => return None,
            None => resolve_alias(manifest, specifier, self.aliases)?,
        };
        Some(match resolution {
            RuntimeResolution::Module(_) if self.omits_builtin_modules => {
                RuntimeResolution::HostValue
            }
            RuntimeResolution::Module(_) | RuntimeResolution::HostValue => resolution,
        })
    }

    fn refuses(&self, specifier: &[u8], importer: &[u8]) -> bool {
        !self.answers_modules_of_own_tests
            && !self.files.contains_key(importer)
            && is_module_of_own_tests(specifier, self.aliases)
    }

    /// Every name under which a program imports a module of Bun's own.
    pub(crate) fn specifiers(&self) -> Vec<Vec<u8>> {
        let aliases = BUN_ALIASES.iter().copied().flatten();
        let specifiers = aliases.map(|&(specifier, _)| specifier);
        let provided = specifiers.filter(|specifier| self.resolve_module(specifier, b"").is_some());
        provided.map(<[u8]>::to_vec).collect()
    }

    #[cfg(test)]
    pub(crate) fn public_specifiers(&self) -> impl Iterator<Item = &'static [u8]> + '_ {
        self.public_specifiers
            .iter()
            .map(|&(_, specifier)| specifier)
    }

    pub(crate) fn find_modules(&self, prefix: &[u8], suffix: &[u8]) -> Vec<HostModuleId> {
        let matches = self.public_specifiers.iter().filter(|(_, specifier)| {
            specifier.len() >= prefix.len() + suffix.len()
                && specifier.starts_with(prefix)
                && specifier.ends_with(suffix)
        });
        let mut modules: Vec<HostModuleId> = matches.map(|&(module, _)| module).collect();
        modules.dedup();
        modules
    }

    pub(crate) fn module_resolution(&self, id: HostModuleId) -> HostResolution {
        match self.source_path(id.0) {
            Some(path) => HostResolution::ModuleSource {
                module: id,
                path: path.to_vec(),
            },
            None => HostResolution::Module(id),
        }
    }

    pub(crate) fn module_path(&self, module: RuntimeModule) -> Option<&[u8]> {
        self.source_path(module.registry_id())
    }

    pub(crate) fn function_file_path(&self, function: RuntimeFunction) -> Option<Vec<u8>> {
        match self.archive.manifest().function_file(function.0) {
            Some(_) if self.omits_builtin_modules => None,
            Some(archive_name) => Some(virtual_path(archive_name)),
            None => {
                let file = table::runtime_function(function)?.file;
                let path = virtual_path(&[file.as_bytes(), b".ts"].concat());
                self.files.contains_key(&path).then_some(path)
            }
        }
    }

    pub(crate) fn declaration_paths(&self) -> [Vec<u8>; 2] {
        DECLARATION_FILES.map(virtual_path)
    }

    /// The file that says what `require` answers for the module at `path`.
    pub(crate) fn declarations_of_module(&self, path: &[u8]) -> Option<Vec<u8>> {
        let extension_start = bun_core::strings::last_index_of_char(path, b'.')?;
        let declarations = [&path[..extension_start], b".listed.d.ts"].concat();
        let kind = self.file_kind(&declarations)?;
        (kind == RuntimeFileKind::Declarations).then_some(declarations)
    }

    pub(crate) fn prelude_paths(&self) -> impl Iterator<Item = Vec<u8>> {
        prelude::FILES
            .iter()
            .map(|(name, _)| virtual_path(&prelude_archive_name(name)))
    }

    pub(crate) fn function_files_without_ids(&self) -> impl Iterator<Item = Vec<u8>> + '_ {
        let files = match self.omits_builtin_modules {
            true => None,
            false => Some(self.archive.manifest().function_files_without_ids()),
        };
        files.into_iter().flatten().map(virtual_path)
    }

    fn source_path(&self, registry_id: u32) -> Option<&'static [u8]> {
        if self.omits_builtin_modules {
            return None;
        }
        self.archive.path(registry_id)
    }
}

fn virtual_path(archive_name: &[u8]) -> Vec<u8> {
    [VIRTUAL_ROOT, archive_name].concat()
}

fn prelude_archive_name(name: &str) -> Vec<u8> {
    [&b"prelude/"[..], name.as_bytes()].concat()
}

// As `bun run` decides it: `load_env` in src/jsc/VirtualMachine.rs.
fn runs_own_tests() -> bool {
    cfg!(test)
        || bun_core::env::IS_DEBUG
        || (bun_core::getenv_z(bun_core::zstr!("BUN_GARBAGE_COLLECTOR_LEVEL")).is_some()
            && bun_core::getenv_z(bun_core::zstr!("BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING"))
                .is_some())
}

// The names that `bun run` answers to Bun's own tests alone: `fetch_builtin_module` in src/runtime/jsc_hooks.rs.
fn is_module_of_own_tests(specifier: &[u8], aliases: Cfg) -> bool {
    let Some(alias) = Alias::get(specifier, Target::Bun, aliases) else {
        return false;
    };
    matches!(
        Module::MAP.get(alias.path.as_bytes()),
        Some(
            Module::BunInternalForTesting
                | Module::InternalClusterRoundRobinHandle
                | Module::NodeInternalRepl
                | Module::NodeInternalReplAwait
                | Module::NodeInternalReplHistory
                | Module::NodeInternalUtilInspect
                | Module::InternalTestBinding
        )
    )
}

fn resolve_alias(manifest: &Manifest, specifier: &[u8], aliases: Cfg) -> Option<RuntimeResolution> {
    let alias = Alias::get(specifier, Target::Bun, aliases)?;
    Some(match manifest.module_by_specifier(alias.path.as_bytes()) {
        Some(id) => RuntimeResolution::Module(HostModuleId(id)),
        None => RuntimeResolution::HostValue,
    })
}

// Some names are there for Bun's own tests alone. An executable answers none of them.
fn is_public(module: HostModuleId) -> bool {
    let module = RuntimeModule::from_registry_id(module.0);
    module.is_some_and(|it| {
        table::module_data(it)
            .flags
            .contains(table::ModuleFlags::IS_PUBLIC)
    })
}

fn collect_public_specifiers(manifest: &Manifest) -> Vec<(HostModuleId, &'static [u8])> {
    let mut specifiers = Vec::new();
    for &(specifier, _) in BUN_ALIASES.iter().copied().flatten() {
        match resolve_alias(manifest, specifier, Cfg::default()) {
            Some(RuntimeResolution::Module(module)) if is_public(module) => {
                specifiers.push((module, specifier));
            }
            Some(RuntimeResolution::Module(_) | RuntimeResolution::HostValue) | None => {}
        }
    }
    specifiers.shared_sort_unstable();
    specifiers
}

fn collect_files(archive: &'static Archive) -> FxHashMap<Vec<u8>, RuntimeFile> {
    let manifest = archive.manifest();
    let mut files = FxHashMap::default();
    let mut add = |archive_name: &[u8], kind, contents| {
        let file = RuntimeFile {
            kind,
            comes_with_module: false,
            archive_name: archive_name.into(),
            contents,
        };
        let replaced = files.insert(virtual_path(archive_name), file);
        debug_assert!(replaced.is_none());
    };
    for module in manifest.modules() {
        let Some(archive_name) = &module.path else {
            continue;
        };
        let runtime_module = RuntimeModule::from_registry_id(module.id)
            .expect("the archive and the built-ins table must come from the same build");
        add(archive_name, RuntimeFileKind::Module(runtime_module), None);
    }
    for file in manifest.function_files() {
        add(file, RuntimeFileKind::Functions, None);
    }
    for name in DECLARATION_FILES {
        add(name, RuntimeFileKind::Declarations, None);
    }
    let configuration = RuntimeFileKind::Configuration;
    add(b"tsconfig.json", configuration, None);
    add(b"package.json", configuration, Some(PACKAGE_JSON));
    for &(name, text) in prelude::FILES {
        let name = prelude_archive_name(name);
        add(&name, RuntimeFileKind::Functions, Some(text.as_bytes()));
    }
    for name in manifest.module_declarations() {
        let file = RuntimeFile {
            kind: RuntimeFileKind::Declarations,
            comes_with_module: true,
            archive_name: name.clone(),
            contents: None,
        };
        files.insert(virtual_path(name), file);
    }
    files
}

fn collect_directories(
    files: &FxHashMap<Vec<u8>, RuntimeFile>,
) -> FxHashMap<Vec<u8>, DirectoryEntries> {
    let top_directory = HOST_ROOT.strip_suffix(b"/").unwrap_or(HOST_ROOT);
    let mut directories: FxHashMap<Vec<u8>, DirectoryEntries> = FxHashMap::default();
    // The project is every file that a directory lists. What says something of one module comes with that module.
    let listed = files.iter().filter(|(_, file)| !file.comes_with_module);
    for path in listed.map(|(path, _)| path) {
        debug_assert!(path.starts_with(HOST_ROOT));
        let mut child: &[u8] = path;
        let mut is_child_file = true;
        for directory in ancestors(dirname::<Posix>(path)) {
            let is_listed = directories.contains_key(directory);
            let entries = directories.entry(directory.to_vec()).or_default();
            let names = match is_child_file {
                true => &mut entries.0,
                false => &mut entries.1,
            };
            names.push(child[directory.len() + 1..].to_vec());
            if is_listed || directory == top_directory {
                break;
            }
            child = directory;
            is_child_file = false;
        }
    }
    for entries in directories.values_mut() {
        entries.0.shared_sort_unstable();
        entries.1.shared_sort_unstable();
    }
    directories
}

#[cfg(test)]
mod tests {
    use bstr::{BStr, ByteSlice};
    use bun_sema::atom::Interner;
    use bun_sema::hir_from_data::DataValue;
    use bun_sema::session::Session;

    use super::*;
    use crate::builtins::table::STARTUP_FUNCTIONS;
    use crate::load::data_modules::parse_json;

    const HOST_VALUE: Option<RuntimeResolution> = Some(RuntimeResolution::HostValue);

    fn runtime_modules() -> RuntimeModules {
        RuntimeModules::new(Archive::embedded(), false)
    }

    fn host_module_id(module: RuntimeModule) -> HostModuleId {
        HostModuleId(module.registry_id())
    }

    fn source_path(runtime: &RuntimeModules, resolution: Option<RuntimeResolution>) -> Vec<u8> {
        let Some(RuntimeResolution::Module(id)) = resolution else {
            panic!("expected a module, got {resolution:?}");
        };
        match runtime.module_resolution(id) {
            HostResolution::ModuleSource { module, path } if module == id => path,
            other => panic!("expected the source of {id:?}, got {other:?}"),
        }
    }

    #[test]
    fn alias_and_specifier_resolve_to_one_module() {
        let runtime = runtime_modules();
        let resolution = runtime.resolve_module(b"fs", b"");
        assert_eq!(resolution, runtime.resolve_module(b"node:fs", b""));
        let path = source_path(&runtime, resolution);
        let kind = RuntimeFileKind::Module(RuntimeModule::NodeFs);
        assert_eq!(runtime.file_kind(&path), Some(kind));
        assert_eq!(runtime.module_path(RuntimeModule::NodeFs), Some(&path[..]));
    }

    #[test]
    fn module_sources_are_listed_at_archive_paths() {
        let runtime = runtime_modules();
        let mut source_count = 0;
        for module in runtime.archive.manifest().modules() {
            let Some(path) = runtime.archive.path(module.id) else {
                assert!(module.path.is_none(), "module {}", module.id);
                continue;
            };
            let runtime_module = RuntimeModule::from_registry_id(module.id).unwrap();
            let kind = RuntimeFileKind::Module(runtime_module);
            assert_eq!(runtime.file_kind(path), Some(kind), "{}", BStr::new(path));
            assert_eq!(runtime.module_path(runtime_module), Some(path));
            source_count += 1;
        }
        assert!(source_count > 0);
    }

    #[test]
    fn native_module_has_no_path() {
        let runtime = runtime_modules();
        let Some(RuntimeResolution::Module(id)) = runtime.resolve_module(b"bun:jsc", b"") else {
            panic!("bun:jsc has a registry id");
        };
        assert_eq!(runtime.module_resolution(id), HostResolution::Module(id));
        let module = RuntimeModule::from_registry_id(id.0).unwrap();
        assert_eq!(runtime.module_path(module), None);
    }

    #[test]
    fn modules_of_own_tests_are_no_modules_for_a_program_built_elsewhere() {
        let names: [&[u8]; 2] = [b"bun:internal-for-testing", b"internal/test/binding"];
        let mut runtime = runtime_modules();
        let importer = runtime.module_path(RuntimeModule::NodeFs).unwrap().to_vec();
        for name in names {
            assert!(runtime.resolve_module(name, b"/project/a.js").is_some());
        }
        runtime.answers_modules_of_own_tests = false;
        for name in names {
            assert_eq!(runtime.resolve_module(name, b"/project/a.js"), None);
            assert!(runtime.resolve_module(name, &importer).is_some());
        }
        assert!(
            runtime
                .resolve_module(b"node:fs", b"/project/a.js")
                .is_some()
        );
    }

    #[test]
    fn internal_modules_resolve_from_runtime_sources_only() {
        let runtime = runtime_modules();
        let importer = source_path(&runtime, runtime.resolve_module(b"node:fs", b""));
        let from_runtime = runtime.resolve_module(b"internal/validators", &importer);
        let kind = runtime.file_kind(&source_path(&runtime, from_runtime));
        assert!(matches!(kind, Some(RuntimeFileKind::Module(_))));
        let from_program = runtime.resolve_module(b"internal/validators", b"/project/a.ts");
        assert_eq!(from_program, None);
    }

    #[test]
    fn alias_without_registry_id_is_host_value() {
        let resolution = runtime_modules().resolve_module(b"bun:main", b"");
        assert_eq!(resolution, HOST_VALUE);
    }

    #[test]
    fn other_specifiers_are_unclaimed() {
        let runtime = runtime_modules();
        assert_eq!(runtime.resolve_module(b"./nothing", b""), None);
        assert_eq!(runtime.resolve_module(b"./nothing", b"/project/a.ts"), None);
        let importer = source_path(&runtime, runtime.resolve_module(b"node:fs", b""));
        assert_eq!(runtime.resolve_module(b"./nothing", &importer), None);
    }

    #[test]
    fn find_modules_matches_public_specifiers_by_prefix_and_suffix() {
        let runtime = runtime_modules();
        let fs = host_module_id(RuntimeModule::NodeFs);
        assert!(runtime.find_modules(b"node:f", b"").contains(&fs));
        assert!(runtime.find_modules(b"f", b"s").contains(&fs));
        assert_eq!(runtime.find_modules(b"node:", b"fs"), [fs]);
        let every_module = runtime.find_modules(b"", b"");
        assert!(every_module.contains(&fs));
        assert!(every_module.is_sorted_by(|a, b| a < b));
        let ws = host_module_id(RuntimeModule::Ws);
        assert_eq!(runtime.find_modules(b"ws/lib/", b""), [ws]);
        let util = host_module_id(RuntimeModule::NodeUtil);
        assert_eq!(runtime.find_modules(b"node:sy", b""), [util]);
        assert!(runtime.find_modules(b"node:fs", b"fs").is_empty());
        assert!(runtime.find_modules(b"internal/validators", b"").is_empty());
        assert!(runtime.find_modules(b"bun:main", b"").is_empty());
        assert!(runtime.find_modules(b"./", b"").is_empty());
    }

    #[test]
    fn listed_files_are_readable() {
        let runtime = runtime_modules();
        for path in runtime.files.keys() {
            let text = runtime.read(path);
            assert!(
                text.is_some_and(|text| !text.is_empty()),
                "{}",
                BStr::new(path)
            );
        }
    }

    #[test]
    fn function_files_have_virtual_paths() {
        let runtime = runtime_modules();
        for &function in STARTUP_FUNCTIONS {
            let path = runtime.function_file_path(function).unwrap();
            let kind = runtime.file_kind(&path);
            assert_eq!(kind, Some(RuntimeFileKind::Functions), "{function:?}");
        }
        for path in runtime.function_files_without_ids() {
            let kind = runtime.file_kind(&path);
            assert_eq!(
                kind,
                Some(RuntimeFileKind::Functions),
                "{}",
                BStr::new(&path)
            );
        }
        let unknown_function = RuntimeFunction(u32::MAX);
        assert_eq!(runtime.function_file_path(unknown_function), None);
    }

    #[test]
    fn prelude_function_has_a_file() {
        let mut functions = table::runtime_functions().iter();
        let decorator_function = functions
            .find(|data| data.file == "prelude/decorators")
            .unwrap()
            .function;
        for omits_builtin_modules in [false, true] {
            let runtime = RuntimeModules::new(Archive::embedded(), omits_builtin_modules);
            let path = runtime.function_file_path(decorator_function).unwrap();
            assert_eq!(path, b"/$bun/js/prelude/decorators.ts");
            assert_eq!(runtime.file_kind(&path), Some(RuntimeFileKind::Functions));
            assert!(runtime.prelude_paths().any(|listed| listed == path));
        }
    }

    #[test]
    fn directories_are_listed_up_to_host_root() {
        let runtime = runtime_modules();
        assert!(runtime.is_directory(b"/$bun/js/node"));
        assert!(runtime.is_directory(b"/$bun/js"));
        assert!(runtime.is_directory(b"/$bun"));
        assert!(!runtime.is_directory(b"/"));
        assert!(!runtime.is_directory(b"/$bun/js/"));
        assert!(!runtime.is_directory(b"/$bun/js/node/fs.ts"));
        assert!(!runtime.is_directory(b"/$bun/plugin"));
    }

    #[test]
    fn entries_are_sorted_and_unique() {
        let runtime = runtime_modules();
        let (files, directories) = runtime.entries(b"/$bun/js").unwrap();
        assert!(files.contains(&b"tsconfig.json".to_vec()));
        assert!(files.contains(&b"package.json".to_vec()));
        assert!(directories.contains(&b"node".to_vec()));
        assert!(directories.contains(&b"prelude".to_vec()));
        assert!(files.is_sorted_by(|a, b| a < b));
        assert!(directories.is_sorted_by(|a, b| a < b));
        let top_entries = (Vec::new(), vec![b"js".to_vec()]);
        assert_eq!(runtime.entries(b"/$bun"), Some(top_entries));
        assert_eq!(runtime.entries(b"/$bun/js/node/fs.ts"), None);
        assert_eq!(runtime.entries(b"/"), None);
    }

    #[test]
    fn entries_name_files_and_directories() {
        let runtime = runtime_modules();
        let mut file_count = 0;
        for (directory, (files, directories)) in &runtime.directories {
            for name in files {
                let path = [&directory[..], b"/", &name[..]].concat();
                assert!(runtime.file_kind(&path).is_some(), "{}", BStr::new(&path));
            }
            for name in directories {
                let path = [&directory[..], b"/", &name[..]].concat();
                assert!(runtime.is_directory(&path), "{}", BStr::new(&path));
            }
            file_count += files.len();
        }
        let listed = runtime.files.values().filter(|it| !it.comes_with_module);
        assert_eq!(file_count, listed.count());
    }

    #[test]
    fn non_module_files_have_kinds() {
        let runtime = runtime_modules();
        let kind_at = |name: &[u8]| runtime.file_kind(&virtual_path(name));
        let declarations = Some(RuntimeFileKind::Declarations);
        assert_eq!(kind_at(b"builtins.d.ts"), declarations);
        assert_eq!(kind_at(b"private.d.ts"), declarations);
        for path in runtime.declaration_paths() {
            assert_eq!(runtime.file_kind(&path), declarations);
        }
        let configuration = Some(RuntimeFileKind::Configuration);
        assert_eq!(kind_at(b"tsconfig.json"), configuration);
        assert_eq!(kind_at(b"package.json"), configuration);
        for file in runtime.archive.manifest().function_files() {
            assert_eq!(kind_at(file), Some(RuntimeFileKind::Functions));
        }
        for path in runtime.prelude_paths() {
            assert_eq!(runtime.file_kind(&path), Some(RuntimeFileKind::Functions));
        }
        for name in [&b"builtins.d.ts"[..], b"private.d.ts", b"tsconfig.json"] {
            let text = runtime.read(&virtual_path(name));
            assert!(text.is_some_and(|text| !text.is_empty()));
        }
    }

    #[test]
    fn what_require_answers_for_a_module_is_declared_beside_the_module() {
        let runtime = runtime_modules();
        let module = runtime.module_path(RuntimeModule::NodeFs).unwrap();
        let declarations = runtime.declarations_of_module(module).unwrap();
        assert_eq!(declarations, b"/$bun/js/node/fs.listed.d.ts");
        let text = runtime.read(&declarations).unwrap();
        let line = br#""node:fs": $ModuleValue<typeof import("./fs")>;"#;
        assert!(text.find(line).is_some(), "{}", BStr::new(&text));
        assert_eq!(runtime.declarations_of_module(&declarations), None);

        // A file that a directory lists is part of every program, and what it names is read.
        let (files, _) = runtime.entries(b"/$bun/js/node").unwrap();
        assert!(files.contains(&b"fs.ts".to_vec()));
        assert!(!files.contains(&b"fs.listed.d.ts".to_vec()));
        let shared = runtime.read(b"/$bun/js/private.d.ts").unwrap();
        assert!(shared.find(b"interface $BunModules {").is_some());
        assert!(shared.find(b"$ModuleValue<typeof import(\"./").is_none());
    }

    #[test]
    fn virtual_package_json_has_name_and_no_type() {
        let session = Session::new();
        let atoms = Interner::new_in(&session);
        let text = runtime_modules().read(b"/$bun/js/package.json").unwrap();
        let value = parse_json(&text, session.arena(), &atoms);
        let Some(DataValue::Object(properties)) = value else {
            panic!("expected an object, got {value:?}");
        };
        let keys: Vec<&[u8]> = properties
            .iter()
            .map(|(key, _)| atoms.bytes(*key))
            .collect();
        assert_eq!(keys, [&b"name"[..]]);
    }

    #[test]
    fn paths_match_exactly() {
        let runtime = runtime_modules();
        assert!(runtime.file_kind(b"/$bun/js/node/fs.ts").is_some());
        assert_eq!(runtime.file_kind(b"/$bun/js/node/fs.ts.bak"), None);
        assert_eq!(runtime.file_kind(b"/$bun/js/node/fs"), None);
        assert_eq!(runtime.file_kind(b"/project/$bun/js/node/fs.ts"), None);
        assert_eq!(runtime.read(b"/$bun/js/node/fs.ts.bak"), None);
    }

    #[test]
    fn replaced_source_keeps_kind_and_listing() {
        let unchanged = runtime_modules();
        let module: &[u8] = b"/$bun/js/node/os.ts";
        let functions = virtual_path(&unchanged.archive.manifest().function_files()[0]);
        let sources = [
            (module.to_vec(), b"export {};".to_vec()),
            (functions.clone(), b"export function probe() {}".to_vec()),
            (
                b"/project/main.ts".to_vec(),
                b"import \"node:os\";".to_vec(),
            ),
            (b"/$bun/js/node/missing.ts".to_vec(), b"export {};".to_vec()),
        ];
        let replaced = runtime_modules().with_replaced_sources(&sources);

        assert_eq!(replaced.read(module).unwrap(), &b"export {};"[..]);
        assert_eq!(
            replaced.read(&functions).unwrap(),
            &b"export function probe() {}"[..]
        );
        let kind = RuntimeFileKind::Module(RuntimeModule::NodeOs);
        assert_eq!(replaced.file_kind(module), Some(kind));
        assert_eq!(
            replaced.file_kind(&functions),
            Some(RuntimeFileKind::Functions)
        );
        let os = replaced.resolve_module(b"node:os", b"");
        assert_eq!(source_path(&replaced, os), module);
        let validators = replaced.resolve_module(b"internal/validators", module);
        assert_eq!(
            validators,
            unchanged.resolve_module(b"internal/validators", module)
        );
        assert!(validators.is_some());

        assert_eq!(replaced.files.len(), unchanged.files.len());
        assert_eq!(replaced.file_kind(b"/project/main.ts"), None);
        assert_eq!(replaced.file_kind(b"/$bun/js/node/missing.ts"), None);
        assert_eq!(
            replaced.entries(b"/$bun/js/node"),
            unchanged.entries(b"/$bun/js/node")
        );
        let other: &[u8] = b"/$bun/js/node/fs.ts";
        assert_eq!(replaced.read(other), unchanged.read(other));
    }

    #[test]
    fn omitted_builtin_modules_are_host_values() {
        let runtime = RuntimeModules::new(Archive::embedded(), true);
        assert!(runtime.omits_builtin_modules);
        for specifier in [&b"fs"[..], b"node:fs", b"bun:jsc", b"bun:main"] {
            assert_eq!(runtime.resolve_module(specifier, b""), HOST_VALUE);
        }
        let importer: &[u8] = b"/$bun/js/node/fs.ts";
        assert_eq!(
            runtime.resolve_module(b"internal/validators", importer),
            HOST_VALUE
        );
        assert_eq!(runtime.resolve_module(b"./nothing", b""), None);
        assert!(runtime.find_modules(b"", b"").is_empty());
        assert_eq!(runtime.module_path(RuntimeModule::NodeFs), None);
        let fs = host_module_id(RuntimeModule::NodeFs);
        assert_eq!(runtime.module_resolution(fs), HostResolution::Module(fs));
        for &function in STARTUP_FUNCTIONS {
            assert_eq!(runtime.function_file_path(function), None);
        }
        assert_eq!(runtime.function_files_without_ids().count(), 0);
        assert!(runtime.file_kind(importer).is_some());
    }
}
