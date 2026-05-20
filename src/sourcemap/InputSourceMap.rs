//! Per-input-file sourcemap used by the bundler to chain sourcemaps through
//! upstream compile steps (e.g. `.vue` → `.js`, `.svelte` → `.js`,
//! TypeScript plugins). When `Bun.build` reads an input file that carries
//! an inline `//# sourceMappingURL=data:application/json;...` comment, we
//! parse it into an `InputSourceMap` and store it on the file's
//! `Graph::InputFile`. `LinkerContext` then emits its `sources` /
//! `sourcesContent` in place of the intermediate, and `Chunk::Builder`
//! remaps each mapping through `map.find_mapping` during printing so stack
//! traces surface in the authored source.

use std::sync::Arc;

use bun_collections::VecExt;

use crate::ParsedSourceMap;

/// Parsed inner sourcemap + per-source content bytes, owned.
///
/// `map.external_source_names` holds the chained-in `sources[]`.
/// `sources_content[i]` is the inner file's `sourcesContent[i]`; an empty
/// slot (`b""`) means the inner map did not carry content for that source.
pub struct InputSourceMap {
    pub map: Arc<ParsedSourceMap>,
    pub sources_content: Box<[Box<[u8]>]>,
}

impl InputSourceMap {
    /// Parse a sourcemap JSON blob intended to chain through a bundler input
    /// file. Returns `None` when the payload is malformed — callers fall back
    /// to the raw file bytes. Allocation failures panic via `handle_oom`.
    ///
    /// `json_bytes` is borrowed; the function copies out what it needs.
    pub fn parse(json_bytes: &[u8]) -> Option<Box<InputSourceMap>> {
        parse_internal(json_bytes).ok()
    }

    /// Locate a trailing `//# sourceMappingURL=data:...` inline comment in
    /// `source` and parse the embedded map. Returns `None` when no URL is
    /// present, when the URL is not a data URL (e.g. a `.map` filename), or
    /// when the payload fails to parse. External `.map` file resolution is
    /// the caller's responsibility.
    pub fn parse_from_source(source: &[u8]) -> Option<Box<InputSourceMap>> {
        let url = find_source_mapping_url(source)?;
        parse_data_url(url)
    }
}

/// Malformed input is indistinguishable from "no chain available" — callers
/// treat it as a silent fallback to the raw file bytes.
struct InvalidSourceMap;

/// Workhorse returning `Result` so `?` fires cleanup on malformed-payload
/// bails — critical because JSON can pass the structural checks but still
/// have a malformed `mappings` VLQ, and we'd otherwise leak everything
/// allocated up to that point. Zig's `errdefer` becomes Rust's automatic
/// drop on early return.
fn parse_internal(json_bytes: &[u8]) -> Result<Box<InputSourceMap>, InvalidSourceMap> {
    use bun_ast::StoreResetGuard as DataStoreScope;

    let arena = bun_alloc::Arena::new();
    let json_src = bun_ast::Source::init_path_string("sourcemap.json", json_bytes);
    let mut log = bun_ast::Log::init();

    // The JSON parser doesn't respect the supplied allocator for every
    // alloc, so reset the AST store on entry and exit.
    let _store_scope = DataStoreScope::new();

    let json = bun_parsers::json::parse::<false>(&json_src, &mut log, &arena)
        .map_err(|_| InvalidSourceMap)?;

    if let Some(version) = json.get(b"version") {
        match version.data.as_e_number() {
            Some(n) if n.value == 3.0 => {}
            _ => return Err(InvalidSourceMap),
        }
    }

    let mappings_str = json.get(b"mappings").ok_or(InvalidSourceMap)?;
    let mut mappings_e_string = mappings_str.data.as_e_string().ok_or(InvalidSourceMap)?;
    let mappings_slice: &[u8] = mappings_e_string.slice(&arena);

    let sources_paths = json
        .get(b"sources")
        .ok_or(InvalidSourceMap)?
        .data
        .as_e_array()
        .ok_or(InvalidSourceMap)?;

    // `sourcesContent` is optional; when absent or null every slot is empty.
    let sources_content_opt = match json.get(b"sourcesContent") {
        None => None,
        Some(v) => match v.data.as_e_array() {
            Some(arr) => Some(arr),
            None => {
                // `null` is tolerated; other non-array values are malformed.
                if matches!(v.data, bun_ast::ExprData::ENull(_)) {
                    None
                } else {
                    return Err(InvalidSourceMap);
                }
            }
        },
    };

    if let Some(arr) = sources_content_opt {
        if arr.items.len_u32() != sources_paths.items.len_u32() {
            return Err(InvalidSourceMap);
        }
    }

    let source_count = sources_paths.items.len_u32() as usize;

    // Copy source paths out of the arena into owned storage.
    let mut source_paths_slice: Vec<Box<[u8]>> = Vec::with_capacity(source_count);
    for item in sources_paths.items.slice() {
        let mut estr = item.data.as_e_string().ok_or(InvalidSourceMap)?;
        // handle_oom — fatal if OOM
        let s = estr.string(&arena).expect("OOM");
        source_paths_slice.push(Box::<[u8]>::from(s));
    }

    // Copy source contents. Non-strings (null, etc.) and empty slots map to `b""`.
    let mut sources_content_slice: Vec<Box<[u8]>> = Vec::with_capacity(source_count);
    if let Some(arr) = sources_content_opt {
        for item in arr.items.slice() {
            let slot: Box<[u8]> = if let Some(mut estr) = item.data.as_e_string() {
                let s = estr.string(&arena).expect("OOM");
                if s.is_empty() {
                    Box::<[u8]>::from(&b""[..])
                } else {
                    Box::<[u8]>::from(s)
                }
            } else {
                Box::<[u8]>::from(&b""[..])
            };
            sources_content_slice.push(slot);
        }
    } else {
        for _ in 0..source_count {
            sources_content_slice.push(Box::<[u8]>::from(&b""[..]));
        }
    }

    // `sources_count` bounds every `source_index` encoded in the VLQ
    // mappings. The downstream consumers (`Chunk::Builder` emits
    // `1 + inner.source_index`; `LinkerContext` reserves exactly
    // `1 + external_source_names.len` slots per file) DON'T defensively
    // clamp — out-of-range indices would alias a neighboring input file's
    // slot in the output `sources[]`. Pass the real source count so
    // malformed maps hit `Fail` and we fall back cleanly.
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
        crate::ParseResult::Success(x) => x,
        crate::ParseResult::Fail(_) => return Err(InvalidSourceMap),
    };

    let mut psm = map_data;
    psm.external_source_names = source_paths_slice;

    Ok(Box::new(InputSourceMap {
        map: Arc::new(psm),
        sources_content: sources_content_slice.into_boxed_slice(),
    }))
}

/// Find the trailing `//# sourceMappingURL=<url>` comment in a file. Per
/// the Source Map spec the comment MUST be on the last line of the file
/// (see "3. Source Map Format" / "Linking generated code to source maps"),
/// so we anchor to the final line rather than the first `last_index_of`
/// match — a string literal earlier in the file containing that needle
/// must not hijack the lookup.
fn find_source_mapping_url(source: &[u8]) -> Option<&[u8]> {
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

    let last_line_start = match body.iter().rposition(|&b| b == b'\n') {
        Some(i) => i + 1,
        None => 0,
    };
    let last_line = &body[last_line_start..];

    const NEEDLE: &[u8] = b"//# sourceMappingURL=";
    if !last_line.starts_with(NEEDLE) {
        return None;
    }
    let mut url = &last_line[NEEDLE.len()..];
    // Trim whitespace on both sides within the line. Matches Zig's
    // `bun.strings.trim(_, " \r\t")`; a leading space after `=` (e.g.
    // `//# sourceMappingURL= data:...`) is spec-invalid but some
    // toolchains emit it, and `parse_data_url` would fail on the
    // leading space without this.
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

/// Decode `data:application/json[;...;base64],...` payloads. Returns `None`
/// when the URL is not a supported data scheme.
fn parse_data_url(url: &[u8]) -> Option<Box<InputSourceMap>> {
    const PREFIX: &[u8] = b"data:application/json";
    if !url.starts_with(PREFIX) || url.len() <= PREFIX.len() + 1 {
        return None;
    }

    // `data:application/json;charset=utf-8;base64,...` is permitted in the
    // wild; tolerate any number of `;name[=value]` parameters between the
    // prefix and the final `;base64,` / `,` separator.
    let mut rest = &url[PREFIX.len()..];
    let mut is_base64 = false;
    while !rest.is_empty() && rest[0] == b';' {
        let after = &rest[1..];
        // Advance past one parameter up to the next ';' or ','.
        let param_end = after.iter().position(|&b| b == b';' || b == b',')?;
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

// ported from: src/sourcemap/InputSourceMap.zig
