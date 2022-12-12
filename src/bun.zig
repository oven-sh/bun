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
pub const meta = @import("./meta.zig");
pub const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;
pub const base64 = @import("./base64/base64.zig");
pub const path = @import("./resolver/resolve_path.zig");
pub const fmt = struct {
    pub usingnamespace std.fmt;

    // https://lemire.me/blog/2021/06/03/computing-the-number-of-digits-of-an-integer-even-faster/
    pub fn fastDigitCount(x: u64) u64 {
        const table = [_]u64{
            4294967296,
            8589934582,
            8589934582,
            8589934582,
            12884901788,
            12884901788,
            12884901788,
            17179868184,
            17179868184,
            17179868184,
            21474826480,
            21474826480,
            21474826480,
            21474826480,
            25769703776,
            25769703776,
            25769703776,
            30063771072,
            30063771072,
            30063771072,
            34349738368,
            34349738368,
            34349738368,
            34349738368,
            38554705664,
            38554705664,
            38554705664,
            41949672960,
            41949672960,
            41949672960,
            42949672960,
            42949672960,
        };
        return x + table[std.math.log2(x)] >> 32;
    }

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

pub const FileDescriptor = if (Environment.isBrowser) u0 else std.os.fd_t;

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

const global_scope_log = Output.scoped(.bun, false);
pub fn isReadable(fd: std.os.fd_t) PollFlag {
    var polls = &[_]std.os.pollfd{
        .{
            .fd = fd,
            .events = std.os.POLL.IN | std.os.POLL.ERR,
            .revents = 0,
        },
    };

    const result = (std.os.poll(polls, 0) catch 0) != 0;
    global_scope_log("poll({d}) readable: {d} ({d})", .{ fd, result, polls[0].revents });
    return if (result and polls[0].revents & std.os.POLL.HUP != 0)
        PollFlag.hup
    else if (result)
        PollFlag.ready
    else
        PollFlag.not_ready;
}

pub const PollFlag = enum { ready, not_ready, hup };
pub fn isWritable(fd: std.os.fd_t) PollFlag {
    var polls = &[_]std.os.pollfd{
        .{
            .fd = fd,
            .events = std.os.POLL.OUT,
            .revents = 0,
        },
    };

    const result = (std.os.poll(polls, 0) catch 0) != 0;
    global_scope_log("poll({d}) writable: {d} ({d})", .{ fd, result, polls[0].revents });
    if (result and polls[0].revents & std.os.POLL.HUP != 0) {
        return PollFlag.hup;
    } else if (result) {
        return PollFlag.ready;
    } else {
        return PollFlag.not_ready;
    }
}

pub inline fn unreachablePanic(comptime fmts: []const u8, args: anytype) noreturn {
    if (comptime !Environment.allow_assert) unreachable;
    std.debug.panic(fmts, args);
}

pub fn StringEnum(comptime Type: type, comptime Map: anytype, value: []const u8) ?Type {
    return ComptimeStringMap(Type, Map).get(value);
}

pub const Bunfig = @import("./bunfig.zig").Bunfig;

pub const HTTPThead = @import("./http_client_async.zig").HTTPThread;

pub const Analytics = @import("./analytics/analytics_thread.zig");

pub usingnamespace @import("./tagged_pointer.zig");

pub fn once(comptime function: anytype, comptime ReturnType: type) ReturnType {
    const Result = struct {
        var value: ReturnType = undefined;
        var ran = false;

        pub fn execute() ReturnType {
            if (ran) return value;
            ran = true;
            value = function();
            return value;
        }
    };

    return Result.execute();
}

pub fn isHeapMemory(memory: anytype) bool {
    if (comptime use_mimalloc) {
        const Memory = @TypeOf(memory);
        if (comptime std.meta.trait.isSingleItemPtr(Memory)) {
            return Mimalloc.mi_is_in_heap_region(memory);
        }
        return Mimalloc.mi_is_in_heap_region(std.mem.sliceAsBytes(memory).ptr);
    }
    return false;
}

pub const Mimalloc = @import("./allocators/mimalloc.zig");

pub fn isSliceInBuffer(slice: []const u8, buffer: []const u8) bool {
    return slice.len > 0 and @ptrToInt(buffer.ptr) <= @ptrToInt(slice.ptr) and ((@ptrToInt(slice.ptr) + slice.len) <= (@ptrToInt(buffer.ptr) + buffer.len));
}

pub fn rangeOfSliceInBuffer(slice: []const u8, buffer: []const u8) ?[2]u32 {
    if (!isSliceInBuffer(slice, buffer)) return null;
    const r = [_]u32{
        @truncate(u32, @ptrToInt(slice.ptr) -| @ptrToInt(buffer.ptr)),
        @truncate(u32, slice.len),
    };
    if (comptime Environment.allow_assert)
        std.debug.assert(strings.eqlLong(slice, buffer[r[0]..][0..r[1]], false));
    return r;
}

pub const invalid_fd = std.math.maxInt(FileDescriptor);

pub const simdutf = @import("./bun.js/bindings/bun-simdutf.zig");

pub const JSC = @import("javascript_core");
pub const AsyncIO = @import("async_io");

pub const logger = @import("./logger.zig");
pub const HTTP = @import("./http_client_async.zig");
pub const ThreadPool = @import("./thread_pool.zig");
pub const picohttp = @import("./deps/picohttp.zig");
pub const uws = @import("./deps/uws.zig");
pub const BoringSSL = @import("./boringssl.zig");
pub const LOLHTML = @import("./deps/lol-html.zig");
pub const clap = @import("./deps/zig-clap/clap.zig");
pub const analytics = @import("./analytics.zig");
pub const DateTime = @import("./deps/zig-datetime/src/datetime.zig");

pub var start_time: i128 = 0;
pub const MimallocArena = @import("./mimalloc_arena.zig").Arena;

/// This wrapper exists to avoid the call to sliceTo(0)
/// Zig's sliceTo(0) is scalar
pub fn getenvZ(path_: [:0]const u8) ?[]const u8 {
    const ptr = std.c.getenv(path_.ptr) orelse return null;
    return span(ptr);
}

// These wrappers exist to use our strings.eqlLong function
pub const StringArrayHashMapContext = struct {
    pub fn hash(_: @This(), s: []const u8) u32 {
        return @truncate(u32, std.hash.Wyhash.hash(0, s));
    }
    pub fn eql(_: @This(), a: []const u8, b: []const u8, _: usize) bool {
        return strings.eqlLong(a, b, true);
    }
};

pub const StringHashMapContext = struct {
    pub fn hash(_: @This(), s: []const u8) u64 {
        return std.hash.Wyhash.hash(0, s);
    }
    pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
        return strings.eqlLong(a, b, true);
    }

    pub const Prehashed = struct {
        value: u64,
        input: []const u8,
        pub fn hash(this: @This(), s: []const u8) u64 {
            if (s.ptr == this.input.ptr and s.len == this.input.len)
                return this.value;
            return std.hash.Wyhash.hash(0, s);
        }

        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            return strings.eqlLong(a, b, true);
        }
    };
};

pub fn StringArrayHashMap(comptime Type: type) type {
    return std.ArrayHashMap([]const u8, Type, StringArrayHashMapContext, true);
}

pub fn StringArrayHashMapUnmanaged(comptime Type: type) type {
    return std.ArrayHashMapUnmanaged([]const u8, Type, StringArrayHashMapContext, true);
}

pub fn StringHashMap(comptime Type: type) type {
    return std.HashMap([]const u8, Type, StringHashMapContext, std.hash_map.default_max_load_percentage);
}

pub fn StringHashMapUnmanaged(comptime Type: type) type {
    return std.HashMapUnmanaged([]const u8, Type, StringHashMapContext, std.hash_map.default_max_load_percentage);
}

const CopyFile = @import("./copy_file.zig");
pub const copyFileRange = CopyFile.copyFileRange;
pub const copyFile = CopyFile.copyFile;

pub fn parseDouble(input: []const u8) !f64 {
    return JSC.WTF.parseDouble(input);
}
