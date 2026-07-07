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

/// Returns an estimation for how many bytes DevServer is explicitly aware of.
/// If this number stays constant but RSS grows, then there is a memory leak. If
/// this number grows out of control, then incremental garbage collection is not
/// good enough.
///
/// Memory measurements are important as DevServer has a long lifetime, but
/// unlike the HTTP server, it controls a lot of objects that are frequently
/// being added, removed, and changed (as the developer edits source files). It
/// is exponentially easy to mess up memory management.
pub(crate) fn memory_cost_detailed(dev: &DevServer) -> MemoryCost {
    let mut other_bytes: usize = size_of::<DevServer>();
    let mut incremental_graph_client: usize = 0;
    let mut incremental_graph_server: usize = 0;
    let mut js_code: usize = 0;
    let mut source_maps: usize = 0;
    let mut assets: usize = 0;

    // Exhaustiveness check:
    // destructuring without `..` fails to compile when a DevServer field is
    // added, removed, or renamed, forcing the accounting below to be updated.
    // All bindings are `_` so nothing is moved or borrowed past this block.
    {
        let DevServer {
            magic: _,
            root: _,
            inspector_server_id: _,
            configuration_hash_key: _,
            vm: _,
            server: _,
            router: _,
            route_bundles: _,
            graph_safety_lock: _,
            client_graph: _,
            server_graph: _,
            barrel_files_with_deferrals: _,
            barrel_needed_exports: _,
            incremental_result: _,
            route_lookup: _,
            html_router: _,
            assets: _,
            source_maps: _,
            bundling_failures: _,
            frontend_only: _,
            has_tailwind_plugin_hack: _,
            server_fetch_function_callback: _,
            server_register_update_callback: _,
            bun_watcher: _,
            directory_watchers: _,
            watcher_atomics: _,
            testing_batch_events: _,
            generation: _,
            bundles_since_last_error: _,
            framework: _,
            bundler_framework_views: _,
            bundler_options: _,
            server_transpiler: _,
            client_transpiler: _,
            ssr_transpiler: _,
            log: _,
            plugin_state: _,
            current_bundle: _,
            next_bundle: _,
            deferred_request_pool: _,
            active_websocket_connections: _,
            dump_dir: _,
            emit_incremental_visualizer_events: _,
            emit_memory_visualizer_events: _,
            memory_visualizer_timer: _,
            has_pre_crash_handler: _,
            assume_perfect_incremental_bundling: _,
            broadcast_console_log_from_browser_to_server: _,
        } = dev;
    }

    // does not contain pointers
    //   .assume_perfect_incremental_bundling
    //   .bun_watcher
    //   .bundles_since_last_error
    //   .configuration_hash_key
    //   .inspector_server_id
    //   .deferred_request_pool
    //   .dump_dir
    //   .emit_incremental_visualizer_events
    //   .emit_memory_visualizer_events
    //   .frontend_only
    //   .generation
    //   .graph_safety_lock
    //   .has_pre_crash_handler
    //   .magic
    //   .memory_visualizer_timer
    //   .plugin_state
    //   .server_register_update_callback
    //   .server_fetch_function_callback
    //   .watcher_atomics

    // pointers that are not considered a part of DevServer
    //   .vm
    //   .server
    //   .server_transpiler
    //   .client_transpiler
    //   .ssr_transpiler
    //   .log
    //   .framework
    //   .bundler_options
    //   .broadcast_console_log_from_browser_to_server

    // to be counted.
    // .root
    other_bytes += dev.root.len();
    // .router
    other_bytes += dev.router.memory_cost();
    // .route_bundles
    for bundle in dev.route_bundles.iter() {
        other_bytes += bundle.memory_cost();
    }
    // .bundler_framework_views (the pointed-to Frameworks are owned elsewhere;
    // count the Vec's own backing store)
    other_bytes += memory_cost_array_list(&dev.bundler_framework_views);
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
    {
        // Exhaustiveness check — fails to compile when
        // an IncrementalResult field is added/removed/renamed.
        let IncrementalResult {
            framework_routes_affected: _,
            html_routes_soft_affected: _,
            html_routes_hard_affected: _,
            had_adjusted_edges: _,
            client_components_added: _,
            client_components_removed: _,
            failures_removed: _,
            client_components_affected: _,
            failures_added: _,
        } = &dev.incremental_result;
        // .had_adjusted_edges (bool — no heap)
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
    // DevServer does not count the referenced HTMLBundle.HTMLBundleRoutes
    // .bundling_failures
    // The map stores `OwnerPacked → SerializedFailure`, so the failure
    // payloads live in `.values()`.
    other_bytes += memory_cost_slice(dev.bundling_failures.values());
    for failure in dev.bundling_failures.values() {
        other_bytes += failure.data.len();
    }
    // All entries are owned by the bundler arena, not DevServer, except for `requests`
    // .current_bundle
    if let Some(bundle) = &dev.current_bundle {
        // `SinglyLinkedList::len()` is an O(N) walk; only the node count matters.
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
    // Keep this in sync with the `MemoryCost` struct definition above.
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
    // `ArrayHashMap` stores three separate `Vec`s (keys, values, 32-bit
    // hashes), so the footprint is `capacity * (sizeof K + sizeof V + sizeof u32)`.
    map.capacity() * (size_of::<K>() + size_of::<V>() + size_of::<u32>())
}
