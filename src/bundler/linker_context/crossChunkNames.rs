//! One bundle-wide name for every binding that crosses a chunk boundary.
//!
//! Left to themselves, the chunk that declares a binding and each chunk that
//! imports it rename it independently, and the printer bridges the two with
//! `export { x as Qc }` / `import { Qc as ur }`. Instead, once every chunk's
//! renamer has counted symbol uses, each such binding gets a single name —
//! the shortest free names going to the most used bindings when minifying,
//! otherwise its own name made unique among them — and every chunk's renamer
//! pins that name before naming anything else. Exporter, alias and importer
//! then agree, so both clauses print bare names.

use crate::mal_prelude::*;
use bun_ast::Ref;
use bun_collections::StringHashMap;

use crate::bun_renamer as renamer;
use crate::bun_renamer::ChunkRenamer;
use crate::chunk::Content;
use crate::{Chunk, LinkerContext};
use std::io::Write as _;

/// The bindings in a deterministic order: chunk by chunk, each chunk's
/// cross-chunk exports in their (stable-ref sorted) clause order.
fn cross_chunk_refs(chunks: &[Chunk]) -> Vec<Ref> {
    let mut refs = Vec::new();
    for chunk in chunks {
        if let Content::Javascript(js) = &chunk.content {
            refs.extend_from_slice(js.exports_to_other_chunks.keys());
        }
    }
    refs
}

/// Names no chunk may use for a cross-chunk binding: keywords and the like,
/// every unbound or must-not-be-renamed name in any module scope of the
/// bundle, and the entry points' own export names. A per-chunk renamer only
/// avoids its own chunk's; a bundle-wide name has to avoid all of them.
fn reserved_names(
    c: &LinkerContext,
    chunks: &[Chunk],
) -> Result<StringHashMap<u32>, bun_alloc::AllocError> {
    let mut reserved = renamer::compute_initial_reserved_names(c.options.output_format)?;
    let scopes = c.graph.ast.items_module_scope();
    let export_aliases = c.graph.meta.items_sorted_and_filtered_export_aliases();
    for chunk in chunks {
        if let Content::Javascript(js) = &chunk.content {
            for &source_index in js.files_in_chunk_order.iter() {
                renamer::compute_reserved_names_for_scope(
                    &scopes[source_index as usize],
                    &c.graph.symbols,
                    &mut reserved,
                );
            }
        }
        // An entry point's own `export {}` names share its export namespace
        // with the cross-chunk exports it may carry.
        if chunk.entry_point.is_entry_point() {
            for alias in export_aliases[chunk.entry_point.source_index() as usize].iter() {
                reserved.put(alias, 1)?;
            }
        }
    }
    Ok(reserved)
}

fn intern(c: &LinkerContext, name: &[u8]) -> &'static [u8] {
    // SAFETY: the linker arena outlives every chunk, renamer and clause item
    // that holds one of these names (all dropped with the link pass).
    unsafe { bun_ptr::detach_lifetime_ref::<[u8]>(c.arena().alloc_slice_copy(name)) }
}

/// Without `--minify-identifiers`: each binding keeps its own name, numbered
/// only against reserved names and the other cross-chunk bindings. Runs
/// before the chunk renamers, which pin these and number the rest around them.
pub(crate) fn assign_unminified(
    c: &mut LinkerContext,
    chunks: &[Chunk],
) -> Result<(), crate::Error> {
    let refs = cross_chunk_refs(chunks);
    if refs.is_empty() {
        return Ok(());
    }
    let mut used = reserved_names(c, chunks)?;
    let mut buf: Vec<u8> = Vec::new();
    c.cross_chunk_names.reserve(refs.len());
    for ref_ in refs {
        let original = c
            .graph
            .symbols
            .get_const(ref_)
            .unwrap()
            .original_name
            .slice();
        let base = bun_core::MutableString::ensure_valid_identifier(original)?;
        let mut name: &[u8] = &base;
        // `used[base]` remembers the last suffix handed out for `base`, so a
        // run of bindings sharing one name does not re-probe 2, 3, ... each time.
        if let Some(last) = used.get(&*base).copied() {
            let mut tries = last.max(1);
            loop {
                tries += 1;
                buf.clear();
                buf.extend_from_slice(&base);
                write!(&mut buf, "{tries}").expect("Vec<u8> write");
                if !used.contains_key(buf.as_slice()) {
                    break;
                }
            }
            used.put(&base, tries)?;
            name = &buf;
        }
        used.put(name, 1)?;
        let name = intern(c, name);
        c.cross_chunk_names.insert(ref_, name);
    }
    Ok(())
}

/// With `--minify-identifiers`: runs between the chunk renamers' accumulate
/// and finish steps. Sums each binding's use count over every chunk that sees
/// it, hands out the shortest names in that order, and pins them in every
/// chunk's renamer so `finish` names the rest around them.
pub(crate) fn assign_minified(
    c: &mut LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), crate::Error> {
    let refs = cross_chunk_refs(chunks);
    if refs.is_empty() {
        return Ok(());
    }
    // Every chunk's renamer already reserved the keywords plus its own module
    // scopes' unbound / pinned names; a bundle-wide name avoids all of them.
    let mut reserved = StringHashMap::<u32>::default();
    let export_aliases = c.graph.meta.items_sorted_and_filtered_export_aliases();
    for chunk in chunks.iter() {
        if let ChunkRenamer::Minify(r) = &chunk.renamer {
            for (name, _) in r.reserved_names().iter() {
                reserved.put(name, 1)?;
            }
        }
        if chunk.entry_point.is_entry_point() {
            for alias in export_aliases[chunk.entry_point.source_index() as usize].iter() {
                reserved.put(alias, 1)?;
            }
        }
    }

    // (total count, first-seen order) per binding; most used first. Each
    // chunk contributes the count of the bindings it declares or imports.
    let mut index_of: bun_collections::HashMap<Ref, u32> = Default::default();
    let mut order: Vec<(u32, u32, Ref, bool)> = Vec::with_capacity(refs.len());
    for (i, &ref_) in refs.iter().enumerate() {
        let capital = c
            .graph
            .symbols
            .get_const(ref_)
            .unwrap()
            .must_start_with_capital_letter_for_jsx();
        index_of.insert(ref_, i as u32);
        order.push((0, i as u32, ref_, capital));
    }
    for chunk in chunks.iter() {
        let (Content::Javascript(js), ChunkRenamer::Minify(r)) = (&chunk.content, &chunk.renamer)
        else {
            continue;
        };
        let refs_here = js.exports_to_other_chunks.keys().iter().copied().chain(
            js.imports_from_other_chunks
                .values()
                .iter()
                .flat_map(|items| items.iter().map(|item| item.r#ref)),
        );
        for ref_ in refs_here {
            if let (Some(&i), Some(count)) = (index_of.get(&ref_), r.top_level_count(ref_)) {
                order[i as usize].0 = order[i as usize].0.saturating_add(count);
            }
        }
    }
    order.sort_unstable_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));

    // One name sequence for the bundle, tuned to its overall character mix.
    let mut freq = bun_ast::CharFreq { freqs: [0i32; 64] };
    let char_freqs = c.graph.ast.items_char_freq();
    for chunk in chunks.iter() {
        if let Content::Javascript(js) = &chunk.content {
            for &source_index in js.files_in_chunk_order.iter() {
                if let Some(char_freq) = &char_freqs[source_index as usize] {
                    freq.include(char_freq);
                }
            }
        }
    }
    let minifier = freq.compile();

    let mut name: Vec<u8> = Vec::with_capacity(16);
    let mut next: isize = 0;
    c.cross_chunk_names.reserve(refs.len());
    for &(_, _, ref_, capital) in &order {
        loop {
            minifier.number_to_minified_name(&mut name, next)?;
            next += 1;
            if reserved.contains_key(name.as_slice()) || (capital && name[0].is_ascii_lowercase()) {
                continue;
            }
            break;
        }
        let interned = intern(c, &name);
        c.cross_chunk_names.insert(ref_, interned);
    }

    // Pin in every chunk that declares or imports the binding.
    for chunk in chunks.iter_mut() {
        let Content::Javascript(js) = &chunk.content else {
            continue;
        };
        let ChunkRenamer::Minify(r) = &mut chunk.renamer else {
            continue;
        };
        for &ref_ in js.exports_to_other_chunks.keys() {
            r.pin(ref_, *c.cross_chunk_names.get(&ref_).unwrap())?;
        }
        for items in js.imports_from_other_chunks.values() {
            for item in items.iter() {
                r.pin(item.r#ref, *c.cross_chunk_names.get(&item.r#ref).unwrap())?;
            }
        }
    }
    Ok(())
}

/// Writes the names into the cross-chunk `export {}` / `import {}` clause items.
pub(crate) fn apply_to_clauses(c: &LinkerContext, chunks: &mut [Chunk]) {
    if c.cross_chunk_names.is_empty() {
        return;
    }
    for chunk in chunks.iter_mut() {
        let Content::Javascript(js) = &mut chunk.content else {
            continue;
        };
        for stmt in js
            .cross_chunk_suffix_stmts
            .iter_mut()
            .chain(js.cross_chunk_prefix_stmts.iter_mut())
        {
            let items = match &mut stmt.data {
                bun_ast::StmtData::SExportClause(clause) => clause.items.slice_mut(),
                bun_ast::StmtData::SImport(import) => import.items.slice_mut(),
                _ => continue,
            };
            for item in items {
                item.alias =
                    bun_ast::StoreStr::new(*c.cross_chunk_names.get(&item.name.ref_).unwrap());
            }
        }
    }
}
