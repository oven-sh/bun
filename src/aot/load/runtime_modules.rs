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
    archive_name: Box<[u8]>,
    contents: Option<&'static [u8]>,
}

#[derive(Default)]
struct DirectoryEntries {
    files: Vec<Vec<u8>>,
    directories: Vec<Vec<u8>>,
}

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

    pub(crate) fn entries(&self, path: &[u8]) -> Option<(Vec<Vec<u8>>, Vec<Vec<u8>>)> {
        let entries = self.directories.get(path)?;
        Some((entries.files.clone(), entries.directories.clone()))
    }

    pub(crate) fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let file = self.files.get(path)?;
        match file.contents {
            Some(contents) => Some(Cow::Borrowed(contents)),
            None => Archive::read(&file.archive_name).map(Cow::Owned),
        }
    }

    pub(crate) fn manifest(&self) -> &'static Manifest {
        self.archive.manifest()
    }

    pub(crate) fn omits_builtin_modules(&self) -> bool {
        self.omits_builtin_modules
    }

    pub(crate) fn resolve_module(
        &self,
        specifier: &[u8],
        importer: &[u8],
    ) -> Option<RuntimeResolution> {
        let manifest = self.manifest();
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
            RuntimeResolution::Module(_) if self.omits_builtin_modules() => {
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
        match self.manifest().function_file(function.0) {
            Some(_) if self.omits_builtin_modules() => None,
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

    pub(crate) fn prelude_paths(&self) -> impl Iterator<Item = Vec<u8>> {
        prelude::FILES
            .iter()
            .map(|(name, _)| virtual_path(&prelude_archive_name(name)))
    }

    pub(crate) fn function_files_without_ids(&self) -> impl Iterator<Item = Vec<u8>> + '_ {
        let files = match self.omits_builtin_modules() {
            true => None,
            false => Some(self.manifest().function_files_without_ids()),
        };
        files.into_iter().flatten().map(virtual_path)
    }

    fn source_path(&self, registry_id: u32) -> Option<&'static [u8]> {
        if self.omits_builtin_modules() {
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
    add(b"tsconfig.json", RuntimeFileKind::Configuration, None);
    let package_json = Some(PACKAGE_JSON);
    add(
        b"package.json",
        RuntimeFileKind::Configuration,
        package_json,
    );
    for &(name, text) in prelude::FILES {
        let contents = Some(text.as_bytes());
        add(
            &prelude_archive_name(name),
            RuntimeFileKind::Functions,
            contents,
        );
    }
    files
}

fn collect_directories(
    files: &FxHashMap<Vec<u8>, RuntimeFile>,
) -> FxHashMap<Vec<u8>, DirectoryEntries> {
    let top_directory = HOST_ROOT.strip_suffix(b"/").unwrap_or(HOST_ROOT);
    let mut directories: FxHashMap<Vec<u8>, DirectoryEntries> = FxHashMap::default();
    for path in files.keys() {
        debug_assert!(path.starts_with(HOST_ROOT));
        let mut child: &[u8] = path;
        let mut is_child_file = true;
        for directory in ancestors(dirname::<Posix>(path)) {
            let is_listed = directories.contains_key(directory);
            let entries = directories.entry(directory.to_vec()).or_default();
            let names = match is_child_file {
                true => &mut entries.files,
                false => &mut entries.directories,
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
        entries.files.shared_sort_unstable();
        entries.directories.shared_sort_unstable();
    }
    directories
}
