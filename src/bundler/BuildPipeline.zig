//! Owner of long-lived state shared across one logical "build invocation".
//!
//! A `BuildPipeline` wraps one or more `BundleV2` instances that all
//! belong to the same logical build (a single top-level build plus its
//! transitively reachable `?bundle` sub-builds). Its purpose today is
//! the `Mode` enum: the single source of truth for oneshot vs
//! incremental dispatch. `BundleV2.mode()` reads from the pipeline and
//! routes the async-completion path accordingly. The `bake.DevServer`
//! allocates one persistent `.incremental` pipeline at init time and
//! shares it across every `BundleV2` it spawns; CLI builds and
//! `Bun.build()` allocate a fresh `.oneshot` pipeline per build.
//!
//! Sub-builds spawned from a `?bundle` import inherit the parent
//! `BundleV2`'s pipeline pointer and must NOT free it.

const BuildPipeline = @This();

mode: Mode,

pub const Mode = enum {
    /// One-shot build: every cache and watcher lives only for the
    /// duration of one top-level `BundleV2.generate*` invocation and
    /// is freed when it completes. Used by CLI builds, `Bun.build()`,
    /// `?bundle` import sub-builds, and `bake/production.zig`.
    oneshot,
    /// Persistent build: cached state lives across rebuilds. Used by
    /// `bake.DevServer` and, transitively, by every `JSBundle` in
    /// `--hot` mode that attaches to the shared dev server.
    incremental,
};

/// Allocate a fresh oneshot pipeline. Caller owns the result and must
/// call `deinit` when the build completes.
pub fn createOneshot() !*BuildPipeline {
    return bun.tryNew(BuildPipeline, .{ .mode = .oneshot });
}

/// Allocate a fresh incremental pipeline. Caller owns the result and
/// must call `deinit` when the dev session ends.
pub fn createIncremental() !*BuildPipeline {
    return bun.tryNew(BuildPipeline, .{ .mode = .incremental });
}

pub fn deinit(this: *BuildPipeline) void {
    bun.destroy(this);
}

const bun = @import("bun");
