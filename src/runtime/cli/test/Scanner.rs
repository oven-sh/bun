use std::collections::VecDeque;
use std::rc::Rc;

use bun_alloc::AllocError;
use bun_bundler::Transpiler;
use bun_bundler::options::BundleOptions;
use bun_collections::index_sort;
use bun_core::{StringOrTinyString, strings};
use bun_output::{declare_scope, scoped_log};
use bun_paths::resolve_path::{join_abs_string_buf_checked, platform};
use bun_paths::{self, PathBuffer};
use bun_ptr::Interned;
use bun_resolver::fs::{self as fs, DirEntryIterator, EntriesOption, FileSystem};
use bun_sys::{Dir, Fd};

declare_scope!(jest, hidden);

pub struct Scanner<'a> {
    /// Memory is borrowed.
    pub(crate) exclusion_names: &'a [&'a [u8]],
    /// When this list is empty, no filters are applied.
    /// "test" suffixes (e.g. .spec.*) are always applied when traversing directories.
    pub(crate) filter_names: &'a [&'a [u8]],
    /// Glob patterns for paths to ignore. Matched against the path relative to the
    /// project root (top_level_dir). When a file matches any pattern, it is excluded.
    pub(crate) path_ignore_patterns: &'a [&'a [u8]],
    pub(crate) dirs_to_scan: Fifo,
    /// Paths to test files found while scanning.
    pub(crate) test_files: Vec<Interned>,
    /// Leaf copies from `FileSystem::get()`; no `&FileSystem` is held, since
    /// `read_dir_with_name` re-enters it mutably.
    top_level_dir: &'static [u8],
    filename_store: &'static fs::FilenameStore,
    pub(crate) open_dir_buf: PathBuffer,
    pub(crate) options: &'a BundleOptions<'a>,
    pub(crate) has_iterated: bool,
    pub(crate) search_count: usize,
    /// The directory being iterated; its fd closes once every child `ScanEntry` has been opened.
    current_dir: Option<Rc<Dir>>,
}

// FIFO queue of scan entries (pop_front / push_back).
pub(crate) type Fifo = VecDeque<ScanEntry>;

pub struct ScanEntry {
    /// `None` for children of the root, which are opened by absolute path.
    pub(crate) relative_dir: Option<Rc<Dir>>,
    // `'static` is sound here: borrows from FileSystem.dirname_store, a
    // process-lifetime arena that is never reset.
    pub(crate) dir_path: &'static [u8],
    pub name: StringOrTinyString,
}

#[derive(thiserror::Error, Debug)]
pub enum ScanError {
    /// The entrypoint does not exist or does not fit a `PathBuffer`; never returned for subdirectories.
    #[error("DoesNotExist")]
    DoesNotExist,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(ScanError);

/// Lends the `Scanner` to [`DirEntryIterator`] (whose `next` takes `&self`)
/// for the duration of one `read_directory_with_iterator` call.
struct ScannerDirIter<'s, 'a>(core::cell::RefCell<&'s mut Scanner<'a>>);
impl DirEntryIterator for ScannerDirIter<'_, '_> {
    fn next(&self, fs: &dyn fs::EntryKindResolver, entry: &mut fs::Entry, _fd: Fd) {
        self.0.borrow_mut().next(fs, entry)
    }
}

impl<'a> Scanner<'a> {
    pub(crate) fn init(
        transpiler: &'a Transpiler,
        initial_results_capacity: usize,
    ) -> Result<Scanner<'a>, AllocError> {
        let results = Vec::with_capacity(initial_results_capacity);
        Ok(Scanner {
            exclusion_names: &[],
            filter_names: &[],
            path_ignore_patterns: &[],
            dirs_to_scan: Fifo::new(),
            options: &transpiler.options,
            top_level_dir: FileSystem::get().top_level_dir,
            filename_store: FileSystem::get().filename_store,
            test_files: results,
            open_dir_buf: PathBuffer::uninit(),
            has_iterated: false,
            search_count: 0,
            current_dir: None,
        })
    }

    #[inline]
    pub(crate) fn top_level_dir(&self) -> &'static [u8] {
        self.top_level_dir
    }

    #[inline]
    fn filename_store(&self) -> &'static fs::FilenameStore {
        self.filename_store
    }

    #[inline]
    fn abs_buf_projected<'b>(
        top_level_dir: &'static [u8],
        parts: &[&[u8]],
        buf: &'b mut [u8],
    ) -> Option<&'b [u8]> {
        join_abs_string_buf_checked::<platform::Loose>(top_level_dir, buf, parts)
    }

    /// Take the list of test files out of this scanner. Caller owns the returned
    /// allocation.
    pub(crate) fn take_found_test_files(&mut self) -> Result<Box<[Interned]>, AllocError> {
        Ok(core::mem::take(&mut self.test_files).into_boxed_slice())
    }

    pub(crate) fn scan(&mut self, path_literal: &[u8]) -> Result<(), ScanError> {
        let mut scan_dir_buf = PathBuffer::uninit();
        let parts: [&[u8]; 2] = [self.top_level_dir(), path_literal];
        let Some(path) = Self::abs_buf_projected(self.top_level_dir(), &parts, &mut scan_dir_buf)
        else {
            return Err(ScanError::DoesNotExist);
        };

        let root = self
            .read_dir_with_name(path, None)
            .map_err(|_| ScanError::OutOfMemory)?;

        if let EntriesOption::Err(root_err) = root {
            let e = root_err.original_err;
            if e == bun_resolver::Error::Sys(bun_errno::SystemErrno::ENOTDIR) {
                if self.is_test_file(path) {
                    let stored = self
                        .filename_store()
                        .append_slice(path)
                        .map_err(|_| ScanError::OutOfMemory)?;
                    let rel_path = Interned::from_static(stored);
                    self.test_files.push(rel_path);
                }
            } else if e == bun_resolver::Error::Sys(bun_errno::SystemErrno::ENOENT) {
                return Err(ScanError::DoesNotExist);
            } else {
                scoped_log!(
                    jest,
                    "Scanner.readDirWithName('{}') -> {}",
                    bstr::BStr::new(path),
                    root_err.original_err.name()
                );
            }
        }

        // you typed "." and we already scanned it
        if !self.has_iterated {
            if let EntriesOption::Entries(entries) = root {
                // Collect first so `self.next(…)` doesn't overlap the
                // `entries.data` borrow.
                // this branch is taken when the resolver already has
                // `path` cached (e.g. `run_env_loader`/`read_dir_info` read the
                // cwd before the scanner runs), so `read_directory_with_iterator`
                // returned the cached `EntryMap` without invoking `iterator.next`.
                // Hash-map iteration order is not stable. Sort by (lowercased)
                // base name so test-file discovery order is deterministic —
                // regression/issue/26851 relies on `a_*.test` running before
                // `b_*.test` under `--bail`.
                let sorted: Vec<&fs::Entry> = {
                    let _entries_lock = FileSystem::get().fs.entries_mutex.lock_guard();
                    let mut v: Vec<&fs::Entry> = entries.entries().collect();
                    index_sort::sort_slice_by(&mut v, |a, b| {
                        a.base_lowercase().cmp(b.base_lowercase())
                    });
                    v
                };
                for entry in sorted {
                    self.next(&FileSystem::get().fs, entry);
                }
            }
        }

        while let Some(entry) = self.dirs_to_scan.pop_front() {
            let parts2: [&[u8]; 2] = [entry.dir_path, entry.name.slice()];
            let Some(path2) =
                Self::abs_buf_projected(self.top_level_dir(), &parts2, &mut scan_dir_buf)
            else {
                continue;
            };
            let (parent, rel_path): (Fd, &[u8]) = match &entry.relative_dir {
                Some(parent) => (parent.fd, entry.name.slice()),
                None => (Fd::cwd(), path2),
            };
            #[cfg(not(windows))]
            let opened = bun_sys::open_dir_at(parent, rel_path);
            #[cfg(windows)]
            let opened = bun_sys::open_dir_no_renaming_or_deleting_windows(parent, rel_path);
            // Dropping `entry` releases the parent fd once its last child is opened.
            drop(entry);
            let Ok(child_fd) = opened else {
                continue;
            };
            let child_dir = Rc::new(Dir::from_fd(child_fd));
            let path2 = FileSystem::get()
                .dirname_store
                .append_slice(path2)
                .map_err(|_| ScanError::OutOfMemory)?;
            self.current_dir = Some(Rc::clone(&child_dir));
            let result = self.read_dir_with_name(path2, Some(child_dir.fd));
            self.current_dir = None;
            result.map_err(|_| ScanError::OutOfMemory)?;
        }

        Ok(())
    }

    /// `handle` stays owned by the caller; the resolver caches the listing but not the fd.
    fn read_dir_with_name(
        &mut self,
        name: &[u8],
        handle: Option<Fd>,
    ) -> crate::Result<&'static mut EntriesOption> {
        let iter = ScannerDirIter(core::cell::RefCell::new(self));
        FileSystem::instance()
            .fs
            .read_directory_with_iterator(name, handle, 0, false, iter)
            .map_err(Into::into)
    }

    pub(crate) fn could_be_test_file<const NEEDS_TEST_SUFFIX: bool>(&self, name: &[u8]) -> bool {
        let extname = bun_paths::extension(name);
        if extname.is_empty() || !self.options.loader(extname).is_javascript_like() {
            return false;
        }
        if !NEEDS_TEST_SUFFIX {
            return true;
        }
        let name_without_extension = &name[..name.len() - extname.len()];
        for suffix in TEST_NAME_SUFFIXES {
            if strings::ends_with(name_without_extension, suffix) {
                return true;
            }
        }

        false
    }

    pub(crate) fn does_absolute_path_match_filter(&self, name: &[u8]) -> bool {
        if self.filter_names.is_empty() {
            return true;
        }

        for filter_name in self.filter_names {
            if strings::starts_with(name, filter_name) {
                return true;
            }
        }

        false
    }

    pub(crate) fn does_path_match_filter(&self, name: &[u8]) -> bool {
        if self.filter_names.is_empty() {
            return true;
        }

        for filter_name in self.filter_names {
            if strings::index_of(name, filter_name).is_some() {
                return true;
            }
        }

        false
    }

    /// Returns true if the given path matches any of the path ignore patterns.
    /// The path is matched as a relative path from the project root.
    pub(crate) fn matches_path_ignore_pattern(&self, abs_path: &[u8]) -> bool {
        if self.path_ignore_patterns.is_empty() {
            return false;
        }
        let rel_path = bun_paths::resolve_path::relative(self.top_level_dir(), abs_path);

        // Build rel_path + '/' once. rel_path is a relative path from the project
        // root; 4096 bytes covers any sane test directory depth (POSIX PATH_MAX).
        let mut buf = [0u8; 4096];
        let rel_with_slash: Option<&[u8]> = if !rel_path.is_empty()
            && rel_path.len() < buf.len()
            && rel_path[rel_path.len() - 1] != b'/'
        {
            buf[..rel_path.len()].copy_from_slice(rel_path);
            buf[rel_path.len()] = b'/';
            Some(&buf[..rel_path.len() + 1])
        } else {
            None
        };

        for pattern in self.path_ignore_patterns {
            if bun_glob::r#match(pattern, rel_path).matches() {
                return true;
            }
            // Only try trailing separator for ** patterns (e.g. "vendor/**").
            // Single-star patterns like "vendor/*" must not prune entire
            // directories because * doesn't cross directory boundaries.
            if let Some(p) = rel_with_slash {
                if strings::index_of(pattern, b"**").is_some() {
                    if bun_glob::r#match(pattern, p).matches() {
                        return true;
                    }
                }
            }
        }
        false
    }

    pub(crate) fn is_test_file(&self, name: &[u8]) -> bool {
        self.could_be_test_file::<false>(name)
            && self.does_path_match_filter(name)
            && !self.matches_path_ignore_pattern(name)
    }

    pub(crate) fn next(&mut self, fs: &dyn fs::EntryKindResolver, entry: &fs::Entry) {
        let name = entry.base_lowercase();
        self.has_iterated = true;
        match entry.kind(fs, false) {
            fs::EntryKind::Dir => {
                if (!name.is_empty() && name[0] == b'.') || name == b"node_modules" {
                    return;
                }

                debug_assert!(strings::index_of(name, bun_paths::NODE_MODULES_NEEDLE).is_none());

                for exclude_name in self.exclusion_names {
                    if strings::eql(exclude_name, name) {
                        return;
                    }
                }

                // Prune ignored directory trees early so we never traverse them.
                if !self.path_ignore_patterns.is_empty() {
                    let parts: [&[u8]; 2] = [entry.dir, entry.base()];
                    // reshaped for borrowck — drop the &mut borrow from
                    // abs_buf and reborrow open_dir_buf immutably so &self methods
                    // can be called with the slice.
                    let Some(dir_path_len) = Self::abs_buf_projected(
                        self.top_level_dir(),
                        &parts,
                        &mut self.open_dir_buf,
                    )
                    .map(<[u8]>::len) else {
                        return;
                    };
                    let dir_path = &self.open_dir_buf[..dir_path_len];
                    if self.matches_path_ignore_pattern(dir_path) {
                        return;
                    }
                }

                self.search_count += 1;

                self.dirs_to_scan.push_back(ScanEntry {
                    relative_dir: self.current_dir.clone(),
                    name: entry.base_,
                    dir_path: entry.dir,
                });
            }
            fs::EntryKind::File => {
                // already seen it!
                if !entry.abs_path().is_empty() {
                    return;
                }

                self.search_count += 1;
                if !self.could_be_test_file::<true>(name) {
                    return;
                }

                let parts: [&[u8]; 2] = [entry.dir, entry.base()];
                // reshaped for borrowck — drop the &mut borrow from
                // abs_buf and reborrow open_dir_buf immutably so &self methods
                // below can be called with the slice.
                let Some(path_len) =
                    Self::abs_buf_projected(self.top_level_dir(), &parts, &mut self.open_dir_buf)
                        .map(<[u8]>::len)
                else {
                    return;
                };
                let path = &self.open_dir_buf[..path_len];

                if !self.does_absolute_path_match_filter(path) {
                    let rel_path = bun_paths::resolve_path::relative(self.top_level_dir(), path);
                    if !self.does_path_match_filter(rel_path) {
                        return;
                    }
                }

                if self.matches_path_ignore_pattern(path) {
                    return;
                }

                let stored = match self.filename_store().append_slice(path) {
                    Ok(s) => s,
                    Err(_) => bun_core::out_of_memory(),
                };
                entry.set_abs_path(Interned::from_static(stored));
                self.test_files.push(entry.abs_path());
            }
        }
    }
}

pub(crate) const TEST_NAME_SUFFIXES: [&[u8]; 4] = [b".test", b"_test", b".spec", b"_spec"];
