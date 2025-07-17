// Entry point for Valkey client
//
// Exports:
// - Core Valkey client implementation in valkey.zig
// - JavaScript wrapper in js_valkey.zig
// - Valkey protocol implementation in valkey_protocol.zig

// Import modules
pub const valkey = @import("valkey.zig");
pub const js_valkey = @import("js_valkey.zig");
pub const protocol = @import("valkey_protocol.zig");

// Export JS client
pub const JSValkeyClient = js_valkey.JSValkeyClient;

// Re-export key types for easy access
pub const ValkeyClient = valkey.ValkeyClient;
pub const Protocol = valkey.Protocol;
pub const Status = valkey.Status;
pub const Options = valkey.Options;
pub const Command = @import("ValkeyCommand.zig");
