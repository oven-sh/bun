use core::mem::size_of;

use crate::dev_server::{DeferredRequest, DevServer, HmrSocket, IncrementalResult, TestingBatchEvents};
use bun_collections::ArrayHashMap;
// TODO(port): HTMLBundle lives under bun.jsc.API in Zig but is defined in src/runtime/api/server/ — verify crate path in Phase B.
use bun_runtime::api::server::html_bundle::HTMLBundleRoute;

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
pub fn memory_cost_detailed(dev: &DevServer) -> MemoryCost {
    let mut other_bytes: usize = size_of::<DevServer>();
    let mut incremental_graph_client: usize = 0;
    let mut incremental_graph_server: usize = 0;
    let mut js_code: usize = 0;
    let mut source_maps: usize = 0;
    let mut assets: usize = 0;

    // See https://github.com/ziglang/zig/issues/21879
    // PORT NOTE: Zig used `useAllFields(DevServer, .{...})` to compile-time-assert that
    // every DevServer field is accounted for below. Rust has no equivalent; the field
    // list is preserved as comments so Phase B can wire a proc-macro or static-assert.
    // TODO(port): exhaustiveness check for DevServer fields (was bun.meta.useAllFields)

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
    //   .allocation_scope
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
        source_maps += entry.files.memory_cost();
        let files = entry.files.slice();
        for i in 0..files.len() {
            source_maps += files.get(i).memory_cost();
        }
    }
    // .incremental_result
    // TODO(port): exhaustiveness check for IncrementalResult fields (was bun.meta.useAllFields)
    {
        let _ = IncrementalResult::default; // anchor for grep
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
    other_bytes += dev.html_router.map.capacity()
        * (size_of::<*const HTMLBundleRoute>() + size_of::<&[u8]>());
    // DevServer does not count the referenced HTMLBundle.HTMLBundleRoutes
    // .bundling_failures
    other_bytes += memory_cost_slice(dev.bundling_failures.keys());
    for failure in dev.bundling_failures.keys() {
        other_bytes += failure.data.len();
    }
    // All entries are owned by the bundler arena, not DevServer, except for `requests`
    // .current_bundle
    if let Some(bundle) = &dev.current_bundle {
        let mut r = bundle.requests.first;
        while let Some(request) = r {
            // SAFETY: intrusive singly-linked list; nodes are valid while DevServer holds them.
            let request = unsafe { request.as_ref() };
            other_bytes += size_of::<<DeferredRequest as crate::dev_server::DeferredRequestNode>::Node>();
            // TODO(port): `DeferredRequest.Node` — verify Rust type name for the linked-list node wrapper.
            let _ = request; // suppress unused if Node size is all we need
            r = request.next;
        }
    }
    // .next_bundle
    {
        let mut r = dev.next_bundle.requests.first;
        while let Some(request) = r {
            // SAFETY: intrusive singly-linked list; nodes are valid while DevServer holds them.
            let request = unsafe { request.as_ref() };
            other_bytes += size_of::<<DeferredRequest as crate::dev_server::DeferredRequestNode>::Node>();
            // TODO(port): `DeferredRequest.Node` — verify Rust type name for the linked-list node wrapper.
            r = request.next;
        }
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

pub fn memory_cost(dev: &DevServer) -> usize {
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

pub fn memory_cost_array_list<T>(slice: &Vec<T>) -> usize {
    slice.capacity() * size_of::<T>()
}

pub fn memory_cost_slice<T>(slice: &[T]) -> usize {
    slice.len() * size_of::<T>()
}

pub fn memory_cost_array_hash_map<K, V>(map: &ArrayHashMap<K, V>) -> usize {
    // Zig: @TypeOf(map.entries).capacityInBytes(map.entries.capacity)
    // i.e. the MultiArrayList backing storage byte capacity.
    // TODO(port): ArrayHashMap must expose `capacity_in_bytes()` (entries MultiArrayList byte capacity).
    map.capacity_in_bytes()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/memory_cost.zig (216 lines)
//   confidence: medium
//   todos:      5
//   notes:      useAllFields exhaustiveness checks dropped (no Rust reflection); DeferredRequest.Node type path and ArrayHashMap::capacity_in_bytes need Phase B wiring.
// ──────────────────────────────────────────────────────────────────────────
