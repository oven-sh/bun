use core::mem::offset_of;

use bun_alloc::Arena; // bumpalo::Bump re-export
use bun_collections::{ArrayHashMap, AutoBitSet, BabyList};
use bun_core::fmt as bun_fmt;
use bun_paths::{self as resolve_path, PathBuffer};
use bun_sourcemap::SourceMapPieces;
use bun_str::strings;
use bun_wyhash::{self, Wyhash};

use crate::options::PathTemplate;
use crate::{BundleV2, Chunk, Fs, Index, LinkerContext};

// TODO(port): narrow error set
#[inline(never)]
pub fn compute_chunks(
    this: &mut LinkerContext,
    unique_key: u64,
) -> Result<Box<[Chunk]>, bun_core::Error> {
    let _trace = bun_core::perf::trace("Bundler.computeChunks");

    debug_assert!(this.dev_server.is_none()); // use

    // PERF(port): was stack-fallback (std.heap.stackFallback(4096, ...)) — profile in Phase B
    // PERF(port): was arena bulk-free — temp allocations freed at end of fn
    let arena = Arena::new();
    let temp = &arena;

    // TODO(port): StringArrayHashMap keyed by arena-allocated &[u8]; using ArrayHashMap<&[u8], Chunk> here.
    let mut js_chunks: ArrayHashMap<&[u8], Chunk> = ArrayHashMap::new();
    js_chunks.reserve(this.graph.entry_points.len());

    // Key is the hash of the CSS order. This deduplicates identical CSS files.
    let mut css_chunks: ArrayHashMap<u64, Chunk> = ArrayHashMap::new();
    let mut js_chunks_with_css: usize = 0;

    // Maps entry point IDs to their index in js_chunks.values().
    // CSS-only entry points that skip JS chunk creation get maxInt as sentinel.
    let entry_point_to_js_chunk_idx: &mut [u32] =
        temp.alloc_slice_fill_copy(this.graph.entry_points.len(), u32::MAX);

    let entry_source_indices = this.graph.entry_points.items().source_index;
    let css_asts = this.graph.ast.items().css;
    let mut html_chunks: ArrayHashMap<&[u8], Chunk> = ArrayHashMap::new();
    let loaders = this.parse_graph.input_files.items().loader;
    let ast_targets = this.graph.ast.items().target;

    let code_splitting = this.graph.code_splitting;
    let could_be_browser_target_from_server_build = this.options.target.is_server_side()
        && this.parse_graph.html_imports.html_source_indices.len() > 0;
    let has_server_html_imports =
        this.parse_graph.html_imports.server_source_indices.len() > 0;

    // Create chunks for entry points
    for (entry_id_, &source_index) in entry_source_indices.iter().enumerate() {
        let entry_bit = entry_id_ as chunk::EntryPointId; // @truncate

        let entry_bits = &mut this.graph.files.items_mut().entry_bits[source_index as usize];
        entry_bits.set(entry_bit);

        let has_html_chunk = loaders[source_index as usize] == Loader::Html;

        // For code splitting, entry point chunks should be keyed by ONLY the entry point's
        // own bit, not the full entry_bits. This ensures that if an entry point file is
        // reachable from other entry points (e.g., via re-exports), its content goes into
        // a shared chunk rather than staying in the entry point's chunk.
        // https://github.com/evanw/esbuild/blob/cd832972927f1f67b6d2cc895c06a8759c1cf309/internal/linker/linker.go#L3882
        let mut entry_point_chunk_bits =
            AutoBitSet::init_empty(this.graph.entry_points.len())?;
        entry_point_chunk_bits.set(entry_bit);

        let js_chunk_key: &[u8] = 'brk: {
            if code_splitting {
                break 'brk temp
                    .alloc_slice_copy(entry_point_chunk_bits.bytes(this.graph.entry_points.len()));
            } else {
                // Force HTML chunks to always be generated, even if there's an identical JS file.
                // PORT NOTE: Zig used a Formatter struct; build the byte key directly since
                // entry_bits is arbitrary bytes (not UTF-8) and cannot go through fmt::Display.
                let mut v = bumpalo::collections::Vec::new_in(temp);
                v.push((!has_html_chunk) as u8);
                v.extend_from_slice(entry_bits.bytes(this.graph.entry_points.len()));
                break 'brk v.into_bump_slice();
            }
        };

        // Put this early on in this loop so that CSS-only entry points work.
        if has_html_chunk {
            let html_chunk_entry = html_chunks.get_or_put(js_chunk_key)?;
            if !html_chunk_entry.found_existing {
                *html_chunk_entry.value_ptr = Chunk {
                    entry_point: chunk::EntryPoint {
                        entry_point_id: entry_bit,
                        source_index,
                        is_entry_point: true,
                    },
                    entry_bits: entry_point_chunk_bits.clone(),
                    content: chunk::Content::Html,
                    output_source_map: SourceMapPieces::init(),
                    flags: chunk::Flags {
                        is_browser_chunk_from_server_build:
                            could_be_browser_target_from_server_build
                                && ast_targets[source_index as usize] == Target::Browser,
                        ..Default::default()
                    },
                    ..Default::default()
                };
            }
        }

        if css_asts[source_index as usize].is_some() {
            let order =
                this.find_imported_files_in_css_order(temp, &[Index::init(source_index)]);
            // Create a chunk for the entry point here to ensure that the chunk is
            // always generated even if the resulting file is empty
            let hash_to_use = if !this.options.css_chunking {
                bun_wyhash::hash(
                    temp.alloc_slice_copy(entry_bits.bytes(this.graph.entry_points.len())),
                )
            } else {
                let mut hasher = Wyhash::init(5);
                bun_core::write_any_to_hasher(&mut hasher, order.len());
                for x in order.slice() {
                    x.hash(&mut hasher);
                }
                hasher.final_()
            };
            let css_chunk_entry = css_chunks.get_or_put(hash_to_use)?;
            if !css_chunk_entry.found_existing {
                // const css_chunk_entry = try js_chunks.getOrPut();
                let order_len = order.len() as usize;
                *css_chunk_entry.value_ptr = Chunk {
                    entry_point: chunk::EntryPoint {
                        entry_point_id: entry_bit,
                        source_index,
                        is_entry_point: true,
                    },
                    entry_bits: entry_point_chunk_bits,
                    content: chunk::Content::Css(chunk::Css {
                        imports_in_chunk_in_order: order,
                        asts: vec![bun_css::BundlerStyleSheet::default(); order_len]
                            .into_boxed_slice(),
                        ..Default::default()
                    }),
                    output_source_map: SourceMapPieces::init(),
                    flags: chunk::Flags {
                        has_html_chunk,
                        is_browser_chunk_from_server_build:
                            could_be_browser_target_from_server_build
                                && ast_targets[source_index as usize] == Target::Browser,
                        ..Default::default()
                    },
                    ..Default::default()
                };
            }

            continue;
        }

        // Create a chunk for the entry point here to ensure that the chunk is
        // always generated even if the resulting file is empty
        let js_chunk_entry = js_chunks.get_or_put(js_chunk_key)?;
        entry_point_to_js_chunk_idx[entry_id_] =
            u32::try_from(js_chunk_entry.index).unwrap();
        *js_chunk_entry.value_ptr = Chunk {
            entry_point: chunk::EntryPoint {
                entry_point_id: entry_bit,
                source_index,
                is_entry_point: true,
            },
            entry_bits: entry_point_chunk_bits,
            content: chunk::Content::Javascript(chunk::Javascript::default()),
            output_source_map: SourceMapPieces::init(),
            flags: chunk::Flags {
                has_html_chunk,
                is_browser_chunk_from_server_build: could_be_browser_target_from_server_build
                    && ast_targets[source_index as usize] == Target::Browser,
                ..Default::default()
            },
            ..Default::default()
        };

        {
            // If this JS entry point has an associated CSS entry point, generate it
            // now. This is essentially done by generating a virtual CSS file that
            // only contains "@import" statements in the order that the files were
            // discovered in JS source order, where JS source order is arbitrary but
            // consistent for dynamic imports. Then we run the CSS import order
            // algorithm to determine the final CSS file order for the chunk.
            let css_source_indices =
                this.find_imported_css_files_in_js_order(temp, Index::init(source_index));
            if css_source_indices.len() > 0 {
                let order =
                    this.find_imported_files_in_css_order(temp, css_source_indices.slice());

                // Always use content-based hashing for CSS chunk deduplication.
                // This ensures that when multiple JS entry points import the
                // same CSS files, they share a single CSS output chunk rather
                // than producing duplicates that collide on hash-based naming.
                let hash_to_use = {
                    let mut hasher = Wyhash::init(5);
                    bun_core::write_any_to_hasher(&mut hasher, order.len());
                    for x in order.slice() {
                        x.hash(&mut hasher);
                    }
                    hasher.final_()
                };

                let css_chunk_entry = css_chunks.get_or_put(hash_to_use)?;

                js_chunk_entry
                    .value_ptr
                    .content
                    .javascript_mut()
                    .css_chunks =
                    Box::<[u32]>::from([u32::try_from(css_chunk_entry.index).unwrap()].as_slice());
                js_chunks_with_css += 1;

                if !css_chunk_entry.found_existing {
                    let order_len = order.len() as usize;
                    let mut css_files_with_parts_in_chunk: ArrayHashMap<index::Int, usize> =
                        ArrayHashMap::new();
                    for entry in order.slice() {
                        if let chunk::CssImportKind::SourceIndex(si) = entry.kind {
                            css_files_with_parts_in_chunk
                                .put(si.get(), 0)
                                .expect("oom");
                        }
                    }
                    *css_chunk_entry.value_ptr = Chunk {
                        entry_point: chunk::EntryPoint {
                            entry_point_id: entry_bit,
                            source_index,
                            is_entry_point: true,
                        },
                        entry_bits: entry_bits.clone(),
                        content: chunk::Content::Css(chunk::Css {
                            imports_in_chunk_in_order: order,
                            asts: vec![bun_css::BundlerStyleSheet::default(); order_len]
                                .into_boxed_slice(),
                            ..Default::default()
                        }),
                        files_with_parts_in_chunk: css_files_with_parts_in_chunk,
                        output_source_map: SourceMapPieces::init(),
                        flags: chunk::Flags {
                            has_html_chunk,
                            is_browser_chunk_from_server_build:
                                could_be_browser_target_from_server_build
                                    && ast_targets[source_index as usize] == Target::Browser,
                            ..Default::default()
                        },
                        ..Default::default()
                    };
                }
            }
        }
    }
    // PORT NOTE: reshaped for borrowck — re-borrow file_entry_bits after the loop above mutated it
    let file_entry_bits: &mut [AutoBitSet] = this.graph.files.items_mut().entry_bits;

    let css_reprs = this.graph.ast.items().css;

    // Figure out which JS files are in which chunk
    if js_chunks.count() > 0 {
        for source_index in this.graph.reachable_files.iter() {
            if this.graph.files_live.is_set(source_index.get()) {
                if this.graph.ast.items().css[source_index.get() as usize].is_none() {
                    let entry_bits: &AutoBitSet =
                        &file_entry_bits[source_index.get() as usize];
                    if css_reprs[source_index.get() as usize].is_some() {
                        continue;
                    }

                    if this.graph.code_splitting {
                        let js_chunk_key = temp.alloc_slice_copy(
                            entry_bits.bytes(this.graph.entry_points.len()),
                        );
                        let js_chunk_entry = js_chunks.get_or_put(js_chunk_key)?;

                        if !js_chunk_entry.found_existing {
                            let is_browser_chunk_from_server_build =
                                could_be_browser_target_from_server_build
                                    && ast_targets[source_index.get() as usize]
                                        == Target::Browser;
                            *js_chunk_entry.value_ptr = Chunk {
                                entry_bits: entry_bits.clone(),
                                entry_point: chunk::EntryPoint {
                                    source_index: source_index.get(),
                                    ..Default::default()
                                },
                                content: chunk::Content::Javascript(
                                    chunk::Javascript::default(),
                                ),
                                output_source_map: SourceMapPieces::init(),
                                flags: chunk::Flags {
                                    is_browser_chunk_from_server_build,
                                    ..Default::default()
                                },
                                ..Default::default()
                            };
                        } else if could_be_browser_target_from_server_build
                            && !js_chunk_entry.value_ptr.entry_point.is_entry_point
                            && !js_chunk_entry
                                .value_ptr
                                .flags
                                .is_browser_chunk_from_server_build
                            && ast_targets[source_index.get() as usize] == Target::Browser
                        {
                            // If any file in the chunk has browser target, mark the whole chunk as browser.
                            // This handles the case where a lazy-loaded chunk (code splitting chunk, not entry point)
                            // contains browser-targeted files but was first created by a non-browser file.
                            // We only apply this to non-entry-point chunks to preserve the correct side for server entry points.
                            js_chunk_entry
                                .value_ptr
                                .flags
                                .is_browser_chunk_from_server_build = true;
                        }

                        let entry = js_chunk_entry
                            .value_ptr
                            .files_with_parts_in_chunk
                            .get_or_put(source_index.get() as u32)
                            .expect("unreachable");
                        if !entry.found_existing {
                            *entry.value_ptr = 0; // Initialize byte count to 0
                        }
                    } else {
                        // PORT NOTE: Zig used a local `Handler` struct passed to entry_bits.forEach;
                        // in Rust we pass a closure capturing the same state.
                        let chunks = js_chunks.values_mut();
                        let source_id = source_index.get();
                        let map = &*entry_point_to_js_chunk_idx;
                        entry_bits.for_each(|entry_point_id: usize| {
                            // Map the entry point ID to the actual JS chunk index.
                            // CSS-only entry points don't have JS chunks (sentinel value).
                            let chunk_idx = map[entry_point_id];
                            if chunk_idx == u32::MAX {
                                return;
                            }

                            let entry = chunks[chunk_idx as usize]
                                .files_with_parts_in_chunk
                                .get_or_put(source_id as u32)
                                .expect("unreachable");
                            if !entry.found_existing {
                                *entry.value_ptr = 0; // Initialize byte count to 0
                            }
                        });
                    }
                }
            }
        }
    }

    // Sort the chunks for determinism. This matters because we use chunk indices
    // as sorting keys in a few places.
    let chunks: &mut [Chunk] = 'sort_chunks: {
        let mut sorted_chunks = BabyList::<Chunk>::with_capacity(
            js_chunks.count() + css_chunks.count() + html_chunks.count(),
        )?;

        let mut sorted_keys = BabyList::<&[u8]>::with_capacity_in(temp, js_chunks.count())?;

        // PERF(port): was assume_capacity
        sorted_keys.extend_from_slice(js_chunks.keys());

        // sort by entry_point_id to ensure the main entry point (id=0) comes first,
        // then by key for determinism among the rest.
        struct ChunkSortContext<'a> {
            chunks: &'a ArrayHashMap<&'a [u8], Chunk>,
        }

        impl<'a> ChunkSortContext<'a> {
            fn less_than(&self, a_key: &[u8], b_key: &[u8]) -> bool {
                let Some(a_chunk) = self.chunks.get(a_key) else { return true };
                let Some(b_chunk) = self.chunks.get(b_key) else { return false };
                let a_id = a_chunk.entry_point.entry_point_id;
                let b_id = b_chunk.entry_point.entry_point_id;

                // Main entry point (id=0) always comes first
                if a_id == 0 && b_id != 0 {
                    return true;
                }
                if b_id == 0 && a_id != 0 {
                    return false;
                }

                // Otherwise sort alphabetically by key for determinism
                strings::order(a_key, b_key) == core::cmp::Ordering::Less
            }
        }

        let ctx = ChunkSortContext { chunks: &js_chunks };
        sorted_keys.sort_by(|a, b| {
            if ctx.less_than(a, b) {
                core::cmp::Ordering::Less
            } else {
                core::cmp::Ordering::Greater
            }
        });
        let mut js_chunk_indices_with_css =
            BabyList::<u32>::with_capacity_in(temp, js_chunks_with_css)?;
        for &key in sorted_keys.slice() {
            let chunk = js_chunks.get(key).expect("unreachable");

            if chunk.content.javascript().css_chunks.len() > 0 {
                // PERF(port): was assume_capacity
                js_chunk_indices_with_css.push(sorted_chunks.len());
            }

            // PERF(port): was assume_capacity
            sorted_chunks.push(chunk.clone());

            // Attempt to order the JS HTML chunk immediately after the non-html one.
            if chunk.flags.has_html_chunk {
                if let Some(html_chunk) = html_chunks.fetch_swap_remove(key) {
                    // PERF(port): was assume_capacity
                    sorted_chunks.push(html_chunk.value);
                }
            }
        }

        if css_chunks.count() > 0 {
            let sorted_css_keys: &mut [u64] = temp.alloc_slice_copy(css_chunks.keys());
            sorted_css_keys.sort_unstable();

            // A map from the index in `css_chunks` to it's final index in `sorted_chunks`
            let remapped_css_indexes: &mut [u32] =
                temp.alloc_slice_fill_copy(css_chunks.count(), 0u32);

            let css_chunk_values = css_chunks.values();
            // Use sorted_chunks.len as the starting index because HTML chunks
            // may be interleaved with JS chunks, so js_chunks.count() would be
            // incorrect when HTML entry points are present.
            for (sorted_index, &key) in
                (sorted_chunks.len() as usize..).zip(sorted_css_keys.iter())
            {
                let index = css_chunks.get_index(key).expect("unreachable");
                // PERF(port): was assume_capacity
                sorted_chunks.push(css_chunk_values[index].clone());
                remapped_css_indexes[index] = u32::try_from(sorted_index).unwrap();
            }

            // Update all affected JS chunks to point at the correct CSS chunk index.
            for &js_index in js_chunk_indices_with_css.slice() {
                for idx in sorted_chunks.slice_mut()[js_index as usize]
                    .content
                    .javascript_mut()
                    .css_chunks
                    .iter_mut()
                {
                    *idx = remapped_css_indexes[*idx as usize];
                }
            }
        }

        // We don't care about the order of the HTML chunks that have no JS chunks.
        sorted_chunks.extend_from_slice(html_chunks.values())?;

        break 'sort_chunks sorted_chunks.into_slice_mut();
        // TODO(port): BabyList::into_slice_mut() — need owned mutable slice that lives past this block
    };

    let entry_point_chunk_indices: &mut [u32] =
        this.graph.files.items_mut().entry_point_chunk_index;
    // Map from the entry point file to this chunk. We will need this later if
    // a file contains a dynamic import to this entry point, since we'll need
    // to look up the path for this chunk to use with the import.
    for (chunk_id, chunk) in chunks.iter_mut().enumerate() {
        if chunk.entry_point.is_entry_point {
            // JS entry points that import CSS files generate two chunks, a JS chunk
            // and a CSS chunk. Don't link the CSS chunk to the JS file since the CSS
            // chunk is secondary (the JS chunk is primary).
            if matches!(chunk.content, chunk::Content::Css(_))
                && css_asts[chunk.entry_point.source_index as usize].is_none()
            {
                continue;
            }
            entry_point_chunk_indices[chunk.entry_point.source_index as usize] =
                u32::try_from(chunk_id).unwrap();
        }
    }

    // Determine the order of JS files (and parts) within the chunk ahead of time
    this.find_all_imported_parts_in_js_order(temp, chunks)?;

    // Handle empty chunks case
    if chunks.is_empty() {
        this.unique_key_buf = b"";
        return Ok(Box::from(chunks));
    }

    // TODO(port): std.fmt.count — compute formatted byte length without allocating
    let unique_key_item_len = bun_fmt::count(format_args!(
        "{}C{:08}",
        bun_fmt::hex_int_lower(unique_key),
        chunks.len()
    ));
    let mut unique_key_builder =
        bun_str::StringBuilder::with_capacity(unique_key_item_len * chunks.len())?;
    this.unique_key_buf = unique_key_builder.allocated_slice();

    // errdefer: roll back unique_key_buf on failure (unique_key_builder is an owned local; Drop frees it)
    let guard = scopeguard::guard(&mut this.unique_key_buf, |buf| {
        *buf = b"";
    });

    let kinds = this.graph.files.items().entry_point_kind;
    let output_paths = this.graph.entry_points.items().output_path;
    // SAFETY: this points to LinkerContext which is the `linker` field of BundleV2
    let bv2: &mut BundleV2 = unsafe {
        &mut *((this as *mut LinkerContext as *mut u8)
            .sub(offset_of!(BundleV2, linker))
            .cast::<BundleV2>())
    };
    for (chunk_id, chunk) in chunks.iter_mut().enumerate() {
        // Assign a unique key to each chunk. This key encodes the index directly so
        // we can easily recover it later without needing to look it up in a map. The
        // last 8 numbers of the key are the chunk index.
        chunk.unique_key = unique_key_builder.fmt(format_args!(
            "{}C{:08}",
            bun_fmt::hex_int_lower(unique_key),
            chunk_id
        ));
        if this.unique_key_prefix.is_empty() {
            this.unique_key_prefix = &chunk.unique_key
                [0..bun_fmt::count(format_args!("{}", bun_fmt::hex_int_lower(unique_key)))];
        }

        if chunk.entry_point.is_entry_point
            && (matches!(chunk.content, chunk::Content::Html)
                || (kinds[chunk.entry_point.source_index as usize]
                    == EntryPointKind::UserSpecified
                    && !chunk.flags.has_html_chunk))
        {
            // Use fileWithTarget template if there are HTML imports and user hasn't manually set naming
            if has_server_html_imports && bv2.transpiler.options.entry_naming.is_empty() {
                chunk.template = PathTemplate::FILE_WITH_TARGET;
            } else {
                chunk.template = PathTemplate::FILE;
                if chunk.flags.is_browser_chunk_from_server_build {
                    chunk.template.data =
                        bv2.transpiler_for_target(Target::Browser).options.entry_naming.clone();
                } else {
                    chunk.template.data = bv2.transpiler.options.entry_naming.clone();
                }
            }
        } else {
            if has_server_html_imports && bv2.transpiler.options.chunk_naming.is_empty() {
                chunk.template = PathTemplate::CHUNK_WITH_TARGET;
            } else {
                chunk.template = PathTemplate::CHUNK;
                if chunk.flags.is_browser_chunk_from_server_build {
                    chunk.template.data =
                        bv2.transpiler_for_target(Target::Browser).options.chunk_naming.clone();
                } else {
                    chunk.template.data = bv2.transpiler.options.chunk_naming.clone();
                }
            }
        }

        let pathname =
            Fs::PathName::init(output_paths[chunk.entry_point.entry_point_id as usize].slice());
        chunk.template.placeholder.name = pathname.base;
        chunk.template.placeholder.ext = chunk.content.ext();

        if chunk.template.needs(PathTemplatePlaceholder::Target) {
            // Determine the target from the AST of the entry point source
            let chunk_target = ast_targets[chunk.entry_point.source_index as usize];
            chunk.template.placeholder.target = match chunk_target {
                Target::Browser => b"browser",
                Target::Bun => b"bun",
                Target::Node => b"node",
                Target::BunMacro => b"macro",
                Target::BakeServerComponentsSsr => b"ssr",
            };
        }

        if chunk.template.needs(PathTemplatePlaceholder::Dir) {
            // this if check is a specific fix for `bun build hi.ts --external '*'`, without leading `./`
            let dir_path: &[u8] = if !pathname.dir.is_empty() {
                pathname.dir
            } else {
                b"."
            };
            let mut real_path_buf = PathBuffer::uninit();
            let dir: &[u8] = 'dir: {
                let Ok(dir_fd) = bun_sys::openat_a(
                    bun_sys::Fd::cwd(),
                    dir_path,
                    bun_sys::O::PATH | bun_sys::O::DIRECTORY,
                    0,
                ) else {
                    break 'dir bun_paths::normalize_buf(
                        dir_path,
                        &mut real_path_buf,
                        bun_paths::Platform::Auto,
                    );
                };
                // PORT NOTE: defer dir.close() — Fd closes on Drop at scope end

                match dir_fd.get_fd_path(&mut real_path_buf) {
                    Ok(p) => break 'dir p,
                    Err(err) => {
                        this.log.add_error_fmt(
                            None,
                            bun_logger::Loc::EMPTY,
                            format_args!(
                                "{}: Failed to get full path for directory '{}'",
                                err.name(),
                                bstr::BStr::new(dir_path)
                            ),
                        )?;
                        return Err(bun_core::err!("BuildFailed"));
                    }
                }
            };

            chunk.template.placeholder.dir =
                resolve_path::relative_alloc(this.resolver.opts.root_dir, dir)?;
        }
    }

    // Disarm errdefer guard on success
    let _ = scopeguard::ScopeGuard::into_inner(guard);

    Ok(Box::from(chunks))
    // TODO(port): return type — Zig returns []Chunk allocated by this.allocator(); here we return Box<[Chunk]>.
    // Phase B: confirm ownership of `chunks` slice (sorted_chunks BabyList backing storage).
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// Local type aliases referenced above (Phase B: verify exact module paths)
use crate::chunk;
use crate::index;
use crate::options::{Loader, Target};
use crate::EntryPointKind;
use crate::PathTemplatePlaceholder;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/computeChunks.zig (503 lines)
//   confidence: medium
//   todos:      5
//   notes:      Heavy borrowck reshaping needed in Phase B (MultiArrayList .items() borrows overlap with &mut this); arena-keyed ArrayHashMap<&[u8],_> lifetimes; sorted_chunks BabyList ownership for return value.
// ──────────────────────────────────────────────────────────────────────────
