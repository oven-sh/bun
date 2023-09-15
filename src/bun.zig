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

/// We cannot use a threadlocal memory allocator for FileSystem-related things
/// FileSystem is a singleton.
pub const fs_allocator = default_allocator;

pub const C = @import("root").C;
pub const sha = @import("./sha.zig");
pub const FeatureFlags = @import("feature_flags.zig");
pub const meta = @import("./meta.zig");
pub const ComptimeStringMap = @import("./comptime_string_map.zig").ComptimeStringMap;
pub const base64 = @import("./base64/base64.zig");
pub const path = @import("./resolver/resolve_path.zig");
pub const fmt = struct {
    pub usingnamespace std.fmt;

    pub fn quote(self: string) strings.QuotedFormatter {
        return strings.QuotedFormatter{
            .text = self,
        };
    }

    pub fn EnumTagListFormatter(comptime Enum: type, comptime Separator: @Type(.EnumLiteral)) type {
        return struct {
            pretty: bool = true,
            const output = brk: {
                var text: []const u8 = "";
                const names = std.meta.fieldNames(Enum);
                inline for (names, 0..) |name, i| {
                    if (Separator == .list) {
                        if (i > 0) {
                            if (i + 1 == names.len) {
                                text = text ++ ", or ";
                            } else {
                                text = text ++ ", ";
                            }
                        }

                        text = text ++ "\"" ++ name ++ "\"";
                    } else if (Separator == .dash) {
                        text = text ++ "\n-  " ++ name;
                    } else {
                        @compileError("Unknown separator type: must be .dash or .list");
                    }
                }
                break :brk text;
            };
            pub fn format(_: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
                try writer.writeAll(output);
            }
        };
    }

    pub fn enumTagList(comptime Enum: type, comptime separator: @Type(.EnumLiteral)) EnumTagListFormatter(Enum, separator) {
        return EnumTagListFormatter(Enum, separator){};
    }

    pub fn formatIp(address: std.net.Address, into: []u8) ![]u8 {
        // std.net.Address.format includes `:<port>` and square brackets (IPv6)
        //  while Node does neither.  This uses format then strips these to bring
        //  the result into conformance with Node.
        var result = try std.fmt.bufPrint(into, "{}", .{address});

        // Strip `:<port>`
        if (std.mem.lastIndexOfScalar(u8, result, ':')) |colon| {
            result = result[0..colon];
        }
        // Strip brackets
        if (result[0] == '[' and result[result.len - 1] == ']') {
            result = result[1 .. result.len - 1];
        }
        return result;
    }

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

            const log2 = math.log2(value);
            const magnitude = @min(log2 / comptime math.log2(1000), mags_si.len - 1);
            const new_value = math.lossyCast(f64, value) / math.pow(f64, 1000, math.lossyCast(f64, magnitude));
            const suffix = mags_si[magnitude];

            if (suffix == ' ') {
                try fmt.formatFloatDecimal(new_value / 1000.0, .{ .precision = 2 }, writer);
                return writer.writeAll(" KB");
            } else {
                try fmt.formatFloatDecimal(new_value, .{ .precision = if (std.math.approxEqAbs(f64, new_value, @trunc(new_value), 0.100)) @as(usize, 1) else @as(usize, 2) }, writer);
            }

            const buf = &[_]u8{ ' ', suffix, 'B' };
            return writer.writeAll(buf);
        }
    };

    pub fn size(value: anytype) SizeFormatter {
        return switch (@TypeOf(value)) {
            f64, f32, f128 => SizeFormatter{
                .value = @as(u64, @intFromFloat(value)),
            },
            else => SizeFormatter{ .value = @as(u64, @intCast(value)) },
        };
    }

    const lower_hex_table = [_]u8{
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        'a',
        'b',
        'c',
        'd',
        'e',
        'f',
    };
    const upper_hex_table = [_]u8{
        '0',
        '1',
        '2',
        '3',
        '4',
        '5',
        '6',
        '7',
        '8',
        '9',
        'A',
        'B',
        'C',
        'D',
        'E',
        'F',
    };
    pub fn HexIntFormatter(comptime Int: type, comptime lower: bool) type {
        return struct {
            value: Int,

            const table = if (lower) lower_hex_table else upper_hex_table;

            const BufType = [@bitSizeOf(Int) / 4]u8;

            fn getOutBuf(value: Int) BufType {
                var buf: BufType = undefined;
                comptime var i: usize = 0;
                inline while (i < buf.len) : (i += 1) {
                    // value relative to the current nibble
                    buf[i] = table[@as(u8, @as(u4, @truncate(value >> comptime ((buf.len - i - 1) * 4)))) & 0xF];
                }

                return buf;
            }

            pub fn format(self: @This(), comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
                const value = self.value;
                try writer.writeAll(&getOutBuf(value));
            }
        };
    }

    pub fn HexInt(comptime Int: type, comptime lower: std.fmt.Case, value: Int) HexIntFormatter(Int, lower == .lower) {
        const Formatter = HexIntFormatter(Int, lower == .lower);
        return Formatter{ .value = value };
    }

    pub fn hexIntLower(value: anytype) HexIntFormatter(@TypeOf(value), true) {
        const Formatter = HexIntFormatter(@TypeOf(value), true);
        return Formatter{ .value = value };
    }

    pub fn hexIntUpper(value: anytype) HexIntFormatter(@TypeOf(value), false) {
        const Formatter = HexIntFormatter(@TypeOf(value), false);
        return Formatter{ .value = value };
    }
};

pub const Output = @import("./output.zig");
pub const Global = @import("./__global.zig");

pub const FileDescriptor = if (Environment.isBrowser)
    u0
else if (Environment.isWindows)
    u64
else
    std.os.fd_t;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = if (Environment.isBrowser) u0 else FileDescriptor;

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
    return @constCast(s);
}

pub const MAX_PATH_BYTES: usize = if (Environment.isWasm) 1024 else std.fs.MAX_PATH_BYTES;
pub const MAX_WPATH = [MAX_PATH_BYTES / 2:0]u16;

pub inline fn cast(comptime To: type, value: anytype) To {
    if (comptime std.meta.trait.isIntegral(@TypeOf(value))) {
        return @as(To, @ptrFromInt(@as(usize, @bitCast(value))));
    }

    // TODO: file issue about why std.meta.Child only is necessary on Linux aarch64
    // it should be necessary on all targets
    return @ptrCast(@alignCast(value));
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
            .One => switch (@as(@import("builtin").TypeInfo, @typeInfo(info.child))) {
                .Array => |array| brk: {
                    if (array.sentinel != null) {
                        @compileError("use bun.sliceTo");
                    }

                    break :brk array.len;
                },
                else => @compileError("invalid type given to std.mem.len"),
            },
            .Many => {
                const sentinel_ptr = info.sentinel orelse
                    @compileError("length of pointer with no sentinel");
                const sentinel = @as(*align(1) const info.child, @ptrCast(sentinel_ptr)).*;

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

fn Span(comptime T: type) type {
    switch (@typeInfo(T)) {
        .Optional => |optional_info| {
            return ?Span(optional_info.child);
        },
        .Pointer => |ptr_info| {
            var new_ptr_info = ptr_info;
            switch (ptr_info.size) {
                .One => switch (@typeInfo(ptr_info.child)) {
                    .Array => |info| {
                        new_ptr_info.child = info.child;
                        new_ptr_info.sentinel = info.sentinel;
                    },
                    else => @compileError("invalid type given to std.mem.Span"),
                },
                .C => {
                    new_ptr_info.sentinel = &@as(ptr_info.child, 0);
                    new_ptr_info.is_allowzero = false;
                },
                .Many, .Slice => {},
            }
            new_ptr_info.size = .Slice;
            return @Type(.{ .Pointer = new_ptr_info });
        },
        else => @compileError("invalid type given to std.mem.Span"),
    }
}
// fn Span(comptime T: type) type {
//     switch (@typeInfo(T)) {
//         .Optional => |optional_info| {
//             return ?Span(optional_info.child);
//         },
//         .Pointer => |ptr_info| {
//             var new_ptr_info = ptr_info;
//             switch (ptr_info.size) {
//                 .C => {
//                     new_ptr_info.sentinel = &@as(ptr_info.child, 0);
//                     new_ptr_info.is_allowzero = false;
//                 },
//                 .Many => if (ptr_info.sentinel == null) @compileError("invalid type given to bun.span: " ++ @typeName(T)),
//                 else => {},
//             }
//             new_ptr_info.size = .Slice;
//             return @Type(.{ .Pointer = new_ptr_info });
//         },
//         else => {},
//     }
//     @compileError("invalid type given to bun.span: " ++ @typeName(T));
// }

pub fn span(ptr: anytype) Span(@TypeOf(ptr)) {
    if (@typeInfo(@TypeOf(ptr)) == .Optional) {
        if (ptr) |non_null| {
            return span(non_null);
        } else {
            return null;
        }
    }
    const Result = Span(@TypeOf(ptr));
    const l = len(ptr);
    const ptr_info = @typeInfo(Result).Pointer;
    if (ptr_info.sentinel) |s_ptr| {
        const s = @as(*align(1) const ptr_info.child, @ptrCast(s_ptr)).*;
        return ptr[0..l :s];
    } else {
        return ptr[0..l];
    }
}

pub const IdentityContext = @import("./identity_context.zig").IdentityContext;
pub const ArrayIdentityContext = @import("./identity_context.zig").ArrayIdentityContext;
pub const StringHashMapUnowned = struct {
    pub const Key = struct {
        hash: u64,
        len: usize,

        pub fn init(str: []const u8) Key {
            return Key{
                .hash = hash(str),
                .len = str.len,
            };
        }
    };

    pub const Adapter = struct {
        pub fn eql(_: @This(), a: Key, b: Key) bool {
            return a.hash == b.hash and a.len == b.len;
        }

        pub fn hash(_: @This(), key: Key) u64 {
            return key.hash;
        }
    };
};
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
    if (comptime Environment.allow_assert) std.debug.assert(dest.len >= src.len);
    if (@intFromPtr(src.ptr) == @intFromPtr(dest.ptr) or src.len == 0) return;

    const input: []const u8 = std.mem.sliceAsBytes(src);
    const output: []u8 = std.mem.sliceAsBytes(dest);

    std.debug.assert(input.len > 0);
    std.debug.assert(output.len > 0);

    const does_input_or_output_overlap = (@intFromPtr(input.ptr) < @intFromPtr(output.ptr) and
        @intFromPtr(input.ptr) + input.len > @intFromPtr(output.ptr)) or
        (@intFromPtr(output.ptr) < @intFromPtr(input.ptr) and
        @intFromPtr(output.ptr) + output.len > @intFromPtr(input.ptr));

    if (!does_input_or_output_overlap) {
        @memcpy(output[0..input.len], input);
    } else if (comptime Environment.isNative) {
        C.memmove(output.ptr, input.ptr, input.len);
    } else {
        for (input, output) |input_byte, *out| {
            out.* = input_byte;
        }
    }
}

pub const hasCloneFn = std.meta.trait.multiTrait(.{ std.meta.trait.isContainer, std.meta.trait.hasFn("clone") });
pub fn cloneWithType(comptime T: type, item: T, allocator: std.mem.Allocator) !T {
    if (comptime std.meta.trait.isIndexable(T)) {
        const Child = std.meta.Child(T);
        assertDefined(item);

        if (comptime hasCloneFn(Child)) {
            var slice = try allocator.alloc(Child, item.len);
            for (slice, 0..) |*val, i| {
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

pub fn assertDefined(val: anytype) void {
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
            std.debug.assert(@intFromPtr(val.ptr) != @intFromPtr(slice.ptr));
        }
        return;
    }

    if (comptime @typeInfo(Type) == .Pointer) {
        var slice: *Type = undefined;
        std.debug.assert(@intFromPtr(val) != @intFromPtr(slice));
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

pub fn hashWithSeed(seed: u64, content: []const u8) u64 {
    return std.hash.Wyhash.hash(seed, content);
}

pub fn hash32(content: []const u8) u32 {
    const res = hash(content);
    return @as(u32, @truncate(res));
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
pub fn isReadable(fd: FileDescriptor) PollFlag {
    if (comptime Environment.isWindows) {
        return todo(@src(), PollFlag.not_ready);
    }

    var polls = [_]std.os.pollfd{
        .{
            .fd = @intCast(fd),
            .events = std.os.POLL.IN | std.os.POLL.ERR,
            .revents = 0,
        },
    };

    const result = (std.os.poll(&polls, 0) catch 0) != 0;
    global_scope_log("poll({d}) readable: {any} ({d})", .{ fd, result, polls[0].revents });
    return if (result and polls[0].revents & std.os.POLL.HUP != 0)
        PollFlag.hup
    else if (result)
        PollFlag.ready
    else
        PollFlag.not_ready;
}

pub const PollFlag = enum { ready, not_ready, hup };
pub fn isWritable(fd: FileDescriptor) PollFlag {
    if (comptime Environment.isWindows) {
        return todo(@src(), PollFlag.not_ready);
    }

    var polls = [_]std.os.pollfd{
        .{
            .fd = @intCast(fd),
            .events = std.os.POLL.OUT,
            .revents = 0,
        },
    };

    const result = (std.os.poll(&polls, 0) catch 0) != 0;
    global_scope_log("poll({d}) writable: {any} ({d})", .{ fd, result, polls[0].revents });
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

pub const HTTPThread = @import("./http_client_async.zig").HTTPThread;

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

pub inline fn isSliceInBuffer(slice: []const u8, buffer: []const u8) bool {
    return slice.len > 0 and @intFromPtr(buffer.ptr) <= @intFromPtr(slice.ptr) and ((@intFromPtr(slice.ptr) + slice.len) <= (@intFromPtr(buffer.ptr) + buffer.len));
}

pub fn rangeOfSliceInBuffer(slice: []const u8, buffer: []const u8) ?[2]u32 {
    if (!isSliceInBuffer(slice, buffer)) return null;
    const r = [_]u32{
        @as(u32, @truncate(@intFromPtr(slice.ptr) -| @intFromPtr(buffer.ptr))),
        @as(u32, @truncate(slice.len)),
    };
    if (comptime Environment.allow_assert)
        std.debug.assert(strings.eqlLong(slice, buffer[r[0]..][0..r[1]], false));
    return r;
}

pub const invalid_fd = if (Environment.isWindows)
    // on windows, max usize is the process handle, a very valid fd
    std.math.maxInt(i32) + 1
else
    std.math.maxInt(FileDescriptor);

pub const UFileDescriptor = if (Environment.isWindows) usize else u32;

pub const simdutf = @import("./bun.js/bindings/bun-simdutf.zig");

pub const JSC = @import("root").JavaScriptCore;
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

pub fn openDir(dir: std.fs.Dir, path_: [:0]const u8) !std.fs.IterableDir {
    const fd = try std.os.openatZ(dir.fd, path_, std.os.O.DIRECTORY | std.os.O.CLOEXEC | 0, 0);
    return std.fs.IterableDir{ .dir = .{ .fd = fd } };
}
pub const MimallocArena = @import("./mimalloc_arena.zig").Arena;

/// This wrapper exists to avoid the call to sliceTo(0)
/// Zig's sliceTo(0) is scalar
pub fn getenvZ(path_: [:0]const u8) ?[]const u8 {
    if (comptime !Environment.isNative) {
        return null;
    }

    const ptr = std.c.getenv(path_.ptr) orelse return null;
    return sliceTo(ptr, 0);
}

//TODO: add windows support
pub const FDHashMapContext = struct {
    pub fn hash(_: @This(), fd: FileDescriptor) u64 {
        return @as(u64, @intCast(fd));
    }
    pub fn eql(_: @This(), a: FileDescriptor, b: FileDescriptor) bool {
        return a == b;
    }
    pub fn pre(input: FileDescriptor) Prehashed {
        return Prehashed{
            .value = @This().hash(.{}, input),
            .input = input,
        };
    }

    pub const Prehashed = struct {
        value: u64,
        input: FileDescriptor,
        pub fn hash(this: @This(), fd: FileDescriptor) u64 {
            if (fd == this.input) return this.value;
            return @as(u64, @intCast(fd));
        }

        pub fn eql(_: @This(), a: FileDescriptor, b: FileDescriptor) bool {
            return a == b;
        }
    };
};
// These wrappers exist to use our strings.eqlLong function
pub const StringArrayHashMapContext = struct {
    pub fn hash(_: @This(), s: []const u8) u32 {
        return @as(u32, @truncate(std.hash.Wyhash.hash(0, s)));
    }
    pub fn eql(_: @This(), a: []const u8, b: []const u8, _: usize) bool {
        return strings.eqlLong(a, b, true);
    }

    pub fn pre(input: []const u8) Prehashed {
        return Prehashed{
            .value = @This().hash(.{}, input),
            .input = input,
        };
    }

    pub const Prehashed = struct {
        value: u32,
        input: []const u8,
        pub fn hash(this: @This(), s: []const u8) u32 {
            if (s.ptr == this.input.ptr and s.len == this.input.len)
                return this.value;
            return @as(u32, @truncate(std.hash.Wyhash.hash(0, s)));
        }

        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            return strings.eqlLong(a, b, true);
        }
    };
};

pub const StringHashMapContext = struct {
    pub fn hash(_: @This(), s: []const u8) u64 {
        return std.hash.Wyhash.hash(0, s);
    }
    pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
        return strings.eqlLong(a, b, true);
    }

    pub fn pre(input: []const u8) Prehashed {
        return Prehashed{
            .value = @This().hash(.{}, input),
            .input = input,
        };
    }

    pub const Prehashed = struct {
        value: u64,
        input: []const u8,
        pub fn hash(this: @This(), s: []const u8) u64 {
            if (s.ptr == this.input.ptr and s.len == this.input.len)
                return this.value;
            return StringHashMapContext.hash(.{}, s);
        }

        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            return strings.eqlLong(a, b, true);
        }
    };

    pub const PrehashedCaseInsensitive = struct {
        value: u64,
        input: []const u8,
        pub fn init(allocator: std.mem.Allocator, input: []const u8) PrehashedCaseInsensitive {
            var out = allocator.alloc(u8, input.len) catch unreachable;
            _ = strings.copyLowercase(input, out);
            return PrehashedCaseInsensitive{
                .value = StringHashMapContext.hash(.{}, out),
                .input = out,
            };
        }
        pub fn deinit(this: @This(), allocator: std.mem.Allocator) void {
            allocator.free(this.input);
        }
        pub fn hash(this: @This(), s: []const u8) u64 {
            if (s.ptr == this.input.ptr and s.len == this.input.len)
                return this.value;
            return StringHashMapContext.hash(.{}, s);
        }

        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            return strings.eqlCaseInsensitiveASCIIICheckLength(a, b);
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

pub fn FDHashMap(comptime Type: type) type {
    return std.HashMap(StoredFileDescriptorType, Type, FDHashMapContext, std.hash_map.default_max_load_percentage);
}

const CopyFile = @import("./copy_file.zig");
pub const copyFileRange = CopyFile.copyFileRange;
pub const canUseCopyFileRangeSyscall = CopyFile.canUseCopyFileRangeSyscall;
pub const copyFile = CopyFile.copyFile;

pub fn parseDouble(input: []const u8) !f64 {
    if (comptime Environment.isWasm) {
        return try std.fmt.parseFloat(f64, input);
    }
    return JSC.WTF.parseDouble(input);
}

pub const SignalCode = enum(u8) {
    SIGHUP = 1,
    SIGINT = 2,
    SIGQUIT = 3,
    SIGILL = 4,
    SIGTRAP = 5,
    SIGABRT = 6,
    SIGBUS = 7,
    SIGFPE = 8,
    SIGKILL = 9,
    SIGUSR1 = 10,
    SIGSEGV = 11,
    SIGUSR2 = 12,
    SIGPIPE = 13,
    SIGALRM = 14,
    SIGTERM = 15,
    SIG16 = 16,
    SIGCHLD = 17,
    SIGCONT = 18,
    SIGSTOP = 19,
    SIGTSTP = 20,
    SIGTTIN = 21,
    SIGTTOU = 22,
    SIGURG = 23,
    SIGXCPU = 24,
    SIGXFSZ = 25,
    SIGVTALRM = 26,
    SIGPROF = 27,
    SIGWINCH = 28,
    SIGIO = 29,
    SIGPWR = 30,
    SIGSYS = 31,
    _,

    pub fn name(value: SignalCode) ?[]const u8 {
        if (@intFromEnum(value) <= @intFromEnum(SignalCode.SIGSYS)) {
            return asByteSlice(@tagName(value));
        }

        return null;
    }

    pub fn from(value: anytype) SignalCode {
        return @enumFromInt(std.mem.asBytes(&value)[0]);
    }

    pub fn format(self: SignalCode, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (self.name()) |str| {
            try std.fmt.format(writer, "code {d} ({s})", .{ @intFromEnum(self), str });
        } else {
            try std.fmt.format(writer, "code {d}", .{@intFromEnum(self)});
        }
    }
};

pub fn isMissingIOUring() bool {
    if (comptime !Environment.isLinux)
        // it is not missing when it was not supposed to be there in the first place
        return false;

    // cache the boolean value
    const Missing = struct {
        pub var is_missing_io_uring: ?bool = null;
    };

    return Missing.is_missing_io_uring orelse brk: {
        const kernel = Analytics.GenerateHeader.GeneratePlatform.kernelVersion();
        // io_uring was introduced in earlier versions of Linux, but it was not
        // really usable for us until 5.3
        const result = kernel.major < 5 or (kernel.major == 5 and kernel.minor < 3);
        Missing.is_missing_io_uring = result;
        break :brk result;
    };
}

pub const CLI = @import("./cli.zig");

pub const PackageManager = @import("./install/install.zig").PackageManager;

pub const fs = @import("./fs.zig");
pub const Bundler = bundler.Bundler;
pub const bundler = @import("./bundler.zig");
pub const which = @import("./which.zig").which;
pub const is_executable_fileZ = @import("./which.zig").is_executable_file;
pub const js_parser = @import("./js_parser.zig");
pub const js_printer = @import("./js_printer.zig");
pub const js_lexer = @import("./js_lexer.zig");
pub const JSON = @import("./json_parser.zig");
pub const JSAst = @import("./js_ast.zig");
pub const bit_set = @import("./bit_set.zig");

pub fn enumMap(comptime T: type, comptime args: anytype) (fn (T) []const u8) {
    const Map = struct {
        const vargs = args;
        const labels = brk: {
            var vabels_ = std.enums.EnumArray(T, []const u8).initFill("");
            @setEvalBranchQuota(99999);
            inline for (vargs) |field| {
                vabels_.set(field.@"0", field.@"1");
            }
            break :brk vabels_;
        };

        pub fn get(input: T) []const u8 {
            return labels.get(input);
        }
    };

    return Map.get;
}

pub fn ComptimeEnumMap(comptime T: type) type {
    comptime {
        var entries: [std.enums.values(T).len]struct { string, T } = undefined;
        var i: usize = 0;
        inline for (std.enums.values(T)) |value| {
            entries[i] = .{ .@"0" = @tagName(value), .@"1" = value };
            i += 1;
        }
        return ComptimeStringMap(T, entries);
    }
}

/// Write 0's for every byte in Type
/// Ignores default struct values.
pub fn zero(comptime Type: type) Type {
    var out: [@sizeOf(Type)]u8 align(@alignOf(Type)) = undefined;
    @memset(@as([*]u8, @ptrCast(&out))[0..out.len], 0);
    return @as(Type, @bitCast(out));
}
pub const c_ares = @import("./deps/c_ares.zig");
pub const URL = @import("./url.zig").URL;
pub const FormData = @import("./url.zig").FormData;

var needs_proc_self_workaround: bool = false;

// This is our "polyfill" when /proc/self/fd is not available it's only
// necessary on linux because other platforms don't have an optional
// /proc/self/fd
fn getFdPathViaCWD(fd: std.os.fd_t, buf: *[@This().MAX_PATH_BYTES]u8) ![]u8 {
    const prev_fd = try std.os.openatZ(std.fs.cwd().fd, ".", 0, 0);
    var needs_chdir = false;
    defer {
        if (needs_chdir) std.os.fchdir(prev_fd) catch unreachable;
        std.os.close(prev_fd);
    }
    try std.os.fchdir(fd);
    needs_chdir = true;
    return std.os.getcwd(buf);
}

/// Get the absolute path to a file descriptor.
/// On Linux, when `/proc/self/fd` is not available, this function will attempt to use `fchdir` and `getcwd` to get the path instead.
pub fn getFdPath(fd_: anytype, buf: *[@This().MAX_PATH_BYTES]u8) ![]u8 {
    const fd = fdcast(toFD(fd_));
    if (comptime !Environment.isLinux) {
        return std.os.getFdPath(fd, buf);
    }

    if (needs_proc_self_workaround) {
        return getFdPathViaCWD(fd, buf);
    }

    return std.os.getFdPath(fd, buf) catch |err| {
        if (err == error.FileNotFound and !needs_proc_self_workaround) {
            needs_proc_self_workaround = true;
            return getFdPathViaCWD(fd, buf);
        }

        return err;
    };
}

fn lenSliceTo(ptr: anytype, comptime end: meta.Elem(@TypeOf(ptr))) usize {
    switch (@typeInfo(@TypeOf(ptr))) {
        .Pointer => |ptr_info| switch (ptr_info.size) {
            .One => switch (@typeInfo(ptr_info.child)) {
                .Array => |array_info| {
                    if (array_info.sentinel) |sentinel_ptr| {
                        const sentinel = @as(*align(1) const array_info.child, @ptrCast(sentinel_ptr)).*;
                        if (sentinel == end) {
                            return indexOfSentinel(array_info.child, end, ptr);
                        }
                    }
                    return std.mem.indexOfScalar(array_info.child, ptr, end) orelse array_info.len;
                },
                else => {},
            },
            .Many => if (ptr_info.sentinel) |sentinel_ptr| {
                const sentinel = @as(*align(1) const ptr_info.child, @ptrCast(sentinel_ptr)).*;
                // We may be looking for something other than the sentinel,
                // but iterating past the sentinel would be a bug so we need
                // to check for both.
                var i: usize = 0;
                while (ptr[i] != end and ptr[i] != sentinel) i += 1;
                return i;
            },
            .C => {
                std.debug.assert(ptr != null);
                return indexOfSentinel(ptr_info.child, end, ptr);
            },
            .Slice => {
                if (ptr_info.sentinel) |sentinel_ptr| {
                    const sentinel = @as(*align(1) const ptr_info.child, @ptrCast(sentinel_ptr)).*;
                    if (sentinel == end) {
                        return indexOfSentinel(ptr_info.child, sentinel, ptr);
                    }
                }
                return std.mem.indexOfScalar(ptr_info.child, ptr, end) orelse ptr.len;
            },
        },
        else => {},
    }
    @compileError("invalid type given to std.mem.sliceTo: " ++ @typeName(@TypeOf(ptr)));
}

/// Helper for the return type of sliceTo()
fn SliceTo(comptime T: type, comptime end: meta.Elem(T)) type {
    switch (@typeInfo(T)) {
        .Optional => |optional_info| {
            return ?SliceTo(optional_info.child, end);
        },
        .Pointer => |ptr_info| {
            var new_ptr_info = ptr_info;
            new_ptr_info.size = .Slice;
            switch (ptr_info.size) {
                .One => switch (@typeInfo(ptr_info.child)) {
                    .Array => |array_info| {
                        new_ptr_info.child = array_info.child;
                        // The return type must only be sentinel terminated if we are guaranteed
                        // to find the value searched for, which is only the case if it matches
                        // the sentinel of the type passed.
                        if (array_info.sentinel) |sentinel_ptr| {
                            const sentinel = @as(*align(1) const array_info.child, @ptrCast(sentinel_ptr)).*;
                            if (end == sentinel) {
                                new_ptr_info.sentinel = &end;
                            } else {
                                new_ptr_info.sentinel = null;
                            }
                        }
                    },
                    else => {},
                },
                .Many, .Slice => {
                    // The return type must only be sentinel terminated if we are guaranteed
                    // to find the value searched for, which is only the case if it matches
                    // the sentinel of the type passed.
                    if (ptr_info.sentinel) |sentinel_ptr| {
                        const sentinel = @as(*align(1) const ptr_info.child, @ptrCast(sentinel_ptr)).*;
                        if (end == sentinel) {
                            new_ptr_info.sentinel = &end;
                        } else {
                            new_ptr_info.sentinel = null;
                        }
                    }
                },
                .C => {
                    new_ptr_info.sentinel = &end;
                    // C pointers are always allowzero, but we don't want the return type to be.
                    std.debug.assert(new_ptr_info.is_allowzero);
                    new_ptr_info.is_allowzero = false;
                },
            }
            return @Type(.{ .Pointer = new_ptr_info });
        },
        else => {},
    }
    @compileError("invalid type given to std.mem.sliceTo: " ++ @typeName(T));
}

/// Takes an array, a pointer to an array, a sentinel-terminated pointer, or a slice and
/// iterates searching for the first occurrence of `end`, returning the scanned slice.
/// If `end` is not found, the full length of the array/slice/sentinel terminated pointer is returned.
/// If the pointer type is sentinel terminated and `end` matches that terminator, the
/// resulting slice is also sentinel terminated.
/// Pointer properties such as mutability and alignment are preserved.
/// C pointers are assumed to be non-null.
pub fn sliceTo(ptr: anytype, comptime end: meta.Elem(@TypeOf(ptr))) SliceTo(@TypeOf(ptr), end) {
    if (@typeInfo(@TypeOf(ptr)) == .Optional) {
        const non_null = ptr orelse return null;
        return sliceTo(non_null, end);
    }
    const Result = SliceTo(@TypeOf(ptr), end);
    const length = lenSliceTo(ptr, end);
    const ptr_info = @typeInfo(Result).Pointer;
    if (ptr_info.sentinel) |s_ptr| {
        const s = @as(*align(1) const ptr_info.child, @ptrCast(s_ptr)).*;
        return ptr[0..length :s];
    } else {
        return ptr[0..length];
    }
}

pub fn cstring(input: []const u8) [:0]const u8 {
    if (input.len == 0)
        return "";

    if (comptime Environment.allow_assert) {
        std.debug.assert(
            input.ptr[input.len] == 0,
        );
    }
    return @as([*:0]const u8, @ptrCast(input.ptr))[0..input.len :0];
}

pub const Semver = @import("./install/semver.zig");
pub const ImportRecord = @import("./import_record.zig").ImportRecord;
pub const ImportKind = @import("./import_record.zig").ImportKind;

pub usingnamespace @import("./util.zig");
pub const fast_debug_build_cmd = .None;
pub const fast_debug_build_mode = fast_debug_build_cmd != .None and
    Environment.isDebug;

pub const MultiArrayList = @import("./multi_array_list.zig").MultiArrayList;

pub const Joiner = @import("./string_joiner.zig");
pub const renamer = @import("./renamer.zig");
pub const sourcemap = struct {
    pub usingnamespace @import("./sourcemap/sourcemap.zig");
    pub usingnamespace @import("./sourcemap/CodeCoverage.zig");
};

pub fn asByteSlice(buffer: anytype) []const u8 {
    return switch (@TypeOf(buffer)) {
        []const u8, []u8, [:0]const u8, [:0]u8 => buffer.ptr[0..buffer.len],
        [*:0]u8, [*:0]const u8 => buffer[0..len(buffer)],
        [*c]const u8, [*c]u8 => span(buffer),
        else => |T| {
            if (comptime std.meta.trait.isPtrTo(.Array)(T)) {
                return @as([]const u8, buffer);
            }

            @compileError("Unsupported type " ++ @typeName(T));
        },
    };
}

comptime {
    if (fast_debug_build_cmd != .RunCommand and fast_debug_build_mode) {
        _ = @import("./bun.js/node/buffer.zig").BufferVectorized.fill;
        _ = @import("./cli/upgrade_command.zig").Version;
    }
}

pub fn DebugOnlyDisabler(comptime Type: type) type {
    return struct {
        const T = Type;
        threadlocal var disable_create_in_debug: if (Environment.allow_assert) usize else u0 = 0;
        pub inline fn disable() void {
            if (comptime !Environment.allow_assert) return;
            disable_create_in_debug += 1;
        }

        pub inline fn enable() void {
            if (comptime !Environment.allow_assert) return;
            disable_create_in_debug -= 1;
        }

        pub inline fn assert() void {
            if (comptime !Environment.allow_assert) return;
            if (disable_create_in_debug > 0) {
                Output.panic(comptime "[" ++ @typeName(T) ++ "] called while disabled (did you forget to call enable?)", .{});
            }
        }
    };
}

const FailingAllocator = struct {
    fn alloc(_: *anyopaque, _: usize, _: u8, _: usize) ?[*]u8 {
        if (comptime Environment.allow_assert) {
            unreachablePanic("FailingAllocator should never be reached. This means some memory was not defined", .{});
        }
        return null;
    }

    fn resize(_: *anyopaque, _: []u8, _: u8, _: usize, _: usize) bool {
        if (comptime Environment.allow_assert) {
            unreachablePanic("FailingAllocator should never be reached. This means some memory was not defined", .{});
        }
        return false;
    }

    fn free(
        _: *anyopaque,
        _: []u8,
        _: u8,
        _: usize,
    ) void {
        unreachable;
    }
};

/// When we want to avoid initializing a value as undefined, we can use this allocator
pub const failing_allocator = std.mem.Allocator{ .ptr = undefined, .vtable = &.{
    .alloc = FailingAllocator.alloc,
    .resize = FailingAllocator.resize,
    .free = FailingAllocator.free,
} };

/// Reload Bun's process
///
/// This clones envp, argv, and gets the current executable path
///
/// Overwrites the current process with the new process
///
/// Must be able to allocate memory. malloc is not signal safe, but it's
/// best-effort. Not much we can do if it fails.
pub fn reloadProcess(
    allocator: std.mem.Allocator,
    clear_terminal: bool,
) void {
    const PosixSpawn = @import("./bun.js/api/bun/spawn.zig").PosixSpawn;
    const bun = @This();
    var dupe_argv = allocator.allocSentinel(?[*:0]const u8, bun.argv().len, null) catch unreachable;
    for (bun.argv(), dupe_argv) |src, *dest| {
        dest.* = (allocator.dupeZ(u8, sliceTo(src, 0)) catch unreachable).ptr;
    }

    var environ_slice = std.mem.span(std.c.environ);
    var environ = allocator.allocSentinel(?[*:0]const u8, environ_slice.len, null) catch unreachable;
    for (environ_slice, environ) |src, *dest| {
        if (src == null) {
            dest.* = null;
        } else {
            dest.* = (allocator.dupeZ(u8, sliceTo(src.?, 0)) catch unreachable).ptr;
        }
    }

    // we must clone selfExePath incase the argv[0] was not an absolute path (what appears in the terminal)
    const exec_path = (allocator.dupeZ(u8, std.fs.selfExePathAlloc(allocator) catch unreachable) catch unreachable).ptr;

    // we clone argv so that the memory address isn't the same as the libc one
    const argv = @as([*:null]?[*:0]const u8, @ptrCast(dupe_argv.ptr));

    // we clone envp so that the memory address of environment variables isn't the same as the libc one
    const envp = @as([*:null]?[*:0]const u8, @ptrCast(environ.ptr));

    // Clear the terminal
    if (clear_terminal) {
        Output.flush();
        Output.disableBuffering();
        Output.resetTerminalAll();
    }

    // macOS doesn't have CLOEXEC, so we must go through posix_spawn
    if (comptime Environment.isMac) {
        var actions = PosixSpawn.Actions.init() catch unreachable;
        actions.inherit(0) catch unreachable;
        actions.inherit(1) catch unreachable;
        actions.inherit(2) catch unreachable;
        var attrs = PosixSpawn.Attr.init() catch unreachable;
        attrs.set(
            C.POSIX_SPAWN_CLOEXEC_DEFAULT |
                // Apple Extension: If this bit is set, rather
                // than returning to the caller, posix_spawn(2)
                // and posix_spawnp(2) will behave as a more
                // featureful execve(2).
                C.POSIX_SPAWN_SETEXEC |
                C.POSIX_SPAWN_SETSIGDEF | C.POSIX_SPAWN_SETSIGMASK,
        ) catch unreachable;
        switch (PosixSpawn.spawnZ(exec_path, actions, attrs, @as([*:null]?[*:0]const u8, @ptrCast(argv)), @as([*:null]?[*:0]const u8, @ptrCast(envp)))) {
            .err => |err| {
                Output.panic("Unexpected error while reloading: {d} {s}", .{ err.errno, @tagName(err.getErrno()) });
            },
            .result => |_| {},
        }
    } else {
        const err = std.os.execveZ(
            exec_path,
            argv,
            envp,
        );
        Output.panic("Unexpected error while reloading: {s}", .{@errorName(err)});
    }
}
pub var auto_reload_on_crash = false;

pub const options = @import("./options.zig");
pub const StringSet = struct {
    map: Map,

    pub const Map = StringArrayHashMap(void);

    pub fn init(allocator: std.mem.Allocator) StringSet {
        return StringSet{
            .map = Map.init(allocator),
        };
    }

    pub fn keys(self: StringSet) []const string {
        return self.map.keys();
    }

    pub fn insert(self: *StringSet, key: []const u8) !void {
        var entry = try self.map.getOrPut(key);
        if (!entry.found_existing) {
            entry.key_ptr.* = try self.map.allocator.dupe(u8, key);
        }
    }

    pub fn deinit(self: *StringSet) void {
        for (self.map.keys()) |key| {
            self.map.allocator.free(key);
        }

        self.map.deinit();
    }
};

pub const Schema = @import("./api/schema.zig");

pub const StringMap = struct {
    map: Map,
    dupe_keys: bool = false,

    pub const Map = StringArrayHashMap(string);

    pub fn init(allocator: std.mem.Allocator, dupe_keys: bool) StringMap {
        return StringMap{
            .map = Map.init(allocator),
            .dupe_keys = dupe_keys,
        };
    }

    pub fn keys(self: StringMap) []const string {
        return self.map.keys();
    }

    pub fn values(self: StringMap) []const string {
        return self.map.values();
    }

    pub fn count(self: StringMap) usize {
        return self.map.count();
    }

    pub fn toAPI(self: StringMap) Schema.Api.StringMap {
        return Schema.Api.StringMap{
            .keys = self.keys(),
            .values = self.values(),
        };
    }

    pub fn insert(self: *StringMap, key: []const u8, value: []const u8) !void {
        var entry = try self.map.getOrPut(key);
        if (!entry.found_existing) {
            if (self.dupe_keys)
                entry.key_ptr.* = try self.map.allocator.dupe(u8, key);
        } else {
            self.map.allocator.free(entry.value_ptr.*);
        }

        entry.value_ptr.* = try self.map.allocator.dupe(u8, value);
    }
    pub const put = insert;

    pub fn get(self: *const StringMap, key: []const u8) ?[]const u8 {
        return self.map.get(key);
    }

    pub fn sort(self: *StringMap, sort_ctx: anytype) void {
        self.map.sort(sort_ctx);
    }

    pub fn deinit(self: *StringMap) void {
        for (self.map.values()) |value| {
            self.map.allocator.free(value);
        }

        if (self.dupe_keys) {
            for (self.map.keys()) |key| {
                self.map.allocator.free(key);
            }
        }

        self.map.deinit();
    }
};

pub const DotEnv = @import("./env_loader.zig");
pub const BundleV2 = @import("./bundler/bundle_v2.zig").BundleV2;
pub const ParseTask = @import("./bundler/bundle_v2.zig").ParseTask;

pub const Lock = @import("./lock.zig").Lock;
pub const UnboundedQueue = @import("./bun.js/unbounded_queue.zig").UnboundedQueue;

pub fn threadlocalAllocator() std.mem.Allocator {
    if (comptime use_mimalloc) {
        return MimallocArena.getThreadlocalDefault();
    }

    return default_allocator;
}

pub fn Ref(comptime T: type) type {
    return struct {
        ref_count: u32,
        allocator: std.mem.Allocator,
        value: T,

        pub fn init(value: T, allocator: std.mem.Allocator) !*@This() {
            var this = try allocator.create(@This());
            this.allocator = allocator;
            this.ref_count = 1;
            this.value = value;
            return this;
        }

        pub fn ref(this: *@This()) *@This() {
            this.ref_count += 1;
            return this;
        }

        pub fn unref(this: *@This()) ?*@This() {
            this.ref_count -= 1;
            if (this.ref_count == 0) {
                if (@hasDecl(T, "deinit")) {
                    this.value.deinit();
                }
                this.allocator.destroy(this);
                return null;
            }
            return this;
        }
    };
}

pub fn HiveRef(comptime T: type, comptime capacity: u16) type {
    return struct {
        const HiveAllocator = HiveArray(@This(), capacity).Fallback;

        ref_count: u32,
        allocator: *HiveAllocator,
        value: T,

        pub fn init(value: T, allocator: *HiveAllocator) !*@This() {
            var this = try allocator.tryGet();
            this.allocator = allocator;
            this.ref_count = 1;
            this.value = value;
            return this;
        }

        pub fn ref(this: *@This()) *@This() {
            this.ref_count += 1;
            return this;
        }

        pub fn unref(this: *@This()) ?*@This() {
            this.ref_count -= 1;
            if (this.ref_count == 0) {
                if (@hasDecl(T, "deinit")) {
                    this.value.deinit();
                }
                this.allocator.put(this);
                return null;
            }
            return this;
        }
    };
}

pub const MaxHeapAllocator = @import("./max_heap_allocator.zig").MaxHeapAllocator;

pub const tracy = @import("./tracy.zig");
pub const trace = tracy.trace;

pub fn openFileForPath(path_: [:0]const u8) !std.fs.File {
    const O_PATH = if (comptime Environment.isLinux) std.os.O.PATH else std.os.O.RDONLY;
    const flags: u32 = std.os.O.CLOEXEC | std.os.O.NOCTTY | O_PATH;

    const fd = try std.os.openZ(path_, flags, 0);
    return std.fs.File{
        .handle = fd,
    };
}

pub fn openDirForPath(path_: [:0]const u8) !std.fs.Dir {
    const O_PATH = if (comptime Environment.isLinux) std.os.O.PATH else std.os.O.RDONLY;
    const flags: u32 = std.os.O.CLOEXEC | std.os.O.NOCTTY | std.os.O.DIRECTORY | O_PATH;

    const fd = try std.os.openZ(path_, flags, 0);
    return std.fs.Dir{
        .fd = fd,
    };
}

pub const Generation = u16;

pub const zstd = @import("./deps/zstd.zig");
pub const StringPointer = Schema.Api.StringPointer;
pub const StandaloneModuleGraph = @import("./standalone_bun.zig").StandaloneModuleGraph;

pub const String = @import("./string.zig").String;
pub const SliceWithUnderlyingString = @import("./string.zig").SliceWithUnderlyingString;

pub const WTF = struct {
    /// The String type from WebKit's WTF library.
    pub const StringImpl = @import("./string.zig").WTFStringImpl;
};

pub const ArenaAllocator = @import("./ArenaAllocator.zig").ArenaAllocator;

pub const Wyhash = @import("./wyhash.zig").Wyhash;

pub const RegularExpression = @import("./bun.js/bindings/RegularExpression.zig").RegularExpression;
pub inline fn assertComptime() void {
    if (comptime !@inComptime()) {
        @compileError("This function can only be called in comptime.");
    }
}

const TODO_LOG = Output.scoped(.TODO, false);
pub inline fn todo(src: std.builtin.SourceLocation, value: anytype) @TypeOf(value) {
    if (comptime Environment.allow_assert) {
        TODO_LOG("{s}() at {s}:{d}:{d}", .{ src.fn_name, src.file, src.line, src.column });
    }

    return value;
}

pub inline fn fdcast(fd: FileDescriptor) std.os.fd_t {
    if (comptime FileDescriptor == std.os.fd_t) {
        return fd;
    }

    return @ptrFromInt(fd);
}

pub inline fn socketcast(fd: FileDescriptor) std.os.fd_t {
    if (comptime FileDescriptor == std.os.fd_t) {
        return fd;
    }

    return @ptrFromInt(fd);
}

pub inline fn toFD(fd: anytype) FileDescriptor {
    const FD = @TypeOf(fd);
    if (comptime FileDescriptor == std.os.fd_t) {
        return @intCast(fd);
    }

    if (comptime FD == std.os.fd_t) {
        return @intFromPtr(fd);
    }

    return @intCast(fd);
}

pub const HOST_NAME_MAX = if (Environment.isWindows)
    // TODO: i have no idea what this value should be
    256
else
    std.os.HOST_NAME_MAX;

pub const enums = @import("./enums.zig");
const WindowsStat = extern struct {
    dev: u32,
    ino: u32,
    nlink: usize,

    mode: Mode,
    uid: u32,
    gid: u32,
    rdev: u32,
    size: u32,
    blksize: isize,
    blocks: i64,

    atim: std.c.timespec,
    mtim: std.c.timespec,
    ctim: std.c.timespec,

    pub fn mtime(this: *const WindowsStat) std.c.timespec {
        return this.mtim;
    }

    pub fn ctime(this: *const WindowsStat) std.c.timespec {
        return this.ctim;
    }

    pub fn atime(this: *const WindowsStat) std.c.timespec {
        return this.atim;
    }
};

pub const Stat = if (Environment.isPosix) std.os.Stat else WindowsStat;

pub const posix = struct {
    pub const STDOUT_FD = std.os.STDOUT_FILENO;
    pub const STDERR_FD = std.os.STDERR_FILENO;
    pub const STDIN_FD = std.os.STDIN_FILENO;
    pub inline fn argv() [][*:0]u8 {
        return std.os.argv;
    }
    pub inline fn setArgv(new_ptr: [][*:0]u8) void {
        std.os.argv = new_ptr;
    }

    pub fn stdio(i: anytype) FileDescriptor {
        return switch (i) {
            STDOUT_FD => STDOUT_FD,
            STDERR_FD => STDERR_FD,
            STDIN_FD => STDIN_FD,
            else => @panic("Invalid stdio fd"),
        };
    }
};

pub const win32 = struct {
    pub var STDOUT_FD: FileDescriptor = undefined;
    pub var STDERR_FD: FileDescriptor = undefined;
    pub var STDIN_FD: FileDescriptor = undefined;
    var argv_: [][*:0]u8 = undefined;
    var args_buf: [255][*:0]u8 = undefined;

    pub inline fn argv() [][*:0]u8 {
        return argv_;
    }

    pub inline fn setArgv(new_ptr: [][*:0]u8) void {
        argv_ = new_ptr;
    }

    pub fn stdio(i: anytype) FileDescriptor {
        return switch (i) {
            0 => STDIN_FD,
            1 => STDOUT_FD,
            2 => STDERR_FD,
            else => @panic("Invalid stdio fd"),
        };
    }

    pub fn populateArgv() void {
        const kernel32 = windows;

        var wargv_all = kernel32.GetCommandLineW();
        var num_args: c_int = 0;
        var start = kernel32.CommandLineToArgvW(wargv_all, &num_args);
        defer _ = kernel32.LocalFree(@ptrCast(start));
        var wargv = start[0..@as(usize, @intCast(num_args))];
        var argv_list = std.ArrayList([*:0]u8).init(default_allocator);
        argv_list.items = &args_buf;
        argv_list.capacity = args_buf.len;

        if (wargv.len > args_buf.len) {
            var ptrs = default_allocator.alloc(?[*]u8, wargv.len + 1) catch unreachable;
            ptrs[ptrs.len - 1] = null;
            argv_list.items = @ptrCast(ptrs[0 .. ptrs.len - 1]);
            argv_list.capacity = argv_list.items.len + 1;
        }

        const probably_overestimated_length = strings.elementLengthUTF16IntoUTF8([]const u16, sliceTo(wargv_all, 0)) + argv_list.items.len;
        var buf = default_allocator.alloc(u8, probably_overestimated_length) catch unreachable;
        var builder = StringBuilder{
            .cap = probably_overestimated_length,
            .ptr = buf.ptr,
            .len = 0,
        };

        for (wargv) |warg_| {
            var warg = sliceTo(warg_, 0);
            argv_list.appendAssumeCapacity(
                (builder.append16(warg) orelse brk: {
                    var list = strings.convertUTF16ToUTF8(std.ArrayList(u8).init(default_allocator), []const u16, warg) catch unreachable;
                    list.append(0) catch unreachable;
                    break :brk list.items.ptr[0..list.items.len :0];
                }).ptr,
            );
        }

        argv_ = argv_list.items.ptr[0..argv_list.items.len];
    }
};

pub usingnamespace if (@import("builtin").target.os.tag != .windows) posix else win32;

pub fn isRegularFile(mode: Mode) bool {
    if (comptime Environment.isPosix) {
        return std.os.S.ISREG(mode);
    }

    if (comptime Environment.isWindows) {
        return todo(@src(), true);
    }

    @compileError("Unsupported platform");
}

pub const sys = @import("./sys.zig");

pub const Mode = C.Mode;

pub const windows = @import("./windows.zig");

pub const FDTag = enum {
    none,
    stderr,
    stdin,
    stdout,
    pub fn get(fd_: anytype) FDTag {
        const fd = toFD(fd_);
        if (comptime Environment.isWindows) {
            if (fd == win32.STDOUT_FD) {
                return .stdout;
            } else if (fd == win32.STDERR_FD) {
                return .stderr;
            } else if (fd == win32.STDIN_FD) {
                return .stdin;
            }

            return .none;
        } else {
            return switch (fd) {
                posix.STDIN_FD => FDTag.stdin,
                posix.STDOUT_FD => FDTag.stdout,
                posix.STDERR_FD => FDTag.stderr,
                else => .none,
            };
        }
    }
};

pub fn fdi32(fd_: anytype) i32 {
    if (comptime Environment.isPosix) {
        return @intCast(toFD(fd_));
    }

    if (comptime @TypeOf(fd_) == *anyopaque) {
        return @intCast(@intFromPtr(fd_));
    }

    return @intCast(fd_);
}

pub const OSPathSlice = if (Environment.isWindows) [:0]const u16 else [:0]const u8;
