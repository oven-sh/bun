use crate::mal_prelude::*;

use bun_ast::ImportRecordFlags;
use bun_ast::Ref;
use bun_ast::StmtData;
use bun_collections::HashMap;

use crate::chunk;
use crate::{Chunk, LinkerContext};

/// Matches `js_printer::print_import_record_path` + the `with { type }` suffix.
#[derive(Clone, Copy, PartialEq, Eq)]
struct PathKey {
    text: &'static [u8],
    namespace: &'static [u8],
    print_namespace: bool,
    loader: Option<bun_ast::Loader>,
}

#[derive(Default)]
struct Seen {
    star: Ref,
    default: Ref,
    /// Keyed by the export name (`item.alias`) the clause binds.
    items: HashMap<Box<[u8]>, Ref>,
    any: bool,
}

#[inline]
fn pack(source_index: u32, import_record_index: u32) -> u64 {
    ((source_index as u64) << 32) | (import_record_index as u64)
}

/// #8671: drop per-file external imports whose every binding already appeared in this chunk.
pub fn merge_external_esm_imports(c: &mut LinkerContext, chunks: &mut [Chunk]) {
    if !c.options.output_format.keep_es6_import_export_syntax() {
        return;
    }
    // SAFETY: `symbols.merge` is graph-global, so it is only sound while each
    // source file lands in exactly one JS chunk; otherwise a merge for one
    // chunk can link two refs another chunk keeps as separate declarers.
    if !c.graph.code_splitting
        && chunks
            .iter()
            .filter(|ch| matches!(ch.content, chunk::Content::Javascript(_)))
            .count()
            > 1
    {
        return;
    }

    let all_parts = c.graph.ast.items_parts();
    let all_import_records = c.graph.ast.items_import_records();
    let parts_live = c.graph.parts_live.as_slice();

    let mut seen: HashMap<PathKey, Seen, PathKeyCtx> = HashMap::default();

    for chunk in chunks.iter_mut() {
        let js = match &mut chunk.content {
            chunk::Content::Javascript(js) => js,
            _ => continue,
        };

        seen.clear();

        for part_range in js.parts_in_chunk_in_order.iter() {
            let source_index = part_range.source_index.get();
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

                    if record.source_index.is_valid()
                        || record.path.is_disabled
                        || record.kind != bun_ast::ImportKind::Stmt
                        || !matches!(
                            record.tag,
                            bun_ast::import_record::Tag::None
                                | bun_ast::import_record::Tag::Builtin
                        )
                        || record.flags.intersects(
                            ImportRecordFlags::IS_UNUSED | ImportRecordFlags::PHASE_DEFER,
                        )
                    {
                        continue;
                    }

                    let key = PathKey {
                        text: record.path.text,
                        namespace: record.path.namespace,
                        print_namespace: record
                            .flags
                            .contains(ImportRecordFlags::PRINT_NAMESPACE_IN_PATH),
                        loader: record.loader,
                    };
                    let entry = bun_core::handle_oom(seen.get_or_put(key)).value_ptr;

                    let star_ref = record
                        .flags
                        .contains(ImportRecordFlags::CONTAINS_IMPORT_STAR)
                        .then(|| s.namespace_ref.to_nullable())
                        .flatten();
                    let default_ref = s.default_name.and_then(|d| d.ref_.to_nullable());

                    let must_keep = star_ref.is_some_and(|r| {
                        entry.star.is_empty() || js.exports_to_other_chunks.contains_key(&r)
                    }) || default_ref.is_some_and(|r| {
                        entry.default.is_empty() || js.exports_to_other_chunks.contains_key(&r)
                    }) || s.items.iter().any(|item| {
                        item.name.ref_.to_nullable().is_some_and(|r| {
                            !entry.items.contains_key(item.alias.slice())
                                || js.exports_to_other_chunks.contains_key(&r)
                        })
                    });

                    if must_keep || !entry.any {
                        // Kept: record new bindings; overlaps stay distinct so the renamer suffixes them.
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
                        for item in s.items.iter() {
                            let Some(item_ref) = item.name.ref_.to_nullable() else {
                                continue;
                            };
                            let alias: &[u8] = item.alias.slice();
                            if !entry.items.contains_key(alias) {
                                bun_core::handle_oom(
                                    entry.items.put(alias.to_vec().into_boxed_slice(), item_ref),
                                );
                            }
                        }
                    } else {
                        if let Some(ns) = star_ref {
                            let _ = c.graph.symbols.merge(ns, entry.star);
                        }
                        if let Some(d) = default_ref {
                            let _ = c.graph.symbols.merge(d, entry.default);
                        }
                        for item in s.items.iter() {
                            if let Some(item_ref) = item.name.ref_.to_nullable()
                                && let Some(&first) = entry.items.get(item.alias.slice())
                            {
                                let _ = c.graph.symbols.merge(item_ref, first);
                            }
                        }
                        js.redundant_external_imports
                            .push(pack(source_index, s.import_record_index));
                    }
                    entry.any = true;
                }
            }
        }

        js.redundant_external_imports.sort_unstable();
    }
}

#[inline]
pub fn is_redundant_external_import(
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

struct PathKeyCtx;

impl bun_collections::HashContext<PathKey> for PathKeyCtx {
    fn ctx_hash(key: &PathKey) -> u64 {
        bun_wyhash::hash(key.text)
            ^ bun_wyhash::hash_with_seed(bun_wyhash::hash(key.text), key.namespace)
                .wrapping_add(key.print_namespace as u64)
                .wrapping_add(key.loader.map_or(0xFF, |l| l as u8) as u64 * 131)
    }

    fn ctx_eql(a: &PathKey, b: &PathKey) -> bool {
        a == b
    }
}
