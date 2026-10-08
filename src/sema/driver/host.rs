//! The checker's view of the file system.
//!
//! The checker's paths are absolute, use `/`, and start with one. It represents `C:\a\b` as
//! `/C:/a/b`, on every system: see `resolve::root_length`. Whoever puts a path into a message, a
//! printed type or a line of output converts it there, with `resolve::displayed_path`.

use bun_ast::e::{JsonValue, ObjectJSON};
use bun_core::strings::{BOM, contains, is_valid_utf8, without_trailing_slash};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, windows_volume_name_len, z};
use bun_paths::{basename_posix, path_buffer_pool};
use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::json::Json;
use bun_sema::resolve::{
    Host, ModuleDetection, Options, Phase, ScriptKind, Spent, ancestors, inside,
    is_declaration_file_name, join, root_length, to_file_name_lower_case, to_path, typescript_path,
};
use bun_sema::session::Arena;
use bun_sema::util::{FxHashMap, ShardedMap};
use bun_sys::{EntryKind, ExistsAtType, Fd};
use std::borrow::Cow;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
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

/// The entries of a directory. The names are sorted.
#[derive(Default)]
struct Listing {
    files: Vec<Vec<u8>>,
    directories: Vec<Vec<u8>>,
    /// The entries of either kind that are symlinks.
    links: Vec<Vec<u8>>,
    /// All names lowercased, each with its original spelling and whether it is a directory: for a
    /// case-insensitive file system. Built lazily, the first time an exact-case lookup fails.
    folded: OnceLock<Vec<(Vec<u8>, Vec<u8>, bool)>>,
}

enum Directory {
    Missing,
    /// It exists but cannot be listed: its entries have to be queried one by one.
    Unreadable,
    Listed(Listing),
}

impl Listing {
    fn with(mut self, more: &InMemory) -> Self {
        for (names, more) in [
            (&mut self.files, &more.files),
            (&mut self.directories, &more.directories),
        ] {
            names.extend_from_slice(more);
            names.sort_unstable();
            names.dedup();
        }
        self
    }

    /// The name as spelled in the directory, and whether it is a directory.
    fn find(&self, name: &[u8], case_sensitive: bool) -> Option<(&[u8], bool)> {
        if let Ok(i) = self.files.binary_search_by(|n| n.as_slice().cmp(name)) {
            return Some((&self.files[i], false));
        }
        if let Ok(i) = self
            .directories
            .binary_search_by(|n| n.as_slice().cmp(name))
        {
            return Some((&self.directories[i], true));
        }
        if case_sensitive {
            return None;
        }
        let folded = self.folded.get_or_init(|| {
            let mut all: Vec<(Vec<u8>, Vec<u8>, bool)> = self
                .files
                .iter()
                .map(|n| (to_file_name_lower_case(n), n.clone(), false))
                .chain(
                    self.directories
                        .iter()
                        .map(|n| (to_file_name_lower_case(n), n.clone(), true)),
                )
                .collect();
            all.sort_unstable();
            all
        });
        let lower = to_file_name_lower_case(name);
        let i = folded
            .binary_search_by(|n| n.0.as_slice().cmp(&lower))
            .ok()?;
        Some((&folded[i].1, folded[i].2))
    }
}

/// The disk. A directory is read once: existence, entry kind and real path are answered from the
/// cached directory listings, without a system call. Resolving the imports of a project queries the
/// same few directories repeatedly, mostly for entries that do not exist.
pub struct Disk {
    pub threads: usize,
    pub(crate) caches: crate::ThreadCaches,
    case_sensitive: bool,
    directories: ShardedMap<Vec<u8>, Directory>,
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
    /// See `AlreadyRead`.
    already_read: AlreadyRead,
    /// What `already_read` adds to the listing of a directory, by the path of the directory.
    in_memory: FxHashMap<Vec<u8>, InMemory>,
    /// `Host::times`, in nanoseconds.
    times: [AtomicU64; Phase::ALL.len()],
    /// What is in `BUNDLED_LIBS`.
    pub bundled_libs: Option<BundledLibs>,
    /// `Host::script_kind`, by `tspath.Path`.
    pub(crate) script_kinds: Vec<(Vec<u8>, ScriptKind)>,
    /// `Request::script_kinds_by_extension`
    pub(crate) script_kinds_by_extension: Vec<(Vec<u8>, ScriptKind)>,
    pub(crate) before_read: Option<BeforeRead>,
    pub(crate) scripts_of_page: Option<ScriptsOfPage>,
}

/// The text of files that the caller of the check has read, by path in the checker's format, as
/// UTF-8 without a byte order mark. Such a file is not opened. Several programs may read it.
/// `bun build --check` passes what the bundler has read.
pub type AlreadyRead = FxHashMap<Vec<u8>, Vec<u8>>;

/// Called with the path of a file, in the checker's format, right before the file is read, on the
/// thread that reads it. A caller that starts to watch the file there sees every change to what is
/// checked.
pub type BeforeRead = Box<dyn Fn(&[u8]) + Send + Sync>;

/// `Host::scripts_of_page`. The paths are in the checker's format.
pub type ScriptsOfPage = Box<dyn Fn(&[u8]) -> Vec<Vec<u8>> + Send + Sync>;

/// What the caller of a check has for its host.
#[derive(Default)]
pub struct Provided {
    pub already_read: AlreadyRead,
    pub before_read: Option<BeforeRead>,
    pub scripts_of_page: Option<ScriptsOfPage>,
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
    fn by_directory(already_read: &AlreadyRead) -> FxHashMap<Vec<u8>, InMemory> {
        let mut by_directory: FxHashMap<Vec<u8>, InMemory> = FxHashMap::default();
        for path in already_read.keys() {
            let Split { mut parent, name } = split(path);
            let mut is_new = !by_directory.contains_key(parent);
            let names = by_directory.entry(parent.to_vec()).or_default();
            names.files.push(name.to_vec());
            // A directory is entered in its parent when it gets its first entry.
            while is_new {
                let directory = split(parent);
                if directory.name.is_empty() {
                    break;
                }
                is_new = !by_directory.contains_key(directory.parent);
                let names = by_directory.entry(directory.parent.to_vec()).or_default();
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
fn decoded(mut bytes: Vec<u8>) -> Cow<'static, [u8]> {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        for pair in bytes.as_chunks_mut::<2>().0 {
            pair.swap(0, 1);
        }
    }
    Cow::Owned(match BOM::detect(&bytes) {
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(bytes),
        // `BOM::detect` needs three bytes. A UTF-16 byte order mark alone is an empty file.
        None if bytes == [0xFF, 0xFE] => Vec::new(),
        None => bytes,
    })
}

/// `vfs.FS.ReadFile` of the file at `path`, by that path alone.
pub(crate) fn read_at(path: &[u8]) -> Option<Cow<'static, [u8]>> {
    let bytes = bun_sys::File::read_from(Fd::cwd(), to_native(path));
    bytes.ok().map(decoded)
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
    /// `project`: a path in the project, in the checker's path format.
    pub fn with_already_read(threads: usize, already_read: AlreadyRead, project: &[u8]) -> Self {
        Disk {
            threads,
            in_memory: InMemory::by_directory(&already_read),
            already_read,
            caches: Default::default(),
            case_sensitive: is_file_system_case_sensitive(project),
            directories: ShardedMap::default(),
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
            times: Default::default(),
            bundled_libs: None,
            script_kinds: Vec::new(),
            script_kinds_by_extension: Vec::new(),
            before_read: None,
            scripts_of_page: None,
        }
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
        if let Some(known) = self.directories.get_ref(path) {
            return known;
        }
        // An entry that its parent does not list does not exist, so no system call is needed.
        let Split { parent, name } = split(path);
        if !name.is_empty()
            && !Self::is_above_listings(parent)
            && let Directory::Listed(listing) = self.directory(parent)
            && let Some(found) = self.find_in(listing, name)
            && !matches!(found, Some((_, true)))
        {
            return self
                .directories
                .insert_ref(path.to_vec(), Directory::Missing);
        }
        let read = match (list(path), self.in_memory.get(path)) {
            (read, None) | (read @ Directory::Unreadable, _) => read,
            (Directory::Listed(listing), Some(more)) => Directory::Listed(listing.with(more)),
            (Directory::Missing, Some(more)) => Directory::Listed(Listing::default().with(more)),
        };
        self.directories.insert_ref(path.to_vec(), read)
    }

    /// Whether `path` is a directory, for a path that `already_read` adds.
    fn find_in_memory(&self, path: &[u8]) -> Option<bool> {
        let Split { parent, name } = split(path);
        let names = self.in_memory.get(parent)?;
        if name.is_empty() {
            return Some(true);
        }
        let has = |names: &[Vec<u8>]| names.iter().any(|it| it == name);
        if has(&names.files) {
            return Some(false);
        }
        has(&names.directories).then_some(true)
    }

    /// Asks the system, which does not know what is only in memory.
    fn ask_whether_directory(&self, path: &[u8]) -> Option<bool> {
        self.find_in_memory(path)
            .or_else(|| is_directory(Fd::cwd(), to_native(&with_root(path))))
    }

    /// `None`: the system has to be queried.
    fn find(&self, path: &[u8]) -> Option<Option<(&[u8], bool)>> {
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return None;
        }
        match self.directory(parent) {
            Directory::Missing => Some(None),
            Directory::Unreadable => None,
            Directory::Listed(listing) => self.find_in(listing, name),
        }
    }

    /// `Listing::find`. `None`: the system has to be queried. The name is there in another
    /// spelling, and the file system of that directory may take one for the other, whatever that of
    /// the project does: a project can have several. Or it has letters outside ASCII, which a file
    /// system folds and normalizes by rules of its own: for APFS U+017F is `s`, and a composed
    /// letter is the decomposed one, with or without case.
    fn find_in<'a>(&self, listing: &'a Listing, name: &[u8]) -> Option<Option<(&'a [u8], bool)>> {
        match listing.find(name, self.case_sensitive) {
            None if !name.is_ascii() => None,
            None if self.case_sensitive && listing.find(name, false).is_some() => None,
            found => Some(found),
        }
    }

    fn ask_for_real_path(path: &[u8]) -> Vec<u8> {
        let (mut name, mut real) = (path_buffer_pool::get(), path_buffer_pool::get());
        bun_sys::realpath(z(to_native(&with_root(path)), &mut name), &mut real)
            .map_or_else(|_| path.to_vec(), from_native)
    }

    /// `path`, with every name in it spelled as its directory has it. Links are not followed.
    pub fn as_written(&self, path: &[u8]) -> Vec<u8> {
        let Split { parent, name } = split(path);
        if self.case_sensitive || name.is_empty() || Self::is_above_listings(parent) {
            return path.to_vec();
        }
        let written = match self.directory(parent) {
            Directory::Listed(listing) => listing.find(name, false).map(|it| it.0),
            Directory::Missing | Directory::Unreadable => None,
        };
        match parent {
            b"/" => [b"/", written.unwrap_or(name)].concat(),
            _ => inside(&self.as_written(parent), written.unwrap_or(name)),
        }
    }

    /// `path` is there.
    fn real_path_of(&self, path: &[u8]) -> Vec<u8> {
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return Self::ask_for_real_path(path);
        }
        let Directory::Listed(listing) = self.directory(parent) else {
            return Self::ask_for_real_path(path);
        };
        let Some(found) = self.find_in(listing, name) else {
            return Self::ask_for_real_path(path);
        };
        let Some((written, _)) = found else {
            return path.to_vec();
        };
        if listing
            .links
            .binary_search_by(|n| n.as_slice().cmp(written))
            .is_ok()
        {
            return Self::ask_for_real_path(path);
        }
        let real_parent = match self.real_directories.get_ref(parent) {
            Some(known) => known,
            None => {
                // A root is where it is. See `root_length` for the second one.
                let real = if matches!(parent, b"/" | b"/\0") {
                    parent.to_vec()
                } else {
                    self.real_path_of(parent)
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

/// Reads the entries of the directory at `path` from the system.
fn list(path: &[u8]) -> Directory {
    let directory = match bun_sys::open_dir_absolute(to_native(&with_root(path))) {
        Ok(directory) => bun_sys::Dir::from_fd(directory),
        Err(error) if matches!(error.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            return Directory::Missing;
        }
        Err(_) => return Directory::Unreadable,
    };
    let mut listing = Listing::default();
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
            // A symlink has to be followed. It may be dangling.
            EntryKind::SymLink | EntryKind::Unknown => match is_directory(directory.fd(), name) {
                Some(is_dir) => is_dir,
                None => continue,
            },
            EntryKind::File => false,
            // A FIFO, socket or device.
            _ => continue,
        };
        if is_link {
            listing.links.push(name.to_vec());
        }
        if is_dir {
            listing.directories.push(name.to_vec());
        } else {
            listing.files.push(name.to_vec());
        }
    }
    listing.files.sort_unstable();
    listing.directories.sort_unstable();
    listing.links.sort_unstable();
    Directory::Listed(listing)
}

/// `isFileSystemCaseSensitive`, for the file system that has `path`: whether something on it is no
/// longer found when the case of its name is swapped. TypeScript asks about itself, which is in the
/// project.
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
    // `[eval]` is only in memory: no spelling of its name is found.
    let Some(path) = ancestors(path).find(|it| bun_sys::exists(to_native(it))) else {
        return true;
    };
    // What is in a directory is on its file system. Its own name is not, if it is where that file
    // system is mounted, like `/app` in a container.
    if let Directory::Listed(listing) = list(path) {
        let mut names = listing.files.iter().chain(&listing.directories);
        if let Some(other) = names.find_map(|name| swapped(name)) {
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
                let mut value = match self.value.take() {
                    Some(Json::Object(value)) => value,
                    _ => Vec::new(),
                };
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
            b"dependencies"
            | b"devDependencies"
            | b"peerDependencies"
            | b"optionalDependencies" => true,
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

impl Host for Disk {
    fn spent(&self, phase: Phase, time: Duration) {
        self.times[phase as usize].fetch_add(time.as_nanos() as u64, Ordering::Relaxed);
    }
    fn times(&self) -> [Duration; Phase::ALL.len()] {
        Phase::ALL
            .map(|phase| Duration::from_nanos(self.times[phase as usize].load(Ordering::Relaxed)))
    }
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        if let Some(text) = self.already_read.get(path) {
            return Some(Cow::Owned(text.clone()));
        }
        let _reading = Spent::on(self, Phase::Read);
        if is_bundled(path) {
            let (libs, name) = self.bundled(path)?;
            return (libs.read)(name);
        }
        if let Some(before_read) = &self.before_read {
            before_read(path);
        }
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return read_at(path);
        }
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
        read.map(decoded)
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
            Directory::Listed(listing) => (listing.files.clone(), listing.directories.clone()),
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
        options: &Options,
    ) -> hir::File<'s> {
        let began = Instant::now();
        let (file, parsing) = bun_js_parser::sema::summarize(
            arena,
            path,
            self.script_kind(path),
            text,
            atoms,
            options.experimental_decorators,
            options.module_detection == ModuleDetection::Force,
        );
        self.spent(Phase::Parse, parsing);
        self.spent(Phase::Lower, began.elapsed().saturating_sub(parsing));
        file
    }
    fn parse_package_json(&self, arena: &Arena, text: &[u8]) -> Option<Json> {
        parse_package_json(arena, text)
    }
    fn loaded(&self) {
        self.caches.drop_those_of_the_parser();
    }
    fn threads(&self) -> usize {
        self.threads
    }
    fn io_pool(&self) -> Option<&bun_threading::ThreadPool> {
        self.io_pool.as_deref()
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        // In runs: adjacent paths are in the same directory.
        crate::for_each_parallel_in_runs(
            &self.caches,
            self.threads,
            count,
            if count > 1024 { 16 } else { 1 },
            work,
        );
    }
}
