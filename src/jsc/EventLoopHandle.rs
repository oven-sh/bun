//! `jsc.EventLoopHandle` — non-owning reference to either the JS event loop or
//! the mini event loop.
//!
//! LAYERING: many tier-≤4 crates (`bun_install`, `bun_spawn`, `bun_shell`)
//! need `EventLoopHandle` without pulling in `bun_jsc`, so the type lives in
//! [`bun_event_loop::any_event_loop`] (`src/event_loop/AnyEventLoop.rs`),
//! where the `.js` arm holds an erased `*mut ()` and dispatches through
//! link-time `extern "Rust"` shims defined in `bun_jsc::event_loop`.
//!
//! This module is the thin shim that keeps the `bun_jsc::event_loop_handle`
//! path compiling. All behaviour lives in the lower crate; nothing here owns
//! logic.

pub use bun_event_loop::any_event_loop::{
    EnteredEventLoop, EventLoopHandle, EventLoopTask, EventLoopTaskPtr,
};
