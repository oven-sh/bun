// Entry point for Valkey client
//
// Exports:
// - Core Valkey client implementation in valkey.rs
// - JavaScript wrapper in js_valkey.rs
// - Valkey protocol implementation in valkey_protocol.rs

// Import modules
pub use super::valkey;
pub use super::js_valkey;
pub use bun_valkey::valkey_protocol as protocol;

// Export JS client
pub use super::js_valkey::JSValkeyClient;

// Re-export key types for easy access
pub use super::valkey::ValkeyClient;
pub use super::valkey::Protocol;
pub use super::valkey::Status;
pub use super::valkey::Options;
// TODO(port): ValkeyCommand.zig is a file-as-struct; Phase B should confirm the Rust module/type name.
pub use super::valkey_command::ValkeyCommand as Command;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/valkey_jsc/index.zig (21 lines)
//   confidence: high
//   todos:      1
//   notes:      thin re-export module; sibling module paths (super::*) and bun_valkey crate name to be wired in Phase B
// ──────────────────────────────────────────────────────────────────────────
