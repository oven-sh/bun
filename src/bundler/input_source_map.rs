//! Loads the source map an input file's `sourceMappingURL` comment names.

use bun_ast::{Log, Source, Span};
use bun_core::UnwrapOrOom;
use bun_sourcemap::InputSourceMap;
use bun_sourcemap::input_source_map::{path_from_file_url, url_scheme};

bun_core::declare_scope!(InputSourceMap, hidden);

/// What a `sourceMappingURL` comment loads. `sidecar` is the file the comment names, for the watcher.
#[derive(Default)]
pub(crate) struct Loaded {
    pub(crate) map: Option<Box<InputSourceMap>>,
    pub(crate) sidecar: Option<Box<[u8]>>,
}

/// A map that cannot be loaded is a warning on `log`; the file then maps to itself.
pub(crate) fn load(log: &mut Log, source: &Source, comment: Span) -> Loaded {
    let url: &[u8] = comment.text.slice();
    if url.is_empty() {
        return Loaded::default();
    }
    let mut loaded = Loaded::default();
    loaded.map = load_map(log, source, comment, url, &mut loaded.sidecar);
    loaded
}

fn load_map(
    log: &mut Log,
    source: &Source,
    comment: Span,
    url: &[u8],
    sidecar: &mut Option<Box<[u8]>>,
) -> Option<Box<InputSourceMap>> {
    let source_dir: Option<&[u8]> = source
        .path
        .is_file()
        .then(|| source.path.name().dir_with_trailing_slash());

    let json: Vec<u8>;
    let map_dir: Option<Box<[u8]>>;
    let map_name: Box<[u8]>;
    match bun_resolver::DataURL::parse(url) {
        Ok(Some(data_url)) => {
            match data_url.decode_data() {
                Ok(bytes) => json = bytes,
                Err(_) => {
                    log.add_range_warning_fmt(
                        Some(source),
                        comment.range,
                        format_args!(
                            "Unsupported source map comment: could not decode the \"data:\" URL"
                        ),
                    );
                    return None;
                }
            }
            map_dir = source_dir.map(Box::from);
            map_name = Box::from(&b"data: URL"[..]);
        }
        Ok(None) | Err(_) => {
            let url = strip_query_and_fragment(url);
            let sidecar_path: Box<[u8]> = if let Some(path) = path_from_file_url(url) {
                path
            } else if url_scheme(url).is_some() || url.starts_with(b"//") {
                // `https://…` and the like: unreadable here and not the user's to fix, so no warning.
                return None;
            } else {
                // A virtual module (plugin namespace) has no directory to resolve against.
                let source_dir = source_dir?;
                let decoded = bun_url::PercentEncoding::decode_lenient_alloc(url);
                let mut buf = bun_paths::path_buffer_pool::get();
                Box::from(bun_paths::resolve_path::join_abs_string_buf_checked::<
                    bun_paths::resolve_path::platform::Auto,
                >(source_dir, &mut buf[..], &[&decoded])?)
            };
            *sidecar = Some(sidecar_path.clone());

            json = match read_regular_file(&sidecar_path) {
                Ok(Some(bytes)) => bytes,
                Ok(None) => {
                    log.add_range_warning_fmt(
                        Some(source),
                        comment.range,
                        format_args!(
                            "Cannot read source map file \"{}\": not a regular file",
                            bstr::BStr::new(&sidecar_path)
                        ),
                    );
                    return None;
                }
                // Published packages routinely name a `.map` they do not ship; like esbuild, say nothing.
                Err(err) if matches!(err.get_errno(), bun_sys::E::ENOENT | bun_sys::E::ENOTDIR) => {
                    bun_core::scoped_log!(
                        InputSourceMap,
                        "missing source map {}",
                        bstr::BStr::new(&sidecar_path)
                    );
                    return None;
                }
                Err(err) => {
                    log.add_range_warning_fmt(
                        Some(source),
                        comment.range,
                        format_args!(
                            "Cannot read source map file \"{}\": {}",
                            bstr::BStr::new(&sidecar_path),
                            bstr::BStr::new(err.name())
                        ),
                    );
                    return None;
                }
            };
            map_dir = Some(Box::from(bun_paths::resolve_path::dirname::<
                bun_paths::resolve_path::platform::Auto,
            >(&sidecar_path)));
            map_name = sidecar_path;
        }
    }

    let mut read_file = |path: &[u8]| read_regular_file(path).ok().flatten();
    match InputSourceMap::parse(&json, map_dir.as_deref(), &mut read_file) {
        Ok(Some(map)) => Some(Box::new(map)),
        Ok(None) => None,
        Err(err) => {
            log.add_range_warning_fmt(
                Some(source),
                comment.range,
                format_args!(
                    "Ignoring the source map \"{}\" of this file: {}",
                    bstr::BStr::new(&map_name),
                    bstr::BStr::new(&err.0)
                ),
            );
            None
        }
    }
}

/// `Ok(None)`: not a regular file. The read stops at the size `fstat` reports (the path is untrusted).
fn read_regular_file(path: &[u8]) -> bun_sys::Maybe<Option<Vec<u8>>> {
    let file = bun_sys::File::openat(
        bun_sys::Fd::cwd(),
        path,
        bun_sys::O::RDONLY | bun_sys::O::NONBLOCK,
        0,
    )?;
    if file.kind()? != bun_core::util::FileKind::File {
        return Ok(None);
    }
    let size = file.get_end_pos()?;
    let mut bytes: Vec<u8> = Vec::new();
    bytes.try_reserve_exact(size).unwrap_or_oom();
    bytes.resize(size, 0);
    let read = file.read_all(&mut bytes)?;
    bytes.truncate(read);
    Ok(Some(bytes))
}

fn strip_query_and_fragment(url: &[u8]) -> &[u8] {
    match bun_core::strings::index_of_any(url, b"?#") {
        Some(i) => &url[..i],
        None => url,
    }
}
