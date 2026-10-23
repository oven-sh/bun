//! Q: What does this struct do?
//! A: This struct segments the `OutputFile` list into 3 separate spaces so
//!    chunk indexing remains the same:
//!
//!    1. chunks
//!    2. sourcemaps, bytecode, and module_info
//!    3. additional output files
//!
//!    We can calculate the space ahead of time and avoid having to do something
//!    more complicated or which requires extra work.
//!
//! Q: Why does it need to do that?
//! A: We would like it so if we have a chunk index, we can also index its
//!    corresponding output file in the output file list.
//!
//!    The DevServer uses the `referenced_css_chunks` (a list of chunk indices)
//!    field on `OutputFile` to know which CSS files to hand to the rendering
//!    function. For React this just adds <link> tags that point to each output CSS
//!    file.
//!
//!    However, we previously were pushing sourcemaps and bytecode output files
//!    to the output file list directly after their corresponding chunk, meaning
//!    the index of the chunk in the chunk list and its corresponding
//!    `OutputFile` in the output file list got scrambled.
//!
//!    If we maintain the property that `outputIndexForChunk(chunk[i]) == i`
//!    then we don't need to do any allocations or extra work to get the output
//!    file for a chunk.
//!
//! Q: What else does it do?
//! A: It gives every output path of the build to exactly one file. `init`
//!    names the `.map` and `.jsc` file of each chunk, claims the path of every
//!    chunk, `.map`, `.jsc`, copied asset and metafile, and fails the build
//!    when two files would get one path. It runs before the first write, and
//!    the writers take the `.map` and `.jsc` paths from here, so no file is
//!    written to a path that was not claimed for it.

use std::borrow::Cow;
use std::io::Write as _;

use bun_alloc::AllocError;
use bun_collections::StringArrayHashMap;
use bun_collections::hashbrown::hash_map::{Entry, HashMap};
use bun_core::strings;
use bun_paths::resolve_path;

use crate::bytecode_sidecar::EXTENSION as BYTECODE_EXTENSION;
use crate::chunk::Content;
use crate::mal_prelude::*;
use crate::options::{self, CompileMode, OutputFile};
use crate::{BundleV2, Chunk, EntryPoint, LinkerContext};

pub(crate) struct OutputFileList {
    pub(crate) output_files: Vec<options::OutputFile>,
    pub(crate) index_for_chunk: u32,
    pub(crate) index_for_sourcemaps_and_bytecode: Option<u32>,
    pub(crate) additional_output_files_start: u32,

    pub(crate) total_insertions: u32,

    /// By chunk: the path of its `.map` file. Empty when no chunk has one.
    source_map_paths: Vec<Box<[u8]>>,
    /// By chunk: the path of its `.jsc` file. Empty when no chunk has one.
    bytecode_paths: Vec<Box<[u8]>>,
    /// Ascending indices into `Graph::additional_output_files`: each of these files has the path and the bytes of an
    /// earlier one, so a writer needs to write only that one.
    pub(crate) repeated_assets: Vec<u32>,
}

#[derive(thiserror::Error, Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
pub enum OutputFileListError {
    #[error("NoSourceMapsOrBytecode")]
    NoSourceMapsOrBytecode,
}

/// A file that goes to an output path.
#[derive(Clone, Copy)]
enum Claimant {
    Chunk(u32),
    /// The `.map` file of this chunk.
    SourceMap(u32),
    /// The `.jsc` file of this chunk.
    Bytecode(u32),
    /// An index into `Graph::additional_output_files`.
    Asset(u32),
    MetafileJson,
    MetafileMarkdown,
}

struct Claims<'a> {
    mode: CompileMode,
    chunks: &'a [Chunk],
    assets: &'a [OutputFile],
    /// The first file at each path, with the path as that file spells it.
    by_path: HashMap<Cow<'a, [u8]>, (Claimant, &'a [u8]), bun_wyhash::BuildHasher>,
    repeated_assets: Vec<u32>,
    /// Every path that two different files would get, with all of its files.
    duplicates: StringArrayHashMap<Vec<Claimant>>,
}

impl<'a> Claims<'a> {
    /// Two spellings of one file have one key. An executable stores a file under its path less one leading `./`
    /// (`StandaloneModuleGraph::module_dest_path`) and resolves nothing else: `a/../x` and `x` are two files there.
    /// Every other path is joined to the output directory, where `a/../x`, `./x` and `.//x` are one file.
    fn key(mode: CompileMode, mut path: &[u8]) -> Cow<'_, [u8]> {
        if mode.is_executable() {
            return Cow::Borrowed(strings::remove_leading_dot_slash(path));
        }
        while let Some(rest) = path.strip_prefix(b"./") {
            path = rest;
        }
        if strings::split(path, b"/").all(|segment| !matches!(segment, b"" | b"." | b"..")) {
            return Cow::Borrowed(path);
        }
        let mut buf = vec![0u8; path.len() + 1];
        let len = resolve_path::normalize_string_buf::<true, resolve_path::platform::Posix, false>(
            path, &mut buf,
        )
        .len();
        buf.truncate(len);
        Cow::Owned(buf)
    }

    fn claim(&mut self, path: &'a [u8], claimant: Claimant) -> Result<(), AllocError> {
        let first = match self.by_path.entry(Self::key(self.mode, path)) {
            Entry::Vacant(entry) => {
                entry.insert((claimant, path));
                return Ok(());
            }
            Entry::Occupied(entry) => entry.into_mut(),
        };
        match (first.0, claimant) {
            // The same bytes under the same name, for example one image that two packages carry.
            (Claimant::Asset(a), Claimant::Asset(b))
                if self.assets[a as usize].hash.value == self.assets[b as usize].hash.value
                    && self.assets[a as usize].value.as_slice()
                        == self.assets[b as usize].value.as_slice() =>
            {
                self.repeated_assets.push(b);
                return Ok(());
            }
            // Standalone HTML inlines every other chunk into the page: such a chunk is not written, and its path
            // only has to differ from the paths of the other chunks. All of those were claimed before this file.
            (
                Claimant::Chunk(i),
                Claimant::SourceMap(_) | Claimant::MetafileJson | Claimant::MetafileMarkdown,
            ) if self.mode.is_standalone_html()
                && !matches!(self.chunks[i as usize].content, Content::Html) =>
            {
                *first = (claimant, path);
                return Ok(());
            }
            _ => {}
        }
        let files = self.duplicates.get_or_put(first.1)?.value_ptr;
        if files.is_empty() {
            files.push(first.0);
        }
        files.push(claimant);
        Ok(())
    }
}

impl OutputFileList {
    /// Gives every file the linker outputs its slot in the list and its path. Call it when every chunk has its
    /// `final_rel_path` and before anything reads or writes an output path: two files at one path fail the build here.
    pub(crate) fn init(c: &mut LinkerContext, chunks: &[Chunk]) -> Result<Self, crate::Error> {
        let mode = c.options.compile_mode;
        let mut source_map_paths: Vec<Box<[u8]>> = Vec::new();
        let mut bytecode_paths: Vec<Box<[u8]>> = Vec::new();
        let mut source_map_count: usize = 0;
        let mut bytecode_count: usize = 0;
        for (i, chunk) in chunks.iter().enumerate() {
            if chunk
                .content
                .sourcemap(c.options.source_maps)
                .has_external_files()
            {
                source_map_count += 1;
                source_map_paths.resize_with(chunks.len(), Box::default);
                source_map_paths[i] = strings::concat(&[&chunk.final_rel_path, b".map"]);
            }
            if c.options.generate_bytecode_cache && c.chunk_gets_bytecode(chunk) {
                bytecode_count += 1;
                bytecode_paths.resize_with(chunks.len(), Box::default);
                bytecode_paths[i] =
                    strings::concat(&[&chunk.final_rel_path, BYTECODE_EXTENSION.as_bytes()]);
            }
        }
        let module_info_count: usize = if c.options.generates_module_info() {
            bytecode_count
        } else {
            0
        };
        let supplementary_file_count = source_map_count + bytecode_count + module_info_count;

        // Standalone HTML inlines the copied assets into the page.
        let asset_count = if mode.is_standalone_html() {
            0
        } else {
            c.parse_graph().additional_output_files.len()
        };
        let length = chunks.len() + supplementary_file_count + asset_count;

        let (repeated_assets, duplicates) = {
            let mut claims = Claims {
                mode,
                chunks,
                assets: &c.parse_graph().additional_output_files[..asset_count],
                // One entry for each output file, and for the two metafiles.
                by_path: HashMap::with_capacity_and_hasher(length + 2, Default::default()),
                repeated_assets: Vec::new(),
                duplicates: StringArrayHashMap::default(),
            };
            // A chunk whose path is too long for the platform has none: that build fails after this.
            let has_path = |i: usize| !chunks[i].final_rel_path.is_empty();
            for (i, chunk) in chunks.iter().enumerate() {
                if has_path(i) {
                    claims.claim(&chunk.final_rel_path, Claimant::Chunk(i as u32))?;
                }
            }
            // An executable holds its source maps and bytecode outside of the files it embeds.
            if !mode.is_executable() {
                for (i, path) in source_map_paths.iter().enumerate() {
                    if !path.is_empty() && has_path(i) {
                        claims.claim(path, Claimant::SourceMap(i as u32))?;
                    }
                }
            }
            if mode == CompileMode::None {
                for (i, path) in bytecode_paths.iter().enumerate() {
                    if !path.is_empty() && has_path(i) {
                        claims.claim(path, Claimant::Bytecode(i as u32))?;
                    }
                }
            }
            for (i, asset) in claims.assets.iter().enumerate() {
                claims.claim(&asset.dest_path, Claimant::Asset(i as u32))?;
            }
            // `BundleV2` writes these two into the output directory after the link.
            if c.options.metafile && !mode.is_executable() {
                for (path, claimant) in [
                    (c.options.metafile_json_path, Claimant::MetafileJson),
                    (c.options.metafile_markdown_path, Claimant::MetafileMarkdown),
                ] {
                    if !path.is_empty() {
                        claims.claim(path, claimant)?;
                    }
                }
            }
            (claims.repeated_assets, claims.duplicates)
        };
        if duplicates.count() > 0 {
            Self::report_duplicates(c, chunks, &duplicates)?;
            return Err(crate::Error::DuplicateOutputPath);
        }

        let mut output_files: Vec<options::OutputFile> = Vec::with_capacity(length);
        output_files.resize_with(length, OutputFile::zero_value);

        Ok(Self {
            output_files,
            index_for_chunk: 0,
            index_for_sourcemaps_and_bytecode: if supplementary_file_count == 0 {
                None
            } else {
                Some(chunks.len() as u32)
            },
            additional_output_files_start: u32::try_from(chunks.len() + supplementary_file_count)
                .expect("int cast"),
            total_insertions: 0,
            source_map_paths,
            bytecode_paths,
            repeated_assets,
        })
    }

    /// Logs each path of `duplicates` with the files that would get it, then the naming templates that gave them one
    /// name.
    fn report_duplicates(
        c: &mut LinkerContext,
        chunks: &[Chunk],
        duplicates: &StringArrayHashMap<Vec<Claimant>>,
    ) -> Result<(), crate::Error> {
        let mut msg: Vec<u8> = Vec::new();
        writeln!(&mut msg, "Multiple files share the same output path")?;

        // entry, chunk, asset
        let mut naming: [Option<Cow<'_, [u8]>>; 3] = [None, None, None];
        let mut only_chunks = true;

        for (path, files) in duplicates.keys().iter().zip(duplicates.values()) {
            writeln!(&mut msg, "  {}:", bstr::BStr::new(path))?;
            for &file in files {
                let (part, chunk_index) = match file {
                    Claimant::Chunk(i) => ("", i),
                    Claimant::SourceMap(i) => ("the source map of ", i),
                    Claimant::Bytecode(i) => ("the bytecode of ", i),
                    Claimant::Asset(i) => {
                        only_chunks = false;
                        let asset = &c.parse_graph().additional_output_files[i as usize];
                        let loader = asset.loader;
                        let Some(source_index) = asset.source_index.get() else {
                            continue;
                        };
                        let source_index = source_index.get_usize();
                        writeln!(
                            &mut msg,
                            "    from input {}",
                            bstr::BStr::new(c.get_source(source_index).path.pretty)
                        )?;
                        let target = c.parse_graph().ast.items_target()[source_index];
                        // SAFETY: `c` is the `linker` field of the `BundleV2` that runs this link.
                        let bundle: &mut BundleV2 = unsafe {
                            &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(
                                c,
                            ))
                        };
                        naming[2] = Some(Cow::Owned(
                            bundle.asset_path_template(loader, target).data.into_vec(),
                        ));
                        continue;
                    }
                    Claimant::MetafileJson | Claimant::MetafileMarkdown => {
                        only_chunks = false;
                        writeln!(
                            &mut msg,
                            "    from the metafile (metafile.{})",
                            if matches!(file, Claimant::MetafileJson) {
                                "json"
                            } else {
                                "markdown"
                            }
                        )?;
                        continue;
                    }
                };
                only_chunks &= matches!(file, Claimant::Chunk(_));
                let chunk = &chunks[chunk_index as usize];
                let source_index = chunk.entry_point.source_index() as usize;
                writeln!(
                    &mut msg,
                    "    from {}input {}",
                    part,
                    bstr::BStr::new(c.get_source(source_index).path.pretty)
                )?;
                let is_entry = chunk.entry_point.is_entry_point()
                    && c.graph.files.items_entry_point_kind()[source_index]
                        == EntryPoint::Kind::UserSpecified;
                naming[if is_entry { 0 } else { 1 }] = Some(Cow::Borrowed(&chunk.template.data));
            }
        }

        c.log_mut().add_error(None, bun_ast::Loc::EMPTY, msg);

        for (name, template) in ["entry", "chunk", "asset"].into_iter().zip(naming) {
            let Some(template) = template else { continue };

            let mut text: Vec<u8> = Vec::new();
            if options::path_template_hash_len(&template).is_none() {
                write!(
                    &mut text,
                    "{} naming is '{}', consider adding '[hash]' to make filenames unique",
                    name,
                    bstr::BStr::new(&template),
                )?;
            } else if only_chunks {
                write!(
                    &mut text,
                    "{} naming is '{}'; these inputs produce identical content",
                    name,
                    bstr::BStr::new(&template),
                )?;
            } else {
                continue;
            }
            c.log_mut().add_msg(bun_ast::Msg {
                kind: bun_ast::Kind::Note,
                data: bun_ast::Data {
                    text: Cow::Owned(text),
                    ..Default::default()
                },
                ..Default::default()
            });
        }
        Ok(())
    }

    /// The path `init` gave the `.map` file of `chunks[chunk_index]`.
    pub(crate) fn source_map_path(&self, chunk_index: usize) -> &[u8] {
        debug_assert!(!self.source_map_paths[chunk_index].is_empty());
        &self.source_map_paths[chunk_index]
    }

    /// Moves [`Self::source_map_path`] out, for the `OutputFile` of that file.
    pub(crate) fn take_source_map_path(&mut self, chunk_index: usize) -> Box<[u8]> {
        debug_assert!(!self.source_map_paths[chunk_index].is_empty());
        core::mem::take(&mut self.source_map_paths[chunk_index])
    }

    /// Moves the path `init` gave the `.jsc` file of `chunks[chunk_index]` out, for the `OutputFile` of that file.
    pub(crate) fn take_bytecode_path(&mut self, chunk_index: usize) -> Box<[u8]> {
        debug_assert!(!self.bytecode_paths[chunk_index].is_empty());
        core::mem::take(&mut self.bytecode_paths[chunk_index])
    }

    pub(crate) fn take(&mut self) -> Vec<options::OutputFile> {
        // A source map, bytecode or module info file is counted before it is made, and one that is not made after all
        // (a chunk JSC cannot generate bytecode for) leaves its slot unclaimed. Slots are handed out in order, so the
        // unclaimed ones are the end of their region: they go, and every file keeps the index it was given except the
        // additional files after them, which nothing refers to by index.
        if let Some(claimed_end) = self.index_for_sourcemaps_and_bytecode
            && claimed_end < self.additional_output_files_start
        {
            self.output_files
                .drain(claimed_end as usize..self.additional_output_files_start as usize);
            self.additional_output_files_start = claimed_end;
        }
        // TODO: should this return an error
        debug_assert!(
            self.total_insertions as usize == self.output_files.len(),
            "total_insertions ({}) != output_files.items.len ({})",
            self.total_insertions,
            self.output_files.len(),
        );
        // Set the length just in case so the list doesn't have undefined memory
        self.output_files.truncate(self.total_insertions as usize);
        core::mem::take(&mut self.output_files)
    }

    pub(crate) fn insert_for_chunk(&mut self, output_file: options::OutputFile) -> u32 {
        let index = self.index_for_chunk();
        debug_assert!(
            index < self.index_for_sourcemaps_and_bytecode.unwrap_or(u32::MAX),
            "index ({}) < index_for_sourcemaps_and_bytecode ({})",
            index,
            self.index_for_sourcemaps_and_bytecode.unwrap_or(u32::MAX),
        );
        self.output_files[index as usize] = output_file;
        self.total_insertions += 1;
        index
    }

    pub(crate) fn insert_for_sourcemap_or_bytecode(
        &mut self,
        output_file: options::OutputFile,
    ) -> Result<u32, OutputFileListError> {
        let Some(index) = self.index_for_sourcemap_or_bytecode() else {
            return Err(OutputFileListError::NoSourceMapsOrBytecode);
        };
        debug_assert!(
            index < self.additional_output_files_start,
            "index ({}) < additional_output_files_start ({})",
            index,
            self.additional_output_files_start,
        );
        self.output_files[index as usize] = output_file;
        self.total_insertions += 1;
        Ok(index)
    }

    pub(crate) fn insert_additional_output_files(
        &mut self,
        additional_output_files: &mut Vec<options::OutputFile>,
    ) {
        debug_assert!(
            self.index_for_sourcemaps_and_bytecode.unwrap_or(0)
                <= self.additional_output_files_start,
            "index_for_sourcemaps_and_bytecode ({}) <= additional_output_files_start ({})",
            self.index_for_sourcemaps_and_bytecode.unwrap_or(0),
            self.additional_output_files_start,
        );
        // Ownership move: `OutputFile` is not `Clone`, so drain by value into
        // the target window.
        let len = additional_output_files.len();
        let dest = self.get_mutable_additional_output_files();
        for (i, of) in additional_output_files.drain(..).enumerate() {
            dest[i] = of;
        }
        self.total_insertions += u32::try_from(len).expect("int cast");
    }

    pub(crate) fn get_mutable_additional_output_files(&mut self) -> &mut [options::OutputFile] {
        &mut self.output_files[self.additional_output_files_start as usize..]
    }

    fn index_for_chunk(&mut self) -> u32 {
        let result = self.index_for_chunk;
        self.index_for_chunk += 1;
        result
    }

    fn index_for_sourcemap_or_bytecode(&mut self) -> Option<u32> {
        let result = self.index_for_sourcemaps_and_bytecode?;
        *self.index_for_sourcemaps_and_bytecode.as_mut().unwrap() += 1;
        Some(result)
    }
}
