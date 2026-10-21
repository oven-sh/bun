//! The checker's view of the file system.
//!
//! The checker's paths are absolute, use `/`, and start with one. `C:\a\b` is represented as `/C:/a/b` on every system.
//! See `resolve::root_length`. Code that puts a path into a message, a printed type or a line of output converts it at
//! that point with `resolve::displayed_path`.

use bun_ast::e::{JsonValue, ObjectJSON};
use bun_core::strings::{
    BOM, contains, contains_char, is_valid_utf8, rsplit_once_char, split_once_char,
    without_trailing_slash,
};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, windows_volume_name_len, z};
use bun_paths::{basename_posix, path_buffer_pool};
use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::json::Json;
use bun_sema::resolve::{
    CachedConfig, Host, ModuleDetection, ParseOptions, Paths, ScriptKind, ancestors,
    case_insensitive_hash, inside, is_declaration_file_name, is_same_path, join, root_length,
    to_file_name_lower_case, to_path, typescript_path,
};
use bun_sema::session::{Arena, Session};
use bun_sema::util::SharedSort;
use bun_sema::util::{FxHashMap, FxHashSet, ShardedMap};
use bun_sys::{EntryKind, ExistsAtType, Fd};
use std::borrow::Cow;
use std::sync::{Arc, OnceLock};

/// TypeScript's `lib.*.d.ts` files embedded in the executable, by name.
#[derive(Copy, Clone)]
pub struct BundledLibs {
    pub has: fn(&[u8]) -> bool,
    pub read: fn(&[u8]) -> Option<Cow<'static, [u8]>>,
}

/// `bundled.LibPath()`, in the checker's path format: the directory that holds the `BundledLibs`. It doesn't exist on
/// disk.
pub const BUNDLED_LIBS: &[u8] = b"/bundled:///libs";

/// `bundled.IsBundled`
pub fn is_bundled(path: &[u8]) -> bool {
    path.starts_with(b"/bundled:")
}

/// `/C:/a` becomes `C:/a`, and `/\\server/share/a` becomes `\\server/share/a`, which Windows accepts.
/// `/bundled:///libs/a` becomes `bundled:///libs/a`, which is how typescript-go prints it. On systems where `C:/a`
/// isn't an absolute path, it's resolved against the working directory, which is where `os.DirFS("C:/")` is
/// (`Common.RootAndPath`).
pub fn to_native(path: &[u8]) -> &[u8] {
    match path {
        [b'/', b'\\', b'\\', ..] if cfg!(windows) => &path[1..],
        _ => typescript_path(path),
    }
}

/// `to_native`, for a system call. Returns `None` if the system can't represent the path, so nothing exists there.
/// Either it's too long, since an import can spell a path with any number of segments, or it contains a NUL, which a
/// configuration file can contain and which would make the system use only the part before it.
fn to_syscall_path(path: &[u8]) -> Option<&[u8]> {
    let native = to_native(path);
    let is_representable = native.len() < bun_paths::MAX_PATH_BYTES && !contains_char(native, 0);
    is_representable.then_some(native)
}

/// A drive's root is `/C:`. The system treats `C:` as the working directory on that drive, so it needs `/C:/`. The same
/// goes for every root except `/`.
fn with_root(path: &[u8]) -> Cow<'_, [u8]> {
    match path.len() > 1 && path.len() == root_length(path) {
        true => Cow::Owned([path, b"/"].concat()),
        false => Cow::Borrowed(path),
    }
}

/// Converts a native path to the checker's path format. It must be absolute.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    let path = join(b"/", bun_paths::string_paths::without_nt_prefix(path));
    // A POSIX path's root is `/`, even if its first name looks like a drive or a URL. See `root_length`.
    match !cfg!(windows) && root_length(&path) > 1 && !path.starts_with(b"//") {
        true => [b"/\0", &path[..]].concat(),
        false => path,
    }
}

/// Converts a command-line path, which is relative to `cwd`. Where `/` is the file system root, a path that begins with
/// it is a native path.
pub fn from_argument(cwd: &[u8], path: &[u8]) -> Vec<u8> {
    match !cfg!(windows) && path.starts_with(b"/") {
        true => from_native(path),
        false => join(cwd, path),
    }
}

#[derive(Copy, Clone)]
struct Entry {
    /// Offset of its name in `Listing::names`.
    start: u32,
    len: u32,
    /// `case_insensitive_hash` of its name.
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
    /// The names, concatenated.
    names: Box<[u8]>,
    /// Sorted by `hash`, so names that differ only in case are adjacent, then by name.
    entries: Box<[Entry]>,
}

/// A [`Listing`] under construction.
#[derive(Default)]
struct Entries {
    names: Vec<u8>,
    entries: Vec<Entry>,
}

/// The result of looking up a name in a [`Listing`].
enum Found<'a> {
    Exact(&'a Entry),
    /// The entry's name differs in case.
    DifferentCase(&'a Entry),
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
            hash: case_insensitive_hash(name) as u32,
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
        // An in-memory entry can have the same name as a link on disk.
        entries.dedup_by(|dropped, kept| {
            let is_same = name(dropped) == name(kept) && dropped.is_directory == kept.is_directory;
            kept.is_link |= is_same && dropped.is_link;
            is_same
        });
        Listing {
            names: names.into_boxed_slice(),
            entries: entries.into_boxed_slice(),
        }
    }
}

enum Directory {
    Missing,
    /// It exists but can't be listed, so its entries have to be queried one by one.
    Unreadable,
    Listed(Listing),
}

impl Listing {
    fn with(self, more: &InMemory) -> Self {
        let mut all = Entries {
            names: self.names.into_vec(),
            entries: self.entries.into_vec(),
        };
        for (names, is_directory) in [(&more.files, false), (&more.directories, true)] {
            for name in names {
                all.push(name, is_directory, false);
            }
        }
        all.finish()
    }

    fn name(&self, entry: &Entry) -> &[u8] {
        entry.name_in(&self.names)
    }

    fn look_up(&self, name: &[u8]) -> Found<'_> {
        let hash = case_insensitive_hash(name) as u32;
        let from = self.entries.partition_point(|it| it.hash < hash);
        let with_hash = || self.entries[from..].iter().take_while(|it| it.hash == hash);
        if let Some(exact) = with_hash().find(|it| self.name(it) == name) {
            return Found::Exact(exact);
        }
        let different_case = with_hash().find(|it| is_same_path(self.name(it), name, false));
        different_case.map_or(Found::Nothing, Found::DifferentCase)
    }

    /// Returns the name as spelled in the directory, which may differ in case.
    fn find(&self, name: &[u8]) -> Option<&[u8]> {
        match self.look_up(name) {
            Found::Exact(entry) | Found::DifferentCase(entry) => Some(self.name(entry)),
            Found::Nothing => None,
        }
    }

    /// Returns the files and the directories, each sorted by name.
    fn sorted(&self) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        let names_of_kind = |is_directory: bool| {
            let entries = self
                .entries
                .iter()
                .filter(|it| it.is_directory == is_directory);
            let mut names: Vec<Vec<u8>> = entries.map(|it| self.name(it).to_vec()).collect();
            names.shared_sort_unstable();
            names
        };
        (names_of_kind(false), names_of_kind(true))
    }
}

/// The disk. A directory is read once. Existence, entry kind and real path are answered from the cached directory
/// listings, without a system call. Resolving a project's imports queries the same few directories repeatedly, mostly
/// for entries that don't exist.
pub struct Disk {
    pub threads: usize,
    /// `Some` while several programs are read through it at the same time.
    pub(crate) shares: bun_threading::Guarded<Option<Arc<crate::Shares>>>,
    pub(crate) caches: crate::ThreadCaches,
    /// True if a pool thread created this `Disk`. All the other pool threads may be blocked on the work it was created
    /// for, so nothing may wait for them, not even the threads that a request starts to coordinate its projects.
    created_on_pool_thread: bool,
    case_sensitive: bool,
    /// Threads that request the same directory at the same time wait for the first one to read it.
    directories: ShardedMap<Vec<u8>, OnceLock<Directory>>,
    /// See `started_in`.
    working_directory: Vec<u8>,
    /// The real path of each directory that was queried.
    real_directories: ShardedMap<Vec<u8>, Vec<u8>>,
    /// On macOS, opening and reading files slows down with the number of concurrent threads by more than the
    /// parallelism gains: 16 threads take six times as long for the same files as 4 do. So only a few readers are
    /// admitted at a time. `io_pool` already has few threads. This limits what the other threads read: `package.json`
    /// and configuration files.
    reader_limit: Option<bun_threading::Semaphore>,
    /// `Host::io_pool`
    io_pool: Option<bun_threading::io_thread_pool::Ref>,
    /// Readers that aren't in use, least recently used first.
    idle_readers: bun_threading::Guarded<Vec<Reader>>,
    /// See `Host::take_unreadable`.
    unreadable: bun_threading::Guarded<Vec<Vec<u8>>>,
    /// See `AlreadyRead`. Keyed by `tspath.Path`, so such a file is found however its name is spelled, like a file on
    /// disk.
    already_read: AlreadyRead,
    /// The entries that `already_read` adds to a directory's listing, by the directory's `tspath.Path`.
    in_memory: FxHashMap<Vec<u8>, InMemory>,
    /// `Provided::keeps_byte_order_marks`
    pub(crate) keeps_byte_order_marks: bool,
    /// `Provided::ends_the_process`
    pub(crate) ends_the_process: bool,
    /// `Host::drop_before_the_process_ends`
    pub(crate) to_drop_before_the_process_ends: bun_threading::Guarded<Vec<Session>>,
    /// The contents of `BUNDLED_LIBS`.
    pub bundled_libs: Option<BundledLibs>,
    /// `Host::script_kind`, by `tspath.Path`.
    pub(crate) script_kinds: Vec<(Vec<u8>, ScriptKind)>,
    /// `Request::script_kinds_by_extension`
    pub(crate) script_kinds_by_extension: Vec<(Vec<u8>, ScriptKind)>,
    pub(crate) before_read: Option<BeforeRead>,
    /// `Host::extended_config`. The projects of a build often extend the same file.
    extended_configs: bun_threading::Guarded<FxHashMap<Vec<u8>, CachedConfig>>,
    /// `Host::shared_paths`
    paths: bun_threading::Guarded<FxHashSet<Arc<Paths>>>,
    pub(crate) scripts_of_page: Option<ScriptsOfPage>,
}

/// The text of files that the check's caller has already read, by path in the checker's format, as UTF-8, without a
/// byte order mark unless `Provided::keeps_byte_order_marks`. These files aren't opened. Several programs may read
/// them. `bun build --check` passes what the bundler has read.
pub type AlreadyRead = FxHashMap<Vec<u8>, Vec<u8>>;

/// Called with a file's path, in the checker's format, right before the file is read, on the thread that reads it. A
/// caller that starts watching the file at that point sees every change to what's checked.
pub type BeforeRead = Box<dyn Fn(&[u8]) + Send + Sync>;

/// `Host::scripts_of_page`. The paths are in the checker's format.
pub type ScriptsOfPage = Box<dyn Fn(&[u8]) -> Vec<Vec<u8>> + Send + Sync>;

/// The inputs that a check's caller provides to its host.
#[derive(Default)]
pub struct Provided {
    pub already_read: AlreadyRead,
    pub before_read: Option<BeforeRead>,
    pub scripts_of_page: Option<ScriptsOfPage>,
    /// A script's text keeps the UTF-8 byte order mark at the start of the file, which TypeScript drops. The parser
    /// treats it as whitespace. `bun lint` has a rule about it, and writes the text back.
    pub keeps_byte_order_marks: bool,
    /// The caller exits the process when `check_provided_then` returns, like `bun check`. Never set this in a process
    /// that continues, like one that calls `Bun.build`, watches files, or runs a program or tests after the check. See
    /// `Session::drop_before_the_process_ends`.
    pub ends_the_process: bool,
}

/// For one directory, the names of the `AlreadyRead` files in it and of its subdirectories that lead to such files.
/// These files need not be on disk (`files` of `Bun.build`), and they're found, listed and resolved like files that
/// are.
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
            // A directory is added to its parent when it gets its first entry.
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

/// Reusable state for reading files. Owned by the [`Disk`], so every directory handle is closed when the `Disk` is
/// dropped.
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

/// The number of threads that read concurrently on macOS, where opening a file takes locks that all threads contend on.
/// With 16 threads and 45,000 files, 4 to 10 perform equally when the system opens files quickly. When it's slow, which
/// is intermittent, 5 or 6 perform best.
const READERS: usize = 6;

/// One of the few slots for reading a file.
struct ReadSlot<'a>(&'a bun_threading::Semaphore);

impl<'a> ReadSlot<'a> {
    fn wait_for(read_slots: &'a bun_threading::Semaphore) -> ReadSlot<'a> {
        read_slots.wait();
        ReadSlot(read_slots)
    }
}

impl Drop for ReadSlot<'_> {
    fn drop(&mut self) {
        self.0.post();
    }
}

/// Returns the full contents of the file `name` in `directory`.
fn read_file(directory: Fd, name: &[u8], buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    /// Few files are bigger.
    const FIRST_READ: usize = 64 * 1024;
    let file = bun_sys::File::openat(directory, name, bun_sys::O::RDONLY, 0).ok()?;
    buffer.resize(FIRST_READ, 0);
    // Reads until the end of the file, because some file systems return less than is available.
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

/// `decodeBytes`: returns a file's text, decoded according to its byte order mark. `BOM` doesn't support big endian, so
/// the byte pairs are swapped first. `keeps_mark`: a UTF-8 mark stays in the text.
fn decoded(mut bytes: Vec<u8>, keeps_mark: bool) -> Cow<'static, [u8]> {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        for pair in bytes.as_chunks_mut::<2>().0 {
            pair.swap(0, 1);
        }
    }
    Cow::Owned(match BOM::detect(&bytes) {
        Some(BOM::Utf8) if keeps_mark => bytes,
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(bytes),
        // `BOM::detect` needs three bytes. A file with only a UTF-16 byte order mark is empty.
        None if bytes == [0xFF, 0xFE] => Vec::new(),
        None => bytes,
    })
}

/// Converts the bytes of the file at `path` the way a [`Disk`] does, which is the form [`AlreadyRead`] expects.
pub fn as_read(path: &[u8], bytes: Vec<u8>, keeps_byte_order_marks: bool) -> Vec<u8> {
    let keeps_mark = keeps_byte_order_marks && ScriptKind::from_file_name(path).is_some();
    decoded(bytes, keeps_mark).into_owned()
}

/// `vfs.FS.ReadFile` for the file at `path`, opened by its full path.
pub(crate) fn read_at(path: &[u8], keeps_mark: bool) -> Option<Cow<'static, [u8]>> {
    let bytes = bun_sys::File::read_from(Fd::cwd(), to_syscall_path(path)?);
    bytes.ok().map(|bytes| decoded(bytes, keeps_mark))
}

/// The two parts of a path.
struct Split<'a> {
    /// The parent directory.
    parent: &'a [u8],
    /// The base name.
    name: &'a [u8],
}

/// `GetDirectoryPath`, `GetBaseFileName`. A root is its own directory and has no name.
fn split(path: &[u8]) -> Split<'_> {
    let parent = dirname::<Posix>(path);
    // `parent` only ends with a separator when it was cut out of a root.
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

/// Returns true if `path` is a directory and false if it's a regular file, following symlinks. Returns `None` if it
/// doesn't exist or is neither. `FileExists` and `GetAccessibleEntries` only accept regular files, because reading a
/// FIFO or a device can block forever.
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
            keeps_byte_order_marks: false,
            ends_the_process: false,
            to_drop_before_the_process_ends: Default::default(),
            extended_configs: Default::default(),
            paths: Default::default(),
            caches: Default::default(),
            created_on_pool_thread: !bun_threading::thread_pool::Thread::current().is_null(),
            case_sensitive,
            directories: ShardedMap::default(),
            working_directory: Vec::new(),
            real_directories: ShardedMap::default(),
            reader_limit: cfg!(target_os = "macos").then(|| {
                let read_slots = bun_threading::Semaphore::default();
                for _ in 0..READERS {
                    read_slots.post();
                }
                read_slots
            }),
            // The bundler's condition, plus the same threshold for this check's own threads.
            io_pool: (threads > 3 && bun_threading::io_thread_pool::uses_io_pool())
                .then(|| bun_threading::io_thread_pool::acquire().into()),
            idle_readers: bun_threading::Guarded::new(Vec::new()),
            unreadable: bun_threading::Guarded::new(Vec::new()),
            bundled_libs: None,
            script_kinds: Vec::new(),
            script_kinds_by_extension: Vec::new(),
            before_read: None,
            scripts_of_page: None,
        }
    }

    /// Returns the name of the file at `path` in `bundled_libs`, if it's there.
    fn bundled<'a>(&self, path: &'a [u8]) -> Option<(BundledLibs, &'a [u8])> {
        let name = path.strip_prefix(BUNDLED_LIBS)?.strip_prefix(b"/")?;
        self.bundled_libs
            .filter(|libs| (libs.has)(name))
            .map(|libs| (libs, name))
    }

    /// Returns an idle reader whose last read was from `directory`. Otherwise returns a new one, or the least recently
    /// used one once enough are retained.
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

    /// True if the entries of `path` are queried from the system every time. That's the case for the roots, which
    /// aren't directories on Windows. Neither is a server, and `C:` means the working directory on that drive.
    fn is_never_listed(path: &[u8]) -> bool {
        // `(length, 0)`: a drive, or a server without a share.
        let is_volume = |path: &[u8]| {
            let native = to_native(path);
            windows_volume_name_len(native) == (native.len(), 0)
        };
        path.is_empty() || cfg!(windows) && (path == b"/" || is_volume(path))
    }

    fn directory(&self, path: &[u8]) -> &Directory {
        // `SplitPath` drops a trailing separator after the root.
        let path = match path.ends_with(b"/") {
            true => &path[..without_trailing_slash(path).len().max(root_length(path))],
            false => path,
        };
        // The parent directory isn't read just for this, because a project can sit in a directory with any number of
        // other entries.
        let cell = match self.directories.get_ref(path) {
            Some(known) => known,
            None => (self.directories).insert_ref(path.to_vec(), OnceLock::new()),
        };
        cell.get_or_init(|| {
            let known = self.known_directory(split(path).parent);
            self.read_directory(path, known.unwrap_or(&Directory::Unreadable))
        })
    }

    /// Returns the directory at `path`, to look up an entry in. Returns `None` if the system has to be queried about
    /// the entry. Directories above the working directory aren't read for a lookup. They're only queried for a
    /// `node_modules`, a `package.json` and little else, and reading one takes time proportional to its entries. A
    /// project can sit in a directory with any number of others.
    fn directory_for_lookup(&self, path: &[u8]) -> Option<&Directory> {
        let rest = self.working_directory.strip_prefix(path);
        let is_above =
            rest.is_some_and(|it| it.starts_with(b"/") || !it.is_empty() && path.ends_with(b"/"));
        match is_above {
            true => self.known_directory(path),
            false => Some(self.directory(path)),
        }
    }

    /// Returns the directory at `path`, if it has been read.
    fn known_directory(&self, path: &[u8]) -> Option<&Directory> {
        self.directories.get_ref(path)?.get()
    }

    /// Reads the directory at `path`, which is in `parent`.
    fn read_directory(&self, path: &[u8], parent: &Directory) -> Directory {
        // An entry that its parent doesn't list doesn't exist, so no system call is needed.
        if let Directory::Listed(listing) = parent
            && let Some(found) = self.find_in(listing, split(path).name)
            && !matches!(found, Some((_, true)))
        {
            return Directory::Missing;
        }
        match (list(path), self.in_memory_entries_of(path)) {
            (read, None) | (read @ Directory::Unreadable, _) => read,
            (Directory::Listed(listing), Some(more)) => Directory::Listed(listing.with(more)),
            (Directory::Missing, Some(more)) => Directory::Listed(Listing::default().with(more)),
        }
    }

    /// Returns the entries that `already_read` adds to the directory at `path`.
    fn in_memory_entries_of(&self, path: &[u8]) -> Option<&InMemory> {
        match self.in_memory.is_empty() {
            true => None,
            false => self.in_memory.get(&*to_path(path, self.case_sensitive)),
        }
    }

    /// For a path that `already_read` adds, returns whether it's a directory.
    fn find_in_memory(&self, path: &[u8]) -> Option<bool> {
        let Split { parent, name } = split(path);
        let names = self.in_memory_entries_of(parent)?;
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
    }

    /// Checks the in-memory entries first, then queries the system, which doesn't know about them.
    fn query_is_directory(&self, path: &[u8]) -> Option<bool> {
        self.find_in_memory(path)
            .or_else(|| is_directory(Fd::cwd(), to_syscall_path(&with_root(path))?))
    }

    /// `None`: the system has to be queried.
    fn find(&self, path: &[u8]) -> Option<Option<(&[u8], bool)>> {
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_never_listed(parent) {
            return None;
        }
        match self.directory_for_lookup(parent)? {
            Directory::Missing => Some(None),
            Directory::Unreadable => None,
            Directory::Listed(listing) => self.find_in(listing, name),
        }
    }

    /// `Listing::find`. Returns `None` if the system has to be queried, which happens in three cases. The name is
    /// listed in another spelling, and that directory's file system may treat the two as equal whatever the project's
    /// file system does, since a project can span several. Or the name has non-ASCII letters, which a file system folds
    /// and normalizes by its own rules: for APFS, U+017F is `s`, and a composed letter equals the decomposed one,
    /// case-sensitive or not. Or it may be a short name.
    fn find_in<'a>(&self, listing: &'a Listing, name: &[u8]) -> Option<Option<(&'a [u8], bool)>> {
        match listing.look_up(name) {
            Found::DifferentCase(_) if self.case_sensitive => None,
            Found::Exact(entry) | Found::DifferentCase(entry) => {
                Some(Some((listing.name(entry), entry.is_directory)))
            }
            Found::Nothing if !name.is_ascii() || looks_like_short_name(name) => None,
            Found::Nothing => Some(None),
        }
    }

    fn query_real_path(path: &[u8]) -> Vec<u8> {
        let rooted = with_root(path);
        let Some(native) = to_syscall_path(&rooted) else {
            return path.to_vec();
        };
        let (mut name, mut real) = (path_buffer_pool::get(), path_buffer_pool::get());
        bun_sys::realpath(z(native, &mut name), &mut real)
            .map_or_else(|_| path.to_vec(), from_native)
    }

    /// Returns `path` with every name in it spelled the way its directory lists it. Links aren't followed.
    pub fn with_on_disk_casing(&self, path: &[u8]) -> Vec<u8> {
        if self.case_sensitive {
            return path.to_vec();
        }
        // The names that can appear in a listing, last one first, and the prefix above them.
        let mut names = Vec::new();
        let mut above = path;
        loop {
            let Split { parent, name } = split(above);
            if name.is_empty() || Self::is_never_listed(parent) {
                break;
            }
            names.push((parent, name));
            above = parent;
        }
        let mut spelled = above.to_vec();
        // Nothing inside a directory that doesn't exist is queried.
        let mut exists = true;
        for (parent, name) in names.into_iter().rev() {
            let found = match exists.then(|| self.directory(parent)) {
                Some(Directory::Listed(listing)) => listing.find(name),
                Some(Directory::Missing) => {
                    exists = false;
                    None
                }
                Some(Directory::Unreadable) | None => None,
            };
            if !spelled.ends_with(b"/") {
                spelled.push(b'/');
            }
            spelled.extend_from_slice(found.unwrap_or(name));
        }
        spelled
    }

    /// `path` must exist.
    fn real_path_of(&self, path: &[u8]) -> Vec<u8> {
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_never_listed(parent) {
            return Self::query_real_path(path);
        }
        let Some(Directory::Listed(listing)) = self.directory_for_lookup(parent) else {
            return Self::query_real_path(path);
        };
        let Some(found) = self.find_in(listing, name) else {
            return Self::query_real_path(path);
        };
        let Some((listed_name, _)) = found else {
            return path.to_vec();
        };
        if matches!(listing.look_up(listed_name), Found::Exact(it) if it.is_link) {
            return Self::query_real_path(path);
        }
        let real_parent = match self.real_directories.get_ref(parent) {
            Some(known) => known,
            None => {
                let above = split(parent).parent;
                // A root is its own real path. See `root_length` for the second one.
                let real = if matches!(parent, b"/" | b"/\0") {
                    parent.to_vec()
                } else if self.known_directory(above).is_some() {
                    self.real_path_of(parent)
                } else {
                    Self::query_real_path(parent)
                };
                self.real_directories.insert_ref(parent.to_vec(), real)
            }
        };
        if real_parent == b"/" {
            [&b"/"[..], listed_name].concat()
        } else {
            inside(real_parent, listed_name)
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

/// True if `name` looks like the alternate name that NTFS and FAT give an entry whose own name isn't 8.3: `PROGRA~1`
/// for `Program Files`, `RUNNER~1` for `runneradmin`. The entry can be opened by that name, but no listing has it.
fn looks_like_short_name(name: &[u8]) -> bool {
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
    let rooted = with_root(path);
    let Some(native) = to_syscall_path(&rooted) else {
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
            // A symlink has to be followed, unless the listing already tells what it points to. It may be dangling.
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

/// `isFileSystemCaseSensitive`, for the file system that holds `path`. True if an entry on it can no longer be found
/// after swapping the case of its name. TypeScript tests its own file, which is in the project.
fn is_file_system_case_sensitive(path: &[u8]) -> bool {
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
    // `[eval]` only exists in memory, so no spelling of its name is found.
    let exists_on_disk = |it: &&[u8]| to_syscall_path(it).is_some_and(bun_sys::exists);
    let Some(path) = ancestors(path).find(exists_on_disk) else {
        return true;
    };
    // A directory's entries are on its file system. Its own name isn't if it's that file system's mount point, like
    // `/app` in a container.
    if let Directory::Listed(listing) = list(path) {
        let mut names = listing.entries.iter().map(|it| listing.name(it));
        if let Some(other) = names.find_map(swapped) {
            return !bun_sys::exists(to_native(&inside(path, &other)));
        }
    }
    // Swaps only the last name, because the directories above it can be on another file system, like `/mnt` for
    // `/mnt/c`.
    for path in ancestors(path) {
        let Split { parent, name } = split(path);
        if let Some(other) = swapped(name) {
            return !bun_sys::exists(to_native(&inside(parent, &other)));
        }
    }
    true
}

/// `jsonwire.ConsumeWhitespace`: returns the offset after the whitespace at `n` in `b`.
fn consume_whitespace(b: &[u8], mut n: usize) -> usize {
    while matches!(b.get(n), Some(b' ' | b'\t' | b'\r' | b'\n')) {
        n += 1;
    }
    n
}

/// `jsonwire.ConsumeLiteral`: returns the end of `lit`, if it's at `n` in `b`.
fn consume_literal(b: &[u8], n: usize, lit: &[u8]) -> Option<usize> {
    b[n..].starts_with(lit).then_some(n + lit.len())
}

/// `parseHexUint16`, for four bytes.
fn parse_hex_uint16(b: &[u8]) -> Option<u16> {
    let mut v = 0;
    for &c in b {
        v = v * 16 + (c as char).to_digit(16)? as u16;
    }
    Some(v)
}

/// `jsonwire.ConsumeString`: returns the end of the string that starts at `n` in `b`, which is valid UTF-8.
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

/// `jsonwire.ConsumeNumber`: returns the end of the number that starts at `n` in `b`.
fn consume_number(b: &[u8], mut n: usize) -> Option<usize> {
    // At least one digit.
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

/// `consumeValue`, with `consumeObject` and `consumeArray`: returns the end of the value at `n` in `b`.
fn consume_value(b: &[u8], mut n: usize) -> Option<usize> {
    /// `maxNestingDepth`
    const MAX_NESTING_DEPTH: usize = 10000;
    // The closing delimiter of each object and array that `n` is inside.
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
        // After a value comes a comma or the end of the enclosing object or array, which is a value too.
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

/// `actualJSONType` of `data`, as an empty value of that type.
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

/// `json.Unmarshal(data, &e.Value)`, without `AllowDuplicateNames`, for an object and a map. The map keeps its existing
/// entries. Decoding stops at a member that is neither a string nor `null`, whose name it still inserts, and at a
/// repeated name. In that case this returns `value` with that name repeated at the end.
fn unmarshal_map(
    object: &ObjectJSON,
    has_duplicates: bool,
    value: &mut Vec<(Vec<u8>, Json)>,
) -> Option<Json> {
    let properties = object.properties();
    let existing_len = value.len();
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
            match value[..existing_len]
                .iter_mut()
                .find(|known| known.0 == name)
            {
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
            let mut rejected = value.clone();
            rejected.push((name.to_vec(), actual_json_type(&property.value)));
            return Some(Json::Object(rejected));
        }
    }
    None
}

/// `packagejson.Expected[T]`
#[derive(Default)]
struct Expected {
    /// A value of `actualJSONType` that isn't a `T`.
    actual: Option<Json>,
    null: bool,
    valid: bool,
    value: Option<Json>,
}

impl Expected {
    /// `Expected.UnmarshalJSON`. `T` is `map[string]string` or `string`.
    fn unmarshal_json(&mut self, data: &JsonValue, is_map: bool, has_duplicates: bool) {
        let rejected = match data {
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
                let rejected = unmarshal_map(object.get(), has_duplicates, &mut value);
                self.value = Some(Json::Object(value));
                rejected
            }
            _ => Some(actual_json_type(data)),
        };
        match rejected {
            None => self.valid = true,
            Some(_) => self.actual = rejected,
        }
    }
}

/// `unmarshalJSONValueV2`. Returns `None` if `strconv.ParseFloat` returns `ErrRange` for a number, or if the stack,
/// which grows in Go, is exhausted.
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
                // `OrderedMap.Set`: the last value, at the first one's position.
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

/// `json.Unmarshal(data, &f, json.AllowDuplicateNames(true))` for an object. Returns `Fields`, in the form of
/// `Host::parse_package_json`. Every value of a repeated name is decoded into the same field.
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
            b"typesVersions" | b"imports" | b"exports" => {
                let value = unmarshal_json_value(data, has_duplicates)?;
                let known = has_duplicates.then(|| fields.iter_mut().find(|it| it.0 == name));
                match known.flatten() {
                    Some((_, known)) => {
                        // `json.UnmarshalDecode(dec, &v.Value)`, which decodes a string, a boolean and a number,
                        // decodes into the type of the value that `v.Value` already holds.
                        let has_same_type = matches!(known, Json::Null)
                            || matches!(value, Json::Null | Json::Array(_) | Json::Object(_))
                            || std::mem::discriminant(&*known) == std::mem::discriminant(&value);
                        if !has_same_type {
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
        let (first_value, value) = match field.valid {
            true => (field.value, None),
            false if matches!(field.actual, Some(Json::Object(_))) => (field.actual, None),
            false => (field.actual, field.value),
        };
        let null = (field.null && first_value != Some(Json::Null)).then_some(Json::Null);
        let values = first_value.into_iter().chain(null).chain(value);
        fields.extend(values.map(|it| (name.to_vec(), it)));
    }
    Some(Json::Object(fields))
}

/// `packagejson.Parse`. Bun's JSON parser, which builds the values, also accepts input that isn't JSON, so the text is
/// validated first.
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

/// The disk, for a few queries across many directories. Each query is a system call, and no directory is listed or
/// cached for it. A `Disk` lists the directory of whatever it's queried about, which pays off when most of the
/// directory is queried.
#[derive(Copy, Clone)]
pub(crate) struct UncachedDisk<'k> {
    /// `Host::extended_config`
    pub(crate) extended: Option<&'k bun_threading::Guarded<FxHashMap<Vec<u8>, CachedConfig>>>,
    pub(crate) is_case_sensitive: bool,
    /// If false, every directory looks empty, so a configuration file's `include` finds nothing.
    pub(crate) lists: bool,
}

impl UncachedDisk<'_> {
    /// `project`: a path in the project, in the checker's path format.
    pub(crate) fn new(project: &[u8]) -> UncachedDisk<'static> {
        UncachedDisk {
            extended: None,
            is_case_sensitive: is_file_system_case_sensitive(project),
            lists: false,
        }
    }

    fn is_directory(path: &[u8]) -> Option<bool> {
        is_directory(Fd::cwd(), to_syscall_path(&with_root(path))?)
    }
}

impl Host for UncachedDisk<'_> {
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        read_at(path, false)
    }
    fn extended_config(&self, path: &[u8]) -> Option<CachedConfig> {
        self.extended?.lock().get(path).cloned()
    }
    fn cache_extended_config(&self, path: &[u8], parsed: &dyn Fn() -> CachedConfig) {
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
        Disk::query_real_path(path)
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        match self.lists.then(|| list(path)) {
            Some(Directory::Listed(listing)) => {
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
        )
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_package_json(arena, text)
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        (0..count).for_each(work);
    }
}

/// Number of consecutive indices a thread of a parallel region takes at a time. Adjacent paths are in the same
/// directory.
fn chunk_len_for(count: usize) -> usize {
    if count > 1024 { 16 } else { 1 }
}

impl Host for Disk {
    fn extended_config(&self, path: &[u8]) -> Option<CachedConfig> {
        self.extended_configs.lock().get(path).cloned()
    }
    fn cache_extended_config(&self, path: &[u8], parsed: &dyn Fn() -> CachedConfig) {
        self.extended_configs.lock().insert(path.to_vec(), parsed());
    }
    fn shared_paths(&self, paths: Arc<Paths>) -> Arc<Paths> {
        let mut interned = self.paths.lock();
        if let Some(equal) = interned.get(&paths) {
            return Arc::clone(equal);
        }
        interned.insert(Arc::clone(&paths));
        paths
    }
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        if !self.already_read.is_empty()
            && let Some(text) = (self.already_read).get(&*to_path(path, self.case_sensitive))
        {
            return Some(Cow::Owned(text.clone()));
        }
        if is_bundled(path) {
            let (libs, name) = self.bundled(path)?;
            return (libs.read)(name);
        }
        if let Some(before_read) = &self.before_read {
            before_read(path);
        }
        to_syscall_path(path)?;
        let Split { parent, name } = split(path);
        // Config files and `package.json` are read as JSON, so they never keep the mark.
        let keeps_mark = self.keeps_byte_order_marks && ScriptKind::from_file_name(path).is_some();
        if name.is_empty() || Self::is_never_listed(parent) {
            return read_at(path, keeps_mark);
        }
        let _turn = self.reader_limit.as_ref().map(ReadSlot::wait_for);
        let mut reader = self.take_reader(parent);
        // The second and later files read from a directory are opened relative to the directory. An absolute path makes
        // the kernel look up every directory on the way again, and all threads contend on the ones near the root. For a
        // single file, opening the directory costs that walk and more.
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
        read.map(|bytes| decoded(bytes, keeps_mark))
    }
    fn read_source(&self, path: &[u8]) -> Cow<'static, [u8]> {
        self.read(path).unwrap_or_else(|| {
            self.unreadable.lock().push(path.to_vec());
            Cow::default()
        })
    }
    fn take_unreadable(&self) -> Vec<Vec<u8>> {
        std::mem::take(&mut *self.unreadable.lock())
    }
    fn is_file(&self, path: &[u8]) -> bool {
        if is_bundled(path) {
            return self.bundled(path).is_some();
        }
        match self.find(path) {
            Some(found) => matches!(found, Some((_, false))),
            None => self.query_is_directory(path) == Some(false),
        }
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        if is_bundled(path) {
            return path == BUNDLED_LIBS && self.bundled_libs.is_some();
        }
        match self.find(path) {
            Some(found) => matches!(found, Some((_, true))),
            None => self.query_is_directory(path) == Some(true),
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
        // Nothing needs a listing of the bundled libs.
        if is_bundled(path) {
            return (Vec::new(), Vec::new());
        }
        match self.directory(path) {
            Directory::Listed(listing) => listing.sorted(),
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
    fn script_kind(&self, path: &[u8]) -> Option<ScriptKind> {
        if self.script_kinds.is_empty() && self.script_kinds_by_extension.is_empty() {
            return None;
        }
        let key = to_path(path, self.case_sensitive);
        if let Some(found) = self.script_kinds.iter().find(|it| it.0 == *key) {
            return Some(found.1);
        }
        // A declaration file or an installed file has the kind its name implies.
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
        bun_sema_parser::summarize(
            arena,
            path,
            self.script_kind(path),
            text,
            atoms,
            options.experimental_decorators,
            options.module_detection == ModuleDetection::Force,
        )
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_package_json(arena, text)
    }
    fn loaded(&self) {
        // With shares, the threads continue with the next program's files, so they keep the parser's caches.
        if self.shares.lock().is_none() {
            self.caches.drop_parser_caches();
        }
    }
    fn threads(&self) -> usize {
        self.threads
    }
    fn ends_the_process(&self, has_a_run: bool) -> bool {
        self.ends_the_process && !has_a_run
    }
    fn drop_before_the_process_ends(&self, session: Session) {
        self.to_drop_before_the_process_ends.lock().push(session);
    }
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        // The I/O threads serve one load at a time.
        match *self.shares.lock() {
            Some(_) => None,
            None => self.io_pool.as_deref(),
        }
    }
    fn with_helpers(&self, helpers: usize, count: usize, work: &(dyn Fn(usize) + Sync)) {
        crate::for_each_with_helpers(&self.caches, helpers, count, chunk_len_for(count), work);
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        if self.created_on_pool_thread {
            return self.with_helpers(0, count, work);
        }
        let run = chunk_len_for(count);
        let shares = self.shares.lock().clone();
        match shares {
            Some(shares) => crate::for_each_with_share(&self.caches, &shares, count, run, work),
            None => crate::for_each_parallel_in_runs(&self.caches, self.threads, count, run, work),
        }
    }
    fn parallel_while(
        &self,
        count: usize,
        work: &(dyn Fn(usize) + Sync),
        meanwhile: &mut dyn FnMut(),
    ) {
        // In these cases the calling thread is one of the workers.
        if self.created_on_pool_thread || self.shares.lock().is_some() {
            self.parallel(count, work);
            return meanwhile();
        }
        let run = chunk_len_for(count);
        crate::for_each_parallel_while(&self.caches, self.threads, count, run, work, meanwhile);
    }
}
