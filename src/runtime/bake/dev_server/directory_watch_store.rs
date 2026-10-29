//! `DirectoryWatchStore`: directory watches that retry failed import resolutions.

use super::*;

/// `DevServer.DirectoryWatchStore` — sparse map of directories under watch
/// for resolution-failure recovery.
///
/// When a file fails to import a relative path, directory watchers are added
/// so that when a matching file is created, the dependencies can be rebuilt.
/// This handles HMR cases where a user writes an import before creating the
/// file, or moves files around. Not thread-safe.
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

        let hash = bun_watcher::Watcher::get_hash(dir);
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
/// `DirectoryWatchStore.Entry` — per-watched-directory state.
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

/// `DirectoryWatchStore::insert` error set.
#[derive(thiserror::Error, Debug)]
enum DirectoryWatchInsertError {
    #[error("Ignore")]
    Ignore,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(DirectoryWatchInsertError);

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

        let mut buf = bun_paths::path_buffer_pool::get();
        let Some(joined) =
            bun_paths::resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Auto>(
                bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(import_source),
                &mut buf.0,
                &[specifier],
            )
        else {
            // A path this long names no directory, so there is nothing to watch.
            return Ok(());
        };
        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(joined);

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

        match self.insert(dir, owned_file_path, specifier) {
            Ok(()) => Ok(()),
            Err(DirectoryWatchInsertError::Ignore) => Ok(()), // ignoring watch errors.
            Err(DirectoryWatchInsertError::OutOfMemory) => Err(bun_alloc::AllocError),
        }
    }

    /// `dir_name_to_watch` is cloned; `file_path` must outlive the watch;
    /// `specifier` is cloned.
    fn insert(
        &mut self,
        dir_name_to_watch: &[u8],
        file_path: bun_ptr::RawSlice<u8>,
        specifier: &[u8],
    ) -> Result<(), DirectoryWatchInsertError> {
        debug_assert!(!specifier.is_empty());
        // TODO: watch the parent dir too.

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.insert({}, {}, {})",
            bun_core::fmt::quote(dir_name_to_watch),
            bun_core::fmt::quote(file_path.slice()),
            bun_core::fmt::quote(specifier),
        );

        if self.dependencies_free_list.is_empty() {
            self.dependencies.reserve(1);
        }

        // No trailing separator: the hash of `<dir>/` names the parent item of the watched files in `dir`.
        let dir = bun_paths::string_paths::without_trailing_slash_windows_path(dir_name_to_watch);

        // Note: reshaped for borrowck — capture gop scalars before
        // calling self methods that need &mut self.
        let gop = self.watches.get_or_put(dir)?;
        let gop_index = gop.index;
        let found_existing = gop.found_existing;

        let specifier_cloned: Box<[u8]> =
            if specifier[0] == b'.' || bun_paths::is_absolute(specifier) {
                Box::<[u8]>::from(specifier)
            } else {
                let mut v = Vec::with_capacity(2 + specifier.len());
                v.extend_from_slice(b"./");
                v.extend_from_slice(specifier);
                v.into_boxed_slice()
            };
        // errdefer free(specifier_cloned) — handled by Drop on `?` paths.

        if found_existing {
            let prev_first = Some(self.watches.values()[gop_index].first_dep);
            // Every rebuild of a file reports its failed imports again.
            let mut it = prev_first;
            while let Some(index) = it {
                let dep = &self.dependencies[index as usize];
                if dep.source_file_path.slice().as_ptr() == file_path.slice().as_ptr()
                    && dep.specifier == specifier_cloned
                {
                    return Ok(());
                }
                it = dep.next;
            }
            let dep = self.append_dep_assume_capacity(Dep {
                next: prev_first,
                source_file_path: file_path,
                specifier: specifier_cloned,
            });
            self.watches.values_mut()[gop_index].first_dep = dep;
            return Ok(());
        }

        // Note: `errdefer store.watches.swapRemoveAt(gop.index)` — guard the
        // map via raw ptr so it doesn't conflict with `&mut self` below.
        let watches_ptr: *mut StringArrayHashMap<Entry> = &raw mut self.watches;
        let watches_guard = scopeguard::guard(gop_index, move |idx| {
            // SAFETY: `watches_ptr` points into the heap-allocated DevServer; on
            // the error path no other borrow of `self.watches` is outstanding.
            let _ = unsafe { (*watches_ptr).swap_remove_at(idx) };
        });

        // `add_directory::<true, _>` so the `WatchItem` owns its path: the watcher
        // retains the path until eviction runs (deferred onto `evict_list` and
        // drained later in `flush_evictions`), but `dir_name_to_watch` is a
        // transient `dirname()` view of a thread-local path buffer. A borrowed
        // (`::<false, _>`) `Cow` would dangle once `insert` returns — well before
        // the watcher reads it on a file event. Owning the copy also lets the
        // map keep its own boxed key independently, so no extra intermediate
        // `Box` is needed here.
        // `::<_, true>` keeps an item that `free_entry` queued for removal.
        if self
            .dev_bun_watcher()
            .add_directory::<true, true>(
                // The store holds no descriptor. The watcher opens one.
                bun_sys::Fd::INVALID,
                dir,
                bun_watcher::Watcher::get_hash(dir),
            )
            .is_err()
        {
            // A directory that does not exist yet is not watched (BUN-10968).
            return Err(DirectoryWatchInsertError::Ignore);
        }

        // Disarm errdefer guard: success path.
        let _ = scopeguard::ScopeGuard::into_inner(watches_guard);

        let dep = self.append_dep_assume_capacity(Dep {
            next: None,
            source_file_path: file_path,
            specifier: specifier_cloned,
        });
        self.watches.values_mut()[gop_index] = Entry { first_dep: dep };
        Ok(())
    }

    /// Appends a dependency into the first free slot, returning its index.
    /// Capacity for one element must already be ensured.
    fn append_dep_assume_capacity(&mut self, dep: Dep) -> u32 {
        if let Some(index) = self.dependencies_free_list.pop() {
            self.dependencies[index as usize] = dep;
            index
        } else {
            let index = u32::try_from(self.dependencies.len()).expect("int cast");
            self.dependencies.push(dep);
            index
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
