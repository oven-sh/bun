//! Bake is Bun's toolkit for building client+server web applications. It
//! combines `Bun.build` and `Bun.serve`, providing a hot-reloading development
//! server, server components, and other integrations. Instead of taking the
//! role as a framework, Bake is tool for frameworks to build on top of.
//!
//! This file holds the keystone DevServer struct + lifecycle so downstream
//! `server/` and the `bun_bundler::dispatch::DevServerVTable` can be wired.
//! The heavy method bodies (request handling, finalize_bundle, hot-update
//! tracing) live in `DevServer.rs` and the other `#[path]` submodules below.


use bun_core::Output;

#[path = "DevServer.rs"]
mod dev_server_body;
pub(crate) use dev_server_body::get_deinit_count_for_testing;
pub(crate) use dev_server_body::is_allowed_dev_host;
pub(crate) use dev_server_body::is_allowed_host_header;

pub(crate) mod router;

#[path = "production.rs"]
mod production_body;

// `Bun__add{Bake,DevServer}SourceProvider*` host exports — the Rust side of
// `BakeSourceProvider.h` / `DevServerSourceProvider.h`. Reached only via the
// codegen-emitted `extern "C"` thunks in `generated_host_exports.rs`.
pub(crate) mod source_provider_exports;

pub(crate) mod config;
pub(crate) mod hmr_runtime;
pub(crate) use config::{FileSystemRouterType, Framework, SplitBundlerOptions, UserOptions};
pub(crate) use hmr_runtime::{HmrRuntime, get_hmr_runtime};

/// All bake JSC references go through this re-export of `bun_jsc`.
pub(crate) mod jsc {
    /// `jsc.API.JSBundler.Plugin` — the C++ `BunPlugin` FFI handle. The
    /// canonical opaque struct lives in `bun_bundler::bundle_v2::api::JSBundler`
    /// (T5) and is re-exported through `crate::api::js_bundler` so the
    /// JSC-aware `PluginJscExt` methods are in scope; both paths name the same
    /// nominal type.
    pub(crate) use crate::api::js_bundler::Plugin;
    pub(crate) use crate::jsc::*;
}

// ══════════════════════════════════════════════════════════════════════════
// Top-level types
// ══════════════════════════════════════════════════════════════════════════

pub(crate) use bun_bundler::bake_types::BuiltInModule;
/// `bake.Side` / `bake.Graph` — these are TYPE_ONLY moved-down into
/// `bun_bundler::bake_types` (lower tier owns the canonical defs so the
/// bundler can name them without depending on `bun_runtime`). Re-export
/// here so intra-crate `bake::Side` paths resolve.
pub(crate) use bun_bundler::bake_types::{Graph, Side};

/// `bake.Mode`.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum Mode {
    Development,
    ProductionStatic,
}

impl Mode {
    pub(crate) fn output_format(self) -> bun_bundler::options::Format {
        match self {
            Mode::Development => bun_bundler::options::Format::InternalBakeDev,
            Mode::ProductionStatic => bun_bundler::options::Format::Esm,
        }
    }
}

pub(crate) fn print_warning() {
    // Silence this for the test suite
    if bun_core::env_var::BUN_DEV_SERVER_TEST_RUNNER
        .get()
        .is_none()
    {
        bun_core::warn!(
            "Be advised that Bun Bake is highly experimental, and its API\n\
             will have breaking changes. Join the <magenta>#bake<r> Discord\n\
             channel to help us find bugs: <blue>https://bun.com/discord<r>\n\
             \n"
        );
        Output::flush();
    }
}

// ══════════════════════════════════════════════════════════════════════════
// production
// ══════════════════════════════════════════════════════════════════════════
pub(crate) mod production {
    pub(crate) use super::production_body::{PerThread, build_command};
}

// ══════════════════════════════════════════════════════════════════════════
// DevServer
// ══════════════════════════════════════════════════════════════════════════
pub(crate) mod dev_server;
pub(crate) use dev_server as DevServer;
