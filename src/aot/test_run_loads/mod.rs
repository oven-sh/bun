//! Which files of a test run load again, by file. `delete require.cache[path]` makes the next `require()` or `import()` of the file load it again, from disk, and so
//! does a store to the entry. A file that the run itself writes, moves or removes is among them, though it may load only once: `bun test` reads what lies on disk when
//! something first loads it. Code that asks for such a file asks the run time which instance answers, and knows nothing of what it gets, so the fewer the better.
//! Each file says what it does where it is parsed, and the answers are joined once, when the application is loaded.

mod changed_on_disk;
mod keys_of_cache;
#[cfg(test)]
mod tests;

use bun_paths::is_absolute;
use bun_paths::platform::Posix;
use bun_paths::resolve_path::dirname;
use bun_sema::atom::Atom;
use bun_sema::bind::{Bound, Parent};
use bun_sema::hir::{ExprId, File, NodeData};
use bun_sema::program::{CodeAnswer, ComputedTargets, FileId, Files};
use bun_sema::resolve::FinishedFile;
use bun_sema::util::SharedSort;
use bun_sema_driver::host::from_native;

use self::changed_on_disk::{
    ChangedOnDisk, FilesNamedWithQueries, find_file_in_front_of_query, names_file_with_query,
    write_whole_start,
};
use self::keys_of_cache::{TextOfRun, find_library_modules_that_entries_may_answer, look_at_keys};
use crate::builtins::resolve::{is_module_cache, is_table_of_loaders};
use crate::builtins::{ResolvedBuiltins, RuntimeModule, table};
use crate::diagnostic_codes::Code;
use crate::diagnostics::{Diagnostic, Diagnostics, ProgramView, Span, range_of_node};
use crate::load::sources::parsed_source;
use crate::options::Options;
use crate::test_run_report::{
    say_entries_may_answer, say_file_changed_on_disk, say_why_every_file,
};

/// What a key of the table of loaded modules names, as far as the file says it. The thread that parses a file knows no other file.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum FileOfKey {
    /// `require.resolve("./a")`: the place of the call in `FileAnalysis::import_sites`.
    Site(u32),
    Path(Atom),
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum WhyEveryFile {
    NamesPlugin,
    LoadsFileUnderQuery,
    TakesOutUnderUnknownKey,
    HandsTableOn,
    /// `require.extensions[".js"] = loader`
    StoresLoader,
    ResetsModules,
}

impl WhyEveryFile {
    /// What the stage log says behind the path of the file.
    fn describe(self) -> &'static str {
        match self {
            WhyEveryFile::NamesPlugin => "names Bun.plugin",
            WhyEveryFile::LoadsFileUnderQuery => "loads a file under a query",
            WhyEveryFile::TakesOutUnderUnknownKey => {
                "takes a key out of require.cache that it does not spell"
            }
            WhyEveryFile::HandsTableOn => "hands require.cache on",
            WhyEveryFile::StoresLoader => "stores a loader into Module._extensions",
            WhyEveryFile::ResetsModules => "names resetModules of the test runner",
        }
    }

    /// A file that has run leaves the table of loaded modules, so something may load it once more. The others bring in a text that nobody has read, which may name any
    /// file or answer in the place of one that has yet to load: nothing that has run leaves.
    pub(crate) fn takes_files_out(self) -> bool {
        match self {
            WhyEveryFile::TakesOutUnderUnknownKey
            | WhyEveryFile::HandsTableOn
            | WhyEveryFile::ResetsModules => true,
            WhyEveryFile::NamesPlugin
            | WhyEveryFile::LoadsFileUnderQuery
            | WhyEveryFile::StoresLoader => false,
        }
    }

    /// What `Code::EveryFileMayLoadAgain` begins with. `None`: `Code::ModulesLoadAgainUncompiled` stands at the place.
    fn notice(self) -> Option<&'static [u8]> {
        match self {
            WhyEveryFile::NamesPlugin => Some(b"This names Bun.plugin"),
            WhyEveryFile::LoadsFileUnderQuery => Some(b"This loads a file under a query"),
            WhyEveryFile::TakesOutUnderUnknownKey => Some(
                b"This takes a module out of the table of loaded modules under a key that the build can't tell",
            ),
            WhyEveryFile::HandsTableOn => Some(
                b"This file hands the table of loaded modules on to code that may take anything out of it",
            ),
            WhyEveryFile::StoresLoader => Some(b"This file may store a loader for a kind of file"),
            WhyEveryFile::ResetsModules => None,
        }
    }
}

/// Per file. `Default`: the file takes nothing out and stores nothing.
#[derive(Default)]
pub(crate) struct LoadsOfFile {
    /// What the keys name under which the file takes entries out of the table.
    pub files_taken_out: Vec<FileOfKey>,
    /// The keys that are taken out and of which folding knows a part: how each begins and ends. No end: that is the whole text.
    pub parts_of_keys_taken_out: Vec<(Atom, Option<Atom>)>,
    /// What the keys begin with that are taken out behind a test of their start, with the offset of the place.
    pub starts_of_keys_taken_out: Vec<(TextOfRun, u32)>,
    /// A key that nobody can read, the table handed on, `Bun.plugin` named, `resetModules()`. With the offset of the place.
    pub takes_any_file_out: Option<(WhyEveryFile, u32)>,
    /// The offset of the first place whose path nobody can read.
    pub names_file_with_query: Option<u32>,
    /// `FilesNamedWithQueries::spelled`
    pub paths_in_front_of_queries: Vec<(Atom, u32)>,
    /// The keys under which the file stores an entry and of which folding knows less than the file says: `"ur" + x` begins with `ur` and ends with nothing.
    /// No end: that is the whole text.
    pub starts_of_keys_stored: Vec<(Atom, Option<Atom>)>,
    pub stores_under_key_nobody_reads: bool,
}

/// `require.cache[key]`, `(table as Entries).name`: `ResolvedBuiltins` follows what is done with the member.
fn is_object_of_member(hir: &File<'_>, bound: &Bound<'_>, mut object: ExprId) -> bool {
    while let Parent::Expr(parent) = bound.parent_of_expr(object) {
        if hir.type_assertion_operand(parent) != Some(object) {
            return matches!(hir.member_key(parent), Some((asked, _)) if asked == object);
        }
        object = parent;
    }
    false
}

/// `ResolvedBuiltins::loses_sight_of_module_cache`, `hands_module_cache_on` and `resets_modules` are bits. Only a file that has one of them set is searched, and only for the place.
fn look_at_what_goes_out_of_sight(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
    found: &mut LoadsOfFile,
) {
    if !builtins.loses_sight_of_module_cache() && !builtins.resets_modules() {
        return;
    }
    let &FinishedFile { hir, bound, .. } = request;
    let [mut plugin, mut table_itself, mut loaders, mut reset] = [None::<u32>; 4];
    for expression in (0..hir.exprs.len() as u32).map(ExprId) {
        let Some(named) = builtins.builtin_of_expression(expression) else {
            continue;
        };
        let first = if table::is_plugin(named) {
            &mut plugin
        } else if is_module_cache(named) && !is_object_of_member(hir, bound, expression) {
            &mut table_itself
        } else if is_table_of_loaders(named) {
            &mut loaders
        } else if table::resets_modules(named) {
            &mut reset
        } else {
            continue;
        };
        let at = range_of_node(hir, NodeData::Expr(expression)).0;
        *first = Some(first.map_or(at, |first| first.min(at)));
    }
    // No expression of the file is known for the table of a `require` that the file has made: its place is the head of the file.
    let hands_table_on = builtins.hands_module_cache_on();
    let mut mentioned = builtins.mentioned().iter();
    let names_plugin = mentioned.any(|&id| table::is_plugin(id));
    let why = if names_plugin {
        (WhyEveryFile::NamesPlugin, plugin)
    } else if hands_table_on {
        (WhyEveryFile::HandsTableOn, table_itself)
    } else if builtins.names_plugin() || builtins.resets_modules() {
        (WhyEveryFile::ResetsModules, reset)
    } else {
        (WhyEveryFile::StoresLoader, loaders)
    };
    found.takes_any_file_out = Some((why.0, why.1.unwrap_or(0)));
    // Whoever gets the table stores what he likes under any key.
    found.stores_under_key_nobody_reads = hands_table_on;
}

/// On the thread that has parsed the file. It reads the lists that the analysis and `ResolvedBuiltins` hold.
pub(crate) fn look_at_loads_of_file(
    request: &FinishedFile<'_, '_>,
    builtins: &ResolvedBuiltins,
) -> LoadsOfFile {
    let FilesNamedWithQueries {
        spelled,
        unspelled_at,
    } = names_file_with_query(request);
    let mut found = LoadsOfFile {
        names_file_with_query: unspelled_at,
        paths_in_front_of_queries: spelled,
        ..LoadsOfFile::default()
    };
    look_at_what_goes_out_of_sight(request, builtins, &mut found);
    look_at_keys(request, builtins, &mut found);
    found
}

#[derive(Default)]
pub(crate) struct LoadsOfRun {
    /// Nobody can say which file loads again. The lists of files say nothing then.
    pub is_every_file: bool,
    /// Of those runs: nobody can say which file is taken out. Without it the files that leave are those that are listed: `WhyEveryFile::takes_files_out`.
    pub is_any_file_taken_out: bool,
    /// Ascending, each once.
    pub files_taken_out: Vec<FileId>,
    /// Ascending, each once.
    pub files_changed_on_disk: Vec<FileId>,
    /// Ascending, each once. The loader of the host reads the file once more for each query, and what was loaded stays: nothing leaves, and what the copy imports is
    /// what the text of the file imports.
    pub files_copied_under_queries: Vec<FileId>,
    /// By registry id, each once. An entry that a file stores under a key which it does not spell may answer `require()` of them.
    pub library_modules_that_entries_may_answer: Vec<RuntimeModule>,
    /// By file, then by the offset of the place.
    pub why_every_file: Vec<(FileId, WhyEveryFile, u32)>,
}

impl LoadsOfRun {
    /// The loader of the host may read a file of the program: once more, or with another text than the build has read.
    pub(crate) fn reads_files_from_disk(&self) -> bool {
        self.is_every_file
            || !self.files_taken_out.is_empty()
            || !self.files_changed_on_disk.is_empty()
            || !self.files_copied_under_queries.is_empty()
    }
}

fn add_files_of_key(files: &Files<'_>, file: FileId, key: FileOfKey, found: &mut Vec<FileId>) {
    match key {
        // The table lists a file under its whole path.
        FileOfKey::Path(path) => {
            let path = files.atoms.bytes(path);
            if is_absolute(path) {
                found.extend(files.by_path.get(&from_native(path)));
            }
        }
        FileOfKey::Site(site) => {
            let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
            match answers.get(site as usize) {
                Some(&CodeAnswer::File(named)) => found.push(named),
                Some(&CodeAnswer::Computed(ComputedTargets::Modules { files: named, .. })) => {
                    found.extend_from_slice(named);
                }
                // `look_at_keys` has said that such a key names any file.
                Some(CodeAnswer::Computed(ComputedTargets::All { .. })) => {}
                Some(
                    CodeAnswer::HostModule(_)
                    | CodeAnswer::External { .. }
                    | CodeAnswer::Erased
                    | CodeAnswer::NotFound(_),
                )
                | None => {}
            }
        }
    }
}

fn read_text_of_run(files: &Files<'_>, file: FileId, text: &TextOfRun) -> Option<Vec<u8>> {
    Some(match text {
        TextOfRun::Text(text) => files.atoms.bytes(*text).to_vec(),
        TextOfRun::PathOfSite(site) => {
            let answers = files.compiled(file).map_or(&[][..], |it| it.code_answers);
            let Some(&CodeAnswer::File(named)) = answers.get(*site as usize) else {
                return None;
            };
            files.module(named).file_name().to_vec()
        }
        TextOfRun::Dirname(of) => dirname::<Posix>(&read_text_of_run(files, file, of)?).to_vec(),
        TextOfRun::Concatenation(parts) => {
            let [first, second] = &**parts;
            let mut whole = read_text_of_run(files, file, first)?;
            whole.extend(read_text_of_run(files, file, second)?);
            whole
        }
        TextOfRun::Separator => b"/".to_vec(),
    })
}

/// Once, when the application of a test run is loaded: one loop over the compiled files.
pub(crate) fn collect_loads_of_run(files: &Files<'_>, options: &Options<'_>) -> LoadsOfRun {
    let mut run = LoadsOfRun::default();
    let mut changed = ChangedOnDisk::default();
    let mut keys_stored: Vec<(Atom, Option<Atom>)> = Vec::new();
    let mut is_any_key_stored = false;
    for &file in files.compiled_files() {
        // Nobody has read the file, so it may do anything. `freeze_sources` stops the build at it.
        let Some(source) = parsed_source(files, file) else {
            run.is_every_file = true;
            run.is_any_file_taken_out = true;
            continue;
        };
        let loads = &source.of_run.loads;
        for &key in &loads.files_taken_out {
            add_files_of_key(files, file, key, &mut run.files_taken_out);
        }
        for &(start, end) in &loads.parts_of_keys_taken_out {
            let (start, end) = (
                files.atoms.bytes(start),
                end.map(|end| files.atoms.bytes(end)),
            );
            // `path.join(__dirname, ..)`, `import.meta.dir + ..`: folding writes the folder of the file itself as `.`.
            let start = match start {
                [b'.', ..] => {
                    write_whole_start(dirname::<Posix>(files.module(file).file_name()), start)
                }
                _ => start.to_vec(),
            };
            let start = &start[..];
            let fits = |it: &&FileId| {
                let path = files.module(**it).file_name();
                match end {
                    Some(end) => {
                        path.len() >= start.len() + end.len()
                            && path.starts_with(start)
                            && path.ends_with(end)
                    }
                    None => path == start,
                }
            };
            run.files_taken_out
                .extend(files.compiled_files().iter().filter(fits));
        }
        let mut unread_start = None;
        for (start, at) in &loads.starts_of_keys_taken_out {
            match read_text_of_run(files, file, start).filter(|start| is_absolute(start)) {
                Some(start) => {
                    let below = |it: &&FileId| files.module(**it).file_name().starts_with(&start);
                    let below = files.compiled_files().iter().filter(below);
                    run.files_taken_out.extend(below);
                }
                None => unread_start = unread_start.or(Some(*at)),
            }
        }
        let unread_start = unread_start.map(|at| (WhyEveryFile::TakesOutUnderUnknownKey, at));
        let mut under_query = loads.names_file_with_query;
        for &(text, at) in &loads.paths_in_front_of_queries {
            match find_file_in_front_of_query(files, file, text) {
                Some(copied) if files.is_compiled(copied) => {
                    run.files_copied_under_queries.push(copied);
                }
                // Nobody has read what is loaded there.
                _ => under_query = Some(under_query.map_or(at, |first| first.min(at))),
            }
        }
        let under_query = under_query.map(|at| (WhyEveryFile::LoadsFileUnderQuery, at));
        let whys = loads
            .takes_any_file_out
            .into_iter()
            .chain(unread_start)
            .chain(under_query);
        (run.why_every_file).extend(whys.map(|(why, at)| (file, why, at)));
        keys_stored.extend_from_slice(&loads.starts_of_keys_stored);
        is_any_key_stored |= loads.stores_under_key_nobody_reads;
        changed.look_at_changed_paths(files, &options.code.working_directory, file);
    }
    run.is_every_file |= !run.why_every_file.is_empty();
    run.is_any_file_taken_out |= run.why_every_file.iter().any(|why| why.1.takes_files_out());
    (run.why_every_file).shared_sort_unstable_by_key(|&(file, _, at)| (file, at));
    run.files_taken_out.retain(|&file| files.is_compiled(file));
    run.files_taken_out.shared_sort_unstable();
    run.files_taken_out.dedup();
    run.files_copied_under_queries.shared_sort_unstable();
    run.files_copied_under_queries.dedup();
    run.files_changed_on_disk = changed.find_files(files);
    run.library_modules_that_entries_may_answer =
        find_library_modules_that_entries_may_answer(&files.atoms, &keys_stored, is_any_key_stored);
    for &(file, why, _) in &run.why_every_file {
        say_why_every_file(files.module(file).file_name(), why.describe());
    }
    // A file and what import attributes make of it have one name.
    let changed = run.files_changed_on_disk.iter();
    let mut changed: Vec<&[u8]> = changed
        .map(|&file| files.module(file).file_name())
        .collect();
    changed.shared_sort_unstable();
    changed.dedup();
    for name in changed {
        say_file_changed_on_disk(name);
    }
    say_entries_may_answer(run.library_modules_that_entries_may_answer.len());
    run
}

/// Each place that alone lets every file of the run load again is named, so that nobody has to guess why the run is compiled otherwise. `left_out` ascend.
pub(crate) fn warn_where_every_file_may_load_again(
    diagnostics: &mut Diagnostics,
    view: ProgramView<'_, '_>,
    loads: &LoadsOfRun,
    left_out: &[FileId],
) {
    for &(file, why, at) in &loads.why_every_file {
        let Some(sentence) = why.notice() else {
            continue;
        };
        if left_out.binary_search(&file).is_ok() {
            continue;
        }
        let span = Span {
            file,
            start: at,
            end: at,
        };
        let code = Code::EveryFileMayLoadAgain;
        diagnostics.add(Some(view), Diagnostic::new(code, Some(span), &[sentence]));
    }
}
