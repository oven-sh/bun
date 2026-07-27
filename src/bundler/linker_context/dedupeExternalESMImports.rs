use crate::mal_prelude::*;
use bun_ast::StmtData;
use bun_ast::{ImportKind, ImportRecordFlags, Ref, import_record::Tag as RecordTag};
use bun_core::strings;

use crate::chunk::{self, Chunk};
use crate::options::Loader;
use crate::{LinkerContext, LinkerGraph};

#[inline]
fn pack(source_index: u32, import_record_index: u32) -> u64 {
    ((source_index as u64) << 32) | (import_record_index as u64)
}

/// True if `dedupe_external_esm_imports` marked this `(source_index,
/// import_record_index)` as redundant for `chunk`.
#[inline]
pub fn is_redundant_external_import(
    chunk: &Chunk,
    source_index: u32,
    import_record_index: u32,
) -> bool {
    match &chunk.content {
        chunk::Content::Javascript(js) => js
            .external_import_records_to_skip
            .contains_key(&pack(source_index, import_record_index)),
        _ => false,
    }
}

/// Collapse redundant external ESM `import` statements per chunk. Two imports
/// are considered redundant only when they print the same `from` specifier and
/// bind an identical set of clauses (same star / default / named aliases):
/// within that equivalence class the later statements in the chunk are dropped
/// and their clause refs `symbols.merge`d into the first's. Partially
/// overlapping imports (e.g. `{x}` vs `{x, y}`) are left untouched; merging a
/// clause of a kept statement would let a different chunk's merge transitively
/// unify two refs that are both kept in a third chunk and so emit a duplicate
/// top-level binding.
pub fn dedupe_external_esm_imports(c: &mut LinkerContext, chunks: &mut [Chunk]) {
    if !c.options.output_format.keep_es6_import_export_syntax() {
        return;
    }

    let LinkerGraph {
        symbols,
        ast,
        parts_live,
        ..
    } = &mut c.graph;
    let all_parts = ast.items_parts();
    let all_import_records = ast.items_import_records();

    struct Entry {
        path_text: &'static [u8],
        path_namespace: &'static [u8],
        print_namespace: bool,
        loader: Option<Loader>,
        has_star: bool,
        star_ref: Ref,
        default_ref: Option<Ref>,
        items: Vec<(&'static [u8], Ref)>,
        bare_key: u64,
    }

    let mut seen: Vec<Entry> = Vec::new();
    let mut aliases: Vec<&'static [u8]> = Vec::new();

    for chunk in chunks.iter_mut() {
        let chunk::Content::Javascript(js) = &mut chunk.content else {
            continue;
        };

        seen.clear();

        for part_range in js.parts_in_chunk_in_order.iter() {
            let source_index = part_range.source_index.get();
            let parts = all_parts[source_index as usize].as_slice();
            let import_records = all_import_records[source_index as usize].as_slice();
            let live = &parts_live[source_index as usize];

            for part_i in part_range.part_index_begin..part_range.part_index_end {
                if !live.is_set(part_i as usize) {
                    continue;
                }
                for stmt in parts[part_i as usize].stmts.slice() {
                    let StmtData::SImport(s) = stmt.data else {
                        continue;
                    };
                    let record = &import_records[s.import_record_index as usize];

                    if record.source_index.is_valid()
                        || record.kind != ImportKind::Stmt
                        || record.path.is_disabled
                        || !matches!(record.tag, RecordTag::None | RecordTag::Builtin)
                        || record.flags.intersects(
                            ImportRecordFlags::IS_UNUSED | ImportRecordFlags::PHASE_DEFER,
                        )
                    {
                        continue;
                    }

                    let has_star = record
                        .flags
                        .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR);
                    let default_ref = s.default_name.as_ref().and_then(|d| d.ref_.to_nullable());
                    let print_namespace = record
                        .flags
                        .contains(ImportRecordFlags::PRINT_NAMESPACE_IN_PATH);

                    aliases.clear();
                    for item in s.items.slice() {
                        aliases.push(item.alias.slice());
                    }
                    aliases.sort_unstable();

                    let same_path = |e: &Entry| {
                        e.loader == record.loader
                            && e.print_namespace == print_namespace
                            && strings::eql(e.path_text, record.path.text)
                            && strings::eql(e.path_namespace, record.path.namespace)
                    };

                    // A bare `import "pkg"` is pure side-effect; any other kept
                    // import for the same specifier (before or after) makes it
                    // redundant. `bare_key` lets a later binding import drop it
                    // retroactively.
                    if !has_star && default_ref.is_none() && aliases.is_empty() {
                        if seen.iter().any(same_path) {
                            js.external_import_records_to_skip
                                .insert(pack(source_index, s.import_record_index), ());
                        } else {
                            seen.push(Entry {
                                path_text: record.path.text,
                                path_namespace: record.path.namespace,
                                print_namespace,
                                loader: record.loader,
                                has_star: false,
                                star_ref: Ref::NONE,
                                default_ref: None,
                                items: Vec::new(),
                                bare_key: pack(source_index, s.import_record_index),
                            });
                        }
                        continue;
                    }

                    if let Some(bare) = seen.iter_mut().find(|e| e.bare_key != 0 && same_path(e)) {
                        js.external_import_records_to_skip.insert(bare.bare_key, ());
                        bare.bare_key = 0;
                    }

                    let existing = seen.iter().find(|e| {
                        same_path(e)
                            && e.has_star == has_star
                            && e.default_ref.is_some() == default_ref.is_some()
                            && e.items.len() == aliases.len()
                            && e.items
                                .iter()
                                .zip(aliases.iter())
                                .all(|((a, _), b)| strings::eql(a, b))
                    });

                    let Some(entry) = existing else {
                        let mut items: Vec<(&'static [u8], Ref)> =
                            Vec::with_capacity(aliases.len());
                        for &alias in aliases.iter() {
                            let r = s
                                .items
                                .slice()
                                .iter()
                                .find(|it| strings::eql(it.alias.slice(), alias))
                                .and_then(|it| it.name.ref_.to_nullable())
                                .unwrap_or(Ref::NONE);
                            items.push((alias, r));
                        }
                        seen.push(Entry {
                            path_text: record.path.text,
                            path_namespace: record.path.namespace,
                            print_namespace,
                            loader: record.loader,
                            has_star,
                            star_ref: s.namespace_ref,
                            default_ref,
                            items,
                            bare_key: 0,
                        });
                        continue;
                    };

                    if has_star {
                        symbols.merge(s.namespace_ref, entry.star_ref);
                    }
                    if let (Some(this_def), Some(entry_def)) = (default_ref, entry.default_ref) {
                        symbols.merge(this_def, entry_def);
                    }
                    for item in s.items.slice() {
                        let Some(item_ref) = item.name.ref_.to_nullable() else {
                            continue;
                        };
                        if let Some((_, canonical)) = entry
                            .items
                            .iter()
                            .find(|(a, _)| strings::eql(a, item.alias.slice()))
                        {
                            if canonical.is_valid() {
                                symbols.merge(item_ref, *canonical);
                            }
                        }
                    }
                    js.external_import_records_to_skip
                        .insert(pack(source_index, s.import_record_index), ());
                }
            }
        }
    }
}
