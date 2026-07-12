use std::collections::VecDeque;

use bun_alloc::AllocError;
use bun_bundler::Transpiler;
use bun_bundler::options::BundleOptions;
#[cfg(not(windows))]
use bun_core::ZStr;
use bun_core::{StringOrTinyString, strings};
use bun_output::{declare_scope, scoped_log};
use bun_paths::resolve_path::{join_abs_string_buf, platform};
use bun_paths::{self, PathBuffer};
use bun_ptr::Interned;
use bun_resolver::fs::{self as fs, DirEntryIterator, EntriesOption, FileSystem};
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
    pub test_files: Vec<Interned>,
    pub fs: *mut FileSystem,
    pub open_dir_buf: PathBuffer,
    pub scan_dir_buf: PathBuffer,
    pub options: &'a BundleOptions<'a>,
    pub has_iterated: bool,
    pub search_count: usize,
}

// FIFO queue of scan entries (pop_front / push_back).
pub(crate) type Fifo = VecDeque<ScanEntry>;

pub struct ScanEntry {
    pub relative_dir: Fd,
    // `'static` is sound here: borrows from FileSystem.dirname_store, a
    // process-lifetime arena that is never reset.
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
bun_core::oom_from_alloc!(ScanError);
impl PartialEq<crate::Error> for ScanError {
    fn eq(&self, other: &crate::Error) -> bool {
        <&'static str>::from(self) == other.name()
    }
}

/// Newtype around `*mut Scanner` so it can satisfy [`DirEntryIterator`]
/// (whose `next` takes `&self`) while still allowing mutable calls.
#[repr(transparent)]
struct ScannerDirIter<'a>(*mut Scanner<'a>);
impl<'a> DirEntryIterator for ScannerDirIter<'a> {
    fn next(&self, entry: &mut fs::Entry, fd: Fd) {
        // SAFETY: `self.0` is `&mut Scanner` for the duration of
        // `read_directory_with_iterator`; no other live `&mut` alias exists
        // while the resolver walks entries.
        unsafe { (*self.0).next(entry, fd) }
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

    #[inline]
    pub(crate) fn fs(&self) -> &'static FileSystem {
        // SAFETY: process-singleton; no `&mut` to it is live outside the iterator callback.
        unsafe { &*self.fs }
    }

    #[inline]
    fn top_level_dir(&self) -> &'static [u8] {
        // SAFETY: field-precise projection; never spans the mutably-borrowed `fs` field.
        unsafe { (*self.fs).top_level_dir }
    }

    #[inline]
    fn filename_store(&self) -> &'static fs::FilenameStore {
        // SAFETY: same as `top_level_dir`.
        unsafe { (*self.fs).filename_store }
    }

    #[inline]
    fn abs_buf_projected<'b>(
        top_level_dir: &'static [u8],
        parts: &[&[u8]],
        buf: &'b mut [u8],
    ) -> &'b [u8] {
        join_abs_string_buf::<platform::Loose>(top_level_dir, buf, parts)
    }

    /// Take the list of test files out of this scanner. Caller owns the returned
    /// allocation.
    pub fn take_found_test_files(&mut self) -> Result<Box<[Interned]>, AllocError> {
        Ok(core::mem::take(&mut self.test_files).into_boxed_slice())
    }

    pub fn scan(&mut self, path_literal: &[u8]) -> Result<(), ScanError> {
        let parts: [&[u8]; 2] = [self.fs().top_level_dir, path_literal];
        // reshaped for borrowck — abs_buf's return keeps a &mut borrow
        // of scan_dir_buf alive across the &mut self calls below. Capture only the
        // length, then reconstruct a detached slice from the raw buffer pointer.
        let path_len = self.fs().abs_buf(&parts, &mut self.scan_dir_buf).len();
        // SAFETY: scan_dir_buf is not written again for the remainder of this
        // function — read_dir_with_name/next() only touch open_dir_buf — so the
        // bytes at [0, path_len) remain valid while `path` is live.
        let path: &[u8] =
            unsafe { core::slice::from_raw_parts(self.scan_dir_buf.0.as_ptr(), path_len) };

        let root = self
            .read_dir_with_name(path, None)
            .map_err(|_| ScanError::OutOfMemory)?;

        if let EntriesOption::Err(root_err) = root {
            let e = root_err.original_err;
            if e == bun_resolver::Error::Sys(bun_errno::SystemErrno::ENOTDIR) {
                if self.is_test_file(path) {
                    let stored = self
                        .fs()
                        .filename_store
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
                let fd = entries.fd;
                debug_assert!(fd != Fd::INVALID);
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
                let mut entry_ptrs: Vec<*mut fs::Entry> = entries.data.values().copied().collect();
                entry_ptrs.sort_by(|a, b| {
                    // SAFETY: `EntryMap` stores `*mut Entry` into the
                    // process-static `EntryStore`; valid for `'static`.
                    let (an, bn) = unsafe { ((**a).base_lowercase(), (**b).base_lowercase()) };
                    an.cmp(bn)
                });
                for entry_ptr in entry_ptrs {
                    // SAFETY: `EntryMap` stores `*mut Entry` into the
                    // process-static `EntryStore`; valid for `'static`.
                    self.next(unsafe { &mut *entry_ptr }, fd);
                }
            }
        }

        while let Some(entry) = self.dirs_to_scan.pop_front() {
            debug_assert!(entry.relative_dir.is_valid());
            #[cfg(not(windows))]
            {
                let dir = entry.relative_dir;

                let parts2: [&[u8]; 2] = [entry.dir_path, entry.name.slice()];
                let path2 = self.fs().abs_buf(&parts2, &mut self.open_dir_buf);
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
                // bun.openDir → sys.openat(dir, pathZ, O.DIRECTORY|O.CLOEXEC|O.RDONLY, 0).stdDir()
                let Ok(child_fd) = bun_sys::open_dir_at(dir, path_z.as_bytes()) else {
                    continue;
                };
                let child_dir = bun_sys::Dir::from_fd(child_fd);
                let path2 = self
                    .fs()
                    .dirname_store
                    .append_slice(&self.open_dir_buf[..path2_len])
                    .map_err(|_| ScanError::OutOfMemory)?;
                FileSystem::set_max_fd(child_dir.fd.native());
                let _ = self
                    .read_dir_with_name(path2, Some(child_dir))
                    .map_err(|_| ScanError::OutOfMemory)?;
            }
            #[cfg(windows)]
            {
                let fs = self.fs();
                let parts2: [&[u8]; 2] = [entry.dir_path, entry.name.slice()];
                let path2 = fs.abs_buf_z(&parts2, &mut self.open_dir_buf);
                let Ok(child_fd) = bun_sys::open_dir_no_renaming_or_deleting_windows(
                    Fd::INVALID,
                    path2.as_bytes(),
                ) else {
                    continue;
                };
                let child_dir = bun_sys::Dir::from_fd(child_fd);
                let stored = fs
                    .dirname_store
                    .append_slice(path2.as_bytes())
                    .map_err(|_| ScanError::OutOfMemory)?;
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
    ) -> crate::Result<&'static mut EntriesOption> {
        let fs_ptr = self.fs;
        let iter = ScannerDirIter(std::ptr::from_mut::<Scanner<'a>>(self));
        let raw = handle.map(bun_sys::Dir::into_raw);
        // SAFETY: borrows only the `fs` field; re-entrant access is serialised by `RealFS.entries_mutex`.
        unsafe { &mut (*fs_ptr).fs }
            .read_directory_with_iterator(name, raw, 0, true, iter)
            .map_err(Into::into)
    }

    pub fn could_be_test_file<const NEEDS_TEST_SUFFIX: bool>(&self, name: &[u8]) -> bool {
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

    pub fn is_test_file(&self, name: &[u8]) -> bool {
        self.could_be_test_file::<false>(name)
            && self.does_path_match_filter(name)
            && !self.matches_path_ignore_pattern(name)
    }

    pub fn next(&mut self, entry: &mut fs::Entry, fd: Fd) {
        let name = entry.base_lowercase();
        self.has_iterated = true;
        // SAFETY: `self.fs` is the process singleton.
        let real_fs = unsafe { &raw mut (*self.fs).fs };
        // SAFETY: caller holds `entries_mutex`; the direct path is single-threaded.
        match unsafe { entry.kind(real_fs, true) } {
            fs::EntryKind::Dir => {
                if (!name.is_empty() && name[0] == b'.') || name == b"node_modules" {
                    return;
                }

                if cfg!(debug_assertions) {
                    debug_assert!(
                        strings::index_of(name, bun_paths::NODE_MODULES_NEEDLE).is_none()
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
                    // reshaped for borrowck — drop the &mut borrow from
                    // abs_buf and reborrow open_dir_buf immutably so &self methods
                    // can be called with the slice.
                    let dir_path_len = Self::abs_buf_projected(
                        self.top_level_dir(),
                        &parts,
                        &mut self.open_dir_buf,
                    )
                    .len();
                    let dir_path = &self.open_dir_buf[..dir_path_len];
                    if self.matches_path_ignore_pattern(dir_path) {
                        return;
                    }
                }

                self.search_count += 1;

                self.dirs_to_scan.push_back(ScanEntry {
                    relative_dir: fd,
                    // SAFETY: StringOrTinyString is repr(C) POD ([u8;31] + u8) with
                    // no Drop. Upstream type lacks Clone/Copy, so bitwise-copy here.
                    name: unsafe { core::ptr::read(&raw const entry.base_) },
                    dir_path: entry.dir,
                });
            }
            fs::EntryKind::File => {
                // already seen it!
                if !entry.abs_path.is_empty() {
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
                let path_len =
                    Self::abs_buf_projected(self.top_level_dir(), &parts, &mut self.open_dir_buf)
                        .len();
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
                entry.abs_path = Interned::from_static(stored);
                self.test_files.push(entry.abs_path);
            }
        }
    }
}

pub(crate) const TEST_NAME_SUFFIXES: [&[u8]; 4] = [b".test", b"_test", b".spec", b"_spec"];
