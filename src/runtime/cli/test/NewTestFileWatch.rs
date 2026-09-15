//! `bun test --watch`: reload when a test file is added to a directory that `Scanner::scan` walks.

use std::collections::VecDeque;

use bun_collections::StringSet;
use bun_core::strings;
use bun_jsc::hot_reloader::{self, AddedFileListener, HotReloaderCtx, ImportWatcher};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_paths::string_paths::without_trailing_slash_windows_path;
use bun_ptr::Interned;
use bun_sys::{Dir, ExistsAtType, Fd, FileKind};
use bun_threading::Guarded;

use super::scanner::TestFileRules;

/// A watched directory costs an inotify watch on Linux and an open descriptor on kqueue.
const MAX_WATCHED_DIRS: usize = 4096;

pub(crate) struct NewTestFileWatch {
    rules: TestFileRules,
    /// The directories `scan` was asked to walk.
    roots: Vec<Box<[u8]>>,
    /// The test files `scan` found.
    known_files: StringSet,
    /// The watched directories, without a trailing separator.
    watched_dirs: Guarded<StringSet>,
    max_watched_dirs: usize,
}

impl NewTestFileWatch {
    pub(crate) fn init(
        rules: TestFileRules,
        roots: Vec<Box<[u8]>>,
        test_files: &[Interned],
    ) -> &'static Self {
        let mut known_files = StringSet::new();
        for path in test_files {
            bun_core::handle_oom(known_files.insert(path.as_bytes()));
        }
        crate::cli::cli_arena().alloc(Self {
            rules,
            roots,
            known_files,
            watched_dirs: Guarded::new(StringSet::new()),
            max_watched_dirs: max_watched_dirs(),
        })
    }

    /// Call on the main thread after a run. Reloads at once if a test file appeared since the scan.
    pub(crate) fn start(&'static self, vm: &mut VirtualMachine) {
        if !vm.is_watcher_enabled() {
            return;
        }
        // Set before the first watch, so that no event arrives without a listener.
        let _ = hot_reloader::ADDED_FILE_LISTENER.set(self);

        // SAFETY: `bun_watcher` is the `*mut ImportWatcher` set by
        // `enable_hot_module_reloading`; non-null because
        // `is_watcher_enabled()` checked it.
        let watcher = unsafe { &mut *vm.bun_watcher.cast::<ImportWatcher>() };
        let mut watch_directory = |dir: &[u8]| {
            let _ = watcher.add_directory_by_path(dir);
        };
        let mut added = None;
        for root in &self.roots {
            let root = without_trailing_slash_windows_path(root);
            if !self.reserve_watch(root) {
                continue;
            }
            watch_directory(root);
            added = self.find_new_test_file(root, &mut watch_directory);
            if added.is_some() {
                break;
            }
        }

        if added.is_some() {
            let vm_ptr: *mut VirtualMachine = vm;
            // SAFETY: `vm_ptr` reborrows the live `&mut VirtualMachine`;
            // `run_with_api_lock` takes `&self` only, so the closure holds the
            // unique mutable access on this single-threaded path.
            vm.run_with_api_lock(|| HotReloaderCtx::reload(unsafe { &mut *vm_ptr }));
        }
    }

    /// False if `dir` is watched already or the limit is reached.
    fn reserve_watch(&self, dir: &[u8]) -> bool {
        let mut watched = self.watched_dirs.lock();
        if watched.count() >= self.max_watched_dirs || watched.contains(dir) {
            return false;
        }
        bun_core::handle_oom(watched.insert(dir));
        true
    }

    /// The first test file below `dir` that `scan` did not find. Watches a new directory before it reads it.
    fn find_new_test_file(
        &self,
        dir: &[u8],
        watch_directory: &mut dyn FnMut(&[u8]),
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
                    if !self.rules.walks_directory(&dir, base, name) {
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
                    if !self.known_files.contains(path) {
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
        if !self.watched_dirs.lock().contains(dir) {
            return None;
        }
        self.find_new_test_file(dir, watch_directory)
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
