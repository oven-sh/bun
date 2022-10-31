const std = @import("std");
pub const Environment = @import("env.zig");

pub const use_mimalloc = !Environment.isTest;

pub const default_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./memory_allocator.zig").c_allocator;

pub const huge_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./memory_allocator.zig").huge_allocator;

pub const auto_allocator: std.mem.Allocator = if (!use_mimalloc)
    std.heap.c_allocator
else
    @import("./memory_allocator.zig").auto_allocator;

pub const huge_allocator_threshold: comptime_int = @import("./memory_allocator.zig").huge_threshold;

pub const C = @import("c.zig");

pub const FeatureFlags = @import("feature_flags.zig");
const root = @import("root");
pub const meta = @import("./meta.zig");
pub const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;
pub const base64 = @import("./base64/base64.zig");
pub const path = @import("./resolver/resolve_path.zig");
pub const fmt = struct {
    pub usingnamespace std.fmt;

    pub const SizeFormatter = struct {
        value: usize = 0,
        pub fn format(self: SizeFormatter, comptime _: []const u8, opts: fmt.FormatOptions, writer: anytype) !void {
            const math = std.math;
            const value = self.value;
            if (value == 0) {
                return writer.writeAll("0 KB");
            }

            if (value < 512) {
                try fmt.formatInt(self.value, 10, .lower, opts, writer);
                return writer.writeAll(" bytes");
            }

            const mags_si = " KMGTPEZY";
            const mags_iec = " KMGTPEZY";

            const log2 = math.log2(value);
            const magnitude = math.min(log2 / comptime math.log2(1000), mags_si.len - 1);
            const new_value = math.lossyCast(f64, value) / math.pow(f64, 1000, math.lossyCast(f64, magnitude));
            const suffix = switch (1000) {
                1000 => mags_si[magnitude],
                1024 => mags_iec[magnitude],
                else => unreachable,
            };

            if (suffix == ' ') {
                try fmt.formatFloatDecimal(new_value / 1000.0, .{ .precision = 2 }, writer);
                return writer.writeAll(" KB");
            } else {
                try fmt.formatFloatDecimal(new_value, .{ .precision = if (std.math.approxEqAbs(f64, new_value, @trunc(new_value), 0.100)) @as(usize, 0) else @as(usize, 2) }, writer);
            }

            const buf = switch (1000) {
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

pub const Output = @import("./output.zig");
pub const Global = @import("./__global.zig");

pub const FileDescriptorType = if (Environment.isBrowser) u0 else std.os.fd_t;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = if (Environment.isWindows or Environment.isBrowser) u0 else std.os.fd_t;

pub const StringTypes = @import("string_types.zig");
pub const stringZ = StringTypes.stringZ;
pub const string = StringTypes.string;
pub const CodePoint = StringTypes.CodePoint;
pub const PathString = StringTypes.PathString;
pub const HashedString = StringTypes.HashedString;
pub const strings = @import("string_immutable.zig");
pub const MutableString = @import("string_mutable.zig").MutableString;
pub const RefCount = @import("./ref_count.zig").RefCount;

pub inline fn constStrToU8(s: []const u8) []u8 {
    return @intToPtr([*]u8, @ptrToInt(s.ptr))[0..s.len];
}

pub const MAX_PATH_BYTES: usize = if (Environment.isWasm) 1024 else std.fs.MAX_PATH_BYTES;

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

pub const IdentityContext = @import("./identity_context.zig").IdentityContext;
pub const ArrayIdentityContext = @import("./identity_context.zig").ArrayIdentityContext;
pub const BabyList = @import("./baby_list.zig").BabyList;
pub const ByteList = BabyList(u8);

pub fn DebugOnly(comptime Type: type) type {
    if (comptime Environment.isDebug) {
        return Type;
    }

    return void;
}

pub fn DebugOnlyDefault(comptime val: anytype) if (Environment.isDebug) @TypeOf(val) else void {
    if (comptime Environment.isDebug) {
        return val;
    }

    return {};
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
pub const StringBuilder = @import("./string_builder.zig");

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

pub const LinearFifo = @import("./linear_fifo.zig").LinearFifo;

/// hash a string
pub fn hash(content: []const u8) u64 {
    return std.hash.Wyhash.hash(0, content);
}

pub const HiveArray = @import("./hive_array.zig").HiveArray;

pub fn rand(bytes: []u8) void {
    const BoringSSL = @import("boringssl");
    _ = BoringSSL.RAND_bytes(bytes.ptr, bytes.len);
}

pub const ObjectPool = @import("./pool.zig").ObjectPool;

pub fn assertNonBlocking(fd: anytype) void {
    std.debug.assert(
        (std.os.fcntl(fd, std.os.F.GETFL, 0) catch unreachable) & std.os.O.NONBLOCK != 0,
    );
}

pub fn ensureNonBlocking(fd: anytype) void {
    const current = std.os.fcntl(fd, std.os.F.GETFL, 0) catch 0;
    _ = std.os.fcntl(fd, std.os.F.SETFL, current | std.os.O.NONBLOCK) catch 0;
}

pub fn isReadable(fd: std.os.fd_t) bool {
    var polls = &[_]std.os.pollfd{
        .{
            .fd = fd,
            .events = std.os.POLL.IN | std.os.POLL.ERR,
            .revents = 0,
        },
    };

    return (std.os.poll(polls, 0) catch 0) != 0;
}

pub fn isWritable(fd: std.os.fd_t) bool {
    var polls = &[_]std.os.pollfd{
        .{
            .fd = fd,
            .events = std.os.POLL.OUT | std.os.POLL.ERR,
            .revents = 0,
        },
    };

    return (std.os.poll(polls, 0) catch 0) != 0;
}

pub inline fn unreachablePanic(comptime fmts: []const u8, args: anytype) noreturn {
    if (comptime !Environment.allow_assert) unreachable;
    std.debug.panic(fmts, args);
}

pub fn StringEnum(comptime Type: type, comptime Map: anytype, value: []const u8) ?Type {
    return ComptimeStringMap(Type, Map).get(value);
}

pub const Bunfig = @import("./bunfig.zig").Bunfig;
