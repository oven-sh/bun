//! Port of `src/jsc/generated_classes_list.zig`.
//!
//! LAYERING: the Zig `Classes` struct is a flat namespace of
//! `pub const X = path.to.Y;` aliases mapping each `.classes.ts` class name to
//! its native backing type. Every target lives under `bun.api`, `bun.webcore`,
//! `bun.bake`, or `bun.SourceMap` — i.e. in the Rust crate graph, in
//! `bun_runtime` / `bun_sourcemap_jsc`, both of which **depend on** `bun_jsc`.
//! Re-exporting them here would create a hard cycle.
//!
//! Zig gets away with this because the whole tree is one lazy compilation unit
//! and `generated_classes_list.zig` is only consumed by the **Zig** codegen
//! output (`ZigGeneratedClasses.zig`, via `const Classes = jsc.GeneratedClassesList;`
//! at `generate-classes.ts:3296`). The **Rust** codegen output
//! (`generated_classes.rs`) does **not** consume this list — it resolves each
//! class to its Rust struct via `rustModuleResolver.resolveStruct`
//! (`generate-classes.ts:2602`/`:3450`) and is `include!`d into `bun_runtime`
//! where every backing type is already in scope.
//!
//! The single in-tree Zig consumer outside codegen
//! (`src/runtime/node/net/BlockList.zig:255` →
//! `bun.jsc.GeneratedClassesList.SocketAddress`) is ported as a direct
//! `crate::socket::socket_address::SocketAddress` import in `BlockList.rs`.
//!
//! Per the crate-level layering policy at `src/jsc/lib.rs:6-15` (and the
//! identical treatment of the `Jest`/`Expect`/`Subprocess` forward-dep aliases
//! at `lib.rs:1569` / `lib.rs:1786`), the Rust port drops the `Classes`
//! re-export hub from `bun_jsc` rather than stub it. Callers reference the
//! backing types directly from `bun_runtime::{api,webcore,test_runner,bake}` /
//! `bun_sourcemap_jsc`.
//!
//! No `pub mod Classes` is exported here; `bun_jsc::GeneratedClassesList` is
//! intentionally absent.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/generated_classes_list.zig (104 lines)
//   confidence: high
//   todos:      0
//   notes:      forward-dep alias hub → dropped per LAYERING (see module doc);
//               Rust codegen uses rustModuleResolver instead.
// ──────────────────────────────────────────────────────────────────────────
