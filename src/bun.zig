/// The functions in this file are used throughout Bun's codebase
//
// Do not import this file directly!
//   To import it:
//      @import("root").bun
//
// Otherwise, you risk a circular dependency or Zig including multiple copies of this file which leads to strange bugs.
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
pub const resolver = @import("./resolver//resolver.zig");
pub const DirIterator = @import("./bun.js/node/dir_iterator.zig");
pub const PackageJSON = @import("./resolver/package_json.zig").PackageJSON;
pub const fmt = @import("./fmt.zig");

pub const shell = struct {
    pub usingnamespace @import("./shell/shell.zig");
};

pub const ShellSubprocess = @import("./shell/subproc.zig").ShellSubprocess;

pub const Output = @import("./output.zig");
pub const Global = @import("./__global.zig");

// make this non-pub after https://github.com/ziglang/zig/issues/18462 is resolved
pub const FileDescriptorInt = if (Environment.isBrowser)
    u0
else if (Environment.isWindows)
    // On windows, this is a bitcast "bun.FDImpl" struct
    // Do not bitcast it to *anyopaque manually, but instead use `fdcast()`
    u64
else
    std.os.fd_t;

pub const FileDescriptor = enum(FileDescriptorInt) {
    zero,
    _,

    pub inline fn int(fd: FileDescriptor) FileDescriptorInt {
        return @intFromEnum(fd);
    }

    pub inline fn writeTo(fd: FileDescriptor, writer: anytype, endian: std.builtin.Endian) !void {
        try writer.writeInt(FileDescriptorInt, fd.int(), endian);
    }

    pub inline fn readFrom(reader: anytype, endian: std.builtin.Endian) !FileDescriptor {
        return @enumFromInt(try reader.readInt(FileDescriptorInt, endian));
    }

    /// converts a `bun.FileDescriptor` into the native operating system fd
    ///
    /// On non-windows this does nothing, but on windows it converts UV descriptors
    /// to Windows' *HANDLE, and casts the types for proper usage.
    ///
    /// This may be needed in places where a FileDescriptor is given to `std` or `kernel32` apis
    pub inline fn cast(fd: FileDescriptor) std.os.fd_t {
        if (!Environment.isWindows) return fd.int();
        // if not having this check, the cast may crash zig compiler?
        if (@inComptime() and fd == invalid_fd) return FDImpl.invalid.system();
        return FDImpl.decode(fd).system();
    }

    pub inline fn asDir(fd: FileDescriptor) std.fs.Dir {
        return std.fs.Dir{ .fd = fd.cast() };
    }

    pub inline fn asFile(fd: FileDescriptor) std.fs.File {
        return std.fs.File{ .handle = fd.cast() };
    }

    pub fn format(fd: FileDescriptor, comptime fmt_: string, options_: std.fmt.FormatOptions, writer: anytype) !void {
        try FDImpl.format(FDImpl.decode(fd), fmt_, options_, writer);
    }

    pub fn assertKind(fd: FileDescriptor, kind: FDImpl.Kind) void {
        std.debug.assert(FDImpl.decode(fd).kind == kind);
    }
};

pub const FDImpl = @import("./fd.zig").FDImpl;

// When we are on a computer with an absurdly high number of max open file handles
// such is often the case with macOS
// As a useful optimization, we can store file descriptors and just keep them open...forever
pub const StoredFileDescriptorType = FileDescriptor;

/// Thin wrapper around iovec / libuv buffer
/// This is used for readv/writev calls.
pub const PlatformIOVec = if (Environment.isWindows)
    windows.libuv.uv_buf_t
else
    std.os.iovec;

pub fn platformIOVecCreate(input: []const u8) PlatformIOVec {
    if (Environment.isWindows) return windows.libuv.uv_buf_t.init(input);
    if (Environment.allow_assert) {
        if (input.len > @as(usize, std.math.maxInt(u32))) {
            Output.debugWarn("call to bun.PlatformIOVec.init with length larger than u32, this will overflow on windows", .{});
        }
    }
    return .{ .iov_len = @intCast(input.len), .iov_base = @constCast(input.ptr) };
}

pub fn platformIOVecToSlice(iovec: PlatformIOVec) []u8 {
    if (Environment.isWindows) return windows.libuv.uv_buf_t.slice(iovec);
    return iovec.base[0..iovec.len];
}

pub const StringTypes = @import("string_types.zig");
pub const stringZ = StringTypes.stringZ;
pub const string = StringTypes.string;
pub const CodePoint = StringTypes.CodePoint;
pub const PathString = StringTypes.PathString;
pub const HashedString = StringTypes.HashedString;
pub const strings = @import("string_immutable.zig");
pub const MutableString = @import("string_mutable.zig").MutableString;
pub const RefCount = @import("./ref_count.zig").RefCount;

pub const MAX_PATH_BYTES: usize = if (Environment.isWasm) 1024 else std.fs.MAX_PATH_BYTES;
pub const PathBuffer = [MAX_PATH_BYTES]u8;
pub const WPathBuffer = [MAX_PATH_BYTES / 2]u16;
pub const OSPathChar = if (Environment.isWindows) u16 else u8;
pub const OSPathSliceZ = [:0]const OSPathChar;
pub const OSPathSlice = []const OSPathChar;
pub const OSPathBuffer = if (Environment.isWindows) WPathBuffer else PathBuffer;

pub inline fn cast(comptime To: type, value: anytype) To {
    if (@typeInfo(@TypeOf(value)) == .Int) {
        return @ptrFromInt(@as(usize, value));
    }

    return @ptrCast(@alignCast(value));
}

extern fn strlen(ptr: [*c]const u8) usize;

pub fn indexOfSentinel(comptime Elem: type, comptime sentinel: Elem, ptr: [*:sentinel]const Elem) usize {
    if (Elem == u8 and sentinel == 0) {
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
        else => @compileError("invalid type given to std.mem.Span: " ++ @typeName(T)),
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
    if (comptime Environment.allow_assert) {
        return Type;
    }

    return void;
}

pub fn DebugOnlyDefault(comptime val: anytype) if (Environment.allow_assert) @TypeOf(val) else void {
    if (comptime Environment.allow_assert) {
        return val;
    }

    return {};
}

pub inline fn range(comptime min: anytype, comptime max: anytype) [max - min]usize {
    return comptime brk: {
        var slice: [max - min]usize = undefined;
        for (min..max) |i| {
            slice[i - min] = i;
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

pub fn clone(item: anytype, allocator: std.mem.Allocator) !@TypeOf(item) {
    const T = @TypeOf(item);

    if (std.meta.hasFn(T, "clone")) {
        return try item.clone(allocator);
    }

    const Child = std.meta.Child(T);
    if (comptime trait.isContainer(Child)) {
        if (std.meta.hasFn(Child, "clone")) {
            const slice = try allocator.alloc(Child, item.len);
            for (slice, 0..) |*val, i| {
                val.* = try item[i].clone(allocator);
            }
            return slice;
        }

        @compileError("Expected clone() to exist for slice child: " ++ @typeName(Child));
    }

    return try allocator.dupe(Child, item);
}

pub const StringBuilder = @import("./string_builder.zig");

pub const LinearFifo = @import("./linear_fifo.zig").LinearFifo;
pub const linux = struct {
    pub const memfd_allocator = @import("./linux_memfd_allocator.zig").LinuxMemFdAllocator;
};

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
        @panic("TODO on Windows");
    }

    var polls = [_]std.os.pollfd{
        .{
            .fd = fd.cast(),
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
        @panic("TODO on Windows");
    }

    var polls = [_]std.os.pollfd{
        .{
            .fd = fd.cast(),
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

/// Do not use this function, call std.debug.panic directly.
///
/// This function used to panic in debug, and be `unreachable` in release
/// however, if something is possibly reachable, it should not be marked unreachable.
/// It now panics in all release modes.
pub inline fn unreachablePanic(comptime fmts: []const u8, args: anytype) noreturn {
    // if (comptime !Environment.allow_assert) unreachable;
    std.debug.panic(fmts, args);
}

pub fn StringEnum(comptime Type: type, comptime Map: anytype, value: []const u8) ?Type {
    return ComptimeStringMap(Type, Map).get(value);
}

pub const Bunfig = @import("./bunfig.zig").Bunfig;

pub const HTTPThread = @import("./http.zig").HTTPThread;
pub const http = @import("./http.zig");

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

/// on unix, this == std.math.maxInt(i32)
/// on windows, this is encode(.{ .system, std.math.maxInt(u63) })
pub const invalid_fd: FileDescriptor = FDImpl.invalid.encode();

pub const simdutf = @import("./bun.js/bindings/bun-simdutf.zig");

pub const JSC = @import("root").JavaScriptCore;
pub const AsyncIO = @import("async_io");

pub const logger = @import("./logger.zig");
pub const ThreadPool = @import("./thread_pool.zig");
pub const default_thread_stack_size = ThreadPool.default_thread_stack_size;
pub const picohttp = @import("./deps/picohttp.zig");
pub const uws = @import("./deps/uws.zig");
pub const BoringSSL = @import("./boringssl.zig");
pub const LOLHTML = @import("./deps/lol-html.zig");
pub const clap = @import("./deps/zig-clap/clap.zig");
pub const analytics = @import("./analytics.zig");
pub const DateTime = @import("./deps/zig-datetime/src/datetime.zig");

pub var start_time: i128 = 0;

pub fn openFileZ(pathZ: [:0]const u8, open_flags: std.fs.File.OpenFlags) !std.fs.File {
    var flags: Mode = 0;
    switch (open_flags.mode) {
        .read_only => flags |= std.os.O.RDONLY,
        .write_only => flags |= std.os.O.WRONLY,
        .read_write => flags |= std.os.O.RDWR,
    }

    const res = try sys.open(pathZ, flags, 0).unwrap();
    return std.fs.File{ .handle = res.cast() };
}

pub fn openFile(path_: []const u8, open_flags: std.fs.File.OpenFlags) !std.fs.File {
    if (comptime Environment.isWindows) {
        var flags: Mode = 0;
        switch (open_flags.mode) {
            .read_only => flags |= std.os.O.RDONLY,
            .write_only => flags |= std.os.O.WRONLY,
            .read_write => flags |= std.os.O.RDWR,
        }

        const fd = try sys.openA(path_, flags, 0).unwrap();
        return fd.asFile();
    }

    return try openFileZ(&try std.os.toPosixPath(path_), open_flags);
}

pub fn openDir(dir: std.fs.Dir, path_: [:0]const u8) !std.fs.Dir {
    if (comptime Environment.isWindows) {
        const res = try sys.openDirAtWindowsA(toFD(dir.fd), path_, true, false).unwrap();
        return res.asDir();
    } else {
        const fd = try sys.openat(toFD(dir.fd), path_, std.os.O.DIRECTORY | std.os.O.CLOEXEC | std.os.O.RDONLY, 0).unwrap();
        return fd.asDir();
    }
}

pub fn openDirA(dir: std.fs.Dir, path_: []const u8) !std.fs.Dir {
    if (comptime Environment.isWindows) {
        const res = try sys.openDirAtWindowsA(toFD(dir.fd), path_, true, false).unwrap();
        return res.asDir();
    } else {
        const fd = try sys.openatA(toFD(dir.fd), path_, std.os.O.DIRECTORY | std.os.O.CLOEXEC | std.os.O.RDONLY, 0).unwrap();
        return fd.asDir();
    }
}

pub fn openDirAbsolute(path_: []const u8) !std.fs.Dir {
    if (comptime Environment.isWindows) {
        const res = try sys.openDirAtWindowsA(invalid_fd, path_, true, false).unwrap();
        return res.asDir();
    } else {
        const fd = try sys.openA(path_, std.os.O.DIRECTORY | std.os.O.CLOEXEC | std.os.O.RDONLY, 0).unwrap();
        return fd.asDir();
    }
}
pub const MimallocArena = @import("./mimalloc_arena.zig").Arena;

/// This wrapper exists to avoid the call to sliceTo(0)
/// Zig's sliceTo(0) is scalar
pub fn getenvZ(path_: [:0]const u8) ?[]const u8 {
    if (comptime !Environment.isNative) {
        return null;
    }

    if (comptime Environment.isWindows) {
        // Windows UCRT will fill this in for us
        for (std.os.environ) |lineZ| {
            const line = sliceTo(lineZ, 0);
            const key_end = strings.indexOfCharUsize(line, '=') orelse line.len;
            const key = line[0..key_end];
            if (strings.eqlLong(key, path_, true)) {
                return line[@min(key_end + 1, line.len)..];
            }
        }

        return null;
    }

    const ptr = std.c.getenv(path_.ptr) orelse return null;
    return sliceTo(ptr, 0);
}

pub const FDHashMapContext = struct {
    pub fn hash(_: @This(), fd: FileDescriptor) u64 {
        // a file descriptor is i32 on linux, u64 on windows
        // the goal here is to do zero work and widen the 32 bit type to 64
        // this should compile error if FileDescriptor somehow is larger than 64 bits.
        comptime std.debug.assert(@bitSizeOf(FileDescriptor) <= 64);
        return @intCast(fd.int());
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
            return fd;
        }

        pub fn eql(_: @This(), a: FileDescriptor, b: FileDescriptor) bool {
            return a == b;
        }
    };
};

pub const U32HashMapContext = struct {
    pub fn hash(_: @This(), value: u32) u64 {
        return @intCast(value);
    }
    pub fn eql(_: @This(), a: u32, b: u32) bool {
        return a == b;
    }
    pub fn pre(input: u32) Prehashed {
        return Prehashed{
            .value = @This().hash(.{}, input),
            .input = input,
        };
    }

    pub const Prehashed = struct {
        value: u64,
        input: u32,
        pub fn hash(this: @This(), value: u32) u64 {
            if (value == this.input) return this.value;
            return @intCast(value);
        }

        pub fn eql(_: @This(), a: u32, b: u32) bool {
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

pub const CaseInsensitiveASCIIStringContext = struct {
    pub fn hash(_: @This(), str_: []const u8) u32 {
        var buf: [1024]u8 = undefined;
        if (str_.len < buf.len) {
            return @truncate(std.hash.Wyhash.hash(0, strings.copyLowercase(str_, &buf)));
        }
        var str = str_;
        var wyhash = std.hash.Wyhash.init(0);
        while (str.len > 0) {
            const length = @min(str.len, buf.len);
            wyhash.update(strings.copyLowercase(str[0..length], &buf));
            str = str[length..];
        }
        return @truncate(wyhash.final());
    }

    pub fn eql(_: @This(), a: []const u8, b: []const u8, _: usize) bool {
        return strings.eqlCaseInsensitiveASCIIICheckLength(a, b);
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
            return CaseInsensitiveASCIIStringContext.hash(.{}, s);
        }

        pub fn eql(_: @This(), a: []const u8, b: []const u8) bool {
            return strings.eqlCaseInsensitiveASCIIICheckLength(a, b);
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
            const out = allocator.alloc(u8, input.len) catch unreachable;
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

pub fn CaseInsensitiveASCIIStringArrayHashMap(comptime Type: type) type {
    return std.ArrayHashMap([]const u8, Type, CaseInsensitiveASCIIStringContext, true);
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

pub fn U32HashMap(comptime Type: type) type {
    return std.HashMap(u32, Type, U32HashMapContext, std.hash_map.default_max_load_percentage);
}

const CopyFile = @import("./copy_file.zig");
pub const copyFileRange = CopyFile.copyFileRange;
pub const canUseCopyFileRangeSyscall = CopyFile.canUseCopyFileRangeSyscall;
pub const disableCopyFileRangeSyscall = CopyFile.disableCopyFileRangeSyscall;
pub const can_use_ioctl_ficlone = CopyFile.can_use_ioctl_ficlone;
pub const disable_ioctl_ficlone = CopyFile.disable_ioctl_ficlone;
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

    pub fn description(signal: SignalCode) ?[]const u8 {
        // Description names copied from fish
        // https://github.com/fish-shell/fish-shell/blob/00ffc397b493f67e28f18640d3de808af29b1434/fish-rust/src/signal.rs#L420
        return switch (signal) {
            .SIGHUP => "Terminal hung up",
            .SIGINT => "Quit request",
            .SIGQUIT => "Quit request",
            .SIGILL => "Illegal instruction",
            .SIGTRAP => "Trace or breakpoint trap",
            .SIGABRT => "Abort",
            .SIGBUS => "Misaligned address error",
            .SIGFPE => "Floating point exception",
            .SIGKILL => "Forced quit",
            .SIGUSR1 => "User defined signal 1",
            .SIGUSR2 => "User defined signal 2",
            .SIGSEGV => "Address boundary error",
            .SIGPIPE => "Broken pipe",
            .SIGALRM => "Timer expired",
            .SIGTERM => "Polite quit request",
            .SIGCHLD => "Child process status changed",
            .SIGCONT => "Continue previously stopped process",
            .SIGSTOP => "Forced stop",
            .SIGTSTP => "Stop request from job control (^Z)",
            .SIGTTIN => "Stop from terminal input",
            .SIGTTOU => "Stop from terminal output",
            .SIGURG => "Urgent socket condition",
            .SIGXCPU => "CPU time limit exceeded",
            .SIGXFSZ => "File size limit exceeded",
            .SIGVTALRM => "Virtual timefr expired",
            .SIGPROF => "Profiling timer expired",
            .SIGWINCH => "Window size change",
            .SIGIO => "I/O on asynchronous file descriptor is possible",
            .SIGSYS => "Bad system call",
            .SIGPWR => "Power failure",
            else => null,
        };
    }

    pub fn from(value: anytype) SignalCode {
        return @enumFromInt(std.mem.asBytes(&value)[0]);
    }

    // This wrapper struct is lame, what if bun's color formatter was more versitile
    const Fmt = struct {
        signal: SignalCode,
        enable_ansi_colors: bool,
        pub fn format(this: Fmt, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
            const signal = this.signal;
            switch (this.enable_ansi_colors) {
                inline else => |enable_ansi_colors| {
                    if (signal.name()) |str| if (signal.description()) |desc| {
                        try writer.print(Output.prettyFmt("{s} <d>({s})<r>", enable_ansi_colors), .{ str, desc });
                        return;
                    };
                    try writer.print("code {d}", .{@intFromEnum(signal)});
                },
            }
        }
    };

    pub fn fmt(signal: SignalCode, enable_ansi_colors: bool) Fmt {
        return .{ .signal = signal, .enable_ansi_colors = enable_ansi_colors };
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

pub const install = @import("./install/install.zig");
pub const PackageManager = install.PackageManager;
pub const RunCommand = @import("./cli/run_command.zig").RunCommand;

pub const fs = @import("./fs.zig");
pub const Bundler = bundler.Bundler;
pub const bundler = @import("./bundler.zig");
pub const which = @import("./which.zig").which;
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
            for (vargs) |field| {
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
        for (std.enums.values(T)) |value| {
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
    const prev_fd = try std.os.openatZ(std.fs.cwd().fd, ".", std.os.O.DIRECTORY, 0);
    var needs_chdir = false;
    defer {
        if (needs_chdir) std.os.fchdir(prev_fd) catch unreachable;
        std.os.close(prev_fd);
    }
    try std.os.fchdir(fd);
    needs_chdir = true;
    return std.os.getcwd(buf);
}

pub const getcwd = std.os.getcwd;

pub fn getcwdAlloc(allocator: std.mem.Allocator) ![]u8 {
    var temp: [MAX_PATH_BYTES]u8 = undefined;
    const temp_slice = try getcwd(&temp);
    return allocator.dupe(u8, temp_slice);
}

/// Get the absolute path to a file descriptor.
/// On Linux, when `/proc/self/fd` is not available, this function will attempt to use `fchdir` and `getcwd` to get the path instead.
pub fn getFdPath(fd_: anytype, buf: *[@This().MAX_PATH_BYTES]u8) ![]u8 {
    const fd = toFD(fd_).cast();

    if (comptime Environment.isWindows) {
        var wide_buf: WPathBuffer = undefined;
        const wide_slice = try std.os.windows.GetFinalPathNameByHandle(fd, .{}, wide_buf[0..]);
        const res = strings.copyUTF16IntoUTF8(buf[0..], @TypeOf(wide_slice), wide_slice, true);
        return buf[0..res.written];
    }

    if (comptime Environment.allow_assert) {
        // We need a way to test that the workaround is working
        // but we don't want to do this check in a release build
        const ProcSelfWorkAroundForDebugging = struct {
            pub var has_checked = false;
        };

        if (!ProcSelfWorkAroundForDebugging.has_checked) {
            ProcSelfWorkAroundForDebugging.has_checked = true;
            needs_proc_self_workaround = strings.eql(getenvZ("BUN_NEEDS_PROC_SELF_WORKAROUND") orelse "0", "1");
        }
    } else if (comptime !Environment.isLinux) {
        return try std.os.getFdPath(fd, buf);
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

pub fn getFdPathW(fd_: anytype, buf: *WPathBuffer) ![]u16 {
    const fd = toFD(fd_).cast();

    if (comptime Environment.isWindows) {
        const wide_slice = try std.os.windows.GetFinalPathNameByHandle(fd, .{}, buf);
        return wide_slice;
    }

    @panic("TODO unsupported platform for getFdPathW");
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

        else => buffer, // attempt to coerce to []const u8
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
    const PosixSpawn = posix.spawn;
    const bun = @This();
    const dupe_argv = allocator.allocSentinel(?[*:0]const u8, bun.argv().len, null) catch unreachable;
    for (bun.argv(), dupe_argv) |src, *dest| {
        dest.* = (allocator.dupeZ(u8, src) catch unreachable).ptr;
    }

    const environ_slice = std.mem.span(std.c.environ);
    const environ = allocator.allocSentinel(?[*:0]const u8, environ_slice.len, null) catch unreachable;
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
    const newargv = @as([*:null]?[*:0]const u8, @ptrCast(dupe_argv.ptr));

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
        actions.inherit(posix.STDIN_FD) catch unreachable;
        actions.inherit(posix.STDOUT_FD) catch unreachable;
        actions.inherit(posix.STDERR_FD) catch unreachable;
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
        switch (PosixSpawn.spawnZ(exec_path, actions, attrs, @as([*:null]?[*:0]const u8, @ptrCast(newargv)), @as([*:null]?[*:0]const u8, @ptrCast(envp)))) {
            .err => |err| {
                Output.panic("Unexpected error while reloading: {d} {s}", .{ err.errno, @tagName(err.getErrno()) });
            },
            .result => |_| {},
        }
    } else {
        const err = std.os.execveZ(
            exec_path,
            newargv,
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
        const entry = try self.map.getOrPut(key);
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
        const entry = try self.map.getOrPut(key);
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
pub const StandaloneModuleGraph = @import("./StandaloneModuleGraph.zig").StandaloneModuleGraph;

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

/// Converts a native file descriptor into a `bun.FileDescriptor`
///
/// Accepts either a UV descriptor (i32) or a windows handle (*anyopaque)
pub inline fn toFD(fd: anytype) FileDescriptor {
    const T = @TypeOf(fd);
    if (Environment.isWindows) {
        return (switch (T) {
            FDImpl => fd,
            FDImpl.System => FDImpl.fromSystem(fd),
            FDImpl.UV, i32, comptime_int => FDImpl.fromUV(fd),
            FileDescriptor => FDImpl.decode(fd),
            // TODO: remove u32
            u32 => FDImpl.fromUV(@intCast(fd)),
            else => @compileError("toFD() does not support type \"" ++ @typeName(T) ++ "\""),
        }).encode();
    } else {
        // TODO: remove intCast. we should not be casting u32 -> i32
        // even though file descriptors are always positive, linux/mac repesents them as signed integers
        return switch (T) {
            FileDescriptor => fd, // TODO: remove the toFD call from these places and make this a @compileError
            c_int, i32, u32, comptime_int => @enumFromInt(fd),
            usize, i64 => @enumFromInt(@as(i32, @intCast(fd))),
            else => @compileError("bun.toFD() not implemented for: " ++ @typeName(T)),
        };
    }
}

/// Converts a native file descriptor into a `bun.FileDescriptor`
///
/// Accepts either a UV descriptor (i32) or a windows handle (*anyopaque)
///
/// On windows, this file descriptor will always be backed by libuv, so calling .close() is safe.
pub inline fn toLibUVOwnedFD(fd: anytype) FileDescriptor {
    const T = @TypeOf(fd);
    if (Environment.isWindows) {
        return (switch (T) {
            FDImpl.System => FDImpl.fromSystem(fd).makeLibUVOwned(),
            FDImpl.UV => FDImpl.fromUV(fd),
            FileDescriptor => FDImpl.decode(fd).makeLibUVOwned(),
            FDImpl => fd.makeLibUVOwned(),
            else => @compileError("toLibUVOwnedFD() does not support type \"" ++ @typeName(T) ++ "\""),
        }).encode();
    } else {
        return toFD(fd);
    }
}

/// Converts FileDescriptor into a UV file descriptor.
///
/// This explicitly is setup to disallow converting a Windows descriptor into a UV
/// descriptor. If this was allowed, then it would imply the caller still owns the
/// windows handle, but Win->UV will always invalidate the handle.
///
/// In that situation, it is almost impossible to close the handle properly,
/// you want to use `bun.FDImpl.decode(fd)` or `bun.toLibUVOwnedFD` instead.
///
/// This way, you can call .close() on the libuv descriptor.
pub inline fn uvfdcast(fd: anytype) FDImpl.UV {
    const T = @TypeOf(fd);
    if (Environment.isWindows) {
        const decoded = (switch (T) {
            FDImpl.System => @compileError("This cast (FDImpl.System -> FDImpl.UV) makes this file descriptor very hard to close. Use toLibUVOwnedFD() and FileDescriptor instead. If you truly need to do this conversion (dave will probably reject your PR), use bun.FDImpl.fromSystem(fd).uv()"),
            FDImpl => fd,
            FDImpl.UV => return fd,
            FileDescriptor => FDImpl.decode(fd),
            else => @compileError("uvfdcast() does not support type \"" ++ @typeName(T) ++ "\""),
        });
        if (Environment.allow_assert) {
            if (decoded.kind != .uv) {
                std.debug.panic("uvfdcast({}) called on an windows handle", .{decoded});
            }
        }
        return decoded.uv();
    } else {
        return fd.cast();
    }
}

pub inline fn socketcast(fd: anytype) std.os.socket_t {
    if (Environment.isWindows) {
        return @ptrCast(FDImpl.decode(fd).system());
    } else {
        return fd.cast();
    }
}

pub const HOST_NAME_MAX = if (Environment.isWindows)
    // On Windows the maximum length, in bytes, of the string returned in the buffer pointed to by the name parameter is dependent on the namespace provider, but this string must be 256 bytes or less.
    // So if a buffer of 256 bytes is passed in the name parameter and the namelen parameter is set to 256, the buffer size will always be adequate.
    // https://learn.microsoft.com/en-us/windows/win32/api/winsock/nf-winsock-gethostname
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

    pub fn birthtime(_: *const WindowsStat) std.c.timespec {
        return std.c.timespec{ .tv_nsec = 0, .tv_sec = 0 };
    }

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

pub const Stat = if (Environment.isWindows) windows.libuv.uv_stat_t else std.os.Stat;

var _argv: [][:0]u8 = &[_][:0]u8{};

pub inline fn argv() [][:0]u8 {
    return _argv;
}

pub fn initArgv(allocator: std.mem.Allocator) !void {
    _argv = try std.process.argsAlloc(allocator);
}

pub const posix = struct {
    pub const STDIN_FD = toFD(0);
    pub const STDOUT_FD = toFD(1);
    pub const STDERR_FD = toFD(2);

    pub fn stdio(i: anytype) FileDescriptor {
        return switch (i) {
            1 => STDOUT_FD,
            2 => STDERR_FD,
            0 => STDIN_FD,
            else => @panic("Invalid stdio fd"),
        };
    }

    pub const spawn = @import("./bun.js/api/bun/spawn.zig").PosixSpawn;
};

pub const win32 = struct {
    pub var STDOUT_FD: FileDescriptor = undefined;
    pub var STDERR_FD: FileDescriptor = undefined;
    pub var STDIN_FD: FileDescriptor = undefined;

    pub fn stdio(i: anytype) FileDescriptor {
        return switch (i) {
            0 => STDIN_FD,
            1 => STDOUT_FD,
            2 => STDERR_FD,
            else => @panic("Invalid stdio fd"),
        };
    }
};

pub usingnamespace if (@import("builtin").target.os.tag != .windows) posix else win32;

pub fn isRegularFile(mode: anytype) bool {
    return S.ISREG(@intCast(mode));
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

pub const LazyBoolValue = enum {
    unknown,
    no,
    yes,
};
/// Create a lazily computed boolean value.
/// Getter must be a function that takes a pointer to the parent struct and returns a boolean.
/// Parent must be a type which contains the field we are getting.
pub fn LazyBool(comptime Getter: anytype, comptime Parent: type, comptime field: string) type {
    return struct {
        value: LazyBoolValue = .unknown,
        pub fn get(self: *@This()) bool {
            if (self.value == .unknown) {
                self.value = switch (Getter(@fieldParentPtr(Parent, field, self))) {
                    true => .yes,
                    false => .no,
                };
            }

            return self.value == .yes;
        }
    };
}

pub fn serializable(input: anytype) @TypeOf(input) {
    const T = @TypeOf(input);
    comptime {
        if (trait.isExternContainer(T)) {
            if (@typeInfo(T) == .Union) {
                @compileError("Extern unions must be serialized with serializableInto");
            }
        }
    }
    var zeroed: [@sizeOf(T)]u8 align(@alignOf(T)) = std.mem.zeroes([@sizeOf(T)]u8);
    const result: *T = @ptrCast(&zeroed);

    inline for (comptime std.meta.fieldNames(T)) |field_name| {
        @field(result, field_name) = @field(input, field_name);
    }

    return result.*;
}

pub inline fn serializableInto(comptime T: type, init: anytype) T {
    var zeroed: [@sizeOf(T)]u8 align(@alignOf(T)) = std.mem.zeroes([@sizeOf(T)]u8);
    const result: *T = @ptrCast(&zeroed);

    inline for (comptime std.meta.fieldNames(@TypeOf(init))) |field_name| {
        @field(result, field_name) = @field(init, field_name);
    }

    return result.*;
}

/// Like std.fs.Dir.makePath except instead of infinite looping on dangling
/// symlink, it deletes the symlink and tries again.
pub fn makePath(dir: std.fs.Dir, sub_path: []const u8) !void {
    var it = try std.fs.path.componentIterator(sub_path);
    var component = it.last() orelse return;
    while (true) {
        dir.makeDir(component.path) catch |err| switch (err) {
            error.PathAlreadyExists => {
                var path_buf2: [MAX_PATH_BYTES * 2]u8 = undefined;
                copy(u8, &path_buf2, component.path);

                path_buf2[component.path.len] = 0;
                const path_to_use = path_buf2[0..component.path.len :0];
                const result = try sys.lstat(path_to_use).unwrap();
                const is_dir = S.ISDIR(@intCast(result.mode));
                // dangling symlink
                if (!is_dir) {
                    dir.deleteTree(component.path) catch {};
                    continue;
                }
            },
            error.FileNotFound => |e| {
                component = it.previous() orelse return e;
                continue;
            },
            else => |e| return e,
        };
        component = it.next() orelse return;
    }
}

pub const Async = @import("async");

/// This is a helper for writing path string literals that are compatible with Windows.
/// Returns the string as-is on linux, on windows replace `/` with `\`
pub inline fn pathLiteral(comptime literal: anytype) *const [literal.len:0]u8 {
    if (!Environment.isWindows) return @ptrCast(literal);
    return comptime {
        var buf: [literal.len:0]u8 = undefined;
        for (literal, 0..) |c, i| {
            buf[i] = if (c == '/') '\\' else c;
        }
        buf[buf.len] = 0;
        return &buf;
    };
}

/// Same as `pathLiteral`, but the character type is chosen from platform.
pub inline fn OSPathLiteral(comptime literal: anytype) *const [literal.len:0]OSPathChar {
    if (!Environment.isWindows) return @ptrCast(literal);
    return comptime {
        var buf: [literal.len:0]OSPathChar = undefined;
        for (literal, 0..) |c, i| {
            buf[i] = if (c == '/') '\\' else c;
        }
        buf[buf.len] = 0;
        return &buf;
    };
}

const builtin = @import("builtin");

pub const MakePath = struct {
    /// copy/paste of `std.fs.Dir.makePath` and related functions and modified to support u16 slices.
    /// inside `MakePath` scope to make deleting later easier.
    /// TODO(dylan-conway) delete `MakePath`
    pub fn makePath(comptime T: type, self: std.fs.Dir, sub_path: []const T) !void {
        var it = try componentIterator(T, sub_path);
        var component = it.last() orelse return;
        while (true) {
            (if (T == u16) makeDirW else std.fs.Dir.makeDir)(self, component.path) catch |err| switch (err) {
                error.PathAlreadyExists => {
                    // TODO stat the file and return an error if it's not a directory
                    // this is important because otherwise a dangling symlink
                    // could cause an infinite loop
                },
                error.FileNotFound => |e| {
                    component = it.previous() orelse return e;
                    continue;
                },
                else => |e| return e,
            };
            component = it.next() orelse return;
        }
    }

    fn makeDirW(self: std.fs.Dir, sub_path: []const u16) !void {
        try std.os.mkdiratW(self.fd, sub_path, 0o755);
    }

    fn componentIterator(comptime T: type, path_: []const T) !std.fs.path.ComponentIterator(switch (builtin.target.os.tag) {
        .windows => .windows,
        .uefi => .uefi,
        else => .posix,
    }, T) {
        return std.fs.path.ComponentIterator(switch (builtin.target.os.tag) {
            .windows => .windows,
            .uefi => .uefi,
            else => .posix,
        }, T).init(path_);
    }
};

pub const Dirname = struct {
    /// copy/paste of `std.fs.path.dirname` and related functions and modified to support u16 slices.
    /// inside `Dirname` scope to make deleting later easier.
    /// TODO(dylan-conway) delete `Dirname`
    pub fn dirname(comptime T: type, path_: []const T) ?[]const T {
        if (builtin.target.os.tag == .windows) {
            return dirnameWindows(T, path_);
        } else {
            return std.fs.path.dirnamePosix(path_);
        }
    }

    fn dirnameWindows(comptime T: type, path_: []const T) ?[]const T {
        if (path_.len == 0)
            return null;

        const root_slice = diskDesignatorWindows(T, path_);
        if (path_.len == root_slice.len)
            return null;

        const have_root_slash = path_.len > root_slice.len and (path_[root_slice.len] == '/' or path_[root_slice.len] == '\\');

        var end_index: usize = path_.len - 1;

        while (path_[end_index] == '/' or path_[end_index] == '\\') {
            if (end_index == 0)
                return null;
            end_index -= 1;
        }

        while (path_[end_index] != '/' and path_[end_index] != '\\') {
            if (end_index == 0)
                return null;
            end_index -= 1;
        }

        if (have_root_slash and end_index == root_slice.len) {
            end_index += 1;
        }

        if (end_index == 0)
            return null;

        return path_[0..end_index];
    }

    fn diskDesignatorWindows(comptime T: type, path_: []const T) []const T {
        return windowsParsePath(T, path_).disk_designator;
    }

    fn windowsParsePath(comptime T: type, path_: []const T) WindowsPath(T) {
        const WindowsPath_ = WindowsPath(T);
        if (path_.len >= 2 and path_[1] == ':') {
            return WindowsPath_{
                .is_abs = if (comptime T == u16) std.fs.path.isAbsoluteWindowsWTF16(path_) else std.fs.path.isAbsolute(path_),
                .kind = WindowsPath_.Kind.Drive,
                .disk_designator = path_[0..2],
            };
        }
        if (path_.len >= 1 and (path_[0] == '/' or path_[0] == '\\') and
            (path_.len == 1 or (path_[1] != '/' and path_[1] != '\\')))
        {
            return WindowsPath_{
                .is_abs = true,
                .kind = WindowsPath_.Kind.None,
                .disk_designator = path_[0..0],
            };
        }
        const relative_path = WindowsPath_{
            .kind = WindowsPath_.Kind.None,
            .disk_designator = &[_]T{},
            .is_abs = false,
        };
        if (path_.len < "//a/b".len) {
            return relative_path;
        }

        inline for ("/\\") |this_sep| {
            const two_sep = [_]T{ this_sep, this_sep };
            if (std.mem.startsWith(T, path_, &two_sep)) {
                if (path_[2] == this_sep) {
                    return relative_path;
                }

                var it = std.mem.tokenizeScalar(T, path_, this_sep);
                _ = (it.next() orelse return relative_path);
                _ = (it.next() orelse return relative_path);
                return WindowsPath_{
                    .is_abs = if (T == u16) std.fs.path.isAbsoluteWindowsWTF16(path_) else std.fs.path.isAbsolute(path_),
                    .kind = WindowsPath_.Kind.NetworkShare,
                    .disk_designator = path_[0..it.index],
                };
            }
        }
        return relative_path;
    }

    fn WindowsPath(comptime T: type) type {
        return struct {
            is_abs: bool,
            kind: Kind,
            disk_designator: []const T,

            pub const Kind = enum {
                None,
                Drive,
                NetworkShare,
            };
        };
    }
};

pub noinline fn outOfMemory() noreturn {
    @setCold(true);

    // TODO: In the future, we should print jsc + mimalloc heap statistics
    @panic("Bun ran out of memory!");
}

pub const is_heap_breakdown_enabled = Environment.allow_assert and Environment.isMac;

pub const HeapBreakdown = if (is_heap_breakdown_enabled) @import("./heap_breakdown.zig") else struct {};

/// Globally-allocate a value on the heap.
///
/// When used, yuo must call `bun.destroy` to free the memory.
/// default_allocator.destroy should not be used.
///
/// On macOS, you can use `Bun.DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump()`
/// to dump the heap.
pub inline fn new(comptime T: type, t: T) *T {
    if (comptime is_heap_breakdown_enabled) {
        const ptr = HeapBreakdown.allocator(T).create(T) catch outOfMemory();
        ptr.* = t;
        return ptr;
    }

    const ptr = default_allocator.create(T) catch outOfMemory();
    ptr.* = t;
    return ptr;
}

/// Free a globally-allocated a value
///
/// On macOS, you can use `Bun.DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump()`
/// to dump the heap.
pub inline fn destroyWithAlloc(allocator: std.mem.Allocator, t: anytype) void {
    if (comptime is_heap_breakdown_enabled) {
        if (allocator.vtable == default_allocator.vtable) {
            destroy(t);
            return;
        }
    }

    allocator.destroy(t);
}

pub fn New(comptime T: type) type {
    return struct {
        const allocation_logger = Output.scoped(.alloc, @hasDecl(T, "logAllocations"));

        pub inline fn destroy(self: *T) void {
            if (comptime Environment.allow_assert) {
                allocation_logger("destroy({*})", .{self});
            }

            if (comptime is_heap_breakdown_enabled) {
                HeapBreakdown.allocator(T).destroy(self);
            } else {
                default_allocator.destroy(self);
            }
        }

        pub inline fn new(t: T) *T {
            if (comptime is_heap_breakdown_enabled) {
                const ptr = HeapBreakdown.allocator(T).create(T) catch outOfMemory();
                ptr.* = t;
                if (comptime Environment.allow_assert) {
                    allocation_logger("new() = {*}", .{ptr});
                }
                return ptr;
            }

            const ptr = default_allocator.create(T) catch outOfMemory();
            ptr.* = t;

            if (comptime Environment.allow_assert) {
                allocation_logger("new() = {*}", .{ptr});
            }
            return ptr;
        }
    };
}

/// Reference-counted heap-allocated instance value.
///
/// `ref_count` is expected to be defined on `T` with a default value set to `1`
pub fn NewRefCounted(comptime T: type, comptime deinit_fn: ?fn (self: *T) void) type {
    if (!@hasField(T, "ref_count")) {
        @compileError("Expected a field named \"ref_count\" with a default value of 1 on " ++ @typeName(T));
    }

    for (std.meta.fields(T)) |field| {
        if (strings.eqlComptime(field.name, "ref_count")) {
            if (field.default_value == null) {
                @compileError("Expected a field named \"ref_count\" with a default value of 1 on " ++ @typeName(T));
            }
        }
    }

    return struct {
        const allocation_logger = Output.scoped(.alloc, @hasDecl(T, "logAllocations"));

        pub fn destroy(self: *T) void {
            if (comptime Environment.allow_assert) {
                std.debug.assert(self.ref_count == 0);
                allocation_logger("destroy() = {*}", .{self});
            }

            if (comptime is_heap_breakdown_enabled) {
                HeapBreakdown.allocator(T).destroy(self);
            } else {
                default_allocator.destroy(self);
            }
        }

        pub fn ref(self: *T) void {
            self.ref_count += 1;
        }

        pub fn deref(self: *T) void {
            self.ref_count -= 1;

            if (self.ref_count == 0) {
                if (comptime deinit_fn) |deinit| {
                    deinit(self);
                } else {
                    self.destroy();
                }
            }
        }

        pub inline fn new(t: T) *T {
            if (comptime is_heap_breakdown_enabled) {
                const ptr = HeapBreakdown.allocator(T).create(T) catch outOfMemory();
                ptr.* = t;

                if (comptime Environment.allow_assert) {
                    std.debug.assert(ptr.ref_count == 1);
                    allocation_logger("new() = {*}", .{ptr});
                }

                return ptr;
            }

            const ptr = default_allocator.create(T) catch outOfMemory();
            ptr.* = t;

            if (comptime Environment.allow_assert) {
                std.debug.assert(ptr.ref_count == 1);
                allocation_logger("new() = {*}", .{ptr});
            }

            return ptr;
        }
    };
}

/// Free a globally-allocated a value.
///
/// Must have used `new` to allocate the value.
///
/// On macOS, you can use `Bun.DO_NOT_USE_OR_YOU_WILL_BE_FIRED_mimalloc_dump()`
/// to dump the heap.
pub inline fn destroy(t: anytype) void {
    if (comptime is_heap_breakdown_enabled) {
        HeapBreakdown.allocator(std.meta.Child(@TypeOf(t))).destroy(t);
    } else {
        default_allocator.destroy(t);
    }
}

pub inline fn newWithAlloc(allocator: std.mem.Allocator, comptime T: type, t: T) *T {
    if (comptime is_heap_breakdown_enabled) {
        if (allocator.vtable == default_allocator.vtable) {
            return new(T, t);
        }
    }

    const ptr = allocator.create(T) catch outOfMemory();
    ptr.* = t;
    return ptr;
}

pub fn exitThread() noreturn {
    const exiter = struct {
        pub extern "C" fn pthread_exit(?*anyopaque) noreturn;
        pub extern "kernel32" fn ExitThread(windows.DWORD) noreturn;
    };

    if (comptime Environment.isWindows) {
        exiter.ExitThread(0);
    } else if (comptime Environment.isPosix) {
        exiter.pthread_exit(null);
    } else {
        @compileError("Unsupported platform");
    }
}

pub const Tmpfile = @import("./tmp.zig").Tmpfile;

pub const io = @import("./io/io.zig");

const errno_map = errno_map: {
    var max_value = 0;
    for (std.enums.values(C.SystemErrno)) |v|
        max_value = @max(max_value, @intFromEnum(v));

    var map: [max_value + 1]anyerror = undefined;
    @memset(&map, error.Unexpected);
    for (std.enums.values(C.SystemErrno)) |v|
        map[@intFromEnum(v)] = @field(anyerror, @tagName(v));

    break :errno_map map;
};

pub fn errnoToZigErr(err: anytype) anyerror {
    var num = if (@typeInfo(@TypeOf(err)) == .Enum)
        @intFromEnum(err)
    else
        err;

    if (Environment.allow_assert) {
        std.debug.assert(num != 0);
    }

    if (Environment.os == .windows) {
        // uv errors are negative, normalizing it will make this more resilient
        num = @abs(num);
    } else {
        if (Environment.allow_assert) {
            std.debug.assert(num > 0);
        }
    }

    if (num > 0 and num < errno_map.len)
        return errno_map[num];

    return error.Unexpected;
}

pub const S = if (Environment.isWindows) C.S else std.os.S;

/// Deprecated!
pub const trait = @import("./trait.zig");

pub const brotli = @import("./brotli.zig");

pub fn iterateDir(dir: std.fs.Dir) DirIterator.Iterator {
    return DirIterator.iterate(dir, .u8).iter;
}

fn ReinterpretSliceType(comptime T: type, comptime slice: type) type {
    const is_const = @typeInfo(slice).Pointer.is_const;
    return if (is_const) []const T else []T;
}

/// Zig has a todo for @ptrCast changing the `.len`. This is the workaround
pub fn reinterpretSlice(comptime T: type, slice: anytype) ReinterpretSliceType(T, @TypeOf(slice)) {
    const is_const = @typeInfo(@TypeOf(slice)).Pointer.is_const;
    const bytes = std.mem.sliceAsBytes(slice);
    const new_ptr = @as(if (is_const) [*]const T else [*]T, @ptrCast(@alignCast(bytes.ptr)));
    return new_ptr[0..@divTrunc(bytes.len, @sizeOf(T))];
}

extern "kernel32" fn GetUserNameA(username: *u8, size: *u32) callconv(std.os.windows.WINAPI) c_int;

pub fn getUserName(output_buffer: []u8) ?[]const u8 {
    if (Environment.isWindows) {
        var size: u32 = @intCast(output_buffer.len);
        if (GetUserNameA(@ptrCast(@constCast(output_buffer.ptr)), &size) == 0) {
            return null;
        }
        return output_buffer[0..size];
    }
    var env = std.process.getEnvMap(default_allocator) catch outOfMemory();
    const user = env.get("USER") orelse return null;
    const size = @min(output_buffer.len, user.len);
    copy(u8, output_buffer[0..size], user[0..size]);
    return output_buffer[0..size];
}

/// This struct is a workaround a Windows terminal bug.
/// TODO: when https://github.com/microsoft/terminal/issues/16606 is resolved, revert this commit.
pub var buffered_stdin = std.io.BufferedReader(4096, std.fs.File.Reader){
    .unbuffered_reader = std.fs.File.Reader{ .context = .{ .handle = if (Environment.isWindows) undefined else 0 } },
};
