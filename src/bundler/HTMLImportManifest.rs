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

use bun_ast::Source;
use bun_collections::AutoBitSet;
use bun_collections::VecExt;
use bun_core::strings;
use bun_io::Write;
use bun_js_printer::Encoding;
use bun_paths::resolve_path::{platform, platform_to_posix_in_place, relative_normalized};
use bun_resolver::fs::FileSystem;

use crate::Graph::Graph;
use crate::chunk::Content;
use crate::options::{Loader, OutputKind};
use crate::options_impl::LoaderExt as _;
use crate::{BundleV2, Chunk, LinkerGraph};

/// A page's manifest before the chunks are named.
pub(crate) struct Template {
    /// Every byte except the listed chunks' paths and etags.
    json: Vec<u8>,
    /// Where those go, in `at` order.
    refs: Vec<ChunkRef>,
    /// `--compile`: the server-side public path, printed before each chunk's path.
    public_path: Option<Box<[u8]>>,
}

struct ChunkRef {
    /// The offset in `json` the value is printed at.
    at: u32,
    chunk: u32,
    value: ChunkValue,
}

impl ChunkRef {
    /// A value of `chunk` that is printed where `json` ends now.
    fn at_end_of(json: &[u8], chunk: u32, value: ChunkValue) -> ChunkRef {
        ChunkRef {
            at: json.len() as u32,
            chunk,
            value,
        }
    }
}

/// What a manifest prints of a listed chunk.
#[derive(Clone, Copy)]
pub(crate) enum ChunkValue {
    /// Its final path, as a JSON string.
    Path,
    /// The `"etag"` header of its final hash.
    Etag,
}

/// One part of a manifest.
pub(crate) enum Part<'a> {
    /// Bytes that are final before the chunks are named.
    Literal(&'a [u8]),
    /// A value of the chunk at this index.
    Chunk(u32, ChunkValue),
}

impl Template {
    /// The manifest in print order, for `resolve` to print and for `final_chunk_hashes` to hash.
    pub(crate) fn parts(&self) -> impl Iterator<Item = Part<'_>> {
        let mut literal_start = 0;
        let tail = self.refs.last().map_or(0, |last| last.at as usize);
        self.refs
            .iter()
            .flat_map(move |chunk_ref| {
                let literal = &self.json[literal_start..chunk_ref.at as usize];
                literal_start = chunk_ref.at as usize;
                [
                    Part::Literal(literal),
                    Part::Chunk(chunk_ref.chunk, chunk_ref.value),
                ]
            })
            .chain(core::iter::once(Part::Literal(&self.json[tail..])))
    }

    fn resolve(&self, chunks: &[Chunk], writer: &mut Vec<u8>) -> Result<(), crate::Error> {
        let mut prefixed: Vec<u8> = Vec::new();
        for part in self.parts() {
            match part {
                Part::Literal(bytes) => writer.write_all(bytes)?,
                Part::Chunk(chunk, ChunkValue::Path) => {
                    let mut path: &[u8] = &chunks[chunk as usize].final_rel_path;
                    if let Some(public_path) = &self.public_path {
                        prefixed.clear();
                        prefixed.extend_from_slice(public_path);
                        prefixed.extend_from_slice(strings::remove_leading_dot_slash(path));
                        path = &prefixed;
                    }
                    bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(path, writer)?;
                }
                Part::Chunk(chunk, ChunkValue::Etag) => {
                    let chunk = &chunks[chunk as usize];
                    // Not `isolated_hash`: that leaves out the paths of the chunks this one names.
                    let hash = chunk.template.placeholder.hash;
                    write_etag(writer, hash.map_or(chunk.isolated_hash, |h| h.value))?;
                }
            }
        }
        Ok(())
    }

    /// The chunks are named: prints the manifest.
    pub(crate) fn render(self, chunks: &[Chunk]) -> Result<Manifest, crate::Error> {
        // Each is at least as long as what it is made from.
        let mut json: Vec<u8> = Vec::with_capacity(self.json.len());
        self.resolve(chunks, &mut json)?;
        // Extremely unfortunate, but necessary due to E.String not accepting pre-escaped input and this happening at the very end.
        let mut escaped: Vec<u8> = Vec::with_capacity(json.len());
        bun_js_printer::write_pre_quoted_string::<_, b'"', false, true, { Encoding::Utf8 }>(
            &json,
            &mut escaped,
        )?;
        Ok(Manifest { json, escaped })
    }
}

/// A page's manifest once the chunks are named.
pub(crate) struct Manifest {
    /// What `--compile --aot` embeds as data.
    pub(crate) json: Vec<u8>,
    /// `json` as the contents of a double-quoted JavaScript string, which is what a chunk prints.
    pub(crate) escaped: Vec<u8>,
}

/// What orders a listing: a rank, the file's source path, its isolated hash, and then its index.
type ListingKey<'a> = (u8, &'a [u8], u64, u32);

/// Where an entry's path and etag come from.
#[derive(Clone, Copy)]
enum Entry<'a> {
    /// From the chunk at this index, once the chunks are named.
    Chunk(u32),
    Asset {
        path: &'a [u8],
        hash: u64,
    },
}

fn write_entry_item(
    writer: &mut Vec<u8>,
    refs: &mut Vec<ChunkRef>,
    input: &[u8],
    entry: Entry<'_>,
    loader: Loader,
    kind: OutputKind,
) -> Result<(), crate::Error> {
    writer.write_all(b"{")?;

    if !input.is_empty() {
        writer.write_all(b"\"input\":")?;
        bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(input, writer)?;
        writer.write_all(b",")?;
    }

    writer.write_all(b"\"path\":")?;
    match entry {
        Entry::Chunk(chunk) => refs.push(ChunkRef::at_end_of(writer, chunk, ChunkValue::Path)),
        Entry::Asset { path, .. } => {
            bun_js_printer::write_json_string::<_, { Encoding::Utf8 }>(path, writer)?
        }
    }

    writer.write_all(b",\"loader\":\"")?;
    // strum is configured snake_case, so this prints the lowercase tag name.
    writer.write_all(<&'static str>::from(loader).as_bytes())?;
    writer.write_all(b"\",\"isEntry\":")?;
    writer.write_all(if kind == OutputKind::EntryPoint {
        b"true" as &[u8]
    } else {
        b"false"
    })?;
    writer.write_all(b",\"headers\":{")?;

    match entry {
        Entry::Chunk(chunk) => refs.push(ChunkRef::at_end_of(writer, chunk, ChunkValue::Etag)),
        Entry::Asset { hash, .. } => write_etag(writer, hash)?,
    }

    // Valid mime types are valid headers, which do not need to be escaped in JSON.
    let mime = match entry {
        // A chunk's loader decides its content type.
        Entry::Chunk(_) => loader.to_mime_type(&[]),
        Entry::Asset { path, .. } => loader.to_mime_type(&[path]),
    };
    writer.write_all(b"\"content-type\":\"")?;
    writer.write_all(&mime.value)?;
    writer.write_all(b"\"")?;

    writer.write_all(b"}}")?;
    Ok(())
}

fn write_etag(writer: &mut Vec<u8>, hash: u64) -> Result<(), crate::Error> {
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
    Ok(())
}

/// Walks what page `index` lists. The chunks have no names yet, so their paths and etags become references.
pub(crate) fn emit(
    index: u32,
    graph: &Graph,
    linker_graph: &LinkerGraph<'_>,
    chunks: &[Chunk],
) -> Result<Template, crate::Error> {
    let mut json: Vec<u8> = Vec::new();
    let mut refs: Vec<ChunkRef> = Vec::new();
    let writer = &mut json;
    let browser_source_index = graph.html_imports.html_source_indices.slice()[index as usize];
    let server_source_index = graph.html_imports.server_source_indices.slice()[index as usize];
    let sources: &[Source] = graph.input_files.items_source();
    // SAFETY: graph points to BundleV2.graph.
    let bv2: &BundleV2<'_> = unsafe {
        &*bun_core::from_field_ptr!(BundleV2<'static>, graph, std::ptr::from_ref::<Graph>(graph))
    };
    let options = &bv2.transpiler().options;
    // Same size as the files' entry bits: the linker's list also holds the dynamic imports.
    let mut entry_point_bits = AutoBitSet::init_empty(linker_graph.entry_points.len())?;
    let mut chunks_to_write = AutoBitSet::init_empty(chunks.len())?;
    let mut chunks_to_visit: Vec<u32> = Vec::new();

    let root_dir: &[u8] = if !options.root_dir.is_empty() {
        &options.root_dir[..]
    } else {
        FileSystem::get().top_level_dir()
    };

    writer.write_all(b"{")?;

    let inject_compiler_filesystem_prefix = options.compile_mode.is_executable();
    // Use the server-side public path here.
    let public_path: &[u8] = &options.public_path;
    let mut temp_buffer: Vec<u8> = Vec::new();
    let mut input_buffer: Vec<u8> = Vec::new();

    for (chunk_index, ch) in chunks.iter().enumerate() {
        if ch.entry_point.source_index() == browser_source_index && ch.entry_point.is_entry_point()
        {
            entry_point_bits.set(ch.entry_point.entry_point_id() as usize);
            chunks_to_visit.push(chunk_index as u32);

            if matches!(ch.content, Content::Html) {
                writer.write_all(b"\"index\":")?;
                refs.push(ChunkRef::at_end_of(
                    writer,
                    chunk_index as u32,
                    ChunkValue::Path,
                ));
                writer.write_all(b",")?;
            }
        }
    }

    // Every chunk the page's chunks import, transitively.
    while let Some(chunk_index) = chunks_to_visit.pop() {
        if chunks_to_write.is_set(chunk_index as usize) {
            continue;
        }
        chunks_to_write.set(chunk_index as usize);

        let ch = &chunks[chunk_index as usize];
        for import in ch.cross_chunk_imports.iter() {
            let imported = &chunks[import.chunk_index as usize];
            if imported.entry_point.is_entry_point() {
                // A dynamic import's entry point: its bit is what the assets only it reaches carry.
                entry_point_bits.set(imported.entry_point.entry_point_id() as usize);
            }
            chunks_to_visit.push(import.chunk_index);
        }
        if let Content::Javascript(js) = &ch.content {
            chunks_to_visit.extend_from_slice(&js.css_chunks);
        }
    }

    // Start the files array

    writer.write_all(b"\"files\":[")?;

    let mut first = true;

    let additional_output_files = &graph.additional_output_files;
    let file_entry_bits: &[AutoBitSet] = linker_graph.files.items_entry_bits();

    // Chunk index and the order of copied files follow the scan order, so neither orders the listing.
    let mut listed: Vec<ListingKey<'_>> = Vec::new();
    for (chunk_index, ch) in chunks.iter().enumerate() {
        if !chunks_to_write.is_set(chunk_index) {
            continue;
        }
        let is_page = ch.is_entry_point_file(browser_source_index);
        let rank = match ch.content {
            Content::Javascript(_) if is_page => 0,
            Content::Html => 1,
            Content::Javascript(_) => 2,
            Content::Css(_) => 3,
        };
        let source_path: &[u8] = if ch.entry_point.is_entry_point() {
            sources[ch.entry_point.source_index() as usize].path.text
        } else {
            b""
        };
        listed.push((rank, source_path, ch.isolated_hash, chunk_index as u32));
    }
    listed.sort_unstable();

    for (_, _, _, chunk_index) in listed {
        let ch = &chunks[chunk_index as usize];
        if !first {
            writer.write_all(b",")?;
        }
        first = false;

        let input: &[u8] = if !ch.entry_point.is_entry_point() {
            b""
        } else {
            source_path_relative_to_root(
                &mut input_buffer,
                root_dir,
                sources[ch.entry_point.source_index() as usize].path.text,
            )
        };

        write_entry_item(
            writer,
            &mut refs,
            input,
            Entry::Chunk(chunk_index),
            ch.content.loader(),
            if ch.entry_point.is_entry_point() {
                OutputKind::EntryPoint
            } else {
                OutputKind::Chunk
            },
        )?;
    }

    let mut assets: Vec<ListingKey<'_>> = Vec::new();
    for (i, output_file) in additional_output_files.iter().enumerate() {
        if let Some(source_index) = output_file.source_index.unwrap() {
            if source_index.get() != server_source_index
                && file_entry_bits[source_index.get() as usize].has_intersection(&entry_point_bits)
            {
                assets.push((
                    0,
                    sources[source_index.get() as usize].path.text,
                    0,
                    i as u32,
                ));
            }
        }
    }
    assets.sort_unstable();

    for (_, source_path, _, i) in assets {
        let output_file = &additional_output_files[i as usize];
        if !first {
            writer.write_all(b",")?;
        }
        first = false;

        let path_for_key = source_path_relative_to_root(&mut input_buffer, root_dir, source_path);

        let path: &[u8] = if inject_compiler_filesystem_prefix {
            temp_buffer.clear();
            temp_buffer.extend_from_slice(public_path);
            temp_buffer
                .extend_from_slice(strings::remove_leading_dot_slash(&output_file.dest_path));
            &temp_buffer[..]
        } else {
            &output_file.dest_path[..]
        };

        write_entry_item(
            writer,
            &mut refs,
            path_for_key,
            Entry::Asset {
                path,
                hash: output_file.hash.value,
            },
            output_file.loader,
            output_file.output_kind,
        )?;
    }

    writer.write_all(b"]}")?;
    Ok(Template {
        json,
        refs,
        public_path: inject_compiler_filesystem_prefix.then(|| Box::from(public_path)),
    })
}

/// The manifest's `input` / asset-key form of a source path: root-relative, `/`-separated.
fn source_path_relative_to_root<'b>(
    buf: &'b mut Vec<u8>,
    root_dir: &[u8],
    path: &[u8],
) -> &'b [u8] {
    buf.clear();
    buf.extend_from_slice(strings::remove_leading_dot_slash(relative_normalized::<
        platform::Auto,
        false,
    >(root_dir, path)));
    platform_to_posix_in_place(&mut buf[..]);
    buf
}
