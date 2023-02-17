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
                    buf[i] = table[@as(u8, @truncate(u4, value >> comptime ((buf.len - i - 1) * 4))) & 0xF];
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

    // TODO: file issue about why std.meta.Child only is necessary on Linux aarch64
    // it should be necessary on all targets
    return @ptrCast(To, @alignCast(@alignOf(std.meta.Child(To)), value));
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
                const sentinel = @ptrCast(*align(1) const info.child, sentinel_ptr).*;

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
        const s = @ptrCast(*align(1) const ptr_info.child, s_ptr).*;
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
    global_scope_log("poll({d}) readable: {any} ({d})", .{ fd, result, polls[0].revents });
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

pub const JSC = @import("./jsc.zig");
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
        if (@enumToInt(value) <= @enumToInt(SignalCode.SIGSYS)) {
            return std.mem.span(@tagName(value));
        }

        return null;
    }

    pub fn from(value: anytype) SignalCode {
        return @intToEnum(SignalCode, @truncate(u7, std.mem.asBytes(&value)[0]));
    }

    pub fn format(self: SignalCode, comptime _: []const u8, _: fmt.FormatOptions, writer: anytype) !void {
        if (self.name()) |str| {
            try std.fmt.format(writer, "code {d} ({s})", .{ @enumToInt(self), str });
        } else {
            try std.fmt.format(writer, "code {d}", .{@enumToInt(self)});
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
pub const js_parser = @import("./js_parser.zig");
pub const js_printer = @import("./js_printer.zig");
pub const js_lexer = @import("./js_lexer.zig");
pub const JSON = @import("./json_parser.zig");
pub const JSAst = @import("./js_ast.zig");
pub const bit_set = @import("./install/bit_set.zig");

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

/// Write 0's for every byte in Type
/// Ignores default struct values.
pub fn zero(comptime Type: type) Type {
    var out: [@sizeOf(Type)]u8 align(@alignOf(Type)) = undefined;
    @memset(@ptrCast([*]u8, &out), 0, out.len);
    return @bitCast(Type, out);
}
pub const c_ares = @import("./deps/c_ares.zig");
pub const URL = @import("./url.zig").URL;
pub const FormData = @import("./url.zig").FormData;

var needs_proc_self_workaround: bool = false;

// This is our "polyfill" when /proc/self/fd is not available it's only
// necessary on linux because other platforms don't have an optional
// /proc/self/fd
fn getFdPathViaCWD(fd: std.os.fd_t, buf: *[@This().MAX_PATH_BYTES]u8) ![]u8 {
    const prev_fd = try std.os.openatZ(std.os.AT.FDCWD, ".", 0, 0);
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
pub fn getFdPath(fd: std.os.fd_t, buf: *[@This().MAX_PATH_BYTES]u8) ![]u8 {
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
                        const sentinel = @ptrCast(*align(1) const array_info.child, sentinel_ptr).*;
                        if (sentinel == end) {
                            return indexOfSentinel(array_info.child, end, ptr);
                        }
                    }
                    return std.mem.indexOfScalar(array_info.child, ptr, end) orelse array_info.len;
                },
                else => {},
            },
            .Many => if (ptr_info.sentinel) |sentinel_ptr| {
                const sentinel = @ptrCast(*align(1) const ptr_info.child, sentinel_ptr).*;
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
                    const sentinel = @ptrCast(*align(1) const ptr_info.child, sentinel_ptr).*;
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
                            const sentinel = @ptrCast(*align(1) const array_info.child, sentinel_ptr).*;
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
                        const sentinel = @ptrCast(*align(1) const ptr_info.child, sentinel_ptr).*;
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
        const s = @ptrCast(*align(1) const ptr_info.child, s_ptr).*;
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
    return @ptrCast([*:0]const u8, input.ptr)[0..input.len :0];
}

pub const Semver = @import("./install/semver.zig");
