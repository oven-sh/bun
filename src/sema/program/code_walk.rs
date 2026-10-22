use super::code_barrels::{BarrelRequests, NOT_LOADED, erase_waiting_sites};
use super::code_file::load_code_file;
use super::code_load::{CodeEntry, CodeTarget, LoadKey, ParsedCodeFile};
use super::code_types::predicted_type_files;
use super::*;
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
    /// What `enqueue` has added, until `queue_found_files` says who reads it.
    found: Vec<u32>,
    to_read: VecDeque<u32>,
    /// A plugin can take seconds for a file, most of them waiting: for a process it has started, for a file, for its turn on
    /// the one thread that the plugins of a build run on. So all such reads are asked for at once, each by a thread that
    /// does nothing else, and no other file waits behind one.
    to_read_by_plugin: VecDeque<u32>,
    plugin_readers: usize,
    idle_plugin_readers: usize,
    pending_assets: Vec<u32>,
    background_reads_disabled: bool,
    has_early_loaders: bool,
    /// Without a thread of their own, one thread that reads waits for one plugin at a time: there may be no more than two that read.
    has_plugin_reader: bool,
    is_finished: bool,
    ready: Vec<(u32, Cow<'static, [u8]>)>,
    deferred: Vec<u32>,
    in_progress: usize,
    barrels: BarrelRequests,
}

impl WalkState<'_, '_> {
    /// Each file that can be read or parsed now is in the hands of a thread, which may wait for a plugin. The other threads
    /// have nothing to do.
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
type StartEarlyLoaders<'w> = &'w (dyn Fn() + Sync);

#[derive(Copy, Clone)]
struct ThreadStarters<'w> {
    plugin_reader: StartPluginReader<'w>,
    early_loaders: StartEarlyLoaders<'w>,
}

pub(super) type SpawnBackgroundReaders<'w> = &'w (dyn Fn(Vec<Vec<u8>>) + Sync);

pub(super) const MAX_BACKGROUND_READERS: usize = MAX_PLUGIN_READERS;

impl<'a, 's: 'r, 'r> CodeLoadContext<'a, 's, 'r> {
    /// `meanwhile` runs on the calling thread during the walk. Once it has set `early_prefetch`, those files are loaded while
    /// the walk leaves threads idle.
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

        CodeFiles {
            session: self.session,
            atoms: self.atoms,
            is_case_sensitive: self.is_case_sensitive,
            entries,
            entry_points,
            entry_of_file: Vec::new(),
            is_in_types_program: Vec::new(),
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

    /// A file that a plugin reads is asked for at once. It doesn't wait for the files that were found before it.
    /// Returns whether there is more to read.
    fn queue_found_files(&self, start_plugin_reader: StartPluginReader<'_>) -> bool {
        let mut state = self.state.lock();
        let found = std::mem::take(&mut state.found);
        let path_of = |&index: &u32| state.files[index as usize].target.key.path;
        let paths: Vec<&'r [u8]> = found.iter().map(path_of).collect();
        drop(state);
        let host = self.context.host;
        let by_plugin: Vec<bool> = paths.iter().map(|path| host.is_read_by_plugin(path)).collect();
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
            let start_early_loaders = || {
                for _ in 0..threads {
                    let thread = std::thread::Builder::new()
                        .stack_size(bun_threading::thread_pool::DEFAULT_THREAD_STACK_SIZE as usize);
                    let _ = thread.spawn_scoped(scope, move || {
                        bun_core::Output::Source::configure_named_thread(bun_core::zstr!("Early Load"));
                        bun_threading::lower_current_thread_priority();
                        walk.load_early();
                    });
                }
            };
            let start = ThreadStarters {
                plugin_reader: &start_plugin_reader,
                early_loaders: &start_early_loaders,
            };
            self.queue_found_files(start.plugin_reader);
            let mut meanwhile = || {
                meanwhile();
                self.allow_early_load(&mut self.state.lock(), start.early_loaders);
            };
            match host.io_pool() {
                Some(io) => {
                    let _alone = WAITS_ACROSS_POOLS.lock();
                    io.each_while(
                        (),
                        |(), (), _| self.work(true, false, start),
                        &mut vec![(); io.max_threads()],
                        || {
                            let work = |_| self.work(false, true, start);
                            host.parallel_while(threads, &work, &mut meanwhile);
                        },
                    );
                }
                None => {
                    let work = |_| self.work(true, true, start);
                    host.parallel_while(threads, &work, &mut meanwhile);
                }
            }
        });
    }

    fn allow_early_load(&self, state: &mut WalkState<'s, 'r>, start: StartEarlyLoaders<'_>) {
        if !state.has_idle_threads() || self.early_prefetch.get().is_none() {
            return;
        }
        match std::mem::replace(&mut state.has_early_loaders, true) {
            true => self.may_load_early.notify_all(),
            false => start(),
        }
    }

    /// Loads the files of `early_prefetch` while the walk leaves threads idle.
    fn load_early(&self) {
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
            drop(state);
            if !loader.load(true, true, true) {
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
                let [path] = self.paths_of(&[index])[..] else {
                    unreachable!("one path for one file");
                };
                self.read_one(index, path);
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

    fn work(&self, reads: bool, processes: bool, start: ThreadStarters<'_>) {
        let context = self.context;
        let mut arena = None;
        let mut state = self.state.lock();
        loop {
            let can_read_by_plugin =
                reads && state.plugin_readers == 0 && !state.has_plugin_reader;
            if can_read_by_plugin && let Some(index) = state.to_read_by_plugin.pop_front() {
                state.has_plugin_reader = true;
                state.in_progress += 1;
                drop(state);
                let [path] = self.paths_of(&[index])[..] else {
                    unreachable!("one path for one file");
                };
                self.read_one(index, path);
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
                let target = state.files[index as usize].target;
                drop(state);
                let arena = *arena.get_or_insert_with(|| context.session.arena());
                let parsed = Box::new(load_code_file(context, arena, target, text));
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
                    self.finish_without_assets(pending_assets, has_deferred_reads, start.plugin_reader);
                    state = self.state.lock();
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
                self.allow_early_load(&mut state, start.early_loaders);
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
            state.ready.extend(pending_assets.into_iter().map(|index| (index, empty.clone())));
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

fn erase_sites_nothing_asked_for(state: &mut WalkState<'_, '_>) {
    for (file, waiting) in std::mem::take(&mut state.barrels).into_waiting() {
        let file = &mut state.files[file as usize];
        let parsed = file.parsed.as_mut().expect("a barrel is parsed");
        erase_waiting_sites(&mut parsed.code, &mut file.targets, &waiting);
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
    debug_assert_eq!(order.len(), files.len());

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
