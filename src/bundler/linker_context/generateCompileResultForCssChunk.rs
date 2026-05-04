use core::mem::offset_of;
use core::sync::atomic::Ordering;

use bun_collections::BabyList;
use bun_options_types::ImportRecord;
use bun_threading::Task as ThreadPoolLibTask;

use bun_css::{BundlerStyleSheet, PrinterOptions, Targets};

use crate::linker_context::{LinkerContext, PendingPartRange};
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index};

pub fn generate_compile_result_for_css_chunk(task: *mut ThreadPoolLibTask) {
    // SAFETY: task is the `task` field embedded in a PendingPartRange (intrusive task node).
    let part_range: &PendingPartRange = unsafe {
        &*(task as *mut u8)
            .sub(offset_of!(PendingPartRange, task))
            .cast::<PendingPartRange>()
    };
    let ctx = &part_range.ctx;
    // SAFETY: ctx.c is the `linker` field embedded in the bundler ThreadPool owner.
    let worker = Worker::get(unsafe {
        &mut *(ctx.c as *mut LinkerContext as *mut u8)
            .sub(offset_of!(crate::ThreadPool, linker))
            .cast::<crate::ThreadPool>()
    });
    // `defer worker.unget()` — Worker::get returns an RAII guard; Drop calls unget().

    #[cfg(feature = "show_crash_trace")]
    let _prev_action_guard = {
        let prev_action = bun_crash_handler::current_action();
        bun_crash_handler::set_current_action(bun_crash_handler::Action::BundleGenerateChunk {
            chunk: ctx.chunk,
            context: ctx.c,
            part_range: &part_range.part_range,
        });
        scopeguard::guard((), move |_| {
            bun_crash_handler::set_current_action(prev_action);
        })
    };

    ctx.chunk.compile_results_for_chunk[part_range.i as usize] =
        generate_compile_result_for_css_chunk_impl(&mut *worker, ctx.c, ctx.chunk, part_range.i);
}

fn generate_compile_result_for_css_chunk_impl(
    worker: &mut Worker,
    c: &mut LinkerContext,
    chunk: &mut Chunk,
    imports_in_chunk_index: u32,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkCss");
    // `defer trace.end()` — RAII; Drop ends the trace.

    // PERF(port): was arena bulk-free (worker.temporary_arena.reset(.retain_capacity)) — profile in Phase B
    let _arena_reset = scopeguard::guard(&mut worker.temporary_arena, |arena| {
        arena.reset();
    });
    // TODO(port): worker.allocator threading — css crate is an AST crate and may want &'bump Bump
    let mut allocating_writer: Vec<u8> = Vec::new();

    let css_import = chunk
        .content
        .css
        .imports_in_chunk_in_order
        .at(imports_in_chunk_index);
    let css: &BundlerStyleSheet = &chunk.content.css.asts[imports_in_chunk_index as usize];
    // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
    let symbols = &c.graph.symbols;

    match &css_import.kind {
        CssImportKind::Layers => {
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                worker.allocator,
                &mut allocating_writer,
                printer_options,
                bun_css::ImportInfo {
                    import_records: &css_import.condition_import_records,
                    ast_urls_for_css: c.parse_graph.ast.items().url_for_css,
                    ast_unique_key_for_additional_file: c
                        .parse_graph
                        .input_files
                        .items()
                        .unique_key_for_additional_file,
                },
                &c.mangled_props,
                // layer does not need symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(bun_core::err!("PrintError")),
                        source_index: Index::INVALID.get(),
                    };
                }
            }
            CompileResult::Css {
                result: Ok(allocating_writer.into_boxed_slice()),
                source_index: Index::INVALID.get(),
            }
        }
        CssImportKind::ExternalPath => {
            let import_records = BabyList::<ImportRecord>::from_borrowed_slice_dangerous(
                css_import.condition_import_records.slice_const(),
            );
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                worker.allocator,
                &mut allocating_writer,
                printer_options,
                bun_css::ImportInfo {
                    import_records: &import_records,
                    ast_urls_for_css: c.parse_graph.ast.items().url_for_css,
                    ast_unique_key_for_additional_file: c
                        .parse_graph
                        .input_files
                        .items()
                        .unique_key_for_additional_file,
                },
                &c.mangled_props,
                // external_path does not need symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(bun_core::err!("PrintError")),
                        source_index: Index::INVALID.get(),
                    };
                }
            }
            CompileResult::Css {
                result: Ok(allocating_writer.into_boxed_slice()),
                source_index: Index::INVALID.get(),
            }
        }
        CssImportKind::SourceIndex(idx) => {
            let printer_options = PrinterOptions {
                targets: Targets::for_bundler_target(c.options.target),
                // TODO: make this more configurable
                minify: c.options.minify_whitespace
                    || c.options.minify_syntax
                    || c.options.minify_identifiers,
                ..Default::default()
            };
            match css.to_css_with_writer(
                worker.allocator,
                &mut allocating_writer,
                printer_options,
                bun_css::ImportInfo {
                    import_records: &c.graph.ast.items().import_records[idx.get() as usize],
                    ast_urls_for_css: c.parse_graph.ast.items().url_for_css,
                    ast_unique_key_for_additional_file: c
                        .parse_graph
                        .input_files
                        .items()
                        .unique_key_for_additional_file,
                },
                &c.mangled_props,
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(bun_core::err!("PrintError")),
                        source_index: idx.get(),
                    };
                }
            }
            let output = allocating_writer.into_boxed_slice();
            // Update bytesInOutput for this source in the chunk (for metafile)
            // Use atomic operation since multiple threads may update the same counter
            if !output.is_empty() {
                if let Some(bytes_ptr) = chunk.files_with_parts_in_chunk.get(&idx.get()) {
                    // TODO(port): files_with_parts_in_chunk value type must be AtomicUsize for this to be sound
                    bytes_ptr.fetch_add(output.len(), Ordering::Relaxed);
                }
            }
            CompileResult::Css {
                result: Ok(output),
                source_index: idx.get(),
            }
        }
    }
}

// TODO(port): CssImportKind is defined elsewhere in bun_bundler (chunk.content.css.imports_in_chunk_in_order element .kind);
// referenced here for match exhaustiveness — Phase B should `use` the real type.
use crate::chunk::CssImportKind;

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/generateCompileResultForCssChunk.zig (178 lines)
//   confidence: medium
//   todos:      3
//   notes:      @fieldParentPtr intrusive recovery kept raw; allocating_writer→Vec<u8>; toCssWithWriter ImportInfo struct + MultiArrayList .items() accessor shapes are guesses; ctx.c/ctx.chunk treated as raw ptrs per BACKREF semantics
// ──────────────────────────────────────────────────────────────────────────
