//! `DevServer.RouteBundle` — per-navigatable-route bundling state.

use super::incremental_graph;
use super::jsc;
use super::serialized_failure::SerializedFailure;
use super::source_map_store;
use crate::bake::framework_router;
use crate::server::{StaticRoute, html_bundle::HTMLBundleRoute};

/// `bun.GenericIndex(u30, RouteBundle)`.
pub enum RouteBundleMarker {}
pub(crate) type Index = bun_core::GenericIndex<u32, RouteBundleMarker>;
/// `Index.Optional` — packed sentinel in Zig; `Option` here (non-FFI).
pub(crate) type IndexOptional = Option<Index>;

/// `bun.GenericIndex(u32, u8)` — byte offset into `bundled_html_text`.
pub(crate) type ByteOffset = bun_core::GenericIndex<u32, u8>;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum State {
    Unqueued,
    Bundling,
    DeferredToNextBundle,
    PossibleBundlingFailures,
    EvaluationFailure,
    Loaded,
}

pub struct Framework {
    pub route_index: framework_router::RouteIndex,
    pub cached_module_list: jsc::StrongOptional,
    pub cached_client_bundle_url: jsc::StrongOptional,
    pub cached_css_file_array: jsc::StrongOptional,
    pub evaluate_failure: Option<SerializedFailure>,
}

pub struct Html {
    pub html_bundle: *mut HTMLBundleRoute,
    pub bundled_file: incremental_graph::ClientFileIndex,
    pub script_injection_offset: Option<ByteOffset>,
    pub bundled_html_text: Option<Box<[u8]>>,
    pub cached_response: Option<bun_ptr::BackRef<StaticRoute>>,
}

pub enum Data {
    Framework(Framework),
    Html(Html),
}

impl Data {
    /// Zig: `data.framework` payload accessor (asserts active tag).
    pub(crate) fn framework(&self) -> &Framework {
        match self {
            Data::Framework(f) => f,
            Data::Html(_) => unreachable!("expected .framework"),
        }
    }
    /// Zig: `data.html` payload accessor (asserts active tag).
    pub(crate) fn html(&self) -> &Html {
        match self {
            Data::Html(h) => h,
            Data::Framework(_) => unreachable!("expected .html"),
        }
    }
    pub(crate) fn html_mut(&mut self) -> &mut Html {
        match self {
            Data::Html(h) => h,
            Data::Framework(_) => unreachable!("expected .html"),
        }
    }
}

impl RouteBundle {
    pub fn invalidate_client_bundle(&mut self, source_maps: &mut source_map_store::SourceMapStore) {
        if let Some(bundle) = self.client_bundle.take() {
            source_maps.unref(self.source_map_id());
            // SAFETY: `client_bundle` was produced by `StaticRoute::init_*`
            // (heap::alloc) and has its own ref held by this struct; no
            // outstanding `&`/`&mut` borrow exists across this call.
            unsafe { StaticRoute::deref_(bundle.as_ptr()) };
        }
        // Zig: `std.crypto.random.int(u32)` — OS CSPRNG.
        self.client_script_generation = {
            let mut buf = [0u8; 4];
            bun_core::csprng(&mut buf);
            u32::from_ne_bytes(buf)
        };
        match &mut self.data {
            Data::Framework(fw) => fw.cached_client_bundle_url.clear_without_deallocation(),
            Data::Html(html) => {
                if let Some(cached) = html.cached_response.take() {
                    // SAFETY: see `client_bundle` note above.
                    unsafe { StaticRoute::deref_(cached.as_ptr()) };
                }
            }
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum UnresolvedIndex {
    Framework(framework_router::RouteIndex),
    Html(*mut HTMLBundleRoute),
}

pub struct RouteBundle {
    pub server_state: State,
    pub data: Data,
    pub client_bundle: Option<bun_ptr::BackRef<StaticRoute>>,
    pub client_script_generation: u32,
    pub active_viewers: u32,
}

impl RouteBundle {
    #[inline]
    pub fn source_map_id(&self) -> source_map_store::Key {
        source_map_store::Key(u64::from(self.client_script_generation) << 32)
    }

    /// `RouteBundle.memoryCost` (RouteBundle.zig:137).
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<RouteBundle>();
        if let Some(bundle) = self.client_bundle.as_deref() {
            cost += bundle.memory_cost();
        }
        match &self.data {
            Data::Framework(_) => {
                // jsc.Strong.Optional children do not support memoryCost; not needed.
                // .evaluate_failure is not owned.
            }
            Data::Html(html) => {
                if let Some(text) = &html.bundled_html_text {
                    cost += text.len();
                }
                if let Some(cached) = html.cached_response.as_deref() {
                    cost += cached.memory_cost();
                }
            }
        }
        cost
    }
}
