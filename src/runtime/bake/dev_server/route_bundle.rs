//! `DevServer.RouteBundle` — per-navigatable-route bundling state.

use super::incremental_graph;
use super::jsc;
use super::source_map_store;
use crate::bake::framework_router;
use crate::server::static_route::InitFromBytesOptions;
use crate::server::{StaticRoute, html_bundle::HTMLBundleRoute};
use crate::webcore::AnyBlob;

/// `bun.GenericIndex(u30, RouteBundle)`.
pub enum RouteBundleMarker {}
pub(crate) type Index = bun_core::GenericIndex<u32, RouteBundleMarker>;
pub(crate) type IndexOptional = Option<Index>;

/// `bun.GenericIndex(u32, u8)` — byte offset into `bundled_html_text`.
pub(crate) type ByteOffset = bun_core::GenericIndex<u32, u8>;

#[derive(Copy, Clone, Eq, PartialEq)]
pub enum State {
    Unqueued,
    Bundling,
    DeferredToNextBundle,
    PossibleBundlingFailures,
    Loaded,
}

pub struct Framework {
    pub(crate) route_index: framework_router::RouteIndex,
    pub(crate) cached_module_list: jsc::StrongOptional,
    pub(crate) cached_client_bundle_url: jsc::StrongOptional,
    pub(crate) cached_css_file_array: jsc::StrongOptional,
}

/// The one ref DevServer holds on a [`StaticRoute`] it built (client bundle,
/// rendered HTML page, asset, source map response); released on drop. The
/// `StaticRoute::on*` handlers take their own ref per in-flight response, so
/// the route itself may outlive this handle.
pub(crate) struct StaticRouteRef(bun_ptr::BackRef<StaticRoute, bun_ptr::Mut>);

impl StaticRouteRef {
    pub(crate) fn init_from_any_blob(blob: AnyBlob, options: InitFromBytesOptions<'_>) -> Self {
        let route = StaticRoute::init_from_any_blob(blob, options);
        // SAFETY: `route` is the fresh `heap::into_raw` allocation (non-null,
        // write provenance) carrying one ref, which this handle owns until
        // `Drop` releases it, so the pointee outlives the `BackRef`.
        Self(unsafe { bun_ptr::BackRef::from_raw_mut(route) })
    }

    /// For the `StaticRoute::on*` handlers, which take the route as the
    /// `*mut` they register as uws userdata.
    #[inline]
    pub(crate) fn as_ptr(&self) -> *mut StaticRoute {
        self.0.as_ptr()
    }
}

impl core::ops::Deref for StaticRouteRef {
    type Target = StaticRoute;
    #[inline]
    fn deref(&self) -> &StaticRoute {
        self.0.get()
    }
}

impl Drop for StaticRouteRef {
    #[inline]
    fn drop(&mut self) {
        <StaticRoute as bun_ptr::CellRefCounted>::deref_nn(self.0.into());
    }
}

pub struct Html {
    /// Ref taken in `get_or_put_route_bundle`; `RefPtr` has no `Drop`, so
    /// `Drop for Html` releases it.
    pub(crate) html_bundle: bun_ptr::RefPtr<HTMLBundleRoute>,
    pub(crate) bundled_file: incremental_graph::ClientFileIndex,
    pub(crate) script_injection_offset: Option<ByteOffset>,
    pub(crate) bundled_html_text: Option<Box<[u8]>>,
    /// The rendered page, built on first request.
    pub(crate) cached_response: Option<StaticRouteRef>,
}

impl Drop for Html {
    fn drop(&mut self) {
        self.html_bundle.deref();
    }
}

pub enum Data {
    Framework(Framework),
    Html(Html),
}

impl Data {
    /// `Framework` payload accessor (asserts active variant).
    pub(crate) fn framework(&self) -> &Framework {
        match self {
            Data::Framework(f) => f,
            Data::Html(_) => unreachable!("expected .framework"),
        }
    }
    /// `Html` payload accessor (asserts active variant).
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
    /// Note: takes `&mut SourceMapStore` rather than `&mut DevServer` —
    /// only `dev.source_maps` is touched, and the two keystone
    /// `DevServer` structs (`dev_server::DevServer` / `dev_server_body::DevServer`)
    /// both expose that field but cannot be named here without a cycle.
    pub(crate) fn invalidate_client_bundle(
        &mut self,
        source_maps: &mut source_map_store::SourceMapStore,
    ) {
        if self.client_bundle.take().is_some() {
            source_maps.unref(self.source_map_id());
        }
        self.client_script_generation = {
            let mut buf = [0u8; 4];
            bun_boringssl_sys::rand_bytes(&mut buf);
            u32::from_ne_bytes(buf)
        };
        match &mut self.data {
            Data::Framework(fw) => fw.cached_client_bundle_url.clear_without_deallocation(),
            Data::Html(html) => html.cached_response = None,
        }
    }
}

#[derive(Clone, Copy)]
pub(crate) enum UnresolvedIndex {
    Framework(framework_router::RouteIndex),
    /// BACKREF: `getOrPutRouteBundle` writes
    /// `dev_server_id` back through this pointer and `.initRef(html)` takes
    /// its own ref when stored. Carried as a raw mutable pointer (not `&`/
    /// `&mut`) so the writeback doesn't require a `&const → &mut` cast and
    /// the borrow doesn't conflict with `&mut DevServer`.
    Html(*mut HTMLBundleRoute),
}

pub struct RouteBundle {
    pub(crate) server_state: State,
    pub(crate) data: Data,
    /// The route's client-side script, built on first request.
    pub(crate) client_bundle: Option<StaticRouteRef>,
    pub(crate) client_script_generation: u32,
    pub(crate) active_viewers: u32,
}

impl RouteBundle {
    #[inline]
    pub(crate) fn source_map_id(&self) -> source_map_store::Key {
        source_map_store::Key(u64::from(self.client_script_generation) << 32)
    }

    /// Estimated heap bytes retained by this route bundle, for memory reporting.
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = core::mem::size_of::<RouteBundle>();
        if let Some(bundle) = self.client_bundle.as_deref() {
            cost += bundle.memory_cost();
        }
        match &self.data {
            Data::Framework(_) => {
                // jsc.Strong.Optional children do not support memoryCost; not needed.
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
