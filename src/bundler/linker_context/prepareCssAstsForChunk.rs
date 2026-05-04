use core::mem::offset_of;

use bun_alloc::Arena as Bump;
use bun_collections::BabyList;
use bun_css::{
    self as css, BundlerCssRule, BundlerCssRuleList, BundlerLayerBlockRule, BundlerMediaRule,
    BundlerStyleSheet, BundlerSupportsRule, ImportConditions, ImportRule, LayerName,
    LayerStatementRule, Location, ParserOptions, PrinterOptions, SmallList, Targets,
};
use bun_fs::Path;
use bun_logger::{self as logger, Loc, Range};
use bun_options_types::{ImportKind, ImportRecord};
use bun_str::strings;
use bun_threading::ThreadPool as ThreadPoolLib;

use crate::{BundleV2, Chunk, DataURL, LinkerContext};

pub struct PrepareCssAstTask<'a> {
    pub task: ThreadPoolLib::Task,
    pub chunk: &'a mut Chunk,
    pub linker: &'a LinkerContext,
}

pub fn prepare_css_asts_for_chunk(task: *mut ThreadPoolLib::Task) {
    // SAFETY: task points to PrepareCssAstTask.task (intrusive thread-pool node)
    let prepare_css_asts: &mut PrepareCssAstTask = unsafe {
        &mut *(task as *mut u8)
            .sub(offset_of!(PrepareCssAstTask, task))
            .cast::<PrepareCssAstTask>()
    };
    // SAFETY: prepare_css_asts.linker points to BundleV2.linker (LinkerContext is embedded by value)
    let bundle_v2: *mut BundleV2 = unsafe {
        (prepare_css_asts.linker as *const LinkerContext as *mut u8)
            .sub(offset_of!(BundleV2, linker))
            .cast::<BundleV2>()
    };
    // SAFETY: bundle_v2 derived via container_of from &LinkerContext embedded in BundleV2;
    // exclusive access guaranteed by thread-pool task ownership.
    let bundle_v2: &mut BundleV2 = unsafe { &mut *bundle_v2 };
    // TODO(port): Worker::get likely returns an RAII guard whose Drop calls unget()
    let worker = ThreadPool::Worker::get(bundle_v2);

    prepare_css_asts_for_chunk_impl(
        prepare_css_asts.linker,
        prepare_css_asts.chunk,
        worker.allocator(),
    );
}

fn prepare_css_asts_for_chunk_impl(c: &LinkerContext, chunk: &mut Chunk, bump: &Bump) {
    let asts: &[Option<*mut css::BundlerStyleSheet>] = c.graph.ast.items().css;
    // TODO(port): MultiArrayList column accessor — verify `.items().css` shape in Phase B

    // Prepare CSS asts
    // Remove duplicate rules across files. This must be done in serial, not
    // in parallel, and must be done from the last rule to the first rule.
    {
        let mut i: usize = chunk.content.css.imports_in_chunk_in_order.len();
        while i != 0 {
            i -= 1;
            let entry = chunk.content.css.imports_in_chunk_in_order.get_mut(i);
            // PORT NOTE: reshaped for borrowck — match on entry.kind while also touching
            // entry.conditions / entry.condition_import_records relies on disjoint field borrows.
            match &mut entry.kind {
                css::CssEntryKind::Layers(layers) => {
                    let len = layers.inner().len();
                    let mut rules = BundlerCssRuleList::new_in(bump);
                    if len > 0 {
                        rules.v.push(BundlerCssRule::LayerStatement(LayerStatementRule {
                            names: SmallList::<LayerName, 1>::from_baby_list_no_deinit(
                                layers.inner().clone(),
                            ),
                            loc: Location::dummy(),
                        }));
                    }
                    let mut ast = BundlerStyleSheet {
                        rules,
                        sources: Default::default(),
                        source_map_urls: Default::default(),
                        license_comments: Default::default(),
                        options: ParserOptions::default(bump, None),
                        composes: Default::default(),
                    };
                    wrap_rules_with_conditions(&mut ast, bump, &entry.conditions);
                    chunk.content.css.asts[i] = ast;
                }
                css::CssEntryKind::ExternalPath(p) => {
                    let mut conditions: Option<&mut ImportConditions> = None;
                    if entry.conditions.len() > 0 {
                        conditions = Some(entry.conditions.get_mut(0));
                        entry.condition_import_records.push(
                            bump,
                            ImportRecord {
                                kind: ImportKind::At,
                                path: p.clone(),
                                range: Range::default(),
                                ..Default::default()
                            },
                        );

                        // Handling a chain of nested conditions is complicated. We can't
                        // necessarily join them together because a) there may be multiple
                        // layer names and b) layer names are only supposed to be inserted
                        // into the layer order if the parent conditions are applied.
                        //
                        // Instead we handle them by preserving the "@import" nesting using
                        // imports of data URL stylesheets. This may seem strange but I think
                        // this is the only way to do this in CSS.
                        let mut j: usize = entry.conditions.len();
                        while j != 1 {
                            j -= 1;

                            let ast_import = BundlerStyleSheet {
                                options: ParserOptions::default(bump, None),
                                license_comments: Default::default(),
                                sources: Default::default(),
                                source_map_urls: Default::default(),
                                rules: 'rules: {
                                    let mut rules = BundlerCssRuleList::new_in(bump);
                                    let mut import_rule = ImportRule {
                                        url: p.pretty.clone(),
                                        import_record_idx: entry.condition_import_records.len(),
                                        loc: Location::dummy(),
                                        ..Default::default()
                                    };
                                    *import_rule.conditions_mut() = entry.conditions.at(j).clone();
                                    rules.v.push(BundlerCssRule::Import(import_rule));
                                    break 'rules rules;
                                },
                                composes: Default::default(),
                            };

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
                                css::ToCssExtra {
                                    import_records: &entry.condition_import_records,
                                    ast_urls_for_css: c.parse_graph.ast.items().url_for_css,
                                    ast_unique_key_for_additional_file: c
                                        .parse_graph
                                        .input_files
                                        .items()
                                        .unique_key_for_additional_file,
                                },
                                &c.mangled_props,
                                &c.graph.symbols,
                            ) {
                                css::PrintResult::Result(v) => v,
                                css::PrintResult::Err(e) => {
                                    // TODO(port): Log::add_error_fmt signature — c.allocator() arena
                                    c.log.add_error_fmt(
                                        None,
                                        Loc::EMPTY,
                                        c.allocator(),
                                        format_args!("Error generating CSS for import: {}", e),
                                    );
                                    continue;
                                }
                            };
                            *p = Path::init(DataURL::encode_string_as_shortest_data_url(
                                bump,
                                b"text/css",
                                strings::trim(print_result.code.as_slice(), b" \n\r\t"),
                            ));
                        }
                    }

                    let mut empty_conditions = ImportConditions::default();
                    let actual_conditions: &mut ImportConditions = match conditions {
                        Some(cc) => cc,
                        None => &mut empty_conditions,
                    };

                    entry.condition_import_records.push(
                        bump,
                        ImportRecord {
                            kind: ImportKind::At,
                            path: p.clone(),
                            range: Range::NONE,
                            ..Default::default()
                        },
                    );

                    chunk.content.css.asts[i] = BundlerStyleSheet {
                        rules: 'rules: {
                            let mut rules = BundlerCssRuleList::new_in(bump);
                            let mut import_rule = ImportRule::from_url_and_import_record_idx(
                                p.pretty.clone(),
                                entry.condition_import_records.len(),
                            );
                            *import_rule.conditions_mut() = actual_conditions.clone();
                            rules.v.push(BundlerCssRule::Import(import_rule));
                            break 'rules rules;
                        },
                        sources: Default::default(),
                        source_map_urls: Default::default(),
                        license_comments: Default::default(),
                        options: ParserOptions::default(bump, None),
                        composes: Default::default(),
                    };
                }
                css::CssEntryKind::SourceIndex(source_index) => {
                    let source_index = *source_index;
                    // Multiple imports may refer to the same file/AST, but they
                    // may wrap or modify the AST in different ways. So we need
                    // to make a shallow copy and be careful not to modify shared
                    // references.
                    let ast: &mut BundlerStyleSheet = 'ast: {
                        // SAFETY: asts[idx] is Some for source_index entries (invariant of imports_in_chunk_in_order)
                        let original_stylesheet =
                            unsafe { &*asts[source_index.get()].expect("css ast present") };
                        chunk.content.css.asts[i] = original_stylesheet.clone();
                        // TODO(port): Zig used a struct copy (shallow); .clone() may deep-copy — verify BundlerStyleSheet semantics
                        break 'ast &mut chunk.content.css.asts[i];
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
                        // drop rules. Instead we either reslice the copied
                        // header (fast path) or build a fresh rules list.
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
                        } else if layer_count == 0 {
                            // Fast path: no "@layer" statements to preserve,
                            // reslice the copied header forward. This does
                            // not touch the backing array.
                            // TODO(port): ArrayListUnmanaged reslice — verify BundlerCssRuleList allows
                            // a non-owning slice view (ptr/len/cap reassignment) in the Rust port.
                            let original_len = original_rules.len();
                            let tail_len = original_len - prefix_end;
                            unsafe {
                                // SAFETY: advancing the items pointer within the same allocation;
                                // capacity is reduced by the same amount so the (ptr,cap) pair
                                // still describes a valid suballocation. The backing buffer is
                                // owned elsewhere and never freed via this view.
                                ast.rules.v.reslice_forward(prefix_end, tail_len);
                            }
                        } else {
                            // Interleaved case: allocate a fresh rules list
                            // so we don't mutate the shared backing array.
                            // Preserve the "@layer" statements from the
                            // prefix and append the remaining tail.
                            let mut new_rules = BundlerCssRuleList::new_in(bump);
                            for rule in &original_rules[0..prefix_end] {
                                if matches!(rule, BundlerCssRule::LayerStatement(_)) {
                                    new_rules.v.push(rule.clone());
                                }
                            }
                            for rule in &original_rules[prefix_end..] {
                                new_rules.v.push(rule.clone());
                            }
                            ast.rules = new_rules;
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
    conditions: &BabyList<ImportConditions>,
) {
    let mut dummy_import_records: BabyList<ImportRecord> = BabyList::default();

    let mut i: usize = conditions.len();
    while i > 0 {
        i -= 1;
        let item = conditions.at(i);

        // Generate "@layer" wrappers. Note that empty "@layer" rules still have
        // a side effect (they set the layer order) so they cannot be removed.
        if let Some(l) = &item.layer {
            let layer = l.v.clone();
            let mut do_block_rule = true;
            if ast.rules.v.is_empty() {
                if l.v.is_none() {
                    // Omit an empty "@layer {}" entirely
                    continue;
                } else {
                    // Generate "@layer foo;" instead of "@layer foo {}"
                    ast.rules.v = Default::default();
                    do_block_rule = false;
                }
            }

            ast.rules = 'brk: {
                let mut new_rules = BundlerCssRuleList::new_in(temp_bump);
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
                    let mut new_rules = BundlerCssRuleList::new_in(temp_bump);
                    new_rules.v.push(BundlerCssRule::Supports(BundlerSupportsRule {
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
                let mut new_rules = BundlerCssRuleList::new_in(temp_bump);
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bundler/linker_context/prepareCssAstsForChunk.zig (331 lines)
//   confidence: medium
//   todos:      5
//   notes:      CSS arena types (shallow-copy semantics, reslice_forward) and MultiArrayList column accessors need Phase B verification; entry.kind variant enum name guessed as CssEntryKind.
// ──────────────────────────────────────────────────────────────────────────
