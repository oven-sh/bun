pub const MemoryCost = @This();

incremental_graph_client: usize,
incremental_graph_server: usize,
js_code: usize,
source_maps: usize,
assets: usize,
other: usize,

/// Returns an estimation for how many bytes DevServer is explicitly aware of.
/// If this number stays constant but RSS grows, then there is a memory leak. If
/// this number grows out of control, then incremental garbage collection is not
/// good enough.
///
/// Memory measurements are important as DevServer has a long lifetime, but
/// unlike the HTTP server, it controls a lot of objects that are frequently
/// being added, removed, and changed (as the developer edits source files). It
/// is exponentially easy to mess up memory management.
pub fn memoryCostDetailed(dev: *DevServer) MemoryCost {
    var other_bytes: usize = @sizeOf(DevServer);
    var incremental_graph_client: usize = 0;
    var incremental_graph_server: usize = 0;
    var js_code: usize = 0;
    var source_maps: usize = 0;
    var assets: usize = 0;
    // See https://github.com/ziglang/zig/issues/21879
    useAllFields(DevServer, .{
        // does not contain pointers
        .assume_perfect_incremental_bundling = {},
        .bun_watcher = {},
        .bundles_since_last_error = {},
        .configuration_hash_key = {},
        .inspector_server_id = {},
        .deferred_request_pool = {},
        .dump_dir = {},
        .emit_incremental_visualizer_events = {},
        .emit_memory_visualizer_events = {},
        .frontend_only = {},
        .generation = {},
        .graph_safety_lock = {},
        .has_pre_crash_handler = {},
        .magic = {},
        .memory_visualizer_timer = {},
        .plugin_state = {},
        .server_register_update_callback = {},
        .server_fetch_function_callback = {},
        .watcher_atomics = {},

        // pointers that are not considered a part of DevServer
        .vm = {},
        .server = {},
        .server_transpiler = {},
        .client_transpiler = {},
        .ssr_transpiler = {},
        .log = {},
        .framework = {},
        .bundler_options = {},
        .allocation_scope = {},
        .broadcast_console_log_from_browser_to_server = {},
        // to be counted.
        .root = {
            other_bytes += dev.root.len;
        },
        .router = {
            other_bytes += dev.router.memoryCost();
        },
        .route_bundles = for (dev.route_bundles.items) |*bundle| {
            other_bytes += bundle.memoryCost();
        },
        .server_graph = {
            const cost = dev.server_graph.memoryCostDetailed();
            incremental_graph_server += cost.graph;
            js_code += cost.code;
            source_maps += cost.source_maps;
        },
        .client_graph = {
            const cost = dev.client_graph.memoryCostDetailed();
            incremental_graph_client += cost.graph;
            js_code += cost.code;
            source_maps += cost.source_maps;
        },
        .assets = {
            assets += dev.assets.memoryCost();
        },
        .active_websocket_connections = {
            other_bytes += dev.active_websocket_connections.capacity() * @sizeOf(*HmrSocket);
        },
        .source_maps = {
            other_bytes += memoryCostArrayHashMap(dev.source_maps.entries);
            for (dev.source_maps.entries.values()) |entry| {
                source_maps += entry.files.memoryCost();
                const files = entry.files.slice();
                for (0..files.len) |i| {
                    source_maps += files.get(i).memoryCost();
                }
            }
        },
        .incremental_result = useAllFields(IncrementalResult, .{
            .had_adjusted_edges = {},
            .client_components_added = {
                other_bytes += memoryCostArrayList(dev.incremental_result.client_components_added);
            },
            .framework_routes_affected = {
                other_bytes += memoryCostArrayList(dev.incremental_result.framework_routes_affected);
            },
            .client_components_removed = {
                other_bytes += memoryCostArrayList(dev.incremental_result.client_components_removed);
            },
            .failures_removed = {
                other_bytes += memoryCostArrayList(dev.incremental_result.failures_removed);
            },
            .client_components_affected = {
                other_bytes += memoryCostArrayList(dev.incremental_result.client_components_affected);
            },
            .failures_added = {
                other_bytes += memoryCostArrayList(dev.incremental_result.failures_added);
            },
            .html_routes_soft_affected = {
                other_bytes += memoryCostArrayList(dev.incremental_result.html_routes_soft_affected);
            },
            .html_routes_hard_affected = {
                other_bytes += memoryCostArrayList(dev.incremental_result.html_routes_hard_affected);
            },
        }),
        .has_tailwind_plugin_hack = if (dev.has_tailwind_plugin_hack) |hack| {
            other_bytes += memoryCostArrayHashMap(hack);
        },
        .directory_watchers = {
            other_bytes += memoryCostArrayList(dev.directory_watchers.dependencies);
            other_bytes += memoryCostArrayList(dev.directory_watchers.dependencies_free_list);
            other_bytes += memoryCostArrayHashMap(dev.directory_watchers.watches);
            for (dev.directory_watchers.dependencies.items) |dep| {
                other_bytes += dep.specifier.len;
            }
            for (dev.directory_watchers.watches.keys()) |dir_name| {
                other_bytes += dir_name.len;
            }
        },
        .html_router = {
            // std does not provide a way to measure exact allocation size of HashMapUnmanaged
            other_bytes += dev.html_router.map.capacity() * (@sizeOf(*HTMLBundle.HTMLBundleRoute) + @sizeOf([]const u8));
            // DevServer does not count the referenced HTMLBundle.HTMLBundleRoutes
        },
        .bundling_failures = {
            other_bytes += memoryCostSlice(dev.bundling_failures.keys());
            for (dev.bundling_failures.keys()) |failure| {
                other_bytes += failure.data.len;
            }
        },
        // All entries are owned by the bundler arena, not DevServer, except for `requests`
        .current_bundle = if (dev.current_bundle) |bundle| {
            var r = bundle.requests.first;
            while (r) |request| : (r = request.next) {
                other_bytes += @sizeOf(DeferredRequest.Node);
            }
        },
        .next_bundle = {
            var r = dev.next_bundle.requests.first;
            while (r) |request| : (r = request.next) {
                other_bytes += @sizeOf(DeferredRequest.Node);
            }
            other_bytes += memoryCostArrayHashMap(dev.next_bundle.route_queue);
        },
        .route_lookup = {
            other_bytes += memoryCostArrayHashMap(dev.route_lookup);
        },
        .testing_batch_events = switch (dev.testing_batch_events) {
            .disabled => {},
            .enabled => |batch| {
                other_bytes += memoryCostArrayHashMap(batch.entry_points.set);
            },
            .enable_after_bundle => {},
        },
    });
    return .{
        .assets = assets,
        .incremental_graph_client = incremental_graph_client,
        .incremental_graph_server = incremental_graph_server,
        .js_code = js_code,
        .other = other_bytes,
        .source_maps = source_maps,
    };
}

pub fn memoryCost(dev: *DevServer) usize {
    const cost = memoryCostDetailed(dev);
    var acc: usize = 0;
    inline for (@typeInfo(MemoryCost).@"struct".fields) |field| {
        acc += @field(cost, field.name);
    }
    return acc;
}

pub fn memoryCostArrayList(slice: anytype) usize {
    return slice.capacity * @sizeOf(@typeInfo(@TypeOf(slice.items)).pointer.child);
}
pub fn memoryCostSlice(slice: anytype) usize {
    return slice.len * @sizeOf(@typeInfo(@TypeOf(slice)).pointer.child);
}
pub fn memoryCostArrayHashMap(map: anytype) usize {
    return @TypeOf(map.entries).capacityInBytes(map.entries.capacity);
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const useAllFields = bun.meta.useAllFields;
const HTMLBundle = jsc.API.HTMLBundle;

const DevServer = bun.bake.DevServer;
const DeferredRequest = DevServer.DeferredRequest;
const HmrSocket = DevServer.HmrSocket;
const IncrementalResult = DevServer.IncrementalResult;
