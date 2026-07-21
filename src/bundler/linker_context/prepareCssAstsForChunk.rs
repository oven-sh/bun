use crate::mal_prelude::*;

use bun_alloc::{Arena as Bump, ArenaVec, ArenaVecExt};
use bun_threading::thread_pool as ThreadPoolLib;

use crate::{BundleV2, Chunk, LinkerContext};

use crate::bun_css::css_parser::{
    BundlerCssRule, BundlerCssRuleList, BundlerLayerBlockRule, BundlerMediaRule,
    BundlerSupportsRule, ImportRule, LayerName, LayerStatementRule, Location, ParserOptions,
    SmallList,
};
use crate::bun_css::{BundlerStyleSheet, ImportConditions, ImportInfo, PrinterOptions, Targets};
use crate::bun_fs::Path;
use bun_ast::{ImportKind, ImportRecord, ImportRecordFlags, ImportRecordTag, Index as AstIndex};
use bun_ast::{Loc, Range};
use bun_collections::VecExt;
use bun_core::strings;
use bun_resolver::DataURL;

use crate::chunk::{Content, CssImportOrderKind};

// Raw pointers rather than `&mut` / `&` so that
// (a) the container_of `container_of` recovery of `*mut BundleV2` from
// `linker` retains write provenance over the whole bundle, and (b) multiple
// tasks may hold pointers to the same `LinkerContext` concurrently without
// materializing aliased Rust references.
pub struct PrepareCssAstTask {
    pub task: ThreadPoolLib::Task,
    pub chunk: *mut Chunk,
    pub linker: *mut LinkerContext<'static>,
}

// SAFETY: scheduled on the worker pool via raw `*mut Task` (bypassing the
// `OwnedTask: Send` route). Both raw-ptr fields point at `Send` types
// (`Chunk: Send`, `LinkerContext: Send`); the callback writes only the
// per-chunk `chunk.content.css` cell (see `prepare_css_asts_for_chunk`
// CONCURRENCY note).
unsafe impl Send for PrepareCssAstTask {}

// CONCURRENCY: thread-pool callback — runs on worker threads, one task per
// CSS chunk. Writes: `chunk.content.css.{asts, ordered_import_records}`
// (per-chunk disjoint via `*mut Chunk`). Reads `linker.parse_graph`
// SoA columns + `linker.graph.ast.css` shared. Every CSS chunk gets exactly
// one task, so `&mut *chunk` is unique; `linker` is shared across all tasks
// and is therefore borrowed as `&LinkerContext` (the impl only reads `c` and
// only ever writes `chunk`). `PrepareCssAstTask` is `Send` by virtue of
// `LinkerContext: Send` + `Chunk: Send` (both raw-ptr fields point at types
// with `unsafe impl Send`).
/// # Safety
///
/// `task` must be the intrusive `task` field of a live [`PrepareCssAstTask`]
/// scheduled by `generate_chunks_in_parallel`. Matches the
/// `Task::callback: unsafe fn(*mut Task)` contract.
pub unsafe fn prepare_css_asts_for_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` points to `PrepareCssAstTask.task` (intrusive thread-pool
    // node); the thread pool hands us exclusive access for the callback's
    // duration. We only read the two raw-pointer fields.
    let prepare_css_asts: &PrepareCssAstTask =
        unsafe { &*bun_core::from_field_ptr!(PrepareCssAstTask, task, task) };
    let linker: *mut LinkerContext = prepare_css_asts.linker;
    let chunk: *mut Chunk = prepare_css_asts.chunk;
    let worker = {
        // SAFETY: `linker` is a raw `*mut` to `BundleV2.linker` (embedded by value),
        // carrying provenance over the full `BundleV2` allocation. Recover the
        // parent via container_of. `Worker::get` only needs `&BundleV2`.
        let bundle_v2: &BundleV2 = unsafe { &*LinkerContext::bundle_v2_ptr(linker) };
        ThreadPool::Worker::get(bundle_v2)
    };
    let worker = scopeguard::guard(worker, |w| w.unget());

    // SAFETY: `linker` outlives this task (owned by the bundle) and is shared
    // across every concurrently-running `PrepareCssAstTask`, so it must be a
    // shared `&LinkerContext` — never `&mut`, which would alias across worker
    // threads. Each CSS chunk gets exactly one `PrepareCssAstTask` (see
    // generateChunksInParallel.rs), so `&mut *chunk` is unique. `worker.arena`
    // was initialized in `Worker::create()` and points at the worker's heap
    // arena.
    prepare_css_asts_for_chunk_impl(unsafe { &*linker }, unsafe { &mut *chunk }, worker.arena());
}

fn prepare_css_asts_for_chunk_impl(c: &LinkerContext, chunk: &mut Chunk, bump: &Bump) {
    // SAFETY: parse_graph backref; raw deref because `parse_graph` is held
    // across the log write below (split borrow).
    let parse_graph = unsafe { &*c.parse_graph };
    let asts = c.graph.ast.items_css();

    // Prepare CSS asts
    // Remove duplicate rules across files. This must be done in serial, not
    // in parallel, and must be done from the last rule to the first rule.
    {
        // Every `chunk.content.css.*` access
        // re-enters the `Content` enum and re-borrows `chunk.content` as a whole, which
        // would alias the live `&mut entry`. Destructure the variant once so borrowck
        // can split the disjoint `CssChunk` struct fields (`imports_in_chunk_in_order`
        // vs `asts`) without raw pointers.
        let Content::Css(css_chunk) = &mut chunk.content else {
            unreachable!()
        };
        let mut i: usize = css_chunk.imports_in_chunk_in_order.len() as usize;
        while i != 0 {
            i -= 1;
            let entry = css_chunk.imports_in_chunk_in_order.mut_(i);
            // Reshaped for borrowck — match on entry.kind while also touching
            // entry.conditions / entry.condition_import_records relies on disjoint field borrows.
            match &mut entry.kind {
                CssImportOrderKind::Layers(layers) => {
                    let inner = layers.inner();
                    let len = inner.len();
                    let rules = if len > 0 {
                        // The `Chunk::Layers` payload is the lifetime-erased shadow
                        // `bun_css::LayerName { v: Vec<Box<[u8]>> }`,
                        // not the real `css_parser::LayerName { v: SmallList<&'static [u8],1> }`,
                        // so the layouts differ. Rebuild the real list element-by-element;
                        // segments are arena-owned (`'bump`-laundered to `'static`) so the
                        // `&[u8]` reborrows below are valid for the chunk lifetime.
                        //
                        // Both `SmallList` levels go into the arena-backed rule list
                        // that `CssChunk::Drop` `set_len(0)`s without running element
                        // destructors, so any global heap spill would leak. Build them
                        // via `from_arena_iter` so the spill (if any) lives in `bump`.
                        let names = SmallList::<LayerName, 1>::from_arena_iter(
                            bump,
                            inner.slice().iter().map(|shadow| LayerName {
                                v: SmallList::from_arena_iter(
                                    bump,
                                    shadow.v.slice().iter().map(|seg| {
                                        // `seg` borrows arena-owned bytes that outlive this
                                        // stylesheet; route through `StoreStr` for the lifetime
                                        // erasure (see the corresponding note in layer.rs).
                                        bun_ast::StoreStr::new(seg).slice()
                                    }),
                                ),
                            }),
                        );
                        arena_rule_list_one(
                            bump,
                            BundlerCssRule::LayerStatement(LayerStatementRule {
                                names,
                                loc: Location::dummy(),
                            }),
                        )
                    } else {
                        BundlerCssRuleList::default()
                    };
                    let mut ast = BundlerStyleSheet {
                        rules,
                        sources: Default::default(),
                        source_map_urls: Default::default(),
                        license_comments: Default::default(),
                        options: ParserOptions::default(None),
                        composes: Default::default(),
                        ..BundlerStyleSheet::empty()
                    };
                    wrap_rules_with_conditions(&mut ast, bump, &entry.conditions);
                    css_chunk.asts[i] = ast;
                }
                CssImportOrderKind::ExternalPath(p) => {
                    // Taking `&mut` at index 0 here would exclusively borrow
                    // the whole `entry.conditions` Vec while the `while j != 1`
                    // loop below still reads `entry.conditions.len` / `.at(j)`.
                    // The borrow is not actually needed until after the loop, so
                    // defer acquiring it until `actual_conditions` is built below.
                    let had_conditions = entry.conditions.len() > 0;
                    if had_conditions {
                        entry.condition_import_records.push(ImportRecord {
                            kind: ImportKind::At,
                            path: *p,
                            range: Range::default(),
                            tag: ImportRecordTag::None,
                            loader: None,
                            source_index: AstIndex::default(),
                            original_path: b"",
                            flags: ImportRecordFlags::default(),
                            phase: Default::default(),
                        });

                        // Handling a chain of nested conditions is complicated. We can't
                        // necessarily join them together because a) there may be multiple
                        // layer names and b) layer names are only supposed to be inserted
                        // into the layer order if the parent conditions are applied.
                        //
                        // Instead we handle them by preserving the "@import" nesting using
                        // imports of data URL stylesheets. This may seem strange but I think
                        // this is the only way to do this in CSS.
                        let mut j: usize = entry.conditions.len() as usize;
                        while j != 1 {
                            j -= 1;

                            // `ast_import` holds a bitwise-duplicated `ImportConditions`
                            // (see `ptr::read` below);
                            // dropping it would run `Drop` on that aliased
                            // `ImportConditions` — freeing Global-backed buffers
                            // (`MediaList.media_queries: Vec`, `SupportsCondition::{Box,Vec}`,
                            // `LayerName.v: SmallList`) that are still owned by
                            // `entry.conditions[j]`, i.e. a double-free / UAF. Wrap in
                            // `ManuallyDrop` so the duplicate is abandoned instead; the rule
                            // slab itself is arena-owned so it is reclaimed on arena reset.
                            let ast_import = core::mem::ManuallyDrop::new(BundlerStyleSheet {
                                options: ParserOptions::default(None),
                                license_comments: Default::default(),
                                sources: Default::default(),
                                source_map_urls: Default::default(),
                                rules: {
                                    let mut import_rule = ImportRule {
                                        url: p.pretty,
                                        import_record_idx: entry.condition_import_records.len()
                                            as u32,
                                        loc: Location::dummy(),
                                        ..Default::default()
                                    };
                                    // SAFETY: shallow struct
                                    // copy. The duplicate is never dropped (`ManuallyDrop`
                                    // above), so the aliased heap stays singly-owned by
                                    // `entry.conditions[j]`.
                                    *import_rule.conditions_mut() =
                                        unsafe { core::ptr::read(entry.conditions.at(j)) };
                                    arena_rule_list_one(bump, BundlerCssRule::Import(import_rule))
                                },
                                composes: Default::default(),
                                ..BundlerStyleSheet::empty()
                            });

                            let printer_options = PrinterOptions {
                                targets: Targets::for_bundler_target(c.options.target),
                                // TODO: make this more configurable
                                minify: c.options.minify_whitespace
                                    || c.options.minify_syntax
                                    || c.options.minify_identifiers,
                                ..Default::default()
                            };

                            let print_result = match ast_import.to_css(
                                bump,
                                &printer_options,
                                Some(ImportInfo {
                                    import_records: &entry.condition_import_records,
                                    ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                                    // SAFETY: read-only `&[Box<[u8]>]`→`&[&[u8]]` view; relies on
                                    // fat-pointer field-order equivalence (see fn doc).
                                    ast_unique_key_for_additional_file: unsafe {
                                        bun_ptr::boxed_slices_as_borrowed(
                                            parse_graph
                                                .input_files
                                                .items_unique_key_for_additional_file(),
                                        )
                                    },
                                }),
                                // `LocalsResultsMap` is the same `ArrayHashMap<Ref, Box<[u8]>>`
                                // alias as `bun_js_printer::MangledProps`; no cast needed.
                                Some(&c.mangled_props),
                                // SAFETY: `to_css` takes `&bun_ast::symbol::Map`; `c.graph.symbols`
                                // is `bun_ast::symbol::Map`. Both are
                                // `{ symbols_for_source: NestedList }` (`UnsafeCell<T>` is
                                // `repr(transparent)`), so layouts match — bridge by pointer cast.
                                unsafe {
                                    &*(&raw const c.graph.symbols).cast::<bun_ast::symbol::Map>()
                                },
                            ) {
                                Ok(v) => v,
                                Err(e) => {
                                    // Split-borrow — `parse_graph`/`asts` hold borrows
                                    // derived from `c`; `log_disjoint` returns the
                                    // disjoint `Transpiler.log` backref.
                                    c.log_disjoint().add_error_fmt(
                                        None,
                                        Loc::EMPTY,
                                        format_args!("Error generating CSS for import: {}", e),
                                    );
                                    continue;
                                }
                            };
                            let encoded = DataURL::encode_string_as_shortest_data_url(
                                b"text/css",
                                strings::trim(print_result.code.as_slice(), b" \n\r\t"),
                            );
                            // `encode_string_as_shortest_data_url` returns a heap `Vec<u8>`;
                            // copy it into the worker bump (freed
                            // at bundle teardown via arena reset). SAFETY: arena outlives
                            // the chunk, so the `'bump → 'static` launder is sound — same
                            // contract as every other CSS slice in this file.
                            let encoded: &'static [u8] =
                                bun_ast::StoreStr::new(bump.alloc_slice_copy(&encoded)).slice();
                            *p = Path::init(encoded);
                        }
                    }

                    let mut empty_conditions = ImportConditions::default();
                    // Index 0 is disjoint from every `at(j)` (j>=1) read above;
                    // only now do we materialize the exclusive borrow.
                    let actual_conditions: &mut ImportConditions = if had_conditions {
                        entry.conditions.mut_(0)
                    } else {
                        &mut empty_conditions
                    };

                    entry.condition_import_records.push(ImportRecord {
                        kind: ImportKind::At,
                        path: *p,
                        range: Range::NONE,
                        tag: ImportRecordTag::None,
                        loader: None,
                        source_index: AstIndex::default(),
                        original_path: b"",
                        flags: ImportRecordFlags::default(),
                        phase: Default::default(),
                    });

                    css_chunk.asts[i] = BundlerStyleSheet {
                        rules: {
                            let mut import_rule = ImportRule::from_url_and_import_record_idx(
                                p.pretty,
                                entry.condition_import_records.len() as u32,
                            );
                            // SAFETY: shallow struct copy. The duplicate lives in an
                            // `ImportRule` inside the `arena_rule_list_one` slab assigned
                            // to `css_chunk.asts[i]`, whose elements never run `Drop`
                            // (`CssChunk::Drop` frees the slab via `set_len(0)`), so
                            // `entry.conditions[0]` / `empty_conditions` remain the sole
                            // owners of the interior heap.
                            *import_rule.conditions_mut() =
                                unsafe { core::ptr::read(actual_conditions) };
                            arena_rule_list_one(bump, BundlerCssRule::Import(import_rule))
                        },
                        sources: Default::default(),
                        source_map_urls: Default::default(),
                        license_comments: Default::default(),
                        options: ParserOptions::default(None),
                        composes: Default::default(),
                        ..BundlerStyleSheet::empty()
                    };
                }
                CssImportOrderKind::SourceIndex(source_index) => {
                    let source_index = *source_index;
                    // Multiple imports may refer to the same file/AST, but they
                    // may wrap or modify the AST in different ways. So we need
                    // to make a shallow copy and be careful not to modify shared
                    // references.
                    let ast: &mut BundlerStyleSheet = 'ast: {
                        // asts[idx] is Some for source_index entries (invariant of imports_in_chunk_in_order).
                        let original_stylesheet: &BundlerStyleSheet = asts
                            [source_index.get() as usize]
                            .as_deref()
                            .expect("css ast present");
                        // SAFETY: bitwise shallow copy of the
                        // stylesheet header. All interior allocations are arena-owned and never
                        // freed via this view, so the duplicated `Vec`/`Vec` headers are
                        // sound for read-only / reslice use below.
                        css_chunk.asts[i] = unsafe { core::ptr::read(original_stylesheet) };
                        break 'ast &mut css_chunk.asts[i];
                    };

                    {
                        // Strip leading "@import" and ".ignored" rules. Any
                        // "@layer" statement rules interleaved with them are
                        // preserved, because they carry layer ordering
                        // information that is not re-emitted elsewhere by
                        // the bundler (e.g. Tailwind's
                        // `@layer theme, base, components, utilities;`).
                        //
                        // IMPORTANT: `ast` is only a shallow copy of the
                        // per-source stylesheet, so `ast.rules.v.items` still
                        // points at the backing array owned by
                        // `c.graph.ast.items(.css)`. We MUST NOT mutate that
                        // buffer in place — a second import of the same
                        // source_index would observe the compacted prefix and
                        // drop rules. Instead we always build a fresh rules
                        // list (copying the retained "@layer" prefix rules +
                        // the tail).
                        //
                        // Regression: #28914
                        let original_rules = ast.rules.v.as_slice();
                        let mut layer_count: usize = 0;
                        let mut prefix_end: usize = original_rules.len();
                        'prefix_scan: for (idx, rule) in original_rules.iter().enumerate() {
                            match rule {
                                BundlerCssRule::Import(_) | BundlerCssRule::Ignored => {}
                                BundlerCssRule::LayerStatement(_) => layer_count += 1,
                                _ => {
                                    prefix_end = idx;
                                    break 'prefix_scan;
                                }
                            }
                        }
                        let dropped = prefix_end - layer_count;

                        if dropped == 0 {
                            // Prefix is all "@layer" (or empty). Nothing to
                            // strip — leave `ast.rules.v` untouched.
                        } else {
                            // Interleaved case: allocate a fresh rules list
                            // so we don't mutate the shared backing array.
                            // Preserve the "@layer" statements from the
                            // prefix and append the remaining tail.
                            let mut new_rules: ArenaVec<BundlerCssRule> =
                                ArenaVec::with_capacity_in(
                                    layer_count + (original_rules.len() - prefix_end),
                                    bump,
                                );
                            for rule in &original_rules[0..prefix_end] {
                                if matches!(rule, BundlerCssRule::LayerStatement(_)) {
                                    // SAFETY: bitwise duplicate of a rule. The copy goes into
                                    // an `arena_rule_list` slab installed in `css_chunk.asts[i]`,
                                    // whose elements never run `Drop` (see `arena_rule_list` /
                                    // `CssChunk::Drop`), so the rule's interior heap stays
                                    // singly-owned by the original.
                                    new_rules.push(unsafe { core::ptr::read(rule) });
                                }
                            }
                            for rule in &original_rules[prefix_end..] {
                                // SAFETY: bitwise duplicate of a rule. The copy goes into
                                // an `arena_rule_list` slab installed in `css_chunk.asts[i]`,
                                // whose elements never run `Drop` (see `arena_rule_list` /
                                // `CssChunk::Drop`), so the rule's interior heap stays
                                // singly-owned by the original.
                                new_rules.push(unsafe { core::ptr::read(rule) });
                            }
                            // `ast.rules` is the shallow-copied header aliasing the
                            // source stylesheet's arena buffer (see `ptr::read` above).
                            // Dropping it would `drop_in_place` the aliased rules and
                            // free the shared backing array. Leak the header
                            // before installing the freshly-allocated list.
                            let _ = core::mem::ManuallyDrop::new(core::mem::replace(
                                &mut ast.rules,
                                arena_rule_list(new_rules),
                            ));
                        }
                    }

                    wrap_rules_with_conditions(ast, bump, &entry.conditions);
                    // TODO: Remove top-level duplicate rules across files
                }
            }
        }
    }
}

/// Builds a `BundlerCssRuleList` whose backing storage is arena-owned.
///
/// `CssRuleList::v` is a global `Vec`, but every rule slab built here must be
/// arena-backed: the elements bitwise-alias the source AST and must never run
/// `Drop`, and the slab itself must outlive the chunk without a side-channel
/// owner. Reinterpreting the leaked arena slice as a global `Vec` is sound
/// because the resulting `Vec` is never dropped (`CssChunk::Drop` `forget`s
/// the `asts` slab) and never grown after this point; the arena reclaims the
/// storage on `reset`.
fn arena_rule_list(rules: ArenaVec<'_, BundlerCssRule>) -> BundlerCssRuleList {
    let len = rules.len();
    if len == 0 {
        return BundlerCssRuleList::default();
    }
    let slab = rules.into_bump_slice_mut();
    BundlerCssRuleList {
        // SAFETY: `slab` is arena-owned; the `Vec` is never dropped or grown
        // (see fn doc).
        v: unsafe { Vec::from_raw_parts(slab.as_mut_ptr(), len, len) },
    }
}

/// Single-element shorthand for [`arena_rule_list`].
fn arena_rule_list_one(bump: &Bump, rule: BundlerCssRule) -> BundlerCssRuleList {
    let mut v: ArenaVec<BundlerCssRule> = ArenaVec::with_capacity_in(1, bump);
    v.push(rule);
    arena_rule_list(v)
}

fn wrap_rules_with_conditions(
    ast: &mut BundlerStyleSheet,
    temp_bump: &Bump,
    conditions: &Vec<ImportConditions>,
) {
    let mut dummy_import_records: Vec<ImportRecord> = Vec::new();

    let mut i: usize = conditions.len() as usize;
    while i > 0 {
        i -= 1;
        let item = conditions.at(i);

        // Generate "@layer" wrappers. Note that empty "@layer" rules still have
        // a side effect (they set the layer order) so they cannot be removed.
        if let Some(l) = &item.layer {
            // SAFETY: by-value `?LayerName` copy. The
            // `SmallList<&'static [u8],1>` payload is arena-backed and never
            // freed via this view, so the bitwise duplicate is sound (same as
            // every other `ptr::read` shallow-copy in this file).
            let layer = unsafe { core::ptr::read(&raw const l.v) };
            let mut do_block_rule = true;
            if ast.rules.v.is_empty() {
                if l.v.is_none() {
                    // Omit an empty "@layer {}" entirely
                    continue;
                } else {
                    // Generate "@layer foo;" instead of "@layer foo {}"
                    // `ast.rules.v` may be the shallow-copied / offset-resliced
                    // header aliasing the source stylesheet's buffer (see the
                    // `ptr::read` / `Vec::from_raw_parts` above) — dropping it
                    // would free into another allocation; leak the header instead.
                    let _ = core::mem::ManuallyDrop::new(core::mem::take(&mut ast.rules.v));
                    do_block_rule = false;
                }
            }

            ast.rules = arena_rule_list_one(
                temp_bump,
                if do_block_rule {
                    BundlerCssRule::LayerBlock(BundlerLayerBlockRule {
                        name: layer,
                        rules: core::mem::take(&mut ast.rules),
                        loc: Location::dummy(),
                    })
                } else {
                    BundlerCssRule::LayerStatement(LayerStatementRule {
                        names: if let Some(ly) = layer {
                            SmallList::<LayerName, 1>::with_one(ly)
                        } else {
                            SmallList::default()
                        },
                        loc: Location::dummy(),
                    })
                },
            );
        }

        // Generate "@supports" wrappers. This is not done if the rule block is
        // empty because empty "@supports" rules have no effect.
        if !ast.rules.v.is_empty() {
            if let Some(supports) = &item.supports {
                ast.rules = arena_rule_list_one(
                    temp_bump,
                    BundlerCssRule::Supports(BundlerSupportsRule {
                        condition: supports
                            .clone_with_import_records(temp_bump, &mut dummy_import_records),
                        rules: core::mem::take(&mut ast.rules),
                        loc: Location::dummy(),
                    }),
                );
            }
        }

        // Generate "@media" wrappers. This is not done if the rule block is
        // empty because empty "@media" rules have no effect.
        if !ast.rules.v.is_empty() && !item.media.media_queries.is_empty() {
            ast.rules = arena_rule_list_one(
                temp_bump,
                BundlerCssRule::Media(BundlerMediaRule {
                    query: item
                        .media
                        .clone_with_import_records(temp_bump, &mut dummy_import_records),
                    rules: core::mem::take(&mut ast.rules),
                    loc: Location::dummy(),
                }),
            );
        }
    }

    debug_assert!(dummy_import_records.len() == 0);
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;
