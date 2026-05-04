use std::collections::VecDeque;

use bun_alloc::AllocError;
use bun_bundler::options::BundleOptions;
use bun_bundler::Transpiler;
use bun_core::err;
use bun_fs::FileSystem;
use bun_fs::real_fs::EntriesOption;
use bun_output::{declare_scope, scoped_log};
use bun_paths::{self, PathBuffer, PathString, SEP_STR};
use bun_str::strings::{self, StringOrTinyString};
use bun_str::ZStr;
use bun_sys::{self, Fd};

declare_scope!(jest, hidden);

pub struct Scanner<'a> {
    /// Memory is borrowed.
    pub exclusion_names: &'a [&'a [u8]],
    /// When this list is empty, no filters are applied.
    /// "test" suffixes (e.g. .spec.*) are always applied when traversing directories.
    pub filter_names: &'a [&'a [u8]],
    /// Glob patterns for paths to ignore. Matched against the path relative to the
    /// project root (top_level_dir). When a file matches any pattern, it is excluded.
    pub path_ignore_patterns: &'a [&'a [u8]],
    pub dirs_to_scan: Fifo,
    /// Paths to test files found while scanning.
    pub test_files: Vec<PathString>,
    // TODO(port): LIFETIMES.tsv classifies as &'a FileSystem, but several call
    // sites (dirname_store.append, readDirectoryWithIterator) mutate. May need
    // interior mutability on FileSystem or &'a mut in Phase B.
    pub fs: &'a FileSystem,
    pub open_dir_buf: PathBuffer,
    pub scan_dir_buf: PathBuffer,
    pub options: &'a BundleOptions,
    pub has_iterated: bool,
    pub search_count: usize,
}

// std.fifo.LinearFifo(ScanEntry, .Dynamic) — ring buffer with readItem/writeItem.
// VecDeque is the direct equivalent (pop_front / push_back).
pub type Fifo = VecDeque<ScanEntry>;

pub struct ScanEntry {
    pub relative_dir: Fd,
    // TODO(port): lifetime — borrows from FileSystem.dirname_store (process-lifetime arena)
    pub dir_path: &'static [u8],
    pub name: StringOrTinyString,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum ScanError {
    /// Scan entrypoint file/directory does not exist. Not returned when
    /// a subdirectory is scanned but does not exist.
    #[error("DoesNotExist")]
    DoesNotExist,
    #[error("OutOfMemory")]
    OutOfMemory,
}
impl From<AllocError> for ScanError {
    fn from(_: AllocError) -> Self {
        ScanError::OutOfMemory
    }
}
impl From<ScanError> for bun_core::Error {
    fn from(e: ScanError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(&e))
    }
}

impl<'a> Scanner<'a> {
    pub fn init(
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
            fs: transpiler.fs,
            test_files: results,
            open_dir_buf: PathBuffer::uninit(),
            scan_dir_buf: PathBuffer::uninit(),
            has_iterated: false,
            search_count: 0,
        })
    }

    // Zig `deinit` only freed `test_files` and `dirs_to_scan`; both are owned
    // containers in Rust and drop automatically. No explicit Drop impl needed.

    /// Take the list of test files out of this scanner. Caller owns the returned
    /// allocation.
    pub fn take_found_test_files(&mut self) -> Result<Box<[PathString]>, AllocError> {
        Ok(core::mem::take(&mut self.test_files).into_boxed_slice())
    }

    pub fn scan(&mut self, path_literal: &[u8]) -> Result<(), ScanError> {
        let parts: [&[u8]; 2] = [self.fs.top_level_dir, path_literal];
        // PORT NOTE: reshaped for borrowck — absBuf borrows self.fs and self.scan_dir_buf disjointly
        let path = self.fs.abs_buf(&parts, &mut self.scan_dir_buf);

        let root = self.read_dir_with_name(path, None).map_err(|_| ScanError::OutOfMemory)?;

        if let EntriesOption::Err(root_err) = root {
            let e = root_err.original_err;
            if e == err!("NotDir") || e == err!("ENOTDIR") {
                if self.is_test_file(path) {
                    let rel_path = PathString::init(self.fs.filename_store.append(path));
                    self.test_files.push(rel_path);
                }
            } else if e == err!("ENOENT") {
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
                let mut iter = entries.data.iterator();
                let fd = entries.fd;
                debug_assert!(fd != Fd::INVALID);
                while let Some(entry) = iter.next() {
                    self.next(*entry.value_ptr, fd);
                }
            }
        }

        while let Some(entry) = self.dirs_to_scan.pop_front() {
            debug_assert!(entry.relative_dir.is_valid());
            #[cfg(not(windows))]
            {
                let dir = entry.relative_dir.std_dir();

                let parts2: [&[u8]; 2] = [entry.dir_path, entry.name.slice()];
                let path2 = self.fs.abs_buf(&parts2, &mut self.open_dir_buf);
                let path2_len = path2.len();
                self.open_dir_buf[path2_len] = 0;
                let name_len = entry.name.slice().len();
                // SAFETY: open_dir_buf[path2_len] == 0 written immediately above
                let path_z = unsafe {
                    ZStr::from_raw(
                        self.open_dir_buf.as_ptr().add(path2_len - name_len),
                        name_len,
                    )
                };
                let Ok(child_dir) = bun_sys::open_dir(dir, path_z) else {
                    continue;
                };
                let path2 = self.fs.dirname_store.append(&self.open_dir_buf[..path2_len])?;
                FileSystem::set_max_fd(child_dir.fd);
                let _ = self
                    .read_dir_with_name(path2, Some(child_dir))
                    .map_err(|_| ScanError::OutOfMemory)?;
            }
            #[cfg(windows)]
            {
                let parts2: [&[u8]; 2] = [entry.dir_path, entry.name.slice()];
                let path2 = self.fs.abs_buf_z(&parts2, &mut self.open_dir_buf);
                let Ok(child_dir) =
                    bun_sys::open_dir_no_renaming_or_deleting_windows(Fd::INVALID, path2)
                else {
                    continue;
                };
                let stored = self.fs.dirname_store.append(path2.as_bytes())?;
                let _ = self
                    .read_dir_with_name(stored, Some(child_dir))
                    .map_err(|_| ScanError::OutOfMemory)?;
            }
        }

        Ok(())
    }

    fn read_dir_with_name(
        &mut self,
        name: &[u8],
        handle: Option<bun_sys::Dir>,
    ) -> Result<&mut EntriesOption, bun_core::Error> {
        // TODO(port): narrow error set
        // TODO(port): readDirectoryWithIterator takes (comptime T: type, this: *T) and calls
        // this.next() for each entry — in Rust this is a callback/trait. Phase B: define a
        // `DirIterator` trait on FileSystem.RealFS and impl it for Scanner.
        self.fs
            .fs
            .read_directory_with_iterator(name, handle, 0, true, self)
    }

    pub fn could_be_test_file<const NEEDS_TEST_SUFFIX: bool>(&mut self, name: &[u8]) -> bool {
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

    pub fn does_absolute_path_match_filter(&self, name: &[u8]) -> bool {
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

    pub fn does_path_match_filter(&self, name: &[u8]) -> bool {
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
    pub fn matches_path_ignore_pattern(&self, abs_path: &[u8]) -> bool {
        if self.path_ignore_patterns.is_empty() {
            return false;
        }
        let rel_path = bun_paths::relative(self.fs.top_level_dir, abs_path);

        // Build rel_path + '/' once. rel_path is a relative path from the project
        // root; 4096 bytes covers any sane test directory depth (POSIX PATH_MAX).
        let mut buf = [0u8; 4096];
        let rel_with_slash: Option<&[u8]> = if !rel_path.is_empty()
            && rel_path.len() + 1 <= buf.len()
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

    pub fn is_test_file(&mut self, name: &[u8]) -> bool {
        self.could_be_test_file::<false>(name)
            && self.does_path_match_filter(name)
            && !self.matches_path_ignore_pattern(name)
    }

    pub fn next(&mut self, entry: &mut bun_fs::Entry, fd: Fd) {
        let name = entry.base_lowercase();
        self.has_iterated = true;
        match entry.kind(&self.fs.fs, true) {
            bun_fs::EntryKind::Dir => {
                if (!name.is_empty() && name[0] == b'.') || name == b"node_modules" {
                    return;
                }

                if cfg!(debug_assertions) {
                    debug_assert!(
                        strings::index_of(
                            name,
                            const_format::concatcp!(SEP_STR, "node_modules", SEP_STR).as_bytes()
                        )
                        .is_none()
                    );
                }

                for exclude_name in self.exclusion_names {
                    if strings::eql(exclude_name, name) {
                        return;
                    }
                }

                // Prune ignored directory trees early so we never traverse them.
                if !self.path_ignore_patterns.is_empty() {
                    let parts: [&[u8]; 2] = [entry.dir, entry.base()];
                    let dir_path = self.fs.abs_buf(&parts, &mut self.open_dir_buf);
                    if self.matches_path_ignore_pattern(dir_path) {
                        return;
                    }
                }

                self.search_count += 1;

                self.dirs_to_scan.push_back(ScanEntry {
                    relative_dir: fd,
                    name: entry.base_,
                    dir_path: entry.dir,
                });
            }
            bun_fs::EntryKind::File => {
                // already seen it!
                if !entry.abs_path.is_empty() {
                    return;
                }

                self.search_count += 1;
                if !self.could_be_test_file::<true>(name) {
                    return;
                }

                let parts: [&[u8]; 2] = [entry.dir, entry.base()];
                let path = self.fs.abs_buf(&parts, &mut self.open_dir_buf);

                if !self.does_absolute_path_match_filter(path) {
                    let rel_path = bun_paths::relative(self.fs.top_level_dir, path);
                    if !self.does_path_match_filter(rel_path) {
                        return;
                    }
                }

                if self.matches_path_ignore_pattern(path) {
                    return;
                }

                entry.abs_path = PathString::init(self.fs.filename_store.append(path));
                self.test_files.push(entry.abs_path);
            }
        }
    }
}

pub const TEST_NAME_SUFFIXES: [&[u8]; 4] = [
    b".test",
    b"_test",
    b".spec",
    b"_spec",
];

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/cli/test/Scanner.zig (268 lines)
//   confidence: medium
//   todos:      4
//   notes:      read_directory_with_iterator callback pattern + fs &mut vs & needs Phase B resolution; ScanEntry.dir_path lifetime borrows dirname_store
// ──────────────────────────────────────────────────────────────────────────
