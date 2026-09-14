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
/// plus every unbound or must-not-be-renamed name in any module scope of the
/// bundle. A per-chunk renamer only avoids its own chunk's; a bundle-wide
/// name has to avoid all of them.
fn reserved_names(
    c: &LinkerContext,
    chunks: &[Chunk],
) -> Result<StringHashMap<u32>, bun_alloc::AllocError> {
    let mut reserved = renamer::compute_initial_reserved_names(c.options.output_format)?;
    let scopes = c.graph.ast.items_module_scope();
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
        // An importing chunk's renamer looks the binding up by the symbol its links lead to.
        let followed = c.graph.symbols.follow(ref_);
        if !followed.eql(ref_) {
            c.cross_chunk_names.insert(followed, name);
        }
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
    for chunk in chunks.iter() {
        if let ChunkRenamer::Minify(r) = &chunk.renamer {
            for (name, _) in r.reserved_names().iter() {
                reserved.put(name, 1)?;
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
pub(crate) fn apply_to_clauses(
    c: &LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), bun_alloc::AllocError> {
    if c.cross_chunk_names.is_empty() {
        return Ok(());
    }
    let export_aliases = export_aliases_beside_entry_exports(c, chunks)?;
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
                let ref_ = item.name.ref_;
                let alias = export_aliases
                    .get(&ref_)
                    .unwrap_or_else(|| c.cross_chunk_names.get(&ref_).unwrap());
                item.alias = bun_ast::StoreStr::new(*alias);
            }
        }
    }
    Ok(())
}

/// Aliases for the bindings an ESM entry chunk exports to other chunks under
/// the name of one of its entry point's exports: `export { helper as helper2 }`,
/// `import { helper2 as helper }`. An item the entry point already exports is dropped.
fn export_aliases_beside_entry_exports(
    c: &LinkerContext,
    chunks: &mut [Chunk],
) -> Result<bun_collections::HashMap<Ref, &'static [u8]>, bun_alloc::AllocError> {
    let mut aliases: bun_collections::HashMap<Ref, &'static [u8]> = Default::default();
    let entry_export_names = c.graph.meta.items_sorted_and_filtered_export_aliases();
    let mut buf: Vec<u8> = Vec::new();
    for chunk in chunks.iter_mut() {
        if !chunk.entry_point.is_entry_point() {
            continue;
        }
        let source_index = chunk.entry_point.source_index() as usize;
        // A CommonJS entry point prints `export default require_x()` only.
        if entry_export_names[source_index].is_empty()
            || c.graph.meta.items_flags()[source_index].wrap == crate::WrapKind::Cjs
        {
            continue;
        }
        let Content::Javascript(js) = &mut chunk.content else {
            continue;
        };
        let [stmt] = js.cross_chunk_suffix_stmts.as_mut_slice() else {
            continue;
        };
        let bun_ast::StmtData::SExportClause(clause) = &mut stmt.data else {
            continue;
        };
        let items = clause.items.slice_mut();

        let mut taken = StringHashMap::<()>::default();
        for name in entry_export_names[source_index].iter() {
            taken.put(name, ())?;
        }
        // Cross-chunk names are unique, so a hit here is an entry export name.
        let mut colliding: Vec<usize> = Vec::new();
        for (i, item) in items.iter().enumerate() {
            let name = *c.cross_chunk_names.get(&item.name.ref_).unwrap();
            if taken.contains_key(name) {
                colliding.push(i);
            } else {
                taken.put(name, ())?;
            }
        }

        let mut dropped: Vec<usize> = Vec::new();
        for i in colliding {
            let ref_ = items[i].name.ref_;
            let name = *c.cross_chunk_names.get(&ref_).unwrap();
            if entry_export_binding(c, source_index, name).is_some_and(|exported| {
                c.graph.symbols.follow(exported) == c.graph.symbols.follow(ref_)
            }) {
                dropped.push(i);
                continue;
            }
            let mut tries = 1u32;
            loop {
                tries += 1;
                buf.clear();
                buf.extend_from_slice(name);
                write!(&mut buf, "{tries}").expect("Vec<u8> write");
                if !taken.contains_key(buf.as_slice()) {
                    break;
                }
            }
            taken.put(&buf, ())?;
            aliases.insert(ref_, intern(c, &buf));
        }
        if !dropped.is_empty() {
            let mut kept = 0;
            for i in 0..items.len() {
                if !dropped.contains(&i) {
                    items.swap(kept, i);
                    kept += 1;
                }
            }
            clause.items.truncate(kept);
        }
    }
    Ok(aliases)
}

/// The binding `generate_entry_point_tail_js` exports as `name`; `None` for a copy of a CommonJS property.
fn entry_export_binding(c: &LinkerContext, source_index: usize, name: &[u8]) -> Option<Ref> {
    let export = c.graph.meta.items_resolved_exports()[source_index].get(name)?;
    let mut ref_ = export.data.import_ref;
    if let Some(import) = c.graph.meta.items_imports_to_bind()[source_index].get(&ref_) {
        ref_ = import.data.import_ref;
    }
    if c.graph.symbols.get_const(ref_)?.namespace_alias.is_some() {
        return None;
    }
    Some(ref_)
}
