const EditorContext = @import("../open.zig").EditorContext;
const ValkeyContext = @import("../valkey/valkey.zig").ValkeyContext;
const Blob = JSC.WebCore.Blob;
const default_allocator = bun.default_allocator;
const Output = bun.Output;
const RareData = @This();
const Syscall = bun.sys;
const JSC = bun.JSC;
const std = @import("std");
const BoringSSL = bun.BoringSSL.c;
const bun = @import("bun");
const UUID = @import("./uuid.zig");
const Async = bun.Async;
const StatWatcherScheduler = @import("./node/node_fs_stat_watcher.zig").StatWatcherScheduler;
const IPC = @import("./ipc.zig");
const uws = bun.uws;
const api = bun.api;
boring_ssl_engine: ?*BoringSSL.ENGINE = null,
editor_context: EditorContext = EditorContext{},
stderr_store: ?*Blob.Store = null,
stdin_store: ?*Blob.Store = null,
stdout_store: ?*Blob.Store = null,

postgresql_context: bun.api.Postgres.PostgresSQLContext = .{},

entropy_cache: ?*EntropyCache = null,

hot_map: ?HotMap = null,

// TODO: make this per JSGlobalObject instead of global
// This does not handle ShadowRealm correctly!
cleanup_hooks: std.ArrayListUnmanaged(CleanupHook) = .{},

file_polls_: ?*Async.FilePoll.Store = null,

global_dns_data: ?*bun.api.DNS.GlobalData = null,

spawn_ipc_usockets_context: ?*uws.SocketContext = null,

mime_types: ?bun.http.MimeType.Map = null,

node_fs_stat_watcher_scheduler: ?bun.ptr.RefPtr(StatWatcherScheduler) = null,

listening_sockets_for_watch_mode: std.ArrayListUnmanaged(bun.FileDescriptor) = .{},
listening_sockets_for_watch_mode_lock: bun.Mutex = .{},

temp_pipe_read_buffer: ?*PipeReadBuffer = null,

aws_signature_cache: AWSSignatureCache = .{},

s3_default_client: JSC.Strong.Optional = .empty,
default_csrf_secret: []const u8 = "",

valkey_context: ValkeyContext = .{},

const PipeReadBuffer = [256 * 1024]u8;
const DIGESTED_HMAC_256_LEN = 32;
pub const AWSSignatureCache = struct {
    cache: bun.StringArrayHashMap([DIGESTED_HMAC_256_LEN]u8) = bun.StringArrayHashMap([DIGESTED_HMAC_256_LEN]u8).init(bun.default_allocator),
    date: u64 = 0,
    lock: bun.Mutex = .{},

    pub fn clean(this: *@This()) void {
        for (this.cache.keys()) |cached_key| {
            bun.default_allocator.free(cached_key);
        }
        this.cache.clearRetainingCapacity();
    }

    pub fn get(this: *@This(), numeric_day: u64, key: []const u8) ?[]const u8 {
        this.lock.lock();
        defer this.lock.unlock();
        if (this.date == 0) {
            return null;
        }
        if (this.date == numeric_day) {
            if (this.cache.getKey(key)) |cached| {
                return cached;
            }
        }
        return null;
    }

    pub fn set(this: *@This(), numeric_day: u64, key: []const u8, value: [DIGESTED_HMAC_256_LEN]u8) void {
        this.lock.lock();
        defer this.lock.unlock();
        if (this.date == 0) {
            this.cache = bun.StringArrayHashMap([DIGESTED_HMAC_256_LEN]u8).init(bun.default_allocator);
        } else if (this.date != numeric_day) {
            // day changed so we clean the old cache
            this.clean();
        }
        this.date = numeric_day;
        this.cache.put(bun.default_allocator.dupe(u8, key) catch bun.outOfMemory(), value) catch bun.outOfMemory();
    }
    pub fn deinit(this: *@This()) void {
        this.date = 0;
        this.clean();
        this.cache.deinit();
    }
};

pub fn awsCache(this: *RareData) *AWSSignatureCache {
    return &this.aws_signature_cache;
}

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
        socket.close();
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
        const key_to_free = entry.key_ptr.*;
        const is_same_slice = key_to_free.ptr == key.ptr and key_to_free.len == key.len;
        _ = this._map.orderedRemove(key);
        bun.debugAssert(!is_same_slice);
        bun.default_allocator.free(key_to_free);
    }
};

pub fn filePolls(this: *RareData, vm: *JSC.VirtualMachine) *Async.FilePoll.Store {
    return this.file_polls_ orelse {
        this.file_polls_ = vm.allocator.create(Async.FilePoll.Store) catch unreachable;
        this.file_polls_.?.* = Async.FilePoll.Store.init();
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
        bun.csprng(&this.cache);
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
    ctx: ?*anyopaque,
    func: Function,
    globalThis: *JSC.JSGlobalObject,

    pub fn eql(self: CleanupHook, other: CleanupHook) bool {
        return self.ctx == other.ctx and self.func == other.func and self.globalThis == other.globalThis;
    }

    pub fn execute(self: CleanupHook) void {
        self.func(self.ctx);
    }

    pub fn init(
        globalThis: *JSC.JSGlobalObject,
        ctx: ?*anyopaque,
        func: CleanupHook.Function,
    ) CleanupHook {
        return .{
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
    this.cleanup_hooks.append(bun.default_allocator, CleanupHook.init(globalThis, ctx, func)) catch bun.outOfMemory();
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
        const fd = bun.FD.fromUV(2);

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
                .file = .{
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
        const fd = bun.FD.fromUV(1);

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
                .file = .{
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
        const fd = bun.FD.fromUV(0);

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
                .file = .{
                    .pathlike = .{ .fd = fd },
                    .is_atty = if (fd.unwrapValid()) |valid| std.posix.isatty(valid.native()) else false,
                    .mode = mode,
                },
            },
        });
        rare.stdin_store = store;
        break :brk store;
    };
}

const StdinFdType = enum(i32) {
    file = 0,
    pipe = 1,
    socket = 2,
};

pub export fn Bun__Process__getStdinFdType(vm: *JSC.VirtualMachine, fd: i32) StdinFdType {
    const mode = switch (fd) {
        0 => vm.rareData().stdin().data.file.mode,
        1 => vm.rareData().stdout().data.file.mode,
        2 => vm.rareData().stderr().data.file.mode,
        else => unreachable,
    };
    if (bun.S.ISFIFO(mode)) {
        return .pipe;
    } else if (bun.S.ISSOCK(mode)) {
        return .socket;
    } else {
        return .file;
    }
}

pub fn spawnIPCContext(rare: *RareData, vm: *JSC.VirtualMachine) *uws.SocketContext {
    if (rare.spawn_ipc_usockets_context) |ctx| {
        return ctx;
    }

    const ctx = uws.SocketContext.createNoSSLContext(vm.event_loop_handle.?, @sizeOf(usize)).?;
    IPC.Socket.configure(ctx, true, *IPC.SendQueue, IPC.IPCHandlers.PosixSocket);
    rare.spawn_ipc_usockets_context = ctx;
    return ctx;
}

pub fn globalDNSResolver(rare: *RareData, vm: *JSC.VirtualMachine) *api.DNS.DNSResolver {
    if (rare.global_dns_data == null) {
        rare.global_dns_data = api.DNS.GlobalData.init(vm.allocator, vm);
        rare.global_dns_data.?.resolver.ref(); // live forever
    }

    return &rare.global_dns_data.?.resolver;
}

pub fn nodeFSStatWatcherScheduler(rare: *RareData, vm: *JSC.VirtualMachine) bun.ptr.RefPtr(StatWatcherScheduler) {
    return (rare.node_fs_stat_watcher_scheduler orelse init: {
        rare.node_fs_stat_watcher_scheduler = StatWatcherScheduler.init(vm);
        break :init rare.node_fs_stat_watcher_scheduler.?;
    }).dupeRef();
}

pub fn s3DefaultClient(rare: *RareData, globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    return rare.s3_default_client.get() orelse {
        const vm = globalThis.bunVM();
        var aws_options = bun.S3.S3Credentials.getCredentialsWithOptions(vm.transpiler.env.getS3Credentials(), .{}, null, null, null, globalThis) catch bun.outOfMemory();
        defer aws_options.deinit();
        const client = JSC.WebCore.S3Client.new(.{
            .credentials = aws_options.credentials.dupe(),
            .options = aws_options.options,
            .acl = aws_options.acl,
            .storage_class = aws_options.storage_class,
        });
        const js_client = client.toJS(globalThis);
        js_client.ensureStillAlive();
        rare.s3_default_client = .create(js_client, globalThis);
        return js_client;
    };
}

pub fn defaultCSRFSecret(this: *RareData) []const u8 {
    if (this.default_csrf_secret.len == 0) {
        const secret = bun.default_allocator.alloc(u8, 16) catch bun.outOfMemory();
        bun.csprng(secret);
        this.default_csrf_secret = secret;
    }
    return this.default_csrf_secret;
}

pub fn deinit(this: *RareData) void {
    if (this.temp_pipe_read_buffer) |pipe| {
        this.temp_pipe_read_buffer = null;
        bun.default_allocator.destroy(pipe);
    }

    this.aws_signature_cache.deinit();

    this.s3_default_client.deinit();
    if (this.boring_ssl_engine) |engine| {
        _ = bun.BoringSSL.c.ENGINE_free(engine);
    }
    if (this.default_csrf_secret.len > 0) {
        bun.default_allocator.free(this.default_csrf_secret);
    }

    this.cleanup_hooks.clearAndFree(bun.default_allocator);

    this.valkey_context.deinit();
}
