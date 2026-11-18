//! Decompressed web fonts are kept on disk, from where only the pages that are used get into memory.

use std::fs::{self, File};
use std::hash::{Hash as _, Hasher as _};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use super::fonts::Origin;
use super::sfnt::Font;
use super::woff;
use crate::hash::{FastHasher, FastMap};
use crate::remote::guest;
use crate::sync::Mutex;

struct Decoded {
    /// `None` if it is `data`.
    original: Option<&'static [u8]>,
    data: &'static [u8],
}

type Slot = Arc<Mutex<Vec<Decoded>>>;

static BY_HASH: Mutex<Option<FastMap<u64, Slot>>> = Mutex::new(None);

pub fn map(path: &Path) -> Option<&'static [u8]> {
    map_file(&File::open(path).ok()?)
}

#[cfg(windows)]
pub fn map_file(file: &File) -> Option<&'static [u8]> {
    use crate::win32::{
        CloseHandle, CreateFileMappingW, FILE_MAP_READ, MapViewOfFile, PAGE_READONLY, Str,
    };
    let len = file.metadata().ok()?.len().try_into().ok()?;
    let mapping = CreateFileMappingW(
        std::os::windows::io::AsRawHandle::as_raw_handle(file) as isize,
        0,
        PAGE_READONLY,
        0,
        0,
        Str::NULL,
    );
    let start = MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0);
    CloseHandle(mapping);
    // SAFETY: it is never unmapped, and fonts are replaced, not written to.
    (!start.is_null()).then(|| unsafe { std::slice::from_raw_parts(start.cast(), len) })
}

#[cfg(unix)]
pub fn map_file(file: &File) -> Option<&'static [u8]> {
    use std::os::fd::AsRawFd as _;
    let len = std::io::Seek::seek(&mut &*file, std::io::SeekFrom::End(0))
        .ok()?
        .try_into()
        .ok()?;
    // SAFETY: it is never unmapped, and fonts are replaced, not written to.
    unsafe {
        let start = libc::mmap(
            std::ptr::null_mut(),
            len,
            libc::PROT_READ,
            libc::MAP_SHARED,
            file.as_raw_fd(),
            0,
        );
        (start != libc::MAP_FAILED).then(|| std::slice::from_raw_parts(start.cast(), len))
    }
}

fn cache_directory() -> Option<PathBuf> {
    if cfg!(target_os = "macos") {
        return Some(std::env::home_dir()?.join("Library/Caches"));
    }
    let chosen = std::env::var_os(if cfg!(windows) {
        "LOCALAPPDATA"
    } else {
        "XDG_CACHE_HOME"
    })
    .map(PathBuf::from)
    .filter(|it| it.is_absolute());
    chosen.or_else(|| Some(std::env::home_dir()?.join(".cache")))
}

/// The file has the original, and then what it decodes to.
fn split(all: &'static [u8], original: &[u8]) -> Option<Decoded> {
    let (stored, data) = all.split_at_checked(original.len())?;
    (stored == original).then_some(Decoded {
        original: Some(stored),
        data,
    })
}

/// By the address of the data.
static STORED: Mutex<Vec<(usize, u32)>> = Mutex::new(Vec::new());

pub fn origin(data: &[u8]) -> Origin {
    STORED
        .lock()
        .iter()
        .find(|it| it.0 == data.as_ptr().addr())
        .map_or(Origin::Unknown, |it| Origin::Stored(it.1))
}

/// Writes `data` first.
fn stored(hash: u64, original: &[u8], data: Option<&[u8]>) -> Option<Decoded> {
    if guest::is_on() {
        let (all, number) = guest::stored_font(hash, original, data)?;
        return split(all, original)
            .inspect(|it| STORED.lock().push((it.data.as_ptr().addr(), number)));
    }
    let path = cache_directory()?.join(format!("bun/desktop-fonts-1/{hash:016x}"));
    data.is_none_or(|data| write(&path, original, data).is_ok())
        .then(|| split(map(&path)?, original))?
}

/// What the pages of a site have decoded is only for them. The path lacks an extension.
pub fn store_for(site: &str) -> Option<PathBuf> {
    let name: String = site.bytes().map(|it| format!("{it:02x}")).collect();
    (1..200)
        .contains(&name.len())
        .then(|| Some(cache_directory()?.join("bun/desktop-fonts-1").join(name)))?
}

/// For another process.
pub fn open_stored(
    path: &Path,
    original: &[u8],
    data: Option<&[u8]>,
) -> Option<(File, &'static [u8])> {
    type PathAndInode = (PathBuf, u64);
    static MAPPED: Mutex<Option<FastMap<PathAndInode, &'static [u8]>>> = Mutex::new(None);
    if let Some(data) = data {
        write(path, original, data).ok()?;
    }
    let file = File::open(path).ok()?;
    #[cfg(unix)]
    let number = std::os::unix::fs::MetadataExt::ino(&file.metadata().ok()?);
    #[cfg(windows)]
    let number = std::os::windows::fs::MetadataExt::creation_time(&file.metadata().ok()?);
    let (key, mut mapped) = ((path.to_owned(), number), MAPPED.lock());
    let all = mapped
        .get_or_insert_default()
        .get(&key)
        .copied()
        .or_else(|| map_file(&file))?;
    mapped.get_or_insert_default().insert(key, all);
    Some((file, all))
}

/// What another process has decoded.
pub fn keep_font(data: Vec<u8>) -> Option<&'static [u8]> {
    (!woff::is_compressed(&data)).then(|| decode(data, true))?
}

fn write(path: &Path, original: &[u8], data: &[u8]) -> std::io::Result<()> {
    const MAX_BYTES: u64 = 64 << 20;
    let directory = path.parent().unwrap_or(path);
    fs::create_dir_all(directory)?;
    let files = fs::read_dir(directory)?
        .flatten()
        .filter_map(|it| Some((it.metadata().ok()?, it.path())));
    let mut files: Vec<_> = files.collect();
    files.sort_by_key(|(metadata, _)| std::cmp::Reverse(metadata.modified().ok()));
    let mut total = 0;
    for (metadata, path) in files {
        total += metadata.len();
        if total > MAX_BYTES {
            fs::remove_file(path).ok();
        }
    }
    let temporary = path.with_extension(std::process::id().to_string());
    let mut file = File::create_new(&temporary)?;
    let written = file.write_all(original).and_then(|()| file.write_all(data));
    drop(file);
    written
        .and_then(|()| fs::rename(&temporary, path))
        .inspect_err(|_| drop(fs::remove_file(&temporary)))
}

/// Equal bytes have the same result.
pub fn decode(original: Vec<u8>, may_be_slow: bool) -> Option<&'static [u8]> {
    const WORTH_STORING: usize = 16 << 10;
    let mut hasher = FastHasher::default();
    original.hash(&mut hasher);
    let hash = hasher.finish();
    let slot = BY_HASH
        .lock()
        .get_or_insert_default()
        .entry(hash)
        .or_default()
        .clone();
    let mut slot = if may_be_slow {
        slot.lock()
    } else {
        slot.try_lock()?
    };
    if let Some(known) = slot
        .iter()
        .find(|it| it.original.unwrap_or(it.data) == original)
    {
        return Some(known.data);
    }
    let decoded = if woff::is_compressed(&original) {
        let is_large = original.len() >= WORTH_STORING;
        match is_large.then(|| stored(hash, &original, None)).flatten() {
            Some(decoded) => decoded,
            None if is_large && !may_be_slow => return None,
            None => {
                let data = woff::decode(&original).filter(|data| Font::is_font(data))?;
                let stored = is_large
                    .then(|| stored(hash, &original, Some(&data)))
                    .flatten();
                stored.unwrap_or_else(|| Decoded {
                    original: Some(original.leak()),
                    data: data.leak(),
                })
            }
        }
    } else {
        Font::is_font(&original).then_some(())?;
        Decoded {
            original: None,
            data: original.leak(),
        }
    };
    let data = decoded.data;
    slot.push(decoded);
    Some(data)
}
