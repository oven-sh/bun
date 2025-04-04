const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const redis = @import("../../redis/index.zig");

// We export the JSRedisClient from our redis module
pub const call = redis.js_redis.JSRedisClient.call;