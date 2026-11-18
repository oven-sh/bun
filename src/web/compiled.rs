//! The scripts of pages and workers that were compiled into the executable, and the files that are embedded in it.

use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::LazyLock;

use bun_core::{StringView, strings};
use bun_jsc::virtual_machine::standalone_module_graph;
pub use bun_resolver::scripts_of_pages::PRELOAD_PARAMETERS;
use bun_resolver::scripts_of_pages::{CLASSIC, LIST, PRELOAD, name_of_inline};
use bun_threading::RwLock;

use crate::origin::{Origin, Site};
use crate::url::{Url, percent_decode};
use crate::{Bytes, trust};

/// The start of a URL, and the directory in the executable that has its files.
static ROOTS: RwLock<Vec<(Bytes, Bytes)>> = RwLock::new(Vec::new());
static APP_PATH: RwLock<Vec<u8>> = RwLock::new(Vec::new());
static IS_EXCLUSIVE: AtomicBool = AtomicBool::new(false);
static HAS_SOURCES: AtomicBool = AtomicBool::new(false);

unsafe extern "C" {
    safe fn Bun__isCompiledProgramFile(path: &bun_core::String) -> bool;
}

unsafe extern "Rust" {
    safe fn __bun_desktop_can_show_pages_without_program() -> bool;
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Form {
    Module,
    Classic,
    Preload,
    /// No page asks for it.
    Program,
}

pub fn extend(roots: impl Iterator<Item = (Bytes, Bytes)>, is_exclusive: bool, has_sources: bool) {
    ROOTS.write().extend(roots);
    IS_EXCLUSIVE.fetch_or(is_exclusive, Ordering::Relaxed);
    HAS_SOURCES.fetch_or(has_sources, Ordering::Relaxed);
}

/// The root of the executable stands for it.
pub fn set_app_path(path: &[u8]) {
    path.clone_into(&mut APP_PATH.write());
}

crate::wire! {
    #[derive(Clone, Default)]
    pub(crate) struct Settings {
        roots: Vec<(Bytes, Bytes)>,
        app_path: Bytes,
        is_exclusive: bool,
        has_sources: bool,
    }
}

pub(crate) fn settings() -> Settings {
    Settings {
        roots: ROOTS.read().clone(),
        app_path: APP_PATH.read()[..].into(),
        is_exclusive: is_exclusive(),
        has_sources: has_sources(),
    }
}

pub(crate) fn replace(settings: Settings) {
    ROOTS.write().clear();
    set_app_path(&settings.app_path);
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

pub fn has_scripts() -> bool {
    !ROOTS.read().is_empty()
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
        || (url.file_path().and_then(|it| key_of_file(&it))).is_some_and(|it| is_for_pages(&it))
        || !__bun_desktop_can_show_pages_without_program()
}

/// Or for others that they may be able to reach.
pub fn is_for_site_of(url: &Url) -> bool {
    let site = Site::of(url);
    let is_of_site = |prefix| Url::parse(prefix).is_some_and(|it| Site::of(&it) == site);
    is_for_documents_at(url)
        || ROOTS.read().iter().any(|it| is_of_site(&it.0))
        || (url.scheme() == b"file" && !listed().is_empty())
}

pub fn is_for_any_document() -> bool {
    has_scripts() || !listed().is_empty() || !__bun_desktop_can_show_pages_without_program()
}

pub fn is_path(key: &[u8]) -> bool {
    ROOTS.read().iter().any(|it| key.starts_with(&it.1))
        || standalone_module_graph()
            .is_some_and(|it| key.starts_with(it.base_public_path_with_default_suffix()))
}

fn is_compiled(path: &[u8]) -> bool {
    Bun__isCompiledProgramFile(&StringView::from_bytes(path))
}

fn listed() -> &'static [&'static [u8]] {
    static LISTED: LazyLock<Vec<&[u8]>> = LazyLock::new(|| {
        let list = standalone_module_graph().and_then(|graph| {
            graph.embedded_data(&[graph.base_public_path_with_default_suffix(), LIST].concat())
        });
        let lines = strings::split(list.unwrap_or_default(), b"\n");
        let mut paths: Vec<_> = lines.filter(|it| !it.is_empty()).collect();
        paths.sort_unstable();
        paths
    });
    &LISTED
}

/// A page or one of its scripts. The rest of the program can do what a page must not.
fn is_for_pages(path: &[u8]) -> bool {
    listed().binary_search(&path).is_ok()
}

/// Where the executable would have the file: one of its own, of the app, or of the sources that it was built from.
fn key_of_file(path: &[u8]) -> Option<Vec<u8>> {
    let graph = standalone_module_graph()?;
    let app_path = APP_PATH.read();
    match trust::below(&app_path, path).filter(|_| !app_path.is_empty()) {
        Some(rest) => {
            let root = graph.base_public_path_with_default_suffix();
            graph.path_in_executable(&[strings::without_trailing_slash(root), rest].concat())
        }
        None => graph.path_in_executable(path),
    }
}

fn stays_inside(path: Vec<u8>) -> Option<Vec<u8>> {
    let leaves = strings::split_any(&path, b"/\\").any(|it| it == b"..");
    (!leaves).then_some(path)
}

/// `find` is told whether the app has named the directory, and where that ends.
fn find_by_url(
    url: &[u8],
    find: impl Fn(Vec<u8>, usize, bool) -> Option<Vec<u8>>,
) -> Option<Vec<u8>> {
    let named = ROOTS.read().iter().find_map(|(prefix, directory)| {
        let rest = url.strip_prefix(&**prefix)?;
        let rest = &rest[..strings::index_of_any(rest, b"?#").unwrap_or(rest.len())];
        let path = match strings::contains_char(rest, b'%') {
            true => [directory, &*stays_inside(percent_decode(rest))?].concat(),
            false => [directory, rest].concat(),
        };
        find(path, directory.len(), true)
    });
    named.or_else(|| {
        let url = url.starts_with(b"file:").then(|| Url::parse(url))??;
        let key = key_of_file(&url.file_path()?)?;
        let directory = strings::last_index_of_char(&key, b'/')? + 1;
        find(key, directory, false)
    })
}

pub fn path_of(url: &[u8], form: Form) -> Option<Vec<u8>> {
    find_by_url(url, |mut path, _, is_named| {
        let length = path.len();
        path.extend_from_slice(match form {
            _ if path.ends_with(CLASSIC) || path.ends_with(PRELOAD) => return None,
            Form::Module if !is_named && !is_for_pages(&path) => return None,
            Form::Module | Form::Program => return is_compiled(&path).then_some(path),
            Form::Classic => CLASSIC,
            Form::Preload => PRELOAD,
        });
        if is_compiled(&path) {
            return Some(path);
        }
        // An entry point that the app has prepared for it.
        path.truncate(length);
        (is_named && is_compiled(&path)).then_some(path)
    })
}

/// A page can be at any URL below the directory that it is from.
pub fn path_of_inline(base: &[u8], text: impl Fn() -> Vec<u8>, is_module: bool) -> Option<Vec<u8>> {
    find_by_url(base, |path, root, _| {
        let name = name_of_inline(&text(), is_module);
        let ends = (root..=path.len()).rev();
        ends.filter(|&it| it == root || path[it - 1] == b'/')
            .map(|it| [&path[..it], &name].concat())
            .find(|it| is_compiled(it))
    })
}

pub fn is_classic_script(path: &[u8]) -> bool {
    path.ends_with(CLASSIC)
}

/// The one that begins most like `near`.
pub fn url_of(path: &[u8], near: &Url) -> Option<Url> {
    let shared = |a: &[u8], b: &[u8]| a.iter().zip(b).take_while(|it| it.0 == it.1).count();
    let join = |base: &Url, start: &[u8], rest: &[u8]| {
        let mut relative = start.to_vec();
        for &byte in rest {
            match byte {
                b'%' => relative.extend_from_slice(b"%25"),
                b'#' => relative.extend_from_slice(b"%23"),
                b'?' => relative.extend_from_slice(b"%3F"),
                byte => relative.push(byte),
            }
        }
        base.join(&relative)
    };
    let roots = ROOTS.read();
    let nearest = (roots.iter())
        .filter_map(|(prefix, directory)| Some((prefix, path.strip_prefix(&**directory)?)))
        .max_by_key(|it| shared(it.0, near.href()));
    if let Some((prefix, rest)) = nearest {
        return join(&Url::parse(prefix)?, b"./", rest);
    }
    let Some(own) = near.file_path().and_then(|it| key_of_file(&it)) else {
        return Url::parse(&bun_url::file_url_from_string(&StringView::from_bytes(path)).to_utf8());
    };
    let directory = strings::last_index_of_char(&path[..shared(path, &own)], b'/')? + 1;
    let up = b"../".repeat(strings::count_char(&own[directory..], b'/'));
    join(near, &[b"./", &up[..]].concat(), &path[directory..])
}

pub(crate) fn embedded_file(path: &[u8]) -> Option<&'static [u8]> {
    standalone_module_graph()?.embedded_data(&key_of_file(path)?)
}

/// What is used in its place is part of the app.
pub(crate) fn has_file(path: &[u8]) -> bool {
    key_of_file(path).is_some_and(|key| {
        standalone_module_graph().is_some_and(|it| it.embedded_data(&key).is_some())
    })
}
