_raw: jsc.JSValue,
_safety: Safety,
const Safety = if (enable_safety) ?struct { ptr: *Strong, gpa: std.mem.Allocator, ref_count: u32 } else void;
pub fn initNonCell(non_cell: jsc.JSValue) Strong {
    bun.assert(!non_cell.isCell());
    const safety: Safety = if (enable_safety) null;
    return .{ ._raw = non_cell, ._safety = safety };
}
pub fn init(safety_gpa: std.mem.Allocator, value: jsc.JSValue) Strong {
    // TODO: consider using withAsyncContextIfNeeded
    value.protect();
    const safety: Safety = if (enable_safety) .{ .ptr = bun.create(safety_gpa, Strong, .{ ._raw = @enumFromInt(0xAEBCFA), ._safety = null }), .gpa = safety_gpa, .ref_count = 1 };
    return .{ ._raw = value, ._safety = safety };
}
pub fn deinit(this: *Strong) void {
    this._raw.unprotect();
    if (enable_safety) if (this._safety) |safety| {
        bun.assert(@intFromEnum(safety.ptr.*._raw) == 0xAEBCFA);
        safety.ptr.*._raw = @enumFromInt(0xFFFFFF);
        bun.assert(safety.ref_count == 1);
        safety.gpa.destroy(safety.ptr);
    };
}
pub fn get(this: Strong) jsc.JSValue {
    return this._raw;
}
pub fn swap(this: *Strong, safety_gpa: std.mem.Allocator, next: jsc.JSValue) jsc.JSValue {
    const prev = this._raw;
    this.deinit();
    this.* = .init(safety_gpa, next);
    return prev;
}
pub fn dupe(this: Strong, gpa: std.mem.Allocator) Strong {
    return .init(gpa, this.get());
}
pub fn ref(this: *Strong) void {
    this._raw.protect();
    if (enable_safety) if (this._safety) |safety| {
        safety.ref_count += 1;
    };
}
pub fn unref(this: *Strong) void {
    this._raw.unprotect();
    if (enable_safety) if (this._safety) |safety| {
        if (safety.ref_count == 1) {
            bun.assert(@intFromEnum(safety.ptr.*._raw) == 0xAEBCFA);
            safety.ptr.*._raw = @enumFromInt(0xFFFFFF);
            safety.gpa.destroy(safety.ptr);
            return;
        }
        safety.ref_count -= 1;
    };
}

pub const Optional = struct {
    _backing: Strong,
    pub const empty: Optional = .initNonCell(null);
    pub fn initNonCell(non_cell: ?jsc.JSValue) Optional {
        return .{ ._backing = .initNonCell(non_cell orelse .zero) };
    }
    pub fn init(safety_gpa: std.mem.Allocator, value: ?jsc.JSValue) Optional {
        return .{ ._backing = .init(safety_gpa, value orelse .zero) };
    }
    pub fn deinit(this: *Optional) void {
        this._backing.deinit();
    }
    pub fn get(this: Optional) ?jsc.JSValue {
        const result = this._backing.get();
        if (result == .zero) return null;
        return result;
    }
    pub fn swap(this: *Optional, safety_gpa: std.mem.Allocator, next: ?jsc.JSValue) ?jsc.JSValue {
        const result = this._backing.swap(safety_gpa, next orelse .zero);
        if (result == .zero) return null;
        return result;
    }
    pub fn dupe(this: *Optional, gpa: std.mem.Allocator) Optional {
        return .{ ._backing = this._backing.dupe(gpa) };
    }
    pub fn has(this: Optional) bool {
        return this._backing.get() != .zero;
    }
    pub fn ref(this: *Optional) void {
        this._backing.ref();
    }
    pub fn unref(this: *Optional) void {
        this._backing.unref();
    }
};

pub const List = struct {
    _backing: std.ArrayListUnmanaged(jsc.JSValue),
    pub const empty: List = .{ ._backing = .{ .items = &.{} } };
    pub fn init(gpa: std.mem.Allocator, items: []const jsc.JSValue) List {
        var result: std.ArrayListUnmanaged(jsc.JSValue) = .empty;
        result.appendSlice(gpa, items) catch bun.outOfMemory();
        for (result.items) |*item| item.protect();
        return .{ ._backing = result };
    }
    pub fn deinit(this: *List, gpa: std.mem.Allocator) void {
        for (this._backing.items) |*item| item.unprotect();
        this._backing.deinit(gpa);
    }
    pub fn get(this: List) []const jsc.JSValue {
        return this._backing.items;
    }
    pub fn append(this: *List, gpa: std.mem.Allocator, item: jsc.JSValue) void {
        item.protect();
        this._backing.append(gpa, item) catch bun.outOfMemory();
    }
    pub fn ensureUnusedCapacity(this: *List, gpa: std.mem.Allocator, additional: usize) void {
        this._backing.ensureUnusedCapacity(gpa, additional) catch bun.outOfMemory();
    }

    pub fn swap(this: *List, gpa: std.mem.Allocator, items: []jsc.JSValue) void {
        this.deinit(gpa);
        this.* = .init(items);
    }
    pub fn dupe(this: List, gpa: std.mem.Allocator) List {
        return .init(gpa, this.get());
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const enable_safety = bun.Environment.ci_assert;
const Strong = jsc.Strong.Safe;
