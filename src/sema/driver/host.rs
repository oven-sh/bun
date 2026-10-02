//! The file system as the checker sees it.
//!
//! The checker's paths are absolute, use `/`, and start with one. On Windows `C:\a\b` is `/C:/a/b` to it.

use bun_sema::atom::Interner;
use bun_sema::hir;
use bun_sema::resolve::{Host, ModuleDetection, Options, Phase, Spent};
use bun_sema::util::ShardedMap;
use std::borrow::Cow;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// Where TypeScript's `lib.*.d.ts` are for a project in `dir`: in the `typescript` package it has installed, which is also what its
/// editor reads them from. TypeScript 7 keeps them in a package for the platform. Last, in what is installed globally.
pub fn find_lib_dir(
    host: &dyn Host,
    dir: &str,
    global_node_modules: Option<&str>,
) -> Option<String> {
    let in_node_modules = |node_modules: &str| -> Option<String> {
        let plain = format!("{node_modules}/typescript/lib");
        if host.is_file(&format!("{plain}/lib.es5.d.ts")) {
            return Some(plain);
        }
        let for_the_platform = |node_modules: &str| -> Option<String> {
            let scope = format!("{node_modules}/@typescript");
            let (_, mut packages) = host.entries(&scope);
            // The package for the platform goes with `typescript` itself. Others may be older versions under another name.
            packages.sort_by_key(|name| {
                !(name.starts_with("typescript-") || name.starts_with("native-preview-"))
            });
            packages
                .into_iter()
                .map(|package| format!("{scope}/{package}/lib"))
                .find(|lib| host.is_file(&format!("{lib}/lib.es5.d.ts")))
        };
        for_the_platform(node_modules).or_else(|| {
            // An isolated install keeps what a package depends on beside the package, and `node_modules/typescript` is a link to it.
            let package = format!("{node_modules}/typescript");
            let real = host.realpath(&package);
            (real != package).then(|| for_the_platform(bun_sema::resolve::parent_dir(&real)))?
        })
    };
    let mut dir = dir;
    loop {
        if let Some(found) = in_node_modules(&bun_sema::resolve::join(dir, "node_modules")) {
            return Some(found);
        }
        let parent = bun_sema::resolve::parent_dir(dir);
        if parent == dir || parent.is_empty() {
            break;
        }
        dir = parent;
    }
    global_node_modules.and_then(in_node_modules)
}

#[cfg(windows)]
pub fn to_native(path: &str) -> String {
    // `/C:/a` is `C:/a`, which Windows takes.
    match path.as_bytes() {
        [b'/', drive, b':', ..] if drive.is_ascii_alphabetic() => path[1..].to_owned(),
        _ => path.to_owned(),
    }
}
#[cfg(not(windows))]
pub fn to_native(path: &str) -> &str {
    path
}

/// A path of the operating system as the checker names it. It has to be absolute.
pub fn from_native(path: &str) -> String {
    #[cfg(windows)]
    {
        let path = path.replace('\\', "/");
        let path = path.strip_prefix("//?/").unwrap_or(&path);
        return bun_sema::resolve::normalize(&format!("/{path}"));
    }
    #[cfg(not(windows))]
    bun_sema::resolve::normalize(path)
}

/// What is in a directory. The names are sorted.
struct Listing {
    files: Vec<String>,
    directories: Vec<String>,
    /// Those of either that are links.
    links: Vec<String>,
    /// All of them in lower case, with the name as it is written and whether it is a directory: for a file system that does not
    /// tell `A` from `a`. Put together when a name is first not found as it is written.
    folded: OnceLock<Vec<(String, String, bool)>>,
}

enum Directory {
    Missing,
    /// It is there and cannot be listed: what is in it has to be asked about one by one.
    Unreadable,
    Listed(Listing),
}

impl Listing {
    /// The name as it is written in the directory, and whether it is a directory.
    fn find(&self, name: &str, case_sensitive: bool) -> Option<(&str, bool)> {
        if let Ok(i) = self.files.binary_search_by(|n| n.as_str().cmp(name)) {
            return Some((&self.files[i], false));
        }
        if let Ok(i) = self.directories.binary_search_by(|n| n.as_str().cmp(name)) {
            return Some((&self.directories[i], true));
        }
        if case_sensitive {
            return None;
        }
        let folded = self.folded.get_or_init(|| {
            let mut all: Vec<(String, String, bool)> = self
                .files
                .iter()
                .map(|n| (n.to_lowercase(), n.clone(), false))
                .chain(
                    self.directories
                        .iter()
                        .map(|n| (n.to_lowercase(), n.clone(), true)),
                )
                .collect();
            all.sort_unstable();
            all
        });
        let lower = name.to_lowercase();
        let i = folded.binary_search_by(|n| n.0.as_str().cmp(&lower)).ok()?;
        Some((&folded[i].1, folded[i].2))
    }
}

/// The disk. A directory is read once: whether something is there, what kind of thing it is and where it really is are answered from what the
/// directories say, which takes no system call. Resolving the imports of a project asks about the same few directories over and over,
/// mostly about what is not there.
pub struct Disk {
    pub threads: usize,
    case_sensitive: bool,
    directories: ShardedMap<String, Directory>,
    /// Where each directory that was asked about really is.
    real_directories: ShardedMap<String, String>,
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
    directory: String,
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

/// `decodeBytes`: what a file says, going by the mark at its start.
fn decoded(mut bytes: Vec<u8>) -> Cow<'static, [u8]> {
    let utf16 = |rest: &[u8], is_big_endian: bool| {
        let units = rest.chunks_exact(2).map(|pair| {
            if is_big_endian {
                u16::from_be_bytes([pair[0], pair[1]])
            } else {
                u16::from_le_bytes([pair[0], pair[1]])
            }
        });
        char::decode_utf16(units)
            .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect::<String>()
            .into_bytes()
    };
    if bytes.starts_with(&[0xFF, 0xFE]) {
        bytes = utf16(&bytes[2..], false);
    } else if bytes.starts_with(&[0xFE, 0xFF]) {
        bytes = utf16(&bytes[2..], true);
    } else if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
        bytes.drain(..3);
    }
    Cow::Owned(bytes)
}

fn split(path: &str) -> (&str, &str) {
    let path = if path.len() > 1 {
        path.trim_end_matches('/')
    } else {
        path
    };
    match path.rfind('/') {
        Some(0) => ("/", &path[1..]),
        Some(i) => (&path[..i], &path[i + 1..]),
        None => ("", path),
    }
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

    /// Whether what is in `path` is asked of the system each time: the roots, which on Windows are no directories.
    /// An idle reader that read from `directory` last, or else a new one, or the least recently used once enough are kept.
    fn take_reader(&self, directory: &str) -> Reader {
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

    fn is_above_listings(path: &str) -> bool {
        path.is_empty() || path == "/" && cfg!(windows)
    }

    fn directory(&self, path: &str) -> &Directory {
        let path = if path.len() > 1 {
            path.trim_end_matches('/')
        } else {
            path
        };
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
                .insert_ref(path.to_owned(), Directory::Missing);
        }
        let read = list(path);
        self.directories.insert_ref(path.to_owned(), read)
    }

    /// `None`: the system has to be asked.
    fn find(&self, path: &str) -> Option<Option<(&str, bool)>> {
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

    fn ask_for_real_path(path: &str) -> String {
        std::fs::canonicalize(to_native(path))
            .map_or_else(|_| path.to_owned(), |p| from_native(&p.to_string_lossy()))
    }

    /// `path` is there.
    fn real_path_of(&self, path: &str) -> String {
        let (parent, name) = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return Self::ask_for_real_path(path);
        }
        let Directory::Listed(listing) = self.directory(parent) else {
            return Self::ask_for_real_path(path);
        };
        let Some((written, _)) = listing.find(name, self.case_sensitive) else {
            return path.to_owned();
        };
        if listing
            .links
            .binary_search_by(|n| n.as_str().cmp(written))
            .is_ok()
        {
            return Self::ask_for_real_path(path);
        }
        let real_parent = match self.real_directories.get_ref(parent) {
            Some(known) => known,
            None => {
                let real = if parent == "/" {
                    "/".to_owned()
                } else {
                    self.real_path_of(parent)
                };
                self.real_directories.insert_ref(parent.to_owned(), real)
            }
        };
        if real_parent == "/" {
            format!("/{written}")
        } else {
            bun_sema::resolve::inside(&real_parent, written)
        }
    }
}

/// What the system says is in the directory at `path`.
#[cfg(unix)]
fn list(path: &str) -> Directory {
    use bun_sys::EntryKind;
    use std::os::unix::ffi::OsStrExt;
    let directory = match bun_sys::open_dir_absolute(path.as_bytes()) {
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
        let written = entry.name.slice_u8();
        let whole = || std::path::Path::new(path).join(std::ffi::OsStr::from_bytes(written));
        // What the directory says about the entry spares asking about each file. `None`: it is a link.
        let is_dir = match entry.kind {
            EntryKind::Directory => Some(true),
            EntryKind::SymLink => None,
            EntryKind::Unknown => match std::fs::symlink_metadata(whole()) {
                Ok(found) if found.is_symlink() => None,
                Ok(found) => Some(found.is_dir()),
                Err(_) => continue,
            },
            _ => Some(false),
        };
        let name = String::from_utf8_lossy(written).into_owned();
        let is_dir = match is_dir {
            Some(is_dir) => is_dir,
            // A link has to be followed.
            None => {
                listing.links.push(name.clone());
                match std::fs::metadata(whole()) {
                    Ok(target) => target.is_dir(),
                    // It leads nowhere.
                    Err(_) => continue,
                }
            }
        };
        if is_dir {
            listing.directories.push(name);
        } else {
            listing.files.push(name);
        }
    }
    listing.files.sort_unstable();
    listing.directories.sort_unstable();
    listing.links.sort_unstable();
    Directory::Listed(listing)
}

#[cfg(not(unix))]
fn list(path: &str) -> Directory {
    match std::fs::read_dir(to_native(path)) {
        Ok(entries) => {
            let mut listing = Listing {
                files: Vec::new(),
                directories: Vec::new(),
                links: Vec::new(),
                folded: OnceLock::new(),
            };
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().into_owned();
                // What the directory says about the entry spares asking about each file. A link has to be followed.
                let is_dir = match entry.file_type() {
                    Ok(kind) if kind.is_symlink() => {
                        listing.links.push(name.clone());
                        match std::fs::metadata(entry.path()) {
                            Ok(target) => target.is_dir(),
                            // It leads nowhere.
                            Err(_) => continue,
                        }
                    }
                    Ok(kind) => kind.is_dir(),
                    Err(_) => continue,
                };
                if is_dir {
                    listing.directories.push(name);
                } else {
                    listing.files.push(name);
                }
            }
            listing.files.sort_unstable();
            listing.directories.sort_unstable();
            listing.links.sort_unstable();
            Directory::Listed(listing)
        }
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            Directory::Missing
        }
        Err(_) => Directory::Unreadable,
    }
}

/// `isFileSystemCaseSensitive`: whether this program is still found when the case of its path is swapped.
fn is_file_system_case_sensitive() -> bool {
    if cfg!(windows) {
        return false;
    }
    let Ok(exe) = std::env::current_exe() else {
        return true;
    };
    let swapped: String = exe
        .to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_ascii_uppercase() {
                c.to_ascii_lowercase()
            } else {
                c.to_ascii_uppercase()
            }
        })
        .collect();
    !std::path::Path::new(&swapped).exists()
}

impl Host for Disk {
    fn spent(&self, phase: Phase, time: Duration) {
        self.times[phase as usize].fetch_add(time.as_nanos() as u64, Ordering::Relaxed);
    }
    fn times(&self) -> [Duration; 8] {
        Phase::ALL
            .map(|phase| Duration::from_nanos(self.times[phase as usize].load(Ordering::Relaxed)))
    }
    fn read(&self, path: &str) -> Option<Cow<'static, [u8]>> {
        let _reading = Spent::on(self, Phase::Read);
        let (parent, name) = split(path);
        if name.is_empty() || Self::is_above_listings(parent) {
            return std::fs::read(to_native(path)).ok().map(decoded);
        }
        let _turn = self.reading.as_ref().map(Turn::wait_for);
        let mut reader = self.take_reader(parent);
        // The second file read from a directory, and those after it, are opened relative to the directory. An absolute path makes
        // the kernel look up every directory on the way again, and all threads contend on the ones near the root. For a single
        // file, opening the directory costs that walk and more.
        let read = if reader.directory != parent {
            reader.handle = None;
            reader.directory.clear();
            reader.directory.push_str(parent);
            None
        } else {
            if reader.handle.is_none() {
                reader.handle = bun_sys::open_dir_absolute(to_native(parent).as_bytes())
                    .ok()
                    .map(bun_sys::Dir::from_fd);
            }
            let Reader { handle, buffer, .. } = &mut reader;
            handle
                .as_ref()
                .map(|directory| read_whole(directory, name.as_bytes(), buffer))
        };
        let read = read.unwrap_or_else(|| {
            let path = to_native(path.trim_end_matches('/'));
            read_whole(bun_sys::Fd::cwd(), path.as_bytes(), &mut reader.buffer)
        });
        self.return_reader(reader);
        read.map(decoded)
    }
    fn is_file(&self, path: &str) -> bool {
        match self.find(path) {
            Some(found) => matches!(found, Some((_, false))),
            None => std::fs::metadata(to_native(path)).is_ok_and(|m| m.is_file()),
        }
    }
    fn is_dir(&self, path: &str) -> bool {
        match self.find(path) {
            Some(found) => matches!(found, Some((_, true))),
            None => std::fs::metadata(to_native(path)).is_ok_and(|m| m.is_dir()),
        }
    }
    fn realpath(&self, path: &str) -> String {
        self.real_path_of(path)
    }
    fn list_dir(&self, path: &str) -> Vec<String> {
        let (mut files, directories) = self.entries(path);
        files.extend(directories);
        files
    }
    fn entries(&self, path: &str) -> (Vec<String>, Vec<String>) {
        match self.directory(path) {
            Directory::Listed(listing) => (listing.files.clone(), listing.directories.clone()),
            _ => (Vec::new(), Vec::new()),
        }
    }
    fn is_case_sensitive(&self) -> bool {
        self.case_sensitive
    }
    fn parse(&self, path: &str, text: &[u8], atoms: &Interner, options: &Options) -> hir::File {
        let began = Instant::now();
        let (file, parsing) = bun_js_parser::sema::summarize(
            path.as_bytes(),
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
