use core::mem::size_of;

use crate::api::server::html_bundle::HTMLBundleRoute;
use crate::bake::dev_server::{
    DevServer, HmrSocket, IncrementalResult, TestingBatchEvents, deferred_request, packed_map,
};
use bun_collections::ArrayHashMap;

#[derive(Clone, Copy, Default)]
pub struct MemoryCost {
    pub incremental_graph_client: usize,
    pub incremental_graph_server: usize,
    pub js_code: usize,
    pub source_maps: usize,
    pub assets: usize,
    pub other: usize,
}

pub(crate) fn memory_cost_detailed(dev: &DevServer) -> MemoryCost {
    let mut other_bytes: usize = size_of::<DevServer>();
    let mut incremental_graph_client: usize = 0;
    let mut incremental_graph_server: usize = 0;
    let mut js_code: usize = 0;
    let mut source_maps: usize = 0;
    let mut assets: usize = 0;

    // to be counted.
    // .root
    other_bytes += dev.root.len();
    // .router
    other_bytes += dev.router.memory_cost();
    // .route_bundles
    for bundle in dev.route_bundles.iter() {
        other_bytes += bundle.memory_cost();
    }
    // .server_graph
    {
        let cost = dev.server_graph.memory_cost_detailed();
        incremental_graph_server += cost.graph;
        js_code += cost.code;
        source_maps += cost.source_maps;
    }
    // .client_graph
    {
        let cost = dev.client_graph.memory_cost_detailed();
        incremental_graph_client += cost.graph;
        js_code += cost.code;
        source_maps += cost.source_maps;
    }
    // .barrel_files_with_deferrals
    // .barrel_needed_exports
    // .assets
    assets += dev.assets.memory_cost();
    // .active_websocket_connections
    other_bytes += dev.active_websocket_connections.capacity() * size_of::<*const HmrSocket>();
    // .source_maps
    other_bytes += memory_cost_array_hash_map(&dev.source_maps.entries);
    for entry in dev.source_maps.entries.values() {
        source_maps += entry.files.capacity() * size_of::<packed_map::Shared>();
        for file in entry.files.iter() {
            source_maps += file.memory_cost();
        }
    }
    // .incremental_result
    // TODO(port): exhaustiveness check for IncrementalResult fields (was bun.meta.useAllFields)
    {
        let _ = core::mem::size_of::<IncrementalResult>(); // anchor for grep
        // .had_adjusted_edges
        // .client_components_added
        other_bytes += memory_cost_array_list(&dev.incremental_result.client_components_added);
        // .framework_routes_affected
        other_bytes += memory_cost_array_list(&dev.incremental_result.framework_routes_affected);
        // .client_components_removed
        other_bytes += memory_cost_array_list(&dev.incremental_result.client_components_removed);
        // .failures_removed
        other_bytes += memory_cost_array_list(&dev.incremental_result.failures_removed);
        // .client_components_affected
        other_bytes += memory_cost_array_list(&dev.incremental_result.client_components_affected);
        // .failures_added
        other_bytes += memory_cost_array_list(&dev.incremental_result.failures_added);
        // .html_routes_soft_affected
        other_bytes += memory_cost_array_list(&dev.incremental_result.html_routes_soft_affected);
        // .html_routes_hard_affected
        other_bytes += memory_cost_array_list(&dev.incremental_result.html_routes_hard_affected);
    }
    // .has_tailwind_plugin_hack
    if let Some(hack) = &dev.has_tailwind_plugin_hack {
        other_bytes += memory_cost_array_hash_map(hack);
    }
    // .directory_watchers
    other_bytes += memory_cost_array_list(&dev.directory_watchers.dependencies);
    other_bytes += memory_cost_array_list(&dev.directory_watchers.dependencies_free_list);
    other_bytes += memory_cost_array_hash_map(&dev.directory_watchers.watches);
    for dep in dev.directory_watchers.dependencies.iter() {
        other_bytes += dep.specifier.len();
    }
    for dir_name in dev.directory_watchers.watches.keys() {
        other_bytes += dir_name.len();
    }
    // .html_router
    // std does not provide a way to measure exact allocation size of HashMapUnmanaged
    other_bytes +=
        dev.html_router.map.capacity() * (size_of::<*const HTMLBundleRoute>() + size_of::<&[u8]>());
    other_bytes += memory_cost_slice(dev.bundling_failures.values());
    for failure in dev.bundling_failures.values() {
        other_bytes += failure.data.len();
    }
    // All entries are owned by the bundler arena, not DevServer, except for `requests`
    // .current_bundle
    if let Some(bundle) = &dev.current_bundle {
        // PORT NOTE: Zig walked the intrusive list (`while (r) |req| : (r = req.next)`)
        // only to count nodes; `SinglyLinkedList::len()` does the same O(N) walk.
        other_bytes += bundle.requests.len() * size_of::<deferred_request::Node>();
    }
    // .next_bundle
    {
        other_bytes += dev.next_bundle.requests.len() * size_of::<deferred_request::Node>();
        other_bytes += memory_cost_array_hash_map(&dev.next_bundle.route_queue);
    }
    // .route_lookup
    other_bytes += memory_cost_array_hash_map(&dev.route_lookup);
    // .testing_batch_events
    match &dev.testing_batch_events {
        TestingBatchEvents::Disabled => {}
        TestingBatchEvents::Enabled(batch) => {
            other_bytes += memory_cost_array_hash_map(&batch.entry_points.set);
        }
        TestingBatchEvents::EnableAfterBundle => {}
    }

    MemoryCost {
        assets,
        incremental_graph_client,
        incremental_graph_server,
        js_code,
        other: other_bytes,
        source_maps,
    }
}

pub(crate) fn memory_cost(dev: &DevServer) -> usize {
    let cost = memory_cost_detailed(dev);
    // PORT NOTE: Zig iterated `@typeInfo(MemoryCost).@"struct".fields` to sum every
    // field. Rust has no field reflection; the sum is written out explicitly. Keep this
    // in sync with the `MemoryCost` struct definition above.
    let mut acc: usize = 0;
    acc += cost.incremental_graph_client;
    acc += cost.incremental_graph_server;
    acc += cost.js_code;
    acc += cost.source_maps;
    acc += cost.assets;
    acc += cost.other;
    acc
}

pub(crate) fn memory_cost_array_list<T>(slice: &Vec<T>) -> usize {
    slice.capacity() * size_of::<T>()
}

pub(crate) fn memory_cost_slice<T>(slice: &[T]) -> usize {
    std::mem::size_of_val(slice)
}

pub(crate) fn memory_cost_array_hash_map<K, V, C>(map: &ArrayHashMap<K, V, C>) -> usize {
    map.capacity() * (size_of::<K>() + size_of::<V>() + size_of::<u32>())
}

// ported from: src/bake/DevServer/memory_cost.zig
