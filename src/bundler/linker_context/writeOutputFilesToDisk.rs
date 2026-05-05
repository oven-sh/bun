use core::mem::offset_of;
use std::io::Write as _;

use bun_alloc::MaxHeapAllocator;
use bun_core::fmt::quote;
use bun_core::{self as core_, err, Error};
use bun_logger::{self as Logger, Loc};
use bun_paths::{self as paths, PathBuffer};
use bun_str::{strings, PathString, String as BunString};
use bun_wyhash::hash;

use crate::options::{self, Loader, OutputFile};
use crate::{cheap_prefix_normalizer, BundleV2, Chunk};
use crate::linker_context::{debug, LinkerContext, OutputFileListBuilder};

// CYCLEBREAK MOVE_DOWN: write_file_with_path_buffer → bun_sys.
// TODO(b0): bun_sys::{write_file_with_path_buffer, WriteFileArgs, ...} arrive from move-in.
use bun_sys::{write_file_with_path_buffer, WriteFileArgs, WriteFileData, WriteFileEncoding, PathOrFileDescriptor};
use crate::dispatch::BYTECODE_HOOK;

pub fn write_output_files_to_disk(
    c: &mut LinkerContext,
    root_path: &[u8],
    chunks: &mut [Chunk],
    output_files: &mut OutputFileListBuilder,
    standalone_chunk_contents: Option<&[Option<&[u8]>]>,
) -> Result<(), Error> {
    let _trace = bun_core::perf::trace("Bundler.writeOutputFilesToDisk");

    // TODO(port): Zig used `std.fs.cwd().makeOpenPath`. Replace with bun_sys
    // directory API once available; using a placeholder wrapper here.
    let root_dir = match bun_sys::Dir::cwd().make_open_path(root_path) {
        Ok(dir) => dir,
        Err(e) => {
            if e == err!("NotDir") {
                c.log
                    .add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "Failed to create output directory {} is a file. Please choose a different outdir or delete {}",
                            quote(root_path),
                            quote(root_path),
                        ),
                    )
                    .expect("unreachable");
            } else {
                c.log
                    .add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "Failed to create output directory {} {}",
                            e.name(),
                            quote(root_path),
                        ),
                    )
                    .expect("unreachable");
            }
            return Err(e);
        }
    };
    // `defer root_dir.close()` — handled by Drop on bun_sys::Dir.

    // Optimization: when writing to disk, we can re-use the memory
    // PERF(port): MaxHeapAllocator reuses the largest allocation between
    // iterations. Phase B should verify bun_alloc::MaxHeapAllocator semantics
    // match (init/reset/deinit).
    let mut max_heap_allocator = MaxHeapAllocator::new();
    let code_allocator = max_heap_allocator.allocator();

    let mut max_heap_allocator_source_map = MaxHeapAllocator::new();
    let source_map_allocator = max_heap_allocator_source_map.allocator();

    let mut max_heap_allocator_inline_source_map = MaxHeapAllocator::new();
    let code_with_inline_source_map_allocator = max_heap_allocator_inline_source_map.allocator();

    let mut pathbuf = PathBuffer::uninit();
    // SAFETY: c points to LinkerContext which is the `linker` field of BundleV2.
    let bv2: &mut BundleV2 = unsafe {
        &mut *((c as *mut LinkerContext as *mut u8)
            .sub(offset_of!(BundleV2, linker))
            .cast::<BundleV2>())
    };

    for (chunk_index_in_chunks_list, chunk) in chunks.iter_mut().enumerate() {
        // In standalone mode, only write HTML chunks to disk.
        // Insert placeholder output files for non-HTML chunks to keep indices aligned.
        if standalone_chunk_contents.is_some() && !chunk.content.is_html() {
            let _ = output_files.insert_for_chunk(OutputFile::init(options::OutputFileInit {
                data: options::OutputFileData::Saved(0),
                hash: None,
                loader: chunk.content.loader(),
                input_path: Box::default(),
                display_size: 0,
                output_kind: options::OutputKind::Chunk,
                input_loader: Loader::Js,
                output_path: Box::default(),
                is_executable: false,
                source_map_index: None,
                bytecode_index: None,
                module_info_index: None,
                side: Some(options::Side::Client),
                entry_point_index: None,
                referenced_css_chunks: Box::default(),
            }));
            continue;
        }

        let _trace2 = bun_core::perf::trace("Bundler.writeChunkToDisk");
        // PERF(port): Zig `defer max_heap_allocator.reset()` — reset the reusable
        // buffer after each chunk. Using a scopeguard for the per-iteration reset.
        let _reset_guard = scopeguard::guard((), |_| {
            // TODO(port): borrowck — resetting through a captured &mut here may
            // conflict with `code_allocator` borrow above. Phase B may need to
            // restructure MaxHeapAllocator to use interior mutability.
            max_heap_allocator.reset();
        });

        let rel_path = chunk.final_rel_path.as_slice();
        if let Some(rel_parent) = paths::dirname_posix(rel_path) {
            if !rel_parent.is_empty() {
                if let Err(e) = root_dir.make_path(rel_parent) {
                    c.log
                        .add_error_fmt(
                            None,
                            Loc::EMPTY,
                            format_args!(
                                "{} creating outdir {} while saving chunk {}",
                                e.name(),
                                quote(rel_parent),
                                quote(&chunk.final_rel_path),
                            ),
                        )
                        .expect("unreachable");
                    return Err(e);
                }
            }
        }
        let mut display_size: usize = 0;
        let public_path: &[u8] = if chunk.flags.is_browser_chunk_from_server_build {
            &bv2.transpiler_for_target(options::Target::Browser).options.public_path
        } else {
            &c.resolver.opts.public_path
        };

        let mut code_result = if let Some(scc) = standalone_chunk_contents {
            match chunk.intermediate_output.code_standalone(
                &code_allocator,
                c.parse_graph,
                &c.graph,
                public_path,
                chunk,
                chunks,
                &mut display_size,
                false,
                false,
                scc,
            ) {
                Ok(r) => r,
                Err(e) => bun_core::Output::panic(format_args!(
                    "Failed to create output chunk: {}",
                    e.name()
                )),
            }
        } else {
            match chunk.intermediate_output.code(
                &code_allocator,
                c.parse_graph,
                &c.graph,
                public_path,
                chunk,
                chunks,
                &mut display_size,
                c.resolver.opts.compile && !chunk.flags.is_browser_chunk_from_server_build,
                chunk.content.sourcemap(c.options.source_maps) != options::SourceMapMode::None,
            ) {
                Ok(r) => r,
                Err(e) => bun_core::Output::panic(format_args!(
                    "Failed to create output chunk: {}",
                    e.name()
                )),
            }
        };

        let mut source_map_output_file: Option<OutputFile> = None;

        let input_path: Box<[u8]> = Box::from(if chunk.entry_point.is_entry_point {
            c.parse_graph
                .input_files
                .items_source()[chunk.entry_point.source_index as usize]
                .path
                .text
                .as_ref()
        } else {
            chunk.final_rel_path.as_ref()
        });

        match chunk.content.sourcemap(c.options.source_maps) {
            tag @ (options::SourceMapMode::External | options::SourceMapMode::Linked) => {
                let output_source_map = chunk
                    .output_source_map
                    .finalize(&source_map_allocator, &code_result.shifts)
                    .unwrap_or_else(|_| panic!("Failed to allocate memory for external source map"));
                let source_map_final_rel_path = strings::concat(&[
                    chunk.final_rel_path.as_ref(),
                    b".map",
                ])
                .unwrap_or_else(|_| panic!("Failed to allocate memory for external source map path"));

                if tag == options::SourceMapMode::Linked {
                    let (a, b) = if !public_path.is_empty() {
                        cheap_prefix_normalizer(public_path, &source_map_final_rel_path)
                    } else {
                        (b"".as_slice(), paths::basename(&source_map_final_rel_path))
                    };

                    let source_map_start = b"//# sourceMappingURL=";
                    let total_len = code_result.buffer.len()
                        + source_map_start.len()
                        + a.len()
                        + b.len()
                        + b"\n".len();
                    // PERF(port): Zig used Chunk.IntermediateOutput.allocatorForSize(total_len)
                    // to pick a size-appropriate allocator. Using Vec (global mimalloc) here.
                    let mut buf: Vec<u8> = Vec::with_capacity(total_len);
                    // PERF(port): was appendSliceAssumeCapacity
                    buf.extend_from_slice(&code_result.buffer);
                    buf.extend_from_slice(source_map_start);
                    buf.extend_from_slice(a);
                    buf.extend_from_slice(b);
                    // PERF(port): was appendAssumeCapacity
                    buf.push(b'\n');
                    code_result.buffer = buf.into();
                }

                match write_file_with_path_buffer(
                    &mut pathbuf,
                    WriteFileArgs {
                        data: WriteFileData::Buffer { buffer: &output_source_map },
                        encoding: WriteFileEncoding::Buffer,
                        dirfd: bun_sys::Fd::from_std_dir(&root_dir),
                        file: PathOrFileDescriptor::Path(PathString::init(&source_map_final_rel_path)),
                        ..Default::default()
                    },
                ) {
                    bun_sys::Result::Err(e) => {
                        c.log.add_sys_error(
                            e,
                            format_args!(
                                "writing sourcemap for chunk {}",
                                quote(&chunk.final_rel_path)
                            ),
                        )?;
                        return Err(err!("WriteFailed"));
                    }
                    bun_sys::Result::Ok(_) => {}
                }

                source_map_output_file = Some(OutputFile::init(options::OutputFileInit {
                    output_path: source_map_final_rel_path,
                    input_path: strings::concat(&[&input_path, b".map"])?,
                    loader: Loader::Json,
                    input_loader: Loader::File,
                    output_kind: options::OutputKind::Sourcemap,
                    size: output_source_map.len() as u32,
                    data: options::OutputFileData::Saved(0),
                    side: Some(options::Side::Client),
                    entry_point_index: None,
                    is_executable: false,
                    ..Default::default()
                }));
            }
            options::SourceMapMode::Inline => {
                let output_source_map = chunk
                    .output_source_map
                    .finalize(&source_map_allocator, &code_result.shifts)
                    .unwrap_or_else(|_| panic!("Failed to allocate memory for external source map"));
                let encode_len = bun_base64::encode_len(&output_source_map);

                let source_map_start = b"//# sourceMappingURL=data:application/json;base64,";
                let total_len = code_result.buffer.len() + source_map_start.len() + encode_len + 1;
                // PERF(port): Zig used `code_with_inline_source_map_allocator` (MaxHeapAllocator)
                // for this Vec to reuse across iterations.
                let _ = &code_with_inline_source_map_allocator;
                let mut buf: Vec<u8> = Vec::with_capacity(total_len);

                // PERF(port): was appendSliceAssumeCapacity
                buf.extend_from_slice(&code_result.buffer);
                buf.extend_from_slice(source_map_start);

                let old_len = buf.len();
                buf.resize(old_len + encode_len, 0);
                let _ = bun_base64::encode(&mut buf[old_len..], &output_source_map);

                // PERF(port): was appendAssumeCapacity
                buf.push(b'\n');
                code_result.buffer = buf.into();
            }
            options::SourceMapMode::None => {}
        }

        let bytecode_output_file: Option<OutputFile> = 'brk: {
            if c.options.generate_bytecode_cache {
                let loader: Loader = if chunk.entry_point.is_entry_point {
                    c.parse_graph.input_files.items_loader()[chunk.entry_point.source_index as usize]
                } else {
                    Loader::Js
                };

                // CYCLEBREAK GENUINE: jsc::{VirtualMachine, initialize, CachedBytecode}
                // → AtomicPtr hook (BYTECODE_HOOK). Null = bytecode disabled.
                let bytecode_vt = BYTECODE_HOOK.load(core::sync::atomic::Ordering::Acquire);
                if loader.is_javascript_like() && !bytecode_vt.is_null() {
                    // SAFETY: hook is registered once at runtime init and never freed.
                    let bytecode_vt = unsafe { &*bytecode_vt };
                    unsafe { (bytecode_vt.set_bundler_thread)(true) };
                    unsafe { (bytecode_vt.initialize_jsc)(false) };
                    let mut fdpath = PathBuffer::uninit();
                    let mut source_provider_url = BunString::create_format(format_args!(
                        "{}{}",
                        bstr::BStr::new(&chunk.final_rel_path),
                        bun_core::BYTECODE_EXTENSION,
                    ))?;
                    source_provider_url.ref_();
                    // `defer source_provider_url.deref()` handled by Drop on BunString.

                    if let Some(result) = unsafe {
                        (bytecode_vt.generate)(
                            c.options.output_format,
                            &code_result.buffer,
                            source_provider_url.as_bytes(),
                        )
                    } {
                        let source_provider_url_str = source_provider_url.to_utf8();
                        let (bytecode, cached_bytecode) = result;
                        debug!(
                            "Bytecode cache generated {}: {}",
                            bstr::BStr::new(source_provider_url_str.as_bytes()),
                            bun_core::fmt::size(bytecode.len(), bun_core::fmt::SizeOpts {
                                space_between_number_and_unit: true,
                            }),
                        );
                        let frp = chunk.final_rel_path.as_ref();
                        fdpath[..frp.len()].copy_from_slice(frp);
                        fdpath[frp.len()..frp.len() + bun_core::BYTECODE_EXTENSION.len()]
                            .copy_from_slice(bun_core::BYTECODE_EXTENSION.as_bytes());
                        // `defer cached_bytecode.deref()` — handled by Drop.
                        let _cached_bytecode = cached_bytecode;
                        match write_file_with_path_buffer(
                            &mut pathbuf,
                            WriteFileArgs {
                                data: WriteFileData::Buffer { buffer: &bytecode },
                                encoding: WriteFileEncoding::Buffer,
                                mode: if chunk.flags.is_executable { 0o755 } else { 0o644 },
                                dirfd: bun_sys::Fd::from_std_dir(&root_dir),
                                file: PathOrFileDescriptor::Path(PathString::init(
                                    &fdpath[..frp.len() + bun_core::BYTECODE_EXTENSION.len()],
                                )),
                                ..Default::default()
                            },
                        ) {
                            bun_sys::Result::Ok(_) => {}
                            bun_sys::Result::Err(e) => {
                                c.log
                                    .add_error_fmt(
                                        None,
                                        Loc::EMPTY,
                                        format_args!(
                                            "{} writing bytecode for chunk {}",
                                            e,
                                            quote(&chunk.final_rel_path),
                                        ),
                                    )
                                    .expect("unreachable");
                                return Err(err!("WriteFailed"));
                            }
                        }

                        let mut input_path_buf: Vec<u8> = Vec::new();
                        write!(
                            &mut input_path_buf,
                            "{}{}",
                            bstr::BStr::new(&chunk.final_rel_path),
                            bun_core::BYTECODE_EXTENSION
                        )
                        .expect("unreachable");

                        break 'brk Some(OutputFile::init(options::OutputFileInit {
                            output_path: Box::<[u8]>::from(source_provider_url_str.as_bytes()),
                            input_path: input_path_buf.into_boxed_slice(),
                            input_loader: Loader::File,
                            hash: if chunk.template.placeholder.hash.is_some() {
                                Some(hash(&bytecode))
                            } else {
                                None
                            },
                            output_kind: options::OutputKind::Bytecode,
                            loader: Loader::File,
                            size: bytecode.len() as u32,
                            display_size: bytecode.len() as u32,
                            data: options::OutputFileData::Saved(0),
                            side: None,
                            entry_point_index: None,
                            is_executable: false,
                            ..Default::default()
                        }));
                    }
                }
            }

            break 'brk None;
        };

        match write_file_with_path_buffer(
            &mut pathbuf,
            WriteFileArgs {
                data: WriteFileData::Buffer { buffer: &code_result.buffer },
                encoding: WriteFileEncoding::Buffer,
                mode: if chunk.flags.is_executable { 0o755 } else { 0o644 },
                dirfd: bun_sys::Fd::from_std_dir(&root_dir),
                file: PathOrFileDescriptor::Path(PathString::init(rel_path)),
                ..Default::default()
            },
        ) {
            bun_sys::Result::Err(e) => {
                c.log.add_sys_error(
                    e,
                    format_args!("writing chunk {}", quote(&chunk.final_rel_path)),
                )?;
                return Err(err!("WriteFailed"));
            }
            bun_sys::Result::Ok(_) => {}
        }

        let source_map_index: Option<u32> = if let Some(f) = source_map_output_file {
            Some(output_files.insert_for_sourcemap_or_bytecode(f)?)
        } else {
            None
        };

        let bytecode_index: Option<u32> = if let Some(f) = bytecode_output_file {
            Some(output_files.insert_for_sourcemap_or_bytecode(f)?)
        } else {
            None
        };

        let output_kind = if chunk.content.is_css() {
            options::OutputKind::Asset
        } else if chunk.entry_point.is_entry_point {
            c.graph.files.items_entry_point_kind()[chunk.entry_point.source_index as usize]
                .output_kind()
        } else {
            options::OutputKind::Chunk
        };

        let chunk_index = output_files.insert_for_chunk(OutputFile::init(options::OutputFileInit {
            output_path: Box::<[u8]>::from(chunk.final_rel_path.as_ref()),
            input_path,
            input_loader: if chunk.entry_point.is_entry_point {
                c.parse_graph.input_files.items_loader()[chunk.entry_point.source_index as usize]
            } else {
                Loader::Js
            },
            hash: chunk.template.placeholder.hash,
            output_kind,
            loader: chunk.content.loader(),
            source_map_index,
            bytecode_index,
            size: code_result.buffer.len() as u32,
            display_size: display_size as u32,
            is_executable: chunk.flags.is_executable,
            data: options::OutputFileData::Saved(0),
            side: Some(if chunk.content.is_css() {
                options::Side::Client
            } else {
                match c.graph.ast.items_target()[chunk.entry_point.source_index as usize] {
                    options::Target::Browser => options::Side::Client,
                    _ => options::Side::Server,
                }
            }),
            entry_point_index: if output_kind == options::OutputKind::EntryPoint {
                Some(
                    chunk.entry_point.source_index
                        - (if let Some(fw) = &c.framework {
                            if fw.server_components.is_some() { 3 } else { 1 }
                        } else {
                            1
                        }) as u32,
                )
            } else {
                None
            },
            referenced_css_chunks: match &chunk.content {
                crate::ChunkContent::Javascript(js) => {
                    // TODO(port): @ptrCast([]const u32) — Phase B confirm Index repr
                    Box::<[u32]>::from(js.css_chunks.as_ref())
                }
                crate::ChunkContent::Css(_) => Box::default(),
                crate::ChunkContent::Html(_) => Box::default(),
            },
            ..Default::default()
        }));

        // We want the chunk index to remain the same in `output_files` so the indices in `OutputFile.referenced_css_chunks` work.
        // In standalone mode, non-HTML chunks are skipped so this invariant doesn't apply.
        if standalone_chunk_contents.is_none() {
            debug_assert!(
                chunk_index == chunk_index_in_chunks_list,
                "chunk_index ({}) != chunk_index_in_chunks_list ({})",
                chunk_index,
                chunk_index_in_chunks_list,
            );
        }
    }

    // In standalone mode, additional output files (assets) are inlined into the HTML.
    if standalone_chunk_contents.is_some() {
        return Ok(());
    }

    {
        let additional_output_files = output_files.get_mutable_additional_output_files();
        output_files.total_insertions += u32::try_from(additional_output_files.len()).unwrap();
        // PORT NOTE: reshaped for borrowck — Zig iterated two slices in lockstep
        // with `|*src, *dest|`; here we zip mutable iterators.
        debug_assert_eq!(
            c.parse_graph.additional_output_files.len(),
            additional_output_files.len()
        );
        for (src, dest) in c
            .parse_graph
            .additional_output_files
            .iter_mut()
            .zip(additional_output_files.iter_mut())
        {
            let bytes = core::mem::take(&mut src.value.buffer.bytes);
            // `defer src.value.buffer.allocator.free(bytes)` — `bytes` is now an
            // owned Vec/Box that drops at end of scope.

            if let Some(rel_parent) = paths::dirname(&src.dest_path) {
                if !rel_parent.is_empty() {
                    if let Err(e) = root_dir.make_path(rel_parent) {
                        c.log
                            .add_error_fmt(
                                None,
                                Loc::EMPTY,
                                format_args!(
                                    "{} creating outdir {} while saving file {}",
                                    e.name(),
                                    quote(rel_parent),
                                    quote(&src.dest_path),
                                ),
                            )
                            .expect("unreachable");
                        return Err(e);
                    }
                }
            }

            match write_file_with_path_buffer(
                &mut pathbuf,
                WriteFileArgs {
                    data: WriteFileData::Buffer { buffer: bytes },
                    encoding: WriteFileEncoding::Buffer,
                    dirfd: bun_sys::Fd::from_std_dir(&root_dir),
                    file: PathOrFileDescriptor::Path(PathString::init(&src.dest_path)),
                    ..Default::default()
                },
            ) {
                bun_sys::Result::Err(e) => {
                    c.log
                        .add_sys_error(
                            e,
                            format_args!("writing file {}", quote(&src.src_path.text)),
                        )
                        .expect("unreachable");
                    return Err(err!("WriteFailed"));
                }
                bun_sys::Result::Ok(_) => {}
            }

            *dest = src.clone();
            dest.value = options::OutputFileValue::Saved(Default::default());
            dest.size = bytes.len() as u32;
        }
    }

    Ok(())
}

pub use crate::{DeferredBatchTask, ParseTask, ThreadPool};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/writeOutputFilesToDisk.zig (483 lines)
//   confidence: medium
//   todos:      5
//   notes:      NodeFS/WriteFileArgs/ArrayBuffer shapes guessed from Zig anon-struct init; MaxHeapAllocator reset under borrowck and bun_sys::Dir API need Phase B attention; chunks iter_mut + &chunks alias inside code()/code_standalone() will need reshaping.
// ──────────────────────────────────────────────────────────────────────────
