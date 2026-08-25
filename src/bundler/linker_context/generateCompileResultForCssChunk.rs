use crate::mal_prelude::*;
use core::sync::atomic::Ordering;

use bun_collections::VecExt;

use crate::bun_css::{BundlerStyleSheet, ImportInfo, LocalsResultsMap, PrinterOptions, Targets};

use crate::chunk::{Content, CssImportOrderKind};
use crate::linker_context_mod::LinkShared;
use crate::{Chunk, CompileResult, Index};

/// Pool-thread body for one CSS import of `chunk` (see `CompileJob::run`):
/// print `chunk.content.asts[imports_in_chunk_index]`. Reads the linker and
/// parse graphs; the only shared write is the atomic `bytesInOutput` bump.
pub(crate) fn generate_compile_result_for_css_chunk(
    ctx: &LinkShared<'_, '_>,
    chunk: &Chunk,
    imports_in_chunk_index: u32,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkCss");
    let c = ctx.c;
    let pg = ctx.graph;
    let mut worker = ctx.worker();

    let arena = worker.arena();
    let _arena_reset = scopeguard::guard(&mut worker.temporary_arena, |a| {
        a.reset();
    });
    let mut allocating_writer: Vec<u8> = Vec::new();

    let Content::Css(css_content) = &chunk.content else {
        unreachable!("generateCompileResultForCssChunk called on non-CSS chunk");
    };
    let css_import = css_content
        .imports_in_chunk_in_order
        .at(imports_in_chunk_index as usize);
    let css: &BundlerStyleSheet = &css_content.asts[imports_in_chunk_index as usize];
    let symbols: &bun_ast::symbol::Map = &c.graph.symbols;
    // `LocalsResultsMap` is the same `ArrayHashMap<Ref, Box<[u8]>>` alias as
    // `bun_js_printer::MangledProps`; no cast needed.
    let local_names: &LocalsResultsMap = &c.mangled_props;
    let unique_keys = pg.input_files.items_unique_key_for_additional_file();

    let (import_records, source_index, minify): (&[bun_ast::ImportRecord], u32, bool) =
        match &css_import.kind {
            // layer / external path do not need symbols i think
            CssImportOrderKind::Layers(_) | CssImportOrderKind::ExternalPath(_) => (
                css_import.condition_import_records.slice_const(),
                Index::INVALID.get(),
                // TODO: make this more configurable
                c.options.minify_whitespace,
            ),
            CssImportOrderKind::SourceIndex(idx) => (
                c.graph.ast.items_import_records()[idx.get() as usize].as_slice(),
                idx.get(),
                // TODO: make this more configurable
                c.options.minify_whitespace
                    || c.options.minify_syntax
                    || c.options.minify_identifiers,
            ),
        };
    let printer_options = PrinterOptions {
        minify,
        targets: Targets::for_bundler_target(c.options.target),
        ..Default::default()
    };
    if css
        .to_css_with_writer(
            arena,
            &mut allocating_writer,
            &printer_options,
            Some(ImportInfo {
                import_records,
                ast_urls_for_css: pg.ast.items_url_for_css(),
                ast_unique_key_for_additional_file: unique_keys,
            }),
            Some(local_names),
            symbols,
        )
        .is_err()
    {
        return CompileResult::Css {
            result: Err(crate::Error::PrintError),
            source_index,
            source_map: None,
        };
    }
    let output = allocating_writer.into_boxed_slice();
    if let CssImportOrderKind::SourceIndex(idx) = &css_import.kind {
        // Update bytesInOutput for this source in the chunk (for metafile)
        // Use atomic operation since multiple threads may update the same counter
        if !output.is_empty() {
            if let Some(bytes) = chunk.files_with_parts_in_chunk.get(&idx.get()) {
                let _ = bytes.fetch_add(output.len(), Ordering::Relaxed);
            }
        }
    }
    CompileResult::Css {
        result: Ok(output),
        source_index,
        source_map: None,
    }
}
