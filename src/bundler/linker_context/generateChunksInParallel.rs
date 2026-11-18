use crate::mal_prelude::*;
use std::borrow::Cow;
use std::io::Write as _;

use bun_collections::AutoBitSet;
use bun_collections::StringArrayHashMap;
use bun_collections::StringHashMap;
use bun_core::String as BunString;
use bun_core::strings;
use bun_paths as path;

use crate::Chunk;
use crate::Index;
use crate::cheap_prefix_normalizer;
use crate::chunk::{ReferencePathStyle, SourceMapShiftTracking};
use crate::options;
use crate::options::Loader;

use crate::CompileResult;
use crate::LinkerContext;
use crate::linker_context::generate_compile_result_for_css_chunk::{
    generate_compile_result_for_css_chunk, nest_external_imports,
};
use crate::linker_context::generate_compile_result_for_html_chunk::generate_compile_result_for_html_chunk;
use crate::linker_context::generate_compile_result_for_js_chunk::generate_compile_result_for_js_chunk;
use crate::linker_context::output_file_list_builder::OutputFileList as OutputFileListBuilder;
use crate::linker_context::static_route_visitor::StaticRouteVisitor;
use crate::linker_context::write_output_files_to_disk::write_output_files_to_disk;
use crate::linker_context_mod::GenerateChunkCtx;

use crate::bytecode::Source;
use crate::bytecode_sidecar::EXTENSION as BYTECODE_EXTENSION;

// `Chunk.final_rel_path` is an owned `Box<[u8]>`; assignments
// below move the boxed buffer directly — no lifetime promotion needed.
use crate::linker_context_mod::debug;

// Const generics cannot vary the return type, so we always return
// `Vec<OutputFile>` and the IS_DEV_SERVER path returns an empty Vec.
pub(crate) fn generate_chunks_in_parallel<'a, const IS_DEV_SERVER: bool>(
    c: &mut LinkerContext<'_, 'a>,
    log: &mut bun_ast::Log,
    chunks: &mut [Chunk<'a>],
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
        if !c.options.minify_identifiers {
            c.renamer_rows =
                crate::linker_context::rename_symbols_in_chunk::renamer_rows(c, chunks);
        }
        c.worker_pool()
            .each_ptr(&*c, |c, chunk, _| c.generate_js_renamer(chunk), chunks);
        if !c.options.minify_identifiers {
            // Top-level names are final; name each file's nested scopes in
            // parallel.
            let mut tasks =
                crate::linker_context::rename_symbols_in_chunk::nested_rename_tasks(chunks);
            c.worker_pool().each_ptr(
                (&*c, &*chunks),
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
            crate::linker_context::rename_symbols_in_chunk::log_renamer_tables(chunks);
        }
        if c.graph.code_splitting {
            if c.options.minify_identifiers {
                // Counts are in; name the cross-chunk bindings, pin them, then
                // let every chunk name the rest.
                crate::linker_context::cross_chunk_names::assign_minified(c, chunks)?;
                c.worker_pool().each_ptr(
                    (),
                    |(), chunk, _| LinkerContext::finish_js_renamer(chunk),
                    chunks,
                );
            }
            crate::linker_context::cross_chunk_names::apply_to_clauses(c, chunks);
        }
        debug!("  DONE {} renamers", chunks.len());
    }

    if !c.source_maps.line_offsets.is_empty() {
        debug!(" START {} source maps (line offset)", chunks.len());
        let column = c.graph.files.items_line_offset_table_mut();
        c.source_maps.line_offsets.finish(column);
        debug!("  DONE {} source maps (line offset)", chunks.len());
    }

    for chunk in chunks.iter_mut() {
        if let crate::chunk::Content::Css(css) = &mut chunk.content {
            nest_external_imports(c, log, &mut css.imports_in_chunk_in_order);
        }
    }

    {
        {
            let mut total_count: usize = 0;
            let mut compile_results: Vec<Box<[CompileResult]>> = Vec::with_capacity(chunks.len());
            for chunk in chunks.iter() {
                let count = match &chunk.content {
                    crate::chunk::Content::Javascript(js) => {
                        has_js_chunk = true;
                        js.parts_in_chunk_in_order.len()
                    }
                    crate::chunk::Content::Css(css) => {
                        has_css_chunk = true;
                        css.imports_in_chunk_in_order.len()
                    }
                    crate::chunk::Content::Html => {
                        has_html_chunk = true;
                        // HTML gets only one chunk.
                        1
                    }
                };
                total_count += count;
                compile_results.push((0..count).map(|_| CompileResult::default()).collect());
            }

            debug!(" START {} compiling part ranges", total_count);
            c.worker_pool().each_iter(
                (&*c, &*chunks),
                |&(c, chunks), (chunk, i, result)| {
                    **result = generate_compile_result(c, chunks, chunk, *i);
                },
                total_count,
                chunks
                    .iter()
                    .zip(&mut compile_results)
                    .flat_map(|(chunk, results)| {
                        let results = results.iter_mut().enumerate();
                        results.map(move |(i, result)| (chunk, i, result))
                    }),
            );
            for (chunk, results) in chunks.iter_mut().zip(compile_results) {
                chunk.compile_results_for_chunk = results;
            }
            debug!("  DONE {} compiling part ranges", total_count);
        }

        if !c.source_maps.quoted_contents.is_empty() {
            debug!(" START {} source maps (quoted contents)", chunks.len());
            let column = c.graph.files.items_quoted_source_contents_mut();
            c.source_maps.quoted_contents.finish(column);
            debug!("  DONE {} source maps (quoted contents)", chunks.len());
        }

        // A part that failed to print (e.g. the recursion guard tripped on a
        // deeply nested AST) must fail the build instead of joining the chunk
        // as silently truncated output. Dev server excluded: its callers turn
        // any `Err` here into an OOM panic (see `finish_from_bake_dev_server`),
        // so its `finalize_bundle` records each failed part as a per-file failure.
        if !IS_DEV_SERVER {
            let mut had_print_error = false;
            // Without code splitting a failing file is printed once per chunk
            // that includes it; report each file once.
            let mut reported_sources = AutoBitSet::init_empty(c.parse_graph().input_files.len())?;
            for chunk in chunks.iter() {
                for compile_result in chunk.compile_results_for_chunk.iter() {
                    let message: Cow<'static, [u8]> = match compile_result {
                        CompileResult::Javascript {
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
                        CompileResult::Css {
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
                    log.add_error(source, bun_ast::Loc::EMPTY, message);
                }
            }
            if had_print_error {
                return Err(crate::Error::PrintError);
            }
        }

        let ctx = GenerateChunkCtx {
            c,
            chunks: bun_ptr::BackRef::new(&*chunks),
        };
        // For dev server, only post-process CSS + HTML chunks.
        let chunks_to_do: &mut [Chunk] = if IS_DEV_SERVER {
            &mut chunks[1..]
        } else {
            chunks
        };
        if !IS_DEV_SERVER || chunks_to_do.len() > 0 {
            debug_assert!(chunks_to_do.len() > 0);
            debug!(" START {} postprocess chunks", chunks_to_do.len());

            c.worker_pool()
                .each_ptr(ctx, LinkerContext::generate_chunk, chunks_to_do);

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
        struct DuplicateEntry<'a> {
            // `BackRef` (not `*mut`) — entries point at elements of the
            // stack-owned `chunks: &mut [Chunk]` above, which outlives the
            // `duplicates_map`; reads go through safe `Deref`.
            sources: Vec<bun_ptr::BackRef<Chunk<'a>>>,
        }
        let mut duplicates_map: StringArrayHashMap<DuplicateEntry> = StringArrayHashMap::default();
        let mut has_unusable_output_path = false;
        // Without an output directory the paths are only returned, so they can have any length.
        let opens_output_paths =
            !c.resolver.opts.output_dir.is_empty() || c.options.compile_mode.is_executable();

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

            let input: &[u8] = c.parse_graph().input_files.items_source()
                [chunk.entry_point.source_index() as usize]
                .path
                .pretty;
            if opens_output_paths && !chunk.template.check_output_path(log, input, &rel_path) {
                has_unusable_output_path = true;
                continue;
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

            log.add_error(None, bun_ast::Loc::EMPTY, msg);

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
                log.add_msg(bun_ast::Msg {
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

        if has_unusable_output_path {
            return Err(crate::Error::BuildFailed);
        }
    }

    let mut bytecode_generator =
        (c.options.generate_bytecode_cache).then(crate::bytecode::Generator::default);
    // An executable's chunks share their strings, so they are encoded in load order, which is only known after the chunk
    // loop: (chunk index, its `Bytecode` output file).
    let mut embedded_bytecode_chunks: Vec<(usize, u32)> = Vec::new();

    let mut output_files = OutputFileListBuilder::init(c, chunks)?;

    let root_path: &[u8] = &c.resolver.opts.output_dir;
    let is_standalone = c.options.compile_mode.is_standalone_html();
    let more_than_one_output = !is_standalone
        && (c.graph.additional_output_files.len() > 0
            || c.options.generate_bytecode_cache
            || (has_css_chunk && has_js_chunk)
            || (has_html_chunk && (has_js_chunk || has_css_chunk)));

    if !c.resolver.opts.compile
        && more_than_one_output
        && !c.resolver.opts.supports_multiple_outputs
    {
        log.add_error(
            None,
            bun_ast::Loc::EMPTY,
            b"cannot write multiple output files without an output directory",
        );
        return Err(crate::Error::MultipleOutputFilesWithoutOutputDir);
    }

    let mut static_route_visitor = StaticRouteVisitor {
        parse_graph: c.parse_graph(),
        cache: bun_collections::ArrayHashMap::default(),
        visited: AutoBitSet::init_empty(c.graph.files.len()).expect("oom"),
        stack: Vec::new(),
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
                c.bundle,
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
                                    path::resolve_path::relative_platform::<
                                        path::platform::Posix,
                                        false,
                                    >(
                                        html_dir, &source_map_final_rel_path
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

            chunks[ci].final_output_size = buffer.len();
            scc[ci] = Some(buffer);
        }

        standalone_chunk_contents = Some(scc);
    }

    // Don't write to disk if compile mode is enabled - we need buffer values for compilation
    let is_compile = c.options.compile_mode.is_executable();
    if root_path.len() > 0 && !is_compile {
        write_output_files_to_disk(
            c,
            log,
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

                    Some(output_files.insert_for_sourcemap_or_bytecode(
                        options::OutputFile::init(options::OutputFileInit {
                            data: options::OutputFileData::Buffer {
                                data: output_source_map,
                            },
                            hash: None,
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

            let public_path: &[u8] = &c
                .options_for_chunk(&chunks[chunk_index_in_chunks_list])
                .public_path;

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
                    c.bundle,
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
                    c.bundle,
                    &c.graph,
                    public_path,
                    chunk,
                    chunks,
                    &mut display_size,
                    ReferencePathStyle::for_chunk(chunk, c.resolver.opts.compile),
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

                    sourcemap_output_file =
                        Some(options::OutputFile::init(options::OutputFileInit {
                            data: options::OutputFileData::Buffer {
                                data: output_source_map,
                            },
                            hash: None,
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

            let side: options::Side = c.chunk_side(chunk);

            let bytecode_output_file: Option<options::OutputFile> = 'brk: {
                if let Some(generator) = &mut bytecode_generator {
                    if c.chunk_gets_bytecode(chunk) {
                        // In an executable, the path that other chunks import it by (e.g. "/$bunfs/root/app.js").
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

                        let bytecode = if is_compile {
                            Some(Box::default())
                        } else {
                            Source::chunk(c.options.output_format, &code_result.buffer)
                                .and_then(|source| {
                                    generator.generate(source, c.options.bytecode_depth, None)
                                })
                                .map(crate::bytecode_sidecar::frame)
                        };
                        if let Some(bytecode) = bytecode {
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
                            let _ = log.add_error_fmt(
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

            let source_map_index: Option<u32> = if let Some(f) = sourcemap_output_file {
                Some(output_files.insert_for_sourcemap_or_bytecode(f)?)
            } else {
                None
            };

            let bytecode_index: Option<u32> = if let Some(f) = bytecode_output_file {
                let index = output_files.insert_for_sourcemap_or_bytecode(f)?;
                if is_compile {
                    embedded_bytecode_chunks.push((chunk_index_in_chunks_list, index));
                }
                Some(index)
            } else {
                None
            };

            let output_kind = c.chunk_output_kind(chunk);

            chunk.final_output_size = code_result.buffer.len();
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
                        let Some(framework) = c.framework else {
                            break 'brk BakeExtra::default();
                        };
                        if IS_DEV_SERVER {
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
                            // Without server components there are no "use client"
                            // boundaries, so the visitor would report every route as static.
                            extra.route = if framework.server_components.is_some()
                                && !static_route_visitor
                                    .has_transitive_use_client(chunk.entry_point.source_index())
                            {
                                BakeRouteKind::FullyStaticRoute
                            } else {
                                BakeRouteKind::Route
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
            output_files.insert_additional_output_files(&mut c.graph.additional_output_files);
        }
    }

    // Only `StandaloneModuleGraph::to_bytes` reads these.
    if is_compile {
        let (order, startup_count) = chunk_load_order(
            chunks,
            &output_files.output_files,
            c.options.target.is_bun(),
        );
        let loaders = c.parse_graph().input_files.items_loader();
        for (chunk_index, &position) in order.iter().enumerate() {
            let file = &mut output_files.output_files[chunk_index];
            file.load_order = position;
            file.loads_at_startup = position < startup_count;
            file.starts_from_typescript =
                loaders[chunks[chunk_index].entry_point.source_index() as usize].is_typescript();
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
        debug_assert_no_placeholder_left(c, &result);
        return Ok(result);
    }

    let mut result = output_files.take();
    if let Some(generator) = bytecode_generator.filter(|_| is_compile) {
        embed_bytecode(
            c,
            log,
            chunks,
            &mut result,
            generator,
            embedded_bytecode_chunks,
        )?;
    }
    debug_assert_no_placeholder_left(c, &result);
    Ok(result)
}

/// Debug check: no in-memory output may still contain the per-build `unique_key` placeholder prefix.
fn debug_assert_no_placeholder_left(c: &LinkerContext, files: &[options::OutputFile]) {
    if !cfg!(debug_assertions) || c.unique_key_prefix.is_empty() {
        return;
    }
    for file in files {
        debug_assert!(
            !strings::contains(file.value.as_slice(), c.unique_key_prefix),
            "{} ({:?}) still contains the chunk placeholder prefix {}",
            bstr::BStr::new(&file.dest_path),
            file.output_kind,
            bstr::BStr::new(c.unique_key_prefix),
        );
    }
}

/// Returns the builtins section of the executable being built: `target_section`, or this bun's
/// if `None`. Returns `None` if this bun can't compile that section's modules.
fn builtins_of(target_section: Option<&[u8]>) -> Option<bun_exe_format::builtins::Builtins<'_>> {
    use bun_exe_format::builtins::Builtins;
    let builtins =
        Builtins::parse(crate::bytecode::host_builtins()).and_then(|host| match target_section {
            Some(section) => Builtins::parse(section)?.require_same_engine(&host),
            None => Ok(host),
        });
    match builtins {
        Ok(builtins) => Some(builtins),
        Err(e) => {
            debug!(
                "Internal module bytecode: builtins section unusable ({})",
                <&'static str>::from(&e)
            );
            None
        }
    }
}

/// The internal modules the program imports, and the ones those import.
fn wanted_internal_modules(
    c: &LinkerContext,
    builtins: &bun_exe_format::builtins::Builtins<'_>,
) -> Vec<u32> {
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
    wanted
}

fn file_of_executable(
    path: &[u8],
    kind: options::OutputKind,
    data: Box<[u8]>,
) -> options::OutputFile {
    options::OutputFile::init(options::OutputFileInit {
        output_path: path.into(),
        input_loader: Loader::File,
        output_kind: kind,
        loader: Loader::File,
        display_size: data.len() as u32,
        data: options::OutputFileData::Buffer { data },
        ..Default::default()
    })
}

/// `--compile --bytecode`: the bytecode of the chunks, and of the internal modules (node:fs, …) that the bundle imports
/// and everything those can require (while loading or lazily later), as the builtins section of the executable that
/// the bundle is going into has them. With `--bytecode-order` it is all one payload, and a module's file only says
/// where its entry is. `files[i]` is chunk `i`'s, and `with_bytecode` has (chunk index, its `Bytecode` file).
fn embed_bytecode(
    c: &LinkerContext,
    log: &mut bun_ast::Log,
    chunks: &[Chunk],
    files: &mut Vec<options::OutputFile>,
    mut generator: crate::bytecode::Generator,
    mut with_bytecode: Vec<(usize, u32)>,
) -> Result<(), crate::Error> {
    use crate::bytecode_order::{self, Named};
    use bun_engine_bytecode::cache::{Encoder, Output, StringTableBuilder};

    with_bytecode.sort_by_key(|&(chunk, _)| files[chunk].load_order);
    let builtins = (c.options.generate_internal_module_bytecode)
        .then(|| builtins_of(c.options.target_builtins))
        .flatten();
    let internal_modules: Vec<_> = (builtins.iter())
        .flat_map(|builtins| {
            (wanted_internal_modules(c, builtins).into_iter())
                .filter_map(|id| Some((id, builtins.module(id)?, builtins.source_stamp)))
        })
        .collect();

    let order = c.bundle.bytecode_order.as_ref();
    let mut names = Vec::new();
    if order.is_some() {
        // What `IntermediateOutput::code` wrote where a text imports a chunk.
        let mut chunk_paths: Vec<Vec<u8>> = chunks
            .iter()
            .map(|chunk| {
                let public_path: &[u8] = &c.options_for_chunk(chunk).public_path;
                cheap_prefix_normalizer(public_path, &chunk.final_rel_path).concat()
            })
            .collect();
        chunk_paths.sort_unstable();
        let chunk_paths: Vec<&[u8]> = chunk_paths.iter().map(Vec::as_slice).collect();
        let named_chunks = with_bytecode.iter().map(|&(chunk, _)| Named::Chunk {
            text: files[chunk].value.as_slice(),
            is_esm: c.options.output_format == options::Format::Esm,
            chunk_paths: &chunk_paths,
        });
        let named_modules =
            (internal_modules.iter()).map(|(_, module, _)| Named::InternalModule(module.source));
        names =
            bytecode_order::names_of_all(&named_chunks.chain(named_modules).collect::<Vec<_>>());
    }
    let mut names = names.into_iter();

    let mut strings = StringTableBuilder::new(order.map_or(&[], |order| &order.hot_strings));
    let mut link = order.map(|order| Encoder::new(order.hints()));
    let mut names_out =
        (order.and_then(|_| bytecode_order::names_out())).map(|path| (path, Vec::new()));
    let depth = c.options.bytecode_depth;
    // Once for each text, in the order in which they are named. Nothing for what goes in the link's payload.
    let mut encode = |log: &mut bun_ast::Log, source: Option<Source<'_>>, path: &[u8]| {
        let Some(encoder) = &mut link else {
            return generator.generate(source?, depth, Some(&mut strings));
        };
        let names = names.next().flatten();
        if let Some((_, names_out)) = &mut names_out {
            bytecode_order::write_names_of(names_out, path, names.as_ref());
        }
        let functions = |key| bytecode_order::name_of(names.as_ref()?, key);
        let output = Output {
            encoder,
            strings: Some(&mut strings),
            names: (names.as_ref()).map(|names| bun_engine_bytecode::cache::OrderNames {
                entry: names.module,
                functions: &functions,
            }),
            depth,
        };
        generator.add(source?, output).then_some(())?;
        if names.is_none() {
            // The engine took what the parser here does not: nothing of it can be listed in an order file, or placed by one.
            log.add_warning_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "the bytecode order files cannot place the functions of {}: they have no names",
                    bstr::BStr::new(path)
                ),
            );
        }
        Some(Box::default())
    };

    let mut encoded: Vec<usize> = Vec::new();
    for (chunk, file) in with_bytecode {
        let source = Source::chunk(c.options.output_format, files[chunk].value.as_slice());
        let Some(bytes) = encode(log, source, &files[file as usize].dest_path) else {
            files[chunk].bytecode_index = u32::MAX;
            log.add_error_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "Failed to generate bytecode for {}",
                    bstr::BStr::new(&files[chunk].dest_path)
                ),
            );
            continue;
        };
        encoded.push(file as usize);
        files[file as usize].size = bytes.len();
        files[file as usize].value = crate::output_file::Value::Buffer { bytes };
    }
    for (id, module, stamp) in internal_modules {
        let source = Source::InternalModule(module.source, stamp);
        if let Some(bytes) = encode(log, Some(source), module.name) {
            encoded.push(files.len());
            let kind = options::OutputKind::BuiltinBytecode;
            files.push(file_of_executable(id.to_string().as_bytes(), kind, bytes));
        }
    }

    if let Some((path, names_out)) = &names_out {
        let path = bun_core::ZBox::from_bytes(path);
        if let Err(err) = bun_sys::File::write_file(bun_core::Fd::cwd(), &path, names_out) {
            bun_core::warn!(
                "failed to write {}: {}",
                bstr::BStr::new(path.as_bytes()),
                err
            );
        }
    }
    let (Ok(strings), Ok(linked)) = (strings.finish(), link.map(Encoder::finish).transpose())
    else {
        log.add_error(None, bun_ast::Loc::EMPTY, b"The bytecode is too large");
        return Err(crate::Error::BuildFailed);
    };
    if let Some(linked) = linked {
        if linked.functions_without_name != 0 {
            log.add_warning_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "the bytecode order files cannot place {} functions: they have no names",
                    linked.functions_without_name
                ),
            );
        }
        // An order file of another program moves nothing: say so. (A share is not judged: a recording also lists
        // functions of Bun's internal modules, which are not part of every link.)
        let listed = order.map_or(0, |order| order.hot_functions.len());
        if listed != 0 && linked.named_hot_functions == 0 {
            log.add_warning_fmt(
                None,
                bun_ast::Loc::EMPTY,
                format_args!(
                    "none of the {listed} functions the bytecode order files list is in this build"
                ),
            );
        }
        debug!(
            "Linked bytecode payload: {} modules, regions end at {:?}, {} of {} listed functions named",
            linked.entries.len(),
            linked.region_ends,
            linked.named_hot_functions,
            listed
        );
        for (&file, &entry) in encoded.iter().zip(&linked.entries) {
            files[file].bytecode_entry_offset = entry;
        }
        files.push(file_of_executable(
            b".bytecode-payload",
            options::OutputKind::BytecodePayload,
            bytecode_order::payload_file(linked.payload, linked.region_ends),
        ));
    }
    files.push(file_of_executable(
        b".bytecode-strings",
        options::OutputKind::BytecodeStringTable,
        strings.into(),
    ));
    Ok(())
}

/// Runs on the pool, for element `i` of `chunk.compile_results_for_chunk`.
fn generate_compile_result<'a>(
    c: &LinkerContext<'_, 'a>,
    chunks: &[Chunk<'a>],
    chunk: &Chunk<'a>,
    i: usize,
) -> CompileResult {
    let mut worker = crate::thread_pool::Worker::get(c.bundle);
    match &chunk.content {
        crate::chunk::Content::Javascript(js) => generate_compile_result_for_js_chunk(
            &mut worker,
            c,
            chunk,
            js.parts_in_chunk_in_order[i],
        ),
        crate::chunk::Content::Css(_) => {
            generate_compile_result_for_css_chunk(&mut worker, c, chunk, i)
        }
        crate::chunk::Content::Html => generate_compile_result_for_html_chunk(c, chunk, chunks),
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
