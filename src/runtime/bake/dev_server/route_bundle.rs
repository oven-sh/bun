//! `DevServer.RouteBundle` — per-navigatable-route bundling state.

use super::incremental_graph;
use super::jsc;
use super::serialized_failure::SerializedFailure;
use super::source_map_store;
use crate::bake::framework_router;
use crate::server::{html_bundle::HTMLBundleRoute, StaticRoute};

/// `bun.GenericIndex(u30, RouteBundle)`.
#[repr(transparent)]
#[derive(Debug, Clone, Copy, Eq, PartialEq, Hash)]
pub struct Index(pub u32);
impl Index {
    #[inline] pub const fn init(v: u32) -> Self { debug_assert!(v < (1 << 30)); Self(v) }
    #[inline] pub const fn get(self) -> u32 { self.0 }
    #[inline] pub const fn to_optional(self) -> IndexOptional { Some(self) }
}
/// `Index.Optional` — packed sentinel in Zig; `Option` here (non-FFI).
pub type IndexOptional = Option<Index>;

/// `bun.GenericIndex(u32, u8)` — byte offset into `bundled_html_text`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash)]
pub struct ByteOffset(pub u32);

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

/// Zig name alias (`RouteBundle.HTML`) — callers use the all-caps form.
pub type HTML = Html;

pub struct Html {
    /// SHARED (LIFETIMES.tsv): DevServer increments the route's intrusive
    /// refcount via `.initRef(html)` when storing; `.deref()` on drop.
    /// Stored as raw ptr because `HTMLBundleRoute` does not yet impl
    /// `bun_ptr::RefCounted` (gated server-side).
    // TODO(b2-blocked): bun_ptr::RefPtr<HTMLBundleRoute> once RefCounted impl is real.
    pub html_bundle: *mut HTMLBundleRoute,
    pub bundled_file: incremental_graph::ClientFileIndex,
    pub script_injection_offset: Option<ByteOffset>,
    pub bundled_html_text: Option<Box<[u8]>>,
    /// SHARED (LIFETIMES.tsv): deinit calls `cached_response.deref()`.
    pub cached_response: Option<core::ptr::NonNull<StaticRoute>>,
}

pub enum Data {
    Framework(Framework),
    Html(Html),
}

impl Data {
    /// Zig: `data.framework` payload accessor (asserts active tag).
    pub fn framework(&self) -> &Framework {
        match self {
            Data::Framework(f) => f,
            Data::Html(_) => unreachable!("expected .framework"),
        }
    }
    pub fn framework_mut(&mut self) -> &mut Framework {
        match self {
            Data::Framework(f) => f,
            Data::Html(_) => unreachable!("expected .framework"),
        }
    }
    /// Zig: `data.html` payload accessor (asserts active tag).
    pub fn html(&self) -> &Html {
        match self {
            Data::Html(h) => h,
            Data::Framework(_) => unreachable!("expected .html"),
        }
    }
    pub fn html_mut(&mut self) -> &mut Html {
        match self {
            Data::Html(h) => h,
            Data::Framework(_) => unreachable!("expected .html"),
        }
    }
}

impl RouteBundle {
    /// `RouteBundle.invalidateClientBundle` (RouteBundle.zig:122).
    ///
    /// PORT NOTE: takes `&mut SourceMapStore` rather than `&mut DevServer` —
    /// the Zig body only touches `dev.source_maps`, and the two keystone
    /// `DevServer` structs (`dev_server::DevServer` / `dev_server_body::DevServer`)
    /// both expose that field but cannot be named here without a cycle.
    pub fn invalidate_client_bundle(
        &mut self,
        source_maps: &mut source_map_store::SourceMapStore,
    ) {
        if let Some(bundle) = self.client_bundle.take() {
            source_maps.unref(self.source_map_id());
            // SAFETY: `client_bundle` was produced by `StaticRoute::init_*`
            // (Box::into_raw) and has its own ref held by this struct; no
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

pub enum UnresolvedIndex<'a> {
    Framework(framework_router::RouteIndex),
    /// BORROW_PARAM (LIFETIMES.tsv): `.initRef(html)` takes own ref when stored.
    Html(&'a HTMLBundleRoute),
}

pub struct RouteBundle {
    pub server_state: State,
    pub data: Data,
    /// SHARED (LIFETIMES.tsv): deinit calls `blob.deref()`.
    pub client_bundle: Option<core::ptr::NonNull<StaticRoute>>,
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
        if let Some(bundle) = self.client_bundle {
            // SAFETY: pointer is live for the lifetime of `self` (intrusive ref held).
            cost += unsafe { bundle.as_ref() }.memory_cost();
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
                if let Some(cached) = html.cached_response {
                    // SAFETY: pointer is live for the lifetime of `self`.
                    cost += unsafe { cached.as_ref() }.memory_cost();
                }
            }
        }
        cost
    }
}

// `deinit` is fully subsumed by Drop:
//   - client_bundle / cached_response: Option<Arc<StaticRoute>> drop = .deref()
//   - Framework: StrongOptional fields drop = .deinit()
//   - Html: bundled_html_text Box<[u8]> drop = allocator.free()
//           html_bundle RefPtr drop = .deref()
