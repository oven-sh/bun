//! The file system as the checker sees it.
//!
//! The checker's paths are absolute, use `/`, and start with one. On Windows `C:\a\b` is `/C:/a/b` to it.

use bun_core::strings::{BOM, index_of, without_trailing_slash};
use bun_paths::platform::Posix;
use bun_paths::resolve_path::{dirname, z};
use bun_paths::{basename_posix, path_buffer_pool};
use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::resolve::{
    Host, ModuleDetection, Options, Phase, Spent, inside, join, to_file_name_lower_case,
};
use bun_sema::util::ShardedMap;
use bun_sys::{EntryKind, ExistsAtType, Fd};
use std::borrow::Cow;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Where TypeScript's `lib.*.d.ts` are for a project in `dir`: in the `typescript` package it has installed, which is also what its
/// editor reads them from. TypeScript 7 keeps them in a package for the platform. Last, in what is installed globally.
pub fn find_lib_dir(
    host: &dyn Host,
    dir: &[u8],
    global_node_modules: Option<&[u8]>,
) -> Option<Vec<u8>> {
    let in_node_modules = |node_modules: &[u8]| -> Option<Vec<u8>> {
        let plain = [&node_modules[..], b"/typescript/lib"].concat();
        if host.is_file(&[&plain[..], b"/lib.es5.d.ts"].concat()) {
            return Some(plain);
        }
        let for_the_platform = |node_modules: &[u8]| -> Option<Vec<u8>> {
            let scope = [node_modules, b"/@typescript"].concat();
            let (_, mut packages) = host.entries(&scope);
            // The package for the platform goes with `typescript` itself. Others may be older versions under another name.
            packages.sort_by_key(|name| {
                !(name.starts_with(b"typescript-") || name.starts_with(b"native-preview-"))
            });
            packages
                .into_iter()
                .map(|package| [&scope[..], b"/", &package[..], b"/lib"].concat())
                .find(|lib| host.is_file(&[&lib[..], b"/lib.es5.d.ts"].concat()))
        };
        for_the_platform(node_modules).or_else(|| {
            // An isolated install keeps what a package depends on beside the package, and `node_modules/typescript` is a link to it.
            let package = [node_modules, b"/typescript"].concat();
            let real = host.realpath(&package);
            (real != package).then(|| for_the_platform(dirname::<Posix>(&real)))?
        })
    };
    let mut dir = dir;
    loop {
        if let Some(found) = in_node_modules(&join(dir, b"node_modules")) {
            return Some(found);
        }
        let parent = dirname::<Posix>(dir);
        if parent == dir || parent.is_empty() {
            break;
        }
        dir = parent;
    }
    global_node_modules.and_then(in_node_modules)
}

/// `/C:/a` is `C:/a`, which Windows takes.
pub fn to_native(path: &[u8]) -> &[u8] {
    match path {
        [b'/', drive, b':', ..] if cfg!(windows) && drive.is_ascii_alphabetic() => &path[1..],
        _ => path,
    }
}

/// Every `/C:/a` that `text`, a message, speaks of as `to_native` has it, which is how TypeScript shows it.
pub fn show_drives(text: &mut Vec<u8>) {
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

/// A path of the operating system as the checker names it. It has to be absolute.
pub fn from_native(path: &[u8]) -> Vec<u8> {
    join(b"/", path.strip_prefix(br"\\?\").unwrap_or(path))
}

/// What is in a directory. The names are sorted.
struct Listing {
    files: Vec<Vec<u8>>,
    directories: Vec<Vec<u8>>,
    /// Those of either that are links.
    links: Vec<Vec<u8>>,
    /// All of them in lower case, with the name as it is written and whether it is a directory: for a file system that does not
    /// tell `A` from `a`. Put together when a name is first not found as it is written.
    folded: OnceLock<Vec<(Vec<u8>, Vec<u8>, bool)>>,
}

enum Directory {
    Missing,
    /// It is there and cannot be listed: what is in it has to be asked about one by one.
    Unreadable,
    Listed(Listing),
}

impl Listing {
    /// The name as it is written in the directory, and whether it is a directory.
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

/// The disk. A directory is read once: whether something is there, what kind of thing it is and where it really is are answered from what the
/// directories say, which takes no system call. Resolving the imports of a project asks about the same few directories over and over,
/// mostly about what is not there.
pub struct Disk {
    pub threads: usize,
    case_sensitive: bool,
    directories: ShardedMap<Vec<u8>, Directory>,
    /// Where each directory that was asked about really is.
    real_directories: ShardedMap<Vec<u8>, Vec<u8>>,
    /// On macOS, opening and reading files gets slower the more threads do it at once, by more than they get done: 16 threads take six times
    /// as long over the same files as 4 do. So few are let in at a time, as in the bundler.
    reading: Option<bun_threading::Semaphore>,
    /// Readers that are not in use, least recently used first.
    idle_readers: bun_threading::Guarded<Vec<Reader>>,
    /// `Host::times`, in nanoseconds.
    times: [AtomicU64; 8],
}

/// Reusable state for reading files. Owned by the [`Disk`], so every directory handle is closed when it is dropped.
#[derive(Default)]
struct Reader {
    /// The directory of the file read last.
    directory: Vec<u8>,
    /// Opened when a second file is read from `directory`.
    handle: Option<bun_sys::Dir>,
    buffer: Vec<u8>,
}

/// How many idle readers, and so open directories, are kept.
const MAX_IDLE_READERS: usize = 16;

/// One of the few places there are for reading a file.
/// How many threads read at a time on macOS, where opening a file goes through locks all threads meet at. With 16 threads and 45,000 files, 4 to
/// 10 are as good as each other when the system is quick to open a file. When it is slow to, which comes and goes, 5 or 6 do best.
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

/// All that the file `name` in `directory` says.
fn read_whole(directory: impl bun_sys::AsFd, name: &[u8], buffer: &mut Vec<u8>) -> Option<Vec<u8>> {
    /// Few files are bigger.
    const ROOM: usize = 64 * 1024;
    let file = bun_sys::File::openat(directory, name, bun_sys::O::RDONLY, 0).ok()?;
    buffer.resize(ROOM, 0);
    let count = file.read(&mut buffer[..]).ok()?;
    // A short read means end of file, so neither the size nor a second read is needed.
    if count < ROOM {
        return Some(buffer[..count].to_vec());
    }
    let size = file.get_end_pos().ok()?.max(count);
    let mut all = Vec::new();
    all.try_reserve_exact(size.saturating_add(16)).ok()?;
    all.extend_from_slice(&buffer[..count]);
    file.read_to_end_into(&mut all).ok()?;
    Some(all)
}

/// `decodeBytes`: what a file says, going by the mark at its start. `BOM` knows no big endian, so the pairs are swapped first.
fn decoded(mut bytes: Vec<u8>) -> Cow<'static, [u8]> {
    if bytes.starts_with(&[0xFE, 0xFF]) {
        bytes.chunks_exact_mut(2).for_each(|pair| pair.swap(0, 1));
    }
    Cow::Owned(match BOM::detect(&bytes) {
        Some(mark) => mark.remove_and_convert_to_utf8_and_free(bytes),
        None => bytes,
    })
}

/// The directory `path` is in, and its name there.
fn split(path: &[u8]) -> (&[u8], &[u8]) {
    (dirname::<Posix>(path), basename_posix(path))
}

/// Whether what is at `path` is a directory, links followed. `None`: nothing is there.
fn is_directory(directory: Fd, path: &[u8]) -> Option<bool> {
    let found = bun_sys::exists_at_type(directory, z(path, &mut path_buffer_pool::get()));
    Some(found.ok()? == ExistsAtType::Directory)
}

impl Disk {
    pub fn new(threads: usize) -> Self {
        Disk {
            threads,
            case_sensitive: is_file_system_case_sensitive(),
            directories: ShardedMap::default(),
            real_directories: ShardedMap::default(),
            reading: cfg!(target_os = "macos").then(|| {
                let places = bun_threading::Semaphore::default();
                for _ in 0..READERS {
                    places.post();
                }
                places
            }),
            idle_readers: bun_threading::Guarded::new(Vec::new()),
            times: Default::default(),
        }
    }

    /// An idle reader that read from `directory` last, or else a new one, or the least recently used once enough are kept.
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

    /// Whether the system is asked each time about what is in `path`: the roots, which on Windows are no directories.
    fn is_above_listings(path: &[u8]) -> bool {
        path.is_empty() || path == b"/" && cfg!(windows)
    }

    fn directory(&self, path: &[u8]) -> &Directory {
        let path = without_trailing_slash(path);
        if let Some(known) = self.directories.get_ref(path) {
            return known;
        }
        // What its parent does not list is not there, and need not be asked for.
        let (parent, name) = split(path);
        if !name.is_empty()
            && !Self::is_above_listings(parent)
            && let Directory::Listed(listing) = self.directory(parent)
            && !matches!(listing.find(name, self.case_sensitive), Some((_, true)))
        {
            return self
                .directories
                .insert_ref(path.to_vec(), Directory::Missing);
        }
        let read = list(path);
        self.directories.insert_ref(path.to_vec(), read)
    }

    /// `None`: the system has to be asked.
    fn find(&self, path: &[u8]) -> Option<Option<(&[u8], bool)>> {
        let (parent, name) = split(path);
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
        bun_sys::realpath(z(to_native(path), &mut name), &mut real)
            .map_or_else(|_| path.to_vec(), from_native)
    }

    /// `path` is there.
    fn real_path_of(&self, path: &[u8]) -> Vec<u8> {
        let (parent, name) = split(path);
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
            [&b"/"[..], &written[..]].concat()
        } else {
            inside(real_parent, written)
        }
    }
}

/// What the system says is in the directory at `path`.
fn list(path: &[u8]) -> Directory {
    let directory = match bun_sys::open_dir_absolute(to_native(path)) {
        Ok(directory) => bun_sys::Dir::from_fd(directory),
        Err(error) if matches!(error.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
            return Directory::Missing;
        }
        Err(_) => return Directory::Unreadable,
    };
    let mut listing = Listing {
        files: Vec::new(),
        directories: Vec::new(),
        links: Vec::new(),
        folded: OnceLock::new(),
    };
    let mut entries = bun_sys::iterate_dir(directory.fd());
    while let Ok(Some(entry)) = entries.next() {
        let name = entry.name.slice_u8();
        // What the directory says about the entry spares asking about each file.
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
            // A link has to be followed. It may lead nowhere.
            EntryKind::SymLink | EntryKind::Unknown => match is_directory(directory.fd(), name) {
                Some(is_dir) => is_dir,
                None => continue,
            },
            _ => false,
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

/// `isFileSystemCaseSensitive`: whether this program is still found when the case of its path is swapped.
fn is_file_system_case_sensitive() -> bool {
    if cfg!(windows) {
        return false;
    }
    let Ok(exe) = bun_core::self_exe_path() else {
        return true;
    };
    let mut swapped = exe.as_bytes().to_vec();
    for c in &mut swapped {
        *c ^= u8::from(c.is_ascii_alphabetic()) << 5;
    }
    !bun_sys::exists(&swapped)
}

impl Host for Disk {
    fn spent(&self, phase: Phase, time: Duration) {
        self.times[phase as usize].fetch_add(time.as_nanos() as u64, Ordering::Relaxed);
    }
    fn times(&self) -> [Duration; 8] {
        Phase::ALL
            .map(|phase| Duration::from_nanos(self.times[phase as usize].load(Ordering::Relaxed)))
    }
    fn read(&self, path: &[u8]) -> Option<Cow<'static, [u8]>> {
        let _reading = Spent::on(self, Phase::Read);
        let (parent, name) = split(path);
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
                .map(|directory| read_whole(directory, name, buffer))
        };
        let read = read.unwrap_or_else(|| {
            let path = to_native(without_trailing_slash(path));
            read_whole(Fd::cwd(), path, &mut reader.buffer)
        });
        self.return_reader(reader);
        read.map(decoded)
    }
    fn is_file(&self, path: &[u8]) -> bool {
        match self.find(path) {
            Some(found) => matches!(found, Some((_, false))),
            None => is_directory(Fd::cwd(), to_native(path)) == Some(false),
        }
    }
    fn is_dir(&self, path: &[u8]) -> bool {
        match self.find(path) {
            Some(found) => matches!(found, Some((_, true))),
            None => is_directory(Fd::cwd(), to_native(path)) == Some(true),
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
    fn parse(&self, path: &[u8], text: &[u8], atoms: &Interner, options: &Options) -> hir::File {
        let began = Instant::now();
        let (file, parsing) = bun_js_parser::sema::summarize(
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
    fn threads(&self) -> usize {
        self.threads
    }
    fn readers(&self) -> usize {
        if self.reading.is_some() {
            READERS
        } else {
            usize::MAX
        }
    }
    fn parallel(&self, count: usize, work: &(dyn Fn(usize) + Sync)) {
        // In runs: what is next to each other is in the same directory.
        crate::for_each_parallel_in_runs(
            self.threads,
            count,
            if count > 1024 { 16 } else { 1 },
            work,
        );
    }
}
