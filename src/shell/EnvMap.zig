map: MapType,

pub const Iterator = MapType.Iterator;

const MapType = std.ArrayHashMap(EnvStr, EnvStr, struct {
    pub fn hash(self: @This(), s: EnvStr) u32 {
        _ = self;
        if (bun.Environment.isWindows) {
            return bun.CaseInsensitiveASCIIStringContext.hash(undefined, s.slice());
        }
        return std.array_hash_map.hashString(s.slice());
    }
    pub fn eql(self: @This(), a: EnvStr, b: EnvStr, b_index: usize) bool {
        _ = self;
        _ = b_index;
        if (bun.Environment.isWindows) {
            return bun.CaseInsensitiveASCIIStringContext.eql(undefined, a.slice(), b.slice(), undefined);
        }
        return std.array_hash_map.eqlString(a.slice(), b.slice());
    }
}, true);

pub fn init(alloc: Allocator) EnvMap {
    return .{ .map = MapType.init(alloc) };
}

pub fn initWithCapacity(alloc: Allocator, cap: usize) EnvMap {
    var map = MapType.init(alloc);
    map.ensureTotalCapacity(cap) catch bun.outOfMemory();
    return .{ .map = map };
}

pub fn deinit(this: *EnvMap) void {
    this.derefStrings();
    this.map.deinit();
}

pub fn insert(this: *EnvMap, key: EnvStr, val: EnvStr) void {
    const result = this.map.getOrPut(key) catch bun.outOfMemory();
    if (!result.found_existing) {
        key.ref();
    } else {
        result.value_ptr.deref();
    }
    val.ref();
    result.value_ptr.* = val;
}

pub fn iterator(this: *EnvMap) MapType.Iterator {
    return this.map.iterator();
}

pub fn clearRetainingCapacity(this: *EnvMap) void {
    this.derefStrings();
    this.map.clearRetainingCapacity();
}

pub fn ensureTotalCapacity(this: *EnvMap, new_capacity: usize) void {
    this.map.ensureTotalCapacity(new_capacity) catch bun.outOfMemory();
}

/// NOTE: Make sure you deref the string when done!
pub fn get(this: *EnvMap, key: EnvStr) ?EnvStr {
    const val = this.map.get(key) orelse return null;
    val.ref();
    return val;
}

pub fn clone(this: *EnvMap) EnvMap {
    var new: EnvMap = .{
        .map = this.map.clone() catch bun.outOfMemory(),
    };
    new.refStrings();
    return new;
}

pub fn cloneWithAllocator(this: *EnvMap, allocator: Allocator) EnvMap {
    var new: EnvMap = .{
        .map = this.map.cloneWithAllocator(allocator) catch bun.outOfMemory(),
    };
    new.refStrings();
    return new;
}

fn refStrings(this: *EnvMap) void {
    var iter = this.map.iterator();
    while (iter.next()) |entry| {
        entry.key_ptr.ref();
        entry.value_ptr.ref();
    }
}

fn derefStrings(this: *EnvMap) void {
    var iter = this.map.iterator();
    while (iter.next()) |entry| {
        entry.key_ptr.deref();
        entry.value_ptr.deref();
    }
}

const EnvMap = @This();
const bun = @import("bun");
const Allocator = std.mem.Allocator;
const std = @import("std");
const EnvStr = bun.shell.EnvStr;
