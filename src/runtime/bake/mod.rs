//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
//!
//! B-2: full draft (1436 lines, preserved in `bake_body.rs`) depends on
//! `bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, ZigStringSlice}`
//! method surface and `bun_runtime::api::js_bundler::Plugin` (self-reference
//! to gated module). DevServer/FrameworkRouter submodules are likewise gated.

// ─── gated Phase-A drafts (preserved, not compiled) ──────────────────────────
#[cfg(any())]
#[path = "bake_body.rs"]
mod bake_body;
#[cfg(any())]
#[path = "DevServer.rs"]
pub mod dev_server;
#[cfg(any())]
#[path = "FrameworkRouter.rs"]
pub mod framework_router;
#[cfg(any())]
#[path = "production.rs"]
pub mod production;

/// export default { app: ... };
pub const API_NAME: &str = "app";

// ─── opaque type surface ─────────────────────────────────────────────────────
// TODO(b2-blocked): bun_jsc::JSValue (method surface)
// TODO(b2-blocked): bun_jsc::ZigStringSlice
pub struct UserOptions(());
pub struct Framework(());
pub struct SplitBundlerOptions(());
pub struct StringRefList(());
pub mod dev_server {
    pub struct DevServer(());
}
pub mod framework_router {
    pub struct FrameworkRouter(());
}
pub use dev_server as DevServer;
pub use framework_router as FrameworkRouter;

pub mod production {
    /// Data used on each rendering thread. Contains all information in the
    /// bundle needed to render. Referred to as `pt` in variable/field naming,
    /// and `Bake::ProductionPerThread` in C++.
    ///
    /// Full struct (lifetime-parameterized, with `bundled_outputs`/`source_maps`
    /// fields) lives in the gated `production.rs` draft and depends on
    /// `bun_jsc::Strong` + `bun_bundler::OutputFile::Index`. Dependents
    /// (`bun_sourcemap_jsc`) only need the type identity for now.
    // TODO(b2-blocked): bun_jsc::Strong — un-gate full PerThread<'a> from production.rs.
    pub struct PerThread(());
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/bake.zig
//   confidence: low (B-2 thin un-gate)
// ──────────────────────────────────────────────────────────────────────────
