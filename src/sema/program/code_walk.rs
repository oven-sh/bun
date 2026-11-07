mod imported_constants;
mod only_imported;

use self::imported_constants::{NamesLookedUp, fold_files_that_import_constants_again};
use self::only_imported::{LoadedBy, forget_files_that_another_loader_reads};
use super::code_barrels::{
    BarrelRequests, NOT_LOADED, erase_imports_not_followed, erase_waiting_sites,
};
use super::code_file::{
    LoadInputs, analyze_code_file_again, finish_code_file, import_meta_main, is_finished_later,
    load_code_file,
};
use super::code_finish::find_answers_so_far;
use super::code_imports::files_of;
use super::code_load::{CodeEntry, CodeTarget, LoadKey, ParsedCodeFile};
use super::code_types::predicted_type_files;
use super::*;
use crate::file_analysis::{AnalyzedAgainFrom, FileAnalysis, FileInputs};
use crate::fold::StoredByMocks;
use crate::hir_from_data::{DataValue, HostValue};
use crate::import_sites::{
    ImportSiteKind, ImportSpecifier, find_texts_of_exports, write_from_other_folder,
    write_question_where_file_lies, write_start_from_other_folder,
};
use crate::resolve::{
    CodeRead, DeclaredSideEffects, EnclosingPackage, FinishedFile, HostPayload, ParsedFile,
    TranspileSettings, is_declaration_file_name,
};
use bun_threading::guarded::GuardedLock;
use bun_threading::{Condvar, Mutex};
use std::collections::VecDeque;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

const READ_BATCH_SIZE: usize = 16;
const MAX_READY_TEXTS: usize = 256;
const MAX_PLUGIN_READERS: usize = 64;

type ParsedSlot<'s, 'r> = Guarded<Option<Box<ParsedCodeFile<'s, 'r>>>>;
type EntryUpdate<'r> = (LoadKey<'r>, Option<HostPayload>, Vec<(&'r [u8], bool)>);
type LockedState<'w, 's, 'r> = GuardedLock<'w, WalkState<'s, 'r>, Mutex>;

struct WalkedFile<'s, 'r> {
    target: CodeTarget<'r>,
    parsed: Option<Box<ParsedCodeFile<'s, 'r>>>,
    targets: Vec<u32>,
    stored_by_mocks: StoredByMocks<'s>,
    loaded_by: LoadedBy,
    imported_requires: Vec<ImportedRequire>,
    imported_constants: Vec<ImportedConstant>,
    texts_of_data_files: Vec<TextOfDataFile>,
    imported_file_changers: Vec<ImportedFileChanger>,
    texts_of_other_files: Vec<TextOfOtherFile>,
    foldings_with_constants: u32,
    version: u32,
    depth: u32,
}

struct FileToRevisit<'s, 'r> {
    index: u32,
    loaded: Box<ParsedCodeFile<'s, 'r>>,
    analyzed_again_from: Option<AnalyzedAgainFrom>,
}

struct CopiedLoadInputs<'s> {
    stored_by_mocks: StoredByMocks<'s>,
    is_only_imported: bool,
    imported_requires: Vec<ImportedRequire>,
    imported_constants: Vec<ImportedConstant>,
    texts_of_data_files: Vec<TextOfDataFile>,
    imported_file_changers: Vec<ImportedFileChanger>,
    texts_of_other_files: Vec<TextOfOtherFile>,
}

impl<'s> CopiedLoadInputs<'s> {
    fn as_load_inputs(&self) -> LoadInputs<'_, 's> {
        LoadInputs {
            stored_by_mocks: self.stored_by_mocks,
            is_only_imported: self.is_only_imported,
            imported_requires: &self.imported_requires,
            imported_constants: &self.imported_constants,
            texts_of_data_files: &self.texts_of_data_files,
            imported_file_changers: &self.imported_file_changers,
            texts_of_other_files: &self.texts_of_other_files,
        }
    }
}

impl<'s, 'r> WalkedFile<'s, 'r> {
    fn code_targets(&self) -> &[CodeTarget<'r>] {
        match &self.parsed {
            Some(parsed) => &parsed.code.targets,
            None => &[],
        }
    }

    fn copy_load_inputs(&self) -> CopiedLoadInputs<'s> {
        CopiedLoadInputs {
            stored_by_mocks: self.stored_by_mocks,
            is_only_imported: self.loaded_by.is_import_alone(),
            imported_requires: self.imported_requires.clone(),
            imported_constants: self.imported_constants.clone(),
            texts_of_data_files: self.texts_of_data_files.clone(),
            imported_file_changers: self.imported_file_changers.clone(),
            texts_of_other_files: self.texts_of_other_files.clone(),
        }
    }
}

#[derive(Default)]
struct PluginReadTimes {
    queued: Option<(Duration, Duration)>,
    underway: usize,
    last_answer: Duration,
    without_files: Duration,
    waited: Duration,
}

impl PluginReadTimes {
    fn note_queued(&mut self, now: Duration) {
        if self.underway == 0 && self.queued.is_some() {
            self.without_files += now.saturating_sub(self.last_answer);
        }
        self.underway += 1;
        let first = self.queued.map_or(now, |(first, _)| first);
        self.queued = Some((first, now));
    }

    fn note_answered(&mut self, asked: Duration, now: Duration) {
        self.underway -= 1;
        self.last_answer = now;
        self.waited += now.saturating_sub(asked);
    }
}

#[derive(Default)]
struct ImportersOfRequires {
    scanned_again: Option<Vec<u32>>,
    by_exporter: Option<FxHashMap<u32, Vec<u32>>>,
}

#[derive(Default)]
struct WalkState<'s, 'r> {
    files: Vec<WalkedFile<'s, 'r>>,
    index_of: FxHashMap<LoadKey<'r>, u32>,
    found: Vec<u32>,
    own_to_read: VecDeque<u32>,
    to_read: VecDeque<u32>,
    to_read_by_plugin: VecDeque<u32>,
    plugin_readers: usize,
    idle_plugin_readers: usize,
    pending_assets: Vec<u32>,
    background_reads_disabled: bool,
    early_loaders: usize,
    asleep: usize,
    has_plugin_reader: bool,
    is_drained: bool,
    is_finished: bool,
    ready: VecDeque<(u32, Cow<'static, [u8]>)>,
    deferred: Vec<u32>,
    in_progress: usize,
    to_revisit: Vec<FileToRevisit<'s, 'r>>,
    barrels: BarrelRequests,
    has_exported_requires: bool,
    importers_of_requires: ImportersOfRequires,
    has_exported_file_changers: bool,
    names_looked_up: NamesLookedUp,
    unfinished: Vec<u32>,
    askers_of_data_files: Vec<u32>,
    askers_of_other_files: Vec<u32>,
    askers_for_main_module: Vec<u32>,
    files_read_by_plugins: usize,
    time_loading: Duration,
    longest_load: (Duration, Duration, usize),
    time_asleep: Duration,
    last_read: Duration,
    plugin_reads: PluginReadTimes,
    found_by_time: Vec<u32>,
    deepest: u32,
    depths_read_by_plugins: Option<(u32, u32)>,
}

impl WalkState<'_, '_> {
    fn has_idle_threads(&self) -> bool {
        let waiting = self.own_to_read.len() + self.to_read.len() + self.ready.len();
        waiting <= self.asleep && self.in_progress > 0
    }

    fn has_files_to_read(&self) -> bool {
        !self.own_to_read.is_empty() || !self.to_read.is_empty()
    }

    fn take_files_to_read(&mut self) -> Vec<u32> {
        let queue = match self.own_to_read.is_empty() {
            true => &mut self.to_read,
            false => &mut self.own_to_read,
        };
        let count = queue.len().min(READ_BATCH_SIZE);
        queue.drain(..count).collect()
    }
}

struct CodeWalk<'c, 'a, 's: 'r, 'r> {
    context: &'c CodeLoadContext<'a, 's, 'r>,
    spawn_background_readers: SpawnBackgroundReaders<'c>,
    early_prefetch: &'c OnceLock<Prefetch<'s, 'r>>,
    state: Guarded<WalkState<'s, 'r>>,
    paths_without_loader: ShardedMap<&'r [u8], ()>,
    has_changed: Condvar,
    has_to_read: Condvar,
    has_to_read_by_plugin: Condvar,
    may_load_early: Condvar,
    began: Instant,
    logs_rounds: bool,
}

type StartPluginReader<'w> = &'w (dyn Fn() -> bool + Sync);
type StartEarlyLoader<'w> = &'w (dyn Fn() + Sync);

#[derive(Copy, Clone)]
struct ThreadStarters<'w> {
    plugin_reader: StartPluginReader<'w>,
    early_loader: StartEarlyLoader<'w>,
}

pub(super) type SpawnBackgroundReaders<'w> = &'w (dyn Fn(Vec<Vec<u8>>) + Sync);

pub(super) const MAX_BACKGROUND_READERS: usize = MAX_PLUGIN_READERS;

impl<'a, 's: 'r, 'r> CodeLoadContext<'a, 's, 'r> {
    pub(super) fn load_code_files(
        &self,
        spawn_background_readers: SpawnBackgroundReaders<'_>,
        early_prefetch: &OnceLock<Prefetch<'s, 'r>>,
        meanwhile: &mut dyn FnMut(),
    ) -> CodeFiles<'s, 'r> {
        let mut walk = CodeWalk {
            context: self,
            spawn_background_readers,
            early_prefetch,
            state: Guarded::new(WalkState::default()),
            paths_without_loader: ShardedMap::default(),
            has_changed: Condvar::new(),
            has_to_read: Condvar::new(),
            has_to_read_by_plugin: Condvar::new(),
            may_load_early: Condvar::new(),
            began: Instant::now(),
            logs_rounds: bun_core::env_var::BUN_JSC_logAOTPhaseTimes.get() == Some(true),
        };
        let mut state = walk.state.lock();
        for entry_point in self.entry_points() {
            walk.enqueue(&mut state, entry_point, 0);
        }
        drop(state);
        let mut logged = LoggedSteps::begin(self.host);
        walk.run(meanwhile);
        logged.end("files of code: the walk");

        let mut state = std::mem::take(walk.state.get_mut());
        let mut ordered = None;
        let mut put_in_order = || {
            erase_sites_nothing_asked_for(&mut state);
            if self.host.follows_imports_on_request() {
                for file in &mut state.files {
                    if let Some(parsed) = &mut file.parsed {
                        erase_imports_not_followed(&mut parsed.code, &mut file.targets);
                    }
                }
            }
            import_what_is_required(self, &mut state);
            let mut files = order_files(self, &mut state);
            compute_package_depths(&mut files.entries, &files.entry_points, &files.steps);
            copy_to_session(self.session, &mut files.entries, &files.parsed);
            ordered = Some(files);
        };
        match early_prefetch.get() {
            Some(prefetch) => prefetch.find_stale_files_while(self.host, &mut put_in_order),
            None => put_in_order(),
        }
        let OrderedFiles {
            mut entries,
            entry_points,
            parsed,
            ..
        } = ordered.expect("the files were put in order");
        logged.end("files of code: their order, beside the look for stale files");

        let updates: Vec<Guarded<EntryUpdate<'r>>> = (entries.iter())
            .map(|entry| Guarded::new((entry.key, None, Vec::new())))
            .collect();
        let names_to_resolve = |parsed: &ParsedSlot<'s, 'r>| {
            let parsed = parsed.lock();
            parsed
                .as_ref()
                .map_or(0, |it| it.parse.bound.specifiers.len())
        };
        let sizes: Vec<usize> = parsed.iter().map(names_to_resolve).collect();
        let leftovers = Guarded::new(Some(state));
        let free_leftovers = |_: usize| drop(leftovers.lock().take());
        self.host.parallel_while(1, &free_leftovers, &mut || {
            parallel_largest_first(self.host, &sizes, &|index| {
                let entry = &entries[index];
                let key = self.key_of_read_code(entry.key);
                let Some(parsed) = parsed[index].lock().take() else {
                    updates[index].lock().0 = key;
                    return;
                };
                let arena = self.session.arena();
                let (loaded, code, payload) = self.answer_types_question(arena, key, *parsed);
                *updates[index].lock() = (key, payload, predicted_type_files(self.host, &loaded));
                *entry.loaded.lock() = Some(loaded);
                *entry.code.lock() = Some(code);
            });
        });
        logged.end("files of code: questions of types");
        for (entry, mut update) in entries.iter_mut().zip(updates) {
            let (key, payload, predicted_type_files) = update.get_mut();
            entry.key = *key;
            entry.payload = payload.take();
            entry.predicted_type_files = std::mem::take(predicted_type_files);
        }

        let keys = entries.iter().map(|entry| entry.key);
        let typed_files_with_other_code = keys
            .filter(|&key| self.is_in_place_of_typed_file(key))
            .map(|key| to_path(key.path, self.is_case_sensitive).into_owned())
            .collect();
        CodeFiles {
            session: self.session,
            atoms: self.atoms,
            is_case_sensitive: self.is_case_sensitive,
            entries,
            entry_points,
            entry_of_file: Vec::new(),
            is_in_types_program: Vec::new(),
            typed_files_with_other_code,
            reads_code_on_request: self.host.follows_imports_on_request(),
        }
    }

    fn canonical_key(&self, key: LoadKey<'r>) -> LoadKey<'r> {
        if self.is_case_sensitive {
            return key;
        }
        let path = to_path(key.path, false);
        match *path == *key.path {
            true => key,
            false => LoadKey {
                path: self.resolver.keep(&path),
                loader: key.loader,
            },
        }
    }

    fn key_of_read_code<'k>(&self, key: LoadKey<'k>) -> LoadKey<'k> {
        if key.loader != HostLoader::default() {
            return key;
        }
        match self.host.loader_of_code_in_place_of_typed_file(key.path) {
            Some(loader) => LoadKey { loader, ..key },
            None => key,
        }
    }

    fn is_types_only_target(&self, key: LoadKey<'_>) -> bool {
        key.loader == HostLoader::default()
            && is_declaration_file_name(key.path)
            && self.host.script_kind(key.path).is_none()
    }
}

impl<'s: 'r, 'r> CodeWalk<'_, '_, 's, 'r> {
    fn enqueue(&self, state: &mut WalkState<'s, 'r>, target: CodeTarget<'r>, depth: u32) -> u32 {
        let context = self.context;
        let path = to_path(target.key.path, context.is_case_sensitive);
        let lookup_key = LoadKey {
            path: &path,
            loader: target.key.loader,
        };
        if let Some(&index) = state.index_of.get(&lookup_key) {
            let known = &mut state.files[index as usize].target;
            known.host_module = known.host_module.or(target.host_module);
            return index;
        }
        let index = state.files.len() as u32;
        let mocks_any_file =
            context.inputs.code.mocks_any_file || state.names_looked_up.mocks_any_file();
        state.files.push(WalkedFile {
            target,
            parsed: None,
            targets: Vec::new(),
            stored_by_mocks: match mocks_any_file {
                true => StoredByMocks::EveryExport,
                false => StoredByMocks::Nothing,
            },
            loaded_by: LoadedBy::Require,
            imported_requires: Vec::new(),
            imported_constants: Vec::new(),
            texts_of_data_files: Vec::new(),
            imported_file_changers: Vec::new(),
            texts_of_other_files: Vec::new(),
            foldings_with_constants: 0,
            version: 0,
            depth,
        });
        if let Some(now) = self.now_if_logged() {
            let tenth = (now.as_millis() / 100) as usize;
            if state.found_by_time.len() <= tenth {
                state.found_by_time.resize(tenth + 1, 0);
            }
            state.found_by_time[tenth] += 1;
            state.deepest = state.deepest.max(depth);
        }
        let key = context.canonical_key(target.key);
        state.index_of.insert(key, index);
        if key.loader == HostLoader::default() {
            self.paths_without_loader.insert_ref(key.path, ());
        }
        if !context.is_types_only_target(target.key) {
            state.found.push(index);
        }
        index
    }

    fn add_parsed_file(
        &self,
        state: &mut WalkState<'s, 'r>,
        index: u32,
        mut parsed: Box<ParsedCodeFile<'s, 'r>>,
        is_only_finished: bool,
    ) {
        let requests = std::mem::take(&mut parsed.code.requests);
        state.has_exported_requires |= !parsed.code.exported_requires.is_empty();
        let analysis = &parsed.code.analyzed.analysis;
        state.has_exported_file_changers |= !analysis.exported_file_changers.is_empty();
        if !analysis.asked_of_data_files.is_empty() {
            state.askers_of_data_files.push(index);
        }
        if !analysis.asked_of_other_files.is_empty() {
            state.askers_of_other_files.push(index);
        }
        if analysis.asks_for_main_module {
            state.askers_for_main_module.push(index);
        }
        if !is_only_finished {
            state.names_looked_up.note_parsed_file(index, &parsed);
            if is_finished_later(&parsed.code.analyzed.analysis) {
                state.unfinished.push(index);
            }
        }
        let file = &mut state.files[index as usize];
        file.targets = vec![NOT_LOADED; parsed.code.targets.len()];
        file.parsed = Some(parsed);
        file.version += 1;
        if self.context.host.follows_imports_on_request() {
            return self.follow_declaration_files(state, index);
        }
        let mut barrels = std::mem::take(&mut state.barrels);
        barrels.add_parsed_file(index, requests, &mut |file, target| {
            let (file, target) = (file as usize, target as usize);
            let code_target = state.files[file].code_targets()[target];
            let depth = state.files[file].depth + 1;
            let loaded = self.enqueue(state, code_target, depth);
            state.files[file].targets[target] = loaded;
            loaded
        });
        state.barrels = barrels;
    }

    fn follow(&self, state: &mut WalkState<'s, 'r>, file: u32, target: usize) {
        if state.files[file as usize].targets[target] == NOT_LOADED {
            let code_target = state.files[file as usize].code_targets()[target];
            let depth = state.files[file as usize].depth + 1;
            state.files[file as usize].targets[target] = self.enqueue(state, code_target, depth);
        }
    }

    fn follow_declaration_files(&self, state: &mut WalkState<'s, 'r>, file: u32) {
        for target in 0..state.files[file as usize].targets.len() {
            let key = state.files[file as usize].code_targets()[target].key;
            if self.context.is_types_only_target(key) {
                self.follow(state, file, target);
            }
        }
    }

    fn follow_chosen_imports(&self, state: &mut WalkState<'s, 'r>) -> bool {
        let context = self.context;
        if !context.host.follows_imports_on_request() {
            return false;
        }
        let parsed_files = (0u32..).zip(&state.files);
        let parsed_files =
            parsed_files.filter_map(|(index, file)| Some((index, file, file.parsed.as_ref()?)));
        let (indexes, files): (Vec<u32>, Vec<ParsedFile<'_, 's>>) = parsed_files
            .map(|(index, file, parsed)| {
                let file = ParsedFile {
                    file: FinishedFile {
                        path: file.target.key.path,
                        loader: file.target.key.loader,
                        hir: &parsed.parse.hir,
                        bound: &parsed.parse.bound,
                        analysis: &parsed.code.analyzed.analysis,
                        atoms: &context.atoms,
                        resolutions: &parsed.code.resolutions,
                    },
                    payload: parsed.payload.as_ref(),
                    version: file.version,
                };
                (index, file)
            })
            .unzip();
        let chosen = context.host.choose_imports_to_follow(&files);
        drop(files);
        for (position, path) in chosen {
            let file = indexes[position as usize];
            for target in 0..state.files[file as usize].targets.len() {
                let key = state.files[file as usize].code_targets()[target].key;
                if is_same_path(key.path, &path, context.is_case_sensitive) {
                    self.follow(state, file, target);
                }
            }
        }
        !state.found.is_empty()
    }

    fn begin_at_found_entry_points(&self, state: &mut WalkState<'s, 'r>) -> bool {
        let context = self.context;
        let Some(find) = context.inputs.finds_entry_points else {
            return false;
        };
        let found = find(&WalkedCode::new(context, state));
        let dropped = found.dropped.iter();
        let dropped = dropped.filter_map(|path| context.drop_found_entry_point(path));
        let dropped: Vec<CodeTarget<'r>> = dropped.collect();
        for entry_point in &dropped {
            let index = state.index_of[&context.canonical_key(entry_point.key)];
            drop_parsed_file(state, index);
        }
        let added: Vec<CodeTarget<'r>> = (found.paths.iter())
            .filter_map(|path| context.add_entry_point(path))
            .collect();
        let mut has_learned = false;
        for (path, load) in &found.named_by {
            has_learned |= context.note_load_that_names(path, *load);
        }
        for &entry_point in &added {
            self.enqueue(state, entry_point, 0);
        }
        if added.is_empty() {
            return has_learned || !dropped.is_empty();
        }
        let was_alone = context.entry_point_count() - added.len() <= 1;
        let may_answer_otherwise = match was_alone {
            true => context.entry_points(),
            false => added,
        };
        for entry_point in may_answer_otherwise {
            let index = state.index_of[&context.canonical_key(entry_point.key)];
            let parsed = state.files[index as usize].parsed.as_ref();
            let folded_with = parsed.map(|it| it.code.analyzed.import_meta_main);
            if folded_with.is_some_and(|known| known != import_meta_main(context, entry_point.key))
            {
                forget_parsed_file(state, index);
            }
        }
        true
    }

    fn queue_found_files<'w>(
        &'w self,
        mut state: LockedState<'w, 's, 'r>,
        start_plugin_reader: StartPluginReader<'_>,
    ) -> (LockedState<'w, 's, 'r>, usize) {
        if state.found.is_empty() {
            return (state, 0);
        }
        let mut queued = 0;
        let found = std::mem::take(&mut state.found);
        let path_of = |&index: &u32| state.files[index as usize].target.key.path;
        let paths: Vec<&'r [u8]> = found.iter().map(path_of).collect();
        drop(state);
        let host = self.context.host;
        let by_plugin: Vec<bool> = paths
            .iter()
            .map(|path| host.is_read_by_plugin(path))
            .collect();
        let mut state = self.state.lock();
        for ((index, path), is_read_by_plugin) in found.into_iter().zip(paths).zip(by_plugin) {
            if !is_read_by_plugin {
                match strings::contains(path, b"/node_modules/") {
                    true => state.to_read.push_back(index),
                    false => state.own_to_read.push_back(index),
                }
                queued += 1;
                continue;
            }
            state.files_read_by_plugins += 1;
            let loader = state.files[index as usize].target.key.loader;
            if !state.background_reads_disabled && host.can_read_in_background(path, loader) {
                state.pending_assets.push(index);
                continue;
            }
            state.to_read_by_plugin.push_back(index);
            if let Some(now) = self.now_if_logged() {
                state.plugin_reads.note_queued(now);
                let depth = state.files[index as usize].depth;
                let (first, deepest) = state.depths_read_by_plugins.unwrap_or((depth, depth));
                state.depths_read_by_plugins = Some((first, deepest.max(depth)));
            }
            let needs_reader = state.to_read_by_plugin.len() > state.idle_plugin_readers
                && state.plugin_readers < MAX_PLUGIN_READERS;
            if needs_reader && start_plugin_reader() {
                state.plugin_readers += 1;
            } else if state.plugin_readers == 0 {
                self.has_to_read.notify_one();
            } else {
                self.has_to_read_by_plugin.notify_one();
            }
        }
        (state, queued)
    }

    fn run(&self, meanwhile: &mut dyn FnMut()) {
        if self.state.lock().found.is_empty() {
            return;
        }
        let host = self.context.host;
        let threads = host.threads();
        let walk = self;
        std::thread::scope(|scope| {
            let start_plugin_reader = || {
                let thread = std::thread::Builder::new()
                    .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize);
                let started = thread.spawn_scoped(scope, move || {
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Plugin"));
                    walk.read_by_plugin();
                });
                started.is_ok()
            };
            fn start_early_loader<'scope>(
                scope: &'scope std::thread::Scope<'scope, '_>,
                walk: &'scope CodeWalk<'_, '_, '_, '_>,
            ) {
                let thread = std::thread::Builder::new()
                    .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize);
                let _ = thread.spawn_scoped(scope, move || {
                    bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Early Load"));
                    bun_threading::lower_current_thread_priority();
                    walk.load_early(&|| start_early_loader(scope, walk));
                });
            }
            let start_early_loader = || start_early_loader(scope, walk);
            let start = ThreadStarters {
                plugin_reader: &start_plugin_reader,
                early_loader: &start_early_loader,
            };
            drop(self.queue_found_files(self.state.lock(), start.plugin_reader));
            let mut meanwhile = || {
                meanwhile();
                self.allow_early_load(&mut self.state.lock(), start.early_loader);
            };
            let mut process = |steps: LoadSteps| {
                let work = |_| self.work(steps, start);
                host.parallel_while(threads, &work, &mut meanwhile);
                while self.starts_next_round(start.plugin_reader) {
                    host.parallel(threads, &work);
                }
            };
            match host.io_pool() {
                Some(io) => {
                    let _alone = WAITS_ACROSS_POOLS.lock();
                    io.each_while(
                        (),
                        |(), (), _| self.work(LoadSteps::Read, start),
                        &mut vec![(); io.max_threads()],
                        || process(LoadSteps::Process),
                    );
                }
                None => process(LoadSteps::ReadAndProcess),
            }
        });
    }

    fn starts_next_round(&self, start_plugin_reader: StartPluginReader<'_>) -> bool {
        let context = self.context;
        let mut state = self.state.lock();
        debug_assert!(state.is_drained && state.in_progress == 0);
        state.importers_of_requires = ImportersOfRequires::default();
        loop {
            let has_folded = fold_files_that_import_constants_again(context, &mut state);
            let has_learned = !has_folded && scan_importers_of_requires_again(context, &mut state);
            let goes_on = has_folded
                || has_learned
                || scan_askers_of_data_files_again(&context.atoms, &mut state)
                || scan_importers_of_file_changers_again(context, &mut state)
                || scan_askers_of_other_files_again(context, &mut state)
                || forget_files_that_another_loader_reads(context, &mut state)
                || finish_files(&mut state)
                || self.follow_chosen_imports(&mut state)
                || self.begin_at_found_entry_points(&mut state)
                || forget_files_folded_with_main_module(context, &mut state);
            if goes_on && !has_learned {
                state.importers_of_requires = ImportersOfRequires::default();
            }
            self.log_round(&state);
            if !goes_on {
                state.is_finished = true;
                self.has_to_read.notify_all();
                self.has_to_read_by_plugin.notify_all();
                self.may_load_early.notify_all();
                if let Some(prefetch) = self.early_prefetch.get() {
                    prefetch.pause();
                }
                return false;
            }
            self.revisit_files(&mut state);
            if state.found.is_empty() {
                continue;
            }
            state.in_progress += 1;
            (state, _) = self.queue_found_files(state, start_plugin_reader);
            state.in_progress -= 1;
            state.is_drained = false;
            self.has_to_read.notify_all();
            return true;
        }
    }

    fn now_if_logged(&self) -> Option<Duration> {
        self.logs_rounds.then(|| self.began.elapsed())
    }

    fn note_plugin_answer(&self, state: &mut WalkState<'s, 'r>, asked: Option<Duration>) {
        if let Some(asked) = asked {
            let now = self.began.elapsed();
            state.plugin_reads.note_answered(asked, now);
        }
    }

    fn log_round(&self, state: &WalkState<'s, 'r>) {
        if !self.logs_rounds {
            return;
        }
        let count_revisited = |from: Option<AnalyzedAgainFrom>| {
            let files = state.to_revisit.iter();
            files.filter(|it| it.analyzed_again_from == from).count()
        };
        let was_parsed = |file: &&u32| state.files[**file as usize].version > 0;
        let loaded_again = state.found.iter().filter(was_parsed).count();
        let (took, began, bytes) = state.longest_load;
        let plugin_reads = &state.plugin_reads;
        let (first_queued, last_queued) = plugin_reads.queued.unwrap_or_default();
        let (first_by_plugin, deepest_by_plugin) = state.depths_read_by_plugins.unwrap_or_default();
        let found_by_time: Vec<String> = state.found_by_time.iter().map(u32::to_string).collect();
        bun_core::print_errorln!(
            "AOT round of Load | at {} ms | {} files, {} of them read by plugins | {} folded again | {} scanned again | {} looked at by the host | {} loaded again | {} new | threads spent {} ms loading files | the longest load {} ms, begun at {} ms with a file of {} KB | threads slept {} ms for want of a file | the last file they read came at {} ms, the last from a plugin at {} ms | plugins were given their first file at {} ms, their last at {} ms, and had none for {} ms in between | threads waited {} ms for plugins | the deepest file was found behind {} others, the first that a plugin reads behind {}, the deepest of those behind {} | files found in each tenth of a second: {}",
            self.began.elapsed().as_millis(),
            state.files.len(),
            state.files_read_by_plugins,
            count_revisited(Some(AnalyzedAgainFrom::Folding)),
            count_revisited(Some(AnalyzedAgainFrom::ImportScan)),
            count_revisited(None),
            loaded_again,
            state.found.len() - loaded_again,
            state.time_loading.as_millis(),
            took.as_millis(),
            began.as_millis(),
            bytes / 1024,
            state.time_asleep.as_millis(),
            state.last_read.as_millis(),
            plugin_reads.last_answer.as_millis(),
            first_queued.as_millis(),
            last_queued.as_millis(),
            plugin_reads.without_files.as_millis(),
            plugin_reads.waited.as_millis(),
            state.deepest,
            first_by_plugin,
            deepest_by_plugin,
            found_by_time.join(" "),
        );
    }

    fn revisit_files(&self, state: &mut WalkState<'s, 'r>) {
        struct Task<'s, 'r> {
            file: FileToRevisit<'s, 'r>,
            target: CodeTarget<'r>,
            inputs: Option<CopiedLoadInputs<'s>>,
        }
        enum Outcome<'s, 'r> {
            Unchanged(Box<ParsedCodeFile<'s, 'r>>),
            Changed(Box<ParsedCodeFile<'s, 'r>>),
            MustBeLoadedAgain,
        }
        if state.to_revisit.is_empty() {
            return;
        }
        let context = self.context;
        let mut files = std::mem::take(&mut state.to_revisit);
        files.shared_sort_unstable_by_key(|file| file.index);
        let sizes: Vec<usize> = (files.iter())
            .map(|file| file.loaded.parse.hir.exprs.len())
            .collect();
        let tasks = files.into_iter().map(|file| {
            let walked = &state.files[file.index as usize];
            Guarded::new(Some(Task {
                target: walked.target,
                inputs: (file.analyzed_again_from).map(|_| walked.copy_load_inputs()),
                file,
            }))
        });
        let tasks: Vec<Guarded<Option<Task<'s, 'r>>>> = tasks.collect();
        let outcomes: Vec<Guarded<Option<(u32, bool, Outcome<'s, 'r>)>>> =
            tasks.iter().map(|_| Guarded::new(None)).collect();
        parallel_largest_first(context.host, &sizes, &|at| {
            let task = tasks[at].lock().take().expect("a task is taken once");
            let FileToRevisit {
                index,
                mut loaded,
                analyzed_again_from,
            } = task.file;
            let outcome = match analyzed_again_from.zip(task.inputs) {
                None => match finish_code_file(context, task.target, &mut loaded) {
                    true => Outcome::Changed(loaded),
                    false => Outcome::Unchanged(loaded),
                },
                Some((from, inputs)) => {
                    let analyzed = analyze_code_file_again(
                        context,
                        context.session.arena(),
                        task.target,
                        *loaded,
                        &inputs.as_load_inputs(),
                        from,
                    );
                    match analyzed {
                        Some(analyzed) => Outcome::Changed(Box::new(analyzed)),
                        None => Outcome::MustBeLoadedAgain,
                    }
                }
            };
            *outcomes[at].lock() = Some((index, analyzed_again_from.is_none(), outcome));
        });
        let outcomes = outcomes.into_iter().map(|mut it| it.get_mut().take());
        let mut changed = Vec::new();
        for outcome in outcomes {
            let (index, is_only_finished, outcome) = outcome.expect("every task was taken");
            match outcome {
                Outcome::Unchanged(parsed) => state.files[index as usize].parsed = Some(parsed),
                Outcome::Changed(parsed) => {
                    if is_only_finished {
                        forget_targets(state, index);
                    }
                    changed.push((index, is_only_finished, parsed));
                }
                Outcome::MustBeLoadedAgain => state.found.push(index),
            }
        }
        for (index, is_only_finished, parsed) in changed {
            self.add_parsed_file(state, index, parsed, is_only_finished);
        }
    }

    fn allow_early_load(&self, state: &mut WalkState<'s, 'r>, start: StartEarlyLoader<'_>) {
        const FEWEST_RUNS_OF_FILES: usize = 64;
        let Some(prefetch) = self.early_prefetch.get() else {
            return;
        };
        if !state.has_idle_threads() {
            return;
        }
        match state.early_loaders {
            0 if !prefetch.has_work_for_more_than(FEWEST_RUNS_OF_FILES) => {}
            0 => {
                state.early_loaders = 1;
                start();
            }
            _ => self.may_load_early.notify_one(),
        }
    }

    fn load_early(&self, start_another: StartEarlyLoader<'_>) {
        let Some(prefetch) = self.early_prefetch.get() else {
            return;
        };
        let context = self.context;
        let loader = FileLoader {
            session: context.session,
            run: None,
            host: context.host,
            resolver: context.resolver,
            options: context.options,
            atoms: &context.atoms,
            build: Some(context),
            prefetch,
            is_code_file: Some(&|path| self.is_code_file(path)),
        };
        let mut state = self.state.lock();
        while !state.is_finished {
            if !state.has_idle_threads() {
                self.may_load_early.wait_guarded(&mut state);
                if state.has_idle_threads() {
                    self.may_load_early.notify_one();
                }
                continue;
            }
            let needs_another = state.early_loaders < context.host.threads()
                && prefetch.has_work_for_more_than(state.early_loaders);
            if needs_another {
                state.early_loaders += 1;
            }
            drop(state);
            if needs_another {
                start_another();
            }
            if !loader.load(LoadSteps::ReadAndProcess, true) {
                return;
            }
            state = self.state.lock();
        }
    }

    fn read_by_plugin(&self) {
        let mut state = self.state.lock();
        loop {
            if let Some(index) = state.to_read_by_plugin.pop_front() {
                state.in_progress += 1;
                drop(state);
                let asked = self.now_if_logged();
                self.read(vec![index]);
                state = self.state.lock();
                self.note_plugin_answer(&mut state, asked);
                if state.in_progress == 0 {
                    self.has_changed.notify_all();
                    self.has_to_read.notify_all();
                }
            } else if state.is_finished {
                return;
            } else {
                state.idle_plugin_readers += 1;
                self.has_to_read_by_plugin.wait_guarded(&mut state);
                state.idle_plugin_readers -= 1;
            }
        }
    }

    fn work(&self, steps: LoadSteps, start: ThreadStarters<'_>) {
        let (reads, processes) = (steps.reads(), steps.processes());
        let context = self.context;
        let mut arena = None;
        let mut state = self.state.lock();
        loop {
            let can_read_by_plugin = reads && state.plugin_readers == 0 && !state.has_plugin_reader;
            if can_read_by_plugin && let Some(index) = state.to_read_by_plugin.pop_front() {
                state.has_plugin_reader = true;
                state.in_progress += 1;
                if state.has_files_to_read() {
                    self.has_changed.notify_one();
                }
                drop(state);
                let asked = self.now_if_logged();
                self.read(vec![index]);
                state = self.state.lock();
                self.note_plugin_answer(&mut state, asked);
                state.has_plugin_reader = false;
                self.has_to_read.notify_one();
            } else if reads && state.has_files_to_read() && state.ready.len() <= MAX_READY_TEXTS {
                let batch = state.take_files_to_read();
                state.in_progress += batch.len();
                drop(state);
                self.read(batch);
                state = self.state.lock();
                if let Some(now) = self.now_if_logged() {
                    state.last_read = now;
                }
            } else if processes && let Some((index, text)) = state.ready.pop_front() {
                if state.ready.len() == MAX_READY_TEXTS {
                    self.has_to_read.notify_all();
                }
                let file = &state.files[index as usize];
                let (target, inputs) = (file.target, file.copy_load_inputs());
                drop(state);
                let arena = *arena.get_or_insert_with(|| context.session.arena());
                let inputs = inputs.as_load_inputs();
                let (began, bytes) = (self.began.elapsed(), text.len());
                let parsed = Box::new(load_code_file(context, arena, target, text, &inputs));
                let took = self.began.elapsed().saturating_sub(began);
                state = self.state.lock();
                state.time_loading += took;
                if took > state.longest_load.0 {
                    state.longest_load = (took, began, bytes);
                }
                self.add_parsed_file(&mut state, index, parsed, false);
                let queued;
                (state, queued) = self.queue_found_files(state, start.plugin_reader);
                state.in_progress -= 1;
                if state.has_files_to_read() || state.in_progress == 0 {
                    self.has_to_read.notify_all();
                }
                if state.in_progress == 0 {
                    self.has_changed.notify_all();
                } else if reads {
                    let for_others = queued.div_ceil(READ_BATCH_SIZE).saturating_sub(1);
                    notify_for_work(&self.has_changed, for_others, context.host.threads());
                }
            } else if state.in_progress == 0
                && !state.has_files_to_read()
                && state.to_read_by_plugin.is_empty()
            {
                if !state.pending_assets.is_empty() {
                    let pending_assets = std::mem::take(&mut state.pending_assets);
                    let has_deferred_reads = !state.deferred.is_empty();
                    state.in_progress += pending_assets.len();
                    drop(state);
                    self.finish_without_assets(
                        pending_assets,
                        has_deferred_reads,
                        start.plugin_reader,
                    );
                    state = self.state.lock();
                    continue;
                }
                if !state.deferred.is_empty() {
                    let deferred = std::mem::take(&mut state.deferred);
                    state.in_progress += deferred.len();
                    drop(state);
                    self.read_deferred(deferred);
                    state = self.state.lock();
                    continue;
                }
                if !std::mem::replace(&mut state.is_drained, true) {
                    self.has_changed.notify_all();
                }
                if processes || state.is_finished {
                    return;
                }
                self.has_to_read.wait_guarded(&mut state);
            } else {
                state.asleep += 1;
                self.allow_early_load(&mut state, start.early_loader);
                let since = self.now_if_logged();
                match processes {
                    true => self.has_changed.wait_guarded(&mut state),
                    false => self.has_to_read.wait_guarded(&mut state),
                }
                if let Some(since) = since {
                    state.time_asleep += self.began.elapsed().saturating_sub(since);
                }
                state.asleep -= 1;
            }
        }
    }

    fn finish_without_assets(
        &self,
        pending_assets: Vec<u32>,
        has_deferred_reads: bool,
        start_plugin_reader: StartPluginReader<'_>,
    ) {
        let paths = self.paths_of(&pending_assets);
        let reads_in_background =
            !has_deferred_reads && self.context.host.start_background_reads(&paths);
        if reads_in_background && !self.context.host.reads_in_background_after_load() {
            (self.spawn_background_readers)(paths.iter().map(|path| path.to_vec()).collect());
        }
        let mut state = self.state.lock();
        if reads_in_background {
            let empty = Cow::Borrowed(&b""[..]);
            state.ready.extend(
                pending_assets
                    .into_iter()
                    .map(|index| (index, empty.clone())),
            );
        } else {
            state.background_reads_disabled = true;
            let count = pending_assets.len();
            state.found.extend(pending_assets);
            (state, _) = self.queue_found_files(state, start_plugin_reader);
            state.in_progress -= count;
            self.has_to_read.notify_all();
        }
        self.has_changed.notify_all();
    }

    fn is_code_file(&self, path: &[u8]) -> bool {
        let path = to_path(path, self.context.is_case_sensitive);
        self.paths_without_loader.get_ref(&*path).is_some()
    }

    fn read(&self, batch: Vec<u32>) {
        let paths = self.paths_of(&batch);
        for (index, path) in batch.into_iter().zip(paths) {
            self.read_one(index, path);
        }
    }

    fn read_one(&self, index: u32, path: &[u8]) {
        match self.context.host.read_code(path) {
            CodeRead::Text(text) => {
                self.state.lock().ready.push_back((index, text));
                self.has_changed.notify_one();
            }
            CodeRead::Deferred => {
                let mut state = self.state.lock();
                state.deferred.push(index);
                state.in_progress -= 1;
            }
        }
    }

    fn read_deferred(&self, files: Vec<u32>) {
        let texts: FxHashMap<Vec<u8>, Cow<'static, [u8]>> =
            (self.context.host.finish_deferred_reads().into_iter()).collect();
        let paths = self.paths_of(&files);
        let ready: Vec<(u32, Cow<'static, [u8]>)> = (files.into_iter().zip(paths))
            .map(|(index, path)| (index, texts.get(path).cloned().unwrap_or_default()))
            .collect();
        self.state.lock().ready.extend(ready);
        self.has_changed.notify_all();
    }

    fn paths_of(&self, files: &[u32]) -> Vec<&'r [u8]> {
        let state = self.state.lock();
        let path_of = |&index: &u32| state.files[index as usize].target.key.path;
        files.iter().map(path_of).collect()
    }
}

struct WalkedCode<'w, 's, 'r> {
    session: &'s Session,
    atoms: Interner<'s>,
    files: &'w [WalkedFile<'s, 'r>],
    answers: Vec<OnceLock<(Vec<CodeAnswer<'s>>, Vec<CodeAnswer<'s>>)>>,
    entry_points: Vec<FileId>,
    compiled_files: Vec<FileId>,
}

impl<'w, 's, 'r> WalkedCode<'w, 's, 'r> {
    fn new(
        context: &CodeLoadContext<'_, 's, 'r>,
        state: &'w WalkState<'s, 'r>,
    ) -> WalkedCode<'w, 's, 'r> {
        let files = &state.files[..];
        let entry_points: Vec<u32> = (context.entry_points().iter())
            .map(|it| state.index_of[&context.canonical_key(it.key)])
            .collect();
        let mut compiled_files = Vec::with_capacity(files.len());
        let mut seen = vec![false; files.len()];
        let mut stack: Vec<(u32, usize)> = Vec::new();
        for &root in &entry_points {
            if !std::mem::replace(&mut seen[root as usize], true) {
                stack.push((root, 0));
            }
            while let Some(top) = stack.last_mut() {
                let (index, next) = *top;
                match files[index as usize].targets.get(next) {
                    Some(&reached) => {
                        top.1 += 1;
                        if reached != NOT_LOADED
                            && !std::mem::replace(&mut seen[reached as usize], true)
                        {
                            stack.push((reached, 0));
                        }
                    }
                    None => {
                        if files[index as usize].parsed.is_some() {
                            compiled_files.push(FileId(index));
                        }
                        stack.pop();
                    }
                }
            }
        }
        WalkedCode {
            session: context.session,
            atoms: context.atoms,
            files,
            answers: files.iter().map(|_| OnceLock::new()).collect(),
            entry_points: entry_points.into_iter().map(FileId).collect(),
            compiled_files,
        }
    }

    fn parsed(&self, file: FileId) -> &'w ParsedCodeFile<'s, 'r> {
        let parsed = self.files[file.idx()].parsed.as_deref();
        parsed.expect("a file without a tree")
    }
}

impl<'s> CodeView<'s> for WalkedCode<'_, 's, '_> {
    fn atoms(&self) -> &Interner<'s> {
        &self.atoms
    }

    fn hir(&self, file: FileId) -> &hir::File<'s> {
        &self.parsed(file).parse.hir
    }

    fn bound(&self, file: FileId) -> &Bound<'s> {
        &self.parsed(file).parse.bound
    }

    fn analysis(&self, file: FileId) -> &FileAnalysis<'s> {
        &self.parsed(file).code.analyzed.analysis
    }

    fn answers(&self, file: FileId) -> Option<(&[CodeAnswer<'s>], &[CodeAnswer<'s>])> {
        let walked = &self.files[file.idx()];
        let code = &walked.parsed.as_ref()?.code;
        let (written, implied) = self.answers[file.idx()].get_or_init(|| {
            let target_files: Vec<Option<FileId>> = (walked.targets.iter())
                .map(|&target| (target != NOT_LOADED).then_some(FileId(target)))
                .collect();
            find_answers_so_far(&self.atoms, self.session.arena(), code, &target_files)
        });
        Some((written, implied))
    }

    fn file_name(&self, file: FileId) -> &[u8] {
        self.files[file.idx()].target.key.path
    }

    fn entry_points(&self) -> &[FileId] {
        &self.entry_points
    }

    fn compiled_files(&self) -> &[FileId] {
        &self.compiled_files
    }

    fn host_payload(&self, file: FileId) -> Option<&(dyn std::any::Any + Send + Sync)> {
        self.files[file.idx()].parsed.as_ref()?.payload.as_deref()
    }
}

const FILES_OF_ONE_SHARE: usize = 1024;

fn work_off_shares(host: &dyn Host, count: usize, work: &(dyn Fn(usize) + Sync)) {
    match count {
        1 => work(0),
        _ => host.parallel(count, work),
    }
}

fn find_in_every_file<'s, 'r, T: Send>(
    host: &dyn Host,
    files: &[WalkedFile<'s, 'r>],
    find: &(dyn Fn(&WalkedFile<'s, 'r>) -> Option<T> + Sync),
) -> Vec<(u32, T)> {
    let shares: Vec<&[WalkedFile<'s, 'r>]> = files.chunks(FILES_OF_ONE_SHARE).collect();
    let found: Vec<Guarded<Vec<(u32, T)>>> =
        shares.iter().map(|_| Guarded::new(Vec::new())).collect();
    work_off_shares(host, shares.len(), &|share| {
        let first = (share * FILES_OF_ONE_SHARE) as u32;
        let files = (first..).zip(shares[share]);
        *found[share].lock() = files
            .filter_map(|(index, file)| Some((index, find(file)?)))
            .collect();
    });
    let found = found.into_iter();
    found
        .flat_map(|mut of_share| std::mem::take(of_share.get_mut()))
        .collect()
}

fn take_noted_files<'s, 'r>(
    noted: &mut Vec<u32>,
    files: &[WalkedFile<'s, 'r>],
    holds: impl Fn(&WalkedFile<'s, 'r>) -> bool,
) -> Vec<u32> {
    let mut noted = std::mem::take(noted);
    noted.shared_sort_unstable();
    noted.dedup();
    noted.retain(|&file| holds(&files[file as usize]));
    debug_assert!(
        (0..files.len() as u32)
            .filter(|&file| holds(&files[file as usize]))
            .eq(noted.iter().copied()),
        "a file has got its analysis past `add_parsed_file`, or is out to be revisited"
    );
    noted
}

fn drop_parsed_file(state: &mut WalkState<'_, '_>, index: u32) {
    let file = &mut state.files[index as usize];
    file.parsed = None;
    file.targets.clear();
    state.barrels.forget_parsed_file(index);
}

fn forget_parsed_file(state: &mut WalkState<'_, '_>, index: u32) {
    drop_parsed_file(state, index);
    state.found.push(index);
}

fn forget_files_folded_with_main_module(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    if !context.host.may_any_file_become_main_module() {
        return false;
    }
    let is_decided = |file: &WalkedFile<'_, '_>| {
        file.parsed.as_ref().is_some_and(|parsed| {
            let analyzed = &parsed.code.analyzed;
            analyzed.import_meta_main.is_some() && analyzed.analysis.asks_for_main_module
        })
    };
    let decided = take_noted_files(&mut state.askers_for_main_module, &state.files, is_decided);
    for &index in &decided {
        forget_parsed_file(state, index);
    }
    !decided.is_empty()
}

fn forget_targets(state: &mut WalkState<'_, '_>, index: u32) {
    state.files[index as usize].targets.clear();
    state.barrels.forget_folded_file(index);
}

fn revisit_file(
    state: &mut WalkState<'_, '_>,
    index: u32,
    analyzed_again_from: Option<AnalyzedAgainFrom>,
) {
    let loaded = state.files[index as usize].parsed.take();
    state.to_revisit.push(FileToRevisit {
        index,
        loaded: loaded.expect("the file is parsed"),
        analyzed_again_from,
    });
}

fn fold_parsed_file_again(state: &mut WalkState<'_, '_>, index: u32) {
    forget_targets(state, index);
    revisit_file(state, index, Some(AnalyzedAgainFrom::Folding));
}

fn scan_parsed_file_again(state: &mut WalkState<'_, '_>, index: u32) {
    forget_targets(state, index);
    revisit_file(state, index, Some(AnalyzedAgainFrom::ImportScan));
}

fn finish_files(state: &mut WalkState<'_, '_>) -> bool {
    let mut unfinished = std::mem::take(&mut state.unfinished);
    unfinished.shared_sort_unstable();
    unfinished.dedup();
    for &index in &unfinished {
        revisit_file(state, index, None);
    }
    !unfinished.is_empty()
}

fn find_names_written_in(hir: &hir::File<'_>, site: ImportSiteKind) -> FxHashSet<Atom> {
    match site {
        ImportSiteKind::Import(import) => {
            let named = hir[import].named.iter();
            named.map(|it| hir[it].imported).collect()
        }
        ImportSiteKind::ExportFrom(statement) => {
            let items = hir[statement].items.iter();
            items.map(|it| hir[it].local).collect()
        }
        _ => FxHashSet::default(),
    }
}

fn names_export(
    hir: &hir::File<'_>,
    site: ImportSiteKind,
    written: &FxHashSet<Atom>,
    export: Atom,
) -> bool {
    match site {
        ImportSiteKind::Import(import) => {
            let import = &hir[import];
            import.namespace.is_some()
                || export == known::default && import.default.is_some()
                || written.contains(&export)
        }
        ImportSiteKind::ExportFrom(_) => written.contains(&export),
        ImportSiteKind::ExportStar(statement) => {
            let passes_names_on = matches!(hir[statement].kind, StmtKind::ExportStar { alias, .. } if alias.is_none());
            passes_names_on && export != known::default
        }
        _ => false,
    }
}

fn find_imported_requires(
    atoms: &Interner<'_>,
    files: &[WalkedFile<'_, '_>],
    file: &WalkedFile<'_, '_>,
) -> Vec<ImportedRequire> {
    let Some(parsed) = &file.parsed else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut next_target = 0;
    let sites = parsed.code.analyzed.analysis.import_sites;
    for (site, &resolution) in sites.iter().zip(&parsed.code.resolutions) {
        let target = next_target;
        next_target += files_of(resolution).count();
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            continue;
        };
        if next_target == target || file.targets[target] == NOT_LOADED {
            continue;
        }
        let exporter = &files[file.targets[target] as usize];
        let Some(exporting) = &exporter.parsed else {
            continue;
        };
        if exporting.code.exported_requires.is_empty() {
            continue;
        }
        let written = find_names_written_in(&parsed.parse.hir, site.kind);
        for require in &exporting.code.exported_requires {
            if names_export(&parsed.parse.hir, site.kind, &written, require.export) {
                found.push(ImportedRequire {
                    specifier,
                    export: require.export,
                    path: (require.path).unwrap_or_else(|| atoms.intern(exporter.target.key.path)),
                    is_made: require.is_made,
                    other_values: require.other_values,
                });
            }
        }
    }
    found
}

fn scan_importers_of_requires_again(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    if !state.has_exported_requires {
        return false;
    }
    let ImportersOfRequires {
        scanned_again,
        mut by_exporter,
    } = std::mem::take(&mut state.importers_of_requires);
    let files = &state.files[..];
    let importers = match scanned_again {
        None => find_in_every_file(context.host, files, &|file| {
            find_requires_not_yet_imported(&context.atoms, files, file)
        }),
        Some(scanned_again) => {
            let importers = match &mut by_exporter {
                Some(importers) => {
                    note_importers(importers, files, scanned_again.iter().copied());
                    importers
                }
                None => {
                    let importers = by_exporter.insert(FxHashMap::default());
                    note_importers(importers, files, 0..files.len() as u32);
                    importers
                }
            };
            let of_scanned = scanned_again
                .iter()
                .filter_map(|index| importers.get(index));
            let mut due: Vec<u32> = of_scanned.flatten().copied().collect();
            due.extend(&scanned_again);
            due.shared_sort_unstable();
            due.dedup();
            let learned = due.into_iter().filter_map(|index| {
                let file = &files[index as usize];
                Some((
                    index,
                    find_requires_not_yet_imported(&context.atoms, files, file)?,
                ))
            });
            learned.collect()
        }
    };
    let scanned_again = importers.iter().map(|importer| importer.0).collect();
    let has_importers = !importers.is_empty();
    for (index, found) in importers {
        state.files[index as usize].imported_requires = found;
        scan_parsed_file_again(state, index);
    }
    state.importers_of_requires = ImportersOfRequires {
        scanned_again: Some(scanned_again),
        by_exporter,
    };
    has_importers
}

fn find_requires_not_yet_imported(
    atoms: &Interner<'_>,
    files: &[WalkedFile<'_, '_>],
    file: &WalkedFile<'_, '_>,
) -> Option<Vec<ImportedRequire>> {
    let found = find_imported_requires(atoms, files, file);
    (found != file.imported_requires).then_some(found)
}

fn note_importers(
    importers: &mut FxHashMap<u32, Vec<u32>>,
    files: &[WalkedFile<'_, '_>],
    importing: impl Iterator<Item = u32>,
) {
    for index in importing {
        for &target in &files[index as usize].targets {
            if target != NOT_LOADED {
                importers.entry(target).or_default().push(index);
            }
        }
    }
}

fn read_text_of_data(mut value: &DataValue<'_>, atoms: &Interner<'_>, path: &[u8]) -> Option<Atom> {
    for key in bun_core::strings::split(path, b"\0") {
        value = match *value {
            DataValue::Object(properties) => {
                let name = atoms.intern(key);
                &properties.iter().rfind(|it| it.0 == name)?.1
            }
            DataValue::Array(places) => {
                let index: usize = std::str::from_utf8(key).ok()?.parse().ok()?;
                places.get(index)?
            }
            _ => return None,
        };
    }
    match *value {
        DataValue::String(text) => Some(text),
        _ => None,
    }
}

fn find_texts_of_data_files(
    atoms: &Interner<'_>,
    files: &[WalkedFile<'_, '_>],
    file: &WalkedFile<'_, '_>,
) -> Vec<TextOfDataFile> {
    let Some(parsed) = &file.parsed else {
        return Vec::new();
    };
    let analysis = &parsed.code.analyzed.analysis;
    let asked = analysis.asked_of_data_files;
    let mut found = Vec::new();
    let mut next_target = 0;
    for (site, &resolution) in (analysis.import_sites.iter()).zip(&parsed.code.resolutions) {
        let target = next_target;
        next_target += files_of(resolution).count();
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            continue;
        };
        if let ImportSiteKind::RequireResolve(call) | ImportSiteKind::ImportMetaResolve(call) =
            site.kind
        {
            let path = atoms.intern(&write_question_where_file_lies(call));
            let own_folder = folder_of(file.target.key.path);
            if asked.contains(&(specifier, path))
                && let Some(answer) = files_of(resolution).next()
                && let Some(text) = write_from_other_folder(answer.path, b"", own_folder)
            {
                let text = atoms.intern(&text);
                found.push(TextOfDataFile {
                    specifier,
                    path,
                    text,
                });
            }
            continue;
        }
        if next_target == target || file.targets[target] == NOT_LOADED {
            continue;
        }
        let Some(holder) = &files[file.targets[target] as usize].parsed else {
            continue;
        };
        let [(_, HostValue::Data(data))] = holder.code.analyzed.host_values else {
            continue;
        };
        for &(_, path) in asked.iter().filter(|it| it.0 == specifier) {
            if let Some(text) = read_text_of_data(data, atoms, atoms.bytes(path)) {
                found.push(TextOfDataFile {
                    specifier,
                    path,
                    text,
                });
            }
        }
    }
    found.shared_sort_unstable_by_key(|it| (it.specifier.0, it.path.0, it.text.0));
    found.dedup();
    found
}

fn scan_askers_of_data_files_again(atoms: &Interner<'_>, state: &mut WalkState<'_, '_>) -> bool {
    let asks = |file: &WalkedFile<'_, '_>| {
        (file.parsed.as_ref())
            .is_some_and(|it| !it.code.analyzed.analysis.asked_of_data_files.is_empty())
    };
    let asking = take_noted_files(&mut state.askers_of_data_files, &state.files, asks);
    let mut askers: Vec<(u32, Vec<TextOfDataFile>)> = Vec::new();
    for &index in &asking {
        let file = &state.files[index as usize];
        let found = find_texts_of_data_files(atoms, &state.files, file);
        if found != file.texts_of_data_files {
            askers.push((index, found));
        }
    }
    state.askers_of_data_files = asking;
    let has_askers = !askers.is_empty();
    for (index, found) in askers {
        state.files[index as usize].texts_of_data_files = found;
        scan_parsed_file_again(state, index);
    }
    has_askers
}

fn find_imported_file_changers(
    atoms: &Interner<'_>,
    files: &[WalkedFile<'_, '_>],
    file: &WalkedFile<'_, '_>,
) -> Vec<ImportedFileChanger> {
    let Some(parsed) = &file.parsed else {
        return Vec::new();
    };
    let mut found = Vec::new();
    let mut next_target = 0;
    let sites = parsed.code.analyzed.analysis.import_sites;
    for (site, &resolution) in sites.iter().zip(&parsed.code.resolutions) {
        let target = next_target;
        next_target += files_of(resolution).count();
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            continue;
        };
        if next_target == target || file.targets[target] == NOT_LOADED {
            continue;
        }
        let exporter = &files[file.targets[target] as usize];
        let Some(exporting) = &exporter.parsed else {
            continue;
        };
        let exported = exporting.code.analyzed.analysis.exported_file_changers;
        found.extend(exported.iter().filter_map(|it| {
            let start = match it.starts_at_own_directory {
                false => it.start,
                true => atoms.intern(&write_start_from_other_folder(
                    atoms.bytes(it.start),
                    folder_of(exporter.target.key.path),
                    folder_of(file.target.key.path),
                )?),
            };
            Some(ImportedFileChanger {
                specifier,
                export: it.export,
                place: it.place,
                reaches_below: it.reaches_below,
                start,
                end: it.end,
                starts_at_own_directory: it.starts_at_own_directory,
            })
        }));
    }
    found.shared_sort_unstable_by_key(|it| {
        (it.specifier.0, it.export.0, it.place, it.reaches_below)
    });
    found.dedup();
    found
}

fn scan_importers_of_file_changers_again(
    context: &CodeLoadContext<'_, '_, '_>,
    state: &mut WalkState<'_, '_>,
) -> bool {
    if !state.has_exported_file_changers
        || !context
            .inputs
            .code
            .follows_paths_to_functions_of_other_files
    {
        return false;
    }
    let files = &state.files[..];
    let importers = find_in_every_file(context.host, files, &|file| {
        let found = find_imported_file_changers(&context.atoms, files, file);
        (found != file.imported_file_changers).then_some(found)
    });
    let has_importers = !importers.is_empty();
    for (index, found) in importers {
        state.files[index as usize].imported_file_changers = found;
        scan_parsed_file_again(state, index);
    }
    has_importers
}

fn folder_of(path: &[u8]) -> &[u8] {
    &path[..bun_core::strings::last_index_of_char(path, b'/').unwrap_or(0)]
}

fn find_texts_of_other_files<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    files: &[WalkedFile<'s, '_>],
    file: &WalkedFile<'s, '_>,
) -> Vec<TextOfOtherFile> {
    let Some(parsed) = &file.parsed else {
        return Vec::new();
    };
    let atoms = &context.atoms;
    let analysis = &parsed.code.analyzed.analysis;
    let asked = analysis.asked_of_other_files;
    let mut found = Vec::new();
    let mut next_target = 0;
    for (site, &resolution) in (analysis.import_sites.iter()).zip(&parsed.code.resolutions) {
        let target = next_target;
        next_target += files_of(resolution).count();
        let ImportSpecifier::Constant(specifier) = site.specifier else {
            continue;
        };
        if next_target == target
            || file.targets[target] == NOT_LOADED
            || !asked.iter().any(|it| it.0 == specifier)
        {
            continue;
        }
        let holder = &files[file.targets[target] as usize];
        let Some(holding) = &holder.parsed else {
            continue;
        };
        let analyzed = &holding.code.analyzed;
        let inputs = FileInputs {
            declared_module_type: analyzed.declared_module_type,
            import_meta_main: analyzed.import_meta_main,
            is_library: false,
            host_values: analyzed.host_values,
            jsx: analyzed.jsx_mode,
            own_name: (context.session.arena())
                .alloc_slice_copy(bun_paths::basename_posix(holder.target.key.path)),
        };
        let texts = find_texts_of_exports(
            &holding.parse.hir,
            &holding.parse.bound,
            &analyzed.analysis.decisions,
            context.inputs.fold,
            &inputs,
            atoms,
        );
        for text in texts {
            if !asked.contains(&(specifier, text.export)) {
                continue;
            }
            let written = match text.starts_at_own_directory {
                false => Some(text.text),
                true => write_from_other_folder(
                    atoms.bytes(text.text),
                    folder_of(holder.target.key.path),
                    folder_of(file.target.key.path),
                )
                .map(|written| atoms.intern(&written)),
            };
            found.extend(written.map(|written| TextOfOtherFile {
                specifier,
                export: text.export,
                text: written,
                starts_at_own_directory: text.starts_at_own_directory,
            }));
        }
    }
    found.shared_sort_unstable_by_key(|it| (it.specifier.0, it.export.0, it.text.0));
    found.dedup();
    found
}

fn scan_askers_of_other_files_again<'s>(
    context: &CodeLoadContext<'_, 's, '_>,
    state: &mut WalkState<'s, '_>,
) -> bool {
    if !context
        .inputs
        .code
        .follows_paths_to_functions_of_other_files
    {
        return false;
    }
    let asks = |file: &WalkedFile<'_, '_>| {
        (file.parsed.as_ref())
            .is_some_and(|it| !it.code.analyzed.analysis.asked_of_other_files.is_empty())
    };
    let asking = take_noted_files(&mut state.askers_of_other_files, &state.files, asks);
    let mut askers: Vec<(u32, Vec<TextOfOtherFile>)> = Vec::new();
    for &index in &asking {
        let file = &state.files[index as usize];
        let found = find_texts_of_other_files(context, &state.files, file);
        if found != file.texts_of_other_files {
            askers.push((index, found));
        }
    }
    state.askers_of_other_files = asking;
    let has_askers = !askers.is_empty();
    for (index, found) in askers {
        state.files[index as usize].texts_of_other_files = found;
        scan_parsed_file_again(state, index);
    }
    has_askers
}

fn erase_sites_nothing_asked_for(state: &mut WalkState<'_, '_>) {
    for (file, waiting) in std::mem::take(&mut state.barrels).into_waiting() {
        let file = &mut state.files[file as usize];
        let parsed = file.parsed.as_mut().expect("a barrel is parsed");
        erase_waiting_sites(&mut parsed.code, &mut file.targets, &waiting);
    }
}

fn find_files_required_in_place_of_others<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    state: &WalkState<'_, 'r>,
) -> FxHashMap<u32, u32> {
    let index_of = |path: &[u8]| {
        let path = to_path(path, context.is_case_sensitive);
        let key = LoadKey {
            path: &path,
            loader: HostLoader::default(),
        };
        state.index_of.get(&key).copied()
    };
    let mut replacements = FxHashMap::default();
    for (imported, required) in context.resolver.files_required_in_place_of_others() {
        let Some((index, required)) = index_of(imported).zip(index_of(required)) else {
            continue;
        };
        if state.files[index as usize].target.key.path == imported {
            replacements.insert(index, required);
        }
    }
    replacements
}

fn import_what_is_required<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    state: &mut WalkState<'_, 'r>,
) {
    let replacements = find_files_required_in_place_of_others(context, state);
    if replacements.is_empty() {
        return;
    }
    let target_of = |file: u32| state.files[file as usize].target;
    let replacements: FxHashMap<u32, (u32, CodeTarget<'r>)> = (replacements.into_iter())
        .map(|(imported, required)| (imported, (required, target_of(required))))
        .collect();
    let shares = state.files.chunks_mut(FILES_OF_ONE_SHARE);
    let shares: Vec<Guarded<&mut [WalkedFile<'_, 'r>]>> = shares.map(Guarded::new).collect();
    work_off_shares(context.host, shares.len(), &|share| {
        for file in shares[share].lock().iter_mut() {
            let Some(parsed) = &mut file.parsed else {
                continue;
            };
            for (loaded, target) in file.targets.iter_mut().zip(&mut parsed.code.targets) {
                if let Some(&(required, required_target)) = replacements.get(loaded) {
                    *loaded = required;
                    *target = CodeTarget {
                        increases_depth: target.increases_depth,
                        ..required_target
                    };
                }
            }
        }
    });
}

struct OrderedFiles<'s, 'r> {
    entries: Vec<CodeEntry<'s, 'r>>,
    entry_points: Vec<u32>,
    parsed: Vec<ParsedSlot<'s, 'r>>,
    steps: Vec<Vec<bool>>,
}

fn share_modules_among_types<'r>(
    files: &mut [WalkedFile<'_, 'r>],
    mut entry_points: VecDeque<u32>,
    scanned: usize,
) {
    let is_call_with_written_type = |target: &CodeTarget<'_>| {
        !target.has_shared_type
            && target.has_type_of_shared_kind
            && target.has_loader_attribute
            && target.is_linked_by_bundler
    };
    let is_shared = |target: &CodeTarget<'_>| {
        target.has_shared_type || (scanned > 0 && is_call_with_written_type(target))
    };
    let has_shared_type = |file: &WalkedFile<'_, '_>| file.code_targets().iter().any(is_shared);
    if !files.iter().any(has_shared_type) {
        return;
    }
    let mut first_forms: FxHashMap<&'r [u8], u32> = FxHashMap::default();
    let mut seen = vec![false; files.len()];
    let mut scanned_level: Vec<u32> = entry_points.drain(..scanned).collect();
    while !scanned_level.is_empty() {
        scanned_level.retain(|&index| !std::mem::replace(&mut seen[index as usize], true));
        for shares_statements in [true, false] {
            for &index in &scanned_level {
                for next in 0..files[index as usize].code_targets().len() {
                    let target = files[index as usize].code_targets()[next];
                    if is_shared(&target) && target.has_shared_type == shares_statements {
                        share_form(files, &mut first_forms, index, next);
                    }
                }
            }
        }
        let targets = scanned_level
            .iter()
            .flat_map(|&index| &files[index as usize].targets);
        scanned_level = targets.copied().collect();
    }
    let (mut level, mut later) = (VecDeque::new(), entry_points);
    while let Some(index) = level.pop_front().or_else(|| later.pop_front()) {
        if std::mem::replace(&mut seen[index as usize], true) {
            continue;
        }
        for next in 0..files[index as usize].code_targets().len() {
            let target = files[index as usize].code_targets()[next];
            if target.has_shared_type {
                share_form(files, &mut first_forms, index, next);
            }
            let reached = files[index as usize].targets[next];
            match target.is_loaded_with_importer {
                true => level.push_back(reached),
                false => later.push_back(reached),
            }
        }
    }
}

fn share_form<'r>(
    files: &mut [WalkedFile<'_, 'r>],
    first_forms: &mut FxHashMap<&'r [u8], u32>,
    index: u32,
    next: usize,
) {
    let file = &files[index as usize];
    let path = file.code_targets()[next].key.path;
    let reached = *first_forms.entry(path).or_insert(file.targets[next]);
    let key = files[reached as usize].target.key;
    let file = &mut files[index as usize];
    file.targets[next] = reached;
    if let Some(parsed) = &mut file.parsed {
        parsed.code.targets[next].key = key;
    }
}

fn order_files<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    state: &mut WalkState<'s, 'r>,
) -> OrderedFiles<'s, 'r> {
    let (files, index_of) = (&mut state.files, &state.index_of);
    let entry_points = context.entry_points();
    let (first, others): (Vec<_>, Vec<_>) =
        (entry_points.iter().copied()).partition(|it| context.runs_first(it.key));
    let indexes = first.into_iter().chain(others);
    let indexes = indexes.map(|it| index_of[&context.canonical_key(it.key)]);
    let scanned = match context.inputs.code.builds_executable {
        true => context.written_entry_point_count(),
        false => 0,
    };
    share_modules_among_types(files, indexes.collect(), scanned);
    let mut roots: Vec<u32> = Vec::with_capacity(entry_points.len());
    let mut order: Vec<u32> = Vec::with_capacity(files.len());
    let mut seen = vec![false; files.len()];
    let mut stack: Vec<(u32, usize)> = Vec::new();
    for entry_point in &entry_points {
        let root = index_of[&context.canonical_key(entry_point.key)];
        roots.push(root);
        if !std::mem::replace(&mut seen[root as usize], true) {
            files[root as usize].target.key = entry_point.key;
            stack.push((root, 0));
        }
        while let Some(top) = stack.last_mut() {
            let (index, next) = *top;
            let file = &files[index as usize];
            match file.code_targets().get(next) {
                Some(&target) => {
                    let reached = file.targets[next];
                    top.1 += 1;
                    if !std::mem::replace(&mut seen[reached as usize], true) {
                        files[reached as usize].target.key = target.key;
                        stack.push((reached, 0));
                    }
                }
                None => {
                    order.push(index);
                    stack.pop();
                }
            }
        }
    }
    debug_assert!(order.len() <= files.len());

    let mut entry_of = vec![0u32; files.len()];
    for (entry, &index) in order.iter().enumerate() {
        entry_of[index as usize] = entry as u32;
    }
    let mut ordered = OrderedFiles {
        entries: Vec::with_capacity(order.len()),
        entry_points: (roots.iter().map(|&root| entry_of[root as usize])).collect(),
        parsed: Vec::with_capacity(order.len()),
        steps: Vec::with_capacity(order.len()),
    };
    for &index in &order {
        let file = &mut files[index as usize];
        let steps = file.code_targets().iter();
        let steps = steps.map(|target| target.increases_depth).collect();
        let mut targets = std::mem::take(&mut file.targets);
        for target in &mut targets {
            *target = entry_of[*target as usize];
        }
        ordered.steps.push(steps);
        ordered.entries.push(CodeEntry {
            key: file.target.key,
            host_module: file.target.host_module,
            role: match &file.parsed {
                Some(parsed) => FileRole::of_tree(&parsed.parse.hir),
                None => FileRole::TypesOnly,
            },
            package_depth: u32::MAX,
            targets,
            predicted_type_files: Vec::new(),
            jsdoc_imports: Vec::new(),
            loaded: Guarded::new(None),
            code: Guarded::new(None),
            payload: None,
            settings: None,
            package: None,
            side_effects: DeclaredSideEffects::Unspecified,
            file: None,
        });
        ordered.parsed.push(Guarded::new(file.parsed.take()));
    }
    ordered
}

fn compute_package_depths(
    entries: &mut [CodeEntry<'_, '_>],
    entry_points: &[u32],
    steps: &[Vec<bool>],
) {
    let mut queue: VecDeque<(u32, u32)> = VecDeque::new();
    for &entry_point in entry_points {
        let depth = &mut entries[entry_point as usize].package_depth;
        if std::mem::replace(depth, 0) != 0 {
            queue.push_back((entry_point, 0));
        }
    }
    while let Some((index, depth)) = queue.pop_front() {
        let index = index as usize;
        if entries[index].package_depth != depth {
            continue;
        }
        for (at, &increases_depth) in steps[index].iter().enumerate() {
            let target = entries[index].targets[at];
            let target_depth = depth + u32::from(increases_depth);
            let lowest_depth = &mut entries[target as usize].package_depth;
            if target_depth >= *lowest_depth {
                continue;
            }
            *lowest_depth = target_depth;
            match increases_depth {
                true => queue.push_back((target, target_depth)),
                false => queue.push_front((target, target_depth)),
            }
        }
    }
}

fn copy_to_session<'s, 'r>(
    session: &'s Session,
    entries: &mut [CodeEntry<'s, 'r>],
    parsed: &[ParsedSlot<'s, 'r>],
) {
    let arena = session.arena();
    let mut settings: FxHashMap<&'r TranspileSettings, &'s TranspileSettings> =
        FxHashMap::default();
    let mut packages: FxHashMap<&'r [u8], EnclosingPackage<'s>> = FxHashMap::default();
    let mut listed: FxHashMap<&'r [u8], DeclaredSideEffects<'s>> = FxHashMap::default();
    for (entry, parsed) in entries.iter_mut().zip(parsed) {
        let parsed = parsed.lock();
        let Some(parsed) = &*parsed else {
            continue;
        };
        let analyzed = &parsed.code.analyzed;
        let copy = settings.entry(analyzed.settings);
        entry.settings = Some(*copy.or_insert_with(|| session.keep(analyzed.settings.clone())));
        entry.package = analyzed.package.map(|package| {
            let copy = packages.entry(package.directory);
            *copy.or_insert_with(|| EnclosingPackage {
                directory: slice_in(package.directory, arena),
                name: slice_in(package.name, arena),
                version: slice_in(package.version, arena),
            })
        });
        entry.side_effects = match analyzed.side_effects {
            DeclaredSideEffects::Unspecified => DeclaredSideEffects::Unspecified,
            DeclaredSideEffects::None => DeclaredSideEffects::None,
            DeclaredSideEffects::Listed {
                directory,
                entries: patterns,
            } => *listed.entry(directory).or_insert_with(|| {
                let patterns = patterns.iter().map(|pattern| slice_in(pattern, arena));
                DeclaredSideEffects::Listed {
                    directory: slice_in(directory, arena),
                    entries: arena.alloc_slice_fill_iter(patterns),
                }
            }),
        };
    }
}

#[cfg(test)]
mod tests;
