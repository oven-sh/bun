use std::sync::Arc;

use bun_jsc::Strong;
use bun_ptr::RefPtr;

use crate::dev_server::{DevServer, IncrementalGraph, SerializedFailure, SourceMapStore};
use crate::framework_router::{self, Route};
// TODO(port): verify crate paths for HTMLBundle (jsc.API.HTMLBundle) and StaticRoute (bun.api.server.StaticRoute)
use bun_jsc::api::html_bundle::{HTMLBundle, HTMLBundleRoute};
use bun_runtime::api::server::StaticRoute;

// Zig: `pub const Index = bun.GenericIndex(u30, RouteBundle);`
// TODO(port): Zig used u30 backing; Rust has no u30 — using u32 newtype. Reconcile with bun.GenericIndex port.
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
#[repr(transparent)]
pub struct Index(pub u32);

pub struct RouteBundle {
    pub server_state: State,
    /// There are two distinct types of route bundles.
    pub data: Data,
    /// Generated lazily when the client JS is requested.
    /// Invalidated when a downstream client module updates.
    pub client_bundle: Option<Arc<StaticRoute>>,

    /// If the client tries to load a script with the wrong generation, it will
    /// receive a bundle that instantly reloads the page, implying a bundle
    /// change has occurred while fetching the script.
    pub client_script_generation: u32,

    /// Reference count of how many HmrSockets say they are on this route. This
    /// allows hot-reloading events to reduce the amount of times it traces the
    /// graph.
    pub active_viewers: u32,
}

/// There are two distinct types of route bundles.
pub enum Data {
    /// FrameworkRouter provided route
    Framework(Framework),
    /// HTMLBundle provided route
    Html(HTML),
}

pub struct Framework {
    // TODO(port): Route.Index is a nested type in Zig (bun.GenericIndex newtype); reference the ported newtype here.
    pub route_index: framework_router::RouteIndex,

    /// Cached to avoid re-creating the array every request.
    /// TODO: Invalidated when a layout is added or removed from this route.
    pub cached_module_list: Strong,
    /// Cached to avoid re-creating the string every request.
    /// TODO: Invalidated when any client file associated with the route is updated.
    pub cached_client_bundle_url: Strong,
    /// Cached to avoid re-creating the array every request.
    /// Invalidated when the list of CSS files changes.
    pub cached_css_file_array: Strong,

    /// When state == .evaluation_failure, this is populated with the route
    /// evaluation error mirrored in the dev server hash map
    pub evaluate_failure: Option<SerializedFailure>,
}

pub struct HTML {
    /// DevServer increments the ref count of this bundle
    // TODO(port): bun.ptr.RefPtr — confirm mapping (intrusive refcount wrapper).
    pub html_bundle: RefPtr<HTMLBundleRoute>,
    // TODO(port): IncrementalGraph(.client).FileIndex — Zig comptime-enum-parameterized type.
    pub bundled_file: <IncrementalGraph as crate::dev_server::incremental_graph::Client>::FileIndex,
    /// Invalidated when the HTML file is modified, but not it's imports.
    /// The style tag is injected here.
    pub script_injection_offset: Option<ByteOffset>,
    /// The HTML file bundled, from the bundler.
    pub bundled_html_text: Option<Box<[u8]>>,
    /// Derived from `bundled_html_text` + `client_script_generation`
    /// and css information. Invalidated when:
    /// - The HTML file itself modified.
    /// - The list of CSS files changes.
    /// - Any downstream file is rebundled.
    pub cached_response: Option<Arc<StaticRoute>>,
}

// Zig: `const ByteOffset = bun.GenericIndex(u32, u8);` (nested in HTML)
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
#[repr(transparent)]
pub struct ByteOffset(pub u32);

/// A union is not used so that `bundler_failure_logs` can re-use memory, as
/// this state frequently changes between `loaded` and the failure variants.
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum State {
    /// In development mode, routes are lazily built. This state implies a
    /// build of this route has never been run. It is possible to bundle the
    /// route entry point and still have an unqueued route if another route
    /// imports this one. This state is implied if `FrameworkRouter.Route`
    /// has no bundle index assigned.
    Unqueued,
    /// A bundle associated with this route is happening
    Bundling,
    /// A bundle associated with this route *will happen in the next bundle*
    DeferredToNextBundle,
    /// This route was flagged for bundling failures. There are edge cases
    /// where a route can be disconnected from its failures, so the route
    /// imports has to be traced to discover if possible failures still
    /// exist.
    PossibleBundlingFailures,
    /// Loading the module at runtime had a failure. The error can be
    /// cleared by editing any file in the same hot-reloading boundary.
    EvaluationFailure,
    /// Calling the request function may error, but that error will not be
    /// at fault of bundling, nor would re-bundling change anything.
    Loaded,
}

pub enum UnresolvedIndex<'a> {
    /// FrameworkRouter provides a fullstack server-side route
    // TODO(port): FrameworkRouter.Route.Index nested newtype — reference ported type.
    Framework(framework_router::RouteIndex),
    /// HTMLBundle provides a frontend-only route, SPA-style
    Html(&'a HTMLBundleRoute),
}

// Zig `pub fn deinit(rb: *RouteBundle, allocator: Allocator) void` is fully subsumed by Drop:
//   - client_bundle: Option<Arc<StaticRoute>> drops (== blob.deref())
//   - Framework: Strong fields drop (== .deinit())
//   - HTML: bundled_html_text Box<[u8]> drops (== allocator.free(text))
//           cached_response Option<Arc<StaticRoute>> drops (== .deref())
//           html_bundle RefPtr drops (== .deref())
// No explicit `impl Drop for RouteBundle` needed.

impl RouteBundle {
    pub fn source_map_id(&self) -> SourceMapStore::Key {
        SourceMapStore::Key::init(u64::from(self.client_script_generation) << 32)
    }

    pub fn invalidate_client_bundle(&mut self, dev: &mut DevServer) {
        if self.client_bundle.is_some() {
            dev.source_maps.unref(self.source_map_id());
            // Dropping the Arc == bundle.deref(); setting None == rb.client_bundle = null
            self.client_bundle = None;
        }
        // TODO(port): std.crypto.random.int(u32) — route through Bun's RNG wrapper.
        self.client_script_generation = bun_core::random::next_u32();
        match &mut self.data {
            Data::Framework(fw) => fw.cached_client_bundle_url.clear_without_deallocation(),
            Data::Html(html) => {
                if html.cached_response.is_some() {
                    // Dropping the Arc == cached_response.deref()
                    html.cached_response = None;
                }
            }
        }
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<RouteBundle>();
        if let Some(bundle) = &self.client_bundle {
            cost += bundle.memory_cost();
        }
        match &self.data {
            Data::Framework(_) => {
                // the jsc.Strong.Optional children do not support memoryCost. likely not needed
                // .evaluate_failure is not owned
            }
            Data::Html(html) => {
                if let Some(text) = &html.bundled_html_text {
                    cost += text.len();
                }
                if let Some(cached_response) = &html.cached_response {
                    cost += cached_response.memory_cost();
                }
            }
        }
        cost
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/RouteBundle.zig (169 lines)
//   confidence: medium
//   todos:      6
//   notes:      GenericIndex/u30 newtypes, IncrementalGraph(.client).FileIndex, RefPtr mapping, and RNG call need Phase-B reconciliation; deinit folded into Drop.
// ──────────────────────────────────────────────────────────────────────────
