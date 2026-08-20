//! Marks the bake routes (server entry point chunks) that transitively import a `"use client"` file.

use crate::mal_prelude::*;
use bun_alloc::AllocError;
use bun_collections::AutoBitSet;
use bun_core::env_var;

use crate::chunk::{self, Chunk};
use crate::options::{OutputKind, Target};
use crate::{LinkerContext, UseDirective};

pub(crate) fn mark_chunks_with_transitive_use_client(
    c: &LinkerContext,
    chunks: &mut [Chunk],
) -> Result<(), AllocError> {
    // Same condition under which `generate_chunks_in_parallel` reads the flag.
    if c.dev_server.is_some()
        || !c
            .framework
            .is_some_and(|framework| framework.server_components.is_some())
    {
        return Ok(());
    }

    // Disabling the visitor keeps every route dynamic instead of silently classifying it as fully static.
    let disabled = cfg!(debug_assertions)
        && env_var::BUN_SSG_DISABLE_STATIC_ROUTE_VISITOR
            .get()
            .unwrap_or(false);
    let reaching = if disabled {
        None
    } else {
        Some(files_reaching_client(c)?)
    };
    let entry_point_kinds = c.graph.files.items_entry_point_kind();
    let targets = c.graph.ast.items_target();

    for chunk in chunks {
        if !matches!(chunk.content, chunk::Content::Javascript(_))
            || !chunk.entry_point.is_entry_point()
        {
            continue;
        }
        let source_index = chunk.entry_point.source_index();
        // Routes are the user specified entry points of the server graph.
        if entry_point_kinds[source_index as usize].output_kind() != OutputKind::EntryPoint
            || targets[source_index as usize] == Target::Browser
        {
            continue;
        }
        if reaching
            .as_ref()
            .is_none_or(|r| r.is_set(source_index as usize))
        {
            chunk.flags.insert(chunk::Flags::HAS_TRANSITIVE_USE_CLIENT);
        }
    }

    Ok(())
}

/// The client reference proxies and every file that transitively imports one, by reverse BFS over the linker's import records.
fn files_reaching_client(c: &LinkerContext) -> Result<AutoBitSet, AllocError> {
    let import_records = c.graph.ast.items_import_records();
    let file_count = import_records.len();
    let mut reaching = AutoBitSet::init_empty(file_count)?;

    let boundaries = &c.parse_graph().server_component_boundaries.list;
    let mut worklist: Vec<u32> = Vec::new();
    for (&proxy, use_directive) in boundaries
        .items_reference_source_index()
        .iter()
        .zip(boundaries.items_use_directive())
    {
        if *use_directive == UseDirective::Client && !reaching.is_set(proxy as usize) {
            reaching.set(proxy as usize);
            worklist.push(proxy);
        }
    }
    if worklist.is_empty() {
        return Ok(reaching);
    }

    // CSR by imported file: the importers of `file` are `importers[importer_offsets[file]..importer_offsets[file + 1]]`.
    let edges = import_records
        .iter()
        .enumerate()
        .flat_map(|(importer, records)| {
            records
                .iter()
                .filter(|record| record.source_index.is_valid())
                .map(move |record| (importer as u32, record.source_index.get() as usize))
        });

    let mut importer_offsets = vec![0usize; file_count + 1];
    for (_, imported) in edges.clone() {
        importer_offsets[imported + 1] += 1;
    }
    for file in 0..file_count {
        importer_offsets[file + 1] += importer_offsets[file];
    }
    let mut importers = vec![0u32; importer_offsets[file_count]];
    let mut next_slot = importer_offsets[..file_count].to_vec();
    for (importer, imported) in edges {
        importers[next_slot[imported]] = importer;
        next_slot[imported] += 1;
    }

    while let Some(file) = worklist.pop() {
        let file = file as usize;
        for &importer in &importers[importer_offsets[file]..importer_offsets[file + 1]] {
            if !reaching.is_set(importer as usize) {
                reaching.set(importer as usize);
                worklist.push(importer);
            }
        }
    }

    Ok(reaching)
}
