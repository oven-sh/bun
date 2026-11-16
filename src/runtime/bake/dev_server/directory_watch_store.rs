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

impl DirectoryWatchStore {
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
}

impl DevServer {
    /// Expects dependency list to be already freed.
    pub(crate) fn free_directory_watch(&mut self, entry_index: usize) {
        let store = &mut self.directory_watchers;
        let entry = store.watches.values()[entry_index];

        bun_core::scoped_log!(DevServer, "DirectoryWatchStore.freeEntry({})", entry_index);

        self.bun_watcher.remove_at_index::<true>(
            bun_watcher::WatchItemKind::File,
            entry.watch_index,
            0,
            &[],
        );

        // The Box key drops on swap_remove_at.
        let _ = store.watches.swap_remove_at(entry_index);

        if store.watches.len() == 0 {
            // Every remaining dependency slot must be in the free list.
            debug_assert_eq!(store.dependencies.len(), store.dependencies_free_list.len());
            store.dependencies.clear();
            store.dependencies_free_list.clear();
        }
    }
}
/// `DirectoryWatchStore.Entry` — per-watched-directory state.
#[derive(Copy, Clone, Default)]
pub(crate) struct Entry {
    /// `Dep.Index` — head of the singly-linked dep chain for this dir.
    pub(crate) first_dep: u32,
    /// To pass to `Watcher.remove`.
    pub(crate) watch_index: bun_watcher::WatchItemIndex,
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

impl DevServer {
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
            // There's nothing to watch: the name is too long.
            return Ok(());
        };
        let dir = bun_paths::resolve_path::dirname::<bun_paths::platform::Auto>(joined);

        // The `import_source` parameter is not a stable string. Since the
        // import source will be added to IncrementalGraph anyways, this is a
        // great place to share memory.
        let _g = self.graph_safety_lock.guard();
        let owned_file_path: bun_ptr::RawSlice<u8> = match renderer {
            Graph::Client => {
                self.graphs
                    .client
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
            Graph::Server | Graph::Ssr => {
                self.graphs
                    .server
                    .insert_empty(import_source, FileKind::Unknown)?
                    .key
            }
        };

        self.insert_directory_watch(dir, owned_file_path, specifier)
    }

    /// `dir_name_to_watch` is cloned; `file_path` must outlive the watch;
    /// `specifier` is cloned.
    fn insert_directory_watch(
        &mut self,
        dir_name_to_watch: &[u8],
        file_path: bun_ptr::RawSlice<u8>,
        specifier: &[u8],
    ) -> Result<(), bun_alloc::AllocError> {
        debug_assert!(!specifier.is_empty());
        // TODO: watch the parent dir too.
        let store = &mut self.directory_watchers;

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.insert({}, {}, {})",
            bun_core::fmt::quote(dir_name_to_watch),
            bun_core::fmt::quote(file_path.slice()),
            bun_core::fmt::quote(specifier),
        );

        if store.dependencies_free_list.is_empty() {
            store.dependencies.reserve(1);
        }

        // Note: reshaped for borrowck — capture gop scalars before
        // calling methods that need &mut store.
        let gop = store.watches.get_or_put(
            bun_paths::string_paths::without_trailing_slash_windows_path(dir_name_to_watch),
        )?;
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
            let prev_first = Some(store.watches.values()[gop_index].first_dep);
            // Every rebuild of a file reports its failed imports again.
            let mut it = prev_first;
            while let Some(index) = it {
                let dep = &store.dependencies[index as usize];
                if dep.source_file_path.slice().as_ptr() == file_path.slice().as_ptr()
                    && dep.specifier == specifier_cloned
                {
                    return Ok(());
                }
                it = dep.next;
            }
            let dep = store.append_dep_assume_capacity(Dep {
                next: prev_first,
                source_file_path: file_path,
                specifier: specifier_cloned,
            });
            store.watches.values_mut()[gop_index].first_dep = dep;
            return Ok(());
        }

        // `dir_name_to_watch` is in a pooled buffer, so the watcher copies it.
        let Ok(watch_index) = self
            .bun_watcher
            .add_directory::<true>(dir_name_to_watch, Watcher::get_hash(dir_name_to_watch))
        else {
            // TODO: watch the parent of a directory that does not exist yet (BUN-10968).
            let _ = store.watches.swap_remove_at(gop_index);
            return Ok(()); // ignoring watch errors.
        };

        let dep = store.append_dep_assume_capacity(Dep {
            next: None,
            source_file_path: file_path,
            specifier: specifier_cloned,
        });
        store.watches.values_mut()[gop_index] = Entry {
            first_dep: dep,
            watch_index,
        };
        Ok(())
    }
}

impl DirectoryWatchStore {
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
}

impl DevServer {
    /// Removes all dependencies whose `source_file_path` is the exact slice
    /// of `file`'s key, compared by *pointer identity* since the slice is shared
    /// with `IncrementalGraph.bundled_files`. Called before IncrementalGraph
    /// frees a file's key string so no `Dep` is left holding a dangling pointer.
    pub(crate) fn remove_dependencies_for_file(
        &mut self,
        file: incremental_graph::ClientFileIndex,
    ) {
        if self.directory_watchers.watches.count() == 0 {
            return;
        }
        let file_path = &self.graphs.client.bundled_files.keys()[file.get() as usize];

        bun_core::scoped_log!(
            DevServer,
            "DirectoryWatchStore.removeDependenciesForFile({:?})",
            bstr::BStr::new(file_path),
        );

        let file_path = file_path.as_ptr();

        // Iterate in reverse since `free_directory_watch` uses `swap_remove_at`.
        let mut watch_index = self.directory_watchers.watches.count();
        while watch_index > 0 {
            watch_index -= 1;
            let store = &mut self.directory_watchers;
            // Note: reshaped for borrowck — cannot hold &mut entry across
            // store.free_dependency_index(); walk by index and re-borrow.
            let mut new_chain: Option<u32> = None;
            let mut it: Option<u32> = Some(store.watches.values()[watch_index].first_dep);
            while let Some(index) = it {
                let dep_next = store.dependencies[index as usize].next;
                let dep_path = store.dependencies[index as usize].source_file_path;
                it = dep_next;
                // Pointer-identity comparison.
                if dep_path.slice().as_ptr() == file_path {
                    store.free_dependency_index(index);
                } else {
                    store.dependencies[index as usize].next = new_chain;
                    new_chain = Some(index);
                }
            }
            if let Some(new_first_dep) = new_chain {
                store.watches.values_mut()[watch_index].first_dep = new_first_dep;
            } else {
                self.free_directory_watch(watch_index);
            }
        }
    }
}
