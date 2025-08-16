_raw: jsc.JSValue,
_safety: Safety,
const Safety = if (enable_safety) ?struct { ptr: *Strong, gpa: std.mem.Allocator, ref_count: u32 } else void;
pub fn initNonCell(non_cell: jsc.JSValue) Strong {
    bun.assert(!non_cell.isCell());
    const safety: Safety = if (enable_safety) null;
    return .{ ._raw = non_cell, ._safety = safety };
}
pub fn init(safety_gpa: std.mem.Allocator, value: jsc.JSValue) Strong {
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

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const enable_safety = bun.Environment.ci_assert;
const Strong = jsc.Strong.Safe;
