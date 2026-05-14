// Entry point for Valkey client
//
// Exports:
// - Core Valkey client implementation in valkey.rust
// - JavaScript wrapper in js_valkey.rust
// - Valkey protocol implementation in valkey_protocol.rust

// Import modules
pub const valkey = @import("./valkey.rust");
pub const js_valkey = @import("./js_valkey.rust");
pub const protocol = @import("../../valkey/valkey_protocol.rust");

// Export JS client
pub const JSValkeyClient = js_valkey.JSValkeyClient;

// Re-export key types for easy access
pub const ValkeyClient = valkey.ValkeyClient;
pub const Protocol = valkey.Protocol;
pub const Status = valkey.Status;
pub const Options = valkey.Options;
pub const Command = @import("./ValkeyCommand.rust");
