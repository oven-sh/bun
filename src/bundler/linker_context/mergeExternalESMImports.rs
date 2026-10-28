use crate::mal_prelude::*;

use bun_ast::ImportRecordFlags;
use bun_ast::Ref;
use bun_ast::StmtData;
use bun_collections::{AutoBitSet, HashMap};

use crate::chunk;
use crate::{Chunk, LinkerContext};

/// What the printer emits after `from`: the path and, from the loader, `with { type }`.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
struct PathKey<'a> {
    text: &'a [u8],
    loader: Option<bun_ast::Loader>,
}

/// The ref a kept statement in the current chunk declares for each binding.
#[derive(Default)]
struct Seen<'a> {
    star: Ref,
    default: Ref,
    /// Keyed by export name (`ClauseItem.alias`).
    items: HashMap<&'a [u8], Ref>,
}

#[inline]
fn pack(source_index: u32, import_record_index: u32) -> u64 {
    ((source_index as u64) << 32) | (import_record_index as u64)
}

/// The records `convert_stmts_for_chunk` leaves to print as plain `import`s.
fn prints_as_plain_import(record: &bun_ast::ImportRecord<'_>) -> bool {
    !record.source_index.is_valid()
        && !record.path.is_disabled
        && record.kind == bun_ast::ImportKind::Stmt
        && matches!(
            record.tag,
            bun_ast::import_record::Tag::None | bun_ast::import_record::Tag::Builtin
        )
        && !record
            .flags
            .intersects(ImportRecordFlags::IS_UNUSED | ImportRecordFlags::PHASE_DEFER)
}

/// #8671: drop external imports whose bindings an earlier statement in the chunk declares.
pub(crate) fn merge_external_esm_imports<'a>(c: &mut LinkerContext<'a>, chunks: &mut [Chunk]) {
    if !c.options.output_format.keep_es6_import_export_syntax() {
        return;
    }
    let _trace = bun_core::perf::trace("Bundler.mergeExternalESMImports");

    let all_parts = c.graph.ast.items_parts();
    let all_import_records = c.graph.ast.items_import_records();
    let module_scopes = c.graph.ast.items_module_scope();
    let parts_live = c.graph.parts_live.as_slice();
    let entry_bits = c.graph.files.items_entry_bits();

    let mut imports_external =
        bun_core::handle_oom(AutoBitSet::init_empty(all_import_records.len()));
    let mut any_imports_external = false;
    for (source_index, records) in all_import_records.iter().enumerate() {
        if records.as_slice().iter().any(prints_as_plain_import) {
            imports_external.set(source_index);
            any_imports_external = true;
        }
    }
    if !any_imports_external {
        return;
    }

    // Without splitting, a file is in the chunk of every entry point that reaches it.
    let copies_files = !c.graph.code_splitting
        && chunks
            .iter()
            .filter(|chunk| matches!(chunk.content, chunk::Content::Javascript(_)))
            .count()
            > 1;

    let mut seen: HashMap<PathKey<'a>, Seen<'a>> = HashMap::default();

    for chunk in chunks.iter_mut() {
        let js = match &mut chunk.content {
            chunk::Content::Javascript(js) => js,
            _ => continue,
        };

        seen.clear();

        for part_range in js.parts_in_chunk_in_order.iter() {
            let source_index = part_range.source_index.get();
            if !imports_external.is_set(source_index as usize) {
                continue;
            }
            let file_parts = all_parts[source_index as usize].as_slice();
            let file_records = all_import_records[source_index as usize].as_slice();
            let live = &parts_live[source_index as usize];

            for part_i in part_range.part_index_begin..part_range.part_index_end {
                if !live.is_set(part_i as usize) {
                    continue;
                }
                for stmt in file_parts[part_i as usize].stmts.iter() {
                    let StmtData::SImport(s) = stmt.data else {
                        continue;
                    };
                    let record = &file_records[s.import_record_index as usize];
                    if !prints_as_plain_import(record) {
                        continue;
                    }

                    let star_ref = record
                        .flags
                        .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                        .then(|| s.namespace_ref.to_nullable())
                        .flatten();
                    let default_ref = s.default_name.and_then(|d| d.ref_.to_nullable());
                    let items = s.items.slice();
                    let bindings = || {
                        star_ref
                            .into_iter()
                            .chain(default_ref)
                            .chain(items.iter().filter_map(|item| item.name.ref_.to_nullable()))
                    };
                    let symbols = &c.graph.symbols;
                    debug_assert!(
                        bindings()
                            .all(|r| !symbols.get_const(r).is_some_and(|symbol| symbol.has_link()))
                    );

                    let slot = bun_core::handle_oom(seen.get_or_put(PathKey {
                        text: record.path.text,
                        loader: record.loader,
                    }));
                    let path_already_imported = slot.found_existing;
                    let entry = slot.value_ptr;
                    if star_ref.is_none() && default_ref.is_none() && items.is_empty() {
                        // Bare `import "x"`: an earlier import of the path already evaluates it.
                        if path_already_imported {
                            js.redundant_external_imports
                                .push(pack(source_index, s.import_record_index));
                        }
                        continue;
                    }

                    // A ref another chunk already imports by name must keep its own declaration.
                    let introduces = |kept: Ref, ref_: Ref| {
                        kept.is_empty() || js.exports_to_other_chunks.contains_key(&ref_)
                    };
                    let must_keep = !path_already_imported
                        || star_ref.is_some_and(|r| introduces(entry.star, r))
                        || default_ref.is_some_and(|r| introduces(entry.default, r))
                        || items.iter().any(|item| {
                            item.name.ref_.to_nullable().is_some_and(|r| {
                                introduces(
                                    entry
                                        .items
                                        .get(item.alias.slice())
                                        .copied()
                                        .unwrap_or_default(),
                                    r,
                                )
                            })
                        })
                        // `symbols.merge` is bundle-wide, so a dropped statement's file must be in this chunk only.
                        || (copies_files && entry_bits[source_index as usize].count() != 1)
                        // Code that a direct `eval` runs can name the bindings of its file.
                        || module_scopes[source_index as usize].contains_direct_eval
                        // `symbols.merge` would give the kept symbol the name of a pinned one.
                        || bindings()
                            .any(|r| symbols.get_const(r).is_some_and(|symbol| symbol.must_not_be_renamed()));

                    if must_keep {
                        // Bindings overlapping an earlier statement stay distinct; the renamer suffixes them.
                        if let Some(ns) = star_ref
                            && entry.star.is_empty()
                        {
                            entry.star = ns;
                        }
                        if let Some(d) = default_ref
                            && entry.default.is_empty()
                        {
                            entry.default = d;
                        }
                        for item in items {
                            if let Some(item_ref) = item.name.ref_.to_nullable() {
                                let slot = bun_core::handle_oom(
                                    entry.items.get_or_put(item.alias.slice()),
                                );
                                if !slot.found_existing {
                                    *slot.value_ptr = item_ref;
                                }
                            }
                        }
                        continue;
                    }

                    let mut link = |dropped: Ref, kept: Ref| {
                        let root = c.graph.symbols.merge(dropped, kept);
                        debug_assert!(
                            entry_bits[dropped.source_index() as usize]
                                .subset_of(&entry_bits[root.source_index() as usize]),
                            "a chunk with the dropped import's file has no file that declares its binding",
                        );
                    };
                    if let Some(ns) = star_ref {
                        link(ns, entry.star);
                    }
                    if let Some(d) = default_ref {
                        link(d, entry.default);
                    }
                    for item in items {
                        if let Some(item_ref) = item.name.ref_.to_nullable()
                            && let Some(&kept) = entry.items.get(item.alias.slice())
                        {
                            link(item_ref, kept);
                        }
                    }
                    js.redundant_external_imports
                        .push(pack(source_index, s.import_record_index));
                }
            }
        }

        js.redundant_external_imports.sort_unstable();
    }
}

#[inline]
pub(crate) fn is_redundant_external_import(
    chunk: &Chunk,
    source_index: u32,
    import_record_index: u32,
) -> bool {
    let js = match &chunk.content {
        chunk::Content::Javascript(js) => js,
        _ => return false,
    };
    js.redundant_external_imports
        .binary_search(&pack(source_index, import_record_index))
        .is_ok()
}
