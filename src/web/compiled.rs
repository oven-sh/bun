//! The scripts of pages and workers that were compiled into the executable.

use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::{StringView, strings};
use bun_threading::RwLock;

use crate::Bytes;

/// The start of a URL, and the directory in the executable that has its files.
static ROOTS: RwLock<Vec<(Bytes, Bytes)>> = RwLock::new(Vec::new());
static IS_EXCLUSIVE: AtomicBool = AtomicBool::new(false);
static HAS_SOURCES: AtomicBool = AtomicBool::new(false);

unsafe extern "C" {
    safe fn Bun__isCompiledProgramFile(path: &bun_core::String) -> bool;
}

pub fn extend(roots: impl Iterator<Item = (Bytes, Bytes)>, is_exclusive: bool, has_sources: bool) {
    ROOTS.write().extend(roots);
    IS_EXCLUSIVE.fetch_or(is_exclusive, Ordering::Relaxed);
    HAS_SOURCES.fetch_or(has_sources, Ordering::Relaxed);
}

/// Pages run these, the inline scripts that their documents came with, and nothing else.
pub fn is_exclusive() -> bool {
    IS_EXCLUSIVE.load(Ordering::Relaxed)
}

/// The app has the text of modules that are part of the program without being compiled.
pub(crate) fn has_sources() -> bool {
    HAS_SOURCES.load(Ordering::Relaxed)
}

pub fn is_path(key: &[u8]) -> bool {
    ROOTS.read().iter().any(|it| key.starts_with(&it.1))
}

pub fn path_of(url: &[u8]) -> Option<Vec<u8>> {
    ROOTS.read().iter().find_map(|(prefix, directory)| {
        let rest = url.strip_prefix(&**prefix)?;
        let path = [
            directory,
            &rest[..strings::index_of_any(rest, b"?#").unwrap_or(rest.len())],
        ]
        .concat();
        Bun__isCompiledProgramFile(&StringView::from_bytes(&path)).then_some(path)
    })
}
