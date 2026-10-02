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

pub(crate) struct Scanner<'a> {
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
    pub(crate) fs: *mut FileSystem,
    pub(crate) open_dir_buf: PathBuffer,
    pub(crate) options: &'a BundleOptions<'a>,
    pub(crate) has_iterated: bool,
    pub(crate) search_count: usize,
    /// The directory being iterated; its fd closes once every child `ScanEntry` has been opened.
    current_dir: Option<Rc<Dir>>,
    /// The scan root as the resolver names it.
    root_dir: &'static [u8],
    /// Real path of `root_dir`, resolved when the first directory link is met. Empty: unknown.
    root_real: Option<&'static [u8]>,
    /// Real paths of the directories the walk entered through a link.
    followed: FollowedDirs,
    /// The directory being iterated is in `followed`.
    current_followed: bool,
}

type FollowedDirs = bun_collections::hashbrown::HashSet<&'static [u8], bun_wyhash::BuildHasher>;

// FIFO queue of scan entries (pop_front / push_back).
pub(crate) type Fifo = VecDeque<ScanEntry>;

pub(crate) struct ScanEntry {
    /// `None` for children of the root, which are opened by absolute path.
    pub(crate) relative_dir: Option<Rc<Dir>>,
    // `'static` is sound here: borrows from FileSystem.dirname_store, a
    // process-lifetime arena that is never reset.
    pub(crate) dir_path: &'static [u8],
    pub name: StringOrTinyString,
}

const _: () = assert!(core::mem::size_of::<ScanEntry>() == 56);

#[derive(thiserror::Error, Debug)]
pub(crate) enum ScanError {
    /// The entrypoint does not exist or does not fit a `PathBuffer`; never returned for subdirectories.
    #[error("DoesNotExist")]
    DoesNotExist,
    #[error("OutOfMemory")]
    OutOfMemory,
}
bun_core::oom_from_alloc!(ScanError);

/// Newtype around `*mut Scanner` so it can satisfy [`DirEntryIterator`]
/// (whose `next` takes `&self`) while still allowing mutable calls.
#[repr(transparent)]
struct ScannerDirIter<'a>(*mut Scanner<'a>);
impl<'a> DirEntryIterator for ScannerDirIter<'a> {
    fn next(&self, entry: &mut fs::Entry, _fd: Fd) {
        // SAFETY: `self.0` is `&mut Scanner` for the duration of
        // `read_directory_with_iterator`; no other live `&mut` alias exists
        // while the resolver walks entries.
        unsafe { (*self.0).next(entry) }
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
            fs: transpiler.fs,
            test_files: results,
            open_dir_buf: PathBuffer::ZEROED,
            has_iterated: false,
            search_count: 0,
            current_dir: None,
            root_dir: b"",
            root_real: None,
            followed: FollowedDirs::default(),
            current_followed: false,
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
    ) -> Option<&'b [u8]> {
        join_abs_string_buf_checked::<platform::Loose>(top_level_dir, buf, parts)
    }

    /// Take the list of test files out of this scanner. Caller owns the returned
    /// allocation.
    pub(crate) fn take_found_test_files(&mut self) -> Result<Box<[Interned]>, AllocError> {
        Ok(core::mem::take(&mut self.test_files).into_boxed_slice())
    }

    pub(crate) fn scan(&mut self, path_literal: &[u8]) -> Result<(), ScanError> {
        let mut scan_dir_buf = bun_paths::path_buffer_pool::get();
        let parts: [&[u8]; 2] = [self.top_level_dir(), path_literal];
        let Some(path) = Self::abs_buf_projected(self.top_level_dir(), &parts, &mut scan_dir_buf)
        else {
            return Err(ScanError::DoesNotExist);
        };

        self.root_dir = b"";
        self.root_real = None;
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

        if let EntriesOption::Entries(entries) = root {
            self.root_dir = entries.dir;
            // you typed "." and we already scanned it
            if !self.has_iterated {
                self.replay_cached(entries);
            }
        }

        while let Some(entry) = self.dirs_to_scan.pop_front() {
            let parts2: [&[u8]; 2] = [entry.dir_path, entry.name.slice()];
            let Some(path2) = self.fs().abs_buf_checked(&parts2, &mut scan_dir_buf) else {
                continue;
            };
            let followed = !self.followed.is_empty() && self.followed.contains(path2);
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
            let path2 = self
                .fs()
                .dirname_store
                .append_slice(path2)
                .map_err(|_| ScanError::OutOfMemory)?;
            self.current_dir = Some(Rc::clone(&child_dir));
            if !followed {
                let result = self.read_dir_with_name(path2, Some(child_dir.fd));
                self.current_dir = None;
                result.map_err(|_| ScanError::OutOfMemory)?;
                continue;
            }
            // A directory outside the walk's own tree can be one the resolver
            // listed before discovery (a parent of the cwd). The read then
            // returns that listing and calls nothing.
            self.current_followed = true;
            let had_iterated = core::mem::replace(&mut self.has_iterated, false);
            let result = self.read_dir_with_name(path2, Some(child_dir.fd));
            if !self.has_iterated {
                if let Ok(EntriesOption::Entries(entries)) = &result {
                    self.replay_cached(entries);
                }
            }
            self.has_iterated = had_iterated;
            self.current_followed = false;
            self.current_dir = None;
            result.map_err(|_| ScanError::OutOfMemory)?;
        }

        Ok(())
    }

    /// Runs `next` over a listing the resolver returned from its cache without
    /// calling the iterator (`run_env_loader`/`read_dir_info` read the cwd
    /// before the scanner runs).
    fn replay_cached(&mut self, entries: &fs::DirEntry) {
        // Hash-map iteration order is not stable. Sort by (lowercased)
        // base name so test-file discovery order is deterministic —
        // regression/issue/26851 relies on `a_*.test` running before
        // `b_*.test` under `--bail`.
        let mut entry_ptrs: Vec<*mut fs::Entry> = entries.data.values().copied().collect();
        index_sort::sort_slice_by(&mut entry_ptrs, |a, b| {
            // SAFETY: `EntryMap` stores `*mut Entry` into the
            // process-static `EntryStore`; valid for `'static`.
            let (an, bn) = unsafe { ((**a).base_lowercase(), (**b).base_lowercase()) };
            an.cmp(bn)
        });
        for entry_ptr in entry_ptrs {
            // SAFETY: `EntryMap` stores `*mut Entry` into the
            // process-static `EntryStore`; valid for `'static`.
            self.next(unsafe { &mut *entry_ptr });
        }
    }

    /// `handle` stays owned by the caller; the resolver caches the listing but not the fd.
    fn read_dir_with_name(
        &mut self,
        name: &[u8],
        handle: Option<Fd>,
    ) -> crate::Result<&'static mut EntriesOption> {
        let fs_ptr = self.fs;
        let iter = ScannerDirIter(std::ptr::from_mut::<Scanner<'a>>(self));
        // SAFETY: borrows only the `fs` field; re-entrant access is serialised by `RealFS.entries_mutex`.
        unsafe { &mut (*fs_ptr).fs }
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

    /// A directory the walk does not enter: a dot-directory, `node_modules`,
    /// an excluded name, or a path that an ignore pattern matches. `path`
    /// joins to the directory's path and `name_lowercase` is its last part.
    #[inline]
    fn prunes_dir(&mut self, path: &[&[u8]], name_lowercase: &[u8]) -> bool {
        if (!name_lowercase.is_empty() && name_lowercase[0] == b'.')
            || name_lowercase == b"node_modules"
        {
            return true;
        }

        debug_assert!(strings::index_of(name_lowercase, bun_paths::NODE_MODULES_NEEDLE).is_none());

        for exclude_name in self.exclusion_names {
            if strings::eql(exclude_name, name_lowercase) {
                return true;
            }
        }

        // Prune ignored directory trees early so we never traverse them.
        if !self.path_ignore_patterns.is_empty() {
            // reshaped for borrowck — drop the &mut borrow from
            // abs_buf and reborrow open_dir_buf immutably so &self methods
            // can be called with the slice.
            let Some(dir_path_len) =
                Self::abs_buf_projected(self.top_level_dir(), path, &mut self.open_dir_buf)
                    .map(<[u8]>::len)
            else {
                return true;
            };
            let dir_path = &self.open_dir_buf[..dir_path_len];
            if self.matches_path_ignore_pattern(dir_path) {
                return true;
            }
        }

        false
    }

    /// Decides a directory entry that is a link, or that sits in a directory
    /// the walk entered through a link, so that each directory is listed once.
    /// A link to a directory the walk reaches by itself is not followed. Any
    /// other directory is entered the first time only, under its real path.
    /// Returns `true` when the caller queues the entry as a plain child.
    #[cold]
    #[inline(never)]
    fn enters_linked_dir(&mut self, entry: &fs::Entry, link: fs::EntryLink) -> bool {
        if self.root_dir.is_empty() {
            // The root is being read: its entries arrive before any other.
            self.root_dir = entry.dir;
        }

        let mut lexical_buf = bun_paths::path_buffer_pool::get();
        let parts: [&[u8]; 2] = [entry.dir, entry.base()];
        let Some(lexical) = Self::abs_buf_projected(self.top_level_dir(), &parts, &mut lexical_buf)
        else {
            return true;
        };

        let (real, plain): (&[u8], bool) = if link.is_link {
            let real = if link.real_path.is_empty() {
                self.real_path_of(lexical)
            } else {
                self.spell_real(link.real_path)
            };
            let Some(real) = real else {
                return false;
            };
            // A link that names its own place is a plain child, not an alias.
            let same_place = if self.current_followed {
                real == lexical
            } else {
                let root_real = self.root_real();
                !root_real.is_empty()
                    && path_below(lexical, self.root_dir)
                        .is_some_and(|below| path_below(real, root_real) == Some(below))
            };
            if same_place && !self.current_followed {
                return true;
            }
            (real, same_place)
        } else {
            // A child of a followed directory: the walk names it by its real path.
            (lexical, true)
        };

        if self.walk_owns(real) || self.followed.contains(real) {
            return false;
        }
        let Ok(real) = self.filename_store().append_slice(real) else {
            bun_core::out_of_memory();
        };
        self.followed.insert(real);
        if plain {
            return true;
        }

        self.search_count += 1;
        let name = bun_paths::basename(real);
        self.dirs_to_scan.push_back(ScanEntry {
            relative_dir: None,
            dir_path: &real[..real.len() - name.len()],
            name: StringOrTinyString::init(name),
        });
        false
    }

    /// The walk lists `real` by itself: it is the scan root, or it sits below
    /// the root and no directory on the way is pruned.
    fn walk_owns(&mut self, real: &[u8]) -> bool {
        let root_real = self.root_real();
        if root_real.is_empty() {
            return false;
        }
        let Some(below) = path_below(real, root_real) else {
            return false;
        };

        let root_dir = self.root_dir;
        let mut lowercase_buf = [0u8; 256];
        let mut start = 0;
        while start < below.len() {
            let end = strings::index_of_any(&below[start..], SEPARATORS)
                .map_or(below.len(), |at| start + at);
            let name = &below[start..end];
            if name.len() > lowercase_buf.len() {
                return false;
            }
            let name_lowercase = strings::copy_lowercase_if_needed(name, &mut lowercase_buf);
            if self.prunes_dir(&[root_dir, &below[..end]], name_lowercase) {
                return false;
            }
            start = end + 1;
        }
        true
    }

    fn root_real(&mut self) -> &'static [u8] {
        if let Some(real) = self.root_real {
            return real;
        }
        let real = self.real_path_of(self.root_dir).unwrap_or(b"");
        self.root_real = Some(real);
        real
    }

    /// Where `path` leads, from the same call `RealFS::kind` names a link target with.
    fn real_path_of(&self, path: &[u8]) -> Option<&'static [u8]> {
        #[cfg(not(windows))]
        let fd = bun_sys::open_dir_at(Fd::cwd(), path).ok()?;
        #[cfg(windows)]
        let fd = bun_sys::open_dir_no_renaming_or_deleting_windows(Fd::cwd(), path).ok()?;
        let dir = Dir::from_fd(fd);
        let mut buf = bun_paths::path_buffer_pool::get();
        let real = bun_sys::get_fd_path(dir.fd, &mut buf).ok()?;
        let mut spelled = bun_paths::path_buffer_pool::get();
        let real = Self::abs_buf_projected(self.top_level_dir(), &[&*real], &mut spelled)?;
        self.filename_store().append_slice(real).ok()
    }

    /// `real` as the walk spells paths.
    fn spell_real(&self, real: &'static [u8]) -> Option<&'static [u8]> {
        let mut spelled = bun_paths::path_buffer_pool::get();
        let spelled = Self::abs_buf_projected(self.top_level_dir(), &[real], &mut spelled)?;
        if spelled == real {
            return Some(real);
        }
        self.filename_store().append_slice(spelled).ok()
    }

    pub(crate) fn next(&mut self, entry: &mut fs::Entry) {
        let name = entry.base_lowercase();
        self.has_iterated = true;
        // SAFETY: `self.fs` is the process singleton.
        let real_fs = unsafe { &raw mut (*self.fs).fs };
        // SAFETY: caller holds `entries_mutex`; the direct path is single-threaded.
        let link = unsafe { entry.link(real_fs, false) };
        match link.kind {
            fs::EntryKind::Dir => {
                if self.prunes_dir(&[entry.dir, entry.base()], name) {
                    return;
                }

                if (link.is_link || self.current_followed) && !self.enters_linked_dir(entry, link) {
                    return;
                }

                self.search_count += 1;

                self.dirs_to_scan.push_back(ScanEntry {
                    relative_dir: self.current_dir.clone(),
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
                entry.abs_path = Interned::from_static(stored);
                self.test_files.push(entry.abs_path);
            }
        }
    }
}

const SEPARATORS: &[u8] = if cfg!(windows) { b"/\\" } else { b"/" };

/// `path` without its trailing separators.
fn trim_sep(path: &[u8]) -> &[u8] {
    let mut end = path.len();
    while end > 1 && bun_paths::is_sep_native(path[end - 1]) {
        end -= 1;
    }
    &path[..end]
}

/// The part of `path` below `root`, without a leading separator. Empty when
/// both name the same place.
fn path_below<'p>(path: &'p [u8], root: &[u8]) -> Option<&'p [u8]> {
    let root = trim_sep(root);
    let rest = path.strip_prefix(root)?;
    match rest {
        [] => Some(rest),
        [first, below @ ..] if bun_paths::is_sep_native(*first) => Some(below),
        // A filesystem root keeps its separator.
        _ if root.last().is_some_and(|c| bun_paths::is_sep_native(*c)) => Some(rest),
        _ => None,
    }
}

pub(crate) const TEST_NAME_SUFFIXES: [&[u8]; 4] = [b".test", b"_test", b".spec", b"_spec"];
