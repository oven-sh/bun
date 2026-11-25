use crate::mal_prelude::*;
use core::sync::atomic::Ordering;

use bun_alloc::{Arena, ArenaVec};
use bun_ast::Loc;
use bun_core::strings;
use bun_resolver::DataURL;

use crate::bun_css::css_parser::{BundlerCssRule, BundlerCssRuleList};
use crate::bun_css::css_rules::{PreviousRule, import, layer};
use crate::bun_css::{BundlerStyleSheet, ImportInfo, PrintErr, Printer, PrinterOptions, Targets};

use crate::bun_fs::Path;
use crate::chunk::{Content, CssImportOrder, CssImportOrderKind, ImportConditionsRef};
use crate::linker_context_mod::LinkerContext;
use crate::thread_pool::Worker;
use crate::{Chunk, CompileResult, Index};

pub(crate) fn generate_compile_result_for_css_chunk(
    worker: &mut Worker,
    c: &LinkerContext,
    chunk: &Chunk,
    imports_in_chunk_index: usize,
) -> CompileResult {
    let _trace = bun_core::perf::trace("Bundler.generateCodeForFileInChunkCss");
    // `defer trace.end()` — RAII; Drop ends the trace.

    // Frees what JS part ranges retained; CSS does not allocate here.
    worker.temporary_arena.reset();
    let arena = worker.arena();
    let mut allocating_writer: Vec<u8> = Vec::new();

    let Content::Css(css_content) = &chunk.content else {
        unreachable!("generateCompileResultForCssChunk called on non-CSS chunk");
    };
    let order = &css_content.imports_in_chunk_in_order;
    let css_import = &order[imports_in_chunk_index];
    let print_error = |source_index| CompileResult::Css {
        result: Err(crate::Error::PrintError),
        source_index,
        source_map: None,
    };

    let shared = shared_anonymous_conditions(order, imports_in_chunk_index);
    let Ok(blocks) = shared_block_edges(c, css_import.conditions, shared, arena) else {
        return print_error(Index::INVALID.get());
    };
    let conditions = &css_import.conditions[shared.before.max(shared.after)..];
    allocating_writer.extend_from_slice(&blocks.open);
    let indent_first_line = |output: &mut Vec<u8>, has_rules: bool| {
        if !c.options.minify_whitespace
            && (has_rules || conditions.iter().any(|c| c.layer_name().is_some()))
        {
            output.extend(core::iter::repeat_n(b' ', blocks.indent as usize));
        }
    };
    // TODO: make this more configurable
    let printer_options = |minify| PrinterOptions {
        minify,
        targets: Targets::for_bundler_target(c.options.target),
        indent: blocks.indent,
        ..Default::default()
    };

    let source_index = match &css_import.kind {
        CssImportOrderKind::Layers(layers) => {
            let names = layers.names();
            indent_first_line(&mut allocating_writer, !names.is_empty());
            let options = printer_options(c.options.minify_whitespace);
            let mut printer = new_printer(c, arena, &mut allocating_writer, &options, None);
            let printed = if names.is_empty() {
                layer_order_to_css(conditions, &mut printer)
            } else {
                blocks_to_css(conditions, &mut printer, &|d| {
                    layer::statement_to_css(names, d)
                })
            };
            if printer.finish(printed).is_err() {
                return print_error(Index::INVALID.get());
            }
            Index::INVALID
        }
        CssImportOrderKind::ExternalPath(path) => {
            let options = printer_options(c.options.minify_whitespace);
            let mut printer = new_printer(c, arena, &mut allocating_writer, &options, None);
            let outermost = conditions.first().map(|c| &**c);
            let printed = import::rule_to_css(path.pretty, outermost, &mut printer);
            if printer.finish(printed).is_err() {
                return print_error(Index::INVALID.get());
            }
            Index::INVALID
        }
        &CssImportOrderKind::SourceIndex(idx) => {
            let sheet = c.parse_graph().css_asts[idx.get() as usize]
                .as_deref()
                .expect("css ast present");
            let runs = rules_to_bundle(sheet);
            let has_rules = runs
                .clone()
                .flatten()
                .any(|rule| !matches!(rule, BundlerCssRule::Ignored));
            indent_first_line(&mut allocating_writer, has_rules);
            let parse_graph = c.parse_graph();
            let import_info = ImportInfo {
                import_records: &c.graph.ast.items_import_records()[idx.get() as usize],
                ast_urls_for_css: parse_graph.ast.items_url_for_css(),
                ast_unique_key_for_additional_file: parse_graph
                    .input_files
                    .items_unique_key_for_additional_file(),
            };
            let options = printer_options(minifies_anything(c));
            let writer = &mut allocating_writer;
            let mut printer = new_printer(c, arena, writer, &options, Some(import_info));
            let printed = sheet.header_to_css(&mut printer, None).and_then(|()| {
                if has_rules {
                    blocks_to_css(conditions, &mut printer, &|d| {
                        runs.clone()
                            .try_fold(PreviousRule::None, |previous, run| {
                                BundlerCssRuleList::rules_to_css(run, previous, d, None)
                            })
                            .map(drop)
                    })
                } else {
                    layer_order_to_css(conditions, &mut printer)
                }
            });
            if printer.finish(printed).is_err() {
                return print_error(idx.get());
            }
            idx
        }
    };

    blocks.close_into(&mut allocating_writer);
    let output = allocating_writer.into_boxed_slice();
    // Update bytesInOutput for this source in the chunk (for metafile)
    if source_index.is_valid() && !output.is_empty() {
        // CONCURRENCY: the key set is frozen, and other workers may update the same counter.
        if let Some(bytes) = chunk.files_with_parts_in_chunk.get(&source_index.get()) {
            let _ = bytes.fetch_add(output.len(), Ordering::Relaxed);
        }
    }
    CompileResult::Css {
        result: Ok(output),
        source_index: source_index.get(),
        source_map: None,
    }
}

fn minifies_anything(c: &LinkerContext) -> bool {
    c.options.minify_whitespace || c.options.minify_syntax || c.options.minify_identifiers
}

fn new_printer<'p>(
    c: &'p LinkerContext,
    arena: &'p Arena,
    writer: &'p mut Vec<u8>,
    options: &PrinterOptions<'p>,
    import_info: Option<ImportInfo<'p>>,
) -> Printer<'p> {
    Printer::new(
        arena,
        ArenaVec::new_in(arena),
        writer,
        options,
        import_info,
        Some(&c.mangled_props),
        &c.graph.symbols,
    )
}

/// The rules without the `@import`s and the `@layer` statements before the first one, which have their own `CssImportOrder` entries.
fn rules_to_bundle<'r, 'a>(
    sheet: &'r BundlerStyleSheet<'a>,
) -> impl Iterator<Item = &'r [BundlerCssRule<'a>]> + Clone {
    let mut rules = sheet.rules.v.as_slice();
    if !sheet.layers_pre_import.is_empty() {
        while let [
            BundlerCssRule::Ignored | BundlerCssRule::LayerStatement(_),
            rest @ ..,
        ] = rules
        {
            rules = rest;
        }
    }
    rules.split(|rule| matches!(rule, BundlerCssRule::Import(_)))
}

fn blocks_to_css<'p>(
    conditions: &[ImportConditionsRef],
    dest: &mut Printer<'p>,
    body: &dyn Fn(&mut Printer<'p>) -> Result<(), PrintErr>,
) -> Result<(), PrintErr> {
    match conditions {
        [] => body(dest),
        [outer, inner @ ..] => outer.blocks_to_css(dest, |d| blocks_to_css(inner, d, body)),
    }
}

/// Empty blocks have no effect, but the name of a layer still sets the layer order.
fn layer_order_to_css(
    conditions: &[ImportConditionsRef],
    dest: &mut Printer,
) -> Result<(), PrintErr> {
    let mut outer = conditions;
    while let [rest @ .., last] = outer {
        outer = rest;
        if let Some(name) = last.layer_name() {
            return blocks_to_css(outer, dest, &|d| {
                last.conditional_blocks_to_css(d, |d| {
                    layer::statement_to_css(core::slice::from_ref(name), d)
                })
            });
        }
    }
    Ok(())
}

/// An "@import" takes one set of conditions, so the inner ones go into nested data URL imports.
pub(crate) fn nest_external_imports<'a>(
    c: &LinkerContext<'_, 'a>,
    log: &mut bun_ast::Log,
    order: &mut [CssImportOrder<'a>],
) {
    let arena = c.graph.arena();
    for entry in order {
        let CssImportOrderKind::ExternalPath(path) = &mut entry.kind else {
            continue;
        };
        for condition in entry.conditions.iter().skip(1).rev() {
            let options = PrinterOptions {
                targets: Targets::for_bundler_target(c.options.target),
                minify: minifies_anything(c),
                ..Default::default()
            };
            let mut code = Vec::new();
            let mut printer = new_printer(c, arena, &mut code, &options, None);
            let printed = import::rule_to_css(path.pretty, Some(condition), &mut printer);
            if let Err(e) = printer.finish(printed) {
                log.add_error_fmt(
                    None,
                    Loc::EMPTY,
                    format_args!("Error generating CSS for import: {}", e),
                );
                continue;
            }
            let encoded = DataURL::encode_string_as_shortest_data_url(
                b"text/css",
                strings::trim(&code, b" \n\r\t"),
            );
            *path = Path::init(arena.alloc_slice_copy(&encoded));
        }
    }
}

/// The number of leading conditions that an entry shares with its neighbours.
#[derive(Clone, Copy)]
struct SharedAnonymousConditions {
    before: usize,
    after: usize,
}

/// The entries of one anonymous layer print in one block, so they open and close it only once.
fn shared_anonymous_conditions<'a>(
    order: &[CssImportOrder<'a>],
    i: usize,
) -> SharedAnonymousConditions {
    let shared = |a: &CssImportOrder<'a>, b: &CssImportOrder<'a>| {
        if matches!(a.kind, CssImportOrderKind::ExternalPath(_))
            || matches!(b.kind, CssImportOrderKind::ExternalPath(_))
        {
            return 0;
        }
        a.conditions
            .iter()
            .zip(b.conditions)
            .rposition(|(a, b)| {
                a.anonymous_layer_id.is_some() && a.anonymous_layer_id == b.anonymous_layer_id
            })
            .map_or(0, |last| last + 1)
    };
    SharedAnonymousConditions {
        before: i
            .checked_sub(1)
            .map_or(0, |prev| shared(&order[prev], &order[i])),
        after: order.get(i + 1).map_or(0, |next| shared(&order[i], next)),
    }
}

#[derive(Default)]
struct SharedBlockEdges {
    open: Vec<u8>,
    close: Vec<u8>,
    indent: u32,
}

impl SharedBlockEdges {
    fn close_into(&self, output: &mut Vec<u8>) {
        if self.indent != 0 {
            output.truncate((output.trim_ascii_end().len() + 1).min(output.len()));
            output.extend_from_slice(&self.close);
        }
    }
}

/// An entry that shares blocks with a neighbour prints only the edges that are
/// its own: it opens what the next entry goes on to use, or closes what the
/// previous entry opened. Both edges come from one print of the empty blocks,
/// and every rule printer writes a block the same way.
fn shared_block_edges(
    c: &LinkerContext,
    conditions: &[ImportConditionsRef],
    SharedAnonymousConditions { before, after }: SharedAnonymousConditions,
    arena: &Arena,
) -> Result<SharedBlockEdges, ()> {
    let (outer, inner) = (before.min(after), before.max(after));
    if inner == 0 {
        return Ok(SharedBlockEdges::default());
    }
    let indent_of = |conditions: &[ImportConditionsRef]| -> u32 {
        conditions
            .iter()
            .map(|c| {
                c.layer.is_some() as u32
                    + c.supports.is_some() as u32
                    + !c.media.media_queries.is_empty() as u32
            })
            .sum::<u32>()
            * 2
    };
    let mut edges = SharedBlockEdges {
        indent: indent_of(&conditions[..inner]),
        ..Default::default()
    };
    if outer == inner {
        return Ok(edges);
    }

    let minify = c.options.minify_whitespace;
    let outer_indent = indent_of(&conditions[..outer]);
    let printer_options = PrinterOptions {
        minify,
        targets: Targets::for_bundler_target(c.options.target),
        indent: outer_indent,
        ..Default::default()
    };
    let mut printed: Vec<u8> = Vec::new();
    let mut printer = new_printer(c, arena, &mut printed, &printer_options, None);
    let blocks = blocks_to_css(&conditions[outer..inner], &mut printer, &|_| Ok(()));
    printer.finish(blocks).map_err(|_| ())?;
    let split = strings::last_index_of_char(&printed, b'{').map_or(0, |at| at + 1);
    let (open, close) = printed.split_at(split);
    if before < after {
        if !minify {
            edges
                .open
                .extend(core::iter::repeat_n(b' ', outer_indent as usize));
        }
        edges.open.extend_from_slice(open);
        if !minify {
            edges.open.push(b'\n');
        }
    } else {
        let first_brace = strings::index_of_char_usize(close, b'}').unwrap_or(0);
        let line = strings::last_index_of_char(&close[..first_brace], b'\n').map_or(0, |at| at + 1);
        edges
            .close
            .extend_from_slice(close[line..].trim_ascii_end());
        if !minify {
            edges.close.push(b'\n');
        }
    }
    Ok(edges)
}
