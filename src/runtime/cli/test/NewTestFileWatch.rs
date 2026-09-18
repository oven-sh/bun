//! `bun test --watch`: reload when a test file is added to a directory that `Scanner::scan` walks.

use std::collections::VecDeque;

use bun_ast::LoaderHashTable;
use bun_collections::StringSet;
use bun_core::strings;
use bun_jsc::hot_reloader::{self, AddedFileListener, ImportWatcher};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_ptr::Interned;
use bun_sys::{Dir, ExistsAtType, Fd, FileKind};
use bun_threading::Guarded;

use super::scanner::TestFileRules;

/// A watched directory costs an inotify watch on Linux and an open descriptor on kqueue.
const MAX_WATCHED_DIRS: usize = 4096;

const SEPARATORS: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };

pub(crate) struct NewTestFileWatch {
    walker: Walker,
    /// The directories `scan` was asked to walk, without a trailing separator.
    roots: Vec<Box<[u8]>>,
    /// The test files that were there when `start` ran. A later one reloads the process.
    known_files: StringSet,
}

struct Walker {
    /// Copies that live as long as the process: the watcher thread reads them.
    rules: TestFileRules<'static>,
    /// The directories this watches, without a trailing separator.
    watched_dirs: Guarded<StringSet>,
    max_watched_dirs: usize,
}

impl NewTestFileWatch {
    /// `filter_names` are the positionals that `scan` got as filters, as the user wrote them.
    pub(crate) fn init(
        filter_names: &[Box<[u8]>],
        path_ignore_patterns: &[Box<[u8]>],
        loaders: &LoaderHashTable,
        roots: Vec<Box<[u8]>>,
        test_files: &[Interned],
    ) -> &'static mut Self {
        let arena = crate::cli::cli_arena();
        let filter_names = arena.alloc_slice_fill_iter(filter_names.iter().map(|filter| {
            let filter = arena.alloc_slice_copy(filter);
            bun_paths::resolve_path::posix_to_platform_in_place::<u8>(filter);
            &*filter
        }));
        let path_ignore_patterns = arena.alloc_slice_fill_iter(
            path_ignore_patterns
                .iter()
                .map(|pattern| &*arena.alloc_slice_copy(pattern)),
        );
        let mut known_files = StringSet::new();
        for path in test_files {
            bun_core::handle_oom(known_files.insert(path.as_bytes()));
        }
        arena.alloc(Self {
            walker: Walker {
                rules: TestFileRules {
                    filter_names,
                    path_ignore_patterns,
                    loaders: arena.alloc(bun_core::handle_oom(loaders.clone())),
                    top_level_dir: bun_resolver::fs::FileSystem::instance().top_level_dir,
                },
                watched_dirs: Guarded::new(StringSet::new()),
                max_watched_dirs: max_watched_dirs(),
            },
            roots: roots
                .into_iter()
                .map(|root| Box::from(without_trailing_slash_windows_path(&root)))
                .collect(),
            known_files,
        })
    }

    /// Call on the main thread after a run. Only an entry that is added after this reloads.
    pub(crate) fn start(&'static mut self, vm: &mut VirtualMachine) {
        if !vm.is_watcher_enabled() {
            return;
        }
        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
        // `enable_hot_module_reloading`; non-null because
        // `is_watcher_enabled()` checked it.
        let watcher = unsafe { &mut *vm.bun_watcher.cast::<ImportWatcher>() };
        let mut watch_directory = |dir: &[u8]| {
            let _ = watcher.add_directory_by_path(dir);
        };
        let Self {
            walker,
            roots,
            known_files,
        } = &mut *self;
        for root in roots.iter() {
            if !walker.reserve_watch(root) {
                continue;
            }
            watch_directory(root);
            walker.walk(root, &mut watch_directory, &mut |path| {
                bun_core::handle_oom(known_files.insert(path));
                false
            });
        }
        let this: &'static Self = self;
        let _ = hot_reloader::ADDED_FILE_LISTENER.set(this);
    }

    /// Whether `scan` walks `dir`: a root, or below one with no pruned directory on the way.
    fn walks(&self, dir: &[u8]) -> bool {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut name_buf = bun_paths::path_buffer_pool::get();
        self.roots.iter().any(|root| {
            if is_parent_or_equal(root, dir) == ParentEqual::Unrelated {
                return false;
            }
            // `dir[end]` is the separator after the last component that passed, or the end.
            let mut end = strings::trim_right(root, SEPARATORS).len();
            while end < dir.len() {
                let start = end + 1;
                end = strings::index_of_any(&dir[start..], SEPARATORS)
                    .map_or(dir.len(), |i| start + i);
                let base = &dir[start..end];
                let name = strings::copy_lowercase_if_needed(base, &mut name_buf[..]);
                if !base.is_empty()
                    && !self
                        .walker
                        .rules
                        .walks_directory(&dir[..start], base, name, &mut path_buf)
                {
                    return false;
                }
            }
            true
        })
    }
}

impl Walker {
    /// False if `dir` is watched already or the limit is reached.
    fn reserve_watch(&self, dir: &[u8]) -> bool {
        let mut watched = self.watched_dirs.lock();
        if watched.count() >= self.max_watched_dirs || watched.contains(dir) {
            return false;
        }
        bun_core::handle_oom(watched.insert(dir));
        true
    }

    /// Reads `dir` and each directory below it that is not watched yet, and watches it first. Returns the first test file `stop_at` accepts.
    fn walk(
        &self,
        dir: &[u8],
        watch_directory: &mut dyn FnMut(&[u8]),
        stop_at: &mut dyn FnMut(&[u8]) -> bool,
    ) -> Option<Box<[u8]>> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut name_buf = bun_paths::path_buffer_pool::get();
        let mut queue: VecDeque<Box<[u8]>> = VecDeque::new();
        queue.push_back(Box::from(dir));

        while let Some(dir) = queue.pop_front() {
            let Ok(fd) = bun_sys::open_dir_at(Fd::cwd(), &dir) else {
                continue;
            };
            let handle = Dir::from_fd(fd);
            let mut entries = bun_sys::iterate_dir(handle.fd);
            while let Ok(Some(entry)) = entries.next() {
                let base = entry.name.slice_u8();
                // As in `scan`: a stat resolves a link or an unknown kind, and other kinds are skipped.
                let is_dir = match entry.kind {
                    FileKind::Directory => true,
                    FileKind::File => false,
                    FileKind::SymLink | FileKind::Unknown => {
                        let mut name_z = bun_paths::path_buffer_pool::get();
                        match bun_sys::exists_at_type(
                            handle.fd,
                            bun_paths::resolve_path::z(base, &mut name_z),
                        ) {
                            Ok(kind) => kind == ExistsAtType::Directory,
                            Err(_) => continue,
                        }
                    }
                    _ => continue,
                };
                if base.len() > name_buf.len() {
                    continue;
                }
                let name = strings::copy_lowercase_if_needed(base, &mut name_buf[..]);

                if is_dir {
                    if !self.rules.walks_directory(&dir, base, name, &mut path_buf) {
                        continue;
                    }
                    let Some(path) = self.rules.join(&dir, base, &mut path_buf) else {
                        continue;
                    };
                    if !self.reserve_watch(path) {
                        continue;
                    }
                    // No lock is held here: `start` takes the watcher's mutex, which the watcher thread holds.
                    watch_directory(path);
                    queue.push_back(Box::from(path));
                } else {
                    if !self.rules.could_be_test_file::<true>(name) {
                        continue;
                    }
                    let Some(path) = self
                        .rules
                        .filtered_test_file_path(&dir, base, &mut path_buf)
                    else {
                        continue;
                    };
                    if stop_at(path) {
                        return Some(Box::from(path));
                    }
                }
            }
        }

        None
    }
}

impl AddedFileListener for NewTestFileWatch {
    fn on_directory_entry_added(
        &self,
        dir: &[u8],
        watch_directory: &mut dyn FnMut(&[u8]),
    ) -> Option<Box<[u8]>> {
        let dir = without_trailing_slash_windows_path(dir);
        // The watcher also watches the directory of each loaded file, which `scan` may not walk.
        if !self.walks(dir) {
            return None;
        }
        self.walker.walk(dir, watch_directory, &mut |path| {
            !self.known_files.contains(path)
        })
    }
}

fn max_watched_dirs() -> usize {
    #[cfg(unix)]
    if bun_watcher::REQUIRES_FILE_DESCRIPTORS {
        // The run keeps most of the descriptor limit.
        if let Ok(limit) = bun_sys::posix::getrlimit(bun_sys::posix::RlimitResource::NOFILE) {
            return MAX_WATCHED_DIRS.min(usize::try_from(limit.cur / 4).unwrap_or(usize::MAX));
        }
    }
    MAX_WATCHED_DIRS
}
