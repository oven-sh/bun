//! Decompressed web fonts are kept on disk, from where only the pages that are used get into memory.

use std::fs::{self, File};
use std::hash::{Hash as _, Hasher as _};
use std::io::Write as _;
use std::os::fd::AsRawFd as _;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::hash::{FastHasher, FastMap};
use crate::sync::Mutex;
use skrifa::FontRef;

use super::woff;

struct Decoded {
    /// `None` if it is `data`.
    original: Option<&'static [u8]>,
    data: &'static [u8],
}

type Slot = Arc<Mutex<Vec<Decoded>>>;

static BY_HASH: Mutex<Option<FastMap<u64, Slot>>> = Mutex::new(None);

pub fn map(path: &Path) -> Option<&'static [u8]> {
    let file = File::open(path).ok()?;
    let len = file.metadata().ok()?.len().try_into().ok()?;
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
    let chosen = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|it| it.is_absolute());
    chosen.or_else(|| Some(std::env::home_dir()?.join(".cache")))
}

/// The file has the original, and then what it decodes to.
fn read(path: &Path, original: &[u8]) -> Option<Decoded> {
    let (stored, data) = map(path)?.split_at_checked(original.len())?;
    (stored == original).then_some(Decoded {
        original: Some(stored),
        data,
    })
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
        let directory = cache_directory().filter(|_| original.len() >= WORTH_STORING);
        let path = directory.map(|it| it.join(format!("bun/desktop-fonts-1/{hash:016x}")));
        match path.as_ref().and_then(|path| read(path, &original)) {
            Some(decoded) => decoded,
            None if path.is_some() && !may_be_slow => return None,
            None => {
                let data =
                    woff::decode(&original).filter(|data| FontRef::from_index(data, 0).is_ok())?;
                let stored = path.filter(|path| write(path, &original, &data).is_ok());
                let stored = stored.and_then(|path| read(&path, &original));
                stored.unwrap_or_else(|| Decoded {
                    original: Some(original.leak()),
                    data: data.leak(),
                })
            }
        }
    } else {
        FontRef::from_index(&original, 0).ok()?;
        Decoded {
            original: None,
            data: original.leak(),
        }
    };
    let data = decoded.data;
    slot.push(decoded);
    Some(data)
}
