//! Declared symbol representation
ref: Ref,
is_top_level: bool = false,

pub const List = struct {
    entries: bun.MultiArrayList(DeclaredSymbol) = .{},

    pub fn refs(this: *const List) []Ref {
        return this.entries.items(.ref);
    }

    pub fn toOwnedSlice(this: *List) List {
        const new = this.*;

        this.* = .{};
        return new;
    }

    pub fn clone(this: *const List, allocator: std.mem.Allocator) !List {
        return List{ .entries = try this.entries.clone(allocator) };
    }

    pub inline fn len(this: List) usize {
        return this.entries.len;
    }

    pub fn append(this: *List, allocator: std.mem.Allocator, entry: DeclaredSymbol) !void {
        try this.ensureUnusedCapacity(allocator, 1);
        this.appendAssumeCapacity(entry);
    }

    pub fn appendList(this: *List, allocator: std.mem.Allocator, other: List) !void {
        try this.ensureUnusedCapacity(allocator, other.len());
        this.appendListAssumeCapacity(other);
    }

    pub fn appendListAssumeCapacity(this: *List, other: List) void {
        this.entries.appendListAssumeCapacity(other.entries);
    }

    pub fn appendAssumeCapacity(this: *List, entry: DeclaredSymbol) void {
        this.entries.appendAssumeCapacity(entry);
    }

    pub fn ensureTotalCapacity(this: *List, allocator: std.mem.Allocator, count: usize) !void {
        try this.entries.ensureTotalCapacity(allocator, count);
    }

    pub fn ensureUnusedCapacity(this: *List, allocator: std.mem.Allocator, count: usize) !void {
        try this.entries.ensureUnusedCapacity(allocator, count);
    }

    pub fn clearRetainingCapacity(this: *List) void {
        this.entries.clearRetainingCapacity();
    }

    pub fn deinit(this: *List, allocator: std.mem.Allocator) void {
        this.entries.deinit(allocator);
    }

    pub fn initCapacity(allocator: std.mem.Allocator, capacity: usize) !List {
        var entries = bun.MultiArrayList(DeclaredSymbol){};
        try entries.ensureUnusedCapacity(allocator, capacity);
        return List{ .entries = entries };
    }

    pub fn fromSlice(allocator: std.mem.Allocator, entries: []const DeclaredSymbol) !List {
        var this = try List.initCapacity(allocator, entries.len);
        errdefer this.deinit(allocator);
        for (entries) |entry| {
            this.appendAssumeCapacity(entry);
        }

        return this;
    }
};

fn forEachTopLevelSymbolWithType(decls: *List, comptime Ctx: type, ctx: Ctx, comptime Fn: fn (Ctx, Ref) void) void {
    var entries = decls.entries.slice();
    const is_top_level = entries.items(.is_top_level);
    const refs = entries.items(.ref);

    // TODO: SIMD
    for (is_top_level, refs) |top, ref| {
        if (top) {
            @call(bun.callmod_inline, Fn, .{ ctx, ref });
        }
    }
}

pub fn forEachTopLevelSymbol(decls: *List, ctx: anytype, comptime Fn: anytype) void {
    forEachTopLevelSymbolWithType(decls, @TypeOf(ctx), ctx, Fn);
}

const std = @import("std");
const bun = @import("root").bun;
const Ref = @import("js_ast.zig").Ref;

/// Represents a declared symbol in the AST
const DeclaredSymbol = @This();
