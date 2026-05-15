//! MetafileBuilder generates metafile JSON output compatible with esbuild's format.
//!
//! The metafile format is:
//! ```json
//! {
//!   "inputs": {
//!     "path/to/file.js": {
//!       "bytes": 1234,
//!       "imports": [
//!         { "path": "dependency.js", "kind": "import-statement" },
//!         { "path": "external", "kind": "require-call", "external": true }
//!       ],
//!       "format": "esm"
//!     }
//!   },
//!   "outputs": {
//!     "path/to/output.js": {
//!       "bytes": 5678,
//!       "inputs": {
//!         "path/to/file.js": { "bytesInOutput": 1200 }
//!       },
//!       "imports": [
//!         { "path": "chunk.js", "kind": "import-statement" }
//!       ],
//!       "exports": ["default", "foo"],
//!       "entryPoint": "path/to/file.js"
//!     }
//!   }
//! }
//! ```

use crate::mal_prelude::*;
use std::io::Write;

use bstr::BStr;
use bun_collections::VecExt;
use bun_collections::{DynamicBitSet, StringHashMap};
use bun_core::fmt as bfmt;
use bun_core::string_joiner::StringJoiner;
use bun_core::strings;

use bun_ast::ExportsKind;
use bun_ast::ImportKind;
use bun_ast::ImportRecordFlags;

use crate::chunk::Content as ChunkContent;
use crate::options::Loader;
use crate::{Chunk, Index, LinkerContext};

#[inline]
fn fmt_size(bytes: u64) -> bfmt::SizeFormatter {
    bfmt::size(bytes as usize, Default::default())
}

/// Generates the JSON fragment for a single output chunk.
/// Called during parallel chunk generation in postProcessJSChunk/postProcessCSSChunk.
/// The result is stored in chunk.metafile_chunk_json and assembled later.
pub fn generate_chunk_json(
    c: &LinkerContext,
    chunk: &Chunk,
    chunks: &[Chunk],
) -> Result<Box<[u8]>, bun_core::Error> {
    let mut json: Vec<u8> = Vec::new();
    // errdefer json.deinit() — handled by Drop on early return

    let parse_graph = c.parse_graph();
    let sources = parse_graph.input_files.items_source();

    // Start chunk entry: "path/to/output.js": {
    write_json_string(&mut json, &chunk.final_rel_path)?;
    json.extend_from_slice(b": {");

    // Write bytes
    let chunk_bytes = chunk.intermediate_output.get_size();
    write!(json, "\n      \"bytes\": {}", chunk_bytes)?;

    // Write inputs for this output (bytesInOutput is pre-computed during chunk generation)
    json.extend_from_slice(b",\n      \"inputs\": {");
    let mut first_chunk_input = true;
    let chunk_keys = chunk.files_with_parts_in_chunk.keys();
    let chunk_values = chunk.files_with_parts_in_chunk.values();
    for (file_source_index, bytes_in_output) in chunk_keys.iter().zip(chunk_values.iter()) {
        let file_source_index = *file_source_index;
        // Counters are `AtomicUsize` because they're populated by the parallel
        // codegen workers; metafile emission runs strictly after the
        // `wait_for_all` join in `generate_chunks_in_parallel`, so a relaxed
        // load observes the final value.
        let bytes_in_output = bytes_in_output.load(core::sync::atomic::Ordering::Relaxed);
        if file_source_index as usize >= sources.len() {
            continue;
        }
        if file_source_index == Index::RUNTIME.get() {
            continue;
        }

        let file_source = &sources[file_source_index as usize];
        if file_source.path.text.is_empty() {
            continue;
        }
        let file_path = file_source.path.pretty;
        if file_path.is_empty() {
            continue;
        }

        if !first_chunk_input {
            json.extend_from_slice(b",");
        }
        first_chunk_input = false;

        json.extend_from_slice(b"\n        ");
        write_json_string(&mut json, file_path)?;
        write!(
            json,
            ": {{\n          \"bytesInOutput\": {}\n        }}",
            bytes_in_output
        )?;
    }
    json.extend_from_slice(b"\n      }");

    // Write cross-chunk imports
    json.extend_from_slice(b",\n      \"imports\": [");
    let mut first_chunk_import = true;
    for cross_import in chunk.cross_chunk_imports.slice() {
        // Bounds check to prevent OOB access from corrupted data
        if cross_import.chunk_index as usize >= chunks.len() {
            continue;
        }

        if !first_chunk_import {
            json.extend_from_slice(b",");
        }
        first_chunk_import = false;

        let imported_chunk = &chunks[cross_import.chunk_index as usize];
        json.extend_from_slice(b"\n        {\n          \"path\": ");
        write_json_string(&mut json, &imported_chunk.final_rel_path)?;
        json.extend_from_slice(b",\n          \"kind\": ");
        write_json_string(&mut json, cross_import.import_kind.label())?;
        json.extend_from_slice(b"\n        }");
    }
    json.extend_from_slice(b"\n      ]");

    // Write exports and entry point if applicable
    // Use sorted_and_filtered_export_aliases for deterministic output and to exclude internal exports
    json.extend_from_slice(b",\n      \"exports\": [");
    if chunk.entry_point.is_entry_point() {
        let entry_source_index = chunk.entry_point.source_index();
        // Use sources.len as the authoritative bounds check
        if (entry_source_index as usize) < sources.len() {
            let sorted_exports = &c.graph.meta.items_sorted_and_filtered_export_aliases()
                [entry_source_index as usize];
            let mut first_export = true;
            for alias in sorted_exports.iter() {
                if !first_export {
                    json.extend_from_slice(b",");
                }
                first_export = false;
                json.extend_from_slice(b"\n        ");
                write_json_string(&mut json, alias)?;
            }
            if !first_export {
                json.extend_from_slice(b"\n      ");
            }
        }
    }
    json.extend_from_slice(b"]");

    // Write entry point path
    if chunk.entry_point.is_entry_point() {
        let entry_source_index = chunk.entry_point.source_index();
        if (entry_source_index as usize) < sources.len() {
            let entry_source = &sources[entry_source_index as usize];
            if !entry_source.path.text.is_empty() && !entry_source.path.pretty.is_empty() {
                json.extend_from_slice(b",\n      \"entryPoint\": ");
                write_json_string(&mut json, entry_source.path.pretty)?;
            }
        }
    }

    // Write cssBundle if this JS chunk has associated CSS
    if let ChunkContent::Javascript(js) = &chunk.content {
        let css_chunks = &js.css_chunks;
        if !css_chunks.is_empty() {
            // Get the first CSS chunk path
            let css_chunk_index = css_chunks[0];
            if (css_chunk_index as usize) < chunks.len() {
                let css_chunk = &chunks[css_chunk_index as usize];
                if !css_chunk.final_rel_path.is_empty() {
                    json.extend_from_slice(b",\n      \"cssBundle\": ");
                    write_json_string(&mut json, &css_chunk.final_rel_path)?;
                }
            }
        }
    }

    json.extend_from_slice(b"\n    }");

    Ok(json.into_boxed_slice())
}

/// Assembles the final metafile JSON from pre-built chunk fragments.
/// Called after all chunks have been generated in parallel.
/// Chunk references (unique_keys) are resolved to their final output paths.
/// The caller is responsible for freeing the returned slice.
pub fn generate(c: &mut LinkerContext, chunks: &mut [Chunk]) -> Result<Box<[u8]>, bun_core::Error> {
    // Use StringJoiner so we can use breakOutputIntoPieces to resolve chunk references
    let mut j = StringJoiner::default();
    // errdefer j.deinit() — handled by Drop

    j.push_static(b"{\n  \"inputs\": {");

    // Collect all input files that are reachable
    let mut first_input = true;
    let parse_graph = c.parse_graph();
    let sources = parse_graph.input_files.items_source();
    let loaders = parse_graph.input_files.items_loader();
    let import_records_list = parse_graph.ast.items_import_records();

    // Iterate through all files in chunks to collect unique source indices
    let mut seen_sources = DynamicBitSet::init_empty(sources.len())?;
    // defer seen_sources.deinit() — handled by Drop

    // Mark all files that appear in chunks
    for chunk in chunks.iter() {
        for &source_index in chunk.files_with_parts_in_chunk.keys() {
            if (source_index as usize) < sources.len() {
                seen_sources.set(source_index as usize);
            }
        }
    }

    // Write inputs
    let mut source_index: u32 = 0;
    while (source_index as usize) < sources.len() {
        // (defer-style increment moved to end of loop body)
        let si = source_index;
        source_index += 1;
        let source_index = si;

        if !seen_sources.is_set(source_index as usize) {
            continue;
        }

        // Skip runtime and other special files
        if source_index == Index::RUNTIME.get() {
            continue;
        }

        let source = &sources[source_index as usize];
        if source.path.text.is_empty() {
            continue;
        }

        let path = source.path.pretty;
        if path.is_empty() {
            continue;
        }

        if !first_input {
            j.push_static(b",");
        }
        first_input = false;

        j.push_static(b"\n    ");
        {
            let mut buf: Vec<u8> = Vec::new();
            write!(
                buf,
                "{}",
                bfmt::format_json_string_utf8(path, Default::default())
            )?;
            j.push_owned(buf.into_boxed_slice());
        }
        {
            let mut buf: Vec<u8> = Vec::new();
            write!(buf, ": {{\n      \"bytes\": {}", source.contents.len())?;
            j.push_owned(buf.into_boxed_slice());
        }

        // Write imports
        j.push_static(b",\n      \"imports\": [");
        if (source_index as usize) < import_records_list.len() {
            let import_records = &import_records_list[source_index as usize];
            let mut first_import = true;
            for record in import_records.slice() {
                if record.kind == ImportKind::Internal {
                    continue;
                }

                if !first_import {
                    j.push_static(b",");
                }
                first_import = false;

                j.push_static(b"\n        {\n          \"path\": ");
                // Write path with JSON escaping - chunk references (unique_keys) will be resolved
                // by breakOutputIntoPieces and code() below
                {
                    let mut buf: Vec<u8> = Vec::new();
                    write!(
                        buf,
                        "{}",
                        bfmt::format_json_string_utf8(record.path.text, Default::default())
                    )?;
                    j.push_owned(buf.into_boxed_slice());
                }
                j.push_static(b",\n          \"kind\": \"");
                j.push_static(record.kind.label());
                j.push_static(b"\"");

                // Add "original" field if different from path
                if !record.original_path.is_empty() && record.original_path != record.path.text {
                    j.push_static(b",\n          \"original\": ");
                    let mut buf: Vec<u8> = Vec::new();
                    write!(
                        buf,
                        "{}",
                        bfmt::format_json_string_utf8(record.original_path, Default::default())
                    )?;
                    j.push_owned(buf.into_boxed_slice());
                }

                // Add "external": true for external imports
                if record
                    .flags
                    .contains(ImportRecordFlags::IS_EXTERNAL_WITHOUT_SIDE_EFFECTS)
                    || !record.source_index.is_valid()
                {
                    j.push_static(b",\n          \"external\": true");
                }

                // Add "with" for import attributes (json, toml, text loaders)
                if record.source_index.is_valid()
                    && (record.source_index.get() as usize) < loaders.len()
                {
                    let loader = loaders[record.source_index.get() as usize];
                    let with_type: Option<&'static [u8]> = match loader {
                        Loader::Json => Some(b"json"),
                        Loader::Toml => Some(b"toml"),
                        Loader::Text => Some(b"text"),
                        _ => None,
                    };
                    if let Some(wt) = with_type {
                        j.push_static(b",\n          \"with\": { \"type\": \"");
                        j.push_static(wt);
                        j.push_static(b"\" }");
                    }
                }

                j.push_static(b"\n        }");
            }
        }
        j.push_static(b"\n      ]");

        // Write format based on exports_kind (esm vs cjs detection)
        let loader = loaders[source_index as usize];
        let format: Option<&'static [u8]> = match loader {
            Loader::Js | Loader::Jsx | Loader::Ts | Loader::Tsx => 'blk: {
                let exports_kind = c.graph.ast.items_exports_kind();
                if (source_index as usize) < exports_kind.len() {
                    break 'blk match exports_kind[source_index as usize] {
                        ExportsKind::Cjs | ExportsKind::EsmWithDynamicFallbackFromCjs => {
                            Some(b"cjs" as &[u8])
                        }
                        ExportsKind::Esm | ExportsKind::EsmWithDynamicFallback => Some(b"esm"),
                        ExportsKind::None => None, // Unknown format, don't emit
                    };
                }
                None
            }
            Loader::Json => Some(b"json"),
            Loader::Css => Some(b"css"),
            _ => None,
        };
        if let Some(fmt) = format {
            j.push_static(b",\n      \"format\": \"");
            j.push_static(fmt);
            j.push_static(b"\"");
        }

        j.push_static(b"\n    }");
    }

    j.push_static(b"\n  },\n  \"outputs\": {");

    // Write outputs by joining pre-built chunk JSON fragments
    let mut first_output = true;
    for chunk in chunks.iter() {
        if chunk.final_rel_path.is_empty() {
            continue;
        }

        if !first_output {
            j.push_static(b",");
        }
        first_output = false;

        j.push_static(b"\n    ");
        // PORT NOTE: Zig pushes a borrowed slice; push_static borrows for the
        // lifetime of the joiner (`chunk.metafile_chunk_json: Box<[u8]>` outlives `j`).
        j.push_static(&chunk.metafile_chunk_json);
    }

    j.push_static(b"\n  }\n}\n");

    // If no chunks, there are no chunk references to resolve, so just return the joined string
    if chunks.is_empty() {
        return Ok(j.done()?);
    }

    // Break output into pieces and resolve chunk references to final paths
    let alloc = c.arena();
    let mut intermediate = c.break_output_into_pieces(
        alloc,
        &mut j,
        u32::try_from(chunks.len()).expect("int cast"),
    )?;

    // Get final output with all chunk references resolved.
    // PORT NOTE: Zig passes `&chunks[0]` as the dummy chunk and `chunks` as the
    // full slice (aliased). `code()` takes both as `&` now, so pass `&chunks[0]`
    // directly — overlapping shared borrows are fine.
    let code_result = intermediate.code(
        None,
        parse_graph,
        &c.graph,
        b"", // no import prefix for metafile
        &chunks[0],
        chunks,
        None,  // no display size
        false, // not force absolute path
        false, // no source map shifts
    )?;

    Ok(code_result.buffer)
}

fn write_json_string(writer: &mut impl Write, str: &[u8]) -> std::io::Result<()> {
    write!(
        writer,
        "{}",
        bfmt::format_json_string_utf8(str, Default::default())
    )
}

// ──────────────────────────────────────────────────────────────────────────
// Minimal `std.json.Value`-shaped tree for `generate_markdown`.
//
// PORT NOTE: Zig's `generateMarkdown` re-parses the metafile JSON via
// `std.json.parseFromSlice(std.json.Value, …)` — a generic dynamic-tree parse.
// The Rust crates available here (`bun_parsers::json`) only expose an
// AST-expr parser, so a small self-contained Value/parser is provided below
// covering exactly the subset the metafile format uses.
// ──────────────────────────────────────────────────────────────────────────

enum JsonValue {
    Null,
    Bool(bool),
    Integer(i64),
    Float(f64),
    String(Box<[u8]>),
    Array(Vec<JsonValue>),
    Object(JsonObject),
}

#[derive(Default)]
struct JsonObject {
    entries: Vec<(Box<[u8]>, JsonValue)>,
}

impl JsonObject {
    fn get(&self, key: &[u8]) -> Option<&JsonValue> {
        self.entries
            .iter()
            .find(|(k, _)| &k[..] == key)
            .map(|(_, v)| v)
    }
    fn contains(&self, key: &[u8]) -> bool {
        self.entries.iter().any(|(k, _)| &k[..] == key)
    }
    fn count(&self) -> usize {
        self.entries.len()
    }
    fn iter(&self) -> impl Iterator<Item = (&[u8], &JsonValue)> {
        self.entries.iter().map(|(k, v)| (&k[..], v))
    }
}

struct JsonParser<'a> {
    input: &'a [u8],
    pos: usize,
}

impl<'a> JsonParser<'a> {
    fn parse(input: &'a [u8]) -> Result<JsonValue, ()> {
        let mut p = JsonParser { input, pos: 0 };
        p.skip_ws();
        let v = p.parse_value()?;
        p.skip_ws();
        if p.pos != p.input.len() {
            return Err(());
        }
        Ok(v)
    }

    fn skip_ws(&mut self) {
        while self.pos < self.input.len()
            && matches!(self.input[self.pos], b' ' | b'\t' | b'\n' | b'\r')
        {
            self.pos += 1;
        }
    }

    fn peek(&self) -> Option<u8> {
        self.input.get(self.pos).copied()
    }

    fn expect(&mut self, c: u8) -> Result<(), ()> {
        if self.peek() == Some(c) {
            self.pos += 1;
            Ok(())
        } else {
            Err(())
        }
    }

    fn parse_value(&mut self) -> Result<JsonValue, ()> {
        match self.peek().ok_or(())? {
            b'{' => self.parse_object(),
            b'[' => self.parse_array(),
            b'"' => Ok(JsonValue::String(self.parse_string()?)),
            b't' => {
                if self.input[self.pos..].starts_with(b"true") {
                    self.pos += 4;
                    Ok(JsonValue::Bool(true))
                } else {
                    Err(())
                }
            }
            b'f' => {
                if self.input[self.pos..].starts_with(b"false") {
                    self.pos += 5;
                    Ok(JsonValue::Bool(false))
                } else {
                    Err(())
                }
            }
            b'n' => {
                if self.input[self.pos..].starts_with(b"null") {
                    self.pos += 4;
                    Ok(JsonValue::Null)
                } else {
                    Err(())
                }
            }
            b'-' | b'0'..=b'9' => self.parse_number(),
            _ => Err(()),
        }
    }

    fn parse_object(&mut self) -> Result<JsonValue, ()> {
        self.expect(b'{')?;
        let mut obj = JsonObject::default();
        self.skip_ws();
        if self.peek() == Some(b'}') {
            self.pos += 1;
            return Ok(JsonValue::Object(obj));
        }
        loop {
            self.skip_ws();
            let key = self.parse_string()?;
            self.skip_ws();
            self.expect(b':')?;
            self.skip_ws();
            let val = self.parse_value()?;
            obj.entries.push((key, val));
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b'}') => {
                    self.pos += 1;
                    return Ok(JsonValue::Object(obj));
                }
                _ => return Err(()),
            }
        }
    }

    fn parse_array(&mut self) -> Result<JsonValue, ()> {
        self.expect(b'[')?;
        let mut arr = Vec::new();
        self.skip_ws();
        if self.peek() == Some(b']') {
            self.pos += 1;
            return Ok(JsonValue::Array(arr));
        }
        loop {
            self.skip_ws();
            arr.push(self.parse_value()?);
            self.skip_ws();
            match self.peek() {
                Some(b',') => {
                    self.pos += 1;
                }
                Some(b']') => {
                    self.pos += 1;
                    return Ok(JsonValue::Array(arr));
                }
                _ => return Err(()),
            }
        }
    }

    fn parse_string(&mut self) -> Result<Box<[u8]>, ()> {
        self.expect(b'"')?;
        let mut out: Vec<u8> = Vec::new();
        while let Some(c) = self.peek() {
            self.pos += 1;
            match c {
                b'"' => return Ok(out.into_boxed_slice()),
                b'\\' => {
                    let esc = self.peek().ok_or(())?;
                    self.pos += 1;
                    match esc {
                        b'"' => out.push(b'"'),
                        b'\\' => out.push(b'\\'),
                        b'/' => out.push(b'/'),
                        b'b' => out.push(0x08),
                        b'f' => out.push(0x0C),
                        b'n' => out.push(b'\n'),
                        b'r' => out.push(b'\r'),
                        b't' => out.push(b'\t'),
                        b'u' => {
                            let mut cp = u32::from(
                                bun_core::fmt::parse_hex4(&self.input[self.pos..]).ok_or(())?,
                            );
                            self.pos += 4;
                            // Handle surrogate pair (cp/lo are \uHHHH-parsed so <=0xFFFF, cast is lossless)
                            if bun_core::strings::u16_is_lead(cp as u16)
                                && self.input[self.pos..].starts_with(b"\\u")
                                && self.pos + 6 <= self.input.len()
                            {
                                let lo =
                                    bun_core::fmt::parse_hex4(&self.input[self.pos + 2..]).ok_or(())?;
                                if let Some(full) =
                                    bun_core::strings::decode_surrogate_pair(cp as u16, lo)
                                {
                                    self.pos += 6;
                                    cp = full;
                                }
                            }
                            match char::from_u32(cp) {
                                Some(ch) => {
                                    let mut buf = [0u8; 4];
                                    out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                                }
                                None => out.extend_from_slice(b"\xEF\xBF\xBD"),
                            }
                        }
                        _ => return Err(()),
                    }
                }
                _ => out.push(c),
            }
        }
        Err(())
    }

    fn parse_number(&mut self) -> Result<JsonValue, ()> {
        let start = self.pos;
        if self.peek() == Some(b'-') {
            self.pos += 1;
        }
        while matches!(self.peek(), Some(b'0'..=b'9')) {
            self.pos += 1;
        }
        let mut is_float = false;
        if self.peek() == Some(b'.') {
            is_float = true;
            self.pos += 1;
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        if matches!(self.peek(), Some(b'e' | b'E')) {
            is_float = true;
            self.pos += 1;
            if matches!(self.peek(), Some(b'+' | b'-')) {
                self.pos += 1;
            }
            while matches!(self.peek(), Some(b'0'..=b'9')) {
                self.pos += 1;
            }
        }
        let s = &self.input[start..self.pos];
        if is_float {
            Ok(JsonValue::Float(bun_core::fmt::parse_f64(s).ok_or(())?))
        } else {
            Ok(JsonValue::Integer(
                bun_core::fmt::parse_int::<i64>(s, 10).map_err(|_| ())?,
            ))
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// generate_markdown helper structs (local to the function in Zig; hoisted here)
// PORT NOTE: lifetime <'a> ties borrowed slices to the parsed JSON value's
// lifetime. The Zig originals were anonymous structs holding []const u8 that
// borrowed from the std.json parse arena.
// ──────────────────────────────────────────────────────────────────────────

struct InputFileInfo<'a> {
    path: &'a [u8],
    bytes_in_output: u64,
    import_count: u32,
    is_node_modules: bool,
    format: &'a [u8],
}

struct ModuleSize<'a> {
    path: &'a [u8],
    bytes: u64,
}

struct ImportedByInfo<'a> {
    path: &'a [u8],
    count: usize,
}

struct PathOnly<'a> {
    path: &'a [u8],
}

/// Generates a markdown visualization of the module graph from metafile JSON.
/// This is a post-processing step that parses the JSON and produces LLM-friendly output.
/// Designed to help diagnose bundle bloat, dependency chains, and entry point analysis.
/// The caller is responsible for freeing the returned slice.
pub fn generate_markdown(metafile_json: &[u8]) -> Result<Box<[u8]>, bun_core::Error> {
    let root = match JsonParser::parse(metafile_json) {
        Ok(v) => v,
        Err(_) => return Err(bun_core::err!(InvalidJSON)),
    };
    // defer parsed.deinit() — handled by Drop

    let JsonValue::Object(root_obj) = &root else {
        return Err(bun_core::err!(InvalidJSON));
    };

    let mut md: Vec<u8> = Vec::new();
    // errdefer md.deinit() — handled by Drop

    // Get inputs and outputs
    let Some(inputs) = root_obj.get(b"inputs") else {
        return Err(bun_core::err!(InvalidJSON));
    };
    let Some(outputs) = root_obj.get(b"outputs") else {
        return Err(bun_core::err!(InvalidJSON));
    };

    let (JsonValue::Object(inputs_obj), JsonValue::Object(outputs_obj)) = (inputs, outputs) else {
        return Err(bun_core::err!(InvalidJSON));
    };

    // Header
    md.extend_from_slice(b"# Bundle Analysis Report\n\n");
    md.extend_from_slice(b"This report helps identify bundle size issues, dependency bloat, and optimization opportunities.\n\n");

    // Table of Contents for easy navigation
    md.extend_from_slice(b"## Table of Contents\n\n");
    md.extend_from_slice(b"- [Quick Summary](#quick-summary)\n");
    md.extend_from_slice(
        b"- [Largest Modules by Output Contribution](#largest-modules-by-output-contribution)\n",
    );
    md.extend_from_slice(b"- [Entry Point Analysis](#entry-point-analysis)\n");
    md.extend_from_slice(b"- [Dependency Chains](#dependency-chains)\n");
    md.extend_from_slice(b"- [Full Module Graph](#full-module-graph)\n");
    md.extend_from_slice(b"- [Raw Data for Searching](#raw-data-for-searching)\n\n");
    md.extend_from_slice(b"---\n\n");

    // ==================== SUMMARY ====================
    md.extend_from_slice(b"## Quick Summary\n\n");

    let mut total_output_bytes: u64 = 0;
    let mut esm_count: u32 = 0;
    let mut cjs_count: u32 = 0;
    let mut json_count: u32 = 0;
    let mut external_count: u32 = 0;
    let mut node_modules_count: u32 = 0;
    let mut node_modules_bytes: u64 = 0;

    // Build a map of module path -> bytesInOutput (bytes contributed to output)
    // This aggregates from all outputs since a module may appear in multiple chunks
    let mut bytes_in_output: StringHashMap<u64> = StringHashMap::default();
    // defer bytes_in_output.deinit() — handled by Drop

    // First pass through outputs to collect bytesInOutput for each module
    for (_, out_value) in outputs_obj.iter() {
        let JsonValue::Object(output) = out_value else {
            continue;
        };

        if let Some(output_inputs) = output.get(b"inputs") {
            if let JsonValue::Object(oi_obj) = output_inputs {
                for (module_path, module_info) in oi_obj.iter() {
                    if let JsonValue::Object(mi_obj) = module_info {
                        if let Some(bio) = mi_obj.get(b"bytesInOutput") {
                            if let JsonValue::Integer(bio_int) = bio {
                                let bytes_val: u64 = u64::try_from(*bio_int).expect("int cast");
                                let gop = bytes_in_output.get_or_put(module_path)?;
                                if gop.found_existing {
                                    *gop.value_ptr += bytes_val;
                                } else {
                                    *gop.value_ptr = bytes_val;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Build reverse dependency map: who imports each file?
    // Also collect input file data for sorting
    let mut input_files: Vec<InputFileInfo> = Vec::new();

    let mut imported_by: StringHashMap<Vec<&[u8]>> = StringHashMap::default();
    // defer { ... imported_by.deinit() } — handled by Drop (Vec values drop automatically)

    // Second pass: collect all input file info and build reverse dependency map
    for (path, input) in inputs_obj.iter() {
        let JsonValue::Object(input_obj) = input else {
            continue;
        };

        let is_node_modules = strings::index_of(path, b"node_modules").is_some();
        let module_bytes = bytes_in_output.get(path).copied().unwrap_or(0);

        let mut info = InputFileInfo {
            path,
            bytes_in_output: module_bytes,
            import_count: 0,
            is_node_modules,
            format: b"",
        };

        if is_node_modules {
            node_modules_bytes += module_bytes;
            node_modules_count += 1;
        }

        if let Some(format) = input_obj.get(b"format") {
            if let JsonValue::String(format_str) = format {
                info.format = format_str;
                if &format_str[..] == b"esm" {
                    esm_count += 1;
                } else if &format_str[..] == b"cjs" {
                    cjs_count += 1;
                } else if &format_str[..] == b"json" {
                    json_count += 1;
                }
            }
        }

        // Build reverse dependency map
        if let Some(imps) = input_obj.get(b"imports") {
            if let JsonValue::Array(imps_arr) = imps {
                info.import_count = u32::try_from(imps_arr.len()).expect("int cast");
                for imp in imps_arr.iter() {
                    if let JsonValue::Object(imp_obj) = imp {
                        if let Some(ext) = imp_obj.get(b"external") {
                            if let JsonValue::Bool(true) = ext {
                                external_count += 1;
                                continue;
                            }
                        }
                        if let Some(imp_path) = imp_obj.get(b"path") {
                            if let JsonValue::String(target) = imp_path {
                                // Try to find the matching input key for this import
                                // The import path may be absolute while input keys are relative
                                // Or it may be a relative path like "../utils/logger.js"
                                let target: &[u8] = target;

                                // First, try exact match
                                let mut matched_key: Option<&[u8]> = None;
                                if inputs_obj.contains(target) {
                                    matched_key = Some(target);
                                } else {
                                    // Try matching by basename or suffix
                                    for (input_key, _) in inputs_obj.iter() {
                                        // Check if target ends with the input key
                                        if target.ends_with(input_key) {
                                            // Make sure it's a path boundary (preceded by / or \ or start)
                                            if target.len() == input_key.len()
                                                || (target.len() > input_key.len()
                                                    && (target[target.len() - input_key.len() - 1]
                                                        == b'/'
                                                        || target
                                                            [target.len() - input_key.len() - 1]
                                                            == b'\\'))
                                            {
                                                matched_key = Some(input_key);
                                                break;
                                            }
                                        }
                                        // Also check if input_key ends with target (for relative paths)
                                        // e.g., target="../utils/logger.js" might match "src/utils/logger.js"
                                        if strings::index_of(target, b"..").is_some() {
                                            // This is a relative path, try matching just the filename parts
                                            let target_base = bun_paths::basename(target);
                                            let key_base = bun_paths::basename(input_key);
                                            if target_base == key_base {
                                                // Check if paths share common suffix
                                                let target_without_dots = strip_parent_refs(target);
                                                if input_key.ends_with(target_without_dots) {
                                                    matched_key = Some(input_key);
                                                    break;
                                                }
                                            }
                                        }
                                    }
                                }

                                if let Some(key) = matched_key {
                                    let gop = imported_by.get_or_put(key)?;
                                    if !gop.found_existing {
                                        *gop.value_ptr = Vec::new();
                                    }
                                    gop.value_ptr.push(path);
                                }
                            }
                        }
                    }
                }
            }
        }

        input_files.push(info);
    }

    // Count outputs and entry points
    let mut entry_point_count: u32 = 0;
    let mut chunk_count: u32 = 0;
    for (_, out_value) in outputs_obj.iter() {
        if let JsonValue::Object(out_obj) = out_value {
            if let Some(bytes) = out_obj.get(b"bytes") {
                if let JsonValue::Integer(bytes_int) = bytes {
                    total_output_bytes += u64::try_from(*bytes_int).expect("int cast");
                }
            }
            if out_obj.get(b"entryPoint").is_some() {
                entry_point_count += 1;
            } else {
                chunk_count += 1;
            }
        }
    }

    // Summary table
    md.extend_from_slice(b"| Metric | Value |\n");
    md.extend_from_slice(b"|--------|-------|\n");
    write!(
        md,
        "| Total output size | {} |\n",
        fmt_size(total_output_bytes)
    )?;
    write!(md, "| Input modules | {} |\n", inputs_obj.count())?;
    if entry_point_count > 0 {
        write!(md, "| Entry points | {} |\n", entry_point_count)?;
    }
    if chunk_count > 0 {
        write!(md, "| Code-split chunks | {} |\n", chunk_count)?;
    }
    if node_modules_count > 0 {
        write!(
            md,
            "| node_modules contribution | {} files ({}) |\n",
            node_modules_count,
            fmt_size(node_modules_bytes)
        )?;
    }
    if esm_count > 0 {
        write!(md, "| ESM modules | {} |\n", esm_count)?;
    }
    if cjs_count > 0 {
        write!(md, "| CommonJS modules | {} |\n", cjs_count)?;
    }
    if json_count > 0 {
        write!(md, "| JSON files | {} |\n", json_count)?;
    }
    if external_count > 0 {
        write!(md, "| External imports | {} |\n", external_count)?;
    }

    // ==================== LARGEST MODULES (BLOAT ANALYSIS) ====================
    md.extend_from_slice(b"\n## Largest Modules by Output Contribution\n\n");
    md.extend_from_slice(b"Modules sorted by bytes contributed to the output bundle. Large modules may indicate bloat.\n\n");

    // Sort by bytes_in_output descending
    input_files.sort_by(|a, b| b.bytes_in_output.cmp(&a.bytes_in_output));

    md.extend_from_slice(b"| Output Bytes | % of Total | Module | Format |\n");
    md.extend_from_slice(b"|--------------|------------|--------|--------|\n");

    let max_to_show: usize = 20;
    for (i, info) in input_files.iter().enumerate() {
        if i >= max_to_show {
            break;
        }
        if info.bytes_in_output == 0 {
            break; // Skip modules with no output contribution
        }
        let pct = if total_output_bytes > 0 {
            (info.bytes_in_output as f64) / (total_output_bytes as f64) * 100.0
        } else {
            0.0
        };
        write!(
            md,
            "| {} | {:.1}% | `{}` | {} |\n",
            fmt_size(info.bytes_in_output),
            pct,
            BStr::new(info.path),
            BStr::new(if !info.format.is_empty() {
                info.format
            } else {
                b"-"
            }),
        )?;
    }

    // Count remaining modules with non-zero contribution
    let mut remaining_count: usize = 0;
    if input_files.len() > max_to_show {
        for info in &input_files[max_to_show..] {
            if info.bytes_in_output > 0 {
                remaining_count += 1;
            }
        }
    }
    if remaining_count > 0 {
        write!(
            md,
            "\n*...and {} more modules with output contribution*\n",
            remaining_count
        )?;
    }

    // ==================== ENTRY POINT ANALYSIS ====================
    md.extend_from_slice(b"\n## Entry Point Analysis\n\n");
    md.extend_from_slice(
        b"Each entry point and the total code it loads (including shared chunks).\n\n",
    );

    for (output_path, out_value) in outputs_obj.iter() {
        let JsonValue::Object(output) = out_value else {
            continue;
        };

        let Some(entry_point) = output.get(b"entryPoint") else {
            continue;
        };
        let JsonValue::String(entry_point_str) = entry_point else {
            continue;
        };

        write!(md, "### Entry: `{}`\n\n", BStr::new(entry_point_str))?;

        // Output file info
        write!(md, "**Output file**: `{}`\n", BStr::new(output_path))?;

        if let Some(bytes) = output.get(b"bytes") {
            if let JsonValue::Integer(bytes_int) = bytes {
                write!(
                    md,
                    "**Bundle size**: {}\n",
                    fmt_size(u64::try_from(*bytes_int).expect("int cast"))
                )?;
            }
        }

        // CSS bundle
        if let Some(css_bundle) = output.get(b"cssBundle") {
            if let JsonValue::String(css_str) = css_bundle {
                write!(md, "**CSS bundle**: `{}`\n", BStr::new(css_str))?;
            }
        }

        // Exports
        if let Some(exports) = output.get(b"exports") {
            if let JsonValue::Array(exports_arr) = exports {
                if !exports_arr.is_empty() {
                    md.extend_from_slice(b"**Exports**: ");
                    let mut first = true;
                    let max_exports: usize = 10;
                    for (i, exp) in exports_arr.iter().enumerate() {
                        if i >= max_exports {
                            write!(md, " ...+{} more", exports_arr.len() - max_exports)?;
                            break;
                        }
                        if let JsonValue::String(exp_str) = exp {
                            if !first {
                                md.extend_from_slice(b", ");
                            }
                            first = false;
                            write!(md, "`{}`", BStr::new(exp_str))?;
                        }
                    }
                    md.extend_from_slice(b"\n");
                }
            }
        }

        // Chunk dependencies
        if let Some(chunk_imports) = output.get(b"imports") {
            if let JsonValue::Array(ci_arr) = chunk_imports {
                if !ci_arr.is_empty() {
                    md.extend_from_slice(b"\n**Loads these chunks** (code-splitting):\n");
                    for imp in ci_arr.iter() {
                        if let JsonValue::Object(imp_obj) = imp {
                            let Some(path) = imp_obj.get(b"path") else {
                                continue;
                            };
                            let Some(kind) = imp_obj.get(b"kind") else {
                                continue;
                            };
                            if let (JsonValue::String(path_str), JsonValue::String(kind_str)) =
                                (path, kind)
                            {
                                // Try to get chunk size
                                if let Some(chunk) = outputs_obj.get(path_str) {
                                    if let JsonValue::Object(chunk_obj) = chunk {
                                        if let Some(bytes) = chunk_obj.get(b"bytes") {
                                            if let JsonValue::Integer(bytes_int) = bytes {
                                                write!(
                                                    md,
                                                    "- `{}` ({}, {})\n",
                                                    BStr::new(path_str),
                                                    fmt_size(
                                                        u64::try_from(*bytes_int)
                                                            .expect("int cast")
                                                    ),
                                                    BStr::new(kind_str),
                                                )?;
                                                continue;
                                            }
                                        }
                                    }
                                }
                                write!(
                                    md,
                                    "- `{}` ({})\n",
                                    BStr::new(path_str),
                                    BStr::new(kind_str)
                                )?;
                            }
                        }
                    }
                }
            }
        }

        // Modules bundled into this entry
        if let Some(output_inputs) = output.get(b"inputs") {
            if let JsonValue::Object(oi_obj) = output_inputs {
                if oi_obj.count() > 0 {
                    md.extend_from_slice(b"\n**Bundled modules** (sorted by contribution):\n\n");
                    md.extend_from_slice(b"| Bytes | Module |\n");
                    md.extend_from_slice(b"|-------|--------|\n");

                    // Collect and sort by size
                    let mut module_sizes: Vec<ModuleSize> = Vec::new();

                    for (module_path, module_info) in oi_obj.iter() {
                        if let JsonValue::Object(mi_obj) = module_info {
                            if let Some(bio) = mi_obj.get(b"bytesInOutput") {
                                if let JsonValue::Integer(bio_int) = bio {
                                    module_sizes.push(ModuleSize {
                                        path: module_path,
                                        bytes: u64::try_from(*bio_int).expect("int cast"),
                                    });
                                }
                            }
                        }
                    }

                    module_sizes.sort_by(|a, b| b.bytes.cmp(&a.bytes));

                    let max_modules: usize = 15;
                    for (i, ms) in module_sizes.iter().enumerate() {
                        if i >= max_modules {
                            break;
                        }
                        write!(
                            md,
                            "| {} | `{}` |\n",
                            fmt_size(ms.bytes),
                            BStr::new(ms.path)
                        )?;
                    }
                    if module_sizes.len() > max_modules {
                        write!(
                            md,
                            "\n*...and {} more modules*\n",
                            module_sizes.len() - max_modules
                        )?;
                    }
                }
            }
        }

        md.extend_from_slice(b"\n");
    }

    // ==================== DEPENDENCY CHAINS (WHY IS THIS INCLUDED?) ====================
    md.extend_from_slice(b"## Dependency Chains\n\n");
    md.extend_from_slice(b"For each module, shows what files import it. Use this to understand why a module is included.\n\n");

    // Show modules that are imported by many files (potential optimization targets)
    let mut highly_imported: Vec<ImportedByInfo> = Vec::new();

    for (key, value) in imported_by.iter() {
        highly_imported.push(ImportedByInfo {
            path: key,
            count: value.len(),
        });
    }

    highly_imported.sort_by(|a, b| b.count.cmp(&a.count));

    // Show most commonly imported modules
    if !highly_imported.is_empty() {
        md.extend_from_slice(b"### Most Commonly Imported Modules\n\n");
        md.extend_from_slice(
            b"Modules imported by many files. Extracting these to shared chunks may help.\n\n",
        );
        md.extend_from_slice(b"| Import Count | Module | Imported By |\n");
        md.extend_from_slice(b"|--------------|--------|-------------|\n");

        let max_common: usize = 15;
        for (i, hi) in highly_imported.iter().enumerate() {
            if i >= max_common {
                break;
            }
            if hi.count < 2 {
                break; // Only show if imported by 2+ files
            }

            write!(md, "| {} | `{}` | ", hi.count, BStr::new(hi.path))?;

            // Show first few importers
            if let Some(importers) = imported_by.get(hi.path) {
                let max_importers: usize = 3;
                for (j, importer) in importers.iter().enumerate() {
                    if j >= max_importers {
                        write!(md, "+{} more", importers.len() - max_importers)?;
                        break;
                    }
                    if j > 0 {
                        md.extend_from_slice(b", ");
                    }
                    write!(md, "`{}`", BStr::new(importer))?;
                }
            }
            md.extend_from_slice(b" |\n");
        }
    }

    // ==================== FULL MODULE GRAPH ====================
    md.extend_from_slice(b"\n## Full Module Graph\n\n");
    md.extend_from_slice(b"Complete dependency information for each module.\n\n");

    // Sort inputs alphabetically for easier navigation
    let mut sorted_paths: Vec<PathOnly> = Vec::new();

    for (key, _) in inputs_obj.iter() {
        sorted_paths.push(PathOnly { path: key });
    }

    sorted_paths.sort_by(|a, b| a.path.cmp(b.path));

    for sp in sorted_paths.iter() {
        let input_path = sp.path;
        let Some(input) = inputs_obj.get(input_path) else {
            continue;
        };
        let JsonValue::Object(input_obj) = input else {
            continue;
        };

        write!(md, "### `{}`\n\n", BStr::new(input_path))?;

        // Show bytes contributed to output
        if let Some(contrib) = bytes_in_output.get(input_path) {
            if *contrib > 0 {
                write!(md, "- **Output contribution**: {}\n", fmt_size(*contrib))?;
            }
        }

        if let Some(format) = input_obj.get(b"format") {
            if let JsonValue::String(format_str) = format {
                write!(md, "- **Format**: {}\n", BStr::new(format_str))?;
            }
        }

        // Who imports this file?
        if let Some(importers) = imported_by.get(input_path) {
            write!(md, "- **Imported by** ({} files):", importers.len())?;
            if importers.len() <= 5 {
                for importer in importers.iter() {
                    write!(md, " `{}`", BStr::new(importer))?;
                }
            } else {
                for importer in importers[0..5].iter() {
                    write!(md, " `{}`", BStr::new(importer))?;
                }
                write!(md, " +{} more", importers.len() - 5)?;
            }
            md.extend_from_slice(b"\n");
        } else {
            // This is likely an entry point
            md.extend_from_slice(b"- **Imported by**: (entry point or orphan)\n");
        }

        // What does this file import?
        if let Some(imps) = input_obj.get(b"imports") {
            if let JsonValue::Array(imps_arr) = imps {
                if !imps_arr.is_empty() {
                    md.extend_from_slice(b"- **Imports**:\n");
                    for imp in imps_arr.iter() {
                        if let JsonValue::Object(imp_obj) = imp {
                            let Some(path) = imp_obj.get(b"path") else {
                                continue;
                            };
                            let Some(kind) = imp_obj.get(b"kind") else {
                                continue;
                            };
                            let (JsonValue::String(path_str), JsonValue::String(kind_str)) =
                                (path, kind)
                            else {
                                continue;
                            };

                            let is_external = 'blk: {
                                if let Some(ext) = imp_obj.get(b"external") {
                                    if let JsonValue::Bool(b) = ext {
                                        break 'blk *b;
                                    }
                                }
                                false
                            };

                            let original: Option<&[u8]> = 'blk: {
                                if let Some(orig) = imp_obj.get(b"original") {
                                    if let JsonValue::String(orig_str) = orig {
                                        break 'blk Some(orig_str);
                                    }
                                }
                                None
                            };

                            // Get output contribution of imported file if available
                            let imported_contrib: Option<u64> = if !is_external {
                                bytes_in_output.get(&path_str[..]).copied()
                            } else {
                                None
                            };

                            if is_external {
                                if let Some(orig) = original {
                                    write!(
                                        md,
                                        "  - `{}` ({}, **external**, specifier: `{}`)\n",
                                        BStr::new(path_str),
                                        BStr::new(kind_str),
                                        BStr::new(orig)
                                    )?;
                                } else {
                                    write!(
                                        md,
                                        "  - `{}` ({}, **external**)\n",
                                        BStr::new(path_str),
                                        BStr::new(kind_str)
                                    )?;
                                }
                            } else if let Some(contrib) = imported_contrib {
                                if contrib > 0 {
                                    if let Some(orig) = original {
                                        write!(
                                            md,
                                            "  - `{}` ({}, contributes {}, specifier: `{}`)\n",
                                            BStr::new(path_str),
                                            BStr::new(kind_str),
                                            fmt_size(contrib),
                                            BStr::new(orig)
                                        )?;
                                    } else {
                                        write!(
                                            md,
                                            "  - `{}` ({}, contributes {})\n",
                                            BStr::new(path_str),
                                            BStr::new(kind_str),
                                            fmt_size(contrib)
                                        )?;
                                    }
                                } else {
                                    if let Some(orig) = original {
                                        write!(
                                            md,
                                            "  - `{}` ({}, specifier: `{}`)\n",
                                            BStr::new(path_str),
                                            BStr::new(kind_str),
                                            BStr::new(orig)
                                        )?;
                                    } else {
                                        write!(
                                            md,
                                            "  - `{}` ({})\n",
                                            BStr::new(path_str),
                                            BStr::new(kind_str)
                                        )?;
                                    }
                                }
                            } else {
                                if let Some(orig) = original {
                                    write!(
                                        md,
                                        "  - `{}` ({}, specifier: `{}`)\n",
                                        BStr::new(path_str),
                                        BStr::new(kind_str),
                                        BStr::new(orig)
                                    )?;
                                } else {
                                    write!(
                                        md,
                                        "  - `{}` ({})\n",
                                        BStr::new(path_str),
                                        BStr::new(kind_str)
                                    )?;
                                }
                            }

                            // Show import attributes if present
                            if let Some(with) = imp_obj.get(b"with") {
                                if let JsonValue::Object(with_obj) = with {
                                    if let Some(type_val) = with_obj.get(b"type") {
                                        if let JsonValue::String(type_str) = type_val {
                                            write!(
                                                md,
                                                "    - with type: `{}`\n",
                                                BStr::new(type_str)
                                            )?;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        md.extend_from_slice(b"\n");
    }

    // ==================== RAW DATA FOR SEARCHING ====================
    md.extend_from_slice(b"## Raw Data for Searching\n\n");
    md.extend_from_slice(b"This section contains raw, grep-friendly data. Use these patterns:\n");
    md.extend_from_slice(b"- `[MODULE:` - Find all modules\n");
    md.extend_from_slice(b"- `[OUTPUT_BYTES:` - Find output contribution for each module\n");
    md.extend_from_slice(b"- `[IMPORT:` - Find all import relationships\n");
    md.extend_from_slice(b"- `[IMPORTED_BY:` - Find reverse dependencies\n");
    md.extend_from_slice(b"- `[ENTRY:` - Find entry points\n");
    md.extend_from_slice(b"- `[EXTERNAL:` - Find external imports\n");
    md.extend_from_slice(b"- `[NODE_MODULES:` - Find node_modules files\n\n");

    // All modules with output contribution
    md.extend_from_slice(b"### All Modules\n\n");
    md.extend_from_slice(b"```\n");
    for info in input_files.iter() {
        write!(md, "[MODULE: {}]\n", BStr::new(info.path))?;
        if info.bytes_in_output > 0 {
            write!(
                md,
                "[OUTPUT_BYTES: {} = {} bytes]\n",
                BStr::new(info.path),
                info.bytes_in_output
            )?;
        }
        if !info.format.is_empty() {
            write!(
                md,
                "[FORMAT: {} = {}]\n",
                BStr::new(info.path),
                BStr::new(info.format)
            )?;
        }
        if info.is_node_modules {
            write!(md, "[NODE_MODULES: {}]\n", BStr::new(info.path))?;
        }
    }
    md.extend_from_slice(b"```\n\n");

    // All import relationships
    md.extend_from_slice(b"### All Imports\n\n");
    md.extend_from_slice(b"```\n");
    for (source_path, input2) in inputs_obj.iter() {
        let JsonValue::Object(input2_obj) = input2 else {
            continue;
        };

        if let Some(imps) = input2_obj.get(b"imports") {
            if let JsonValue::Array(imps_arr) = imps {
                for imp in imps_arr.iter() {
                    if let JsonValue::Object(imp_obj) = imp {
                        let is_ext = 'blk: {
                            if let Some(ext) = imp_obj.get(b"external") {
                                if let JsonValue::Bool(b) = ext {
                                    break 'blk *b;
                                }
                            }
                            false
                        };

                        if let Some(imp_path) = imp_obj.get(b"path") {
                            if let JsonValue::String(imp_path_str) = imp_path {
                                if is_ext {
                                    write!(
                                        md,
                                        "[EXTERNAL: {} imports {}]\n",
                                        BStr::new(source_path),
                                        BStr::new(imp_path_str)
                                    )?;
                                } else {
                                    write!(
                                        md,
                                        "[IMPORT: {} -> {}]\n",
                                        BStr::new(source_path),
                                        BStr::new(imp_path_str)
                                    )?;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    md.extend_from_slice(b"```\n\n");

    // All reverse dependencies (imported by)
    md.extend_from_slice(b"### Reverse Dependencies (Imported By)\n\n");
    md.extend_from_slice(b"```\n");
    for (target, importers) in imported_by.iter() {
        for importer in importers.iter() {
            write!(
                md,
                "[IMPORTED_BY: {} <- {}]\n",
                BStr::new(target),
                BStr::new(importer)
            )?;
        }
    }
    md.extend_from_slice(b"```\n\n");

    // Entry points
    md.extend_from_slice(b"### Entry Points\n\n");
    md.extend_from_slice(b"```\n");
    for (output_path2, output2) in outputs_obj.iter() {
        let JsonValue::Object(output2_obj) = output2 else {
            continue;
        };

        if let Some(ep) = output2_obj.get(b"entryPoint") {
            if let JsonValue::String(ep_str) = ep {
                let mut size: u64 = 0;
                if let Some(bytes) = output2_obj.get(b"bytes") {
                    if let JsonValue::Integer(bytes_int) = bytes {
                        size = u64::try_from(*bytes_int).expect("int cast");
                    }
                }
                write!(
                    md,
                    "[ENTRY: {} -> {} ({} bytes)]\n",
                    BStr::new(ep_str),
                    BStr::new(output_path2),
                    size
                )?;
            }
        }
    }
    md.extend_from_slice(b"```\n\n");

    // node_modules summary
    if node_modules_count > 0 {
        md.extend_from_slice(b"### node_modules Summary\n\n");
        md.extend_from_slice(b"```\n");
        for info in input_files.iter() {
            if info.is_node_modules && info.bytes_in_output > 0 {
                write!(
                    md,
                    "[NODE_MODULES: {} (contributes {} bytes)]\n",
                    BStr::new(info.path),
                    info.bytes_in_output
                )?;
            }
        }
        md.extend_from_slice(b"```\n");
    }

    Ok(md.into_boxed_slice())
}

/// Strips leading "../" sequences from a relative path.
/// e.g., "../utils/logger.js" -> "utils/logger.js"
fn strip_parent_refs(path: &[u8]) -> &[u8] {
    let mut result = path;
    while result.len() >= 3 && result.starts_with(b"../") {
        result = &result[3..];
    }
    // Also handle ./ prefix
    while result.len() >= 2 && result.starts_with(b"./") {
        result = &result[2..];
    }
    result
}

// ported from: src/bundler/linker_context/MetafileBuilder.zig
