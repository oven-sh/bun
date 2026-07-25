use crate::mal_prelude::*;
use bun_ast::StmtData;
use bun_ast::{ImportKind, Ref};
use bun_core::strings;

use crate::chunk::{self, Chunk};
use crate::options::Loader;
use crate::{LinkerContext, LinkerGraph};

/// For ESM output, collapse redundant external `import` statements that would
/// otherwise be repeated once per source file in the printed chunk.
///
/// Example (two input files each with `import * as ns from "pkg"`):
///
/// ```js
/// // before
/// import * as ns from "pkg";
/// import * as ns2 from "pkg";
/// // after
/// import * as ns from "pkg";
/// ```
///
/// Runs after `compute_chunks` (so `files_in_chunk_order` is populated) and
/// before `symbols.follow_all()`. For each chunk it walks files in output
/// order, and for every external `SImport` whose star / default / named
/// clauses are all already introduced by an earlier kept import of the same
/// path it (a) `symbols.merge`s the later refs into the earlier ones so every
/// use prints the same name, and (b) records the later statement in the
/// chunk's `external_import_records_to_skip` set so
/// `convert_stmts_for_chunk` drops it.
///
/// The merge is a global union-find link, which is safe even when the merge
/// target lives in a file outside the current chunk: each chunk's
/// `NumberRenamer` / `MinifyRenamer` owns its own name table and
/// `assign_name` calls `symbols.follow()` before assigning, so every chunk
/// that references the merged ref assigns (and prints) a local name for the
/// followed root. Suppression, on the other hand, is recorded per chunk so a
/// file shared between entry points still emits its import in any chunk where
/// it is the first importer of that path.
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
        loader: Option<Loader>,
        star_ref: Option<Ref>,
        default_ref: Option<Ref>,
        // (imported alias, local ref) for `import { alias as local }`
        items: Vec<(&'static [u8], Ref)>,
    }

    let mut seen: Vec<Entry> = Vec::new();

    for chunk in chunks.iter_mut() {
        let chunk::Content::Javascript(js) = &mut chunk.content else {
            continue;
        };

        seen.clear();

        for &source_index in js.files_in_chunk_order.iter() {
            let parts = all_parts[source_index as usize].as_slice();
            let import_records = all_import_records[source_index as usize].as_slice();
            let live = &parts_live[source_index as usize];

            for (part_index, part) in parts.iter().enumerate() {
                if !live.is_set(part_index) {
                    continue;
                }
                for stmt in part.stmts.slice() {
                    let StmtData::SImport(s) = stmt.data else {
                        continue;
                    };
                    let record = &import_records[s.import_record_index as usize];

                    use bun_ast::ImportRecordFlags as F;
                    if record.source_index.is_valid()
                        || record.kind != ImportKind::Stmt
                        || record.path.is_disabled
                        || record.flags.contains(F::IS_UNUSED)
                        || record.flags.contains(F::PHASE_DEFER)
                    {
                        continue;
                    }

                    let has_star = record.flags.contains(F::CONTAINS_IMPORT_STAR);
                    let default_ref = s.default_name.as_ref().map(|d| d.ref_);

                    let existing = seen.iter_mut().find(|e| {
                        e.loader == record.loader
                            && strings::eql(e.path_text, record.path.text)
                            && strings::eql(e.path_namespace, record.path.namespace)
                    });

                    let Some(entry) = existing else {
                        let mut items = Vec::with_capacity(s.items.len() as usize);
                        for item in s.items.slice() {
                            items.push((item.alias.slice(), item.name.ref_));
                        }
                        seen.push(Entry {
                            path_text: record.path.text,
                            path_namespace: record.path.namespace,
                            loader: record.loader,
                            star_ref: if has_star { Some(s.namespace_ref) } else { None },
                            default_ref,
                            items,
                        });
                        continue;
                    };

                    let star_covered = !has_star || entry.star_ref.is_some();
                    let default_covered = default_ref.is_none() || entry.default_ref.is_some();
                    let items_covered = s.items.slice().iter().all(|item| {
                        entry
                            .items
                            .iter()
                            .any(|(alias, _)| strings::eql(alias, item.alias.slice()))
                    });

                    if star_covered && default_covered && items_covered {
                        if has_star {
                            symbols.merge(s.namespace_ref, entry.star_ref.unwrap());
                        }
                        if let (Some(this_def), Some(entry_def)) = (default_ref, entry.default_ref)
                        {
                            symbols.merge(this_def, entry_def);
                        }
                        for item in s.items.slice() {
                            let canonical = entry
                                .items
                                .iter()
                                .find(|(alias, _)| strings::eql(alias, item.alias.slice()))
                                .map(|(_, r)| *r)
                                .unwrap();
                            symbols.merge(item.name.ref_, canonical);
                        }
                        let key =
                            ((source_index as u64) << 32) | (s.import_record_index as u64);
                        js.external_import_records_to_skip.insert(key, ());
                    } else {
                        // Not fully covered: the statement is kept. Record the
                        // clauses it introduces so a later import that only
                        // needs those can be dropped against this one.
                        if has_star && entry.star_ref.is_none() {
                            entry.star_ref = Some(s.namespace_ref);
                        }
                        if let (Some(this_def), None) = (default_ref, entry.default_ref) {
                            entry.default_ref = Some(this_def);
                        }
                        for item in s.items.slice() {
                            if !entry
                                .items
                                .iter()
                                .any(|(alias, _)| strings::eql(alias, item.alias.slice()))
                            {
                                entry.items.push((item.alias.slice(), item.name.ref_));
                            }
                        }
                    }
                }
            }
        }
    }
}
