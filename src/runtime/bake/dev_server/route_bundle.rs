//! `DevServer.RouteBundle` — per-navigatable-route bundling state.
//!
//! Method bodies (`invalidate_client_bundle`, `memory_cost`) live in the gated
//! `../DevServer/RouteBundle.rs` draft (blocked on `bun_jsc::Strong` +
//! `StaticRoute::memory_cost`).

use std::sync::Arc;

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
    /// `RouteBundle.invalidateClientBundle` — full body in gated
    /// `../DevServer/RouteBundle.rs` draft.
    // PORT NOTE: `_dev` erased to `*mut ()` because `dev_server::DevServer` and
    // `dev_server_body::DevServer` are distinct keystone types pending unification.
    pub fn invalidate_client_bundle(&mut self, _dev: *mut ()) {
        todo!("blocked_on: dev_server::RouteBundle::invalidate_client_bundle body un-gate")
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
}

// `deinit` is fully subsumed by Drop:
//   - client_bundle / cached_response: Option<Arc<StaticRoute>> drop = .deref()
//   - Framework: StrongOptional fields drop = .deinit()
//   - Html: bundled_html_text Box<[u8]> drop = allocator.free()
//           html_bundle RefPtr drop = .deref()
