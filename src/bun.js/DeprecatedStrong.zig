#raw: jsc.JSValue,
#safety: Safety,
const Safety = if (enable_safety) ?struct { ptr: *Strong, gpa: std.mem.Allocator, ref_count: u32 } else void;
pub fn initNonCell(non_cell: jsc.JSValue) Strong {
    bun.assert(!non_cell.isCell());
    const safety: Safety = if (enable_safety) null;
    return .{ .#raw = non_cell, .#safety = safety };
}
pub fn init(safety_gpa: std.mem.Allocator, value: jsc.JSValue) Strong {
    value.protect();
    const safety: Safety = if (enable_safety) .{ .ptr = bun.create(safety_gpa, Strong, .{ .#raw = @enumFromInt(0xAEBCFA), .#safety = null }), .gpa = safety_gpa, .ref_count = 1 };
    return .{ .#raw = value, .#safety = safety };
}
pub fn deinit(this: *Strong) void {
    this.#raw.unprotect();
    if (enable_safety) if (this.#safety) |safety| {
        bun.assert(@intFromEnum(safety.ptr.*.#raw) == 0xAEBCFA);
        safety.ptr.*.#raw = @enumFromInt(0xFFFFFF);
        bun.assert(safety.ref_count == 1);
        safety.gpa.destroy(safety.ptr);
    };
}
pub fn get(this: Strong) jsc.JSValue {
    return this.#raw;
}
pub fn swap(this: *Strong, safety_gpa: std.mem.Allocator, next: jsc.JSValue) jsc.JSValue {
    const prev = this.#raw;
    this.deinit();
    this.* = .init(safety_gpa, next);
    return prev;
}
pub fn dupe(this: Strong, gpa: std.mem.Allocator) Strong {
    return .init(gpa, this.get());
}
pub fn ref(this: *Strong) void {
    this.#raw.protect();
    if (enable_safety) if (this.#safety) |safety| {
        safety.ref_count += 1;
    };
}
pub fn unref(this: *Strong) void {
    this.#raw.unprotect();
    if (enable_safety) if (this.#safety) |safety| {
        if (safety.ref_count == 1) {
            bun.assert(@intFromEnum(safety.ptr.*.#raw) == 0xAEBCFA);
            safety.ptr.*.#raw = @enumFromInt(0xFFFFFF);
            safety.gpa.destroy(safety.ptr);
            return;
        }
        safety.ref_count -= 1;
    };
}

pub const Optional = struct {
    #backing: Strong,
    pub const empty: Optional = .initNonCell(null);
    pub fn initNonCell(non_cell: ?jsc.JSValue) Optional {
        return .{ .#backing = .initNonCell(non_cell orelse .zero) };
    }
    pub fn init(safety_gpa: std.mem.Allocator, value: ?jsc.JSValue) Optional {
        return .{ .#backing = .init(safety_gpa, value orelse .zero) };
    }
    pub fn deinit(this: *Optional) void {
        this.#backing.deinit();
    }
    pub fn get(this: Optional) ?jsc.JSValue {
        const result = this.#backing.get();
        if (result == .zero) return null;
        return result;
    }
    pub fn swap(this: *Optional, safety_gpa: std.mem.Allocator, next: ?jsc.JSValue) ?jsc.JSValue {
        const result = this.#backing.swap(safety_gpa, next orelse .zero);
        if (result == .zero) return null;
        return result;
    }
    pub fn dupe(this: Optional, gpa: std.mem.Allocator) Optional {
        return .{ .#backing = this.#backing.dupe(gpa) };
    }
    pub fn has(this: Optional) bool {
        return this.#backing.get() != .zero;
    }
    pub fn ref(this: *Optional) void {
        this.#backing.ref();
    }
    pub fn unref(this: *Optional) void {
        this.#backing.unref();
    }
};

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
const enable_safety = bun.Environment.ci_assert;
const Strong = jsc.Strong.Deprecated;
