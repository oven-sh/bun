//! The configuration files behind the directory cache.
//!
//! A [`DirInfo`] holds what the resolver read from the "tsconfig.json" or "jsconfig.json" of its
//! directory and from the files that one extends, and keeps it for as long as its key is in the
//! cache. A lookup does not compare it with the files. A caller that watches files tells the
//! resolver when one of them changed:
//!
//! - [`Resolver::config_files_since`] names the files to watch.
//! - [`Resolver::config_file_changed`] reads one of them again. When the resolver now takes
//!   something else from it, the directories that were filled from it leave the cache and
//!   [`Resolver::config_generation`] grows.
//!
//! What was last taken from each file is recorded once for the process, like the cache. So each
//! caller compares the generation with the one it built for, and a second caller does not
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

#[derive(Default)]
struct ConfigInputs {
    /// By directory, with symbolic links resolved: [`TSConfigJSON::fingerprint`] of what its
    /// configuration file last gave.
    taken: StringArrayHashMap<u64>,
    /// By the path of a file that a "tsconfig.json" extends: the index in `taken` of each
    /// directory with such a "tsconfig.json".
    extended_by: StringArrayHashMap<Vec<u32>>,
    /// Every file that was named, in the order it was named.
    files: StringArrayHashMap<()>,
    /// How many slots of the directory cache were named.
    slots: u32,
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
    /// How many times a configuration file gave something new since the process started. The
    /// modules that a caller built before the last time are built from what the file gave then.
    pub fn config_generation() -> u32 {
        GENERATION.load(Ordering::Acquire)
    }

    /// Calls `each` with every configuration file that the directories of the cache were filled
    /// from, and that `cursor` was not yet given: the "tsconfig.json" or "jsconfig.json" of a
    /// directory, and every file that one extends. The directories and the files of installed
    /// packages are left out.
    ///
    /// A file can change between the fill and the first time it is named here: the runtime fills
    /// the directories of the entry point when the process starts. Such a file counts as
    /// changed, as in [`config_file_changed`](Self::config_file_changed).
    ///
    /// It costs one comparison when the cache has no new directory. `each` runs under the lock
    /// of the resolver.
    pub fn config_files_since(&mut self, cursor: &mut ConfigCursor, mut each: impl FnMut(&[u8])) {
        if self.dir_cache_mut().slot_count() == cursor.slots {
            return;
        }
        let mut changed: Vec<Box<[u8]>> = Vec::new();
        {
            // A fill writes its slot under this lock, and reads the files under it.
            let _lock = self.mutex.lock_guard();
            let mut inputs = INPUTS.lock();
            let (mut ignored, log) = (bun_ast::Log::init(), self.log);
            self.log = NonNull::from(&mut ignored);
            while let Some(slot) = self.dir_cache_mut().at_slot(inputs.slots) {
                let dir = DirInfoRef::from_slot(slot);
                inputs.slots += 1;
                if let Some(scope) = self.name_config_files(&mut inputs, &dir) {
                    changed.push(scope);
                }
            }
            self.log = log;
            for path in &inputs.files.keys()[cursor.files..] {
                each(path);
            }
            cursor.files = inputs.files.count();
            cursor.slots = inputs.slots;
        }
        self.drop_config_scopes(&changed);
    }

    /// Whether `path` is a configuration file: a "tsconfig.json" or "jsconfig.json" that is not
    /// of an installed package, or a file that one of them extends. It costs one map lookup.
    pub fn is_config_file(path: &[u8]) -> bool {
        is_config_file_of_directory(path) || INPUTS.lock().extended_by.contains_key(path)
    }

    /// Reads the configuration file `path` again, after it was written, replaced, removed or
    /// created. Returns whether the resolver now takes something else from it. If so, every
    /// directory that was filled from it left the cache.
    ///
    /// A file that does not parse changes nothing: the directories keep what they have, and
    /// what is wrong with the file goes to `log`, whose messages borrow `path`. A file that is
    /// empty is a save in progress: the event of the write follows.
    pub fn config_file_changed(&mut self, path: &[u8], log: &mut bun_ast::Log) -> bool {
        if !self.opts.load_tsconfig_json {
            return false;
        }
        let mut scopes: Vec<Box<[u8]>> = Vec::new();
        {
            let inputs = INPUTS.lock();
            if let Some(indices) = inputs.extended_by.get(path) {
                let known = inputs.taken.keys();
                scopes.extend(indices.iter().map(|&index| known[index as usize].clone()));
            }
        }
        if is_config_file_of_directory(path) {
            let scope = without_trailing_slash_windows_path(Dirname::dirname(path));
            scopes.push(Box::from(scope));
        }
        if scopes.is_empty() {
            return false;
        }

        let mut changed: Vec<Box<[u8]>> = Vec::new();
        {
            // A fill reads the files under this lock.
            let _lock = self.mutex.lock_guard();
            if self
                .read_config_file(path)
                .is_some_and(|bytes| bytes.is_empty())
            {
                return false;
            }
            let resolver_log = core::mem::replace(&mut self.log, NonNull::from(log));
            for scope in scopes {
                let mut inputs = INPUTS.lock();
                let Some(now) = self.tsconfig_fingerprint(&inputs, &scope) else {
                    continue;
                };
                let taken = bun_core::handle_oom(inputs.taken.get_or_put(&scope)).value_ptr;
                if core::mem::replace(taken, now) != now {
                    changed.push(scope);
                }
            }
            self.log = resolver_log;
        }
        self.drop_config_scopes(&changed);
        !changed.is_empty()
    }

    fn drop_config_scopes(&mut self, scopes: &[Box<[u8]>]) {
        if scopes.is_empty() {
            return;
        }
        for scope in scopes {
            self.bust_dir_cache_tree(scope);
        }
        GENERATION.fetch_add(1, Ordering::AcqRel);
    }

    /// Names the configuration file of `dir` and the files it extends, and records what they
    /// give now. Returns the directory when that is not what `dir` was filled from, or not what
    /// was recorded before.
    fn name_config_files(&mut self, inputs: &mut ConfigInputs, dir: &DirInfo) -> Option<Box<[u8]>> {
        let linked = !dir.abs_real_path.is_empty();
        let scope = if linked {
            dir.abs_real_path
        } else {
            dir.abs_path
        };
        let scope = without_trailing_slash_windows_path(scope);
        if !self.opts.load_tsconfig_json || !is_project_directory(dir, scope) {
            return None;
        }
        // As a fill asks. A file that is there and does not parse is one to watch too.
        let name = TSCONFIG_NAMES
            .into_iter()
            .find(|name| self.has_file(dir, name))?;
        bun_core::handle_oom(inputs.files.put(&child_path(scope, name), ()));

        let filled_from = dir
            .tsconfig_json()
            .map_or(NOTHING, TSConfigJSON::fingerprint);
        // What the file gives now, by the path that the fill read it by. By a path with a
        // symbolic link the same file can give something else: its `baseUrl` is below that
        // path, and below "node_modules" its `extends` is not read.
        let own =
            self.tsconfig_fingerprint(inputs, without_trailing_slash_windows_path(dir.abs_path));
        // And by the path that a change is reported by, which is the one that is recorded.
        let now = if linked {
            self.tsconfig_fingerprint(inputs, scope)
        } else {
            own
        };

        let record = bun_core::handle_oom(inputs.taken.get_or_put(scope));
        let (index, known) = (record.index as u32, record.found_existing);
        // A file that does not parse now gives what it gave.
        let before = if known {
            *record.value_ptr
        } else {
            now.unwrap_or(filled_from)
        };
        let now = now.unwrap_or(before);
        *record.value_ptr = now;

        // The first of the chain is the file of the directory.
        let extended = dir.tsconfig_json().map_or(&[][..], |config| {
            config.extends_chain.get(1..).unwrap_or(&[])
        });
        for path in extended {
            if path_contains_node_modules_folder(path) {
                continue;
            }
            bun_core::handle_oom(inputs.files.put(path, ()));
            let scopes = bun_core::handle_oom(inputs.extended_by.get_or_put(path)).value_ptr;
            if !scopes.contains(&index) {
                scopes.push(index);
            }
        }
        // The file changed after it was last read. Before the first read, it changed if it
        // does not give what `dir` was filled from. After it, a slot that left the cache has
        // what the file gave before.
        let changed = now != before || (!known && own.is_some_and(|own| own != filled_from));
        changed.then(|| Box::from(scope))
    }

    /// Whether the listing that `dir` was filled from has the file `name`.
    fn has_file(&self, dir: &DirInfo, name: &[u8]) -> bool {
        dir.get_entry(self.generation, name).is_some_and(|lookup| {
            // SAFETY: `rfs_ptr` is the `RealFS` of the process. A write to the entry that
            // `kind` makes is under the mutex of the entry.
            unsafe { lookup.entry().kind(self.rfs_ptr(), self.store_fd) == EntryKind::File }
        })
    }

    /// The bytes of `path`, as a fill reads them. `None`: it is not there, or cannot be read.
    fn read_config_file(&mut self, path: &[u8]) -> Option<Vec<u8>> {
        let mut entry = self
            .caches
            .fs
            .read_file_with_allocator(
                // SAFETY: the `FileSystem` of the process, as in `parse_tsconfig`.
                unsafe { &mut *self.fs() },
                path,
                Fd::INVALID,
                false,
                None,
                None,
            )
            .ok()?;
        let contents = core::mem::take(&mut entry.contents);
        let _ = entry.close_fd();
        Some(match contents {
            crate::cache::Contents::Owned(bytes) => bytes,
            crate::cache::Contents::Empty => Vec::new(),
            other => other.as_slice().to_vec(),
        })
    }

    /// [`TSConfigJSON::fingerprint`] of what a fill of the directory `dir` reads now: the first
    /// of "tsconfig.json" and "jsconfig.json" that is a file, with what it extends. `NOTHING`
    /// when neither is there. `None` when a file that is there does not parse, and what it gave
    /// before stays: what is wrong with it is in the log of the resolver.
    fn tsconfig_fingerprint(&mut self, inputs: &ConfigInputs, dir: &[u8]) -> Option<u64> {
        for name in TSCONFIG_NAMES {
            let mut path = child_path(dir, name);
            path.push(0);
            let path = bun_core::ZStr::from_buf(&path, path.len() - 1);
            if !matches!(
                bun_sys::exists_at_type(Fd::cwd(), path),
                Ok(bun_sys::ExistsAtType::File)
            ) {
                continue;
            }
            // A file that the parser rejects is an error. An option with a value that is not
            // one is a warning, and that file gives the rest.
            let errors = self.log_ref().errors;
            let loaded = self.load_tsconfig(path.as_bytes(), Fd::INVALID);
            let rejected = self.log_ref().errors != errors;
            let Ok(Some(config)) = loaded else {
                return (!rejected).then_some(NOTHING);
            };
            let fingerprint = config.fingerprint();
            // The chain ends at the file that the parser rejected. One that was never named
            // gave nothing before: it is taken as a fill takes it, and that fill names it.
            let stays = rejected
                && config
                    .extends_chain
                    .last()
                    .is_some_and(|path| inputs.files.contains_key(path));
            TSConfigJSON::destroy(config);
            return (!stays).then_some(fingerprint);
        }
        Some(NOTHING)
    }
}
