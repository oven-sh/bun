//! Loads the source map an input file's `sourceMappingURL` comment names.

use bun_ast::{Log, Source, Span};
use bun_sourcemap::InputSourceMap;
use bun_sourcemap::input_source_map::{path_from_file_url, url_scheme};

bun_core::declare_scope!(InputSourceMap, hidden);

/// A map that cannot be loaded is a warning on `log`; the file then maps to itself.
pub(crate) fn load(log: &mut Log, source: &Source, comment: Span) -> Option<Box<InputSourceMap>> {
    let url: &[u8] = comment.text.slice();
    if url.is_empty() {
        return None;
    }
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
            let map_path: Box<[u8]> = if let Some(path) = path_from_file_url(url) {
                path
            } else if url_scheme(url).is_some() || url.starts_with(b"//") {
                // `https://…` and the like: unreadable here and not the user's to fix, so no warning.
                return None;
            } else {
                // A virtual module (plugin namespace) has no directory to resolve against.
                let source_dir = source_dir?;
                let url = strip_query_and_fragment(url);
                let decoded;
                let url: &[u8] = if bun_core::strings::contains_char(url, b'%') {
                    match bun_url::PercentEncoding::decode_alloc(url) {
                        Ok(d) => {
                            decoded = d;
                            &decoded
                        }
                        Err(_) => url,
                    }
                } else {
                    url
                };
                let mut buf = bun_paths::path_buffer_pool::get();
                Box::from(bun_paths::resolve_path::join_abs_string_buf_checked::<
                    bun_paths::resolve_path::platform::Auto,
                >(source_dir, &mut buf[..], &[url])?)
            };

            json = match bun_sys::File::read_from(bun_sys::Fd::cwd(), &map_path) {
                Ok(bytes) => bytes,
                // Published packages routinely name a `.map` they do not ship; like esbuild, say nothing.
                Err(err) if err.get_errno() == bun_sys::E::ENOENT => {
                    bun_core::scoped_log!(
                        InputSourceMap,
                        "missing source map {}",
                        bstr::BStr::new(&map_path)
                    );
                    return None;
                }
                Err(err) => {
                    log.add_range_warning_fmt(
                        Some(source),
                        comment.range,
                        format_args!(
                            "Cannot read source map file \"{}\": {}",
                            bstr::BStr::new(&map_path),
                            bstr::BStr::new(err.name())
                        ),
                    );
                    return None;
                }
            };
            map_dir = Some(Box::from(bun_paths::resolve_path::dirname::<
                bun_paths::resolve_path::platform::Auto,
            >(&map_path)));
            map_name = map_path;
        }
    }

    let mut read_file = |path: &[u8]| bun_sys::File::read_from(bun_sys::Fd::cwd(), path).ok();
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

fn strip_query_and_fragment(url: &[u8]) -> &[u8] {
    match bun_core::strings::index_of_any(url, b"?#") {
        Some(i) => &url[..i],
        None => url,
    }
}
