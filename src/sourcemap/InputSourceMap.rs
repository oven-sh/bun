//! The sourcemap an input file points at via `//# sourceMappingURL=`, chained into the output map.

use std::sync::Arc;

use crate::ParsedSourceMap;

/// `sources_content[i]` pairs with `map.external_source_names[i]`; empty when the map had none.
pub struct InputSourceMap {
    pub map: Arc<ParsedSourceMap>,
    pub sources_content: Box<[Box<[u8]>]>,
}

impl InputSourceMap {
    /// `None` on malformed input; callers fall back to the raw file bytes.
    pub fn parse(json_bytes: &[u8]) -> Option<Box<InputSourceMap>> {
        parse_internal(json_bytes).ok()
    }

    /// Inline `data:` URLs only; see `parse_from_source_with_fs` for sidecars.
    pub fn parse_from_source(source: &[u8]) -> Option<Box<InputSourceMap>> {
        let url = find_source_mapping_url(source)?;
        parse_data_url(url)
    }

    /// Also reads a sidecar `.map` relative to `source_dir`; remote or unreadable returns `None`.
    pub fn parse_from_source_with_fs(
        source: &[u8],
        source_dir: &[u8],
    ) -> Option<Box<InputSourceMap>> {
        let url = find_source_mapping_url(source)?;
        if bun_core::strings::has_prefix_comptime(url, b"data:") {
            return parse_data_url(url);
        }
        if is_url_like_source_name(url) {
            return None;
        }
        let mut buf = bun_paths::path_buffer_pool::get();
        // Checked join: `url` is untrusted and may exceed the PathBuffer.
        let abs = bun_paths::resolve_path::join_abs_string_buf_checked::<bun_paths::platform::Loose>(
            source_dir,
            &mut buf,
            &[url],
        )?;
        let bytes = bun_sys::File::read_from(bun_core::Fd::cwd(), abs).ok()?;
        InputSourceMap::parse(&bytes)
    }
}

/// Scheme or protocol-relative names are emitted verbatim, never joined against a directory.
pub fn is_url_like_source_name(name: &[u8]) -> bool {
    bun_core::strings::contains(name, b"://") || bun_core::strings::has_prefix_comptime(name, b"//")
}

struct InvalidSourceMap;

fn parse_internal(json_bytes: &[u8]) -> Result<Box<InputSourceMap>, InvalidSourceMap> {
    use bun_ast::StoreResetGuard as DataStoreScope;

    let json_src = bun_ast::Source::init_path_string("sourcemap.json", json_bytes);
    let mut log = bun_ast::Log::init();

    // The JSON parser allocates into the AST store; reset it on entry and exit.
    let _store_scope = DataStoreScope::new();

    let parsed = bun_parsers::json::ParsedJson::parse_json(&json_src, &mut log)
        .map_err(|_| InvalidSourceMap)?;
    let json = parsed.root;

    if let Some(version) = json.get(b"version") {
        match version.data.as_e_number() {
            Some(n) if n.value() == 3.0 => {}
            _ => return Err(InvalidSourceMap),
        }
    }

    // `Expr::get` returns an owned `Expr`; bind locals so the borrows below outlive the match.
    let mappings_expr = json.get(b"mappings").ok_or(InvalidSourceMap)?;
    let mappings_slice: &[u8] = mappings_expr
        .as_utf8_string_literal()
        .ok_or(InvalidSourceMap)?;

    let sources_paths_ref = match json.get(b"sources").ok_or(InvalidSourceMap)?.data {
        bun_ast::ExprData::EArrayJSON(arr) => arr,
        _ => return Err(InvalidSourceMap),
    };
    let sources_paths = sources_paths_ref.get();

    // `sourcesContent` is optional; when absent or null every slot is empty.
    let sources_content_ref = match json.get(b"sourcesContent") {
        None => None,
        Some(v) => match v.data {
            bun_ast::ExprData::EArrayJSON(arr) => Some(arr),
            // `null` is tolerated; other non-array values are malformed.
            bun_ast::ExprData::ENull(_) => None,
            _ => return Err(InvalidSourceMap),
        },
    };
    let sources_content_opt = sources_content_ref.as_ref().map(|r| r.get());

    if let Some(arr) = sources_content_opt {
        if arr.items().len() != sources_paths.items().len() {
            return Err(InvalidSourceMap);
        }
    }

    let source_count = sources_paths.items().len();

    // Per spec, `sourceRoot` is prepended to each `sources` entry.
    let source_root_expr = json.get(b"sourceRoot");
    let source_root: &[u8] = source_root_expr
        .as_ref()
        .and_then(|v| v.as_utf8_string_literal())
        .unwrap_or(b"");

    // Copy source paths out of the arena into owned storage.
    let mut source_paths_slice: Vec<Box<[u8]>> = Vec::with_capacity(source_count);
    for item in sources_paths.items() {
        let s = item.as_str().ok_or(InvalidSourceMap)?;
        let owned: Box<[u8]> = if source_root.is_empty() {
            Box::<[u8]>::from(s)
        } else {
            // Add a separator only when neither side has one (matches esbuild).
            let need_sep = !matches!(source_root.last(), Some(b'/') | Some(b'\\'))
                && !matches!(s.first(), Some(b'/') | Some(b'\\'));
            let mut v = Vec::with_capacity(source_root.len() + need_sep as usize + s.len());
            v.extend_from_slice(source_root);
            if need_sep {
                v.push(b'/');
            }
            v.extend_from_slice(s);
            v.into_boxed_slice()
        };
        source_paths_slice.push(owned);
    }

    // Copy source contents. Non-strings (null, etc.) and empty slots map to `b""`.
    let mut sources_content_slice: Vec<Box<[u8]>> = Vec::with_capacity(source_count);
    if let Some(arr) = sources_content_opt {
        for item in arr.items() {
            let slot: Box<[u8]> = match item.as_str() {
                Some(s) => Box::<[u8]>::from(s),
                None => Box::<[u8]>::from(&b""[..]),
            };
            sources_content_slice.push(slot);
        }
    } else {
        for _ in 0..source_count {
            sources_content_slice.push(Box::<[u8]>::from(&b""[..]));
        }
    }

    // Consumers index `sources[]` by `1 + source_index` unclamped, so reject out-of-range VLQ here.
    let sources_count_i32: i32 = i32::try_from(source_count).map_err(|_| InvalidSourceMap)?;
    let map_data = match crate::mapping::parse(
        mappings_slice,
        None,
        sources_count_i32,
        i32::MAX as usize,
        crate::mapping::ParseOptions {
            allow_names: false,
            sort: true,
        },
    ) {
        Ok(x) => x,
        Err(_) => return Err(InvalidSourceMap),
    };

    let mut psm = map_data;
    psm.external_source_names = source_paths_slice;

    Ok(Box::new(InputSourceMap {
        map: Arc::new(psm),
        sources_content: sources_content_slice.into_boxed_slice(),
    }))
}

/// Only the last non-blank line counts (per spec), so an earlier string literal cannot hijack it.
fn find_source_mapping_url(source: &[u8]) -> Option<&[u8]> {
    let mut end = source.len();
    while end > 0 {
        let c = source[end - 1];
        if c == b' ' || c == b'\r' || c == b'\n' || c == b'\t' {
            end -= 1;
        } else {
            break;
        }
    }
    let body = &source[..end];
    if body.is_empty() {
        return None;
    }

    let last_line_start = match bun_core::strings::last_index_of_char(body, b'\n') {
        Some(i) => i + 1,
        None => 0,
    };
    let last_line = &body[last_line_start..];

    const NEEDLE: &[u8] = b"//# sourceMappingURL=";
    if !last_line.starts_with(NEEDLE) {
        return None;
    }
    let mut url = &last_line[NEEDLE.len()..];
    // Some toolchains emit a space after `=`; tolerate it.
    while let Some(&first) = url.first() {
        if first == b' ' || first == b'\r' || first == b'\t' {
            url = &url[1..];
        } else {
            break;
        }
    }
    while let Some(&last) = url.last() {
        if last == b' ' || last == b'\r' || last == b'\t' {
            url = &url[..url.len() - 1];
        } else {
            break;
        }
    }
    Some(url)
}

/// Decode `data:application/json[;...;base64],...`; `None` for an unsupported scheme.
fn parse_data_url(url: &[u8]) -> Option<Box<InputSourceMap>> {
    const PREFIX: &[u8] = b"data:application/json";
    if !url.starts_with(PREFIX) || url.len() <= PREFIX.len() + 1 {
        return None;
    }

    // Tolerate extra `;param` segments, e.g. `;charset=utf-8;base64,`.
    let mut rest = &url[PREFIX.len()..];
    let mut is_base64 = false;
    while !rest.is_empty() && rest[0] == b';' {
        let after = &rest[1..];
        let param_end = bun_core::strings::index_of_any(after, b";,")?;
        let param = &after[..param_end];
        if param == b"base64" {
            is_base64 = true;
        }
        rest = &after[param_end..];
    }
    if rest.is_empty() || rest[0] != b',' {
        return None;
    }
    let payload = &rest[1..];

    if is_base64 {
        let decoded_len = bun_base64::decode_len(payload);
        let mut buf: Vec<u8> = vec![0u8; decoded_len];
        let decoded = bun_base64::decode(&mut buf, payload);
        if !decoded.is_successful() {
            return None;
        }
        InputSourceMap::parse(&buf[..decoded.count])
    } else {
        InputSourceMap::parse(payload)
    }
}
