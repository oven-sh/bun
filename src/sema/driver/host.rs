//! The checker's view of the file system.
//!
//! The checker's paths are absolute, use `/`, and start with one. It represents `C:\a\b` as
//! `/C:/a/b`, on every system: see `resolve::root_length`. Whoever puts a path into a message, a
//! printed type or a line of output converts it there, with `resolve::displayed_path`.

use bun_ast::e::{JsonValue, ObjectJSON};
use bun_core::strings::{
    BOM, contains, contains_char, is_valid_utf8, rsplit_once_char, split_once_char,
    without_trailing_slash,
};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, windows_volume_name_len, z};
use bun_paths::{basename_posix, path_buffer_pool};
use bun_sema::atom::Interner;
use bun_sema::hir::{self, FileKind};
use bun_sema::json::Json;
use bun_sema::program::{Builtin, Module};
use bun_sema::resolve::{
    Host, Kept, ModuleDetection, ParseOptions, Paths, Phase, ScriptKind, Spent, ancestors,
    hash_without_case, inside, is_declaration_file_name, is_javascript_file, is_same_path, join, root_length,
    to_file_name_lower_case, to_path, typescript_path,
};
use bun_sema::session::Arena;
use bun_sema::util::SharedSort;
use bun_sema::util::{FxHashMap, FxHashSet, ShardedMap};
use crate::fs_queries;
use bun_sys::{EntryKind, ExistsAtType, Fd};
use std::borrow::Cow;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

/// TypeScript's `lib.*.d.ts` files in the executable, by name.
#[derive(Copy, Clone)]
pub struct BundledLibs {
    pub has: fn(&[u8]) -> bool,
    pub read: fn(&[u8]) -> Option<Cow<'static, [u8]>>,
}

/// `bundled.LibPath()`, in the checker's path format: the directory that `BundledLibs` are in.
/// It is on no disk.
pub const BUNDLED_LIBS: &[u8] = b"/bundled:///libs";

/// `bundled.IsBundled`
pub fn is_bundled(path: &[u8]) -> bool {
    path.starts_with(b"/bundled:")
}

/// `/C:/a` becomes `C:/a`, and `/\\server/share/a` becomes `\\server/share/a`, which Windows accepts.
/// `/bundled:///libs/a` becomes `bundled:///libs/a`, which is how typescript-go prints it.
/// Where `C:/a` is no absolute path, the system looks for it in the working directory, which is
/// where `os.DirFS("C:/")` is (`Common.RootAndPath`).
pub fn to_native(path: &[u8]) -> &[u8] {
    match path {
        [b'/', b'\\', b'\\', ..] if cfg!(windows) => &path[1..],
        _ => typescript_path(path),
    }
}

/// `to_native`, for a call of the system. `None`: the system has no name for it, so nothing is there: it is too long,
/// as an import can name a path of any number of segments; or it has a NUL, as a configuration file can write one,
/// where the system would take what is before it for the whole.
fn for_the_system(path: &[u8]) -> Option<&[u8]> {
    let native = to_native(path);
    let is_a_name = native.len() < bun_paths::MAX_PATH_BYTES && !contains_char(native, 0);
    is_a_name.then_some(native)
}

/// The root of a drive is `/C:`. For the system, to which `C:` is the working directory on that
/// drive, it is `/C:/`. So it is with every root but `/`.
fn with_root(path: &[u8]) -> Cow<'_, [u8]> {
    match path.len() > 1 && path.len() == root_length(path) {
        true => Cow::Owned([path, b"/"].concat()),
        false => Cow::Borrowed(path),
    }
}

/// Converts a native path to the checker's path format. It must be absolute.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    let path = join(b"/", bun_paths::string_paths::without_nt_prefix(path));
    // It begins with `/`, whatever the name after that looks like: see `root_length`.
    match !cfg!(windows) && root_length(&path) > 1 && !path.starts_with(b"//") {
        true => [b"/\0", &path[..]].concat(),
        false => path,
    }
}

/// A path of the command line, which is relative to `cwd`. Where `/` is the root of the file system,
/// one that begins with it is a native path.
pub fn from_argument(cwd: &[u8], path: &[u8]) -> Vec<u8> {
    match !cfg!(windows) && path.starts_with(b"/") {
        true => from_native(path),
        false => join(cwd, path),
    }
}

#[derive(Copy, Clone)]
struct Entry {
    /// Where its name is in `Listing::names`.
    start: u32,
    len: u32,
    /// `hash_without_case` of its name.
    hash: u32,
    is_directory: bool,
    is_link: bool,
}

impl Entry {
    fn name_in<'a>(&self, names: &'a [u8]) -> &'a [u8] {
        &names[self.start as usize..][..self.len as usize]
    }
}

/// The entries of a directory.
#[derive(Default)]
struct Listing {
    /// The names, one after the other.
    names: Box<[u8]>,
    /// Sorted by `hash`, so names that differ in case alone are next to each other. Then by name.
    entries: Box<[Entry]>,
    /// Of a directory above the working directory, while `asked` notes: its path, and the name in it that leads down.
    above: Option<(Vec<u8>, Vec<u8>)>,
    /// In such a directory: the names that are there because they are in memory, whatever the disk has.
    in_memory: Vec<Vec<u8>>,
}

/// A [`Listing`] that is being made.
#[derive(Default)]
struct Entries {
    names: Vec<u8>,
    entries: Vec<Entry>,
}

/// What a [`Listing`] has under a name.
enum Found<'a> {
    Exact(&'a Entry),
    /// It differs in case.
    Alike(&'a Entry),
    Nothing,
}

impl Entries {
    fn push(&mut self, name: &[u8], is_directory: bool, is_link: bool) {
        let (Ok(start), Ok(len)) = (self.names.len().try_into(), name.len().try_into()) else {
            return;
        };
        self.names.extend_from_slice(name);
        self.entries.push(Entry {
            start,
            len,
            hash: hash_without_case(name) as u32,
            is_directory,
            is_link,
        });
    }

    fn finish(self) -> Listing {
        let Entries { names, mut entries } = self;
        let name = |it: &Entry| it.name_in(&names);
        entries.shared_sort_unstable_by(|a, b| {
            (a.hash.cmp(&b.hash))
                .then_with(|| name(a).cmp(name(b)))
                .then(a.is_directory.cmp(&b.is_directory))
        });
        // What is only in memory can have the name of a link on the disk.
        entries.dedup_by(|dropped, kept| {
            let is_same = name(dropped) == name(kept) && dropped.is_directory == kept.is_directory;
            kept.is_link |= is_same && dropped.is_link;
            is_same
        });
        Listing {
            names: names.into_boxed_slice(),
            entries: entries.into_boxed_slice(),
            ..Default::default()
        }
    }
}

/// What every walk up to the root looks for.
const ANCESTOR_LOOKUP_NAMES: [&[u8]; 4] = [b"node_modules", b"package.json", b"tsconfig.json", b"jsconfig.json"];

const MAX_EARLY_READS_WHILE_BUNDLING: usize = 4;
const BUNDLER_QUIET_AFTER: Duration = Duration::from_millis(5);
const EARLY_PATH_BATCH_WINDOW: Duration = Duration::from_millis(1);

pub struct SharedDirectoryCache {
    listings: ShardedMap<Vec<u8>, bun_threading::Guarded<Option<([i64; 4], Listing)>>>,
    bundler_sources: ShardedMap<Vec<u8>, &'static [u8]>,
    scheduled_by_bundler: ShardedMap<Vec<u8>, ()>,
    created: Instant,
    last_delivery_nanos: AtomicU64,
    active_early_reads: AtomicU64,
    early_parse_state: std::sync::atomic::AtomicU8,
}

const EARLY_PARSE_RUNNING: u8 = 0;
const EARLY_PARSE_PAUSE_REQUESTED: u8 = 1;
const EARLY_PARSE_PAUSED: u8 = 2;

impl Default for SharedDirectoryCache {
    fn default() -> Self {
        SharedDirectoryCache {
            listings: ShardedMap::default(),
            bundler_sources: ShardedMap::default(),
            scheduled_by_bundler: ShardedMap::default(),
            created: Instant::now(),
            last_delivery_nanos: AtomicU64::new(0),
            active_early_reads: AtomicU64::new(0),
            early_parse_state: std::sync::atomic::AtomicU8::new(EARLY_PARSE_RUNNING),
        }
    }
}

pub(crate) struct EarlyRead<'a>(&'a AtomicU64);

thread_local! {
    static HOLDS_EARLY_READ: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

impl Drop for EarlyRead<'_> {
    fn drop(&mut self) {
        HOLDS_EARLY_READ.set(false);
        self.0.fetch_sub(1, Ordering::Relaxed);
    }
}

impl SharedDirectoryCache {
    pub fn request_early_parse_pause(&self) {
        self.early_parse_state.store(EARLY_PARSE_PAUSE_REQUESTED, Ordering::Release);
    }

    pub fn is_early_parse_paused(&self) -> bool {
        self.early_parse_state.load(Ordering::Acquire) == EARLY_PARSE_PAUSED
    }

    pub fn resume_early_parse(&self) {
        self.early_parse_state.store(EARLY_PARSE_RUNNING, Ordering::Release);
    }

    fn is_bundler_quiet(&self) -> bool {
        let last_delivery = self.last_delivery_nanos.load(Ordering::Relaxed);
        last_delivery != 0 && (self.created.elapsed().as_nanos() as u64).saturating_sub(last_delivery) >= BUNDLER_QUIET_AFTER.as_nanos() as u64
    }

    fn try_begin_early_read(&self) -> Option<EarlyRead<'_>> {
        let active = self.active_early_reads.load(Ordering::Relaxed);
        let is_allowed = active < MAX_EARLY_READS_WHILE_BUNDLING as u64 || self.is_bundler_quiet();
        let has_begun = is_allowed && self.active_early_reads.compare_exchange(active, active + 1, Ordering::Relaxed, Ordering::Relaxed).is_ok();
        has_begun.then(|| {
            HOLDS_EARLY_READ.set(true);
            EarlyRead(&self.active_early_reads)
        })
    }

    pub fn entries(&self, native_path: &[u8]) -> Option<Vec<(Vec<u8>, EntryKind)>> {
        if fs_queries::is_recording() {
            return None;
        }
        let path = from_native(native_path);
        let path = &path[..without_trailing_slash(&path).len().max(root_length(&path))];
        let Directory::Listed(listing) = self.list(path) else { return None };
        let kind_of = |name: &[u8], kind: EntryKind| if listing.is_link(name) { EntryKind::SymLink } else { kind };
        let (files, directories) = listing.sorted();
        let files = files.into_iter().map(|name| (kind_of(&name, EntryKind::File), name));
        let directories = directories.into_iter().map(|name| (kind_of(&name, EntryKind::Directory), name));
        Some(files.chain(directories).map(|(kind, name)| (name, kind)).collect())
    }

    fn list(&self, path: &[u8]) -> Directory {
        let slot = match self.listings.get_ref(path) {
            Some(slot) => slot,
            None => self.listings.insert_ref(path.to_vec(), bun_threading::Guarded::new(None)),
        };
        let mut cached = slot.lock();
        let timestamps = Disk::file_times(path);
        if let (Some((cached_timestamps, listing)), Some(timestamps)) = (&*cached, timestamps)
            && *cached_timestamps == timestamps
        {
            return Directory::Listed(listing.duplicate());
        }
        let directory = list(path);
        *cached = match (&directory, timestamps) {
            (Directory::Listed(listing), Some(timestamps)) => Some((timestamps, listing.duplicate())),
            _ => None,
        };
        directory
    }
}

enum Directory {
    Missing,
    /// It exists but cannot be listed: its entries have to be queried one by one.
    Unreadable,
    Listed(Listing),
}

impl Listing {
    /// All that this listing can say of `name`.
    fn write_entry(&self, name: &[u8], out: &mut Vec<u8>) {
        for case_sensitive in [true, false] {
            if let Some((written, is_directory)) = self.find(name, case_sensitive) {
                let is_link = self.is_link(written);
                out.extend_from_slice(written);
                out.push(1 + u8::from(is_directory) + 2 * u8::from(is_link));
            }
            out.push(0);
        }
    }

    fn entry_answer(&self, hash: fs_queries::Hash, name: &[u8]) -> u64 {
        let mut said = Vec::new();
        self.write_entry(name, &mut said);
        hash(&said) | 1
    }

    /// Someone is about to be told of `name`.
    fn record_implicit_flow(&self, name: &[u8]) {
        if let Some((path, leads_down)) = &self.above
            && name != &leads_down[..]
            && !ANCESTOR_LOOKUP_NAMES.contains(&name)
            && !self.in_memory.iter().any(|it| it == name)
        {
            fs_queries::record_query(fs_queries::Kind::Entry, &inside(path, name), |hash| self.entry_answer(hash, name));
        }
    }

    /// Someone is about to be told of every name.
    fn record_all(&self) {
        if self.above.is_some() {
            fs_queries::invalidate_recording();
        }
    }

    fn duplicate(&self) -> Self {
        Listing {
            names: self.names.clone(),
            entries: self.entries.clone(),
            above: self.above.clone(),
            in_memory: self.in_memory.clone(),
        }
    }

    /// Whether an entry of that very name is a symlink.
    fn is_link(&self, name: &[u8]) -> bool {
        matches!(self.look_up(name), Found::Exact(it) if it.is_link)
    }

    /// The names of the entries that are symlinks, sorted.
    fn links(&self) -> Vec<Vec<u8>> {
        let mut names: Vec<Vec<u8>> = self.entries.iter().filter(|it| it.is_link).map(|it| self.name(it).to_vec()).collect();
        names.shared_sort_unstable();
        names.dedup();
        names
    }

    fn with(self, more: &InMemory) -> Self {
        let Listing { names, entries, above, mut in_memory } = self;
        if above.is_some() {
            in_memory.extend(more.files.iter().chain(&more.directories).cloned());
        }
        let mut all = Entries {
            names: names.into_vec(),
            entries: entries.into_vec(),
        };
        for (names, is_directory) in [(&more.files, false), (&more.directories, true)] {
            for name in names {
                all.push(name, is_directory, false);
            }
        }
        Listing { above, in_memory, ..all.finish() }
    }

    fn name(&self, entry: &Entry) -> &[u8] {
        entry.name_in(&self.names)
    }

    fn look_up(&self, name: &[u8]) -> Found<'_> {
        let hash = hash_without_case(name) as u32;
        let from = self.entries.partition_point(|it| it.hash < hash);
        let with_hash = || self.entries[from..].iter().take_while(|it| it.hash == hash);
        if let Some(exact) = with_hash().find(|it| self.name(it) == name) {
            return Found::Exact(exact);
        }
        let alike = with_hash().find(|it| is_same_path(self.name(it), name, false));
        alike.map_or(Found::Nothing, Found::Alike)
    }

    /// The name as spelled in the directory, and whether it is a directory.
    fn find(&self, name: &[u8], case_sensitive: bool) -> Option<(&[u8], bool)> {
        match self.look_up(name) {
            Found::Exact(entry) => Some((self.name(entry), entry.is_directory)),
            Found::Alike(entry) if !case_sensitive => Some((self.name(entry), entry.is_directory)),
            Found::Alike(_) | Found::Nothing => None,
        }
    }

    /// The files and the directories, each sorted by name.
    fn sorted(&self) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        let of_kind = |is_directory: bool| {
            let entries = self
                .entries
                .iter()
                .filter(|it| it.is_directory == is_directory);
            let mut names: Vec<Vec<u8>> = entries.map(|it| self.name(it).to_vec()).collect();
            names.shared_sort_unstable();
            names
        };
        (of_kind(false), of_kind(true))
    }
}

/// The disk. A directory is read once: existence, entry kind and real path are answered from the
/// cached directory listings, without a system call. Resolving the imports of a project queries the
/// same few directories repeatedly, mostly for entries that do not exist.
pub struct Disk {
    pub threads: usize,
    /// `Some` while several programs are read through it at the same time.
    pub(crate) shares: bun_threading::Guarded<Option<Arc<crate::Shares>>>,
    pub(crate) caches: crate::ThreadCaches,
    /// A thread of the pool has made it. The other threads of the pool can all be waiting for what it is made for, so
    /// nothing waits for them: not the threads either that the request starts to coordinate its projects.
    is_of_a_thread_of_the_pool: bool,
    case_sensitive: bool,
    /// Threads that ask for a directory at the same time wait for the first of them to read it.
    directories: ShardedMap<Vec<u8>, OnceLock<Directory>>,
    /// See `started_in`.
    working_directory: Vec<u8>,
    pub(crate) shared_directory_cache: Option<Arc<SharedDirectoryCache>>,
    pub(crate) is_early_pass: bool,
    /// The real path of each directory that was queried.
    real_directories: ShardedMap<Vec<u8>, Vec<u8>>,
    /// On macOS, opening and reading files slows down with the number of concurrent threads by more
    /// than the parallelism gains: 16 threads take six times as long for the same files as 4 do. So
    /// only a few readers are admitted at a time. The threads of `io_pool` are few by themselves.
    /// This is for what the other threads read: `package.json` and configuration files.
    reading: Option<bun_threading::Semaphore>,
    /// `Host::io_pool`
    io_pool: Option<bun_threading::io_thread_pool::Ref>,
    /// Readers that are not in use, least recently used first.
    idle_readers: bun_threading::Guarded<Vec<Reader>>,
    /// See `Host::take_unreadable`.
    unreadable: bun_threading::Guarded<Vec<Vec<u8>>>,
    non_utf8: bun_threading::Guarded<FxHashSet<Vec<u8>>>,
    /// See `AlreadyRead`. By `tspath.Path`: such a file is found however its name is spelled, like one on the disk.
    already_read: AlreadyRead,
    pub(crate) deferred_read: bun_threading::Guarded<Option<DeferredRead>>,
    deferred_read_sources: OnceLock<AlreadyRead>,
    /// What `already_read` adds to the listing of a directory, by the `tspath.Path` of the directory.
    in_memory: FxHashMap<Vec<u8>, InMemory>,
    /// `Provided::keeps_byte_order_marks`
    pub(crate) keeps_byte_order_marks: bool,
    /// `Host::times`, in nanoseconds.
    times: [AtomicU64; Phase::ALL.len()],
    /// What is in `BUNDLED_LIBS`.
    pub bundled_libs: Option<BundledLibs>,
    /// `Host::script_kind`, by `tspath.Path`.
    pub(crate) script_kinds: Vec<(Vec<u8>, ScriptKind)>,
    /// `Request::script_kinds_by_extension`
    pub(crate) script_kinds_by_extension: Vec<(Vec<u8>, ScriptKind)>,
    pub(crate) before_read: Option<BeforeRead>,
    /// `Host::extended_config`: the projects of a build often extend one file.
    extended_configs: bun_threading::Guarded<FxHashMap<Vec<u8>, Kept>>,
    /// `Host::shared_paths`
    paths: bun_threading::Guarded<FxHashSet<Arc<Paths>>>,
    pub(crate) scripts_of_page: Option<ScriptsOfPage>,
    /// `Provided::file_jsx_options`, by `tspath.Path`.
    pub(crate) file_jsx_options: Vec<(Vec<u8>, FileJsxOptions)>,
    pub(crate) file_class_options: Vec<(Vec<u8>, ClassOptions)>,
    pub(crate) is_without_bundler: bool,
    pub(crate) lowers_like_the_runtime: bool,
    lowering_of_every_file: OnceLock<Option<Arc<(FileJsxOptions, ClassOptions)>>>,
    lowering_by_tsconfig: OnceLock<LoweringByTsconfig>,
    pub(crate) import_constants: FxHashMap<(Vec<u8>, Vec<u8>), Vec<u8>>,
    pub(crate) build_constants: Option<Arc<bun_sema::fold::BuildConstants>>,
    pub(crate) early_paths: Option<bun_threading::Guarded<std::sync::mpsc::Receiver<(Vec<u8>, Option<&'static [u8]>)>>>,
    pending_early_paths: bun_threading::Guarded<Vec<Vec<u8>>>,
    pub(crate) early_parse_cancelled: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub(crate) is_load_abandoned: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub(crate) observed: Option<bun_threading::Guarded<Vec<(Vec<u8>, Option<[i64; 4]>)>>>,
    /// `Request::is_one_program`: what is compiled.
    pub(crate) compiled: Option<Compiled>,
    pub(crate) decodes_like_runtime: bool,
    pub(crate) deferred_imports: FxHashMap<Vec<u8>, Vec<Vec<u8>>>,
    pub(crate) deferred_paths: FxHashSet<Vec<u8>>,
    pub(crate) wait_for_deferred_sources: bun_threading::Guarded<Option<WaitForDeferredSources>>,
    deferred: OnceLock<InstalledSources>,
    pub(crate) abandoned: bun_threading::Guarded<Option<Abandoned>>,
}

struct LoweringByTsconfig {
    config_of_the_program: Option<Vec<u8>>,
    of_the_program: (FileJsxOptions, ClassOptions),
    by_directory: bun_threading::Guarded<FxHashMap<Vec<u8>, Option<Arc<(FileJsxOptions, ClassOptions)>>>>,
    by_config: bun_threading::Guarded<FxHashMap<Vec<u8>, Option<Arc<(FileJsxOptions, ClassOptions)>>>>,
}

pub(crate) fn lowering_in(options: &bun_sema::resolve::Options) -> (FileJsxOptions, ClassOptions) {
    let or = |said: &[u8], otherwise: &[u8]| if said.is_empty() { otherwise.to_vec() } else { said.to_vec() };
    let jsx = FileJsxOptions {
        is_classic: options.jsx == bun_sema::resolve::JsxEmit::React,
        factory: or(&options.jsx_factory, b"React.createElement"),
        fragment: or(&options.jsx_fragment_factory, b"React.Fragment"),
        import_source: options.jsx_import_source.clone(),
        overrides_pragmas: false,
    };
    let classes = ClassOptions {
        use_define_for_class_fields: options.specified_use_define_for_class_fields.unwrap_or(true),
        experimental_decorators: options.experimental_decorators,
        emit_decorator_metadata: options.emit_decorator_metadata,
    };
    (jsx, classes)
}

fn say_as_pragmas<'s>(pragmas: &mut hir::JsxPragmas, of_file: &FileJsxOptions, atoms: &Interner<'s>) {
    if of_file.overrides_pragmas {
        *pragmas = Default::default();
    }
    pragmas.classic.get_or_insert(of_file.is_classic);
    for (pragma, said) in [(&mut pragmas.factory, &of_file.factory), (&mut pragmas.fragment_factory, &of_file.fragment), (&mut pragmas.import_source, &of_file.import_source)] {
        if pragma.is_none() && !said.is_empty() {
            *pragma = atoms.intern(said);
        }
    }
}

struct InstalledSources {
    already_read: AlreadyRead,
    deferred_read: bun_threading::Guarded<Option<DeferredRead>>,
    deferred_read_sources: OnceLock<AlreadyRead>,
    in_memory: FxHashMap<Vec<u8>, InMemory>,
    directories: FxHashMap<Vec<u8>, Directory>,
    script_kinds: Vec<(Vec<u8>, ScriptKind)>,
    file_jsx_options: Vec<(Vec<u8>, FileJsxOptions)>,
    file_class_options: Vec<(Vec<u8>, ClassOptions)>,
    import_constants: FxHashMap<(Vec<u8>, Vec<u8>), Vec<u8>>,
    entry_points: Vec<Vec<u8>>,
    code: FxHashSet<Vec<u8>>,
    is_commonjs_code: FxHashMap<Vec<u8>, bool>,
    build_constants: Option<Arc<bun_sema::fold::BuildConstants>>,
}

/// What `Host::builtin_files` goes by, and what it has found.
pub(crate) struct Compiled {
    /// `Request::paths` and `Request::code`, by `tspath.Path`.
    pub(crate) entry_points: Vec<Vec<u8>>,
    pub(crate) code: FxHashSet<Vec<u8>>,
    pub(crate) builtin_modules: bun_threading::Guarded<Option<crate::builtins::Found>>,
    pub(crate) preserves_source_paths: bool,
    pub(crate) is_commonjs_code: FxHashMap<Vec<u8>, bool>,
}

/// The text of files that the caller of the check has read, by path in the checker's format, as UTF-8, without a byte order
/// mark unless `Provided::keeps_byte_order_marks`. Such a file is not opened. Several programs may read it.
/// `bun build --check` passes what the bundler has read. A text that is borrowed is read without a copy.
pub type AlreadyRead = FxHashMap<Vec<u8>, Cow<'static, [u8]>>;

pub type DeferredRead = Box<dyn FnOnce() -> AlreadyRead + Send>;

#[derive(Default)]
pub struct DeferredSources {
    pub paths: Vec<Vec<u8>>,
    pub code: Vec<Vec<u8>>,
    pub script_kinds: Vec<(Vec<u8>, ScriptKind)>,
    pub already_read: AlreadyRead,
    pub deferred_read: Option<DeferredRead>,
    pub file_jsx_options: Vec<(Vec<u8>, FileJsxOptions)>,
    pub file_class_options: Vec<(Vec<u8>, ClassOptions)>,
    pub import_constants: Vec<((Vec<u8>, Vec<u8>), Vec<u8>)>,
    pub code_kinds: FxHashMap<Vec<u8>, bool>,
    pub build_constants: Option<Arc<bun_sema::fold::BuildConstants>>,
}

pub type WaitForDeferredSources = Box<dyn FnOnce() -> Option<DeferredSources> + Send>;

#[derive(Default)]
pub struct Abandoned {
    pub conflicting_paths: Vec<Vec<u8>>,
    pub is_outdated: bool,
    pub deferred_sources: Option<DeferredSources>,
    pub deferred_read: Option<DeferredRead>,
    pub scripts_of_page: Option<ScriptsOfPage>,
    pub before_read: Option<BeforeRead>,
}

/// Called with the path of a file, in the checker's format, right before the file is read, on the
/// thread that reads it. A caller that starts to watch the file there sees every change to what is
/// checked.
pub type BeforeRead = Box<dyn Fn(&[u8]) + Send + Sync>;

/// `Host::scripts_of_page`. The paths are in the checker's format.
pub type ScriptsOfPage = Box<dyn Fn(&[u8]) -> Vec<Vec<u8>> + Send + Sync>;

/// How the JSX of a file is lowered, where that is not as the options of the project say: as if the file said so itself, by `@jsxRuntime`, `@jsx`, `@jsxFrag` and
/// `@jsxImportSource`. What the file does say itself goes before this.
pub use bun_sema::resolve::ClassOptions;

#[derive(Clone, PartialEq)]
pub struct FileJsxOptions {
    pub is_classic: bool,
    pub factory: Vec<u8>,
    pub fragment: Vec<u8>,
    pub import_source: Vec<u8>,
    pub overrides_pragmas: bool,
}

/// What the caller of a check has for its host.
#[derive(Default)]
pub struct Provided {
    pub already_read: AlreadyRead,
    pub deferred_read: Option<DeferredRead>,
    pub before_read: Option<BeforeRead>,
    pub scripts_of_page: Option<ScriptsOfPage>,
    /// By path, as the caller has it.
    pub file_jsx_options: Vec<(Vec<u8>, FileJsxOptions)>,
    pub file_class_options: Vec<(Vec<u8>, ClassOptions)>,
    pub is_without_bundler: bool,
    pub lowers_like_the_runtime: bool,
    pub import_constants: Vec<((Vec<u8>, Vec<u8>), Vec<u8>)>,
    pub build_constants: Option<Arc<bun_sema::fold::BuildConstants>>,
    pub early_paths: Option<std::sync::mpsc::Receiver<(Vec<u8>, Option<&'static [u8]>)>>,
    pub early_parse_cancelled: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub is_load_abandoned: Option<Arc<std::sync::atomic::AtomicBool>>,
    pub observes_files: bool,
    /// With `Request::is_one_program`: none of the runtime's own modules is compiled with the program (`Host::builtin_files`).
    pub without_builtin_modules: bool,
    pub preserves_source_paths: bool,
    pub code_kinds: FxHashMap<Vec<u8>, bool>,
    pub deferred_imports: Vec<(Vec<u8>, Vec<u8>)>,
    pub deferred_paths: Vec<Vec<u8>>,
    pub deferred_sources: Option<WaitForDeferredSources>,
    /// The text of a script keeps the UTF-8 byte order mark that the file starts with, which TypeScript drops. The parser
    /// takes it for a blank. `bun lint` has a rule about it, and writes the text back.
    pub keeps_byte_order_marks: bool,
}

impl Provided {
    pub fn without_callbacks(&self) -> Provided {
        Provided {
            already_read: self.already_read.clone(),
            file_jsx_options: self.file_jsx_options.clone(),
            file_class_options: self.file_class_options.clone(),
            is_without_bundler: self.is_without_bundler,
            lowers_like_the_runtime: self.lowers_like_the_runtime,
            import_constants: self.import_constants.clone(),
            build_constants: self.build_constants.clone(),
            without_builtin_modules: self.without_builtin_modules,
            preserves_source_paths: self.preserves_source_paths,
            code_kinds: self.code_kinds.clone(),
            deferred_imports: self.deferred_imports.clone(),
            deferred_paths: self.deferred_paths.clone(),
            keeps_byte_order_marks: self.keeps_byte_order_marks,
            is_load_abandoned: self.is_load_abandoned.clone(),
            ..Default::default()
        }
    }
}

/// The names in one directory of the files of `AlreadyRead` and of the directories that lead to
/// them. Such a file need not be on the disk (`files` of `Bun.build`), and it is found, listed and
/// resolved to like one that is.
#[derive(Default)]
struct InMemory {
    files: Vec<Vec<u8>>,
    directories: Vec<Vec<u8>>,
}

impl InMemory {
    fn by_directory(
        already_read: &AlreadyRead,
        is_case_sensitive: bool,
    ) -> FxHashMap<Vec<u8>, InMemory> {
        let mut by_directory: FxHashMap<Vec<u8>, InMemory> = FxHashMap::default();
        for path in already_read.keys() {
            let Split { mut parent, name } = split(path);
            let key = to_path(parent, is_case_sensitive).into_owned();
            let mut is_new = !by_directory.contains_key(&key);
            let names = by_directory.entry(key).or_default();
            names.files.push(name.to_vec());
            // A directory is entered in its parent when it gets its first entry.
            while is_new {
                let directory = split(parent);
                if directory.name.is_empty() {
                    break;
                }
                let key = to_path(directory.parent, is_case_sensitive).into_owned();
                is_new = !by_directory.contains_key(&key);
                let names = by_directory.entry(key).or_default();
                names.directories.push(directory.name.to_vec());
                parent = directory.parent;
            }
        }
        by_directory
    }
}

/// Reusable state for reading files. Owned by the [`Disk`], so every directory handle is closed when it is dropped.
#[derive(Default)]
struct Reader {
    /// The directory of the most recently read file.
    directory: Vec<u8>,
    /// Opened when a second file is read from `directory`.
    handle: Option<bun_sys::Dir>,
    buffer: Vec<u8>,
}

/// The maximum number of idle readers, and so of open directories, that are retained.
const MAX_IDLE_READERS: usize = 16;

/// One of the few slots for reading a file.
/// The number of threads that read concurrently on macOS, where opening a file takes locks that all
/// threads contend on. With 16 threads and 45,000 files, 4 to 10 perform equally when the system
/// opens files quickly. When it is slow, which is intermittent, 5 or 6 perform best.
const READERS: usize = 6;

struct Turn<'a>(&'a bun_threading::Semaphore);

impl<'a> Turn<'a> {
    fn wait_for(places: &'a bun_threading::Semaphore) -> Turn<'a> {
        places.wait();
        Turn(places)
    }
}

impl Drop for Turn<'_> {
    fn drop(&mut self) {
        self.0.post();
    }
}

/// The full contents of the file `name` in `directory`.
fn read_file(directory: Fd, name: &[u8], buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    /// Few files are bigger.
    const FIRST_READ: usize = 64 * 1024;
    let file = bun_sys::File::openat(directory, name, bun_sys::O::RDONLY, 0).ok()?;
    buffer.resize(FIRST_READ, 0);
    // Until the end of the file: some file systems return less than there is.
    let count = file.read_all(&mut buffer[..]).ok()?;
    if count < FIRST_READ {
        return Some(buffer[..count].to_vec());
    }
    let size = file.get_end_pos().ok()?.max(count);
    let mut all = Vec::new();
    all.try_reserve_exact(size.saturating_add(16)).ok()?;
    all.extend_from_slice(&buffer[..count]);
    file.read_to_end_into(&mut all).ok()?;
    Some(all)
}

/// `decodeBytes`: the text of a file, decoded according to its byte order mark. `BOM` does not
/// support big endian, so the byte pairs are swapped first.
/// `keeps_mark`: that of UTF-8 stays.
fn decoded(mut bytes: Vec<u8>, keeps_mark: bool) -> Cow<'static, [u8]> {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        for pair in bytes.as_chunks_mut::<2>().0 {
            pair.swap(0, 1);
        }
    }
    Cow::Owned(match BOM::detect(&bytes) {
        Some(BOM::Utf8) if keeps_mark => bytes,
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(bytes),
        // `BOM::detect` needs three bytes. A UTF-16 byte order mark alone is an empty file.
        None if bytes == [0xFF, 0xFE] => Vec::new(),
        None => bytes,
    })
}

fn decode_like_runtime(bytes: &[u8]) -> Vec<u8> {
    const LEAST: [u32; 5] = [0, 0, 0x80, 0x800, 0x10000];
    let mut units: Vec<u32> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let lead = bytes[i];
        let len = if !(0xC0..0xF8).contains(&lead) { 1 } else if lead < 0xE0 { 2 } else if lead < 0xF0 { 3 } else { 4 };
        let mut character = if len == 1 { u32::from(lead) } else { u32::from(lead & (0x7F >> len)) };
        let mut is_whole = i + len <= bytes.len();
        for k in 1..len {
            if !is_whole {
                break;
            }
            is_whole = bytes[i + k] & 0xC0 == 0x80;
            character = character << 6 | u32::from(bytes[i + k] & 0x3F);
        }
        if !is_whole || character < LEAST[len] || character > 0x10FFFF {
            units.push(0xFFFD);
            i += 1;
            continue;
        }
        i += len;
        if character < 0x10000 {
            units.push(character);
        } else {
            units.push(0xD7C0 + (character >> 10));
            units.push(0xDC00 | (character & 0x3FF));
        }
    }
    let mut text = Vec::with_capacity(bytes.len() + bytes.len() / 8 + 16);
    let mut j = 0;
    while j < units.len() {
        let mut character = units[j];
        j += 1;
        if (0xD800..0xDC00).contains(&character) && units.get(j).is_some_and(|next| (0xDC00..0xE000).contains(next)) {
            character = 0x10000 + ((character - 0xD800) << 10) + (units[j] - 0xDC00);
            j += 1;
        }
        match character {
            0..=0x7F => text.push(character as u8),
            0x80..=0x7FF => text.extend_from_slice(&[0xC0 | (character >> 6) as u8, 0x80 | (character & 0x3F) as u8]),
            0x800..=0xFFFF => text.extend_from_slice(&[0xE0 | (character >> 12) as u8, 0x80 | (character >> 6 & 0x3F) as u8, 0x80 | (character & 0x3F) as u8]),
            _ => text.extend_from_slice(&[0xF0 | (character >> 18) as u8, 0x80 | (character >> 12 & 0x3F) as u8, 0x80 | (character >> 6 & 0x3F) as u8, 0x80 | (character & 0x3F) as u8]),
        }
    }
    text
}

/// `vfs.FS.ReadFile` of the file at `path`, by that path alone.
pub(crate) fn read_at(path: &[u8], keeps_mark: bool) -> Option<Cow<'static, [u8]>> {
    let bytes = bun_sys::File::read_from(Fd::cwd(), for_the_system(path)?).ok();
    fs_queries::record_query(fs_queries::Kind::Text, path, |hash| fs_queries::of_text(hash, bytes.as_deref()));
    bytes.map(|bytes| decoded(bytes, keeps_mark))
}

fn directory_answer(hash: fs_queries::Hash, directory: &Directory) -> u64 {
    match directory {
        Directory::Missing => 0,
        Directory::Unreadable => 2,
        Directory::Listed(listing) => {
            let mut names = Vec::new();
            if let Some((_, leads_down)) = &listing.above {
                for name in ANCESTOR_LOOKUP_NAMES.into_iter().chain([&leads_down[..]]) {
                    listing.write_entry(name, &mut names);
                }
                return hash(&names) | 1;
            }
            let (files, directories) = listing.sorted();
            for kind in [files, directories, listing.links()] {
                for name in &kind {
                    names.extend_from_slice(name);
                    names.push(0);
                }
                names.push(1);
            }
            hash(&names) | 1
        }
    }
}

fn kind_answer(is_directory: Option<bool>) -> u64 {
    is_directory.map_or(0, |is_directory| 1 + u64::from(is_directory))
}

/// What the disk answers now to a question that `asked` has noted.
pub(crate) fn current_answer(kind: fs_queries::Kind, path: &[u8], hash: fs_queries::Hash) -> u64 {
    match kind {
        fs_queries::Kind::Text => fs_queries::of_text(hash, for_the_system(path).and_then(|path| bun_sys::File::read_from(Fd::cwd(), path).ok()).as_deref()),
        fs_queries::Kind::Listing => directory_answer(hash, &seen_from_below(path, retain_code_files(list_without_recording(path)))),
        fs_queries::Kind::Entry => match retain_code_files(list_without_recording(split(path).parent)) {
            Directory::Listed(listing) => listing.entry_answer(hash, split(path).name),
            _ => 0,
        },
        fs_queries::Kind::IsDirectory => kind_answer(for_the_system(&with_root(path)).and_then(|path| is_directory(Fd::cwd(), path))),
        fs_queries::Kind::RealPath => hash(&Disk::ask_for_real_path(path)) | 1,
        fs_queries::Kind::IsCaseSensitive => u64::from(is_file_system_case_sensitive(path)),
        fs_queries::Kind::NativeText => fs_queries::of_text(hash, bun_sys::File::read_from(Fd::cwd(), path).ok().as_deref()),
        fs_queries::Kind::Exists => u64::from(bun_sys::exists(path)),
        fs_queries::Kind::Scanned => crate::scan_result(path, read_at(path, false).as_deref(), &|_| {}).1.map_or(0, |found| hash(&found) | 1),
    }
}

/// The two parts of a path.
struct Split<'a> {
    /// The parent directory.
    parent: &'a [u8],
    /// The base name.
    name: &'a [u8],
}

/// `GetDirectoryPath`, `GetBaseFileName`: a root is its own directory and has no name.
fn split(path: &[u8]) -> Split<'_> {
    let parent = dirname::<Posix>(path);
    // Only what is before the last separator of a root ends with one.
    if parent.ends_with(b"/") && path.len() <= root_length(path) {
        return Split {
            parent: path,
            name: b"",
        };
    }
    Split {
        parent,
        name: basename_posix(path),
    }
}

/// Whether `path` is a directory (true) or a regular file (false), following symlinks. `None`: it does not exist, or it is neither.
/// `FileExists` and `GetAccessibleEntries` accept regular files only: reading a FIFO or a device can block forever.
fn is_directory(directory: Fd, path: &[u8]) -> Option<bool> {
    let mut buffer = path_buffer_pool::get();
    let path = z(path, &mut buffer);
    if cfg!(windows) {
        return Some(bun_sys::exists_at_type(directory, path).ok()? == ExistsAtType::Directory);
    }
    match bun_sys::kind_from_mode(bun_sys::fstatat(directory, path).ok()?.st_mode as _) {
        EntryKind::Directory => Some(true),
        EntryKind::File => Some(false),
        _ => None,
    }
}

impl Disk {
    /// The paths of `Provided::already_read`, each a `tspath.Path`.
    pub fn provided_paths(&self) -> impl Iterator<Item = &Vec<u8>> {
        self.already_read.keys()
    }

    pub(crate) fn has_already_read(&self, path: &[u8]) -> bool {
        let key = to_path(path, self.case_sensitive);
        self.already_read.contains_key(&*key) || self.deferred.get().is_some_and(|deferred| deferred.already_read.contains_key(&*key))
    }

    fn observe(&self, path: &[u8]) -> Option<[i64; 4]> {
        let times = Self::file_times(path);
        if let Some(observed) = self.observed.as_ref().filter(|_| self.deferred.get().is_none()) {
            observed.lock().push((path.to_vec(), times));
        }
        times
    }

    pub(crate) fn has_changed_since_observed(&self) -> bool {
        let Some(observed) = &self.observed else { return false };
        let observed = std::mem::take(&mut *observed.lock());
        let has_changed = std::sync::atomic::AtomicBool::new(false);
        self.parallel(observed.len(), &|at| {
            let (path, times) = &observed[at];
            if !has_changed.load(Ordering::Relaxed) && Self::file_times(path) != *times && !self.lists_same_names(path) {
                has_changed.store(true, Ordering::Relaxed);
            }
        });
        has_changed.into_inner()
    }

    fn lists_same_names(&self, path: &[u8]) -> bool {
        let (Some(Directory::Listed(known)), Directory::Listed(now)) = (self.directories.get_ref(path).and_then(|cell| cell.get()), list(path)) else {
            return false;
        };
        let now = match self.added_to(path) {
            Some(more) => now.with(more),
            None => now,
        };
        known.sorted() == now.sorted() && known.links() == now.links()
    }

    pub(crate) fn file_times(path: &[u8]) -> Option<[i64; 4]> {
        let rooted = with_root(path);
        let mut buffer = path_buffer_pool::get();
        let found = bun_sys::fstatat(Fd::cwd(), z(for_the_system(&rooted)?, &mut buffer)).ok()?;
        let (modified, changed) = (bun_sys::stat_mtime(&found), bun_sys::stat_ctime(&found));
        Some([modified.sec, modified.nsec, changed.sec, changed.nsec])
    }

    /// `cwd`: the working directory, in the checker's path format.
    pub fn started_in(mut self, cwd: &[u8]) -> Self {
        self.working_directory = cwd.to_vec();
        self
    }

    /// `project`: a path in the project, in the checker's path format.
    pub fn with_already_read(threads: usize, already_read: AlreadyRead, project: &[u8]) -> Self {
        let case_sensitive = is_file_system_case_sensitive(project);
        Disk {
            threads,
            shares: bun_threading::Guarded::new(None),
            in_memory: InMemory::by_directory(&already_read, case_sensitive),
            already_read: match case_sensitive {
                true => already_read,
                false => (already_read.into_iter())
                    .map(|(path, text)| (to_file_name_lower_case(&path), text))
                    .collect(),
            },
            deferred_read: bun_threading::Guarded::new(None),
            deferred_read_sources: OnceLock::new(),
            keeps_byte_order_marks: false,
            extended_configs: Default::default(),
            paths: Default::default(),
            caches: Default::default(),
            is_of_a_thread_of_the_pool: !bun_threading::thread_pool::Thread::current().is_null(),
            case_sensitive,
            directories: ShardedMap::default(),
            shared_directory_cache: None,
            is_early_pass: false,
            working_directory: Vec::new(),
            real_directories: ShardedMap::default(),
            reading: cfg!(target_os = "macos").then(|| {
                let places = bun_threading::Semaphore::default();
                for _ in 0..READERS {
                    places.post();
                }
                places
            }),
            // The condition of the bundler, and the same for the threads of this check.
            io_pool: (threads > 3 && bun_threading::io_thread_pool::uses_io_pool())
                .then(|| bun_threading::io_thread_pool::acquire().into()),
            idle_readers: bun_threading::Guarded::new(Vec::new()),
            unreadable: bun_threading::Guarded::new(Vec::new()),
            non_utf8: bun_threading::Guarded::new(FxHashSet::default()),
            times: Default::default(),
            bundled_libs: None,
            script_kinds: Vec::new(),
            script_kinds_by_extension: Vec::new(),
            before_read: None,
            scripts_of_page: None,
            file_jsx_options: Vec::new(),
            file_class_options: Vec::new(),
            is_without_bundler: false,
            lowers_like_the_runtime: false,
            lowering_of_every_file: OnceLock::new(),
            lowering_by_tsconfig: OnceLock::new(),
            import_constants: FxHashMap::default(),
            build_constants: None,
            early_paths: None,
            pending_early_paths: bun_threading::Guarded::new(Vec::new()),
            early_parse_cancelled: None,
            is_load_abandoned: None,
            observed: None,
            compiled: None,
            decodes_like_runtime: false,
            deferred_imports: FxHashMap::default(),
            deferred_paths: FxHashSet::default(),
            wait_for_deferred_sources: bun_threading::Guarded::new(None),
            deferred: OnceLock::new(),
            abandoned: bun_threading::Guarded::new(None),
        }
    }

    pub(crate) fn lower_every_file_as(&self, of_the_working_directory: (FileJsxOptions, ClassOptions), of_the_program: &bun_sema::resolve::Options) {
        let differs = of_the_working_directory != lowering_in(of_the_program);
        let _ = self.lowering_of_every_file.set(differs.then(|| Arc::new(of_the_working_directory)));
    }

    pub(crate) fn lower_each_file_by_its_tsconfig(&self, config_of_the_program: Option<&[u8]>, of_the_program: &bun_sema::resolve::Options) {
        let _ = self.lowering_by_tsconfig.set(LoweringByTsconfig {
            config_of_the_program: config_of_the_program.map(<[u8]>::to_vec),
            of_the_program: lowering_in(of_the_program),
            by_directory: bun_threading::Guarded::new(FxHashMap::default()),
            by_config: bun_threading::Guarded::new(FxHashMap::default()),
        });
    }

    fn lowering_of(&self, path: &[u8]) -> Option<Arc<(FileJsxOptions, ClassOptions)>> {
        if is_declaration_file_name(path) || is_bundled(path) || contains(path, crate::PRELUDE_DIRECTORY) {
            return None;
        }
        if let Some(of_every_file) = self.lowering_of_every_file.get() {
            return of_every_file.clone();
        }
        let lowering = self.lowering_by_tsconfig.get()?;
        let directory = dirname::<Posix>(path);
        if let Some(known) = lowering.by_directory.lock().get(directory) {
            return known.clone();
        }
        let enclosing = bun_sema::config::find_config(self, directory).filter(|enclosing| Some(enclosing) != lowering.config_of_the_program.as_ref());
        let found = enclosing.and_then(|enclosing| {
            if let Some(known) = lowering.by_config.lock().get(&enclosing) {
                return known.clone();
            }
            let loaded = bun_sema::config::load_overriding(self, &bun_sema::session::Session::new(), &enclosing, &|_| Vec::new()).ok();
            let own = loaded.map(|project| lowering_in(&project.options)).filter(|own| *own != lowering.of_the_program).map(Arc::new);
            lowering.by_config.lock().insert(enclosing, own.clone());
            own
        });
        lowering.by_directory.lock().insert(directory.to_vec(), found.clone());
        found
    }

    pub(crate) fn install_deferred_sources(&self, cwd: &[u8], sources: DeferredSources) {
        let path_of = |named: &[u8]| to_path(&self.as_written(&from_argument(cwd, named)), self.case_sensitive).into_owned();
        let in_memory = InMemory::by_directory(&sources.already_read, self.case_sensitive);
        let directories = (in_memory.iter())
            .map(|(path, more)| {
                let merged = match self.directory(path) {
                    Directory::Listed(listing) => Directory::Listed(listing.duplicate().with(more)),
                    Directory::Missing => Directory::Listed(Listing::default().with(more)),
                    Directory::Unreadable => Directory::Unreadable,
                };
                (path.clone(), merged)
            })
            .collect();
        let code: Vec<Vec<u8>> = sources.code.iter().map(|path| path_of(path)).collect();
        let installed = InstalledSources {
            is_commonjs_code: sources.code.iter().zip(&code).filter_map(|(given, path)| Some((path.clone(), *sources.code_kinds.get(given)?))).collect(),
            code: code.into_iter().collect(),
            entry_points: sources.paths.iter().map(|path| path_of(path)).collect(),
            script_kinds: sources.script_kinds.iter().map(|(path, kind)| (path_of(path), *kind)).collect(),
            file_jsx_options: sources.file_jsx_options.into_iter().map(|(path, of_file)| (path_of(&path), of_file)).collect(),
            file_class_options: sources.file_class_options.into_iter().map(|(path, of_file)| (path_of(&path), of_file)).collect(),
            import_constants: sources.import_constants.into_iter().collect(),
            already_read: match self.case_sensitive {
                true => sources.already_read,
                false => sources.already_read.into_iter().map(|(path, text)| (to_file_name_lower_case(&path), text)).collect(),
            },
            deferred_read: bun_threading::Guarded::new(sources.deferred_read),
            deferred_read_sources: OnceLock::new(),
            in_memory,
            directories,
            build_constants: sources.build_constants,
        };
        let _ = self.deferred.set(installed);
    }

    pub(crate) fn take_deferred_read(&self) -> Option<DeferredRead> {
        match self.deferred_read_sources.get().cloned() {
            Some(texts) => Some(Box::new(move || texts)),
            None => self.deferred_read.lock().take(),
        }
    }

    /// The directory at `path`, if it has been read.
    fn known_directory(&self, path: &[u8]) -> Option<&Directory> {
        if let Some(deferred) = self.deferred.get()
            && let Some(known) = deferred.directories.get(&*to_path(path, self.case_sensitive))
        {
            return Some(known);
        }
        self.directories.get_ref(path)?.get()
    }

    /// The name of the file at `path` in `bundled_libs`, if it is there.
    fn bundled<'a>(&self, path: &'a [u8]) -> Option<(BundledLibs, &'a [u8])> {
        let name = path.strip_prefix(BUNDLED_LIBS)?.strip_prefix(b"/")?;
        self.bundled_libs
            .filter(|libs| (libs.has)(name))
            .map(|libs| (libs, name))
    }

    /// An idle reader whose last read was from `directory`, or else a new one, or the least
    /// recently used one once enough are retained.
    fn take_reader(&self, directory: &[u8]) -> Reader {
        let mut idle = self.idle_readers.lock();
        match idle.iter().position(|r| r.directory == directory) {
            Some(i) => idle.remove(i),
            None if idle.len() >= MAX_IDLE_READERS => idle.remove(0),
            None => Reader::default(),
        }
    }

    fn return_reader(&self, reader: Reader) {
        let mut idle = self.idle_readers.lock();
        if idle.len() >= MAX_IDLE_READERS {
            idle.remove(0);
        }
        idle.push(reader);
    }

    /// Whether the entries of `path` are queried from the system every time: true for the roots,
    /// which on Windows are not directories. Neither is a server, and `C:` names the working
    /// directory on that drive.
    fn is_above_listings(path: &[u8]) -> bool {
        // `(length, 0)`: a drive, or a server without a share.
        let is_volume = |path: &[u8]| {
            let native = to_native(path);
            windows_volume_name_len(native) == (native.len(), 0)
        };
        path.is_empty() || cfg!(windows) && (path == b"/" || is_volume(path))
    }

    fn directory(&self, path: &[u8]) -> &Directory {
        // `SplitPath`: the separator at the end of what follows the root.
        let path = match path.ends_with(b"/") {
            true => &path[..without_trailing_slash(path).len().max(root_length(path))],
            false => path,
        };
        if let Some(known) = self.known_directory(path) {
            return known;
        }
        // What is above it is not read for it: a project can be in a directory with any number of other entries.
        let cell = match self.directories.get_ref(path) {
            Some(known) => known,
            None => (self.directories).insert_ref(path.to_vec(), OnceLock::new()),
        };
        cell.get_or_init(|| {
            let known = self.known_directory(split(path).parent);
            self.read_directory(path, known.unwrap_or(&Directory::Unreadable))
        })
    }

    /// The directory at `path` to look an entry up in. `None`: the system has to be asked about the entry. What is above the
    /// working directory is not read for that. It is asked about a `node_modules`, a `package.json` and little else, and
    /// to read it takes as long as it has entries: a project can be in a directory with any number of others.
    fn directory_to_look_in(&self, path: &[u8]) -> Option<&Directory> {
        let rest = self.working_directory.strip_prefix(path);
        let is_above =
            rest.is_some_and(|it| it.starts_with(b"/") || !it.is_empty() && path.ends_with(b"/"));
        match is_above {
            true => self.known_directory(path),
            false => Some(self.directory(path)),
        }
    }

    /// The directory at `path`, which is in `parent`.
    fn read_directory(&self, path: &[u8], parent: &Directory) -> Directory {
        // An entry that its parent does not list does not exist, so no system call is needed.
        if let Directory::Listed(listing) = parent
            && let Some(found) = self.find_in(listing, split(path).name)
            && !matches!(found, Some((_, true)))
        {
            return Directory::Missing;
        }
        if self.observed.is_some() {
            self.observe(path);
        }
        let directory = match &self.shared_directory_cache {
            Some(cache) if !fs_queries::is_recording() => cache.list(path),
            _ => list(path),
        };
        match (directory, self.added_to(path)) {
            (read, None) | (read @ Directory::Unreadable, _) => read,
            (Directory::Listed(listing), Some(more)) => Directory::Listed(listing.with(more)),
            (Directory::Missing, Some(more)) => Directory::Listed(Listing::default().with(more)),
        }
    }

    /// What `already_read` adds to the directory at `path`.
    fn added_to(&self, path: &[u8]) -> Option<&InMemory> {
        match self.in_memory.is_empty() {
            true => None,
            false => self.in_memory.get(&*to_path(path, self.case_sensitive)),
        }
    }

    /// Whether `path` is a directory, for a path that `already_read` adds.
    fn find_in_memory(&self, path: &[u8]) -> Option<bool> {
        let Split { parent, name } = split(path);
        let deferred = self.deferred.get().and_then(|deferred| deferred.in_memory.get(&*to_path(parent, self.case_sensitive)));
        [self.added_to(parent), deferred].into_iter().flatten().find_map(|names| {
            if name.is_empty() {
                return Some(true);
            }
            let has = |names: &[Vec<u8>]| {
                let mut names = names.iter();
                names.any(|it| is_same_path(it, name, self.case_sensitive))
            };
            if has(&names.files) {
                return Some(false);
            }
            has(&names.directories).then_some(true)
        })
    }

    /// Asks the system, which does not know what is only in memory.
    fn ask_whether_directory(&self, path: &[u8]) -> Option<bool> {
        self.find_in_memory(path).or_else(|| Asking::is_directory(path))
    }

    /// `None`: the system has to be queried.
    fn find(&self, path: &[u8]) -> Option<Option<(&[u8], bool)>> {
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return None;
        }
        match self.directory_to_look_in(parent)? {
            Directory::Missing => Some(None),
            Directory::Unreadable => None,
            Directory::Listed(listing) => self.find_in(listing, name),
        }
    }

    /// `Listing::find`. `None`: the system has to be queried. The name is there in another
    /// spelling, and the file system of that directory may take one for the other, whatever that of
    /// the project does: a project can have several. Or it has letters outside ASCII, which a file
    /// system folds and normalizes by rules of its own: for APFS U+017F is `s`, and a composed
    /// letter is the decomposed one, with or without case. Or it can be a short name.
    fn find_in<'a>(&self, listing: &'a Listing, name: &[u8]) -> Option<Option<(&'a [u8], bool)>> {
        listing.record_implicit_flow(name);
        match listing.look_up(name) {
            Found::Alike(_) if self.case_sensitive => None,
            Found::Exact(entry) | Found::Alike(entry) => {
                Some(Some((listing.name(entry), entry.is_directory)))
            }
            Found::Nothing if !name.is_ascii() || is_like_a_short_name(name) => None,
            Found::Nothing if fs_queries::is_recording() && !can_be_code(name) => None,
            Found::Nothing => Some(None),
        }
    }

    fn ask_for_real_path(path: &[u8]) -> Vec<u8> {
        let rooted = with_root(path);
        let Some(native) = for_the_system(&rooted) else {
            return path.to_vec();
        };
        let (mut name, mut real) = (path_buffer_pool::get(), path_buffer_pool::get());
        let found = bun_sys::realpath(z(native, &mut name), &mut real)
            .map_or_else(|_| path.to_vec(), from_native);
        fs_queries::record_query(fs_queries::Kind::RealPath, path, |hash| hash(&found) | 1);
        found
    }

    /// `path`, with every name in it spelled as its directory has it. Links are not followed.
    pub fn as_written(&self, path: &[u8]) -> Vec<u8> {
        if self.case_sensitive {
            return path.to_vec();
        }
        // The names that a listing can have, the last one first, and what is above them.
        let mut names = Vec::new();
        let mut above = path;
        loop {
            let Split { parent, name } = split(above);
            if name.is_empty() || Self::is_above_listings(parent) {
                break;
            }
            names.push((parent, name));
            above = parent;
        }
        let mut written = above.to_vec();
        // Nothing is asked about what is in a directory that does not exist.
        let mut exists = true;
        for (parent, name) in names.into_iter().rev() {
            let found = match exists.then(|| self.directory(parent)) {
                Some(Directory::Listed(listing)) => {
                    listing.record_implicit_flow(name);
                    listing.find(name, false).map(|it| it.0)
                }
                Some(Directory::Missing) => {
                    exists = false;
                    None
                }
                Some(Directory::Unreadable) | None => None,
            };
            if !written.ends_with(b"/") {
                written.push(b'/');
            }
            written.extend_from_slice(found.unwrap_or(name));
        }
        written
    }

    /// `path` is there.
    fn real_path_of(&self, path: &[u8]) -> Vec<u8> {
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return Self::ask_for_real_path(path);
        }
        let Some(Directory::Listed(listing)) = self.directory_to_look_in(parent) else {
            return Self::ask_for_real_path(path);
        };
        let Some(found) = self.find_in(listing, name) else {
            return Self::ask_for_real_path(path);
        };
        let Some((written, _)) = found else {
            return path.to_vec();
        };
        if matches!(listing.look_up(written), Found::Exact(it) if it.is_link) {
            return Self::ask_for_real_path(path);
        }
        let real_parent = match self.real_directories.get_ref(parent) {
            Some(known) => known,
            None => {
                let above = split(parent).parent;
                // A root is where it is. See `root_length` for the second one.
                let real = if matches!(parent, b"/" | b"/\0") {
                    parent.to_vec()
                } else if self.known_directory(above).is_some() {
                    self.real_path_of(parent)
                } else {
                    Self::ask_for_real_path(parent)
                };
                self.real_directories.insert_ref(parent.to_vec(), real)
            }
        };
        if real_parent == b"/" {
            [&b"/"[..], written].concat()
        } else {
            inside(real_parent, written)
        }
    }
}

impl Drop for Disk {
    fn drop(&mut self) {
        if self.io_pool.is_some() {
            bun_threading::io_thread_pool::release();
        }
    }
}

/// Whether `name` has the form of the second name that NTFS and FAT give an entry whose own name is not 8.3: `PROGRA~1` for
/// `Program Files`, `RUNNER~1` for `runneradmin`. The entry is found by it, and no listing has it.
fn is_like_a_short_name(name: &[u8]) -> bool {
    let Some((before, after)) = rsplit_once_char(name, b'~') else {
        return false;
    };
    let (number, extension) = split_once_char(after, b'.').unwrap_or((after, &b""[..]));
    !before.is_empty()
        && before.len() + 1 + number.len() <= 8
        && extension.len() <= 3
        && !number.is_empty()
        && number.iter().all(u8::is_ascii_digit)
}

/// Reads the entries of the directory at `path` from the system.
fn list(path: &[u8]) -> Directory {
    let found = list_without_recording(path);
    let found = if fs_queries::is_recording() { seen_from_below(path, retain_code_files(found)) } else { found };
    fs_queries::record_query(fs_queries::Kind::Listing, path, |hash| directory_answer(hash, &found));
    found
}

/// By its name. A file that cannot comes and goes without a question that `asked` has noted being answered otherwise.
fn can_be_code(name: &[u8]) -> bool {
    match bun_core::strings::last_index_of_char(name, b'.') {
        None => true,
        Some(dot) => matches!(&name[dot + 1..], b"ts" | b"tsx" | b"mts" | b"cts" | b"js" | b"jsx" | b"mjs" | b"cjs" | b"json"),
    }
}

fn retain_code_files(mut directory: Directory) -> Directory {
    if let Directory::Listed(listing) = &mut directory {
        let kept = listing.entries.iter().filter(|it| it.is_directory || can_be_code(it.name_in(&listing.names)));
        listing.entries = kept.copied().collect();
    }
    directory
}

fn seen_from_below(path: &[u8], mut directory: Directory) -> Directory {
    if let Directory::Listed(listing) = &mut directory {
        listing.above = fs_queries::child_toward_working_directory(path).map(|leads_down| (path.to_vec(), leads_down));
    }
    directory
}

fn list_without_recording(path: &[u8]) -> Directory {
    let rooted = with_root(path);
    let Some(native) = for_the_system(&rooted) else {
        return Directory::Missing;
    };
    let directory = match bun_sys::open_dir_absolute(native) {
        Ok(directory) => bun_sys::Dir::from_fd(directory),
        Err(error) if matches!(error.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            return Directory::Missing;
        }
        Err(_) => return Directory::Unreadable,
    };
    let mut listing = Entries::default();
    let mut entries = bun_sys::iterate_dir(directory.fd());
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        // The entry kind from the directory listing avoids a system call per file.
        let is_link = match entry.kind {
            EntryKind::SymLink => true,
            EntryKind::Unknown => {
                match bun_sys::lstatat(directory.fd(), z(name, &mut path_buffer_pool::get())) {
                    Ok(found) => bun_sys::kind_from_mode(found.st_mode as _) == EntryKind::SymLink,
                    Err(_) => continue,
                }
            }
            _ => false,
        };
        let is_dir = match entry.kind {
            EntryKind::Directory => true,
            // A symlink has to be followed, unless the listing says what it stands for. It may be dangling.
            EntryKind::SymLink | EntryKind::Unknown => {
                let known = entry.link_is_directory();
                match known.or_else(|| is_directory(directory.fd(), name)) {
                    Some(is_dir) => is_dir,
                    None => continue,
                }
            }
            EntryKind::File => false,
            // A FIFO, socket or device.
            _ => continue,
        };
        listing.push(name, is_dir, is_link);
    }
    Directory::Listed(listing.finish())
}

/// `isFileSystemCaseSensitive`, for the file system that has `path`: whether something on it is no
/// longer found when the case of its name is swapped. TypeScript asks about itself, which is in the
/// project.
fn is_file_system_case_sensitive(path: &[u8]) -> bool {
    let found = is_file_system_case_sensitive_unrecorded(path);
    fs_queries::record_query(fs_queries::Kind::IsCaseSensitive, path, |_| u64::from(found));
    found
}

fn is_file_system_case_sensitive_unrecorded(path: &[u8]) -> bool {
    if cfg!(windows) {
        return false;
    }
    let swapped = |name: &[u8]| {
        let mut swapped = name.to_vec();
        for c in &mut swapped {
            *c ^= u8::from(c.is_ascii_alphabetic()) << 5;
        }
        (swapped != name).then_some(swapped)
    };
    // `[eval]` is only in memory: no spelling of its name is found.
    let is_there = |it: &&[u8]| for_the_system(it).is_some_and(bun_sys::exists);
    let Some(path) = ancestors(path).find(is_there) else {
        return true;
    };
    // What is in a directory is on its file system. Its own name is not, if it is where that file
    // system is mounted, like `/app` in a container.
    if let Directory::Listed(listing) = list(path) {
        let mut names = listing.entries.iter().map(|it| listing.name(it));
        if let Some(other) = names.find_map(swapped) {
            return !bun_sys::exists(to_native(&inside(path, &other)));
        }
    }
    // Only the name: what is above it can be on another file system, like `/mnt` of `/mnt/c`.
    for path in ancestors(path) {
        let Split { parent, name } = split(path);
        if let Some(other) = swapped(name) {
            return !bun_sys::exists(to_native(&inside(parent, &other)));
        }
    }
    true
}

/// `jsonwire.ConsumeWhitespace`: the offset of what follows the white space at `n` in `b`.
fn consume_whitespace(b: &[u8], mut n: usize) -> usize {
    while matches!(b.get(n), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        n += 1;
    }
    n
}

/// `jsonwire.ConsumeLiteral`: the end of `lit`, if it is at `n` in `b`.
fn consume_literal(b: &[u8], n: usize, lit: &[u8]) -> Option<usize> {
    b[n..].starts_with(lit).then_some(n + lit.len())
}

/// `parseHexUint16`, of four bytes.
fn parse_hex_uint16(b: &[u8]) -> Option<u16> {
    let mut v = 0;
    for &c in b {
        v = v * 16 + (c as char).to_digit(16)? as u16;
    }
    Some(v)
}

/// `jsonwire.ConsumeString`: the end of the string that starts at `n` in `b`, which is valid UTF-8.
fn consume_string(b: &[u8], mut n: usize) -> Option<usize> {
    if *b.get(n)? != b'"' {
        return None;
    }
    n += 1;
    loop {
        match *b.get(n)? {
            b'"' => return Some(n + 1),
            b'\\' => match *b.get(n + 1)? {
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => n += 2,
                b'u' => {
                    let v1 = parse_hex_uint16(b.get(n + 2..n + 6)?)?;
                    n += 6;
                    // `utf16.IsSurrogate`
                    if (0xD800..0xE000).contains(&v1) {
                        let v2 = parse_hex_uint16(b.get(n..n + 6)?.strip_prefix(b"\\u")?)?;
                        // `utf16.DecodeRune`
                        if v1 >= 0xDC00 || !(0xDC00..0xE000).contains(&v2) {
                            return None;
                        }
                        n += 6;
                    }
                }
                _ => return None,
            },
            0..=0x1F => return None,
            _ => n += 1,
        }
    }
}

/// `jsonwire.ConsumeNumber`: the end of the number that starts at `n` in `b`.
fn consume_number(b: &[u8], mut n: usize) -> Option<usize> {
    // At least one.
    let consume_digits = |start: usize| {
        let mut n = start;
        while b.get(n).is_some_and(u8::is_ascii_digit) {
            n += 1;
        }
        (n > start).then_some(n)
    };
    if b.get(n) == Some(&b'-') {
        n += 1;
    }
    n = if b.get(n) == Some(&b'0') {
        n + 1
    } else {
        consume_digits(n)?
    };
    if b.get(n) == Some(&b'.') {
        n = consume_digits(n + 1)?;
    }
    if matches!(b.get(n), Some(b'e' | b'E')) {
        n += 1;
        if matches!(b.get(n), Some(b'-' | b'+')) {
            n += 1;
        }
        n = consume_digits(n)?;
    }
    Some(n)
}

/// `consumeValue`, with `consumeObject` and `consumeArray`: the end of the value at `n` in `b`.
fn consume_value(b: &[u8], mut n: usize) -> Option<usize> {
    /// `maxNestingDepth`
    const MAX_NESTING_DEPTH: usize = 10000;
    // The end of each object and array that `n` is in.
    let mut open: Vec<u8> = Vec::new();
    loop {
        if open.last() == Some(&b'}') {
            n = consume_whitespace(b, consume_string(b, n)?);
            if *b.get(n)? != b':' {
                return None;
            }
            n = consume_whitespace(b, n + 1);
        }
        n = match *b.get(n)? {
            b'n' => consume_literal(b, n, b"null")?,
            b'f' => consume_literal(b, n, b"false")?,
            b't' => consume_literal(b, n, b"true")?,
            b'"' => consume_string(b, n)?,
            b'-' | b'0'..=b'9' => consume_number(b, n)?,
            begin @ (b'{' | b'[') => {
                if open.len() == MAX_NESTING_DEPTH {
                    return None;
                }
                let end = if begin == b'{' { b'}' } else { b']' };
                n = consume_whitespace(b, n + 1);
                if *b.get(n)? != end {
                    open.push(end);
                    continue;
                }
                n + 1
            }
            _ => return None,
        };
        // After a value: a comma, or the end of what the value is in, which is a value too.
        loop {
            let Some(&end) = open.last() else {
                return Some(n);
            };
            n = consume_whitespace(b, n);
            let delimiter = *b.get(n)?;
            n += 1;
            if delimiter == b',' {
                n = consume_whitespace(b, n);
                break;
            }
            if delimiter != end {
                return None;
            }
            open.pop();
        }
    }
}

/// `jsontext.Value.IsValid` under `AllowDuplicateNames`
fn is_valid(b: &[u8]) -> bool {
    is_valid_utf8(b)
        && consume_value(b, consume_whitespace(b, 0))
            .is_some_and(|n| consume_whitespace(b, n) == b.len())
}

/// `actualJSONType` of `data`, as a value of that type without what `data` contains.
fn actual_json_type(data: &JsonValue) -> Json {
    match data {
        JsonValue::Null => Json::Null,
        JsonValue::Boolean(_) => Json::Bool(false),
        JsonValue::Number(_) => Json::Number(0.0),
        JsonValue::String(_) => Json::String(Vec::new()),
        JsonValue::Array(_) => Json::Array(Vec::new()),
        JsonValue::Object(_) => Json::Object(Vec::new()),
    }
}

/// `json.Unmarshal(data, &e.Value)`, without `AllowDuplicateNames`, for an object and a map, which
/// keeps what it has. It stops at a member that is neither a string nor `null`, whose name it still
/// enters, and at a repeated name. Then this returns `value` with that name repeated at the end.
fn unmarshal_map(
    object: &ObjectJSON,
    has_duplicates: bool,
    value: &mut Vec<(Vec<u8>, Json)>,
) -> Option<Json> {
    let properties = object.properties();
    let kept = value.len();
    for (i, property) in properties.iter().enumerate() {
        let name = property.key.slice();
        let text = match &property.value {
            JsonValue::String(text) => Some(text.slice()),
            JsonValue::Null => Some(&b""[..]),
            _ => None,
        };
        let is_repeated =
            has_duplicates && properties[..i].iter().any(|seen| seen.key.slice() == name);
        if !is_repeated {
            match value[..kept].iter_mut().find(|known| known.0 == name) {
                Some(known) => {
                    if let Some(text) = text {
                        known.1 = Json::String(text.to_vec());
                    }
                }
                None => {
                    value.push((
                        name.to_vec(),
                        Json::String(text.unwrap_or_default().to_vec()),
                    ));
                }
            }
        }
        if is_repeated || text.is_none() {
            let mut refused = value.clone();
            refused.push((name.to_vec(), actual_json_type(&property.value)));
            return Some(Json::Object(refused));
        }
    }
    None
}

/// `packagejson.Expected[T]`
#[derive(Default)]
struct Expected {
    /// A value of `actualJSONType` that is no `T`.
    actual: Option<Json>,
    null: bool,
    valid: bool,
    value: Option<Json>,
}

impl Expected {
    /// `Expected.UnmarshalJSON`. `T` is `map[string]string` or `string`.
    fn unmarshal_json(&mut self, data: &JsonValue, is_map: bool, has_duplicates: bool) {
        let refused = match data {
            JsonValue::Null => {
                *self = Expected {
                    actual: Some(Json::Null),
                    null: true,
                    ..Default::default()
                };
                return;
            }
            JsonValue::String(text) if !is_map => {
                self.value = Some(Json::String(text.slice().to_vec()));
                None
            }
            JsonValue::Object(object) if is_map => {
                let value = self.value.take().and_then(Json::into_object);
                let mut value = value.unwrap_or_default();
                let refused = unmarshal_map(object.get(), has_duplicates, &mut value);
                self.value = Some(Json::Object(value));
                refused
            }
            _ => Some(actual_json_type(data)),
        };
        match refused {
            None => self.valid = true,
            Some(_) => self.actual = refused,
        }
    }
}

/// `unmarshalJSONValueV2`. `None`: `strconv.ParseFloat` returns `ErrRange` for a number, or the
/// stack, which grows in Go, is at its end.
fn unmarshal_json_value(value: &JsonValue, has_duplicates: bool) -> Option<Json> {
    if !bun_core::StackCheck::init().is_safe_to_recurse() {
        return None;
    }
    Some(match value {
        JsonValue::Null => Json::Null,
        JsonValue::Boolean(value) => Json::Bool(*value),
        JsonValue::Number(number) if number.value().is_infinite() => return None,
        JsonValue::Number(number) => Json::Number(number.value()),
        JsonValue::String(text) => Json::String(text.slice().to_vec()),
        JsonValue::Array(array) => {
            let items = array.get().items();
            let mut elements = Vec::with_capacity(items.len());
            for item in items {
                elements.push(unmarshal_json_value(item, has_duplicates)?);
            }
            Json::Array(elements)
        }
        JsonValue::Object(object) => {
            let properties = object.get().properties();
            let mut entries: Vec<(Vec<u8>, Json)> = Vec::with_capacity(properties.len());
            for property in properties {
                let key = property.key.slice();
                let value = unmarshal_json_value(&property.value, has_duplicates)?;
                // `OrderedMap.Set`: the last value, at the place of the first.
                let known = has_duplicates.then(|| entries.iter_mut().find(|it| it.0 == key));
                match known.flatten() {
                    Some(known) => known.1 = value,
                    None => entries.push((key.to_vec(), value)),
                }
            }
            Json::Object(entries)
        }
    })
}

/// `json.Unmarshal(data, &f, json.AllowDuplicateNames(true))` for an object: `Fields`, in the form
/// of `Host::parse_package_json`. Every value of a repeated name is decoded into the one field.
fn unmarshal_fields(object: &ObjectJSON, has_duplicates: bool) -> Option<Json> {
    let mut expected: Vec<(&[u8], Expected)> = Vec::new();
    let mut fields: Vec<(Vec<u8>, Json)> = Vec::new();
    for property in object.properties() {
        let (name, data) = (property.key.slice(), &property.value);
        let is_map = match name {
            b"name" | b"version" | b"type" | b"tsconfig" | b"main" | b"types" | b"typings" => false,
            // Not in `Fields`: for `Resolver::resolve_as_require`.
            b"module" | b"jsnext:main" => false,
            b"dependencies"
            | b"devDependencies"
            | b"peerDependencies"
            | b"optionalDependencies" => true,
            b"sideEffects" => {
                if !fields.iter().any(|it| it.0 == name) {
                    fields.push((name.to_vec(), unmarshal_json_value(data, has_duplicates).unwrap_or(Json::Null)));
                }
                continue;
            }
            b"typesVersions" | b"imports" | b"exports" => {
                let value = unmarshal_json_value(data, has_duplicates)?;
                let known = has_duplicates.then(|| fields.iter_mut().find(|it| it.0 == name));
                match known.flatten() {
                    Some((_, known)) => {
                        // `json.UnmarshalDecode(dec, &v.Value)`, which decodes a string, a boolean
                        // and a number, decodes into the type of what `v.Value` holds.
                        let fits = matches!(known, Json::Null)
                            || matches!(value, Json::Null | Json::Array(_) | Json::Object(_))
                            || std::mem::discriminant(&*known) == std::mem::discriminant(&value);
                        if !fits {
                            return None;
                        }
                        *known = value;
                    }
                    None => fields.push((name.to_vec(), value)),
                }
                continue;
            }
            // `SkipValue`
            _ => continue,
        };
        let known = has_duplicates.then(|| expected.iter().position(|it| it.0 == name));
        let at = known.flatten().unwrap_or_else(|| {
            expected.push((name, Expected::default()));
            expected.len() - 1
        });
        expected[at].1.unmarshal_json(data, is_map, has_duplicates);
    }
    for (name, field) in expected {
        let (shown, value) = match field.valid {
            true => (field.value, None),
            false if matches!(field.actual, Some(Json::Object(_))) => (field.actual, None),
            false => (field.actual, field.value),
        };
        let null = (field.null && shown != Some(Json::Null)).then_some(Json::Null);
        let values = shown.into_iter().chain(null).chain(value);
        fields.extend(values.map(|it| (name.to_vec(), it)));
    }
    Some(Json::Object(fields))
}

/// `packagejson.Parse`. Bun's JSON parser, which makes the values, also takes what is no JSON.
pub fn parse_json_object(text: &[u8]) -> Option<Json> {
    use bun_parsers::json::ParsedJson;
    if !is_valid(text) {
        return None;
    }
    let session = bun_sema::session::Session::new();
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(session.arena());
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(b"object.json".as_slice(), text);
    let mut log = bun_ast::Log::init();
    let parsed = ParsedJson::parse_json(&source, &mut log).ok()?;
    let bun_ast::expr::Data::EObjectJSON(root) = parsed.root.data else {
        return None;
    };
    let entries = root.get().properties().iter().map(|property| Some((property.key.slice().to_vec(), unmarshal_json_value(&property.value, false)?)));
    Some(Json::Object(entries.collect::<Option<Vec<_>>>()?))
}

fn parse_package_json(arena: &Arena, text: &[u8]) -> Option<Json> {
    use bun_parsers::json::ParsedJson;
    if !is_valid(text) {
        return None;
    }
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(b"package.json".as_slice(), text);
    let mut log = bun_ast::Log::init();
    let parsed = ParsedJson::parse_json(&source, &mut log).ok()?;
    let bun_ast::expr::Data::EObjectJSON(root) = parsed.root.data else {
        return None;
    };
    // The only warning is about a duplicate key.
    unmarshal_fields(root.get(), log.warnings > 0)
}

impl Disk {
    fn deferred_read_sources(&self) -> &AlreadyRead {
        self.deferred_read_sources.get_or_init(|| {
            let wait = self.deferred_read.lock().take();
            let texts = wait.map_or_else(AlreadyRead::default, |wait| wait());
            match self.case_sensitive {
                true => texts,
                false => texts.into_iter().map(|(path, text)| (to_file_name_lower_case(&path), text)).collect(),
            }
        })
    }

    fn installed_deferred_read_sources<'a>(&self, deferred: &'a InstalledSources) -> &'a AlreadyRead {
        deferred.deferred_read_sources.get_or_init(|| {
            let wait = deferred.deferred_read.lock().take();
            let texts = wait.map_or_else(AlreadyRead::default, |wait| wait());
            match self.case_sensitive {
                true => texts,
                false => texts.into_iter().map(|(path, text)| (to_file_name_lower_case(&path), text)).collect(),
            }
        })
    }

    fn store_bundler_sources(&self, sources: impl Iterator<Item = (Vec<u8>, Option<&'static [u8]>)>) {
        let Some(cache) = &self.shared_directory_cache else { return };
        let mut sources = sources.peekable();
        if sources.peek().is_some() {
            cache.last_delivery_nanos.store(cache.created.elapsed().as_nanos() as u64, Ordering::Relaxed);
        }
        let mut pending = self.pending_early_paths.lock();
        for (path, contents) in sources {
            let path = from_native(&path);
            let key = to_path(&path, self.case_sensitive).into_owned();
            match contents {
                Some(contents) => {
                    cache.bundler_sources.insert_ref(key, bun_core::strings::without_utf8_bom(contents));
                    pending.push(path);
                }
                None => {
                    cache.scheduled_by_bundler.insert_ref(key, ());
                }
            }
        }
    }

    fn bundler_source(&self, path: &[u8]) -> Option<&'static [u8]> {
        if !self.is_early_pass {
            return None;
        }
        if let Some(receiver) = &self.early_paths {
            self.store_bundler_sources(receiver.lock().try_iter());
        }
        self.shared_directory_cache.as_ref()?.bundler_sources.get_ref(&*to_path(path, self.case_sensitive)).copied()
    }

    pub(crate) fn begin_early_read(&self) -> Option<EarlyRead<'_>> {
        let cache = self.shared_directory_cache.as_deref()?;
        while !HOLDS_EARLY_READ.get() && !self.is_early_parse_cancelled() {
            if let Some(read) = cache.try_begin_early_read() {
                return Some(read);
            }
            std::thread::sleep(Duration::from_micros(500));
        }
        None
    }
}

/// The disk, for a few questions in many directories: each is a call of the system, and no directory is listed for it
/// or kept. A `Disk` lists the directory of whatever it is asked about, which pays where most of it is asked for.
#[derive(Copy, Clone)]
pub(crate) struct Asking<'k> {
    /// `Host::extended_config`
    pub(crate) extended: Option<&'k bun_threading::Guarded<FxHashMap<Vec<u8>, Kept>>>,
    pub(crate) is_case_sensitive: bool,
    /// Or else every directory is empty: the `include` of a configuration file finds nothing.
    pub(crate) lists: bool,
}

impl Asking<'_> {
    /// `project`: a path in the project, in the checker's path format.
    pub(crate) fn new(project: &[u8]) -> Asking<'static> {
        Asking {
            extended: None,
            is_case_sensitive: is_file_system_case_sensitive(project),
            lists: false,
        }
    }

    fn is_directory(path: &[u8]) -> Option<bool> {
        let found = for_the_system(&with_root(path)).and_then(|path| is_directory(Fd::cwd(), path));
        fs_queries::record_query(fs_queries::Kind::IsDirectory, path, |_| kind_answer(found));
        found
    }
}

impl Host for Asking<'_> {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        read_at(path, false)
    }
    fn extended_config(&self, path: &[u8]) -> Option<Kept> {
        self.extended?.lock().get(path).cloned()
    }
    fn keep_extended_config(&self, path: &[u8], parsed: &dyn Fn() -> Kept) {
        if let Some(extended) = self.extended {
            extended.lock().insert(path.to_vec(), parsed());
        }
    }
    fn is_file(&self, path: &[u8]) -> bool {
        Self::is_directory(path) == Some(false)
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        Self::is_directory(path) == Some(true)
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        Disk::ask_for_real_path(path)
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        match self.lists.then(|| list(path)) {
            Some(Directory::Listed(listing)) => {
                listing.record_all();
                let (mut files, directories) = listing.sorted();
                files.extend(directories);
                files
            }
            _ => Vec::new(),
        }
    }
    fn is_case_sensitive(&self) -> bool {
        self.is_case_sensitive
    }
    fn script_kind(&self, _: &[u8]) -> Option<ScriptKind> {
        None
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &[]
    }
    fn scripts_of_page(&self, _: &[u8]) -> Vec<Vec<u8>> {
        Vec::new()
    }
    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> hir::File<'s> {
        bun_sema_parser::summarize(
            arena,
            path,
            None,
            text,
            atoms,
            options.experimental_decorators,
            options.module_detection == ModuleDetection::Force,
            options.bind.uses_ecmascript_bindings,
        )
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_package_json(arena, text)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}

/// How many consecutive indices a thread of a parallel region takes at a time: adjacent paths are in the same directory.
fn run_of(count: usize) -> usize {
    if count > 1024 { 16 } else { 1 }
}

impl Host for Disk {
    fn extended_config(&self, path: &[u8]) -> Option<Kept> {
        self.extended_configs.lock().get(path).cloned()
    }
    fn keep_extended_config(&self, path: &[u8], parsed: &dyn Fn() -> Kept) {
        self.extended_configs.lock().insert(path.to_vec(), parsed());
    }
    fn shared_paths(&self, paths: Arc<Paths>) -> Arc<Paths> {
        let mut kept = self.paths.lock();
        if let Some(equal) = kept.get(&paths) {
            return Arc::clone(equal);
        }
        kept.insert(Arc::clone(&paths));
        paths
    }
    fn spent(&self, phase: Phase, time: Duration) {
        self.times[phase as usize].fetch_add(time.as_nanos() as u64, Ordering::Relaxed);
    }
    fn times(&self) -> [Duration; Phase::ALL.len()] {
        Phase::ALL
            .map(|phase| Duration::from_nanos(self.times[phase as usize].load(Ordering::Relaxed)))
    }
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        if !self.already_read.is_empty()
            && let key = to_path(path, self.case_sensitive)
            && let Some(text) = self.already_read.get(&*key)
        {
            let later = if text.is_empty() { self.deferred_read_sources().get(&*key) } else { None };
            return Some(later.unwrap_or(text).clone());
        }
        if let Some(deferred) = self.deferred.get()
            && let key = to_path(path, self.case_sensitive)
            && let Some(text) = deferred.already_read.get(&*key)
        {
            let later = if text.is_empty() { self.installed_deferred_read_sources(deferred).get(&*key) } else { None };
            return Some(later.unwrap_or(text).clone());
        }
        if let Some(contents) = self.bundler_source(path) {
            return Some(Cow::Borrowed(contents));
        }
        let _reading = Spent::on(self, Phase::Read);
        if is_bundled(path) {
            let (libs, name) = self.bundled(path)?;
            return (libs.read)(name);
        }
        if let Some(before_read) = &self.before_read {
            before_read(path);
        }
        for_the_system(path)?;
        if self.observed.is_some() {
            self.observe(path);
        }
        let Split { parent, name } = split(path);
        // Config files and `package.json` are read as JSON, so they never keep the mark.
        let keeps_mark = self.keeps_byte_order_marks && ScriptKind::from_file_name(path).is_some();
        if name.is_empty() || Self::is_above_listings(parent) {
            return read_at(path, keeps_mark);
        }
        let _early_read = if self.early_paths.is_some() { self.begin_early_read() } else { None };
        let _turn = self.reading.as_ref().map(Turn::wait_for);
        let mut reader = self.take_reader(parent);
        // The second file read from a directory, and those after it, are opened relative to the directory. An absolute path makes
        // the kernel look up every directory on the way again, and all threads contend on the ones near the root. For a single
        // file, opening the directory costs that walk and more.
        let read = if reader.directory != parent {
            reader.handle = None;
            reader.directory.clear();
            reader.directory.extend_from_slice(parent);
            None
        } else {
            if reader.handle.is_none() {
                reader.handle = bun_sys::open_dir_absolute(to_native(parent))
                    .ok()
                    .map(bun_sys::Dir::from_fd);
            }
            let Reader { handle, buffer, .. } = &mut reader;
            handle
                .as_ref()
                .map(|directory| read_file(directory.fd(), name, buffer))
        };
        let read = read.unwrap_or_else(|| {
            let path = to_native(without_trailing_slash(path));
            read_file(Fd::cwd(), path, &mut reader.buffer)
        });
        self.return_reader(reader);
        fs_queries::record_query(fs_queries::Kind::Text, path, |hash| fs_queries::of_text(hash, read.as_deref()));
        read.map(|bytes| decoded(bytes, keeps_mark))
    }
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        let text = self.read(path).unwrap_or_else(|| {
            self.unreadable.lock().push(path.to_vec());
            Cow::default()
        });
        if !self.decodes_like_runtime || is_valid_utf8(&text) {
            return text;
        }
        if path.ends_with(b".json") {
            return Cow::Owned(bstr::BStr::new(&text).to_string().into_bytes());
        }
        self.non_utf8.lock().insert(path.to_vec());
        Cow::Owned(decode_like_runtime(&text))
    }
    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.unreadable.lock())
    }
    fn is_non_utf8(&self, path: &[u8]) -> bool {
        self.non_utf8.lock().contains(path)
    }
    fn is_file(&self, path: &[u8]) -> bool {
        if is_bundled(path) {
            return self.bundled(path).is_some();
        }
        match self.find(path) {
            Some(found) => matches!(found, Some((_, false))),
            None => self.ask_whether_directory(path) == Some(false),
        }
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        if is_bundled(path) {
            return path == BUNDLED_LIBS && self.bundled_libs.is_some();
        }
        match self.find(path) {
            Some(found) => matches!(found, Some((_, true))),
            None => self.ask_whether_directory(path) == Some(true),
        }
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        if is_bundled(path) {
            return path.to_vec();
        }
        self.real_path_of(path)
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        let (mut files, directories) = self.entries(path);
        files.extend(directories);
        files
    }
    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        // Nothing lists them.
        if is_bundled(path) {
            return (Vec::new(), Vec::new());
        }
        match self.directory(path) {
            Directory::Listed(listing) => {
                listing.record_all();
                listing.sorted()
            }
            _ => (Vec::new(), Vec::new()),
        }
    }
    fn is_case_sensitive(&self) -> bool {
        self.case_sensitive
    }
    fn scripts_of_page(&self, page: &[u8]) -> Vec<Vec<u8>> {
        let scripts = self.scripts_of_page.as_ref().map(|of| of(page));
        scripts.unwrap_or_default()
    }
    fn extra_file_extensions(&self) -> &[(Vec<u8>, ScriptKind)] {
        &self.script_kinds_by_extension
    }
    fn next_early_paths(&self) -> Option<Vec<Vec<u8>>> {
        let is_stopped = || self.early_parse_cancelled.as_ref().is_some_and(|cancelled| cancelled.load(Ordering::Relaxed));
        let receiver = self.early_paths.as_ref()?.lock();
        loop {
            if let Some(cache) = &self.shared_directory_cache
                && cache.early_parse_state.load(Ordering::Acquire) == EARLY_PARSE_PAUSE_REQUESTED
            {
                self.store_bundler_sources(receiver.try_iter());
                self.pending_early_paths.lock().clear();
                cache.early_parse_state.store(EARLY_PARSE_PAUSED, Ordering::Release);
                while cache.is_early_parse_paused() && !is_stopped() {
                    std::thread::sleep(Duration::from_micros(200));
                }
            }
            if is_stopped() {
                return None;
            }
            if !self.pending_early_paths.lock().is_empty() {
                break;
            }
            match receiver.recv_timeout(Duration::from_millis(2)) {
                Ok(first) => {
                    let mut batch = vec![first];
                    let deadline = Instant::now() + EARLY_PATH_BATCH_WINDOW;
                    while let Ok(next) = receiver.recv_timeout(deadline.saturating_duration_since(Instant::now())) {
                        batch.push(next);
                    }
                    self.store_bundler_sources(batch.into_iter());
                }
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return None,
            }
        }
        Some(std::mem::take(&mut *self.pending_early_paths.lock()))
    }
    fn builtin_files(&self, loaded: &[Option<Box<Module<'_>>>], atoms: &Interner<'_>) -> Vec<(Vec<u8>, Builtin)> {
        let Some(compiled) = &self.compiled else { return Vec::new() };
        let deferred = self.deferred.get();
        let is_code = |module: &Module<'_>| compiled.code.contains(module.path.text) || deferred.is_some_and(|deferred| deferred.code.contains(module.path.text));
        let entry_points: FxHashSet<&[u8]> = compiled.entry_points.iter().chain(deferred.into_iter().flat_map(|deferred| &deferred.entry_points)).map(Vec::as_slice).collect();
        let is_entry_point = |module: &Module<'_>| entry_points.contains(module.path.text);
        let has = |is_so: &dyn Fn(&Module<'_>) -> bool| -> Vec<bool> { loaded.iter().map(|module| module.as_deref().is_some_and(is_so)).collect() };
        let mut is_compiled = has(&is_code);
        // A bundle has its entry points. Without a bundler, the program is what they lead to.
        let mut pending: Vec<usize> = (0..loaded.len()).filter(|&file| !is_compiled[file] && loaded[file].as_deref().is_some_and(is_entry_point)).collect();
        while let Some(file) = pending.pop() {
            let Some(module) = loaded[file].as_deref().filter(|module| module.hir.kind != FileKind::Declaration) else { continue };
            if !std::mem::replace(&mut is_compiled[file], true) {
                pending.extend(module.edges.iter().map(|edge| edge.idx()));
            }
        }
        let found = crate::builtins::find(loaded, atoms, &is_compiled, compiled.preserves_source_paths, &|count, work| self.parallel(count, work));
        let archive = bun_builtin_syntax::Archive::embedded();
        let modules = found.included.iter().map(|module| (archive.path(module.id).to_vec(), Builtin::Module(module.id, module.loaded_by)));
        let functions = archive.manifest().function_files().iter().map(|file| ([bun_builtin_syntax::VIRTUAL_ROOT, file].concat(), Builtin::Functions));
        let files = modules.chain(functions).collect();
        *compiled.builtin_modules.lock() = Some(found);
        files
    }
    fn loader_entry_points(&self) -> Vec<(u32, bun_sema::hir::ExprId)> {
        let Some(compiled) = &self.compiled else { return Vec::new() };
        compiled.builtin_modules.lock().as_ref().map_or_else(Vec::new, |found| found.loader_entry_sites.clone())
    }
    fn file_loader_entry_points(&self) -> Vec<(u32, bun_sema::hir::ExprId)> {
        let Some(compiled) = &self.compiled else { return Vec::new() };
        compiled.builtin_modules.lock().as_ref().map_or_else(Vec::new, |found| found.file_loader_entry_sites.clone())
    }
    fn is_runtime_commonjs(&self, path: &[u8]) -> Option<bool> {
        let known = &self.compiled.as_ref()?.is_commonjs_code;
        let deferred = self.deferred.get().map(|deferred| &deferred.is_commonjs_code).filter(|deferred| !deferred.is_empty());
        if known.is_empty() && deferred.is_none() {
            return None;
        }
        let key = to_path(path, self.case_sensitive);
        known.get(&key[..]).or_else(|| deferred?.get(&key[..])).copied()
    }
    fn is_deferred_import(&self, importer: &[u8], specifier: &[u8]) -> bool {
        if self.deferred_paths.is_empty() && self.deferred_imports.is_empty() || self.deferred.get().is_some() {
            return false;
        }
        if self.deferred_imports.get(importer).is_some_and(|specifiers| specifiers.iter().any(|it| it == specifier)) {
            return true;
        }
        matches!(specifier.first(), Some(b'.' | b'/')) && self.is_deferred_path(&join(dirname::<Posix>(importer), specifier))
    }
    fn is_deferred_path(&self, path: &[u8]) -> bool {
        !self.deferred_paths.is_empty() && self.deferred.get().is_none() && self.deferred_paths.contains(&*to_path(path, self.case_sensitive))
    }
    fn builtin_import(&self, importer: &[u8], specifier: &[u8]) -> Option<Option<Vec<u8>>> {
        if !self.import_constants.is_empty()
            && let Some(constant) = self.import_constants.get(&(importer.to_vec(), specifier.to_vec()))
        {
            return Some(Some(constant.clone()));
        }
        if let Some(deferred) = self.deferred.get()
            && !deferred.import_constants.is_empty()
            && let Some(constant) = deferred.import_constants.get(&(importer.to_vec(), specifier.to_vec()))
        {
            return Some(Some(constant.clone()));
        }
        let importer = importer.strip_prefix(bun_builtin_syntax::VIRTUAL_ROOT)?;
        let archive = bun_builtin_syntax::Archive::embedded();
        let path = archive.manifest().resolve(specifier, importer).map(|id| archive.path(id));
        // Without the extension, which an import does not name.
        Some(path.and_then(|path| Some(path[..bun_core::strings::last_index_of_char(path, b'.')?].to_vec())))
    }
    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        // They are all written in TypeScript.
        if path.starts_with(bun_builtin_syntax::VIRTUAL_ROOT) {
            return (!is_declaration_file_name(path)).then_some(ScriptKind::Ts);
        }
        let deferred = self.deferred.get().map_or(&[][..], |deferred| &deferred.script_kinds[..]);
        if self.script_kinds.is_empty() && self.script_kinds_by_extension.is_empty() && deferred.is_empty() {
            return None;
        }
        let key = to_path(path, self.case_sensitive);
        if let Some(found) = self.script_kinds.iter().chain(deferred).find(|it| it.0 == *key) {
            return Some(found.1);
        }
        // A declaration file, and what is installed, is what its name says.
        if is_declaration_file_name(path) || contains(path, b"/node_modules/") {
            return None;
        }
        let extension = bun_paths::extension(path);
        let mut by_extension = self.script_kinds_by_extension.iter();
        by_extension.find(|it| it.0 == extension).map(|it| it.1)
    }
    fn parse<'s>(
        &self,
        arena: &'s Arena,
        path: &[u8],
        text: &[u8],
        atoms: &Interner<'s>,
        options: ParseOptions,
    ) -> hir::File<'s> {
        let began = Instant::now();
        let mut file = bun_sema_parser::summarize(
            arena,
            path,
            self.script_kind(path),
            text,
            atoms,
            self.class_options(path).map_or(options.experimental_decorators, |own| own.experimental_decorators),
            options.module_detection == ModuleDetection::Force,
            options.bind.uses_ecmascript_bindings,
        );
        self.spent(Phase::Parse, began.elapsed());
        let deferred_jsx_options = self.deferred.get().map_or(&[][..], |deferred| &deferred.file_jsx_options[..]);
        if !(self.file_jsx_options.is_empty() && deferred_jsx_options.is_empty())
            && let key = to_path(path, self.case_sensitive)
            && let Some((_, of_file)) = self.file_jsx_options.iter().chain(deferred_jsx_options).find(|it| it.0 == *key)
        {
            say_as_pragmas(&mut file.jsx_pragmas, of_file, atoms);
        } else if self.is_without_bundler && !file.jsx.is_empty() {
            bun_sema_parser::read_jsx_pragmas_of_every_comment(&mut file, text, atoms);
            if let Some(own) = self.lowering_of(path) {
                say_as_pragmas(&mut file.jsx_pragmas, &own.0, atoms);
            }
        }
        file
    }
    fn file_timestamps(&self, path: &[u8]) -> Option<[i64; 4]> {
        let is_on_disk = !is_bundled(path) && !self.has_already_read(path) && self.bundler_source(path).is_none() && self.before_read.is_none() && !fs_queries::is_recording();
        is_on_disk.then(|| self.observe(path)).flatten()
    }
    fn has_bundler_source(&self, path: &[u8]) -> bool {
        self.bundler_source(path).is_some()
    }
    fn is_scheduled_by_bundler(&self, path: &[u8]) -> bool {
        self.is_early_pass && self.shared_directory_cache.as_ref().is_some_and(|cache| cache.scheduled_by_bundler.get_ref(&*to_path(path, self.case_sensitive)).is_some())
    }
    fn is_load_abandoned(&self) -> bool {
        self.is_load_abandoned.as_ref().is_some_and(|abandoned| abandoned.load(Ordering::Relaxed))
    }
    fn is_early_parse_cancelled(&self) -> bool {
        self.early_parse_cancelled.as_ref().is_some_and(|cancelled| cancelled.load(Ordering::Relaxed))
            || self.is_early_pass && self.shared_directory_cache.as_ref().is_some_and(|cache| cache.early_parse_state.load(Ordering::Acquire) == EARLY_PARSE_PAUSE_REQUESTED)
    }
    fn uses_default_parse_settings(&self, path: &[u8]) -> bool {
        let deferred = self.deferred.get().map_or(&[][..], |deferred| &deferred.file_jsx_options[..]);
        (self.file_jsx_options.is_empty() && deferred.is_empty() || !self.file_jsx_options.iter().chain(deferred).any(|it| it.0 == *to_path(path, self.case_sensitive))) && self.class_options(path).is_none() && !self.is_without_bundler
    }
    fn class_options(&self, path: &[u8]) -> Option<ClassOptions> {
        let deferred = self.deferred.get().map_or(&[][..], |deferred| &deferred.file_class_options[..]);
        if self.file_class_options.is_empty() && deferred.is_empty() {
            return self.lowering_of(path).filter(|_| !is_javascript_file(self, path)).map(|own| own.1);
        }
        let key = to_path(path, self.case_sensitive);
        self.file_class_options.iter().chain(deferred).find(|it| it.0 == *key).map(|it| it.1)
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_package_json(arena, text)
    }
    fn loaded(&self) {
        // Otherwise the threads go on to parse the files of the next program.
        if self.shares.lock().is_none() {
            self.caches.drop_those_of_the_parser();
        }
    }
    fn is_without_bundler(&self) -> bool {
        self.is_without_bundler
    }
    fn build_constants(&self) -> Option<Arc<bun_sema::fold::BuildConstants>> {
        self.build_constants.clone().or_else(|| self.deferred.get()?.build_constants.clone())
    }
    fn threads(&self) -> usize {
        self.threads
    }
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        // The threads that only read serve one load at a time.
        match *self.shares.lock() {
            Some(_) => None,
            None => self.io_pool.as_deref().filter(|_| !self.is_early_pass),
        }
    }
    fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
        crate::for_each_with_helpers(&self.caches, helpers, count, run_of(count), work);
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        if self.is_of_a_thread_of_the_pool {
            return self.with_helpers(0, count, work);
        }
        let run = run_of(count);
        let shares = self.shares.lock().clone();
        match shares {
            Some(shares) => crate::for_each_with_a_share(&self.caches, &shares, count, run, work),
            None => crate::for_each_parallel_in_runs(&self.caches, self.threads, count, run, work),
        }
    }
}
