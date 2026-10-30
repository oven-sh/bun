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
use std::sync::OnceLock;

use crate::builtins::BuiltinId;
use crate::builtins::table::{self, Mutability};
use crate::load::is_in_node_modules;
use crate::load::replaced_builtins::{FoundInFile, look_at_files};
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

#[derive(Default)]
pub(crate) struct FoundInTests {
    pub members: Vec<u32>,
    pub names_added: Vec<OpenedName>,
    pub modules: Vec<WrittenModule>,
    pub exports: Vec<(WrittenModule, Vec<u8>)>,
    pub any_module: bool,
    pub handed_on: Vec<WrittenModule>,
    pub hands_on_any: bool,
    pub spies_on_unknown_objects: bool,
    pub names_spied_on_unknown_objects: Vec<Vec<u8>>,
    pub evicted: Vec<WrittenModule>,
    pub evicts_any: bool,
    pub names_file_with_query: bool,
    /// The files with `FoundInFile::spies_under_names_from_outside`, each as the scan was told to read it.
    spy_under_names_from_outside: Vec<Vec<u8>>,
    /// A file as the scan was told to read it, and `FoundInFile::holders_named_from_outside` of it.
    holders_named_from_outside: Vec<(Vec<u8>, Vec<u32>)>,
    /// A file in the same spelling, and a text that another file passes to what it imports from it.
    texts_passed: Vec<(Vec<u8>, Vec<u8>)>,
    library_modules_named: Vec<Vec<u8>>,
    /// By the path of the file.
    exported_again: FxHashMap<Vec<u8>, ExportedAgain>,
}

/// `FoundInFile::names_exported_again` and `modules_exported_again`.
#[derive(Default)]
struct ExportedAgain {
    names: Vec<(Vec<u8>, Vec<u8>, Vec<u8>)>,
    modules: Vec<Vec<u8>>,
}

fn read_file_named(path: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    const EXTENSIONS: [&[u8]; 8] = [
        b".ts", b".tsx", b".js", b".jsx", b".mts", b".mjs", b".cts", b".cjs",
    ];
    // `new URL("../scripts/run.sh", import.meta.url)` names a file that holds no code of ours.
    let read = |path: Vec<u8>| {
        let holds_code = EXTENSIONS.iter().any(|extension| path.ends_with(extension));
        let text = File::read_from(Fd::cwd(), &path)
            .ok()
            .filter(|_| holds_code)?;
        Some((path, text))
    };
    let written_for_output = (path.strip_suffix(b".js")).map(|stem| [stem, b".ts"].concat());
    read(path.to_vec())
        .or_else(|| written_for_output.and_then(read))
        .or_else(|| (EXTENSIONS.iter()).find_map(|extension| read([path, extension].concat())))
        .or_else(|| (EXTENSIONS.iter()).find_map(|end| read([path, b"/index", end].concat())))
}

/// One of Bun's own modules: what it writes on built-in objects, and the modules of Bun that it names.
struct LibraryModule {
    id: u32,
    writes: Vec<u32>,
    names: Vec<u32>,
}

fn look_at_library(caches: &ThreadCaches, threads: usize) -> &'static [LibraryModule] {
    static MODULES: OnceLock<Vec<LibraryModule>> = OnceLock::new();
    MODULES.get_or_init(|| {
        const FILES_LOOKED_AT_TOGETHER: usize = 16;
        let manifest = Archive::embedded().manifest();
        let modules = manifest.modules().iter();
        let modules: Vec<(u32, &[u8])> = modules
            .filter_map(|it| Some((it.id, it.path.as_deref()?)))
            .collect();
        let mut found: Guarded<Vec<LibraryModule>> = Guarded::new(Vec::new());
        let runs = modules.len().div_ceil(FILES_LOOKED_AT_TOGETHER);
        for_each_parallel_in_runs(caches, threads, runs, 1, &|run| {
            look_at_files(|look_at| {
                let first = run * FILES_LOOKED_AT_TOGETHER;
                for &(id, path) in modules.iter().skip(first).take(FILES_LOOKED_AT_TOGETHER) {
                    let Some(text) = Archive::read(path) else {
                        continue;
                    };
                    let mut file = look_at(path, &text);
                    // Their uses test a byte anyway, so an open one costs a lock at the start and no code.
                    file.members.retain(|&member| {
                        BuiltinId::from_wire(member).is_some_and(|member| {
                            table::entry(member).mutability == Mutability::ConstantUnlessWritten
                        })
                    });
                    let names = file.files_named.iter().chain(&file.other_modules_named);
                    found.lock().push(LibraryModule {
                        id,
                        writes: file.members,
                        names: names
                            .filter_map(|name| manifest.resolve(name, path))
                            .collect(),
                    });
                }
            });
        });
        let mut found = core::mem::take(found.get_mut());
        found.shared_sort_unstable_by_key(|module| module.id);
        found
    })
}

/// What the modules of Bun that the files name write on built-in objects, they and what they load: `globalThis.console = new Console(..)` in node:worker_threads,
/// `delete ffi.closeCallback` in bun:ffi. A build that does not see who names the module does not hold it, or holds it and follows nobody into it, and would lock the member at its start.
fn find_what_library_writes(library: &[LibraryModule], named: &[Vec<u8>]) -> Vec<u32> {
    let manifest = Archive::embedded().manifest();
    let named = named.iter();
    let mut pending: Vec<u32> = named
        .filter_map(|name| {
            manifest.module_by_specifier(table::specifier_of(find_module_named(name)?))
        })
        .collect();
    let mut seen: FxHashSet<u32> = pending.iter().copied().collect();
    let mut writes = Vec::new();
    while let Some(id) = pending.pop() {
        let Ok(at) = library.binary_search_by_key(&id, |module| module.id) else {
            continue;
        };
        writes.extend_from_slice(&library[at].writes);
        pending.extend(library[at].names.iter().filter(|&&name| seen.insert(name)));
    }
    writes
}

/// `files`: the test files and the preloads. A helper is a step or two away; further on lies the code under test, which every build sees.
pub(crate) fn scan_files_of_tests(
    files: &[Vec<u8>],
    threads: usize,
    reads_library: ReadsLibrary,
) -> FoundInTests {
    const STEPS_FROM_TEST_FILES: usize = 2;
    let started = std::time::Instant::now();
    const FILES_LOOKED_AT_TOGETHER: usize = 16;
    let caches = ThreadCaches::default();
    let mut found: Guarded<FoundInTests> = Guarded::new(FoundInTests::default());
    let mut paths = files.to_vec();
    let mut seen: FxHashSet<Vec<u8>> = paths.iter().cloned().collect();
    for step in 0..=STEPS_FROM_TEST_FILES {
        let mut named: Guarded<Vec<Vec<u8>>> = Guarded::new(Vec::new());
        let look_at_one = |asked_for: &[u8], look_at: &dyn Fn(&[u8], &[u8]) -> FoundInFile| {
            let Some((path, text)) = read_file_named(asked_for) else {
                return;
            };
            let file = look_at(&path, &text);
            let written = |specifier: Vec<u8>| WrittenModule {
                importer: path.clone(),
                specifier,
            };
            {
                let mut found = found.lock();
                found.members.extend(file.members);
                found.names_added.extend(file.names_added);
                found.modules.extend(file.modules.into_iter().map(written));
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
                found.evicted.extend(file.evicted.into_iter().map(written));
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
                if !file.names_exported_again.is_empty() || !file.modules_exported_again.is_empty()
                {
                    let again = ExportedAgain {
                        names: file.names_exported_again,
                        modules: file.modules_exported_again,
                    };
                    found.exported_again.insert(path.clone(), again);
                }
                let named = file.other_modules_named.into_iter();
                (found.library_modules_named)
                    .extend(named.filter(|name| find_module_named(name).is_some()));
                if file.spies_under_names_from_outside {
                    found.spy_under_names_from_outside.push(asked_for.to_vec());
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
            for (name, text) in file.texts_passed {
                let joined = join_abs_string_buf_checked::<platform::Auto>(
                    directory,
                    &mut buffer[..],
                    &[&name],
                );
                if let Some(joined) = joined {
                    found.lock().texts_passed.push((joined.to_vec(), text));
                }
            }
            if step == STEPS_FROM_TEST_FILES || is_in_node_modules(&path) {
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
        let runs = paths.len().div_ceil(FILES_LOOKED_AT_TOGETHER);
        for_each_parallel_in_runs(&caches, threads, runs, 1, &|run| {
            look_at_files(|look_at| {
                for written in paths
                    .iter()
                    .skip(run * FILES_LOOKED_AT_TOGETHER)
                    .take(FILES_LOOKED_AT_TOGETHER)
                {
                    look_at_one(written, look_at);
                }
            });
        });
        paths = core::mem::take(named.get_mut());
        paths.retain(|path| seen.insert(path.clone()));
    }
    let mut found = core::mem::take(found.get_mut());
    // A build that sees the files follows them into the library by itself.
    if reads_library == ReadsLibrary::Yes {
        let library = look_at_library(&caches, threads);
        let writes = find_what_library_writes(library, &found.library_modules_named);
        found.members.extend(writes);
    }
    found.library_modules_named = Vec::new();
    drop_thread_caches(&caches);
    // `export function plant(name) { Object.prototype[name] = 1; }` in one file, `plant("polluted")` in another: every text that goes to the file may be the name.
    for (file, holders) in core::mem::take(&mut found.holders_named_from_outside) {
        let texts = found.texts_passed.iter().filter(|passed| passed.0 == file);
        let names: Vec<&Vec<u8>> = texts.map(|passed| &passed.1).collect();
        for holder in holders {
            let added = names.iter().map(|&name| OpenedName {
                holder,
                name: name.clone(),
            });
            found.names_added.extend(added);
        }
    }
    // `export function watch(object, name) { return spyOn(object, name); }` in one file, `watch(holder, "read")` in another.
    for file in core::mem::take(&mut found.spy_under_names_from_outside) {
        let texts = found.texts_passed.iter().filter(|passed| passed.0 == file);
        let names: Vec<Vec<u8>> = texts.map(|passed| passed.1.clone()).collect();
        if logs_stages() {
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
    if logs_stages() {
        bun_core::print_errorln!(
            "AOT test run | scan of {} files and {} beside them | {} ms | sites: built-ins {} | names added {} | exports {} | modules {} | handed on {} | mocks any module {} | hands on any module {} | spies on objects from somewhere {}",
            files.len(),
            seen.len() - files.len(),
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
    }
    found
}

/// `resolve`: the path of the file that a file means with a specifier: in an import, or, with `true`, in `require()`. A package may name one file for each.
pub(crate) fn find_what_tests_replace(
    files: &[Vec<u8>],
    threads: usize,
    resolve: &mut dyn FnMut(&[u8], &[u8], bool) -> Option<Vec<u8>>,
) -> ReplacedByTests {
    let found = scan_files_of_tests(files, threads, ReadsLibrary::Yes);
    let mut resolved: FxHashMap<(WrittenModule, bool), Option<Vec<u8>>> = FxHashMap::default();
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
        let answer = resolved
            .entry((module, is_for_require))
            .or_insert_with_key(|(module, _)| {
                resolve(&module.importer, &module.specifier, is_for_require)
            });
        answer.clone()
    };
    // The keys of `require.cache` are what `require.resolve()` answers.
    let evicted_modules = (found.evicted.into_iter())
        .filter_map(|module| resolve_for(module, true))
        .collect();
    let mut resolve = |module: WrittenModule| resolve_for(module, false);
    let mut replaced = ReplacedByTests {
        builtins: found.members,
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
        any_module: found.any_module,
        handed_on_modules: found
            .handed_on
            .into_iter()
            .filter_map(&mut resolve)
            .collect(),
        hands_on_any_module: found.hands_on_any,
        names_spied_on_unknown_objects: found.names_spied_on_unknown_objects,
        spies_on_unknown_objects: found.spies_on_unknown_objects,
        spy_may_meet_module_that_no_file_spells: found.spies_on_unknown_objects
            && found.hands_on_any,
        evicted_modules,
        evicts_any_module: found.evicts_any,
        names_file_with_query: found.names_file_with_query,
    };
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
    replaced.builtins.shared_sort_unstable();
    replaced.builtins.dedup();
    replaced.names_added_to_builtins.shared_sort_unstable();
    replaced.names_added_to_builtins.dedup();
    replaced.modules.shared_sort_unstable();
    replaced.modules.dedup();
    replaced.evicted_modules.shared_sort_unstable();
    replaced.evicted_modules.dedup();
    replaced.handed_on_modules.shared_sort_unstable();
    replaced.handed_on_modules.dedup();
    (replaced.names_spied_on_unknown_objects).shared_sort_unstable();
    replaced.names_spied_on_unknown_objects.dedup();
    replaced.exports.shared_sort_unstable();
    replaced.exports.dedup();
    // The names of a module that is replaced whole say nothing more.
    let modules = &replaced.modules;
    (replaced.exports).retain(|(module, _)| modules.binary_search(module).is_err());
    replaced
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::builtins::BuiltinId;

    #[test]
    fn unites_what_test_files_and_their_helpers_replace() {
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
        let replaced =
            find_what_tests_replace(&[first, second], 2, &mut |importer, specifier, _| {
                asked.push((importer.to_vec(), specifier.to_vec()));
                let name = specifier.strip_prefix(b"./src/")?;
                Some([b"/resolved/", name, b".ts"].concat())
            });
        std::fs::remove_dir_all(&folder).expect("the folder is removed");
        // bun:ffi takes three members off Bun.FFI when it is loaded. node:worker_threads, which nobody names, writes `console`.
        let mut builtins = [
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
