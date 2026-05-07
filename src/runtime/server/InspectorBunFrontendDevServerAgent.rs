//! `BunFrontendDevServerAgent` is stored inline in `jsc::Debugger`, so the
//! canonical definition lives in `bun_jsc::debugger` (lower tier). This module
//! re-exports it for `bun_runtime` callers that ported the Zig
//! `@import("../runtime/server/InspectorBunFrontendDevServerAgent.zig")` path.

pub use crate::jsc::debugger::{
    BunFrontendDevServerAgent, InspectorBunFrontendDevServerAgentHandle,
};
// `Bun__InspectorBunFrontendDevServerAgent__setEnabled` thunk now emitted by
// `generate-host-exports.ts`; the safe-signature impl is
// `bun_jsc::debugger::frontend_dev_server_agent_set_enabled`.
pub use crate::generated_host_exports::Bun__InspectorBunFrontendDevServerAgent__setEnabled;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/server/InspectorBunFrontendDevServerAgent.zig (117 lines)
//   confidence: high
//   notes:      definition moved to bun_jsc::debugger (layering: stored inline
//               in Debugger). notify_client_navigated/notify_console_log take
//               pre-resolved i32/u8 to break the DevServer forward-dep.
// ──────────────────────────────────────────────────────────────────────────
