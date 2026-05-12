// Entry point for Valkey client
//
// Exports:
// - Core Valkey client implementation in valkey.rs
// - JavaScript wrapper in js_valkey.rs
// - Valkey protocol implementation in valkey_protocol.rs

// Import modules
pub use super::js_valkey;
pub use super::valkey;
pub use bun_valkey::valkey_protocol as protocol;

// Export JS client
pub use super::js_valkey::JSValkeyClient;

// Re-export key types for easy access
pub use super::valkey::Options;
pub use super::valkey::Protocol;
pub use super::valkey::Status;
pub use super::valkey::ValkeyClient;
// ValkeyCommand.zig is a file-as-struct; in Rust the module itself is the namespace.
pub use super::valkey_command as Command;

// ported from: src/runtime/valkey_jsc/index.zig
