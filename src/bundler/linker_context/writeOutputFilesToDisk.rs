use crate::mal_prelude::*;
use bun_collections::VecExt;
use core::mem::offset_of;
use std::io::Write as _;

use bun_alloc::MaxHeapAllocator;
use bun_ast::Loc;
use bun_core::fmt::quote;
use bun_core::{Error, err};
use bun_core::{PathString, String as BunString, immutable as strings};
use bun_paths::{self as paths, PathBuffer};
use bun_wyhash::hash;

use crate::LinkerContext;
use crate::chunk::{Content, Flags as ChunkFlags};
use crate::linker_context::output_file_list_builder::OutputFileList;
use crate::linker_context_mod::debug;
use crate::options::{self, Loader, OutputFile, SourceMapOption};
use crate::output_file::{
    BakeExtra, Index as OutputFileIndex, IndexOptional, Options as OutputFileInit,
    OptionsData as OutputFileData, SavedFile, Value as OutputFileValue,
};
use crate::{BundleV2, Chunk, cheap_prefix_normalizer};

// TODO(b0): bun_sys::{write_file_with_path_buffer, WriteFileArgs, ...} arrive from move-in.
use bun_sys::{
    FdDirExt, PathOrFileDescriptor, WriteFileArgs, WriteFileData, WriteFileEncoding,
    write_file_with_path_buffer,
};

/// Zig: `bun.bytecode_extension` (".jsc"). Mirror of `src/bun.zig:bytecode_extension`.
const BYTECODE_EXTENSION: &str = ".jsc";

pub fn write_output_files_to_disk(
    c: &mut LinkerContext,
    root_path: &[u8],
    chunks: &mut [Chunk],
    output_files: &mut OutputFileList,
    standalone_chunk_contents: Option<&[Option<Box<[u8]>>]>,
) -> Result<(), Error> {
    let _trace = bun_core::perf::trace("Bundler.writeOutputFilesToDisk");

    // TODO(port): Zig used `std.fs.cwd().makeOpenPath`. Replace with bun_sys
    // directory API once available; using a placeholder wrapper here.
    let root_dir = match bun_sys::Dir::cwd().make_open_path(root_path, Default::default()) {
        Ok(dir) => dir,
        Err(e) => {
            if e == err!("NotDir") {
                c.log_mut()
                    .add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "Failed to create output directory {} is a file. Please choose a different outdir or delete {}",
                            quote(root_path),
                            quote(root_path),
                        ),
                    );
            } else {
                c.log_mut().add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!(
                        "Failed to create output directory {} {}",
                        e.name(),
                        quote(root_path),
                    ),
                );
            }
            return Err(e);
        }
    };
    let _root_dir_guard = scopeguard::guard(root_dir, |d| d.close());
    let root_dir = *_root_dir_guard;

    // Optimization: when writing to disk, we can re-use the memory
    // PERF(port): MaxHeapAllocator reuses the largest allocation between
    // iterations. Phase B should verify bun_alloc::MaxHeapAllocator semantics
    // match (init/reset/deinit). DynAlloc is currently `()` so the arena
    // handles below are placeholders; allocation routes through global mimalloc.
    let mut max_heap_allocator = MaxHeapAllocator::init();
    let mut _max_heap_allocator_source_map = MaxHeapAllocator::init();
    let mut _max_heap_allocator_inline_source_map = MaxHeapAllocator::init();

    let mut pathbuf = PathBuffer::uninit();
    // SAFETY: c points to LinkerContext which is the `linker` field of BundleV2.
    let bv2: &mut BundleV2 =
        unsafe { &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(c)) };

    // PORT NOTE: Zig passes `chunk` (an element of `chunks`) and `chunks`
    // together into `code()`/`code_standalone()`. The callee now takes
    // `&Chunk` / `&[Chunk]` (read-only), so iterate by index and reborrow
    // shared; the only per-chunk mutation is the `intermediate_output`
    // take/restore done via `chunks[i]`.
    let chunks_len = chunks.len();

    for chunk_index_in_chunks_list in 0..chunks_len {
        let chunk: &Chunk = &chunks[chunk_index_in_chunks_list];
        // In standalone mode, only write HTML chunks to disk.
        // Insert placeholder output files for non-HTML chunks to keep indices aligned.
        if standalone_chunk_contents.is_some() && !matches!(chunk.content, Content::Html) {
            let _ = output_files.insert_for_chunk(OutputFile::init(OutputFileInit {
                data: OutputFileData::Saved(0),
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
                size: None,
                source_index: IndexOptional::NONE,
                bake_extra: BakeExtra::default(),
            }));
            continue;
        }

        let _trace2 = bun_core::perf::trace("Bundler.writeChunkToDisk");
        // PERF(port): Zig `defer max_heap_allocator.reset()` — reset the reusable
        // buffer after each chunk. `MaxHeapAllocator::scope()` returns an RAII
        // guard that resets on drop and derefs to the arena, so when Phase B
        // wires up `code_allocator` it can borrow through `_code_allocator`.
        let _code_allocator = max_heap_allocator.scope();

        let rel_parent =
            paths::resolve_path::dirname::<paths::platform::Posix>(&chunk.final_rel_path);
        if !rel_parent.is_empty() {
            if let Err(e) = root_dir.make_path(rel_parent) {
                c.log_mut().add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!(
                        "{} creating outdir {} while saving chunk {}",
                        e.name(),
                        quote(rel_parent),
                        quote(&chunk.final_rel_path),
                    ),
                );
                return Err(e);
            }
        }
        let mut display_size: usize = 0;
        let resolver_opts = &c.resolver().opts;
        let public_path: &[u8] = if chunk
            .flags
            .contains(ChunkFlags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
        {
            &bv2.transpiler_for_target(options::Target::Browser)
                .options
                .public_path
        } else {
            &resolver_opts.public_path
        };

        // PORT NOTE: take `intermediate_output` by value so its `&mut self` is
        // disjoint from the `&chunks[i]` / `&[Chunk]` reads below.
        let mut intermediate_output =
            core::mem::take(&mut chunks[chunk_index_in_chunks_list].intermediate_output);
        let chunk: &Chunk = &chunks[chunk_index_in_chunks_list];
        let parse_graph = c.parse_graph();

        let mut code_result = if let Some(scc) = standalone_chunk_contents {
            match intermediate_output.code_standalone(
                None,
                parse_graph,
                &c.graph,
                public_path,
                chunk,
                chunks,
                Some(&mut display_size),
                false,
                false,
                scc,
            ) {
                Ok(r) => r,
                Err(_e) => bun_core::Output::panic(format_args!(
                    "Failed to create output chunk: OutOfMemory"
                )),
            }
        } else {
            match intermediate_output.code(
                None,
                parse_graph,
                &c.graph,
                public_path,
                chunk,
                chunks,
                Some(&mut display_size),
                resolver_opts.compile
                    && !chunk
                        .flags
                        .contains(ChunkFlags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD),
                chunk.content.sourcemap(c.options.source_maps) != SourceMapOption::None,
            ) {
                Ok(r) => r,
                Err(_e) => bun_core::Output::panic(format_args!(
                    "Failed to create output chunk: OutOfMemory"
                )),
            }
        };
        // Tail of the loop body needs `&mut chunk` (`output_source_map.finalize()`);
        // no `&[Chunk]` is needed past this point so an exclusive reborrow is fine.
        let chunk: &mut Chunk = &mut chunks[chunk_index_in_chunks_list];
        chunk.intermediate_output = intermediate_output;

        let mut source_map_output_file: Option<OutputFile> = None;

        let input_path: Box<[u8]> = Box::from(if chunk.entry_point.is_entry_point() {
            parse_graph.input_files.items_source()[chunk.entry_point.source_index() as usize]
                .path
                .text
        } else {
            &chunk.final_rel_path
        });

        match chunk.content.sourcemap(c.options.source_maps) {
            tag @ (SourceMapOption::External | SourceMapOption::Linked) => {
                let output_source_map = chunk
                    .output_source_map
                    .finalize(&code_result.shifts)
                    .unwrap_or_else(|_| {
                        panic!("Failed to allocate memory for external source map")
                    });
                let source_map_final_rel_path = strings::concat(&[&chunk.final_rel_path, b".map"]);

                if tag == SourceMapOption::Linked {
                    let [a, b] = if !public_path.is_empty() {
                        cheap_prefix_normalizer(public_path, &source_map_final_rel_path)
                    } else {
                        [b"" as &[u8], paths::basename(&source_map_final_rel_path)]
                    };

                    let source_map_start = b"//# sourceMappingURL=";
                    let total_len = code_result.buffer.len()
                        + source_map_start.len()
                        + a.len()
                        + b.len()
                        + b"\n".len();
                    // PERF(port): Zig used Chunk.IntermediateOutput.allocatorForSize(total_len)
                    // to pick a size-appropriate arena. Using Vec (global mimalloc) here.
                    let mut buf: Vec<u8> = Vec::with_capacity(total_len);
                    // PERF(port): was appendSliceAssumeCapacity
                    buf.extend_from_slice(&code_result.buffer);
                    buf.extend_from_slice(source_map_start);
                    buf.extend_from_slice(a);
                    buf.extend_from_slice(b);
                    // PERF(port): was appendAssumeCapacity
                    buf.push(b'\n');
                    code_result.buffer = buf.into_boxed_slice();
                }

                match bun_sys::File::write_file(
                    bun_sys::Fd::from_std_dir(&root_dir),
                    paths::resolve_path::z(&source_map_final_rel_path, &mut pathbuf),
                    &output_source_map,
                ) {
                    Err(e) => {
                        c.log_mut().add_sys_error(
                            &e,
                            format_args!(
                                "writing sourcemap for chunk {}",
                                quote(&chunk.final_rel_path)
                            ),
                        );
                        return Err(err!("WriteFailed"));
                    }
                    Ok(_) => {}
                }

                source_map_output_file = Some(OutputFile::init(OutputFileInit {
                    output_path: source_map_final_rel_path,
                    input_path: strings::concat(&[&input_path, b".map"]),
                    loader: Loader::Json,
                    input_loader: Loader::File,
                    output_kind: options::OutputKind::Sourcemap,
                    size: Some(output_source_map.len()),
                    data: OutputFileData::Saved(0),
                    side: Some(options::Side::Client),
                    entry_point_index: None,
                    is_executable: false,
                    hash: None,
                    source_map_index: None,
                    bytecode_index: None,
                    module_info_index: None,
                    display_size: 0,
                    referenced_css_chunks: Box::default(),
                    source_index: IndexOptional::NONE,
                    bake_extra: BakeExtra::default(),
                }));
            }
            SourceMapOption::Inline => {
                let output_source_map = chunk
                    .output_source_map
                    .finalize(&code_result.shifts)
                    .unwrap_or_else(|_| {
                        panic!("Failed to allocate memory for external source map")
                    });
                let encode_len = bun_base64::encode_len(&output_source_map);

                let source_map_start = b"//# sourceMappingURL=data:application/json;base64,";
                let total_len = code_result.buffer.len() + source_map_start.len() + encode_len + 1;
                // PERF(port): Zig used `code_with_inline_source_map_allocator` (MaxHeapAllocator)
                // for this Vec to reuse across iterations.
                let mut buf: Vec<u8> = Vec::with_capacity(total_len);

                // PERF(port): was appendSliceAssumeCapacity
                buf.extend_from_slice(&code_result.buffer);
                buf.extend_from_slice(source_map_start);

                let old_len = buf.len();
                buf.resize(old_len + encode_len, 0);
                let _ = bun_base64::encode(&mut buf[old_len..], &output_source_map);

                // PERF(port): was appendAssumeCapacity
                buf.push(b'\n');
                code_result.buffer = buf.into_boxed_slice();
            }
            SourceMapOption::None => {}
        }

        let bytecode_output_file: Option<OutputFile> = 'brk: {
            if c.options.generate_bytecode_cache {
                let loader: Loader = if chunk.entry_point.is_entry_point() {
                    parse_graph.input_files.items_loader()
                        [chunk.entry_point.source_index() as usize]
                } else {
                    Loader::Js
                };

                if loader.is_javascript_like() {
                    let mut fdpath = PathBuffer::uninit();
                    let source_provider_url = BunString::create_format(format_args!(
                        "{}{}",
                        bstr::BStr::new(&chunk.final_rel_path),
                        BYTECODE_EXTENSION,
                    ));
                    source_provider_url.ref_();
                    // `defer source_provider_url.deref()` handled by Drop on OwnedString.
                    let mut source_provider_url = bun_core::OwnedString::new(source_provider_url);

                    if let Some(bytecode) = crate::bundle_v2::dispatch::generate_cached_bytecode(
                        c.options.output_format,
                        &code_result.buffer,
                        &mut source_provider_url,
                    ) {
                        let source_provider_url_str = source_provider_url.to_utf8();
                        debug!(
                            "Bytecode cache generated {}: {}",
                            bstr::BStr::new(source_provider_url_str.slice()),
                            bun_core::fmt::size(
                                bytecode.len(),
                                bun_core::fmt::SizeFormatterOptions {
                                    space_between_number_and_unit: true,
                                }
                            ),
                        );
                        let frp: &[u8] = &chunk.final_rel_path;
                        fdpath[..frp.len()].copy_from_slice(frp);
                        fdpath[frp.len()..frp.len() + BYTECODE_EXTENSION.len()]
                            .copy_from_slice(BYTECODE_EXTENSION.as_bytes());
                        match write_file_with_path_buffer(
                            &mut pathbuf,
                            WriteFileArgs {
                                data: WriteFileData::Buffer { buffer: &bytecode },
                                encoding: WriteFileEncoding::Buffer,
                                mode: if chunk.flags.contains(ChunkFlags::IS_EXECUTABLE) {
                                    0o755
                                } else {
                                    0o644
                                },
                                dirfd: bun_sys::Fd::from_std_dir(&root_dir),
                                file: PathOrFileDescriptor::Path(PathString::init(
                                    &fdpath[..frp.len() + BYTECODE_EXTENSION.len()],
                                )),
                            },
                        ) {
                            Ok(_) => {}
                            Err(e) => {
                                c.log_mut().add_error_fmt(
                                    None,
                                    Loc::EMPTY,
                                    format_args!(
                                        "{} writing bytecode for chunk {}",
                                        e,
                                        quote(&chunk.final_rel_path),
                                    ),
                                );
                                return Err(err!("WriteFailed"));
                            }
                        }

                        let mut input_path_buf: Vec<u8> = Vec::new();
                        write!(
                            &mut input_path_buf,
                            "{}{}",
                            bstr::BStr::new(&chunk.final_rel_path),
                            BYTECODE_EXTENSION
                        )
                        .expect("unreachable");

                        break 'brk Some(OutputFile::init(OutputFileInit {
                            output_path: Box::<[u8]>::from(source_provider_url_str.slice()),
                            input_path: input_path_buf.into_boxed_slice(),
                            input_loader: Loader::File,
                            hash: if chunk.template.placeholder.hash.is_some() {
                                Some(hash(&bytecode))
                            } else {
                                None
                            },
                            output_kind: options::OutputKind::Bytecode,
                            loader: Loader::File,
                            size: Some(bytecode.len()),
                            display_size: bytecode.len() as u32,
                            data: OutputFileData::Saved(0),
                            side: None,
                            entry_point_index: None,
                            is_executable: false,
                            source_map_index: None,
                            bytecode_index: None,
                            module_info_index: None,
                            referenced_css_chunks: Box::default(),
                            source_index: IndexOptional::NONE,
                            bake_extra: BakeExtra::default(),
                        }));
                    }
                }
            }

            break 'brk None;
        };

        match write_file_with_path_buffer(
            &mut pathbuf,
            WriteFileArgs {
                data: WriteFileData::Buffer {
                    buffer: &code_result.buffer,
                },
                encoding: WriteFileEncoding::Buffer,
                mode: if chunk.flags.contains(ChunkFlags::IS_EXECUTABLE) {
                    0o755
                } else {
                    0o644
                },
                dirfd: bun_sys::Fd::from_std_dir(&root_dir),
                file: PathOrFileDescriptor::Path(PathString::init(&chunk.final_rel_path)),
            },
        ) {
            Err(e) => {
                c.log_mut().add_sys_error(
                    &e,
                    format_args!("writing chunk {}", quote(&chunk.final_rel_path)),
                );
                return Err(err!("WriteFailed"));
            }
            Ok(_) => {}
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

        let output_kind = if matches!(chunk.content, Content::Css(_)) {
            options::OutputKind::Asset
        } else if chunk.entry_point.is_entry_point() {
            c.graph.files.items_entry_point_kind()[chunk.entry_point.source_index() as usize]
                .output_kind()
        } else {
            options::OutputKind::Chunk
        };

        let chunk_index = output_files.insert_for_chunk(OutputFile::init(OutputFileInit {
            output_path: chunk.final_rel_path.clone(),
            input_path,
            input_loader: if chunk.entry_point.is_entry_point() {
                parse_graph.input_files.items_loader()[chunk.entry_point.source_index() as usize]
            } else {
                Loader::Js
            },
            hash: chunk.template.placeholder.hash,
            output_kind,
            loader: chunk.content.loader(),
            source_map_index,
            bytecode_index,
            module_info_index: None,
            size: Some(code_result.buffer.len()),
            display_size: display_size as u32,
            is_executable: chunk.flags.contains(ChunkFlags::IS_EXECUTABLE),
            data: OutputFileData::Saved(0),
            side: Some(if matches!(chunk.content, Content::Css(_)) {
                options::Side::Client
            } else {
                match c.graph.ast.items_target()[chunk.entry_point.source_index() as usize] {
                    options::Target::Browser => options::Side::Client,
                    _ => options::Side::Server,
                }
            }),
            entry_point_index: if output_kind == options::OutputKind::EntryPoint {
                // TODO(b0-genuine): `bake_types::Framework` is missing
                // `server_components`; once it lands, restore the
                // `if fw.server_components.is_some() { 3 } else { 1 }` branch.
                let offset: u32 = if c.framework.is_some() { 1 } else { 1 };
                Some(chunk.entry_point.source_index() - offset)
            } else {
                None
            },
            referenced_css_chunks: match &chunk.content {
                Content::Javascript(js) => {
                    // Zig: `@ptrCast(dupe(u32, js.css_chunks))` — `Index` is
                    // `#[repr(transparent)]` over u32.
                    js.css_chunks
                        .iter()
                        .map(|&i| OutputFileIndex::init(i))
                        .collect()
                }
                Content::Css(_) => Box::default(),
                Content::Html => Box::default(),
            },
            source_index: IndexOptional::NONE,
            bake_extra: BakeExtra::default(),
        }));

        // We want the chunk index to remain the same in `output_files` so the indices in `OutputFile.referenced_css_chunks` work.
        // In standalone mode, non-HTML chunks are skipped so this invariant doesn't apply.
        if standalone_chunk_contents.is_none() {
            debug_assert!(
                chunk_index as usize == chunk_index_in_chunks_list,
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
        // PORT NOTE: reshaped for borrowck — compute len before mut borrow,
        // bump `total_insertions`, then take the slice.
        let additional_start = output_files.additional_output_files_start as usize;
        let additional_len = output_files.output_files.len() - additional_start;
        output_files.total_insertions += u32::try_from(additional_len).expect("int cast");
        let additional_output_files = &mut output_files.output_files[additional_start..];
        // SAFETY: parse_graph backref; raw deref because `parse_graph` is held
        // across `c.log_mut()` below (split borrow).
        let parse_graph = unsafe { &mut *c.parse_graph };
        debug_assert_eq!(
            parse_graph.additional_output_files.len(),
            additional_output_files.len()
        );
        for (src, dest) in parse_graph
            .additional_output_files
            .iter_mut()
            .zip(additional_output_files.iter_mut())
        {
            let bytes = if let OutputFileValue::Buffer { bytes } = &mut src.value {
                core::mem::take(bytes)
            } else {
                Box::default()
            };
            // `defer src.value.buffer.arena.free(bytes)` — `bytes` is now an
            // owned Box that drops at end of scope.

            let rel_parent = paths::resolve_path::dirname::<paths::platform::Auto>(&src.dest_path);
            if !rel_parent.is_empty() {
                if let Err(e) = root_dir.make_path(rel_parent) {
                    c.log_mut().add_error_fmt(
                        None,
                        Loc::EMPTY,
                        format_args!(
                            "{} creating outdir {} while saving file {}",
                            e.name(),
                            quote(rel_parent),
                            quote(&*src.dest_path),
                        ),
                    );
                    return Err(e);
                }
            }

            match bun_sys::File::write_file(
                bun_sys::Fd::from_std_dir(&root_dir),
                paths::resolve_path::z(&src.dest_path, &mut pathbuf),
                &bytes,
            ) {
                Err(e) => {
                    c.log_mut().add_sys_error(
                        &e,
                        format_args!("writing file {}", quote(src.src_path.text)),
                    );
                    return Err(err!("WriteFailed"));
                }
                Ok(_) => {}
            }

            let bytes_len = bytes.len();
            drop(bytes);
            *dest = core::mem::replace(src, OutputFile::zero_value());
            dest.value = OutputFileValue::Saved(SavedFile::default());
            dest.size = bytes_len;
        }
    }

    Ok(())
}

pub use crate::{DeferredBatchTask, ParseTask, ThreadPool};

// ported from: src/bundler/linker_context/writeOutputFilesToDisk.zig
