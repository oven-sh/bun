//! Q: What does this struct do?
//! A: This struct segments the `OutputFile` list into 3 separate spaces so
//!    chunk indexing remains the same:
//!
//!      1. chunks
//!      2. sourcemaps, bytecode, and module_info
//!      3. additional output files
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

use crate::mal_prelude::*;
use crate::options::{self, Format, Loader, OutputFile};
use crate::{Chunk, LinkerContext};
pub struct OutputFileList {
    pub output_files: Vec<options::OutputFile>,
    pub index_for_chunk: u32,
    pub index_for_sourcemaps_and_bytecode: Option<u32>,
    pub additional_output_files_start: u32,

    pub total_insertions: u32,
}

#[derive(thiserror::Error, Debug, strum::IntoStaticStr)]
pub enum OutputFileListError {
    #[error("NoSourceMapsOrBytecode")]
    NoSourceMapsOrBytecode,
}
bun_core::named_error_set!(OutputFileListError);

impl OutputFileList {
    pub fn init(
        c: &LinkerContext,
        chunks: &[Chunk],
        _unused: usize,
    ) -> Result<Self, bun_core::Error> {
        let (length, supplementary_file_count) =
            OutputFileList::calculate_output_file_list_capacity(c, chunks);
        let mut output_files: Vec<options::OutputFile> = Vec::with_capacity(length as usize);
        // PERF(port): was appendNTimesAssumeCapacity — profile in Phase B
        output_files.resize_with(length as usize, || OutputFile::zero_value());

        Ok(Self {
            output_files,
            index_for_chunk: 0,
            index_for_sourcemaps_and_bytecode: if supplementary_file_count == 0 {
                None
            } else {
                Some(chunks.len() as u32) // @truncate
            },
            additional_output_files_start: u32::try_from(chunks.len()).expect("int cast")
                + supplementary_file_count,
            total_insertions: 0,
        })
    }

    pub fn take(&mut self) -> Vec<options::OutputFile> {
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

    pub fn calculate_output_file_list_capacity(c: &LinkerContext, chunks: &[Chunk]) -> (u32, u32) {
        let parse_graph = c.parse_graph();
        let source_map_count: usize = if c.options.source_maps.has_external_files() {
            'brk: {
                let mut count: usize = 0;
                for chunk in chunks {
                    if chunk
                        .content
                        .sourcemap(c.options.source_maps)
                        .has_external_files()
                    {
                        count += 1;
                    }
                }
                break 'brk count;
            }
        } else {
            0
        };
        let bytecode_count: usize = if c.options.generate_bytecode_cache {
            'bytecode_count: {
                let mut bytecode_count: usize = 0;
                let loaders = parse_graph.input_files.items_loader();
                for chunk in chunks {
                    let loader: Loader = if chunk.entry_point.is_entry_point() {
                        loaders[chunk.entry_point.source_index() as usize]
                    } else {
                        Loader::Js
                    };

                    if chunk.content.is_javascript() && loader.is_javascript_like() {
                        bytecode_count += 1;
                    }
                }
                break 'bytecode_count bytecode_count;
            }
        } else {
            0
        };

        // module_info is generated for ESM bytecode in --compile builds
        let module_info_count: usize = if c.options.generate_bytecode_cache
            && c.options.output_format == Format::Esm
            && c.options.compile
        {
            bytecode_count
        } else {
            0
        };

        let additional_output_files_count: usize = if c.options.compile_to_standalone_html {
            0
        } else {
            parse_graph.additional_output_files.len()
        };
        (
            u32::try_from(
                chunks.len()
                    + source_map_count
                    + bytecode_count
                    + module_info_count
                    + additional_output_files_count,
            )
            .unwrap(),
            u32::try_from(source_map_count + bytecode_count + module_info_count).expect("int cast"),
        )
    }

    pub fn insert_for_chunk(&mut self, output_file: options::OutputFile) -> u32 {
        let index = self.index_for_chunk();
        debug_assert!(
            index < self.index_for_sourcemaps_and_bytecode.unwrap_or(u32::MAX),
            "index ({}) \\< index_for_sourcemaps_and_bytecode ({})",
            index,
            self.index_for_sourcemaps_and_bytecode.unwrap_or(u32::MAX),
        );
        self.output_files[index as usize] = output_file;
        self.total_insertions += 1;
        index
    }

    pub fn insert_for_sourcemap_or_bytecode(
        &mut self,
        output_file: options::OutputFile,
    ) -> Result<u32, OutputFileListError> {
        let Some(index) = self.index_for_sourcemap_or_bytecode() else {
            return Err(OutputFileListError::NoSourceMapsOrBytecode);
        };
        debug_assert!(
            index < self.additional_output_files_start,
            "index ({}) \\< additional_output_files_start ({})",
            index,
            self.additional_output_files_start,
        );
        self.output_files[index as usize] = output_file;
        self.total_insertions += 1;
        Ok(index)
    }

    pub fn insert_additional_output_files(
        &mut self,
        additional_output_files: &mut Vec<options::OutputFile>,
    ) {
        debug_assert!(
            self.index_for_sourcemaps_and_bytecode.unwrap_or(0)
                <= self.additional_output_files_start,
            "index_for_sourcemaps_and_bytecode ({}) \\< additional_output_files_start ({})",
            self.index_for_sourcemaps_and_bytecode.unwrap_or(0),
            self.additional_output_files_start,
        );
        // PORT NOTE: Zig did bitwise memcpy (ownership move). `OutputFile` is not
        // `Clone`, so drain by value into the target window.
        let len = additional_output_files.len();
        let dest = self.get_mutable_additional_output_files();
        for (i, of) in additional_output_files.drain(..).enumerate() {
            dest[i] = of;
        }
        self.total_insertions += u32::try_from(len).expect("int cast");
    }

    pub fn get_mutable_additional_output_files(&mut self) -> &mut [options::OutputFile] {
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

// ported from: src/bundler/linker_context/OutputFileListBuilder.zig
