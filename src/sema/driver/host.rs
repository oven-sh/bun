//! The checker's view of the file system.
//!
//! The checker's paths are absolute, use `/`, and start with one. On Windows it represents `C:\a\b`
//! as `/C:/a/b`.

use bun_core::strings::{BOM, index_of, is_all_whitespace, without_trailing_slash};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, windows_volume_name_len, z};
use bun_paths::{basename_posix, path_buffer_pool};
use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::json::Json;
use bun_sema::resolve::{
    Host, ModuleDetection, Options, Phase, Spent, ancestors, inside, join, to_file_name_lower_case,
};
use bun_sema::session::Arena;
use bun_sema::util::{FxHashMap, ShardedMap};
use bun_sys::{EntryKind, ExistsAtType, Fd};
use std::borrow::Cow;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// The directory of TypeScript's `lib.*.d.ts` files for a project in `dir`: the `typescript`
/// package the project has installed, which is also where its editor reads them from. TypeScript 7
/// ships them in a platform-specific package. The global install is searched last.
pub fn find_lib_dir(
    host: &dyn Host,
    dir: &[u8],
    global_node_modules: Option<&[u8]>,
) -> Option<Vec<u8>> {
    let in_node_modules = |node_modules: &[u8]| -> Option<Vec<u8>> {
        let plain = [node_modules, b"/typescript/lib"].concat();
        if host.is_file(&[&plain[..], b"/lib.es5.d.ts"].concat()) {
            return Some(plain);
        }
        let for_the_platform = |node_modules: &[u8]| -> Option<Vec<u8>> {
            let scope = [node_modules, b"/@typescript"].concat();
            let (_, mut packages) = host.entries(&scope);
            // The platform-specific package belongs to `typescript` itself. Other packages may be
            // older versions under another name.
            packages.sort_by_key(|name| {
                !(name.starts_with(b"typescript-") || name.starts_with(b"native-preview-"))
            });
            packages
                .into_iter()
                .map(|package| [&scope[..], b"/", &package[..], b"/lib"].concat())
                .find(|lib| host.is_file(&[&lib[..], b"/lib.es5.d.ts"].concat()))
        };
        for_the_platform(node_modules).or_else(|| {
            // An isolated install places a package's dependencies next to the package, and
            // `node_modules/typescript` is a symlink to it.
            let package = [node_modules, b"/typescript"].concat();
            let real = host.realpath(&package);
            (real != package).then(|| for_the_platform(dirname::<Posix>(&real)))?
        })
    };
    ancestors(dir)
        .find_map(|dir| in_node_modules(&join(dir, b"node_modules")))
        .or_else(|| global_node_modules.and_then(in_node_modules))
}

/// `/C:/a` becomes `C:/a`, and `/\\server/share/a` becomes `\\server/share/a`, which Windows accepts.
pub fn to_native(path: &[u8]) -> &[u8] {
    match path {
        [b'/', drive, b':', ..] if cfg!(windows) && drive.is_ascii_alphabetic() => &path[1..],
        [b'/', b'\\', b'\\', ..] if cfg!(windows) => &path[1..],
        _ => path,
    }
}

/// The root of a drive is `/C:`. For the system, to which `C:` is the working directory on that
/// drive, and in a message it is `/C:/`.
pub fn with_root(path: &[u8]) -> Cow<'_, [u8]> {
    match path {
        [b'/', drive, b':'] if cfg!(windows) && drive.is_ascii_alphabetic() => {
            Cow::Owned([path, b"/"].concat())
        }
        _ => Cow::Borrowed(path),
    }
}

/// Rewrites every `/C:/a` in the message `text` to its `to_native` form, which is how TypeScript
/// prints it, and every `/\\server/a` to `//server/a`.
pub fn show_drives(text: &mut Vec<u8>) {
    while let Some(at) = index_of(text, b"/\\\\") {
        text.splice(at..at + 3, *b"//");
    }
    let mut from = 0;
    while let Some(colon) = index_of(&text[from..], b":/").map(|at| from + at) {
        from = colon + 2;
        // Not in the middle of a path or of a word.
        let is_start = |b: &u8| !b.is_ascii_alphanumeric() && !b"/._-".contains(b);
        if colon >= 2
            && text[colon - 1].is_ascii_alphabetic()
            && text[colon - 2] == b'/'
            && text[..colon - 2].last().is_none_or(is_start)
        {
            text.remove(colon - 2);
            from -= 1;
        }
    }
}

/// Converts a native path to the checker's path format. It must be absolute.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    join(b"/", bun_paths::string_paths::without_nt_prefix(path))
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
}

/// The text of files that the caller of the check has read, by path in the checker's format, as
/// UTF-8 without a byte order mark. Such a file is not opened. Several programs may read it.
/// `bun build --check` passes what the bundler has read.
pub type AlreadyRead = FxHashMap<Vec<u8>, Vec<u8>>;

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

/// The two parts of a path.
struct Split<'a> {
    /// The parent directory.
    parent: &'a [u8],
    /// The base name.
    name: &'a [u8],
}

fn split(path: &[u8]) -> Split<'_> {
    Split {
        parent: dirname::<Posix>(path),
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
        }
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
        let path = without_trailing_slash(path);
        if let Some(known) = self.directories.get_ref(path) {
            return known;
        }
        // An entry that its parent does not list does not exist, so no system call is needed.
        let Split { parent, name } = split(path);
        if !name.is_empty()
            && !Self::is_above_listings(parent)
            && let Directory::Listed(listing) = self.directory(parent)
            && !matches!(listing.find(name, self.case_sensitive), Some((_, true)))
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
            Directory::Listed(listing) => Some(listing.find(name, self.case_sensitive)),
        }
    }

    fn ask_for_real_path(path: &[u8]) -> Vec<u8> {
        let (mut name, mut real) = (path_buffer_pool::get(), path_buffer_pool::get());
        bun_sys::realpath(z(to_native(&with_root(path)), &mut name), &mut real)
            .map_or_else(|_| path.to_vec(), from_native)
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
        let Some((written, _)) = listing.find(name, self.case_sensitive) else {
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
                let real = if parent == b"/" {
                    b"/".to_vec()
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

/// `isFileSystemCaseSensitive`, for the file system that has `path`: whether `path` is no longer
/// found when the case of its name is swapped. Only of its name: what is above it can be on another
/// file system, like `/mnt` of `/mnt/c`. TypeScript asks about itself, which is in the project.
fn is_file_system_case_sensitive(path: &[u8]) -> bool {
    if cfg!(windows) {
        return false;
    }
    for path in ancestors(path) {
        let Split { parent, name } = split(path);
        let mut swapped = name.to_vec();
        for c in &mut swapped {
            *c ^= u8::from(c.is_ascii_alphabetic()) << 5;
        }
        if swapped != name {
            return !bun_sys::exists(&join(parent, &swapped));
        }
    }
    true
}

/// `packagejson.Parse`, with Bun's JSON parser. That one also takes strings in single quotes and
/// the number literals of JavaScript, which typescript-go refuses.
fn parse_package_json(arena: &Arena, text: &[u8]) -> Option<Json> {
    use bun_ast::e::{JsonValue, ObjectJSON};
    use bun_parsers::json::ParsedJson;
    fn json_of_object(object: &ObjectJSON, has_duplicates: bool) -> Json {
        let properties = object.properties();
        let mut entries: Vec<(Vec<u8>, Json)> = Vec::with_capacity(properties.len());
        for property in properties {
            let key = property.key.slice();
            let value = json_of(&property.value, has_duplicates);
            // `json.AllowDuplicateNames`: the last value, at the place of the first.
            let earlier = has_duplicates.then(|| entries.iter_mut().find(|entry| entry.0 == key));
            match earlier.flatten() {
                Some(entry) => entry.1 = value,
                None => entries.push((key.to_vec(), value)),
            }
        }
        Json::Object(entries)
    }
    fn json_of(value: &JsonValue, has_duplicates: bool) -> Json {
        match value {
            JsonValue::Null => Json::Null,
            JsonValue::Boolean(value) => Json::Bool(*value),
            JsonValue::Number(number) => Json::Number(number.value()),
            JsonValue::String(text) => Json::String(text.slice().to_vec()),
            JsonValue::Array(array) => {
                let items = array.get().items().iter();
                Json::Array(items.map(|item| json_of(item, has_duplicates)).collect())
            }
            JsonValue::Object(object) => json_of_object(object.get(), has_duplicates),
        }
    }
    let text = text.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(text);
    let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(arena);
    let _ast_scope = ast_memory_allocator.enter();
    let source = bun_ast::Source::init_path_string(b"package.json".as_slice(), text);
    let mut log = bun_ast::Log::init();
    let parsed = ParsedJson::parse_json(&source, &mut log).ok()?;
    let bun_ast::expr::Data::EObjectJSON(root) = parsed.root.data else {
        return None;
    };
    // The parser stops at the end of the first value. The object of an empty file has no `}`.
    let end = usize::try_from(root.close_brace_loc.start).ok()? + 1;
    // The only warning is about a duplicate key.
    is_all_whitespace(&text[end..]).then(|| json_of_object(root.get(), log.warnings > 0))
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
        let Split { parent, name } = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return bun_sys::File::read_from(Fd::cwd(), to_native(path))
                .ok()
                .map(decoded);
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
        match self.find(path) {
            Some(found) => matches!(found, Some((_, false))),
            None => self.ask_whether_directory(path) == Some(false),
        }
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        match self.find(path) {
            Some(found) => matches!(found, Some((_, true))),
            None => self.ask_whether_directory(path) == Some(true),
        }
    }
    fn realpath(&self, path: &[u8]) -> Vec<u8> {
        self.real_path_of(path)
    }
    fn list_dir(&self, path: &[u8]) -> Vec<Vec<u8>> {
        let (mut files, directories) = self.entries(path);
        files.extend(directories);
        files
    }
    fn entries(&self, path: &[u8]) -> (Vec<Vec<u8>>, Vec<Vec<u8>>) {
        match self.directory(path) {
            Directory::Listed(listing) => (listing.files.clone(), listing.directories.clone()),
            _ => (Vec::new(), Vec::new()),
        }
    }
    fn is_case_sensitive(&self) -> bool {
        self.case_sensitive
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
