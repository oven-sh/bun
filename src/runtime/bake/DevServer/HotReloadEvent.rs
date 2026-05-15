//! This task informs the DevServer's thread about new files to be bundled.
//!
//! Spec: src/runtime/bake/DevServer/HotReloadEvent.zig
//!
//! DISSOLVED — the Phase-A draft that lived here duplicated `HotReloadEvent`
//! (struct + `init_empty`/`reset`/`is_empty`/`append_file`/`append_dir`/
//! `process_file_list`/`run`) against `dev_server/mod.rs`. The duplicate
//! carried four spec divergences:
//!
//!   1. The struct used `#[repr(align(64))]`, `MaybeUninit<ConcurrentTask>`
//!      (from `bun_jsc::`) and `MaybeUninit<Instant>`, while the keystone uses
//!      no `repr`, plain `bun_event_loop::ConcurrentTask` and plain `Instant`.
//!      Neither was `repr(C)`, so the `.cast::<super::HotReloadEvent>()`
//!      bridges in `run()` transmuted between layout-incompatible types — UB
//!      on every deref through `next_bundle.reload_event` and
//!      `recycle_event_from_dev_server`.
//!   2. `run(first: &mut HotReloadEvent)` materialised `&mut DevServer` while
//!      `first` (an inline element of `dev.watcher_atomics.events[_]`) was
//!      still live — two aliasing `&mut` is immediate UB. The keystone now
//!      takes `*mut HotReloadEvent` and re-borrows per access.
//!   3. `process_file_list` swallowed OOM via `let _ = …` for
//!      `invalidate`/`append_css`/`get_or_put`; the keystone wraps each in
//!      `bun_core::handle_oom` per the Zig spec.
//!   4. The module was mounted as `hot_reload_event_body` but never
//!      re-exported, so all seven re-implemented functions were dead/shadow
//!      code.
//!
//! This file is no longer mounted (`dev_server/mod.rs` dropped the `#[path]`
//! entry); it remains on disk only as the `.rs` sibling of
//! `HotReloadEvent.zig` per PORTING.md, and re-exports the canonical type so
//! any stale `super::hot_reload_event_body::*` path that reappears resolves to
//! the single real type.

#![allow(unused_imports)]
#![warn(unused_must_use)]

pub use crate::bake::dev_server::HotReloadEvent;
