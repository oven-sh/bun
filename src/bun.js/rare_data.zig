const EditorContext = @import("../open.zig").EditorContext;
const Blob = JSC.WebCore.Blob;
const default_allocator = bun.default_allocator;
const Output = bun.Output;
const RareData = @This();
const Syscall = bun.sys;
const JSC = bun.JSC;
const std = @import("std");
const BoringSSL = bun.BoringSSL;
const bun = @import("root").bun;
const FDImpl = bun.FDImpl;
const Environment = bun.Environment;
const WebSocketClientMask = @import("../http/websocket_http_client.zig").Mask;
const UUID = @import("./uuid.zig");
const Async = bun.Async;
const StatWatcherScheduler = @import("./node/node_fs_stat_watcher.zig").StatWatcherScheduler;
const IPC = @import("./ipc.zig");
const uws = bun.uws;

boring_ssl_engine: ?*BoringSSL.ENGINE = null,
editor_context: EditorContext = EditorContext{},
stderr_store: ?*Blob.Store = null,
stdin_store: ?*Blob.Store = null,
stdout_store: ?*Blob.Store = null,

postgresql_context: JSC.Postgres.PostgresSQLContext = .{},

entropy_cache: ?*EntropyCache = null,

hot_map: ?HotMap = null,

// TODO: make this per JSGlobalObject instead of global
// This does not handle ShadowRealm correctly!
tail_cleanup_hook: ?*CleanupHook = null,
cleanup_hook: ?*CleanupHook = null,

file_polls_: ?*Async.FilePoll.Store = null,

global_dns_data: ?*JSC.DNS.GlobalData = null,

spawn_ipc_usockets_context: ?*uws.SocketContext = null,

mime_types: ?bun.http.MimeType.Map = null,

node_fs_stat_watcher_scheduler: ?*StatWatcherScheduler = null,

listening_sockets_for_watch_mode: std.ArrayListUnmanaged(bun.FileDescriptor) = .{},
listening_sockets_for_watch_mode_lock: bun.Lock = bun.Lock.init(),

temp_pipe_read_buffer: ?*PipeReadBuffer = null,

const PipeReadBuffer = [256 * 1024]u8;

pub fn pipeReadBuffer(this: *RareData) *PipeReadBuffer {
    return this.temp_pipe_read_buffer orelse {
        this.temp_pipe_read_buffer = default_allocator.create(PipeReadBuffer) catch bun.outOfMemory();
        return this.temp_pipe_read_buffer.?;
    };
}

pub fn addListeningSocketForWatchMode(this: *RareData, socket: bun.FileDescriptor) void {
    this.listening_sockets_for_watch_mode_lock.lock();
    defer this.listening_sockets_for_watch_mode_lock.unlock();
    this.listening_sockets_for_watch_mode.append(bun.default_allocator, socket) catch {};
}

pub fn removeListeningSocketForWatchMode(this: *RareData, socket: bun.FileDescriptor) void {
    this.listening_sockets_for_watch_mode_lock.lock();
    defer this.listening_sockets_for_watch_mode_lock.unlock();
    if (std.mem.indexOfScalar(bun.FileDescriptor, this.listening_sockets_for_watch_mode.items, socket)) |i| {
        _ = this.listening_sockets_for_watch_mode.swapRemove(i);
    }
}

pub fn closeAllListenSocketsForWatchMode(this: *RareData) void {
    this.listening_sockets_for_watch_mode_lock.lock();
    defer this.listening_sockets_for_watch_mode_lock.unlock();
    for (this.listening_sockets_for_watch_mode.items) |socket| {
        // Prevent TIME_WAIT state
        Syscall.disableLinger(socket);
        _ = Syscall.close(socket);
    }
    this.listening_sockets_for_watch_mode = .{};
}

pub fn hotMap(this: *RareData, allocator: std.mem.Allocator) *HotMap {
    if (this.hot_map == null) {
        this.hot_map = HotMap.init(allocator);
    }

    return &this.hot_map.?;
}

pub fn mimeTypeFromString(this: *RareData, allocator: std.mem.Allocator, str: []const u8) ?bun.http.MimeType {
    if (this.mime_types == null) {
        this.mime_types = bun.http.MimeType.createHashTable(
            allocator,
        ) catch bun.outOfMemory();
    }

    return this.mime_types.?.get(str);
}

pub const HotMap = struct {
    _map: bun.StringArrayHashMap(Entry),

    const HTTPServer = JSC.API.HTTPServer;
    const HTTPSServer = JSC.API.HTTPSServer;
    const DebugHTTPServer = JSC.API.DebugHTTPServer;
    const DebugHTTPSServer = JSC.API.DebugHTTPSServer;
    const TCPSocket = JSC.API.TCPSocket;
    const TLSSocket = JSC.API.TLSSocket;
    const Listener = JSC.API.Listener;
    const Entry = bun.TaggedPointerUnion(.{
        HTTPServer,
        HTTPSServer,
        DebugHTTPServer,
        DebugHTTPSServer,
        TCPSocket,
        TLSSocket,
        Listener,
    });

    pub fn init(allocator: std.mem.Allocator) HotMap {
        return .{
            ._map = bun.StringArrayHashMap(Entry).init(allocator),
        };
    }

    pub fn get(this: *HotMap, key: []const u8, comptime Type: type) ?*Type {
        var entry = this._map.get(key) orelse return null;
        return entry.get(Type);
    }

    pub fn getEntry(this: *HotMap, key: []const u8) ?Entry {
        return this._map.get(key) orelse return null;
    }

    pub fn insert(this: *HotMap, key: []const u8, ptr: anytype) void {
        const entry = this._map.getOrPut(key) catch bun.outOfMemory();
        if (entry.found_existing) {
            @panic("HotMap already contains key");
        }

        entry.key_ptr.* = this._map.allocator.dupe(u8, key) catch bun.outOfMemory();
        entry.value_ptr.* = Entry.init(ptr);
    }

    pub fn remove(this: *HotMap, key: []const u8) void {
        const entry = this._map.getEntry(key) orelse return;
        bun.default_allocator.free(entry.key_ptr.*);
        _ = this._map.orderedRemove(key);
    }
};

pub fn filePolls(this: *RareData, vm: *JSC.VirtualMachine) *Async.FilePoll.Store {
    return this.file_polls_ orelse {
        this.file_polls_ = vm.allocator.create(Async.FilePoll.Store) catch unreachable;
        this.file_polls_.?.* = Async.FilePoll.Store.init(vm.allocator);
        return this.file_polls_.?;
    };
}

pub fn nextUUID(this: *RareData) UUID {
    if (this.entropy_cache == null) {
        this.entropy_cache = default_allocator.create(EntropyCache) catch unreachable;
        this.entropy_cache.?.init();
    }

    const bytes = this.entropy_cache.?.get();
    return UUID.initWith(&bytes);
}

pub fn entropySlice(this: *RareData, len: usize) []u8 {
    if (this.entropy_cache == null) {
        this.entropy_cache = default_allocator.create(EntropyCache) catch unreachable;
        this.entropy_cache.?.init();
    }

    return this.entropy_cache.?.slice(len);
}

pub const EntropyCache = struct {
    pub const buffered_uuids_count = 16;
    pub const size = buffered_uuids_count * 128;

    cache: [size]u8 = undefined,
    index: usize = 0,

    pub fn init(instance: *EntropyCache) void {
        instance.fill();
    }

    pub fn fill(this: *EntropyCache) void {
        bun.rand(&this.cache);
        this.index = 0;
    }

    pub fn slice(this: *EntropyCache, len: usize) []u8 {
        if (len > this.cache.len) {
            return &[_]u8{};
        }

        if (this.index + len > this.cache.len) {
            this.fill();
        }
        const result = this.cache[this.index..][0..len];
        this.index += len;
        return result;
    }

    pub fn get(this: *EntropyCache) [16]u8 {
        if (this.index + 16 > this.cache.len) {
            this.fill();
        }
        const result = this.cache[this.index..][0..16].*;
        this.index += 16;
        return result;
    }
};

pub const CleanupHook = struct {
    next: ?*CleanupHook = null,
    ctx: ?*anyopaque,
    func: Function,
    globalThis: *JSC.JSGlobalObject,

    pub fn eql(self: CleanupHook, other: CleanupHook) bool {
        return self.ctx == other.ctx and self.func == other.func and self.globalThis == other.globalThis;
    }

    pub fn execute(self: CleanupHook) void {
        self.func(self.ctx);
    }

    pub fn from(
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        func: CleanupHook.Function,
    ) CleanupHook {
        return .{
            .next = null,
            .ctx = ctx,
            .func = func,
            .globalThis = globalThis,
        };
    }

    pub const Function = *const fn (?*anyopaque) callconv(.C) void;
};

pub fn pushCleanupHook(
    this: *RareData,
    globalThis: *JSC.JSGlobalObject,
    ctx: ?*anyopaque,
    func: CleanupHook.Function,
) void {
    const hook = JSC.VirtualMachine.get().allocator.create(CleanupHook) catch unreachable;
    hook.* = CleanupHook.from(globalThis, ctx, func);
    if (this.cleanup_hook == null) {
        this.cleanup_hook = hook;
        this.tail_cleanup_hook = hook;
    } else {
        this.cleanup_hook.?.next = hook;
    }
}

pub fn boringEngine(rare: *RareData) *BoringSSL.ENGINE {
    return rare.boring_ssl_engine orelse brk: {
        rare.boring_ssl_engine = BoringSSL.ENGINE_new();
        break :brk rare.boring_ssl_engine.?;
    };
}

pub fn stderr(rare: *RareData) *Blob.Store {
    bun.Analytics.Features.@"Bun.stderr" += 1;
    return rare.stderr_store orelse brk: {
        var mode: bun.Mode = 0;
        const fd = if (Environment.isWindows) FDImpl.fromUV(2).encode() else bun.STDERR_FD;

        switch (Syscall.fstat(fd)) {
            .result => |stat| {
                mode = @intCast(stat.mode);
            },
            .err => {},
        }

        const store = Blob.Store.new(.{
            .ref_count = std.atomic.Value(u32).init(2),
            .allocator = default_allocator,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = fd,
                    },
                    .is_atty = Output.stderr_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        });

        rare.stderr_store = store;
        break :brk store;
    };
}

pub fn stdout(rare: *RareData) *Blob.Store {
    bun.Analytics.Features.@"Bun.stdout" += 1;
    return rare.stdout_store orelse brk: {
        var mode: bun.Mode = 0;
        const fd = if (Environment.isWindows) FDImpl.fromUV(1).encode() else bun.STDOUT_FD;

        switch (Syscall.fstat(fd)) {
            .result => |stat| {
                mode = @intCast(stat.mode);
            },
            .err => {},
        }
        const store = Blob.Store.new(.{
            .ref_count = std.atomic.Value(u32).init(2),
            .allocator = default_allocator,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = fd,
                    },
                    .is_atty = Output.stdout_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        });
        rare.stdout_store = store;
        break :brk store;
    };
}

pub fn stdin(rare: *RareData) *Blob.Store {
    bun.Analytics.Features.@"Bun.stdin" += 1;
    return rare.stdin_store orelse brk: {
        var mode: bun.Mode = 0;
        const fd = if (Environment.isWindows) FDImpl.fromUV(0).encode() else bun.STDIN_FD;

        switch (Syscall.fstat(fd)) {
            .result => |stat| {
                mode = @intCast(stat.mode);
            },
            .err => {},
        }
        const store = Blob.Store.new(.{
            .allocator = default_allocator,
            .ref_count = std.atomic.Value(u32).init(2),
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = fd,
                    },
                    .is_atty = if (bun.STDIN_FD.isValid()) std.posix.isatty(bun.STDIN_FD.cast()) else false,
                    .mode = mode,
                },
            },
        });
        rare.stdin_store = store;
        break :brk store;
    };
}

const Subprocess = @import("./api/bun/subprocess.zig").Subprocess;

pub fn spawnIPCContext(rare: *RareData, vm: *JSC.VirtualMachine) *uws.SocketContext {
    if (rare.spawn_ipc_usockets_context) |ctx| {
        return ctx;
    }

    const opts: uws.us_socket_context_options_t = .{};
    const ctx = uws.us_create_socket_context(0, vm.event_loop_handle.?, @sizeOf(usize), opts).?;
    IPC.Socket.configure(ctx, true, *Subprocess, Subprocess.IPCHandler);
    rare.spawn_ipc_usockets_context = ctx;
    return ctx;
}

pub fn globalDNSResolver(rare: *RareData, vm: *JSC.VirtualMachine) *JSC.DNS.DNSResolver {
    if (rare.global_dns_data == null) {
        rare.global_dns_data = JSC.DNS.GlobalData.init(vm.allocator, vm);
    }

    return &rare.global_dns_data.?.resolver;
}

pub fn nodeFSStatWatcherScheduler(rare: *RareData, vm: *JSC.VirtualMachine) *StatWatcherScheduler {
    return rare.node_fs_stat_watcher_scheduler orelse {
        rare.node_fs_stat_watcher_scheduler = StatWatcherScheduler.init(vm.allocator, vm);
        return rare.node_fs_stat_watcher_scheduler.?;
    };
}
