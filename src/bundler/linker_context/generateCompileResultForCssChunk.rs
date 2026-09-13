use crate::mal_prelude::*;
use core::sync::atomic::Ordering;

use bun_ast::{E, Expr, ExprNodeList, ImportRecord};
use bun_collections::VecExt;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::bun_css::{BundlerStyleSheet, ImportInfo, LocalsResultsMap, PrinterOptions, Targets};

use crate::chunk::{Content, CssImportOrderKind};
use crate::linker_context_mod::LinkerContext;
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index};

// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// `PendingPartRange`. Writes: `chunk.compile_results_for_chunk[i]` (disjoint
// by per-task `i`). Reads `c.graph.ast.css` / `c.options` shared. Never forms
// `&mut LinkerContext` — `c_ptr` stays raw; the CSS printer takes
// `&LinkerContext`. See `generate_compile_result_for_js_chunk` for the
// `PendingPartRange: Send` justification.
//
/// # Safety
///
/// `task` must be the intrusive `task` field of a live `PendingPartRange`
/// scheduled by `generate_chunks_in_parallel`; see
/// [`pending_part_range_prologue`](crate::linker_context_mod::pending_part_range_prologue)
/// for the full contract. The signature matches `ThreadPoolLib::Task::callback`
/// (`unsafe fn(*mut Task)`).
pub(crate) unsafe fn generate_compile_result_for_css_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` is the intrusive `task` field of a `PendingPartRange`
    // scheduled by `generate_chunks_in_parallel`; see the helper's contract.
    let (part_range, c_ptr, chunk_ptr, mut worker) =
        unsafe { crate::linker_context_mod::pending_part_range_prologue(task) };

    // CONCURRENCY: the CSS impl is read-only over `c`/`chunk` (the
    // `bytesInOutput` bump goes through `&AtomicUsize`), so form `&` — never
    // `&mut` — to avoid aliased exclusive borrows across peer worker tasks.
    // The `&` borrows are scoped to the impl call so they do not overlap the
    // raw slot write that follows.
    let result = {
        // SAFETY: `c_ptr` is the live `LinkerContext` returned by
        // `pending_part_range_prologue`; see its contract.
        let c_ref: &LinkerContext = unsafe { &*c_ptr };
        // SAFETY: `chunk_ptr` is the live `Chunk` from the same prologue; this
        // `&` is scoped so it does not overlap the raw slot write below.
        let chunk_ref: &Chunk = unsafe { &*chunk_ptr };
        generate_compile_result_for_css_chunk_impl(&mut **worker, c_ref, chunk_ref, part_range.i)
    };

    // SAFETY: per-task unique `i`; see `Chunk::write_compile_result_slot`.
    // The slot write is routed through raw `addr_of_mut!` + `UnsafeCell` so it
    // never materializes `&mut Chunk` / `&mut [CompileResult]`.
    unsafe { Chunk::write_compile_result_slot(chunk_ptr, part_range.i as usize, result) };
}

/// Prints each CSS module script (see [`LinkerContext::css_module_scripts`])
/// the way a CSS chunk rooted at it would print, into the argument of its
/// stub's `__cssModule()` call.
pub(crate) fn generate_css_module_script_texts(c: &mut LinkerContext) -> Result<(), crate::Error> {
    let entries: Vec<(u32, crate::linker_context_mod::CssModuleScript)> = c
        .css_module_scripts
        .iter()
        .filter(|(_, script)| script.call.is_some())
        .map(|(&source_index, &script)| (source_index, script))
        .collect();
    if entries.is_empty() {
        return Ok(());
    }

    let separator: &[u8] = if c.options.minify_whitespace {
        b""
    } else {
        b"\n"
    };

    // SAFETY: `c` is the `linker` field of the live `BundleV2`. Holding the
    // worker also gives `Expr::init` below an AST store to allocate from.
    let bundle = unsafe { &*LinkerContext::bundle_v2_ptr(std::ptr::from_mut(c)) };
    let mut worker = scopeguard::guard(Worker::get(bundle), |w| w.unget());
    let mut texts: Vec<&[u8]> = Vec::with_capacity(entries.len());
    for &(source_index, _) in &entries {
        texts.push(render_css_module_script(
            c,
            &mut worker,
            source_index,
            separator,
        )?);
    }

    let url_ref = c.runtime_function(b"__cssUrl");
    for ((_, script), css) in entries.into_iter().zip(texts) {
        let mut call = script.call.expect("filtered above");
        let loc = call.args.slice()[0].loc;
        let placeholders = if script.resolve_asset_urls {
            asset_placeholders(css, &c.unique_key_prefix)
        } else {
            Vec::new()
        };
        let argument = if placeholders.is_empty() {
            let mut string = E::EString::init(css);
            string.prefer_template = !c.options.minify_whitespace;
            Expr::init(string, loc)
        } else {
            // `head${__cssUrl("<asset placeholder>", import.meta.url)}tail...`
            let mut parts: Vec<E::TemplatePart> = Vec::with_capacity(placeholders.len());
            for (i, &(start, end)) in placeholders.iter().enumerate() {
                let tail_end = placeholders.get(i + 1).map_or(css.len(), |next| next.0);
                let url = Expr::init(
                    E::Call {
                        target: Expr::init(
                            E::Identifier {
                                ref_: url_ref,
                                ..Default::default()
                            },
                            loc,
                        ),
                        args: ExprNodeList::from_slice(&[
                            Expr::init(E::EString::init(&css[start..end]), loc),
                            Expr::init(
                                E::Dot {
                                    target: Expr::init(E::ImportMeta {}, loc),
                                    name: b"url".as_slice().into(),
                                    name_loc: loc,
                                    ..Default::default()
                                },
                                loc,
                            ),
                        ]),
                        can_be_unwrapped_if_unused: E::CallUnwrap::IfUnused,
                        ..Default::default()
                    },
                    loc,
                );
                parts.push(E::TemplatePart {
                    value: url,
                    tail: E::TemplateContents::Cooked(E::EString::init(&css[end..tail_end])),
                    tail_loc: loc,
                });
            }
            Expr::init(
                E::Template {
                    tag: None,
                    head: E::TemplateContents::Cooked(E::EString::init(&css[..placeholders[0].0])),
                    parts: bun_ast::StoreSlice::new_mut(c.arena().alloc_slice_fill_iter(parts)),
                },
                loc,
            )
        };
        call.args.slice_mut()[0] = argument;
    }

    Ok(())
}

/// `[start, end)` of every copied-asset placeholder (`<unique_key_prefix>A<8 digits>`)
/// in `css`, in order. See `LinkerContext::break_output_into_pieces`.
fn asset_placeholders(css: &[u8], prefix: &[u8]) -> Vec<(usize, usize)> {
    let mut found = Vec::new();
    let mut offset = 0;
    while let Some(at) = bun_core::strings::index_of(&css[offset..], prefix) {
        let start = offset + at;
        let end = start + prefix.len() + 9;
        if end > css.len() {
            break;
        }
        if css[start + prefix.len()] == crate::chunk::QueryKind::Asset.letter()
            && css[start + prefix.len() + 1..end]
                .iter()
                .all(u8::is_ascii_digit)
        {
            found.push((start, end));
        }
        offset = end;
    }
    found
}

/// The CSS text of one CSS module script, in the linker arena.
fn render_css_module_script(
    c: &mut LinkerContext,
    worker: &mut Worker,
    source_index: u32,
    separator: &[u8],
) -> Result<&'static [u8], crate::Error> {
    let order =
        crate::linker_context::find_imported_files_in_css_order::find_imported_files_in_css_order(
            c,
            worker.arena(),
            &[Index::init(source_index)],
        );
    let count = order.len() as usize;
    let mut chunk = Chunk {
        content: Content::Css(crate::chunk::CssChunk {
            imports_in_chunk_in_order: order,
            asts: (0..count).map(|_| BundlerStyleSheet::empty()).collect(),
        }),
        ..Default::default()
    };
    crate::linker_context::prepare_css_asts_for_chunk::prepare_css_asts_for_chunk_impl(
        c,
        &mut chunk,
        worker.arena(),
    );

    let mut css: Vec<u8> = Vec::new();
    for i in 0..count {
        match generate_compile_result_for_css_chunk_impl(worker, c, &chunk, i as u32) {
            CompileResult::Css {
                result: Ok(code), ..
            } => {
                let code = bun_core::strings::trim(&code, b" \n\r\t");
                if code.is_empty() {
                    continue;
                }
                if !css.is_empty() {
                    css.extend_from_slice(separator);
                }
                css.extend_from_slice(code);
            }
            CompileResult::Css {
                result: Err(err),
                source_index: failed_source_index,
                ..
            } => {
                let source = if failed_source_index != Index::INVALID.get() {
                    Some(c.get_source(failed_source_index))
                } else {
                    None
                };
                c.log_mut().add_error(
                    source,
                    bun_ast::Loc::EMPTY,
                    std::borrow::Cow::Owned(
                        format!("Failed to generate CSS for this file ({})", err.name())
                            .into_bytes(),
                    ),
                );
                return Err(crate::Error::PrintError);
            }
            _ => unreachable!("CSS chunk produced a non-CSS compile result"),
        }
    }

    // SAFETY: the linker arena outlives the JS printer that reads this text.
    Ok(unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(c.arena().alloc_slice_copy(&css)) })
}

fn generate_compile_result_for_css_chunk_impl(
    worker: &mut Worker,
    c: &LinkerContext,
    chunk: &Chunk,
    imports_in_chunk_index: u32,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkCss");
    // `defer trace.end()` — RAII; Drop ends the trace.

    // `worker.arena` (= `BackRef` to `worker.heap`) is a disjoint field from
    // `worker.temporary_arena` borrowed `&mut` below, so a direct shared
    // borrow via `BackRef::get` is fine. The heap is pinned for the worker's
    // lifetime; see `Worker::arena`.
    let arena = worker.arena.get();
    let _arena_reset = scopeguard::guard(&mut worker.temporary_arena, |arena| {
        // temporary_arena is initialized in Worker::create before any task runs.
        if let Some(a) = arena.as_mut() {
            a.reset();
        }
    });
    let mut allocating_writer: Vec<u8> = Vec::new();

    let Content::Css(css_content) = &chunk.content else {
        unreachable!("generateCompileResultForCssChunk called on non-CSS chunk");
    };
    let css_import = css_content
        .imports_in_chunk_in_order
        .at(imports_in_chunk_index as usize);
    let css: &BundlerStyleSheet = &css_content.asts[imports_in_chunk_index as usize];
    // const symbols: []const Symbol.List = c.graph.ast.items(.symbols);
    // SAFETY: `to_css_with_writer` takes `&bun_ast::symbol::Map`, but
    // `c.graph.symbols` is `bun_ast::symbol::Map`. Both are
    // `{ symbols_for_source: NestedList }` (`UnsafeCell<T>` is `repr(transparent)`),
    // so layouts match — bridge by pointer cast.
    let symbols: &bun_ast::symbol::Map =
        unsafe { &*(&raw const c.graph.symbols).cast::<bun_ast::symbol::Map>() };
    // `LocalsResultsMap` is the same `ArrayHashMap<Ref, Box<[u8]>>` alias as
    // `bun_js_printer::MangledProps`; no cast needed.
    let local_names: &LocalsResultsMap = &c.mangled_props;
    let parse_graph = c.parse_graph();
    // SAFETY: read-only fan-out of `&[Box<[u8]>]` as `&[&[u8]]`; relies on
    // fat-pointer field-order equivalence (see `boxed_slices_as_borrowed`).
    let unique_keys: &[&[u8]] = unsafe {
        bun_ptr::boxed_slices_as_borrowed(
            parse_graph
                .input_files
                .items_unique_key_for_additional_file(),
        )
    };

    match &css_import.kind {
        CssImportOrderKind::Layers(_) => {
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                &printer_options,
                Some(ImportInfo {
                    import_records: &css_import.condition_import_records,
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                // layer does not need symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(crate::Error::PrintError),
                        source_index: Index::INVALID.get(),
                        source_map: None,
                    };
                }
            }
            CompileResult::Css {
                result: Ok(allocating_writer.into_boxed_slice()),
                source_index: Index::INVALID.get(),
                source_map: None,
            }
        }
        CssImportOrderKind::ExternalPath(_) => {
            // SAFETY: borrows `condition_import_records` storage for the duration of the
            // `to_css_with_writer` call below; the borrowed Vec is dropped (no-op)
            // before `css_import` goes out of scope, so no double-free / dangling.
            let import_records = unsafe {
                Vec::<ImportRecord>::from_borrowed_slice_dangerous(
                    css_import.condition_import_records.slice_const(),
                )
            };
            let printer_options = PrinterOptions {
                // TODO: make this more configurable
                minify: c.options.minify_whitespace,
                targets: Targets::for_bundler_target(c.options.target),
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                &printer_options,
                Some(ImportInfo {
                    import_records: &import_records,
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                // external_path does not need symbols i think
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(crate::Error::PrintError),
                        source_index: Index::INVALID.get(),
                        source_map: None,
                    };
                }
            }
            CompileResult::Css {
                result: Ok(allocating_writer.into_boxed_slice()),
                source_index: Index::INVALID.get(),
                source_map: None,
            }
        }
        CssImportOrderKind::SourceIndex(idx) => {
            let printer_options = PrinterOptions {
                targets: Targets::for_bundler_target(c.options.target),
                // TODO: make this more configurable
                minify: c.options.minify_whitespace
                    || c.options.minify_syntax
                    || c.options.minify_identifiers,
                ..Default::default()
            };
            match css.to_css_with_writer(
                arena,
                &mut allocating_writer,
                &printer_options,
                Some(ImportInfo {
                    import_records: &c.graph.ast.items_import_records()[idx.get() as usize],
                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                    ast_unique_key_for_additional_file: unique_keys,
                }),
                Some(local_names),
                symbols,
            ) {
                Ok(_) => {}
                Err(_) => {
                    return CompileResult::Css {
                        result: Err(crate::Error::PrintError),
                        source_index: idx.get(),
                        source_map: None,
                    };
                }
            }
            let output = allocating_writer.into_boxed_slice();
            // Update bytesInOutput for this source in the chunk (for metafile)
            // Use atomic operation since multiple threads may update the same counter
            if !output.is_empty() {
                // CONCURRENCY: key set is frozen before parallel codegen; take a
                // shared `&AtomicUsize` so concurrent workers updating the same
                // source counter never alias a `&mut`.
                if let Some(bytes) = chunk.files_with_parts_in_chunk.get(&idx.get()) {
                    let _ = bytes.fetch_add(output.len(), Ordering::Relaxed);
                }
            }
            CompileResult::Css {
                result: Ok(output),
                source_index: idx.get(),
                source_map: None,
            }
        }
    }
}
