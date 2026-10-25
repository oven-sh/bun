use super::code_barrels::{BarrelRequests, NOT_LOADED, erase_waiting_sites};
use super::code_file::load_code_file;
use super::code_imports::files_of;
use super::code_load::{CodeEntry, CodeTarget, LoadKey, ParsedCodeFile};
use super::code_types::predicted_type_files;
use super::*;
use crate::import_sites::{ImportSiteKind, ImportSpecifier};
use crate::resolve::{
    CodeRead, DeclaredSideEffects, EnclosingPackage, HostPayload, TranspileSettings,
    is_declaration_file_name,
};
use bun_threading::Condvar;
use std::collections::VecDeque;
use std::sync::OnceLock;

const READ_BATCH_SIZE: usize = 16;
const MAX_READY_TEXTS: usize = 256;
const MAX_PLUGIN_READERS: usize = 64;

type ParsedSlot<'s, 'r> = Guarded<Option<Box<ParsedCodeFile<'s, 'r>>>>;
type EntryUpdate<'r> = (Option<HostPayload>, Vec<(&'r [u8], bool)>);

struct WalkedFile<'s, 'r> {
    target: CodeTarget<'r>,
    parsed: Option<Box<ParsedCodeFile<'s, 'r>>>,
    targets: Vec<u32>,
    is_called_before_it_runs: bool,
    imported_requires: Vec<ImportedRequire>,
}

impl<'r> WalkedFile<'_, 'r> {
    fn code_targets(&self) -> &[CodeTarget<'r>] {
        match &self.parsed {
            Some(parsed) => &parsed.code.targets,
            None => &[],
        }
    }
}

#[derive(Default)]
struct WalkState<'s, 'r> {
    files: Vec<WalkedFile<'s, 'r>>,
    index_of: FxHashMap<LoadKey<'r>, u32>,
    found: Vec<u32>,
    to_read: VecDeque<u32>,
    to_read_by_plugin: VecDeque<u32>,
    plugin_readers: usize,
    idle_plugin_readers: usize,
    pending_assets: Vec<u32>,
    background_reads_disabled: bool,
    early_loaders: usize,
    has_plugin_reader: bool,
    is_finished: bool,
    ready: Vec<(u32, Cow<'static, [u8]>)>,
    deferred: Vec<u32>,
    in_progress: usize,
    barrels: BarrelRequests,
    has_exported_requires: bool,
}

impl WalkState<'_, '_> {
    fn has_idle_threads(&self) -> bool {
        self.to_read.is_empty() && self.ready.is_empty() && self.in_progress > 0
    }
}

struct CodeWalk<'c, 'a, 's: 'r, 'r> {
    context: &'c CodeLoadContext<'a, 's, 'r>,
    spawn_background_readers: SpawnBackgroundReaders<'c>,
    early_prefetch: &'c OnceLock<Prefetch<'s, 'r>>,
    state: Guarded<WalkState<'s, 'r>>,
    has_changed: Condvar,
    has_to_read: Condvar,
    has_to_read_by_plugin: Condvar,
    may_load_early: Condvar,
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
            has_changed: Condvar::new(),
            has_to_read: Condvar::new(),
            has_to_read_by_plugin: Condvar::new(),
            may_load_early: Condvar::new(),
        };
        let mut state = walk.state.lock();
        for &entry_point in &self.entry_points {
            walk.enqueue(&mut state, entry_point);
        }
        drop(state);
        walk.run(meanwhile);

        let mut state = std::mem::take(walk.state.get_mut());
        erase_sites_nothing_asked_for(&mut state);
        import_what_is_required(self, &mut state);
        let OrderedFiles {
            mut entries,
            entry_points,
            parsed,
            steps,
        } = order_files(self, state);
        compute_package_depths(&mut entries, &entry_points, &steps);
        copy_to_session(self.session, &mut entries, &parsed);

        let updates: Vec<Guarded<EntryUpdate<'r>>> = (entries.iter())
            .map(|_| Guarded::new((None, Vec::new())))
            .collect();
        self.host.parallel(entries.len(), &|index| {
            let Some(parsed) = parsed[index].lock().take() else {
                return;
            };
            let entry = &entries[index];
            let arena = self.session.arena();
            let (loaded, code, payload) = self.answer_types_question(arena, entry.key, *parsed);
            *updates[index].lock() = (payload, predicted_type_files(self.host, &loaded));
            *entry.loaded.lock() = Some(loaded);
            *entry.code.lock() = Some(code);
        });
        for (entry, mut update) in entries.iter_mut().zip(updates) {
            (entry.payload, entry.predicted_type_files) = std::mem::take(update.get_mut());
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

    fn key_of_read_code(&self, key: LoadKey<'r>) -> LoadKey<'r> {
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
    fn enqueue(&self, state: &mut WalkState<'s, 'r>, target: CodeTarget<'r>) -> u32 {
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
        state.files.push(WalkedFile {
            target,
            parsed: None,
            targets: Vec::new(),
            is_called_before_it_runs: false,
            imported_requires: Vec::new(),
        });
        let key = context.canonical_key(target.key);
        state.index_of.insert(key, index);
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
    ) {
        let requests = std::mem::take(&mut parsed.code.requests);
        state.has_exported_requires |= !parsed.code.exported_requires.is_empty();
        let file = &mut state.files[index as usize];
        file.targets = vec![NOT_LOADED; parsed.code.targets.len()];
        file.parsed = Some(parsed);
        let mut barrels = std::mem::take(&mut state.barrels);
        barrels.add_parsed_file(index, requests, &mut |file, target| {
            let (file, target) = (file as usize, target as usize);
            let code_target = state.files[file].code_targets()[target];
            let loaded = self.enqueue(state, code_target);
            state.files[file].targets[target] = loaded;
            loaded
        });
        state.barrels = barrels;
    }

    fn queue_found_files(&self, start_plugin_reader: StartPluginReader<'_>) -> bool {
        let mut state = self.state.lock();
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
                state.to_read.push_back(index);
                continue;
            }
            let loader = state.files[index as usize].target.key.loader;
            if !state.background_reads_disabled && host.can_read_in_background(path, loader) {
                state.pending_assets.push(index);
                continue;
            }
            state.to_read_by_plugin.push_back(index);
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
        !state.to_read.is_empty()
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
            self.queue_found_files(start.plugin_reader);
            let mut meanwhile = || {
                meanwhile();
                self.allow_early_load(&mut self.state.lock(), start.early_loader);
            };
            match host.io_pool() {
                Some(io) => {
                    let _alone = WAITS_ACROSS_POOLS.lock();
                    io.each_while(
                        (),
                        |(), (), _| self.work(LoadSteps::Read, start),
                        &mut vec![(); io.max_threads()],
                        || {
                            let work = |_| self.work(LoadSteps::Process, start);
                            host.parallel_while(threads, &work, &mut meanwhile);
                        },
                    );
                }
                None => {
                    let work = |_| self.work(LoadSteps::ReadAndProcess, start);
                    host.parallel_while(threads, &work, &mut meanwhile);
                }
            }
        });
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
            _ => self.may_load_early.notify_all(),
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
                self.read(vec![index]);
                state = self.state.lock();
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
                drop(state);
                self.read(vec![index]);
                state = self.state.lock();
                state.has_plugin_reader = false;
                self.has_to_read.notify_one();
            } else if reads && !state.to_read.is_empty() && state.ready.len() <= MAX_READY_TEXTS {
                let count = state.to_read.len().min(READ_BATCH_SIZE);
                let batch: Vec<u32> = state.to_read.drain(..count).collect();
                state.in_progress += count;
                drop(state);
                self.read(batch);
                state = self.state.lock();
            } else if processes && let Some((index, text)) = state.ready.pop() {
                if state.ready.len() == MAX_READY_TEXTS {
                    self.has_to_read.notify_all();
                }
                let file = &state.files[index as usize];
                let (target, is_called_early) = (file.target, file.is_called_before_it_runs);
                let requires = file.imported_requires.clone();
                drop(state);
                let arena = *arena.get_or_insert_with(|| context.session.arena());
                let parsed =
                    load_code_file(context, arena, target, text, is_called_early, &requires);
                let parsed = Box::new(parsed);
                self.add_parsed_file(&mut self.state.lock(), index, parsed);
                let has_more = self.queue_found_files(start.plugin_reader);
                state = self.state.lock();
                state.in_progress -= 1;
                if has_more || state.in_progress == 0 {
                    self.has_to_read.notify_all();
                }
                if has_more && reads || state.in_progress == 0 {
                    self.has_changed.notify_all();
                }
            } else if state.in_progress == 0
                && state.to_read.is_empty()
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
                if state.deferred.is_empty()
                    && (forget_files_called_before_they_run(&mut state)
                        || forget_files_that_import_requires(&context.atoms, &mut state))
                {
                    state.in_progress += 1;
                    drop(state);
                    self.queue_found_files(start.plugin_reader);
                    state = self.state.lock();
                    state.in_progress -= 1;
                    self.has_to_read.notify_all();
                    self.has_changed.notify_all();
                    continue;
                }
                if state.deferred.is_empty() {
                    state.is_finished = true;
                    self.has_changed.notify_all();
                    self.has_to_read.notify_all();
                    self.has_to_read_by_plugin.notify_all();
                    self.may_load_early.notify_all();
                    if let Some(prefetch) = self.early_prefetch.get() {
                        prefetch.pause();
                    }
                    return;
                }
                let deferred = std::mem::take(&mut state.deferred);
                state.in_progress += deferred.len();
                drop(state);
                self.read_deferred(deferred);
                state = self.state.lock();
            } else {
                self.allow_early_load(&mut state, start.early_loader);
                match processes {
                    true => self.has_changed.wait_guarded(&mut state),
                    false => self.has_to_read.wait_guarded(&mut state),
                }
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
            drop(state);
            self.queue_found_files(start_plugin_reader);
            self.state.lock().in_progress -= count;
            self.has_to_read.notify_all();
        }
        self.has_changed.notify_all();
    }

    fn is_code_file(&self, path: &[u8]) -> bool {
        let path = to_path(path, self.context.is_case_sensitive);
        let key = LoadKey {
            path: &path,
            loader: HostLoader::default(),
        };
        self.state.lock().index_of.contains_key(&key)
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
                self.state.lock().ready.push((index, text));
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

fn is_on_cycle(files: &[WalkedFile<'_, '_>], start: u32) -> bool {
    let mut seen = vec![false; files.len()];
    let mut stack = vec![start];
    while let Some(file) = stack.pop() {
        for &target in &files[file as usize].targets {
            if target == start {
                return true;
            }
            if target != NOT_LOADED && !std::mem::replace(&mut seen[target as usize], true) {
                stack.push(target);
            }
        }
    }
    false
}

fn forget_files_called_before_they_run(state: &mut WalkState<'_, '_>) -> bool {
    let relies_on_order = |file: &WalkedFile<'_, '_>| {
        let analysis = file.parsed.as_ref().map(|it| &it.code.analyzed.analysis);
        !file.is_called_before_it_runs
            && analysis.is_some_and(|analysis| analysis.relies_on_running_before_calls)
    };
    let called_early: Vec<u32> = (0..state.files.len() as u32)
        .filter(|&file| relies_on_order(&state.files[file as usize]))
        .filter(|&file| is_on_cycle(&state.files, file))
        .collect();
    for &index in &called_early {
        state.files[index as usize].is_called_before_it_runs = true;
        forget_parsed_file(state, index);
    }
    !called_early.is_empty()
}

fn forget_parsed_file(state: &mut WalkState<'_, '_>, index: u32) {
    let file = &mut state.files[index as usize];
    file.parsed = None;
    file.targets.clear();
    state.barrels.forget_parsed_file(index);
    state.found.push(index);
}

fn names_export(hir: &hir::File<'_>, site: ImportSiteKind, export: Atom) -> bool {
    match site {
        ImportSiteKind::Import(import) => {
            let import = &hir[import];
            import.namespace.is_some()
                || export == known::default && import.default.is_some()
                || import.named.iter().any(|it| hir[it].imported == export)
        }
        ImportSiteKind::ExportFrom(statement) => {
            let mut items = hir[statement].items.iter();
            items.any(|it| hir[it].local == export)
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
        for require in &exporting.code.exported_requires {
            if names_export(&parsed.parse.hir, site.kind, require.export) {
                found.push(ImportedRequire {
                    specifier,
                    export: require.export,
                    path: (require.path).unwrap_or_else(|| atoms.intern(exporter.target.key.path)),
                });
            }
        }
    }
    found
}

// esbuild exports its `__require` helper from a chunk that the other chunks import. What they load through it is known once that chunk is parsed, so they are parsed again.
fn forget_files_that_import_requires(atoms: &Interner<'_>, state: &mut WalkState<'_, '_>) -> bool {
    if !state.has_exported_requires {
        return false;
    }
    let mut importers: Vec<(u32, Vec<ImportedRequire>)> = Vec::new();
    for (index, file) in state.files.iter().enumerate() {
        let found = find_imported_requires(atoms, &state.files, file);
        if found != file.imported_requires {
            importers.push((index as u32, found));
        }
    }
    let has_importers = !importers.is_empty();
    for (index, found) in importers {
        state.files[index as usize].imported_requires = found;
        forget_parsed_file(state, index);
    }
    has_importers
}

fn erase_sites_nothing_asked_for(state: &mut WalkState<'_, '_>) {
    for (file, waiting) in std::mem::take(&mut state.barrels).into_waiting() {
        let file = &mut state.files[file as usize];
        let parsed = file.parsed.as_mut().expect("a barrel is parsed");
        erase_waiting_sites(&mut parsed.code, &mut file.targets, &waiting);
    }
}

fn import_what_is_required<'r>(
    context: &CodeLoadContext<'_, '_, 'r>,
    state: &mut WalkState<'_, 'r>,
) {
    let mut replacements: FxHashMap<u32, u32> = FxHashMap::default();
    for (index, file) in state.files.iter().enumerate() {
        let key = file.target.key;
        if key.loader != HostLoader::default() {
            continue;
        }
        let Some(required) = context.resolver.file_required_in_place_of(key.path) else {
            continue;
        };
        let path = to_path(required, context.is_case_sensitive);
        let required_key = LoadKey {
            path: &path,
            loader: key.loader,
        };
        if let Some(&required) = state.index_of.get(&required_key) {
            replacements.insert(index as u32, required);
        }
    }
    if replacements.is_empty() {
        return;
    }
    let targets_of_files: Vec<CodeTarget<'r>> = state.files.iter().map(|it| it.target).collect();
    for file in &mut state.files {
        let Some(parsed) = &mut file.parsed else {
            continue;
        };
        for (loaded, target) in file.targets.iter_mut().zip(&mut parsed.code.targets) {
            if let Some(&required) = replacements.get(loaded) {
                *loaded = required;
                *target = CodeTarget {
                    increases_depth: target.increases_depth,
                    ..targets_of_files[required as usize]
                };
            }
        }
    }
}

struct OrderedFiles<'s, 'r> {
    entries: Vec<CodeEntry<'s, 'r>>,
    entry_points: Vec<u32>,
    parsed: Vec<ParsedSlot<'s, 'r>>,
    steps: Vec<Vec<bool>>,
}

fn order_files<'s, 'r>(
    context: &CodeLoadContext<'_, 's, 'r>,
    state: WalkState<'s, 'r>,
) -> OrderedFiles<'s, 'r> {
    let WalkState {
        mut files,
        index_of,
        ..
    } = state;
    let mut roots: Vec<u32> = Vec::with_capacity(context.entry_points.len());
    let mut order: Vec<u32> = Vec::with_capacity(files.len());
    let mut seen = vec![false; files.len()];
    let mut stack: Vec<(u32, usize)> = Vec::new();
    for entry_point in &context.entry_points {
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
            key: context.key_of_read_code(file.target.key),
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
