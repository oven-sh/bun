use crate::mal_prelude::*;
use std::borrow::Cow;
use std::io::Write as _;

use bun_collections::AutoBitSet;
use bun_collections::StringArrayHashMap;
use bun_collections::StringHashMap;
use bun_core::String as BunString;
use bun_core::strings;
use bun_paths as path;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::BundleV2;
use crate::Chunk;
use crate::Index;
use crate::analyze_transpiled_module;
use crate::analyze_transpiled_module::StringIDExt as _;
use crate::cheap_prefix_normalizer;
use crate::chunk::{ReferencePathStyle, SourceMapShiftTracking};
use crate::options;
use crate::options::Loader;

use crate::LinkerContext;
use crate::linker_context::generate_compile_result_for_css_chunk::generate_compile_result_for_css_chunk;
use crate::linker_context::generate_compile_result_for_html_chunk::generate_compile_result_for_html_chunk;
use crate::linker_context::generate_compile_result_for_js_chunk::generate_compile_result_for_js_chunk;
use crate::linker_context::metafile_builder;
use crate::linker_context::output_file_list_builder::OutputFileList as OutputFileListBuilder;
use crate::linker_context::prepare_css_asts_for_chunk::{
    PrepareCssAstTask, prepare_css_asts_for_chunk,
};
use crate::linker_context::static_route_visitor::StaticRouteVisitor;
use crate::linker_context::write_output_files_to_disk::write_output_files_to_disk;
use crate::linker_context_mod::{GenerateChunkCtx, PendingPartRange};

/// Bytecode output file extension (also defined in `writeOutputFilesToDisk.rs`).
const BYTECODE_EXTENSION: &str = ".jsc";

// `Chunk.final_rel_path` / `metafile_chunk_json` are owned
// `Box<[u8]>`; assignments
// below move the boxed buffer directly — no lifetime promotion needed.
use crate::linker_context_mod::debug;

// Const generics cannot vary the return type, so we always return
// `Vec<OutputFile>` and the IS_DEV_SERVER path returns an empty Vec.
pub(crate) fn generate_chunks_in_parallel<const IS_DEV_SERVER: bool>(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> crate::Result<Vec<options::OutputFile>> {
    let _trace = bun_core::perf::trace("Bundler.generateChunksInParallel");

    c.mangle_local_css();

    let mut has_js_chunk = false;
    let mut has_css_chunk = false;
    let mut has_html_chunk = false;
    debug_assert!(chunks.len() > 0);

    {
        // TODO: instead of running a renamer per chunk, run it per file
        debug!(" START {} renamers", chunks.len());
        if c.graph.code_splitting && !c.options.minify_identifiers {
            crate::linker_context::cross_chunk_names::assign_unminified(c, chunks)?;
        }
        let ctx = GenerateChunkCtx {
            chunk: bun_ptr::BackRef::new_mut(&mut chunks[0]),
            // SAFETY: `c` is the live `&mut LinkerContext` for the link step;
            // write provenance preserved.
            c: unsafe { bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(c)) },
            chunks: bun_ptr::BackRef::new(&*chunks),
        };
        // SAFETY: `parse_graph` is the `BundleV2.graph` backref (valid for the
        // link step); `pool` is the arena-allocated bundler ThreadPool.
        c.worker_pool()
            .each_ptr(ctx, LinkerContext::generate_js_renamer, chunks);
        if !c.options.minify_identifiers {
            // Top-level names are final; name each file's nested scopes in
            // parallel.
            let mut tasks =
                crate::linker_context::rename_symbols_in_chunk::nested_rename_tasks(chunks);
            c.worker_pool().each_ptr(
                ctx,
                crate::linker_context::rename_symbols_in_chunk::run_nested_rename_task,
                &mut tasks,
            );
            for task in tasks {
                if let (crate::bun_renamer::ChunkRenamer::Number(r), Some(names)) =
                    (&mut chunks[task.chunk_index as usize].renamer, task.names)
                {
                    r.absorb(names);
                }
            }
            for chunk in chunks.iter_mut() {
                chunk.nested_scopes_to_rename = Vec::new();
            }
        }
        if c.graph.code_splitting {
            if c.options.minify_identifiers {
                // Counts are in; name the cross-chunk bindings, pin them, then
                // let every chunk name the rest.
                crate::linker_context::cross_chunk_names::assign_minified(c, chunks)?;
                c.worker_pool()
                    .each_ptr(ctx, LinkerContext::finish_js_renamer, chunks);
            }
            crate::linker_context::cross_chunk_names::apply_to_clauses(c, chunks);
        }
        debug!("  DONE {} renamers", chunks.len());
    }

    if c.source_maps.line_offset_tasks.len() > 0 {
        debug!(" START {} source maps (line offset)", chunks.len());
        c.source_maps.line_offset_wait_group.wait();
        // `c.arena().free(...)` + `.len = 0` → Vec drop semantics.
        c.source_maps.line_offset_tasks = Box::default();
        debug!("  DONE {} source maps (line offset)", chunks.len());
    }

    {
        // Per CSS chunk:
        // Remove duplicate rules across files. This must be done in serial, not
        // in parallel, and must be done from the last rule to the first rule.
        if c.parse_graph().css_file_count > 0 {
            let total_count: usize = {
                let mut total_count: usize = 0;
                for chunk in chunks.iter() {
                    if chunk.content.is_css() {
                        total_count += 1;
                    }
                }
                total_count
            };

            debug!(" START {} prepare CSS ast (total count)", total_count);

            let group = bun_threading::WaitGroup::init_with_count(total_count);
            let mut batch = ThreadPoolLib::Batch::default();
            let mut tasks: Vec<PrepareCssAstTask> = Vec::with_capacity(total_count);
            for chunk in chunks.iter_mut() {
                if chunk.content.is_css() {
                    tasks.push(PrepareCssAstTask {
                        task: ThreadPoolLib::CountedTask::new(prepare_css_asts_for_chunk, &group),
                        chunk: std::ptr::from_mut::<Chunk>(chunk),
                        // `PrepareCssAstTask.linker` is `*mut LinkerContext<'static>`
                        // (raw ptr is invariant); `.cast()` erases the inner `'a` to satisfy it.
                        linker: std::ptr::from_mut::<LinkerContext>(c).cast(),
                    });
                    // Capacity pre-reserved → push never reallocates → ptr stays stable.
                    let task = tasks.last_mut().unwrap();
                    batch.push(ThreadPoolLib::Batch::from(&raw mut task.task.task));
                }
            }
            debug_assert_eq!(tasks.len(), total_count);
            c.worker_pool().schedule(batch);
            group.wait();

            debug!("  DONE {} prepare CSS ast (total count)", total_count);
        } else if cfg!(debug_assertions) {
            for chunk in chunks.iter() {
                debug_assert!(!chunk.content.is_css());
            }
        }
    }

    {
        let mut chunk_contexts: Vec<GenerateChunkCtx> = Vec::with_capacity(chunks.len());

        {
            let mut total_count: usize = 0;
            // `GenerateChunkCtx` fields are raw pointers; capture them
            // before the `iter_mut()` borrow so the same slice backref can be
            // stored in every ctx.
            // SAFETY: `c` is the live `&mut LinkerContext` for the link step.
            let c_ref =
                unsafe { bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(c)) };
            let chunks_ref: bun_ptr::BackRef<[Chunk]> = bun_ptr::BackRef::new(&*chunks);
            for chunk in chunks.iter_mut() {
                chunk_contexts.push(GenerateChunkCtx {
                    c: c_ref,
                    chunks: chunks_ref,
                    chunk: bun_ptr::BackRef::new_mut(chunk),
                });
                match &mut chunk.content {
                    crate::chunk::Content::Javascript(js) => {
                        total_count += js.parts_in_chunk_in_order.len();
                        chunk.compile_results_for_chunk =
                            crate::chunk::CompileResultSlots::new(js.parts_in_chunk_in_order.len());
                        has_js_chunk = true;
                    }
                    crate::chunk::Content::Css(css) => {
                        has_css_chunk = true;
                        total_count += css.imports_in_chunk_in_order.len() as usize;
                        chunk.compile_results_for_chunk = crate::chunk::CompileResultSlots::new(
                            css.imports_in_chunk_in_order.len() as usize,
                        );
                    }
                    crate::chunk::Content::Html => {
                        has_html_chunk = true;
                        // HTML gets only one chunk.
                        total_count += 1;
                        chunk.compile_results_for_chunk = crate::chunk::CompileResultSlots::new(1);
                    }
                }
            }

            debug_assert_eq!(chunks.len(), chunk_contexts.len());

            debug!(" START {} compiling part ranges", total_count);
            // Pre-reserved to `total_count` so pushes never reallocate; the
            // batch holds raw pointers into this buffer.
            let group = bun_threading::WaitGroup::init_with_count(total_count);
            let mut combined_part_ranges: Vec<PendingPartRange> = Vec::with_capacity(total_count);
            let mut batch = ThreadPoolLib::Batch::default();
            for (chunk, chunk_ctx) in chunks.iter_mut().zip(chunk_contexts.iter_mut()) {
                match &chunk.content {
                    crate::chunk::Content::Javascript(js) => {
                        for (i, part_range) in js.parts_in_chunk_in_order.iter().enumerate() {
                            combined_part_ranges.push(PendingPartRange {
                                part_range: *part_range,
                                i: u32::try_from(i).expect("int cast"),
                                task: ThreadPoolLib::CountedTask::new(
                                    generate_compile_result_for_js_chunk,
                                    &group,
                                ),
                                // SAFETY: `PendingPartRange.ctx` is `&'a GenerateChunkCtx<'a>`,
                                // conflating the borrow with
                                // LinkerContext's `'a`. Launder via raw ptr so borrowck
                                // doesn't pin `chunk_contexts` for `'a`; tasks complete
                                // before `chunk_contexts` drops (we `group.wait()` below).
                                ctx: unsafe {
                                    bun_ptr::detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)
                                },
                            });
                            batch.push(ThreadPoolLib::Batch::from(
                                &raw mut combined_part_ranges.last_mut().unwrap().task.task,
                            ));
                        }
                    }
                    crate::chunk::Content::Css(css) => {
                        for i in 0..css.imports_in_chunk_in_order.len() as usize {
                            combined_part_ranges.push(PendingPartRange {
                                part_range: Default::default(),
                                i: u32::try_from(i).expect("int cast"),
                                task: ThreadPoolLib::CountedTask::new(
                                    generate_compile_result_for_css_chunk,
                                    &group,
                                ),
                                // SAFETY: `PendingPartRange.ctx` is `&'a GenerateChunkCtx<'a>`,
                                // conflating the borrow with
                                // LinkerContext's `'a`. Launder via raw ptr so borrowck
                                // doesn't pin `chunk_contexts` for `'a`; tasks complete
                                // before `chunk_contexts` drops (we `group.wait()` below).
                                ctx: unsafe {
                                    bun_ptr::detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)
                                },
                            });
                            batch.push(ThreadPoolLib::Batch::from(
                                &raw mut combined_part_ranges.last_mut().unwrap().task.task,
                            ));
                        }
                    }
                    crate::chunk::Content::Html => {
                        combined_part_ranges.push(PendingPartRange {
                            part_range: Default::default(),
                            i: 0,
                            task: ThreadPoolLib::CountedTask::new(
                                generate_compile_result_for_html_chunk,
                                &group,
                            ),
                            // SAFETY: `PendingPartRange.ctx` is `&'a GenerateChunkCtx<'a>`,
                            // conflating the borrow with
                            // LinkerContext's `'a`. Launder via raw ptr so borrowck
                            // doesn't pin `chunk_contexts` for `'a`; tasks complete
                            // before `chunk_contexts` drops (we `group.wait()` below).
                            ctx: unsafe {
                                bun_ptr::detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)
                            },
                        });
                        batch.push(ThreadPoolLib::Batch::from(
                            &raw mut combined_part_ranges.last_mut().unwrap().task.task,
                        ));
                    }
                }
            }
            debug_assert_eq!(combined_part_ranges.len(), total_count);
            c.worker_pool().schedule(batch);
            group.wait();
            debug!("  DONE {} compiling part ranges", total_count);
        }

        if c.source_maps.quoted_contents_tasks.len() > 0 {
            debug!(" START {} source maps (quoted contents)", chunks.len());
            c.source_maps.quoted_contents_wait_group.wait();
            c.source_maps.quoted_contents_tasks = Box::default();
            debug!("  DONE {} source maps (quoted contents)", chunks.len());
        }

        // A part that failed to print (e.g. the recursion guard tripped on a
        // deeply nested AST) must fail the build instead of joining the chunk
        // as silently truncated output. Dev server excluded: its callers turn
        // any `Err` here into an OOM panic (see `finish_from_bake_dev_server`),
        // so unprintable parts keep the old dropped-code behavior there.
        if !IS_DEV_SERVER {
            let mut had_print_error = false;
            // Without code splitting a failing file is printed once per chunk
            // that includes it; report each file once.
            let mut reported_sources = AutoBitSet::init_empty(c.parse_graph().input_files.len())?;
            for chunk in chunks.iter() {
                for compile_result in chunk.compile_results_for_chunk.iter() {
                    let message: Cow<'static, [u8]> = match compile_result {
                        crate::CompileResult::Javascript {
                            result: bun_js_printer::PrintResult::Err(err),
                            ..
                        } => match err {
                            bun_js_printer::Error::StackOverflow => Cow::Borrowed(
                                b"Maximum call stack size exceeded while generating code for this file"
                                    .as_slice(),
                            ),
                            err => Cow::Owned(
                                format!("Failed to generate code for this file ({})", err.name())
                                    .into_bytes(),
                            ),
                        },
                        crate::CompileResult::Css {
                            result: Err(err), ..
                        } => Cow::Owned(
                            format!("Failed to generate CSS for this file ({})", err.name())
                                .into_bytes(),
                        ),
                        _ => continue,
                    };
                    had_print_error = true;
                    let source_index = compile_result.source_index();
                    let source = if source_index != Index::INVALID.get() {
                        if reported_sources.is_set(source_index as usize) {
                            continue;
                        }
                        reported_sources.set(source_index as usize);
                        Some(c.get_source(source_index))
                    } else {
                        None
                    };
                    c.log_mut().add_error(source, bun_ast::Loc::EMPTY, message);
                }
            }
            if had_print_error {
                return Err(crate::Error::PrintError);
            }
        }

        // For dev server, only post-process CSS + HTML chunks.
        let chunks_to_do: &mut [Chunk] = if IS_DEV_SERVER {
            &mut chunks[1..]
        } else {
            chunks
        };
        if !IS_DEV_SERVER || chunks_to_do.len() > 0 {
            debug_assert!(chunks_to_do.len() > 0);
            debug!(" START {} postprocess chunks", chunks_to_do.len());

            // SAFETY: `parse_graph` is the `BundleV2.graph` backref (valid for
            // the link step); `pool` is the arena-allocated bundler ThreadPool.
            c.worker_pool().each_ptr(
                chunk_contexts[0],
                LinkerContext::generate_chunk,
                chunks_to_do,
            );

            debug!("  DONE {} postprocess chunks", chunks_to_do.len());
        }
    }

    // When bake.DevServer is in use, we're going to take a different code path at the end.
    // We want to extract the source code of each part instead of combining it into a single file.
    // This is so that when hot-module updates happen, we can:
    //
    // - Reuse unchanged parts to assemble the full bundle if Cmd+R is used in the browser
    // - Send only the newly changed code through a socket.
    // - Use IncrementalGraph to have full knowledge of referenced CSS files.
    //
    // When this isn't the initial bundle, concatenation as usual would produce a
    // broken module. It is DevServer's job to create and send HMR patches.
    if IS_DEV_SERVER {
        return Ok(Vec::new());
    }

    // TODO: enforceNoCyclicChunkImports()
    {
        let mut path_names_map: StringHashMap<u32> = StringHashMap::default();

        #[derive(Default)]
        struct DuplicateEntry {
            // `BackRef` (not `*mut`) — entries point at elements of the
            // stack-owned `chunks: &mut [Chunk]` above, which outlives the
            // `duplicates_map`; reads go through safe `Deref`.
            sources: Vec<bun_ptr::BackRef<Chunk>>,
        }
        let mut duplicates_map: StringArrayHashMap<DuplicateEntry> = StringArrayHashMap::default();

        // Compute the final hashes of each chunk, then use those to create the final
        // paths of each chunk.
        let hashes = c.final_chunk_hashes(chunks)?;
        for index in 0..chunks.len() {
            let chunk = &mut chunks[index];
            chunk.template.placeholder.hash = Some(hashes[index]);

            let mut rel_path: Vec<u8> = Vec::new();
            // Use the byte-writer (`PathTemplate::print`) directly —
            // routing through `Display`/`write!` goes via `from_utf8_lossy`,
            // which would replace non-UTF-8 dir bytes with U+FFFD and corrupt
            // the output path.
            // Disk output sanitizes leading `..`; `--compile` keeps it so
            // runtime bunfs references to out-of-root entrypoints resolve.
            chunk
                .template
                .print(&mut rel_path, !c.options.compile_mode.is_executable())
                .expect("write to Vec<u8>");
            path::resolve_path::platform_to_posix_in_place::<u8>(&mut rel_path);

            // A `./[dir]/…` template with `[dir] == "."` yields `././x.js`,
            // which importers of the chunk would copy verbatim.
            while let Some(i) = strings::index_of(&rel_path, b"/./") {
                rel_path.drain(i..i + 2);
            }

            let claimed = path_names_map.get_or_put(&rel_path)?;
            if claimed.found_existing {
                let first = *claimed.value_ptr as usize;
                let dup = duplicates_map.get_or_put(&rel_path)?;
                if !dup.found_existing {
                    *dup.value_ptr = DuplicateEntry::default();
                    dup.value_ptr
                        .sources
                        .push(bun_ptr::BackRef::new(&chunks[first]));
                }
                dup.value_ptr
                    .sources
                    .push(bun_ptr::BackRef::new(&chunks[index]));
                continue;
            }
            *claimed.value_ptr = index as u32;

            chunks[index].final_rel_path = rel_path.into_boxed_slice();
        }

        if duplicates_map.count() > 0 {
            let mut msg: Vec<u8> = Vec::new();
            // errdefer msg.deinit() — handled by Drop

            let mut entry_naming: Option<&[u8]> = None;
            let mut chunk_naming: Option<&[u8]> = None;
            let mut asset_naming: Option<&[u8]> = None;

            writeln!(&mut msg, "Multiple files share the same output path")?;

            let kinds = c.graph.files.items_entry_point_kind();

            for (key, dup) in duplicates_map
                .keys()
                .iter()
                .zip(duplicates_map.values().iter())
            {
                writeln!(&mut msg, "  {}:", bstr::BStr::new(key))?;
                for chunk in dup.sources.iter() {
                    if chunk.entry_point.is_entry_point() {
                        if kinds[chunk.entry_point.source_index() as usize]
                            == EntryPoint::Kind::UserSpecified
                        {
                            entry_naming = Some(&chunk.template.data);
                        } else {
                            chunk_naming = Some(&chunk.template.data);
                        }
                    } else {
                        asset_naming = Some(&chunk.template.data);
                    }

                    let source_index = chunk.entry_point.source_index();
                    let file: &bun_ast::Source =
                        &c.parse_graph().input_files.items_source()[source_index as usize];
                    writeln!(
                        &mut msg,
                        "    from input {}",
                        bstr::BStr::new(&file.path.pretty)
                    )?;
                }
            }

            c.log_mut().add_error(None, bun_ast::Loc::EMPTY, msg);

            for (name, template) in [
                ("entry", entry_naming),
                ("chunk", chunk_naming),
                ("asset", asset_naming),
            ] {
                let Some(template) = template else { continue };

                let mut text: Vec<u8> = Vec::new();
                if crate::options::path_template_hash_len(template).is_some() {
                    write!(
                        &mut text,
                        "{} naming is '{}'; these inputs produce identical content",
                        name,
                        bstr::BStr::new(template),
                    )?;
                } else {
                    write!(
                        &mut text,
                        "{} naming is '{}', consider adding '[hash]' to make filenames unique",
                        name,
                        bstr::BStr::new(template),
                    )?;
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

            return Err(crate::Error::DuplicateOutputPath);
        }
    }

    // After final_rel_path is computed for all chunks, fix up module_info
    // cross-chunk import specifiers. During printing, cross-chunk imports use
    // unique_key placeholders as paths. Now that final paths are known, replace
    // those placeholders with the resolved paths and serialize.
    let external_string_table = (c.options.generate_bytecode_cache
        && c.options.compile_mode.is_executable())
    .then(crate::bundle_v2::dispatch::EncoderStringTableHandle::new);
    let mut module_info_strings = analyze_transpiled_module::ModuleInfoSlotTableBuilder::default();
    if c.options.generates_module_info() {
        let external_string_table = external_string_table
            .as_ref()
            .expect("module_info is only generated for --compile --bytecode");
        // Build map from unique_key -> final resolved path
        // SAFETY: c points to LinkerContext which is the `linker` field of BundleV2.
        let b: &mut BundleV2 =
            unsafe { &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(c)) };
        let mut unique_key_to_path: StringHashMap<Box<[u8]>> = StringHashMap::default();
        for ch in chunks.iter() {
            if ch.unique_key.len() > 0 && ch.final_rel_path.len() > 0 {
                // Use the per-chunk public_path to match what IntermediateOutput.code()
                // uses during emission (browser chunks from server builds use the
                // browser transpiler's public_path).
                let public_path: &[u8] = if ch
                    .flags
                    .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
                {
                    &b.transpiler_for_target(options::Target::Browser)
                        .options
                        .public_path
                } else {
                    c.options.public_path
                };
                let normalizer = cheap_prefix_normalizer(public_path, &ch.final_rel_path);
                let mut resolved: Vec<u8> = Vec::new();
                resolved.extend_from_slice(normalizer[0]);
                resolved.extend_from_slice(normalizer[1]);
                let _ = unique_key_to_path.put(ch.unique_key, resolved.into_boxed_slice()); // OOM-only Result
            }
        }

        // Fix up each chunk's module_info; every chunk's strings go into one
        // table (`OutputKind::ModuleInfoStringTable`) their bodies index into.
        let mut table_ids: Vec<Vec<u32>> = Vec::new();
        for chunk in chunks.iter_mut() {
            let crate::chunk::Content::Javascript(js) = &mut chunk.content else {
                continue;
            };
            let Some(mi) = js.module_info.as_mut() else {
                continue;
            };

            // Collect replacements first (can't modify string table while iterating)
            struct Replacement {
                old_id: analyze_transpiled_module::StringID,
                resolved_path: Box<[u8]>,
            }
            let mut replacements: Vec<Replacement> = Vec::new();

            // `as_deserialized()` debug-asserts `finalized`; this runs pre-finalize
            // so `replace_string_id` (asserts `!finalized`) can still mutate.
            let (strings_buf, strings_lens): (&[u8], &[u32]) = mi.strings();
            let mut offset: usize = 0;
            for (string_index, &slen) in strings_lens.iter().enumerate() {
                let len: usize = usize::try_from(slen).expect("int cast");
                let s = &strings_buf[offset..][..len];
                if let Some(resolved_path) = unique_key_to_path.get(s) {
                    replacements.push(Replacement {
                        old_id: analyze_transpiled_module::StringID::from_raw(
                            u32::try_from(string_index).expect("int cast"),
                        ),
                        resolved_path: resolved_path.clone(),
                    });
                }
                offset += len;
            }

            for rep in replacements.iter() {
                let new_id = mi.str(&rep.resolved_path);
                mi.replace_string_id(rep.old_id, new_id);
            }

            if mi.finalize().is_err() {
                js.module_info = None;
                continue;
            }
            table_ids.push(module_info_strings.intern_all(mi, |s| external_string_table.slot(s)));
        }
        let mut table_ids = table_ids.iter();
        for chunk in chunks.iter_mut() {
            let crate::chunk::Content::Javascript(js) = &mut chunk.content else {
                continue;
            };
            let Some(mi) = js.module_info.take() else {
                continue;
            };
            js.module_info_bytes = Some(bun_js_printer::serialize_module_info_body(
                &mi,
                module_info_strings.count(),
                table_ids.next().expect("one per chunk with module_info"),
            ));
        }
    }

    // Generate metafile JSON fragments for each chunk (after paths are resolved)
    if c.options.metafile {
        // Reshaped for borrowck — `generate_chunk_json` reads all chunks
        // immutably while we write one chunk's `metafile_chunk_json`; index split.
        for i in 0..chunks.len() {
            let json =
                metafile_builder::generate_chunk_json(c, &chunks[i], chunks).unwrap_or_default();
            chunks[i].metafile_chunk_json = json;
        }
    }

    let mut output_files =
        OutputFileListBuilder::init(c, chunks, c.parse_graph().additional_output_files.len())?;

    // Copy the `ParentRef` out (not `c.resolver()`) so `root_path` borrows the
    // local, not `c`, avoiding the split-borrow with `&mut *c` passed to
    // `write_output_files_to_disk` below — `output_dir` lives in the resolver,
    // disjoint from anything `c` mutates.
    let resolver = c.resolver.expect("resolver set in load()");
    let root_path: &[u8] = &resolver.opts.output_dir;
    let is_standalone = c.options.compile_mode.is_standalone_html();
    let more_than_one_output = !is_standalone
        && (c.parse_graph().additional_output_files.len() > 0
            || c.options.generate_bytecode_cache
            || (has_css_chunk && has_js_chunk)
            || (has_html_chunk && (has_js_chunk || has_css_chunk)));

    if !c.resolver().opts.compile
        && more_than_one_output
        && !c.resolver().opts.supports_multiple_outputs
    {
        c.log_mut().add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"cannot write multiple output files without an output directory",
        );
        return Err(crate::Error::MultipleOutputFilesWithoutOutputDir);
    }

    // SAFETY: c points to LinkerContext which is the `linker` field of BundleV2.
    let bundler: &mut BundleV2 =
        unsafe { &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(c)) };
    let mut static_route_visitor = StaticRouteVisitor {
        // SAFETY: launder via raw ptr so this long-lived
        // shared borrow doesn't conflict with `c.log_disjoint()` inside
        // the chunk loop below. `c` outlives `static_route_visitor`.
        c: unsafe { bun_ptr::detach_lifetime_ref::<LinkerContext>(c) },
        cache: bun_collections::ArrayHashMap::default(),
        visited: AutoBitSet::init_empty(c.graph.files.len()).expect("oom"),
    };

    // For standalone mode, resolve JS/CSS chunks so we can inline their content into HTML.
    // Closing tag escaping (</script → <\\/script, </style → <\\/style) is handled during
    // the HTML assembly step in codeWithSourceMapShifts, not here.
    //
    // Buffers are freed via `Drop` (global mimalloc); if
    // `Chunk::allocator_for_size` ever becomes size-dependent, matched-arena
    // dealloc must be restored here.
    let mut standalone_chunk_contents: Option<Vec<Option<Box<[u8]>>>> = None;
    // Finalized sourcemap JSON for standalone-mode chunks whose sourcemap
    // option writes a separate .map file (linked/external). Indexed by chunk;
    // consumed by the output-file loops below.
    let mut standalone_sourcemaps: Vec<Option<Box<[u8]>>> = Vec::new();

    if is_standalone {
        let mut scc: Vec<Option<Box<[u8]>>> = vec![None; chunks.len()];
        standalone_sourcemaps = vec![None; chunks.len()];

        // `IntermediateOutput.code_standalone` reads `&Chunk` /
        // `&[Chunk]` (chunk is `&chunks[ci]`). Take `intermediate_output` out
        // by value so the only `&mut` is disjoint from those shared borrows.
        for ci in 0..chunks.len() {
            if matches!(chunks[ci].content, crate::chunk::Content::Html) {
                continue;
            }
            let sourcemap_option = chunks[ci].content.sourcemap(c.options.source_maps);
            let mut ds: usize = 0;
            // Pass `scc` so that `.asset` pieces (e.g. `import logo from "./logo.svg"` with
            // the file loader) are resolved to data: URIs from `url_for_css` instead of
            // being written as paths to sidecar files that don't exist in standalone mode.
            // Sibling JS/CSS chunks may still be null at this point; `.chunk` pieces fall
            // back to file paths when their entry in `scc` is null, matching the previous
            // behavior for inter-chunk imports.
            let mut intermediate_output = core::mem::take(&mut chunks[ci].intermediate_output);
            let code_result = intermediate_output.code_standalone(
                None,
                c.parse_graph(),
                &c.graph,
                c.options.public_path,
                &chunks[ci],
                chunks,
                &mut ds,
                ReferencePathStyle::ImporterRelative,
                SourceMapShiftTracking::for_source_map(sourcemap_option),
                &scc,
            )?;
            chunks[ci].intermediate_output = intermediate_output;
            let mut buffer = code_result.buffer;

            match sourcemap_option {
                tag @ (SourceMapOption::External | SourceMapOption::Linked) => {
                    let output_source_map = chunks[ci]
                        .output_source_map
                        .finalize(&code_result.shifts)
                        .expect("Failed to allocate memory for external source map");

                    if tag == SourceMapOption::Linked {
                        let mut source_map_final_rel_path: Vec<u8> =
                            Vec::with_capacity(chunks[ci].final_rel_path.len() + b".map".len());
                        source_map_final_rel_path.extend_from_slice(&chunks[ci].final_rel_path);
                        source_map_final_rel_path.extend_from_slice(b".map");

                        // The chunk content is inlined into the HTML document,
                        // so the sourceMappingURL resolves relative to the HTML
                        // file rather than a JS file next to the .map. Point at
                        // the .map path relative to the HTML chunk's directory.
                        let mut relative_platform_buf = path::path_buffer_pool::get();
                        let [a, b]: [&[u8]; 2] = if !c.options.public_path.is_empty() {
                            cheap_prefix_normalizer(
                                c.options.public_path,
                                &source_map_final_rel_path,
                            )
                        } else {
                            let entry_point_id = chunks[ci].entry_point.entry_point_id();
                            let mut html_dir: &[u8] = chunks
                                .iter()
                                .find(|ch| {
                                    matches!(ch.content, crate::chunk::Content::Html)
                                        && ch.entry_point.entry_point_id() == entry_point_id
                                })
                                .map(|ch| {
                                    path::resolve_path::dirname::<path::platform::Posix>(
                                        &ch.final_rel_path,
                                    )
                                })
                                .unwrap_or(b"");
                            if html_dir == b"." {
                                html_dir = b"";
                            }
                            cheap_prefix_normalizer(
                                b"",
                                if html_dir.is_empty() {
                                    &source_map_final_rel_path
                                } else {
                                    path::resolve_path::relative_platform_buf::<
                                        path::platform::Posix,
                                        false,
                                    >(
                                        &mut relative_platform_buf[..],
                                        html_dir,
                                        &source_map_final_rel_path,
                                    )
                                },
                            )
                        };

                        let source_map_start = b"//# sourceMappingURL=";
                        let total_len =
                            buffer.len() + source_map_start.len() + a.len() + b.len() + b"\n".len();
                        let mut buf: Vec<u8> = Vec::with_capacity(total_len);
                        buf.extend_from_slice(&buffer);
                        buf.extend_from_slice(source_map_start);
                        buf.extend_from_slice(a);
                        buf.extend_from_slice(b);
                        buf.push(b'\n');
                        buffer = buf.into_boxed_slice();
                    }

                    standalone_sourcemaps[ci] = Some(output_source_map);
                }
                SourceMapOption::Inline => {
                    let output_source_map = chunks[ci]
                        .output_source_map
                        .finalize(&code_result.shifts)
                        .expect("Failed to allocate memory for inline source map");
                    let encode_len = bun_base64::encode_len(&output_source_map);

                    let source_map_start = b"//# sourceMappingURL=data:application/json;base64,";
                    let total_len = buffer.len() + source_map_start.len() + encode_len + 1;
                    let mut buf: Vec<u8> = Vec::with_capacity(total_len);

                    buf.extend_from_slice(&buffer);
                    buf.extend_from_slice(source_map_start);
                    bun_base64::encode_append(&mut buf, &output_source_map);
                    buf.push(b'\n');
                    buffer = buf.into_boxed_slice();
                }
                SourceMapOption::None => {}
            }

            scc[ci] = Some(buffer);
        }

        standalone_chunk_contents = Some(scc);
    }

    // Don't write to disk if compile mode is enabled - we need buffer values for compilation
    let is_compile = bundler.transpiler.options.compile_mode.is_executable();
    if root_path.len() > 0 && !is_compile {
        write_output_files_to_disk(
            c,
            root_path,
            chunks,
            &mut output_files,
            standalone_chunk_contents.as_deref(),
            &mut standalone_sourcemaps,
        )?;
    } else {
        // In-memory build (also used for standalone mode)
        // `code()` / `code_standalone()` read `chunk` (= `&chunks[i]`)
        // and the full `&[Chunk]` slice simultaneously. Iterate by index so both
        // can be safe shared reborrows of `chunks`; the only per-chunk mutation
        // is the `intermediate_output` take/restore, done via `chunks[i]`.
        for chunk_index_in_chunks_list in 0..chunks.len() {
            // In standalone mode, non-HTML chunks were already resolved in the first pass.
            // Insert a placeholder output file to keep chunk indices aligned.
            if is_standalone
                && !matches!(
                    chunks[chunk_index_in_chunks_list].content,
                    crate::chunk::Content::Html
                )
            {
                // Emit the chunk's .map file (linked/external) even though the
                // chunk itself is inlined into the HTML document.
                let source_map_index: Option<u32> = if let Some(output_source_map) =
                    standalone_sourcemaps[chunk_index_in_chunks_list].take()
                {
                    let chunk = &chunks[chunk_index_in_chunks_list];
                    let mut source_map_final_rel_path: Vec<u8> =
                        Vec::with_capacity(chunk.final_rel_path.len() + b".map".len());
                    source_map_final_rel_path.extend_from_slice(&chunk.final_rel_path);
                    source_map_final_rel_path.extend_from_slice(b".map");
                    let input_path: &[u8] = if chunk.entry_point.is_entry_point() {
                        c.parse_graph().input_files.items_source()
                            [chunk.entry_point.source_index() as usize]
                            .path
                            .text
                    } else {
                        chunk.final_rel_path.as_ref()
                    };

                    let source_map_hash = ContentHasher::run(&output_source_map);
                    Some(output_files.insert_for_sourcemap_or_bytecode(
                        options::OutputFile::init(options::OutputFileInit {
                            data: options::OutputFileData::Buffer {
                                data: output_source_map,
                            },
                            hash: Some(source_map_hash),
                            loader: Loader::Json,
                            input_loader: Loader::File,
                            output_path: source_map_final_rel_path.into_boxed_slice(),
                            output_kind: options::OutputKind::Sourcemap,
                            input_path: strings::concat(&[input_path, b".map"]),
                            side: None,
                            entry_point_index: None,
                            is_executable: false,
                            ..Default::default()
                        }),
                    )?)
                } else {
                    None
                };

                let _ = output_files.insert_for_chunk(options::OutputFile::init(
                    options::OutputFileInit {
                        data: options::OutputFileData::Buffer {
                            data: Box::default(),
                        },
                        hash: None,
                        loader: chunks[chunk_index_in_chunks_list].content.loader(),
                        input_path: Box::default(),
                        display_size: 0,
                        output_kind: options::OutputKind::Chunk,
                        input_loader: Loader::Js,
                        output_path: Box::default(),
                        is_executable: false,
                        source_map_index,
                        bytecode_index: None,
                        module_info_index: None,
                        side: Some(options::Side::Client),
                        entry_point_index: None,
                        referenced_css_chunks: Box::default(),
                        bake_extra: BakeExtra::default(),
                        ..Default::default()
                    },
                ));
                continue;
            }

            let mut display_size: usize = 0;

            let public_path: &[u8] = if chunks[chunk_index_in_chunks_list]
                .flags
                .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
            {
                &bundler
                    .transpiler_for_target(options::Target::Browser)
                    .options
                    .public_path
            } else {
                c.options.public_path
            };

            // Take `intermediate_output` by value so the `&mut self` it provides
            // to `code()` is disjoint from the `&chunks[i]` / `&[Chunk]` reads.
            let mut intermediate_output =
                core::mem::take(&mut chunks[chunk_index_in_chunks_list].intermediate_output);
            let _code_result = if is_standalone
                && matches!(
                    chunks[chunk_index_in_chunks_list].content,
                    crate::chunk::Content::Html
                ) {
                intermediate_output.code_standalone(
                    None,
                    c.parse_graph(),
                    &c.graph,
                    public_path,
                    &chunks[chunk_index_in_chunks_list],
                    chunks,
                    &mut display_size,
                    ReferencePathStyle::ImporterRelative,
                    SourceMapShiftTracking::Disabled,
                    standalone_chunk_contents.as_deref().unwrap(),
                )?
            } else {
                let chunk = &chunks[chunk_index_in_chunks_list];
                intermediate_output.code(
                    None,
                    c.parse_graph(),
                    &c.graph,
                    public_path,
                    chunk,
                    chunks,
                    &mut display_size,
                    ReferencePathStyle::for_chunk(chunk, c.resolver().opts.compile),
                    SourceMapShiftTracking::for_source_map(
                        chunk.content.sourcemap(c.options.source_maps),
                    ),
                )?
            };
            // Tail of the loop body needs `&mut chunk` (`output_source_map.finalize()`);
            // no `&[Chunk]` is needed past this point so an exclusive reborrow is fine.
            let chunk: &mut Chunk = &mut chunks[chunk_index_in_chunks_list];
            chunk.intermediate_output = intermediate_output;
            let mut code_result = _code_result;

            let mut sourcemap_output_file: Option<options::OutputFile> = None;
            let input_path: Box<[u8]> = Box::from(if chunk.entry_point.is_entry_point() {
                c.parse_graph().input_files.items_source()
                    [chunk.entry_point.source_index() as usize]
                    .path
                    .text
            } else {
                chunk.final_rel_path.as_ref()
            });

            match chunk.content.sourcemap(c.options.source_maps) {
                tag @ (SourceMapOption::External | SourceMapOption::Linked) => {
                    let output_source_map = chunk
                        .output_source_map
                        .finalize(&code_result.shifts)
                        .expect("Failed to allocate memory for external source map");
                    let mut source_map_final_rel_path: Vec<u8> =
                        Vec::with_capacity(chunk.final_rel_path.len() + b".map".len());
                    source_map_final_rel_path.extend_from_slice(&chunk.final_rel_path);
                    source_map_final_rel_path.extend_from_slice(b".map");

                    if tag == SourceMapOption::Linked {
                        let [a, b]: [&[u8]; 2] = if public_path.len() > 0 {
                            cheap_prefix_normalizer(public_path, &source_map_final_rel_path)
                        } else {
                            [b"", path::basename(&source_map_final_rel_path)]
                        };

                        let source_map_start = b"//# sourceMappingURL=";
                        let total_len = code_result.buffer.len()
                            + source_map_start.len()
                            + a.len()
                            + b.len()
                            + b"\n".len();
                        let mut buf: Vec<u8> = Vec::with_capacity(total_len);
                        buf.extend_from_slice(&code_result.buffer);
                        buf.extend_from_slice(source_map_start);
                        buf.extend_from_slice(a);
                        buf.extend_from_slice(b);
                        buf.push(b'\n');

                        code_result.buffer = buf.into_boxed_slice();
                    }

                    let source_map_hash = ContentHasher::run(&output_source_map);
                    sourcemap_output_file =
                        Some(options::OutputFile::init(options::OutputFileInit {
                            data: options::OutputFileData::Buffer {
                                data: output_source_map,
                            },
                            hash: Some(source_map_hash),
                            loader: Loader::Json,
                            input_loader: Loader::File,
                            output_path: source_map_final_rel_path.into_boxed_slice(),
                            output_kind: options::OutputKind::Sourcemap,
                            input_path: strings::concat(&[&input_path[..], b".map"]),
                            side: None,
                            entry_point_index: None,
                            is_executable: false,
                            ..Default::default()
                        }));
                }
                SourceMapOption::Inline => {
                    let output_source_map = chunk
                        .output_source_map
                        .finalize(&code_result.shifts)
                        .expect("Failed to allocate memory for external source map");
                    let encode_len = bun_base64::encode_len(&output_source_map);

                    let source_map_start = b"//# sourceMappingURL=data:application/json;base64,";
                    let total_len =
                        code_result.buffer.len() + source_map_start.len() + encode_len + 1;
                    let mut buf: Vec<u8> = Vec::with_capacity(total_len);

                    buf.extend_from_slice(&code_result.buffer);
                    buf.extend_from_slice(source_map_start);
                    bun_base64::encode_append(&mut buf, &output_source_map);
                    buf.push(b'\n');
                    code_result.buffer = buf.into_boxed_slice();
                    drop(output_source_map);
                }
                SourceMapOption::None => {}
            }

            // Compute side early so it can be used for bytecode, module_info, and main chunk output files
            let side: options::Side = c.chunk_side(chunk);

            let bytecode_output_file: Option<options::OutputFile> = 'brk: {
                if c.options.generate_bytecode_cache {
                    let loader: Loader = if chunk.entry_point.is_entry_point() {
                        c.parse_graph().input_files.items_loader()
                            [chunk.entry_point.source_index() as usize]
                    } else {
                        Loader::Js
                    };

                    if matches!(chunk.content, crate::chunk::Content::Javascript(_))
                        && loader.is_javascript_like()
                    {
                        let mut fdpath = bun_paths::PathBuffer::uninit();
                        // For --compile builds, the bytecode URL must match the module name
                        // that will be used at runtime. The module name is:
                        //   public_path + final_rel_path (e.g., "/$bunfs/root/app.js")
                        // Without this prefix, the JSC bytecode cache key won't match at runtime.
                        // Use the per-chunk public_path (already computed above) for browser chunks
                        // from server builds, and normalize with cheapPrefixNormalizer for consistency
                        // with module_info path fixup.
                        // For non-compile builds, use the normal .jsc extension.
                        let source_provider_url = if c.options.compile_mode.is_executable() {
                            let normalizer =
                                cheap_prefix_normalizer(public_path, &chunk.final_rel_path);
                            BunString::create_format(format_args!(
                                "{}{}",
                                bstr::BStr::new(normalizer[0]),
                                bstr::BStr::new(normalizer[1])
                            ))
                        } else {
                            BunString::create_format(format_args!(
                                "{}{}",
                                bstr::BStr::new(&chunk.final_rel_path),
                                BYTECODE_EXTENSION
                            ))
                        };

                        if let Some(bytecode) = crate::bundle_v2::dispatch::generate_cached_bytecode(
                            c.options.output_format,
                            &code_result.buffer,
                            &source_provider_url,
                            c.options.bytecode_depth,
                            external_string_table.as_ref().and_then(|table| table.get()),
                        ) {
                            let source_provider_url_str = source_provider_url.to_utf8();
                            debug!(
                                "Bytecode cache generated {}: {}",
                                bstr::BStr::new(source_provider_url_str.slice()),
                                bun_core::fmt::size(
                                    bytecode.len(),
                                    bun_core::fmt::SizeFormatterOptions {
                                        space_between_number_and_unit: true
                                    }
                                )
                            );
                            fdpath[..chunk.final_rel_path.len()]
                                .copy_from_slice(&chunk.final_rel_path);
                            fdpath[chunk.final_rel_path.len()..][..BYTECODE_EXTENSION.len()]
                                .copy_from_slice(BYTECODE_EXTENSION.as_bytes());

                            let mut input_path_buf: Vec<u8> = Vec::new();
                            input_path_buf.extend_from_slice(&chunk.final_rel_path);
                            input_path_buf.extend_from_slice(BYTECODE_EXTENSION.as_bytes());

                            break 'brk Some(options::OutputFile::init(options::OutputFileInit {
                                output_path: Box::from(source_provider_url_str.slice()),
                                input_path: input_path_buf.into_boxed_slice(),
                                input_loader: Loader::Js,
                                hash: chunk.template.placeholder.hash.map(|_| {
                                    chunk.template.content_hash(bun_wyhash::hash(&bytecode))
                                }),
                                output_kind: options::OutputKind::Bytecode,
                                loader: Loader::File,
                                size: Some(bytecode.len()),
                                display_size: bytecode.len() as u32,
                                data: options::OutputFileData::Buffer { data: bytecode },
                                side: Some(side),
                                entry_point_index: None,
                                is_executable: false,
                                ..Default::default()
                            }));
                        } else {
                            // an error
                            // logger OOM-only
                            // Split-borrow — `static_route_visitor.c` holds a
                            // detached `&LinkerContext`; `log_disjoint` returns the
                            // disjoint `Transpiler.log` backref so no `&mut c` is
                            // materialized.
                            let _ = c.log_disjoint().add_error_fmt(
                                None,
                                bun_ast::Loc::EMPTY,
                                format_args!(
                                    "Failed to generate bytecode for {}",
                                    bstr::BStr::new(&chunk.final_rel_path)
                                ),
                            );
                        }
                    }
                }

                break 'brk None;
            };

            // Create module_info output file for ESM bytecode in --compile builds
            let module_info_output_file: Option<options::OutputFile> = 'brk: {
                if c.options.generates_module_info() {
                    let loader: Loader = if chunk.entry_point.is_entry_point() {
                        c.parse_graph().input_files.items_loader()
                            [chunk.entry_point.source_index() as usize]
                    } else {
                        Loader::Js
                    };

                    if matches!(chunk.content, crate::chunk::Content::Javascript(_))
                        && loader.is_javascript_like()
                    {
                        if let crate::chunk::Content::Javascript(js) = &chunk.content {
                            if let Some(module_info_bytes) = &js.module_info_bytes {
                                let mut out_path: Vec<u8> = Vec::new();
                                out_path.extend_from_slice(&chunk.final_rel_path);
                                out_path.extend_from_slice(b".module-info");
                                let mut in_path: Vec<u8> = Vec::new();
                                in_path.extend_from_slice(&chunk.final_rel_path);
                                in_path.extend_from_slice(b".module-info");

                                break 'brk Some(options::OutputFile::init(
                                    options::OutputFileInit {
                                        output_path: out_path.into_boxed_slice(),
                                        input_path: in_path.into_boxed_slice(),
                                        input_loader: Loader::Js,
                                        hash: chunk.template.placeholder.hash.map(|_| {
                                            chunk
                                                .template
                                                .content_hash(bun_wyhash::hash(module_info_bytes))
                                        }),
                                        output_kind: options::OutputKind::ModuleInfo,
                                        loader: Loader::File,
                                        size: Some(module_info_bytes.len()),
                                        display_size: module_info_bytes.len() as u32,
                                        data: options::OutputFileData::Buffer {
                                            data: module_info_bytes.clone(),
                                        },
                                        side: Some(side),
                                        entry_point_index: None,
                                        is_executable: false,
                                        ..Default::default()
                                    },
                                ));
                            }
                        }
                    }
                }
                break 'brk None;
            };

            let source_map_index: Option<u32> = if let Some(f) = sourcemap_output_file {
                Some(output_files.insert_for_sourcemap_or_bytecode(f)?)
            } else {
                None
            };

            let bytecode_index: Option<u32> = if let Some(f) = bytecode_output_file {
                Some(output_files.insert_for_sourcemap_or_bytecode(f)?)
            } else {
                None
            };

            let module_info_index: Option<u32> = if let Some(f) = module_info_output_file {
                Some(output_files.insert_for_sourcemap_or_bytecode(f)?)
            } else {
                None
            };

            let output_kind = c.chunk_output_kind(chunk);

            let chunk_index =
                output_files.insert_for_chunk(options::OutputFile::init(options::OutputFileInit {
                    data: options::OutputFileData::Buffer {
                        data: code_result.buffer,
                    },
                    hash: chunk.template.placeholder.hash,
                    loader: chunk.content.loader(),
                    input_path,
                    display_size: display_size as u32,
                    output_kind,
                    input_loader: if chunk.entry_point.is_entry_point() {
                        c.parse_graph().input_files.items_loader()
                            [chunk.entry_point.source_index() as usize]
                    } else {
                        Loader::Js
                    },
                    output_path: Box::from(chunk.final_rel_path.as_ref()),
                    is_executable: chunk.flags.contains(crate::chunk::Flags::IS_EXECUTABLE),
                    source_map_index,
                    bytecode_index,
                    module_info_index,
                    side: Some(side),
                    entry_point_index: if output_kind == options::OutputKind::EntryPoint {
                        Some(
                            chunk.entry_point.source_index()
                                - (if let Some(fw) = c.framework {
                                    if fw.server_components.is_some() { 3 } else { 1 }
                                } else {
                                    1
                                }) as u32,
                        )
                    } else {
                        None
                    },
                    referenced_css_chunks: match &chunk.content {
                        // `output_file::Index` is `#[repr(transparent)]` over u32.
                        crate::chunk::Content::Javascript(js) => js
                            .css_chunks
                            .iter()
                            .map(|&i| crate::output_file::Index::init(i))
                            .collect(),
                        crate::chunk::Content::Css(_) => Box::default(),
                        crate::chunk::Content::Html => Box::default(),
                    },
                    bake_extra: 'brk: {
                        if c.framework.is_none() || IS_DEV_SERVER {
                            break 'brk BakeExtra::default();
                        }
                        if !c.framework.unwrap().is_built_in_react {
                            break 'brk BakeExtra::default();
                        }

                        let mut extra = BakeExtra {
                            bake_is_runtime: chunk
                                .files_with_parts_in_chunk
                                .contains(&Index::RUNTIME.get()),
                            ..Default::default()
                        };
                        if output_kind == options::OutputKind::EntryPoint
                            && side == options::Side::Server
                        {
                            extra.route = if static_route_visitor
                                .has_transitive_use_client(chunk.entry_point.source_index())
                            {
                                BakeRouteKind::Route
                            } else {
                                BakeRouteKind::FullyStaticRoute
                            };
                        }

                        break 'brk extra;
                    },
                    ..Default::default()
                }));

            // We want the chunk index to remain the same in `output_files` so the indices in `OutputFile.referenced_css_chunks` work
            debug_assert!(
                chunk_index as usize == chunk_index_in_chunks_list,
                "chunk_index ({}) != chunk_index_in_chunks_list ({})",
                chunk_index,
                chunk_index_in_chunks_list
            );
        }

        if !is_standalone {
            output_files
                .insert_additional_output_files(&mut c.parse_graph_mut().additional_output_files);
        }
    }

    // Only `StandaloneModuleGraph::to_bytes` reads these.
    if is_compile {
        let (order, startup_count) = chunk_load_order(
            chunks,
            &output_files.output_files,
            c.options.target.is_bun(),
        );
        for (chunk_index, &position) in order.iter().enumerate() {
            let file = &mut output_files.output_files[chunk_index];
            file.load_order = position;
            file.loads_at_startup = position < startup_count;
        }
    }

    if is_standalone {
        // For standalone mode, filter to HTML output files plus the .map files
        // of the inlined chunks (linked/external sourcemaps).
        // Deinit dropped items to free their heap allocations (paths, buffers).
        let mut result = output_files.take();
        let mut write_idx: usize = 0;
        let len = result.len();
        for i in 0..len {
            if result[i].loader == Loader::Html
                || result[i].output_kind == options::OutputKind::Sourcemap
            {
                result.swap(write_idx, i);
                write_idx += 1;
            }
            // else: item at `i` will be dropped by truncate below (impl Drop handles deinit)
        }
        result.truncate(write_idx);
        return Ok(result);
    }

    let mut result = output_files.take();
    if c.options.generate_internal_module_bytecode && c.options.compile_mode.is_executable() {
        append_internal_module_bytecode(
            c,
            &mut result,
            external_string_table.as_ref().and_then(|t| t.get()),
        );
    }
    if c.options.generates_module_info() {
        let bytes = module_info_strings.serialize();
        debug!(
            "module_info string table: {} strings, {} bytes",
            module_info_strings.count(),
            bytes.len()
        );
        result.push(options::OutputFile::init(options::OutputFileInit {
            output_path: b".module-info-strings".to_vec().into_boxed_slice(),
            input_path: Box::default(),
            input_loader: Loader::File,
            hash: None,
            output_kind: options::OutputKind::ModuleInfoStringTable,
            loader: Loader::File,
            size: Some(bytes.len()),
            display_size: bytes.len() as u32,
            data: options::OutputFileData::Buffer {
                data: bytes.into_boxed_slice(),
            },
            side: None,
            entry_point_index: None,
            is_executable: false,
            ..Default::default()
        }));
    }
    if let Some(table) = external_string_table {
        let bytes = table.take();
        debug!("Bytecode external string table: {} bytes", bytes.len());
        result.push(options::OutputFile::init(options::OutputFileInit {
            output_path: b".bytecode-strings".to_vec().into_boxed_slice(),
            input_path: Box::default(),
            input_loader: Loader::File,
            hash: None,
            output_kind: options::OutputKind::BytecodeStringTable,
            loader: Loader::File,
            size: Some(bytes.len()),
            display_size: bytes.len() as u32,
            data: options::OutputFileData::Buffer { data: bytes },
            side: None,
            entry_point_index: None,
            is_executable: false,
            ..Default::default()
        }));
    }
    Ok(result)
}

/// `--compile --bytecode`: the executable also carries ahead-of-time bytecode for the internal modules (node:fs, …) the
/// bundle imports and everything those can require (while loading or lazily later), so their first `require` decodes
/// instead of parsing. One
/// `OutputKind::BuiltinBytecode` per module; StandaloneModuleGraph::to_bytes lays them out and InternalModuleRegistry
/// picks them up by id. The modules, their ids and (when compiling for another platform) their sources come from the
/// builtins section of the executable the bundle is going into.
fn append_internal_module_bytecode(
    c: &LinkerContext,
    output_files: &mut Vec<options::OutputFile>,
    external_strings: Option<core::ptr::NonNull<crate::bundle_v2::dispatch::EncoderStringTable>>,
) {
    use crate::bundle_v2::dispatch;
    let target_section = c.options.target_builtins.as_deref();
    let builtins = match bun_exe_format::builtins::Builtins::parse(
        target_section.unwrap_or_else(|| dispatch::host_builtins()),
    ) {
        Ok(b) => b,
        Err(e) => {
            debug!(
                "Internal module bytecode: builtins section unreadable ({})",
                <&'static str>::from(&e)
            );
            return;
        }
    };

    let import_records = c.graph.ast.items_import_records();
    let mut wanted: Vec<u32> = Vec::new();
    for source_index in &c.graph.reachable_files {
        let Some(records) = import_records.get(source_index.get() as usize) else {
            continue;
        };
        for record in records.as_slice() {
            if record.source_index.is_valid() || record.path.text.is_empty() {
                continue;
            }
            let text: &[u8] = record.path.text;
            let alias = bun_resolve_builtins::HardcodedModule::Alias::get(
                text,
                crate::options::Target::Bun,
                Default::default(),
            );
            let canonical: &[u8] = match &alias {
                // The one aliased npm specifier whose registry name is not the specifier (bundle-modules.ts).
                Some(alias) if alias.path.as_bytes() == b"@vercel/fetch" => b"vercel_fetch",
                Some(alias) => alias.path.as_bytes(),
                None if record.tag == bun_ast::ImportRecordTag::Builtin
                    || strings::has_prefix(text, b"node:")
                    || strings::has_prefix(text, b"bun:") =>
                {
                    text
                }
                None => continue,
            };
            if let Some(id) = builtins.find(canonical) {
                if !wanted.contains(&id) {
                    wanted.push(id);
                }
            }
        }
    }
    let mut i = 0;
    while i < wanted.len() {
        for dep in builtins.dependencies(wanted[i]) {
            if !wanted.contains(&dep) {
                wanted.push(dep);
            }
        }
        i += 1;
    }

    for id in wanted {
        let bytecode = match target_section {
            Some(_) => builtins.module(id).and_then(|m| {
                dispatch::generate_internal_module_bytecode_from_source(
                    &m,
                    builtins.source_stamp,
                    c.options.bytecode_depth,
                    external_strings,
                )
            }),
            None => dispatch::generate_internal_module_bytecode(
                id,
                c.options.bytecode_depth,
                external_strings,
            ),
        };
        let Some(bytecode) = bytecode else {
            continue;
        };
        debug!("Internal module bytecode {}: {} bytes", id, bytecode.len());
        output_files.push(options::OutputFile::init(options::OutputFileInit {
            output_path: id.to_string().into_bytes().into_boxed_slice(),
            input_path: Box::default(),
            input_loader: Loader::Js,
            hash: None,
            output_kind: options::OutputKind::BuiltinBytecode,
            loader: Loader::File,
            size: Some(bytecode.len()),
            display_size: bytecode.len() as u32,
            data: options::OutputFileData::Buffer { data: bytecode },
            side: None,
            entry_point_index: None,
            is_executable: false,
            ..Default::default()
        }));
    }
}

/// Position of each chunk in the order a `--compile` executable is expected to
/// load it: the entry point's static cross-chunk imports in evaluation order,
/// then the closures of its dynamic imports (`import()` and split `require()`
/// chunks), breadth-first. The standalone
/// module graph lays modules out by this so booting faults in one run of pages
/// rather than one page per chunk scattered across the payload. Also returns
/// how many of the positions make up the static closure of the entry point
/// the executable runs: the first server-side one, as `to_bytes` picks it.
/// `output_files[i]` is chunk `i`'s output file.
fn chunk_load_order(
    chunks: &[Chunk],
    output_files: &[options::OutputFile],
    target_is_bun: bool,
) -> (Vec<u32>, u32) {
    let mut visited = AutoBitSet::init_empty(chunks.len()).expect("oom");
    let mut order: Vec<u32> = Vec::with_capacity(chunks.len());
    let entry_points = |side_is_client: bool| {
        output_files[..chunks.len()]
            .iter()
            .enumerate()
            .filter(move |(_, file)| {
                file.output_kind == options::OutputKind::EntryPoint
                    && (file.side == Some(options::Side::Client)) == side_is_client
            })
            .map(|(i, _)| i as u32)
    };
    let mut dynamic_frontier: std::collections::VecDeque<u32> =
        entry_points(false).chain(entry_points(true)).collect();

    let mut stack: Vec<(u32, usize)> = Vec::new();
    let mut startup_count: Option<u32> = None;
    while let Some(root) = dynamic_frontier.pop_front() {
        if visited.is_set(root as usize) {
            continue;
        }
        visited.set(root as usize);
        stack.push((root, 0));
        // Post-order over static imports: a module's dependencies evaluate before it.
        while let Some(&(chunk_index, next_import)) = stack.last() {
            match chunks[chunk_index as usize]
                .cross_chunk_imports
                .get(next_import)
            {
                Some(import) => {
                    stack.last_mut().unwrap().1 += 1;
                    let dep = import.chunk_index;
                    // An HTML import puts browser-side chunks in a server build;
                    // those never load anything through `import.meta.require`.
                    let importer_is_bun = target_is_bun
                        && output_files[chunk_index as usize].side != Some(options::Side::Client);
                    if import.import_kind.can_be_lazy_chunk(importer_is_bun) {
                        dynamic_frontier.push_back(dep);
                    } else if !visited.is_set(dep as usize) {
                        visited.set(dep as usize);
                        stack.push((dep, 0));
                    }
                }
                None => {
                    stack.pop();
                    order.push(chunk_index);
                }
            }
        }
        // The first root is the entry point; everything placed so far is its static closure.
        startup_count.get_or_insert(order.len() as u32);
    }
    for chunk_index in 0..chunks.len() as u32 {
        if !visited.is_set(chunk_index as usize) {
            order.push(chunk_index);
        }
    }

    let mut position = vec![0u32; chunks.len()];
    for (i, &chunk_index) in order.iter().enumerate() {
        position[chunk_index as usize] = i as u32;
    }
    (position, startup_count.unwrap_or(0))
}

use crate::EntryPoint;
use crate::options::SourceMapOption;
use crate::output_file::{BakeExtra, BakeRouteKind};
