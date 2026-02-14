const std = @import("std");
const Allocator = std.mem.Allocator;

pub const Env = struct {
    map: std.StringHashMap([]const u8),
    allocator: Allocator,

    pub fn init(allocator: Allocator) Env {
        return .{
            .map = std.StringHashMap([]const u8).init(allocator),
            .allocator = allocator,
        };
    }

    pub fn deinit(self: *Env) void {
        var it = self.map.iterator();
        while (it.next()) |entry| {
            self.allocator.free(entry.key_ptr.*);
            self.allocator.free(entry.value_ptr.*);
        }
        self.map.deinit();
    }

    pub fn get(self: Env, key: []const u8) ?[]const u8 {
        return self.map.get(key);
    }

    pub fn getWithDefault(self: Env, key: []const u8, default: []const u8) []const u8 {
        return self.map.get(key) orelse default;
    }

    /// Internal helper to put owned strings into the map
    pub fn put(self: *Env, key: []const u8, value: []const u8) !void {
        const key_copy = try self.allocator.dupe(u8, key);
        errdefer self.allocator.free(key_copy);
        const value_copy = try self.allocator.dupe(u8, value);
        errdefer self.allocator.free(value_copy);

        const gop = try self.map.getOrPut(key_copy);
        if (gop.found_existing) {
            self.allocator.free(key_copy); // We already have the key, don't need the copy
            self.allocator.free(gop.value_ptr.*); // Free old value
            // key_ptr remains pointing to the original copy in the map
        }
        gop.value_ptr.* = value_copy;
    }
};
