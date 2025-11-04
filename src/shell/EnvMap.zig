const EnvMap = @This();

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

pub fn memoryCost(this: *const EnvMap) usize {
    var size: usize = @sizeOf(EnvMap);
    size += std.mem.sliceAsBytes(this.map.keys()).len;
    size += std.mem.sliceAsBytes(this.map.values()).len;
    for (this.map.keys(), this.map.values()) |key, value| {
        size += key.memoryCost();
        size += value.memoryCost();
    }
    return size;
}

pub fn initWithCapacity(alloc: Allocator, cap: usize) EnvMap {
    var map = MapType.init(alloc);
    bun.handleOom(map.ensureTotalCapacity(cap));
    return .{ .map = map };
}

pub fn deinit(this: *EnvMap) void {
    this.derefStrings();
    this.map.deinit();
}

/// NOTE: This will `.ref()` value, so you should `defer value.deref()` it
/// before handing it to this function!!!
pub fn insert(this: *EnvMap, key: EnvStr, val: EnvStr) void {
    const result = bun.handleOom(this.map.getOrPut(key));
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
    bun.handleOom(this.map.ensureTotalCapacity(new_capacity));
}

/// NOTE: Make sure you deref the string when done!
pub fn get(this: *EnvMap, key: EnvStr) ?EnvStr {
    const val = this.map.get(key) orelse return null;
    val.ref();
    return val;
}

pub fn clone(this: *EnvMap) EnvMap {
    var new: EnvMap = .{
        .map = bun.handleOom(this.map.clone()),
    };
    new.refStrings();
    return new;
}

pub fn cloneWithAllocator(this: *EnvMap, allocator: Allocator) EnvMap {
    var new: EnvMap = .{
        .map = bun.handleOom(this.map.cloneWithAllocator(allocator)),
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

const bun = @import("bun");
const std = @import("std");
const Allocator = std.mem.Allocator;
const EnvStr = bun.shell.EnvStr;
