//! HTMLImportManifest generates JSON manifests for HTML imports in Bun's bundler.
//!
//! When you import an HTML file in JavaScript:
//! ```javascript
//! import index from "./index.html";
//! console.log(index);
//! ```
//!
//! Bun transforms this into a call to `__jsonParse()` with a JSON manifest containing
//! metadata about all the files generated from the HTML import:
//!
//! ```javascript
//! var src_default = __jsonParse(
//!   '{"index":"./index.html","files":[{"input":"index.html","path":"./index-f2me3qnf.js","loader":"js","isEntry":true,"headers":{"etag": "eet6gn75","content-type": "text/javascript;charset=utf-8"}},{"input":"index.html","path":"./index.html","loader":"html","isEntry":true,"headers":{"etag": "r9njjakd","content-type": "text/html;charset=utf-8"}},{"input":"index.html","path":"./index-gysa5fmk.css","loader":"css","isEntry":true,"headers":{"etag": "50zb7x61","content-type": "text/css;charset=utf-8"}},{"input":"logo.svg","path":"./logo-kygw735p.svg","loader":"file","isEntry":false,"headers":{"etag": "kygw735p","content-type": "application/octet-stream"}},{"input":"react.svg","path":"./react-ck11dneg.svg","loader":"file","isEntry":false,"headers":{"etag": "ck11dneg","content-type": "application/octet-stream"}}]}'
//! );
//! ```
//!
//! The manifest JSON structure contains:
//! - `index`: The original HTML file path
//! - `files`: Array of all generated files with metadata:
//!   - `input`: Original source file path
//!   - `path`: Generated output file path (with content hash)
//!   - `loader`: File type/loader used (js, css, html, file, etc.)
//!   - `isEntry`: Whether this file is an entry point
//!   - `headers`: HTTP headers including ETag and Content-Type
//!
//! This enables applications to:
//! 1. Know all files generated from an HTML import
//! 2. Get proper MIME types and ETags for serving files
//! 3. Implement proper caching strategies
//! 4. Handle assets referenced by the HTML file
//!
//! The manifest is generated during the linking phase and serialized as a JSON string
//! that gets embedded directly into the JavaScript output.

use crate::mal_prelude::*;
use core::fmt;

use bun_ast::Source;
use bun_collections::AutoBitSet;
use bun_collections::VecExt;
use bun_core::strings;
use bun_io::{FmtAdapter, Write};
use bun_js_printer::Encoding;
use bun_paths::resolve_path::relative_normalized;
use bun_resolver::fs::FileSystem;

use crate::Graph::{Graph, InputFileColumns as _};
use crate::chunk::{Content, Flags};
use crate::options::{Loader, OutputKind};
use crate::options_impl::LoaderExt as _;
use crate::{BundleV2, Chunk, LinkerGraph};

// TODO(port): lifetime — LIFETIMES.tsv has no rows for this file; classified as
// BORROW_PARAM (transient formatter struct passed by value).
#[derive(Clone, Copy)]
pub struct HTMLImportManifest<'a> {
    pub index: u32,
    pub graph: &'a Graph,
    pub chunks: &'a [Chunk],
    pub linker_graph: &'a LinkerGraph,
}

impl<'a> fmt::Display for HTMLImportManifest<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut adapter = FmtAdapter::new(writer);
        match write(
            self.index,
            self.graph,
            self.linker_graph,
            self.chunks,
            &mut adapter,
        ) {
            Ok(()) => Ok(()),
            // We use std.fmt.count for this
            // Zig: error.NoSpaceLeft => unreachable, error.OutOfMemory => return error.OutOfMemory
            Err(_) => Err(fmt::Error),
        }
    }
}

fn write_entry_item<W: Write + ?Sized>(
    writer: &mut W,
    input: &[u8],
    path: &[u8],
    hash: u64,
    loader: Loader,
    kind: OutputKind,
) -> Result<(), bun_core::Error> {
    writer.write_all(b"{")?;

    if !input.is_empty() {
        writer.write_all(b"\"input\":")?;
        bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(input, writer)?;
        writer.write_all(b",")?;
    }

    writer.write_all(b"\"path\":")?;
    bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(path, writer)?;

    writer.write_all(b",\"loader\":\"")?;
    // Zig: @tagName(loader) — strum is configured snake_case to match.
    writer.write_all(<&'static str>::from(loader).as_bytes())?;
    writer.write_all(b"\",\"isEntry\":")?;
    writer.write_all(if kind == OutputKind::EntryPoint {
        b"true" as &[u8]
    } else {
        b"false"
    })?;
    writer.write_all(b",\"headers\":{")?;

    if hash > 0 {
        const BASE64_BUF_LEN: usize =
            bun_base64::encode_len_from_size(core::mem::size_of::<u64>()) + 2;
        let mut base64_buf = [0u8; BASE64_BUF_LEN];
        let n = bun_base64::encode_url_safe(&mut base64_buf, &hash.to_ne_bytes());
        let base64 = &base64_buf[..n];
        writer.write_all(b"\"etag\":\"")?;
        writer.write_all(base64)?;
        writer.write_all(b"\",")?;
    }

    // Valid mime types are valid headers, which do not need to be escaped in JSON.
    let mime = loader.to_mime_type(&[path]);
    writer.write_all(b"\"content-type\":\"")?;
    writer.write_all(&mime.value)?;
    writer.write_all(b"\"")?;

    writer.write_all(b"}}")?;
    Ok(())
}

// Extremely unfortunate, but necessary due to E.String not accepting pre-escaped input and this happening at the very end.
pub fn write_escaped_json<W: Write + ?Sized>(
    index: u32,
    graph: &Graph,
    linker_graph: &LinkerGraph,
    chunks: &[Chunk],
    writer: &mut W,
) -> Result<(), bun_core::Error> {
    // PERF(port): was stack-fallback (std.heap.stackFallback(4096)) — profile in Phase B
    let mut bytes: Vec<u8> = Vec::new();
    write(index, graph, linker_graph, chunks, &mut bytes)?;
    bun_js_printer::write_pre_quoted_string::<_, b'"', false, true, { Encoding::Utf8 }>(
        &bytes, writer,
    )?;
    Ok(())
}

/// Newtype wrapper produced by [`HTMLImportManifest::format_escaped_json`].
/// Mirrors Zig's `std.fmt.Alt(HTMLImportManifest, escapedJSONFormatter)`.
pub struct EscapedJson<'a>(pub HTMLImportManifest<'a>);

impl<'a> fmt::Display for EscapedJson<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut adapter = FmtAdapter::new(writer);
        match write_escaped_json(
            self.0.index,
            self.0.graph,
            self.0.linker_graph,
            self.0.chunks,
            &mut adapter,
        ) {
            Ok(()) => Ok(()),
            // We use std.fmt.count for this
            // Zig: error.WriteFailed => unreachable, error.OutOfMemory => return error.WriteFailed
            Err(_) => Err(fmt::Error),
        }
    }
}

impl<'a> HTMLImportManifest<'a> {
    pub fn format_escaped_json(self) -> EscapedJson<'a> {
        EscapedJson(self)
    }
}

pub fn write<W: Write + ?Sized>(
    index: u32,
    graph: &Graph,
    linker_graph: &LinkerGraph,
    chunks: &[Chunk],
    writer: &mut W,
) -> Result<(), bun_core::Error> {
    let browser_source_index = graph.html_imports.html_source_indices.slice()[index as usize];
    let server_source_index = graph.html_imports.server_source_indices.slice()[index as usize];
    let sources: &[Source] = graph.input_files.items_source();
    // SAFETY: graph points to BundleV2.graph.
    let bv2: &BundleV2<'_> = unsafe {
        &*bun_core::from_field_ptr!(BundleV2<'static>, graph, std::ptr::from_ref::<Graph>(graph))
    };
    let options = &bv2.transpiler().options;
    let mut entry_point_bits = AutoBitSet::init_empty(graph.entry_points.len())?;

    let root_dir: &[u8] = if !options.root_dir.is_empty() {
        &options.root_dir[..]
    } else {
        // SAFETY: FileSystem singleton is initialized before bundling.
        FileSystem::get().top_level_dir
    };

    writer.write_all(b"{")?;

    let inject_compiler_filesystem_prefix = options.compile;
    // Use the server-side public path here.
    let public_path: &[u8] = &options.public_path;
    let mut temp_buffer: Vec<u8> = Vec::new();

    for ch in chunks.iter() {
        if ch.entry_point.source_index() == browser_source_index && ch.entry_point.is_entry_point()
        {
            entry_point_bits.set(ch.entry_point.entry_point_id() as usize);

            if matches!(ch.content, Content::Html) {
                writer.write_all(b"\"index\":")?;
                if inject_compiler_filesystem_prefix {
                    temp_buffer.clear();
                    temp_buffer.extend_from_slice(public_path);
                    temp_buffer
                        .extend_from_slice(strings::remove_leading_dot_slash(&ch.final_rel_path));
                    bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(
                        &temp_buffer,
                        writer,
                    )?;
                } else {
                    bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(
                        &ch.final_rel_path[..],
                        writer,
                    )?;
                }
                writer.write_all(b",")?;
            }
        }
    }

    // Start the files array

    writer.write_all(b"\"files\":[")?;

    let mut first = true;

    let additional_output_files = graph.additional_output_files.as_slice();
    let file_entry_bits: &[AutoBitSet] = linker_graph.files.items_entry_bits();
    let mut already_visited_output_file = AutoBitSet::init_empty(additional_output_files.len())?;

    // Write all chunks that have files associated with this entry point.
    // Also include browser chunks from server builds (lazy-loaded chunks from dynamic imports).
    // When there's only one HTML import, all browser chunks belong to that manifest.
    // When there are multiple HTML imports, only include chunks that intersect with this entry's bits.
    let has_single_html_import = graph.html_imports.html_source_indices.len() == 1;
    for ch in chunks.iter() {
        if ch.entry_bits().has_intersection(&entry_point_bits)
            || (has_single_html_import
                && ch.flags.contains(Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD))
        {
            if !first {
                writer.write_all(b",")?;
            }
            first = false;

            let input: &[u8] = if !ch.entry_point.is_entry_point() {
                b""
            } else {
                let path_for_key = relative_normalized::<bun_paths::platform::Posix, false>(
                    root_dir,
                    sources[ch.entry_point.source_index() as usize].path.text,
                );
                strings::remove_leading_dot_slash(path_for_key)
            };

            let path: &[u8] = if inject_compiler_filesystem_prefix {
                temp_buffer.clear();
                temp_buffer.extend_from_slice(public_path);
                temp_buffer
                    .extend_from_slice(strings::remove_leading_dot_slash(&ch.final_rel_path));
                &temp_buffer[..]
            } else {
                &ch.final_rel_path
            };

            write_entry_item(
                writer,
                input,
                path,
                // The HTML chunk's body embeds the hashed paths of its JS/CSS
                // chunks, so its etag must change when those do. `isolated_hash`
                // by design excludes those substitutions; the placeholder hash
                // folds them in via `appendIsolatedHashesForImportedChunks`.
                ch.template.placeholder.hash.unwrap_or(ch.isolated_hash),
                ch.content.loader(),
                if ch.entry_point.is_entry_point() {
                    OutputKind::EntryPoint
                } else {
                    OutputKind::Chunk
                },
            )?;
        }
    }

    for (i, output_file) in additional_output_files.iter().enumerate() {
        // Only print the file once.
        if already_visited_output_file.is_set(i) {
            continue;
        }

        if let Some(source_index) = output_file.source_index.unwrap() {
            if source_index.get() == server_source_index {
                continue;
            }
            let bits: &AutoBitSet = &file_entry_bits[source_index.get() as usize];

            if bits.has_intersection(&entry_point_bits) {
                already_visited_output_file.set(i);
                if !first {
                    writer.write_all(b",")?;
                }
                first = false;

                let path_for_key = relative_normalized::<bun_paths::platform::Posix, false>(
                    root_dir,
                    sources[source_index.get() as usize].path.text,
                );
                let path_for_key = strings::remove_leading_dot_slash(path_for_key);

                let path: &[u8] = if inject_compiler_filesystem_prefix {
                    temp_buffer.clear();
                    temp_buffer.extend_from_slice(public_path);
                    temp_buffer.extend_from_slice(strings::remove_leading_dot_slash(
                        &output_file.dest_path,
                    ));
                    &temp_buffer[..]
                } else {
                    &output_file.dest_path[..]
                };

                write_entry_item(
                    writer,
                    path_for_key,
                    path,
                    output_file.hash,
                    output_file.loader,
                    output_file.output_kind,
                )?;
            }
        }
    }

    writer.write_all(b"]}")?;
    Ok(())
}

// ported from: src/bundler/HTMLImportManifest.zig
