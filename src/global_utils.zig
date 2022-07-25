const std = @import("std");
const strings = @import("./string_immutable.zig");
const Environment = @import("./env.zig");

pub const fmt = struct {
    pub usingnamespace std.fmt;

    pub const SizeFormatter = struct {
        value: usize = 0,
        pub fn format(self: SizeFormatter, comptime _: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
            const radix = 1000;

            const math = std.math;
            const value = self.value;
            if (value == 0) {
                const buf = switch (radix) {
                    1000 => "0 KB",
                    1024 => "0 KiB",
                    else => unreachable,
                };
                return writer.writeAll(buf);
            }

            if (value < 512) {
                try fmt.formatInt(self.value, 10, .lower, opts, writer);
                return writer.writeAll(" bytes");
            }

            const mags_si = " KMGTPE";
            const mags_iec = " KMGTPE";

            const log2 = math.log2(value);
            const magnitude = switch (radix) {
                1000 => math.min(log2 / comptime math.log2(1000), mags_si.len - 1),
                1024 => math.min(log2 / 10, mags_iec.len - 1),
                else => unreachable,
            };
            const new_value = math.lossyCast(f64, value) / math.pow(f64, comptime math.lossyCast(f64, radix), math.lossyCast(f64, magnitude));
            const suffix = switch (radix) {
                1000 => mags_si[magnitude],
                1024 => mags_iec[magnitude],
                else => unreachable,
            };

            var precision = if (std.math.approxEqAbs(f64, new_value, @round(new_value), 0.010))
                @as(usize, 0)
            else
                @as(usize, 2);
            try fmt.formatFloatDecimal(new_value, .{ .precision = precision }, writer);

            const buf = switch (radix) {
                1000 => &[_]u8{ ' ', suffix, 'B' },
                1024 => &[_]u8{ ' ', suffix, 'i', 'B' },
                else => unreachable,
            };
            return writer.writeAll(buf);
        }
    };

    pub fn size(value: anytype) SizeFormatter {
        return switch (@TypeOf(value)) {
            f64, f32, f128 => SizeFormatter{
                .value = @floatToInt(u64, value),
            },
            else => SizeFormatter{ .value = @intCast(u64, value) },
        };
    }
};

test "SizeFormatter" {
    var buf: [24]u8 = undefined;
    try std.testing.expectEqualStrings("0 KB", try fmt.bufPrint(&buf, "{}", .{fmt.size(0)}));
    try std.testing.expectEqualStrings("10 bytes", try fmt.bufPrint(&buf, "{}", .{fmt.size(10)}));
    try std.testing.expectEqualStrings("0.51 KB", try fmt.bufPrint(&buf, "{}", .{fmt.size(513)}));
    try std.testing.expectEqualStrings("0.99 KB", try fmt.bufPrint(&buf, "{}", .{fmt.size(990)}));
    try std.testing.expectEqualStrings("1 KB", try fmt.bufPrint(&buf, "{}", .{fmt.size(999)}));
    try std.testing.expectEqualStrings("1 KB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1000)}));
    try std.testing.expectEqualStrings("1.11 KB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1111)}));
    try std.testing.expectEqualStrings("1 MB", try fmt.bufPrint(&buf, "{}", .{fmt.size(999999)}));
    try std.testing.expectEqualStrings("1 MB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1000000)}));
    try std.testing.expectEqualStrings("1 GB", try fmt.bufPrint(&buf, "{}", .{fmt.size(999999999)}));
    try std.testing.expectEqualStrings("1 GB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1000000000)}));
    try std.testing.expectEqualStrings("1 TB", try fmt.bufPrint(&buf, "{}", .{fmt.size(999999999999)}));
    try std.testing.expectEqualStrings("1 TB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1000000000000)}));
    try std.testing.expectEqualStrings("1 PB", try fmt.bufPrint(&buf, "{}", .{fmt.size(999999999999999)}));
    try std.testing.expectEqualStrings("1 PB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1000000000000000)}));
    try std.testing.expectEqualStrings("1 EB", try fmt.bufPrint(&buf, "{}", .{fmt.size(999999999999999999)}));
    try std.testing.expectEqualStrings("1 EB", try fmt.bufPrint(&buf, "{}", .{fmt.size(1000000000000000000)}));
}

pub inline fn cast(comptime To: type, value: anytype) To {
    if (comptime std.meta.trait.isIntegral(@TypeOf(value))) {
        return @intToPtr(To, @bitCast(usize, value));
    }
    return @ptrCast(To, @alignCast(@alignOf(To), value));
}

extern fn strlen(ptr: [*c]const u8) usize;

pub fn indexOfSentinel(comptime Elem: type, comptime sentinel: Elem, ptr: [*:sentinel]const Elem) usize {
    if (comptime Elem == u8 and sentinel == 0) {
        return strlen(ptr);
    } else {
        var i: usize = 0;
        while (ptr[i] != sentinel) {
            i += 1;
        }
        return i;
    }
}

pub fn len(value: anytype) usize {
    return switch (@typeInfo(@TypeOf(value))) {
        .Array => |info| info.len,
        .Vector => |info| info.len,
        .Pointer => |info| switch (info.size) {
            .One => switch (@typeInfo(info.child)) {
                .Array => value.len,
                else => @compileError("invalid type given to std.mem.len"),
            },
            .Many => {
                const sentinel_ptr = info.sentinel orelse
                    @compileError("length of pointer with no sentinel");
                const sentinel = @ptrCast(*const info.child, sentinel_ptr).*;

                return indexOfSentinel(info.child, sentinel, value);
            },
            .C => {
                std.debug.assert(value != null);
                return indexOfSentinel(info.child, 0, value);
            },
            .Slice => value.len,
        },
        .Struct => |info| if (info.is_tuple) {
            return info.fields.len;
        } else @compileError("invalid type given to std.mem.len"),
        else => @compileError("invalid type given to std.mem.len"),
    };
}

pub fn span(ptr: anytype) std.mem.Span(@TypeOf(ptr)) {
    if (@typeInfo(@TypeOf(ptr)) == .Optional) {
        if (ptr) |non_null| {
            return span(non_null);
        } else {
            return null;
        }
    }
    const Result = std.mem.Span(@TypeOf(ptr));
    const l = len(ptr);
    const ptr_info = @typeInfo(Result).Pointer;
    if (ptr_info.sentinel) |s_ptr| {
        const s = @ptrCast(*const ptr_info.child, s_ptr).*;
        return ptr[0..l :s];
    } else {
        return ptr[0..l];
    }
}

pub inline fn range(comptime min: anytype, comptime max: anytype) [max - min]usize {
    return comptime brk: {
        var slice: [max - min]usize = undefined;
        var i: usize = min;
        while (i < max) {
            slice[i - min] = i;
            i += 1;
        }
        break :brk slice;
    };
}

test "range" {
    try std.testing.expectEqualSlices(usize, &[_]usize{}, &range(0, 0));
    try std.testing.expectEqualSlices(usize, &[_]usize{0}, &range(0, 1));
    try std.testing.expectEqualSlices(usize, &[_]usize{ 10, 11, 12 }, &range(10, 13));
}

pub fn copy(comptime Type: type, dest: []Type, src: []const Type) void {
    std.debug.assert(dest.len >= src.len);
    var input = std.mem.sliceAsBytes(src);
    var output = std.mem.sliceAsBytes(dest);
    var input_end = input.ptr + input.len;
    const output_end = output.ptr + output.len;

    if (@ptrToInt(input.ptr) <= @ptrToInt(output.ptr) and @ptrToInt(output_end) <= @ptrToInt(input_end)) {
        // // input is overlapping with output
        if (input.len > strings.ascii_vector_size) {
            const input_end_vectorized = input.ptr + input.len - (input.len % strings.ascii_vector_size);
            while (input.ptr != input_end_vectorized) {
                const input_vec = @as(@Vector(strings.ascii_vector_size, u8), input[0..strings.ascii_vector_size].*);
                output[0..strings.ascii_vector_size].* = input_vec;
                input = input[strings.ascii_vector_size..];
                output = output[strings.ascii_vector_size..];
            }
        }

        while (input.len >= @sizeOf(usize)) {
            output[0..@sizeOf(usize)].* = input[0..@sizeOf(usize)].*;
            input = input[@sizeOf(usize)..];
            output = output[@sizeOf(usize)..];
        }

        while (input.ptr != input_end) {
            output[0] = input[0];
            input = input[1..];
            output = output[1..];
        }
    } else {
        @memcpy(output.ptr, input.ptr, input.len);
    }
}

test "copy" {
    var src = [_]u8{ 1, 2, 3, 4, 5 };
    var dst: [3]u8 = undefined;
    copy(u8, &dst, src[0..3]);
    try std.testing.expectEqualSlices(u8, &[_]u8{ 1, 2, 3 }, &dst);
}

pub const hasCloneFn = std.meta.trait.multiTrait(.{ std.meta.trait.isContainer, std.meta.trait.hasFn("clone") });

pub fn cloneWithType(comptime T: type, item: T, allocator: std.mem.Allocator) !T {
    if (comptime std.meta.trait.isIndexable(T)) {
        const Child = std.meta.Child(T);
        assertDefined(item);

        if (comptime hasCloneFn(Child)) {
            var slice = try allocator.alloc(Child, std.mem.len(item));
            for (slice) |*val, i| {
                val.* = try item[i].clone(allocator);
            }
            return slice;
        }

        if (comptime std.meta.trait.isContainer(Child)) {
            @compileError("Expected clone() to exist for slice child: " ++ @typeName(Child));
        }

        return try allocator.dupe(Child, item);
    }

    if (comptime hasCloneFn(T)) {
        return try item.clone(allocator);
    }

    @compileError("Expected clone() to exist for " ++ @typeName(T));
}

pub fn clone(val: anytype, allocator: std.mem.Allocator) !@TypeOf(val) {
    return cloneWithType(@TypeOf(val), val, allocator);
}

pub inline fn assertDefined(val: anytype) void {
    if (comptime !Environment.allow_assert) return;
    const Type = @TypeOf(val);

    if (comptime @typeInfo(Type) == .Optional) {
        if (val) |res| {
            assertDefined(res);
        }
        return;
    }

    if (comptime std.meta.trait.isSlice(Type)) {
        std.debug.assert(val.len < std.math.maxInt(u32) + 1);
        std.debug.assert(val.len < std.math.maxInt(u32) + 1);
        std.debug.assert(val.len < std.math.maxInt(u32) + 1);
        var slice: []Type = undefined;
        if (val.len > 0) {
            std.debug.assert(@ptrToInt(val.ptr) != @ptrToInt(slice.ptr));
        }
        return;
    }

    if (comptime @typeInfo(Type) == .Pointer) {
        var slice: *Type = undefined;
        std.debug.assert(@ptrToInt(val) != @ptrToInt(slice));
        return;
    }

    if (comptime @typeInfo(Type) == .Struct) {
        inline for (comptime std.meta.fieldNames(Type)) |name| {
            assertDefined(@field(val, name));
        }
    }
}

/// hash a string
pub fn hash(content: []const u8) u64 {
    return std.hash.Wyhash.hash(0, content);
}
