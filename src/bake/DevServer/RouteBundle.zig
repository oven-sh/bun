pub const RouteBundle = @This();

pub const Index = bun.GenericIndex(u30, RouteBundle);

server_state: State,
/// There are two distinct types of route bundles.
data: union(enum) {
    /// FrameworkRouter provided route
    framework: Framework,
    /// HTMLBundle provided route
    html: HTML,
},
/// Generated lazily when the client JS is requested.
/// Invalidated when a downstream client module updates.
client_bundle: ?*StaticRoute,

/// If the client tries to load a script with the wrong generation, it will
/// receive a bundle that instantly reloads the page, implying a bundle
/// change has occurred while fetching the script.
client_script_generation: u32,

/// Reference count of how many HmrSockets say they are on this route. This
/// allows hot-reloading events to reduce the amount of times it traces the
/// graph.
active_viewers: u32,

pub const Framework = struct {
    route_index: Route.Index,

    /// Cached to avoid re-creating the array every request.
    /// TODO: Invalidated when a layout is added or removed from this route.
    cached_module_list: jsc.Strong.Optional,
    /// Cached to avoid re-creating the string every request.
    /// TODO: Invalidated when any client file associated with the route is updated.
    cached_client_bundle_url: jsc.Strong.Optional,
    /// Cached to avoid re-creating the array every request.
    /// Invalidated when the list of CSS files changes.
    cached_css_file_array: jsc.Strong.Optional,

    /// When state == .evaluation_failure, this is populated with the route
    /// evaluation error mirrored in the dev server hash map
    evaluate_failure: ?SerializedFailure,
};

pub const HTML = struct {
    /// DevServer increments the ref count of this bundle
    html_bundle: RefPtr(HTMLBundle.HTMLBundleRoute),
    bundled_file: IncrementalGraph(.client).FileIndex,
    /// Invalidated when the HTML file is modified, but not it's imports.
    /// The style tag is injected here.
    script_injection_offset: ByteOffset.Optional,
    /// The HTML file bundled, from the bundler.
    bundled_html_text: ?[]const u8,
    /// Derived from `bundled_html_text` + `client_script_generation`
    /// and css information. Invalidated when:
    /// - The HTML file itself modified.
    /// - The list of CSS files changes.
    /// - Any downstream file is rebundled.
    cached_response: ?*StaticRoute,

    const ByteOffset = bun.GenericIndex(u32, u8);
};

/// A union is not used so that `bundler_failure_logs` can re-use memory, as
/// this state frequently changes between `loaded` and the failure variants.
pub const State = enum {
    /// In development mode, routes are lazily built. This state implies a
    /// build of this route has never been run. It is possible to bundle the
    /// route entry point and still have an unqueued route if another route
    /// imports this one. This state is implied if `FrameworkRouter.Route`
    /// has no bundle index assigned.
    unqueued,
    /// A bundle associated with this route is happening
    bundling,
    /// A bundle associated with this route *will happen in the next bundle*
    deferred_to_next_bundle,
    /// This route was flagged for bundling failures. There are edge cases
    /// where a route can be disconnected from its failures, so the route
    /// imports has to be traced to discover if possible failures still
    /// exist.
    possible_bundling_failures,
    /// Loading the module at runtime had a failure. The error can be
    /// cleared by editing any file in the same hot-reloading boundary.
    evaluation_failure,
    /// Calling the request function may error, but that error will not be
    /// at fault of bundling, nor would re-bundling change anything.
    loaded,
};

pub const UnresolvedIndex = union(enum) {
    /// FrameworkRouter provides a fullstack server-side route
    framework: FrameworkRouter.Route.Index,
    /// HTMLBundle provides a frontend-only route, SPA-style
    html: *HTMLBundle.HTMLBundleRoute,
};

pub fn deinit(rb: *RouteBundle, allocator: Allocator) void {
    if (rb.client_bundle) |blob| blob.deref();
    switch (rb.data) {
        .framework => |*fw| {
            fw.cached_client_bundle_url.deinit();
            fw.cached_css_file_array.deinit();
            fw.cached_module_list.deinit();
        },
        .html => |*html| {
            if (html.bundled_html_text) |text| {
                allocator.free(text);
            }
            if (html.cached_response) |cached_response| {
                cached_response.deref();
            }
            html.html_bundle.deref();
        },
    }
}

pub fn sourceMapId(rb: *RouteBundle) SourceMapStore.Key {
    return .init(@as(u64, rb.client_script_generation) << 32);
}

pub fn invalidateClientBundle(rb: *RouteBundle, dev: *DevServer) void {
    if (rb.client_bundle) |bundle| {
        dev.source_maps.unref(rb.sourceMapId());
        bundle.deref();
        rb.client_bundle = null;
    }
    rb.client_script_generation = std.crypto.random.int(u32);
    switch (rb.data) {
        .framework => |*fw| fw.cached_client_bundle_url.clearWithoutDeallocation(),
        .html => |*html| if (html.cached_response) |cached_response| {
            cached_response.deref();
            html.cached_response = null;
        },
    }
}

pub fn memoryCost(rb: *const RouteBundle) usize {
    var cost: usize = @sizeOf(RouteBundle);
    if (rb.client_bundle) |bundle| cost += bundle.memoryCost();
    switch (rb.data) {
        .framework => {
            // the jsc.Strong.Optional children do not support memoryCost. likely not needed
            // .evaluate_failure is not owned
        },
        .html => |*html| {
            if (html.bundled_html_text) |text| cost += text.len;
            if (html.cached_response) |cached_response| cost += cached_response.memoryCost();
        },
    }
    return cost;
}

const std = @import("std");
const Allocator = std.mem.Allocator;

const bun = @import("bun");
const bake = bun.bake;
const jsc = bun.jsc;
const RefPtr = bun.ptr.RefPtr;
const HTMLBundle = jsc.API.HTMLBundle;
const StaticRoute = bun.api.server.StaticRoute;

const DevServer = bake.DevServer;
const IncrementalGraph = DevServer.IncrementalGraph;
const SerializedFailure = DevServer.SerializedFailure;
const SourceMapStore = DevServer.SourceMapStore;

const FrameworkRouter = bake.FrameworkRouter;
const Route = FrameworkRouter.Route;
