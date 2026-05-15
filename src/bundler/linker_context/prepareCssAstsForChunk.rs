use crate::mal_prelude::*;
use core::mem::offset_of;

use bun_alloc::Arena as Bump;
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

// PORT NOTE: Zig stores `*Chunk` / `*LinkerContext` (freely-aliasing mutable
// pointers). We mirror that with raw pointers rather than `&mut` / `&` so that
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
// SoA columns + `linker.graph.ast.css` shared. The impl currently materializes
// `&mut LinkerContext` (see `prepare_css_asts_for_chunk_impl` signature) —
// safe only because every CSS chunk is unique and the impl reads `c` /
// writes `chunk` exclusively; no `c.graph` write occurs. `PrepareCssAstTask`
// is `Send` by virtue of `LinkerContext: Send` + `Chunk: Send` (both raw-ptr
// fields point at types with `unsafe impl Send`).
pub fn prepare_css_asts_for_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: `task` points to `PrepareCssAstTask.task` (intrusive thread-pool
    // node); the thread pool hands us exclusive access for the callback's
    // duration. We only read the two raw-pointer fields, matching Zig's
    // `*const PrepareCssAstTask`.
    let prepare_css_asts: &PrepareCssAstTask =
        unsafe { &*bun_core::from_field_ptr!(PrepareCssAstTask, task, task) };
    let linker: *mut LinkerContext = prepare_css_asts.linker;
    let chunk: *mut Chunk = prepare_css_asts.chunk;
    // SAFETY: `linker` is a raw `*mut` to `BundleV2.linker` (embedded by value),
    // carrying provenance over the full `BundleV2` allocation. Recover the
    // parent via container_of. `Worker::get` only needs `&BundleV2`, so we
    // scope the shared borrow before materializing `&mut *linker` below to
    // avoid aliasing.
    let worker = {
        let bundle_v2: &BundleV2 = unsafe { &*LinkerContext::bundle_v2_ptr(linker) };
        ThreadPool::Worker::get(bundle_v2)
    };
    let worker = scopeguard::guard(worker, |w| w.unget());

    // SAFETY: `linker` outlives this task (owned by the bundle); each CSS chunk
    // gets exactly one `PrepareCssAstTask` (see generateChunksInParallel.rs),
    // so `&mut *chunk` is unique. `worker.arena` was initialized in
    // `Worker::create()` and points at the worker's heap arena.
    prepare_css_asts_for_chunk_impl(
        unsafe { &mut *linker },
        unsafe { &mut *chunk },
        worker.arena(),
    );
}

fn prepare_css_asts_for_chunk_impl(c: &mut LinkerContext, chunk: &mut Chunk, bump: &Bump) {
    // SAFETY: parse_graph backref; raw deref because `parse_graph` is held
    // across the log write below (split borrow).
    let parse_graph = unsafe { &*c.parse_graph };
    let asts = c.graph.ast.items_css();

    // Prepare CSS asts
    // Remove duplicate rules across files. This must be done in serial, not
    // in parallel, and must be done from the last rule to the first rule.
    {
        // PORT NOTE: Zig accesses `chunk.content.css.{imports_in_chunk_in_order,asts}`
        // through the union field at each use site while also holding `entry` as a raw
        // pointer into `imports_in_chunk_in_order`. In Rust, every `chunk.content.css.*`
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
            // PORT NOTE: reshaped for borrowck — match on entry.kind while also touching
            // entry.conditions / entry.condition_import_records relies on disjoint field borrows.
            match &mut entry.kind {
                CssImportOrderKind::Layers(layers) => {
                    let inner = layers.inner();
                    let len = inner.len();
                    let mut rules = BundlerCssRuleList::default();
                    if len > 0 {
                        // PORT NOTE: Zig `SmallList(LayerName,1).fromBabyListNoDeinit(layers.inner().*)`
                        // is a bitwise Vec→SmallList header transfer. In Rust the
                        // `Chunk::Layers` payload is the lifetime-erased shadow
                        // `ungate_support::bun_css::LayerName { v: Vec<Box<[u8]>> }`,
                        // not the real `css_parser::LayerName { v: SmallList<&'static [u8],1> }`,
                        // so the layouts differ. Rebuild the real list element-by-element;
                        // segments are arena-owned (`'bump`-laundered to `'static`) so the
                        // `&[u8]` reborrows below are valid for the chunk lifetime.
                        let mut names = SmallList::<LayerName, 1>::default();
                        for shadow in inner.slice() {
                            let mut real = LayerName::default();
                            for seg in shadow.v.slice() {
                                // `seg` borrows arena-owned bytes that outlive this
                                // stylesheet; route through `StoreStr` for the lifetime
                                // erasure (see layer.rs TODO(port)).
                                real.v.append(bun_ast::StoreStr::new(seg.as_ref()).slice());
                            }
                            names.append(real);
                        }
                        rules
                            .v
                            .push(BundlerCssRule::LayerStatement(LayerStatementRule {
                                names,
                                loc: Location::dummy(),
                            }));
                    }
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
                    // PORT NOTE: Zig keeps `conditions: ?*ImportConditions` as a raw
                    // pointer to index 0 while the `while j != 1` loop reads
                    // `entry.conditions.len` / `.at(j)`. Taking `&mut` at index 0 here
                    // would exclusively borrow the whole `entry.conditions` Vec for
                    // the duration, aliasing those reads. The pointer is not actually
                    // dereferenced until after the loop (.zig:119), so defer acquiring
                    // the index-0 borrow until `actual_conditions` is built below.
                    let had_conditions = entry.conditions.len() > 0;
                    if had_conditions {
                        entry.condition_import_records.push(ImportRecord {
                            kind: ImportKind::At,
                            path: p.clone(),
                            range: Range::default(),
                            tag: ImportRecordTag::None,
                            loader: None,
                            source_index: AstIndex::default(),
                            module_id: 0,
                            original_path: b"",
                            flags: ImportRecordFlags::default(),
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

                            // PORT NOTE: Zig has no destructors, so when `ast_import` falls
                            // out of scope the bitwise-duplicated `ImportConditions` inside
                            // it (see `ptr::read` below) is simply abandoned. In Rust,
                            // dropping `ast_import` would run `Drop` on that aliased
                            // `ImportConditions` — freeing Global-backed buffers
                            // (`MediaList.media_queries: Vec`, `SupportsCondition::{Box,Vec}`,
                            // `LayerName.v: SmallList`) that are still owned by
                            // `entry.conditions[j]`, i.e. a double-free / UAF. Wrap in
                            // `ManuallyDrop` to mirror Zig's leak-on-scope-exit; the only
                            // *fresh* allocation this leaks is the 1-element `rules.v` Vec
                            // buffer — same trade-off documented at the top of
                            // findImportedFilesInCSSOrder.rs for the `entry.conditions`
                            // ecosystem.
                            let ast_import = core::mem::ManuallyDrop::new(BundlerStyleSheet {
                                options: ParserOptions::default(None),
                                license_comments: Default::default(),
                                sources: Default::default(),
                                source_map_urls: Default::default(),
                                rules: 'rules: {
                                    let mut rules = BundlerCssRuleList::default();
                                    let mut import_rule = ImportRule {
                                        url: p.pretty,
                                        import_record_idx: entry.condition_import_records.len()
                                            as u32,
                                        loc: Location::dummy(),
                                        ..Default::default()
                                    };
                                    // SAFETY: Zig `entry.conditions.at(j).*` — shallow struct
                                    // copy. The duplicate is never dropped (`ManuallyDrop`
                                    // above), so the aliased heap stays singly-owned by
                                    // `entry.conditions[j]`.
                                    *import_rule.conditions_mut() =
                                        unsafe { core::ptr::read(entry.conditions.at(j)) };
                                    rules.v.push(BundlerCssRule::Import(import_rule));
                                    break 'rules rules;
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
                                printer_options,
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
                                // `to_css` takes `&bun_ast::symbol::Map`; `c.graph.symbols`
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
                            // PORT NOTE: Zig allocated into the worker arena (`arena`).
                            // `encode_string_as_shortest_data_url` returns a heap `Vec<u8>`;
                            // copy it into the worker bump so ownership matches Zig (freed
                            // at bundle teardown via arena reset). SAFETY: arena outlives
                            // the chunk, so the `'bump → 'static` launder is sound — same
                            // contract as every other CSS slice in this file.
                            let encoded: &'static [u8] =
                                bun_ast::StoreStr::new(bump.alloc_slice_copy(&encoded)).slice();
                            *p = Path::init(encoded);
                        }
                    }

                    let mut empty_conditions = ImportConditions::default();
                    // Index 0 is disjoint from every `at(j)` (j>=1) read above; only
                    // now do we materialize the exclusive borrow that Zig's raw pointer
                    // held the whole time.
                    let actual_conditions: &mut ImportConditions = if had_conditions {
                        entry.conditions.mut_(0)
                    } else {
                        &mut empty_conditions
                    };

                    entry.condition_import_records.push(ImportRecord {
                        kind: ImportKind::At,
                        path: p.clone(),
                        range: Range::NONE,
                        tag: ImportRecordTag::None,
                        loader: None,
                        source_index: AstIndex::default(),
                        module_id: 0,
                        original_path: b"",
                        flags: ImportRecordFlags::default(),
                    });

                    css_chunk.asts[i] = BundlerStyleSheet {
                        rules: 'rules: {
                            let mut rules = BundlerCssRuleList::default();
                            let mut import_rule = ImportRule::from_url_and_import_record_idx(
                                p.pretty,
                                entry.condition_import_records.len() as u32,
                            );
                            // SAFETY: Zig `actual_conditions.*` — shallow struct copy.
                            *import_rule.conditions_mut() =
                                unsafe { core::ptr::read(actual_conditions) };
                            rules.v.push(BundlerCssRule::Import(import_rule));
                            break 'rules rules;
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
                        // SAFETY: Zig `original_stylesheet.*` — bitwise shallow copy of the
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
                            let mut new_rules = BundlerCssRuleList::default();
                            for rule in &original_rules[0..prefix_end] {
                                if matches!(rule, BundlerCssRule::LayerStatement(_)) {
                                    // SAFETY: Zig by-value copy of arena-backed rule.
                                    new_rules.v.push(unsafe { core::ptr::read(rule) });
                                }
                            }
                            for rule in &original_rules[prefix_end..] {
                                // SAFETY: Zig by-value copy of arena-backed rule.
                                new_rules.v.push(unsafe { core::ptr::read(rule) });
                            }
                            // `ast.rules` is the shallow-copied header aliasing the
                            // source stylesheet's arena buffer (see `ptr::read` above).
                            // Dropping it would `drop_in_place` the aliased rules and
                            // free the shared backing array. Leak the header (Zig
                            // semantics: bitwise overwrite) before installing the
                            // freshly-allocated list.
                            core::mem::forget(core::mem::replace(&mut ast.rules, new_rules));
                        }
                    }

                    wrap_rules_with_conditions(ast, bump, &entry.conditions);
                    // TODO: Remove top-level duplicate rules across files
                }
            }
        }
    }
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
            // SAFETY: Zig `const layer = l.v;` — by-value `?LayerName` copy. The
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
                    // would free into another allocation. Zig's `= .{}` is a
                    // bitwise overwrite; mirror that by leaking the header.
                    core::mem::forget(core::mem::take(&mut ast.rules.v));
                    do_block_rule = false;
                }
            }

            ast.rules = 'brk: {
                let mut new_rules = BundlerCssRuleList::default();
                new_rules.v.push(if do_block_rule {
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
                });

                break 'brk new_rules;
            };
        }

        // Generate "@supports" wrappers. This is not done if the rule block is
        // empty because empty "@supports" rules have no effect.
        if !ast.rules.v.is_empty() {
            if let Some(supports) = &item.supports {
                ast.rules = 'brk: {
                    let mut new_rules = BundlerCssRuleList::default();
                    new_rules
                        .v
                        .push(BundlerCssRule::Supports(BundlerSupportsRule {
                            condition: supports
                                .clone_with_import_records(temp_bump, &mut dummy_import_records),
                            rules: core::mem::take(&mut ast.rules),
                            loc: Location::dummy(),
                        }));
                    break 'brk new_rules;
                };
            }
        }

        // Generate "@media" wrappers. This is not done if the rule block is
        // empty because empty "@media" rules have no effect.
        if !ast.rules.v.is_empty() && !item.media.media_queries.is_empty() {
            ast.rules = 'brk: {
                let mut new_rules = BundlerCssRuleList::default();
                new_rules.v.push(BundlerCssRule::Media(BundlerMediaRule {
                    query: item
                        .media
                        .clone_with_import_records(temp_bump, &mut dummy_import_records),
                    rules: core::mem::take(&mut ast.rules),
                    loc: Location::dummy(),
                }));
                break 'brk new_rules;
            };
        }
    }

    debug_assert!(dummy_import_records.len() == 0);
}

pub use crate::DeferredBatchTask;
pub use crate::ParseTask;
pub use crate::ThreadPool;

// ported from: src/bundler/linker_context/prepareCssAstsForChunk.zig
