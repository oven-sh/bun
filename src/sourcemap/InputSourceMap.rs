//! Inline `//# sourceMappingURL=data:...` sourcemap carried by a bundler
//! input file, stored on `Graph::InputFile`. `LinkerContext` expands its
//! `sources`/`sourcesContent` and `Chunk::Builder` remaps mappings through
//! it so the output map points at the authored source.

use std::sync::Arc;

use crate::ParsedSourceMap;

/// `map.external_source_names` holds the chained-in `sources[]`;
/// `sources_content[i]` is `sourcesContent[i]` (`b""` when absent).
pub struct InputSourceMap {
    pub map: Arc<ParsedSourceMap>,
    pub sources_content: Box<[Box<[u8]>]>,
    /// Byte offset of the trailing `//# sourceMappingURL=` line in the
    /// original source (`None` when parsed from raw JSON). The linker
    /// strips the comment from the emitted slot-0 `sourcesContent` so the
    /// inner map isn't shipped twice.
    pub comment_start: Option<usize>,
}

impl InputSourceMap {
    /// `None` on malformed payloads — callers fall back to the raw file
    /// bytes. Copies what it needs out of `json_bytes`.
    pub fn parse(json_bytes: &[u8]) -> Option<Box<InputSourceMap>> {
        parse_internal(json_bytes).ok()
    }

    /// Parse the map from a trailing inline comment in `source`. `None`
    /// for no/non-`data:` URL (external `.map` resolution is the
    /// caller's) or a malformed payload.
    pub fn parse_from_source(source: &[u8]) -> Option<Box<InputSourceMap>> {
        let (comment_start, url) = find_source_mapping_url(source)?;
        let mut map = parse_data_url(url)?;
        map.comment_start = Some(comment_start);
        Some(map)
    }
}

/// Malformed input behaves exactly like "no chain available".
struct InvalidSourceMap;

fn parse_internal(json_bytes: &[u8]) -> Result<Box<InputSourceMap>, InvalidSourceMap> {
    use bun_ast::StoreResetGuard as DataStoreScope;

    let arena = bun_alloc::Arena::new();
    let json_src = bun_ast::Source::init_path_string("sourcemap.json", json_bytes);
    let mut log = bun_ast::Log::init();

    // The JSON parser doesn't respect the supplied allocator for every
    // alloc, so reset the AST store on entry and exit.
    let _store_scope = DataStoreScope::new();

    let root = bun_parsers::json::parse_json_into_arena(&json_src, &mut log, &arena)
        .map_err(|_| InvalidSourceMap)?;
    // Containers come back as `EObjectJSON`/`EArrayJSON` tape rows; read
    // them through the tape accessors.
    let obj: &bun_ast::E::ObjectJSON = match &root.data {
        bun_ast::ExprData::EObjectJSON(o) => o.get(),
        _ => return Err(InvalidSourceMap),
    };
    use bun_ast::E::JsonValue;

    if let Some(version) = obj.get(b"version") {
        match version {
            JsonValue::Number(n) if n.value() == 3.0 => {}
            _ => return Err(InvalidSourceMap),
        }
    }

    let mappings_slice: &[u8] = obj
        .get(b"mappings")
        .and_then(|v| v.as_str())
        .ok_or(InvalidSourceMap)?;

    let sources_paths = obj
        .get(b"sources")
        .and_then(|v| v.as_array())
        .ok_or(InvalidSourceMap)?;

    // `sourcesContent` is optional; when absent or null every slot is empty.
    let sources_content_opt = match obj.get(b"sourcesContent") {
        None => None,
        Some(v) => match v.as_array() {
            Some(arr) => Some(arr),
            // `null` is tolerated; other non-array values are malformed.
            None if matches!(v, JsonValue::Null) => None,
            None => return Err(InvalidSourceMap),
        },
    };

    if let Some(arr) = sources_content_opt {
        if arr.items().len() != sources_paths.items().len() {
            return Err(InvalidSourceMap);
        }
    }

    let source_count = sources_paths.items().len();

    // A `sources[i]` longer than `MAX_PATH_BYTES` rejects the whole map:
    // the linker resolves it through fixed-size path buffers that panic on
    // oversized (adversarial) input.
    let mut source_paths_slice: Vec<Box<[u8]>> = Vec::with_capacity(source_count);
    for item in sources_paths.items() {
        let s = item.as_str().ok_or(InvalidSourceMap)?;
        if s.len() > bun_paths::MAX_PATH_BYTES {
            return Err(InvalidSourceMap);
        }
        source_paths_slice.push(Box::<[u8]>::from(s));
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

    // Pass the real source count: downstream slot math doesn't clamp, so
    // an out-of-range VLQ `source_index` must reject the map here instead
    // of aliasing a neighboring file's `sources[]` slot.
    let sources_count_i32: i32 = i32::try_from(source_count).map_err(|_| InvalidSourceMap)?;
    let map_data = crate::mapping::parse(
        mappings_slice,
        None,
        sources_count_i32,
        i32::MAX as usize,
        crate::mapping::ParseOptions {
            allow_names: false,
            sort: true,
        },
    )
    .map_err(|_| InvalidSourceMap)?;

    let mut psm = map_data;
    psm.external_source_names = source_paths_slice;

    Ok(Box::new(InputSourceMap {
        map: Arc::new(psm),
        sources_content: sources_content_slice.into_boxed_slice(),
        comment_start: None,
    }))
}

/// Find the trailing `//# sourceMappingURL=<url>` comment. Anchored to the
/// final line (spec: the comment MUST be the last line) so a string literal
/// containing the needle can't hijack the lookup.
fn find_source_mapping_url(source: &[u8]) -> Option<(usize, &[u8])> {
    // Trim trailing whitespace/newlines so a file that ends with
    // `\n//# sourceMappingURL=...\n\n` still resolves to its final line.
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
    let comment_start = last_line_start;
    let mut url = &last_line[NEEDLE.len()..];
    // Trim spaces/tabs/CR around the URL: `= data:...` is spec-invalid but
    // some toolchains emit it.
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
    Some((comment_start, url))
}

/// Decode `data:application/json[;...;base64],...` payloads. Returns `None`
/// when the URL is not a supported data scheme.
fn parse_data_url(url: &[u8]) -> Option<Box<InputSourceMap>> {
    const PREFIX: &[u8] = b"data:application/json";
    if !url.starts_with(PREFIX) || url.len() <= PREFIX.len() + 1 {
        return None;
    }

    // Tolerate any `;name[=value]` parameters (e.g. `;charset=utf-8`)
    // before the final `;base64,` / `,` separator.
    let mut rest = &url[PREFIX.len()..];
    let mut is_base64 = false;
    while !rest.is_empty() && rest[0] == b';' {
        let after = &rest[1..];
        // Advance past one parameter up to the next ';' or ','.
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
        // Not base64; treat the payload as the raw JSON text.
        InputSourceMap::parse(payload)
    }
}
