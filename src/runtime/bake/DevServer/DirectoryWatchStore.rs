//! When a file fails to import a relative path, directory watchers are added so
//! that when a matching file is created, the dependencies can be rebuilt. This
//! handles HMR cases where a user writes an import before creating the file,
//! or moves files around. This structure is not thread-safe.
//!
//! This structure manages those watchers, including releasing them once
//! import resolution failures are solved.
// TODO: when a file fixes its resolution, there is no code specifically to remove the watchers.

use core::mem::offset_of;

use bun_alloc::AllocError;
use crate::bake::dev_server::{self, DevServer};
use crate::bake::Graph as BakeGraph;
use bun_bundler::options::Loader;
use bun_collections::ArrayHashMap;
use bun_core::fmt as bun_fmt;
use bun_paths::{self as path, path_buffer_pool};
use bun_str::strings;
use bun_sys::{self, Fd, O};
use bun_watcher::Watcher;

bun_output::declare_scope!(DevServer, hidden);

/// List of active watchers. Can be re-ordered on removal
pub struct DirectoryWatchStore {
    // TODO(port): Zig stores keys as `[]const u8` sub-slices into a duped
    // buffer (trailing slash trimmed), then frees the slice via allocator.
    // `Box<[u8]>` cannot represent "free the larger backing allocation from a
    // sub-slice"; Phase B may need a thin key newtype or trim-before-dupe.
    pub watches: ArrayHashMap<Box<[u8]>, Entry>,
    pub dependencies: Vec<Dep>,
    /// Dependencies cannot be re-ordered. This list tracks what indexes are free.
    pub dependencies_free_list: Vec<DepIndex>,
}

impl Default for DirectoryWatchStore {
    // Zig: `pub const empty: DirectoryWatchStore = .{ ... }`
    fn default() -> Self {
        Self {
            watches: ArrayHashMap::default(),
            dependencies: Vec::new(),
            dependencies_free_list: Vec::new(),
        }
    }
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum InsertError {
    #[error("Ignore")]
    Ignore,
    #[error("OutOfMemory")]
    OutOfMemory,
}
impl From<AllocError> for InsertError {
    fn from(_: AllocError) -> Self {
        InsertError::OutOfMemory
    }
}
impl From<InsertError> for bun_core::Error {
    fn from(e: InsertError) -> Self {
        // Private enum, fully consumed in track_resolution_failure; provided
        // for the PORTING.md `error{A,B}!T` contract.
        bun_core::err!(<&'static str>::from(e))
    }
}

impl DirectoryWatchStore {
    pub fn owner(&mut self) -> &mut DevServer {
        // SAFETY: `self` is always the `directory_watchers` field of a `DevServer`.
        // TODO(port): @fieldParentPtr aliasing — returning &mut DevServer while
        // &mut self is live is unsound under stacked borrows; Phase B may need
        // to return *mut DevServer or restructure access.
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(DevServer, directory_watchers))
                .cast::<DevServer>()
        }
    }

    pub fn track_resolution_failure(
        &mut self,
        import_source: &[u8],
        specifier: &[u8],
        renderer: BakeGraph,
        loader: Loader,
    ) -> Result<(), AllocError> {
        // When it does not resolve to a file path, there is nothing to track.
        if specifier.is_empty() {
            return Ok(());
        }
        if !path::is_absolute(import_source) {
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
            Loader::File
            | Loader::Json
            | Loader::Jsonc
            | Loader::Toml
            | Loader::Yaml
            | Loader::Json5
            | Loader::Wasm
            | Loader::Napi
            | Loader::Base64
            | Loader::Dataurl
            | Loader::Text
            | Loader::Bunsh
            | Loader::Sqlite
            | Loader::SqliteEmbedded
            | Loader::Md => debug_assert!(false),
        }

        let buf = path_buffer_pool().get();
        let joined = path::join_abs_string_buf(
            path::dirname(import_source, path::Platform::Auto),
            &mut *buf,
            &[specifier],
            path::Platform::Auto,
        );
        let dir = path::dirname(joined, path::Platform::Auto);

        // The `import_source` parameter is not a stable string. Since the
        // import source will be added to IncrementalGraph anyways, this is a
        // great place to share memory.
        let dev = self.owner();
        // TODO(port): graph_safety_lock — assuming RAII guard semantics in Rust port.
        let _guard = dev.graph_safety_lock.lock();
        let owned_file_path: *const [u8] = match renderer {
            BakeGraph::Client => {
                dev.client_graph
                    .insert_empty(import_source, dev_server::FileKind::Unknown)?
                    .key
            }
            BakeGraph::Server | BakeGraph::Ssr => {
                dev.server_graph
                    .insert_empty(import_source, dev_server::FileKind::Unknown)?
                    .key
            }
        };

        match self.insert(dir, owned_file_path, specifier) {
            Ok(()) => Ok(()),
            Err(InsertError::Ignore) => Ok(()), // ignoring watch errors.
            Err(InsertError::OutOfMemory) => Err(AllocError),
        }
    }

    /// `dir_name_to_watch` is cloned
    /// `file_path` must have lifetime that outlives the watch
    /// `specifier` is cloned
    fn insert(
        &mut self,
        dir_name_to_watch: &[u8],
        file_path: *const [u8],
        specifier: &[u8],
    ) -> Result<(), InsertError> {
        debug_assert!(!specifier.is_empty());
        // TODO: watch the parent dir too.
        let dev = self.owner();

        // SAFETY: file_path is a live IncrementalGraph key slice for the duration of this call.
        let file_path_slice = unsafe { &*file_path };
        bun_output::scoped_log!(
            DevServer,
            "DirectoryWatchStore.insert({}, {}, {})",
            bun_fmt::quote(dir_name_to_watch),
            bun_fmt::quote(file_path_slice),
            bun_fmt::quote(specifier),
        );

        if self.dependencies_free_list.is_empty() {
            self.dependencies.reserve(1);
            // PERF(port): was ensureUnusedCapacity — profile in Phase B
        }

        // PORT NOTE: reshaped for borrowck — capturing gop fields before
        // calling self methods that need &mut self.
        let gop = self
            .watches
            .get_or_put(strings::without_trailing_slash_windows_path(dir_name_to_watch))?;
        let gop_index = gop.index;
        let found_existing = gop.found_existing;

        let specifier_cloned: Box<[u8]> = if specifier[0] == b'.' || path::is_absolute(specifier) {
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
            let dep = self.append_dep_assume_capacity(Dep {
                next: prev_first,
                source_file_path: file_path,
                specifier: specifier_cloned,
            });
            self.watches.values_mut()[gop_index].first_dep = dep;
            return Ok(());
        }

        // errdefer store.watches.swapRemoveAt(gop.index)
        let watches_guard = scopeguard::guard(&mut self.watches, |w| {
            w.swap_remove_at(gop_index);
        });
        // TODO(port): errdefer — guard captures &mut self.watches; subsequent
        // self.* accesses below may need raw-ptr workaround in Phase B.

        // Try to use an existing open directory handle
        let cache_fd: Option<Fd> =
            match dev.server_transpiler.resolver.read_dir_info(dir_name_to_watch) {
                Ok(Some(cache)) => cache.get_file_descriptor().unwrap_valid(),
                Ok(None) | Err(_) => None,
            };

        let (fd, owned_fd): (Fd, bool) = if Watcher::REQUIRES_FILE_DESCRIPTORS {
            if let Some(fd) = cache_fd {
                (fd, false)
            } else {
                // TODO(port): std.posix.toPosixPath — build a NUL-terminated
                // path buffer. Using bun_str::ZStr conversion; NameTooLong
                // maps to Ignore.
                let zpath = match bun_str::ZStr::from_bytes_in_buf(dir_name_to_watch) {
                    Ok(p) => p,
                    Err(_) => return Err(InsertError::Ignore), // NameTooLong: wouldn't be able to open, ignore
                };
                match bun_sys::open(&zpath, O::DIRECTORY | Watcher::WATCH_OPEN_FLAGS, 0) {
                    bun_sys::Result::Ok(fd) => (fd, true),
                    bun_sys::Result::Err(err) => match err.errno() {
                        // If this directory doesn't exist, a watcher should be placed
                        // on the parent directory. Then, if this directory is later
                        // created, the watcher can be properly initialized. This would
                        // happen if a specifier like `./dir/whatever/hello.tsx` and
                        // `dir` does not exist, Bun must place a watcher on `.`, see
                        // the creation of `dir`, and repeat until it can open a watcher
                        // on `whatever` to see the creation of `hello.tsx`
                        bun_sys::Errno::NOENT => {
                            // TODO: implement that. for now it ignores (BUN-10968)
                            return Err(InsertError::Ignore);
                        }
                        bun_sys::Errno::NOTDIR => return Err(InsertError::Ignore), // ignore
                        _ => {
                            todo!("log watcher error");
                        }
                    },
                }
            }
        } else {
            (Fd::INVALID, false)
        };
        let fd_guard = scopeguard::guard(fd, |fd| {
            if Watcher::REQUIRES_FILE_DESCRIPTORS && owned_fd {
                fd.close();
            }
        });
        if Watcher::REQUIRES_FILE_DESCRIPTORS {
            bun_output::scoped_log!(
                DevServer,
                "-> fd: {} ({})",
                fd,
                if owned_fd { "from dir cache" } else { "owned fd" },
            );
        }

        let dir_name: Box<[u8]> = Box::<[u8]>::from(dir_name_to_watch);
        // errdefer free(dir_name) — handled by Drop.

        // TODO(port): Zig sets key_ptr to a sub-slice of `dir_name` (trailing
        // slash trimmed) while the allocation backing it is the full dupe.
        // With Box<[u8]> keys we instead dupe the trimmed slice as the key and
        // keep `dir_name` separately for addDirectory/getHash. Verify Watcher
        // does not retain `dir_name` beyond this call.
        let key: Box<[u8]> =
            Box::<[u8]>::from(strings::without_trailing_slash_windows_path(&dir_name));

        let watch_index = match dev
            .bun_watcher
            .add_directory(fd, &dir_name, Watcher::get_hash(&dir_name), false)
        {
            bun_sys::Result::Err(_) => return Err(InsertError::Ignore),
            bun_sys::Result::Ok(id) => id,
        };

        // Disarm errdefer guards: success path.
        let fd = scopeguard::ScopeGuard::into_inner(fd_guard);
        let watches = scopeguard::ScopeGuard::into_inner(watches_guard);

        // PORT NOTE: reshaped for borrowck — append dep before put_assume_capacity.
        let dep = {
            // TODO(port): borrowck — self.append_dep_assume_capacity needs
            // &mut self while `watches` guard held a borrow; reshaped above.
            let d = Dep {
                next: None,
                source_file_path: file_path,
                specifier: specifier_cloned,
            };
            if let Some(index) = self.dependencies_free_list.pop() {
                self.dependencies[index.get()] = d;
                index
            } else {
                let index = DepIndex::init(u32::try_from(self.dependencies.len()).unwrap());
                self.dependencies.push(d);
                // PERF(port): was appendAssumeCapacity — profile in Phase B
                index
            }
        };
        watches.put_assume_capacity(
            key,
            Entry {
                dir: fd,
                dir_fd_owned: owned_fd,
                first_dep: dep,
                watch_index,
            },
        );
        let _ = dir_name; // keep alive past add_directory; dropped here
        Ok(())
    }

    /// Caller must detach the dependency from the linked list it is in.
    pub fn free_dependency_index(&mut self, index: DepIndex) -> Result<(), AllocError> {
        // TODO(port): narrow error set
        // Zig frees `specifier` here; in Rust assigning Dep::default() drops the Box.
        // Zero out the slot so that DevServer.deinit and memoryCost, which
        // iterate `dependencies` without consulting the free list, do
        // not touch the freed allocation or stale borrowed pointers.
        self.dependencies[index.get()] = Dep::default();

        if index.get() == self.dependencies.len() - 1 {
            self.dependencies.truncate(self.dependencies.len() - 1);
        } else {
            self.dependencies_free_list.push(index);
        }
        Ok(())
    }

    /// Expects dependency list to be already freed
    pub fn free_entry(&mut self, entry_index: usize) {
        let entry = self.watches.values()[entry_index];

        bun_output::scoped_log!(
            DevServer,
            "DirectoryWatchStore.freeEntry({}, {})",
            entry_index,
            entry.dir,
        );

        self.owner()
            .bun_watcher
            .remove_at_index(entry.watch_index, 0, &[], bun_watcher::Kind::File);

        // defer if (entry.dir_fd_owned) entry.dir.close();
        let _close_guard = scopeguard::guard((), |_| {
            if entry.dir_fd_owned {
                entry.dir.close();
            }
        });

        // Zig: alloc.free(store.watches.keys()[entry_index]) — Box key drops on swap_remove_at.
        self.watches.swap_remove_at(entry_index);

        if self.watches.len() == 0 {
            // Every remaining dependency slot must be in the free list.
            debug_assert_eq!(self.dependencies.len(), self.dependencies_free_list.len());
            self.dependencies.clear();
            self.dependencies_free_list.clear();
        }
    }

    /// Removes all dependencies whose `source_file_path` is the exact slice
    /// `file_path`, compared by pointer identity since the slice is shared with
    /// IncrementalGraph.bundled_files. Called before IncrementalGraph frees a
    /// file's key string so that no `Dep` is left holding a dangling pointer.
    pub fn remove_dependencies_for_file(&mut self, file_path: &[u8]) {
        if self.watches.len() == 0 {
            return;
        }

        bun_output::scoped_log!(
            DevServer,
            "DirectoryWatchStore.removeDependenciesForFile({})",
            bun_fmt::quote(file_path),
        );

        // Iterate in reverse since `free_entry` uses swap_remove_at.
        let mut watch_index = self.watches.len();
        while watch_index > 0 {
            watch_index -= 1;
            // PORT NOTE: reshaped for borrowck — cannot hold &mut entry across
            // self.free_dependency_index(); walk by index and re-borrow.
            let mut new_chain: Option<DepIndex> = None;
            let mut it: Option<DepIndex> = Some(self.watches.values()[watch_index].first_dep);
            while let Some(index) = it {
                let dep_next = self.dependencies[index.get()].next;
                let dep_ptr = self.dependencies[index.get()].source_file_path;
                it = dep_next;
                // SAFETY: source_file_path is a raw fat ptr stored for identity comparison only.
                if unsafe { (*dep_ptr).as_ptr() } == file_path.as_ptr() {
                    // Zig: bun.handleOom(store.freeDependencyIndex(...))
                    self.free_dependency_index(index).expect("OOM");
                } else {
                    self.dependencies[index.get()].next = new_chain;
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

    fn append_dep_assume_capacity(&mut self, dep: Dep) -> DepIndex {
        if let Some(index) = self.dependencies_free_list.pop() {
            self.dependencies[index.get()] = dep;
            return index;
        }

        let index = DepIndex::init(u32::try_from(self.dependencies.len()).unwrap());
        self.dependencies.push(dep);
        // PERF(port): was appendAssumeCapacity — profile in Phase B
        index
    }
}

#[derive(Clone, Copy)]
pub struct Entry {
    /// The directory handle the watch is placed on
    pub dir: Fd,
    pub dir_fd_owned: bool,
    /// Files which request this import index
    pub first_dep: DepIndex,
    /// To pass to Watcher.remove
    pub watch_index: u16,
}

pub struct Dep {
    pub next: Option<DepIndex>,
    /// The file used
    // TODO(port): lifetime — borrowed from IncrementalGraph.bundled_files key;
    // compared by pointer identity. Stored as raw fat ptr to avoid a struct
    // lifetime param in Phase A.
    pub source_file_path: *const [u8],
    /// The specifier that failed. Before running re-build, it is resolved for, as
    /// creating an unrelated file should not re-emit another error. Allocated memory
    pub specifier: Box<[u8]>,
}

impl Default for Dep {
    // Zig: `pub const empty: Dep = .{ .next = .none, .source_file_path = "", .specifier = &.{} }`
    fn default() -> Self {
        Self {
            next: None,
            source_file_path: b"" as &[u8] as *const [u8],
            specifier: Box::default(),
        }
    }
}

// Zig: `pub const Index = bun.GenericIndex(u32, Dep);`
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct DepIndex(u32);

impl DepIndex {
    #[inline]
    pub const fn init(v: u32) -> Self {
        Self(v)
    }
    #[inline]
    pub const fn get(self) -> usize {
        self.0 as usize
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/DirectoryWatchStore.zig (313 lines)
//   confidence: medium
//   todos:      9
//   notes:      @fieldParentPtr owner() aliasing + ArrayHashMap key sub-slice ownership need Phase B redesign; errdefer chain in insert() reshaped with scopeguard but borrowck overlap likely.
// ──────────────────────────────────────────────────────────────────────────
