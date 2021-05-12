const std = @import("std");
const sync = @import("sync.zig");
usingnamespace @import("global.zig");

pub fn ThreadSafeStringHashMap(comptime Value: type) type {
    const HashMapType = std.StringHashMap(Value);
    return struct {
        backing: HashMapType,
        lock: sync.RwLock,
        pub const HashMap = @This();

        pub fn init(allocator: *std.mem.Allocator) !*HashMapType {
            var self = try allocator.create(HashMapType);
            self.* = HashMapType{ .backing = HashMapType.init(allocator), .lock = sync.RwLock.init() };

            return self;
        }

        pub fn get(self: *HashMap, key: string) ?Value {
            self.lock.lockShared();
            defer self.lock.unlockShared();
            return self.backing.get(key);
        }

        pub fn deinit(self: *HashMap, allocator: *std.mem.Allocator) void {
            self.backing.deinit();
        }

        pub fn put(self: *HashMap, key: string, value: Value) !void {
            self.lock.lock();
            defer self.lock.unlock();
            try self.backing.put(key, value);
        }
    };
}
