//! What the test files of a run replace, found before anything is built: each file is parsed, bound and folded by itself, all of them in parallel.
//! A build that does not see the test files is told with it. A build that sees them saves a load that starts over.

use bun_builtin_sources::Archive;
use bun_options_types::aot_options::ReplacedByTests;
use bun_paths::resolve_path::{dirname, join_abs_string_buf_checked, platform};
use bun_paths::{is_absolute, path_buffer_pool};
use bun_sema::util::{FxHashMap, FxHashSet, SharedSort};
use bun_sema_driver::{ThreadCaches, drop_thread_caches, for_each_parallel_in_runs};
use bun_sys::{Fd, File};
use bun_threading::Guarded;
use core::hash::{Hash, Hasher};
use core::sync::atomic::{AtomicUsize, Ordering};
use std::sync::OnceLock;

use crate::builtins::table::{self, Mutability};
use crate::builtins::{
    BuiltinId, RuntimeModule, find_member_written_behind, members_written_under_any_name,
};
use crate::load::is_in_node_modules;
use crate::load::replaced_builtins::{
    BuiltinsOfModule, FileChangerOfModule, FoundInFile, LeftOpenByText, ProductFiles, is_relative,
    look_at_files, look_at_files_of_run,
};
use crate::load::runtime_modules::find_module_named;
use crate::options::OpenedName;
use crate::statistics::logs_stages;

/// A module as `importer` writes it.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub(crate) struct WrittenModule {
    pub importer: Vec<u8>,
    pub specifier: Vec<u8>,
}

#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum ReadsLibrary {
    No,
    Yes,
}

/// A file of the tests: what it names, whether it can run code that no build has seen, and what the code that it holds as text does.
pub(crate) struct FileWithTexts {
    path: Vec<u8>,
    /// `FoundInFile::files_named`, each as a whole path.
    files_named: Vec<Vec<u8>>,
    runs_unseen_code: bool,
    names_spied_in_text: Vec<Vec<u8>>,
    modules_replaced_in_text: Vec<Vec<u8>>,
    left_open_by_text: LeftOpenByText,
}

#[derive(Default)]
pub(crate) struct FoundInTests {
    pub members: Vec<u32>,
    pub names_added: Vec<OpenedName>,
    pub modules: Vec<WrittenModule>,
    /// `FoundInFile::modules_named_by_plugins`
    pub modules_named_by_plugins: Vec<Vec<u8>>,
    pub exports: Vec<(WrittenModule, Vec<u8>)>,
    pub any_module: bool,
    pub handed_on: Vec<WrittenModule>,
    pub hands_on_any: bool,
    pub spies_on_unknown_objects: bool,
    pub names_spied_on_unknown_objects: Vec<Vec<u8>>,
    pub names_spied_in_text: Vec<Vec<u8>>,
    pub modules_replaced_in_text: Vec<Vec<u8>>,
    pub left_open_by_text: LeftOpenByText,
    pub loads_by_unknown_path: bool,
    /// For `settle_texts`, which empties it.
    pub files_with_texts: Vec<FileWithTexts>,
    pub evicted: Vec<WrittenModule>,
    pub evicts_any: bool,
    /// `writeFileSync(path, text)`: the whole paths that the files spell to calls which write, move or remove what is there. A path that such a call follows below a
    /// folder is here once more with `/` at its end.
    pub paths_changed_on_disk: Vec<Vec<u8>>,
    pub required_where_throws_are_caught: Vec<WrittenModule>,
    pub imported_with_types: Vec<WrittenModule>,
    pub names_file_with_query: bool,
    /// `ReplacedByTests::entry_point_imports_vitest`
    pub entry_point_imports_vitest: bool,
    pub imported_by_statements: Vec<WrittenModule>,
    pub imported_by_calls: Vec<WrittenModule>,
    pub required: Vec<WrittenModule>,
    /// The files with `FoundInFile::spies_under_names_from_outside`, each as the scan was told to read it.
    spy_under_names_from_outside: Vec<Vec<u8>>,
    /// A file as the scan was told to read it, and `FoundInFile::holders_named_from_outside` of it.
    holders_named_from_outside: Vec<(Vec<u8>, Vec<u32>)>,
    /// A file as the scan was told to read it, `FoundInFile::builtins_handed_out` of it, and the files whose exports it exports again, in the same spelling.
    builtins_handed_out: Vec<(Vec<u8>, Vec<u32>, Vec<Vec<u8>>)>,
    /// `FoundInFile::writes_on_imports`, the file in the same spelling.
    writes_on_imports: Vec<(Vec<u8>, Vec<Vec<u8>>, Vec<u8>)>,
    /// A file in the same spelling, and a text that another file passes to what it imports from it.
    texts_passed: Vec<(Vec<u8>, Vec<u8>)>,
    /// The files with `FoundInFile::writes_on_parameters_under_any_name`, each as the scan was told to read it.
    write_on_parameters_under_any_name: Vec<Vec<u8>>,
    /// A file in the same spelling, and a built-in object that another file passes to what it imports from it.
    builtins_passed: Vec<(Vec<u8>, u32)>,
    library_modules_named: Vec<Vec<u8>>,
    /// `ReplacedByTests::package_files_that_product_imports`, each as the file writes it.
    packages_named_by_product: Vec<WrittenModule>,
    /// `ReplacedByTests::package_files_imported_beside_tests`, each as the file writes it.
    packages_named_beside_tests: Vec<WrittenModule>,
    /// By the path of the file.
    exported_again: FxHashMap<Vec<u8>, ExportedAgain>,
}

/// `FoundInFile::names_exported_again` and `modules_exported_again`.
#[derive(Clone, Default)]
struct ExportedAgain {
    names: Vec<(Vec<u8>, Vec<u8>, Vec<u8>)>,
    modules: Vec<Vec<u8>>,
}

enum FileNamed {
    Read {
        path: Vec<u8>,
        text: Vec<u8>,
    },
    /// Under another spelling.
    LookedAtBefore,
}

/// `is_looked_at`: whether the file at a path needs no second look. It is there, so the name leads to it as it would to its text.
fn read_file_named(path: &[u8], is_looked_at: &dyn Fn(&[u8]) -> bool) -> Option<FileNamed> {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mts", b".mjs", b".cts", b".cjs",
    ];
    // `new URL("../scripts/run.sh", import.meta.url)` names a file that holds no code of ours.
    let read = |path: Vec<u8>| {
        if is_looked_at(&path) {
            return Some(FileNamed::LookedAtBefore);
        }
        let holds_code = EXTENSIONS.iter().any(|extension| path.ends_with(extension));
        let text = File::read_from(Fd::cwd(), &path)
            .ok()
            .filter(|_| holds_code)?;
        Some(FileNamed::Read { path, text })
    };
    let query = bun_core::strings::index_of_char_usize(path, b'?');
    let path = query.map_or(path, |start| &path[..start]);
    let written_for_output = (path.strip_suffix(b".js")).map(|stem| [stem, b".ts"].concat());
    read(path.to_vec())
        .or_else(|| written_for_output.and_then(read))
        .or_else(|| (EXTENSIONS.iter()).find_map(|extension| read([path, extension].concat())))
        .or_else(|| (EXTENSIONS.iter()).find_map(|end| read([path, b"/index", end].concat())))
}

/// `new URL("./rows/", import.meta.url)`: whoever names a folder may load what lies in it.
fn find_files_in_folder(path: &[u8]) -> Vec<Vec<u8>> {
    let path = path.strip_suffix(b"/").unwrap_or(path);
    let flags = bun_sys::O::RDONLY | bun_sys::O::DIRECTORY;
    let name = bun_core::ZBox::from_bytes(path);
    let Ok(folder) = bun_sys::openat(Fd::cwd(), &name, flags, 0) else {
        return Vec::new();
    };
    let _close = bun_sys::CloseOnDrop::new(folder);
    let mut entries = bun_sys::dir_iterator::iterate(folder);
    let mut files = Vec::new();
    while let Ok(Some(entry)) = entries.next() {
        if entry.kind == bun_sys::EntryKind::File {
            files.push([path, b"/", entry.name.slice_u8()].concat());
        }
    }
    files.shared_sort_unstable();
    files
}

/// One of Bun's own modules: what it writes on built-in objects, the modules of Bun that it names, and the built-ins that it exports: `export default console`.
#[derive(Default)]
struct LibraryModule {
    writes: Vec<u32>,
    names: Vec<u32>,
    builtins_exported: Vec<(Vec<Vec<u8>>, u32)>,
}

/// A file that exports built-ins, or exports again what another file may export.
struct ExportingFile {
    path: Vec<u8>,
    builtins: BuiltinsOfModule,
    again: ExportedAgain,
}

/// A file that loads others, as the scan was told to read it, and how many built-ins it was told of when it was read.
struct LoadingFile {
    asked_for: Vec<u8>,
    path: Vec<u8>,
    names_loaded: Vec<(Vec<u8>, Option<Vec<u8>>)>,
    /// `FoundInFile::asked_of_other_files`
    asked: Vec<(Vec<u8>, Vec<u8>)>,
    told_of: usize,
}

/// The built-ins that go from file to file under a binding: `export const { getPrototypeOf } = Object` in one, `getPrototypeOf(Uint8Array).prototype.fill = f` in another.
#[derive(Default)]
struct BuiltinsBetweenFiles {
    library: Option<&'static Library>,
    /// By `key_of_file`.
    exporting: FxHashMap<Vec<u8>, ExportingFile>,
    /// Whether one of them has something that is not another file's: a built-in, a changer of files, or what a module of Bun exports.
    has_something_to_hand_on: bool,
    /// By `key_of_file`: what whoever loads the file gets, its own exports and those that it exports again. Only of files that let a built-in through.
    visible: FxHashMap<Vec<u8>, BuiltinsOfModule>,
    /// "@/test/tools" as a file of this folder writes it: the path.
    under_other_names: FxHashMap<(Vec<u8>, Vec<u8>), Vec<u8>>,
    /// By `key_of_file`: `BuiltinsOfModule::folder` and `BuiltinsOfModule::texts`.
    texts: FxHashMap<Vec<u8>, (Vec<u8>, Vec<(Vec<u8>, Vec<u8>, bool)>)>,
}

// One file writes `./tools.js` for what another writes `./tools` and the disk holds as tools.ts, or as tools/index.ts.
fn key_of_file(path: &[u8]) -> &[u8] {
    let stem = without_extension(path);
    match stem.strip_suffix(b"index") {
        Some([folder @ .., b'/']) => folder,
        Some([folder @ .., b'\\']) if cfg!(windows) => folder,
        _ => stem,
    }
}

impl BuiltinsBetweenFiles {
    fn key_of_module(&self, importer: &[u8], specifier: &[u8]) -> Option<Vec<u8>> {
        let folder = dirname::<platform::Auto>(importer);
        if !is_relative(specifier) {
            let path = (self.under_other_names).get(&(folder.to_vec(), specifier.to_vec()))?;
            return Some(key_of_file(path).to_vec());
        }
        let mut buffer = path_buffer_pool::get();
        let joined =
            join_abs_string_buf_checked::<platform::Auto>(folder, &mut buffer[..], &[specifier])?;
        Some(key_of_file(joined).to_vec())
    }

    fn find_in_library(&self, module: RuntimeModule) -> Option<BuiltinsOfModule> {
        let manifest = Archive::embedded().manifest();
        let id = manifest.module_by_specifier(table::specifier_of(module))?;
        let exported = &self.library?.module(id)?.builtins_exported;
        (!exported.is_empty()).then(|| BuiltinsOfModule {
            exported: exported.clone(),
            object_is_default: true,
            ..BuiltinsOfModule::default()
        })
    }

    /// What `importer` gets from the module that it writes as `specifier`.
    fn find(&self, importer: &[u8], specifier: &[u8]) -> Option<BuiltinsOfModule> {
        match find_module_named(specifier) {
            Some(module) => self.find_in_library(module),
            None => {
                let key = self.key_of_module(importer, specifier)?;
                let mut module = self.visible.get(&key).cloned();
                if let Some((folder, texts)) = self.texts.get(&key) {
                    let module = module.get_or_insert_default();
                    module.folder.clone_from(folder);
                    module.texts.clone_from(texts);
                }
                module
            }
        }
    }

    fn add_exporting_file(&mut self, file: ExportingFile) {
        let again = (file.again.names.iter().map(|again| &again.1)).chain(&file.again.modules);
        self.has_something_to_hand_on |= !file.builtins.exported.is_empty()
            || !file.builtins.file_changers.is_empty()
            || again.into_iter().any(|it| find_module_named(it).is_some());
        (self.exporting).insert(key_of_file(&file.path).to_vec(), file);
    }

    /// Works out `visible`: each exporting file is walked once, however many files load it and however many ways lead to it.
    fn settle(&mut self) {
        // It is asked for behind every round of files, and a chain of files that export each other again takes a round for each.
        if !self.has_something_to_hand_on {
            return;
        }
        let mut visible = FxHashMap::default();
        for key in self.exporting.keys() {
            self.settle_file(key, &mut visible, &mut FxHashSet::default());
        }
        visible.retain(|_, module: &mut BuiltinsOfModule| {
            !module.exported.is_empty() || !module.file_changers.is_empty()
        });
        self.visible = visible;
    }

    fn settle_file(
        &self,
        key: &[u8],
        visible: &mut FxHashMap<Vec<u8>, BuiltinsOfModule>,
        visiting: &mut FxHashSet<Vec<u8>>,
    ) -> Option<BuiltinsOfModule> {
        if let Some(known) = visible.get(key) {
            return Some(known.clone());
        }
        let file = self.exporting.get(key)?;
        // `export * from` in a circle
        if !visiting.insert(key.to_vec()) {
            return None;
        }
        let mut found = file.builtins.clone();
        // What a name of the other module leads to: the name itself, or a property of what a CommonJS file or a module of Bun exports.
        let below = |module: &BuiltinsOfModule, names: &[Vec<u8>], name: &[u8]| {
            let rest = match names {
                [first, rest @ ..] if first == name => Some(rest),
                [first, second, rest @ ..]
                    if module.object_is_default && first == b"default" && second == name =>
                {
                    Some(rest)
                }
                _ => None,
            };
            rest.map(<[Vec<u8>]>::to_vec)
        };
        // `export { getPrototypeOf, defineProperty } from "./tools"` asks for the module once.
        let mut modules: FxHashMap<&[u8], Option<BuiltinsOfModule>> = FxHashMap::default();
        let specifiers = file.again.names.iter().map(|again| &again.1);
        for specifier in specifiers.chain(&file.again.modules) {
            if modules.contains_key(&specifier[..]) {
                continue;
            }
            let module = match find_module_named(specifier) {
                Some(module) => self.find_in_library(module),
                None => (self.key_of_module(&file.path, specifier))
                    .and_then(|key| self.settle_file(&key, visible, visiting)),
            };
            modules.insert(specifier, module);
        }
        for (exported, module, name) in &file.again.names {
            let Some(Some(module)) = modules.get(&module[..]) else {
                continue;
            };
            for (names, builtin) in &module.exported {
                if let Some(rest) = below(module, names, name) {
                    let names = core::iter::once(exported.clone()).chain(rest).collect();
                    found.exported.push((names, *builtin));
                }
            }
            let changers = module.file_changers.iter().filter(|it| it.export == *name);
            (found.file_changers).extend(changers.map(|it| FileChangerOfModule {
                export: exported.clone(),
                ..it.clone()
            }));
        }
        for module in &file.again.modules {
            let Some(Some(module)) = modules.get(&module[..]) else {
                continue;
            };
            for (names, builtin) in &module.exported {
                match &names[..] {
                    [first, rest @ ..] if first != b"default" || module.object_is_default => {
                        let names = match first == b"default" {
                            true => rest.to_vec(),
                            false => names.clone(),
                        };
                        if !names.is_empty() {
                            found.exported.push((names, *builtin));
                        }
                    }
                    _ => {}
                }
            }
            let changers = (module.file_changers.iter()).filter(|it| it.export != b"default");
            found.file_changers.extend(changers.cloned());
        }
        visiting.remove(key);
        visible.insert(key.to_vec(), found.clone());
        Some(found)
    }

    /// How many of the built-ins that the modules export the file takes, by the names that it takes from them.
    fn count_for(
        &self,
        path: &[u8],
        names_loaded: &[(Vec<u8>, Option<Vec<u8>>)],
        asked: &[(Vec<u8>, Vec<u8>)],
    ) -> usize {
        let mut count = 0;
        for (specifier, export) in asked {
            let texts = (self.key_of_module(path, specifier)).and_then(|key| self.texts.get(&key));
            count += texts.map_or(0, |it| it.1.iter().filter(|text| text.0 == *export).count());
        }
        let mut modules: FxHashMap<&[u8], Option<BuiltinsOfModule>> = FxHashMap::default();
        for (specifier, name) in names_loaded {
            let module = modules
                .entry(&specifier[..])
                .or_insert_with(|| self.find(path, specifier));
            let Some(module) = module else {
                continue;
            };
            count += (module.exported.iter())
                .filter(|(names, _)| match name {
                    None => true,
                    Some(name) => {
                        names.first() == Some(name)
                            || (module.object_is_default && names.get(1) == Some(name))
                    }
                })
                .count();
            count += (module.file_changers.iter())
                .filter(|it| name.as_ref().is_none_or(|name| it.export == *name))
                .count();
        }
        count
    }
}

fn is_constant_unless_written(member: u32) -> bool {
    BuiltinId::from_wire(member)
        .is_some_and(|member| table::entry(member).mutability == Mutability::ConstantUnlessWritten)
}

/// Bun's own modules that have a text, by id. Each is looked at when somebody first asks for it, once for the process: a run whose files name none of them reads none.
struct Library {
    modules: Vec<Option<(&'static [u8], OnceLock<LibraryModule>)>>,
}

impl Library {
    fn new() -> Library {
        let mut modules = Vec::new();
        for module in Archive::embedded().manifest().modules() {
            let Some(path) = module.path.as_deref() else {
                continue;
            };
            if modules.len() <= module.id as usize {
                modules.resize_with(module.id as usize + 1, || None);
            }
            modules[module.id as usize] = Some((path, OnceLock::new()));
        }
        Library { modules }
    }

    fn embedded() -> &'static Library {
        static LIBRARY: OnceLock<Library> = OnceLock::new();
        LIBRARY.get_or_init(Library::new)
    }

    fn look_at(&self, id: u32, look_at: &dyn Fn(&[u8], &[u8]) -> FoundInFile) {
        let Some(Some((path, module))) = self.modules.get(id as usize) else {
            return;
        };
        module.get_or_init(|| {
            let Some(text) = Archive::read(path) else {
                return LibraryModule::default();
            };
            let mut file = look_at(path, &text);
            // Their uses test a byte anyway, so an open one costs a lock at the start and no code.
            (file.members).retain(|&member| is_constant_unless_written(member));
            let manifest = Archive::embedded().manifest();
            let names = file.files_named.iter().chain(&file.other_modules_named);
            LibraryModule {
                builtins_exported: file.builtins_exported.exported,
                writes: file.members,
                names: names
                    .filter_map(|name| manifest.resolve(name, path))
                    .collect(),
            }
        });
    }

    fn is_unseen(&self, id: u32) -> bool {
        matches!(self.modules.get(id as usize), Some(Some(module)) if module.1.get().is_none())
    }

    fn seen(&self, id: u32) -> Option<&LibraryModule> {
        self.modules.get(id as usize)?.as_ref()?.1.get()
    }

    fn module(&self, id: u32) -> Option<&LibraryModule> {
        if self.is_unseen(id) {
            look_at_files(&mut |look_at| self.look_at(id, look_at));
        }
        self.seen(id)
    }

    /// How many of `unseen` a thread looks at one after another, and how many such lots there are.
    fn divide(unseen: &[u32], threads: usize) -> (usize, usize) {
        const FILES_LOOKED_AT_TOGETHER: usize = 16;
        let together = unseen.len().div_ceil(threads.max(1));
        let together = together.clamp(1, FILES_LOOKED_AT_TOGETHER);
        (together, unseen.len().div_ceil(together))
    }

    fn look_at_lot(&self, unseen: &[u32], together: usize, lot: usize) {
        look_at_files(&mut |look_at| {
            for &id in unseen.iter().skip(lot * together).take(together) {
                self.look_at(id, look_at);
            }
        });
    }

    /// The modules and all that they load.
    fn look_at_all_loaded_by(&self, caches: &ThreadCaches, threads: usize, modules: &[u32]) {
        let mut walk = WalkOfLibrary::default();
        walk.add(modules.iter().copied());
        loop {
            let unseen = walk.find_unseen(self);
            if unseen.is_empty() {
                break;
            }
            let (together, lots) = Library::divide(&unseen, threads);
            for_each_parallel_in_runs(caches, threads, lots, 1, &|lot| {
                self.look_at_lot(&unseen, together, lot);
            });
        }
    }

    /// How many have been looked at, and how many there are.
    fn count(&self) -> (usize, usize) {
        let modules = self.modules.iter().flatten();
        let seen = modules.clone().filter(|it| it.1.get().is_some());
        (seen.count(), modules.count())
    }
}

/// From the modules that are named to all that they load. What a module loads shows once it has been looked at, so the walk goes on in steps.
#[derive(Default)]
struct WalkOfLibrary {
    reached: FxHashSet<u32>,
    /// What they load has not been followed.
    pending: Vec<u32>,
}

impl WalkOfLibrary {
    fn add(&mut self, modules: impl Iterator<Item = u32>) {
        for module in modules {
            if self.reached.insert(module) {
                self.pending.push(module);
            }
        }
    }

    /// Follows all that has been looked at. What is left is to be looked at next.
    fn find_unseen(&mut self, library: &Library) -> Vec<u32> {
        let mut unseen = Vec::new();
        while let Some(id) = self.pending.pop() {
            match library.seen(id) {
                Some(module) => self.add(module.names.iter().copied()),
                None if library.is_unseen(id) => unseen.push(id),
                None => {}
            }
        }
        self.pending.clone_from(&unseen);
        unseen
    }
}

fn find_id_in_library(name: &[u8]) -> Option<u32> {
    let manifest = Archive::embedded().manifest();
    manifest.module_by_specifier(table::specifier_of(find_module_named(name)?))
}

/// What the modules of Bun that the files name write on built-in objects, they and what they load: `globalThis.console = new Console(..)` in node:worker_threads,
/// `delete ffi.closeCallback` in bun:ffi. A build that does not see who names the module does not hold it, or holds it and follows nobody into it, and would lock the member at its start.
fn find_what_library_writes(
    library: &Library,
    caches: &ThreadCaches,
    threads: usize,
    named: &[Vec<u8>],
) -> Vec<u32> {
    let named = named.iter();
    let mut pending: Vec<u32> = named.filter_map(|name| find_id_in_library(name)).collect();
    library.look_at_all_loaded_by(caches, threads, &pending);
    let mut seen: FxHashSet<u32> = pending.iter().copied().collect();
    let mut writes = Vec::new();
    while let Some(id) = pending.pop() {
        let Some(module) = library.seen(id) else {
            continue;
        };
        writes.extend_from_slice(&module.writes);
        pending.extend(module.names.iter().filter(|&&name| seen.insert(name)));
    }
    writes
}

/// Code that the build has not seen may start a Worker, and node:worker_threads then runs from its text.
pub(crate) fn find_what_starting_worker_writes() -> Vec<u32> {
    let manifest = Archive::embedded().manifest();
    let id = find_module_named(b"node:worker_threads")
        .and_then(|module| manifest.module_by_specifier(table::specifier_of(module)));
    let mut modules = manifest.modules().iter();
    let path = modules
        .find(|module| Some(module.id) == id)
        .and_then(|module| module.path.as_deref());
    let Some((path, text)) = path.and_then(|path| Some((path, Archive::read(path)?))) else {
        return Vec::new();
    };
    let mut writes = Vec::new();
    look_at_files(&mut |look_at| writes = look_at(path, &text).members);
    writes.retain(|&member| is_constant_unless_written(member));
    writes
}

/// A package that a preload imports may call `expect.extend()` with an object whose names only the flow analysis of its layer reads: that layer would be built twice.
/// Test files alone call matchers, so a build that takes all of them for replaced loses nothing.
pub(crate) fn find_what_adding_matchers_writes() -> Vec<u32> {
    let holders = table::HOLDERS_OF_MATCHERS.into_iter();
    let members = holders.flat_map(members_written_under_any_name);
    members.map(|member| member as u32).collect()
}

pub(crate) fn without_extension(path: &[u8]) -> &[u8] {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mts", b".mjs", b".cts", b".cjs",
    ];
    let stem = EXTENSIONS.iter().find_map(|end| path.strip_suffix(*end));
    stem.unwrap_or(path)
}

/// Code that a file holds as text runs where somebody loads the file that it was written to, or evaluates it. Whoever does has the path or the text from its holder: it is the
/// holder, a helper of the holder, or a file that the holder is a helper of. So a text counts where one test file reaches both its holder and a file that can run code which no
/// build has seen. The code under test cannot, where it does what it does in the executable; where it is read as the tests are, every text counts.
fn settle_texts(
    found: &mut FoundInTests,
    test_files: &[Vec<u8>],
    product: ProductFiles,
    is_beside_test_files: &dyn Fn(&[u8]) -> bool,
) {
    let files = core::mem::take(&mut found.files_with_texts);
    let mut by_name: FxHashMap<&[u8], Vec<usize>> = FxHashMap::default();
    for (index, file) in files.iter().enumerate() {
        let same_name = by_name.entry(without_extension(&file.path)).or_default();
        same_name.push(index);
    }
    let find = |name: &[u8]| {
        let as_file = by_name.get(without_extension(name));
        as_file.or_else(|| by_name.get(&[name, b"/index"].concat()[..]))
    };
    let mut counts = vec![product == ProductFiles::AreReadAsTestsAre; files.len()];
    // The number of the test file that reached it last, from 1.
    let mut reached_from = vec![0; files.len()];
    let mut reached_with_runner: Vec<usize> = Vec::new();
    for (number, test_file) in (1..).zip(test_files) {
        let mut pending: Vec<usize> = find(test_file).cloned().unwrap_or_default();
        let mut reached: Vec<usize> = Vec::new();
        let mut may_run_unseen_code = false;
        while let Some(index) = pending.pop() {
            if core::mem::replace(&mut reached_from[index], number) == number {
                continue;
            }
            reached.push(index);
            may_run_unseen_code |= files[index].runs_unseen_code;
            for name in &files[index].files_named {
                match find(name) {
                    Some(named) => pending.extend(named),
                    // A helper that nobody has read may do anything, and so may a file that is not there yet.
                    None => may_run_unseen_code |= is_beside_test_files(name),
                }
            }
        }
        if may_run_unseen_code {
            reached_with_runner.extend(reached);
        }
    }
    for index in reached_with_runner {
        counts[index] = true;
    }
    // A preload, and whatever else no test file names, is there beside every test file.
    let is_beside_all = |index: usize| reached_from[index] == 0;
    let any_runs = files.iter().any(|file| file.runs_unseen_code);
    let one_beside_all_runs =
        (0..files.len()).any(|it| is_beside_all(it) && files[it].runs_unseen_code);
    let mut left_out = 0;
    let (count, runners) = (
        files.len(),
        files.iter().filter(|it| it.runs_unseen_code).count(),
    );
    let runners_beside_all = (0..count)
        .filter(|&it| is_beside_all(it) && files[it].runs_unseen_code)
        .count();
    for (index, file) in files.into_iter().enumerate() {
        let holds_text = file.left_open_by_text != LeftOpenByText::Nothing
            || !file.names_spied_in_text.is_empty()
            || !file.modules_replaced_in_text.is_empty();
        if !(counts[index] || one_beside_all_runs || is_beside_all(index) && any_runs) {
            left_out += usize::from(holds_text);
            continue;
        }
        found.names_spied_in_text.extend(file.names_spied_in_text);
        (found.modules_replaced_in_text).extend(file.modules_replaced_in_text);
        found.left_open_by_text = (found.left_open_by_text).max(file.left_open_by_text);
    }
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | files that hold code as text which nothing near them can run {} | of {} files read {} can run code that no build has seen, {} of them beside every test file",
            left_out,
            count,
            runners,
            runners_beside_all,
        );
    }
}

/// `test_files`: what the runner runs as test files. `others`: the preloads, and whatever else the build begins at.
/// `reached_by_preloads_alone`: files of the project that the preloads load and no test file reaches. They are the tests' own wherever they lie, and only
/// who has walked the imports knows them: a build that sees the files finds them behind its load.
/// The names that a file writes are followed as long as the file is the tests' own: `FoundInFile::is_of_tests`, however far from a test file it stands. What such
/// a file names is looked at. Behind that lies the code under test, which every build sees.
/// `resolve`: as for `find_what_tests_replace`. Without it a helper is found under a relative name alone.
pub(crate) fn scan_files_of_tests(
    test_files: &[Vec<u8>],
    others: &[Vec<u8>],
    reached_by_preloads_alone: &[Vec<u8>],
    threads: usize,
    reads_library: ReadsLibrary,
    product: ProductFiles,
    mut resolve: Option<&mut dyn FnMut(&[u8], &[u8], bool) -> Option<Vec<u8>>>,
) -> FoundInTests {
    let started = std::time::Instant::now();
    let caches = ThreadCaches::default();
    let mut found: Guarded<FoundInTests> = Guarded::new(FoundInTests::default());
    let working_directory = match bun_core::getcwd(&mut path_buffer_pool::get()) {
        Ok(directory) => directory.as_bytes().to_vec(),
        Err(_) => Vec::new(),
    };
    let others = [others, reached_by_preloads_alone].concat();
    let others = &others[..];
    let reached_by_preloads_alone: FxHashSet<&[u8]> = (reached_by_preloads_alone.iter())
        .map(Vec::as_slice)
        .collect();
    let mut seen: FxHashSet<Vec<u8>> = test_files.iter().chain(others).cloned().collect();
    let is_test_file: FxHashSet<&[u8]> = test_files.iter().map(Vec::as_slice).collect();
    let others = others
        .iter()
        .filter(|path| !is_test_file.contains(path.as_slice()));
    let mut paths: Vec<Vec<u8>> = test_files.iter().chain(others).cloned().collect();
    let count_at_start = paths.len();
    let begins_at: FxHashSet<Vec<u8>> = paths.iter().cloned().collect();
    let folders_of_test_files: FxHashSet<&[u8]> = (test_files.iter())
        .map(|path| dirname::<platform::Auto>(path))
        .collect();
    let is_beside_test_files = |path: &[u8]| {
        if reached_by_preloads_alone.contains(path) {
            return true;
        }
        let mut folder = dirname::<platform::Auto>(path);
        loop {
            if folders_of_test_files.contains(folder) {
                return true;
            }
            let above = dirname::<platform::Auto>(folder);
            if above.len() >= folder.len() {
                return false;
            }
            folder = above;
        }
    };
    // "@/test/tracker": a name that the tsconfig.json of the project gives to a file. The folder of the file that writes it decides which tsconfig.json that is.
    let mut files_under_other_names: FxHashMap<WrittenModule, Option<Vec<u8>>> =
        FxHashMap::default();
    let mut find_file_named_otherwise = |module: WrittenModule, lies_in_package: bool| {
        let resolve = resolve.as_mut()?;
        let asked_from_folder = WrittenModule {
            importer: dirname::<platform::Auto>(&module.importer).to_vec(),
            specifier: module.specifier,
        };
        let answer = files_under_other_names
            .entry(asked_from_folder)
            .or_insert_with_key(|asked| {
                resolve(&module.importer, &asked.specifier, false).filter(|path| is_absolute(path))
            });
        // "@/src/main" is the code under test, which every build sees.
        answer.clone().filter(|path| match lies_in_package {
            true => is_in_node_modules(path),
            false => !is_in_node_modules(path) && is_beside_test_files(path),
        })
    };
    // `silence(console, levels())` with `silence` out of a package that is there to help the tests. Of such a file only what it does to its parameters counts.
    let mut helpers_in_packages: FxHashSet<Vec<u8>> = FxHashSet::default();
    // `import { File } from "parts"; File.prototype.text = f` with `export const File = globalThis.File` in the package. Of such a file only what it exports counts.
    let mut exporters_in_packages: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut written_on_under_other_names: Guarded<Vec<WrittenModule>> = Guarded::new(Vec::new());
    let mut texts_passed_under_other_names: Guarded<Vec<(WrittenModule, Vec<u8>)>> =
        Guarded::new(Vec::new());
    let mut writes_under_other_names: Guarded<Vec<(WrittenModule, Vec<Vec<u8>>, Vec<u8>)>> =
        Guarded::new(Vec::new());
    let mut builtins_passed_under_other_names: Guarded<Vec<(WrittenModule, u32)>> =
        Guarded::new(Vec::new());
    let mut known_by_folder_alone: FxHashSet<Vec<u8>> = FxHashSet::default();
    let mut between_files = BuiltinsBetweenFiles::default();
    // A build that sees the files follows them into the library by itself.
    if reads_library == ReadsLibrary::Yes {
        between_files.library = Some(Library::embedded());
    }
    let mut loading: Vec<LoadingFile> = Vec::new();
    // `seen` holds names as they are spelled: "./a" and "./a.js" in the files that import a.ts. Where a build hands over every file above
    // it, each is named by the others, and would be parsed and analyzed once more under each spelling. What is kept under the
    // spelling that a file was asked for by is looked up without the extension, so a second look under a spelling that differs in
    // nothing else adds only doubles. "./d" for d/index.ts is another matter. The files that the rounds before this one have looked
    // at, each with the spelling: `key_of_look`.
    let mut looked_at: FxHashSet<Vec<u8>> = FxHashSet::default();
    let key_of_look =
        |path: &[u8], asked_for: &[u8]| [path, b"\0", without_extension(asked_for)].concat();
    let (looks, names_passed_over) = (AtomicUsize::new(0), AtomicUsize::new(0));
    let mut reads_again = false;
    let mut is_first_round = true;
    let (mut walk_of_library, mut names_walked_from) = (WalkOfLibrary::default(), 0);
    loop {
        // What the modules of Bun that the files have named so far load is looked at beside the files of this round: behind the last round few threads would have work.
        let of_library = between_files.library.map(|library| {
            let found = found.lock();
            let named = found.library_modules_named[names_walked_from..].iter();
            walk_of_library.add(named.filter_map(|name| find_id_in_library(name)));
            names_walked_from = found.library_modules_named.len();
            (library, walk_of_library.find_unseen(library))
        });
        let mut newly_looked_at: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
        let mut exporting_found: Guarded<Vec<ExportingFile>> = Guarded::new(Vec::new());
        let mut loading_found: Guarded<Vec<LoadingFile>> = Guarded::new(Vec::new());
        let mut texts_found = Guarded::new(Vec::new());
        let mut named: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
        let mut named_otherwise: Guarded<Vec<WrittenModule>> = Guarded::new(Vec::new());
        let mut lying_in_named_folders: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
        let mut exported_again_in_packages: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
        let look_at_one = |asked_for: &[u8], look_at: &dyn Fn(&[u8], &[u8]) -> FoundInFile| {
            let is_looked_at =
                |path: &[u8]| !reads_again && looked_at.contains(&key_of_look(path, asked_for));
            let Some(file_named) = read_file_named(asked_for, &is_looked_at) else {
                let files = find_files_in_folder(asked_for).into_iter();
                // `new URL("./", import.meta.url)` is the folder of the test file itself, and no test file loads another.
                let files = files
                    .filter(|it| is_beside_test_files(it) && !is_test_file.contains(it.as_slice()));
                lying_in_named_folders.lock().extend(files);
                return;
            };
            let FileNamed::Read { path, text } = file_named else {
                names_passed_over.fetch_add(1, Ordering::Relaxed);
                return;
            };
            looks.fetch_add(1, Ordering::Relaxed);
            let mut file = look_at(&path, &text);
            let is_followed = file.is_of_tests || begins_at.contains(asked_for);
            let is_helper_in_package = helpers_in_packages.contains(asked_for);
            let is_exporter_in_package = exporters_in_packages.contains(asked_for);
            if is_helper_in_package || is_exporter_in_package {
                let whole = core::mem::take(&mut file);
                file.writes_on_parameters_under_any_name =
                    is_helper_in_package && whole.writes_on_parameters_under_any_name;
                if is_exporter_in_package {
                    file.builtins_exported = BuiltinsOfModule {
                        exported: whole.builtins_exported.exported,
                        object_is_default: whole.builtins_exported.object_is_default,
                        ..BuiltinsOfModule::default()
                    };
                    file.builtins_handed_out = whole.builtins_handed_out;
                    file.names_exported_again = whole.names_exported_again;
                    file.modules_exported_again = whole.modules_exported_again;
                }
            }
            let is_known_by_folder_alone = known_by_folder_alone.contains(asked_for);
            if !is_known_by_folder_alone {
                newly_looked_at.lock().push(key_of_look(&path, asked_for));
            }
            // Whether the run loads it nobody knows. What it spells counts; what it leaves open does not open the run.
            if is_known_by_folder_alone {
                file.any_module = false;
                file.hands_on_any = false;
                file.spies_on_unknown_objects = false;
                file.left_open_by_text = LeftOpenByText::Nothing;
                file.left_open_by_text_handed_on = LeftOpenByText::Nothing;
                file.loads_by_unknown_path = false;
                file.runs_unseen_code = false;
                file.spies_under_names_from_outside = false;
                file.writes_on_parameters_under_any_name = false;
                file.holders_named_from_outside = Vec::new();
                file.evicts_any = false;
            }
            let written = |specifier: Vec<u8>| WrittenModule {
                importer: path.clone(),
                specifier,
            };
            let exported_again = file.names_exported_again.iter().map(|it| &it.1);
            let exported_again: Vec<Vec<u8>> = exported_again
                .chain(&file.modules_exported_again)
                .cloned()
                .collect();
            let texts = core::mem::take(&mut file.builtins_exported.texts);
            let folder = core::mem::take(&mut file.builtins_exported.folder);
            if !texts.is_empty() {
                let key = key_of_file(&path).to_vec();
                texts_found.lock().push((key, (folder, texts)));
            }
            if !file.builtins_exported.exported.is_empty()
                || !file.builtins_exported.file_changers.is_empty()
                || !exported_again.is_empty()
            {
                exporting_found.lock().push(ExportingFile {
                    path: path.clone(),
                    builtins: core::mem::take(&mut file.builtins_exported),
                    again: ExportedAgain {
                        names: file.names_exported_again.clone(),
                        modules: file.modules_exported_again.clone(),
                    },
                });
            }
            // What a module of Bun exports is known from the start.
            let mut names_loaded = core::mem::take(&mut file.names_loaded);
            names_loaded.retain(|loaded| find_module_named(&loaded.0).is_none());
            let asked = core::mem::take(&mut file.asked_of_other_files);
            if !names_loaded.is_empty() {
                loading_found.lock().push(LoadingFile {
                    asked_for: asked_for.to_vec(),
                    told_of: between_files.count_for(&path, &names_loaded, &asked),
                    path: path.clone(),
                    names_loaded,
                    asked,
                });
            }
            {
                let mut found = found.lock();
                found.members.extend(file.members);
                found.names_added.extend(file.names_added);
                found.modules.extend(file.modules.into_iter().map(written));
                (found.modules_named_by_plugins).extend(file.modules_named_by_plugins);
                found
                    .handed_on
                    .extend(file.handed_on.into_iter().map(written));
                found.hands_on_any |= file.hands_on_any;
                let exports = file.exports.into_iter();
                (found.exports).extend(exports.map(|(module, name)| (written(module), name)));
                if (file.any_module || file.hands_on_any) && logs_stages() {
                    bun_core::print_errorln!(
                        "AOT test run | {} {} a module that it does not spell",
                        bstr::BStr::new(&path),
                        match file.any_module {
                            true => "mocks",
                            false => "hands on",
                        },
                    );
                }
                found.any_module |= file.any_module;
                if file.spies_on_unknown_objects && logs_stages() {
                    bun_core::print_errorln!(
                        "AOT test run | {} lets spyOn go where nobody sees what it is called with",
                        bstr::BStr::new(&path),
                    );
                }
                found.spies_on_unknown_objects |= file.spies_on_unknown_objects;
                (found.names_spied_on_unknown_objects).extend(file.names_spied_on_unknown_objects);
                // The code under test does what it does in the executable, which loads no code from disk and has no test runner: a text that it holds is no code of the
                // tests. Nor does a path get from a test file to a helper through it.
                let is_closed = file.is_of_product && product == ProductFiles::ReplaceNothing;
                if is_closed {
                    file.names_spied_in_text = Vec::new();
                    file.modules_replaced_in_text = Vec::new();
                    file.left_open_by_text = LeftOpenByText::Nothing;
                    file.names_spied_in_text_handed_on = Vec::new();
                    file.modules_replaced_in_text_handed_on = Vec::new();
                    file.left_open_by_text_handed_on = LeftOpenByText::Nothing;
                }
                let left_open = (file.left_open_by_text).max(file.left_open_by_text_handed_on);
                let holds_such_text = left_open != LeftOpenByText::Nothing;
                if holds_such_text && logs_stages() {
                    bun_core::print_errorln!(
                        "AOT test run | {} holds code in a string that spies under a name that nobody reads | it loads by a path that nobody reads itself {}",
                        bstr::BStr::new(&path),
                        file.loads_by_unknown_path,
                    );
                }
                found.loads_by_unknown_path |= file.loads_by_unknown_path;
                (found.names_spied_in_text).extend(file.names_spied_in_text_handed_on);
                (found.modules_replaced_in_text).extend(file.modules_replaced_in_text_handed_on);
                found.left_open_by_text =
                    (found.left_open_by_text).max(file.left_open_by_text_handed_on);
                let folder = dirname::<platform::Auto>(&path);
                let mut buffer = path_buffer_pool::get();
                let mut whole = |name: &Vec<u8>| {
                    let parts = &[&name[..]];
                    join_abs_string_buf_checked::<platform::Auto>(folder, &mut buffer[..], parts)
                        .map(<[u8]>::to_vec)
                };
                let files_named = file.files_named.iter().filter(|_| !is_closed);
                found.files_with_texts.push(FileWithTexts {
                    files_named: files_named.filter_map(&mut whole).collect(),
                    path: path.clone(),
                    runs_unseen_code: file.runs_unseen_code && !is_closed,
                    names_spied_in_text: core::mem::take(&mut file.names_spied_in_text),
                    modules_replaced_in_text: core::mem::take(&mut file.modules_replaced_in_text),
                    left_open_by_text: file.left_open_by_text,
                });
                found.evicted.extend(file.evicted.into_iter().map(written));
                for changed in file.changed_on_disk {
                    let folder = match changed.starts_at_own_directory {
                        true => dirname::<platform::Auto>(&path),
                        false => &working_directory[..],
                    };
                    let mut buffer = path_buffer_pool::get();
                    let whole = Some(folder).filter(|folder| is_absolute(folder));
                    let whole = whole.and_then(|folder| {
                        let parts = &[&changed.path[..]];
                        join_abs_string_buf_checked::<platform::Auto>(
                            folder,
                            &mut buffer[..],
                            parts,
                        )
                    });
                    let below = whole.filter(|_| changed.reaches_below);
                    (found.paths_changed_on_disk).extend(below.map(|it| [it, b"/"].concat()));
                    (found.paths_changed_on_disk).extend(whole.map(<[u8]>::to_vec));
                }
                let throwers = file.required_where_throws_are_caught.into_iter();
                (found.required_where_throws_are_caught).extend(throwers.map(written));
                let typed = file.imported_with_types.into_iter();
                found.imported_with_types.extend(typed.map(written));
                if (file.evicts_any || file.names_file_with_query) && logs_stages() {
                    bun_core::print_errorln!(
                        "AOT test run | {} {}",
                        bstr::BStr::new(&path),
                        match file.evicts_any {
                            true =>
                                "takes a file out of require.cache that it does not spell, hands the table on, or names Bun.plugin",
                            false => "loads a file under a query",
                        },
                    );
                }
                found.evicts_any |= file.evicts_any;
                found.names_file_with_query |= file.names_file_with_query;
                let imported = file.imported_by_statements.into_iter();
                found.imported_by_statements.extend(imported.map(written));
                let imported = file.imported_by_calls.into_iter();
                found.imported_by_calls.extend(imported.map(written));
                found
                    .required
                    .extend(file.required.into_iter().map(written));
                if !file.names_exported_again.is_empty() || !file.modules_exported_again.is_empty()
                {
                    let again = ExportedAgain {
                        names: file.names_exported_again,
                        modules: file.modules_exported_again,
                    };
                    found.exported_again.insert(path.clone(), again);
                }
                let names_vitest = file.other_modules_named.iter().any(|it| it == b"vitest");
                found.entry_point_imports_vitest |= is_first_round && names_vitest;
                let (of_library, others): (Vec<Vec<u8>>, Vec<Vec<u8>>) =
                    (file.other_modules_named.into_iter())
                        .partition(|name| find_module_named(name).is_some());
                found.library_modules_named.extend(of_library);
                if file.is_of_product {
                    let named = others.iter().cloned().map(written);
                    found.packages_named_by_product.extend(named);
                } else if !file.imports_test_runner && !is_test_file.contains(path.as_slice()) {
                    let named = others.iter().cloned().map(written);
                    found.packages_named_beside_tests.extend(named);
                }
                // The code under test names packages by the thousand. A helper lies beside the test files.
                if is_beside_test_files(&path) {
                    named_otherwise
                        .lock()
                        .extend(others.into_iter().map(written));
                }
                if file.spies_under_names_from_outside {
                    found.spy_under_names_from_outside.push(asked_for.to_vec());
                }
                if file.writes_on_parameters_under_any_name {
                    (found.write_on_parameters_under_any_name).push(asked_for.to_vec());
                }
                if !file.holders_named_from_outside.is_empty() {
                    let holders = (asked_for.to_vec(), file.holders_named_from_outside);
                    found.holders_named_from_outside.push(holders);
                }
            }
            let directory = dirname::<platform::Auto>(&path);
            if !is_absolute(directory) {
                return;
            }
            let mut buffer = path_buffer_pool::get();
            let mut join = |name: &[u8]| {
                let joined = join_abs_string_buf_checked::<platform::Auto>(
                    directory,
                    &mut buffer[..],
                    &[name],
                );
                joined.filter(|_| is_relative(name)).map(<[u8]>::to_vec)
            };
            let exported_again: Vec<Vec<u8>> = exported_again
                .iter()
                .filter_map(|name| join(name))
                .collect();
            if is_exporter_in_package {
                (exported_again_in_packages.lock()).extend(exported_again.iter().cloned());
            }
            if !file.builtins_handed_out.is_empty() || !exported_again.is_empty() {
                let handed_out = (asked_for.to_vec(), file.builtins_handed_out, exported_again);
                found.lock().builtins_handed_out.push(handed_out);
            }
            for (name, names, key) in file.writes_on_imports {
                match join(&name) {
                    Some(joined) => found.lock().writes_on_imports.push((joined, names, key)),
                    None if !is_relative(&name) && is_beside_test_files(&path) => {
                        let write = (written(name), names, key);
                        writes_under_other_names.lock().push(write);
                    }
                    None => {}
                }
            }
            if is_beside_test_files(&path) {
                let written_on = file.modules_written_on.into_iter();
                let written_on = written_on.filter(|name| !is_relative(name)).map(written);
                written_on_under_other_names.lock().extend(written_on);
            }
            for (name, holder) in file.builtins_passed {
                match join(&name) {
                    Some(joined) => found.lock().builtins_passed.push((joined, holder)),
                    None if !is_relative(&name) && is_beside_test_files(&path) => {
                        let passed = (written(name), holder);
                        builtins_passed_under_other_names.lock().push(passed);
                    }
                    None => {}
                }
            }
            for (name, text) in file.texts_passed {
                if !is_relative(&name) {
                    if is_beside_test_files(&path) {
                        let passed = (written(name), text);
                        texts_passed_under_other_names.lock().push(passed);
                    }
                    continue;
                }
                let joined = join_abs_string_buf_checked::<platform::Auto>(
                    directory,
                    &mut buffer[..],
                    &[&name],
                );
                if let Some(joined) = joined {
                    found.lock().texts_passed.push((joined.to_vec(), text));
                }
            }
            if !is_followed || is_in_node_modules(&path) {
                return;
            }
            for name in &file.files_named {
                let joined = join_abs_string_buf_checked::<platform::Auto>(
                    directory,
                    &mut buffer[..],
                    &[name],
                );
                named.lock().extend(joined.map(<[u8]>::to_vec));
            }
        };
        // The table of the names of built-ins is made once for the files that are looked at together, and takes as long as several
        // of them. Few files still spread over the threads. Of many a thread gets eight lots or more, so that none waits long for the
        // last, and what a lot has parsed is freed with it.
        let files_looked_at_together = (paths.len() / (threads.max(1) * 8)).clamp(16, 64);
        let runs = paths.len().div_ceil(files_looked_at_together);
        let (modules_looked_at_together, lots_of_library) = match &of_library {
            Some((_, unseen)) => Library::divide(unseen, threads),
            None => (0, 0),
        };
        for_each_parallel_in_runs(&caches, threads, lots_of_library + runs, 1, &|run| {
            let Some(run) = run.checked_sub(lots_of_library) else {
                if let Some((library, unseen)) = &of_library {
                    library.look_at_lot(unseen, modules_looked_at_together, run);
                }
                return;
            };
            let find_builtins =
                |importer: &[u8], specifier: &[u8]| between_files.find(importer, specifier);
            look_at_files_of_run(
                &is_beside_test_files,
                product,
                &find_builtins,
                &mut |look_at| {
                    for written in paths
                        .iter()
                        .skip(run * files_looked_at_together)
                        .take(files_looked_at_together)
                    {
                        look_at_one(written, look_at);
                    }
                },
            );
        });
        looked_at.extend(core::mem::take(newly_looked_at.get_mut()));
        paths = core::mem::take(named.get_mut());
        let others = core::mem::take(named_otherwise.get_mut()).into_iter();
        paths.extend(others.filter_map(|module| find_file_named_otherwise(module, false)));
        paths.retain(|path| seen.insert(path.clone()));
        for (module, _) in builtins_passed_under_other_names.get_mut().iter() {
            if let Some(path) = find_file_named_otherwise(module.clone(), true)
                && seen.insert(path.clone())
            {
                helpers_in_packages.insert(path.clone());
                paths.push(path);
            }
        }
        let written_on = core::mem::take(written_on_under_other_names.get_mut()).into_iter();
        let written_on: Vec<Vec<u8>> = written_on
            .filter_map(|module| find_file_named_otherwise(module, true))
            .collect();
        let exported_again = core::mem::take(exported_again_in_packages.get_mut());
        for path in written_on.into_iter().chain(exported_again) {
            exporters_in_packages.insert(path.clone());
            if seen.insert(path.clone()) {
                paths.push(path);
            }
        }
        let mut lying_in_named_folders = core::mem::take(lying_in_named_folders.get_mut());
        lying_in_named_folders.retain(|path| seen.insert(path.clone()));
        known_by_folder_alone.extend(lying_in_named_folders.iter().cloned());
        paths.extend(lying_in_named_folders);
        for file in core::mem::take(exporting_found.get_mut()) {
            between_files.add_exporting_file(file);
        }
        loading.append(loading_found.get_mut());
        (between_files.texts).extend(core::mem::take(texts_found.get_mut()));
        between_files.settle();
        is_first_round = false;
        if !paths.is_empty() {
            reads_again = false;
            continue;
        }
        // A file is read before the files that it loads. Now that those are read it is read once more where they export built-ins under the names that it takes,
        // and again where that makes it export one to a file that was read before.
        if between_files.visible.is_empty() && loading.iter().all(|file| file.asked.is_empty()) {
            break;
        }
        // "@/test/tools": what a file loads, and what a barrel exports again.
        let loaded = loading.iter().flat_map(|file| {
            let modules = file.names_loaded.iter().map(|loaded| &loaded.0);
            modules.map(|module| (&file.path, module))
        });
        let exported_again = between_files.exporting.values().flat_map(|file| {
            let modules = file.again.names.iter().map(|again| &again.1);
            let modules = modules.chain(&file.again.modules);
            modules.map(|module| (&file.path, module))
        });
        let mut under_other_names = Vec::new();
        for (path, specifier) in loaded.chain(exported_again) {
            if is_relative(specifier)
                || find_module_named(specifier).is_some()
                || !is_beside_test_files(path)
            {
                continue;
            }
            let name = (dirname::<platform::Auto>(path).to_vec(), specifier.clone());
            if between_files.under_other_names.contains_key(&name) {
                continue;
            }
            let module = WrittenModule {
                importer: path.clone(),
                specifier: specifier.clone(),
            };
            let file = find_file_named_otherwise(module.clone(), false).or_else(|| {
                find_file_named_otherwise(module, true)
                    .filter(|path| exporters_in_packages.contains(path))
            });
            under_other_names.extend(file.map(|path| (name, path)));
        }
        if !under_other_names.is_empty() {
            between_files.under_other_names.extend(under_other_names);
            between_files.settle();
        }
        let (read_again, read): (Vec<LoadingFile>, Vec<LoadingFile>) = (loading.into_iter())
            .partition(|file| {
                between_files.count_for(&file.path, &file.names_loaded, &file.asked) > file.told_of
            });
        loading = read;
        if read_again.is_empty() {
            break;
        }
        paths = read_again.into_iter().map(|file| file.asked_for).collect();
        reads_again = true;
    }
    let mut found = core::mem::take(found.get_mut());
    if !found.spy_under_names_from_outside.is_empty()
        || !found.holders_named_from_outside.is_empty()
    {
        for (module, text) in core::mem::take(texts_passed_under_other_names.get_mut()) {
            let file = find_file_named_otherwise(module, false);
            found.texts_passed.extend(file.map(|file| (file, text)));
        }
    }
    if !found.write_on_parameters_under_any_name.is_empty() {
        for (module, holder) in core::mem::take(builtins_passed_under_other_names.get_mut()) {
            let file = find_file_named_otherwise(module.clone(), false)
                .or_else(|| find_file_named_otherwise(module, true));
            (found.builtins_passed).extend(file.map(|file| (file, holder)));
        }
    }
    if !found.builtins_handed_out.is_empty() {
        for (module, path, key) in core::mem::take(writes_under_other_names.get_mut()) {
            let file = find_file_named_otherwise(module.clone(), false)
                .or_else(|| find_file_named_otherwise(module, true));
            (found.writes_on_imports).extend(file.map(|file| (file, path, key)));
        }
    }
    if let Some(library) = between_files.library {
        let named = &found.library_modules_named;
        let writes = find_what_library_writes(library, &caches, threads, named);
        found.members.extend(writes);
    }
    found.library_modules_named = Vec::new();
    drop_thread_caches(&caches);
    // `export const ofMath = () => new Proxy(Math, {})` in one file, `ofMath().max = f` in another.
    let handed_out = core::mem::take(&mut found.builtins_handed_out);
    let mut handed_out_by_file: FxHashMap<&[u8], Vec<usize>> = FxHashMap::default();
    for (index, file) in handed_out.iter().enumerate() {
        let files = handed_out_by_file.entry(without_extension(&file.0));
        files.or_default().push(index);
    }
    for (file, path, key) in core::mem::take(&mut found.writes_on_imports) {
        let mut files = handed_out_by_file
            .get(without_extension(&file))
            .cloned()
            .unwrap_or_default();
        let mut next = 0;
        while let Some(&index) = files.get(next) {
            next += 1;
            let (_, holders, exported_again) = &handed_out[index];
            for holder in holders.iter().filter_map(|&it| BuiltinId::from_wire(it)) {
                let path = path.iter().map(Vec::as_slice);
                let member = find_member_written_behind(holder, path, &key);
                found.members.extend(member.map(|member| member as u32));
            }
            for again in exported_again {
                let more = handed_out_by_file.get(without_extension(again));
                for &index in more.map_or(&[][..], Vec::as_slice) {
                    if !files.contains(&index) {
                        files.push(index);
                    }
                }
            }
        }
    }
    // `export function plant(name) { Object.prototype[name] = 1; }` in one file, `plant("polluted")` in another: every text that goes to the file may be the name.
    for (file, holders) in core::mem::take(&mut found.holders_named_from_outside) {
        let texts = (found.texts_passed.iter())
            .filter(|passed| without_extension(&passed.0) == without_extension(&file));
        let names: Vec<&Vec<u8>> = texts.map(|passed| &passed.1).collect();
        for holder in holders {
            let added = names.iter().map(|&name| OpenedName {
                holder,
                name: name.clone(),
            });
            found.names_added.extend(added);
        }
    }
    // `export function silence(target, names) { for (const name of names) target[name] = noop; }` in one file, `silence(console, levels())` in another.
    let passed = core::mem::take(&mut found.builtins_passed);
    for file in core::mem::take(&mut found.write_on_parameters_under_any_name) {
        let holders = (passed.iter())
            .filter(|passed| without_extension(&passed.0) == without_extension(&file))
            .filter_map(|passed| BuiltinId::from_wire(passed.1));
        for holder in holders {
            let members = members_written_under_any_name(holder);
            found.members.extend(members.map(|member| member as u32));
        }
    }
    // `export function watch(object, name) { return spyOn(object, name); }` in one file, `watch(holder, "read")` in another.
    for file in core::mem::take(&mut found.spy_under_names_from_outside) {
        // One file writes `./watch.js` for what another writes `./watch` and the disk holds as watch.ts.
        let texts = (found.texts_passed.iter())
            .filter(|passed| without_extension(&passed.0) == without_extension(&file));
        let names: Vec<Vec<u8>> = texts.map(|passed| passed.1.clone()).collect();
        // A build's own scan of its entry points asks for built-ins alone, and may not see who calls the helper.
        if logs_stages() && reads_library == ReadsLibrary::Yes {
            bun_core::print_errorln!(
                "AOT test run | {} spies on an object from somewhere under a name that it does not spell: {} texts are passed to it",
                bstr::BStr::new(&file),
                names.len(),
            );
        }
        // A name that nobody spells may be any name.
        found.spies_on_unknown_objects |= names.is_empty();
        found.names_spied_on_unknown_objects.extend(names);
    }
    found.texts_passed = Vec::new();
    settle_texts(&mut found, test_files, product, &is_beside_test_files);
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | scan of {} files and {} beside them | {} ms | sites: built-ins {} | names added {} | exports {} | modules {} | handed on {} | mocks any module {} | hands on any module {} | spies on objects from somewhere {}",
            count_at_start,
            seen.len() - count_at_start,
            started.elapsed().as_millis(),
            found.members.len(),
            found.names_added.len(),
            found.exports.len(),
            found.modules.len(),
            found.handed_on.len(),
            found.any_module,
            found.hands_on_any,
            found.spies_on_unknown_objects,
        );
        bun_core::print_errorln!(
            "AOT test run | the scan looked at {} texts | {} names led to a file that it had looked at under another",
            looks.load(Ordering::Relaxed),
            names_passed_over.load(Ordering::Relaxed),
        );
        if let Some(library) = between_files.library {
            let (seen, all) = library.count();
            bun_core::print_errorln!(
                "AOT test run | modules of Bun that a scan has looked at: {} of {}",
                seen,
                all,
            );
        }
        bun_core::Output::flush();
    }
    found
}

/// For a build that is made before any run is known: whatever the files of a run can replace.
#[cfg(not(test))]
pub(crate) fn everything_that_tests_replace() -> ReplacedByTests {
    ReplacedByTests {
        // The engine leaves out those that no test run replaces.
        builtins: BuiltinId::ALL.into_iter().map(|id| id as u32).collect(),
        any_module: true,
        hands_on_any_module: true,
        spies_on_unknown_objects: true,
        spy_may_meet_module_that_no_file_spells: true,
        evicts_any_module: true,
        ..ReplacedByTests::default()
    }
}

/// `resolve`: the path of the file that a file means with a specifier: in an import, or, with `true`, in `require()`. A package may name one file for each.
/// With `--isolate=modules` the test files share one `process`, and the runner lays a new list over `process.argv` and `Bun.argv` between them:
/// Bun__Process__resetArgv().
pub(crate) fn lists_laid_anew_between_test_files() -> Vec<u32> {
    let holders = [&b"process"[..], b"Bun"].into_iter();
    let lists = holders.filter_map(|holder| {
        find_member_written_behind(BuiltinId::GlobalThis, core::iter::once(holder), b"argv")
    });
    lists.map(|member| member as u32).collect()
}

pub(crate) fn find_what_tests_replace(
    test_files: &[Vec<u8>],
    preloads: &[Vec<u8>],
    reached_by_preloads_alone: &[Vec<u8>],
    threads: usize,
    product: ProductFiles,
    resolve: &mut dyn FnMut(&[u8], &[u8], bool) -> Option<Vec<u8>>,
) -> ReplacedByTests {
    let mut resolved: FxHashMap<(WrittenModule, bool), Option<Vec<u8>>> = FxHashMap::default();
    let mut resolve_once = |importer: &[u8], specifier: &[u8], is_for_require: bool| {
        let module = WrittenModule {
            importer: importer.to_vec(),
            specifier: specifier.to_vec(),
        };
        let answer = resolved
            .entry((module, is_for_require))
            .or_insert_with(|| resolve(importer, specifier, is_for_require));
        answer.clone()
    };
    let found = scan_files_of_tests(
        test_files,
        preloads,
        reached_by_preloads_alone,
        threads,
        ReadsLibrary::Yes,
        product,
        Some(&mut resolve_once),
    );
    // A module that nothing resolves is no file of any build.
    let mut resolve_for = |mut module: WrittenModule, is_for_require: bool| {
        // `mock.module("file:./a.ts", ..)`
        if let Some(path) = module.specifier.strip_prefix(b"file:")
            && (path.starts_with(b"./") || path.starts_with(b"../"))
        {
            module.specifier = path.to_vec();
        }
        // Under the one name that every build knows it by: "crypto" is "node:crypto".
        if let Some(module) = find_module_named(&module.specifier) {
            return Some(table::specifier_of(module).to_vec());
        }
        resolve_once(&module.importer, &module.specifier, is_for_require)
    };
    // The folder of the file that writes a name decides what it finds. A package may answer `require()` with another file than `import`.
    let mut asked: FxHashSet<(&[u8], &[u8])> = FxHashSet::default();
    let mut package_files_that_product_imports: Vec<Vec<u8>> = Vec::new();
    for module in &found.packages_named_by_product {
        if asked.insert((
            dirname::<platform::Auto>(&module.importer),
            &module.specifier,
        )) {
            let answers =
                [false, true].map(|is_for_require| resolve_for(module.clone(), is_for_require));
            let files = answers.into_iter().flatten();
            package_files_that_product_imports.extend(files.filter(|it| is_in_node_modules(it)));
        }
    }
    package_files_that_product_imports.shared_sort_unstable();
    package_files_that_product_imports.dedup();
    let mut package_files_imported_beside_tests: Vec<Vec<u8>> = Vec::new();
    for module in &found.packages_named_beside_tests {
        if asked.insert((
            dirname::<platform::Auto>(&module.importer),
            &module.specifier,
        )) {
            let answers =
                [false, true].map(|is_for_require| resolve_for(module.clone(), is_for_require));
            let files = answers.into_iter().flatten();
            package_files_imported_beside_tests.extend(files.filter(|it| is_in_node_modules(it)));
        }
    }
    package_files_imported_beside_tests.shared_sort_unstable();
    package_files_imported_beside_tests.dedup();
    // The keys of `require.cache` are what `require.resolve()` answers.
    let mut evicted_modules: Vec<Vec<u8>> = (found.evicted.into_iter())
        .filter_map(|module| resolve_for(module, true))
        .collect();
    // A file that the run writes anew is read from disk where something loads it afterwards, as one that was taken out of the table.
    evicted_modules.extend(found.paths_changed_on_disk);
    let mut files_required_where_throws_are_caught: Vec<Vec<u8>> =
        (found.required_where_throws_are_caught.into_iter())
            .filter_map(|module| resolve_for(module, true))
            .collect();
    files_required_where_throws_are_caught.shared_sort_unstable();
    files_required_where_throws_are_caught.dedup();
    let mut data_files_imported_with_types: Vec<Vec<u8>> = (found.imported_with_types.into_iter())
        .filter_map(|module| resolve_for(module, false))
        .collect();
    data_files_imported_with_types.shared_sort_unstable();
    data_files_imported_with_types.dedup();
    // How a file is loaded matters only beside an entry of the tests' own under the name of a module of the library.
    let stores_entry_of_library = evicted_modules.iter().any(|it| it.starts_with(b"node:"));
    let mut files_among = |modules: Vec<WrittenModule>, is_for_require: bool| -> Vec<Vec<u8>> {
        let modules = modules.into_iter().filter(|_| stores_entry_of_library);
        let mut files: Vec<Vec<u8>> = modules
            .filter(|module| find_module_named(&module.specifier).is_none())
            .filter_map(|module| resolve_for(module, is_for_require))
            .collect();
        files.shared_sort_unstable();
        files.dedup();
        files
    };
    let files_imported_by_statements = files_among(found.imported_by_statements, false);
    let files_imported_by_calls = files_among(found.imported_by_calls, false);
    let files_required = files_among(found.required, true);
    let mut resolve = |module: WrittenModule| resolve_for(module, false);
    // `bun test` takes it off the console before any file runs: GlobalObject::addBuiltinGlobals().
    let removed_by_runner =
        find_member_written_behind(BuiltinId::Console, core::iter::empty(), b"timeStamp");
    let mut replaced = ReplacedByTests {
        builtins: (found.members.into_iter())
            .chain(removed_by_runner.map(|member| member as u32))
            .collect(),
        names_added_to_builtins: (found.names_added.into_iter())
            .map(|added| (added.holder, added.name))
            .collect(),
        // `mock.module("vscode", ..)`: only its host has the module. It is on no disk, and a file of any of the builds may import it.
        modules: (found.modules.into_iter())
            .filter_map(|module| {
                let name = module.specifier.clone();
                let is_bare = !name.is_empty() && !matches!(name[0], b'.' | b'/');
                resolve(module).or_else(|| is_bare.then_some(name))
            })
            .collect(),
        exports: (found.exports.into_iter())
            .filter_map(|(module, name)| Some((resolve(module)?, name)))
            .collect(),
        any_module: found.any_module || found.left_open_by_text == LeftOpenByText::MocksOfAnyModule,
        handed_on_modules: found
            .handed_on
            .into_iter()
            .filter_map(&mut resolve)
            .collect(),
        hands_on_any_module: found.hands_on_any,
        names_spied_on_unknown_objects: found.names_spied_on_unknown_objects,
        // Code that is held as text and spies on what it is told is such a spy too, in a file that no build sees.
        spies_on_unknown_objects: found.spies_on_unknown_objects
            || found.left_open_by_text != LeftOpenByText::Nothing,
        spy_may_meet_module_that_no_file_spells: found.spies_on_unknown_objects
            && found.hands_on_any,
        names_spied_in_text: found.names_spied_in_text,
        modules_replaced_in_text: found.modules_replaced_in_text,
        loads_by_unknown_path: found.loads_by_unknown_path,
        evicted_modules,
        evicts_any_module: found.evicts_any,
        files_required_where_throws_are_caught,
        data_files_imported_with_types,
        files_imported_by_statements,
        files_imported_by_calls,
        files_required,
        names_file_with_query: found.names_file_with_query,
        // What the test files store stands among `builtins` and `exports`.
        stores_loader_functions: false,
        entry_point_imports_vitest: found.entry_point_imports_vitest,
        parameters_that_start_workers: Vec::new(),
        package_files_that_product_imports,
        modules_that_mocked_files_export_whole: Vec::new(),
        package_files_imported_beside_tests,
    };
    // `mock.module("./barrel.js", factory)` behind the load of the barrel stores what the factory gives into the variables of the files that declare the names, as a spy
    // does, and they may lie in another image than the barrel. Which names the factory gives is not known here, nor which names come through a star.
    let mut mocked = replaced.modules.clone();
    let mut seen_mocked: FxHashSet<Vec<u8>> = mocked.iter().cloned().collect();
    let count_of_exports = replaced.exports.len();
    while let Some(path) = mocked.pop() {
        let Some(again) = found.exported_again.get(&path) else {
            continue;
        };
        let written = |specifier: &Vec<u8>| WrittenModule {
            importer: path.clone(),
            specifier: specifier.clone(),
        };
        for (_, module, imported) in &again.names {
            let target = resolve(written(module));
            (replaced.exports).extend(target.map(|target| (target, imported.clone())));
        }
        for module in &again.modules {
            if let Some(target) = resolve(written(module))
                && seen_mocked.insert(target.clone())
            {
                (replaced.modules_that_mocked_files_export_whole).push(target.clone());
                mocked.push(target);
            }
        }
    }
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | the files that are mocked whole export again all of {} modules and {} names of others",
            replaced.modules_that_mocked_files_export_whole.len(),
            replaced.exports.len() - count_of_exports,
        );
    }
    // `spyOn(barrel, "f")` stores into the variable of the file that declares f, which may lie in another image than the barrel: every file on the way is told.
    let mut pending = replaced.exports.clone();
    let mut seen: FxHashSet<(Vec<u8>, Vec<u8>)> = pending.iter().cloned().collect();
    while let Some((path, name)) = pending.pop() {
        let Some(again) = found.exported_again.get(&path) else {
            continue;
        };
        let written = |specifier: &Vec<u8>| WrittenModule {
            importer: path.clone(),
            specifier: specifier.clone(),
        };
        let named = again.names.iter().filter(|it| it.0 == name);
        let named = named.map(|(_, module, imported)| (module, imported));
        // Which of them has the name is not known here.
        let through_stars = again.modules.iter().map(|module| (module, &name));
        for (module, name) in named.chain(through_stars) {
            if let Some(target) = resolve(written(module))
                && seen.insert((target.clone(), name.clone()))
            {
                replaced.exports.push((target.clone(), name.clone()));
                pending.push((target, name.clone()));
            }
        }
    }
    // The loader answers for such a name as it is written, whatever file it stands for. A build below is told the name beside the file.
    (replaced.modules).extend(found.modules_named_by_plugins);
    replaced.builtins.shared_sort_unstable();
    replaced.builtins.dedup();
    replaced.names_added_to_builtins.shared_sort_unstable();
    replaced.names_added_to_builtins.dedup();
    replaced.modules.shared_sort_unstable();
    replaced.modules.dedup();
    (replaced.modules_that_mocked_files_export_whole).shared_sort_unstable();
    replaced.evicted_modules.shared_sort_unstable();
    replaced.evicted_modules.dedup();
    replaced.handed_on_modules.shared_sort_unstable();
    replaced.handed_on_modules.dedup();
    (replaced.names_spied_on_unknown_objects).shared_sort_unstable();
    replaced.names_spied_on_unknown_objects.dedup();
    replaced.names_spied_in_text.shared_sort_unstable();
    replaced.names_spied_in_text.dedup();
    replaced.modules_replaced_in_text.shared_sort_unstable();
    replaced.modules_replaced_in_text.dedup();
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | code that the files of the tests hold as text spies on {} names and replaces {} modules | one of them loads by a path that nobody reads {}",
            replaced.names_spied_in_text.len(),
            replaced.modules_replaced_in_text.len(),
            replaced.loads_by_unknown_path,
        );
    }
    replaced.exports.shared_sort_unstable();
    replaced.exports.dedup();
    // The names of a module that is replaced whole say nothing more.
    let modules = &replaced.modules;
    let whole = &replaced.modules_that_mocked_files_export_whole;
    (replaced.exports).retain(|(module, _)| {
        modules.binary_search(module).is_err() && whole.binary_search(module).is_err()
    });
    if logs_stages() {
        let mut hasher = std::hash::DefaultHasher::new();
        format!("{replaced:?}").hash(&mut hasher);
        bun_core::print_errorln!(
            "AOT test run | all that the scan found, as one number: {:016x}",
            hasher.finish(),
        );
    }
    replaced
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::BuiltinId;

    #[test]
    fn looks_at_the_modules_of_bun_that_are_named_and_at_what_they_load() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let caches = ThreadCaches::default();
        let whole = Library::new();
        let every_id: Vec<u32> = (0..whole.modules.len() as u32).collect();
        whole.look_at_all_loaded_by(&caches, 2, &every_id);
        let all = whole.count().1;
        assert_eq!(whole.count(), (all, all));

        let library = Library::new();
        let runner = [b"bun:test".to_vec()];
        assert!(find_what_library_writes(&library, &caches, 2, &[]).is_empty());
        assert!(find_what_library_writes(&library, &caches, 2, &runner).is_empty());
        assert_eq!(library.count(), (0, all));

        for name in ["bun:ffi", "node:path", "node:worker_threads", "node:fs"] {
            let library = Library::new();
            let named = [name.as_bytes().to_vec()];
            let writes = find_what_library_writes(&library, &caches, 2, &named);
            let of_whole = find_what_library_writes(&whole, &caches, 2, &named);
            assert_eq!(writes, of_whole, "{name}");
            let seen = library.count().0;
            assert!(0 < seen && seen < all, "{name}: {seen} of {all}");
            let again = find_what_library_writes(&library, &caches, 2, &named);
            assert_eq!((again, library.count().0), (writes, seen), "{name}");
        }
        let writes = find_what_library_writes(&library, &caches, 2, &[b"bun:ffi".to_vec()]);
        for member in [
            BuiltinId::BunFFICallback,
            BuiltinId::BunFFICloseCallback,
            BuiltinId::BunFFICfunction,
        ] {
            assert!(writes.contains(&(member as u32)));
        }

        for id in every_id {
            let alone = Library::new();
            let (alone, among_all) = (alone.module(id), whole.seen(id));
            assert_eq!(alone.is_some(), among_all.is_some());
            let Some((alone, among_all)) = alone.zip(among_all) else {
                continue;
            };
            assert_eq!(alone.writes, among_all.writes);
            assert_eq!(alone.names, among_all.names);
            assert_eq!(alone.builtins_exported, among_all.builtins_exported);
        }
        drop_thread_caches(&caches);
    }

    #[test]
    fn puts_together_what_one_file_passes_and_another_writes_on_under_any_name() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-passed-{}", std::process::id()));
        let root = folder.clone().into_os_string().into_encoded_bytes();
        let files = [
            (
                "test/one.test.ts",
                r#"import { silence, spyAll } from "./helpers/write";
                import { defineUnder } from "@/test/helpers/named";
                import { list } from "./helpers/read.js";
                silence(Math, levels());
                spyAll(JSON, (name: string) => name.startsWith("p"));
                defineUnder(Atomics, pick(), 1);
                list(Reflect, levels());"#,
            ),
            (
                "test/helpers/write.ts",
                r#"import { spyOn } from "bun:test";
                export function silence(target: any, names: string[]) { for (const name of names) target[name] = () => {}; }
                export const spyAll = (target: any, wanted: any) => Object.getOwnPropertyNames(target).filter(wanted).map(name => spyOn(target, name));"#,
            ),
            (
                "test/helpers/named.ts",
                r#"export function defineUnder(target: any, key: string, value: unknown) { Object.defineProperty(target, key, { value }); }"#,
            ),
            (
                "test/helpers/read.ts",
                r#"export const list = (target: any, names: string[]) => names.map(name => target[name]);"#,
            ),
        ];
        for (name, text) in files {
            let path = folder.join(name);
            std::fs::create_dir_all(path.parent().expect("it lies in a folder"))
                .expect("the folder is made");
            std::fs::write(&path, text).expect("the file is written");
        }
        let file = [&root[..], b"/test/one.test.ts"].concat();
        let replaced = find_what_tests_replace(
            &[file],
            &[],
            &[],
            1,
            ProductFiles::AreReadAsTestsAre,
            &mut |importer, specifier, _| {
                let folder = dirname::<platform::Auto>(importer);
                match specifier.strip_prefix(b"@/") {
                    Some(rest) => Some([&root[..], b"/", rest, b".ts"].concat()),
                    None => Some([folder, b"/", specifier].concat()),
                }
            },
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        for member in [
            BuiltinId::MathMax,
            BuiltinId::MathMin,
            BuiltinId::JSONParse,
            BuiltinId::JSONStringify,
            BuiltinId::AtomicsLoad,
        ] {
            assert!(replaced.builtins.contains(&(member as u32)), "{member:?}");
        }
        // A helper that reads opens nothing, and neither does a built-in that nobody passes.
        assert!(!replaced.builtins.contains(&(BuiltinId::ReflectGet as u32)));
        assert!(!replaced.builtins.contains(&(BuiltinId::DateNow as u32)));
    }

    #[test]
    fn puts_together_what_one_file_hands_out_and_another_writes_on_it() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder =
            std::env::temp_dir().join(format!("bun-aot-handed-out-{}", std::process::id()));
        let root = folder.clone().into_os_string().into_encoded_bytes();
        let files = [
            (
                "test/one.test.ts",
                r#"import { ofMath, ofWeakRef, proxy } from "./helpers";
                import { ofAtomics } from "@/test/helpers/named";
                import { own } from "./helpers/own.js";
                ofMath().max = () => 1;
                ofMath().parse = () => 1;
                proxy.stringify = () => 1;
                ofWeakRef().prototype.deref = () => 1;
                ofAtomics().proxy.load = () => 1;
                own().min = () => 1;"#,
            ),
            (
                "test/helpers/index.ts",
                r#"export * from "./proxies"; export { ofWeakRef } from "./more";"#,
            ),
            (
                "test/helpers/proxies.ts",
                r#"export const ofMath = () => new Proxy(Math, {}); export const proxy = new Proxy(JSON, {});"#,
            ),
            (
                "test/helpers/more.ts",
                r#"export function ofWeakRef() { return new Proxy(WeakRef, {}); }"#,
            ),
            (
                "test/helpers/named.ts",
                r#"export const ofAtomics = () => ({ proxy: new Proxy(Atomics, {}) });"#,
            ),
            ("test/helpers/own.ts", r#"export const own = () => ({});"#),
        ];
        for (name, text) in files {
            let path = folder.join(name);
            std::fs::create_dir_all(path.parent().expect("it lies in a folder"))
                .expect("the folder is made");
            std::fs::write(&path, text).expect("the file is written");
        }
        let file = [&root[..], b"/test/one.test.ts"].concat();
        let replaced = find_what_tests_replace(
            &[file],
            &[],
            &[],
            1,
            ProductFiles::AreReadAsTestsAre,
            &mut |importer, specifier, _| {
                let folder = dirname::<platform::Auto>(importer);
                match specifier.strip_prefix(b"@/") {
                    Some(rest) => Some([&root[..], b"/", rest, b".ts"].concat()),
                    None => Some([folder, b"/", specifier].concat()),
                }
            },
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        // The files that a barrel exports again are one to whoever imports from it: `ofMath().parse` meets JSON.
        for member in [
            BuiltinId::MathMax,
            BuiltinId::JSONParse,
            BuiltinId::JSONStringify,
            BuiltinId::WeakRefPrototypeDeref,
            BuiltinId::AtomicsLoad,
        ] {
            assert!(replaced.builtins.contains(&(member as u32)), "{member:?}");
        }
        assert!(!replaced.builtins.contains(&(BuiltinId::MathMin as u32)));
    }

    #[test]
    fn follows_a_builtin_from_file_to_file_by_its_bindings() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder =
            std::env::temp_dir().join(format!("bun-aot-between-files-{}", std::process::id()));
        let root = folder.clone().into_os_string().into_encoded_bytes();
        let files = [
            (
                "test/one.test.ts",
                r#"import { spyOn } from "bun:test";
                import { getPrototypeOf, put } from "./tools";
                import { above, define, typed } from "./barrel";
                import { named } from "@/test/named";
                import whole from "./whole.cjs";
                import imported from "node:console";
                import { performance as clock } from "node:perf_hooks";
                const { holder } = require("./parts.cjs");
                put(getPrototypeOf(Uint8Array).prototype, "values", () => 1);
                above(Int8Array).prototype.fill = () => 1;
                define(above(Int16Array).prototype, "byteLength", {});
                typed.subarray = () => 1;
                named.isInteger = () => 1;
                whole.parse = () => 1;
                spyOn(holder, "keys");
                require("./parts.cjs").twice.ownKeys = () => 1;
                (await import("./tools")).proto.join = () => 1;
                imported.info = () => 1;
                spyOn(require("node:console"), "debug");
                spyOn(clock, "now");"#,
            ),
            (
                "test/tools.ts",
                r#"export const { defineProperty, getPrototypeOf } = Object;
                export const proto = Array.prototype;
                export function put(object, key, value) { object[key] = value; }"#,
            ),
            (
                "test/barrel/index.ts",
                r#"export { getPrototypeOf as above, defineProperty as define } from "../tools";
                export * from "./more";"#,
            ),
            (
                "test/barrel/more.ts",
                r#"import { getPrototypeOf } from "../tools";
                export const typed = getPrototypeOf(Uint16Array).prototype;"#,
            ),
            ("test/named.ts", r#"export const named = Number;"#),
            ("test/whole.cjs", r#"module.exports = JSON;"#),
            (
                "test/parts.cjs",
                r#"module.exports = { holder: Object };
                module.exports.twice = Reflect;
                module.exports.twice = {};"#,
            ),
        ];
        for (name, text) in files {
            let path = folder.join(name);
            std::fs::create_dir_all(path.parent().expect("it lies in a folder"))
                .expect("the folder is made");
            std::fs::write(&path, text).expect("the file is written");
        }
        let file = [&root[..], b"/test/one.test.ts"].concat();
        let replaced = find_what_tests_replace(
            &[file],
            &[],
            &[],
            1,
            ProductFiles::AreReadAsTestsAre,
            &mut |importer, specifier, _| {
                let folder = dirname::<platform::Auto>(importer);
                match specifier.strip_prefix(b"@/") {
                    Some(rest) => Some([&root[..], b"/", rest, b".ts"].concat()),
                    None => Some([folder, b"/", specifier].concat()),
                }
            },
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        for member in [
            BuiltinId::TypedArrayPrototypeValues,
            BuiltinId::TypedArrayPrototypeFill,
            BuiltinId::TypedArrayPrototypeByteLength,
            BuiltinId::TypedArrayPrototypeSubarray,
            BuiltinId::NumberIsInteger,
            BuiltinId::JSONParse,
            BuiltinId::ObjectKeys,
            BuiltinId::ArrayPrototypeJoin,
            BuiltinId::ConsoleInfo,
            BuiltinId::ConsoleDebug,
            BuiltinId::PerformanceNow,
        ] {
            assert!(replaced.builtins.contains(&(member as u32)), "{member:?}");
        }
        // A name that is stored to twice stands for nothing.
        assert!(
            !replaced
                .builtins
                .contains(&(BuiltinId::ReflectOwnKeys as u32))
        );
    }

    #[test]
    fn finds_helpers_under_names_of_the_tsconfig_in_folders_and_behind_parameters() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-helpers-{}", std::process::id()));
        let root = folder.clone().into_os_string().into_encoded_bytes();
        let files = [
            (
                "test/one.test.ts",
                r#"import { createTracker } from "@/test/helpers/tracker";
                import "@/test/helpers/guard";
                import * as math from "../src/math";
                const rows = new URL("./rows/", import.meta.url);
                const tracker = createTracker();
                tracker.watch(math, "twice");
                function start(watch: (object: object, name: string) => void) { watch(math, "thrice"); }
                start(tracker.watch);
                const other = await import(process.argv[2]);
                tracker.watch(other, "fourfold");"#,
            ),
            (
                "test/helpers/tracker.ts",
                r#"import { spyOn } from "bun:test";
                export function createTracker() { return { watch(object: any, name: string) { return spyOn(object, name); } }; }"#,
            ),
            (
                "test/helpers/guard.ts",
                r#"import { mock } from "bun:test"; mock.module("../../src/own", () => ({}));"#,
            ),
            (
                "test/rows/one.rows.ts",
                r#"import { spyOn } from "bun:test"; import * as math from "../../src/math"; spyOn(math, "half");"#,
            ),
            (
                "test/rows/nobody-calls-it.ts",
                r#"import { spyOn } from "bun:test"; export function watch(object: any, name: string) { return spyOn(object, name); }"#,
            ),
        ];
        for (name, text) in files {
            let path = folder.join(name);
            std::fs::create_dir_all(path.parent().expect("it lies in a folder"))
                .expect("the folder is made");
            std::fs::write(&path, text).expect("the file is written");
        }
        let file = [&root[..], b"/test/one.test.ts"].concat();
        let replaced = find_what_tests_replace(
            &[file],
            &[],
            &[],
            1,
            ProductFiles::AreReadAsTestsAre,
            &mut |importer, specifier, _| {
                let folder = dirname::<platform::Auto>(importer);
                match specifier.strip_prefix(b"@/") {
                    Some(rest) => Some([&root[..], b"/", rest, b".ts"].concat()),
                    None => Some([folder, b"/", specifier].concat()),
                }
            },
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        let ends_of = |paths: Vec<&Vec<u8>>| -> Vec<String> {
            let ends = paths.into_iter().map(|path| &path[root.len()..]);
            ends.map(|end| String::from_utf8_lossy(end).into_owned())
                .collect()
        };
        assert_eq!(
            ends_of(replaced.modules.iter().collect()),
            ["/test/helpers/../../src/own"]
        );
        let exports = replaced.exports.iter();
        let exports: Vec<(String, String)> = exports
            .map(|(module, name)| {
                let name = String::from_utf8_lossy(name).into_owned();
                (ends_of(vec![module]).remove(0), name)
            })
            .collect();
        let pair = |module: &str, name: &str| (module.to_owned(), name.to_owned());
        assert_eq!(
            exports,
            [
                pair("/test/../src/math", "thrice"),
                pair("/test/../src/math", "twice"),
                pair("/test/rows/../../src/math", "half"),
            ]
        );
        assert_eq!(
            replaced.names_spied_on_unknown_objects,
            [b"fourfold".to_vec(), b"thrice".to_vec(), b"twice".to_vec()]
        );
        assert!(!replaced.spies_on_unknown_objects);
        assert!(!replaced.any_module);
    }

    #[test]
    fn tells_the_name_that_a_plugin_answers_for_beside_the_file_of_the_package() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-plugin-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("the folder is made");
        let path = folder.join("plugin.test.ts");
        let text = r#"import { plugin } from "bun";
            import { mock } from "bun:test";
            plugin({ name: "over", setup(build) { build.module("dep", () => ({ exports: {}, loader: "object" })); } });
            mock.module("mocked", () => ({}));"#;
        std::fs::write(&path, text).expect("the file is written");
        let file = path.into_os_string().into_encoded_bytes();
        let replaced = find_what_tests_replace(
            &[file],
            &[],
            &[],
            1,
            ProductFiles::AreReadAsTestsAre,
            &mut |_, specifier, _| Some([b"/packages/", specifier, b"/index.js"].concat()),
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        assert_eq!(
            replaced.modules,
            [
                b"/packages/dep/index.js".to_vec(),
                b"/packages/mocked/index.js".to_vec(),
                b"dep".to_vec()
            ]
        );
    }

    #[test]
    fn a_file_that_an_executable_holds_too_replaces_nothing() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-product-{}", std::process::id()));
        for name in ["tests", "product/testing"] {
            std::fs::create_dir_all(folder.join(name)).expect("the folder is made");
        }
        let write = |name: &str, text: &str| {
            let path = folder.join(name);
            std::fs::write(&path, text).expect("the file is written");
            path.into_os_string().into_encoded_bytes()
        };
        write(
            "product/patch.ts",
            "export function patch() { Buffer.isEncoding = () => true; Math.random = () => 0.5; }",
        );
        write(
            "product/testing/stubs.ts",
            r#"import { spyOn } from "bun:test"; export function stub() { Math.floor = () => 1; spyOn(Math, "ceil"); }"#,
        );
        write(
            "tests/helper.ts",
            "export function help() { Math.round = () => 2; }",
        );
        let file = write(
            "tests/one.test.ts",
            r#"import "../product/patch.ts"; import "../product/testing/stubs.ts"; import "./helper.ts"; Math.abs = () => 3;"#,
        );
        let names_found = |product: ProductFiles| {
            let files = [file.clone()];
            let replaced =
                find_what_tests_replace(&files, &[], &[], 1, product, &mut |importer, name, _| {
                    Some([dirname::<platform::Auto>(importer), b"/", name].concat())
                });
            let members = replaced.builtins.iter();
            let mut names: Vec<String> = members
                .filter_map(|&member| BuiltinId::from_wire(member))
                .map(|member| format!("{member:?}"))
                .collect();
            names.sort();
            names.join(" ")
        };
        let read_as_tests = names_found(ProductFiles::AreReadAsTestsAre);
        let closed = names_found(ProductFiles::ReplaceNothing);
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        assert_eq!(
            read_as_tests,
            "BufferIsEncoding ConsoleTimeStamp MathAbs MathCeil MathFloor MathRandom MathRound"
        );
        // The runner itself takes `console.timeStamp` off, whatever the files say. An executable takes the store on `Math.random`, so the layers are told of it.
        assert_eq!(
            closed,
            "ConsoleTimeStamp MathAbs MathCeil MathFloor MathRandom MathRound"
        );
    }

    #[test]
    fn names_the_lists_that_the_runner_lays_anew() {
        let mut lists = lists_laid_anew_between_test_files();
        lists.sort_unstable();
        let mut expected = [BuiltinId::ProcessArgv as u32, BuiltinId::BunArgv as u32];
        expected.sort_unstable();
        assert_eq!(lists, expected);
    }

    #[test]
    fn tells_a_layer_of_packages_what_files_of_the_product_import() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-reach-{}", std::process::id()));
        for name in ["tests", "product/testing"] {
            std::fs::create_dir_all(folder.join(name)).expect("the folder is made");
        }
        let write = |name: &str, text: &str| {
            let path = folder.join(name);
            std::fs::write(&path, text).expect("the file is written");
            path.into_os_string().into_encoded_bytes()
        };
        // A layer of packages is handed every file above it.
        let files = [
            write(
                "product/main.ts",
                r#"import "of-product"; import "of-both"; import "node:fs";"#,
            ),
            write(
                "product/testing/stubs.ts",
                r#"import { mock } from "bun:test"; import "of-stubs"; export const stub = mock();"#,
            ),
            write("tests/helper.ts", r#"import "of-helper";"#),
            write(
                "tests/one.test.ts",
                r#"import "of-tests"; import "of-both"; import "../product/main.ts";"#,
            ),
        ];
        let (others, test_files) = files.split_at(3);
        let found = |product: ProductFiles| {
            let resolve = &mut |importer: &[u8], name: &[u8], _| {
                Some(match is_relative(name) {
                    true => [dirname::<platform::Auto>(importer), b"/", name].concat(),
                    false => [b"/project/node_modules/", name, b"/index.js"].concat(),
                })
            };
            let replaced = find_what_tests_replace(test_files, others, &[], 1, product, resolve);
            let files = replaced.package_files_that_product_imports.into_iter();
            let files: Vec<String> = files
                .map(|path| String::from_utf8(path).expect("the paths are ASCII"))
                .collect();
            files.join(" ")
        };
        let closed = found(ProductFiles::ReplaceNothing);
        let open = found(ProductFiles::AreReadAsTestsAre);
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        assert_eq!(
            closed,
            "/project/node_modules/of-both/index.js /project/node_modules/of-product/index.js"
        );
        assert_eq!(open, "");
    }

    #[test]
    fn follows_what_a_mocked_file_exports_again() {
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-again-{}", std::process::id()));
        std::fs::create_dir_all(&folder).expect("the folder is made");
        let write = |name: &str, text: &str| {
            let path = folder.join(name);
            std::fs::write(&path, text).expect("the file is written");
            path.into_os_string().into_encoded_bytes()
        };
        // A layer of packages is handed every file above it.
        let others = [
            write(
                "barrel.ts",
                r#"export * from "whole"; export * from "./inner.ts"; export { a as b } from "named";
                import { c } from "bound"; export { c }; import { d } from "kept"; d;"#,
            ),
            write("inner.ts", r#"export * from "deep";"#),
            write("free.ts", r#"export * from "untouched";"#),
        ];
        let test_file = write(
            "one.test.ts",
            r#"import { mock } from "bun:test"; mock.module("./barrel.ts", () => ({}));"#,
        );
        let prefix = [folder.as_os_str().as_encoded_bytes(), b"/"].concat();
        let replaced = find_what_tests_replace(
            &[test_file],
            &others,
            &[],
            1,
            ProductFiles::ReplaceNothing,
            &mut |importer, name, _| {
                Some(match is_relative(name) {
                    true => [dirname::<platform::Auto>(importer), b"/", &name[2..]].concat(),
                    false => [b"/packages/", name].concat(),
                })
            },
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        let short = |path: &Vec<u8>| {
            let path = path.strip_prefix(&prefix[..]).unwrap_or(path);
            String::from_utf8(path.to_vec()).expect("the paths are ASCII")
        };
        let modules: Vec<String> = replaced.modules.iter().map(short).collect();
        assert_eq!(modules.join(" "), "barrel.ts");
        let whole = replaced.modules_that_mocked_files_export_whole.iter();
        let whole: Vec<String> = whole.map(short).collect();
        assert_eq!(whole.join(" "), "/packages/deep /packages/whole inner.ts");
        let exports = replaced.exports.iter();
        let exports: Vec<String> = exports
            .map(|(module, name)| format!("{}:{}", short(module), short(name)))
            .collect();
        assert_eq!(exports.join(" "), "/packages/bound:c /packages/named:a");
    }

    #[test]
    fn unites_what_test_files_and_their_helpers_replace() {
        // A thread of Bun's pool wants the streams that `bun` sets up at its start, and a unit test has none.
        bun_sema_driver::run_regions_inline_on_this_thread();
        let folder = std::env::temp_dir().join(format!("bun-aot-scan-{}", std::process::id()));
        std::fs::create_dir_all(folder.join("helpers")).expect("the folder is made");
        let write = |name: &str, text: &str| {
            let path = folder.join(name);
            std::fs::write(&path, text).expect("the file is written");
            path.into_os_string().into_encoded_bytes()
        };
        let first = write(
            "first.test.ts",
            r#"import { mock, spyOn } from "bun:test";
            import * as a from "./src/a";
            import "./helpers/stubs";
            spyOn(a, "read");
            spyOn(a, "write");
            mock.module("node:fs", () => ({}));
            import("bun:ffi");
            mock.module("missing", () => ({}));
            spyOn(String.prototype, "indexOf");"#,
        );
        let second = write(
            "second.test.ts",
            r#"import { mock, spyOn } from "bun:test";
            import * as a from "./src/a";
            import * as b from "./src/b";
            spyOn(a, "read");
            spyOn(b, "gone");
            mock.module("./src/b", () => ({}));
            (Object.prototype as any).polluted = 1;"#,
        );
        write("helpers/stubs.ts", "Array.from = () => [];");
        let mut asked = Vec::new();
        let replaced = find_what_tests_replace(
            &[first, second],
            &[],
            &[],
            2,
            ProductFiles::AreReadAsTestsAre,
            &mut |importer, specifier, _| {
                asked.push((importer.to_vec(), specifier.to_vec()));
                let name = specifier.strip_prefix(b"./src/")?;
                Some([b"/resolved/", name, b".ts"].concat())
            },
        );
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        // bun:ffi takes three members off Bun.FFI when it is loaded. node:worker_threads, which nobody names, writes `console`.
        let mut builtins = [
            BuiltinId::ConsoleTimeStamp as u32,
            BuiltinId::StringPrototypeIndexOf as u32,
            BuiltinId::ArrayFrom as u32,
            BuiltinId::BunFFICallback as u32,
            BuiltinId::BunFFICloseCallback as u32,
            BuiltinId::BunFFICfunction as u32,
        ];
        builtins.sort_unstable();
        assert_eq!(replaced.builtins, builtins);
        assert_eq!(
            replaced.names_added_to_builtins,
            [(BuiltinId::ObjectPrototype as u32, b"polluted".to_vec())]
        );
        assert_eq!(
            replaced.modules,
            [
                b"/resolved/b.ts".to_vec(),
                b"missing".to_vec(),
                b"node:fs".to_vec()
            ]
        );
        let a = b"/resolved/a.ts".to_vec();
        assert_eq!(
            replaced.exports,
            [(a.clone(), b"read".to_vec()), (a, b"write".to_vec())]
        );
        assert!(!replaced.any_module);
        // Each specifier of a file once, and none that names a module of Bun.
        asked.sort_unstable();
        let count = asked.len();
        asked.dedup();
        assert_eq!((asked.len(), count), (4, 4));
    }
}
