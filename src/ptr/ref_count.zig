const std = @import("std");
const bun = @import("root").bun;
const Output = bun.Output;

const strings = bun.strings;
const meta = bun.meta;

/// Reference-counted heap-allocated instance value.
///
/// `ref_count` is expected to be defined on `T` with a default value set to `1`
pub fn NewRefCounted(comptime T: type, comptime deinit_fn: ?fn (self: *T) void, debug_name: ?[:0]const u8) type {
    if (!@hasField(T, "ref_count")) {
        @compileError("Expected a field named \"ref_count\" with a default value of 1 on " ++ @typeName(T));
    }

    for (std.meta.fields(T)) |field| {
        if (strings.eqlComptime(field.name, "ref_count")) {
            if (field.defaultValue() != 1) {
                @compileError("Expected a field named \"ref_count\" with a default value of 1 on " ++ @typeName(T));
            }
        }
    }

    const output_name = debug_name orelse meta.typeBaseName(@typeName(T));
    const log = Output.scoped(output_name, true);

    return struct {
        pub fn destroy(self: *T) void {
            if (bun.Environment.allow_assert) {
                bun.assert(self.ref_count == 0);
            }

            bun.destroy(self);
        }

        pub fn ref(self: *T) void {
            if (bun.Environment.isDebug) {
                log("0x{x} ref {d} + 1 = {d}", .{ @intFromPtr(self), self.ref_count, self.ref_count + 1 });
                bun.assertf(self.ref_count > 0, "use-after-free detected on {*}", .{self});
            }
            self.ref_count += 1;
        }

        pub fn deref(self: *T) void {
            const ref_count = self.ref_count;
            if (bun.Environment.isDebug) {
                log("0x{x} deref {d} - 1 = {d}", .{ @intFromPtr(self), ref_count, ref_count -| 1 });
                bun.assertf(ref_count > 0, "use-after-free detected on {*}", .{self});
            }

            self.ref_count = ref_count - 1;

            if (ref_count == 1) {
                if (comptime deinit_fn) |deinit| {
                    deinit(self);
                } else {
                    self.destroy();
                }
            }
        }

        pub inline fn new(t: T) *T {
            const ptr = bun.new(T, t);

            if (bun.Environment.enable_logs) {
                if (ptr.ref_count == 0) {
                    std.debug.panic("Expected ref_count to be > 0, got {d}", .{ptr.ref_count});
                }
            }

            return ptr;
        }
    };
}

pub fn NewThreadSafeRefCounted(comptime T: type, comptime deinit_fn: ?fn (self: *T) void, debug_name: ?[:0]const u8) type {
    if (!@hasField(T, "ref_count")) {
        @compileError("Expected a field named \"ref_count\" with a default value of 1 on " ++ @typeName(T));
    }

    for (std.meta.fields(T)) |field| {
        if (strings.eqlComptime(field.name, "ref_count")) {
            if (field.defaultValue() == null or field.defaultValue().?.raw != 1) {
                @compileError("Expected an atomic field named \"ref_count\" with a default value of 1 on " ++ @typeName(T));
            }
        }
    }

    const output_name = debug_name orelse meta.typeBaseName(@typeName(T));
    const log = Output.scoped(output_name, true);

    return struct {
        pub fn destroy(self: *T) void {
            if (bun.Environment.allow_assert) {
                bun.assert(self.ref_count.load(.seq_cst) == 0);
            }

            bun.destroy(self);
        }

        pub fn ref(self: *T) void {
            const prev_ref_count = self.ref_count.fetchAdd(1, .seq_cst);
            if (bun.Environment.isDebug) {
                log("0x{x} ref {d} + 1 = {d}", .{ @intFromPtr(self), prev_ref_count, prev_ref_count + 1 });
                bun.assertf(prev_ref_count > 0, "use-after-free detected on {*}", .{self});
            }
        }

        pub fn deref(self: *T) void {
            const prev_ref_count = self.ref_count.fetchSub(1, .seq_cst);
            if (bun.Environment.isDebug) {
                log("0x{x} deref {d} - 1 = {d}", .{ @intFromPtr(self), prev_ref_count, prev_ref_count -| 1 });
                bun.assertf(prev_ref_count > 0, "use-after-free detected on {*}", .{self});
            }

            if (prev_ref_count == 1) {
                if (comptime deinit_fn) |deinit| {
                    deinit(self);
                } else {
                    self.destroy();
                }
            }
        }

        pub inline fn new(t: T) *T {
            const ptr = bun.new(T, t);

            if (bun.Environment.enable_logs) {
                if (ptr.ref_count.load(.seq_cst) != 1) {
                    Output.panic("Expected ref_count to be 1, got {d}", .{ptr.ref_count.load(.seq_cst)});
                }
            }

            return ptr;
        }
    };
}
