//! The scripts of pages and workers that were compiled into the executable.

use core::sync::atomic::{AtomicBool, Ordering};

use bun_core::{StringView, strings};
use bun_threading::RwLock;

use crate::Bytes;
use crate::origin::Origin;
use crate::url::Url;

/// The start of a URL, and the directory in the executable that has its files.
static ROOTS: RwLock<Vec<(Bytes, Bytes)>> = RwLock::new(Vec::new());
static IS_EXCLUSIVE: AtomicBool = AtomicBool::new(false);
static HAS_SOURCES: AtomicBool = AtomicBool::new(false);

unsafe extern "C" {
    safe fn Bun__isCompiledProgramFile(path: &bun_core::String) -> bool;
}

unsafe extern "Rust" {
    safe fn __bun_desktop_can_show_pages_without_program() -> bool;
}

pub fn extend(roots: impl Iterator<Item = (Bytes, Bytes)>, is_exclusive: bool, has_sources: bool) {
    ROOTS.write().extend(roots);
    IS_EXCLUSIVE.fetch_or(is_exclusive, Ordering::Relaxed);
    HAS_SOURCES.fetch_or(has_sources, Ordering::Relaxed);
}

crate::wire! {
    #[derive(Clone)]
    pub(crate) struct Settings {
        roots: Vec<(Bytes, Bytes)>,
        is_exclusive: bool,
        has_sources: bool,
    }
}

pub(crate) fn settings() -> Settings {
    Settings {
        roots: ROOTS.read().clone(),
        is_exclusive: is_exclusive(),
        has_sources: has_sources(),
    }
}

pub(crate) fn replace(settings: Settings) {
    ROOTS.write().clear();
    extend(
        settings.roots.into_iter(),
        settings.is_exclusive,
        settings.has_sources,
    );
}

/// Pages run these, the inline scripts that their documents came with, and nothing else.
pub fn is_exclusive() -> bool {
    IS_EXCLUSIVE.load(Ordering::Relaxed)
}

/// The app has the text of modules that are part of the program without being compiled.
pub(crate) fn has_sources() -> bool {
    HAS_SOURCES.load(Ordering::Relaxed)
}

/// What is in front of the path.
fn authority(url: &[u8]) -> &[u8] {
    let host = strings::index_of(url, b"://").map_or(0, |it| it + 3);
    let path = strings::index_of_char_usize(&url[host..], b'/');
    &url[..path.map_or(url.len(), |it| host + it)]
}

pub(crate) fn is_for_documents_at(url: &Url) -> bool {
    let origin = Origin::of(url);
    let own = authority(match origin.is_opaque() {
        true => url.href(),
        false => origin.as_bytes(),
    });
    let is_named = |prefix: &[u8]| match authority(prefix) {
        named if named.len() < prefix.len() => own == named,
        start => own.starts_with(start),
    };
    is_exclusive()
        || ROOTS.read().iter().any(|it| is_named(&it.0))
        || !__bun_desktop_can_show_pages_without_program()
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
