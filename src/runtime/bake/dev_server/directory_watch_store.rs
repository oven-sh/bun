//! `DirectoryWatchStore`: directory watches that retry failed import resolutions.

use super::*;
use bun_paths::resolve_path::{self, ParentEqual, is_parent_or_equal, platform};
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_resolver::fs::{EntriesOption, EntryKind, FileSystem};

/// `DevServer.DirectoryWatchStore` — sparse map of directories under watch
/// for resolution-failure recovery.
///
/// When a file fails to import a relative path, directory watchers are added
/// so that when a matching file is created, the dependencies can be rebuilt.
/// This handles HMR cases where a user writes an import before creating the
/// file, or moves files around. Not thread-safe.
///
/// The path of a failed import is the directory of the importer joined with
/// the specifier. The failure gets one `Dep` on each directory whose listing
/// can decide it: the deepest directory above that path that exists when the
/// bundler reports the failure, each directory below it that appears later,
/// and the path itself when it is a directory. A `Dep` stays on its directory
/// until the import resolves. So a directory that is removed and made again is
/// found through the directory above it.
///
/// Known gap: when the importing file fixes its resolution (the failing
/// import is removed or renamed), nothing walks this store to release the
/// now-unneeded watcher; it stays until the directory changes or the file
/// is evicted from the incremental graph.
#[derive(Default)]
pub(crate) struct DirectoryWatchStore {
    pub(crate) watches: StringArrayHashMap<Entry>,
    pub(crate) dependencies: Vec<Dep>,
    /// Dependencies cannot be re-ordered. This list tracks what indexes are free.
    pub(crate) dependencies_free_list: Vec<u32>,
    /// Directories that got their watch while a bundle ran, and whose listing
    /// changed between the lookup that failed and the watch. No event reports
    /// that change, so `DevServer::start_next_bundle_if_present` retries them.
    pub(crate) rescan: Vec<Box<[u8]>>,
}
// SAFETY: `DirectoryWatchStore` is only ever the `directory_watchers` field of
// a heap-allocated `DevServer` (never moved post-init). Raw ptr (not `&mut
// DevServer`) because `&mut self` is live; callers scope their borrows to
// fields disjoint from `directory_watchers`.
bun_core::impl_field_parent! { DirectoryWatchStore => DevServer.directory_watchers; fn mut owner; }

impl DirectoryWatchStore {
    /// Safe sibling-projection: borrow the owning [`DevServer`]'s
    /// `bun_watcher` while holding `&mut self`. The two fields are disjoint,
    /// so the returned `&mut Watcher` does not alias `self`.
    #[inline]
    fn dev_bun_watcher(&mut self) -> &mut bun_watcher::Watcher {
        // SAFETY: `owner()` recovers the heap-allocated `DevServer`;
        // `bun_watcher` is field-disjoint from `directory_watchers`, so
        // `&mut self` and the returned borrow cover non-overlapping memory.
        unsafe { &mut (*self.owner()).bun_watcher }
    }

    /// The resolver of the server transpiler, a sibling projection like
    /// [`dev_bun_watcher`](Self::dev_bun_watcher). The directory caches it
    /// reads and drops are process-wide, so every graph sees them.
    #[inline]
    fn dev_resolver(&mut self) -> &mut bun_resolver::Resolver<'static> {
        // SAFETY: `owner()` recovers the heap-allocated `DevServer`, whose
        // `server_transpiler` is initialized before it accepts a request and
        // is field-disjoint from `directory_watchers`.
        unsafe { &mut (*self.owner()).server_transpiler.assume_init_mut().resolver }
    }

    /// Returns a dependency slot to the free list so it can be reused.
    pub(crate) fn free_dependency_index(&mut self, index: u32) {
        // Zero out the slot so DevServer.deinit/memoryCost — which iterate
        // `dependencies` without consulting the free list — do not touch the
        // freed allocation or stale borrowed pointers.
        self.dependencies[index as usize] = Dep::default();
        if index as usize == self.dependencies.len() - 1 {
            self.dependencies.truncate(self.dependencies.len() - 1);
        } else {
            self.dependencies_free_list.push(index);
        }
    }

    /// Expects dependency list to be already freed.
    pub(crate) fn free_entry(&mut self, entry_index: usize) {
        let dir = &self.watches.keys()[entry_index];

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.freeEntry({}, {})",
            entry_index,
            bun_core::fmt::quote(dir),
        );

        // The watcher finds the item by this hash. A position in its list is
        // only right until the watcher thread removes another item.
        let hash = Watcher::get_hash(dir);
        self.dev_bun_watcher().remove_directory(hash);

        // The Box key drops on swap_remove_at.
        let _ = self.watches.swap_remove_at(entry_index);

        if self.watches.len() == 0 {
            // Every remaining dependency slot must be in the free list.
            debug_assert_eq!(self.dependencies.len(), self.dependencies_free_list.len());
            self.dependencies.clear();
            self.dependencies_free_list.clear();
        }
    }
}
/// `DirectoryWatchStore.Entry` — per-watched-directory state. The watcher owns
/// the descriptor of the directory and finds its item by the hash of the path.
#[derive(Copy, Clone, Default)]
pub(crate) struct Entry {
    /// `Dep.Index` — head of the singly-linked dep chain for this dir.
    pub(crate) first_dep: u32,
}
/// `DirectoryWatchStore.Dep` — one resolution-failure to retry on dir change.
pub(crate) struct Dep {
    pub(crate) next: Option<u32>,
    /// The file used. BORROWED slice into `IncrementalGraph.bundled_files`
    /// key storage; compared by *pointer identity*. The graph calls
    /// `removeDependenciesForFile` before freeing the key, so the slice
    /// outlives every read — `RawSlice` invariant.
    pub(crate) source_file_path: bun_ptr::RawSlice<u8>,
    /// The specifier that failed. Allocated memory.
    pub(crate) specifier: Box<[u8]>,
}
impl Default for Dep {
    fn default() -> Self {
        Dep {
            next: None,
            source_file_path: bun_ptr::RawSlice::EMPTY,
            specifier: Box::default(),
        }
    }
}

/// One failed import. It has at most one [`Dep`] on a directory.
#[derive(Copy, Clone)]
struct Failure {
    /// The importer: `Dep::source_file_path`.
    file: bun_ptr::RawSlice<u8>,
    /// Borrowed from the caller, or from a `Dep` that the callee does not free.
    specifier: bun_ptr::RawSlice<u8>,
}

/// What [`DirectoryWatchStore::watch`] did for a failure and a directory.
#[derive(Copy, Clone, Eq, PartialEq)]
enum Watched {
    /// The failure has a new `Dep` on the directory, and the kernel watch of
    /// the directory is new too. An entry that was made in the directory
    /// before this made no event.
    New,
    /// The failure has a new `Dep` on a directory that other failures wait on.
    Joined,
    /// The failure already had its `Dep` on the directory.
    Held,
    /// The path does not name a directory.
    Missing,
    /// The directory cannot be watched.
    Failed,
}

/// How [`DirectoryWatchStore::descend`] ended.
#[derive(Copy, Clone, Eq, PartialEq)]
enum Descent {
    /// The import resolves now.
    Resolved,
    /// Every level down to the target is a directory with a `Dep` of the failure.
    Arrived,
    /// A level is not a directory, or it reports its own changes.
    Stopped,
}

/// When the directory of a new watch is looked at again. A watch only reports
/// what happens after it exists, and the lookup that failed ran before.
enum Look<'a> {
    /// A watcher event is handled: the import is resolved again at once.
    /// Holds the paths that the event names.
    Now(&'a StringArrayHashMap<()>),
    /// The bundler reports the failure while it runs, so a new result has no
    /// use yet. The directory goes on `rescan` if its listing changed.
    Later,
}

impl Look<'_> {
    /// Whether the event can mean that the directory at `dir` was removed and
    /// made again, which leaves the watch on the directory that was removed.
    fn may_have_replaced(&self, dir: &[u8]) -> bool {
        match self {
            // inotify names the entry that changed. kqueue does not. The
            // Windows watcher finds a directory by its path.
            Look::Now(named) => {
                if cfg!(any(target_os = "linux", target_os = "android")) {
                    named.contains(dir)
                } else {
                    !cfg!(windows)
                }
            }
            Look::Later => false,
        }
    }
}

impl DirectoryWatchStore {
    /// Registers a directory watch so that a failed import resolution is
    /// retried when the containing directory changes.
    pub(crate) fn track_resolution_failure(
        &mut self,
        import_source: &[u8],
        specifier: &[u8],
        renderer: Graph,
        loader: bun_ast::Loader,
    ) -> Result<(), bun_alloc::AllocError> {
        use bun_ast::Loader;
        // When it does not resolve to a file path, there is nothing to track.
        if specifier.is_empty() {
            return Ok(());
        }
        if !bun_paths::is_absolute(import_source) {
            return Ok(());
        }

        match loader {
            Loader::Tsx | Loader::Ts | Loader::Jsx | Loader::Js => {
                if !(specifier.starts_with(b"./") || specifier.starts_with(b"../")) {
                    return Ok(());
                }
            }
            // Imports in CSS can resolve to relative files without './'
            // Imports in HTML can resolve to project-relative paths by
            // prefixing with '/', but that is done in HTMLScanner.
            Loader::Css | Loader::Html => {}
            // Multiple parts of DevServer rely on the fact that these
            // loaders do not depend on importing other files.
            _ => debug_assert!(false),
        }

        // The retry resolves a statement import, which takes a specifier
        // without './' for a package.
        let relative_specifier: Vec<u8>;
        let specifier = if specifier[0] == b'.' || bun_paths::is_absolute(specifier) {
            specifier
        } else {
            relative_specifier = [b"./".as_slice(), specifier].concat();
            &relative_specifier[..]
        };

        let mut buf = bun_paths::path_buffer_pool::get();
        let Some(joined) = Self::joined_path(import_source, specifier, &mut buf.0) else {
            // A path this long names no directory, so there is nothing to watch.
            return Ok(());
        };

        // The `import_source` parameter is not a stable string. Since the
        // import source will be added to IncrementalGraph anyways, this is a
        // great place to share memory.
        // SAFETY: owner() recovers `*mut DevServer`; `client_graph`/`server_graph`/
        // `graph_safety_lock` are disjoint from `directory_watchers` so this does
        // not alias `&mut self`.
        let dev = self.owner();
        // SAFETY: `dev` is the heap-allocated DevServer; `graph_safety_lock` is
        // disjoint from `directory_watchers`. RAII guard unlocks on drop.
        let _g = unsafe { (*dev).graph_safety_lock.guard() };
        let owned_file_path: bun_ptr::RawSlice<u8> = match renderer {
            Graph::Client => {
                // SAFETY: `dev` is the live DevServer owning this store;
                // `client_graph` is disjoint from `directory_watchers` so this
                // `&mut` does not alias `&mut self`. `graph_safety_lock` is held.
                unsafe { &mut (*dev).client_graph }
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
            Graph::Server | Graph::Ssr => {
                // SAFETY: `dev` is the live DevServer owning this store;
                // `server_graph` is disjoint from `directory_watchers` so this
                // `&mut` does not alias `&mut self`. `graph_safety_lock` is held.
                unsafe { &mut (*dev).server_graph }
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
        };

        let failure = Failure {
            file: owned_file_path,
            specifier: bun_ptr::RawSlice::new(specifier),
        };
        // Every rebuild of a file reports its failed imports again.
        if self.is_registered(joined, failure) {
            return Ok(());
        }

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.trackResolutionFailure({}, {}, {})",
            bun_core::fmt::quote(joined),
            bun_core::fmt::quote(owned_file_path.slice()),
            bun_core::fmt::quote(specifier),
        );

        // The deepest directory above `joined` that exists. A directory that
        // is made in it later changes its listing.
        let mut dir = resolve_path::dirname::<platform::Auto>(joined);
        loop {
            match self.watch(dir, failure) {
                Watched::New => {
                    self.look_later(dir);
                    break;
                }
                Watched::Joined | Watched::Held => break,
                Watched::Missing => match Self::stand_in_for_missing(dir) {
                    Some(parent) => dir = parent,
                    None => return Ok(()),
                },
                Watched::Failed => return Ok(()),
            }
        }
        self.watch_existing_below(dir, joined, failure, &Look::Later);
        Ok(())
    }

    /// Resolves again each import that waits on `changed_dir`. An import that
    /// still does not resolve is registered on the directories that now exist
    /// below `changed_dir`, and resolved again after each new watch.
    ///
    /// `files` has the paths that the watcher event names. The importers to
    /// bundle again are added to it.
    pub(crate) fn retry(&mut self, changed_dir: &[u8], files: &mut StringArrayHashMap<()>) {
        let Some(entry_index) = self.watches.get_index(changed_dir) else {
            return;
        };

        let mut joined_buf = bun_paths::path_buffer_pool::get();
        let mut resolved: Vec<u32> = Vec::new();
        // This chain does not change in the loop: it only adds and removes
        // a `Dep` on a directory below `changed_dir`.
        let mut it: Option<u32> = Some(self.watches.values()[entry_index].first_dep);
        while let Some(index) = it {
            let dep = &self.dependencies[index as usize];
            it = dep.next;
            let failure = Failure {
                file: dep.source_file_path,
                specifier: bun_ptr::RawSlice::new(&dep.specifier),
            };

            let now_resolves = self.resolves(failure)
                || Self::joined_path(&failure.file, &failure.specifier, &mut joined_buf.0)
                    .is_some_and(|joined| {
                        self.watch_existing_below(changed_dir, joined, failure, &Look::Now(&*files))
                    });
            bun_core::scoped_log!(
                DevServer,
                "DirectoryWatchStore.retry({}, {}, {}) = {}",
                bun_core::fmt::quote(changed_dir),
                bun_core::fmt::quote(failure.file.slice()),
                bun_core::fmt::quote(failure.specifier.slice()),
                now_resolves,
            );
            if now_resolves {
                resolved.push(index);
            }
        }

        for index in resolved {
            let dep = &self.dependencies[index as usize];
            let file = dep.source_file_path;
            // `release` frees the `Dep` that owns the specifier.
            let specifier = dep.specifier.clone();
            // this resolution result is not preserved as passing it
            // into BundleV2 is too complicated. the resolution is
            // cached, anyways.
            bun_core::handle_oom(files.get_or_put(file.slice()));
            self.release(
                Failure {
                    file,
                    specifier: bun_ptr::RawSlice::new(&specifier),
                },
                None,
            );
        }
    }

    /// The absolute path that `specifier` names from the file `import_source`,
    /// with no trailing separator. `None` when it does not fit a path buffer.
    fn joined_path<'a>(
        import_source: &'a [u8],
        specifier: &[u8],
        buf: &'a mut [u8],
    ) -> Option<&'a [u8]> {
        let joined = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
            resolve_path::dirname::<platform::Auto>(import_source),
            buf,
            &[specifier],
        )?;
        // On Windows the `dirname` of `a\second\` is `a\second`, so the
        // separator of a specifier like `./second/` is removed first.
        Some(without_trailing_slash_windows_path(joined))
    }

    /// Where the name of the level below the directory `path[..dir_len]` is
    /// in `path`. That level is `path[..end]`. Neither prefix has a trailing
    /// separator, unless it is a root.
    fn next_level(path: &[u8], dir_len: usize) -> core::ops::Range<usize> {
        let start = dir_len + usize::from(path[dir_len] == bun_paths::SEP);
        let end = strings::index_of_char_usize(&path[start..], bun_paths::SEP)
            .map_or(path.len(), |i| start + i);
        start..end
    }

    /// The directory that is watched in place of the missing directory `dir`:
    /// its parent. The watcher's rule for the directories it adds by itself
    /// applies, so there is none above the project root or for a directory
    /// inside `node_modules`.
    fn stand_in_for_missing(dir: &[u8]) -> Option<&[u8]> {
        let root = FileSystem::get().top_level_dir();
        if is_parent_or_equal(root, dir) != ParentEqual::Parent
            || bun_paths::string_paths::path_contains_node_modules_folder(dir)
        {
            return None;
        }
        let parent = resolve_path::dirname::<platform::Auto>(dir);
        (parent.len() < dir.len()).then_some(parent)
    }

    /// Whether `dep` is the `Dep` of `failure`.
    fn is_dep_of(dep: &Dep, failure: Failure) -> bool {
        // Pointer identity: see `Dep::source_file_path`.
        dep.source_file_path.slice().as_ptr() == failure.file.slice().as_ptr()
            && *dep.specifier == *failure.specifier.slice()
    }

    fn has_dep(&self, entry_index: usize, failure: Failure) -> bool {
        let mut it: Option<u32> = Some(self.watches.values()[entry_index].first_dep);
        while let Some(index) = it {
            let dep = &self.dependencies[index as usize];
            if Self::is_dep_of(dep, failure) {
                return true;
            }
            it = dep.next;
        }
        false
    }

    /// Whether `failure` has a `Dep` on a directory above `joined`. Its first
    /// registration puts one there, and that one stays.
    fn is_registered(&self, joined: &[u8], failure: Failure) -> bool {
        let mut dir = resolve_path::dirname::<platform::Auto>(joined);
        loop {
            if self
                .watches
                .get_index(dir)
                .is_some_and(|entry_index| self.has_dep(entry_index, failure))
            {
                return true;
            }
            match Self::stand_in_for_missing(dir) {
                Some(parent) => dir = parent,
                None => return false,
            }
        }
    }

    /// Gives `failure` a `Dep` on the directory `dir`, and makes the watcher
    /// watch `dir` when no other failure waits on it.
    fn watch(&mut self, dir: &[u8], failure: Failure) -> Watched {
        debug_assert!(!failure.specifier.is_empty());

        let entry_index = self.watches.get_index(dir);
        if entry_index.is_some_and(|entry_index| self.has_dep(entry_index, failure)) {
            return Watched::Held;
        }

        // The watcher opens the directory and keeps the descriptor. For a
        // directory that it already watches, it makes sure that the watch is
        // on the directory that `dir` names now.
        let is_new_watch = match self
            .dev_bun_watcher()
            .watch_directory(dir, Watcher::get_hash(dir))
        {
            Ok(is_new_watch) => is_new_watch,
            Err(err) => {
                return match err.get_errno() {
                    sys::E::ENOENT | sys::E::ENOTDIR => Watched::Missing,
                    // The resolver already reported the failed import.
                    _ => Watched::Failed,
                };
            }
        };

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.watch({}, {}, {})",
            bun_core::fmt::quote(dir),
            bun_core::fmt::quote(failure.file.slice()),
            bun_core::fmt::quote(failure.specifier.slice()),
        );

        let dep = Dep {
            next: entry_index.map(|entry_index| self.watches.values()[entry_index].first_dep),
            source_file_path: failure.file,
            specifier: Box::from(failure.specifier.slice()),
        };
        let first_dep = if let Some(index) = self.dependencies_free_list.pop() {
            self.dependencies[index as usize] = dep;
            index
        } else {
            self.dependencies.push(dep);
            u32::try_from(self.dependencies.len() - 1).expect("int cast")
        };
        match entry_index {
            Some(entry_index) => self.watches.values_mut()[entry_index].first_dep = first_dep,
            None => bun_core::handle_oom(self.watches.put(dir, Entry { first_dep })),
        }

        if is_new_watch || entry_index.is_none() {
            Watched::New
        } else {
            Watched::Joined
        }
    }

    /// Registers `failure` on the directories that exist now below the
    /// directory `from`: on the way to `joined`, and from there on the way to
    /// each file that a package.json in `joined` names. Returns `true` when
    /// the import resolves after one of the new watches.
    fn watch_existing_below(
        &mut self,
        from: &[u8],
        joined: &[u8],
        failure: Failure,
        look: &Look<'_>,
    ) -> bool {
        if is_parent_or_equal(from, joined) == ParentEqual::Parent {
            match self.descend(from.len(), joined, failure, look) {
                Descent::Resolved => return true,
                Descent::Stopped => return false,
                Descent::Arrived => {}
            }
        }

        // `joined` is a directory with no index file, or `from` is a directory
        // in it. The "main" of its package.json can name a file in a
        // directory below it that does not exist yet.
        let main_fields: &'static [Box<[u8]>] = match self.dev_resolver().read_dir_info(joined) {
            Ok(Some(info)) => info
                .package_json()
                .map(|package_json| package_json.main_field_values())
                .unwrap_or_default(),
            Ok(None) | Err(_) => &[],
        };
        let start = if from.len() > joined.len() {
            from
        } else {
            joined
        };
        for main in main_fields {
            let mut buf = bun_paths::path_buffer_pool::get();
            let Some(target) = resolve_path::join_abs_string_buf_checked::<platform::Auto>(
                joined,
                &mut buf.0,
                &[&main[..]],
            ) else {
                continue;
            };
            let target = without_trailing_slash_windows_path(target);
            if is_parent_or_equal(start, target) == ParentEqual::Parent
                && self.descend(start.len(), target, failure, look) == Descent::Resolved
            {
                return true;
            }
        }
        false
    }

    /// Walks from the directory `target[..from_len]` toward `target`, one
    /// level at a time, while the listing of a level has the next level as a
    /// directory. Each such level gets a `Dep` of `failure`.
    ///
    /// A level can exist before its watch does: `mkdir -p a/b` makes one event,
    /// in the parent of `a`. So after a new watch the resolver's cache of the
    /// levels below is dropped, and the import is resolved again.
    fn descend(
        &mut self,
        from_len: usize,
        target: &[u8],
        failure: Failure,
        look: &Look<'_>,
    ) -> Descent {
        let mut dir_len = from_len;
        // A new watch on a level means that the levels below it were made
        // with no event, so a `Dep` there can be on a directory that is gone.
        let mut parent_is_new = false;
        while dir_len < target.len() {
            let name = Self::next_level(target, dir_len);
            let next_len = name.end;
            let next = &target[..next_len];

            if self.listed_kind(&target[..dir_len], &target[name]) != Some(EntryKind::Dir) {
                // The level is gone, and the levels below went with it.
                if self.watches.contains(next) {
                    self.release(failure, Some(next));
                }
                return Descent::Stopped;
            }

            let is_new = match self.watch(next, failure) {
                Watched::New => true,
                Watched::Joined => false,
                Watched::Held => {
                    if !parent_is_new && !look.may_have_replaced(next) {
                        // The level reports its own changes.
                        return Descent::Stopped;
                    }
                    match self
                        .dev_bun_watcher()
                        .watch_directory(next, Watcher::get_hash(next))
                    {
                        Ok(true) => true,
                        Ok(false) | Err(_) => return Descent::Stopped,
                    }
                }
                Watched::Missing | Watched::Failed => return Descent::Stopped,
            };

            if is_new {
                match look {
                    Look::Now(_) => {
                        // A lookup from before the watch can have cached a
                        // level as missing, or without the entry it has now.
                        let mut len = next_len;
                        loop {
                            let _ = self.dev_resolver().bust_dir_cache(&target[..len]);
                            if len == target.len() {
                                break;
                            }
                            len = Self::next_level(target, len).end;
                        }
                        if self.resolves(failure) {
                            return Descent::Resolved;
                        }
                    }
                    Look::Later => self.look_later(next),
                }
            }

            parent_is_new = is_new;
            dir_len = next_len;
        }
        Descent::Arrived
    }

    /// Whether the import resolves now. The bundler looked it up with the
    /// transpiler of its graph and the import kind of its record. This lookup
    /// is the server transpiler's, of a statement import.
    fn resolves(&mut self, failure: Failure) -> bool {
        self.dev_resolver()
            .resolve(
                resolve_path::dirname::<platform::Auto>(&failure.file),
                &failure.specifier,
                bun_ast::ImportKind::Stmt,
            )
            .is_ok()
    }

    /// The listing of `dir` that the resolver keeps, which is read when there
    /// is none. Only the listing: the resolver's `DirInfo` of a directory
    /// also reads its package.json and tsconfig.json.
    fn listing(&mut self, dir: &[u8]) -> Option<&'static bun_resolver::fs::DirEntry> {
        let resolver = self.dev_resolver();
        let (generation, store_fd) = (resolver.generation, resolver.store_fd);
        match FileSystem::instance().read_directory(dir, generation, store_fd) {
            Ok(EntriesOption::Entries(entries)) => Some(&**entries),
            Ok(EntriesOption::Err(_)) | Err(_) => None,
        }
    }

    /// The kind of the entry `name` in the listing of `dir`.
    fn listed_kind(&mut self, dir: &[u8], name: &[u8]) -> Option<EntryKind> {
        let listing = self.listing(dir)?;
        let fs = FileSystem::instance();
        let entry = {
            // The map of a listing is only read with `entries_mutex` held.
            let _lock = fs.fs.entries_mutex.lock_guard();
            listing.get(name)?.entry()
        };
        // SAFETY: `fs.fs` is the process-wide `RealFS`. For a link or an entry
        // of unknown kind, `kind` calls `stat` under the entry's own mutex.
        Some(unsafe { entry.kind(&raw mut fs.fs, false) })
    }

    /// The watch of `dir` is new, and the lookup that failed read `dir` before
    /// that. The listing is read again, now that the watch reports each later
    /// change. If it differs from what the lookup read, `dir` goes on `rescan`.
    ///
    /// An unchanged listing gives no retry, so a retry always has a change of
    /// the file system behind it. That matters for an import that the retry
    /// resolves and the bundler does not: it would bundle with no end.
    fn look_later(&mut self, dir: &[u8]) {
        let before = {
            let fs = FileSystem::instance();
            let _lock = fs.fs.entries_mutex.lock_guard();
            match fs.fs.entries.get(dir) {
                Some(EntriesOption::Entries(listing)) => Some(Self::names(listing)),
                Some(EntriesOption::Err(_)) | None => None,
            }
        };
        let _ = self.dev_resolver().bust_dir_cache(dir);
        let after = self.listing(dir).map(|listing| {
            let _lock = FileSystem::instance().fs.entries_mutex.lock_guard();
            Self::names(listing)
        });
        if before.is_none() || before != after {
            self.rescan.push(Box::from(dir));
        }
    }

    /// The count of the names in `listing`, and a hash of them that does not
    /// depend on their order. The caller holds `entries_mutex`.
    fn names(listing: &bun_resolver::fs::DirEntry) -> (usize, u64) {
        let names = listing
            .data
            .keys()
            .fold(0u64, |sum, name| sum.wrapping_add(hash(&**name)));
        (listing.data.len(), names)
    }

    /// Removes the `Dep`s of `failure`: all of them, or only those on the
    /// directory `at_or_below` and on the directories in it. A directory that
    /// no `Dep` is left on is not watched anymore.
    ///
    /// `failure.specifier` must not be borrowed from a `Dep` that this removes.
    fn release(&mut self, failure: Failure, at_or_below: Option<&[u8]>) {
        // Iterate in reverse since `free_entry` uses `swap_remove_at`.
        let mut entry_index = self.watches.count();
        while entry_index > 0 {
            entry_index -= 1;
            if at_or_below.is_some_and(|dir| {
                is_parent_or_equal(dir, &self.watches.keys()[entry_index]) == ParentEqual::Unrelated
            }) {
                continue;
            }

            let mut prev: Option<u32> = None;
            let mut it: Option<u32> = Some(self.watches.values()[entry_index].first_dep);
            while let Some(index) = it {
                let dep = &self.dependencies[index as usize];
                let next = dep.next;
                if !Self::is_dep_of(dep, failure) {
                    prev = it;
                    it = next;
                    continue;
                }
                self.free_dependency_index(index);
                match (prev, next) {
                    (Some(prev), _) => self.dependencies[prev as usize].next = next,
                    (None, Some(next)) => self.watches.values_mut()[entry_index].first_dep = next,
                    (None, None) => self.free_entry(entry_index),
                }
                break;
            }
        }
    }

    /// Removes all dependencies whose `source_file_path` is the exact slice
    /// `file_path`, compared by *pointer identity* since the slice is shared
    /// with `IncrementalGraph.bundled_files`. Called before IncrementalGraph
    /// frees a file's key string so no `Dep` is left holding a dangling pointer.
    pub(crate) fn remove_dependencies_for_file(&mut self, file_path: &[u8]) {
        if self.watches.count() == 0 {
            return;
        }

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.removeDependenciesForFile({:?})",
            bstr::BStr::new(file_path),
        );

        // Iterate in reverse since `free_entry` uses `swap_remove_at`.
        let mut watch_index = self.watches.count();
        while watch_index > 0 {
            watch_index -= 1;
            // Note: reshaped for borrowck — cannot hold &mut entry across
            // self.free_dependency_index(); walk by index and re-borrow.
            let mut new_chain: Option<u32> = None;
            let mut it: Option<u32> = Some(self.watches.values()[watch_index].first_dep);
            while let Some(index) = it {
                let dep_next = self.dependencies[index as usize].next;
                let dep_path = self.dependencies[index as usize].source_file_path;
                it = dep_next;
                // Pointer-identity comparison.
                if dep_path.slice().as_ptr() == file_path.as_ptr() {
                    self.free_dependency_index(index);
                } else {
                    self.dependencies[index as usize].next = new_chain;
                    new_chain = Some(index);
                }
            }
            if let Some(new_first_dep) = new_chain {
                self.watches.values_mut()[watch_index].first_dep = new_first_dep;
            } else {
                self.free_entry(watch_index);
            }
        }
    }
}
