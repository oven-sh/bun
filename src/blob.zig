const std = @import("std");
const Lock = @import("./lock.zig").Lock;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;

const Blob = @This();

ptr: [*]const u8,
len: usize,

pub const Map = struct {
    const MapContext = struct {
        pub fn hash(_: @This(), s: u64) u32 {
            return @as(u32, @truncate(s));
        }
        pub fn eql(_: @This(), a: u64, b: u64, _: usize) bool {
            return a == b;
        }
    };

    const HashMap = std.ArrayHashMap(u64, Blob, MapContext, false);
    lock: Lock,
    map: HashMap,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) Map {
        return Map{
            .lock = Lock.init(),
            .map = HashMap.init(allocator),
            .allocator = allocator,
        };
    }

    pub fn get(this: *Map, key: string) ?Blob {
        this.lock.lock();
        defer this.lock.unlock();
        return this.map.get(bun.hash(key));
    }

    pub fn put(this: *Map, key: string, blob: Blob) !void {
        this.lock.lock();
        defer this.lock.unlock();

        return try this.map.put(bun.hash(key), blob);
    }

    pub fn reset(this: *Map) !void {
        this.lock.lock();
        defer this.lock.unlock();
        this.map.clearRetainingCapacity();
    }
};

pub const Group = struct {
    persistent: Map,
    temporary: Map,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator) !*Group {
        var group = try allocator.create(Group);
        group.* = Group{ .persistent = Map.init(allocator), .temporary = Map.init(allocator), .allocator = allocator };
        return group;
    }

    pub fn get(this: *Group, key: string) ?Blob {
        return this.temporary.get(key) orelse this.persistent.get(key);
    }
};
