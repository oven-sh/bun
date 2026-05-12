use crate::mal_prelude::*;
use std::borrow::Cow;
use std::io::Write as _;

use bun_collections::AutoBitSet;
use bun_collections::StringArrayHashMap;
use bun_collections::StringHashMap;
use bun_collections::VecExt;
use bun_core::Environment;
use bun_core::Output;
// PORT NOTE: Zig `bun.threading.ThreadPool` is the *module*; `Batch`/`Task`
// are free types in that module, not associated types on the struct.
use bun_core::String as BunString;
use bun_core::strings;
use bun_paths as path;
use bun_threading::thread_pool as ThreadPoolLib;

use crate::BundleV2;
use crate::Chunk;
use crate::ContentHasher;
use crate::Index;
use crate::analyze_transpiled_module;
use crate::analyze_transpiled_module::StringIDExt as _;
use crate::cheap_prefix_normalizer;
use crate::options;
use crate::options::Loader;
use crate::options::OutputFile;

use crate::CompileResult;
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

/// `bun.BYTECODE_EXTENSION` (bun.zig). Local because `bun_core` doesn't
/// re-export it; matches `bun.rs::bytecode_extension`.
const BYTECODE_EXTENSION: &str = ".jsc";

bun_core::declare_scope!(PartRanges, hidden);

// PORT NOTE: `Chunk.final_rel_path` / `metafile_chunk_json` are owned
// `Box<[u8]>` (Zig stored them as linker-arena `[]const u8`); assignments
// below move the boxed buffer directly — no lifetime promotion needed.
use crate::linker_context_mod::debug;

// TODO(port): Zig's return type is `!if (is_dev_server) void else ArrayList(OutputFile)`.
// Rust const generics cannot vary the return type, so we always return
// `Vec<OutputFile>` and the IS_DEV_SERVER path returns an empty Vec. Phase B may
// split this into two monomorphized wrappers if the unused Vec matters.
pub fn generate_chunks_in_parallel<const IS_DEV_SERVER: bool>(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<Vec<options::OutputFile>, bun_core::Error> {
    let _trace = bun_core::perf::trace("Bundler.generateChunksInParallel");

    c.mangle_local_css();

    let mut has_js_chunk = false;
    let mut has_css_chunk = false;
    let mut has_html_chunk = false;
    debug_assert!(chunks.len() > 0);

    {
        // TODO(@paperclover/bake): instead of running a renamer per chunk, run it per file
        debug!(" START {} renamers", chunks.len());
        // PORT NOTE: Zig `defer debug(...)` is moved to end-of-scope explicitly below.
        let ctx = GenerateChunkCtx {
            chunk: bun_ptr::BackRef::new_mut(&mut chunks[0]),
            // SAFETY: `c` is the live `&mut LinkerContext` for the link step;
            // write provenance preserved.
            c: unsafe { bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(c)) },
            chunks: bun_ptr::BackRef::new_mut(chunks),
        };
        // TODO(port): worker_pool.eachPtr signature — arena param dropped; Rust impl is infallible.
        // SAFETY: `parse_graph` is the `BundleV2.graph` backref (valid for the
        // link step); `pool` is the arena-allocated bundler ThreadPool.
        c.worker_pool()
            .each_ptr(ctx, LinkerContext::generate_js_renamer, chunks);
        debug!("  DONE {} renamers", chunks.len());
    }

    if c.source_maps.line_offset_tasks.len() > 0 {
        debug!(" START {} source maps (line offset)", chunks.len());
        c.source_maps.line_offset_wait_group.wait();
        // PORT NOTE: `c.arena().free(...)` + `.len = 0` → Vec drop semantics.
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

            let mut batch = ThreadPoolLib::Batch::default();
            // PERF(port): was c.arena().alloc — using Vec on global mimalloc
            let mut tasks: Vec<PrepareCssAstTask> = Vec::with_capacity(total_count);
            for chunk in chunks.iter_mut() {
                if chunk.content.is_css() {
                    tasks.push(PrepareCssAstTask {
                        task: ThreadPoolLib::Task {
                            node: ThreadPoolLib::Node::default(),
                            callback: prepare_css_asts_for_chunk,
                        },
                        chunk: std::ptr::from_mut::<Chunk>(chunk),
                        // PORT NOTE: `PrepareCssAstTask.linker` is `*mut LinkerContext<'static>`
                        // (raw ptr is invariant); `.cast()` erases the inner `'a` to satisfy it.
                        linker: std::ptr::from_mut::<LinkerContext>(c).cast(),
                    });
                    // Capacity pre-reserved → push never reallocates → ptr stays stable.
                    let task = tasks.last_mut().unwrap();
                    batch.push(ThreadPoolLib::Batch::from(&raw mut task.task));
                }
            }
            debug_assert_eq!(tasks.len(), total_count);
            // SAFETY: `parse_graph` is the `BundleV2.graph` backref (valid for
            // the link step); `pool` is the arena-allocated bundler ThreadPool.
            let worker_pool = c.worker_pool();
            worker_pool.schedule(batch);
            worker_pool.wait_for_all();

            debug!("  DONE {} prepare CSS ast (total count)", total_count);
        } else if cfg!(debug_assertions) {
            for chunk in chunks.iter() {
                debug_assert!(!chunk.content.is_css());
            }
        }
    }

    {
        // PERF(port): was c.arena().alloc — using Vec on global mimalloc
        let mut chunk_contexts: Vec<GenerateChunkCtx> = Vec::with_capacity(chunks.len());

        {
            let mut total_count: usize = 0;
            // PORT NOTE: `GenerateChunkCtx` fields are raw pointers; capture them
            // before the `iter_mut()` borrow so the same `*mut [Chunk]` can be
            // stored in every ctx (Zig stores `[]Chunk` by value).
            // SAFETY: `c` is the live `&mut LinkerContext` for the link step.
            let c_ref =
                unsafe { bun_ptr::ParentRef::from_raw_mut(std::ptr::from_mut::<LinkerContext>(c)) };
            let chunks_ref: bun_ptr::BackRef<[Chunk]> = bun_ptr::BackRef::new_mut(chunks);
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
            // PERF(port): was c.arena().alloc — using Vec on global mimalloc
            let mut combined_part_ranges: Vec<PendingPartRange> = Vec::with_capacity(total_count);
            // SAFETY: every slot is written via remaining_part_ranges[0] below.
            unsafe { combined_part_ranges.set_len(total_count) };
            let mut remaining_part_ranges: &mut [PendingPartRange] = &mut combined_part_ranges[..];
            let mut batch = ThreadPoolLib::Batch::default();
            for (chunk, chunk_ctx) in chunks.iter_mut().zip(chunk_contexts.iter_mut()) {
                match &chunk.content {
                    crate::chunk::Content::Javascript(js) => {
                        for (i, part_range) in js.parts_in_chunk_in_order.iter().enumerate() {
                            #[cfg(feature = "debug_logs")]
                            {
                                bun_core::scoped_log!(
                                    PartRanges,
                                    "Part Range: {} {} ({}..{})",
                                    bstr::BStr::new(
                                        &c.parse_graph().input_files.items_source()
                                            [part_range.source_index.get()]
                                        .path
                                        .pretty
                                    ),
                                    <&'static str>::from(
                                        c.parse_graph().ast.items_target()
                                            [part_range.source_index.get()]
                                        .bake_graph()
                                    ),
                                    part_range.part_index_begin,
                                    part_range.part_index_end,
                                );
                            }

                            remaining_part_ranges[0] = PendingPartRange {
                                part_range: *part_range,
                                i: u32::try_from(i).expect("int cast"),
                                task: ThreadPoolLib::Task {
                                    node: ThreadPoolLib::Node::default(),
                                    callback: generate_compile_result_for_js_chunk,
                                },
                                // SAFETY: `PendingPartRange.ctx` is `&'a GenerateChunkCtx<'a>`
                                // (Zig: `*GenerateChunkCtx`), conflating the borrow with
                                // LinkerContext's `'a`. Launder via raw ptr so borrowck
                                // doesn't pin `chunk_contexts` for `'a`; tasks complete
                                // before `chunk_contexts` drops (we `wait_for_all` below).
                                ctx: unsafe {
                                    bun_ptr::detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)
                                },
                            };
                            batch.push(ThreadPoolLib::Batch::from(
                                &raw mut remaining_part_ranges[0].task,
                            ));

                            // PORT NOTE: reshaped for borrowck — Zig reslices `remaining_part_ranges[1..]`
                            remaining_part_ranges =
                                &mut core::mem::take(&mut remaining_part_ranges)[1..];
                        }
                    }
                    crate::chunk::Content::Css(css) => {
                        for i in 0..css.imports_in_chunk_in_order.len() as usize {
                            remaining_part_ranges[0] = PendingPartRange {
                                part_range: Default::default(),
                                i: u32::try_from(i).expect("int cast"),
                                task: ThreadPoolLib::Task {
                                    node: ThreadPoolLib::Node::default(),
                                    callback: generate_compile_result_for_css_chunk,
                                },
                                // SAFETY: `PendingPartRange.ctx` is `&'a GenerateChunkCtx<'a>`
                                // (Zig: `*GenerateChunkCtx`), conflating the borrow with
                                // LinkerContext's `'a`. Launder via raw ptr so borrowck
                                // doesn't pin `chunk_contexts` for `'a`; tasks complete
                                // before `chunk_contexts` drops (we `wait_for_all` below).
                                ctx: unsafe {
                                    bun_ptr::detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)
                                },
                            };
                            batch.push(ThreadPoolLib::Batch::from(
                                &raw mut remaining_part_ranges[0].task,
                            ));

                            remaining_part_ranges =
                                &mut core::mem::take(&mut remaining_part_ranges)[1..];
                        }
                    }
                    crate::chunk::Content::Html => {
                        remaining_part_ranges[0] = PendingPartRange {
                            part_range: Default::default(),
                            i: 0,
                            task: ThreadPoolLib::Task {
                                node: ThreadPoolLib::Node::default(),
                                callback: generate_compile_result_for_html_chunk,
                            },
                            // SAFETY: `PendingPartRange.ctx` is `&'a GenerateChunkCtx<'a>`
                            // (Zig: `*GenerateChunkCtx`), conflating the borrow with
                            // LinkerContext's `'a`. Launder via raw ptr so borrowck
                            // doesn't pin `chunk_contexts` for `'a`; tasks complete
                            // before `chunk_contexts` drops (we `wait_for_all` below).
                            ctx: unsafe {
                                bun_ptr::detach_lifetime_ref::<GenerateChunkCtx>(chunk_ctx)
                            },
                        };

                        batch.push(ThreadPoolLib::Batch::from(
                            &raw mut remaining_part_ranges[0].task,
                        ));
                        remaining_part_ranges =
                            &mut core::mem::take(&mut remaining_part_ranges)[1..];
                    }
                }
            }
            // SAFETY: `parse_graph` is the `BundleV2.graph` backref (valid for
            // the link step); `pool` is the arena-allocated bundler ThreadPool.
            let worker_pool = c.worker_pool();
            worker_pool.schedule(batch);
            worker_pool.wait_for_all();
            debug!("  DONE {} compiling part ranges", total_count);
        }

        if c.source_maps.quoted_contents_tasks.len() > 0 {
            debug!(" START {} source maps (quoted contents)", chunks.len());
            c.source_maps.quoted_contents_wait_group.wait();
            c.source_maps.quoted_contents_tasks = Box::default();
            debug!("  DONE {} source maps (quoted contents)", chunks.len());
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
        let mut path_names_map: StringHashMap<()> = StringHashMap::default();

        #[derive(Default)]
        struct DuplicateEntry {
            // `BackRef` (not `*mut`) — entries point at elements of the
            // stack-owned `chunks: &mut [Chunk]` above, which outlives the
            // `duplicates_map`; reads go through safe `Deref`.
            sources: Vec<bun_ptr::BackRef<Chunk>>,
        }
        let mut duplicates_map: StringArrayHashMap<DuplicateEntry> = StringArrayHashMap::default();

        let mut chunk_visit_map = AutoBitSet::init_empty(chunks.len())?;

        // Compute the final hashes of each chunk, then use those to create the final
        // paths of each chunk. This can technically be done in parallel but it
        // probably doesn't matter so much because we're not hashing that much data.
        // PORT NOTE: reshaped for borrowck — index loop so `chunks` can be passed
        // whole to `append_isolated_hashes_for_imported_chunks` and then indexed.
        for index in 0..chunks.len() {
            let mut hash = ContentHasher::default();
            c.append_isolated_hashes_for_imported_chunks(
                &mut hash,
                chunks,
                u32::try_from(index).expect("int cast"),
                &mut chunk_visit_map,
            );
            chunk_visit_map.set_all(false);
            let chunk = &mut chunks[index];
            chunk.template.placeholder.hash = Some(hash.digest());

            let mut rel_path: Vec<u8> = Vec::new();
            // PORT NOTE: use the byte-writer (`PathTemplate::print`) directly —
            // routing through `Display`/`write!` goes via `from_utf8_lossy`,
            // which would replace non-UTF-8 dir bytes with U+FFFD and corrupt
            // the output path. Zig's `std.fmt.allocPrint` writes raw bytes.
            chunk
                .template
                .print(&mut rel_path)
                .expect("write to Vec<u8>");
            path::resolve_path::platform_to_posix_in_place::<u8>(&mut rel_path);

            if path_names_map.get_or_put(&rel_path)?.found_existing {
                // collect all duplicates in a list
                let dup = duplicates_map.get_or_put(&rel_path)?;
                if !dup.found_existing {
                    *dup.value_ptr = DuplicateEntry::default();
                }
                dup.value_ptr.sources.push(bun_ptr::BackRef::new_mut(chunk));
                continue;
            }

            // resolve any /./ and /../ occurrences
            // use resolvePosix since we asserted above all seps are '/'
            #[cfg(windows)]
            if strings::index_of(&rel_path, b"/./").is_some() {
                let mut buf = bun_paths::PathBuffer::uninit();
                let rel_path_fixed: Box<[u8]> = Box::from(&*path::resolve_path::normalize_buf::<
                    path::platform::Posix,
                >(&rel_path, &mut buf));
                chunk.final_rel_path = rel_path_fixed;
                continue;
            }

            chunk.final_rel_path = rel_path.into_boxed_slice();
        }

        if duplicates_map.count() > 0 {
            let mut msg: Vec<u8> = Vec::new();
            // errdefer msg.deinit() — handled by Drop

            let mut entry_naming: Option<&[u8]> = None;
            let mut chunk_naming: Option<&[u8]> = None;
            let mut asset_naming: Option<&[u8]> = None;

            write!(&mut msg, "Multiple files share the same output path\n")?;

            let kinds = c.graph.files.items_entry_point_kind();

            for (key, dup) in duplicates_map
                .keys()
                .iter()
                .zip(duplicates_map.values().iter())
            {
                write!(&mut msg, "  {}:\n", bstr::BStr::new(key))?;
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
                    write!(
                        &mut msg,
                        "    from input {}\n",
                        bstr::BStr::new(&file.path.pretty)
                    )?;
                }
            }

            c.log_mut().add_error(None, bun_ast::Loc::EMPTY, msg);

            // PORT NOTE: Zig `inline for` over a homogeneous tuple → const array + plain for.
            for (name, template) in [
                ("entry", entry_naming),
                ("chunk", chunk_naming),
                ("asset", asset_naming),
            ] {
                let Some(template) = template else { continue };

                let mut text: Vec<u8> = Vec::new();
                write!(
                    &mut text,
                    "{} naming is '{}', consider adding '[hash]' to make filenames unique",
                    name,
                    bstr::BStr::new(template),
                )?;
                c.log_mut().add_msg(bun_ast::Msg {
                    kind: bun_ast::Kind::Note,
                    data: bun_ast::Data {
                        text: Cow::Owned(text),
                        ..Default::default()
                    },
                    ..Default::default()
                });
            }

            return Err(bun_core::err!("DuplicateOutputPath"));
        }
    }

    // After final_rel_path is computed for all chunks, fix up module_info
    // cross-chunk import specifiers. During printing, cross-chunk imports use
    // unique_key placeholders as paths. Now that final paths are known, replace
    // those placeholders with the resolved paths and serialize.
    if c.options.generate_bytecode_cache
        && c.options.output_format == options::Format::Esm
        && c.options.compile
    {
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
                    &c.options.public_path
                };
                let normalizer = cheap_prefix_normalizer(public_path, &ch.final_rel_path);
                let mut resolved: Vec<u8> = Vec::new();
                resolved.extend_from_slice(normalizer[0]);
                resolved.extend_from_slice(normalizer[1]);
                let _ = unique_key_to_path.put(&ch.unique_key, resolved.into_boxed_slice()); // OOM-only Result (Zig: catch unreachable)
            }
        }

        // Fix up each chunk's module_info
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

            // Serialize the fixed-up module_info
            js.module_info_bytes = bun_js_printer::serialize_module_info(Some(mi));

            // Free the ModuleInfo now that it's been serialized to bytes.
            // It was allocated with bun.default_allocator (not the arena),
            // so it must be explicitly destroyed.
            // PORT NOTE: in Rust, dropping the Option<Box<ModuleInfo>> frees it.
            js.module_info = None;
        }
    }

    // Generate metafile JSON fragments for each chunk (after paths are resolved)
    if c.options.metafile {
        // PORT NOTE: reshaped for borrowck — `generate_chunk_json` reads all chunks
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
    let is_standalone = c.options.compile_to_standalone_html;
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
        return Err(bun_core::err!("MultipleOutputFilesWithoutOutputDir"));
    }

    // SAFETY: c points to LinkerContext which is the `linker` field of BundleV2.
    let bundler: &mut BundleV2 =
        unsafe { &mut *LinkerContext::bundle_v2_ptr(std::ptr::from_mut::<LinkerContext>(c)) };
    let mut static_route_visitor = StaticRouteVisitor {
        // SAFETY: Zig stores `c: *LinkerContext` (raw). Launder via raw ptr so this
        // long-lived shared borrow doesn't conflict with `c.log_disjoint()` inside
        // the chunk loop below. `c` outlives `static_route_visitor`.
        c: unsafe { bun_ptr::detach_lifetime_ref::<LinkerContext>(c) },
        cache: bun_collections::ArrayHashMap::default(),
        visited: AutoBitSet::init_empty(c.graph.files.len()).expect("oom"),
    };
    // defer static_route_visitor.deinit() — handled by Drop

    // For standalone mode, resolve JS/CSS chunks so we can inline their content into HTML.
    // Closing tag escaping (</script → <\\/script, </style → <\\/style) is handled during
    // the HTML assembly step in codeWithSourceMapShifts, not here.
    //
    // PORT NOTE: Zig `defer` frees each buffer with `Chunk.IntermediateOutput.allocatorForSize(len)`.
    // Rust `Vec<Option<Box<[u8]>>>` frees via `Drop` (global mimalloc); if `allocatorForSize`
    // returns a distinct arena for large buffers, Phase B must restore matched-arena
    // dealloc here.
    let mut standalone_chunk_contents: Option<Vec<Option<Box<[u8]>>>> = None;

    if is_standalone {
        let mut scc: Vec<Option<Box<[u8]>>> = vec![None; chunks.len()];

        // PORT NOTE: `IntermediateOutput.code_standalone` reads `&Chunk` /
        // `&[Chunk]` (chunk is `&chunks[ci]`). Take `intermediate_output` out
        // by value so the only `&mut` is disjoint from those shared borrows.
        for ci in 0..chunks.len() {
            if matches!(chunks[ci].content, crate::chunk::Content::Html) {
                continue;
            }
            let mut ds: usize = 0;
            // Pass `scc` so that `.asset` pieces (e.g. `import logo from "./logo.svg"` with
            // the file loader) are resolved to data: URIs from `url_for_css` instead of
            // being written as paths to sidecar files that don't exist in standalone mode.
            // Sibling JS/CSS chunks may still be null at this point; `.chunk` pieces fall
            // back to file paths when their entry in `scc` is null, matching the previous
            // behavior for inter-chunk imports.
            let mut intermediate_output = core::mem::take(&mut chunks[ci].intermediate_output);
            let buffer = intermediate_output
                .code_standalone(
                    None,
                    c.parse_graph(),
                    &c.graph,
                    &c.options.public_path,
                    &chunks[ci],
                    chunks,
                    &mut ds,
                    false,
                    false,
                    &scc,
                )?
                .buffer;
            chunks[ci].intermediate_output = intermediate_output;
            scc[ci] = Some(buffer);
        }

        standalone_chunk_contents = Some(scc);
    }

    // Don't write to disk if compile mode is enabled - we need buffer values for compilation
    let is_compile = bundler.transpiler.options.compile;
    if root_path.len() > 0 && !is_compile {
        write_output_files_to_disk(
            c,
            root_path,
            chunks,
            &mut output_files,
            standalone_chunk_contents.as_deref(),
        )?;
    } else {
        // In-memory build (also used for standalone mode)
        // PORT NOTE: `code()` / `code_standalone()` read `chunk` (= `&chunks[i]`)
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
                        source_map_index: None,
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
                &c.options.public_path
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
                    false,
                    false,
                    standalone_chunk_contents.as_deref().unwrap(),
                )?
            } else {
                let force_abs = c.resolver().opts.compile
                    && !chunks[chunk_index_in_chunks_list]
                        .flags
                        .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD);
                let enable_sm = chunks[chunk_index_in_chunks_list]
                    .content
                    .sourcemap(c.options.source_maps)
                    != SourceMapOption::None;
                intermediate_output.code(
                    None,
                    c.parse_graph(),
                    &c.graph,
                    public_path,
                    &chunks[chunk_index_in_chunks_list],
                    chunks,
                    &mut display_size,
                    force_abs,
                    enable_sm,
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
                    .as_ref()
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
                        // TODO(port): Zig uses Chunk.IntermediateOutput.allocatorForSize(total_len)
                        let mut buf: Vec<u8> = Vec::with_capacity(total_len);
                        // PERF(port): was appendSliceAssumeCapacity
                        buf.extend_from_slice(&code_result.buffer);
                        buf.extend_from_slice(source_map_start);
                        buf.extend_from_slice(a);
                        buf.extend_from_slice(b);
                        buf.push(b'\n');

                        // TODO(port): Zig frees old code_result.buffer via allocatorForSize; relying on Drop here.
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
                    // TODO(port): Zig uses Chunk.IntermediateOutput.allocatorForSize(total_len)
                    let mut buf: Vec<u8> = Vec::with_capacity(total_len);

                    // PERF(port): was appendSliceAssumeCapacity
                    buf.extend_from_slice(&code_result.buffer);
                    buf.extend_from_slice(source_map_start);

                    let old_len = buf.len();
                    // Capacity reserved above; resize zero-fills then base64 overwrites.
                    buf.resize(old_len + encode_len, 0);
                    let _ = bun_base64::encode(&mut buf[old_len..], &output_source_map);

                    buf.push(b'\n');
                    // TODO(port): Zig frees old code_result.buffer via allocatorForSize; relying on Drop here.
                    code_result.buffer = buf.into_boxed_slice();
                    drop(output_source_map);
                }
                SourceMapOption::None => {}
            }

            // Compute side early so it can be used for bytecode, module_info, and main chunk output files
            let side: options::Side = if matches!(chunk.content, crate::chunk::Content::Css(_))
                || chunk
                    .flags
                    .contains(crate::chunk::Flags::IS_BROWSER_CHUNK_FROM_SERVER_BUILD)
            {
                options::Side::Client
            } else {
                match c.graph.ast.items_target()[chunk.entry_point.source_index() as usize] {
                    options::Target::Browser => options::Side::Client,
                    _ => options::Side::Server,
                }
            };

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
                        let source_provider_url = if c.options.compile {
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
                        source_provider_url.ref_();
                        // RAII: `defer source_provider_url.deref()` — `OwnedString::Drop`
                        // releases the ref bumped above on every exit path (incl. `break 'brk`).
                        let mut source_provider_url =
                            bun_core::OwnedString::new(source_provider_url);

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
                                hash: if chunk.template.placeholder.hash.is_some() {
                                    Some(bun_wyhash::hash(&bytecode))
                                } else {
                                    None
                                },
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
                            // logger OOM-only (Zig: catch unreachable)
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
                if c.options.generate_bytecode_cache
                    && c.options.output_format == options::Format::Esm
                    && c.options.compile
                {
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
                                        hash: if chunk.template.placeholder.hash.is_some() {
                                            Some(bun_wyhash::hash(module_info_bytes))
                                        } else {
                                            None
                                        },
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

            let output_kind = if matches!(chunk.content, crate::chunk::Content::Css(_)) {
                options::OutputKind::Asset
            } else if chunk.entry_point.is_entry_point() {
                c.graph.files.items_entry_point_kind()[chunk.entry_point.source_index() as usize]
                    .output_kind()
            } else {
                options::OutputKind::Chunk
            };

            let chunk_index =
                output_files.insert_for_chunk(options::OutputFile::init(options::OutputFileInit {
                    data: options::OutputFileData::Buffer {
                        data: code_result.buffer,
                        // TODO(port): Zig stores Chunk.IntermediateOutput.allocatorForSize(len) for matched dealloc.
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
                        // Zig: `@ptrCast(dupe(u32, js.css_chunks))` — `output_file::Index`
                        // is `#[repr(transparent)]` over u32.
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

                        let mut extra = BakeExtra::default();
                        extra.bake_is_runtime = chunk
                            .files_with_parts_in_chunk
                            .contains(&Index::RUNTIME.get());
                        if output_kind == options::OutputKind::EntryPoint
                            && side == options::Side::Server
                        {
                            extra.is_route = true;
                            extra.fully_static = !static_route_visitor
                                .has_transitive_use_client(chunk.entry_point.source_index());
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

    if is_standalone {
        // For standalone mode, filter to only HTML output files.
        // Deinit dropped items to free their heap allocations (paths, buffers).
        let mut result = output_files.take();
        let mut write_idx: usize = 0;
        // PORT NOTE: reshaped for borrowck — Zig iterates by pointer and assigns into items[write_idx].
        let len = result.len();
        for i in 0..len {
            if result[i].loader == Loader::Html {
                result.swap(write_idx, i);
                // PORT NOTE: Zig copies item then leaves original; using swap keeps semantics
                // (the slot at `i` will be truncated/dropped below).
                write_idx += 1;
            }
            // else: item at `i` will be dropped by truncate below (impl Drop handles deinit)
        }
        result.truncate(write_idx);
        return Ok(result);
    }

    Ok(output_files.take())
}

pub use crate::ThreadPool;

// TODO(port): narrow error set
use crate::EntryPoint;
use crate::options::SourceMapOption;
use crate::output_file::BakeExtra;

// ported from: src/bundler/linker_context/generateChunksInParallel.zig
