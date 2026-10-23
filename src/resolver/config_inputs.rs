//! The configuration files behind the directory cache.
//!
//! A [`DirInfo`] holds what the resolver read from the "tsconfig.json" or "jsconfig.json" of its
//! directory and from the files that one extends, and keeps it for as long as its key is in the
//! cache. A lookup does not compare it with the files. A caller that watches files tells the
//! resolver when one of them changed:
//!
//! - [`Resolver::config_files_since`] names the files to watch.
//! - [`Resolver::config_file_changed`] reads one of them again. When a directory that was
//!   filled from it would now be filled with something else, that directory and those below it
//!   leave the cache, and [`Resolver::config_generation`] grows.
//!
//! Only a file that parses changes what the cache has. One that was removed, is empty or does
//! not parse keeps what it gave.
//!
//! What each directory was filled from is recorded once for the process, like the cache. So
//! each caller compares the generation with the one it built for, and a second caller does not
//! empty the cache again for a change that the first one reported.

use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::LazyLock;

use bun_collections::StringArrayHashMap;
use bun_paths::SEP;
use bun_paths::string_paths::{
    path_contains_node_modules_folder, without_trailing_slash_windows_path,
};
use bun_sys::Fd;

use crate::dir_info::{DirInfo, DirInfoRef};
use crate::fs::file_system::EntryKind;
use crate::resolver::{Dirname, Resolver};
use crate::tsconfig_json::TSConfigJSON;

/// The fingerprint of a directory with no configuration file.
const NOTHING: u64 = 0;

/// What a directory of the cache was filled from.
#[derive(Default)]
struct Filled {
    /// [`TSConfigJSON::fingerprint`], or `NOTHING`.
    fingerprint: u64,
    /// The index in `ConfigInputs::readers` of each file that was read.
    files: Vec<u32>,
    /// The directory left the cache with a tree that a file emptied. Every module is built
    /// again after that, from what the directory is filled with next.
    left_cache: bool,
}

#[derive(Default)]
struct ConfigInputs {
    /// By the path that a directory of the cache was filled by. The same directory by a path
    /// with a symbolic link is another one here, as it is in the cache.
    taken: StringArrayHashMap<Filled>,
    /// By the path of a configuration file: the index in `taken` of each directory that was
    /// filled from it. The keys are the files that were named, in the order they were named.
    readers: StringArrayHashMap<Vec<u32>>,
    /// How many slots of the directory cache were named.
    slots: u32,
}

impl ConfigInputs {
    /// Marks the directories at and below `dir`, whose tree left the cache.
    fn left_cache(&mut self, dir: &[u8]) {
        use bun_paths::resolve_path::{ParentEqual, is_parent_or_equal};
        for index in 0..self.taken.count() {
            if is_parent_or_equal(dir, &self.taken.keys()[index]) != ParentEqual::Unrelated {
                self.taken.values_mut()[index].left_cache = true;
            }
        }
    }

    /// Returns the index of `file` in `readers`.
    fn add_reader(&mut self, file: &[u8], directory: u32) -> u32 {
        let entry = bun_core::handle_oom(self.readers.get_or_put(file));
        if !entry.value_ptr.contains(&directory) {
            entry.value_ptr.push(directory);
        }
        entry.index as u32
    }
}

static INPUTS: LazyLock<bun_threading::Guarded<ConfigInputs>> = LazyLock::new(Default::default);
static GENERATION: AtomicU32 = AtomicU32::new(0);

/// Where a caller is in the files that [`Resolver::config_files_since`] names.
#[derive(Default)]
pub struct ConfigCursor {
    slots: u32,
    files: usize,
}

const TSCONFIG_NAMES: [&[u8]; 2] = [b"tsconfig.json", b"jsconfig.json"];

fn child_path(dir: &[u8], name: &[u8]) -> Vec<u8> {
    let mut path = Vec::with_capacity(dir.len() + 1 + name.len());
    path.extend_from_slice(dir);
    if !dir.ends_with(&[SEP]) {
        path.push(SEP);
    }
    path.extend_from_slice(name);
    path
}

/// The size of the file at `path`. `None`: it is not there.
fn file_size(path: &[u8]) -> Option<u64> {
    let mut path = path.to_vec();
    path.push(0);
    let path = bun_core::ZStr::from_buf(&path, path.len() - 1);
    bun_sys::stat(path).ok().map(|stat| stat.st_size as u64)
}

/// Whether `path` is the configuration file of its directory, and not one of an installed
/// package.
fn is_config_file_of_directory(path: &[u8]) -> bool {
    TSCONFIG_NAMES.contains(&bun_paths::basename(path)) && !path_contains_node_modules_folder(path)
}

/// Whether `info` is a directory of the project, and not one of an installed package: those are
/// below a "node_modules" directory, or in the cache that auto-install fills.
fn is_project_directory(info: &DirInfo, real_path: &[u8]) -> bool {
    if path_contains_node_modules_folder(real_path) {
        return false;
    }
    // A package that auto-install put in the global cache is filled with no parent.
    let mut top_path = info.abs_path;
    let mut parent = info.get_parent();
    while let Some(dir) = parent {
        top_path = dir.abs_path;
        parent = dir.get_parent();
    }
    Dirname::dirname(top_path).len() >= top_path.len()
}

impl Resolver<'_> {
    /// How many times the cache was emptied of what a configuration file gave, since the
    /// process started. The modules that a caller built before the last time are built from
    /// what the file gave then.
    pub fn config_generation() -> u32 {
        GENERATION.load(Ordering::Acquire)
    }

    /// Calls `each` with every configuration file that the directories of the cache were filled
    /// from, and that `cursor` was not yet given: the "tsconfig.json" or "jsconfig.json" of a
    /// directory, and every file that one extends. The directories and the files of installed
    /// packages are left out.
    ///
    /// It reads no file. A file that changed between the fill and this call is as it was for
    /// the cache until [`config_file_changed`](Self::config_file_changed) reads it.
    ///
    /// It costs one lock and one comparison when the cache has no new directory. `each` runs
    /// under the lock of the resolver.
    pub fn config_files_since(&mut self, cursor: &mut ConfigCursor, mut each: impl FnMut(&[u8])) {
        // A fill writes its slot under this lock.
        let _lock = self.mutex.lock_guard();
        if self.dir_cache_mut().slot_count() == cursor.slots {
            return;
        }
        let mut inputs = INPUTS.lock();
        let mut filled_again = false;
        while let Some(slot) = self.dir_cache_mut().at_slot(inputs.slots) {
            let dir = DirInfoRef::from_slot(slot);
            inputs.slots += 1;
            if let Some(path) = self.name_config_files(&mut inputs, &dir) {
                self.bust_dir_cache_tree(path);
                inputs.left_cache(path);
                filled_again = true;
            }
        }
        if filled_again {
            GENERATION.fetch_add(1, Ordering::AcqRel);
        }
        for path in &inputs.readers.keys()[cursor.files..] {
            each(path);
        }
        cursor.files = inputs.readers.count();
        cursor.slots = inputs.slots;
    }

    /// Whether `path` is a configuration file: a "tsconfig.json" or "jsconfig.json" that is not
    /// of an installed package, or a file that one of them extends. It costs one map lookup.
    pub fn is_config_file(path: &[u8]) -> bool {
        is_config_file_of_directory(path) || INPUTS.lock().readers.contains_key(path)
    }

    /// Reads the configuration file `path` again, after it was written, replaced or created.
    /// Returns whether a directory that was filled from it is now filled with something else.
    /// If so, that directory and those below it left the cache.
    ///
    /// Only a file that parses changes what the cache has. One that was removed, is empty (a
    /// save in progress) or does not parse keeps what it gave. What is wrong with it goes to
    /// `log`, whose messages borrow `path`.
    pub fn config_file_changed(&mut self, path: &[u8], log: &mut bun_ast::Log) -> bool {
        if !self.opts.load_tsconfig_json {
            return false;
        }
        // A fill reads the files under this lock. Under it, a caller on another thread sees
        // the record, the cache and the generation of one moment.
        let _lock = self.mutex.lock_guard();
        let mut inputs = INPUTS.lock();
        let mut dirs: Vec<Box<[u8]>> = inputs.readers.get(path).map_or_else(Vec::new, |readers| {
            let paths = inputs.taken.keys();
            readers
                .iter()
                .map(|&index| paths[index as usize].clone())
                .collect()
        });
        if is_config_file_of_directory(path) {
            // One that is new has no reader yet.
            let dir = without_trailing_slash_windows_path(Dirname::dirname(path));
            if !dirs.iter().any(|it| **it == *dir) {
                dirs.push(Box::from(dir));
            }
        }
        if dirs.is_empty() {
            return false;
        }

        let size = file_size(path);
        if size.is_none() {
            // The listings still have the file. A fill from one of them would ask for it.
            for dir in &dirs {
                let _ = self.fs_mut().fs.bust_entries_cache(dir);
            }
        }
        let resolver_log = core::mem::replace(&mut self.log, NonNull::from(log));
        let mut changed = false;
        if size.is_some_and(|size| size > 0) && self.config_file_parses(path) {
            for dir in &dirs {
                let Some(now) = self.tsconfig_fingerprint(&inputs, dir) else {
                    continue;
                };
                let record = bun_core::handle_oom(inputs.taken.get_or_put(dir));
                let same = record.found_existing && record.value_ptr.fingerprint == now;
                record.value_ptr.fingerprint = now;
                if !same {
                    self.bust_dir_cache_tree(dir);
                    inputs.left_cache(dir);
                    changed = true;
                }
            }
        }
        self.log = resolver_log;
        if changed {
            GENERATION.fetch_add(1, Ordering::AcqRel);
        }
        changed
    }

    /// Whether the file at `path` parses. What is wrong with one that does not is in the log of
    /// the resolver.
    fn config_file_parses(&mut self, path: &[u8]) -> bool {
        match self.parse_tsconfig(path, Fd::INVALID) {
            Ok(Some(config)) => {
                TSConfigJSON::destroy(config);
                true
            }
            _ => false,
        }
    }

    /// Names the configuration file of `dir` and the files it extends, and records what `dir`
    /// was filled from. Returns the path of `dir` when a directory with that path was filled
    /// from something else before: the file changed with no call of
    /// [`config_file_changed`](Self::config_file_changed) that took the change.
    fn name_config_files(
        &mut self,
        inputs: &mut ConfigInputs,
        dir: &DirInfo,
    ) -> Option<&'static [u8]> {
        if !self.opts.load_tsconfig_json {
            return None;
        }
        let (path, real_path, config) = {
            // The fill of a package that auto-install put in the cache holds this lock only.
            let _entries_lock = self.fs_ref().fs.entries_mutex.lock_guard();
            (dir.abs_path, dir.abs_real_path, dir.tsconfig_json())
        };
        let path = without_trailing_slash_windows_path(path);
        let real_path = if real_path.is_empty() {
            path
        } else {
            without_trailing_slash_windows_path(real_path)
        };
        if !is_project_directory(dir, real_path) {
            return None;
        }
        // A slot that left the cache says nothing about what the cache has.
        let in_cache = self
            .dir_cache_mut()
            .get(path)
            .is_some_and(|slot| core::ptr::eq(&raw const *slot, dir));
        if !in_cache {
            return None;
        }
        // As a fill asks. A file that is there and does not parse is one to watch too.
        let name = TSCONFIG_NAMES
            .into_iter()
            .find(|name| self.has_file(dir, name));
        if name.is_none() && !inputs.taken.contains_key(path) {
            return None;
        }

        let filled_from = config.map_or(NOTHING, TSConfigJSON::fingerprint);
        let record = bun_core::handle_oom(inputs.taken.get_or_put(path));
        let index = record.index as u32;
        let filled_again = record.found_existing
            && !core::mem::take(&mut record.value_ptr.left_cache)
            && record.value_ptr.fingerprint != filled_from;
        record.value_ptr.fingerprint = filled_from;

        let mut files: Vec<u32> = Vec::new();
        if let Some(name) = name {
            // By the path that the watcher reports it by.
            files.push(inputs.add_reader(&child_path(real_path, name), index));
        }
        // The first of the chain is the file of the directory.
        let extended = config.map_or(&[][..], |config| {
            config.extends_chain.get(1..).unwrap_or(&[])
        });
        for file in extended {
            if !path_contains_node_modules_folder(file) {
                files.push(inputs.add_reader(file, index));
            }
        }
        inputs.taken.values_mut()[index as usize].files = files;
        filled_again.then_some(path)
    }

    /// Whether the listing that `dir` was filled from has the file `name`.
    fn has_file(&self, dir: &DirInfo, name: &[u8]) -> bool {
        dir.get_entry(self.generation, name).is_some_and(|lookup| {
            // SAFETY: `rfs_ptr` is the `RealFS` of the process. A write to the entry that
            // `kind` makes is under the mutex of the entry.
            unsafe { lookup.entry().kind(self.rfs_ptr(), self.store_fd) == EntryKind::File }
        })
    }

    /// [`TSConfigJSON::fingerprint`] of what a fill of the directory `dir` reads now: the first
    /// of "tsconfig.json" and "jsconfig.json" that is a file, with what it extends. `NOTHING`
    /// when neither is there. `None` when a file that `dir` was filled from is not there now
    /// or does not parse now: then `dir` keeps what it has.
    fn tsconfig_fingerprint(&mut self, inputs: &ConfigInputs, dir: &[u8]) -> Option<u64> {
        let is_file = |path: &[u8]| {
            let mut path = path.to_vec();
            path.push(0);
            let path = bun_core::ZStr::from_buf(&path, path.len() - 1);
            matches!(
                bun_sys::exists_at_type(Fd::cwd(), path),
                Ok(bun_sys::ExistsAtType::File)
            )
        };
        let files = inputs.readers.keys();
        let filled_from: &[u32] = inputs.taken.get(dir).map_or(&[], |filled| &filled.files);
        if filled_from
            .iter()
            .any(|&file| !is_file(&files[file as usize]))
        {
            return None;
        }
        for name in TSCONFIG_NAMES {
            let path = child_path(dir, name);
            if !is_file(&path) {
                continue;
            }
            // A file that the parser rejects is an error. An option with a value that is not
            // one is a warning, and that file gives the rest.
            let errors = self.log_ref().errors;
            let loaded = self.load_tsconfig(&path, Fd::INVALID);
            let rejected = self.log_ref().errors != errors;
            let (fingerprint, chain) = match loaded {
                Ok(Some(mut config)) => {
                    let fingerprint = config.fingerprint();
                    let chain = core::mem::take(&mut config.extends_chain);
                    TSConfigJSON::destroy(config);
                    (fingerprint, chain)
                }
                _ => (NOTHING, Box::default()),
            };
            // The chain ends at the file that was rejected. One that gave nothing before is
            // taken as a fill takes it, and that fill names it.
            let rejected_file: &[u8] = chain.last().map_or(&path, |file| file);
            let keeps = rejected
                && filled_from
                    .iter()
                    .any(|&file| *files[file as usize] == *rejected_file);
            return (!keeps).then_some(fingerprint);
        }
        Some(NOTHING)
    }
}
