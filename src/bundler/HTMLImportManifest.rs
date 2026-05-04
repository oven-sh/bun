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

use core::fmt;

use bun_collections::AutoBitSet;
use bun_logger::Source;
use bun_str::strings;

use crate::options::{self, Loader};
use crate::{BundleV2, Chunk, Graph, LinkerGraph};

// TODO(port): `bun.jsc.API.BuildArtifact.OutputKind` — exact crate path TBD in Phase B.
use bun_jsc::api::build_artifact::OutputKind;

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
        match write(self.index, self.graph, self.linker_graph, self.chunks, writer) {
            Ok(()) => Ok(()),
            // We use std.fmt.count for this
            // Zig: error.NoSpaceLeft => unreachable, error.OutOfMemory => return error.OutOfMemory
            Err(_) => Err(fmt::Error),
        }
    }
}

// TODO(port): narrow error set
fn write_entry_item<W: fmt::Write>(
    writer: &mut W,
    input: &[u8],
    path: &[u8],
    hash: u64,
    loader: Loader,
    kind: OutputKind,
) -> Result<(), bun_core::Error> {
    writer.write_str("{")?;

    if !input.is_empty() {
        writer.write_str("\"input\":")?;
        bun_js_printer::write_json_string(input, writer, bun_js_printer::Encoding::Utf8)?;
        writer.write_str(",")?;
    }

    writer.write_str("\"path\":")?;
    bun_js_printer::write_json_string(path, writer, bun_js_printer::Encoding::Utf8)?;

    writer.write_str(",\"loader\":\"")?;
    writer.write_str(<&'static str>::from(loader))?;
    writer.write_str("\",\"isEntry\":")?;
    writer.write_str(if kind == OutputKind::EntryPoint { "true" } else { "false" })?;
    writer.write_str(",\"headers\":{")?;

    if hash > 0 {
        // TODO(port): requires `bun_base64::encode_len_from_size` to be `const fn`.
        const BASE64_BUF_LEN: usize =
            bun_base64::encode_len_from_size(core::mem::size_of::<u64>()) + 2;
        let mut base64_buf = [0u8; BASE64_BUF_LEN];
        let n = bun_base64::encode_url_safe(&mut base64_buf, &hash.to_ne_bytes());
        let base64 = &base64_buf[..n];
        core::write!(
            writer,
            "\"etag\":\"{}\",",
            bstr::BStr::new(base64),
        )?;
    }

    core::write!(
        writer,
        "\"content-type\":\"{}\"",
        // Valid mime types are valid headers, which do not need to be escaped in JSON.
        bstr::BStr::new(loader.to_mime_type(&[path]).value),
    )?;

    writer.write_str("}}")?;
    Ok(())
}

// Extremely unfortunate, but necessary due to E.String not accepting pre-escaped input and this happening at the very end.
// TODO(port): narrow error set
pub fn write_escaped_json<W: fmt::Write>(
    index: u32,
    graph: &Graph,
    linker_graph: &LinkerGraph,
    chunks: &[Chunk],
    writer: &mut W,
) -> Result<(), bun_core::Error> {
    // PERF(port): was stack-fallback (std.heap.stackFallback(4096)) — profile in Phase B
    let mut bytes: Vec<u8> = Vec::new();
    // TODO(port): `write` expects a `fmt::Write`; `Vec<u8>` needs an adapter (e.g. bstr or a small wrapper).
    write(index, graph, linker_graph, chunks, &mut VecFmtWriter(&mut bytes))?;
    bun_js_printer::write_pre_quoted_string(
        &bytes,
        writer,
        b'"',
        false,
        true,
        bun_js_printer::Encoding::Utf8,
    )?;
    Ok(())
}

/// Newtype wrapper produced by [`HTMLImportManifest::format_escaped_json`].
/// Mirrors Zig's `std.fmt.Alt(HTMLImportManifest, escapedJSONFormatter)`.
pub struct EscapedJson<'a>(pub HTMLImportManifest<'a>);

impl<'a> fmt::Display for EscapedJson<'a> {
    fn fmt(&self, writer: &mut fmt::Formatter<'_>) -> fmt::Result {
        match write_escaped_json(
            self.0.index,
            self.0.graph,
            self.0.linker_graph,
            self.0.chunks,
            writer,
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

// TODO(port): narrow error set
pub fn write<W: fmt::Write>(
    index: u32,
    graph: &Graph,
    linker_graph: &LinkerGraph,
    chunks: &[Chunk],
    writer: &mut W,
) -> Result<(), bun_core::Error> {
    let browser_source_index = graph.html_imports.html_source_indices.as_slice()[index as usize];
    let server_source_index = graph.html_imports.server_source_indices.as_slice()[index as usize];
    // TODO(port): MultiArrayList field accessor API (`.items(.source)`).
    let sources: &[Source] = graph.input_files.items_source();
    // SAFETY: graph points to BundleV2.graph
    let bv2: &BundleV2 = unsafe {
        &*(graph as *const Graph as *const u8)
            .sub(core::mem::offset_of!(BundleV2, graph))
            .cast::<BundleV2>()
    };
    let mut entry_point_bits = AutoBitSet::init_empty(graph.entry_points.len())?;

    let root_dir = if !bv2.transpiler.options.root_dir.is_empty() {
        &bv2.transpiler.options.root_dir[..]
    } else {
        bun_fs::FileSystem::instance().top_level_dir
    };

    writer.write_str("{")?;

    let inject_compiler_filesystem_prefix = bv2.transpiler.options.compile;
    // Use the server-side public path here.
    let public_path = &bv2.transpiler.options.public_path;
    let mut temp_buffer: Vec<u8> = Vec::new();

    for ch in chunks.iter() {
        if ch.entry_point.source_index == browser_source_index && ch.entry_point.is_entry_point {
            entry_point_bits.set(ch.entry_point.entry_point_id as usize);

            // TODO(port): `ch.content == .html` — depends on Chunk content enum shape.
            if ch.content.is_html() {
                writer.write_str("\"index\":")?;
                if inject_compiler_filesystem_prefix {
                    temp_buffer.clear();
                    temp_buffer.extend_from_slice(public_path);
                    temp_buffer
                        .extend_from_slice(strings::remove_leading_dot_slash(&ch.final_rel_path));
                    bun_js_printer::write_json_string(
                        &temp_buffer,
                        writer,
                        bun_js_printer::Encoding::Utf8,
                    )?;
                } else {
                    bun_js_printer::write_json_string(
                        &ch.final_rel_path,
                        writer,
                        bun_js_printer::Encoding::Utf8,
                    )?;
                }
                writer.write_str(",")?;
            }
        }
    }

    // Start the files array

    writer.write_str("\"files\":[")?;

    let mut first = true;

    let additional_output_files = graph.additional_output_files.as_slice();
    // TODO(port): MultiArrayList field accessor API (`.items(.entry_bits)`).
    let file_entry_bits: &[AutoBitSet] = linker_graph.files.items_entry_bits();
    let mut already_visited_output_file = AutoBitSet::init_empty(additional_output_files.len())?;

    // Write all chunks that have files associated with this entry point.
    // Also include browser chunks from server builds (lazy-loaded chunks from dynamic imports).
    // When there's only one HTML import, all browser chunks belong to that manifest.
    // When there are multiple HTML imports, only include chunks that intersect with this entry's bits.
    let has_single_html_import = graph.html_imports.html_source_indices.len() == 1;
    for ch in chunks.iter() {
        if ch.entry_bits().has_intersection(&entry_point_bits)
            || (has_single_html_import && ch.flags.is_browser_chunk_from_server_build)
        {
            if !first {
                writer.write_str(",")?;
            }
            first = false;

            write_entry_item(
                writer,
                'brk: {
                    if !ch.entry_point.is_entry_point {
                        break 'brk b"" as &[u8];
                    }
                    let mut path_for_key = bun_paths::relative_normalized(
                        root_dir,
                        &sources[ch.entry_point.source_index as usize].path.text,
                        bun_paths::Platform::Posix,
                        false,
                    );

                    path_for_key = strings::remove_leading_dot_slash(path_for_key);

                    break 'brk path_for_key;
                },
                'brk: {
                    if inject_compiler_filesystem_prefix {
                        temp_buffer.clear();
                        temp_buffer.extend_from_slice(public_path);
                        temp_buffer.extend_from_slice(strings::remove_leading_dot_slash(
                            &ch.final_rel_path,
                        ));
                        break 'brk &temp_buffer[..];
                    }
                    break 'brk &ch.final_rel_path[..];
                },
                // The HTML chunk's body embeds the hashed paths of its JS/CSS
                // chunks, so its etag must change when those do. `isolated_hash`
                // by design excludes those substitutions; the placeholder hash
                // folds them in via `appendIsolatedHashesForImportedChunks`.
                ch.template.placeholder.hash.unwrap_or(ch.isolated_hash),
                ch.content.loader(),
                if ch.entry_point.is_entry_point {
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

        // TODO(port): `output_file.source_index.unwrap()` is Zig's optional-index unwrap, not Rust's.
        if let Some(source_index) = output_file.source_index.get() {
            if source_index.get() == server_source_index {
                continue;
            }
            let bits: &AutoBitSet = &file_entry_bits[source_index.get() as usize];

            if bits.has_intersection(&entry_point_bits) {
                already_visited_output_file.set(i);
                if !first {
                    writer.write_str(",")?;
                }
                first = false;

                let mut path_for_key = bun_paths::relative_normalized(
                    root_dir,
                    &sources[source_index.get() as usize].path.text,
                    bun_paths::Platform::Posix,
                    false,
                );
                path_for_key = strings::remove_leading_dot_slash(path_for_key);

                write_entry_item(
                    writer,
                    path_for_key,
                    'brk: {
                        if inject_compiler_filesystem_prefix {
                            temp_buffer.clear();
                            temp_buffer.extend_from_slice(public_path);
                            temp_buffer.extend_from_slice(strings::remove_leading_dot_slash(
                                &output_file.dest_path,
                            ));
                            break 'brk &temp_buffer[..];
                        }
                        break 'brk &output_file.dest_path[..];
                    },
                    output_file.hash,
                    output_file.loader,
                    output_file.output_kind,
                )?;
            }
        }
    }

    writer.write_str("]}")?;
    Ok(())
}

// TODO(port): tiny adapter so `Vec<u8>` can satisfy `fmt::Write` for `write()` above.
// Phase B may switch the writer abstraction to a byte-level `bun_io::Write` instead.
struct VecFmtWriter<'a>(&'a mut Vec<u8>);
impl<'a> fmt::Write for VecFmtWriter<'a> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        self.0.extend_from_slice(s.as_bytes());
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/HTMLImportManifest.zig (276 lines)
//   confidence: medium
//   todos:      9
//   notes:      Writer abstraction uses fmt::Write (text) but paths are bytes — Phase B may need a byte-writer trait; LIFETIMES.tsv had no rows so struct fields classified BORROW_PARAM locally; MultiArrayList/OutputKind/js_printer crate paths need verification.
// ──────────────────────────────────────────────────────────────────────────
