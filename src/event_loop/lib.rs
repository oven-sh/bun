#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod AutoFlusher;
pub mod AnyTask;
pub mod ManagedTask;
pub mod DeferredTaskQueue;
pub mod AnyTaskWithExtraContext;
pub mod ConcurrentTask;
pub mod EventLoopTimer;

// ────────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: the Phase-A draft bodies below depend on lower-tier
// symbols that are themselves still gated or absent (bun_uws crate,
// bun_sys::windows::libuv, bun_core::Timespec, bun_core::Output::DescriptorType,
// bun_collections::LinearFifo, bun_aio::file_poll::Store methods,
// bun_dotenv::Loader::init/instance). Preserve the drafts behind cfg(any())
// and expose a minimal stub surface so dependents can name the types.
// Un-gating happens in B-2 once the lower tiers are real.
// ────────────────────────────────────────────────────────────────────────────

#[cfg(any())]
#[path = "AnyEventLoop.rs"]
pub mod any_event_loop_draft;
#[cfg(any())]
#[path = "SpawnSyncEventLoop.rs"]
pub mod spawn_sync_event_loop_draft;
#[cfg(any())]
#[path = "MiniEventLoop.rs"]
pub mod mini_event_loop_draft;

// ─── stub surface ───────────────────────────────────────────────────────────

pub use AnyTask::JsResult;
pub use ConcurrentTask::{Task, TaskTag, task_tag};

/// Stub `MiniEventLoop` module — real one in MiniEventLoop.rs (gated).
pub mod MiniEventLoop {
    /// TODO(b1): real impl in MiniEventLoop.rs.
    pub struct MiniEventLoop;
    pub type Task = crate::AnyTaskWithExtraContext::AnyTaskWithExtraContext;
    impl MiniEventLoop {
        pub fn init_global(
            _env: *mut (), /* bun_dotenv::Loader */
            _console: *mut (),
        ) -> &'static mut MiniEventLoop {
            todo!("B-2: MiniEventLoop::init_global")
        }
    }
}

/// Stub `AnyEventLoop` module — real one in AnyEventLoop.rs (gated).
pub mod AnyEventLoop {
    /// TODO(b1): real impl in AnyEventLoop.rs (vtable-based union over
    /// jsc::EventLoop / MiniEventLoop / SpawnSyncEventLoop).
    pub struct AnyEventLoop;
    /// TODO(b1): tagged-ptr handle wrapping AnyEventLoop variants.
    #[derive(Copy, Clone)]
    pub struct EventLoopHandle(pub *mut ());
    /// TODO(b1): enum { js, mini } discriminant for EventLoopHandle.
    #[derive(Copy, Clone, Eq, PartialEq)]
    pub enum EventLoopKind {
        Js,
        Mini,
    }
}
pub use AnyEventLoop::{EventLoopHandle, EventLoopKind};

/// Stub `SpawnSyncEventLoop` module — real one in SpawnSyncEventLoop.rs (gated).
pub mod SpawnSyncEventLoop {
    /// TODO(b1): real impl in SpawnSyncEventLoop.rs.
    pub struct SpawnSyncEventLoop;
}
