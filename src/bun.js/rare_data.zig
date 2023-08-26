const EditorContext = @import("../open.zig").EditorContext;
const Blob = JSC.WebCore.Blob;
const default_allocator = @import("root").bun.default_allocator;
const Output = @import("root").bun.Output;
const RareData = @This();
const Syscall = @import("./node/syscall.zig");
const JSC = @import("root").bun.JSC;
const std = @import("std");
const BoringSSL = @import("root").bun.BoringSSL;
const bun = @import("root").bun;
const WebSocketClientMask = @import("../http/websocket_http_client.zig").Mask;
const UUID = @import("./uuid.zig");

boring_ssl_engine: ?*BoringSSL.ENGINE = null,
editor_context: EditorContext = EditorContext{},
stderr_store: ?*Blob.Store = null,
stdin_store: ?*Blob.Store = null,
stdout_store: ?*Blob.Store = null,

entropy_cache: ?*EntropyCache = null,

hot_map: ?HotMap = null,

// TODO: make this per JSGlobalObject instead of global
// This does not handle ShadowRealm correctly!
tail_cleanup_hook: ?*CleanupHook = null,
cleanup_hook: ?*CleanupHook = null,

file_polls_: ?*JSC.FilePoll.HiveArray = null,

global_dns_data: ?*JSC.DNS.GlobalData = null,

mime_types: ?bun.HTTP.MimeType.Map = null,

pub fn hotMap(this: *RareData, allocator: std.mem.Allocator) *HotMap {
    if (this.hot_map == null) {
        this.hot_map = HotMap.init(allocator);
    }

    return &this.hot_map.?;
}

pub fn mimeTypeFromString(this: *RareData, allocator: std.mem.Allocator, str: []const u8) ?bun.HTTP.MimeType {
    if (this.mime_types == null) {
        this.mime_types = bun.HTTP.MimeType.createHashTable(
            allocator,
        ) catch @panic("Out of memory");
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
        var entry = this._map.getOrPut(key) catch @panic("Out of memory");
        if (entry.found_existing) {
            @panic("HotMap already contains key");
        }

        entry.key_ptr.* = this._map.allocator.dupe(u8, key) catch @panic("Out of memory");
        entry.value_ptr.* = Entry.init(ptr);
    }

    pub fn remove(this: *HotMap, key: []const u8) void {
        var entry = this._map.getEntry(key) orelse return;
        bun.default_allocator.free(entry.key_ptr.*);
        _ = this._map.orderedRemove(key);
    }
};

pub fn filePolls(this: *RareData, vm: *JSC.VirtualMachine) *JSC.FilePoll.HiveArray {
    return this.file_polls_ orelse {
        this.file_polls_ = vm.allocator.create(JSC.FilePoll.HiveArray) catch unreachable;
        this.file_polls_.?.* = JSC.FilePoll.HiveArray.init(vm.allocator);
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
    var hook = JSC.VirtualMachine.get().allocator.create(CleanupHook) catch unreachable;
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
    return rare.stderr_store orelse brk: {
        var store = default_allocator.create(Blob.Store) catch unreachable;
        var mode: JSC.Node.Mode = 0;
        switch (Syscall.fstat(std.os.STDERR_FILENO)) {
            .result => |stat| {
                mode = stat.mode;
            },
            .err => {},
        }

        store.* = Blob.Store{
            .ref_count = 2,
            .allocator = default_allocator,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = std.os.STDERR_FILENO,
                    },
                    .is_atty = Output.stderr_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        };

        rare.stderr_store = store;
        break :brk store;
    };
}

pub fn stdout(rare: *RareData) *Blob.Store {
    return rare.stdout_store orelse brk: {
        var store = default_allocator.create(Blob.Store) catch unreachable;
        var mode: JSC.Node.Mode = 0;
        switch (Syscall.fstat(std.os.STDOUT_FILENO)) {
            .result => |stat| {
                mode = stat.mode;
            },
            .err => {},
        }
        store.* = Blob.Store{
            .ref_count = 2,
            .allocator = default_allocator,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = std.os.STDOUT_FILENO,
                    },
                    .is_atty = Output.stdout_descriptor_type == .terminal,
                    .mode = mode,
                },
            },
        };
        rare.stdout_store = store;
        break :brk store;
    };
}

pub fn stdin(rare: *RareData) *Blob.Store {
    return rare.stdin_store orelse brk: {
        var store = default_allocator.create(Blob.Store) catch unreachable;
        var mode: JSC.Node.Mode = 0;
        switch (Syscall.fstat(std.os.STDIN_FILENO)) {
            .result => |stat| {
                mode = stat.mode;
            },
            .err => {},
        }
        store.* = Blob.Store{
            .allocator = default_allocator,
            .ref_count = 2,
            .data = .{
                .file = Blob.FileStore{
                    .pathlike = .{
                        .fd = std.os.STDIN_FILENO,
                    },
                    .is_atty = std.os.isatty(std.os.STDIN_FILENO),
                    .mode = mode,
                },
            },
        };
        rare.stdin_store = store;
        break :brk store;
    };
}

pub fn globalDNSResolver(rare: *RareData, vm: *JSC.VirtualMachine) *JSC.DNS.DNSResolver {
    if (rare.global_dns_data == null) {
        rare.global_dns_data = JSC.DNS.GlobalData.init(vm.allocator, vm);
    }

    return &rare.global_dns_data.?.resolver;
}
