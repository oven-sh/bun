// Entry point for Redis client
//
// Exports:
// - Core Redis client implementation in redis.zig
// - JavaScript wrapper in js_redis.zig
// - Redis protocol implementation in redis_protocol.zig

// Import modules
pub const redis = @import("redis.zig");
pub const js_redis = @import("js_redis.zig");
pub const protocol = @import("redis_protocol.zig");

// Export JS client
pub const JSRedisClient = js_redis.JSRedisClient;

// Re-export key types for easy access
pub const RedisClient = redis.RedisClient;
pub const CommandType = redis.CommandType;
pub const Protocol = redis.Protocol;
pub const Status = redis.Status;
pub const Options = redis.Options;